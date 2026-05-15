import { _decorator, Component, Node, Prefab, instantiate, Size, Graphics, Color } from 'cc';
import { TileData, GridSize, MoveResult, Direction, generateTileId } from './GameConfig';
import { Tile } from './Tile';

const { ccclass, property } = _decorator;

const GRID_BG_COLOR = new Color(187, 173, 160);
const CELL_BG_COLOR = new Color(205, 193, 180);
const CELL_CORNER_RADIUS = 6;

@ccclass('GameGrid')
export class GameGrid extends Component {
    @property(Prefab)
    tilePrefab: Prefab | null = null;
    
    private _gridSize: GridSize = 4;
    private _tiles: Map<number, Node> = new Map();
    private _cellSize: number = 80;
    private _spacing: number = 10;
    private _bgNode: Node | null = null;
    
    init(gridSize: GridSize): void {
        this._gridSize = gridSize;
        this.calculateCellSize();
        this.centerGrid();
        this.clearTiles();
        this.renderGridBackground();
    }

    private renderGridBackground(): void {
        if (this._bgNode) {
            this._bgNode.removeFromParent();
            this._bgNode.destroy();
            this._bgNode = null;
        }

        this._bgNode = new Node('gridBg');
        this.node.addChild(this._bgNode);
        this._bgNode.setSiblingIndex(0);

        const g = this._bgNode.addComponent(Graphics);
        const cs = this._cellSize;
        const sp = this._spacing;
        const half = cs / 2;
        const n = this._gridSize;
        const maxPos = (n - 1) * (cs + sp);
        const r = Math.min(CELL_CORNER_RADIUS, half);

        const bgX = -half - sp / 2;
        const bgY = -(maxPos + half) - sp / 2;
        const bgW = maxPos + cs + sp;
        const bgH = maxPos + cs + sp;

        g.fillColor = GRID_BG_COLOR;
        g.roundRect(bgX, bgY, bgW, bgH, r);
        g.fill();

        g.fillColor = CELL_BG_COLOR;
        for (let row = 0; row < n; row++) {
            for (let col = 0; col < n; col++) {
                const cx = col * (cs + sp);
                const cy = -row * (cs + sp);
                g.roundRect(cx - half, cy - half, cs, cs, r);
                g.fill();
            }
        }
    }

    private centerGrid(): void {
        // Tile positions: x = col * (cellSize + spacing)
        // First tile at x=0, last at x=(gridSize-1)*(cellSize+spacing)
        // Shift gameGrid so the tile range is centered in the container
        const totalSpan = (this._gridSize - 1) * (this._cellSize + this._spacing);
        this.node.setPosition(-totalSpan / 2, totalSpan / 2);
    }
    
    private calculateCellSize(): void {
        const uiTransform = this.node.getComponent('cc.UITransform') as any;
        if (!uiTransform) return;
        
        const containerSize = uiTransform.contentSize as Size;
        const totalSpacing = (this._gridSize - 1) * this._spacing;
        this._cellSize = (Math.min(containerSize.width, containerSize.height) - totalSpacing) / this._gridSize;
    }
    
    clearTiles(): void {
        this._tiles.forEach(node => node.destroy());
        this._tiles.clear();
    }
    
    spawnTile(tileData: TileData): void {
        if (!this.tilePrefab) return;
        
        const node = instantiate(this.tilePrefab);
        this.node.addChild(node);
        
        const tile = node.getComponent(Tile);
        if (tile) {
            tile.setup(tileData, this._cellSize, this._spacing);
            if (tileData.isNew) {
                tile.playAppearAnimation();
            }
        }
        
        this._tiles.set(tileData.id, node);
    }
    
    updateTiles(tiles: TileData[], animated: boolean = true): void {
        // 更新现有方块位置
        tiles.forEach(data => {
            const node = this._tiles.get(data.id);
            if (node) {
                const tile = node.getComponent(Tile);
                if (tile) {
                    tile.updateData(data);
                    tile.updatePosition(animated);
                    if (data.isMerged && animated) {
                        tile.playMergeAnimation();
                    }
                }
            }
        });
    }
    
    removeMergedTiles(mergedIds: number[]): void {
        mergedIds.forEach(id => {
            const node = this._tiles.get(id);
            if (node) {
                node.destroy();
                this._tiles.delete(id);
            }
        });
    }

    /** 清理不在活跃 ID 列表中的旧节点（合并后被吞掉的方块） */
    retainOnly(activeIds: Set<number>): void {
        const toRemove: number[] = [];
        this._tiles.forEach((_node, id) => {
            if (!activeIds.has(id)) {
                toRemove.push(id);
            }
        });
        this.removeMergedTiles(toRemove);
    }
    
    // 游戏逻辑：移动和合并
    move(tiles: TileData[], direction: Direction, gridSize: GridSize): MoveResult {
        let newTiles: TileData[] = [];
        let scoreGained = 0;
        
        // 根据方向处理每一行/列
        const isHorizontal = direction === Direction.LEFT || direction === Direction.RIGHT;
        const isReverse = direction === Direction.RIGHT || direction === Direction.DOWN;
        
        for (let i = 0; i < gridSize; i++) {
            // 获取该行/列的方块
            let lineTiles = tiles.filter(t => isHorizontal ? t.row === i : t.col === i);
            
            // 按位置排序
            const key = isHorizontal ? 'col' : 'row';
            lineTiles.sort((a, b) => (a as any)[key] - (b as any)[key]);
            
            // 反向时反转数组
            if (isReverse) {
                lineTiles.reverse();
            }
            
            // 合并相同数字
            const merged: TileData[] = [];
            let pos = 0;
            
            for (let j = 0; j < lineTiles.length; j++) {
                const current = lineTiles[j];
                const next = lineTiles[j + 1];
                
                if (next && current.value === next.value) {
                    // 合并
                    merged.push({
                        ...current,
                        [isHorizontal ? 'col' : 'row']: isReverse ? gridSize - 1 - pos : pos,
                        value: current.value * 2,
                        isMerged: true,
                    });
                    scoreGained += current.value * 2;
                    j++;
                } else {
                    // 只移动
                    merged.push({
                        ...current,
                        [isHorizontal ? 'col' : 'row']: isReverse ? gridSize - 1 - pos : pos,
                    });
                }
                pos++;
            }
            
            newTiles.push(...merged);
        }
        
        // 基于 tile ID 和位置对比，判断是否有实际移动或合并
        const newTileIds = new Set(newTiles.map(t => t.id));
        const hasMoved = tiles.some(t =>
            !newTileIds.has(t.id) ||
            newTiles.some(nt => nt.id === t.id && (nt.row !== t.row || nt.col !== t.col))
        );

        return { tiles: newTiles, scoreGained, hasMoved };
    }
    
    spawnRandomTile(tiles: TileData[], gridSize: GridSize): TileData | null {
        // 找出所有空位
        const emptyCells: {row: number, col: number}[] = [];
        
        for (let row = 0; row < gridSize; row++) {
            for (let col = 0; col < gridSize; col++) {
                if (!tiles.some(t => t.row === row && t.col === col)) {
                    emptyCells.push({row, col});
                }
            }
        }
        
        if (emptyCells.length === 0) return null;
        
        // 随机选择一个空位
        const cell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        
        // 90%概率生成2，10%概率生成4
        const value = Math.random() < 0.9 ? 2 : 4;
        
        return {
            id: generateTileId(),
            row: cell.row,
            col: cell.col,
            value: value,
            isNew: true,
        };
    }
    
    checkGameOver(tiles: TileData[], gridSize: GridSize): boolean {
        // 还有空位？
        if (tiles.length < gridSize * gridSize) return false;
        
        // 检查是否有可合并的相邻方块
        for (const tile of tiles) {
            const neighbors = [
                {row: tile.row - 1, col: tile.col},
                {row: tile.row + 1, col: tile.col},
                {row: tile.row, col: tile.col - 1},
                {row: tile.row, col: tile.col + 1},
            ];
            
            for (const n of neighbors) {
                const neighbor = tiles.find(t => t.row === n.row && t.col === n.col);
                if (neighbor && neighbor.value === tile.value) {
                    return false;
                }
            }
        }
        
        return true;
    }
}
