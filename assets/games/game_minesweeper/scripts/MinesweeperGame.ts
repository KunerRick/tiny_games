/**
 * 扫雷 —— 运行时主组件。
 *
 * 场景里只需要一个挂在 Canvas 下的空节点（本组件），所有 UI 在 onLoad 中构建。
 *  - 点击翻开；长按 0.38s 插旗；点已翻开的数字 = 和弦
 *  - 也可打开「插旗模式」，手机单手操作更稳
 *  - 首次翻开必定安全，计时从第一次操作开始
 *  - 胜利 / 失败弹出结算面板，最佳成绩按难度分别存 localStorage
 *
 * 约定：事件 handler 全部具名（红线 5）；onDestroy 只清 JS 引用（红线 4）。
 */

import { _decorator, Component, EventTouch, Graphics, Label, Node, Tween, Vec3, tween } from 'cc';
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
    toColor,
} from '../../../common/ui/GameUIKit';
import {
    MINESWEEPER_DIFFS,
    MinesweeperCore,
    MinesweeperDifficulty,
} from './MinesweeperCore';

const { ccclass } = _decorator;

const DIFF_ORDER: MinesweeperDifficulty[] = ['easy', 'medium', 'hard'];
const LONG_PRESS_SEC = 0.38;
const MOVE_SLOP = 18;
const BEST_KEY_PREFIX = 'tiny_games_minesweeper_best_';
const DIFF_KEY = 'tiny_games_minesweeper_diff';
const SAVE_KEY = 'tiny_games_minesweeper_save';

const NUM_COLORS = [
    '',
    '#60A5FA',
    '#4ADE80',
    '#F87171',
    '#C084FC',
    '#FBBF24',
    '#22D3EE',
    '#F472B6',
    '#E5E7EB',
];

interface CellView {
    index: number;
    node: Node;
    g: Graphics;
    label: Label;
}

interface StatChip {
    node: Node;
    value: Label;
}

/** 具名触摸 handler 的上下文挂在节点上 */
interface CellTouchData {
    game: MinesweeperGame;
    index: number;
}

function onCellTouchStart(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    const data = (node as unknown as { __cell?: CellTouchData }).__cell;
    if (data) data.game.beginPress(data.index, ev);
}

function onCellTouchMove(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    const data = (node as unknown as { __cell?: CellTouchData }).__cell;
    if (data) data.game.movePress(ev);
}

function onCellTouchEnd(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    const data = (node as unknown as { __cell?: CellTouchData }).__cell;
    if (data) data.game.endPress(data.index);
}

function onCellTouchCancel(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    const data = (node as unknown as { __cell?: CellTouchData }).__cell;
    if (data) data.game.cancelPress();
}

/** 结算面板只吞 TOUCH_START，按钮自己的 TOUCH_END 不受影响 */
function onOverlayTouchStart(ev: EventTouch): void {
    ev.propagationStopped = true;
}

@ccclass('MinesweeperGame')
export class MinesweeperGame extends Component {
    /** 浏览器探针用 */
    _core: MinesweeperCore | null = null;
    _difficulty: MinesweeperDifficulty = 'easy';
    _flagMode = false;
    _elapsed = 0;
    _timerRunning = false;
    _cells: CellView[] = [];
    _best: Partial<Record<MinesweeperDifficulty, number>> = {};
    _overlay: Node | null = null;
    _paused = false;

    private _timerStart = 0;
    private _timeLabel: Label | null = null;
    private _mineLabel: Label | null = null;
    private _bestLabel: Label | null = null;
    private _statusLabel: Label | null = null;
    private _flagBtn: UiButton | null = null;
    private _newBtn: UiButton | null = null;
    private _backBtn: UiButton | null = null;
    private _diffBtns: Partial<Record<MinesweeperDifficulty, UiButton>> = {};
    private _board: Node | null = null;
    private _cellSize = 48;
    private _boardBottomFromTop = 800;
    private _pressIndex = -1;
    private _pressTime = 0;
    private _pressPos = { x: 0, y: 0 };
    private _pressHandled = false;
    private _deferOverlayPending = false;
    private _uiBuilt = false;

    onLoad(): void {
        this._loadPrefs();
        this._buildUi();
        if (!this._tryRestore()) this.newGame();
    }

    update(dt: number): void {
        if (!this._core) return;
        if (this._timerRunning) {
            this._elapsed = (Date.now() - this._timerStart) / 1000;
        }
        if (this._pressIndex >= 0 && !this._pressHandled) {
            if ((Date.now() - this._pressTime) / 1000 >= LONG_PRESS_SEC) {
                this._pressHandled = true;
                this._toggleFlag(this._pressIndex);
            }
        }
        if (this._timeLabel) this._timeLabel.string = this._formatTime(this._elapsed);
    }

    onDestroy(): void {
        this._cells = [];
        this._core = null;
        this._board = null;
        this._timeLabel = null;
        this._mineLabel = null;
        this._bestLabel = null;
        this._statusLabel = null;
        this._flagBtn = null;
        this._newBtn = null;
        this._backBtn = null;
        this._diffBtns = {};
        this._overlay = null;
    }

    // ==================== 对局控制 ====================

    newGame(): void {
        if (this._deferOverlayPending) {
            this.unschedule(this._deferredOverlay);
            this._deferOverlayPending = false;
        }
        this._destroyOverlay();
        this._elapsed = 0;
        this._timerRunning = false;
        this._pressIndex = -1;
        this._pressHandled = false;
        this._flagMode = false;

        const seed = ((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
        this._core = new MinesweeperCore(this._difficulty, seed);
        this._buildBoard();
        this._refreshAll();
        this._saveSnapshot();
    }

    onBack(): void {
        this._saveSnapshot();
        SceneManager.gotoLobby();
    }

    private _startTimerIfNeeded(): void {
        if (this._timerRunning) return;
        this._timerRunning = true;
        this._timerStart = Date.now() - this._elapsed * 1000;
    }

    private _toggleFlag(index: number): void {
        const core = this._core;
        if (!core) return;
        if (core.status === 'won' || core.status === 'lost') return;
        if (core.toggleFlag(index)) {
            this._refreshAll();
            this._saveSnapshot();
        }
    }

    private _onCellTap(index: number): void {
        const core = this._core;
        if (!core || core.status === 'won' || core.status === 'lost') return;
        if (this._overlay) return;

        if (this._flagMode) {
            this._toggleFlag(index);
            return;
        }

        this._startTimerIfNeeded();

        if (core.revealed[index]) {
            if (core.isNumberCell(index)) core.chord(index);
        } else {
            core.reveal(index);
        }
        this._refreshAll();
        this._saveSnapshot();
        this._checkEnd();
    }

    private _checkEnd(): void {
        const core = this._core;
        if (!core) return;
        if (core.status === 'won' || core.status === 'lost') {
            this._timerRunning = false;
            if (core.status === 'won') {
                const prev = this._best[this._difficulty];
                if (prev === undefined || this._elapsed < prev) {
                    this._best[this._difficulty] = this._elapsed;
                    this._savePrefs();
                }
            }
            if (!this._deferOverlayPending) {
                this._deferOverlayPending = true;
                this.scheduleOnce(this._deferredOverlay, 0.65);
            }
        }
    }

    private _deferredOverlay = (): void => {
        this._deferOverlayPending = false;
        this._showOverlay();
    };

    // ==================== 触摸（由模块级具名 handler 转发） ====================

    beginPress(index: number, ev: EventTouch): void {
        if (!this._core || this._overlay) return;
        if (this._core.status === 'won' || this._core.status === 'lost') return;
        this._pressIndex = index;
        this._pressHandled = false;
        this._pressTime = Date.now();
        const p = ev.getUILocation();
        this._pressPos.x = p.x;
        this._pressPos.y = p.y;
    }

    movePress(ev: EventTouch): void {
        if (this._pressIndex < 0 || this._pressHandled) return;
        const p = ev.getUILocation();
        const dx = p.x - this._pressPos.x;
        const dy = p.y - this._pressPos.y;
        if (dx * dx + dy * dy > MOVE_SLOP * MOVE_SLOP) {
            this._pressIndex = -1;
        }
    }

    endPress(index: number): void {
        const wasHandled = this._pressHandled;
        const pressIndex = this._pressIndex;
        this._pressIndex = -1;
        this._pressHandled = false;
        if (wasHandled || pressIndex < 0) {
            this._refreshAll();
            return;
        }
        if (pressIndex !== index) return;
        this._onCellTap(index);
    }

    cancelPress(): void {
        this._pressIndex = -1;
        this._pressHandled = false;
    }

    // ==================== UI 构建 ====================

    private _buildUi(): void {
        if (this._uiBuilt) return;
        this._uiBuilt = true;

        // 背景
        const bg = createNode('Bg', this.node, 720, 1280);
        bg.setPosition(0, 0, 0);
        const bgG = bg.addComponent(Graphics);
        drawRoundRect(bgG, 720, 1280, 0, toColor(UI.bg));

        // 两团低透明度的光晕，让纯色背景不至于太平
        const glowNode = createNode('Glow', this.node, 720, 1280);
        const glow = glowNode.addComponent(Graphics);
        glow.fillColor = toColor('#13213A');
        glow.circle(-210, 300, 300);
        glow.fill();
        glow.fillColor = toColor('#0F1A2F');
        glow.circle(280, -360, 360);
        glow.fill();

        // 顶部标题与返回
        this._backBtn = createBackButton(this.node, () => this.onBack());
        createLabel(this.node, '扫 雷', 44, {
            ...this._at(360, 66),
            bold: true,
            width: 360,
            height: 66,
        });
        createLabel(this.node, 'MINESWEEPER', 15, {
            ...this._at(360, 108),
            color: UI.textMuted,
            width: 300,
            height: 24,
        });

        this._mineLabel = this._createStatChip(122, 166, '剩余雷数').value;
        this._timeLabel = this._createStatChip(360, 166, '用时').value;
        this._bestLabel = this._createStatChip(598, 166, '最佳').value;

        // 难度切换
        const diffY = 246;
        const gap = 174;
        for (let i = 0; i < DIFF_ORDER.length; i++) {
            const key = DIFF_ORDER[i];
            const btn = createButton(this.node, {
                w: 158,
                h: 58,
                text: MINESWEEPER_DIFFS[key].label,
                fontSize: 24,
                fill: '#182338',
                activeFill: UI.primary,
                radius: 14,
                stroke: '#26364F',
                onTap: () => this._onDifficultyClicked(key),
            });
            btn.node.setPosition(designPos(360 + (i - 1) * gap, diffY));
            this._diffBtns[key] = btn;
        }

        // 状态行（棋盘下方，位置在 _buildBoard 里更新）
        this._statusLabel = createLabel(this.node, '', 22, {
            color: UI.textDim,
            width: 640,
            height: 34,
        });

        // 底部按钮
        this._flagBtn = createButton(this.node, {
            w: 262,
            h: 78,
            text: '插旗模式：关',
            fontSize: 26,
            fill: '#182338',
            activeFill: '#B45309',
            radius: 18,
            stroke: '#26364F',
            onTap: this._onFlagModeClicked,
        });
        this._flagBtn.node.setPosition(designPos(212, 1128));

        const newBtn = createButton(this.node, {
            w: 262,
            h: 78,
            text: '重开一局',
            fontSize: 26,
            fill: '#1D4ED8',
            textColor: UI.white,
            radius: 18,
            onTap: () => this.newGame(),
        });
        newBtn.node.setPosition(designPos(508, 1128));
        this._newBtn = newBtn;

        createLabel(this.node, '首次点击必安全 · 数字表示周围雷数', 20, {
            ...this._at(360, 1192),
            color: UI.textMuted,
            width: 660,
            height: 30,
        });
    }

    private _at(xFromLeft: number, yFromTop: number): { x: number; y: number } {
        const p = designPos(xFromLeft, yFromTop);
        return { x: p.x, y: p.y };
    }

    private _createStatChip(xFromLeft: number, yFromTop: number, caption: string): StatChip {
        const node = createNode('Chip', this.node, 210, 68);
        node.setPosition(designPos(xFromLeft, yFromTop));
        const g = node.addComponent(Graphics);
        drawRoundRect(g, 210, 68, 16, toColor('#141F33'), toColor('#24324A'), 2);
        createLabel(node, caption, 18, {
            y: 14,
            color: UI.textMuted,
            width: 194,
            height: 24,
        });
        const value = createLabel(node, '--', 28, {
            y: -12,
            bold: true,
            width: 194,
            height: 32,
        });
        return { node, value };
    }

    private _onDifficultyClicked(diff: MinesweeperDifficulty): void {
        if (this._difficulty === diff && this._core && this._core.status !== 'won' && this._core.status !== 'lost') {
            return;
        }
        this._difficulty = diff;
        this._savePrefs();
        this.newGame();
    }

    private _onFlagModeClicked = (): void => {
        this._flagMode = !this._flagMode;
        this._refreshAll();
    };

    // ==================== 棋盘 ====================

    private _buildBoard(): void {
        const core = this._core;
        if (!core) return;
        if (this._board && this._board.isValid) this._board.destroy();
        this._cells = [];

        // 9×9 屏效有富余（试玩报告 §3.13）：上限从 64 提到 76、可用宽度提到 684，
        // 9 列从 64 → 76（+19%），16/30 列仍按宽度自适应。
        const maxW = 684;
        const cell = Math.min(76, Math.floor(maxW / core.cols));
        this._cellSize = cell;
        const boardW = cell * core.cols;
        const boardH = cell * core.rows;
        const top = 300;
        this._boardBottomFromTop = top + boardH;

        const frameW = boardW + 18;
        const frameH = boardH + 18;
        const board = createNode('Board', this.node, frameW, frameH);
        board.setPosition(designPos(360, top + boardH / 2));
        const frameG = board.addComponent(Graphics);
        drawRoundRect(frameG, frameW, frameH, 18, toColor('#101A2B'), toColor('#2A3A57'), 2);
        this._board = board;

        for (let r = 0; r < core.rows; r++) {
            for (let c = 0; c < core.cols; c++) {
                const index = r * core.cols + c;
                const node = createNode('Cell', board, cell - 3, cell - 3);
                node.setPosition(
                    (c + 0.5) * cell - boardW / 2,
                    boardH / 2 - (r + 0.5) * cell,
                    0,
                );
                const g = node.addComponent(Graphics);
                const label = createLabel(node, '', Math.max(16, Math.floor(cell * 0.5)), {
                    width: cell - 4,
                    height: cell - 4,
                    bold: true,
                    overflow: 'shrink',
                });
                label.node.setPosition(0, 0, 0);
                (node as unknown as { __cell?: CellTouchData }).__cell = { game: this, index };
                node.on(Node.EventType.TOUCH_START, onCellTouchStart);
                node.on(Node.EventType.TOUCH_MOVE, onCellTouchMove);
                node.on(Node.EventType.TOUCH_END, onCellTouchEnd);
                node.on(Node.EventType.TOUCH_CANCEL, onCellTouchCancel);
                this._cells.push({ index, node, g, label });
            }
        }

        if (this._statusLabel) {
            this._statusLabel.node.setPosition(designPos(360, this._boardBottomFromTop + 52));
        }
        this._layoutBottomBar();
    }

    private _layoutBottomBar(): void {
        const bottom = this._boardBottomFromTop;
        // 棋盘占用高度随难度变化：底部按钮贴着棋盘下方排，别留一大片空
        const actionY = Math.max(bottom + 150, 1090);
        if (this._flagBtn && this._flagBtn.node.isValid) {
            this._flagBtn.node.setPosition(designPos(212, actionY));
        }
        if (this._newBtn && this._newBtn.node.isValid) {
            this._newBtn.node.setPosition(designPos(508, actionY));
        }
    }

    // ==================== 刷新 ====================

    private _refreshAll(): void {
        const core = this._core;
        if (!core) return;

        for (let i = 0; i < this._cells.length; i++) this._drawCell(this._cells[i]);

        if (this._mineLabel) this._mineLabel.string = String(core.remainingMines());
        if (this._timeLabel) this._timeLabel.string = this._formatTime(this._elapsed);
        if (this._bestLabel) {
            const best = this._best[this._difficulty];
            this._bestLabel.string = best === undefined ? '--:--' : this._formatTime(best);
        }
        if (this._statusLabel) {
            if (core.status === 'won') this._statusLabel.string = '全部扫清，漂亮！';
            else if (core.status === 'lost') this._statusLabel.string = '踩到地雷了，再来一局吧';
            else if (this._flagMode) this._statusLabel.string = '插旗模式：点击格子插旗 / 拔旗';
            else this._statusLabel.string = '点击翻开 · 长按插旗';
            this._statusLabel.node.setPosition(designPos(360, this._boardBottomFromTop + 52));
        }
        if (this._flagBtn) {
            this._flagBtn.setText(this._flagMode ? '插旗模式：开' : '插旗模式：关');
            this._flagBtn.setActive(this._flagMode);
        }
        for (let i = 0; i < DIFF_ORDER.length; i++) {
            const key = DIFF_ORDER[i];
            const btn = this._diffBtns[key];
            if (btn) btn.setActive(key === this._difficulty);
        }
    }

    private _drawCell(view: CellView): void {
        const core = this._core;
        if (!core) return;
        const i = view.index;
        const g = view.g;
        const size = this._cellSize - 3;
        const half = size / 2;
        g.clear();
        view.label.string = '';

        const revealed = core.revealed[i] === 1;
        const exploded = core.exploded === i;
        const mineShown = core.showMine(i) || (core.status === 'won' && core.mines[i] === 1 && !core.flagged[i]);
        const wrongFlag = core.showWrongFlag(i);
        const flagged = core.flagged[i] === 1 && !wrongFlag;

        // 底色
        if (exploded) {
            drawRoundRect(g, size, size, 9, toColor('#7F1D1D'), toColor('#EF4444'), 2);
        } else if (revealed) {
            drawRoundRect(g, size, size, 9, toColor('#233150'), toColor('#2C3B5C'), 1);
        } else if (wrongFlag) {
            drawRoundRect(g, size, size, 9, toColor('#3A1D28'), toColor('#7F1D1D'), 2);
        } else {
            drawRoundRect(g, size, size, 9, toColor('#354562'), toColor('#4A5C7F'), 2);
            // 顶部一道高光，做出立体感
            g.fillColor = toColor('#43567A');
            g.roundRect(-half + 3, half - 7, size - 6, 4, 2);
            g.fill();
        }

        if (flagged) {
            this._drawFlag(g, size);
        } else if (wrongFlag) {
            this._drawFlag(g, size);
            g.strokeColor = toColor('#F87171');
            g.lineWidth = 4;
            g.moveTo(-half + 7, -half + 7);
            g.lineTo(half - 7, half - 7);
            g.moveTo(half - 7, -half + 7);
            g.lineTo(-half + 7, half - 7);
            g.stroke();
        } else if (mineShown) {
            this._drawMine(g, size, exploded);
        }

        if (revealed && core.mines[i] === 0 && core.adj[i] > 0) {
            view.label.string = String(core.adj[i]);
            view.label.color = toColor(NUM_COLORS[core.adj[i]] || UI.text);
        }
    }

    private _drawFlag(g: Graphics, size: number): void {
        const half = size / 2;
        g.strokeColor = toColor('#E2E8F0');
        g.lineWidth = Math.max(2, size * 0.06);
        g.moveTo(-size * 0.08, -half + size * 0.18);
        g.lineTo(-size * 0.08, half - size * 0.2);
        g.stroke();
        g.fillColor = toColor('#EF4444');
        g.moveTo(-size * 0.06, half - size * 0.22);
        g.lineTo(size * 0.32, half - size * 0.34);
        g.lineTo(-size * 0.06, size * 0.02);
        g.close();
        g.fill();
        g.fillColor = toColor('#CBD5E1');
        g.roundRect(-size * 0.2, -half + size * 0.12, size * 0.26, size * 0.07, 2);
        g.fill();
    }

    private _drawMine(g: Graphics, size: number, exploded: boolean): void {
        const r = size * 0.2;
        g.fillColor = toColor(exploded ? '#FEE2E2' : '#0F172A');
        g.circle(0, 0, r);
        g.fill();
        g.strokeColor = toColor(exploded ? '#FCA5A5' : '#94A3B8');
        g.lineWidth = Math.max(2, size * 0.05);
        g.circle(0, 0, r);
        g.stroke();
        // 尖刺
        g.lineWidth = Math.max(2, size * 0.045);
        for (let k = 0; k < 4; k++) {
            const a = (Math.PI / 4) * (k * 2 + 1);
            const dx = Math.cos(a);
            const dy = Math.sin(a);
            g.moveTo(dx * r * 0.5, dy * r * 0.5);
            g.lineTo(dx * r * 1.7, dy * r * 1.7);
        }
        g.stroke();
        // 高光
        g.fillColor = toColor('#FFFFFF', 90);
        g.circle(-r * 0.35, r * 0.35, r * 0.22);
        g.fill();
    }

    private _formatTime(seconds: number): string {
        const total = Math.max(0, Math.floor(seconds));
        const mm = Math.floor(total / 60);
        const ss = total % 60;
        return `${mm < 10 ? '0' : ''}${mm}:${ss < 10 ? '0' : ''}${ss}`;
    }

    // ==================== 结算 ====================

    private _showOverlay(): void {
        const core = this._core;
        if (!core || !this._uiBuilt || this._overlay) return;
        const won = core.status === 'won';

        const overlay = createNode('Overlay', this.node, 720, 1280);
        overlay.setPosition(0, 0, 0);
        const dim = overlay.addComponent(Graphics);
        drawRoundRect(dim, 720, 1280, 0, toColor('#050912', 235));
        overlay.on(Node.EventType.TOUCH_START, onOverlayTouchStart);
        this._overlay = overlay;

        const panel = createNode('Panel', overlay, 580, 470);
        panel.setPosition(0, 20, 0);
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, 580, 470, 28, toColor('#141E33'), toColor('#2C3D5C'), 3);

        createLabel(panel, won ? '扫雷成功！' : '踩到地雷', 46, {
            y: 158,
            bold: true,
            color: won ? UI.success : UI.danger,
            width: 520,
            height: 60,
        });
        createLabel(panel, won ? '这一局扫得很干净' : '别灰心，下一局小心点', 22, {
            y: 110,
            color: UI.textDim,
            width: 500,
            height: 30,
        });

        const best = this._best[this._difficulty];
        const rows = [
            ['难度', MINESWEEPER_DIFFS[this._difficulty].label],
            ['用时', this._formatTime(this._elapsed)],
            ['最佳', best === undefined ? '--:--' : this._formatTime(best)],
        ];
        for (let i = 0; i < rows.length; i++) {
            const y = 40 - i * 46;
            createLabel(panel, rows[i][0], 24, {
                x: -150,
                y,
                align: 'left',
                color: UI.textMuted,
                width: 200,
                height: 32,
            });
            createLabel(panel, rows[i][1], 26, {
                x: 130,
                y,
                align: 'right',
                bold: true,
                width: 260,
                height: 32,
            });
        }

        const again = createButton(panel, {
            w: 164,
            h: 72,
            text: '再来一局',
            fontSize: 25,
            fill: '#1D4ED8',
            radius: 18,
            onTap: this._onOverlayAgain,
        });
        again.node.setPosition(-178, -158, 0);

        const change = createButton(panel, {
            w: 164,
            h: 72,
            text: '换个难度',
            fontSize: 25,
            fill: '#182338',
            stroke: '#2C3D5C',
            radius: 18,
            onTap: this._onOverlayChangeDiff,
        });
        change.node.setPosition(0, -158, 0);

        // 结算面板必须自带「返回大厅」：全屏遮罩会吞掉左上返回键的触摸，
        // 只靠左上角的话玩家会被锁在结算页（试玩报告 2026-11-13 P1-1）
        const lobby = createButton(panel, {
            w: 164,
            h: 72,
            text: '返回大厅',
            fontSize: 25,
            fill: '#182338',
            stroke: '#2C3D5C',
            radius: 18,
            onTap: () => this.onBack(),
        });
        lobby.node.setPosition(178, -158, 0);

        overlay.setScale(0.94, 0.94, 1);
        tween(overlay)
            .to(0.16, { scale: new Vec3(1, 1, 1) })
            .start();

        // 左上返回键抬到遮罩之上：结算态下仍可见、可点（P1-1）
        const back = this._backBtn && this._backBtn.node;
        if (back && back.isValid && back.parent === this.node) {
            back.setSiblingIndex(this.node.children.length - 1);
        }
    }

    private _onOverlayAgain = (): void => {
        this.newGame();
    };

    private _onOverlayChangeDiff = (): void => {
        const idx = DIFF_ORDER.indexOf(this._difficulty);
        this._difficulty = DIFF_ORDER[(idx + 1) % DIFF_ORDER.length];
        this._savePrefs();
        this.newGame();
    };

    private _destroyOverlay(): void {
        if (this._overlay && this._overlay.isValid) {
            Tween.stopAllByTarget(this._overlay);
            this._overlay.destroy();
        }
        this._overlay = null;
    }

    // ==================== 存档 ====================

    private _loadPrefs(): void {
        try {
            const diff = localStorage.getItem(DIFF_KEY);
            if (diff === 'easy' || diff === 'medium' || diff === 'hard') this._difficulty = diff;
            for (let i = 0; i < DIFF_ORDER.length; i++) {
                const key = DIFF_ORDER[i];
                const raw = localStorage.getItem(BEST_KEY_PREFIX + key);
                const value = raw === null ? NaN : parseFloat(raw);
                if (isFinite(value) && value > 0) this._best[key] = value;
            }
        } catch (err) {
            // localStorage 不可用时忽略
        }
    }

    private _savePrefs(): void {
        try {
            localStorage.setItem(DIFF_KEY, this._difficulty);
            for (let i = 0; i < DIFF_ORDER.length; i++) {
                const key = DIFF_ORDER[i];
                const best = this._best[key];
                if (best !== undefined) localStorage.setItem(BEST_KEY_PREFIX + key, String(best));
            }
        } catch (err) {
            // ignore
        }
    }

    private _saveSnapshot(): void {
        const core = this._core;
        if (!core) return;
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify({
                snap: core.snapshot(),
                elapsed: this._elapsed,
                flagMode: this._flagMode,
            }));
        } catch (err) {
            // ignore
        }
    }

    /** 打开游戏时恢复未完成的一局；已结束 / 无存档则返回 false */
    private _tryRestore(): boolean {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return false;
            const data = JSON.parse(raw) as {
                snap?: ReturnType<MinesweeperCore['snapshot']>;
                elapsed?: number;
                flagMode?: boolean;
            };
            if (!data || !data.snap) return false;
            if (data.snap.status !== 'playing' && data.snap.status !== 'ready') return false;
            const core = MinesweeperCore.fromSnapshot(data.snap);
            if (!core || core.cols === 0) return false;
            this._core = core;
            this._difficulty = core.difficultyKey;
            this._elapsed = typeof data.elapsed === 'number' ? data.elapsed : 0;
            this._flagMode = !!data.flagMode;
            this._timerRunning = core.status === 'playing';
            this._timerStart = Date.now() - this._elapsed * 1000;
            this._buildBoard();
            this._refreshAll();
            return true;
        } catch (err) {
            return false;
        }
    }
}
