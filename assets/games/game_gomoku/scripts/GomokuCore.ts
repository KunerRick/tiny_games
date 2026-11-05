/**
 * 五子棋 —— 纯逻辑核心（不依赖 cc，可被 Node 自检直接编译）。
 *
 * 负责：棋盘状态、落子合法性、四方向胜负判定、平局、悔棋历史、三档 AI。
 * 坐标：`(row, col)`，0..size-1，左上为 (0,0)；内部下标 = row * size + col。
 *
 * 约定：所有 AI 方法都不修改棋局，只返回落点；由调用方执行 `place()`。
 */

export const GOMOKU_SIZE = 15;
export const GOMOKU_EMPTY = 0;
export const GOMOKU_BLACK = 1;
export const GOMOKU_WHITE = 2;
export const GOMOKU_DRAW = 3;

export type GomokuDifficulty = 'easy' | 'normal' | 'hard';

export const GOMOKU_DIFFS: Record<GomokuDifficulty, { label: string; hint: string }> = {
    easy: { label: '新手', hint: '会漏防' },
    normal: { label: '普通', hint: '会堵冲四' },
    hard: { label: '困难', hint: '算一层应手' },
};

export interface GomokuPoint {
    r: number;
    c: number;
}

export interface GomokuMoveRecord {
    index: number;
    player: number;
    winnerBefore: number;
    winLineBefore: number[];
    moveCountBefore: number;
}

/** 棋型分值：分值之间留足数量级，避免低阶棋型叠加超过高阶棋型 */
export const GOMOKU_SCORES = {
    FIVE: 1000000,
    OPEN_FOUR: 100000,
    FOUR: 12000,
    OPEN_THREE: 8000,
    THREE: 800,
    OPEN_TWO: 400,
    TWO: 60,
    SINGLE: 10,
} as const;

/** 确定性随机数（同种子同序列），用于 AI 平局打破 */
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

export function opponentOf(player: number): number {
    return player === GOMOKU_BLACK ? GOMOKU_WHITE : GOMOKU_BLACK;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
    [0, 1],   // 横
    [1, 0],   // 竖
    [1, 1],   // 主斜
    [1, -1],  // 副斜
];

interface RunInfo {
    total: number;
    openEnds: number;
    back: number;
    forward: number;
}

/**
 * 统计以 (r,c) 为起点、沿 (dr,dc) 的连续同色子。
 * 调用方保证 (r,c) 在盘内；该点被**视为** player 的子（可以是待落子的空点）。
 */
function countRun(
    board: Uint8Array,
    size: number,
    r: number,
    c: number,
    dr: number,
    dc: number,
    player: number,
): RunInfo {
    let back = 0;
    let rr = r - dr;
    let cc = c - dc;
    while (rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr * size + cc] === player) {
        back++;
        rr -= dr;
        cc -= dc;
    }

    let forward = 0;
    rr = r + dr;
    cc = c + dc;
    while (rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr * size + cc] === player) {
        forward++;
        rr += dr;
        cc += dc;
    }

    const endBackR = r - (back + 1) * dr;
    const endBackC = c - (back + 1) * dc;
    const endFwdR = r + (forward + 1) * dr;
    const endFwdC = c + (forward + 1) * dc;
    const inside = (row: number, col: number): boolean =>
        row >= 0 && row < size && col >= 0 && col < size;
    let openEnds = 0;
    if (inside(endBackR, endBackC) && board[endBackR * size + endBackC] === GOMOKU_EMPTY) openEnds++;
    if (inside(endFwdR, endFwdC) && board[endFwdR * size + endFwdC] === GOMOKU_EMPTY) openEnds++;

    return { total: back + forward + 1, openEnds, back, forward };
}

function patternScore(info: RunInfo): number {
    const total = info.total;
    if (total >= 5) return GOMOKU_SCORES.FIVE;
    if (total === 4) {
        if (info.openEnds === 2) return GOMOKU_SCORES.OPEN_FOUR;
        if (info.openEnds === 1) return GOMOKU_SCORES.FOUR;
        return 0;
    }
    if (total === 3) {
        if (info.openEnds === 2) return GOMOKU_SCORES.OPEN_THREE;
        if (info.openEnds === 1) return GOMOKU_SCORES.THREE;
        return 0;
    }
    if (total === 2) {
        if (info.openEnds === 2) return GOMOKU_SCORES.OPEN_TWO;
        if (info.openEnds === 1) return GOMOKU_SCORES.TWO;
        return 0;
    }
    if (total === 1 && info.openEnds === 2) return GOMOKU_SCORES.SINGLE;
    return 0;
}

/** 若 player 落在 index，四方向棋型分之和（不修改棋盘） */
export function scoreMoveFor(
    board: Uint8Array,
    size: number,
    index: number,
    player: number,
): number {
    const r = Math.floor(index / size);
    const c = index % size;
    let score = 0;
    for (let d = 0; d < DIRS.length; d++) {
        const dir = DIRS[d];
        score += patternScore(countRun(board, size, r, c, dir[0], dir[1], player));
    }
    return score;
}

/** player 落在 index 后是否连成五子（不修改棋盘） */
export function wouldWinOn(
    board: Uint8Array,
    size: number,
    index: number,
    player: number,
): boolean {
    const r = Math.floor(index / size);
    const c = index % size;
    for (let d = 0; d < DIRS.length; d++) {
        const dir = DIRS[d];
        if (countRun(board, size, r, c, dir[0], dir[1], player).total >= 5) return true;
    }
    return false;
}

/**
 * 返回 index 处刚落下的 player 棋子形成的胜线（含两侧连续子，长度 >= 5）。
 * 若同一手同时形成多条线，返回第一条胜线的全部格子；无胜返回空数组。
 * 调用前 board[index] 必须已写入 player。
 */
export function findWinLine(
    board: Uint8Array,
    size: number,
    index: number,
    player: number,
): number[] {
    const r = Math.floor(index / size);
    const c = index % size;
    for (let d = 0; d < DIRS.length; d++) {
        const dir = DIRS[d];
        const info = countRun(board, size, r, c, dir[0], dir[1], player);
        if (info.total < 5) continue;
        const cells: number[] = [];
        for (let k = -info.back; k <= info.forward; k++) {
            cells.push((r + k * dir[0]) * size + (c + k * dir[1]));
        }
        return cells;
    }
    return [];
}

/** 候选点：所有与已有棋子切比雪夫距离 <= radius 的空点（去重，按盘面顺序） */
export function collectCandidates(
    board: Uint8Array,
    size: number,
    radius = 2,
): number[] {
    const seen = new Uint8Array(board.length);
    const out: number[] = [];
    for (let i = 0; i < board.length; i++) {
        if (board[i] === GOMOKU_EMPTY) continue;
        const r = Math.floor(i / size);
        const c = i % size;
        for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
                if (dr === 0 && dc === 0) continue;
                const rr = r + dr;
                const cc = c + dc;
                if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
                const j = rr * size + cc;
                if (board[j] !== GOMOKU_EMPTY || seen[j]) continue;
                seen[j] = 1;
                out.push(j);
            }
        }
    }
    return out;
}

export class GomokuCore {
    readonly size: number;
    board: Uint8Array;
    /** 当前手方：GOMOKU_BLACK / GOMOKU_WHITE */
    current: number = GOMOKU_BLACK;
    /** 0 未结束；BLACK / WHITE 胜；GOMOKU_DRAW 平局 */
    winner = 0;
    winLine: number[] = [];
    lastMove = -1;
    moveCount = 0;
    history: GomokuMoveRecord[] = [];

    private readonly rng: () => number;

    constructor(size: number = GOMOKU_SIZE, seed = 1) {
        this.size = size;
        this.board = new Uint8Array(size * size);
        this.rng = mulberry32(seed);
    }

    get isOver(): boolean {
        return this.winner !== 0;
    }

    get isDraw(): boolean {
        return this.winner === GOMOKU_DRAW;
    }

    indexOf(r: number, c: number): number {
        return r * this.size + c;
    }

    pointOf(index: number): GomokuPoint {
        return { r: Math.floor(index / this.size), c: index % this.size };
    }

    isInside(r: number, c: number): boolean {
        return r >= 0 && r < this.size && c >= 0 && c < this.size;
    }

    isLegal(r: number, c: number): boolean {
        if (this.isOver) return false;
        if (!this.isInside(r, c)) return false;
        return this.board[this.indexOf(r, c)] === GOMOKU_EMPTY;
    }

    reset(): void {
        this.board = new Uint8Array(this.size * this.size);
        this.current = GOMOKU_BLACK;
        this.winner = 0;
        this.winLine = [];
        this.lastMove = -1;
        this.moveCount = 0;
        this.history = [];
    }

    /** 落子；非法 / 已终局返回 false */
    place(r: number, c: number): boolean {
        if (!this.isLegal(r, c)) return false;
        const index = this.indexOf(r, c);
        this.history.push({
            index,
            player: this.current,
            winnerBefore: this.winner,
            winLineBefore: this.winLine.slice(),
            moveCountBefore: this.moveCount,
        });

        this.board[index] = this.current;
        this.moveCount++;
        this.lastMove = index;

        const line = findWinLine(this.board, this.size, index, this.current);
        if (line.length >= 5) {
            this.winner = this.current;
            this.winLine = line;
            return true;
        }
        if (this.moveCount >= this.size * this.size) {
            this.winner = GOMOKU_DRAW;
            this.winLine = [];
            return true;
        }
        this.current = opponentOf(this.current);
        return true;
    }

    /** 悔棋：精确还原到 steps 步之前；返回实际回退步数 */
    undo(steps = 1): number {
        let undone = 0;
        while (undone < steps && this.history.length > 0) {
            const rec = this.history.pop() as GomokuMoveRecord;
            this.board[rec.index] = GOMOKU_EMPTY;
            this.moveCount = rec.moveCountBefore;
            this.winner = rec.winnerBefore;
            this.winLine = rec.winLineBefore.slice();
            this.current = rec.player;
            undone++;
        }
        this.lastMove = this.history.length > 0
            ? this.history[this.history.length - 1].index
            : -1;
        return undone;
    }

    /** AI 选点：不修改棋局；无可落点时返回 null */
    aiMove(difficulty: GomokuDifficulty = 'normal'): GomokuPoint | null {
        if (this.isOver) return null;
        const me = this.current;
        const opp = opponentOf(me);

        if (this.moveCount === 0) {
            const mid = Math.floor(this.size / 2);
            return { r: mid, c: mid };
        }

        const candidates = collectCandidates(this.board, this.size);
        if (candidates.length === 0) {
            for (let i = 0; i < this.board.length; i++) {
                if (this.board[i] === GOMOKU_EMPTY) return this.pointOf(i);
            }
            return null;
        }

        if (difficulty === 'easy') {
            const pool = candidates.slice(0, 20);
            if (this.rng() < 0.35) {
                return this.pointOf(pool[Math.floor(this.rng() * pool.length)]);
            }
            const ranked = this.rank(candidates, me);
            const top = ranked.slice(0, Math.min(5, ranked.length));
            return this.pointOf(top[Math.floor(this.rng() * top.length)].index);
        }

        // 普通 / 困难：先处理「下一手直接成五」的攻防
        const win = this.findImmediate(candidates, me);
        if (win >= 0) return this.pointOf(win);
        const block = this.findImmediate(candidates, opp);
        if (block >= 0) return this.pointOf(block);

        const ranked = this.rank(candidates, me);
        if (difficulty === 'normal') {
            return this.pointOf(ranked[0].index);
        }

        // 困难：2 层搜索——我落子后，估算对手最佳应手
        const top = ranked.slice(0, Math.min(12, ranked.length));
        let bestIndex = top[0].index;
        let bestScore = -Infinity;
        for (let i = 0; i < top.length; i++) {
            const cand = top[i];
            this.board[cand.index] = me;
            let value: number;
            if (wouldWinOn(this.board, this.size, cand.index, me)) {
                value = GOMOKU_SCORES.FIVE * 10;
            } else {
                const replies = collectCandidates(this.board, this.size);
                let oppBest = 0;
                for (let k = 0; k < replies.length; k++) {
                    const s = this.evaluateMove(replies[k], opp);
                    if (s > oppBest) oppBest = s;
                }
                value = cand.score - oppBest * 0.9;
            }
            this.board[cand.index] = GOMOKU_EMPTY;
            if (value > bestScore) {
                bestScore = value;
                bestIndex = cand.index;
            }
        }
        return this.pointOf(bestIndex);
    }

    /** 在候选里找「player 落下即五连」的点；没有返回 -1 */
    private findImmediate(candidates: number[], player: number): number {
        for (let i = 0; i < candidates.length; i++) {
            if (wouldWinOn(this.board, this.size, candidates[i], player)) {
                return candidates[i];
            }
        }
        return -1;
    }

    private evaluateMove(index: number, player: number): number {
        return scoreMoveFor(this.board, this.size, index, player);
    }

    /** 候选点打分：进攻分 + 防守分 × 1.15；分数加极小随机量打破平局 */
    private rank(candidates: number[], me: number): Array<{ index: number; score: number }> {
        const opp = opponentOf(me);
        const out: Array<{ index: number; score: number }> = [];
        for (let i = 0; i < candidates.length; i++) {
            const index = candidates[i];
            const attack = this.evaluateMove(index, me);
            const defense = this.evaluateMove(index, opp);
            out.push({ index, score: attack + defense * 1.15 + this.rng() * 0.01 });
        }
        out.sort((a, b) => b.score - a.score);
        return out;
    }
}
