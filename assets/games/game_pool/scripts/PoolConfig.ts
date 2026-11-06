/**
 * 台球（`pool`）—— 配置与数值（纯数据，不依赖 cc，可被 Node 自检直接编译）。
 *
 * 坐标约定：原点在赛台左上角，x 向右、y 向下；赛台尺寸 660×330（设计分辨率 720 宽）。
 * 球心可行区域是 [r, W-r] × [r, H-r]，即台边（库边）本身没有厚度，直接当墙处理。
 *
 * 规则：单人清台。把台面上的目标球全部打进袋，杆数用完还没清完即失败。
 */

// ==================== 赛台几何 ====================

/** 赛台宽（含库边） */
export const TABLE_W = 660;
/** 赛台高（含库边） */
export const TABLE_H = 330;
/** 球半径：直径 18 ≈ 台宽的 2.7%，比真实球略大，便于手机识别 */
export const BALL_R = 9;

export type PoolPocketKind = 'corner' | 'side';

export interface PoolPocket {
    x: number;
    y: number;
    /** 袋口捕获半径：球心进入该半径即落袋 */
    r: number;
    kind: PoolPocketKind;
}

/**
 * 6 个袋：四角 + 两条长边中点。
 *
 * 袋心放在赛台角/边线上（球心到库边的距离恰好为 BALL_R），因此：
 *   - 角袋：球贴着库边滚到角上时球心距袋心 ≥ r·√2 ≈ 12.7 < 23，必然落袋；
 *     沿库边的落袋区间约 ±21 px（≈1.2 个球直径），手感接近真实角袋。
 *   - 中袋：沿库边的落袋区间约 ±14 px，接近 1.5 个球直径。
 * 不做袋口豁口几何：球在进入捕获半径前一律按库边反弹，简单且不会漏判。
 */
export const POOL_POCKETS: PoolPocket[] = [
    { x: 0, y: 0, r: 23, kind: 'corner' },
    { x: TABLE_W / 2, y: 0, r: 19, kind: 'side' },
    { x: TABLE_W, y: 0, r: 23, kind: 'corner' },
    { x: 0, y: TABLE_H, r: 23, kind: 'corner' },
    { x: TABLE_W / 2, y: TABLE_H, r: 19, kind: 'side' },
    { x: TABLE_W, y: TABLE_H, r: 23, kind: 'corner' },
];

/** 开球 / 复位时母球的默认位置（「开球点」） */
export const CUE_SPOT_X = TABLE_W * 0.25;
export const CUE_SPOT_Y = TABLE_H / 2;

/** 三角摆球的顶点位置（「置球点」） */
export const RACK_APEX_X = TABLE_W * 0.72;
export const RACK_APEX_Y = TABLE_H / 2;
/** 摆球时相邻球的空隙：保证初始状态互不重叠，又几乎贴着 */
export const RACK_GAP = 0.8;

// ==================== 物理参数 ====================

export const POOL_PHYS = {
    /** 外层固定步长（秒）：核心按此累加推进，保证不同帧率下结果一致 */
    stepSec: 1 / 120,
    /** 单次 step() 最多消化的时间，防止切后台回来雪崩 */
    maxFrameDt: 0.1,
    /** 单帧最多推进的固定步数 */
    maxStepsPerFrame: 24,
    /** 滚动摩擦：线性减速度（px/s²）。满力 1900 → 无碰撞可滑行 ≈2314 px（3.5 个台宽） */
    frictionDecel: 780,
    /** 低于该速度直接归零，避免无限微动 */
    stopSpeed: 8,
    /** 球-球恢复系数（等质量） */
    ballRestitution: 0.95,
    /** 库边恢复系数 */
    cushionRestitution: 0.86,
    /** 速度硬上限（px/s），配合自适应子步杜绝穿透 */
    maxSpeed: 2000,
    /** 最小 / 最大出杆速度（px/s） */
    minShotSpeed: 300,
    maxShotSpeed: 1900,
    /** 一个子步的位移上限（× BALL_R）：0.4 意味着每一步最多挪动 3.6 px */
    substepDisplacement: 0.4,
    /** 单帧内子步数上限 */
    maxSubsteps: 64,
    /** 位置修正迭代次数 */
    solverIterations: 3,
} as const;

// ==================== 关卡 ====================

export interface PoolLevelDef {
    id: number;
    name: string;
    desc: string;
    /** 目标球数量（编号 1..ballCount） */
    ballCount: number;
    /** 三角摆球的行数（row 行共有 row 个位置，合计 rows(rows+1)/2 个） */
    rows: number;
    /** 杆数上限 */
    strokeLimit: number;
    /** 一杆进多球的基础倍率增量：第 k 颗球倍率 = 1 + (k-1)·multiPotBonus */
    multiPotBonus: number;
}

export const POOL_LEVELS: PoolLevelDef[] = [
    {
        id: 1,
        name: '热身三角',
        desc: '6 颗球，熟悉力度与瞄准',
        ballCount: 6,
        rows: 3,
        strokeLimit: 14,
        multiPotBonus: 0.5,
    },
    {
        id: 2,
        name: '双层进击',
        desc: '10 颗球，开始考走位',
        ballCount: 10,
        rows: 4,
        strokeLimit: 26,
        multiPotBonus: 0.6,
    },
    {
        id: 3,
        name: '满台清空',
        desc: '15 颗球，一颗都不许剩',
        ballCount: 15,
        rows: 5,
        strokeLimit: 40,
        multiPotBonus: 0.8,
    },
];

export const POOL_LEVEL_COUNT = POOL_LEVELS.length;

export function getPoolLevel(id: number): PoolLevelDef {
    for (const lv of POOL_LEVELS) if (lv.id === id) return lv;
    return POOL_LEVELS[0];
}

/** 三角摆球的合法行数（ballCount 必须等于 rows(rows+1)/2） */
export function rackRowsFor(ballCount: number): number {
    let rows = 1;
    while ((rows * (rows + 1)) / 2 < ballCount) rows++;
    return rows;
}

// ==================== 计分 ====================

/** 每颗目标球的基础分 */
export const POOL_POT_SCORE = 100;
/** 清台时每点剩余杆数折算的分 */
export const POOL_SPARE_STROKE_SCORE = 60;

// ==================== 配色（视图层用，纯数据） ====================

/** 1–15 号球的主色（十六进制，不带 #） */
export const POOL_BALL_COLORS: string[] = [
    'f2c94c', // 1 黄
    '2f80ed', // 2 蓝
    'eb5757', // 3 红
    '9b51e0', // 4 紫
    'f2994a', // 5 橙
    '27ae60', // 6 绿
    '8b2f2f', // 7 栗
    '2d2d2d', // 8 黑
    'f2c94c', // 9 黄（花）
    '2f80ed', // 10 蓝（花）
    'eb5757', // 11 红（花）
    '9b51e0', // 12 紫（花）
    'f2994a', // 13 橙（花）
    '27ae60', // 14 绿（花）
    '8b2f2f', // 15 栗（花）
];

/** 9–15 号为「花色球」，视图层画成白底 + 色带 */
export const POOL_STRIPED_FROM = 9;

export function ballColor(num: number): string {
    if (num <= 0) return 'f7f7f2';
    const i = (num - 1) % POOL_BALL_COLORS.length;
    return POOL_BALL_COLORS[i];
}

export function isStriped(num: number): boolean {
    return num >= POOL_STRIPED_FROM;
}

// ==================== 存档 ====================

export interface PoolSave {
    /** 每个关卡的最佳分（下标 = levelId - 1） */
    bestScore: number[];
    /** 每个关卡是否已清台 */
    cleared: boolean[];
    /** 上次选择的关卡 */
    lastLevel: number;
    /** 累计进球数 */
    totalPots: number;
}

export function createDefaultPoolSave(): PoolSave {
    return {
        bestScore: new Array(POOL_LEVEL_COUNT).fill(0),
        cleared: new Array(POOL_LEVEL_COUNT).fill(false),
        lastLevel: 1,
        totalPots: 0,
    };
}

function toSafeInt(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.floor(n));
}

/** 坏档回落：任何字段非法都退回默认值，绝不抛异常 */
export function parsePoolSave(raw: unknown): PoolSave {
    const out = createDefaultPoolSave();
    if (!raw || typeof raw !== 'object') return out;
    const src = raw as Record<string, unknown>;

    if (Array.isArray(src.bestScore)) {
        for (let i = 0; i < POOL_LEVEL_COUNT; i++) out.bestScore[i] = toSafeInt(src.bestScore[i], 0);
    }
    if (Array.isArray(src.cleared)) {
        for (let i = 0; i < POOL_LEVEL_COUNT; i++) out.cleared[i] = src.cleared[i] === true;
    }
    const last = toSafeInt(src.lastLevel, 1);
    out.lastLevel = Math.min(POOL_LEVEL_COUNT, Math.max(1, last || 1));
    out.totalPots = toSafeInt(src.totalPots, 0);
    return out;
}
