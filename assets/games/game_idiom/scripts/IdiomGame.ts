/**
 * 成语填字 —— 运行时主组件。
 *
 * 场景里只需要一个挂在 Canvas 下的空节点（本组件），所有 UI 在 onLoad 中构建。
 *  - 点空格选中，底部候选条显示该条成语的字组（含干扰字）
 *  - 同一交叉格再点一次切换横 / 竖方向
 *  - 一条成语填满自动校验：正确锁定计分，错误红闪后清空未锁定格
 *  - 提示 / 擦除 / 新局；计时、失误、提示、得分；断点续玩
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
import {
    IDIOM_DIFFS,
    IdiomCore,
    IdiomDifficulty,
} from './IdiomCore';

const { ccclass } = _decorator;

const DIFF_ORDER: IdiomDifficulty[] = ['easy', 'medium', 'hard'];
const BEST_KEY_PREFIX = 'tiny_games_idiom_best_';
const DIFF_KEY = 'tiny_games_idiom_diff';
const SAVE_KEY = 'tiny_games_idiom_save';

const BOARD_TOP = 272;
/** 棋盘可用竖直区间（到候选字/状态行之前），用于把裁剪后的棋盘居中摆放 */
const BOARD_BAND_H = 584;
const CHIPS_Y = 150;
const DIFF_Y = 228;

const COLOR_FRAME = '#101B2E';
const COLOR_FRAME_STROKE = '#2A3A57';
const COLOR_CELL = '#1B2740';
const COLOR_CELL_ACTIVE = '#27405F';
const COLOR_CELL_SELECTED = '#1D4ED8';
const COLOR_CELL_LOCKED = '#231F12';
const COLOR_CELL_FLASH = '#7F1D1D';
const COLOR_TEXT_USER = '#7DD3FC';
const COLOR_TEXT_KNOWN = '#F8FAFC';
const COLOR_TEXT_LOCKED = '#FBBF24';
const COLOR_TEXT_FLASH = '#FCA5A5';

interface CellView {
    index: number;
    node: Node;
    g: Graphics;
    label: Label;
}

interface CellTouchData {
    game: IdiomGame;
    index: number;
}

interface StatChip {
    node: Node;
    value: Label;
}

function onCellTouchStart(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    const data = (node as unknown as { __cell?: CellTouchData }).__cell;
    if (data) data.game.selectCell(data.index);
}

function onOverlayTouchStart(ev: EventTouch): void {
    ev.propagationStopped = true;
}

@ccclass('IdiomGame')
export class IdiomGame extends Component {
    /** 浏览器探针用 */
    _core: IdiomCore | null = null;
    _difficulty: IdiomDifficulty = 'easy';
    _elapsed = 0;
    _started = false;
    _cells: CellView[] = [];
    _best: Partial<Record<IdiomDifficulty, number>> = {};
    _flashCells: number[] = [];
    _overlay: Node | null = null;
    _isNewBest = false;

    private _timerStart = 0;
    private _timeLabel: Label | null = null;
    private _scoreLabel: Label | null = null;
    private _mistakeLabel: Label | null = null;
    private _hintLabel: Label | null = null;
    private _statusLabel: Label | null = null;
    private _bankLabel: Label | null = null;
    private _board: Node | null = null;
    private _bankNode: Node | null = null;
    private _bankKey = '';
    private _diffBtns: Partial<Record<IdiomDifficulty, UiButton>> = {};
    private _againBtn: UiButton | null = null;
    private _backBtn: UiButton | null = null;
    private _uiBuilt = false;
    private _deferOverlayPending = false;
    private _flashToken = 0;

    onLoad(): void {
        this._loadPrefs();
        this._buildUi();
        if (!this._tryRestore()) this.newGame();
    }

    update(dt: number): void {
        if (!this._core) return;
        if (this._started && this._core.status === 'playing') {
            this._elapsed = (Date.now() - this._timerStart) / 1000;
            if (this._timeLabel) this._timeLabel.string = this._formatTime(this._elapsed);
        }
    }

    onDestroy(): void {
        this.unscheduleAllCallbacks();
        this._cells = [];
        this._core = null;
        this._board = null;
        this._bankNode = null;
        this._timeLabel = null;
        this._scoreLabel = null;
        this._mistakeLabel = null;
        this._hintLabel = null;
        this._statusLabel = null;
        this._bankLabel = null;
        this._diffBtns = {};
        this._againBtn = null;
        this._backBtn = null;
        this._overlay = null;
    }

    // ==================== 对局控制 ====================

    newGame(): void {
        if (this._deferOverlayPending) {
            this.unschedule(this._deferredOverlay);
            this._deferOverlayPending = false;
        }
        this._destroyOverlay();
        this._flashToken++;
        this._flashCells = [];
        this._elapsed = 0;
        this._started = false;
        this._isNewBest = false;
        this._bankKey = '';
        const seed = ((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
        this._core = new IdiomCore(this._difficulty, seed);
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
        if (!core || core.status === 'won' || this._overlay || core.isResolving) return;
        if (!core.select(index)) return;
        this._startTimerIfNeeded();
        this._refreshAll();
        this._saveSnapshot();
    }

    private _startTimerIfNeeded(): void {
        if (this._started) return;
        this._started = true;
        this._timerStart = Date.now() - this._elapsed * 1000;
    }

    private _onBankChar(char: string): void {
        const core = this._core;
        if (!core || core.status === 'won' || this._overlay || core.isResolving) return;
        const result = core.fill(char);
        if (result.kind === 'none') return;
        this._startTimerIfNeeded();
        if (result.kind === 'wrong') {
            this._flashCells = result.wrongCells.slice();
            this._refreshBoard();
            this._refreshStats();
            toast(this.node, '这条成语不对，再想想', 1.2);
            const token = ++this._flashToken;
            this.scheduleOnce(() => this._resolveWrong(token), 0.9);
            return;
        }
        this._refreshAll();
        this._saveSnapshot();
        if (result.kind === 'correct' && !core.isWon) {
            const streak = core.streak;
            toast(this.node, streak >= 2 ? `连击 x${streak}！` : '这条成语填对了', 1.1);
        }
        if (core.isWon) this._handleWin();
    }

    private _resolveWrong(token: number): void {
        if (token !== this._flashToken) return;
        const core = this._core;
        if (!core) return;
        this._flashCells = [];
        core.resolveWrong();
        this._refreshAll();
        this._saveSnapshot();
    }

    private _onEraseClicked(): void {
        const core = this._core;
        if (!core || core.isResolving) return;
        if (!core.erase()) {
            toast(this.node, '这里没有可以擦掉的字', 1.2);
            return;
        }
        this._refreshAll();
        this._saveSnapshot();
    }

    private _onHintClicked(): void {
        const core = this._core;
        if (!core || core.isResolving) return;
        if (core.hintsLeft <= 0) {
            toast(this.node, '提示次数已经用完了', 1.3);
            return;
        }
        const idx = core.hint();
        if (idx < 0) {
            toast(this.node, '先选一个还没完成的成语', 1.3);
            return;
        }
        core.select(idx);
        this._startTimerIfNeeded();
        this._refreshAll();
        this._saveSnapshot();
        toast(this.node, core.hintClearedSlot ? '这条成语里有填错的字，已清空重填' : '已填入一个正确的字', 1.4);
        if (core.isWon) this._handleWin();
    }

    private _handleWin(): void {
        const core = this._core;
        if (!core) return;
        this._started = false;
        if (this._timeLabel) this._timeLabel.string = this._formatTime(this._elapsed);
        const final = core.finalScore(this._elapsed);
        const prev = this._best[this._difficulty];
        this._isNewBest = prev === undefined || final > prev;
        if (this._isNewBest) {
            this._best[this._difficulty] = final;
            this._savePrefs();
        }
        try {
            localStorage.removeItem(SAVE_KEY);
        } catch (err) {
            // ignore
        }
        if (!this._deferOverlayPending) {
            this._deferOverlayPending = true;
            this.scheduleOnce(this._deferredOverlay, 0.55);
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
        glow.circle(-230, 330, 320);
        glow.fill();
        glow.fillColor = toColor('#0E1A30');
        glow.circle(300, -420, 380);
        glow.fill();

        this._backBtn = createBackButton(this.node, () => this.onBack());
        createLabel(this.node, '成语填字', 44, {
            ...this._at(360, 64),
            bold: true,
            width: 360,
            height: 66,
        });
        createLabel(this.node, 'IDIOM CROSSWORD', 15, {
            ...this._at(360, 104),
            color: UI.textMuted,
            width: 300,
            height: 24,
        });

        const chipW = 156;
        const chipXs = [114, 278, 442, 606];
        this._timeLabel = this._createStatChip(chipXs[0], CHIPS_Y, '用时', chipW).value;
        this._scoreLabel = this._createStatChip(chipXs[1], CHIPS_Y, '得分', chipW).value;
        this._mistakeLabel = this._createStatChip(chipXs[2], CHIPS_Y, '错误', chipW).value;
        // 数值是「剩余次数」，标题必须写明，否则玩家不知道 3 是剩 3 次还是已用 3 次（复核 R5）
        this._hintLabel = this._createStatChip(chipXs[3], CHIPS_Y, '提示剩余', chipW).value;

        const gap = 174;
        for (let i = 0; i < DIFF_ORDER.length; i++) {
            const key = DIFF_ORDER[i];
            const btn = createButton(this.node, {
                w: 158,
                h: 52,
                text: IDIOM_DIFFS[key].label,
                fontSize: 23,
                fill: '#182338',
                activeFill: UI.primary,
                radius: 13,
                stroke: '#26364F',
                onTap: () => this._onDifficultyClicked(key),
            });
            btn.node.setPosition(designPos(360 + (i - 1) * gap, DIFF_Y));
            this._diffBtns[key] = btn;
        }

        this._statusLabel = createLabel(this.node, '', 21, {
            color: UI.textDim,
            width: 660,
            height: 30,
        });

        this._bankLabel = createLabel(this.node, '', 18, {
            color: UI.textMuted,
            width: 660,
            height: 26,
        });
        this._bankLabel.node.setPosition(designPos(360, 944));

        this._bankNode = createNode('Bank', this.node, 680, 90);
        this._bankNode.setPosition(designPos(360, 1002));

        const actions: Array<{ text: string; fill: string; onTap: () => void }> = [
            { text: '擦除', fill: '#1E293B', onTap: () => this._onEraseClicked() },
            { text: '提示', fill: '#0E7490', onTap: () => this._onHintClicked() },
            { text: '新局', fill: '#1D4ED8', onTap: () => this.newGame() },
        ];
        const actionW = 170;
        const actionGap = 26;
        const actionStart = 360 - (3 * actionW + 2 * actionGap) / 2 + actionW / 2;
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
            btn.node.setPosition(designPos(actionStart + i * (actionW + actionGap), 1115));
        }

        createLabel(this.node, '填满整条成语会自动校验 · 填错记一次失误', 18, {
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
            y: 13,
            color: UI.textMuted,
            width: w - 16,
            height: 20,
        });
        const value = createLabel(node, '--', 26, {
            y: -11,
            bold: true,
            width: w - 16,
            height: 30,
        });
        return { node, value };
    }

    private _onDifficultyClicked(diff: IdiomDifficulty): void {
        if (this._difficulty === diff) return;
        this._difficulty = diff;
        this._savePrefs();
        this.newGame();
    }

    // ==================== 棋盘 ====================

    private _buildBoard(): void {
        const core = this._core;
        if (!core) return;
        if (this._board && this._board.isValid) this._board.destroy();
        this._cells = [];

        const conf = IDIOM_DIFFS[this._difficulty];
        const cell = conf.cell;
        // 成语只占网格的一部分：按实际占用范围裁剪外框并居中，避免整盘偏到一侧
        let minRow = core.size, maxRow = -1, minCol = core.size, maxCol = -1;
        for (let i = 0; i < core.solution.length; i++) {
            if (core.solution[i] === '') continue;
            const r = Math.floor(i / core.size);
            const c = i % core.size;
            if (r < minRow) minRow = r;
            if (r > maxRow) maxRow = r;
            if (c < minCol) minCol = c;
            if (c > maxCol) maxCol = c;
        }
        if (maxRow < 0) { minRow = 0; maxRow = 0; minCol = 0; maxCol = 0; }
        const contentW = (maxCol - minCol + 1) * cell;
        const contentH = (maxRow - minRow + 1) * cell;
        const frameW = contentW + 20;
        const frameH = contentH + 20;
        const boardTop = BOARD_TOP + Math.max(0, (BOARD_BAND_H - frameH) / 2);
        const board = createNode('Board', this.node, frameW, frameH);
        board.setPosition(designPos(360, boardTop + frameH / 2));
        const frameG = board.addComponent(Graphics);
        drawRoundRect(frameG, frameW, frameH, 16, toColor(COLOR_FRAME), toColor(COLOR_FRAME_STROKE), 2);
        this._board = board;

        for (let i = 0; i < core.solution.length; i++) {
            if (core.solution[i] === '') continue;
            const r = Math.floor(i / core.size);
            const c = i % core.size;
            const node = createNode('Cell', board, cell, cell);
            node.setPosition(
                (c - minCol + 0.5) * cell - contentW / 2,
                contentH / 2 - (r - minRow + 0.5) * cell,
                0,
            );
            const g = node.addComponent(Graphics);
            const label = createLabel(node, '', Math.round(cell * 0.52), {
                width: cell - 4,
                height: cell - 4,
                bold: true,
                overflow: 'shrink',
                color: COLOR_TEXT_USER,
            });
            (node as unknown as { __cell?: CellTouchData }).__cell = { game: this, index: i };
            node.on(Node.EventType.TOUCH_START, onCellTouchStart);
            this._cells.push({ index: i, node, g, label });
        }

        if (this._statusLabel) {
            this._statusLabel.node.setPosition(designPos(360, boardTop + frameH + 26));
        }
    }

    // ==================== 刷新 ====================

    private _refreshAll(): void {
        this._refreshBoard();
        this._refreshStats();
        this._refreshBank();
        this._refreshDifficulty();
    }

    private _refreshBoard(): void {
        const core = this._core;
        if (!core) return;
        const conf = IDIOM_DIFFS[this._difficulty];
        const cell = conf.cell;
        const activeCells = core.activeSlot >= 0 ? core.slots[core.activeSlot].cells : [];

        for (let k = 0; k < this._cells.length; k++) {
            const view = this._cells[k];
            const idx = view.index;
            const value = core.values[idx];
            const isSelected = core.selected === idx;
            const isLocked = core.locked[idx];
            const isKnown = core.known[idx];
            const isActive = activeCells.indexOf(idx) >= 0;
            const flashing = this._flashCells.indexOf(idx) >= 0;

            let fill = COLOR_CELL;
            if (isActive) fill = COLOR_CELL_ACTIVE;
            if (isSelected && !isLocked) fill = COLOR_CELL_SELECTED;
            if (isLocked) fill = COLOR_CELL_LOCKED;
            if (flashing) fill = COLOR_CELL_FLASH;

            const stroke = isLocked && !isSelected && !flashing
                ? toColor('#7C5A12')
                : toColor('#2C3E60');
            drawRoundRect(view.g, cell - 2, cell - 2, 5, toColor(fill), stroke, 2);

            view.label.node.active = !!value;
            view.label.string = value || '';
            view.label.color = toColor(
                flashing
                    ? COLOR_TEXT_FLASH
                    : isKnown
                        ? COLOR_TEXT_KNOWN
                        : isLocked
                            ? COLOR_TEXT_LOCKED
                            : COLOR_TEXT_USER,
            );
        }
    }

    private _refreshStats(): void {
        const core = this._core;
        if (!core) return;
        if (this._timeLabel) this._timeLabel.string = this._formatTime(this._elapsed);
        if (this._scoreLabel) this._scoreLabel.string = String(core.score);
        if (this._mistakeLabel) this._mistakeLabel.string = String(core.mistakes);
        if (this._hintLabel) this._hintLabel.string = String(core.hintsLeft);

        if (this._statusLabel) {
            if (core.status === 'won') {
                this._statusLabel.string = '全部成语已填对，完成！';
            } else if (core.activeSlot < 0) {
                this._statusLabel.string = '点一个格子开始填字';
            } else {
                const slot = core.slots[core.activeSlot];
                let filled = 0;
                for (let i = 0; i < slot.cells.length; i++) {
                    if (core.values[slot.cells[i]]) filled++;
                }
                const locked = core.slotLocked[slot.id] ? ' · 已完成' : ` · 还差 ${4 - filled} 字`;
                this._statusLabel.string = `第 ${slot.id + 1} 条 · ${slot.dir === 'h' ? '横向' : '纵向'}${locked}`;
            }
        }
    }

    private _refreshBank(): void {
        const core = this._core;
        const bankNode = this._bankNode;
        if (!core || !bankNode) return;

        if (this._bankLabel) {
            if (core.activeSlot < 0) {
                this._bankLabel.string = '点一个格子，从候选字里选字';
            } else if (core.slotLocked[core.activeSlot]) {
                this._bankLabel.string = '这条成语已经完成，换一条继续';
            } else {
                const decoys = IDIOM_DIFFS[this._difficulty].decoys;
                this._bankLabel.string = `候选字（含 ${decoys} 个干扰字）`;
            }
        }

        const key = `${core.activeSlot}:${core.activeSlot >= 0 && core.slotLocked[core.activeSlot] ? 1 : 0}`;
        if (key === this._bankKey) return;
        this._bankKey = key;

        for (let i = bankNode.children.length - 1; i >= 0; i--) {
            const child = bankNode.children[i];
            if (child && child.isValid) child.destroy();
        }
        if (core.activeSlot < 0) return;

        const bank = core.bank();
        if (bank.length === 0) return;
        const gap = 10;
        const maxW = 660;
        const bw = Math.min(96, Math.floor((maxW - (bank.length - 1) * gap) / bank.length));
        const total = bank.length * bw + (bank.length - 1) * gap;
        const start = -total / 2 + bw / 2;
        const locked = core.slotLocked[core.activeSlot];
        for (let i = 0; i < bank.length; i++) {
            const ch = bank[i];
            const btn = createButton(bankNode, {
                w: bw,
                h: 80,
                text: ch,
                fontSize: Math.min(40, Math.round(bw * 0.5)),
                fill: locked ? '#141C2B' : '#182338',
                textColor: locked ? '#475569' : COLOR_TEXT_USER,
                activeFill: locked ? '#141C2B' : '#1E3A5F',
                activeTextColor: locked ? '#475569' : COLOR_TEXT_KNOWN,
                radius: 16,
                stroke: '#2C3D5C',
                onTap: () => this._onBankChar(ch),
            });
            btn.node.setPosition(start + i * (bw + gap), 0);
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
        drawRoundRect(dim, 720, 1280, 0, toColor('#050912', 235));
        overlay.on(Node.EventType.TOUCH_START, onOverlayTouchStart);
        this._overlay = overlay;

        const panel = createNode('Panel', overlay, 600, 620);
        panel.setPosition(0, 10, 0);
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, 600, 620, 28, toColor('#141E33'), toColor('#2C3D5C'), 3);

        createLabel(panel, this._isNewBest ? '新纪录！' : '成语全部完成！', 42, {
            y: 238,
            bold: true,
            color: this._isNewBest ? '#FBBF24' : UI.success,
            width: 540,
            height: 56,
        });
        createLabel(panel, this._isNewBest ? '刷新了最好成绩' : '交叉填字，一个不落', 21, {
            y: 196,
            color: UI.textDim,
            width: 520,
            height: 30,
        });

        const final = core.finalScore(this._elapsed);
        const timeBonus = Math.max(0, 600 - Math.floor(this._elapsed) * 2);
        const mult = this._difficulty === 'hard' ? 1.6 : this._difficulty === 'medium' ? 1.3 : 1;
        const best = this._best[this._difficulty];
        const rows: Array<[string, string]> = [
            ['难度', IDIOM_DIFFS[this._difficulty].label],
            ['用时', this._formatTime(this._elapsed)],
            ['失误 / 提示', `${core.mistakes} / ${core.hintsUsed}`],
            ['得分', String(core.score)],
            ['时间奖励', String(timeBonus)],
            ['难度系数', `x${mult.toFixed(1)}`],
            ['最终分', String(final)],
            ['最佳', best === undefined ? '--' : String(best)],
        ];
        for (let i = 0; i < rows.length; i++) {
            const y = 136 - i * 39;
            createLabel(panel, rows[i][0], 22, {
                x: -160,
                y,
                align: 'left',
                color: UI.textMuted,
                width: 240,
                height: 30,
            });
            createLabel(panel, rows[i][1], 24, {
                x: 140,
                y,
                align: 'right',
                bold: true,
                width: 280,
                height: 30,
                color: i === 6 ? '#FBBF24' : UI.text,
            });
        }

        const again = createButton(panel, {
            w: 180,
            h: 72,
            text: '再来一局',
            fontSize: 25,
            fill: '#1D4ED8',
            radius: 18,
            onTap: () => this.newGame(),
        });
        again.node.setPosition(-196, -248, 0);
        this._againBtn = again;

        const change = createButton(panel, {
            w: 180,
            h: 72,
            text: '换个难度',
            fontSize: 25,
            fill: '#182338',
            stroke: '#2C3D5C',
            radius: 18,
            onTap: this._onOverlayChangeDiff,
        });
        change.node.setPosition(0, -248, 0);

        // 结算面板必须自带「返回大厅」：全屏遮罩会吞掉左上返回键的触摸，
        // 只靠左上角的话玩家会被锁在结算页（试玩报告 2026-11-13 P1-1）
        const lobby = createButton(panel, {
            w: 180,
            h: 72,
            text: '返回大厅',
            fontSize: 25,
            fill: '#182338',
            stroke: '#2C3D5C',
            radius: 18,
            onTap: () => this.onBack(),
        });
        lobby.node.setPosition(196, -248, 0);

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
                const value = raw === null ? NaN : parseInt(raw, 10);
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
            localStorage.setItem(SAVE_KEY, JSON.stringify(core.snapshot(this._elapsed, this._started)));
        } catch (err) {
            // ignore
        }
    }

    private _tryRestore(): boolean {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return false;
            const data = JSON.parse(raw);
            if (!data || !data.difficulty) return false;
            const core = IdiomCore.fromSnapshot(data);
            if (!core || core.status === 'won') return false;
            this._core = core;
            this._difficulty = core.difficulty;
            this._bankKey = '';
            this._elapsed = typeof data.elapsed === 'number' && isFinite(data.elapsed) ? Math.max(0, data.elapsed) : 0;
            this._started = !!data.started && this._elapsed > 0;
            this._timerStart = Date.now() - this._elapsed * 1000;
            this._buildBoard();
            this._refreshAll();
            return true;
        } catch (err) {
            return false;
        }
    }
}
