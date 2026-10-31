/**
 * 合合大作战 — 规则与表现常量。
 *
 * 本文件不依赖 cc，可在 Node 侧直接编译验证。
 * 坐标系：原点在游戏区左上角，x 向右，y **向下**（与砖块远征一致）。
 */

// ==================== 游戏区 ====================

export const PLAY_W = 660;
export const PLAY_H = 860;

/** 左右墙与底墙的视觉厚度，也是碰撞内边界的缩进 */
export const WALL_T = 24;

/** 待落水果的悬挂高度（圆心 y） */
export const DROP_Y = 96;

/** 两次投放之间的冷却（秒） */
export const DROP_COOLDOWN_SEC = 0.35;

/** 手指位移小于该值视为"点一下"（逻辑像素） */
export const TAP_SLOP = 12;

// ==================== 物理 ====================

export const GRAVITY = 2000;

/** 固定子步长：2400 px/s 时每步 10 px，小于最小半径 22，不会穿透 */
export const FIXED_STEP_SEC = 1 / 240;

/** 单帧最多推进的子步数，防止切后台回来后一次算爆 */
export const MAX_STEPS_PER_FRAME = 16;

/** 单帧 dt 上限 */
export const MAX_FRAME_DT = 0.05;

/** 速度上限：超过则截断，防穿透 */
export const MAX_SPEED = 2400;

/** 位置修正迭代次数（只推位置，不重复施加冲量） */
export const ITERATIONS = 16;

/** 每次迭代修正重叠的比例（0–1），偏小更稳、偏大更"硬" */
export const POSITION_CORRECTION = 0.8;

/** 重叠小于该值视为接触但不修正，防止静止时抖动 */
export const CONTACT_SLOP = 0.5;

export const RESTITUTION = 0.05;
export const FRICTION = 0.4;

/** 每秒线性阻尼，抑制长尾漂移 */
export const LINEAR_DAMPING = 0.2;

/** 低于该速度开始累计休眠计时 */
export const SLEEP_SPEED = 12;

/** 低速持续这么久进入休眠（速度清零，跳过积分） */
export const SLEEP_HOLD_SEC = 0.4;

// ==================== 合并 ====================

/** 同层两圆距离 ≤ r1+r2+MERGE_SLOP 视为接触可合并 */
export const MERGE_SLOP = 1.5;

/** 合并后速度保留比例（取质量加权平均后再乘） */
export const MERGE_VELOCITY_KEEP = 0.5;

/** 连击窗口：窗口内再次合并则连击 +1 */
export const COMBO_WINDOW_SEC = 0.5;

/** 连击倍率上限 */
export const COMBO_MAX_MULT = 3;

/** 顶层的两颗合并时直接消除，给这笔分 */
export const TOP_MERGE_SCORE = 1000;

/** 基础分单位 */
export const SCORE_UNIT = 10;

// ==================== 失败判定 ====================

/** 警戒线 y：水果中心低于它且静止，才开始累计 */
export const GAME_OVER_LINE = 150;

/** 持续超线这么久判定失败（避免下落瞬间误判） */
export const GAME_OVER_HOLD_SEC = 2.0;

// ==================== 容量 ====================

/** 场上水果上限，超过则拒绝投放 */
export const MAX_FRUITS = 120;

// ==================== 水果层级 ====================

/** 11 层，半径依次增大（直径最大 236，660 宽可并排两个） */
export const FRUIT_RADII: number[] = [22, 28, 34, 41, 49, 58, 68, 79, 91, 104, 118];

export const MAX_TIER = FRUIT_RADII.length;

/** 只生成前 5 层，权重依次递减 */
export const SPAWN_WEIGHTS: number[] = [30, 26, 20, 14, 10];

export function tierRadius(tier: number): number {
    const t = Math.max(0, Math.min(MAX_TIER - 1, tier | 0));
    return FRUIT_RADII[t];
}

/** 合并两颗 tier 级水果的得分：三角数，越高级收益越大 */
export function mergeScore(tier: number): number {
    const n = tier + 1;
    return ((n * (n + 1)) / 2) * SCORE_UNIT;
}

/** 连击倍率：1 → 1，2 → 1.5，3 → 2 …… 封顶 COMBO_MAX_MULT */
export function comboMultiplier(combo: number): number {
    if (combo <= 1) return 1;
    return Math.min(COMBO_MAX_MULT, 1 + (combo - 1) * 0.5);
}

// ==================== 表现色板 ====================

/** 11 层水果色，从樱桃红到金色 */
export const FRUIT_COLORS: number[] = [
    0xff6b6b,
    0xff9f43,
    0xffd93d,
    0x6ee7b7,
    0x4ecdc4,
    0x6ee7ff,
    0x7c9cff,
    0x9b6bff,
    0xff6bd6,
    0xff4d6d,
    0xffe066,
];

export const COLORS = {
    bg: 0x151e33,
    grid: 0x1e2a44,
    wall: 0x2a3a5c,
    dropGuide: 0x6ee7ff,
    warn: 0xff6b6b,
    text: 0xffffff,
};

export function fruitColor(tier: number): number {
    const t = Math.max(0, Math.min(MAX_TIER - 1, tier | 0));
    return FRUIT_COLORS[t];
}
