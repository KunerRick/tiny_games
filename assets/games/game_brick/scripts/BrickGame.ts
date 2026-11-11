/**
 * 砖块远征 — 运行时组件：把 `BrickCore` 的纯逻辑画出来、接上手势、串起面板。
 *
 * 约定：
 * - 逻辑坐标（原点左上、y 向下）只在 `BrickCore` 里用；本文件的 `_toNode*` 负责映射到节点坐标。
 * - 所有事件 handler 都是命名方法（红线 5），`onDestroy` 只用缓存节点解绑（红线 4）。
 * - 面板按钮在 `showXxx()` 里绑定、`hideXxx()` 里解绑（防崩溃守则 6）。
 * - 细线一律 `rect()+fill()`，不依赖 `stroke()`（踩坑手册 §4.5）。
 */

import { _decorator, Color, Component, EventTouch, Graphics, Input, Label, Node, UITransform, Vec3, input as globalInput } from 'cc';
import { BrickCore } from './BrickCore';
import { COLORS, PLAY_H, PLAY_W, getUpgradeDef } from './BrickConfig';
import type { UpgradeId } from './BrickConfig';
import { StorageManager } from '../../../common/managers/StorageManager';
import { SceneManager } from '../../../common/managers/SceneManager';
import { applySceneClearColor, showTutorialOnce } from '../../../common/ui/GameUIKit';
import {
    COLOR, FONT_BODY, FONT_CAPTION, FONT_DISPLAY, FONT_TITLE, applyFontAndColor,
} from '../../../common/ui/UITheme';
import {
    addDialogBackdrop, findPath, paintLabel, skinButton, skinCard, skinOverlay,
} from '../../../common/ui/SceneSkin';

const { ccclass, property } = _decorator;

const GAME_ID = 'brick';

/** 普通砖按行轮换的底色：相邻行不同色，一眼能看出反弹参照行 */
const BRICK_ROW_COLORS = [COLORS.brickHp1, 0x22c55e, 0xeab308, 0x14b8a6];
const TAP_SLOP = 12;
const PARTICLE_MAX = 140;
const SHAKE_DECAY = 8;

/** 关卡完成横幅停留时长（秒），之后才弹三选一 */
const BANNER_SEC = 0.8;

/** 碎屑 */
interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: number;
    gravity: number;
}

@ccclass('BrickGame')
export class BrickGame extends Component {
    // ==================== 场景绑定 ====================

    @property({ type: Node, tooltip: '背景/网格层（Graphics）' })
    backgroundLayer: Node | null = null;

    @property({ type: Node, tooltip: '砖块层（Graphics）' })
    brickLayer: Node | null = null;

    @property({ type: Node, tooltip: '特效层：球/挡板/激光/碎屑（Graphics）' })
    effectLayer: Node | null = null;

    @property({ type: Node, tooltip: '触摸区（660×860）' })
    inputArea: Node | null = null;

    @property({ type: Label })
    scoreLabel: Label | null = null;

    @property({ type: Label })
    livesLabel: Label | null = null;

    @property({ type: Label })
    levelLabel: Label | null = null;

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

    // 升级三选一
    @property({ type: Node })
    upgradePanel: Node | null = null;

    @property({ type: Node })
    upgradeCard0: Node | null = null;

    @property({ type: Node })
    upgradeCard1: Node | null = null;

    @property({ type: Node })
    upgradeCard2: Node | null = null;

    @property({ type: Label })
    upgradeText0: Label | null = null;

    @property({ type: Label })
    upgradeText1: Label | null = null;

    @property({ type: Label })
    upgradeText2: Label | null = null;

    // 结算
    @property({ type: Node })
    gameOverPanel: Node | null = null;

    @property({ type: Label })
    gameOverScoreLabel: Label | null = null;

    @property({ type: Label })
    gameOverBestLabel: Label | null = null;

    @property({ type: Label })
    gameOverLevelLabel: Label | null = null;

    @property({ type: Node })
    gameOverRestartButton: Node | null = null;

    @property({ type: Node })
    gameOverLobbyButton: Node | null = null;

    // ==================== 运行时 ====================

    private _core: BrickCore = new BrickCore({ seed: 1 });
    private _paused = false;
    private _upgradePicking = false;
    private _gameOverShown = false;

    private _bgGraphics: Graphics | null = null;
    private _brickGraphics: Graphics | null = null;
    private _effectGraphics: Graphics | null = null;
    private _inputTransform: UITransform | null = null;

    private _touchStartX = 0;
    private _touchStartY = 0;

    private _particles: Particle[] = [];
    private _shake = 0;

    private _brickDirty = true;
    private _lastScore = -1;
    private _lastLives = -1;
    private _lastLevel = -1;
    private _lastRemain = -1;
    private _lastCombo = -1;
    private _lastGuide = '';

    /** 关卡完成横幅：先显示 BANNER_SEC，再弹三选一 */
    private _bannerNode: Node | null = null;
    private _bannerLabel: Label | null = null;
    private _bannerTimer = 0;

    private _highScore = 0;

    // onDestroy 只用这些缓存（不访问 @property）
    private _pauseNode: Node | null = null;
    private _destroyed = false;

    /** 本次手势是从暂停按钮上开始的：整个手势都不驱动挡板，也不发球 */
    private _gestureOnButton = false;

    /** 颜色缓存：按 (hex, alpha 1/32 量化) 复用，避免每帧给粒子新建 Color */
    private _colorCache: Map<number, Color> = new Map();

    // ==================== 生命周期 ====================

    onLoad(): void {
        applySceneClearColor();
        this._bgGraphics = this._graphicsOf(this.backgroundLayer);
        this._brickGraphics = this._graphicsOf(this.brickLayer);
        this._effectGraphics = this._graphicsOf(this.effectLayer);
        this._inputTransform = this.inputArea ? this.inputArea.getComponent(UITransform) : null;

        this._highScore = this._readNumber('highScore', 0);
        StorageManager.instance.addRecentGame(GAME_ID);

        this._bindStatic();
        this._drawBackground();
        this.startNewRun();
        this._hidePanel(this.pausePanel);
        this._hidePanel(this.upgradePanel);
        this._hidePanel(this.gameOverPanel);
        this._applyUnifiedTheme();
        // 首次进入：只弹一次的浮层，说明「球要手动发射」
        showTutorialOnce(this.node, GAME_ID, '拖动挡板移动 · 点一下屏幕发球');
    }

    // ------------------------------------------------------------------
    // 统一视觉：HUD 与三个弹窗是场景手摆的（#eaf2ff / #ffd1d9 / #2f9e6e 等
    // 早期调色），按全站令牌换皮：
    //   • HUD 数值 → TEXT_PRIMARY，标题/提示 → TEXT_*；连击用 WARNING
    //   • 暂停键 → 次级按钮；弹窗按钮主操作 primary、次操作 secondary
    //   • 弹窗底 → PANEL_BG + 主色强调条，遮罩统一半透明黑
    // 逐帧绘制层（背景 / 砖块 / 特效）保持 Graphics 自绘，不在此处处理。
    // ------------------------------------------------------------------
    private _applyUnifiedTheme(): void {
        const root = this.node;

        paintLabel(root, 'HudTop/ScoreLabel', FONT_DISPLAY, COLOR.TEXT_PRIMARY);
        paintLabel(root, 'HudTop/LivesLabel', FONT_DISPLAY, COLOR.TEXT_PRIMARY);
        paintLabel(root, 'HudTop/ScoreTitle', FONT_BODY, COLOR.TEXT_SECONDARY);
        paintLabel(root, 'HudTop/LivesTitle', FONT_BODY, COLOR.TEXT_SECONDARY);
        paintLabel(root, 'HudTop/LevelLabel', FONT_BODY, COLOR.TEXT_PRIMARY);
        paintLabel(root, 'HudTop/ComboLabel', FONT_BODY, COLOR.WARNING);
        paintLabel(root, 'HudTop/GuideLabel', FONT_CAPTION, COLOR.TEXT_DISABLED);

        skinButton(root, 'PauseButton', 'secondary', 88, 56);

        // 暂停
        this._themeDialog('PausePanel', {
            title: '已暂停',
            accent: COLOR.PRIMARY,
            buttons: [
                ['ResumeButton', 'primary', 320, 80],
                ['RestartButton', 'secondary', 320, 80],
                ['LobbyButton', 'secondary', 320, 80],
            ],
        });

        // 升级三选一
        skinOverlay(root, 'UpgradePanel/Dim', 205);
        addDialogBackdrop(findPath(root, 'UpgradePanel'), { accent: COLOR.PRIMARY });
        paintLabel(root, 'UpgradePanel/Title', FONT_TITLE, COLOR.TEXT_PRIMARY);
        for (const name of ['Card0', 'Card1', 'Card2']) {
            const card = skinCard(root, `UpgradePanel/${name}`, {
                fill: COLOR.SURFACE, border: COLOR.PANEL_BORDER, radius: 16,
            });
            if (!card) continue;
            const text = card.getChildByName('Text')?.getComponent(Label);
            if (text) applyFontAndColor(text, FONT_TITLE, COLOR.TEXT_PRIMARY);
        }

        // 结算
        this._themeDialog('GameOverPanel', {
            title: '本局结束',
            accent: COLOR.PRIMARY,
            buttons: [
                ['RestartButton', 'primary', 320, 80],
                ['LobbyButton', 'secondary', 320, 80],
            ],
        });
        paintLabel(root, 'GameOverPanel/ScoreLabel', FONT_TITLE, COLOR.TEXT_PRIMARY);
        paintLabel(root, 'GameOverPanel/BestLabel', FONT_CAPTION, COLOR.TEXT_SECONDARY);
        paintLabel(root, 'GameOverPanel/LevelLabel', FONT_CAPTION, COLOR.TEXT_SECONDARY);
    }

    /** 弹窗通用换皮：遮罩 + 标题 + 按钮组（弹窗没有独立卡片，直接铺在遮罩上） */
    private _themeDialog(
        name: string,
        cfg: {
            title: string;
            accent: string;
            buttons: [string, 'primary' | 'secondary' | 'danger' | 'success', number, number][];
        },
    ): void {
        const root = this.node;
        skinOverlay(root, `${name}/Dim`, 205);
        addDialogBackdrop(findPath(root, name), { accent: cfg.accent });
        paintLabel(root, `${name}/Title`, FONT_DISPLAY, cfg.accent);
        for (const [btn, variant, w, h] of cfg.buttons) {
            skinButton(root, `${name}/${btn}`, variant, w, h);
        }
    }

    onDestroy(): void {
        this._destroyed = true;
        // 输入挂在全局 input 上，销毁时必须按同样的函数引用解绑
        globalInput.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        globalInput.off(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        globalInput.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        globalInput.off(Input.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
        const pause = this._pauseNode;
        if (pause && pause.isValid) {
            pause.off(Node.EventType.TOUCH_END, this._onPauseClicked, this);
        }
        this.unscheduleAllCallbacks();
        this._particles = [];
        this._colorCache.clear();
    }

    update(dt: number): void {
        if (this._destroyed) return;

        // 关卡完成横幅：停留一小段再把三选一推上来
        if (this._bannerTimer > 0) {
            this._bannerTimer -= dt;
            if (this._bannerTimer <= 0) {
                this._bannerTimer = 0;
                this._hideBanner();
                this._showUpgradePanel();
            }
        }

        if (!this._paused && !this._upgradePicking && !this._gameOverShown) {
            this._core.step(dt);
            this._consumeEvents();
        }

        this._updateParticles(dt);
        this._drawEffects();
        if (this._brickDirty) {
            this._drawBricks();
            this._brickDirty = false;
        }
        this._refreshHud();
    }

    // ==================== 对外：新的一局 ====================

    startNewRun(): void {
        const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
        this._core.startRun(seed);
        this._paused = false;
        this._upgradePicking = false;
        this._gameOverShown = false;
        this._particles = [];
        this._shake = 0;
        this._brickDirty = true;
        this._bannerTimer = 0;
        this._hideBanner();
        this._hidePanel(this.pausePanel);
        this._hidePanel(this.upgradePanel);
        this._hidePanel(this.gameOverPanel);
        this._writeNumber('runs', this._readNumber('runs', 0) + 1);
    }

    // ==================== 输入 ====================

    private _bindStatic(): void {
        // 整个屏幕都能拖挡板：监听挂在全局 input 上，inputArea 只当作坐标基准。
        // 节点级监听只覆盖 660×860 的棋盘，棋盘下方滑动（用户反馈的位置）会完全没反应。
        globalInput.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        globalInput.on(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        globalInput.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        globalInput.on(Input.EventType.TOUCH_CANCEL, this._onTouchCancel, this);

        if (this.pauseButton) {
            this._pauseNode = this.pauseButton;
            this.pauseButton.on(Node.EventType.TOUCH_END, this._onPauseClicked, this);
        }
    }

    private _onTouchStart(event: EventTouch): void {
        const loc = event.getUILocation();
        // 从暂停按钮上开始的手势交给按钮自己处理，别顺手把挡板拽过去
        this._gestureOnButton = this._isOverNode(this.pauseButton, loc.x, loc.y);
        if (this._gestureOnButton || !this._acceptsPlayInput()) return;

        const p = this._toLogic(loc.x, loc.y);
        this._touchStartX = p.x;
        this._touchStartY = p.y;
        this._core.setPaddleTarget(p.x);
    }

    private _onTouchMove(event: EventTouch): void {
        if (this._gestureOnButton || !this._acceptsPlayInput()) return;
        const loc = event.getUILocation();
        this._core.setPaddleTarget(this._toLogic(loc.x, loc.y).x);
    }

    private _onTouchEnd(event: EventTouch): void {
        const wasOnButton = this._gestureOnButton;
        this._gestureOnButton = false;
        if (wasOnButton || !this._acceptsPlayInput()) return;
        const loc = event.getUILocation();
        this._finishGesture(loc.x, loc.y);
    }

    /**
     * 桌面拖拽结束时引擎派发的是 TOUCH_CANCEL（不是 TOUCH_END）。
     * 轻触/拖拽的区分改看位移，所以两种结束都走同一套收尾逻辑，桌面上点击发球也不会失灵。
     */
    private _onTouchCancel(event: EventTouch): void {
        const wasOnButton = this._gestureOnButton;
        this._gestureOnButton = false;
        if (wasOnButton || !this._acceptsPlayInput()) return;
        const loc = event.getUILocation();
        this._finishGesture(loc.x, loc.y);
    }

    /** 位移不超过 TAP_SLOP 视为点击 → 发球 */
    private _finishGesture(uiX: number, uiY: number): void {
        const p = this._toLogic(uiX, uiY);
        this._core.setPaddleTarget(p.x);
        const dx = p.x - this._touchStartX;
        const dy = p.y - this._touchStartY;
        if (Math.sqrt(dx * dx + dy * dy) <= TAP_SLOP) {
            this._core.launch();
        }
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

    private _acceptsPlayInput(): boolean {
        if (this._paused || this._upgradePicking || this._gameOverShown) return false;
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
        if (this._paused || this._upgradePicking || this._gameOverShown) return;
        if (state !== 'playing' && state !== 'ready') return;
        this._paused = true;
        this._showPanel(this.pausePanel);
        this._bindPausePanel();
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

    // ==================== 升级面板 ====================

    /** 关卡完成横幅（运行时创建，不改 .scene） */
    private _showLevelBanner(level: number): void {
        const label = this._ensureBanner();
        if (this._bannerNode) {
            if (label) label.string = `第 ${level} 关完成`;
            this._bannerNode.active = true;
        }
        this._bannerTimer = BANNER_SEC;
    }

    private _hideBanner(): void {
        if (this._bannerNode && this._bannerNode.isValid) {
            this._bannerNode.active = false;
        }
    }

    private _ensureBanner(): Label | null {
        if (this._bannerLabel) return this._bannerLabel;

        const node = new Node('LevelBanner');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(520, 96);
        node.setPosition(0, 90, 0);

        // 边框用「外框实心 + 内层实心」画，不依赖 stroke（踩坑手册 §4.5）
        const g = node.addComponent(Graphics);
        g.fillColor = this._color(COLORS.paddle, 0.85);
        g.roundRect(-260, -48, 520, 96, 18);
        g.fill();
        g.fillColor = this._color(COLORS.bg, 0.94);
        g.roundRect(-257, -45, 514, 90, 16);
        g.fill();

        const textNode = new Node('Text');
        textNode.layer = node.layer;
        const textUt = textNode.addComponent(UITransform);
        textUt.setContentSize(480, 64);
        const label = textNode.addComponent(Label);
        label.string = '';
        label.fontSize = 34;
        label.lineHeight = 44;
        label.color = this._color(COLORS.text);
        label.isBold = true;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        node.addChild(textNode);

        node.active = false;
        this.node.addChild(node);
        this._bannerNode = node;
        this._bannerLabel = label;
        return label;
    }

    private _showUpgradePanel(): void {
        const choices = this._core.pendingChoices;
        if (choices.length === 0) {
            // 全部升级都满级：没有可选项时直接进下一关，不能把玩家卡在面板里
            this._core.skipUpgrade();
            this._brickDirty = true;
            return;
        }
        this._upgradePicking = true;
        this._bindUpgradeCards();
        this._fillUpgradeCard(0, this.upgradeText0, choices[0]);
        this._fillUpgradeCard(1, this.upgradeText1, choices[1]);
        this._fillUpgradeCard(2, this.upgradeText2, choices[2]);
        this._showPanel(this.upgradePanel);
    }

    private _fillUpgradeCard(index: number, label: Label | null, id: UpgradeId | undefined): void {
        const card = this._cardAt(index);
        if (card) {
            card.active = !!id;
        }
        if (!label) return;
        if (!id) {
            label.string = '';
            return;
        }
        const def = getUpgradeDef(id);
        const level = this._core.upgradeLevel(id);
        label.string = `${def.name}  ${level + 1}/${def.maxLevel}\n${def.desc}`;
    }

    private _cardAt(index: number): Node | null {
        if (index === 0) return this.upgradeCard0;
        if (index === 1) return this.upgradeCard1;
        return this.upgradeCard2;
    }

    private _bindUpgradeCards(): void {
        const cards: (Node | null)[] = [this.upgradeCard0, this.upgradeCard1, this.upgradeCard2];
        const handlers = [this._onUpgradeCard0, this._onUpgradeCard1, this._onUpgradeCard2];
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            if (!card) continue;
            card.off(Node.EventType.TOUCH_END, handlers[i], this);
            card.on(Node.EventType.TOUCH_END, handlers[i], this);
        }
    }

    private _onUpgradeCard0(): void {
        this._pickUpgrade(0);
    }

    private _onUpgradeCard1(): void {
        this._pickUpgrade(1);
    }

    private _onUpgradeCard2(): void {
        this._pickUpgrade(2);
    }

    private _pickUpgrade(index: number): void {
        if (!this._upgradePicking) return;
        const id = this._core.pendingChoices[index];
        if (!id) return;
        if (this._core.applyUpgrade(id)) {
            this._upgradePicking = false;
            this._hidePanel(this.upgradePanel);
            this._brickDirty = true;
        }
    }

    // ==================== 结算 ====================

    private _showGameOver(): void {
        if (this._gameOverShown) return;
        this._gameOverShown = true;
        this._saveRecords();
        if (this.gameOverScoreLabel) {
            this.gameOverScoreLabel.string = `得分 ${this._core.score}`;
        }
        if (this.gameOverBestLabel) {
            this.gameOverBestLabel.string = `最高 ${this._highScore}`;
        }
        if (this.gameOverLevelLabel) {
            this.gameOverLevelLabel.string = `到达第 ${this._core.level} 关`;
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
        const bestLevel = this._readNumber('bestLevel', 0);
        if (this._core.level > bestLevel) {
            this._writeNumber('bestLevel', this._core.level);
        }
    }

    // ==================== 核心事件 ====================

    private _consumeEvents(): void {
        const events = this._core.popEvents();
        for (const event of events) {
            switch (event.type) {
                case 'brick_hit':
                    this._brickDirty = true;
                    this._spawnBurst(event.x, event.y, 3, this._brickColor(event.kind, event.hp), 0.25);
                    break;
                case 'brick_destroy':
                    this._brickDirty = true;
                    this._spawnBurst(event.x, event.y, 8, this._brickColor(event.kind, 0), 0.45);
                    if (event.kind === 'bomb') {
                        this._shake = Math.max(this._shake, 8);
                        this._spawnBurst(event.x, event.y, 14, COLORS.bomb, 0.6);
                    }
                    break;
                case 'paddle_hit':
                    this._spawnBurst(event.x, event.y, 3, COLORS.paddle, 0.2);
                    break;
                case 'laser_fire':
                    this._spawnBurst(event.x, event.y, 2, COLORS.laser, 0.18);
                    break;
                case 'ball_lost':
                    this._spawnBurst(event.x, event.y, 12, COLORS.ball, 0.5);
                    this._shake = Math.max(this._shake, 6);
                    break;
                case 'level_clear':
                    this._brickDirty = true;
                    this._showLevelBanner(event.level);
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
    }

    private _drawBricks(): void {
        const g = this._brickGraphics;
        if (!g) return;
        g.clear();
        for (const brick of this._core.bricks) {
            if (!brick.alive) continue;
            const x = -PLAY_W / 2 + brick.x;
            const y = PLAY_H / 2 - brick.y - brick.h;
            g.fillColor = this._color(this._brickColor(brick.kind, brick.hp, brick.row));
            g.roundRect(x, y, brick.w, brick.h, 6);
            g.fill();

            if (brick.hp > 1) {
                // 剩余耐久用中央横条表示，不依赖字符（红线 10）
                g.fillColor = this._color(0xffffff, 0.55);
                g.rect(x + 10, y + brick.h / 2 - 2, brick.w - 20, 4);
                g.fill();
            }
            if (brick.kind === 'bomb') {
                g.fillColor = this._color(0xffffff, 0.9);
                const cx = x + brick.w / 2;
                const cy = y + brick.h / 2;
                g.rect(cx - 8, cy - 2, 16, 4);
                g.rect(cx - 2, cy - 8, 4, 16);
                g.fill();
            }
        }
    }

    private _drawEffects(): void {
        const g = this._effectGraphics;
        if (!g) return;
        g.clear();

        const shakeX = this._shake > 0.2 ? (Math.random() * 2 - 1) * this._shake : 0;
        const shakeY = this._shake > 0.2 ? (Math.random() * 2 - 1) * this._shake : 0;

        // 挡板
        const paddle = this._core.paddle;
        const px = -PLAY_W / 2 + paddle.x + shakeX;
        const py = PLAY_H / 2 - paddle.y - paddle.h / 2 + shakeY;
        g.fillColor = this._color(COLORS.paddle);
        g.roundRect(px - paddle.w / 2, py, paddle.w, paddle.h, 8);
        g.fill();

        // 激光口
        const inset = Math.min(14, paddle.w / 4);
        g.fillColor = this._color(COLORS.laser);
        g.rect(px - paddle.w / 2 + inset - 2, py + 5, 4, paddle.h - 10);
        g.rect(px + paddle.w / 2 - inset - 2, py + 5, 4, paddle.h - 10);
        g.fill();

        // 激光子弹
        for (const laser of this._core.lasers) {
            if (!laser.alive) continue;
            g.fillColor = this._color(COLORS.laser);
            g.rect(
                -PLAY_W / 2 + laser.x - laser.w / 2 + shakeX,
                PLAY_H / 2 - laser.y - laser.h / 2 + shakeY,
                laser.w,
                laser.h,
            );
            g.fill();
        }

        // 球
        for (const ball of this._core.balls) {
            const bx = -PLAY_W / 2 + ball.x + shakeX;
            const by = PLAY_H / 2 - ball.y + shakeY;
            g.fillColor = this._color(COLORS.ball);
            g.circle(bx, by, ball.r);
            g.fill();
            if (ball.stuck) {
                g.fillColor = this._color(COLORS.paddle);
                g.circle(bx, by, ball.r * 0.45);
                g.fill();
            }
        }

        // 碎屑
        for (const p of this._particles) {
            if (p.life <= 0) continue;
            const alpha = Math.max(0, p.life / p.maxLife);
            g.fillColor = this._color(p.color, alpha);
            g.circle(-PLAY_W / 2 + p.x + shakeX, PLAY_H / 2 - p.y + shakeY, p.size);
            g.fill();
        }
    }

    // ==================== HUD ====================

    private _refreshHud(): void {
        const core = this._core;
        if (core.score !== this._lastScore && this.scoreLabel) {
            this.scoreLabel.string = `${core.score}`;
            this._lastScore = core.score;
        }
        if (core.lives !== this._lastLives && this.livesLabel) {
            this.livesLabel.string = `${core.lives}`;
            this._lastLives = core.lives;
        }
        const remain = core.aliveBrickCount;
        if ((core.level !== this._lastLevel || remain !== this._lastRemain) && this.levelLabel) {
            this.levelLabel.string = `第 ${core.level} 关 · 剩余砖块 ${remain}`;
            this._lastLevel = core.level;
            this._lastRemain = remain;
        }
        if (core.combo !== this._lastCombo && this.comboLabel) {
            this.comboLabel.string = core.combo > 1 ? `连击 ${core.combo}` : '';
            this._lastCombo = core.combo;
        }
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
        if (this._upgradePicking) return '选择一个升级';
        if (this._paused) return '已暂停';
        if (this._core.state === 'ready') return '拖动挡板 · 点击发球';
        if (this._core.state === 'playing' && this._core.balls.some(b => b.stuck)) return '点击发球';
        return '';
    }

    // ==================== 粒子/震动 ====================

    private _spawnBurst(x: number, y: number, count: number, color: number, life: number): void {
        for (let i = 0; i < count; i++) {
            if (this._particles.length >= PARTICLE_MAX) break;
            const angle = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 160;
            this._particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life,
                maxLife: life,
                size: 2 + Math.random() * 3,
                color,
                gravity: 420,
            });
        }
    }

    private _updateParticles(dt: number): void {
        if (this._particles.length > 0) {
            // 原地压缩，避免每帧新建数组（微信上少一次 GC）
            let write = 0;
            for (let read = 0; read < this._particles.length; read++) {
                const p = this._particles[read];
                p.life -= dt;
                if (p.life <= 0) continue;
                p.vy += p.gravity * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                this._particles[write++] = p;
            }
            this._particles.length = write;
        }
        if (this._shake > 0) {
            this._shake = Math.max(0, this._shake - SHAKE_DECAY * dt * 10);
        }
    }

    // ==================== 小工具 ====================

    private _brickColor(kind: string, hp: number, row = 0): number {
        if (kind === 'bomb') return COLORS.bomb;
        // 耐久砖用紫/蓝明确表示「要多打几下」，普通砖按行换色（试玩报告 §3.8：
        // 整屏一片橙分不出行，反弹角度判断也少了参照）
        if (kind === 'tough') return hp >= 3 ? COLORS.brickHp3 : COLORS.brickHp2;
        if (hp >= 3) return COLORS.brickHp3;
        return BRICK_ROW_COLORS[row % BRICK_ROW_COLORS.length];
    }

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
        if (!panel.active) {
            panel.active = true;
        }
    }

    private _hidePanel(panel: Node | null): void {
        if (!panel) return;
        if (panel.active) {
            panel.active = false;
        }
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
