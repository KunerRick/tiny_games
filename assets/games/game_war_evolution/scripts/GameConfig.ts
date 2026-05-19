/**
 * 战争进化史 - 游戏配置
 * 纯数据模块：兵种定义、时代配置、世界常量
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
}

export const UNIT_CONFIGS: UnitConfig[] = [
    // ===== 原始时代 =====
    {
        id: 'caveman', name: '穴居人', cost: 15,
        hp: 150, attack: 12, attackSpeed: 1.0, moveSpeed: 80,
        attackRange: 30, age: Age.PRIMITIVE, desc: '廉价近战',
    },
    {
        id: 'mammoth', name: '猛犸', cost: 80,
        hp: 600, attack: 30, attackSpeed: 0.6, moveSpeed: 60,
        attackRange: 35, age: Age.PRIMITIVE, desc: '重型践踏',
        hasStomp: true,
    },
    // ===== 中世纪 =====
    {
        id: 'knight', name: '骑士', cost: 200,
        hp: 450, attack: 45, attackSpeed: 1.0, moveSpeed: 110,
        attackRange: 30, age: Age.MEDIEVAL, desc: '冲锋击退',
        hasCharge: true,
    },
    {
        id: 'archer', name: '弓箭手', cost: 60,
        hp: 100, attack: 25, attackSpeed: 1.5, moveSpeed: 80,
        attackRange: 200, age: Age.MEDIEVAL, desc: '远程攻击',
    },
    // ===== 未来时代 =====
    {
        id: 'mech', name: '机甲', cost: 800,
        hp: 1500, attack: 100, attackSpeed: 0.8, moveSpeed: 90,
        attackRange: 40, age: Age.FUTURE, desc: '能量护盾',
        hasShield: true,
    },
    {
        id: 'laser', name: '激光兵', cost: 350,
        hp: 200, attack: 50, attackSpeed: 1.2, moveSpeed: 95,
        attackRange: 260, age: Age.FUTURE, desc: '聚焦射击',
        hasLaserFocus: true,
    },
];

export interface AgeConfig {
    age: Age;
    name: string;
    expRequired: number;    // 进化所需经验（累计）
    goldRequired: number;   // 进化所需金币
    unitIds: string[];      // 本时代解锁的兵种
}

export const AGE_CONFIGS: AgeConfig[] = [
    { age: Age.PRIMITIVE, name: '原始时代', expRequired: 0, goldRequired: 0, unitIds: ['caveman', 'mammoth'] },
    { age: Age.MEDIEVAL, name: '中世纪', expRequired: 800, goldRequired: 800, unitIds: ['knight', 'archer'] },
    { age: Age.FUTURE, name: '未来时代', expRequired: 3000, goldRequired: 3000, unitIds: ['mech', 'laser'] },
];

/** 战场坐标系常量（基于 Canvas 720×1280 竖屏，与场景搭建一致） */
export const WORLD = {
    PLAYER_X: -280,     // 玩家城堡中心 x（场景中 Castle_Player 的 x）
    ENEMY_X: 280,       // 敌方城堡中心 x
    BATTLE_Y: 60,       // 主战线 y（所有单位 + 城堡在此高度）
    QUEUE_DIST: 44,     // 排队间距（像素）
    SPAWN_OFFSET: 25,   // 单位出生时从城堡向外偏移
};

/** 城堡配置 */
export const CASTLE_CONFIG = {
    HP: 3000,
    ATTACK: 30,
    ATTACK_SPEED: 0.8,  // 每秒攻击次数
    ATTACK_RANGE: 380,
};

/** AI 配置 */
export const AI_CONFIG = {
    SPAWN_INTERVAL_MIN: 1.5,
    SPAWN_INTERVAL_MAX: 3.5,
    GOLD_RATE: 10,   // AI 每秒金币收入
};

export const GOLD_RATE = 10; // 玩家每秒金币收入

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

export enum UnitState {
    MOVING = 'moving',
    FIGHTING = 'fighting',
    QUEUING = 'queuing',
    DEAD = 'dead',
}
