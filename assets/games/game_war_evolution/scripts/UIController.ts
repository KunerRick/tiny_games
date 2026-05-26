import { _decorator, Component, Node, Label, Button, ProgressBar, tween, Tween, Vec3, Color } from 'cc';
import { Age, UnitConfig, AGE_NAMES, getNextAgeConfig, getUnitsByAge } from './GameConfig';

const { ccclass, property } = _decorator;

/**
 * UI 控制器
 * 管理顶部信息栏、底部产兵按钮、结算面板
 */
@ccclass('UIController')
export class UIController extends Component {
    // ======== 顶部栏 — 血条 ========
    @property(ProgressBar)
    playerHP: ProgressBar | null = null;

    @property(ProgressBar)
    enemyHP: ProgressBar | null = null;

    @property(Label)
    hpPlayerLabel: Label | null = null;     // 数字 "5000"

    @property(Label)
    hpEnemyLabel: Label | null = null;      // 数字 "5000"

    // ======== 顶部栏 — 信息 ========
    @property(Label)
    goldLabel: Label | null = null;

    @property(Label)
    ageLabel: Label | null = null;

    @property(Label)
    killLabel: Label | null = null;         // "击杀: 0/800"

    // ======== 底部栏 ========
    @property(Button)
    unitButton0: Button | null = null;

    @property(Button)
    unitButton1: Button | null = null;

    @property(Button)
    evolveButton: Button | null = null;

    // 按钮内的文字子节点（每个按钮有 name + cost 两个 Label）
    @property(Label)
    unitName0: Label | null = null;

    @property(Label)
    unitCost0: Label | null = null;

    @property(Label)
    unitName1: Label | null = null;

    @property(Label)
    unitCost1: Label | null = null;

    @property(Label)
    evolveNameLabel: Label | null = null;

    @property(Label)
    evolveCostLabel: Label | null = null;

    // ======== 结算面板 ========
    @property(Node)
    gameOverPanel: Node | null = null;

    @property(Label)
    resultLabel: Label | null = null;

    @property(Label)
    statsLabel: Label | null = null;

    @property(Button)
    restartButton: Button | null = null;

    @property(Button)
    lobbyButton: Button | null = null;

    // ======== AI 进化提示 ========
    @property(Node)
    enemyEvolveNotice: Node | null = null;

    @property(Label)
    enemyEvolveLabel: Label | null = null;

    // ======== 运行时 ========
    // 回调
    private _onUnitSpawn: ((configId: string) => void) | null = null;
    private _onEvolve: (() => void) | null = null;
    private _onRestart: (() => void) | null = null;
    private _onLobby: (() => void) | null = null;

    onLoad() {
        // 绑定按钮事件
        this.bindButton(this.unitButton0, () => this._onUnitSpawn?.('__btn0__'));
        this.bindButton(this.unitButton1, () => this._onUnitSpawn?.('__btn1__'));
        this.bindButton(this.evolveButton, () => this._onEvolve?.());
        this.bindButton(this.restartButton, () => this._onRestart?.());
        this.bindButton(this.lobbyButton, () => this._onLobby?.());

        // 初始隐藏结算面板
        if (this.gameOverPanel) {
            this.gameOverPanel.active = false;
        }

        // 初始隐藏 AI 进化提示
        if (this.enemyEvolveNotice) {
            this.enemyEvolveNotice.active = false;
        }
    }

    private bindButton(btn: Button | null, callback: () => void): void {
        if (!btn) return;
        btn.node.on(Node.EventType.TOUCH_END, callback, this);
    }

    // ======== 外部设置回调 ========

    private _unitConfigs: UnitConfig[] = [];
    private _currentAge: Age = Age.PRIMITIVE;

    public setCallbacks(
        onUnitSpawn: (configId: string) => void,
        onEvolve: () => void,
        onRestart: () => void,
        onLobby: () => void,
    ): void {
        this._onUnitSpawn = onUnitSpawn;
        this._onEvolve = onEvolve;
        this._onRestart = onRestart;
        this._onLobby = onLobby;
    }

    /** 更新产兵按钮 — 显示当前时代的兵种 */
    public setupUnitButtons(age: Age): void {
        this._currentAge = age;
        this._unitConfigs = getUnitsByAge(age);

        this.updateButton(this.unitButton0, this.unitName0, this.unitCost0, 0);
        this.updateButton(this.unitButton1, this.unitName1, this.unitCost1, 1);
    }

    private updateButton(
        btn: Button | null, nameLbl: Label | null, costLbl: Label | null, idx: number,
    ): void {
        if (!btn) return;
        if (idx < this._unitConfigs.length) {
            const cfg = this._unitConfigs[idx];
            btn.node.active = true;
            if (nameLbl) nameLbl.string = cfg.name;
            if (costLbl) costLbl.string = `${cfg.cost}g`;
        } else {
            btn.node.active = false;
        }
    }

    // 实际 spawn 回调会根据按钮序号查找对应的 configId
    public getUnitConfigByIndex(idx: number): UnitConfig | undefined {
        return this._unitConfigs[idx];
    }

    // ======== 状态更新 ========

    public updateTopBar(
        gold: number,
        age: Age,
        exp: number,
        expRequired: number,
        playerHP: number,
        playerMaxHP: number,
        enemyHP: number,
        enemyMaxHP: number,
        kills: number,
    ): void {
        // 金币
        if (this.goldLabel) this.goldLabel.string = `${gold}`;

        // 时代
        if (this.ageLabel) this.ageLabel.string = AGE_NAMES[age];

        // 击杀/进化进度
        if (this.killLabel) {
            this.killLabel.string = `击杀: ${kills}`;
        }

        // HP ProgressBar
        if (this.playerHP) this.playerHP.progress = Math.max(0, playerHP / playerMaxHP);
        if (this.enemyHP) this.enemyHP.progress = Math.max(0, enemyHP / enemyMaxHP);

        // HP 数字
        if (this.hpPlayerLabel) this.hpPlayerLabel.string = `${playerHP}`;
        if (this.hpEnemyLabel) this.hpEnemyLabel.string = `${enemyHP}`;

        // 进化按钮状态文字
        const next = getNextAgeConfig(age);
        if (this.evolveCostLabel) {
            if (next) {
                if (exp >= next.expRequired) {
                    this.evolveCostLabel.string = '可进化';
                } else {
                    this.evolveCostLabel.string = `50g→20exp  ${exp}/${next.expRequired}`;
                }
            } else {
                this.evolveCostLabel.string = '已满级';
            }
        }
        if (this.evolveNameLabel) {
            if (next) {
                this.evolveNameLabel.string = exp >= next.expRequired ? '进化' : '购买经验';
            } else {
                this.evolveNameLabel.string = '已满级';
            }
        }
    }

    public setEvolveButtonEnabled(enabled: boolean): void {
        if (!this.evolveButton) return;
        this.evolveButton.interactable = enabled;
    }

    // ======== 结算面板 ========

    public showGameOver(
        result: 'win' | 'lose' | 'draw',
        age: Age,
        kills: number,
        totalGold: number,
        gameTime: number,
        maxKills: number,
        bestTime: number,
        isNewKillRecord: boolean,
        isNewTimeRecord: boolean,
    ): void {
        if (!this.gameOverPanel) return;
        if (this.resultLabel) {
            if (result === 'win') this.resultLabel.string = '胜利！';
            else if (result === 'lose') this.resultLabel.string = '失败...';
            else this.resultLabel.string = '平局！';
        }
        if (this.statsLabel) {
            // 格式化时间显示
            const formatTime = (seconds: number): string => {
                if (!isFinite(seconds)) return '--:--';
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins}:${secs < 10 ? '0' + secs : secs}`;
            };

            // 构建多行文本
            let statsText = '';

            // 击杀记录
            statsText += `本局击杀: ${kills}\n`;
            if (isNewKillRecord) {
                statsText += `最高记录: ${maxKills}  ← 新纪录！\n\n`;
            } else {
                statsText += `最高记录: ${maxKills}\n\n`;
            }

            // 时间记录（只有胜利时显示）
            if (result === 'win') {
                statsText += `本局用时: ${formatTime(gameTime)}\n`;
                if (isNewTimeRecord) {
                    statsText += `最快通关: ${formatTime(bestTime)}  ← 新纪录！`;
                } else {
                    statsText += `最快通关: ${formatTime(bestTime)}`;
                }
            }

            this.statsLabel.string = statsText;
        }
        this.gameOverPanel.active = true;
    }

    /** 重置所有提示状态（重新开始时调用） */
    public resetAll(): void {
        this.resetEnemyEvolveNotice();
    }

    public hideGameOver(): void {
        if (this.gameOverPanel) {
            this.gameOverPanel.active = false;
        }
    }

    // ======== 进化提示（AI + 玩家） ========

    private _evolveNoticeTimer: number = 0;

    /** 重置进化提示状态（重新开始时调用） */
    public resetEnemyEvolveNotice(): void {
        if (this.enemyEvolveNotice) {
            Tween.stopAllByTarget(this.enemyEvolveNotice);
            this.enemyEvolveNotice.active = false;
            this.enemyEvolveNotice.setScale(1, 1, 1);
        }
        this._evolveNoticeTimer = 0;
    }

    public showEnemyEvolveNotice(age: Age): void {
        if (!this.enemyEvolveNotice || !this.enemyEvolveLabel) return;

        // 停止旧的动画
        Tween.stopAllByTarget(this.enemyEvolveNotice);

        this.enemyEvolveLabel.string = `敌方进化到 ${AGE_NAMES[age]}！`;
        this.enemyEvolveNotice.active = true;
        this._evolveNoticeTimer = 2.0; // 显示 2 秒

        // 淡入效果
        this.enemyEvolveNotice.setScale(0.8, 0.8, 1);
        tween(this.enemyEvolveNotice)
            .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }

    /** 玩家进化提示（运行时动态创建，无需场景节点） */
    public showPlayerEvolveNotice(age: Age): void {
        // 创建临时标签
        const noticeNode = new Node('PlayerEvolveNotice');
        this.node.addChild(noticeNode);

        const label = noticeNode.addComponent(Label);
        label.string = `进化到 ${AGE_NAMES[age]}！`;
        label.fontSize = 28;
        label.color = new Color(100, 255, 100);
        label.isBold = true;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;

        // 定位（位于 enemyEvolveNotice 下方）
        noticeNode.setPosition(0, 100, 0);

        // 入场 → 停留 → 消失 → 销毁
        noticeNode.setScale(0.8, 0.8, 1);
        tween(noticeNode)
            .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .delay(1.5)
            .to(0.3, { scale: new Vec3(0.8, 0.8, 1) })
            .call(() => {
                if (noticeNode.isValid) {
                    noticeNode.destroy();
                }
            })
            .start();
    }

    update(dt: number): void {
        // 处理进化提示计时器
        if (this._evolveNoticeTimer > 0) {
            this._evolveNoticeTimer -= dt;
            if (this._evolveNoticeTimer <= 0 && this.enemyEvolveNotice) {
                // 淡出效果
                tween(this.enemyEvolveNotice)
                    .to(0.3, { scale: new Vec3(0.8, 0.8, 1) })
                    .call(() => {
                        if (this.enemyEvolveNotice) {
                            this.enemyEvolveNotice.active = false;
                        }
                    })
                    .start();
            }
        }
    }
}
