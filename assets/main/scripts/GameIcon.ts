import { _decorator, Component, Node, Label, Sprite, Color, EventTouch, tween, Vec3 } from 'cc';
import { GameConfig } from '../../common/managers/GameConfig';

const { ccclass, property } = _decorator;

/** 卡片文字的中心 y（卡片高 180，文字落在卡片内底部） */
const LABEL_Y = -58;

/** 卡片文字的描边色：浅色底 + 深色描边，避免文字和图标糊在一起 */
const OUTLINE_COLOR = new Color(45, 52, 70, 255);

/** 卡片底色（浅色系，配深色图标剪影）；按 id 哈希取色，相邻卡片尽量不同色 */
const CARD_COLORS = [
    new Color(255, 180, 162),
    new Color(255, 215, 154),
    new Color(199, 233, 160),
    new Color(168, 230, 207),
    new Color(168, 216, 240),
    new Color(184, 196, 255),
    new Color(214, 184, 240),
    new Color(255, 180, 210),
];

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

        this.applyNameLabel(config.name);
        this.applyCardColor(config.id);
    }

    /**
     * 卡片文字统一收进卡片内底部。
     * 预制体里的 nameLabel 原本挂在卡片下方（y = -120.218），一行字会顶到下一行卡片的图标上，
     * 而 MCP 的 prefab_update_prefab 在本机只改内存、不落盘（prefab 文件 mtime 不变），
     * 所以在运行时收敛一次，保证预制体数据哪怕是旧的也不会重叠。
     */
    private applyNameLabel(name: string): void {
        const label = this.nameLabel;
        if (!label || !label.isValid) return;

        label.string = name;
        const labelNode = label.node;
        if (labelNode && labelNode.isValid) {
            labelNode.setPosition(0, LABEL_Y, 0);
        }
        label.fontSize = 24;
        label.lineHeight = 26;
        label.enableOutline = true;
        label.outlineColor = OUTLINE_COLOR;
        label.outlineWidth = 2;
    }

    /** 卡片底色按游戏 id 取色；用整串 id 求和，避免只按首字母取色导致大片同色 */
    private applyCardColor(gameId: string): void {
        const bg = this.bgNode;
        if (!bg || !bg.isValid) return;

        let hash = 0;
        for (let i = 0; i < gameId.length; i++) {
            hash = (hash * 31 + gameId.charCodeAt(i)) & 0x7fffffff;
        }
        const sprite = bg.getComponent(Sprite);
        if (sprite) {
            sprite.color = CARD_COLORS[hash % CARD_COLORS.length];
        }
    }
    
    private onTouchStart(event: EventTouch) {
        // Scale down effect
        if (!this.node?.isValid) return;
        tween(this.node)
            .to(0.1, { scale: new Vec3(0.95, 0.95, 1) })
            .start();
    }
    
    private onTouchEnd(event: EventTouch) {
        // Scale back
        if (this.node?.isValid) {
            tween(this.node)
                .to(0.1, { scale: new Vec3(1, 1, 1) })
                .start();
        }

        // Trigger click
        if (this._gameConfig && this._onClickCallback) {
            this._onClickCallback(this._gameConfig.id);
        }
    }
    
    private onTouchCancel(event: EventTouch) {
        // Scale back
        if (!this.node?.isValid) return;
        tween(this.node)
            .to(0.1, { scale: new Vec3(1, 1, 1) })
            .start();
    }
}
