#!/usr/bin/env node
/**
 * 《秘银远征》营地 5 设施 —— 纯逻辑自检（不启动 Cocos）。
 *
 * M5 覆盖：
 *  1. 纯度：MithrilCamp.ts 不许 import cc / Date.now / Math.random / localStorage
 *  2. 设施表：5 座、各 5 级效果与 5 档材料费、材料 id 合法
 *  3. 升级：材料不足不扣任何东西、成功扣准确数量、满级拒绝
 *  4. 仓库上限：军需官每级 +6 格，扩容后的背包装得进也读得回（sanitize 不砍）
 *  5. 训练场：洗点价格 200/500 → 半价 → 免费；方案槽 0/1/2；保存 / 载入 / 坏档归一
 *  6. 铁匠铺重铸：锁位随等级、费用公式、点数守恒、锁定词条不动、无重复 id、确定性
 *  7. 铁匠铺分解：材料按装等分档、产量公式、只拆背包件
 *  8. 附魔台：源装备消耗 / 保留（Lv3）、一次 1/2 条、目标条数上限（Lv5 放开）、
 *     重复词条拒绝、材料减半（Lv4）、金币与材料不足拒绝
 *  9. 厨房：档次门控、槽位、重复料理、场次扣减、Lv4 效果 ×1.5、Lv5 持续 3 场、
 *     料理真正进 profileFromSave（攻击强度 / 生命 / 暴击 / 急速 / 全能）
 * 10. 军需官：仓库格数与悬赏位
 *
 * 用法：node tools/verify-mithril-camp.js
 * 通过时打印 MITHRIL_CAMP_OK；失败逐条打印并以退出码 1 结束。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, runTsc } = require('./lib/core-compile');

const SRC_DIR = path.join(ROOT, 'assets', 'games', 'game_mithril', 'scripts');
const CAMP_SRC = path.join(SRC_DIR, 'MithrilCamp.ts');
const OUT = path.join(ROOT, 'temp', 'mithril-camp-test');

// ---------- 1. 纯度 ----------
const source = fs.readFileSync(CAMP_SRC, 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
if (/from\s+['"]cc(\/|['"])/.test(code)) {
    console.error('MithrilCamp.ts 不许 import cc');
    process.exit(1);
}
for (const bad of ['Date.now', 'Math.random', 'localStorage']) {
    if (new RegExp(`\\b${bad.replace('.', '\\.')}\\b`).test(code)) {
        console.error(`MithrilCamp.ts 不许使用 ${bad}（要可复现 / 与渲染层无关）`);
        process.exit(1);
    }
}

// ---------- 2. 编译 ----------
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`编译纯逻辑模块 → ${path.relative(ROOT, OUT)}`);
runTsc([
    CAMP_SRC,
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
const C = require(path.join(OUT, 'MithrilCore.js'));
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

/** 造一件指定槽位 / 装等 / 品质 / 词条的手工装备 */
function mkItem(over) {
    const base = {
        baseId: 'mainHand_0', slot: 'mainHand', ilvl: 20, quality: 'epic',
        affixes: [
            { id: 'crit', points: 2 },
            { id: 'haste', points: 2 },
            { id: 'mastery', points: 2 },
            { id: 'vers', points: 2 },
        ],
    };
    const item = Object.assign({}, base, over || {});
    item.uid = item.uid || `it_${Math.random().toString(36).slice(2, 8)}`;
    if (!F.GEAR_BASE_BY_ID[item.baseId]) throw new Error(`坏基型 ${item.baseId}`);
    return item;
}

function mkSave(over) {
    const save = P.defaultSave('warrior');
    Object.assign(save, over || {});
    if (over && over.facilities) {
        for (const id of F.FACILITY_IDS) {
            if (over.facilities[id] !== undefined) save.facilities[id] = over.facilities[id];
        }
    }
    return save;
}

/** 造一件基型与槽位匹配的装备（背包 / 装备栏都要过 sanitize 的基型校验） */
function mkSlotItem(slot, ilvl, quality, affixes) {
    const pool = F.GEAR_BASES.filter((b) => b.slot === slot);
    return mkItem({ baseId: pool[0].id, slot, ilvl, quality, affixes });
}

// ==================== 1. 设施表 ====================

eq('设施数 5', F.FACILITIES.length, 5);
eq('设施 id 顺序', F.FACILITY_IDS.join(','), 'smith,enchant,training,kitchen,quartermaster');
for (const def of F.FACILITIES) {
    check(`[${def.id}] 有名字与摘要`, !!def.name && !!def.summary);
    eq(`[${def.id}] 5 档效果`, def.effects.length, 5);
    eq(`[${def.id}] 5 档材料费`, def.costs.length, 5);
    for (const c of def.costs) {
        check(`[${def.id}] 材料 id 合法`, !!F.MATERIAL_BY_ID[c.materialId], c.materialId);
        check(`[${def.id}] 材料数量为正`, c.count > 0, String(c.count));
    }
    eq(`[${def.id}] 有查找表`, F.FACILITY_BY_ID[def.id], def);
}
check('升级材料按区域递进（最后一档用秘银）',
    F.FACILITIES.every((d) => d.costs[4].materialId === 'mithril_ore'));

// ==================== 2. 存档默认值与净化 ====================

{
    const save = P.defaultSave('warrior');
    eq('新档设施全 0', F.FACILITY_IDS.every((id) => save.facilities[id] === 0), true);
    eq('新档没有料理', save.meals.length, 0);
    eq('新档没有天赋方案', save.talentPresets.length, 0);

    const junk = P.sanitizeSave({
        facilities: { smith: 99, enchant: -3, training: 'x', kitchen: 4 },
        meals: [
            { id: 'pot_roast', runsLeft: 2 },
            { id: 'pot_roast', runsLeft: 5 },
            { id: 'nope', runsLeft: 1 },
            { id: 'swift_soup', runsLeft: -1 },
            { id: 'iron_bread', runsLeft: 1 },
        ],
        talentPresets: [{ warrior_steel_t1_0: 99 }, null],
    });
    eq('坏档：设施夹到 0–5', junk.facilities.smith, 5);
    eq('坏档：负数设施回落 0', junk.facilities.enchant, 0);
    eq('坏档：非数字设施回落 0', junk.facilities.training, 0);
    eq('坏档：正常设施保留', junk.facilities.kitchen, 4);
    eq('坏档：料理去重 + 未知 id 丢弃 + 截到 2 份', junk.meals.length, 2);
    eq('坏档：第一份料理保留', junk.meals[0].id, 'pot_roast');
    eq('坏档：0 场料理抬到 1 场', junk.meals[1].id, 'swift_soup');
    eq('坏档：0 场抬成 1', junk.meals[1].runsLeft, 1);
    check('坏档：天赋方案按 1 级点数归一（满点被砍到 1）',
        junk.talentPresets[0] && junk.talentPresets[0].warrior_steel_t1_0 === 1,
        JSON.stringify(junk.talentPresets[0]));
    eq('坏档：null 方案保持 null', junk.talentPresets[1], null);
}

// ==================== 3. 设施升级 ====================

for (const id of F.FACILITY_IDS) {
    const def = F.FACILITY_BY_ID[id];
    const save = mkSave();
    eq(`[${id}] 新档未建造`, K.facilityDef(id).id, id);

    let r = K.canUpgradeFacility(save, id);
    check(`[${id}] 没材料不能升级`, !r.ok);
    eq(`[${id}] 原因是缺材料`, r.reason, 'no-material');
    eq(`[${id}] 没材料时等级不变`, K.upgradeFacility(save, id), false);

    // 材料刚好够 / 差一个
    save.materials[def.costs[0].materialId] = def.costs[0].count - 1;
    check(`[${id}] 差一个材料拒绝`, !K.canUpgradeFacility(save, id).ok);
    save.materials[def.costs[0].materialId] = def.costs[0].count;
    r = K.canUpgradeFacility(save, id);
    check(`[${id}] 材料够了可以升`, r.ok, r.reason);
    eq(`[${id}] 升级成功`, K.upgradeFacility(save, id), true);
    eq(`[${id}] 等级 +1`, P.facilityLevel(save, id), 1);
    eq(`[${id}] 材料扣干净`, K.materialCount(save, def.costs[0].materialId), 0);

    // 一路升到满级
    for (let lv = 1; lv < 5; lv++) {
        const cost = def.costs[lv];
        save.materials[cost.materialId] = cost.count + 3;
        eq(`[${id}] 升到 ${lv + 1} 级`, K.upgradeFacility(save, id), true);
        eq(`[${id}] ${lv + 1} 级余料`, K.materialCount(save, cost.materialId), 3);
    }
    eq(`[${id}] 满级 5`, P.facilityLevel(save, id), 5);
    r = K.canUpgradeFacility(save, id);
    eq(`[${id}] 满级原因`, r.reason, 'max-level');
    eq(`[${id}] 满级后升不动`, K.upgradeFacility(save, id), false);
}

// ==================== 4. 仓库上限（军需官） ====================

{
    const save = mkSave();
    eq('基础仓库 60', P.inventoryCapFor(save), 60);
    save.facilities.quartermaster = 1;
    eq('军需官 1 级 66', P.inventoryCapFor(save), 66);
    save.facilities.quartermaster = 5;
    eq('军需官满级 90', P.inventoryCapFor(save), 90);

    // 扩到 66 后能装进第 61 件
    save.facilities.quartermaster = 1;
    save.inventory = [];
    for (let i = 0; i < 65; i++) save.inventory.push(mkSlotItem('ring', 5, 'common', []));
    check('60 件之后还能再装（扩容生效）', L.addToInventory(save, mkSlotItem('ring', 5, 'common', [])));
    eq('装到 66 件', save.inventory.length, 66);
    check('到 66 件就满了', !L.addToInventory(save, mkSlotItem('ring', 5, 'common', [])));

    // 读档不砍：66 件 + 军需官 1 级 → 66 件还在
    const round = P.sanitizeSave(JSON.parse(P.serializeSave(save)));
    eq('扩容后读档不砍件数', round.inventory.length, 66);
    eq('读档保留军需官等级', round.facilities.quartermaster, 1);
    // 没扩容的档仍然按 60 截断
    const legacy = JSON.parse(P.serializeSave(save));
    legacy.facilities.quartermaster = 0;
    legacy.inventory = legacy.inventory.concat([mkSlotItem('ring', 5, 'common', []), mkSlotItem('ring', 5, 'common', []), mkSlotItem('ring', 5, 'common', [])]);
    eq('没扩容的档按 60 截断', P.sanitizeSave(legacy).inventory.length, 60);
}

// ==================== 5. 训练场：洗点价格与天赋方案 ====================

function spendOneTalent(save) {
    const id = 'warrior_steel_t1_0';
    save.level = 10;
    save.talents = { [id]: 3 };
    return id;
}

{
    const save = mkSave();
    eq('训练场 0 级：天赋洗点 200', P.talentRespecCost(save), 200);
    eq('训练场 0 级：变体洗点 500', P.variantRespecCost(save), 500);
    save.facilities.training = 1;
    eq('训练场 1 级：仍是原价', P.talentRespecCost(save), 200);
    save.facilities.training = 2;
    eq('训练场 2 级：天赋 100', P.talentRespecCost(save), 100);
    eq('训练场 2 级：变体 250', P.variantRespecCost(save), 250);
    save.facilities.training = 3;
    eq('训练场 3 级：天赋免费', P.talentRespecCost(save), 0);
    eq('训练场 3 级：变体免费', P.variantRespecCost(save), 0);

    // 免费洗点：0 金也能洗，且不会把金币扣成负数
    spendOneTalent(save);
    save.gold = 0;
    check('免费洗点不需要金币', P.respecTalents(save));
    eq('免费洗点不扣金币', save.gold, 0);
    eq('免费洗点清空天赋', P.talentPointsSpent(save.talents), 0);

    // 半价洗点：99 金不够、100 金刚好
    save.facilities.training = 2;
    spendOneTalent(save);
    save.gold = 99;
    check('半价：99 金不够', !P.respecTalents(save));
    save.gold = 100;
    check('半价：100 金刚好', P.respecTalents(save));
    eq('半价扣完为 0', save.gold, 0);
}

{
    // 训练场 0 级不能洗点（设计 §4.4：洗点在营地训练场，Lv1 解锁）
    const s0 = mkSave();
    spendOneTalent(s0);
    s0.gold = 1000;
    check('训练场 0 级不能洗点', !P.respecTalents(s0));
    eq('被拒洗点不扣金币', s0.gold, 1000);
    check('被拒洗点天赋还在', P.talentPointsSpent(s0.talents) > 0, true);
    s0.facilities.training = 1;
    check('训练场 1 级可以洗点', P.respecTalents(s0));
    eq('1 级洗点扣 200', s0.gold, 800);
}

{
    // 方案槽
    const save = mkSave();
    eq('训练场 3 级没有方案槽', K.canSaveTalentPreset(save, 0).reason, 'locked');
    save.facilities.training = 3;
    eq('训练场 3 级仍没有方案槽', K.canSaveTalentPreset(save, 0).slots, 0);
    save.facilities.training = 4;
    eq('训练场 4 级 1 个槽', K.canSaveTalentPreset(save, 0).slots, 1);
    eq('训练场 4 级第 2 槽不可用', K.canSaveTalentPreset(save, 1).reason, 'no-slot');
    save.facilities.training = 5;
    eq('训练场 5 级 2 个槽', K.canSaveTalentPreset(save, 1).slots, 2);

    save.level = 10;
    eq('没加点不能存方案', K.canSaveTalentPreset(save, 0).reason, 'no-points');
    save.talents = { warrior_steel_t1_0: 4 };
    check('存方案 A', K.saveTalentPreset(save, 0));
    eq('方案 A 内容', save.talentPresets[0].warrior_steel_t1_0, 4);
    save.talents = { warrior_steel_t1_1: 2 };
    check('存方案 B', K.saveTalentPreset(save, 1));
    check('载入方案 A', K.loadTalentPreset(save, 0));
    eq('载入后回到方案 A', save.talents.warrior_steel_t1_0, 4);
    eq('载入会覆盖当前', save.talents.warrior_steel_t1_1, undefined);
    eq('空槽不能载入', (() => {
        const s2 = mkSave();
        s2.facilities.training = 4;
        return K.canLoadTalentPreset(s2, 0).reason;
    })(), 'empty-preset');

    // 往返：坏档方案被归一
    const round = P.sanitizeSave(JSON.parse(P.serializeSave(save)));
    eq('方案往返保留', round.talentPresets[0].warrior_steel_t1_0, 4);
}

// ==================== 6. 铁匠铺：重铸 ====================

{
    const save = mkSave();
    const item = mkItem();
    eq('铁匠铺 0 级不能重铸', K.canReforge(save, item, []).reason, 'locked');
    eq('0 级锁位 0', K.maxReforgeLocks(save), 0);

    save.facilities.smith = 1;
    save.gold = 1000;
    eq('1 级锁位 0', K.maxReforgeLocks(save), 0);
    save.facilities.smith = 2;
    eq('2 级锁位 1', K.maxReforgeLocks(save), 1);
    save.facilities.smith = 3;
    eq('3 级锁位 2', K.maxReforgeLocks(save), 2);
    eq('锁 3 条被拒', K.canReforge(save, item, [0, 1, 2]).reason, 'too-many-locks');
    eq('全锁被拒', K.canReforge(save, mkItem({ affixes: [{ id: 'crit', points: 2 }] }), [0]).reason, 'all-locked');

    // 费用公式
    const it20 = mkItem({ ilvl: 20 });
    eq('1 级 / 无锁费用', K.reforgeGold(save, it20, 0), 40 + 6 * 20);
    eq('1 级 / 锁 1 费用 ×1.4', K.reforgeGold(save, it20, 1), Math.round(160 * 1.4));
    eq('1 级 / 锁 2 费用 ×1.8', K.reforgeGold(save, it20, 2), Math.round(160 * 1.8));
    save.facilities.smith = 4;
    eq('4 级 −25%', K.reforgeGold(save, it20, 0), Math.round(160 * 0.75));
    save.facilities.smith = 5;
    eq('5 级 −50%', K.reforgeGold(save, it20, 0), 80);
    save.facilities.smith = 3;

    save.gold = 0;
    eq('没钱不能重铸', K.canReforge(save, it20, []).reason, 'no-gold');
    save.gold = 1000;

    // 点数守恒 / 锁定不动 / 无重复 / 确定性
    const rolls = item.affixes.map((r) => r.points).join(',');
    const res = K.reforge(save, item, [0], () => 0);
    check('重铸成功', res.ok, res.reason);
    eq('扣掉对应金币', save.gold, 1000 - Math.round(160 * 1.4));
    eq('锁定词条不动', item.affixes[0].id, 'crit');
    eq('点数全部守恒', item.affixes.map((r) => r.points).join(','), rolls);
    eq('重铸了 3 条', res.changed.length, 3);
    check('没有重复词条', new Set(item.affixes.map((r) => r.id)).size === 4,
        item.affixes.map((r) => r.id).join(','));
    check('改动记录与实际一致',
        res.changed.every((c) => c.index > 0 && item.affixes[c.index].id === c.to));

    // 同 rng → 同结果
    const a = mkItem();
    const b = mkItem();
    const s1 = mkSave(); s1.facilities.smith = 3; s1.gold = 1000;
    const s2 = mkSave(); s2.facilities.smith = 3; s2.gold = 1000;
    K.reforge(s1, a, [], () => 0.5);
    K.reforge(s2, b, [], () => 0.5);
    eq('同 rng 同结果', a.affixes.map((r) => r.id).join(','), b.affixes.map((r) => r.id).join(','));

    // 1 词条装备：重铸后仍只有 1 条
    const thin = mkItem({ affixes: [{ id: 'crit', points: 1 }] });
    const r2 = K.reforge(save, thin, [], () => 0);
    check('单词条重铸成功', r2.ok, r2.reason);
    eq('单词条仍是 1 条', thin.affixes.length, 1);
    check('单词条仍是合法词条', !!F.AFFIX_BY_ID[thin.affixes[0].id], thin.affixes[0].id);
    eq('单词条点数不变', thin.affixes[0].points, 1);
    check('单词条重铸一定会换词条（不让玩家以为没生效）', thin.affixes[0].id !== 'crit', thin.affixes[0].id);

    // 词条池只剩自己时（3 条锁 2 条）允许同名，且不重复、不崩
    const tight = mkItem({ affixes: [{ id: 'crit', points: 2 }, { id: 'haste', points: 2 }, { id: 'mastery', points: 2 }] });
    const r3 = K.reforge(save, tight, [0, 1], () => 0);
    check('只剩一个空位也能重铸', r3.ok, r3.reason);
    eq('空位词条只能是唯一剩下的那个', tight.affixes[2].id, 'vers');
    check('锁 2 条后仍无重复', new Set(tight.affixes.map((r) => r.id)).size === 3,
        tight.affixes.map((r) => r.id).join(','));
}

// ==================== 7. 铁匠铺：分解 ====================

{
    const save = mkSave();
    save.facilities.smith = 1;
    const low = mkSlotItem('feet', 5, 'common', []);
    const mid = mkSlotItem('chest', 20, 'rare', []);
    const high = mkSlotItem('head', 40, 'legendary', []);
    eq('ilvl 5 拆灰烬', K.dismantleYield(low).materialId, 'ash_dust');
    eq('ilvl 20 拆霜晶', K.dismantleYield(mid).materialId, 'frost_crystal');
    eq('ilvl 40 拆秘银', K.dismantleYield(high).materialId, 'mithril_ore');
    eq('白装 ilvl5 产量 1', K.dismantleYield(low).count, 1);
    eq('蓝装 ilvl20 产量 1+2+1', K.dismantleYield(mid).count, 4);
    eq('橙装 ilvl40 产量 1+4+2', K.dismantleYield(high).count, 7);

    save.inventory = [mid];
    save.equips.chest = high;
    check('已装备的不能拆', !K.canDismantle(save, high.uid).ok);
    const got = K.dismantle(save, mid.uid);
    check('拆背包件成功', !!got);
    eq('拆完背包空', save.inventory.length, 0);
    eq('材料入账', K.materialCount(save, 'frost_crystal'), 4);
    check('重复拆同一件失败', !K.dismantle(save, mid.uid));

    const noSmith = mkSave();
    noSmith.inventory = [mkSlotItem('ring', 5, 'common', [])];
    eq('没铁匠铺不能拆', K.canDismantle(noSmith, noSmith.inventory[0].uid).reason, 'locked');
}

// ==================== 8. 附魔台：词条转移 ====================

{
    const save = mkSave();
    const src = mkSlotItem('ring', 5, 'rare', [
        { id: 'crit', points: 1 }, { id: 'haste', points: 1 },
    ]);
    const dst = mkSlotItem('mainHand', 20, 'epic', [
        { id: 'mastery', points: 2 }, { id: 'vers', points: 2 },
    ]);
    save.inventory = [src];
    save.equips.mainHand = dst;

    eq('附魔台 0 级拒绝', K.canEnchant(save, src.uid, [0], dst.uid).reason, 'locked');
    save.facilities.enchant = 1;
    save.gold = 500;
    save.materials.frost_crystal = 10;
    eq('1 级一次只能转 1 条', K.enchantMaxTransfer(save), 1);
    eq('一次转 2 条被拒（1 级）', K.canEnchant(save, src.uid, [0, 1], dst.uid).reason, 'bad-affix');
    check('源必须是背包件', !K.canEnchant(save, dst.uid, [0], src.uid).ok);
    eq('同件拒绝', K.canEnchant(save, src.uid, [0], src.uid).reason, 'same-item');

    // 成功：源被消耗（Lv1）、目标 +1 条、点数原样
    const roll = src.affixes[0];
    const chk = K.canEnchant(save, src.uid, [0], dst.uid);
    check('1 级附魔判定通过', chk.ok, chk.reason);
    eq('材料按目标装等取霜晶', chk.cost.materialId, 'frost_crystal');
    eq('1 级材料 2 份', chk.cost.count, 2);
    eq('金币 80', chk.cost.gold, 80);
    const done = K.enchant(save, src.uid, [0], dst.uid);
    check('附魔成功', done.ok, done.reason);
    eq('源装备被消耗', save.inventory.length, 0);
    eq('目标多了 1 条', dst.affixes.length, 3);
    eq('转移过来的词条 id', dst.affixes[2].id, roll.id);
    eq('点数原样', dst.affixes[2].points, roll.points);
    eq('扣金币', save.gold, 420);
    eq('扣材料', K.materialCount(save, 'frost_crystal'), 8);

    // 重复词条
    const src2 = mkSlotItem('ring', 5, 'rare', [{ id: 'mastery', points: 1 }]);
    save.inventory = [src2];
    eq('目标已有同名词条拒绝', K.canEnchant(save, src2.uid, [0], dst.uid).reason, 'duplicate');

    // 目标条数上限：蓝装 2 条
    const blue = mkSlotItem('legs', 10, 'uncommon', [
        { id: 'crit', points: 1 }, { id: 'haste', points: 1 },
    ]);
    save.equips.legs = blue;
    save.inventory = [mkSlotItem('ring', 5, 'rare', [
        { id: 'vers', points: 1 }, { id: 'mastery', points: 1 },
    ])];
    eq('蓝装目标已满 2 条', K.canEnchant(save, save.inventory[0].uid, [0], blue.uid).reason, 'target-full');
    save.facilities.enchant = 5;
    save.materials.ash_dust = 10;
    check('Lv5 放开品质条数限制', K.canEnchant(save, save.inventory[0].uid, [0], blue.uid).ok,
        K.canEnchant(save, save.inventory[0].uid, [0], blue.uid).reason);

    // Lv3 起保留源装备
    save.facilities.enchant = 3;
    const src3 = mkSlotItem('ring', 5, 'rare', [
        { id: 'crit', points: 1 }, { id: 'haste', points: 1 },
    ]);
    const dst3 = mkSlotItem('chest', 10, 'epic', [{ id: 'vers', points: 1 }]);
    save.inventory = [src3];
    save.equips.chest = dst3;
    save.gold = 500;
    save.materials.ash_dust = 10;
    check('Lv3 转移成功', K.enchant(save, src3.uid, [0], dst3.uid).ok);
    eq('Lv3 源装备保留', save.inventory.length, 1);
    eq('Lv3 源少了一条', src3.affixes.length, 1);

    // Lv3 不能把源掏空
    eq('Lv3 不能转移最后一条', K.canEnchant(save, src3.uid, [0], dst3.uid).reason, 'last-affix');

    // Lv4 材料减半
    save.facilities.enchant = 4;
    eq('Lv4 材料 1 份', K.enchantMaterialCost(save), 1);

    // 金币 / 材料不足（用 haste —— dst3 已有 vers + crit）
    const src4 = mkSlotItem('ring', 5, 'rare', [
        { id: 'crit', points: 1 }, { id: 'haste', points: 1 },
    ]);
    save.inventory = [src4];
    save.gold = 10;
    eq('金币不足拒绝', K.canEnchant(save, src4.uid, [1], dst3.uid).reason, 'no-gold');
    save.gold = 500;
    save.materials.ash_dust = 0;
    eq('材料不足拒绝', K.canEnchant(save, src4.uid, [1], dst3.uid).reason, 'no-material');

    // Lv2 一次两条
    save.facilities.enchant = 2;
    save.materials.ash_dust = 10;
    eq('Lv2 一次可转 2 条', K.enchantMaxTransfer(save), 2);
    const src5 = mkSlotItem('ring', 5, 'rare', [
        { id: 'crit', points: 1 }, { id: 'haste', points: 1 },
    ]);
    const dst5 = mkSlotItem('feet', 10, 'epic', []);
    save.inventory = [src5];
    save.equips.feet = dst5;
    save.equips.chest = null;
    const r5 = K.enchant(save, src5.uid, [0, 1], dst5.uid);
    check('Lv2 一次转 2 条成功', r5.ok, r5.reason);
    eq('目标 2 条', dst5.affixes.length, 2);
    eq('源被消耗', save.inventory.length, 0);
}

// ==================== 9. 厨房 ====================

{
    const save = mkSave();
    eq('厨房 0 级没有料理', K.availableMeals(save).length, 0);
    eq('厨房 0 级不能买', K.canBuyMeal(save, 'pot_roast').reason, 'locked');
    save.facilities.kitchen = 1;
    eq('厨房 1 级 3 种', K.availableMeals(save).length, 3);
    eq('厨房 1 级 1 个槽', P.mealSlotsFor(save), 1);
    eq('厨房 1 级不能买二档料理', K.canBuyMeal(save, 'honey_wings').reason, 'tier');
    save.facilities.kitchen = 2;
    eq('厨房 2 级 5 种', K.availableMeals(save).length, 5);
    save.facilities.kitchen = 3;
    eq('厨房 3 级 2 个槽', P.mealSlotsFor(save), 2);
    save.facilities.kitchen = 5;
    eq('厨房 5 级持续 3 场', P.mealDurationFor(save), 3);
    save.facilities.kitchen = 1;

    save.gold = 1000;
    save.materials.ash_dust = 10;
    check('买料理成功', K.buyMeal(save, 'pot_roast'));
    eq('扣金币', save.gold, 960);
    eq('扣材料', K.materialCount(save, 'ash_dust'), 9);
    eq('料理入场', save.meals.length, 1);
    eq('1 场（1 级厨房）', save.meals[0].runsLeft, 1);
    eq('重复料理拒绝', K.canBuyMeal(save, 'pot_roast').reason, 'duplicate');
    eq('槽位满了拒绝', K.canBuyMeal(save, 'swift_soup').reason, 'no-slot');

    // 场次扣减
    eq('打完一场料理吃完', K.consumeMealBattle(save).join(','), '力量炖锅');
    eq('吃完移除', save.meals.length, 0);
    eq('第二场没有可扣的', K.consumeMealBattle(save).length, 0);

    // 多场：Lv5
    save.facilities.kitchen = 5;
    K.buyMeal(save, 'pot_roast');
    eq('3 场', save.meals[0].runsLeft, 3);
    eq('一场后剩 2', (K.consumeMealBattle(save), save.meals[0].runsLeft), 2);
    eq('两场后剩 1', (K.consumeMealBattle(save), save.meals[0].runsLeft), 1);
    eq('三场后吃完', K.consumeMealBattle(save).length, 1);
    eq('吃完清空', save.meals.length, 0);

    // 乘数
    save.facilities.kitchen = 1;
    save.meals = [{ id: 'pot_roast', runsLeft: 1 }];
    near('攻击强度 +10%', K.mealMultipliers(save).ap, 0.10);
    save.meals = [{ id: 'pot_roast', runsLeft: 1 }, { id: 'iron_bread', runsLeft: 1 }];
    near('生命 +12%', K.mealMultipliers(save).hp, 0.12);
    eq('1 级厨房只算现有料理（槽位不参与计算）', K.mealMultipliers(save).crit, 0);
    save.facilities.kitchen = 4;
    near('Lv4 效果 ×1.5', K.mealMultipliers(save).ap, 0.15);
    save.meals = [{ id: 'honey_wings', runsLeft: 1 }];
    near('暴击 +7.5%（Lv4）', K.mealMultipliers(save).crit, 0.075);
    save.meals = [{ id: 'mithril_broth', runsLeft: 1 }];
    near('全能 +7.5%（Lv4）', K.mealMultipliers(save).vers, 0.075);

    // 真正进 profile
    const p1 = mkSave({ level: 10 });
    const base = C.profileFromSave(p1, 0);
    p1.facilities.kitchen = 1;
    p1.meals = [{ id: 'pot_roast', runsLeft: 1 }, { id: 'iron_bread', runsLeft: 1 }];
    const buffed = C.profileFromSave(p1, 0);
    near('profile 攻击强度 ×1.10', buffed.attackPower, base.attackPower * 1.10, 1e-9);
    near('profile 生命上限 ×1.12', buffed.maxHp, base.maxHp * 1.12, 1e-9);
    p1.meals = [{ id: 'swift_soup', runsLeft: 1 }, { id: 'honey_wings', runsLeft: 1 }];
    const buffed2 = C.profileFromSave(p1, 0);
    near('profile 急速 +8%', buffed2.haste - base.haste, 0.08, 1e-9);
    near('profile 暴击 +5%', buffed2.critChance - base.critChance, 0.05, 1e-9);

    // 吃完回到原样
    p1.meals = [{ id: 'pot_roast', runsLeft: 1 }];
    K.consumeMealBattle(p1);
    const after = C.profileFromSave(p1, 0);
    near('料理吃完后攻击强度回到基准', after.attackPower, base.attackPower, 1e-9);
}

// ==================== 10. 军需官 ====================

{
    const save = mkSave();
    eq('默认悬赏位 3', K.bountySlots(save), 3);
    save.facilities.quartermaster = 1;
    eq('1 级仍是 3', K.bountySlots(save), 3);
    save.facilities.quartermaster = 2;
    eq('2 级 6 个', K.bountySlots(save), 6);
    eq('仓库 +12', K.storageBonus(save), 12);
    eq('仓库上限 72', P.inventoryCapFor(save), 72);
}

// ==================== 结果 ====================

if (failures.length === 0) {
    console.log(`\nMITHRIL_CAMP_OK —— ${passed} 项检查全部通过`);
    process.exit(0);
}
console.error(`\n失败 ${failures.length} 项（通过 ${passed} 项）：`);
for (const f of failures) console.error(`  - ${f}`);
process.exit(1);
