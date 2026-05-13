import { _decorator, Component, Node, Button, Color, Sprite } from 'cc';
import { GridSize, GRID_SIZES } from './GameConfig';

const { ccclass, property } = _decorator;

// 选中状态的颜色
const SELECTED_COLOR = new Color(100, 180, 100, 255);
const NORMAL_COLOR = new Color(200, 200, 200, 255);

@ccclass('SettingsPanel')
export class SettingsPanel extends Component {
    @property([Button])
    gridSizeButtons: Button[] = [];
    
    @property(Button)
    startButton: Button | null = null;
    
    @property(Button)
    cancelButton: Button | null = null;
    
    private _selectedSize: GridSize = 4;
    private _onConfirm: ((size: GridSize) => void) | null = null;
    
    onLoad() {
        // 设置按钮事件
        this.gridSizeButtons.forEach((button, index) => {
            button.node.on(Node.EventType.TOUCH_END, () => {
                this.onGridSizeSelected(GRID_SIZES[index]);
            }, this);
        });
        
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
        
        // 更新按钮显示状态
        this.updateButtonVisuals();
        
        this.node.active = true;
    }
    
    hide(): void {
        this.node.active = false;
    }
    
    private onGridSizeSelected(size: GridSize): void {
        this._selectedSize = size;
        this.updateButtonVisuals();
    }
    
    private updateButtonVisuals(): void {
        const index = GRID_SIZES.indexOf(this._selectedSize);
        this.gridSizeButtons.forEach((button, i) => {
            const sprite = button.node.getComponent(Sprite);
            if (sprite) {
                sprite.color = i === index ? SELECTED_COLOR : NORMAL_COLOR;
            }
        });
    }
    
    private onStart(): void {
        this._onConfirm?.(this._selectedSize);
        this.hide();
    }
    
    private onCancel(): void {
        this.hide();
    }
}
