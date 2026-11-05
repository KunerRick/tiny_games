/**
 * 成语填字 —— 纯规则模块（不依赖 cc，可在 Node 侧编译自检）。
 *
 * 棋盘：若干条四字成语纵横交叉；每条成语带一组候选字（四字 + 干扰字）。
 * 交互：选中一格 → 激活所在成语 → 从候选字填入；一条成语填满即校验，
 *       正确锁定计分，错误红闪后清空未锁定格。
 *
 * 生成：随机选词 → 以已放成语的共用字为交叉点垂直落子 → 撒已知字 → 生成候选字组。
 *       同一种子可完全复现，供存档读档使用。
 */

import { IDIOM_LIST } from './IdiomData';

export type IdiomDifficulty = 'easy' | 'medium' | 'hard';
export type IdiomDir = 'h' | 'v';

export interface IdiomDiff {
    words: number;
    /** 棋盘边长（格数） */
    size: number;
    /** UI 单格边长（设计像素） */
    cell: number;
    /** 每条成语附带的干扰字数 */
    decoys: number;
    /** 提示次数 */
    hints: number;
    /** 每条成语独立获得已知字的概率 */
    givenRatio: number;
    label: string;
}

export const IDIOM_DIFFS: Record<IdiomDifficulty, IdiomDiff> = {
    easy: { words: 6, size: 8, cell: 70, decoys: 1, hints: 3, givenRatio: 1, label: '轻松' },
    medium: { words: 9, size: 10, cell: 60, decoys: 2, hints: 2, givenRatio: 0.7, label: '标准' },
    hard: { words: 12, size: 13, cell: 46, decoys: 3, hints: 1, givenRatio: 0.5, label: '挑战' },
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

export interface IdiomSlot {
    id: number;
    word: string;
    row: number;
    col: number;
    dir: IdiomDir;
    /** 该成语四格在棋盘中的下标，顺序 = 字的顺序 */
    cells: number[];
}

export interface IdiomFillResult {
    kind: 'none' | 'filled' | 'correct' | 'wrong';
    /** 本次因填错而待清空的格（已计入失误） */
    wrongCells: number[];
}

export interface IdiomSnapshot {
    difficulty: IdiomDifficulty;
    seed: number;
    words: string[];
    values: string[];
    known: boolean[];
    locked: boolean[];
    slotLocked: boolean[];
    mistakes: number;
    hintsUsed: number;
    streak: number;
    bestStreak: number;
    score: number;
    elapsed: number;
    started: boolean;
    selected: number;
    activeSlot: number;
    status: 'playing' | 'won';
}

const GLOBAL_CHARS: string[] = (() => {
    const set = new Set<string>();
    for (let i = 0; i < IDIOM_LIST.length; i++) {
        const word = IDIOM_LIST[i];
        for (let k = 0; k < word.length; k++) set.add(word[k]);
    }
    return Array.from(set);
})();

/** 一次落子最多尝试次数 */
const PLACE_ATTEMPTS = 500;
/** 整体重排次数 */
const BUILD_RESTARTS = 40;

export class IdiomCore {
    readonly difficulty: IdiomDifficulty;
    readonly seed: number;
    readonly size: number;
    /** 每格正确字，空串 = 不在棋盘内 */
    readonly solution: string[] = [];
    /** 每格所属成语方向（用于交叉校验），'' = 空格 */
    readonly cellDir: string[] = [];
    readonly slots: IdiomSlot[] = [];
    /** 每条成语的候选字组（四字 + 干扰字），生成后固定 */
    readonly banks: string[][] = [];

    values: string[] = [];
    /** 已知字 / 提示字（视觉上与玩家填字区分） */
    known: boolean[] = [];
    /** 已锁定格：已知字、提示字、已正确完成的成语的全部格 */
    locked: boolean[] = [];
    slotLocked: boolean[] = [];

    selected = -1;
    activeSlot = -1;
    mistakes = 0;
    hintsUsed = 0;
    streak = 0;
    bestStreak = 0;
    score = 0;
    status: 'playing' | 'won' = 'playing';
    /** 上一次 hint() 是否因为「这条成语里已有错字」而清空了玩家填的字（供 UI 提示） */
    hintClearedSlot = false;

    private _pendingWrong: number[] = [];

    constructor(difficulty: IdiomDifficulty = 'easy', seed = 1) {
        this.difficulty = difficulty;
        this.seed = seed >>> 0;
        const diff = IDIOM_DIFFS[this.difficulty];
        this.size = diff.size;
        const total = this.size * this.size;
        this.solution = new Array(total).fill('');
        this.cellDir = new Array(total).fill('');
        const rng = mulberry32(this.seed);
        this.generate(rng, diff);
        this.resetProgress();
    }

    // ==================== 生成 ====================

    private generate(rng: () => number, diff: IdiomDiff): void {
        for (let restart = 0; restart < BUILD_RESTARTS; restart++) {
            if (this.tryBuild(rng, diff)) return;
        }
        // 理论上不会走到这里；兜底再试一次并接受实际条数
        this.tryBuild(rng, diff, true);
    }

    private tryBuild(rng: () => number, diff: IdiomDiff, tolerant = false): boolean {
        this.solution.fill('');
        this.cellDir.fill('');
        this.slots.length = 0;
        this.banks.length = 0;
        this.knownSet = new Array(this.size * this.size).fill(false);

        const words = shuffleWithSeed(IDIOM_LIST.slice(), rng);
        const first = words[0];
        const row = Math.floor(this.size / 2);
        const col = Math.floor((this.size - first.length) / 2);
        this.addSlot(first, row, col, 'h');

        for (let i = 1; i < words.length && this.slots.length < diff.words; i++) {
            this.tryPlaceWord(words[i], rng);
        }
        if (!tolerant && this.slots.length < diff.words) return false;

        this.assignGivens(rng, diff);
        this.buildBanks(rng, diff);
        return true;
    }

    private addSlot(word: string, row: number, col: number, dir: IdiomDir): IdiomSlot {
        const id = this.slots.length;
        const cells: number[] = [];
        for (let k = 0; k < word.length; k++) {
            const r = dir === 'v' ? row + k : row;
            const c = dir === 'h' ? col + k : col;
            const idx = r * this.size + c;
            cells.push(idx);
            this.solution[idx] = word[k];
            this.cellDir[idx] = dir;
        }
        const slot: IdiomSlot = { id, word, row, col, dir, cells };
        this.slots.push(slot);
        return slot;
    }

    private tryPlaceWord(word: string, rng: () => number): boolean {
        for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
            const base = this.slots[Math.floor(rng() * this.slots.length)];
            if (!base) continue;
            const pIndex = Math.floor(rng() * base.word.length);
            const ch = base.word[pIndex];
            const matches: number[] = [];
            for (let k = 0; k < word.length; k++) if (word[k] === ch) matches.push(k);
            if (matches.length === 0) continue;
            const qIndex = matches[Math.floor(rng() * matches.length)];

            const dir: IdiomDir = base.dir === 'h' ? 'v' : 'h';
            const crossR = base.dir === 'v' ? base.row + pIndex : base.row;
            const crossC = base.dir === 'h' ? base.col + pIndex : base.col;
            const row = dir === 'v' ? crossR - qIndex : crossR;
            const col = dir === 'h' ? crossC - qIndex : crossC;

            if (!this.canPlace(word, row, col, dir, crossR, crossC)) continue;
            this.addSlot(word, row, col, dir);
            return true;
        }
        return false;
    }

    private canPlace(
        word: string,
        row: number,
        col: number,
        dir: IdiomDir,
        crossR: number,
        crossC: number,
    ): boolean {
        const n = word.length;
        const endR = dir === 'v' ? row + n - 1 : row;
        const endC = dir === 'h' ? col + n - 1 : col;
        if (row < 0 || col < 0 || endR >= this.size || endC >= this.size) return false;

        const crossIdx = crossR * this.size + crossC;
        if (this.solution[crossIdx] !== word[(crossR - row) + (crossC - col)]) return false;
        if (this.cellDir[crossIdx] === dir) return false;

        for (let k = 0; k < n; k++) {
            const r = dir === 'v' ? row + k : row;
            const c = dir === 'h' ? col + k : col;
            const idx = r * this.size + c;
            if (idx === crossIdx) continue;
            if (this.solution[idx] !== '') return false;
            // 非交叉格的垂直方向邻格必须为空，避免两条平行成语贴在一起
            if (dir === 'h') {
                if (r > 0 && this.solution[(r - 1) * this.size + c] !== '') return false;
                if (r < this.size - 1 && this.solution[(r + 1) * this.size + c] !== '') return false;
            } else {
                if (c > 0 && this.solution[r * this.size + c - 1] !== '') return false;
                if (c < this.size - 1 && this.solution[r * this.size + c + 1] !== '') return false;
            }
        }

        // 首尾延伸格必须为空，避免两条同向成语连成一片
        if (dir === 'h') {
            if (col > 0 && this.solution[row * this.size + col - 1] !== '') return false;
            if (endC < this.size - 1 && this.solution[row * this.size + endC + 1] !== '') return false;
        } else {
            if (row > 0 && this.solution[(row - 1) * this.size + col] !== '') return false;
            if (endR < this.size - 1 && this.solution[(endR + 1) * this.size + col] !== '') return false;
        }
        return true;
    }

    private assignGivens(rng: () => number, diff: IdiomDiff): void {
        const order = shuffleWithSeed(this.slots.slice(), rng);
        for (let i = 0; i < order.length; i++) {
            if (rng() >= diff.givenRatio) continue;
            const slot = order[i];
            const fresh = slot.cells.filter((idx) => this.solution[idx] !== '' && !this.knownSet[idx]);
            const pool = fresh.length > 0 ? fresh : slot.cells.slice();
            // 优先选非交叉格，给交叉格留出推理空间
            const nonCross = pool.filter((idx) => this.countOwners(idx) === 1);
            const pickFrom = nonCross.length > 0 ? nonCross : pool;
            const idx = pickFrom[Math.floor(rng() * pickFrom.length)];
            this.knownSet[idx] = true;
        }
    }

    /** 生成阶段使用的临时已知字表；构造完成后转成实例字段 */
    private knownSet: boolean[] = [];

    private countOwners(index: number): number {
        let count = 0;
        for (let i = 0; i < this.slots.length; i++) {
            if (this.slots[i].cells.indexOf(index) >= 0) count++;
        }
        return count;
    }

    private buildBanks(rng: () => number, diff: IdiomDiff): void {
        this.banks.length = 0;
        for (let i = 0; i < this.slots.length; i++) {
            const slot = this.slots[i];
            const own = new Set(slot.word.split(''));
            const localPool: string[] = [];
            const seenLocal = new Set<string>();
            for (let s = 0; s < this.slots.length; s++) {
                if (s === i) continue;
                const chars = this.slots[s].word.split('');
                for (let k = 0; k < chars.length; k++) {
                    const ch = chars[k];
                    if (own.has(ch) || seenLocal.has(ch)) continue;
                    seenLocal.add(ch);
                    localPool.push(ch);
                }
            }
            const decoys: string[] = [];
            shuffleWithSeed(localPool, rng);
            for (let k = 0; k < localPool.length && decoys.length < diff.decoys; k++) {
                decoys.push(localPool[k]);
            }
            if (decoys.length < diff.decoys) {
                const fallback = GLOBAL_CHARS.filter((ch) => !own.has(ch) && decoys.indexOf(ch) < 0);
                shuffleWithSeed(fallback, rng);
                for (let k = 0; k < fallback.length && decoys.length < diff.decoys; k++) {
                    decoys.push(fallback[k]);
                }
            }
            const bank = shuffleWithSeed(slot.word.split('').concat(decoys), rng);
            this.banks.push(bank);
        }
    }

    private resetProgress(): void {
        const total = this.size * this.size;
        this.values = this.solution.slice();
        this.known = new Array(total).fill(false);
        this.locked = new Array(total).fill(false);
        for (let i = 0; i < total; i++) {
            if (this.knownSet[i]) {
                this.known[i] = true;
                this.locked[i] = true;
            } else {
                this.values[i] = '';
            }
        }
        this.slotLocked = new Array(this.slots.length).fill(false);
        this.selected = -1;
        this.activeSlot = -1;
        this.mistakes = 0;
        this.hintsUsed = 0;
        this.streak = 0;
        this.bestStreak = 0;
        this.score = 0;
        this.status = 'playing';
        this._pendingWrong = [];
    }

    // ==================== 查询 ====================

    get maxHints(): number {
        return IDIOM_DIFFS[this.difficulty].hints;
    }

    get hintsLeft(): number {
        return Math.max(0, this.maxHints - this.hintsUsed);
    }

    get isResolving(): boolean {
        return this._pendingWrong.length > 0;
    }

    get isWon(): boolean {
        return this.status === 'won';
    }

    slotAt(index: number): IdiomSlot[] {
        const result: IdiomSlot[] = [];
        for (let i = 0; i < this.slots.length; i++) {
            if (this.slots[i].cells.indexOf(index) >= 0) result.push(this.slots[i]);
        }
        return result;
    }

    /** 当前激活成语的候选字；没有激活成语时为空 */
    bank(): string[] {
        if (this.activeSlot < 0) return [];
        return this.banks[this.activeSlot] || [];
    }

    isComplete(): boolean {
        for (let i = 0; i < this.slots.length; i++) if (!this.slotLocked[i]) return false;
        return true;
    }

    /** 完成一条成语的得分（连击已计入） */
    private completionScore(): number {
        this.streak += 1;
        if (this.streak > this.bestStreak) this.bestStreak = this.streak;
        return 100 + 20 * Math.min(this.streak, 5);
    }

    /** 最终分（含时间奖励与难度系数），用于结算 */
    finalScore(elapsed: number): number {
        const seconds = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
        const timeBonus = Math.max(0, 600 - Math.floor(seconds) * 2);
        const mult = this.difficulty === 'hard' ? 1.6 : this.difficulty === 'medium' ? 1.3 : 1;
        return Math.max(0, Math.round((this.score + timeBonus) * mult));
    }

    // ==================== 交互 ====================

    select(index: number): boolean {
        if (index < 0 || index >= this.solution.length) return false;
        if (this.solution[index] === '') return false;

        const owners = this.slotAt(index);
        if (owners.length === 0) return false;

        if (this.selected === index) {
            const open = owners.filter((s) => !this.slotLocked[s.id]);
            if (open.length > 1) {
                const cur = open.findIndex((s) => s.id === this.activeSlot);
                this.activeSlot = open[(cur + 1) % open.length].id;
                return true;
            }
        }

        this.selected = index;
        const open = owners.filter((s) => !this.slotLocked[s.id]);
        const sorted = (open.length > 0 ? open : owners).slice().sort((a, b) => {
            if (a.dir === b.dir) return a.id - b.id;
            return a.dir === 'h' ? -1 : 1;
        });
        this.activeSlot = sorted[0].id;
        return true;
    }

    fill(char: string): IdiomFillResult {
        const result: IdiomFillResult = { kind: 'none', wrongCells: [] };
        if (this.status === 'won' || this._pendingWrong.length > 0) return result;
        if (this.selected < 0 || this.locked[this.selected]) return result;
        if (this.activeSlot < 0 || this.slotLocked[this.activeSlot]) return result;
        if (!char) return result;

        this.values[this.selected] = char;
        this._advanceWithinSlot();
        const full: IdiomSlot[] = [];
        for (let i = 0; i < this.slots.length; i++) {
            const slot = this.slots[i];
            if (this.slotLocked[i]) continue;
            let complete = true;
            for (let k = 0; k < slot.cells.length; k++) {
                if (!this.values[slot.cells[k]]) {
                    complete = false;
                    break;
                }
            }
            if (complete) full.push(slot);
        }

        let anyCorrect = false;
        for (let i = 0; i < full.length; i++) {
            const slot = full[i];
            const formed = slot.cells.map((idx) => this.values[idx]).join('');
            if (formed === slot.word) {
                anyCorrect = true;
                this.slotLocked[slot.id] = true;
                for (let k = 0; k < slot.cells.length; k++) this.locked[slot.cells[k]] = true;
                this.score = Math.max(0, this.score + this.completionScore());
            } else {
                this.mistakes += 1;
                this.streak = 0;
                this.score = Math.max(0, this.score - 30);
                for (let k = 0; k < slot.cells.length; k++) {
                    if (!this.locked[slot.cells[k]]) this._pendingWrong.push(slot.cells[k]);
                }
            }
        }

        if (this._pendingWrong.length > 0) {
            result.kind = 'wrong';
            result.wrongCells = this._pendingWrong.slice();
            return result;
        }
        if (anyCorrect) {
            if (this.isComplete()) this.status = 'won';
            if (this.activeSlot >= 0 && this.slotLocked[this.activeSlot]) {
                // 当前成语已经完成：取消选中，提示玩家去点下一条
                this.activeSlot = -1;
                this.selected = -1;
            }
            result.kind = 'correct';
            return result;
        }
        result.kind = 'filled';
        return result;
    }

    /** 填完一个字后，把光标挪到当前成语里下一个空格（没有空格则不动） */
    private _advanceWithinSlot(): void {
        if (this.activeSlot < 0) return;
        const slot = this.slots[this.activeSlot];
        if (!slot) return;
        const cells = slot.cells;
        let from = 0;
        for (let i = 0; i < cells.length; i++) {
            if (cells[i] === this.selected) {
                from = i + 1;
                break;
            }
        }
        for (let step = 0; step < cells.length; step++) {
            const idx = cells[(from + step) % cells.length];
            if (!this.locked[idx] && !this.values[idx]) {
                this.selected = idx;
                return;
            }
        }
    }

    /** 红闪结束后清空错误格（由 UI 调用） */
    resolveWrong(): number[] {
        const cleared = this._pendingWrong.slice();
        for (let i = 0; i < cleared.length; i++) {
            const idx = cleared[i];
            if (!this.locked[idx]) this.values[idx] = '';
        }
        this._pendingWrong = [];
        return cleared;
    }

    erase(): boolean {
        if (this.status === 'won' || this._pendingWrong.length > 0) return false;
        if (this.activeSlot < 0) return false;

        // 当前格里有自己填的字：直接擦掉
        if (this.selected >= 0 && !this.locked[this.selected] && this.values[this.selected]) {
            this.values[this.selected] = '';
            return true;
        }

        // 否则回退到当前成语里光标前一个自己填的字（配合"填完自动前移"）
        const slot = this.slots[this.activeSlot];
        if (!slot) return false;
        const cells = slot.cells;
        let from = 0;
        for (let i = 0; i < cells.length; i++) {
            if (cells[i] === this.selected) {
                from = i - 1;
                break;
            }
        }
        for (let step = 0; step < cells.length; step++) {
            const i = ((from - step) % cells.length + cells.length) % cells.length;
            const idx = cells[i];
            if (!this.locked[idx] && this.values[idx]) {
                this.values[idx] = '';
                this.selected = idx;
                return true;
            }
        }
        return false;
    }

    /** 提示当前激活成语里的一个空格，返回格下标；-1 = 不可用 */
    hint(): number {
        if (this.status === 'won' || this._pendingWrong.length > 0) return -1;
        if (this.hintsUsed >= this.maxHints) return -1;
        this.hintClearedSlot = false;

        let slot: IdiomSlot | null = null;
        if (this.activeSlot >= 0 && !this.slotLocked[this.activeSlot]) {
            slot = this.slots[this.activeSlot];
        } else {
            for (let i = 0; i < this.slots.length; i++) {
                if (!this.slotLocked[i]) {
                    slot = this.slots[i];
                    break;
                }
            }
        }
        if (!slot) return -1;

        const empty = slot.cells.filter((idx) => !this.locked[idx] && !this.values[idx]);
        if (empty.length === 0) return -1;

        const idx = empty[this.hintsUsed % empty.length];
        this.values[idx] = this.solution[idx];
        this.known[idx] = true;
        this.locked[idx] = true;
        this.hintsUsed += 1;
        this.score = Math.max(0, this.score - 50);

        // 提示可能补满整条成语
        let complete = true;
        for (let k = 0; k < slot.cells.length; k++) {
            if (!this.values[slot.cells[k]]) {
                complete = false;
                break;
            }
        }
        if (complete && !this.slotLocked[slot.id]) {
            const formed = slot.cells.map((cell) => this.values[cell]).join('');
            if (formed === slot.word) {
                this.slotLocked[slot.id] = true;
                for (let k = 0; k < slot.cells.length; k++) this.locked[slot.cells[k]] = true;
                this.score = Math.max(0, this.score + this.completionScore());
                if (this.isComplete()) this.status = 'won';
            } else {
                // 提示补满了这条成语，但里面有玩家填错的字。
                // 若不处理会卡在「还差 0 字」——没有空格可填，也永远不会触发校验。
                for (let k = 0; k < slot.cells.length; k++) {
                    const cell = slot.cells[k];
                    if (!this.locked[cell]) this.values[cell] = '';
                }
                const firstEmpty = slot.cells.find((cell) => !this.locked[cell] && !this.values[cell]);
                if (firstEmpty !== undefined) this.selected = firstEmpty;
                this.hintClearedSlot = true;
            }
        }
        return idx;
    }

    // ==================== 存档 ====================

    snapshot(elapsed = 0, started = false): IdiomSnapshot {
        return {
            difficulty: this.difficulty,
            seed: this.seed,
            words: this.slots.map((s) => s.word),
            values: this.values.slice(),
            known: this.known.slice(),
            locked: this.locked.slice(),
            slotLocked: this.slotLocked.slice(),
            mistakes: this.mistakes,
            hintsUsed: this.hintsUsed,
            streak: this.streak,
            bestStreak: this.bestStreak,
            score: this.score,
            elapsed,
            started,
            selected: this.selected,
            activeSlot: this.activeSlot,
            status: this.status,
        };
    }

    static fromSnapshot(snap: IdiomSnapshot | null): IdiomCore | null {
        if (!snap || !snap.difficulty || !IDIOM_DIFFS[snap.difficulty]) return null;
        if (!Array.isArray(snap.values) || !Array.isArray(snap.locked)) return null;
        const core = new IdiomCore(snap.difficulty, snap.seed);
        if (!Array.isArray(snap.words) || snap.words.length !== core.slots.length) return null;
        for (let i = 0; i < core.slots.length; i++) {
            if (core.slots[i].word !== snap.words[i]) return null;
        }
        const total = core.size * core.size;
        if (snap.values.length !== total || snap.locked.length !== total || snap.slotLocked.length !== core.slots.length) {
            return null;
        }
        core.values = snap.values.slice();
        core.known = (Array.isArray(snap.known) ? snap.known.slice() : new Array(total).fill(false));
        core.locked = snap.locked.slice();
        core.slotLocked = snap.slotLocked.slice();
        core.mistakes = snap.mistakes || 0;
        core.hintsUsed = snap.hintsUsed || 0;
        core.streak = snap.streak || 0;
        core.bestStreak = snap.bestStreak || 0;
        core.score = snap.score || 0;
        core.selected = snap.selected >= 0 && snap.selected < total ? snap.selected : -1;
        core.activeSlot = snap.activeSlot >= 0 && snap.activeSlot < core.slots.length ? snap.activeSlot : -1;
        core.status = snap.status === 'won' ? 'won' : 'playing';
        return core;
    }
}
