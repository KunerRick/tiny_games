/**
 * 纸牌接龙 — 场景编排：布局渲染、触摸输入、HUD、存档。
 *
 * 坐标约定：
 *   - 设计坐标：720 × 1280，原点在**左上角**，y 向下（与 SolitaireConfig 一致）
 *   - 节点坐标：Board 锚点 (0.5, 0.5)，尺寸 720 × 1280，原点在中心
 *
 * 事件全部挂在 Board（共同父级）上，按钮用 Node.EventType.TOUCH_END + 命名方法（红线 3 / 5）。
 */

import {
    _decorator,
    Color,
    Component,
    EventTouch,
    Game,
    Graphics,
    Label,
    Node,
    UITransform,
    Vec3,
    game,
} from 'cc';
import {
    CARD_H,
    CARD_W,
    COLUMN_TOP_Y,
    COLOR_BG,
    COLOR_HIGHLIGHT,
    COLOR_SLOT_STROKE,
    COLOR_TABLE,
    DESIGN_H,
    DESIGN_W,
    FOUNDATION_COLS,
    HINT_COOLDOWN_SEC,
    HINT_SEC,
    SAVE_THROTTLE_SEC,
    STOCK_COL,
    TAP_SLOP,
    TOP_ROW_Y,
    WASTE_COL,
    colLeftX,
} from './SolitaireConfig';
import {
    PILE_FOUNDATION_BASE,
    PILE_WASTE,
    SolitaireCore,
    SUITS,
    isTableau,
} from './SolitaireCore';
import {
    Placement,
    buildLayout,
    cardKey,
    designToLocal,
    draggedRun,
    hitStock,
    hitTest,
    indexLayout,
    resolveDropTarget,
} from './SolitaireLayout';
import { SolitaireCard } from './SolitaireCard';
import { StorageManager } from '../../../common/managers/StorageManager';

const { ccclass, property } = _decorator;

const GAME_ID = 'solitaire';

interface DragState {
    from: number;
    count: number;
    keys: string[];
    /** 被拖牌段最上面那张的原始左上角 */
    originLeft: number;
    originTop: number;
    /** 触点相对顶牌左上角的偏移 */
    grabDx: number;
    grabDy: number;
    /** 当前顶牌左上角 */
    left: number;
    top: number;
    originTouchX: number;
    originTouchY: number;
    dragging: boolean;
    targetPile: number;
}

interface Settings {
    drawCount: 1 | 3;
    autoAce: boolean;
    vibrate: boolean;
}

interface Stats {
    played: number;
    won: number;
    bestTime: number;
    bestMoves: number;
    bestScore: number;
    streak: number;
    bestStreak: number;
}

@ccclass('SolitaireGame')
export class SolitaireGame extends Component {
    // ==================== 场景绑定 ====================

    @property({ type: Node, tooltip: '牌桌（事件挂载点，尺寸 720×1280，锚点 0.5' })
    boardNode: Node | null = null;

    @property({ type: Node, tooltip: '背景层（Graphics）' })
    bgLayer: Node | null = null;

    @property({ type: Node, tooltip: '卡牌层（52 张牌动态创建）' })
    cardLayer: Node | null = null;

    @property({ type: Node, tooltip: '拖拽层（最上层）' })
    dragLayer: Node | null = null;

    @property({ type: Node, tooltip: '特效层（Graphics）' })
    fxLayer: Node | null = null;

    @property({ type: Label })
    titleLabel: Label | null = null;

    @property({ type: Label })
    modeLabel: Label | null = null;

    @property({ type: Label })
    scoreLabel: Label | null = null;

    @property({ type: Label })
    timeLabel: Label | null = null;

    @property({ type: Label })
    movesLabel: Label | null = null;

    @property({ type: Node })
    newGameBtn: Node | null = null;

    @property({ type: Node })
    undoBtn: Node | null = null;

    @property({ type: Node })
    hintBtn: Node | null = null;

    @property({ type: Node })
    menuBtn: Node | null = null;

    @property({ type: Node })
    collectBtn: Node | null = null;

    @property({ type: Node })
    winPanel: Node | null = null;

    @property({ type: Label })
    winStatsLabel: Label | null = null;

    @property({ type: Node })
    winNewBtn: Node | null = null;

    @property({ type: Node })
    menuPanel: Node | null = null;

    @property({ type: Node })
    menuCloseBtn: Node | null = null;

    @property({ type: Node })
    drawModeBtn: Node | null = null;

    @property({ type: Label })
    drawModeLabel: Label | null = null;

    @property({ type: Node })
    vibrateBtn: Node | null = null;

    @property({ type: Label })
    vibrateLabel: Label | null = null;

    @property({ type: Node })
    autoAceBtn: Node | null = null;

    @property({ type: Label })
    autoAceLabel: Label | null = null;

    @property({ type: Label })
    menuStatsLabel: Label | null = null;

    // ==================== 运行时状态 ====================

    private _core: SolitaireCore = new SolitaireCore();
    private _views: Map<string, SolitaireCard> = new Map();
    private _layout: Placement[] = [];
    private _layoutByKey: Map<string, Placement> = new Map();

    private _boardUT: UITransform | null = null;
    private _bg: Graphics | null = null;
    private _fx: Graphics | null = null;

    private _elapsed = 0;
    private _running = false;
    private _won = false;
    private _menuOpen = false;

    private _hudTick = 0;
    private _lastScore = -1;
    private _lastMoves = -1;
    private _lastTime = -1;

    private _dirtySave = false;
    private _sinceSave = 0;

    private _drag: DragState | null = null;
    private _touchId = -1;

    private _hintUntil = 0;
    private _hintCooldownUntil = 0;
    private _hintPile = -1;
    private _hintTo = -1;
    private _hintCount = 0;

    private _confirmNewUntil = 0;
    private _toastUntil = 0;
    private _toastText = '';

    private _settings: Settings = { drawCount: 1, autoAce: true, vibrate: true };
    private _stats: Stats = { played: 0, won: 0, bestTime: 0, bestMoves: 0, bestScore: 0, streak: 0, bestStreak: 0 };

    // ==================== 生命周期 ====================

    onLoad(): void {
        this._boardUT = this.boardNode ? this.boardNode.getComponent(UITransform) : null;
        this._bg = this.bgLayer ? (this.bgLayer.getComponent(Graphics) || this.bgLayer.addComponent(Graphics)) : null;
        this._fx = this.fxLayer ? (this.fxLayer.getComponent(Graphics) || this.fxLayer.addComponent(Graphics)) : null;

        this._loadSettings();
        this._loadStats();
        this._createCardViews();
        this._drawBackground();
        this._bindEvents();
        this._restoreOrDeal();

        if (this.titleLabel) this.titleLabel.string = '纸牌接龙';
        this._refreshModeLabel();
        this._refreshHud(true);
        this._refreshMenuLabels();

        this._running = !this._won;
        game.on(Game.EVENT_HIDE, this._onAppHide, this);
        game.on(Game.EVENT_SHOW, this._onAppShow, this);
    }

    start(): void {
        // 面板类必须在 show 时绑定/刷新，未激活节点 onLoad 不执行（防崩溃守则 6）
        if (this.winPanel) this.winPanel.active = false;
        if (this.menuPanel) this.menuPanel.active = false;
        if (this.collectBtn) this.collectBtn.active = false;
    }

    update(dt: number): void {
        if (this._running && !this._menuOpen && !this._won) {
            this._elapsed += dt;
        }

        this._hudTick += dt;
        if (this._hudTick >= 1) {
            this._hudTick = 0;
            this._refreshHud(false);
        }

        if (this._dirtySave) {
            this._sinceSave += dt;
            if (this._sinceSave >= SAVE_THROTTLE_SEC) this._saveNow();
        }

        this._expireTimers();
    }

    onDestroy(): void {
        this._unbindEvents();
        game.off(Game.EVENT_HIDE, this._onAppHide, this);
        game.off(Game.EVENT_SHOW, this._onAppShow, this);
        // 只清 JS 引用，不访问任何 @property(Node)（红线 4）
        this._views.clear();
        this._layout = [];
        this._layoutByKey.clear();
        this._drag = null;
        this._boardUT = null;
        this._bg = null;
        this._fx = null;
    }

    // ==================== 初始化 ====================

    private _createCardViews(): void {
        if (!this.cardLayer) return;
        for (const suit of SUITS) {
            for (let rank = 1; rank <= 13; rank++) {
                const view = SolitaireCard.create(this.cardLayer);
                view.setCard(null);
                this._views.set(`${suit}${rank}`, view);
            }
        }
    }

    private _restoreOrDeal(): void {
        const raw = StorageManager.instance.getItem(GAME_ID, 'save');
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                const core = SolitaireCore.fromSave(parsed);
                if (core && !core.isWon()) {
                    this._core = core;
                    this._elapsed = typeof parsed.elapsed === 'number' ? Math.max(0, parsed.elapsed) : 0;
                    this._won = core.isWon();
                    this._render(false);
                    return;
                }
            } catch (err) {
                // 存档损坏直接新开一局，不向玩家报错
            }
        }
        this._startNewGame(false);
    }

    private _startNewGame(countAsPlayed = true): void {
        const seed = ((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
        this._core.deal(seed, this._settings.drawCount);
        this._elapsed = 0;
        this._running = true;
        this._won = false;
        this._menuOpen = false;
        this._hintUntil = 0;
        this._hintPile = -1;
        this._hintTo = -1;
        this._drag = null;
        this._clearFx();

        if (this.winPanel) this.winPanel.active = false;
        if (this.menuPanel) this.menuPanel.active = false;
        if (this.collectBtn) this.collectBtn.active = false;

        if (countAsPlayed) {
            this._stats.played += 1;
            this._saveStats();
        }

        this._render(false);
        this._refreshHud(true);
        this._refreshModeLabel();
        this._refreshMenuLabels();
        this._markDirty();
    }

    // ==================== 事件绑定 ====================

    private _bindEvents(): void {
        if (this.boardNode) {
            this.boardNode.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
            this.boardNode.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
            this.boardNode.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
            this.boardNode.on(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
        }
        this._bindTap(this.newGameBtn, this._onNewGameClicked);
        this._bindTap(this.undoBtn, this._onUndoClicked);
        this._bindTap(this.hintBtn, this._onHintClicked);
        this._bindTap(this.menuBtn, this._onMenuClicked);
        this._bindTap(this.collectBtn, this._onCollectClicked);
        this._bindTap(this.winNewBtn, this._onNewGameClicked);
        this._bindTap(this.menuCloseBtn, this._onMenuCloseClicked);
        this._bindTap(this.drawModeBtn, this._onDrawModeClicked);
        this._bindTap(this.vibrateBtn, this._onVibrateClicked);
        this._bindTap(this.autoAceBtn, this._onAutoAceClicked);
    }

    private _unbindEvents(): void {
        if (this.boardNode) {
            this.boardNode.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
            this.boardNode.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
            this.boardNode.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
            this.boardNode.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
        }
        this._unbindTap(this.newGameBtn, this._onNewGameClicked);
        this._unbindTap(this.undoBtn, this._onUndoClicked);
        this._unbindTap(this.hintBtn, this._onHintClicked);
        this._unbindTap(this.menuBtn, this._onMenuClicked);
        this._unbindTap(this.collectBtn, this._onCollectClicked);
        this._unbindTap(this.winNewBtn, this._onNewGameClicked);
        this._unbindTap(this.menuCloseBtn, this._onMenuCloseClicked);
        this._unbindTap(this.drawModeBtn, this._onDrawModeClicked);
        this._unbindTap(this.vibrateBtn, this._onVibrateClicked);
        this._unbindTap(this.autoAceBtn, this._onAutoAceClicked);
    }

    private _bindTap(node: Node | null, handler: () => void): void {
        if (!node) return;
        node.on(Node.EventType.TOUCH_END, handler, this);
    }

    private _unbindTap(node: Node | null, handler: () => void): void {
        if (!node) return;
        node.off(Node.EventType.TOUCH_END, handler, this);
    }

    // ==================== 布局与渲染 ====================

    private _render(animated: boolean): void {
        const placements = buildLayout(this._core.state);
        this._layout = placements;
        this._layoutByKey = indexLayout(placements);

        for (let z = 0; z < placements.length; z++) {
            const place = placements[z];
            const view = this._views.get(place.key);
            if (!view) continue;

            view.setCard(place.card);
            if (view.node.parent !== this.cardLayer) {
                view.node.setParent(this.cardLayer as Node, true);
            }
            const local = this._designToLocal(place.left, place.top);
            if (animated) view.moveTo(local.x, local.y, 0.1);
            else view.placeAt(local.x, local.y);
            view.node.setSiblingIndex(z);
            view.resetVisual();
        }

        if (this.collectBtn) this.collectBtn.active = this._running && this._core.canAutoCollect();
    }

    private _designToLocal(left: number, top: number): { x: number; y: number } {
        return designToLocal(left, top);
    }

    private _drawBackground(): void {
        const g = this._bg;
        if (!g) return;
        g.clear();

        g.fillColor = this._hex(COLOR_BG);
        g.rect(-DESIGN_W / 2, -DESIGN_H / 2, DESIGN_W, DESIGN_H);
        g.fill();

        g.fillColor = this._hex(COLOR_TABLE);
        g.roundRect(-DESIGN_W / 2 + 8, -DESIGN_H / 2, DESIGN_W - 16, DESIGN_H, 0);
        g.fill();

        // 上排便位：牌堆 / 废牌堆 / 4 个收牌区
        this._strokeSlot(g, colLeftX(STOCK_COL), TOP_ROW_Y);
        this._strokeSlot(g, colLeftX(WASTE_COL), TOP_ROW_Y);
        for (let f = 0; f < 4; f++) this._strokeSlot(g, colLeftX(FOUNDATION_COLS[f]), TOP_ROW_Y);

        // 7 列空位
        for (let p = 0; p < 7; p++) this._strokeSlot(g, colLeftX(p), COLUMN_TOP_Y);
    }

    private _strokeSlot(g: Graphics, left: number, top: number): void {
        const local = this._designToLocal(left, top);
        g.lineWidth = 2;
        g.strokeColor = this._hex(COLOR_SLOT_STROKE);
        g.roundRect(local.x - CARD_W / 2, local.y - CARD_H / 2, CARD_W, CARD_H, 10);
        g.stroke();
    }

    private _hex(color: string): Color {
        const c = new Color();
        c.fromHEX(color);
        return c;
    }

    // ==================== 触摸输入 ====================

    private _designPoint(event: EventTouch): { x: number; y: number } {
        const ui = event.getUILocation();
        if (!this._boardUT) return { x: ui.x, y: ui.y };
        const local = this._boardUT.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        return { x: local.x + DESIGN_W / 2, y: DESIGN_H / 2 - local.y };
    }

    private _onTouchStart(event: EventTouch): void {
        if (!this._running || this._won || this._menuOpen) return;
        if (this._drag) return; // 多指：忽略第二根手指
        this._touchId = event.getID();

        const point = this._designPoint(event);
        if (hitStock(point.x, point.y)) {
            this._drag = {
                from: -2, // 牌堆点击
                count: 0,
                keys: [],
                originLeft: 0,
                originTop: 0,
                grabDx: 0,
                grabDy: 0,
                left: 0,
                top: 0,
                originTouchX: point.x,
                originTouchY: point.y,
                dragging: false,
                targetPile: -1,
            };
            return;
        }

        const hit = hitTest(this._layoutByKey, this._core.state, point.x, point.y);
        if (!hit) return;

        const run = draggedRun(this._core, hit.pile, hit.index);
        if (!run) return;

        const count = run.count;
        const keys: string[] = [];
        if (isTableau(hit.pile)) {
            const cards = this._core.pileCards(hit.pile);
            for (let i = run.startIndex; i < cards.length; i++) keys.push(cardKey(cards[i]));
        } else {
            keys.push(hit.key);
        }

        const topPlace = this._layoutByKey.get(keys[keys.length - 1]);
        if (!topPlace) return;

        this._drag = {
            from: hit.pile,
            count,
            keys,
            originLeft: topPlace.left,
            originTop: topPlace.top,
            grabDx: point.x - topPlace.left,
            grabDy: point.y - topPlace.top,
            left: topPlace.left,
            top: topPlace.top,
            originTouchX: point.x,
            originTouchY: point.y,
            dragging: false,
            targetPile: -1,
        };
    }

    private _onTouchMove(event: EventTouch): void {
        const drag = this._drag;
        if (!drag || drag.from === -2) return;
        if (this._touchId !== -1 && event.getID() !== this._touchId) return;

        const point = this._designPoint(event);

        if (!drag.dragging) {
            const dx = point.x - drag.originTouchX;
            const dy = point.y - drag.originTouchY;
            if (dx * dx + dy * dy < TAP_SLOP * TAP_SLOP) return;
            this._beginDrag(drag);
        }

        drag.left = point.x - drag.grabDx;
        drag.top = point.y - drag.grabDy;
        this._moveDragViews(drag);

        const target = this._resolveDropTarget(drag);
        if (target !== drag.targetPile) {
            drag.targetPile = target;
            this._drawDropHighlight(drag, target);
        }
    }

    private _onTouchEnd(event: EventTouch): void {
        this._finishTouch(event, true);
    }

    /**
     * 桌面浏览器拖拽结束时派发的是 TOUCH_CANCEL 而非 TOUCH_END（教训 D），
     * 因此 CANCEL 也必须走同一套落点判定，否则拖拽永远不会生效。
     */
    private _onTouchCancel(event: EventTouch): void {
        this._finishTouch(event, false);
    }

    private _finishTouch(event: EventTouch, allowStockDraw: boolean): void {
        if (this._touchId !== -1 && event.getID() !== this._touchId) return;
        this._touchId = -1;

        const drag = this._drag;
        this._drag = null;
        if (!drag) return;

        if (drag.from === -2) {
            if (allowStockDraw) this._doDraw();
            return;
        }

        if (!drag.dragging) {
            if (allowStockDraw) this._doTap(drag.from, this._core.pileSize(drag.from) - drag.count);
            else this._render(false);
            return;
        }

        const target = this._resolveDropTarget(drag);
        let moved = false;
        if (target >= 0) {
            moved = !!this._core.move(drag.from, target, drag.count);
        }

        // 拖了个空、且几乎落回起点 → 当作一次点击（教训 D：轻触不能被静默吃掉）。
        // 只有抓的是堆顶（count === 1）才转点击，抓中间段不该顺手移动顶牌。
        if (!moved && drag.count === 1) {
            const dist = Math.abs(drag.left - drag.originLeft) + Math.abs(drag.top - drag.originTop);
            if (dist <= TAP_SLOP * 1.5) moved = !!this._core.tapPile(drag.from);
        }

        this._endDragVisual(drag);
        if (moved) {
            this._vibrate();
            this._afterAction();
        } else {
            this._render(false);
        }
    }

    private _beginDrag(drag: DragState): void {
        drag.dragging = true;
        const layer = this.dragLayer || this.cardLayer;
        if (!layer) return;
        for (const key of drag.keys) {
            const view = this._views.get(key);
            if (!view) continue;
            view.node.setParent(layer, true);
            view.setLifted(true);
        }
    }

    private _moveDragViews(drag: DragState): void {
        const deltaX = drag.left - drag.originLeft;
        const deltaY = drag.top - drag.originTop;
        for (let i = 0; i < drag.keys.length; i++) {
            const key = drag.keys[i];
            const view = this._views.get(key);
            const place = this._layoutByKey.get(key);
            if (!view || !place) continue;
            const local = this._designToLocal(place.left + deltaX, place.top + deltaY);
            view.placeAt(local.x, local.y);
        }
    }

    private _endDragVisual(drag: DragState): void {
        if (!this.cardLayer) return;
        for (const key of drag.keys) {
            const view = this._views.get(key);
            if (!view) continue;
            view.setLifted(false);
            view.node.setParent(this.cardLayer, true);
        }
        this._clearFx();
    }

    private _resolveDropTarget(drag: DragState): number {
        return resolveDropTarget(this._core, drag.from, drag.count, drag.left, drag.top);
    }

    private _doDraw(): void {
        if (this._core.draw()) {
            this._vibrate();
            this._afterAction();
        }
    }

    private _doTap(pile: number, tappedIndex: number): void {
        if (pile < 0) return;
        // 只有点堆顶才自动移动；点段中间不做任何事（避免“点 Q 却移走 K”）
        if (tappedIndex !== this._core.pileSize(pile) - 1) {
            this._render(false);
            return;
        }
        if (this._core.tapPile(pile)) {
            this._vibrate();
            this._afterAction();
        } else {
            this._render(false);
        }
    }

    /** 一次成功操作后的统一收尾 */
    private _afterAction(): void {
        this._autoSendAces();
        this._render(true);
        this._refreshHud(true);
        this._markDirty();
        if (this._core.isWon()) this._onWin();
    }

    /** 自动收 A（设置项）：只收点数 1，永远没有留在场上的理由 */
    private _autoSendAces(): void {
        if (!this._settings.autoAce) return;
        for (let guard = 0; guard < 8; guard++) {
            let sent = false;
            for (let p = 0; p < 7; p++) {
                const top = this._core.topOf(p);
                if (!top || top.rank !== 1) continue;
                for (let f = 0; f < 4; f++) {
                    const to = PILE_FOUNDATION_BASE + f;
                    if (this._core.isLegalMove(p, to, 1)) {
                        this._core.move(p, to, 1);
                        sent = true;
                        break;
                    }
                }
                if (sent) break;
            }
            if (!sent) break;
        }
        const wasteTop = this._core.topOf(PILE_WASTE);
        if (wasteTop && wasteTop.rank === 1) {
            for (let f = 0; f < 4; f++) {
                const to = PILE_FOUNDATION_BASE + f;
                if (this._core.isLegalMove(PILE_WASTE, to, 1)) {
                    this._core.move(PILE_WASTE, to, 1);
                    break;
                }
            }
        }
    }

    // ==================== 提示 ====================

    private _onHintClicked(): void {
        const now = Date.now() / 1000;
        if (now < this._hintCooldownUntil) return;
        this._hintCooldownUntil = now + HINT_COOLDOWN_SEC;

        const hint = this._core.hint();
        if (!hint) {
            this._toast('没有可走的牌了，试试撤销或新开一局', 2.5);
            return;
        }
        if (hint.kind === 'draw') {
            this._hintPile = -1;
            this._hintTo = -1;
            this._hintUntil = now + HINT_SEC;
            this._drawFxSlot(colLeftX(STOCK_COL), TOP_ROW_Y);
            return;
        }

        this._hintPile = hint.from;
        this._hintTo = hint.to;
        this._hintCount = hint.count;
        this._hintUntil = now + HINT_SEC;
        this._drawHint(hint.from, hint.to, hint.count);
    }

    private _drawHint(from: number, to: number, count: number): void {
        this._clearFx();
        const g = this._fx;
        if (!g) return;

        if (from >= 0) {
            const cards = this._core.pileCards(from);
            const start = Math.max(0, cards.length - count);
            for (let i = start; i < cards.length; i++) {
                const place = this._layoutByKey.get(cardKey(cards[i]));
                if (!place) continue;
                this._drawFxRect(place.left, place.top, 3);
            }
        }

        if (to >= 0) {
            const destCards = this._core.pileCards(to);
            if (destCards.length > 0) {
                const place = this._layoutByKey.get(cardKey(destCards[destCards.length - 1]));
                if (place) this._drawFxRect(place.left, place.top, 3);
            } else if (to === PILE_WASTE) {
                this._drawFxSlot(colLeftX(WASTE_COL), TOP_ROW_Y);
            } else if (to < 7) {
                this._drawFxSlot(colLeftX(to), COLUMN_TOP_Y);
            } else {
                const f = to - PILE_FOUNDATION_BASE;
                this._drawFxSlot(colLeftX(FOUNDATION_COLS[f]), TOP_ROW_Y);
            }
        }
    }

    private _drawDropHighlight(drag: DragState, target: number): void {
        this._clearFx();
        if (target < 0) return;
        const destCards = this._core.pileCards(target);
        if (destCards.length > 0) {
            const place = this._layoutByKey.get(cardKey(destCards[destCards.length - 1]));
            if (place) this._drawFxRect(place.left, place.top, 3);
            return;
        }
        if (target < 7) this._drawFxSlot(colLeftX(target), COLUMN_TOP_Y);
        else if (target === PILE_WASTE) this._drawFxSlot(colLeftX(WASTE_COL), TOP_ROW_Y);
        else this._drawFxSlot(colLeftX(FOUNDATION_COLS[target - PILE_FOUNDATION_BASE]), TOP_ROW_Y);
    }

    private _drawFxRect(left: number, top: number, width: number): void {
        const g = this._fx;
        if (!g) return;
        const local = this._designToLocal(left, top);
        g.lineWidth = width;
        g.strokeColor = this._hex(COLOR_HIGHLIGHT);
        g.roundRect(local.x - CARD_W / 2, local.y - CARD_H / 2, CARD_W, CARD_H, 10);
        g.stroke();
    }

    private _drawFxSlot(left: number, top: number): void {
        this._drawFxRect(left, top, 2);
    }

    private _clearFx(): void {
        if (this._fx) this._fx.clear();
    }

    // ==================== 按钮回调 ====================

    private _onNewGameClicked(): void {
        const now = Date.now() / 1000;
        if (this._core.state.moves > 0 && !this._won && now >= this._confirmNewUntil) {
            this._confirmNewUntil = now + 2.5;
            this._toast('再点一次确认新局', 2.5);
            return;
        }
        this._confirmNewUntil = 0;
        this._startNewGame(true);
    }

    private _onUndoClicked(): void {
        if (!this._core.undo()) return;
        this._won = false;
        this._running = true;
        if (this.winPanel) this.winPanel.active = false;
        this._hintUntil = 0;
        this._clearFx();
        this._render(true);
        this._refreshHud(true);
        this._markDirty();
    }

    private _onCollectClicked(): void {
        if (this._core.autoCollect() <= 0) return;
        this._vibrate();
        this._render(true);
        this._refreshHud(true);
        this._markDirty();
        if (this._core.isWon()) this._onWin();
    }

    private _onMenuClicked(): void {
        this._menuOpen = !this._menuOpen;
        if (this.menuPanel) this.menuPanel.active = this._menuOpen;
        this._refreshMenuLabels();
    }

    private _onMenuCloseClicked(): void {
        this._menuOpen = false;
        if (this.menuPanel) this.menuPanel.active = false;
    }

    private _onDrawModeClicked(): void {
        this._settings.drawCount = this._settings.drawCount === 1 ? 3 : 1;
        this._saveSettings();
        this._refreshMenuLabels();
        this._refreshModeLabel();
        this._toast('新局生效', 1.5);
    }

    private _onVibrateClicked(): void {
        this._settings.vibrate = !this._settings.vibrate;
        this._saveSettings();
        this._refreshMenuLabels();
    }

    private _onAutoAceClicked(): void {
        this._settings.autoAce = !this._settings.autoAce;
        this._saveSettings();
        this._refreshMenuLabels();
    }

    // ==================== 胜利 ====================

    private _onWin(): void {
        if (this._won) return;
        this._won = true;
        this._running = false;
        this._clearFx();

        this._stats.won += 1;
        this._stats.streak += 1;
        this._stats.bestStreak = Math.max(this._stats.bestStreak, this._stats.streak);
        const time = Math.floor(this._elapsed);
        const moves = this._core.state.moves;
        const score = this._core.state.score;
        if (this._stats.bestTime === 0 || time < this._stats.bestTime) this._stats.bestTime = time;
        if (this._stats.bestMoves === 0 || moves < this._stats.bestMoves) this._stats.bestMoves = moves;
        if (score > this._stats.bestScore) this._stats.bestScore = score;
        this._saveStats();

        if (this.winStatsLabel) {
            this.winStatsLabel.string =
                `用时 ${this._formatTime(time)}   步数 ${moves}   分数 ${score}`;
        }
        if (this.winPanel) this.winPanel.active = true;
        this._vibrate();
        this._saveNow();
    }

    // ==================== HUD ====================

    private _refreshHud(force: boolean): void {
        const score = this._core.state.score;
        const moves = this._core.state.moves;
        const time = Math.floor(this._elapsed);

        if (this.scoreLabel && (force || score !== this._lastScore)) {
            this.scoreLabel.string = `${score}`;
            this._lastScore = score;
        }
        if (this.movesLabel && (force || moves !== this._lastMoves)) {
            this.movesLabel.string = `${moves}`;
            this._lastMoves = moves;
        }
        if (this.timeLabel && (force || time !== this._lastTime)) {
            this.timeLabel.string = this._formatTime(time);
            this._lastTime = time;
        }
        if (this.collectBtn) {
            this.collectBtn.active = this._running && !this._won && this._core.canAutoCollect();
        }
    }

    private _refreshModeLabel(): void {
        if (this.modeLabel) {
            this.modeLabel.string = this._settings.drawCount === 1 ? '抽 1 张' : '抽 3 张';
        }
    }

    private _refreshMenuLabels(): void {
        if (this.drawModeLabel) {
            this.drawModeLabel.string = `抽牌：${this._settings.drawCount === 1 ? '抽 1 张' : '抽 3 张'}`;
        }
        if (this.vibrateLabel) {
            this.vibrateLabel.string = `震动：${this._settings.vibrate ? '开' : '关'}`;
        }
        if (this.autoAceLabel) {
            this.autoAceLabel.string = `自动收 A：${this._settings.autoAce ? '开' : '关'}`;
        }
        if (this.menuStatsLabel) {
            const s = this._stats;
            const rate = s.played > 0 ? Math.round((s.won / s.played) * 100) : 0;
            this.menuStatsLabel.string =
                `胜局 ${s.won} / ${s.played}（${rate}%）\n` +
                `最长连胜 ${s.bestStreak}\n` +
                `最快 ${s.bestTime > 0 ? this._formatTime(s.bestTime) : '—'}\n` +
                `最少步数 ${s.bestMoves > 0 ? s.bestMoves : '—'}`;
        }
    }

    private _formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    private _toast(text: string, duration: number): void {
        this._toastText = text;
        this._toastUntil = Date.now() / 1000 + duration;
        if (this.modeLabel) this.modeLabel.string = text;
    }

    private _expireTimers(): void {
        const now = Date.now() / 1000;
        if (this._hintUntil > 0 && now >= this._hintUntil) {
            this._hintUntil = 0;
            this._clearFx();
        }
        if (this._toastUntil > 0 && now >= this._toastUntil) {
            this._toastUntil = 0;
            this._toastText = '';
            this._refreshModeLabel();
        }
    }

    // ==================== 存档 ====================

    private _markDirty(): void {
        this._dirtySave = true;
        this._sinceSave = 0;
    }

    private _saveNow(): void {
        this._dirtySave = false;
        this._sinceSave = 0;
        try {
            const data = this._core.serialize() as any;
            data.elapsed = Math.floor(this._elapsed);
            StorageManager.instance.setItem(GAME_ID, 'save', JSON.stringify(data));
        } catch (err) {
            // 存档失败不影响游戏
        }
    }

    private _loadSettings(): void {
        const raw = StorageManager.instance.getItem(GAME_ID, 'settings');
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            this._settings.drawCount = parsed.drawCount === 3 ? 3 : 1;
            this._settings.autoAce = parsed.autoAce !== false;
            this._settings.vibrate = parsed.vibrate !== false;
        } catch (err) {
            // 忽略损坏设置
        }
    }

    private _saveSettings(): void {
        try {
            StorageManager.instance.setItem(GAME_ID, 'settings', JSON.stringify(this._settings));
        } catch (err) {
            // 忽略
        }
    }

    private _loadStats(): void {
        const raw = StorageManager.instance.getItem(GAME_ID, 'stats');
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            this._stats = {
                played: Number(parsed.played) || 0,
                won: Number(parsed.won) || 0,
                bestTime: Number(parsed.bestTime) || 0,
                bestMoves: Number(parsed.bestMoves) || 0,
                bestScore: Number(parsed.bestScore) || 0,
                streak: Number(parsed.streak) || 0,
                bestStreak: Number(parsed.bestStreak) || 0,
            };
        } catch (err) {
            // 忽略
        }
    }

    private _saveStats(): void {
        try {
            StorageManager.instance.setItem(GAME_ID, 'stats', JSON.stringify(this._stats));
        } catch (err) {
            // 忽略
        }
    }

    private _onAppHide(): void {
        this._saveNow();
    }

    private _onAppShow(): void {
        // 回到前台不重置计时，避免玩家被“偷时间”
    }

    // ==================== 其他 ====================

    private _vibrate(): void {
        if (!this._settings.vibrate) return;
        const g: any = globalThis as any;
        if (g.wx && typeof g.wx.vibrateShort === 'function') {
            try {
                g.wx.vibrateShort({ type: 'light' });
            } catch (err) {
                // 忽略
            }
        }
    }
}
