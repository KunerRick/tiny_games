/**
 * 缤纷消除 —— 关卡配置与目标判定（纯逻辑，无 cc 依赖）。
 *
 * 30 关由公式生成，保证单调递增；两种目标（分数 / 收集颜色 / 消除格数）轮转。
 */

export type Match3GoalType = 'score' | 'collect' | 'clear';

export interface Match3Level {
    /** 关卡序号，1–30 */
    id: number;
    moves: number;
    colorCount: number;
    goal: {
        type: Match3GoalType;
        /** score：目标分；collect / clear：目标数量 */
        value: number;
        /** collect 目标指定的颜色下标 */
        color?: number;
    };
}

export interface Match3Progress {
    score: number;
    clearedTotal: number;
    clearedByColor: number[];
}

export interface Match3GoalState {
    /** 目标进度 0–1（封顶 1） */
    ratio: number;
    /** 当前值 */
    current: number;
    /** 目标值 */
    target: number;
    reached: boolean;
}

export const MATCH3_LEVEL_COUNT = 30;
/** 达成 2 星所需的「超出比例」 */
export const MATCH3_STAR2_RATIO = 0.5;
/** 达成 3 星所需的「超出比例」 */
export const MATCH3_STAR3_RATIO = 1;

function buildLevels(): Match3Level[] {
    const list: Match3Level[] = [];
    for (let i = 0; i < MATCH3_LEVEL_COUNT; i++) {
        const id = i + 1;
        const moves = 20 + Math.floor(i / 3) * 2;
        const colorCount = i >= 6 && i % 4 === 3 ? 4 : 5;
        const type: Match3GoalType = i % 3 === 0 ? 'score' : i % 3 === 1 ? 'collect' : 'clear';
        if (type === 'score') {
            list.push({ id, moves, colorCount, goal: { type, value: 1800 + i * 420 } });
        } else if (type === 'collect') {
            list.push({ id, moves, colorCount, goal: { type, value: Math.floor(14 + i * 1.4), color: i % colorCount } });
        } else {
            list.push({ id, moves, colorCount, goal: { type, value: 45 + i * 6 } });
        }
    }
    return list;
}

export const MATCH3_LEVELS: Match3Level[] = buildLevels();

export function getMatch3Level(id: number): Match3Level {
    const idx = Math.floor(Number(id)) - 1;
    if (!Number.isFinite(idx) || idx < 0) return MATCH3_LEVELS[0];
    return MATCH3_LEVELS[Math.min(MATCH3_LEVELS.length - 1, idx)];
}

/** 目标当前进度 */
export function evaluateGoal(level: Match3Level, progress: Match3Progress): Match3GoalState {
    const type = level.goal.type;
    const target = Math.max(1, level.goal.value);
    let current = 0;
    if (type === 'score') {
        current = Math.max(0, Math.floor(progress.score));
    } else if (type === 'clear') {
        current = Math.max(0, Math.floor(progress.clearedTotal));
    } else {
        const color = level.goal.color === undefined ? 0 : level.goal.color;
        const arr = progress.clearedByColor;
        current = arr && arr[color] ? Math.max(0, Math.floor(arr[color])) : 0;
    }
    return {
        ratio: Math.min(1, current / target),
        current,
        target,
        reached: current >= target,
    };
}

/**
 * 星级：1 星 = 达标。
 * - `score` 关：得分达到目标 1.5 / 2 倍各加一星。
 * - `collect` / `clear` 关：达标时剩余步数占比 ≥30% / ≥60% 各加一星。
 */
export function starsFor(level: Match3Level, progress: Match3Progress, movesLeft: number): number {
    const state = evaluateGoal(level, progress);
    if (!state.reached) return 0;
    if (level.goal.type === 'score') {
        const overshoot = progress.score / Math.max(1, level.goal.value) - 1;
        if (overshoot >= MATCH3_STAR3_RATIO) return 3;
        if (overshoot >= MATCH3_STAR2_RATIO) return 2;
        return 1;
    }
    const total = Math.max(1, level.moves);
    const leftRatio = Math.max(0, movesLeft) / total;
    if (leftRatio >= 0.6) return 3;
    if (leftRatio >= 0.3) return 2;
    return 1;
}

/** 颜色名（与 Match3Game 的调色板顺序一致） */
export const MATCH3_COLOR_NAMES = ['红', '蓝', '绿', '黄', '紫'];

/** 目标文案 */
export function goalText(level: Match3Level): string {
    const goal = level.goal;
    if (goal.type === 'score') return `得分达到 ${goal.value}`;
    if (goal.type === 'clear') return `消除 ${goal.value} 块`;
    const color = goal.color === undefined ? 0 : goal.color;
    const name = MATCH3_COLOR_NAMES[color % MATCH3_COLOR_NAMES.length] || '同';
    return `收集 ${goal.value} 个「${name}」色方块`;
}

/** 目标进度文案 */
export function goalProgressText(level: Match3Level, progress: Match3Progress): string {
    const state = evaluateGoal(level, progress);
    return `${Math.min(state.current, state.target)}/${state.target}`;
}

/** 存档里的关卡进度 */
export interface Match3Save {
    v: 1;
    level: number;
    /** 每关最好星级，下标 0 对应第 1 关 */
    stars: number[];
    bestScore: number;
}

export function createDefaultSave(): Match3Save {
    return { v: 1, level: 1, stars: new Array(MATCH3_LEVEL_COUNT).fill(0), bestScore: 0 };
}

function clampInt(value: unknown, min: number, max: number): number {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

/** 坏档 / 缺字段一律回落默认值，绝不抛异常 */
export function parseMatch3Save(raw: unknown): Match3Save {
    const save = createDefaultSave();
    if (!raw || typeof raw !== 'object') return save;
    const data = raw as Partial<Match3Save>;
    save.level = clampInt(data.level, 1, MATCH3_LEVEL_COUNT);
    save.bestScore = clampInt(data.bestScore, 0, 1e9);
    if (Array.isArray(data.stars)) {
        for (let i = 0; i < MATCH3_LEVEL_COUNT; i++) {
            save.stars[i] = clampInt(data.stars[i], 0, 3);
        }
    }
    return save;
}
