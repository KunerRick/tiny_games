#!/usr/bin/env node
/**
 * 《秘银远征》野外节点图 —— 纯逻辑自检（不启动 Cocos）。
 *
 * M4 覆盖：
 *  1. 图结构与确定性：12 节点 / 层数 1-2-3-3-2-1 / 同种子同图 / 起点能走到 BOSS
 *  2. 节点等级与装等按层线性、落在区域区间内
 *  3. 区域门控（等级）与「未实装副本的区域不给副本节点」
 *  4. 补给规则：每节点 -1、耗尽后扣 8% 最大生命、死亡判定
 *  5. 走法合法性：只认相邻节点；起点免费；已清理节点可免费路过（transit）；
 *     站在未结算节点上可续开（resume）；不相邻的已清理节点报 done
 *  6. 节点 → RunPlan：战斗 3 波 / 精英 1 波 / BOSS 直进 / 副本复用副本编排
 *  7. 奖励确定性：材料数量落在配置区间、宝箱陷阱与金币可复现
 *  8. 事件三选一：回血 / 材料 / 冒险深挖（掉血）与死亡
 *  9. 材料入档与本程合计、失败清空、存档净化（坏档回落 null）
 * 10. Wild 模块纯度：不许 import cc / Date.now / Math.random / localStorage
 *
 * 用法：node tools/verify-mithril-wild.js
 * 通过时打印 MITHRIL_WILD_OK；失败逐条打印并以退出码 1 结束。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, runTsc } = require('./lib/core-compile');

const SRC_DIR = path.join(ROOT, 'assets', 'games', 'game_mithril', 'scripts');
const CFG_SRC = path.join(SRC_DIR, 'MithrilConfig.ts');
const WILD_SRC = path.join(SRC_DIR, 'MithrilWild.ts');
const OUT = path.join(ROOT, 'temp', 'mithril-wild-test');

// ---------- 1. 纯度：纯逻辑模块不许依赖引擎 / 时间 / 全局随机 ----------
const source = fs.readFileSync(WILD_SRC, 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
if (/from\s+['"]cc(\/|['"])/.test(code)) {
    console.error('MithrilWild.ts 不许 import cc');
    process.exit(1);
}
for (const bad of ['Date.now', 'Math.random', 'localStorage']) {
    if (new RegExp(`\\b${bad.replace('.', '\\.')}\\b`).test(code)) {
        console.error(`MithrilWild.ts 不许使用 ${bad}（要可复现 / 与渲染层无关）`);
        process.exit(1);
    }
}

// ---------- 2. 编译 ----------
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`编译纯逻辑模块 → ${path.relative(ROOT, OUT)}`);
runTsc([
    CFG_SRC,
    WILD_SRC,
    '--outDir', OUT,
    '--rootDir', SRC_DIR,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
]);

const F = require(path.join(OUT, 'MithrilConfig.js'));
const W = require(path.join(OUT, 'MithrilWild.js'));

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

const SEEDS = [1, 7, 42, 1234, 987654, 0x51ed];

// ==================== 1. 图结构 ====================

check('WILD_LAYERS 为 1-2-3-3-2-1', JSON.stringify(F.WILD_LAYERS) === JSON.stringify([1, 2, 3, 3, 2, 1]));
eq('节点总数常量一致', F.WILD_NODE_COUNT, F.WILD_LAYERS.reduce((a, b) => a + b, 0));

for (const region of F.REGIONS) {
    for (const seed of SEEDS) {
        const map = W.generateWildMap(region.id, seed);
        const tag = `${region.id}/${seed}`;
        eq(`[${tag}] 节点数`, map.nodes.length, F.WILD_NODE_COUNT);
        eq(`[${tag}] 图记录区域`, map.regionId, region.id);
        eq(`[${tag}] 图记录种子`, map.seed, seed);
        eq(`[${tag}] 起点类型`, map.nodes[0].kind, 'start');
        eq(`[${tag}] 终点是 BOSS`, map.nodes[map.nodes.length - 1].kind, 'boss');
        check(`[${tag}] BOSS 有 bossId`, !!map.nodes[map.nodes.length - 1].bossId);

        // 每层节点数与类型合法性
        for (let layer = 0; layer < F.WILD_LAYERS.length; layer++) {
            const row = map.nodes.filter((n) => n.layer === layer);
            eq(`[${tag}] 第 ${layer} 层节点数`, row.length, F.WILD_LAYERS[layer]);
            for (const n of row) {
                check(`[${tag}] 节点类型合法`, !!F.NODE_KIND_NAMES[n.kind], n.kind);
                check(`[${tag}] 等级在区域区间内`, n.level >= region.levelMin && n.level <= region.levelMax, `${n.level}`);
                check(`[${tag}] 装等在区域区间内`, n.ilvl >= region.ilvlMin && n.ilvl <= region.ilvlMax, `${n.ilvl}`);
            }
        }

        // 起点能走到 BOSS（连通性）
        const seen = new Set([0]);
        const queue = [0];
        while (queue.length) {
            const id = queue.shift();
            for (const next of map.nodes[id].links) {
                if (seen.has(next)) continue;
                seen.add(next);
                queue.push(next);
            }
        }
        eq(`[${tag}] 起点可达所有节点`, seen.size, F.WILD_NODE_COUNT);

        // 连线双向
        for (const n of map.nodes) {
            for (const other of n.links) {
                check(`[${tag}] 连线双向 ${n.id}<->${other}`,
                    map.nodes[other] && map.nodes[other].links.indexOf(n.id) >= 0);
                check(`[${tag}] 连线不跨层 ${n.id}<->${other}`,
                    Math.abs(map.nodes[other].layer - n.layer) === 1);
            }
        }
    }
}

const sameA = JSON.stringify(W.generateWildMap('ash', 424242).nodes);
const sameB = JSON.stringify(W.generateWildMap('ash', 424242).nodes);
eq('同种子同图', sameA, sameB);
check('不同种子不同图', sameA !== JSON.stringify(W.generateWildMap('ash', 424243).nodes));

// 层内等级随层递增
{
    const map = W.generateWildMap('frost', 2026);
    const levels = F.WILD_LAYERS.map((_, layer) => map.nodes.filter((n) => n.layer === layer)[0].level);
    let mono = true;
    for (let i = 1; i < levels.length; i++) if (levels[i] < levels[i - 1]) mono = false;
    check('节点等级随层递增', mono, levels.join(','));
    eq('BOSS 节点等级 = 区域上限', levels[levels.length - 1], F.REGION_BY_ID.frost.levelMax);
}

// ==================== 2. 区域门控与副本节点 ====================

check('灰烬 Lv1 解锁', W.regionUnlocked('ash', 1));
check('霜牙 Lv9 未解锁', !W.regionUnlocked('frost', 9));
check('霜牙 Lv10 解锁', W.regionUnlocked('frost', 10));
check('未知区域不解锁', !W.regionUnlocked('nowhere', 99));

// 区域首领结算时的「下一区域」提示（试玩 N68）：门槛文案 / 已解锁文案 / 终局无文案
{
    const nextRegion = F.REGIONS[1];
    const lastRegion = F.REGIONS[F.REGIONS.length - 1];
    const locked = W.nextRegionHint(F.REGIONS[0].id, 1);
    check('N68 未到门槛 → 写明下一区域与 Lv 要求',
        !!locked && locked.indexOf(nextRegion.name) >= 0 && locked.indexOf(`Lv${nextRegion.levelMin}`) >= 0, locked);
    const open = W.nextRegionHint(F.REGIONS[0].id, nextRegion.levelMin);
    check('N68 已到门槛 → 提示已解锁', !!open && open.indexOf('已解锁') >= 0, open);
    eq('N68 终局区域 → 无下一区域提示', W.nextRegionHint(lastRegion.id, 99), null);
    eq('N68 未知区域 → null', W.nextRegionHint('nowhere', 99), null);
}

const implemented = F.implementedDungeonIds();
check('当前至少实装一个副本', implemented.length >= 1, implemented.join(','));

for (const region of F.REGIONS) {
    const map = W.generateWildMap(region.id, 99);
    const dungeons = map.nodes.filter((n) => n.kind === 'dungeon');
    const supported = region.dungeonIds.some((id) => implemented.indexOf(id) >= 0);
    if (supported) {
        check(`[${region.id}] 有副本节点`, dungeons.length >= 1);
        for (const d of dungeons) {
            check(`[${region.id}] 副本节点指向已实装副本`, implemented.indexOf(d.dungeonId) >= 0, d.dungeonId);
        }
    } else {
        eq(`[${region.id}] 无已实装副本 → 不给副本节点`, dungeons.length, 0);
        eq(`[${region.id}] 第四层降级为精英`,
            map.nodes.filter((n) => n.layer === 4 && n.kind === 'elite').length, 2);
    }
    // 无副本节点时 buildWildPlan 不会返回 null 之外的东西
    for (const n of map.nodes) {
        if (n.kind === 'dungeon') check(`[${region.id}] 副本节点可编译`, !!W.buildWildPlan(map, n));
    }
}

// ==================== 3. 远征状态与补给规则 ====================

{
    const map = W.generateWildMap('ash', 2024);
    const maxHp = 200;
    const exp = W.createExpedition('ash', 2024, maxHp);
    eq('出发补给 = 3', exp.supply, F.SUPPLY_PER_RUN);
    eq('出发满血', exp.hp, maxHp);
    eq('出发在起点', exp.pos, 0);
    eq('起点已访问', exp.visited.join(','), '0');
    eq('初始无本程材料', W.expeditionMaterialTotal(exp), 0);

    // 只能走相邻
    const far = map.nodes.find((n) => n.layer >= 3);
    const rejected = W.enterNode(map, exp, far.id, maxHp);
    check('非相邻节点被拒绝', !rejected.ok && rejected.reason === 'not_reachable');
    eq('被拒绝不扣补给', exp.supply, F.SUPPLY_PER_RUN);
    eq('被拒绝不移动', exp.pos, 0);

    // 起点免费
    const back = W.enterNode(map, exp, 0, maxHp);
    check('回起点不扣补给', back.ok && !back.supplySpent && back.hpCost === 0);
    eq('回起点补给不变', exp.supply, F.SUPPLY_PER_RUN);

    // 走相邻
    const first = map.nodes[0].links[0];
    const entered = W.enterNode(map, exp, first, maxHp);
    check('进入相邻节点成功', entered.ok && entered.supplySpent && entered.hpCost === 0);
    eq('补给 -1', exp.supply, F.SUPPLY_PER_RUN - 1);
    eq('位置更新', exp.pos, first);
    check('已加入 visited', exp.visited.indexOf(first) >= 0);

    // 已结算节点不可重进
    W.markNodeDone(exp, first);
    check('已结算节点不可达', !W.isReachable(map, exp, first));
    check('已结算标记生效', W.isNodeDone(exp, first));
}

{
    // 补给耗尽：每节点扣 8% 最大生命
    const map = W.generateWildMap('ash', 777);
    const maxHp = 200;
    const exp = W.createExpedition('ash', 777, maxHp);
    exp.supply = 0;
    exp.pos = 0;
    const target = map.nodes[0].links[0];
    const res = W.enterNode(map, exp, target, maxHp);
    eq('无补给不掉补给值', exp.supply, 0);
    eq('无补给按 8% 最大生命扣血', res.hpCost, Math.round(maxHp * F.SUPPLY_EXHAUST_HP_PCT));
    eq('扣血后生命', exp.hp, maxHp - res.hpCost);
    check('未致死', !res.dead);

    const exp2 = W.createExpedition('ash', 777, 100);
    exp2.supply = 0;
    exp2.hp = 5;
    exp2.pos = 0;
    const res2 = W.enterNode(map, exp2, target, 100);
    check('补给耗尽 + 残血 → 死亡', res2.dead);
    eq('死亡时生命归零', exp2.hp, 0);
}

// ==================== 4. 路过 / 续开 / 已清理（第 11 轮试玩 N39 / N42 回归） ====================

{
    const map = W.generateWildMap('ash', 4242);
    const maxHp = 200;
    const startLinks = map.nodes[0].links.slice();
    check('起点至少连两个第一层节点', startLinks.length >= 2, startLinks.join(','));
    const l1a = startLinks[0];
    const l2id = map.nodes[l1a].links.find((id) => map.nodes[id].layer === 2);

    // 续开：进了节点但内容没结算（整页刷新）→ 当前节点免费重开
    {
        const exp = W.createExpedition('ash', 4242, maxHp);
        W.enterNode(map, exp, l1a, maxHp);
        const supply = exp.supply;
        const hp = exp.hp;
        const again = W.enterNode(map, exp, l1a, maxHp);
        check('站在未结算节点上可续开', again.ok && again.reason === 'resume');
        eq('续开不扣补给', exp.supply, supply);
        eq('续开不扣血', exp.hp, hp);
        eq('续开位置不变', exp.pos, l1a);

        W.markNodeDone(exp, l1a);
        const doneClick = W.enterNode(map, exp, l1a, maxHp);
        check('站在已结算节点上 → done', !doneClick.ok && doneClick.reason === 'done');
    }

    // N66：中途主动撤离后再点当前节点 = 新一次挑战，要重新付入场消耗
    {
        const exp = W.createExpedition('ash', 4242, maxHp);
        W.enterNode(map, exp, l1a, maxHp);
        exp.retreat = true;
        const supply = exp.supply;
        const hp = exp.hp;
        const again = W.chargeNodeEntry(exp, maxHp);
        check('重新挑战扣补给', again.supplySpent && exp.supply === supply - 1);
        eq('重新挑战扣补给时不扣血', exp.hp, hp);

        exp.supply = 0;
        const hpBefore = exp.hp;
        const paid = W.chargeNodeEntry(exp, maxHp);
        check('补给耗尽时重新挑战改扣血', !paid.supplySpent && paid.hpCost > 0);
        eq('扣血为 8% 上限（至少 1）', paid.hpCost,
            Math.max(1, Math.round(maxHp * F.SUPPLY_EXHAUST_HP_PCT)));
        eq('生命扣减正确', exp.hp, hpBefore - paid.hpCost);

        exp.hp = 3;
        const lethal = W.chargeNodeEntry(exp, maxHp);
        check('扣血致死会返回 dead', lethal.dead && exp.hp === 0);
    }

    // 路过：相邻的已结算节点可以免费走
    {
        const exp = W.createExpedition('ash', 4242, maxHp);
        W.enterNode(map, exp, l1a, maxHp);
        W.markNodeDone(exp, l1a);
        W.enterNode(map, exp, l2id, maxHp);
        W.markNodeDone(exp, l2id);
        const supply = exp.supply;
        const back = W.enterNode(map, exp, l1a, maxHp);
        check('相邻已结算节点可路过', back.ok && back.reason === 'transit');
        eq('路过不扣补给', exp.supply, supply);
        eq('路过移动到该节点', exp.pos, l1a);
        const forward = W.enterNode(map, exp, l2id, maxHp);
        check('可再路过回上一层', forward.ok && forward.reason === 'transit');
        eq('来回路过都不扣补给', exp.supply, supply);
    }

    // 已清理提示：不相邻的已结算节点报 done（而不是 not_reachable）
    {
        const exp = W.createExpedition('ash', 4242, maxHp);
        const far = map.nodes.find((n) => n.layer >= 4);
        W.markNodeDone(exp, far.id);
        const res = W.enterNode(map, exp, far.id, maxHp);
        check('不相邻已结算节点 → done', !res.ok && res.reason === 'done');
    }

    // N39 回归：第一层全清理 → 回起点 → 依次路过第一层，仍能继续前进
    {
        const exp = W.createExpedition('ash', 4242, maxHp);
        for (const id of startLinks) {
            W.enterNode(map, exp, 0, maxHp); // 回起点免费，再从起点走另一条
            W.enterNode(map, exp, id, maxHp);
            W.markNodeDone(exp, id);
        }
        const backStart = W.enterNode(map, exp, 0, maxHp);
        check('起点随时可免费回', backStart.ok && backStart.reason === 'start' && !backStart.supplySpent);
        eq('回起点不扣补给', exp.supply, 3 - startLinks.length);
        // 从起点直接点第二层仍不相邻
        const skip = W.enterNode(map, exp, l2id, maxHp);
        check('第二层仍不相邻', !skip.ok && skip.reason === 'not_reachable');
        // 但可以路过第一层已清理节点，再进第二层
        const walk = W.enterNode(map, exp, l1a, maxHp);
        check('第一层已清理节点可路过', walk.ok && walk.reason === 'transit');
        const supply = exp.supply;
        const next = W.enterNode(map, exp, l2id, maxHp);
        check('路过第一层后能继续进第二层', next.ok && next.reason === 'ok');
        eq('只对新节点扣补给', exp.supply, supply - 1);
        check('N39 死锁不再出现', exp.pos === l2id);
    }
}

// ==================== 5. 节点 → RunPlan ====================

{
    const map = W.generateWildMap('ash', 31337);
    for (const node of map.nodes) {
        const plan = W.buildWildPlan(map, node);
        const tag = `ash/${node.kind}#${node.id}`;
        if (node.kind === 'battle' || node.kind === 'elite') {
            check(`[${tag}] 可编译`, !!plan);
            if (!plan) continue;
            eq(`[${tag}] kind=wild`, plan.kind, 'wild');
            check(`[${tag}] 无 BOSS`, !plan.boss);
            eq(`[${tag}] 遭遇数`, plan.encounters.length, node.kind === 'elite' ? 1 : 3);
            for (const enc of plan.encounters) {
                check(`[${tag}] 遭遇有敌人`, enc.spawns.length > 0);
                for (const sp of enc.spawns) {
                    check(`[${tag}] 敌人 id 存在`, !!F.ENEMY_BY_ID[sp.enemyId], sp.enemyId);
                    check(`[${tag}] 数量为正`, sp.count > 0);
                }
            }
            check(`[${tag}] 掉落装等 = 节点装等`, plan.ilvl === node.ilvl);
        } else if (node.kind === 'boss') {
            check(`[${tag}] 可编译`, !!plan);
            if (!plan) continue;
            eq(`[${tag}] 直接进 BOSS`, plan.encounters.length, 0);
            check(`[${tag}] 有 BOSS 脚本`, !!plan.boss);
            check(`[${tag}] 有 BOSS 标题`, !!plan.bossTitle, plan.bossTitle);
            check(`[${tag}] 有机制提示`, !!plan.bossHint, plan.bossHint);
            check(`[${tag}] BOSS 阶段数 > 0`, plan.boss.phases.length > 0);
            check(`[${tag}] BOSS 敌人 id 存在`, !!F.ENEMY_BY_ID[plan.boss.enemyId], plan.boss.enemyId);
        } else if (node.kind === 'dungeon') {
            check(`[${tag}] 可编译`, !!plan);
            if (!plan) continue;
            eq(`[${tag}] 副本计划 kind`, plan.kind, 'dungeon');
            eq(`[${tag}] 副本 id`, plan.id, node.dungeonId);
        } else {
            check(`[${tag}] 非战斗节点 → null`, plan === null);
        }
    }
}

// 区域 BOSS 脚本：三个阶段阈值递减、召唤怪存在
for (const boss of F.REGION_BOSSES) {
    const script = F.regionBossScript(boss.id);
    check(`[${boss.id}] 有 BOSS 脚本`, !!script);
    if (!script) continue;
    eq(`[${boss.id}] BOSS 敌人 id`, script.enemyId, boss.id);
    eq(`[${boss.id}] 阶段数`, script.phases.length, boss.phases.length);
    let prev = 1;
    for (const th of script.thresholds) {
        check(`[${boss.id}] 阈值递减`, th < prev, `${th}`);
        prev = th;
    }
    check(`[${boss.id}] 召唤怪存在`, !!F.ENEMY_BY_ID[script.addsEnemyId], script.addsEnemyId);
}

// ==================== 6. 奖励确定性 ====================

{
    const map = W.generateWildMap('frost', 555);
    for (const node of map.nodes) {
        const a = W.rollNodeMaterials(node);
        const b = W.rollNodeMaterials(node);
        eq(`奖励可复现 #${node.id}`, a, b);
        if (node.kind === 'battle' || node.kind === 'elite' || node.kind === 'boss') {
            const def = F.WILD_REWARDS[node.kind];
            check(`材料数落在区间 #${node.id}`, a >= def.matsMin && a <= def.matsMax, `${a} ∉ [${def.matsMin},${def.matsMax}]`);
        } else {
            eq(`非战斗节点无材料 #${node.id}`, a, 0);
        }
    }
    const chest = map.nodes.find((n) => n.kind === 'chest');
    if (chest) {
        eq('宝箱陷阱判定可复现', W.chestHasTrap(chest), W.chestHasTrap(chest));
        eq('宝箱掉血 = 15% 最大生命', W.chestTrapDamage(200), Math.round(200 * F.WILD_CHEST_TRAP_HP_PCT));
        check('宝箱金币 > 0', W.chestGold(chest) > 0);
    }
    // 陷阱概率大致贴近配置（同区域多图统计）
    let traps = 0;
    let chests = 0;
    for (let s = 0; s < 200; s++) {
        const m = W.generateWildMap('frost', s + 1);
        for (const n of m.nodes) {
            if (n.kind !== 'chest') continue;
            chests++;
            if (W.chestHasTrap(n)) traps++;
        }
    }
    const rate = chests > 0 ? traps / chests : 0;
    check('宝箱陷阱率贴近 25%', Math.abs(rate - F.WILD_CHEST_TRAP_CHANCE) < 0.1, `${(rate * 100).toFixed(1)}% / ${chests}`);
}

// ==================== 7. 篝火与事件 ====================

{
    eq('补给站回 40%', W.supplyHeal(200, 100), 80);
    eq('补给站不超上限', W.supplyHeal(200, 180), 20);
    eq('满血不回', W.supplyHeal(200, 200), 0);

    const opts = W.WILD_EVENT_OPTIONS;
    eq('事件三选一', opts.length, 3);
    const ids = opts.map((o) => o.id).join(',');
    eq('事件选项 id', ids, 'loot,bandage,dig');

    const exp = W.createExpedition('ash', 11, 200);
    exp.hp = 100;
    const heal = W.applyWildEvent(exp, 'bandage', 200);
    eq('包扎回 25%', heal.hpDelta, Math.round(200 * F.WILD_EVENT_HEAL_PCT));
    eq('包扎后生命', exp.hp, 150);

    const exp2 = W.createExpedition('ash', 11, 200);
    exp2.hp = 100;
    const loot = W.applyWildEvent(exp2, 'loot', 200);
    eq('搜刮得材料', loot.materialDelta, F.WILD_EVENT_MATERIALS);
    eq('搜刮材料计入本程', W.expeditionMaterialTotal(exp2), F.WILD_EVENT_MATERIALS);
    eq('搜刮不掉血', exp2.hp, 100);

    const exp3 = W.createExpedition('ash', 11, 200);
    exp3.hp = 100;
    const dig = W.applyWildEvent(exp3, 'dig', 200);
    eq('深挖得材料', dig.materialDelta, F.WILD_EVENT_RISK_MATERIALS);
    eq('深挖掉 10% 生命', exp3.hp, 100 - Math.round(200 * F.WILD_EVENT_RISK_HP_PCT));
    check('深挖未致死', !dig.dead);

    const exp4 = W.createExpedition('ash', 11, 200);
    exp4.hp = 5;
    const dig2 = W.applyWildEvent(exp4, 'dig', 200);
    check('深挖可致死', dig2.dead);
    eq('致死时生命归零', exp4.hp, 0);
}

// ==================== 8. 材料、失败与净化 ====================

{
    const exp = W.createExpedition('frost', 8, 200);
    eq('入档材料返回实际数量', W.grantRunMaterials(exp, 'frost_crystal', 3), 3);
    eq('非法材料 id 回落到区域材料', W.grantRunMaterials(exp, 'bogus', 2), 2);
    eq('本程材料合计', W.expeditionMaterialTotal(exp), 5);
    eq('负数不入档', W.grantRunMaterials(exp, 'frost_crystal', -3), 0);

    const lost = W.failExpedition(exp);
    eq('失败丢失明细', JSON.stringify(lost), JSON.stringify({ frost_crystal: 5 }));
    eq('失败清空本程材料', W.expeditionMaterialTotal(exp), 0);
    check('失败标记完成', exp.complete);
    eq('失败生命归零', exp.hp, 0);

    // 净化
    eq('垃圾值 → null', W.sanitizeExpedition(null), null);
    eq('非对象 → null', W.sanitizeExpedition(42), null);
    eq('未知区域 → null', W.sanitizeExpedition({ regionId: 'nowhere', seed: 1, hp: 10 }), null);
    eq('生命为 0 → null', W.sanitizeExpedition({ regionId: 'ash', seed: 1, hp: 0 }), null);

    const clean = W.sanitizeExpedition({
        regionId: 'abyss',
        seed: 123,
        supply: 99,
        hp: 88,
        pos: 5,
        visited: [0, 1, 1, 99, -2, 'x'],
        done: [2, 2],
        runMaterials: { ash_dust: 4, bogus: 9, frost_crystal: -1 },
        complete: false,
    });
    check('好档可还原', !!clean);
    if (clean) {
        eq('补给被夹到上限', clean.supply, F.SUPPLY_PER_RUN);
        eq('visited 去重并夹到合法 id', clean.visited.join(','), '0,1,5');
        eq('done 去重', clean.done.join(','), '2');
        eq('非法材料被丢弃', Object.keys(clean.runMaterials).join(','), 'ash_dust');
        eq('负数材料被丢弃', clean.runMaterials.frost_crystal, undefined);
        check('pos 在 visited 里', clean.visited.indexOf(clean.pos) >= 0);
        eq('retreat 缺省为 false', clean.retreat, false);
    }
    const retreatSave = W.sanitizeExpedition({ regionId: 'ash', seed: 1, hp: 50, retreat: true });
    check('retreat=true 可还原', !!retreatSave && retreatSave.retreat === true);
}

// ==================== 9. 完整走图：起点 → BOSS ====================

{
    // 42 张图 × 3 区域：沿 BFS 最短路走到底，确认最后一站是 BOSS 且能编译
    let walked = 0;
    for (const region of F.REGIONS) {
        for (let s = 1; s <= 42; s++) {
            const map = W.generateWildMap(region.id, s * 13);
            const maxHp = 5000;
            const exp = W.createExpedition(region.id, s * 13, maxHp);
            const bossId = map.nodes.length - 1;

            // BFS 求最短路（父节点回溯）
            const parent = new Map([[0, -1]]);
            const queue = [0];
            while (queue.length) {
                const id = queue.shift();
                if (id === bossId) break;
                for (const next of map.nodes[id].links) {
                    if (parent.has(next)) continue;
                    parent.set(next, id);
                    queue.push(next);
                }
            }
            check(`[${region.id}/${s}] 起点到 BOSS 有路`, parent.has(bossId));
            if (!parent.has(bossId)) continue;

            const path = [];
            for (let id = bossId; id > 0; id = parent.get(id)) path.unshift(id);
            check(`[${region.id}/${s}] 路长 ≥ 5`, path.length >= 5, `${path.length}`);

            let dead = false;
            for (const step of path) {
                const res = W.enterNode(map, exp, step, maxHp);
                if (!res.ok || res.dead) {
                    dead = true;
                    break;
                }
                W.markNodeDone(exp, step);
            }
            check(`[${region.id}/${s}] 走完全程不致死（补给不足也不该在满血线死）`, !dead);
            eq(`[${region.id}/${s}] 停在 BOSS`, exp.pos, bossId);
            check(`[${region.id}/${s}] BOSS 节点可编译`, !!W.buildWildPlan(map, map.nodes[bossId]));
            eq(`[${region.id}/${s}] 补给耗尽后按节点扣血`,
                exp.hp,
                maxHp - Math.max(0, path.length - F.SUPPLY_PER_RUN) * Math.round(maxHp * F.SUPPLY_EXHAUST_HP_PCT));
            walked++;
        }
    }
    check('42×3 张图全部走通', walked === F.REGIONS.length * 42, `${walked}`);
}

// ==================== 结果 ====================

if (failures.length === 0) {
    console.log(`\nMITHRIL_WILD_OK —— ${passed} 项检查全部通过`);
    process.exit(0);
}
console.error(`\n失败 ${failures.length} 项（通过 ${passed} 项）：`);
for (const f of failures) console.error(`  - ${f}`);
process.exit(1);
