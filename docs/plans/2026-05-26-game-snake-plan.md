# 贪吃蛇（平滑移动版）实现计划

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task.

**Goal:** 在 Cocos Creator 中实现单人贪吃蛇（大作战风格），蛇碰墙死、碰自己不死、吃光点长大

**Architecture:** SnakeGame 为总控，Snake 管理蛇头移动 + 路径历史 + 身体绘制，FoodSpawner 管理光点生成与碰撞

**Tech Stack:** Cocos Creator 3.x, TypeScript

---

### Task 1: 创建项目目录和文件骨架

**Objective:** 创建贪吃蛇游戏所需的目录结构和文件骨架

**Files:**
- Create: `assets/games/game_snake/`
- Create: `assets/games/game_snake/scripts/`
- Create: `assets/games/game_snake/scripts/SnakeGame.ts`
- Create: `assets/games/game_snake/scripts/Snake.ts`
- Create: `assets/games/game_snake/scripts/FoodSpawner.ts`

**Step 1: 创建目录**

```bash
mkdir -p ~/git/tiny_games/assets/games/game_snake/scripts
```

**Step 2: 创建 SnakeGame.ts 骨架**

```typescript
import { _decorator, Component, Node, Button, Label, EventTouch, UITransform, Size, Vec3 } from 'cc';
import { Snake } from './Snake';
import { FoodSpawner } from './FoodSpawner';

const { ccclass, property } = _decorator;

@ccclass('SnakeGame')
export class SnakeGame extends Component {
    @property(Node)
    gameArea: Node | null = null;          // 游戏区域（蛇和食物的容器）

    @property(Label)
    scoreLabel: Label | null = null;       // 计分标签

    @property(Node)
    gameOverNode: Node | null = null;      // 游戏结束面板

    @property(Button)
    restartBtn: Button | null = null;     // 重新开始按钮
}
```

**Step 3: 创建 Snake.ts 骨架**

```typescript
import { _decorator, Component, Node, Vec2 } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('Snake')
export class Snake extends Component {
    // 蛇由一段段色块节点组成，头在索引 0
    private _segments: Node[] = [];
    private _direction: Vec2 = new Vec2(1, 0);    // 当前前进方向
    private _targetAngle: number = 0;               // 目标角度（来自触屏）
    private _currentAngle: number = 0;               // 当前实际角度（平滑转向）
}
```

**Step 4: 创建 FoodSpawner.ts 骨架**

```typescript
import { _decorator, Component, Node } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('FoodSpawner')
export class FoodSpawner extends Component {
    private _foodNodes: Node[] = [];
    private _gameArea: Node | null = null;
}
```

**Step 5: 验证**

```bash
ls -la ~/git/tiny_games/assets/games/game_snake/scripts/
```
Expected: 3 .ts 文件存在

---

### Task 2: 实现 FoodSpawner.ts — 光点生成

**Objective:** 光点管理：在地图随机位置生成圆形色块，保持 20-30 个，提供碰撞检测

**Files:**
- Modify: `assets/games/game_snake/scripts/FoodSpawner.ts`

**Step 1: 实现完整 FoodSpawner**

```typescript
import { _decorator, Component, Node, Sprite, Color, Vec2, CircleCollider2D, Collider2D, PhysicsSystem2D, v2, EventTypes } from 'cc';
import { UITransform } from 'cc';

const { ccclass, property } = _decorator;

const FOOD_COUNT_MIN = 20;
const FOOD_COUNT_MAX = 30;
const FOOD_RADIUS = 8;
const FOOD_COLOR = new Color(100, 255, 100);  // 亮绿色

@ccclass('FoodSpawner')
export class FoodSpawner extends Component {
    private _foodNodes: Node[] = [];
    private _gameArea: Node | null = null;
    private _areaWidth: number = 0;
    private _areaHeight: number = 0;
    private _margin: number = 40;  // 光点不贴边

    public init(gameArea: Node): void {
        this._gameArea = gameArea;

        // 获取游戏区域尺寸
        const uiTransform = gameArea.getComponent(UITransform);
        if (uiTransform) {
            this._areaWidth = uiTransform.width;
            this._areaHeight = uiTransform.height;
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

        const x = (Math.random() - 0.5) * (this._areaWidth - this._margin * 2);
        const y = (Math.random() - 0.5) * (this._areaHeight - this._margin * 2);

        const node = new Node('food');
        node.setPosition(x, y, 0);

        const sprite = node.addComponent(Sprite);
        sprite.color = FOOD_COLOR;
        // 使用圆形色块 — 用 Sprite 的圆形渲染或简单方块
        // 这里用方块加足够圆角，或者直接创建小色块
        const transform = node.addComponent(UITransform);
        transform.setContentSize(FOOD_RADIUS * 2, FOOD_RADIUS * 2);

        // 可选：加圆形碰撞体用于精确碰撞（如果 Cocos 版本支持）
        // 这里我们使用距离检测，所以不需要碰撞体

        node.setParent(this._gameArea);
        this._foodNodes.push(node);
    }

    /** 检测蛇头是否吃到光点，返回吃到的数量 */
    public checkEat(headPos: Vec2, eatRadius: number): boolean {
        let ate = false;
        for (let i = this._foodNodes.length - 1; i >= 0; i--) {
            const food = this._foodNodes[i];
            const foodPos = food.position;
            const dx = headPos.x - foodPos.x;
            const dy = headPos.y - foodPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < eatRadius + FOOD_RADIUS) {
                // 吃掉
                food.destroy();
                this._foodNodes.splice(i, 1);
                ate = true;
            }
        }

        // 补充光点
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
```

**Step 2: 验证** — 语法检查

```bash
cd ~/git/tiny_games && npx tsc --noEmit --strict assets/games/game_snake/scripts/FoodSpawner.ts 2>&1 || echo "Use Cocos built-in compile"
```

Note: Cocos Creator 项目用 Creator 自己编译，TS 检查在编辑器中触发。这里仅确认文件存在且内容完整。

---

### Task 3: 实现 Snake.ts — 蛇的移动与绘制

**Objective:** 蛇的平滑移动：路径历史队列 + 蛇头转向 + 身体绘制 + 生长

**Files:**
- Modify: `assets/games/game_snake/scripts/Snake.ts`

**Step 1: 实现完整 Snake**

```typescript
import { _decorator, Component, Node, Sprite, Color, Vec2, Vec3, UITransform } from 'cc';

const { ccclass, property } = _decorator;

const SEGMENT_SIZE = 14;          // 每段身体正方形的边长
const SEGMENT_GAP = 6;            // 每段之间的间隔（路径点间距）
const TURN_SPEED = 6.0;           // 转向速度（弧度/秒）
const HEAD_COLOR = new Color(68, 180, 255);     // 蛇头蓝色
const BODY_COLOR = new Color(50, 140, 220);     // 蛇身深蓝
const INITIAL_LENGTH = 5;         // 初始长度（段数）
const EAT_GROW_STEP = 3;          // 每吃 N 个光点增长一段

@ccclass('Snake')
export class Snake extends Component {
    // 蛇头节点
    private _headNode: Node | null = null;

    // 蛇身段节点（不含头）
    private _bodyNodes: Node[] = [];

    // 路径历史队列：每帧记录蛇头位置 Vec3
    private _pathHistory: Vec3[] = [];

    // 当前实际段数（含头）
    private _currentSegments: number = INITIAL_LENGTH;

    // 运动状态
    private _direction: Vec2 = new Vec2(1, 0);
    private _currentAngle: number = 0;       // 当前朝向角度（弧度）
    private _targetAngle: number = 0;         // 目标角度（从触屏来）
    private _speed: number = 150;             // 像素/秒
    private _gameArea: Node | null = null;
    private _areaWidth: number = 720;
    private _areaHeight: number = 1280;
    private _margin: number = 20;             // 死亡边界内缩

    // 吃光点击杀计数器（每吃 EAT_GROW_STEP 个长一段）
    private _eatCounter: number = 0;
    private _isDead: boolean = false;

    // 回调
    public onEat: (() => void) | null = null;
    public onDeath: (() => void) | null = null;

    public init(gameArea: Node, startPos: Vec3): void {
        this._gameArea = gameArea;
        this._currentSegments = INITIAL_LENGTH;
        this._eatCounter = 0;
        this._isDead = false;
        this._direction = new Vec2(1, 0);
        this._currentAngle = 0;
        this._targetAngle = 0;
        this._pathHistory = [];
        this._speed = 150;

        // 获取游戏区域尺寸
        // 游戏区域默认和 Canvas 设计尺寸一致
        this._areaWidth = 720;
        this._areaHeight = 1280;

        // 清理旧节点
        this.clearNodes();

        // 创建蛇头
        this._headNode = new Node('snakeHead');
        const headSprite = this._headNode.addComponent(Sprite);
        headSprite.color = HEAD_COLOR;
        const headTransform = this._headNode.addComponent(UITransform);
        headTransform.setContentSize(SEGMENT_SIZE, SEGMENT_SIZE);
        this._headNode.setPosition(startPos.x, startPos.y, 0);
        this._headNode.setParent(gameArea);

        // 初始路径：蛇头位置重复填充
        for (let i = 0; i < this._currentSegments * SEGMENT_GAP + 10; i++) {
            this._pathHistory.push(new Vec3(startPos.x, startPos.y, 0));
        }

        // 初始身体段
        this.rebuildBody();
    }

    /** 设置目标角度（由 SnakeGame 触屏事件设置） */
    public setTargetAngle(angle: number): void {
        this._targetAngle = angle;
    }

    /** 每帧更新 */
    public tick(dt: number): void {
        if (this._isDead || !this._headNode) return;

        // 1. 平滑转向
        let diff = this._targetAngle - this._currentAngle;
        // 归一化到 [-PI, PI]
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const maxTurn = TURN_SPEED * dt;
        if (Math.abs(diff) > maxTurn) {
            diff = Math.sign(diff) * maxTurn;
        }
        this._currentAngle += diff;

        // 2. 蛇头前进
        const dx = Math.cos(this._currentAngle) * this._speed * dt;
        const dy = Math.sin(this._currentAngle) * this._speed * dt;

        const headPos = this._headNode.position;
        const newX = headPos.x + dx;
        const newY = headPos.y + dy;

        // 3. 碰撞检测：撞墙
        const halfMargin = this._margin;
        const halfW = this._areaWidth / 2;
        const halfH = this._areaHeight / 2;

        if (newX < -halfW + halfMargin || newX > halfW - halfMargin ||
            newY < -halfH + halfMargin || newY > halfH - halfMargin) {
            this.die();
            return;
        }

        // 4. 更新蛇头位置
        this._headNode.setPosition(newX, newY, 0);

        // 5. 记录路径
        this._pathHistory.push(new Vec3(newX, newY, 0));

        // 6. 更新身体（从路径历史取点）
        this.updateBody();
    }

    /** 更新蛇身段位置 */
    private updateBody(): void {
        const totalSegments = this._currentSegments - 1; // 头已经算了一段

        // 确保身体节点数量足够
        while (this._bodyNodes.length < totalSegments) {
            const bodyNode = new Node('snakeBody');
            const bodySprite = bodyNode.addComponent(Sprite);
            bodySprite.color = BODY_COLOR;
            const bodyTransform = bodyNode.addComponent(UITransform);
            bodyTransform.setContentSize(SEGMENT_SIZE, SEGMENT_SIZE);
            bodyNode.setParent(this._gameArea!);
            this._bodyNodes.push(bodyNode);
        }
        // 如果身体节点太多，隐藏或移除
        while (this._bodyNodes.length > totalSegments) {
            const node = this._bodyNodes.pop()!;
            node.destroy();
        }

        // 从路径历史中取每段的位置
        // 第 i 段身体 = 从末尾往前数 (i+1) * SEGMENT_GAP 个路径点
        for (let i = 0; i < totalSegments; i++) {
            const idx = this._pathHistory.length - 1 - (i + 1) * SEGMENT_GAP;
            if (idx >= 0 && idx < this._pathHistory.length) {
                const pos = this._pathHistory[idx];
                this._bodyNodes[i].setPosition(pos.x, pos.y, 0);
            }
        }

        // 限制路径历史长度（避免无限增长）
        const maxHistory = (this._currentSegments + 10) * SEGMENT_GAP;
        while (this._pathHistory.length > maxHistory) {
            this._pathHistory.shift();
        }
    }

    /** 重建身体节点（初始化/重置时调用） */
    private rebuildBody(): void {
        // 清理旧身体节点
        for (const b of this._bodyNodes) b.destroy();
        this._bodyNodes = [];
        this.updateBody();
    }

    /** 获取蛇头位置 */
    public getHeadPosition(): Vec3 {
        if (this._headNode) {
            return this._headNode.position.clone();
        }
        return new Vec3(0, 0, 0);
    }

    /** 获取蛇头位置 Vec2 方便碰撞检测 */
    public getHeadPos2(): Vec2 {
        const p = this.getHeadPosition();
        return new Vec2(p.x, p.y);
    }

    /** 蛇头半径（用于碰撞检测） */
    public getHeadRadius(): number {
        return SEGMENT_SIZE / 2;
    }

    /** 吃光点 */
    public grow(): void {
        this._eatCounter++;
        if (this._eatCounter >= EAT_GROW_STEP) {
            this._currentSegments++;
            this._eatCounter = 0;
            // 增长速度（每 5 段加速度稍微提升）
            this._speed = Math.min(this._speed + 2, 220);
        }
        this.onEat?.();
    }

    /** 死亡 */
    private die(): void {
        this._isDead = true;
        this.onDeath?.();
    }

    public isDead(): boolean {
        return this._isDead;
    }

    public getLength(): number {
        return this._currentSegments;
    }

    /** 清理所有节点 */
    private clearNodes(): void {
        if (this._headNode) {
            this._headNode.destroy();
            this._headNode = null;
        }
        for (const b of this._bodyNodes) b.destroy();
        this._bodyNodes = [];
        this._pathHistory = [];
    }

    public destroyAll(): void {
        this.clearNodes();
    }
}
```

**Step 2: 验证文件完整性**

```bash
wc -l ~/git/tiny_games/assets/games/game_snake/scripts/Snake.ts
```
Expected: ~200 lines

---

### Task 4: 实现 SnakeGame.ts — 主控制器

**Objective:** 游戏主循环、触屏事件绑定、光点碰撞转发、游戏结束/重新开始

**Files:**
- Modify: `assets/games/game_snake/scripts/SnakeGame.ts`

**Step 1: 实现完整 SnakeGame.ts**

```typescript
import { _decorator, Component, Node, Button, Label, EventTouch, UITransform, Vec3, Vec2, input, Input } from 'cc';
import { Snake } from './Snake';
import { FoodSpawner } from './FoodSpawner';

const { ccclass, property } = _decorator;

@ccclass('SnakeGame')
export class SnakeGame extends Component {
    @property(Node)
    gameArea: Node | null = null;          // 游戏区域（蛇和食物的容器）

    @property(Label)
    scoreLabel: Label | null = null;       // 计分标签

    @property(Node)
    gameOverNode: Node | null = null;      // 游戏结束面板

    @property(Button)
    restartBtn: Button | null = null;     // 重新开始按钮

    // 运行时
    private _snake: Snake | null = null;
    private _foodSpawner: FoodSpawner | null = null;
    private _score: number = 0;
    private _isPlaying: boolean = false;
    private _touchStartPos: Vec2 | null = null;
    private _targetAngle: number = 0;

    onLoad() {
        this.initGame();

        // 绑定重新开始按钮
        this.restartBtn?.node.on(Node.EventType.TOUCH_END, this.onRestart, this);
    }

    private initGame(): void {
        // 隐藏结束面板
        if (this.gameOverNode) {
            this.gameOverNode.active = false;
        }

        // 清空游戏区域（移除之前的蛇和食物）
        if (this.gameArea) {
            this.gameArea.removeAllChildren();
        }

        // 创建 Snake
        this._snake = new Node('snake').addComponent(Snake);
        this._snake.node.setParent(this.gameArea!);

        // 蛇出生位置：中心偏左
        const startPos = new Vec3(-80, 0, 0);
        this._snake.init(this.gameArea!, startPos);

        // 绑定回调
        this._snake.onEat = () => this.onSnakeEat();
        this._snake.onDeath = () => this.onSnakeDeath();

        // 创建 FoodSpawner
        this._foodSpawner = this.node.addComponent(FoodSpawner);
        this._foodSpawner.init(this.gameArea!);

        this._score = 0;
        this._isPlaying = true;
        this._targetAngle = 0;
        this.updateScoreLabel();

        // 绑定触屏事件
        this.bindTouchEvents();
    }

    private bindTouchEvents(): void {
        // 在 Canvas 上监听触摸
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    private onTouchStart(event: EventTouch): void {
        const pos = event.getLocation();
        this._touchStartPos = new Vec2(pos.x, pos.y);
    }

    private onTouchMove(event: EventTouch): void {
        if (!this._touchStartPos || !this._snake || this._snake.isDead()) return;

        const pos = event.getLocation();
        const dx = pos.x - this._touchStartPos.x;
        const dy = pos.y - this._touchStartPos.y;

        // 计算拖拽方向角度
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            this._targetAngle = Math.atan2(dy, dx);
            this._snake.setTargetAngle(this._targetAngle);
        }

        // 更新起点（连续拖拽）
        this._touchStartPos = new Vec2(pos.x, pos.y);
    }

    private onTouchEnd(_event: EventTouch): void {
        this._touchStartPos = null;
    }

    update(dt: number) {
        if (!this._isPlaying || !this._snake || !this._foodSpawner) return;

        // 1. 蛇移动
        this._snake.tick(dt);

        // 2. 如果蛇死亡，停止更新
        if (this._snake.isDead()) return;

        // 3. 碰撞检测：蛇头 vs 光点
        const headPos = this._snake.getHeadPos2();
        const headRadius = this._snake.getHeadRadius();
        const ate = this._foodSpawner.checkEat(headPos, headRadius);

        if (ate) {
            // 蛇生长 + 计分
            this._snake.grow();
        }
    }

    private onSnakeEat(): void {
        // grow() 内部已经调用了 onEat，这里不需要额外处理
        // 但 score 更新由 onSnakeEat 触发
    }

    /** 蛇吃光点后更新分数 */
    public addScore(): void {
        this._score++;
        this.updateScoreLabel();
    }

    private onSnakeDeath(): void {
        this._isPlaying = false;

        // 显示结束面板
        if (this.gameOverNode) {
            this.gameOverNode.active = true;
        }

        // 更新最终分数
        const finalScoreLabel = this.gameOverNode?.getChildByName('finalScore')?.getComponent(Label);
        if (finalScoreLabel) {
            finalScoreLabel.string = `长度: ${this._snake?.getLength() ?? 0}`;
        }
    }

    private onRestart(): void {
        // 清理旧实例
        if (this._snake) {
            this._snake.destroyAll();
            this._snake.node.destroy();
            this._snake = null;
        }
        if (this._foodSpawner) {
            this._foodSpawner.clearAll();
            this._foodSpawner.destroy();
            this._foodSpawner = null;
        }

        // 重新初始化
        this.initGame();
    }

    private updateScoreLabel(): void {
        if (this.scoreLabel) {
            this.scoreLabel.string = `长度: ${this._snake?.getLength() ?? 0}`;
        }
    }
}
```

**Step 2: 验证文件完整性**

```bash
wc -l ~/git/tiny_games/assets/games/game_snake/scripts/SnakeGame.ts
```
Expected: ~170 lines

---

### Task 5: 在大厅添加贪吃蛇入口

**Objective:** 在大厅场景的 GameGrid 中注册贪吃蛇，让玩家可以从大厅进入贪吃蛇

**Files:**
- Modify: `assets/games/game_2048/scripts/GameManager2048.ts` 之类的 — 实际上需要看大厅怎么注册游戏的

**Step 1: 检查大厅的游戏注册方式**

```bash
cd ~/git/tiny_games && grep -rn "game_2048\|2048\|war_evolution\|warEvo" assets/main/scripts/
```

**Step 2: 根据现有模式添加贪吃蛇注册**

参照 2048 和战争进化的注册方式，在大厅中添加贪吃蛇的入口。

---

### Task 6: 验证 & 提交

**Objective:** 确保所有文件正确，提交代码

**Step 1: 检查文件结构**

```bash
cd ~/git/tiny_games && find assets/games/game_snake -type f
```
Expected:
```
assets/games/game_snake/scripts/SnakeGame.ts
assets/games/game_snake/scripts/Snake.ts
assets/games/game_snake/scripts/FoodSpawner.ts
```

**Step 2: 提交代码**

```bash
cd ~/git/tiny_games && git add assets/games/game_snake/
git commit -m "feat(snake): 实现贪吃蛇平滑移动版基础逻辑"
git push
```
