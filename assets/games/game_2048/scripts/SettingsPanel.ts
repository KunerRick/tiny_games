import { _decorator, Component, Node, Button, Label, Slider } from 'cc';
import { GridSize, GRID_SIZES } from './GameConfig';

const { ccclass, property } = _decorator;

@ccclass('SettingsPanel')
export class SettingsPanel extends Component {
    @property(Slider)
    gridSizeSlider: Slider | null = null;

    @property(Label)
    gridSizeValueLabel: Label | null = null;

    @property(Button)
    startButton: Button | null = null;

    @property(Button)
    cancelButton: Button | null = null;

    private _selectedSize: GridSize = 4;
    private _currentSize: GridSize = 4;
    /** 改了棋盘尺寸时的二次确认：第一次点「开始」只提示会重开，再点一次才生效 */
    private _confirmArmed = false;
    private _onConfirm: ((size: GridSize) => void) | null = null;
    private _showCalled: boolean = false;

    onLoad(): void {
        // 场景若误存成 active，开局会直接盖住棋盘；show() 之前一律隐藏
        if (!this._showCalled) {
            this.node.active = false;
        }
    }

    onDestroy(): void {
        // ❌ 不能访问 @property(Node)，场景销毁时节点已被引擎清理
        // 事件由 Cocos 自动解除（注册时第三个参数 this 作为 target）
    }

    show(currentSize: GridSize, onConfirm: (size: GridSize) => void): void {
        // 必须先置位再激活：节点首次激活会同步触发 onLoad
        this._showCalled = true;
        this._selectedSize = currentSize;
        this._currentSize = currentSize;
        this._confirmArmed = false;
        this._onConfirm = onConfirm;

        // 先解绑再绑定，防止重复调用 show() 时事件累积
        this.unbindEvents();
        this.bindEvents();

        // 设置滑条初始值 (4-8 映射到 0-1)
        if (this.gridSizeSlider) {
            this.gridSizeSlider.progress = (currentSize - 4) / 4;
        }

        // 更新数值显示
        this.updateValueLabel();

        this.node.active = true;
    }

    hide(): void {
        this.unbindEvents();
        this.node.active = false;
    }

    private bindEvents(): void {
        if (this.gridSizeSlider) {
            this.gridSizeSlider.node.on('slide', this.onSliderChanged, this);
        }
        if (this.startButton) {
            this.startButton.node.on(Node.EventType.TOUCH_END, this.onStart, this);
        }
        if (this.cancelButton) {
            this.cancelButton.node.on(Node.EventType.TOUCH_END, this.onCancel, this);
        }
    }

    private unbindEvents(): void {
        if (this.gridSizeSlider) {
            this.gridSizeSlider.node.off('slide', this.onSliderChanged, this);
        }
        if (this.startButton) {
            this.startButton.node.off(Node.EventType.TOUCH_END, this.onStart, this);
        }
        if (this.cancelButton) {
            this.cancelButton.node.off(Node.EventType.TOUCH_END, this.onCancel, this);
        }
    }

    private onSliderChanged(): void {
        if (!this.gridSizeSlider) return;

        // 将滑条进度 (0-1) 映射到网格大小 (4-8)
        const rawValue = this.gridSizeSlider.progress * 4; // 0-4
        const index = Math.round(rawValue);
        this._selectedSize = GRID_SIZES[index];
        this._confirmArmed = false;

        // 吸附到刻度
        this.gridSizeSlider.progress = index / 4;

        // 更新显示
        this.updateValueLabel();
    }

    private updateValueLabel(): void {
        if (this.gridSizeValueLabel) {
            this.gridSizeValueLabel.string = this._selectedSize.toString();
        }
        // 尺寸和当前牌局不同时，按钮文案先说明「会重开」，避免玩家以为只是改设置
        const label = this.startButton ? this.startButton.node.getComponentInChildren(Label) : null;
        if (label) {
            const changed = this._selectedSize !== this._currentSize;
            label.string = !changed
                ? '开始游戏'
                : this._confirmArmed
                    ? `再点一次确认 · 重开为 ${this._selectedSize}×${this._selectedSize}`
                    : `改为 ${this._selectedSize}×${this._selectedSize}（会重开）`;
        }
    }

    private onStart(): void {
        // 换尺寸 = 放弃当前牌局，需要二次确认
        if (this._selectedSize !== this._currentSize && !this._confirmArmed) {
            this._confirmArmed = true;
            this.updateValueLabel();
            return;
        }
        this._onConfirm?.(this._selectedSize);
        this.hide();
    }

    private onCancel(): void {
        this.hide();
    }
}
