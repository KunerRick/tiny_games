/**
 * 五子棋 —— 运行时主组件。
 *
 * 场景里只需要一个挂在 Canvas 下的空节点（本组件），所有 UI 在 onLoad 中构建。
 *  - 点交叉点落子；黑先白后；四方向五连判胜
 *  - 人机（三档 AI） / 本地双人；悔棋、重开、战绩累计
 *  - 棋盘与棋子各用一个 Graphics 整体重绘，节点数恒定
 *
 * 约定：事件 handler 全部具名（红线 5）；onDestroy 只清 JS 引用（红线 4）；
 *       AI 延迟用 update() 计时泵，不依赖 scheduleOnce 自排期。
 */

import {
    _decorator,
    Component,
    EventTouch,
    Graphics,
    Label,
    Node,
    UITransform,
    Vec3,
} from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import {
    UI,
    UiButton,
    createBackButton,
    createButton,
    createLabel,
    createNode,
    designPos,
    drawRoundRect,
    toast,
    toColor,
} from '../../../common/ui/GameUIKit';
import {
    GOMOKU_BLACK,
    GOMOKU_DIFFS,
    GOMOKU_DRAW,
    GOMOKU_EMPTY,
    GOMOKU_WHITE,
    GomokuCore,
    GomokuDifficulty,
} from './GomokuCore';

const { ccclass } = _decorator;

type GomokuMode = 'ai' | 'pvp';

const DIFF_ORDER: GomokuDifficulty[] = ['easy', 'normal', 'hard'];
const MODE_ORDER: GomokuMode[] = ['ai', 'pvp'];

const CELL = 44;
const GRID_HALF = 14 * CELL / 2;
const BOARD_FRAME = 648;
const BOARD_TOP = 318;
const STONE_R = Math.round(CELL * 0.42);
const BOARD_CENTER_Y = BOARD_TOP + BOARD_FRAME / 2;

const STATS_KEY = 'tiny_games_gomoku_stats';
const MODE_KEY = 'tiny_games_gomoku_mode';
const DIFF_KEY = 'tiny_games_gomoku_diff';

const COLOR_BOARD = '#152033';
const COLOR_BOARD_STROKE = '#2A3A57';
// 格线加深（试玩报告 P0：深色底上几乎看不清交叉点）
const COLOR_GRID = '#5C739F';
const COLOR_STAR = '#94A3B8';
const COLOR_STONE_BLACK = '#0B1220';
const COLOR_STONE_BLACK_STROKE = '#475569';
const COLOR_STONE_WHITE = '#F8FAFC';
const COLOR_STONE_WHITE_STROKE = '#94A3B8';
const COLOR_LAST = '#EF4444';
const COLOR_WIN = '#FBBF24';

interface Stats {
    wins: number;
    losses: number;
    draws: number;
}

interface BoardTouchData {
    game: GomokuGame;
}

interface StatChip {
    node: Node;
    value: Label;
}

function onBoardTouchStart(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    const data = (node as unknown as { __gomoku?: BoardTouchData }).__gomoku;
    if (data) data.game.handleBoardTouch(ev);
}

function onOverlayTouchStart(ev: EventTouch): void {
    ev.propagationStopped = true;
    const node = ev.currentTarget as Node;
    // 点在面板 / 按钮上不关闭；点空白处关闭面板，回到终局棋盘（可继续悔棋）
    if (ev.target !== node) return;
    const data = (node as unknown as { __gomokuDismiss?: () => void }).__gomokuDismiss;
    if (data) data();
}

@ccclass('GomokuGame')
export class GomokuGame extends Component {
    /** 浏览器探针用 */
    _core: GomokuCore | null = null;
    _mode: GomokuMode = 'ai';
    _difficulty: GomokuDifficulty = 'normal';
    _stats: Stats = { wins: 0, losses: 0, draws: 0 };
    _aiThinking = false;
    _overlayPending = false;

    private _aiTimer = 0;
    private _overlayTimer = 0;
    private _statsRecorded = false;
    private _gameSeq = 0;
    private _uiBuilt = false;
    private _overlay: Node | null = null;
    private _boardNode: Node | null = null;
    private _stoneG: Graphics | null = null;
    private _statusLabel: Label | null = null;
    private _winValue: Label | null = null;
    private _lossValue: Label | null = null;
    private _drawValue: Label | null = null;
    private _modeBtns: Partial<Record<GomokuMode, UiButton>> = {};
    private _diffBtns: Partial<Record<GomokuDifficulty, UiButton>> = {};

    onLoad(): void {
        this._loadPrefs();
        this._buildUi();
        this.newGame();
    }

    update(dt: number): void {
        if (this._aiThinking) {
            this._aiTimer -= dt;
            if (this._aiTimer <= 0) {
                this._aiThinking = false;
                this._playAiMove();
                return;
            }
        }
        if (this._overlayPending) {
            this._overlayTimer -= dt;
            if (this._overlayTimer <= 0) {
                this._overlayPending = false;
                this._showOverlay();
            }
        }
    }

    onDestroy(): void {
        this._core = null;
        this._boardNode = null;
        this._stoneG = null;
        this._statusLabel = null;
        this._winValue = null;
        this._lossValue = null;
        this._drawValue = null;
        this._modeBtns = {};
        this._diffBtns = {};
        this._overlay = null;
    }

    // ==================== 对外操作 ====================

    newGame(): void {
        this._core = new GomokuCore(15, this._nextSeed());
        this._aiThinking = false;
        this._aiTimer = 0;
        this._statsRecorded = false;
        this._destroyOverlay();
        this._refreshAll();
    }

    handleBoardTouch(ev: EventTouch): void {
        const core = this._core;
        if (!core || core.isOver || this._aiThinking) return;
        if (this._mode === 'ai' && core.current !== GOMOKU_BLACK) return;
        const board = this._boardNode;
        if (!board || !board.isValid) return;
        const tf = board.getComponent(UITransform);
        if (!tf) return;

        const ui = ev.getUILocation();
        const local = tf.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const c = Math.round((local.x + GRID_HALF) / CELL);
        const r = Math.round((GRID_HALF - local.y) / CELL);
        if (!core.isInside(r, c)) return;

        // 手指落在已有棋子上时，吸附到半径内最近的空交叉点
        // （试玩报告：15×15 格距小，点偏一点就「没反应」）
        if (core.isLegal(r, c) && this._withinSnap(local, r, c)) {
            this._placeAt(r, c);
            return;
        }
        let bestR = -1;
        let bestC = -1;
        let bestD = CELL * 0.6;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const nr = r + dr;
                const nc = c + dc;
                if (!core.isInside(nr, nc) || !core.isLegal(nr, nc)) continue;
                const t = this._localOf(nr, nc);
                const d = Math.hypot(local.x - t.x, local.y - t.y);
                if (d < bestD) {
                    bestD = d;
                    bestR = nr;
                    bestC = nc;
                }
            }
        }
        if (bestR >= 0) this._placeAt(bestR, bestC);
    }

    /** 触摸点是否落在该交叉点的吸附半径内 */
    private _withinSnap(local: Vec3, r: number, c: number): boolean {
        const target = this._localOf(r, c);
        return Math.hypot(local.x - target.x, local.y - target.y) <= CELL * 0.6;
    }


    // ==================== 落子与回合 ====================

    private _placeAt(r: number, c: number): void {
        const core = this._core;
        if (!core) return;
        if (!core.place(r, c)) return;
        this._afterMove();
    }

    private _afterMove(): void {
        const core = this._core;
        this._refreshAll();
        if (!core) return;
        if (core.isOver) {
            this._onGameOver();
            return;
        }
        if (this._mode === 'ai' && core.current === GOMOKU_WHITE) {
            this._aiThinking = true;
            this._aiTimer = 0.32;
            this._refreshStatus();
        }
    }

    private _playAiMove(): void {
        const core = this._core;
        if (!core || core.isOver) {
            this._refreshAll();
            return;
        }
        const p = core.aiMove(this._difficulty);
        if (p && core.place(p.r, p.c)) {
            this._afterMove();
        } else {
            this._aiThinking = false;
            this._refreshAll();
        }
    }

    private _onGameOver(): void {
        this._recordStats();
        this._overlayPending = true;
        this._overlayTimer = 0.45;
    }

    private _onUndoClicked(): void {
        const core = this._core;
        if (!core) return;
        if (this._aiThinking) {
            toast(this.node, 'AI 思考中，稍后再悔棋');
            return;
        }
        if (core.history.length === 0) {
            toast(this.node, '没有可悔的棋');
            return;
        }

        const wasOver = core.isOver;
        const oldWinner = core.winner;
        let undone = core.undo(1);
        // 人机模式回退到玩家（黑方）回合：通常 2 步；玩家刚刚终局时 AI 没有应手，只退 1 步
        if (this._mode === 'ai') {
            let guard = 0;
            while (undone < 2 && core.current !== GOMOKU_BLACK && core.history.length > 0 && guard++ < 2) {
                undone += core.undo(1);
            }
        }
        if (undone === 0) {
            toast(this.node, '没有可悔的棋');
            return;
        }

        if (wasOver && this._statsRecorded && this._mode === 'ai') {
            this._unrecordStats(oldWinner);
            this._statsRecorded = false;
        }
        this._destroyOverlay();
        this._refreshAll();
    }

    private _onModeClicked(mode: GomokuMode): void {
        if (this._mode === mode) return;
        this._mode = mode;
        this._write(MODE_KEY, mode);
        this.newGame();
    }

    private _onDifficultyClicked(diff: GomokuDifficulty): void {
        if (this._difficulty === diff) return;
        this._difficulty = diff;
        this._write(DIFF_KEY, diff);
        this.newGame();
    }

    private _nextSeed(): number {
        this._gameSeq = (this._gameSeq + 1) >>> 0;
        return ((Date.now() & 0x7fffffff) ^ Math.imul(this._gameSeq, 2654435761)) >>> 0;
    }

    // ==================== 战绩 ====================

    private _recordStats(): void {
        const core = this._core;
        if (!core || this._mode !== 'ai' || this._statsRecorded) return;
        if (core.winner === GOMOKU_BLACK) this._stats.wins++;
        else if (core.winner === GOMOKU_WHITE) this._stats.losses++;
        else if (core.winner === GOMOKU_DRAW) this._stats.draws++;
        this._statsRecorded = true;
        this._write(STATS_KEY, JSON.stringify(this._stats));
    }

    private _unrecordStats(winner: number): void {
        if (winner === GOMOKU_BLACK) this._stats.wins = Math.max(0, this._stats.wins - 1);
        else if (winner === GOMOKU_WHITE) this._stats.losses = Math.max(0, this._stats.losses - 1);
        else if (winner === GOMOKU_DRAW) this._stats.draws = Math.max(0, this._stats.draws - 1);
        this._write(STATS_KEY, JSON.stringify(this._stats));
    }

    private _loadPrefs(): void {
        const mode = this._read(MODE_KEY);
        if (mode === 'ai' || mode === 'pvp') this._mode = mode;
        const diff = this._read(DIFF_KEY);
        if (diff === 'easy' || diff === 'normal' || diff === 'hard') this._difficulty = diff;
        const raw = this._read(STATS_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as Partial<Stats>;
                this._stats = {
                    wins: Math.max(0, Math.floor(Number(parsed.wins) || 0)),
                    losses: Math.max(0, Math.floor(Number(parsed.losses) || 0)),
                    draws: Math.max(0, Math.floor(Number(parsed.draws) || 0)),
                };
            } catch (err) {
                this._stats = { wins: 0, losses: 0, draws: 0 };
            }
        }
    }

    private _read(key: string): string | null {
        try {
            return localStorage.getItem(key);
        } catch (err) {
            return null;
        }
    }

    private _write(key: string, value: string): void {
        try {
            localStorage.setItem(key, value);
        } catch (err) {
            // 忽略存储不可用（隐私模式等）
        }
    }

    // ==================== UI 构建 ====================

    private _buildUi(): void {
        if (this._uiBuilt) return;
        this._uiBuilt = true;

        const bg = createNode('Bg', this.node, 720, 1280);
        const bgG = bg.addComponent(Graphics);
        drawRoundRect(bgG, 720, 1280, 0, toColor(UI.bg));

        const glowNode = createNode('Glow', this.node, 720, 1280);
        const glow = glowNode.addComponent(Graphics);
        glow.fillColor = toColor('#12203A');
        glow.circle(-250, 340, 320);
        glow.fill();
        glow.fillColor = toColor('#0E1A30');
        glow.circle(300, -430, 380);
        glow.fill();

        createBackButton(this.node, () => this.onBack());
        createLabel(this.node, '五子棋', 44, {
            ...this._at(360, 64),
            bold: true,
            width: 360,
            height: 66,
        });
        createLabel(this.node, 'GOMOKU', 15, {
            ...this._at(360, 104),
            color: UI.textMuted,
            width: 300,
            height: 24,
        });

        for (let i = 0; i < MODE_ORDER.length; i++) {
            const key = MODE_ORDER[i];
            const btn = createButton(this.node, {
                w: 158,
                h: 52,
                text: key === 'ai' ? '人机对战' : '双人对战',
                fontSize: 23,
                fill: '#182338',
                activeFill: UI.primary,
                radius: 13,
                stroke: '#26364F',
                onTap: () => this._onModeClicked(key),
            });
            btn.node.setPosition(designPos(360 + (i - 0.5) * 174, 146));
            this._modeBtns[key] = btn;
        }

        for (let i = 0; i < DIFF_ORDER.length; i++) {
            const key = DIFF_ORDER[i];
            const btn = createButton(this.node, {
                w: 150,
                h: 48,
                text: GOMOKU_DIFFS[key].label,
                fontSize: 22,
                fill: '#182338',
                activeFill: '#0E7490',
                radius: 12,
                stroke: '#26364F',
                onTap: () => this._onDifficultyClicked(key),
            });
            btn.node.setPosition(designPos(186 + i * 174, 206));
            this._diffBtns[key] = btn;
        }

        const chipXs = [168, 360, 552];
        this._winValue = this._createStatChip(chipXs[0], 274, '胜', 156).value;
        this._lossValue = this._createStatChip(chipXs[1], 274, '负', 156).value;
        this._drawValue = this._createStatChip(chipXs[2], 274, '平', 156).value;

        const board = createNode('Board', this.node, BOARD_FRAME, BOARD_FRAME);
        board.setPosition(designPos(360, BOARD_CENTER_Y));
        const frameG = board.addComponent(Graphics);
        drawRoundRect(frameG, BOARD_FRAME, BOARD_FRAME, 20, toColor(COLOR_BOARD), toColor(COLOR_BOARD_STROKE), 3);
        this._boardNode = board;

        // 网格用「矩形填充」而非 moveTo/lineTo + stroke()：实测水平线用 stroke 画，
        // 路径几何生成了却整片不渲染（竖线正常、换成 fill 立即可见）。
        // 详见 docs/tech/cocos-graphics-lines-pitfall.md
        const grid = createNode('Grid', board, BOARD_FRAME, BOARD_FRAME).addComponent(Graphics);
        grid.fillColor = toColor(COLOR_GRID);
        for (let i = 0; i < 15; i++) {
            const p = -GRID_HALF + i * CELL;
            grid.rect(-GRID_HALF, p - 1, GRID_HALF * 2, 2);
            grid.fill();
            grid.rect(p - 1, -GRID_HALF, 2, GRID_HALF * 2);
            grid.fill();
        }
        grid.fillColor = toColor(COLOR_STAR);
        const stars = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
        for (let i = 0; i < stars.length; i++) {
            const pos = this._localOf(stars[i][0], stars[i][1]);
            grid.circle(pos.x, pos.y, 4);
            grid.fill();
        }

        const stoneNode = createNode('Stones', board, BOARD_FRAME, BOARD_FRAME);
        this._stoneG = stoneNode.addComponent(Graphics);

        (board as unknown as { __gomoku?: BoardTouchData }).__gomoku = { game: this };
        board.on(Node.EventType.TOUCH_START, onBoardTouchStart);

        this._statusLabel = createLabel(this.node, '', 26, {
            // 状态行是玩家最需要读的一句（轮到你 / 胜负），原来 24 号 #94A3B8
            // 在深色底上偏淡（第二轮复核 N15），提到正文白色。
            color: UI.text,
            width: 660,
            height: 36,
        });
        this._statusLabel.node.setPosition(designPos(360, 996));

        const actions: Array<{ text: string; fill: string; onTap: () => void }> = [
            { text: '悔棋', fill: '#1E293B', onTap: () => this._onUndoClicked() },
            { text: '重开', fill: '#1D4ED8', onTap: () => this.newGame() },
        ];
        const actionW = 200;
        const actionGap = 24;
        for (let i = 0; i < actions.length; i++) {
            const a = actions[i];
            const btn = createButton(this.node, {
                w: actionW,
                h: 70,
                text: a.text,
                fontSize: 25,
                fill: a.fill,
                activeFill: a.fill,
                radius: 16,
                stroke: '#26364F',
                onTap: a.onTap,
            });
            btn.node.setPosition(designPos(360 + (i - 0.5) * (actionW + actionGap), 1082));
        }

        createLabel(this.node, '点交叉点落子 · 先连成五子者胜 · 人机模式可悔棋', 19, {
            ...this._at(360, 1172),
            color: UI.textMuted,
            width: 680,
            height: 26,
        });
    }

    private _at(xFromLeft: number, yFromTop: number): { x: number; y: number } {
        const p = designPos(xFromLeft, yFromTop);
        return { x: p.x, y: p.y };
    }

    private _createStatChip(xFromLeft: number, yFromTop: number, caption: string, w: number): StatChip {
        const node = createNode('Chip', this.node, w, 62);
        node.setPosition(designPos(xFromLeft, yFromTop));
        const g = node.addComponent(Graphics);
        drawRoundRect(g, w, 62, 15, toColor('#141F33'), toColor('#24324A'), 2);
        createLabel(node, caption, 18, {
            // 胜 / 负 / 平 是用户看战绩的唯一线索，16 号 + textMuted 太小太淡（N15）
            y: 13,
            color: UI.textDim,
            width: w - 16,
            height: 22,
        });
        const value = createLabel(node, '0', 26, {
            y: -11,
            bold: true,
            width: w - 16,
            height: 30,
        });
        return { node, value };
    }

    private _localOf(r: number, c: number): { x: number; y: number } {
        return {
            x: c * CELL - GRID_HALF,
            y: GRID_HALF - r * CELL,
        };
    }

    // ==================== 刷新 ====================

    private _refreshAll(): void {
        this._refreshBoard();
        this._refreshStats();
        this._refreshStatus();
        this._refreshButtons();
    }

    private _refreshBoard(): void {
        const core = this._core;
        const g = this._stoneG;
        if (!core || !g) return;
        g.clear();

        for (let i = 0; i < core.board.length; i++) {
            const v = core.board[i];
            if (v === GOMOKU_EMPTY) continue;
            const r = Math.floor(i / core.size);
            const c = i % core.size;
            const pos = this._localOf(r, c);

            g.fillColor = toColor('#050912', 90);
            g.circle(pos.x + 1.5, pos.y - 2.5, STONE_R);
            g.fill();

            g.fillColor = toColor(v === GOMOKU_BLACK ? COLOR_STONE_BLACK : COLOR_STONE_WHITE);
            g.circle(pos.x, pos.y, STONE_R);
            g.fill();

            g.lineWidth = 2;
            g.strokeColor = toColor(
                v === GOMOKU_BLACK ? COLOR_STONE_BLACK_STROKE : COLOR_STONE_WHITE_STROKE,
            );
            g.circle(pos.x, pos.y, STONE_R);
            g.stroke();
        }

        if (core.lastMove >= 0 && core.board[core.lastMove] !== GOMOKU_EMPTY) {
            const r = Math.floor(core.lastMove / core.size);
            const c = core.lastMove % core.size;
            const pos = this._localOf(r, c);
            g.fillColor = toColor(COLOR_LAST);
            g.circle(pos.x, pos.y, 5);
            g.fill();
        }

        for (let i = 0; i < core.winLine.length; i++) {
            const idx = core.winLine[i];
            const r = Math.floor(idx / core.size);
            const c = idx % core.size;
            const pos = this._localOf(r, c);
            g.lineWidth = 3;
            g.strokeColor = toColor(COLOR_WIN);
            g.circle(pos.x, pos.y, STONE_R + 3);
            g.stroke();
        }
    }

    private _refreshStats(): void {
        if (this._winValue) this._winValue.string = String(this._stats.wins);
        if (this._lossValue) this._lossValue.string = String(this._stats.losses);
        if (this._drawValue) this._drawValue.string = String(this._stats.draws);
    }

    private _refreshStatus(): void {
        const core = this._core;
        const label = this._statusLabel;
        if (!core || !label) return;

        let text = '';
        let color = UI.textDim;
        if (core.isOver) {
            if (core.winner === GOMOKU_DRAW) {
                text = '平局';
                color = UI.warning;
            } else if (this._mode === 'ai') {
                const humanWon = core.winner === GOMOKU_BLACK;
                text = humanWon ? '你赢了' : 'AI 获胜';
                color = humanWon ? UI.success : UI.danger;
            } else {
                text = core.winner === GOMOKU_BLACK ? '黑方胜利' : '白方胜利';
                color = UI.warning;
            }
        } else if (this._aiThinking) {
            text = 'AI 思考中…';
            color = UI.accent;
        } else if (this._mode === 'ai') {
            text = core.current === GOMOKU_BLACK ? '轮到你（黑方）' : 'AI（白方）落子';
        } else {
            text = core.current === GOMOKU_BLACK ? '轮到黑方' : '轮到白方';
        }

        label.string = text;
        label.color = toColor(color);
    }

    private _refreshButtons(): void {
        for (let i = 0; i < MODE_ORDER.length; i++) {
            const key = MODE_ORDER[i];
            const btn = this._modeBtns[key];
            if (btn) btn.setActive(key === this._mode);
        }
        const showDiff = this._mode === 'ai';
        for (let i = 0; i < DIFF_ORDER.length; i++) {
            const key = DIFF_ORDER[i];
            const btn = this._diffBtns[key];
            if (!btn) continue;
            btn.node.active = showDiff;
            btn.setActive(key === this._difficulty);
        }
    }

    // ==================== 结算面板 ====================

    private _showOverlay(): void {
        if (this._overlay && this._overlay.isValid) return;
        const core = this._core;
        if (!core) return;

        const root = createNode('Overlay', this.node, 720, 1280);
        root.on(Node.EventType.TOUCH_START, onOverlayTouchStart);
        (root as unknown as { __gomokuDismiss?: () => void }).__gomokuDismiss = () => this._dismissOverlay();
        const dim = root.addComponent(Graphics);
        dim.fillColor = toColor(UI.overlay, 215);
        dim.rect(-360, -640, 720, 1280);
        dim.fill();

        const panel = createNode('Panel', root, 560, 520);
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, 560, 520, 24, toColor(UI.panel), toColor(UI.panelStroke), 2);

        let title = '平局';
        let titleColor = UI.warning;
        if (core.winner !== GOMOKU_DRAW) {
            if (this._mode === 'ai') {
                const humanWon = core.winner === GOMOKU_BLACK;
                title = humanWon ? '你赢了' : 'AI 获胜';
                titleColor = humanWon ? UI.success : UI.danger;
            } else {
                title = core.winner === GOMOKU_BLACK ? '黑方胜利' : '白方胜利';
                titleColor = UI.warning;
            }
        }
        createLabel(panel, title, 46, {
            ...this._atPanel(0, 160),
            bold: true,
            color: titleColor,
            width: 460,
            height: 64,
        });
        const sub = this._mode === 'ai'
            ? `人机 · ${GOMOKU_DIFFS[this._difficulty].label}难度`
            : '本地双人';
        createLabel(panel, sub, 22, {
            ...this._atPanel(0, 96),
            color: UI.textDim,
            width: 460,
            height: 32,
        });
        createLabel(panel, `手数 ${core.moveCount}`, 22, {
            ...this._atPanel(0, 52),
            color: UI.textMuted,
            width: 460,
            height: 30,
        });
        createLabel(panel, `战绩   胜 ${this._stats.wins}   负 ${this._stats.losses}   平 ${this._stats.draws}`, 24, {
            ...this._atPanel(0, 4),
            color: UI.text,
            width: 460,
            height: 34,
        });
        createLabel(panel, '点空白处关闭面板，可悔棋继续', 18, {
            ...this._atPanel(0, -210),
            color: UI.textDim,
            width: 460,
            height: 26,
        });

        const again = createButton(panel, {
            w: 220,
            h: 70,
            text: '再来一局',
            fontSize: 25,
            fill: UI.primary,
            activeFill: UI.primary,
            radius: 16,
            stroke: '#26364F',
            onTap: () => this.newGame(),
        });
        again.node.setPosition(this._atPanel(-122, -150));

        const lobby = createButton(panel, {
            w: 220,
            h: 70,
            text: '返回大厅',
            fontSize: 25,
            fill: '#1E293B',
            activeFill: '#1E293B',
            radius: 16,
            stroke: '#26364F',
            onTap: () => this.onBack(),
        });
        lobby.node.setPosition(this._atPanel(122, -150));

        this._overlay = root;
    }

    private _atPanel(xFromCenter: number, yFromCenter: number): Vec3 {
        return new Vec3(xFromCenter, yFromCenter, 0);
    }

    private _destroyOverlay(): void {
        this._overlayPending = false;
        this._overlayTimer = 0;
        if (this._overlay && this._overlay.isValid) this._overlay.destroy();
        this._overlay = null;
    }

    /** 关闭结算面板但保留终局棋盘，让玩家可以悔棋继续 */
    private _dismissOverlay(): void {
        this._destroyOverlay();
        this._refreshStatus();
    }

    // ==================== 导航 ====================

    onBack(): void {
        SceneManager.gotoLobby();
    }
}
