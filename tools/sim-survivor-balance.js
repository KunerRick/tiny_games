#!/usr/bin/env node
/**
 * 午夜幸存者 — 平衡模拟（无渲染，不启动编辑器）。
 *
 * 复用纯逻辑核心，跑 N 局「参考走位 + 指定抽卡」与「参考走位 + 随机抽卡」，
 * 统计通关率 / 阵亡时间分布 / 等级与构筑，供计划 §2.1.3 G4 校准使用。
 *
 *   node tools/sim-survivor-balance.js            # 默认 100 局
 *   node tools/sim-survivor-balance.js 40         # 自定义局数
 *   node tools/sim-survivor-balance.js 40 1234    # 指定起始 seed
 *
 * 退出码：0 = 通关率落在 25–55% 且无必输/无敌构筑；1 = 需要继续校准。
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'games', 'game_survivor', 'scripts');
const OUT = path.join(ROOT, 'temp', 'survivor-sim');

const TSC_CANDIDATES = [
    process.env.TSC,
    path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc',
].filter(Boolean);

function findTsc() {
    for (const p of TSC_CANDIDATES) if (fs.existsSync(p)) return p;
    throw new Error('找不到 tsc：请设置 TSC 环境变量或 npm install');
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
execFileSync(
    process.execPath,
    [
        findTsc(),
        path.join(SRC, 'SurvivorConfig.ts'),
        path.join(SRC, 'SurvivorCore.ts'),
        '--outDir', OUT,
        '--rootDir', SRC,
        '--module', 'commonjs',
        '--target', 'es2019',
        '--skipLibCheck',
    ],
    { stdio: 'inherit' }
);

const C = require(path.join(OUT, 'SurvivorConfig.js'));
const { SurvivorCore } = require(path.join(OUT, 'SurvivorCore.js'));

const DT = C.FIXED_DT;
const MAX_RUN_SEC = 600;

// ==================== 走位策略（与 verify-survivor-core.js 的参考 bot 一致） ====================

const BOT = {
    interval: 0.15,
    ahead: 180,
    enemyWeight: 4,
    gemWeight: 65,
    gemRange: 1200,
    inertia: 1,
    edgePenalty: 8,
    enemyRadius: 350,
    dirs: 24,
    /** 身边没有可打目标时，多远开始主动贴近 */
    huntRange: 420,
    huntWeight: 40,
    bossWeight: 600,
};

function makeBot() {
    let dir = { moveX: 1, moveY: 0 };
    let cd = 0;
    return function (core) {
        cd -= DT;
        if (cd > 0) return dir;
        cd = BOT.interval;
        const s = core.getSnapshot();
        const p = s.player;
        const enemies = [];
        let nearest = null;
        let nearestD = Infinity;
        for (const e of s.enemies) {
            if (!e.active) continue;
            const d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d < BOT.enemyRadius) enemies.push({ x: e.x, y: e.y, d });
            if (d < nearestD) { nearestD = d; nearest = e; }
        }
        let gd = Infinity;
        let gx = 0;
        let gy = 0;
        for (const g of s.gems) {
            if (!g.active) continue;
            const d = Math.hypot(g.x - p.x, g.y - p.y);
            if (d < gd) {
                gd = d;
                gx = g.x;
                gy = g.y;
            }
        }
        // 目标：Boss 出现后主动接战；否则若身边没有可打的目标，就去追最近的敌人（打猎）
        let tx = null;
        let ty = null;
        let targetWeight = 0;
        if (s.boss && s.boss.active) {
            tx = s.boss.x;
            ty = s.boss.y;
            targetWeight = BOT.bossWeight;
        } else if (nearestD > BOT.huntRange && nearest) {
            tx = nearest.x;
            ty = nearest.y;
            targetWeight = BOT.huntWeight;
        }
        let bestScore = -Infinity;
        let bestDir = dir;
        for (let k = 0; k < BOT.dirs; k++) {
            const a = (k / BOT.dirs) * Math.PI * 2;
            const ux = Math.cos(a);
            const uy = Math.sin(a);
            let score = 0;
            for (const e of enemies) {
                const ex = e.x - (p.x + ux * BOT.ahead);
                const ey = e.y - (p.y + uy * BOT.ahead);
                score -= BOT.enemyWeight / (Math.hypot(ex, ey) + 20);
            }
            score += (ux * dir.moveX + uy * dir.moveY) * BOT.inertia;
            if (gd < BOT.gemRange) {
                const gdist = Math.hypot(gx - (p.x + ux * BOT.ahead), gy - (p.y + uy * BOT.ahead));
                score += BOT.gemWeight / (gdist + 80);
            }
            if (tx !== null) {
                const tdist = Math.hypot(tx - (p.x + ux * BOT.ahead), ty - (p.y + uy * BOT.ahead));
                score += targetWeight / (tdist + 80);
            }
            const nx = p.x + ux * 500;
            const ny = p.y + uy * 500;
            if (Math.abs(nx) > 1050 || Math.abs(ny) > 1050) score -= BOT.edgePenalty;
            if (score > bestScore) {
                bestScore = score;
                bestDir = { moveX: ux, moveY: uy };
            }
        }
        dir = bestDir;
        return dir;
    };
}

// ==================== 抽卡策略 ====================

const PRIORITY = ['newWeapon', 'weaponUpgrade', 'newPassive', 'passiveUpgrade', 'heal', 'temper'];

function choosePriority(core) {
    const offers = core.getOffers();
    let best = 0;
    let bestRank = 99;
    for (let i = 0; i < offers.length; i++) {
        const rank = PRIORITY.indexOf(offers[i].kind);
        if (rank >= 0 && rank < bestRank) {
            bestRank = rank;
            best = i;
        }
    }
    core.chooseUpgrade(best);
}

/** 随机抽卡（模拟不研究构筑的玩家）：愈合/淬炼也算合法选择 */
function makeRandomChooser(rng) {
    return function (core) {
        const offers = core.getOffers();
        core.chooseUpgrade(Math.floor(rng() * offers.length));
    };
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ==================== 单局 ====================

function playOne(seed, chooser) {
    const core = new SurvivorCore(seed);
    const bot = makeBot();
    let t = 0;
    let stepCount = 0;
    while (t < MAX_RUN_SEC) {
        const phase = core.getSnapshot().phase;
        if (phase === 'levelup') {
            chooser(core);
            continue;
        }
        if (phase !== 'running') break;
        core.step(DT, bot(core));
        stepCount++;
        t += DT;
        if (core.getSnapshot().phase === 'levelup') chooser(core);
    }
    const snap = core.getSnapshot();
    const summary = core.getRunSummary();
    return {
        seed,
        phase: snap.phase,
        time: snap.time,
        level: snap.player.level,
        kills: snap.kills,
        weapons: { ...snap.weapons },
        passives: { ...snap.passives },
        temper: snap.temper,
        hp: snap.player.hp,
        bossHp: snap.boss && snap.boss.active ? snap.boss.hp : 0,
        lastHit: summary.lastHitSource,
        lastHitDamage: summary.lastHitDamage,
        steps: stepCount,
    };
}

// ==================== 主流程 ====================

const runs = Math.max(1, parseInt(process.argv[2] || '100', 10));
const seed0 = parseInt(process.argv[3] || '1000', 10);

function pct(n, d) {
    return `${((n / d) * 100).toFixed(0)}%`;
}

function report(label, results) {
    const wins = results.filter((r) => r.phase === 'victory');
    const losses = results.filter((r) => r.phase === 'defeat');
    const timeouts = results.filter((r) => r.phase === 'running');
    const deathTimes = losses.map((r) => r.time).sort((a, b) => a - b);
    const q = (p) => (deathTimes.length ? deathTimes[Math.min(deathTimes.length - 1, Math.floor(p * deathTimes.length))] : 0);
    const avgLevel = results.reduce((a, r) => a + r.level, 0) / results.length;
    const avgKills = results.reduce((a, r) => a + r.kills, 0) / results.length;

    console.log(`\n=== ${label}（${results.length} 局）===`);
    console.log(`通关 ${wins.length} (${pct(wins.length, results.length)})  ` +
        `阵亡 ${losses.length}  ` +
        `超时未结束 ${timeouts.length}`);
    if (losses.length) {
        console.log(`阵亡时间 中位 ${q(0.5).toFixed(0)} s  /  p10 ${q(0.1).toFixed(0)} s  /  p90 ${q(0.9).toFixed(0)} s`);
        const src = {};
        for (const r of losses) src[r.lastHit || '?'] = (src[r.lastHit || '?'] || 0) + 1;
        console.log(`致命来源 ${Object.entries(src).map(([k, v]) => `${k}:${v}`).join('  ')}`);
    }
    console.log(`平均等级 ${avgLevel.toFixed(1)}  平均击杀 ${avgKills.toFixed(0)}`);
    return { wins: wins.length, total: results.length };
}

console.log('午夜幸存者 · 平衡模拟');
console.log(`起始 seed ${seed0}，单局上限 ${MAX_RUN_SEC} s，Boss ${C.BOSS_TIME} s`);

const t0 = Date.now();
const priority = [];
const random = [];
for (let i = 0; i < runs; i++) {
    const seed = seed0 + i;
    priority.push(playOne(seed, choosePriority));
    random.push(playOne(seed + 500000, makeRandomChooser(mulberry32(seed * 7919 + 13))));
}

if (process.argv[4] === 'v') {
    for (const r of priority) {
        console.log(`  seed ${r.seed}: ${r.phase} @${r.time.toFixed(0)}s Lv${r.level} 击杀${r.kills} hp${r.hp.toFixed(0)} boss${r.bossHp.toFixed(0)} ` +
            `武器 ${JSON.stringify(r.weapons)} 被动 ${JSON.stringify(r.passives)} 淬炼${r.temper} 致命 ${r.lastHit}`);
    }
}

const pr = report('参考走位 + 按优先级抽卡', priority);
const rr = report('参考走位 + 随机抽卡', random);

// 必输 / 无敌构筑粗筛：按最终武器组合看通关率
function buildKey(r) {
    return Object.keys(r.weapons).sort().join('+') || 'none';
}
const groups = new Map();
for (const r of priority) {
    const k = buildKey(r);
    if (!groups.has(k)) groups.set(k, { wins: 0, total: 0 });
    const g = groups.get(k);
    g.total++;
    if (r.phase === 'victory') g.wins++;
}
const badGroups = [];
for (const [k, g] of groups) {
    if (g.total >= 5 && (g.wins / g.total === 0 || g.wins / g.total === 1)) {
        badGroups.push(`${k}: ${g.wins}/${g.total}`);
    }
}
console.log('\n构筑通关率（优先级 bot，≥5 局才统计）：');
for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${k.padEnd(28, ' ')} ${g.wins}/${g.total}`);
}
if (badGroups.length) {
    console.log(`\n⚠ 存在 0% 或 100% 通关的构筑：${badGroups.join('  ')}`);
}

const ms = Date.now() - t0;
console.log(`\n耗时 ${(ms / 1000).toFixed(1)} s（${runs * 2} 局，${((ms / (runs * 2)) / 1000).toFixed(2)} s/局）`);

// 以「优先级 bot」为主判据：真实玩家水平介于两者之间
const rate = pr.wins / pr.total;
const inBand = rate >= 0.25 && rate <= 0.55;
console.log(`优先级 bot 通关率 ${pct(pr.wins, pr.total)}（目标 25–55%）`);
console.log(`随机抽卡 bot 通关率 ${pct(rr.wins, rr.total)}`);

if (!inBand || badGroups.length) {
    console.log(`\nSIM_FAIL 需要继续校准（通关率 ${pct(pr.wins, pr.total)}${badGroups.length ? '，存在退化构筑' : ''}）`);
    process.exit(1);
}
console.log('\nSIM_OK 平衡落在目标带宽内');
process.exit(0);
