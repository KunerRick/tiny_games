/**
 * 数值冲刺 — 运行时组件：把 `GateCore` 的纯逻辑画出来、接上触摸、串起面板。
 *
 * 约定（同砖块远征 / 合合大作战）：
 * - 逻辑坐标（原点左上、y 向下）只存在于 `GateCore`；本文件的 `_sx` / `_sy` 负责映射到节点坐标。
 * - 所有事件 handler 都是命名方法（红线 5）；`onDestroy` 只用缓存节点解绑（红线 4）。
 * - 面板按钮在 `_bindXxx()` 里 `off` + `on`，`_hidePanel()` 里只切 `active`（防崩溃守则 6）。
 * - 细线一律 `rect()+fill()`，不依赖 `stroke()`（踩坑手册 §4.5）。
 */

import { _decorator, Color, Component, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { GateCore } from './GateCore';
import {
    BOSS_PHASE_COLORS,
    BOSS_PHASE_FLASH_SEC,
    COLORS,
    COUNT_MAX,
    ENEMY_LABEL_GAP,
    ENEMY_LABEL_MAX_W,
    GATE_H,
    GATE_LEFT_X,
    GATE_RIGHT_X,
    GATE_W,
    MAX_BULLETS,
    MAX_DEBRIS,
    MUZZLE_OFFSET_Y,
    PLAY_H,
    PLAY_W,
    PLAYER_Y,
    PULSE_COOLDOWN_SEC,
    SCROLL_BASE,
    SCROLL_MAX,
    SQUAD_DOTS_MAX,
    SQUAD_DOT_MAX_R,
    SQUAD_DOT_MIN_R,
    WEAK_GLOW_R,
    WEAK_POINT_R,
    applyGateOp,
    enemyKindLabel,
    enemyProfile,
    gateModLabel,
    gateOpColor,
    gateOpLabel,
    scrollSpeedAt,
} from './GateConfig';
import type { GateEvent, GatePair, Enemy } from './GateCore';
import { StorageManager } from '../../../common/managers/StorageManager';
import { SceneManager } from '../../../common/managers/SceneManager';
import { COLOR, FONT_BODY, FONT_CAPTION, FONT_DISPLAY } from '../../../common/ui/UITheme';
import {
    addDialogBackdrop, findPath, paintLabel, skinButton, skinOverlay,
} from '../../../common/ui/SceneSkin';

const { ccclass, property } = _decorator;

const GAME_ID = 'gate_runner';
const SHAKE_DECAY = 90;

/**
 * 位移不超过这个值算「点一下」= 集火。
 * 8 设计像素（≈4 pt）在拖拽里会被吃东西，实测横移 5 CSS 像素就点不动了（手册 §11.6），
 * 这里按逻辑坐标给 12，和砖块远征保持一致。
 */
const TAP_SLOP = 12;

/** 门板最多同时显示 4 对 → 8 个标签 */
const GATE_LABEL_POOL = 8;
/** 门板下方的结果预览 + 附加效果小字 */
const GATE_SUB_LABEL_POOL = 8;
/** 敌人 / Boss 头顶数字 */
const ENEMY_LABEL_POOL = 6;
/** 飘字池 */
const FX_LABEL_POOL = 8;
/** 升级卡：3 张，每张一个标题 + 一行说明 */
const CARD_COUNT = 3;

/** 升级卡布局（逻辑坐标） */
const CARD_W = 540;
const CARD_H = 148;
const CARD_YS = [250, 440, 630];

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

interface Bullet {
    x: number;
    y: number;
    vy: number;
    life: number;
}

interface FxText {
    label: Label;
    node: Node;
    x: number;
    y: number;
    vy: number;
    life: number;
    maxLife: number;
    hex: number;
}

@ccclass('GateGame')
export class GateGame extends Component {
    // ==================== 场景绑定 ====================

    @property({ type: Node, tooltip: '背景层（Graphics，滚动横线）' })
    backgroundLayer: Node | null = null;

    @property({ type: Node, tooltip: '世界层（Graphics：门/敌人/队伍/子弹）' })
    fieldLayer: Node | null = null;

    @property({ type: Node, tooltip: '特效层（Graphics：碎屑/命中闪光）' })
    effectLayer: Node | null = null;

    @property({ type: Node, tooltip: '触摸区（660×860）' })
    inputArea: Node | null = null;

    @property({ type: Label, tooltip: '顶部人数' })
    countLabel: Label | null = null;

    @property({ type: Label, tooltip: '顶部距离' })
    distanceLabel: Label | null = null;

    @property({ type: Label, tooltip: '底部提示语' })
    hintLabel: Label | null = null;

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
    resultPanel: Node | null = null;

    @property({ type: Label, tooltip: '「通关」/「全军覆没」' })
    resultTitleLabel: Label | null = null;

    @property({ type: Label })
    resultScoreLabel: Label | null = null;

    @property({ type: Label, tooltip: '结束时的人数与距离' })
    resultCountLabel: Label | null = null;

    @property({ type: Label })
    resultBestLabel: Label | null = null;

    @property({ type: Node })
    resultRestartButton: Node | null = null;

    @property({ type: Node })
    resultLobbyButton: Node | null = null;

    // ==================== 运行时 ====================

    private _core: GateCore = new GateCore();
    private _paused = false;
    private _resultShown = false;

    private _bgGraphics: Graphics | null = null;
    private _fieldGraphics: Graphics | null = null;
    private _effectGraphics: Graphics | null = null;
    private _inputTransform: UITransform | null = null;

    private _particles: Particle[] = [];
    private _bullets: Bullet[] = [];
    private _fxTexts: FxText[] = [];
    private _gateLabels: Label[] = [];
    private _gateSubLabels: Label[] = [];
    private _enemyLabels: Label[] = [];
    private _cardLabels: Label[] = [];       // 0–2 标题，3–5 说明
    /** 人数超出圆点表达上限时，在队伍旁显示真实人数 */
    private _squadBadgeLabel: Label | null = null;
    private _shake = 0;

    /** Boss 阶段切换闪光剩余时长（0 = 无闪光） */
    private _bossPhaseFlash = 0;

    private _fireTimer = 0;

    /** 手势起点（逻辑坐标）：用于区分「拖动选门」和「点一下集火」 */
    private _touchStartX = 0;
    private _touchStartY = 0;
    /** 本次手势是否落在暂停按钮上（落在按钮上就完全不参与玩法输入） */
    private _gestureOnButton = false;
    /** 纯表现用的时间累加（脉冲光环/呼吸），不参与任何判定 */
    private _animTime = 0;

    private _highScore = 0;
    private _lastCount = -1;
    private _lastDistance = -1;
    private _lastHint = '';

    // onDestroy 只用这些缓存（不访问 @property）
    private _inputNode: Node | null = null;
    private _pauseNode: Node | null = null;
    private _destroyed = false;

    /** 颜色缓存：按 (hex<<8|alpha) 复用 */
    private _colorCache: Map<number, Color> = new Map();

    // ==================== 生命周期 ====================

    onLoad(): void {
        this._bgGraphics = this._graphicsOf(this.backgroundLayer);
        this._fieldGraphics = this._graphicsOf(this.fieldLayer);
        this._effectGraphics = this._graphicsOf(this.effectLayer);
        this._inputNode = this.inputArea;
        this._inputTransform = this.inputArea ? this.inputArea.getComponent(UITransform) : null;

        this._highScore = this._readNumber('highScore', 0);
        StorageManager.instance.addRecentGame(GAME_ID);

        this._createLabelPools();
        this._bindStatic();
        this.startNewRun();
        this._applyUnifiedTheme();
    }

    // ------------------------------------------------------------------
    // 统一视觉：HUD 与两个弹窗按全站令牌换皮（场景是早期手摆的 #8ea3c8 标题、
    // #2a3a5c 按钮、无底板的弹窗）。玩法层 Graphics 自绘色已由 GateConfig 对齐。
    // ------------------------------------------------------------------
    private _applyUnifiedTheme(): void {
        const root = this.node;

        paintLabel(root, 'HudTop/CountTitle', FONT_BODY, COLOR.TEXT_SECONDARY);
        paintLabel(root, 'HudTop/CountLabel', FONT_DISPLAY, COLOR.TEXT_PRIMARY);
        paintLabel(root, 'HudTop/DistanceLabel', FONT_BODY, COLOR.TEXT_SECONDARY);
        paintLabel(root, 'HudTop/HintLabel', FONT_CAPTION, COLOR.TEXT_DISABLED);

        skinButton(root, 'PauseButton', 'secondary', 88, 56);

        // 暂停
        skinOverlay(root, 'PausePanel/Dim', 205);
        addDialogBackdrop(findPath(root, 'PausePanel'), { accent: COLOR.PRIMARY });
        paintLabel(root, 'PausePanel/Title', FONT_DISPLAY, COLOR.PRIMARY);
        skinButton(root, 'PausePanel/ResumeButton', 'primary', 320, 80);
        skinButton(root, 'PausePanel/RestartButton', 'secondary', 320, 80);
        skinButton(root, 'PausePanel/LobbyButton', 'secondary', 320, 80);

        // 结算（标题颜色由运行时按胜/负写入 COLORS.success / danger，不在这里覆盖）
        skinOverlay(root, 'ResultPanel/Dim', 205);
        addDialogBackdrop(findPath(root, 'ResultPanel'), { accent: COLOR.PRIMARY });
        paintLabel(root, 'ResultPanel/ResultTitle', FONT_DISPLAY, COLOR.TEXT_PRIMARY);
        paintLabel(root, 'ResultPanel/ScoreValue', FONT_DISPLAY, COLOR.TEXT_PRIMARY);
        paintLabel(root, 'ResultPanel/CountLine', FONT_CAPTION, COLOR.TEXT_SECONDARY);
        paintLabel(root, 'ResultPanel/BestValue', FONT_CAPTION, COLOR.TEXT_SECONDARY);
        skinButton(root, 'ResultPanel/RestartButton', 'primary', 320, 80);
        skinButton(root, 'ResultPanel/LobbyButton', 'secondary', 320, 80);
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
        this._bullets = [];
        this._fxTexts = [];
        this._gateLabels = [];
        this._gateSubLabels = [];
        this._enemyLabels = [];
        this._cardLabels = [];
        this._squadBadgeLabel = null;
        this._bossPhaseFlash = 0;
        this._colorCache.clear();
    }

    update(dt: number): void {
        if (this._destroyed) return;
        this._animTime += dt;

        if (!this._paused && !this._resultShown) {
            this._core.step(dt);
            this._consumeEvents();
            this._updateBullets(dt);
            this._updateFx(dt);
            if (this._bossPhaseFlash > 0) {
                this._bossPhaseFlash = Math.max(0, this._bossPhaseFlash - dt);
            }
        }

        this._drawBackground();
        this._drawWorld(dt);
        this._drawEffects();
        this._refreshHud();
    }

    // ==================== 对外：新的一局 ====================

    startNewRun(): void {
        const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
        this._core.startRun(seed);
        this._paused = false;
        this._resultShown = false;
        this._particles = [];
        this._bullets = [];
        this._shake = 0;
        this._fireTimer = 0;
        this._bossPhaseFlash = 0;
        this._gestureOnButton = false;
        this._lastCount = -1;
        this._lastDistance = -1;
        this._lastHint = '';
        this._hidePanel(this.pausePanel);
        this._hidePanel(this.resultPanel);
        this._hideFxTexts();
        for (let i = 0; i < this._cardLabels.length; i++) this._cardLabels[i].node.active = false;
        this._setWorldVisible(true);
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
        const loc = event.getUILocation();
        // 落在暂停按钮上的手势交给按钮自己处理，别让它顺带开一次集火
        this._gestureOnButton = this._isOverNode(this.pauseButton, loc.x, loc.y);
        if (this._gestureOnButton) return;

        const p = this._toLogic(loc.x, loc.y);

        // 三选一：点卡片直接选，手势到此为止（不移动、不集火）
        if (this._core.choiceOpen) {
            this._gestureOnButton = true;
            this._pickCardAt(p.x, p.y);
            return;
        }

        if (!this._acceptsPlayInput()) return;

        this._touchStartX = p.x;
        this._touchStartY = p.y;
        this._core.setPlayerX(p.x);
    }

    /** 点卡片：命中就选并给反馈。返回是否命中。 */
    private _pickCardAt(x: number, y: number): boolean {
        const options = this._core.choiceOptions;
        for (let i = 0; i < options.length && i < CARD_COUNT; i++) {
            const cy = CARD_YS[i];
            if (Math.abs(x - PLAY_W / 2) > CARD_W / 2) continue;
            if (Math.abs(y - cy) > CARD_H / 2) continue;
            if (this._core.choose(i)) {
                this._spawnBurst(x, cy, COLORS.gold, 16, 140);
                this._shake = Math.max(this._shake, 3);
            }
            return true;
        }
        return false;
    }

    private _onTouchMove(event: EventTouch): void {
        if (this._gestureOnButton) return;
        if (!this._acceptsPlayInput()) return;
        const loc = event.getUILocation();
        this._moveTo(loc.x, loc.y);
    }

    private _onTouchEnd(event: EventTouch): void {
        const wasOnButton = this._gestureOnButton;
        this._gestureOnButton = false;
        if (wasOnButton) return;
        if (!this._acceptsPlayInput()) return;
        const loc = event.getUILocation();
        this._finishGesture(loc.x, loc.y);
    }

    /**
     * 桌面拖拽结束派发的是 TOUCH_CANCEL 而不是 TOUCH_END（踩坑手册 §11）。
     * 轻触/拖拽靠位移区分，所以两种结束都走同一套收尾逻辑，桌面上「点一下集火」才不会失灵。
     */
    private _onTouchCancel(event: EventTouch): void {
        const wasOnButton = this._gestureOnButton;
        this._gestureOnButton = false;
        if (wasOnButton) return;
        if (!this._acceptsPlayInput()) return;
        const loc = event ? event.getUILocation() : null;
        if (loc) this._finishGesture(loc.x, loc.y);
    }

    /** 收尾：先对齐位置，位移不超过 TAP_SLOP 视为点击 → 集火 */
    private _finishGesture(uiX: number, uiY: number): void {
        const p = this._toLogic(uiX, uiY);
        this._core.setPlayerX(p.x);

        const dx = p.x - this._touchStartX;
        const dy = p.y - this._touchStartY;
        if (Math.sqrt(dx * dx + dy * dy) <= TAP_SLOP) this._tryPulse();
    }

    /** 集火：核心会拒绝冷却中的请求，这里只做反馈 */
    private _tryPulse(): void {
        if (!this._core.pulse()) return;
        this._spawnBurst(this._core.playerX, PLAYER_Y - 10, COLORS.gold, 14, 150);
        this._shake = Math.max(this._shake, 3);
    }

    /** UI 坐标下点是否落在节点矩形内（预留 8px 手指容差） */
    private _isOverNode(node: Node | null, uiX: number, uiY: number): boolean {
        if (!node || !node.isValid || !node.activeInHierarchy) return false;
        const transform = node.getComponent(UITransform);
        if (!transform) return false;

        const local = transform.convertToNodeSpaceAR(new Vec3(uiX, uiY, 0));
        const pad = 8;
        const left = -transform.width * transform.anchorX - pad;
        const right = transform.width * (1 - transform.anchorX) + pad;
        const bottom = -transform.height * transform.anchorY - pad;
        const top = transform.height * (1 - transform.anchorY) + pad;
        return local.x >= left && local.x <= right && local.y >= bottom && local.y <= top;
    }

    private _moveTo(uiX: number, uiY: number): void {
        const p = this._toLogic(uiX, uiY);
        this._core.setPlayerX(p.x);
    }

    private _acceptsPlayInput(): boolean {
        if (this._paused || this._resultShown) return false;
        if (this._core.choiceOpen) return false;
        return this._core.state === 'running';
    }

    private _toLogic(uiX: number, uiY: number): { x: number; y: number } {
        if (!this._inputTransform) {
            return { x: PLAY_W / 2, y: PLAY_H / 2 };
        }
        const local = this._inputTransform.convertToNodeSpaceAR(new Vec3(uiX, uiY, 0));
        return { x: local.x + PLAY_W / 2, y: PLAY_H / 2 - local.y };
    }

    // ==================== 暂停 / 结算 ====================

    private _onPauseClicked(): void {
        if (this._paused || this._resultShown) return;
        if (this._core.choiceOpen) return;
        if (this._core.state !== 'running') return;
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

    private _showResult(victory: boolean): void {
        if (this._resultShown) return;
        this._resultShown = true;
        this._saveRecords();

        if (this.resultTitleLabel) {
            this.resultTitleLabel.string = victory ? '通关！' : '全军覆没';
            this.resultTitleLabel.color = this._color(victory ? COLORS.success : COLORS.danger);
        }
        if (this.resultScoreLabel) this.resultScoreLabel.string = `${this._core.score}`;
        if (this.resultCountLabel) {
            const meters = Math.floor(this._core.distance / 10);
            this.resultCountLabel.string = `人数 ${this._core.count}  ·  ${meters} m`;
        }
        if (this.resultBestLabel) this.resultBestLabel.string = `最高分 ${this._highScore}`;

        this._bindResult();
        this._showPanel(this.resultPanel);

        // 结算面板的 Dim 是半透明的：亮色的门块 / 飘字会透上来，和「最高分」那行叠在一起。
        // 结算时把游戏世界一起收起（背景层仍保留），重开时再放回来。
        this._setWorldVisible(false);
    }

    /** 显隐世界层与特效层（结算时收起；不碰 onDestroy 路径上的引用） */
    private _setWorldVisible(visible: boolean): void {
        const field = this.fieldLayer;
        if (field && field.isValid) field.active = visible;
        const effects = this.effectLayer;
        if (effects && effects.isValid) effects.active = visible;
    }

    private _bindResult(): void {
        if (this.resultRestartButton) {
            this.resultRestartButton.off(Node.EventType.TOUCH_END, this._onRestartClicked, this);
            this.resultRestartButton.on(Node.EventType.TOUCH_END, this._onRestartClicked, this);
        }
        if (this.resultLobbyButton) {
            this.resultLobbyButton.off(Node.EventType.TOUCH_END, this._onLobbyClicked, this);
            this.resultLobbyButton.on(Node.EventType.TOUCH_END, this._onLobbyClicked, this);
        }
    }

    private _saveRecords(): void {
        const score = this._core.score;
        if (score > this._highScore) {
            this._highScore = score;
            this._writeNumber('highScore', score);
        }
    }

    private _showPanel(panel: Node | null): void {
        if (panel) panel.active = true;
    }

    private _hidePanel(panel: Node | null): void {
        if (panel) panel.active = false;
    }

    // ==================== 核心事件 ====================

    private _consumeEvents(): void {
        const events = this._core.popEvents();
        for (let i = 0; i < events.length; i++) {
            const event: GateEvent = events[i];
            switch (event.type) {
                case 'gate_hit': {
                    const color = gateOpColor(event.kind);
                    const text = `${gateOpLabel({ kind: event.kind, value: event.value })}  ${event.after}`;
                    this._spawnFxText(text, color, PLAYER_Y - 70);
                    this._spawnBurst(this._core.playerX, PLAYER_Y - 20, color, 10, 90);
                    // 队员从选中那侧的门「飞入」队伍：把门的屏幕位置作为粒子出生点
                    const gateX = event.side === 'left' ? GATE_LEFT_X + GATE_W / 2 : GATE_RIGHT_X + GATE_W / 2;
                    this._spawnGateTrail(gateX, this._screenY(event.y), color, event.after >= event.before);
                    // 完美选门：单独一行金色反馈，连击奖励再补一行
                    if (event.perfect && event.streak >= 2) {
                        this._spawnBurst(this._core.playerX, PLAYER_Y - 40, COLORS.gold, 8, 120);
                        this._spawnFxText(`完美 ×${event.streak}`, COLORS.gold, PLAYER_Y - 112);
                    }
                    if (event.bonus > 0) {
                        this._spawnFxText(`连击奖励 +${event.bonus}`, COLORS.gold, PLAYER_Y - 148);
                    }
                    if (event.mod) {
                        this._spawnFxText(gateModLabel(event.mod), COLORS.gold, PLAYER_Y - 184);
                    }
                    break;
                }
                case 'pulse':
                    this._spawnFxText('集火!', COLORS.gold, PLAYER_Y - 96);
                    break;
                case 'enemy_engaged':
                    if (event.boss) {
                        this._shake = Math.max(this._shake, 8);
                        this._spawnFxText('BOSS 战', COLORS.danger, PLAYER_Y - 130);
                    } else if (event.kind !== 'grunt') {
                        this._spawnFxText(enemyKindLabel(event.kind), enemyProfile(event.kind).color, PLAYER_Y - 130);
                    }
                    break;
                case 'boss_phase':
                    this._bossPhaseFlash = BOSS_PHASE_FLASH_SEC;
                    this._spawnFxText(event.phase === 2 ? 'Boss 强化' : 'Boss 狂暴', COLORS.danger, PLAYER_Y - 150);
                    this._shake = Math.max(this._shake, 7);
                    break;
                case 'enemy_destroyed':
                    this._spawnBurst(event.boss ? PLAY_W / 2 : this._core.playerX, PLAYER_Y - 140, COLORS.enemy, 22, 160);
                    this._shake = Math.max(this._shake, event.boss ? 12 : 4);
                    break;
                case 'squad_hit':
                    this._spawnFxText(`−${event.amount}`, COLORS.danger, PLAYER_Y - 46);
                    this._shake = Math.max(this._shake, 2);
                    break;
                case 'upgrade_chosen':
                    this._spawnFxText(`升级 · ${event.name}`, COLORS.gold, PLAYER_Y - 200);
                    break;
                case 'victory':
                    this._showResult(true);
                    break;
                case 'game_over':
                    this._showResult(false);
                    break;
                default:
                    break;
            }
        }
    }

    // ==================== 子弹 ====================

    private _updateBullets(dt: number): void {
        this._fireTimer -= dt;
        const blocking = this._blockingEnemy();
        const canFire = this._core.state === 'running' && !this._paused && !this._core.choiceOpen;

        if (canFire && this._fireTimer <= 0) {
            this._fireTimer = 1 / 30;
            this._spawnBullet(blocking);
        }

        for (let i = this._bullets.length - 1; i >= 0; i--) {
            const b = this._bullets[i];
            b.y += b.vy * dt;
            b.life -= dt;
            if (b.life <= 0 || b.y < -PLAY_H / 2) this._bullets.splice(i, 1);
        }
    }

    private _spawnBullet(target: Enemy | null): void {
        if (this._bullets.length >= MAX_BULLETS) return;
        const sx = this._core.playerX;
        let y = PLAYER_Y - MUZZLE_OFFSET_Y;
        let vy = -900;
        if (target) {
            const ty = PLAYER_Y - (target.y - this._core.distance);
            if (ty < PLAYER_Y) {
                vy = -Math.max(700, Math.min(1200, (PLAYER_Y - ty) * 2.2));
            }
        }
        this._bullets.push({ x: sx, y, vy, life: 2 });
    }

    private _blockingEnemy(): Enemy | null {
        const list = this._core.enemies;
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if (!e.alive) continue;
            if (e.y - this._core.distance <= 64) return e;
        }
        return null;
    }

    // ==================== 坐标映射 ====================

    /** 世界 y → 屏幕 y（玩家固定在 PLAYER_Y） */
    private _screenY(worldY: number): number {
        return PLAYER_Y - (worldY - this._core.distance);
    }

    /** 屏幕 x → 节点 x */
    private _sx(x: number): number {
        return -PLAY_W / 2 + x;
    }

    /** 屏幕 y → 节点 y */
    private _sy(y: number): number {
        return PLAY_H / 2 - y;
    }

    // ==================== 渲染：背景 ====================

    private _drawBackground(): void {
        const g = this._bgGraphics;
        if (!g) return;
        const left = -PLAY_W / 2;
        const bottom = -PLAY_H / 2;

        g.clear();
        g.fillColor = this._color(COLORS.bg);
        g.rect(left, bottom, PLAY_W, PLAY_H);
        g.fill();

        // 道路：中间 560 宽的一条带
        const roadW = 560;
        g.fillColor = this._color(COLORS.road);
        g.rect(left + (PLAY_W - roadW) / 2, bottom, roadW, PLAY_H);
        g.fill();

        // 滚动横线：随距离下滑，营造前进感（实心细矩形，不用 stroke）
        const offset = this._core.distance % 80;
        g.fillColor = this._color(COLORS.bgLine);
        for (let y = -offset; y < PLAY_H + 80; y += 80) {
            g.rect(left + 60, bottom + y, PLAY_W - 120, 2);
        }
        g.fill();

        // 虚线中线：选门时给左右两道的分界参考（GATE_SPLIT_X = 画面正中）
        const dash = 46;
        const dashGap = 46;
        const dashOff = this._core.distance % (dash + dashGap);
        g.fillColor = this._color(COLORS.roadEdge, 0.75);
        for (let y = -dashOff; y < PLAY_H + dash + dashGap; y += dash + dashGap) {
            g.rect(left + PLAY_W / 2 - 3, bottom + y, 6, dash);
        }
        g.fill();

        // 速度线：只放在左右路肩（对称的 [106,216] / [444,554] 设计 x 区间），
        // 数量与长度随当前速度增长；不画在中间，避免和战斗信息抢注意力。
        const speedNorm = Math.max(0, Math.min(1, (scrollSpeedAt(this._core.distance) - SCROLL_BASE) / (SCROLL_MAX - SCROLL_BASE)));
        const lineCount = 8 + Math.round(speedNorm * 8);
        const span = PLAY_H + 40;
        // 随距离**向下**漂移（与滚动横线同向）；JS 取模对负数返回负值，先加 span 再取模
        const drift = this._core.distance * (0.9 + 0.8 * speedNorm);
        g.fillColor = this._color(COLORS.roadEdge, 0.22 + speedNorm * 0.45);
        for (let i = 0; i < lineCount; i++) {
            const k = i % 2 === 0
                ? 106 + ((i * 137 + 23) % 110)
                : 444 + ((i * 97 + 11) % 110);
            const ly = (((i * 211 - drift) % span) + span) % span - 20;
            const len = 12 + speedNorm * 26 + (i % 3) * 6;
            g.rect(k - PLAY_W / 2, bottom + ly, 3, len);
        }
        g.fill();

        // 左右路肩
        g.fillColor = this._color(COLORS.roadEdge);
        g.rect(left + 46, bottom, 4, PLAY_H);
        g.rect(left + PLAY_W - 50, bottom, 4, PLAY_H);
        g.fill();
    }

    // ==================== 渲染：世界 ====================

    private _drawWorld(dt: number): void {
        const g = this._fieldGraphics;
        if (!g) return;
        g.clear();

        const shakeX = this._shake > 0.2 ? (Math.random() * 2 - 1) * this._shake : 0;
        const shakeY = this._shake > 0.2 ? (Math.random() * 2 - 1) * this._shake : 0;
        this._shake = Math.max(0, this._shake - SHAKE_DECAY * dt);

        this._drawGates(g, shakeX, shakeY);
        this._drawEnemies(g, shakeX, shakeY);
        this._drawBullets(g, shakeX, shakeY);
        this._drawSquad(g, shakeX, shakeY);
    }

    private _drawGates(g: Graphics, dx: number, dy: number): void {
        let labelIndex = 0;
        const gates = this._core.gates;

        for (let i = 0; i < gates.length; i++) {
            const gate = gates[i];
            const sy = this._screenY(gate.y);
            if (sy < -GATE_H || sy > PLAY_H + GATE_H) continue;
            if (gate.left.used) continue;

            this._drawGateSide(g, gate, 'left', sy + dy);
            this._drawGateSide(g, gate, 'right', sy + dy);

            // 文字：每对门两个标签，外加下方「结果预览 + 附加效果」小字
            this._placeGateLabel(labelIndex, gate, 'left', sy);
            this._placeGateLabel(labelIndex + 1, gate, 'right', sy);
            this._placeGateSubLabel(labelIndex, gate, 'left', sy);
            this._placeGateSubLabel(labelIndex + 1, gate, 'right', sy);
            labelIndex += 2;
        }

        for (let i = labelIndex; i < this._gateLabels.length; i++) {
            this._gateLabels[i].node.active = false;
        }
        for (let i = labelIndex; i < this._gateSubLabels.length; i++) {
            this._gateSubLabels[i].node.active = false;
        }
    }

    private _drawGateSide(g: Graphics, gate: GatePair, side: 'left' | 'right', screenY: number): void {
        const entry = side === 'left' ? gate.left : gate.right;
        const x0 = side === 'left' ? GATE_LEFT_X : GATE_RIGHT_X;
        const nx = this._sx(x0);
        const ny = this._sy(screenY) - GATE_H / 2;

        g.fillColor = this._color(gateOpColor(entry.op.kind), 0.32);
        g.roundRect(nx, ny, GATE_W, GATE_H, 14);
        g.fill();

        g.fillColor = this._color(gateOpColor(entry.op.kind), 0.9);
        g.rect(nx + 28, ny + GATE_H - 6, GATE_W - 56, 4);
        g.fill();

        // 方向箭头：变多朝上、变少朝下。颜色 + 箭头双通道，不看数字也能读出趋势。
        const gain = entry.op.kind === 'mul' || entry.op.kind === 'add';
        const ax = nx + 26;
        const ay = ny + GATE_H / 2;
        g.fillColor = this._color(gateOpColor(entry.op.kind), 0.95);
        if (gain) {
            g.moveTo(ax, ay + 13);
            g.lineTo(ax - 10, ay - 8);
            g.lineTo(ax + 10, ay - 8);
        } else {
            g.moveTo(ax, ay - 13);
            g.lineTo(ax - 10, ay + 8);
            g.lineTo(ax + 10, ay + 8);
        }
        g.close();
        g.fill();

        // 带附加效果的一侧加一条金色底线，和「纯数字门」区分开
        if (entry.mod) {
            g.fillColor = this._color(COLORS.gold, 0.95);
            g.rect(nx + 16, ny + 10, GATE_W - 32, 5);
            g.fill();
        }
    }

    private _placeGateLabel(index: number, gate: GatePair, side: 'left' | 'right', screenY: number): void {
        const label = this._gateLabels[index];
        if (!label) return;
        const entry = side === 'left' ? gate.left : gate.right;
        const x0 = side === 'left' ? GATE_LEFT_X : GATE_RIGHT_X;

        label.string = gateOpLabel(entry.op);
        label.color = this._color(gateOpColor(entry.op.kind));
        label.node.active = true;
        label.node.setPosition(this._sx(x0 + GATE_W / 2), this._sy(screenY - 12), 0);
    }

    /** 门下方小字：这一侧「换算成多少」+ 附加效果 */
    private _placeGateSubLabel(index: number, gate: GatePair, side: 'left' | 'right', screenY: number): void {
        const label = this._gateSubLabels[index];
        if (!label) return;
        const entry = side === 'left' ? gate.left : gate.right;
        const x0 = side === 'left' ? GATE_LEFT_X : GATE_RIGHT_X;

        const preview = applyGateOp(this._core.count, entry.op);
        label.string = entry.mod ? `→ ${preview} · ${gateModLabel(entry.mod)}` : `→ ${preview}`;
        label.color = this._color(entry.mod ? COLORS.gold : COLORS.textDim);
        label.node.active = true;
        label.node.setPosition(this._sx(x0 + GATE_W / 2), this._sy(screenY + 28), 0);
    }

    private _drawEnemies(g: Graphics, dx: number, dy: number): void {
        let labelIndex = 0;
        const list = this._core.enemies;

        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if (!e.alive) continue;
            const sy = this._screenY(e.y);
            if (sy < -200 || sy > PLAY_H + 200) continue;

            const w = e.width;
            const h = e.boss ? 120 : 76;
            const nx = this._sx(PLAY_W / 2) - w / 2 + dx;
            const ny = this._sy(sy) - h / 2 + dy;

            const prof = enemyProfile(e.kind);
            if (e.boss) {
                this._drawBossBody(g, e, nx, ny, w, h);
            } else {
                g.fillColor = this._color(prof.color, 0.85);
                g.roundRect(nx, ny, w, h, 12);
                g.fill();

                // 眼睛/灯带：让方块看着不像纯色块
                g.fillColor = this._color(0x000000, 0.28);
                g.rect(nx + 12, ny + h - 18, w - 24, 6);
                g.fill();
            }

            // 血条：实心矩形
            const barW = w - 24;
            const ratio = e.maxHp > 0 ? Math.max(0, e.hp / e.maxHp) : 0;
            g.fillColor = this._color(0x000000, 0.45);
            g.rect(nx + 12, ny + h + 10, barW, 10);
            g.fill();
            g.fillColor = this._color(e.boss ? COLORS.boss : COLORS.danger);
            g.rect(nx + 12, ny + h + 10, barW * ratio, 10);
            g.fill();

            // 弱点：对拼时左右摆动的金色靶心，队伍停在它下方 = dps 放大。
            // 靶心直径 = 44 设计像素（触屏命中区下限），外圈只做呼吸提示，不参与判定。
            if (e.engaged && e.alive) {
                const wx = this._sx(e.weakX) + dx;
                const wy = this._sy(sy) + dy;
                const breath = 0.7 + 0.3 * Math.sin(this._animTime * 9);
                g.fillColor = this._color(COLORS.gold, 0.2 * breath);
                g.circle(wx, wy, WEAK_GLOW_R);
                g.fill();
                g.fillColor = this._color(COLORS.gold, 0.95);
                g.circle(wx, wy, WEAK_POINT_R);
                g.fill();
                g.fillColor = this._color(COLORS.bg, 0.9);
                g.circle(wx, wy, WEAK_POINT_R * 0.36);
                g.fill();
                // 左右准星短线：44 px 的靶心在 300+ 敌人同屏时也能一眼认出
                g.fillColor = this._color(COLORS.gold, 0.9);
                g.rect(wx - WEAK_POINT_R - 14, wy - 2, 10, 4);
                g.rect(wx + WEAK_POINT_R + 4, wy - 2, 10, 4);
                g.fill();
            }

            // 数字
            const label = this._enemyLabels[labelIndex];
            if (label) {
                const name = e.boss ? 'BOSS' : enemyKindLabel(e.kind);
                label.string = `${name} ${Math.max(0, Math.ceil(e.hp))}`;
                label.node.active = true;
                // 血条占 [h+10, h+20]，名字中心再往上让出 4 px 间距 + 半个行高
                const labelY = this._sy(sy) + h / 2 + 20 + ENEMY_LABEL_GAP + 16 + dy;
                label.node.setPosition(this._sx(PLAY_W / 2) + dx, labelY, 0);
            }
            labelIndex++;
        }

        for (let i = labelIndex; i < this._enemyLabels.length; i++) {
            this._enemyLabels[i].node.active = false;
        }
    }

    /**
     * Boss：三阶段靠「环数 + 配色 + 核心」区分，阶段越高环越多、核心越大。
     * 对拼时有一圈缓慢外扩的攻击脉冲，阶段切换瞬间叠一层 0.5 s 白光。
     */
    private _drawBossBody(g: Graphics, e: Enemy, nx: number, ny: number, w: number, h: number): void {
        const phase = Math.max(1, Math.min(3, e.phase || 1));
        const color = BOSS_PHASE_COLORS[phase - 1] || COLORS.boss;
        const flash = this._bossPhaseFlash > 0
            ? this._bossPhaseFlash / BOSS_PHASE_FLASH_SEC
            : 0;

        // 攻击脉冲（画在身体下层，只露出外圈）：越到后期越快、越亮
        if (e.engaged) {
            const period = 1.0 - phase * 0.15;
            const k = (this._animTime % period) / period;
            g.fillColor = this._color(color, (1 - k) * 0.28);
            g.circle(nx + w / 2, ny + h / 2, 70 + k * (110 + phase * 20));
            g.fill();
        }

        // 阶段环：phase = 1/2/3 → 0/1/2 层外扩描边（用半透明填充近似）
        for (let i = phase - 1; i >= 1; i--) {
            const inset = i * 12;
            g.fillColor = this._color(color, 0.10 + 0.05 * i + flash * 0.2);
            g.roundRect(nx - inset, ny - inset, w + inset * 2, h + inset * 2, 18);
            g.fill();
        }

        g.fillColor = this._color(flash > 0.2 ? 0xfff1f1 : color, 0.95);
        g.roundRect(nx, ny, w, h, 14);
        g.fill();

        // 核心单眼：阶段越高越大
        const cx = nx + w / 2;
        const cy = ny + h / 2;
        g.fillColor = this._color(0x000000, 0.4);
        g.circle(cx, cy, 24 + phase * 6);
        g.fill();
        g.fillColor = this._color(flash > 0.2 ? 0xffffff : COLORS.gold, 0.95);
        g.circle(cx, cy, 12 + phase * 3);
        g.fill();

        // 阶段角标：左侧三条竖杠，亮起的条数 = 当前阶段
        g.fillColor = this._color(0x000000, 0.35);
        g.rect(nx + 10, ny + h / 2 - 22, 8, 44);
        g.fill();
        g.fillColor = this._color(color, 0.95);
        g.rect(nx + 10, ny + h / 2 - 22, 8, (44 * phase) / 3);
        g.fill();
    }

    private _drawBullets(g: Graphics, dx: number, dy: number): void {
        g.fillColor = this._color(COLORS.ally);
        for (let i = 0; i < this._bullets.length; i++) {
            const b = this._bullets[i];
            g.rect(this._sx(b.x) - 2 + dx, this._sy(b.y) - 8 + dy, 4, 14);
        }
        g.fill();
    }

    private _drawSquad(g: Graphics, dx: number, dy: number): void {
        const count = this._core.count;
        const visible = Math.min(count, SQUAD_DOTS_MAX);
        const px = this._sx(this._core.playerX) + dx;
        const py = this._sy(PLAYER_Y) + dy;

        if (visible <= 0) {
            if (this._squadBadgeLabel) this._squadBadgeLabel.node.active = false;
            return;
        }

        // 集火光环：生效中在队伍外圈画一层金色呼吸光（细线用 rect/circle + fill，不用 stroke）
        if (this._core.pulseActive) {
            const wave = Math.sin(this._animTime * 14);
            g.fillColor = this._color(COLORS.gold, 0.16 + 0.12 * wave);
            g.circle(px, py, 64 + wave * 4);
            g.fill();
        }

        // 弱点命中：外圈金色准星 + 前方指示，告诉玩家「现在就打在这」
        if (this._core.aiming) {
            g.fillColor = this._color(COLORS.gold, 0.28);
            g.circle(px, py, 44);
            g.fill();
            g.fillColor = this._color(COLORS.gold, 0.85);
            g.rect(px - 3, py + 34, 6, 24);
            g.fill();
        }

        const cols = Math.ceil(Math.sqrt(visible));
        const rows = Math.ceil(visible / cols);
        const spread = 56;
        const stepX = cols > 1 ? spread / (cols - 1) : 0;
        const stepY = rows > 1 ? spread / (rows - 1) : 0;
        const radius = visible <= 1
            ? SQUAD_DOT_MAX_R
            : Math.max(SQUAD_DOT_MIN_R, SQUAD_DOT_MAX_R - (visible / SQUAD_DOTS_MAX) * (SQUAD_DOT_MAX_R - SQUAD_DOT_MIN_R));

        const t = this._core.distance * 0.02;
        let drawn = 0;
        for (let r = 0; r < rows && drawn < visible; r++) {
            for (let c = 0; c < cols && drawn < visible; c++) {
                const ox = cols > 1 ? -spread / 2 + c * stepX : 0;
                const oy = rows > 1 ? -spread / 2 + r * stepY : 0;
                const bob = Math.sin(t + drawn * 0.7) * 2;
                g.fillColor = this._color(drawn % 5 === 0 ? COLORS.allyDark : COLORS.ally);
                g.circle(px + ox, py + oy + bob, radius);
                g.fill();
                drawn++;
            }
        }

        // 人数徽标：圆点最多 40 个，超过之后画面不再随人数变化，
        // 用队伍**下方**的小胶囊补回「现在到底多少人」。
        // 放上方会和「对拼时敌人身上的金色弱点」抢同一个位置，把判定点挡掉。
        const badge = this._squadBadgeLabel;
        if (badge) {
            if (count > SQUAD_DOTS_MAX) {
                const text = `${count}`;
                const pillW = Math.max(56, 18 + text.length * 12);
                const pillH = 26;
                const pillX = px - pillW / 2;
                // 避让集火冷却条（py-66 起、高 6），再往下留 12 px 间距
                const pillY = py - 104;
                if (badge.string !== text) badge.string = text;
                badge.node.active = true;
                badge.node.setPosition(px, pillY + pillH / 2, 0);
                g.fillColor = this._color(COLORS.badge, 0.8);
                g.roundRect(pillX, pillY, pillW, pillH, 13);
                g.fill();
                g.fillColor = this._color(COLORS.gold, 0.8);
                g.rect(pillX + 8, pillY + pillH - 4, pillW - 16, 3);
                g.fill();
            } else {
                badge.node.active = false;
            }
        }

        // 火力上限提示：dps 封顶后不再有额外收益
        if (count > this._core.fireCap) {
            g.fillColor = this._color(COLORS.allyDark, 0.5);
            g.rect(px - 30, py - 46, 60, 4);
            g.fill();
        }

        // 集火冷却条：满了=可点（慢呼吸），生效中=金色全满，冷却中=暗色回填
        const barW = 76;
        const barH = 6;
        const barX = px - barW / 2;
        const barY = py - 66;
        const pulseActive = this._core.pulseActive;
        const pulseReady = this._core.pulseReady;
        const fill = pulseActive || pulseReady
            ? 1
            : 1 - Math.max(0, Math.min(1, this._core.pulseCooldown / PULSE_COOLDOWN_SEC));

        g.fillColor = this._color(0x000000, 0.45);
        g.rect(barX, barY, barW, barH);
        g.fill();

        if (fill > 0) {
            const alpha = pulseActive
                ? 0.95
                : (pulseReady ? 0.55 + 0.45 * Math.sin(this._animTime * 6) : 0.6);
            g.fillColor = this._color(pulseReady || pulseActive ? COLORS.gold : COLORS.goldDark, alpha);
            g.rect(barX, barY, barW * fill, barH);
            g.fill();
        }
    }

    // ==================== 渲染：特效 ====================

    private _drawEffects(): void {
        const g = this._effectGraphics;
        if (!g) return;
        g.clear();

        for (let i = 0; i < this._particles.length; i++) {
            const p = this._particles[i];
            const alpha = Math.max(0, p.life / p.maxLife);
            g.fillColor = this._color(p.color, alpha);
            g.rect(this._sx(p.x) - p.size / 2, this._sy(p.y) - p.size / 2, p.size, p.size);
        }
        g.fill();

        // Boss 阶段切换闪光：一圈从 Boss 身上扩散出去的实心碎片环 + 一层淡红压屏。
        // 阶段判定本身在 `_drawBossBody`（本体描边换色），这里只补"什么时候变了"的瞬时提示。
        if (this._bossPhaseFlash > 0) {
            const k = Math.max(0, Math.min(1, this._bossPhaseFlash / BOSS_PHASE_FLASH_SEC));
            const boss = this._core.enemies.find((e) => e.boss && e.alive);
            if (boss) {
                const bx = this._sx(PLAY_W / 2);
                const by = this._sy(this._screenY(boss.y));
                const r = 70 + (1 - k) * 210;
                const segs = 44;
                g.fillColor = this._color(COLORS.danger, 0.55 * k);
                for (let i = 0; i < segs; i++) {
                    const a = (i / segs) * Math.PI * 2;
                    g.rect(bx + Math.cos(a) * r - 5, by + Math.sin(a) * r - 5, 10, 10);
                }
                g.fill();
            }
            g.fillColor = this._color(COLORS.danger, 0.1 * k);
            g.rect(-PLAY_W / 2, -PLAY_H / 2, PLAY_W, PLAY_H);
            g.fill();
        }

        this._drawChoiceCards(g);
    }

    /** 三选一：世界之上盖一层卡牌（点卡片选择，见 `_pickCardAt`） */
    private _drawChoiceCards(g: Graphics): void {
        const options = this._core.choiceOptions;
        if (!this._core.choiceOpen || options.length === 0) {
            for (let i = 0; i < this._cardLabels.length; i++) this._cardLabels[i].node.active = false;
            return;
        }

        g.fillColor = this._color(0x000000, 0.5);
        g.rect(-PLAY_W / 2, -PLAY_H / 2, PLAY_W, PLAY_H);
        g.fill();

        for (let i = 0; i < CARD_COUNT && i < options.length; i++) {
            const cy = CARD_YS[i];
            const nx = this._sx(PLAY_W / 2) - CARD_W / 2;
            const ny = this._sy(cy) - CARD_H / 2;

            g.fillColor = this._color(COLORS.card, 0.97);
            g.roundRect(nx, ny, CARD_W, CARD_H, 16);
            g.fill();
            g.fillColor = this._color(COLORS.cardEdge, 0.85);
            g.rect(nx + 18, ny + 26, 5, CARD_H - 52);
            g.fill();
            g.fillColor = this._color(COLORS.cardEdge, 0.55);
            g.rect(nx, ny + CARD_H - 4, CARD_W, 4);
            g.fill();

            const title = this._cardLabels[i];
            const desc = this._cardLabels[CARD_COUNT + i];
            if (title) {
                title.string = options[i].name;
                title.color = this._color(COLORS.cardInk);
                title.node.active = true;
                title.node.setPosition(this._sx(PLAY_W / 2) + 6, this._sy(cy - 26), 0);
            }
            if (desc) {
                desc.string = options[i].desc;
                desc.color = this._color(COLORS.cardDesc);
                desc.node.active = true;
                desc.node.setPosition(this._sx(PLAY_W / 2) + 6, this._sy(cy + 26), 0);
            }
        }

        for (let i = options.length; i < CARD_COUNT; i++) {
            if (this._cardLabels[i]) this._cardLabels[i].node.active = false;
            if (this._cardLabels[CARD_COUNT + i]) this._cardLabels[CARD_COUNT + i].node.active = false;
        }
    }

    private _updateFx(dt: number): void {
        for (let i = this._particles.length - 1; i >= 0; i--) {
            const p = this._particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 700 * dt;
            p.life -= dt;
            if (p.life <= 0) this._particles.splice(i, 1);
        }

        for (let i = this._fxTexts.length - 1; i >= 0; i--) {
            const f = this._fxTexts[i];
            if (!f.node.active) continue;
            f.life -= dt;
            f.y += f.vy * dt;
            if (f.life <= 0) {
                f.node.active = false;
                continue;
            }
            const alpha = Math.min(1, (f.life / f.maxLife) * 2);
            f.label.color = this._color(f.hex, alpha);
            f.node.setPosition(this._sx(f.x), this._sy(f.y), 0);
        }
    }

    private _spawnBurst(x: number, y: number, color: number, n: number, speed: number): void {
        for (let i = 0; i < n; i++) {
            if (this._particles.length >= MAX_DEBRIS) break;
            const angle = Math.random() * Math.PI * 2;
            const v = speed * (0.4 + Math.random() * 0.8);
            this._particles.push({
                x,
                y,
                vx: Math.cos(angle) * v,
                vy: Math.sin(angle) * v,
                life: 0.35 + Math.random() * 0.35,
                maxLife: 0.7,
                size: 3 + Math.random() * 4,
                color,
            });
        }
    }

    /**
     * 门触发时，从选中那侧的门向队伍拖一条粒子流（表现"队员从门里加入队伍"）。
     *
     * 坐标是设计坐标（与 _spawnBurst 一致）：x 沿用逻辑 x，y 是 _screenY() 算出的屏幕 y。
     * 粒子带一点横向散开，越靠门越亮 —— 直接复用 _particles 与 _updateFx 的重力，
     * 所以重力项在这里被直线速度盖过，视觉上仍是"飞向队伍"而不是"往下掉"。
     */
    private _spawnGateTrail(x: number, screenY: number, color: number, gain: boolean): void {
        const tx = this._core.playerX;
        const ty = PLAYER_Y - 30;
        const n = gain ? 16 : 12;
        for (let i = 0; i < n; i++) {
            if (this._particles.length >= MAX_DEBRIS) break;
            const t = i / Math.max(1, n - 1);
            const sx = x + (tx - x) * t * 0.35 + (Math.random() - 0.5) * 46;
            const sy = screenY + (ty - screenY) * t * 0.3 + (Math.random() - 0.5) * 18;
            // 速度指向队伍，后半段更快，让"吸收"发生在队伍身上
            const vx = (tx - sx) * (1.4 + t * 1.2);
            const vy = (ty - sy) * (1.4 + t * 1.2);
            this._particles.push({
                x: sx,
                y: sy,
                vx,
                vy,
                life: 0.34 + t * 0.26,
                maxLife: 0.6,
                size: gain ? 4 + Math.random() * 4 : 3 + Math.random() * 3,
                color,
            });
        }
    }

    private _spawnFxText(text: string, color: number, y: number): void {
        if (this._fxTexts.length === 0) return;
        // 先找空闲的，池满就抢占（飘字只是表现，丢一两条无所谓）
        let fx = this._fxTexts.find((f) => !f.node.active);
        if (!fx) fx = this._fxTexts[0];

        fx.node.active = true;
        fx.label.string = text;
        fx.hex = color;
        fx.label.color = this._color(color);
        fx.x = this._core.playerX;
        fx.y = y;
        fx.vy = -70;
        fx.life = 0.8;
        fx.maxLife = 0.8;
        fx.node.setPosition(this._sx(fx.x), this._sy(fx.y), 0);
    }

    private _hideFxTexts(): void {
        for (let i = 0; i < this._fxTexts.length; i++) {
            this._fxTexts[i].life = 0;
            this._fxTexts[i].node.active = false;
        }
    }

    // ==================== 标签池 ====================

    private _createLabelPools(): void {
        const fieldParent = this.fieldLayer;
        if (fieldParent) {
            for (let i = 0; i < GATE_LABEL_POOL; i++) {
                const label = this._makeLabel(fieldParent, 38, COLORS.text);
                if (label) this._gateLabels.push(label);
            }
            for (let i = 0; i < GATE_SUB_LABEL_POOL; i++) {
                const label = this._makeLabel(fieldParent, 20, COLORS.textDim);
                if (label) this._gateSubLabels.push(label);
            }
            for (let i = 0; i < ENEMY_LABEL_POOL; i++) {
                const label = this._makeLabel(fieldParent, 26, COLORS.text, ENEMY_LABEL_MAX_W);
                if (label) this._enemyLabels.push(label);
            }

            // 人数徽标：人多到圆点画不全时，在队伍上方补一个数字胶囊
            this._squadBadgeLabel = this._makeLabel(fieldParent, 24, COLORS.gold, 180);
            if (this._squadBadgeLabel) this._squadBadgeLabel.node.active = false;
        }

        const fxParent = this.effectLayer;
        if (fxParent) {
            for (let i = 0; i < FX_LABEL_POOL; i++) {
                const label = this._makeLabel(fxParent, 34, COLORS.text);
                if (!label) break;
                this._fxTexts.push({
                    label, node: label.node,
                    x: 0, y: 0, vy: 0, life: 0, maxLife: 1, hex: COLORS.text,
                });
            }

            // 升级卡：0–2 标题，3–5 说明
            for (let i = 0; i < CARD_COUNT; i++) {
                const title = this._makeLabel(fxParent, 32, COLORS.cardInk);
                if (title) this._cardLabels.push(title);
            }
            for (let i = 0; i < CARD_COUNT; i++) {
                const desc = this._makeLabel(fxParent, 21, COLORS.cardDesc);
                if (desc) this._cardLabels.push(desc);
            }
        }
    }

    /**
     * @param maxWidth > 0 时把节点宽度钳到这个值并开启 SHRINK，
     *                 长文本按宽度缩字而不是横向撑开压住邻居（如「再生」+ 长血量数字）。
     */
    private _makeLabel(parent: Node | null, size: number, color: number, maxWidth: number = 0): Label | null {
        if (!parent) return null;
        const node = new Node('FxLabel');
        node.layer = parent.layer;
        node.active = false;
        parent.addChild(node);
        const label = node.addComponent(Label);
        label.fontSize = size;
        label.lineHeight = size + 6;
        label.color = this._color(color);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.isBold = true;
        if (maxWidth > 0) {
            // 限宽用 SHRINK：长名字自动缩字号而不是换行。
            // 高度必须给足（= lineHeight + 上下留白），contentSize 高度为 0 时 SHRINK 会把文字裁成 0 高 → 完全不可见。
            const ut = node.getComponent(UITransform);
            if (ut) ut.setContentSize(maxWidth, label.lineHeight + 8);
            label.overflow = Label.Overflow.SHRINK;
            label.enableWrapText = false;
        }
        return label;
    }

    // ==================== HUD ====================

    private _refreshHud(): void {
        const count = this._core.count;
        if (this.countLabel && count !== this._lastCount) {
            this._lastCount = count;
            this.countLabel.string = `${count}`;
            this.countLabel.color = this._color(count > this._core.fireCap ? COLORS.ally : COLORS.text);
        }

        const meters = Math.floor(this._core.distance / 10);
        if (this.distanceLabel && meters !== this._lastDistance) {
            this._lastDistance = meters;
            const speed = Math.round(scrollSpeedAt(this._core.distance) / 10);
            this.distanceLabel.string = `${meters} m  ·  ${speed} km/h`;
        }

        if (this.hintLabel) {
            const hint = this._hintFor(count);
            if (hint !== this._lastHint) {
                this._lastHint = hint;
                this.hintLabel.string = hint;
            }
        }
    }

    private _hintFor(count: number): string {
        if (this._core.choiceOpen) return '选一张升级卡 · 点卡片';
        if (this._core.state === 'game_over') return '人数归零 · 再来一局';
        if (this._core.state === 'victory') return '已通关';
        const blocking = this._blockingEnemy();
        if (blocking) {
            if (this._core.aiming) return '弱点命中 · 点屏幕集火';
            if (blocking.boss) {
                return this._core.pulseReady ? 'Boss 战 · 对准金色弱点' : 'Boss 战 · 集火冷却中';
            }
            return this._core.pulseReady ? '对准金色弱点 · 点屏幕集火' : '对准金色弱点 · 集火冷却中';
        }
        if (count > this._core.fireCap) return '火力已封顶 · 优先选 × 门攒血量';
        if (count > COUNT_MAX - 1) return '人数已封顶';
        if (this._core.activeMods.length > 0) return '拖动选门 · 金色门附带持续效果';
        return '拖动选门 · 点屏幕集火';
    }

    // ==================== 工具 ====================

    private _graphicsOf(node: Node | null): Graphics | null {
        return node ? node.getComponent(Graphics) : null;
    }

    private _color(hex: number, alpha: number = 1): Color {
        const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
        const key = (hex << 8) | a;
        let c = this._colorCache.get(key);
        if (!c) {
            c = new Color((hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, a);
            this._colorCache.set(key, c);
        }
        return c;
    }

    private _readNumber(key: string, fallback: number): number {
        const raw = StorageManager.instance.getItem(GAME_ID, key);
        if (raw === null || raw === '') return fallback;
        const v = parseFloat(raw);
        return isFinite(v) ? v : fallback;
    }

    private _writeNumber(key: string, value: number): void {
        StorageManager.instance.setItem(GAME_ID, key, `${value}`);
    }
}
