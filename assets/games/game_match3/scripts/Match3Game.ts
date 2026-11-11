/**
 * 缤纷消除 —— 运行时主组件。
 *
 * 场景里只需要一个挂在 Canvas 下的空节点（本组件），所有 UI 在 onLoad 中构建。
 *  - 点一块选中，再点相邻块交换；不能形成消除的交换会轻微抖动并换回
 *  - 单 Graphics 整盘重绘，特殊块叠画箭头 / 星芒
 *  - 30 关：目标（分数 / 收集颜色 / 消除格数）+ 步数上限 + 星级
 *  - 关卡进度、星级、最高分存档
 *
 * 约定：事件 handler 全部具名（红线 5）；onDestroy 只清 JS 引用（红线 4）；
 *      动画用 update 计时泵推进，不用 scheduleOnce 自排期。
 */

import { _decorator, Component, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager } from '../../../common/managers/StorageManager';
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
import { Match3Core, Match3Special, Match3Step } from './Match3Core';
import {
    MATCH3_LEVEL_COUNT,
    Match3Level,
    Match3Progress,
    Match3Save,
    createDefaultSave,
    evaluateGoal,
    getMatch3Level,
    goalProgressText,
    goalText,
    parseMatch3Save,
    starsFor,
} from './Match3Levels';

const { ccclass } = _decorator;

const GAME_ID = 'match3';
const SAVE_KEY = 'save';

const CELL = 72;
const BOARD_PX = CELL * 8;
const BOARD_HALF = BOARD_PX / 2;
const BOARD_TOP = 300;

/** 每种颜色的填充 / 描边 / 内部符号 */
const PIECE_COLORS = [
    { fill: '#EF4444', stroke: '#B91C1C' },
    { fill: '#3B82F6', stroke: '#1D4ED8' },
    { fill: '#22C55E', stroke: '#15803D' },
    { fill: '#F59E0B', stroke: '#B45309' },
    { fill: '#A855F7', stroke: '#7E22CE' },
];

const COLOR_BOARD = '#101C31';
const COLOR_BOARD_STROKE = '#22304A';
const COLOR_CELL_EMPTY = '#101B2E';
const COLOR_SELECTED = '#F8FAFC';
const COLOR_HINT = '#FDE68A';
const COLOR_FLASH = '#FFFFFF';

const FLASH_STEP_SEC = 0.12;
const HINT_SEC = 1.4;

interface CellTween {
    index: number;
    from: number;
    to: number;
    t: number;
}

@ccclass('Match3Game')
export class Match3Game extends Component {
    /** 浏览器探针用 */
    core: Match3Core | null = null;
    level: Match3Level = getMatch3Level(1);
    progress: Match3Progress = { score: 0, clearedTotal: 0, clearedByColor: [0, 0, 0, 0, 0] };
    movesLeft = 0;
    phase: 'playing' | 'win' | 'lose' = 'playing';
    selected = -1;

    private _save: Match3Save = createDefaultSave();
    private _board: Node | null = null;
    private _boardG: Graphics | null = null;
    private _flashG: Graphics | null = null;
    private _levelLabel: Label | null = null;
    private _movesLabel: Label | null = null;
    private _goalLabel: Label | null = null;
    private _goalBar: Graphics | null = null;
    private _scoreLabel: Label | null = null;
    private _chainLabel: Label | null = null;
    private _hintBtn: UiButton | null = null;
    private _overlay: Node | null = null;

    private _flashCells: number[] = [];
    private _flashTimer = 0;
    private _hintCells: number[] = [];
    private _hintTimer = 0;
    private _chainTimer = 0;
    private _shakeTimer = 0;

    onLoad(): void {
        this._save = this._loadSave();
        this._buildUi();
        this._startLevel(this._save.level);
    }

    update(dt: number): void {
        if (this._flashTimer > 0) {
            this._flashTimer = Math.max(0, this._flashTimer - dt);
            if (this._flashTimer <= 0) {
                this._flashCells = [];
                this._drawBoard();
            }
        }
        if (this._chainTimer > 0) {
            this._chainTimer = Math.max(0, this._chainTimer - dt);
            if (this._chainTimer <= 0 && this._chainLabel) this._chainLabel.string = '';
        }
        if (this._hintTimer > 0) {
            this._hintTimer = Math.max(0, this._hintTimer - dt);
            if (this._hintTimer <= 0) {
                this._hintCells = [];
                this._drawBoard();
            }
        }
        if (this._shakeTimer > 0) {
            this._shakeTimer = Math.max(0, this._shakeTimer - dt);
            if (this._shakeTimer <= 0 && this._board && this._board.isValid) {
                this._board.setPosition(designPos(360, BOARD_TOP + BOARD_HALF));
            }
        }
    }

    onDestroy(): void {
        this.core = null;
        this._board = null;
        this._boardG = null;
        this._flashG = null;
        this._levelLabel = null;
        this._movesLabel = null;
        this._goalLabel = null;
        this._goalBar = null;
        this._scoreLabel = null;
        this._chainLabel = null;
        this._hintBtn = null;
        this._overlay = null;
    }

    // ==================== 关卡流程 ====================

    private _startLevel(id: number): void {
        const level = getMatch3Level(id);
        this.level = level;
        this.core = Match3Core.create(Date.now() + id * 7919, level.colorCount);
        this.progress = { score: 0, clearedTotal: 0, clearedByColor: new Array(level.colorCount).fill(0) };
        this.movesLeft = level.moves;
        this.phase = 'playing';
        this.selected = -1;
        this._flashCells = [];
        this._hintCells = [];
        this._flashTimer = 0;
        this._hintTimer = 0;
        this._chainTimer = 0;
        this._destroyOverlay();
        this._refreshHud();
        this._drawBoard();
    }

    private _restartLevel(): void {
        this._startLevel(this.level.id);
    }

    private _nextLevel(): void {
        const next = Math.min(MATCH3_LEVEL_COUNT, this.level.id + 1);
        this._save.level = next;
        this._persist();
        this._startLevel(next);
    }

    private _finishWin(): void {
        this.phase = 'win';
        const stars = starsFor(this.level, this.progress, this.movesLeft);
        const idx = this.level.id - 1;
        if (stars > this._save.stars[idx]) this._save.stars[idx] = stars;
        if (this.progress.score > this._save.bestScore) this._save.bestScore = this.progress.score;
        if (this.level.id < MATCH3_LEVEL_COUNT) {
            this._save.level = Math.max(this._save.level, this.level.id + 1);
        }
        this._persist();
        this._showResult(true, stars);
    }

    private _finishLose(): void {
        this.phase = 'lose';
        if (this.progress.score > this._save.bestScore) this._save.bestScore = this.progress.score;
        this._persist();
        this._showResult(false, 0);
    }

    // ==================== 输入 ====================

    private onBoardTouch(ev: EventTouch): void {
        if (this.phase !== 'playing') return;
        const index = this._cellAtTouch(ev);
        if (index < 0) return;
        if (this.selected < 0) {
            this.selected = index;
            this._drawBoard();
            return;
        }
        if (this.selected === index) {
            this.selected = -1;
            this._drawBoard();
            return;
        }
        const a = this.selected;
        this.selected = -1;
        if (this._areAdjacent(a, index)) {
            this._trySwap(a, index);
        } else {
            this.selected = index;
            this._drawBoard();
        }
    }

    private onBack(): void {
        this._persist();
        SceneManager.gotoLobby();
    }

    private onRestart(): void {
        this._restartLevel();
    }

    private onHint(): void {
        const core = this.core;
        if (!core || this.phase !== 'playing') return;
        const hint = core.findHint();
        if (!hint) {
            toast(this.node, '没有可用的交换，正在重排');
            core.shuffle();
            this._drawBoard();
            return;
        }
        this._hintCells = [hint[0], hint[1]];
        this._hintTimer = HINT_SEC;
        this._drawBoard();
    }

    private onOverlayTouchStart(ev: EventTouch): void {
        ev.propagationStopped = true;
    }

    // ==================== 交换 ====================

    private _trySwap(a: number, b: number): void {
        const core = this.core;
        if (!core) return;
        const result = core.swap(a, b);
        if (!result) {
            this._shakeBoard();
            toast(this.node, '这一步凑不成三连');
            this._drawBoard();
            return;
        }

        this.movesLeft = Math.max(0, this.movesLeft - 1);
        this.progress.score += result.score;
        this.progress.clearedTotal += result.clearedTotal;
        for (let i = 0; i < this.progress.clearedByColor.length && i < result.clearedByColor.length; i++) {
            this.progress.clearedByColor[i] += result.clearedByColor[i];
        }

        this._flashFromSteps(result.steps);
        this._drawBoard();
        this._refreshHud();

        if (result.shuffled) toast(this.node, '没有可走的交换，已重排');

        const goal = evaluateGoal(this.level, this.progress);
        if (goal.reached) {
            this._finishWin();
        } else if (this.movesLeft <= 0) {
            this._finishLose();
        }
    }

    private _flashFromSteps(steps: Match3Step[]): void {
        const cells: number[] = [];
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            for (let k = 0; k < step.cleared.length; k++) cells.push(step.cleared[k]);
        }
        this._flashCells = cells;
        this._flashTimer = Math.max(FLASH_STEP_SEC, steps.length * FLASH_STEP_SEC);
        const maxChain = steps.length > 0 ? steps[steps.length - 1].chain : 1;
        if (this._chainLabel) {
            this._chainLabel.string = maxChain >= 2 ? `连锁 ×${maxChain}` : '';
            this._chainTimer = 1.2;
        }
    }

    private _shakeBoard(): void {
        if (!this._board || !this._board.isValid) return;
        const base = designPos(360, BOARD_TOP + BOARD_HALF);
        this._board.setPosition(base.x + 10, base.y, 0);
        this._shakeTimer = 0.14;
    }

    private _areAdjacent(a: number, b: number): boolean {
        const cols = 8;
        const ar = Math.floor(a / cols);
        const ac = a % cols;
        const br = Math.floor(b / cols);
        const bc = b % cols;
        return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
    }

    private _cellAtTouch(ev: EventTouch): number {
        const board = this._board;
        if (!board || !board.isValid) return -1;
        const ut = board.getComponent(UITransform);
        if (!ut) return -1;
        const ui = ev.getUILocation();
        const local = ut.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const col = Math.floor((local.x + BOARD_HALF) / CELL);
        const row = Math.floor((BOARD_HALF - local.y) / CELL);
        if (col < 0 || col >= 8 || row < 0 || row >= 8) return -1;
        return row * 8 + col;
    }

    // ==================== 存档 ====================

    private _loadSave(): Match3Save {
        try {
            const raw = StorageManager.instance.getItem(GAME_ID, SAVE_KEY);
            if (!raw) return createDefaultSave();
            return parseMatch3Save(JSON.parse(raw));
        } catch (err) {
            console.warn('缤纷消除读档失败：', err);
            return createDefaultSave();
        }
    }

    private _persist(): void {
        try {
            StorageManager.instance.setItem(GAME_ID, SAVE_KEY, JSON.stringify(this._save));
        } catch (err) {
            console.warn('缤纷消除存档失败：', err);
        }
    }

    // ==================== UI 构建 ====================

    private _buildUi(): void {
        const bg = createNode('Bg', this.node, 720, 1280);
        const bgG = bg.addComponent(Graphics);
        drawRoundRect(bgG, 720, 1280, 0, toColor(UI.bg));

        const glowNode = createNode('Glow', this.node, 720, 1280);
        const glow = glowNode.addComponent(Graphics);
        glow.fillColor = toColor('#13203A');
        glow.circle(-260, 420, 300);
        glow.fill();
        glow.fillColor = toColor('#101A2E');
        glow.circle(280, -460, 340);
        glow.fill();

        createBackButton(this.node, () => this.onBack());
        createLabel(this.node, '缤纷消除', 44, { ...this._at(360, 64), bold: true, width: 360, height: 66 });
        createLabel(this.node, 'MATCH 3', 15, { ...this._at(360, 104), color: UI.textMuted, width: 300, height: 24 });

        // 顶栏三列：关卡 / 得分 / 步数。得分原在棋盘下方（y≈900），
        // 试玩复核 N1 指出那里既脱离顶栏又压按钮，这里与步数并排。
        this._levelLabel = createLabel(this.node, '第 1 关', 26, {
            ...this._at(136, 166),
            bold: true,
            width: 200,
            height: 36,
        });
        this._scoreLabel = createLabel(this.node, '得分 0', 26, {
            ...this._at(360, 166),
            bold: true,
            width: 240,
            height: 36,
            color: UI.text,
        });
        this._movesLabel = createLabel(this.node, '步数 20', 26, {
            ...this._at(584, 166),
            bold: true,
            width: 200,
            height: 36,
            color: UI.warning,
        });

        this._goalLabel = createLabel(this.node, '', 21, {
            ...this._at(360, 214),
            color: UI.textDim,
            width: 560,
            height: 30,
        });
        const barNode = createNode('GoalBar', this.node, 520, 14);
        barNode.setPosition(designPos(360, 248));
        this._goalBar = barNode.addComponent(Graphics);

        this._board = createNode('Board', this.node, BOARD_PX, BOARD_PX);
        this._board.setPosition(designPos(360, BOARD_TOP + BOARD_HALF));
        this._boardG = this._board.addComponent(Graphics);
        this._board.on(Node.EventType.TOUCH_END, this.onBoardTouch, this);

        const flashNode = createNode('Flash', this._board, BOARD_PX, BOARD_PX);
        this._flashG = flashNode.addComponent(Graphics);

        this._chainLabel = createLabel(this.node, '', 28, {
            ...this._at(360, 920),
            bold: true,
            width: 400,
            height: 36,
            color: UI.warning,
        });

        const restart = createButton(this.node, {
            w: 260,
            h: 88,
            text: '重来',
            fontSize: 28,
            fill: '#1E293B',
            activeFill: '#0E7490',
            radius: 18,
            stroke: '#26364F',
            onTap: () => this.onRestart(),
        });
        restart.node.setPosition(designPos(220, 1090));

        this._hintBtn = createButton(this.node, {
            w: 260,
            h: 88,
            text: '提示',
            fontSize: 28,
            fill: '#1E293B',
            activeFill: '#0E7490',
            radius: 18,
            stroke: '#26364F',
            onTap: () => this.onHint(),
        });
        this._hintBtn.node.setPosition(designPos(500, 1090));

        createLabel(this.node, '点一块选中，再点相邻块交换 · 四连出炸弹 / 五连出彩球', 18, {
            ...this._at(360, 1190),
            color: UI.textMuted,
            width: 690,
            height: 26,
        });
    }

    private _at(xFromLeft: number, yFromTop: number): { x: number; y: number } {
        const p = designPos(xFromLeft, yFromTop);
        return { x: p.x, y: p.y };
    }

    private _refreshHud(): void {
        if (this._levelLabel) this._levelLabel.string = `第 ${this.level.id} 关`;
        if (this._scoreLabel) this._scoreLabel.string = `得分 ${this.progress.score}`;
        if (this._movesLabel) this._movesLabel.string = `步数 ${this.movesLeft}`;
        if (this._goalLabel) {
            const state = evaluateGoal(this.level, this.progress);
            const text = this.level.goal.type === 'collect'
                ? `${goalText(this.level)}（${goalProgressText(this.level, this.progress)}）`
                : `${goalText(this.level)} · ${goalProgressText(this.level, this.progress)}`;
            this._goalLabel.string = text;
            this._drawGoalBar(state.ratio);
        }
    }

    private _drawGoalBar(ratio: number): void {
        const g = this._goalBar;
        if (!g) return;
        g.clear();
        g.fillColor = toColor('#15203A');
        g.roundRect(-260, -9, 520, 18, 9);
        g.fill();
        g.strokeColor = toColor('#2A3A57');
        g.lineWidth = 2;
        g.roundRect(-260, -9, 520, 18, 9);
        g.stroke();
        const r = Math.max(0, Math.min(1, ratio));
        if (r > 0) {
            // 最窄也画成一个圆头，避免刚开始时是一小条硬边
            const width = Math.max(18, r * 520);
            g.fillColor = toColor(r >= 1 ? UI.success : UI.primary);
            g.roundRect(-260, -9, width, 18, 9);
            g.fill();
        }
    }

    // ==================== 棋盘绘制 ====================

    private _drawBoard(): void {
        const g = this._boardG;
        const core = this.core;
        if (!g || !core) return;
        g.clear();
        g.fillColor = toColor(COLOR_BOARD);
        g.roundRect(-BOARD_HALF, -BOARD_HALF, BOARD_PX, BOARD_PX, 20);
        g.fill();
        g.strokeColor = toColor(COLOR_BOARD_STROKE);
        g.lineWidth = 2;
        g.roundRect(-BOARD_HALF, -BOARD_HALF, BOARD_PX, BOARD_PX, 20);
        g.stroke();

        for (let index = 0; index < core.cells.length; index++) {
            const row = Math.floor(index / 8);
            const col = index % 8;
            const cx = -BOARD_HALF + col * CELL + CELL / 2;
            const cy = BOARD_HALF - row * CELL - CELL / 2;
            this._drawPiece(g, index, cx, cy);
        }
        this._drawHintArrow(g);
        this._drawFlash();
    }

    /**
     * 提示时在两格之间画一条双向箭头（试玩报告：只高亮两块，看不出往哪个方向换）。
     */
    private _drawHintArrow(g: Graphics): void {
        if (this._hintCells.length < 2) return;
        const center = (index: number): { x: number; y: number } => {
            const row = Math.floor(index / 8);
            const col = index % 8;
            return {
                x: -BOARD_HALF + col * CELL + CELL / 2,
                y: BOARD_HALF - row * CELL - CELL / 2,
            };
        };
        const a = center(this._hintCells[0]);
        const b = center(this._hintCells[1]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // 两端各收进 20px，箭头压在格子边缘而不是中心
        const inset = 20;
        const x1 = a.x + ux * inset;
        const y1 = a.y + uy * inset;
        const x2 = b.x - ux * inset;
        const y2 = b.y - uy * inset;
        const head = 13;
        g.strokeColor = toColor(COLOR_HINT);
        g.lineWidth = 6;
        g.lineCap = Graphics.LineCap.ROUND;
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
        // 两端箭头（垂直方向 ±head/2）
        const px = -uy;
        const py = ux;
        for (const [ex, ey, sx, sy] of [
            [x2, y2, -ux, -uy],
            [x1, y1, ux, uy],
        ] as Array<[number, number, number, number]>) {
            g.moveTo(ex, ey);
            g.lineTo(ex + sx * head + px * head * 0.72, ey + sy * head + py * head * 0.72);
            g.moveTo(ex, ey);
            g.lineTo(ex + sx * head - px * head * 0.72, ey + sy * head - py * head * 0.72);
        }
        g.stroke();
    }

    private _drawPiece(g: Graphics, index: number, cx: number, cy: number): void {
        const core = this.core;
        if (!core) return;
        const color = core.colorAt(index);
        const special = core.specialAt(index);
        const palette = PIECE_COLORS[color % PIECE_COLORS.length] || PIECE_COLORS[0];

        g.fillColor = toColor(palette.fill);
        g.strokeColor = toColor(palette.stroke);
        g.lineWidth = 2;
        g.roundRect(cx - 30, cy - 30, 60, 60, 12);
        g.fill();
        g.stroke();

        // 用形状区分颜色（不只靠颜色）
        g.fillColor = toColor('#0B1220', 140);
        switch (color % 5) {
            case 0:
                g.circle(cx, cy, 11);
                break;
            case 1:
                g.rect(cx - 10, cy - 10, 20, 20);
                break;
            case 2:
                g.moveTo(cx, cy + 13);
                g.lineTo(cx + 13, cy);
                g.lineTo(cx, cy - 13);
                g.lineTo(cx - 13, cy);
                g.close();
                break;
            case 3:
                g.moveTo(cx, cy + 13);
                g.lineTo(cx + 12, cy - 9);
                g.lineTo(cx - 12, cy - 9);
                g.close();
                break;
            default:
                g.moveTo(cx, cy + 13);
                g.lineTo(cx + 4, cy + 4);
                g.lineTo(cx + 14, cy + 4);
                g.lineTo(cx + 6, cy - 2);
                g.lineTo(cx + 9, cy - 12);
                g.lineTo(cx, cy - 6);
                g.lineTo(cx - 9, cy - 12);
                g.lineTo(cx - 6, cy - 2);
                g.lineTo(cx - 14, cy + 4);
                g.lineTo(cx - 4, cy + 4);
                g.close();
                break;
        }
        g.fill();

        if (special !== 'none') this._drawSpecialMark(g, special, cx, cy);

        if (this.selected === index) {
            // 外圈柔和光晕 + 内圈亮描边，比单根 3px 白线在缩小预览下更醒目
            g.strokeColor = toColor(UI.accent, 90);
            g.lineWidth = 9;
            g.roundRect(cx - 35, cy - 35, 70, 70, 17);
            g.stroke();
            g.strokeColor = toColor(COLOR_SELECTED);
            g.lineWidth = 4;
            g.roundRect(cx - 32, cy - 32, 64, 64, 15);
            g.stroke();
        }
        if (this._hintCells.indexOf(index) >= 0) {
            g.strokeColor = toColor(COLOR_HINT);
            g.lineWidth = 4;
            g.roundRect(cx - 32, cy - 32, 64, 64, 14);
            g.stroke();
        }
    }

    private _drawSpecialMark(g: Graphics, special: Match3Special, cx: number, cy: number): void {
        g.fillColor = toColor('#FFFFFF', 235);
        if (special === 'row' || special === 'col') {
            if (special === 'row') {
                g.rect(cx - 24, cy - 3, 48, 6);
            } else {
                g.rect(cx - 3, cy - 24, 6, 48);
            }
            g.fill();
        } else {
            // 彩球：四角星芒
            g.moveTo(cx, cy + 22);
            g.lineTo(cx + 7, cy + 7);
            g.lineTo(cx + 22, cy);
            g.lineTo(cx + 7, cy - 7);
            g.lineTo(cx, cy - 22);
            g.lineTo(cx - 7, cy - 7);
            g.lineTo(cx - 22, cy);
            g.lineTo(cx - 7, cy + 7);
            g.close();
            g.fill();
        }
    }

    private _drawFlash(): void {
        const g = this._flashG;
        if (!g) return;
        g.clear();
        if (this._flashCells.length === 0 || this._flashTimer <= 0) return;
        g.fillColor = toColor(COLOR_FLASH, 150);
        for (let i = 0; i < this._flashCells.length; i++) {
            const index = this._flashCells[i];
            const row = Math.floor(index / 8);
            const col = index % 8;
            const cx = -BOARD_HALF + col * CELL + CELL / 2;
            const cy = BOARD_HALF - row * CELL - CELL / 2;
            g.roundRect(cx - 28, cy - 28, 56, 56, 12);
            g.fill();
        }
    }

    // ==================== 结算面板 ====================

    private _showResult(win: boolean, stars: number): void {
        this._destroyOverlay();

        const root = createNode('ResultOverlay', this.node, 720, 1280);
        root.on(Node.EventType.TOUCH_START, this.onOverlayTouchStart, this);
        const dim = root.addComponent(Graphics);
        dim.fillColor = toColor(UI.overlay, 215);
        dim.rect(-360, -640, 720, 1280);
        dim.fill();

        const panel = createNode('Panel', root, 560, 460);
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, 560, 460, 24, toColor(UI.panel), toColor(UI.panelStroke), 2);

        createLabel(panel, win ? '过关！' : '步数用完了', 42, {
            x: 0, y: 150, bold: true,
            color: win ? UI.success : UI.warning,
            width: 460, height: 56,
        });
        createLabel(panel, `第 ${this.level.id} 关 · 得分 ${this.progress.score}`, 22, {
            x: 0, y: 96, color: UI.textDim, width: 460, height: 30,
        });

        if (win) {
            const starText = '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars));
            createLabel(panel, starText, 54, {
                x: 0, y: 34, bold: true, color: UI.warning, width: 460, height: 70,
            });
        } else {
            createLabel(panel, goalProgressText(this.level, this.progress) + ' 目标未完成', 24, {
                x: 0, y: 34, color: UI.textMuted, width: 460, height: 34,
            });
        }

        const hasNext = win && this.level.id < MATCH3_LEVEL_COUNT;
        if (hasNext) {
            const nextBtn = createButton(panel, {
                w: 230, h: 78, text: '下一关', fontSize: 26,
                fill: UI.primary, activeFill: UI.primary, radius: 16,
                onTap: () => this._nextLevel(),
            });
            nextBtn.node.setPosition(-125, -140, 0);
            const againBtn = createButton(panel, {
                w: 230, h: 78, text: '重来', fontSize: 26,
                fill: '#1E293B', activeFill: '#0E7490', radius: 16, stroke: '#26364F',
                onTap: () => this._restartLevel(),
            });
            againBtn.node.setPosition(125, -140, 0);
        } else {
            const againBtn = createButton(panel, {
                w: 300, h: 78, text: win ? '再玩一次' : '重来', fontSize: 26,
                fill: UI.primary, activeFill: UI.primary, radius: 16,
                onTap: () => this._restartLevel(),
            });
            againBtn.node.setPosition(0, -140, 0);
        }

        this._overlay = root;
    }

    private _destroyOverlay(): void {
        if (this._overlay && this._overlay.isValid) this._overlay.destroy();
        this._overlay = null;
    }
}
