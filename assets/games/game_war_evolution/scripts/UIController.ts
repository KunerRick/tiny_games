import { _decorator, Component, Node, Label, Button } from 'cc';
import { Age, UnitConfig, AGE_NAMES, getNextAgeConfig, getAvailableUnits } from './GameConfig';

const { ccclass, property } = _decorator;

/**
 * UI 控制器
 * 管理顶部信息栏、底部产兵按钮、结算面板
 */
@ccclass('UIController')
export class UIController extends Component {
    // ======== 顶部栏 ========
    @property(Label)
    goldLabel: Label | null = null;

    @property(Label)
    ageLabel: Label | null = null;

    @property(Label)
    expLabel: Label | null = null;

    @property(Label)
    playerHPLabel: Label | null = null;

    @property(Label)
    enemyHPLabel: Label | null = null;

    @property(Label)
    evolveCostLabel: Label | null = null;

    // ======== 底部栏 ========
    @property(Button)
    unitButton0: Button | null = null;

    @property(Button)
    unitButton1: Button | null = null;

    @property(Button)
    evolveButton: Button | null = null;

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

    // ======== 运行时 ========
    private _unitLabel0: Label | null = null;
    private _unitLabel1: Label | null = null;

    // 回调
    private _onUnitSpawn: ((configId: string) => void) | null = null;
    private _onEvolve: (() => void) | null = null;
    private _onRestart: (() => void) | null = null;
    private _onLobby: (() => void) | null = null;

    onLoad() {
        // 缓存按钮内部的 Label
        this._unitLabel0 = this.unitButton0?.node.getComponentInChildren(Label) ?? null;
        this._unitLabel1 = this.unitButton1?.node.getComponentInChildren(Label) ?? null;

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

    /** 更新产兵按钮 */
    public setupUnitButtons(age: Age): void {
        this._currentAge = age;
        this._unitConfigs = getAvailableUnits(age);

        this.updateButton(this.unitButton0, this._unitLabel0, 0);
        this.updateButton(this.unitButton1, this._unitLabel1, 1);
    }

    private updateButton(btn: Button | null, label: Label | null, idx: number): void {
        if (!btn) return;
        if (idx < this._unitConfigs.length) {
            const cfg = this._unitConfigs[idx];
            btn.node.active = true;
            if (label) {
                label.string = `${cfg.name} ${cfg.cost}g`;
            }
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
    ): void {
        if (this.goldLabel) this.goldLabel.string = `金币: ${gold}`;
        if (this.ageLabel) this.ageLabel.string = AGE_NAMES[age];
        if (this.expLabel) {
            this.expLabel.string = expRequired > 0
                ? `经验: ${exp}/${expRequired}`
                : `经验: ${exp}`;
        }
        if (this.playerHPLabel) {
            this.playerHPLabel.string = `我方: ${playerHP}/${playerMaxHP}`;
        }
        if (this.enemyHPLabel) {
            this.enemyHPLabel.string = `敌方: ${enemyHP}/${enemyMaxHP}`;
        }

        // 进化费用
        const next = getNextAgeConfig(age);
        if (this.evolveCostLabel) {
            if (next) {
                this.evolveCostLabel.string = `进化: ${next.goldRequired}g`;
            } else {
                this.evolveCostLabel.string = '已满级';
            }
        }
    }

    public setEvolveButtonEnabled(enabled: boolean): void {
        if (!this.evolveButton) return;
        this.evolveButton.interactable = enabled;
    }

    // ======== 结算面板 ========

    public showGameOver(win: boolean, age: Age, kills: number, totalGold: number): void {
        if (!this.gameOverPanel) return;
        if (this.resultLabel) {
            this.resultLabel.string = win ? '🎉 胜利！' : '💀 失败...';
        }
        if (this.statsLabel) {
            this.statsLabel.string = `时代: ${AGE_NAMES[age]}  击杀: ${kills}  总金币: ${totalGold}`;
        }
        this.gameOverPanel.active = true;
    }

    public hideGameOver(): void {
        if (this.gameOverPanel) {
            this.gameOverPanel.active = false;
        }
    }
}
