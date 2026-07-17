import { _decorator, Component, Node, EventTouch, EventKeyboard, KeyCode, Vec2, systemEvent, SystemEvent } from 'cc';
import { Direction } from './GameConfig';

const { ccclass, property } = _decorator;

const SWIPE_THRESHOLD = 50;

const KEY_MAP: Record<number, Direction> = {
    [KeyCode.ARROW_UP]: Direction.UP,
    [KeyCode.ARROW_DOWN]: Direction.DOWN,
    [KeyCode.ARROW_LEFT]: Direction.LEFT,
    [KeyCode.ARROW_RIGHT]: Direction.RIGHT,
    // WASD 键码（Cocos KeyCode 枚举未暴露 W/S/A/D）
    87: Direction.UP,
    83: Direction.DOWN,
    65: Direction.LEFT,
    68: Direction.RIGHT,
};

@ccclass('InputHandler')
export class InputHandler extends Component {
    private _startPos: Vec2 = new Vec2();
    private _onDirectionInput: ((direction: Direction) => void) | null = null;
    
    onLoad() {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        // 键盘方向键 / WASD 支持（全局监听，不依赖节点焦点）
        systemEvent.on(SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
    }
    
    onDestroy() {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        systemEvent.off(SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
    }
    
    setCallback(callback: (direction: Direction) => void): void {
        this._onDirectionInput = callback;
    }
    
    private onKeyDown(event: EventKeyboard): void {
        const direction = KEY_MAP[event.keyCode];
        if (direction !== undefined) {
            event.propagationStopped = true;
            this._onDirectionInput?.(direction);
        }
    }
    
    private onTouchStart(event: EventTouch): void {
        this._startPos = event.getLocation();
    }
    
    private onTouchEnd(event: EventTouch): void {
        const endPos = event.getLocation();
        const deltaX = endPos.x - this._startPos.x;
        const deltaY = endPos.y - this._startPos.y;
        
        // 判断滑动方向
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            // 水平滑动
            if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
                const direction = deltaX > 0 ? Direction.RIGHT : Direction.LEFT;
                this._onDirectionInput?.(direction);
            }
        } else {
            // 垂直滑动
            if (Math.abs(deltaY) > SWIPE_THRESHOLD) {
                const direction = deltaY > 0 ? Direction.UP : Direction.DOWN;
                this._onDirectionInput?.(direction);
            }
        }
    }
}
