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
    private _onConfirm: ((size: GridSize) => void) | null = null;

    onLoad() {
        // 设置滑条事件
        if (this.gridSizeSlider) {
            this.gridSizeSlider.node.on(Slider.EventType.SLIDE, this.onSliderChanged, this);
        }

        // 设置开始按钮事件
        if (this.startButton) {
            this.startButton.node.on(Node.EventType.TOUCH_END, this.onStart, this);
        }
        // 设置取消按钮事件
        if (this.cancelButton) {
            this.cancelButton.node.on(Node.EventType.TOUCH_END, this.onCancel, this);
        }
    }

    show(currentSize: GridSize, onConfirm: (size: GridSize) => void): void {
        this._selectedSize = currentSize;
        this._onConfirm = onConfirm;

        // 设置滑条初始值 (4-8 映射到 0-1)
        if (this.gridSizeSlider) {
            this.gridSizeSlider.progress = (currentSize - 4) / 4;
        }

        // 更新数值显示
        this.updateValueLabel();

        this.node.active = true;
    }

    hide(): void {
        this.node.active = false;
    }

    private onSliderChanged(): void {
        if (!this.gridSizeSlider) return;

        // 将滑条进度 (0-1) 映射到网格大小 (4-8)
        const rawValue = this.gridSizeSlider.progress * 4; // 0-4
        const index = Math.round(rawValue);
        this._selectedSize = GRID_SIZES[index];

        // 吸附到刻度
        this.gridSizeSlider.progress = index / 4;

        // 更新显示
        this.updateValueLabel();
    }

    private updateValueLabel(): void {
        if (this.gridSizeValueLabel) {
            this.gridSizeValueLabel.string = this._selectedSize.toString();
        }
    }

    private onStart(): void {
        this._onConfirm?.(this._selectedSize);
        this.hide();
    }

    private onCancel(): void {
        this.hide();
    }
}
