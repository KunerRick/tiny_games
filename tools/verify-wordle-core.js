#!/usr/bin/env node
/**
 * 成语猜猜 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 覆盖：词库合法性、判定三态（含重复字）、答案选取确定性、候选池完整性、
 *       三档难度尺寸与干扰字唯一性、每日种子、计分、分享文本、长跑不变量。
 *
 * 用法：node tools/verify-wordle-core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GAMES = path.join(ROOT, 'assets', 'games');
const OUT = path.join(ROOT, 'temp', 'wordle-core-test');

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
    path.join(GAMES, 'game_wordle', 'scripts', 'WordleCore.ts'),
    path.join(GAMES, 'game_idiom', 'scripts', 'IdiomData.ts'),
    '--outDir', OUT,
    '--rootDir', GAMES,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const W = require(path.join(OUT, 'game_wordle', 'scripts', 'WordleCore.js'));
const { IDIOM_LIST } = require(path.join(OUT, 'game_idiom', 'scripts', 'IdiomData.js'));

const {
    WORDLE_DIFFS,
    WORDLE_DIFF_ORDER,
    WORDLE_WORD_LEN,
    evaluateGuess,
    isWinningRow,
    pickAnswer,
    buildPool,
    buildPoolFor,
    dailySeed,
    dateKeyOf,
    shareGrid,
    scoreFor,
    mulberry32,
    hashSeed,
} = W;

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

function countChars(word) {
    const map = Object.create(null);
    for (const c of Array.from(word)) map[c] = (map[c] || 0) + 1;
    return map;
}

// ==================== 词库 ====================

console.log('\n[词库]');

test('词库非空且全部为 4 字成语', () => {
    assert.ok(IDIOM_LIST.length >= 300, `词库只有 ${IDIOM_LIST.length} 条`);
    for (const w of IDIOM_LIST) {
        assert.strictEqual(Array.from(w).length, WORDLE_WORD_LEN, `长度不对：${w}`);
    }
});

test('词库无重复、无变体选择符', () => {
    const seen = new Set();
    for (const w of IDIOM_LIST) {
        assert.ok(!seen.has(w), `重复词条：${w}`);
        seen.add(w);
        assert.ok(!/[︎️]/.test(w), `含变体选择符：${w}`);
    }
});

// ==================== 判定 ====================

console.log('\n[判定]');

test('全对 → 四绿', () => {
    assert.deepStrictEqual(evaluateGuess('一举两得', '一举两得'), ['green', 'green', 'green', 'green']);
});

test('全错 → 四灰', () => {
    assert.deepStrictEqual(evaluateGuess('一举两得', '风花雪月'), ['gray', 'gray', 'gray', 'gray']);
});

test('字对位置错 → 黄', () => {
    // 一举两得 vs 两三一举：两(黄) 三(灰) 一(黄) 举(黄)
    assert.deepStrictEqual(evaluateGuess('一举两得', '两三一举'), ['yellow', 'gray', 'yellow', 'yellow']);
});

test('绿优先于黄（重复字答案）', () => {
    // 答案 一心一意 / 猜测 一意一心：位置 0、2 直接命中，位置 1 的 意 与位置 3 的 心 各占一个剩余副本
    assert.deepStrictEqual(evaluateGuess('一心一意', '一意一心'), ['green', 'yellow', 'green', 'yellow']);
});

test('重复字不会超出答案副本数', () => {
    // 答案 一心一意（一×2，位置 0、2）：猜测 一一一一 两个 一 都直接命中，
    // 剩余答案字是 心、意，池里再没有 一 可给黄
    const marks = evaluateGuess('一心一意', '一一一一');
    assert.deepStrictEqual(marks, ['green', 'gray', 'green', 'gray']);
});

test('全绿判定', () => {
    assert.strictEqual(isWinningRow(['green', 'green', 'green', 'green']), true);
    assert.strictEqual(isWinningRow(['green', 'green', 'yellow', 'green']), false);
    assert.strictEqual(isWinningRow([]), false);
});

test('判定结果长度与猜测一致、取值只有三种', () => {
    for (let i = 0; i < 200; i++) {
        const a = IDIOM_LIST[i % IDIOM_LIST.length];
        const g = IDIOM_LIST[(i * 7 + 13) % IDIOM_LIST.length];
        const marks = evaluateGuess(a, g);
        assert.strictEqual(marks.length, WORDLE_WORD_LEN);
        for (const m of marks) assert.ok(m === 'green' || m === 'yellow' || m === 'gray', m);
    }
});

test('答案自身判定必定全绿', () => {
    for (const w of IDIOM_LIST) {
        assert.ok(isWinningRow(evaluateGuess(w, w)), w);
    }
});

// ==================== 答案选取 ====================

console.log('\n[答案]');

test('同种子同答案', () => {
    for (let s = 0; s < 50; s++) {
        assert.strictEqual(pickAnswer(s, IDIOM_LIST), pickAnswer(s, IDIOM_LIST));
    }
});

test('答案一定是词库里的合法成语', () => {
    const set = new Set(IDIOM_LIST);
    for (let s = 0; s < 500; s++) {
        const a = pickAnswer(s * 2654435761 >>> 0, IDIOM_LIST);
        assert.ok(set.has(a), `非词库答案：${a}`);
    }
});

test('不同种子能覆盖到较多不同答案', () => {
    const set = new Set();
    for (let s = 0; s < 500; s++) set.add(pickAnswer(s, IDIOM_LIST));
    assert.ok(set.size > 50, `只覆盖 ${set.size} 个答案`);
});

test('每日种子：同日相同、跨日不同', () => {
    assert.strictEqual(dailySeed('2026-11-08'), dailySeed('2026-11-08'));
    assert.notStrictEqual(dailySeed('2026-11-08'), dailySeed('2026-11-09'));
    assert.notStrictEqual(dailySeed('2026-11-08'), dailySeed('2026-12-08'));
});

test('日期键格式与跨月进位', () => {
    assert.strictEqual(dateKeyOf(new Date(2026, 0, 5)), '2026-01-05');
    assert.strictEqual(dateKeyOf(new Date(2026, 11, 31)), '2026-12-31');
});

// ==================== 候选池 ====================

console.log('\n[候选池]');

test('三档难度尺寸正确', () => {
    assert.strictEqual(WORDLE_DIFFS.easy.poolSize, 16);
    assert.strictEqual(WORDLE_DIFFS.medium.poolSize, 20);
    assert.strictEqual(WORDLE_DIFFS.hard.poolSize, 24);
    for (const id of WORDLE_DIFF_ORDER) {
        assert.ok(WORDLE_DIFFS[id].maxGuesses >= 4, id);
        assert.ok(WORDLE_DIFFS[id].weight > 0, id);
    }
});

test('候选池一定包含答案的全部字（含重复字）', () => {
    for (const diff of WORDLE_DIFF_ORDER) {
        for (let s = 0; s < 200; s++) {
            const answer = pickAnswer(s * 97 + 11, IDIOM_LIST);
            const pool = buildPoolFor(answer, s, diff, IDIOM_LIST);
            const need = countChars(answer);
            const have = countChars(pool.join(''));
            for (const ch of Object.keys(need)) {
                assert.ok((have[ch] || 0) >= need[ch], `${answer}@${diff} 缺字 ${ch}`);
            }
        }
    }
});

test('干扰字不重复、且不与答案字冲突', () => {
    for (const diff of WORDLE_DIFF_ORDER) {
        for (let s = 0; s < 100; s++) {
            const answer = pickAnswer(s * 131 + 7, IDIOM_LIST);
            const pool = buildPoolFor(answer, s, diff, IDIOM_LIST);
            const answerChars = new Set(Array.from(answer));
            const seen = Object.create(null);
            for (const c of pool) {
                seen[c] = (seen[c] || 0) + 1;
                if (answerChars.has(c)) continue;
                assert.strictEqual(seen[c], 1, `干扰字重复：${c} in ${pool.join('')}`);
            }
        }
    }
});

test('候选池尺寸达到目标（词库足够时）', () => {
    const answer = pickAnswer(12345, IDIOM_LIST);
    for (const diff of WORDLE_DIFF_ORDER) {
        const pool = buildPoolFor(answer, 12345, diff, IDIOM_LIST);
        assert.strictEqual(pool.length, WORDLE_DIFFS[diff].poolSize, `${diff} 池大小 ${pool.length}`);
    }
});

test('同种子同池（可复现）', () => {
    const answer = pickAnswer(999, IDIOM_LIST);
    for (const diff of WORDLE_DIFF_ORDER) {
        const a = buildPoolFor(answer, 999, diff, IDIOM_LIST).join('');
        const b = buildPoolFor(answer, 999, diff, IDIOM_LIST).join('');
        assert.strictEqual(a, b);
    }
});

test('不同种子池顺序不同', () => {
    const answer = pickAnswer(1, IDIOM_LIST);
    let diffCount = 0;
    for (let s = 0; s < 20; s++) {
        if (buildPoolFor(answer, s, 'hard', IDIOM_LIST).join('') !== buildPoolFor(answer, s + 1, 'hard', IDIOM_LIST).join('')) diffCount++;
    }
    assert.ok(diffCount >= 15, `只有 ${diffCount}/20 组不同`);
});

test('池中任何字符都能被玩家选中组出答案（可解性）', () => {
    const answer = '一心一意';
    const pool = buildPoolFor(answer, 42, 'hard', IDIOM_LIST);
    const avail = countChars(pool.join(''));
    for (const ch of Array.from(answer)) {
        assert.ok((avail[ch] || 0) > 0, `池里没有 ${ch}`);
        avail[ch] -= 1;
    }
});

// ==================== 计分与分享 ====================

console.log('\n[计分 / 分享]');

test('计分：剩余次数 × 100 × 系数', () => {
    assert.strictEqual(scoreFor('easy', 1, true), 500);   // 6-1=5 → 500×1.0
    assert.strictEqual(scoreFor('medium', 1, true), 600); // 5×100×1.2
    assert.strictEqual(scoreFor('hard', 5, true), 0);     // 用满 5 次，剩 0
    assert.strictEqual(scoreFor('easy', 3, false), 0);
});

test('计分边界：超出次数不出现负数', () => {
    assert.strictEqual(scoreFor('easy', 99, true), 0);
    assert.strictEqual(scoreFor('hard', 0, true), 600); // 按 1 次算：4×100×1.5
});

test('分享文本与棋盘一致', () => {
    const rows = [
        ['yellow', 'gray', 'green', 'gray'],
        ['gray', 'green', 'gray', 'green'],
        ['green', 'green', 'green', 'green'],
    ];
    const text = shareGrid(rows);
    assert.strictEqual(text, '🟨⬜🟩⬜\n⬜🟩⬜🟩\n🟩🟩🟩🟩');
    assert.ok(!/[︎️]/.test(text), '分享文本含变体选择符');
});

// ==================== 随机数 ====================

console.log('\n[随机数]');

test('mulberry32 确定性且落在 [0,1)', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 1000; i++) {
        const x = a();
        assert.strictEqual(x, b());
        assert.ok(x >= 0 && x < 1, `越界：${x}`);
    }
});

test('hashSeed 稳定且非负', () => {
    assert.strictEqual(hashSeed('abc'), hashSeed('abc'));
    assert.notStrictEqual(hashSeed('abc'), hashSeed('abd'));
    assert.ok(hashSeed('任意中文') >= 0);
});

// ==================== 长跑 ====================

console.log('\n[长跑]');

test('1000 局：答案合法、池合法、可解、判定不抛异常', () => {
    for (let i = 0; i < 1000; i++) {
        const seed = (i * 2654435761) >>> 0;
        const diff = WORDLE_DIFF_ORDER[i % WORDLE_DIFF_ORDER.length];
        const answer = pickAnswer(seed, IDIOM_LIST);
        const pool = buildPoolFor(answer, seed, diff, IDIOM_LIST);

        const need = countChars(answer);
        const have = countChars(pool.join(''));
        for (const ch of Object.keys(need)) assert.ok((have[ch] || 0) >= need[ch], '池缺字');

        // 随机提交若干行，判定必须始终合法
        const rand = mulberry32(seed ^ 0x5a5a);
        for (let g = 0; g < WORDLE_DIFFS[diff].maxGuesses; g++) {
            const guess = [0, 1, 2, 3].map(() => pool[Math.floor(rand() * pool.length)]).join('');
            const marks = evaluateGuess(answer, guess);
            assert.strictEqual(marks.length, WORDLE_WORD_LEN);
        }
    }
});

test('自对弈：用池中答案的字组词必定能全绿', () => {
    for (let i = 0; i < 200; i++) {
        const answer = pickAnswer(i * 7 + 3, IDIOM_LIST);
        // 玩家最终一定按答案顺序提交
        assert.ok(isWinningRow(evaluateGuess(answer, answer)));
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
console.log('WORDLE_CORE_OK');
