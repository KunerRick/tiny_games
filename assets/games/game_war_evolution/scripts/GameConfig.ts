/**
 * 战争进化史 - 游戏配置
 * 纯数据模块：兵种定义、时代配置、世界常量、难度与表现参数
 *
 * 调参入口集中在本文件：数值改动不要散到逻辑里（见排期计划 §2.2）。
 */

export enum Age {
    PRIMITIVE = 0,
    MEDIEVAL = 1,
    FUTURE = 2,
}

export const AGE_NAMES: Record<Age, string> = {
    [Age.PRIMITIVE]: '原始时代',
    [Age.MEDIEVAL]: '中世纪',
    [Age.FUTURE]: '未来时代',
};

export interface UnitConfig {
    id: string;
    name: string;
    cost: number;           // 金币
    hp: number;             // 生命值
    attack: number;         // 攻击力
    attackSpeed: number;    // 每秒攻击次数
    moveSpeed: number;      // 像素/秒
    attackRange: number;    // 像素，近战约30-40
    age: Age;
    desc: string;
    // 特殊技能标记
    hasStomp?: boolean;     // 猛犸践踏（范围伤害）
    hasCharge?: boolean;    // 骑士冲锋（首击2倍+击退）
    hasShield?: boolean;    // 机甲护盾（50%额外血量）
    hasLaserFocus?: boolean;// 激光聚焦（持续增伤）
    closeRangePenalty?: number; // 近战惩罚倍率（贴身时伤害 × 此值）
    // 视觉配置
    scale: number;           // 大小缩放（基准 1.0）
    tint: { r: number; g: number; b: number }; // 兵种细分色调
    icon?: string;          // 剪影形状标识（UnitArt 使用）
}

export const UNIT_CONFIGS: UnitConfig[] = [
    // ===== 原始时代 =====
    {
        id: 'caveman', name: '穴居人', cost: 15,
        hp: 35, attack: 15, attackSpeed: 1.0, moveSpeed: 80,
        attackRange: 30, age: Age.PRIMITIVE, desc: '廉价近战',
        scale: 1.2,
        tint: { r: 68, g: 136, b: 255 },
        icon: 'caveman',
    },
    {
        id: 'mammoth', name: '猛犸', cost: 80,
        hp: 120, attack: 35, attackSpeed: 0.6, moveSpeed: 60,
        attackRange: 35, age: Age.PRIMITIVE, desc: '重型践踏',
        hasStomp: true,
        scale: 1.5,
        tint: { r: 100, g: 80, b: 220 },
        icon: 'mammoth',
    },
    // ===== 中世纪 =====
    {
        id: 'knight', name: '骑士', cost: 200,
        hp: 90, attack: 50, attackSpeed: 1.0, moveSpeed: 110,
        attackRange: 30, age: Age.MEDIEVAL, desc: '冲锋击退',
        hasCharge: true,
        scale: 1.2,
        tint: { r: 60, g: 180, b: 255 },
        icon: 'knight',
    },
    {
        id: 'archer', name: '弓箭手', cost: 60,
        hp: 25, attack: 30, attackSpeed: 1.0, moveSpeed: 80,
        attackRange: 150, age: Age.MEDIEVAL, desc: '远程攻击',
        closeRangePenalty: 0.5,
        scale: 1.2,
        tint: { r: 80, g: 200, b: 120 },
        icon: 'archer',
    },
    // ===== 未来时代 =====
    {
        id: 'mech', name: '机甲', cost: 500,
        hp: 200, attack: 80, attackSpeed: 0.8, moveSpeed: 90,
        attackRange: 40, age: Age.FUTURE, desc: '能量护盾',
        hasShield: true,
        scale: 1.45,
        tint: { r: 140, g: 100, b: 255 },
        icon: 'mech',
    },
    {
        id: 'laser', name: '激光兵', cost: 350,
        hp: 50, attack: 45, attackSpeed: 1.2, moveSpeed: 95,
        attackRange: 260, age: Age.FUTURE, desc: '聚焦射击',
        hasLaserFocus: true,
        scale: 1.1,
        tint: { r: 100, g: 220, b: 255 },
        icon: 'laser',
    },
];

export interface AgeConfig {
    age: Age;
    name: string;
    expRequired: number;    // 进化所需经验（累计，自开局起）
    goldRequired: number;   // 进化所需金币（玩家与 AI 都会扣除，见 G6）
    goldReserve: number;    // 进化后保留的最低金币余额（AI 用）
    unitIds: string[];      // 本时代解锁的兵种
}

export const AGE_CONFIGS: AgeConfig[] = [
    { age: Age.PRIMITIVE, name: '原始时代', expRequired: 0, goldRequired: 0, goldReserve: 0, unitIds: ['caveman', 'mammoth'] },
    { age: Age.MEDIEVAL, name: '中世纪', expRequired: 250, goldRequired: 300, goldReserve: 120, unitIds: ['knight', 'archer'] },
    // 未来时代：原 900/800 在 5–8 分钟的对局里几乎摸不到（实测 8 局只有 1 局进得来），
    // 降到 600/600 后「守得住 → 反推 → 进化」这条线在多数对局里能完整走到
    { age: Age.FUTURE, name: '未来时代', expRequired: 600, goldRequired: 600, goldReserve: 120, unitIds: ['mech', 'laser'] },
];

/** 进化奖励金币（玩家与 AI 一致） */
export const EVOLVE_BONUS_GOLD = 200;

/** 战场坐标系常量（基于 Canvas 720×1280 竖屏，与场景搭建一致） */
export const WORLD = {
    PLAYER_X: -280,     // 玩家城堡中心 x（场景中 Castle_Player 的 x）
    ENEMY_X: 280,       // 敌方城堡中心 x
    BATTLE_Y: 0,        // 主战线逻辑 y（城堡在此高度；单位用渲染层偏移分行）
                        // 第二轮复核 N12：原来 60 让整条战线偏上，战场下方留出一大段空地面。
                        // 归零后近战 -18 / 远程 78，上下余量接近，画面居中。
    QUEUE_DIST: 44,     // 排队间距（像素）
    SPAWN_OFFSET: 25,   // 单位出生时从城堡向外偏移
};

/**
 * 渲染层分行（G3）：逻辑坐标仍是一条线，只按兵种给纵向偏移，让前后排可见。
 * 近战压前线，远程退到后排；同排再按单位 id 抖动，避免完全重叠。
 */
export const UNIT_ROW = {
    MELEE_Y: WORLD.BATTLE_Y - 18,   // 42
    RANGED_Y: WORLD.BATTLE_Y + 78,  // 138
    JITTER: 14,                     // 同排抖动幅度
    RANGED_RANGE_THRESHOLD: 100,    // attackRange 超过此值视为远程
};

/** 仿真/表现层可视战场（上下边界，单位与地面都落在这个范围内） */
export const BATTLEFIELD = {
    TOP: 330,
    BOTTOM: -330,
};

/** 城堡配置 */
export const CASTLE_CONFIG = {
    // 城堡血量由加速模拟标定（每档 8 局，玩家侧策略完全镜像 AI）：
    //   4800 → 胜率 87%，中位 7.0 分钟
    //   5200 → 胜率 50%，中位 6.1 分钟   ← 采用：胜率与时长同时落在目标区间
    //   5500 → 胜率 62%，中位 8.5 分钟（4/8 局超过 8 分钟上限）
    HP: 5200,
    // 城堡自动防御（设计文档 §「城堡自动防御」）：对射程内最近的来袭单位开火。
    // 数值由模拟标定：12 点/秒 + 射程 150 时是「守得住一场野战、但守不住持续强攻」的强度；
    // 调到 25/200 会变成双方都推不进去的永久僵局（实测 8 局全部打满 15 分钟上限）。
    ATTACK: 12,
    ATTACK_SPEED: 1.0,  // 每秒攻击次数
    ATTACK_RANGE: 150,  // 只覆盖城堡前沿，不抢中场的野战
};

/** 金币收入配置（每秒） */
export const GOLD_INCOME = {
    PLAYER: 5,  // 玩家每秒金币收入
    AI: 5,      // AI 每秒金币收入
};

/** AI 难度档（G4） */
export enum AIDifficulty {
    NORMAL = 'normal',
    HARD = 'hard',
}

export const AI_DIFFICULTY_NAMES: Record<AIDifficulty, string> = {
    [AIDifficulty.NORMAL]: '普通',
    [AIDifficulty.HARD]: '困难',
};

export interface AIDifficultyConfig {
    incomeMul: number;       // 收入倍率
    spawnIntervalMin: number;
    spawnIntervalMax: number;
    firstBuyExpDelay: number;   // 该时代开局多少秒后才开始买经验
    evolveDelay: number;        // 该时代开局多少秒后才考虑进化
    catchUpDelay: number;       // 玩家领先一个时代后，AI 追赶所需秒数
    catchUpExpBonus: number;    // 追赶窗口结束时补足的经验比例（0-1）
}

export const AI_DIFFICULTY: Record<AIDifficulty, AIDifficultyConfig> = {
    [AIDifficulty.NORMAL]: {
        incomeMul: 1.0,
        spawnIntervalMin: 2.0,
        spawnIntervalMax: 3.8,
        firstBuyExpDelay: 30,
        evolveDelay: 20,
        catchUpDelay: 16,
        catchUpExpBonus: 0.5,
    },
    [AIDifficulty.HARD]: {
        incomeMul: 1.2,
        spawnIntervalMin: 1.3,
        spawnIntervalMax: 2.6,
        firstBuyExpDelay: 12,
        evolveDelay: 8,
        catchUpDelay: 8,
        catchUpExpBonus: 0.85,
    },
};

/** AI 配置（旧字段保留兼容） */
export const AI_CONFIG = {
    SPAWN_INTERVAL_MIN: AI_DIFFICULTY[AIDifficulty.NORMAL].spawnIntervalMin,
    SPAWN_INTERVAL_MAX: AI_DIFFICULTY[AIDifficulty.NORMAL].spawnIntervalMax,
};

/**
 * 购买经验（G1）：每次购买价格递增，且每个时代限购，杜绝"无脑刷经验"。
 * 费用 = BASE_COST × GROWTH^已购买次数（每进化一次清零）。
 */
export const BUY_EXP = {
    BASE_COST: 45,      // 首次购买价格
    GAIN: 25,           // 每次购买获得经验
    GROWTH: 1.28,       // 价格递增系数
    MAX_PER_AGE: 6,     // 每个时代限购次数
};

/** 全军冲锋（G2） */
export const CHARGE = {
    COOLDOWN: 45,        // 冷却（秒）
    DURATION: 8,         // 持续（秒）
    MOVE_MUL: 1.6,       // 移速倍率
    ATTACK_SPEED_MUL: 1.3, // 攻速倍率
};

/** 击杀收益（金币 / 经验比例按兵种造价折算） */
export const KILL_REWARD = {
    GOLD_RATIO: 0.25,
    EXP_RATIO: 0.4,
};

/** 表现层配色（A1：统一色板；阵营色例外） */
export const BATTLE_PALETTE = {
    player: '#38BDF8',
    enemy: '#EF4444',
    neutral: '#94A3B8',
    danger: '#EF4444',
    warning: '#F59E0B',
    success: '#22C55E',
    // 随时代变化的地面
    ground: [
        { base: '#1B3324', path: '#2C5033', accent: '#3F7A4A' }, // 原始：草地
        { base: '#332A20', path: '#5A452C', accent: '#8A6A3E' }, // 中世纪：泥地
        { base: '#141E2C', path: '#1F3348', accent: '#2E5A7D' }, // 未来：金属板
    ],
};

// ==================== 辅助函数 ====================

const _unitMap = new Map<string, UnitConfig>();
for (const u of UNIT_CONFIGS) {
    _unitMap.set(u.id, u);
}

export function getUnitConfig(id: string): UnitConfig | undefined {
    return _unitMap.get(id);
}

export function getUnitsByAge(age: Age): UnitConfig[] {
    return UNIT_CONFIGS.filter(u => u.age === age);
}

export function getAgeConfig(age: Age): AgeConfig | undefined {
    return AGE_CONFIGS.find(a => a.age === age);
}

/** 获取某个时代下玩家可生产的所有兵种（当前时代及以前） */
export function getAvailableUnits(currentAge: Age): UnitConfig[] {
    return UNIT_CONFIGS.filter(u => u.age <= currentAge);
}

/** 获取下一个时代的配置 */
export function getNextAgeConfig(currentAge: Age): AgeConfig | undefined {
    return AGE_CONFIGS.find(a => a.age === currentAge + 1);
}

/** 第 n 次购买经验的价格（n 从 0 开始） */
export function getBuyExpCost(boughtThisAge: number): number {
    return Math.round(BUY_EXP.BASE_COST * Math.pow(BUY_EXP.GROWTH, Math.max(0, boughtThisAge)));
}

export enum UnitState {
    MOVING = 'moving',
    FIGHTING = 'fighting',
    QUEUING = 'queuing',
    DEAD = 'dead',
}

/** 单位颜色配置 */
export const UNIT_COLORS = {
    PLAYER: { r: 68, g: 136, b: 255 },   // 蓝色
    ENEMY: { r: 255, g: 68, b: 68 },     // 红色
};
