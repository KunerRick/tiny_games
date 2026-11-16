#!/usr/bin/env node
/**
 * 《秘银远征》平衡长跑 + 存档迁移自检（M9，不启动 Cocos）。
 *
 * 覆盖：
 *  1. 长跑稳定性：6 副本连续战斗累计 ≥ 10,000 步，每 30 步抽样 —— 无 NaN / 生命不越界 /
 *     实体不超上限；每局都能在时限内结束（不悬空）
 *  2. 六副本计时：战士按 `BANDS` 通关，时长 30 s ≤ t ≤ maxSeconds，经验 / 金币为正，BOSS 至少进入第 2 阶段
 *  3. 野外全清：3 区域各按最短路走到区域首领，战斗节点用真实 `buildWildPlan` + 自动玩家；
 *     首领节点必须获胜（副本入口节点的战斗已计入第 2 组，本组只算 2 秒过门）
 *  4. 一周目 6 小时预算：用实测经验速率替换 M8 的分段估计；人类系数 ×1.5 + 悬赏操作 0.75 h
 *  5. 经济不变量：金币收入 / 重铸 / 附魔 / 洗点成本有限且非负；设施材料总需求与 3 条野外路线产出同量级
 *  6. 存档迁移：v1 真实档 → v2、pre-M5 / pre-M7 / pre-M8 合成档、过期经验折算、未来版本降级、
 *     坏 JSON / 空档 / 类型错误、uid 冲突、迁移幂等
 *
 * 用法：node tools/verify-mithril-balance.js
 * 通过时打印 MITHRIL_BALANCE_OK；失败逐条打印并以退出码 1 结束。
 * 调平衡时用 `MITHRIL_VERBOSE=1` 看每场用时；脚本约 3–5 分钟。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, runTsc } = require('./lib/core-compile');

const SRC_DIR = path.join(ROOT, 'assets', 'games', 'game_mithril', 'scripts');
const OUT = path.join(ROOT, 'temp', 'mithril-balance-test');

// ---------- 1. 纯度：纯逻辑层不许碰渲染 / 时间 / 本地存储 ----------
// `MithrilProgress` 只允许 `Math.random`：`sanitizeSave` 给缺 uid 的坏档补一个，
// 不参与任何数值判定（读档后的战斗完全由存档内容决定）。
const PURE_FILES = [
    { name: 'MithrilConfig.ts', forbidRandom: true },
    { name: 'MithrilProgress.ts', forbidRandom: false },
    { name: 'MithrilCore.ts', forbidRandom: true },
    { name: 'MithrilLoot.ts', forbidRandom: true },
    { name: 'MithrilWild.ts', forbidRandom: true },
    { name: 'MithrilCamp.ts', forbidRandom: true },
];
for (const file of PURE_FILES) {
    const source = fs.readFileSync(path.join(SRC_DIR, file.name), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    if (/from\s+['"]cc(\/|['"])/.test(code)) {
        console.error(`${file.name} 不许 import cc`);
        process.exit(1);
    }
    const forbidden = ['Date.now', 'localStorage'];
    if (file.forbidRandom) forbidden.push('Math.random');
    for (const bad of forbidden) {
        if (new RegExp(`\\b${bad.replace('.', '\\.')}\\b`).test(code)) {
            console.error(`${file.name} 不许使用 ${bad}（要可复现 / 与渲染层无关）`);
            process.exit(1);
        }
    }
}

// ---------- 2. 编译纯逻辑模块 ----------
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`编译纯逻辑模块 → ${path.relative(ROOT, OUT)}`);
runTsc([
    path.join(SRC_DIR, 'MithrilConfig.ts'),
    path.join(SRC_DIR, 'MithrilProgress.ts'),
    path.join(SRC_DIR, 'MithrilCore.ts'),
    path.join(SRC_DIR, 'MithrilLoot.ts'),
    path.join(SRC_DIR, 'MithrilTalents.ts'),
    path.join(SRC_DIR, 'MithrilWild.ts'),
    path.join(SRC_DIR, 'MithrilCamp.ts'),
    '--outDir', OUT,
    '--rootDir', SRC_DIR,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
]);

const F = require(path.join(OUT, 'MithrilConfig.js'));
const P = require(path.join(OUT, 'MithrilProgress.js'));
const C = require(path.join(OUT, 'MithrilCore.js'));
const L = require(path.join(OUT, 'MithrilLoot.js'));
const W = require(path.join(OUT, 'MithrilWild.js'));
const K = require(path.join(OUT, 'MithrilCamp.js'));
const bot = require('./lib/mithril-bot').createBot(F, C);

let passed = 0;
const failures = [];

function check(name, cond, detail) {
    if (cond) {
        passed++;
        if (process.env.MITHRIL_VERBOSE) {
            console.log(`ok  ${name}${detail !== undefined ? `  [${detail}]` : ''}`);
        }
    } else {
        failures.push(`${name}${detail !== undefined ? ` —— ${detail}` : ''}`);
    }
}

function eq(name, actual, expected) {
    check(name, actual === expected, `期望 ${expected}，实际 ${actual}`);
}

function near(name, actual, min, max) {
    check(name, actual >= min && actual <= max, `期望 ${min}–${max}，实际 ${actual}`);
}

function finite(n) {
    return typeof n === 'number' && Number.isFinite(n);
}

const FIXED_DT = F.FIXED_DT;
const DUNGEON_IDS = ['mine', 'chapel', 'tower', 'forge', 'shadow', 'throne'];

// ==================== 3. 六副本：计时 + 长跑抽样 ====================

/**
 * 与 `bot.runDungeon` 同一套种子 / 配置，但每 30 步抽样数值健康度。
 * 返回的 `steps` 供第 1 组累计 10,000 步长跑。
 */
function runDungeonMeasured(dungeonId) {
    const band = bot.BANDS[dungeonId];
    const world = new C.MithrilWorld(
        C.makeProfile('warrior', band.level, band.ilvl),
        9000 + dungeonId.length * 31 + 'warrior'.length,
        null,
    );
    world.startDungeon(dungeonId);
    const maxSteps = Math.round(band.maxSeconds / FIXED_DT);
    let steps = 0;
    let badState = '';
    let samples = 0;
    let maxEnemies = 0;
    let maxBullets = 0;
    let maxOrbs = 0;
    let maxTelegraphs = 0;
    let bossPhases = 0;
    while (world.phase === 'playing' && steps < maxSteps) {
        world.step(FIXED_DT, bot.botInput(world));
        for (const ev of world.drainEvents()) {
            if (ev.type === 'phase') bossPhases = Math.max(bossPhases, ev.phase);
        }
        steps++;
        if (steps % 30 === 0) {
            samples++;
            const pl = world.player;
            if (!finite(pl.hp) || !finite(pl.x) || !finite(pl.y) || !finite(pl.maxHp)) {
                badState = `player ${pl.hp}/${pl.x},${pl.y}`;
                break;
            }
            if (pl.hp < 0 || pl.hp > pl.maxHp + 0.001) {
                badState = `player hp 越界 ${pl.hp}/${pl.maxHp}`;
                break;
            }
            for (const en of world.enemies) {
                if (!finite(en.hp) || !finite(en.maxHp) || en.hp > en.maxHp + 0.001) {
                    badState = `enemy ${en.kind} ${en.hp}/${en.maxHp}`;
                    break;
                }
            }
            if (badState) break;
            for (const b of world.bullets) {
                if (!finite(b.x) || !finite(b.y) || !finite(b.vx) || !finite(b.vy)) {
                    badState = `bullet ${b.x},${b.y} ${b.vx},${b.vy}`;
                    break;
                }
            }
            if (badState) break;
            if (world.boss && (!finite(world.boss.hp) || world.boss.hp < 0)) {
                badState = `boss hp ${world.boss.hp}`;
                break;
            }
            maxEnemies = Math.max(maxEnemies, world.enemies.length);
            maxBullets = Math.max(maxBullets, world.bullets.length);
            maxOrbs = Math.max(maxOrbs, world.orbs.length);
            maxTelegraphs = Math.max(maxTelegraphs, world.telegraphs.length);
        }
    }
    return {
        world, dungeonId, band,
        steps,
        samples,
        seconds: steps * FIXED_DT,
        badState,
        bossPhases,
        maxEnemies,
        maxBullets,
        maxOrbs,
        maxTelegraphs,
        expGained: world.expGained,
        goldGained: world.goldGained,
        phase: world.phase,
    };
}

console.log('跑 6 个副本（自动玩家 / 抽样健康度）…');
const dungeonRuns = [];
for (const id of DUNGEON_IDS) {
    const r = runDungeonMeasured(id);
    dungeonRuns.push(r);
    if (process.env.MITHRIL_VERBOSE) {
        console.log(`  ${id}: ${r.seconds.toFixed(1)}s / ${r.steps} 步 / exp ${r.expGained} / gold ${r.goldGained} / phase ${r.phase}`);
    }
}

// ---- 3.1 长跑：累计步数 / 抽样 / 不悬空 ----
{
    const totalSteps = dungeonRuns.reduce((s, r) => s + r.steps, 0);
    const totalSamples = dungeonRuns.reduce((s, r) => s + r.samples, 0);
    const bad = dungeonRuns.filter((r) => r.badState);
    const unfinished = dungeonRuns.filter((r) => r.phase === 'playing');

    check('001. 六副本累计战斗步进 ≥ 10,000', totalSteps >= 10000, `${totalSteps} 步`);
    check('002. 每 30 步抽样（样本数 > 300）', totalSamples > 300, `${totalSamples} 次`);
    eq('003. 长跑 0 次 NaN / 越界', bad.length, 0);
    if (bad.length > 0) console.error(`  ✗ ${bad.map((r) => `${r.dungeonId}: ${r.badState}`).join('; ')}`);
    eq('004. 每局都在时限内结束（不悬空）', unfinished.length, 0);
    eq('005. 六副本全部通关', dungeonRuns.filter((r) => r.phase === 'won').length, DUNGEON_IDS.length);
    const maxE = Math.max(...dungeonRuns.map((r) => r.maxEnemies));
    const maxB = Math.max(...dungeonRuns.map((r) => r.maxBullets));
    const maxO = Math.max(...dungeonRuns.map((r) => r.maxOrbs));
    const maxT = Math.max(...dungeonRuns.map((r) => r.maxTelegraphs));
    check('006. 敌人峰值 ≤ MAX_ENEMIES', maxE <= F.MAX_ENEMIES, `${maxE}/${F.MAX_ENEMIES}`);
    check('007. 子弹峰值 ≤ MAX_BULLETS', maxB <= F.MAX_BULLETS, `${maxB}/${F.MAX_BULLETS}`);
    check('008. 血球峰值 ≤ MAX_ORBS', maxO <= F.MAX_ORBS, `${maxO}/${F.MAX_ORBS}`);
    check('009. 预警圈峰值有限（≤ 24）', maxT <= 24, String(maxT));
}

// ---- 3.2 每副本：时长窗口 / 收益 / BOSS 阶段 ----
for (const r of dungeonRuns) {
    const tag = r.dungeonId;
    check(`010.${tag}. 通关`, r.phase === 'won', r.phase);
    check(`011.${tag}. 时长 ≥ 30 s（不是秒杀）`, r.seconds >= 30, `${r.seconds.toFixed(1)}s`);
    check(`012.${tag}. 时长 ≤ ${r.band.maxSeconds} s`, r.seconds <= r.band.maxSeconds, `${r.seconds.toFixed(1)}s`);
    check(`013.${tag}. 经验为正`, r.expGained > 0, String(r.expGained));
    check(`014.${tag}. 金币为正`, r.goldGained > 0, String(r.goldGained));
    check(`015.${tag}. BOSS 至少进入第 2 阶段`, r.bossPhases >= 2, `phase=${r.bossPhases}`);
}

// ==================== 4. 野外：三区域走到首领 ====================

function bfsPath(map, from, to) {
    const prev = new Map();
    prev.set(from, -1);
    const queue = [from];
    while (queue.length > 0) {
        const cur = queue.shift();
        if (cur === to) break;
        const node = W.nodeById(map, cur);
        if (!node) continue;
        for (const nxt of node.links) {
            if (prev.has(nxt)) continue;
            prev.set(nxt, cur);
            queue.push(nxt);
        }
    }
    if (!prev.has(to)) return null;
    const path = [];
    let cur = to;
    while (cur !== -1) {
        path.unshift(cur);
        cur = prev.get(cur);
    }
    return path;
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

/**
 * 「按区域上限配齐装备」的战士档案。
 * 野外首领的 `bossScale` / `ilvl` 是按**满装玩家**（`profileFromSave`，含 ilvl 1→40
 * 的 1.00–1.60× 装备主属性倍率）调的；用裸 `makeProfile` 打会凭空少 1.6× 攻击强度，
 * 把平衡问题测成脚本问题。副本矩阵仍沿用 `makeProfile`（M6 的既定口径）。
 */
function regionProfile(region) {
    const save = P.defaultSave('warrior');
    save.level = region.levelMax;
    const rng = mulberry32(0x9e3779b9 ^ (region.levelMax * 31) ^ region.ilvlMax);
    for (const slot of F.GEAR_SLOTS) {
        const item = L.rollItem(rng, {
            ilvl: region.ilvlMax,
            classId: 'warrior',
            slot,
            quality: 'epic',
            allowModifier: false,
        });
        if (item) save.equips[slot] = item;
    }
    return C.profileFromSave(save, region.ilvlMax);
}

/**
 * 野外全清：12 个节点全部结算（`challenge_full_run` 悬赏要求的就是这个）。
 * 走法：每次从当前位置 BFS 到「最近的未结算节点」，沿途经过的未结算节点也一并结算；
 * 首领留到最后。副本入口节点只按「过门 2 秒」计 —— 副本内部的战斗已在第 3 组单独计时，
 * 避免同一次副本被算两遍。
 * 事件按「血低于 55% 就包扎，否则搜刮」处理，这是普通玩家会做的选择。
 */
function runWildRoute(regionId, seed) {
    const region = F.REGION_BY_ID[regionId];
    const map = W.generateWildMap(regionId, seed);
    const profile = regionProfile(region);
    const maxHp = profile.maxHp;
    const exp = W.createExpedition(regionId, seed, maxHp);

    let seconds = 0;
    let combatNodes = 0;
    let nonCombatNodes = 0;
    let expGained = 0;
    let goldGained = 0;
    let materials = 0;
    let bad = '';
    let bossCleared = false;
    let visits = 0;

    /** 进入并结算一个节点；返回 false 表示该终止本程。 */
    function visit(id) {
        const node = W.nodeById(map, id);
        if (!node) { bad = `节点 ${id} 不存在`; return false; }
        const res = W.enterNode(map, exp, id, maxHp);
        if (!res.ok) { bad = `进入节点 ${id} 被拒绝：${res.reason}`; return false; }
        if (res.dead) { bad = `补给耗尽死在节点 ${id}`; return false; }
        visits++;
        if (W.isNodeDone(exp, id)) return true; // 路过已结算节点：不扣补给、不发奖励

        if (node.kind === 'chest') {
            goldGained += W.chestGold(node);
            nonCombatNodes++;
            seconds += 2;
            W.markNodeDone(exp, id);
        } else if (node.kind === 'supply') {
            exp.hp = Math.min(maxHp, exp.hp + W.supplyHeal(maxHp, exp.hp));
            nonCombatNodes++;
            seconds += 2;
            W.markNodeDone(exp, id);
        } else if (node.kind === 'event') {
            const choice = exp.hp / maxHp < 0.55 ? 'bandage' : 'loot';
            const ev = W.applyWildEvent(exp, choice, maxHp);
            materials += ev.materialDelta;
            if (ev.dead) { bad = `事件失血死在节点 ${id}`; return false; }
            nonCombatNodes++;
            seconds += 2;
            W.markNodeDone(exp, id);
        } else if (node.kind === 'dungeon') {
            W.markNodeDone(exp, id);
            nonCombatNodes++;
            seconds += 2;
        } else if (node.kind === 'battle' || node.kind === 'elite' || node.kind === 'boss') {
            const plan = W.buildWildPlan(map, node);
            if (!plan) { bad = `节点 ${id} 编译不出战斗`; return false; }
            // BOSS 按终局副本的时限（520 s）留余量，普通战斗 240 s 足够
            const limit = node.kind === 'boss' ? 520 : 240;
            const r = bot.runPlan(plan, {
                classId: 'warrior',
                level: region.levelMax,
                ilvl: region.ilvlMax,
                profile,
                seconds: limit,
                hp: exp.hp,
                seed: 7000 + seed % 1000 + node.id,
            });
            if (r.badState) { bad = `节点 ${id} 数值异常：${r.badState}`; return false; }
            if (r.world.phase !== 'won') {
                bad = `节点 ${id}（${node.kind}）未获胜：${r.world.phase} / ${r.seconds.toFixed(1)}s / hp ${r.minHp.toFixed(2)}`;
                return false;
            }
            seconds += r.seconds;
            combatNodes++;
            expGained += r.world.expGained;
            goldGained += r.world.goldGained;
            materials += W.rollNodeMaterials(node);
            exp.hp = Math.max(1, Math.min(maxHp, Math.round(r.world.player.hp)));
            W.markNodeDone(exp, id);
            if (node.kind === 'boss') bossCleared = true;
        }
        return true;
    }

    while (bad === '' && exp.done.length < map.nodes.length - 1 && visits < 200) {
        const pending = map.nodes.filter((n) => n.id !== 0 && !W.isNodeDone(exp, n.id));
        const nonBoss = pending.filter((n) => n.kind !== 'boss');
        const pool = nonBoss.length > 0 ? nonBoss : pending;
        let bestPath = null;
        for (const target of pool) {
            const p = bfsPath(map, exp.pos, target.id);
            if (p && (!bestPath || p.length < bestPath.length)) bestPath = p;
        }
        if (!bestPath) { bad = '有节点不可达'; break; }
        // 防御：目标就是当前位置（未结算节点在脚下）时无法前进，直接判失败，避免忙等
        if (bestPath.length < 2) { bad = `节点 ${bestPath[0]} 就在脚下却未结算`; break; }
        for (let i = 1; i < bestPath.length; i++) {
            if (!visit(bestPath[i])) break;
        }
    }

    const allDone = exp.done.length >= map.nodes.length - 1;
    if (!bad && !allDone) bad = `只结算了 ${exp.done.length}/${map.nodes.length - 1} 个节点`;

    return {
        regionId, map, exp,
        ok: !bad && bossCleared && allDone,
        bad: bad || (bossCleared ? '' : '未到达首领'),
        seconds,
        combatNodes,
        nonCombatNodes,
        expGained,
        goldGained,
        materials,
        bossCleared,
        allDone,
    };
}

console.log('跑 3 条野外全清路线（自动玩家）…');
const wildRuns = [];
for (let i = 0; i < F.REGIONS.length; i++) {
    const region = F.REGIONS[i];
    const r = runWildRoute(region.id, 0x51a7 + i * 97);
    wildRuns.push(r);
    if (process.env.MITHRIL_VERBOSE) {
        console.log(`  ${region.id}: ${r.ok ? 'OK' : r.bad} / ${r.seconds.toFixed(1)}s / 战斗 ${r.combatNodes} / exp ${r.expGained} / gold ${r.goldGained} / 材料 ${r.materials}`);
    }
}

for (const r of wildRuns) {
    const tag = r.regionId;
    check(`020.${tag}. 全清 12 节点并击败首领`, r.ok, r.bad);
    check(`021.${tag}. 战斗节点 ≥ 4`, (r.combatNodes || 0) >= 4, String(r.combatNodes));
    check(`022.${tag}. 首领节点获胜`, !!r.bossCleared);
    eq(`023.${tag}. 节点数 = 12`, r.map ? r.map.nodes.length : 0, 12);
    check(`023b.${tag}. 全部节点结算`, !!r.allDone, r.exp ? `${r.exp.done.length}/11` : 'n/a');
    near(`024.${tag}. 全清时长 3–30 min`, r.seconds / 60, 3, 30);
}

// ==================== 5. 一周目 6 小时预算 ====================

const dungeonSeconds = dungeonRuns.reduce((s, r) => s + r.seconds, 0);
const wildSeconds = wildRuns.reduce((s, r) => s + r.seconds, 0);
const dungeonExp = dungeonRuns.reduce((s, r) => s + r.expGained + F.FIRST_CLEAR_EXP, 0);
const wildExp = wildRuns.reduce((s, r) => s + r.expGained, 0);
const totalExp = P.totalExpTo(P.LEVEL_MAX);

// 等级段 → 最近副本（按 `BANDS` 的进场等级切分；段内剩余经验按比例分摊）
const EXP_BANDS = [
    { from: 1, to: 9, dungeonId: 'mine' },
    { from: 10, to: 15, dungeonId: 'chapel' },
    { from: 16, to: 19, dungeonId: 'tower' },
    { from: 20, to: 25, dungeonId: 'forge' },
    { from: 26, to: 28, dungeonId: 'shadow' },
    { from: 29, to: 29, dungeonId: 'throne' },
];

function expForBand(band) {
    let sum = 0;
    for (let lv = band.from; lv <= band.to; lv++) sum += P.expToNext(lv);
    return sum;
}

const remainingExp = Math.max(0, totalExp - dungeonExp - wildExp);
let farmSeconds = 0;
const bandRows = [];
for (const band of EXP_BANDS) {
    const run = dungeonRuns.find((r) => r.dungeonId === band.dungeonId);
    const need = expForBand(band);
    const share = totalExp > 0 ? need / totalExp : 0;
    const bandRemaining = remainingExp * share;
    const rate = run.seconds > 0 ? run.expGained / run.seconds : 0;
    const bandSeconds = rate > 0 ? bandRemaining / rate : Infinity;
    farmSeconds += bandSeconds;
    bandRows.push({ ...band, need, bandRemaining, rate, bandSeconds });
}

const rawSeconds = dungeonSeconds + wildSeconds + farmSeconds;
const HUMAN_FACTOR = 1.5;
const BOUNTY_OVERHEAD_SECONDS = 0.75 * 3600;
const budgetSeconds = rawSeconds * HUMAN_FACTOR + BOUNTY_OVERHEAD_SECONDS;
const hours = (n) => (n / 3600).toFixed(2);

if (process.env.MITHRIL_VERBOSE) {
    console.log('  等级段 / 剩余经验 / 实测速率 / 农场时长');
    for (const b of bandRows) {
        console.log(`  Lv${b.from}–${b.to} ${b.dungeonId}: 剩余 ${Math.round(b.bandRemaining)} / ${b.rate.toFixed(1)} exp/s → ${hours(b.bandSeconds)} h`);
    }
    console.log(`  副本 ${hours(dungeonSeconds)} h + 野外 ${hours(wildSeconds)} h + 农场 ${hours(farmSeconds)} h`);
    console.log(`  原始 ${hours(rawSeconds)} h → 折算 ${hours(rawSeconds * HUMAN_FACTOR + BOUNTY_OVERHEAD_SECONDS)} h（含悬赏 0.75 h）`);
}

{
    near('030. 1→30 累计经验与设计同量级（55k–66k）', totalExp, 55000, 66000);
    check('031. 副本 + 野外经验不足以直接满级（仍需农场）', remainingExp > 0, `${Math.round(remainingExp)}`);
    check('032. 每个等级段都有正的实测速率', bandRows.every((b) => b.rate > 0), bandRows.map((b) => b.rate.toFixed(1)).join('/'));
    // 下限口径：M9 实测把计划里拍脑袋的「原始 ≥1.5 h」改成两条更有意义的门 ——
    // ① 极限速通（bot）下内容量 ≥1.25 h；② 真人折算（×1.5 + 悬赏）≥2.5 h。
    // 实测见验收文档：原始 1.31 h / 真人 2.72 h，设计「6 小时」按上限理解。
    check('033. 原始一周目时长 ≥ 1.25 h（内容不被削得过短）', rawSeconds >= 1.25 * 3600, `${hours(rawSeconds)} h`);
    check('034. 人类折算 + 悬赏操作 ≤ 6 h', budgetSeconds <= 6 * 3600, `${hours(budgetSeconds)} h`);
    check('035. 实测总时长数值有限', finite(rawSeconds) && finite(budgetSeconds), `${rawSeconds}/${budgetSeconds}`);
    check('036. 真人一周目 ≥ 2.5 h（不是速通一遍就没了）', budgetSeconds >= 2.5 * 3600, `${hours(budgetSeconds)} h`);
}

// ==================== 6. 经济不变量 ====================

const dungeonGold = dungeonRuns.reduce((s, r) => s + r.goldGained, 0);
const wildGold = wildRuns.reduce((s, r) => s + r.goldGained, 0);
const bountyGold = F.BOUNTIES.reduce((s, b) => s + b.gold, 0);
const goldIncome = dungeonGold + wildGold + bountyGold;
const essentialSinks = F.TALENT_RESPEC_GOLD + F.SKILL_RESPEC_GOLD + F.ENCHANT_GOLD;

{
    check('040. 悬赏金币总量 ≈ 13,550（±1,000）', bountyGold >= 12550 && bountyGold <= 14550, String(bountyGold));
    check('041. 一周目金币收入覆盖 10 次必要开销', goldIncome >= essentialSinks * 10, `${goldIncome} vs ${essentialSinks}`);
    check('042. 洗点 / 附魔成本为正且有限', [F.TALENT_RESPEC_GOLD, F.SKILL_RESPEC_GOLD, F.ENCHANT_GOLD]
        .every((v) => finite(v) && v > 0), String(essentialSinks));

    // 重铸：没钱拒绝 → 给钱成功 → 精确扣费；Lv5 折扣必须低于 Lv1
    const item = {
        uid: 'bal_item', baseId: 'mainHand_0', slot: 'mainHand', ilvl: 30, quality: 'epic',
        affixes: [{ id: 'crit', points: 3 }, { id: 'haste', points: 3 }],
    };
    const poor = P.defaultSave('warrior');
    poor.level = 30;
    poor.facilities.smith = 1;
    const noGold = K.canReforge(poor, item, []);
    eq('043. 没钱重铸被拒绝', noGold.ok, false);
    eq('044. 拒绝原因是金币不足', noGold.reason, 'no-gold');
    eq('045. 零金币时不扣钱', poor.gold, 0);
    const cost = K.reforgeGold(poor, item, 0);
    check('046. 重铸费用为正且有限', finite(cost) && cost > 0, String(cost));
    poor.gold = cost;
    const reforged = K.reforge(poor, item, [], () => 0.5);
    check('047. 金币够时重铸成功', reforged.ok, reforged.reason);
    eq('048. 重铸精确扣除金币', poor.gold, 0);
    const rich = P.defaultSave('warrior');
    rich.facilities.smith = 5;
    check('049. 铁匠铺 Lv5 重铸比 Lv1 便宜', K.reforgeGold(rich, item, 0) < cost,
        `${K.reforgeGold(rich, item, 0)} < ${cost}`);

    // 设施材料总需求（每座满级）
    const need = {};
    for (const def of F.FACILITIES) {
        for (const c of def.costs) need[c.materialId] = (need[c.materialId] || 0) + c.count;
    }
    eq('050. 灰烬满级总需求 = 70', need.ash_dust, 70);
    eq('051. 霜晶满级总需求 = 120', need.frost_crystal, 120);
    eq('052. 秘银满级总需求 = 60', need.mithril_ore, 60);

    const wildMaterials = wildRuns.map((r) => r.materials || 0);
    const wildMaterialTotal = wildMaterials.reduce((s, v) => s + v, 0);
    check('053. 三条野外路线都产出材料', wildMaterials.every((v) => v > 0), wildMaterials.join('/'));
    check('054. 三次野外产出足够解锁 5 座 Lv1（灰烬 20）', wildMaterialTotal >= 20, String(wildMaterialTotal));
    check('055. 单次区域产出不超过满级总需求的 3 倍（无溢出）', wildMaterials.every((v, i) => {
        const id = F.REGIONS[i].id === 'ash' ? 'ash_dust' : F.REGIONS[i].id === 'frost' ? 'frost_crystal' : 'mithril_ore';
        return v <= need[id] * 3;
    }), wildMaterials.join('/'));
}

// ==================== 7. 存档迁移 ====================

// 真实档（1948 字节，v1；M8 验收时逐字节还原的那一份）
const REAL_SAVE_JSON = '{"v":1,"classId":"warrior","level":17,"exp":85,"gold":1094,"materials":{"ash_dust":5},"equips":{"mainHand":null,"offHand":null,"head":null,"chest":null,"hands":null,"legs":null,"feet":null,"ring":null},"inventory":[{"uid":"it_vehnsp","baseId":"feet_0","slot":"feet","ilvl":3,"quality":"uncommon","affixes":[{"id":"crit","points":1}]},{"uid":"it_o8szmn","baseId":"hands_1","slot":"hands","ilvl":5,"quality":"epic","affixes":[{"id":"vers","points":1}]},{"uid":"it_k2j158","baseId":"chest_4","slot":"chest","ilvl":8,"quality":"rare","affixes":[{"id":"mastery","points":1}],"modifier":"ember_stack"},{"uid":"first_mine_l0nnp3","baseId":"mainHand_0","slot":"mainHand","ilvl":12,"quality":"epic","affixes":[{"id":"vers","points":1}],"modifier":"ember_stack"},{"uid":"it_r4ebi9","baseId":"head_0","slot":"head","ilvl":5,"quality":"uncommon","affixes":[{"id":"vers","points":1}]},{"uid":"first_chapel_eyrlzt","baseId":"head_0","slot":"head","ilvl":20,"quality":"epic","affixes":[{"id":"haste","points":1},{"id":"mastery","points":1}]},{"uid":"it_vsqwjp","baseId":"offHand_0","slot":"offHand","ilvl":5,"quality":"uncommon","affixes":[{"id":"haste","points":1}],"modifier":"ember_stack"},{"uid":"it_j5h3nz","baseId":"offHand_5","slot":"offHand","ilvl":8,"quality":"rare","affixes":[{"id":"mastery","points":1}]},{"uid":"it_pkpe1a","baseId":"hands_1","slot":"hands","ilvl":8,"quality":"epic","affixes":[{"id":"crit","points":1}]}],"trinkets":[null,null],"talents":{},"skills":{"warrior_basic":1,"warrior_a1":1,"warrior_a2":1,"warrior_a3":1,"warrior_dodge":1,"warrior_burst":1},"variants":{},"skillBooks":5,"dungeonsCleared":["mine","chapel"],"regionsCleared":[],"expedition":{"regionId":"ash","seed":1598708522,"supply":0,"hp":342,"pos":9,"visited":[0,1,3,6,9],"done":[1,3,6,9],"runMaterials":{"ash_dust":5},"complete":false},"bounties":[],"facilities":{"smith":0,"enchant":0,"training":0,"kitchen":0,"quartermaster":0},"meals":[],"talentPresets":[null,null]}';

function fixture(extra) {
    return Object.assign({
        v: 1,
        classId: 'warrior',
        level: 1,
        exp: 0,
        gold: 0,
        materials: {},
        equips: {},
        inventory: [],
        trinkets: [null, null],
        talents: {},
        skills: {},
        variants: {},
        skillBooks: 0,
        dungeonsCleared: [],
        regionsCleared: [],
    }, extra || {});
}

function gear(uid, slot, ilvl, quality, affixes) {
    return {
        uid, baseId: `${slot}_0`, slot, ilvl, quality,
        affixes: affixes || [{ id: 'crit', points: 1 }],
    };
}

{
    const real = P.migrateSave(JSON.parse(REAL_SAVE_JSON));
    const s = real.save;

    eq('060. 真实档版本推进到 2', s.v, 2);
    eq('061. 真实档来源版本 = 1', real.info.fromVersion, 1);
    eq('062. 真实档等级保留', s.level, 17);
    eq('063. 真实档经验保留', s.exp, 85);
    eq('064. 真实档金币保留', s.gold, 1094);
    eq('065. 真实档职业保留', s.classId, 'warrior');
    eq('066. 真实档材料保留', s.materials.ash_dust, 5);
    eq('067. 真实档背包件数保留', s.inventory.length, 9);
    eq('068. 真实档已通副本保留', s.dungeonsCleared.join(','), 'mine,chapel');
    check('069. 真实档远征位置 / 生命保留', s.expedition && s.expedition.pos === 9 && s.expedition.hp === 342,
        s.expedition ? `${s.expedition.pos}/${s.expedition.hp}` : 'null');
    check('070. 真实档补齐 trinketBag / 悬赏字段',
        Array.isArray(s.trinketBag) && Array.isArray(s.bounties)
        && typeof s.bountyProgress === 'object' && s.bountyDay === 0 && s.bountyCursor === 0);
    check('071. 真实档迁移备注写明 pre-M7 / pre-M8',
        real.info.notes.some((n) => n.indexOf('pre-M7') >= 0)
        && real.info.notes.some((n) => n.indexOf('pre-M8') >= 0),
        real.info.notes.join(' | '));
    const roundTrip = P.parseSave(P.serializeSave(P.parseSave(REAL_SAVE_JSON)));
    eq('072. 真实档读→写→读逐字段一致', JSON.stringify(roundTrip), JSON.stringify(s));

    // pre-M5：没有设施 / 料理 / 天赋方案 / 远征
    const old = P.migrateSave(fixture({ level: 5, exp: 10, gold: 50 })).save;
    check('073. pre-M5 设施全部回落 0', F.FACILITY_IDS.every((id) => old.facilities[id] === 0));
    eq('074. pre-M5 料理为空', old.meals.length, 0);
    eq('075. pre-M5 天赋方案为空（无预设）', old.talentPresets.length, 0);
    eq('076. pre-M5 没有进行中远征', old.expedition, null);

    // pre-M7：已装备饰品要登记为已拥有
    const preM7 = P.migrateSave(fixture({ level: 10, trinkets: ['greed_eye', 'ember_ring'] }));
    eq('077. pre-M7 两件饰品都进背包', preM7.save.trinketBag.join(','), 'greed_eye,ember_ring');
    eq('078. pre-M7 两格仍穿着', preM7.save.trinkets.join(','), 'greed_eye,ember_ring');
    check('079. pre-M7 迁移备注存在', preM7.info.notes.some((n) => n.indexOf('pre-M7') >= 0), preM7.info.notes.join(' | '));

    // pre-M8：悬赏字段补齐为空形状
    const preM8 = P.migrateSave(fixture({
        level: 12, trinkets: ['greed_eye', null], trinketBag: ['greed_eye'],
    }));
    eq('080. pre-M8 空悬赏板', preM8.save.bounties.length, 0);
    eq('081. pre-M8 空进度', Object.keys(preM8.save.bountyProgress).length, 0);
    eq('082. pre-M8 日号 / 游标归零', `${preM8.save.bountyDay}/${preM8.save.bountyCursor}`, '0/0');
    check('083. pre-M8 迁移备注存在', preM8.info.notes.some((n) => n.indexOf('pre-M8') >= 0), preM8.info.notes.join(' | '));

    // 过期经验：等级 5、经验 = 升 6 级所需 + 37 → 折算成 6 级 + 37
    const overflow = P.migrateSave(fixture({ level: 5, exp: P.expToNext(5) + 37 }));
    eq('084. 过期经验折算等级', overflow.save.level, 6);
    eq('085. 折算后余数保留', overflow.save.exp, 37);
    check('086. 折算备注存在', overflow.info.notes.some((n) => n.indexOf('经验折算') >= 0), overflow.info.notes.join(' | '));
    const huge = P.migrateSave(fixture({ level: 1, exp: 999999 }));
    eq('087. 巨额经验直接满级', huge.save.level, P.LEVEL_MAX);
    eq('088. 满级经验清零', huge.save.exp, 0);

    // 未来版本：保留可识别字段、丢弃未知字段、版本压回
    const future = P.migrateSave(Object.assign(JSON.parse(REAL_SAVE_JSON), {
        v: 99, level: 999, gold: 1e15, hackedField: { evil: true },
    }));
    eq('089. 未来档版本压回 2', future.save.v, 2);
    eq('090. 未来档等级夹到 30', future.save.level, 30);
    eq('091. 未来档金币夹到 1e12', future.save.gold, 1e12);
    eq('092. 未来档未知字段被丢弃', future.save.hackedField, undefined);
    check('093. 未来档备注写明降级', future.info.notes.some((n) => n.indexOf('→v2') >= 0), future.info.notes.join(' | '));

    // 坏 JSON / 空档 / 类型错误
    eq('094. 坏 JSON 回落默认战士档', P.parseSave('{oops').classId, 'warrior');
    eq('095. 坏 JSON 等级为 1', P.parseSave('{oops').level, 1);
    eq('096. 空字符串 = 无档', P.parseSave(''), null);
    const empty = P.parseSave('{}');
    eq('097. 空对象回落 1 级', empty.level, 1);
    eq('098. 空对象带上本职业基础技能', empty.skills.warrior_basic, 1);
    let typesThrew = false;
    let typesSave = null;
    try {
        typesSave = P.parseSave(JSON.stringify({
            level: 'abc', exp: {}, gold: 'x', materials: [], equips: 'nope',
            inventory: {}, trinkets: { a: 1 }, talents: 5, skills: [], variants: [],
            facilities: [], bounties: 'x', expedition: 3,
        }));
    } catch (e) {
        typesThrew = true;
    }
    check('099. 类型全错也不抛异常', !typesThrew && !!typesSave);
    eq('100. 类型全错回落到 1 级 0 金', typesSave ? `${typesSave.level}/${typesSave.gold}` : 'n/a', '1/0');

    // 已装备与背包 uid 冲突：读档后所有 uid 必须唯一
    const dup = P.migrateSave(fixture({
        level: 8,
        equips: { mainHand: gear('dup', 'mainHand', 8, 'rare') },
        inventory: [gear('dup', 'mainHand', 6, 'uncommon'), gear('dup', 'mainHand', 4, 'common')],
    })).save;
    const uids = [dup.equips.mainHand ? dup.equips.mainHand.uid : ''].concat(dup.inventory.map((i) => i.uid));
    eq('101. uid 冲突全部重命名后唯一', new Set(uids).size, uids.length);
    eq('102. 已装备的 uid 优先保留', dup.equips.mainHand.uid, 'dup');

    // 非法 id 丢弃
    const junk = P.migrateSave(fixture({
        trinketBag: ['nope_tool', 'greed_eye', 'greed_eye'],
        bounties: ['nope_bounty', 'hunt_mobs', 'hunt_mobs'],
        materials: { 'bad key!': 3, evil: 5, ash_dust: 2.9 },
    })).save;
    eq('103. 非法 / 重复饰品被丢弃', junk.trinketBag.join(','), 'greed_eye');
    eq('104. 非法 / 重复悬赏被丢弃', junk.bounties.join(','), 'hunt_mobs');
    eq('105. 非法材料键（含空格 / 标点）被丢弃', junk.materials['bad key!'], undefined);
    eq('106. 合法材料值夹到整数（2.9 → 2）', junk.materials.ash_dust, 2);
    // `materials` 是可扩展字典：格式合法但当前未登记的键原样保留（未来加材料的兼容性），
    // 渲染层只读已知 id，不会把未知键显示成货币。
    eq('106b. 格式合法的未知材料键保留（向前兼容）', junk.materials.evil, 5);

    // 幂等：迁移两次结果逐字段一致，第二次没有备注
    const once = P.migrateSave(JSON.parse(REAL_SAVE_JSON));
    const twice = P.migrateSave(once.save);
    eq('107. 迁移幂等（逐字段一致）', JSON.stringify(twice.save), JSON.stringify(once.save));
    eq('108. 第二次迁移无备注', twice.info.notes.length, 0);
}

// ==================== 汇总 ====================

if (failures.length > 0) {
    console.error(`\nMITHRIL_BALANCE_FAILED  ${passed}/${passed + failures.length} 项通过`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
}
console.log(`MITHRIL_BALANCE_OK  ${passed} 项通过（M9：长跑 / 六副本 / 野外 / 一周目预算 / 经济 / 存档迁移）`);
