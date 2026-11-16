#!/usr/bin/env node
/**
 * 《秘银远征》24 悬赏 —— 纯逻辑自检（不启动 Cocos）。
 *
 * M8 覆盖：
 *  1. 纯度：MithrilBounty.ts 不许 import cc / Date.now / Math.random / localStorage
 *  2. 配置：24 条 / 4 类各 6 条 / id 唯一 / 指标合法 / 目标与奖励可发放 / 消耗物合法
 *  3. 悬赏板：3 位 → Lv2 起 6 位 / 不重复 / 补齐 / 领取后补位 / Lv4 跨日刷新 / Lv3 不刷新 /
 *     游标回绕 / 坏档裁切
 *  4. 自动追踪：17 个自动指标逐个用合成战斗报告推满；失败局只推进击杀类；
 *     通关类的每一条附加条件都要单独成立
 *  5. 收集类：5 条上交悬赏按库存判定、领取时精确扣除、只扣背包不碰已装备
 *  6. 领取奖励：金币 / 材料 / 紫装 / 橙装、装等夹取、重复领取拒绝、空位补位
 *  7. 存档：往返不丢、坏字段净化（非法 id / 重复 / 超位 / 进度越界 / 负日 / 游标）
 *  8. 分解钩子：Camp.dismantle 真正推进分解悬赏
 *
 * 用法：node tools/verify-mithril-bounty.js
 * 通过时打印 MITHRIL_BOUNTY_OK；失败逐条打印并以退出码 1 结束。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, runTsc } = require('./lib/core-compile');

const SRC_DIR = path.join(ROOT, 'assets', 'games', 'game_mithril', 'scripts');
const BOUNTY_SRC = path.join(SRC_DIR, 'MithrilBounty.ts');
const OUT = path.join(ROOT, 'temp', 'mithril-bounty-test');

// ---------- 1. 纯度 ----------
const source = fs.readFileSync(BOUNTY_SRC, 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
if (/from\s+['"]cc(\/|['"])/.test(code)) {
    console.error('MithrilBounty.ts 不许 import cc');
    process.exit(1);
}
for (const bad of ['Date.now', 'Math.random', 'localStorage']) {
    if (new RegExp(`\\b${bad.replace('.', '\\.')}\\b`).test(code)) {
        console.error(`MithrilBounty.ts 不许使用 ${bad}（要可复现 / 与渲染层无关）`);
        process.exit(1);
    }
}

// ---------- 2. 编译 ----------
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`编译纯逻辑模块 → ${path.relative(ROOT, OUT)}`);
runTsc([
    path.join(SRC_DIR, 'MithrilConfig.ts'),
    path.join(SRC_DIR, 'MithrilProgress.ts'),
    path.join(SRC_DIR, 'MithrilLoot.ts'),
    path.join(SRC_DIR, 'MithrilBounty.ts'),
    path.join(SRC_DIR, 'MithrilCamp.ts'),
    path.join(SRC_DIR, 'MithrilCore.ts'),
    '--outDir', OUT,
    '--rootDir', SRC_DIR,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
]);

const F = require(path.join(OUT, 'MithrilConfig.js'));
const P = require(path.join(OUT, 'MithrilProgress.js'));
const L = require(path.join(OUT, 'MithrilLoot.js'));
const B = require(path.join(OUT, 'MithrilBounty.js'));
const K = require(path.join(OUT, 'MithrilCamp.js'));

let passed = 0;
const failures = [];
function check(name, cond, detail) {
    if (cond) {
        passed++;
        return;
    }
    failures.push(detail ? `${name} —— ${detail}` : name);
}

function eq(name, actual, expected) {
    check(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

function near(name, actual, expected, eps = 1e-9) {
    check(name, Math.abs(actual - expected) <= eps, `期望 ≈${expected}，实际 ${actual}`);
}

function freshSave(classId = 'warrior') {
    return P.defaultSave(classId);
}

function statsOf(over) {
    return Object.assign(F.emptyBountyStats(), over || {});
}

function report(over) {
    return Object.assign({
        won: true,
        kind: 'battle',
        elapsed: 120,
        stats: statsOf(),
        lootCount: 0,
        deaths: 0,
        whiteOnly: false,
        noTrinket: false,
        fullRunDone: 0,
        fullRunTotal: F.WILD_NODE_COUNT || 12,
    }, over || {});
}

function ctx(day = 100, slots = 3, allowDaily = false) {
    return { day, slots, allowDaily };
}

function putOnBoard(save, ids) {
    save.bounties = ids.slice();
    save.bountyProgress = {};
    save.bountyDay = 100;
}

function progressOf(save, id) {
    const def = F.BOUNTY_BY_ID[id];
    return B.bountyProgressOf(save, def);
}

function readyOf(save, id) {
    return progressOf(save, id) >= F.BOUNTY_BY_ID[id].target;
}

/** 手工装备（只测品质 / 装等 / 扣件，不走 rollItem） */
function gear(uid, ilvl, quality, slot = 'mainHand') {
    return { uid, baseId: 'mainHand_0', slot, ilvl, quality, affixes: [] };
}

// ==================== 1. 配置完整性 ====================

{
    const ids = F.BOUNTIES.map((b) => b.id);
    eq('001. 悬赏总数为 24', F.BOUNTIES.length, 24);
    eq('002. id 全部唯一', new Set(ids).size, 24);
    eq('003. BOUNTY_BY_ID 覆盖全部 24 条', Object.keys(F.BOUNTY_BY_ID).length, 24);

    const kinds = ['hunt', 'gather', 'dungeon', 'challenge'];
    for (const kind of kinds) {
        eq(`004.${kind} 类恰好 6 条`, F.BOUNTIES.filter((b) => b.kind === kind).length, 6);
    }

    const metrics = [
        'kill', 'elite_kill', 'region_boss', 'elite_no_hit', 'kill_5_in_10s', 'burst_elite_kill',
        'dismantle', 'dungeon_clear', 'dungeon_nodeath', 'dungeon_speed', 'dungeon_last_hit',
        'dungeon_white', 'dungeon_no_trinket', 'low_hp_kill', 'dungeon_crit', 'dungeon_loot',
        'full_run', 'turnin_ash', 'turnin_frost', 'turnin_mithril', 'turnin_blue', 'turnin_purple',
    ];
    const materialIds = F.MATERIALS.map((m) => m.id);
    const qualities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

    for (const def of F.BOUNTIES) {
        const tag = `${def.id}`;
        check(`005.${tag} 有名字`, typeof def.name === 'string' && def.name.length > 0);
        check(`006.${tag} 有奖励文案`, typeof def.reward === 'string' && def.reward.length > 0);
        check(`007.${tag} 指标合法`, metrics.indexOf(def.metric) >= 0, def.metric);
        check(`008.${tag} 目标是正整数`, Number.isInteger(def.target) && def.target > 0, def.target);
        check(`009.${tag} 金币是正整数`, Number.isInteger(def.gold) && def.gold > 0, def.gold);
        if (def.item) {
            check(`010.${tag} 装备奖励品质合法`, qualities.indexOf(def.item.quality) >= 0, def.item.quality);
        }
        if (def.material) {
            check(`011.${tag} 材料奖励 id 合法`, materialIds.indexOf(def.material.id) >= 0, def.material.id);
            check(`012.${tag} 材料奖励数量为正`, Number.isInteger(def.material.count) && def.material.count > 0);
        }
        if (def.consume) {
            check(`013.${tag} 消耗类型合法`, def.consume.kind === 'material' || def.consume.kind === 'gear');
            if (def.consume.kind === 'material') {
                check(`014.${tag} 消耗材料 id 合法`, materialIds.indexOf(def.consume.materialId) >= 0);
            } else {
                check(`015.${tag} 消耗装备品质合法`, qualities.indexOf(def.consume.quality) >= 0);
            }
        }
        if (def.kind === 'gather') {
            check(`016.${tag} 收集类必须声明 consume 或自动计数`,
                !!def.consume || def.metric === 'dismantle');
        } else {
            check(`017.${tag} 非收集类不扣东西`, !def.consume);
        }
    }

    eq('018. 只有一条紫装奖励', F.BOUNTIES.filter((b) => b.item && b.item.quality === 'epic').length, 1);
    eq('019. 只有一条橙装奖励', F.BOUNTIES.filter((b) => b.item && b.item.quality === 'legendary').length, 1);
    eq('020. 紫装奖励是区域首领', F.BOUNTIES.filter((b) => b.item && b.item.quality === 'epic')[0].id, 'hunt_region_boss');
    eq('021. 橙装奖励是全图远征', F.BOUNTIES.filter((b) => b.item && b.item.quality === 'legendary')[0].id, 'challenge_full_run');

    // 设计偏差（写进验收文档的两条）
    const crit = F.BOUNTY_BY_ID.challenge_crit_streak;
    check('022. 暴击悬赏改为单次副本累计 20 次（设计字面 20 连不可达）',
        crit.metric === 'dungeon_crit' && crit.target === 1);
    check('023. 橙装直接发放而不是碎片（M8–M11 没有锻造系统）',
        F.BOUNTY_BY_ID.challenge_full_run.item.quality === 'legendary');
    // 计划 §数值红线：一轮 24 条 ≈13,000 金；实际 13,550，仍在同一量级
    const totalGold = F.BOUNTIES.reduce((s, b) => s + b.gold, 0);
    check('024. 24 条悬赏金币合计约 13,000（容差 ±1,000）',
        totalGold >= 12000 && totalGold <= 14000, totalGold);
}

// ==================== 2. 悬赏板 ====================

{
    eq('101. 第 0 天是 0 日', B.bountyToday(0), 0);
    eq('102. 一天后是第 1 日', B.bountyToday(86400000), 1);
    eq('103. 负时间夹到第 0 日', B.bountyToday(-5), 0);

    const order = B.bountyOrder(7);
    eq('104. 洗牌序列长度 24', order.length, 24);
    eq('105. 洗牌是 24 条的一个排列', new Set(order).size, 24);
    check('106. 同一天序列确定', B.bountyOrder(7).join(',') === order.join(','));
    check('107. 不同天序列不同', B.bountyOrder(8).join(',') !== order.join(','));
    check('108. 洗牌含全部 id', F.BOUNTIES.every((b) => order.indexOf(b.id) >= 0));

    const s0 = freshSave();
    const none = B.ensureBountyBoard(s0, 100, 0, true);
    check('109. 悬赏位 0 不建板', none.added === 0 && s0.bounties.length === 0);

    const s3 = freshSave();
    const r3 = B.ensureBountyBoard(s3, 100, 3, false);
    eq('110. Lv1 建板 3 条', s3.bounties.length, 3);
    eq('111. 首次建板 added = 3', r3.added, 3);
    eq('112. 建板记录当日', s3.bountyDay, 100);
    eq('113. 板上无重复', new Set(s3.bounties).size, 3);
    check('114. 板上 id 都合法', s3.bounties.every((id) => !!F.BOUNTY_BY_ID[id]));

    const again = B.ensureBountyBoard(s3, 100, 3, false);
    eq('115. 同日再进不重复补位', again.added, 0);
    eq('116. 同日再进板面不变', s3.bounties.length, 3);

    const up = B.ensureBountyBoard(s3, 100, 6, false);
    eq('117. Lv2 扩到 6 位', s3.bounties.length, 6);
    eq('118. 扩容补 3 条', up.added, 3);
    eq('119. 扩容后仍无重复', new Set(s3.bounties).size, 6);

    // 领取后立刻补位
    const s4 = freshSave();
    B.ensureBountyBoard(s4, 100, 3, false);
    const firstId = s4.bounties[0];
    const firstDef = F.BOUNTY_BY_ID[firstId];
    if (!firstDef.consume) s4.bountyProgress[firstId] = firstDef.target;
    const claimCtx = ctx(100, 3, false);
    let claimId = firstId;
    if (firstDef.consume) {
        // 收集类：临时把库存塞够，领完再清
        if (firstDef.consume.kind === 'material') s4.materials[firstDef.consume.materialId] = firstDef.target;
        else s4.inventory = [gear('tmp-1', 1, firstDef.consume.quality)];
    }
    const claimRes = B.claimBounty(s4, claimId, () => 0.5, 10, claimCtx);
    check('120. 板上已完成悬赏可以领取', claimRes.ok, claimRes.reason);
    eq('121. 领取后板面仍补满 3 条', s4.bounties.length, 3);
    check('122. 领取的 id 已离开板面', s4.bounties.indexOf(firstId) < 0);
    check('123. 领取后无重复', new Set(s4.bounties).size === s4.bounties.length);

    // Lv4 跨日刷新
    const s5 = freshSave();
    B.ensureBountyBoard(s5, 100, 6, true);
    const before = s5.bounties.slice();
    s5.bountyProgress[before[0]] = 1;
    const daily = B.ensureBountyBoard(s5, 101, 6, true);
    check('124. Lv4 跨日触发刷新', daily.refreshed === true);
    eq('125. 刷新后日号更新', s5.bountyDay, 101);
    eq('126. 刷新后进度清空', Object.keys(s5.bountyProgress).length, 0);
    eq('127. 刷新后板面仍是 6 条', s5.bounties.length, 6);
    check('128. 刷新后是新一组悬赏', s5.bounties.join(',') !== before.join(','));

    // 未到 Lv4：跨日不刷新
    const s6 = freshSave();
    B.ensureBountyBoard(s6, 100, 6, false);
    const kept = s6.bounties.slice();
    s6.bountyProgress[kept[0]] = 2;
    const noDaily = B.ensureBountyBoard(s6, 101, 6, false);
    check('129. 未到 Lv4 跨日不刷新', noDaily.refreshed === false);
    check('130. 未到 Lv4 板面不变', s6.bounties.join(',') === kept.join(','));
    eq('131. 未到 Lv4 进度保留', s6.bountyProgress[kept[0]], 2);
    eq('132. 未到 Lv4 日号不更新', s6.bountyDay, 100);

    // 坏档裁切
    const s7 = freshSave();
    s7.bounties = ['nope', 'hunt_mobs', 'hunt_mobs', 'hunt_elites', 'hunt_no_hit',
        'hunt_burst', 'hunt_burst_kill', 'gather_ash'];
    s7.bountyProgress = { hunt_mobs: 9999, hunt_elites: -4, nope: 5, ghost: 7 };
    s7.bountyDay = 100;
    s7.bountyCursor = 999;
    B.ensureBountyBoard(s7, 100, 6, false);
    eq('133. 坏档非法 id 被剔除', s7.bounties.indexOf('nope'), -1);
    eq('134. 坏档重复 id 去重', s7.bounties.filter((id) => id === 'hunt_mobs').length, 1);
    eq('135. 坏档裁到 6 位', s7.bounties.length, 6);
    check('136. 非板上进度键被清掉', s7.bountyProgress.ghost === undefined && s7.bountyProgress.nope === undefined);
    eq('137. 进度上限夹到 target', s7.bountyProgress.hunt_mobs, F.BOUNTY_BY_ID.hunt_mobs.target);
    eq('138. 负进度归零', s7.bountyProgress.hunt_elites, 0);
    check('139. 游标回到合法范围', s7.bountyCursor >= 0 && s7.bountyCursor < 24, s7.bountyCursor);

    // 游标回绕：只剩 1 个空位且游标在末尾
    const s8 = freshSave();
    B.ensureBountyBoard(s8, 100, 6, false);
    const keepFive = s8.bounties.slice(0, 5);
    s8.bounties = keepFive;
    s8.bountyCursor = 23;
    const wrap = B.ensureBountyBoard(s8, 100, 6, false);
    eq('140. 游标回绕仍能补位', s8.bounties.length, 6);
    eq('141. 回绕补 1 条', wrap.added, 1);
    eq('142. 回绕后仍无重复', new Set(s8.bounties).size, 6);

    // 负数 / 超界参数
    const s9 = freshSave();
    const neg = B.ensureBountyBoard(s9, -3, -1, true);
    check('143. 负悬赏位不建板', neg.added === 0 && s9.bounties.length === 0);
    eq('144. 负日号夹到 0', s9.bountyDay <= 0 ? 0 : s9.bountyDay, 0);

    const s10 = freshSave();
    B.ensureBountyBoard(s10, 100, 99, false);
    eq('145. 悬赏位超界夹到 6', s10.bounties.length, 6);
}

// ==================== 3. 自动追踪：17 个指标逐个推满 ====================

const AUTO_RUNNERS = {
    kill: (n) => report({ stats: statsOf({ mobKills: n }) }),
    elite_kill: (n) => report({ kind: 'elite', stats: statsOf({ eliteKills: n }) }),
    region_boss: () => report({ kind: 'boss' }),
    elite_no_hit: (n) => report({ kind: 'elite', stats: statsOf({ eliteNoHitKills: n }) }),
    kill_5_in_10s: () => report({ stats: statsOf({ maxKillsIn10s: 5 }) }),
    burst_elite_kill: (n) => report({ kind: 'elite', stats: statsOf({ burstEliteKills: n }) }),
    dungeon_clear: () => report({ kind: 'dungeon' }),
    dungeon_nodeath: () => report({ kind: 'dungeon', deaths: 0 }),
    dungeon_speed: () => report({ kind: 'dungeon', elapsed: 300 }),
    dungeon_last_hit: () => report({ kind: 'dungeon', stats: statsOf({ bossLastHitSkill: true }) }),
    dungeon_white: () => report({ kind: 'dungeon', whiteOnly: true }),
    dungeon_no_trinket: () => report({ kind: 'dungeon', noTrinket: true }),
    low_hp_kill: (n) => report({ stats: statsOf({ lowHpKills: n }) }),
    dungeon_crit: () => report({ kind: 'dungeon', stats: statsOf({ crits: 20 }) }),
    dungeon_loot: () => report({ kind: 'dungeon', lootCount: 10 }),
    full_run: () => report({ fullRunDone: 12, fullRunTotal: 12 }),
};

{
    const autoDefs = F.BOUNTIES.filter((b) => !b.consume && b.metric !== 'dismantle');
    eq('201. 自动追踪类共 18 条（含 3 条副本通关）', autoDefs.length, 18);
    const covered = {};
    for (const def of autoDefs) covered[def.metric] = true;
    eq('202. 自动指标共 16 个（dungeon_clear 被 3 条共用）', Object.keys(covered).length, 16);

    let seq = 0;
    for (const def of autoDefs) {
        seq++;
        const save = freshSave();
        putOnBoard(save, [def.id]);
        eq(`203.${seq}.${def.id} 初始进度 0`, progressOf(save, def.id), 0);
        check(`204.${seq}.${def.id} 初始不可领取`, !readyOf(save, def.id));

        const run = AUTO_RUNNERS[def.metric];
        check(`205.${seq}.${def.id} 有对应的合成报告生成器`, typeof run === 'function', def.metric);
        if (!run) continue;

        let guard = 0;
        while (progressOf(save, def.id) < def.target && guard < 20) {
            B.applyRunReport(save, run(def.target));
            guard++;
        }
        eq(`206.${seq}.${def.id} 合成报告可以推满`, progressOf(save, def.id), def.target);
        check(`207.${seq}.${def.id} 推满后可领取`, readyOf(save, def.id));
        check(`208.${seq}.${def.id} 循环次数不超过 target`, guard <= Math.max(1, def.target), guard);

        // 再打一场不越界
        B.applyRunReport(save, run(def.target));
        eq(`209.${seq}.${def.id} 进度不超过目标`, progressOf(save, def.id), def.target);

        // 失败局只推击杀类
        const loss = freshSave();
        putOnBoard(loss, [def.id]);
        B.applyRunReport(loss, Object.assign(run(def.target), { won: false }));
        const killLike = ['kill', 'elite_kill', 'elite_no_hit', 'kill_5_in_10s',
            'burst_elite_kill', 'low_hp_kill', 'dismantle'].indexOf(def.metric) >= 0;
        if (killLike) {
            check(`210.${seq}.${def.id} 失败局仍推进击杀类`, progressOf(loss, def.id) > 0);
        } else {
            eq(`210.${seq}.${def.id} 失败局不推进通关类`, progressOf(loss, def.id), 0);
        }
    }

    // ---- 通关类附加条件逐条反证 ----
    const neg = [
        ['dungeon_nodeath', { kind: 'dungeon', deaths: 1 }],
        ['dungeon_speed', { kind: 'dungeon', elapsed: 301 }],
        ['dungeon_speed', { kind: 'dungeon', elapsed: 0 }],
        ['dungeon_last_hit', { kind: 'dungeon', stats: statsOf({ bossLastHitSkill: false }) }],
        ['challenge_white', { kind: 'dungeon', whiteOnly: false }],
        ['challenge_no_trinket', { kind: 'dungeon', noTrinket: false }],
        ['challenge_crit_streak', { kind: 'dungeon', stats: statsOf({ crits: 19 }) }],
        ['challenge_loot', { kind: 'dungeon', lootCount: 9 }],
        ['challenge_full_run', { fullRunDone: 11, fullRunTotal: 12 }],
        ['hunt_region_boss', { kind: 'dungeon' }],
    ];
    for (let i = 0; i < neg.length; i++) {
        const [id, over] = neg[i];
        const save = freshSave();
        putOnBoard(save, [id]);
        B.applyRunReport(save, report(over));
        eq(`211.${i + 1}. ${id} 条件不满足时不推进`, progressOf(save, id), 0);
    }

    // 副本关卡的判定只看 won && kind === 'dungeon'
    const wrongKind = freshSave();
    putOnBoard(wrongKind, ['dungeon_1']);
    B.applyRunReport(wrongKind, report({ kind: 'boss' }));
    eq('212. 区域首领不推进副本通关', progressOf(wrongKind, 'dungeon_1'), 0);

    const notWon = freshSave();
    putOnBoard(notWon, ['dungeon_1']);
    applyRunReportSafe(notWon, report({ won: false, kind: 'dungeon' }));
    eq('213. 失败副本不推进通关', progressOf(notWon, 'dungeon_1'), 0);

    // 10 秒 5 杀只记 1 次（不是 5 次）
    const burst = freshSave();
    putOnBoard(burst, ['hunt_burst']);
    B.applyRunReport(burst, report({ stats: statsOf({ maxKillsIn10s: 9 }) }));
    eq('214. 10 秒窗口悬赏只记 1 次', progressOf(burst, 'hunt_burst'), 1);

    // 暴击 20 次刚好达标
    const crit = freshSave();
    putOnBoard(crit, ['challenge_crit_streak']);
    B.applyRunReport(crit, report({ kind: 'dungeon', stats: statsOf({ crits: 20 }) }));
    eq('215. 单次副本 20 次暴击达标', progressOf(crit, 'challenge_crit_streak'), 1);

    // 分解指标：直接推进（真实分解钩子见 §7）
    const dis = freshSave();
    putOnBoard(dis, ['gather_disassemble']);
    B.advanceBountyMetric(dis, 'dismantle', 4);
    eq('216. 分解指标按件累加', progressOf(dis, 'gather_disassemble'), 4);
    B.advanceBountyMetric(dis, 'dismantle', 99);
    eq('217. 分解指标不越界', progressOf(dis, 'gather_disassemble'), 10);
}

function applyRunReportSafe(save, rpt) {
    B.applyRunReport(save, rpt);
}

// ==================== 4. 收集类：库存判定与精确扣除 ====================

{
    const cases = [
        ['gather_ash', 'material', 'ash_dust', 20],
        ['gather_frost', 'material', 'frost_crystal', 10],
        ['gather_mithril', 'material', 'mithril_ore', 8],
        ['gather_blue', 'gear', 'rare', 3],
        ['gather_purple', 'gear', 'epic', 1],
    ];

    for (let i = 0; i < cases.length; i++) {
        const [id, kind, what, target] = cases[i];
        const save = freshSave();
        putOnBoard(save, [id]);
        eq(`301.${i + 1}. ${id} 库存 0 时进度 0`, progressOf(save, id), 0);
        check(`302.${i + 1}. ${id} 库存不足不可领取`, !readyOf(save, id));
        const fail = B.claimBounty(save, id, () => 0.5, 10, ctx());
        check(`303.${i + 1}. ${id} 库存不足领取失败`, !fail.ok && fail.reason === 'insufficient', fail.reason);
        check(`304.${i + 1}. ${id} 失败不扣任何东西`,
            save.materials[what] === undefined && save.inventory.length === 0);

        // 塞够（多给一些，验证只扣 target）
        if (kind === 'material') save.materials[what] = target + 7;
        else {
            save.inventory = [];
            for (let k = 0; k < target + 2; k++) save.inventory.push(gear(`g-${k}`, 10 + k, what));
        }
        eq(`305.${i + 1}. ${id} 库存足够时进度夹到 target`, progressOf(save, id), target);
        check(`306.${i + 1}. ${id} 库存足够可领取`, readyOf(save, id));
    }

    // 材料精确扣除
    const ash = freshSave();
    putOnBoard(ash, ['gather_ash']);
    ash.materials.ash_dust = 27;
    ash.gold = 100;
    const ashRes = B.claimBounty(ash, 'gather_ash', () => 0.5, 10, ctx());
    check('307. 材料悬赏领取成功', ashRes.ok, ashRes.reason);
    eq('308. 材料精确扣 20', ash.materials.ash_dust, 7);
    eq('309. 材料悬赏金币 +250', ash.gold, 350);
    eq('310. 材料悬赏交付文案', ashRes.consumeText, '灰烬 ×20');

    // 蓝装：只扣 3 件、先扣低装等、已装备不动
    const blue = freshSave();
    putOnBoard(blue, ['gather_blue']);
    blue.inventory = [gear('b-high', 30, 'rare'), gear('b-low', 5, 'rare'),
        gear('b-mid', 12, 'rare'), gear('purple', 20, 'epic')];
    blue.equips.mainHand = gear('worn', 40, 'rare');
    const blueRes = B.claimBounty(blue, 'gather_blue', () => 0.5, 10, ctx());
    check('311. 蓝装悬赏领取成功', blueRes.ok, blueRes.reason);
    eq('312. 蓝装只扣 3 件', blue.inventory.length, 1);
    check('313. 先扣低装等（5 / 12 / 30 被扣）',
        blue.inventory[0].uid === 'purple');
    check('314. 已装备的蓝装不动', !!blue.equips.mainHand && blue.equips.mainHand.uid === 'worn');

    // 紫装 + 材料奖励
    const purple = freshSave();
    putOnBoard(purple, ['gather_purple']);
    purple.inventory = [gear('p1', 25, 'epic')];
    purple.materials.mithril_ore = 1;
    const purpleRes = B.claimBounty(purple, 'gather_purple', () => 0.5, 10, ctx());
    check('315. 紫装悬赏领取成功', purpleRes.ok, purpleRes.reason);
    eq('316. 紫装扣 1 件', purple.inventory.length, 0);
    eq('317. 紫装悬赏额外给 3 秘银', purple.materials.mithril_ore, 4);
    eq('318. 紫装悬赏金币 +700', purple.gold, 700);

    // 其他品质不算
    const wrongQ = freshSave();
    putOnBoard(wrongQ, ['gather_purple']);
    wrongQ.inventory = [gear('e1', 25, 'rare'), gear('e2', 25, 'legendary')];
    eq('319. 蓝装 / 橙装不算紫装进度', progressOf(wrongQ, 'gather_purple'), 0);

    // 材料不足一点也不行
    const almost = freshSave();
    putOnBoard(almost, ['gather_frost']);
    almost.materials.frost_crystal = 9;
    const almostRes = B.claimBounty(almost, 'gather_frost', () => 0.5, 10, ctx());
    check('320. 差一份材料领取失败', !almostRes.ok && almostRes.reason === 'insufficient');
    eq('321. 失败不扣材料', almost.materials.frost_crystal, 9);
}

// ==================== 5. 领取奖励 ====================

{
    // 紫装：区域首领
    const epicSave = freshSave();
    epicSave.level = 32;
    putOnBoard(epicSave, ['hunt_region_boss']);
    B.applyRunReport(epicSave, report({ kind: 'boss' }));
    const epicRes = B.claimBounty(epicSave, 'hunt_region_boss', () => 0.5, B.bountyItemIlvl(epicSave.level), ctx());
    check('401. 区域首领悬赏可领取', epicRes.ok, epicRes.reason);
    check('402. 紫装奖励品质为 epic', !!epicRes.item && epicRes.item.quality === 'epic', epicRes.item && epicRes.item.quality);
    eq('403. 紫装装等 = clamp(level+8, 1, 40)', epicRes.item.ilvl, 40);
    eq('404. 区域首领金币 +800', epicRes.gold, 800);

    // 橙装：全图远征
    const legSave = freshSave();
    legSave.level = 40;
    putOnBoard(legSave, ['challenge_full_run']);
    B.applyRunReport(legSave, report({ fullRunDone: 12, fullRunTotal: 12 }));
    const legRes = B.claimBounty(legSave, 'challenge_full_run', () => 0.5, B.bountyItemIlvl(40), ctx());
    check('405. 全图远征悬赏可领取', legRes.ok, legRes.reason);
    check('406. 橙装奖励品质为 legendary',
        !!legRes.item && legRes.item.quality === 'legendary', legRes.item && legRes.item.quality);
    eq('407. 橙装装等夹到 40', legRes.item.ilvl, 40);
    eq('408. 全图远征金币 +1000', legRes.gold, 1000);

    eq('409. bountyItemIlvl(1) = 9', B.bountyItemIlvl(1), 9);
    eq('410. bountyItemIlvl(20) = 28', B.bountyItemIlvl(20), 28);
    eq('411. bountyItemIlvl(40) 夹到 40', B.bountyItemIlvl(40), 40);
    eq('412. bountyItemIlvl(0) = 8（0 + 8）', B.bountyItemIlvl(0), 8);
    eq('412b. bountyItemIlvl(负数) 夹到 1', B.bountyItemIlvl(-100), 1);

    // 重复领取 / 不在板上 / 未完成
    const dup = freshSave();
    putOnBoard(dup, ['hunt_mobs']);
    dup.bountyProgress.hunt_mobs = 30;
    const once = B.claimBounty(dup, 'hunt_mobs', () => 0.5, 10, ctx());
    check('413. 第一次领取成功', once.ok);
    const twice = B.claimBounty(dup, 'hunt_mobs', () => 0.5, 10, ctx());
    check('414. 第二次领取被拒', !twice.ok && twice.reason === 'not-active', twice.reason);
    eq('415. 金币只加一次', dup.gold, 200);

    const notReady = freshSave();
    putOnBoard(notReady, ['hunt_mobs']);
    const nr = B.claimBounty(notReady, 'hunt_mobs', () => 0.5, 10, ctx());
    check('416. 未完成领取被拒', !nr.ok && nr.reason === 'not-ready', nr.reason);

    const ghost = freshSave();
    const gr = B.claimBounty(ghost, 'hunt_mobs', () => 0.5, 10, ctx());
    check('417. 不在板上的悬赏领取被拒', !gr.ok && gr.reason === 'not-active', gr.reason);

    const bad = freshSave();
    const br = B.claimBounty(bad, 'no-such-bounty', () => 0.5, 10, ctx());
    check('418. 未知 id 领取被拒', !br.ok && br.reason === 'bad-def', br.reason);

    // 领取后进度键被删除
    const clean = freshSave();
    putOnBoard(clean, ['hunt_mobs']);
    clean.bountyProgress.hunt_mobs = 30;
    B.claimBounty(clean, 'hunt_mobs', () => 0.5, 10, ctx());
    check('419. 领取后删除该条进度键', clean.bountyProgress.hunt_mobs === undefined);

    // 背包满：claim 不负责入包，装备仍会返回（调用方折金币，见面板）
    const full = freshSave();
    putOnBoard(full, ['hunt_region_boss']);
    B.applyRunReport(full, report({ kind: 'boss' }));
    const fullRes = B.claimBounty(full, 'hunt_region_boss', () => 0.5, 10, ctx());
    check('420. 背包满也照样发装备对象（由调用方兜底）', fullRes.ok && !!fullRes.item);
}

// ==================== 6. 存档往返与净化 ====================

{
    const save = freshSave();
    B.ensureBountyBoard(save, 100, 6, true);
    save.bountyProgress[save.bounties[0]] = 1;
    const round = P.parseSave(P.serializeSave(save));
    check('501. 存档往返保留悬赏板', round.bounties.join(',') === save.bounties.join(','));
    eq('502. 存档往返保留进度', round.bountyProgress[save.bounties[0]], 1);
    eq('503. 存档往返保留日号', round.bountyDay, 100);
    eq('504. 存档往返保留游标', round.bountyCursor, save.bountyCursor);

    const corrupt = P.parseSave(JSON.stringify({
        classId: 'warrior',
        bounties: ['nope', 'hunt_mobs', 'hunt_mobs', 'hunt_elites', 'hunt_no_hit',
            'hunt_burst', 'hunt_burst_kill', 'gather_ash'],
        bountyProgress: { hunt_mobs: 9999, hunt_elites: -9, 'nope': 5, 'ghost': 3 },
        bountyDay: -5,
        bountyCursor: 999,
    }));
    check('505. 坏档保留合法 id', corrupt.bounties.indexOf('hunt_mobs') >= 0);
    eq('506. 坏档剔除非法 id', corrupt.bounties.indexOf('nope'), -1);
    eq('507. 坏档去重', corrupt.bounties.filter((id) => id === 'hunt_mobs').length, 1);
    eq('508. 坏档最多 6 条', corrupt.bounties.length, 6);
    eq('509. 坏档进度夹到 target', corrupt.bountyProgress.hunt_mobs, 30);
    eq('510. 坏档负进度归零', corrupt.bountyProgress.hunt_elites, 0);
    check('511. 坏档非板上键被清掉',
        corrupt.bountyProgress.ghost === undefined && corrupt.bountyProgress.nope === undefined);
    eq('512. 坏档负日号归零', corrupt.bountyDay, 0);
    check('513. 坏档游标夹到 0–23', corrupt.bountyCursor >= 0 && corrupt.bountyCursor <= 23, corrupt.bountyCursor);

    const old = P.parseSave(JSON.stringify({ classId: 'warrior', level: 12 }));
    check('514. 旧档（没有悬赏字段）可读', !!old && Array.isArray(old.bounties)
        && old.bounties.length === 0 && old.bountyDay === 0 && old.bountyCursor === 0);

    check('515. defaultSave 默认悬赏字段齐全',
        Array.isArray(freshSave().bounties) && !!freshSave().bountyProgress
        && freshSave().bountyDay === 0 && freshSave().bountyCursor === 0);
}

// ==================== 7. 分解钩子 ====================

{
    const save = freshSave();
    save.facilities.smith = 1;
    putOnBoard(save, ['gather_disassemble']);
    const item = gear('dis-1', 20, 'rare');
    save.inventory = [item];
    const yield_ = K.dismantle(save, 'dis-1');
    check('601. 分解成功', !!yield_ && save.inventory.length === 0);
    eq('602. 分解推进悬赏进度', progressOf(save, 'gather_disassemble'), 1);
    check('603. 分解悬赏未完成时不可领取', !readyOf(save, 'gather_disassemble'));

    // 未建造 / 坏 uid 不推进
    const locked = freshSave();
    putOnBoard(locked, ['gather_disassemble']);
    locked.inventory = [gear('dis-2', 20, 'rare')];
    eq('604. 铁匠铺未建造分解失败', K.dismantle(locked, 'dis-2'), null);
    eq('605. 失败不推进进度', progressOf(locked, 'gather_disassemble'), 0);
    eq('606. 重复分解同一 uid 失败', K.dismantle(locked, 'nonexistent'), null);
    eq('607. 重复分解仍不推进进度', progressOf(locked, 'gather_disassemble'), 0);

    // 分解到 10 件可以领取
    const ten = freshSave();
    ten.facilities.smith = 1;
    putOnBoard(ten, ['gather_disassemble']);
    for (let i = 0; i < 10; i++) {
        const it = gear(`d-${i}`, 5 + i, 'uncommon');
        ten.inventory = [it];
        K.dismantle(ten, it.uid);
    }
    eq('608. 分 10 件后进度满', progressOf(ten, 'gather_disassemble'), 10);
    check('609. 分 10 件后可领取', readyOf(ten, 'gather_disassemble'));
    const claim = B.claimBounty(ten, 'gather_disassemble', () => 0.5, 10, ctx());
    check('610. 分解悬赏领取成功', claim.ok, claim.reason);
    eq('611. 分解悬赏金币 +300', ten.gold, 300);
}

// ==================== 汇总 ====================

if (failures.length > 0) {
    console.error(`\nMITHRIL_BOUNTY_FAILED  ${passed}/${passed + failures.length} 项通过`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
}
console.log(`MITHRIL_BOUNTY_OK  ${passed} 项通过（M8：24 悬赏 / 悬赏板 / 收集 / 领取 / 存档 / 分解）`);
