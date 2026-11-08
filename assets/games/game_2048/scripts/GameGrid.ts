import { _decorator, Component, Node, Prefab, instantiate, Size, Graphics } from 'cc';
import { TileData, GridSize, MoveResult, Direction, generateTileId } from './GameConfig';
import { Tile } from './Tile';
import { COLOR, hex } from '../../../common/ui/UITheme';

const { ccclass, property } = _decorator;

// 与全站统一：凹坑底 + 稍亮一档的格子 + 描边，深色底上才有层次
const GRID_BG_COLOR = hex(COLOR.SLOT_EMPTY_BG);
const GRID_BORDER_COLOR = hex(COLOR.PANEL_BORDER);
const CELL_BG_COLOR = hex(COLOR.PANEL_BG);
const CELL_CORNER_RADIUS = 8;

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

        // 外描边：深底 + 深底相邻时（相机清屏色也是深蓝）没有边界，加一圈细线才分得清棋盘
        g.strokeColor = GRID_BORDER_COLOR;
        g.lineWidth = 2;
        g.roundRect(bgX, bgY, bgW, bgH, r);
        g.stroke();

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
    //
    // 不改入参：旧实现直接往 `tiles` 里的对象写新坐标，导致之后判断
    // 「有没有动过」时读到的已经是改过的值 —— 纯滑动（没有合并）会被判成
    // `hasMoved === false`，画面不动、数据却已移位，下一手就错位。
    move(tiles: TileData[], direction: Direction, gridSize: GridSize): MoveResult {
        const newTiles: TileData[] = [];
        let scoreGained = 0;

        const isHorizontal = direction === Direction.LEFT || direction === Direction.RIGHT;
        const isReverse = direction === Direction.RIGHT || direction === Direction.DOWN;
        const posKey = isHorizontal ? 'col' : 'row';

        for (let i = 0; i < gridSize; i++) {
            const lineTiles = tiles
                .filter(t => (isHorizontal ? t.row : t.col) === i)
                .sort((a, b) => (a as any)[posKey] - (b as any)[posKey]);
            if (lineTiles.length === 0) continue;

            // 统一按「滑动方向」读：反向时从远端的牌开始合并
            const ordered = isReverse ? lineTiles.slice().reverse() : lineTiles;
            const placed: TileData[] = [];
            let wp = 0;
            for (let rp = 0; rp < ordered.length; rp++) {
                const current = ordered[rp];
                const next = rp + 1 < ordered.length ? ordered[rp + 1] : null;
                const pos = isReverse ? gridSize - 1 - wp : wp;
                // 上一手留下的 isMerged 标记不能带进新一帧，否则会重复播合并动画
                const { isMerged: _stale, ...clean } = current;

                if (next && current.value === next.value) {
                    placed.push({
                        ...clean,
                        [posKey]: pos,
                        value: current.value * 2,
                        isMerged: true,
                    });
                    scoreGained += current.value * 2;
                    rp++; // 跳过被吞掉的那张
                } else {
                    placed.push({ ...clean, [posKey]: pos });
                }
                wp++;
            }
            newTiles.push(...(isReverse ? placed.reverse() : placed));
        }

        // 与原始数据比较：位置 / 数值有变化，或牌数变少（发生合并）才算动过
        const originalMap = new Map(tiles.map(t => [t.id, t]));
        const hasMoved = newTiles.length !== tiles.length || newTiles.some(nt => {
            const ot = originalMap.get(nt.id);
            return !ot || ot.row !== nt.row || ot.col !== nt.col || ot.value !== nt.value;
        });

        return { tiles: newTiles, scoreGained, hasMoved };
    }
    
    spawnRandomTile(tiles: TileData[], gridSize: GridSize): TileData | null {
        // 使用 Set 来更准确地跟踪已占用的位置
        const occupiedPositions = new Set<string>();
        for (const t of tiles) {
            if (t.row !== undefined && t.col !== undefined &&
                t.row >= 0 && t.row < gridSize &&
                t.col >= 0 && t.col < gridSize) {
                occupiedPositions.add(`${t.row},${t.col}`);
            }
        }

        // 找出所有空位
        const emptyCells: {row: number, col: number}[] = [];
        for (let row = 0; row < gridSize; row++) {
            for (let col = 0; col < gridSize; col++) {
                if (!occupiedPositions.has(`${row},${col}`)) {
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
        // 过滤掉无效的 tile（位置无效或重复）
        const validTiles = tiles.filter(t =>
            t.row !== undefined && t.col !== undefined &&
            t.row >= 0 && t.row < gridSize &&
            t.col >= 0 && t.col < gridSize
        );

        // 使用 Map 去重，确保每个位置只有一个 tile
        const positionMap = new Map<string, TileData>();
        for (const t of validTiles) {
            const key = `${t.row},${t.col}`;
            if (!positionMap.has(key)) {
                positionMap.set(key, t);
            }
        }

        const uniqueTiles = Array.from(positionMap.values());

        // 还有空位？
        if (uniqueTiles.length < gridSize * gridSize) return false;

        // 检查是否有可合并的相邻方块
        for (const tile of uniqueTiles) {
            const neighbors = [
                {row: tile.row - 1, col: tile.col},
                {row: tile.row + 1, col: tile.col},
                {row: tile.row, col: tile.col - 1},
                {row: tile.row, col: tile.col + 1},
            ];

            for (const n of neighbors) {
                // 跳过超出边界的邻居
                if (n.row < 0 || n.row >= gridSize || n.col < 0 || n.col >= gridSize) {
                    continue;
                }
                const neighborKey = `${n.row},${n.col}`;
                const neighbor = positionMap.get(neighborKey);
                if (neighbor && neighbor.value === tile.value) {
                    return false;
                }
            }
        }

        return true;
    }
}
