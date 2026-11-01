/**
 * 纸牌接龙 — 纯规则核心。
 *
 * 本文件**不得 import cc**，以便在 Node 侧直接编译运行自检（tools/verify-solitaire-core.js）。
 *
 * 数组约定：
 *   - 每个牌堆的数组顺序是「底 → 顶」，末尾元素是最上面那张（可操作的牌）
 *   - stock[0] 是下一张要抽的牌
 *   - 牌对象视为不可变：翻面时替换为新对象，撤销快照因此只需浅拷贝数组
 */

import {
    SCORE_FLIP,
    SCORE_FOUNDATION_TO_TABLEAU,
    SCORE_RECYCLE,
    SCORE_TO_FOUNDATION,
    SCORE_WASTE_TO_TABLEAU,
    UNDO_LIMIT,
    SAVE_VERSION,
} from './SolitaireConfig';

// ==================== 牌 ====================

export type Suit = 'S' | 'H' | 'C' | 'D';
export type DrawCount = 1 | 3;

export const SUITS: Suit[] = ['S', 'H', 'C', 'D'];

export interface Card {
    suit: Suit;
    rank: number; // 1–13（A=1，J=11，Q=12，K=13）
    faceUp: boolean;
}

export function isRed(suit: Suit): boolean {
    return suit === 'H' || suit === 'D';
}

// ==================== 牌堆编号 ====================

/** 0–6 列为牌桌列；7 为废牌堆；8–11 为收牌区 */
export const PILE_WASTE = 7;
export const PILE_FOUNDATION_BASE = 8;
export const PILE_MAX = 11;

export function isTableau(pile: number): boolean {
    return pile >= 0 && pile <= 6;
}

export function isFoundation(pile: number): boolean {
    return pile >= PILE_FOUNDATION_BASE && pile <= PILE_MAX;
}

// ==================== 状态 ====================

export interface CoreState {
    stock: Card[];
    waste: Card[];
    foundations: Card[][];
    tableau: Card[][];
    score: number;
    moves: number;
    seed: number;
    drawCount: DrawCount;
    recycles: number;
}

export interface MoveResult {
    ok: boolean;
    from: number;
    to: number;
    count: number;
    scoreDelta: number;
    flipped: boolean;
}

export interface LegalMove {
    from: number;
    to: number;
    count: number;
    /** 1 收牌区 / 2 废牌进收牌区 / 3 能翻牌 / 4 能腾空列 / 5 常规列移动 / 6 废牌进列 */
    priority: number;
    flips: boolean;
    empties: boolean;
}

export interface Hint {
    kind: 'move' | 'draw';
    /** 抽牌时为 -1 */
    from: number;
    to: number;
    count: number;
    priority: number;
}

// ==================== 存档格式 ====================

interface SaveCard {
    s: Suit;
    r: number;
    u?: boolean;
}

export interface SaveData {
    v: number;
    seed: number;
    drawCount: DrawCount;
    score: number;
    moves: number;
    recycles: number;
    stock: SaveCard[];
    waste: SaveCard[];
    foundations: SaveCard[][];
    tableau: SaveCard[][];
}

// ==================== 随机与洗牌 ====================

/** 标准 mulberry32：同种子必得同序列 */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function (): number {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle<T>(arr: T[], rng: () => number): void {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
}

/** 52 张牌，点数与花色齐全，全部背面 */
export function createDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
        for (let rank = 1; rank <= 13; rank++) {
            deck.push({ suit, rank, faceUp: false });
        }
    }
    return deck;
}

function emptyState(seed: number, drawCount: DrawCount): CoreState {
    return {
        stock: [],
        waste: [],
        foundations: [[], [], [], []],
        tableau: [[], [], [], [], [], [], []],
        score: 0,
        moves: 0,
        seed,
        drawCount,
        recycles: 0,
    };
}

// ==================== 核心 ====================

export class SolitaireCore {
    state: CoreState;

    private _undo: CoreState[] = [];

    constructor(state?: CoreState) {
        this.state = state || emptyState(0, 1);
    }

    // ==================== 发牌 ====================

    deal(seed: number, drawCount: DrawCount): void {
        const deck = createDeck();
        shuffle(deck, mulberry32(seed));

        const state = emptyState(seed >>> 0, drawCount);
        let index = 0;

        // 第 p 列发 p+1 张，最后一张翻正面
        for (let p = 0; p < 7; p++) {
            for (let k = 0; k <= p; k++) {
                const card = deck[index++];
                state.tableau[p].push({ suit: card.suit, rank: card.rank, faceUp: k === p });
            }
        }

        // 剩余 24 张进牌堆，顺序即抽牌顺序
        while (index < deck.length) {
            const card = deck[index++];
            state.stock.push({ suit: card.suit, rank: card.rank, faceUp: false });
        }

        this.state = state;
        this._undo = [];
    }

    // ==================== 查询 ====================

    pileSize(pile: number): number {
        const cards = this._cards(pile);
        return cards ? cards.length : 0;
    }

    /** 只读访问；调用方不得修改返回数组 */
    pileCards(pile: number): Card[] {
        return this._cards(pile) || [];
    }

    topOf(pile: number): Card | null {
        const cards = this._cards(pile);
        if (!cards || cards.length === 0) return null;
        return cards[cards.length - 1];
    }

    /**
     * 该牌堆从顶往下能整段移动的张数。
     * 列：必须是连续（降 1 + 异色）且全部正面的序列；废牌堆 / 收牌区恒为 1。
     */
    movableRun(pile: number): number {
        if (isTableau(pile)) {
            const cards = this.state.tableau[pile];
            const n = cards.length;
            if (n === 0 || !cards[n - 1].faceUp) return 0;

            let start = n - 1;
            while (start > 0) {
                const upper = cards[start - 1];
                const lower = cards[start];
                if (!upper.faceUp) break;
                if (upper.rank !== lower.rank + 1) break;
                if (isRed(upper.suit) === isRed(lower.suit)) break;
                start--;
            }
            return n - start;
        }
        if (pile === PILE_WASTE) return this.state.waste.length > 0 ? 1 : 0;
        if (isFoundation(pile)) {
            return this.state.foundations[pile - PILE_FOUNDATION_BASE].length > 0 ? 1 : 0;
        }
        return 0;
    }

    canDraw(): boolean {
        return this.state.stock.length > 0 || this.state.waste.length > 0;
    }

    canUndo(): boolean {
        return this._undo.length > 0;
    }

    isWon(): boolean {
        for (const pile of this.state.foundations) {
            if (pile.length !== 13) return false;
        }
        return true;
    }

    // ==================== 合法性 ====================

    /**
     * 唯一规则入口。count 省略时取 movableRun(from)。
     */
    isLegalMove(from: number, to: number, count?: number): boolean {
        if (from === to) return false;
        if (!(isTableau(from) || from === PILE_WASTE || isFoundation(from))) return false;
        if (!(isTableau(to) || isFoundation(to))) return false;
        // 收牌区之间互搬没有意义（空槽会把 A 吸过去）
        if (isFoundation(from) && isFoundation(to)) return false;

        const src = this._cards(from);
        if (!src || src.length === 0) return false;

        const n = count === undefined ? this.movableRun(from) : count;
        if (!Number.isInteger(n) || n < 1 || n > src.length) return false;

        // 被移动的段必须整体可移动（后缀天然可移动，故只需 ≤ 最大可移动长度）
        if (n > this.movableRun(from)) return false;

        const head = src[src.length - n];

        if (isTableau(to)) {
            const dst = this.state.tableau[to];
            // 把整列搬到另一个空列属于无意义操作
            if (dst.length === 0 && isTableau(from) && n === src.length) return false;
            if (dst.length === 0) return head.rank === 13;
            const top = dst[dst.length - 1];
            if (!top.faceUp) return false;
            return head.rank === top.rank - 1 && isRed(head.suit) !== isRed(top.suit);
        }

        // 收牌区：只能单张，A 起，同花色升序
        if (n !== 1) return false;
        const foundation = this.state.foundations[to - PILE_FOUNDATION_BASE];
        if (foundation.length === 0) return head.rank === 1;
        const top = foundation[foundation.length - 1];
        return top.suit === head.suit && head.rank === top.rank + 1;
    }

    // ==================== 操作 ====================

    /** 抽牌；牌堆空时自动重洗。返回是否发生了变化 */
    draw(): boolean {
        if (this.state.stock.length === 0) return this.recycle();

        const snapshot = this._snapshot();
        const n = Math.min(this.state.drawCount, this.state.stock.length);
        for (let i = 0; i < n; i++) {
            const card = this.state.stock.shift() as Card;
            this.state.waste.push({ suit: card.suit, rank: card.rank, faceUp: true });
        }
        this.state.moves += 1;
        this._pushUndo(snapshot);
        return true;
    }

    /** 废牌堆整体翻回牌堆（顺序不反转，见设计文档 §2.3） */
    recycle(): boolean {
        if (this.state.stock.length > 0 || this.state.waste.length === 0) return false;

        const snapshot = this._snapshot();
        this.state.stock = this.state.waste.map(c => ({ suit: c.suit, rank: c.rank, faceUp: false }));
        this.state.waste = [];
        this.state.recycles += 1;
        if (this.state.drawCount === 3) {
            this.state.score = Math.max(0, this.state.score + SCORE_RECYCLE);
        }
        this.state.moves += 1;
        this._pushUndo(snapshot);
        return true;
    }

    /** 提交一次移动；非法返回 null。count 省略时取 movableRun(from) */
    move(from: number, to: number, count?: number): MoveResult | null {
        if (!this.isLegalMove(from, to, count)) return null;

        const n = count === undefined ? this.movableRun(from) : count;
        const snapshot = this._snapshot();
        const result = this._applyMove(from, to, n);
        this.state.moves += 1;
        this._pushUndo(snapshot);
        return { ok: true, from, to, count: n, scoreDelta: result.scoreDelta, flipped: result.flipped };
    }

    /**
     * 点击自动移动（列顶 / 废牌堆顶）。
     * 优先级：本花色收牌区 → 非空列 → 空列（仅 K）。找不到返回 null。
     */
    tapPile(pile: number): MoveResult | null {
        if (pile === PILE_WASTE) {
            if (this.state.waste.length === 0) return null;
        } else if (!isTableau(pile)) {
            return null;
        } else if (this.state.tableau[pile].length === 0) {
            return null;
        }

        const card = this.topOf(pile);
        if (!card || !card.faceUp) return null;

        for (let f = 0; f < 4; f++) {
            const to = PILE_FOUNDATION_BASE + f;
            if (this.isLegalMove(pile, to, 1)) return this.move(pile, to, 1);
        }
        for (let t = 0; t < 7; t++) {
            if (t === pile) continue;
            if (this.state.tableau[t].length === 0) continue;
            if (this.isLegalMove(pile, t, 1)) return this.move(pile, t, 1);
        }
        if (card.rank === 13) {
            for (let t = 0; t < 7; t++) {
                if (t === pile) continue;
                if (this.state.tableau[t].length !== 0) continue;
                if (this.isLegalMove(pile, t, 1)) return this.move(pile, t, 1);
            }
        }
        return null;
    }

    undo(): boolean {
        const previous = this._undo.pop();
        if (!previous) return false;
        this.state = previous;
        return true;
    }

    // ==================== 提示 ====================

    legalMoves(): LegalMove[] {
        const moves: LegalMove[] = [];

        for (let p = 0; p < 7; p++) {
            const cards = this.state.tableau[p];
            const n = cards.length;
            if (n === 0) continue;
            const run = this.movableRun(p);
            if (run === 0) continue;

            for (let f = 0; f < 4; f++) {
                const to = PILE_FOUNDATION_BASE + f;
                if (this.isLegalMove(p, to, 1)) {
                    moves.push(this._legalMove(p, to, 1, 1));
                }
            }

            for (let start = n - run; start < n; start++) {
                const count = n - start;
                const flips = start > 0 && !cards[start - 1].faceUp;
                const empties = count === n;
                const priority = flips ? 3 : empties ? 4 : 5;
                for (let t = 0; t < 7; t++) {
                    if (t === p) continue;
                    if (!this.isLegalMove(p, t, count)) continue;
                    moves.push(this._legalMove(p, t, count, priority));
                }
            }
        }

        if (this.state.waste.length > 0) {
            for (let f = 0; f < 4; f++) {
                const to = PILE_FOUNDATION_BASE + f;
                if (this.isLegalMove(PILE_WASTE, to, 1)) {
                    moves.push(this._legalMove(PILE_WASTE, to, 1, 2));
                }
            }
            for (let t = 0; t < 7; t++) {
                if (this.isLegalMove(PILE_WASTE, t, 1)) {
                    moves.push(this._legalMove(PILE_WASTE, t, 1, 6));
                }
            }
        }

        return moves;
    }

    hint(): Hint | null {
        const moves = this.legalMoves();
        if (moves.length > 0) {
            moves.sort((a, b) =>
                a.priority - b.priority ||
                a.from - b.from ||
                a.to - b.to ||
                a.count - b.count,
            );
            const best = moves[0];
            return { kind: 'move', from: best.from, to: best.to, count: best.count, priority: best.priority };
        }
        if (this.canDraw()) {
            return { kind: 'draw', from: -1, to: PILE_WASTE, count: 1, priority: 7 };
        }
        return null;
    }

    // ==================== 一键收牌 ====================

    /** 牌堆与废牌堆为空、场上无背面牌时才允许 */
    canAutoCollect(): boolean {
        if (this.state.stock.length !== 0 || this.state.waste.length !== 0) return false;
        for (const column of this.state.tableau) {
            for (const card of column) {
                if (!card.faceUp) return false;
            }
        }
        return !this.isWon();
    }

    /**
     * 自动收 A（规则附庸）：把裸露的 A 送进收牌区，返回送了几张。
     *
     * 与 autoCollect 的关键区别：这里**不计步、不压撤销栈**。
     * 它总是在某次玩家操作之后被调用，撤销时应当跟着那次操作一起回滚；
     * 若单独压栈，玩家按一次「撤销」只会看到 A 飞回来、自己刚做的动作还在（实测踩到）。
     */
    sendAces(): number {
        let sent = 0;

        for (let guard = 0; guard < 8; guard++) {
            let moved = false;
            for (let p = 0; p < 7; p++) {
                const top = this.topOf(p);
                if (!top || top.rank !== 1) continue;
                for (let f = 0; f < 4; f++) {
                    const to = PILE_FOUNDATION_BASE + f;
                    if (!this.isLegalMove(p, to, 1)) continue;
                    this._applyMove(p, to, 1);
                    sent++;
                    moved = true;
                    break;
                }
                if (moved) break;
            }
            if (!moved) break;
        }

        const wasteTop = this.topOf(PILE_WASTE);
        if (wasteTop && wasteTop.rank === 1) {
            for (let f = 0; f < 4; f++) {
                const to = PILE_FOUNDATION_BASE + f;
                if (!this.isLegalMove(PILE_WASTE, to, 1)) continue;
                this._applyMove(PILE_WASTE, to, 1);
                sent++;
                break;
            }
        }

        return sent;
    }

    /** 按点数从小到大把剩余牌收进收牌区；返回收了几张 */
    autoCollect(): number {
        if (!this.canAutoCollect()) return 0;

        const snapshot = this._snapshot();
        let moved = 0;

        for (let guard = 0; guard < 52; guard++) {
            let bestFrom = -1;
            let bestTo = -1;
            let bestRank = 99;

            for (let p = 0; p < 7; p++) {
                const cards = this.state.tableau[p];
                if (cards.length === 0) continue;
                const card = cards[cards.length - 1];
                if (card.rank >= bestRank) continue;
                for (let f = 0; f < 4; f++) {
                    const to = PILE_FOUNDATION_BASE + f;
                    if (!this.isLegalMove(p, to, 1)) continue;
                    bestFrom = p;
                    bestTo = to;
                    bestRank = card.rank;
                    break;
                }
            }

            if (bestFrom < 0) break;
            this._applyMove(bestFrom, bestTo, 1);
            moved++;
        }

        if (moved > 0) {
            this.state.moves += 1;
            this._pushUndo(snapshot);
        }
        return moved;
    }

    // ==================== 存档 ====================

    serialize(): SaveData {
        const encode = (card: Card): SaveCard => {
            const out: SaveCard = { s: card.suit, r: card.rank };
            if (card.faceUp) out.u = true;
            return out;
        };
        return {
            v: SAVE_VERSION,
            seed: this.state.seed,
            drawCount: this.state.drawCount,
            score: this.state.score,
            moves: this.state.moves,
            recycles: this.state.recycles,
            stock: this.state.stock.map(encode),
            waste: this.state.waste.map(encode),
            foundations: this.state.foundations.map(pile => pile.map(encode)),
            tableau: this.state.tableau.map(pile => pile.map(encode)),
        };
    }

    /** 解析存档；任何结构问题都返回 null（调用方据此新开一局） */
    static fromSave(raw: unknown): SolitaireCore | null {
        if (!raw || typeof raw !== 'object') return null;
        const data = raw as SaveData;
        if (data.v !== SAVE_VERSION) return null;
        if (data.drawCount !== 1 && data.drawCount !== 3) return null;

        const stock = parsePile(data.stock);
        const waste = parsePile(data.waste);
        if (!stock || !waste) return null;

        if (!Array.isArray(data.foundations) || data.foundations.length !== 4) return null;
        if (!Array.isArray(data.tableau) || data.tableau.length !== 7) return null;

        const foundations: Card[][] = [];
        for (const pile of data.foundations) {
            const parsed = parsePile(pile);
            if (!parsed) return null;
            foundations.push(parsed.map(c => ({ suit: c.suit, rank: c.rank, faceUp: true })));
        }

        const tableau: Card[][] = [];
        for (const pile of data.tableau) {
            const parsed = parsePile(pile);
            if (!parsed) return null;
            tableau.push(parsed);
        }

        const all = stock.concat(waste, ...foundations, ...tableau);
        if (all.length !== 52) return null;
        const unique = new Set(all.map(c => `${c.suit}${c.rank}`));
        if (unique.size !== 52) return null;

        const state: CoreState = {
            stock: stock.map(c => ({ suit: c.suit, rank: c.rank, faceUp: false })),
            waste: waste.map(c => ({ suit: c.suit, rank: c.rank, faceUp: true })),
            foundations,
            tableau,
            score: toScore(data.score),
            moves: toScore(data.moves),
            seed: toScore(data.seed),
            drawCount: data.drawCount,
            recycles: toScore(data.recycles),
        };
        return new SolitaireCore(state);
    }

    // ==================== 调试 ====================

    /** 用于测试的确定性状态指纹 */
    stateHash(): string {
        const encode = (cards: Card[]): string =>
            cards.map(c => `${c.suit}${c.rank}${c.faceUp ? 'u' : 'd'}`).join(',');
        return [
            encode(this.state.stock),
            encode(this.state.waste),
            ...this.state.foundations.map(encode),
            ...this.state.tableau.map(encode),
            this.state.score,
            this.state.moves,
            this.state.recycles,
        ].join('|');
    }

    // ==================== 内部 ====================

    private _cards(pile: number): Card[] | null {
        if (isTableau(pile)) return this.state.tableau[pile];
        if (pile === PILE_WASTE) return this.state.waste;
        if (isFoundation(pile)) return this.state.foundations[pile - PILE_FOUNDATION_BASE];
        return null;
    }

    /** 只移动牌 + 翻牌 + 计分，不碰 moves / 撤销 */
    private _applyMove(from: number, to: number, count: number): { scoreDelta: number; flipped: boolean } {
        const src = this._cards(from) as Card[];
        const dst = this._cards(to) as Card[];

        const moved = src.splice(src.length - count, count);
        for (const card of moved) dst.push(card);

        let scoreDelta = 0;
        let flipped = false;

        if (isTableau(from) && src.length > 0) {
            const top = src[src.length - 1];
            if (!top.faceUp) {
                src[src.length - 1] = { suit: top.suit, rank: top.rank, faceUp: true };
                flipped = true;
                scoreDelta += SCORE_FLIP;
            }
        }

        if (isFoundation(to)) {
            scoreDelta += SCORE_TO_FOUNDATION;
        } else if (from === PILE_WASTE) {
            scoreDelta += SCORE_WASTE_TO_TABLEAU;
        } else if (isFoundation(from)) {
            scoreDelta += SCORE_FOUNDATION_TO_TABLEAU;
        }

        this.state.score = Math.max(0, this.state.score + scoreDelta);
        return { scoreDelta, flipped };
    }

    private _legalMove(from: number, to: number, count: number, priority: number): LegalMove {
        return {
            from,
            to,
            count,
            priority,
            flips: isTableau(from) && this._cards(from)!.length > count &&
                !this._cards(from)![this._cards(from)!.length - count - 1].faceUp,
            empties: isTableau(from) && this._cards(from)!.length === count,
        };
    }

    private _snapshot(): CoreState {
        return {
            stock: this.state.stock.slice(),
            waste: this.state.waste.slice(),
            foundations: this.state.foundations.map(pile => pile.slice()),
            tableau: this.state.tableau.map(pile => pile.slice()),
            score: this.state.score,
            moves: this.state.moves,
            seed: this.state.seed,
            drawCount: this.state.drawCount,
            recycles: this.state.recycles,
        };
    }

    private _pushUndo(snapshot: CoreState): void {
        this._undo.push(snapshot);
        while (this._undo.length > UNDO_LIMIT) this._undo.shift();
    }
}

// ==================== 存档解析辅助 ====================

function parsePile(raw: unknown): Card[] | null {
    if (!Array.isArray(raw)) return null;
    const out: Card[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') return null;
        const c = item as SaveCard;
        if (SUITS.indexOf(c.s) < 0) return null;
        if (!Number.isInteger(c.r) || c.r < 1 || c.r > 13) return null;
        out.push({ suit: c.s, rank: c.r, faceUp: c.u === true });
    }
    return out;
}

function toScore(value: unknown): number {
    return typeof value === 'number' && isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
