/**
 * 数独 —— 纯规则模块（不依赖 cc，可在 Node 侧编译自检）。
 *
 * 生成流程：
 *  1. 随机回溯填出一个完整解；
 *  2. 按中心对称成对挖空，每挖一对都用「最多找 2 个解」验证唯一性；
 *  3. 对称挖空不足以达到目标提示数时，再单格挖到目标数。
 *
 * 交互模型：选中格 + 数字键盘；笔记用 9 位掩码；撤销栈记录每次写入前的值/笔记。
 */

export type SudokuDifficulty = 'easy' | 'medium' | 'hard';

export interface SudokuDiff {
    givens: number;
    label: string;
}

export const SUDOKU_DIFFS: Record<SudokuDifficulty, SudokuDiff> = {
    easy: { givens: 40, label: '简单' },
    medium: { givens: 32, label: '中等' },
    hard: { givens: 26, label: '困难' },
};

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

const ALL = 0x1ff; // 9 位全 1

export interface SudokuUndoEntry {
    index: number;
    value: number;
    notes: number;
}

export interface SudokuSnapshot {
    difficulty: SudokuDifficulty;
    seed: number;
    puzzle: number[];
    solution: number[];
    values: number[];
    notes: number[];
    hintsUsed: number;
    mistakes: number;
    elapsed: number;
    status: 'playing' | 'won';
}

export class SudokuCore {
    readonly difficulty: SudokuDifficulty;
    readonly seed: number;
    readonly puzzle: number[] = new Array(81).fill(0);
    readonly solution: number[] = new Array(81).fill(0);
    readonly given: boolean[] = new Array(81).fill(false);
    values: number[] = new Array(81).fill(0);
    /** 每格笔记位掩码：bit0 = 1 … bit8 = 9 */
    notes: number[] = new Array(81).fill(0);
    selected = -1;
    hintsUsed = 0;
    mistakes = 0;
    status: 'playing' | 'won' = 'playing';

    private undoStack: SudokuUndoEntry[] = [];

    constructor(difficulty: SudokuDifficulty = 'easy', seed = 1) {
        this.difficulty = difficulty;
        this.seed = seed >>> 0;
        const rng = mulberry32(this.seed);
        this.generate(rng);
        this.resetProgress();
    }

    resetProgress(): void {
        this.values = this.puzzle.slice();
        this.notes = new Array(81).fill(0);
        this.selected = -1;
        this.hintsUsed = 0;
        this.mistakes = 0;
        this.status = 'playing';
        this.undoStack = [];
    }

    // ==================== 生成 ====================

    private generate(rng: () => number): void {
        const target = SUDOKU_DIFFS[this.difficulty].givens;
        const solution = this.generateSolution(rng);
        for (let i = 0; i < 81; i++) this.solution[i] = solution[i];

        const puzzle = solution.slice();
        let remaining = 81;

        // 中心对称成对挖空
        const pairs: number[] = [];
        for (let i = 0; i < 41; i++) pairs.push(i);
        shuffleWithSeed(pairs, rng);
        for (let p = 0; p < pairs.length; p++) {
            if (remaining <= target) break;
            const i = pairs[p];
            const j = 80 - i;
            if (i === j) {
                if (puzzle[i] === 0) continue;
                const backup = puzzle[i];
                puzzle[i] = 0;
                if (this.countSolutions(puzzle, 2) !== 1) {
                    puzzle[i] = backup;
                } else {
                    remaining--;
                }
                continue;
            }
            if (puzzle[i] === 0 || puzzle[j] === 0) continue;
            // 成对挖会一次少 2 格，剩下的不够就别挖了（差 1 格留给单格阶段）
            if (remaining - 2 < target) continue;
            const a = puzzle[i];
            const b = puzzle[j];
            puzzle[i] = 0;
            puzzle[j] = 0;
            if (this.countSolutions(puzzle, 2) === 1) {
                remaining -= 2;
            } else {
                puzzle[i] = a;
                puzzle[j] = b;
            }
        }

        // 还差几格就单格挖
        if (remaining > target) {
            const order: number[] = [];
            for (let i = 0; i < 81; i++) order.push(i);
            shuffleWithSeed(order, rng);
            for (let k = 0; k < order.length && remaining > target; k++) {
                const i = order[k];
                if (puzzle[i] === 0) continue;
                const backup = puzzle[i];
                puzzle[i] = 0;
                if (this.countSolutions(puzzle, 2) !== 1) {
                    puzzle[i] = backup;
                } else {
                    remaining--;
                }
            }
        }

        for (let i = 0; i < 81; i++) {
            this.puzzle[i] = puzzle[i];
            this.given[i] = puzzle[i] !== 0;
        }
    }

    private generateSolution(rng: () => number): number[] {
        const grid = new Array(81).fill(0);
        const rows = new Array(9).fill(0);
        const cols = new Array(9).fill(0);
        const boxes = new Array(9).fill(0);

        const fill = (pos: number): boolean => {
            if (pos >= 81) return true;
            const r = Math.floor(pos / 9);
            const c = pos % 9;
            const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
            const used = rows[r] | cols[c] | boxes[b];
            let candidates: number[] = [];
            for (let n = 1; n <= 9; n++) {
                if ((used & (1 << (n - 1))) === 0) candidates.push(n);
            }
            shuffleWithSeed(candidates, rng);
            for (let k = 0; k < candidates.length; k++) {
                const n = candidates[k];
                const bit = 1 << (n - 1);
                grid[pos] = n;
                rows[r] |= bit;
                cols[c] |= bit;
                boxes[b] |= bit;
                if (fill(pos + 1)) return true;
                grid[pos] = 0;
                rows[r] &= ~bit;
                cols[c] &= ~bit;
                boxes[b] &= ~bit;
            }
            return false;
        };

        fill(0);
        return grid;
    }

    /** 统计解的数量，最多数到 limit 就停（1 = 唯一） */
    countSolutions(grid: number[], limit: number): number {
        const work = grid.slice();
        const rows = new Array(9).fill(0);
        const cols = new Array(9).fill(0);
        const boxes = new Array(9).fill(0);
        for (let i = 0; i < 81; i++) {
            const n = work[i];
            if (!n) continue;
            const r = Math.floor(i / 9);
            const c = i % 9;
            const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
            const bit = 1 << (n - 1);
            if ((rows[r] | cols[c] | boxes[b]) & bit) return 0;
            rows[r] |= bit;
            cols[c] |= bit;
            boxes[b] |= bit;
        }

        let count = 0;
        const search = (): void => {
            if (count >= limit) return;
            let best = -1;
            let bestMask = 0;
            let bestCount = 10;
            for (let i = 0; i < 81; i++) {
                if (work[i] !== 0) continue;
                const r = Math.floor(i / 9);
                const c = i % 9;
                const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
                const mask = ALL & ~(rows[r] | cols[c] | boxes[b]);
                let bits = 0;
                let m = mask;
                while (m) {
                    bits++;
                    m &= m - 1;
                }
                if (bits === 0) return;
                if (bits < bestCount) {
                    bestCount = bits;
                    bestMask = mask;
                    best = i;
                    if (bits === 1) break;
                }
            }
            if (best < 0) {
                count++;
                return;
            }
            const r = Math.floor(best / 9);
            const c = best % 9;
            const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
            let mask = bestMask;
            while (mask) {
                const bit = mask & -mask;
                mask ^= bit;
                const n = Math.log2(bit) + 1;
                work[best] = n;
                rows[r] |= bit;
                cols[c] |= bit;
                boxes[b] |= bit;
                search();
                work[best] = 0;
                rows[r] &= ~bit;
                cols[c] &= ~bit;
                boxes[b] &= ~bit;
                if (count >= limit) return;
            }
        };

        search();
        return count;
    }

    // ==================== 查询 ====================

    isGiven(index: number): boolean {
        return this.given[index] === true;
    }

    valueAt(index: number): number {
        return this.values[index] || 0;
    }

    notesAt(index: number): number {
        return this.notes[index] || 0;
    }

    isComplete(): boolean {
        for (let i = 0; i < 81; i++) {
            if (this.values[i] !== this.solution[i]) return false;
        }
        return true;
    }

    /** 与同行 / 同列 / 同宫的相同数字冲突的格子（含给定数字） */
    conflicts(): Set<number> {
        const out = new Set<number>();
        const groups: number[][] = [];
        for (let r = 0; r < 9; r++) {
            const row: number[] = [];
            for (let c = 0; c < 9; c++) row.push(r * 9 + c);
            groups.push(row);
        }
        for (let c = 0; c < 9; c++) {
            const col: number[] = [];
            for (let r = 0; r < 9; r++) col.push(r * 9 + c);
            groups.push(col);
        }
        for (let br = 0; br < 3; br++) {
            for (let bc = 0; bc < 3; bc++) {
                const box: number[] = [];
                for (let r = 0; r < 3; r++) {
                    for (let c = 0; c < 3; c++) box.push((br * 3 + r) * 9 + (bc * 3 + c));
                }
                groups.push(box);
            }
        }
        for (let gi = 0; gi < groups.length; gi++) {
            const g = groups[gi];
            const seen: Record<number, number[]> = {};
            for (let k = 0; k < g.length; k++) {
                const idx = g[k];
                const v = this.values[idx];
                if (!v) continue;
                if (!seen[v]) seen[v] = [];
                seen[v].push(idx);
            }
            for (const key in seen) {
                const list = seen[key];
                if (list.length > 1) {
                    for (let k = 0; k < list.length; k++) out.add(list[k]);
                }
            }
        }
        return out;
    }

    /** 还没填的格子数（顶部提示「还差 N 个数字」用） */
    remainingCells(): number {
        let count = 0;
        for (let i = 0; i < 81; i++) if (this.values[i] === 0) count++;
        return count;
    }

    remainingOf(n: number): number {
        let count = 0;
        for (let i = 0; i < 81; i++) if (this.values[i] === n) count++;
        return Math.max(0, 9 - count);
    }

    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    // ==================== 操作 ====================

    select(index: number): void {
        if (index < 0 || index >= 81) {
            this.selected = -1;
            return;
        }
        this.selected = index;
    }

    /** 输入数字（0 = 擦除）。返回是否发生变化 */
    input(n: number): boolean {
        const i = this.selected;
        if (this.status !== 'playing' || i < 0 || this.given[i]) return false;
        if (n < 0 || n > 9) return false;
        if (n === 0) return this.erase();

        if (this.values[i] === n) return this.erase();

        this.pushUndo(i);
        this.values[i] = n;
        this.notes[i] = 0;
        if (n !== this.solution[i]) this.mistakes++;

        // 自动去掉同行/列/宫里的这个候选
        const bit = 1 << (n - 1);
        const peers = this.peersOf(i);
        for (let k = 0; k < peers.length; k++) {
            this.notes[peers[k]] &= ~bit;
        }

        if (this.isComplete()) this.status = 'won';
        return true;
    }

    /** 笔记模式：切换候选数字 */
    toggleNote(n: number): boolean {
        const i = this.selected;
        if (this.status !== 'playing' || i < 0 || this.given[i] || n < 1 || n > 9) return false;
        if (this.values[i] !== 0) return false;
        const bit = 1 << (n - 1);
        this.pushUndo(i);
        this.notes[i] = (this.notes[i] ^ bit) & ALL;
        return true;
    }

    erase(): boolean {
        const i = this.selected;
        if (this.status !== 'playing' || i < 0 || this.given[i]) return false;
        if (this.values[i] === 0 && this.notes[i] === 0) return false;
        this.pushUndo(i);
        this.values[i] = 0;
        this.notes[i] = 0;
        return true;
    }

    /** 提示：优先补当前选中空格，否则补第一个空格。返回被填的格子下标（-1 = 无） */
    hint(): number {
        if (this.status !== 'playing') return -1;
        let target = -1;
        if (this.selected >= 0 && this.values[this.selected] === 0 && !this.given[this.selected]) {
            target = this.selected;
        } else {
            for (let k = 0; k < 81; k++) {
                const i = (k + Math.max(0, this.selected + 1)) % 81;
                if (this.values[i] === 0 && !this.given[i]) {
                    target = i;
                    break;
                }
            }
        }
        if (target < 0) return -1;
        this.pushUndo(target);
        this.values[target] = this.solution[target];
        this.notes[target] = 0;
        this.hintsUsed++;
        if (this.isComplete()) this.status = 'won';
        return target;
    }

    undo(): boolean {
        const entry = this.undoStack.pop();
        if (!entry) return false;
        this.values[entry.index] = entry.value;
        this.notes[entry.index] = entry.notes;
        return true;
    }

    private pushUndo(index: number): void {
        this.undoStack.push({
            index,
            value: this.values[index],
            notes: this.notes[index],
        });
        if (this.undoStack.length > 300) this.undoStack.shift();
    }

    peersOf(index: number): number[] {
        const r = Math.floor(index / 9);
        const c = index % 9;
        const br = Math.floor(r / 3) * 3;
        const bc = Math.floor(c / 3) * 3;
        const out = new Set<number>();
        for (let k = 0; k < 9; k++) {
            out.add(r * 9 + k);
            out.add(k * 9 + c);
        }
        for (let dr = 0; dr < 3; dr++) {
            for (let dc = 0; dc < 3; dc++) {
                out.add((br + dr) * 9 + (bc + dc));
            }
        }
        out.delete(index);
        return Array.from(out);
    }

    isPeer(a: number, b: number): boolean {
        if (a === b) return false;
        const ar = Math.floor(a / 9);
        const ac = a % 9;
        const br = Math.floor(b / 9);
        const bc = b % 9;
        return ar === br || ac === bc
            || (Math.floor(ar / 3) === Math.floor(br / 3) && Math.floor(ac / 3) === Math.floor(bc / 3));
    }

    // ==================== 存档 ====================

    snapshot(elapsed = 0): SudokuSnapshot {
        return {
            difficulty: this.difficulty,
            seed: this.seed,
            puzzle: this.puzzle.slice(),
            solution: this.solution.slice(),
            values: this.values.slice(),
            notes: this.notes.slice(),
            hintsUsed: this.hintsUsed,
            mistakes: this.mistakes,
            elapsed,
            status: this.status,
        };
    }

    static fromSnapshot(snap: SudokuSnapshot): SudokuCore | null {
        if (!snap || !snap.puzzle || snap.puzzle.length !== 81 || !snap.solution || snap.solution.length !== 81) {
            return null;
        }
        const core = new SudokuCore(snap.difficulty, snap.seed);
        for (let i = 0; i < 81; i++) {
            core.puzzle[i] = snap.puzzle[i] || 0;
            core.solution[i] = snap.solution[i] || 0;
            core.given[i] = core.puzzle[i] !== 0;
            core.values[i] = snap.values && snap.values.length === 81 ? (snap.values[i] || 0) : core.puzzle[i];
            core.notes[i] = snap.notes && snap.notes.length === 81 ? (snap.notes[i] || 0) : 0;
        }
        core.hintsUsed = snap.hintsUsed || 0;
        core.mistakes = snap.mistakes || 0;
        core.status = snap.status === 'won' ? 'won' : 'playing';
        core.selected = -1;
        core.undoStack = [];
        return core;
    }
}
