/**
 * 砖块远征 — 运行时组件：把 `BrickCore` 的纯逻辑画出来、接上手势、串起面板。
 *
 * 约定：
 * - 逻辑坐标（原点左上、y 向下）只在 `BrickCore` 里用；本文件的 `_toNode*` 负责映射到节点坐标。
 * - 所有事件 handler 都是命名方法（红线 5），`onDestroy` 只用缓存节点解绑（红线 4）。
 * - 面板按钮在 `showXxx()` 里绑定、`hideXxx()` 里解绑（防崩溃守则 6）。
 * - 细线一律 `rect()+fill()`，不依赖 `stroke()`（踩坑手册 §4.5）。
 */

import { _decorator, Color, Component, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { BrickCore } from './BrickCore';
import { COLORS, PLAY_H, PLAY_W, getUpgradeDef } from './BrickConfig';
import type { UpgradeId } from './BrickConfig';
import { StorageManager } from '../../../common/managers/StorageManager';
import { SceneManager } from '../../../common/managers/SceneManager';

const { ccclass, property } = _decorator;

const GAME_ID = 'brick';
const TAP_SLOP = 12;
const PARTICLE_MAX = 140;
const SHAKE_DECAY = 8;

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
    private _lastCombo = -1;
    private _lastGuide = '';

    private _highScore = 0;

    // onDestroy 只用这些缓存（不访问 @property）
    private _inputNode: Node | null = null;
    private _pauseNode: Node | null = null;
    private _destroyed = false;

    /** 颜色缓存：按 (hex, alpha 1/32 量化) 复用，避免每帧给粒子新建 Color */
    private _colorCache: Map<number, Color> = new Map();

    // ==================== 生命周期 ====================

    onLoad(): void {
        this._bgGraphics = this._graphicsOf(this.backgroundLayer);
        this._brickGraphics = this._graphicsOf(this.brickLayer);
        this._effectGraphics = this._graphicsOf(this.effectLayer);
        this._inputNode = this.inputArea;
        this._inputTransform = this.inputArea ? this.inputArea.getComponent(UITransform) : null;

        this._highScore = this._readNumber('highScore', 0);
        StorageManager.instance.addRecentGame(GAME_ID);

        this._bindStatic();
        this._drawBackground();
        this.startNewRun();
        this._hidePanel(this.pausePanel);
        this._hidePanel(this.upgradePanel);
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
        this._colorCache.clear();
    }

    update(dt: number): void {
        if (this._destroyed) return;

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
        this._hidePanel(this.pausePanel);
        this._hidePanel(this.upgradePanel);
        this._hidePanel(this.gameOverPanel);
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
        this._touchStartX = p.x;
        this._touchStartY = p.y;
        this._core.setPaddleTarget(p.x);
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this._acceptsPlayInput()) return;
        const p = this._toLogic(event.getUILocation().x, event.getUILocation().y);
        this._core.setPaddleTarget(p.x);
    }

    private _onTouchEnd(event: EventTouch): void {
        if (!this._acceptsPlayInput()) return;
        const p = this._toLogic(event.getUILocation().x, event.getUILocation().y);
        const dx = p.x - this._touchStartX;
        const dy = p.y - this._touchStartY;
        if (Math.sqrt(dx * dx + dy * dy) <= TAP_SLOP) {
            this._core.launch();
        }
    }

    /** 桌面拖拽结束派发的是 TOUCH_CANCEL：结束拖拽，但不当作点击发球 */
    private _onTouchCancel(): void {
        // 故意留空：挡板停在当前位置
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
                    this._showUpgradePanel();
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
            g.fillColor = this._color(this._brickColor(brick.kind, brick.hp));
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
        if (core.level !== this._lastLevel && this.levelLabel) {
            this.levelLabel.string = `第 ${core.level} 关`;
            this._lastLevel = core.level;
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

    private _brickColor(kind: string, hp: number): number {
        if (kind === 'bomb') return COLORS.bomb;
        if (kind === 'tough') return hp >= 3 ? COLORS.brickHp3 : COLORS.brickHp2;
        return hp >= 3 ? COLORS.brickHp3 : COLORS.brickHp1;
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
