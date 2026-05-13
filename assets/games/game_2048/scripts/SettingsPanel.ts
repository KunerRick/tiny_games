import { _decorator, Component, Node, Toggle, Button } from 'cc';
import { GridSize, GRID_SIZES } from './GameConfig';

const { ccclass, property } = _decorator;

@ccclass('SettingsPanel')
export class SettingsPanel extends Component {
    @property([Toggle])
    gridSizeToggles: Toggle[] = [];
    
    @property(Button)
    startButton: Button | null = null;
    
    @property(Button)
    cancelButton: Button | null = null;
    
    private _selectedSize: GridSize = 4;
    private _onConfirm: ((size: GridSize) => void) | null = null;
    
    onLoad() {
        // 设置 toggle 事件
        this.gridSizeToggles.forEach((toggle, index) => {
            toggle.node.on(Node.EventType.TOUCH_END, () => {
                this.onGridSizeSelected(GRID_SIZES[index]);
            }, this);
        });
        
        // 设置按钮事件
        if (this.startButton) {
            this.startButton.node.on(Node.EventType.TOUCH_END, this.onStart, this);
        }
        if (this.cancelButton) {
            this.cancelButton.node.on(Node.EventType.TOUCH_END, this.onCancel, this);
        }
    }
    
    show(currentSize: GridSize, onConfirm: (size: GridSize) => void): void {
        this._selectedSize = currentSize;
        this._onConfirm = onConfirm;
        
        // 更新 toggle 状态
        const index = GRID_SIZES.indexOf(currentSize);
        this.gridSizeToggles.forEach((toggle, i) => {
            toggle.isChecked = i === index;
        });
        
        this.node.active = true;
    }
    
    hide(): void {
        this.node.active = false;
    }
    
    private onGridSizeSelected(size: GridSize): void {
        this._selectedSize = size;
        
        // 更新 toggle 显示
        const index = GRID_SIZES.indexOf(size);
        this.gridSizeToggles.forEach((toggle, i) => {
            toggle.isChecked = i === index;
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
