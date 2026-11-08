/**
 * 成语猜猜（Wordle 风格）—— 运行时主组件。
 *
 * 场景里只需要一个挂在 Canvas 下的空节点（本组件），所有 UI 在 onLoad 中构建。
 *  - 每日挑战：答案由日期决定，所有人同题，每天一次；
 *  - 随机对局：自选难度，随时重开；
 *  - 点候选字填格 → 提交 → 每字给出绿/黄/灰反馈；
 *  - 六次（硬核五次）机会，猜中或次数用尽结算。
 *
 * 约定：事件 handler 全部具名（红线 5）；onDestroy 只清 JS 引用（红线 4）。
 */

import { _decorator, Component, EventTouch, Graphics, Label, Node } from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager } from '../../../common/managers/StorageManager';
import {
    COLOR,
    FONT_BODY,
    FONT_CAPTION,
    FONT_DISPLAY,
    FONT_TITLE,
    applyFontAndColor,
} from '../../../common/ui/UITheme';
import {
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
import { IDIOM_LIST } from '../../game_idiom/scripts/IdiomData';
import {
    CellMark,
    WORDLE_DIFFS,
    WORDLE_DIFF_ORDER,
    WordleDifficulty,
    buildPoolFor,
    dateKeyOf,
    dailySeed,
    evaluateGuess,
    isWinningRow,
    pickAnswer,
    scoreFor,
    shareGrid,
} from './WordleCore';

const { ccclass } = _decorator;

const GAME_ID = 'wordle';
const STATE_KEY = 'state';
const DAILY_KEY = 'daily';
const STREAK_KEY = 'streak';
const BEST_KEY_PREFIX = 'best_';
const MODE_KEY = 'mode';
const DIFF_KEY = 'diff';

type Mode = 'daily' | 'random';

// ==================== 布局常量（设计坐标，y 向下） ====================

const CELL = 82;
const CELL_GAP = 6;
const BOARD_PAD = 10;
const BOARD_TOP = 246;
/** 棋盘按 6 行的高度做垂直居中参考，硬核 5 行时上下留白均匀，不会顶到难度条/状态行 */
const BOARD_REF_ROWS = 6;
const BOARD_H_REF = BOARD_REF_ROWS * CELL + (BOARD_REF_ROWS - 1) * CELL_GAP + BOARD_PAD * 2;
const BOARD_CENTER_Y = BOARD_TOP + BOARD_H_REF / 2;

const TILE_W = 94;
const TILE_H = 78;
const TILE_GAP = 5;
const POOL_TOP = 898;

const STATUS_Y = 800;
const ACTION_Y = 856;

interface TileView {
    node: Node;
    g: Graphics;
    label: Label;
    char: string;
}

interface BoardCell {
    node: Node;
    g: Graphics;
    label: Label;
}

interface TileTapData {
    game: WordleGame;
    index: number;
}

function onTileTap(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    if (!node || !node.isValid) return;
    const data = (node as unknown as { __tile?: TileTapData }).__tile;
    if (data && data.game) data.game.pickTile(data.index);
}

function onCellTap(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    if (!node || !node.isValid) return;
    const data = (node as unknown as { __cell?: TileTapData }).__cell;
    if (data && data.game) data.game.undoPick();
}

/** 保存的每日 / 随机对局快照 */
interface SavedRound {
    mode: Mode;
    diff: WordleDifficulty;
    date: string;
    answer: string;
    pool: string[];
    rows: string[];
    done: boolean;
    won: boolean;
}

@ccclass('WordleGame')
export class WordleGame extends Component {
    // 浏览器探针用
    _mode: Mode = 'daily';
    _diff: WordleDifficulty = 'medium';
    _answer = '';
    _pool: string[] = [];
    _rows: string[] = [];
    _marks: CellMark[][] = [];
    _current: string[] = [];
    _pickedIdx: number[] = [];
    _done = false;
    _won = false;
    _date = '';

    private _maxGuesses = 6;
    private _tiles: TileView[] = [];
    private _cells: BoardCell[] = [];
    private _boardNode: Node | null = null;
    private _poolNode: Node | null = null;
    private _overlay: Node | null = null;
    private _titleLabel: Label | null = null;
    private _statusLabel: Label | null = null;
    private _streakLabel: Label | null = null;
    private _modeBtns: Partial<Record<Mode, UiButton>> = {};
    private _diffBtns: Partial<Record<WordleDifficulty, UiButton>> = {};
    private _submitBtn: UiButton | null = null;
    private _clearBtn: UiButton | null = null;
    private _restartBtn: UiButton | null = null;
    private _difficultyRow: Node | null = null;
    private _uiBuilt = false;
    private _pendingScore = 0;

    onLoad(): void {
        this._mode = (this._getItem(MODE_KEY) as Mode) === 'random' ? 'random' : 'daily';
        const savedDiff = this._getItem(DIFF_KEY) as WordleDifficulty;
        this._diff = WORDLE_DIFFS[savedDiff] ? savedDiff : 'medium';
        this._buildUi();
        this._restoreOrStart();
    }

    onDestroy(): void {
        this._unscheduleOverlay();
        this._tiles = [];
        this._cells = [];
        this._boardNode = null;
        this._poolNode = null;
        this._overlay = null;
        this._titleLabel = null;
        this._statusLabel = null;
        this._streakLabel = null;
        this._modeBtns = {};
        this._diffBtns = {};
        this._submitBtn = null;
        this._clearBtn = null;
        this._restartBtn = null;
        this._difficultyRow = null;
    }

    // ==================== 对外操作（事件回调） ====================

    onBack(): void {
        this._save();
        SceneManager.gotoLobby();
    }

    pickTile(index: number): void {
        if (this._done || this._overlay) return;
        const char = this._pool[index];
        if (!char) return;
        if (this._current.length >= 4) return;
        this._current.push(char);
        this._pickedIdx.push(index);
        this._refreshAll();
    }

    undoPick(): void {
        if (this._done || this._overlay) return;
        if (this._current.length === 0) return;
        this._current.pop();
        this._pickedIdx.pop();
        this._refreshAll();
    }

    clearRow(): void {
        if (this._done || this._overlay) return;
        if (this._current.length === 0) return;
        this._current = [];
        this._pickedIdx = [];
        this._refreshAll();
    }

    submitRow(): void {
        if (this._done || this._overlay) return;
        if (this._current.length < 4) {
            toast(this.node, '先点满 4 个字', 1.2);
            return;
        }
        const guess = this._current.join('');
        const marks = evaluateGuess(this._answer, guess);
        this._rows.push(guess);
        this._marks.push(marks);
        this._current = [];
        this._pickedIdx = [];

        if (isWinningRow(marks)) {
            this._done = true;
            this._won = true;
            this._onRoundFinished();
            return;
        }
        if (this._rows.length >= this._maxGuesses) {
            this._done = true;
            this._won = false;
            this._onRoundFinished();
            return;
        }
        this._refreshAll();
        this._save();
    }

    newRound(): void {
        if (this._mode === 'daily') {
            this._mode = 'random';
            this._setItem(MODE_KEY, this._mode);
        }
        this._startRandom();
    }

    // ==================== 对局 ====================

    private _restoreOrStart(): void {
        this._date = dateKeyOf(new Date());
        if (this._mode === 'daily') {
            if (this._restoreDaily()) {
                this._resumeIfFinished();
                return;
            }
            this._startDaily();
            return;
        }
        if (this._restoreRandom()) {
            this._resumeIfFinished();
            return;
        }
        this._startRandom();
    }

    /**
     * 回到一个「已结束」的残局时补弹结算卡。
     * 否则棋盘停在满行状态，玩家再也看不到答案。
     */
    private _resumeIfFinished(): void {
        if (!this._done) return;
        this._pendingScore = this._mode === 'random'
            ? scoreFor(this._diff, this._rows.length, this._won)
            : 0;
        this.unschedule(this._deferredShowResult);
        this.scheduleOnce(this._deferredShowResult, 0.35);
    }

    private _startDaily(): void {
        const seed = dailySeed(this._date);
        this._diff = 'medium';
        this._maxGuesses = WORDLE_DIFFS.medium.maxGuesses;
        this._answer = pickAnswer(seed, IDIOM_LIST);
        this._pool = buildPoolFor(this._answer, seed, 'medium', IDIOM_LIST);
        this._resetRows();
        this._buildBoard();
        this._buildPool();
        this._refreshAll();
        this._save();
    }

    private _startRandom(): void {
        const seed = ((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
        this._maxGuesses = WORDLE_DIFFS[this._diff].maxGuesses;
        this._answer = pickAnswer(seed, IDIOM_LIST);
        this._pool = buildPoolFor(this._answer, seed, this._diff, IDIOM_LIST);
        this._resetRows();
        this._buildBoard();
        this._buildPool();
        this._refreshAll();
        this._save();
    }

    private _resetRows(): void {
        this.unschedule(this._deferredShowResult);
        this._rows = [];
        this._marks = [];
        this._current = [];
        this._pickedIdx = [];
        this._done = false;
        this._won = false;
        this._destroyOverlay();
    }

    private _restoreDaily(): boolean {
        const saved = this._loadJson<SavedRound>(DAILY_KEY);
        if (!saved || saved.mode !== 'daily' || saved.date !== this._date) return false;
        if (!saved.answer || !Array.isArray(saved.pool) || saved.pool.length === 0) return false;
        this._diff = 'medium';
        this._maxGuesses = WORDLE_DIFFS.medium.maxGuesses;
        this._applySnapshot(saved);
        return true;
    }

    private _restoreRandom(): boolean {
        const saved = this._loadJson<SavedRound>(STATE_KEY);
        if (!saved || saved.mode !== 'random') return false;
        if (!saved.answer || !Array.isArray(saved.pool) || saved.pool.length === 0) return false;
        if (!WORDLE_DIFFS[saved.diff]) return false;
        this._diff = saved.diff;
        this._maxGuesses = WORDLE_DIFFS[this._diff].maxGuesses;
        this._applySnapshot(saved);
        return true;
    }

    private _applySnapshot(saved: SavedRound): void {
        this._answer = saved.answer;
        this._pool = saved.pool;
        this._rows = Array.isArray(saved.rows) ? saved.rows.slice(0, this._maxGuesses) : [];
        this._marks = [];
        for (let i = 0; i < this._rows.length; i++) {
            this._marks.push(evaluateGuess(this._answer, this._rows[i]));
        }
        this._current = [];
        this._pickedIdx = [];
        this._done = !!saved.done;
        this._won = !!saved.won;
        this._buildBoard();
        this._buildPool();
        this._refreshAll();
    }

    private _onRoundFinished(): void {
        let score = 0;
        if (this._mode === 'random') {
            score = scoreFor(this._diff, this._rows.length, this._won);
        }
        this._refreshAll();
        this._save();
        if (this._mode === 'daily') this._updateStreak(this._won);
        this._refreshStreakLabel();
        this._pendingScore = score;
        this.scheduleOnce(this._deferredShowResult, 0.35);
    }

    private _deferredShowResult(): void {
        this._showResult(this._pendingScore);
    }

    private _showResult(score: number): void {
        if (!this.node || !this.node.isValid) return;
        this._destroyOverlay();

        const overlay = createNode('ResultOverlay', this.node, 720, 1280);
        this._overlay = overlay;
        const dim = createNode('Dim', overlay, 720, 1280);
        const dimG = dim.addComponent(Graphics);
        drawRoundRect(dimG, 720, 1280, 0, toColor('#000000', 205));

        const panel = createNode('Panel', overlay, 560, 500);
        panel.setPosition(designPos(360, 640));
        const titleText = this._won ? '猜中了！' : '没猜出来';
        const accent = this._won ? COLOR.SUCCESS : COLOR.DANGER;

        // 卡片底（先建，保证在所有内容之下）
        const card = createNode('Card', panel, 560, 500);
        const cardG = card.addComponent(Graphics);
        drawRoundRect(cardG, 560, 500, 22, toColor(COLOR.PANEL_BG, 252), toColor(accent, 120), 2);
        const accentBar = createNode('AccentBar', card, 200, 8);
        accentBar.setPosition(0, 500 / 2 - 24);
        const accentG = accentBar.addComponent(Graphics);
        drawRoundRect(accentG, 200, 8, 4, toColor(accent, 230));

        const titleLabel = createLabel(panel, titleText, FONT_DISPLAY.fontSize, {
            width: 500,
            height: 60,
            color: accent,
            bold: true,
        });
        applyFontAndColor(titleLabel, FONT_DISPLAY, accent);
        titleLabel.node.setPosition(0, 180);

        const answerLabel = createLabel(panel, '答案：' + this._answer, FONT_TITLE.fontSize, {
            width: 500,
            height: 44,
            color: COLOR.TEXT_PRIMARY,
            bold: true,
        });
        applyFontAndColor(answerLabel, FONT_TITLE, COLOR.TEXT_PRIMARY);
        answerLabel.node.setPosition(0, 112);

        const statsText = this._mode === 'daily'
            ? (this._won ? `用了 ${this._rows.length} 次 · 连续 ${this._streakDays()} 天` : '今日挑战未通过')
            : `用了 ${this._rows.length}/${this._maxGuesses} 次 · 得分 ${score}`;
        const statsLabel = createLabel(panel, statsText, FONT_BODY.fontSize, {
            width: 500,
            height: 34,
            color: COLOR.TEXT_SECONDARY,
        });
        applyFontAndColor(statsLabel, FONT_BODY, COLOR.TEXT_SECONDARY);
        statsLabel.node.setPosition(0, 62);

        const buttons: Array<{ text: string; y: number; fill: string; w: number; h: number; onTap: () => void }> = [
            { text: '复制战绩', y: 0, fill: COLOR.PRIMARY, w: 380, h: 68, onTap: () => this._copyShare() },
            { text: '再来一局', y: -74, fill: COLOR.SURFACE, w: 380, h: 60, onTap: () => this.newRound() },
            { text: '返回大厅', y: -140, fill: COLOR.SURFACE, w: 380, h: 60, onTap: () => this.onBack() },
        ];
        for (let i = 0; i < buttons.length; i++) {
            const cfg = buttons[i];
            const btn = createButton(panel, {
                w: cfg.w,
                h: cfg.h,
                text: cfg.text,
                fontSize: 24,
                fill: cfg.fill,
                stroke: COLOR.PANEL_BORDER,
                radius: Math.min(16, cfg.h / 2),
                onTap: cfg.onTap,
            });
            btn.node.setPosition(0, cfg.y);
        }

        this._refreshAll();
    }

    private _copyShare(): void {
        const header = this._mode === 'daily' ? `成语猜猜 · 每日 ${this._date}` : '成语猜猜 · 随机对局';
        const lines = [header, shareGrid(this._marks), `用了 ${this._rows.length}/${this._maxGuesses} 次`];
        const text = lines.join('\n');
        const g = globalThis as unknown as {
            wx?: { setClipboardData?: (o: { data: string; success?: () => void; fail?: () => void }) => void };
            navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } };
        };
        if (g.wx && g.wx.setClipboardData) {
            g.wx.setClipboardData({ data: text, success: () => toast(this.node, '已复制战绩', 1.2) });
            return;
        }
        if (g.navigator && g.navigator.clipboard && g.navigator.clipboard.writeText) {
            g.navigator.clipboard.writeText(text).then(
                () => toast(this.node, '已复制战绩', 1.2),
                () => toast(this.node, '复制失败，可截图分享', 1.6),
            );
            return;
        }
        toast(this.node, '复制失败，可截图分享', 1.6);
    }

    private _destroyOverlay(): void {
        if (this._overlay && this._overlay.isValid) this._overlay.destroy();
        this._overlay = null;
    }

    private _unscheduleOverlay(): void {
        this.unscheduleAllCallbacks();
    }

    // ==================== 连续天数 ====================

    private _streakDays(): number {
        const saved = this._loadJson<{ days: number; lastDate: string }>(STREAK_KEY);
        return saved && saved.days > 0 ? saved.days : 0;
    }

    private _updateStreak(won: boolean): void {
        if (!won) return;
        const saved = this._loadJson<{ days: number; lastDate: string }>(STREAK_KEY);
        const yesterday = dateKeyOf(new Date(Date.now() - 86400000));
        let days = 1;
        if (saved && saved.days > 0) {
            if (saved.lastDate === yesterday) days = saved.days + 1;
            else if (saved.lastDate === this._date) days = saved.days;
        }
        this._setItem(STREAK_KEY, JSON.stringify({ days, lastDate: this._date }));
    }

    private _refreshStreakLabel(): void {
        if (!this._streakLabel) return;
        const days = this._streakDays();
        this._streakLabel.string = days > 0 ? `连续 ${days} 天` : '';
    }

    // ==================== 存档 ====================

    private _snapshot(): SavedRound {
        return {
            mode: this._mode,
            diff: this._diff,
            date: this._date,
            answer: this._answer,
            pool: this._pool.slice(),
            rows: this._rows.slice(),
            done: this._done,
            won: this._won,
        };
    }

    private _save(): void {
        if (!this._answer) return;
        const key = this._mode === 'daily' ? DAILY_KEY : STATE_KEY;
        this._setItem(key, JSON.stringify(this._snapshot()));
        if (this._mode === 'random' && this._done) {
            const score = scoreFor(this._diff, this._rows.length, this._won);
            const bestKey = BEST_KEY_PREFIX + this._diff;
            const best = Number(this._getItem(bestKey)) || 0;
            if (score > best) this._setItem(bestKey, String(score));
        }
    }

    private _getItem(key: string): string | null {
        try {
            return StorageManager.instance.getItem(GAME_ID, key);
        } catch (err) {
            return null;
        }
    }

    private _setItem(key: string, value: string): void {
        try {
            StorageManager.instance.setItem(GAME_ID, key, value);
        } catch (err) {
            // 存不进去不影响本局
        }
    }

    private _loadJson<T>(key: string): T | null {
        const raw = this._getItem(key);
        if (!raw) return null;
        try {
            return JSON.parse(raw) as T;
        } catch (err) {
            return null;
        }
    }

    // ==================== UI ====================

    private _buildUi(): void {
        if (this._uiBuilt) return;
        this._uiBuilt = true;

        const bg = createNode('Bg', this.node, 720, 1280);
        const bgG = bg.addComponent(Graphics);
        drawRoundRect(bgG, 720, 1280, 0, toColor(COLOR.BG_SCENE));

        const glowNode = createNode('Glow', this.node, 720, 1280);
        const glow = glowNode.addComponent(Graphics);
        glow.fillColor = toColor('#12203A');
        glow.circle(-240, 340, 300);
        glow.fill();
        glow.fillColor = toColor('#101A2E');
        glow.circle(280, -420, 360);
        glow.fill();

        createBackButton(this.node, () => this.onBack());

        this._titleLabel = createLabel(this.node, '成语猜猜', 42, {
            width: 360,
            height: 62,
            color: COLOR.TEXT_PRIMARY,
            bold: true,
        });
        applyFontAndColor(this._titleLabel, FONT_DISPLAY, COLOR.TEXT_PRIMARY);
        this._titleLabel.node.setPosition(designPos(360, 66));

        const sub = createLabel(this.node, 'IDIOM WORDLE', 14, {
            width: 300,
            height: 22,
            color: COLOR.TEXT_SECONDARY,
        });
        sub.node.setPosition(designPos(360, 104));

        // 模式切换
        const modes: Array<{ id: Mode; text: string; x: number }> = [
            { id: 'daily', text: '每日挑战', x: 250 },
            { id: 'random', text: '随机对局', x: 470 },
        ];
        for (let i = 0; i < modes.length; i++) {
            const cfg = modes[i];
            const btn = createButton(this.node, {
                w: 210,
                h: 54,
                text: cfg.text,
                fontSize: 24,
                fill: '#182338',
                activeFill: COLOR.PRIMARY,
                stroke: COLOR.PANEL_BORDER,
                radius: 14,
                onTap: () => this._onModeClicked(cfg.id),
            });
            btn.node.setPosition(designPos(cfg.x, 158));
            this._modeBtns[cfg.id] = btn;
        }

        // 难度条
        this._difficultyRow = createNode('DiffRow', this.node, 620, 52);
        this._difficultyRow.setPosition(designPos(360, 206));
        const diffXs = [-190, 0, 190];
        for (let i = 0; i < WORDLE_DIFF_ORDER.length; i++) {
            const id = WORDLE_DIFF_ORDER[i];
            const btn = createButton(this._difficultyRow, {
                w: 150,
                h: 50,
                text: WORDLE_DIFFS[id].name,
                fontSize: 22,
                fill: '#182338',
                activeFill: COLOR.PRIMARY,
                stroke: COLOR.PANEL_BORDER,
                radius: 13,
                onTap: () => this._onDiffClicked(id),
            });
            btn.node.setPosition(diffXs[i], 0);
            this._diffBtns[id] = btn;
        }

        this._statusLabel = createLabel(this.node, '', FONT_CAPTION.fontSize, {
            width: 660,
            height: 28,
            color: COLOR.TEXT_SECONDARY,
        });
        applyFontAndColor(this._statusLabel, FONT_CAPTION, COLOR.TEXT_SECONDARY);
        this._statusLabel.node.setPosition(designPos(360, STATUS_Y));

        this._streakLabel = createLabel(this.node, '', FONT_CAPTION.fontSize, {
            width: 260,
            height: 28,
            color: COLOR.WARNING,
        });
        applyFontAndColor(this._streakLabel, FONT_CAPTION, COLOR.WARNING);
        this._streakLabel.node.setPosition(designPos(360, STATUS_Y + 30));

        this._clearBtn = createButton(this.node, {
            w: 160,
            h: 56,
            text: '清除',
            fontSize: 24,
            fill: COLOR.SURFACE,
            stroke: COLOR.PANEL_BORDER,
            radius: 14,
            onTap: () => this.clearRow(),
        });
        this._clearBtn.node.setPosition(designPos(180, ACTION_Y));

        this._submitBtn = createButton(this.node, {
            w: 240,
            h: 64,
            text: '提交',
            fontSize: 28,
            fill: COLOR.PRIMARY,
            stroke: '#2563EB',
            radius: 16,
            onTap: () => this.submitRow(),
        });
        this._submitBtn.node.setPosition(designPos(470, ACTION_Y));

        this._restartBtn = createButton(this.node, {
            w: 150,
            h: 56,
            text: '换一局',
            fontSize: 22,
            fill: COLOR.SURFACE,
            stroke: COLOR.PANEL_BORDER,
            radius: 14,
            onTap: () => this.newRound(),
        });
        this._restartBtn.node.setPosition(designPos(330, ACTION_Y));

        const hint = createLabel(this.node, '点字组成成语：绿=对位 · 黄=错位 · 灰=没有', FONT_CAPTION.fontSize, {
            width: 680,
            height: 26,
            color: COLOR.TEXT_DISABLED,
        });
        applyFontAndColor(hint, FONT_CAPTION, COLOR.TEXT_DISABLED);
        hint.node.setPosition(designPos(360, 1244));

        this._refreshModeButtons();
    }

    private _onModeClicked(mode: Mode): void {
        // 点当前模式不重开（重开走「换一局」），避免误触清掉进度
        if (this._mode === mode) return;
        this._mode = mode;
        this._setItem(MODE_KEY, mode);
        this._resetRows();
        if (mode === 'daily') {
            this._date = dateKeyOf(new Date());
            if (!this._restoreDaily()) this._startDaily();
            else this._resumeIfFinished();
        } else {
            this._startRandom();
        }
        this._refreshModeButtons();
    }

    private _onDiffClicked(diff: WordleDifficulty): void {
        if (this._mode === 'daily') {
            toast(this.node, '每日挑战固定为「标准」难度', 1.4);
            return;
        }
        if (this._diff === diff) {
            // 点当前难度不重开（重开走「换一局」），避免误触清掉进度
            this._refreshDiffButtons();
            return;
        }
        this._diff = diff;
        this._setItem(DIFF_KEY, diff);
        this._startRandom();
        this._refreshDiffButtons();
    }

    private _refreshModeButtons(): void {
        const keys: Mode[] = ['daily', 'random'];
        for (let i = 0; i < keys.length; i++) {
            const btn = this._modeBtns[keys[i]];
            if (btn) btn.setActive(this._mode === keys[i]);
        }
        this._refreshDiffButtons();
    }

    private _refreshDiffButtons(): void {
        if (this._difficultyRow) this._difficultyRow.active = this._mode === 'random';
        for (let i = 0; i < WORDLE_DIFF_ORDER.length; i++) {
            const id = WORDLE_DIFF_ORDER[i];
            const btn = this._diffBtns[id];
            if (btn) btn.setActive(this._diff === id);
        }
    }

    // -------- 棋盘 --------

    private _buildBoard(): void {
        if (this._boardNode && this._boardNode.isValid) this._boardNode.destroy();
        this._cells = [];
        const cols = 4;
        const w = cols * CELL + (cols - 1) * CELL_GAP;
        const h = this._maxGuesses * CELL + (this._maxGuesses - 1) * CELL_GAP;
        const frameW = w + BOARD_PAD * 2;
        const frameH = h + BOARD_PAD * 2;

        const board = createNode('Board', this.node, frameW, frameH);
        board.setPosition(designPos(360, BOARD_CENTER_Y));
        this._boardNode = board;
        const frameG = board.addComponent(Graphics);
        drawRoundRect(frameG, frameW, frameH, 18, toColor('#101B2E'), toColor(COLOR.PANEL_BORDER), 2);

        for (let r = 0; r < this._maxGuesses; r++) {
            for (let c = 0; c < cols; c++) {
                const x = -w / 2 + CELL / 2 + c * (CELL + CELL_GAP);
                const y = h / 2 - CELL / 2 - r * (CELL + CELL_GAP);
                const node = createNode(`Cell_${r}_${c}`, board, CELL, CELL);
                node.setPosition(x, y);
                const g = node.addComponent(Graphics);
                const label = createLabel(node, '', 40, {
                    width: CELL - 6,
                    height: CELL - 6,
                    color: COLOR.TEXT_PRIMARY,
                    bold: true,
                    overflow: 'shrink',
                });
                const data: TileTapData = { game: this, index: r };
                (node as unknown as { __cell?: TileTapData }).__cell = data;
                node.on(Node.EventType.TOUCH_END, onCellTap);
                this._cells.push({ node, g, label });
            }
        }
    }

    private _drawCell(cell: BoardCell, char: string, state: 'empty' | 'filled' | 'green' | 'yellow' | 'gray', active: boolean): void {
        let fill: string = COLOR.SLOT_EMPTY_BG;
        let border: string = active ? COLOR.PRIMARY : COLOR.SLOT_EMPTY_BORDER;
        let text: string = COLOR.TEXT_PRIMARY;
        if (state === 'filled') {
            fill = COLOR.SURFACE;
            border = COLOR.PRIMARY;
        } else if (state === 'green') {
            fill = COLOR.SUCCESS;
            border = '#16A34A';
            text = '#062B16';
        } else if (state === 'yellow') {
            fill = COLOR.WARNING;
            border = '#D97706';
            text = '#3B2205';
        } else if (state === 'gray') {
            fill = COLOR.PANEL_BORDER;
            border = '#2A3342';
            text = COLOR.TEXT_SECONDARY;
        }
        drawRoundRect(cell.g, CELL, CELL, 12, toColor(fill), toColor(border), state === 'empty' ? 2 : 3);
        cell.label.string = char;
        cell.label.color = toColor(text);
    }

    private _refreshBoard(): void {
        if (this._cells.length === 0) return;
        const cols = 4;
        for (let r = 0; r < this._maxGuesses; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = this._cells[r * cols + c];
                if (!cell) continue;
                const row = this._rows[r];
                if (row) {
                    const mark = this._marks[r] ? this._marks[r][c] : 'gray';
                    this._drawCell(cell, row.charAt(c), mark, false);
                } else if (r === this._rows.length) {
                    const ch = this._current[c] || '';
                    this._drawCell(cell, ch, ch ? 'filled' : 'empty', true);
                } else {
                    this._drawCell(cell, '', 'empty', false);
                }
            }
        }
    }

    // -------- 候选池 --------

    private _buildPool(): void {
        if (this._poolNode && this._poolNode.isValid) this._poolNode.destroy();
        this._tiles = [];
        const total = this._pool.length;
        const cols = total <= 16 ? 4 : total <= 20 ? 5 : 6;
        const rows = Math.ceil(total / cols);
        const w = cols * TILE_W + (cols - 1) * TILE_GAP;
        const h = rows * TILE_H + (rows - 1) * TILE_GAP;

        const pool = createNode('Pool', this.node, w, h);
        pool.setPosition(designPos(360, POOL_TOP + h / 2));
        this._poolNode = pool;

        for (let i = 0; i < total; i++) {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const rowCount = Math.min(cols, total - row * cols);
            const rowW = rowCount * TILE_W + (rowCount - 1) * TILE_GAP;
            const x = -rowW / 2 + TILE_W / 2 + col * (TILE_W + TILE_GAP);
            const y = h / 2 - TILE_H / 2 - row * (TILE_H + TILE_GAP);
            const node = createNode(`Tile_${i}`, pool, TILE_W, TILE_H);
            node.setPosition(x, y);
            const g = node.addComponent(Graphics);
            const label = createLabel(node, this._pool[i], 40, {
                width: TILE_W - 8,
                height: TILE_H - 8,
                color: COLOR.TEXT_PRIMARY,
                bold: true,
                overflow: 'shrink',
            });
            const data: TileTapData = { game: this, index: i };
            (node as unknown as { __tile?: TileTapData }).__tile = data;
            node.on(Node.EventType.TOUCH_END, onTileTap);
            this._tiles.push({ node, g, label, char: this._pool[i] });
        }
    }

    private _refreshPool(): void {
        const used = new Set<number>(this._pickedIdx);
        for (let i = 0; i < this._tiles.length; i++) {
            const tile = this._tiles[i];
            const isUsed = used.has(i);
            const fill = isUsed ? '#141A24' : COLOR.SURFACE;
            const border = isUsed ? COLOR.SLOT_EMPTY_BORDER : COLOR.PANEL_BORDER;
            const text = isUsed ? COLOR.TEXT_DISABLED : COLOR.TEXT_PRIMARY;
            drawRoundRect(tile.g, TILE_W, TILE_H, 12, toColor(fill), toColor(border), 2);
            tile.label.string = tile.char;
            tile.label.color = toColor(text);
        }
    }

    // -------- 整体刷新 --------

    private _refreshAll(): void {
        this._refreshBoard();
        this._refreshPool();
        this._refreshStatus();
        this._refreshModeButtons();
        this._refreshStreakLabel();
    }

    private _refreshStatus(): void {
        if (!this._statusLabel) return;
        if (this._done) {
            this._statusLabel.string = this._won
                ? (this._mode === 'daily' ? '今日已猜中 · 明天再来' : '猜中了')
                : '机会用完了，答案见结算';
        } else {
            const left = this._maxGuesses - this._rows.length;
            this._statusLabel.string = this._mode === 'daily'
                ? `今日挑战 · 已用 ${this._rows.length}/${this._maxGuesses} 次`
                : `${WORDLE_DIFFS[this._diff].name} · 还剩 ${left} 次`;
        }
        if (this._submitBtn) {
            this._submitBtn.setText(this._done ? '已结束' : '提交');
            this._submitBtn.node.active = !this._done;
        }
        if (this._clearBtn) this._clearBtn.node.active = !this._done;
        if (this._restartBtn) this._restartBtn.node.active = this._mode === 'random';
        this._layoutActions();
    }

    /**
     * 操作按钮按「当前可见」的数量均分居中。
     * 日更模式没有「换一局」、结算后没有「清除」，固定 x 会出现重叠或大空洞。
     */
    private _layoutActions(): void {
        const items: Array<{ btn: UiButton | null; w: number }> = [
            { btn: this._clearBtn, w: 160 },
            { btn: this._restartBtn, w: 150 },
            { btn: this._submitBtn, w: 240 },
        ];
        const shown: Array<{ btn: UiButton; w: number }> = [];
        let total = 0;
        for (let i = 0; i < items.length; i++) {
            const btn = items[i].btn;
            if (!btn || !btn.node.active) continue;
            shown.push({ btn, w: items[i].w });
            total += items[i].w;
        }
        if (shown.length === 0) return;
        const gap = 20;
        total += gap * (shown.length - 1);
        let x = 360 - total / 2;
        for (let i = 0; i < shown.length; i++) {
            shown[i].btn.node.setPosition(designPos(x + shown[i].w / 2, ACTION_Y));
            x += shown[i].w + gap;
        }
    }
}
