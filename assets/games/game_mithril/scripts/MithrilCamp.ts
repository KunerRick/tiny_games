/**
 * 《秘银远征》营地（M5，纯逻辑，**不得 import cc**）。
 *
 * 设计依据（docs/plans/2026-11-14-game-mithril-design.md §4.6 / §4.3）：
 *  - 5 设施各 5 级，**升级只用材料**（金币留给重铸，形成两条经济线）
 *  - 铁匠铺：重铸（重掷未锁定的词条，锁位数随等级提升）/ 分解
 *  - 附魔台：把源装备的一条（Lv2 起两条）词条转移到目标装备；Lv3 起保留源装备
 *  - 训练场：洗点折扣（Lv2 半价 / Lv3 免费）+ 天赋方案槽（Lv4 一个 / Lv5 两个）
 *  - 厨房：5 种料理，按场次生效（Lv3 双份、Lv4 效果 +50%、Lv5 持续 3 场）
 *  - 军需官：装备仓库每级 +6 格、Lv2 起悬赏位 6
 *
 * 所有「能不能做」的判定都返回 `{ ok, reason }`，UI 只负责把 reason 翻成人话；
 * 随机全部由调用方传入的 `rng` 驱动，便于自检锁死结果。
 */

import {
    AFFIXES,
    BOUNTY_SLOTS_BASE,
    BOUNTY_SLOTS_LEVEL,
    BOUNTY_SLOTS_UPGRADED,
    DISMANTLE_BASE,
    DISMANTLE_ILVL_STEP,
    DISMANTLE_PER_QUALITY,
    ENCHANT_GOLD,
    ENCHANT_HARD_AFFIX_CAP,
    ENCHANT_MATERIAL_COUNT,
    FACILITIES,
    FACILITY_BY_ID,
    FACILITY_MAX_LEVEL,
    GEAR_SLOTS,
    KITCHEN_BONUS_LEVEL,
    KITCHEN_BONUS_MUL,
    MEALS,
    MEAL_BY_ID,
    QUALITY_BY_ID,
    QUARTERMASTER_SLOTS_PER_LEVEL,
    REFORGE_DISCOUNT,
    REFORGE_GOLD_BASE,
    REFORGE_GOLD_PER_ILVL,
    REFORGE_LOCK_LEVELS,
    REFORGE_LOCK_MUL,
} from './MithrilConfig';
import type { AffixId, AffixRoll, EquipItem, FacilityId, GearSlot } from './MithrilConfig';
import { qualityIndex } from './MithrilLoot';
import {
    facilityLevel,
    mealDurationFor,
    mealSlotsFor,
    talentPresetSlots,
    talentPointsSpent,
} from './MithrilProgress';
import type { MithrilSave, TalentState } from './MithrilProgress';
import { advanceBountyMetric } from './MithrilBounty';

// ==================== 材料 ====================

export function materialCount(save: MithrilSave, materialId: string): number {
    const raw = save.materials ? save.materials[materialId] : 0;
    return Math.max(0, Math.floor(Number(raw) || 0));
}

/** 扣材料；不够返回 false（调用前请先用 canPayMaterials 判定，避免扣一半） */
export function payMaterial(save: MithrilSave, materialId: string, count: number): boolean {
    const need = Math.max(0, Math.floor(count || 0));
    if (need <= 0) return true;
    if (materialCount(save, materialId) < need) return false;
    save.materials[materialId] = materialCount(save, materialId) - need;
    return true;
}

export function gainMaterial(save: MithrilSave, materialId: string, count: number): number {
    const add = Math.max(0, Math.floor(count || 0));
    if (add <= 0) return materialCount(save, materialId);
    save.materials[materialId] = materialCount(save, materialId) + add;
    return save.materials[materialId];
}

/** 材料按装等分档：<15 灰烬、<30 霜晶、其余秘银（分解与附魔材料费共用） */
export function materialForIlvl(ilvl: number): string {
    const v = Math.max(1, Math.floor(Number(ilvl) || 1));
    if (v < 15) return 'ash_dust';
    if (v < 30) return 'frost_crystal';
    return 'mithril_ore';
}

// ==================== 设施升级 ====================

export type CampReason =
    | ''
    | 'locked'
    | 'max-level'
    | 'no-gold'
    | 'no-material'
    | 'bad-item'
    | 'bad-affix'
    | 'bad-target'
    | 'same-item'
    | 'no-affix'
    | 'duplicate'
    | 'target-full'
    | 'last-affix'
    | 'too-many-locks'
    | 'all-locked'
    | 'no-slot'
    | 'tier'
    | 'empty-preset'
    | 'no-points';

export interface CampCostDef {
    materialId: string;
    count: number;
    gold: number;
}

export interface CampCheck {
    ok: boolean;
    reason: CampReason;
    cost?: CampCostDef;
}

export function facilityDef(id: FacilityId) {
    return FACILITY_BY_ID[id];
}

export interface FacilityUpgradeCheck extends CampCheck {
    level: number;
    nextLevel: number;
}

export function canUpgradeFacility(save: MithrilSave, id: FacilityId): FacilityUpgradeCheck {
    const level = facilityLevel(save, id);
    const nextLevel = Math.min(FACILITY_MAX_LEVEL, level + 1);
    if (level >= FACILITY_MAX_LEVEL) return { ok: false, reason: 'max-level', level, nextLevel };
    const def = FACILITY_BY_ID[id];
    const cost = def && def.costs[level] ? def.costs[level] : null;
    if (!cost) return { ok: false, reason: 'max-level', level, nextLevel };
    if (materialCount(save, cost.materialId) < cost.count) {
        return {
            ok: false,
            reason: 'no-material',
            level,
            nextLevel,
            cost: { materialId: cost.materialId, count: cost.count, gold: 0 },
        };
    }
    return {
        ok: true,
        reason: '',
        level,
        nextLevel,
        cost: { materialId: cost.materialId, count: cost.count, gold: 0 },
    };
}

/** 升一级；材料不够返回 false（不扣任何东西） */
export function upgradeFacility(save: MithrilSave, id: FacilityId): boolean {
    const check = canUpgradeFacility(save, id);
    if (!check.ok || !check.cost) return false;
    if (!payMaterial(save, check.cost.materialId, check.cost.count)) return false;
    save.facilities[id] = check.nextLevel;
    return true;
}

/** 全部设施 id（页签顺序，直接转发 Config） */
export const CAMP_FACILITY_IDS: readonly FacilityId[] = FACILITIES.map((f) => f.id);

// ==================== 装备持有 ====================

export interface OwnedItem {
    uid: string;
    item: EquipItem;
    /** 是否穿在身上 */
    equipped: boolean;
    slot: GearSlot;
}

/** 已装备的（按槽位顺序）+ 背包的（排序口径与装备面板一致） */
export function ownedItems(save: MithrilSave): OwnedItem[] {
    const out: OwnedItem[] = [];
    for (const slot of GEAR_SLOTS) {
        const item = save.equips ? save.equips[slot] : null;
        if (item) out.push({ uid: item.uid, item, equipped: true, slot });
    }
    const inv = Array.isArray(save.inventory) ? save.inventory.slice() : [];
    inv.sort((a, b) => {
        if (b.ilvl !== a.ilvl) return b.ilvl - a.ilvl;
        const dq = qualityIndex(b.quality) - qualityIndex(a.quality);
        if (dq !== 0) return dq;
        return a.baseId < b.baseId ? -1 : a.baseId > b.baseId ? 1 : 0;
    });
    for (const item of inv) out.push({ uid: item.uid, item, equipped: false, slot: item.slot });
    return out;
}

export function findOwned(save: MithrilSave, uid: string): OwnedItem | null {
    if (!uid) return null;
    for (const entry of ownedItems(save)) if (entry.uid === uid) return entry;
    return null;
}

/** 背包里的（附魔源装备只从这里挑：穿在身上的件被消耗太反直觉） */
export function inventoryItems(save: MithrilSave): OwnedItem[] {
    return ownedItems(save).filter((e) => !e.equipped);
}

// ==================== 铁匠铺：重铸 ====================

/** 当前等级可锁的词条条数（Lv2 → 1、Lv3 → 2） */
export function maxReforgeLocks(save: MithrilSave): number {
    const lv = facilityLevel(save, 'smith');
    let locks = 0;
    for (const need of REFORGE_LOCK_LEVELS) if (lv >= need) locks++;
    return locks;
}

/** 重铸金币：基础随装等涨，每锁一条 +40%，Lv4 −25%、Lv5 −50% */
export function reforgeGold(save: MithrilSave, item: EquipItem, locks: number): number {
    const lv = facilityLevel(save, 'smith');
    const base = REFORGE_GOLD_BASE + REFORGE_GOLD_PER_ILVL * Math.max(1, Math.floor(item.ilvl || 1));
    const lockMul = 1 + REFORGE_LOCK_MUL * Math.max(0, Math.min(2, locks || 0));
    const discount = REFORGE_DISCOUNT[lv] !== undefined ? REFORGE_DISCOUNT[lv] : 1;
    return Math.max(1, Math.round(base * lockMul * discount));
}

export interface ReforgeCheck extends CampCheck {
    cost?: CampCostDef;
}

export function canReforge(save: MithrilSave, item: EquipItem | null, locked: number[]): ReforgeCheck {
    if (!item) return { ok: false, reason: 'bad-item' };
    if (facilityLevel(save, 'smith') <= 0) return { ok: false, reason: 'locked' };
    const rolls = Array.isArray(item.affixes) ? item.affixes : [];
    if (rolls.length === 0) return { ok: false, reason: 'no-affix' };
    const locks = uniqueIndexes(locked, rolls.length);
    if (locks.length > maxReforgeLocks(save)) return { ok: false, reason: 'too-many-locks' };
    if (locks.length >= rolls.length) return { ok: false, reason: 'all-locked' };
    const gold = reforgeGold(save, item, locks.length);
    const cost: CampCostDef = { materialId: '', count: 0, gold };
    if (Math.max(0, Math.floor(save.gold || 0)) < gold) return { ok: false, reason: 'no-gold', cost };
    return { ok: true, reason: '', cost };
}

export interface ReforgeResult extends CampCheck {
    cost?: CampCostDef;
    changed: Array<{ index: number; from: AffixId; to: AffixId }>;
}

/**
 * 重铸：把**未锁定**的词条全部换成新词条，点数保持不变（点数预算属于装等，不属于词条）。
 * 锁定位置保留原词条，新词条不会与保留的重复。
 */
export function reforge(
    save: MithrilSave,
    item: EquipItem | null,
    locked: number[],
    rng: () => number,
): ReforgeResult {
    const check = canReforge(save, item, locked);
    if (!check.ok || !item || !check.cost) return { ok: false, reason: check.reason, changed: [] };
    const rolls = item.affixes;
    const locks = uniqueIndexes(locked, rolls.length);
    const kept: AffixId[] = locks.map((i) => rolls[i].id);
    const pool = AFFIXES.map((a) => a.id).filter((id) => kept.indexOf(id) < 0);
    if (pool.length === 0) return { ok: false, reason: 'all-locked', changed: [] };

    const changed: Array<{ index: number; from: AffixId; to: AffixId }> = [];
    const free = pool.slice();
    const next: AffixRoll[] = rolls.map((roll, i) => {
        if (locks.indexOf(i) >= 0) return { id: roll.id, points: roll.points };
        // 优先避开自己：词条池还够时保证重铸一定看得见变化（否则玩家会以为按钮没生效）
        const choices = free.filter((id) => id !== roll.id);
        const source = choices.length > 0 ? choices : free;
        const pickIdx = Math.floor(clamp01(rng()) * source.length);
        const id = source[Math.min(pickIdx, source.length - 1)];
        free.splice(free.indexOf(id), 1);
        changed.push({ index: i, from: roll.id, to: id });
        return { id, points: roll.points };
    });
    // 词条池（4 种）不够替换时保留原词条，绝不产生重复 id
    if (free.length < 0) return { ok: false, reason: 'bad-affix', changed: [] };

    save.gold = Math.max(0, Math.floor(save.gold || 0) - check.cost.gold);
    item.affixes = next;
    return { ok: true, reason: '', cost: check.cost, changed };
}

// ==================== 铁匠铺：分解 ====================

export interface DismantleYield {
    materialId: string;
    count: number;
}

export function dismantleYield(item: EquipItem): DismantleYield {
    const materialId = materialForIlvl(item.ilvl);
    const count = DISMANTLE_BASE
        + qualityIndex(item.quality) * DISMANTLE_PER_QUALITY
        + Math.floor(Math.max(0, item.ilvl) / DISMANTLE_ILVL_STEP);
    return { materialId, count: Math.max(1, count) };
}

export interface DismantleCheck extends CampCheck {
    yield?: DismantleYield;
}

export function canDismantle(save: MithrilSave, uid: string): DismantleCheck {
    if (facilityLevel(save, 'smith') <= 0) return { ok: false, reason: 'locked' };
    const idx = inventoryIndex(save, uid);
    if (idx < 0) return { ok: false, reason: 'bad-item' };
    const item = save.inventory[idx];
    if (!item) return { ok: false, reason: 'bad-item' };
    return { ok: true, reason: '', yield: dismantleYield(item) };
}

/** 分解一件**背包里的**装备（已装备的不动，避免手滑把主手拆了） */
export function dismantle(save: MithrilSave, uid: string): DismantleYield | null {
    const check = canDismantle(save, uid);
    if (!check.ok || !check.yield) return null;
    const idx = inventoryIndex(save, uid);
    if (idx < 0) return null;
    save.inventory.splice(idx, 1);
    gainMaterial(save, check.yield.materialId, check.yield.count);
    // 悬赏（M8）：分解类悬赏自动计数（所有入口共用，面板 / 脚本都走这里）
    advanceBountyMetric(save, 'dismantle', 1);
    return check.yield;
}

// ==================== 附魔台：词条转移 ====================

/** 一次能转移几条：Lv1 一条、Lv2 起两条 */
export function enchantMaxTransfer(save: MithrilSave): number {
    return facilityLevel(save, 'enchant') >= 2 ? 2 : 1;
}

/** 目标装备能带几条词条：Lv5 之前受品质条数限制，Lv5 起只受 4 条硬上限约束 */
export function enchantTargetCap(save: MithrilSave, target: EquipItem): number {
    if (facilityLevel(save, 'enchant') >= 5) return ENCHANT_HARD_AFFIX_CAP;
    const q = QUALITY_BY_ID[target.quality];
    return Math.min(ENCHANT_HARD_AFFIX_CAP, q ? q.affixCount : 1);
}

/** 附魔材料费：Lv4 起减半 */
export function enchantMaterialCost(save: MithrilSave): number {
    return facilityLevel(save, 'enchant') >= 4 ? Math.ceil(ENCHANT_MATERIAL_COUNT / 2) : ENCHANT_MATERIAL_COUNT;
}

export interface EnchantCheck extends CampCheck {
    rolls?: AffixRoll[];
}

/**
 * 附魔判定：源装备必须在背包里，idx 是被转移的词条下标；
 * 目标可以是已装备或背包里的任一件（不能是源装备自己）。
 */
export function canEnchant(
    save: MithrilSave,
    srcUid: string,
    idxs: number[],
    dstUid: string,
): EnchantCheck {
    if (facilityLevel(save, 'enchant') <= 0) return { ok: false, reason: 'locked' };
    const srcIdx = inventoryIndex(save, srcUid);
    if (srcIdx < 0) return { ok: false, reason: 'bad-item' };
    const src = save.inventory[srcIdx];
    const dstEntry = findOwned(save, dstUid);
    if (!src || !dstEntry) return { ok: false, reason: 'bad-target' };
    const dst = dstEntry.item;
    if (src.uid === dst.uid) return { ok: false, reason: 'same-item' };

    const srcRolls = Array.isArray(src.affixes) ? src.affixes : [];
    const picked = uniqueIndexes(idxs, srcRolls.length);
    if (picked.length === 0) return { ok: false, reason: 'bad-affix' };
    if (picked.length > enchantMaxTransfer(save)) return { ok: false, reason: 'bad-affix' };

    const keepSource = facilityLevel(save, 'enchant') >= 3;
    if (keepSource && picked.length >= srcRolls.length) return { ok: false, reason: 'last-affix' };

    const dstRolls = Array.isArray(dst.affixes) ? dst.affixes : [];
    if (dstRolls.length + picked.length > enchantTargetCap(save, dst)) {
        return { ok: false, reason: 'target-full' };
    }
    const dstIds = dstRolls.map((r) => r.id);
    for (const i of picked) {
        if (dstIds.indexOf(srcRolls[i].id) >= 0) return { ok: false, reason: 'duplicate' };
    }

    const materialId = materialForIlvl(dst.ilvl);
    const count = enchantMaterialCost(save);
    const cost: CampCostDef = { materialId, count, gold: ENCHANT_GOLD };
    if (Math.max(0, Math.floor(save.gold || 0)) < ENCHANT_GOLD) return { ok: false, reason: 'no-gold', cost };
    if (materialCount(save, materialId) < count) return { ok: false, reason: 'no-material', cost };

    return { ok: true, reason: '', cost, rolls: picked.map((i) => srcRolls[i]) };
}

/** 执行转移：源扣词条（Lv3 起保留源装备，否则源装备被消耗）、目标加词条 */
export function enchant(
    save: MithrilSave,
    srcUid: string,
    idxs: number[],
    dstUid: string,
): CampCheck {
    const check = canEnchant(save, srcUid, idxs, dstUid);
    if (!check.ok || !check.cost || !check.rolls) return { ok: false, reason: check.reason };
    const srcIdx = inventoryIndex(save, srcUid);
    const dstEntry = findOwned(save, dstUid);
    if (srcIdx < 0 || !dstEntry) return { ok: false, reason: 'bad-item' };
    const src = save.inventory[srcIdx];
    const dst = dstEntry.item;
    const picked = uniqueIndexes(idxs, src.affixes.length);

    if (!payMaterial(save, check.cost.materialId, check.cost.count)) {
        return { ok: false, reason: 'no-material' };
    }
    save.gold = Math.max(0, Math.floor(save.gold || 0) - check.cost.gold);

    // 从大到小删，下标不漂
    const descending = picked.slice().sort((a, b) => b - a);
    for (const i of descending) src.affixes.splice(i, 1);
    for (const roll of check.rolls) dst.affixes.push({ id: roll.id, points: roll.points });

    if (facilityLevel(save, 'enchant') < 3) save.inventory.splice(srcIdx, 1);
    return { ok: true, reason: '', cost: check.cost };
}

// ==================== 训练场：天赋方案 ====================

export interface PresetCheck extends CampCheck {
    slots: number;
}

export function canSaveTalentPreset(save: MithrilSave, slot: number): PresetCheck {
    const slots = talentPresetSlots(save);
    if (slots <= 0) return { ok: false, reason: 'locked', slots };
    if (!Number.isFinite(slot) || slot < 0 || slot >= slots) return { ok: false, reason: 'no-slot', slots };
    if (talentPointsSpent(save.talents) <= 0) return { ok: false, reason: 'no-points', slots };
    return { ok: true, reason: '', slots };
}

export function canLoadTalentPreset(save: MithrilSave, slot: number): PresetCheck {
    const slots = talentPresetSlots(save);
    if (slots <= 0) return { ok: false, reason: 'locked', slots };
    if (!Number.isFinite(slot) || slot < 0 || slot >= slots) return { ok: false, reason: 'no-slot', slots };
    const preset = save.talentPresets ? save.talentPresets[slot] : null;
    if (!preset || Object.keys(preset).length === 0) return { ok: false, reason: 'empty-preset', slots };
    return { ok: true, reason: '', slots };
}

/** 把当前天赋存进方案槽（保存不花任何资源） */
export function saveTalentPreset(save: MithrilSave, slot: number): boolean {
    if (!canSaveTalentPreset(save, slot).ok) return false;
    const copy: TalentState = {};
    for (const id of Object.keys(save.talents)) {
        const rank = Math.max(0, Math.floor(save.talents[id] || 0));
        if (rank > 0) copy[id] = rank;
    }
    save.talentPresets[slot] = copy;
    return true;
}

/** 载入方案槽（直接覆盖当前天赋；不返还 / 不扣点） */
export function loadTalentPreset(save: MithrilSave, slot: number): boolean {
    const check = canLoadTalentPreset(save, slot);
    if (!check.ok) return false;
    const preset = save.talentPresets[slot];
    if (!preset) return false;
    const copy: TalentState = {};
    for (const id of Object.keys(preset)) {
        const rank = Math.max(0, Math.floor(preset[id] || 0));
        if (rank > 0) copy[id] = rank;
    }
    save.talents = copy;
    return true;
}

// ==================== 厨房：料理 ====================

export interface MealCheck extends CampCheck {
    mealId: string;
}

export function canBuyMeal(save: MithrilSave, mealId: string): MealCheck {
    const def = MEAL_BY_ID[mealId];
    if (!def) return { ok: false, reason: 'bad-item', mealId };
    const lv = facilityLevel(save, 'kitchen');
    if (lv <= 0) return { ok: false, reason: 'locked', mealId };
    if (def.tier > 1 && lv < 2) return { ok: false, reason: 'tier', mealId };
    const cost: CampCostDef = { materialId: def.materialId, count: def.materialCount, gold: def.gold };
    const active = Array.isArray(save.meals) ? save.meals : [];
    if (active.some((m) => m.id === mealId)) return { ok: false, reason: 'duplicate', mealId, cost };
    if (active.length >= mealSlotsFor(save)) return { ok: false, reason: 'no-slot', mealId, cost };
    if (Math.max(0, Math.floor(save.gold || 0)) < def.gold) return { ok: false, reason: 'no-gold', mealId, cost };
    if (materialCount(save, def.materialId) < def.materialCount) {
        return { ok: false, reason: 'no-material', mealId, cost };
    }
    return { ok: true, reason: '', mealId, cost };
}

/** 吃一份料理：立刻扣钱扣料，场次由厨房等级决定 */
export function buyMeal(save: MithrilSave, mealId: string): boolean {
    const check = canBuyMeal(save, mealId);
    if (!check.ok || !check.cost) return false;
    const def = MEAL_BY_ID[mealId];
    save.gold = Math.max(0, Math.floor(save.gold || 0) - def.gold);
    if (!payMaterial(save, def.materialId, def.materialCount)) return false;
    save.meals.push({ id: mealId, runsLeft: mealDurationFor(save) });
    return true;
}

export interface MealMultipliers {
    ap: number;
    hp: number;
    haste: number;
    crit: number;
    vers: number;
}

/** 生效中的料理 → 战斗 profile 乘数（厨房 Lv4 起 ×1.5） */
export function mealMultipliers(save: MithrilSave): MealMultipliers {
    const out: MealMultipliers = { ap: 0, hp: 0, haste: 0, crit: 0, vers: 0 };
    const meals = Array.isArray(save.meals) ? save.meals : [];
    if (meals.length === 0) return out;
    const mul = facilityLevel(save, 'kitchen') >= KITCHEN_BONUS_LEVEL ? KITCHEN_BONUS_MUL : 1;
    for (const state of meals) {
        const def = MEAL_BY_ID[state && state.id];
        if (!def || !(state.runsLeft > 0)) continue;
        out[def.stat] += def.pct * mul;
    }
    return out;
}

/** 一场战斗结束后扣场次；返回这一场吃完的料理名（结算面板要如实回报） */
export function consumeMealBattle(save: MithrilSave): string[] {
    const meals = Array.isArray(save.meals) ? save.meals : [];
    if (meals.length === 0) return [];
    const finished: string[] = [];
    for (const state of meals) {
        state.runsLeft = Math.max(0, Math.floor(state.runsLeft || 0) - 1);
        if (state.runsLeft <= 0) {
            const def = MEAL_BY_ID[state.id];
            finished.push(def ? def.name : state.id);
        }
    }
    save.meals = meals.filter((m) => m.runsLeft > 0);
    return finished;
}

/** 当前生效的料理（UI 用；不返回已过期的） */
export function activeMeals(save: MithrilSave): Array<{ def: typeof MEALS[number]; runsLeft: number }> {
    const out: Array<{ def: typeof MEALS[number]; runsLeft: number }> = [];
    for (const state of Array.isArray(save.meals) ? save.meals : []) {
        const def = MEAL_BY_ID[state.id];
        if (def && state.runsLeft > 0) out.push({ def, runsLeft: Math.floor(state.runsLeft) });
    }
    return out;
}

/** 厨房 Lv1 可做的 3 种 / Lv2 起的全部 5 种 */
export function availableMeals(save: MithrilSave): typeof MEALS {
    const lv = facilityLevel(save, 'kitchen');
    if (lv <= 0) return [];
    return lv >= 2 ? MEALS : MEALS.filter((m) => m.tier === 1);
}

// ==================== 军需官 ====================

/** 仓库扩容格数（0–30） */
export function storageBonus(save: MithrilSave): number {
    return facilityLevel(save, 'quartermaster') * QUARTERMASTER_SLOTS_PER_LEVEL;
}

/** 悬赏位：默认 3，军需官 Lv2 起 6（悬赏本体 M8） */
export function bountySlots(save: MithrilSave): number {
    return facilityLevel(save, 'quartermaster') >= BOUNTY_SLOTS_LEVEL
        ? BOUNTY_SLOTS_UPGRADED
        : BOUNTY_SLOTS_BASE;
}

// ==================== 小工具 ====================

function inventoryIndex(save: MithrilSave, uid: string): number {
    if (!uid || !Array.isArray(save.inventory)) return -1;
    for (let i = 0; i < save.inventory.length; i++) {
        if (save.inventory[i].uid === uid) return i;
    }
    return -1;
}

/** 去重 + 越界过滤 + 升序（词条下标一律按这个口径） */
function uniqueIndexes(raw: number[], length: number): number[] {
    const out: number[] = [];
    if (!Array.isArray(raw)) return out;
    for (const v of raw) {
        const i = Math.floor(Number(v));
        if (!Number.isFinite(i) || i < 0 || i >= length || out.indexOf(i) >= 0) continue;
        out.push(i);
    }
    out.sort((a, b) => a - b);
    return out;
}

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(0.999999, v));
}
