#!/usr/bin/env node
/**
 * 数独 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 覆盖：生成合法性与唯一解、给定数、输入/笔记/擦除、冲突、撤销、提示、
 *       完成判定、存档往返、生成耗时。
 *
 * 用法：node tools/verify-sudoku-core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_sudoku', 'scripts');
const OUT = path.join(ROOT, 'temp', 'sudoku-core-test');

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
    path.join(SRC, 'SudokuCore.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const { SudokuCore, SUDOKU_DIFFS } = require(path.join(OUT, 'SudokuCore.js'));

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

function assertValidSolution(grid) {
    for (let i = 0; i < 81; i++) {
        const v = grid[i];
        assert(v >= 1 && v <= 9, `格 ${i} 的值 ${v} 非法`);
    }
    for (let g = 0; g < 9; g++) {
        const row = new Set();
        const col = new Set();
        const box = new Set();
        for (let k = 0; k < 9; k++) {
            row.add(grid[g * 9 + k]);
            col.add(grid[k * 9 + g]);
            const br = Math.floor(g / 3) * 3 + Math.floor(k / 3);
            const bc = (g % 3) * 3 + (k % 3);
            box.add(grid[br * 9 + bc]);
        }
        assert.strictEqual(row.size, 9, `第 ${g} 行有重复`);
        assert.strictEqual(col.size, 9, `第 ${g} 列有重复`);
        assert.strictEqual(box.size, 9, `第 ${g} 宫有重复`);
    }
}

function emptyCell(core) {
    for (let i = 0; i < 81; i++) if (core.values[i] === 0) return i;
    return -1;
}

function peerIndex(core, index) {
    return core.peersOf(index)[0];
}

// ==================== 生成 ====================

console.log('\n[生成]');
test('三档难度参数正确', () => {
    assert.deepStrictEqual(SUDOKU_DIFFS.easy, { givens: 40, label: '简单' });
    assert.deepStrictEqual(SUDOKU_DIFFS.medium, { givens: 32, label: '中等' });
    assert.deepStrictEqual(SUDOKU_DIFFS.hard, { givens: 26, label: '困难' });
});

test('完整解合法，题目与解一致，解唯一', () => {
    const t0 = Date.now();
    for (const diff of ['easy', 'medium', 'hard']) {
        for (let seed = 1; seed <= 3; seed++) {
            const core = new SudokuCore(diff, seed);
            assertValidSolution(core.solution);
            let givens = 0;
            for (let i = 0; i < 81; i++) {
                if (core.puzzle[i] !== 0) {
                    givens++;
                    assert.strictEqual(core.puzzle[i], core.solution[i], `${diff}/${seed} 题面与解不符`);
                    assert.strictEqual(core.given[i], true);
                } else {
                    assert.strictEqual(core.given[i], false);
                }
            }
            const target = SUDOKU_DIFFS[diff].givens;
            assert(givens >= target, `${diff}/${seed} 提示数 ${givens} < ${target}`);
            assert.strictEqual(core.countSolutions(core.puzzle, 2), 1, `${diff}/${seed} 解不唯一`);
        }
    }
    const ms = Date.now() - t0;
    console.log(`      生成 9 局耗时 ${ms}ms（含唯一性验证）`);
});

test('相同种子 → 相同题目；不同种子 → 不同题目', () => {
    const a = new SudokuCore('medium', 42);
    const b = new SudokuCore('medium', 42);
    assert.deepStrictEqual(a.puzzle, b.puzzle);
    assert.deepStrictEqual(a.solution, b.solution);
    const c = new SudokuCore('medium', 43);
    assert.notDeepStrictEqual(a.puzzle, c.puzzle);
});

// ==================== 输入 ====================

console.log('\n[输入与笔记]');
test('初始值等于题面', () => {
    const core = new SudokuCore('easy', 7);
    for (let i = 0; i < 81; i++) assert.strictEqual(core.values[i], core.puzzle[i]);
    assert.strictEqual(core.status, 'playing');
});

test('填入正确答案后值更新、笔记清空', () => {
    const core = new SudokuCore('easy', 8);
    const idx = emptyCell(core);
    core.select(idx);
    core.notes[idx] = 0x1ff;
    assert(core.input(core.solution[idx]));
    assert.strictEqual(core.values[idx], core.solution[idx]);
    assert.strictEqual(core.notes[idx], 0);
    assert.strictEqual(core.mistakes, 0);
});

test('填入错误答案计入失误', () => {
    const core = new SudokuCore('easy', 9);
    const idx = emptyCell(core);
    const wrong = core.solution[idx] === 9 ? 1 : core.solution[idx] + 1;
    core.select(idx);
    core.input(wrong);
    assert.strictEqual(core.values[idx], wrong);
    assert.strictEqual(core.mistakes, 1);
});

test('给定格不可修改', () => {
    const core = new SudokuCore('easy', 10);
    let given = -1;
    for (let i = 0; i < 81; i++) if (core.given[i]) { given = i; break; }
    core.select(given);
    assert.strictEqual(core.input(5), false);
    assert.strictEqual(core.values[given], core.puzzle[given]);
});

test('笔记切换与撤销', () => {
    const core = new SudokuCore('easy', 11);
    const idx = emptyCell(core);
    core.select(idx);
    assert(core.toggleNote(3));
    assert.strictEqual(core.notes[idx], 1 << 2);
    assert(core.toggleNote(7));
    assert.strictEqual(core.notes[idx], (1 << 2) | (1 << 6));
    assert(core.toggleNote(3));
    assert.strictEqual(core.notes[idx], 1 << 6);
    assert(core.undo());
    assert.strictEqual(core.notes[idx], (1 << 2) | (1 << 6));
    assert(core.undo());
    assert.strictEqual(core.notes[idx], 1 << 2);
});

test('填入数字会移除同行列的候选笔记', () => {
    const core = new SudokuCore('easy', 12);
    let idx = -1;
    for (let i = 0; i < 81; i++) if (core.values[i] === 0) { idx = i; break; }
    let target = -1;
    for (const p of core.peersOf(idx)) {
        if (core.values[p] === 0) { target = p; break; }
    }
    if (target < 0) return;
    core.notes[target] = 0x1ff;
    core.select(idx);
    const value = core.solution[idx];
    core.input(value);
    assert.strictEqual(core.notes[target] & (1 << (value - 1)), 0, '应移除同数字候选');
});

test('擦除清空当前格', () => {
    const core = new SudokuCore('easy', 13);
    const idx = emptyCell(core);
    core.select(idx);
    core.input(core.solution[idx]);
    assert(core.erase());
    assert.strictEqual(core.values[idx], 0);
    assert.strictEqual(core.erase(), false);
});

// ==================== 冲突与提示 ====================

console.log('\n[冲突与提示]');
test('同行重复数字被标记为冲突', () => {
    const core = new SudokuCore('easy', 14);
    const idx = emptyCell(core);
    const peers = core.peersOf(idx);
    let sameRow = -1;
    for (const p of peers) {
        if (Math.floor(p / 9) === Math.floor(idx / 9) && core.values[p] !== 0) { sameRow = p; break; }
    }
    if (sameRow < 0) return; // 该行恰好全空，跳过
    core.select(idx);
    core.input(core.values[sameRow]);
    const conflicts = core.conflicts();
    assert(conflicts.has(idx));
    assert(conflicts.has(sameRow));
});

test('提示填入正确值并计数', () => {
    const core = new SudokuCore('easy', 15);
    const idx = emptyCell(core);
    core.select(idx);
    const filled = core.hint();
    assert.strictEqual(filled, idx);
    assert.strictEqual(core.values[idx], core.solution[idx]);
    assert.strictEqual(core.hintsUsed, 1);
});

test('撤销可以回退提示', () => {
    const core = new SudokuCore('easy', 16);
    core.select(emptyCell(core));
    core.hint();
    assert(core.undo());
    assert.strictEqual(core.values[core.selected], 0);
});

// ==================== 完成 ====================

console.log('\n[完成判定]');
test('按解填满 → won', () => {
    const core = new SudokuCore('easy', 17);
    for (let i = 0; i < 81; i++) {
        if (core.given[i]) continue;
        core.select(i);
        core.input(core.solution[i]);
    }
    assert.strictEqual(core.status, 'won');
    assert.strictEqual(core.isComplete(), true);
});

// ==================== 存档 ====================

console.log('\n[存档]');
test('快照往返保留进度，但撤销栈清空', () => {
    const core = new SudokuCore('medium', 18);
    const idx = emptyCell(core);
    core.select(idx);
    core.input(core.solution[idx]);
    core.notes[idx + 1] = 0b101;
    const restored = SudokuCore.fromSnapshot(core.snapshot(123));
    assert(restored);
    assert.deepStrictEqual(restored.puzzle, core.puzzle);
    assert.deepStrictEqual(restored.values, core.values);
    assert.deepStrictEqual(restored.notes, core.notes);
    assert.strictEqual(restored.canUndo(), false);
    assert.strictEqual(restored.status, 'playing');
});

test('坏存档返回 null', () => {
    assert.strictEqual(SudokuCore.fromSnapshot(null), null);
    assert.strictEqual(SudokuCore.fromSnapshot({ puzzle: [1] }), null);
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
console.log('数独核心自检通过。');
