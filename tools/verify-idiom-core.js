#!/usr/bin/env node
/**
 * 成语填字 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 覆盖：词库合法性、三档难度各 100 个种子的棋盘生成、交叉/邻接约束、
 *       已知字、候选字组、填字校验、锁定、清空、提示、计分、通关、存档往返。
 *
 * 用法：node tools/verify-idiom-core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_idiom', 'scripts');
const OUT = path.join(ROOT, 'temp', 'idiom-core-test');

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
    path.join(SRC, 'IdiomCore.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const { IdiomCore, IDIOM_DIFFS } = require(path.join(OUT, 'IdiomCore.js'));
const { IDIOM_LIST } = require(path.join(OUT, 'IdiomData.js'));

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

function cellsOf(slot) {
    return slot.cells;
}

function activateSlot(core, slotId) {
    const slot = core.slots[slotId];
    for (const idx of slot.cells) {
        if (core.locked[idx]) continue;
        if (core.select(idx) && core.activeSlot === slotId) return true;
        if (core.select(idx) && core.activeSlot === slotId) return true;
    }
    return core.activeSlot === slotId;
}

function fillSlotCorrectly(core, slotId) {
    const slot = core.slots[slotId];
    if (core.slotLocked[slotId]) return;
    for (const idx of slot.cells) {
        if (core.locked[idx]) continue;
        const owners = core.slotAt(idx);
        const open = owners.filter((s) => !core.slotLocked[s.id]);
        if (open.length === 0) continue;
        core.select(idx);
        if (core.activeSlot >= 0 && core.slotLocked[core.activeSlot]) {
            core.select(idx);
        }
        const res = core.fill(core.solution[idx]);
        if (res.kind === 'wrong') core.resolveWrong();
    }
}

// ==================== 词库 ====================

console.log('\n[词库]');
test('数量 ≥ 200', () => {
    assert(IDIOM_LIST.length >= 200, `只有 ${IDIOM_LIST.length} 条`);
});
test('全部为四字简体成语且无变体选择符', () => {
    for (const word of IDIOM_LIST) {
        assert.strictEqual(typeof word, 'string');
        assert(/^[一-鿿]{4}$/.test(word), `非法词条：${word}`);
        assert(!/[︎️]/.test(word), `含变体选择符：${word}`);
    }
});
test('无重复', () => {
    const seen = new Set();
    for (const word of IDIOM_LIST) {
        assert(!seen.has(word), `重复词条：${word}`);
        seen.add(word);
    }
});

// ==================== 生成 ====================

console.log('\n[生成]');

const DIFFS = ['easy', 'medium', 'hard'];

function checkBoard(core, diff) {
    const conf = IDIOM_DIFFS[diff];
    assert.strictEqual(core.slots.length, conf.words, `${diff} 成语数 ${core.slots.length} ≠ ${conf.words}`);
    assert.strictEqual(core.size, conf.size);

    const owners = new Map();
    for (const slot of core.slots) {
        assert.strictEqual(slot.word.length, 4);
        for (let k = 0; k < 4; k++) {
            const r = slot.dir === 'v' ? slot.row + k : slot.row;
            const c = slot.dir === 'h' ? slot.col + k : slot.col;
            assert(r >= 0 && r < core.size && c >= 0 && c < core.size, `成语 ${slot.id} 越界`);
            const idx = r * core.size + c;
            assert.strictEqual(slot.cells[k], idx, `成语 ${slot.id} 格下标错误`);
            assert.strictEqual(core.solution[idx], slot.word[k], `成语 ${slot.id} 第 ${k} 字与棋盘不一致`);
            if (!owners.has(idx)) owners.set(idx, []);
            const list = owners.get(idx);
            assert(list.length < 2, `格 ${idx} 被超过两条成语占用`);
            list.push(slot);
        }
    }

    // 交叉格必须一横一竖
    for (const [idx, list] of owners) {
        if (list.length === 2) {
            assert.notStrictEqual(list[0].dir, list[1].dir, `格 ${idx} 被两条同向成语占用`);
        }
        assert(['h', 'v'].includes(core.cellDir[idx]), `格 ${idx} 缺少归属方向`);
        assert(list.some((s) => s.dir === core.cellDir[idx]), `格 ${idx} 方向与所属成语不一致`);
    }

    // 邻接约束：非交叉格的四邻（同向两端 + 垂直两侧）不得有别的成语贴着
    for (const slot of core.slots) {
        for (let k = 0; k < 4; k++) {
            const idx = slot.cells[k];
            if (owners.get(idx).length > 1) continue;
            const r = Math.floor(idx / core.size);
            const c = idx % core.size;
            const neighbors = slot.dir === 'h'
                ? [[r - 1, c], [r + 1, c]]
                : [[r, c - 1], [r, c + 1]];
            for (const [nr, nc] of neighbors) {
                if (nr < 0 || nr >= core.size || nc < 0 || nc >= core.size) continue;
                const nidx = nr * core.size + nc;
                assert.strictEqual(core.solution[nidx], '', `成语 ${slot.id} 的格 ${idx} 垂直侧贴着别的字`);
            }
        }
    }

    // 已知字
    let knownCount = 0;
    for (let i = 0; i < core.values.length; i++) {
        if (core.known[i]) {
            knownCount++;
            assert.strictEqual(core.locked[i], true, `已知字格 ${i} 未锁定`);
            assert(core.values[i], `已知字格 ${i} 没有值`);
            assert.strictEqual(core.values[i], core.solution[i], `已知字格 ${i} 与解不一致`);
        }
    }
    if (diff === 'easy') {
        for (const slot of core.slots) {
            const has = slot.cells.some((idx) => core.known[idx]);
            assert(has, `轻松难度成语 ${slot.id} 没有已知字`);
        }
    }

    // 候选字组
    for (const slot of core.slots) {
        const bank = core.banks[slot.id];
        assert(Array.isArray(bank), `成语 ${slot.id} 没有候选字组`);
        assert.strictEqual(bank.length, 4 + conf.decoys, `成语 ${slot.id} 候选数量错误`);
        const own = slot.word.split('');
        const pool = bank.slice();
        for (const ch of own) {
            const at = pool.indexOf(ch);
            assert(at >= 0, `候选字组缺少成语字 ${ch}`);
            pool.splice(at, 1);
        }
        assert.strictEqual(pool.length, conf.decoys, `成语 ${slot.id} 干扰字数量错误`);
        for (const ch of pool) {
            assert(!own.includes(ch), `成语 ${slot.id} 的干扰字 ${ch} 属于该成语`);
        }
    }
    return { owners, knownCount };
}

test('三档难度各 100 个种子均生成完整棋盘', () => {
    for (const diff of DIFFS) {
        for (let seed = 1; seed <= 100; seed++) {
            const core = new IdiomCore(diff, seed * 2654435761 % 2147483647);
            try {
                checkBoard(core, diff);
            } catch (err) {
                err.message = `${diff} seed=${seed}：${err.message}`;
                throw err;
            }
        }
    }
});

test('同种子完全可复现', () => {
    for (const diff of DIFFS) {
        const a = new IdiomCore(diff, 123456789);
        const b = new IdiomCore(diff, 123456789);
        assert.deepStrictEqual(a.slots, b.slots);
        assert.deepStrictEqual(a.solution, b.solution);
        assert.deepStrictEqual(a.banks, b.banks);
        assert.deepStrictEqual(a.known, b.known);
    }
});

test('不同种子棋盘不同', () => {
    const words = new Set();
    for (let seed = 1; seed <= 20; seed++) {
        const core = new IdiomCore('medium', seed);
        words.add(core.slots.map((s) => `${s.word}@${s.row},${s.col},${s.dir}`).join('|'));
    }
    assert(words.size > 1, '不同种子生成了完全相同的棋盘');
});

// ==================== 填字与校验 ====================

console.log('\n[填字与校验]');

test('选中空格会激活所在成语', () => {
    const core = new IdiomCore('easy', 7);
    const slot = core.slots[0];
    const idx = slot.cells.find((i) => !core.locked[i]);
    assert(core.select(idx));
    assert(core.activeSlot >= 0);
    assert(core.slotAt(idx).some((s) => s.id === core.activeSlot));
    assert(core.bank().length === 5);
});

test('同格再点可切换横竖方向', () => {
    let tested = false;
    for (let seed = 1; seed <= 40 && !tested; seed++) {
        const core = new IdiomCore('hard', seed);
        for (const idx of core.slots[0].cells) {
            const owners = core.slotAt(idx);
            if (owners.length === 2 && owners.every((s) => !core.slotLocked[s.id])) {
                core.select(idx);
                const first = core.activeSlot;
                core.select(idx);
                assert.notStrictEqual(core.activeSlot, first, '同一交叉格两次点击未切换方向');
                tested = true;
                break;
            }
        }
    }
    assert(tested, '没有找到可测试的交叉格');
});

test('填满正确成语会锁定并加分', () => {
    const core = new IdiomCore('easy', 11);
    const before = core.score;
    fillSlotCorrectly(core, 0);
    assert.strictEqual(core.slotLocked[0], true, '正确成语未锁定');
    for (const idx of core.slots[0].cells) assert.strictEqual(core.locked[idx], true, '成语格子未锁定');
    assert(core.score > before, '正确完成没有加分');
    assert.strictEqual(core.mistakes, 0);
    assert.strictEqual(core.streak, 1);
});

test('完成一条成语后不再保持激活状态', () => {
    const core = new IdiomCore('easy', 47);
    const slot = core.slots[0];
    let lastKind = 'none';
    for (const idx of slot.cells) {
        if (core.locked[idx]) continue;
        core.select(idx);
        if (core.activeSlot !== slot.id) core.select(idx);
        lastKind = core.fill(core.solution[idx]).kind;
    }
    assert.strictEqual(core.slotLocked[slot.id], true, '目标成语未完成');
    assert.strictEqual(lastKind, 'correct', `最后一格期望 correct，实际 ${lastKind}`);
    assert.notStrictEqual(core.activeSlot, slot.id, '已完成的成语仍被激活');
    assert(core.locked.filter(Boolean).length >= 4, '成语格子没有全部锁定');
});

test('填错会记失误、红闪后清空未锁定格', () => {
    const core = new IdiomCore('easy', 13);
    const slot = core.slots[0];
    const editable = slot.cells.filter((idx) => !core.locked[idx]);
    assert(editable.length > 0, '该成语没有可填格');
    let res = null;
    for (const idx of editable) {
        core.select(idx);
        if (core.activeSlot >= 0 && core.slotLocked[core.activeSlot]) core.select(idx);
        res = core.fill('龘');
        if (res.kind === 'wrong') break;
    }
    assert(res && res.kind === 'wrong', '错误填满未触发校验');
    assert.strictEqual(core.mistakes >= 1, true, '没有记失误');
    assert(core.score >= 0);
    assert(core.isResolving, '未进入红闪等待状态');
    const lockedBefore = core.locked.filter(Boolean).length;
    core.resolveWrong();
    assert.strictEqual(core.isResolving, false);
    for (const idx of slot.cells) {
        if (!core.locked[idx]) assert.strictEqual(core.values[idx], '', `错误格 ${idx} 未清空`);
    }
    assert(core.locked.filter(Boolean).length >= lockedBefore, '清空时丢失了锁定格');
    assert.strictEqual(core.slotLocked[0], false);
});

test('已锁定格不可修改 / 擦除', () => {
    const core = new IdiomCore('easy', 17);
    const idx = core.known.indexOf(true);
    assert(idx >= 0);
    const value = core.values[idx];
    core.select(idx);
    const res = core.fill('错');
    assert.strictEqual(res.kind, 'none');
    assert.strictEqual(core.values[idx], value);
    assert.strictEqual(core.erase(), false);
    assert.strictEqual(core.values[idx], value);
});

test('擦除可清空自己填的字', () => {
    const core = new IdiomCore('easy', 19);
    const idx = core.slots[0].cells.find((i) => !core.locked[i]);
    core.select(idx);
    const res = core.fill(core.solution[idx]);
    assert.notStrictEqual(res.kind, 'none');
    assert.strictEqual(core.values[idx], core.solution[idx]);
    assert.strictEqual(core.erase(), true);
    assert.strictEqual(core.values[idx], '');
});

test('填完一个字光标自动前移到本成语下一个空格', () => {
    const core = new IdiomCore('easy', 41);
    const slot = core.slots[0];
    const first = slot.cells.find((i) => !core.locked[i]);
    assert(typeof first === 'number', '该成语没有可填格');
    core.select(first);
    assert.strictEqual(core.activeSlot, slot.id, '未激活目标成语');
    const res = core.fill(core.solution[first]);
    assert.strictEqual(res.kind, 'filled', `期望 filled，实际 ${res.kind}`);
    assert.strictEqual(core.values[first], core.solution[first]);
    assert.notStrictEqual(core.selected, first, '光标没有前移');
    assert(slot.cells.indexOf(core.selected) >= 0, '光标移出了当前成语');
    assert.strictEqual(core.values[core.selected], '', '光标落在了已填格上');
});

test('擦除会回退并清掉上一个自己填的字', () => {
    const core = new IdiomCore('easy', 43);
    const slot = core.slots[0];
    const first = slot.cells.find((i) => !core.locked[i]);
    core.select(first);
    core.fill(core.solution[first]);
    const moved = core.selected;
    assert.notStrictEqual(moved, first);
    assert.strictEqual(core.erase(), true, '自动前移后擦除失效');
    assert.strictEqual(core.values[first], '', '上一个字没有被擦掉');
    assert.strictEqual(core.selected, first, '擦除后光标没有回到被擦的格');
});

test('提示补满带错字的成语会清空，不会卡在「还差 0 字」', () => {
    const core = new IdiomCore('easy', 71);
    const slot = core.slots.find((s) => s.cells.filter((i) => !core.locked[i]).length >= 2);
    assert(slot, '没有找到可测试的成语');
    const editable = slot.cells.filter((idx) => !core.locked[idx]);

    // 模拟玩家：第一格填错字，中间填正确字，只留最后一格空着
    core.values[editable[0]] = '龘';
    for (let i = 1; i < editable.length - 1; i++) core.values[editable[i]] = core.solution[editable[i]];
    core.activeSlot = slot.id;
    core.selected = editable[editable.length - 1];

    const hinted = core.hint();
    assert(hinted >= 0, '提示不可用');
    assert.strictEqual(core.slotLocked[slot.id], false, '带错字的成语被当成完成');
    assert.strictEqual(core.hintClearedSlot, true, '没有标记已清空');
    assert.strictEqual(core.values[editable[0]], '', '错字没有被清掉');
    const emptyLeft = slot.cells.filter((idx) => !core.locked[idx] && !core.values[idx]);
    assert(emptyLeft.length > 0, '清空后仍没有可填的格（卡死）');
});

test('提示填入正确字并计次扣分', () => {
    const core = new IdiomCore('easy', 23);
    const before = core.score;
    core.select(core.slots[0].cells.find((i) => !core.locked[i]));
    const idx = core.hint();
    assert(idx >= 0, '提示没有返回格');
    assert.strictEqual(core.values[idx], core.solution[idx], '提示字不正确');
    assert.strictEqual(core.locked[idx], true, '提示格未锁定');
    assert.strictEqual(core.known[idx], true);
    assert.strictEqual(core.hintsUsed, 1);
    assert(core.score <= before);
});

test('提示次数用尽返回 -1', () => {
    const core = new IdiomCore('hard', 29);
    const max = core.maxHints;
    for (let i = 0; i < max; i++) {
        core.select(core.slots[0].cells.find((idx) => !core.locked[idx]));
        assert(core.hint() >= 0, `第 ${i + 1} 次提示失败`);
    }
    core.select(core.slots[0].cells.find((idx) => !core.locked[idx]));
    assert.strictEqual(core.hint(), -1);
    assert.strictEqual(core.hintsLeft, 0);
});

test('全对后通关', () => {
    for (const diff of DIFFS) {
        const core = new IdiomCore(diff, 31);
        for (let round = 0; round < 10 && core.status !== 'won'; round++) {
            for (const slot of core.slots) fillSlotCorrectly(core, slot.id);
        }
        assert.strictEqual(core.status, 'won', `${diff} 未通关`);
        assert.strictEqual(core.isComplete(), true);
        assert.strictEqual(core.mistakes, 0);
        const final = core.finalScore(90);
        assert(Number.isFinite(final) && final >= 0, '最终分非法');
    }
});

test('连击递增、失误归零', () => {
    const core = new IdiomCore('easy', 37);
    fillSlotCorrectly(core, 0);
    assert.strictEqual(core.streak, 1);
    fillSlotCorrectly(core, 1);
    assert.strictEqual(core.streak, 2);
    // 故意填错一条未完成成语
    const target = core.slots.find((s) => !core.slotLocked[s.id] && s.cells.some((i) => !core.locked[i]));
    if (target) {
        for (const idx of target.cells) {
            if (core.locked[idx]) continue;
            core.select(idx);
            if (core.activeSlot >= 0 && core.slotLocked[core.activeSlot]) core.select(idx);
            const res = core.fill('龘');
            if (res.kind === 'wrong') {
                core.resolveWrong();
                break;
            }
        }
        assert.strictEqual(core.streak, 0, '失误后连击未归零');
    }
});

test('最终分无 NaN / Infinity 且不为负', () => {
    const cases = [
        new IdiomCore('easy', 41),
        new IdiomCore('medium', 43),
        new IdiomCore('hard', 47),
    ];
    for (const core of cases) {
        for (const elapsed of [0, 1, 300, 99999, -5, NaN]) {
            const value = core.finalScore(elapsed);
            assert(Number.isFinite(value), `elapsed=${elapsed} 得到 ${value}`);
            assert(value >= 0, `elapsed=${elapsed} 得到负数`);
        }
    }
});

// ==================== 存档 ====================

console.log('\n[存档]');

test('快照往返保留棋盘与进度', () => {
    const core = new IdiomCore('medium', 53);
    const idx = core.slots[0].cells.find((i) => !core.locked[i]);
    core.select(idx);
    core.fill(core.solution[idx]);
    core.hint();
    const snap = core.snapshot(42, true);
    const restored = IdiomCore.fromSnapshot(snap);
    assert(restored, '读档失败');
    assert.deepStrictEqual(restored.slots, core.slots);
    assert.deepStrictEqual(restored.values, core.values);
    assert.deepStrictEqual(restored.locked, core.locked);
    assert.deepStrictEqual(restored.slotLocked, core.slotLocked);
    assert.deepStrictEqual(restored.known, core.known);
    assert.strictEqual(restored.score, core.score);
    assert.strictEqual(restored.mistakes, core.mistakes);
    assert.strictEqual(restored.hintsUsed, core.hintsUsed);
    assert.strictEqual(restored.status, core.status);
});

test('通关存档读回仍为通关', () => {
    const core = new IdiomCore('easy', 59);
    for (let round = 0; round < 10 && core.status !== 'won'; round++) {
        for (const slot of core.slots) fillSlotCorrectly(core, slot.id);
    }
    const restored = IdiomCore.fromSnapshot(core.snapshot(30, true));
    assert(restored);
    assert.strictEqual(restored.status, 'won');
    assert.strictEqual(restored.isComplete(), true);
});

test('坏存档返回 null', () => {
    assert.strictEqual(IdiomCore.fromSnapshot(null), null);
    assert.strictEqual(IdiomCore.fromSnapshot({}), null);
    assert.strictEqual(IdiomCore.fromSnapshot({ difficulty: 'easy', seed: 1 }), null);
    assert.strictEqual(IdiomCore.fromSnapshot({
        difficulty: 'easy', seed: 1, words: ['错了'], values: [], locked: [], slotLocked: [],
    }), null);
    const core = new IdiomCore('easy', 61);
    const snap = core.snapshot(0, false);
    snap.words[0] = '不会出现在盘上';
    assert.strictEqual(IdiomCore.fromSnapshot(snap), null);
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
console.log('成语填字核心自检通过。');
