import {
    _decorator,
    Component,
    Node,
    Label,
    Sprite,
    Color,
    EventTouch,
    Graphics,
    UITransform,
    tween,
    Vec3,
} from 'cc';
import { GameConfig, GAME_LIST } from '../../common/managers/GameConfig';
import { drawGameIconCard, drawGameIconShape } from './GameIconArt';

const { ccclass, property } = _decorator;

/** 卡片文字的中心 y（卡片高 180，文字落在卡片内底部） */
const LABEL_Y = -58;

/** 卡片文字色：浅色卡片底上用墨色，比白字 + 深描边更干净 */
const LABEL_COLOR = new Color(43, 53, 80, 255);

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
    private _art: Graphics | null = null;
    private _shape: Graphics | null = null;
    
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
        label.color = LABEL_COLOR;
        label.enableOutline = false;
    }

    /**
     * 卡片底色按游戏在 GAME_LIST 里的序号取色（不是哈希）。
     * 哈希会让相邻卡片撞成同一种颜色（实测一排里出现两张粉卡），
     * 按序号轮转可以保证网格里相邻三张颜色不同。
     */
    private cardColor(gameId: string): Color {
        const index = GAME_LIST.findIndex((g) => g.id === gameId);
        const slot = index >= 0 ? index : 0;
        return CARD_COLORS[slot % CARD_COLORS.length];
    }

    /**
     * 用 Graphics 现画卡片底 + 专属图标。
     * 预制体里的 Sprite 只是一张通用占位图（18 个游戏长得一模一样），
     * 这里把它关掉，改画每个游戏各自的图形。
     *
     * 底板与图标分成两层（试玩报告 §3.1：三列缩略图里的图形偏小、辨识慢）：
     * 图标层整体放大 14%，底板保持原尺寸，因此不会撑破卡片或压到相邻卡片，
     * 也不需要改网格布局与预制体。
     */
    private applyCardColor(gameId: string): void {
        const sprite = this.node.getComponent(Sprite);
        if (sprite) sprite.enabled = false;

        if (!this._art) {
            const artNode = new Node('Art');
            artNode.layer = this.node.layer;
            this.node.addChild(artNode);
            // 图标垫在名称文字下面
            artNode.setSiblingIndex(0);
            const ut = artNode.addComponent(UITransform);
            ut.setContentSize(150, 180);
            this._art = artNode.addComponent(Graphics);
        }

        if (!this._shape) {
            const shapeNode = new Node('Shape');
            shapeNode.layer = this.node.layer;
            this.node.addChild(shapeNode);
            shapeNode.setSiblingIndex(1);
            const ut = shapeNode.addComponent(UITransform);
            ut.setContentSize(150, 180);
            shapeNode.setScale(1.14, 1.14, 1);
            this._shape = shapeNode.addComponent(Graphics);
        }

        const color = this.cardColor(gameId);
        drawGameIconCard(this._art, color);
        drawGameIconShape(this._shape, gameId);
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
