import { _decorator, Component, Node, Vec2, Vec3, EventTouch, Graphics, Color } from 'cc';

const { ccclass, property } = _decorator;

const JOYSTICK_RADIUS = 60;      // 大圈半径
const BUTTON_RADIUS = 25;        // 小圈半径
const TRIGGER_THRESHOLD = 10;    // 触发阈值

export enum JoystickState {
    IDLE = 0,
    ACTIVE = 1,
}

@ccclass('Joystick')
export class Joystick extends Component {
    // ========== 节点引用 ==========
    @property(Node)
    baseNode: Node | null = null;       // 大圈底座

    @property(Node)
    buttonNode: Node | null = null;     // 小圈按钮

    // ========== 状态 ==========
    private _state: JoystickState = JoystickState.IDLE;
    private _centerPos: Vec3 = new Vec3();      // 摇杆中心位置（世界坐标）
    private _touchId: number = -1;              // 当前触摸点 ID，-1 表示无触摸
    private _direction: Vec2 = new Vec2(0, 0);  // 归一化方向向量
    private _angle: number = 0;                 // 角度（弧度）

    // 回调
    public onDirectionChange: ((angle: number) => void) | null = null;
    public onActive: (() => void) | null = null;
    public onRelease: (() => void) | null = null;

    onLoad() {
        this._initGraphics();
        this._hideJoystick();
    }

    private _initGraphics(): void {
        // 初始化大圈 Graphics
        if (this.baseNode && !this.baseNode.getComponent(Graphics)) {
            const baseG = this.baseNode.addComponent(Graphics);
            baseG.fillColor = new Color(255, 255, 255, 80);
            baseG.strokeColor = new Color(255, 255, 255, 120);
            baseG.lineWidth = 2;
            baseG.circle(0, 0, JOYSTICK_RADIUS);
            baseG.fill();
            baseG.stroke();
        }

        // 初始化小圈 Graphics
        if (this.buttonNode && !this.buttonNode.getComponent(Graphics)) {
            const btnG = this.buttonNode.addComponent(Graphics);
            btnG.fillColor = new Color(255, 255, 255, 180);
            btnG.circle(0, 0, BUTTON_RADIUS);
            btnG.fill();
        }
    }

    private _showJoystick(worldPos: Vec3): void {
        this._state = JoystickState.ACTIVE;
        this._centerPos.set(worldPos);

        if (this.baseNode) {
            this.baseNode.active = true;
            this.baseNode.setWorldPosition(worldPos);
        }

        if (this.buttonNode) {
            this.buttonNode.active = true;
            this.buttonNode.setWorldPosition(worldPos);
        }

        this._direction.set(0, 0);
        this._angle = 0;
        this.onActive?.();
    }

    private _hideJoystick(): void {
        this._state = JoystickState.IDLE;
        this._touchId = -1;

        if (this.baseNode) {
            this.baseNode.active = false;
        }

        if (this.buttonNode) {
            this.buttonNode.active = false;
        }

        this._direction.set(0, 0);
        this.onRelease?.();
    }

    private _updateJoystick(touchWorldPos: Vec3): void {
        if (this._state !== JoystickState.ACTIVE) return;

        // 计算偏移
        const dx = touchWorldPos.x - this._centerPos.x;
        const dy = touchWorldPos.y - this._centerPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // 计算角度
        this._angle = Math.atan2(dy, dx);

        // 限制按钮在大圈内
        let btnX = dx;
        let btnY = dy;
        if (distance > JOYSTICK_RADIUS) {
            const ratio = JOYSTICK_RADIUS / distance;
            btnX = dx * ratio;
            btnY = dy * ratio;
        }

        // 更新按钮位置
        if (this.buttonNode) {
            this.buttonNode.setWorldPosition(
                this._centerPos.x + btnX,
                this._centerPos.y + btnY,
                0
            );
        }

        // 更新方向（只有移动超过阈值才触发）
        if (distance > TRIGGER_THRESHOLD) {
            this._direction.set(dx / distance, dy / distance);
            this.onDirectionChange?.(this._angle);
        }
    }

    // ========== 公共接口 ==========

    /**
     * 处理触摸开始事件
     * @param event 触摸事件
     * @returns 是否消费了此事件
     */
    public onTouchStart(event: EventTouch): boolean {
        // 如果已经有触摸点，忽略新的触摸
        if (this._touchId !== -1) return false;

        const touch = event.touch;
        if (!touch) return false;

        this._touchId = touch.getID();
        const uiPos = touch.getUILocation();
        const worldPos = new Vec3(uiPos.x, uiPos.y, 0);

        this._showJoystick(worldPos);
        return true;
    }

    /**
     * 处理触摸移动事件
     */
    public onTouchMove(event: EventTouch): void {
        const touch = event.touch;
        if (!touch || touch.getID() !== this._touchId) return;

        const uiPos = touch.getUILocation();
        const worldPos = new Vec3(uiPos.x, uiPos.y, 0);
        this._updateJoystick(worldPos);
    }

    /**
     * 处理触摸结束事件
     */
    public onTouchEnd(event: EventTouch): void {
        const touch = event.touch;
        if (!touch || touch.getID() !== this._touchId) return;

        this._hideJoystick();
    }

    /**
     * 处理触摸取消事件
     */
    public onTouchCancel(event: EventTouch): void {
        const touch = event.touch;
        if (!touch || touch.getID() !== this._touchId) return;

        this._hideJoystick();
    }

    /**
     * 获取当前方向角度
     */
    public getAngle(): number {
        return this._angle;
    }

    /**
     * 获取当前方向向量
     */
    public getDirection(): Vec2 {
        return this._direction.clone();
    }

    /**
     * 获取摇杆状态
     */
    public getState(): JoystickState {
        return this._state;
    }

    /**
     * 是否正在激活状态
     */
    public isActive(): boolean {
        return this._state === JoystickState.ACTIVE;
    }
}
