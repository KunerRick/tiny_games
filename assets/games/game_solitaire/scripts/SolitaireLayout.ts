/**
 * 纸牌接龙 — 布局与交互几何（纯逻辑，不依赖 cc）。
 *
 * 与 SolitaireCore 的分工：
 *   Core 只管「哪张牌在哪、能不能走」，本文件管「画在哪、点到谁、落到哪」。
 *   这样扇形间距、命中判定、落点判定都能在 Node 侧直接回归（tools/verify-solitaire-core.js）。
 *
 * 坐标：设计坐标 720 × 1280，原点左上，y 向下。
 */

import {
    CARD_H,
    CARD_W,
    COL_STEP,
    COLUMN_BOTTOM_Y,
    COLUMN_TOP_Y,
    DESIGN_H,
    DESIGN_W,
    DROP_COLUMN_PAD_TOP,
    DROP_FOUNDATION_PAD,
    FAN_DOWN,
    FAN_UP,
    FAN_UP_MIN,
    FOUNDATION_COLS,
    STOCK_COL,
    STOCK_THICKNESS,
    TOP_ROW_Y,
    WASTE_COL,
    WASTE_FAN,
    colCenterX,
    colLeftX,
} from './SolitaireConfig';
import {
    Card,
    CoreState,
    PILE_FOUNDATION_BASE,
    PILE_WASTE,
    SolitaireCore,
    isTableau,
} from './SolitaireCore';

export interface Placement {
    card: Card;
    key: string;
    left: number;
    top: number;
    pile: number;
    index: number;
}

export interface DragRun {
    startIndex: number;
    count: number;
}

function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

export function cardKey(card: Card): string {
    return `${card.suit}${card.rank}`;
}

/** 一列里正面牌的露出高度；超长列自动压缩到 FAN_UP_MIN */
export function fanGap(cards: Card[]): number {
    let up = 0;
    let down = 0;
    for (const card of cards) {
        if (card.faceUp) up++;
        else down++;
    }
    if (up <= 1) return FAN_UP;
    const available = COLUMN_BOTTOM_Y - COLUMN_TOP_Y;
    const gap = Math.floor((available - CARD_H - FAN_DOWN * down) / (up - 1));
    return clamp(gap, FAN_UP_MIN, FAN_UP);
}

/** 生成当前状态的全部 52 张牌位置；顺序即绘制顺序（后面的在上层） */
export function buildLayout(state: CoreState): Placement[] {
    const placements: Placement[] = [];

    const stockLeft = colLeftX(STOCK_COL);
    for (let i = 0; i < state.stock.length; i++) {
        const card = state.stock[i];
        placements.push({
            card,
            key: cardKey(card),
            left: stockLeft + Math.min(i, 4) * STOCK_THICKNESS,
            top: TOP_ROW_Y,
            pile: -1,
            index: i,
        });
    }

    const wasteLeft = colLeftX(WASTE_COL);
    const wasteStart = Math.max(0, state.waste.length - 3);
    for (let i = wasteStart; i < state.waste.length; i++) {
        const card = state.waste[i];
        placements.push({
            card,
            key: cardKey(card),
            left: wasteLeft + (i - wasteStart) * WASTE_FAN,
            top: TOP_ROW_Y,
            pile: PILE_WASTE,
            index: i,
        });
    }

    for (let f = 0; f < 4; f++) {
        const left = colLeftX(FOUNDATION_COLS[f]);
        const pile = state.foundations[f];
        for (let i = 0; i < pile.length; i++) {
            const card = pile[i];
            placements.push({
                card,
                key: cardKey(card),
                left,
                top: TOP_ROW_Y,
                pile: PILE_FOUNDATION_BASE + f,
                index: i,
            });
        }
    }

    for (let p = 0; p < 7; p++) {
        const cards = state.tableau[p];
        const gap = fanGap(cards);
        let y = COLUMN_TOP_Y;
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            placements.push({
                card,
                key: cardKey(card),
                left: colLeftX(p),
                top: y,
                pile: p,
                index: i,
            });
            y += card.faceUp ? gap : FAN_DOWN;
        }
    }

    return placements;
}

export function indexLayout(placements: Placement[]): Map<string, Placement> {
    const map = new Map<string, Placement>();
    for (const place of placements) map.set(place.key, place);
    return map;
}

/** 牌左上角（设计坐标）→ 卡牌节点局部坐标（Board 锚点 0.5、尺寸 720×1280） */
export function designToLocal(left: number, top: number): { x: number; y: number } {
    return {
        x: left + CARD_W / 2 - DESIGN_W / 2,
        y: DESIGN_H / 2 - (top + CARD_H / 2),
    };
}

/** 局部坐标 → 牌左上角（设计坐标），用于探针与测试 */
export function localToDesign(x: number, y: number): { left: number; top: number } {
    return {
        left: x - CARD_W / 2 + DESIGN_W / 2,
        top: DESIGN_H / 2 - CARD_H / 2 - y,
    };
}

export function hitStock(x: number, y: number): boolean {
    const left = colLeftX(STOCK_COL);
    return x >= left && x <= left + CARD_W && y >= TOP_ROW_Y && y <= TOP_ROW_Y + CARD_H;
}

function contains(place: Placement, x: number, y: number): boolean {
    return x >= place.left && x <= place.left + CARD_W &&
        y >= place.top && y <= place.top + CARD_H;
}

/**
 * 命中判定：返回点到的牌（同一列重叠时取视觉最上面那张）。
 * 背面牌返回 null —— 背面不可操作。
 */
export function hitTest(
    layout: Map<string, Placement>,
    state: CoreState,
    x: number,
    y: number,
): Placement | null {
    for (let p = 0; p < 7; p++) {
        const cards = state.tableau[p];
        for (let i = cards.length - 1; i >= 0; i--) {
            const place = layout.get(cardKey(cards[i]));
            if (!place || !contains(place, x, y)) continue;
            if (!cards[i].faceUp) return null;
            return place;
        }
    }

    const waste = state.waste;
    if (waste.length > 0) {
        const top = waste[waste.length - 1];
        const place = layout.get(cardKey(top));
        if (place && contains(place, x, y)) return place;
    }

    for (let f = 0; f < 4; f++) {
        const foundation = state.foundations[f];
        if (foundation.length === 0) continue;
        const top = foundation[foundation.length - 1];
        const place = layout.get(cardKey(top));
        if (place && contains(place, x, y)) return place;
    }

    return null;
}

/**
 * 从被点中的牌算可拖动的整段。
 * 点在段内任意一张上，拖的是「这张 + 它下面的牌」（真实接龙手感），
 * 所以 startIndex 就是点中的 index；点在不合法段上返回 null。
 */
export function draggedRun(core: SolitaireCore, pile: number, tappedIndex: number): DragRun | null {
    const size = core.pileSize(pile);
    if (size <= 0 || tappedIndex < 0 || tappedIndex >= size) return null;

    if (!isTableau(pile)) {
        const top = size - 1;
        return tappedIndex === top ? { startIndex: top, count: 1 } : null;
    }

    const run = core.movableRun(pile);
    if (run <= 0) return null;

    const runStart = size - run;
    if (tappedIndex < runStart) return null;
    return { startIndex: tappedIndex, count: size - tappedIndex };
}

/** 横向最近的列（用于落点判定） */
export function nearestColumn(centerX: number): number {
    let best = 0;
    let bestDist = Number.MAX_VALUE;
    for (let p = 0; p < 7; p++) {
        const dist = Math.abs(centerX - colCenterX(p));
        if (dist < bestDist) {
            bestDist = dist;
            best = p;
        }
    }
    return best;
}

/**
 * 落点判定：返回合法目标堆编号，没有则 -1。
 * left/top 是**被拖牌段最上面那张**的左上角（设计坐标），不是手指位置。
 */
export function resolveDropTarget(
    core: SolitaireCore,
    from: number,
    count: number,
    left: number,
    top: number,
): number {
    for (let f = 0; f < 4; f++) {
        const slotLeft = colLeftX(FOUNDATION_COLS[f]);
        const slotTop = TOP_ROW_Y;
        const overlapX = left < slotLeft + CARD_W + DROP_FOUNDATION_PAD &&
            left + CARD_W > slotLeft - DROP_FOUNDATION_PAD;
        const overlapY = top < slotTop + CARD_H + DROP_FOUNDATION_PAD &&
            top + CARD_H > slotTop - DROP_FOUNDATION_PAD;
        if (!overlapX || !overlapY) continue;
        const to = PILE_FOUNDATION_BASE + f;
        if (core.isLegalMove(from, to, count)) return to;
    }

    const centerY = top + CARD_H / 2;
    if (centerY < COLUMN_TOP_Y - DROP_COLUMN_PAD_TOP) return -1;

    const centerX = left + CARD_W / 2;
    const column = nearestColumn(centerX);
    const dist = Math.abs(centerX - colCenterX(column));
    if (dist > COL_STEP) return -1;
    if (column === from) return -1;
    return core.isLegalMove(from, column, count) ? column : -1;
}
