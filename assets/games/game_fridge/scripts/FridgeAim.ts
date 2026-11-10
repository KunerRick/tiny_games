/**
 * 冰箱底下 — 右半屏拖动瞄准（规格 §5.1）。
 *
 * - 按下滑动方向 = 瞄准方向；拖动距离超过阈值才进入「手动瞄准 + 持续开火」
 * - 松手回到自动瞄准最近敌人（核心内部兜底，本组件只负责给出方向）
 * - 只覆盖右半屏（360×1280），与左摇杆互不抢占；桌面拖拽结束派发 TOUCH_CANCEL，必须一起处理
 *
 * 约定：事件 handler 全部命名方法（红线 5）；onDestroy 只解绑与清引用（红线 4）。
 */

import { _decorator, Component, EventTouch, Node, UITransform, Vec2, Vec3 } from 'cc';

const { ccclass } = _decorator;

/** 进入瞄准的最小拖动距离（设计像素）。低于此值视为没拖，继续自动瞄准 */
const AIM_THRESHOLD = 10;

@ccclass('FridgeAim')
export class FridgeAim extends Component {
    /** 瞄准方向（单位向量），firing 为 false 时无意义 */
    readonly direction: Vec2 = new Vec2(0, 0);

    /** 浏览器探针用 */
    _active = false;
    _firing = false;
    _touchId = -1;

    private _start = new Vec3();
    private _tmpUi = new Vec3();
    private _tmpLocal = new Vec3();

    onLoad(): void {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    onDestroy(): void {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this.release();
    }

    isFiring(): boolean {
        return this._firing;
    }

    release(): void {
        this._active = false;
        this._firing = false;
        this._touchId = -1;
        this.direction.set(0, 0);
    }

    private onTouchStart(ev: EventTouch): void {
        if (this._touchId !== -1) return;
        const touch = ev.touch;
        if (!touch) return;
        this._touchId = touch.getID();
        this._toLocal(touch.getUILocation().x, touch.getUILocation().y, this._tmpLocal);
        this._start.set(this._tmpLocal);
        this._active = true;
        this._firing = false;
        this.direction.set(0, 0);
    }

    private onTouchMove(ev: EventTouch): void {
        const touch = ev.touch;
        if (!touch || touch.getID() !== this._touchId) return;
        this._toLocal(touch.getUILocation().x, touch.getUILocation().y, this._tmpLocal);
        const dx = this._tmpLocal.x - this._start.x;
        const dy = this._tmpLocal.y - this._start.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= AIM_THRESHOLD) {
            this._firing = false;
            return;
        }
        this._firing = true;
        this.direction.set(dx / dist, dy / dist);
    }

    private onTouchEnd(ev: EventTouch): void {
        const touch = ev.touch;
        if (!touch || touch.getID() !== this._touchId) return;
        this.release();
    }

    private onTouchCancel(ev: EventTouch): void {
        const touch = ev.touch;
        if (!touch || touch.getID() !== this._touchId) return;
        this.release();
    }

    private _toLocal(uiX: number, uiY: number, out: Vec3): void {
        const ut = this.node.getComponent(UITransform);
        if (!ut) {
            out.set(uiX, uiY, 0);
            return;
        }
        this._tmpUi.set(uiX, uiY, 0);
        ut.convertToNodeSpaceAR(this._tmpUi, out);
    }
}
