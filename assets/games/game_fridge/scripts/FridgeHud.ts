/**
 * 冰箱底下 — 顶栏 / 道具栏 / 死亡提示（M1 版）。
 *
 * 节点全部运行时创建（与 SurvivorHud 一致），不改场景文件。
 * 顶栏在 Canvas 顶部，战斗区（Field）中心 y=160、半高 336，所以 HUD 放在 y≈580 一带。
 *
 * 约定：onDestroy 只清引用（红线 4）；所有文字直接 set Label.string（图标一律用 Graphics 画，避免字体 tofu）。
 */

import { _decorator, Color, Component, Graphics, Label, Node, sys, UITransform } from 'cc';
import type { FridgeSnapshot } from './FridgeConfig';
import { ITEM_BY_ID } from './FridgeConfig';

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

    private _pipGfx: Graphics | null = null;
    private _stats: Label | null = null;
    private _sub: Label | null = null;
    private _fps: Label | null = null;
    private _items: Label | null = null;
    private _hint: Label | null = null;
    private _dead: Label | null = null;
    private _deadDim: Node | null = null;

    private _safeTop = 0;
    private _fpsValue = -1;
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
        this._fps = this._makeLabel('Fps', 340, STATS_Y, 16, Label.HorizontalAlign.RIGHT, 120);
        this._fps.string = 'FPS —';
        this._items = this._makeLabel('Items', -340, -300, 20, Label.HorizontalAlign.LEFT, 680);
        this._hint = this._makeLabel('Hint', 0, -370, 18, Label.HorizontalAlign.CENTER, 680);
        this._hint.string = '左半屏拖动移动 · 右半屏拖动瞄准（松手自动瞄准）';
        this._dead = this._makeLabel('Dead', 0, 40, 34, Label.HorizontalAlign.CENTER, 640);
        this._dead.node.active = false;
        this._applySafeTop();
    }

    onDestroy(): void {
        if (this._deadDim && this._deadDim.isValid) {
            this._deadDim.off(Node.EventType.TOUCH_END, this.onDeadDimTouch, this);
        }
        this._pipGfx = null;
        this._stats = null;
        this._sub = null;
        this._fps = null;
        this._items = null;
        this._hint = null;
        this._dead = null;
        this._deadDim = null;
        this.onRestartRequested = null;
    }

    /** 顶栏整体下移刘海高度（设计像素）；wx 下由 FridgeGame 注入 */
    setSafeTop(top: number): void {
        this._safeTop = Math.max(0, top);
        this._applySafeTop();
    }

    /** 常驻帧率读数；0 表示还没采到样本 */
    setFps(fps: number): void {
        const v = Math.max(0, Math.round(fps));
        if (v === this._fpsValue) return;
        this._fpsValue = v;
        if (this._fps) this._fps.string = v > 0 ? `FPS ${v}` : 'FPS —';
    }

    refresh(snap: FridgeSnapshot): void {
        this._drawPips(snap.player.hp, snap.player.maxHp);
        const score = this._scoreOf(snap);
        if (this._stats) {
            this._stats.string = `击杀 ${snap.kills}   波次 ${snap.wave}   分数 ${score}`;
        }
        if (this._sub) {
            const p = snap.player;
            this._sub.string = `伤害 ${p.dmg.toFixed(1)}   射速 ${p.rate.toFixed(1)}/s   最高 ${this._best}`;
        }
        if (this._items) {
            if (snap.items.length === 0) {
                this._items.string = '道具：无（走到中间的辣椒酱上拾取）';
            } else {
                const names: string[] = [];
                for (const id of snap.items) {
                    const def = ITEM_BY_ID[id];
                    names.push(def ? def.name : id);
                }
                this._items.string = `道具（${names.length}）：${names.join('、')}`;
            }
        }
        const dead = snap.phase === 'dead';
        if (!dead) {
            this._wasDead = false;
            this._newRecord = false;
        } else if (!this._wasDead) {
            // 只在刚死亡的这一拍结算最高分，避免每 0.1s 刷新时「新纪录」闪一下就消失
            this._wasDead = true;
            this._newRecord = score > this._best;
            if (this._newRecord) {
                this._best = score;
                this._saveBest(score);
            }
        }
        if (this._dead) {
            if (this._dead.node.active !== dead) this._dead.node.active = dead;
            if (dead) {
                const bestText = this._newRecord ? `历史最高 ${this._best}（新纪录！）` : `历史最高 ${this._best}`;
                this._dead.string =
                    `被吃掉了…\n得分 ${score} · 击杀 ${snap.kills} · 坚持 ${Math.floor(snap.time)} 秒\n` +
                    `${bestText}\n点击任意处 / 按 R 再来一局`;
            }
        }
        if (this._deadDim) {
            if (this._deadDim.active !== dead) this._deadDim.active = dead;
        }
        if (this._items) this._items.node.active = !dead;
        if (this._hint) this._hint.node.active = !dead;
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
        if (this._fps) this._fps.node.setPosition(340, STATS_Y - top, 0);
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
