import { _decorator, Component, Node, Button, Label, EventTouch, Vec2, Vec3, UITransform, find, director } from 'cc';
import { Snake } from './Snake';
import { FoodSpawner } from './FoodSpawner';

const { ccclass, property } = _decorator;

// 存储键名
const STORAGE_KEY_SNAKE = 'tiny_games_snake_data';

interface SnakeStorageData {
    bestScore: number;
}

@ccclass('SnakeGame')
export class SnakeGame extends Component {
    // ========== 游戏区域 ==========
    @property(Node)
    gameArea: Node | null = null;

    // ========== 顶部栏分数显示 ==========
    @property(Label)
    currentScoreLabel: Label | null = null;

    @property(Label)
    bestScoreLabel: Label | null = null;

    // ========== 游戏结束面板 ==========
    @property(Node)
    gameOverPanel: Node | null = null;

    @property(Label)
    finalScoreLabel: Label | null = null;

    @property(Label)
    finalBestScoreLabel: Label | null = null;

    // ========== 按钮 ==========
    @property(Button)
    restartBtn: Button | null = null;

    @property(Button)
    backBtn: Button | null = null;

    @property(Button)
    panelBackBtn: Button | null = null;

    // 运行时
    private _snake: Snake | null = null;
    private _foodSpawner: FoodSpawner | null = null;
    private _score: number = 0;
    private _bestScore: number = 0;
    private _isPlaying: boolean = false;
    private _touchPrevPos: Vec2 | null = null;
    private _halfW: number = 360;
    private _halfH: number = 640;

    onLoad() {
        this._loadBestScore();
        this._initGame();
        this._bindButtons();
    }

    private _bindButtons(): void {
        this.restartBtn?.node.on(Node.EventType.TOUCH_END, this._onRestart, this);
        this.backBtn?.node.on(Node.EventType.TOUCH_END, this._onBackToLobby, this);
        this.panelBackBtn?.node.on(Node.EventType.TOUCH_END, this._onBackToLobby, this);
    }

    private _loadBestScore(): void {
        try {
            const data = localStorage.getItem(STORAGE_KEY_SNAKE);
            if (data) {
                const parsed: SnakeStorageData = JSON.parse(data);
                this._bestScore = parsed.bestScore || 0;
            }
        } catch (e) {
            console.warn('Failed to load best score:', e);
            this._bestScore = 0;
        }
    }

    private _saveBestScore(): void {
        try {
            const data: SnakeStorageData = { bestScore: this._bestScore };
            localStorage.setItem(STORAGE_KEY_SNAKE, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save best score:', e);
        }
    }

    private _initGame(): void {
        // 获取游戏区域尺寸
        if (this.gameArea) {
            const transform = this.gameArea.getComponent(UITransform);
            if (transform) {
                this._halfW = transform.width / 2;
                this._halfH = transform.height / 2;
            }
        }

        // 隐藏结束面板
        if (this.gameOverPanel) {
            this.gameOverPanel.active = false;
        }

        // 清空子节点
        if (this.gameArea) {
            this.gameArea.removeAllChildren();
        }

        // 创建蛇
        const snakeNode = new Node('snake');
        snakeNode.setParent(this.gameArea!);
        this._snake = snakeNode.addComponent(Snake);

        const startPos = new Vec3(-80, 0, 0);
        this._snake.init(this.gameArea!, startPos, this._halfW, this._halfH);

        this._snake.onEat = (scoreChange: number) => this._onSnakeEat(scoreChange);
        this._snake.onDeath = () => this._onSnakeDeath();

        // 创建食物
        this._foodSpawner = this.node.addComponent(FoodSpawner);
        this._foodSpawner.init(this.gameArea!);

        this._score = 0;
        this._isPlaying = true;
        this._updateScoreLabels();

        // 触屏事件 — 绑定到 gameArea 上
        if (this.gameArea) {
            this.gameArea.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
            this.gameArea.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
            this.gameArea.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        }
    }

    // ==================== 触屏控制 ====================

    private _onTouchStart(event: EventTouch): void {
        const pos = event.getUILocation();
        this._touchPrevPos = new Vec2(pos.x, pos.y);
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this._touchPrevPos || !this._snake || this._snake.isDead()) return;

        const pos = event.getUILocation();
        const dx = pos.x - this._touchPrevPos.x;
        const dy = pos.y - this._touchPrevPos.y;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            const angle = Math.atan2(dy, dx);
            this._snake.setTargetAngle(angle);
        }

        this._touchPrevPos = new Vec2(pos.x, pos.y);
    }

    private _onTouchEnd(_event: EventTouch): void {
        this._touchPrevPos = null;
    }

    // ==================== 主循环 ====================

    update(dt: number) {
        if (!this._isPlaying || !this._snake || !this._foodSpawner) return;

        // 1. 蛇移动
        this._snake.tick(dt);

        // 死亡后本帧停止后续检测
        if (this._snake.isDead()) return;

        // 2. 碰撞检测：蛇头 vs 光点
        const hx = this._snake.getHeadWorldX();
        const hy = this._snake.getHeadWorldY();
        const hr = this._snake.getHeadRadius();
        const ate = this._foodSpawner.checkEat(hx, hy, hr);

        if (ate) {
            this._snake.grow();
        }
    }

    // ==================== 回调 ====================

    private _onSnakeEat(scoreChange: number): void {
        this._score += scoreChange;
        if (this._score > this._bestScore) {
            this._bestScore = this._score;
            this._saveBestScore();
        }
        this._updateScoreLabels();
    }

    private _onSnakeDeath(): void {
        this._isPlaying = false;

        if (this.gameOverPanel) {
            this.gameOverPanel.active = true;
        }

        // 更新结束面板上的分数
        const currentLength = this._snake?.getLength() ?? 0;
        if (this.finalScoreLabel) {
            this.finalScoreLabel.string = `最终长度: ${currentLength}`;
        }
        if (this.finalBestScoreLabel) {
            this.finalBestScoreLabel.string = `历史最佳: ${this._bestScore}`;
        }
    }

    private _onRestart(): void {
        // 清理旧实例
        this._cleanupGame();
        this._initGame();
    }

    private _onBackToLobby(): void {
        director.loadScene('Lobby');
    }

    private _cleanupGame(): void {
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

        // 移除触屏事件监听
        if (this.gameArea) {
            this.gameArea.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
            this.gameArea.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
            this.gameArea.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        }
    }

    private _updateScoreLabels(): void {
        const currentLength = this._snake?.getLength() ?? 0;
        if (this.currentScoreLabel) {
            this.currentScoreLabel.string = `长度: ${currentLength}`;
        }
        if (this.bestScoreLabel) {
            this.bestScoreLabel.string = `最佳: ${this._bestScore}`;
        }
    }

    onDestroy() {
        this._cleanupGame();

        // 清理按钮监听
        this.restartBtn?.node.off(Node.EventType.TOUCH_END, this._onRestart, this);
        this.backBtn?.node.off(Node.EventType.TOUCH_END, this._onBackToLobby, this);
        this.panelBackBtn?.node.off(Node.EventType.TOUCH_END, this._onBackToLobby, this);
    }
}
