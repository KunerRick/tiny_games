#!/usr/bin/env node
/**
 * 小店日记 —— 纯规则回归自检（不启动 Cocos）。
 *
 * 覆盖：设施费用表、点击 / 自动 / 离线公式、8 小时离线上限、时间倒退与大幅前进、
 *       金币封顶、30 天离线模拟、10 万次操作无 NaN / Infinity、
 *       大数格式化、存档往返与坏档回落。
 *
 * 用法：node tools/verify-idle-core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_idle', 'scripts');
const OUT = path.join(ROOT, 'temp', 'idle-core-test');

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
    path.join(SRC, 'IdleCore.ts'),
    '--outDir', OUT,
    '--rootDir', SRC,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
], { stdio: 'inherit' });

const {
    IdleCore,
    IDLE_FACILITIES,
    IDLE_FACILITY_IDS,
    IDLE_MAX_LEVEL,
    IDLE_MAX_COINS,
    IDLE_OFFLINE_CAP_SEC,
    IDLE_OFFLINE_BASE_RATE,
    IDLE_OFFLINE_RATE_PER_LEVEL,
    IDLE_COUNTER_RATE,
    IDLE_SHELF_CLICK,
    IDLE_CLERK_BONUS,
    IDLE_MAX_TICK_DT,
    formatIdleNumber,
    formatIdleRate,
    idleUpgradeCost,
    idleClickPower,
    idleAutoRate,
    idleOfflineRate,
    createZeroLevels,
    clampLevel,
    clampCoins,
} = require(path.join(OUT, 'IdleCore.js'));

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

function levelsOf(partial) {
    return Object.assign(createZeroLevels(), partial);
}

function newCore(partialLevels, coins = 0, now = 1_700_000_000_000) {
    const core = new IdleCore(now);
    core.coins = coins;
    const lv = levelsOf(partialLevels || {});
    for (const id of IDLE_FACILITY_IDS) core.levels[id] = lv[id];
    return core;
}

function assertSane(core, label) {
    assert(Number.isFinite(core.coins), `${label}：coins=${core.coins}`);
    assert(Number.isFinite(core.totalEarned), `${label}：totalEarned=${core.totalEarned}`);
    assert(core.coins >= 0, `${label}：coins 为负 ${core.coins}`);
    assert(core.totalEarned >= 0, `${label}：totalEarned 为负`);
    assert(core.coins <= IDLE_MAX_COINS, `${label}：coins 超上限 ${core.coins}`);
    assert(core.totalEarned <= IDLE_MAX_COINS, `${label}：totalEarned 超上限`);
    for (const id of IDLE_FACILITY_IDS) {
        const lv = core.levels[id];
        assert(Number.isInteger(lv) && lv >= 0 && lv <= IDLE_MAX_LEVEL, `${label}：${id} 等级非法 ${lv}`);
    }
}

// ==================== 设施与费用 ====================

console.log('\n[设施与费用]');

test('四类设施齐全且参数合法', () => {
    assert.strictEqual(IDLE_FACILITIES.length, 4);
    assert.deepStrictEqual(IDLE_FACILITY_IDS, ['shelf', 'counter', 'clerk', 'warehouse']);
    for (const def of IDLE_FACILITIES) {
        assert(def.name && def.desc, `${def.id} 缺少文案`);
        assert(def.baseCost > 0, `${def.id} 首级费用非法`);
        assert(def.growth > 1, `${def.id} 费用倍率非法`);
    }
});

test('费用表与公式一致且严格递增', () => {
    for (const def of IDLE_FACILITIES) {
        let prev = 0;
        for (let lv = 0; lv < IDLE_MAX_LEVEL; lv++) {
            const cost = idleUpgradeCost(def.id, lv);
            assert.strictEqual(cost, Math.round(def.baseCost * Math.pow(def.growth, lv)),
                `${def.id} 等级 ${lv} 费用不符`);
            assert(cost > prev, `${def.id} 等级 ${lv} 费用未递增（${cost} <= ${prev}）`);
            prev = cost;
        }
    }
});

test('满级 / 非法等级返回 -1', () => {
    for (const def of IDLE_FACILITIES) {
        assert.strictEqual(idleUpgradeCost(def.id, IDLE_MAX_LEVEL), -1, `${def.id} 满级未返回 -1`);
        assert.strictEqual(idleUpgradeCost(def.id, 99), -1);
        assert.strictEqual(idleUpgradeCost(def.id, -3), idleUpgradeCost(def.id, 0), '负等级未按 0 处理');
    }
});

test('clampLevel / clampCoins 兜底非法值', () => {
    assert.strictEqual(clampLevel(-1), 0);
    assert.strictEqual(clampLevel(2.9), 2);
    assert.strictEqual(clampLevel(99), IDLE_MAX_LEVEL);
    assert.strictEqual(clampLevel(NaN), 0);
    assert.strictEqual(clampLevel('3'), 3);
    assert.strictEqual(clampLevel(undefined), 0);
    assert.strictEqual(clampCoins(-5), 0);
    assert.strictEqual(clampCoins(NaN), 0);
    assert.strictEqual(clampCoins(Infinity), 0);
    assert.strictEqual(clampCoins(1e20), IDLE_MAX_COINS);
    assert.strictEqual(clampCoins('12'), 12);
});

// ==================== 收益公式 ====================

console.log('\n[收益公式]');

test('点击收益公式', () => {
    assert.strictEqual(idleClickPower(levelsOf({})), 1);
    assert.strictEqual(idleClickPower(levelsOf({ shelf: 1 })), 1 + IDLE_SHELF_CLICK);
    assert.strictEqual(idleClickPower(levelsOf({ shelf: 5 })), 1 + IDLE_SHELF_CLICK * 5);
    assert.strictEqual(idleClickPower(levelsOf({ shelf: 2, clerk: 1 })),
        (1 + IDLE_SHELF_CLICK * 2) * (1 + IDLE_CLERK_BONUS));
});

test('自动收益公式', () => {
    assert.strictEqual(idleAutoRate(levelsOf({})), 0);
    assert.strictEqual(idleAutoRate(levelsOf({ counter: 1 })), IDLE_COUNTER_RATE);
    assert.strictEqual(idleAutoRate(levelsOf({ counter: 3, clerk: 2 })),
        IDLE_COUNTER_RATE * 3 * (1 + IDLE_CLERK_BONUS * 2));
});

test('离线效率封顶 100%', () => {
    assert.strictEqual(idleOfflineRate(levelsOf({})), IDLE_OFFLINE_BASE_RATE);
    assert.strictEqual(idleOfflineRate(levelsOf({ warehouse: 1 })),
        IDLE_OFFLINE_BASE_RATE + IDLE_OFFLINE_RATE_PER_LEVEL);
    assert.strictEqual(idleOfflineRate(levelsOf({ warehouse: IDLE_MAX_LEVEL })), 1);
    // 3 级 = 0.76；5 级刚好 1.0
    assert.strictEqual(idleOfflineRate(levelsOf({ warehouse: 3 })), 0.76);
});

test('升级后对应收益严格变大', () => {
    const clickBase = idleClickPower(levelsOf({ shelf: 2 }));
    assert(idleClickPower(levelsOf({ shelf: 3 })) > clickBase, '货架升级未提升点击');
    const clickClerk = idleClickPower(levelsOf({ clerk: 1 }));
    assert(idleClickPower(levelsOf({ clerk: 2 })) > clickClerk, '店员升级未提升点击');

    const autoBase = idleAutoRate(levelsOf({ counter: 2 }));
    assert(idleAutoRate(levelsOf({ counter: 3 })) > autoBase, '收银台升级未提升自动收益');
    assert(idleAutoRate(levelsOf({ counter: 2, clerk: 1 })) > autoBase, '店员升级未提升自动收益');

    const offBase = idleOfflineRate(levelsOf({ warehouse: 1 }));
    assert(idleOfflineRate(levelsOf({ warehouse: 2 })) > offBase, '仓库升级未提升离线效率');
});

test('tap / tick / buy 的基本行为', () => {
    const core = newCore({}, 0);
    const gain = core.tap();
    assert.strictEqual(gain, 1);
    assert.strictEqual(core.coins, 1);
    assert.strictEqual(core.totalEarned, 1);

    // 金币不足
    assert.strictEqual(core.buy('shelf'), false);
    assert.strictEqual(core.coins, 1);
    assert.strictEqual(core.levels.shelf, 0);

    // 补足后购买
    core.coins = 100;
    const cost = core.costOf('shelf');
    assert.strictEqual(core.buy('shelf'), true);
    assert.strictEqual(core.levels.shelf, 1);
    assert.strictEqual(core.coins, 100 - cost);

    // 自动收益
    core.levels.counter = 1;
    const auto = core.tick(2);
    assert(Math.abs(auto - IDLE_COUNTER_RATE * 2) < 1e-9, `自动收益 ${auto}`);
    assert.strictEqual(core.autoRate, IDLE_COUNTER_RATE);
});

test('tick 单帧 dt 上限生效，非法 dt 返回 0', () => {
    const core = newCore({ counter: 5, clerk: 5 });
    const perSec = core.autoRate;
    const gain = core.tick(1000);
    assert(Math.abs(gain - perSec * IDLE_MAX_TICK_DT) < 1e-9, `dt 未被限制：${gain}`);
    assert.strictEqual(core.tick(0), 0);
    assert.strictEqual(core.tick(-1), 0);
    assert.strictEqual(core.tick(NaN), 0);
    assert.strictEqual(core.tick(Infinity), 0);
    assertSane(core, 'tick 后');
});

test('满级后 buy 返回 false 且不扣钱', () => {
    const core = newCore({ shelf: IDLE_MAX_LEVEL }, 1e9);
    const before = core.coins;
    assert.strictEqual(core.costOf('shelf'), -1);
    assert.strictEqual(core.buy('shelf'), false);
    assert.strictEqual(core.coins, before);
    assert.strictEqual(core.levels.shelf, IDLE_MAX_LEVEL);
    assert.strictEqual(core.isMaxed, false);
    core.levels.counter = IDLE_MAX_LEVEL;
    core.levels.clerk = IDLE_MAX_LEVEL;
    core.levels.warehouse = IDLE_MAX_LEVEL;
    assert.strictEqual(core.isMaxed, true);
});

// ==================== 离线结算 ====================

console.log('\n[离线结算]');

const T0 = 1_700_000_000_000;

test('按时长结算离线收益', () => {
    const core = newCore({ counter: 2 }, 0, T0);
    const res = core.settleOffline(T0 + 3600_000);
    const expect = core.autoRate * core.offlineRate * 3600;
    assert.strictEqual(res.elapsedSec, 3600);
    assert.strictEqual(res.countedSec, 3600);
    assert(Math.abs(res.gain - expect) < 1e-6, `离线收益 ${res.gain} ≠ ${expect}`);
    assert.strictEqual(res.capped, false);
    assert.strictEqual(res.rewound, false);
    assert(Math.abs(core.coins - expect) < 1e-6);
    assert.strictEqual(core.lastTick, T0 + 3600_000);
});

test('离线时长超过 8 小时按上限结算', () => {
    const core = newCore({ counter: 3 }, 0, T0);
    const res = core.settleOffline(T0 + 30 * 24 * 3600_000);
    assert.strictEqual(res.elapsedSec, 30 * 24 * 3600);
    assert.strictEqual(res.countedSec, IDLE_OFFLINE_CAP_SEC);
    assert.strictEqual(res.capped, true);
    const expect = core.autoRate * core.offlineRate * IDLE_OFFLINE_CAP_SEC;
    assert(Math.abs(res.gain - expect) < 1e-6);
});

test('时间倒退不产生负收益且记录新时间戳', () => {
    const core = newCore({ counter: 2 }, 500, T0);
    const res = core.settleOffline(T0 - 24 * 3600_000);
    assert.strictEqual(res.gain, 0);
    assert.strictEqual(res.elapsedSec, 0);
    assert.strictEqual(res.rewound, true);
    assert.strictEqual(core.coins, 500, '倒退时金币被改动');
    assert.strictEqual(core.lastTick, T0 - 24 * 3600_000);
    // 之后再正常前进，按新时间戳结算
    const res2 = core.settleOffline(T0);
    assert(Math.abs(res2.elapsedSec - 24 * 3600) < 1e-6, `倒退后时长 ${res2.elapsedSec}`);
    assert(res2.gain > 0);
    assertSane(core, '倒退后');
});

test('无自动收益时离线收益为 0', () => {
    const core = newCore({ shelf: 5 }, 0, T0);
    const res = core.settleOffline(T0 + 8 * 3600_000);
    assert.strictEqual(res.rate, 0);
    assert.strictEqual(res.gain, 0);
    assert.strictEqual(core.coins, 0);
});

test('非法时间戳回落为当前时间且仍受上限约束', () => {
    const core = newCore({ counter: 1 }, 0, T0);
    const res = core.settleOffline(NaN);
    // NaN 回落到 Date.now()，从 T0 到现在时长极长 → 被 8 小时上限截断
    assert(Number.isFinite(res.elapsedSec) && res.elapsedSec >= 0, 'elapsedSec 非法');
    assert.strictEqual(res.countedSec, IDLE_OFFLINE_CAP_SEC);
    assert(Number.isFinite(res.gain) && res.gain >= 0, 'gain 非法');
    assert(Number.isFinite(core.lastTick));
    assertSane(core, 'NaN 时间戳');
});

test('金币封顶后离线收益为 0 且不越过上限', () => {
    const core = newCore({ counter: 5, clerk: 5, warehouse: 5 }, IDLE_MAX_COINS - 1, T0);
    const res = core.settleOffline(T0 + 8 * 3600_000);
    assert.strictEqual(core.coins, IDLE_MAX_COINS);
    assert(res.gain <= 1 + 1e-9, `封顶时仍获得 ${res.gain}`);
    assert(res.gain >= 0);
    assertSane(core, '封顶后');
});

// ==================== 数值安全 ====================

console.log('\n[数值安全]');

test('30 天离线模拟：收益单调、无 NaN / Infinity、不超上限', () => {
    const core = newCore({ counter: 4, clerk: 3, warehouse: 2 }, 100, T0);
    let prev = core.coins;
    let prevEarned = core.totalEarned;
    for (let day = 1; day <= 30; day++) {
        const res = core.settleOffline(T0 + day * 24 * 3600_000);
        assert(res.gain >= 0, `第 ${day} 天收益为负`);
        assert(core.coins >= prev, `第 ${day} 天金币下降`);
        assert(core.totalEarned >= prevEarned, `第 ${day} 天累计收益下降`);
        prev = core.coins;
        prevEarned = core.totalEarned;
        assertSane(core, `第 ${day} 天`);
    }
    assert(core.coins > 100, '30 天后金币没有增长');
    assert(core.coins < IDLE_MAX_COINS, '30 天模拟不应触顶，说明公式异常');
});

test('10 万次点击 / 升级 / tick 无非法数值', () => {
    const core = newCore({}, 0, T0);
    for (let i = 0; i < 100_000; i++) {
        core.tap();
        core.tick(0.016);
        const id = IDLE_FACILITY_IDS[i % 4];
        if (core.costOf(id) >= 0) core.buy(id);
        if (i % 10_000 === 0) assertSane(core, `第 ${i} 次`);
    }
    assertSane(core, '10 万次后');
    assert(core.coins > 0, '点击 10 万次后没有金币');
});

test('满级长跑不产生 Infinity / NaN', () => {
    const core = newCore({ shelf: 5, counter: 5, clerk: 5, warehouse: 5 }, 0, T0);
    for (let i = 0; i < 1000; i++) {
        core.tap();
        core.tick(IDLE_MAX_TICK_DT);
        core.settleOffline(core.lastTick + 8 * 3600_000);
    }
    assertSane(core, '满级长跑');
    assert(core.coins > 0);
    // 直接逼到上限附近，再走一整轮，验证封顶
    core.coins = IDLE_MAX_COINS - 1;
    core.totalEarned = IDLE_MAX_COINS - 1;
    core.tick(IDLE_MAX_TICK_DT);
    core.settleOffline(core.lastTick + 8 * 3600_000);
    core.tap();
    assert.strictEqual(core.coins, IDLE_MAX_COINS);
    assertSane(core, '封顶长跑');
});

// ==================== 格式化 ====================

console.log('\n[格式化]');

test('大数格式化', () => {
    assert.strictEqual(formatIdleNumber(0), '0');
    assert.strictEqual(formatIdleNumber(5.9), '5');
    assert.strictEqual(formatIdleNumber(999), '999');
    assert.strictEqual(formatIdleNumber(1000), '1K');
    assert.strictEqual(formatIdleNumber(1500), '1.5K');
    assert.strictEqual(formatIdleNumber(999949), '1M');
    assert.strictEqual(formatIdleNumber(1e6), '1M');
    assert.strictEqual(formatIdleNumber(1.25e9), '1.3B');
    assert.strictEqual(formatIdleNumber(1e12), '1T');
    assert.strictEqual(formatIdleNumber(1e15), '1000T');
    assert.strictEqual(formatIdleNumber(1e20), '1000T');
    assert.strictEqual(formatIdleNumber(NaN), '0');
    assert.strictEqual(formatIdleNumber(Infinity), '0');
    assert.strictEqual(formatIdleNumber(-5), '0');
});

test('速率格式化', () => {
    assert.strictEqual(formatIdleRate(0), '0');
    assert.strictEqual(formatIdleRate(0.6), '0.6');
    assert.strictEqual(formatIdleRate(12.34), '12.3');
    assert.strictEqual(formatIdleRate(12.0), '12');
    assert.strictEqual(formatIdleRate(150), '150');
    assert.strictEqual(formatIdleRate(1500), '1.5K');
    assert.strictEqual(formatIdleRate(NaN), '0');
    assert.strictEqual(formatIdleRate(-1), '0');
});

// ==================== 存档 ====================

console.log('\n[存档]');

test('快照往返保留金币、等级与累计收益', () => {
    const core = newCore({ shelf: 2, counter: 3, warehouse: 1 }, 1234.5, T0);
    core.totalEarned = 8888.25;
    const snap = core.snapshot(T0 + 5000);
    const restored = IdleCore.fromSnapshot(snap, T0 + 9000);
    assert.strictEqual(restored.coins, core.coins);
    assert.deepStrictEqual(restored.levels, core.levels);
    assert.strictEqual(restored.totalEarned, core.totalEarned);
    assert.strictEqual(restored.lastTick, T0 + 5000);
});

test('写入 → 读回 → 再写结果一致', () => {
    const core = newCore({ shelf: 5, counter: 2, clerk: 1, warehouse: 3 }, 777.7, T0);
    const a = core.snapshot(T0 + 1000);
    const b = IdleCore.fromSnapshot(JSON.parse(JSON.stringify(a)), T0 + 2000).snapshot(T0 + 1000);
    assert.deepStrictEqual(b, a);
});

test('坏档回落默认值且不抛异常', () => {
    const cases = [null, undefined, 0, '', 'broken', [], {}, { levels: 'x' }];
    for (const raw of cases) {
        const core = IdleCore.fromSnapshot(raw, T0);
        assert.strictEqual(core.coins, 0, `坏档 ${JSON.stringify(raw)} 金币不为 0`);
        assert.deepStrictEqual(core.levels, createZeroLevels());
        assert.strictEqual(core.lastTick, T0);
        assertSane(core, `坏档 ${JSON.stringify(raw)}`);
    }
});

test('字段越界时逐项 clamp', () => {
    const core = IdleCore.fromSnapshot({
        coins: -100,
        totalEarned: 1e30,
        levels: { shelf: 99, counter: -2, clerk: 2.9, warehouse: '3' },
        lastTick: -1,
    }, T0);
    assert.strictEqual(core.coins, 0);
    assert.strictEqual(core.totalEarned, IDLE_MAX_COINS);
    assert.strictEqual(core.levels.shelf, IDLE_MAX_LEVEL);
    assert.strictEqual(core.levels.counter, 0);
    assert.strictEqual(core.levels.clerk, 2);
    assert.strictEqual(core.levels.warehouse, 3);
    assert.strictEqual(core.lastTick, T0, '非法时间戳未回落');
    assertSane(core, '越界存档');
});

test('旧存档缺字段按默认值补齐', () => {
    const core = IdleCore.fromSnapshot({ coins: 50 }, T0);
    assert.strictEqual(core.coins, 50);
    assert.deepStrictEqual(core.levels, createZeroLevels());
    assert.strictEqual(core.totalEarned, 0);
    assert.strictEqual(core.lastTick, T0);
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
console.log('小店日记核心自检通过。');
