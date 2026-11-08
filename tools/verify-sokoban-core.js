#!/usr/bin/env node
/**
 * 推箱子 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 覆盖：ASCII 解析与错误输入、走位 / 推箱 / 卡住判定、撤销精确还原、
 *       通关判定、快照往返与坏档回落、BFS 逐关可解 + par 与最优解一致、
 *       解法回放真能通关、长跑不变量。
 *
 * 用法：node tools/verify-sokoban-core.js
 *       node tools/verify-sokoban-core.js --pars   # 只打印可直接粘贴的 par 数组
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GAMES = path.join(ROOT, 'assets', 'games');
const OUT = path.join(ROOT, 'temp', 'sokoban-core-test');

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
    path.join(GAMES, 'game_sokoban', 'scripts', 'SokobanCore.ts'),
    '--outDir', OUT,
    '--rootDir', GAMES,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const C = require(path.join(OUT, 'game_sokoban', 'scripts', 'SokobanCore.js'));

const {
    SOKOBAN_DIR_VEC,
    SOKOBAN_LEVELS,
    SOKOBAN_PARS,
    SokobanBoard,
    solve,
    optimalMoves,
    levelById,
    starsFor,
    boxCountOf,
} = C;

const ONLY_PARS = process.argv.includes('--pars');

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

/** 盘面 → ASCII（便于断言与报错） */
function dump(board) {
    const lines = [];
    for (let y = 0; y < board.height; y++) {
        let line = '';
        for (let x = 0; x < board.width; x++) {
            const i = board.idx(x, y);
            if (board.playerX === x && board.playerY === y) {
                line += board.goals[i] ? '+' : '@';
            } else if (board.boxes[i]) {
                line += board.goals[i] ? '*' : '$';
            } else if (board.walls[i]) {
                line += '#';
            } else {
                line += board.goals[i] ? '.' : ' ';
            }
        }
        lines.push(line);
    }
    return lines.join('\n');
}

// 先算全部最优解（par 打印与后续断言都用它）
const optimal = [];
const solveTimes = [];
for (const lv of SOKOBAN_LEVELS) {
    const board = SokobanBoard.fromLevel(lv);
    const t0 = Date.now();
    const pathDirs = solve(board);
    solveTimes.push(Date.now() - t0);
    optimal.push(pathDirs ? pathDirs.length : -1);
}

if (ONLY_PARS) {
    console.log('\nSOKOBAN_PARS = [');
    for (let i = 0; i < optimal.length; i += 10) {
        console.log('    ' + optimal.slice(i, i + 10).join(', ') + ',');
    }
    console.log('];');
    SOKOBAN_LEVELS.forEach((lv, i) => {
        console.log(`  第 ${lv.id} 关 ${lv.name}: 最优 ${optimal[i]} 步，BFS ${solveTimes[i]} ms`);
    });
    process.exit(0);
}

// ==================== 方向常量 ====================

console.log('\n[方向常量]');

test('四个方向单位正交，正反对称', () => {
    assert.strictEqual(SOKOBAN_DIR_VEC.length, 4);
    for (const v of SOKOBAN_DIR_VEC) {
        assert.strictEqual(Math.abs(v[0]) + Math.abs(v[1]), 1);
    }
    assert.deepStrictEqual(SOKOBAN_DIR_VEC[0], [0, -1]);
    assert.deepStrictEqual(SOKOBAN_DIR_VEC[1], [1, 0]);
    assert.deepStrictEqual(SOKOBAN_DIR_VEC[2], [0, 1]);
    assert.deepStrictEqual(SOKOBAN_DIR_VEC[3], [-1, 0]);
});

// ==================== 解析 ====================

console.log('\n[解析]');

test('基础字符：墙 / 地板 / 目标 / 箱子 / 玩家', () => {
    const b = SokobanBoard.fromRows(['#####', '#@$.#', '#####']);
    assert.strictEqual(b.width, 5);
    assert.strictEqual(b.height, 3);
    assert.strictEqual(b.playerX, 1);
    assert.strictEqual(b.playerY, 1);
    assert.ok(b.hasBox(2, 1));
    assert.ok(b.isGoal(3, 1));
    assert.strictEqual(b.boxCount(), 1);
    assert.strictEqual(b.goalCount(), 1);
    assert.ok(!b.isSolved());
});

test('`*` 同时算箱子与目标，`+` 同时算玩家与目标', () => {
    const b = SokobanBoard.fromRows(['#####', '#+*$#', '#####']);
    assert.ok(b.isGoal(1, 1) && b.playerX === 1);
    assert.ok(b.isGoal(2, 1) && b.hasBox(2, 1));
    assert.strictEqual(b.goalCount(), 2);
    assert.strictEqual(b.boxCount(), 2);
});

test('行宽不一致抛错', () => {
    assert.throws(() => SokobanBoard.fromRows(['#####', '#@$.#', '####']), /宽度/);
});

test('非法字符抛错', () => {
    assert.throws(() => SokobanBoard.fromRows(['#####', '#@X.#', '#####']), /非法字符/);
});

test('玩家数量不是 1 抛错', () => {
    assert.throws(() => SokobanBoard.fromRows(['#####', '# $.#', '#####']), /玩家数/);
    assert.throws(() => SokobanBoard.fromRows(['#####', '#@@.#', '#####']), /玩家数/);
});

test('箱子数与目标数不等抛错', () => {
    assert.throws(() => SokobanBoard.fromRows(['#####', '#@$.#', '#..#.']), /箱子/);
});

test('空关卡抛错', () => {
    assert.throws(() => SokobanBoard.fromRows([]), /为空/);
    assert.throws(() => SokobanBoard.fromRows(['']), /宽度为 0/);
});

// ==================== 走位与推箱 ====================

console.log('\n[走位与推箱]');

const WALK_LEVEL = ['#######', '# @ . #', '# $   #', '#######'];

test('走空路：玩家移动、moves+1、pushes 不变', () => {
    const b = SokobanBoard.fromRows(WALK_LEVEL);
    const r = b.move(3); // 左
    assert.strictEqual(r.moved, true);
    assert.strictEqual(r.pushed, false);
    assert.strictEqual(b.playerX, 1);
    assert.strictEqual(b.moves, 1);
    assert.strictEqual(b.pushes, 0);
    assert.deepStrictEqual(r.boxFrom, null);
});

test('推箱子：箱子与玩家同时前进，moves/pushes 都 +1', () => {
    const b = SokobanBoard.fromRows(['#####', '#@$.#', '#####']);
    const r = b.move(1);
    assert.strictEqual(b.playerX, 2);
    assert.ok(b.hasBox(3, 1));
    assert.ok(!b.hasBox(2, 1));
    assert.strictEqual(b.moves, 1);
    assert.strictEqual(b.pushes, 1);
    assert.deepStrictEqual(r.boxFrom, { x: 2, y: 1 });
    assert.deepStrictEqual(r.boxTo, { x: 3, y: 1 });
    assert.ok(b.isSolved());
});

test('撞墙：moved=false 且盘面完全不变', () => {
    const b = SokobanBoard.fromRows(['#####', '#@$.#', '#####']);
    const before = dump(b);
    const r = b.move(0); // 上
    assert.strictEqual(r.moved, false);
    assert.strictEqual(b.moves, 0);
    assert.strictEqual(dump(b), before);
});

test('箱子后面是墙：推不动，玩家也不动', () => {
    const b = SokobanBoard.fromRows(['#####', '#@$##', '#.# #']);
    const before = dump(b);
    const r = b.move(1);
    assert.strictEqual(r.moved, false);
    assert.strictEqual(b.moves, 0);
    assert.strictEqual(b.pushes, 0);
    assert.strictEqual(dump(b), before);
});

test('箱子后面是另一个箱子：推不动', () => {
    const b = SokobanBoard.fromRows(['######', '#@$$##', '#..###']);
    const before = dump(b);
    assert.strictEqual(b.move(1).moved, false);
    assert.strictEqual(dump(b), before);
});

test('边界外视为墙（没有外围 # 也不越界）', () => {
    const b = SokobanBoard.fromRows(['@$.']);
    assert.strictEqual(b.move(0).moved, false);
    assert.strictEqual(b.move(3).moved, false);
    assert.strictEqual(b.move(1).moved, true);
    assert.strictEqual(b.move(1).moved, false); // 箱子顶到右边界
});

test('isSolved：差一个不算，全中才算', () => {
    const b = SokobanBoard.fromRows(['#######', '#@$ . #', '# $ . #', '#######']);
    assert.strictEqual(b.isSolved(), false);
    b.move(1);
    b.move(1); // 上排箱子推到 (4,1) 目标
    assert.strictEqual(b.isSolved(), false); // 下排还没到
    b.move(2); // 下到 (3,2)
    b.move(0); // 上回 (3,1)
    b.move(3); // (2,1)
    b.move(3); // (1,1)
    b.move(2); // (1,2)
    b.move(1); // 推 (3,2)
    assert.strictEqual(b.isSolved(), false);
    b.move(1); // 推 (4,2) 目标
    assert.strictEqual(b.isSolved(), true);
    assert.strictEqual(b.moves, 9);
});

test('开局箱子全在目标上 → 直接算通关（BFS 解为空）', () => {
    const b = SokobanBoard.fromRows(['#####', '#@* #', '#####']);
    assert.strictEqual(b.isSolved(), true);
    assert.deepStrictEqual(solve(b), []);
});

// ==================== 撤销 ====================

console.log('\n[撤销]');

test('撤销走空路：玩家回位、moves 归零', () => {
    const b = SokobanBoard.fromRows(WALK_LEVEL);
    const before = dump(b);
    b.move(3);
    assert.strictEqual(b.moves, 1);
    assert.ok(b.undo());
    assert.strictEqual(b.moves, 0);
    assert.strictEqual(dump(b), before);
});

test('撤销推箱：箱子与玩家一起退回，pushes 递减', () => {
    const b = SokobanBoard.fromRows(['#######', '#@$ . #', '# $ . #', '#######']);
    const before = dump(b);
    b.move(1);
    b.move(1);
    assert.strictEqual(b.moves, 2);
    assert.strictEqual(b.pushes, 2);
    assert.ok(b.undo());
    assert.ok(b.undo());
    assert.strictEqual(b.moves, 0);
    assert.strictEqual(b.pushes, 0);
    assert.strictEqual(dump(b), before);
});

test('空历史 undo 返回 false 且不改变状态', () => {
    const b = SokobanBoard.fromRows(['#####', '#@$.#', '#####']);
    assert.strictEqual(b.canUndo(), false);
    assert.strictEqual(b.undo(), false);
    assert.strictEqual(b.moves, 0);
});

test('随机 500 步后全部撤销 → 与原局逐格一致', () => {
    const b = SokobanBoard.fromLevel(SOKOBAN_LEVELS[18]);
    const before = dump(b);
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let steps = 0;
    for (let i = 0; i < 500; i++) {
        if (b.move(Math.floor(rand() * 4))) steps++;
    }
    assert.ok(steps > 50, `只走出 ${steps} 步，样本太少`);
    while (b.undo()) { /* 撤到底 */ }
    assert.strictEqual(b.moves, 0);
    assert.strictEqual(b.pushes, 0);
    assert.strictEqual(dump(b), before);
});

test('reset 回到本关初始局面', () => {
    const lv = SOKOBAN_LEVELS[5];
    const b = SokobanBoard.fromLevel(lv);
    const before = dump(b);
    for (let i = 0; i < 20; i++) b.move(i % 4);
    b.reset();
    assert.strictEqual(b.moves, 0);
    assert.strictEqual(b.pushes, 0);
    assert.strictEqual(b.canUndo(), false);
    assert.strictEqual(dump(b), before);
});

test('clone 独立：改副本不影响原盘', () => {
    const b = SokobanBoard.fromLevel(SOKOBAN_LEVELS[9]);
    const before = dump(b);
    const c = b.clone();
    c.move(0);
    c.move(1);
    assert.strictEqual(dump(b), before);
});

// ==================== 快照 ====================

console.log('\n[快照]');

test('快照往返完全一致（含 walls / goals / 步数）', () => {
    const b = SokobanBoard.fromLevel(SOKOBAN_LEVELS[11]);
    b.move(0);
    const snap = b.snapshot();
    const back = SokobanBoard.fromSnapshot(snap);
    assert.strictEqual(dump(back), dump(b));
    assert.strictEqual(back.moves, b.moves);
    assert.strictEqual(back.pushes, b.pushes);
    assert.deepStrictEqual(Array.from(back.walls), Array.from(b.walls));
});

test('快照可 JSON 往返', () => {
    const b = SokobanBoard.fromLevel(SOKOBAN_LEVELS[2]);
    const back = SokobanBoard.fromSnapshot(JSON.parse(JSON.stringify(b.snapshot())));
    assert.strictEqual(dump(back), dump(b));
});

test('坏档/空档回落到空盘不抛异常', () => {
    const a = SokobanBoard.fromSnapshot(null);
    assert.strictEqual(a.width, 1);
    assert.strictEqual(a.height, 1);
    assert.strictEqual(a.moves, 0);
    const b = SokobanBoard.fromSnapshot({ v: 1, width: 3, height: 2, walls: [0, 1], boxes: [1], goals: [0, 1], playerX: 99, playerY: -5 });
    assert.strictEqual(b.width, 3);
    assert.strictEqual(b.playerX, 2);
    assert.strictEqual(b.playerY, 0);
    assert.ok(b.hasBox(0, 0));
    assert.ok(!b.hasBox(1, 0));
});

test('快照恢复后 reset 回到恢复时的局面', () => {
    const b = SokobanBoard.fromLevel(SOKOBAN_LEVELS[0]);
    b.move(1);
    const back = SokobanBoard.fromSnapshot(b.snapshot());
    const snapshotDump = dump(back);
    back.move(1);
    back.reset();
    assert.strictEqual(dump(back), snapshotDump);
});

// ==================== 关卡 ====================

console.log('\n[关卡]');

test('共 20 关，id 连续', () => {
    assert.strictEqual(SOKOBAN_LEVELS.length, 20);
    SOKOBAN_LEVELS.forEach((lv, i) => assert.strictEqual(lv.id, i + 1));
});

test('par 数组长度与关卡数一致且全部已填', () => {
    assert.strictEqual(SOKOBAN_PARS.length, SOKOBAN_LEVELS.length);
    SOKOBAN_PARS.forEach((p, i) => assert.ok(p > 0, `第 ${i + 1} 关 par 未填`));
});

test('每关都能解析，箱子数 = 目标数且 ≤ 3', () => {
    for (const lv of SOKOBAN_LEVELS) {
        const b = SokobanBoard.fromLevel(lv);
        assert.strictEqual(b.boxCount(), b.goalCount(), `第 ${lv.id} 关箱子与目标不等`);
        assert.ok(b.boxCount() <= 3, `第 ${lv.id} 关有 ${b.boxCount()} 个箱子`);
        assert.strictEqual(boxCountOf(lv), b.boxCount());
    }
});

test('每关外围一圈全封闭（最外行的实心段必须是墙）', () => {
    for (const lv of SOKOBAN_LEVELS) {
        const b = SokobanBoard.fromLevel(lv);
        for (let x = 0; x < b.width; x++) {
            assert.ok(b.isWall(x, 0), `第 ${lv.id} 关顶边 (${x},0) 不是墙`);
            assert.ok(b.isWall(x, b.height - 1), `第 ${lv.id} 关底边 (${x},h-1) 不是墙`);
        }
        for (let y = 0; y < b.height; y++) {
            assert.ok(b.isWall(0, y), `第 ${lv.id} 关左边 (0,${y}) 不是墙`);
            assert.ok(b.isWall(b.width - 1, y), `第 ${lv.id} 关右边 (w-1,${y}) 不是墙`);
        }
    }
});

test('开局没有箱子站在目标点上（否则白送），且都不是死局起点', () => {
    for (const lv of SOKOBAN_LEVELS) {
        const b = SokobanBoard.fromLevel(lv);
        assert.strictEqual(b.boxesOnGoals(), 0, `第 ${lv.id} 关开局就有箱子在目标上`);
        assert.strictEqual(b.isSolved(), false);
    }
});

test('levelById 命中与回落', () => {
    assert.strictEqual(levelById(7).id, 7);
    assert.strictEqual(levelById(999).id, 1);
});

test('starsFor 边界：par 三星、1.5 倍内两星、其余一星', () => {
    assert.strictEqual(starsFor(10, 10), 3);
    assert.strictEqual(starsFor(11, 10), 2);
    assert.strictEqual(starsFor(15, 10), 2);
    assert.strictEqual(starsFor(16, 10), 1);
    assert.strictEqual(starsFor(10, 0), 0);
    assert.strictEqual(starsFor(0, 10), 0);
});

// ==================== BFS 可解与 par ====================

console.log('\n[BFS 可解与 par]');

test('20 关全部可解（BFS 全部在预算内找到解）', () => {
    SOKOBAN_LEVELS.forEach((lv, i) => {
        assert.ok(optimal[i] > 0, `第 ${lv.id} 关无解或超限（${optimal[i]}，${solveTimes[i]} ms）`);
    });
});

test('par 与 BFS 最优步数逐关一致', () => {
    SOKOBAN_LEVELS.forEach((lv, i) => {
        assert.strictEqual(lv.par, optimal[i], `第 ${lv.id} 关 par=${lv.par}，实际最优 ${optimal[i]}`);
    });
});

test('解法回放真的能通关（20 关全跑一遍）', () => {
    for (const lv of SOKOBAN_LEVELS) {
        const board = SokobanBoard.fromLevel(lv);
        const dirs = solve(board);
        assert.ok(dirs, `第 ${lv.id} 关无解`);
        for (const d of dirs) {
            assert.strictEqual(board.move(d).moved, true, `第 ${lv.id} 关解路径走不通`);
        }
        assert.strictEqual(board.isSolved(), true, `第 ${lv.id} 关解完仍未通关`);
        assert.strictEqual(board.moves, dirs.length);
    }
});

test('解法是最短的：任意一步提前结束都不行（长度 - 1 时未通关）', () => {
    for (const lv of SOKOBAN_LEVELS) {
        const board = SokobanBoard.fromLevel(lv);
        const dirs = solve(board);
        for (let i = 0; i < dirs.length - 1; i++) board.move(dirs[i]);
        assert.strictEqual(board.isSolved(), false, `第 ${lv.id} 关少走一步也通关了`);
    }
});

// ==================== 长跑 ====================

console.log('\n[长跑]');

test('20 关 × 每关随机 300 步：箱子不出界、不重叠、不穿墙', () => {
    for (const lv of SOKOBAN_LEVELS) {
        const b = SokobanBoard.fromLevel(lv);
        let seed = lv.id * 7919 + 13;
        const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        for (let step = 0; step < 300; step++) {
            b.move(Math.floor(rand() * 4));
            const dumpLines = dump(b).split('\n');
            assert.strictEqual(dumpLines.length, b.height);
            let boxTiles = 0;
            for (const line of dumpLines) {
                for (const ch of line) {
                    if (ch === '$' || ch === '*') boxTiles++;
                }
            }
            assert.strictEqual(boxTiles, b.boxCount(), `第 ${lv.id} 关第 ${step} 步箱子数变了`);
            for (let i = 0; i < b.boxes.length; i++) {
                if (!b.boxes[i]) continue;
                assert.ok(!b.walls[i], `第 ${lv.id} 关箱子进了墙 ${i}`);
                const x = i % b.width;
                const y = (i - x) / b.width;
                assert.ok(b.inBounds(x, y));
            }
            assert.ok(!b.hasBox(b.playerX, b.playerY), `第 ${lv.id} 关玩家与箱子重叠`);
            assert.ok(!b.isWall(b.playerX, b.playerY), `第 ${lv.id} 关玩家进了墙`);
        }
    }
});

test('每关随机走 N 步再全撤销，状态总能还原（20 关各 3 轮）', () => {
    for (const lv of SOKOBAN_LEVELS) {
        for (let round = 0; round < 3; round++) {
            const b = SokobanBoard.fromLevel(lv);
            const before = dump(b);
            let seed = lv.id * 104729 + round * 31 + 7;
            const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
            for (let i = 0; i < 120; i++) b.move(Math.floor(rand() * 4));
            while (b.undo()) { /* 撤到底 */ }
            assert.strictEqual(dump(b), before, `第 ${lv.id} 关第 ${round} 轮撤销没还原`);
        }
    }
});

test('BFS 状态预算足够：每关耗时不失控（< 8s）', () => {
    SOKOBAN_LEVELS.forEach((lv, i) => {
        assert.ok(solveTimes[i] < 8000, `第 ${lv.id} 关 BFS 用了 ${solveTimes[i]} ms`);
    });
});

// ==================== 汇总 ====================

console.log('');
if (failures.length > 0) {
    console.error(`${failures.length} 项失败，${passed} 项通过`);
    for (const f of failures) console.error(` - ${f.name}: ${f.err.message}`);
    process.exit(1);
}
const total = solveTimes.reduce((a, b) => a + b, 0);
console.log(`${passed} 项通过，0 项失败（BFS 总计 ${total} ms，最慢 ${Math.max(...solveTimes)} ms）`);
console.log('SOKOBAN_CORE_OK');
