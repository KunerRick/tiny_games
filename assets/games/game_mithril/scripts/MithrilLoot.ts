/**
 * 《秘银远征》掉落 / 词条 roll / 背包（纯逻辑，**不得 import cc**）。
 *
 * 设计依据（docs/plans/2026-11-14-game-mithril-design.md §4.3）：
 *  - 8 槽位、6 品质，词条数 1/2/3/4/4/4
 *  - 词条点预算随装等线性解锁：全身 8 槽 × 4 = 32 点（ilvl40 满，ilvl10 全身 8 点）
 *  - 耐力每件固定附带、不占词条位
 *  - 紫装是副本 BOSS 的稳定产出；首通固定一件对应职业的紫装主手
 *
 * 随机全部由调用方传入的 `rng` 驱动（`MithrilCore.mulberry32`），
 * 同种子同参数 → 同物品，便于自检锁死分布与确定性。
 */

import {
    AFFIXES,
    AFFIX_BY_ID,
    AFFIX_POINT_CAP,
    DUNGEON_LOOT,
    GEAR_BASES,
    GEAR_BASE_BY_ID,
    GEAR_SLOTS,
    ILVL_MAX,
    MODIFIERS,
    QUALITIES,
    QUALITY_BY_ID,
    STAMINA_HP_PER_POINT,
    STAMINA_PER_ILVL,
} from './MithrilConfig';
import type {
    AffixId,
    AffixRoll,
    ClassId,
    EquipItem,
    GearSlot,
    QualityId,
} from './MithrilConfig';
import type { MithrilSave } from './MithrilProgress';
import { inventoryCapFor } from './MithrilProgress';

export const QUALITY_ORDER: QualityId[] = QUALITIES.map((q) => q.id);

/** 品质在序列里的档位（0 = 普通 … 5 = 秘境），用于比较 / 排序 / 售卖价 */
export function qualityIndex(quality: QualityId): number {
    const i = QUALITY_ORDER.indexOf(quality);
    return i < 0 ? 0 : i;
}

/** 每件装备可分配的词条点：ilvl 1→1、10→1、20→2、30→3、40→4（全身 8 槽满 32 点） */
export function itemAffixPoints(ilvl: number): number {
    const v = Math.max(0, Math.min(ILVL_MAX, Number(ilvl) || 0));
    return Math.max(1, Math.round(v / 10));
}

export function staminaOf(item: EquipItem): number {
    return Math.max(1, Math.round(item.ilvl * STAMINA_PER_ILVL));
}

/** 词条点 → 百分比数值（单项封顶，超出的点视为浪费） */
export function affixValue(id: AffixId, points: number): number {
    const def = AFFIX_BY_ID[id];
    if (!def) return 0;
    const p = Math.max(0, Math.min(AFFIX_POINT_CAP, Number(points) || 0));
    return Math.min(def.cap, p * def.perPoint);
}

// ==================== 品质 ====================

/**
 * 品质权重随装等上移：低装等几乎只有白绿，ilvl40 时紫/橙才成为常态。
 * 返回顺序与 QUALITY_ORDER 一致，调用方按序累加即可。
 */
export function qualityWeights(ilvl: number): number[] {
    const t = Math.max(0, Math.min(1, (Number(ilvl) || 0) / ILVL_MAX));
    return [
        52 * (1 - 0.75 * t),   // common
        30 * (1 - 0.30 * t),   // uncommon
        13 + 14 * t,           // rare
        4 + 9 * t,             // epic
        0.8 + 3 * t,           // legendary
        0.2 + 1.2 * t,         // mythic
    ];
}

export function rollQuality(rng: () => number, ilvl: number, minQuality: QualityId = 'common'): QualityId {
    const weights = qualityWeights(ilvl);
    const floor = qualityIndex(minQuality);
    let total = 0;
    for (let i = floor; i < weights.length; i++) total += weights[i];
    if (total <= 0) return QUALITY_ORDER[floor];
    let r = rng() * total;
    for (let i = floor; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return QUALITY_ORDER[i];
    }
    return QUALITY_ORDER[QUALITY_ORDER.length - 1];
}

// ==================== 词条 ====================

/**
 * 掷一件装备的词条：品质决定「想要几条」，预算决定「能写几条」。
 * 低装等装备点预算很少（ilvl<10 只有 1 点），此时品质只影响名称颜色，
 * 不会凭空多出点数——否则 1 级紫装就能顶满 32 点预算曲线。
 */
export function rollAffixes(rng: () => number, ilvl: number, wantedCount: number): AffixRoll[] {
    const points = itemAffixPoints(ilvl);
    const count = Math.max(1, Math.min(4, wantedCount | 0, points));
    // 洗牌取前 count 个词条池成员（Fisher–Yates，走同一 rng）
    const ids: AffixId[] = AFFIXES.map((a) => a.id);
    for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = ids[i];
        ids[i] = ids[j];
        ids[j] = tmp;
    }
    const chosen = ids.slice(0, count);
    const rolls: AffixRoll[] = chosen.map((id) => ({ id, points: 1 }));
    let left = points - count;
    let guard = 0;
    while (left > 0 && guard++ < 64) {
        const idx = Math.floor(rng() * rolls.length);
        if (rolls[idx].points >= AFFIX_POINT_CAP) continue;
        rolls[idx].points++;
        left--;
    }
    // 固定按词条池顺序输出，面板与自检都稳定
    rolls.sort((a, b) => AFFIXES.findIndex((x) => x.id === a.id) - AFFIXES.findIndex((x) => x.id === b.id));
    return rolls;
}

/** 按职业挑主手基型（0/1 战士，2/3 法师，4/5 游侠，6/7 牧师）；其它槽位随机 */
function pickBase(rng: () => number, slot: GearSlot, classId?: ClassId): string {
    const pool = GEAR_BASES.filter((b) => b.slot === slot);
    if (pool.length === 0) return '';
    if (slot === 'mainHand' && classId) {
        const band = { warrior: 0, mage: 2, ranger: 4, priest: 6 }[classId];
        const bandPool = pool.filter((b) => {
            const i = Number(b.id.split('_')[1]);
            return i === band || i === band + 1;
        });
        if (bandPool.length > 0) return bandPool[Math.floor(rng() * bandPool.length)].id;
    }
    return pool[Math.floor(rng() * pool.length)].id;
}

export interface RollItemOpts {
    ilvl: number;
    classId?: ClassId;
    slot?: GearSlot;
    quality?: QualityId;
    minQuality?: QualityId;
    /** 约 30% 掉落带改造词条（设计 §4.3）；默认 true */
    allowModifier?: boolean;
}

export function rollItem(rng: () => number, opts: RollItemOpts): EquipItem | null {
    const ilvl = Math.max(1, Math.min(ILVL_MAX, Math.round(Number(opts.ilvl) || 1)));
    const slot: GearSlot = opts.slot || GEAR_SLOTS[Math.floor(rng() * GEAR_SLOTS.length)];
    const baseId = pickBase(rng, slot, opts.classId);
    const base = GEAR_BASE_BY_ID[baseId];
    if (!base) return null;
    const quality = opts.quality || rollQuality(rng, ilvl, opts.minQuality || 'common');
    const qdef = QUALITY_BY_ID[quality];
    const affixes = rollAffixes(rng, ilvl, qdef ? qdef.affixCount : 1);
    const modifier = opts.allowModifier !== false && rng() < 0.3
        ? MODIFIERS[Math.floor(rng() * MODIFIERS.length)].id
        : undefined;
    return {
        uid: `it_${Math.floor(rng() * 0x7fffffff).toString(36)}`,
        baseId,
        slot,
        ilvl,
        quality,
        affixes,
        modifier,
    };
}

/** 首通固定紫装（各副本一件，对应职业主手）；副本未配置返回 null */
export function firstClearDrop(rng: () => number, classId: ClassId, dungeonId: string): EquipItem | null {
    const loot = DUNGEON_LOOT[dungeonId];
    if (!loot) return null;
    const baseId = loot.firstClearBase[classId] || '';
    const base = GEAR_BASE_BY_ID[baseId];
    if (!base) return null;
    const ilvl = Math.min(ILVL_MAX, loot.ilvl + 4);
    return {
        uid: `first_${dungeonId}_${Math.floor(rng() * 0x7fffffff).toString(36)}`,
        baseId,
        slot: base.slot,
        ilvl,
        quality: 'epic',
        affixes: rollAffixes(rng, ilvl, QUALITY_BY_ID.epic.affixCount),
        modifier: rng() < 0.5 ? MODIFIERS[Math.floor(rng() * MODIFIERS.length)].id : undefined,
    };
}

/**
 * BOSS 掉落：首通 = 固定紫装；重复刷 = 保底紫装 roll（设计 §4.3「紫/橙随机词条」）。
 * 返回 null 表示副本未配置或稀有到没出货（当前不会发生：保底紫）。
 */
export function bossLoot(
    rng: () => number,
    opts: { classId: ClassId; dungeonId: string; firstClear: boolean },
): EquipItem | null {
    if (opts.firstClear) return firstClearDrop(rng, opts.classId, opts.dungeonId);
    const loot = DUNGEON_LOOT[opts.dungeonId];
    const ilvl = loot ? loot.ilvl : 1;
    return rollItem(rng, { ilvl, classId: opts.classId, minQuality: 'epic' });
}

// ==================== 属性聚合 ====================

export interface EquipStats {
    crit: number;
    haste: number;
    mastery: number;
    vers: number;
    /** 耐力点数（1 点 = STAMINA_HP_PER_POINT 生命） */
    stamina: number;
    /** 生命加成（耐力换算后） */
    bonusHp: number;
    /** 已装备件数 */
    equipped: number;
    /** 已装备件数的平均装等（没穿装备为 1） */
    ilvl: number;
    /** 各词条的原始点数（面板显示「词条点数」用） */
    points: Record<AffixId, number>;
}

export function equipStats(equips: Partial<Record<GearSlot, EquipItem | null>>): EquipStats {
    const points: Record<AffixId, number> = { crit: 0, haste: 0, mastery: 0, vers: 0 };
    let stamina = 0;
    let ilvlSum = 0;
    let equipped = 0;
    for (const slot of GEAR_SLOTS) {
        const item = equips[slot];
        if (!item) continue;
        equipped++;
        ilvlSum += item.ilvl;
        stamina += staminaOf(item);
        for (const roll of item.affixes) {
            if (points[roll.id] === undefined) continue;
            points[roll.id] += Math.max(0, roll.points | 0);
        }
    }
    return {
        crit: affixValue('crit', points.crit),
        haste: affixValue('haste', points.haste),
        mastery: affixValue('mastery', points.mastery),
        vers: affixValue('vers', points.vers),
        stamina,
        bonusHp: stamina * STAMINA_HP_PER_POINT,
        equipped,
        ilvl: equipped > 0 ? ilvlSum / equipped : 1,
        points,
    };
}

// ==================== 背包操作 ====================

/**
 * 入包。**只有背包满才失败**。
 *
 * uid 撞车（固定种子重刷会生成同一件货）不丢件，改名为 `uid-1/2/…` 后照常入包 ——
 * 与 `sanitizeSave` 的坏档兼容口径一致。若撞的是**正在装备**那件，说明是重刷出来的
 * 另一件同名装备，改名后可以同时持有。
 */
export function addToInventory(save: MithrilSave, item: EquipItem): boolean {
    if (!item || !item.uid) return false;
    if (!Array.isArray(save.inventory)) save.inventory = [];
    if (save.inventory.length >= inventoryCapFor(save)) return false;
    let uid = item.uid;
    let n = 1;
    while (uidTaken(save, uid)) uid = `${item.uid}-${n++}`;
    if (uid !== item.uid) item.uid = uid;
    save.inventory.push(item);
    return true;
}

/** uid 是否已被背包或某个已装备槽占用 */
function uidTaken(save: MithrilSave, uid: string): boolean {
    for (const it of save.inventory) if (it.uid === uid) return true;
    for (const slot of GEAR_SLOTS) {
        const eq = save.equips[slot];
        if (eq && eq.uid === uid) return true;
    }
    return false;
}

export function findInventoryIndex(save: MithrilSave, uid: string): number {
    if (!Array.isArray(save.inventory)) return -1;
    for (let i = 0; i < save.inventory.length; i++) {
        if (save.inventory[i].uid === uid) return i;
    }
    return -1;
}

/**
 * 从背包穿上一件：原装备（若有）回到背包的同一位置。
 * 背包满时依然可以「换装」（件数不变），只有「穿上空格」在满包时需要空间。
 */
export function equipFromInventory(save: MithrilSave, uid: string): EquipItem | null {
    const idx = findInventoryIndex(save, uid);
    if (idx < 0) return null;
    const item = save.inventory[idx];
    if (!item) return null;
    const prev = save.equips[item.slot] || null;
    save.equips[item.slot] = item;
    if (prev) save.inventory[idx] = prev;
    else save.inventory.splice(idx, 1);
    return item;
}

export function unequipToInventory(save: MithrilSave, slot: GearSlot): boolean {
    const item = save.equips[slot];
    if (!item) return false;
    // 先脱下再走 addToInventory：满包时回滚，uid 冲突由它统一改名
    save.equips[slot] = null;
    if (!addToInventory(save, item)) {
        save.equips[slot] = item;
        return false;
    }
    return true;
}

/** 售卖价：品质越高、装等越高越值钱（M5 铁匠铺的经济基数） */
export function sellPrice(item: EquipItem): number {
    const q = qualityIndex(item.quality) + 1;
    return Math.max(1, Math.round((3 + item.ilvl * 0.6) * q));
}

export function sellFromInventory(save: MithrilSave, uid: string): number {
    const idx = findInventoryIndex(save, uid);
    if (idx < 0) return 0;
    const item = save.inventory[idx];
    const gold = sellPrice(item);
    save.inventory.splice(idx, 1);
    save.gold = Math.max(0, (Number(save.gold) || 0) + gold);
    return gold;
}

/** 背包排序：装等降序 → 品质降序 → 名字（面板与自检都按这个口径） */
export function sortedInventory(save: MithrilSave): EquipItem[] {
    const list = Array.isArray(save.inventory) ? save.inventory.slice() : [];
    list.sort((a, b) => {
        if (b.ilvl !== a.ilvl) return b.ilvl - a.ilvl;
        const dq = qualityIndex(b.quality) - qualityIndex(a.quality);
        if (dq !== 0) return dq;
        return a.baseId < b.baseId ? -1 : a.baseId > b.baseId ? 1 : 0;
    });
    return list;
}

/** 面板一行文字的摘要，例如「秘银巨剑 · 主手 · 12」 */
export function itemSummary(item: EquipItem, slotNames: Record<GearSlot, string>): string {
    const base = GEAR_BASE_BY_ID[item.baseId];
    const name = base ? base.name : item.baseId;
    return `${name} · ${slotNames[item.slot]} · ${item.ilvl}`;
}

/** 词条/改造词条的可读文本（面板详情用） */
export function itemDetailLines(item: EquipItem, affixNames: Record<AffixId, string>): string[] {
    const lines: string[] = [];
    for (const roll of item.affixes) {
        const value = affixValue(roll.id, roll.points);
        lines.push(`${affixNames[roll.id]} +${(value * 100).toFixed(1)}%（${roll.points} 点）`);
    }
    lines.push(`耐力 +${staminaOf(item)}（生命 +${staminaOf(item) * STAMINA_HP_PER_POINT}）`);
    if (item.modifier) {
        const m = MODIFIERS.find((x) => x.id === item.modifier);
        if (m) lines.push(`改造「${m.name}」：${m.desc}`);
    }
    return lines;
}
