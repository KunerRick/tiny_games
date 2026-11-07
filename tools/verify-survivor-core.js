#!/usr/bin/env node
/**
 * 午夜幸存者 — 纯逻辑核心自检（M1 / Gate A）
 *
 * 覆盖规格 §8.5 的 29 项检查。不启动编辑器、不依赖 cc：
 * 先用 tsc 把 SurvivorConfig.ts + SurvivorCore.ts 编译到 temp/，再在 Node 里跑。
 *
 *   node tools/verify-survivor-core.js
 *
 * 退出码 0 = 全绿；1 = 有失败项或性能不达标。
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_survivor', 'scripts');
const OUT = path.join(ROOT, 'temp', 'survivor-core-test');

const TSC_CANDIDATES = [
    process.env.TSC,
    path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc',
].filter(Boolean);

function findTsc() {
    for (const p of TSC_CANDIDATES) {
        if (fs.existsSync(p)) return p;
    }
    throw new Error('找不到 tsc：请设置 TSC 环境变量或 npm install');
}

function build() {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    const files = [path.join(SRC, 'SurvivorConfig.ts'), path.join(SRC, 'SurvivorCore.ts')];
    execFileSync(
        process.execPath,
        [
            findTsc(),
            ...files,
            '--outDir',
            OUT,
            '--rootDir',
            SRC,
            '--module',
            'commonjs',
            '--target',
            'es2019',
            '--skipLibCheck',
        ],
        { stdio: 'inherit' }
    );
}

build();

const C = require(path.join(OUT, 'SurvivorConfig.js'));
const { SurvivorCore } = require(path.join(OUT, 'SurvivorCore.js'));

// ==================== 断言框架 ====================

let passed = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failures.push({ name, message: err.message });
        console.log(`  ✗ ${name}\n      ${err.message}`);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function approx(actual, expected, eps, msg) {
    assert(Math.abs(actual - expected) <= eps, `${msg}：期望 ${expected}±${eps}，实际 ${actual}`);
}

function section(title) {
    console.log(`\n${title}`);
}

// ==================== 通用工具 ====================

const DT = C.FIXED_DT;
const ZERO = { moveX: 0, moveY: 0 };

function fresh(seed = 1) {
    return new SurvivorCore(seed);
}

function stateOf(core) {
    const s = core.serialize();
    s.savedAt = 0;
    return s;
}

function hashOf(core) {
    return JSON.stringify(stateOf(core));
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function activeEnemies(core) {
    return core.getSnapshot().enemies.filter((e) => e.active);
}

function activeGems(core) {
    return core.getSnapshot().gems.filter((g) => g.active);
}

function runSteps(core, steps, inputFn, chooseFn) {
    const fn = typeof inputFn === 'function' ? inputFn : null;
    for (let i = 0; i < steps; i++) {
        const phase = core.getSnapshot().phase;
        if (phase === 'levelup') {
            (chooseFn || chooseFirst)(core);
            continue;
        }
        if (phase !== 'running') return false;
        core.step(DT, fn ? fn(core, i) : ZERO);
        if (core.getSnapshot().phase === 'levelup') (chooseFn || chooseFirst)(core);
    }
    return core.getSnapshot().phase === 'running';
}

function runSeconds(core, seconds, inputFn, chooseFn) {
    return runSteps(core, Math.round(seconds / DT), inputFn, chooseFn);
}

function chooseFirst(core) {
    core.chooseUpgrade(0);
}

const PRIORITY = ['weaponUpgrade', 'newWeapon', 'passiveUpgrade', 'newPassive', 'heal', 'temper'];

function chooseByPriority(core) {
    const offers = core.getOffers();
    let best = 0;
    let bestRank = 99;
    for (let i = 0; i < offers.length; i++) {
        const rank = PRIORITY.indexOf(offers[i].kind);
        if (rank >= 0 && rank < bestRank) {
            bestRank = rank;
            best = i;
        }
    }
    core.chooseUpgrade(best);
}

/** 以 fresh 存档为模板，按需替换敌人/武器/时间 */
function scenario(overrides) {
    const base = clone(fresh(7).serialize());
    base.player.maxHp = 9999;
    base.player.hp = 9999;
    base.player.pickupRadius = 1;
    base.weapons = {};
    base.passives = {};
    base.enemies = [];
    base.bullets = [];
    base.gems = [];
    base.boss = null;
    base.offers = [];
    base.timers.nextWaveTime = 100000;
    base.timers.spawnAcc = 0;
    if (overrides) Object.assign(base, overrides);
    return base;
}

let uidSeq = 5000;

function enemyCompact(kind, x, y, hp, extra) {
    const base = C.ENEMY_BASE[kind];
    const elite = extra && extra.elite ? 1 : 0;
    return [
        C.ENEMY_KIND_ORDER.indexOf(kind),
        x,
        y,
        hp === undefined ? base.hp : hp,
        hp === undefined ? base.hp : hp,
        extra && extra.speed !== undefined ? extra.speed : base.speed,
        base.radius,
        extra && extra.damage !== undefined ? extra.damage : 0,
        base.xp,
        elite,
        uidSeq++,
        extra && extra.phase !== undefined ? extra.phase : 0,
        1.3,
    ];
}

function coreFrom(save) {
    const core = fresh(save.seed);
    const ok = core.restore(save);
    assert(ok, 'restore() 返回 false（存档本身不合法）');
    return core;
}

function finiteNumbers(value, pathName, out) {
    if (typeof value === 'number') {
        if (!isFinite(value)) out.push(pathName);
    } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) finiteNumbers(value[i], `${pathName}[${i}]`, out);
    } else if (value && typeof value === 'object') {
        for (const k of Object.keys(value)) finiteNumbers(value[k], `${pathName}.${k}`, out);
    }
}

function assertNoNaN(core) {
    const bad = [];
    finiteNumbers(core.serialize(), 'save', bad);
    assert(bad.length === 0, `出现 NaN/Infinity：${bad.slice(0, 5).join(', ')}`);
}

// ==================== 1. 确定性 ====================

section('1. 确定性与随机');

const scriptedInput = (core, i) => ({ moveX: Math.sin(i * 0.05), moveY: Math.cos(i * 0.07) });

check('1 相同种子 + 相同输入 → 完全相同的结果', () => {
    const a = fresh(1234);
    const b = fresh(1234);
    runSteps(a, 900, scriptedInput, chooseFirst);
    runSteps(b, 900, scriptedInput, chooseFirst);
    assert(hashOf(a) === hashOf(b), '两个同种子核心的状态哈希不一致');
});

check('2 不同种子 → 不同的刷怪序列', () => {
    const a = fresh(1);
    const b = fresh(2);
    runSteps(a, 600, ZERO, chooseFirst);
    runSteps(b, 600, ZERO, chooseFirst);
    const ea = JSON.stringify(activeEnemies(a).map((e) => [e.kind, Math.round(e.x), Math.round(e.y)]));
    const eb = JSON.stringify(activeEnemies(b).map((e) => [e.kind, Math.round(e.x), Math.round(e.y)]));
    assert(ea !== eb, '不同种子产生了完全相同的刷怪序列');
});

check('3 刷新位置距玩家 620–780 且不落在玩家 480 内', () => {
    const core = fresh(11);
    const p = core.getSnapshot().player;
    runSteps(core, 60, ZERO, chooseFirst);
    const enemies = activeEnemies(core);
    assert(enemies.length >= 1, '1 秒内没有刷出敌人');
    for (const e of enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        assert(d >= 619 && d <= 781, `刷怪距离越界：${d.toFixed(1)}`);
    }
});

check('4 敌人上限 300，达到后不再生成', () => {
    const core = fresh(12);
    core.debugSpawn('chaser', 400);
    const n = activeEnemies(core).length;
    assert(n <= C.ENEMY_CAP, `敌人数量 ${n} 超过上限`);
    core.debugAdvance(5);
    assert(activeEnemies(core).length <= C.ENEMY_CAP, 'advance 后敌人数量超过上限');
});

check('5 宝石上限 320，溢出直接结算经验', () => {
    const save = scenario();
    const gems = [];
    for (let i = 0; i < C.GEM_CAP; i++) gems.push([800 + (i % 20), 800 + Math.floor(i / 20), 1, 0]);
    save.gems = gems;
    const core = coreFrom(save);
    core.debugSetWeapon('knife', 5);
    core.debugSetWeapon('orbit', 5);
    core.debugSpawn('chaser', 120);
    const xp0 = core.getSnapshot().player.xp;
    runSteps(core, 60 * 15, ZERO, chooseFirst);
    const gemCount = activeGems(core).length;
    assert(gemCount <= C.GEM_CAP, `宝石数量 ${gemCount} 超过上限`);
    const p = core.getSnapshot().player;
    assert(p.xp > xp0 || p.level > 1, '宝石池满后击杀没有把经验结算进玩家');
});

// ==================== 2. 玩家与经验 ====================

section('2. 玩家、无敌帧与经验');

check('6 玩家无敌帧生效，0.5 s 内多次接触只扣一次血', () => {
    const core = fresh(21);
    const hp0 = core.getSnapshot().player.hp;
    core.debugSpawn('chaser', 1, true);
    // 等到第一次被撞
    let t = 0;
    while (t < 12 && core.getSnapshot().player.hp === hp0) {
        core.step(DT, ZERO);
        t += DT;
    }
    assert(core.getSnapshot().player.hp < hp0, '精英追上玩家后没有造成伤害');
    const hp1 = core.getSnapshot().player.hp;
    core.debugAdvance(0.45);
    assert(core.getSnapshot().player.hp === hp1, '0.45 s 内又被扣血（无敌帧失效）');
    core.debugAdvance(0.7);
    assert(core.getSnapshot().player.hp < hp1, '1.15 s 后仍未再次扣血');
});

check('7 经验曲线与升级触发正确', () => {
    // 曲线公式 need(level) = XP_CURVE_BASE + XP_CURVE_STEP × (level - 1)，曲线常数本身由平衡模拟校准
    const n1 = C.XP_CURVE_BASE;
    const n2 = n1 + C.XP_CURVE_STEP;
    const n3 = n2 + C.XP_CURVE_STEP;
    assert(C.xpNeed(1) === n1 && C.xpNeed(2) === n2 && C.xpNeed(3) === n3, 'xpNeed 曲线错误');
    const core = fresh(22);
    core.debugAddXp(n1);
    let s = core.getSnapshot();
    assert(s.phase === 'levelup', `达到 ${n1} XP 没有进入升级`);
    assert(s.player.level === 2, `等级应为 2，实际 ${s.player.level}`);
    assert(s.player.xp === 0, `升级后经验应清零，实际 ${s.player.xp}`);
    assert(s.player.xpNeed === n2, `2 级所需经验应为 ${n2}，实际 ${s.player.xpNeed}`);
    assert(core.getOffers().length === 3, '升级没有给出 3 张卡');
    core.chooseUpgrade(0);
    core.debugAddXp(n2);
    s = core.getSnapshot();
    assert(s.player.level === 3 && s.player.xpNeed === n3, '第二次升级曲线错误');
});

check('8 三选一无重复卡；槽位满后不再出现新武器/新被动', () => {
    const core = fresh(23);
    core.debugAddXp(C.XP_CURVE_BASE);
    const titles = core.getOffers().map((o) => o.title);
    assert(new Set(titles).size === titles.length, `出现重复卡：${titles.join(' / ')}`);
    core.chooseUpgrade(0);
    core.debugSetWeapon('knife', 2);
    core.debugSetWeapon('orbit', 1);
    core.debugSetWeapon('lightning', 1);
    // 被动槽满：用升级选项慢慢填不现实，直接检查槽位判定逻辑——把 3 武器 + 2 被动场景写进存档
    const save = stateOf(core);
    save.passives = { haste: 1, swift: 1 };
    const c2 = coreFrom(save);
    c2.debugAddXp(c2.getSnapshot().player.xpNeed);
    const kinds = c2.getOffers().map((o) => o.kind);
    assert(!kinds.includes('newWeapon'), `武器槽已满仍出现新武器：${kinds.join(',')}`);
    assert(!kinds.includes('newPassive'), `被动槽已满仍出现新被动：${kinds.join(',')}`);
});

check('9 第一次升级至少 1 张武器卡 + 1 张被动卡', () => {
    for (let seed = 1; seed <= 8; seed++) {
        const core = fresh(seed);
        core.debugAddXp(6);
        const kinds = core.getOffers().map((o) => o.kind);
        const hasWeapon = kinds.includes('weaponUpgrade') || kinds.includes('newWeapon');
        const hasPassive = kinds.includes('passiveUpgrade') || kinds.includes('newPassive');
        assert(hasWeapon, `种子 ${seed} 第一次升级没有武器卡：${kinds.join(',')}`);
        assert(hasPassive, `种子 ${seed} 第一次升级没有被动词：${kinds.join(',')}`);
    }
});

// ==================== 3. 武器 ====================

section('3. 四种武器');

function oneEnemyCore(x, y, hp) {
    const save = scenario({ enemies: [enemyCompact('chaser', x, y, hp, { speed: 0 })] });
    return coreFrom(save);
}

check('10 飞刀数量/穿透/间隔正确', () => {
    const counts = [1, 2, 2, 2, 3];
    for (let lv = 1; lv <= 5; lv++) {
        const core = oneEnemyCore(200, 0, 9999);
        core.debugSetWeapon('knife', lv);
        core.step(DT, ZERO);
        const knives = core.getSnapshot().bullets.filter((b) => b.active && b.kind === 'knife');
        assert(knives.length === counts[lv - 1], `飞刀 Lv${lv} 数量应为 ${counts[lv - 1]}，实际 ${knives.length}`);
        approx(knives[0].damage, C.KNIFE_LEVELS[lv - 1].damage, 0.001, `飞刀 Lv${lv} 伤害`);
        approx(knives[0].radius, C.KNIFE_RADIUS, 0.001, `飞刀 Lv${lv} 判定半径`);
    }

    // 间隔：用「刚生成」的子弹生命值识别每一轮齐射
    function volleyTimes(lv, seconds) {
        const core = oneEnemyCore(200, 0, 99999);
        core.debugSetWeapon('knife', lv);
        const times = [];
        const steps = Math.round(seconds / DT);
        for (let i = 0; i < steps; i++) {
            core.step(DT, ZERO);
            const freshKnife = core
                .getSnapshot()
                .bullets.some((b) => b.active && b.kind === 'knife' && b.life > 0.88);
            if (freshKnife) times.push(i * DT);
        }
        return times;
    }
    const t1 = volleyTimes(1, 4.2);
    const t5 = volleyTimes(5, 4.2);
    assert(t1.length >= 4, `飞刀 Lv1 4.2 s 内齐射次数过少：${t1.length}`);
    approx(t1[1] - t1[0], C.KNIFE_LEVELS[0].interval, 0.03, '飞刀 Lv1 间隔');
    approx(t5[1] - t5[0], C.KNIFE_LEVELS[4].interval, 0.03, '飞刀 Lv5 间隔');

    // 穿透：两个排成一列的敌人（按 uid 追踪，避免把期间自然刷出来的小怪算进来）
    function pierced(lv) {
        const a = enemyCompact('chaser', 200, 0, 9999, { speed: 0 });
        const b = enemyCompact('chaser', 320, 0, 9999, { speed: 0 });
        const core2 = coreFrom(scenario({ enemies: [a, b] }));
        core2.debugSetWeapon('knife', lv);
        for (let i = 0; i < 30; i++) core2.step(DT, ZERO);
        const hpOf = (uid) => {
            const e = core2.getSnapshot().enemies.find((x) => x.active && x.uid === uid);
            return e ? e.hp : 0;
        };
        return { a: hpOf(a[10]) < 9999, b: hpOf(b[10]) < 9999 };
    }
    const p3 = pierced(3);
    assert(p3.a && !p3.b, `飞刀 Lv3（穿透 0）应只命中近处敌人，实际 近=${p3.a} 远=${p3.b}`);
    const p4 = pierced(4);
    assert(p4.a && p4.b, `飞刀 Lv4（穿透 1）应命中 2 个敌人，实际 近=${p4.a} 远=${p4.b}`);
});

check('11 星环球数/角速度/同敌冷却正确', () => {
    const core = oneEnemyCore(88, 0, 99999);
    core.debugSetWeapon('orbit', 1);
    const hits = [];
    const steps = Math.round(4 / DT);
    let lastHp = 99999;
    for (let i = 0; i < steps; i++) {
        core.step(DT, ZERO);
        const e = activeEnemies(core)[0];
        if (!e) break;
        if (e.hp < lastHp) {
            hits.push(i * DT);
            lastHp = e.hp;
        }
    }
    assert(hits.length >= 2, `4 s 内星环命中次数过少：${hits.length}`);
    // 两个球相差 180°，角速度 1.8 rad/s → 相邻命中间隔 π/1.8 ≈ 1.745 s
    approx(hits[1] - hits[0], Math.PI / C.ORBIT_LEVELS[0].angular, 0.25, '星环相邻命中间隔');
    for (let i = 1; i < hits.length; i++) {
        assert(hits[i] - hits[i - 1] >= C.ORBIT_HIT_CD - 0.02, '星环命中快于同敌冷却');
    }
});

check('12 落雷目标数与 AoE 正确', () => {
    const save = scenario({
        enemies: [
            enemyCompact('chaser', 250, 0, 9999),
            enemyCompact('chaser', 260, 0, 9999),
            enemyCompact('chaser', 255, 20, 9999),
            enemyCompact('chaser', 400, 0, 9999),
        ],
    });
    const core = coreFrom(save);
    core.debugSetWeapon('lightning', 1);
    let lightningEvents = 0;
    const steps = Math.round(1 / DT);
    for (let i = 0; i < steps; i++) {
        core.step(DT, ZERO);
        for (const ev of core.drainEvents()) if (ev.type === 'lightning') lightningEvents++;
    }
    assert(lightningEvents >= 1, '落雷没有触发');
    approx(lightningEvents, 1, 0, '落雷 Lv1 单次目标数');
    const hp = activeEnemies(core).map((e) => e.hp);
    const clusterDamaged = hp.slice(0, 3).filter((h) => h < 9999).length;
    assert(clusterDamaged >= 2, `AoE 应至少命中同簇 2 个敌人，实际 ${clusterDamaged}`);
    assert(hp[3] === 9999, 'AoE 打到了范围外的敌人');
});

check('13 回旋镖往返；单次投掷对同一目标最多 2 次命中', () => {
    const core = oneEnemyCore(100, 0, 99999);
    core.debugSetWeapon('boomerang', 1);
    let sawOut = false;
    let sawBack = false;
    const steps = Math.round(1.9 / DT);
    for (let i = 0; i < steps; i++) {
        core.step(DT, ZERO);
        for (const b of core.getSnapshot().bullets) {
            if (!b.active || b.kind !== 'boomerang') continue;
            if (b.returning) sawBack = true;
            else if (b.traveled > 50) sawOut = true;
        }
    }
    assert(sawOut && sawBack, `回旋镖没有完成往返（out=${sawOut}, back=${sawBack}）`);
    const e = activeEnemies(core)[0];
    const hits = Math.round((99999 - e.hp) / C.BOOMERANG_LEVELS[0].damage);
    assert(hits === 2, `一次投掷应命中 2 次（去 + 回），实际 ${hits}`);
});

check('14 远程兵维持距离并发射子弹', () => {
    const core = coreFrom(scenario({ enemies: [enemyCompact('shooter', 215, 0, 9999)] }));
    let bullets = 0;
    const steps = Math.round(4 / DT);
    for (let i = 0; i < steps; i++) {
        core.step(DT, ZERO);
        for (const ev of core.drainEvents()) void ev;
        bullets = Math.max(
            bullets,
            core.getSnapshot().bullets.filter((b) => b.active && !b.fromPlayer).length
        );
    }
    assert(bullets >= 1, '远程兵 4 s 内没有发射子弹');
    const e = activeEnemies(core)[0];
    const d = Math.hypot(e.x, e.y);
    assert(d >= C.SHOOTER_RANGE_MIN - 15 && d <= C.SHOOTER_RANGE_MAX + 15, `远程兵距离失控：${d.toFixed(1)}`);
});

check('15 自爆兵预警后爆炸，死亡也爆炸', () => {
    // 贴近玩家：触发引信 → 0.5 s 后爆炸
    const core = coreFrom(scenario({ enemies: [enemyCompact('bomber', 24, 0, 12)] }));
    const hp0 = core.getSnapshot().player.hp;
    let exploded = false;
    for (let i = 0; i < Math.round(2 / DT); i++) {
        core.step(DT, ZERO);
        for (const ev of core.drainEvents()) if (ev.type === 'explode') exploded = true;
    }
    assert(exploded, '自爆兵没有爆炸');
    assert(core.getSnapshot().player.hp < hp0, '自爆没有伤到玩家');

    // 远处被击杀：死亡也要爆炸
    const core2 = coreFrom(scenario({ enemies: [enemyCompact('bomber', 200, 0, 12)] }));
    core2.debugSetWeapon('knife', 1);
    let exploded2 = false;
    for (let i = 0; i < Math.round(4 / DT); i++) {
        core2.step(DT, ZERO);
        for (const ev of core2.drainEvents()) if (ev.type === 'explode') exploded2 = true;
    }
    assert(exploded2, '自爆兵被击杀后没有爆炸');
});

// ==================== 4. 精英 / Boss / 失败 ====================

section('4. 精英、Boss 与失败');

function eliteScenario(time) {
    const save = scenario({ enemies: [] });
    save.time = time;
    save.timers.nextEliteIndex = C.ELITE_TIMES.filter((t) => t <= time).length;
    return save;
}

check('16 精英 2/4/6 分钟出现，属性倍率正确', () => {
    for (const [i, t] of C.ELITE_TIMES.entries()) {
        const save = eliteScenario(t - 1.2);
        save.timers.nextEliteIndex = i;
        const core = coreFrom(save);
        runSteps(core, Math.round(2.5 / DT), ZERO, chooseFirst);
        const elites = activeEnemies(core).filter((e) => e.elite);
        assert(elites.length >= 1, `${t} s 没有出现精英`);
        const e = elites[0];
        const base = C.ENEMY_BASE[e.kind];
        const expectHp = base.hp * (1 + save.time / 240) * C.ELITE_HP_MULT;
        approx(e.maxHp, expectHp, expectHp * 0.05, `${t} s 精英 HP`);
        approx(e.radius, base.radius * C.ELITE_SIZE_MULT, 0.001, `${t} s 精英体积`);
        assert(e.xp === C.ELITE_XP, `${t} s 精英经验应为 ${C.ELITE_XP}`);
    }
});

check('17 Boss 450 s 出现，击杀 → victory', () => {
    const save = scenario();
    save.time = 449;
    save.nextWaveTime = 100000;
    const core = coreFrom(save);
    runSteps(core, Math.round(2 / DT), ZERO, chooseFirst);
    const boss = core.getSnapshot().boss;
    assert(boss && boss.active, '450 s 没有出现 Boss');
    approx(boss.maxHp, C.BOSS_HP, 0.001, 'Boss HP 不应随时间缩放');
    approx(boss.damage, C.BOSS_CONTACT_DMG, 0.001, 'Boss 接触伤害');

    core.debugSetWeapon('knife', 5);
    core.debugSetWeapon('orbit', 5);
    core.debugSetWeapon('lightning', 5);
    let victory = false;
    // 注意：升级面板会连续出现（一拍一级），必须在这里就地选掉，不能因为 phase !== 'running' 就跳出
    for (let i = 0; i < Math.round(240 / DT); i++) {
        const phase = core.getSnapshot().phase;
        if (phase === 'levelup') {
            chooseFirst(core);
            continue;
        }
        if (phase !== 'running') break;
        core.step(DT, ZERO);
        for (const ev of core.drainEvents()) if (ev.type === 'victory') victory = true;
    }
    assert(core.getSnapshot().phase === 'victory', 'Boss 一直没被击杀');
    assert(victory, '没有派发 victory 事件');
});

check('18 HP ≤ 0 → defeat', () => {
    const core = fresh(31);
    core.debugSpawn('chaser', 30);
    let defeat = false;
    for (let i = 0; i < Math.round(60 / DT); i++) {
        if (core.getSnapshot().phase === 'levelup') {
            chooseFirst(core);
            continue;
        }
        if (core.getSnapshot().phase !== 'running') break;
        // 持续补怪：脱战回血会让单批敌人被刀清完，必须保持贴脸压力才能验证死亡
        if (i % 30 === 0) core.debugSpawn('chaser', 20);
        core.step(DT, ZERO);
        for (const ev of core.drainEvents()) if (ev.type === 'defeat') defeat = true;
    }
    assert(core.getSnapshot().phase === 'defeat', '玩家没有死亡');
    assert(defeat, '没有派发 defeat 事件');
    assert(core.getSnapshot().player.hp === 0, '死亡后 HP 应归零');
});

check('19 竞技场夹紧；越界敌人回收', () => {
    const core = fresh(32);
    runSteps(core, Math.round(12 / DT), () => ({ moveX: 1, moveY: 1 }), chooseFirst);
    const p = core.getSnapshot().player;
    assert(Math.abs(p.x) <= C.ARENA_HALF, `玩家 x 越界：${p.x}`);
    assert(Math.abs(p.y) <= C.ARENA_HALF, `玩家 y 越界：${p.y}`);
    approx(Math.abs(p.x), C.ARENA_HALF - C.ARENA_MARGIN, 1, '玩家应被夹在边界余量内');
    for (const e of activeEnemies(core)) {
        assert(Math.abs(e.x) <= C.ARENA_HALF && Math.abs(e.y) <= C.ARENA_HALF, '敌人越界未被夹紧');
    }
});

// ==================== 5. 参考策略自动游玩 ====================

section('5. 参考策略自动游玩（480 s）');

/**
 * 规格 §8.4 的参照策略：
 *   ① 远离最近 5 个敌人的加权中心；
 *   ② 宝石在可及范围内时优先去捡；
 *   ③ 升级按「已拥有武器 > 新武器 > 已拥有被动 > 新被动 > 回复」。
 *
 * 「远离加权中心」在怪围满时会退化成零向量（加权中心≈玩家自己），所以这里用方向采样的方式实现同一意图：
 * 每 0.15 s 在 24 个方向里挑一个综合分最高的，敌人项就是"远离最近 5 个敌人的加权中心"的离散版本，
 * 另外叠加宝石吸引、惯性与贴边惩罚。这样既能跑开，也不会把路过的宝石全丢下。
 */
const BOT = {
    interval: 0.15,
    ahead: 180,
    enemyWeight: 4,
    gemWeight: 65,
    gemRange: 1200,
    inertia: 1,
    edgePenalty: 8,
    enemyRadius: 350,
    dirs: 24,
};

function makeReferenceBot() {
    let dir = { moveX: 1, moveY: 0 };
    let cd = 0;
    return function (core) {
        cd -= DT;
        if (cd > 0) return dir;
        cd = BOT.interval;
        const s = core.getSnapshot();
        const p = s.player;
        const enemies = [];
        for (const e of s.enemies) {
            if (!e.active) continue;
            const d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d < BOT.enemyRadius) enemies.push({ x: e.x, y: e.y, d });
        }
        let gd = Infinity;
        let gx = 0;
        let gy = 0;
        for (const g of s.gems) {
            if (!g.active) continue;
            const d = Math.hypot(g.x - p.x, g.y - p.y);
            if (d < gd) {
                gd = d;
                gx = g.x;
                gy = g.y;
            }
        }
        let bestScore = -Infinity;
        let bestDir = dir;
        for (let k = 0; k < BOT.dirs; k++) {
            const a = (k / BOT.dirs) * Math.PI * 2;
            const ux = Math.cos(a);
            const uy = Math.sin(a);
            let score = 0;
            // 敌人项：前瞻点离怪越近扣分越多 ⇒ 等价于远离怪群加权中心
            for (const e of enemies) {
                const ex = e.x - (p.x + ux * BOT.ahead);
                const ey = e.y - (p.y + uy * BOT.ahead);
                score -= BOT.enemyWeight / (Math.hypot(ex, ey) + 20);
            }
            score += (ux * dir.moveX + uy * dir.moveY) * BOT.inertia;
            if (gd < BOT.gemRange) {
                const gdist = Math.hypot(gx - (p.x + ux * BOT.ahead), gy - (p.y + uy * BOT.ahead));
                score += BOT.gemWeight / (gdist + 80);
            }
            const nx = p.x + ux * 500;
            const ny = p.y + uy * 500;
            if (Math.abs(nx) > 1050 || Math.abs(ny) > 1050) score -= BOT.edgePenalty;
            if (score > bestScore) {
                bestScore = score;
                bestDir = { moveX: ux, moveY: uy };
            }
        }
        dir = bestDir;
        return dir;
    };
}

check('20 480 s 参考策略自动游玩不崩溃、无 NaN、指标在带宽内', () => {
    const core = fresh(2026);
    const bot = makeReferenceBot();
    let levelAt300 = 0;
    let killsAt300 = 0;
    let aliveAt300 = false;
    const totalSteps = Math.round(480 / DT);
    for (let i = 0; i < totalSteps; i++) {
        const phase = core.getSnapshot().phase;
        if (phase === 'levelup') {
            chooseByPriority(core);
            continue;
        }
        if (phase !== 'running') break;
        core.step(DT, bot(core));
        if (core.getSnapshot().phase === 'levelup') chooseByPriority(core);
        if (i === Math.round(300 / DT) - 1) {
            levelAt300 = core.getSnapshot().player.level;
            killsAt300 = core.getSnapshot().kills;
            aliveAt300 = core.getSnapshot().phase === 'running' || core.getSnapshot().phase === 'levelup';
        }
    }
    assertNoNaN(core);
    assert(aliveAt300, '参考策略 300 s 前就死亡了');
    assert(levelAt300 >= 6 && levelAt300 <= 14, `300 s 等级 ${levelAt300} 不在 6–14 区间`);
    console.log(
        `      参考策略结果：300 s 等级 ${levelAt300}、击杀 ${killsAt300}，` +
            `480 s 结束于 ${core.getSnapshot().phase}，时间 ${core.getSnapshot().time.toFixed(1)} s，击杀 ${core.getSnapshot().kills}`
    );
});

// ==================== 6. 静态与事件 ====================

section('6. 源码约束与事件队列');

check('21 核心源码不含 Math.random、不 import cc', () => {
    for (const name of ['SurvivorConfig.ts', 'SurvivorCore.ts']) {
        const raw = fs.readFileSync(path.join(SRC, name), 'utf8');
        // 去掉注释与字符串里的说明文字，只检查真实代码
        const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        assert(!/Math\.random/.test(text), `${name} 出现 Math.random`);
        assert(!/from\s+['"]cc['"]/.test(text), `${name} import 了 cc`);
        assert(!/require\(['"]cc['"]\)/.test(text), `${name} require 了 cc`);
    }
});

check('22 事件队列每帧被取空，不重复派发', () => {
    const core = fresh(41);
    const bot = makeReferenceBot();
    let levelupEvents = 0;
    let prevLevel = 1;
    for (let i = 0; i < Math.round(60 / DT); i++) {
        if (core.getSnapshot().phase !== 'running') break;
        core.step(DT, bot(core));
        const events = core.drainEvents();
        for (const ev of events) if (ev.type === 'levelup') levelupEvents++;
        const level = core.getSnapshot().player.level;
        if (level !== prevLevel) {
            // level 变化的那一帧必须恰好派发一次
            const thisFrame = events.filter((e) => e.type === 'levelup').length;
            assert(thisFrame === 1, `升级帧派发了 ${thisFrame} 次 levelup 事件`);
            prevLevel = level;
        }
        if (core.getSnapshot().phase === 'levelup') chooseFirst(core);
    }
    assert(levelupEvents >= 1, '60 s 内没有升级，事件检查无效');

    // 升级事件不得残留到下一帧
    const c2 = fresh(42);
    c2.debugAddXp(6);
    const first = c2.drainEvents();
    assert(first.some((e) => e.type === 'levelup'), '升级事件未派发');
    c2.chooseUpgrade(0);
    c2.step(DT, ZERO);
    const next = c2.drainEvents();
    assert(!next.some((e) => e.type === 'levelup'), '上一帧的 levelup 事件残留到了下一帧');
});

check('23 固定步长下不同渲染帧率结果一致', () => {
    // 60 fps：每帧 1 步；30 fps：每帧 2 步。核心只收到固定 dt，结果必须一致。
    const a = fresh(51);
    const b = fresh(51);
    const steps = 600;
    for (let i = 0; i < steps; i++) {
        if (a.getSnapshot().phase === 'levelup') chooseFirst(a);
        a.step(DT, scriptedInput(a, i));
    }
    for (let frame = 0; frame < steps / 2; frame++) {
        if (b.getSnapshot().phase === 'levelup') chooseFirst(b);
        b.step(DT, scriptedInput(b, frame * 2));
        if (b.getSnapshot().phase === 'levelup') chooseFirst(b);
        b.step(DT, scriptedInput(b, frame * 2 + 1));
    }
    assert(hashOf(a) === hashOf(b), '不同帧率驱动下状态不一致');
});

// ==================== 7. 性能 ====================

section('7. 性能门槛');

function perfState(count) {
    const save = scenario();
    const enemies = [];
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const radius = 300 + (i % 7) * 60;
        enemies.push(enemyCompact(i % 4 === 0 ? 'shooter' : 'chaser', Math.cos(angle) * radius, Math.sin(angle) * radius, 9999));
    }
    save.enemies = enemies;
    return save;
}

function timeSteps(core, steps, inputFn) {
    const samples = new Float64Array(steps);
    for (let i = 0; i < steps; i++) {
        if (core.getSnapshot().phase === 'levelup') chooseFirst(core);
        const t0 = process.hrtime.bigint();
        core.step(DT, inputFn ? inputFn(i) : ZERO);
        const t1 = process.hrtime.bigint();
        samples[i] = Number(t1 - t0) / 1e6;
    }
    return samples;
}

function percentile(samples, p) {
    const arr = Array.from(samples).sort((a, b) => a - b);
    return arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
}

check('24 同屏上限敌人 × 600 帧性能门槛', () => {
    const core = coreFrom(perfState(C.ENEMY_CAP));
    const samples = timeSteps(core, 600, (i) => ({ moveX: Math.sin(i * 0.02), moveY: Math.cos(i * 0.03) }));
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p99 = percentile(samples, 99);
    console.log(`      逻辑耗时均值 ${avg.toFixed(3)} ms / p99 ${p99.toFixed(3)} ms`);
    assert(avg < 2, `平均单步 ${avg.toFixed(3)} ms 超过 2 ms`);
    assert(p99 < 4, `p99 单步 ${p99.toFixed(3)} ms 超过 4 ms`);
});

check('29 4x 负载（240 步/秒）连续 60 秒', () => {
    const save = perfState(C.ENEMY_CAP);
    const a = coreFrom(clone(save));
    const b = coreFrom(clone(save));
    const steps = 240 * 60;
    const t0 = process.hrtime.bigint();
    timeSteps(a, steps, (i) => ({ moveX: Math.sin(i * 0.01), moveY: Math.cos(i * 0.013) }));
    const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
    timeSteps(b, steps, (i) => ({ moveX: Math.sin(i * 0.01), moveY: Math.cos(i * 0.013) }));
    console.log(`      4x 负载：${steps} 步耗时 ${totalMs.toFixed(0)} ms（${(totalMs / steps).toFixed(3)} ms/步）`);
    assert(totalMs / steps < 2, `4x 负载平均单步 ${(totalMs / steps).toFixed(3)} ms 超过 2 ms`);
    assert(hashOf(a) === hashOf(b), '4x 负载下两次运行结果不一致');
});

// ==================== 8. 存档 ====================

section('8. 存档与读档');

function progressedCore(seed) {
    const core = fresh(seed);
    runSteps(core, 900, scriptedInput, chooseFirst);
    return core;
}

check('25 serialize() → restore() 后状态哈希一致', () => {
    const core = progressedCore(61);
    const save = stateOf(core);
    const restored = coreFrom(clone(save));
    const again = stateOf(restored);
    delete save.savedAt;
    delete again.savedAt;
    assert(JSON.stringify(save) === JSON.stringify(again), '读档后状态与存档不一致');
    if (core.getSnapshot().phase === 'levelup') {
        core.chooseUpgrade(0);
        restored.chooseUpgrade(0);
    }
    assert(
        JSON.stringify(stateOf(core)) === JSON.stringify(stateOf(restored)),
        '读档后继续一步的选择结果不一致'
    );
});

check('26 读档后继续跑与不中断跑在相同输入下结果一致', () => {
    const input = (core, i) => ({ moveX: Math.sin(i * 0.031), moveY: Math.cos(i * 0.017) });
    const a = fresh(62);
    runSteps(a, 300, input, chooseFirst);
    const mid = clone(stateOf(a));
    runSteps(a, 300, (core, i) => input(core, i + 300), chooseFirst);

    const c = fresh(62);
    assert(c.restore(mid), '中途存档恢复失败');
    runSteps(c, 300, (core, i) => input(core, i + 300), chooseFirst);

    assert(JSON.stringify(stateOf(a)) === JSON.stringify(stateOf(c)), '中断续跑与连续跑结果不同');
});

check('27 phase=levelup 的存档恢复后 3 张卡完全一致', () => {
    const core = fresh(63);
    core.debugAddXp(6);
    assert(core.getSnapshot().phase === 'levelup', '没有进入 levelup');
    const save = clone(stateOf(core));
    const restored = coreFrom(save);
    const s = restored.getSnapshot();
    assert(s.phase === 'levelup', `恢复后阶段应为 levelup，实际 ${s.phase}`);
    assert(restored.getOffers().length === 3, '恢复后卡片数量不为 3');
    assert(JSON.stringify(restored.getOffers()) === JSON.stringify(core.getOffers()), '恢复后卡片内容不一致');
});

check('28 篡改/越界/缺字段的存档 restore() 返回 false，不污染当前状态', () => {
    const good = clone(stateOf(fresh(64)));
    const bads = [];

    const v2 = clone(good);
    v2.v = 2;
    bads.push(['版本号错误', v2]);

    const noPlayer = clone(good);
    delete noPlayer.player;
    bads.push(['缺 player', noPlayer]);

    const nanHp = clone(good);
    nanHp.player.hp = NaN;
    bads.push(['HP 为 NaN', nanHp]);

    const overCap = clone(good);
    overCap.enemies = new Array(C.SAVE_MAX_ENEMIES + 1).fill(enemyCompact('chaser', 100, 100, 10));
    bads.push(['敌人数量越界', overCap]);

    const badWeapon = clone(good);
    badWeapon.weapons = { laser: 3 };
    badWeapon.passives = {};
    bads.push(['未知武器 track', badWeapon]);

    const badLevelup = clone(good);
    badLevelup.phase = 'levelup';
    badLevelup.offers = [];
    bads.push(['levelup 却没有卡片', badLevelup]);

    const badBoss = clone(good);
    badBoss.boss = [0, 0, 0];
    bads.push(['Boss 紧凑数组长度错误', badBoss]);

    const badGem = clone(good);
    badGem.gems = [[0, 0, 1]];
    bads.push(['宝石数组缺字段', badGem]);

    for (const [name, save] of bads) {
        const target = fresh(64);
        runSteps(target, 120, ZERO, chooseFirst);
        const before = hashOf(target);
        let ok = false;
        try {
            ok = target.restore(clone(save));
        } catch (err) {
            throw new Error(`${name}：restore 抛出异常 ${err.message}`);
        }
        assert(ok === false, `${name}：restore 应返回 false，实际 true`);
        assert(hashOf(target) === before, `${name}：坏档污染了当前状态`);
    }
});

// ==================== 9. 节奏表与三选一 ====================

section('9. 8 分钟节奏表与三选一');

check('30 节奏表：精英 2/4/6 分、兽潮每 45 s、Boss 7:30（误差 ≤ 3 s）', () => {
    const core = fresh(2026);
    const bot = makeReferenceBot();
    const elite = [];
    const wave = [];
    const boss = [];
    const total = Math.round(460 / DT);
    for (let i = 0; i < total; i++) {
        const phase = core.getSnapshot().phase;
        if (phase === 'levelup') {
            chooseByPriority(core);
            continue;
        }
        if (phase !== 'running') break;
        core.step(DT, bot(core));
        const t = core.getSnapshot().time;
        for (const ev of core.drainEvents()) {
            if (ev.type === 'elite' && ev.data === 0) elite.push(t);
            else if (ev.type === 'wave') wave.push(t);
            else if (ev.type === 'boss') boss.push(t);
        }
        if (core.getSnapshot().phase === 'levelup') chooseByPriority(core);
    }

    assert(elite.length === 3, `精英应出现 3 次，实际 ${elite.length}`);
    for (let i = 0; i < elite.length; i++) {
        approx(elite[i], C.ELITE_TIMES[i], 3, `第 ${i + 1} 只精英时间戳`);
    }
    assert(boss.length === 1, `Boss 应出现 1 次，实际 ${boss.length}`);
    approx(boss[0], C.BOSS_TIME, 3, 'Boss 时间戳');

    const waveSpawns = Math.floor(core.getSnapshot().time / C.WAVE_INTERVAL);
    assert(waveSpawns >= 9, `应至少经历 9 次兽潮，实际 ${waveSpawns}`);
    for (let k = 0; k < wave.length; k++) {
        // 兽潮提示提前 WAVE_WARN 秒
        approx(wave[k], C.WAVE_FIRST + k * C.WAVE_INTERVAL - C.WAVE_WARN, 3, `第 ${k + 1} 次兽潮提示时间`);
    }
    assert(wave.length >= 9, `兽潮提示次数不足：${wave.length}`);
    console.log(
        `      精英 ${elite.map((t) => t.toFixed(1)).join(' / ')} s，` +
            `Boss ${boss[0].toFixed(1)} s，兽潮提示 ${wave.length} 次`
    );
});

check('31 三选一不退化：连续 40 次升级每次 3 张有效卡（含全满级）', () => {
    // 不用构造存档：武器/被动槽位分别是 3/2，自然升级 25 次后全部满级，之后全靠兜底卡
    const core = fresh(99);
    let sawFullBuild = false;
    for (let round = 1; round <= 40; round++) {
        core.debugAddXp(core.getSnapshot().player.xpNeed);
        assert(core.getSnapshot().phase === 'levelup', `第 ${round} 次升级没有进入 levelup`);
        const offers = core.getOffers();
        assert(offers.length === 3, `第 ${round} 次只有 ${offers.length} 张卡`);

        let upgradeCards = 0;
        for (const o of offers) {
            const p = core.getSnapshot().player;
            if (o.kind === 'weaponUpgrade' || o.kind === 'newWeapon') {
                upgradeCards++;
                assert(o.nextLevel <= C.MAX_TRACK_LEVEL, `第 ${round} 次给出满级武器卡：${o.title}`);
                assert(o.nextLevel > o.currentLevel, `第 ${round} 次武器卡没有提升：${o.title}`);
            } else if (o.kind === 'passiveUpgrade' || o.kind === 'newPassive') {
                upgradeCards++;
                assert(o.nextLevel <= C.MAX_TRACK_LEVEL, `第 ${round} 次给出满级被动卡：${o.title}`);
                assert(o.nextLevel > o.currentLevel, `第 ${round} 次被动卡没有提升：${o.title}`);
            } else if (o.kind === 'heal') {
                assert(p.hp < p.maxHp, `第 ${round} 次满血却给出回血卡`);
            } else if (o.kind === 'temper') {
                assert(o.nextLevel > o.currentLevel, `第 ${round} 次淬炼卡没有提升`);
            } else {
                throw new Error(`未知卡类型：${o.kind}`);
            }
        }
        if (upgradeCards === 0) sawFullBuild = true;
        const titles = offers.map((o) => o.title);
        assert(new Set(titles).size === 3, `第 ${round} 次出现重复卡：${titles.join(' / ')}`);

        // 优先拿成长卡，尽快把构筑抽满
        const s = core.getSnapshot();
        let pick = 0;
        for (let i = 0; i < offers.length; i++) {
            const o = offers[i];
            if (o.kind === 'weaponUpgrade' || o.kind === 'newWeapon' || o.kind === 'passiveUpgrade' || o.kind === 'newPassive') {
                pick = i;
                break;
            }
        }
        core.chooseUpgrade(pick);
        if (round === 40) {
            const w = Object.values(s.weapons).reduce((a, b) => a + b, 0);
            assert(w > 0, '四十次升级后应至少有一个武器等级');
        }
    }
    assert(sawFullBuild, '40 次升级内应出现「全部满级、只剩兜底卡」的情形');
    const p = core.getSnapshot().player;
    assert(p.level === 41, `40 次升级后等级应为 41，实际 ${p.level}`);
    assert(core.getSnapshot().temper >= 1, '全满级后应靠淬炼继续成长');
});

check('32 致命伤害来源：记录最后一次伤害（接触 / 远程弹）', () => {
    const contact = coreFrom(
        scenario({
            player: Object.assign(clone(scenario().player), { hp: 5, maxHp: 100 }),
            enemies: [enemyCompact('chaser', 20, 0, 999, { damage: 8 })],
        })
    );
    runSeconds(contact, 0.2);
    const s1 = contact.getRunSummary();
    assert(contact.getSnapshot().phase === 'defeat', '接触伤害应导致阵亡');
    assert(s1.lastHitSource === 'chaser', `致命来源应为 chaser，实际 ${s1.lastHitSource}`);
    assert(s1.lastHitDamage === 8, `致命伤害应为 8，实际 ${s1.lastHitDamage}`);

    const shot = coreFrom(
        scenario({
            player: Object.assign(clone(scenario().player), { hp: 5, maxHp: 100, iframe: 0 }),
            bullets: [[2, 0, 20, 0, -200, 0, 10, 7, 0, 2, 20, 0, 0, 0, 0]],
        })
    );
    runSeconds(shot, 0.2);
    const s2 = shot.getRunSummary();
    assert(shot.getSnapshot().phase === 'defeat', '远程弹应导致阵亡');
    assert(s2.lastHitSource === 'bullet', `致命来源应为 bullet，实际 ${s2.lastHitSource}`);
    assert(s2.lastHitDamage === 10, `致命伤害应为 10，实际 ${s2.lastHitDamage}`);
});

// ==================== 汇总 ====================

console.log('');
if (failures.length === 0) {
    console.log(`全部通过：${passed} 项检查。`);
    process.exit(0);
} else {
    console.log(`失败 ${failures.length} 项，通过 ${passed} 项：`);
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
    process.exit(1);
}
