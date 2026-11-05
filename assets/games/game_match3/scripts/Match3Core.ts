/**
 * 缤纷消除 —— 纯逻辑核心（不依赖 cc，可被 Node 自检直接编译）。
 *
 * 负责：8×8 棋盘、交换合法性、消除与连锁、特殊块（十字炸弹 / 彩球）、
 * 重力补位、无解自动重排、快照存取。
 *
 * 所有下标都是 `row * cols + col`；行 0 在最上方。
 */

export type Match3Special = 'none' | 'row' | 'col' | 'rainbow';

export interface Match3Cell {
    color: number;
    special: Match3Special;
}

export interface Match3Step {
    /** 第几段连锁，从 1 开始 */
    chain: number;
    /** 本段被消除的格子下标 */
    cleared: number[];
    /** 本段被触发效果的特殊块下标 */
    triggers: number[];
    /** 本段得分 */
    score: number;
}

export interface Match3SwapResult {
    from: number;
    to: number;
    steps: Match3Step[];
    score: number;
    clearedByColor: number[];
    clearedTotal: number;
    /** 结算后无合法步，已自动重排 */
    shuffled: boolean;
}

export interface Match3Snapshot {
    v: 1;
    cols: number;
    rows: number;
    colorCount: number;
    cells: Match3Cell[];
}

export interface Match3Run {
    cells: number[];
    dir: 'h' | 'v';
    color: number;
}

export const MATCH3_COLS = 8;
export const MATCH3_ROWS = 8;
export const MATCH3_DEFAULT_COLORS = 5;
/** 连锁段数上限，兜底防止死循环 */
export const MATCH3_MAX_CHAIN = 30;
/** 每格基础分 */
export const MATCH3_BASE_SCORE = 10;
/** 触发一次特殊块的额外分 */
export const MATCH3_SPECIAL_SCORE = 30;

const EMPTY = -1;

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function next(): number {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function isValidSpecial(value: unknown): value is Match3Special {
    return value === 'none' || value === 'row' || value === 'col' || value === 'rainbow';
}

function clampColorCount(value: unknown): number {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 3) return MATCH3_DEFAULT_COLORS;
    return Math.min(8, n);
}

function isAdjacent(a: number, b: number, cols: number): boolean {
    if (a < 0 || b < 0) return false;
    if (a === b) return false;
    const ar = Math.floor(a / cols);
    const ac = a % cols;
    const br = Math.floor(b / cols);
    const bc = b % cols;
    return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}

export class Match3Core {
    readonly cols: number;
    readonly rows: number;
    readonly colorCount: number;
    cells: Match3Cell[] = [];

    private _rng: () => number;

    constructor(cols: number, rows: number, colorCount: number, rng: () => number) {
        this.cols = cols;
        this.rows = rows;
        this.colorCount = clampColorCount(colorCount);
        this._rng = rng;
        this.cells = new Array(cols * rows);
    }

    // ==================== 构造 ====================

    /** 生成一副开局：无现成三连、必有合法步 */
    static create(seed: number, colorCount: number = MATCH3_DEFAULT_COLORS): Match3Core {
        const rng = mulberry32(Number.isFinite(seed) ? seed : Date.now());
        const core = new Match3Core(MATCH3_COLS, MATCH3_ROWS, colorCount, rng);
        core._fillRandom();
        core._settleOpening();
        return core;
    }

    static fromSnapshot(raw: unknown, seed: number = Date.now()): Match3Core | null {
        if (!raw || typeof raw !== 'object') return null;
        const data = raw as Partial<Match3Snapshot>;
        const cols = Number(data.cols);
        const rows = Number(data.rows);
        if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
        if (cols < 3 || rows < 3 || cols > 12 || rows > 12) return null;
        const colorCount = clampColorCount(data.colorCount);
        if (!Array.isArray(data.cells) || data.cells.length !== cols * rows) return null;

        const core = new Match3Core(cols, rows, colorCount, mulberry32(seed));
        for (let i = 0; i < data.cells.length; i++) {
            const cell = data.cells[i] as Partial<Match3Cell> | undefined;
            if (!cell || typeof cell !== 'object') return null;
            const color = Number(cell.color);
            if (!Number.isInteger(color) || color < 0 || color >= colorCount) return null;
            const special = cell.special === undefined ? 'none' : cell.special;
            if (!isValidSpecial(special)) return null;
            core.cells[i] = { color, special };
        }
        return core;
    }

    // ==================== 读取 ====================

    get size(): number {
        return this.cols * this.rows;
    }

    colorAt(index: number): number {
        const cell = this.cells[index];
        return cell ? cell.color : EMPTY;
    }

    specialAt(index: number): Match3Special {
        const cell = this.cells[index];
        return cell ? cell.special : 'none';
    }

    rowOf(index: number): number {
        return Math.floor(index / this.cols);
    }

    colOf(index: number): number {
        return index % this.cols;
    }

    // ==================== 查询 ====================

    /** 找出所有长度 ≥3 的同色连续段 */
    findRuns(): Match3Run[] {
        const runs: Match3Run[] = [];
        // 横向
        for (let r = 0; r < this.rows; r++) {
            let c = 0;
            while (c < this.cols) {
                const color = this.colorAt(r * this.cols + c);
                if (color === EMPTY) {
                    c++;
                    continue;
                }
                let end = c + 1;
                while (end < this.cols && this.colorAt(r * this.cols + end) === color) end++;
                if (end - c >= 3) {
                    const cells: number[] = [];
                    for (let k = c; k < end; k++) cells.push(r * this.cols + k);
                    runs.push({ cells, dir: 'h', color });
                }
                c = end;
            }
        }
        // 纵向
        for (let c = 0; c < this.cols; c++) {
            let r = 0;
            while (r < this.rows) {
                const color = this.colorAt(r * this.cols + c);
                if (color === EMPTY) {
                    r++;
                    continue;
                }
                let end = r + 1;
                while (end < this.rows && this.colorAt(end * this.cols + c) === color) end++;
                if (end - r >= 3) {
                    const cells: number[] = [];
                    for (let k = r; k < end; k++) cells.push(k * this.cols + c);
                    runs.push({ cells, dir: 'v', color });
                }
                r = end;
            }
        }
        return runs;
    }

    hasRuns(): boolean {
        return this.findRuns().length > 0;
    }

    canSwap(a: number, b: number): boolean {
        if (!this._isCell(a) || !this._isCell(b)) return false;
        if (!isAdjacent(a, b, this.cols)) return false;
        if (this.colorAt(a) === this.colorAt(b) && this.specialAt(a) === this.specialAt(b)) return false;
        this._swapCells(a, b);
        const ok = this.findRuns().length > 0;
        this._swapCells(a, b);
        return ok;
    }

    hasMove(): boolean {
        return this.findHint() !== null;
    }

    /** 返回一组合法交换；无解返回 null */
    findHint(): [number, number] | null {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const idx = r * this.cols + c;
                if (c + 1 < this.cols) {
                    const right = idx + 1;
                    if (this.canSwap(idx, right)) return [idx, right];
                }
                if (r + 1 < this.rows) {
                    const down = idx + this.cols;
                    if (this.canSwap(idx, down)) return [idx, down];
                }
            }
        }
        return null;
    }

    // ==================== 主流程 ====================

    /**
     * 交换相邻两格并结算全部连锁。
     * 非法交换（不相邻 / 不产生消除）返回 null，棋盘保持不变。
     */
    swap(a: number, b: number): Match3SwapResult | null {
        if (!this.canSwap(a, b)) return null;

        this._swapCells(a, b);
        const steps: Match3Step[] = [];
        const clearedByColor = new Array(this.colorCount).fill(0);
        let totalScore = 0;
        let totalCleared = 0;

        const resolved = this._resolve([a, b]);
        for (let i = 0; i < resolved.steps.length; i++) {
            const step = resolved.steps[i];
            steps.push(step);
            totalScore += step.score;
            totalCleared += step.cleared.length;
        }
        for (let i = 0; i < this.colorCount; i++) clearedByColor[i] = resolved.clearedByColor[i];

        let shuffled = false;
        if (!this.hasMove()) {
            this.shuffle();
            shuffled = true;
        }

        return { from: a, to: b, steps, score: totalScore, clearedByColor, clearedTotal: totalCleared, shuffled };
    }

    /** 打乱全盘（保留所有块的颜色与特殊属性），保证重排后无现成三连且有合法步 */
    shuffle(): boolean {
        const all = this.cells.map((cell) => ({ color: cell.color, special: cell.special }));
        for (let attempt = 0; attempt < 200; attempt++) {
            this._shuffleArray(all);
            for (let i = 0; i < all.length; i++) this.cells[i] = { color: all[i].color, special: all[i].special };
            if (!this.hasRuns() && this.hasMove()) return true;
        }
        // 极端兜底：直接重新生成
        this._fillRandom();
        this._settleOpening();
        return true;
    }

    snapshot(): Match3Snapshot {
        return {
            v: 1,
            cols: this.cols,
            rows: this.rows,
            colorCount: this.colorCount,
            cells: this.cells.map((cell) => ({ color: cell.color, special: cell.special })),
        };
    }

    // ==================== 内部：结算 ====================

    private _resolve(swapIdx: number[]): { steps: Match3Step[]; clearedByColor: number[] } {
        const steps: Match3Step[] = [];
        const clearedByColor = new Array(this.colorCount).fill(0);
        let chain = 0;

        while (chain < MATCH3_MAX_CHAIN) {
            const runs = this.findRuns();
            if (runs.length === 0) break;
            chain++;

            // 1) 决定本段生成的特殊块
            const spawns = new Map<number, Match3Special>();
            const spawnColors = new Map<number, number>();
            for (let i = 0; i < runs.length; i++) {
                const run = runs[i];
                let special: Match3Special = 'none';
                if (run.cells.length >= 5) special = 'rainbow';
                else if (run.cells.length === 4) special = run.dir === 'h' ? 'col' : 'row';
                if (special === 'none') continue;

                let at = -1;
                for (let k = 0; k < swapIdx.length; k++) {
                    if (run.cells.indexOf(swapIdx[k]) >= 0) {
                        at = swapIdx[k];
                        break;
                    }
                }
                if (at < 0) at = run.cells[Math.floor(run.cells.length / 2)];
                if (spawns.has(at)) continue;
                // 该格原本就是特殊块则保留原有效果
                const existing = this.specialAt(at);
                spawns.set(at, existing !== 'none' ? existing : special);
                spawnColors.set(at, run.color);
            }

            // 2) 本段消除集合
            const cleared = new Set<number>();
            for (let i = 0; i < runs.length; i++) {
                const run = runs[i];
                for (let k = 0; k < run.cells.length; k++) {
                    const idx = run.cells[k];
                    if (!spawns.has(idx)) cleared.add(idx);
                }
            }

            // 3) 特殊块触发扩散（队列 + 去重，新生成的不参与触发）
            const triggers: number[] = [];
            const fired = new Set<number>();
            const queue: number[] = Array.from(cleared);
            while (queue.length > 0) {
                const idx = queue.shift() as number;
                const special = this.specialAt(idx);
                if (special === 'none' || fired.has(idx) || spawns.has(idx)) continue;
                fired.add(idx);
                triggers.push(idx);
                const affected = this._effectCells(idx, special);
                for (let i = 0; i < affected.length; i++) {
                    const t = affected[i];
                    if (spawns.has(t) || cleared.has(t)) continue;
                    cleared.add(t);
                    queue.push(t);
                }
            }

            // 4) 计分并落盘
            const score = MATCH3_BASE_SCORE * cleared.size * chain + MATCH3_SPECIAL_SCORE * triggers.length;
            cleared.forEach((idx) => {
                const color = this.colorAt(idx);
                if (color >= 0 && color < this.colorCount) clearedByColor[color]++;
                this.cells[idx] = { color: EMPTY, special: 'none' };
            });

            spawns.forEach((special, idx) => {
                const color = spawnColors.get(idx);
                this.cells[idx] = {
                    color: color === undefined ? this.colorAt(idx) : color,
                    special,
                };
            });

            steps.push({ chain, cleared: Array.from(cleared), triggers, score });

            // 5) 重力 + 补位
            this._applyGravity();
            this._refill();
        }

        return { steps, clearedByColor };
    }

    /** 特殊块效果波及的格子 */
    private _effectCells(index: number, special: Match3Special): number[] {
        const out: number[] = [];
        if (special === 'row') {
            const r = this.rowOf(index);
            for (let c = 0; c < this.cols; c++) out.push(r * this.cols + c);
        } else if (special === 'col') {
            const c = this.colOf(index);
            for (let r = 0; r < this.rows; r++) out.push(r * this.cols + c);
        } else if (special === 'rainbow') {
            const target = this.colorAt(index);
            for (let i = 0; i < this.cells.length; i++) {
                if (this.colorAt(i) === target) out.push(i);
            }
        }
        return out;
    }

    private _applyGravity(): void {
        for (let c = 0; c < this.cols; c++) {
            let write = this.rows - 1;
            for (let r = this.rows - 1; r >= 0; r--) {
                const idx = r * this.cols + c;
                if (this.colorAt(idx) === EMPTY) continue;
                const target = write * this.cols + c;
                if (target !== idx) {
                    this.cells[target] = this.cells[idx];
                    this.cells[idx] = { color: EMPTY, special: 'none' };
                }
                write--;
            }
        }
    }

    private _refill(): void {
        for (let i = 0; i < this.cells.length; i++) {
            if (this.colorAt(i) === EMPTY) {
                this.cells[i] = { color: this._randomColor(), special: 'none' };
            }
        }
    }

    // ==================== 内部：生成 ====================

    private _fillRandom(): void {
        for (let i = 0; i < this.cells.length; i++) {
            this.cells[i] = { color: this._randomColor(), special: 'none' };
        }
    }

    /** 消除开局现成三连，并保证有合法步 */
    private _settleOpening(): void {
        for (let round = 0; round < 200; round++) {
            const runs = this.findRuns();
            if (runs.length === 0) break;
            for (let i = 0; i < runs.length; i++) {
                const run = runs[i];
                for (let k = 0; k < run.cells.length; k++) {
                    const idx = run.cells[k];
                    this.cells[idx] = {
                        color: (this.colorAt(idx) + 1 + Math.floor(this._rng() * (this.colorCount - 1))) % this.colorCount,
                        special: 'none',
                    };
                }
            }
        }
        if (!this.hasMove()) {
            this.shuffle();
        }
    }

    private _randomColor(): number {
        return Math.floor(this._rng() * this.colorCount) % this.colorCount;
    }

    private _shuffleArray<T>(arr: T[]): void {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this._rng() * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
    }

    private _swapCells(a: number, b: number): void {
        const tmp = this.cells[a];
        this.cells[a] = this.cells[b];
        this.cells[b] = tmp;
    }

    private _isCell(index: number): boolean {
        return Number.isInteger(index) && index >= 0 && index < this.cells.length;
    }
}
