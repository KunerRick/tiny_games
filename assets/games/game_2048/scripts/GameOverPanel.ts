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
    private _showCalled: boolean = false;

    onLoad() {
        if (!this._showCalled) {
            this.node.active = false;
        }
    }

    onDestroy(): void {
        // 场景销毁时，@property(Node) getter 可能返回 null（节点已被销毁）
        // Cocos 自动清理以 this 为 target 的事件监听，无需手动解绑
        // 只清 JS 引用，不调任何节点/组件方法
        this._onRestart = null;
        this._onBack = null;
    }

    show(score: number, onRestart: () => void, onBack: () => void, bestScore: number = 0, isWin: boolean = false): void {
        this._showCalled = true;

        this._onRestart = onRestart;
        this._onBack = onBack;

        // 先解绑再绑定，防止重复调用 show() 时事件累积
        this.unbindEvents();
        this.bindEvents();

        if (this.titleLabel) {
            this.titleLabel.string = isWin ? '恭喜通关！' : '游戏结束';
        }

        if (this.scoreValueLabel) {
            this.scoreValueLabel.string = score.toString();
        }
        if (this.bestScoreValueLabel) {
            this.bestScoreValueLabel.string = bestScore.toString();
        }

        this.node.setSiblingIndex(9999);
        this.node.active = true;
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
