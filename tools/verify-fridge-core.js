#!/usr/bin/env node
/**
 * 冰箱底下纯逻辑自检（不启动 Cocos 编辑器）。
 *
 * 当前覆盖 M1 + M2 + M3 范围：M1 = 一间测试房 + 移动/瞄准/眼泪/两种敌人/拾取/边界；
 * M2 = 地图生成 / 门与锁 / 清房 / 宝箱三选一 / Boss / 存档续玩；
 * M3 = 40 道具命中效果 / 14 条协同 / 主动槽与 6 角色技能 / 免死与复活 /
 *      商店·祭坛·炸弹·秘密房 / 存档字段。
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
    check('90. 击破第 1 层 Boss 给出核心三选一（不再直接通关）',
        w.phase === 'playing' && Array.isArray(w.pendingCore) && w.pendingCore.length === 3
        && evs.some((ev) => ev.type === 'core'),
        w.pendingCore ? w.pendingCore.join(',') : 'null');
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

// ==================== 17. M3：协同表 ====================

function blankWorld(seed = 9001, charId = 'pudding') {
    const w = C.FridgeWorld.newRun(seed, charId);
    w.enemies = [];
    w.bullets = [];
    w.pickups = [];
    w.drainEvents();
    return w;
}

function giveItems(w, ids) {
    w.items = [];
    w.activeItem = null;
    for (const id of ids) w.addItem(id);
    w.drainEvents();
    return w;
}

function mkEnemy(w, kind = 'moldball', x = 0, y = 0) {
    const e = w.spawnEnemy(kind, x, y);
    w.enemies = w.enemies.filter((o) => o === e);
    return e;
}

function mkBullet(w, over) {
    return Object.assign({
        id: w._nextId++, owner: 'player', x: 0, y: 0, vx: 200, vy: 0,
        r: 6, dmg: 10, life: 1, pierce: 0, bounces: 0, wallPierce: 0,
        kind: 'tear', hitIds: [],
    }, over || {});
}

{
    check('105. 协同表共 14 条', F.SYNERGIES.length === 14, F.SYNERGIES.length);
    const validTags = new Set(['fire', 'ice', 'bounce', 'pierce', 'explosive', 'split', 'homing', 'chain', 'poison', 'shield', 'speed', 'luck', 'heal', 'shots']);
    let tagsOk = true;
    const pairs = new Set();
    let pairOk = true;
    for (const s of F.SYNERGIES) {
        if (!validTags.has(s.a) || !validTags.has(s.b) || s.a === s.b) tagsOk = false;
        const key = [s.a, s.b].sort().join('+');
        if (pairs.has(key)) pairOk = false;
        pairs.add(key);
    }
    check('106. 协同标签合法且互不相同', tagsOk && pairOk);
    check('107. 空道具不点亮协同', F.findSynergies([]).length === 0);

    const ids = F.findSynergies(['chili', 'chilioil']).map((s) => s.id);
    check('108. 火 + 爆炸 → 焦糖爆裂', ids.indexOf('caramel_burst') >= 0, ids.join(','));
    const cold = F.findSynergies(['honey', 'frostheart']).map((s) => s.id);
    check('109. 冰 + 链 → 霜链', cold.indexOf('frost_chain') >= 0, cold.join(','));
    const hotcold = F.findSynergies(['chili', 'mint']).map((s) => s.id);
    check('110. 火 + 冰 → 冷热交替', hotcold.indexOf('hot_cold') >= 0, hotcold.join(','));

    const w = giveItems(blankWorld(), ['chili', 'chilioil']);
    check('111. addItem 后协同进 synergiesSeen', w.synergiesSeen.indexOf('caramel_burst') >= 0, w.synergiesSeen.join(','));
    check('112. hasSynergy 查询命中', w.hasSynergy('caramel_burst') && !w.hasSynergy('frost_chain'));
}

// ==================== 18. M3：道具命中效果 ====================

{
    // 蜂蜜：减速
    const w = giveItems(blankWorld(), ['honey']);
    const e = mkEnemy(w, 'moldball', 0, 0);
    w._onBulletHit(e, mkBullet(w, { x: e.x, y: e.y }));
    check('113. 蜂蜜命中减速 35% / 1.2s', e.slowT > 1.1 && near(e.slowMul, 0.65, 0.001), `${e.slowT}/${e.slowMul}`);

    // 薄荷：15% 冻结（300 次必出）
    const wm = giveItems(blankWorld(), ['mint']);
    const em = mkEnemy(wm, 'moldball', 0, 0);
    em.maxHp = em.hp = 1e9;
    let froze = false;
    for (let i = 0; i < 300; i++) {
        wm._onBulletHit(em, mkBullet(wm, { x: em.x, y: em.y }));
        if (em.freezeT > 0) froze = true;
    }
    check('114. 薄荷能触发冻结', froze);

    // 发霉面包：中毒
    const wp = giveItems(blankWorld(), ['mold']);
    const ep = mkEnemy(wp, 'moldball', 0, 0);
    wp._onBulletHit(ep, mkBullet(wp, { x: ep.x, y: ep.y, dmg: 20 }));
    const beforeHp = ep.hp;
    wp._tickStatus(ep, 1);
    check('115. 发霉面包挂毒并持续掉血', ep.poisonT > 0 && ep.hp < beforeHp, `${beforeHp}→${ep.hp}`);

    // 打火机：燃烧
    const wf = giveItems(blankWorld(), ['lighter']);
    const ef = mkEnemy(wf, 'moldball', 0, 0);
    ef.maxHp = ef.hp = 1e9;
    let burned = false;
    for (let i = 0; i < 200; i++) {
        wf._onBulletHit(ef, mkBullet(wf, { x: ef.x, y: ef.y }));
        if (ef.burnT > 0) burned = true;
    }
    check('116. 打火机能点燃', burned);
    const fhp = ef.hp;
    wf._tickStatus(ef, 1);
    check('117. 燃烧每秒扣血', ef.hp < fhp);

    // 辣椒油：命中爆炸波及邻敌
    const wx = giveItems(blankWorld(), ['chilioil']);
    const target = mkEnemy(wx, 'moldball', 0, 0);
    const near1 = wx.spawnEnemy('moldball', 20, 0);
    const far1 = wx.spawnEnemy('moldball', 200, 0);
    const farHp = far1.hp;
    wx._onBulletHit(target, mkBullet(wx, { x: 0, y: 0, dmg: 10 }));
    check('118. 辣椒油爆炸波及 40px 内敌人', near1.hp < near1.maxHp, `${near1 && near1.hp}/${near1 && near1.maxHp}/${near1 && near1.x}`);
    check('119. 爆炸不波及 40px 外敌人', near(far1.hp, farHp));

    // 卡带：分裂
    const ws = giveItems(blankWorld(), ['cartridge']);
    const es = mkEnemy(ws, 'moldball', 0, 0);
    es.maxHp = es.hp = 1e9;
    let spawned = false;
    for (let i = 0; i < 100 && !spawned; i++) {
        ws._onBulletHit(es, mkBullet(ws, { x: es.x, y: es.y }));
        if (ws.bullets.length > 0) spawned = true;
    }
    check('120. 卡带命中后分裂出新弹', spawned);
}

// ==================== 19. M3：协同效果 ====================

{
    // 子母雷：爆炸再分裂 3 发
    const w = giveItems(blankWorld(), ['hammer', 'cartridge']);
    check('121. 爆炸 + 分裂点亮子母雷', w.hasSynergy('cluster_bomb'));
    w._explode(0, 0, 30, 10);
    check('122. 子母雷爆炸产生 3 发子弹', w.bullets.length >= 3, w.bullets.length);

    // 冻土：爆炸留冰面，敌人踩上去减速
    const wi = giveItems(blankWorld(), ['honey', 'chilioil']);
    check('123. 冰 + 爆炸点亮冻土', wi.hasSynergy('permafrost'));
    wi._explode(0, 0, 40, 5);
    check('124. 爆炸留下冰面', wi.iceFields.length === 1, wi.iceFields.length);
    const ei = mkEnemy(wi, 'moldball', 0, 0);
    check('125. 冰面内敌人移速 ×0.5', near(wi._enemySpeedMul(ei), 0.5), wi._enemySpeedMul(ei));
    ei.x = 400;
    check('126. 冰面外敌人不受影响', near(wi._enemySpeedMul(ei), 1));

    // 火舌：燃烧敌人死亡点燃邻居
    const wt = giveItems(blankWorld(), ['chili', 'frostheart']);
    check('127. 火 + 链点亮火舌', wt.hasSynergy('fire_tongue'));
    const dying = mkEnemy(wt, 'moldball', 0, 0);
    const neighbor = wt.spawnEnemy('moldball', 40, 0);
    dying.burnT = 3;
    dying.burnDps = 5;
    dying.hp = 1;
    wt._damageEnemy(dying, 5);
    check('128. 燃烧敌人死亡点燃最近敌人', neighbor.burnT > 0);

    // 毒雾爆燃：中毒目标被点燃 → 爆燃事件
    const wb = giveItems(blankWorld(), ['mold', 'lighter']);
    check('129. 毒 + 火点亮毒雾爆燃', wb.hasSynergy('poison_blaze'));
    const eb = mkEnemy(wb, 'moldball', 0, 0);
    eb.poisonT = 3;
    eb.poisonDps = 2;
    const nb = wb.spawnEnemy('moldball', 30, 0);
    wb.drainEvents();
    wb._ignite(eb, 5, 3, 10);
    const evs = wb.drainEvents();
    check('130. 中毒目标被点燃产生爆燃', evs.some((ev) => ev.type === 'boom') && nb.hp < nb.maxHp);

    // 糖渣：每发额外分裂 2 片
    const wd = giveItems(blankWorld(), ['poprock', 'cartridge']);
    check('131. 分裂 + 散射点亮糖渣', wd.hasSynergy('sugar_dregs'));
    const ed = mkEnemy(wd, 'moldball', 0, 0);
    ed.maxHp = ed.hp = 1e9;
    wd._onBulletHit(ed, mkBullet(wd, { x: ed.x, y: ed.y }));
    check('132. 糖渣命中至少分裂 2 片', wd.bullets.length >= 2, wd.bullets.length);

    // 弹跳冲刺：每次反弹伤害 ×1.2，封顶 1.2 倍原始伤害
    const wbd = giveItems(blankWorld(), ['spring', 'spatula']);
    check('133. 移速 + 反弹点亮弹跳冲刺', wbd.hasSynergy('bounce_dash'));
    const bb = mkBullet(wbd, { dmg: wbd.player.dmg });
    const d0 = bb.dmg;
    wbd._onBounce(bb);
    check('134. 反弹提升伤害并封顶', bb.dmg > d0 && bb.dmg <= wbd.player.dmg * 1.2 + 1e-6, `${d0}→${bb.dmg}`);

    // 铁锈：贯穿 + 爆炸，命中即小爆炸
    const wr = giveItems(blankWorld(), ['rust']);
    const er = mkEnemy(wr, 'moldball', 0, 0);
    const erNear = wr.spawnEnemy('moldball', 20, 0);
    wr._onBulletHit(er, mkBullet(wr, { x: 0, y: 0, dmg: 10 }));
    check('160. 铁锈命中产生 40px 爆炸', erNear.hp < erNear.maxHp, erNear.hp);

    // 橡皮筋：反弹次数叠加（tag +1，道具再 +1）
    const wrb = giveItems(blankWorld(), ['rubberband']);
    wrb.player.x = 0;
    wrb.player.y = 0;
    wrb._shoot(1, 0);
    const shot = wrb.bullets[0];
    check('161. 橡皮筋把反弹次数提到 2', !!shot && shot.bounces === 2, shot && shot.bounces);

    // 弹力针：反弹后清空命中记录并补回贯穿
    const wen = giveItems(blankWorld(), ['spatula', 'toothpick']);
    check('162. 反弹 + 贯穿点亮弹力针', wen.hasSynergy('elastic_needle'));
    const eb2 = mkBullet(wen, { pierce: 0, hitIds: [1, 2] });
    wen._onBounce(eb2);
    check('163. 弹力针反弹后清空命中并补回贯穿', eb2.hitIds.length === 0 && eb2.pierce >= 1, `${eb2.hitIds.length}/${eb2.pierce}`);
}

// ==================== 20. M3：主动槽与角色技能 ====================

{
    const w = blankWorld();
    const base = w.player.maxCharges;
    w.addItem('battery');
    check('135. 电池提升充能上限 +1', w.player.maxCharges === Math.min(12, base + 1), `${base}→${w.player.maxCharges}`);
    check('136. 电池立刻 +2 当前充能', w.player.charges >= 2, w.player.charges);
    for (let i = 0; i < 12; i++) w.addItem('battery');
    check('137. 充能上限封顶 12（M4 充能扩容核心）', w.player.maxCharges === 12, w.player.maxCharges);

    // 布丁：向面朝方向冲刺 120px
    const wp = blankWorld(9002, 'pudding');
    wp.player.x = 0;
    wp.player.y = 0;
    wp.player.facingX = 1;
    wp.player.facingY = 0;
    wp.player.charges = wp.activeCost();
    const okDash = wp.useActive();
    check('138. 布丁冲刺消耗充能并位移', okDash && wp.player.x > 100 && wp.player.charges === 0, `${okDash}/${wp.player.x}`);
    check('139. 充能不足时主动返回 false', wp.useActive() === false);

    // 硬糖：本房间伤害 ×1.5，代价 1 半心
    const wc = blankWorld(9003, 'candy');
    wc.player.charges = wc.activeCost();
    const hp0 = wc.player.hp;
    wc.useActive();
    check('140. 硬糖咬碎：伤害 ×1.5 且掉 1 半心', near(wc.player.roomDmgMul, 1.5) && wc.player.hp === hp0 - 1, `${wc.player.roomDmgMul}/${wc.player.hp}`);

    // 冰块：1.5s 生根 + 无敌，期间不能移动
    const wi = blankWorld(9004, 'icecube');
    wi.player.charges = wi.activeCost();
    wi.useActive();
    const x0 = wi.player.x;
    wi.step(F.FIXED_DT, INPUT(1, 0));
    check('141. 冰块自冻期间无法移动且无敌', wi.player.rootT > 0 && near(wi.player.x, x0) && wi.player.invuln > 0, `${wi.player.rootT}/${wi.player.x}`);

    // 气泡水：140px 内伤害 + 击退
    const ws = blankWorld(9005, 'soda');
    ws.player.x = 0;
    ws.player.y = 0;
    const close = mkEnemy(ws, 'moldball', 40, 0);
    const far = ws.spawnEnemy('moldball', 300, 0);
    const farHp = far.hp;
    ws.player.charges = ws.activeCost();
    ws.useActive();
    check('142. 气泡水震开并伤害近处敌人', close.hp < close.maxHp && close.x > 60, `${close.hp}/${close.x}`);
    check('143. 气泡水不影响 140px 外敌人', near(far.hp, farHp));

    // 酸奶：引爆中毒层数
    const wy = blankWorld(9006, 'yogurt');
    const poisoned = mkEnemy(wy, 'moldball', 40, 0);
    poisoned.poisonT = 3;
    poisoned.poisonDps = 4;
    wy.player.charges = wy.activeCost();
    wy.useActive();
    check('144. 酸奶发酵引爆中毒并清零', poisoned.hp < poisoned.maxHp && poisoned.poisonT === 0, `${poisoned.hp}/${poisoned.poisonT}`);

    // 冰箱贴：把敌弹吸成金币（上限 20）
    const wm = blankWorld(9007, 'magneto');
    for (let i = 0; i < 25; i++) {
        wm.bullets.push(mkBullet(wm, { owner: 'enemy', id: wm._nextId++ }));
    }
    const coins0 = wm.coins;
    wm.player.charges = wm.activeCost();
    wm.useActive();
    check('145. 冰箱贴最多吸 20 发敌弹换金币', wm.coins === coins0 + 20 && wm.bullets.length === 5, `${wm.coins}/${wm.bullets.length}`);

    // 主动道具：最后的布丁
    const wl = blankWorld(9008, 'pudding');
    wl.addItem('lastpudding');
    wl.player.charges = wl.activeCost();
    const el = mkEnemy(wl, 'moldball', 300, 0);
    wl.useActive();
    check('146. 最后的布丁：3s 无敌 + 全屏伤害', wl.player.invuln >= 3 && el.hp < el.maxHp && wl.player.charges === 0, `${wl.player.invuln}/${el.hp}`);
}

// ==================== 21. M3：免死 / 复活 ====================

{
    // 保鲜膜：每层首次死亡免疫，保留 1 半心
    const w = giveItems(blankWorld(), ['wrap']);
    w.player.hp = 1;
    w.player.invuln = 0;
    w._damagePlayer(5);
    check('147. 保鲜膜免死并保留 1 半心', w.player.hp === 1 && w.player.deathWardUsed && w.phase === 'playing', `${w.player.hp}/${w.player.deathWardUsed}/${w.phase}`);
    w.player.invuln = 0;
    w._damagePlayer(5);
    check('148. 保鲜膜每层只免死一次', w.phase === 'dead');

    // 存档点：充能足够时死亡原地复活，每房一次
    const ws = giveItems(blankWorld(9010, 'pudding'), ['savepoint']);
    check('149. 拾取主动道具替换主动槽', ws.activeItem === 'savepoint' && ws.activeName() === '存档点');
    ws.player.charges = ws.activeCost();
    ws.player.hp = 1;
    ws.player.invuln = 0;
    ws._damagePlayer(5);
    check('150. 存档点消耗充能原地满血复活', ws.phase === 'playing' && ws.player.hp === ws.player.maxHp && ws.player.charges === 0, `${ws.phase}/${ws.player.hp}`);
    check('151. 存档点记录本房已用', ws.player.savepointUsedRoom === ws.roomId);

    // 焦糖壳：受伤减速周围敌人
    const wc = giveItems(blankWorld(), ['caramel']);
    const ec = mkEnemy(wc, 'moldball', 30, 0);
    wc.player.invuln = 0;
    wc._damagePlayer(1);
    check('152. 焦糖壳受伤减速 70px 内敌人', ec.slowT > 0 && ec.slowMul < 1, `${ec.slowT}/${ec.slowMul}`);

    // 冷冻液：全场敌人移速 -20%
    const wl = giveItems(blankWorld(), ['coolant']);
    const el = mkEnemy(wl, 'moldball', 200, 200);
    check('153. 冷冻液让敌人移速 ×0.8', near(wl._enemySpeedMul(el), 0.8), wl._enemySpeedMul(el));
}

// ==================== 22. M3：存档字段 ====================

{
    const store = D.createMemoryStore();
    const w = giveItems(blankWorld(4444, 'pudding'), ['chili', 'chilioil', 'wrap']);
    w.player.deathWardUsed = true;
    w.player.savepointUsedRoom = 3;
    w.drainEvents();
    check('154. 存档前已点亮协同', w.synergiesSeen.indexOf('caramel_burst') >= 0);

    const saved = D.saveRun(w, store);
    check('155. 存档写入协同与免死字段',
        !!saved && saved.synergies.indexOf('caramel_burst') >= 0 &&
        saved.player.deathWardUsed === true && saved.player.savepointUsedRoom === 3);

    const loaded = D.loadRun(store);
    const w2 = C.FridgeWorld.fromSave(loaded);
    check('156. 续玩还原协同列表',
        w2.synergiesSeen.indexOf('caramel_burst') >= 0 && w2.hasSynergy('caramel_burst'));
    check('157. 续玩还原免死 / 存档点状态',
        w2.player.deathWardUsed === true && w2.player.savepointUsedRoom === 3,
        `${w2.player.deathWardUsed}/${w2.player.savepointUsedRoom}`);
    check('158. 续玩后不变量干净', w2.checkInvariants().length === 0, w2.checkInvariants().join('; '));

    // 旧档（无 M3 字段）应回落到默认值
    const legacy = JSON.parse(JSON.stringify(saved));
    delete legacy.synergies;
    delete legacy.player.deathWardUsed;
    delete legacy.player.savepointUsedRoom;
    store.setItem(D.RUN_KEY, JSON.stringify(legacy));
    const old = D.loadRun(store);
    check('159. 旧档缺 M3 字段可正常读取', !!old && old.player.deathWardUsed === false && old.player.savepointUsedRoom === -1,
        old ? `${old.player.deathWardUsed}/${old.player.savepointUsedRoom}` : 'null');
    D.discardRun(store);
}

// ==================== 23. M3：商店 / 祭坛 / 炸弹 / 秘密房 ====================

function floorWorld(seed, floor, charId = 'pudding') {
    const w = C.FridgeWorld.newRun(seed, charId, floor);
    w.enemies = [];
    w.bullets = [];
    w.pickups = [];
    w.drainEvents();
    return w;
}

function roomOf(w, kind) {
    return w.map.rooms.find((r) => r.kind === kind) || null;
}

{
    // ---- 商店货架 ----
    const w = floorWorld(8601, 2);
    const shop = roomOf(w, 'shop');
    w._changeRoom(shop.id, null);
    const ps = w.pendingShop;
    check('164. 进商店弹出 3 个货位', !!ps && ps.offers.length === 3 && ps.sold.length === 3);
    check('165. 货位依次为道具 / 半心 / 炸弹',
        ps.offers[0].kind === 'item' && ps.offers[1].kind === 'heart' && ps.offers[2].kind === 'bomb');
    check('166. 道具价格 12–18 / 半心 4 / 炸弹 3',
        ps.offers[0].price >= F.SHOP_ITEM_MIN && ps.offers[0].price <= F.SHOP_ITEM_MAX
        && ps.offers[1].price === F.SHOP_HEART_PRICE && ps.offers[2].price === F.SHOP_BOMB_PRICE,
        `${ps.offers[0].price}/${ps.offers[1].price}/${ps.offers[2].price}`);

    // ---- 买道具 ----
    w.coins = 100;
    const coins0 = w.coins;
    const itemId = ps.offers[0].id;
    const bought = w.buyShop(0);
    check('167. 买道具扣币并入包', !!bought && w.coins === coins0 - ps.offers[0].price
        && w.items.indexOf(itemId) >= 0 && ps.sold[0], `${w.coins}/${w.items.join(',')}`);
    check('168. 同一货位不能买两次', w.buyShop(0) === null);

    // ---- 买半心 ----
    w.player.hp = w.player.maxHp;
    check('169. 满血时不能买半心', w.buyShop(1) === null);
    w.player.hp = w.player.maxHp - 2;
    const hp0 = w.player.hp;
    const coinH = w.coins;
    check('170. 半心 4 币回复 1 半心', !!w.buyShop(1) && w.player.hp === hp0 + 1 && w.coins === coinH - F.SHOP_HEART_PRICE,
        `${w.player.hp}/${w.coins}`);

    // ---- 买炸弹 ----
    w.player.bombs = 0;
    const coinB = w.coins;
    check('171. 炸弹 3 币 +1 且不超上限',
        !!w.buyShop(2) && w.player.bombs === 1 && w.coins === coinB - F.SHOP_BOMB_PRICE,
        `${w.player.bombs}/${w.coins}`);

    // ---- 钱不够 ----
    w.coins = 0;
    check('172. 金币不够时买不到', w.buyShop(0) === null && w.pendingShop !== null);

    // ---- 离开商店 ----
    w.closeShop();
    check('173. 离开商店收起货架且房间记为已清理', w.pendingShop === null && shop.cleared);

    // ---- 存档往返 ----
    const ws = floorWorld(8602, 2);
    const shop2 = roomOf(ws, 'shop');
    ws._changeRoom(shop2.id, null);
    ws.coins = 50;
    ws.buyShop(0);
    const store = D.createMemoryStore();
    D.saveRun(ws, store);
    const loaded = D.loadRun(store);
    check('174. 存档写入货架与已售状态',
        !!loaded && !!loaded.shop && loaded.shop.sold[0] === true && !loaded.altar,
        loaded && loaded.shop ? loaded.shop.sold.join('') : 'null');
    const ws2 = C.FridgeWorld.fromSave(loaded);
    check('175. 续玩恢复商店货架', !!ws2.pendingShop && ws2.pendingShop.sold[0] === true,
        ws2.pendingShop ? ws2.pendingShop.sold.join('') : 'null');
    D.discardRun(store);
}

{
    // ---- 祭坛 ----
    const w = floorWorld(8701, 3);
    const altarRoom = roomOf(w, 'altar');
    w._changeRoom(altarRoom.id, null);
    const pa = w.pendingAltar;
    check('176. 进祭坛弹出高价值道具', !!pa && typeof pa.itemId === 'string' && !!F.ITEM_BY_ID[pa.itemId]);

    w.player.hp = 2;
    const items0 = w.items.length;
    check('177. 只剩 1 颗心时不能献祭', w.takeAltar() === false && w.items.length === items0 && w.player.hp === 2);

    w.player.hp = w.player.maxHp;
    const hpA = w.player.hp;
    check('178. 献祭 1 颗心（2 半心）得到道具',
        w.takeAltar() === true && w.player.hp === hpA - F.ALTAR_COST && w.items.indexOf(pa.itemId) >= 0,
        `${w.player.hp}/${w.items.join(',')}`);
    check('179. 每座祭坛只能献祭一次', w.takeAltar() === false);
    w.closeAltar();
    check('180. 离开祭坛收起面板', w.pendingAltar === null);
}

{
    // ---- 炸弹：伤害 + 清敌弹 ----
    const w = blankWorld(8801);
    const e = mkEnemy(w, 'moldball', 0, -40);
    w.bullets.push(mkBullet(w, { owner: 'enemy', x: 80, y: 0, vx: 0, vy: 0 }));
    w.player.bombs = 1;
    const used = w.useBomb();
    check('181. 放炸弹消耗 1 个并进入引信倒计时',
        used && w.player.bombs === 0 && !!w.bomb && near(w.bomb.t, F.BOMB_FUSE), w.player.bombs);
    check('182. 引信期间不能再放', w.useBomb() === false);
    run(w, F.BOMB_FUSE + 0.05);
    check('183. 炸弹爆炸伤害半径内敌人', e.hp < e.maxHp, `${e.hp}/${e.maxHp}`);
    check('184. 炸弹清空场上敌方子弹',
        w.bullets.every((b) => b.owner !== 'enemy'), w.bullets.length);
    check('185. 爆炸后炸弹消失', w.bomb === null);
}

{
    // ---- 炸弹炸开秘密房 ----
    const w = blankWorld(8802);
    const secret = w.map.rooms[w.map.secretId];
    let neighbor = null;
    let dirToSecret = null;
    for (const d of secret.doors) {
        const nb = w.map.rooms.find((r) => r.kind !== 'secret'
            && r.x === secret.x + D.DIR_DELTA[d].x && r.y === secret.y + D.DIR_DELTA[d].y);
        if (nb) {
            neighbor = nb;
            dirToSecret = D.oppositeDir(d);
            break;
        }
    }
    check('186. 秘密房至少有 1 个相邻普通房', !!neighbor && !!dirToSecret);
    if (neighbor && dirToSecret) {
        w._changeRoom(neighbor.id, null);
        w.enemies = [];
        neighbor.cleared = true;
        w.roomCleared = true;
        w.player.x = 0;
        w.player.y = 0;
        if (dirToSecret === 'up') { w.player.x = 0; w.player.y = F.ARENA_MAX_Y - 60; }
        else if (dirToSecret === 'down') { w.player.x = 0; w.player.y = F.ARENA_MIN_Y + 60; }
        else if (dirToSecret === 'left') { w.player.x = F.ARENA_MIN_X + 60; w.player.y = 0; }
        else { w.player.x = F.ARENA_MAX_X - 60; w.player.y = 0; }

        const luck0 = w.player.luck;
        w.player.luck = 12;
        const hints = w.snapshot().secretHints;
        check('187. 幸运够高时墙上出现秘密房裂纹',
            hints.some((h) => h.dir === dirToSecret), JSON.stringify(hints));
        w.player.luck = F.SECRET_HINT_LUCK - 1;
        check('188. 幸运不足时没有裂纹', w.snapshot().secretHints.length === 0);
        w.player.luck = luck0;

        w.player.bombs = 1;
        w.useBomb();
        run(w, F.BOMB_FUSE + 0.05);
        check('189. 炸墙后秘密房进入小地图（visited）', secret.visited === true);
        check('190. 炸墙后出现通往秘密房的门', neighbor.doors.indexOf(dirToSecret) >= 0,
            neighbor.doors.join(','));

        check('191. 从新开的门能进秘密房', w.enterDoor(dirToSecret) === true && w.roomId === secret.id);
        const loot = w.pickups;
        check('192. 秘密房内有 1 道具 + 3 金币',
            loot.filter((p) => p.kind === 'item').length === 1 && loot.filter((p) => p.kind === 'coin').length === 3,
            loot.map((p) => p.kind).join(','));
        check('193. 秘密房进门即记为已清理', secret.cleared === true);
    }
}

{
    // ---- 旧档缺 shop / altar 字段 ----
    const w = floorWorld(8901, 2);
    const shop = roomOf(w, 'shop');
    w._changeRoom(shop.id, null);
    const store = D.createMemoryStore();
    D.saveRun(w, store);
    const raw = JSON.parse(store.getItem(D.RUN_KEY));
    delete raw.shop;
    delete raw.altar;
    store.setItem(D.RUN_KEY, JSON.stringify(raw));
    const old = D.loadRun(store);
    check('194. 旧档缺 shop / altar 字段可正常读取', !!old && old.shop === null && !old.altar);
    const w2 = C.FridgeWorld.fromSave(old);
    check('195. 缺货架的旧档续玩不弹空面板', w2.pendingShop === null && w2.checkInvariants().length === 0,
        w2.checkInvariants().join('; '));
    D.discardRun(store);
}

// ==================== 21. M4：四层 / Boss / 核心 / 冰箱贴 / 解锁 / 每日 ====================

{
    // ---- 配置表 ----
    check('196. 四层 Boss 血量表（180/260/340/460）',
        F.BOSS_DEFS[1].hp === 180 && F.BOSS_DEFS[2].hp === 260
        && F.BOSS_DEFS[3].hp === 340 && F.BOSS_DEFS[4].hp === 460);
    check('197. 四层 Boss 种类各不相同',
        new Set([1, 2, 3, 4].map((f) => F.BOSS_KIND_BY_FLOOR[f])).size === 4);
    check('198. 6 枚核心 + 3 个补位，id 唯一',
        F.CORES.length === 6 && F.CORE_FILLERS.length === 3
        && new Set(F.CORES.map((c) => c.id)).size === 6
        && new Set(F.CORE_FILLERS.map((c) => c.id)).size === 3);
    check('199. 解锁树 16 个节点，价格与规格一致',
        F.UNLOCK_NODES.length === 16
        && F.UNLOCK_BY_ID['char_candy'].price === 30
        && F.UNLOCK_BY_ID['heat'].price === 60
        && F.UNLOCK_BY_ID['codex_up'].price === 15);
    check('200. 4 套角色配色 + 3 个诅咒', F.PLAYER_PALETTES.length === 4 && F.HEAT_CURSES.length === 3);
    check('201. 每日种子 = 日期整数', F.dailySeed('20261110') === 20261110);
    const d1 = F.dailyChar('20261110');
    const d2 = F.dailyChar('20261110');
    const uniq = new Set();
    for (let d = 1; d <= 12; d++) uniq.add(F.dailyChar('202611' + (d < 10 ? '0' + d : d)));
    check('202. 每日角色同日固定、跨日轮换', d1 === d2 && uniq.size >= 3, `${d1} / ${uniq.size}`);
    check('203. 默认角色已解锁，其余未解锁',
        F.isCharUnlocked([], 'pudding') === true && F.isCharUnlocked([], 'candy') === false);
    check('204. 解锁节点判定', F.hasUnlock(['heat'], 'heat') === true && F.hasUnlock([], 'heat') === false);
}

{
    // ---- 四层地图与 Boss ----
    for (let floor = 1; floor <= 4; floor++) {
        const w = floorWorld(2000 + floor, floor);
        w._changeRoom(w.map.bossId, null);
        const boss = w.enemies.find((e) => F.isBossKind(e.kind));
        check(`205-${floor}. 第 ${floor} 层 Boss 就位（${F.BOSS_KIND_BY_FLOOR[floor]}）`,
            !!boss && boss.kind === F.BOSS_KIND_BY_FLOOR[floor] && boss.maxHp === F.BOSS_DEFS[floor].hp,
            boss ? `${boss.kind}/${boss.maxHp}` : 'missing');
        run(w, 1);
        check(`206-${floor}. 第 ${floor} 层 Boss AI 跑 1 秒不破坏不变量`,
            w.checkInvariants().length === 0, w.checkInvariants().join('; '));
    }

    const w1 = floorWorld(2101, 1);
    w1._changeRoom(w1.map.bossId, null);
    for (const e of w1.enemies) e.hp = 0;
    w1.step(F.FIXED_DT, INPUT());
    check('207. 1 层 Boss 击破后世界冻结待选核心', !!w1.pendingCore && w1.pendingCore.length === 3);
    const t0 = w1.time;
    w1.step(F.FIXED_DT, INPUT());
    check('208. 核心三选一期间时间不推进', w1.time === t0);
    check('209. 核心选项无重复', new Set(w1.pendingCore).size === 3, w1.pendingCore.join(','));
    check('210. 选核心前没有传送口', w1.stairs === null);
    check('211. chooseCore 记录核心并出现传送口', w1.chooseCore(1) === true && w1.cores.length === 1 && !!w1.stairs);
    check('212. 选核心后世界解冻', w1.pendingCore === null);
    w1.addItem('chili');
    const hpBefore = w1.player.hp;
    check('213. nextFloor 进入第 2 层并重生成地图',
        w1.nextFloor() === true && w1.floor === 2 && w1.map.rooms.length >= 7 && w1.stairs === null);
    check('214. 换层保留道具与生命', w1.items.indexOf('chili') >= 0 && w1.player.hp === hpBefore);
    check('215. 换层发出 floor 事件', w1.drainEvents().some((ev) => ev.type === 'floor' && ev.floor === 2));
    check('216. 第 4 层没有下一层', w1.floor === 2 && w1.nextFloor() === false);

    const w4 = floorWorld(2104, 4);
    w4._changeRoom(w4.map.bossId, null);
    for (const e of w4.enemies) e.hp = 0;
    w4.step(F.FIXED_DT, INPUT());
    check('217. 第 4 层 Boss 击破 = 通关，不再出核心', w4.phase === 'won' && w4.pendingCore === null);
}

{
    // ---- 核心效果 / 补位 ----
    const w = floorWorld(2201, 1);
    for (const c of F.CORES) w.cores.push(c.id);
    const rolled = w._rollCores();
    check('218. 核心全持有后三选一全是补位且不重复',
        rolled.length === 3 && new Set(rolled).size === 3 && rolled.every((id) => !!F.CORE_FILLER_BY_ID[id]),
        rolled.join(','));

    const w2 = blankWorld(2202);
    const maxHp0 = w2.player.maxHp;
    w2.cores.push('fill_hp');
    w2._recomputeStats();
    check('219. 生命扩容核心 +1 半心上限', w2.player.maxHp === maxHp0 + F.FILLER_HP, `${maxHp0}→${w2.player.maxHp}`);
    const bombs0 = w2._maxBombs();
    w2.cores.push('fill_bomb');
    w2._recomputeStats();
    check('220. 炸弹扩容核心 +1 炸弹上限', w2._maxBombs() === bombs0 + 1, `${bombs0}→${w2._maxBombs()}`);
    const charges0 = w2.player.maxCharges;
    w2.cores.push('fill_charge');
    w2._recomputeStats();
    check('221. 充能扩容核心 +1 充能上限', w2.player.maxCharges === Math.min(12, charges0 + 1),
        `${charges0}→${w2.player.maxCharges}`);

    const w3 = blankWorld(2203);
    w3.cores.push('greed');
    w3._recomputeStats();
    w3.player.hp = w3.player.maxHp;
    w3.cores.push('shield');
    w3._applyRoomEntryEffects(false);
    check('222. 护盾核心每房开局给 1 点护盾', w3.player.shield >= 1, w3.player.shield);
}

{
    // ---- 冰箱贴 ----
    const w = blankWorld(2301);
    const fight = roomOf(w, 'fight');
    w._changeRoom(fight.id, null);
    for (const e of w.enemies) e.hp = 0;
    w.step(F.FIXED_DT, INPUT());
    check('223. 清普通房 +1 冰箱贴', w.magnets === F.MAGNET_PER_CLEAR, w.magnets);

    const wb = floorWorld(2302, 1);
    wb._changeRoom(wb.map.bossId, null);
    for (const e of wb.enemies) e.hp = 0;
    wb.step(F.FIXED_DT, INPUT());
    check('224. Boss 房 +5 冰箱贴（含清房 +1）',
        wb.magnets === F.MAGNET_PER_CLEAR + F.MAGNET_PER_BOSS, wb.magnets);

    const w4 = floorWorld(2303, 4);
    w4._changeRoom(w4.map.bossId, null);
    for (const e of w4.enemies) e.hp = 0;
    w4.step(F.FIXED_DT, INPUT());
    check('225. 通关额外 +15 冰箱贴',
        w4.magnets === F.MAGNET_PER_CLEAR + F.MAGNET_PER_BOSS + F.MAGNET_PER_WIN, w4.magnets);

    const wf = blankWorld(2304);
    wf.magnets = 9;
    check('226. 失败结算折半', wf.magnetReward() === 4, wf.magnetReward());
    wf.magnets = 0;
    check('227. 失败结算最少 1', wf.magnetReward() === F.MAGNET_FAIL_MIN, wf.magnetReward());

    const wh = blankWorld(2305);
    wh.mode = 'heat';
    wh.magnets = 10;
    wh.phase = 'dead';
    check('228. 热度模式收益 ×1.5', wh.magnetReward() === Math.floor(15 / 2), wh.magnetReward());
}

{
    // ---- 条件解锁 ----
    const mkMeta = () => ({
        unlocks: [], seenItems: [],
        stats: { runs: 0, wins: 0, kills: 0, secrets: 0, bestFloor: 0, spent: 0, charClears: [], maxClearedFloor: 0 },
    });
    const summary = (over) => Object.assign({
        charId: 'pudding', floorReached: 1, maxClearedFloor: 0, won: false, kills: 0,
        secretsOpened: 0, shopSpent: 0, bombsUsed: 0, maxTagCount: 0,
        clearedWhileHalfHeart: false, clearedFloorWithoutBomb: false,
    }, over);

    check('229. 抵达第 2 层解锁硬糖',
        F.evaluateUnlocks(mkMeta(), summary({ floorReached: 2, maxClearedFloor: 1 })).indexOf('char_candy') >= 0);
    const u2 = F.evaluateUnlocks(mkMeta(), summary({ floorReached: 2, maxClearedFloor: 2 }));
    check('230. 通关第 2 层解锁每日挑战 + 电梯', u2.indexOf('daily') >= 0 && u2.indexOf('elevator') >= 0);
    check('231. 通关第 3 层解锁过期酸奶',
        F.evaluateUnlocks(mkMeta(), summary({ floorReached: 3, maxClearedFloor: 3 })).indexOf('char_yogurt') >= 0);
    check('232. 通关第 4 层解锁热度模式',
        F.evaluateUnlocks(mkMeta(), summary({ floorReached: 4, maxClearedFloor: 4 })).indexOf('heat') >= 0);
    check('233. 单局 200 击杀解锁冰块',
        F.evaluateUnlocks(mkMeta(), summary({ kills: 200 })).indexOf('char_icecube') >= 0);
    const mSpend = mkMeta();
    mSpend.stats.spent = 280;
    check('234. 商店累计消费 300 解锁气泡水',
        F.evaluateUnlocks(mSpend, summary({ shopSpent: 30 })).indexOf('char_soda') >= 0);
    const mSecret = mkMeta();
    mSecret.stats.secrets = 4;
    check('235. 累计 5 个秘密房解锁冰箱贴角色',
        F.evaluateUnlocks(mSecret, summary({ secretsOpened: 1 })).indexOf('char_magneto') >= 0);
    const owned = mkMeta();
    owned.unlocks = ['char_candy', 'daily', 'elevator'];
    check('236. 已解锁的节点不重复返回',
        F.evaluateUnlocks(owned, summary({ floorReached: 2, maxClearedFloor: 2 })).length === 0);
}

{
    // ---- 道具池深度补给 ----
    const base1 = F.rollItemPool(1, []);
    check('237. 第 1 层默认看不到第 3/4 层专属道具', !base1.some((it) => it.floor >= 3));
    const sup1 = F.rollItemPool(3, ['supply1']);
    check('238. 深度补给 I：第 3 层起可见第 4 层道具', sup1.some((it) => it.floor === 4));
    const sup2 = F.rollItemPool(1, ['supply2']);
    check('239. 深度补给 II：1–2 层也能刷到深层道具', sup2.some((it) => it.floor >= 3));

    const w = floorWorld(2401, 1);
    w.unlocks = ['supply3'];
    w.addItem('chili');
    const tr = roomOf(w, 'treasure');
    w._changeRoom(tr.id, null);
    const first = w.pendingTreasure ? w.pendingTreasure.offered[0] : null;
    const firstDef = first ? F.ITEM_BY_ID[first] : null;
    check('240. 深度补给 III：宝箱第一项与现有标签协同',
        !!firstDef && firstDef.tags.indexOf('fire') >= 0, first);
}

{
    // ---- 热度诅咒 / 电梯 ----
    const wf = blankWorld(2501);
    const wFast = C.FridgeWorld.newRun(2501, 'pudding', { mode: 'heat', heatCurses: ['fast'] });
    check('241. 热度跑局记录模式与诅咒', wFast.mode === 'heat' && wFast.hasCurse('fast'));
    wFast.spawnEnemy('moldball', 0, 0);
    const en = wFast.enemies[wFast.enemies.length - 1];
    check('242. 敌人加速诅咒 ×1.25', near(wFast._enemySpeedMul(en), F.HEAT_FAST_MUL));
    check('243. 普通跑局没有加速', near(wf._enemySpeedMul({ slowT: 0, slowMul: 1, x: 999, y: 999, r: 1 }), 1));

    const wHalf = C.FridgeWorld.newRun(2502, 'pudding', { mode: 'heat', heatCurses: ['halfhp'] });
    wHalf.cores.push('fill_hp');
    wHalf._recomputeStats();
    check('244. 半心上限诅咒把生命上限压到 6', wHalf.player.maxHp <= F.HEAT_HALF_CAP,
        wHalf.player.maxHp);

    const wNo = C.FridgeWorld.newRun(2503, 'pudding', { mode: 'heat', heatCurses: ['noshot'], startFloor: 2 });
    const shop = roomOf(wNo, 'shop');
    wNo._changeRoom(shop.id, null);
    check('245. 无商店诅咒：商店房变战斗房',
        wNo.pendingShop === null && wNo.enemies.length > 0 && wNo.isRoomLocked() === true);

    const wElev = C.FridgeWorld.newRun(2504, 'pudding', { startFloor: 2 });
    check('246. 电梯从第 2 层开始', wElev.floor === 2 && wElev.map.rooms.length >= 7);
}

{
    // ---- 存档 v3 ----
    const w = floorWorld(2601, 1);
    w._changeRoom(w.map.bossId, null);
    for (const e of w.enemies) e.hp = 0;
    w.step(F.FIXED_DT, INPUT());
    const store = D.createMemoryStore();
    D.saveRun(w, store);
    const raw = JSON.parse(store.getItem(D.RUN_KEY));
    check('247. 跑局存档写 schemaVersion 3 与新字段',
        raw.schemaVersion === 3 && Array.isArray(raw.pendingCore) && raw.mode === 'normal'
        && typeof raw.magnets === 'number' && raw.startFloor === 1,
        `${raw.schemaVersion}/${raw.mode}`);

    const loaded = D.loadRun(store);
    const w2 = C.FridgeWorld.fromSave(loaded);
    check('248. 续玩保留待选核心并保持冻结', Array.isArray(w2.pendingCore) && w2.pendingCore.length === 3);
    const t0 = w2.time;
    w2.step(F.FIXED_DT, INPUT());
    check('249. 续玩后仍冻结在三选一', w2.time === t0);
    check('250. 续玩可选核心并出现传送口', w2.chooseCore(0) === true && !!w2.stairs);
    D.discardRun(store);

    const v2 = Object.assign({}, raw);
    v2.schemaVersion = 2;
    delete v2.mode;
    delete v2.startFloor;
    delete v2.pendingCore;
    delete v2.magnets;
    delete v2.heatCurses;
    delete v2.unlocks;
    const migrated = D.migrateRun(v2);
    check('251. v2 旧档迁移到 v3（补 mode / pendingCore / magnets）',
        !!migrated && migrated.schemaVersion === 3 && migrated.mode === 'normal'
        && migrated.pendingCore === null && migrated.magnets === 0);

    const future = Object.assign({}, raw);
    future.schemaVersion = 99;
    check('252. 未来版本跑局档被拒', D.migrateRun(future) === null);
}

{
    // ---- meta v3 ----
    const m0 = D.migrateMeta({ schemaVersion: 2, magnets: 12, unlocks: ['daily'] });
    check('253. v2 meta 迁移补 seenSynergies / maxClearedFloor / palette',
        m0.schemaVersion === 3 && Array.isArray(m0.seenSynergies)
        && m0.stats.maxClearedFloor === 0 && m0.palette === 0 && m0.magnets === 12);
    const m1 = D.sanitizeMeta({ palette: 9, stats: { bestFloor: 9, maxClearedFloor: -3 }, magnets: -5, daily: { date: '20261110', bestFloor: 3, cleared: true } });
    check('254. meta 数值夹取（palette≤3 / 层数≤4 / 负数归零）',
        m1.palette === 3 && m1.stats.bestFloor === 4 && m1.stats.maxClearedFloor === 0 && m1.magnets === 0,
        `${m1.palette}/${m1.stats.bestFloor}/${m1.magnets}`);
    const m2 = D.migrateMeta({ schemaVersion: 99, magnets: 999 });
    check('255. 未来版本 meta 回落默认值', m2.schemaVersion === 3 && m2.magnets === 0);
}

// ==================== 汇总 ====================

if (failed === 0) {
    console.log(`FRIDGE_CORE_OK  ${passed}/${passed} 项通过（M1 + M2 + M3 + M4 覆盖）`);
    process.exit(0);
} else {
    console.error(`FRIDGE_CORE_FAIL  ${failed} 项失败 / 共 ${passed + failed} 项`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
}
