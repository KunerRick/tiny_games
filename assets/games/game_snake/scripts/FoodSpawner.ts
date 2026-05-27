import { _decorator, Component, Node, Graphics, Color, UITransform } from 'cc';

const { ccclass, property } = _decorator;

const FOOD_COUNT_MIN = 20;
const FOOD_COUNT_MAX = 30;

// 食物类型定义
export enum FoodType {
    NORMAL = 0,   // 普通
    GOLD = 1,     // 金色
    RAINBOW = 2,  // 彩虹
}

export interface FoodData {
    node: Node;
    type: FoodType;
    value: number;
}

// 食物配置
const FOOD_CONFIG: Record<FoodType, { color: Color; value: number; radius: number; probability: number }> = {
    [FoodType.NORMAL]: {
        color: new Color(57, 255, 20),    // #39FF14 荧光绿
        value: 10,
        radius: 7,
        probability: 0.7,                  // 70% 概率
    },
    [FoodType.GOLD]: {
        color: new Color(255, 215, 0),    // #FFD700 金色
        value: 30,
        radius: 8,
        probability: 0.2,                  // 20% 概率
    },
    [FoodType.RAINBOW]: {
        color: new Color(255, 0, 128),    // #FF0080 粉红（彩虹色用渐变实现）
        value: 50,
        radius: 9,
        probability: 0.1,                  // 10% 概率
    },
};

@ccclass('FoodSpawner')
export class FoodSpawner extends Component {
    private _foodItems: FoodData[] = [];
    private _gameArea: Node | null = null;
    private _halfW: number = 340;
    private _halfH: number = 600;
    private _margin: number = 50;

    public init(gameArea: Node): void {
        this._gameArea = gameArea;

        const transform = gameArea.getComponent(UITransform);
        if (transform) {
            this._halfW = transform.width / 2;
            this._halfH = transform.height / 2;
        }

        this.refill();
    }

    /** 随机选择食物类型 */
    private _randomFoodType(): FoodType {
        const rand = Math.random();
        let cumulative = 0;

        for (let type = FoodType.NORMAL; type <= FoodType.RAINBOW; type++) {
            cumulative += FOOD_CONFIG[type].probability;
            if (rand < cumulative) {
                return type;
            }
        }

        return FoodType.NORMAL;
    }

    /** 保持光点数量在范围内 */
    public refill(): void {
        while (this._foodItems.length < FOOD_COUNT_MIN) {
            this.spawnOne();
        }
    }

    private spawnOne(): void {
        if (!this._gameArea) return;

        const x = (Math.random() - 0.5) * (this._halfW - this._margin) * 2;
        const y = (Math.random() - 0.5) * (this._halfH - this._margin) * 2;

        const type = this._randomFoodType();
        const config = FOOD_CONFIG[type];

        const node = new Node(`food_${FoodType[type]}`);
        node.setPosition(x, y, 0);

        const g = node.addComponent(Graphics);

        if (type === FoodType.RAINBOW) {
            // 彩虹食物用多层圆环实现渐变效果
            this._drawRainbowFood(g, config.radius);
        } else {
            g.fillColor = config.color;
            g.circle(0, 0, config.radius);
            g.fill();

            // 添加光晕效果
            g.fillColor = new Color(config.color.r, config.color.g, config.color.b, 60);
            g.circle(0, 0, config.radius + 3);
            g.fill();
        }

        node.setParent(this._gameArea);
        this._foodItems.push({ node, type, value: config.value });
    }

    /** 绘制彩虹食物 */
    private _drawRainbowFood(g: Graphics, radius: number): void {
        const colors = [
            new Color(255, 0, 0),      // 红
            new Color(255, 165, 0),    // 橙
            new Color(255, 255, 0),    // 黄
            new Color(0, 255, 0),      // 绿
            new Color(0, 127, 255),    // 蓝
            new Color(0, 0, 255),      // 靛
            new Color(139, 0, 255),    // 紫
        ];

        const stepRadius = radius / colors.length;
        for (let i = colors.length - 1; i >= 0; i--) {
            g.fillColor = colors[i];
            g.circle(0, 0, stepRadius * (i + 1));
            g.fill();
        }
    }

    /** 检测蛇头是否吃到光点，返回吃到的食物数据 */
    public checkEat(headWorldX: number, headWorldY: number, eatRadius: number): { ate: boolean; value: number } {
        let ate = false;
        let totalValue = 0;

        for (let i = this._foodItems.length - 1; i >= 0; i--) {
            const food = this._foodItems[i];
            const pos = food.node.position;
            const config = FOOD_CONFIG[food.type];
            const dx = headWorldX - pos.x;
            const dy = headWorldY - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < eatRadius + config.radius) {
                food.node.destroy();
                this._foodItems.splice(i, 1);
                ate = true;
                totalValue += food.value;
            }
        }

        this.refill();
        return { ate, value: totalValue };
    }

    /** 清理所有光点 */
    public clearAll(): void {
        for (const food of this._foodItems) {
            if (food.node && food.node.isValid) {
                food.node.destroy();
            }
        }
        this._foodItems = [];
    }
}
