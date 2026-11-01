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
    COLORS,
    COUNT_MAX,
    FIRE_CAP,
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
    SQUAD_DOTS_MAX,
    SQUAD_DOT_MAX_R,
    SQUAD_DOT_MIN_R,
    gateOpColor,
    gateOpLabel,
    scrollSpeedAt,
} from './GateConfig';
import type { GateEvent, GatePair, Enemy } from './GateCore';
import { StorageManager } from '../../../common/managers/StorageManager';
import { SceneManager } from '../../../common/managers/SceneManager';

const { ccclass, property } = _decorator;

const GAME_ID = 'gate_runner';
const SHAKE_DECAY = 90;

/** 门板最多同时显示 4 对 → 8 个标签 */
const GATE_LABEL_POOL = 8;
/** 敌人 / Boss 头顶数字 */
const ENEMY_LABEL_POOL = 6;
/** 飘字池 */
const FX_LABEL_POOL = 8;

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
    private _enemyLabels: Label[] = [];
    private _shake = 0;

    private _fireTimer = 0;

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
        this._enemyLabels = [];
        this._colorCache.clear();
    }

    update(dt: number): void {
        if (this._destroyed) return;

        if (!this._paused && !this._resultShown) {
            this._core.step(dt);
            this._consumeEvents();
            this._updateBullets(dt);
            this._updateFx(dt);
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
        this._lastCount = -1;
        this._lastDistance = -1;
        this._lastHint = '';
        this._hidePanel(this.pausePanel);
        this._hidePanel(this.resultPanel);
        this._hideFxTexts();
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
        if (!this._acceptsPlayInput()) return;
        this._moveTo(event.getUILocation().x, event.getUILocation().y);
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this._acceptsPlayInput()) return;
        this._moveTo(event.getUILocation().x, event.getUILocation().y);
    }

    /** 抬起不做任何事：横移本身是纯位移操作，不需要"确认"动作 */
    private _onTouchEnd(event: EventTouch): void {
        if (!this._acceptsPlayInput()) return;
        this._moveTo(event.getUILocation().x, event.getUILocation().y);
    }

    /** 桌面拖拽结束派发 CANCEL（踩坑手册 §11）：同样只更新位置，不触发任何数值逻辑 */
    private _onTouchCancel(event: EventTouch): void {
        if (!this._acceptsPlayInput()) return;
        const loc = event ? event.getUILocation() : null;
        if (loc) this._moveTo(loc.x, loc.y);
    }

    private _moveTo(uiX: number, uiY: number): void {
        const p = this._toLogic(uiX, uiY);
        this._core.setPlayerX(p.x);
    }

    private _acceptsPlayInput(): boolean {
        if (this._paused || this._resultShown) return false;
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
                    const good = event.after >= event.before;
                    const color = gateOpColor(event.kind);
                    const text = good
                        ? `${gateOpLabel({ kind: event.kind, value: event.value })}  ${event.after}`
                        : `${gateOpLabel({ kind: event.kind, value: event.value })}  ${event.after}`;
                    this._spawnFxText(text, color, PLAYER_Y - 70);
                    this._spawnBurst(this._core.playerX, PLAYER_Y - 20, color, 10, 90);
                    break;
                }
                case 'enemy_engaged':
                    if (event.boss) this._shake = Math.max(this._shake, 8);
                    break;
                case 'enemy_destroyed':
                    this._spawnBurst(event.boss ? PLAY_W / 2 : this._core.playerX, PLAYER_Y - 140, COLORS.enemy, 22, 160);
                    this._shake = Math.max(this._shake, event.boss ? 12 : 4);
                    break;
                case 'squad_hit':
                    this._spawnFxText(`−${event.amount}`, COLORS.danger, PLAYER_Y - 46);
                    this._shake = Math.max(this._shake, 2);
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
        const canFire = this._core.state === 'running' && !this._paused;

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

            // 文字：每对门两个标签
            this._placeGateLabel(labelIndex++, gate, 'left', sy);
            this._placeGateLabel(labelIndex++, gate, 'right', sy);
        }

        for (let i = labelIndex; i < this._gateLabels.length; i++) {
            this._gateLabels[i].node.active = false;
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
    }

    private _placeGateLabel(index: number, gate: GatePair, side: 'left' | 'right', screenY: number): void {
        const label = this._gateLabels[index];
        if (!label) return;
        const entry = side === 'left' ? gate.left : gate.right;
        const x0 = side === 'left' ? GATE_LEFT_X : GATE_RIGHT_X;

        label.string = gateOpLabel(entry.op);
        label.color = this._color(gateOpColor(entry.op.kind));
        label.node.active = true;
        label.node.setPosition(this._sx(x0 + GATE_W / 2), this._sy(screenY), 0);
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

            g.fillColor = this._color(e.boss ? COLORS.boss : COLORS.enemy, e.boss ? 0.95 : 0.85);
            g.roundRect(nx, ny, w, h, 12);
            g.fill();

            // 眼睛/灯带：让方块看着不像纯色块
            g.fillColor = this._color(0x000000, 0.28);
            g.rect(nx + 12, ny + h - 18, w - 24, 6);
            g.fill();

            // 血条：实心矩形
            const barW = w - 24;
            const ratio = e.maxHp > 0 ? Math.max(0, e.hp / e.maxHp) : 0;
            g.fillColor = this._color(0x000000, 0.45);
            g.rect(nx + 12, ny + h + 10, barW, 10);
            g.fill();
            g.fillColor = this._color(e.boss ? COLORS.boss : COLORS.danger);
            g.rect(nx + 12, ny + h + 10, barW * ratio, 10);
            g.fill();

            // 数字
            const label = this._enemyLabels[labelIndex];
            if (label) {
                label.string = `${Math.max(0, Math.ceil(e.hp))}`;
                label.node.active = true;
                label.node.setPosition(this._sx(PLAY_W / 2) + dx, this._sy(sy) + h / 2 + 34 + dy, 0);
            }
            labelIndex++;
        }

        for (let i = labelIndex; i < this._enemyLabels.length; i++) {
            this._enemyLabels[i].node.active = false;
        }
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

        if (visible <= 0) return;

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

        // 火力上限提示：dps 封顶后不再有额外收益
        if (count > FIRE_CAP) {
            g.fillColor = this._color(COLORS.allyDark, 0.5);
            g.rect(px - 30, py - 46, 60, 4);
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
                const label = this._makeLabel(fieldParent, 40, COLORS.text);
                if (label) this._gateLabels.push(label);
            }
            for (let i = 0; i < ENEMY_LABEL_POOL; i++) {
                const label = this._makeLabel(fieldParent, 28, COLORS.text);
                if (label) this._enemyLabels.push(label);
            }
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
        }
    }

    private _makeLabel(parent: Node | null, size: number, color: number): Label | null {
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
        return label;
    }

    // ==================== HUD ====================

    private _refreshHud(): void {
        const count = this._core.count;
        if (this.countLabel && count !== this._lastCount) {
            this._lastCount = count;
            this.countLabel.string = `${count}`;
            this.countLabel.color = this._color(count > FIRE_CAP ? COLORS.ally : COLORS.text);
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
        if (this._core.state === 'game_over') return '人数归零 · 再来一局';
        if (this._core.state === 'victory') return '已通关';
        const blocking = this._blockingEnemy();
        if (blocking) return blocking.boss ? 'Boss 战：撑住！' : '交火中 · 横移躲不开，硬打';
        if (count > FIRE_CAP) return '火力已封顶 · 优先选 × 门攒血量';
        if (count > COUNT_MAX - 1) return '人数已封顶';
        return '左右拖动选门 · × 卖血换收益';
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
