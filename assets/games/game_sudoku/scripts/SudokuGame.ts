/**
 * 数独 —— 运行时主组件。
 *
 * 场景里只需要一个挂在 Canvas 下的空节点（本组件），所有 UI 在 onLoad 中构建。
 *  - 点格子选中，点下方数字键填数；「笔记」模式下数字键切换候选
 *  - 同行 / 同列 / 同宫高亮，相同数字高亮，冲突数字标红
 *  - 撤销 / 擦除 / 提示 / 新局；计时、失误数、提示数
 *  - 断点续玩：每次操作写入 localStorage，重进游戏自动恢复
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
    toast,
    toColor,
} from '../../../common/ui/GameUIKit';
import { SUDOKU_DIFFS, SudokuCore, SudokuDifficulty } from './SudokuCore';

const { ccclass } = _decorator;

const DIFF_ORDER: SudokuDifficulty[] = ['easy', 'medium', 'hard'];
const CELL = 64;
const BOARD_PX = CELL * 9;
const BOARD_TOP = 286;
const BEST_KEY_PREFIX = 'tiny_games_sudoku_best_';
const DIFF_KEY = 'tiny_games_sudoku_diff';
const SAVE_KEY = 'tiny_games_sudoku_save';

const COLOR_CELL = '#111C2F';
const COLOR_CELL_GIVEN = '#16243C';
const COLOR_PEER = '#182A46';
const COLOR_SAME = '#1E3A5F';
const COLOR_SELECTED = '#1D4ED8';
const COLOR_BAD_BG = '#3A1D26';
const COLOR_TEXT_GIVEN = '#F8FAFC';
const COLOR_TEXT_USER = '#7DD3FC';
const COLOR_TEXT_BAD = '#F87171';
const COLOR_NOTE = '#94A3B8';
const COLOR_NOTE_HL = '#93C5FD';

interface CellView {
    index: number;
    node: Node;
    g: Graphics;
    label: Label;
    noteLabels: Label[];
}

interface StatChip {
    node: Node;
    value: Label;
}

interface CellTouchData {
    game: SudokuGame;
    index: number;
}

function onCellTouchStart(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    const data = (node as unknown as { __cell?: CellTouchData }).__cell;
    if (data) data.game.selectCell(data.index);
}

function onOverlayTouchStart(ev: EventTouch): void {
    ev.propagationStopped = true;
}

@ccclass('SudokuGame')
export class SudokuGame extends Component {
    /** 浏览器探针用 */
    _core: SudokuCore | null = null;
    _difficulty: SudokuDifficulty = 'easy';
    _elapsed = 0;
    _timerRunning = false;
    _notesMode = false;
    _cells: CellView[] = [];
    _best: Partial<Record<SudokuDifficulty, number>> = {};
    _overlay: Node | null = null;

    private _timerStart = 0;
    private _timeLabel: Label | null = null;
    private _mistakeLabel: Label | null = null;
    private _hintLabel: Label | null = null;
    private _statusLabel: Label | null = null;
    private _padBtns: UiButton[] = [];
    private _padCounts: Label[] = [];
    private _noteBtn: UiButton | null = null;
    private _undoBtn: UiButton | null = null;
    private _diffBtns: Partial<Record<SudokuDifficulty, UiButton>> = {};
    private _board: Node | null = null;
    private _gridLines: Graphics | null = null;
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
            if (this._timeLabel) this._timeLabel.string = this._formatTime(this._elapsed);
        }
    }

    onDestroy(): void {
        this._cells = [];
        this._core = null;
        this._board = null;
        this._gridLines = null;
        this._timeLabel = null;
        this._mistakeLabel = null;
        this._hintLabel = null;
        this._statusLabel = null;
        this._padBtns = [];
        this._padCounts = [];
        this._noteBtn = null;
        this._undoBtn = null;
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
        this._notesMode = false;
        const seed = ((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
        this._core = new SudokuCore(this._difficulty, seed);
        this._buildBoard();
        this._refreshAll();
        this._saveSnapshot();
    }

    onBack(): void {
        this._saveSnapshot();
        SceneManager.gotoLobby();
    }

    selectCell(index: number): void {
        const core = this._core;
        if (!core || core.status === 'won' || this._overlay) return;
        core.select(index);
        this._startTimerIfNeeded();
        this._refreshBoard();
        this._saveSnapshot();
    }

    private _startTimerIfNeeded(): void {
        if (this._timerRunning) return;
        this._timerRunning = true;
        this._timerStart = Date.now() - this._elapsed * 1000;
    }

    private _onNumber(n: number): void {
        const core = this._core;
        if (!core || core.status === 'won' || this._overlay) return;
        const changed = this._notesMode ? core.toggleNote(n) : core.input(n);
        if (!changed) return;
        this._startTimerIfNeeded();
        this._refreshAll();
        this._saveSnapshot();
        if (core.isComplete()) this._handleWin();
    }

    private _handleWin(): void {
        const core = this._core;
        if (!core) return;
        this._timerRunning = false;
        const prev = this._best[this._difficulty];
        if (prev === undefined || this._elapsed < prev) {
            this._best[this._difficulty] = this._elapsed;
            this._savePrefs();
        }
        try {
            localStorage.removeItem(SAVE_KEY);
        } catch (err) {
            // ignore
        }
        if (!this._deferOverlayPending) {
            this._deferOverlayPending = true;
            this.scheduleOnce(this._deferredOverlay, 0.5);
        }
    }

    private _deferredOverlay = (): void => {
        this._deferOverlayPending = false;
        this._showOverlay();
    };

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
        glow.circle(-230, 320, 320);
        glow.fill();
        glow.fillColor = toColor('#0E1A30');
        glow.circle(300, -400, 380);
        glow.fill();

        createBackButton(this.node, () => this.onBack());
        createLabel(this.node, '数 独', 44, {
            ...this._at(360, 66),
            bold: true,
            width: 360,
            height: 66,
        });
        createLabel(this.node, 'SUDOKU', 15, {
            ...this._at(360, 106),
            color: UI.textMuted,
            width: 300,
            height: 24,
        });

        this._timeLabel = this._createStatChip(122, 160, '用时').value;
        this._mistakeLabel = this._createStatChip(360, 160, '失误').value;
        this._hintLabel = this._createStatChip(598, 160, '提示').value;

        const diffY = 232;
        const gap = 174;
        for (let i = 0; i < DIFF_ORDER.length; i++) {
            const key = DIFF_ORDER[i];
            const btn = createButton(this.node, {
                w: 158,
                h: 54,
                text: SUDOKU_DIFFS[key].label,
                fontSize: 23,
                fill: '#182338',
                activeFill: UI.primary,
                radius: 13,
                stroke: '#26364F',
                onTap: () => this._onDifficultyClicked(key),
            });
            btn.node.setPosition(designPos(360 + (i - 1) * gap, diffY));
            this._diffBtns[key] = btn;
        }

        this._statusLabel = createLabel(this.node, '', 21, {
            color: UI.textDim,
            width: 660,
            height: 30,
        });

        // 数字键盘
        const padY = BOARD_TOP + BOARD_PX + 96;
        const padW = 68;
        const padGap = 4;
        const padStart = 360 - (9 * padW + 8 * padGap) / 2 + padW / 2;
        for (let n = 1; n <= 9; n++) {
            const btn = createButton(this.node, {
                w: padW,
                h: 84,
                text: String(n),
                fontSize: 32,
                fill: '#182338',
                textColor: UI.text,
                radius: 14,
                stroke: '#26364F',
                onTap: () => this._onNumber(n),
            });
            btn.node.setPosition(designPos(padStart + (n - 1) * (padW + padGap), padY));
            const count = createLabel(btn.node, '', 13, {
                y: -30,
                color: UI.textMuted,
                width: padW - 8,
                height: 16,
            });
            this._padBtns.push(btn);
            this._padCounts.push(count);
        }

        // 功能键
        const actionY = padY + 98;
        const actions: Array<{ text: string; fill: string; onTap: () => void; key: string }> = [
            { text: '笔记', fill: '#B45309', onTap: this._onNoteModeClicked, key: 'note' },
            { text: '擦除', fill: '#1E293B', onTap: this._onEraseClicked, key: 'erase' },
            { text: '撤销', fill: '#1E293B', onTap: this._onUndoClicked, key: 'undo' },
            { text: '提示', fill: '#1E293B', onTap: this._onHintClicked, key: 'hint' },
            { text: '新局', fill: '#1D4ED8', onTap: () => this.newGame(), key: 'new' },
        ];
        const actionW = 126;
        const actionGap = 14;
        const actionStart = 360 - (5 * actionW + 4 * actionGap) / 2 + actionW / 2;
        for (let i = 0; i < actions.length; i++) {
            const a = actions[i];
            const btn = createButton(this.node, {
                w: actionW,
                h: 70,
                text: a.text,
                fontSize: 23,
                fill: a.fill,
                activeFill: '#B45309',
                radius: 16,
                stroke: '#26364F',
                onTap: a.onTap,
            });
            btn.node.setPosition(designPos(actionStart + i * (actionW + actionGap), actionY));
            if (a.key === 'note') this._noteBtn = btn;
            if (a.key === 'undo') this._undoBtn = btn;
        }

        createLabel(this.node, '选中格子后点数字填入 · 笔记模式记录候选', 19, {
            ...this._at(360, actionY + 68),
            color: UI.textMuted,
            width: 660,
            height: 28,
        });
    }

    private _at(xFromLeft: number, yFromTop: number): { x: number; y: number } {
        const p = designPos(xFromLeft, yFromTop);
        return { x: p.x, y: p.y };
    }

    private _createStatChip(xFromLeft: number, yFromTop: number, caption: string): StatChip {
        const node = createNode('Chip', this.node, 210, 64);
        node.setPosition(designPos(xFromLeft, yFromTop));
        const g = node.addComponent(Graphics);
        drawRoundRect(g, 210, 64, 15, toColor('#141F33'), toColor('#24324A'), 2);
        createLabel(node, caption, 17, {
            y: 13,
            color: UI.textMuted,
            width: 194,
            height: 22,
        });
        const value = createLabel(node, '--', 27, {
            y: -11,
            bold: true,
            width: 194,
            height: 30,
        });
        return { node, value };
    }

    private _onDifficultyClicked(diff: SudokuDifficulty): void {
        if (this._difficulty === diff) return;
        this._difficulty = diff;
        this._savePrefs();
        this.newGame();
    }

    private _onNoteModeClicked = (): void => {
        this._notesMode = !this._notesMode;
        this._refreshActions();
    };

    private _onEraseClicked = (): void => {
        const core = this._core;
        if (!core) return;
        if (core.erase()) {
            this._refreshAll();
            this._saveSnapshot();
        }
    };

    private _onUndoClicked = (): void => {
        const core = this._core;
        if (!core) return;
        if (core.undo()) {
            this._refreshAll();
            this._saveSnapshot();
        }
    };

    private _onHintClicked = (): void => {
        const core = this._core;
        if (!core) return;
        const filled = core.hint();
        if (filled < 0) {
            toast(this.node, '没有可以提示的格子了', 1.4);
            return;
        }
        this._refreshAll();
        this._saveSnapshot();
        toast(this.node, '已填入一个正确的数字', 1.4);
        if (core.status === 'won') this._handleWin();
    };

    // ==================== 棋盘 ====================

    private _buildBoard(): void {
        if (this._board && this._board.isValid) this._board.destroy();
        this._cells = [];
        this._gridLines = null;

        const frameW = BOARD_PX + 20;
        const frameH = BOARD_PX + 20;
        const board = createNode('Board', this.node, frameW, frameH);
        board.setPosition(designPos(360, BOARD_TOP + BOARD_PX / 2));
        const frameG = board.addComponent(Graphics);
        drawRoundRect(frameG, frameW, frameH, 16, toColor('#0E1728'), toColor('#2A3A57'), 2);
        this._board = board;

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const index = r * 9 + c;
                const node = createNode('Cell', board, CELL, CELL);
                node.setPosition(
                    (c + 0.5) * CELL - BOARD_PX / 2,
                    BOARD_PX / 2 - (r + 0.5) * CELL,
                    0,
                );
                const g = node.addComponent(Graphics);
                const label = createLabel(node, '', 34, {
                    width: CELL - 4,
                    height: CELL - 4,
                    bold: true,
                    overflow: 'shrink',
                });
                const noteLabels: Label[] = [];
                for (let k = 0; k < 9; k++) {
                    const nx = ((k % 3) - 1) * CELL * 0.27;
                    const ny = (1 - Math.floor(k / 3)) * CELL * 0.27;
                    const nl = createLabel(node, '', 14, {
                        x: nx,
                        y: ny,
                        width: CELL * 0.3,
                        height: CELL * 0.3,
                        color: COLOR_NOTE,
                        overflow: 'shrink',
                    });
                    noteLabels.push(nl);
                }
                (node as unknown as { __cell?: CellTouchData }).__cell = { game: this, index };
                node.on(Node.EventType.TOUCH_START, onCellTouchStart);
                this._cells.push({ index, node, g, label, noteLabels });
            }
        }

        // 网格线画在格子之上
        const lines = createNode('GridLines', board, BOARD_PX, BOARD_PX);
        const lg = lines.addComponent(Graphics);
        this._gridLines = lg;
        this._drawGridLines(lg);

        if (this._statusLabel) {
            this._statusLabel.node.setPosition(designPos(360, BOARD_TOP + BOARD_PX + 20));
        }
    }

    private _drawGridLines(g: Graphics): void {
        g.clear();
        const half = BOARD_PX / 2;
        for (let i = 0; i <= 9; i++) {
            const major = i % 3 === 0;
            g.lineWidth = major ? 3 : 1;
            g.strokeColor = toColor(major ? '#5B7194' : '#26364F');
            const x = -half + i * CELL;
            g.moveTo(x, -half);
            g.lineTo(x, half);
            const y = -half + i * CELL;
            g.moveTo(-half, y);
            g.lineTo(half, y);
            g.stroke();
        }
    }

    // ==================== 刷新 ====================

    private _refreshAll(): void {
        this._refreshBoard();
        this._refreshStats();
        this._refreshActions();
        this._refreshDifficulty();
    }

    private _refreshBoard(): void {
        const core = this._core;
        if (!core) return;
        const conflicts = core.conflicts();
        const sel = core.selected;
        const selValue = sel >= 0 ? core.values[sel] : 0;

        for (let k = 0; k < this._cells.length; k++) {
            const view = this._cells[k];
            const i = view.index;
            const value = core.values[i];
            const isSel = i === sel;
            const isPeer = sel >= 0 && core.isPeer(i, sel);
            const sameValue = selValue > 0 && value === selValue && !isSel;
            const bad = conflicts.has(i);

            let fill = core.given[i] ? COLOR_CELL_GIVEN : COLOR_CELL;
            if (isPeer) fill = COLOR_PEER;
            if (sameValue) fill = COLOR_SAME;
            if (bad && !isSel) fill = COLOR_BAD_BG;
            if (isSel) fill = COLOR_SELECTED;

            drawRoundRect(view.g, CELL - 1, CELL - 1, 4, toColor(fill));
            view.label.node.active = value > 0;
            view.label.string = value > 0 ? String(value) : '';
            view.label.color = toColor(
                bad ? COLOR_TEXT_BAD : core.given[i] ? COLOR_TEXT_GIVEN : COLOR_TEXT_USER,
            );

            const noteMask = core.notes[i] || 0;
            const showNotes = value === 0 && noteMask !== 0;
            for (let n = 0; n < 9; n++) {
                const nl = view.noteLabels[n];
                nl.node.active = showNotes;
                if (!showNotes) continue;
                const bit = 1 << n;
                nl.string = (noteMask & bit) !== 0 ? String(n + 1) : '';
                nl.color = toColor(selValue === n + 1 ? COLOR_NOTE_HL : COLOR_NOTE);
            }
        }
    }

    private _refreshStats(): void {
        const core = this._core;
        if (!core) return;
        if (this._timeLabel) this._timeLabel.string = this._formatTime(this._elapsed);
        if (this._mistakeLabel) this._mistakeLabel.string = String(core.mistakes);
        if (this._hintLabel) this._hintLabel.string = String(core.hintsUsed);
        if (this._statusLabel) {
            if (core.status === 'won') this._statusLabel.string = '全部填对，完成！';
            else if (core.selected < 0) {
                // 提示随进度更新（试玩报告 §3.14：开始填了还一直显示「选一个空格开始」）
                const left = core.remainingCells();
                this._statusLabel.string = left > 0 ? `还差 ${left} 个数字 · 点一个空格继续` : '全部填对，完成！';
            }
            else {
                const r = Math.floor(core.selected / 9) + 1;
                const c = (core.selected % 9) + 1;
                this._statusLabel.string = `第 ${r} 行 · 第 ${c} 列`;
            }
        }

        for (let n = 1; n <= 9; n++) {
            const btn = this._padBtns[n - 1];
            const count = this._padCounts[n - 1];
            if (!btn) continue;
            const left = core.remainingOf(n);
            if (count) {
                count.string = left > 0 ? String(left) : '✓';
                count.color = toColor(left > 0 ? UI.textMuted : UI.success);
            }
            const exhausted = left <= 0;
            btn.setColor(exhausted ? '#0E1726' : '#182338', exhausted ? '#475569' : UI.text);
        }
    }

    private _refreshActions(): void {
        if (this._noteBtn) this._noteBtn.setActive(this._notesMode);
        if (this._undoBtn && this._core) {
            const can = this._core.canUndo();
            this._undoBtn.setColor(can ? '#1E293B' : '#141C2B', can ? UI.text : '#475569');
        }
    }

    private _refreshDifficulty(): void {
        for (let i = 0; i < DIFF_ORDER.length; i++) {
            const key = DIFF_ORDER[i];
            const btn = this._diffBtns[key];
            if (btn) btn.setActive(key === this._difficulty);
        }
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

        const overlay = createNode('Overlay', this.node, 720, 1280);
        const dim = overlay.addComponent(Graphics);
        drawRoundRect(dim, 720, 1280, 0, toColor('#050912', 215));
        overlay.on(Node.EventType.TOUCH_START, onOverlayTouchStart);
        this._overlay = overlay;

        const panel = createNode('Panel', overlay, 580, 470);
        panel.setPosition(0, 20, 0);
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, 580, 470, 28, toColor('#141E33'), toColor('#2C3D5C'), 3);

        createLabel(panel, '数独完成！', 46, {
            y: 158,
            bold: true,
            color: UI.success,
            width: 520,
            height: 60,
        });
        createLabel(panel, '每一步都算数', 22, {
            y: 110,
            color: UI.textDim,
            width: 500,
            height: 30,
        });

        const best = this._best[this._difficulty];
        const rows = [
            ['难度', SUDOKU_DIFFS[this._difficulty].label],
            ['用时', this._formatTime(this._elapsed)],
            ['失误 / 提示', `${core.mistakes} / ${core.hintsUsed}`],
            ['最佳', best === undefined ? '--:--' : this._formatTime(best)],
        ];
        for (let i = 0; i < rows.length; i++) {
            const y = 52 - i * 42;
            createLabel(panel, rows[i][0], 23, {
                x: -150,
                y,
                align: 'left',
                color: UI.textMuted,
                width: 220,
                height: 30,
            });
            createLabel(panel, rows[i][1], 25, {
                x: 130,
                y,
                align: 'right',
                bold: true,
                width: 260,
                height: 30,
            });
        }

        const again = createButton(panel, {
            w: 220,
            h: 76,
            text: '再来一局',
            fontSize: 27,
            fill: '#1D4ED8',
            radius: 18,
            onTap: () => this.newGame(),
        });
        again.node.setPosition(-120, -172, 0);

        const change = createButton(panel, {
            w: 220,
            h: 76,
            text: '换个难度',
            fontSize: 27,
            fill: '#182338',
            stroke: '#2C3D5C',
            radius: 18,
            onTap: this._onOverlayChangeDiff,
        });
        change.node.setPosition(120, -172, 0);

        overlay.setScale(0.94, 0.94, 1);
        tween(overlay)
            .to(0.16, { scale: new Vec3(1, 1, 1) })
            .start();
    }

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
            // ignore
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
        if (!core || core.status === 'won') return;
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify({
                snap: core.snapshot(this._elapsed),
                notesMode: this._notesMode,
            }));
        } catch (err) {
            // ignore
        }
    }

    private _tryRestore(): boolean {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return false;
            const data = JSON.parse(raw) as { snap?: ReturnType<SudokuCore['snapshot']>; notesMode?: boolean };
            if (!data || !data.snap || data.snap.status !== 'playing') return false;
            const core = SudokuCore.fromSnapshot(data.snap);
            if (!core) return false;
            this._core = core;
            this._difficulty = core.difficulty;
            this._elapsed = typeof data.snap.elapsed === 'number' ? data.snap.elapsed : 0;
            this._notesMode = !!data.notesMode;
            this._timerRunning = this._elapsed > 0;
            this._timerStart = Date.now() - this._elapsed * 1000;
            this._buildBoard();
            this._refreshAll();
            return true;
        } catch (err) {
            return false;
        }
    }
}
