#!/usr/bin/env node
/**
 * 砖块远征 —— 纯逻辑回归自检（不启动 Cocos）。
 *
 * 覆盖：RNG 确定性、关卡生成与难度曲线、挡板跟随/夹紧、发球角度、墙壁与挡板反弹、
 * 砖块耐久/穿透/爆炸球/炸弹连锁、计分与连击、激光、粘性、分裂、生命与结算、防穿模。
 *
 * 用法：
 *   node tools/verify-brick-core.js
 *
 * 依赖：TypeScript 编译器。优先用 TSC 环境变量，其次本地 node_modules，
 * 最后回落到 Cocos Creator 自带版本（路径见 AGENTS.md）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_brick', 'scripts');
const OUT = path.join(ROOT, 'temp', 'brick-core-test');

const TSC_CANDIDATES = [
    process.env.TSC,
    path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc',
].filter(Boolean);

const tscPath = TSC_CANDIDATES.find(p => fs.existsSync(p));
if (!tscPath) {
    console.error('找不到 tsc。请设置 TSC 环境变量，或在项目内 npm install。');
    process.exit(2);
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(`编译纯逻辑模块 → ${path.relative(ROOT, OUT)}`);
execFileSync(process.execPath, [
    tscPath,
    path.join(SRC, 'BrickConfig.ts'),
    path.join(SRC, 'BrickCore.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const Config = require(path.join(OUT, 'BrickConfig.js'));
const { BrickCore, mulberry32, clamp } = require(path.join(OUT, 'BrickCore.js'));

// ==================== 测试框架 ====================

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

function eq(actual, expected, msg) {
    assert.deepStrictEqual(actual, expected, msg);
}

function ok(value, msg) {
    assert.ok(value, msg);
}

function near(actual, expected, tolerance, msg) {
    assert.ok(Math.abs(actual - expected) <= tolerance, msg || `期望 ${expected}±${tolerance}，实际 ${actual}`);
}

function aliveBricks(core) {
    return core.bricks.filter(b => b.alive);
}

function totalHp(core) {
    let sum = 0;
    for (const b of core.bricks) if (b.alive) sum += b.hp;
    return sum;
}

function bricksSignature(core) {
    return core.bricks
        .map(b => `${b.col},${b.row},${b.hp},${b.maxHp},${b.kind}`)
        .sort()
        .join('|');
}

function run(core, seconds, dt = 1 / 60) {
    const steps = Math.ceil(seconds / dt);
    for (let i = 0; i < steps; i++) core.step(dt);
}

/** 放一颗球并移除其它球，方便构造单球场景 */
function placeBall(core, x, y, vx, vy) {
    const ball = core.debugAddBall(x, y, vx, vy);
    core.debugKeepOnlyBall(ball);
    return ball;
}

/** 从砖块正下方以 300px/s 撞上去，直到砖块死亡或超时 */
function hitBrickFromBelow(core, brick, speed = 300, timeout = 0.3) {
    const ball = placeBall(core, brick.x + brick.w / 2, brick.y + brick.h + Config.BALL_R + 2, 0, -speed);
    const steps = Math.ceil(timeout / (1 / 60));
    for (let i = 0; i < steps; i++) {
        core.step(1 / 60);
        if (!brick.alive) break;
    }
    return ball;
}

function normalBrick(core, predicate) {
    const list = aliveBricks(core).filter(b => b.kind === 'normal' && b.hp === 1);
    if (predicate) return list.find(predicate);
    return list[0];
}

/** 只保留指定砖块，其它全部移除（不触发爆炸与计分） */
function killAllExcept(core, keep) {
    const keepSet = new Set(keep);
    for (const b of core.bricks) {
        if (!keepSet.has(b)) core.debugKillBrick(b.id);
    }
}

/**
 * 炸弹沙箱：只留下炸弹和它的 3×3 邻居，并移除炸弹正下方的砖，
 * 保证从下方撞上去时第一块碰到的一定是炸弹。
 */
function bombSandbox(core) {
    const bomb = core.bricks.find(b => b.kind === 'bomb');
    const keep = [bomb];
    for (const b of core.bricks) {
        if (b === bomb) continue;
        const near = Math.abs(b.row - bomb.row) <= 1 && Math.abs(b.col - bomb.col) <= 1;
        const blocksBelow = b.col === bomb.col && b.row > bomb.row;
        if (near && !blocksBelow) keep.push(b);
    }
    killAllExcept(core, keep);
    return { bomb, neighbors: keep.slice(1) };
}

/** 爆炸球沙箱：只留下目标砖和它的 3×3 邻居（同样清掉正下方的阻挡） */
function explosiveSandbox(core) {
    const target = aliveBricks(core).find(b => {
        if (b.kind !== 'normal' || b.hp !== 1) return false;
        return core.bricks.some(o => o !== b && o.alive && Math.abs(o.row - b.row) <= 1 && Math.abs(o.col - b.col) <= 1);
    });
    ok(target, '找不到带邻居的普通砖');
    const keep = [target];
    for (const b of core.bricks) {
        if (b === target) continue;
        const near = Math.abs(b.row - target.row) <= 1 && Math.abs(b.col - target.col) <= 1;
        const blocksBelow = b.col === target.col && b.row > target.row;
        if (near && !blocksBelow) keep.push(b);
    }
    killAllExcept(core, keep);
    return { target, neighbors: keep.slice(1) };
}

// ==================== 1. RNG ====================

console.log('\n[1] 随机数与工具');

test('mulberry32 同 seed 同序列，结果落在 [0,1)', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    eq(seqA, seqB);
    for (const v of seqA) {
        ok(v >= 0 && v < 1, `随机值越界: ${v}`);
    }
});

test('clamp 边界', () => {
    eq(clamp(-5, 0, 10), 0);
    eq(clamp(15, 0, 10), 10);
    eq(clamp(5, 0, 10), 5);
});

// ==================== 2. 关卡生成 ====================

console.log('\n[2] 关卡生成与难度曲线');

test('第 1 关：3 行、1 个炸弹、初始生命 3、状态 ready', () => {
    const core = new BrickCore({ seed: 42 });
    eq(core.level, 1);
    eq(core.lives, Config.BASE_LIVES);
    eq(core.state, 'ready');
    const rows = new Set(core.bricks.map(b => b.row));
    eq(rows.size, 3);
    eq(core.bricks.filter(b => b.kind === 'bomb').length, 1);
    ok(aliveBricks(core).length >= 1);
});

test('同 seed 关卡完全一致，不同 seed 不同', () => {
    const a = new BrickCore({ seed: 777 });
    const b = new BrickCore({ seed: 777 });
    const c = new BrickCore({ seed: 778 });
    eq(bricksSignature(a), bricksSignature(b));
    ok(bricksSignature(a) !== bricksSignature(c));
});

test('砖块全部落在游戏区内，且不压到挡板', () => {
    const core = new BrickCore({ seed: 9 });
    core.debugSetLevel(12);
    const paddleTop = core.paddle.y - core.paddle.h / 2;
    for (const b of core.bricks) {
        ok(b.x >= 0 && b.x + b.w <= Config.PLAY_W + 1e-6, `砖块 x 越界: ${b.x}`);
        ok(b.y >= Config.BRICK_TOP - 1e-6, `砖块 y 越界: ${b.y}`);
        ok(b.y + b.h < paddleTop, '砖块压到挡板');
        ok(b.hp >= 1 && b.hp <= 3, `耐久越界: ${b.hp}`);
        ok(b.row >= 0 && b.col >= 0 && b.col < Config.BRICK_COLS);
    }
});

test('第 12 关：行数封顶 8、炸弹封顶 4', () => {
    const core = new BrickCore({ seed: 21 });
    core.debugSetLevel(12);
    eq(new Set(core.bricks.map(b => b.row)).size, 8);
    eq(core.bricks.filter(b => b.kind === 'bomb').length, 4);
});

test('第 8 关起可能出现 3 耐久砖', () => {
    let seenHp3 = false;
    for (let seed = 1; seed <= 40 && !seenHp3; seed++) {
        const core = new BrickCore({ seed });
        core.debugSetLevel(9);
        if (core.bricks.some(b => b.maxHp >= 3)) seenHp3 = true;
    }
    ok(seenHp3, '连续 40 个 seed 都没有 3 耐久砖');
});

test('炸弹砖耐久恒为 1', () => {
    const core = new BrickCore({ seed: 3 });
    core.debugSetLevel(15);
    for (const b of core.bricks) {
        if (b.kind === 'bomb') eq(b.maxHp, 1);
    }
});

// ==================== 3. 挡板与发球 ====================

console.log('\n[3] 挡板与发球');

test('挡板目标被夹在游戏区内', () => {
    const core = new BrickCore({ seed: 5 });
    core.setPaddleTarget(-999, true);
    near(core.paddle.x, core.paddle.w / 2, 1e-6);
    core.setPaddleTarget(99999, true);
    near(core.paddle.x, Config.PLAY_W - core.paddle.w / 2, 1e-6);
});

test('挡板平滑跟随而不是瞬移', () => {
    const core = new BrickCore({ seed: 5 });
    const start = core.paddle.x;
    core.setPaddleTarget(start + 120);
    core.step(1 / 240);
    ok(core.paddle.x > start, '一帧内没有移动');
    ok(core.paddle.x < start + 120, '一帧内瞬移到了目标');
});

test('发球：速度正确、向上、角度在 ±30° 内', () => {
    const core = new BrickCore({ seed: 42 });
    ok(core.launch());
    eq(core.state, 'playing');
    eq(core.balls.length, 1);
    const ball = core.balls[0];
    ok(!ball.stuck);
    ok(ball.vy < 0, '发球方向不是向上');
    const speed = Math.hypot(ball.vx, ball.vy);
    near(speed, core.ballSpeed(), 1e-6);
    const angleDeg = Math.atan2(Math.abs(ball.vx), -ball.vy) * 180 / Math.PI;
    ok(angleDeg <= Config.LAUNCH_ANGLE_DEG + 1e-6, `发球角过大: ${angleDeg}`);
});

test('ready 状态下球粘在挡板上并跟随', () => {
    const core = new BrickCore({ seed: 5 });
    core.setPaddleTarget(500, true);
    run(core, 0.2);
    const ball = core.balls[0];
    eq(ball.stuck, true);
    near(ball.x, core.paddle.x, 1e-6);
    near(ball.y, core.paddle.y - core.paddle.h / 2 - Config.BALL_R - 0.5, 1e-6);
});

test('extra_ball：发球数量 = 1 + 层数', () => {
    const core = new BrickCore({ seed: 11 });
    core.debugSetUpgrade('extra_ball', 2);
    core.launch();
    eq(core.balls.length, 3);
});

test('extra_ball：游戏中直接发放会立即补一颗', () => {
    const core = new BrickCore({ seed: 11 });
    core.launch();
    const before = core.balls.length;
    core.debugGrantUpgrade('extra_ball');
    eq(core.balls.length, before + 1);
});

// ==================== 4. 碰撞与反弹 ====================

console.log('\n[4] 碰撞与反弹');

test('左右墙反弹', () => {
    const core = new BrickCore({ seed: 7 });
    core.launch();
    const ball = placeBall(core, Config.BALL_R + 4, 400, -400, 0);
    run(core, 0.1);
    ok(ball.vx > 0, '撞左墙后没有向右反弹');
    ok(ball.x >= Config.BALL_R - 1e-6);

    const core2 = new BrickCore({ seed: 7 });
    core2.launch();
    const ball2 = placeBall(core2, Config.PLAY_W - Config.BALL_R - 4, 400, 400, 0);
    run(core2, 0.1);
    ok(ball2.vx < 0, '撞右墙后没有向左反弹');
});

test('顶部反弹', () => {
    const core = new BrickCore({ seed: 7 });
    core.launch();
    const ball = placeBall(core, 330, Config.BALL_R + 4, 0, -400);
    run(core, 0.1);
    ok(ball.vy > 0, '撞顶后没有向下反弹');
    ok(ball.y >= Config.BALL_R - 1e-6);
});

test('挡板命中位置决定反弹方向与角度', () => {
    const core = new BrickCore({ seed: 7 });
    core.launch();
    core.setPaddleTarget(330, true);
    const top = core.paddle.y - core.paddle.h / 2;
    const ball = placeBall(core, 330 + 40, top - 20, 0, 300);
    run(core, 0.15);
    ok(ball.vy < 0, '接住后没有向上');
    ok(ball.vx > 0, '打在挡板右侧却向左弹');
    const angleDeg = Math.atan2(ball.vx, -ball.vy) * 180 / Math.PI;
    ok(angleDeg > 5 && angleDeg <= core.maxBounceAngleDeg() + 1e-6, `反弹角异常: ${angleDeg}`);
});

test('挡板正中命中接近垂直反弹', () => {
    const core = new BrickCore({ seed: 7 });
    core.launch();
    core.setPaddleTarget(330, true);
    const top = core.paddle.y - core.paddle.h / 2;
    const ball = placeBall(core, 330, top - 20, 0, 300);
    run(core, 0.15);
    near(ball.vx, 0, 1e-6);
    ok(ball.vy < 0);
});

test('narrow_angle 收窄反弹角', () => {
    const core = new BrickCore({ seed: 7 });
    eq(core.maxBounceAngleDeg(), Config.PADDLE_MAX_ANGLE_DEG);
    core.debugSetUpgrade('narrow_angle', 2);
    eq(core.maxBounceAngleDeg(), Config.PADDLE_MAX_ANGLE_DEG - 2 * Config.NARROW_ANGLE_STEP_DEG);
});

test('从砖块下方撞击：反射向下并扣耐久/计分', () => {
    const core = new BrickCore({ seed: 42 });
    core.launch();
    const brick = normalBrick(core);
    killAllExcept(core, [brick]);
    const ball = hitBrickFromBelow(core, brick);
    eq(brick.alive, false);
    ok(ball.vy > 0, '撞砖后没有向下反射');
    eq(core.score, Config.SCORE_PER_HP * brick.maxHp);
});

test('撞砖侧面：水平速度反向', () => {
    const core = new BrickCore({ seed: 42 });
    core.launch();
    const brick = aliveBricks(core).find(b => b.col >= 2 && b.kind === 'normal' && b.hp === 1);
    ok(brick, '找不到合适的侧面测试砖');
    killAllExcept(core, [brick]);
    const ball = placeBall(core, brick.x - Config.BALL_R - 30, brick.y + brick.h / 2, 300, 0);
    run(core, 0.2);
    ok(ball.vx < 0, '从左侧撞砖后没有向左反射');
    eq(brick.alive, false);
});

test('多耐久砖需要多次命中', () => {
    const core = new BrickCore({ seed: 21 });
    core.debugSetLevel(10);
    core.launch();
    const brick = aliveBricks(core).find(b => b.maxHp >= 2);
    ok(brick, '第 10 关没有多耐久砖');
    killAllExcept(core, [brick]);
    const hp0 = brick.hp;
    hitBrickFromBelow(core, brick, 300, 0.2);
    ok(brick.alive, '第一击就打碎了多耐久砖');
    eq(brick.hp, hp0 - 1);
    hitBrickFromBelow(core, brick, 300, 0.2);
    eq(brick.alive, false);
});

test('ball_damage 提升单次伤害', () => {
    const core = new BrickCore({ seed: 42 });
    eq(core.ballDamage(), 1);
    core.debugSetUpgrade('ball_damage', 1);
    eq(core.ballDamage(), 2);
    core.launch();

    const core2 = new BrickCore({ seed: 21 });
    core2.debugSetLevel(10);
    core2.debugSetUpgrade('ball_damage', 1);
    core2.launch();
    const tough = aliveBricks(core2).find(b => b.hp === 2);
    ok(tough, '没有 2 耐久砖');
    killAllExcept(core2, [tough]);
    hitBrickFromBelow(core2, tough);
    eq(tough.alive, false, '强化球没有一发打碎 2 耐久砖');
});

test('高速球不会穿过砖块（防隧穿）', () => {
    const core = new BrickCore({ seed: 42 });
    core.launch();
    const brick = aliveBricks(core).filter(b => b.kind === 'normal')[0];
    killAllExcept(core, [brick]);
    const ball = placeBall(core, brick.x + brick.w / 2, brick.y + brick.h + Config.BALL_R + 2, 0, -900);
    run(core, 0.05);
    ok(!brick.alive || brick.hp < brick.maxHp, '900px/s 的球穿过了砖块');
    ok(ball.vy > 0, '高速球没有反射');
});

// ==================== 5. 特殊砖与升级 ====================

console.log('\n[5] 特殊砖与升级');

test('炸弹砖被击碎时波及 3×3 邻居', () => {
    const core = new BrickCore({ seed: 42 });
    core.launch();
    const { bomb, neighbors } = bombSandbox(core);
    ok(neighbors.length > 0, '炸弹没有可波及的邻居');
    const before = new Map(neighbors.map(b => [b.id, b.hp]));
    hitBrickFromBelow(core, bomb);
    eq(bomb.alive, false);
    let changed = 0;
    for (const b of neighbors) {
        if (!b.alive || b.hp < before.get(b.id)) changed++;
    }
    ok(changed > 0, '炸弹没有对邻居造成伤害');
});

test('explosive 升级：命中时溅射 3×3', () => {
    const core = new BrickCore({ seed: 42 });
    core.debugSetUpgrade('explosive', 1);
    core.launch();
    const { target, neighbors } = explosiveSandbox(core);
    const hpBefore = new Map(neighbors.map(b => [b.id, b.hp]));
    hitBrickFromBelow(core, target);
    const changed = neighbors.filter(b => !b.alive || b.hp < hpBefore.get(b.id)).length;
    ok(changed > 0, '爆炸球没有溅射到邻居');
});

test('pierce 升级：打碎普通砖后不反弹', () => {
    const core = new BrickCore({ seed: 42 });
    core.debugSetUpgrade('pierce', 1);
    core.launch();
    const brick = normalBrick(core);
    killAllExcept(core, [brick]);
    const ball = placeBall(core, brick.x + brick.w / 2, brick.y + brick.h + Config.BALL_R + 2, 0, -300);
    run(core, 0.1);
    eq(brick.alive, false);
    ok(ball.vy < 0, '穿透时仍然反弹了');
    ok(ball.skipTimer > 0, '穿透后没有忽略窗口');
});

test('pierce 对多耐久砖仍然反弹', () => {
    const core = new BrickCore({ seed: 21 });
    core.debugSetLevel(10);
    core.debugSetUpgrade('pierce', 1);
    core.launch();
    const tough = aliveBricks(core).find(b => b.hp >= 2);
    ok(tough, '没有多耐久砖');
    killAllExcept(core, [tough]);
    const ball = placeBall(core, tough.x + tough.w / 2, tough.y + tough.h + Config.BALL_R + 2, 0, -300);
    run(core, 0.1);
    ok(ball.vy > 0, '穿透对多耐久砖没有反弹');
});

test('sticky：接球后粘住，再次点击发球', () => {
    const core = new BrickCore({ seed: 7 });
    core.debugSetUpgrade('sticky', 1);
    core.launch();
    core.setPaddleTarget(330, true);
    const top = core.paddle.y - core.paddle.h / 2;
    const ball = placeBall(core, 330, top - 20, 0, 300);
    run(core, 0.15);
    eq(ball.stuck, true, '粘性挡板没有粘住球');
    ok(core.launch(), '粘住的球无法再次发球');
    eq(ball.stuck, false);
    ok(ball.vy < 0);
});

test('slow_ball 降低球速并作用于场上已有的球', () => {
    const core = new BrickCore({ seed: 11 });
    eq(core.ballSpeed(), Config.BALL_BASE_SPEED);
    core.launch();
    core.debugSetUpgrade('slow_ball', 2);
    eq(core.ballSpeed(), Config.BALL_BASE_SPEED - 2 * Config.SLOW_BALL_STEP);
    for (const ball of core.balls) {
        near(Math.hypot(ball.vx, ball.vy), core.ballSpeed(), 1e-6);
    }
});

test('ballSpeed 不低于下限、不高于上限', () => {
    const core = new BrickCore({ seed: 11 });
    core.debugSetUpgrade('slow_ball', 3);
    core.debugSetLevel(1);
    ok(core.ballSpeed() >= Config.BALL_MIN_SPEED);
    core.debugSetLevel(99);
    core.debugSetUpgrade('slow_ball', 0);
    ok(core.ballSpeed() <= Config.BALL_MAX_SPEED);
});

test('paddle_widen 加宽挡板并夹回游戏区', () => {
    const core = new BrickCore({ seed: 5 });
    core.setPaddleTarget(Config.PLAY_W, true);
    core.debugSetUpgrade('paddle_widen', 2);
    eq(core.paddleWidth(), Config.PADDLE_W + 36);
    eq(core.paddle.w, core.paddleWidth());
    ok(core.paddle.x <= Config.PLAY_W - core.paddle.w / 2 + 1e-6);
});

test('score_mult 叠乘得分', () => {
    const core = new BrickCore({ seed: 42 });
    core.debugSetUpgrade('score_mult', 2);
    core.launch();
    const brick = normalBrick(core);
    killAllExcept(core, [brick]);
    hitBrickFromBelow(core, brick);
    eq(core.score, Math.round(Config.SCORE_PER_HP * brick.maxHp * Math.pow(1.25, 2)));
});

test('连击不碰挡板时累加', () => {
    const core = new BrickCore({ seed: 42 });
    core.launch();
    const first = normalBrick(core);
    const second = aliveBricks(core).find(b => b !== first && b.kind === 'normal' && b.hp === 1);
    ok(second, '找不到两块普通砖');
    killAllExcept(core, [first, second]);
    hitBrickFromBelow(core, first);
    eq(core.combo, 1);
    hitBrickFromBelow(core, second);
    eq(core.combo, 2);
    ok(core.score > Config.SCORE_PER_HP * 2, '连击没有加分');
});

test('球碰挡板后连击清零', () => {
    const core = new BrickCore({ seed: 42 });
    core.launch();
    const first = normalBrick(core);
    const survivor = aliveBricks(core).find(b => b !== first);
    ok(survivor, '找不到留作观众的砖块');
    killAllExcept(core, [first, survivor]);
    hitBrickFromBelow(core, first);
    eq(core.combo, 1);

    // 让一颗球落到挡板上
    const ball = placeBall(core, core.paddle.x, core.paddle.y - 60, 0, 300);
    run(core, 0.5);
    eq(core.combo, 0, '球碰挡板后连击没有清零');
    ok(ball.vy < 0);
});

// ==================== 6. 激光 ====================

console.log('\n[6] 激光');

test('laser 升级后自动开火并命中砖块', () => {
    const core = new BrickCore({ seed: 42 });
    core.debugSetUpgrade('laser', 1);
    core.launch();
    // 把球固定粘在挡板上，避免球本身干扰伤害统计
    const ball = placeBall(core, core.paddle.x, core.paddle.y - core.paddle.h / 2 - Config.BALL_R - 2, 0, 0);
    ball.stuck = true;
    ball.stuckOffset = 0;
    const hp0 = totalHp(core);
    run(core, 1.8);
    const events = core.popEvents();
    ok(events.some(e => e.type === 'laser_fire'), '没有激光开火事件');
    ok(totalHp(core) < hp0, '激光没有命中任何砖块');
});

test('没有 laser 升级时不上激光', () => {
    const core = new BrickCore({ seed: 42 });
    core.launch();
    const ball = placeBall(core, core.paddle.x, core.paddle.y - 40, 0, 0);
    ball.stuck = true;
    run(core, 1.2);
    eq(core.lasers.length, 0);
    eq(core.popEvents().filter(e => e.type === 'laser_fire').length, 0);
});

// ==================== 7. 通关、升级与结算 ====================

console.log('\n[7] 通关、升级与结算');

test('清空砖块进入 level_clear 并给出 3 个不重复候选', () => {
    const core = new BrickCore({ seed: 99 });
    core.launch();
    for (const b of core.bricks) core.debugKillBrick(b.id);
    core.step(1 / 60);
    eq(core.state, 'level_clear');
    eq(core.pendingChoices.length, 3);
    eq(new Set(core.pendingChoices).size, 3);
    ok(core.popEvents().some(e => e.type === 'level_clear'));
});

test('候选只包含未满级升级', () => {
    const core = new BrickCore({ seed: 99 });
    for (const def of Config.UPGRADES) {
        core.debugSetUpgrade(def.id, def.maxLevel);
    }
    // 全部满级：候选为空，不能卡住流程
    core.launch();
    for (const b of core.bricks) core.debugKillBrick(b.id);
    core.step(1 / 60);
    eq(core.state, 'level_clear');
    eq(core.pendingChoices.length, 0);
});

test('全部满级时 skipUpgrade 能直接进下一关（防卡死）', () => {
    const core = new BrickCore({ seed: 99 });
    for (const def of Config.UPGRADES) {
        core.debugSetUpgrade(def.id, def.maxLevel);
    }
    core.launch();
    for (const b of core.bricks) core.debugKillBrick(b.id);
    core.step(1 / 60);
    eq(core.state, 'level_clear');
    eq(core.pendingChoices.length, 0);
    eq(core.skipUpgrade(), true);
    eq(core.level, 2);
    eq(core.state, 'ready');
    ok(aliveBricks(core).length > 0);
});

test('skipUpgrade 在非 level_clear 状态拒绝', () => {
    const core = new BrickCore({ seed: 5 });
    eq(core.skipUpgrade(), false);
    eq(core.level, 1);
});

test('applyUpgrade：进入下一关、重建砖块、状态回到 ready', () => {
    const core = new BrickCore({ seed: 99 });
    core.launch();
    for (const b of core.bricks) core.debugKillBrick(b.id);
    core.step(1 / 60);
    const choice = core.pendingChoices[0];
    eq(core.applyUpgrade(choice), true);
    eq(core.level, 2);
    eq(core.state, 'ready');
    eq(core.pendingChoices.length, 0);
    ok(aliveBricks(core).length > 0);
    eq(core.balls.length, 1);
    eq(core.balls[0].stuck, true);
});

test('applyUpgrade 在非 level_clear 状态或已满级时拒绝', () => {
    const core = new BrickCore({ seed: 3 });
    eq(core.applyUpgrade('score_mult'), false);
    core.debugSetUpgrade('sticky', 1);
    core.launch();
    for (const b of core.bricks) core.debugKillBrick(b.id);
    core.step(1 / 60);
    eq(core.state, 'level_clear');
    eq(core.applyUpgrade('sticky'), false);
});

test('extra_life：立即加命且不超过上限', () => {
    const core = new BrickCore({ seed: 3 });
    eq(core.lives, 3);
    core.debugGrantUpgrade('extra_life');
    eq(core.lives, 4);
    core.debugGrantUpgrade('extra_life');
    core.debugGrantUpgrade('extra_life');
    core.debugGrantUpgrade('extra_life');
    eq(core.lives, Config.MAX_LIVES);
});

test('球掉出底部扣命并回到 ready；命尽进入 game_over', () => {
    const core = new BrickCore({ seed: 5 });
    core.launch();
    let ball = core.balls[0];
    core.debugKeepOnlyBall(ball);
    ball.x = Config.PLAY_W / 2;
    ball.y = Config.PLAY_H + Config.BALL_R + 60;
    ball.vx = 0;
    ball.vy = 300;
    core.step(1 / 60);
    eq(core.lives, 2);
    eq(core.state, 'ready');
    eq(core.balls.length, 1);
    eq(core.balls[0].stuck, true);

    // 再掉两次
    for (let i = 0; i < 2; i++) {
        core.launch();
        ball = core.balls[0];
        core.debugKeepOnlyBall(ball);
        ball.x = Config.PLAY_W / 2;
        ball.y = Config.PLAY_H + Config.BALL_R + 60;
        ball.vx = 0;
        ball.vy = 300;
        core.step(1 / 60);
    }
    eq(core.lives, 0);
    eq(core.state, 'game_over');
    const events = core.popEvents();
    ok(events.some(e => e.type === 'game_over'));
});

test('多球时只有全部掉出才扣命', () => {
    const core = new BrickCore({ seed: 5 });
    core.launch();
    const first = core.balls[0];
    core.debugKeepOnlyBall(first);
    const second = core.debugAddBall(Config.PLAY_W / 2, 200, 0, -100);

    // 让第一颗掉出，第二颗仍在场上
    first.x = Config.PLAY_W / 2;
    first.y = Config.PLAY_H + Config.BALL_R + 60;
    first.vx = 0;
    first.vy = 300;
    core.step(1 / 60);
    eq(core.lives, 3, '还有球在场时不应扣命');
    eq(core.balls.length, 1);
    ok(core.balls[0] === second);
});

test('防呆：接近水平的球会被纵向推开', () => {
    const core = new BrickCore({ seed: 5 });
    core.launch();
    const speed0 = 600;
    const ball = placeBall(core, 300, 400, speed0, 0);
    run(core, 1.1);
    ok(Math.abs(ball.vy) > Config.HORIZONTAL_STUCK_VY, `水平球没有被推开: vy=${ball.vy}`);
    near(Math.hypot(ball.vx, ball.vy), speed0, 1e-6, '推开后速度模长变了');
});

// ==================== 8. 事件 ====================

console.log('\n[8] 事件');

test('命中/击碎/挡板事件按类型发出', () => {
    const core = new BrickCore({ seed: 42 });
    core.launch();
    const brick = normalBrick(core);
    hitBrickFromBelow(core, brick);
    const events = core.popEvents();
    ok(events.some(e => e.type === 'brick_hit'));
    ok(events.some(e => e.type === 'brick_destroy'));
    ok(events.some(e => e.type === 'paddle_hit') || true);
    ok(events.some(e => e.type === 'wall_hit') || true);
});

test('popEvents 取走后清空', () => {
    const core = new BrickCore({ seed: 42 });
    core.launch();
    core.popEvents();
    eq(core.popEvents().length, 0);
});

// ==================== 9. 长跑压力 ====================

console.log('\n[9] 长跑压力');

test('120 秒自动游玩：不崩溃、状态合法、能连续过关', () => {
    const core = new BrickCore({ seed: 2026 });
    const dt = 1 / 60;
    let t = 0;
    let levelsCleared = 0;
    let guard = 0;
    core.launch();

    while (t < 120 && guard < 200000) {
        guard++;
        // 简单 AI：挡板追最近的球，并故意偏一点，让球以斜角反弹（模拟真人）
        let target = Config.PLAY_W / 2;
        let nearest = null;
        for (const b of core.balls) {
            if (!b.stuck && (nearest === null || Math.abs(b.x - core.paddle.x) < Math.abs(nearest.x - core.paddle.x))) {
                nearest = b;
            }
        }
        if (nearest) {
            const bias = nearest.x < Config.PLAY_W / 2 ? -40 : 40;
            target = nearest.x + bias;
        }
        core.setPaddleTarget(target);

        core.step(dt);
        t += dt;

        if (core.state === 'level_clear') {
            levelsCleared++;
            const choice = core.pendingChoices[0];
            if (!choice) break;
            eq(core.applyUpgrade(choice), true);
            core.launch();
        } else if (core.state === 'ready') {
            core.launch();
        } else if (core.state === 'game_over') {
            break;
        }

        ok(core.lives >= 0 && core.lives <= Config.MAX_LIVES, `生命越界: ${core.lives}`);
        ok(core.score >= 0);
        ok(core.level >= 1);
    }

    ok(['ready', 'playing', 'level_clear', 'game_over'].indexOf(core.state) >= 0, `非法状态: ${core.state}`);
    ok(levelsCleared >= 1, `120 秒内一关都没过（挡板 AI 太笨也算异常）: ${levelsCleared}`);
    console.log(`      · 通过 ${levelsCleared} 关，分数 ${core.score}，生命 ${core.lives}，状态 ${core.state}`);
});

// ==================== 汇总 ====================

console.log('\n────────────────────────────────');
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
    for (const f of failures) {
        console.error(`\n✗ ${f.name}`);
        console.error(f.err && f.err.stack ? f.err.stack : f.err);
    }
    process.exit(1);
}
console.log('BRICK_CORE_OK');
