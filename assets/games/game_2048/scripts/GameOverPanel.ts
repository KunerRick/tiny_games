import { _decorator, Component, Node, Button, Label } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('GameOverPanel')
export class GameOverPanel extends Component {
    @property(Label)
    scoreValueLabel: Label | null = null;

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

    show(score: number, onRestart: () => void, onBack: () => void): void {
        this._onRestart = onRestart;
        this._onBack = onBack;

        // 更新分数显示
        if (this.scoreValueLabel) {
            this.scoreValueLabel.string = score.toString();
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
        this.hide();
        this._onRestart?.();
    }

    private onBackClick(): void {
        this.hide();
        this._onBack?.();
    }
}
