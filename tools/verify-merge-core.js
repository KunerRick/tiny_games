#!/usr/bin/env node
/**
 * 合合大作战 —— 纯逻辑回归自检（不启动 Cocos）。
 *
 * 覆盖 docs/plans/2026-10-31-merge-physics-evaluation.md §5 的 12 项验收：
 * 自由落体、叠放稳定、10 果堆塔、合并、禁链式合并、顶果消除、墙体钳制、
 * 高速不穿模、确定性、失败判定、投放冷却、长跑。
 *
 * 用法：
 *   node tools/verify-merge-core.js
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
const SRC = path.join(ROOT, 'assets', 'games', 'game_merge', 'scripts');
const OUT = path.join(ROOT, 'temp', 'merge-core-test');

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
    path.join(SRC, 'MergeConfig.ts'),
    path.join(SRC, 'MergeCore.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const Config = require(path.join(OUT, 'MergeConfig.js'));
const { MergeCore, mulberry32 } = require(path.join(OUT, 'MergeCore.js'));

const {
    PLAY_W, PLAY_H, WALL_T, DROP_Y, MAX_TIER, GAME_OVER_LINE,
    GAME_OVER_HOLD_SEC, DROP_COOLDOWN_SEC, MAX_FRUITS, tierRadius,
} = Config;

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
    assert.ok(Math.abs(actual - expected) <= tolerance,
        msg || `期望 ${expected}±${tolerance}，实际 ${actual}`);
}

function fresh(seed = 12345) {
    const core = new MergeCore();
    core.startRun(seed);
    return core;
}

/** 以 1/60 帧推进 seconds 秒 */
function run(core, seconds, dt = 1 / 60) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) core.step(dt);
}

function speedOf(f) {
    return Math.hypot(f.vx, f.vy);
}

function maxSpeed(core) {
    let m = 0;
    for (const f of core.fruits) m = Math.max(m, speedOf(f));
    return m;
}

function assertAllFinite(core) {
    for (const f of core.fruits) {
        ok(Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.vx) && Number.isFinite(f.vy),
            `水果 #${f.id} 出现 NaN/Infinity`);
    }
}

/** 是否都在场内侧（允许 0.5px 数值误差） */
function assertInside(core, tol = 0.5) {
    for (const f of core.fruits) {
        const minX = WALL_T + f.r, maxX = PLAY_W - WALL_T - f.r, maxY = PLAY_H - WALL_T - f.r;
        ok(f.x >= minX - tol && f.x <= maxX + tol, `水果 #${f.id} x=${f.x.toFixed(2)} 越界 [${minX}, ${maxX}]`);
        ok(f.y <= maxY + tol, `水果 #${f.id} y=${f.y.toFixed(2)} 穿底（上限 ${maxY}）`);
    }
}

/** 交替层级竖直柱，避免同层接触被合并 —— 用于"叠放/堆塔/失败线"用例 */
function buildColumn(core, count, x) {
    let y = PLAY_H - WALL_T;
    for (let i = 0; i < count; i++) {
        const tier = i % 2 === 0 ? 0 : 1;
        const r = tierRadius(tier);
        y -= r;
        core.spawnFruit(tier, x, y);
        y -= r;
    }
}

function topY(core) {
    let min = Infinity;
    for (const f of core.fruits) min = Math.min(min, f.y - f.r);
    return min;
}

console.log('\n合合大作战 · 纯逻辑回归\n');

// ==================== 1. 单果自由落体 ====================
test('1. 单果自由落体：触底后静止且位置稳定', () => {
    const core = fresh();
    const f = core.spawnFruit(0, PLAY_W / 2, 200);
    run(core, 2);
    const floorY = PLAY_H - WALL_T - f.r;
    near(f.y, floorY, 2, `触底 y 应≈${floorY}，实际 ${f.y}`);
    ok(speedOf(f) < 5, `触底后速度应 < 5，实际 ${speedOf(f)}`);
    ok(f.sleeping, '低速持续后应进入休眠');
    const y0 = f.y;
    run(core, 3);
    near(f.y, y0, 0.01, '休眠后不应继续下陷');
});

// ==================== 2. 两果竖直叠放 ====================
test('2. 两果竖直叠放 5 s：相对位移 < 0.5 px，无 NaN', () => {
    const core = fresh();
    const a = core.spawnFruit(0, PLAY_W / 2, 600);
    const b = core.spawnFruit(1, PLAY_W / 2, 400);
    run(core, 2);
    assertAllFinite(core);
    const gap0 = Math.hypot(b.x - a.x, b.y - a.y);
    run(core, 5);
    const gap1 = Math.hypot(b.x - a.x, b.y - a.y);
    near(gap1, gap0, 0.5, `相对位移应 < 0.5px，实际 ${Math.abs(gap1 - gap0)}`);
    ok(a.sleeping && b.sleeping, '两果都应进入休眠');
    assertAllFinite(core);
});

// ==================== 3. 10 果堆塔 ====================
test('3. 10 果堆塔 10 s：高度漂移 < 2 px，最大速度 < 100', () => {
    const core = fresh();
    buildColumn(core, 10, PLAY_W / 2);
    run(core, 2);
    const h0 = topY(core);
    run(core, 10);
    const h1 = topY(core);
    near(h1, h0, 2, `10 s 后高度漂移应 < 2px，实际 ${Math.abs(h1 - h0)}`);
    ok(maxSpeed(core) < 100, `塔内最大速度应 < 100，实际 ${maxSpeed(core).toFixed(1)}`);
    assertAllFinite(core);
});

// ==================== 4. 同层接触合并 ====================
test('4. 同层接触合并：数量 −1、层级 +1、位置为中点', () => {
    const core = fresh();
    const a = core.spawnFruit(0, 300, 700);
    const b = core.spawnFruit(0, 343, 700);   // 相距 43 < 44+1.5
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    core.step(1 / 60);
    eq(core.fruits.length, 1, '两颗应合成一颗');
    eq(core.fruits[0].tier, 1, '层级应升到 1');
    near(core.fruits[0].x, midX, 1, '合并位置应在中点 x');
    near(core.fruits[0].y, midY, 1, '合并位置应在中点 y');
    eq(core.score, Config.mergeScore(0), '基础分');
    const events = core.popEvents().filter(e => e.type === 'merge');
    eq(events.length, 1, '应派发一次 merge 事件');
    eq(events[0].tier, 1, 'merge 事件层级');
});

// ==================== 5. 禁链式 ====================
test('5. 禁链式：2×2 同层一帧只升一级', () => {
    const core = fresh();
    // 两对同层水果，合并后两个产物在中点相距 44（半径和 56）→ 若不限制会同帧再合
    core.spawnFruit(0, 300, 700);
    core.spawnFruit(0, 344, 700);
    core.spawnFruit(0, 300, 744);
    core.spawnFruit(0, 344, 744);
    core.step(1 / 60);
    eq(core.fruits.length, 2, '同一步应只完成两次一级合并');
    eq(Math.max(...core.fruits.map(f => f.tier)), 1, '同一步内不得出现二级合并');
    // 下一步允许继续合并
    run(core, 0.2);
    ok(Math.max(...core.fruits.map(f => f.tier)) >= 2, '隔步后应能继续合并');
});

// ==================== 6. 顶果消除 ====================
test('6. 顶果消除：两个最大果合并后数量 −2、得分增加', () => {
    const core = fresh();
    const top = MAX_TIER - 1;
    core.spawnFruit(top, 300, 700);
    core.spawnFruit(top, 300 + tierRadius(top) * 2 - 1, 700);
    const before = core.fruits.length;
    const score0 = core.score;
    core.step(1 / 60);
    eq(core.fruits.length, before - 2, '顶果合并后两颗都消失');
    eq(core.score, score0 + Config.TOP_MERGE_SCORE, '得分增加 TOP_MERGE_SCORE');
    ok(core.popEvents().some(e => e.type === 'top_merge'), '应派发 top_merge 事件');
});

// ==================== 7. 墙内钳制 ====================
test('7. 墙体钳制：投放 x 永不越界', () => {
    // 待落水果的层级由 RNG 决定，钳制范围随它的半径变化
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
        const core = fresh(seed);
        const r = tierRadius(core.currentTier);
        core.setDropX(-9999);
        near(core.dropX, WALL_T + r, 1e-6, `左墙钳制失败（tier=${core.currentTier}）`);
        core.setDropX(9999);
        near(core.dropX, PLAY_W - WALL_T - r, 1e-6, `右墙钳制失败（tier=${core.currentTier}）`);
        checked++;
    }
    ok(checked === 40, '应检查 40 个 seed');

    // 贴边投放后不会越界
    const c2 = fresh();
    c2.setDropX(-9999);
    c2.drop();
    run(c2, 1);
    c2.setDropX(9999);
    c2.drop();
    run(c2, 1);
    assertInside(c2);
});

// ==================== 8. 高速下落 ====================
test('8. 高速下落：2400 px/s 不穿底、不穿墙', () => {
    const core = fresh();
    const big = MAX_TIER - 1;
    core.spawnFruit(big, PLAY_W / 2, 40, 0, Config.MAX_SPEED);
    core.spawnFruit(0, 120, 40, 0, Config.MAX_SPEED);
    core.spawnFruit(0, PLAY_W - 120, 40, -Config.MAX_SPEED, Config.MAX_SPEED);
    run(core, 1.5);
    assertAllFinite(core);
    assertInside(core);
    for (const f of core.fruits) {
        ok(f.y <= PLAY_H - WALL_T - f.r + 0.5, `水果 #${f.id} 穿底`);
    }
});

// ==================== 9. 确定性 ====================
test('9. 确定性：同 seed 两次跑 30 s 逐位相同', () => {
    const play = (seed) => {
        const core = fresh(seed);
        const rnd = mulberry32(seed ^ 0x5f5f);
        for (let i = 0; i < 30 * 60; i++) {
            if (i % 18 === 0) {
                core.setDropX(80 + rnd() * (PLAY_W - 160));
                core.drop();
            }
            core.step(1 / 60);
        }
        return core;
    };
    const a = play(20261031);
    const b = play(20261031);
    eq(a.score, b.score, '得分应一致');
    eq(a.state, b.state, '状态应一致');
    eq(
        a.fruits.map(f => [f.id, f.tier, f.x, f.y, f.vx, f.vy]),
        b.fruits.map(f => [f.id, f.tier, f.x, f.y, f.vx, f.vy]),
        '水果位置应逐位相同',
    );
    ok(a.fruits.length > 0, '30 s 后场上应还有水果');
});

// ==================== 10. 失败判定 ====================
test('10. 失败判定：越线静止 2 s 判负，短暂穿过不判负', () => {
    // 短暂穿过：高速下落的水果经过警戒线上方不应立即判负
    const fly = fresh();
    fly.spawnFruit(0, PLAY_W / 2, 60, 0, 600);
    run(fly, 0.3);
    eq(fly.state, 'playing', '高速穿过警戒线不应判负');

    // 堆到警戒线上方并保持静止（16 颗交替层级竖直柱，顶部中心 y≈64 < 150）
    const core = fresh();
    buildColumn(core, 16, PLAY_W / 2);
    ok(core.fruits.some(f => f.y < GAME_OVER_LINE), '测试前置：应有水果中心越过警戒线');
    run(core, GAME_OVER_HOLD_SEC * 0.5);
    eq(core.state, 'playing', '未满 2 s 不应判负');
    run(core, GAME_OVER_HOLD_SEC + 0.5);
    eq(core.state, 'game_over', '静止越线满 2 s 应判负');
    ok(core.popEvents().some(e => e.type === 'game_over'), '应派发 game_over 事件');
});

// ==================== 11. 投放冷却 ====================
test('11. 投放冷却：冷却内 drop() 返回 false', () => {
    const core = fresh();
    eq(core.drop(), true, '首次投放应成功');
    eq(core.drop(), false, '冷却内再次投放应失败');
    run(core, DROP_COOLDOWN_SEC * 0.5);
    eq(core.drop(), false, '冷却过半仍应失败');
    run(core, DROP_COOLDOWN_SEC * 0.6);
    eq(core.drop(), true, '冷却结束应恢复');
});

// ==================== 12. 长跑 ====================
test('12. 长跑：自动投放 500 颗不崩溃、状态合法', () => {
    const core = fresh(777);
    const rnd = mulberry32(777);
    let drops = 0;
    let frames = 0;
    const t0 = Date.now();
    while (drops < 500 && frames < 60 * 60 * 30) {
        if (core.state === 'game_over') {
            // 正常结局：结算后重开，继续统计
            core.startRun((rnd() * 0xffffffff) >>> 0);
        }
        if (frames % 12 === 0) {
            core.setDropX(40 + rnd() * (PLAY_W - 80));
            if (core.drop()) drops++;
        }
        core.step(1 / 60);
        frames++;
    }
    const ms = Date.now() - t0;
    eq(drops, 500, '应完成 500 次投放');
    ok(core.fruits.length <= MAX_FRUITS, `水果数不得超过 ${MAX_FRUITS}，实际 ${core.fruits.length}`);
    ok(['ready', 'playing', 'game_over'].includes(core.state), `状态非法：${core.state}`);
    ok(Number.isInteger(core.score) && core.score >= 0, `得分应为非负整数，实际 ${core.score}`);
    assertAllFinite(core);
    assertInside(core, 1);
    console.log(`      模拟 ${(frames / 60).toFixed(0)} s / ${frames} 帧，耗时 ${ms} ms`);
});

// ==================== 汇总 ====================

console.log('');
if (failures.length === 0) {
    console.log(`MERGE_CORE_OK  通过 ${passed}/${passed}`);
    process.exit(0);
} else {
    console.error(`MERGE_CORE_FAIL 失败 ${failures.length} / 共 ${passed + failures.length}`);
    for (const f of failures) console.error(`  - ${f.name}: ${f.err.message}`);
    process.exit(1);
}
