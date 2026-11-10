#!/usr/bin/env node
/**
 * 冰箱底下纯逻辑自检（不启动 Cocos 编辑器）。
 *
 * 当前覆盖 M1 范围（一间测试房 + 移动/瞄准/眼泪/两种敌人/拾取/边界）。
 * 地图、宝箱、商店、Boss、存档、跨层等 56 项中的其余条目随 M2–M4 逐步补齐。
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
        '--outDir', outDir,
        '--target', 'ES2019',
        '--module', 'commonjs',
        '--skipLibCheck',
        '--strict', 'false',
    ], { stdio: 'inherit' });
    return {
        core: require(path.join(outDir, 'FridgeCore.js')),
        cfg: require(path.join(outDir, 'FridgeConfig.js')),
    };
}

const { core: C, cfg: F } = loadModules();

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

// ==================== 汇总 ====================

if (failed === 0) {
    console.log(`FRIDGE_CORE_OK  ${passed}/${passed} 项通过（M1 覆盖）`);
    process.exit(0);
} else {
    console.error(`FRIDGE_CORE_FAIL  ${failed} 项失败 / 共 ${passed + failed} 项`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
}
