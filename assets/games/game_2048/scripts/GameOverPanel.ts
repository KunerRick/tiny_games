import { _decorator, Component, Node, Button, Label } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('GameOverPanel')
export class GameOverPanel extends Component {
    @property(Label)
    scoreValueLabel: Label | null = null;

    @property(Label)
    bestScoreValueLabel: Label | null = null;

    @property(Label)
    titleLabel: Label | null = null;

    @property(Button)
    restartButton: Button | null = null;

    @property(Button)
    backButton: Button | null = null;

    private _onRestart: (() => void) | null = null;
    private _onBack: (() => void) | null = null;

    onLoad() {
        // 默认隐藏
        if (this.node) {
            this.node.active = false;
        }
    }

    show(score: number, onRestart: () => void, onBack: () => void, bestScore: number = 0, isWin: boolean = false): void {
        this._onRestart = onRestart;
        this._onBack = onBack;

        // 绑定事件（在 show 中绑定，确保 Button 已初始化完成）
        this.bindEvents();

        // 更新标题
        if (this.titleLabel) {
            this.titleLabel.string = isWin ? '恭喜通关！' : '游戏结束';
        }

        // 更新分数显示
        if (this.scoreValueLabel) {
            this.scoreValueLabel.string = score.toString();
        }
        if (this.bestScoreValueLabel) {
            this.bestScoreValueLabel.string = bestScore.toString();
        }

        // 显示面板
        if (this.node) {
            // 确保面板在最上层
            this.node.setSiblingIndex(9999);
            this.node.active = true;
        }
    }

    hide(): void {
        this.unbindEvents();
        this.node.active = false;
        this._onRestart = null;
        this._onBack = null;
    }

    private bindEvents(): void {
        if (this.restartButton) {
            this.restartButton.node.on(Node.EventType.TOUCH_END, this.onRestartClick, this);
        }
        if (this.backButton) {
            this.backButton.node.on(Node.EventType.TOUCH_END, this.onBackClick, this);
        }
    }

    private unbindEvents(): void {
        if (this.restartButton) {
            this.restartButton.node.off(Node.EventType.TOUCH_END, this.onRestartClick, this);
        }
        if (this.backButton) {
            this.backButton.node.off(Node.EventType.TOUCH_END, this.onBackClick, this);
        }
    }

    private onRestartClick(): void {
        const cb = this._onRestart;
        this.hide();
        cb?.();
    }

    private onBackClick(): void {
        const cb = this._onBack;
        this.hide();
        cb?.();
    }
}
