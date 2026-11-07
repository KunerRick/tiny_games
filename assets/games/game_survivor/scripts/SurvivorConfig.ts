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
export const MAX_TRACK_LEVEL = 5;
export const MAX_LEVEL = 99;

// ==================== 经验曲线 ====================

/**
 * need(level) = 5 + 2 × (level - 1)
 *
 * 规格初稿是 6 + 4 × (level - 1)，M1 先降到 6 + 3；2026-11-08 用
 * `node tools/sim-survivor-balance.js` 做 200 局无头平衡校准（参考走位 + 三选一），
 * 定在 5 + 2：8 分钟一局大致到 18–22 级，武器能真正滚起来。
 * 详细的整轮调参见 docs/specs/2026-11-02-game-survivor-design.md §8.4。
 */
export const XP_CURVE_BASE = 5;
export const XP_CURVE_STEP = 2;

export function xpNeed(level: number): number {
    return XP_CURVE_BASE + XP_CURVE_STEP * (level - 1);
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

/** 飞刀 5 级（§3.4.1） */
export const KNIFE_LEVELS: KnifeLevel[] = [
    { count: 1, damage: 16, interval: 1.00, speed: 850, pierce: 0, spread: 0 },
    { count: 2, damage: 16, interval: 1.00, speed: 850, pierce: 0, spread: 6 },
    { count: 2, damage: 22, interval: 1.00, speed: 850, pierce: 0, spread: 6 },
    { count: 2, damage: 22, interval: 1.00, speed: 850, pierce: 1, spread: 6 },
    { count: 3, damage: 26, interval: 0.85, speed: 900, pierce: 1, spread: 8 },
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

/** 星环 5 级（§3.4.2） */
export const ORBIT_LEVELS: OrbitLevel[] = [
    { count: 2, damage: 20, radius: 88, angular: 1.8 },
    { count: 3, damage: 20, radius: 88, angular: 1.8 },
    { count: 3, damage: 26, radius: 88, angular: 1.8 },
    { count: 3, damage: 26, radius: 108, angular: 2.2 },
    { count: 4, damage: 32, radius: 108, angular: 2.2 },
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

/** 落雷 5 级（§3.4.3） */
export const LIGHTNING_LEVELS: LightningLevel[] = [
    { targets: 1, damage: 40, interval: 2.2, range: 300, aoe: 52 },
    { targets: 1, damage: 40, interval: 1.8, range: 300, aoe: 52 },
    { targets: 1, damage: 56, interval: 1.8, range: 320, aoe: 52 },
    { targets: 2, damage: 56, interval: 1.8, range: 320, aoe: 52 },
    { targets: 2, damage: 56, interval: 1.4, range: 340, aoe: 84 },
];

export interface BoomerangLevel {
    count: number;
    damage: number;
    interval: number;
    range: number;
    speed: number;
    width: number;
}

/** 回旋镖 5 级（§3.4.4） */
export const BOOMERANG_LEVELS: BoomerangLevel[] = [
    { count: 1, damage: 22, interval: 2.0, range: 240, speed: 520, width: 18 },
    { count: 1, damage: 32, interval: 2.0, range: 240, speed: 520, width: 18 },
    { count: 1, damage: 32, interval: 1.6, range: 240, speed: 520, width: 18 },
    { count: 2, damage: 32, interval: 1.6, range: 240, speed: 520, width: 18 },
    { count: 2, damage: 44, interval: 1.6, range: 280, speed: 560, width: 22 },
];

/** 回旋镖索敌半径（超过则朝移动方向） */
export const BOOMERANG_RANGE = 420;

/** 回旋镖判定半径 */
export const BOOMERANG_HIT_RADIUS = 14;

// ==================== 被动 ====================

/** 攻速：每级攻击间隔 ÷ 1.10 */
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

/** 基础敌人（§3.7.1） */
export const ENEMY_BASE: Record<EnemyKind, EnemyBase> = {
    chaser: { hp: 14, speed: 95, radius: 13, damage: 6, xp: 1 },
    weaver: { hp: 10, speed: 108, radius: 12, damage: 5, xp: 1 },
    shooter: { hp: 16, speed: 72, radius: 13, damage: 6, xp: 2 },
    bomber: { hp: 12, speed: 130, radius: 14, damage: 0, xp: 1 },
    boss: { hp: 2400, speed: 46, radius: 46, damage: 20, xp: 0 },
};

/** HP 倍率斜率：1 + t / 240 */
export const ENEMY_HP_SLOPE = 1 / 240;

/** 伤害倍率斜率：1 + t / 480 */
export const ENEMY_DMG_SLOPE = 1 / 480;

/** 速度倍率斜率：1 + min(0.25, t / 4000) */
export const ENEMY_SPEED_SLOPE = 1 / 4000;
export const ENEMY_SPEED_MAX_BONUS = 0.25;

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

/** 精英（§3.7.2） */
export const ELITE_TIMES = [120, 240, 360];
export const ELITE_HP_MULT = 5;
export const ELITE_SIZE_MULT = 1.35;
export const ELITE_SPEED_MULT = 0.9;
export const ELITE_DAMAGE_MULT = 1.5;
export const ELITE_XP = 10;
export const ELITE_GEM_COUNT = 3;
export const ELITE_GEM_VALUE = 3;

// ==================== 刷新与兽潮 ====================

export const SPAWN_RATE_BASE = 1.1;
export const SPAWN_RATE_SLOPE = 0.010;
export const SPAWN_RATE_MAX = 4;

export const SPAWN_RING_MIN = 620;
export const SPAWN_RING_MAX = 780;

/** 出生点距玩家小于此值时重抽 */
export const SPAWN_SAFE_DIST = 480;
export const SPAWN_RETRY = 4;

export const WAVE_FIRST = 45;
export const WAVE_INTERVAL = 45;

/** 兽潮提前多少秒提示 */
export const WAVE_WARN = 2;

/** 兽潮数量：8 + floor(t / 60) × 3 */
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
export const BOSS_HP = 1400;
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
export const BOSS_SUMMON_COUNT = 8;

export const BOSS_ENRAGE_RATIO = 0.35;
export const BOSS_ENRAGE_SPEED_MULT = 1.25;

// ==================== 宝石 ====================

export const GEM_DROP_RATE = 0.9;
export const GEM_MAGNET_SPEED = 620;
export const GEM_PICK_DIST = 20;
export const GEM_RADIUS = 6;

/** 掉落价值（§3.8） */
export function gemValue(kind: EnemyKind): number {
    return kind === 'shooter' ? 2 : 1;
}

// ==================== 升级卡 ====================

/** 淬炼：每层全部武器伤害 +5% */
export const TEMPER_DMG_BONUS = 0.05;

/** 卡池权重 */
export const OFFER_WEIGHT_OWNED_WEAPON = 40;
export const OFFER_WEIGHT_NEW_WEAPON = 20;
export const OFFER_WEIGHT_OWNED_PASSIVE = 25;
export const OFFER_WEIGHT_NEW_PASSIVE = 15;

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
    value: number;
    magnet: boolean;
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

/** 紧凑宝石：[x, y, value, magnet] */
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
    };
    enemies: CompactEnemy[];
    bullets: CompactBullet[];
    gems: CompactGem[];
    boss: CompactEnemy | null;
    offers: UpgradeOffer[];
}
