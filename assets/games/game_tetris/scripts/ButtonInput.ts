/**
 * 方块坠落 — 模式二：虚拟按键。
 *
 * 左右键按下立即移动一格，`DAS_SEC` 后开始每 `ARR_SEC` 连发；
 * 连发计时走 `update(dt)` 累加，**不用 scheduleOnce 自排期**（AGENTS.md 教训 F）。
 *
 * 手指滑出按钮派发的是 `TOUCH_CANCEL`（桌面拖拽亦然），
 * 必须当作松手处理：停连发、停软降、恢复按下态，否则会出现「键卡住」。
 */

import { Color, Node, Sprite } from 'cc';
import { ARR_SEC, DAS_SEC } from './TetrisConfig';
import { ITetrisHost, ITetrisInput, TetrisAction } from './TetrisInput';

/** 按下时的缩放与变暗系数 */
const PRESS_SCALE = 0.94;
const PRESS_TINT = 0.75;

/** 单帧最多补发的次数，掉帧时别把方块一次推到底 */
const MAX_CATCH_UP = 5;

interface ButtonView {
    node: Node;
    sprite: Sprite | null;
    baseColor: Color;
    pressed: boolean;
}

export class ButtonInput implements ITetrisInput {
    private _host: ITetrisHost;
    private _layer: Node;

    private _left: ButtonView;
    private _right: ButtonView;
    private _softDrop: ButtonView;
    private _hardDrop: ButtonView;
    private _rotate: ButtonView;

    private _enabled = false;

    /** 连发方向：-1 左，1 右，0 无 */
    private _repeatDir = 0;
    private _dasTimer = 0;
    private _arrTimer = 0;
    private _repeating = false;

    private _softDropping = false;

    constructor(
        host: ITetrisHost,
        layer: Node,
        left: Node,
        right: Node,
        softDrop: Node,
        hardDrop: Node,
        rotate: Node,
    ) {
        this._host = host;
        this._layer = layer;
        this._left = makeView(left);
        this._right = makeView(right);
        this._softDrop = makeView(softDrop);
        this._hardDrop = makeView(hardDrop);
        this._rotate = makeView(rotate);
    }

    enable(): void {
        if (this._enabled) return;
        this._enabled = true;
        this._layer.active = true;

        const on = (node: Node, type: string, handler: Function) => node.on(type as any, handler as any, this);
        on(this._left.node, Node.EventType.TOUCH_START, this.onLeftDown);
        on(this._left.node, Node.EventType.TOUCH_END, this.onLeftUp);
        on(this._left.node, Node.EventType.TOUCH_CANCEL, this.onLeftUp);
        on(this._right.node, Node.EventType.TOUCH_START, this.onRightDown);
        on(this._right.node, Node.EventType.TOUCH_END, this.onRightUp);
        on(this._right.node, Node.EventType.TOUCH_CANCEL, this.onRightUp);
        on(this._softDrop.node, Node.EventType.TOUCH_START, this.onSoftDropDown);
        on(this._softDrop.node, Node.EventType.TOUCH_END, this.onSoftDropUp);
        on(this._softDrop.node, Node.EventType.TOUCH_CANCEL, this.onSoftDropUp);
        on(this._rotate.node, Node.EventType.TOUCH_START, this.onRotateDown);
        on(this._rotate.node, Node.EventType.TOUCH_END, this.onRotateUp);
        on(this._rotate.node, Node.EventType.TOUCH_CANCEL, this.onRotateCancel);
        on(this._hardDrop.node, Node.EventType.TOUCH_START, this.onHardDropDown);
        on(this._hardDrop.node, Node.EventType.TOUCH_END, this.onHardDropUp);
        on(this._hardDrop.node, Node.EventType.TOUCH_CANCEL, this.onHardDropCancel);
    }

    disable(): void {
        // 同 GestureInput：从未 enable 过也要隐藏，避免初始状态残留
        if (this._enabled) {
            this._stopRepeat();
            if (this._softDropping) {
                this._softDropping = false;
                this._host.applyAction(TetrisAction.SoftDropEnd);
            }
            this.detach();
        }
        this._layer.active = false;
    }

    /** 场景销毁时用：只解绑、清状态，不派发动作、不碰节点 */
    detach(): void {
        if (!this._enabled) return;
        this._enabled = false;

        const off = (node: Node, type: string, handler: Function) => node.off(type as any, handler as any, this);
        off(this._left.node, Node.EventType.TOUCH_START, this.onLeftDown);
        off(this._left.node, Node.EventType.TOUCH_END, this.onLeftUp);
        off(this._left.node, Node.EventType.TOUCH_CANCEL, this.onLeftUp);
        off(this._right.node, Node.EventType.TOUCH_START, this.onRightDown);
        off(this._right.node, Node.EventType.TOUCH_END, this.onRightUp);
        off(this._right.node, Node.EventType.TOUCH_CANCEL, this.onRightUp);
        off(this._softDrop.node, Node.EventType.TOUCH_START, this.onSoftDropDown);
        off(this._softDrop.node, Node.EventType.TOUCH_END, this.onSoftDropUp);
        off(this._softDrop.node, Node.EventType.TOUCH_CANCEL, this.onSoftDropUp);
        off(this._rotate.node, Node.EventType.TOUCH_START, this.onRotateDown);
        off(this._rotate.node, Node.EventType.TOUCH_END, this.onRotateUp);
        off(this._rotate.node, Node.EventType.TOUCH_CANCEL, this.onRotateCancel);
        off(this._hardDrop.node, Node.EventType.TOUCH_START, this.onHardDropDown);
        off(this._hardDrop.node, Node.EventType.TOUCH_END, this.onHardDropUp);
        off(this._hardDrop.node, Node.EventType.TOUCH_CANCEL, this.onHardDropCancel);

        this._stopRepeat();
        this._softDropping = false;
        this._restoreAll();
    }

    /** 由 TetrisGame.update 每帧驱动：DAS / ARR 连发 */
    update(dt: number): void {
        if (!this._enabled || this._repeatDir === 0) return;

        if (!this._repeating) {
            this._dasTimer += dt;
            if (this._dasTimer < DAS_SEC) return;
            this._repeating = true;
            this._arrTimer = 0;
        }

        this._arrTimer += dt;
        let sent = 0;
        while (this._arrTimer >= ARR_SEC && sent < MAX_CATCH_UP) {
            this._arrTimer -= ARR_SEC;
            this._fire(this._repeatDir < 0 ? TetrisAction.Left : TetrisAction.Right);
            sent++;
        }
    }

    // ==================== 触摸回调 ====================

    private onLeftDown(): void {
        this._press(this._left);
        this._fire(TetrisAction.Left);
        this._startRepeat(-1);
    }

    private onLeftUp(): void {
        this._release(this._left);
        if (this._repeatDir === -1) this._stopRepeat();
    }

    private onRightDown(): void {
        this._press(this._right);
        this._fire(TetrisAction.Right);
        this._startRepeat(1);
    }

    private onRightUp(): void {
        this._release(this._right);
        if (this._repeatDir === 1) this._stopRepeat();
    }

    private onSoftDropDown(): void {
        this._press(this._softDrop);
        this._softDropping = true;
        this._fire(TetrisAction.SoftDropStart);
    }

    private onSoftDropUp(): void {
        this._release(this._softDrop);
        if (this._softDropping) {
            this._softDropping = false;
            this._fire(TetrisAction.SoftDropEnd);
        }
    }

    private onRotateDown(): void {
        this._press(this._rotate);
    }

    /** 旋转在松手时触发一次（按下先给按下态反馈） */
    private onRotateUp(): void {
        this._release(this._rotate);
        this._fire(TetrisAction.RotateCW);
    }

    /** 手指滑出按钮：只恢复按下态，不触发动作 */
    private onRotateCancel(): void {
        this._release(this._rotate);
    }

    private onHardDropDown(): void {
        this._press(this._hardDrop);
    }

    private onHardDropUp(): void {
        this._release(this._hardDrop);
        this._fire(TetrisAction.HardDrop);
    }

    private onHardDropCancel(): void {
        this._release(this._hardDrop);
    }

    // ==================== 内部 ====================

    private _fire(action: TetrisAction): void {
        this._host.applyAction(action);
    }

    private _startRepeat(dir: number): void {
        this._repeatDir = dir;
        this._dasTimer = 0;
        this._arrTimer = 0;
        this._repeating = false;
    }

    private _stopRepeat(): void {
        this._repeatDir = 0;
        this._dasTimer = 0;
        this._arrTimer = 0;
        this._repeating = false;
    }

    private _press(view: ButtonView): void {
        if (view.pressed) return;
        view.pressed = true;
        const s = PRESS_SCALE;
        view.node.setScale(s, s, 1);
        if (view.sprite) {
            view.sprite.color = tint(view.baseColor, PRESS_TINT);
        }
    }

    private _release(view: ButtonView): void {
        if (!view.pressed) return;
        view.pressed = false;
        view.node.setScale(1, 1, 1);
        if (view.sprite) {
            view.sprite.color = view.baseColor;
        }
    }

    private _restoreAll(): void {
        this._release(this._left);
        this._release(this._right);
        this._release(this._softDrop);
        this._release(this._hardDrop);
        this._release(this._rotate);
    }
}

function makeView(node: Node): ButtonView {
    const sprite = node.getComponent(Sprite);
    return {
        node,
        sprite,
        baseColor: sprite ? sprite.color.clone() : new Color(255, 255, 255, 255),
        pressed: false,
    };
}

function tint(base: Color, factor: number): Color {
    return new Color(
        Math.round(base.r * factor),
        Math.round(base.g * factor),
        Math.round(base.b * factor),
        base.a,
    );
}
