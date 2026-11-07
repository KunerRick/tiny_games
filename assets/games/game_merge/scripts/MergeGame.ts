/**
 * 合合大作战 — 运行时组件：把 `MergeCore` 的纯逻辑画出来、接上触摸、串起面板。
 *
 * 约定（同砖块远征）：
 * - 逻辑坐标（原点左上、y 向下）只存在于 `MergeCore`；本文件的 `_toLogic` / `_nx` / `_ny` 负责映射。
 * - 所有事件 handler 都是命名方法（红线 5）；`onDestroy` 只用缓存节点解绑（红线 4）。
 * - 面板按钮在 `_bindXxx()` 里 `off` + `on`，`_hidePanel()` 里只切 `active`（防崩溃守则 6）。
 * - 细线一律 `rect()+fill()`，不依赖 `stroke()`（踩坑手册 §4.5）。
 */

import { _decorator, Color, Component, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { MergeCore } from './MergeCore';
import {
    COLORS,
    DROP_Y,
    GAME_OVER_LINE,
    PLAY_H,
    PLAY_W,
    WALL_T,
    fruitColor,
    tierRadius,
} from './MergeConfig';
import type { MergeEvent } from './MergeCore';
import { StorageManager } from '../../../common/managers/StorageManager';
import { SceneManager } from '../../../common/managers/SceneManager';
import { applySceneClearColor } from '../../../common/ui/GameUIKit';

const { ccclass, property } = _decorator;

const GAME_ID = 'merge';
const PARTICLE_MAX = 160;
const SHAKE_DECAY = 80;

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: number;
}

/** 合并时扩散的圆环 */
interface Ring {
    x: number;
    y: number;
    r: number;
    maxR: number;
    life: number;
    maxLife: number;
    color: number;
}

/**
 * 单颗水果的表现状态（纯视图层，不进 `MergeCore`）。
 * 物理只算圆心和速度，圆是各向同性的，画出来就是一堆"死圆片"——
 * 这三个量负责让它看起来像有质量的果子：
 * - `angle`  : 滚动角（角速度 = 切向速度 / 半径）
 * - `squash` : 落地压扁量，撞击越猛越大
 * - `pop`    : 新生成时的弹出（1 → 0），合成出来的水果会"蹦"一下
 */
interface FruitView {
    angle: number;
    squash: number;
    pop: number;
    lastVy: number;
}

@ccclass('MergeGame')
export class MergeGame extends Component {
    // ==================== 场景绑定 ====================

    @property({ type: Node, tooltip: '背景/墙体/警戒线（Graphics）' })
    backgroundLayer: Node | null = null;

    @property({ type: Node, tooltip: '水果层（Graphics）' })
    fruitLayer: Node | null = null;

    @property({ type: Node, tooltip: '特效层：待落水果/引导线/碎屑（Graphics）' })
    effectLayer: Node | null = null;

    @property({ type: Node, tooltip: '触摸区（660×860）' })
    inputArea: Node | null = null;

    @property({ type: Node, tooltip: '「下一个」预览节点（挂 Graphics，本地原点居中）' })
    nextPreview: Node | null = null;

    @property({ type: Label })
    scoreLabel: Label | null = null;

    @property({ type: Label })
    bestLabel: Label | null = null;

    @property({ type: Label })
    comboLabel: Label | null = null;

    @property({ type: Label })
    guideLabel: Label | null = null;

    // 暂停
    @property({ type: Node })
    pauseButton: Node | null = null;

    @property({ type: Node })
    pausePanel: Node | null = null;

    @property({ type: Node })
    pauseResumeButton: Node | null = null;

    @property({ type: Node })
    pauseRestartButton: Node | null = null;

    @property({ type: Node })
    pauseLobbyButton: Node | null = null;

    // 结算
    @property({ type: Node })
    gameOverPanel: Node | null = null;

    @property({ type: Label })
    gameOverScoreLabel: Label | null = null;

    @property({ type: Label })
    gameOverBestLabel: Label | null = null;

    @property({ type: Node })
    gameOverRestartButton: Node | null = null;

    @property({ type: Node })
    gameOverLobbyButton: Node | null = null;

    // ==================== 运行时 ====================

    private _core: MergeCore = new MergeCore();
    private _paused = false;
    private _gameOverShown = false;

    private _bgGraphics: Graphics | null = null;
    private _fruitGraphics: Graphics | null = null;
    private _effectGraphics: Graphics | null = null;
    private _nextGraphics: Graphics | null = null;
    private _inputTransform: UITransform | null = null;

    private _particles: Particle[] = [];
    private _rings: Ring[] = [];
    private _shake = 0;

    /** 每颗水果的表现状态，按 fruit.id 索引（合并掉的水果在 _drawFruits 里被清掉） */
    private _views: Map<number, FruitView> = new Map();
    /** 本帧 dt，供 _drawFruits 推进滚动/压扁/弹出 */
    private _frameDt = 0;

    /** 最后一次已知的指针逻辑 x（桌面上拖拽结束派发 CANCEL 时用它） */
    private _dragX = PLAY_W / 2;

    private _lastScore = -1;
    private _lastBest = -1;
    private _lastCombo = -1;
    private _lastGuide = '';
    private _lastNextTier = -1;

    private _highScore = 0;

    // onDestroy 只用这些缓存（不访问 @property）
    private _inputNode: Node | null = null;
    private _pauseNode: Node | null = null;
    private _destroyed = false;

    /** 颜色缓存：按 (hex, alpha/32) 复用，避免每帧给几百个图元新建 Color */
    private _colorCache: Map<number, Color> = new Map();

    // ==================== 生命周期 ====================

    onLoad(): void {
        applySceneClearColor();
        this._bgGraphics = this._graphicsOf(this.backgroundLayer);
        this._fruitGraphics = this._graphicsOf(this.fruitLayer);
        this._effectGraphics = this._graphicsOf(this.effectLayer);
        this._nextGraphics = this._graphicsOf(this.nextPreview);
        this._inputNode = this.inputArea;
        this._inputTransform = this.inputArea ? this.inputArea.getComponent(UITransform) : null;

        this._highScore = this._readNumber('highScore', 0);
        StorageManager.instance.addRecentGame(GAME_ID);

        this._bindStatic();
        this._drawBackground();
        this.startNewRun();
        this._hidePanel(this.pausePanel);
        this._hidePanel(this.gameOverPanel);
    }

    onDestroy(): void {
        this._destroyed = true;
        const input = this._inputNode;
        if (input && input.isValid) {
            input.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
            input.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
            input.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
            input.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
        }
        const pause = this._pauseNode;
        if (pause && pause.isValid) {
            pause.off(Node.EventType.TOUCH_END, this._onPauseClicked, this);
        }
        this.unscheduleAllCallbacks();
        this._particles = [];
        this._rings = [];
        this._views.clear();
        this._colorCache.clear();
    }

    update(dt: number): void {
        if (this._destroyed) return;

        if (!this._paused && !this._gameOverShown) {
            this._core.step(dt);
            this._consumeEvents();
        }

        this._frameDt = dt;
        this._updateEffects(dt);
        this._drawFruits();
        this._drawEffects();
        this._refreshHud();
    }

    // ==================== 对外：新的一局 ====================

    startNewRun(): void {
        const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
        this._core.startRun(seed);
        this._paused = false;
        this._gameOverShown = false;
        this._particles = [];
        this._rings = [];
        this._views.clear();
        this._shake = 0;
        this._dragX = PLAY_W / 2;
        this._lastScore = -1;
        this._lastBest = -1;
        this._lastCombo = -1;
        this._lastGuide = '';
        this._lastNextTier = -1;
        this._hidePanel(this.pausePanel);
        this._hidePanel(this.gameOverPanel);
        this._drawNextPreview();
        this._writeNumber('runs', this._readNumber('runs', 0) + 1);
    }

    // ==================== 输入 ====================

    private _bindStatic(): void {
        const input = this.inputArea;
        if (input) {
            input.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
            input.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
            input.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
            input.on(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
        }
        if (this.pauseButton) {
            this._pauseNode = this.pauseButton;
            this.pauseButton.on(Node.EventType.TOUCH_END, this._onPauseClicked, this);
        }
    }

    private _onTouchStart(event: EventTouch): void {
        if (!this._acceptsPlayInput()) return;
        const p = this._toLogic(event.getUILocation().x, event.getUILocation().y);
        this._dragX = p.x;
        this._core.setDropX(p.x);
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this._acceptsPlayInput()) return;
        const p = this._toLogic(event.getUILocation().x, event.getUILocation().y);
        this._dragX = p.x;
        this._core.setDropX(p.x);
    }

    /** 松手即投放（拖动选位 / 轻点原地投放都走这里） */
    private _onTouchEnd(event: EventTouch): void {
        if (!this._acceptsPlayInput()) return;
        const p = this._toLogic(event.getUILocation().x, event.getUILocation().y);
        this._dragX = p.x;
        this._core.setDropX(p.x);
        this._core.drop();
    }

    /**
     * 桌面拖拽结束派发的是 TOUCH_CANCEL（踩坑手册 §11）：
     * 对"松手投放"的玩法来说语义相同，按投放处理，否则拖出节点范围就投不出去。
     */
    private _onTouchCancel(event: EventTouch): void {
        if (!this._acceptsPlayInput()) return;
        const loc = event ? event.getUILocation() : null;
        if (loc) {
            const p = this._toLogic(loc.x, loc.y);
            this._dragX = p.x;
        }
        this._core.setDropX(this._dragX);
        this._core.drop();
    }

    private _acceptsPlayInput(): boolean {
        if (this._paused || this._gameOverShown) return false;
        const state = this._core.state;
        return state === 'ready' || state === 'playing';
    }

    private _toLogic(uiX: number, uiY: number): { x: number; y: number } {
        if (!this._inputTransform) {
            return { x: PLAY_W / 2, y: PLAY_H / 2 };
        }
        const local = this._inputTransform.convertToNodeSpaceAR(new Vec3(uiX, uiY, 0));
        return { x: local.x + PLAY_W / 2, y: PLAY_H / 2 - local.y };
    }

    // ==================== 暂停 ====================

    private _onPauseClicked(): void {
        const state = this._core.state;
        if (this._paused || this._gameOverShown) return;
        if (state !== 'playing' && state !== 'ready') return;
        this._paused = true;
        this._bindPausePanel();
        this._showPanel(this.pausePanel);
    }

    private _bindPausePanel(): void {
        if (this.pauseResumeButton) {
            this.pauseResumeButton.off(Node.EventType.TOUCH_END, this._onResumeClicked, this);
            this.pauseResumeButton.on(Node.EventType.TOUCH_END, this._onResumeClicked, this);
        }
        if (this.pauseRestartButton) {
            this.pauseRestartButton.off(Node.EventType.TOUCH_END, this._onRestartClicked, this);
            this.pauseRestartButton.on(Node.EventType.TOUCH_END, this._onRestartClicked, this);
        }
        if (this.pauseLobbyButton) {
            this.pauseLobbyButton.off(Node.EventType.TOUCH_END, this._onLobbyClicked, this);
            this.pauseLobbyButton.on(Node.EventType.TOUCH_END, this._onLobbyClicked, this);
        }
    }

    private _onResumeClicked(): void {
        this._paused = false;
        this._hidePanel(this.pausePanel);
    }

    private _onRestartClicked(): void {
        this.startNewRun();
    }

    private _onLobbyClicked(): void {
        SceneManager.gotoLobby();
    }

    // ==================== 结算 ====================

    private _showGameOver(): void {
        if (this._gameOverShown) return;
        this._gameOverShown = true;
        this._saveRecords();
        if (this.gameOverScoreLabel) {
            // 面板上已有「得分」标题，这里只写数值，避免「得分 得分 N」
            this.gameOverScoreLabel.string = `${this._core.score}`;
        }
        if (this.gameOverBestLabel) {
            this.gameOverBestLabel.string = `${this._highScore}`;
        }
        this._bindGameOver();
        this._showPanel(this.gameOverPanel);
    }

    private _bindGameOver(): void {
        if (this.gameOverRestartButton) {
            this.gameOverRestartButton.off(Node.EventType.TOUCH_END, this._onRestartClicked, this);
            this.gameOverRestartButton.on(Node.EventType.TOUCH_END, this._onRestartClicked, this);
        }
        if (this.gameOverLobbyButton) {
            this.gameOverLobbyButton.off(Node.EventType.TOUCH_END, this._onLobbyClicked, this);
            this.gameOverLobbyButton.on(Node.EventType.TOUCH_END, this._onLobbyClicked, this);
        }
    }

    private _saveRecords(): void {
        const score = this._core.score;
        if (score > this._highScore) {
            this._highScore = score;
            this._writeNumber('highScore', score);
        }
    }

    // ==================== 核心事件 ====================

    private _consumeEvents(): void {
        const events = this._core.popEvents();
        for (let i = 0; i < events.length; i++) {
            const event: MergeEvent = events[i];
            switch (event.type) {
                case 'merge':
                    this._spawnBurst(event.x, event.y, fruitColor(event.tier), 10, 90);
                    this._spawnRing(event.x, event.y, fruitColor(event.tier), tierRadius(event.tier) * 1.6);
                    if (event.combo >= 3) this._shake = Math.max(this._shake, 2 + event.combo);
                    break;
                case 'top_merge':
                    this._spawnBurst(event.x, event.y, 0xffe066, 26, 180);
                    this._spawnRing(event.x, event.y, 0xffe066, 150);
                    this._shake = Math.max(this._shake, 10);
                    break;
                case 'game_over':
                    this._showGameOver();
                    break;
                default:
                    break;
            }
        }
    }

    // ==================== 渲染 ====================

    private _graphicsOf(node: Node | null): Graphics | null {
        return node ? node.getComponent(Graphics) : null;
    }

    private _drawBackground(): void {
        const g = this._bgGraphics;
        if (!g) return;
        const left = -PLAY_W / 2;
        const bottom = -PLAY_H / 2;

        g.clear();
        g.fillColor = this._color(COLORS.bg);
        g.rect(left, bottom, PLAY_W, PLAY_H);
        g.fill();

        // 网格：细线用实心矩形，避免 preview 缩放下被亚像素吃掉
        g.fillColor = this._color(COLORS.grid);
        for (let x = 60; x < PLAY_W; x += 60) {
            g.rect(left + x, bottom, 1, PLAY_H);
        }
        for (let y = 60; y < PLAY_H; y += 60) {
            g.rect(left, bottom + y, PLAY_W, 1);
        }
        g.fill();

        // 左/右/底墙
        g.fillColor = this._color(COLORS.wall);
        g.rect(left, bottom, WALL_T, PLAY_H);
        g.rect(left + PLAY_W - WALL_T, bottom, WALL_T, PLAY_H);
        g.rect(left, bottom, PLAY_W, WALL_T);
        g.fill();

        // 警戒线：虚线（每条 14×3），越线时靠特效层闪烁，这里只画静态基线
        g.fillColor = this._color(COLORS.warn, 0.75);
        const lineY = PLAY_H / 2 - GAME_OVER_LINE;
        for (let x = WALL_T + 6; x < PLAY_W - WALL_T - 6; x += 28) {
            g.rect(left + x, lineY, 14, 3);
        }
        g.fill();
    }

    private _drawFruits(): void {
        const g = this._fruitGraphics;
        if (!g) return;
        g.clear();
        const fruits = this._core.fruits;
        const dt = this._frameDt;
        for (let i = 0; i < fruits.length; i++) {
            const f = fruits[i];
            const view = this._viewOf(f.id, f.vy);
            const impact = this._advanceView(view, f.sleeping ? 0 : f.vx, f.vy, f.r, dt);

            // 重落地：果子底部炸出一小撮尘土，强化"砸下来"的重量感
            if (impact > 0.12) {
                this._spawnDust(f.x, f.y + f.r * 0.75, fruitColor(f.tier), 4);
            }

            // 弹出：新生成的（含刚合成出来的）果子 0.65 → 1.2 → 1，像"蹦"出来一样
            const popScale = 1 + 0.38 * Math.sin(Math.PI * view.pop) - 0.35 * view.pop;
            const scaleX = popScale * (1 + view.squash * 0.55);
            const scaleY = popScale * (1 - view.squash);

            this._drawFruit(g, f.x, f.y, f.tier, 1, view.angle, scaleX, scaleY);
        }

        // 合并掉的果子从视图表里清掉（长度相等时不必建 Set）
        if (this._views.size !== fruits.length) {
            const alive = new Set<number>();
            for (let i = 0; i < fruits.length; i++) alive.add(fruits[i].id);
            this._views.forEach((_v, id) => {
                if (!alive.has(id)) this._views.delete(id);
            });
        }
    }

    private _viewOf(id: number, vy: number): FruitView {
        let view = this._views.get(id);
        if (!view) {
            // 新建的果子（普通投放 / 合并产物）从 pop=1 开始
            view = { angle: 0, squash: 0, pop: 1, lastVy: vy };
            this._views.set(id, view);
        }
        return view;
    }

    /**
     * 推进滚动角、落地压扁、弹出进度；返回本次撞击的压扁量（0 表示没有撞击）。
     * 压扁用「竖直速度骤降」判定撞击：桌面 60 fps 下读取的 vy 已经跨过若干子步，
     * 落地那一帧必然是 +大 → −中，差值就是撞击强度。
     */
    private _advanceView(view: FruitView, vx: number, vy: number, r: number, dt: number): number {
        if (dt <= 0) return 0;
        if (vx !== 0) view.angle -= (vx / Math.max(8, r)) * dt;

        let impact = 0;
        const dv = view.lastVy - vy;
        if (dv > 150 && Math.abs(vy) < Math.abs(view.lastVy)) {
            impact = Math.min(0.32, dv / 2000);
            if (impact > view.squash) view.squash = impact;
        }
        view.lastVy = vy;
        if (view.squash > 0) view.squash = Math.max(0, view.squash - dt * 2.4);
        if (view.pop > 0) view.pop = Math.max(0, view.pop - dt / 0.22);
        return impact;
    }

    /** 落地尘土：只往上/两侧轻飘，重力由 _updateEffects 统一加 */
    private _spawnDust(x: number, y: number, color: number, count: number): void {
        for (let i = 0; i < count; i++) {
            if (this._particles.length >= PARTICLE_MAX) return;
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
            const speed = 40 + Math.random() * 90;
            this._particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.32,
                maxLife: 0.32,
                size: 2 + Math.random() * 2.5,
                color,
            });
        }
    }

    /**
     * 画一颗水果（逻辑坐标入参）。
     * 用 ellipse 而不是 circle：落地压扁时要非等比缩放。
     * 高光与果籽都按 `angle` 绕心旋转，静止时保持原样，滚动时能明显看出在转。
     */
    private _drawFruit(
        g: Graphics,
        x: number,
        y: number,
        tier: number,
        alpha: number,
        angle = 0,
        scaleX = 1,
        scaleY = 1,
    ): void {
        const r = tierRadius(tier);
        const nx = -PLAY_W / 2 + x;
        const ny = PLAY_H / 2 - y;
        const rx = r * scaleX;
        const ry = r * scaleY;

        g.fillColor = this._color(fruitColor(tier), alpha);
        g.ellipse(nx, ny, rx, ry);
        g.fill();

        // 外圈：颜色加深，给圆形一点"果皮"的立体感
        g.fillColor = this._color(0x000000, 0.12 * alpha);
        g.ellipse(nx, ny, rx * 0.82, ry * 0.82);
        g.fill();
        g.fillColor = this._color(fruitColor(tier), alpha);
        g.ellipse(nx, ny, rx * 0.72, ry * 0.72);
        g.fill();

        // 左上高光（角度 2.35 rad ≈ 左上，angle=0 时与旧版位置一致）
        const ha = angle + 2.35;
        g.fillColor = this._color(0xffffff, 0.5 * alpha);
        g.ellipse(nx + Math.cos(ha) * rx * 0.42, ny + Math.sin(ha) * ry * 0.42, r * 0.2, r * 0.16);
        g.fill();

        // 果籽：第二个标记，滚动时才看得出"在转"；小果子省掉这枚图元
        if (r >= 34) {
            const sa = angle - 0.55;
            g.fillColor = this._color(0x000000, 0.22 * alpha);
            g.circle(nx + Math.cos(sa) * rx * 0.5, ny + Math.sin(sa) * ry * 0.5, r * 0.1);
            g.fill();
        }
    }

    private _drawEffects(): void {
        const g = this._effectGraphics;
        if (!g) return;
        g.clear();

        const shakeX = this._shake > 0.2 ? (Math.random() * 2 - 1) * this._shake : 0;
        const shakeY = this._shake > 0.2 ? (Math.random() * 2 - 1) * this._shake : 0;

        const playing = !this._paused && !this._gameOverShown && this._core.state !== 'game_over';
        if (playing) {
            const px = -PLAY_W / 2 + this._core.dropX + shakeX;
            // 落点引导线
            g.fillColor = this._color(COLORS.dropGuide, 0.28);
            for (let y = DROP_Y + 44; y < PLAY_H - WALL_T; y += 26) {
                g.rect(px - 1, PLAY_H / 2 - y + shakeY, 2, 13);
            }
            g.fill();
            // 待落水果（冷却中半透明，提示不能放）
            const ready = this._core.canDrop;
            this._drawFruit(g, this._core.dropX + shakeX, DROP_Y + shakeY, this._core.currentTier, ready ? 1 : 0.45);
        }

        // 越线警示：警戒线闪烁
        const above = this._core.aboveLineCount;
        if (above > 0 && playing) {
            const pulse = 0.35 + 0.35 * Math.abs(Math.sin(Date.now() / 180));
            g.fillColor = this._color(COLORS.warn, pulse);
            const lineY = PLAY_H / 2 - GAME_OVER_LINE;
            g.rect(-PLAY_W / 2 + WALL_T, lineY - 1, PLAY_W - WALL_T * 2, 5);
            g.fill();
        }

        // 合并圆环
        for (let i = 0; i < this._rings.length; i++) {
            const ring = this._rings[i];
            const t = 1 - ring.life / ring.maxLife;
            const alpha = Math.max(0, ring.life / ring.maxLife) * 0.7;
            g.fillColor = this._color(ring.color, alpha);
            const r = ring.r + (ring.maxR - ring.r) * t;
            // 圆环用 12 段矩形拼（Graphics 的 stroke 在预览缩放下不可靠）
            const segs = 12;
            for (let s = 0; s < segs; s++) {
                const a = (s / segs) * Math.PI * 2;
                g.rect(
                    -PLAY_W / 2 + ring.x + Math.cos(a) * r - 3 + shakeX,
                    PLAY_H / 2 - ring.y + Math.sin(a) * r - 3 + shakeY,
                    6,
                    6,
                );
            }
            g.fill();
        }

        // 碎屑
        for (let i = 0; i < this._particles.length; i++) {
            const p = this._particles[i];
            const alpha = Math.max(0, p.life / p.maxLife);
            g.fillColor = this._color(p.color, alpha);
            g.circle(-PLAY_W / 2 + p.x + shakeX, PLAY_H / 2 - p.y + shakeY, p.size);
            g.fill();
        }
    }

    private _drawNextPreview(): void {
        const g = this._nextGraphics;
        if (!g) return;
        g.clear();
        const tier = this._core.state === 'ready' ? this._core.currentTier : this._core.nextTier;
        const r = tierRadius(tier);
        // 预览半径 12–30：层级越高越大，但封顶以免撑破格子
        const rp = 12 + 18 * ((r - tierRadius(0)) / (tierRadius(10) - tierRadius(0)));
        g.fillColor = this._color(fruitColor(tier));
        g.circle(0, 0, rp);
        g.fill();
        g.fillColor = this._color(0xffffff, 0.5);
        g.circle(-rp * 0.32, rp * 0.34, rp * 0.2);
        g.fill();
        this._lastNextTier = tier;
    }

    // ==================== HUD ====================

    private _refreshHud(): void {
        const core = this._core;
        if (core.score !== this._lastScore) {
            if (this.scoreLabel) this.scoreLabel.string = `${core.score}`;
            this._lastScore = core.score;
        }
        const best = core.score > this._highScore ? core.score : this._highScore;
        if (best !== this._lastBest) {
            // HUD 上已有「最高」标题，这里只写数值
            if (this.bestLabel) this.bestLabel.string = `${best}`;
            this._lastBest = best;
        }
        if (core.combo !== this._lastCombo) {
            if (this.comboLabel) {
                this.comboLabel.string = core.combo >= 2
                    ? `连击 ${core.combo}  ×${core.comboMultiplier}`
                    : '';
            }
            this._lastCombo = core.combo;
        }
        const nextTier = core.state === 'ready' ? core.currentTier : core.nextTier;
        if (nextTier !== this._lastNextTier) this._drawNextPreview();

        if (this.guideLabel) {
            const guide = this._guideText();
            if (guide !== this._lastGuide) {
                this.guideLabel.string = guide;
                this._lastGuide = guide;
            }
        }
    }

    private _guideText(): string {
        if (this._gameOverShown) return '';
        if (this._paused) return '已暂停';
        if (this._core.state === 'game_over') return '';
        if (this._core.state === 'ready') return '拖动选位置 · 松手投放';
        return '叠加同种水果合成更大的';
    }

    // ==================== 特效 ====================

    private _spawnBurst(x: number, y: number, color: number, count: number, speedMax: number): void {
        for (let i = 0; i < count; i++) {
            if (this._particles.length >= PARTICLE_MAX) break;
            const angle = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * speedMax;
            this._particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 60,
                life: 0.45,
                maxLife: 0.45,
                size: 2 + Math.random() * 3,
                color,
            });
        }
    }

    private _spawnRing(x: number, y: number, color: number, maxR: number): void {
        this._rings.push({ x, y, r: maxR * 0.25, maxR, life: 0.35, maxLife: 0.35, color });
    }

    private _updateEffects(dt: number): void {
        if (this._particles.length > 0) {
            // 原地压缩，避免每帧新建数组
            let write = 0;
            for (let read = 0; read < this._particles.length; read++) {
                const p = this._particles[read];
                p.life -= dt;
                if (p.life <= 0) continue;
                p.vy += 900 * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                this._particles[write++] = p;
            }
            this._particles.length = write;
        }
        if (this._rings.length > 0) {
            let write = 0;
            for (let read = 0; read < this._rings.length; read++) {
                const ring = this._rings[read];
                ring.life -= dt;
                if (ring.life <= 0) continue;
                this._rings[write++] = ring;
            }
            this._rings.length = write;
        }
        if (this._shake > 0) {
            this._shake = Math.max(0, this._shake - SHAKE_DECAY * dt);
        }
    }

    // ==================== 小工具 ====================

    private _color(hex: number, alpha = 1): Color {
        const step = Math.round(Math.max(0, Math.min(1, alpha)) * 32);
        const key = (hex >>> 0) * 64 + step;
        let color = this._colorCache.get(key);
        if (!color) {
            color = new Color();
            color.fromHEX(`#${hex.toString(16).padStart(6, '0')}`);
            color.a = Math.round((step / 32) * 255);
            this._colorCache.set(key, color);
        }
        return color;
    }

    private _showPanel(panel: Node | null): void {
        if (!panel) return;
        if (!panel.active) panel.active = true;
    }

    private _hidePanel(panel: Node | null): void {
        if (!panel) return;
        if (panel.active) panel.active = false;
    }

    private _readNumber(key: string, fallback: number): number {
        const raw = StorageManager.instance.getItem(GAME_ID, key);
        if (raw === null) return fallback;
        const value = parseInt(raw, 10);
        return isNaN(value) ? fallback : value;
    }

    private _writeNumber(key: string, value: number): void {
        StorageManager.instance.setItem(GAME_ID, key, `${value}`);
    }
}
