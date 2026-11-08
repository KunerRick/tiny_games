/**
 * 推箱子 —— 运行时 UI。
 *
 * 场景里只需要一个挂在 Canvas 下的空节点（本组件），所有 UI 在 onLoad 中构建。
 * 盘面、箱子、小人、方向键、结算卡全部是 Graphics + Label，零贴图。
 */

import { _decorator, Component, EventTouch, Graphics, Label, Node, Vec3 } from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager } from '../../../common/managers/StorageManager';
import {
    COLOR,
    FONT_CAPTION,
    FONT_DISPLAY,
    FONT_BODY,
    FONT_TITLE,
    hex,
} from '../../../common/ui/UITheme';
import {
    applySceneClearColor,
    createBackButton,
    createButton,
    createLabel,
    createNode,
    designPos,
    drawRoundRect,
    toast,
    toColor,
    UiButton,
} from '../../../common/ui/GameUIKit';
import {
    SOKOBAN_LEVELS,
    SokobanBoard,
    SokobanDir,
    SokobanLevel,
    SokobanSnapshot,
    levelById,
    starsFor,
} from './SokobanCore';

const { ccclass } = _decorator;

const GAME_ID = 'sokoban';
const KEY_PROGRESS = 'progress';
const KEY_SAVE = 'save';

// ==================== 布局（720×1280，y 自顶向下） ====================

const DESIGN_W = 720;
const CANVAS_H = 1280;

const BOARD_W = 648;
const BOARD_TOP = 176;
const BOARD_BOTTOM = 872;
const BOARD_H = BOARD_BOTTOM - BOARD_TOP;
const BOARD_CENTER_Y = (BOARD_TOP + BOARD_BOTTOM) / 2;

/** 一次移动的插值时长（秒） */
const MOVE_DUR = 0.09;
/** 滑动至少这么多设计像素才认方向 */
const SWIPE_MIN = 24;

const FLOOR_FILL = '#141C2B';
const WALL_FILL = '#2C3A52';
const WALL_TOP = '#43536F';
const BOX_FILL = '#B4763A';
const BOX_STROKE = '#7A4A1E';

type Phase = 'play' | 'win';

interface SaveData {
    v: 1;
    levelId: number;
    board: SokobanSnapshot;
}

interface AnimState {
    t: number;
    playerFrom: { x: number; y: number };
    box: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
}

@ccclass('SokobanGame')
export class SokobanGame extends Component {
    private _board: SokobanBoard = new SokobanBoard(1, 1);
    private _level: SokobanLevel = SOKOBAN_LEVELS[0];
    private _phase: Phase = 'play';
    private _maxLevel = 1;

    /** 每格边长（设计像素），随关卡尺寸自适应 */
    private _cell = 48;
    private _anim: AnimState | null = null;
    private _touchStart: Vec3 | null = null;

    private _boardGfx: Graphics = null;
    private _touchLayer: Node = null;
    private _statusLabel: Label = null;
    private _levelLabel: Label = null;
    private _undoBtn: UiButton = null;

    private _winOverlay: Node = null;
    private _pickerOverlay: Node = null;

    onLoad(): void {
        applySceneClearColor(COLOR.BG_SCENE);
        this._maxLevel = Math.min(
            SOKOBAN_LEVELS.length,
            Math.max(1, Number(this._getItem(KEY_PROGRESS)) || 1),
        );

        this._buildUi();
        this._bindEvents();
        this._restoreOrStart();
    }

    onDestroy(): void {
        this.unscheduleAllCallbacks();
        this._unbindEvents();
        this._anim = null;
        this._touchStart = null;
        this._winOverlay = null;
        this._pickerOverlay = null;
    }

    update(dt: number): void {
        if (!this._anim) return;
        this._anim.t = Math.min(1, this._anim.t + dt / MOVE_DUR);
        if (this._anim.t >= 1) this._anim = null;
        this._drawBoard();
    }

    // ==================== UI 构建 ====================

    private _buildUi(): void {
        createBackButton(this.node, () => this._onBack());

        const title = createLabel(this.node, '推箱子', 38, { bold: true, color: COLOR.TEXT_PRIMARY });
        title.node.setPosition(designPos(360, 58));

        const sub = createLabel(this.node, 'SOKOBAN', 13, { color: COLOR.TEXT_SECONDARY });
        sub.node.setPosition(designPos(360, 92));

        this._levelLabel = createLabel(this.node, '', FONT_BODY.fontSize, { color: COLOR.TEXT_SECONDARY });
        this._levelLabel.node.setPosition(designPos(360, 128));
        this._levelLabel.node.on(Node.EventType.TOUCH_END, this._onLevelLabelTap, this);

        // 盘面层（同时也是滑动输入层）
        this._touchLayer = createNode('Board', this.node, BOARD_W, BOARD_H);
        this._touchLayer.setPosition(designPos(360, BOARD_CENTER_Y));
        this._boardGfx = this._touchLayer.addComponent(Graphics);

        this._statusLabel = createLabel(this.node, '', FONT_BODY.fontSize, { color: COLOR.TEXT_PRIMARY });
        this._statusLabel.node.setPosition(designPos(360, 906));

        this._buildPadAndActions();

        const hint = createLabel(this.node, '滑动屏幕或用方向键推箱子', FONT_CAPTION.fontSize, {
            color: COLOR.TEXT_DISABLED,
        });
        hint.node.setPosition(designPos(360, 1216));
    }

    private _buildPadAndActions(): void {
        const PAD_X = 208;
        const PAD_Y = 1062;
        const STEP = 112;
        const SIZE = 108;

        const pad: Array<{ x: number; y: number; text: string; dir: SokobanDir }> = [
            { x: PAD_X, y: PAD_Y - STEP, text: '▲', dir: 0 },
            { x: PAD_X + STEP, y: PAD_Y, text: '▶', dir: 1 },
            { x: PAD_X, y: PAD_Y + STEP, text: '▼', dir: 2 },
            { x: PAD_X - STEP, y: PAD_Y, text: '◀', dir: 3 },
        ];
        for (const item of pad) {
            const btn = createButton(this.node, {
                w: SIZE,
                h: SIZE,
                text: item.text,
                fontSize: 34,
                fill: COLOR.SURFACE,
                textColor: COLOR.TEXT_PRIMARY,
                radius: 22,
                stroke: COLOR.PANEL_BORDER,
                onTap: () => this._step(item.dir),
            });
            btn.node.setPosition(designPos(item.x, item.y));
        }

        this._undoBtn = createButton(this.node, {
            w: 140,
            h: 84,
            text: '撤销',
            fontSize: FONT_BODY.fontSize,
            fill: COLOR.SURFACE,
            textColor: COLOR.TEXT_PRIMARY,
            radius: 18,
            stroke: COLOR.PANEL_BORDER,
            onTap: () => this._onUndo(),
        });
        this._undoBtn.node.setPosition(designPos(556, 1014));

        const reset = createButton(this.node, {
            w: 140,
            h: 84,
            text: '重来',
            fontSize: FONT_BODY.fontSize,
            fill: COLOR.SURFACE,
            textColor: COLOR.TEXT_SECONDARY,
            radius: 18,
            stroke: COLOR.PANEL_BORDER,
            onTap: () => this._onReset(),
        });
        reset.node.setPosition(designPos(556, 1114));
    }

    private _bindEvents(): void {
        if (!this._touchLayer || !this._touchLayer.isValid) return;
        this._touchLayer.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
        this._touchLayer.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        this._touchLayer.on(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    private _unbindEvents(): void {
        if (this._levelLabel && this._levelLabel.isValid) {
            this._levelLabel.node.off(Node.EventType.TOUCH_END, this._onLevelLabelTap, this);
        }
        if (!this._touchLayer || !this._touchLayer.isValid) return;
        this._touchLayer.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
        this._touchLayer.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        this._touchLayer.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    // ==================== 输入 ====================

    private _onTouchStart(ev: EventTouch): void {
        if (!this._acceptInput()) return;
        const p = ev.getUILocation();
        this._touchStart = new Vec3(p.x, p.y, 0);
    }

    private _onTouchEnd(ev: EventTouch): void {
        const start = this._touchStart;
        this._touchStart = null;
        if (!start || !this._acceptInput()) return;
        const p = ev.getUILocation();
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        if (Math.hypot(dx, dy) < SWIPE_MIN) return;
        if (Math.abs(dx) > Math.abs(dy)) {
            this._step(dx > 0 ? 1 : 3);
        } else {
            // 屏幕 y 轴向上：上滑 = 方向 0
            this._step(dy > 0 ? 0 : 2);
        }
    }

    private _onTouchCancel(): void {
        this._touchStart = null;
    }

    private _acceptInput(): boolean {
        if (this._phase !== 'play') return false;
        if (this._overlayOpen()) return false;
        return true;
    }

    /** 结算 / 选关面板是否开着（遮罩不拦事件，面板打开时必须自己屏蔽盘面输入） */
    private _overlayOpen(): boolean {
        if (this._winOverlay && this._winOverlay.isValid) return true;
        if (this._pickerOverlay && this._pickerOverlay.isValid) return true;
        return false;
    }

    private _onLevelLabelTap(): void {
        if (this._winOverlay && this._winOverlay.isValid) return;
        this._showPicker();
    }

    private _onBack(): void {
        this._saveState();
        SceneManager.gotoLobby();
    }

    // ==================== 关卡流程 ====================

    private _restoreOrStart(): void {
        const raw = this._getItem(KEY_SAVE);
        if (raw) {
            try {
                const data = JSON.parse(raw) as SaveData;
                const id = Math.max(1, Math.min(SOKOBAN_LEVELS.length, Number(data.levelId) || 1));
                if (data.board && this._startLevel(id, data.board)) return;
            } catch (e) {
                // 坏档：直接从头开始
            }
        }
        this._startLevel(1, null);
    }

    private _startLevel(levelId: number, snapshot: SokobanSnapshot | null): boolean {
        this._closeOverlays();
        this._level = levelById(levelId);

        const fresh = SokobanBoard.fromLevel(this._level);
        if (snapshot && snapshot.width === fresh.width && snapshot.height === fresh.height) {
            // 只接管盘面状态，`reset()` 仍回到关卡初始局面
            this._board = fresh;
            const restored = SokobanBoard.fromSnapshot(snapshot);
            this._board.boxes.set(restored.boxes);
            this._board.playerX = restored.playerX;
            this._board.playerY = restored.playerY;
            this._board.moves = restored.moves;
            this._board.pushes = restored.pushes;
        } else {
            this._board = fresh;
        }

        this._phase = 'play';
        this._anim = null;
        this._touchStart = null;
        this._cell = Math.max(
            12,
            Math.floor(Math.min(BOARD_W / this._board.width, BOARD_H / this._board.height)),
        );
        this._updateLabels();
        this._drawBoard();
        this._saveState();
        return true;
    }

    private _step(dir: SokobanDir): void {
        if (!this._acceptInput()) return;
        const fromX = this._board.playerX;
        const fromY = this._board.playerY;
        const res = this._board.move(dir);
        if (!res.moved) return;

        this._anim = {
            t: 0,
            playerFrom: { x: fromX, y: fromY },
            box: res.pushed && res.boxFrom && res.boxTo
                ? { from: res.boxFrom, to: res.boxTo }
                : null,
        };
        this._updateLabels();
        this._saveState();

        if (this._board.isSolved()) {
            this._phase = 'win';
            this._maxLevel = Math.min(SOKOBAN_LEVELS.length, Math.max(this._maxLevel, this._level.id + 1));
            this._setItem(KEY_PROGRESS, String(this._maxLevel));
            this.scheduleOnce(this._onSolved, 0.34);
        }
    }

    private _onSolved(): void {
        if (this._phase !== 'win') return;
        this._drawBoard();
        this._showWin();
    }

    private _onUndo(): void {
        if (!this._acceptInput()) return;
        if (!this._board.canUndo()) {
            toast(this.node, '已经退到本关开局了');
            return;
        }
        this._board.undo();
        this._anim = null;
        this._updateLabels();
        this._drawBoard();
        this._saveState();
    }

    private _onReset(): void {
        if (!this._acceptInput()) return;
        this._board.reset();
        this._anim = null;
        this._updateLabels();
        this._drawBoard();
        this._saveState();
    }

    private _onNextLevel(): void {
        const next = this._level.id + 1;
        if (next > SOKOBAN_LEVELS.length) {
            this._startLevel(1, null);
            return;
        }
        this._startLevel(next, null);
    }

    // ==================== 绘制 ====================

    private _updateLabels(): void {
        if (this._levelLabel && this._levelLabel.isValid) {
            this._levelLabel.string = `第 ${this._level.id} 关 · ${this._level.name}`;
        }
        if (this._statusLabel && this._statusLabel.isValid) {
            this._statusLabel.string = `步数 ${this._board.moves} · 最少 ${this._level.par}`;
        }
        if (this._undoBtn && this._undoBtn.node && this._undoBtn.node.isValid) {
            const can = this._board.canUndo();
            this._undoBtn.setColor(
                can ? COLOR.SURFACE : '#1A2230',
                can ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED,
            );
        }
    }

    private _drawBoard(): void {
        const g = this._boardGfx;
        if (!g || !g.isValid) return;
        const b = this._board;
        const cell = this._cell;
        const W = b.width * cell;
        const H = b.height * cell;
        const x0 = -W / 2;
        const y0 = H / 2;
        const tx = (cx: number) => x0 + cx * cell;
        const ty = (cy: number) => y0 - (cy + 1) * cell;
        const cx0 = (cx: number) => tx(cx) + cell / 2;
        const cy0 = (cy: number) => ty(cy) + cell / 2;

        g.clear();

        // 地板
        g.fillColor = toColor(FLOOR_FILL);
        for (let y = 0; y < b.height; y++) {
            for (let x = 0; x < b.width; x++) {
                if (b.isWall(x, y)) continue;
                g.rect(tx(x) + 1, ty(y) + 1, cell - 2, cell - 2);
            }
        }
        g.fill();

        // 墙 + 顶面亮边
        g.fillColor = toColor(WALL_FILL);
        for (let y = 0; y < b.height; y++) {
            for (let x = 0; x < b.width; x++) {
                if (!b.isWall(x, y)) continue;
                g.rect(tx(x), ty(y), cell, cell);
            }
        }
        g.fill();

        g.fillColor = toColor(WALL_TOP);
        for (let y = 0; y < b.height; y++) {
            for (let x = 0; x < b.width; x++) {
                if (!b.isWall(x, y) || b.isWall(x, y - 1)) continue;
                g.rect(tx(x), ty(y) + cell - 4, cell, 4);
            }
        }
        g.fill();

        // 目标点
        g.lineWidth = 3;
        g.strokeColor = toColor(COLOR.WARNING);
        let hasGoal = false;
        for (let y = 0; y < b.height; y++) {
            for (let x = 0; x < b.width; x++) {
                if (!b.isGoal(x, y)) continue;
                g.circle(cx0(x), cy0(y), cell * 0.17);
                hasGoal = true;
            }
        }
        if (hasGoal) g.stroke();

        // 箱子（被推的那个用插值位置单独画）
        const anim = this._anim;
        const animBoxTo = anim && anim.box ? anim.box.to : null;
        for (let y = 0; y < b.height; y++) {
            for (let x = 0; x < b.width; x++) {
                if (!b.hasBox(x, y)) continue;
                if (animBoxTo && animBoxTo.x === x && animBoxTo.y === y) continue;
                this._paintBox(g, cx0(x), cy0(y), cell, b.isGoal(x, y));
            }
        }
        if (anim && anim.box) {
            const t = anim.t;
            const px = this._lerpCellX(anim.box.from.x, anim.box.to.x, t, cell, W);
            const py = this._lerpCellY(anim.box.from.y, anim.box.to.y, t, cell, H);
            this._paintBox(g, px, py, cell, b.isGoal(anim.box.to.x, anim.box.to.y) && t >= 1);
        }

        // 小人
        let pxX = b.playerX;
        let pyY = b.playerY;
        if (anim) {
            pxX = this._lerpCellNum(anim.playerFrom.x, b.playerX, anim.t);
            pyY = this._lerpCellNum(anim.playerFrom.y, b.playerY, anim.t);
        }
        const playerPx = x0 + (pxX + 0.5) * cell;
        const playerPy = y0 - (pyY + 0.5) * cell;
        this._paintPlayer(g, playerPx, playerPy, cell);
    }

    /** 单轴格坐标 → 像素（供动画插值用，与 tx/ty 的换算一致） */
    private _lerpCellX(from: number, to: number, t: number, cell: number, w: number): number {
        const a = -w / 2 + (from + 0.5) * cell;
        const b = -w / 2 + (to + 0.5) * cell;
        return a + (b - a) * t;
    }

    private _lerpCellY(from: number, to: number, t: number, cell: number, h: number): number {
        const a = h / 2 - (from + 0.5) * cell;
        const b = h / 2 - (to + 0.5) * cell;
        return a + (b - a) * t;
    }

    private _lerpCellNum(from: number, to: number, t: number): number {
        return from + (to - from) * t;
    }

    private _paintBox(g: Graphics, px: number, py: number, cell: number, onGoal: boolean): void {
        const s = cell * 0.72;
        g.fillColor = toColor(onGoal ? COLOR.SUCCESS : BOX_FILL);
        g.roundRect(px - s / 2, py - s / 2, s, s, s * 0.22);
        g.fill();

        g.lineWidth = 2;
        g.strokeColor = toColor(onGoal ? '#15803D' : BOX_STROKE);
        g.roundRect(px - s / 2, py - s / 2, s, s, s * 0.22);
        g.stroke();

        g.lineWidth = Math.max(1, cell * 0.04);
        g.strokeColor = hex(onGoal ? '#14532D' : '#5C3612', 150);
        const arm = s * 0.26;
        g.moveTo(px - arm, py);
        g.lineTo(px + arm, py);
        g.moveTo(px, py - arm);
        g.lineTo(px, py + arm);
        g.stroke();
    }

    private _paintPlayer(g: Graphics, px: number, py: number, cell: number): void {
        const r = cell * 0.32;
        g.fillColor = toColor(COLOR.PRIMARY);
        g.circle(px, py, r);
        g.fill();

        g.lineWidth = 2;
        g.strokeColor = toColor('#1D4ED8');
        g.circle(px, py, r);
        g.stroke();

        // 眼睛
        g.fillColor = toColor('#FFFFFF');
        const eyeR = Math.max(1.6, cell * 0.055);
        g.circle(px - r * 0.32, py + r * 0.22, eyeR);
        g.fill();
        g.circle(px + r * 0.32, py + r * 0.22, eyeR);
        g.fill();
    }

    // ==================== 面板 ====================

    private _closeOverlays(): void {
        if (this._winOverlay && this._winOverlay.isValid) this._winOverlay.destroy();
        if (this._pickerOverlay && this._pickerOverlay.isValid) this._pickerOverlay.destroy();
        this._winOverlay = null;
        this._pickerOverlay = null;
    }

    private _showWin(): void {
        this._closeOverlays();
        const overlay = createNode('WinOverlay', this.node, DESIGN_W, CANVAS_H);
        this._winOverlay = overlay;

        const dim = createNode('Dim', overlay, DESIGN_W, CANVAS_H);
        const dimGfx = dim.addComponent(Graphics);
        dimGfx.fillColor = hex(COLOR.BG_OVERLAY, 170);
        dimGfx.rect(-DESIGN_W / 2, -CANVAS_H / 2, DESIGN_W, CANVAS_H);
        dimGfx.fill();

        const panel = createNode('Panel', overlay, 560, 500);
        panel.setPosition(designPos(360, 640));
        const panelGfx = panel.addComponent(Graphics);
        drawRoundRect(panelGfx, 560, 500, 24, toColor(COLOR.PANEL_BG), toColor(COLOR.PANEL_BORDER), 2);

        const accent = createNode('Accent', panel, 200, 8);
        accent.setPosition(0, 226);
        const accentGfx = accent.addComponent(Graphics);
        drawRoundRect(accentGfx, 200, 8, 4, toColor(COLOR.SUCCESS));

        const title = createLabel(panel, '过关！', FONT_DISPLAY.fontSize, {
            bold: true,
            color: COLOR.SUCCESS,
        });
        title.node.setPosition(0, 170);

        const stars = starsFor(this._board.moves, this._level.par);
        const starNode = createNode('Stars', panel, 300, 60);
        starNode.setPosition(0, 96);
        const starGfx = starNode.addComponent(Graphics);
        for (let i = 0; i < 3; i++) {
            const cx = (i - 1) * 66;
            const filled = i < stars;
            starGfx.fillColor = toColor(filled ? COLOR.WARNING : '#33405A');
            starGfx.moveTo(cx, 24);
            starGfx.lineTo(cx + 20, 6);
            starGfx.lineTo(cx + 16, -18);
            starGfx.lineTo(cx - 16, -18);
            starGfx.lineTo(cx - 20, 6);
            starGfx.close();
            starGfx.fill();
        }

        const detail = createLabel(
            panel,
            `第 ${this._level.id} 关 · 步数 ${this._board.moves} ／ 最少 ${this._level.par}`,
            FONT_BODY.fontSize,
            { color: COLOR.TEXT_SECONDARY },
        );
        detail.node.setPosition(0, 30);

        const hasNext = this._level.id < SOKOBAN_LEVELS.length;
        const main = createButton(panel, {
            w: 220,
            h: 62,
            text: hasNext ? '下一关' : '从头再玩',
            fontSize: FONT_BODY.fontSize,
            fill: COLOR.SUCCESS,
            textColor: '#FFFFFF',
            radius: 16,
            onTap: () => this._onNextLevel(),
        });
        main.node.setPosition(0, -70);

        const again = createButton(panel, {
            w: 220,
            h: 56,
            text: '重玩本关',
            fontSize: FONT_CAPTION.fontSize,
            fill: COLOR.SURFACE,
            textColor: COLOR.TEXT_SECONDARY,
            radius: 14,
            onTap: () => this._startLevel(this._level.id, null),
        });
        again.node.setPosition(0, -146);

        const back = createButton(panel, {
            w: 220,
            h: 56,
            text: '返回大厅',
            fontSize: FONT_CAPTION.fontSize,
            fill: COLOR.SURFACE,
            textColor: COLOR.TEXT_SECONDARY,
            radius: 14,
            onTap: () => this._onBack(),
        });
        back.node.setPosition(0, -214);
    }

    private _showPicker(): void {
        this._closeOverlays();
        const overlay = createNode('LevelPicker', this.node, DESIGN_W, CANVAS_H);
        this._pickerOverlay = overlay;

        const dim = createNode('Dim', overlay, DESIGN_W, CANVAS_H);
        const dimGfx = dim.addComponent(Graphics);
        dimGfx.fillColor = hex(COLOR.BG_OVERLAY, 170);
        dimGfx.rect(-DESIGN_W / 2, -CANVAS_H / 2, DESIGN_W, CANVAS_H);
        dimGfx.fill();

        const panel = createNode('Panel', overlay, 640, 700);
        panel.setPosition(designPos(360, 640));
        const panelGfx = panel.addComponent(Graphics);
        drawRoundRect(panelGfx, 640, 700, 24, toColor(COLOR.PANEL_BG), toColor(COLOR.PANEL_BORDER), 2);

        const title = createLabel(panel, '选择关卡', FONT_TITLE.fontSize, { bold: true, color: COLOR.TEXT_PRIMARY });
        title.node.setPosition(0, 298);

        const COLS = 5;
        const BW = 104;
        const BH = 64;
        const GX = 118;
        const GY = 82;
        for (let i = 0; i < SOKOBAN_LEVELS.length; i++) {
            const id = SOKOBAN_LEVELS[i].id;
            const c = i % COLS;
            const r = Math.floor(i / COLS);
            const x = (c - (COLS - 1) / 2) * GX;
            const y = 226 - r * GY;
            const unlocked = id <= this._maxLevel;
            const btn = createButton(panel, {
                w: BW,
                h: BH,
                text: String(id),
                fontSize: FONT_BODY.fontSize,
                fill: id === this._level.id ? COLOR.PRIMARY : unlocked ? COLOR.SURFACE : COLOR.PRIMARY_DISABLED,
                textColor: unlocked ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED,
                radius: 12,
                onTap: unlocked ? () => this._startLevel(id, null) : () => undefined,
            });
            btn.node.setPosition(x, y);
        }

        const close = createButton(panel, {
            w: 200,
            h: 54,
            text: '关闭',
            fontSize: FONT_CAPTION.fontSize,
            fill: COLOR.SURFACE,
            textColor: COLOR.TEXT_SECONDARY,
            radius: 14,
            onTap: () => this._closeOverlays(),
        });
        close.node.setPosition(0, -292);
    }

    // ==================== 存档 ====================

    private _saveState(): void {
        const data: SaveData = {
            v: 1,
            levelId: this._level.id,
            board: this._board.snapshot(),
        };
        this._setItem(KEY_SAVE, JSON.stringify(data));
    }

    private _getItem(key: string): string | null {
        try {
            return StorageManager.instance.getItem(GAME_ID, key);
        } catch (e) {
            return null;
        }
    }

    private _setItem(key: string, value: string): void {
        try {
            StorageManager.instance.setItem(GAME_ID, key, value);
        } catch (e) {
            console.warn('[sokoban] storage failed', e);
        }
    }
}
