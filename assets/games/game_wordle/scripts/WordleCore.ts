/**
 * 成语猜猜（Wordle 风格）—— 纯规则核心。
 *
 * 本文件不依赖 cc，可在 Node 侧直接编译做回归自检（tools/verify-wordle-core.js）。
 * 词库由调用方传入（运行时复用 `game_idiom/scripts/IdiomData.ts`），核心只认字符串。
 *
 * 设计要点：
 * - 所有随机都来自 `mulberry32(seed)`，同种子结果完全可复现；
 * - 判定遵循 Wordle 的「先绿后黄、每个答案副本只用一次」；
 * - 候选池保证一定包含答案的全部字（重复字按出现次数给重复格）。
 */

export const WORDLE_WORD_LEN = 4;

/** 候选池至少这么多个字，低于则无法制造干扰 */
export const WORDLE_MIN_POOL = 12;

export type CellMark = 'green' | 'yellow' | 'gray';

export type WordleDifficulty = 'easy' | 'medium' | 'hard';

export interface WordleDiffDef {
    id: WordleDifficulty;
    name: string;
    /** 候选池目标字数 */
    poolSize: number;
    /** 可猜次数 */
    maxGuesses: number;
    /** 得分系数 */
    weight: number;
    /** 干扰字中来自「同类词」的比例（0 = 全随机） */
    relatedBias: number;
}

export const WORDLE_DIFFS: Record<WordleDifficulty, WordleDiffDef> = {
    easy: { id: 'easy', name: '轻松', poolSize: 16, maxGuesses: 6, weight: 1.0, relatedBias: 0 },
    medium: { id: 'medium', name: '标准', poolSize: 20, maxGuesses: 6, weight: 1.2, relatedBias: 0.5 },
    hard: { id: 'hard', name: '硬核', poolSize: 24, maxGuesses: 5, weight: 1.5, relatedBias: 1 },
};

export const WORDLE_DIFF_ORDER: WordleDifficulty[] = ['easy', 'medium', 'hard'];

// ==================== 随机 ====================

/** 32 位确定性随机数发生器 */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function next(): number {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 字符串 → 32 位种子（FNV-1a） */
export function hashSeed(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** 日期键（YYYY-MM-DD）→ 每日种子 */
export function dailySeed(dateKey: string): number {
    return hashSeed('wordle:' + dateKey);
}

/** 把 Date 规整成 YYYY-MM-DD（本地时区，跨天以玩家本地时间 0 点为界） */
export function dateKeyOf(date: Date): string {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const pad = (n: number): string => (n < 10 ? '0' + n : String(n));
    return `${y}-${pad(m)}-${pad(d)}`;
}

/** 判断一个词条是否可用作答案（恰好 4 个字符） */
export function isPlayableWord(word: string): boolean {
    return typeof word === 'string' && Array.from(word).length === WORDLE_WORD_LEN;
}

// ==================== 选词 ====================

/**
 * 由种子从词库挑一个答案。
 * 若命中的词条不合法（长度不对），顺延到下一个合法词条，保证永远有解。
 */
export function pickAnswer(seed: number, dict: readonly string[]): string {
    const valid: string[] = [];
    for (let i = 0; i < dict.length; i++) {
        if (isPlayableWord(dict[i])) valid.push(dict[i]);
    }
    if (valid.length === 0) return '一心一意';
    const rng = mulberry32(seed);
    const idx = Math.floor(rng() * valid.length) % valid.length;
    return valid[idx];
}

// ==================== 候选池 ====================

/** 答案的去重字集 */
function charSet(word: string): Set<string> {
    return new Set(Array.from(word));
}

/**
 * 生成候选池：答案的字（含重复） + 干扰字，整体洗牌。
 *
 * @param answer   答案成语
 * @param seed     随机种子（同一局保持不变）
 * @param poolSize 目标字数；不足候选时返回能凑到的最大合法池
 * @param dict     词库（只读）
 */
export function buildPool(
    answer: string,
    seed: number,
    poolSize: number,
    dict: readonly string[],
    relatedBias: number = WORDLE_DIFFS.medium.relatedBias,
): string[] {
    const rng = mulberry32(seed ^ 0x9e3779b9);
    const answerChars = Array.from(answer);
    const answerSet = charSet(answer);

    // 干扰字候选：同类词（与答案共享 ≥ 2 个字）里的字优先，其余次之
    const related: string[] = [];
    const others: string[] = [];
    const seenRelated = new Set<string>();
    const seenOther = new Set<string>();

    for (let i = 0; i < dict.length; i++) {
        const word = dict[i];
        if (!isPlayableWord(word) || word === answer) continue;
        const chars = Array.from(word);
        let shared = 0;
        for (let k = 0; k < chars.length; k++) {
            if (answerSet.has(chars[k])) shared++;
        }
        const bucket = shared >= 2 ? related : others;
        const seen = shared >= 2 ? seenRelated : seenOther;
        for (let k = 0; k < chars.length; k++) {
            const c = chars[k];
            if (answerSet.has(c) || seen.has(c)) continue;
            seen.add(c);
            bucket.push(c);
        }
    }

    const target = Math.max(answerChars.length, poolSize | 0);
    const need = target - answerChars.length;

    return assemblePool(answerChars, related, others, need, relatedBias, rng);
}

/** 带难度系数的候选池生成（运行时入口） */
export function buildPoolFor(
    answer: string,
    seed: number,
    diff: WordleDifficulty,
    dict: readonly string[],
): string[] {
    return buildPool(answer, seed, WORDLE_DIFFS[diff].poolSize, dict, WORDLE_DIFFS[diff].relatedBias);
}

function assemblePool(
    answerChars: string[],
    related: string[],
    others: string[],
    need: number,
    bias: number,
    rng: () => number,
): string[] {
    const pool = answerChars.slice();
    if (need > 0) {
        // 同一字符可能同时出现在「同类词」和「其它词」两个候选桶里，用 used 跨桶去重
        const used = new Set<string>(answerChars);
        const picked: string[] = [];
        const fromRelated = Math.min(related.length, Math.round(need * clamp01(bias)));
        takeDistinct(related, fromRelated, rng, used, picked);
        takeDistinct(others, need - picked.length, rng, used, picked);
        for (let i = 0; i < picked.length; i++) pool.push(picked[i]);
    }
    shuffleInPlace(pool, rng);
    return pool;
}

function clamp01(v: number): number {
    if (!isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

/**
 * 从 source 里不放回地随机取最多 count 个**未用过**的字，追加到 out。
 * source 内部可能含重复字，跨桶也可能重复，因此以 used 集合为准。
 */
function takeDistinct(
    source: string[],
    count: number,
    rng: () => number,
    used: Set<string>,
    out: string[],
): void {
    if (count <= 0) return;
    const avail: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (used.has(c) || seen.has(c)) continue;
        seen.add(c);
        avail.push(c);
    }
    const n = Math.min(count, avail.length);
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(rng() * (avail.length - i));
        const tmp = avail[i];
        avail[i] = avail[j];
        avail[j] = tmp;
        used.add(avail[i]);
        out.push(avail[i]);
    }
}

function shuffleInPlace(arr: string[], rng: () => number): void {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
}

// ==================== 判定 ====================

/**
 * Wordle 判定：先标记全绿，再在剩余答案字里按贪心给黄。
 * 重复字每个答案副本只能用一次。
 */
export function evaluateGuess(answer: string, guess: string): CellMark[] {
    const a = Array.from(answer);
    const g = Array.from(guess);
    const marks: CellMark[] = [];
    const remaining: Record<string, number> = {};

    for (let i = 0; i < g.length; i++) {
        if (i < a.length && g[i] === a[i]) {
            marks.push('green');
        } else {
            marks.push('gray');
            if (i < a.length) {
                const c = a[i];
                remaining[c] = (remaining[c] || 0) + 1;
            }
        }
    }

    for (let i = 0; i < g.length; i++) {
        if (marks[i] === 'green') continue;
        const c = g[i];
        const left = remaining[c] || 0;
        if (left > 0) {
            marks[i] = 'yellow';
            remaining[c] = left - 1;
        }
    }

    return marks;
}

/** 本次提交是否全绿 */
export function isWinningRow(marks: readonly CellMark[]): boolean {
    if (marks.length === 0) return false;
    for (let i = 0; i < marks.length; i++) {
        if (marks[i] !== 'green') return false;
    }
    return true;
}

// ==================== 计分与分享 ====================

/**
 * 得分：猜中时按剩余次数 × 难度系数计，失败为 0。
 * @param usedGuesses 含猜中那一行在内的已用次数（1 起）
 */
export function scoreFor(diff: WordleDifficulty, usedGuesses: number, won: boolean): number {
    if (!won) return 0;
    const def = WORDLE_DIFFS[diff];
    const remaining = Math.max(0, def.maxGuesses - Math.max(1, usedGuesses | 0));
    return Math.round(100 * remaining * def.weight);
}

const MARK_EMOJI: Record<CellMark, string> = {
    green: '🟩',
    yellow: '🟨',
    gray: '⬜',
};

/** 把已提交的判定行转成分享用的方块图（不含变体选择符，微信字体可正常渲染） */
export function shareGrid(rows: readonly (readonly CellMark[])[]): string {
    return rows
        .map((row) => row.map((m) => MARK_EMOJI[m] || '⬜').join(''))
        .join('\n');
}
