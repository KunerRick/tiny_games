/**
 * 《秘银远征》战斗核心（纯逻辑，**不得 import cc**）。
 *
 * M0 立的骨架（确定性随机 / 伤害公式 / 固定步长世界）保持对外形状不变；
 * M1 在其上补齐垂直切片：
 *  - 战士六技能与怒气循环
 *  - 近战 / 远程 / 精英 / BOSS 四类敌人 AI
 *  - 3 遭遇 + 1 BOSS 的副本推进
 *  - BOSS 三阶段机制解算器：走位（预警圈）/ 转火（小怪回血）/ 打断（读条）
 *
 * 所有随机都走 world.rng，保证同种子同输入 → 同快照。
 * 渲染层只读 snapshot + drainEvents，绝不改这里的任何状态。
 */

import {
    BOSS_INTRO_GAP,
    BOSS_PHASE_HEAL_PCT,
    CLASS_KITS,
    EMBER_STACK_MAX,
    ECHO_CD_EVERY,
    ENCOUNTER_GAP,
    ENCOUNTER_HEAL_PCT,
    ENEMY_BY_ID,
    FIELD_H,
    FIELD_W,
    FIXED_DT,
    GEAR_SLOTS,
    MAX_BULLETS,
    MAX_ENEMIES,
    MAX_ORBS,
    MINE_BOSS_SCRIPT,
    MODIFIER_BY_ID,
    MYTHIC_CURSE_TAKEN,
    ORB_ADD_DROP_CHANCE,
    ORB_DROP_CHANCE,
    ORB_HEAL_PCT,
    ORB_LIFE,
    ORB_PICKUP_RADIUS,
    PLAYER_TUNING,
    SOUL_SPLIT_CHANCE,
    THORN_ARMOR_MAX_HP,
    THORN_ARMOR_REFLECT,
    dungeonRunPlan,
    emptyBountyStats,
} from './MithrilConfig';
import type {
    BossScriptDef,
    BountyStats,
    ClassId,
    ClassKitDef,
    EnemyDef,
    EquipItem,
    GearSlot,
    ModifierId,
    RunPlan,
    SkillActDef,
} from './MithrilConfig';
import {
    BALANCED_ALLOC,
    CRIT_MULT,
    attackPowerAt,
    gearApMultiplier,
    maxHpAt,
    secondaryStats,
} from './MithrilProgress';
import type { AffixAlloc, MithrilSave } from './MithrilProgress';
import { equipStats } from './MithrilLoot';
import { mealMultipliers } from './MithrilCamp';
import {
    emptySkillMods,
    emptyTalentEffects,
    skillModsFromSave,
    talentEffects,
} from './MithrilTalents';
import type { SkillMod, SkillMods, TalentEffects } from './MithrilTalents';
import { trinketFxOf } from './MithrilTrinkets';
import type { TrinketEnemy, TrinketFx, TrinketHost, TrinketSlotKey } from './MithrilTrinkets';

export { FIELD_H, FIELD_W, FIXED_DT, MAX_BULLETS, MAX_ENEMIES };

/** 受击后无敌时长（秒） */
export const HIT_INVULN = 0.5;
/** 玩家碰撞半径 */
export const PLAYER_RADIUS = 18;
/** 玩家基础移速（设计像素 / 秒） */
export const PLAYER_SPEED = 240;
/** 天赋「铁壁」的 1 点护甲 = 0.5% 物理减伤 */
export const ARMOR_DR_PER_POINT = 0.005;
/** 荆棘堡垒的反击半径（设计只写「受伤 10% 转 AoE」，半径按近战威胁范围取） */
export const THORN_RADIUS = 140;
/** 连续命中层数上限（血之狂潮） */
export const COMBO_MAX = 10;
/** 连续命中的判定间隔：超过这么久没打中就从 0 重新叠 */
export const COMBO_TIMEOUT = 9;

/** 受击来源信息（M3 的反弹 / 护甲 / 减速都靠这几个标记区分） */
export interface HitOptions {
    /** 物理伤害（吃护甲） */
    physical?: boolean;
    /** 近战接触（吃反弹） */
    melee?: boolean;
    /** 来源敌人（反弹 / 荆棘用） */
    attacker?: EnemyState | null;
    /** 附带减速（BOSS 砸地） */
    slow?: boolean;
}

/** 玩家攻击的类型：只有技能吃「重击」，反弹不吃任何条件加成 */
export type DamageSource = 'basic' | 'skill' | 'dot' | 'reflect';

/** 玩家出生点（下方，给上方敌人留出走位空间） */
export const PLAYER_START_X = FIELD_W / 2;
export const PLAYER_START_Y = 380;

// ==================== 随机 ====================

/** 同种子必然同序列；返回 [0, 1) */
export function mulberry32(seed: number): () => number {
    let a = (Math.floor(seed) >>> 0) || 1;
    return function next(): number {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ==================== 战斗属性 ====================

export interface CombatProfile {
    classId: ClassId;
    level: number;
    attackPower: number;
    maxHp: number;
    critChance: number;
    critMult: number;
    haste: number;
    mastery: number;
    vers: number;
    /** 天赋聚合效果（M3；未点是全 0） */
    talents: TalentEffects;
    /** 技能等级 / 变体修正（M3；默认 1 级无变体） */
    skills: SkillMods;
    /** 已装备的改造词条（取并集，M2 补全：规则改写类效果） */
    modifiers: ModifierId[];
    /** 是否穿着秘境（红）装备：带「诅咒」，受到伤害 +15% */
    curse: boolean;
}

/** 已装备的改造词条并集（不含背包里没穿的） */
export function equippedModifiers(save: MithrilSave): ModifierId[] {
    const out: ModifierId[] = [];
    for (const slot of GEAR_SLOTS) {
        const item = save.equips ? (save.equips as Record<string, EquipItem | undefined>)[slot] : null;
        const id = item && item.modifier;
        if (id && MODIFIER_BY_ID[id] && out.indexOf(id as ModifierId) < 0) out.push(id as ModifierId);
    }
    return out;
}

/** 是否穿着秘境（红）装备（诅咒来源） */
export function wearingMythic(save: MithrilSave): boolean {
    if (!save.equips) return false;
    for (const slot of GEAR_SLOTS) {
        const item = (save.equips as Record<string, EquipItem | undefined>)[slot];
        if (item && item.quality === 'mythic') return true;
    }
    return false;
}

/** 由等级 + 装备装等 + 词条配点推导出实战属性 */
export function makeProfile(
    classId: ClassId,
    level: number,
    ilvl: number,
    alloc: AffixAlloc = BALANCED_ALLOC,
): CombatProfile {
    const sec = secondaryStats(ilvl, alloc);
    return {
        classId,
        level,
        attackPower: attackPowerAt(level),
        maxHp: maxHpAt(level),
        critChance: sec.crit,
        critMult: CRIT_MULT,
        haste: sec.haste,
        mastery: sec.mastery,
        vers: sec.vers,
        talents: emptyTalentEffects(),
        skills: emptySkillMods(),
        modifiers: [],
        curse: false,
    };
}

/** 从存档逐件求和（装备的词条点 + 耐力），而不是拿平均装等近似 */
export function profileFromSave(save: MithrilSave, minIlvl = 0): CombatProfile {
    const st = equipStats(save.equips);
    const base = makeProfile(save.classId, save.level, st.ilvl);
    // 副属性来自装备词条（设计 §4.3「地板」）：逐件求和后按 cap 收敛。
    // `minIlvl` 是「空档地板」——切片期换装前只有 0% 暴击，而 BOSS 是按 ilvl5 均衡配点
    // 调的平衡基线，所以给一条按 ilvl 均衡配点算出的副属性下限，装备超过下限就自然接管。
    // 注意不能用「基线 + 装备」相加：ilvl40 均衡配点本身已触顶，相加会让装备词条全部浪费。
    const floor = makeProfile(save.classId, save.level, Math.max(0, minIlvl));
    const tal = talentEffects(save.talents, save.classId);
    // 设计 §7.1：饰品**不提供任何无条件数值**，只改写规则（M7）。
    // 旧的「按已装备件数折 1.00–1.20×」占位实现已删除：它让面板 DPS 好看，
    // 却让 20 件饰品全部变成同一个乘数，构不成任何 build 差异。
    // 攻击强度由等级 × 装备 × 天赋（精准）三层相乘；
    // 暴击率 / 暴伤 / 攻速 / 技能加成等天赋则落到各自的消费点，不在这里重复乘。
    const ap = base.attackPower * gearApMultiplier(st.ilvl) * (1 + tal.apPct);
    // 营地料理（M5）：进本前吃下的 buff 按场次生效，面板与实战必须读同一份乘数
    const meal = mealMultipliers(save);
    // 改造词条「荆棘」：近战反伤 30%，代价最大生命 -10%（与料理 / 耐力同层乘算）
    const mods = equippedModifiers(save);
    const thorn = mods.indexOf('thorn_armor') >= 0;
    const maxHp = (base.maxHp + st.bonusHp) * (1 + meal.hp) * (thorn ? 1 - THORN_ARMOR_MAX_HP : 1);
    return {
        ...base,
        attackPower: ap * (1 + meal.ap),
        maxHp,
        critChance: Math.min(1, Math.max(st.crit, floor.critChance) + tal.critChance + meal.crit),
        critMult: base.critMult + tal.critMult,
        haste: Math.max(st.haste, floor.haste) + meal.haste,
        mastery: Math.max(st.mastery, floor.mastery),
        vers: Math.max(st.vers, floor.vers) + meal.vers,
        talents: tal,
        skills: skillModsFromSave(save),
        modifiers: mods,
        curse: wearingMythic(save),
    };
}

export interface DamageResult {
    damage: number;
    crit: boolean;
}

/**
 * 单次伤害：攻击强度 × 全能 × 精通 × 技能倍率，暴击再乘 1.6。
 * 任何非有限输入都退化为 0，保证长跑不会污染出 NaN。
 */
export function computeDamage(
    profile: CombatProfile,
    rng: () => number,
    skillMultiplier = 1,
    guaranteedCrit = false,
    critBonus = 0,
): DamageResult {
    const ap = Number.isFinite(profile.attackPower) ? Math.max(0, profile.attackPower) : 0;
    const vers = Number.isFinite(profile.vers) ? Math.max(0, profile.vers) : 0;
    const mastery = Number.isFinite(profile.mastery) ? Math.max(0, profile.mastery) : 0;
    const mul = Number.isFinite(skillMultiplier) && skillMultiplier > 0 ? skillMultiplier : 0;
    const critChance = Math.max(0, Math.min(1, (Number.isFinite(profile.critChance) ? profile.critChance : 0)
        + (Number.isFinite(critBonus) ? critBonus : 0)));
    const crit = guaranteedCrit || rng() < critChance;
    const critMult = Number.isFinite(profile.critMult) ? Math.max(1, profile.critMult) : 1;
    const damage = ap * (1 + vers) * (1 + mastery) * mul * (crit ? critMult : 1);
    return { damage: Number.isFinite(damage) ? damage : 0, crit };
}

// ==================== 状态 ====================

export interface PlayerCooldowns {
    basic: number;
    charge: number;
    whirlwind: number;
    armorBreak: number;
    dodge: number;
    burst: number;
}

export interface PlayerState {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    radius: number;
    invuln: number;
    facing: number;
    /** 主资源池 0–100（战士怒气 / 法师与牧师法力 / 游侠能量；字段名沿用 rage 以保持老测试） */
    rage: number;
    /** 圣能 0–100（牧师专用：普攻与治疗积攒，爆发消耗） */
    holy: number;
    cd: PlayerCooldowns;
    /** 爆发期间的技能资源消耗倍率（法师奥术强化 ×2） */
    costMul: number;
    /** 爆发期间的治疗倍率（牧师圣能爆发 ×2） */
    burstHealMul: number;
    /** 旋风斩剩余持续时间 */
    whirlwind: number;
    /** 旋风斩下一跳倒计时 */
    whirlTick: number;
    /** 血怒剩余持续时间 */
    burst: number;
    /** 血怒期间的受伤倍率修正（基础 +0.15，天赋 / 变体往下扣） */
    burstTakenMod: number;
    /** 血怒期间的伤害加成（基础 +0.30，变体 / 天赋往上加） */
    burstDamage: number;
    /** 护盾池（吸收伤害，先于生命结算） */
    shield: number;
    /** 减速剩余（BOSS 砸地） */
    slow: number;
    /** 减伤窗口剩余（冲锋「回身」） */
    guard: number;
    /** 减伤窗口比例 */
    guardCut: number;
    /** 连续命中层数（血之狂潮） */
    combo: number;
    /** 距离上次命中的时间（超过 COMBO_TIMEOUT 清层） */
    comboTimer: number;
    /** 下一击必暴（侧步「反击步」） */
    nextCrit: boolean;
    /** 侧步后的反击窗口剩余 */
    counterReady: number;
    /** 本副本剩余免死次数（不朽） */
    cheatDeaths: number;
    /** 破阵攻速 buff 剩余 / 加成 */
    hasteBuff: number;
    hasteBuffAmt: number;
    /** 普攻计数（连斩） */
    swingCount: number;
    /** 每 5 秒回怒气的计时器（战地指挥） */
    rageTimer: number;
    /** 隐身（暗影披风）；渲染层压 alpha，伤害乘数在饰品引擎里 */
    hidden: boolean;
}

export interface EnemyStatus {
    stun: number;
    slow: number;
    armorBreak: number;
    /** 减甲幅度（破甲 20% + 天赋「压制」），与剩余时间分开存，不同破甲强度可以并存 */
    armorBreakBonus: number;
    burnDps: number;
    burnRemaining: number;
}

export interface EnemyState {
    id: number;
    kind: string;
    name: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    radius: number;
    speed: number;
    contactDamage: number;
    isElite: boolean;
    isBoss: boolean;
    status: EnemyStatus;
    /** 攻击计时器（远程 / 精英 / BOSS 共用） */
    shotCd: number;
    slamCd: number;
    /** 接触伤害冷却（秒）：贴脸时也只在归零后结算一次 */
    contactCd: number;
    /** BOSS 读条期间停止移动 */
    casting: boolean;
    /** 出生时刻（world.time）：悬赏「精英无伤击杀」判定用 */
    spawnTime: number;
    /**
     * 朝向（弧度）。敌人每次实际位移时更新为移动方向；
     * 站桩敌人保持出生朝向 —— 影刺协同的「背刺」判定读它。
     */
    facing: number;
}

export type BulletOwner = 'player' | 'enemy';

export interface BulletState {
    id: number;
    owner: BulletOwner;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    damage: number;
    life: number;
    kind: string;
    /** 命中后的燃烧（火球）：每秒伤害与剩余时长 */
    burnDps?: number;
    burnDur?: number;
    /** 掷骰时已判定的暴击（投射物命中沿用，不二次掷骰） */
    crit?: boolean;
    /**
     * 追踪转向速率（弧度/秒）：手机端没有瞄准输入，普攻会自动锁最近的敌人，
     * 但「锁定发射点」不等于「能打中」—— 小怪以 105–125 速度追人时，
     * 0.3s 的飞行时间就足以让它走出判定圈，远程实战 DPS 只剩木桩的一半。
     * 给玩家弹道一点自导，锁定目标后逐步修正朝向。
     */
    homing?: number;
    /** 追踪目标 id（敌人 id，不是数组下标：数组会被 splice） */
    targetId?: number;
}

/** 游侠冰霜陷阱：落地后触发一次范围减速 */
export interface TrapState {
    id: number;
    x: number;
    y: number;
    radius: number;
    /** 剩余存在时间（秒） */
    life: number;
    /** 初始存在时间（秒），渲染层算剩余比例用 */
    maxLife: number;
    slowPct: number;
    slowDur: number;
}

export interface TelegraphState {
    id: number;
    x: number;
    y: number;
    radius: number;
    /** 已预警时长 */
    t: number;
    /** 预警总时长 */
    warn: number;
    damage: number;
    kind: string;
    /** 是否已经结算 */
    done: boolean;
}

/** 血球：击杀掉落，靠近自动拾取回血 */
export interface OrbState {
    id: number;
    x: number;
    y: number;
    amount: number;
    life: number;
}

export interface BossCastState {
    name: string;
    total: number;
    remaining: number;
    /** 打断所需累计伤害 */
    need: number;
    taken: number;
}

export interface BannerState {
    title: string;
    subtitle: string;
    t: number;
}

export type DungeonStage = 'idle' | 'encounter' | 'boss' | 'cleared';

export interface MithrilInput {
    moveX: number;
    moveY: number;
    aimX: number;
    aimY: number;
    /** 按住即持续普攻 */
    basic?: boolean;
    skill1?: boolean;
    skill2?: boolean;
    skill3?: boolean;
    burst?: boolean;
    dodge?: boolean;
}

export type WorldPhase = 'playing' | 'dead' | 'won';

export type CoreEvent =
    | { type: 'damage'; target: 'enemy' | 'player'; x: number; y: number; amount: number; crit: boolean }
    | { type: 'heal'; x: number; y: number; amount: number }
    | { type: 'kill'; x: number; y: number; kind: string; exp: number; gold: number }
    | { type: 'swing'; x: number; y: number; facing: number; radius: number }
    | { type: 'whirl'; x: number; y: number; radius: number }
    | { type: 'dodge'; x: number; y: number; facing: number }
    | { type: 'charge'; x: number; y: number }
    | { type: 'boom'; x: number; y: number; radius: number }
    | { type: 'castStart'; name: string; total: number; need: number }
    | { type: 'castEnd'; interrupted: boolean }
    | { type: 'phase'; phase: number; name: string }
    | { type: 'stage'; stage: DungeonStage; index: number }
    | { type: 'regen'; x: number; y: number; amount: number }
    | { type: 'enrage'; duration: number }
    /** 饰品落雷（雷暴图腾）：一条竖线 + 顶点白闪 */
    | { type: 'lightning'; x: number; y: number }
    /** 饰品爆炸（烬火石 / 反伤溅射 / 雷音）：扩散圆环 */
    | { type: 'blast'; x: number; y: number; radius: number };

export interface MithrilSnapshot {
    time: number;
    phase: WorldPhase;
    player: PlayerState;
    enemies: EnemyState[];
    bullets: BulletState[];
    telegraphs: TelegraphState[];
    orbs: OrbState[];
    traps: TrapState[];
    /** 职业与资源模型（HUD 按它换技能键文案与资源条） */
    classId: ClassId;
    resourceName: string;
    resourceMax: number;
    holyMax: number;
    kills: number;
    /** 本局悬赏统计（M8）：只读副本，结算时交给悬赏系统 */
    stats: BountyStats;
    stage: DungeonStage;
    encounterIndex: number;
    encounterName: string;
    banner: BannerState | null;
    boss: {
        id: number;
        name: string;
        hp: number;
        maxHp: number;
        phase: number;
        casting: boolean;
        enraged: number;
    } | null;
    bossCast: BossCastState | null;
    bossEnraged: number;
    /** BOSS 机制提示（区域首领与副本 BOSS 不同） */
    bossHint: string;
    /** BOSS 阶段总数（HUD 显示「阶段 n/N」） */
    bossPhaseCount: number;
    dungeonName: string;
    dungeonProgress: string;
    /** 最近 1.5 秒触发的饰品 / 协同 id（HUD 提示行与探针读它） */
    trinketProcs: string[];
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

/** 归一化到 (-π, π] */
function wrapAngle(a: number): number {
    let v = a;
    while (v > Math.PI) v -= Math.PI * 2;
    while (v <= -Math.PI) v += Math.PI * 2;
    return v;
}

function makeCooldowns(): PlayerCooldowns {
    return { basic: 0, charge: 0, whirlwind: 0, armorBreak: 0, dodge: 0, burst: 0 };
}

function makeStatus(): EnemyStatus {
    return { stun: 0, slow: 0, armorBreak: 0, armorBreakBonus: 0, burnDps: 0, burnRemaining: 0 };
}

function copyPlayer(p: PlayerState): PlayerState {
    return { ...p, cd: { ...p.cd } };
}

function copyEnemy(e: EnemyState): EnemyState {
    return { ...e, status: { ...e.status } };
}

/** 固定步长世界 */
export class MithrilWorld implements TrinketHost {
    /** 出战属性；升级时由 setProfile 整体替换（M3 起可变） */
    profile: CombatProfile;
    readonly rng: () => number;
    /** 饰品效果引擎（M7）：空饰品时所有钩子直接短路 */
    readonly trinkets: TrinketFx;

    time = 0;
    phase: WorldPhase = 'playing';
    kills = 0;
    expGained = 0;
    goldGained = 0;

    /** 本局悬赏统计（M8）：`startPlan()` 清零，渲染层只读 `snapshot().stats` */
    readonly stats: BountyStats = emptyBountyStats();
    private _killTimes: number[] = [];
    /** 玩家上次真正被命中的时刻；-1 = 本局尚未挨打 */
    private _lastPlayerDamageTime = -1;
    /** 最近一次击杀的伤害来源（BOSS 技能尾刀判定） */
    private _lastKillingSource: DamageSource = 'basic';

    player: PlayerState;
    enemies: EnemyState[] = [];
    bullets: BulletState[] = [];
    telegraphs: TelegraphState[] = [];
    orbs: OrbState[] = [];
    /** 游侠陷阱（M6） */
    traps: TrapState[] = [];

    /** 本局战斗计划（副本或野外节点；M4 起 Core 不再写死矿坑） */
    plan: RunPlan | null = null;
    /** 副本运行态 */
    dungeonId = '';
    dungeonName = '';
    stage: DungeonStage = 'idle';
    encounterIndex = -1;
    banner: BannerState | null = null;

    boss: EnemyState | null = null;
    bossPhase = 0;
    bossCast: BossCastState | null = null;
    bossEnraged = 0;

    private _script: BossScriptDef = MINE_BOSS_SCRIPT;
    private _nextId = 1;
    private _gap = 0;
    private _mechanicTimer = 0;
    private _regenTick = 0;
    private _events: CoreEvent[] = [];

    /** 当前职业的战斗套件（老存档 / 未知职业一律回落到战士） */
    get kit(): ClassKitDef {
        return CLASS_KITS[this.profile.classId] || CLASS_KITS.warrior;
    }

    /** 身上是否带某条改造词条（每帧多处查询，做成 O(5) 的数组查找即可） */
    private _mod(id: ModifierId): boolean {
        return this.profile.modifiers.indexOf(id) >= 0;
    }

    /**
     * 改造词条「回响」的施放计数：按技能槽累计，每第 3 次把这次冷却减半。
     * 放进 world 而不是 player，是因为它属于「这一局」而不是角色属性；
     * 重新开始 / 换关卡时随世界一起丢弃即可。
     */
    private _castCounts: Record<string, number> = {};

    constructor(profile: CombatProfile, seed = 1, trinkets: Array<string | null> | null = null) {
        this.profile = profile;
        this.rng = mulberry32(seed);
        this.player = {
            x: PLAYER_START_X,
            y: PLAYER_START_Y,
            hp: profile.maxHp,
            maxHp: profile.maxHp,
            radius: PLAYER_RADIUS,
            invuln: 0,
            facing: Math.PI / 2,
            rage: 0,
            holy: 0,
            cd: makeCooldowns(),
            costMul: 1,
            burstHealMul: 1,
            whirlwind: 0,
            whirlTick: 0,
            burst: 0,
            burstTakenMod: PLAYER_TUNING.burst.takenBonus,
            burstDamage: PLAYER_TUNING.burst.dmgBonus,
            shield: 0,
            slow: 0,
            guard: 0,
            guardCut: 0,
            combo: 0,
            comboTimer: 0,
            nextCrit: false,
            counterReady: 0,
            cheatDeaths: profile.talents.cheatDeath,
            hasteBuff: 0,
            hasteBuffAmt: 0,
            swingCount: 0,
            rageTimer: 0,
            hidden: false,
        };
        // 玩家状态就绪后再建饰品引擎：它持有宿主引用（this）并读取 player.enemies
        this.trinkets = trinketFxOf(trinkets, this);
    }

    /**
     * 战斗中升级 / 换 build：整体替换 profile，并按生命上限的变化同步当前生命。
     * 升级回满血会掩盖「升级续航」的设计，所以只补差额（掉上限时不扣当前生命之外的部分）。
     */
    setProfile(next: CombatProfile): void {
        const before = this.profile.maxHp;
        this.profile = next;
        const delta = next.maxHp - before;
        this.player.maxHp = next.maxHp;
        if (delta > 0) this.player.hp = Math.min(next.maxHp, this.player.hp + delta);
        else this.player.hp = Math.min(this.player.hp, next.maxHp);
        // 免死次数按新流派的天赋补足（只在还没用掉时增加，不重置已消耗的）
        this.player.cheatDeaths = Math.max(this.player.cheatDeaths, next.talents.cheatDeath);
    }

    // ==================== 生成 ====================

    /** 生成敌人；达到上限返回 null（上限 40）。kind 命中配置表时自动带体型与名字。 */
    spawnEnemy(
        kind: string,
        x: number,
        y: number,
        hp: number,
        speed = 60,
        contactDamage = 8,
    ): EnemyState | null {
        if (this.enemies.length >= MAX_ENEMIES) return null;
        const def: EnemyDef | undefined = ENEMY_BY_ID[kind];
        const maxHp = Number.isFinite(hp) ? Math.max(1, hp) : 1;
        const enemy: EnemyState = {
            id: this._nextId++,
            kind,
            name: def ? def.name : kind,
            x: clamp(x, 0, FIELD_W),
            y: clamp(y, 0, FIELD_H),
            hp: maxHp,
            maxHp,
            radius: def ? def.radius : 20,
            speed: clamp(speed, 0, 400),
            contactDamage: Math.max(0, Number.isFinite(contactDamage) ? contactDamage : 0),
            isElite: !!def && def.kind === 'elite',
            isBoss: !!def && def.kind === 'boss',
            status: makeStatus(),
            shotCd: def && def.shotCd ? def.shotCd : 0,
            slamCd: def && def.slamCd ? def.slamCd : 0,
            contactCd: 0,
            casting: false,
            spawnTime: this.time,
            // 出生朝向：面向玩家出发点（站桩敌人不会更新，背刺判定用它）
            facing: Math.atan2(PLAYER_START_Y - y, PLAYER_START_X - x),
        };
        this.enemies.push(enemy);
        return enemy;
    }

    /** 按配置表生成（副本编排用），scale 用于后续装等缩放 */
    spawnDef(defId: string, x: number, y: number, scale = 1): EnemyState | null {
        const def = ENEMY_BY_ID[defId];
        if (!def) return null;
        const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
        return this.spawnEnemy(defId, x, y, def.hp * k, def.speed, def.contactDamage);
    }

    /** 发射子弹；达到上限返回 null（上限 300） */
    fireBullet(
        owner: BulletOwner,
        x: number,
        y: number,
        vx: number,
        vy: number,
        damage: number,
        life = 2,
        kind = '',
    ): BulletState | null {
        if (this.bullets.length >= MAX_BULLETS) return null;
        const bullet: BulletState = {
            id: this._nextId++,
            owner,
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
            vx: Number.isFinite(vx) ? vx : 0,
            vy: Number.isFinite(vy) ? vy : 0,
            radius: kind === 'boulder' ? 14 : 8,
            damage: Number.isFinite(damage) ? Math.max(0, damage) : 0,
            life: Math.max(0, Number.isFinite(life) ? life : 0),
            kind,
        };
        this.bullets.push(bullet);
        return bullet;
    }

    // ==================== 副本推进 ====================

    /** 开始「废弃矿坑」垂直切片：3 遭遇 + BOSS */
    startDungeon(dungeonId = 'mine'): void {
        const plan = dungeonRunPlan(dungeonId) || dungeonRunPlan('mine');
        if (!plan) return;
        this.startPlan(plan);
    }

    /** 野外节点：沿用远征当前生命（进节点时已扣过补给） */
    startWild(plan: RunPlan, hp: number): void {
        this.startPlan(plan, hp);
    }

    /**
     * 一局战斗的公共重置。副本从满血开始，野外节点从远征当前生命开始；
     * `encounters` 为空表示直接进 BOSS（野外 BOSS 节点），`boss` 为空表示打完遭遇即结束。
     */
    startPlan(plan: RunPlan, hp?: number): void {
        this.plan = plan;
        this._script = plan.boss || MINE_BOSS_SCRIPT;
        this.dungeonId = plan.id;
        this.dungeonName = plan.name;
        this.stage = plan.encounters.length > 0 ? 'encounter' : 'boss';
        this.encounterIndex = -1;
        this.boss = null;
        this.bossPhase = 0;
        this.bossCast = null;
        this.bossEnraged = 0;
        this._mechanicTimer = 0;
        this._regenTick = 0;
        this._gap = 0;
        this._resetBountyStats();
        this.orbs.length = 0;
        this.traps.length = 0;
        this.phase = 'playing';
        this.player.maxHp = this.profile.maxHp;
        this.player.hp = hp === undefined
            ? this.player.maxHp
            : Math.max(1, Math.min(this.player.maxHp, Math.round(hp)));
        // 战士从 0 怒起手；法系职业进本时资源是满的（否则第一个技能都放不出）
        this.player.rage = this.kit.resource === 'rage' ? 0 : this.kit.resourceMax;
        this.player.holy = 0;
        this.player.costMul = 1;
        this.player.burstHealMul = 1;
        this.player.shield = 0;
        this.player.slow = 0;
        this.player.guard = 0;
        this.player.guardCut = 0;
        this.player.combo = 0;
        this.player.nextCrit = false;
        this.player.counterReady = 0;
        this.player.cheatDeaths = this.profile.talents.cheatDeath;
        this.player.hasteBuff = 0;
        this.player.hasteBuffAmt = 0;
        this.player.swingCount = 0;
        this.player.rageTimer = 0;
        this.player.hidden = false;
        // 节点级饰品状态（守誓者每副本一次、隐身 / 时间窗）在开战时重置
        this.trinkets.resetNode();
        this.player.burst = 0;
        this.player.burstTakenMod = PLAYER_TUNING.burst.takenBonus;
        this.player.burstDamage = PLAYER_TUNING.burst.dmgBonus;
        for (const key of Object.keys(this.player.cd) as Array<keyof PlayerCooldowns>) {
            this.player.cd[key] = 0;
        }
        // 回响的施放计数按「每一局」重新开始（换节点 / 重开都不继承）
        this._castCounts = {};
        if (plan.encounters.length === 0) {
            if (plan.boss) this._enterBoss();
            else this._finishRun();
        } else {
            this._spawnNextEncounter();
        }
    }

    /** 悬赏统计清零（每局开战 / 换盘时调用） */
    private _resetBountyStats(): void {
        const s = this.stats;
        s.mobKills = 0;
        s.eliteKills = 0;
        s.bossKills = 0;
        s.eliteNoHitKills = 0;
        s.burstEliteKills = 0;
        s.lowHpKills = 0;
        s.maxKillsIn10s = 0;
        s.crits = 0;
        s.bossLastHitSkill = false;
        this._killTimes.length = 0;
        this._lastPlayerDamageTime = -1;
        this._lastKillingSource = 'basic';
    }

    /** 当前遭遇结束到下一波之间的空档（秒） */
    get gap(): number {
        return this._gap;
    }

    get bossScript(): BossScriptDef {
        return this._script;
    }

    drainEvents(): CoreEvent[] {
        if (this._events.length === 0) return [];
        const out = this._events;
        this._events = [];
        return out;
    }

    // ==================== 饰品宿主动作（M7） ====================
    //
    // 饰品效果**不直接改 world 字段**，只调这几个出口。好处：
    //  1. 效果与战斗管线只有一处契约，自检可以用假宿主单独验一件饰品；
    //  2. 伤害类效果统一走 `_pending` 队列（flush 时结算），不会在 `_damageEnemy`
    //     的敌人循环里递归 splice 数组，把伤害打到错位目标上。

    attackPower(): number {
        return this.profile.attackPower;
    }

    healPlayer(amount: number): number {
        const before = this.player.hp;
        this._healPlayer(amount);
        const healed = this.player.hp - before;
        if (healed > 0) {
            this._emit({ type: 'heal', x: this.player.x, y: this.player.y, amount: healed });
        }
        return healed;
    }

    addShield(amount: number, capPct: number): void {
        if (!(amount > 0)) return;
        const cap = Math.max(0, this.player.maxHp * Math.max(0, capPct));
        this.player.shield = Math.min(cap, this.player.shield + amount);
    }

    addOrb(x: number, y: number, amount: number): void {
        if (this.orbs.length >= MAX_ORBS) return;
        this.orbs.push({
            id: this._nextId++,
            x,
            y,
            amount: Math.max(1, Math.round(Number.isFinite(amount) ? amount : 1)),
            life: ORB_LIFE,
        });
    }

    addGold(amount: number): void {
        if (!(amount > 0)) return;
        this.goldGained += Math.round(amount);
    }

    resetCooldown(slot: TrinketSlotKey): void {
        this.player.cd[slot] = 0;
    }

    grantHaste(amount: number, duration: number): void {
        if (!(amount > 0) || !(duration > 0)) return;
        this.player.hasteBuff = Math.max(this.player.hasteBuff, duration);
        this.player.hasteBuffAmt = Math.max(this.player.hasteBuffAmt, amount);
    }

    /** 结算本帧排队的饰品伤害（按敌人 id 重新定位，避免下标漂移） */
    private _flushTrinketFx(): void {
        this.trinkets.flush((fx) => {
            if (fx.targetId !== undefined) {
                const index = this.enemies.findIndex((e) => e.id === fx.targetId);
                if (index >= 0) this._damageEnemy(index, fx.amount, false, 'dot');
                return;
            }
            const list: number[] = [];
            for (let i = 0; i < this.enemies.length; i++) {
                const e = this.enemies[i];
                if (!e) continue;
                const reach = fx.radius + e.radius;
                if (dist2(e.x, e.y, fx.x, fx.y) <= reach * reach) list.push(i);
            }
            for (let k = list.length - 1; k >= 0; k--) {
                this._damageEnemy(list[k], fx.amount, false, 'dot');
            }
        });
        // 特效与伤害分开取：特效只是表现，不参与结算（半径已由 TrinketFx 夹过）
        const visuals = this.trinkets.drainVisuals();
        for (const v of visuals) {
            if (v.kind === 'lightning') this._emit({ type: 'lightning', x: v.x, y: v.y });
            else this._emit({ type: 'blast', x: v.x, y: v.y, radius: v.radius });
        }
    }

    // ==================== 主循环 ====================

    /**
     * 推进一个固定步长。dt 只用于测试贴合固定步长；正常调用一律 FIXED_DT。
     * 返回是否仍在进行中。
     */
    step(dt: number, input: MithrilInput): boolean {
        if (this.phase !== 'playing') return false;
        const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : FIXED_DT;
        this.time += d;

        this._tickPlayer(d, input || { moveX: 0, moveY: 0, aimX: 0, aimY: 0 });
        if (this.phase !== 'playing') {
            this._tickTimersOnly(d);
            return false;
        }
        this._tickEnemies(d);
        this._tickTraps(d);
        this._tickTelegraphs(d);
        this._tickBullets(d);
        this._tickOrbs(d);
        this._tickBoss(d);
        this._tickRun(d);
        this._tickTimersOnly(d);
        // 饰品的位移 / 计时钩子必须在本帧玩家移动之后跑，否则隐身会晚一帧
        this.trinkets.tick(d);
        this._flushTrinketFx();
        return this.phase === 'playing';
    }

    /**
     * 对玩家造成伤害；无敌帧内忽略。返回是否真的扣血（护盾全吃也算）。
     *
     * 结算顺序（M3 起有天赋后每一步都必须有确定位置，否则「护甲 / 减伤 / 护盾」会互相覆盖）：
     *  血怒受伤惩罚 → 护盾吸收 → 各项减伤 → 免死 → 扣血 → 反弹 / 荆棘 → 减速
     */
    hitPlayer(damage: number, opts: HitOptions = {}): boolean {
        if (this.phase !== 'playing' || this.player.invuln > 0) return false;
        const p = this.player;
        const tal = this.profile.talents;
        let dmg = Number.isFinite(damage) ? Math.max(0, damage) : 0;
        if (p.burst > 0) dmg *= Math.max(0, 1 + p.burstTakenMod);
        // 悬赏「无伤击杀」：只要这一击有伤害（哪怕被护盾全吃）就算挨打
        if (dmg > 0) this._lastPlayerDamageTime = this.time;

        // 护盾先吃伤害（钢铁阵型 / 后续职业的护盾技能共用这一池）
        let absorbed = 0;
        if (p.shield > 0 && dmg > 0) {
            absorbed = Math.min(p.shield, dmg);
            p.shield -= absorbed;
            dmg -= absorbed;
        }

        let dr = Math.max(0, -tal.takenMul);
        if (opts.physical) dr += tal.armor * ARMOR_DR_PER_POINT;
        if (p.hp / Math.max(1, p.maxHp) < 0.3) dr += tal.lowHpDr;
        if (p.guard > 0) dr += p.guardCut;
        // 职业护甲（M6）：板甲战士靠减伤站住近战位
        dr += Math.max(0, this.kit.dr || 0);
        if (opts.melee) dr += Math.max(0, this.kit.contactDr || 0);
        dr = Math.max(0, Math.min(0.75, dr));
        dmg *= 1 - dr;
        // 秘境（红）诅咒：受到伤害 +15%（放在减伤之后，是实打实多挨的血）
        if (this.profile.curse) dmg *= 1 + MYTHIC_CURSE_TAKEN;

        // 免死（不朽）：致命伤触发一次，回 35% 生命并给 1.5s 无敌
        if (dmg > 0 && p.hp - dmg <= 0 && p.cheatDeaths > 0) {
            p.cheatDeaths--;
            p.hp = Math.max(1, Math.round(p.maxHp * 0.35));
            p.invuln = 1.5;
            this._emit({ type: 'heal', x: p.x, y: p.y, amount: p.hp });
            this._emit({ type: 'damage', target: 'player', x: p.x, y: p.y, amount: dmg, crit: false });
            return true;
        }

        // 守誓者徽记（M7）：每个节点首次致死免疫，回 30% 生命
        if (dmg > 0 && p.hp - dmg <= 0 && this.trinkets.trySaveFromDeath()) {
            p.hp = Math.max(1, Math.round(p.maxHp * 0.3));
            p.invuln = 1.5;
            this._emit({ type: 'heal', x: p.x, y: p.y, amount: p.hp });
            this._emit({ type: 'damage', target: 'player', x: p.x, y: p.y, amount: dmg, crit: false });
            return true;
        }

        const landed = dmg;
        p.hp = Math.max(0, p.hp - dmg);
        p.invuln = HIT_INVULN;
        this._gainRage(PLAYER_TUNING.rageOnHurt);
        if (dmg > 0) {
            this._emit({ type: 'damage', target: 'player', x: p.x, y: p.y, amount: dmg, crit: false });
        }

        // 反弹（近战接触）+ 格挡反击（侧步后的反击窗口）
        const taken = landed + absorbed;
        if (taken > 0 && opts.attacker) {
            let reflect = opts.melee ? tal.meleeReflect : 0;
            // 改造词条「荆棘」：近战反伤 30%（代价是最大生命 -10%，在 profile 里扣）
            if (opts.melee && this._mod('thorn_armor')) reflect += THORN_ARMOR_REFLECT;
            if (p.counterReady > 0) reflect += tal.counterReflect;
            if (reflect > 0) this._reflect(opts.attacker, taken * reflect);
        }
        if (p.counterReady > 0) p.counterReady = 0;

        // 荆棘堡垒：受的伤害按比例炸回去
        if (tal.thornAoe > 0 && taken > 0) this._thornAoe(p.x, p.y, taken * tal.thornAoe);

        // 饰品（M7）：荆棘之冠 / 反伤甲片 / 守财。taken 是护盾吸收前的原始伤害，
        // 否则「护盾挡住的伤害不反弹」会让荆棘类饰品在满盾时完全失效
        if (taken > 0) this.trinkets.onDamaged(opts.attacker || null, taken, !!opts.melee);

        // 控制：BOSS 砸地的减速（钢铁意志按比例缩短）
        if (opts.slow) {
            p.slow = Math.max(p.slow, 1.5 * (1 - Math.max(0, Math.min(0.9, tal.ccResist))));
        }

        if (p.hp <= 0) {
            p.hp = 0;
            this.phase = 'dead';
        }
        return true;
    }

    /** 对指定敌人造成伤害；击杀后移除并计数。保留 M0 签名。 */
    damageEnemy(index: number, damage: number): boolean {
        return this._damageEnemy(index, damage, false);
    }

    snapshot(): MithrilSnapshot {
        return {
            time: this.time,
            phase: this.phase,
            player: copyPlayer(this.player),
            enemies: this.enemies.map(copyEnemy),
            bullets: this.bullets.map((b) => ({ ...b })),
            telegraphs: this.telegraphs.map((t) => ({ ...t })),
            orbs: this.orbs.map((o) => ({ ...o })),
            traps: this.traps.map((t) => ({ ...t })),
            classId: this.profile.classId,
            resourceName: this.kit.resourceName,
            resourceMax: this.kit.resourceMax,
            holyMax: this.kit.holyMax || 0,
            kills: this.kills,
            stats: { ...this.stats },
            stage: this.stage,
            encounterIndex: this.encounterIndex,
            encounterName: this.plan
                && this.encounterIndex >= 0
                && this.encounterIndex < this.plan.encounters.length
                ? this.plan.encounters[this.encounterIndex].name
                : '',
            banner: this.banner ? { ...this.banner } : null,
            boss: this.boss
                ? {
                    id: this.boss.id,
                    name: this.boss.name,
                    hp: this.boss.hp,
                    maxHp: this.boss.maxHp,
                    phase: this.bossPhase,
                    casting: this.boss.casting,
                    enraged: this.bossEnraged,
                }
                : null,
            bossCast: this.bossCast ? { ...this.bossCast } : null,
            bossEnraged: this.bossEnraged,
            bossHint: this.plan ? this.plan.bossHint : '',
            bossPhaseCount: this.plan && this.plan.boss ? Math.max(1, this.plan.boss.phases.length) : 3,
            dungeonName: this.dungeonName,
            dungeonProgress: this._progressText(),
            // HUD 直接显示这几个字符串：必须给玩家看得懂的文案，
            // 给 id 会渲染成 `synergy:thunderclap` 这种内部标识（M7 浏览器验证发现）
            trinketProcs: this.trinkets.procLabels(),
        };
    }

    // ==================== 玩家 ====================

    private _tickTimersOnly(d: number): void {
        this.player.invuln = Math.max(0, this.player.invuln - d);
        if (this.banner) {
            this.banner.t = Math.max(0, this.banner.t - d);
            if (this.banner.t <= 0) this.banner = null;
        }
    }

    private _tickPlayer(d: number, input: MithrilInput): void {
        const p = this.player;
        const cd = p.cd;
        const tal = this.profile.talents;
        const skills = this.profile.skills;
        cd.basic = Math.max(0, cd.basic - d);
        cd.charge = Math.max(0, cd.charge - d);
        cd.whirlwind = Math.max(0, cd.whirlwind - d);
        cd.armorBreak = Math.max(0, cd.armorBreak - d);
        cd.dodge = Math.max(0, cd.dodge - d);
        cd.burst = Math.max(0, cd.burst - d);
        p.burst = Math.max(0, p.burst - d);
        if (p.burst <= 0) {
            p.costMul = 1;
            p.burstHealMul = 1;
        }
        p.slow = Math.max(0, p.slow - d);
        p.guard = Math.max(0, p.guard - d);
        p.counterReady = Math.max(0, p.counterReady - d);
        p.hasteBuff = Math.max(0, p.hasteBuff - d);
        p.comboTimer += d;
        if (p.comboTimer > COMBO_TIMEOUT) p.combo = 0;

        const kit = this.kit;
        if (kit.resource === 'rage') {
            // 战地指挥：每 5 秒回固定怒气（不吃「战术精通」的百分比，否则会双倍放大）
            if (tal.rageRegen > 0) {
                p.rageTimer += d;
                while (p.rageTimer >= 5) {
                    p.rageTimer -= 5;
                    p.rage = Math.min(100, p.rage + tal.rageRegen);
                }
            }
        } else if (kit.resource === 'energy') {
            // 能量：站桩回得快、边跑边回得慢，鼓励在走位间隙攒资源
            const moving = Math.hypot(
                Number.isFinite(input.moveX) ? input.moveX : 0,
                Number.isFinite(input.moveY) ? input.moveY : 0,
            ) > 0.2;
            const regen = moving ? (kit.moveRegen ?? kit.regen) : kit.regen;
            p.rage = Math.min(kit.resourceMax, p.rage + regen * d);
        } else {
            // 法力（法师 / 牧师）：稳定的每秒回复
            p.rage = Math.min(kit.resourceMax, p.rage + kit.regen * d);
        }

        // 旋风斩持续时间与跳伤
        if (p.whirlwind > 0) {
            p.whirlwind = Math.max(0, p.whirlwind - d);
            p.whirlTick -= d;
            if (p.whirlTick <= 0) {
                p.whirlTick += (kit.a2.tick || PLAYER_TUNING.whirlwind.tick) * (skills.a2.v2.tickMul || 1);
                this._whirlTick(skills.a2);
                if (this.phase !== 'playing') return;
            }
        }

        // 移动
        let mx = Number.isFinite(input.moveX) ? input.moveX : 0;
        let my = Number.isFinite(input.moveY) ? input.moveY : 0;
        const len = Math.hypot(mx, my);
        if (len > 1) {
            mx /= len;
            my /= len;
        }
        let speed = PLAYER_SPEED * this.trinkets.speedMul();
        if (p.whirlwind > 0) speed *= PLAYER_TUNING.whirlwind.moveScale;
        if (p.slow > 0) speed *= 0.6;
        p.x = clamp(p.x + mx * speed * d, p.radius, FIELD_W - p.radius);
        p.y = clamp(p.y + my * speed * d, p.radius, FIELD_H - p.radius);

        const aimX = Number.isFinite(input.aimX) ? input.aimX : 0;
        const aimY = Number.isFinite(input.aimY) ? input.aimY : 0;
        if (Math.hypot(aimX, aimY) > 0.2) {
            p.facing = Math.atan2(aimY, aimX);
        } else {
            // 自动索敌朝向：手机端只有摇杆、没有瞄准输入。若朝向只跟移动方向走，
            // 玩家绕圈走位时剑永远指向切向，普攻 45° 扇形扫不到身前的目标
            // （BOSS 半径 44、站位 120+，实测整场只有约 5 DPS，BOSS 打不死）。
            const focus = this._nearestEnemy(this._focusRange(), true);
            if (focus) p.facing = Math.atan2(focus.y - p.y, focus.x - p.x);
            else if (len > 0.01) p.facing = Math.atan2(my, mx);
        }

        // 闪避 / 保命（按职业分派：战士翻滚、法师屏障、游侠翻滚、牧师圣光步）
        if (input.dodge && cd.dodge <= 0) {
            const mod = skills.dodge;
            const act = kit.dodge;
            if (this._spend(act.cost || 0)) {
                if (act.act === 'barrier') {
                    p.shield = Math.max(p.shield, p.maxHp * (act.shieldPct || 0));
                    p.invuln = Math.max(p.invuln, act.freeze || 0.3);
                    this._emit({ type: 'boom', x: p.x, y: p.y, radius: 46 });
                } else {
                    // 站着不动时朝向已被自动索敌吸住，直接沿用 facing 会冲进敌人身体里，
                    // 所以无移动输入时朝目标反方向后撤。
                    const dir = Math.hypot(mx, my) > 0.2
                        ? Math.atan2(my, mx)
                        : (this._nearestEnemy(this._focusRange(), true) ? p.facing + Math.PI : p.facing);
                    const dist = (act.distance || 0) + (mod.v2.distAdd || 0) + (mod.v4.distAdd || 0);
                    this._dash(dir, dist);
                    const baseInvuln = act.freeze !== undefined ? act.freeze : PLAYER_TUNING.dodge.invuln;
                    p.invuln = Math.max(p.invuln, baseInvuln + (mod.v2.invulnAdd || 0) + (mod.v4.invulnAdd || 0));
                    this._emit({ type: 'dodge', x: p.x, y: p.y, facing: dir });
                }
                // 战士沿用老公式（有 1s 下限与天赋减免），其它职业走统一冷却
                const baseCd = kit.resource === 'rage'
                    ? Math.max(1, act.cd * mod.cdMul / (1 + this.profile.haste) - tal.dodgeCdCut)
                    : this._skillCd(act.cd, mod);
                // 改造词条「回响」对闪避同样生效（闪避也算技能槽），战士的 1s 下限仍在
                const echoCd = this._echoAdjustedCd('dodge', baseCd);
                cd.dodge = kit.resource === 'rage' ? Math.max(1, echoCd) : echoCd;
                if (mod.v4.nextCrit || act.nextCrit) p.nextCrit = true;
                if (tal.counterReflect > 0) p.counterReady = 1.5;
                // 饰品（M7）：静默之铃 / 影回 / 影刺的窗口都从「闪避成功」起算
                this.trinkets.onDodge();
            }
        }

        // 普攻
        if (input.basic && cd.basic <= 0) {
            this._basicAttack(skills.basic);
            cd.basic = this._echoAdjustedCd('basic', kit.basic.cd * skills.basic.cdMul / (1 + this._effHaste()));
        }

        // 技能槽 1 / 2 / 3（cd.charge / cd.whirlwind / cd.armorBreak 是槽位名，不是技能名）
        if (input.skill1) cd.charge = this._trySkillSlot('charge', cd.charge, kit.a1, skills.a1);
        if (input.skill2 && p.whirlwind <= 0) {
            cd.whirlwind = this._trySkillSlot('whirlwind', cd.whirlwind, kit.a2, skills.a2);
        }
        if (input.skill3) cd.armorBreak = this._trySkillSlot('armorBreak', cd.armorBreak, kit.a3, skills.a3);

        // 爆发（战士血怒 / 法师奥术强化 / 游侠鹰眼 / 牧师圣能爆发）
        if (input.burst && cd.burst <= 0 && this._tryBurst(skills.burst)) {
            cd.burst = this._echoAdjustedCd('burst', this._skillCd(kit.burst.cd, skills.burst));
        }
    }

    /**
     * 技能槽施放（M7 起统一入口）：回响石 / 影回可以免资源，静默之铃把下一发变成必暴，
     * 成功后记账给回响计数与共鸣水晶用。返回该槽的新冷却（没放出去就原样返回）。
     */
    private _trySkillSlot(slot: TrinketSlotKey, cd: number, act: SkillActDef, mod: SkillMod): number {
        if (cd > 0) return cd;
        const free = this.trinkets.wantFreeCast(slot);
        if (!free && !this._spend(act.cost || 0)) return cd;
        if (this.trinkets.consumeForcedSkillCrit()) this.player.nextCrit = true;
        if (!this._castSlot(act, mod)) return cd;
        this.trinkets.onSkillCast(slot, free);
        return this._echoAdjustedCd(slot, this._skillCd(act.cd, mod));
    }

    /**
     * 改造词条「回响」：每第 3 次施放同一技能，这次冷却减半。
     * 计数在「真正施放成功」之后累加 —— 被资源不足挡下的施放不该推进计数。
     */
    private _echoAdjustedCd(slot: string, cd: number): number {
        if (!this._mod('echo_cd')) return cd;
        const n = (this._castCounts[slot] = (this._castCounts[slot] || 0) + 1);
        if (n % ECHO_CD_EVERY !== 0) return cd;
        return Math.max(0.2, cd * 0.5);
    }

    /** 普攻按职业分派：战士近战扇形，法系发射投射物 */
    private _basicAttack(mod: SkillMod): void {
        const act = this.kit.basic;
        if (act.act === 'swing') this._swing(mod);
        else this._fireBolt(act, mod, this._basicRange(act));
    }

    /** 自动索敌距离：近战用剑刃半径，远程用技能射程（鹰眼爆发会拉长普攻射程） */
    private _focusRange(): number {
        const act = this.kit.basic;
        if (act.act === 'swing') return PLAYER_TUNING.basic.radius + 90;
        return this._basicRange(act);
    }

    private _basicRange(act: SkillActDef): number {
        const base = act.range || 500;
        if (act.act !== 'bolt') return base;
        return base * (this.player.burst > 0 ? 1 + (this.kit.burst.rangeBonus || 0) : 1);
    }

    /** 技能槽分派；返回 false 表示这招没打出去（不进冷却、不扣资源已被前置 `_spend` 挡住） */
    private _castSlot(act: SkillActDef, mod: SkillMod): boolean {
        switch (act.act) {
            case 'charge':
                this._charge(mod);
                return true;
            case 'whirl':
                this.player.whirlwind = (act.duration || 0) + (mod.v4.durationAdd || 0);
                this.player.whirlTick = 0;
                return true;
            case 'break':
                return this._armorBreak(mod);
            case 'fireball':
                this._fireBolt(act, mod, this._basicRange(act));
                return true;
            case 'novaFreeze':
                this._nova(act, mod, false);
                return true;
            case 'volley':
                this._volley(act, mod);
                return true;
            case 'trap':
                this._trap(act);
                return true;
            case 'blink':
            case 'backjump':
                this._blink(act, mod);
                return true;
            case 'heal':
                this._healSelf(act);
                return true;
            case 'novaHeal':
                this._nova(act, mod, true);
                return true;
            case 'shield':
                this._shieldSelf(act);
                return true;
            default:
                return false;
        }
    }

    /** 每点资源消耗都过这里；爆发期间按 `costMul` 放大（法师奥术强化耗蓝翻倍） */
    private _spend(cost: number): boolean {
        const p = this.player;
        const need = Math.max(0, Number.isFinite(cost) ? cost : 0) * Math.max(1, p.costMul);
        if (need <= 0) return true;
        if (p.rage + 1e-6 < need) return false;
        p.rage = Math.max(0, p.rage - need);
        return true;
    }

    private _gainHoly(amount: number): void {
        const max = this.kit.holyMax || 0;
        if (max <= 0 || !(amount > 0)) return;
        this.player.holy = Math.min(max, this.player.holy + amount);
    }

    /** 爆发前置检查与结算；返回是否成功释放 */
    private _tryBurst(mod: SkillMod): boolean {
        const p = this.player;
        const tal = this.profile.talents;
        const kit = this.kit;
        const act = kit.burst;
        if (act.holyCost) {
            if (p.holy + 1e-6 < act.holyCost) return false;
            p.holy = Math.max(0, p.holy - act.holyCost);
        } else if (!this._spend(act.cost || 0)) {
            return false;
        }
        p.burst = (act.duration || 0) + (mod.v2.durationAdd || 0);
        p.burstDamage = (act.dmgBonus || 0) + tal.burstDamage + (mod.v4.burstDmgAdd || 0);
        // 变体的「受伤惩罚」是往职业基础上做加减，最后夹在 [-100%, +100%]
        p.burstTakenMod = Math.max(-1, Math.min(
            1,
            (act.takenBonus || 0)
            + (mod.v2.burstTakenAdd || 0)
            + (mod.v4.burstTakenAdd || 0)
            - tal.burstTaken,
        ));
        p.costMul = act.costMul || 1;
        p.burstHealMul = act.healMul || 1;
        if (tal.burstShield > 0) {
            p.shield = Math.max(p.shield, p.maxHp * tal.burstShield);
        }
        return true;
    }

    /** 攻速换算后的急速（普攻冷却用）：基础急速 + 双持 + 无尽怒焰 + 破阵 */
    private _effHaste(): number {
        const p = this.player;
        const tal = this.profile.talents;
        let h = this.profile.haste + Math.max(0, tal.attackSpeed);
        if (p.burst > 0) h += Math.max(0, tal.burstAttackSpeed);
        if (p.hasteBuff > 0) h += p.hasteBuffAmt;
        return Math.max(0, Math.min(2, h));
    }

    /** 技能冷却：急速 + 技能等级/变体 + 战术大师 + 饰品（嗜血护符低血 ×0.6） */
    private _skillCd(base: number, mod: SkillMod): number {
        const tal = this.profile.talents;
        const cdMul = Number.isFinite(mod.cdMul) && mod.cdMul > 0 ? mod.cdMul : 1;
        const cd = base * cdMul / (1 + Math.max(0, this.profile.haste));
        return Math.max(
            0.2,
            cd * (1 - Math.max(0, Math.min(0.6, tal.skillCd))) * this.trinkets.skillCooldownMul(),
        );
    }

    /** 怒气获取统一走这里（战术精通按比例放大；非战士职业直接忽略） */
    private _gainRage(amount: number): void {
        if (this.kit.resource !== 'rage') return;
        if (!(amount > 0)) return;
        const tal = this.profile.talents;
        this.player.rage = Math.min(100, this.player.rage + amount * (1 + Math.max(0, tal.rageGain)));
    }

    /** 掷伤害：消费「下一击必暴」；爆发期间额外吃职业暴击加成（游侠鹰眼） */
    private _rollDamage(mult: number): DamageResult {
        const p = this.player;
        const forced = p.nextCrit;
        if (forced) p.nextCrit = false;
        const burstCrit = p.burst > 0 ? (this.kit.burst.critBonus || 0) : 0;
        const res = computeDamage(this.profile, this.rng, mult, forced, burstCrit);
        // 改造词条「裂魂」：暴击时 20% 概率重置闪避（只在真的暴击后才多掷一次骰子，
        // 没带这条词条时随机序列完全不变，老自检的确定性断言不受影响）
        if (res.crit && this._mod('soul_split') && this.rng() < SOUL_SPLIT_CHANCE) {
            p.cd.dodge = 0;
        }
        return res;
    }

    private _dash(dir: number, distance: number): void {
        const p = this.player;
        p.x = clamp(p.x + Math.cos(dir) * distance, p.radius, FIELD_W - p.radius);
        p.y = clamp(p.y + Math.sin(dir) * distance, p.radius, FIELD_H - p.radius);
        p.facing = dir;
    }

    private _swing(mod: SkillMod): void {
        const p = this.player;
        const t = PLAYER_TUNING.basic;
        // 横扫变体把扇形扩到 120°（半角 ×1.333）；命中判定用「距离 − 敌人半径」，转身也必须同口径，
        // 否则大体积的 BOSS 站在 120 距离上会被判成「不在扇形内」而永远空挥。
        const halfAngle = t.halfAngle * (mod.v2.arcMul || 1);
        let target: EnemyState | null = null;
        let bestReach = Infinity;
        for (const e of this.enemies) {
            const reach = Math.hypot(e.x - p.x, e.y - p.y) - e.radius;
            if (reach <= t.radius && reach < bestReach) {
                bestReach = reach;
                target = e;
            }
        }
        if (target) p.facing = Math.atan2(target.y - p.y, target.x - p.x);
        // 连斩：每第 N 次普攻整段加倍
        p.swingCount++;
        const per = mod.v4.comboEvery || 0;
        const comboHit = per > 0 && p.swingCount % per === 0;
        const mult = t.mult * mod.dmgMul * (comboHit ? (mod.v4.comboMul || 1) : 1);
        const hitsList: Array<[number, DamageResult]> = [];
        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            const dx = e.x - p.x;
            const dy = e.y - p.y;
            const dist = Math.hypot(dx, dy);
            if (dist > t.radius + e.radius) continue;
            const angle = Math.abs(wrapAngle(Math.atan2(dy, dx) - p.facing));
            if (angle > halfAngle && e !== target) continue;
            hitsList.push([i, this._rollDamage(mult)]);
        }
        this._emit({ type: 'swing', x: p.x, y: p.y, facing: p.facing, radius: t.radius });
        // 结算必须**倒序**：_damageEnemy 打死人会 splice 掉该敌人，升序结算会让后面所有下标
        // 前移一位 —— 轻则丢伤害，重则把伤害打到扇形外的旁观敌人身上（怒气也会按虚高次数多发）。
        // 掷骰顺序仍是升序，同种子结果不变。
        const hitCount = hitsList.length;
        for (let i = hitsList.length - 1; i >= 0; i--) {
            const [index, res] = hitsList[i];
            const dmg = res.damage * this._playerDamageMult();
            this._damageEnemy(index, dmg, res.crit, 'basic');
        }
        if (hitCount > 0) {
            this._gainRage(t.rage + Math.min(4, (hitCount - 1) * 2));
        }
    }

    private _whirlTick(mod: SkillMod): void {
        const p = this.player;
        const t = PLAYER_TUNING.whirlwind;
        const radius = t.radius + (mod.v2.radiusAdd || 0);
        this._emit({ type: 'whirl', x: p.x, y: p.y, radius });
        let hit = false;
        const mult = t.mult * mod.dmgMul;
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            if (!e) continue;
            if (dist2(e.x, e.y, p.x, p.y) > (radius + e.radius) * (radius + e.radius)) continue;
            const res = this._rollDamage(mult);
            hit = true;
            this._damageEnemy(i, res.damage * this._playerDamageMult(), res.crit, 'skill');
        }
        if (hit) this._gainRage(3);
    }

    private _charge(mod: SkillMod): void {
        const p = this.player;
        const t = PLAYER_TUNING.charge;
        const tal = this.profile.talents;
        const dist = t.distance + (mod.v2.distAdd || 0) + (mod.v4.distAdd || 0);
        const stun = t.stun + (mod.v2.stunAdd || 0) + (mod.v4.stunAdd || 0) + Math.max(0, tal.stunBonus);
        let dir = p.facing;
        if (this.enemies.length > 0) {
            const near = this._nearestEnemy(360, true);
            if (near) dir = Math.atan2(near.y - p.y, near.x - p.x);
        }
        const sx = p.x;
        const sy = p.y;
        this._dash(dir, dist);
        this._emit({ type: 'charge', x: p.x, y: p.y });
        const seen: Record<number, true> = {};
        let hitAny = false;
        const mult = t.mult * mod.dmgMul;
        for (let s = 0; s <= 8; s++) {
            const k = s / 8;
            const px = sx + (p.x - sx) * k;
            const py = sy + (p.y - sy) * k;
            for (let i = this.enemies.length - 1; i >= 0; i--) {
                const e = this.enemies[i];
                if (!e || seen[e.id]) continue;
                const reach = t.radius + e.radius;
                if (dist2(e.x, e.y, px, py) > reach * reach) continue;
                seen[e.id] = true;
                hitAny = true;
                const res = this._rollDamage(mult);
                e.status.stun = Math.max(e.status.stun, stun);
                this._damageEnemy(i, res.damage * this._playerDamageMult(), res.crit, 'skill');
            }
        }
        if (hitAny) this._gainRage(t.rage);
        // 破阵 / 回身：冲锋后的姿态 buff（不要求命中，否则空冲等于白点天赋）
        if (mod.v4.hasteBuff) {
            p.hasteBuffAmt = mod.v4.hasteBuff;
            p.hasteBuff = mod.v4.hasteBuffDur || 3;
        }
        if (mod.v4.guardDur) {
            p.guard = mod.v4.guardDur;
            p.guardCut = 0.4;
        }
    }

    private _armorBreak(mod: SkillMod): boolean {
        const t = PLAYER_TUNING.armorBreak;
        const tal = this.profile.talents;
        // 破甲要能作用于 BOSS —— 渲染层会给 BOSS 画破甲标记，
        // 之前传 includeBoss=false 导致这招对 BOSS 静默无效。
        const target = this._nearestEnemy(t.range, true);
        if (!target) return false;
        const p = this.player;
        p.facing = Math.atan2(target.y - p.y, target.x - p.x);
        const res = this._rollDamage(t.mult * mod.dmgMul);
        const bonus = t.bonus + Math.max(0, tal.armorBreakBonus) + (mod.v2.armorBreakAdd || 0);
        const duration = t.duration + (mod.v4.durationAdd || 0);
        target.status.armorBreak = Math.max(target.status.armorBreak, duration);
        target.status.armorBreakBonus = Math.max(target.status.armorBreakBonus, bonus);
        // 威慑：破甲附带减速，天赋按比例延长
        target.status.slow = Math.max(target.status.slow, 2 * (1 + Math.max(0, tal.slowBonus)));

        // 裂甲：先结算溅射（会 splice 数组），再按 target 重新定位主目标
        const splash = mod.v2.splashRadius || 0;
        if (splash > 0) {
            const amount = res.damage * this._playerDamageMult() * (mod.v2.splashMul || 0.5);
            const list: number[] = [];
            for (let i = 0; i < this.enemies.length; i++) {
                const e = this.enemies[i];
                if (!e || e === target) continue;
                if (dist2(e.x, e.y, target.x, target.y) <= (splash + e.radius) * (splash + e.radius)) list.push(i);
            }
            for (let k = list.length - 1; k >= 0; k--) this._damageEnemy(list[k], amount, false, 'skill');
        }
        const index = this.enemies.indexOf(target);
        if (index < 0) return true;
        this._damageEnemy(index, res.damage * this._playerDamageMult(), res.crit, 'skill');
        this._gainRage(t.rage);
        return true;
    }

    private _playerDamageMult(): number {
        const burst = this.player.burst > 0 ? 1 + this.player.burstDamage : 1;
        // 饰品（M7）：血契 / 誓血 / 隐身伏击 / 影刺窗口
        return burst * this.trinkets.currentDamageMul();
    }

    // ==================== 法系 / 远程技能（M6） ====================

    /** 远程普攻与火球：朝最近敌人发射投射物；没有目标时朝面向方向射出（保留操作反馈） */
    private _fireBolt(act: SkillActDef, mod: SkillMod, range: number): void {
        const p = this.player;
        const target = this._nearestEnemy(range, true);
        if (target) p.facing = Math.atan2(target.y - p.y, target.x - p.x);
        const speed = act.speed || 500;
        const res = this._rollDamage((act.mult || 1) * mod.dmgMul);
        const cos = Math.cos(p.facing);
        const sin = Math.sin(p.facing);
        const bullet = this.fireBullet(
            'player',
            p.x + cos * (p.radius + 6),
            p.y + sin * (p.radius + 6),
            cos * speed,
            sin * speed,
            res.damage * this._playerDamageMult(),
            (range + 80) / speed,
            act.burnMult ? 'player_fire' : 'player_bolt',
        );
        if (bullet) {
            bullet.radius = act.projRadius || 7;
            bullet.crit = res.crit;
            // 普攻追踪强一些（输出循环靠它），火球弱一些（保留一点走位惩罚）
            if (target) {
                bullet.targetId = target.id;
                bullet.homing = act === this.kit.basic ? 3.4 : 2.2;
            }
            if (act.burnMult && act.burnMult > 0) {
                bullet.burnDps = this.profile.attackPower * act.burnMult * this._playerDamageMult();
                bullet.burnDur = act.burnDur || 0;
            }
        }
        // 牧师普攻积攒圣能（打空也积，避免开局必须贴脸才能放大招）
        if (act === this.kit.basic) this._gainHoly(this.kit.basic.holyGain || 0);
    }

    /** 冰霜新星 / 神圣新星：周身范围伤害，可附带冻结或自愈 */
    private _nova(act: SkillActDef, mod: SkillMod, heal: boolean): void {
        const p = this.player;
        // 饰品（M7）：霜心（冻结类技能半径 +40%），只放大带冻结的新星
        const radius = (act.radius || 120) * (act.freeze ? this.trinkets.frostRadiusMul() : 1);
        this._emit({ type: 'boom', x: p.x, y: p.y, radius });
        const mult = (act.mult || 0) * mod.dmgMul;
        const list: number[] = [];
        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            if (!e) continue;
            if (dist2(e.x, e.y, p.x, p.y) <= (radius + e.radius) * (radius + e.radius)) list.push(i);
        }
        for (let k = list.length - 1; k >= 0; k--) {
            const e = this.enemies[list[k]];
            if (!e) continue;
            if (act.freeze) e.status.stun = Math.max(e.status.stun, act.freeze);
            const res = this._rollDamage(mult);
            this._damageEnemy(list[k], res.damage * this._playerDamageMult(), res.crit, 'skill');
        }
        if (heal) this._healSelf(act);
    }

    /** 多重射击：以朝向为中心均分扇形，每支箭独立掷骰 */
    private _volley(act: SkillActDef, mod: SkillMod): void {
        const p = this.player;
        const target = this._nearestEnemy(act.range || 620, true);
        if (target) p.facing = Math.atan2(target.y - p.y, target.x - p.x);
        const arrows = Math.max(1, Math.round(act.arrows || 1));
        const total = (act.halfAngle || 0.3) * 2;
        const speed = act.speed || 560;
        for (let i = 0; i < arrows; i++) {
            const offset = arrows <= 1 ? 0 : -total / 2 + (total * i) / (arrows - 1);
            const dir = p.facing + offset;
            const res = this._rollDamage((act.mult || 1) * mod.dmgMul);
            const cos = Math.cos(dir);
            const sin = Math.sin(dir);
            const bullet = this.fireBullet(
                'player',
                p.x + cos * (p.radius + 6),
                p.y + sin * (p.radius + 6),
                cos * speed,
                sin * speed,
                res.damage * this._playerDamageMult(),
                ((act.range || 620) + 60) / speed,
                'player_bolt',
            );
            if (bullet) {
                bullet.radius = act.projRadius || 6;
                bullet.crit = res.crit;
                if (target) {
                    bullet.targetId = target.id;
                    bullet.homing = 1.2;
                }
            }
        }
    }

    /** 冰霜陷阱：落在脚下，敌人踩中触发一次范围减速 */
    private _trap(act: SkillActDef): void {
        if (this.traps.length >= 6) this.traps.shift();
        const p = this.player;
        // 饰品（M7）：霜心 —— 冰霜陷阱半径同样 +40%
        const radius = (act.radius || 95) * this.trinkets.frostRadiusMul();
        const life = act.duration || 8;
        this.traps.push({
            id: this._nextId++,
            x: p.x,
            y: p.y,
            radius,
            life,
            maxLife: life,
            slowPct: act.slowPct || 0.5,
            slowDur: act.slowDur || 3,
        });
        this._emit({ type: 'boom', x: p.x, y: p.y, radius });
    }

    /** 闪现 / 后跃：沿面向位移，附带短暂无敌与「下一击必暴」 */
    private _blink(act: SkillActDef, mod: SkillMod): void {
        const p = this.player;
        const dir = act.dir === 'back' ? p.facing + Math.PI : p.facing;
        const dist = (act.distance || 0) + (mod.v2.distAdd || 0) + (mod.v4.distAdd || 0);
        this._dash(dir, dist);
        p.invuln = Math.max(p.invuln, act.freeze !== undefined ? act.freeze : 0.2);
        if (act.nextCrit) p.nextCrit = true;
        this._emit({ type: 'dodge', x: p.x, y: p.y, facing: dir });
    }

    /** 治疗术 / 神圣新星的自我治疗；牧师爆发期间治疗量翻倍 */
    private _healSelf(act: SkillActDef): void {
        const p = this.player;
        const pct = act.healPct || 0;
        if (pct <= 0) return;
        const healed = this._healPlayer(p.maxHp * pct);
        if (healed > 0) this._emit({ type: 'heal', x: p.x, y: p.y, amount: healed });
        this._gainHoly(this.kit.holyPerHeal || 0);
    }

    private _shieldSelf(act: SkillActDef): void {
        const p = this.player;
        if (!(act.shieldPct > 0)) return;
        p.shield = Math.max(p.shield, p.maxHp * act.shieldPct);
        this._emit({ type: 'boom', x: p.x, y: p.y, radius: 46 });
    }

    private _tickTraps(d: number): void {
        for (let i = this.traps.length - 1; i >= 0; i--) {
            const t = this.traps[i];
            t.life -= d;
            if (t.life <= 0) {
                this.traps.splice(i, 1);
                continue;
            }
            let triggered = false;
            for (const e of this.enemies) {
                if (!e) continue;
                const reach = t.radius + e.radius;
                if (dist2(e.x, e.y, t.x, t.y) > reach * reach) continue;
                e.status.slow = Math.max(e.status.slow, t.slowDur);
                triggered = true;
                break;
            }
            if (triggered) {
                this._emit({ type: 'boom', x: t.x, y: t.y, radius: t.radius });
                this.traps.splice(i, 1);
            }
        }
    }

    private _nearestEnemy(range: number, includeBoss = true): EnemyState | null {
        let best: EnemyState | null = null;
        let bestD = range * range;
        for (const e of this.enemies) {
            if (!includeBoss && e.isBoss) continue;
            const d = dist2(e.x, e.y, this.player.x, this.player.y);
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    // ==================== 敌人 ====================

    private _tickEnemies(d: number): void {
        const p = this.player;
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            if (!e) continue;

            // 持续伤害（后续职业会用；M1 战士不触发）
            if (e.status.burnRemaining > 0) {
                e.status.burnRemaining = Math.max(0, e.status.burnRemaining - d);
                // 饰品（M7）：血契（低血时燃烧翻倍）
                e.hp -= e.status.burnDps * d * this.trinkets.burnTickMul();
                if (e.hp <= 0) {
                    this._killEnemyAt(i);
                    continue;
                }
            }
            e.status.stun = Math.max(0, e.status.stun - d);
            e.status.slow = Math.max(0, e.status.slow - d);
            e.status.armorBreak = Math.max(0, e.status.armorBreak - d);
            e.contactCd = Math.max(0, e.contactCd - d);

            if (e.casting) continue;

            const dx = p.x - e.x;
            const dy = p.y - e.y;
            const dist = Math.hypot(dx, dy) || 1;
            const dirX = dx / dist;
            const dirY = dy / dist;

            // 远程：保持距离并射弹
            const def = ENEMY_BY_ID[e.kind];
            if (def && def.kind === 'ranged') {
                const keep = 260;
                const bx = e.x;
                const by = e.y;
                if (dist < keep - 40) {
                    e.x = clamp(e.x - dirX * e.speed * d, e.radius, FIELD_W - e.radius);
                    e.y = clamp(e.y - dirY * e.speed * d, e.radius, FIELD_H - e.radius);
                } else if (dist > keep + 40) {
                    e.x = clamp(e.x + dirX * e.speed * d, e.radius, FIELD_W - e.radius);
                    e.y = clamp(e.y + dirY * e.speed * d, e.radius, FIELD_H - e.radius);
                }
                // 饰品（M7）：只有真的移动过才更新朝向；静止目标保留出生朝向，影刺背刺可判定
                if (e.x !== bx || e.y !== by) e.facing = Math.atan2(dirY, dirX);
                if (e.shotCd > 0) e.shotCd -= d;
                if (e.shotCd <= 0) {
                    e.shotCd = def.shotCd || 3;
                    const sp = def.shotSpeed || 240;
                    this.fireBullet('enemy', e.x, e.y, dirX * sp, dirY * sp, def.shotDamage || 5, 3, 'bolt');
                }
                this._contact(e);
                continue;
            }

            // 近战 / 精英 / BOSS：追击
            if (e.status.stun <= 0) {
                const speed = e.speed * (e.status.slow > 0 ? 0.5 : 1);
                const bx = e.x;
                const by = e.y;
                e.x = clamp(e.x + dirX * speed * d, e.radius, FIELD_W - e.radius);
                e.y = clamp(e.y + dirY * speed * d, e.radius, FIELD_H - e.radius);
                // 饰品（M7）：朝向只在真的移动时更新（供影刺背刺判定）
                if (e.x !== bx || e.y !== by) e.facing = Math.atan2(dirY, dirX);
            }

            // 精英砸地
            if (def && def.kind === 'elite') {
                if (e.slamCd > 0) e.slamCd -= d;
                if (e.slamCd <= 0 && dist < 440) {
                    e.slamCd = def.slamCd || 5;
                    this._spawnTelegraph(p.x, p.y, def.slamRadius || 110, def.slamWarn || 1, (def.slamDamage || 8) * this._bossDamageMult(), 'slam');
                }
            }

            this._contact(e);
            if (this.phase !== 'playing') return;
        }

        this._separateEnemies();
    }

    private _contact(e: EnemyState): void {
        const p = this.player;
        if (e.contactCd > 0) return;
        const reach = e.radius + p.radius;
        if (dist2(e.x, e.y, p.x, p.y) <= reach * reach) {
            const mult = e.isBoss ? this._bossDamageMult() : 1;
            // 接触伤害算物理近战：吃护甲，也触发「反弹」与格挡反击
            if (this.hitPlayer(e.contactDamage * mult, { physical: true, melee: true, attacker: e })) {
                e.contactCd = PLAYER_TUNING.contactCooldown;
            }
        }
    }

    /** BOSS 狂暴伤害倍率；读配置而不是写死 1.5，改数值不用同时改三处 */
    private _bossDamageMult(): number {
        return this.bossEnraged > 0 ? 1 + this._script.enrageBonus : 1;
    }

    /** 轻量分离：避免小怪完全重叠成一坨 */
    private _separateEnemies(): void {
        for (let i = 0; i < this.enemies.length; i++) {
            const a = this.enemies[i];
            if (!a) continue;
            for (let j = i + 1; j < this.enemies.length; j++) {
                const b = this.enemies[j];
                if (!b) continue;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const min = a.radius + b.radius;
                const d2 = dx * dx + dy * dy;
                if (d2 >= min * min) continue;
                const dist = Math.sqrt(d2) || 0.001;
                const push = (min - dist) * 0.5;
                const ux = dx / dist;
                const uy = dy / dist;
                a.x = clamp(a.x - ux * push, a.radius, FIELD_W - a.radius);
                a.y = clamp(a.y - uy * push, a.radius, FIELD_H - a.radius);
                b.x = clamp(b.x + ux * push, b.radius, FIELD_W - b.radius);
                b.y = clamp(b.y + uy * push, b.radius, FIELD_H - b.radius);
            }
        }
    }

    // ==================== 预警圈 / 子弹 / BOSS ====================

    private _spawnTelegraph(x: number, y: number, radius: number, warn: number, damage: number, kind: string): void {
        this.telegraphs.push({
            id: this._nextId++,
            x: clamp(x, 0, FIELD_W),
            y: clamp(y, 0, FIELD_H),
            radius: Math.max(1, radius),
            t: 0,
            warn: Math.max(0.1, warn),
            damage: Math.max(0, damage),
            kind,
            done: false,
        });
    }

    private _tickTelegraphs(d: number): void {
        for (let i = this.telegraphs.length - 1; i >= 0; i--) {
            const t = this.telegraphs[i];
            t.t += d;
            if (!t.done && t.t >= t.warn) {
                t.done = true;
                const reach = t.radius + this.player.radius;
                if (dist2(t.x, t.y, this.player.x, this.player.y) <= reach * reach) {
                    this.hitPlayer(t.damage, { physical: true, slow: t.kind === 'boss_slam' });
                }
                this._emit({ type: 'boom', x: t.x, y: t.y, radius: t.radius });
            }
            if (t.t >= t.warn + 0.25) this.telegraphs.splice(i, 1);
        }
    }

    private _tickBullets(d: number): void {
        const p = this.player;
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            // 自导：贴着飞行方向小角度修正，别做成瞬移式转向
            if (b.homing && b.targetId !== undefined) {
                const tgt = this.enemies.find((e) => e.id === b.targetId);
                if (tgt) {
                    const sp = Math.hypot(b.vx, b.vy);
                    const cur = Math.atan2(b.vy, b.vx);
                    let diff = Math.atan2(tgt.y - b.y, tgt.x - b.x) - cur;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    const maxTurn = b.homing * d;
                    const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
                    b.vx = Math.cos(cur + turn) * sp;
                    b.vy = Math.sin(cur + turn) * sp;
                }
            }
            b.x += b.vx * d;
            b.y += b.vy * d;
            b.life -= d;
            let remove = b.life <= 0 || b.x < -40 || b.x > FIELD_W + 40 || b.y < -40 || b.y > FIELD_H + 40;

            if (!remove && b.owner === 'enemy') {
                const reach = b.radius + p.radius;
                if (dist2(b.x, b.y, p.x, p.y) <= reach * reach) {
                    // 狂暴倍率在发射时就烘进伤害，避免「BOSS 狂暴了，小怪的子弹也跟着变疼」
                    this.hitPlayer(b.damage, { physical: true });
                    remove = true;
                }
            } else if (!remove && b.owner === 'player') {
                for (let j = this.enemies.length - 1; j >= 0; j--) {
                    const e = this.enemies[j];
                    if (!e) continue;
                    const reach = b.radius + e.radius;
                    if (dist2(b.x, b.y, e.x, e.y) > reach * reach) continue;
                    // 火球：先挂燃烧再结算直接伤害（直接伤害可能击杀并 splice 掉它）
                    // 饰品（M7）：余烬指环把「刷新燃烧」变成「叠加燃烧」
                    // 改造词条「余烬」：同一次火球的 DoT 最多叠 3 层（比饰品更宽的叠加上限）。
                    // 取 max 是为了单调不降：增伤窗口过去后单发 burnDps 会变小，
                    // 不能因为「这一发更弱」把已经叠起来的燃烧倒扣下去。
                    if (b.burnDps && b.burnDur) {
                        if (this._mod('ember_stack')) {
                            const st = e.status;
                            st.burnDps = Math.max(
                                st.burnDps,
                                Math.min(b.burnDps * EMBER_STACK_MAX, st.burnDps + b.burnDps),
                            );
                            st.burnRemaining = Math.max(st.burnRemaining, b.burnDur);
                        } else {
                            this.trinkets.applyBurn(e, b.burnDps, b.burnDur);
                        }
                    }
                    this._damageEnemy(j, b.damage, !!b.crit);
                    remove = true;
                    break;
                }
            }
            if (remove) this.bullets.splice(i, 1);
            if (this.phase !== 'playing') return;
        }
    }

    private _tickOrbs(d: number): void {
        const p = this.player;
        // 饰品（M7）：拾荒者护符（血球吸附范围 +40% 上 30%）
        const reach = p.radius + ORB_PICKUP_RADIUS * this.trinkets.orbPickupMul();
        for (let i = this.orbs.length - 1; i >= 0; i--) {
            const o = this.orbs[i];
            o.life -= d;
            if (o.life <= 0) {
                this.orbs.splice(i, 1);
                continue;
            }
            if (p.hp >= p.maxHp) continue;
            if (dist2(o.x, o.y, p.x, p.y) > reach * reach) continue;
            const raw = o.amount * this.trinkets.orbHealMul();
            const heal = this._healPlayer(raw);
            if (heal > 0) this._emit({ type: 'heal', x: o.x, y: o.y, amount: heal });
            this.trinkets.onOrbPicked(heal);
            this.orbs.splice(i, 1);
        }
    }

    private _tickBoss(d: number): void {
        if (this.stage !== 'boss') return;
        const boss = this.boss;
        if (!boss) return;

        this.bossEnraged = Math.max(0, this.bossEnraged - d);

        // 死亡结算
        if (boss.hp <= 0 || this.enemies.indexOf(boss) < 0) {
            this.boss = null;
            this.bossCast = null;
            this.stage = 'cleared';
            this.phase = 'won';
            return;
        }

        // 阶段推进（按血线，不卡阶段）
        const script = this._script;
        while (this.bossPhase < script.thresholds.length
            && boss.hp / boss.maxHp <= script.thresholds[this.bossPhase]) {
            this.bossPhase++;
            this._mechanicTimer = 0;
            const phase = script.phases[this.bossPhase];
            // 阶段转换回血：让玩家有机会整理节奏，而不是被血线直接压死
            const heal = this._healPlayer(this.player.maxHp * BOSS_PHASE_HEAL_PCT);
            if (heal > 0) {
                this._emit({ type: 'heal', x: this.player.x, y: this.player.y, amount: heal });
            }
            this._emit({ type: 'phase', phase: this.bossPhase + 1, name: phase.name });
            this._showBanner(`阶段 ${this.bossPhase + 1} · ${phase.name}`, phase.desc, 2.6);
        }

        // 读条
        if (this.bossCast) {
            boss.casting = true;
            this.bossCast.remaining -= d;
            if (this.bossCast.remaining <= 0) {
                const name = this.bossCast.name;
                this.bossCast = null;
                boss.casting = false;
                this.bossEnraged = script.enrageDuration;
                this._emit({ type: 'castEnd', interrupted: false });
                this._emit({ type: 'enrage', duration: script.enrageDuration });
                this._showBanner('打断失败', `${name}完成：BOSS 伤害 +${Math.round(script.enrageBonus * 100)}%，持续 ${script.enrageDuration} 秒`, 2.2);
            }
            return;
        }

        // BOSS 投射物
        if (boss.shotCd > 0) boss.shotCd -= d;
        if (boss.shotCd <= 0) {
            const def = ENEMY_BY_ID[boss.kind];
            boss.shotCd = def && def.shotCd ? def.shotCd : 3.5;
            const dx = this.player.x - boss.x;
            const dy = this.player.y - boss.y;
            const len = Math.hypot(dx, dy) || 1;
            const sp = def && def.shotSpeed ? def.shotSpeed : 260;
            this.fireBullet(
                'enemy', boss.x, boss.y,
                (dx / len) * sp, (dy / len) * sp,
                (def && def.shotDamage ? def.shotDamage : 8) * this._bossDamageMult(),
                4, 'boulder',
            );
        }

        // 机制
        const phase = script.phases[this.bossPhase];
        this._mechanicTimer += d;
        if (phase.mechanic === 'move') {
            if (this._mechanicTimer >= script.moveInterval) {
                this._mechanicTimer = 0;
                this._spawnTelegraph(
                    this.player.x, this.player.y,
                    script.moveRadius, script.moveWarn, script.moveDamage, 'boss_slam',
                );
            }
        } else if (phase.mechanic === 'adds') {
            const addsAlive = this._countAdds() > 0;
            if (addsAlive) {
                // 召唤物在场时不计时：`_mechanicTimer` 若继续累加，清掉最后一只的下一帧
                // 就已经超过 `addsInterval`，会立刻重刷下一波 —— 玩家永远等不到打 BOSS 的窗口
                this._mechanicTimer = 0;
                const before = boss.hp;
                boss.hp = Math.min(boss.maxHp, boss.hp + script.addsRegen * d);
                this._regenTick += d;
                if (this._regenTick >= 1) {
                    this._regenTick = 0;
                    this._emit({
                        type: 'regen', x: boss.x, y: boss.y,
                        amount: Math.max(0, boss.hp - before),
                    });
                }
            } else if (this._mechanicTimer >= script.addsInterval) {
                this._mechanicTimer = 0;
                this._spawnAdds();
            }
        } else if (phase.mechanic === 'interrupt') {
            if (this._mechanicTimer >= script.interruptInterval) {
                this._mechanicTimer = 0;
                this.bossCast = {
                    name: phase.name,
                    total: script.interruptCast,
                    remaining: script.interruptCast,
                    need: script.interruptNeed,
                    taken: 0,
                };
                boss.casting = true;
                this._emit({
                    type: 'castStart',
                    name: phase.name,
                    total: script.interruptCast,
                    need: script.interruptNeed,
                });
            }
        }
    }

    private _countAdds(): number {
        let n = 0;
        for (const e of this.enemies) if (e.kind === this._script.addsEnemyId) n++;
        return n;
    }

    private _spawnAdds(): void {
        const boss = this.boss;
        if (!boss) return;
        const count = this._script.addsCount;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const x = boss.x + Math.cos(angle) * 120;
            const y = boss.y + Math.sin(angle) * 120;
            // 召唤物也吃副本的整体缩放：否则深渊层的小怪按野外数值进场，
            // 遭遇战里是 0.7 档，BOSS 召唤出来却突然满血
            this.spawnDef(this._script.addsEnemyId, x, y, this.plan ? this.plan.scale : 1);
        }
        const addName = ENEMY_BY_ID[this._script.addsEnemyId]
            ? ENEMY_BY_ID[this._script.addsEnemyId].name
            : '援军';
        this._showBanner(`BOSS 召唤${addName}`, '小怪存活时 BOSS 持续回血，先转火', 2.2);
    }

    // ==================== 伤害与击杀 ====================

    private _damageEnemy(index: number, damage: number, crit: boolean, source: DamageSource = 'basic'): boolean {
        const e = this.enemies[index];
        if (!e) return false;
        let dmg = Number.isFinite(damage) ? Math.max(0, damage) : 0;
        if (e.status.armorBreak > 0 && e.status.armorBreakBonus > 0) {
            dmg *= 1 + e.status.armorBreakBonus;
        }
        dmg *= this._damageMulVs(e, source);
        // 饰品（M7）：霜华坠饰（冻结目标 +25%）/ 影刺（背后 +40%），只作用于玩家自己的伤害
        dmg *= this.trinkets.damageMulVs(e, source);
        e.hp -= dmg;
        // 悬赏统计（M8）：只算玩家直接命中（基本攻击 / 技能），DoT 与反伤不算暴击次数
        if (crit && (source === 'basic' || source === 'skill')) this.stats.crits++;
        if (source !== 'reflect' && source !== 'dot') this._onHitLanded();
        this._emit({ type: 'damage', target: 'enemy', x: e.x, y: e.y, amount: dmg, crit });

        // 饰品触发（M7）：落雷 / 攻速 / 冷却重置。伤害类效果只入队，
        // 由 `_flushTrinketFx()` 在本步末尾结算，避免在这里递归 splice 敌人数组
        if (source === 'basic' || source === 'skill') {
            this.trinkets.onHitLanded(e, crit, source);
        }

        // BOSS 读条：累计伤害用于打断
        if (this.bossCast && this.boss === e) {
            this.bossCast.taken += dmg;
            if (this.bossCast.taken >= this.bossCast.need) {
                const name = this.bossCast.name;
                this.bossCast = null;
                if (this.boss) this.boss.casting = false;
                this._emit({ type: 'castEnd', interrupted: true });
                this._showBanner('打断成功', `${name}被终止`, 1.6);
            }
        }

        if (e.hp > 0) return false;
        this._lastKillingSource = source;
        this._killEnemyAt(index);
        return true;
    }

    /**
     * 天赋里的条件增伤：目标残血 / 濒死、自身低血、连续命中、技能伤害。
     * 全部在「伤害落地前」读取目标血量，避免同一击把目标打进 20% 后立刻吃到斩杀加成。
     */
    private _damageMulVs(e: EnemyState, source: DamageSource): number {
        if (source === 'reflect' || source === 'dot') return 1;
        const p = this.player;
        const tal = this.profile.talents;
        let mul = 1;
        const ratio = e.maxHp > 0 ? e.hp / e.maxHp : 1;
        if (tal.woundedDamage > 0 && ratio < 0.35) mul *= 1 + tal.woundedDamage;
        if (tal.executeDamage > 0 && ratio < 0.2) mul *= 1 + tal.executeDamage;
        if (tal.lowHpDamage > 0 && p.hp / Math.max(1, p.maxHp) < 0.35) mul *= 1 + tal.lowHpDamage;
        if (tal.stackDamage > 0 && p.combo > 0) mul *= 1 + tal.stackDamage * Math.min(COMBO_MAX, p.combo);
        if (source === 'skill' && tal.skillDamage > 0) mul *= 1 + tal.skillDamage;
        return mul;
    }

    /** 记录一次命中：叠「血之狂潮」，并刷新连击计时 */
    private _onHitLanded(): void {
        const p = this.player;
        p.combo = Math.min(COMBO_MAX, p.combo + 1);
        p.comboTimer = 0;
    }

    /** 治疗统一入口（战地医师按比例加成 + 牧师爆发的治疗倍率，且不会溢出上限） */
    private _healPlayer(amount: number): number {
        const p = this.player;
        const mul = (1 + Math.max(0, this.profile.talents.healMul)) * Math.max(1, p.burstHealMul);
        const want = Math.max(0, amount) * mul;
        const heal = Math.min(p.maxHp - p.hp, want);
        if (heal <= 0) return 0;
        p.hp = Math.min(p.maxHp, p.hp + heal);
        // 饰品（M7）：誓约项链把溢出治疗转成护盾
        if (want > heal) this.trinkets.onHealOverflow(want - heal);
        return heal;
    }

    /** 反弹：把伤害按比例打回来源敌人（不吃条件增伤、不叠连击） */
    private _reflect(attacker: EnemyState, amount: number): void {
        const index = this.enemies.indexOf(attacker);
        if (index < 0 || !(amount > 0)) return;
        this._damageEnemy(index, amount, false, 'reflect');
    }

    /** 荆棘堡垒：受伤后对周围敌人造成比例伤害 */
    private _thornAoe(x: number, y: number, amount: number): void {
        if (!(amount > 0)) return;
        const list: number[] = [];
        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            if (!e) continue;
            if (dist2(e.x, e.y, x, y) <= (THORN_RADIUS + e.radius) * (THORN_RADIUS + e.radius)) list.push(i);
        }
        for (let k = list.length - 1; k >= 0; k--) this._damageEnemy(list[k], amount, false, 'reflect');
    }

    private _killEnemyAt(index: number): void {
        const e = this.enemies[index];
        if (!e) return;
        // 悬赏统计（M8）：击杀分类 / 无伤 / 爆发 / 低血 / 10 秒窗口 / BOSS 尾刀来源
        const p = this.player;
        const s = this.stats;
        if (e.isBoss) {
            s.bossKills++;
            s.bossLastHitSkill = this._lastKillingSource === 'skill';
        } else if (e.isElite) {
            s.eliteKills++;
            if (this._lastPlayerDamageTime < e.spawnTime) s.eliteNoHitKills++;
            if (p.burst > 0) s.burstEliteKills++;
        } else {
            s.mobKills++;
        }
        // 玩家当前生命 <20%（击杀回血结算前读）
        if (p.hp > 0 && p.hp / Math.max(1, p.maxHp) < 0.2) s.lowHpKills++;
        this._killTimes.push(this.time);
        while (this._killTimes.length > 0 && this.time - this._killTimes[0] > 10) this._killTimes.shift();
        if (this._killTimes.length > s.maxKillsIn10s) s.maxKillsIn10s = this._killTimes.length;
        const def = ENEMY_BY_ID[e.kind];
        const exp = def ? def.exp : 0;
        const gold = def ? def.gold : 0;
        this.enemies.splice(index, 1);
        this.kills++;
        this.expGained += exp;
        this.goldGained += gold;

        // 血球：普通怪 28%，精英 / BOSS 召唤物 60%
        if (!e.isBoss && this.orbs.length < MAX_ORBS) {
            const chance = e.isElite || e.kind === this._script.addsEnemyId
                ? ORB_ADD_DROP_CHANCE
                : ORB_DROP_CHANCE;
            if (this.rng() < chance) {
                this.orbs.push({
                    id: this._nextId++,
                    x: e.x,
                    y: e.y,
                    amount: Math.max(1, Math.round(this.player.maxHp * ORB_HEAL_PCT)),
                    life: ORB_LIFE,
                });
            }
        }

        if (this.boss === e) {
            this.boss = null;
            this.bossCast = null;
        }
        // 饰品触发（M7）：余烬石（烧死的敌人爆炸）/ 拾荒者项链（精英击杀回血）/ 冰雷协同
        // 只入队，不在这里直接结算伤害
        this.trinkets.onEnemyKilled(e);
        // 嗜血：击杀回血（按最大生命比例，走统一治疗入口吃「战地医师」）；
        // 职业自带的击杀回复（游侠）与天赋叠加
        const killHealPct = this.profile.talents.killHealPct + Math.max(0, this.kit.killHealPct || 0);
        if (killHealPct > 0) {
            const heal = this._healPlayer(this.player.maxHp * killHealPct);
            if (heal > 0) this._emit({ type: 'heal', x: e.x, y: e.y, amount: heal });
        }
        this._emit({ type: 'kill', x: e.x, y: e.y, kind: e.kind, exp, gold });
    }

    // ==================== 副本流程 ====================

    private _tickRun(d: number): void {
        if (this.stage === 'cleared') return;
        const plan = this.plan;
        const total = plan ? plan.encounters.length : 0;

        if (this.stage === 'encounter') {
            if (this._gap > 0) {
                this._gap -= d;
                if (this._gap <= 0) {
                    this._gap = 0;
                    if (this.encounterIndex + 1 < total) this._spawnNextEncounter();
                    else if (plan && plan.boss) this._enterBoss();
                    else this._finishRun();
                }
                return;
            }
            if (this.enemies.length === 0) {
                if (this.encounterIndex >= 0) {
                    const heal = this._healPlayer(this.player.maxHp * (plan ? plan.healPct : ENCOUNTER_HEAL_PCT));
                    // 满血清场时别弹一个实际没加上的绿色数字
                    if (heal > 0) {
                        this._emit({ type: 'heal', x: this.player.x, y: this.player.y, amount: heal });
                    }
                }
                if (this.encounterIndex + 1 < total) {
                    this._gap = ENCOUNTER_GAP;
                } else if (plan && plan.boss) {
                    this._gap = BOSS_INTRO_GAP;
                } else {
                    // 无 BOSS 的野外节点：最后一波清完立刻结算，不再空等黑场
                    this._finishRun();
                }
            }
            return;
        }

        if (this.stage === 'boss' && !this.boss) {
            // _tickBoss 已处理；这里兜底，避免 BOSS 意外丢失卡住
            this.stage = 'cleared';
            this.phase = 'won';
        }
    }

    private _finishRun(): void {
        this.stage = 'cleared';
        this.phase = 'won';
        this._emit({ type: 'stage', stage: 'cleared', index: Math.max(0, this.encounterIndex) });
    }

    private _spawnNextEncounter(): void {
        const plan = this.plan;
        if (!plan) return;
        this.encounterIndex++;
        const total = plan.encounters.length;
        const enc = plan.encounters[this.encounterIndex];
        if (!enc) {
            if (plan.boss) this._enterBoss();
            else this._finishRun();
            return;
        }
        this.stage = 'encounter';
        this._showBanner(`遭遇 ${this.encounterIndex + 1}/${total} · ${enc.name}`, enc.subtitle, 2.2);
        let i = 0;
        for (const group of enc.spawns) {
            for (let n = 0; n < group.count; n++) {
                // 首场第一波出生点更远（体验官 E1：原来 y≈840，3 个敌人 4 秒就贴脸，
                // 新玩家还没学会「按住普攻」就先掉血）。玩家在 (360,380)，这里给到
                // 650+ 像素的接近距离，按小怪 ~105 速度约 6 秒，留足读提示的时间。
                const firstWave = this.encounterIndex === 0;
                const x = firstWave
                    ? 190 + ((i * 113) % 340)
                    : 130 + ((i * 97 + this.encounterIndex * 53) % 460);
                const y = firstWave
                    ? 1030 + ((i * 71) % 170)
                    : 840 + ((i * 61 + this.encounterIndex * 47) % 260);
                this.spawnDef(group.enemyId, x, y, plan.scale);
                i++;
            }
        }
        this._emit({ type: 'stage', stage: 'encounter', index: this.encounterIndex });
    }

    private _enterBoss(): void {
        const plan = this.plan;
        if (!plan || !plan.boss) {
            this._finishRun();
            return;
        }
        this.stage = 'boss';
        this.encounterIndex = Math.max(0, plan.encounters.length - 1);
        this.bossPhase = 0;
        this.bossCast = null;
        this.bossEnraged = 0;
        this._mechanicTimer = 0;
        this._regenTick = 0;
        this.telegraphs.length = 0;
        this.enemies.length = 0;
        const boss = this.spawnDef(this._script.enemyId, FIELD_W / 2, 1000, plan.bossScale);
        this.boss = boss;
        const hint = plan.bossHint || '观察机制提示，按阶段处理';
        this._showBanner(plan.bossTitle || this._script.enemyId, hint, 3.2);
        this._emit({ type: 'stage', stage: 'boss', index: this.encounterIndex });
    }

    private _showBanner(title: string, subtitle: string, t: number): void {
        this.banner = { title, subtitle, t };
    }

    private _progressText(): string {
        if (this.stage === 'idle') return '';
        const plan = this.plan;
        const total = plan ? plan.encounters.length : 0;
        if (this.stage === 'encounter') return `遭遇 ${Math.max(1, this.encounterIndex + 1)}/${Math.max(1, total)}`;
        if (this.stage === 'boss') {
            const phases = plan && plan.boss ? Math.max(1, plan.boss.phases.length) : 3;
            return `BOSS 阶段 ${this.bossPhase + 1}/${phases}`;
        }
        if (this.stage === 'cleared') return plan && plan.kind === 'wild' ? '节点肃清' : '副本通关';
        return '';
    }

    private _emit(ev: CoreEvent): void {
        if (this._events.length >= 240) this._events.shift();
        this._events.push(ev);
    }
}

// ==================== 平衡打桩（自检专用） ====================

/**
 * 对一只「不会死、不会还手」的木桩按标准循环输出的实战 DPS。
 *
 * 用真实战斗结算（含暴击 / 连击 / 条件增伤 / 技能等级与变体），而不是纸面公式，
 * 所以自检能锁住「毕业装 vs 起点」的实测倍率。冲锋不在循环里：它是位移技，
 * 打桩时会把玩家冲过木桩导致大量空挥，反而测不准输出。
 */
export function measureDummyDps(
    profile: CombatProfile,
    seconds = 60,
    seed = 991,
    trinkets: Array<string | null> | null = null,
): number {
    const world = new MithrilWorld(profile, seed, trinkets);
    world.spawnEnemy('dummy', PLAYER_START_X, PLAYER_START_Y + 70, 1e12, 0, 0);
    const input: MithrilInput = {
        moveX: 0, moveY: 0, aimX: 0, aimY: 0,
        basic: true, skill1: false, skill2: true, skill3: true, burst: true, dodge: false,
    };
    const steps = Math.max(1, Math.round(seconds / FIXED_DT));
    let total = 0;
    for (let i = 0; i < steps; i++) {
        world.step(FIXED_DT, input);
        for (const ev of world.drainEvents()) {
            if (ev.type === 'damage' && ev.target === 'enemy') total += ev.amount;
        }
    }
    return total / seconds;
}
