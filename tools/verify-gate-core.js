#!/usr/bin/env node
/**
 * 数值冲刺 —— 纯逻辑回归自检（不启动 Cocos）。
 *
 * 覆盖 docs/specs/2026-11-01-game-gate-runner-design.md §8 的 20 项：
 * 门模板、乘除、钳制、门只触发一次、对拼公式、敌人死后继续前进、
 * 人数归零即结束、Boss 与胜利、生成确定性、生成合法性、180 s 自动游玩、平衡性、
 * 集火、完美选门连击、门附加效果、敌人类型、弱点瞄准、三选一、Boss 三阶段、首门教学。
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
const { GateCore, gateSideFor } = require(path.join(OUT, 'GateCore.js'));

const {
    START_COUNT, COUNT_MAX, FIRE_CAP, ENEMY_DRAIN_RATIO,
    GATE_W, GATE_LEFT_X, GATE_RIGHT_X, GATE_H,
    SEGMENT_LEN, SEGMENT_COUNT, BOSS_DISTANCE, CONTACT_DIST,
    PLAYER_X_MIN, PLAYER_X_MAX,
    UPGRADE_CHOICES,
    applyGateOp, gateOpLabel, clampCount,
} = Config;

const TOTAL_TESTS = 20;

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

/** 三选一弹出来时必须选一张，否则世界停住 —— 自动驾驶统一选第一张 */
function autoChoose(core) {
    if (core.choiceOpen) core.choose(0);
}

function runAutopilot(core, pick, maxSec) {
    const dt = 1 / 60;
    let t = 0;
    const limit = maxSec || 180;
    while (t < limit && core.state === 'running') {
        autoChoose(core);
        const g = nextGate(core);
        if (g && g.y - core.distance < 220) {
            core.setPlayerX(pickSide(core, g, pick) === 'left' ? LEFT_CENTER : RIGHT_CENTER);
        }
        core.step(dt);
        t += dt;
    }
    return t;
}

/** 一路推进到某个条件成立（或超时），返回耗时。传 pick 会顺带按优/劣侧选门。 */
function stepUntil(core, cond, maxSec, pick) {
    const dt = 1 / 60;
    let t = 0;
    const limit = maxSec || 120;
    while (t < limit && core.state === 'running' && !cond(core)) {
        autoChoose(core);
        if (pick) {
            const g = nextGate(core);
            if (g && g.y - core.distance < 220) {
                core.setPlayerX(pickSide(core, g, pick) === 'left' ? LEFT_CENTER : RIGHT_CENTER);
            }
        }
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

test('5. 对拼：dps = min(count, 火力上限)，敌方按 atk + count×比例 × 护甲 扣血', () => {
    const core = new GateCore();
    core.startRun(2024);

    stepUntil(core, (c) => c.enemies.some((e) => e.engaged), 20);
    const enemy = core.enemies.find((e) => e.engaged);
    assert(enemy, '应当已经接触到第一个敌人');

    // 离开弱点，排除瞄准加成（弱点振幅不会摆到最左边）
    core.setPlayerX(PLAYER_X_MIN);

    const hpBefore = enemy.hp;
    const countBefore = core.countExact;      // 用未取整值比较，否则会被 floor 差算成"人数上涨"
    const dt = 1 / 120;
    const expectDps = Math.min(core.count, core.fireCap);
    const expectDrain = (enemy.atk + core.count * ENEMY_DRAIN_RATIO * Config.enemyProfile(enemy.kind).drainMult)
        * (1 - core.armorReduction);

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

// ==================== 13. 集火 ====================

test('13. 集火：短时 dps 放大，冷却期间不可再触发', () => {
    const make = () => {
        const core = new GateCore();
        core.startRun(4242);
        stepUntil(core, (c) => c.enemies.some((e) => e.engaged), 60, 'better');
        core.setPlayerX(PLAYER_X_MIN);   // 两次测量都离开弱点，只比较集火倍率
        return core;
    };

    const plain = make();
    const enemyPlain = plain.enemies.find((e) => e.alive && e.engaged);
    assert(enemyPlain, '应当已经在和第一个敌人对拼');
    const hpPlain = enemyPlain.hp;
    for (let i = 0; i < 24; i++) plain.step(1 / 60);      // 0.4 s
    const plainDrop = hpPlain - enemyPlain.hp;

    const boosted = make();
    const enemyBoosted = boosted.enemies.find((e) => e.alive && e.engaged);
    assert(boosted.pulseReady === true, '刚接敌时应可集火');
    assert(boosted.pulse() === true, '首次集火应成功');
    assert(boosted.pulseActive === true, '集火后应处于生效中');
    assert(boosted.pulse() === false, '冷却期间再点应失败');
    const hpBoosted = enemyBoosted.hp;
    for (let i = 0; i < 24; i++) boosted.step(1 / 60);
    const boostDrop = hpBoosted - enemyBoosted.hp;

    assert(plainDrop > 0, '不集火也应造成伤害');
    approx(boostDrop / plainDrop, Config.PULSE_DPS_MULT, 0.3, '集火 dps 倍率');

    stepUntil(boosted, (c) => c.pulseReady, 10, 'better');
    assert(boosted.pulseReady === true, '冷却结束后应可再次集火');
    assert(boosted.pulseCooldown <= 0.01, `冷却结束后读数应为 0，实际 ${boosted.pulseCooldown}`);
});

// ==================== 14. 完美选门连击 ====================

test('14. 完美连击：连续选优侧累计，每 3 连击给一次人数奖励，选差侧清零', () => {
    const core = new GateCore();
    core.startRun(1);

    const hits = [];
    const dt = 1 / 60;
    let t = 0;
    while (t < 180 && core.state === 'running' && hits.length < 8) {
        autoChoose(core);
        const g = nextGate(core);
        if (g && g.y - core.distance < 220) {
            core.setPlayerX(pickSide(core, g, 'better') === 'left' ? LEFT_CENTER : RIGHT_CENTER);
        }
        core.step(dt);
        t += dt;
        for (const ev of core.popEvents()) if (ev.type === 'gate_hit') hits.push(ev);
    }
    assert(hits.length >= 5, `应至少经过 5 对门，实际 ${hits.length}`);

    let expStreak = 0;
    let bonuses = 0;
    for (const ev of hits) {
        expStreak = ev.perfect ? expStreak + 1 : 0;
        assert(ev.streak === expStreak,
            `连击数不对：perfect=${ev.perfect} 期望 ${expStreak}，实际 ${ev.streak}`);
        if (ev.perfect && ev.streak > 0 && ev.streak % 3 === 0) {
            assert(ev.bonus > 0, `${ev.streak} 连击应给奖励，实际 ${ev.bonus}`);
            bonuses++;
        } else {
            assert(ev.bonus === 0, `非 3 的倍数不应给奖励：streak=${ev.streak} bonus=${ev.bonus}`);
        }
    }
    assert(bonuses >= 1, '一路选优侧应至少吃到 1 次连击奖励');

    // 一路选差侧：每对门都不完美，连击应一直是 0
    const bad = new GateCore();
    bad.startRun(1);
    let badOk = true;
    let badT = 0;
    while (badT < 120 && bad.state === 'running' && badOk) {
        autoChoose(bad);
        const g = nextGate(bad);
        if (g && g.y - bad.distance < 220) {
            bad.setPlayerX(pickSide(bad, g, 'worse') === 'left' ? LEFT_CENTER : RIGHT_CENTER);
        }
        bad.step(1 / 60);
        badT += 1 / 60;
        for (const ev of bad.popEvents()) {
            if (ev.type === 'gate_hit' && (ev.perfect || ev.streak !== 0 || ev.bonus !== 0)) badOk = false;
        }
    }
    assert(badOk, '一路选差侧不应累计连击或拿奖励');
});

// ==================== 15. 门附加效果 ====================

test('15. 门附加效果：选到带效果的一侧后生效，并在下一场对拼被消耗', () => {
    let core = null;
    let modGate = null;
    let modSide = null;
    let mod = null;

    for (let seed = 1; seed <= 40 && !core; seed++) {
        const c = new GateCore();
        c.startRun(seed);
        const g = c.gates.find((gg) => {
            const m = gg.left.mod || gg.right.mod;
            return m && m.kind !== 'cooldown';
        });
        if (!g) continue;
        const leftIsMod = !!g.left.mod && g.left.mod.kind !== 'cooldown';
        core = c;
        modGate = g;
        modSide = leftIsMod ? 'left' : 'right';
        mod = leftIsMod ? g.left.mod : g.right.mod;
    }
    assert(core, '生成里应当存在带护甲/火力效果的门');

    let hit = null;
    let t = 0;
    while (t < 60 && core.state === 'running' && core.distance < modGate.y + 1) {
        autoChoose(core);
        const g = nextGate(core);
        if (g && g.y - core.distance < 220) {
            const side = g === modGate ? modSide : pickSide(core, g, 'better');
            core.setPlayerX(side === 'left' ? LEFT_CENTER : RIGHT_CENTER);
        }
        core.step(1 / 60);
        t += 1 / 60;
        for (const ev of core.popEvents()) {
            if (ev.type === 'gate_hit' && Math.abs(ev.y - modGate.y) < 1) hit = ev;
        }
    }
    assert(hit, '应当触发目标门');
    assert(hit.mod && hit.mod.kind === mod.kind, 'gate_hit 事件应带上附加效果');

    const active = core.activeMods.find((m) => m.kind === mod.kind);
    assert(active, `附加效果应处于生效中（kind=${mod.kind}）`);
    if (mod.kind === 'armor') {
        assert(core.armorReduction >= mod.value - 1e-6, `护甲未计入减免：${core.armorReduction} < ${mod.value}`);
    }

    const before = active.fightsLeft;
    stepUntil(core, (c) => c.enemies.some((e) => e.engaged && e.y > modGate.y), 30, 'better');
    const after = core.activeMods.find((m) => m.kind === mod.kind);
    assert(!after || after.fightsLeft < before, `下一场对拼应消耗一层：${before} → ${after ? after.fightsLeft : 0}`);
});

// ==================== 16. 敌人类型 ====================

test('16. 敌人类型：合法、有数值差异，首个为步兵', () => {
    const core = new GateCore();
    core.startRun(7);

    const normal = core.enemies.filter((e) => !e.boss);
    assert(normal.length === SEGMENT_COUNT / 2, `普通敌人应为 ${SEGMENT_COUNT / 2} 个，实际 ${normal.length}`);
    const kinds = normal.map((e) => e.kind);
    for (const k of kinds) {
        assert(['grunt', 'shield', 'assassin', 'regen'].includes(k), `非法敌人类型 ${k}`);
    }
    assert(kinds[0] === 'grunt', '第一场战斗应是最简单的步兵');
    assert(new Set(kinds).size >= 2, '一局里应出现不止一种敌人');

    assert(Config.enemyHpAt(1000, 'shield') > Config.enemyHpAt(1000, 'grunt'), '盾兵应当更肉');
    assert(Config.enemyAtkAt(1000, 'assassin') > Config.enemyAtkAt(1000, 'grunt'), '刺客应当更疼');
    assert(Config.enemyRegenAt('regen', 100) > 0, '再生兵应当有回血');
    assert(Config.enemyRegenAt('grunt', 100) === 0, '步兵不应回血');

    const boss = core.boss;
    assert(boss && boss.kind === 'boss' && boss.phase === 1, 'Boss 初始应处于阶段 1');
});

// ==================== 17. 弱点瞄准 ====================

test('17. 弱点瞄准：停在弱点下方时 dps 按倍率放大', () => {
    const engage = (seed) => {
        const c = new GateCore();
        c.startRun(seed);
        stepUntil(c, (x) => x.enemies.some((e) => e.engaged), 30, 'better');
        return c;
    };

    const plainCore = engage(2024);
    plainCore.setPlayerX(PLAYER_X_MIN);       // 最左边，离弱点足够远
    const plainEnemy = plainCore.enemies.find((e) => e.engaged && e.alive);
    const plainHp = plainEnemy.hp;
    for (let i = 0; i < 18; i++) {
        plainCore.setPlayerX(PLAYER_X_MIN);
        plainCore.step(1 / 120);
    }
    const plainDrop = plainHp - plainEnemy.hp;

    const aimedCore = engage(2024);
    const aimedEnemy = aimedCore.enemies.find((e) => e.engaged && e.alive);
    const aimedHp = aimedEnemy.hp;
    for (let i = 0; i < 18; i++) {
        aimedCore.setPlayerX(aimedEnemy.weakX);
        aimedCore.step(1 / 120);
    }
    const aimedDrop = aimedHp - aimedEnemy.hp;

    assert(plainDrop > 0 && aimedDrop > 0, '两种站位都应造成伤害');
    approx(aimedDrop / plainDrop, aimedCore.aimMult, 0.2, '弱点击破倍率');
    assert(aimedCore.aiming === true, '站在弱点上应判定为瞄准中');
});

// ==================== 18. 三选一 ====================

function driveToChoice(seed, maxSec) {
    const core = new GateCore();
    core.startRun(seed);
    let t = 0;
    const limit = maxSec || 40;
    while (t < limit && core.state === 'running' && !core.choiceOpen) {
        const g = nextGate(core);
        if (g && g.y - core.distance < 220) {
            core.setPlayerX(pickSide(core, g, 'better') === 'left' ? LEFT_CENTER : RIGHT_CENTER);
        }
        core.step(1 / 60);
        t += 1 / 60;
    }
    return core;
}

test('18. 三选一：弹出时冻结世界、选项不重复、选完立即生效且同 seed 一致', () => {
    const core = driveToChoice(1);
    assert(core.choiceOpen, '第 3 对门之后应弹出三选一');
    assert(core.choiceOptions.length === UPGRADE_CHOICES, `应给 ${UPGRADE_CHOICES} 张卡`);
    assert(core.choiceOptions.length === 3, '实际应为 3 张');

    const ids = core.choiceOptions.map((o) => o.id);
    assert(new Set(ids).size === ids.length, '三张卡不应重复');

    const frozen = core.distance;
    for (let i = 0; i < 60; i++) core.step(1 / 60);
    assert(Math.abs(core.distance - frozen) < 1e-6, '三选一期间世界应冻结');
    assert(core.choose(99) === false, '非法下标应返回 false');

    const chosenName = core.choiceOptions[0].name;
    const before = {
        cap: core.fireCap,
        armor: core.armorReduction,
        aim: core.aimMult,
        streak: core.streakMultiplier,
        cdMult: core.pulseCooldownMultiplier,
        count: core.count,
    };
    assert(core.choose(0) === true, '选第一张卡应成功');
    assert(core.choiceOpen === false, '选完应关闭三选一');
    const changed = core.fireCap !== before.cap
        || core.armorReduction !== before.armor
        || core.aimMult !== before.aim
        || core.streakMultiplier !== before.streak
        || core.pulseCooldownMultiplier !== before.cdMult
        || core.count !== before.count;
    assert(changed, `选了「${chosenName}」后应至少有一项属性变化`);

    const other = driveToChoice(1);
    const otherIds = other.choiceOptions.map((o) => o.id);
    assert(JSON.stringify(otherIds) === JSON.stringify(ids), '同 seed 的三选一应当一致');
});

// ==================== 19. Boss 三阶段 ====================

test('19. Boss 三阶段：跨过血量阈值时切换，且每阶段只切一次', () => {
    const core = new GateCore();
    core.startRun(4242);
    const phases = [];
    let t = 0;
    while (t < 180 && core.state === 'running') {
        autoChoose(core);
        const g = nextGate(core);
        if (g && g.y - core.distance < 220) {
            core.setPlayerX(pickSide(core, g, 'better') === 'left' ? LEFT_CENTER : RIGHT_CENTER);
        }
        core.step(1 / 60);
        t += 1 / 60;
        for (const ev of core.popEvents()) if (ev.type === 'boss_phase') phases.push(ev.phase);
    }
    assert(core.state === 'victory', `应当通关，实际 ${core.state}`);
    assert(JSON.stringify(phases) === JSON.stringify([2, 3]), `阶段事件应为 [2,3]，实际 ${JSON.stringify(phases)}`);
    assert(core.boss && core.boss.phase === 3, 'Boss 死亡时应是阶段 3');
});

// ==================== 20. 首门教学 ====================

test('20. 首门教学：两侧都是加法，出生侧拿到更差的一边', () => {
    for (const seed of [1, 7, 42, 20260101]) {
        const core = new GateCore();
        core.startRun(seed);
        const gate = core.gates[0];
        assert(gate.left.op.kind === 'add' && gate.right.op.kind === 'add',
            `seed ${seed}: 首门应两侧都加人，实际 ${gate.left.op.kind}/${gate.right.op.kind}`);

        const spawnSide = gateSideFor(core.playerX);
        const spawnVal = applyGateOp(START_COUNT, spawnSide === 'left' ? gate.left.op : gate.right.op);
        const betterVal = applyGateOp(START_COUNT, spawnSide === 'left' ? gate.right.op : gate.left.op);
        assert(spawnVal < betterVal, `seed ${seed}: 出生侧应更差（${spawnVal} vs ${betterVal}）`);

        // 站着不动，第一次过门拿到的就是更差的那一边
        const idle = new GateCore();
        idle.startRun(seed);
        let hit = null;
        for (let i = 0; i < 300 && !hit; i++) {
            idle.step(1 / 60);
            for (const ev of idle.popEvents()) if (ev.type === 'gate_hit') hit = ev;
        }
        assert(hit && hit.after === spawnVal, `seed ${seed}: 不操作应拿到 ${spawnVal}，实际 ${hit && hit.after}`);
    }
});

// ==================== 汇总 ====================

console.log('');
if (failures.length === 0) {
    console.log(`GATE_CORE_OK  通过 ${passed}/${TOTAL_TESTS}`);
    process.exit(0);
} else {
    console.log(`GATE_CORE_FAIL  通过 ${passed}/${TOTAL_TESTS}，失败 ${failures.length} 项`);
    for (const f of failures) console.log(`  - ${f.name}: ${f.err && f.err.message}`);
    process.exit(1);
}
