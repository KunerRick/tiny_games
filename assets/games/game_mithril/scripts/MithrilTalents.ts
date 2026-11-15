/**
 * 《秘银远征》天赋 / 技能成长（纯逻辑，**不得 import cc**）。
 *
 * 设计依据（docs/plans/2026-11-14-game-mithril-design.md §4.4 / §4.5 / §14.1）：
 *  - 每职业 3 线 × 5 层 × 2 选 1，每格 1–5 点，效果按点数线性放大
 *  - 每线 25 点、总 30 点、层门槛 5×(N−1)（规则校验在 MithrilProgress）
 *  - 技能 5 级：每级 +0.5% 伤害 / −1% 冷却；2 级、4 级各解锁一次变体二选一
 *  - 变体改变形态，不改纯数值：本模块把「形态」翻译成核心能读的修正量
 *
 * 这里只做**数据聚合**：`talentEffects()` 把点数表压成一个 TalentEffects，
 * `skillModsFromSave()` 把技能等级 / 变体选择压成 SkillMods。核心每帧读这两个结构，
 * 不再自己去查 120 条天赋文本 —— 数值与规则只有一处定义，自检可以直接锁。
 */

import {
    SKILLS,
    TALENT_BY_ID,
    TRINKETS,
} from './MithrilConfig';
import type {
    ClassId,
    SkillDef,
    SkillIdSuffix,
} from './MithrilConfig';

// ==================== 天赋效果 ====================

/**
 * 天赋效果键。每个键在战斗核心里有且只有一个消费点，
 * 避免出现「面板写了 +8%，实战没人读」的空天赋。
 *
 * 数值口径：
 *  - xxxMul / xxxDr / xxxPct 一律是 0–1 的比例（0.08 = +8%）
 *  - critChance 是百分点（0.01 = +1% 暴击率，直接加到概率上）
 *  - xxxCut / stunBonus / rageRegen 是绝对值（秒 / 点怒气）
 */
export type TalentEffectKey =
    // 防御
    | 'takenMul'         // 受到伤害比例（坚韧）
    | 'armor'            // 护甲：物理减伤 = armor × 0.5（铁壁）
    | 'lowHpDr'          // 生命 <30% 额外减伤（不屈）
    | 'dodgeCdCut'       // 闪避冷却直接减秒（盾墙 / 战备）
    | 'healMul'          // 受到治疗加成（战地医师）
    | 'ccResist'         // 控制时长减免（钢铁意志）
    | 'meleeReflect'     // 近战反伤比例（反弹）
    | 'counterReflect'   // 侧步后反击比例（格挡反击）
    | 'cheatDeath'       // 每副本免死次数（不朽，每 2 点 1 次）
    | 'thornAoe'         // 受伤的 10% 转 AoE（荆棘堡垒）
    // 进攻
    | 'critChance'       // 暴击率（狂暴）
    | 'critMult'         // 暴击伤害加成（暴怒）
    | 'killHealPct'      // 击杀回血（嗜血）
    | 'attackSpeed'      // 普攻冷却缩减（双持）
    | 'skillDamage'      // 技能伤害加成（重击）
    | 'woundedDamage'    // 对残血目标（<35%）伤害（持续压制）
    | 'executeDamage'    // 对濒死目标（<20%）伤害（斩杀）
    | 'lowHpDamage'      // 自身低血（<35%）伤害（破釜沉舟）
    | 'stackDamage'      // 连续命中每层伤害（血之狂潮）
    | 'burstAttackSpeed' // 爆发期普攻冷却缩减（无尽怒焰）
    | 'apPct'            // 攻击强度（精准，本作无闪避判定，按等效伤害落地）
    // 资源 / 控制
    | 'rageGain'         // 怒气获取加成（战术精通）
    | 'rageRegen'        // 每 5 秒回怒气（战地指挥）
    | 'stunBonus'        // 冲锋眩晕 +秒（破胆怒吼）
    | 'slowBonus'        // 减速时长加成（威慑）
    | 'armorBreakBonus'  // 减甲额外比例（压制）
    | 'skillCd'          // 技能冷却缩减（战术大师）
    | 'burstTaken'       // 爆发期额外减伤（最后壁垒）
    | 'burstShield'      // 爆发时护盾（钢铁阵型）
    | 'burstDamage'      // 爆发期伤害加成（血怒变体 · 血偿）
    ;

/** 单条天赋：每点提供多少（1 点 = 1 天赋点） */
interface TalentEffectDef {
    key: TalentEffectKey;
    perRank: number;
}

/**
 * 战士 30 个天赋的效果表（id 与 MithrilConfig.buildTalents 的生成规则一致）。
 *
 * 说明：设计 §14.1 的部分描述在实时战斗里没有对应机制，落地时做了等效映射，
 * 面板 desc 同步改写（不是空挂）：
 *  - 精准「命中 +2%」→ 攻击强度 +1%（本作普攻不掷命中骰，命中即伤害）
 *  - 格挡反击「格挡时反击 40%」→ 每点 +8%、满 5 点 40%，触发条件用侧步（战士的格挡动作）
 *  - 钢铁阵型「护盾 +3%」→ 每点 +3% 最大生命的血怒护盾
 *  - 威慑「减速时长 +8%」→ 破甲命中附带 25% 减速 2s，天赋按比例延长
 */
const WARRIOR_TALENT_EFFECTS: Record<string, TalentEffectDef> = {
    // ---- 钢铁 ----
    warrior_steel_t1_0: { key: 'takenMul', perRank: -0.01 },      // 坚韧 受伤 -1%
    warrior_steel_t1_1: { key: 'armor', perRank: 2 },             // 铁壁 护甲 +2%
    warrior_steel_t2_0: { key: 'counterReflect', perRank: 0.08 }, // 格挡反击 侧步后反击 8%/点
    warrior_steel_t2_1: { key: 'lowHpDr', perRank: 0.04 },        // 不屈 低血减伤 4%
    warrior_steel_t3_0: { key: 'dodgeCdCut', perRank: 0.4 },      // 盾墙 闪避 CD -0.4s
    warrior_steel_t3_1: { key: 'healMul', perRank: 0.06 },        // 战地医师 治疗 +6%
    warrior_steel_t4_0: { key: 'ccResist', perRank: 0.08 },       // 钢铁意志 控制时长 -8%
    warrior_steel_t4_1: { key: 'meleeReflect', perRank: 0.08 },   // 反弹 近战反伤 8%
    warrior_steel_t5_0: { key: 'cheatDeath', perRank: 1 },        // 不朽 每 2 点 1 次免死
    warrior_steel_t5_1: { key: 'thornAoe', perRank: 0.10 },       // 荆棘堡垒 受伤 10% 转 AoE
    // ---- 狂怒 ----
    warrior_fury_t1_0: { key: 'critChance', perRank: 0.01 },      // 狂暴 暴击 +1%
    warrior_fury_t1_1: { key: 'killHealPct', perRank: 0.01 },     // 嗜血 击杀回 1%
    warrior_fury_t2_0: { key: 'attackSpeed', perRank: 0.03 },     // 双持 攻速 +3%
    warrior_fury_t2_1: { key: 'skillDamage', perRank: 0.02 },     // 重击 技能伤害 +2%
    warrior_fury_t3_0: { key: 'critMult', perRank: 0.03 },        // 暴怒 暴伤 +3%
    warrior_fury_t3_1: { key: 'woundedDamage', perRank: 0.02 },   // 持续压制 对残血 +2%
    warrior_fury_t4_0: { key: 'stackDamage', perRank: 0.005 },    // 血之狂潮 每层 +0.5%
    warrior_fury_t4_1: { key: 'lowHpDamage', perRank: 0.04 },     // 破釜沉舟 低血伤害 +4%
    warrior_fury_t5_0: { key: 'executeDamage', perRank: 0.10 },   // 斩杀 目标 <20% +10%
    warrior_fury_t5_1: { key: 'burstAttackSpeed', perRank: 0.06 },// 无尽怒焰 爆发期攻速 +6%
    // ---- 战术 ----
    warrior_tactic_t1_0: { key: 'rageGain', perRank: 0.02 },      // 战术精通 怒气 +2%
    warrior_tactic_t1_1: { key: 'slowBonus', perRank: 0.08 },     // 威慑 减速时长 +8%
    warrior_tactic_t2_0: { key: 'stunBonus', perRank: 0.08 },     // 破胆怒吼 眩晕 +0.08s
    warrior_tactic_t2_1: { key: 'dodgeCdCut', perRank: 0.2 },     // 战备 闪避 CD -0.2s
    warrior_tactic_t3_0: { key: 'apPct', perRank: 0.01 },         // 精准 攻击强度 +1%
    warrior_tactic_t3_1: { key: 'armorBreakBonus', perRank: 0.03 },// 压制 减甲 +3%
    warrior_tactic_t4_0: { key: 'rageRegen', perRank: 2 },        // 战地指挥 每 5s 回 2 怒气
    warrior_tactic_t4_1: { key: 'burstShield', perRank: 0.03 },   // 钢铁阵型 护盾 +3%
    warrior_tactic_t5_0: { key: 'skillCd', perRank: 0.02 },       // 战术大师 技能 CD -2%
    warrior_tactic_t5_1: { key: 'burstTaken', perRank: 0.04 },    // 最后壁垒 爆发期减伤 +4%
};

/** 聚合后的天赋效果；字段全部是「已按点数放大 + 已夹取」的最终值 */
export interface TalentEffects {
    takenMul: number;
    armor: number;
    lowHpDr: number;
    dodgeCdCut: number;
    healMul: number;
    ccResist: number;
    meleeReflect: number;
    counterReflect: number;
    cheatDeath: number;
    thornAoe: number;
    critChance: number;
    critMult: number;
    killHealPct: number;
    attackSpeed: number;
    skillDamage: number;
    woundedDamage: number;
    executeDamage: number;
    lowHpDamage: number;
    stackDamage: number;
    burstAttackSpeed: number;
    apPct: number;
    rageGain: number;
    rageRegen: number;
    stunBonus: number;
    slowBonus: number;
    armorBreakBonus: number;
    skillCd: number;
    burstTaken: number;
    burstShield: number;
    burstDamage: number;
}

export function emptyTalentEffects(): TalentEffects {
    return {
        takenMul: 0, armor: 0, lowHpDr: 0, dodgeCdCut: 0, healMul: 0,
        ccResist: 0, meleeReflect: 0, counterReflect: 0, cheatDeath: 0, thornAoe: 0,
        critChance: 0, critMult: 0, killHealPct: 0, attackSpeed: 0, skillDamage: 0,
        woundedDamage: 0, executeDamage: 0, lowHpDamage: 0, stackDamage: 0,
        burstAttackSpeed: 0, apPct: 0, rageGain: 0, rageRegen: 0, stunBonus: 0,
        slowBonus: 0, armorBreakBonus: 0, skillCd: 0, burstTaken: 0,
        burstShield: 0, burstDamage: 0,
    };
}

export const EMPTY_TALENT_EFFECTS: TalentEffects = emptyTalentEffects();

/** 各效果的上限（防止 5 点叠出 200% 反伤这类越界值） */
const EFFECT_CAPS: Partial<Record<TalentEffectKey, number>> = {
    takenMul: 0.35,
    lowHpDr: 0.30,
    dodgeCdCut: 2.5,
    healMul: 0.60,
    ccResist: 0.50,
    meleeReflect: 0.40,
    counterReflect: 0.40,
    cheatDeath: 2,
    thornAoe: 0.50,
    attackSpeed: 0.40,
    skillDamage: 0.30,
    woundedDamage: 0.20,
    executeDamage: 0.50,
    lowHpDamage: 0.30,
    stackDamage: 0.01,
    burstAttackSpeed: 0.40,
    apPct: 0.10,
    rageGain: 0.50,
    stunBonus: 0.50,
    slowBonus: 0.50,
    armorBreakBonus: 0.30,
    skillCd: 0.25,
    burstTaken: 0.20,
    burstShield: 0.25,
    burstDamage: 0.40,
};

/**
 * 把「天赋 id → 点数」压成战斗可直接读的效果。
 * 非战士职业在 M6 之前没有效果表，返回全 0（不会崩，也只是暂时没有加成）。
 */
export function talentEffects(
    talents: Record<string, number> | null | undefined,
    classId: ClassId,
): TalentEffects {
    const out = emptyTalentEffects();
    if (!talents || typeof talents !== 'object') return out;
    const table = classId === 'warrior' ? WARRIOR_TALENT_EFFECTS : null;
    if (!table) return out;
    for (const id of Object.keys(talents)) {
        const def = table[id];
        if (!def) continue;
        const talent = TALENT_BY_ID[id];
        if (!talent || talent.classId !== classId) continue;
        const rank = Math.max(0, Math.floor(talents[id] || 0));
        if (rank <= 0) continue;
        out[def.key] += def.perRank * rank;
    }
    // 夹取：cheatDeath 每 2 点换 1 次（取整），其余按上限收敛
    out.cheatDeath = Math.min(EFFECT_CAPS.cheatDeath as number, Math.floor(out.cheatDeath / 2));
    for (const key of Object.keys(EFFECT_CAPS) as TalentEffectKey[]) {
        if (key === 'cheatDeath') continue;
        const cap = EFFECT_CAPS[key];
        if (cap === undefined) continue;
        const value = out[key];
        if (!Number.isFinite(value)) out[key] = 0;
        else if (value > cap) out[key] = cap;
        else if (value < -cap) out[key] = -cap;
    }
    return out;
}

// ==================== 技能等级与变体 ====================

export const SKILL_MIN_LEVEL = 1;
export const SKILL_MAX_LEVEL = 5;
/**
 * 每级 +0.5% 伤害 / −1% 冷却（2 级 / 4 级同时解锁变体）。
 *
 * 数值刻意压得很轻：设计 §4.1 把终局 DPS 锁在 **9.53×**，且明确
 * 「技能变体不计入倍率」。实测五层（技能 1 级）≈9.0×，满 5 级 + 变体
 * 全选最坏构筑 ≈10.8×，两者都必须落在 [8,11]（自检 44 用
 * measureDummyDps 实测锁死）。技能书的真正价值是**解锁变体**与手感，
 * 不是堆数值 —— 变体的数值一律配对价，另配形态收益（半径 / 段数 /
 * 减伤 / 怒气节奏）。
 */
export const SKILL_DMG_PER_LEVEL = 0.005;
export const SKILL_CD_PER_LEVEL = 0.01;

/**
 * 变体的「形态修正量」。每个字段都在核心里有对应消费点：
 *  - dmgMul / cdMul / arcMul / radiusAdd / distAdd / durationAdd：直接改技能参数
 *  - 其余 flag 由核心在特定时机读取（下一击必暴、爆发期加成等）
 */
export interface SkillVariantMods {
    dmgMul?: number;
    cdMul?: number;
    arcMul?: number;
    radiusAdd?: number;
    distAdd?: number;
    durationAdd?: number;
    invulnAdd?: number;
    stunAdd?: number;
    tickMul?: number;
    armorBreakAdd?: number;
    splashRadius?: number;
    splashMul?: number;
    hasteBuff?: number;
    hasteBuffDur?: number;
    guardDur?: number;
    nextCrit?: boolean;
    burstDmgAdd?: number;
    burstTakenAdd?: number;
    comboEvery?: number;
    comboMul?: number;
}

const NO_VARIANT: SkillVariantMods = {};

/**
 * 战士 6 技能的变体修正表，顺序与 MithrilConfig.SKILLS 里的 variants 文本一一对应。
 * 文本是给玩家看的，这里是给引擎执行的；两边必须同时改（自检会核对数量）。
 *
 * 平衡约定（设计 §4.1「变体改形态、不改数值」）：
 *  - 同一格的两个选项，**单体打桩 DPS 必须接近**（±8% 以内），差异体现在
 *    半径 / 段数 / 攻速 / 减伤 / 怒气节奏这些形态上
 *  - 直接乘伤害的选项一律配一个对价（减半径、加冷却、减单次伤害）
 */
const WARRIOR_VARIANT_MODS: Record<string, [[SkillVariantMods, SkillVariantMods], [SkillVariantMods, SkillVariantMods]]> = {
    warrior_basic: [
        [{ arcMul: 1.3333, dmgMul: 0.9 }, { cdMul: 0.9, dmgMul: 0.9 }],
        [{ comboEvery: 4, comboMul: 1.5, dmgMul: 0.9 }, { dmgMul: 1.15, cdMul: 1.15 }],
    ],
    warrior_a1: [
        [{ distAdd: 100 }, { stunAdd: 0.4 }],
        [{ hasteBuff: 0.25, hasteBuffDur: 3 }, { guardDur: 1.5 }],
    ],
    warrior_a2: [
        [{ radiusAdd: 30 }, { tickMul: 0.85 }],
        [{ dmgMul: 1.1 }, { durationAdd: 0.5 }],
    ],
    warrior_a3: [
        [{ armorBreakAdd: 0.04 }, { splashRadius: 90, splashMul: 0.6 }],
        [{ durationAdd: 1 }, { dmgMul: 1.1 }],
    ],
    warrior_dodge: [
        [{ distAdd: 80 }, { invulnAdd: 0.2 }],
        [{ nextCrit: true }, { cdMul: 0.75 }],
    ],
    warrior_burst: [
        [{ durationAdd: 2 }, { burstTakenAdd: -0.07 }],
        [{ burstDmgAdd: 0.08 }, { burstTakenAdd: -0.15 }],
    ],
};

export interface SkillMod {
    level: number;
    /** 等级 + 变体带来的伤害乘数 */
    dmgMul: number;
    /** 等级 + 变体带来的冷却乘数 */
    cdMul: number;
    /** 2 级槽 / 4 级槽已选的变体修正（未选为空对象） */
    v2: SkillVariantMods;
    v4: SkillVariantMods;
}

export type SkillMods = Record<SkillIdSuffix, SkillMod>;

function neutralMod(): SkillMod {
    return { level: 1, dmgMul: 1, cdMul: 1, v2: NO_VARIANT, v4: NO_VARIANT };
}

export function emptySkillMods(): SkillMods {
    return {
        basic: neutralMod(), a1: neutralMod(), a2: neutralMod(),
        a3: neutralMod(), dodge: neutralMod(), burst: neutralMod(),
    };
}

export const EMPTY_SKILL_MODS: SkillMods = emptySkillMods();

function skillDefsOf(classId: ClassId): SkillDef[] {
    return SKILLS.filter((sk) => sk.classId === classId);
}

/**
 * 从存档推导 6 个技能位的最终修正。
 * 非法等级 / 未解锁的变体一律按未选处理（与 sanitizeSave 口径一致）。
 */
export function skillModsFromSave(save: {
    classId: ClassId;
    skills?: Record<string, number>;
    variants?: Record<string, [number | null, number | null]>;
}): SkillMods {
    const out = emptySkillMods();
    if (!save || !save.classId) return out;
    for (const def of skillDefsOf(save.classId)) {
        const rawLevel = save.skills ? save.skills[def.id] : 1;
        const level = Math.max(SKILL_MIN_LEVEL, Math.min(SKILL_MAX_LEVEL, Math.floor(Number(rawLevel) || 1)));
        const mod: SkillMod = {
            level,
            dmgMul: 1 + SKILL_DMG_PER_LEVEL * (level - 1),
            cdMul: Math.max(0.5, 1 - SKILL_CD_PER_LEVEL * (level - 1)),
            v2: NO_VARIANT,
            v4: NO_VARIANT,
        };
        const mods = WARRIOR_VARIANT_MODS[def.id];
        const state = save.variants ? save.variants[def.id] : null;
        if (mods && Array.isArray(state)) {
            if (level >= 2 && (state[0] === 0 || state[0] === 1)) mod.v2 = mods[0][state[0]];
            if (level >= 4 && (state[1] === 0 || state[1] === 1)) mod.v4 = mods[1][state[1]];
        }
        mod.dmgMul *= (mod.v2.dmgMul || 1) * (mod.v4.dmgMul || 1);
        mod.cdMul *= (mod.v2.cdMul || 1) * (mod.v4.cdMul || 1);
        out[def.suffix] = mod;
    }
    return out;
}

// ==================== 饰品倍率 ====================

/**
 * 饰品的「数值层」倍率（设计 §4.1：两格合计 1.20×）。
 * 饰品的规则改写效果排到 M7（见设计 §7），这里先把主属性倍率接进 profile，
 * 让五层倍率的乘积在实战里真能跑到 9.5×，而不是只在纸上成立。
 */
export const TRINKET_MUL_MAX = 1.2;

export function trinketMultiplier(trinkets: Array<string | null> | null | undefined): number {
    if (!Array.isArray(trinkets)) return 1;
    const known: Record<string, true> = {};
    for (const t of TRINKETS) known[t.id] = true;
    let count = 0;
    for (const id of trinkets) {
        if (typeof id === 'string' && known[id]) count++;
    }
    return 1 + (TRINKET_MUL_MAX - 1) * Math.max(0, Math.min(2, count)) / 2;
}
