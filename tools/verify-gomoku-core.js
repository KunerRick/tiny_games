#!/usr/bin/env node
/**
 * 五子棋 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 覆盖：四方向胜负、边界、长连、平局、落子合法性、悔棋精确还原、
 *       AI 合法性 / 必赢 / 必堵 / 三档自对弈 / 确定性、棋型评分与候选点剪枝。
 *
 * 用法：node tools/verify-gomoku-core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_gomoku', 'scripts');
const OUT = path.join(ROOT, 'temp', 'gomoku-core-test');

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
    path.join(SRC, 'GomokuCore.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const {
    GomokuCore,
    GOMOKU_BLACK,
    GOMOKU_WHITE,
    GOMOKU_DRAW,
    GOMOKU_SCORES,
    collectCandidates,
    findWinLine,
    wouldWinOn,
    scoreMoveFor,
} = require(path.join(OUT, 'GomokuCore.js'));

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

/** 直接放置一个子（测试构造用，绕过回合） */
function put(core, r, c, player) {
    core.board[core.indexOf(r, c)] = player;
}

function makeBoard(size = 15) {
    return new Uint8Array(size * size);
}

/** 构造一个满盘无五连的图案：((r + 2c) % 4) < 2 ? BLACK : WHITE */
function fillNoFive(core) {
    const size = core.size;
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const v = (r + 2 * c) % 4;
            core.board[core.indexOf(r, c)] = v < 2 ? GOMOKU_BLACK : GOMOKU_WHITE;
        }
    }
}

// ==================== 胜负判定 ====================

console.log('\n[胜负判定]');

test('横向五连判胜', () => {
    const core = new GomokuCore();
    for (let c = 3; c <= 6; c++) put(core, 7, c, GOMOKU_BLACK);
    put(core, 7, 7, GOMOKU_BLACK);
    const line = findWinLine(core.board, core.size, core.indexOf(7, 7), GOMOKU_BLACK);
    assert.strictEqual(line.length, 5);
});

test('纵向五连判胜', () => {
    const core = new GomokuCore();
    for (let r = 2; r <= 6; r++) put(core, r, 4, GOMOKU_WHITE);
    const line = findWinLine(core.board, core.size, core.indexOf(6, 4), GOMOKU_WHITE);
    assert.strictEqual(line.length, 5);
});

test('主斜线五连判胜', () => {
    const core = new GomokuCore();
    for (let k = 0; k < 5; k++) put(core, 3 + k, 3 + k, GOMOKU_BLACK);
    const line = findWinLine(core.board, core.size, core.indexOf(7, 7), GOMOKU_BLACK);
    assert.strictEqual(line.length, 5);
});

test('副斜线五连判胜', () => {
    const core = new GomokuCore();
    for (let k = 0; k < 5; k++) put(core, 3 + k, 11 - k, GOMOKU_WHITE);
    const line = findWinLine(core.board, core.size, core.indexOf(7, 7), GOMOKU_WHITE);
    assert.strictEqual(line.length, 5);
});

test('四连不算胜', () => {
    const core = new GomokuCore();
    for (let c = 3; c <= 6; c++) put(core, 7, c, GOMOKU_BLACK);
    assert.strictEqual(findWinLine(core.board, core.size, core.indexOf(7, 6), GOMOKU_BLACK).length, 0);
    assert.strictEqual(wouldWinOn(core.board, core.size, core.indexOf(7, 7), GOMOKU_BLACK), true);
});

test('长连（6 子）判胜且胜线包含 6 格', () => {
    const core = new GomokuCore();
    for (let c = 2; c <= 7; c++) put(core, 5, c, GOMOKU_WHITE);
    const line = findWinLine(core.board, core.size, core.indexOf(5, 5), GOMOKU_WHITE);
    assert.strictEqual(line.length, 6);
});

test('靠边五连判胜（不越界）', () => {
    const core = new GomokuCore();
    for (let c = 0; c <= 4; c++) put(core, 0, c, GOMOKU_BLACK);
    assert.strictEqual(findWinLine(core.board, core.size, core.indexOf(0, 2), GOMOKU_BLACK).length, 5);
    for (let c = 10; c <= 14; c++) put(core, 14, c, GOMOKU_BLACK);
    assert.strictEqual(findWinLine(core.board, core.size, core.indexOf(14, 12), GOMOKU_BLACK).length, 5);
});

test('隔断的四连不判胜', () => {
    const core = new GomokuCore();
    put(core, 4, 4, GOMOKU_BLACK);
    put(core, 4, 5, GOMOKU_BLACK);
    put(core, 4, 7, GOMOKU_BLACK);
    put(core, 4, 8, GOMOKU_BLACK);
    assert.strictEqual(findWinLine(core.board, core.size, core.indexOf(4, 5), GOMOKU_BLACK).length, 0);
});

// ==================== 落子与回合 ====================

console.log('\n[落子与回合]');

test('黑先白后、交替行棋', () => {
    const core = new GomokuCore();
    assert.strictEqual(core.current, GOMOKU_BLACK);
    assert.ok(core.place(7, 7));
    assert.strictEqual(core.current, GOMOKU_WHITE);
    assert.ok(core.place(7, 8));
    assert.strictEqual(core.current, GOMOKU_BLACK);
    assert.strictEqual(core.moveCount, 2);
    assert.strictEqual(core.lastMove, core.indexOf(7, 8));
});

test('重复点 / 越界 / 终局后落子非法', () => {
    const core = new GomokuCore();
    assert.ok(core.place(7, 7));
    assert.strictEqual(core.place(7, 7), false);
    assert.strictEqual(core.place(-1, 0), false);
    assert.strictEqual(core.place(15, 0), false);
    core.reset();
    // 黑白交替落子，让黑方在 0 行连成五子
    const seq = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3], [0, 4]];
    for (const [r, c] of seq) assert.ok(core.place(r, c), `落子 ${r},${c} 失败`);
    assert.strictEqual(core.winner, GOMOKU_BLACK);
    assert.strictEqual(core.place(5, 5), false);
});

// ==================== 平局 ====================

console.log('\n[平局]');

test('满盘无五连判平局', () => {
    const core = new GomokuCore();
    fillNoFive(core);
    // 填满除 (14,14) 之外的所有点，最后一手由 place() 落下
    const lastR = 14;
    const lastC = 14;
    const lastPlayer = core.board[core.indexOf(lastR, lastC)];
    core.board[core.indexOf(lastR, lastC)] = 0;
    core.moveCount = core.size * core.size - 1;
    core.current = lastPlayer;
    // 记录历史形状不影响判定
    assert.ok(core.place(lastR, lastC));
    assert.strictEqual(core.winner, GOMOKU_DRAW);
    assert.strictEqual(core.isOver, true);
    assert.strictEqual(core.isDraw, true);
});

// ==================== 悔棋 ====================

console.log('\n[悔棋]');

test('悔棋精确还原棋盘 / 手方 / 最后一步', () => {
    const core = new GomokuCore();
    const moves = [[7, 7], [7, 8], [8, 8], [6, 6], [8, 7]];
    for (const [r, c] of moves) core.place(r, c);
    const snap = {
        board: Uint8Array.from(core.board),
        current: core.current,
        lastMove: core.lastMove,
        winner: core.winner,
        winLine: core.winLine.slice(),
        moveCount: core.moveCount,
    };
    core.place(5, 5);
    assert.strictEqual(core.undo(1), 1);
    assert.deepStrictEqual(Array.from(core.board), Array.from(snap.board));
    assert.strictEqual(core.current, snap.current);
    assert.strictEqual(core.lastMove, snap.lastMove);
    assert.strictEqual(core.winner, snap.winner);
    assert.deepStrictEqual(core.winLine, snap.winLine);
    assert.strictEqual(core.moveCount, snap.moveCount);
});

test('终局后悔棋撤销胜负与胜线', () => {
    const core = new GomokuCore();
    const seq = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3], [0, 4]];
    for (const [r, c] of seq) core.place(r, c);
    assert.strictEqual(core.winner, GOMOKU_BLACK);
    assert.ok(core.winLine.length >= 5);
    core.undo(1);
    assert.strictEqual(core.winner, 0);
    assert.strictEqual(core.winLine.length, 0);
    assert.strictEqual(core.isOver, false);
    assert.ok(core.isLegal(0, 4));
});

test('悔棋步数超过历史时按实际回退', () => {
    const core = new GomokuCore();
    core.place(7, 7);
    assert.strictEqual(core.undo(5), 1);
    assert.strictEqual(core.moveCount, 0);
    assert.strictEqual(core.lastMove, -1);
    assert.strictEqual(core.undo(1), 0);
});

// ==================== AI ====================

console.log('\n[AI]');

test('空盘 AI 落在天元', () => {
    const core = new GomokuCore();
    assert.deepStrictEqual(core.aiMove('easy'), { r: 7, c: 7 });
    assert.deepStrictEqual(core.aiMove('normal'), { r: 7, c: 7 });
    assert.deepStrictEqual(core.aiMove('hard'), { r: 7, c: 7 });
});

test('普通 / 困难会直接成五', () => {
    for (const diff of ['normal', 'hard']) {
        const core = new GomokuCore(15, 42);
        for (let c = 3; c <= 6; c++) put(core, 7, c, GOMOKU_WHITE);
        core.current = GOMOKU_WHITE;
        const p = core.aiMove(diff);
        assert.ok(p, `${diff} 应返回落点`);
        assert.ok(wouldWinOn(core.board, core.size, core.indexOf(p.r, p.c), GOMOKU_WHITE), `${diff} 应直接成五`);
    }
});

test('普通 / 困难会堵对手的成五点', () => {
    for (const diff of ['normal', 'hard']) {
        const core = new GomokuCore(15, 7);
        for (let c = 3; c <= 6; c++) put(core, 7, c, GOMOKU_BLACK);
        core.current = GOMOKU_WHITE;
        const p = core.aiMove(diff);
        assert.ok(p, `${diff} 应返回落点`);
        const blocks = wouldWinOn(core.board, core.size, core.indexOf(7, 2), GOMOKU_BLACK)
            || wouldWinOn(core.board, core.size, core.indexOf(7, 7), GOMOKU_BLACK);
        assert.ok(blocks, `${diff} 前的局面应存在成五点`);
        const chosen = core.indexOf(p.r, p.c);
        assert.ok(chosen === core.indexOf(7, 2) || chosen === core.indexOf(7, 7), `${diff} 应堵住成五点`);
    }
});

test('AI 不修改棋局（aiMove 前后状态一致）', () => {
    const core = new GomokuCore(15, 99);
    core.place(7, 7);
    core.place(7, 8);
    const board = Uint8Array.from(core.board);
    const current = core.current;
    const moves = core.moveCount;
    core.aiMove('hard');
    assert.deepStrictEqual(Array.from(core.board), Array.from(board));
    assert.strictEqual(core.current, current);
    assert.strictEqual(core.moveCount, moves);
});

test('大量随机构造局面下 AI 落点合法', () => {
    const rng = (function seedRandom(s) {
        let a = s >>> 0;
        return () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    })(2026);
    for (let game = 0; game < 200; game++) {
        const core = new GomokuCore(15, game + 1);
        const steps = Math.floor(rng() * 120);
        for (let i = 0; i < steps && !core.isOver; i++) {
            const candidates = collectCandidates(core.board, core.size);
            const empties = candidates.length > 0
                ? candidates
                : Array.from(core.board).map((v, idx) => idx).filter((idx) => core.board[idx] === 0);
            if (empties.length === 0) break;
            const idx = empties[Math.floor(rng() * empties.length)];
            core.place(Math.floor(idx / core.size), idx % core.size);
        }
        if (core.isOver) continue;
        for (const diff of ['easy', 'normal', 'hard']) {
            const p = core.aiMove(diff);
            assert.ok(p, `${diff} 在非终局必须返回落点`);
            assert.ok(core.isInside(p.r, p.c), `${diff} 落点越界`);
            assert.strictEqual(core.board[core.indexOf(p.r, p.c)], 0, `${diff} 落点非空`);
        }
    }
});

function selfPlay(diffA, diffB, seed) {
    const core = new GomokuCore(15, seed);
    let guard = 0;
    while (!core.isOver) {
        assert.ok(guard++ < core.size * core.size, '对局未在 225 手内结束');
        const diff = core.current === GOMOKU_BLACK ? diffA : diffB;
        const p = core.aiMove(diff);
        assert.ok(p, `${diff} 返回空落点`);
        assert.ok(core.board[core.indexOf(p.r, p.c)] === 0, `${diff} 返回非空点`);
        assert.ok(core.place(p.r, p.c), '落子失败');
    }
    return core;
}

test('新手 / 普通自对弈 500 局不崩溃且合法终局', () => {
    const started = Date.now();
    for (let i = 0; i < 500; i++) {
        const core = selfPlay(i % 2 === 0 ? 'easy' : 'normal', 'normal', i + 1);
        assert.ok(core.winner === GOMOKU_BLACK || core.winner === GOMOKU_WHITE || core.winner === GOMOKU_DRAW);
    }
    const cost = Date.now() - started;
    console.log(`      （500 局耗时 ${cost} ms）`);
});

test('困难自对弈 30 局不崩溃且合法终局', () => {
    const started = Date.now();
    for (let i = 0; i < 30; i++) {
        const core = selfPlay('hard', 'hard', 1000 + i);
        assert.ok(core.isOver);
    }
    const cost = Date.now() - started;
    console.log(`      （30 局耗时 ${cost} ms）`);
});

test('同种子 AI 序列确定', () => {
    const a = new GomokuCore(15, 12345);
    const b = new GomokuCore(15, 12345);
    for (let i = 0; i < 40 && !a.isOver; i++) {
        const pa = a.aiMove('normal');
        const pb = b.aiMove('normal');
        assert.deepStrictEqual(pa, pb, `第 ${i} 步不同`);
        a.place(pa.r, pa.c);
        b.place(pb.r, pb.c);
    }
});

// ==================== 评分与候选点 ====================

console.log('\n[评分与候选点]');

test('活三分值高于眠三', () => {
    const board = makeBoard();
    const size = 15;
    // 活三：_XXX_
    board[7 * size + 5] = GOMOKU_BLACK;
    board[7 * size + 6] = GOMOKU_BLACK;
    board[7 * size + 7] = GOMOKU_BLACK;
    const openThree = scoreMoveFor(board, size, 7 * size + 4, GOMOKU_BLACK)
        + scoreMoveFor(board, size, 7 * size + 8, GOMOKU_BLACK);
    // 眠三：X_XXX_? 一端被对手堵死
    const board2 = makeBoard();
    board2[7 * size + 4] = GOMOKU_WHITE;
    board2[7 * size + 5] = GOMOKU_BLACK;
    board2[7 * size + 6] = GOMOKU_BLACK;
    board2[7 * size + 7] = GOMOKU_BLACK;
    const blockedThree = scoreMoveFor(board2, size, 7 * size + 8, GOMOKU_BLACK);
    assert.ok(openThree > blockedThree, `活三 ${openThree} 应高于眠三 ${blockedThree}`);
});

test('候选点只包含已有棋子两格内的空点', () => {
    const board = makeBoard();
    board[7 * 15 + 7] = GOMOKU_BLACK;
    const cands = collectCandidates(board, 15);
    assert.ok(cands.length > 0);
    for (const idx of cands) {
        const r = Math.floor(idx / 15);
        const c = idx % 15;
        assert.strictEqual(board[idx], 0);
        assert.ok(Math.abs(r - 7) <= 2 && Math.abs(c - 7) <= 2, `(${r},${c}) 超出两格`);
    }
    assert.strictEqual(cands.length, 24); // 5×5 - 1
});

// ==================== 汇总 ====================

console.log(`\n共 ${passed + failures.length} 项，通过 ${passed} 项，失败 ${failures.length} 项。`);
if (failures.length > 0) {
    process.exit(1);
}
console.log('五子棋核心自检通过。');
