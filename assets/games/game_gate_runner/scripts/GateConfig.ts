/**
 * 数值冲刺（Gate Runner）— 规则与表现常量。
 *
 * 本文件不依赖 cc，可在 Node 侧直接编译验证。
 * 坐标系：逻辑坐标原点在游戏区左上角，x 向右，y **向下**（与砖块远征/合合大作战一致）。
 * 世界里的物体用「已前进距离 distance」定位：屏幕 y = PLAYER_Y - (worldY - distance)。
 */

// ==================== 游戏区 ====================

export const PLAY_W = 660;
export const PLAY_H = 860;

/** 玩家（队伍方阵中心）固定在屏幕的这个高度 */
export const PLAYER_Y = 700;

/** 横移范围（队伍中心） */
export const PLAYER_X_MIN = 90;
export const PLAYER_X_MAX = 570;

/** 队伍方阵的名义半径，只影响表现与"接触距离"的可读性 */
export const PLAYER_R = 26;

// ==================== 世界推进 ====================

/** 一个段落的世界长度 */
export const SEGMENT_LEN = 360;

/** 段落数（偶数段放门、奇数段放敌人）。11 段太少跑 20 s 就结束，12 段约 40 s 一局 */
export const SEGMENT_COUNT = 12;

/** Boss 的世界位置：最后一段敌人之后留一小段空地 */
export const BOSS_DISTANCE = 4600;

/** 起始前进速度（px/s） */
export const SCROLL_BASE = 420;

/** 速度上限 */
export const SCROLL_MAX = 620;

/** 每前进 1 px 增加的速度，封顶 SCROLL_MAX */
export const SCROLL_ACCEL = 0.05;

/** 与敌人的接触距离（世界坐标，位于播放器前方） */
export const CONTACT_DIST = 64;

// ==================== 数值 ====================

/** 初始人数 */
export const START_COUNT = 20;

/** 人数上限（防溢出/防显示撑爆） */
export const COUNT_MAX = 9999;

/** 每秒最多发射数 = 秒伤上限 */
export const FIRE_CAP = 60;

/** 敌人每秒额外消耗队伍的比例（让"人多也怕拖"） */
export const ENEMY_DRAIN_RATIO = 0.08;

/** Boss 的额外消耗倍率（比例部分同乘） */
export const BOSS_DRAIN_MULT = 1.5;

/** Boss 血量 */
export const BOSS_HP = 160;

/** 固定子步长：门触发与对拼都按子步推进，避免大 dt 跳门 */
export const SUBSTEP_SEC = 1 / 120;

/** 单帧 dt 上限（切后台回来不一次算爆） */
export const MAX_FRAME_DT = 0.05;

/** 每这么久产出一个 squad_hit 飘字事件 */
export const SQUAD_HIT_EVENT_SEC = 0.2;

// ==================== 集火（主动技能） ====================

/**
 * 点一下屏幕 = 集火：短时把 dps 拉高。
 * 对拼阶段原本是纯挂机看数字，加了集火之后玩家有事可做，而且"打得快 = 掉的少"，
 * 时机好坏直接换算成存活人数。
 */
export const PULSE_DURATION_SEC = 1.6;

/** 集火冷却 */
export const PULSE_COOLDOWN_SEC = 4.5;

/** 集火期间的 dps 倍率（仍以 FIRE_CAP 为基准放大） */
export const PULSE_DPS_MULT = 2.2;

// ==================== 完美选门连击 ====================

/**
 * 连续选到"更优的那一侧"记为完美。
 * 好处不能给太猛（×2 / ×3 门本身已经是复利），给一点点人数 + 明确的正反馈。
 */
export const STREAK_BONUS_STEP = 3;

/** 每满 STREAK_BONUS_STEP 连击，额外加当前人数的这个比例 */
export const STREAK_BONUS_RATIO = 0.15;

/** 连击奖励的下限，避免人数很少时奖励看不见 */
export const STREAK_BONUS_MIN = 5;

/** 连击奖励的人数增量 */
export function streakBonus(after: number): number {
    const b = Math.floor(after * STREAK_BONUS_RATIO);
    return b > STREAK_BONUS_MIN ? b : STREAK_BONUS_MIN;
}

// ==================== 数值门 ====================

/** 门板宽度：左门 x ∈ [40, 320]，右门 x ∈ [340, 620] */
export const GATE_W = 280;

/** 门板高度 */
export const GATE_H = 90;

/** 左门左边线 / 右门左边线 */
export const GATE_LEFT_X = 40;
export const GATE_RIGHT_X = 340;

/** 玩家中心 x 小于该值即判定为走左门 */
export const GATE_SPLIT_X = 330;

export type GateOpKind = 'mul' | 'div' | 'add' | 'sub';

export interface GateOp {
    kind: GateOpKind;
    value: number;
}

export interface GateTemplate {
    a: GateOp;
    b: GateOp;
    /** 该模板从多远开始出现（世界坐标） */
    from: number;
}

/**
 * 门模板池。每对门随机抽一个模板，左右随机交换。
 * 前期只有加法/×2，中后期才出现 ÷2 / ÷3、−N 这类风险选项。
 * `from` 是模板开始出现的距离：越往后越可能出现"高收益高风险"。
 */
export const GATE_TEMPLATES: GateTemplate[] = [
    { a: { kind: 'mul', value: 2 }, b: { kind: 'add', value: 30 }, from: 0 },
    { a: { kind: 'mul', value: 2 }, b: { kind: 'div', value: 2 }, from: 0 },
    { a: { kind: 'add', value: 20 }, b: { kind: 'add', value: 50 }, from: 0 },
    { a: { kind: 'sub', value: 10 }, b: { kind: 'mul', value: 2 }, from: 720 },
    { a: { kind: 'mul', value: 3 }, b: { kind: 'div', value: 2 }, from: 1440 },
    { a: { kind: 'div', value: 2 }, b: { kind: 'add', value: 100 }, from: 1440 },
    // 中后期的三个高风险模板：一边暴增、一边暴跌，选错要肉疼
    { a: { kind: 'mul', value: 3 }, b: { kind: 'div', value: 3 }, from: 2160 },
    { a: { kind: 'add', value: 150 }, b: { kind: 'sub', value: 100 }, from: 2880 },
    { a: { kind: 'mul', value: 2 }, b: { kind: 'div', value: 3 }, from: 3600 },
];

/** 把人数钳进 [0, COUNT_MAX] */
export function clampCount(v: number): number {
    if (!isFinite(v) || isNaN(v)) return 0;
    if (v < 0) return 0;
    if (v > COUNT_MAX) return COUNT_MAX;
    return Math.floor(v);
}

/**
 * 应用一次门操作。
 *
 * 除法**不会**把队伍直接除到 0 —— 最低保留 1：
 * 否则前期一次倒霉的 ÷2（20 → 10 → 5 → 2 → 1 → 0）等于直接判负，
 * 而玩家在那一刻并没有做错任何操作。真正能把人数打到 0 的只有 `−N` 门和敌人。
 */
export function applyGateOp(count: number, op: GateOp): number {
    const before = clampCount(count);
    if (before <= 0) return 0;
    const v = Math.max(1, Math.floor(op.value));
    switch (op.kind) {
        case 'mul':
            return clampCount(before * v);
        case 'div':
            return clampCount(Math.max(1, Math.floor(before / v)));
        case 'add':
            return clampCount(before + v);
        case 'sub':
            return clampCount(before - v);
        default:
            return before;
    }
}

/** 门的显示文本：×2 / ÷2 / +20 / −10 */
export function gateOpLabel(op: GateOp): string {
    switch (op.kind) {
        case 'mul': return `×${op.value}`;
        case 'div': return `÷${op.value}`;
        case 'add': return `+${op.value}`;
        case 'sub': return `−${op.value}`;
        default: return '?';
    }
}

// ==================== 敌人 ====================

/** 普通敌人血量：随前进距离线性增长 */
export function enemyHpAt(distance: number): number {
    return Math.round(24 + 0.05 * distance);
}

/** 普通敌人每秒基础伤害 */
export function enemyAtkAt(distance: number): number {
    return 2 + distance / 800;
}

/** Boss 每秒基础伤害 */
export function bossAtkAt(distance: number): number {
    return enemyAtkAt(distance) * BOSS_DRAIN_MULT;
}

/** 敌人挡路宽度（只用于绘制，v1 不允许绕行） */
export function enemyWidthAt(distance: number): number {
    return Math.min(420, 260 + distance / 20);
}

/** 当前前进速度 */
export function scrollSpeedAt(distance: number): number {
    const v = SCROLL_BASE + distance * SCROLL_ACCEL;
    return v > SCROLL_MAX ? SCROLL_MAX : v;
}

// ==================== 计分 ====================

export const SCORE_PER_DISTANCE = 0.1;
export const SCORE_PER_COUNT = 10;
export const VICTORY_BONUS = 1000;

export function computeScore(distance: number, count: number, victory: boolean): number {
    const base = distance * SCORE_PER_DISTANCE + clampCount(count) * SCORE_PER_COUNT;
    return Math.round(base + (victory ? VICTORY_BONUS : 0));
}

// ==================== 表现 ====================

/** 队伍最多画这么多个圆点，超出用数字标签表示 */
export const SQUAD_DOTS_MAX = 40;

/** 队伍点半径下限/上限（人多时缩小） */
export const SQUAD_DOT_MIN_R = 5;
export const SQUAD_DOT_MAX_R = 11;

/** 子弹硬上限（对象池容量） */
export const MAX_BULLETS = 80;

/** 碎屑硬上限 */
export const MAX_DEBRIS = 120;

/** 枪口相对于队伍中心的前方偏移 */
export const MUZZLE_OFFSET_Y = 34;

export const COLORS = {
    bg: 0x151e33,
    bgLine: 0x1e2a44,
    road: 0x1a2440,
    roadEdge: 0x2a3a5c,
    ally: 0x6ee7ff,
    allyDark: 0x2b9fbf,
    enemy: 0xff6b6b,
    enemyDark: 0x9b2b2b,
    boss: 0xff4d6d,
    text: 0xffffff,
    textDim: 0x8ea3c8,
    mul: 0x4ea8ff,
    div: 0xff6b6b,
    add: 0x6ee7b7,
    sub: 0xffa94d,
    gateInk: 0xffffff,
    success: 0x6ee7b7,
    danger: 0xff6b6b,
    /** 集火 / 完美连击的高亮色 */
    gold: 0xffd166,
    goldDark: 0xb08a2e,
};

/** 门操作对应的色板 */
export function gateOpColor(kind: GateOpKind): number {
    switch (kind) {
        case 'mul': return COLORS.mul;
        case 'div': return COLORS.div;
        case 'add': return COLORS.add;
        case 'sub': return COLORS.sub;
        default: return COLORS.textDim;
    }
}
