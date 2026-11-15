#!/usr/bin/env node
/**
 * 模板游戏 —— 纯逻辑回归自检（不启动 Cocos）。
 *
 * 覆盖：Core 纯度（不许 import cc / 碰 Date.now / Math.random / localStorage）、
 *       开局与计时、点击计分与确定性奖励、最佳成绩、存档往返与坏档回落、显示格式化。
 *
 * 用法：node tools/verify-template-core.js
 * 通过时打印 TEMPLATE_CORE_OK；失败逐条打印并以退出码 1 结束。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { ROOT, runTsc } = require('./lib/core-compile');

const SRC_DIR = path.join(ROOT, 'assets', 'games', 'game_template', 'scripts');
const CORE_SRC = path.join(SRC_DIR, 'TemplateCore.ts');
const OUT = path.join(ROOT, 'temp', 'template-core-test');

// ---------- 1. Core 纯度（规矩写死在检查里，不是写在文档里） ----------
const source = fs.readFileSync(CORE_SRC, 'utf8');
// 先剥掉注释，否则文档里写的 `Date.now()` 会被当成真调用
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
assert.ok(!/from\s+['"]cc(\/|['"])/.test(code), 'Core 不许 import cc');
assert.ok(!/\bDate\.now\b/.test(code), 'Core 不许调 Date.now（时间由调用方传入）');
assert.ok(!/\bMath\.random\b/.test(code), 'Core 不许调 Math.random（随机数要可复现）');
assert.ok(!/\blocalStorage\b/.test(code), 'Core 不许碰 localStorage（存档由 View 层负责）');

// ---------- 编译并通过 Node 跑 ----------
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`编译纯逻辑模块 → ${path.relative(ROOT, OUT)}`);
runTsc([
    CORE_SRC,
    '--outDir', OUT,
    '--rootDir', SRC_DIR,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
]);

const Core = require(path.join(OUT, 'TemplateCore.js'));
const {
    ROUND_SECONDS,
    BONUS_EVERY,
    SAVE_VERSION,
    createState,
    startRound,
    tap,
    tick,
    nextRandom,
    toSave,
    serializeSave,
    deserializeSave,
    formatSeconds,
} = Core;

// ---------- 2. 断言 ----------
let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        console.error(`  ✗ ${name}`);
        throw e;
    }
}

console.log('模板游戏核心自检');

test('新档默认值', () => {
    const s = createState(null);
    assert.strictEqual(s.phase, 'ready');
    assert.strictEqual(s.round, 0);
    assert.strictEqual(s.score, 0);
    assert.strictEqual(s.best, 0);
    assert.strictEqual(s.timeLeft, ROUND_SECONDS);
});

test('读档保留 best / round，坏字段夹回合法范围', () => {
    const s = createState({ version: SAVE_VERSION, best: 42, round: 7 });
    assert.strictEqual(s.best, 42);
    assert.strictEqual(s.round, 7);
    const dirty = createState({ version: SAVE_VERSION, best: -5, round: NaN });
    assert.strictEqual(dirty.best, 0);
    assert.strictEqual(dirty.round, 0);
});

test('开局重置本局、累加局数、时间回满', () => {
    const s = createState({ version: SAVE_VERSION, best: 9, round: 2 });
    s.score = 30;
    s.taps = 3;
    startRound(s, 12345);
    assert.strictEqual(s.phase, 'playing');
    assert.strictEqual(s.round, 3);
    assert.strictEqual(s.score, 0);
    assert.strictEqual(s.taps, 0);
    assert.strictEqual(s.timeLeft, ROUND_SECONDS);
    assert.strictEqual(s.best, 9, '开局不该清掉 best');
});

test('未开局点击无效', () => {
    const s = createState(null);
    assert.strictEqual(tap(s), 0);
    assert.strictEqual(s.score, 0);
});

test('前 4 次点击各 +1，第 5 次进入奖励区间 +1~+3', () => {
    const s = createState(null);
    startRound(s, 1);
    for (let i = 1; i < BONUS_EVERY; i++) {
        assert.strictEqual(tap(s), 1, `第 ${i} 次应为 +1`);
    }
    const bonus = tap(s);
    assert.ok(bonus >= 1 && bonus <= 3, `第 ${BONUS_EVERY} 次奖励越界：${bonus}`);
});

test('同一 seed 的点击序列完全一致（可复现）', () => {
    const a = createState(null);
    const b = createState(null);
    startRound(a, 987654321);
    startRound(b, 987654321);
    for (let i = 0; i < 40; i++) {
        assert.strictEqual(tap(a), tap(b));
    }
    assert.strictEqual(a.score, b.score);
    assert.strictEqual(a.rng, b.rng);
});

test('不同 seed 会产生不同序列', () => {
    const a = createState(null);
    const b = createState(null);
    startRound(a, 111);
    startRound(b, 222);
    let diff = false;
    for (let i = 0; i < 60; i++) {
        if (tap(a) !== tap(b)) diff = true;
    }
    assert.ok(diff, '两个 seed 的奖励序列完全相同，随机数可能没推进');
});

test('nextRandom 落在 [0,1) 且推进状态', () => {
    const s = createState(null);
    startRound(s, 42);
    const r0 = s.rng;
    for (let i = 0; i < 100; i++) {
        const v = nextRandom(s);
        assert.ok(v >= 0 && v < 1, `越界：${v}`);
    }
    assert.notStrictEqual(s.rng, r0);
});

test('计时到 0 只结束一次，并把 best 抬高', () => {
    const s = createState({ version: SAVE_VERSION, best: 1, round: 0 });
    startRound(s, 7);
    s.score = 5;
    assert.strictEqual(tick(s, ROUND_SECONDS / 2), false);
    assert.ok(s.timeLeft > 0);
    assert.strictEqual(tick(s, ROUND_SECONDS / 2), true, '这一拍应结束本局');
    assert.strictEqual(s.phase, 'over');
    assert.strictEqual(s.best, 5);
    assert.strictEqual(tick(s, 1), false, '已结束不该重复返回 true');
});

test('负 dt / NaN dt 不推进也不崩', () => {
    const s = createState(null);
    startRound(s, 3);
    tick(s, -5);
    tick(s, NaN);
    assert.strictEqual(s.timeLeft, ROUND_SECONDS);
    assert.strictEqual(s.phase, 'playing');
});

test('best 只增不减', () => {
    const s = createState({ version: SAVE_VERSION, best: 100, round: 1 });
    startRound(s, 5);
    s.score = 10;
    tick(s, ROUND_SECONDS);
    assert.strictEqual(s.best, 100);
});

test('存档往返一致', () => {
    const s = createState(null);
    startRound(s, 9);
    s.score = 77;
    tick(s, ROUND_SECONDS);
    const raw = serializeSave(toSave(s));
    const back = deserializeSave(raw);
    assert.deepStrictEqual(back, { version: SAVE_VERSION, best: 77, round: 1 });
});

test('坏档一律回落 null（不抛异常）', () => {
    const bads = [
        null, undefined, '', 'not json', '{}', '[]', 'null',
        JSON.stringify({ version: SAVE_VERSION + 1, best: 5, round: 1 }),
        JSON.stringify({ version: SAVE_VERSION, best: '5', round: 1 }),
        JSON.stringify({ version: SAVE_VERSION, best: 5 }),
        JSON.stringify({ version: SAVE_VERSION, best: Infinity, round: 1 }),
    ];
    for (const raw of bads) {
        assert.strictEqual(deserializeSave(raw), null, `应视为坏档：${String(raw)}`);
    }
});

test('剩余时间格式化', () => {
    assert.strictEqual(formatSeconds(ROUND_SECONDS), '10.0');
    assert.strictEqual(formatSeconds(0), '0.0');
    assert.strictEqual(formatSeconds(-3), '0.0');
    assert.strictEqual(formatSeconds(NaN), '0.0');
});

test('完整一局：点击 → 计时结束 → 存档可取回', () => {
    const s = createState(null);
    startRound(s, 2026);
    for (let i = 0; i < 50; i++) tap(s);
    let ended = false;
    for (let i = 0; i < ROUND_SECONDS; i++) ended = tick(s, 1) || ended;
    assert.ok(ended, '应走完一局');
    assert.strictEqual(s.phase, 'over');
    assert.ok(s.score >= 50, `50 次点击至少 50 分，实际 ${s.score}`);
    assert.strictEqual(s.best, s.score);
    const reloaded = createState(deserializeSave(serializeSave(toSave(s))));
    assert.strictEqual(reloaded.best, s.score);
    assert.strictEqual(reloaded.round, 1);
});

console.log(`\n通过 ${passed} 项`);
console.log('TEMPLATE_CORE_OK');
