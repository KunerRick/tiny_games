#!/usr/bin/env node
/**
 * 守卫塔楼 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 覆盖：地图合法性、路径推导、塔位、建造 / 升级 / 出售经济、波次出场、
 *       漏怪扣血与判负、索敌优先级、溅射、减速、通关模拟、随机长跑、存档解析。
 *
 * 用法：node tools/verify-td-core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_tower_defense', 'scripts');
const OUT = path.join(ROOT, 'temp', 'td-core-test');

const TSC_CANDIDATES = [
    process.env.TSC,
    path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc',
].filter(Boolean);

const tscPath = TSC_CANDIDATES.find((p) => p && fs.existsSync(p));
if (!tscPath) {
    console.error('找不到 tsc。请设置 TSC 环境变量，或在项目内 npm install。');
    process.exit(2);
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(`编译纯逻辑模块 → ${path.relative(ROOT, OUT)}`);
execFileSync(process.execPath, [
    tscPath,
    path.join(SRC, 'TDCore.ts'),
    path.join(SRC, 'TDConfig.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const {
    TDCore,
    validateMap,
    findPathCells,
    cellCenterX,
    cellCenterY,
} = require(path.join(OUT, 'TDCore.js'));

const {
    TD_MAPS,
    TD_MAP_COUNT,
    TD_WAVES,
    TD_WAVE_COUNT,
    TD_TOWERS,
    TD_ENEMIES,
    TD_COLS,
    TD_ROWS,
    TD_TOWER_MAX_LEVEL,
    TD_SELL_REFUND,
    getTDMap,
    enemyHp,
    waveEnemyCount,
    createDefaultSave,
    parseTDSave,
} = require(path.join(OUT, 'TDConfig.js'));

let passed = 0;
const failures = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failures.push({ name, err });
        console.error(`  ✗ ${name}`);
        console.error(`      ${err.message}`);
    }
}

function assert(cond, message) {
    if (!cond) throw new Error(message || '断言失败');
}

function assertClose(a, b, eps, message) {
    if (!(Math.abs(a - b) <= eps)) throw new Error(`${message || '数值不接近'}: ${a} vs ${b}`);
}

const DT = 1 / 60;

/** 空波次，用于隔离测试（不自动刷怪） */
function emptyWaves() {
    return [];
}

/** 取离路径最近的空塔位（用于索敌 / 溅射测试） */
function nearestSlotIndex(core) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < core.slots.length; i++) {
        const s = core.slots[i];
        for (let k = 0; k < core.pathPoints.length; k++) {
            const p = core.pathPoints[k];
            const d = Math.hypot(p.x - s.x, p.y - s.y);
            if (d < bestDist) {
                bestDist = d;
                best = i;
            }
        }
    }
    return best;
}

/** 沿路径找离某个塔位最近的距离值（测试时把敌人放在塔的射程内） */
function nearestPathDistance(core, slot) {
    let best = 0;
    let bestDist = Infinity;
    const step = 0.1;
    for (let d = 0; d <= core.pathLength; d += step) {
        const p = core.positionAtDistance(d);
        const dist = Math.hypot(p.x - slot.x, p.y - slot.y);
        if (dist < bestDist) {
            bestDist = dist;
            best = d;
        }
    }
    return best;
}

/** 让核心推进 seconds 秒 */
function advance(core, seconds, dt = DT) {
    const steps = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < steps; i++) {
        core.step(dt);
        core.drainEvents();
    }
}

// ==================== 地图 ====================

console.log('\n[地图与路径]');

test('3 张地图全部合法（尺寸 / 连通 / 塔位不在路径上）', () => {
    assert(TD_MAP_COUNT === 3, `应有 3 张地图，实际 ${TD_MAP_COUNT}`);
    for (const map of TD_MAPS) {
        const problems = validateMap(map);
        assert(problems.length === 0, `地图 ${map.id} ${map.name} 有问题：${problems.join('; ')}`);
        assert(map.grid.length === TD_ROWS, `地图 ${map.name} 行数错误`);
        for (const row of map.grid) assert(row.length === TD_COLS, `地图 ${map.name} 行宽错误`);
    }
});

test('路径从 S 格心开始、E 格心结束，长度合理', () => {
    for (const map of TD_MAPS) {
        const cells = findPathCells(map.grid);
        assert(cells.length >= 15, `地图 ${map.name} 路径太短：${cells.length}`);
        const first = cells[0];
        const last = cells[cells.length - 1];
        const startC = first % TD_COLS;
        const startR = Math.floor(first / TD_COLS);
        const endC = last % TD_COLS;
        const endR = Math.floor(last / TD_COLS);
        assert(map.grid[startR][startC] === 'S', `地图 ${map.name} 路径起点不是 S`);
        assert(map.grid[endR][endC] === 'E', `地图 ${map.name} 路径终点不是 E`);

        const core = TDCore.create(map.id);
        assert(core.pathLength > 10, `地图 ${map.name} 路径长度异常：${core.pathLength}`);
        const p0 = core.pathPoints[0];
        assertClose(p0.x, cellCenterX(startC), 1e-9, '起点 x');
        assertClose(p0.y, cellCenterY(startR), 1e-9, '起点 y');
        const pn = core.pathPoints[core.pathPoints.length - 1];
        assertClose(pn.x, cellCenterX(endC), 1e-9, '终点 x');
        assertClose(pn.y, cellCenterY(endR), 1e-9, '终点 y');
    }
});

test('每张地图塔位数量足够且互不重叠', () => {
    for (const map of TD_MAPS) {
        const core = TDCore.create(map.id);
        assert(core.slots.length >= 8, `地图 ${map.name} 塔位只有 ${core.slots.length} 个`);
        const seen = new Set();
        for (const slot of core.slots) {
            const key = `${slot.r},${slot.c}`;
            assert(!seen.has(key), `地图 ${map.name} 塔位重复：${key}`);
            seen.add(key);
            assert(map.grid[slot.r][slot.c] === 'o', `地图 ${map.name} 塔位坐标不是 o`);
        }
    }
});

// ==================== 经济 ====================

console.log('\n[建造 / 升级 / 出售]');

test('建造扣除金币并把塔放到塔位', () => {
    const core = TDCore.create(1);
    const before = core.gold;
    const res = core.build(0, 'gun');
    assert(res.ok, '建造应成功');
    const cost = TD_TOWERS.gun.levels[0].cost;
    assert(core.gold === before - cost, `金币应扣 ${cost}，实际扣 ${before - core.gold}`);
    assert(core.slots[0].tower && core.slots[0].tower.kind === 'gun', '塔未落位');
    assert(core.slots[0].tower.level === 1, '初始等级应为 1');
});

test('金币不足时建造被拒且不扣钱、不落塔', () => {
    const core = TDCore.create(1);
    core.gold = 10;
    const res = core.build(0, 'sniper');
    assert(!res.ok && res.reason === 'gold', `应因金币不足被拒，实际 ${JSON.stringify(res)}`);
    assert(core.gold === 10, '被拒后不应扣钱');
    assert(core.slots[0].tower === null, '被拒后不应落塔');
});

test('占位建造被拒；非法塔位被拒', () => {
    const core = TDCore.create(1);
    core.gold = 9999;
    assert(core.build(0, 'gun').ok, '首次建造应成功');
    const again = core.build(0, 'gun');
    assert(!again.ok && again.reason === 'occupied', '占位应被拒');
    const bad = core.build(999, 'gun');
    assert(!bad.ok && bad.reason === 'slot', '非法塔位应被拒');
});

test('升级扣费、等级上限 3、满级拒绝', () => {
    const core = TDCore.create(1);
    core.gold = 9999;
    core.build(0, 'gun');
    let res = core.upgrade(0);
    assert(res.ok && core.slots[0].tower.level === 2, '升到 2 级失败');
    assert(core.gold === 9999 - TD_TOWERS.gun.levels[0].cost - TD_TOWERS.gun.levels[1].cost, '升级扣费错误');
    res = core.upgrade(0);
    assert(res.ok && core.slots[0].tower.level === 3, '升到 3 级失败');
    const maxRes = core.upgrade(0);
    assert(!maxRes.ok && maxRes.reason === 'max', '满级应被拒');
    assert(core.slots[0].tower.level === TD_TOWER_MAX_LEVEL, '等级超过上限');
});

test('出售返还 50% 累计投入并移除塔', () => {
    const core = TDCore.create(1);
    core.gold = 1000;
    core.build(0, 'gun');
    core.upgrade(0);
    const invested = TD_TOWERS.gun.levels[0].cost + TD_TOWERS.gun.levels[1].cost;
    const before = core.gold;
    const res = core.sell(0);
    assert(res.ok, '出售应成功');
    assert(res.refund === Math.floor(invested * TD_SELL_REFUND), `返还应为 ${Math.floor(invested * TD_SELL_REFUND)}`);
    assert(core.gold === before + res.refund, '出售金币入账错误');
    assert(core.slots[0].tower === null, '出售后塔位应清空');
});

// ==================== 波次 ====================

console.log('\n[波次与胜负]');

test('只能在准备阶段开波，重复开波被拒', () => {
    const core = TDCore.create(1);
    assert(core.phase === 'prep', '初始应为准备阶段');
    assert(core.startWave(), '首次开波应成功');
    assert(core.phase === 'running', '开波后应进入 running');
    assert(!core.startWave(), '运行中再次开波应被拒');
});

test('出场时间遵循 delay / interval', () => {
    const core = TDCore.create(1);
    core.waves = [{ groups: [{ kind: 'grunt', count: 3, interval: 2, delay: 1 }], bonus: 0 }];
    core.waveIndex = 0;
    core.startWave();
    advance(core, 0.5);
    assert(core.enemies.length === 0, 'delay 未到不应出怪');
    advance(core, 0.6); // t=1.1
    assert(core.enemies.length === 1, `t=1.1 应有 1 只，实际 ${core.enemies.length}`);
    advance(core, 2.0); // t=3.1
    assert(core.enemies.length === 2, `t=3.1 应有 2 只，实际 ${core.enemies.length}`);
    advance(core, 2.0); // t=5.1
    assert(core.enemies.length === 3, `t=5.1 应有 3 只，实际 ${core.enemies.length}`);
});

test('敌人沿路径移动，位置连续且始终在网格内', () => {
    const core = TDCore.create(1);
    core.waves = [{ groups: [{ kind: 'grunt', count: 1, interval: 1, delay: 0 }], bonus: 0 }];
    core.startWave();
    let prev = null;
    for (let i = 0; i < 120; i++) {
        core.step(DT);
        core.drainEvents();
        const e = core.enemies[0];
        if (!e) break;
        assert(Number.isFinite(e.x) && Number.isFinite(e.y), '坐标出现 NaN');
        assert(e.x >= 0 && e.x <= TD_COLS && e.y >= 0 && e.y <= TD_ROWS, `敌人跑出网格：${e.x},${e.y}`);
        if (prev) {
            const d = Math.hypot(e.x - prev.x, e.y - prev.y);
            assert(d < 0.1, `单帧位移过大：${d}`);
        }
        prev = { x: e.x, y: e.y };
    }
});

test('漏怪扣血，装甲兵扣 2 点，生命归零判负', () => {
    const core = TDCore.create(1);
    core.waves = emptyWaves();
    core.lives = 3;
    core.phase = 'running';
    core.debugSpawn('tank', core.pathLength - 0.001);
    core.step(DT);
    assert(core.lives === 1, `装甲兵漏怪应扣 2 血，剩余 ${core.lives}`);
    assert(core.enemies.length === 0, '漏怪应被移除');

    // 空波次下清场会直接判胜，重新进入 running 再测第二只
    core.phase = 'running';
    core.debugSpawn('grunt', core.pathLength - 0.001);
    core.step(DT);
    assert(core.lives === 0, `小兵漏怪后生命应为 0，实际 ${core.lives}`);
    assert(core.phase === 'lost', `生命归零应判负，实际 ${core.phase}`);
});

test('十波全清判胜（自动玩家）', () => {
    for (const map of TD_MAPS) {
        const result = autoPlay(map.id);
        assert(result.phase === 'won', `地图 ${map.name} 自动玩家未通关：${result.phase}，第 ${result.waveIndex + 1} 波，剩 ${result.lives} 血`);
    }
});

// ==================== 战斗 ====================

console.log('\n[索敌 / 溅射 / 减速]');

test('索敌优先级：机枪打最前、迫击炮打最近、狙击打最低血', () => {
    const core = TDCore.create(1);
    core.waves = emptyWaves();
    core.gold = 99999;
    const slotIndex = nearestSlotIndex(core);
    core.build(slotIndex, 'gun');
    core.phase = 'running';

    // 在塔附近放三只：沿路径距离依次 +0 / +1.5 / +3，血量不同
    const base = Math.min(nearestPathDistance(core, core.slots[slotIndex]), core.pathLength - 2);
    const a = core.debugSpawn('grunt', base, 100);
    const b = core.debugSpawn('grunt', base + 0.8, 50);
    const c = core.debugSpawn('grunt', base + 1.6, 200);

    core.step(0.001);
    let shot = core.shots[0];
    assert(shot, '机枪塔未开火');
    assert(shot.targetId === c.id, `机枪应打最前的敌人 ${c.id}，实际 ${shot.targetId}`);
    core.shots.length = 0;

    // 换迫击炮：清空塔位重来
    const core2 = TDCore.create(1);
    core2.waves = emptyWaves();
    core2.gold = 99999;
    core2.build(slotIndex, 'mortar');
    core2.phase = 'running';
    const tower = core2.slots[slotIndex];
    const txn = core2.debugSpawn('grunt', base, 100);
    const tyn = core2.debugSpawn('grunt', base + 0.8, 100);
    const tzn = core2.debugSpawn('grunt', base + 1.6, 100);
    const distTo = (e) => Math.hypot(e.x - tower.x, e.y - tower.y);
    const closest = [txn, tyn, tzn].sort((p, q) => distTo(p) - distTo(q))[0];
    core2.step(0.001);
    shot = core2.shots[0];
    assert(shot, '迫击炮未开火');
    assert(shot.targetId === closest.id, `迫击炮应打最近的敌人 ${closest.id}，实际 ${shot.targetId}`);

    // 狙击：三个里血量最低的 b（50）
    const core3 = TDCore.create(1);
    core3.waves = emptyWaves();
    core3.gold = 99999;
    core3.build(slotIndex, 'sniper');
    core3.phase = 'running';
    const sa = core3.debugSpawn('grunt', base, 100);
    const sb = core3.debugSpawn('grunt', base + 0.8, 50);
    const sc = core3.debugSpawn('grunt', base + 1.6, 200);
    core3.step(0.001);
    shot = core3.shots[0];
    assert(shot, '狙击塔未开火');
    assert(shot.targetId === sb.id, `狙击应打最低血的敌人 ${sb.id}，实际 ${shot.targetId}`);
    assert(sa.hp === 100 && sc.hp === 200, '未被选中的敌人不应掉血');
});

test('迫击炮溅射一次命中多只', () => {
    const core = TDCore.create(1);
    core.waves = emptyWaves();
    core.gold = 99999;
    const slotIndex = nearestSlotIndex(core);
    core.build(slotIndex, 'mortar');
    core.phase = 'running';
    const base = Math.min(nearestPathDistance(core, core.slots[slotIndex]), core.pathLength - 2);
    const a = core.debugSpawn('grunt', base, 500);
    const b = core.debugSpawn('grunt', base + 0.8, 500);
    const c = core.debugSpawn('grunt', base + 1.6, 500);
    advance(core, 0.6);
    const hurt = [a, b, c].filter((e) => e.hp < 500).length;
    assert(hurt >= 2, `溅射应命中至少 2 只，实际 ${hurt}`);
});

test('冰霜塔减速生效（慢速持续、且真的变慢）', () => {
    const core = TDCore.create(1);
    core.waves = emptyWaves();
    core.gold = 99999;
    const slotIndex = nearestSlotIndex(core);
    core.build(slotIndex, 'frost');
    core.phase = 'running';
    const base = Math.min(nearestPathDistance(core, core.slots[slotIndex]), core.pathLength - 2);
    const enemy = core.debugSpawn('grunt', base, 5000);
    advance(core, 0.4);
    assert(enemy.slowTimer > 0, '冰霜命中后应有减速计时');
    assert(enemy.slowFactor > 0, '减速比例应大于 0');
    const distBefore = enemy.dist;
    const startDist = enemy.dist;
    core.step(0.25);
    core.drainEvents();
    const slowAdvance = enemy.dist - distBefore;
    const normalAdvance = TD_ENEMIES.grunt.speed * 0.25;
    assert(slowAdvance < normalAdvance * 0.9, `减速后单步位移 ${slowAdvance.toFixed(3)} 应明显小于 ${normalAdvance.toFixed(3)}`);
    assert(enemy.dist > startDist, '减速不应完全停住');
});

test('弹丸命中后敌人掉血，击杀给金币', () => {
    const core = TDCore.create(1);
    core.waves = emptyWaves();
    core.gold = 99999;
    const slotIndex = nearestSlotIndex(core);
    core.build(slotIndex, 'gun');
    core.phase = 'running';
    const base = Math.min(nearestPathDistance(core, core.slots[slotIndex]), core.pathLength - 2);
    const enemy = core.debugSpawn('grunt', base, 12);
    const goldBefore = core.gold;
    advance(core, 1.0);
    assert(core.totalKills === 1, '应击杀 1 只');
    assert(core.gold === goldBefore + TD_ENEMIES.grunt.reward, '击杀金币入账错误');
    assert(enemy.hp === 0, '敌人血量应归零');
});

// ==================== 数值 / 存档 ====================

console.log('\n[数值与存档]');

test('波次敌人血量随波次与地图难度递增', () => {
    const map1 = getTDMap(1);
    const map3 = getTDMap(3);
    let prev = 0;
    for (let wave = 1; wave <= TD_WAVE_COUNT; wave++) {
        const hp = enemyHp(map1, 'grunt', wave);
        assert(hp > prev, `第 ${wave} 波血量未增长`);
        prev = hp;
    }
    assert(enemyHp(map3, 'grunt', 1) > enemyHp(map1, 'grunt', 1), '更难的图血量应更高');
});

test('波次配置完整：10 波、每波至少 6 只、最后一波有 Boss', () => {
    assert(TD_WAVES.length === 10, `应有 10 波，实际 ${TD_WAVES.length}`);
    for (let i = 0; i < TD_WAVES.length; i++) {
        assert(waveEnemyCount(TD_WAVES[i]) >= 6, `第 ${i + 1} 波敌人太少`);
    }
    const last = TD_WAVES[TD_WAVES.length - 1];
    assert(last.groups.some((g) => g.kind === 'boss'), '最后一波应有 Boss');
});

test('存档往返与坏档回落', () => {
    const save = createDefaultSave();
    save.bestWave[1] = 7;
    save.bestWave[2] = 10;
    save.lastMap = 2;
    save.totalKills = 123;
    const round = parseTDSave(JSON.parse(JSON.stringify(save)));
    assert(round.bestWave[1] === 7 && round.bestWave[2] === 10, '最远波次未还原');
    assert(round.lastMap === 2 && round.totalKills === 123, 'lastMap / totalKills 未还原');

    for (const bad of [null, 0, 'x', [], { bestWave: 'oops', lastMap: 99, totalKills: -5 }]) {
        const out = parseTDSave(bad);
        assert(out.bestWave.length === TD_MAP_COUNT, '坏档应回落为默认值');
        assert(out.lastMap >= 1 && out.lastMap <= TD_MAP_COUNT, '坏档 lastMap 应合法');
        assert(out.totalKills >= 0, '坏档 totalKills 应为 0');
    }
});

// ==================== 随机长跑 ====================

console.log('\n[随机长跑]');

function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('1,000 局随机操作不崩溃、不变量全成立', () => {
    const kinds = Object.keys(TD_TOWERS);
    for (let run = 0; run < 1000; run++) {
        const rng = mulberry32(run * 7919 + 13);
        const mapId = 1 + Math.floor(rng() * TD_MAP_COUNT);
        const core = TDCore.create(mapId);
        let time = 0;
        let guard = 0;
        while (!core.ended && time < 90 && guard++ < 20000) {
            if (core.phase === 'prep') {
                // 随机花一点钱
                for (let k = 0; k < 3; k++) {
                    const slot = Math.floor(rng() * core.slots.length);
                    const kind = kinds[Math.floor(rng() * kinds.length)];
                    const action = rng();
                    if (action < 0.45) core.build(slot, kind);
                    else if (action < 0.75) core.upgrade(slot);
                    else core.sell(slot);
                }
                core.startWave();
            }
            core.step(1 / 30);
            core.drainEvents();
            time += 1 / 30;

            assert(core.gold >= 0, `run ${run}: 金币变负`);
            assert(core.lives >= 0 && core.lives <= 10, `run ${run}: 生命越界 ${core.lives}`);
            for (const e of core.enemies) {
                assert(Number.isFinite(e.hp) && Number.isFinite(e.x) && Number.isFinite(e.y), `run ${run}: 敌人数值 NaN`);
                assert(e.x >= -0.5 && e.x <= TD_COLS + 0.5 && e.y >= -0.5 && e.y <= TD_ROWS + 0.5, `run ${run}: 敌人越界`);
            }
            assert(core.enemies.length < 500, `run ${run}: 敌人数量失控`);
        }
        assert(core.slots.length === TDCore.create(mapId).slots.length, '塔位数量不应变化');
    }
});

// ==================== 自动玩家 ====================

/**
 * 一个「会玩」的自动玩家：按路径覆盖度为塔位打分，按 机枪 → 冰霜 → 迫击炮 → 狙击
 * 的优先级铺塔，随后持续升级；准备阶段尽力花钱，然后开波。
 * 用于回归「每张地图都能通关」。
 */
function autoPlay(mapId, dt = DT) {
    const core = TDCore.create(mapId);
    const buildOrder = [
        ['gun', 4],
        ['frost', 1],
        ['mortar', 2],
        ['gun', 2],
        ['sniper', 1],
        ['mortar', 1],
    ];
    const plan = [];
    for (const [kind, count] of buildOrder) for (let i = 0; i < count; i++) plan.push(kind);

    const slotScore = (slot) => {
        let score = 0;
        for (const p of core.pathPoints) {
            const d = Math.hypot(p.x - slot.x, p.y - slot.y);
            if (d <= 3.0) score += 1 - d / 6;
        }
        return score;
    };
    const rankedSlots = core.slots
        .map((slot, i) => ({ i, score: slotScore(slot) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.i);

    let time = 0;
    let planIndex = 0;
    while (!core.ended && time < 600) {
        if (core.phase === 'prep') {
            spend();
            if (!core.startWave()) break;
        } else {
            spend();
        }
        core.step(dt);
        core.drainEvents();
        time += dt;
    }
    return {
        phase: core.phase,
        waveIndex: core.waveIndex,
        lives: core.lives,
        gold: core.gold,
        time,
    };

    function spend() {
        // 先按计划铺塔
        while (planIndex < plan.length && planIndex < rankedSlots.length) {
            const kind = plan[planIndex];
            const cost = TD_TOWERS[kind].levels[0].cost;
            if (core.gold < cost) break;
            const res = core.build(rankedSlots[planIndex], kind);
            if (!res.ok) break;
            planIndex++;
        }
        // 升级：优先升级最靠前的塔，保留至少 40 金
        if (core.gold < 100) return;
        for (let i = 0; i < rankedSlots.length; i++) {
            const slot = core.slots[rankedSlots[i]];
            const tower = slot.tower;
            if (!tower || tower.level >= TD_TOWER_MAX_LEVEL) continue;
            const cost = TD_TOWERS[tower.kind].levels[tower.level].cost;
            if (core.gold >= cost + 40) {
                core.upgrade(rankedSlots[i]);
            }
        }
    }
}

// ==================== 结果 ====================

console.log(`\n${passed} 项通过，${failures.length} 项失败`);
if (failures.length > 0) {
    for (const f of failures) {
        console.error(`\n失败：${f.name}`);
        console.error(f.err && f.err.stack ? f.err.stack : f.err);
    }
    process.exit(1);
}
console.log('TD_CORE_OK');
