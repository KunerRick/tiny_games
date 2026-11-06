#!/usr/bin/env node
/**
 * 台球 —— 纯逻辑回归自检（不启动 Cocos）。
 *
 * 覆盖：摆球合法性、出杆力度映射、正碰动量转移、库边反弹、摩擦停机、
 *       永不越界 / 不重叠 / 高速不穿透、落袋计分与连击、母球落袋复位、
 *       清台与杆数判负、瞄准预测、确定性、关卡配置、存档往返与坏档回落。
 *
 * 用法：node tools/verify-pool-core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_pool', 'scripts');
const OUT = path.join(ROOT, 'temp', 'pool-core-test');

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
    path.join(SRC, 'PoolCore.ts'),
    path.join(SRC, 'PoolConfig.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const {
    PoolCore,
    rackPositions,
    ballsOverlap,
    mulberry32,
} = require(path.join(OUT, 'PoolCore.js'));

const {
    TABLE_W,
    TABLE_H,
    BALL_R,
    POOL_POCKETS,
    CUE_SPOT_X,
    CUE_SPOT_Y,
    RACK_APEX_X,
    RACK_APEX_Y,
    POOL_PHYS,
    POOL_LEVELS,
    POOL_LEVEL_COUNT,
    POOL_POT_SCORE,
    POOL_SPARE_STROKE_SCORE,
    getPoolLevel,
    rackRowsFor,
    createDefaultPoolSave,
    parsePoolSave,
} = require(path.join(OUT, 'PoolConfig.js'));

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

function assert(cond, message) {
    if (!cond) throw new Error(message || '断言失败');
}

function assertClose(a, b, eps, message) {
    if (!(Math.abs(a - b) <= eps)) throw new Error(`${message || '数值不接近'}: ${a} vs ${b}`);
}

const DT = 1 / 60;

/** 推进到所有球停下（或超时），返回耗时；sink 用于收集期间产生的全部事件 */
function runToRest(core, maxSeconds = 26, sink = null) {
    let t = 0;
    let guard = 0;
    while (core.state === 'rolling' && t < maxSeconds && guard++ < 20000) {
        core.step(DT);
        const evs = core.drainEvents();
        if (sink) sink.push(...evs);
        t += DT;
    }
    return t;
}

function onTableBalls(core) {
    return core.balls.filter((b) => b.onTable);
}

function checkInvariants(core, tag) {
    for (const b of onTableBalls(core)) {
        assert(Number.isFinite(b.x) && Number.isFinite(b.y), `${tag}: 坐标 NaN`);
        assert(Number.isFinite(b.vx) && Number.isFinite(b.vy), `${tag}: 速度 NaN`);
        assert(
            b.x >= b.r - 0.5 && b.x <= TABLE_W - b.r + 0.5,
            `${tag}: ${b.num} 号球跑出赛台 x=${b.x}`,
        );
        assert(
            b.y >= b.r - 0.5 && b.y <= TABLE_H - b.r + 0.5,
            `${tag}: ${b.num} 号球跑出赛台 y=${b.y}`,
        );
        const sp = Math.hypot(b.vx, b.vy);
        assert(sp <= POOL_PHYS.maxSpeed + 1, `${tag}: 速度超过上限 ${sp}`);
    }
    const balls = onTableBalls(core);
    for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
            const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
            // 允许求解器残留的极小重叠（位置修正是渐进式的）
            assert(
                d > balls[i].r + balls[j].r - 1.0,
                `${tag}: ${balls[i].num} 与 ${balls[j].num} 严重重叠 d=${d.toFixed(3)}`,
            );
        }
    }
}

// ==================== 摆球与关卡 ====================

console.log('\n[摆球与关卡]');

test('关卡配置合法：球数 = rows(rows+1)/2，行数可由球数反推', () => {
    assert(POOL_LEVEL_COUNT === 3, `应有 3 关，实际 ${POOL_LEVEL_COUNT}`);
    for (const lv of POOL_LEVELS) {
        assert(
            (lv.rows * (lv.rows + 1)) / 2 === lv.ballCount,
            `关卡 ${lv.id}：rows=${lv.rows} 与 ballCount=${lv.ballCount} 不匹配`,
        );
        assert(lv.strokeLimit > lv.ballCount, `关卡 ${lv.id}: 杆数上限应大于球数`);
        assert(rackRowsFor(lv.ballCount) === lv.rows, `关卡 ${lv.id}: rackRowsFor 反推不一致`);
        assert(rackPositions(lv.rows).length === lv.ballCount, `关卡 ${lv.id}: 摆球位数量错误`);
    }
});

test('开局：球数正确、编号连续、母球在开球点', () => {
    for (const lv of POOL_LEVELS) {
        const core = new PoolCore();
        core.startLevel(lv.id, 12345);
        assert(core.balls.length === lv.ballCount + 1, `关卡 ${lv.id}: 球数应为 ${lv.ballCount + 1}`);
        const nums = core.balls.map((b) => b.num).sort((a, b) => a - b);
        for (let i = 0; i <= lv.ballCount; i++) {
            assert(nums[i] === i, `关卡 ${lv.id}: 编号缺失 ${i}`);
        }
        const cue = core.cueBall;
        assert(cue && cue.num === 0, '缺少母球');
        assertClose(cue.x, CUE_SPOT_X, 1e-9, '母球 x');
        assertClose(cue.y, CUE_SPOT_Y, 1e-9, '母球 y');
        assert(core.pottedCount === 0 && core.strokes === 0 && core.score === 0, '开局计数应清零');
        assert(core.state === 'aiming', '开局应处于瞄准阶段');
    }
});

test('开局：所有球在台内、两两不重叠', () => {
    for (let seed = 1; seed <= 20; seed++) {
        for (const lv of POOL_LEVELS) {
            const core = new PoolCore();
            core.startLevel(lv.id, seed);
            checkInvariants(core, `seed ${seed} lv ${lv.id}`);
            const objBalls = core.balls.filter((b) => b.num > 0);
            for (let i = 0; i < objBalls.length; i++) {
                for (let j = i + 1; j < objBalls.length; j++) {
                    const d = Math.hypot(
                        objBalls[i].x - objBalls[j].x,
                        objBalls[i].y - objBalls[j].y,
                    );
                    assert(d > 2 * BALL_R, `摆球重叠: ${objBalls[i].num}/${objBalls[j].num} d=${d}`);
                }
            }
        }
    }
});

test('摆球三角：第一行 1 颗在最右、行数递增', () => {
    const spots = rackPositions(4);
    assert(spots.length === 10, '4 行应有 10 个位');
    const firstRow = spots.filter((p) => Math.abs(p.x - RACK_APEX_X) < 1e-9);
    assert(firstRow.length === 1, '第一行应只有 1 颗');
    assertClose(firstRow[0].y, RACK_APEX_Y, 1e-9, '顶点 y 应在中线');
    const maxX = Math.max(...spots.map((p) => p.x));
    assert(maxX > RACK_APEX_X, '三角应向右展开');
    assert(maxX < TABLE_W - BALL_R, '摆球超出赛台');
});

// ==================== 出杆与物理 ====================

console.log('\n[出杆与物理]');

test('力度映射：0 → 最小速度，1 → 最大速度', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);

    core.setPower(0);
    core.setAimAngle(0);
    core.shoot();
    let cue = core.cueBall;
    assertClose(Math.hypot(cue.vx, cue.vy), POOL_PHYS.minShotSpeed, 1e-6, 'power 0 速度');
    assert(core.strokes === 1, '出杆应消耗 1 杆');

    const core2 = new PoolCore();
    core2.startLevel(1, 7);
    core2.setPower(1);
    core2.setAimAngle(0);
    core2.shoot();
    cue = core2.cueBall;
    assertClose(Math.hypot(cue.vx, cue.vy), POOL_PHYS.maxShotSpeed, 1e-6, 'power 1 速度');
});

test('非瞄准阶段不能出杆；滚动中重复出杆被拒', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);
    assert(core.shoot(), '首次出杆应成功');
    const shots = core.strokes;
    assert(!core.shoot(), '滚动中出杆应被拒');
    assert(core.strokes === shots, '被拒时不应消耗杆数');
});

test('正碰：等质量球对撞后母球基本停住、目标球沿方向飞出', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);
    // 只留一颗目标球，排成一条直线
    for (const b of onTableBalls(core)) {
        if (b.num > 1) core.debugSinkBall(b.num);
    }
    core.debugPlaceBall(1, 220, TABLE_H / 2);
    core.debugPlaceCue(120, TABLE_H / 2);
    core.setAimAngle(0);
    core.setPower(1);
    core.shoot();

    const cue = core.cueBall;
    const target = core.balls.find((b) => b.num === 1);
    const cueSpeedBefore = Math.hypot(cue.vx, cue.vy);

    // 推进到刚发生碰撞（目标球速度 > 0）
    let guard = 0;
    while (target.vx === 0 && guard++ < 2000) {
        core.step(DT);
    }
    assert(target.vx > 0, '目标球应被撞向 +x');
    assert(Math.abs(target.vy) < 5, '正碰不应产生明显 y 向速度');
    const ratio = cue.vx / cueSpeedBefore;
    // 等质量 + e=0.95 → 母球保留 (1-e)/2 = 2.5%
    assert(ratio < 0.15, `母球残余速度应很小，实际保留 ${(ratio * 100).toFixed(1)}%`);
    assert(target.vx > cueSpeedBefore * 0.8, '目标球应带走绝大部分速度');

    runToRest(core);
    checkInvariants(core, '正碰后');
});

test('库边反弹：撞右库后 vx 反向且变慢', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);
    core.debugPlaceCue(TABLE_W - 80, TABLE_H / 2);
    core.setAimAngle(0);
    core.setPower(0.8);
    core.shoot();
    const cue = core.cueBall;
    let guard = 0;
    let bounced = false;
    while (guard++ < 3000 && core.state === 'rolling') {
        core.step(DT);
        if (cue.vx < -1) {
            bounced = true;
            break;
        }
    }
    assert(bounced, '母球撞库后应反向');
    assert(cue.x <= TABLE_W - BALL_R + 0.01, '撞库后仍应留在台内');
});

test('摩擦一定会让所有球停下（每关随机 30 杆）', () => {
    for (const lv of POOL_LEVELS) {
        const rng = mulberry32(lv.id * 977 + 3);
        for (let shot = 0; shot < 30; shot++) {
            const core = new PoolCore();
            core.startLevel(lv.id, 1000 + shot);
            core.setAimAngle(rng() * Math.PI * 2);
            core.setPower(rng());
            core.shoot();
            const t = runToRest(core);
            assert(core.state !== 'rolling', `关卡 ${lv.id} 第 ${shot} 杆没有停下（${t.toFixed(2)}s）`);
            assert(t < 20, `关卡 ${lv.id} 第 ${shot} 杆停下太慢：${t.toFixed(2)}s`);
        }
    }
});

// ==================== 穿透与长跑 ====================

console.log('\n[穿透与长跑]');

test('高速正面对撞 1,000 次不穿透、不互换位置', () => {
    const rng = mulberry32(4242);
    for (let i = 0; i < 1000; i++) {
        const core = new PoolCore();
        core.startLevel(1, i + 1);
        for (const b of onTableBalls(core)) {
            if (b.num > 2) core.debugSinkBall(b.num);
        }
        const y = BALL_R + 4 + rng() * (TABLE_H - 2 * BALL_R - 8);
        const speed = 600 + rng() * (POOL_PHYS.maxSpeed - 600);
        core.debugPlaceCue(60, y);
        core.debugPlaceBall(1, 320, y);
        core.debugPlaceBall(2, 520, y);
        core.debugKick(0, speed, 0);

        let prevX = core.cueBall.x;
        let guard = 0;
        while (core.state === 'rolling' && guard++ < 4000) {
            core.step(DT);
            const cue = core.cueBall;
            const b1 = core.balls.find((b) => b.num === 1);
            const b2 = core.balls.find((b) => b.num === 2);
            if (b1.onTable && b2.onTable) {
                const d = Math.hypot(b1.x - b2.x, b1.y - b2.y);
                assert(d > 2 * BALL_R - 1.5, `第 ${i} 次: 1/2 号球穿透 d=${d.toFixed(3)}`);
            }
            if (cue && cue.onTable && b1.onTable) {
                const d = Math.hypot(cue.x - b1.x, cue.y - b1.y);
                assert(d > 2 * BALL_R - 1.5, `第 ${i} 次: 母球穿透 1 号球 d=${d.toFixed(3)}`);
            }
            prevX = cue ? cue.x : prevX;
        }
        assert(guard < 4000, `第 ${i} 次: 循环未结束`);
        // 撞完后 2 号球必须在 1 号球右侧（没有被穿过）
        const b1 = core.balls.find((b) => b.num === 1);
        const b2 = core.balls.find((b) => b.num === 2);
        assert(b2.x > b1.x, `第 ${i} 次: 2 号球跑到了 1 号球左边（穿透）`);
    }
});

test('1,000 杆随机击球：坐标有限、速度受限、永不越界、无严重重叠', () => {
    let shots = 0;
    for (let run = 0; run < 1000; run++) {
        const rng = mulberry32(run * 7919 + 13);
        const lv = POOL_LEVELS[run % POOL_LEVEL_COUNT];
        const core = new PoolCore();
        core.startLevel(lv.id, run + 1);
        core.setAimAngle(rng() * Math.PI * 2);
        core.setPower(rng());
        core.shoot();
        shots++;

        let guard = 0;
        while (core.state === 'rolling' && guard++ < 3000) {
            core.step(DT);
            core.drainEvents();
            if (guard % 7 === 0) checkInvariants(core, `run ${run}`);
        }
        assert(core.state !== 'rolling', `run ${run}: 未停下`);
        checkInvariants(core, `run ${run} 结束`);
    }
    assert(shots === 1000, `应打满 1000 杆，实际 ${shots}`);
});

// ==================== 落袋与规则 ====================

console.log('\n[落袋与规则]');

test('球心进入袋口捕获半径即落袋并加分', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);
    const target = core.balls.find((b) => b.num > 0);
    const pocket = POOL_POCKETS[0];
    // 直接把球放到袋心附近，用一次极短的推进触发落袋
    core.debugPlaceBall(target.num, pocket.x + 2, pocket.y + 2);
    core.debugPlaceCue(TABLE_W / 2, TABLE_H / 2);
    core.setPower(0.1);
    core.setAimAngle(Math.PI / 2);
    core.shoot();
    runToRest(core);

    assert(!target.onTable, '球应已落袋');
    assert(core.pottedCount === 1, `应记 1 颗进球，实际 ${core.pottedCount}`);
    assert(core.score >= POOL_POT_SCORE, `分数应 ≥ ${POOL_POT_SCORE}，实际 ${core.score}`);
});

test('一杆进多球有连击加成', () => {
    const core = new PoolCore();
    core.startLevel(2, 7);
    const evs = [];
    core.debugSinkBall(1);
    core.debugSinkBall(2);
    core.debugSinkBall(3);
    evs.push(...core.drainEvents());
    const pots = evs.filter((e) => e.type === 'pot');
    assert(pots.length === 3, `应有 3 条进球事件，实际 ${pots.length}`);
    assert(pots[0].gain === POOL_POT_SCORE, '第一颗应按基础分');
    assert(pots[1].gain > pots[0].gain, '第二颗应有连击加成');
    assert(pots[2].gain > pots[1].gain, '第三颗加成应更高');
    assert(core.pottedCount === 3, '累计进球应为 3');
});

test('母球落袋：发出 scratch 事件，并在下一杆前复位到台面', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);
    core.debugPlaceCue(TABLE_W / 2, TABLE_H / 2);
    core.debugKick(0, 0, 0);
    // 直接把母球推进袋口
    core.debugPlaceCue(2, 2);
    core.debugKick(0, 30, 30);
    let gotScratch = false;
    let guard = 0;
    while (core.state === 'rolling' && guard++ < 3000) {
        for (const e of core.drainEvents()) if (e.type === 'scratch') gotScratch = true;
        core.step(DT);
    }
    for (const e of core.drainEvents()) if (e.type === 'scratch') gotScratch = true;
    assert(gotScratch, '应发出 scratch 事件');
    const cue = core.cueBall;
    assert(cue.onTable, '下一杆前母球应回到台面');
    assert(
        cue.x >= BALL_R && cue.x <= TABLE_W - BALL_R && cue.y >= BALL_R && cue.y <= TABLE_H - BALL_R,
        `母球复位点越界 ${cue.x},${cue.y}`,
    );
    assert(core.pottedCount === 0, '母球落袋不应计入目标球进球数');
});

test('清台判胜并结算剩余杆数奖励', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);
    const limit = core.strokeLimit;
    const total = core.totalBalls;
    // 打一杆空杆进 rolling，再手动把球全部灌进
    core.setAimAngle(Math.PI);
    core.setPower(0.2);
    core.shoot();
    for (let n = 1; n <= total; n++) core.debugSinkBall(n);
    core.debugSettle();
    assert(core.state === 'won', `应判胜，实际 ${core.state}`);
    const evs = core.drainEvents();
    const won = evs.find((e) => e.type === 'won');
    assert(won, '应发出 won 事件');
    assert(won.strokesLeft === limit - 1, `剩余杆数应为 ${limit - 1}，实际 ${won.strokesLeft}`);
    assert(
        won.score >= total * POOL_POT_SCORE + won.strokesLeft * POOL_SPARE_STROKE_SCORE,
        `胜利分数应含清台奖励，实际 ${won.score}`,
    );
});

test('杆数用完未清台判负', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);
    const limit = core.strokeLimit;
    const evs = [];
    for (let i = 0; i < limit; i++) {
        core.setAimAngle(Math.PI); // 往左打，远离球堆
        core.setPower(0.05);
        core.shoot();
        runToRest(core, 26, evs);
        if (core.state !== 'aiming') break;
    }
    assert(core.state === 'lost', `应判负，实际 ${core.state}`);
    assert(core.pottedCount === 0, '本局不应有进球');
    assert(evs.some((e) => e.type === 'lost'), '应发出 lost 事件');
});

test('结束后不能再出杆', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);
    const limit = core.strokeLimit;
    for (let i = 0; i < limit; i++) {
        core.setAimAngle(Math.PI);
        core.setPower(0.05);
        core.shoot();
        runToRest(core);
        if (core.state !== 'aiming') break;
    }
    assert(core.state === 'lost', '前置：应已判负');
    assert(!core.shoot(), '判负后出杆应被拒');
});

// ==================== 瞄准预测 ====================

console.log('\n[瞄准预测]');

test('正对目标球时预测命中该球，幽灵球在 2r 处', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);
    for (const b of onTableBalls(core)) if (b.num > 1) core.debugSinkBall(b.num);
    core.debugPlaceCue(200, TABLE_H / 2);
    core.debugPlaceBall(1, 400, TABLE_H / 2);
    core.setAimAngle(0);
    const hit = core.predictAim();
    assert(hit.kind === 'ball', `应预测命中球，实际 ${hit.kind}`);
    assert(hit.ballNum === 1, `应命中 1 号球，实际 ${hit.ballNum}`);
    assertClose(hit.dist, 200 - 2 * BALL_R, 0.01, '母球球心应停在 2r 处');
    assertClose(hit.ghostX, 400 - 2 * BALL_R, 0.01, '幽灵球 x');
    assertClose(hit.ghostY, TABLE_H / 2, 0.01, '幽灵球 y');
});

test('前方无球时预测撞库，落点在库边', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);
    for (const b of onTableBalls(core)) if (b.num > 0) core.debugSinkBall(b.num);
    core.debugPlaceCue(200, TABLE_H / 2);
    core.setAimAngle(0);
    const hit = core.predictAim();
    assert(hit.kind === 'cushion', `应预测撞库，实际 ${hit.kind}`);
    assert(hit.ballNum === -1, '撞库不应有目标球号');
    assertClose(hit.ghostX, TABLE_W - BALL_R, 0.01, '撞库落点 x');
});

test('偏离目标球时不误报命中', () => {
    const core = new PoolCore();
    core.startLevel(1, 7);
    for (const b of onTableBalls(core)) if (b.num > 1) core.debugSinkBall(b.num);
    core.debugPlaceCue(200, TABLE_H / 2);
    core.debugPlaceBall(1, 400, TABLE_H / 2 + 200);
    core.setAimAngle(0);
    const hit = core.predictAim();
    assert(hit.kind === 'cushion', `应撞库，实际 ${hit.kind}`);
    assert(hit.ballNum === -1, '不应命中 1 号球');
});

// ==================== 确定性 / 存档 ====================

console.log('\n[确定性 / 存档]');

test('同 seed 同输入 → 同结果', () => {
    const snap = (seed) => {
        const core = new PoolCore();
        core.startLevel(2, seed);
        core.setAimAngle(0.37);
        core.setPower(0.83);
        core.shoot();
        runToRest(core);
        return core.balls.map((b) => [b.num, b.onTable, b.x, b.y]);
    };
    const a = snap(2024);
    const b = snap(2024);
    assert(JSON.stringify(a) === JSON.stringify(b), '同 seed 结果不一致');
});

test('不同 seed 的摆球顺序不同（编号位置有变化）', () => {
    const order = (seed) => {
        const core = new PoolCore();
        core.startLevel(3, seed);
        return core.balls.filter((b) => b.num > 0).map((b) => b.num).join(',');
    };
    assert(order(1) !== order(2), '不同 seed 的排布应不同');
});

test('存档往返一致，坏档回落为默认值', () => {
    const save = createDefaultPoolSave();
    save.bestScore[0] = 1234;
    save.bestScore[2] = 5678;
    save.cleared[1] = true;
    save.lastLevel = 3;
    save.totalPots = 42;
    const round = parsePoolSave(JSON.parse(JSON.stringify(save)));
    assert(round.bestScore[0] === 1234 && round.bestScore[2] === 5678, '最佳分未还原');
    assert(round.cleared[1] === true, '通关标记未还原');
    assert(round.lastLevel === 3 && round.totalPots === 42, '上次关卡 / 累计进球未还原');

    for (const bad of [null, 0, 'x', [], { bestScore: 'oops', lastLevel: 99, totalPots: -5 }]) {
        const out = parsePoolSave(bad);
        assert(out.bestScore.length === POOL_LEVEL_COUNT, '坏档 bestScore 应回落到默认长度');
        assert(out.cleared.length === POOL_LEVEL_COUNT, '坏档 cleared 应回落到默认长度');
        assert(out.lastLevel >= 1 && out.lastLevel <= POOL_LEVEL_COUNT, '坏档 lastLevel 应合法');
        assert(out.totalPots === 0, '坏档 totalPots 应为 0');
        for (const s of out.bestScore) assert(Number.isFinite(s) && s >= 0, '坏档分数应为非负有限数');
    }
});

test('getPoolLevel 越界回落第一关', () => {
    assert(getPoolLevel(1).id === 1, '正常取关失败');
    assert(getPoolLevel(99).id === 1, '越界应回落第一关');
    assert(getPoolLevel(-3).id === 1, '负数应回落第一关');
});

// ==================== 结果 ====================

console.log(`\n${passed} 项通过，${failures.length} 项失败`);
if (failures.length > 0) {
    for (const f of failures) {
        console.error(`\n失败：${f.name}`);
        console.error(f.err && f.err.stack ? f.err.stack : f.err);
    }
    process.exit(1);
}
console.log('POOL_CORE_OK');
