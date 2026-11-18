#!/usr/bin/env node
/**
 * 《秘银远征》新档可胜性闸门（台账 N149 / round28 独立复核条件 C3）。
 *
 * 为什么需要它：`verify-mithril-wild.js` 只锁「层 1 首战没有远程」的**构成**，
 * 锁不住「构成对了、数值又成墙」。round28 的 N144（首战远程墙）就是从这个缺口漏出去的：
 * 构成检查全绿，但新档站桩必死。
 *
 * 口径（各区首节点 = `layer === 1` 的战斗节点；按区域进入等级 + 区域最低装等**裸装**）：
 *  A. 教学区 ash：4 职业 × 3 seed，**会走位、不放技能**必须全胜（≤ 90 s，最低血量 ≥ 10%）。
 *  B. 三区域：4 职业 × 3 seed，**带技能**的正式机器人必须全胜（≤ 180 s）。
 *  C. N144 回归锁：ash 战士**站桩**（不移动、不放技能、只按普攻）必须 3/3 胜（≤ 90 s）。
 *  D. 非回归锁：霜牙 / 深渊的「不放技能」胜场不得低于当前基线（11/12、9/12）——
 *     这是**防退化**，不是「要求无技能必须赢」。战士不带技能打深渊首节点全灭是已知设计张力
 *     （远程职业靠风筝能赢），见台账 N149；把它改好这里会自然通过（只拦下降）。
 *  E. N147 回归锁：**废弃矿坑副本**、真实 Lv8 档（3 槽 / ilvl 3.67 / maxHp 256 / 入场 hp185 = 72%）、
 *     分析师口径的「追着目标走、只普攻」（chase：弧内 100、普攻 128、不躲不滚不捡球），
 *     6 seed 必须 ≥ 5 胜。round29 把矿坑首领 `troll.hp` 3000 → 1800 就是为了翻这堵墙；
 *     回退到 3000 时 6 seed **全灭**（首领剩 47%），所以这道闸是真有牙齿的。
 *     已知近失：seed 2468 在 1800 下首领剩 2% 阵亡（minHp 0.01）——它计入 5/6 的下限，
 *     不为了凑 6/6 去挑 seed。
 *
 * 用法：node tools/verify-mithril-newplayer.js
 * 通过时打印 MITHRIL_NEWPLAYER_OK；失败逐条打印并以退出码 1 结束。
 * 调参时 `MITHRIL_VERBOSE=1` 打印每场读数。
 *
 * `--self-test`：只在内存里还原两处旧构成（层 1 第三波远程墙 + troll.hp 3000），
 * 期望 C 段与 E 段同时变红；两段都红才算「闸门有牙齿」。
 *
 * 组内确定性：种子固定（9001 / 4242 / 7007 / 1337 / 5150 / 2468），世界种子由节点种子派生（^ 0x9e37），
 * 副本段直接用传入 seed；因此同一份代码每次读数完全一致，可直接当回归基线。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, runTsc } = require('./lib/core-compile');

const SRC_DIR = path.join(ROOT, 'assets', 'games', 'game_mithril', 'scripts');
const OUT = path.join(ROOT, 'temp', 'mithril-newplayer-test');

// ---------- 编译纯逻辑模块 ----------
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`编译纯逻辑模块 → ${path.relative(ROOT, OUT)}`);
runTsc([
    path.join(SRC_DIR, 'MithrilConfig.ts'),
    path.join(SRC_DIR, 'MithrilProgress.ts'),
    path.join(SRC_DIR, 'MithrilCore.ts'),
    path.join(SRC_DIR, 'MithrilLoot.ts'),
    path.join(SRC_DIR, 'MithrilTalents.ts'),
    path.join(SRC_DIR, 'MithrilWild.ts'),
    '--outDir', OUT,
    '--rootDir', SRC_DIR,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
]);

const F = require(path.join(OUT, 'MithrilConfig.js'));
const P = require(path.join(OUT, 'MithrilProgress.js'));
const C = require(path.join(OUT, 'MithrilCore.js'));
const W = require(path.join(OUT, 'MithrilWild.js'));
const bot = require(path.join(ROOT, 'tools', 'lib', 'mithril-bot.js')).createBot(F, C);

// ---------- --self-test：证明这道闸真有牙齿 ----------
// 只在内存里 monkey-patch 编译产物（不改仓库代码），同时还原两处旧状态：
//  ① 层 1 第三波还原成 N144 之前的构成（远程 ×2 + 近战 ×2 + 近战 ×1）→ 期望 C 段变红；
//  ② 矿坑首领 troll.hp 改回 3000（N147 之前）→ 期望 E 段变红。
// round29 实测：旧构成下站桩 0/3；troll 3000 时副本段 0/6（首领剩 47%）。
const SELF_TEST = process.argv.includes('--self-test');
if (SELF_TEST) {
    const origBuild = W.buildWildPlan;
    W.buildWildPlan = function patchedBuildWildPlan(map, node) {
        const plan = origBuild(map, node);
        if (!plan || !node || node.kind !== 'battle' || node.layer !== 1) return plan;
        const last = plan.encounters[plan.encounters.length - 1];
        const pool = F.REGION_ENEMY_POOLS[map.regionId];
        const mobs = pool ? pool.mobs : null;
        if (!last || !last.spawns || last.spawns.length !== 2 || !mobs) return plan;
        const ranged = mobs.find((id) => F.ENEMY_BY_ID[id] && F.ENEMY_BY_ID[id].kind === 'ranged');
        const melee = mobs.filter((id) => F.ENEMY_BY_ID[id] && F.ENEMY_BY_ID[id].kind !== 'ranged');
        if (ranged && melee.length >= 2) {
            last.spawns = [
                { enemyId: ranged, count: 2 },
                { enemyId: melee[1], count: 2 },
                { enemyId: melee[0], count: 1 },
            ];
        }
        return plan;
    };
    if (F.ENEMY_BY_ID && F.ENEMY_BY_ID.troll) F.ENEMY_BY_ID.troll.hp = 3000;
    console.log('（--self-test：已还原层 1 第三波旧构成 + troll.hp 3000，预期 C 段与 E 段变红）');
}

const CLASS_IDS = ['warrior', 'mage', 'ranger', 'priest'];
const SEEDS = [9001, 4242, 7007];
// E 段（副本）比首节点宽：加 3 个 seed 覆盖「追着打」模型的方差。
const MINE_SEEDS = [...SEEDS, 1337, 5150, 2468];
const MINE_GATE_MIN_WINS = 5;
const BOT_LIMIT = 180;
const ASH_NO_SKILL_LIMIT = 90;
const STAND_LIMIT = 90;
// 非回归锁的当前基线（round29 实测；只能上调，不能下调）
const NO_SKILL_BASELINE = { frost: 11, abyss: 9 };

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

/** 站桩：不移动、不放技能，只按住普攻（朝最近敌人） */
function makeStand(reach) {
    return function standInput(world) {
        const p = world.player;
        if (world.phase !== 'playing') return { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
        let target = null;
        let best = Infinity;
        for (const e of world.enemies) {
            const d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d < best) {
                best = d;
                target = e;
            }
        }
        let aimX = 0;
        let aimY = 0;
        if (target && best > 0) {
            aimX = (target.x - p.x) / best;
            aimY = (target.y - p.y) / best;
        }
        return {
            moveX: 0, moveY: 0, aimX, aimY,
            basic: best < reach,
            skill1: false, skill2: false, skill3: false, burst: false, dodge: false,
        };
    };
}

/** 会走位（与正式机器人同款 16 方向采样）、但一个技能都不放 */
function noSkillInput(world) {
    const inp = bot.botInput(world);
    return {
        moveX: inp.moveX, moveY: inp.moveY, aimX: inp.aimX, aimY: inp.aimY,
        basic: inp.basic,
        skill1: false, skill2: false, skill3: false, burst: false, dodge: false,
    };
}

function firstIntroNode(map) {
    return map.nodes.find((n) => n.kind === 'battle' && n.layer === 1) || null;
}

/**
 * 打一场首节点战斗。
 * `mode`: 'stand' | 'noSkill' | 'bot'。
 * 战斗中升级按真实路径入账（kill 事件的经验 → P.addExp → world.setProfile），
 * 所以这里模拟的是「新档打第一场、边打边长」的真实曲线。
 */
function fight(region, classId, seed, mode) {
    const kit = F.CLASS_KITS[classId];
    const reach = kit.basic.range || kit.basic.radius || 130;
    const inputFor = mode === 'stand' ? makeStand(reach)
        : mode === 'noSkill' ? noSkillInput
            : bot.botInput;
    const save = P.defaultSave(classId);
    save.level = region.levelMin;
    save.exp = 0;
    const profile = () => C.makeProfile(classId, save.level, region.ilvlMin);
    const map = W.generateWildMap(region.id, seed);
    const node = firstIntroNode(map);
    if (!node) throw new Error(`${region.id} 图里没有 layer=1 的战斗节点`);
    const plan = W.buildWildPlan(map, node);
    const runSeed = ((node.seed ^ 0x9e37) >>> 0);
    const world = new C.MithrilWorld(profile(), runSeed, null);
    world.startWild(plan, world.player.maxHp);
    // 只区分「站桩」和「其它」：站桩 90 s 是 N144 的判据，其余一律给 180 s 上限。
    // 不要按 noSkill 收窄到 90 s —— 霜牙 / 深渊首节点无技能合法要打 82–153 s，
    // A 段的 ≤ 90 s 由断言单独把关（round29 踩过一次：收窄后 D 段读出 frost 2/12、abyss 0/12 的假红）。
    const limit = mode === 'stand' ? STAND_LIMIT : BOT_LIMIT;
    const maxSteps = Math.round(limit / F.FIXED_DT);
    let steps = 0;
    let minHp = 1;
    let pendingExp = 0;
    while (world.phase === 'playing' && steps < maxSteps) {
        world.step(F.FIXED_DT, inputFor(world));
        for (const ev of world.drainEvents()) {
            if (ev.type === 'kill') pendingExp += ev.exp || 0;
        }
        if (pendingExp > 0) {
            const lv = P.addExp(save, Math.floor(pendingExp));
            pendingExp = 0;
            if (lv > 0) world.setProfile(profile());
        }
        steps++;
        if (steps % 30 === 0) minHp = Math.min(minHp, world.player.hp / world.player.maxHp);
    }
    return {
        region: region.id,
        classId,
        seed,
        mode,
        level: region.levelMin,
        ilvl: region.ilvlMin,
        nodeLevel: node.level,
        nodeIlvl: node.ilvl,
        phase: world.phase,
        seconds: +(steps * F.FIXED_DT).toFixed(1),
        minHp: +minHp.toFixed(3),
        kills: world.kills,
    };
}

function label(r) {
    return `[${r.region}/${r.classId}/${r.seed}/${r.mode}]`;
}

function reportRow(r) {
    return `${r.region.padEnd(5)} ${r.classId.padEnd(7)} ${String(r.seed).padEnd(4)} Lv${String(r.nodeLevel).padEnd(2)}/ilvl${String(r.nodeIlvl).padEnd(2)} `
        + `${r.phase.padEnd(4)} ${String(r.seconds).padStart(6)} s  minHp ${r.minHp.toFixed(3)}`;
}

// ==================== A. 教学区：不放技能必须全胜 ====================
if (!SELF_TEST) {
    console.log('\nA. 教学区（ash）首节点 · 会走位 / 不放技能');
    const ashRows = [];
    for (const classId of CLASS_IDS) {
        for (const seed of SEEDS) ashRows.push(fight(F.REGIONS[0], classId, seed, 'noSkill'));
    }
    if (process.env.MITHRIL_VERBOSE) for (const r of ashRows) console.log('    ' + reportRow(r));
    for (const r of ashRows) {
        check(`A ${label(r)} 取胜`, r.phase === 'won', `${r.phase} @ ${r.seconds}s minHp ${r.minHp}`);
        check(`A ${label(r)} ≤ ${ASH_NO_SKILL_LIMIT} s`, r.seconds <= ASH_NO_SKILL_LIMIT, `${r.seconds}s`);
        check(`A ${label(r)} 最低血量 ≥ 10%`, r.minHp >= 0.1, r.minHp.toFixed(3));
    }
    const wins = ashRows.filter((r) => r.phase === 'won').length;
    const slowest = Math.max(...ashRows.map((r) => r.seconds));
    const worst = Math.min(...ashRows.map((r) => r.minHp));
    console.log(`  ash: ${wins}/${ashRows.length} 胜，最慢 ${slowest} s，最低血量 ${worst.toFixed(3)}`);
}

// ==================== B. 三区域：带技能必须全胜 ====================
if (!SELF_TEST) {
    console.log('\nB. 三区域首节点 · 带技能（正式机器人）');
    const botRows = [];
    for (const region of F.REGIONS) {
        for (const classId of CLASS_IDS) {
            for (const seed of SEEDS) botRows.push(fight(region, classId, seed, 'bot'));
        }
    }
    if (process.env.MITHRIL_VERBOSE) for (const r of botRows) console.log('    ' + reportRow(r));
    for (const r of botRows) {
        check(`B ${label(r)} 取胜`, r.phase === 'won', `${r.phase} @ ${r.seconds}s minHp ${r.minHp}`);
        check(`B ${label(r)} ≤ ${BOT_LIMIT} s`, r.seconds <= BOT_LIMIT, `${r.seconds}s`);
    }
    for (const region of F.REGIONS) {
        const rows = botRows.filter((r) => r.region === region.id);
        const worst = Math.min(...rows.map((r) => r.minHp));
        const slowest = Math.max(...rows.map((r) => r.seconds));
        console.log(`  ${region.id}: ${rows.filter((r) => r.phase === 'won').length}/${rows.length} 胜，最慢 ${slowest} s，最低血量 ${worst.toFixed(3)}`);
    }
}

// ==================== C. N144 回归锁：ash 战士站桩 ====================
console.log('\nC. N144 回归锁 · ash 战士站桩只按普攻');
const standRows = [];
for (const seed of SEEDS) standRows.push(fight(F.REGIONS[0], 'warrior', seed, 'stand'));
if (process.env.MITHRIL_VERBOSE) for (const r of standRows) console.log('    ' + reportRow(r));
const standWins = standRows.filter((r) => r.phase === 'won').length;
if (SELF_TEST) {
    // 自测口径反过来：旧构成下必须至少输一场，否则说明这道闸拦不住 N144。
    check('self-test 旧构成下站桩必须变红', standWins < standRows.length, `${standWins}/${standRows.length} 胜`);
} else {
    for (const r of standRows) {
        check(`C ${label(r)} 站桩取胜`, r.phase === 'won', `${r.phase} @ ${r.seconds}s minHp ${r.minHp}`);
        check(`C ${label(r)} ≤ ${STAND_LIMIT} s`, r.seconds <= STAND_LIMIT, `${r.seconds}s`);
    }
}
console.log(`  ash/战士站桩: ${standWins}/${standRows.length} 胜，最慢 ${Math.max(...standRows.map((r) => r.seconds))} s`);

// ==================== D. 非回归锁：霜牙 / 深渊的「不放技能」胜场 ====================
if (!SELF_TEST) {
    console.log('\nD. 非回归锁 · 霜牙 / 深渊首节点不放技能的胜场（防守，不是要求）');
    for (const region of [F.REGIONS[1], F.REGIONS[2]]) {
        const rows = [];
        for (const classId of CLASS_IDS) {
            for (const seed of SEEDS) rows.push(fight(region, classId, seed, 'noSkill'));
        }
        const wins = rows.filter((r) => r.phase === 'won').length;
        const baseline = NO_SKILL_BASELINE[region.id];
        const worst = Math.min(...rows.map((r) => r.minHp));
        console.log(`  ${region.id}: ${wins}/${rows.length} 胜（基线 ${baseline}/${rows.length}），最低血量 ${worst.toFixed(3)}`);
        if (process.env.MITHRIL_VERBOSE) for (const r of rows) console.log('    ' + reportRow(r));
        check(`D ${region.id} 不放技能胜场 ≥ 基线 ${baseline}`, wins >= baseline, `${wins}/${rows.length}`);
    }
}

// ==================== E. N147 回归锁：矿坑副本 · 真实 Lv8 档 · 不放技能 ====================
// 口径与 round29 数值分析师逐字同款（chase：弧内 100、普攻 128、aim 交给引擎、不躲不滚不捡球）。
// 档位取自 30 分钟曲线 noskill seed 9001 的副本入场快照：Lv8 / 3 槽 / ilvl3.67 / maxHp 256 / hp185。
// 用「合成存档」而不是外部快照文件：只保留 ilvl 与单条词条，读数与快照档逐位相同（round29 实测）。
function mineGateChaseInput(world) {
    const p = world.player;
    if (world.phase !== 'playing') return { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
    let target = null;
    let best = Infinity;
    for (const e of world.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        const score = d * (e.kind === 'wraith' ? 0.8 : 1);
        if (score < best) { best = score; target = e; }
    }
    if (!target) return { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.hypot(dx, dy) || 1;
    const inArc = dist < 100;
    return {
        moveX: inArc ? 0 : dx / dist,
        moveY: inArc ? 0 : dy / dist,
        aimX: 0, aimY: 0,
        basic: dist < 128,
        skill1: false, skill2: false, skill3: false, burst: false, dodge: false,
    };
}

function mineGateSave() {
    const save = P.defaultSave('warrior');
    save.level = 8;
    save.exp = 0;
    save.equips = {
        offHand: { ilvl: 5, affixes: [{ id: 'vers', points: 1 }] },
        chest: { ilvl: 3, affixes: [{ id: 'mastery', points: 1 }] },
        feet: { ilvl: 3, affixes: [{ id: 'vers', points: 1 }] },
    };
    return save;
}

console.log('\nE. N147 回归锁 · 矿坑副本 Lv8/3 槽/ilvl3.67 不放技能');
const minePlan = F.dungeonRunPlan('mine');
if (!minePlan) {
    check('E 矿坑副本计划存在', false, 'dungeonRunPlan(mine) 返回空');
} else {
    const mineRows = [];
    for (const seed of MINE_SEEDS) {
        const save = mineGateSave();
        const res = bot.runPlan(minePlan, {
            classId: 'warrior',
            level: save.level,
            ilvl: 3.67,
            seconds: 260,
            seed,
            hp: 185,
            profile: C.profileFromSave(save, F.COMBAT_ILVL_FLOOR),
            input: mineGateChaseInput,
        });
        mineRows.push({
            seed,
            phase: res.world.phase,
            seconds: +res.seconds.toFixed(1),
            minHp: res.minHp,
            bossPct: res.world.boss ? res.world.boss.hp / res.world.boss.maxHp : 0,
        });
    }
    if (process.env.MITHRIL_VERBOSE) {
        for (const r of mineRows) {
            console.log(`    seed ${r.seed}: ${r.phase} ${r.seconds} s minHp ${r.minHp.toFixed(3)}`
                + `${r.phase === 'won' ? '' : ` boss ${(r.bossPct * 100).toFixed(0)}%`}`);
        }
    }
    const mineWins = mineRows.filter((r) => r.phase === 'won').length;
    if (SELF_TEST) {
        // 自测口径反过来：troll.hp 3000（N147 之前）下必须跌破下限，否则说明这道闸拦不住回退。
        check('self-test troll 3000 下矿坑副本必须变红', mineWins < MINE_GATE_MIN_WINS,
            `${mineWins}/${mineRows.length} 胜`);
    } else {
        check(`E 矿坑副本 · 不放技能胜场 ≥ ${MINE_GATE_MIN_WINS}/${mineRows.length}`,
            mineWins >= MINE_GATE_MIN_WINS, `${mineWins}/${mineRows.length}`);
        // 逐 seed 只查「跑完了」：近失（seed 2468 首领剩 2%）是已知读数，计入 5/6 下限，
        // 不按单场判红 —— 否则等于要求 6/6，会把已知近失变成永久红。
        for (const r of mineRows) {
            check(`E [mine/seed ${r.seed}] 跑完（未卡超时）`, r.phase !== 'playing',
                `${r.phase} @ ${r.seconds}s minHp ${r.minHp.toFixed(3)} boss ${(r.bossPct * 100).toFixed(0)}%`);
        }
    }
    const worstWin = Math.min(...mineRows.filter((r) => r.phase === 'won').map((r) => r.minHp));
    console.log(`  mine: ${mineWins}/${mineRows.length} 胜（下限 ${MINE_GATE_MIN_WINS}），`
        + `最慢 ${Math.max(...mineRows.map((r) => r.seconds))} s，胜局最低血量 ${Number.isFinite(worstWin) ? worstWin.toFixed(3) : '-'}`);
}

// ==================== 汇总 ====================
const tag = SELF_TEST ? 'MITHRIL_NEWPLAYER_SELFTEST' : 'MITHRIL_NEWPLAYER';
const total = passed + failures.length;
if (failures.length) {
    console.error(`\n${tag}_FAIL —— ${failures.length}/${total} 项失败`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
}
console.log(`\n${tag}_OK —— ${passed} 项检查全部通过`);
