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
        // 绑定重新开始按钮
        if (this.restartButton) {
            this.restartButton.node.on(Node.EventType.TOUCH_END, this.onRestartClick, this);
        }

        // 绑定返回大厅按钮
        if (this.backButton) {
            this.backButton.node.on(Node.EventType.TOUCH_END, this.onBackClick, this);
        }

        // 默认隐藏
        this.node.active = false;
    }

    show(score: number, onRestart: () => void, onBack: () => void, bestScore: number = 0, isWin: boolean = false): void {
        this._onRestart = onRestart;
        this._onBack = onBack;

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
        this.node.active = true;
    }

    hide(): void {
        this.node.active = false;
        this._onRestart = null;
        this._onBack = null;
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
