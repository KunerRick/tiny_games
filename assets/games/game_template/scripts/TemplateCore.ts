/**
 * 模板游戏 —— 纯逻辑核心（**零 `cc` 依赖**）
 *
 * 复制这一套到你的新游戏时，只改本文件里的规则，别把 `cc` 拉进来。
 * 规矩（三条，见 docs/design/2026-11-15-new-game-contract.md）：
 *   1. 不 `import` 任何 `cc` / `cc/env` —— 本文件必须能在裸 Node 里直接跑；
 *   2. 不碰 `Date.now()` / `Math.random()` / `localStorage` —— 随机数与时间都由调用方传入，
 *      这样同一份输入永远得到同一份输出，回归自检才写得出来；
 *   3. 状态是可 JSON 化的普通对象，序列化/反序列化都在本文件里，坏档回落也在这里。
 *
 * 玩法（占位，直接换掉）：10 秒内点击得分；每 5 次点击触发一次确定性奖励。
 */

export const TEMPLATE_GAME_ID = 'template';

/** 一局时长（秒） */
export const ROUND_SECONDS = 10;

/** 每点击这么多次触发一次奖励，奖励值由确定性随机数决定（+0 ~ +2） */
export const BONUS_EVERY = 5;

/** 存档结构版本。改了存档字段就 +1，`deserializeSave` 会把旧版本当成坏档丢弃。 */
export const SAVE_VERSION = 1;

export type TemplatePhase = 'ready' | 'playing' | 'over';

/** 运行时状态：可以整体 JSON 化，但只有 `TemplateSave` 那部分会落盘 */
export interface TemplateState {
    phase: TemplatePhase;
    round: number;
    score: number;
    best: number;
    timeLeft: number;
    /** 本局点击次数（决定奖励节奏） */
    taps: number;
    /** 确定性随机数状态（mulberry32） */
    rng: number;
}

/** 落盘结构：**只存值得留的东西**，不要整份 state 存下去 */
export interface TemplateSave {
    version: number;
    best: number;
    round: number;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
    return Math.max(min, Math.min(max, n));
}

/** 用存档（可为 null）造一份全新状态；坏字段会被夹回合法范围，不会抛异常 */
export function createState(saved: TemplateSave | null = null): TemplateState {
    return {
        phase: 'ready',
        round: saved ? clampInt(saved.round, 0, 1e9, 0) : 0,
        score: 0,
        best: saved ? clampInt(saved.best, 0, 1e9, 0) : 0,
        timeLeft: ROUND_SECONDS,
        taps: 0,
        rng: 1,
    };
}

/** 开一局。`seed` 由调用方传入（游戏里用时间，自检里用固定值）。 */
export function startRound(state: TemplateState, seed: number): void {
    state.phase = 'playing';
    state.round += 1;
    state.score = 0;
    state.taps = 0;
    state.timeLeft = ROUND_SECONDS;
    // seed=0 会让 mulberry32 退化，兜一个非零值
    state.rng = (Math.floor(seed) | 0) || 1;
}

/** mulberry32：单步前进状态并返回 [0,1)。确定性、无外部依赖、状态只占一个 int。 */
export function nextRandom(state: TemplateState): number {
    let t = (state.rng + 0x6d2b79f5) | 0;
    state.rng = t;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

/**
 * 点一次，返回本次得分（未开局返回 0）。
 * 注意：调用方负责把返回值显示出来，Core 不碰 UI。
 */
export function tap(state: TemplateState): number {
    if (state.phase !== 'playing') return 0;
    state.taps += 1;
    let gain = 1;
    if (state.taps % BONUS_EVERY === 0) {
        gain += Math.floor(nextRandom(state) * 3);
    }
    state.score += gain;
    return gain;
}

/**
 * 推进时间。返回 true 表示这一拍**刚好结束**本局（调用方据此弹结算）。
 * 重复推进到 0 之后不会重复返回 true。
 */
export function tick(state: TemplateState, dt: number): boolean {
    if (state.phase !== 'playing') return false;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    state.timeLeft = Math.max(0, state.timeLeft - step);
    if (state.timeLeft > 0) return false;
    state.phase = 'over';
    if (state.score > state.best) state.best = state.score;
    return true;
}

/** 提取要落盘的部分 */
export function toSave(state: TemplateState): TemplateSave {
    return { version: SAVE_VERSION, best: state.best, round: state.round };
}

export function serializeSave(save: TemplateSave): string {
    return JSON.stringify(save);
}

/**
 * 宽容反序列化：任何解析不了 / 版本不对 / 字段离谱的内容都返回 null，
 * 调用方拿 null 走 `createState(null)` 即可 —— **坏档永远不崩游戏**。
 */
export function deserializeSave(raw: string | null | undefined): TemplateSave | null {
    if (!raw) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Partial<TemplateSave>;
    if (obj.version !== SAVE_VERSION) return null;
    if (typeof obj.best !== 'number' || typeof obj.round !== 'number') return null;
    if (!Number.isFinite(obj.best) || !Number.isFinite(obj.round)) return null;
    return {
        version: SAVE_VERSION,
        best: clampInt(obj.best, 0, 1e9, 0),
        round: clampInt(obj.round, 0, 1e9, 0),
    };
}

/** 剩余秒数显示成 "9.9"（HUD 用；纯函数，方便自检） */
export function formatSeconds(seconds: number): string {
    const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    return s.toFixed(1);
}
