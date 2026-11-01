#!/usr/bin/env node
/**
 * 纸牌接龙 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 覆盖：洗牌确定性、发牌形状、抽 1/抽 3、重洗顺序、列/收牌区合法性、
 *       整段移动、翻牌与计分、点击自动移动、撤销、一键收牌、提示优先级、
 *       存档往返与坏数据、随机对局不变式。
 *
 * 用法：
 *   node tools/verify-solitaire-core.js
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
const SRC = path.join(ROOT, 'assets', 'games', 'game_solitaire', 'scripts');
const OUT = path.join(ROOT, 'temp', 'solitaire-core-test');

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
    path.join(SRC, 'SolitaireConfig.ts'),
    path.join(SRC, 'SolitaireCore.ts'),
    path.join(SRC, 'SolitaireLayout.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const { SolitaireCore, PILE_WASTE, PILE_FOUNDATION_BASE, SUITS } = require(path.join(OUT, 'SolitaireCore.js'));
const L = require(path.join(OUT, 'SolitaireLayout.js'));
const CFG = require(path.join(OUT, 'SolitaireConfig.js'));

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

function group(name) {
    console.log(`\n${name}`);
}

function eq(actual, expected, msg) {
    assert.deepStrictEqual(actual, expected, msg);
}

function ok(value, msg) {
    assert.ok(value, msg);
}

// ==================== 构造辅助 ====================

const FOUNDATION = i => PILE_FOUNDATION_BASE + i;

function card(suit, rank, faceUp = true) {
    return { suit, rank, faceUp: !!faceUp };
}

function makeState(partial) {
    return {
        stock: [],
        waste: [],
        foundations: [[], [], [], []],
        tableau: [[], [], [], [], [], [], []],
        score: 0,
        moves: 0,
        seed: 1,
        drawCount: 1,
        recycles: 0,
        ...partial,
    };
}

function coreWith(partial) {
    const core = new SolitaireCore();
    core.state = makeState(partial);
    return core;
}

function fullDeckExcept(used) {
    const seen = new Set(used.map(c => `${c.suit}${c.rank}`));
    const rest = [];
    for (const suit of SUITS) {
        for (let rank = 1; rank <= 13; rank++) {
            if (!seen.has(`${suit}${rank}`)) rest.push(card(suit, rank, false));
        }
    }
    return rest;
}

/** 把所有牌摊平，用于不变式检查 */
function allCards(state) {
    return [
        ...state.stock,
        ...state.waste,
        ...state.foundations.flat(),
        ...state.tableau.flat(),
    ];
}

function assertInvariants(core) {
    const state = core.state;

    // 牌数守恒且无重复
    const all = allCards(state);
    eq(all.length, 52, `牌数应为 52，实际 ${all.length}`);
    eq(new Set(all.map(c => `${c.suit}${c.rank}`)).size, 52, '出现重复牌');

    // 牌堆全背面，废牌堆全正面
    for (const c of state.stock) ok(!c.faceUp, '牌堆里不应有正面牌');
    for (const c of state.waste) ok(c.faceUp, '废牌堆里不应有背面牌');

    // 收牌区：从 A 起同花色升序
    for (const pile of state.foundations) {
        for (let i = 0; i < pile.length; i++) {
            eq(pile[i].rank, i + 1, '收牌区点数不连续');
            ok(pile[i].faceUp, '收牌区的牌应正面');
            if (i > 0) eq(pile[i].suit, pile[i - 1].suit, '收牌区花色不统一');
        }
    }

    // 牌桌列：背面在底、正面在上，且正面段是降序异色
    for (const pile of state.tableau) {
        let firstUp = pile.findIndex(c => c.faceUp);
        if (firstUp < 0) continue;
        for (let i = firstUp; i < pile.length; i++) {
            ok(pile[i].faceUp, '正面牌下方不应再出现背面牌');
            if (i > firstUp) {
                eq(pile[i].rank, pile[i - 1].rank - 1, '列内点数不连续');
                assert.notStrictEqual(
                    isRed(pile[i].suit), isRed(pile[i - 1].suit),
                    '列内颜色未交替',
                );
            }
        }
    }
}

function isRed(suit) {
    return suit === 'H' || suit === 'D';
}

function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ==================== 洗牌与发牌 ====================

group('洗牌与发牌');

test('同种子发牌完全一致', () => {
    const a = new SolitaireCore();
    const b = new SolitaireCore();
    a.deal(123456, 1);
    b.deal(123456, 1);
    eq(a.stateHash(), b.stateHash());
});

test('不同种子发牌不同', () => {
    const a = new SolitaireCore();
    const b = new SolitaireCore();
    a.deal(1, 1);
    b.deal(2, 1);
    assert.notStrictEqual(a.stateHash(), b.stateHash());
});

test('7 列分别为 1–7 张', () => {
    const core = new SolitaireCore();
    core.deal(42, 1);
    eq(core.state.tableau.map(p => p.length), [1, 2, 3, 4, 5, 6, 7]);
    assertInvariants(core);
});

test('每列只有最底一张正面，牌堆 24 张且全背面', () => {
    const core = new SolitaireCore();
    core.deal(7, 1);
    for (const pile of core.state.tableau) {
        ok(pile[pile.length - 1].faceUp, '列底牌应正面');
        for (let i = 0; i < pile.length - 1; i++) ok(!pile[i].faceUp, '非底牌应背面');
    }
    eq(core.state.stock.length, 24);
    ok(core.state.stock.every(c => !c.faceUp));
    eq(core.state.waste.length, 0);
    eq(core.state.score, 0);
    eq(core.state.moves, 0);
});

test('发牌后 52 张无重复', () => {
    const core = new SolitaireCore();
    core.deal(99, 1);
    eq(new Set(allCards(core.state).map(c => `${c.suit}${c.rank}`)).size, 52);
});

// ==================== 抽牌与重洗 ====================

group('抽牌与重洗');

test('抽 1：每次一张，数量守恒', () => {
    const core = new SolitaireCore();
    core.deal(1, 1);
    const before = core.state.stock[0];
    ok(core.draw());
    eq(core.state.waste.length, 1);
    eq(core.state.stock.length, 23);
    eq(core.state.waste[0].suit, before.suit);
    eq(core.state.waste[0].rank, before.rank);
    ok(core.state.waste[0].faceUp);
});

test('抽 3：第三张在废牌堆顶', () => {
    const core = new SolitaireCore();
    core.deal(2, 3);
    const s0 = core.state.stock[0];
    const s1 = core.state.stock[1];
    const s2 = core.state.stock[2];
    ok(core.draw());
    eq(core.state.waste.length, 3);
    eq(core.state.waste[0].rank, s0.rank);
    eq(core.state.waste[1].rank, s1.rank);
    eq(core.state.waste[2].rank, s2.rank);
    eq(core.topOf(PILE_WASTE).rank, s2.rank);
});

test('抽 3：剩余不足 3 张时抽完为止', () => {
    const core = coreWith({
        stock: [card('S', 5, false), card('H', 6, false)],
        drawCount: 3,
    });
    // 补满 52 张以满足不变式（其余放牌桌背面）
    core.state.tableau[0] = fullDeckExcept(allCards(core.state));
    ok(core.draw());
    eq(core.state.waste.length, 2);
    eq(core.state.stock.length, 0);
});

test('重洗：废牌堆按原顺序回到牌堆且全部背面', () => {
    const core = coreWith({
        waste: [card('S', 5, true), card('H', 6, true), card('D', 7, true)],
    });
    const first = core.state.waste[0];
    ok(core.recycle());
    eq(core.state.waste.length, 0);
    eq(core.state.stock.length, 3);
    eq(core.state.stock[0].rank, first.rank);
    eq(core.state.stock[0].suit, first.suit);
    ok(core.state.stock.every(c => !c.faceUp));
    eq(core.state.recycles, 1);
});

test('重洗后再抽，抽出的是最早弃掉的那张', () => {
    const core = coreWith({
        waste: [card('S', 5, true), card('H', 6, true), card('D', 7, true)],
    });
    core.recycle();
    core.draw();
    eq(core.state.waste[0].rank, 5);
    eq(core.state.waste[0].suit, 'S');
});

test('牌堆非空时不能重洗', () => {
    const core = coreWith({
        stock: [card('S', 5, false)],
        waste: [card('H', 6, true)],
    });
    ok(!core.recycle());
});

test('抽 3 重洗扣 20 分，抽 1 不扣', () => {
    const c3 = coreWith({
        waste: [card('S', 5, true)],
        score: 100,
        drawCount: 3,
    });
    c3.recycle();
    eq(c3.state.score, 80);

    const c1 = coreWith({
        waste: [card('S', 5, true)],
        score: 100,
        drawCount: 1,
    });
    c1.recycle();
    eq(c1.state.score, 100);
});

test('分数不会低于 0', () => {
    const core = coreWith({
        waste: [card('S', 5, true)],
        score: 10,
        drawCount: 3,
    });
    core.recycle();
    eq(core.state.score, 0);
});

// ==================== 合法性 ====================

group('移动合法性');

test('列 → 列：降序异色合法', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 12, true)];
    core.state.tableau[1] = [card('S', 13, true)];
    ok(core.isLegalMove(0, 1, 1));
});

test('列 → 列：同色拒绝', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 13, true)];
    core.state.tableau[1] = [card('D', 12, true)];
    ok(!core.isLegalMove(0, 1, 1));
});

test('列 → 列：跳点拒绝', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 13, true)];
    core.state.tableau[1] = [card('H', 11, true)];
    ok(!core.isLegalMove(0, 1, 1));
});

test('空列只接受 K', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 4, false), card('H', 12, true)];
    ok(!core.isLegalMove(0, 1, 1));

    core.state.tableau[0] = [card('H', 4, false), card('S', 13, true)];
    ok(core.isLegalMove(0, 1, 1));
});

test('整列搬到另一个空列被拒绝（无意义操作）', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 13, true)];
    ok(!core.isLegalMove(0, 1, 1));
});

test('列底有背面牌时，K 可以搬到空列', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 4, false), card('S', 13, true)];
    ok(core.isLegalMove(0, 1, 1));
});

test('收牌区：空槽只接受 A', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 2, true)];
    ok(!core.isLegalMove(0, FOUNDATION(0), 1));

    core.state.tableau[0] = [card('S', 1, true)];
    ok(core.isLegalMove(0, FOUNDATION(0), 1));
});

test('收牌区：同花色升序，异花色与跳点拒绝', () => {
    const core = coreWith();
    core.state.foundations[0] = [card('S', 1, true)];
    core.state.tableau[0] = [card('S', 2, true)];
    core.state.tableau[1] = [card('H', 2, true)];
    core.state.tableau[2] = [card('S', 3, true)];

    ok(core.isLegalMove(0, FOUNDATION(0), 1));
    ok(!core.isLegalMove(1, FOUNDATION(0), 1));
    ok(!core.isLegalMove(2, FOUNDATION(0), 1));
});

test('收牌区只能移单张', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 13, true), card('S', 1, true)];
    ok(!core.isLegalMove(0, FOUNDATION(0), 2));
});

test('收牌区 → 列合法（单张）', () => {
    const core = coreWith();
    core.state.foundations[0] = [card('S', 1, true)];
    core.state.tableau[0] = [card('H', 2, true)];
    ok(core.isLegalMove(FOUNDATION(0), 0, 1));
});

test('收牌区之间不能互搬（空槽不吸 A）', () => {
    const core = coreWith();
    core.state.foundations[0] = [card('S', 1, true)];
    ok(!core.isLegalMove(FOUNDATION(0), FOUNDATION(1), 1));
});

test('废牌堆顶可以进列与收牌区', () => {
    const core = coreWith();
    core.state.waste = [card('S', 1, true)];
    ok(core.isLegalMove(PILE_WASTE, FOUNDATION(0), 1));

    core.state.tableau[0] = [card('H', 2, true)];
    ok(core.isLegalMove(PILE_WASTE, 0, 1));
});

test('不能移进废牌堆 / 不能移回牌堆', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 1, true)];
    core.state.waste = [card('H', 2, true)];
    ok(!core.isLegalMove(0, PILE_WASTE, 1));
});

// ==================== 整段移动 ====================

group('整段移动');

test('合法降序异色段可整段移动', () => {
    const core = coreWith();
    core.state.tableau[0] = [
        card('H', 4, false),
        card('S', 13, true),
        card('H', 12, true),
        card('S', 11, true),
    ];
    eq(core.movableRun(0), 3);
    ok(core.isLegalMove(0, 1, 3));

    const result = core.move(0, 1, 3);
    ok(result);
    eq(core.state.tableau[0].length, 1);
    eq(core.state.tableau[1].map(c => c.rank), [13, 12, 11]);
});

test('含背面牌时只能拖起单张', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 13, true), card('H', 12, false)];
    eq(core.movableRun(0), 0);
    ok(!core.isLegalMove(0, 1, 1));
});

test('同色断段只能拖起单张', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 13, true), card('S', 12, true)];
    eq(core.movableRun(0), 1);
});

test('跳点断段只能拖起单张', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 13, true), card('H', 11, true)];
    eq(core.movableRun(0), 1);
});

test('从段中间拖起（后缀）合法', () => {
    const core = coreWith();
    core.state.tableau[0] = [
        card('S', 13, true),
        card('H', 12, true),
        card('S', 11, true),
    ];
    core.state.tableau[1] = [card('C', 13, true)];
    // 只搬 Q♥、J♠ 两张：Q 落在 K♣ 上
    ok(core.isLegalMove(0, 1, 2));

    ok(core.move(0, 1, 2));
    eq(core.state.tableau[0].map(c => c.rank), [13]);
    eq(core.state.tableau[1].map(c => c.rank), [13, 12, 11]);
});

// ==================== 翻牌与计分 ====================

group('翻牌与计分');

test('移动后来源列底牌自动翻正并 +5', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 4, false), card('S', 13, true)];
    const result = core.move(0, 1, 1);
    ok(result);
    ok(result.flipped);
    eq(result.scoreDelta, 5);
    ok(core.state.tableau[0][0].faceUp);
    eq(core.state.score, 5);
});

test('废牌堆 → 列 +5', () => {
    const core = coreWith({ waste: [card('H', 12, true)] });
    core.state.tableau[0] = [card('S', 13, true)];
    ok(core.move(PILE_WASTE, 0, 1));
    eq(core.state.score, 5);
});

test('列 / 废牌堆 → 收牌区 +10', () => {
    const core = coreWith({ waste: [card('S', 1, true)] });
    core.state.tableau[0] = [card('H', 1, true)];
    core.move(0, FOUNDATION(1), 1);
    eq(core.state.score, 10);
    core.move(PILE_WASTE, FOUNDATION(0), 1);
    eq(core.state.score, 20);
});

test('收牌区 → 列 −15', () => {
    const core = coreWith({ score: 100 });
    core.state.foundations[0] = [card('S', 1, true)];
    core.state.tableau[0] = [card('H', 2, true)];
    core.move(FOUNDATION(0), 0, 1);
    eq(core.state.score, 85);
});

test('步数按操作计数', () => {
    const core = coreWith({ waste: [card('H', 12, true)] });
    core.state.tableau[0] = [card('S', 13, true)];
    core.move(PILE_WASTE, 0, 1);
    eq(core.state.moves, 1);
});

// ==================== 点击自动移动 ====================

group('点击自动移动');

test('点击 A 自动进收牌区', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 1, true)];
    const r = core.tapPile(0);
    ok(r);
    eq(r.to, FOUNDATION(0));
    eq(core.state.foundations[0].length, 1);
});

test('点击时收牌区优先于列', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 1, true)];
    core.state.tableau[1] = [card('H', 2, true)];
    const r = core.tapPile(0);
    eq(r.to, FOUNDATION(0));
});

test('无收牌区时可进列，且只移动顶牌', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 13, true), card('H', 12, true)];
    core.state.tableau[1] = [card('C', 13, true)];
    const r = core.tapPile(0);
    ok(r);
    eq(r.count, 1);
    eq(core.state.tableau[0].length, 1);
    eq(core.state.tableau[1].length, 2);
});

test('无处可去返回 null', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 12, true)];
    core.state.tableau[1] = [card('S', 10, true)];
    eq(core.tapPile(0), null);
});

test('点击背面牌不动作', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 12, false)];
    eq(core.tapPile(0), null);
});

// ==================== 撤销 ====================

group('撤销');

test('撤销抽牌恢复原状', () => {
    const core = new SolitaireCore();
    core.deal(5, 1);
    const before = core.stateHash();
    core.draw();
    ok(core.canUndo());
    ok(core.undo());
    eq(core.stateHash(), before);
});

test('撤销移动恢复牌面、分数与步数', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 4, false), card('S', 13, true)];
    const before = core.stateHash();
    core.move(0, 1, 1);
    core.undo();
    eq(core.stateHash(), before);
});

test('撤销重洗恢复牌堆顺序', () => {
    const core = coreWith({ waste: [card('S', 5, true), card('H', 6, true)] });
    const before = core.stateHash();
    core.recycle();
    core.undo();
    eq(core.stateHash(), before);
});

test('无操作时撤销返回 false', () => {
    const core = new SolitaireCore();
    core.deal(3, 1);
    ok(!core.undo());
});

test('连续 50 步撤销回到初始', () => {
    const core = new SolitaireCore();
    core.deal(20261101, 3);
    const initial = core.stateHash();
    const rng = makeRng(7);

    let actions = 0;
    for (let i = 0; i < 50; i++) {
        const moves = core.legalMoves();
        const choices = [];
        if (core.canDraw()) choices.push('draw');
        for (const m of moves) choices.push(m);
        if (choices.length === 0) break;
        const pick = choices[Math.floor(rng() * choices.length)];
        if (pick === 'draw') {
            core.draw();
        } else {
            const r = core.move(pick.from, pick.to, pick.count);
            if (!r) break;
        }
        actions++;
    }

    for (let i = 0; i < actions; i++) ok(core.undo(), `第 ${i + 1} 次撤销失败`);
    eq(core.stateHash(), initial);
});

test('撤销栈上限 50', () => {
    const core = new SolitaireCore();
    core.deal(11, 1);
    for (let i = 0; i < 80; i++) {
        if (core.canDraw()) core.draw();
        else core.recycle();
    }
    let count = 0;
    while (core.undo()) count++;
    eq(count, 50);
});

// ==================== 一键收牌与胜利 ====================

group('一键收牌与胜利');

test('牌堆/废牌堆非空时不允许一键收牌', () => {
    const core = coreWith({ stock: [card('S', 5, false)] });
    core.state.tableau[0] = [card('H', 1, true)];
    ok(!core.canAutoCollect());
    eq(core.autoCollect(), 0);
});

test('有背面牌时不允许一键收牌', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 4, false), card('S', 1, true)];
    ok(!core.canAutoCollect());
});

test('一键收牌按点数顺序收完，并计入一次操作', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 2, true), card('S', 1, true)];
    // 注意：H2 在 S1 下面不合法，这里只验证「可收的牌」被收走
    core.state.tableau[1] = [card('D', 1, true)];
    ok(core.canAutoCollect());
    const moved = core.autoCollect();
    eq(moved, 2);
    eq(core.state.foundations.filter(f => f.length > 0).length, 2);
    eq(core.state.moves, 1);
});

test('收满 4 个花色 13 张判胜', () => {
    const core = coreWith();
    for (let i = 0; i < 4; i++) {
        const suit = SUITS[i];
        core.state.foundations[i] = [];
        for (let rank = 1; rank <= 13; rank++) core.state.foundations[i].push(card(suit, rank, true));
    }
    ok(core.isWon());
    ok(!core.canAutoCollect());
});

test('未收满不判胜', () => {
    const core = coreWith();
    core.state.foundations[0] = [card('S', 1, true)];
    ok(!core.isWon());
});

// ==================== 提示 ====================

group('提示');

test('提示优先选收牌区', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 4, false), card('S', 1, true)];
    core.state.tableau[1] = [card('C', 11, true)];
    core.state.tableau[2] = [card('D', 12, true)];
    const hint = core.hint();
    ok(hint);
    eq(hint.kind, 'move');
    eq(hint.priority, 1);
    eq(hint.to, FOUNDATION(0));
});

test('无合法移动时提示抽牌', () => {
    const core = coreWith({ stock: [card('S', 5, false)] });
    core.state.tableau[0] = [card('H', 12, true)];
    const hint = core.hint();
    ok(hint);
    eq(hint.kind, 'draw');
});

test('牌堆与废牌堆都空且无解时提示为 null', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('H', 12, true)];
    core.state.tableau[1] = [card('S', 10, true)];
    eq(core.hint(), null);
});

test('提示排序稳定：相同优先级取列号小者', () => {
    const core = coreWith();
    core.state.tableau[0] = [card('S', 1, true)];
    core.state.tableau[1] = [card('H', 1, true)];
    const hint = core.hint();
    eq(hint.from, 0);
});

// ==================== 存档 ====================

group('存档');

test('存档往返状态一致', () => {
    const core = new SolitaireCore();
    core.deal(777, 3);
    core.draw();
    const moves = core.legalMoves();
    if (moves.length > 0) core.move(moves[0].from, moves[0].to, moves[0].count);

    const json = JSON.parse(JSON.stringify(core.serialize()));
    const restored = SolitaireCore.fromSave(json);
    ok(restored, '存档应能解析');
    eq(restored.stateHash(), core.stateHash());
    eq(restored.state.drawCount, 3);
    eq(restored.state.seed, 777);
});

test('坏存档一律返回 null', () => {
    const core = new SolitaireCore();
    core.deal(1, 1);
    const good = JSON.parse(JSON.stringify(core.serialize()));

    eq(SolitaireCore.fromSave(null), null);
    eq(SolitaireCore.fromSave({}), null);
    eq(SolitaireCore.fromSave({ ...good, v: 99 }), null);
    eq(SolitaireCore.fromSave({ ...good, drawCount: 2 }), null);

    const missing = JSON.parse(JSON.stringify(good));
    missing.stock.pop();
    eq(SolitaireCore.fromSave(missing), null);

    const duplicate = JSON.parse(JSON.stringify(good));
    duplicate.waste.push({ ...duplicate.stock[0] });
    eq(SolitaireCore.fromSave(duplicate), null);

    const badSuit = JSON.parse(JSON.stringify(good));
    badSuit.stock[0].s = 'X';
    eq(SolitaireCore.fromSave(badSuit), null);

    const badRank = JSON.parse(JSON.stringify(good));
    badRank.stock[0].r = 14;
    eq(SolitaireCore.fromSave(badRank), null);
});

test('存档中的牌堆被强制为背面、废牌堆为正面', () => {
    const core = new SolitaireCore();
    core.deal(1, 1);
    // 人为把牌堆顶改成正面，并挪一张到废牌堆改成背面
    core.state.stock[0] = { ...core.state.stock[0], faceUp: true };
    const moved = core.state.stock.pop();
    core.state.waste = [{ ...moved, faceUp: false }];

    const restored = SolitaireCore.fromSave(JSON.parse(JSON.stringify(core.serialize())));
    ok(restored);
    ok(!restored.state.stock[0].faceUp);
    ok(restored.state.waste[0].faceUp);
});

// ==================== 随机对局不变式 ====================

group('随机对局不变式');

test('1 万次随机合法操作后状态始终合法', () => {
    const core = new SolitaireCore();
    core.deal(20261101, 3);
    const rng = makeRng(2026);
    assertInvariants(core);

    for (let i = 0; i < 10000; i++) {
        const choices = [];
        if (core.canDraw()) choices.push('draw');
        if (core.canUndo() && rng() < 0.05) choices.push('undo'); // 混入撤销
        for (const m of core.legalMoves()) choices.push(m);
        if (choices.length === 0) break;

        const pick = choices[Math.floor(rng() * choices.length)];
        if (pick === 'draw') {
            core.draw();
        } else if (pick === 'undo') {
            core.undo();
        } else {
            const r = core.move(pick.from, pick.to, pick.count);
            ok(r, 'legalMoves 给出的移动必须可提交');
        }
        assertInvariants(core);
        if (core.isWon()) break;
    }
});

test('提示给出的移动永远可提交', () => {
    for (let seed = 1; seed <= 50; seed++) {
        const core = new SolitaireCore();
        core.deal(seed, seed % 2 === 0 ? 1 : 3);
        for (let step = 0; step < 60; step++) {
            const hint = core.hint();
            if (!hint) break;
            if (hint.kind === 'draw') {
                ok(core.draw(), `seed ${seed}: 提示抽牌应可执行`);
            } else {
                const r = core.move(hint.from, hint.to, hint.count);
                ok(r, `seed ${seed}: 提示移动应可提交`);
            }
        }
    }
});

// ==================== 布局与交互几何 ====================

test('发牌后布局覆盖 52 张且键唯一', () => {
    const core = new SolitaireCore();
    core.deal(7, 1);
    const places = L.buildLayout(core.state);
    assert.strictEqual(places.length, 52);
    assert.strictEqual(new Set(places.map(p => p.key)).size, 52);
});

test('列首位置与列栅格一致', () => {
    const core = new SolitaireCore();
    core.deal(1, 1);
    const places = L.buildLayout(core.state);
    for (let p = 0; p < 7; p++) {
        const first = places.find(x => x.pile === p && x.index === 0);
        assert.strictEqual(first.left, CFG.colLeftX(p), `列 ${p} 的 x`);
        assert.strictEqual(first.top, CFG.COLUMN_TOP_Y, `列 ${p} 的 y`);
    }
});

test('背面间距 14、正面顶牌间距 30', () => {
    const core = new SolitaireCore();
    core.deal(3, 1);
    const places = L.buildLayout(core.state).filter(x => x.pile === 3);
    assert.deepStrictEqual(places.map(x => x.top), [
        CFG.COLUMN_TOP_Y,
        CFG.COLUMN_TOP_Y + CFG.FAN_DOWN,
        CFG.COLUMN_TOP_Y + CFG.FAN_DOWN * 2,
        CFG.COLUMN_TOP_Y + CFG.FAN_DOWN * 3,
    ]);
    const col6 = L.buildLayout(core.state).filter(x => x.pile === 6);
    assert.strictEqual(col6[1].top - col6[0].top, CFG.FAN_DOWN);
});

test('超长列正面间距会压缩到可用高度内', () => {
    const cards = [];
    for (let i = 0; i < 30; i++) cards.push(card('S', (i % 13) + 1));
    const state = makeState({ tableau: [cards, [], [], [], [], [], []] });
    const places = L.buildLayout(state).filter(x => x.pile === 0);
    const gap = places[1].top - places[0].top;
    const available = CFG.COLUMN_BOTTOM_Y - CFG.COLUMN_TOP_Y;
    assert.ok(gap < CFG.FAN_UP, `30 张正面应压缩，实际 ${gap}`);
    assert.ok(gap >= CFG.FAN_UP_MIN, `不低于下限，实际 ${gap}`);
    assert.ok(places[29].top + CFG.CARD_H <= CFG.COLUMN_BOTTOM_Y, '最后一张不越界');
    assert.strictEqual(gap, Math.floor((available - CFG.CARD_H) / 29));
});

test('压缩间距不低于 FAN_UP_MIN', () => {
    const cards = [];
    for (let i = 0; i < 50; i++) cards.push(card('H', (i % 13) + 1));
    const state = makeState({ tableau: [cards, [], [], [], [], [], []] });
    const places = L.buildLayout(state).filter(x => x.pile === 0);
    assert.strictEqual(places[1].top - places[0].top, CFG.FAN_UP_MIN);
});

test('designToLocal / localToDesign 往返一致', () => {
    const cases = [[0, 0], [315, 108], [colX(6), 700]];
    for (const [left, top] of cases) {
        const local = L.designToLocal(left, top);
        const back = L.localToDesign(local.x, local.y);
        assert.ok(Math.abs(back.left - left) < 1e-9);
        assert.ok(Math.abs(back.top - top) < 1e-9);
    }
    const origin = L.designToLocal(0, 0);
    assert.strictEqual(origin.x, CFG.CARD_W / 2 - CFG.DESIGN_W / 2);
    assert.strictEqual(origin.y, CFG.DESIGN_H / 2 - CFG.CARD_H / 2);
});

function colX(i) {
    return CFG.colLeftX(i);
}

test('牌堆命中矩形', () => {
    assert.ok(L.hitStock(colX(0) + CFG.CARD_W / 2, CFG.TOP_ROW_Y + CFG.CARD_H / 2));
    assert.ok(!L.hitStock(colX(0) + CFG.CARD_W / 2, CFG.TOP_ROW_Y + CFG.CARD_H + 1));
    assert.ok(!L.hitStock(colX(1) + CFG.CARD_W / 2, CFG.TOP_ROW_Y + 10));
});

test('命中判定取同列视觉最上面那张', () => {
    const core = new SolitaireCore();
    core.deal(5, 1);
    const layout = L.indexLayout(L.buildLayout(core.state));
    const top = layout.get(L.cardKey(core.state.tableau[6][6]));
    const hit = L.hitTest(layout, core.state, top.left + 10, top.top + 10);
    assert.ok(hit, '应命中列顶牌');
    assert.strictEqual(hit.pile, 6);
    assert.strictEqual(hit.index, 6);
});

test('背面牌不可命中', () => {
    const core = new SolitaireCore();
    core.deal(5, 1);
    const layout = L.indexLayout(L.buildLayout(core.state));
    const back = layout.get(L.cardKey(core.state.tableau[6][0]));
    const hit = L.hitTest(layout, core.state, back.left + 10, back.top + 5);
    assert.strictEqual(hit, null);
});

test('空白区域不命中', () => {
    const core = new SolitaireCore();
    core.deal(5, 1);
    const layout = L.indexLayout(L.buildLayout(core.state));
    const hit = L.hitTest(layout, core.state, CFG.colCenterX(0), CFG.COLUMN_BOTTOM_Y - 5);
    assert.strictEqual(hit, null);
});

test('废牌堆顶牌可命中', () => {
    const core = new SolitaireCore();
    core.deal(5, 1);
    core.draw();
    const layout = L.indexLayout(L.buildLayout(core.state));
    const top = layout.get(L.cardKey(core.state.waste[core.state.waste.length - 1]));
    const hit = L.hitTest(layout, core.state, top.left + 20, top.top + 20);
    assert.ok(hit);
    assert.strictEqual(hit.pile, PILE_WASTE);
});

test('拖拽段：列顶为 1 张', () => {
    const core = new SolitaireCore();
    core.deal(2, 1);
    const run = L.draggedRun(core, 3, core.pileSize(3) - 1);
    assert.deepStrictEqual(run, { startIndex: core.pileSize(3) - 1, count: 1 });
});

test('拖拽段：从点中的那张开始拖', () => {
    const state = makeState({ tableau: [[card('S', 13), card('H', 12), card('S', 11)], [], [], [], [], [], []] });
    const core = new SolitaireCore(state);
    assert.deepStrictEqual(L.draggedRun(core, 0, 0), { startIndex: 0, count: 3 });
    assert.deepStrictEqual(L.draggedRun(core, 0, 1), { startIndex: 1, count: 2 });
    assert.deepStrictEqual(L.draggedRun(core, 0, 2), { startIndex: 2, count: 1 });
});

test('拖拽段：段中间断开的牌不可拖', () => {
    const state = makeState({ tableau: [[card('S', 13), card('S', 12), card('H', 11)], [], [], [], [], [], []] });
    const core = new SolitaireCore(state);
    assert.strictEqual(L.draggedRun(core, 0, 0), null);
    assert.deepStrictEqual(L.draggedRun(core, 0, 1), { startIndex: 1, count: 2 });
});

test('拖拽段：背面牌不可拖', () => {
    const state = makeState({ tableau: [[card('S', 13, false), card('H', 12)], [], [], [], [], [], []] });
    const core = new SolitaireCore(state);
    assert.strictEqual(L.draggedRun(core, 0, 0), null);
});

test('落点：A 拖到收牌区', () => {
    const state = makeState({ tableau: [[card('S', 1)], [], [], [], [], [], []] });
    const core = new SolitaireCore(state);
    const to = L.resolveDropTarget(core, 0, 1, colX(CFG.FOUNDATION_COLS[0]), CFG.TOP_ROW_Y);
    assert.strictEqual(to, PILE_FOUNDATION_BASE);
});

test('落点：非 A 拖到收牌区不合法', () => {
    const state = makeState({ tableau: [[card('S', 2)], [], [], [], [], [], []] });
    const core = new SolitaireCore(state);
    const to = L.resolveDropTarget(core, 0, 1, colX(CFG.FOUNDATION_COLS[0]), CFG.TOP_ROW_Y);
    assert.strictEqual(to, -1);
});

test('落点：异色降序落到最近列', () => {
    const state = makeState({
        tableau: [[card('H', 12)], [], [card('S', 13)], [], [], [], []],
    });
    const core = new SolitaireCore(state);
    const to = L.resolveDropTarget(core, 0, 1, colX(2), CFG.COLUMN_TOP_Y + 20);
    assert.strictEqual(to, 2);
});

test('落点：同列与列区上方都返回 -1', () => {
    const state = makeState({
        tableau: [[card('H', 12)], [], [card('S', 13)], [], [], [], []],
    });
    const core = new SolitaireCore(state);
    assert.strictEqual(L.resolveDropTarget(core, 0, 1, colX(0), CFG.COLUMN_TOP_Y + 20), -1);
    assert.strictEqual(L.resolveDropTarget(core, 0, 1, colX(2), 0), -1);
});

test('落点：列间空隙仍归最近的列', () => {
    const state = makeState({
        tableau: [[card('H', 12)], [], [card('S', 13)], [], [], [], []],
    });
    const core = new SolitaireCore(state);
    const gapX = CFG.colCenterX(2) + CFG.COL_STEP / 2 - 1;
    const to = L.resolveDropTarget(core, 0, 1, gapX - CFG.CARD_W / 2, CFG.COLUMN_TOP_Y + 20);
    assert.strictEqual(to, 2);
});

test('最近列判定', () => {
    assert.strictEqual(L.nearestColumn(CFG.colCenterX(0)), 0);
    assert.strictEqual(L.nearestColumn(CFG.colCenterX(6)), 6);
    assert.strictEqual(L.nearestColumn(CFG.colCenterX(3) + 10), 3);
});

test('布局里桌面牌的绘制顺序在其它堆之上', () => {
    const core = new SolitaireCore();
    core.deal(9, 1);
    const places = L.buildLayout(core.state);
    const firstTableau = places.findIndex(p => p.pile === 0);
    const lastTableau = places.length - 1;
    assert.ok(firstTableau > 0);
    assert.ok(places[lastTableau].pile >= 0 && places[lastTableau].pile < 7);
    const col6 = places.filter(p => p.pile === 6);
    for (let i = 1; i < col6.length; i++) assert.ok(col6[i].index > col6[i - 1].index);
});

// ==================== 汇总 ====================

console.log(`\n${'='.repeat(48)}`);
if (failures.length === 0) {
    console.log(`全部通过：${passed} 项`);
    process.exit(0);
} else {
    console.error(`失败 ${failures.length} 项 / 通过 ${passed} 项`);
    for (const f of failures) {
        console.error(`\n✗ ${f.name}`);
        console.error(f.err && f.err.stack ? f.err.stack : f.err);
    }
    process.exit(1);
}
