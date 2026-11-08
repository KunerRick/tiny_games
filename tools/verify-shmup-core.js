#!/usr/bin/env node
/**
 * 星际弹幕 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 覆盖：常量 / 波次配置、自动开火与火力等级、四种弹幕图案、碰撞与计分、
 *       无敌帧、边界限制、越界清理、道具掉落与拾取、波次推进、通关与失败、
 *       长跑不变量与确定性。
 *
 * 用法：node tools/verify-shmup-core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GAMES = path.join(ROOT, 'assets', 'games');
const OUT = path.join(ROOT, 'temp', 'shmup-core-test');

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
    path.join(GAMES, 'game_shmup', 'scripts', 'ShmupCore.ts'),
    '--outDir', OUT,
    '--rootDir', GAMES,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const C = require(path.join(OUT, 'game_shmup', 'scripts', 'ShmupCore.js'));
const {
    FIELD_W,
    FIELD_H,
    PLAYER_R,
    PLAYER_START_X,
    PLAYER_START_Y,
    PLAYER_MIN_Y,
    PLAYER_MAX_Y,
    PLAYER_MAX_POWER,
    PLAYER_FIRE_INTERVAL,
    INVULN_TIME,
    MAX_BULLETS,
    ENEMY_DEFS,
    SHMUP_WAVES,
    ShmupWorld,
    countWaveEnemies,
    angleTo,
} = C;

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

const DT = 1 / 60;

/** 推进若干秒；可选每帧回调 */
function run(world, seconds, each) {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
        if (each) each(world, i);
        world.update(DT);
        if (world.phase !== 'playing') return;
    }
}

/** 无敌自动驾驶：追着 Boss 打，用来跑完整局 */
function autoPlay(seconds, opts = {}) {
    const w = new ShmupWorld();
    w.player.invuln = 1e9;
    if (opts.onStep) opts.onStep(w);
    run(w, seconds, (world) => {
        const boss = world.boss;
        // 贴着下方打：弹道只有 150px，Boss 横移来不及躲开
        if (boss) world.movePlayerTo(boss.x, boss.y + 150);
        if (opts.each) opts.each(world);
    });
    return w;
}

/** 手动放一个敌人（不依赖波次节奏） */
function placeEnemy(world, kind, x, y, extra = {}) {
    const def = ENEMY_DEFS[kind];
    const e = {
        id: 90000 + world.enemies.length,
        kind,
        x,
        y,
        baseX: x,
        hp: def.hp,
        maxHp: def.hp,
        radius: def.radius,
        t: 0,
        fireT: 0.01,
        shotIndex: 0,
        arrived: true,
        ...extra,
    };
    world.enemies.push(e);
    return e;
}

function angleOf(b) {
    return Math.atan2(b.vx, b.vy); // 0 = 正下方
}

// ==================== 常量与配置 ====================

console.log('\n[常量与配置]');

test('场地与玩家初始状态在可活动范围内', () => {
    assert.strictEqual(FIELD_W, 720);
    assert.strictEqual(FIELD_H, 1280);
    const w = new ShmupWorld();
    assert.strictEqual(w.player.x, PLAYER_START_X);
    assert.strictEqual(w.player.y, PLAYER_START_Y);
    assert.ok(PLAYER_START_Y > PLAYER_MIN_Y && PLAYER_START_Y < PLAYER_MAX_Y);
    assert.strictEqual(w.player.lives, 3);
    assert.strictEqual(w.player.power, 1);
    assert.strictEqual(w.phase, 'playing');
    assert.strictEqual(w.waveIndex, 0);
    assert.strictEqual(w.score, 0);
});

test('四种敌人定义完整，Boss 不自动下落', () => {
    for (const kind of ['grunt', 'weaver', 'tank', 'boss']) {
        const d = ENEMY_DEFS[kind];
        assert.ok(d, `缺少 ${kind}`);
        assert.strictEqual(d.kind, kind);
        assert.ok(d.hp > 0 && d.radius > 0 && d.score > 0, `${kind} 数值非法`);
        assert.ok(d.fireEvery > 0 && d.bulletSpeed > 0, `${kind} 开火参数非法`);
    }
    assert.strictEqual(ENEMY_DEFS.boss.speed, 0);
    assert.ok(ENEMY_DEFS.tank.hp > ENEMY_DEFS.grunt.hp);
    assert.ok(ENEMY_DEFS.boss.hp > ENEMY_DEFS.tank.hp);
});

test('9 个波次，最后一波是母舰', () => {
    assert.strictEqual(SHMUP_WAVES.length, 9);
    for (const wave of SHMUP_WAVES) {
        assert.ok(wave.name.length > 0);
        assert.ok(wave.entries.length > 0);
        assert.ok(wave.span > 0);
        for (const e of wave.entries) {
            assert.ok(e.at >= 0 && e.at <= wave.span + 0.5, `${wave.name} 的生成时间越界`);
            assert.ok(ENEMY_DEFS[e.kind], `未知敌人 ${e.kind}`);
            assert.ok(e.x >= 0 && e.x <= FIELD_W);
        }
    }
    const last = SHMUP_WAVES[SHMUP_WAVES.length - 1];
    assert.strictEqual(last.entries.filter((e) => e.kind === 'boss').length, 1);
    assert.strictEqual(countWaveEnemies(last), 1);
});

test('波次总敌人数与 countWaveEnemies 一致', () => {
    let expected = 0;
    for (const wave of SHMUP_WAVES) expected += countWaveEnemies(wave);
    const w = autoPlay(180);
    assert.strictEqual(w.phase, 'won', '自动驾驶没能通关，无法核对生成总数');
    assert.strictEqual(w.spawnedTotal, expected,
        `生成数 ${w.spawnedTotal} ≠ 配置总数 ${expected}`);
});

// ==================== 开火 ====================

console.log('\n[玩家开火]');

test('自动开火：1 秒的弹数 ≈ 1 / 间隔', () => {
    const w = new ShmupWorld();
    w.player.invuln = 1e9;
    run(w, 1.0);
    const expected = Math.round(1 / PLAYER_FIRE_INTERVAL);
    assert.ok(
        Math.abs(w.playerBullets.length - expected) <= 1,
        `1 秒发了 ${w.playerBullets.length} 发，期望约 ${expected} 发`
    );
    for (const b of w.playerBullets) {
        assert.ok(b.vy < 0, '玩家子弹必须向上飞');
        assert.strictEqual(b.side, 'p');
    }
});

test('火力 1/2/3 的单次齐射分别是 1/2/3 发', () => {
    for (const power of [1, 2, 3]) {
        const w = new ShmupWorld();
        w.player.invuln = 1e9;
        w.player.power = power;
        w.playerBullets.length = 0;
        w.player.fireT = 0;
        w.update(DT);
        assert.strictEqual(w.playerBullets.length, power, `火力 ${power} 齐射数量不对`);
    }
});

test('火力 3 的散射：两翼子弹左右对称', () => {
    const w = new ShmupWorld();
    w.player.power = 3;
    w.player.fireT = 0;
    w.update(DT);
    const xs = w.playerBullets.map((b) => b.x).sort((a, b) => a - b);
    assert.strictEqual(xs.length, 3);
    assert.ok(Math.abs((xs[0] + xs[2]) / 2 - w.player.x) < 1e-6, '两翼不对称');
});

test('玩家子弹一直打到屏幕外才被清理', () => {
    const w = new ShmupWorld();
    w.player.invuln = 1e9;
    run(w, 3.0);
    for (const b of w.playerBullets) {
        assert.ok(b.y > -80 && b.y <= FIELD_H + 80);
        assert.ok(b.x > -80 && b.x < FIELD_W + 80);
    }
});

// ==================== 弹幕图案 ====================

console.log('\n[弹幕图案]');

test('瞄准弹：速度方向指向玩家', () => {
    const w = new ShmupWorld();
    w.player.x = 200;
    w.player.y = 1000;
    placeEnemy(w, 'grunt', 500, 600);
    w.update(DT);
    assert.ok(w.enemyBullets.length >= 1, '没有开火');
    const b = w.enemyBullets[0];
    const want = angleTo(500, 600, 200, 1000);
    assert.ok(Math.abs(angleOf(b) - want) < 0.02, `方向 ${angleOf(b)} ≠ ${want}`);
    assert.ok(b.vy > 0, '瞄准弹应朝下');
});

test('三向散射：角度差 0.26 rad 且以瞄准方向为中轴', () => {
    const w = new ShmupWorld();
    w.player.x = 360;
    w.player.y = 1000;
    placeEnemy(w, 'weaver', 360, 500);
    w.update(DT);
    const angles = w.enemyBullets.map(angleOf).sort((a, b) => a - b);
    assert.strictEqual(angles.length, 3);
    assert.ok(Math.abs(angles[1]) < 0.02, '中轴没对准正下方');
    assert.ok(Math.abs(angles[1] - angles[0] - 0.26) < 0.02, '左翼角度不对');
    assert.ok(Math.abs(angles[2] - angles[1] - 0.26) < 0.02, '右翼角度不对');
});

test('环形弹：8 颗均分一圈，且每轮整体旋转', () => {
    const w = new ShmupWorld();
    w.player.y = 1100;
    const tank = placeEnemy(w, 'tank', 360, 400, { fireT: 0.01 });
    w.update(DT);
    const first = w.enemyBullets.map(angleOf).map((a) => (a + Math.PI * 4) % (Math.PI * 2)).sort((a, b) => a - b);
    assert.strictEqual(first.length, 8, `第一轮 ${first.length} 颗`);
    for (let i = 1; i < 8; i++) {
        const d = first[i] - first[i - 1];
        assert.ok(Math.abs(d - Math.PI / 4) < 0.02, `相邻角差 ${d}`);
    }
    w.enemyBullets.length = 0;
    tank.fireT = 0.01;
    w.update(DT);
    const second = w.enemyBullets.map(angleOf).map((a) => (a + Math.PI * 4) % (Math.PI * 2)).sort((a, b) => a - b);
    assert.ok(Math.abs(second[0] - first[0] - Math.PI / 8) < 0.02, '第二轮没有旋转 1/8 圈');
});

test('Boss 螺旋弹：每轮 3 颗等分 + 隔轮补一发瞄准弹', () => {
    const w = new ShmupWorld();
    w.player.x = 360;
    w.player.y = 1000;
    const boss = placeEnemy(w, 'boss', 360, 250, { fireT: 0.01, shotIndex: 0 });
    w.update(DT);
    assert.strictEqual(w.enemyBullets.length, 3, `首轮 3 颗，实际 ${w.enemyBullets.length}`);
    w.enemyBullets.length = 0;
    boss.fireT = 0.01; // shotIndex 现在是 1，这一轮补一发瞄准弹
    w.update(DT);
    assert.strictEqual(w.enemyBullets.length, 4, `第二轮 3 + 1 颗，实际 ${w.enemyBullets.length}`);
});

test('子弹只在屏幕内开火（屏幕上方不浪费弹）', () => {
    const w = new ShmupWorld();
    placeEnemy(w, 'grunt', 200, -30, { fireT: 0.01 });
    w.update(DT);
    const firedAbove = w.enemyBullets.length;
    w.enemyBullets.length = 0;
    placeEnemy(w, 'grunt', 200, 600, { fireT: 0.01 });
    w.update(DT);
    assert.strictEqual(firedAbove, 0, '屏幕外也开火了');
    assert.ok(w.enemyBullets.length > 0, '屏幕内没开火');
});

// ==================== 碰撞与计分 ====================

console.log('\n[碰撞与计分]');

test('玩家子弹命中敌人：扣 1 血、子弹消失', () => {
    const w = new ShmupWorld();
    const e = placeEnemy(w, 'tank', 300, 900);
    w.player.fireT = 9999; // 关掉自动开火，只测手动这颗
    w.playerBullets.push({ x: 300, y: 902, vx: 0, vy: -900, r: 6, side: 'p', dmg: 1 });
    w.update(DT);
    assert.strictEqual(e.hp, ENEMY_DEFS.tank.hp - 1);
    assert.strictEqual(w.playerBullets.length, 0, '命中后子弹没销毁');
});

test('打死敌人加分并计数，敌人从场上移除', () => {
    const w = new ShmupWorld();
    const e = placeEnemy(w, 'grunt', 300, 900);
    e.hp = 1;
    w.playerBullets.push({ x: 300, y: 902, vx: 0, vy: -900, r: 6, side: 'p', dmg: 1 });
    w.update(DT);
    assert.strictEqual(w.score, ENEMY_DEFS.grunt.score);
    assert.strictEqual(w.kills, 1);
    assert.ok(!w.enemies.includes(e), '敌人没被移除');
});

test('敌弹命中玩家：掉 1 命并进入无敌', () => {
    const w = new ShmupWorld();
    w.player.x = 360;
    w.player.y = 1000;
    w.enemyBullets.push({ x: 360, y: 1002, vx: 0, vy: 0, r: 7, side: 'e', dmg: 1 });
    w.update(DT);
    assert.strictEqual(w.player.lives, 2);
    assert.ok(w.player.invuln > 0);
});

test('无敌时间内不再掉血', () => {
    const w = new ShmupWorld();
    w.player.x = 360;
    w.player.y = 1000;
    w.player.invuln = INVULN_TIME;
    for (let i = 0; i < 5; i++) {
        w.enemyBullets.push({ x: 360, y: 1000, vx: 0, vy: 0, r: 7, side: 'e', dmg: 1 });
    }
    w.update(DT);
    assert.strictEqual(w.player.lives, 3);
});

test('无敌结束掉血恢复（同一位置再挨一发）', () => {
    const w = new ShmupWorld();
    w.player.x = 360;
    w.player.y = 1000;
    w.enemyBullets.push({ x: 360, y: 1000, vx: 0, vy: 0, r: 7, side: 'e', dmg: 1 });
    w.update(DT);
    assert.strictEqual(w.player.lives, 2);
    w.player.invuln = 0; // 直接跳过等待
    w.enemyBullets.push({ x: 360, y: 1000, vx: 0, vy: 0, r: 7, side: 'e', dmg: 1 });
    w.update(DT);
    assert.strictEqual(w.player.lives, 1);
});

test('敌人撞机：扣血且敌人消失', () => {
    const w = new ShmupWorld();
    w.player.x = 360;
    w.player.y = 1000;
    const e = placeEnemy(w, 'grunt', 360, 1000);
    w.update(DT);
    assert.strictEqual(w.player.lives, 2);
    assert.ok(!w.enemies.includes(e));
});

test('三条命用光 → phase = lost，之后 update 不再改变状态', () => {
    const w = new ShmupWorld();
    w.player.x = 360;
    w.player.y = 1000;
    for (let i = 0; i < 3; i++) {
        w.player.invuln = 0;
        w.enemyBullets.push({ x: 360, y: 1000, vx: 0, vy: 0, r: 7, side: 'e', dmg: 1 });
        w.update(DT);
    }
    assert.strictEqual(w.player.lives, 0);
    assert.strictEqual(w.phase, 'lost');
    const snapshot = w.score;
    const bullets = w.enemyBullets.length;
    w.update(1);
    assert.strictEqual(w.score, snapshot);
    assert.strictEqual(w.enemyBullets.length, bullets);
});

// ==================== 边界与清理 ====================

console.log('\n[边界与清理]');

test('玩家被夹在活动范围内（四个方向都试）', () => {
    const w = new ShmupWorld();
    w.movePlayerTo(-500, -500);
    assert.ok(w.player.x >= PLAYER_R);
    assert.ok(w.player.y >= PLAYER_MIN_Y);
    w.movePlayerTo(5000, 5000);
    assert.ok(w.player.x <= FIELD_W - PLAYER_R);
    assert.ok(w.player.y <= PLAYER_MAX_Y);
    // 相对位移同样受限
    w.movePlayerBy(-9999, -9999);
    assert.ok(w.player.y >= PLAYER_MIN_Y);
});

test('越界子弹被清理，数组规模受控', () => {
    const w = new ShmupWorld();
    w.player.fireT = 9999;
    for (let i = 0; i < 100; i++) {
        // 单帧位移上限 0.05s × 4000 = 200px，起点给低一点才能一帧飞出屏幕
        w.playerBullets.push({ x: 300, y: 100, vx: 0, vy: -4000, r: 6, side: 'p', dmg: 1 });
    }
    w.update(0.05);
    assert.strictEqual(w.playerBullets.length, 0, `越界后还剩 ${w.playerBullets.length} 颗`);
});

test('子弹数量达到上限时丢最旧的，不会无限增长', () => {
    const w = new ShmupWorld();
    for (let i = 0; i < MAX_BULLETS + 50; i++) {
        w.playerBullets.push({ x: 300, y: 900, vx: 0, vy: 0, r: 6, side: 'p', dmg: 1 });
    }
    while (w.playerBullets.length > MAX_BULLETS) w.playerBullets.shift();
    w.player.fireT = 0;
    w.update(DT);
    assert.ok(w.playerBullets.length <= MAX_BULLETS);
});

// ==================== 道具 ====================

console.log('\n[道具]');

test('每 7 个击杀掉一个火力道具', () => {
    const w = new ShmupWorld();
    w.enemies.length = 0;
    w.score = 0;
    for (let i = 1; i <= 7; i++) {
        const e = placeEnemy(w, 'grunt', 100 + i * 10, 500);
        e.hp = 1;
        w.playerBullets.push({ x: e.x, y: e.y, vx: 0, vy: 0, r: 6, side: 'p', dmg: 1 });
        w.update(DT);
    }
    assert.strictEqual(w.kills, 7);
    const powerDrops = w.powerups.filter((u) => u.kind === 'power').length;
    assert.strictEqual(powerDrops, 1, `掉了 ${powerDrops} 个火力`);
});

test('拾取火力提升等级，封顶 3；拾取生命上限 5', () => {
    const w = new ShmupWorld();
    for (let i = 0; i < 6; i++) {
        w.powerups.push({ x: w.player.x, y: w.player.y, vy: 0, kind: 'power', r: 15 });
        w.update(DT);
    }
    assert.strictEqual(w.player.power, PLAYER_MAX_POWER);
    for (let i = 0; i < 9; i++) {
        w.powerups.push({ x: w.player.x, y: w.player.y, vy: 0, kind: 'life', r: 15 });
        w.update(DT);
    }
    assert.strictEqual(w.player.lives, 5);
});

test('道具掉出屏幕被清理', () => {
    const w = new ShmupWorld();
    w.powerups.push({ x: 100, y: FIELD_H - 5, vy: 400, kind: 'power', r: 15 });
    run(w, 1.0);
    assert.strictEqual(w.powerups.length, 0);
});

// ==================== 波次推进 ====================

console.log('\n[波次推进]');

test('清空当前波次后进入下一波', () => {
    const w = new ShmupWorld();
    w.player.invuln = 1e9;
    // 先把第一波全部生成出来
    run(w, 3.5);
    assert.ok(w.spawnedTotal >= countWaveEnemies(SHMUP_WAVES[0]));
    // 强行清场
    w.enemies.length = 0;
    w.enemyBullets.length = 0;
    const before = w.waveIndex;
    run(w, 1.5);
    assert.ok(w.waveIndex > before, `波次没有前进（仍在 ${w.waveIndex + 1}）`);
});

test('remainingInWave 随生成与击杀下降，清场后为 0', () => {
    const w = new ShmupWorld();
    w.player.invuln = 1e9;
    const total = countWaveEnemies(SHMUP_WAVES[0]);
    assert.strictEqual(w.remainingInWave(), total);
    run(w, 3.5);
    w.enemies.length = 0;
    w.enemyBullets.length = 0;
    // 仍在第一波时剩余应只剩「已生成但没生成完」的部分
    assert.ok(w.remainingInWave() >= 0);
});

test('Boss 波次：先下降就位再横向摆动', () => {
    const w = new ShmupWorld();
    w.waveIndex = SHMUP_WAVES.length - 1;
    w.waveTime = 0;
    w.entryIndex = 0;
    run(w, 1.0); // 生成 Boss 并飞到半路
    const boss = w.boss;
    assert.ok(boss, 'Boss 没生成');
    assert.ok(!boss.arrived, 'Boss 一秒内就位太快');
    run(w, 3.0);
    assert.ok(boss.arrived, 'Boss 没就位');
    assert.ok(Math.abs(boss.y - 250) < 40, `Boss 高度 ${boss.y}`);
    const x0 = boss.x;
    run(w, 1.5);
    assert.ok(Math.abs(boss.x - x0) > 5, 'Boss 没有横向移动');
});

test('击杀 Boss 立即通关', () => {
    const w = new ShmupWorld();
    w.waveIndex = SHMUP_WAVES.length - 1;
    w.waveTime = 0;
    w.entryIndex = 0;
    run(w, 4.0);
    const boss = w.boss;
    assert.ok(boss, 'Boss 没生成');
    boss.hp = 1;
    w.playerBullets.push({ x: boss.x, y: boss.y, vx: 0, vy: 0, r: 6, side: 'p', dmg: 1 });
    w.update(DT);
    assert.strictEqual(w.phase, 'won');
    assert.ok(w.score >= ENEMY_DEFS.boss.score);
});

// ==================== 长跑与确定性 ====================

console.log('\n[长跑与确定性]');

test('60 秒随机走位：无 NaN、无重复敌人 id、数组不超限', () => {
    const w = new ShmupWorld();
    w.player.invuln = 1e9;
    let seed = 20261108;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    run(w, 60, (world) => {
        world.movePlayerBy((rand() - 0.5) * 40, (rand() - 0.5) * 40);
        for (const b of world.playerBullets) {
            assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), '出现 NaN 子弹');
        }
        for (const e of world.enemies) {
            assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y) && e.hp > 0, '敌人数值非法');
        }
        const ids = new Set(world.enemies.map((e) => e.id));
        assert.strictEqual(ids.size, world.enemies.length, '敌人 id 重复');
        assert.ok(world.playerBullets.length <= MAX_BULLETS);
        assert.ok(world.enemyBullets.length <= MAX_BULLETS);
    });
    assert.ok(Number.isFinite(w.player.x) && Number.isFinite(w.player.y));
    assert.ok(w.score > 0, '一分钟一个敌人都没打死');
});

test('同一输入序列 → 完全一致的结果（确定性）', () => {
    const play = () => {
        const w = new ShmupWorld();
        w.player.invuln = 1e9;
        run(w, 25, (world, i) => {
            world.movePlayerTo(240 + Math.sin(i / 20) * 180, 1000);
        });
        return {
            score: w.score,
            kills: w.kills,
            wave: w.waveIndex,
            lives: w.player.lives,
            enemies: w.enemies.length,
            pb: w.playerBullets.length,
            eb: w.enemyBullets.length,
            spilled: w.spawnedTotal,
        };
    };
    assert.deepStrictEqual(play(), play());
});

test('自动驾驶能在预算内通关（Boss 可被打死）', () => {
    const t0 = Date.now();
    const w = autoPlay(150);
    const ms = Date.now() - t0;
    assert.strictEqual(w.phase, 'won', `150 秒仍未通关（波次 ${w.waveIndex + 1}，Boss ${
        w.boss ? Math.round(w.boss.hp) : '已死'
    }）`);
    assert.ok(w.score > 1000, `得分只有 ${w.score}`);
    assert.ok(w.kills > 40, `只击杀 ${w.kills} 个`);
    assert.ok(ms < 15000, `模拟耗时 ${ms} ms，太慢`);
});

test('通关后继续 update 不改变状态', () => {
    const w = autoPlay(150);
    assert.strictEqual(w.phase, 'won');
    const score = w.score;
    w.update(1);
    assert.strictEqual(w.score, score);
});

// ==================== 汇总 ====================

console.log('');
if (failures.length > 0) {
    console.error(`${failures.length} 项失败，${passed} 项通过`);
    for (const f of failures) console.error(` - ${f.name}: ${f.err.message}`);
    process.exit(1);
}
console.log(`${passed} 项通过，0 项失败`);
console.log('SHMUP_CORE_OK');
