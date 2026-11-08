import {
    _decorator,
    Component,
    Node,
    Button,
    Label,
    Sprite,
    EventTouch,
    Vec2,
    Vec3,
    UITransform,
    Graphics,
    UIOpacity,
    tween,
} from 'cc';
import { Snake } from './Snake';
import { FoodSpawner } from './FoodSpawner';
import { Joystick } from './Joystick';
import { SceneManager } from '../../../common/managers/SceneManager';
import {
    createLabel,
    createNode,
    designPos,
    drawDivider,
    drawRoundRect,
    ensureChild,
    toColor,
} from '../../../common/ui/GameUIKit';
import {
    COLOR, FONT_BODY, FONT_CAPTION, FONT_DISPLAY, FONT_TITLE,
    applyFontAndColor, hex,
} from '../../../common/ui/UITheme';
import {
    findPath, paintLabel, skinBackButton, skinButton, skinCard, skinOverlay,
} from '../../../common/ui/SceneSkin';

const { ccclass, property } = _decorator;

// 存储键名
const STORAGE_KEY_SNAKE = 'tiny_games_snake_data';

interface SnakeStorageData {
    bestScore: number;
}

// 连击配置
const COMBO_TIMEOUT = 5;           // 连击超时时间（秒）
const COMBO_BONUS = 5;             // 每次连击额外加分

@ccclass('SnakeGame')
export class SnakeGame extends Component {
    // ========== 游戏区域 ==========
    @property(Node)
    gameArea: Node | null = null;

    // ========== 摇杆 ==========
    @property(Joystick)
    joystick: Joystick | null = null;

    // ========== 顶部栏分数显示 ==========
    @property(Label)
    currentScoreLabel: Label | null = null;

    @property(Label)
    bestScoreLabel: Label | null = null;

    @property(Label)
    comboLabel: Label | null = null;      // 连击显示

    // ========== 游戏结束面板 ==========
    @property(Node)
    gameOverPanel: Node | null = null;

    @property(Label)
    finalScoreLabel: Label | null = null;       // 显示大数字（如 "128"）

    @property(Label)
    finalScoreDescLabel: Label | null = null;   // 显示 "本局得分"

    @property(Label)
    finalBestScoreLabel: Label | null = null;   // 显示 "历史最佳 xxx"

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
    /** 是否已经由玩家首次输入启动（进场时蛇静止，避免没人操作就自己撞墙） */
    private _started: boolean = false;
    private _startHint: Node | null = null;
    private _halfW: number = 360;
    private _halfH: number = 640;

    // 连击系统
    private _comboCount: number = 0;           // 当前连击数
    private _lastEatTime: number = 0;          // 上次吃食物时间
    private _comboTimer: number = 0;           // 连击计时器

    // 存储 joystick 触摸 handler 引用，以便在 _cleanupGame 中正确解绑
    private _joystickTouchStartHandler: ((event: EventTouch) => void) | null = null;
    private _joystickTouchMoveHandler: ((event: EventTouch) => void) | null = null;
    private _joystickTouchEndHandler: ((event: EventTouch) => void) | null = null;
    private _joystickTouchCancelHandler: ((event: EventTouch) => void) | null = null;

    onLoad() {
        this._loadBestScore();
        this._initGame();
        this._bindButtons();
        this._initJoystick();
        this._applyUnifiedTheme();
    }

    // ------------------------------------------------------------------
    // 统一视觉：场景里的顶栏 / 结算面板是早期手摆的（纯黑顶栏、#16213E 卡片、
    // #00D9FF 按钮），与全站深色科技风不同一套。运行时换皮，不动场景文件：
    //   • 游戏区 → COLOR.BG_SCENE；顶栏 → SURFACE + 底部分割线
    //   • 返回 → 与 BackButton 同款「圆盘 + ‹」
    //   • 结算面板 → PANEL_BG + 主色描边 / 强调条；主按钮 PRIMARY，次按钮 SURFACE
    // 全部幂等，节点缺失时静默跳过。
    // ------------------------------------------------------------------

    private _applyUnifiedTheme(): void {
        // 游戏区底色
        const area = findPath(this.node, 'gameArea')?.getComponent(Sprite);
        if (area) area.color = hex(COLOR.BG_SCENE);

        // 顶栏：原纯黑 → 面板灰 + 全宽分割线
        const topBar = findPath(this.node, 'UI_Overlay/topBar');
        const barBg = topBar?.getChildByName('bg')?.getComponent(Sprite);
        if (barBg) barBg.color = hex(COLOR.SURFACE, 240);
        if (topBar) {
            const ui = topBar.getComponent(UITransform);
            const w = ui ? ui.width : 720;
            const h = ui ? ui.height : 80;
            const line = ensureChild(topBar, '__topDivider', w, 4);
            line.setPosition(0, -h / 2 + 1, 0);
            drawDivider(line, w, COLOR.PANEL_BORDER, 235);
        }

        skinBackButton(this.node, 'UI_Overlay/topBar/backBtn', 60);

        paintLabel(this.node, 'UI_Overlay/topBar/scorePanel/currentScore', FONT_TITLE, COLOR.TEXT_PRIMARY);
        paintLabel(this.node, 'UI_Overlay/topBar/scorePanel/bestScore', FONT_BODY, COLOR.TEXT_SECONDARY);

        // 连击：琥珀色，跳出来的时候像「奖励」而不是普通文本
        if (this.comboLabel) applyFontAndColor(this.comboLabel, FONT_BODY, COLOR.WARNING);

        // 结算面板
        skinOverlay(this.node, 'UI_Overlay/gameOverPanel/bg', 190);
        // 卡片自带一条旧强调条（accentBarGfx）：drawFrame 会按同名复用并重画，不必另处理
        skinCard(this.node, 'UI_Overlay/gameOverPanel/card', {
            fill: COLOR.PANEL_BG, border: COLOR.PRIMARY, borderAlpha: 95,
            radius: 20, accent: COLOR.PRIMARY,
        });

        paintLabel(this.node, 'UI_Overlay/gameOverPanel/card/title', FONT_TITLE, COLOR.PRIMARY);
        paintLabel(this.node, 'UI_Overlay/gameOverPanel/card/scoreDisplay/finalScore', FONT_DISPLAY, COLOR.TEXT_PRIMARY);
        paintLabel(this.node, 'UI_Overlay/gameOverPanel/card/scoreDisplay/bestScore', FONT_CAPTION, COLOR.TEXT_SECONDARY);
        paintLabel(this.node, 'UI_Overlay/gameOverPanel/card/scoreDisplay/scoreDesc', FONT_CAPTION, COLOR.TEXT_SECONDARY);
        skinButton(this.node, 'UI_Overlay/gameOverPanel/card/restartBtn', 'primary', 280, 72);
        skinButton(this.node, 'UI_Overlay/gameOverPanel/card/backBtn', 'secondary', 200, 56);
    }

    private _bindButtons(): void {
        if (this.restartBtn) {
            this.restartBtn.node.on(Button.EventType.CLICK, this._onRestart, this);
        } else {
            console.warn('[SnakeGame] restartBtn not assigned');
        }

        if (this.backBtn) {
            this.backBtn.node.on(Button.EventType.CLICK, this._onBackToLobby, this);
        } else {
            console.warn('[SnakeGame] backBtn not assigned');
        }

        if (this.panelBackBtn) {
            this.panelBackBtn.node.on(Button.EventType.CLICK, this._onBackToLobby, this);
        } else {
            console.warn('[SnakeGame] panelBackBtn not assigned');
        }
    }

    private _initJoystick(): void {
        if (!this.joystick) {
            console.warn('Joystick not assigned, falling back to touch area control');
            // 如果没有绑定摇杆，使用游戏区域触摸
            if (this.gameArea) {
                this.gameArea.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
                this.gameArea.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
                this.gameArea.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
                this.gameArea.on(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
            }
            return;
        }

        // 设置摇杆回调
        this.joystick.onDirectionChange = (angle: number) => {
            this._beginPlay();
            this._snake?.setTargetAngle(angle);
        };

        // 绑定触摸事件到摇杆（存储 handler 引用以便正确解绑）
        if (this.gameArea) {
            this._joystickTouchStartHandler = (event: EventTouch) => {
                if (this.joystick?.onTouchStart(event)) {
                    // 摇杆消费了事件：这也是一次玩家输入，开始游戏
                    this._beginPlay();
                }
            };
            this._joystickTouchMoveHandler = (event: EventTouch) => {
                this.joystick?.onTouchMove(event);
            };
            this._joystickTouchEndHandler = (event: EventTouch) => {
                this.joystick?.onTouchEnd(event);
            };
            this._joystickTouchCancelHandler = (event: EventTouch) => {
                this.joystick?.onTouchCancel(event);
            };

            this.gameArea.on(Node.EventType.TOUCH_START, this._joystickTouchStartHandler, this);
            this.gameArea.on(Node.EventType.TOUCH_MOVE, this._joystickTouchMoveHandler, this);
            this.gameArea.on(Node.EventType.TOUCH_END, this._joystickTouchEndHandler, this);
            this.gameArea.on(Node.EventType.TOUCH_CANCEL, this._joystickTouchCancelHandler, this);
        }
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
        // 获取游戏区域尺寸；顶部让出 HUD（得分/返回）的高度，底部也留出安全边
        if (this.gameArea) {
            const transform = this.gameArea.getComponent(UITransform);
            if (transform) {
                const topInset = 150;   // HUD 在 y≈140 以上的区域
                const sideInset = 24;
                this._halfW = transform.width / 2 - sideInset;
                this._halfH = transform.height / 2 - topInset;
            }
        }

        // 隐藏结束面板
        if (this.gameOverPanel) {
            this.gameOverPanel.active = false;
        }

        // 清空连击显示
        if (this.comboLabel) {
            this.comboLabel.node.active = false;
        }

        // 清空子节点
        if (this.gameArea) {
            this.gameArea.destroyAllChildren();
        }

        // 创建蛇
        const snakeNode = new Node('snake');
        snakeNode.setParent(this.gameArea!);
        this._snake = snakeNode.addComponent(Snake);

        const startPos = new Vec3(-80, 0, 0);
        this._snake.init(this.gameArea!, startPos, this._halfW, this._halfH);

        this._snake.onDeath = () => this._onSnakeDeath();

        // 创建食物
        this._foodSpawner = this.node.addComponent(FoodSpawner);
        this._foodSpawner.init(this.gameArea!, this._halfW, this._halfH);

        // 重置分数和连击
        this._score = 0;
        this._comboCount = 0;
        this._lastEatTime = 0;
        this._comboTimer = 0;
        this._isPlaying = true;
        this._started = false;
        this._updateScoreLabels();
        this._showStartHint();
    }

    /** 进场先静止，等玩家第一次滑动再开始——否则蛇会自己撞墙 */
    private _showStartHint(): void {
        if (this._startHint && this._startHint.isValid) {
            this._startHint.destroy();
        }
        this._startHint = null;

        const hint = createNode('StartHint', this.node, 380, 84);
        hint.setPosition(designPos(360, 500));
        const g = hint.addComponent(Graphics);
        drawRoundRect(
            g, 380, 84, 42,
            toColor(COLOR.SLOT_EMPTY_BG, 240), toColor(COLOR.INFO), 2,
        );
        const hintText = createLabel(hint, '滑动屏幕开始', FONT_TITLE.fontSize, {
            width: 350,
            height: 76,
            color: COLOR.TEXT_PRIMARY,
            bold: true,
        });
        applyFontAndColor(hintText, FONT_TITLE, COLOR.TEXT_PRIMARY);

        const op = hint.addComponent(UIOpacity);
        op.opacity = 255;
        tween(op)
            .repeatForever(
                tween(op)
                    .to(0.75, { opacity: 130 })
                    .to(0.75, { opacity: 255 }),
            )
            .start();

        this._startHint = hint;
    }

    /** 玩家首次输入：收起提示，开始移动 */
    private _beginPlay(): void {
        if (this._started) return;
        this._started = true;

        if (this._startHint && this._startHint.isValid) {
            this._startHint.destroy();
        }
        this._startHint = null;
    }

    // ==================== 触摸控制（备用）====================

    private _touchPrevPos: Vec2 | null = null;

    private _onTouchStart(event: EventTouch): void {
        const pos = event.getUILocation();
        this._touchPrevPos = new Vec2(pos.x, pos.y);
        this._beginPlay();
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

    private _onTouchCancel(_event: EventTouch): void {
        this._touchPrevPos = null;
    }

    // ==================== 主循环 ====================

    update(dt: number) {
        if (!this._isPlaying || !this._started || !this._snake || !this._foodSpawner) return;

        // 1. 更新连击计时器
        this._updateCombo(dt);

        // 2. 蛇移动
        this._snake.tick(dt);

        // 死亡后本帧停止后续检测
        if (this._snake.isDead()) return;

        // 3. 碰撞检测：蛇头 vs 光点
        const hx = this._snake.getHeadWorldX();
        const hy = this._snake.getHeadWorldY();
        const hr = this._snake.getHeadRadius();
        const result = this._foodSpawner.checkEat(hx, hy, hr);

        if (result.ate) {
            this._onEatFood(result.value);
        }
    }

    // ==================== 连击系统 ====================

    private _updateCombo(dt: number): void {
        if (this._comboCount <= 0) return;

        this._comboTimer += dt;

        // 连击超时
        if (this._comboTimer >= COMBO_TIMEOUT) {
            this._comboCount = 0;
            this._comboTimer = 0;
            this._updateComboLabel();
        }
    }

    private _updateComboLabel(): void {
        if (!this.comboLabel) return;

        if (this._comboCount > 1) {
            this.comboLabel.node.active = true;
            this.comboLabel.string = `${this._comboCount} 连击!`;
        } else {
            this.comboLabel.node.active = false;
        }
    }

    // ==================== 回调 ====================

    private _onEatFood(baseValue: number): void {
        const now = Date.now() / 1000;  // 转换为秒

        // 检查连击
        if (this._lastEatTime > 0 && (now - this._lastEatTime) <= COMBO_TIMEOUT) {
            this._comboCount++;
        } else {
            this._comboCount = 1;
        }

        this._lastEatTime = now;
        this._comboTimer = 0;

        // 计算总分：基础分 + 连击奖励
        const comboBonus = (this._comboCount - 1) * COMBO_BONUS;
        const totalValue = baseValue + comboBonus;

        this._score += totalValue;

        if (this._score > this._bestScore) {
            this._bestScore = this._score;
            this._saveBestScore();
        }

        // 蛇增长
        this._snake?.grow();

        this._updateScoreLabels();
        this._updateComboLabel();
    }

    private _onSnakeDeath(): void {
        this._isPlaying = false;

        // 进场提示是后加的节点，层级高于结算面板；没滑过就死（理论上不会）时也要收掉
        if (this._startHint && this._startHint.isValid) {
            this._startHint.destroy();
        }
        this._startHint = null;

        if (this.gameOverPanel) {
            this.gameOverPanel.active = true;
        }

        // 更新结束面板上的分数
        if (this.finalScoreLabel) {
            this.finalScoreLabel.string = `${this._score}`;
        }
        if (this.finalScoreDescLabel) {
            this.finalScoreDescLabel.string = '本局得分';
        }
        if (this.finalBestScoreLabel) {
            this.finalBestScoreLabel.string = `历史最佳 ${this._bestScore}`;
        }
    }

    private _onRestart(): void {
        this._cleanupGame();
        this._initGame();
        this._initJoystick();
    }

    private _onBackToLobby(): void {
        SceneManager.gotoLobby();
    }

    private _cleanupGame(): void {
        // 标记游戏结束——确保 update() 在清理期间不会继续执行
        this._isPlaying = false;
        this._started = false;

        if (this._startHint && this._startHint.isValid) {
            this._startHint.destroy();
        }
        this._startHint = null;

        if (this._snake) {
            this._snake.destroyAll();
            // 蛇根节点交给下一次 _initGame 的 destroyAllChildren 一起销毁
            // （removeAllChildren 只脱离子节点、不销毁，反复重开会累积泄漏）
            this._snake = null;
        }
        if (this._foodSpawner) {
            this._foodSpawner.clearAll();
            this._foodSpawner.destroy();
            this._foodSpawner = null;
        }

        // 移除全部触摸事件监听（覆盖 joystick 和回退两种模式）
        if (this.gameArea) {
            // 移除 joystick 模式 handler（已存储引用）
            if (this._joystickTouchStartHandler) {
                this.gameArea.off(Node.EventType.TOUCH_START, this._joystickTouchStartHandler, this);
                this._joystickTouchStartHandler = null;
            }
            if (this._joystickTouchMoveHandler) {
                this.gameArea.off(Node.EventType.TOUCH_MOVE, this._joystickTouchMoveHandler, this);
                this._joystickTouchMoveHandler = null;
            }
            if (this._joystickTouchEndHandler) {
                this.gameArea.off(Node.EventType.TOUCH_END, this._joystickTouchEndHandler, this);
                this._joystickTouchEndHandler = null;
            }
            if (this._joystickTouchCancelHandler) {
                this.gameArea.off(Node.EventType.TOUCH_CANCEL, this._joystickTouchCancelHandler, this);
                this._joystickTouchCancelHandler = null;
            }

            // 移除回退模式 handler（未注册时 off() 是无操作，安全）
            this.gameArea.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
            this.gameArea.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
            this.gameArea.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
            this.gameArea.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
        }
    }

    private _updateScoreLabels(): void {
        if (this.currentScoreLabel) {
            this.currentScoreLabel.string = `得分: ${this._score}`;
        }
        if (this.bestScoreLabel) {
            this.bestScoreLabel.string = `最佳: ${this._bestScore}`;
        }
    }

    onDestroy() {
        // 场景销毁时 Cocos 会自动：
        //   1. 深度优先递归销毁所有子节点和组件
        //   2. 自动移除所有以当前组件为 target 注册的事件监听
        // 此时访问 @property(Node) 引用的节点可能已被销毁（getter 返回 null），
        // 所以只清引用，不调任何节点/组件方法。
        this._snake = null;
        this._foodSpawner = null;
        this._startHint = null;
        this._joystickTouchStartHandler = null;
        this._joystickTouchMoveHandler = null;
        this._joystickTouchEndHandler = null;
        this._joystickTouchCancelHandler = null;
    }
}
