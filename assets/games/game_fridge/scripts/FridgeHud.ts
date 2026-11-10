/**
 * 冰箱底下 — 顶栏 / 道具栏 / 小地图 / 宝箱三选一 / 死亡与通关提示。
 *
 * 节点全部运行时创建（与 SurvivorHud 一致），不改场景文件。
 * 顶栏在 Canvas 顶部，战斗区（Field）中心 y=160、半高 336，所以 HUD 放在 y≈580 一带。
 *
 * 约定：onDestroy 只清引用（红线 4）；所有文字直接 set Label.string（图标一律用 Graphics 画，避免字体 tofu）。
 */

import { _decorator, Color, Component, EventTouch, Graphics, Label, Node, sys, UITransform } from 'cc';
import type { FridgeSnapshot } from './FridgeConfig';
import { ITEM_BY_ID, REROLL_COST } from './FridgeConfig';
import type { FloorMap } from './FridgeDungeon';
import { MAP_H, MAP_W } from './FridgeDungeon';

const { ccclass } = _decorator;

/** 顶栏基线（Canvas 坐标）：心格一行在上，数值一行在下 */
const HUD_Y = 604;
const STATS_Y = 566;
/** 半心方块边长 */
const PIP = 14;
const PIP_GAP = 3;
/** M1 计分：击杀 10 分 + 每秒 5 分（死亡结算与最高分用） */
const SCORE_PER_KILL = 10;
const SCORE_PER_SEC = 5;
const BEST_KEY = 'tiny_games_fridge_best';

@ccclass('FridgeHud')
export class FridgeHud extends Component {
    /** 死亡遮罩被点击时回调（由 FridgeGame 注入，避免 HUD 直接依赖主组件） */
    onRestartRequested: (() => void) | null = null;
    /** 宝箱三选一：选了第 index 个（FridgeGame 转给核心） */
    onTreasurePick: ((index: number) => void) | null = null;
    /** 宝箱三选一：重掷 */
    onTreasureReroll: (() => void) | null = null;

    private _pipGfx: Graphics | null = null;
    private _stats: Label | null = null;
    private _sub: Label | null = null;
    private _items: Label | null = null;
    private _hint: Label | null = null;
    private _dead: Label | null = null;
    private _deadDim: Node | null = null;

    /** 小地图 */
    private _mapGfx: Graphics | null = null;
    private _mapNode: Node | null = null;
    private _mapKey = '';

    /** 宝箱三选一面板 */
    private _treasureDim: Node | null = null;
    private _treasureCards: Node[] = [];
    private _treasureNameLabels: Label[] = [];
    private _treasureDescLabels: Label[] = [];
    private _treasureReroll: Node | null = null;
    private _treasureKey = '';

    private _safeTop = 0;
    private _best = 0;
    private _wasDead = false;
    private _newRecord = false;

    private _cFull = new Color(226, 88, 84, 255);
    private _cEmpty = new Color(60, 60, 70, 255);
    private _cText = new Color(236, 240, 245, 255);

    static create(parent: Node): FridgeHud {
        const node = new Node('FridgeHud');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        parent.addChild(node);
        return node.addComponent(FridgeHud);
    }

    onLoad(): void {
        this._best = this._loadBest();
        this._buildDeadDim();
        this._buildPips();
        this._stats = this._makeLabel('Stats', -340, STATS_Y, 20, Label.HorizontalAlign.LEFT, 420);
        this._sub = this._makeLabel('Sub', -340, STATS_Y - 28, 16, Label.HorizontalAlign.LEFT, 520);
        this._items = this._makeLabel('Items', 0, -300, 20, Label.HorizontalAlign.CENTER, 680);
        this._hint = this._makeLabel('Hint', 0, -370, 18, Label.HorizontalAlign.CENTER, 680);
        this._hint.string = '左半屏拖动移动 · 右半屏拖动瞄准（松手自动瞄准）';
        this._dead = this._makeLabel('Dead', 0, 40, 34, Label.HorizontalAlign.CENTER, 640);
        this._dead.node.active = false;
        this._buildMinimap();
        this._buildTreasurePanel();
        this._applySafeTop();
    }

    onDestroy(): void {
        if (this._deadDim && this._deadDim.isValid) {
            this._deadDim.off(Node.EventType.TOUCH_END, this.onDeadDimTouch, this);
        }
        for (const card of this._treasureCards) {
            if (card && card.isValid) card.off(Node.EventType.TOUCH_END, this.onTreasureCardTouch, this);
        }
        if (this._treasureReroll && this._treasureReroll.isValid) {
            this._treasureReroll.off(Node.EventType.TOUCH_END, this.onTreasureRerollTouch, this);
        }
        this._pipGfx = null;
        this._stats = null;
        this._sub = null;
        this._items = null;
        this._hint = null;
        this._dead = null;
        this._deadDim = null;
        this._mapGfx = null;
        this._mapNode = null;
        this._treasureDim = null;
        this._treasureCards = [];
        this._treasureNameLabels = [];
        this._treasureDescLabels = [];
        this._treasureReroll = null;
        this.onRestartRequested = null;
        this.onTreasurePick = null;
        this.onTreasureReroll = null;
    }

    /** 顶栏整体下移刘海高度（设计像素）；wx 下由 FridgeGame 注入 */
    setSafeTop(top: number): void {
        this._safeTop = Math.max(0, top);
        this._applySafeTop();
    }

    /** 常驻帧率读数由 FridgePerf 的「帧率」按钮显示，这里不再单独占一行 */

    refresh(snap: FridgeSnapshot): void {
        this._drawPips(snap.player.hp, snap.player.maxHp);
        const score = this._scoreOf(snap);
        const map = snap.map as FloorMap | null;
        if (this._stats) {
            if (map) {
                const total = map.rooms.length;
                let visited = 0;
                for (const r of map.rooms) if (r.visited) visited++;
                this._stats.string =
                    `第 ${snap.floor} 层 · 房间 ${visited}/${total} · 币 ${snap.coins} · ` +
                    `弹 ${snap.player.bombs} · 充能 ${snap.player.charges}/${snap.player.maxCharges}`;
            } else {
                this._stats.string = `击杀 ${snap.kills}   波次 ${snap.wave}   分数 ${score}`;
            }
        }
        if (this._sub) {
            const p = snap.player;
            this._sub.string = `伤害 ${p.dmg.toFixed(1)}   射速 ${p.rate.toFixed(1)}/s   最高 ${this._best}`;
        }
        this._refreshMinimap(map, snap);
        this._refreshTreasure(snap);

        const over = snap.phase !== 'playing';
        if (!over) {
            this._wasDead = false;
            this._newRecord = false;
        } else if (!this._wasDead) {
            // 只在刚结束的这一拍结算最高分，避免每 0.1s 刷新时「新纪录」闪一下就消失
            this._wasDead = true;
            this._newRecord = score > this._best;
            if (this._newRecord) {
                this._best = score;
                this._saveBest(score);
            }
        }
        if (this._dead) {
            if (this._dead.node.active !== over) this._dead.node.active = over;
            if (over) {
                const bestText = this._newRecord ? `历史最高 ${this._best}（新纪录！）` : `历史最高 ${this._best}`;
                const head = snap.phase === 'won' ? '通关第 1 层！' : '被吃掉了…';
                const floorText = map ? `第 ${snap.floor} 层 · ` : '';
                this._dead.string =
                    `${head}\n${floorText}得分 ${score} · 击杀 ${snap.kills} · 坚持 ${Math.floor(snap.time)} 秒\n` +
                    `${bestText}\n点击任意处 / 按 R 再来一局`;
            }
        }
        if (this._deadDim) {
            if (this._deadDim.active !== over) this._deadDim.active = over;
        }
        const playing = snap.phase === 'playing';
        const treasureOpen = !!snap.pendingTreasure && playing;
        if (this._items) {
            if (snap.items.length === 0) {
                this._items.string = map ? '道具：无（清房后回中心拾取）' : '道具：无（走到中间的辣椒酱上拾取）';
            } else {
                const names: string[] = [];
                for (const id of snap.items) {
                    const def = ITEM_BY_ID[id];
                    names.push(def ? def.name : id);
                }
                this._items.string = `道具（${names.length}）：${names.join('、')}`;
            }
            this._items.node.active = playing && !treasureOpen;
        }
        if (this._hint) this._hint.node.active = playing && !treasureOpen;
        if (this._mapNode) this._mapNode.active = !!map && !over;
    }

    // ==================== 小地图 ====================

    private _buildMinimap(): void {
        const node = new Node('Minimap');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(MAP_W * 15, MAP_H * 15);
        ut.setAnchorPoint(1, 0);
        node.setPosition(340, -560, 0);
        this.node.addChild(node);
        this._mapGfx = node.addComponent(Graphics);
        this._mapNode = node;
        node.active = false;
    }

    private _refreshMinimap(map: FloorMap | null, snap: FridgeSnapshot): void {
        const g = this._mapGfx;
        if (!g || !map) return;
        // 只在房间状态变化时重画（visited / cleared / 当前房间）
        let visited = 0;
        for (const r of map.rooms) if (r.visited) visited++;
        const key = `${snap.roomId}|${visited}|${map.rooms.map((r) => (r.cleared ? 1 : 0)).join('')}`;
        if (key === this._mapKey) return;
        this._mapKey = key;

        const cell = 13;
        const gap = 3;
        const originX = -(MAP_W * (cell + gap) - gap);
        const originY = 0;
        g.clear();
        for (const r of map.rooms) {
            if (!r.visited) continue;
            let fill: Color;
            if (r.id === snap.roomId) fill = this._cMapCurrent;
            else if (r.cleared) fill = this._cMapCleared;
            else if (r.kind === 'boss') fill = this._cMapBoss;
            else if (r.kind === 'treasure') fill = this._cMapTreasure;
            else fill = this._cMapPlain;
            g.fillColor = fill;
            g.rect(originX + r.x * (cell + gap), originY + r.y * (cell + gap), cell, cell);
            g.fill();
        }
    }

    private _cMapPlain = new Color(90, 108, 126, 235);
    private _cMapCleared = new Color(124, 200, 255, 235);
    private _cMapCurrent = new Color(255, 233, 153, 255);
    private _cMapBoss = new Color(226, 88, 84, 235);
    private _cMapTreasure = new Color(255, 214, 92, 235);

    // ==================== 宝箱三选一 ====================

    private _buildTreasurePanel(): void {
        const node = new Node('TreasurePanel');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1060);
        node.setPosition(0, -40, 0);
        this.node.addChild(node);
        this._treasureDim = node;

        const dim = new Node('TreasureDim');
        dim.layer = this.node.layer;
        dim.addComponent(UITransform).setContentSize(720, 1060);
        const dg = dim.addComponent(Graphics);
        dg.fillColor = new Color(6, 8, 14, 190);
        dg.rect(-360, -530, 720, 1060);
        dg.fill();
        node.addChild(dim);

        const title = this._makeLabel('TreasureTitle', 0, 400, 30, Label.HorizontalAlign.CENTER, 600);
        title.string = '宝箱！选一件带走';
        node.addChild(title.node);
        title.node.setPosition(0, 400, 0);

        const xs = [-220, 0, 220];
        for (let i = 0; i < 3; i++) {
            const card = new Node(`Card${i}`);
            card.layer = this.node.layer;
            const cut = card.addComponent(UITransform);
            cut.setContentSize(190, 260);
            cut.setAnchorPoint(0.5, 0.5);
            card.setPosition(xs[i], 120, 0);
            const cg = card.addComponent(Graphics);
            cg.fillColor = new Color(28, 38, 56, 245);
            cg.roundRect(-95, -130, 190, 260, 16);
            cg.fill();
            cg.lineWidth = 3;
            cg.strokeColor = new Color(255, 214, 92, 200);
            cg.roundRect(-95, -130, 190, 260, 16);
            cg.stroke();
            node.addChild(card);

            const name = this._makeLabel(`CardName${i}`, 0, 60, 22, Label.HorizontalAlign.CENTER, 170);
            name.node.setPosition(0, 60, 0);
            card.addChild(name.node);

            const desc = this._makeLabel(`CardDesc${i}`, 0, -20, 16, Label.HorizontalAlign.CENTER, 170);
            desc.overflow = Label.Overflow.RESIZE_HEIGHT;
            desc.lineHeight = 24;
            desc.node.setPosition(0, -20, 0);
            card.addChild(desc.node);

            card.on(Node.EventType.TOUCH_END, this.onTreasureCardTouch, this);
            this._treasureCards.push(card);
            this._treasureNameLabels.push(name);
            this._treasureDescLabels.push(desc);
        }

        const reroll = new Node('Reroll');
        reroll.layer = this.node.layer;
        const rut = reroll.addComponent(UITransform);
        rut.setContentSize(300, 64);
        rut.setAnchorPoint(0.5, 0.5);
        reroll.setPosition(0, -110, 0);
        const rg = reroll.addComponent(Graphics);
        rg.fillColor = new Color(124, 231, 255, 235);
        rg.roundRect(-150, -32, 300, 64, 32);
        rg.fill();
        const rl = this._makeLabel('RerollLabel', 0, 0, 24, Label.HorizontalAlign.CENTER, 280);
        rl.string = `换一批（${REROLL_COST} 金币）`;
        rl.color = new Color(10, 18, 28, 255);
        rl.node.setPosition(0, 0, 0);
        reroll.addChild(rl.node);
        reroll.on(Node.EventType.TOUCH_END, this.onTreasureRerollTouch, this);
        node.addChild(reroll);
        this._treasureReroll = reroll;

        const tip = this._makeLabel('TreasureTip', 0, -180, 16, Label.HorizontalAlign.CENTER, 600);
        tip.string = '点卡片领取 · 领完从门离开';
        node.addChild(tip.node);
        tip.node.setPosition(0, -180, 0);

        node.active = false;
    }

    private _refreshTreasure(snap: FridgeSnapshot): void {
        const node = this._treasureDim;
        if (!node) return;
        const offer = snap.pendingTreasure;
        const show = !!offer && snap.phase === 'playing';
        if (node.active !== show) node.active = show;
        if (!offer) {
            this._treasureKey = '';
            return;
        }
        const key = offer.offered.join(',') + (offer.rerolled ? '#r' : '');
        if (key === this._treasureKey) return;
        this._treasureKey = key;
        for (let i = 0; i < 3; i++) {
            const id = offer.offered[i];
            const def = id ? ITEM_BY_ID[id] : null;
            const nl = this._treasureNameLabels[i];
            const dl = this._treasureDescLabels[i];
            if (nl) nl.string = def ? def.name : '—';
            if (dl) dl.string = def ? def.desc : '';
        }
        void snap.coins;
    }

    private onTreasureCardTouch(ev: EventTouch): void {
        const target = ev.target as Node | null;
        if (!target) return;
        const idx = parseInt(target.name.replace('Card', ''), 10);
        if (!Number.isFinite(idx)) return;
        if (this.onTreasurePick) this.onTreasurePick(idx);
    }

    private onTreasureRerollTouch(): void {
        if (this.onTreasureReroll) this.onTreasureReroll();
    }

    private _scoreOf(snap: FridgeSnapshot): number {
        return snap.kills * SCORE_PER_KILL + Math.floor(snap.time) * SCORE_PER_SEC;
    }

    private _loadBest(): number {
        try {
            const raw = sys.localStorage.getItem(BEST_KEY);
            const n = raw ? parseInt(raw, 10) : 0;
            return Number.isFinite(n) && n > 0 ? n : 0;
        } catch {
            return 0;
        }
    }

    private _saveBest(score: number): void {
        try {
            sys.localStorage.setItem(BEST_KEY, String(score));
        } catch {
            // 存档失败不影响本局
        }
    }

    // ==================== 绘制 / 构建 ====================

    private _applySafeTop(): void {
        const top = this._safeTop;
        if (this._stats) this._stats.node.setPosition(-340, STATS_Y - top, 0);
        if (this._sub) this._sub.node.setPosition(-340, STATS_Y - 28 - top, 0);
        if (this._pipGfx) this._redrawPips();
    }

    private _drawPips(hp: number, maxHp: number): void {
        this._pipHp = hp;
        this._pipMax = maxHp;
        this._redrawPips();
    }

    private _redrawPips(): void {
        const g = this._pipGfx;
        if (!g) return;
        const hp = this._pipHp;
        const maxHp = this._pipMax;
        const y = HUD_Y - this._safeTop;
        g.clear();
        const startX = -340;
        for (let i = 0; i < maxHp; i++) {
            g.fillColor = i < hp ? this._cFull : this._cEmpty;
            g.rect(startX + i * (PIP + PIP_GAP), y - PIP / 2, PIP, PIP);
            g.fill();
        }
    }

    private _buildPips(): void {
        const node = new Node('HeartPips');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 120);
        this.node.addChild(node);
        this._pipGfx = node.addComponent(Graphics);
    }

    /**
     * 死亡遮罩：整块半透明区域 + 明确按钮，点击即重开。
     * 放在 HUD 子节点第 0 位（文字都在它上面），只在死亡时 active。
     */
    private _buildDeadDim(): void {
        const node = new Node('DeadDim');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1060);
        node.setPosition(0, -40, 0);
        this.node.addChild(node);
        node.setSiblingIndex(0);
        this._deadDim = node;

        const g = node.addComponent(Graphics);
        g.fillColor = new Color(6, 8, 14, 170);
        g.rect(-360, -530, 720, 1060);
        g.fill();

        // 提示卡片
        g.fillColor = new Color(24, 30, 46, 235);
        g.roundRect(-300, -30, 600, 220, 22);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = new Color(124, 231, 255, 160);
        g.roundRect(-300, -30, 600, 220, 22);
        g.stroke();

        // 「再来一局」按钮底
        g.fillColor = new Color(124, 231, 255, 235);
        g.roundRect(-130, -150, 260, 64, 32);
        g.fill();

        const btn = new Node('AgainLabel');
        btn.layer = this.node.layer;
        const but = btn.addComponent(UITransform);
        but.setContentSize(260, 64);
        but.setAnchorPoint(0.5, 0.5);
        btn.setPosition(0, -118, 0);
        const bl = btn.addComponent(Label);
        bl.string = '再来一局';
        bl.fontSize = 26;
        bl.lineHeight = 32;
        bl.isBold = true;
        bl.color = new Color(10, 18, 28, 255);
        bl.horizontalAlign = Label.HorizontalAlign.CENTER;
        bl.verticalAlign = Label.VerticalAlign.CENTER;
        node.addChild(btn);

        node.on(Node.EventType.TOUCH_END, this.onDeadDimTouch, this);
        node.active = false;
    }

    private onDeadDimTouch(): void {
        if (this.onRestartRequested) this.onRestartRequested();
    }

    private _pipHp = 0;
    private _pipMax = 0;

    private _makeLabel(name: string, x: number, y: number, size: number, align: number, width: number): Label {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(width, size * 3);
        // 左对齐锚点在左、右对齐锚点在右，否则 x 会被当成水平中心，整行被推到屏幕外
        const anchorX = align === Label.HorizontalAlign.LEFT ? 0 : align === Label.HorizontalAlign.RIGHT ? 1 : 0.5;
        ut.setAnchorPoint(anchorX, 0.5);
        node.setPosition(x, y, 0);
        const label = node.addComponent(Label);
        label.fontSize = size;
        label.lineHeight = Math.round(size * 1.3);
        label.color = this._cText;
        label.horizontalAlign = align;
        label.overflow = Label.Overflow.NONE;
        label.isBold = true;
        this.node.addChild(node);
        return label;
    }
}
