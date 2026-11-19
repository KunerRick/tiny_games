/**
 * 《秘银远征》进度与存档（纯逻辑，**不得 import cc**）。
 *
 * 负责四件事：
 *  1. 角色等级曲线（攻击强度 / 生命 / 经验 / 天赋点）
 *  2. 装备副属性预算与 DPS 估算（文档 §4.1 的 9.53× 就是这里算出来的）
 *  3. 天赋分配规则（每线 25 点 / 层门槛 5×(N−1) / 总 30 点）
 *  4. 存档 schema + sanitize（抄 ThunderCore 的坏档逐字段回落）
 */

import {
    AFFIXES,
    AFFIX_BUDGET,
    BOUNTIES,
    BOUNTY_BY_ID,
    BOUNTY_SLOTS_UPGRADED,
    FACILITY_IDS,
    GEAR_SLOTS,
    GEAR_BASE_BY_ID,
    ILVL_MAX,
    INVENTORY_CAP,
    KITCHEN_DURATION_LEVEL,
    KITCHEN_DURATION_RUNS,
    KITCHEN_SECOND_SLOT_LEVEL,
    MEAL_BY_ID,
    MODIFIER_BY_ID,
    QUALITY_BY_ID,
    QUARTERMASTER_SLOTS_PER_LEVEL,
    REGION_BY_ID,
    SKILL_BY_ID,
    SKILLS,
    SKILL_RESPEC_GOLD,
    TALENTS,
    TALENT_BY_ID,
    TALENT_LINE_CAP,
    TALENT_MAX_RANK,
    TALENT_PRESET_LEVEL,
    TALENT_PRESET_SECOND_LEVEL,
    TALENT_RESPEC_GOLD,
    TALENT_TOTAL,
    TRAINING_FREE_LEVEL,
    TRAINING_HALF_PRICE_LEVEL,
    TRINKET_BY_ID,
    TRINKETS,
    talentTierGate,
} from './MithrilConfig';
import type {
    AffixId,
    AffixRoll,
    ClassId,
    EquipItem,
    FacilityId,
    GearSlot,
    QualityId,
    SkillDef,
    SkillVariantDef,
    TalentDef,
} from './MithrilConfig';
import { sanitizeExpedition } from './MithrilWild';
import type { ExpeditionState } from './MithrilWild';

/** 设施 id 定义在 MithrilConfig（营地数据与存档 schema 共用一份） */
export { FACILITY_IDS };
export type { FacilityId };

// ==================== 等级曲线 ====================

/**
 * 存档版本。
 * - v1：M0–M4 的初版 schema（等级 / 装备 / 背包 / 远征）
 * - v2（M9）：把 M5–M8 新增的 `facilities / meals / talentPresets / trinketBag /
 *   bounties / bountyProgress / bountyDay / bountyCursor / expedition` 纳入正式 schema，
 *   并在 `migrateSave` 里显式补齐旧档。
 */
export const SAVE_VERSION = 2;
export const LEVEL_MAX = 30;
/** 基础攻击强度：1 级 10 → 30 级 20（贡献 2.00×） */
export const LEVEL_AP_BASE = 10;
export const LEVEL_AP_MAX = 20;
/** 最大生命：60 + 18 × (lv−1) → 1 级 60 / 30 级 582 */
export const HP_BASE = 60;
export const HP_PER_LEVEL = 18;
/** 经验：EXP_BASE × lv^EXP_EXPONENT；1→30 累计约 60,500 */
export const EXP_BASE = 50;
export const EXP_EXPONENT = 1.35;

/** 暴击伤害倍率 */
export const CRIT_MULT = 1.6;

/** 五层倍率的满配目标（文档 §4.1） */
export const LEVEL_MUL_MAX = 2.0;
export const GEAR_AP_MUL_MAX = 1.6;
export const TALENT_MUL_MAX = 1.35;
/**
 * 饰品的**条件上限**（M7：两件饰品靠规则触发，实测木桩 ≈1.25–1.35×）。
 * 这里只用于成长面板的 DPS 估算，核心不再有「按件数乘攻强」的无条件乘区。
 */
export const TRINKET_MUL_MAX = 1.2;
export const BASE_DPS = 100;
/** 毕业 / 起点必须落在 [8, 11] */
export const DPS_RATIO_MIN = 8;
export const DPS_RATIO_MAX = 11;

function clampLevel(level: number): number {
    if (!Number.isFinite(level)) return 1;
    return Math.max(1, Math.min(LEVEL_MAX, Math.floor(level)));
}

export function attackPowerAt(level: number): number {
    const lv = clampLevel(level);
    return LEVEL_AP_BASE * (1 + (lv - 1) / (LEVEL_MAX - 1));
}

/**
 * 装备主属性对攻击强度的倍率（设计 §4.1：ilvl 1 → 1.00×，ilvl 40 → 1.60×）。
 * 空装按 ilvl 1 计，因此 M1 切片（无装备）基线不变。
 */
export function gearApMultiplier(ilvl: number): number {
    const v = Math.max(1, Math.min(ILVL_MAX, Number.isFinite(ilvl) ? ilvl : 1));
    return 1 + (GEAR_AP_MUL_MAX - 1) * (v - 1) / (ILVL_MAX - 1);
}

export function maxHpAt(level: number): number {
    return HP_BASE + HP_PER_LEVEL * (clampLevel(level) - 1);
}

/** 升到下一级所需经验；满级返回 Infinity */
export function expToNext(level: number): number {
    const lv = clampLevel(level);
    if (lv >= LEVEL_MAX) return Infinity;
    return Math.round(EXP_BASE * Math.pow(lv, EXP_EXPONENT));
}

/** 从 1 级累计到 level 级所需总经验（level=1 时为 0） */
export function totalExpTo(level: number): number {
    const lv = clampLevel(level);
    let sum = 0;
    for (let i = 1; i < lv; i++) sum += Math.round(EXP_BASE * Math.pow(i, EXP_EXPONENT));
    return sum;
}

/** 给定累计经验，返回等级（1..30） */
export function levelForTotalExp(total: number): number {
    let exp = Math.max(0, Number(total) || 0);
    let level = 1;
    while (level < LEVEL_MAX) {
        const need = expToNext(level);
        if (exp < need) break;
        exp -= need;
        level++;
    }
    return level;
}

/** 每级 +1 天赋点：30 级共 30 点 */
export function talentPointsForLevel(level: number): number {
    return Math.min(TALENT_TOTAL, clampLevel(level));
}

// ==================== 副属性与 DPS ====================

export interface AffixAlloc {
    crit: number;
    haste: number;
    mastery: number;
    vers: number;
}

/** 均衡配点：32 点均分到 4 项，ilvl40 恰好触顶、零浪费 */
export const BALANCED_ALLOC: AffixAlloc = { crit: 8, haste: 8, mastery: 8, vers: 8 };

export interface SecondaryStats {
    crit: number;
    haste: number;
    mastery: number;
    vers: number;
    /** 副属性对 DPS 的总乘数 */
    multiplier: number;
    /** 当前装等可分配的词条点 */
    budget: number;
    /** 恰好触顶的项数（0–4） */
    cappedCount: number;
    /** 超出上限而浪费的点数（按百分比累计） */
    overflow: number;
}

/**
 * 词条点预算随 ilvl 线性解锁：ilvl10 可分配 8 点，ilvl40 满 32 点。
 * alloc 以「满预算 32 点」为单位书写，内部按 budget/32 缩放。
 */
export function affixBudget(ilvl: number): number {
    const v = Math.max(0, Math.min(ILVL_MAX, Number(ilvl) || 0));
    return AFFIX_BUDGET * (v / ILVL_MAX);
}

export function secondaryStats(ilvl: number, alloc: AffixAlloc = BALANCED_ALLOC): SecondaryStats {
    const budget = affixBudget(ilvl);
    const scale = budget / AFFIX_BUDGET;
    const values: Record<AffixId, number> = {
        crit: Math.min(AFFIXES[0].cap, alloc.crit * scale * AFFIXES[0].perPoint),
        haste: Math.min(AFFIXES[1].cap, alloc.haste * scale * AFFIXES[1].perPoint),
        mastery: Math.min(AFFIXES[2].cap, alloc.mastery * scale * AFFIXES[2].perPoint),
        vers: Math.min(AFFIXES[3].cap, alloc.vers * scale * AFFIXES[3].perPoint),
    };
    let overflow = 0;
    const raw: Array<[AffixId, number]> = [
        ['crit', alloc.crit * scale * AFFIXES[0].perPoint],
        ['haste', alloc.haste * scale * AFFIXES[1].perPoint],
        ['mastery', alloc.mastery * scale * AFFIXES[2].perPoint],
        ['vers', alloc.vers * scale * AFFIXES[3].perPoint],
    ];
    for (const [id, value] of raw) {
        const cap = AFFIXES.find((a) => a.id === id)!.cap;
        if (value > cap) overflow += value - cap;
    }
    let cappedCount = 0;
    for (const [id, value] of raw) {
        const cap = AFFIXES.find((a) => a.id === id)!.cap;
        if (value >= cap - 1e-9) cappedCount++;
    }
    // 暴击的收益是「命中期望」，其余三项直接乘在输出上
    const multiplier =
        (1 + values.crit * (CRIT_MULT - 1)) *
        (1 + values.haste) *
        (1 + values.mastery) *
        (1 + values.vers);
    return {
        crit: values.crit,
        haste: values.haste,
        mastery: values.mastery,
        vers: values.vers,
        multiplier,
        budget,
        cappedCount,
        overflow,
    };
}

export interface DpsInput {
    level: number;
    ilvl: number;
    talentPoints: number;
    trinkets: number;
    alloc?: AffixAlloc;
}

/** 静态 DPS 期望值（只用于校验功率曲线，不代表实战手感） */
export function estimateDps(input: DpsInput): number {
    const levelMul = attackPowerAt(input.level) / LEVEL_AP_BASE;
    const apMul = 1 + (GEAR_AP_MUL_MAX - 1) * (Math.max(1, Math.min(ILVL_MAX, input.ilvl)) - 1) / (ILVL_MAX - 1);
    const sec = secondaryStats(input.ilvl, input.alloc || BALANCED_ALLOC);
    const talMul = 1 + (TALENT_MUL_MAX - 1) * Math.max(0, Math.min(TALENT_TOTAL, input.talentPoints)) / TALENT_TOTAL;
    const trinketMul = 1 + (TRINKET_MUL_MAX - 1) * Math.max(0, Math.min(2, input.trinkets)) / 2;
    return BASE_DPS * levelMul * apMul * sec.multiplier * talMul * trinketMul;
}

export function dpsBaseline(): number {
    return estimateDps({ level: 1, ilvl: 1, talentPoints: 0, trinkets: 0 });
}

export function dpsGraduate(): number {
    return estimateDps({ level: LEVEL_MAX, ilvl: ILVL_MAX, talentPoints: TALENT_TOTAL, trinkets: 2 });
}

/** 30 级毕业装 / 1 级白装的 DPS 倍率（目标 [8,11]） */
export function dpsRatio(): number {
    return dpsGraduate() / dpsBaseline();
}

/** 60 秒窗口内某 CD 技能的施放次数（急速断点用） */
export function castsInWindow(cooldown: number, haste: number, windowSec: number): number {
    const cd = cooldown / (1 + Math.max(0, haste));
    if (cd <= 0) return Infinity;
    // +1e-9：60 / (8 / 1.2) 在浮点下是 8.999999999999998，不加会少算一次
    return Math.floor(windowSec / cd + 1e-9);
}

// ==================== 天赋 ====================

export type TalentState = Record<string, number>;

export function talentPointsSpent(state: TalentState): number {
    let sum = 0;
    for (const id of Object.keys(state)) sum += Math.max(0, Math.floor(state[id] || 0));
    return sum;
}

export function talentPointsInTree(state: TalentState, classId: ClassId, tree: string): number {
    let sum = 0;
    for (const id of Object.keys(state)) {
        const def = TALENT_BY_ID[id];
        if (!def || def.classId !== classId || def.tree !== tree) continue;
        sum += Math.max(0, Math.floor(state[id] || 0));
    }
    return sum;
}

export type TalentSpendReason =
    | ''
    | 'unknown'
    | 'class'
    | 'no-points'
    | 'max-rank'
    | 'line-cap'
    | 'tier-gate';

export interface TalentSpendCheck {
    ok: boolean;
    reason: TalentSpendReason;
}

export function canSpendTalent(save: MithrilSave, talentId: string): TalentSpendCheck {
    const def = TALENT_BY_ID[talentId];
    if (!def) return { ok: false, reason: 'unknown' };
    if (def.classId !== save.classId) return { ok: false, reason: 'class' };
    const rank = Math.max(0, Math.floor(save.talents[talentId] || 0));
    if (rank >= def.maxRank) return { ok: false, reason: 'max-rank' };
    const inTree = talentPointsInTree(save.talents, save.classId, def.tree);
    if (inTree >= TALENT_LINE_CAP) return { ok: false, reason: 'line-cap' };
    if (inTree < talentTierGate(def.tier)) return { ok: false, reason: 'tier-gate' };
    const available = talentPointsForLevel(save.level) - talentPointsSpent(save.talents);
    if (available <= 0) return { ok: false, reason: 'no-points' };
    return { ok: true, reason: '' };
}

export function spendTalent(save: MithrilSave, talentId: string): boolean {
    const check = canSpendTalent(save, talentId);
    if (!check.ok) return false;
    save.talents[talentId] = Math.max(0, Math.floor(save.talents[talentId] || 0)) + 1;
    return true;
}

/** 清空天赋，返回退还的点数 */
export function resetTalents(save: MithrilSave): number {
    const refunded = talentPointsSpent(save.talents);
    save.talents = {};
    return refunded;
}

/** 某设施的当前等级（0 = 未建造，5 = 满级） */
export function facilityLevel(save: MithrilSave, id: FacilityId): number {
    const raw = save.facilities ? save.facilities[id] : 0;
    return Math.max(0, Math.min(5, Math.floor(Number(raw) || 0)));
}

/** 训练场折扣：0/1 级原价、2 级半价、3 级起免费（设计 §4.6） */
export function trainingPriceMul(save: MithrilSave): number {
    const lv = facilityLevel(save, 'training');
    if (lv >= TRAINING_FREE_LEVEL) return 0;
    if (lv >= TRAINING_HALF_PRICE_LEVEL) return 0.5;
    return 1;
}

export function talentRespecCost(save: MithrilSave): number {
    return Math.round(TALENT_RESPEC_GOLD * trainingPriceMul(save));
}

export function variantRespecCost(save: MithrilSave): number {
    return Math.round(SKILL_RESPEC_GOLD * trainingPriceMul(save));
}

/**
 * 付费洗点（设计 §4.4：营地训练场 200 金，单机不惩罚实验；训练场升级后打折 / 免费）。
 * 训练场 Lv0（还没建造）不能洗点；金币不足返回 false；成功时清空天赋并落盘由调用方负责。
 */
export function respecTalents(save: MithrilSave): boolean {
    if (facilityLevel(save, 'training') <= 0) return false;
    const cost = talentRespecCost(save);
    const gold = Math.max(0, Math.floor(save.gold || 0));
    if (gold < cost) return false;
    save.gold = gold - cost;
    save.talents = {};
    return true;
}

// ==================== 技能与变体 ====================

export type VariantState = [number | null, number | null];

export function skillLevel(save: MithrilSave, skillId: string): number {
    return Math.max(1, Math.min(5, Math.floor(save.skills[skillId] || 1)));
}

export function variantState(save: MithrilSave, skillId: string): VariantState {
    const raw = save.variants[skillId];
    if (Array.isArray(raw) && raw.length === 2) {
        return [
            raw[0] === 0 || raw[0] === 1 ? raw[0] : null,
            raw[1] === 0 || raw[1] === 1 ? raw[1] : null,
        ];
    }
    return [null, null];
}

export function variantSlot(tier: number): 0 | 1 | null {
    if (tier === 2) return 0;
    if (tier === 4) return 1;
    return null;
}

export function canChooseVariant(save: MithrilSave, skillId: string, tier: number): boolean {
    const def = SKILL_BY_ID[skillId];
    const slot = variantSlot(tier);
    if (!def || slot === null || !def.variants) return false;
    if (def.classId !== save.classId) return false;
    if (skillLevel(save, skillId) < tier) return false;
    return variantState(save, skillId)[slot] === null;
}

/** 变体永久二选一：已选过不能反悔（营地洗点才清） */
export function chooseVariant(save: MithrilSave, skillId: string, tier: number, choice: 0 | 1): boolean {
    if (!canChooseVariant(save, skillId, tier)) return false;
    const slot = variantSlot(tier);
    if (slot === null) return false;
    const state = variantState(save, skillId);
    state[slot] = choice;
    save.variants[skillId] = state;
    return true;
}

export function variantDef(save: MithrilSave, skillId: string, tier: number): SkillVariantDef | null {
    const def = SKILL_BY_ID[skillId];
    const slot = variantSlot(tier);
    if (!def || !def.variants || slot === null) return null;
    const choice = variantState(save, skillId)[slot];
    if (choice === null) return null;
    return def.variants[slot][choice];
}

// ---- 技能升级（M3）：技能书 → 等级 1..5 ----

export const SKILL_LEVEL_MAX = 5;
/** 每级消耗 1 本技能书（通关保底 1 本，首通 2 本） */
export const SKILL_BOOK_COST = 1;

export type SkillUpgradeReason = '' | 'unknown' | 'class' | 'max-level' | 'no-books';

export interface SkillUpgradeCheck {
    ok: boolean;
    reason: SkillUpgradeReason;
    level: number;
}

export function canUpgradeSkill(save: MithrilSave, skillId: string): SkillUpgradeCheck {
    const def = SKILL_BY_ID[skillId];
    const level = skillLevel(save, skillId);
    if (!def) return { ok: false, reason: 'unknown', level };
    if (def.classId !== save.classId) return { ok: false, reason: 'class', level };
    if (level >= SKILL_LEVEL_MAX) return { ok: false, reason: 'max-level', level };
    if (Math.max(0, Math.floor(save.skillBooks || 0)) < SKILL_BOOK_COST) {
        return { ok: false, reason: 'no-books', level };
    }
    return { ok: true, reason: '', level };
}

/** 消耗技能书升一级；2 级 / 4 级升上去后由 UI 弹变体二选一 */
export function upgradeSkill(save: MithrilSave, skillId: string): boolean {
    const check = canUpgradeSkill(save, skillId);
    if (!check.ok) return false;
    save.skillBooks = Math.max(0, Math.floor(save.skillBooks || 0) - SKILL_BOOK_COST);
    save.skills[skillId] = check.level + 1;
    return true;
}

/**
 * 技能洗点（设计 §4.5：500 金清空所有变体选择，重新二选一）。
 * 技能等级与技能书不退 —— 与天赋洗点同口径，只重选「形态」。
 */
export function respecVariants(save: MithrilSave): boolean {
    if (facilityLevel(save, 'training') <= 0) return false;
    const cost = variantRespecCost(save);
    const gold = Math.max(0, Math.floor(save.gold || 0));
    if (gold < cost) return false;
    save.gold = gold - cost;
    save.variants = {};
    return true;
}

// ==================== 营地相关存档规则（M5） ====================

/** 装备仓库上限：基础 60 + 军需官每级 6 格（满级 90） */
export function inventoryCapFor(save: MithrilSave): number {
    return INVENTORY_CAP + facilityLevel(save, 'quartermaster') * QUARTERMASTER_SLOTS_PER_LEVEL;
}

/** 天赋方案槽位数：训练场 Lv4 起 1 个、Lv5 起 2 个 */
export function talentPresetSlots(save: MithrilSave): number {
    const lv = facilityLevel(save, 'training');
    if (lv >= TALENT_PRESET_SECOND_LEVEL) return 2;
    if (lv >= TALENT_PRESET_LEVEL) return 1;
    return 0;
}

/** 料理同时生效槽位：厨房 Lv3 起 2 个，否则 1 个（未建造时 0） */
export function mealSlotsFor(save: MithrilSave): number {
    const lv = facilityLevel(save, 'kitchen');
    if (lv <= 0) return 0;
    return lv >= KITCHEN_SECOND_SLOT_LEVEL ? 2 : 1;
}

/** 吃一份料理能持续几场战斗：厨房 Lv5 起 3 场，否则 1 场 */
export function mealDurationFor(save: MithrilSave): number {
    return facilityLevel(save, 'kitchen') >= KITCHEN_DURATION_LEVEL ? KITCHEN_DURATION_RUNS : 1;
}

/** 某职业是否还有「够级但没选」的变体（面板红点 / 提示用） */
export function pendingVariantCount(save: MithrilSave): number {
    let n = 0;
    for (const def of SKILLS) {
        if (def.classId !== save.classId || !def.variants) continue;
        const level = skillLevel(save, def.id);
        const state = variantState(save, def.id);
        if (level >= 2 && state[0] === null) n++;
        if (level >= 4 && state[1] === null) n++;
    }
    return n;
}

// ==================== 经验与升级 ====================

/** 增加经验，返回升了几级；满级后经验停在 0 */
export function addExp(save: MithrilSave, amount: number): number {
    let gain = Math.max(0, Number(amount) || 0);
    let levels = 0;
    save.exp = Math.max(0, Number(save.exp) || 0);
    save.level = clampLevel(save.level);
    while (save.level < LEVEL_MAX) {
        const need = expToNext(save.level);
        if (!Number.isFinite(need)) break;
        if (save.exp + gain < need) {
            save.exp += gain;
            gain = 0;
            break;
        }
        gain -= need - save.exp;
        save.exp = 0;
        save.level++;
        levels++;
    }
    if (save.level >= LEVEL_MAX) save.exp = 0;
    return levels;
}

// ==================== 存档 ====================

export interface MithrilSave {
    v: number;
    classId: ClassId;
    level: number;
    exp: number;
    gold: number;
    materials: Record<string, number>;
    equips: Partial<Record<GearSlot, EquipItem | null>>;
    /** 背包（不含已装备的；上限 INVENTORY_CAP） */
    inventory: EquipItem[];
    trinkets: [string | null, string | null];
    /** 已拥有但未装备的饰品 id（M7：掉落先进这里，两格装备只能从这里挑） */
    trinketBag: string[];
    talents: TalentState;
    skills: Record<string, number>;
    variants: Record<string, VariantState>;
    /** 技能书（通关掉落，成长面板里升级技能用） */
    skillBooks: number;
    dungeonsCleared: string[];
    /**
     * 首通固定装备「欠账」（试玩 P2-5）：首通时背包满、固定紫装只能折金币，
     * 记下副本 id，下次通关同副本且背包有空位时补发。与 dungeonsCleared 解耦，
     * 保证首通经验 / 技能书 / 饰品只发一次。
     */
    pendingFirstClear: string[];
    /** 已击败区域首领的区域 id（M4 野外） */
    regionsCleared: string[];
    /** 进行中的野外远征；没有则为 null */
    expedition: ExpeditionState | null;
    /** 悬赏板当前条目（M8；≤ 悬赏位，自动追踪） */
    bounties: string[];
    /** 自动类悬赏进度（收集类读库存，不存这里） */
    bountyProgress: Record<string, number>;
    /** 上次刷新日（epoch day；Lv4 起跨日重置） */
    bountyDay: number;
    /** 洗牌序列游标（0..23） */
    bountyCursor: number;
    facilities: Record<FacilityId, number>;
    /** 厨房料理（M5）：按场次生效，战斗结算时扣 1 场 */
    meals: MealState[];
    /** 训练场天赋方案（M5）：下标 0/1，null = 空槽；槽位数由训练场等级决定 */
    talentPresets: Array<TalentState | null>;
    /**
     * 首战操作引导是否已学会（体验官 E1，2026-11-17）。
     * 不放进 `seen_tutorial`：那条 3.4 秒 toast 一辈子只弹一次，玩家错过就再也看不到
     * 「按住普攻」。这里由战斗内提示在「累计 3 击杀或按住普攻满 1 秒」后置 true，
     * 之前每进一场战斗都会再提示，直到真学会为止。
     */
    combatHintDone: boolean;
    /**
     * 免费重铸次数（试玩 N206）。铁匠铺从 Lv0 建成 Lv1 时赠送 1 次：
     * 首档升级本来只解锁「重铸」入口，而重铸首价 40+6×装等远超玩家当时持有的金币，
     * 于是第一次设施升级「点完什么也没发生」。送一次免费重铸，让升级当下就有可执行的动作。
     */
    freeReforges: number;
}

/** 一份生效中的料理 */
export interface MealState {
    id: string;
    runsLeft: number;
}

export function defaultSave(classId: ClassId = 'warrior'): MithrilSave {
    const equips: Partial<Record<GearSlot, EquipItem | null>> = {};
    for (const slot of GEAR_SLOTS) equips[slot] = null;
    const skills: Record<string, number> = {};
    for (const sk of SKILLS) if (sk.classId === classId) skills[sk.id] = 1;
    const facilities = {} as Record<FacilityId, number>;
    for (const id of FACILITY_IDS) facilities[id] = 0;
    return {
        v: SAVE_VERSION,
        classId,
        level: 1,
        exp: 0,
        gold: 0,
        materials: {},
        equips,
        inventory: [],
        trinkets: [null, null],
        trinketBag: [],
        talents: {},
        skills,
        variants: {},
        skillBooks: 0,
        dungeonsCleared: [],
        pendingFirstClear: [],
        regionsCleared: [],
        expedition: null,
        bounties: [],
        bountyProgress: {},
        bountyDay: 0,
        bountyCursor: 0,
        facilities,
        meals: [],
        talentPresets: [],
        combatHintDone: false,
        freeReforges: 0,
    };
}

// ==================== 副本首通记账（试玩 P2-5） ====================

/**
 * 记录副本首通。**与首通装备是否入包解耦**：满包折金币也要记账，
 * 否则下一次通关会再次判定为首通，经验 / 技能书 / 保底饰品可以无限刷。
 * 返回 true = 本次新记；false = 之前已记过。
 */
export function markDungeonCleared(save: MithrilSave, dungeonId: string): boolean {
    if (!dungeonId) return false;
    if (save.dungeonsCleared.indexOf(dungeonId) >= 0) return false;
    save.dungeonsCleared.push(dungeonId);
    return true;
}

/** 首通固定装备因满包没发出：记入待补发队列（同一副本只记一条） */
export function queuePendingFirstClear(save: MithrilSave, dungeonId: string): void {
    if (!dungeonId) return;
    if (save.pendingFirstClear.indexOf(dungeonId) < 0) save.pendingFirstClear.push(dungeonId);
}

/** 补发成功（或不再需要）后清账；返回是否确实清掉了一条欠账 */
export function takePendingFirstClear(save: MithrilSave, dungeonId: string): boolean {
    const i = save.pendingFirstClear.indexOf(dungeonId);
    if (i < 0) return false;
    save.pendingFirstClear.splice(i, 1);
    return true;
}

function toInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
}

function isClassId(value: unknown): value is ClassId {
    return value === 'warrior' || value === 'mage' || value === 'ranger' || value === 'priest';
}

function isQualityId(value: unknown): value is QualityId {
    return typeof value === 'string' && !!QUALITY_BY_ID[value];
}

function isGearSlot(value: unknown): value is GearSlot {
    return typeof value === 'string' && (GEAR_SLOTS as string[]).indexOf(value) >= 0;
}

function sanitizeEquip(raw: unknown): EquipItem | null {
    if (!raw || typeof raw !== 'object') return null;
    const src = raw as Record<string, unknown>;
    if (!isGearSlot(src.slot)) return null;
    const base = GEAR_BASE_BY_ID[String(src.baseId || '')];
    if (!base || base.slot !== src.slot) return null;
    if (!isQualityId(src.quality)) return null;
    const affixes: AffixRoll[] = [];
    if (Array.isArray(src.affixes)) {
        for (const entry of src.affixes) {
            if (affixes.length >= 4 || !entry || typeof entry !== 'object') continue;
            const a = entry as Record<string, unknown>;
            const id = a.id as AffixId;
            if (AFFIXES.every((def) => def.id !== id)) continue;
            affixes.push({ id, points: toInt(a.points, 0, 100, 0) });
        }
    }
    const modifier = typeof src.modifier === 'string' && MODIFIER_BY_ID[src.modifier] ? src.modifier : undefined;
    return {
        uid: typeof src.uid === 'string' && src.uid ? src.uid : `item-${Math.random().toString(36).slice(2, 10)}`,
        baseId: base.id,
        slot: base.slot,
        ilvl: toInt(src.ilvl, 1, ILVL_MAX, 1),
        quality: src.quality,
        affixes,
        modifier,
    };
}

/**
 * 逐字段重建天赋：按层数升序贪心分配，保证结果一定满足
 * 「层门槛 / 每线 25 点 / 总点数 = 等级」三条不变量。
 */
function normalizeTalents(
    raw: unknown,
    classId: ClassId,
    available: number,
): TalentState {
    const requested: Record<string, number> = {};
    if (raw && typeof raw === 'object') {
        const src = raw as Record<string, unknown>;
        for (const id of Object.keys(src)) {
            const def = TALENT_BY_ID[id];
            if (!def || def.classId !== classId) continue;
            requested[id] = toInt(src[id], 0, TALENT_MAX_RANK, 0);
        }
    }
    const ordered = Object.keys(requested)
        .map((id) => TALENT_BY_ID[id])
        .filter(Boolean)
        .sort((a, b) => (a.tier - b.tier) || (a.id < b.id ? -1 : 1));

    const out: TalentState = {};
    const inTree: Record<string, number> = {};
    let spent = 0;
    for (const def of ordered) {
        const want = requested[def.id];
        if (!want) continue;
        const treeSpent = inTree[def.tree] || 0;
        if (treeSpent < talentTierGate(def.tier)) continue;
        const allow = Math.min(
            want,
            def.maxRank,
            TALENT_LINE_CAP - treeSpent,
            available - spent,
        );
        if (allow <= 0) continue;
        out[def.id] = allow;
        inTree[def.tree] = treeSpent + allow;
        spent += allow;
    }
    return out;
}

/** 坏档一律逐字段回落，绝不抛异常 */
export function sanitizeSave(raw: unknown): MithrilSave {
    const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const classId = isClassId(src.classId) ? src.classId : 'warrior';
    const out = defaultSave(classId);

    out.v = SAVE_VERSION;
    out.level = toInt(src.level, 1, LEVEL_MAX, 1);
    out.exp = toInt(src.exp, 0, 1e9, 0);
    out.gold = toInt(src.gold, 0, 1e12, 0);

    if (src.materials && typeof src.materials === 'object') {
        const m = src.materials as Record<string, unknown>;
        let keys = 0;
        for (const key of Object.keys(m)) {
            if (keys++ >= 32) break;
            if (!/^[a-z0-9_]{1,24}$/.test(key)) continue;
            out.materials[key] = toInt(m[key], 0, 1e9, 0);
        }
    }

    // 设施等级先解析：仓库上限（军需官）与洗点折扣都依赖它
    if (src.facilities && typeof src.facilities === 'object') {
        const f = src.facilities as Record<string, unknown>;
        for (const id of FACILITY_IDS) out.facilities[id] = toInt(f[id], 0, 5, 0);
    }

    // 装备栏：逐槽校验 + uid 去重（坏档里两槽同 uid 会让「按 uid 操作」认错件）
    if (src.equips && typeof src.equips === 'object') {
        const e = src.equips as Record<string, unknown>;
        const used: Record<string, true> = {};
        for (const slot of GEAR_SLOTS) {
            const item = sanitizeEquip(e[slot]);
            if (!item) continue;
            let uid = item.uid;
            let n = 1;
            while (used[uid]) uid = `${item.uid}-${n++}`;
            item.uid = uid;
            used[uid] = true;
            out.equips[slot] = item;
        }
    }

    // 背包：逐件校验 + uid 去重（与已装备的也不能撞，否则「按 uid 脱下」会脱错件）
    if (Array.isArray(src.inventory)) {
        const usedUid: Record<string, true> = {};
        for (const slot of GEAR_SLOTS) {
            const item = out.equips[slot];
            if (item) usedUid[item.uid] = true;
        }
        for (const entry of src.inventory) {
            // 军需官扩容后的上限才作数，否则升级的仓库读档就被砍回 60 格
            if (out.inventory.length >= inventoryCapFor(out)) break;
            const item = sanitizeEquip(entry);
            if (!item) continue;
            let uid = item.uid;
            let n = 1;
            while (usedUid[uid]) uid = `${item.uid}-${n++}`;
            item.uid = uid;
            usedUid[uid] = true;
            out.inventory.push(item);
        }
    }

    // 饰品背包（M7）：未装备的拥有件；非法 id / 重复都丢弃
    if (Array.isArray(src.trinketBag)) {
        const seen: Record<string, true> = {};
        for (const id of src.trinketBag) {
            if (out.trinketBag.length >= TRINKETS.length) break;
            if (typeof id !== 'string' || !TRINKET_BY_ID[id] || seen[id]) continue;
            seen[id] = true;
            out.trinketBag.push(id);
        }
    }

    if (Array.isArray(src.trinkets)) {
        const used: Record<string, true> = {};
        for (let i = 0; i < 2; i++) {
            const id = src.trinkets[i];
            if (typeof id === 'string' && TRINKET_BY_ID[id] && !used[id]) {
                out.trinkets[i] = id;
                used[id] = true;
                // 装备中的件视为已拥有（旧档只有两格，没有 trinketBag）
                if (out.trinketBag.indexOf(id) < 0) out.trinketBag.push(id);
            } else {
                out.trinkets[i] = null;
            }
        }
    }

    out.talents = normalizeTalents(src.talents, classId, talentPointsForLevel(out.level));

    if (src.skills && typeof src.skills === 'object') {
        const sk = src.skills as Record<string, unknown>;
        for (const def of SKILLS) {
            if (def.classId !== classId) continue;
            out.skills[def.id] = toInt(sk[def.id], 1, 5, 1);
        }
    }

    out.skillBooks = toInt(src.skillBooks, 0, 999, 0);

    if (src.variants && typeof src.variants === 'object') {
        const v = src.variants as Record<string, unknown>;
        for (const def of SKILLS) {
            if (def.classId !== classId || !def.variants) continue;
            const rawState = v[def.id];
            if (!Array.isArray(rawState)) continue;
            const level = out.skills[def.id] || 1;
            const state: VariantState = [null, null];
            if (level >= 2 && (rawState[0] === 0 || rawState[0] === 1)) state[0] = rawState[0];
            if (level >= 4 && (rawState[1] === 0 || rawState[1] === 1)) state[1] = rawState[1];
            if (state[0] !== null || state[1] !== null) out.variants[def.id] = state;
        }
    }

    if (Array.isArray(src.dungeonsCleared)) {
        const ids: string[] = [];
        for (const id of src.dungeonsCleared) {
            if (typeof id === 'string' && ids.indexOf(id) < 0) ids.push(id);
        }
        out.dungeonsCleared = ids;
    }

    // 首通装备欠账（试玩 P2-5）：旧档没有这个字段 → 空数组；坏值逐条丢弃
    if (Array.isArray(src.pendingFirstClear)) {
        const ids: string[] = [];
        for (const id of src.pendingFirstClear) {
            if (typeof id !== 'string' || !id || ids.indexOf(id) >= 0) continue;
            ids.push(id);
        }
        out.pendingFirstClear = ids;
    }

    if (Array.isArray(src.bounties)) {
        const ids: string[] = [];
        for (const id of src.bounties) {
            if (typeof id !== 'string' || !BOUNTY_BY_ID[id] || ids.indexOf(id) >= 0) continue;
            if (ids.length >= BOUNTY_SLOTS_UPGRADED) break;
            ids.push(id);
        }
        out.bounties = ids;
    }

    // 悬赏进度只保留板上的自动类条目；收集类读库存，不落盘
    if (src.bountyProgress && typeof src.bountyProgress === 'object') {
        const raw = src.bountyProgress as Record<string, unknown>;
        for (const id of out.bounties) {
            const def = BOUNTY_BY_ID[id];
            if (!def || def.consume || raw[id] === undefined) continue;
            out.bountyProgress[id] = toInt(raw[id], 0, def.target, 0);
        }
    }
    out.bountyDay = toInt(src.bountyDay, 0, 100000000, 0);
    out.bountyCursor = toInt(src.bountyCursor, 0, Math.max(0, BOUNTIES.length - 1), 0);

    if (Array.isArray(src.regionsCleared)) {
        const ids: string[] = [];
        for (const id of src.regionsCleared) {
            if (typeof id === 'string' && REGION_BY_ID[id] && ids.indexOf(id) < 0) ids.push(id);
        }
        out.regionsCleared = ids;
    }

    // 旧档没有这个字段 → null；坏档也回落成 null，不会把玩家卡在一张坏图上
    out.expedition = sanitizeExpedition(src.expedition);

    // 料理：只认已定义的 id、去重、按槽位截断；场次夹在 1–9
    if (Array.isArray(src.meals)) {
        const seen: Record<string, true> = {};
        for (const entry of src.meals) {
            if (out.meals.length >= 2) break;
            if (!entry || typeof entry !== 'object') continue;
            const m = entry as Record<string, unknown>;
            const id = typeof m.id === 'string' ? m.id : '';
            if (!MEAL_BY_ID[id] || seen[id]) continue;
            seen[id] = true;
            out.meals.push({ id, runsLeft: toInt(m.runsLeft, 1, 9, 1) });
        }
    }

    // 天赋方案：逐槽位按当前等级重新归一（层门槛 / 每线 25 点 / 总点数三条不变量）
    if (Array.isArray(src.talentPresets)) {
        for (let i = 0; i < 2; i++) {
            const raw = src.talentPresets[i];
            const normalized = raw && typeof raw === 'object'
                ? normalizeTalents(raw, classId, talentPointsForLevel(out.level))
                : {};
            out.talentPresets[i] = Object.keys(normalized).length > 0 ? normalized : null;
        }
    }

    // 首战引导标记（体验官 E1）：旧档没有该字段 → false，下次进战斗会再提示一次
    out.combatHintDone = src.combatHintDone === true;
    // 免费重铸券（N206）：旧档没有该字段 → 0；上限 9 防坏档刷次数
    out.freeReforges = toInt(src.freeReforges, 0, 9, 0);

    return out;
}

// ==================== 存档迁移（v1 → v2） ====================

export interface SaveMigrationInfo {
    /** 原始版本号；缺失 / 非法 = 0 */
    fromVersion: number;
    /** 迁移目标版本（= SAVE_VERSION） */
    toVersion: number;
    /** 本次迁移实际做了什么；空数组 = 已经是当前版本 */
    notes: string[];
}

/**
 * 把任意历史版本的存档方言补齐到当前 schema，再交给 `sanitizeSave` 逐字段兜底。
 *
 * 职责边界：
 *  - 迁移**只补结构**（缺失字段、旧字段语义、版本号），不做数值夹取 —— 夹取只在 sanitizeSave；
 *  - 不修改调用方传入的对象（读档要可重放、可幂等）；
 *  - 任何输入都不抛：坏 JSON 由 `parseSave` 负责，非对象在这里当 `{}`。
 */
export function migrateSave(raw: unknown): { save: MithrilSave; info: SaveMigrationInfo } {
    const notes: string[] = [];
    const src = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};
    const rawVersion = typeof src.v === 'number' && Number.isFinite(src.v) ? Math.floor(src.v) : 0;
    const fromVersion = Math.max(0, rawVersion);
    // 浅拷贝：迁移过程不碰调用方的对象
    const work: Record<string, unknown> = Object.assign({}, src);

    if (fromVersion === 0) notes.push('v0：补全缺失字段');
    if (fromVersion > SAVE_VERSION) notes.push(`v${fromVersion}→v${SAVE_VERSION}：未知字段丢弃`);

    // 过期经验：老档 / 坏档可能把溢出经验留在 exp 里；折算成等级，余数保留
    const level = toInt(work.level, 1, LEVEL_MAX, 1);
    const exp = toInt(work.exp, 0, 1e9, 0);
    if (level >= LEVEL_MAX) {
        if (exp > 0) {
            work.exp = 0;
            notes.push('满级经验清零');
        }
    } else if (exp >= expToNext(level)) {
        const probe = defaultSave(isClassId(work.classId) ? work.classId : 'warrior');
        probe.level = level;
        probe.exp = 0;
        const levels = addExp(probe, exp);
        work.level = probe.level;
        work.exp = probe.exp;
        notes.push(`经验折算：+${levels} 级`);
    }

    // pre-M7：已装备的饰品必须登记为已拥有（旧档只有两格，没有 trinketBag）
    if (!Array.isArray(work.trinketBag) && Array.isArray(work.trinkets)) {
        const bag: string[] = [];
        for (const id of work.trinkets) {
            if (typeof id === 'string' && TRINKET_BY_ID[id] && bag.indexOf(id) < 0) bag.push(id);
        }
        work.trinketBag = bag;
        notes.push('pre-M7：已装备饰品登记为已拥有');
    }

    // pre-M8：补齐悬赏字段；板面内容交给 `ensureBountyBoard` 懒填充，迁移只给空形状
    let bountyFilled = false;
    if (work.bounties === undefined) { work.bounties = []; bountyFilled = true; }
    if (work.bountyProgress === undefined) { work.bountyProgress = {}; bountyFilled = true; }
    if (work.bountyDay === undefined) { work.bountyDay = 0; bountyFilled = true; }
    if (work.bountyCursor === undefined) { work.bountyCursor = 0; bountyFilled = true; }
    if (bountyFilled) notes.push('pre-M8：补齐悬赏字段');

    const save = sanitizeSave(work);
    save.v = SAVE_VERSION;
    return { save, info: { fromVersion, toVersion: SAVE_VERSION, notes } };
}

/** 便捷：某个职业在当前等级下的技能列表 */
export function skillsForSave(save: MithrilSave): SkillDef[] {
    return SKILLS.filter((sk) => sk.classId === save.classId);
}

// ==================== 存档序列化（不依赖 localStorage，便于自检） ====================

/** 存档键名（StorageManager 会加 `tiny_games_mithril_` 前缀） */
export const SAVE_STORAGE_KEY = 'save';

/** 写档文本：`MithrilSave` 对象本身就是 schema（读侧 sanitizeSave 负责兜底坏字段） */
export function serializeSave(save: MithrilSave): string {
    return JSON.stringify(save);
}

/**
 * 读档：无档返回 **null**（M6 起据此进入职业选择），
 * 坏 JSON 回落默认战士档（老玩家的档不能一升级就丢），绝不抛。
 * 版本方言由 `migrateSave` 补齐，坏字段交给 `sanitizeSave` 逐字段兜底。
 */
export function parseSave(raw: string | null | undefined): MithrilSave | null {
    if (!raw) return null;
    let data: unknown = null;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        return defaultSave('warrior');
    }
    return migrateSave(data).save;
}

/** 便捷：某个职业的全部天赋 */
export function talentsForSave(save: MithrilSave): TalentDef[] {
    return TALENTS.filter((t) => t.classId === save.classId);
}
