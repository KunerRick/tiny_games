#!/usr/bin/env node
/**
 * 数值冲刺 —— 纯逻辑回归自检（不启动 Cocos）。
 *
 * 覆盖 docs/specs/2026-11-01-game-gate-runner-design.md §8 的 12 项：
 * 门模板、乘除、钳制、门只触发一次、对拼公式、敌人死后继续前进、
 * 人数归零即结束、Boss 与胜利、生成确定性、生成合法性、180 s 自动游玩、平衡性。
 *
 * 用法：
 *   node tools/verify-gate-core.js
 *
 * 依赖：TypeScript 编译器。优先 TSC 环境变量，其次本地 node_modules，
 * 最后回落到 Cocos Creator 自带版本（路径见 AGENTS.md）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_gate_runner', 'scripts');
const OUT = path.join(ROOT, 'temp', 'gate-core-test');

const TSC_CANDIDATES = [
    process.env.TSC,
    path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc',
].filter(Boolean);

const tscPath = TSC_CANDIDATES.find((p) => fs.existsSync(p));
if (!tscPath) {
    console.error('找不到 tsc。请设置 TSC 环境变量，或在项目内 npm install。');
    process.exit(2);
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(`编译纯逻辑模块 → ${path.relative(ROOT, OUT)}`);
execFileSync(process.execPath, [
    tscPath,
    path.join(SRC, 'GateConfig.ts'),
    path.join(SRC, 'GateCore.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const Config = require(path.join(OUT, 'GateConfig.js'));
const { GateCore } = require(path.join(OUT, 'GateCore.js'));

const {
    START_COUNT, COUNT_MAX, FIRE_CAP, ENEMY_DRAIN_RATIO,
    GATE_W, GATE_LEFT_X, GATE_RIGHT_X, GATE_H,
    SEGMENT_LEN, SEGMENT_COUNT, BOSS_DISTANCE, CONTACT_DIST,
    PLAYER_X_MIN, PLAYER_X_MAX,
    applyGateOp, gateOpLabel, clampCount,
} = Config;

const LEFT_CENTER = GATE_LEFT_X + GATE_W / 2;
const RIGHT_CENTER = GATE_RIGHT_X + GATE_W / 2;

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
        console.log(`  ✗ ${name}`);
        console.log(`      ${err && err.message ? err.message : err}`);
    }
}

function approx(actual, expected, tol, label) {
    if (Math.abs(actual - expected) > tol) {
        throw new Error(`${label || '值'} 期望 ${expected} ±${tol}，实际 ${actual}`);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

// ==================== 自动驾驶辅助 ====================

/** 前方最近的、尚未触发的门 */
function nextGate(core) {
    let best = null;
    for (const g of core.gates) {
        if (g.left.used || g.right.used) continue;
        if (g.y < core.distance - 1) continue;
        if (!best || g.y < best.y) best = g;
    }
    return best;
}

/** 在该门的两侧里挑一侧：pick = 'better' | 'worse' */
function pickSide(core, gate, pick) {
    const cur = core.count;
    const l = applyGateOp(cur, gate.left.op);
    const r = applyGateOp(cur, gate.right.op);
    const leftBetter = l >= r;
    if (pick === 'better') return leftBetter ? 'left' : 'right';
    return leftBetter ? 'right' : 'left';
}

function runAutopilot(core, pick, maxSec) {
    const dt = 1 / 60;
    let t = 0;
    const limit = maxSec || 180;
    while (t < limit && core.state === 'running') {
        const g = nextGate(core);
        if (g && g.y - core.distance < 220) {
            core.setPlayerX(pickSide(core, g, pick) === 'left' ? LEFT_CENTER : RIGHT_CENTER);
        }
        core.step(dt);
        t += dt;
    }
    return t;
}

/** 一路推进到某个条件成立（或超时），返回耗时 */
function stepUntil(core, cond, maxSec) {
    const dt = 1 / 60;
    let t = 0;
    const limit = maxSec || 120;
    while (t < limit && core.state === 'running' && !cond(core)) {
        core.step(dt);
        t += dt;
    }
    return t;
}

// ==================== 1. 门模板 ====================

test('1. 门模板：每对左右各一个、操作合法、值 > 0、位置递增', () => {
    const core = new GateCore();
    core.startRun(12345);
    assert(core.gates.length === SEGMENT_COUNT / 2, `门对数应为 ${SEGMENT_COUNT / 2}，实际 ${core.gates.length}`);

    const kinds = new Set(['mul', 'div', 'add', 'sub']);
    let prevY = -1;
    for (const g of core.gates) {
        assert(g.y > prevY, `门的位置必须递增：${prevY} → ${g.y}`);
        prevY = g.y;
        for (const side of [g.left, g.right]) {
            assert(kinds.has(side.op.kind), `非法操作类型 ${side.op.kind}`);
            assert(side.op.value > 0, `操作值必须 > 0，实际 ${side.op.value}`);
            assert(side.used === false, '新开一局时门不应是已触发状态');
        }
        assert(!(g.left.op.kind === g.right.op.kind && g.left.op.value === g.right.op.value),
            '同一对门不应是同一个选项');
        assert(gateOpLabel(g.left.op).length > 0, '门文本不能为空');
    }
});

// ==================== 2. 乘法 / 除法 ====================

test('2. 乘除：×2 翻倍、÷2 向下取整且最低保留 1', () => {
    assert(applyGateOp(20, { kind: 'mul', value: 2 }) === 40, '20 ×2 应为 40');
    assert(applyGateOp(37, { kind: 'mul', value: 3 }) === 111, '37 ×3 应为 111');
    assert(applyGateOp(9, { kind: 'div', value: 2 }) === 4, '9 ÷2 应为 4（向下取整）');
    assert(applyGateOp(1, { kind: 'div', value: 2 }) === 1, '1 ÷2 最低保留 1');
    assert(applyGateOp(5, { kind: 'sub', value: 10 }) === 0, '−10 可以把 5 打到 0');
    assert(applyGateOp(0, { kind: 'mul', value: 2 }) === 0, '0 乘任何数仍为 0');
});

// ==================== 3. 钳制 ====================

test('3. 钳制：连乘不越 COUNT_MAX、不出现 NaN', () => {
    let v = START_COUNT;
    for (let i = 0; i < 40; i++) {
        v = applyGateOp(v, { kind: 'mul', value: 3 });
        assert(!isNaN(v), '出现了 NaN');
        assert(v <= COUNT_MAX, `越过上限：${v}`);
    }
    assert(clampCount(NaN) === 0, 'NaN 应被钳成 0');
    assert(clampCount(-5) === 0, '负数应被钳成 0');
    assert(clampCount(1e9) === COUNT_MAX, '超大值应被钳成上限');
});

// ==================== 4. 门只触发一次 ====================

test('4. 门只触发一次：同一对门停留 2 s 只生效一次', () => {
    const core = new GateCore();
    core.startRun(777);
    const first = core.gates[0];

    // 提前站到左半区，等门经过
    core.setPlayerX(LEFT_CENTER);
    let hits = 0;
    for (let i = 0; i < 180; i++) {          // 3 s
        core.step(1 / 60);
        for (const ev of core.popEvents()) if (ev.type === 'gate_hit') hits++;
        if (core.distance < first.y) continue;
        if (core.distance > first.y + 10) break;
    }

    assert(hits >= 1, '门应当触发过一次');
    assert(hits === 1, `门只应触发一次，实际 ${hits} 次`);
    assert(first.left.used && first.right.used, '一对门两侧都应标记为已用');

    // 再跑 2 s：同一对门不应再产生事件（期间经过别的门是允许的）
    let more = 0;
    for (let i = 0; i < 120; i++) {
        core.step(1 / 60);
        for (const ev of core.popEvents()) if (ev.type === 'gate_hit' && Math.abs(ev.y - first.y) < 1) more++;
    }
    assert(more === 0, `同一对门重复触发 ${more} 次`);
});

// ==================== 5. 敌人对拼公式 ====================

test('5. 对拼：dps = min(count, FIRE_CAP)，敌方按 atk + count×比例 扣血', () => {
    const core = new GateCore();
    core.startRun(2024);

    stepUntil(core, (c) => c.enemies.some((e) => e.engaged), 20);
    const enemy = core.enemies.find((e) => e.engaged);
    assert(enemy, '应当已经接触到第一个敌人');

    const hpBefore = enemy.hp;
    const countBefore = core.countExact;      // 用未取整值比较，否则会被 floor 差算成"人数上涨"
    const dt = 1 / 120;
    const expectDps = Math.min(core.count, FIRE_CAP);
    const expectDrain = enemy.atk + core.count * ENEMY_DRAIN_RATIO;

    core.step(dt);

    approx(hpBefore - enemy.hp, expectDps * dt, expectDps * dt * 0.05 + 0.5, '我方造成的伤害');
    approx(countBefore - core.countExact, expectDrain * dt, expectDrain * dt * 0.05 + 0.01, '我方损失的人数');
    assert(core.distance <= enemy.y, '对拼期间不应越过敌人');
});

// ==================== 6. 敌人死亡后继续前进 ====================

test('6. 敌人死亡后继续前进，事件顺序正确', () => {
    const core = new GateCore();
    core.startRun(2024);
    core.setPlayerX(LEFT_CENTER);

    const events = [];
    let killed = false;
    for (let i = 0; i < 60 * 20 && core.state === 'running'; i++) {
        core.step(1 / 60);
        for (const ev of core.popEvents()) {
            events.push(ev);
            if (ev.type === 'enemy_destroyed') killed = true;
        }
        if (killed) break;
    }
    assert(killed, '20 s 内应当能打死第一个敌人');

    const engagedIdx = events.findIndex((e) => e.type === 'enemy_engaged');
    const killedIdx = events.findIndex((e) => e.type === 'enemy_destroyed');
    assert(engagedIdx >= 0 && killedIdx > engagedIdx, '事件顺序应为 engaged → destroyed');

    const d0 = core.distance;
    for (let i = 0; i < 30; i++) core.step(1 / 60);
    assert(core.distance > d0, `敌人死后应继续前进：${d0} → ${core.distance}`);
});

// ==================== 7. 人数归零 ====================

test('7. 人数归零：立即 game_over，且不再前进', () => {
    const core = new GateCore();
    core.startRun(99);

    runAutopilot(core, 'worse', 60);
    assert(core.state === 'game_over', `一路选差门应当阵亡，实际状态 ${core.state}`);
    assert(core.count === 0, `阵亡时人数应为 0，实际 ${core.count}`);

    const d0 = core.distance;
    for (let i = 0; i < 120; i++) core.step(1 / 60);
    assert(core.distance === d0, 'game_over 后不应继续前进');
    assert(core.count === 0, 'game_over 后人数不应回升');
});

// ==================== 8. Boss 与胜利 ====================

test('8. Boss：到达后生成、击杀后 victory', () => {
    const core = new GateCore();
    core.startRun(4242);

    runAutopilot(core, 'better', 180);
    assert(core.state === 'victory', `一路选优门应当通关，实际状态 ${core.state}`);

    const boss = core.boss;
    assert(boss && !boss.alive, '结束时 Boss 应当已被击杀');
    // 玩家在「接触距离」就被 Boss 拦住，不会真的走到 BOSS_DISTANCE 这个坐标上
    assert(core.distance >= BOSS_DISTANCE - CONTACT_DIST - 1,
        `应当推进到 Boss 前，实际 ${core.distance}`);
    assert(core.score > 1000, `胜利分数应包含通关奖励，实际 ${core.score}`);
});

// ==================== 9. 生成确定性 ====================

test('9. 生成确定性：同 seed 序列完全一致，不同 seed 会变', () => {
    const a = new GateCore();
    const b = new GateCore();
    a.startRun(20260101);
    b.startRun(20260101);

    const dump = (c) => JSON.stringify({
        gates: c.gates.map((g) => [g.y, g.left.op.kind, g.left.op.value, g.right.op.kind, g.right.op.value]),
        enemies: c.enemies.map((e) => [e.y, e.hp, Math.round(e.atk * 1000)]),
    });
    assert(dump(a) === dump(b), '同 seed 生成的关卡应完全一致');

    let differs = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const c = new GateCore();
        c.startRun(seed);
        if (dump(c) !== dump(a)) { differs = true; break; }
    }
    assert(differs, '不同 seed 应生成不同的关卡');
});

// ==================== 10. 生成合法性 ====================

test('10. 生成合法性：门/敌人不重叠、顺序正确、Boss 唯一且在最后', () => {
    for (const seed of [1, 7, 42, 1024, 20260101]) {
        const core = new GateCore();
        core.startRun(seed);

        const marks = [];
        for (const g of core.gates) marks.push({ y: g.y, kind: 'gate' });
        for (const e of core.enemies) marks.push({ y: e.y, kind: e.boss ? 'boss' : 'enemy' });
        marks.sort((x, y) => x.y - y.y);

        for (let i = 1; i < marks.length; i++) {
            const gap = marks[i].y - marks[i - 1].y;
            assert(gap >= GATE_H, `seed ${seed}: 第 ${i} 与 ${i - 1} 个物体间距过近（${gap}）`);
        }

        const bosses = core.enemies.filter((e) => e.boss);
        assert(bosses.length === 1, 'Boss 必须且只能有一个');
        assert(bosses[0].y === BOSS_DISTANCE, 'Boss 位置应为 BOSS_DISTANCE');
        assert(marks[marks.length - 1].kind === 'boss', 'Boss 必须在最后');

        // 每个敌人都不允许在玩家出生点之前
        for (const e of core.enemies) assert(e.y > CONTACT_DIST, '敌人不应出现在出生点');
        for (const g of core.gates) assert(g.y > 100, '第一对门不应紧贴出生点');
    }
});

// ==================== 11. 180 s 自动游玩 ====================

test('11. 180 s 自动游玩：不崩溃、状态合法、能结束', () => {
    const seeds = [1, 2, 3, 4, 5];
    for (const seed of seeds) {
        const core = new GateCore();
        core.startRun(seed);
        runAutopilot(core, 'better', 180);

        assert(core.state === 'victory' || core.state === 'game_over', `seed ${seed}: 结束时状态应为终态，实际 ${core.state}`);
        assert(core.count >= 0 && core.count <= COUNT_MAX, `seed ${seed}: 人数越界 ${core.count}`);
        assert(isFinite(core.distance), `seed ${seed}: 距离不是有限数`);
        assert(core.count === 0 || core.state === 'victory', `seed ${seed}: 存活时应当通关`);
        assert(core.playerX >= PLAYER_X_MIN - 0.01 && core.playerX <= PLAYER_X_MAX + 0.01, '横移越界');
    }
});

// ==================== 12. 平衡性 ====================

test('12. 平衡性：一路优门通关且有盈余，一路劣门必死', () => {
    const seeds = [1, 42, 20260101];
    for (const seed of seeds) {
        const good = new GateCore();
        good.startRun(seed);
        runAutopilot(good, 'better', 180);
        assert(good.state === 'victory', `seed ${seed}: 优门线路应当通关，实际 ${good.state}`);
        assert(good.count > 0, `seed ${seed}: 通关时应有人数盈余`);

        const bad = new GateCore();
        bad.startRun(seed);
        runAutopilot(bad, 'worse', 180);
        assert(bad.state === 'game_over', `seed ${seed}: 劣门线路应当阵亡，实际 ${bad.state}`);
    }
});

// ==================== 汇总 ====================

console.log('');
if (failures.length === 0) {
    console.log(`GATE_CORE_OK  通过 ${passed}/12`);
    process.exit(0);
} else {
    console.log(`GATE_CORE_FAIL  通过 ${passed}/12，失败 ${failures.length} 项`);
    for (const f of failures) console.log(`  - ${f.name}: ${f.err && f.err.message}`);
    process.exit(1);
}
