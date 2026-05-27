import { _decorator, Component, Node, Graphics, Color, UITransform } from 'cc';

const { ccclass, property } = _decorator;

const FOOD_COUNT_MIN = 20;
const FOOD_COUNT_MAX = 30;
const FOOD_RADIUS = 7;           // 光点半径
const FOOD_COLOR = new Color(57, 255, 20);    // #39FF14 荧光绿

@ccclass('FoodSpawner')
export class FoodSpawner extends Component {
    private _foodNodes: Node[] = [];
    private _gameArea: Node | null = null;
    private _halfW: number = 340;   // 游戏区域半宽
    private _halfH: number = 600;   // 游戏区域半高
    private _margin: number = 50;   // 光点不贴边

    public init(gameArea: Node): void {
        this._gameArea = gameArea;

        // 获取游戏区域尺寸
        const transform = gameArea.getComponent(UITransform);
        if (transform) {
            this._halfW = transform.width / 2;
            this._halfH = transform.height / 2;
        }

        // 初始填充光点
        this.refill();
    }

    /** 保持光点数量在范围内 */
    public refill(): void {
        while (this._foodNodes.length < FOOD_COUNT_MIN) {
            this.spawnOne();
        }
    }

    private spawnOne(): void {
        if (!this._gameArea) return;

        const x = (Math.random() - 0.5) * (this._halfW - this._margin) * 2;
        const y = (Math.random() - 0.5) * (this._halfH - this._margin) * 2;

        const node = new Node('food');
        node.setPosition(x, y, 0);

        // 用 Graphics 绘制绿色圆形光点
        const g = node.addComponent(Graphics);
        g.fillColor = FOOD_COLOR;
        g.circle(0, 0, FOOD_RADIUS);
        g.fill();

        node.setParent(this._gameArea);
        this._foodNodes.push(node);
    }

    /** 检测蛇头是否吃到光点，返回是否吃到了 */
    public checkEat(headWorldX: number, headWorldY: number, eatRadius: number): boolean {
        let ate = false;
        for (let i = this._foodNodes.length - 1; i >= 0; i--) {
            const food = this._foodNodes[i];
            const pos = food.position;
            const dx = headWorldX - pos.x;
            const dy = headWorldY - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < eatRadius + FOOD_RADIUS) {
                food.destroy();
                this._foodNodes.splice(i, 1);
                ate = true;
            }
        }

        this.refill();
        return ate;
    }

    /** 清理所有光点 */
    public clearAll(): void {
        for (const f of this._foodNodes) {
            f.destroy();
        }
        this._foodNodes = [];
    }
}
