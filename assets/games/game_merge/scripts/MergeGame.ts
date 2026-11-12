/**
 * 合合大作战 — 运行时组件：把 `MergeCore` 的纯逻辑画出来、接上触摸、串起面板。
 *
 * 约定（同砖块远征）：
 * - 逻辑坐标（原点左上、y 向下）只存在于 `MergeCore`；本文件的 `_toLogic` / `_nx` / `_ny` 负责映射。
 * - 所有事件 handler 都是命名方法（红线 5）；`onDestroy` 只用缓存节点解绑（红线 4）。
 * - 面板按钮在 `_bindXxx()` 里 `off` + `on`，`_hidePanel()` 里只切 `active`（防崩溃守则 6）。
 * - 细线一律 `rect()+fill()`，不依赖 `stroke()`（踩坑手册 §4.5）。
 */

import { _decorator, Color, Component, EventTouch, Graphics, Label, Node, UIOpacity, UITransform, Vec3 } from 'cc';
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
import {
    COLOR, FONT_BODY, FONT_CAPTION, FONT_DISPLAY, FONT_TITLE,
} from '../../../common/ui/UITheme';
import {
    addDialogBackdrop, findPath, paintLabel, skinButton, skinOverlay,
} from '../../../common/ui/SceneSkin';
import { applySceneClearColor, createLabel, UI } from '../../../common/ui/GameUIKit';

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

/** 合并残影：两颗旧果子缩小的瞬间，补「1+1 → 升级」的因果感 */
interface Ghost {
    x: number;
    y: number;
    tier: number;
    dx: number;
    life: number;
    maxLife: number;
}

/** 合并飘字（复用 Label 节点，不上 tween，靠 update 推进） */
interface FloatText {
    node: Node;
    opacity: UIOpacity;
    x: number;
    y: number;
    life: number;
    maxLife: number;
}

/** 剪影采样角度数：32 段在 118 px 半径下已看不出棱，兼顾微信端每帧上千 lineTo 的开销 */
const SHAPE_SEGMENTS = 32;

/** 每级水果的单位剪影（y 向上，外接半径约 1），第一次使用时生成并缓存 */
const SHAPE_CACHE: number[][][] = [];

/**
 * 按层级给出单位剪影上的点。相邻两级轮廓必须不同 —— 只看剪影就能分辨。
 *
 * 形状全部按「水果」重绘（试玩报告 §3.9：原来的六边形/菱形/水滴像宝石糖果）：
 * 0 樱桃 / 1 苹果 / 2 柠檬 / 3 梨 / 4 桃子 / 5 葡萄串，6 起是「越合越花哨」的奖励形。
 * 都是极坐标单值轮廓（或椭圆缩放），保证采样后是简单多边形，不会自交。
 */
function shapePoint(tier: number, theta: number): { x: number; y: number } {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    /** 顶部凹窝：只在正上方附近生效，指数越大越局部 */
    const topNotch = (power: number): number => Math.pow(Math.max(0, s), power);
    switch (tier) {
        case 0: // 樱桃：近圆，顶部一个小凹窝
            return { x: c, y: s * (1 - 0.10 * topNotch(8)) };
        case 1: // 苹果：顶部凹窝更深、肩部略宽、底部微平
            return {
                x: c * (1 + 0.02 * Math.abs(s)),
                y: s * (1 - 0.20 * topNotch(6)) * (s < 0 ? 0.96 : 1),
            };
        case 2: { // 柠檬：两端收尖的透镜形
            const lx = Math.sign(c) * Math.pow(Math.abs(c), 1.35) * 1.18;
            const ly = s * 0.86;
            return { x: lx, y: ly };
        }
        case 3: // 梨：上窄下宽
            return s > 0
                ? { x: c * (1 - 0.30 * s), y: s * 1.06 }
                : { x: c * (1 + 0.04 * -s), y: s * 1.02 };
        case 4: // 桃子：圆润、底部微尖、顶部浅凹
            return {
                x: c * (1 - 0.03 * topNotch(4)),
                y: s * (1 - 0.12 * topNotch(6)) * (s < 0 ? 0.98 : 1),
            };
        case 5: { // 葡萄串：9 个小瓣组成的簇
            const r = 1 + 0.075 * Math.cos(9 * theta);
            return { x: c * r, y: s * r };
        }
        case 6: { // 心形（参数方程归一化）
            const hx = 16 * Math.pow(Math.sin(theta), 3);
            const hy = 13 * Math.cos(theta) - 5 * Math.cos(2 * theta) - 2 * Math.cos(3 * theta) - Math.cos(4 * theta);
            return { x: hx / 17, y: hy / 17 };
        }
        case 7: { // 五瓣花
            const r = 0.82 + 0.18 * Math.cos(5 * theta);
            return { x: c * r, y: s * r };
        }
        case 8: { // 五角星
            const a = (Math.PI * 2) / 5;
            const m = ((theta % a) + a) % a;
            const r = (Math.cos(a / 2) / Math.cos(m - a / 2)) * (m < a / 2 ? 1 : 0.5);
            return { x: c * r, y: s * r };
        }
        case 9: { // 八瓣花
            const r = 0.84 + 0.16 * Math.cos(8 * theta);
            return { x: c * r, y: s * r };
        }
        default: { // 十二角星 / 太阳
            const a = (Math.PI * 2) / 12;
            const m = ((theta % a) + a) % a;
            const r = (Math.cos(a / 2) / Math.cos(m - a / 2)) * (m < a / 2 ? 1 : 0.68);
            return { x: c * r, y: s * r };
        }
    }
}

function shapePoints(tier: number): number[][] {
    const t = Math.max(0, Math.min(10, tier | 0));
    let pts = SHAPE_CACHE[t];
    if (pts) return pts;
    pts = [];
    for (let i = 0; i < SHAPE_SEGMENTS; i++) {
        const p = shapePoint(t, (i / SHAPE_SEGMENTS) * Math.PI * 2);
        pts.push([p.x, p.y]);
    }
    SHAPE_CACHE[t] = pts;
    return pts;
}

/** 颜色明度增减：amount ∈ [-1, 1]，负值变暗（果皮暗边） */
function shadeColor(hex: number, amount: number): number {
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    const f = amount < 0 ? 1 + amount : 1 + amount * (1 - Math.max(r, g, b) / 255);
    const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
    return (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);
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
    private _ghosts: Ghost[] = [];
    /** 当前活着的飘字 / 空闲复用池 */
    private _floatTexts: FloatText[] = [];
    private _floatPool: FloatText[] = [];
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

    /** 警戒线左侧的实时余量提示「再投 N 个触线」（试玩报告：只有红线没有量化预期） */
    private _overflowLabel: Label | null = null;
    private _lastOverflowText = '';

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
        this._applyUnifiedTheme();
    }

    // ------------------------------------------------------------------
    // 统一视觉：HUD 与两个弹窗是场景手摆的（#96a6be 标题、#344e70 按钮、
    // #9ee2fe 面板标签），按全站令牌换皮。逐帧绘制层保持 Graphics 自绘。
    // ------------------------------------------------------------------
    private _applyUnifiedTheme(): void {
        const root = this.node;

        paintLabel(root, 'HudTop/ScoreTitle', FONT_BODY, COLOR.TEXT_SECONDARY);
        paintLabel(root, 'HudTop/BestTitle', FONT_BODY, COLOR.TEXT_SECONDARY);
        paintLabel(root, 'HudTop/NextTitle', FONT_BODY, COLOR.TEXT_SECONDARY);
        paintLabel(root, 'HudTop/ScoreLabel', FONT_DISPLAY, COLOR.TEXT_PRIMARY);
        paintLabel(root, 'HudTop/BestLabel', FONT_DISPLAY, COLOR.TEXT_PRIMARY);
        paintLabel(root, 'HudTop/ComboLabel', FONT_BODY, COLOR.WARNING);
        paintLabel(root, 'HudTop/GuideLabel', FONT_CAPTION, COLOR.TEXT_DISABLED);

        skinButton(root, 'PauseButton', 'secondary', 88, 56);

        // 暂停
        this._themeDialog('PausePanel', [
            ['ResumeButton', 'primary', 320, 80],
            ['RestartButton', 'secondary', 320, 80],
            ['LobbyButton', 'secondary', 320, 80],
        ]);
        paintLabel(root, 'PausePanel/Title', FONT_DISPLAY, COLOR.PRIMARY);

        // 结算
        this._themeDialog('GameOverPanel', [
            ['RestartButton', 'primary', 320, 80],
            ['LobbyButton', 'secondary', 320, 80],
        ]);
        paintLabel(root, 'GameOverPanel/Title', FONT_DISPLAY, COLOR.PRIMARY);
        paintLabel(root, 'GameOverPanel/ScoreTitle', FONT_CAPTION, COLOR.TEXT_SECONDARY);
        paintLabel(root, 'GameOverPanel/BestTitle', FONT_CAPTION, COLOR.TEXT_SECONDARY);
        paintLabel(root, 'GameOverPanel/GameOverScoreLabel', FONT_DISPLAY, COLOR.TEXT_PRIMARY);
        paintLabel(root, 'GameOverPanel/GameOverBestLabel', FONT_TITLE, COLOR.TEXT_PRIMARY);
    }

    /** 弹窗通用换皮：遮罩 + 按包围盒补卡片底 + 按钮组 */
    private _themeDialog(
        name: string,
        buttons: [string, 'primary' | 'secondary' | 'danger' | 'success', number, number][],
    ): void {
        const root = this.node;
        skinOverlay(root, `${name}/Dim`, 205);
        addDialogBackdrop(findPath(root, name), { accent: COLOR.PRIMARY });
        for (const [btn, variant, w, h] of buttons) {
            skinButton(root, `${name}/${btn}`, variant, w, h);
        }
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
        this._ghosts = [];
        this._floatTexts = [];
        this._floatPool = [];
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
        this._updateOverflowHint();
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
        this._ghosts = [];
        this._floatTexts = [];
        this._floatPool = [];
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
                    this._spawnGhostPair(event.x, event.y, Math.max(0, event.tier - 1));
                    this._spawnFloatText(
                        event.x,
                        event.y,
                        event.combo >= 3 ? `连击 ${event.combo}  +${event.score}` : `+${event.score}`,
                        event.combo >= 3 ? 0xffe066 : 0xffffff,
                        event.combo >= 3 ? 28 : 24,
                    );
                    if (event.combo >= 3) this._shake = Math.max(this._shake, 2 + event.combo);
                    if (event.tier >= 9) this._shake = Math.max(this._shake, 3);
                    break;
                case 'top_merge':
                    this._spawnBurst(event.x, event.y, 0xffe066, 26, 180);
                    this._spawnRing(event.x, event.y, 0xffe066, 150);
                    this._spawnFloatText(event.x, event.y, `+${event.score}`, 0xffe066, 32);
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

        // 墙体内描边：贴内壁 2 px 亮线 + 每隔 80 px 的刻度，边界更清楚
        g.fillColor = this._color(0x3d5378, 0.85);
        g.rect(left + WALL_T, bottom, 2, PLAY_H);
        g.rect(left + PLAY_W - WALL_T - 2, bottom, 2, PLAY_H);
        g.rect(left + WALL_T, bottom, PLAY_W - WALL_T * 2, 2);
        g.fill();
        g.fillColor = this._color(0x4a638c, 0.7);
        for (let y = 80; y < PLAY_H - WALL_T; y += 80) {
            g.rect(left + WALL_T, bottom + y, 10, 2);
            g.rect(left + PLAY_W - WALL_T - 10, bottom + y, 10, 2);
        }
        for (let x = WALL_T + 80; x < PLAY_W - WALL_T; x += 80) {
            g.rect(left + x, bottom, 2, 8);
        }
        g.fill();

        // 警戒线：静态基线压得很淡，呼吸/闪烁由特效层的动态线负责
        g.fillColor = this._color(COLORS.warn, 0.2);
        const lineY = PLAY_H / 2 - GAME_OVER_LINE;
        for (let x = WALL_T + 6; x < PLAY_W - WALL_T - 6; x += 28) {
            g.rect(left + x, lineY, 14, 2);
        }
        g.fill();

        this._ensureWarnHint();
    }

    /**
     * 警戒线旁的一行说明（试玩报告：红色虚线没有解释，玩家不知道越线会怎样）。
     * 只建一次，挂在静态背景层上，随 `_drawBackground` 的节点一起销毁。
     */
    private _ensureWarnHint(): void {
        const host = this._bgGraphics ? this._bgGraphics.node : null;
        if (!host || host.getChildByName('WarnHint')) return;
        const width = 200;
        const lineY = PLAY_H / 2 - GAME_OVER_LINE;
        const label = createLabel(host, '警戒线 · 越线即结束', FONT_CAPTION.fontSize, {
            width,
            height: 24,
            color: COLOR.TEXT_DISABLED,
            align: 'right',
            x: PLAY_W / 2 - WALL_T - 10 - width / 2,
            y: lineY + 24,
        });
        label.node.name = 'WarnHint';
    }

    /**
     * 警戒线左侧的实时余量：「再投 N 个触线」。
     *
     * 按**当前落点列**算：落点果顶到警戒线之间的高度 / (2×当前层级半径)，
     * 即同一列继续竖直投放还能叠几个。比只画一条红线多一个量化预期，
     * 又不用跑物理模拟（相邻会滚动的果子不参与估算，文案用「约」兜住）。
     */
    private _updateOverflowHint(): void {
        const playing = !this._paused && !this._gameOverShown && this._core.state !== 'game_over';
        if (!playing) {
            if (this._overflowLabel) this._overflowLabel.node.active = false;
            return;
        }

        const host = this._effectGraphics ? this._effectGraphics.node : null;
        if (!host || !host.isValid) return;

        if (!this._overflowLabel || !this._overflowLabel.node.isValid) {
            const width = 220;
            const lineY = PLAY_H / 2 - GAME_OVER_LINE;
            this._overflowLabel = createLabel(host, '', FONT_CAPTION.fontSize, {
                width,
                height: 24,
                color: COLOR.TEXT_SECONDARY,
                align: 'left',
                x: -PLAY_W / 2 + WALL_T + 10 + width / 2,
                y: lineY + 24,
            });
            this._overflowLabel.node.name = 'OverflowHint';
            this._lastOverflowText = '';
        }

        const tier = this._core.currentTier;
        const r = tierRadius(tier);
        const landY = this._predictLandY(this._core.dropX, tier);
        const headroom = landY - r - GAME_OVER_LINE;
        const count = Math.floor(headroom / (2 * r));
        const text = count <= 0 ? '本列已到警戒线' : `再投约 ${count} 个触线`;
        if (text !== this._lastOverflowText) {
            this._lastOverflowText = text;
            this._overflowLabel.string = text;
            this._overflowLabel.color = count <= 1 ? this._color(COLORS.warn) : this._color(0x94a3b8);
        }
        this._overflowLabel.node.active = true;
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
     * 画一颗水果（逻辑坐标入参）。剪影按层级变化，见 `shapePoint`。
     *
     * 三层结构：整剪影的深色果皮 → 缩 87% 且偏左上的果肉 → 左上高光。
     * 果肉偏移固定（不随滚动角转），光源始终在左上，看起来才有体积而不是色块。
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
        const base = fruitColor(tier);

        // 顶级果实加一圈外发光，作为「里程碑」暗示
        if (tier >= 9) {
            this._fillShape(g, nx, ny, rx * 1.14, ry * 1.14, tier, angle, this._color(base, 0.16 * alpha));
        }

        this._fillShape(g, nx, ny, rx, ry, tier, angle, this._color(shadeColor(base, -0.42), alpha));
        this._fillShape(
            g,
            nx - rx * 0.035,
            ny + ry * 0.045,
            rx * 0.87,
            ry * 0.87,
            tier,
            angle,
            this._color(base, alpha),
        );

        // 左上高光（角度 2.35 rad ≈ 左上，随滚动角一起转，看得出在转）
        const ha = angle + 2.35;
        g.fillColor = this._color(0xffffff, 0.5 * alpha);
        g.ellipse(nx + Math.cos(ha) * rx * 0.4, ny + Math.sin(ha) * ry * 0.4, r * 0.2, r * 0.16);
        g.fill();

        // 果蒂：沿果体「上方」长出的一小截梗（跟着滚动角转，看得出果实在转）
        if (r >= 34 && tier <= 5) {
            const up = angle + Math.PI / 2;
            const ux = Math.cos(up);
            const uy = Math.sin(up);
            g.fillColor = this._color(0x6b4f3a, 0.9 * alpha);
            for (let i = 0; i < 3; i++) {
                const d = 0.82 + i * 0.10;
                const rad = Math.max(2, r * (0.10 - i * 0.02));
                g.circle(nx + ux * rx * d, ny + uy * ry * d, rad);
            }
            g.fill();
            // 叶：贴在梗根侧边，只给中大型果（太小会糊成一团）
            if (r >= 58) {
                g.fillColor = this._color(0x4ade80, 0.75 * alpha);
                g.ellipse(
                    nx + ux * rx * 0.86 - uy * rx * 0.22,
                    ny + uy * ry * 0.86 + ux * ry * 0.22,
                    r * 0.16,
                    r * 0.09,
                );
                g.fill();
            }
        } else if (r >= 34) {
            const sa = angle - 0.55;
            g.fillColor = this._color(0x000000, 0.22 * alpha);
            g.circle(nx + Math.cos(sa) * rx * 0.48, ny + Math.sin(sa) * ry * 0.48, r * 0.1);
            g.fill();
        }
    }

    /** 按层级剪影填充一个形状（支持滚动旋转与非等比缩放） */
    private _fillShape(
        g: Graphics,
        cx: number,
        cy: number,
        rx: number,
        ry: number,
        tier: number,
        angle: number,
        color: Color,
    ): void {
        const pts = shapePoints(tier);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        for (let i = 0; i < pts.length; i++) {
            const px = pts[i][0];
            const py = pts[i][1];
            const x = cx + (px * cos - py * sin) * rx;
            const y = cy + (px * sin + py * cos) * ry;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
        }
        g.close();
        g.fillColor = color;
        g.fill();
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
            const tier = this._core.currentTier;
            const ready = this._core.canDrop;
            const landY = this._predictLandY(this._core.dropX, tier);

            // 落点虚线：从待落水果底部一直画到落点阴影
            g.fillColor = this._color(COLORS.dropGuide, ready ? 0.3 : 0.16);
            for (let y = DROP_Y + 44; y < landY; y += 26) {
                g.rect(px - 1, PLAY_H / 2 - y + shakeY, 2, 13);
            }
            g.fill();

            // 落点阴影：地面上的一小片椭圆，玩家能预判"会停在哪一层"
            g.fillColor = this._color(0x000000, ready ? 0.32 : 0.18);
            g.ellipse(px, PLAY_H / 2 - landY - tierRadius(tier) * 0.72 + shakeY, tierRadius(tier) * 0.86, tierRadius(tier) * 0.26);
            g.fill();

            // 待落水果（半透明跟随；冷却中更淡，提示不能放）
            this._drawFruit(g, this._core.dropX + shakeX, DROP_Y + shakeY, tier, ready ? 0.7 : 0.35);
        }

        // 警戒线：常态缓慢呼吸，越线后加速加亮
        const above = this._core.aboveLineCount;
        const now = Date.now();
        const warnAlpha = above > 0
            ? 0.45 + 0.45 * Math.abs(Math.sin(now / 120))
            : 0.32 + 0.16 * Math.sin(now / 700);
        g.fillColor = this._color(COLORS.warn, warnAlpha);
        const lineY = PLAY_H / 2 - GAME_OVER_LINE;
        for (let x = WALL_T + 6; x < PLAY_W - WALL_T - 6; x += 28) {
            g.rect(-PLAY_W / 2 + x, lineY + shakeY, 14, above > 0 ? 5 : 3);
        }
        g.fill();

        // 越线预警：倒计时条 + 四周红晕。判负时点仍是 2 s，这里只把剩余时间显示出来。
        if (above > 0 && playing) {
            const progress = this._core.gameOverProgress;
            const innerW = PLAY_W - WALL_T * 2 - 48;
            const barW = Math.max(0, innerW * (1 - progress));
            if (barW > 0) {
                g.fillColor = this._color(COLORS.warn, 0.55);
                g.rect(-barW / 2, lineY - 10 + shakeY, barW, 4);
                g.fill();
            }
            const vig = 0.1 + 0.22 * progress;
            g.fillColor = this._color(COLORS.warn, vig * 0.5);
            g.rect(-PLAY_W / 2, -PLAY_H / 2, PLAY_W, 26);
            g.rect(-PLAY_W / 2, PLAY_H / 2 - 26, PLAY_W, 26);
            g.fill();
            g.fillColor = this._color(COLORS.warn, vig * 0.35);
            g.rect(-PLAY_W / 2, -PLAY_H / 2, 26, PLAY_H);
            g.rect(PLAY_W / 2 - 26, -PLAY_H / 2, 26, PLAY_H);
            g.fill();
        }

        // 合并残影：旧层级的两个果影向两侧散开并缩小
        for (let i = 0; i < this._ghosts.length; i++) {
            const ghost = this._ghosts[i];
            const t = 1 - ghost.life / ghost.maxLife;
            const scale = 1 - 0.55 * t;
            const alpha = Math.max(0, ghost.life / ghost.maxLife) * 0.55;
            this._drawFruit(
                g,
                ghost.x + ghost.dx * (0.5 + t * 1.2) + shakeX,
                ghost.y + shakeY,
                ghost.tier,
                alpha,
                0,
                scale,
                scale,
            );
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
        // 与场内水果同一套剪影，方便玩家提前认清下一颗的形状
        this._fillShape(g, 0, 0, rp, rp, tier, 0, this._color(shadeColor(fruitColor(tier), -0.42)));
        this._fillShape(g, -rp * 0.035, rp * 0.045, rp * 0.87, rp * 0.87, tier, 0, this._color(fruitColor(tier)));
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

    /** 合并瞬间的两个旧果残影：向左右散开、缩小、淡出 */
    private _spawnGhostPair(x: number, y: number, tier: number): void {
        const r = tierRadius(tier);
        const life = 0.22;
        this._ghosts.push({ x, y, tier, dx: -r * 0.5, life, maxLife: life });
        this._ghosts.push({ x, y, tier, dx: r * 0.5, life, maxLife: life });
    }

    /** 飘字：合并得分 / 连击提示。复用固定数量的 Label 节点，满池就丢弃本次飘字。 */
    private _spawnFloatText(x: number, y: number, text: string, color: number, fontSize: number): void {
        const parent = this.effectLayer;
        if (!parent) return;
        if (this._floatTexts.length >= 12) return;

        let item = this._floatPool.pop();
        if (!item) {
            const label = createLabel(parent, '', fontSize, {
                width: 280,
                height: 44,
                bold: true,
                color: UI.white,
            });
            const opacity = label.node.addComponent(UIOpacity);
            item = { node: label.node, opacity, x: 0, y: 0, life: 0, maxLife: 0 };
        }
        const label = item.node.getComponent(Label);
        if (label) {
            label.string = text;
            label.fontSize = fontSize;
            label.lineHeight = Math.round(fontSize * 1.25);
            label.color = this._color(color);
        }
        item.x = -PLAY_W / 2 + x;
        item.y = PLAY_H / 2 - y;
        item.life = 0.75;
        item.maxLife = 0.75;
        item.opacity.opacity = 255;
        item.node.active = true;
        item.node.setPosition(item.x, item.y, 0);
        this._floatTexts.push(item);
    }

    /** 预测当前 x 上水果会停下的圆心 y：取所有可能接触的水果上方与地面中最高的一层 */
    private _predictLandY(x: number, tier: number): number {
        const r = tierRadius(tier);
        let landY = PLAY_H - WALL_T - r;
        const fruits = this._core.fruits;
        for (let i = 0; i < fruits.length; i++) {
            const f = fruits[i];
            const dx = x - f.x;
            const sum = r + f.r;
            if (Math.abs(dx) >= sum) continue;
            const y = f.y - Math.sqrt(sum * sum - dx * dx);
            if (y > DROP_Y && y < landY) landY = y;
        }
        return landY;
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
        if (this._ghosts.length > 0) {
            let write = 0;
            for (let read = 0; read < this._ghosts.length; read++) {
                const ghost = this._ghosts[read];
                ghost.life -= dt;
                if (ghost.life <= 0) continue;
                this._ghosts[write++] = ghost;
            }
            this._ghosts.length = write;
        }
        if (this._floatTexts.length > 0) {
            let write = 0;
            for (let read = 0; read < this._floatTexts.length; read++) {
                const item = this._floatTexts[read];
                item.life -= dt;
                if (item.life <= 0) {
                    item.node.active = false;
                    this._floatPool.push(item);
                    continue;
                }
                const t = 1 - item.life / item.maxLife;
                item.node.setPosition(item.x, item.y + 52 * t, 0);
                item.opacity.opacity = Math.round(255 * Math.min(1, item.life / 0.22));
                this._floatTexts[write++] = item;
            }
            this._floatTexts.length = write;
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
