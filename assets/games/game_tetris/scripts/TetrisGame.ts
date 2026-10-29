/**
 * 方块坠落 — 主控：状态机、重力与锁延迟、消行、计分、渲染同步。
 *
 * 时间相关逻辑全部走 `update(dt)` 累加，**不用 scheduleOnce 自排期**
 * （同一回调在自身执行中重新排期会被引擎静默丢弃，见 AGENTS.md 教训 F）。
 */

import { _decorator, Color, Component, Game, Graphics, Node, Sprite, SpriteFrame, UITransform, Vec3, game } from 'cc';
import {
    BOARD_COLS,
    BUTTON_BOTTOM_ZONE,
    COLOR_BOARD_BG,
    COLOR_GRID_LINE,
    HARD_DROP_POINTS_PER_CELL,
    LINE_CLEAR_SEC,
    LOCK_DELAY_SEC,
    MAX_LOCK_RESETS,
    PIECE_COLORS,
    SOFT_DROP_INTERVAL_SEC,
    SOFT_DROP_POINTS_PER_CELL,
    UI_STROKE,
    VISIBLE_ROWS,
    computeCellSize,
    gravityInterval,
    levelForLines,
    scoreForLines,
} from './TetrisConfig';
import { ActivePiece, BagRandomizer, PieceType, createPiece, getKicks, getPieceCells } from './TetrisPieces';
import { TetrisBoard } from './TetrisBoard';
import { HudPanel } from './HudPanel';
import { ControlMode, ITetrisHost, TetrisAction } from './TetrisInput';
import { GestureInput } from './GestureInput';
import { ButtonInput } from './ButtonInput';
import { PausePanel, IPausePanelHost } from './PausePanel';
import { GameOverPanel, IGameOverHost } from './GameOverPanel';
import { TutorialPanel, ITutorialHost } from './TutorialPanel';
import { HintBar } from './HintBar';
import { TetrisStorage } from './TetrisStorage';
import { keepScreenOn, vibrateShort } from './TetrisEffects';
import { colorOf, drawCell, ensureGraphics, skinBackground, skinBand, skinButton, skinCard, withAlpha } from './TetrisSkin';
import { SceneManager } from '../../../common/managers/SceneManager';

const { ccclass, property } = _decorator;

/** 打开后挂 `__debug` 接口，供浏览器探针使用 */
const DEBUG = true;

/** 单帧 dt 上限，避免切回前台时一帧掉太多行 */
const MAX_STEP_SEC = 0.05;

/** 落地闪烁时长（秒） */
const LOCK_FLASH_SEC = 0.08;

/** 落地震屏时长与幅度（设计像素） */
const SHAKE_SEC = 0.12;
const SHAKE_AMP = 4;

/** 「首次切到按键模式」提示只出现一次的标记，存在 `hint_used` 里 */
const BUTTON_NOTICE_KEY = 'button_notice';

enum GameState {
    Ready = 'ready',
    Playing = 'playing',
    Clearing = 'clearing',
    Paused = 'paused',
    GameOver = 'game_over',
}

interface CellView {
    x: number;
    y: number;
    color: Color;
}

@ccclass('TetrisGame')
export class TetrisGame extends Component implements ITetrisHost, IPausePanelHost, IGameOverHost, ITutorialHost {
    // ========== 场景引用（绑定见设计文档 §6.4） ==========
    @property(Node)
    boardRoot: Node | null = null;

    @property(Node)
    blockLayer: Node | null = null;

    @property(Node)
    ghostLayer: Node | null = null;

    @property(Node)
    columnHighlight: Node | null = null;

    @property(Node)
    gridLines: Node | null = null;

    @property(Node)
    gestureLayer: Node | null = null;

    @property(Node)
    buttonLayer: Node | null = null;

    // 绑节点而不是组件：`@property(HintBar)` 在编辑器里的属性元数据解析成了 Unknown，
    // MCP 的 set-property 因此拒绝绑定；组件在 start() 里 getComponent 取（红线 3 同源问题）
    @property({ type: Node, tooltip: '底部提示条节点（挂 HintBar 组件）' })
    hintBarNode: Node | null = null;

    @property(Node)
    pauseButton: Node | null = null;

    @property({ type: Node, tooltip: '左上角返回大厅（BackButton 所在节点，圆角皮肤用）' })
    backButton: Node | null = null;

    @property(Node)
    holdPanel: Node | null = null;

    // ========== 虚拟按键（按键模式才有监听） ==========
    @property(Node)
    btnLeft: Node | null = null;

    @property(Node)
    btnRight: Node | null = null;

    @property(Node)
    btnSoftDrop: Node | null = null;

    @property(Node)
    btnHardDrop: Node | null = null;

    @property(Node)
    btnRotate: Node | null = null;

    @property(HudPanel)
    hud: HudPanel | null = null;

    @property(PausePanel)
    pausePanel: PausePanel | null = null;

    @property(TutorialPanel)
    tutorialPanel: TutorialPanel | null = null;

    @property(GameOverPanel)
    gameOverPanel: GameOverPanel | null = null;

    /** 旧版方块贴图；M7 起方块改 Graphics 绘制，这里保留绑定以免场景数据失联 */
    @property(SpriteFrame)
    cellSpriteFrame: SpriteFrame | null = null;

    // ========== 规则状态 ==========
    private _board: TetrisBoard = new TetrisBoard();
    private _bag: BagRandomizer = new BagRandomizer();
    private _piece: ActivePiece | null = null;
    private _next: PieceType[] = [];
    private _hold: PieceType | null = null;
    private _holdUsed: boolean = false;

    private _state: GameState = GameState.Ready;
    private _score: number = 0;
    private _lines: number = 0;
    private _level: number = 1;

    private _gravityAcc: number = 0;
    private _lockTimer: number = 0;
    private _lockResets: number = 0;
    private _softDrop: boolean = false;

    private _clearRows: number[] = [];
    private _clearTimer: number = 0;

    // ========== 渲染状态 ==========
    private _cell: number = 38;
    private _colorCache: Map<string, Color> = new Map<string, Color>();
    private _clearTint: Color | null = null;

    /** onDestroy 只碰这些普通引用，不访问任何 @property(Node) */
    private _pauseBtn: Node | null = null;
    private _holdBtn: Node | null = null;

    /** 输入层（M4：全屏手势；M5 起按设置切换） */
    private _gesture: GestureInput | null = null;
    private _button: ButtonInput | null = null;
    private _controlMode: ControlMode = 'gesture';

    /** 震动开关（M7 真正调用 wx.vibrateShort，这里只负责开关与落盘） */
    private _vibrate: boolean = true;

    /** 暂停前的状态：从消行动画中暂停要能回到消行动画 */
    private _resumeState: GameState = GameState.Playing;

    /** 方块身份令牌：换块时自增，手势层据此判断拖拽中是否换了新方块 */
    private _pieceToken: number = 0;

    // ========== 表现（M7） ==========
    /** 锁定时闪白的格子与剩余时长 */
    private _flashCells: { x: number; y: number }[] = [];
    private _flashTimer: number = 0;
    /** 震屏剩余时长 */
    private _shakeTimer: number = 0;
    /** 棋盘原始位置：震屏偏移后必须能精确还原 */
    private _shakeBase: Vec3 = new Vec3();

    /** 本次打开教程是否为「首局引导」 */
    private _tutorialFirstRun: boolean = false;

    /** 底部提示条组件（由 hintBarNode 解析而来，见属性声明处注释） */
    private _hintBar: HintBar | null = null;

    // ==================== 生命周期 ====================

    onLoad(): void {
        this._pauseBtn = this.pauseButton;
        this._holdBtn = this.holdPanel;

        if (this._pauseBtn) {
            this._pauseBtn.on(Node.EventType.TOUCH_END, this.onPauseClicked, this);
        }
        if (this._holdBtn) {
            this._holdBtn.on(Node.EventType.TOUCH_END, this.onHoldClicked, this);
        }

        // 设置从存档恢复：默认全屏手势 + 开震动
        this._controlMode = TetrisStorage.getControlMode();
        this._vibrate = TetrisStorage.getVibrate();

        // 切后台即暂停；回前台**不自动继续**，由玩家自己点「继续」（§8）
        game.on(Game.EVENT_HIDE, this.onAppHide, this);

        // 小游戏常亮（浏览器预览里没有 wx，内部 try/catch 静默跳过）
        keepScreenOn();

        this._next = [this._bag.next(), this._bag.next(), this._bag.next()];
        this._installDebug();
    }

    start(): void {
        this._applySkins();
        this._layout();
        this._shakeBase = this.boardRoot ? this.boardRoot.position.clone() : new Vec3();
        this.pausePanel?.init(this);
        this.gameOverPanel?.init(this);
        this.tutorialPanel?.init(this);
        this._hintBar = this.hintBarNode ? this.hintBarNode.getComponent(HintBar) : null;
        this.newGame();

        // 手势层默认启用（设计文档 §3.2）；按键层由 setControlMode 切换
        if (this.gestureLayer) {
            this._gesture = new GestureInput(this.gestureLayer, this);
        }
        if (this.buttonLayer && this.btnLeft && this.btnRight && this.btnSoftDrop && this.btnHardDrop && this.btnRotate) {
            this._button = new ButtonInput(
                this,
                this.buttonLayer,
                this.btnLeft,
                this.btnRight,
                this.btnSoftDrop,
                this.btnHardDrop,
                this.btnRotate,
            );
        }

        this._syncInputEnabled();

        // 首局引导（§4.1）：进 READY，重力与输入都停住，看完再开始
        if (!TetrisStorage.isTutorialDone() && this.tutorialPanel) {
            this._state = GameState.Ready;
            this._syncInputEnabled();
            this._tutorialFirstRun = true;
            this.tutorialPanel.show(true, this._controlMode);
        }
        this._syncHints();
    }

    onDestroy(): void {
        // 全局事件可以解绑；**节点上的监听一律不碰** —— 场景销毁时子节点往往已经先被销毁，
        // 此时 `node.off()` 里 `_eventProcessor` 已是 null，会抛
        // `Cannot read properties of null (reading 'off')`，把整个销毁流程带崩。
        // 节点都没了，监听自然不存在，这里只丢引用（AGENTS.md 防崩溃守则 2）。
        game.off(Game.EVENT_HIDE, this.onAppHide, this);
        this._gesture = null;
        this._button = null;
        this._pauseBtn = null;
        this._holdBtn = null;
        this._piece = null;
    }

    update(dt: number): void {
        const step = Math.min(dt, MAX_STEP_SEC);

        // 按键连发计时（DAS/ARR）走这里；不依赖任何 schedule
        if (this._button) {
            this._button.update(step);
        }

        // 闪烁 / 震屏也走 update 计时（暂停时冻结）
        this._updateEffects(step);

        if (this._state === GameState.Clearing) {
            this._clearTimer += step;
            if (this._clearTimer >= LINE_CLEAR_SEC) {
                this._finishClear();
            }
            return;
        }
        if (this._state !== GameState.Playing) {
            return;
        }

        const piece = this._piece;
        if (!piece) {
            return;
        }

        if (!this._canFall(piece)) {
            // 触底：累加锁延迟
            this._gravityAcc = 0;
            this._lockTimer += step;
            if (this._lockTimer >= LOCK_DELAY_SEC) {
                this._lockPiece();
            }
            return;
        }

        this._lockTimer = 0;
        this._gravityAcc += step;

        const interval = this._softDrop
            ? Math.min(gravityInterval(this._level), SOFT_DROP_INTERVAL_SEC)
            : gravityInterval(this._level);

        let moved = false;
        let guard = 0;
        while (this._gravityAcc >= interval && guard++ < 24) {
            if (!this._canFall(piece)) break;
            this._gravityAcc -= interval;
            piece.y -= 1;
            if (this._softDrop) {
                this._score += SOFT_DROP_POINTS_PER_CELL;
            }
            moved = true;
        }
        if (moved) {
            this._render();
            this._syncHud();
        }
    }

    // ==================== 表现（M7） ====================

    /** 闪烁与震屏：都用 update 计时，暂停时冻结（不用 scheduleOnce，教训 F） */
    private _updateEffects(step: number): void {
        if (this._state === GameState.Paused) return;

        if (this._flashTimer > 0) {
            this._flashTimer -= step;
            if (this._flashTimer <= 0) {
                this._flashTimer = 0;
                this._flashCells.length = 0;
                this._render();
            }
        }

        if (this._shakeTimer > 0) {
            this._shakeTimer -= step;
            if (this._shakeTimer <= 0) {
                this._shakeTimer = 0;
                this._applyShakeOffset(0, 0);
            } else {
                // 幅度随时间线性衰减，落地越久抖得越轻
                const amp = SHAKE_AMP * (this._shakeTimer / SHAKE_SEC);
                this._applyShakeOffset(
                    (Math.random() * 2 - 1) * amp,
                    (Math.random() * 2 - 1) * amp,
                );
            }
        }
    }

    /**
     * 震屏：只偏移棋盘（BoardRoot 含网格、方块、幽灵、列高亮）。
     * 不能偏移 Canvas —— Camera 是 Canvas 的子节点，两者一起动等于画面没动。
     */
    private _applyShakeOffset(dx: number, dy: number): void {
        const root = this.boardRoot;
        if (!root || !root.isValid) return;
        root.setPosition(this._shakeBase.x + dx, this._shakeBase.y + dy, this._shakeBase.z);
    }

    /** 锁定反馈：闪白 + 轻微震屏 + 震动（§5.4） */
    private _playLockEffect(cells: { x: number; y: number }[]): void {
        this._flashCells.length = 0;
        for (const cell of cells) {
            if (cell.y >= 0 && cell.y < VISIBLE_ROWS) {
                this._flashCells.push({ x: cell.x, y: cell.y });
            }
        }
        this._flashTimer = this._flashCells.length > 0 ? LOCK_FLASH_SEC : 0;
        this._shakeTimer = SHAKE_SEC;
        vibrateShort(this._vibrate);
    }

    private _isFlashing(x: number, y: number): boolean {
        if (this._flashTimer <= 0) return false;
        for (const cell of this._flashCells) {
            if (cell.x === x && cell.y === y) return true;
        }
        return false;
    }

    private _resetEffects(): void {
        this._flashCells.length = 0;
        this._flashTimer = 0;
        this._shakeTimer = 0;
        this._applyShakeOffset(0, 0);
    }

    // ==================== 提示条（M7） ====================

    /** 提示条内容随时可能变（模式切换、完成手势、局数增加），统一从这里刷 */
    private _syncHints(): void {
        if (!this._hintBar) return;
        this._hintBar.refresh(this._controlMode, TetrisStorage.getHintUsed(), TetrisStorage.getGamesPlayed());
    }

    /** 第一次完成某个手势：落盘并重绘（该条降到 40% 透明度） */
    private _markHint(key: string): void {
        const used = TetrisStorage.getHintUsed();
        if (used.indexOf(key) >= 0) return;
        TetrisStorage.markHintUsed(key);
        this._syncHints();
    }

    // ==================== 对外动作 ====================

    /** 输入层统一入口 */
    applyAction(action: TetrisAction): void {
        // 软降是输入层的开关状态，不受棋盘状态限制：消行那 120ms 里松手，
        // 这条 SoftDropEnd 若被下面的 Playing 判断吞掉，下一块会在手指已经抬起的
        // 情况下继续加速下落（输入层以为已经关了，不会重发）。
        if (action === TetrisAction.SoftDropEnd) {
            this._setSoftDrop(false);
            return;
        }

        if (this._state !== GameState.Playing) return;
        const piece = this._piece;
        if (!piece) return;

        switch (action) {
            case TetrisAction.Left:
                this._tryMove(piece, -1);
                break;
            case TetrisAction.Right:
                this._tryMove(piece, 1);
                break;
            case TetrisAction.RotateCW:
                this._tryRotate(piece, 1);
                break;
            case TetrisAction.RotateCCW:
                this._tryRotate(piece, -1);
                break;
            case TetrisAction.SoftDropStart:
                this._setSoftDrop(true);
                this._markHint('drop');
                break;
            case TetrisAction.HardDrop:
                this._hardDrop(piece);
                break;
            case TetrisAction.Hold:
                this._doHold(piece);
                break;
        }
    }

    /**
     * 软降开关（两种操作模式共用）。
     *
     * **切换时必须清零 `_gravityAcc`**：累加器是按「当前间隔」结算的，攒了 0.65s 再切到
     * 软降间隔，那 0.65s 会在同一帧一次性兑现成十几行 —— 软降按下瞬间直接瞬移，与硬降无异
     * （实测原 0.04s/行时一帧掉 16 行）。松开同理：不清零的话残留累加值还会立刻再掉一行，
     * 「停」就停不准。
     */
    private _setSoftDrop(on: boolean): void {
        if (this._softDrop === on) return;
        this._softDrop = on;
        this._gravityAcc = 0;
        // 列光带的加亮态跟着 _softDrop 走（提示「加速期间这一列已锁定」）
        this._renderHighlight(this._piece);
    }

    // ==================== 操作模式 ====================

    getControlMode(): ControlMode {
        return this._controlMode;
    }

    /**
     * 切换操作模式：先 `disable()` 旧的，再 `enable()` 新的。
     * `disable()` 会清空连发/软降/未完成的手势，否则切回来会有「还在连发」的鬼影。
     * 暂停中切换只记录模式（`_syncInputEnabled` 不会给暂停中的棋盘开输入），继续时生效。
     */
    setControlMode(mode: ControlMode): void {
        // 非法值直接丢弃：否则 `_controlMode` 会被写成 undefined，
        // 并落盘成字符串 "undefined"，下次启动读到脏值
        if (mode !== 'gesture' && mode !== 'button') return;
        if (mode === this._controlMode) return;
        this._controlMode = mode;
        TetrisStorage.setControlMode(mode);
        this._syncInputEnabled();
        this.pausePanel?.refresh(mode, this._vibrate);
        this._syncHints();
    }

    /** 输入层的唯一开关处：非游戏中（暂停/结算/消行前）一律关掉，避免残留软降与连发 */
    private _syncInputEnabled(): void {
        const playable = this._state === GameState.Playing || this._state === GameState.Clearing;
        if (!playable) {
            this._gesture?.disable();
            this._button?.disable();
            return;
        }
        if (this._controlMode === 'gesture') {
            this._button?.disable();
            this._gesture?.enable();
        } else {
            this._gesture?.disable();
            this._button?.enable();
        }
    }

    // ==================== 暂停 / 结算（IPausePanelHost / IGameOverHost） ====================

    pauseGame(): void {
        if (this._state !== GameState.Playing && this._state !== GameState.Clearing) return;
        this._resumeState = this._state;
        this._state = GameState.Paused;
        // 暂停要停掉加速（顺带把锁列的高亮恢复常态）；继续游戏后手指并不会自己回到按下态
        this._setSoftDrop(false);
        this._syncInputEnabled();
        this.pausePanel?.show(this._controlMode, this._vibrate);
    }

    resumeGame(): void {
        if (this._state !== GameState.Paused) return;
        this.pausePanel?.hide();
        this._state = this._resumeState === GameState.Clearing ? GameState.Clearing : GameState.Playing;
        this._syncInputEnabled();
    }

    selectControlMode(mode: ControlMode): void {
        this.setControlMode(mode);
        this.pausePanel?.refresh(this._controlMode, this._vibrate);

        // §4.4：首次切到按键模式提示一次
        // （棋盘尺寸按按钮区预留一次性算好，切模式不再变，提示文案如实说明这一点）
        if (mode === 'button' && TetrisStorage.getHintUsed().indexOf(BUTTON_NOTICE_KEY) < 0) {
            TetrisStorage.markHintUsed(BUTTON_NOTICE_KEY);
            this.pausePanel?.showNotice('按键区占用棋盘下方空间，棋盘大小不变');
        }
    }

    /** 返回切换后的开关状态 */
    toggleVibrate(): boolean {
        this._vibrate = !this._vibrate;
        TetrisStorage.setVibrate(this._vibrate);
        return this._vibrate;
    }

    getVibrate(): boolean {
        return this._vibrate;
    }

    /** 暂停面板点「操作说明」：按当前模式重新打开教程（§4.3） */
    openTutorial(): void {
        if (!this.tutorialPanel) return;
        this.pausePanel?.hide();
        this._tutorialFirstRun = false;
        this.tutorialPanel.show(false, this._controlMode);
        this._syncInputEnabled();
    }

    // ==================== 教程（ITutorialHost） ====================

    tutorialPrimary(): void {
        this.tutorialPanel?.hide();
        if (this._tutorialFirstRun) {
            // 首局引导看完：落盘，然后正式开打（READY → PLAYING）
            TetrisStorage.setTutorialDone();
            this._tutorialFirstRun = false;
            this._beginPlay();
            return;
        }
        // 从暂停面板进来：原样退回暂停面板
        this.pausePanel?.show(this._controlMode, this._vibrate);
    }

    tutorialSwitchMode(mode: ControlMode): void {
        this.setControlMode(mode);
        this.tutorialPanel?.refresh(this._controlMode);
        this._syncHints();
    }

    /** 首局引导结束：开始受重力与输入控制 */
    private _beginPlay(): void {
        this._state = GameState.Playing;
        this._syncInputEnabled();
        this._syncHints();
    }

    backToLobby(): void {
        SceneManager.gotoLobby();
    }

    restartGame(): void {
        this.gameOverPanel?.hide();
        this.newGame();
        this._syncInputEnabled();
    }

    // ==================== 输入层查询（ITetrisHost） ====================

    getPieceColumn(): number | null {
        return this._piece ? this._piece.x : null;
    }

    getPieceToken(): number {
        return this._pieceToken;
    }

    getCellSize(): number {
        return this._cell;
    }

    /** 列吸附：逐格靠近目标列，撞墙即停（不会把方块推到非法位置） */
    snapPieceToColumn(column: number): void {
        const piece = this._piece;
        if (!piece || this._state !== GameState.Playing) return;

        let guard = 0;
        while (piece.x !== column && guard++ < BOARD_COLS) {
            const before = piece.x;
            this._tryMove(piece, piece.x < column ? 1 : -1);
            if (piece.x === before) break;
        }
    }

    newGame(): void {
        this.gameOverPanel?.hide();
        this._board.reset();
        this._bag.reset();
        this._next = [this._bag.next(), this._bag.next(), this._bag.next()];
        this._hold = null;
        this._holdUsed = false;
        this._score = 0;
        this._lines = 0;
        this._level = 1;
        this._gravityAcc = 0;
        this._lockTimer = 0;
        this._lockResets = 0;
        this._softDrop = false;
        this._clearRows = [];
        this._clearTimer = 0;
        this._resetEffects();
        this._state = GameState.Playing;
        this._spawn();
        this._render();
        this._syncHud(true);
        this._syncHints();
    }

    // ==================== 规则 ====================

    private _canFall(piece: ActivePiece): boolean {
        const below: ActivePiece = { type: piece.type, rot: piece.rot, x: piece.x, y: piece.y - 1 };
        return this._board.canPlace(getPieceCells(below));
    }

    private _tryMove(piece: ActivePiece, dx: number): void {
        const next: ActivePiece = { type: piece.type, rot: piece.rot, x: piece.x + dx, y: piece.y };
        if (!this._board.canPlace(getPieceCells(next))) return;
        piece.x = next.x;
        this._markHint('move');
        this._onPieceChanged();
    }

    private _tryRotate(piece: ActivePiece, dir: 1 | -1): void {
        const from = piece.rot & 3;
        const to = (from + (dir === 1 ? 1 : 3)) & 3;
        const kicks = getKicks(piece.type, from, to);
        for (const kick of kicks) {
            const candidate: ActivePiece = {
                type: piece.type,
                rot: to,
                x: piece.x + kick.x,
                y: piece.y + kick.y,
            };
            if (this._board.canPlace(getPieceCells(candidate))) {
                piece.rot = to;
                piece.x = candidate.x;
                piece.y = candidate.y;
                this._markHint('rotate');
                this._onPieceChanged();
                return;
            }
        }
    }

    /** 成功移动/旋转后：重置锁延迟（有次数上限），并重绘 */
    private _onPieceChanged(): void {
        if (this._lockTimer > 0 && this._lockResets < MAX_LOCK_RESETS) {
            this._lockTimer = 0;
            this._lockResets++;
        }
        this._render();
    }

    private _hardDrop(piece: ActivePiece): void {
        const distance = this._board.getDropDistance(piece);
        if (distance > 0) {
            piece.y -= distance;
            this._score += distance * HARD_DROP_POINTS_PER_CELL;
        }
        this._markHint('drop');
        this._render();
        this._lockPiece();
    }

    private _doHold(piece: ActivePiece): void {
        if (this._holdUsed) return;

        const currentType = piece.type;
        const swap = this._hold;
        this._hold = currentType;
        this._holdUsed = true;
        this._pieceToken++;

        if (swap === null) {
            this._spawn();
        } else {
            const next = createPiece(swap);
            if (!this._board.canPlace(getPieceCells(next))) {
                this._piece = next;
                this._enterGameOver();
                this._render();
                this._syncHud(true);
                return;
            }
            this._piece = next;
            this._lockTimer = 0;
            this._lockResets = 0;
            this._gravityAcc = 0;
        }

        this._render();
        this._syncHud(true);
    }

    private _spawn(): void {
        const type = this._next.shift();
        this._next.push(this._bag.next());
        this._pieceToken++;

        const piece = createPiece(type === undefined ? this._bag.next() : type);
        this._lockTimer = 0;
        this._lockResets = 0;
        this._gravityAcc = 0;

        if (!this._board.canPlace(getPieceCells(piece))) {
            this._piece = piece;
            this._enterGameOver();
            return;
        }

        this._piece = piece;
        this._syncHud(true);
    }

    private _lockPiece(): void {
        const piece = this._piece;
        if (!piece) return;

        // 锁定前记下格子：锁定后就是棋盘数据了，闪白按这些坐标画
        const lockedCells = getPieceCells(piece);

        const lockOut = this._board.isLockOut(piece);
        this._board.lock(piece);
        this._piece = null;
        this._lockTimer = 0;
        this._lockResets = 0;
        this._holdUsed = false;

        this._playLockEffect(lockedCells);

        if (lockOut) {
            this._enterGameOver();
            this._render();
            return;
        }

        const rows = this._board.findFullRows();
        if (rows.length > 0) {
            this._clearRows = rows;
            this._clearTimer = 0;
            this._state = GameState.Clearing;
            this._render();
            return;
        }

        this._spawn();
        this._render();
        this._syncHud();
    }

    private _finishClear(): void {
        const rows = this._clearRows;
        const count = this._board.clearRows(rows);

        this._score += scoreForLines(count, this._level);
        this._lines += count;
        this._level = levelForLines(this._lines);

        this._clearRows = [];
        this._clearTimer = 0;
        this._state = GameState.Playing;

        this._spawn();
        this._render();
        this._syncHud(true);
    }

    private _enterGameOver(): void {
        // 幂等：生成失败与锁定溢出可能在同一帧都走到这里，别重复结算
        if (this._state === GameState.GameOver) return;
        this._state = GameState.GameOver;
        this._softDrop = false;
        this._syncInputEnabled();

        const result = TetrisStorage.submitScore(this._score, this._lines);
        this.gameOverPanel?.show(this._score, result.bestScore, this._lines, result.isNewBest);
        // 局数变了：提示条可能到了「累计 3 局自动隐藏」的阈值
        this._syncHints();
    }

    // ==================== 输入回调 ====================

    private onPauseClicked(): void {
        this.pauseGame();
    }

    /** 切后台：只暂停，不弹系统确认；回前台由玩家点「继续」 */
    private onAppHide(): void {
        this.pauseGame();
    }

    private onHoldClicked(): void {
        this.applyAction(TetrisAction.Hold);
    }

    // ==================== 布局 ====================

    // ==================== 布局 / 皮肤 ====================

    /**
     * 界面外观一次性处理（背景渐变、HUD 图标按钮、虚拟按键皮肤）。
     * 只做一次：这些属性和分辨率无关，`_layout()` 负责每帧尺寸相关的棋盘。
     */
    private _applySkins(): void {
        skinBackground(this.node.getChildByName('Background'));

        // 顶部两枚图标按钮：88px 里塞两个字太挤，改成图示（文字由皮肤藏掉）
        skinButton(this.pauseButton, 'secondary', { icon: 'pause', hideLabel: true });
        skinButton(this.backButton, 'secondary', { icon: 'back', hideLabel: true });

        // 虚拟按键：四枚方向/旋转用次要底，落地单独用强调色，拇指一眼能分辨
        skinButton(this.btnLeft, 'secondary');
        skinButton(this.btnRight, 'secondary');
        skinButton(this.btnRotate, 'secondary');
        skinButton(this.btnSoftDrop, 'secondary');
        skinButton(this.btnHardDrop, 'accent');
    }

    private _layout(): void {
        const canvasTransform = this.node.getComponent(UITransform);
        const width = canvasTransform ? canvasTransform.width : 720;
        const height = canvasTransform ? canvasTransform.height : 1280;

        const cell = computeCellSize(width, height);
        this._cell = cell;

        const boardWidth = BOARD_COLS * cell;
        const boardHeight = VISIBLE_ROWS * cell;
        const bottom = -height / 2 + BUTTON_BOTTOM_ZONE;

        if (this.boardRoot) {
            this.boardRoot.setPosition(0, bottom + boardHeight / 2, 0);
            this._setSize(this.boardRoot, boardWidth, boardHeight);
            const background = this.boardRoot.getChildByName('BoardBg');
            if (background) {
                this._setSize(background, boardWidth, boardHeight);
                // 棋盘要像一块「凹进背景的玻璃」：圆角 + 描边，方形底色关掉
                skinCard(background, {
                    width: boardWidth,
                    height: boardHeight,
                    radius: 22,
                    fill: COLOR_BOARD_BG,
                    stroke: UI_STROKE,
                });
            }
        }
        if (this.columnHighlight) {
            this._setSize(this.columnHighlight, cell, boardHeight);
            const sprite = this.columnHighlight.getComponent(Sprite);
            if (sprite) sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        }
        this._drawGrid(boardWidth, boardHeight, cell);
    }

    private _setSize(node: Node, width: number, height: number): void {
        const transform = node.getComponent(UITransform);
        if (transform) {
            transform.setContentSize(width, height);
        }
    }

    private _drawGrid(boardWidth: number, boardHeight: number, cell: number): void {
        if (!this.gridLines) return;
        const graphics = this.gridLines.getComponent(Graphics);
        if (!graphics) return;

        graphics.clear();
        // 用**实心细矩形**而不是 `stroke()`：
        // 同一位置、同样 2px 宽，描边经抗锯齿后只剩 ~8% 覆盖率（实测像素只亮 3/255），
        // 网格在预览里几乎完全看不见；改 rect + fill 后稳定得到 1 个设备像素（实测 78%~100%）。
        // 原因见 docs/tech/mcp-scene-authoring-pitfalls.md：细描边会被亚像素吃掉。
        const thickness = 2;
        // 网格只用来提示落点，颜色压得很低；但在深色底上 alpha 再低就完全看不见了
        graphics.fillColor = withAlpha(colorOf(COLOR_GRID_LINE), 190);

        const left = -boardWidth / 2;
        const bottom = -boardHeight / 2;

        for (let col = 1; col < BOARD_COLS; col++) {
            const x = left + col * cell - thickness / 2;
            graphics.rect(x, bottom, thickness, boardHeight);
        }
        for (let row = 1; row < VISIBLE_ROWS; row++) {
            const y = bottom + row * cell - thickness / 2;
            graphics.rect(left, y, boardWidth, thickness);
        }
        graphics.fill();
    }

    // ==================== 渲染 ====================

    private _render(): void {
        const cells: CellView[] = [];
        const grid = this._board.grid;

        for (let y = 0; y < VISIBLE_ROWS; y++) {
            for (let x = 0; x < BOARD_COLS; x++) {
                const type = grid[y][x];
                if (type === null) continue;
                const clearing = this._clearRows.indexOf(y) >= 0;
                // 刚落地的方块闪一下（80ms），消行时整行闪白优先
                const flash = !clearing && this._isFlashing(x, y);
                cells.push({ x, y, color: clearing || flash ? this._clearColor() : this._pieceColor(type) });
            }
        }

        const piece = this._piece;
        if (piece) {
            for (const cell of getPieceCells(piece)) {
                if (cell.y < 0 || cell.y >= VISIBLE_ROWS) continue;
                cells.push({ x: cell.x, y: cell.y, color: this._pieceColor(piece.type) });
            }
        }

        this._paintCells(this.blockLayer, cells);
        this._renderGhost(piece);
        this._renderHighlight(piece);
    }

    private _renderGhost(piece: ActivePiece | null): void {
        const cells: CellView[] = [];
        if (piece) {
            const ghostY = this._board.getGhostY(piece);
            if (ghostY !== piece.y) {
                const ghost: ActivePiece = { type: piece.type, rot: piece.rot, x: piece.x, y: ghostY };
                const color = this._pieceColor(piece.type);
                for (const cell of getPieceCells(ghost)) {
                    if (cell.y < 0 || cell.y >= VISIBLE_ROWS) continue;
                    cells.push({ x: cell.x, y: cell.y, color });
                }
            }
        }
        this._paintCells(this.ghostLayer, cells, 'ghost');
    }

    private _renderHighlight(piece: ActivePiece | null): void {
        const highlight = this.columnHighlight;
        if (!highlight) return;

        if (!piece) {
            highlight.active = false;
            return;
        }

        const cells = getPieceCells(piece);
        let minX = Number.MAX_SAFE_INTEGER;
        let maxX = -Number.MAX_SAFE_INTEGER;
        for (const cell of cells) {
            minX = Math.min(minX, cell.x);
            maxX = Math.max(maxX, cell.x);
        }
        const cols = maxX - minX + 1;
        const cell = this._cell;

        highlight.active = true;
        const bandWidth = cols * cell;
        const bandHeight = VISIBLE_ROWS * cell;
        this._setSize(highlight, bandWidth, bandHeight);
        // 软降期间光带加亮：此时手势模式锁了列，这是「这一列已经定了」的唯一提示
        skinBand(highlight, bandWidth, bandHeight, this._softDrop);
        highlight.setPosition((minX - 4.5) * cell + ((cols - 1) * cell) / 2, 0, 0);
    }

    /**
     * 用一块 Graphics 把整层格子重画一遍。
     * 以前是「对象池 + 一堆 2×2 贴图 Sprite 拉伸」，没圆角、每格一次 DrawCall；
     * 现在统一走 `drawCell` 的圆角砖，几十个格子合成一次绘制。
     */
    private _paintCells(parent: Node | null, cells: CellView[], look: 'solid' | 'ghost' = 'solid'): void {
        if (!parent) return;

        const graphics = ensureGraphics(parent);
        graphics.clear();
        if (cells.length === 0) return;

        const size = this._cell - 3;
        for (const view of cells) {
            const x = (view.x - (BOARD_COLS - 1) / 2) * this._cell - size / 2;
            const y = (view.y - (VISIBLE_ROWS - 1) / 2) * this._cell - size / 2;
            drawCell(graphics, x, y, size, view.color, look);
        }
    }

    private _pieceColor(type: PieceType): Color {
        return this._hexColor(PIECE_COLORS[type] || '#FFFFFF');
    }

    private _hexColor(hex: string): Color {
        let color = this._colorCache.get(hex);
        if (!color) {
            color = new Color();
            color.fromHEX(hex);
            this._colorCache.set(hex, color);
        }
        return color;
    }


    private _clearColor(): Color {
        if (!this._clearTint) {
            this._clearTint = new Color(255, 255, 255, 255);
        }
        return this._clearTint;
    }

    // ==================== HUD ====================

    private _syncHud(full: boolean = false): void {
        const hud = this.hud;
        if (!hud) return;
        hud.updateStats(this._score, this._level, this._lines);
        if (full) {
            hud.setNext(this._next);
            hud.setHold(this._hold);
        }
    }

    // ==================== 调试接口 ====================

    private _installDebug(): void {
        if (!DEBUG) return;
        const self = this;
        (this as any).__debug = {
            getState: () => ({
                grid: self._board.toStrings(),
                current: self._piece ? { type: self._piece.type, rot: self._piece.rot, x: self._piece.x, y: self._piece.y } : null,
                next: self._next.slice(),
                hold: self._hold,
                score: self._score,
                lines: self._lines,
                level: self._level,
                state: self._state,
            }),
            setBoard: (rows: string[]) => {
                self._board.loadFromStrings(rows);
                self._render();
            },
            spawn: (type: PieceType) => {
                self._piece = createPiece(type);
                self._render();
            },
            setState: (state: string) => {
                self._state = state as GameState;
            },
            action: (action: TetrisAction) => self.applyAction(action),
            setControlMode: (mode: ControlMode) => self.setControlMode(mode),
            getControlMode: () => self._controlMode,
            getVibrate: () => self._vibrate,
            pause: () => self.pauseGame(),
            resume: () => self.resumeGame(),
            gameOver: () => self._enterGameOver(),
            restart: () => self.restartGame(),
            getPanels: () => ({
                pause: !!self.pausePanel && self.pausePanel.node.active,
                gameOver: !!self.gameOverPanel && self.gameOverPanel.node.active,
                tutorial: !!self.tutorialPanel && self.tutorialPanel.node.active,
            }),
            getTutorial: () => ({
                done: TetrisStorage.isTutorialDone(),
                open: !!self.tutorialPanel && self.tutorialPanel.node.active,
                firstRun: self._tutorialFirstRun,
            }),
            openTutorial: () => self.openTutorial(),
            getHints: () => ({
                used: TetrisStorage.getHintUsed(),
                games: TetrisStorage.getGamesPlayed(),
                visible: !!self._hintBar && !!self._hintBar.rowsRoot && self._hintBar.rowsRoot.active,
            }),
            getEffects: () => ({ flash: self._flashTimer, shake: self._shakeTimer, cells: self._flashCells.length }),
            getBest: () => ({
                score: TetrisStorage.getBestScore(),
                lines: TetrisStorage.getBestLines(),
                games: TetrisStorage.getGamesPlayed(),
            }),
            getLayout: () => ({ cell: self._cell, boardTop: self.boardRoot ? self.boardRoot.position.y : 0 }),
            reset: () => self.newGame(),
        };
    }
}
