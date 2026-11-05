#!/usr/bin/env node
/**
 * 缤纷消除 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 覆盖：开局生成、交换合法性、消除 / 连锁 / 特殊块、重力补位、
 *       无解重排、长跑稳定性、关卡配置与星级、存档解析。
 *
 * 用法：node tools/verify-match3-core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_match3', 'scripts');
const OUT = path.join(ROOT, 'temp', 'match3-core-test');

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
    path.join(SRC, 'Match3Core.ts'),
    path.join(SRC, 'Match3Levels.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const {
    Match3Core,
    MATCH3_COLS,
    MATCH3_ROWS,
    MATCH3_BASE_SCORE,
    MATCH3_SPECIAL_SCORE,
    MATCH3_MAX_CHAIN,
    mulberry32,
} = require(path.join(OUT, 'Match3Core.js'));

const {
    MATCH3_LEVELS,
    MATCH3_LEVEL_COUNT,
    getMatch3Level,
    evaluateGoal,
    starsFor,
    goalText,
    goalProgressText,
    createDefaultSave,
    parseMatch3Save,
} = require(path.join(OUT, 'Match3Levels.js'));

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

const IDX = (r, c) => r * MATCH3_COLS + c;

/**
 * 以「无三连」的棋盘为底（color = (2r + c) % colors），再按 overrides 改写。
 * overrides: { [index]: color }，specials: { [index]: 'row'|'col'|'rainbow' }
 */
function board(colors, overrides, specials) {
    const cells = [];
    for (let r = 0; r < MATCH3_ROWS; r++) {
        for (let c = 0; c < MATCH3_COLS; c++) {
            const idx = IDX(r, c);
            const color = overrides && overrides[idx] !== undefined ? overrides[idx] : (2 * r + c) % colors;
            const special = specials && specials[idx] ? specials[idx] : 'none';
            cells.push({ color, special });
        }
    }
    return { v: 1, cols: MATCH3_COLS, rows: MATCH3_ROWS, colorCount: colors, cells };
}

function coreFrom(snapshot) {
    const core = Match3Core.fromSnapshot(snapshot, 12345);
    assert(core, '快照解析失败');
    return core;
}

function assertSane(core, label) {
    assert.strictEqual(core.cells.length, MATCH3_COLS * MATCH3_ROWS, `${label}：格子数不对`);
    for (let i = 0; i < core.cells.length; i++) {
        const cell = core.cells[i];
        assert(cell, `${label}：第 ${i} 格为空`);
        assert(Number.isInteger(cell.color) && cell.color >= 0 && cell.color < core.colorCount,
            `${label}：第 ${i} 格颜色 ${cell.color} 越界`);
        assert(cell.special === 'none' || cell.special === 'row' || cell.special === 'col' || cell.special === 'rainbow',
            `${label}：第 ${i} 格特殊类型非法 ${cell.special}`);
    }
}

// ==================== 生成 ====================

console.log('\n[开局生成]');

test('mulberry32 同种子可复现、不同种子有差异', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    assert.deepStrictEqual(seqA, seqB);
    assert(seqA.every((v) => v >= 0 && v < 1));
    const c = mulberry32(43);
    assert.notDeepStrictEqual([c(), c(), c()], seqA);
});

test('500 个种子 × 4/5 色：开局无三连、必有合法步、颜色合法', () => {
    const counts = [4, 5];
    for (const colors of counts) {
        for (let seed = 0; seed < 500; seed++) {
            const core = Match3Core.create(seed, colors);
            assertSane(core, `seed=${seed} colors=${colors}`);
            assert.strictEqual(core.findRuns().length, 0, `seed=${seed} colors=${colors} 开局就有三连`);
            assert(core.hasMove(), `seed=${seed} colors=${colors} 开局无合法步`);
            assert(core.cells.every((cell) => cell.special === 'none'), '开局不应有特殊块');
        }
    }
});

test('同种子生成结果一致，不同种子不同', () => {
    const a = Match3Core.create(7, 5);
    const b = Match3Core.create(7, 5);
    assert.deepStrictEqual(a.snapshot().cells, b.snapshot().cells);
    const c = Match3Core.create(8, 5);
    assert.notDeepStrictEqual(a.snapshot().cells, c.snapshot().cells);
});

// ==================== 交换合法性 ====================

console.log('\n[交换合法性]');

test('不相邻 / 同一格 / 越界的交换一律非法且棋盘不变', () => {
    const core = Match3Core.create(3, 5);
    const before = JSON.stringify(core.snapshot());
    assert.strictEqual(core.swap(0, 0), null);
    assert.strictEqual(core.swap(0, 2), null);
    assert.strictEqual(core.swap(0, IDX(1, 1)), null);
    assert.strictEqual(core.swap(-1, 0), null);
    assert.strictEqual(core.swap(0, 64), null);
    assert.strictEqual(JSON.stringify(core.snapshot()), before, '非法交换改动了棋盘');
});

test('不产生消除的相邻交换非法且棋盘不变', () => {
    // 底图 (2r+c)%5 上没有现成三连，左上角两格交换也不会产生三连
    const core = coreFrom(board(5));
    const before = JSON.stringify(core.snapshot());
    assert.strictEqual(core.swap(IDX(0, 0), IDX(0, 1)), null);
    assert.strictEqual(JSON.stringify(core.snapshot()), before);
});

test('合法交换结算后棋盘仍满格、无残留三连', () => {
    for (let seed = 0; seed < 200; seed++) {
        const core = Match3Core.create(seed, 5);
        const hint = core.findHint();
        assert(hint, `seed=${seed} 找不到提示`);
        const result = core.swap(hint[0], hint[1]);
        assert(result, `seed=${seed} 提示的交换被判非法`);
        assert(result.steps.length > 0, `seed=${seed} 交换没有消除`);
        assert.strictEqual(core.findRuns().length, 0, `seed=${seed} 结算后仍有三连`);
        assertSane(core, `seed=${seed} 结算后`);
        assert(core.hasMove(), `seed=${seed} 结算后无合法步却没重排`);
    }
});

// ==================== 特殊块 ====================

console.log('\n[特殊块]');

test('横向四连生成 col 炸弹', () => {
    const snap = board(5, {
        [IDX(0, 1)]: 0,
        [IDX(0, 2)]: 1,
        [IDX(0, 3)]: 0,
        [IDX(1, 2)]: 0,
    });
    const core = coreFrom(snap);
    assert.strictEqual(core.findRuns().length, 0, '底图不应有现成三连');
    const result = core.swap(IDX(0, 2), IDX(1, 2));
    assert(result, '四连交换被判非法');
    assert.strictEqual(result.steps[0].cleared.length, 3, '四连应消 3 格并留下炸弹');
    assert.strictEqual(core.specialAt(IDX(0, 2)), 'col', '横向四连应生成 col 炸弹');
});

test('纵向四连生成 row 炸弹', () => {
    const snap = board(5, {
        [IDX(0, 3)]: 0,
        [IDX(2, 3)]: 1,
        [IDX(3, 3)]: 0,
        [IDX(2, 2)]: 0,
    });
    const core = coreFrom(snap);
    assert.strictEqual(core.findRuns().length, 0, '底图不应有现成三连');
    const result = core.swap(IDX(2, 3), IDX(2, 2));
    assert(result, '纵向四连交换被判非法');
    // 消除后上方留下的炸弹会随重力下落，因此在第 3 列里找
    const bombRow = [0, 1, 2, 3, 4, 5, 6, 7].find((r) => core.specialAt(IDX(r, 3)) === 'row');
    assert.notStrictEqual(bombRow, undefined, '纵向四连应生成 row 炸弹');
});

test('五连生成 rainbow 彩球', () => {
    const snap = board(5, {
        [IDX(0, 1)]: 0,
        [IDX(0, 2)]: 1,
        [IDX(0, 3)]: 0,
        [IDX(0, 4)]: 0,
        [IDX(0, 5)]: 2,
        [IDX(1, 2)]: 0,
    });
    const core = coreFrom(snap);
    assert.strictEqual(core.findRuns().length, 0, '底图不应有现成三连');
    const result = core.swap(IDX(0, 2), IDX(1, 2));
    assert(result, '五连交换被判非法');
    assert.strictEqual(core.specialAt(IDX(0, 2)), 'rainbow', '五连应生成彩球');
    assert.strictEqual(result.steps[0].cleared.length, 4, '五连应消 4 格并留下彩球');
});

test('col 炸弹被消除时清整列，并计入 triggers', () => {
    const snap = board(5, {
        [IDX(0, 1)]: 0,
        [IDX(0, 2)]: 1,
        [IDX(1, 2)]: 0,
    }, {
        [IDX(0, 0)]: 'col',
    });
    const core = coreFrom(snap);
    const result = core.swap(IDX(0, 2), IDX(1, 2));
    assert(result, '交换被判非法');
    const step = result.steps[0];
    assert(step.triggers.indexOf(IDX(0, 0)) >= 0, '炸弹未被触发');
    assert(step.cleared.indexOf(IDX(5, 0)) >= 0, '炸弹未清掉同列远处格子');
    assert(step.cleared.length >= 3 + (MATCH3_ROWS - 1), `炸弹清格过少：${step.cleared.length}`);
});

test('rainbow 彩球被消除时清掉场上同色', () => {
    const snap = board(5, {
        [IDX(0, 1)]: 0,
        [IDX(0, 2)]: 1,
        [IDX(1, 2)]: 0,
    }, {
        [IDX(0, 0)]: 'rainbow',
    });
    const core = coreFrom(snap);
    const targetColor = core.colorAt(IDX(5, 5));
    const beforeCount = core.cells.filter((cell) => cell.color === targetColor).length;
    const result = core.swap(IDX(0, 2), IDX(1, 2));
    assert(result, '交换被判非法');
    const step = result.steps[0];
    assert(step.triggers.indexOf(IDX(0, 0)) >= 0, '彩球未被触发');
    const sameColorCleared = step.cleared.filter((idx) =>
        snap.cells[idx].color === targetColor).length;
    assert(sameColorCleared > 0, '彩球没清掉任何同色格');
    assert(sameColorCleared >= Math.min(beforeCount, 3), `彩球清色过少：${sameColorCleared}/${beforeCount}`);
});

test('特殊块互炸不会死循环，链数不超过上限', () => {
    const specials = {};
    for (let i = 0; i < 16; i++) specials[IDX(4 + (i % 4), i % 8)] = i % 2 === 0 ? 'row' : 'col';
    const snap = board(5, {
        [IDX(0, 1)]: 0,
        [IDX(0, 2)]: 1,
        [IDX(1, 2)]: 0,
    }, specials);
    const core = coreFrom(snap);
    const result = core.swap(IDX(0, 2), IDX(1, 2));
    assert(result, '交换被判非法');
    assert(result.steps.length <= MATCH3_MAX_CHAIN, `链数 ${result.steps.length} 超上限`);
    assertSane(core, '互炸后');
});

// ==================== 结算计分 ====================

console.log('\n[结算计分]');

test('每段得分 = 10 × 格数 × chain + 30 × 触发数，chain 从 1 递增', () => {
    for (let seed = 0; seed < 100; seed++) {
        const core = Match3Core.create(seed, 5);
        const hint = core.findHint();
        const result = core.swap(hint[0], hint[1]);
        assert(result);
        for (let i = 0; i < result.steps.length; i++) {
            const step = result.steps[i];
            assert.strictEqual(step.chain, i + 1, `seed=${seed} chain 序号不连续`);
            const expect = MATCH3_BASE_SCORE * step.cleared.length * step.chain
                + MATCH3_SPECIAL_SCORE * step.triggers.length;
            assert.strictEqual(step.score, expect, `seed=${seed} 第 ${step.chain} 段得分不符`);
            assert(step.cleared.length > 0, `seed=${seed} 出现空消除段`);
        }
        const totalScore = result.steps.reduce((sum, step) => sum + step.score, 0);
        assert.strictEqual(result.score, totalScore, `seed=${seed} 总分不符`);
        const totalCleared = result.steps.reduce((sum, step) => sum + step.cleared.length, 0);
        assert.strictEqual(result.clearedTotal, totalCleared, `seed=${seed} 消除总数不符`);
        const byColor = result.clearedByColor.reduce((sum, n) => sum + n, 0);
        assert.strictEqual(byColor, totalCleared, `seed=${seed} 颜色统计与总数不符`);
    }
});

test('连锁链数上限被遵守', () => {
    assert.ok(MATCH3_MAX_CHAIN >= 5 && MATCH3_MAX_CHAIN <= 100, '链数上限取值异常');
});

// ==================== 无解重排 ====================

console.log('\n[无解重排]');

test('shuffle 保留所有块的颜色与特殊属性', () => {
    const core = Match3Core.create(11, 5);
    core.cells[IDX(2, 3)].special = 'row';
    const before = core.cells.map((cell) => `${cell.color}${cell.special}`).sort().join(',');
    assert.strictEqual(core.shuffle(), true);
    const after = core.cells.map((cell) => `${cell.color}${cell.special}`).sort().join(',');
    assert.strictEqual(after, before, '重排改变了块的 multiset');
    assert.strictEqual(core.findRuns().length, 0, '重排后出现现成三连');
    assert(core.hasMove(), '重排后仍无合法步');
});

test('结算后无解会自动重排并置 shuffled', () => {
    const core = Match3Core.create(21, 5);
    const hint = core.findHint();
    const real = core.hasMove.bind(core);
    let calls = 0;
    core.hasMove = () => (calls++ === 0 ? false : real());
    const result = core.swap(hint[0], hint[1]);
    assert(result, '交换被判非法');
    assert.strictEqual(result.shuffled, true, '无解时未重排');
    assertSane(core, '重排后');
    assert(real(), '重排后仍无合法步');
});

// ==================== 长跑 ====================

console.log('\n[长跑]');

test('10,000 次随机交换不崩、不越界、无可消除残留', () => {
    const core = Match3Core.create(99, 5);
    let valid = 0;
    const started = Date.now();
    for (let i = 0; i < 10000; i++) {
        const idx = Math.floor(Math.random() * core.cells.length);
        const dirs = [idx + 1, idx - 1, idx + MATCH3_COLS, idx - MATCH3_COLS];
        const other = dirs[Math.floor(Math.random() * dirs.length)];
        const result = core.swap(idx, other);
        if (result) {
            valid++;
            assert(Number.isFinite(result.score) && result.score > 0, `第 ${i} 次得分异常 ${result.score}`);
            assert.strictEqual(core.findRuns().length, 0, `第 ${i} 次后仍有三连`);
        }
        if (i % 1000 === 0) assertSane(core, `第 ${i} 次`);
    }
    const elapsed = Date.now() - started;
    assert(valid > 500, `10,000 次随机交换只有 ${valid} 次合法，棋盘可能卡死`);
    assert(elapsed < 20000, `长跑耗时过长：${elapsed}ms`);
});

// ==================== 存档 ====================

console.log('\n[存档]');

test('快照往返一致', () => {
    const core = Match3Core.create(5, 5);
    const hint = core.findHint();
    core.swap(hint[0], hint[1]);
    const snap = core.snapshot();
    const restored = Match3Core.fromSnapshot(JSON.parse(JSON.stringify(snap)), 1);
    assert(restored, '快照解析失败');
    assert.deepStrictEqual(restored.snapshot(), snap);
});

test('坏快照返回 null 或回落到合法棋盘', () => {
    const bad = [null, undefined, 0, '', 'x', [], {}, { cols: 8, rows: 8, colorCount: 5, cells: [] }];
    for (const raw of bad) {
        const core = Match3Core.fromSnapshot(raw, 1);
        if (core) assertSane(core, '坏快照');
    }
    const tooBig = { v: 1, cols: 99, rows: 99, colorCount: 5, cells: [] };
    assert.strictEqual(Match3Core.fromSnapshot(tooBig, 1), null, '超大棋盘未被拒绝');
    const badColor = board(5);
    badColor.cells[0].color = 99;
    assert.strictEqual(Match3Core.fromSnapshot(badColor, 1), null, '越界颜色未被拒绝');
    const badSpecial = board(5);
    badSpecial.cells[0].special = 'bomb';
    assert.strictEqual(Match3Core.fromSnapshot(badSpecial, 1), null, '非法特殊类型未被拒绝');
});

// ==================== 关卡 ====================

console.log('\n[关卡]');

test('30 关配置合法且单调递增', () => {
    assert.strictEqual(MATCH3_LEVELS.length, MATCH3_LEVEL_COUNT);
    let prevMoves = 0;
    for (let i = 0; i < MATCH3_LEVELS.length; i++) {
        const lv = MATCH3_LEVELS[i];
        assert.strictEqual(lv.id, i + 1, '关卡序号不连续');
        assert(lv.moves > 0, `第 ${lv.id} 关步数非法`);
        assert(lv.moves >= prevMoves, `第 ${lv.id} 关步数下降`);
        prevMoves = lv.moves;
        assert(lv.colorCount === 4 || lv.colorCount === 5, `第 ${lv.id} 关颜色数异常`);
        assert(lv.goal.value > 0, `第 ${lv.id} 关目标非正`);
        assert(['score', 'collect', 'clear'].indexOf(lv.goal.type) >= 0, `第 ${lv.id} 关目标类型异常`);
        if (lv.goal.type === 'collect') {
            assert(lv.goal.color >= 0 && lv.goal.color < lv.colorCount, `第 ${lv.id} 关目标颜色越界`);
        }
        assert(goalText(lv).length > 0, `第 ${lv.id} 关缺少目标文案`);
    }
    const types = new Set(MATCH3_LEVELS.map((lv) => lv.goal.type));
    assert.strictEqual(types.size, 3, '三种目标类型没有全部出现');
});

test('关卡目标随序号提升', () => {
    for (let i = 1; i < MATCH3_LEVELS.length; i++) {
        const prev = MATCH3_LEVELS[i - 1];
        const cur = MATCH3_LEVELS[i];
        if (prev.goal.type === cur.goal.type) {
            assert(cur.goal.value > prev.goal.value, `第 ${cur.id} 关目标没有提高`);
        }
    }
});

test('getMatch3Level 兜底非法序号', () => {
    assert.strictEqual(getMatch3Level(1).id, 1);
    assert.strictEqual(getMatch3Level(30).id, 30);
    assert.strictEqual(getMatch3Level(0).id, 1);
    assert.strictEqual(getMatch3Level(-5).id, 1);
    assert.strictEqual(getMatch3Level(999).id, 30);
    assert.strictEqual(getMatch3Level(NaN).id, 1);
});

test('目标进度计算正确', () => {
    const scoreLevel = { id: 1, moves: 20, colorCount: 5, goal: { type: 'score', value: 1000 } };
    assert.deepStrictEqual(
        evaluateGoal(scoreLevel, { score: 500, clearedTotal: 0, clearedByColor: [] }),
        { ratio: 0.5, current: 500, target: 1000, reached: false },
    );
    assert.strictEqual(evaluateGoal(scoreLevel, { score: 1200, clearedTotal: 0, clearedByColor: [] }).reached, true);

    const clearLevel = { id: 2, moves: 20, colorCount: 5, goal: { type: 'clear', value: 50 } };
    assert.strictEqual(evaluateGoal(clearLevel, { score: 0, clearedTotal: 20, clearedByColor: [] }).ratio, 0.4);

    const collectLevel = { id: 3, moves: 20, colorCount: 5, goal: { type: 'collect', value: 10, color: 2 } };
    const state = evaluateGoal(collectLevel, { score: 0, clearedTotal: 99, clearedByColor: [0, 0, 11, 0, 0] });
    assert.strictEqual(state.current, 11);
    assert.strictEqual(state.reached, true);
    assert.strictEqual(state.ratio, 1, '进度应封顶为 1');
    assert(goalProgressText(collectLevel, { score: 0, clearedTotal: 0, clearedByColor: [0, 0, 4, 0, 0] }).indexOf('4/10') >= 0);
});

test('星级折算边界', () => {
    const scoreLevel = { id: 1, moves: 20, colorCount: 5, goal: { type: 'score', value: 1000 } };
    const p = (score) => ({ score, clearedTotal: 0, clearedByColor: [] });
    assert.strictEqual(starsFor(scoreLevel, p(999), 10), 0);
    assert.strictEqual(starsFor(scoreLevel, p(1000), 10), 1);
    assert.strictEqual(starsFor(scoreLevel, p(1500), 10), 2);
    assert.strictEqual(starsFor(scoreLevel, p(2000), 10), 3);

    const collectLevel = { id: 2, moves: 20, colorCount: 5, goal: { type: 'collect', value: 10, color: 0 } };
    const c = { score: 0, clearedTotal: 0, clearedByColor: [10, 0, 0, 0, 0] };
    assert.strictEqual(starsFor(collectLevel, c, 0), 1);
    assert.strictEqual(starsFor(collectLevel, c, 6), 2);
    assert.strictEqual(starsFor(collectLevel, c, 12), 3);
    assert.strictEqual(starsFor(collectLevel, { score: 0, clearedTotal: 0, clearedByColor: [9, 0, 0, 0, 0] }, 20), 0);
});

test('存档解析：坏档回落、越界 clamp', () => {
    assert.deepStrictEqual(parseMatch3Save(null), createDefaultSave());
    assert.deepStrictEqual(parseMatch3Save('x'), createDefaultSave());
    assert.deepStrictEqual(parseMatch3Save({}), createDefaultSave());

    const save = parseMatch3Save({ level: 999, bestScore: -5, stars: [9, -1, 2] });
    assert.strictEqual(save.level, MATCH3_LEVEL_COUNT);
    assert.strictEqual(save.bestScore, 0);
    assert.strictEqual(save.stars[0], 3);
    assert.strictEqual(save.stars[1], 0);
    assert.strictEqual(save.stars[2], 2);
    assert.strictEqual(save.stars.length, MATCH3_LEVEL_COUNT);

    const roundTrip = parseMatch3Save(JSON.parse(JSON.stringify(createDefaultSave())));
    assert.deepStrictEqual(roundTrip, createDefaultSave());
});

// ==================== 汇总 ====================

console.log(`\n共 ${passed + failures.length} 项，通过 ${passed} 项，失败 ${failures.length} 项。`);
if (failures.length > 0) {
    for (const f of failures) {
        console.error(`\n[${f.name}]`);
        console.error(f.err.stack);
    }
    process.exit(1);
}
console.log('缤纷消除核心自检通过。');
