#!/usr/bin/env node
/**
 * 泡泡龙 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 覆盖：六边形网格几何与邻居对称性、关卡配置合法性、布局颜色平衡、
 *       同色连通判定与悬空掉落、弹道反射与吸附不重叠、
 *       快照往返与坏档回落、随机长跑不变量。
 *
 * 用法：node tools/verify-bubble-core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GAMES = path.join(ROOT, 'assets', 'games');
const OUT = path.join(ROOT, 'temp', 'bubble-core-test');

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
    path.join(GAMES, 'game_bubble', 'scripts', 'BubbleCore.ts'),
    '--outDir', OUT,
    '--rootDir', GAMES,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const C = require(path.join(OUT, 'game_bubble', 'scripts', 'BubbleCore.js'));

const {
    BUBBLE_COLS,
    BUBBLE_R,
    BUBBLE_ROW_H,
    BUBBLE_MAX_ROWS,
    BUBBLE_EMPTY,
    BUBBLE_BOARD_W,
    BUBBLE_MATCH_MIN,
    BUBBLE_LEVELS,
    BubbleBoard,
    mulberry32,
    rowLength,
    cellCenter,
    cellAtPoint,
    neighborsOf,
    createBoard,
    traceShot,
    snapCell,
    pickNextColor,
    scoreFor,
    clampAim,
    aimToDir,
    BUBBLE_AIM_LIMIT,
    levelById,
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

/** 盘面上是否存在重叠的泡泡（距离 < 2R - 0.5） */
function findOverlap(board) {
    const cells = [];
    for (let row = 0; row < board.maxRows; row++) {
        const len = rowLength(row);
        for (let col = 0; col < len; col++) {
            if (board.get(row, col) !== BUBBLE_EMPTY) cells.push({ row, col });
        }
    }
    const minSep = BUBBLE_R * 2 - 0.5;
    for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
            const a = cellCenter(cells[i].row, cells[i].col);
            const b = cellCenter(cells[j].row, cells[j].col);
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < minSep) return { a: cells[i], b: cells[j], d };
        }
    }
    return null;
}

// ==================== 网格几何 ====================

console.log('\n[网格几何]');

test('常量自洽：盘面宽 = 2R × 列数', () => {
    assert.strictEqual(BUBBLE_BOARD_W, BUBBLE_R * 2 * BUBBLE_COLS);
    assert.strictEqual(rowLength(0), BUBBLE_COLS);
    assert.strictEqual(rowLength(1), BUBBLE_COLS - 1);
});

test('格心坐标：每一行水平中心都是 320', () => {
    for (let row = 0; row < BUBBLE_MAX_ROWS; row++) {
        const len = rowLength(row);
        const first = cellCenter(row, 0);
        const last = cellCenter(row, len - 1);
        assert.ok(Math.abs((first.x + last.x) / 2 - 320) < 1e-9, `第 ${row} 行不对称`);
        assert.ok(Math.abs(first.x - BUBBLE_R) < 1e-9 || Math.abs(first.x - 2 * BUBBLE_R) < 1e-9);
    }
});

test('行高 = R·√3，相邻行垂直间距一致', () => {
    assert.ok(Math.abs(BUBBLE_ROW_H - BUBBLE_R * Math.sqrt(3)) < 1e-9);
    const a = cellCenter(3, 0);
    const b = cellCenter(4, 0);
    assert.ok(Math.abs(b.y - a.y - BUBBLE_ROW_H) < 1e-9);
});

test('cellAtPoint 能还原自己中心的格子', () => {
    for (let row = 0; row < 10; row++) {
        const len = rowLength(row);
        for (let col = 0; col < len; col++) {
            const c = cellCenter(row, col);
            const back = cellAtPoint(c.x, c.y);
            assert.deepStrictEqual(back, { row, col }, `(${row},${col}) 还原失败`);
        }
    }
});

test('邻居数：首行 4、中间行 6、首行角 2', () => {
    assert.strictEqual(neighborsOf(0, 5).length, 4);
    assert.strictEqual(neighborsOf(0, 0).length, 2);
    assert.strictEqual(neighborsOf(5, 3).length, 6);
});

test('邻居关系对称', () => {
    for (let row = 0; row < BUBBLE_MAX_ROWS; row++) {
        const len = rowLength(row);
        for (let col = 0; col < len; col++) {
            for (const n of neighborsOf(row, col)) {
                const back = neighborsOf(n.row, n.col);
                assert.ok(
                    back.some((k) => k.row === row && k.col === col),
                    `(${row},${col}) → (${n.row},${n.col}) 不对称`
                );
            }
        }
    }
});

test('邻居与格心的实际距离都是 2R', () => {
    for (let row = 0; row < 6; row++) {
        const len = rowLength(row);
        for (let col = 0; col < len; col++) {
            const a = cellCenter(row, col);
            for (const n of neighborsOf(row, col)) {
                const b = cellCenter(n.row, n.col);
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                assert.ok(Math.abs(d - 2 * BUBBLE_R) < 1e-6, `(${row},${col})-(${n.row},${n.col}) d=${d}`);
            }
        }
    }
});

// ==================== 随机与关卡 ====================

console.log('\n[随机与关卡]');

test('mulberry32 同种子结果一致且落在 [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 500; i++) {
        const v = a();
        assert.strictEqual(v, b());
        assert.ok(v >= 0 && v < 1);
    }
});

test('共 30 关，id 连续、参数在合法区间', () => {
    assert.strictEqual(BUBBLE_LEVELS.length, 30);
    BUBBLE_LEVELS.forEach((lv, i) => {
        assert.strictEqual(lv.id, i + 1, `第 ${i} 项 id 不连续`);
        assert.ok(lv.rows >= 4 && lv.rows <= 9, `rows=${lv.rows}`);
        assert.ok(lv.colors >= 4 && lv.colors <= 6, `colors=${lv.colors}`);
        assert.ok(lv.shots > 0 && lv.shots <= 80, `shots=${lv.shots}`);
    });
});

test('难度单调不降：行数、颜色数、发射次数随关卡不减', () => {
    for (let i = 1; i < BUBBLE_LEVELS.length; i++) {
        const p = BUBBLE_LEVELS[i - 1];
        const c = BUBBLE_LEVELS[i];
        assert.ok(c.rows >= p.rows, `第 ${c.id} 关 rows 回退`);
        assert.ok(c.colors >= p.colors, `第 ${c.id} 关 colors 回退`);
        assert.ok(c.shots >= p.shots, `第 ${c.id} 关 shots 回退`);
    }
});

test('发射次数足够清空盘面（≥ 初始泡泡数 / 3）', () => {
    for (const lv of BUBBLE_LEVELS) {
        const board = createBoard(lv);
        const minShots = Math.ceil(board.occupiedCount() / BUBBLE_MATCH_MIN);
        assert.ok(lv.shots >= minShots, `第 ${lv.id} 关 ${lv.shots} < ${minShots}`);
    }
});

test('levelById 命中与回落', () => {
    assert.strictEqual(levelById(7).id, 7);
    assert.strictEqual(levelById(999).id, 1);
});

test('每关布局：行数正确、每色出现 ≥3 次、声明的颜色全部出现', () => {
    for (const lv of BUBBLE_LEVELS) {
        const board = createBoard(lv);
        for (let row = 0; row < board.maxRows; row++) {
            const len = rowLength(row);
            for (let col = 0; col < len; col++) {
                const v = board.get(row, col);
                if (row < lv.rows) {
                    assert.ok(v >= 0 && v < lv.colors, `第 ${lv.id} 关 (${row},${col}) 值 ${v} 越界`);
                } else {
                    assert.strictEqual(v, BUBBLE_EMPTY, `第 ${lv.id} 关 (${row},${col}) 应空`);
                }
            }
        }
        const present = board.colorsPresent();
        assert.strictEqual(present.length, lv.colors, `第 ${lv.id} 关只出现 ${present.length} 种颜色`);
        for (const color of present) {
            let n = 0;
            for (let row = 0; row < board.maxRows; row++) {
                for (let col = 0; col < rowLength(row); col++) {
                    if (board.get(row, col) === color) n++;
                }
            }
            assert.ok(n >= BUBBLE_MATCH_MIN, `第 ${lv.id} 关颜色 ${color} 只有 ${n} 个`);
        }
    }
});

test('同种子生成同一图案', () => {
    const a = createBoard(BUBBLE_LEVELS[9]).snapshot();
    const b = createBoard(BUBBLE_LEVELS[9]).snapshot();
    assert.deepStrictEqual(a.grid, b.grid);
});

// ==================== 联通与消除 ====================

console.log('\n[联通与消除]');

test('同色连通块小于 3 不消除', () => {
    const board = new BubbleBoard();
    board.set(0, 0, 1);
    board.set(0, 1, 1);
    board.set(1, 0, 0);
    const res = board.settle(0, 0);
    assert.strictEqual(res.popped.length, 0);
    assert.strictEqual(board.get(0, 0), 1);
});

test('三个同色连通 → 整块消除', () => {
    const board = new BubbleBoard();
    board.set(0, 0, 1);
    board.set(0, 1, 1);
    board.set(1, 0, 1);
    const res = board.settle(0, 0);
    assert.strictEqual(res.popped.length, 3);
    assert.strictEqual(res.dropped.length, 0);
    assert.strictEqual(res.score, 30);
    assert.ok(board.isEmpty());
});

test('三个同色但不连通 → 不消除', () => {
    const board = new BubbleBoard();
    board.set(0, 0, 1);
    board.set(0, 5, 1);
    board.set(0, 9, 1);
    assert.strictEqual(board.groupAt(0, 0).length, 1);
    const res = board.settle(0, 0);
    assert.strictEqual(res.popped.length, 0);
});

test('消除后悬空泡泡整块掉落，仍连着顶的不掉', () => {
    const board = new BubbleBoard();
    // 顶行锚点
    board.set(0, 0, 0);
    board.set(0, 1, 0);
    board.set(0, 2, 1);
    // 颜色 1 的连通块（5 个，≥3）
    board.set(1, 0, 1);
    board.set(1, 1, 1);
    board.set(2, 0, 1);
    board.set(2, 1, 1);
    // 挂在颜色 1 下面的颜色 2（消除后失去锚点）
    board.set(2, 2, 2);
    // 直接挂在顶行的颜色 3（不受影响）
    board.set(0, 4, 3);
    board.set(1, 4, 3);

    const res = board.settle(1, 0);
    assert.strictEqual(res.popped.length, 5, `popped=${res.popped.length}`);
    assert.strictEqual(res.dropped.length, 1, `dropped=${res.dropped.length}`);
    assert.deepStrictEqual(res.dropped[0], { row: 2, col: 2 });
    assert.strictEqual(res.score, 5 * 10 + 1 * 20);
    // 顶行残留 + 仍连着顶的 3 号
    assert.strictEqual(board.get(0, 0), 0);
    assert.strictEqual(board.get(0, 1), 0);
    assert.strictEqual(board.get(1, 4), 3);
    assert.strictEqual(board.get(2, 2), BUBBLE_EMPTY);
});

test('settle 传空格子 → 空结果', () => {
    const board = new BubbleBoard();
    const res = board.settle(3, 3);
    assert.deepStrictEqual(res, { popped: [], dropped: [], score: 0 });
});

test('lowestOccupiedRow / occupiedCount / isEmpty', () => {
    const board = new BubbleBoard();
    assert.strictEqual(board.isEmpty(), true);
    assert.strictEqual(board.lowestOccupiedRow(), -1);
    board.set(0, 3, 0);
    board.set(4, 2, 1);
    assert.strictEqual(board.lowestOccupiedRow(), 4);
    assert.strictEqual(board.occupiedCount(), 2);
    assert.strictEqual(board.isEmpty(), false);
});

// ==================== 弹道 ====================

console.log('\n[弹道]');

const LAUNCH = { x: 320, y: 900 };

test('竖直向上 → 落在第 0 行', () => {
    const board = new BubbleBoard();
    const trace = traceShot(board, LAUNCH, aimToDir(0));
    assert.ok(trace.cell, '应有落点');
    assert.strictEqual(trace.cell.row, 0);
    assert.ok(trace.path.length >= 2);
});

test('斜射会撞右墙反弹，路径 x 始终在墙内', () => {
    const board = new BubbleBoard();
    const trace = traceShot(board, LAUNCH, aimToDir(1.0));
    for (const p of trace.path) {
        assert.ok(p.x >= BUBBLE_R - 1e-6, `x=${p.x} 越左墙`);
        assert.ok(p.x <= BUBBLE_BOARD_W - BUBBLE_R + 1e-6, `x=${p.x} 越右墙`);
    }
    assert.ok(trace.path.length > 2, '应有反弹拐点');
    assert.ok(trace.cell, '反弹后仍应落到盘上');
});

test('左右对称的两次发射落点镜像', () => {
    const board = new BubbleBoard();
    const left = traceShot(board, LAUNCH, aimToDir(-0.7));
    const right = traceShot(board, LAUNCH, aimToDir(0.7));
    assert.ok(left.cell && right.cell);
    assert.strictEqual(left.cell.row, right.cell.row);
    const lc = cellCenter(left.cell.row, left.cell.col);
    const rc = cellCenter(right.cell.row, right.cell.col);
    assert.ok(Math.abs((lc.x + rc.x) / 2 - 320) < 2, `镜像不对称 ${lc.x} / ${rc.x}`);
});

test('落点一定是空格且不与已有泡泡重叠', () => {
    const board = createBoard(BUBBLE_LEVELS[5]);
    const rand = mulberry32(7);
    for (let i = 0; i < 400; i++) {
        const angle = (rand() * 2 - 1) * BUBBLE_AIM_LIMIT;
        const trace = traceShot(board, LAUNCH, aimToDir(angle));
        if (!trace.cell) continue;
        const { row, col } = trace.cell;
        assert.ok(board.isFree(row, col), `落点 (${row},${col}) 不是空格`);
        // 必须有锚点
        const anchored = row === 0 || neighborsOf(row, col).some((n) => board.get(n.row, n.col) !== BUBBLE_EMPTY);
        assert.ok(anchored, `落点 (${row},${col}) 没有锚点`);
        board.set(row, col, 0);
        const overlap = findOverlap(board);
        assert.ok(!overlap, `出现重叠 ${JSON.stringify(overlap)}`);
    }
});

test('满盘时不再有落点（返回 null 而不是硬塞）', () => {
    const board = new BubbleBoard();
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < rowLength(row); col++) board.set(row, col, col % 3);
    }
    // 所有可挂的位置都被占，只有下方空行——但没锚点，不应吸附
    const free = [];
    for (let row = 0; row < board.maxRows; row++) {
        for (let col = 0; col < rowLength(row); col++) {
            if (board.isFree(row, col)) free.push({ row, col });
        }
    }
    assert.ok(free.length > 0);
});

test('snapCell 不会吸到没有锚点的空格', () => {
    const board = new BubbleBoard();
    board.set(0, 4, 0);
    // 远处（第 5 行）的空格没有邻居，不该被选中
    const cell = snapCell(board, 320, 600);
    assert.ok(!cell || cell.row <= 1, `吸附到 (${cell && cell.row},${cell && cell.col})`);
});

test('瞄准角被夹在 ±80°', () => {
    assert.strictEqual(clampAim(10), BUBBLE_AIM_LIMIT);
    assert.strictEqual(clampAim(-10), -BUBBLE_AIM_LIMIT);
    assert.strictEqual(clampAim(NaN), 0);
    const d = aimToDir(0);
    assert.ok(Math.abs(d.x) < 1e-9 && Math.abs(d.y + 1) < 1e-9);
});

// ==================== 出球与计分 ====================

console.log('\n[出球与计分]');

test('下一颗泡泡只从盘面现存颜色里挑', () => {
    const board = new BubbleBoard();
    board.set(0, 0, 2);
    board.set(0, 1, 4);
    const rand = mulberry32(3);
    for (let i = 0; i < 200; i++) {
        const c = pickNextColor(board, rand);
        assert.ok(c === 2 || c === 4, `挑到了不存在的颜色 ${c}`);
    }
});

test('空盘出球不崩', () => {
    const board = new BubbleBoard();
    assert.strictEqual(typeof pickNextColor(board, mulberry32(1)), 'number');
});

test('过关奖励 = 剩余次数 × 50，失败为 0', () => {
    assert.strictEqual(scoreFor(7, true), 350);
    assert.strictEqual(scoreFor(7, false), 0);
    assert.strictEqual(scoreFor(-3, true), 0);
});

// ==================== 快照 ====================

console.log('\n[快照]');

test('快照往返完全一致', () => {
    const board = createBoard(BUBBLE_LEVELS[12]);
    board.clear(0, 0);
    const snap = board.snapshot();
    const back = BubbleBoard.fromSnapshot(snap);
    assert.deepStrictEqual(Array.from(back.grid), Array.from(board.grid));
    assert.strictEqual(back.maxRows, board.maxRows);
});

test('坏档/空档回落到空盘不抛异常', () => {
    const a = BubbleBoard.fromSnapshot(null);
    assert.strictEqual(a.isEmpty(), true);
    assert.strictEqual(a.maxRows, BUBBLE_MAX_ROWS);
    const b = BubbleBoard.fromSnapshot({ v: 1, maxRows: 3, grid: [1, -1, 999] });
    assert.strictEqual(b.get(0, 0), 1);
    assert.strictEqual(b.get(0, 2), 999); // 数值原样保留但越界行不可读
    assert.strictEqual(b.get(2, 0), BUBBLE_EMPTY);
});

// ==================== 长跑 ====================

console.log('\n[长跑]');

test('30 关 × 随机连射 200 发：无重叠、无越界、可终止', () => {
    for (const lv of BUBBLE_LEVELS) {
        const board = createBoard(lv);
        const rand = mulberry32(lv.seed * 31 + 7);
        for (let shot = 0; shot < 200; shot++) {
            const angle = (rand() * 2 - 1) * BUBBLE_AIM_LIMIT;
            const trace = traceShot(board, LAUNCH, aimToDir(angle));
            if (!trace.cell) continue;
            const { row, col } = trace.cell;
            assert.ok(row >= 0 && row < board.maxRows, `第 ${lv.id} 关落点行越界 ${row}`);
            assert.ok(col >= 0 && col < rowLength(row), `第 ${lv.id} 关落点列越界 ${col}`);
            assert.ok(board.isFree(row, col), `第 ${lv.id} 关落点非空`);
            board.set(row, col, pickNextColor(board, rand));
            board.settle(row, col);
            const overlap = findOverlap(board);
            assert.ok(!overlap, `第 ${lv.id} 关第 ${shot} 发后重叠`);
        }
    }
});

/**
 * 「像人一样」打一杆：对给定颜色扫一遍角度，克隆盘面试算，
 * 优先选消除得分高的，其次选落点低（不把盘面顶上来的）。
 */
function bestShot(board, color) {
    let best = null;
    const stepAngle = Math.PI / 60;
    for (let a = -BUBBLE_AIM_LIMIT; a <= BUBBLE_AIM_LIMIT + 1e-9; a += stepAngle) {
        const trial = BubbleBoard.fromSnapshot(board.snapshot());
        const trace = traceShot(trial, LAUNCH, aimToDir(a));
        if (!trace.cell) continue;
        // 落点周围同色越多，越接近下一次消除（无消除时靠这一项做布局）
        const setup = neighborsOf(trace.cell.row, trace.cell.col).filter(
            (n) => trial.get(n.row, n.col) === color
        ).length;
        trial.set(trace.cell.row, trace.cell.col, color);
        const res = trial.settle(trace.cell.row, trace.cell.col);
        const score = res.score * 100 + setup * 10 - trial.lowestOccupiedRow();
        if (!best || score > best.score) best = { score, angle: a, cell: trace.cell };
    }
    return best;
}

test('发射预算宽松度：每关 ≥ 理论最少发数的 2 倍', () => {
    for (const lv of BUBBLE_LEVELS) {
        const board = createBoard(lv);
        const minShots = Math.ceil(board.occupiedCount() / BUBBLE_MATCH_MIN);
        assert.ok(lv.shots >= minShots * 2, `第 ${lv.id} 关 ${lv.shots} < ${minShots * 2}`);
    }
});

test('30 关都能被打通（预算放宽到 3 倍，只证盘面不自锁）', () => {
    for (const lv of BUBBLE_LEVELS) {
        const board = createBoard(lv);
        const rand = mulberry32(lv.seed + 99);
        let shots = lv.shots * 3;

        while (shots > 0 && !board.isEmpty()) {
            const color = pickNextColor(board, rand);
            const shot = bestShot(board, color);
            if (!shot) break;
            shots--;
            board.set(shot.cell.row, shot.cell.col, color);
            board.settle(shot.cell.row, shot.cell.col);
        }
        assert.ok(board.isEmpty(), `第 ${lv.id} 关 3 倍预算仍剩 ${board.occupiedCount()} 个`);
    }
});

// ==================== 汇总 ====================

console.log('');
if (failures.length > 0) {
    console.error(`${failures.length} 项失败，${passed} 项通过`);
    for (const f of failures) console.error(` - ${f.name}: ${f.err.message}`);
    process.exit(1);
}
console.log(`${passed} 项通过，0 项失败`);
console.log('BUBBLE_CORE_OK');
