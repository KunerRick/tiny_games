import { _decorator, Component, Node, Label, Sprite, Color, EventTouch, tween, Vec3 } from 'cc';
import { GameConfig } from '../../common/managers/GameConfig';

const { ccclass, property } = _decorator;

@ccclass('GameIcon')
export class GameIcon extends Component {
    @property(Label)
    nameLabel: Label | null = null;
    
    @property(Sprite)
    iconSprite: Sprite | null = null;
    
    @property(Node)
    bgNode: Node | null = null;
    
    private _gameConfig: GameConfig | null = null;
    private _onClickCallback: ((gameId: string) => void) | null = null;
    
    onLoad() {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }
    
    onDestroy() {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }
    
    setup(config: GameConfig, onClick: (gameId: string) => void) {
        this._gameConfig = config;
        this._onClickCallback = onClick;
        
        if (this.nameLabel) {
            this.nameLabel.string = config.name;
        }
        
        // Set default background color based on game id
        if (this.bgNode) {
            const colors = [
                new Color(255, 150, 150),
                new Color(150, 255, 150),
                new Color(150, 150, 255),
                new Color(255, 255, 150),
                new Color(255, 150, 255),
                new Color(150, 255, 255),
            ];
            const index = config.id.charCodeAt(0) % colors.length;
            const sprite = this.bgNode.getComponent(Sprite);
            if (sprite) {
                sprite.color = colors[index];
            }
        }
    }
    
    private onTouchStart(event: EventTouch) {
        // Scale down effect
        tween(this.node)
            .to(0.1, { scale: new Vec3(0.95, 0.95, 1) })
            .start();
    }
    
    private onTouchEnd(event: EventTouch) {
        // Scale back
        tween(this.node)
            .to(0.1, { scale: new Vec3(1, 1, 1) })
            .start();
        
        // Trigger click
        if (this._gameConfig && this._onClickCallback) {
            this._onClickCallback(this._gameConfig.id);
        }
    }
    
    private onTouchCancel(event: EventTouch) {
        // Scale back
        tween(this.node)
            .to(0.1, { scale: new Vec3(1, 1, 1) })
            .start();
    }
}
