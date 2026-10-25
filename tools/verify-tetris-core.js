#!/usr/bin/env node
/**
 * 方块坠落 —— 纯逻辑回归自检（不启动 Cocos）。
 *
 * 覆盖：SRS 四态、踢墙、7-bag、出生位置、棋盘碰撞、消行、Ghost、计分与重力表。
 *
 * 用法：
 *   node tools/verify-tetris-core.js
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
const SRC = path.join(ROOT, 'assets', 'games', 'game_tetris', 'scripts');
const OUT = path.join(ROOT, 'temp', 'tetris-core-test');

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
    path.join(SRC, 'TetrisConfig.ts'),
    path.join(SRC, 'TetrisPieces.ts'),
    path.join(SRC, 'TetrisBoard.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const Config = require(path.join(OUT, 'TetrisConfig.js'));
const Pieces = require(path.join(OUT, 'TetrisPieces.js'));
const { TetrisBoard } = require(path.join(OUT, 'TetrisBoard.js'));
const { PieceType, PIECE_TYPES, ActivePiece } = Pieces;

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

/** 把格子集合规整成可比较的字符串数组 */
function normalize(cells) {
    return cells.map(c => `${c.x},${c.y}`).sort();
}

/** 方块当前格子的本地偏移（去掉包围盒原点） */
function localCells(piece) {
    return normalize(Pieces.getPieceCells(piece).map(c => ({
        x: c.x - piece.x,
        y: c.y - piece.y,
    })));
}

function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function c(x, y) {
    return { x, y };
}

// ==================== SRS 四态 ====================

const EXPECTED_ROTATIONS = {
    [PieceType.I]: [
        [c(0, 2), c(1, 2), c(2, 2), c(3, 2)],
        [c(2, 3), c(2, 2), c(2, 1), c(2, 0)],
        [c(3, 1), c(2, 1), c(1, 1), c(0, 1)],
        [c(1, 0), c(1, 1), c(1, 2), c(1, 3)],
    ],
    [PieceType.O]: [
        [c(0, 1), c(1, 1), c(0, 0), c(1, 0)],
        [c(0, 1), c(1, 1), c(0, 0), c(1, 0)],
        [c(0, 1), c(1, 1), c(0, 0), c(1, 0)],
        [c(0, 1), c(1, 1), c(0, 0), c(1, 0)],
    ],
    [PieceType.T]: [
        [c(1, 2), c(0, 1), c(1, 1), c(2, 1)],
        [c(2, 1), c(1, 2), c(1, 1), c(1, 0)],
        [c(1, 0), c(2, 1), c(1, 1), c(0, 1)],
        [c(0, 1), c(1, 2), c(1, 1), c(1, 0)],
    ],
    [PieceType.S]: [
        [c(1, 2), c(2, 2), c(0, 1), c(1, 1)],
        [c(2, 1), c(2, 0), c(1, 2), c(1, 1)],
        [c(1, 0), c(0, 0), c(2, 1), c(1, 1)],
        [c(0, 1), c(0, 2), c(1, 0), c(1, 1)],
    ],
    [PieceType.Z]: [
        [c(0, 2), c(1, 2), c(1, 1), c(2, 1)],
        [c(2, 2), c(2, 1), c(1, 1), c(1, 0)],
        [c(2, 0), c(1, 0), c(1, 1), c(0, 1)],
        [c(0, 0), c(0, 1), c(1, 1), c(1, 2)],
    ],
    [PieceType.J]: [
        [c(0, 2), c(0, 1), c(1, 1), c(2, 1)],
        [c(2, 2), c(1, 2), c(1, 1), c(1, 0)],
        [c(2, 0), c(2, 1), c(1, 1), c(0, 1)],
        [c(0, 0), c(1, 0), c(1, 1), c(1, 2)],
    ],
    [PieceType.L]: [
        [c(2, 2), c(0, 1), c(1, 1), c(2, 1)],
        [c(2, 0), c(1, 2), c(1, 1), c(1, 0)],
        [c(0, 0), c(2, 1), c(1, 1), c(0, 1)],
        [c(0, 2), c(1, 2), c(1, 1), c(1, 0)],
    ],
};

const alwaysPlace = () => true;

for (const type of PIECE_TYPES) {
    test(`SRS 四态 — ${PieceType[type]}`, () => {
        let piece = { type, rot: 0, x: 0, y: 0 };
        for (let rot = 0; rot < 4; rot++) {
            eq(localCells(piece), normalize(EXPECTED_ROTATIONS[type][rot]), `rot=${rot}`);
            const next = Pieces.tryRotate(piece, 1, alwaysPlace);
            assert.ok(next, `rot=${rot} 顺时针旋转失败`);
            piece = next;
        }
        eq(piece.rot, 0, '旋转 4 次应回到状态 0');
    });

    test(`顺/逆时针互逆 — ${PieceType[type]}`, () => {
        const start = { type, rot: 0, x: 3, y: 5 };
        const cw = Pieces.tryRotate(start, 1, alwaysPlace);
        const back = Pieces.tryRotate(cw, -1, alwaysPlace);
        eq(localCells(back), localCells(start));
        eq(back.rot, 0);
    });
}

// ==================== 踢墙 ====================

test('踢墙：基础旋转被挡时尝试 (-1, 0)', () => {
    const board = new TetrisBoard();
    board.set(5, 1, PieceType.J);

    const piece = { type: PieceType.T, rot: 0, x: 3, y: 0 };
    // 基础旋转后 (5,1) 被占，第二个踢墙 (-1,0) 应成功
    const result = Pieces.tryRotate(piece, 1, cells => board.canPlace(cells));
    assert.ok(result, '应找到可行踢墙');
    eq(result.rot, 1);
    eq([result.x, result.y], [2, 0]);
    eq(board.canPlace(Pieces.getPieceCells(result)), true);
});

test('踢墙：全部尝试失败返回 null，且恰好尝试 5 次', () => {
    let attempts = 0;
    const result = Pieces.tryRotate({ type: PieceType.T, rot: 0, x: 3, y: 0 }, 1, () => {
        attempts++;
        return false;
    });
    eq(result, null);
    eq(attempts, 5);
});

test('踢墙表：I / JLSTZ 每对状态 5 个候选，O 只有原地', () => {
    for (const type of PIECE_TYPES) {
        for (let from = 0; from < 4; from++) {
            const to = (from + 1) & 3;
            const kicks = Pieces.getKicks(type, from, to);
            eq(kicks.length, type === PieceType.O ? 1 : 5, `${PieceType[type]} ${from}>${to}`);
            eq(kicks[0], c(0, 0), `${PieceType[type]} ${from}>${to} 首个候选应为原地`);
        }
    }
});

// ==================== 7-bag ====================

test('7-bag：连续 100 袋每袋 7 种齐全', () => {
    const bag = new Pieces.BagRandomizer(mulberry32(20261025));
    for (let i = 0; i < 100; i++) {
        const seen = new Set();
        for (let j = 0; j < 7; j++) seen.add(bag.next());
        eq(seen.size, 7, `第 ${i + 1} 袋重复`);
    }
});

test('7-bag：700 次抽取每种恰好 100 次', () => {
    const bag = new Pieces.BagRandomizer(mulberry32(7));
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 700; i++) counts[bag.next()]++;
    eq(counts, new Array(7).fill(100));
});

// ==================== 出生位置 ====================

test('出生位置：最低占用格都在第 18 行，且不越界', () => {
    for (const type of PIECE_TYPES) {
        const piece = Pieces.createPiece(type);
        const cells = Pieces.getPieceCells(piece);
        eq(cells.length, 4, `${PieceType[type]} 应为 4 格`);
        const minY = Math.min(...cells.map(cell => cell.y));
        eq(minY, Config.SPAWN_LOWEST_ROW, `${PieceType[type]} 最低格行号`);
        for (const cell of cells) {
            assert.ok(cell.x >= 0 && cell.x < Config.BOARD_COLS, `${PieceType[type]} x 越界: ${cell.x}`);
            assert.ok(cell.y >= 0 && cell.y < Config.BOARD_ROWS, `${PieceType[type]} y 越界: ${cell.y}`);
        }
    }
});

// ==================== 棋盘 ====================

test('碰撞：越界与占位都算不可放置', () => {
    const board = new TetrisBoard();
    eq(board.canPlace([c(-1, 0)]), false);
    eq(board.canPlace([c(10, 0)]), false);
    eq(board.canPlace([c(0, -1)]), false);
    eq(board.canPlace([c(0, 22)]), false);
    eq(board.canPlace([c(0, 0)]), true);
    board.set(0, 0, PieceType.I);
    eq(board.canPlace([c(0, 0)]), false);
});

test('锁定：写进棋盘并返回格子', () => {
    const board = new TetrisBoard();
    const piece = { type: PieceType.O, rot: 0, x: 4, y: 0 };
    const cells = board.lock(piece);
    eq(cells.length, 4);
    eq(board.get(4, 0), PieceType.O);
    eq(board.get(5, 1), PieceType.O);
    eq(board.get(4, 2), null);
});

test('消行：只检查可见行，隐藏行满不算', () => {
    const board = new TetrisBoard();
    for (let x = 0; x < Config.BOARD_COLS; x++) board.set(x, 20, PieceType.J);
    eq(board.findFullRows(), []);
});

test('消行：一次消两行并整体下移', () => {
    const board = new TetrisBoard();
    board.loadFromStrings([
        'IIIIIIIIII',
        'JJJJJJJJJJ',
        '..........',
    ]);
    eq(board.findFullRows(), [1, 2]);
    eq(board.clearRows([1, 2]), 2);
    eq(board.findFullRows(), []);
    eq(board.toStrings().every(line => line === '..........'), true);
});

test('消行：I 竖插补位 → 消行 → 上方格子下落', () => {
    const board = new TetrisBoard();
    board.loadFromStrings([
        '....I.....',
        '#########.',
    ]);
    eq(board.findFullRows(), [], '缺 x=9 时不应满行');

    const piece = { type: PieceType.I, rot: 1, x: 7, y: 0 }; // 竖 I 落在 x=9
    eq(board.canPlace(Pieces.getPieceCells(piece)), true);
    board.lock(piece);
    eq(board.findFullRows(), [0]);

    eq(board.clearRows([0]), 1);
    eq(board.findFullRows(), []);
    eq(board.get(9, 0), PieceType.I, '原第 1 行的 I 应落到第 0 行');
    eq(board.get(4, 0), PieceType.I, '原第 1 行的 I 应落到第 0 行');
    eq(board.get(9, 2), PieceType.I);
    eq(board.get(9, 3), null);
});

test('Ghost 与落点距离', () => {
    const board = new TetrisBoard();
    const o = Pieces.createPiece(PieceType.O); // y = 18
    eq(board.getDropDistance(o), 18);
    eq(board.getGhostY(o), 0);

    board.set(4, 0, PieceType.J);
    const ghostY = board.getGhostY(o);
    eq(ghostY, 1, '下方有障碍时应停在其上');
    eq(board.canPlace(Pieces.getPieceCells({ ...o, y: ghostY })), true);
    eq(board.canPlace(Pieces.getPieceCells({ ...o, y: ghostY - 1 })), false);
});

test('Lock Out：全部格子都在可见区之上', () => {
    const board = new TetrisBoard();
    eq(board.isLockOut({ type: PieceType.O, rot: 0, x: 4, y: 20 }), true);
    eq(board.isLockOut({ type: PieceType.O, rot: 0, x: 4, y: 19 }), false);
});

test('loadFromStrings / toStrings 往返一致', () => {
    const board = new TetrisBoard();
    const lines = [
        '..........',
        '..T.......',
        'ZZ...L....',
    ];
    board.loadFromStrings(lines);
    const out = board.toStrings();
    eq(out.slice(-3), lines);
});

// ==================== 计分 / 等级 / 重力 ====================

test('等级：每 10 行一级', () => {
    eq(Config.levelForLines(0), 1);
    eq(Config.levelForLines(9), 1);
    eq(Config.levelForLines(10), 2);
    eq(Config.levelForLines(25), 3);
});

test('计分：消行分数随等级缩放', () => {
    eq(Config.scoreForLines(0, 1), 0);
    eq(Config.scoreForLines(1, 1), 100);
    eq(Config.scoreForLines(2, 1), 300);
    eq(Config.scoreForLines(3, 1), 500);
    eq(Config.scoreForLines(4, 1), 800);
    eq(Config.scoreForLines(4, 3), 2400);
    eq(Config.scoreForLines(9, 2), 1600, '超过 4 行按 4 行算');
});

test('重力：随等级单调不增，且有下限', () => {
    let prev = Infinity;
    for (let level = 1; level <= 25; level++) {
        const g = Config.gravityInterval(level);
        assert.ok(g > 0, `level ${level} 重力应大于 0`);
        assert.ok(g <= prev + 1e-9, `level ${level} 重力不应变大`);
        assert.ok(g >= Config.MIN_GRAVITY_SEC - 1e-9, `level ${level} 不应低于下限`);
        prev = g;
    }
    eq(Config.gravityInterval(1), 1);
});

// ==================== 汇总 ====================

console.log('');
if (failures.length === 0) {
    console.log(`全部通过：${passed} 项`);
    process.exit(0);
}

console.error(`失败 ${failures.length} 项 / 通过 ${passed} 项`);
for (const f of failures) {
    console.error(`\n[${f.name}]`);
    console.error(f.err.stack || f.err.message);
}
process.exit(1);
