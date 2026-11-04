/**
 * 扫雷 —— 纯规则模块（不依赖 cc，可在 Node 侧编译自检）。
 *
 * 规则要点：
 *  - 首次翻开永远安全：布雷时排除首格及其 8 邻域；
 *  - 翻开空格（adj = 0）自动扩散；
 *  - 插旗不影响翻开；旗子插满且相邻雷数吻合时可「和弦」翻开周围；
 *  - 翻开地雷即失败，并暴露全部地雷与错误旗子；
 *  - 所有非雷格翻开即胜利。
 */

export type MinesweeperDifficulty = 'easy' | 'medium' | 'hard';
export type MinesweeperStatus = 'ready' | 'playing' | 'won' | 'lost';

export interface MinesweeperDiff {
    cols: number;
    rows: number;
    mines: number;
    label: string;
}

export const MINESWEEPER_DIFFS: Record<MinesweeperDifficulty, MinesweeperDiff> = {
    easy: { cols: 9, rows: 9, mines: 10, label: '初级' },
    medium: { cols: 12, rows: 12, mines: 24, label: '中级' },
    hard: { cols: 16, rows: 16, mines: 45, label: '高级' },
};

/** 确定性随机数（mulberry32） */
export function mulberry32(seed: number): () => number {
    let s = seed >>> 0;
    return function next(): number {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function shuffleWithSeed<T>(items: T[], rng: () => number): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
    }
    return items;
}

export class MinesweeperCore {
    cols = 0;
    rows = 0;
    mineCount = 0;
    status: MinesweeperStatus = 'ready';

    /** 1 = 雷 */
    mines = new Uint8Array(0);
    /** 1 = 已翻开 */
    revealed = new Uint8Array(0);
    /** 1 = 已插旗 */
    flagged = new Uint8Array(0);
    /** 周围雷数 */
    adj = new Uint8Array(0);

    revealedCount = 0;
    flagCount = 0;
    /** 踩中的雷（-1 表示没有） */
    exploded = -1;
    /** 最后一次操作翻开的格子（UI 做动画用） */
    lastOpened: number[] = [];

    private difficulty: MinesweeperDifficulty = 'easy';
    private seed = 0;
    private rng: () => number = Math.random;

    constructor(difficulty: MinesweeperDifficulty = 'easy', seed = 1) {
        this.reset(difficulty, seed);
    }

    get total(): number {
        return this.cols * this.rows;
    }

    get label(): string {
        return MINESWEEPER_DIFFS[this.difficulty].label;
    }

    get difficultyKey(): MinesweeperDifficulty {
        return this.difficulty;
    }

    reset(difficulty: MinesweeperDifficulty, seed: number): void {
        const diff = MINESWEEPER_DIFFS[difficulty];
        this.difficulty = difficulty;
        this.seed = seed >>> 0;
        this.rng = mulberry32(this.seed);
        this.cols = diff.cols;
        this.rows = diff.rows;
        this.mineCount = diff.mines;
        const n = this.total;
        this.mines = new Uint8Array(n);
        this.revealed = new Uint8Array(n);
        this.flagged = new Uint8Array(n);
        this.adj = new Uint8Array(n);
        this.status = 'ready';
        this.revealedCount = 0;
        this.flagCount = 0;
        this.exploded = -1;
        this.lastOpened = [];
    }

    /** 剩余雷数（可能为负，说明旗子插多了） */
    remainingMines(): number {
        return this.mineCount - this.flagCount;
    }

    isInside(x: number, y: number): boolean {
        return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
    }

    neighbors(index: number): number[] {
        const x = index % this.cols;
        const y = Math.floor(index / this.cols);
        const out: number[] = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                if (!this.isInside(x + dx, y + dy)) continue;
                out.push((y + dy) * this.cols + (x + dx));
            }
        }
        return out;
    }

    /** 首次翻开时布雷：排除首格及其邻域（邻域不够时退化为只排除首格） */
    private placeMines(safeIndex: number): void {
        const forbidden = new Set<number>([safeIndex]);
        const near = this.neighbors(safeIndex);
        const candidateCount = this.total - 1 - near.length;
        if (candidateCount >= this.mineCount) {
            for (let i = 0; i < near.length; i++) forbidden.add(near[i]);
        }

        const candidates: number[] = [];
        for (let i = 0; i < this.total; i++) {
            if (!forbidden.has(i)) candidates.push(i);
        }
        shuffleWithSeed(candidates, this.rng);
        for (let i = 0; i < this.mineCount && i < candidates.length; i++) {
            this.mines[candidates[i]] = 1;
        }
        for (let i = 0; i < this.total; i++) {
            if (this.mines[i]) continue;
            let count = 0;
            const ns = this.neighbors(i);
            for (let k = 0; k < ns.length; k++) if (this.mines[ns[k]]) count++;
            this.adj[i] = count;
        }
    }

    /** 插旗 / 拔旗。返回是否发生变化 */
    toggleFlag(index: number): boolean {
        if (this.status !== 'ready' && this.status !== 'playing') return false;
        if (index < 0 || index >= this.total) return false;
        if (this.revealed[index]) return false;
        if (this.flagged[index]) {
            this.flagged[index] = 0;
            this.flagCount--;
        } else {
            this.flagged[index] = 1;
            this.flagCount++;
        }
        return true;
    }

    /** 翻开一格，返回本次新翻开的格子下标 */
    reveal(index: number): number[] {
        this.lastOpened = [];
        if (this.status === 'lost' || this.status === 'won') return this.lastOpened;
        if (index < 0 || index >= this.total) return this.lastOpened;
        if (this.revealed[index] || this.flagged[index]) return this.lastOpened;

        if (this.status === 'ready') {
            this.placeMines(index);
            this.status = 'playing';
        }

        this.openFrom(index);
        this.lastOpened = this.lastOpened.slice();
        return this.lastOpened;
    }

    /** 和弦：已翻开数字格周围旗数 == 数字时，翻开其余邻格 */
    chord(index: number): number[] {
        this.lastOpened = [];
        if (this.status !== 'playing') return this.lastOpened;
        if (index < 0 || index >= this.total) return this.lastOpened;
        if (!this.revealed[index] || this.mines[index] || this.adj[index] === 0) return this.lastOpened;

        const ns = this.neighbors(index);
        let flags = 0;
        for (let i = 0; i < ns.length; i++) if (this.flagged[ns[i]]) flags++;
        if (flags !== this.adj[index]) return this.lastOpened;

        for (let i = 0; i < ns.length; i++) {
            const n = ns[i];
            if (!this.revealed[n] && !this.flagged[n]) this.openFrom(n);
            if ((this.status as MinesweeperStatus) === 'lost') break;
        }
        this.lastOpened = this.lastOpened.slice();
        return this.lastOpened;
    }

    /** BFS 翻开；遇到雷立即失败 */
    private openFrom(start: number): void {
        if (this.revealed[start] || this.flagged[start]) return;

        if (this.mines[start]) {
            this.revealed[start] = 1;
            this.revealedCount++;
            this.exploded = start;
            this.status = 'lost';
            this.lastOpened.push(start);
            return;
        }

        const stack: number[] = [start];
        while (stack.length > 0) {
            const idx = stack.pop() as number;
            if (this.revealed[idx] || this.flagged[idx] || this.mines[idx]) continue;
            this.revealed[idx] = 1;
            this.revealedCount++;
            this.lastOpened.push(idx);
            if (this.adj[idx] !== 0) continue;
            const ns = this.neighbors(idx);
            for (let i = 0; i < ns.length; i++) {
                const n = ns[i];
                if (!this.revealed[n] && !this.flagged[n] && !this.mines[n]) stack.push(n);
            }
        }

        if (this.revealedCount >= this.total - this.mineCount) {
            this.status = 'won';
        }
    }

    /** 已翻开且是数字的格子（供 UI 判断和弦） */
    isNumberCell(index: number): boolean {
        return this.revealed[index] === 1 && this.mines[index] === 0 && this.adj[index] > 0;
    }

    /** 失败后是否应显示地雷 */
    showMine(index: number): boolean {
        return this.status === 'lost' && this.mines[index] === 1 && this.flagged[index] === 0;
    }

    /** 失败后是否显示错误旗子 */
    showWrongFlag(index: number): boolean {
        return this.status === 'lost' && this.flagged[index] === 1 && this.mines[index] === 0;
    }

    /** 存档快照（用于断点续玩） */
    snapshot(): MinesweeperSnapshot {
        return {
            difficulty: this.difficulty,
            seed: this.seed,
            status: this.status,
            mines: Array.from(this.mines),
            revealed: Array.from(this.revealed),
            flagged: Array.from(this.flagged),
            adj: Array.from(this.adj),
            revealedCount: this.revealedCount,
            flagCount: this.flagCount,
            exploded: this.exploded,
        };
    }

    static fromSnapshot(snap: MinesweeperSnapshot): MinesweeperCore {
        const core = new MinesweeperCore(snap.difficulty, snap.seed);
        const n = core.total;
        if (snap.mines.length !== n) return core;
        core.mines = Uint8Array.from(snap.mines);
        core.revealed = Uint8Array.from(snap.revealed);
        core.flagged = Uint8Array.from(snap.flagged);
        core.adj = Uint8Array.from(snap.adj);
        core.status = snap.status;
        core.revealedCount = snap.revealedCount;
        core.flagCount = snap.flagCount;
        core.exploded = snap.exploded;
        return core;
    }
}

export interface MinesweeperSnapshot {
    difficulty: MinesweeperDifficulty;
    seed: number;
    status: MinesweeperStatus;
    mines: number[];
    revealed: number[];
    flagged: number[];
    adj: number[];
    revealedCount: number;
    flagCount: number;
    exploded: number;
}
