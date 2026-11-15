#!/usr/bin/env node
/**
 * 《秘银远征》副本编排自检（M6，不启动 Cocos 编辑器）。
 *
 * 覆盖：
 *  1. 配置完整性：24 种敌人 / 6 副本 × 3 遭遇 / 6 份 BOSS 编排 / 6 件首通紫装
 *     —— 遭遇引用的敌人 id 必须存在，BOSS 阶段必须与 `DUNGEONS[*].phases` 同序同名
 *  2. 计划编译：`dungeonRunPlan()` 对 6 个副本全部返回计划，`implementedDungeonIds()` = 6
 *  3. 区域路由：每个副本都能从所在区域的野外节点进入（地图能生成、计划能编译）
 *  4. 美术登记：副本 / 野外用到的每种敌人都必须在 `MithrilArt.REGION_ART` 里有画风
 *  5. 自动玩家矩阵：4 职业 × 6 副本全部通关，且过程中无 NaN、三阶段机制都触发过
 *
 * 用法：node tools/verify-mithril-dungeons.js
 * 通过时打印 MITHRIL_DUNGEONS_OK；失败逐条打印并以退出码 1 结束。
 * 调平衡时用 `MITHRIL_VERBOSE=1` 看每场的用时 / 剩余血量。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, runTsc } = require('./lib/core-compile');

const SRC_DIR = path.join(ROOT, 'assets', 'games', 'game_mithril', 'scripts');
const OUT = path.join(ROOT, 'temp', 'mithril-dungeons-test');

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
const C = require(path.join(OUT, 'MithrilCore.js'));
const L = require(path.join(OUT, 'MithrilLoot.js'));
const W = require(path.join(OUT, 'MithrilWild.js'));

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

const IDLE = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
const CLASS_IDS = ['warrior', 'mage', 'ranger', 'priest'];

// ==================== 1. 配置完整性 ====================

{
    const ids = F.ENEMIES.map((e) => e.id);
    eq('1. 敌人总数 = 24', ids.length, 24);
    eq('2. 敌人 id 不重复', new Set(ids).size, ids.length);
    for (const e of F.ENEMIES) {
        check(`[${e.id}] 有名字`, !!e.name, e.id);
        check(`[${e.id}] 生命为正`, e.hp > 0, e.hp);
        check(`[${e.id}] 种类合法`, ['melee', 'ranged', 'elite', 'boss'].indexOf(e.kind) >= 0, e.kind);
        check(`[${e.id}] 半径为正`, e.radius > 0, e.radius);
    }
    eq('3. BOSS 敌人 = 9 个（4 旧 + 5 新）', F.ENEMIES.filter((e) => e.kind === 'boss').length, 9);
}

for (const def of F.DUNGEONS) {
    const encs = F.DUNGEON_ENCOUNTERS[def.id];
    check(`[${def.id}] 有遭遇编排`, Array.isArray(encs), def.id);
    if (!Array.isArray(encs)) continue;
    eq(`[${def.id}] 遭遇数 = 3`, encs.length, 3);
    encs.forEach((enc, i) => {
        check(`[${def.id}#${i + 1}] 有名字`, !!enc.name, enc.name);
        check(`[${def.id}#${i + 1}] 有副标题`, !!enc.subtitle, enc.subtitle);
        check(`[${def.id}#${i + 1}] 至少一波敌人`, enc.spawns.length > 0);
        for (const sp of enc.spawns) {
            check(`[${def.id}#${i + 1}] 敌人 ${sp.enemyId} 存在`, !!F.ENEMY_BY_ID[sp.enemyId], sp.enemyId);
            check(`[${def.id}#${i + 1}] ${sp.enemyId} 数量为正`, sp.count > 0, sp.count);
        }
    });

    const script = F.DUNGEON_BOSS_SCRIPTS[def.id];
    check(`[${def.id}] 有 BOSS 编排`, !!script, def.id);
    if (!script) continue;
    const bossDef = F.ENEMY_BY_ID[script.enemyId];
    check(`[${def.id}] BOSS 敌人存在`, !!bossDef, script.enemyId);
    check(`[${def.id}] BOSS 敌人 kind=boss`, !!bossDef && bossDef.kind === 'boss', bossDef && bossDef.kind);
    eq(`[${def.id}] 阶段数 = phases 数`, script.phases.length, def.phases.length);
    eq(`[${def.id}] 阈值数 = 阶段数 - 1`, script.thresholds.length, script.phases.length - 1);
    def.phases.forEach((p, i) => {
        const sp = script.phases[i];
        check(`[${def.id}] 阶段 ${i + 1} 机制 = 配置表`, !!sp && sp.mechanic === p.mechanic, sp && sp.mechanic);
        check(`[${def.id}] 阶段 ${i + 1} 名称 = 配置表`, !!sp && sp.name === p.name, sp && sp.name);
        check(`[${def.id}] 阶段 ${i + 1} 有说明`, !!sp && !!sp.desc, sp && sp.desc);
    });
    for (let i = 1; i < script.thresholds.length; i++) {
        check(`[${def.id}] 阈值递减`, script.thresholds[i] < script.thresholds[i - 1], script.thresholds.join(','));
    }
    check(`[${def.id}] 召唤怪存在`, !!F.ENEMY_BY_ID[script.addsEnemyId], script.addsEnemyId);
    check(`[${def.id}] 打断要求为正`, script.interruptNeed > 0, script.interruptNeed);
    check(`[${def.id}] 预警时间 > 0`, script.moveWarn > 0, script.moveWarn);
}

{
    const bossIds = new Set();
    for (const d of F.DUNGEONS) {
        const id = F.DUNGEON_BOSS_SCRIPTS[d.id].enemyId;
        check(`[${d.id}] BOSS 不与其他副本重复`, !bossIds.has(id), id);
        bossIds.add(id);
    }
    eq('4. BOSS 编排 6 份', Object.keys(F.DUNGEON_BOSS_SCRIPTS).length, 6);
}

// ---------- 首通紫装 ----------
{
    eq('5. 首通掉落 6 份', Object.keys(F.DUNGEON_LOOT).length, 6);
    for (const def of F.DUNGEONS) {
        const loot = F.DUNGEON_LOOT[def.id];
        check(`[${def.id}] 有首通掉落`, !!loot, def.id);
        if (!loot) continue;
        check(`[${def.id}] 掉落装等在副本区间内`,
            loot.ilvl >= def.ilvlMin && loot.ilvl <= def.ilvlMax, `${loot.ilvl} ∈ [${def.ilvlMin},${def.ilvlMax}]`);
        check(`[${def.id}] 掉落装等 ≤ 全局上限`, loot.ilvl <= F.ILVL_MAX, loot.ilvl);
        for (const cid of CLASS_IDS) {
            const base = F.GEAR_BASE_BY_ID[loot.firstClearBase[cid]];
            check(`[${def.id}/${cid}] 基型存在`, !!base, loot.firstClearBase[cid]);
            check(`[${def.id}/${cid}] 基型槽位 = 首通槽位`, !!base && base.slot === loot.firstClearSlot,
                base && base.slot);
        }
    }
    // 6 个副本的首通槽位各不相同（一件件换装，不许重复给同一个部位）
    const slots = F.DUNGEONS.map((d) => F.DUNGEON_LOOT[d.id].firstClearSlot);
    eq('6. 首通槽位不重复', new Set(slots).size, slots.length);
}

// ==================== 2. 计划编译 ====================

{
    const ids = F.implementedDungeonIds();
    eq('7. 已实装副本 = 6', ids.length, 6);
    eq('8. 已实装副本顺序 = 配置表顺序', ids.join(','), F.DUNGEONS.map((d) => d.id).join(','));

    for (const def of F.DUNGEONS) {
        const plan = F.dungeonRunPlan(def.id);
        check(`[${def.id}] 计划可编译`, !!plan, def.id);
        if (!plan) continue;
        eq(`[${def.id}] kind = dungeon`, plan.kind, 'dungeon');
        eq(`[${def.id}] id 回填`, plan.id, def.id);
        eq(`[${def.id}] 名称回填`, plan.name, def.name);
        eq(`[${def.id}] 遭遇数 = 3`, plan.encounters.length, 3);
        check(`[${def.id}] 有 BOSS 脚本`, !!plan.boss);
        eq(`[${def.id}] BOSS 标题 = bossName`, plan.bossTitle, def.bossName);
        check(`[${def.id}] 机制提示非空`, !!plan.bossHint, plan.bossHint);
        for (const p of def.phases) {
            check(`[${def.id}] 提示含阶段「${p.name}」`, plan.bossHint.indexOf(p.name) >= 0, plan.bossHint);
        }
        eq(`[${def.id}] 结算装等 = ilvlMax`, plan.ilvl, def.ilvlMax);
        check(`[${def.id}] 遭遇血量倍率 > 0`, plan.scale > 0, plan.scale);
        check(`[${def.id}] BOSS 血量倍率 > 0`, plan.bossScale > 0, plan.bossScale);
        check(`[${def.id}] 遭遇回血比例在 (0,1]`, plan.healPct > 0 && plan.healPct <= 1, plan.healPct);
    }
    check('9. 未知副本 → null（不编造计划）', F.dungeonRunPlan('nowhere') === null);
}

// ==================== 3. 区域路由 ====================

{
    const implemented = F.implementedDungeonIds();
    const routed = new Set();
    for (const region of F.REGIONS) {
        for (const did of region.dungeonIds) {
            check(`[${region.id}] 副本 ${did} 已实装`, implemented.indexOf(did) >= 0, did);
            routed.add(did);
        }
    }
    eq('10. 6 个副本都挂在区域上', routed.size, 6);

    for (const region of F.REGIONS) {
        const map = W.generateWildMap(region.id, 606);
        const nodes = map.nodes.filter((n) => n.kind === 'dungeon');
        eq(`[${region.id}] 副本节点数 = 区域副本数`, nodes.length, region.dungeonIds.length);
        for (const n of nodes) {
            check(`[${region.id}] 节点 #${n.id} 副本 id 在区域内`,
                region.dungeonIds.indexOf(n.dungeonId) >= 0, n.dungeonId);
            const plan = W.buildWildPlan(map, n);
            check(`[${region.id}] 节点 #${n.id} 计划可编译`, !!plan, n.dungeonId);
            if (plan) eq(`[${region.id}] 节点 #${n.id} 复用副本编排`, plan.kind, 'dungeon');
        }
    }
}

// ==================== 4. 美术登记 ====================

{
    const src = fs.readFileSync(path.join(SRC_DIR, 'MithrilArt.ts'), 'utf8');
    const block = src.slice(src.indexOf('export const REGION_ART'));
    const artKeys = new Set();
    const re = /^\s{4}([a-z_][a-z0-9_]*):\s*\{\s*style:/gm;
    let m;
    while ((m = re.exec(block)) !== null) artKeys.add(m[1]);

    // 专属画法的 5 种老怪（drawImp/drawMiner/…）不走 REGION_ART
    const legacy = new Set(['imp', 'miner', 'wraith', 'golem', 'troll']);
    const used = new Set();
    for (const def of F.DUNGEONS) {
        for (const enc of F.DUNGEON_ENCOUNTERS[def.id]) for (const sp of enc.spawns) used.add(sp.enemyId);
        const script = F.DUNGEON_BOSS_SCRIPTS[def.id];
        used.add(script.enemyId);
        used.add(script.addsEnemyId);
    }
    for (const pool of Object.values(F.REGION_ENEMY_POOLS)) {
        for (const id of pool.mobs) used.add(id);
        used.add(pool.elite);
        used.add(pool.boss);
    }
    for (const id of used) {
        if (legacy.has(id)) continue;
        check(`[${id}] 已登记区域画风`, artKeys.has(id), Array.from(artKeys).join(','));
    }
    check('11. REGION_ART 至少 19 条（11 老怪 + 8 新怪）', artKeys.size >= 19, artKeys.size);
}

// ==================== 5. 自动玩家矩阵 ====================

// 自动玩家（16 方向转向 + 决策 + 单场驱动）已挪到 tools/lib/mithril-bot.js ——
// 饰品自检（verify-mithril-trinkets.js）也要用它，抄两份必然漂移
const { BANDS, runDungeon } = require('./lib/mithril-bot').createBot(F, C);

/** 每个副本的「机制签名」：BOSS 三阶段里出现过的机制种类 */
function mechanicSignature(plan) {
    const kinds = new Set();
    plan.boss.phases.forEach((ph, i) => {
        if (i > 0) kinds.add(ph.mechanic);
    });
    // 第一阶段（index 0）也要能观察到
    kinds.add(plan.boss.phases[0].mechanic);
    return kinds;
}

const matrix = [];
for (const def of F.DUNGEONS) {
    const plan = F.dungeonRunPlan(def.id);
    const band = BANDS[def.id];
    check(`[${def.id}] 有进场配置`, !!band, def.id);
    if (!plan || !band) continue;
    const sig = mechanicSignature(plan);
    for (const classId of CLASS_IDS) {
        const res = runDungeon(classId, def.id, band.maxSeconds);
        const tag = `${def.id}/${classId}`;
        matrix.push({
            tag,
            phase: res.world.phase,
            seconds: res.seconds,
            minHp: res.minHp,
            phases: res.bossPhases,
        });
        check(`[${tag}] 无 NaN / 血量越界`, !res.badState, res.badState);
        const bossPct = res.world.boss ? ` · BOSS ${(res.world.boss.hp / res.world.boss.maxHp * 100).toFixed(0)}%` : '';
        check(`[${tag}] ${band.maxSeconds}s 内通关`, res.world.phase === 'won',
            `${res.world.phase} @ ${res.seconds.toFixed(1)}s · ${res.world.stage}#${res.world.encounterIndex}` +
            ` · 最低血 ${(res.minHp * 100).toFixed(0)}%${bossPct}`);
        check(`[${tag}] 打完 3 波 + BOSS`, res.world.encounterIndex >= 2 || res.world.stage === 'boss' || res.world.stage === 'cleared',
            `${res.world.stage} #${res.world.encounterIndex}`);
        check(`[${tag}] BOSS 三阶段全部进入`, res.bossPhases >= 2, `最深阶段 ${res.bossPhases + 1}`);
        check(`[${tag}] 观察到阶段切换事件`, res.seen.has('phase1') || res.seen.has('phase2'),
            Array.from(res.seen).join(','));
        // 机制覆盖：打断类必须有读条，召唤类必须真的刷出小怪，位移类必须出现落点预警
        if (sig.has('interrupt')) {
            check(`[${tag}] 打断机制有读条`, res.seen.has('cast') || res.seen.has('interrupt'),
                Array.from(res.seen).join(','));
        }
        if (sig.has('adds')) {
            check(`[${tag}] 召唤机制刷出了小怪`, res.sawAdds, plan.boss.addsEnemyId);
        }
        if (sig.has('move')) {
            check(`[${tag}] 位移机制出现落点预警`, res.sawTelegraph || res.seen.has('boom'),
                Array.from(res.seen).join(','));
        }
        if (process.env.MITHRIL_VERBOSE) {
            console.log(`run ${tag.padEnd(14)} ${res.world.phase.padEnd(8)} ${res.seconds.toFixed(1)}s  最低血 ${(res.minHp * 100).toFixed(0)}%  阶段 ${res.bossPhases}/${res.plan.boss.phases.length}`);
        }
    }
}

check('12. 自动玩家矩阵 24 场', matrix.length, 24);
const wonCount = matrix.filter((m) => m.phase === 'won').length;
check('13. 24 场全部通关', wonCount === 24, `${wonCount}/24`);
const slowest = matrix.reduce((a, b) => (a.seconds > b.seconds ? a : b), matrix[0]);
check('14. 最长一场不超过时限',
    !!slowest && slowest.seconds <= BANDS[slowest.tag.split('/')[0]].maxSeconds, slowest && slowest.tag);

// ==================== 6. 首通紫装（掉落层） ====================

{
    // 固定序列 rng：只验证「首通一定给对应部位 / 装等 / 职业基型」，不验证随机词条质量
    let seed = 12345;
    const rng = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    for (const def of F.DUNGEONS) {
        const loot = F.DUNGEON_LOOT[def.id];
        for (const classId of CLASS_IDS) {
            const item = L.firstClearDrop(rng, classId, def.id);
            const tag = `${def.id}/${classId}`;
            check(`[${tag}] 首通掉落非空`, !!item, 'null');
            if (!item) continue;
            eq(`[${tag}] 首通掉落品质 = epic`, item.quality, 'epic');
            eq(`[${tag}] 首通掉落槽位`, item.slot, loot.firstClearSlot);
            eq(`[${tag}] 首通掉落装等 = 副本装等 + 4（封顶）`, item.ilvl, Math.min(F.ILVL_MAX, loot.ilvl + 4));
            eq(`[${tag}] 首通掉落基型`, item.baseId, loot.firstClearBase[classId]);
            check(`[${tag}] 首通掉落带词条`, item.affixes.length > 0, item.affixes.length);
        }
    }
}

// ==================== 结果 ====================

if (failures.length > 0) {
    console.error(`\nMITHRIL_DUNGEONS_FAIL —— ${failures.length} 项失败（通过 ${passed} 项）`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
}
if (!process.env.MITHRIL_VERBOSE) {
    for (const m of matrix) {
        console.log(`  ${m.tag.padEnd(14)} ${String(m.phase).padEnd(8)} ${m.seconds.toFixed(0).padStart(4)}s  最低血 ${(m.minHp * 100).toFixed(0).padStart(3)}%`);
    }
}
console.log(`MITHRIL_DUNGEONS_OK —— ${passed} 项检查全部通过`);
