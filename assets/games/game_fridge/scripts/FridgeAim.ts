/**
 * 冰箱底下 — 右半屏拖动瞄准（规格 §5.1）。
 *
 * - 按下滑动方向 = 瞄准方向；拖动距离超过阈值才进入「手动瞄准 + 持续开火」
 * - 松手回到自动瞄准最近敌人（核心内部兜底，本组件只负责给出方向）
 * - 只覆盖右半屏（360×1280），与左摇杆互不抢占；桌面拖拽结束派发 TOUCH_CANCEL，必须一起处理
 *
 * 约定：事件 handler 全部命名方法（红线 5）；onDestroy 只解绑与清引用（红线 4）。
 */

import { _decorator, Color, Component, EventTouch, Graphics, Node, UITransform, Vec2, Vec3 } from 'cc';
import { hex } from '../../../common/ui/UITheme';
import { PAL } from './FridgeConfig';

const { ccclass } = _decorator;

/** 进入瞄准的最小拖动距离（设计像素）。低于此值视为没拖，继续自动瞄准 */
const AIM_THRESHOLD = 10;
/** 瞄准摇杆视觉半径（设计像素） */
const AIM_RADIUS = 56;
const AIM_KNOB_RADIUS = 22;
const AIM_COLOR = hex(PAL.accent);

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

    /** 触屏反馈：底盘 / 摇杆头 / 方向箭头 */
    private _base: Node | null = null;
    private _knob: Node | null = null;
    private _arrow: Node | null = null;

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
        this.release();
        this._base = null;
        this._knob = null;
        this._arrow = null;
    }

    isFiring(): boolean {
        return this._firing;
    }

    release(): void {
        this._active = false;
        this._firing = false;
        this._touchId = -1;
        this.direction.set(0, 0);
        this._hideViews();
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
        this._showBase(this._start);
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
            this.direction.set(0, 0);
            this._updateVisual(dx, dy, dist);
            return;
        }
        this._firing = true;
        this.direction.set(dx / dist, dy / dist);
        this._updateVisual(dx, dy, dist);
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

    // ==================== 触屏反馈 ====================

    private _buildViews(): void {
        this._base = this._makeCircle('AimBase', AIM_RADIUS, 26, 140);
        this._arrow = this._makeArrow('AimArrow');
        this._knob = this._makeCircle('AimKnob', AIM_KNOB_RADIUS, 110, 235);
        this._hideViews();
    }

    /** 圆形底盘 / 摇杆头：fillAlpha / strokeAlpha 取 0–255 */
    private _makeCircle(name: string, radius: number, fillAlpha: number, strokeAlpha: number): Node {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(radius * 2, radius * 2);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(AIM_COLOR.r, AIM_COLOR.g, AIM_COLOR.b, fillAlpha);
        g.circle(0, 0, radius);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = new Color(AIM_COLOR.r, AIM_COLOR.g, AIM_COLOR.b, strokeAlpha);
        g.circle(0, 0, radius);
        g.stroke();
        this.node.addChild(node);
        return node;
    }

    /** 从底盘中心指向拖动方向的长箭头（默认朝 +Y，靠 angle 旋转） */
    private _makeArrow(name: string): Node {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(AIM_RADIUS * 2, AIM_RADIUS * 2);
        const g = node.addComponent(Graphics);
        g.lineWidth = 4;
        g.strokeColor = AIM_COLOR;
        g.moveTo(0, 0);
        g.lineTo(0, AIM_RADIUS - 10);
        g.stroke();
        g.fillColor = AIM_COLOR;
        g.moveTo(-9, AIM_RADIUS - 20);
        g.lineTo(9, AIM_RADIUS - 20);
        g.lineTo(0, AIM_RADIUS);
        g.close();
        g.fill();
        this.node.addChild(node);
        return node;
    }

    private _showBase(p: Vec3): void {
        if (this._base && this._base.isValid) {
            this._base.setPosition(p.x, p.y, 0);
            this._base.active = true;
        }
        if (this._knob && this._knob.isValid) {
            this._knob.setPosition(p.x, p.y, 0);
            this._knob.active = true;
        }
        if (this._arrow && this._arrow.isValid) this._arrow.active = false;
    }

    private _updateVisual(dx: number, dy: number, dist: number): void {
        if (dist <= 0) return;
        const nx = dx / dist;
        const ny = dy / dist;
        const reach = Math.min(dist, AIM_RADIUS);
        if (this._knob && this._knob.isValid) {
            this._knob.setPosition(this._start.x + nx * reach, this._start.y + ny * reach, 0);
        }
        if (this._arrow && this._arrow.isValid) {
            this._arrow.active = this._firing;
            if (this._firing) {
                this._arrow.setPosition(this._start.x, this._start.y, 0);
                this._arrow.angle = Math.atan2(dy, dx) * 180 / Math.PI - 90;
            }
        }
    }

    private _hideViews(): void {
        if (this._base && this._base.isValid) this._base.active = false;
        if (this._knob && this._knob.isValid) this._knob.active = false;
        if (this._arrow && this._arrow.isValid) this._arrow.active = false;
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
