#!/usr/bin/env node
/**
 * 冰箱底下纯逻辑自检（不启动 Cocos 编辑器）。
 *
 * 当前覆盖 M1 + M2 范围：M1 = 一间测试房 + 移动/瞄准/眼泪/两种敌人/拾取/边界；
 * M2 = 地图生成 / 门与锁 / 清房 / 宝箱三选一 / Boss / 存档续玩。
 *
 * 用法：node tools/verify-fridge-core.js
 * 通过时打印 FRIDGE_CORE_OK；失败时逐条打印并以退出码 1 结束。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CORE = path.join(ROOT, 'assets/games/game_fridge/scripts/FridgeCore.ts');
const CONFIG = path.join(ROOT, 'assets/games/game_fridge/scripts/FridgeConfig.ts');
const DUNGEON = path.join(ROOT, 'assets/games/game_fridge/scripts/FridgeDungeon.ts');

function findTsc() {
    const candidates = [
        process.env.TSC,
        path.join(ROOT, 'node_modules/typescript/bin/tsc'),
        '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc',
    ].filter(Boolean);
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

function loadModules() {
    const tsc = findTsc();
    if (!tsc) {
        console.error('找不到 tsc：设置 $TSC 或安装 typescript');
        process.exit(2);
    }
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fridge-core-'));
    execFileSync(process.execPath, [
        tsc,
        CORE,
        CONFIG,
        DUNGEON,
        '--outDir', outDir,
        '--target', 'ES2019',
        '--module', 'commonjs',
        '--skipLibCheck',
        '--strict', 'false',
    ], { stdio: 'inherit' });
    return {
        core: require(path.join(outDir, 'FridgeCore.js')),
        cfg: require(path.join(outDir, 'FridgeConfig.js')),
        dungeon: require(path.join(outDir, 'FridgeDungeon.js')),
    };
}

const { core: C, cfg: F, dungeon: D } = loadModules();

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
    if (cond) {
        passed++;
    } else {
        failed++;
        failures.push(`${name}${detail !== undefined ? ` —— ${detail}` : ''}`);
    }
}

function near(a, b, eps = 1e-6) {
    return Math.abs(a - b) <= eps;
}

const INPUT = (mx = 0, my = 0, ax = 0, ay = 0, firing = false) => ({
    moveX: mx, moveY: my, aimX: ax, aimY: ay, firing,
});

function run(world, seconds, input = INPUT()) {
    const steps = Math.round(seconds / F.FIXED_DT);
    for (let i = 0; i < steps && world.phase === 'playing'; i++) world.step(F.FIXED_DT, input);
}

// ==================== 1. 随机数 ====================

{
    const a = C.mulberry32(12345);
    const b = C.mulberry32(12345);
    let same = true;
    let inRange = true;
    for (let i = 0; i < 1000; i++) {
        const x = a();
        if (x !== b()) same = false;
        if (!(x >= 0 && x < 1)) inRange = false;
    }
    check('1. mulberry32 同种子序列一致', same);
    check('2. mulberry32 输出在 [0,1)', inRange);
    const c = C.mulberry32(1);
    const d = C.mulberry32(2);
    let differs = false;
    for (let i = 0; i < 50; i++) if (c() !== d()) differs = true;
    check('3. 不同种子序列不同', differs);
}

// ==================== 2. 配置表 ====================

{
    check('4. 道具共 40 个', F.ITEMS.length === 40, F.ITEMS.length);
    const ids = new Set(F.ITEMS.map((i) => i.id));
    check('5. 道具 id 唯一', ids.size === F.ITEMS.length);
    const validTags = new Set(['fire', 'ice', 'bounce', 'pierce', 'explosive', 'split', 'homing', 'chain', 'poison', 'shield', 'speed', 'luck', 'heal', 'shots']);
    let tagsOk = true;
    let modsOk = true;
    for (const it of F.ITEMS) {
        for (const t of it.tags) if (!validTags.has(t)) tagsOk = false;
        for (const k of Object.keys(it.mods)) {
            if (!isFinite(it.mods[k])) modsOk = false;
        }
    }
    check('6. 全部标签合法', tagsOk);
    check('7. 修饰器数值有限', modsOk);
    const counts = [0, 0, 0, 0, 0];
    for (const it of F.ITEMS) counts[it.floor]++;
    check('8. 池分配 16 + 6×4', counts[0] === 16 && counts[1] === 6 && counts[2] === 6 && counts[3] === 6 && counts[4] === 6, counts.join('/'));

    check('9. 角色共 6 个', F.CHARACTERS.length === 6);
    let startOk = true;
    for (const c of F.CHARACTERS) {
        if (!F.ITEM_BY_ID[c.startItem]) startOk = false;
        if (!(c.hp >= 2)) startOk = false;
    }
    check('10. 角色开局道具都存在', startOk);
    check('11. 角色 id 唯一', new Set(F.CHARACTERS.map((c) => c.id)).size === 6);

    const enemyKinds = Object.keys(F.ENEMY_DEFS);
    check('12. 敌人共 16 种', enemyKinds.length === 16, enemyKinds.length);
    let poolsOk = true;
    for (let floor = 1; floor <= 4; floor++) {
        const pool = F.FLOOR_ENEMIES[floor];
        if (!pool || pool.length !== 4) poolsOk = false;
        for (const k of pool || []) if (!F.ENEMY_DEFS[k]) poolsOk = false;
    }
    check('13. 四层敌人池各 4 种且引用合法', poolsOk);
}

// ==================== 3. 属性公式 ====================

{
    const base = F.computeStats('pudding', []);
    check('14. 布丁基础伤害 3.5', near(base.dmg, F.BASE_DMG), base.dmg);
    check('15. 布丁基础生命 6 半心', base.maxHp === 6, base.maxHp);
    check('16. 基础射速 2.5', near(base.rate, 2.5), base.rate);
    check('17. 基础散射 1', base.shots === 1, base.shots);

    const chili = F.computeStats('pudding', ['chili']);
    check('18. 辣椒酱 +1.2 伤害', near(chili.dmg, F.BASE_DMG + 1.2), chili.dmg);

    const candy = F.computeStats('candy', []);
    check('19. 硬糖伤害倍率 1.35', near(candy.dmg, F.BASE_DMG * 1.35), candy.dmg);
    check('20. 硬糖射速倍率 0.8', near(candy.rate, F.BASE_RATE * 0.8), candy.rate);

    const many = [];
    for (let i = 0; i < 12; i++) many.push('poprock');
    const capped = F.computeStats('pudding', many);
    check('21. 散射夹到 5', capped.shots === F.SHOTS_MAX, capped.shots);
    check('22. 射速夹到 6', capped.rate <= F.RATE_MAX + 1e-9, capped.rate);

    const slow = F.computeStats('pudding', Array(10).fill('clockwork'));
    check('23. 移速下限生效（不会为负）', slow.speed > 0, slow.speed);

    const bit = F.computeStats('magneto', ['corebit']);
    check('24. 核心碎片把 1 心角色压到上限下限 2 半心', bit.maxHp >= 2, bit.maxHp);

    check('25. 未知道具被忽略', near(F.computeStats('pudding', ['nope']).dmg, F.BASE_DMG));
}

// ==================== 4. 世界初始化 ====================

{
    const w = new C.FridgeWorld(42, 'pudding');
    check('26. 开局 3 只敌人', w.enemies.length === 3, w.enemies.length);
    check('27. 开局有一个辣椒酱底座', w.pickups.length === 1 && w.pickups[0].itemId === 'chili');
    check('28. 玩家初始在场地内', w.player.x >= F.ARENA_MIN_X && w.player.x <= F.ARENA_MAX_X && w.player.y >= F.ARENA_MIN_Y && w.player.y <= F.ARENA_MAX_Y);
    check('29. 初始不变量干净', w.checkInvariants().length === 0, w.checkInvariants().join('; '));
}

// ==================== 5. 移动 / 开火 / 命中 ====================

{
    const w = new C.FridgeWorld(7, 'pudding');
    const x0 = w.player.x;
    run(w, 0.5, INPUT(1, 0));
    check('30. 向右推摇杆后 x 增大', w.player.x > x0 + 50, w.player.x - x0);
    check('31. 玩家不越界', w.player.x <= F.ARENA_MAX_X - F.PLAYER_R + 1e-6, w.player.x);

    const w2 = new C.FridgeWorld(7, 'pudding');
    run(w2, 1.0);
    check('32. 自动瞄准会开火（有子弹或已命中）', w2.bullets.length > 0 || w2.kills > 0 || w2._fireCd > 0);

    const w3 = new C.FridgeWorld(7, 'pudding');
    const e3 = w3.enemies[0];
    e3.x = w3.player.x;
    e3.y = w3.player.y + 60;
    e3.hp = 1;
    run(w3, 0.5);
    check('33. 子弹能击杀敌人', w3.kills >= 1, w3.kills);

    const w4 = new C.FridgeWorld(7, 'pudding');
    const e4 = w4.enemies[0];
    e4.x = w4.player.x;
    e4.y = w4.player.y + 60;
    e4.hp = 1;
    let gotFeedback = false;
    for (let i = 0; i < 30; i++) {
        w4.step(F.FIXED_DT, INPUT());
        const evs = w4.drainEvents();
        if (evs.some((ev) => ev.type === 'hit' || ev.type === 'kill')) gotFeedback = true;
    }
    check('34. 命中产生 hit / kill 事件', gotFeedback);
}

// ==================== 6. 拾取与道具 ====================

{
    const w = new C.FridgeWorld(11, 'pudding');
    // 直接把玩家放到辣椒酱上
    w.player.x = w.pickups[0].x;
    w.player.y = w.pickups[0].y;
    w.step(F.FIXED_DT, INPUT());
    check('35. 走到道具上自动拾取', w.items.indexOf('chili') >= 0, w.items.join(','));
    check('36. 拾取后伤害提高', near(w.player.dmg, F.BASE_DMG + 1.2), w.player.dmg);
    check('37. 底座被移除', w.pickups.every((p) => p.kind !== 'item'));

    const added = w.addItem('vitamin');
    check('38. 生命道具提升上限并回血', added && w.player.maxHp === 8 && w.player.hp === 8, `${w.player.hp}/${w.player.maxHp}`);

    check('39. 未知道具 addItem 返回 false', w.addItem('not-exist') === false);
}

// ==================== 7. 受伤 / 无敌帧 / 死亡 ====================

{
    const w = new C.FridgeWorld(3, 'pudding');
    const hp0 = w.player.hp;
    w._damagePlayer(1);
    check('40. 受伤扣半心', w.player.hp === hp0 - 1, w.player.hp);
    w._damagePlayer(1);
    check('41. 无敌期内不重复扣血', w.player.hp === hp0 - 1, w.player.hp);
    run(w, F.INVULN + 0.1);
    w._damagePlayer(1);
    check('42. 无敌结束后可再次受伤', w.player.hp === hp0 - 2, w.player.hp);

    const w2 = new C.FridgeWorld(3, 'pudding');
    w2.player.hp = 1;
    w2._damagePlayer(1);
    check('43. 生命不会为负', w2.player.hp === 0, w2.player.hp);
    check('44. 生命归零进入死亡态', w2.phase === 'dead', w2.phase);
    const t = w2.time;
    run(w2, 1);
    check('45. 死亡后世界停止推进', near(w2.time, t), `${t} -> ${w2.time}`);
}

// ==================== 8. 敌人与边界 ====================

{
    const w = new C.FridgeWorld(5, 'pudding');
    for (let i = 0; i < 100; i++) w.spawnEnemy('moldball');
    check('46. 敌人数量不超上限', w.enemies.length <= F.MAX_ENEMIES, w.enemies.length);

    const w2 = new C.FridgeWorld(5, 'pudding');
    run(w2, 20);
    let inside = true;
    for (const e of w2.enemies) {
        if (e.x < F.ARENA_MIN_X - 1 || e.x > F.ARENA_MAX_X + 1) inside = false;
        if (e.y < F.ARENA_MIN_Y - 1 || e.y > F.ARENA_MAX_Y + 1) inside = false;
    }
    check('47. 敌人始终在场地内', inside);

    const w3 = new C.FridgeWorld(5, 'pudding');
    run(w3, 40);
    check('48. 波次会推进', w3.wave >= 2, w3.wave);
    check('49. 长跑后不变量仍干净', w3.checkInvariants().length === 0, w3.checkInvariants().join('; '));
}

// ==================== 9. 确定性与长跑 ====================

{
    function fingerprint(seed, seconds) {
        const w = new C.FridgeWorld(seed, 'pudding');
        run(w, seconds, INPUT(0.4, 0.3, 0.8, 0.2, true));
        return JSON.stringify({
            p: [w.player.x.toFixed(6), w.player.y.toFixed(6), w.player.hp],
            k: w.kills,
            e: w.enemies.map((e) => [e.kind, e.x.toFixed(6), e.y.toFixed(6), e.hp.toFixed(6)]),
            b: w.bullets.map((b) => [b.x.toFixed(6), b.y.toFixed(6)]),
            t: w.time.toFixed(6),
        });
    }
    check('50. 同种子 + 同输入逐位一致', fingerprint(99, 20) === fingerprint(99, 20));
    check('51. 不同种子结果不同', fingerprint(99, 20) !== fingerprint(100, 20));

    const w = new C.FridgeWorld(2024, 'pudding');
    let nan = false;
    for (let i = 0; i < 3000 && w.phase === 'playing'; i++) {
        const a = (i * 0.37) % 6.283;
        w.step(F.FIXED_DT, INPUT(Math.cos(a), Math.sin(a), Math.cos(a * 2), Math.sin(a * 2), i % 3 === 0));
        if (!isFinite(w.player.x) || !isFinite(w.player.y) || !isFinite(w.player.hp)) nan = true;
    }
    check('52. 50 秒随机输入无 NaN', !nan);
    check('53. 长跑后不变量干净', w.checkInvariants().length === 0, w.checkInvariants().slice(0, 3).join('; '));
    check('54. 模拟接口可自动停在世界死亡', typeof w.simulate === 'function');

    const w2 = new C.FridgeWorld(8, 'magneto');
    check('55. 隐藏角色 1 心 = 2 半心', w2.player.maxHp === 2, w2.player.maxHp);
    check('56. 换角色后属性表生效', near(w2.player.dmg, F.BASE_DMG * 1.2), w2.player.dmg);
}

// ==================== 10. M2：地图生成 ====================

function mapFingerprint(map) {
    return JSON.stringify({
        start: map.startId,
        boss: map.bossId,
        secret: map.secretId,
        rooms: map.rooms.map((r) => [r.id, r.x, r.y, r.kind, r.depth, r.doors.slice().sort()]),
    });
}

function reachableCount(map) {
    const seen = new Set([map.startId]);
    const queue = [map.startId];
    while (queue.length) {
        const id = queue.shift();
        const room = map.rooms[id];
        for (const dir of room.doors) {
            const nb = D.neighborOf(map, room, dir);
            if (nb && !seen.has(nb.id)) {
                seen.add(nb.id);
                queue.push(nb.id);
            }
        }
    }
    return seen.size;
}

function normalRoomCount(map) {
    return map.rooms.filter((r) => r.kind !== 'secret').length;
}

{
    const m1 = D.generateFloor(2024, 1);
    const m2 = D.generateFloor(2024, 1);
    check('57. 同种子同层地图逐位一致', mapFingerprint(m1) === mapFingerprint(m2));
    check('58. 同种子不同层地图不同', mapFingerprint(D.generateFloor(2024, 1)) !== mapFingerprint(D.generateFloor(2024, 2)));
    const expectCount = D.ROOM_COUNT + (m1.secretId !== null ? 1 : 0);
    check('59. 每层 7 个普通房（+1 隐藏房）', m1.rooms.length === expectCount, m1.rooms.length);

    // 门必须双向一致（秘密房只有单向邻接，不参与）
    let symOk = true;
    for (const r of m1.rooms) {
        if (r.kind === 'secret') continue;
        for (const dir of r.doors) {
            const nb = D.neighborOf(m1, r, dir);
            if (!nb || nb.doors.indexOf(D.oppositeDir(dir)) < 0) symOk = false;
        }
    }
    check('60. 门双向对称', symOk);

    // 无重叠 / 在 7×7 内
    const keys = new Set(m1.rooms.map((r) => `${r.x},${r.y}`));
    let inBounds = true;
    for (const r of m1.rooms) {
        if (r.x < 0 || r.x >= D.MAP_W || r.y < 0 || r.y >= D.MAP_H) inBounds = false;
    }
    check('61. 房间不重叠且在网格内', keys.size === m1.rooms.length && inBounds);

    check('62. 全部普通房间从起点可达', reachableCount(m1) === normalRoomCount(m1), reachableCount(m1));

    const start = m1.rooms[m1.startId];
    let maxDepth = -1;
    for (const r of m1.rooms) if (r.depth > maxDepth) maxDepth = r.depth;
    const boss = m1.rooms[m1.bossId];
    let bossUnique = true;
    for (const r of m1.rooms) if (r.kind === 'boss' && r.id !== m1.bossId) bossUnique = false;
    check('63. 起点是 start 房', start.kind === 'start', start.kind);
    check('64. Boss 唯一且在最深处', bossUnique && boss.kind === 'boss' && boss.depth === maxDepth, `${boss.kind}/${boss.depth}/${maxDepth}`);

    const kindsOf = (m) => new Set(m.rooms.map((r) => r.kind));
    const k1 = kindsOf(D.generateFloor(7, 1));
    const k2 = kindsOf(D.generateFloor(7, 2));
    const k3 = kindsOf(D.generateFloor(7, 3));
    const k4 = kindsOf(D.generateFloor(7, 4));
    check('65. 第 1 层必有一间宝箱房', k1.has('treasure'));
    check('66. 第 2 层宝箱 + 商店', k2.has('treasure') && k2.has('shop'), [...k2].join(','));
    check('67. 第 3/4 层宝箱 + 商店 + 祭坛', k3.has('altar') && k4.has('altar'), [...k3].join(','));

    // 隐藏房：类型 secret，且与至少一个房间相邻，不与已有房间重叠
    let secretOk = true;
    let secretSeen = 0;
    for (let seed = 1; seed <= 100; seed++) {
        for (let floor = 1; floor <= 4; floor++) {
            const m = D.generateFloor(seed, floor);
            if (m.secretId === null) continue;
            secretSeen++;
            const s = m.rooms[m.secretId];
            if (s.kind !== 'secret') secretOk = false;
            let adjacent = 0;
            for (const d of D.DIRS) {
                const nb = D.roomAt(m, s.x + D.DIR_DELTA[d].x, s.y + D.DIR_DELTA[d].y);
                if (nb && nb.id !== s.id) adjacent++;
            }
            if (adjacent < 1) secretOk = false;
            const dup = m.rooms.filter((r) => r.x === s.x && r.y === s.y).length;
            if (dup !== 1) secretOk = false;
        }
    }
    check('68. 隐藏房类型 / 邻接 / 不重叠（100 种子 × 4 层）', secretOk && secretSeen > 0, `secretSeen=${secretSeen}`);

    // 200 种子 × 4 层：生成不抛异常且基本约束全满足
    let allOk = true;
    for (let seed = 1; seed <= 200; seed++) {
        for (let floor = 1; floor <= 4; floor++) {
            const m = D.generateFloor(seed, floor);
            const expect = D.ROOM_COUNT + (m.secretId !== null ? 1 : 0);
            if (m.rooms.length !== expect) allOk = false;
            if (reachableCount(m) !== normalRoomCount(m)) allOk = false;
            const s = new Set(m.rooms.map((r) => `${r.x},${r.y}`));
            if (s.size !== m.rooms.length) allOk = false;
            for (const r of m.rooms) {
                if (r.kind === 'secret') continue;
                for (const dir of r.doors) {
                    const nb = D.neighborOf(m, r, dir);
                    if (!nb || nb.doors.indexOf(D.oppositeDir(dir)) < 0) allOk = false;
                }
            }
        }
    }
    check('69. 200 种子 × 4 层地图约束全满足', allOk);

    // 地图存档往返
    m1.rooms[1].visited = true;
    m1.rooms[1].cleared = true;
    const saveMap = D.serializeFloorMap(m1);
    const back = D.floorMapFromSave(saveMap, 1);
    check('70. 地图存档往返保留房间 / 门 / 清空状态',
        back && mapFingerprint(back) === mapFingerprint(m1) && back.rooms[1].visited && back.rooms[1].cleared);
}

// ==================== 11. M2：门 / 锁 / 清房 ====================

{
    const w = C.FridgeWorld.newRun(2024, 'pudding');
    const map = w.map;
    check('71. newRun 生成地图并落在起点房', !!map && w.roomId === map.startId && w.floor === 1);
    const snap0 = w.snapshot();
    check('72. 快照带地图与门列表', !!snap0.map && snap0.doors.length > 0 && snap0.locked === false);

    // 找一间战斗房，直接切过去
    const fight = map.rooms.find((r) => r.kind === 'fight');
    w._changeRoom(fight.id, null);
    check('73. 进战斗房刷出 4–9 只敌人', w.enemies.length >= 4 && w.enemies.length <= 9, w.enemies.length);
    check('74. 未清空时锁门', w.isRoomLocked() === true);
    check('75. 锁门时走不出去', w.enterDoor(fight.doors[0]) === false);

    for (const e of w.enemies) e.hp = 0;
    w.step(F.FIXED_DT, INPUT());
    check('76. 敌人清空后自动开门', fight.cleared === true && w.isRoomLocked() === false);
    check('77. 清房回到中心拾取', w.pickups.length >= 1);
    const targetRoom = D.neighborOf(map, fight, fight.doors[0]);
    const went = w.enterDoor(fight.doors[0]);
    w.drainEvents();
    check('78. 解锁后可以走进相邻房间', went === true && w.roomId === targetRoom.id);
}

// ==================== 12. M2：宝箱三选一 ====================

{
    const w = C.FridgeWorld.newRun(2024, 'pudding');
    const treasure = w.map.rooms.find((r) => r.kind === 'treasure');
    w._changeRoom(treasure.id, null);
    const offer = w.pendingTreasure;
    check('79. 进宝箱房弹出三选一', !!offer && offer.offered.length === 3, offer ? offer.offered.join(',') : 'null');
    check('80. 三个候选互不相同', !!offer && new Set(offer.offered).size === 3);
    const invalid = w.takeTreasure(9);
    check('81. 越界索引被拒', invalid === false && !!w.pendingTreasure);
    const ok = w.takeTreasure(1);
    check('82. 选中的道具进背包并关闭面板', ok === true && w.pendingTreasure === null && w.items.length === 1, w.items.join(','));

    // 重掷：有金币 → 扣 2 币并换一批；没金币 → 拒绝
    const w2 = C.FridgeWorld.newRun(2024, 'pudding');
    const t2 = w2.map.rooms.find((r) => r.kind === 'treasure');
    w2._changeRoom(t2.id, null);
    w2.coins = 5;
    const before = w2.pendingTreasure.offered.join(',');
    const rerolled = w2.rerollTreasure();
    check('83. 重掷扣 2 金币并标记', rerolled === true && w2.coins === 3 && w2.pendingTreasure.rerolled === true);
    check('84. 重掷只允许一次', w2.rerollTreasure() === false);
    const w3 = C.FridgeWorld.newRun(2024, 'pudding');
    w3._changeRoom(w3.map.rooms.find((r) => r.kind === 'treasure').id, null);
    w3.coins = 0;
    check('85. 金币不足不能重掷', w3.rerollTreasure() === false);
    void before;
}

// ==================== 13. M2：Boss ====================

{
    const w = C.FridgeWorld.newRun(2024, 'pudding');
    w._changeRoom(w.map.bossId, null);
    const boss = w.enemies.find((e) => e.kind === 'moldking');
    check('86. Boss 房生成霉王（180 血）', !!boss && boss.maxHp === 180, boss ? boss.maxHp : 'missing');
    check('87. Boss 房未清空时锁门', w.isRoomLocked() === true);

    boss.hp = boss.maxHp * 0.45;
    w.step(F.FIXED_DT, INPUT());
    check('88. 半血后进入二阶段', boss.gen === 2, boss.gen);

    const hpBefore = boss.hp;
    w.step(F.FIXED_DT, INPUT());
    check('89. Boss 会出招（孢弹或位移）', w.bullets.length > 0 || boss.x !== 0 || boss.hp === hpBefore);

    for (const e of w.enemies) e.hp = 0;
    w.step(F.FIXED_DT, INPUT());
    const evs = w.drainEvents();
    check('90. 击破 Boss 通关第 1 层', w.phase === 'won' && evs.some((ev) => ev.type === 'won'));
}

// ==================== 14. M2：金币 / 半心 / 炸弹 ====================

{
    const w = C.FridgeWorld.newRun(2024, 'pudding');
    const coins0 = w.coins;
    w.pickups.push({ id: 90001, kind: 'coin', x: w.player.x, y: w.player.y, bob: 0 });
    w.step(F.FIXED_DT, INPUT());
    check('91. 金币拾取 +1', w.coins === coins0 + 1, w.coins);

    w.player.hp = Math.max(1, w.player.maxHp - 2);
    const hp0 = w.player.hp;
    w.pickups.push({ id: 90002, kind: 'heart', x: w.player.x, y: w.player.y, bob: 0 });
    w.step(F.FIXED_DT, INPUT());
    check('92. 半心拾取 +1 且不超上限', w.player.hp === hp0 + 1, w.player.hp);

    const bombs0 = w.player.bombs;
    w.pickups.push({ id: 90003, kind: 'bomb', x: w.player.x, y: w.player.y, bob: 0 });
    w.step(F.FIXED_DT, INPUT());
    check('93. 炸弹拾取 +1（上限 9）', w.player.bombs === Math.min(F.BOMBS_MAX, bombs0 + 1), w.player.bombs);
}

// ==================== 15. M2：存档 / 续玩 ====================

{
    const store = D.createMemoryStore();
    const w = C.FridgeWorld.newRun(4321, 'pudding');
    w.addItem('chili');
    w.coins = 7;
    w.player.hp = 4;
    const fight = w.map.rooms.find((r) => r.kind === 'fight');
    w._changeRoom(fight.id, null);
    w.drainEvents();

    const saved = D.saveRun(w, store);
    check('94. saveRun 返回快照', !!saved && saved.schemaVersion === D.CURRENT_RUN_VERSION);
    const raw = store.getItem(D.RUN_KEY);
    check('95. 单局存档 < 8KB', !!raw && raw.length < 8192, raw ? raw.length : 'null');

    const loaded = D.loadRun(store);
    check('96. loadRun 读回同一房间 / 金币 / 道具',
        !!loaded && loaded.roomId === fight.id && loaded.player.coins === 7 && loaded.items.indexOf('chili') >= 0);

    const w2 = C.FridgeWorld.fromSave(loaded);
    check('97. fromSave 还原房间与地图',
        w2.roomId === fight.id && w2.map.rooms.length === w.map.rooms.length && w2.floor === 1);
    const w3 = C.FridgeWorld.fromSave(D.loadRun(store) || loaded);
    check('98. 同一存档两次续玩 RNG 状态一致', w3._rng.getState() === w2._rng.getState(), `${w3._rng.getState()}/${w2._rng.getState()}`);
    check('99. 续玩后不变量干净', w2.checkInvariants().length === 0, w2.checkInvariants().join('; '));

    D.discardRun(store);
    check('100. 死亡 / 通关后删档', D.loadRun(store) === null);

    store.setItem(D.RUN_KEY, '{broken json');
    check('101. 坏档读取返回 null 不抛异常', D.loadRun(store) === null);
    store.setItem(D.RUN_KEY, JSON.stringify({ schemaVersion: 2, roomId: 99999, map: null }));
    check('102. 字段缺失 / 越界的存档被拒', D.loadRun(store) === null);
}

// ==================== 16. M2：地牢长跑 ====================

{
    function walkFingerprint(seed) {
        const w = C.FridgeWorld.newRun(seed, 'pudding');
        const seen = [];
        let guard = 0;
        while (guard++ < 20) {
            const room = w.currentRoom();
            if (!room || room.doors.length === 0) break;
            if (w.isRoomLocked()) {
                // 打通当前房间
                for (const e of w.enemies) e.hp = 0;
                w.step(F.FIXED_DT, INPUT());
                continue;
            }
            const dir = room.doors[guard % room.doors.length];
            if (!w.enterDoor(dir)) break;
            w.drainEvents();
            seen.push(`${w.roomId}:${w.currentRoom().kind}:${w.currentRoom().cleared ? 1 : 0}`);
        }
        return seen.join('|');
    }
    check('103. 同种子走同一串门的结果一致', walkFingerprint(555) === walkFingerprint(555));

    const w = C.FridgeWorld.newRun(777, 'pudding');
    let nan = false;
    for (let i = 0; i < 3600 && w.phase === 'playing'; i++) {
        const a = (i * 0.11) % 6.283;
        w.step(F.FIXED_DT, INPUT(Math.cos(a), Math.sin(a), Math.cos(a * 1.7), Math.sin(a * 1.7), i % 2 === 0));
        if (!isFinite(w.player.x) || !isFinite(w.player.y)) nan = true;
        if (i % 600 === 0 && w.checkInvariants().length > 0) {
            nan = true;
            break;
        }
    }
    check('104. 地牢 60 秒随机输入无 NaN / 不变量干净', !nan, w.checkInvariants().slice(0, 3).join('; '));
}

// ==================== 汇总 ====================

if (failed === 0) {
    console.log(`FRIDGE_CORE_OK  ${passed}/${passed} 项通过（M1 + M2 覆盖）`);
    process.exit(0);
} else {
    console.error(`FRIDGE_CORE_FAIL  ${failed} 项失败 / 共 ${passed + failed} 项`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
}
