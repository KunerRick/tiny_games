/**
 * 午夜幸存者 — 虚拟摇杆（触屏输入）。
 *
 * 规格 §4.8 / §5.1：移动端唯一的手势入口。桌面键盘（WASD / 方向键）只做调试输入，
 * 手机上没有键盘，没有这个组件就是一局都动不了。
 *
 * 设计取舍：
 *  - **按下处即摇杆中心**（动态底座）。固定左下角时，拇指要先去够那个圈，急走位时根本来不及；
 *    动态底座在整屏任意位置按下就能立刻推方向，是移动端幸存者类的常见做法。
 *  - **没有触摸时屏幕上什么都不画**：不常驻底座、不留提示环，纯触屏操作不遮挡画面。
 *  - 底座 / 摇杆头都在运行时用 `Graphics` 画，零图片资源（规格 §5.2）。
 *  - 只认第一根手指（`_touchId`），第二根手指不改变方向（避免双手误触乱走）。
 *
 * 约定：事件 handler 全部命名方法（红线 5）；`onDestroy()` 只解绑与清引用（红线 4）。
 */

import { _decorator, Component, EventTouch, Graphics, Node, UITransform, Vec2, Vec3 } from 'cc';
import { hex } from '../../../common/ui/UITheme';
import { COLORS } from './SurvivorConfig';

const { ccclass } = _decorator;

/** 底座半径（设计像素，规格 §5.1） */
const BASE_RADIUS = 60;
/** 摇杆头半径（设计像素，规格 §5.1） */
const KNOB_RADIUS = 26;
/** 死区：推杆小于这个距离视为「没推」，避免手指轻抖就移动 */
const DEAD_ZONE = 8;

@ccclass('SurvivorJoystick')
export class SurvivorJoystick extends Component {
    /** 当前推进方向，长度 0..1（归一化）；松手立即归零 */
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

    // ==================== 对外接口 ====================

    isActive(): boolean {
        return this._active;
    }

    /** 松手 / 取消时归零并隐藏；面板弹出、切后台也用它 */
    release(): void {
        this._active = false;
        this._touchId = -1;
        this.direction.set(0, 0);
        if (this._base && this._base.isValid) this._base.active = false;
        if (this._knob && this._knob.isValid) this._knob.active = false;
    }

    // ==================== 触摸 ====================

    private onTouchStart(ev: EventTouch): void {
        // 已经有手指在推杆，忽略后来的（多指不抢方向）
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
            // 推杆超过底座半径时按满幅输出，方向不变
            const scale = Math.min(1, dist / BASE_RADIUS) / dist;
            this.direction.set(dx * scale, dy * scale);
        }

        // 摇杆头跟随，夹在底座内
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

    /** 触摸点（UI 坐标）→ 本节点局部坐标 */
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
        const base = this._base;
        if (base && base.isValid) {
            base.active = true;
            base.setPosition(this._center.x, this._center.y, 0);
        }
        const knob = this._knob;
        if (knob && knob.isValid) {
            knob.active = true;
            knob.setPosition(this._center.x + offsetX, this._center.y + offsetY, 0);
        }
    }

    // ==================== 绘制 ====================

    private _buildViews(): void {
        this._base = this._makeCircleNode('JoystickBase', BASE_RADIUS, 0.14, 0.55, true);
        if (this._base) this._base.active = false;

        this._knob = this._makeCircleNode('JoystickKnob', KNOB_RADIUS, 0.42, 0.95, true);
        if (this._knob) this._knob.active = false;
    }

    private _makeCircleNode(name: string, radius: number, fillAlpha: number, strokeAlpha: number, thick: boolean): Node | null {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(radius * 2, radius * 2);

        const g = node.addComponent(Graphics);
        const fill = hex(COLORS.player, Math.round(fillAlpha * 255));
        const stroke = hex(COLORS.player, Math.round(strokeAlpha * 255));
        g.fillColor = fill;
        g.circle(0, 0, radius);
        g.fill();
        g.lineWidth = thick ? 3 : 2;
        g.strokeColor = stroke;
        g.circle(0, 0, radius - 1.5);
        g.stroke();

        this.node.addChild(node);
        return node;
    }
}
