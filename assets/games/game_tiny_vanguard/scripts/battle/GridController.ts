import { _decorator, Component, Node, Sprite, Color, instantiate, Prefab, Button } from 'cc';
const { ccclass, property } = _decorator;

export interface GridPosition {
  row: number;
  col: number;
}

@ccclass('GridController')
export class GridController extends Component {
  public static readonly GRID_SIZE = 6;
  public static readonly CELL_SIZE = 80;

  @property({ type: Node, tooltip: '网格容器节点' })
  gridContainer: Node = null;

  @property({ type: Prefab, tooltip: '格子预制体' })
  cellPrefab: Prefab = null;

  private _cells: Node[][] = [];
  private _highlightedCells: Node[] = [];
  private _onCellClickCallback: ((pos: GridPosition) => void) | null = null;

  onLoad(): void {
    this.initGrid();
  }

  private initGrid(): void {
    if (!this.gridContainer || !this.cellPrefab) return;

    for (let row = 0; row < GridController.GRID_SIZE; row++) {
      this._cells[row] = [];
      for (let col = 0; col < GridController.GRID_SIZE; col++) {
        const cell = instantiate(this.cellPrefab);
        cell.name = `Cell_${row}_${col}`;
        cell.setPosition(
          (col - 2.5) * GridController.CELL_SIZE,
          (row - 2.5) * GridController.CELL_SIZE
        );
        this.gridContainer.addChild(cell);
        this._cells[row][col] = cell;

        cell._data = { row, col };

        const button = cell.getComponent(Button);
        if (button) {
          button.node.on(Button.EventType.CLICK, this.onCellButtonClick, this);
        }
      }
    }
  }

  private onCellButtonClick(button: Button): void {
    const cell = button.node;
    if (cell && cell._data) {
      const { row, col } = cell._data as { row: number; col: number };
      this.onCellTapped(row, col);
    }
  }

  setCellClickCallback(callback: (pos: GridPosition) => void): void {
    this._onCellClickCallback = callback;
  }

  private onCellTapped(row: number, col: number): void {
    if (this._onCellClickCallback) {
      this._onCellClickCallback({ row, col });
    }
  }

  getCell(row: number, col: number): Node | null {
    if (row < 0 || row >= GridController.GRID_SIZE || col < 0 || col >= GridController.GRID_SIZE) return null;
    return this._cells[row]?.[col] ?? null;
  }

  highlightCells(positions: GridPosition[], color: Color): void {
    this.clearHighlights();
    for (const pos of positions) {
      const cell = this.getCell(pos.row, pos.col);
      if (cell) {
        const sprite = cell.getComponent(Sprite);
        if (sprite) {
          sprite.color = color;
        }
        this._highlightedCells.push(cell);
      }
    }
  }

  clearHighlights(): void {
    for (const cell of this._highlightedCells) {
      if (cell?.isValid) {
        const sprite = cell.getComponent(Sprite);
        if (sprite) {
          sprite.color = Color.WHITE;
        }
      }
    }
    this._highlightedCells = [];
  }

  positionToGrid(worldPos: { x: number; y: number }): GridPosition | null {
    const localPos = this.gridContainer.getComponent(Node)?.getComponent(Node).getPosition();
    return null;
  }
}
