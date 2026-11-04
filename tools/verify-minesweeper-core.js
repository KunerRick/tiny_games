#!/usr/bin/env node
/**
 * 扫雷 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 用法：node tools/verify-minesweeper-core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_minesweeper', 'scripts');
const OUT = path.join(ROOT, 'temp', 'minesweeper-core-test');

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
    path.join(SRC, 'MinesweeperCore.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const { MinesweeperCore, MINESWEEPER_DIFFS } = require(path.join(OUT, 'MinesweeperCore.js'));

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

function startedCore(diff = 'easy', seed = 12345, first = 40) {
    const core = new MinesweeperCore(diff, seed);
    core.reveal(first);
    return core;
}

// ==================== 配置 ====================

console.log('\n[难度配置]');
test('三档难度参数正确', () => {
    assert.deepStrictEqual(MINESWEEPER_DIFFS.easy, { cols: 9, rows: 9, mines: 10, label: '初级' });
    assert.deepStrictEqual(MINESWEEPER_DIFFS.medium, { cols: 12, rows: 12, mines: 24, label: '中级' });
    assert.deepStrictEqual(MINESWEEPER_DIFFS.hard, { cols: 16, rows: 16, mines: 45, label: '高级' });
});

// ==================== 布雷 ====================

console.log('\n[布雷与首点安全]');
test('首点及其 8 邻域无雷，总雷数正确', () => {
    for (const diff of ['easy', 'medium', 'hard']) {
        for (let seed = 1; seed <= 8; seed++) {
            for (const first of [0, 5, 40, MINESWEEPER_DIFFS[diff].cols * MINESWEEPER_DIFFS[diff].rows - 1]) {
                const core = new MinesweeperCore(diff, seed);
                core.reveal(first);
                assert.strictEqual(core.mines[first], 0, `${diff}/${seed} 首点不应是雷`);
                for (const n of core.neighbors(first)) {
                    assert.strictEqual(core.mines[n], 0, `${diff}/${seed} 首点邻域不应是雷`);
                }
                let count = 0;
                for (let i = 0; i < core.total; i++) count += core.mines[i];
                assert.strictEqual(count, core.mineCount, `${diff}/${seed} 雷数不对`);
            }
        }
    }
});

test('相同种子 + 相同首点 → 完全相同的雷图', () => {
    const a = new MinesweeperCore('medium', 999);
    const b = new MinesweeperCore('medium', 999);
    a.reveal(13);
    b.reveal(13);
    assert.deepStrictEqual(Array.from(a.mines), Array.from(b.mines));
    assert.deepStrictEqual(Array.from(a.adj), Array.from(b.adj));
});

test('不同种子 → 雷图不同', () => {
    const a = new MinesweeperCore('medium', 1);
    const b = new MinesweeperCore('medium', 2);
    a.reveal(13);
    b.reveal(13);
    assert.notDeepStrictEqual(Array.from(a.mines), Array.from(b.mines));
});

test('adj 与实际邻雷数一致', () => {
    const core = startedCore('medium', 77, 30);
    for (let i = 0; i < core.total; i++) {
        if (core.mines[i]) continue;
        let count = 0;
        for (const n of core.neighbors(i)) if (core.mines[n]) count++;
        assert.strictEqual(core.adj[i], count, `格 ${i} 的邻雷数不对`);
    }
});

// ==================== 翻开 ====================

console.log('\n[翻开与扩散]');
test('首点邻域安全 → 首点必然翻开，且 adj 为 0 时扩散', () => {
    const core = new MinesweeperCore('easy', 3);
    const opened = core.reveal(40);
    assert(opened.length >= 1);
    assert.strictEqual(core.revealed[40], 1);
    assert.strictEqual(core.status, 'playing');
    if (core.adj[40] === 0) {
        assert(opened.length > 1, '空格应扩散');
    }
});

test('已插旗的格子不会被翻开', () => {
    const core = new MinesweeperCore('easy', 4);
    core.toggleFlag(10);
    const opened = core.reveal(10);
    assert.strictEqual(opened.length, 0);
    assert.strictEqual(core.revealed[10], 0);
});

test('重复翻开同一格不会重复计数', () => {
    const core = startedCore('easy', 5, 40);
    const before = core.revealedCount;
    const opened = core.reveal(40);
    assert.strictEqual(opened.length, 0);
    assert.strictEqual(core.revealedCount, before);
});

// ==================== 插旗 ====================

console.log('\n[插旗]');
test('插旗 / 拔旗更新剩余雷数', () => {
    const core = new MinesweeperCore('easy', 6);
    assert.strictEqual(core.remainingMines(), 10);
    assert(core.toggleFlag(0));
    assert.strictEqual(core.remainingMines(), 9);
    assert(core.toggleFlag(0));
    assert.strictEqual(core.remainingMines(), 10);
});

test('已翻开的格子不能插旗', () => {
    const core = startedCore('easy', 7, 40);
    const idx = core.revealed.indexOf(1);
    assert(idx >= 0);
    assert.strictEqual(core.toggleFlag(idx), false);
});

// ==================== 和弦 ====================

console.log('\n[和弦]');
test('旗数吻合时翻开其余邻格；不吻合时不动', () => {
    const core = new MinesweeperCore('easy', 8);
    // 手工布一个局部局面：中心 40 是数字 1，周围只有 39 是雷
    core.status = 'playing';
    core.mines = new Uint8Array(core.total);
    core.adj = new Uint8Array(core.total);
    core.revealed = new Uint8Array(core.total);
    core.flagged = new Uint8Array(core.total);
    core.mines[39] = 1;
    core.adj[40] = 1;
    core.revealed[40] = 1;
    core.revealedCount = 1;

    assert.deepStrictEqual(core.chord(40), [], '没插旗时不应和弦');
    core.toggleFlag(39);
    const opened = core.chord(40);
    assert(opened.length > 0, '插对旗后应翻开周围');
    assert(opened.indexOf(39) === -1, '旗子格不应被翻开');
    assert.strictEqual(core.revealed[39], 0);
});

// ==================== 胜负 ====================

console.log('\n[胜负判定]');
test('翻开地雷 → 失败，暴露全部地雷', () => {
    const core = startedCore('easy', 9, 40);
    let mine = -1;
    for (let i = 0; i < core.total; i++) if (core.mines[i]) { mine = i; break; }
    core.reveal(mine);
    assert.strictEqual(core.status, 'lost');
    assert.strictEqual(core.exploded, mine);
    assert.strictEqual(core.showMine(mine), true);
});

test('失败时错误旗子被标记', () => {
    const core = startedCore('easy', 10, 40);
    let safe = -1;
    let mine = -1;
    for (let i = 0; i < core.total; i++) {
        if (!core.mines[i] && safe < 0) safe = i;
        if (core.mines[i] && mine < 0) mine = i;
    }
    core.toggleFlag(safe);
    core.reveal(mine);
    assert.strictEqual(core.showWrongFlag(safe), true);
});

test('翻开所有非雷格 → 胜利', () => {
    const core = new MinesweeperCore('medium', 11);
    core.reveal(0);
    for (let i = 0; i < core.total; i++) {
        if (!core.mines[i]) core.reveal(i);
    }
    assert.strictEqual(core.status, 'won');
    assert.strictEqual(core.revealedCount, core.total - core.mineCount);
});

test('胜负已分后不再接受翻开', () => {
    const core = new MinesweeperCore('easy', 12);
    core.reveal(0);
    for (let i = 0; i < core.total; i++) if (!core.mines[i]) core.reveal(i);
    assert.strictEqual(core.status, 'won');
    const before = core.revealedCount;
    core.reveal(79);
    assert.strictEqual(core.revealedCount, before);
});

// ==================== 存档 ====================

console.log('\n[存档]');
test('快照往返保留棋盘与状态', () => {
    const core = startedCore('medium', 13, 55);
    core.toggleFlag(core.revealed.indexOf(0));
    const restored = MinesweeperCore.fromSnapshot(core.snapshot());
    assert.strictEqual(restored.status, core.status);
    assert.strictEqual(restored.revealedCount, core.revealedCount);
    assert.strictEqual(restored.flagCount, core.flagCount);
    assert.deepStrictEqual(Array.from(restored.mines), Array.from(core.mines));
    assert.deepStrictEqual(Array.from(restored.revealed), Array.from(core.revealed));
});

test('坏存档（长度不符）回落到新棋盘', () => {
    const core = new MinesweeperCore('easy', 14);
    const restored = MinesweeperCore.fromSnapshot({
        ...core.snapshot(),
        mines: [1, 0],
    });
    assert.strictEqual(restored.status, 'ready');
    assert.strictEqual(restored.total, 81);
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
console.log('扫雷核心自检通过。');
