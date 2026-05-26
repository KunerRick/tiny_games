import { _decorator, Component, Node, Graphics, Color, Vec3, Vec2 } from 'cc';

const { ccclass, property } = _decorator;

const SEGMENT_SIZE = 14;          // 每段尺寸
const SEGMENT_GAP = 6;            // 路径采样间隔（帧数）
const TURN_SPEED = 5.0;           // 转向速度（弧度/秒）
const HEAD_COLOR = new Color(68, 200, 255);
const BODY_COLOR = new Color(50, 160, 235);
const INITIAL_LENGTH = 5;
const EAT_GROW_STEP = 3;          // 每吃 N 个光点增长一段
const BASE_SPEED = 150;            // 像素/秒
const MAX_SPEED = 220;
const SPEED_INCREMENT = 2;
const MARGIN = 30;                 // 死亡边界内缩

@ccclass('Snake')
export class Snake extends Component {
    private _headNode: Node | null = null;
    private _bodyNodes: Node[] = [];
    private _pathHistory: Vec3[] = [];

    private _currentSegments: number = INITIAL_LENGTH;
    private _currentAngle: number = 0;
    private _targetAngle: number = 0;
    private _speed: number = BASE_SPEED;
    private _gameArea: Node | null = null;
    private _halfW: number = 360;
    private _halfH: number = 640;
    private _eatCounter: number = 0;
    private _isDead: boolean = false;

    // 回调
    public onEat: ((scoreChange: number) => void) | null = null;
    public onDeath: (() => void) | null = null;

    public init(gameArea: Node, startPos: Vec3, halfW: number, halfH: number): void {
        this._gameArea = gameArea;
        this._halfW = halfW;
        this._halfH = halfH;
        this._currentSegments = INITIAL_LENGTH;
        this._eatCounter = 0;
        this._isDead = false;
        this._currentAngle = 0;
        this._targetAngle = 0;
        this._pathHistory = [];
        this._speed = BASE_SPEED;

        this.clearNodes();

        // 创建蛇头
        this._headNode = new Node('snakeHead');
        const headG = this._headNode.addComponent(Graphics);
        headG.fillColor = HEAD_COLOR;
        headG.rect(-SEGMENT_SIZE / 2, -SEGMENT_SIZE / 2, SEGMENT_SIZE, SEGMENT_SIZE);
        headG.fill();

        // 蛇头稍微圆润一点 — 加一个小圆角效果
        headG.fillColor = new Color(68, 200, 255, 180);
        headG.circle(0, 0, SEGMENT_SIZE / 2 + 1);
        headG.fill();

        this._headNode.setPosition(startPos.x, startPos.y, 0);
        this._headNode.setParent(gameArea);

        // 初始路径填充
        for (let i = 0; i < (this._currentSegments + 3) * SEGMENT_GAP; i++) {
            this._pathHistory.push(new Vec3(startPos.x, startPos.y, 0));
        }

        // 创建初始身体节点
        this.rebuildBody();
    }

    public setTargetAngle(angle: number): void {
        this._targetAngle = angle;
    }

    public tick(dt: number): void {
        if (this._isDead || !this._headNode) return;

        // 1. 平滑转向
        let diff = this._targetAngle - this._currentAngle;
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

        const pos = this._headNode.position;
        const newX = pos.x + dx;
        const newY = pos.y + dy;

        // 3. 撞墙检测
        if (newX < -this._halfW + MARGIN || newX > this._halfW - MARGIN ||
            newY < -this._halfH + MARGIN || newY > this._halfH - MARGIN) {
            this.die();
            return;
        }

        // 4. 更新蛇头位置
        this._headNode.setPosition(newX, newY, 0);

        // 5. 记录路径
        this._pathHistory.push(new Vec3(newX, newY, 0));

        // 6. 更新身体
        this.updateBody();
    }

    private updateBody(): void {
        const totalSegments = this._currentSegments - 1;

        // 确保身体节点数量匹配
        while (this._bodyNodes.length < totalSegments) {
            const node = new Node('snakeBody');
            const g = node.addComponent(Graphics);
            g.fillColor = BODY_COLOR;
            g.rect(-SEGMENT_SIZE / 2, -SEGMENT_SIZE / 2, SEGMENT_SIZE, SEGMENT_SIZE);
            g.fill();
            node.setParent(this._gameArea!);
            this._bodyNodes.push(node);
        }
        while (this._bodyNodes.length > totalSegments) {
            const node = this._bodyNodes.pop()!;
            node.destroy();
        }

        // 从路径历史取身体位置
        for (let i = 0; i < totalSegments; i++) {
            const idx = this._pathHistory.length - 1 - (i + 1) * SEGMENT_GAP;
            if (idx >= 0 && idx < this._pathHistory.length) {
                const p = this._pathHistory[idx];
                this._bodyNodes[i].setPosition(p.x, p.y, 0);
            }
        }

        // 限制历史长度
        const maxHistory = (this._currentSegments + 10) * SEGMENT_GAP;
        while (this._pathHistory.length > maxHistory) {
            this._pathHistory.shift();
        }
    }

    private rebuildBody(): void {
        for (const b of this._bodyNodes) b.destroy();
        this._bodyNodes = [];
        this.updateBody();
    }

    public getHeadWorldX(): number {
        return this._headNode?.position.x ?? 0;
    }

    public getHeadWorldY(): number {
        return this._headNode?.position.y ?? 0;
    }

    public getHeadRadius(): number {
        return SEGMENT_SIZE / 2;
    }

    /** 吃光点：累积计数器，够 EAT_GROW_STEP 个就长一段 */
    public grow(): void {
        this._eatCounter++;
        let scoreChange = 0;
        if (this._eatCounter >= EAT_GROW_STEP) {
            this._currentSegments++;
            this._eatCounter = 0;
            this._speed = Math.min(this._speed + SPEED_INCREMENT, MAX_SPEED);
            scoreChange = 1; // 每长一段计 1 分
        }
        this.onEat?.(scoreChange);
    }

    private die(): void {
        this._isDead = true;
        this.onDeath?.();
    }

    public isDead(): boolean { return this._isDead; }
    public getLength(): number { return this._currentSegments; }

    private clearNodes(): void {
        if (this._headNode) { this._headNode.destroy(); this._headNode = null; }
        for (const b of this._bodyNodes) b.destroy();
        this._bodyNodes = [];
        this._pathHistory = [];
    }

    public destroyAll(): void {
        this.clearNodes();
    }
}
