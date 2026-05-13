import { _decorator, Component, Node, EventTouch, Vec2 } from 'cc';
import { Direction } from './GameConfig';

const { ccclass, property } = _decorator;

const SWIPE_THRESHOLD = 50;

@ccclass('InputHandler')
export class InputHandler extends Component {
    private _startPos: Vec2 = new Vec2();
    private _onDirectionInput: ((direction: Direction) => void) | null = null;
    
    onLoad() {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    }
    
    onDestroy() {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    }
    
    setCallback(callback: (direction: Direction) => void): void {
        this._onDirectionInput = callback;
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
