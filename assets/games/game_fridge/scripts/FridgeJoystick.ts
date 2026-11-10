/**
 * 冰箱底下 — 左半屏动态摇杆（规格 §5.1）。
 *
 * 与 SurvivorJoystick 相同的手感约定：按下处即圆心、单指 `_touchId`、松手立即归零；
 * 差别是本节点只覆盖**左半屏**（360×1280），右半屏的拖动归 FridgeAim，两者互不抢占。
 *
 * 约定：事件 handler 全部命名方法（红线 5）；onDestroy 只解绑与清引用（红线 4）。
 */

import { _decorator, Component, EventTouch, Graphics, Node, UITransform, Vec2, Vec3 } from 'cc';
import { hex } from '../../../common/ui/UITheme';
import { PAL } from './FridgeConfig';

const { ccclass } = _decorator;

const BASE_RADIUS = 60;
const KNOB_RADIUS = 26;
/** 死区：小于这个距离视为没推（设计像素） */
const DEAD_ZONE = 8;

@ccclass('FridgeJoystick')
export class FridgeJoystick extends Component {
    /** 推进方向，长度 0..1 */
    readonly direction: Vec2 = new Vec2(0, 0);

    /** 浏览器探针用 */
    _active = false;
    _touchId = -1;

    private _center = new Vec3();
    private _base: Node | null = null;
    private _knob: Node | null = null;
    private _tmpUi = new Vec3();
    private _tmpLocal = new Vec3();

    onLoad(): void {
        this._buildViews();
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
        this._base = null;
        this._knob = null;
        this.direction.set(0, 0);
        this._active = false;
        this._touchId = -1;
    }

    isActive(): boolean {
        return this._active;
    }

    release(): void {
        this._active = false;
        this._touchId = -1;
        this.direction.set(0, 0);
        if (this._base && this._base.isValid) this._base.active = false;
        if (this._knob && this._knob.isValid) this._knob.active = false;
    }

    // ==================== 触摸 ====================

    private onTouchStart(ev: EventTouch): void {
        if (this._touchId !== -1) return;
        const touch = ev.touch;
        if (!touch) return;
        this._touchId = touch.getID();
        this._toLocal(touch.getUILocation().x, touch.getUILocation().y, this._tmpLocal);
        this._center.set(this._tmpLocal);
        this._active = true;
        this.direction.set(0, 0);
        this._applyVisual(0, 0);
    }

    private onTouchMove(ev: EventTouch): void {
        const touch = ev.touch;
        if (!touch || touch.getID() !== this._touchId) return;
        this._toLocal(touch.getUILocation().x, touch.getUILocation().y, this._tmpLocal);
        const dx = this._tmpLocal.x - this._center.x;
        const dy = this._tmpLocal.y - this._center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= DEAD_ZONE) {
            this.direction.set(0, 0);
        } else {
            const scale = Math.min(1, dist / BASE_RADIUS) / dist;
            this.direction.set(dx * scale, dy * scale);
        }
        let kx = dx;
        let ky = dy;
        if (dist > BASE_RADIUS) {
            kx = (dx / dist) * BASE_RADIUS;
            ky = (dy / dist) * BASE_RADIUS;
        }
        this._applyVisual(kx, ky);
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

    private _applyVisual(offsetX: number, offsetY: number): void {
        if (this._base && this._base.isValid) {
            this._base.active = true;
            this._base.setPosition(this._center.x, this._center.y, 0);
        }
        if (this._knob && this._knob.isValid) {
            this._knob.active = true;
            this._knob.setPosition(this._center.x + offsetX, this._center.y + offsetY, 0);
        }
    }

    // ==================== 绘制 ====================

    private _buildViews(): void {
        this._base = this._makeCircleNode('JoystickBase', BASE_RADIUS, 0.14, 0.55);
        if (this._base) this._base.active = false;
        this._knob = this._makeCircleNode('JoystickKnob', KNOB_RADIUS, 0.42, 0.95);
        if (this._knob) this._knob.active = false;
    }

    private _makeCircleNode(name: string, radius: number, fillAlpha: number, strokeAlpha: number): Node | null {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(radius * 2, radius * 2);

        const g = node.addComponent(Graphics);
        const fill = hex(PAL.player, Math.round(fillAlpha * 255));
        const stroke = hex(PAL.player, Math.round(strokeAlpha * 255));
        g.fillColor = fill;
        g.circle(0, 0, radius);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = stroke;
        g.circle(0, 0, radius - 1.5);
        g.stroke();

        this.node.addChild(node);
        return node;
    }
}
