import { _decorator, Component, Node, Label, Sprite, tween, Vec3 } from 'cc';
import { getTileColor, TileData } from './GameConfig';

const { ccclass, property } = _decorator;

@ccclass('Tile')
export class Tile extends Component {
    @property(Label)
    valueLabel: Label | null = null;
    
    @property(Sprite)
    bgSprite: Sprite | null = null;
    
    private _data: TileData | null = null;
    private _cellSize: number = 100;
    private _spacing: number = 10;
    
    setup(data: TileData, cellSize: number, spacing: number): void {
        this._data = data;
        this._cellSize = cellSize;
        this._spacing = spacing;
        this.updateVisual();
        this.updatePosition();
    }
    
    getData(): TileData | null {
        return this._data;
    }
    
    updateData(data: TileData): void {
        this._data = data;
        this.updateVisual();
    }
    
    updatePosition(animate: boolean = false): void {
        if (!this._data) return;
        
        const x = this._data.col * (this._cellSize + this._spacing);
        const y = -this._data.row * (this._cellSize + this._spacing);
        const targetPos = new Vec3(x, y, 0);
        
        if (animate) {
            tween(this.node)
                .to(0.15, { position: targetPos }, { easing: 'quadOut' })
                .start();
        } else {
            this.node.setPosition(targetPos);
        }
    }
    
    playMergeAnimation(): void {
        tween(this.node)
            .to(0.075, { scale: new Vec3(1.2, 1.2, 1) })
            .to(0.075, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }
    
    playAppearAnimation(): void {
        this.node.setScale(0, 0, 1);
        tween(this.node)
            .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }
    
    private updateVisual(): void {
        if (!this._data) return;
        
        // 更新数字
        if (this.valueLabel) {
            this.valueLabel.string = this._data.value.toString();
        }
        
        // 更新颜色
        const colors = getTileColor(this._data.value);
        if (this.bgSprite) {
            this.bgSprite.color = colors.bg;
        }
        if (this.valueLabel) {
            this.valueLabel.color = colors.text;
        }
    }
}
