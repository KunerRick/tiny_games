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
    HorizontalTextAlignment,
    Label,
    Node,
    UITransform,
    Vec3,
    VerticalTextAlignment,
    game,
    instantiate,
} from 'cc';
import {
    CARD_H,
    CARD_W,
    COLUMN_TOP_Y,
    COLOR_BG,
    COLOR_HIGHLIGHT,
    COLOR_SLOT_STROKE,
    COLOR_TABLE,
    COLOR_TEXT_PRIMARY,
    COLOR_TEXT_SECONDARY,
    DESIGN_H,
    DESIGN_W,
    FOUNDATION_COLS,
    HINT_COOLDOWN_SEC,
    HINT_SEC,
    MAX_RECYCLES,
    SAVE_THROTTLE_SEC,
    STOCK_COL,
    TAP_SLOP,
    TOP_ROW_Y,
    WASTE_COL,
    colLeftX,
} from './SolitaireConfig';
import {
    Card,
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

/** 新手引导正文：只讲「怎么赢 + 怎么操作」，不讲计分细则 */
const HELP_TEXT =
    '目标：把 52 张牌按花色，从 A 到 K 依次收进右上角的四个收牌区。\n'
    + '\n'
    + '· 落牌规则：红黑交替、点数递减（红桃 7 只能放在黑桃 8 或梅花 8 上）。\n'
    + '· 空列只能放 K。\n'
    + '· 点左上角的牌堆发牌。牌堆空了会把废牌堆翻回去重洗；经典规则可无限重洗，想提高难度可在设置里开「限 3 次」。\n'
    + '· 拖动可以把一整段牌搬走；点一下牌顶，会自动找能放的位置。\n'
    + '· 不知道走哪张就点「提示」，高亮会圈出这一步的起点和落点。';

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
    /** true = 挑战模式（每局最多 3 次重洗）；默认经典（无限重洗） */
    limitRedeal: boolean;
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
    /** 当前提示的类型；用于每帧重绘呼吸式高亮（'move' | 'draw' | null） */
    private _hintKind: 'move' | 'draw' | null = null;
    private _hintPulseAt = 0;
    private _hintPhase = 0;

    /** 玩法说明面板：首次进入自动弹出，顶栏「?」可再次打开 */
    private _helpPanel: Node | null = null;
    private _helpOpen = false;
    private _helpBtn: Node | null = null;
    /** 顶栏「重洗 N/3」：把次数上限摆在明面上 */
    private _redealLabel: Label | null = null;
    /** 设置里的「重洗规则」按钮（运行时克隆抽牌按钮生成，不改场景） */
    private _redealBtn: Node | null = null;
    private _redealModeLabel: Label | null = null;
    /** 牌堆角标：剩余张数 / 重洗状态，避免「牌堆永远抽不完」的错觉 */
    private _stockBadge: Node | null = null;
    private _stockBadgeLabel: Label | null = null;

    private _confirmNewUntil = 0;
    private _toastUntil = 0;
    private _toastText = '';
    /** 浮层提示条：顶栏那一行放不下「提示：把 梅花3 拖到 红桃4 上」这种长句 */
    private _toastBanner: Node | null = null;
    private _toastLabel: Label | null = null;

    private _settings: Settings = { drawCount: 1, autoAce: true, vibrate: true, limitRedeal: false };
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
        this._ensureRedealMenuRow();
        this._createHelpEntry();
        this._ensureStockBadge();
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
        this._showHelpOnFirstVisit();
    }

    update(dt: number): void {
        if (this._running && !this._menuOpen && !this._won && !this._helpOpen) {
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

        this._pulseHint(dt);
        this._expireTimers();
    }

    onDestroy(): void {
        // 不调 _unbindEvents()：场景销毁时子节点（按钮）先于组件被销毁，
        // 此时 @property(Node) 仍返回对象，但内部 _eventProcessor 已是 null，
        // Node.off 会抛 "Cannot read properties of null (reading 'off')"（红线 4）。
        // 节点连同其监听器一起被引擎回收，这里只解绑挂在全局 game 上的回调。
        game.off(Game.EVENT_HIDE, this._onAppHide, this);
        game.off(Game.EVENT_SHOW, this._onAppShow, this);
        // 只清 JS 引用，不访问任何 @property(Node)
        this._views.clear();
        this._layout = [];
        this._layoutByKey.clear();
        this._drag = null;
        this._boardUT = null;
        this._bg = null;
        this._fx = null;
        this._helpPanel = null;
        this._toastBanner = null;
        this._toastLabel = null;
        this._stockBadge = null;
        this._stockBadgeLabel = null;
        this._redealBtn = null;
        this._redealModeLabel = null;
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
        this._core.deal(seed, this._settings.drawCount, this._settings.limitRedeal);
        // 发牌后会直接送掉露在外面的 A（+10 分、翻牌 +5 分），
        // 这一步必须发生在刷新 HUD 之前 —— 否则分数标签要等下一秒轮询才跟上
        this._autoSendAces();
        this._elapsed = 0;
        this._running = true;
        this._won = false;
        this._menuOpen = false;
        this._hintUntil = 0;
        this._hintKind = null;
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

    private _bindTap(node: Node | null, handler: () => void): void {
        if (!node) return;
        node.on(Node.EventType.TOUCH_END, handler, this);
    }

    // ==================== 布局与渲染 ====================

    private _render(animated: boolean): void {
        const placements = buildLayout(this._core.state);
        this._layout = placements;
        this._layoutByKey = indexLayout(placements);

        const placed = new Set<string>();
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
            placed.add(place.key);
        }

        // 废牌堆只画最近几张：落在可视窗口外的牌必须显式隐藏，
        // 否则它们会停在最后一次被摆放的位置，越抽越多、糊成一摞（抽 3 张时最明显）。
        this._views.forEach((view, key) => {
            if (!placed.has(key)) view.setCard(null);
        });

        if (this.collectBtn) this.collectBtn.active = this._running && this._core.canAutoCollect();
        this._refreshStockBadge();
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

    private _hexAlpha(color: string, alpha: number): Color {
        const c = this._hex(color);
        c.a = Math.max(0, Math.min(255, Math.round(alpha)));
        return c;
    }

    // ==================== 触摸输入 ====================

    private _designPoint(event: EventTouch): { x: number; y: number } {
        const ui = event.getUILocation();
        const ut = this._boardUT;
        // getUILocation() 是 UI 相机视图坐标（原点左下），不能直接喂给 convertToNodeSpaceAR
        // —— 那个接口要的是世界坐标，少掉半个屏会整体偏移 (DESIGN_W/2, DESIGN_H/2)。
        if (!ut) return { x: ui.x, y: DESIGN_H - ui.y };

        const parent = this.node.parent;
        const parentUT = parent ? parent.getComponent(UITransform) : null;
        let local: Vec3;
        if (parentUT) {
            const canvasLocal = new Vec3(
                ui.x - parentUT.width * parentUT.anchorX,
                ui.y - parentUT.height * parentUT.anchorY,
                0,
            );
            local = ut.convertToNodeSpaceAR(parentUT.convertToWorldSpaceAR(canvasLocal));
        } else {
            local = new Vec3(ui.x - DESIGN_W / 2, ui.y - DESIGN_H / 2, 0);
        }
        return { x: local.x + DESIGN_W / 2, y: DESIGN_H / 2 - local.y };
    }

    private _onTouchStart(event: EventTouch): void {
        if (!this._running || this._won || this._menuOpen || this._helpOpen) return;
        if (this._drag) return; // 多指：忽略第二根手指
        this._clearHint(); // 玩家开始操作，提示高亮让位给落点高亮
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
        if (this._helpOpen) return;

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
        let tapLike = false;
        if (!moved && drag.count === 1) {
            const dist = Math.abs(drag.left - drag.originLeft) + Math.abs(drag.top - drag.originTop);
            if (dist <= TAP_SLOP * 1.5) {
                tapLike = true;
                moved = !!this._core.tapPile(drag.from);
            }
        }

        this._endDragVisual(drag);
        if (moved) {
            this._vibrate();
            this._afterAction();
        } else {
            this._render(false);
            if (tapLike) this._shakePile(drag.from);
        }
    }

    /** 点了却无处可去：顶牌抖一下（F10），不改变任何状态 */
    private _shakePile(pile: number): void {
        const top = this._core.topOf(pile);
        if (!top) return;
        const view = this._views.get(cardKey(top));
        if (view) view.shake();
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
        const state = this._core.state;
        const wasStockEmpty = state.stock.length === 0;
        const hadWaste = state.waste.length > 0;

        if (this._core.draw()) {
            // 牌堆抽空后自动重洗时给一条明确反馈 —— 否则牌堆看起来「永远抽不完」
            if (wasStockEmpty && hadWaste) {
                this._toast(
                    this._core.isRecycleLimited()
                        ? `牌堆已重洗，本局还剩 ${this._core.recyclesLeft()} 次`
                        : '牌堆已重洗（经典规则：可无限重洗）',
                    1.8,
                );
            }
            this._vibrate();
            this._afterAction();
            return;
        }
        // 牌堆空 + 重洗次数用尽：必须给出明确反馈，否则玩家只觉得「点了没反应」
        if (state.stock.length === 0 && state.waste.length > 0) {
            this._toast(`牌堆已抽完（每局最多重洗 ${MAX_RECYCLES} 次），试试撤销或新开一局`, 2.5);
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
            this._shakePile(pile);
        }
    }

    /** 一次成功操作后的统一收尾 */
    private _afterAction(): void {
        this._autoSendAces();
        this._render(true);
        this._refreshHud(true);
        this._refreshModeLabel();
        this._markDirty();
        if (this._core.isWon()) this._onWin();
    }

    /**
     * 自动收 A（设置项）：只收点数 1，永远没有留在场上的理由。
     * 交给 core.sendAces() 执行 —— 不额外计步、不单独压撤销栈，
     * 撤销时跟触发它的那次操作一起回滚。
     */
    private _autoSendAces(): void {
        if (!this._settings.autoAce) return;
        this._core.sendAces();
    }

    // ==================== 提示 ====================

    private _onHintClicked(): void {
        const now = Date.now() / 1000;
        if (now < this._hintCooldownUntil) return;
        this._hintCooldownUntil = now + HINT_COOLDOWN_SEC;

        const hint = this._core.hint();
        if (!hint) {
            this._clearHint();
            const text = this._core.canDraw()
                ? `暂时没有可走的牌，点左上角牌堆抽 ${this._settings.drawCount} 张`
                : `重洗次数已用完（每局 ${MAX_RECYCLES} 次），试试撤销或新开一局`;
            this._toast(text, HINT_SEC);
            return;
        }

        this._hintKind = hint.kind === 'draw' ? 'draw' : 'move';
        this._hintPile = hint.from;
        this._hintTo = hint.to;
        this._hintCount = hint.count;
        this._hintUntil = now + HINT_SEC;
        this._hintPhase = 0;
        this._hintPulseAt = 0;
        this._drawActiveHint(4);
        this._toast(this._describeHint(hint.from, hint.to, hint.count, hint.kind === 'draw'), HINT_SEC);
    }

    /** 把一步棋讲成人话：只说「哪张牌 → 去哪」，不解释规则 */
    private _describeHint(from: number, to: number, count: number, isDraw: boolean): string {
        if (isDraw) return `提示：点左上角的牌堆抽 ${this._settings.drawCount} 张`;
        const cards = this._core.pileCards(from);
        const head = cards[cards.length - count];
        if (!head) return '提示：按高亮位置移动';
        const name = this._cardName(head);

        if (to === PILE_WASTE) return `提示：把 ${name} 拖到废牌堆`;
        if (to >= PILE_FOUNDATION_BASE) return `提示：把 ${name} 收进收牌区`;
        const dest = this._core.pileCards(to);
        if (dest.length === 0) return `提示：把 ${name} 拖到空列`;
        return `提示：把 ${name} 拖到 ${this._cardName(dest[dest.length - 1])} 上`;
    }

    private _cardName(card: Card): string {
        const suit = card.suit === 'S' ? '黑桃'
            : card.suit === 'H' ? '红桃'
            : card.suit === 'C' ? '梅花'
            : '方块';
        const rank = card.rank === 1 ? 'A'
            : card.rank === 11 ? 'J'
            : card.rank === 12 ? 'Q'
            : card.rank === 13 ? 'K'
            : String(card.rank);
        return `${suit}${rank}`;
    }

    /**
     * 提示高亮是「呼吸」的：每 50 ms 按正弦重绘一次线宽，
     * 静态 3px 细线在深色桌面上几乎看不见（上一版收到最多的反馈就是「提示无效」）。
     */
    private _pulseHint(dt: number): void {
        if (this._hintUntil <= 0 || this._hintKind === null) return;
        this._hintPulseAt += dt;
        if (this._hintPulseAt < 0.05) return;
        this._hintPulseAt = 0;
        this._hintPhase += 0.05;
        const width = 4 + 2.5 * (0.5 + 0.5 * Math.sin(this._hintPhase * 6));
        this._drawActiveHint(width);
    }

    private _drawActiveHint(width: number): void {
        if (this._hintKind === 'draw') {
            this._clearFx();
            this._drawFxSlot(colLeftX(STOCK_COL), TOP_ROW_Y, width, true);
            return;
        }
        if (this._hintKind === 'move') {
            this._drawHint(this._hintPile, this._hintTo, this._hintCount, width);
        }
    }

    private _drawHint(from: number, to: number, count: number, width: number = 4): void {
        this._clearFx();
        const g = this._fx;
        if (!g) return;

        if (from >= 0) {
            const cards = this._core.pileCards(from);
            const start = Math.max(0, cards.length - count);
            for (let i = start; i < cards.length; i++) {
                const place = this._layoutByKey.get(cardKey(cards[i]));
                if (!place) continue;
                // 来源牌只描边：填色会盖住牌面，玩家看不出提示的是哪张
                this._drawFxRect(place.left, place.top, width, false);
            }
        }

        if (to >= 0) {
            const destCards = this._core.pileCards(to);
            if (destCards.length > 0) {
                const place = this._layoutByKey.get(cardKey(destCards[destCards.length - 1]));
                if (place) this._drawFxRect(place.left, place.top, width, true);
            } else if (to === PILE_WASTE) {
                this._drawFxSlot(colLeftX(WASTE_COL), TOP_ROW_Y, width, true);
            } else if (to < 7) {
                this._drawFxSlot(colLeftX(to), COLUMN_TOP_Y, width, true);
            } else {
                const f = to - PILE_FOUNDATION_BASE;
                this._drawFxSlot(colLeftX(FOUNDATION_COLS[f]), TOP_ROW_Y, width, true);
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

    private _drawFxRect(left: number, top: number, width: number, fill: boolean = false): void {
        const g = this._fx;
        if (!g) return;
        const local = this._designToLocal(left, top);
        const x = local.x - CARD_W / 2;
        const y = local.y - CARD_H / 2;
        if (fill) {
            g.fillColor = this._hexAlpha(COLOR_HIGHLIGHT, 70);
            g.roundRect(x, y, CARD_W, CARD_H, 10);
            g.fill();
        }
        g.lineWidth = width;
        g.strokeColor = this._hex(COLOR_HIGHLIGHT);
        g.roundRect(x, y, CARD_W, CARD_H, 10);
        g.stroke();
    }

    private _drawFxSlot(left: number, top: number, width: number = 2, fill: boolean = false): void {
        this._drawFxRect(left, top, width, fill);
    }

    private _clearFx(): void {
        if (this._fx) this._fx.clear();
    }

    private _clearHint(): void {
        this._hintUntil = 0;
        this._hintKind = null;
        this._clearFx();
    }

    // ==================== 玩法说明（新手引导） ====================

    /**
     * 顶栏常驻入口：左侧「重洗 N/3」把上限摆在明面上，右侧「?」随时重看规则。
     * 两者都是运行时创建的 —— 场景是 MCP 维护的，这里只做「追加一个入口」，
     * 不动已有节点，避免再去同步 .scene。
     */
    private _createHelpEntry(): void {
        const topBar = this.boardNode ? this.boardNode.getChildByName('TopBar') : null;
        if (!topBar) return;

        if (!topBar.getChildByName('RedealLabel')) {
            const label = this._makeLabel(
                'RedealLabel', topBar, 120, 20, 170, 32,
                '重洗 ∞', 20, COLOR_TEXT_SECONDARY,
            );
            label.horizontalAlign = HorizontalTextAlignment.RIGHT;
            this._redealLabel = label;
        }

        if (!topBar.getChildByName('HelpBtn')) {
            // 40×40 贴右上角：60×60 时会压住「抽 1 张」右下角那一截，正好挡住字
            const btn = this._makeButton('HelpBtn', topBar, 330, -24, 40, 40, '?', 20, true);
            btn.on(Node.EventType.TOUCH_END, this._onHelpClicked, this);
            this._helpBtn = btn;
        }
    }

    /**
     * 牌堆角标。
     *
     * 之前牌堆永远画成同样厚的一叠、空了又立刻重洗，玩家会觉得「怎么抽都抽不完」。
     * 这里在牌堆右下角常驻一个数字：有牌显示剩余张数，抽空显示「重洗 N」，重洗次数用尽显示「抽完」。
     */
    private _ensureStockBadge(): void {
        const board = this.boardNode;
        if (!board || this._stockBadge) return;

        const node = new Node('StockBadge');
        node.layer = board.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(78, 28);

        const g = node.addComponent(Graphics);
        g.fillColor = this._hexAlpha('#000000', 190);
        g.roundRect(-39, -14, 78, 28, 12);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = this._hexAlpha(COLOR_HIGHLIGHT, 150);
        g.roundRect(-39, -14, 78, 28, 12);
        g.stroke();

        const label = this._makeLabel('StockBadgeLabel', node, 0, 0, 70, 24, '', 18, COLOR_TEXT_PRIMARY);
        board.addChild(node);
        node.setSiblingIndex(board.children.length - 1);

        const center = this._designToLocal(colLeftX(STOCK_COL), TOP_ROW_Y);
        node.setPosition(center.x + CARD_W / 2 - 26, center.y - CARD_H / 2 + 18, 0);

        this._stockBadge = node;
        this._stockBadgeLabel = label;
    }

    private _refreshStockBadge(): void {
        const node = this._stockBadge;
        if (!node || !node.isValid) return;

        const state = this._core.state;
        let text = '';
        if (state.stock.length > 0) {
            text = String(state.stock.length);
        } else if (this._core.canRecycle()) {
            text = this._core.isRecycleLimited() ? `重洗 ${this._core.recyclesLeft()}` : '重洗 ∞';
        } else if (state.waste.length > 0) {
            text = '抽完';
        }

        const show = text !== '';
        if (node.active !== show) node.active = show;
        if (show && this._stockBadgeLabel && this._stockBadgeLabel.string !== text) {
            this._stockBadgeLabel.string = text;
        }
    }

    private _makeLabel(
        name: string,
        parent: Node,
        x: number,
        y: number,
        w: number,
        h: number,
        text: string,
        size: number,
        color: string,
    ): Label {
        const node = new Node(name);
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = Math.round(size * 1.4);
        label.color = this._hex(color);
        label.horizontalAlign = HorizontalTextAlignment.CENTER;
        label.verticalAlign = VerticalTextAlignment.CENTER;
        parent.addChild(node);
        node.setPosition(x, y, 0);
        return label;
    }

    private _makeButton(
        name: string,
        parent: Node,
        x: number,
        y: number,
        w: number,
        h: number,
        text: string,
        size: number,
        round: boolean,
    ): Node {
        const node = new Node(name);
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);

        const g = node.addComponent(Graphics);
        const r = round ? Math.min(w, h) / 2 : 14;
        g.fillColor = this._hexAlpha(COLOR_SLOT_STROKE, 235);
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = this._hex(COLOR_HIGHLIGHT);
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.stroke();

        parent.addChild(node);
        node.setPosition(x, y, 0);
        this._makeLabel(`${name}Label`, node, 0, 0, w, h, text, size, COLOR_TEXT_PRIMARY);
        return node;
    }

    private _ensureHelpPanel(): Node | null {
        if (this._helpPanel && this._helpPanel.isValid) return this._helpPanel;
        const board = this.boardNode;
        if (!board) return null;

        const root = new Node('HelpPanel');
        root.layer = board.layer;
        root.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
        board.addChild(root);

        // 遮罩：点一下就关（同时挡住下层所有按钮，避免误触）
        const dim = new Node('Dim');
        dim.layer = board.layer;
        dim.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
        const dimG = dim.addComponent(Graphics);
        dimG.fillColor = this._hexAlpha('#000000', 200);
        dimG.rect(-DESIGN_W / 2, -DESIGN_H / 2, DESIGN_W, DESIGN_H);
        dimG.fill();
        root.addChild(dim);
        dim.on(Node.EventType.TOUCH_END, this._onHelpCloseClicked, this);

        const panel = new Node('Panel');
        panel.layer = board.layer;
        panel.addComponent(UITransform).setContentSize(620, 860);
        const pg = panel.addComponent(Graphics);
        pg.fillColor = this._hex(COLOR_TABLE);
        pg.roundRect(-310, -430, 620, 860, 24);
        pg.fill();
        pg.lineWidth = 3;
        pg.strokeColor = this._hex(COLOR_HIGHLIGHT);
        pg.roundRect(-310, -430, 620, 860, 24);
        pg.stroke();
        root.addChild(panel);

        this._makeLabel('HelpTitle', panel, 0, 358, 560, 52, '怎么玩', 36, COLOR_TEXT_PRIMARY);

        const body = this._makeLabel('HelpBody', panel, 0, 30, 540, 560, HELP_TEXT, 23, COLOR_TEXT_SECONDARY);
        body.overflow = Label.Overflow.CLAMP;
        body.horizontalAlign = HorizontalTextAlignment.LEFT;
        body.verticalAlign = VerticalTextAlignment.TOP;
        body.lineHeight = 42;

        const start = this._makeButton('StartBtn', panel, 0, -350, 320, 84, '开始游戏', 28, false);
        start.on(Node.EventType.TOUCH_END, this._onHelpCloseClicked, this);

        root.active = false;
        this._helpPanel = root;
        return root;
    }

    /** 首次进入自动弹一次规则（之后靠顶栏「?」） */
    private _showHelpOnFirstVisit(): void {
        if (StorageManager.instance.getItem(GAME_ID, 'helpShown') === '1') return;
        StorageManager.instance.setItem(GAME_ID, 'helpShown', '1');
        this._showHelp();
    }

    private _showHelp(): void {
        const panel = this._ensureHelpPanel();
        if (!panel) return;
        panel.active = true;
        panel.setSiblingIndex(panel.parent ? panel.parent.children.length - 1 : 0);
        this._helpOpen = true;
        this._drag = null;
        this._clearHint();
    }

    private _hideHelp(): void {
        this._helpOpen = false;
        if (this._helpPanel && this._helpPanel.isValid) this._helpPanel.active = false;
    }

    private _onHelpClicked(): void {
        this._showHelp();
    }

    private _onHelpCloseClicked(): void {
        this._hideHelp();
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
        this._refreshModeLabel();
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

    /** 重洗规则：经典（无限）/ 挑战（每局最多 3 次）。只对下一局生效 */
    private _onRedealModeClicked(): void {
        this._settings.limitRedeal = !this._settings.limitRedeal;
        this._saveSettings();
        this._refreshMenuLabels();
        this._toast(this._settings.limitRedeal ? '挑战模式：新局最多重洗 3 次' : '经典模式：新局可无限重洗', 1.8);
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
            this.scoreLabel.string = `分数 ${score}`;
            this._lastScore = score;
        }
        if (this.movesLabel && (force || moves !== this._lastMoves)) {
            this.movesLabel.string = `步数 ${moves}`;
            this._lastMoves = moves;
        }
        if (this.timeLabel && (force || time !== this._lastTime)) {
            this.timeLabel.string = `时间 ${this._formatTime(time)}`;
            this._lastTime = time;
        }
        if (this.collectBtn) {
            this.collectBtn.active = this._running && !this._won && this._core.canAutoCollect();
        }
    }

    private _refreshModeLabel(): void {
        // 提示语走独立浮层（_toastBanner），这一行永远只显示抽牌模式
        if (this.modeLabel) {
            this.modeLabel.string = this._settings.drawCount === 1 ? '抽 1 张' : '抽 3 张';
        }
        if (this._redealLabel && this._redealLabel.isValid) {
            this._redealLabel.string = this._core.isRecycleLimited()
                ? `重洗 ${this._core.recyclesLeft()}/${MAX_RECYCLES}`
                : '重洗 ∞';
        }
    }

    /**
     * 设置菜单里的「重洗规则」行：克隆「抽牌」按钮（同样的贴图与尺寸），
     * 插在它下面，并把后续几行整体下移一格 —— 不改 .scene，也不写死坐标。
     */
    private _ensureRedealMenuRow(): void {
        if (this._redealBtn || !this.drawModeBtn) return;
        const parent = this.drawModeBtn.parent;
        if (!parent) return;

        // 行距取自场景现有布局（抽牌 → 震动），场景调整后这里自动跟随
        const topY = this.drawModeBtn.position.y;
        const step = this.vibrateBtn && this.vibrateBtn.isValid
            ? Math.max(40, topY - this.vibrateBtn.position.y)
            : 80;

        this._shiftMenuRow(this.vibrateBtn, step);
        this._shiftMenuRow(this.autoAceBtn, step);
        this._shiftMenuRow(this.menuCloseBtn, step);
        if (this.menuStatsLabel) {
            const statsNode = this.menuStatsLabel.node;
            this._shiftMenuRow(statsNode, step);
            const ut = statsNode.getComponent(UITransform);
            if (ut && ut.height < 120) ut.setContentSize(ut.width, 120);
        }

        const node = instantiate(this.drawModeBtn);
        node.name = 'RedealBtn';
        node.setPosition(0, topY - step, 0);
        parent.addChild(node);

        const labelNode = node.getChildByName('Label');
        this._redealBtn = node;
        this._redealModeLabel = labelNode ? labelNode.getComponent(Label) : null;
        this._bindTap(node, this._onRedealModeClicked);
    }

    private _shiftMenuRow(node: Node | null, dy: number): void {
        if (!node || !node.isValid) return;
        const p = node.position;
        node.setPosition(p.x, p.y - dy, 0);
    }

    private _refreshMenuLabels(): void {
        if (this.drawModeLabel) {
            this.drawModeLabel.string = `抽牌：${this._settings.drawCount === 1 ? '抽 1 张' : '抽 3 张'}`;
        }
        if (this._redealModeLabel) {
            this._redealModeLabel.string = `重洗：${this._settings.limitRedeal ? '限 3 次' : '经典（无限）'}`;
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
        this._ensureToastBanner();
        if (this._toastBanner && this._toastBanner.isValid) {
            if (this._toastLabel && this._toastLabel.isValid) this._toastLabel.string = text;
            this._toastBanner.active = true;
        }
    }

    /**
     * 提示条浮在牌区底部（底栏上方）。
     * 之前借用顶栏的 ModeLabel，右侧只剩几十像素，「提示：把 梅花3 拖到 红桃4 上」
     * 会被「?」按钮压住、根本读不出来。
     */
    private _ensureToastBanner(): void {
        if (this._toastBanner && this._toastBanner.isValid) return;
        const parent = this.fxLayer;
        if (!parent) return;

        const w = 660;
        const h = 56;
        const node = new Node('ToastBanner');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);

        const g = node.addComponent(Graphics);
        g.fillColor = this._hexAlpha('#000000', 208);
        g.roundRect(-w / 2, -h / 2, w, h, 12);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = this._hexAlpha(COLOR_HIGHLIGHT, 170);
        g.roundRect(-w / 2, -h / 2, w, h, 12);
        g.stroke();

        const label = this._makeLabel('ToastLabel', node, 0, 0, w - 36, h - 10, '', 22, COLOR_TEXT_PRIMARY);
        label.overflow = Label.Overflow.SHRINK;

        parent.addChild(node);
        node.setPosition(0, -470, 0);
        node.active = false;

        this._toastBanner = node;
        this._toastLabel = label;
    }

    private _expireTimers(): void {
        const now = Date.now() / 1000;
        if (this._hintUntil > 0 && now >= this._hintUntil) {
            this._hintUntil = 0;
            this._hintKind = null;
            this._clearFx();
        }
        if (this._toastUntil > 0 && now >= this._toastUntil) {
            this._toastUntil = 0;
            this._toastText = '';
            if (this._toastBanner && this._toastBanner.isValid) this._toastBanner.active = false;
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
            this._settings.limitRedeal = parsed.limitRedeal === true;
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
