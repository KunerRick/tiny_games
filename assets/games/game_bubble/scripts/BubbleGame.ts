/**
 * 泡泡龙 —— 运行时 UI。
 *
 * 场景里只需要一个挂在 Canvas 下的空节点（本组件），所有 UI 在 onLoad 中构建。
 * 所有画面（盘面、泡泡、炮台、瞄准线、结算卡）都是 Graphics + Label，零贴图。
 */

import { _decorator, Color, Component, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager } from '../../../common/managers/StorageManager';
import {
    COLOR,
    hex,
    FONT_CAPTION,
    FONT_DISPLAY,
    FONT_TITLE,
    FONT_BODY,
    FONT_TINY,
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
    BUBBLE_BOARD_W,
    BUBBLE_EMPTY,
    BUBBLE_LEVELS,
    BUBBLE_MAX_ROWS,
    BUBBLE_R,
    BUBBLE_ROW_H,
    BubbleBoard,
    BubbleLevel,
    BubbleSnapshot,
    aimToDir,
    cellCenter,
    clampAim,
    createBoard,
    levelById,
    mulberry32,
    pickNextColor,
    rowLength,
    scoreFor,
    traceShot,
} from './BubbleCore';

const { ccclass } = _decorator;

const GAME_ID = 'bubble';
const KEY_BEST = 'best';
const KEY_PROGRESS = 'progress';
const KEY_SAVE = 'save';

// ==================== 布局（720×1280，y 自顶向下） ====================

const DESIGN_W = 720;
const CANVAS_H = 1280;

const BOARD_DX = 40;
const BOARD_DY = 158;
/** 盘面局部坐标 → 本节点局部坐标的 y 偏移（= 640 - BOARD_DY） */
const SCREEN_DY = CANVAS_H / 2 - BOARD_DY;
const HALF_BOARD_W = BUBBLE_BOARD_W / 2;

const CANNON_DESIGN_X = 360;
const CANNON_DESIGN_Y = 1050;
/** 炮台在盘面局部坐标里的位置 */
const CANNON_BOARD = { x: CANNON_DESIGN_X - BOARD_DX, y: CANNON_DESIGN_Y - BOARD_DY };

/** 警戒线所在行（再往下就是判负区） */
const DANGER_ROW = BUBBLE_MAX_ROWS - 2;
const DANGER_DESIGN_Y = BOARD_DY + BUBBLE_R + DANGER_ROW * BUBBLE_ROW_H + BUBBLE_R;

/**
 * 瞄准区：盖住盘面到炮台下方，避开底部按钮。
 * 上边界必须压在顶栏（关卡标题 y≈60）之下 —— 瞄准层是整片可点区域，
 * 盖住哪个节点就吃掉哪个节点的点击（关卡标题的选关入口会被静默吞掉）。
 * 下边界要盖住发射器（y≈1050），否则从发射器按下拖动完全没反应
 * （试玩报告：玩家第一反应就是摸发射器）。
 */
const AIM_TOP = 152;
const AIM_BOTTOM = 1120;
const AIM_H = AIM_BOTTOM - AIM_TOP;
const AIM_CENTER_DESIGN_Y = (AIM_TOP + AIM_BOTTOM) / 2;
/** 根节点局部坐标 → 瞄准区局部坐标的 y 位移 */
const AIM_LOCAL_DY = CANVAS_H / 2 - AIM_CENTER_DESIGN_Y;
/** 炮台在瞄准区局部坐标里的位置 */
const AIM_CANNON_LOCAL_Y = AIM_CENTER_DESIGN_Y - CANNON_DESIGN_Y;

const FLY_SPEED = 2100;
/** 瞄准虚线：点间距、起点距离（跳过炮口）、最多点数 */
const AIM_DOT_STEP = 22;
const AIM_DOT_START = 72;
const AIM_MAX_DOTS = 40;

const BUBBLE_COLORS = [
    COLOR.PRIMARY,
    COLOR.SUCCESS,
    COLOR.DANGER,
    COLOR.WARNING,
    COLOR.INFO,
    COLOR.PASSIVE,
];

type Phase = 'aim' | 'flying' | 'over';

interface SaveData {
    v: 1;
    levelId: number;
    board: BubbleSnapshot;
    shots: number;
    score: number;
    current: number;
    next: number;
    seed: number;
}

interface FlyState {
    path: Array<{ x: number; y: number }>;
    seg: number;
    segT: number;
    segLen: number;
    traveled: number;
    total: number;
    cell: { row: number; col: number } | null;
    color: number;
    pos: { x: number; y: number };
}

@ccclass('BubbleGame')
export class BubbleGame extends Component {
    private _board: BubbleBoard = new BubbleBoard();
    private _level: BubbleLevel = BUBBLE_LEVELS[0];
    private _shots = 0;
    private _score = 0;
    private _current = 0;
    private _next = 0;
    private _rand: () => number = mulberry32(1);
    private _phase: Phase = 'aim';
    private _aim = 0;
    /** 正在拖动瞄准（决定是否画落点预览环，松手后立刻消失） */
    private _dragging = false;
    private _fly: FlyState | null = null;
    private _maxLevel = 1;
    private _orgLen = 0;
    private _best = 0;

    private _boardGfx: Graphics = null;
    private _aimGfx: Graphics = null;
    private _flyGfx: Graphics = null;
    private _cannonGfx: Graphics = null;
    private _nextGfx: Graphics = null;
    private _aimLayer: Node = null;
    private _shotsLabel: Label = null;
    private _scoreLabel: Label = null;
    private _levelLabel: Label = null;
    private _hintLabel: Label = null;
    private _restartBtn: UiButton = null;
    private _pickerOverlay: Node = null;
    private _resultOverlay: Node = null;

    onLoad(): void {
        applySceneClearColor(COLOR.BG_SCENE);
        this._best = Number(this._getItem(KEY_BEST)) || 0;
        this._maxLevel = Math.min(BUBBLE_LEVELS.length, Math.max(1, Number(this._getItem(KEY_PROGRESS)) || 1));

        this._buildUi();
        this._bindEvents();
        this._restoreOrStart();
        // 不再弹首次浮层：toast 固定在 y=1080，会压住发射器，且与底部常驻提示重复
        // （第二轮复核 N5）。底部提示已写明「从任意位置拖动」，信息不缺。
    }

    onDestroy(): void {
        this.unscheduleAllCallbacks();
        this._unbindEvents();
        this._fly = null;
        this._pickerOverlay = null;
        this._resultOverlay = null;
    }

    update(dt: number): void {
        if (this._phase !== 'flying' || !this._fly) return;
        const fly = this._fly;
        let remain = FLY_SPEED * dt;

        while (remain > 0 && fly.seg < fly.path.length - 1) {
            const a = fly.path[fly.seg];
            const b = fly.path[fly.seg + 1];
            const segLen = fly.segLen || 1;
            const left = (1 - fly.segT) * segLen;
            if (remain < left) {
                fly.segT += remain / segLen;
                remain = 0;
            } else {
                remain -= left;
                fly.seg++;
                fly.segT = 0;
                if (fly.seg < fly.path.length - 1) {
                    const p = fly.path[fly.seg];
                    const q = fly.path[fly.seg + 1];
                    fly.segLen = Math.max(1e-3, Math.hypot(q.x - p.x, q.y - p.y));
                }
            }
        }
        if (fly.seg >= fly.path.length - 1) {
            fly.pos = fly.path[fly.path.length - 1];
            this._drawFlyingBubble();
            this._land();
            return;
        }
        const a = fly.path[fly.seg];
        const b = fly.path[fly.seg + 1];
        fly.pos = { x: a.x + (b.x - a.x) * fly.segT, y: a.y + (b.y - a.y) * fly.segT };
        this._drawFlyingBubble();
    }

    // ==================== UI 构建 ====================

    private _buildUi(): void {
        createBackButton(this.node, () => this._onBack());

        const title = createLabel(this.node, '泡泡龙', 38, { bold: true, color: COLOR.TEXT_PRIMARY });
        title.node.setPosition(designPos(360, 58));

        const sub = createLabel(this.node, 'BUBBLE SHOOTER', 13, { color: COLOR.TEXT_SECONDARY });
        sub.node.setPosition(designPos(360, 92));

        // 关卡标题挪到右上：原先在 y=128，正好压在盘面顶饰线和第一行泡泡上（试玩报告）
        this._levelLabel = createLabel(this.node, '', FONT_BODY.fontSize, { color: COLOR.TEXT_SECONDARY });
        this._levelLabel.node.setPosition(designPos(586, 60));
        this._levelLabel.node.on(Node.EventType.TOUCH_END, this._onLevelLabelTap, this);

        // 盘面背景（静态）+ 泡泡层
        this._boardGfx = createNode('BoardGfx', this.node, DESIGN_W, CANVAS_H).addComponent(Graphics);
        this._boardGfx.node.setPosition(0, 0);

        // 瞄准层：只盖盘面区域，避免吃掉底部按钮的点击
        this._aimLayer = createNode('AimLayer', this.node, DESIGN_W, AIM_H);
        this._aimLayer.setPosition(designPos(360, AIM_CENTER_DESIGN_Y));
        this._aimGfx = this._aimLayer.addComponent(Graphics);

        // 飞行泡泡层（盖在盘面之上、瞄准线之下无所谓，最后绘制即可）
        this._flyGfx = createNode('FlyGfx', this.node, DESIGN_W, CANVAS_H).addComponent(Graphics);

        // 炮台
        this._cannonGfx = createNode('CannonGfx', this.node, 200, 200).addComponent(Graphics);
        this._cannonGfx.node.setPosition(designPos(CANNON_DESIGN_X, CANNON_DESIGN_Y));

        // 下一颗
        // 警戒线标注（试玩报告 §3.22：一条无说明的红虚线，玩家不知道越过会失败）
        const dangerCap = createLabel(this.node, '危险线 · 泡泡越线即失败', FONT_TINY.fontSize, {
            color: COLOR.DANGER,
            width: 420,
            height: 22,
        });
        dangerCap.node.setPosition(designPos(360, DANGER_DESIGN_Y - 16));

        const nextCap = createLabel(this.node, 'NEXT', FONT_TINY.fontSize, { color: COLOR.TEXT_DISABLED });
        nextCap.node.setPosition(designPos(632, CANNON_DESIGN_Y - 46));
        this._nextGfx = createNode('NextGfx', this.node, 120, 120).addComponent(Graphics);
        this._nextGfx.node.setPosition(designPos(632, CANNON_DESIGN_Y));

        this._shotsLabel = createLabel(this.node, '', FONT_BODY.fontSize, { color: COLOR.TEXT_PRIMARY });
        this._shotsLabel.node.setPosition(designPos(180, 1128));

        this._scoreLabel = createLabel(this.node, '', FONT_BODY.fontSize, { color: COLOR.TEXT_PRIMARY });
        this._scoreLabel.node.setPosition(designPos(540, 1128));

        // 唯一一条常驻操作提示：从发射器或盘面任意位置起手都行（A4 已支持），
        // 不再用「在盘面上」这种限制性说法（第二轮复核 N5）。
        this._hintLabel = createLabel(this.node, '从任意位置拖动瞄准 · 松手发射', FONT_BODY.fontSize, {
            color: COLOR.TEXT_DISABLED,
        });
        this._hintLabel.node.setPosition(designPos(360, 1178));

        this._restartBtn = createButton(this.node, {
            w: 180,
            h: 54,
            text: '重玩本关',
            fontSize: FONT_BODY.fontSize,
            fill: COLOR.SURFACE,
            textColor: COLOR.TEXT_SECONDARY,
            radius: 14,
            onTap: () => this._onRestart(),
        });
        this._restartBtn.node.setPosition(designPos(360, 1232));

        this._drawCannon();
        this._drawNext();
    }

    private _bindEvents(): void {
        this._aimLayer.on(Node.EventType.TOUCH_START, this._onTouchAim, this);
        this._aimLayer.on(Node.EventType.TOUCH_MOVE, this._onTouchAim, this);
        this._aimLayer.on(Node.EventType.TOUCH_END, this._onTouchRelease, this);
        this._aimLayer.on(Node.EventType.TOUCH_CANCEL, this._onTouchRelease, this);
    }

    private _unbindEvents(): void {
        if (this._levelLabel && this._levelLabel.isValid) {
            this._levelLabel.node.off(Node.EventType.TOUCH_END, this._onLevelLabelTap, this);
        }
        if (!this._aimLayer || !this._aimLayer.isValid) return;
        this._aimLayer.off(Node.EventType.TOUCH_START, this._onTouchAim, this);
        this._aimLayer.off(Node.EventType.TOUCH_MOVE, this._onTouchAim, this);
        this._aimLayer.off(Node.EventType.TOUCH_END, this._onTouchRelease, this);
        this._aimLayer.off(Node.EventType.TOUCH_CANCEL, this._onTouchRelease, this);
    }

    // ==================== 输入 ====================

    private _onTouchAim(ev: EventTouch): void {
        if (this._phase !== 'aim' || this._overlayOpen()) return;
        const ui = ev.getUILocation();
        if (!this._aimLayer || !this._aimLayer.isValid) return;
        const ut = this._aimLayer.getComponent(UITransform);
        if (!ut) return;
        const p = ut.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const dx = p.x;
        const dy = p.y - AIM_CANNON_LOCAL_Y;
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
        this._aim = clampAim(Math.atan2(dx, dy));
        this._dragging = true;
        this._drawAim();
    }

    private _onTouchRelease(): void {
        if (this._phase !== 'aim' || this._overlayOpen()) return;
        this._dragging = false;
        this._fire();
    }

    /** 结算 / 选关面板是否开着（遮罩不拦事件，面板打开时必须自己屏蔽瞄准层） */
    private _overlayOpen(): boolean {
        if (this._resultOverlay && this._resultOverlay.isValid) return true;
        if (this._pickerOverlay && this._pickerOverlay.isValid) return true;
        return false;
    }

    private _onRestart(): void {
        this._startLevel(this._level.id);
    }

    private _onBack(): void {
        this._saveOnExit();
        SceneManager.gotoLobby();
    }

    // ==================== 关卡 ====================

    private _restoreOrStart(): void {
        const save = this._loadSave();
        if (save && this._applySave(save)) return;
        this._startLevel(this._maxLevel);
    }

    private _startLevel(levelId: number): void {
        const level = levelById(levelId);
        this._level = level;
        this._board = createBoard(level);
        this._shots = level.shots;
        this._score = 0;
        this._rand = mulberry32(level.seed * 7919 + 13);
        this._current = pickNextColor(this._board, this._rand);
        this._next = pickNextColor(this._board, this._rand);
        this._phase = 'aim';
        this._aim = 0;
        this._dragging = false;
        this._fly = null;
        this._closeOverlays();
        this._redrawAll();
        this._setItem(KEY_PROGRESS, String(Math.max(this._maxLevel, levelId)));
        this._save();
    }

    private _onNextLevel(): void {
        const nextId = Math.min(BUBBLE_LEVELS.length, this._level.id + 1);
        if (nextId === this._level.id) {
            this._startLevel(this._level.id);
            return;
        }
        this._startLevel(nextId);
    }

    // ==================== 发射 ====================

    private _fire(): void {
        if (this._phase !== 'aim') return;
        const trace = traceShot(this._board, CANNON_BOARD, aimToDir(this._aim));
        const path = trace.path.map((p) => this._boardToLocal(p.x, p.y));
        if (path.length < 2) path.push(path[0]);

        let total = 0;
        for (let i = 1; i < path.length; i++) {
            total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
        }
        this._orgLen = total;

        this._fly = {
            path,
            seg: 0,
            segT: 0,
            segLen: Math.hypot(path[1].x - path[0].x, path[1].y - path[0].y),
            traveled: 0,
            total,
            cell: trace.cell,
            color: this._current,
            pos: path[0],
        };
        this._phase = 'flying';
        this._dragging = false;
        this._aimGfx.clear();
        this._drawFlyingBubble();
    }

    private _land(): void {
        const fly = this._fly;
        this._fly = null;
        this._flyGfx.clear();
        if (!fly) {
            this._phase = 'aim';
            return;
        }

        this._shots = Math.max(0, this._shots - 1);

        if (fly.cell) {
            this._board.set(fly.cell.row, fly.cell.col, fly.color);
            const res = this._board.settle(fly.cell.row, fly.cell.col);
            this._score += res.score;
            if (res.popped.length + res.dropped.length > 0) {
                toast(this.node, `消除 ${res.popped.length} · 掉落 ${res.dropped.length}`, 1.0, 980);
            }
        } else {
            toast(this.node, '这一发没地方落脚', 1.0, 980);
        }

        this._current = this._next;
        this._next = pickNextColor(this._board, this._rand);

        if (this._board.isEmpty()) {
            this._endGame(true);
            return;
        }
        if (this._shots <= 0 || this._board.lowestOccupiedRow() >= BUBBLE_MAX_ROWS - 1) {
            this._endGame(false);
            return;
        }

        this._phase = 'aim';
        this._redrawAll();
        this._save();
    }

    private _endGame(won: boolean): void {
        this._phase = 'over';
        this._score += scoreFor(this._shots, won);
        if (this._score > this._best) {
            this._best = this._score;
            this._setItem(KEY_BEST, String(this._best));
        }
        if (won) {
            const next = Math.min(BUBBLE_LEVELS.length, this._level.id + 1);
            this._maxLevel = Math.max(this._maxLevel, next);
            this._setItem(KEY_PROGRESS, String(this._maxLevel));
        }
        this._clearItem(KEY_SAVE);
        this._redrawAll();
        this._showResult(won);
    }

    // ==================== 绘制 ====================

    private _boardToLocal(bx: number, by: number): { x: number; y: number } {
        return { x: bx - HALF_BOARD_W, y: SCREEN_DY - by };
    }

    private _redrawAll(): void {
        this._drawBoard();
        this._drawCannon();
        this._drawNext();
        this._drawAim();
        this._refreshStatus();
    }

    private _refreshStatus(): void {
        if (this._shotsLabel) this._shotsLabel.string = `剩余 ${this._shots} 发`;
        if (this._scoreLabel) this._scoreLabel.string = `得分 ${this._score}`;
        if (this._levelLabel) this._levelLabel.string = `第 ${this._level.id} 关 / 共 ${BUBBLE_LEVELS.length} 关`;
    }

    private _drawBoard(): void {
        const g = this._boardGfx;
        if (!g || !g.isValid) return;
        g.clear();

        // 盘面底：比场景底色再暗一档的凹槽
        const left = BOARD_DX - 360 - 6;
        const top = 640 - (BOARD_DY - BUBBLE_R) + 6;
        const w = BUBBLE_BOARD_W + 12;
        const h = (BUBBLE_MAX_ROWS - 1) * BUBBLE_ROW_H + BUBBLE_R * 2 + 12;
        g.fillColor = hex(COLOR.SLOT_EMPTY_BG, 150);
        g.roundRect(left, top - h, w, h, 18);
        g.fill();
        g.strokeColor = hex(COLOR.PANEL_BORDER, 170);
        g.lineWidth = 2;
        g.roundRect(left, top - h, w, h, 18);
        g.stroke();

        // 顶梁
        const beamY = 640 - (BOARD_DY - BUBBLE_R) + 2;
        g.fillColor = hex(COLOR.PANEL_BORDER, 220);
        g.rect(-HALF_BOARD_W, beamY, BUBBLE_BOARD_W, 5);
        g.fill();

        // 警戒线（虚线）
        const dy = 640 - DANGER_DESIGN_Y;
        g.fillColor = hex(COLOR.DANGER, 110);
        for (let x = -HALF_BOARD_W; x < HALF_BOARD_W; x += 22) {
            g.rect(x, dy, 12, 3);
        }
        g.fill();

        // 泡泡
        for (let row = 0; row < this._board.maxRows; row++) {
            const len = rowLength(row);
            for (let col = 0; col < len; col++) {
                const v = this._board.get(row, col);
                if (v === BUBBLE_EMPTY) continue;
                const c = cellCenter(row, col);
                const p = this._boardToLocal(c.x, c.y);
                this._paintBubble(g, p.x, p.y, v, 255);
            }
        }
    }

    private _paintBubble(g: Graphics, x: number, y: number, colorIdx: number, alpha: number): void {
        const base = BUBBLE_COLORS[colorIdx % BUBBLE_COLORS.length];
        g.fillColor = hex(base, alpha);
        g.circle(x, y, BUBBLE_R - 2);
        g.fill();

        g.strokeColor = hex(COLOR.BG_SCENE, Math.round(alpha * 0.6));
        g.lineWidth = 3;
        g.circle(x, y, BUBBLE_R - 2);
        g.stroke();

        g.fillColor = new Color(255, 255, 255, Math.round(alpha * 0.34));
        g.circle(x - BUBBLE_R * 0.3, y + BUBBLE_R * 0.3, BUBBLE_R * 0.3);
        g.fill();
    }

    private _drawCannon(): void {
        const g = this._cannonGfx;
        if (!g || !g.isValid) return;
        g.clear();

        // 底座
        g.fillColor = hex(COLOR.PANEL_BG);
        g.circle(0, 0, 62);
        g.fill();
        g.strokeColor = hex(COLOR.PANEL_BORDER);
        g.lineWidth = 3;
        g.circle(0, 0, 62);
        g.stroke();

        // 炮口朝向
        const dir = aimToDir(this._aim);
        g.strokeColor = hex(COLOR.PANEL_BORDER, 220);
        g.lineWidth = 14;
        g.moveTo(dir.x * 26, -dir.y * 26);
        g.lineTo(dir.x * 62, -dir.y * 62);
        g.stroke();

        // 待发泡泡
        this._paintBubble(g, 0, 0, this._current, 255);
    }

    private _drawNext(): void {
        const g = this._nextGfx;
        if (!g || !g.isValid) return;
        g.clear();
        this._paintBubble(g, 0, 0, this._next, 255);
    }

    private _drawAim(): void {
        const g = this._aimGfx;
        if (!g || !g.isValid) return;
        g.clear();
        if (this._phase !== 'aim') return;

        const trace = traceShot(this._board, CANNON_BOARD, aimToDir(this._aim));
        const pts = trace.path.map((p) => {
            const local = this._boardToLocal(p.x, p.y);
            return { x: local.x, y: local.y - AIM_LOCAL_DY };
        });
        if (pts.length < 2) return;

        g.fillColor = hex(BUBBLE_COLORS[Math.max(0, this._current)], 190);
        let acc = 0;
        let dots = 0;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            const segLen = Math.hypot(b.x - a.x, b.y - a.y);
            if (segLen < 1e-3) continue;
            let t = 0;
            while (t < segLen && dots < AIM_MAX_DOTS) {
                const at = acc + t;
                // 跳过炮口内部的一段，其余按等距点画到落点，反弹后继续跟折线走
                if (at >= AIM_DOT_START) {
                    g.circle(a.x + ((b.x - a.x) * t) / segLen, a.y + ((b.y - a.y) * t) / segLen, 3.6);
                    dots++;
                }
                t += AIM_DOT_STEP;
            }
            acc += segLen;
            if (dots >= AIM_MAX_DOTS) break;
        }
        g.fill();

        // 落点预览环只在拖动时画：松手后残留的「空心圆」玩家看不懂（第二轮复核 N6）
        if (this._dragging && trace.cell) {
            const c = cellCenter(trace.cell.row, trace.cell.col);
            const p = this._boardToLocal(c.x, c.y);
            g.strokeColor = hex(BUBBLE_COLORS[Math.max(0, this._current)], 200);
            g.lineWidth = 3;
            g.circle(p.x, p.y - AIM_LOCAL_DY, BUBBLE_R - 3);
            g.stroke();
        }
    }

    private _drawFlyingBubble(): void {
        const g = this._flyGfx;
        if (!g || !g.isValid) return;
        g.clear();
        if (!this._fly) return;
        const p = this._fly.pos;
        this._paintBubble(g, p.x, p.y, this._fly.color, 255);
    }

    // ==================== 面板 ====================

    private _closeOverlays(): void {
        if (this._pickerOverlay && this._pickerOverlay.isValid) this._pickerOverlay.destroy();
        if (this._resultOverlay && this._resultOverlay.isValid) this._resultOverlay.destroy();
        this._pickerOverlay = null;
        this._resultOverlay = null;
    }

    private _showResult(won: boolean): void {
        this._closeOverlays();
        const overlay = createNode('ResultOverlay', this.node, DESIGN_W, CANVAS_H);
        this._resultOverlay = overlay;

        const dim = createNode('Dim', overlay, DESIGN_W, CANVAS_H);
        const dimGfx = dim.addComponent(Graphics);
        dimGfx.fillColor = hex(COLOR.BG_OVERLAY, 170);
        dimGfx.rect(-DESIGN_W / 2, -CANVAS_H / 2, DESIGN_W, CANVAS_H);
        dimGfx.fill();

        const panel = createNode('Panel', overlay, 560, 480);
        panel.setPosition(designPos(360, 640));
        const panelGfx = panel.addComponent(Graphics);
        drawRoundRect(panelGfx, 560, 480, 24, toColor(COLOR.PANEL_BG), toColor(COLOR.PANEL_BORDER), 2);

        const accent = createNode('Accent', panel, 200, 8);
        accent.setPosition(0, 216);
        const accentGfx = accent.addComponent(Graphics);
        drawRoundRect(accentGfx, 200, 8, 4, toColor(won ? COLOR.SUCCESS : COLOR.DANGER));

        const title = createLabel(panel, won ? '过关！' : '挑战失败', FONT_DISPLAY.fontSize, {
            bold: true,
            color: won ? COLOR.SUCCESS : COLOR.DANGER,
        });
        title.node.setPosition(0, 160);

        const detail = createLabel(
            panel,
            won
                ? `第 ${this._level.id} 关清空 · 剩 ${this._shots} 发奖励 ${this._shots * 50} 分`
                : `第 ${this._level.id} 关未清空`,
            FONT_BODY.fontSize,
            { color: COLOR.TEXT_SECONDARY }
        );
        detail.node.setPosition(0, 98);

        const score = createLabel(panel, `本局得分 ${this._score}`, FONT_TITLE.fontSize, {
            bold: true,
            color: COLOR.TEXT_PRIMARY,
        });
        score.node.setPosition(0, 40);

        const best = createLabel(panel, `历史最高 ${this._best}`, FONT_CAPTION.fontSize, {
            color: COLOR.TEXT_DISABLED,
        });
        best.node.setPosition(0, -6);

        const hasNext = won && this._level.id < BUBBLE_LEVELS.length;
        const mainText = hasNext ? '下一关' : '再来一局';
        const main = createButton(panel, {
            w: 220,
            h: 62,
            text: mainText,
            fontSize: FONT_BODY.fontSize,
            fill: won ? COLOR.SUCCESS : COLOR.PRIMARY,
            textColor: '#FFFFFF',
            radius: 16,
            onTap: hasNext ? () => this._onNextLevel() : () => this._onRestart(),
        });
        main.node.setPosition(0, -80);

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
        back.node.setPosition(0, -158);
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

        const panel = createNode('Panel', overlay, 640, 620);
        panel.setPosition(designPos(360, 620));
        const panelGfx = panel.addComponent(Graphics);
        drawRoundRect(panelGfx, 640, 620, 24, toColor(COLOR.PANEL_BG), toColor(COLOR.PANEL_BORDER), 2);

        const title = createLabel(panel, '选择关卡', FONT_TITLE.fontSize, { bold: true, color: COLOR.TEXT_PRIMARY });
        title.node.setPosition(0, 258);

        const COLS = 5;
        const BW = 104;
        const BH = 64;
        const GX = 118;
        const GY = 74;
        for (let i = 0; i < BUBBLE_LEVELS.length; i++) {
            const id = BUBBLE_LEVELS[i].id;
            const c = i % COLS;
            const r = Math.floor(i / COLS);
            const x = (c - (COLS - 1) / 2) * GX;
            const y = 190 - r * GY;
            const unlocked = id <= this._maxLevel;
            const btn = createButton(panel, {
                w: BW,
                h: BH,
                text: String(id),
                fontSize: FONT_BODY.fontSize,
                fill: id === this._level.id ? COLOR.PRIMARY : unlocked ? COLOR.SURFACE : COLOR.PRIMARY_DISABLED,
                textColor: unlocked ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED,
                radius: 12,
                onTap: unlocked ? () => this._onPickLevel(id) : () => undefined,
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
            onTap: () => this._onClosePicker(),
        });
        close.node.setPosition(0, -262);
    }

    private _onPickLevel(id: number): void {
        this._closeOverlays();
        this._startLevel(id);
    }

    private _onClosePicker(): void {
        this._closeOverlays();
    }

    private _onLevelLabelTap(): void {
        if (this._phase !== 'aim') return;
        this._showPicker();
    }

    // ==================== 存档 ====================

    private _snapshotSave(): SaveData {
        return {
            v: 1,
            levelId: this._level.id,
            board: this._board.snapshot(),
            shots: this._shots,
            score: this._score,
            current: this._current,
            next: this._next,
            seed: 0,
        };
    }

    private _save(): void {
        try {
            this._setItem(KEY_SAVE, JSON.stringify(this._snapshotSave()));
        } catch (e) {
            console.warn('[bubble] save failed', e);
        }
    }

    private _saveOnExit(): void {
        if (this._phase === 'over') {
            this._clearItem(KEY_SAVE);
            return;
        }
        this._save();
    }

    private _loadSave(): SaveData | null {
        const raw = this._getItem(KEY_SAVE);
        if (!raw) return null;
        try {
            const data = JSON.parse(raw) as SaveData;
            if (!data || data.v !== 1) return null;
            if (!Array.isArray(data.board && data.board.grid)) return null;
            if (typeof data.levelId !== 'number') return null;
            return data;
        } catch (e) {
            return null;
        }
    }

    private _applySave(data: SaveData): boolean {
        try {
            const level = levelById(data.levelId);
            const board = BubbleBoard.fromSnapshot(data.board);
            if (board.isEmpty()) return false;
            const shots = Number(data.shots);
            if (!isFinite(shots) || shots <= 0) return false;

            this._level = level;
            this._board = board;
            this._shots = Math.floor(shots);
            this._score = Math.max(0, Number(data.score) || 0);
            this._rand = mulberry32(level.seed * 7919 + 13);
            this._current = Number.isFinite(data.current) ? data.current : pickNextColor(board, this._rand);
            this._next = Number.isFinite(data.next) ? data.next : pickNextColor(board, this._rand);
            this._phase = 'aim';
            this._aim = 0;
            this._fly = null;
            this._redrawAll();
            return true;
        } catch (e) {
            return false;
        }
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
            console.warn('[bubble] storage failed', e);
        }
    }

    private _clearItem(key: string): void {
        this._setItem(key, '');
    }
}
