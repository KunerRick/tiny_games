/**
 * 砖块远征 — 规则与表现常量。
 *
 * 本文件不依赖 cc，可在 Node 侧直接编译验证。
 */

// ==================== 游戏区（局部坐标：原点左上，x 向右，y 向下） ====================

export const PLAY_W = 660;
export const PLAY_H = 860;

export const BALL_R = 12;

export const PADDLE_W = 140;
export const PADDLE_H = 18;
export const PADDLE_BOTTOM_MARGIN = 44;

/** 挡板跟随手指的平滑系数（每秒），越大越跟手 */
export const PADDLE_FOLLOW_PER_SEC = 18;

// ==================== 球速 ====================

export const BALL_BASE_SPEED = 620;
export const BALL_SPEED_PER_LEVEL = 25;
export const BALL_MAX_SPEED = 900;
export const BALL_MIN_SPEED = 420;

/** slow_ball 每级减速 */
export const SLOW_BALL_STEP = 60;

/** 发球角度（与竖直方向的夹角，单位：度） */
export const LAUNCH_ANGLE_DEG = 30;

/** 挡板反弹最大角（与竖直方向），narrow_angle 每级收窄 */
export const PADDLE_MAX_ANGLE_DEG = 60;
export const NARROW_ANGLE_STEP_DEG = 8;
export const PADDLE_MIN_ANGLE_DEG = 25;

// ==================== 砖块网格 ====================

export const BRICK_COLS = 7;
export const BRICK_W = 86;
export const BRICK_H = 32;
export const BRICK_GAP_X = 8;
export const BRICK_GAP_Y = 8;
export const BRICK_TOP = 24;

export const BRICK_MAX_ROWS = 8;

/** 第 0 行以外的格子被挖空的概率（随关数增长，封顶） */
export const HOLE_CHANCE_BASE = 0.02;
export const HOLE_CHANCE_MAX = 0.12;

/** 砖块 2 耐久的概率 */
export const TOUGH_CHANCE_BASE = 0.05;
export const TOUGH_CHANCE_STEP = 0.05;
export const TOUGH_CHANCE_MAX = 0.5;

/** 从第几关开始可能出现 3 耐久砖 */
export const HP3_FROM_LEVEL = 8;
export const HP3_CHANCE = 0.15;

/** 每关炸弹砖数量 */
export const BOMB_PER_3_LEVELS = 3;
export const BOMB_MAX = 4;

// ==================== 物理 ====================

/** 固定子步长：620 px/s 时每步约 2.6 px，远小于球半径，不会穿砖 */
export const FIXED_STEP_SEC = 1 / 240;

/** 单帧最多推进的子步数，防止切后台回来后一次算爆 */
export const MAX_STEPS_PER_FRAME = 16;

/** 单帧 dt 上限 */
export const MAX_FRAME_DT = 0.05;

/** 球接近水平持续这么久就施加一次纵向推力（防无限横向弹跳） */
export const HORIZONTAL_STUCK_SEC = 1.0;
export const HORIZONTAL_STUCK_VY = 60;
export const HORIZONTAL_NUDGE_VY = 120;

/**
 * 连续这么久没有打中任何砖，就给球一个随机偏转。
 *
 * 典型场景：球在某一列里几乎垂直往返，而该列的砖已经清空 —— 球永远碰不到砖，
 * 玩家不主动改变挡板角度就会无限空转。偏转只改方向、不改速度。
 */
export const STALL_NUDGE_SEC = 10;
export const STALL_NUDGE_DEG = 25;

// ==================== 伤害 / 计分 ====================

export const LASER_BASE_INTERVAL = 1.0;
export const LASER_INTERVAL_PER_LV = 0.35;
export const LASER_SPEED = 900;
export const LASER_W = 4;
export const LASER_H = 14;

/** 穿透对同一砖块的忽略窗口（秒）；每层延长 */
export const PIERCE_SKIP_SEC = 0.15;
export const PIERCE_SKIP_PER_LV = 0.05;

/** 分裂球概率（每级） */
export const SPLIT_CHANCE_PER_LV = 0.2;
export const SPLIT_MAX_BALLS = 6;

/** 连击倍率增量 */
export const COMBO_STEP = 0.1;

/** 砖块基础分 = 10 × 最大耐久 */
export const SCORE_PER_HP = 10;

// ==================== 生命 ====================

export const BASE_LIVES = 3;
export const MAX_LIVES = 6;

// ==================== 升级表 ====================

export type UpgradeId =
    | 'paddle_widen'
    | 'extra_ball'
    | 'pierce'
    | 'laser'
    | 'split'
    | 'explosive'
    | 'sticky'
    | 'score_mult'
    | 'extra_life'
    | 'slow_ball'
    | 'narrow_angle'
    | 'ball_damage';

export interface UpgradeDef {
    id: UpgradeId;
    name: string;
    desc: string;
    maxLevel: number;
    weight: number;
}

export const UPGRADES: UpgradeDef[] = [
    { id: 'paddle_widen', name: '加宽挡板', desc: '挡板宽 +18', maxLevel: 6, weight: 10 },
    { id: 'extra_ball', name: '多一颗球', desc: '发球 +1，场上立即补一颗', maxLevel: 4, weight: 9 },
    { id: 'pierce', name: '穿透', desc: '普通砖不再反弹，命中后短暂穿过', maxLevel: 2, weight: 6 },
    { id: 'laser', name: '激光挡板', desc: '挡板两端自动发射子弹', maxLevel: 3, weight: 7 },
    { id: 'split', name: '分裂球', desc: '击碎砖块时概率分裂出新球', maxLevel: 3, weight: 6 },
    { id: 'explosive', name: '爆炸球', desc: '命中时溅射周围 3×3', maxLevel: 2, weight: 5 },
    { id: 'sticky', name: '粘性挡板', desc: '接住的球会粘住，点击再发', maxLevel: 1, weight: 5 },
    { id: 'score_mult', name: '得分倍率', desc: '得分 ×1.25', maxLevel: 6, weight: 8 },
    { id: 'extra_life', name: '额外生命', desc: '生命 +1', maxLevel: 3, weight: 4 },
    { id: 'slow_ball', name: '减速', desc: '球速 −60，更可控', maxLevel: 3, weight: 7 },
    { id: 'narrow_angle', name: '收束反弹', desc: '挡板反弹角 −8°', maxLevel: 3, weight: 7 },
    { id: 'ball_damage', name: '强化球', desc: '球对砖块伤害 +1', maxLevel: 2, weight: 5 },
];

export function getUpgradeDef(id: UpgradeId): UpgradeDef {
    const def = UPGRADES.find(u => u.id === id);
    if (!def) {
        throw new Error(`未知升级: ${id}`);
    }
    return def;
}

// ==================== 表现色板 ====================

export const COLORS = {
    bg: 0x151e33,
    grid: 0x1e2a44,
    brickHp3: 0x4ea8ff,
    brickHp2: 0x7c6cff,
    brickHp1: 0xffb547,
    bomb: 0xff6b6b,
    ball: 0xffffff,
    paddle: 0x6ee7ff,
    laser: 0xff6bd6,
    text: 0xffffff,
};
