/**
 * 方块坠落 — 模式一：全屏相对手势。
 *
 * 核心是**相对位移**：手指落点与方块无关，只告诉方块「往左右移了几格」。
 * 手指可以放在棋盘下方的空白区，落点永远不被手挡住；
 * `列 = 基准列 + round(dx / 格宽)` 由逻辑层吸附，半格误差看不出来。
 *
 * 边界规则（设计文档 §3.2）：
 * - `TOUCH_CANCEL` 只结束手势，**不旋转、不硬降**（桌面拖拽结束派发的就是它）
 * - 进入拖拽却一格没动、时长 < 400ms → 回退成轻点旋转（否则「拖了个空」像点了没反应）
 * - 拖拽中方块锁定换新 → 重新取基准列/基准手指位置，旧位移不带入新方块
 *
 * 不继承 Component：本类只认 GestureLayer 节点，由 TetrisGame 在 start() 里创建，
 * 这样输入层与场景结构解耦，也避免运行时 addComponent 的顺序问题。
 */

import { EventTouch, Node } from 'cc';
import {
    DRAG_FALLBACK_MAX_SEC,
    HARD_DROP_MIN_ROWS,
    HARD_DROP_MIN_SPEED,
    TAP_MAX_MOVE,
    TAP_MAX_SEC,
} from './TetrisConfig';
import { ITetrisHost, ITetrisInput, TetrisAction } from './TetrisInput';

enum GestureState {
    Idle,
    /** 手指按下，还没判定是点还是拖 */
    Pending,
    Drag,
}

/** 速度采样窗口（毫秒）：只看最近一小段，避免长按后被早期慢速稀释 */
const SPEED_WINDOW_MS = 120;

export class GestureInput implements ITetrisInput {
    private _node: Node;
    private _host: ITetrisHost;
    private _enabled = false;

    private _state = GestureState.Idle;
    private _touchId: number | null = null;

    private _startX = 0;
    private _startY = 0;
    private _startTime = 0;

    /** 手势基准列与方块令牌：拖拽中换块时要重取 */
    private _baseColumn = 0;
    private _baseToken = -1;

    private _dx = 0;
    /** 下移量为正（UI 坐标 y 向上） */
    private _dy = 0;

    private _softDropOn = false;
    /** 已消费：双指逆时针后，抬手不再触发旋转/硬降 */
    private _consumed = false;

    /** 最近一小段竖向采样，算甩动速度 */
    private _trace: { t: number; y: number }[] = [];

    constructor(node: Node, host: ITetrisHost) {
        this._node = node;
        this._host = host;
    }

    enable(): void {
        if (this._enabled) return;
        this._enabled = true;
        this._node.active = true;
        this._node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this._node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this._node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this._node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    disable(): void {
        // 即使从未 enable 过也要把节点藏起来：初始状态由 _syncInputEnabled 统一决定，
        // 否则「存档为按键模式」时 GestureLayer 会带着场景默认的 active=true 留在上面
        if (this._enabled) {
            this._finish();
            this.detach();
        }
        this._node.active = false;
    }

    /**
     * 场景销毁时用：只解绑监听、清状态。
     * **不派发动作、不碰节点 active** —— onDestroy 里碰节点容易拿到已失效的对象。
     */
    detach(): void {
        if (!this._enabled) return;
        this._enabled = false;
        this._node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this._node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this._node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this._node.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this._state = GestureState.Idle;
        this._touchId = null;
        this._softDropOn = false;
        this._consumed = false;
        this._trace.length = 0;
    }

    // ==================== 触摸事件 ====================

    private onTouchStart(e: EventTouch): void {
        const id = e.touch.getID();

        // 第二指按下：逆时针旋转（第一指仍在按着）
        if (this._touchId !== null && id !== this._touchId) {
            if (!this._consumed) {
                this._consumed = true;
                this._host.applyAction(TetrisAction.RotateCCW);
            }
            return;
        }

        if (this._state !== GestureState.Idle) return;

        const p = e.getUILocation();
        this._touchId = id;
        this._state = GestureState.Pending;
        this._startX = p.x;
        this._startY = p.y;
        this._startTime = nowMs();
        this._dx = 0;
        this._dy = 0;
        this._consumed = false;
        this._softDropOn = false;

        const column = this._host.getPieceColumn();
        this._baseColumn = column === null ? 0 : column;
        this._baseToken = this._host.getPieceToken();

        this._trace.length = 0;
        this._trace.push({ t: this._startTime, y: p.y });
    }

    private onTouchMove(e: EventTouch): void {
        if (this._state === GestureState.Idle || e.touch.getID() !== this._touchId) return;

        const p = e.getUILocation();
        const now = nowMs();
        this._dx = p.x - this._startX;
        this._dy = this._startY - p.y;

        this._trace.push({ t: now, y: p.y });
        while (this._trace.length > 2 && now - this._trace[0].t > SPEED_WINDOW_MS) {
            this._trace.shift();
        }

        const cell = this._host.getCellSize();

        // 拖拽中方块锁定换了新块：重新取基准，旧列位移不带入
        if (this._state === GestureState.Drag && this._host.getPieceToken() !== this._baseToken) {
            const column = this._host.getPieceColumn();
            this._baseColumn = column === null ? 0 : column;
            this._baseToken = this._host.getPieceToken();
            this._startX = p.x;
            this._dx = 0;
        }

        if (this._state === GestureState.Pending) {
            if (Math.abs(this._dx) < TAP_MAX_MOVE && this._dy < cell / 2) return;
            this._state = GestureState.Drag;
        }

        // 列吸附：目标列 = 基准列 + round(位移 / 格宽)，撞墙自动停
        this._host.snapPieceToColumn(this._baseColumn + Math.round(this._dx / cell));

        // 下移过半格开始软降；回抬过半格就停
        const wantSoft = this._dy >= cell / 2;
        if (wantSoft !== this._softDropOn) {
            this._softDropOn = wantSoft;
            this._host.applyAction(wantSoft ? TetrisAction.SoftDropStart : TetrisAction.SoftDropEnd);
        }
    }

    private onTouchEnd(e: EventTouch): void {
        if (this._state === GestureState.Idle || e.touch.getID() !== this._touchId) return;

        const p = e.getUILocation();
        const now = nowMs();
        this._trace.push({ t: now, y: p.y });

        const cell = this._host.getCellSize();

        if (this._state === GestureState.Pending) {
            // 轻点：位移小、时间短 → 顺时针旋转
            if (!this._consumed && Math.abs(this._dx) < TAP_MAX_MOVE && (now - this._startTime) / 1000 < TAP_MAX_SEC) {
                this._host.applyAction(TetrisAction.RotateCW);
            }
            this._finish();
            return;
        }

        const durationSec = (now - this._startTime) / 1000;
        const rows = this._dy / cell;
        const speed = this._verticalSpeed();

        if (!this._consumed && speed > HARD_DROP_MIN_SPEED && rows > HARD_DROP_MIN_ROWS) {
            // 快速下甩 → 硬降（立即锁定）
            this._host.applyAction(TetrisAction.HardDrop);
        } else if (!this._consumed && Math.round(this._dx / cell) === 0 && rows < 0.5 && durationSec < DRAG_FALLBACK_MAX_SEC) {
            // 拖了个空（多为撞墙）：当轻点处理，否则玩家会觉得点了没反应
            this._host.applyAction(TetrisAction.RotateCW);
        }

        this._finish();
    }

    private onTouchCancel(e: EventTouch): void {
        if (this._state === GestureState.Idle || e.touch.getID() !== this._touchId) return;
        // 只结束：已经产生的移动保留，但不旋转、不硬降
        this._finish();
    }

    // ==================== 内部 ====================

    /** 竖向速度（设计像素/毫秒），向下为正；采样不足时返回 0 */
    private _verticalSpeed(): number {
        const trace = this._trace;
        if (trace.length < 2) return 0;
        const first = trace[0];
        const last = trace[trace.length - 1];
        const dt = last.t - first.t;
        if (dt <= 0) return 0;
        return (first.y - last.y) / dt;
    }

    /** 结束手势：务必关掉软降，否则松手后还在加速下落 */
    private _finish(): void {
        if (this._softDropOn) {
            this._softDropOn = false;
            this._host.applyAction(TetrisAction.SoftDropEnd);
        }
        this._state = GestureState.Idle;
        this._touchId = null;
        this._consumed = false;
        this._dx = 0;
        this._dy = 0;
        this._trace.length = 0;
    }
}

function nowMs(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
