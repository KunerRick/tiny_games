/**
 * 午夜幸存者（Survivor）— 全部数值、类型与调参常量。
 *
 * 本文件 **不依赖 cc**，可在 Node 侧直接编译（见 tools/verify-survivor-core.js）。
 * 设计规格：docs/specs/2026-11-02-game-survivor-design.md
 */

// ==================== 竞技场 ====================

/** 正方形竞技场边长（设计像素） */
export const ARENA_SIZE = 2400;

/** 竞技场半边长：坐标范围 [-1200, 1200] */
export const ARENA_HALF = ARENA_SIZE / 2;

/** 玩家/敌人贴边时保留的余量 */
export const ARENA_MARGIN = 16;

/** 敌人越出场外多少像素后回收 */
export const ENEMY_RECYCLE_MARGIN = 200;

/** 空间分桶边长（900 个桶） */
export const HASH_CELL = 80;

// ==================== 时间 ====================

/** 核心唯一接受的时间步（倍速只在游戏层放大调用次数） */
export const FIXED_DT = 1 / 60;

// ==================== 玩家 ====================

export const PLAYER_HP = 120;
export const PLAYER_SPEED = 220;
export const PLAYER_RADIUS = 14;
export const PLAYER_IFRAME = 0.5;
export const PLAYER_PICKUP = 60;

/** 脱战回血：连续 4 s 未受击后按 2 HP/s 回复（走位好就能把血拉回来） */
export const PLAYER_REGEN_DELAY = 6;
export const PLAYER_REGEN_PER_SEC = 1;

/** 受击时敌人的击退距离 */
export const PLAYER_KNOCKBACK = 40;

/** 敌人对玩家的接触冷却（防同一只怪连续判定） */
export const ENEMY_CONTACT_CD = 0.8;

// ==================== 碰撞上限 ====================

/** 同屏敌人上限（含精英与 Boss） */
export const ENEMY_CAP = 140;

/** 玩家子弹 + 敌弹共用上限 */
export const BULLET_CAP = 120;

/** 地面宝石上限，溢出直接结算经验 */
export const GEM_CAP = 320;

// ==================== 槽位与等级 ====================

export const WEAPON_SLOTS = 3;
export const PASSIVE_SLOTS = 2;

/**
 * 单条武器/被动的最高级（2026-11-09 由 5 提到 8）。
 *
 * 5 级时一局只有 3×5 + 2×5 = 25 次有意义的升级，而宝石成长把终局拉到 26–30 级，
 * 后面几级只能抽「淬炼」。8 级给到 40 次，等级与构筑同步见顶。
 * 同时槽位溢出 bug 已修（见 SurvivorCore._generateOffers），8 级不会撑爆 3+2 槽。
 */
export const MAX_TRACK_LEVEL = 8;
export const MAX_LEVEL = 99;

// ==================== 经验曲线 ====================

/**
 * need(level) = 5 + 2 × (level - 1) + max(0, level - 12) × 2
 *
 * 前段保持 5 + 2（开局成长要快，首次升级 ≤20 s），Lv12 以后每级再额外 +2。
 * 理由（2026-11-09 平衡评审 §4.3 的对照实验）：宝石价值随时间增长后经验速率会涨到
 * 6–8 xp/s，若曲线不变等级会冲到 40+；后段变陡让「越后期越慢」重新成立，
 * 但不会像整体抬到 6+3 那样把前段卡死（那样 300 s 只有 7 级，通关率 15%）。
 */
export const XP_CURVE_BASE = 5;
export const XP_CURVE_STEP = 2;
/** 从这一级开始后段加速（level 是「当前等级」，即跨到下一级时生效） */
export const XP_CURVE_LATE_LEVEL = 12;
export const XP_CURVE_LATE_STEP = 2;

export function xpNeed(level: number): number {
    const late = Math.max(0, level - XP_CURVE_LATE_LEVEL);
    return XP_CURVE_BASE + XP_CURVE_STEP * (level - 1) + XP_CURVE_LATE_STEP * late;
}

// ==================== 武器类型 ====================

export type WeaponTrack = 'knife' | 'orbit' | 'lightning' | 'boomerang';
export type PassiveTrack = 'haste' | 'swift' | 'pickup' | 'vitality';

export const WEAPON_TRACKS: WeaponTrack[] = ['knife', 'orbit', 'lightning', 'boomerang'];
export const PASSIVE_TRACKS: PassiveTrack[] = ['haste', 'swift', 'pickup', 'vitality'];

export const WEAPON_NAMES: Record<WeaponTrack, string> = {
    knife: '飞刀',
    orbit: '星环',
    lightning: '落雷',
    boomerang: '回旋镖',
};

export const PASSIVE_NAMES: Record<PassiveTrack, string> = {
    haste: '攻速',
    swift: '移速',
    pickup: '拾取',
    vitality: '体魄',
};

export interface KnifeLevel {
    count: number;
    damage: number;
    interval: number;
    speed: number;
    pierce: number;
    /** 多把之间以玩家朝向为中心的扇形角度（度） */
    spread: number;
}

/**
 * 飞刀 8 级（§3.4.1；2026-11-09 平衡评审 §9.2 调整）
 *
 * - spread 从 6–8° 拉到 12–20°：原来 2–3 把只张开 6–8°，在 460 px 处几乎重叠，
 *   实质是「同一目标吃多份伤害」，拉宽后才像扇形。
 * - Lv4 补伤害 22→28：原来只加穿透，单目标 DPS 提升 0%（评审里唯一的 0% 死档）。
 */
export const KNIFE_LEVELS: KnifeLevel[] = [
    { count: 1, damage: 16, interval: 1.00, speed: 850, pierce: 0, spread: 0 },
    { count: 2, damage: 16, interval: 1.00, speed: 850, pierce: 0, spread: 12 },
    { count: 2, damage: 22, interval: 1.00, speed: 850, pierce: 0, spread: 12 },
    { count: 2, damage: 28, interval: 1.00, speed: 850, pierce: 1, spread: 14 },
    { count: 3, damage: 28, interval: 0.85, speed: 900, pierce: 1, spread: 16 },
    { count: 3, damage: 34, interval: 0.85, speed: 900, pierce: 1, spread: 16 },
    { count: 3, damage: 38, interval: 0.75, speed: 950, pierce: 2, spread: 18 },
    { count: 4, damage: 40, interval: 0.75, speed: 950, pierce: 2, spread: 20 },
];

/** 飞刀索敌半径 */
export const KNIFE_RANGE = 460;

/** 飞刀存活时间 */
export const KNIFE_LIFE = 0.9;

/** 飞刀判定半径 */
export const KNIFE_RADIUS = 9;

export interface OrbitLevel {
    count: number;
    damage: number;
    radius: number;
    angular: number;
}

/**
 * 星环 8 级（§3.4.2；2026-11-09 平衡评审 §9.2 调整）
 *
 * 半径 88/108 → 64/84、角速度 1.8/2.2 → 2.8/3.6：
 * 原配置玩家身边 0–74 px 是完整空档，且 3.5 s 转一圈的线速度（158 px/s）只比敌人快一点，
 * 敌人能从两个球之间穿过去。收紧半径 + 提高转速后，星环才真的像「贴身旋转的刀轮」。
 */
export const ORBIT_LEVELS: OrbitLevel[] = [
    { count: 2, damage: 20, radius: 64, angular: 2.8 },
    { count: 3, damage: 20, radius: 64, angular: 2.8 },
    { count: 3, damage: 24, radius: 64, angular: 2.8 },
    { count: 3, damage: 30, radius: 74, angular: 3.0 },
    { count: 4, damage: 30, radius: 74, angular: 3.0 },
    { count: 4, damage: 36, radius: 84, angular: 3.2 },
    { count: 5, damage: 36, radius: 84, angular: 3.4 },
    { count: 5, damage: 44, radius: 84, angular: 3.6 },
];

/** 星环球体半径（表现） */
export const ORBIT_BALL_RADIUS = 10;

/** 星环伤害判定半径 */
export const ORBIT_HIT_RADIUS = 14;

/** 同一颗球对同一敌人的冷却 */
export const ORBIT_HIT_CD = 0.45;

export interface LightningLevel {
    targets: number;
    damage: number;
    interval: number;
    range: number;
    aoe: number;
}

/**
 * 落雷 8 级（§3.4.3；2026-11-09 平衡评审 §9.2 调整）
 *
 * Lv2 补伤害 40→48（原来只缩短 0.4 s 间隔，+22% 是四把武器里最小的档位之一），
 * AoE 从 52/84 提到 64/96：52 的半径还不如一只精英的体型，打不出「一雷一片」的观感。
 */
export const LIGHTNING_LEVELS: LightningLevel[] = [
    { targets: 1, damage: 40, interval: 2.2, range: 300, aoe: 64 },
    { targets: 1, damage: 48, interval: 1.8, range: 300, aoe: 64 },
    { targets: 1, damage: 56, interval: 1.8, range: 320, aoe: 64 },
    { targets: 2, damage: 56, interval: 1.8, range: 320, aoe: 64 },
    { targets: 2, damage: 62, interval: 1.4, range: 340, aoe: 96 },
    { targets: 2, damage: 72, interval: 1.4, range: 340, aoe: 96 },
    { targets: 3, damage: 72, interval: 1.2, range: 360, aoe: 96 },
    { targets: 3, damage: 84, interval: 1.2, range: 360, aoe: 110 },
];

export interface BoomerangLevel {
    count: number;
    damage: number;
    interval: number;
    range: number;
    speed: number;
    width: number;
}

/**
 * 回旋镖 8 级（§3.4.4）
 *
 * width 现在是真判定（`max(14, width/2 + 4)`，见 _throwBoomerangs），
 * Lv8 的 26 → 判定半径 17，和飞刀（9）拉开「宽面扫过」的手感差异。
 */
export const BOOMERANG_LEVELS: BoomerangLevel[] = [
    { count: 1, damage: 22, interval: 2.0, range: 240, speed: 520, width: 18 },
    { count: 1, damage: 32, interval: 2.0, range: 240, speed: 520, width: 18 },
    { count: 1, damage: 32, interval: 1.6, range: 240, speed: 520, width: 18 },
    { count: 2, damage: 32, interval: 1.6, range: 240, speed: 520, width: 18 },
    { count: 2, damage: 46, interval: 1.6, range: 280, speed: 560, width: 22 },
    { count: 2, damage: 54, interval: 1.4, range: 280, speed: 560, width: 22 },
    { count: 3, damage: 54, interval: 1.4, range: 300, speed: 580, width: 24 },
    { count: 3, damage: 64, interval: 1.2, range: 300, speed: 580, width: 26 },
];

/** 回旋镖索敌半径（超过则朝移动方向） */
export const BOOMERANG_RANGE = 420;

/** 回旋镖判定半径 */
export const BOOMERANG_HIT_RADIUS = 14;

// ==================== 被动 ====================

/** 攻速：攻击间隔 ÷ (1 + 0.10 × 等级)——加算，Lv5 = ÷1.50（不是连乘 ÷1.61） */
export const HASTE_PER_LEVEL = 0.10;

/** 移速：每级 +6% */
export const SWIFT_PER_LEVEL = 0.06;

/** 拾取：每级 +30% */
export const PICKUP_PER_LEVEL = 0.30;

/** 体魄：每级 +20 上限并立即回复 20 */
export const VITALITY_PER_LEVEL = 20;

// ==================== 敌人 ====================

export type EnemyKind = 'chaser' | 'weaver' | 'shooter' | 'bomber' | 'boss';

/** 存档里用数字代替字符串，顺序不可改 */
export const ENEMY_KIND_ORDER: EnemyKind[] = ['chaser', 'weaver', 'shooter', 'bomber', 'boss'];

export interface EnemyBase {
    hp: number;
    speed: number;
    radius: number;
    damage: number;
    xp: number;
}

/** 基础敌人（§3.7.1）。boss 一行是占位：Boss 实际数值走下方 BOSS_* 常量 */
export const ENEMY_BASE: Record<EnemyKind, EnemyBase> = {
    chaser: { hp: 14, speed: 95, radius: 13, damage: 6, xp: 1 },
    weaver: { hp: 10, speed: 108, radius: 12, damage: 5, xp: 1 },
    shooter: { hp: 16, speed: 72, radius: 13, damage: 6, xp: 2 },
    bomber: { hp: 12, speed: 130, radius: 14, damage: 0, xp: 1 },
    boss: { hp: 0, speed: 0, radius: 46, damage: 0, xp: 0 },
};

/**
 * 敌人 HP 成长分段锚点（2026-11-09 平衡评审 §9.3）。
 *
 * 原来是 `1 + t / 240` 一条直线（450 s = ×2.88），前 6 分钟几乎没压力。
 * 改成 0 / 2 / 4 / 6 / 7.5 分钟 = ×1.0 / 1.4 / 1.9 / 2.5 / 3.2，段间线性插值：
 * 前半段温和（保证新人不秒死），后半段加速，与玩家武器 4–6 倍的成长幅度对齐。
 */
export const ENEMY_HP_ANCHORS: ReadonlyArray<readonly [number, number]> = [
    [0, 1.0],
    [120, 1.4],
    [240, 1.9],
    [360, 2.5],
    [450, 3.2],
];

export function enemyHpMult(time: number): number {
    const a = ENEMY_HP_ANCHORS;
    if (time <= a[0][0]) return a[0][1];
    for (let i = 1; i < a.length; i++) {
        if (time <= a[i][0]) {
            const [t0, m0] = a[i - 1];
            const [t1, m1] = a[i];
            return m0 + (m1 - m0) * ((time - t0) / (t1 - t0));
        }
    }
    return a[a.length - 1][1];
}

/** 伤害倍率斜率：1 + t / 480（接触伤害；远程弹 / Boss 弹共用同一倍率） */
export const ENEMY_DMG_SLOPE = 1 / 480;

/** 速度倍率斜率：1 + min(0.30, t / 1800)——450 s 时 ×1.25，原来要 1000 s 才碰到上限 */
export const ENEMY_SPEED_SLOPE = 1 / 1800;
export const ENEMY_SPEED_MAX_BONUS = 0.30;

/** 绕行兵横向摆动（振幅 40、频率 2 Hz 的表现化为侧向速度系数） */
export const WEAVER_SWAY = 0.7;
export const WEAVER_FREQ = 2;

/** 远程兵 */
export const SHOOTER_RANGE_MIN = 190;
export const SHOOTER_RANGE_MAX = 240;
export const SHOOTER_INTERVAL = 3.2;
export const SHOOTER_BULLET_SPEED = 260;
export const SHOOTER_BULLET_DMG = 5;
export const SHOOTER_BULLET_RADIUS = 7;

/** 自爆兵 */
export const BOMBER_TRIGGER_DIST = 26;
export const BOMBER_FUSE = 0.5;
export const BOMBER_RADIUS = 64;
export const BOMBER_DAMAGE = 18;

/**
 * 精英（§3.7.2）
 *
 * - 首只在 90 s（原来 120 s），让「第一次精英」成为一局中段的一个节点。
 * - HP ×11（原来 ×5）。原配置直冲兵 14×5×2.5 ≈ 175，玩家 Lv10 时一两秒就倒，谈不上节点。
 */
export const ELITE_TIMES = [90, 120, 240, 360];
export const ELITE_HP_MULT = 11;
export const ELITE_SIZE_MULT = 1.35;
export const ELITE_SPEED_MULT = 0.9;
export const ELITE_DAMAGE_MULT = 1.5;
export const ELITE_GEM_COUNT = 3;
export const ELITE_GEM_VALUE = 3;

/** 精英必掉一个补给（回血 / 磁铁 / 临时攻速，三选一随机） */
export const ELITE_HEAL_AMOUNT = 30;
export const ELITE_HASTE_SECONDS = 15;
export const ELITE_HASTE_MULT = 1.5;

// ==================== 刷新与兽潮 ====================

/** 刷怪率 1.2 + 0.02t，上限 6/s（约 240 s 封顶；原 1.1 + 0.01t / 上限 4 在 290 s 就封顶） */
export const SPAWN_RATE_BASE = 1.2;
export const SPAWN_RATE_SLOPE = 0.020;
export const SPAWN_RATE_MAX = 6;

export const SPAWN_RING_MIN = 620;
export const SPAWN_RING_MAX = 780;

/** 出生点距玩家小于此值时重抽 */
export const SPAWN_SAFE_DIST = 480;
export const SPAWN_RETRY = 4;

/**
 * 开局怪群：开局立即在玩家 380–460 px 的环上放 4–6 只直冲兵。
 *
 * 评审 §2 的红线是「首次升级 ≤20 s」，原实现中位 34 s。放一圈「马上就能砍到」的怪，
 * 让第一颗宝石在 5 s 内到手，同时不改变正常刷怪节奏。
 */
export const START_PACK_MIN = 4;
export const START_PACK_MAX = 6;
export const START_PACK_DIST_MIN = 380;
export const START_PACK_DIST_MAX = 460;

export const WAVE_FIRST = 45;
export const WAVE_INTERVAL = 45;

/** 兽潮提前多少秒提示 */
export const WAVE_WARN = 2;

/** 兽潮数量：6 + floor(t / 60) × 2 */
export function waveCount(time: number): number {
    return 6 + Math.floor(time / 60) * 2;
}

/** 兽潮扇区角度（120°） */
export const WAVE_ARC = (Math.PI * 2) / 3;

/**
 * 敌人组成权重（§3.7.3）。返回 [chaser, weaver, shooter, bomber]。
 * 0–60 s 只有直冲，后续逐步加入新类型。
 */
export function spawnWeights(time: number): number[] {
    if (time < 60) return [100, 0, 0, 0];
    if (time < 120) return [70, 30, 0, 0];
    if (time < 240) return [50, 25, 25, 0];
    if (time < 360) return [40, 25, 20, 15];
    return [35, 20, 20, 25];
}

// ==================== Boss ====================

export const BOSS_TIME = 450;

/**
 * Boss HP = 2800 × (1 + 0.05 × (player.level - 1))。
 *
 * 原来固定 1400：玩家 Lv17 时 DPS 200–400，4–7 秒就倒，Boss 战沦为「谁先被小怪淹死」的抽奖。
 * 按玩家等级缩放，让 Boss 战稳定落在 15–35 s 的目标区间（评审 §5.2 / §9.3）。
 *
 * 实测（sim 100 局，参考 bot）：2200 → 中位 12 s / 通关 42%；2800 → 中位 14 s / 通关 30%；
 * 4000 → 中位 18 s 但通关只剩 20%，跌破 25% 下限。所以取 §9.3 建议区间的上沿。
 */
export const BOSS_HP = 2800;
export const BOSS_HP_LEVEL_BONUS = 0.05;
export const BOSS_RADIUS = 46;
export const BOSS_SPEED = 150;
export const BOSS_CONTACT_DMG = 20;
export const BOSS_SPAWN_DIST = 520;

export const BOSS_VOLLEY_INTERVAL = 3.2;
export const BOSS_VOLLEY_INTERVAL_ENRAGED = 2.2;
export const BOSS_BULLET_COUNT = 12;
export const BOSS_BULLET_SPEED = 240;
export const BOSS_BULLET_DMG = 11;
export const BOSS_BULLET_RADIUS = 8;

export const BOSS_SUMMON_INTERVAL = 9;
export const BOSS_SUMMON_COUNT = 5;

/**
 * Boss 在场时常规刷怪倍率：0.5 → 0.25。
 *
 * Boss 战难度的来源应该是 Boss 本身 + 弹幕，而不是「140 只小怪 + 每 9 s 召唤」。
 * 倍率压低后，玩家才有空间把输出打在 Boss 身上。
 */
export const BOSS_PHASE_SPAWN_MULT = 0.25;

export const BOSS_ENRAGE_RATIO = 0.35;
export const BOSS_ENRAGE_SPEED_MULT = 1.25;

// ==================== 宝石与掉落 ====================

export const GEM_DROP_RATE = 0.9;
export const GEM_MAGNET_SPEED = 620;
export const GEM_PICK_DIST = 20;
export const GEM_RADIUS = 6;

/**
 * 宝石价值随时间分档：每 150 s +1 档，封顶 ×4（2026-11-09 平衡评审 §9.1）。
 *
 * 原来全程固定 1 / 2，经验速率在刷怪率封顶后就不再增长，等级越高升级越慢——
 * 和「怪越来越强」完全反向。分档后「后期一颗宝石 = 前期四颗」，观感与数值都成立。
 */
export const GEM_TIER_SECONDS = 150;
export const GEM_TIER_MAX = 4;

export function gemTimeMult(time: number): number {
    return Math.min(GEM_TIER_MAX, 1 + Math.floor(Math.max(0, time) / GEM_TIER_SECONDS));
}

/** 掉落价值（§3.8）：基础值 × 时间档位 */
export function gemValue(kind: EnemyKind, time: number): number {
    const base = kind === 'shooter' ? 2 : 1;
    return base * gemTimeMult(time);
}

/** 地面掉落物的种类（经验宝石 / 回血 / 磁铁 / 炸弹 / 临时攻速） */
export type PickupKind = 'xp' | 'heal' | 'magnet' | 'bomb' | 'haste';

/** 存档用数字代替字符串，顺序不可改 */
export const PICKUP_KIND_ORDER: PickupKind[] = ['xp', 'heal', 'magnet', 'bomb', 'haste'];

/**
 * 普通怪的额外掉落（与经验宝石独立掷，一次击杀最多掉一个补给）。
 * 评审 §6 的掉落表：2% 回血 10 / 1% 磁铁 / 0.5% 炸弹（屏内敌人 100 伤害）。
 */
export const DROP_HEAL_RATE = 0.02;
export const DROP_MAGNET_RATE = 0.01;
export const DROP_BOMB_RATE = 0.005;
export const DROP_HEAL_AMOUNT = 10;
export const DROP_BOMB_DAMAGE = 100;
/** 炸弹半径：覆盖屏幕可见范围（相机视野约 720×1280，取 460 足够打到屏内怪） */
export const DROP_BOMB_RADIUS = 460;

// ==================== 升级卡 ====================

/** 淬炼：每层全部武器伤害 +5% */
export const TEMPER_DMG_BONUS = 0.05;

/** 卡池权重（2026-11-09 平衡评审 §9.4：原来 已有武器 40 vs 新武器 20，与真实价值相反） */
export const OFFER_WEIGHT_OWNED_WEAPON = 30;
export const OFFER_WEIGHT_NEW_WEAPON = 30;
export const OFFER_WEIGHT_OWNED_PASSIVE = 20;
export const OFFER_WEIGHT_NEW_PASSIVE = 20;

/** 生命低于此比例时，回复卡以权重进入主池（原来只在池溢出时兜底，实际几乎见不到） */
export const OFFER_HEAL_HP_RATIO = 0.5;
export const OFFER_WEIGHT_HEAL = 25;

/** 回复卡回复量 */
export const OFFER_HEAL_AMOUNT = 30;

/** 一次升级给几张卡 */
export const OFFER_COUNT = 3;

// ==================== 配色（渲染层使用，逻辑不依赖） ====================

export const COLORS = {
    bg: '#14121C',
    grid: '#241F33',
    player: '#7FE7FF',
    chaser: '#E85D5D',
    weaver: '#E8C95D',
    shooter: '#B06DE8',
    bomber: '#F08A3C',
    bomberWarn: '#FF3B3B',
    boss: '#FF5FA2',
    gem: '#5DE89A',
    /** 经验宝石四档：绿 / 蓝 / 紫 / 金（对应价值 ×1–×4，一眼看出「这颗值四颗」） */
    gemTiers: ['#5DE89A', '#5DA9E8', '#B06DE8', '#F0C93C'],
    /** 补给：回血 / 磁铁 / 炸弹 / 临时攻速 */
    pickupHeal: '#5DE89A',
    pickupMagnet: '#7FE7FF',
    pickupBomb: '#F08A3C',
    pickupHaste: '#FFE07A',
    /** 星环球体：亮青白，和玩家（青）拉开距离又不与敌人配色冲突 */
    orbit: '#B8F4FF',
    /** 星环轨道提示环：低对比暗青虚线，只用来交代半径（太淡会等于没画） */
    orbitPath: '#3C6076',
    /** 落雷：偏蓝的冷光，和玩家青、星环亮青白都拉开 */
    lightning: '#A9C8FF',
    /** 回复：沿用宝石绿 */
    heal: '#5DE89A',
    fx: '#FFFFFF',
};

// ==================== 类型：核心状态 ====================

export type Phase = 'running' | 'levelup' | 'victory' | 'defeat';

/** 存档里允许出现的阶段：paused 由游戏层写入 */
export type SavePhase = Phase | 'paused';

export interface PlayerState {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    speed: number;
    pickupRadius: number;
    iframe: number;
    /** 朝向弧度 */
    facing: number;
    level: number;
    xp: number;
    xpNeed: number;
}

export interface EnemyState {
    active: boolean;
    kind: EnemyKind;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    speed: number;
    radius: number;
    damage: number;
    xp: number;
    elite: boolean;
    /** 槽位复用的代际号，回旋镖命中记录靠它避免误伤 */
    uid: number;
    hitCooldown: number;
    flash: number;
    /** 绕行兵正弦相位 / 自爆兵引信计时 */
    phase: number;
    shootTimer: number;
    volleyTimer: number;
    summonTimer: number;
    /** 星环球命中冷却（每颗球一个） */
    orbitCd: number[];
}

export type BulletKind = 'knife' | 'boomerang' | 'enemy';

export interface BulletState {
    active: boolean;
    fromPlayer: boolean;
    kind: BulletKind;
    x: number;
    y: number;
    vx: number;
    vy: number;
    damage: number;
    radius: number;
    pierce: number;
    life: number;
    originX: number;
    originY: number;
    traveled: number;
    maxDistance: number;
    returning: boolean;
    /** 本次投掷已命中的 uid（往返各记一次） */
    hitUids: number[];
}

export interface GemState {
    active: boolean;
    x: number;
    y: number;
    /** xp：经验值；heal：回血量；magnet：未用；bomb：伤害；haste：秒数 */
    value: number;
    magnet: boolean;
    /** 掉落物种类，决定拾取效果与颜色 */
    kind: PickupKind;
}

export type UpgradeKind =
    | 'weaponUpgrade'
    | 'newWeapon'
    | 'passiveUpgrade'
    | 'newPassive'
    | 'heal'
    | 'temper';

export interface UpgradeOffer {
    kind: UpgradeKind;
    /** 武器/被动的 track；heal/temper 为空串 */
    track: string;
    currentLevel: number;
    nextLevel: number;
    title: string;
    /** 写「变化量」而不是描述，如「伤害 10 → 14」 */
    detail: string;
}

export type CoreEventType =
    | 'levelup'
    | 'boss'
    | 'wave'
    | 'elite'
    | 'victory'
    | 'defeat'
    /** 玩家受击，data = 实际伤害 */
    | 'hit'
    | 'pickup'
    /** 回复生命，data = 回复量（体魄 / 回复卡） */
    | 'heal'
    /** 落雷落点，x/y/r 供渲染层画特效 */
    | 'lightning'
    /** 自爆兵爆炸，x/y/r 供渲染层画特效 */
    | 'explode';

export interface CoreEvent {
    type: CoreEventType;
    data?: number;
    /** 仅 fx 类事件（lightning / explode）使用 */
    x?: number;
    y?: number;
    r?: number;
}

/** 渲染层只读快照 */
export interface SurvivorSnapshot {
    phase: Phase;
    time: number;
    kills: number;
    player: Readonly<PlayerState>;
    enemies: readonly EnemyState[];
    bullets: readonly BulletState[];
    gems: readonly GemState[];
    boss: EnemyState | null;
    offers: readonly UpgradeOffer[];
    /** 当前构筑（只读引用；HUD 展示用，核心每帧刷新快照） */
    weapons: Readonly<Partial<Record<WeaponTrack, number>>>;
    passives: Readonly<Partial<Record<PassiveTrack, number>>>;
    /** 星环当前旋转角（弧度）；渲染层据此画球，避免自己计时导致与判定错位 */
    orbitAngle: number;
    temper: number;
}

export interface SurvivorInput {
    /** -1..1 */
    moveX: number;
    /** -1..1 */
    moveY: number;
}

/** 玩家受伤来源：接触伤害按敌人类型记，远程/范围伤害单独标记 */
export type HitSource = EnemyKind | 'bullet';

export const HIT_SOURCE_NAMES: Record<HitSource, string> = {
    chaser: '直冲兵',
    weaver: '绕行兵',
    shooter: '远程兵',
    bomber: '自爆兵',
    boss: 'Boss',
    bullet: '远程弹',
};

export interface RunSummary {
    time: number;
    level: number;
    kills: number;
    /** 最后一次对玩家造成伤害的来源（阵亡时即致命来源） */
    lastHitSource: HitSource | null;
    lastHitElite: boolean;
    lastHitDamage: number;
}

// ==================== 类型：局内存档 ====================

/** 紧凑敌人数组：[kind, x, y, hp, maxHp, speed, radius, damage, xp, elite, uid, phase, shootTimer] */
export type CompactEnemy = number[];

/**
 * 紧凑子弹数组：
 * [kind, fromPlayer, x, y, vx, vy, damage, radius, pierce, life,
 *  originX, originY, traveled, maxDistance, returning, ...hitUids]
 */
export type CompactBullet = number[];

/**
 * 紧凑宝石：[x, y, value, magnet, kind]
 * kind 走 PICKUP_KIND_ORDER 的下标（缺省按 xp 处理，兼容旧档）
 */
export type CompactGem = number[];

export const SAVE_VERSION = 1;

/** 存档体积护栏：超过即视为坏档 */
export const SAVE_MAX_ENEMIES = ENEMY_CAP;
export const SAVE_MAX_BULLETS = BULLET_CAP;
export const SAVE_MAX_GEMS = GEM_CAP;

export interface RunSaveV1 {
    v: 1;
    savedAt: number;
    seed: number;
    rngState: number;
    time: number;
    phase: SavePhase;
    kills: number;
    player: {
        x: number;
        y: number;
        hp: number;
        maxHp: number;
        speed: number;
        pickupRadius: number;
        iframe: number;
        facing: number;
        level: number;
        xp: number;
        xpNeed: number;
    };
    weapons: Record<string, number>;
    passives: Record<string, number>;
    temper: number;
    timers: {
        spawnAcc: number;
        nextEliteIndex: number;
        nextWaveTime: number;
        bossSpawned: boolean;
        bossEnrage: boolean;
        /** 临时攻速剩余秒数（精英补给） */
        tempHaste?: number;
    };
    enemies: CompactEnemy[];
    bullets: CompactBullet[];
    gems: CompactGem[];
    boss: CompactEnemy | null;
    offers: UpgradeOffer[];
}
