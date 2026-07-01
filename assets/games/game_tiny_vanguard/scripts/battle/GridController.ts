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
  public static readonly DEFAULT_CELL_COLOR = Color.WHITE;

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

        const button = cell.getComponent(Button);
        if (button) {
          cell['_gridRow'] = row;
          cell['_gridCol'] = col;
          button.node.on(Button.EventType.CLICK, this.onCellButtonClicked, this);
        }
      }
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

  private onCellButtonClicked(button: Button): void {
    const row = button.node['_gridRow'] as number;
    const col = button.node['_gridCol'] as number;
    this.onCellTapped(row, col);
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
          sprite.color = GridController.DEFAULT_CELL_COLOR;
        }
      }
    }
    this._highlightedCells = [];
  }

  setRowsInteractable(rows: number[], interactable: boolean): void {
    // 只改变交互性，不改变颜色（颜色由 highlightCells 统一管理）
    for (const row of rows) {
      for (let col = 0; col < GridController.GRID_SIZE; col++) {
        const cell = this._cells[row]?.[col];
        if (!cell?.isValid) continue;
        const btn = cell.getComponent(Button);
        if (btn) btn.interactable = interactable;
      }
    }
  }

  onDestroy(): void {
    this._onCellClickCallback = null;
    for (let row = 0; row < GridController.GRID_SIZE; row++) {
      for (let col = 0; col < GridController.GRID_SIZE; col++) {
        const cell = this._cells[row]?.[col];
        if (cell?.isValid) {
          const btn = cell.getComponent(Button);
          if (btn) {
            btn.node.off(Button.EventType.CLICK, this.onCellButtonClicked, this);
          }
        }
      }
    }
    this._cells = [];
    this._highlightedCells = [];
  }

  positionToGrid(worldPos: { x: number; y: number }): GridPosition | null {
    const col = Math.round(worldPos.x / GridController.CELL_SIZE + 2.5);
    const row = Math.round(worldPos.y / GridController.CELL_SIZE + 2.5);

    if (row < 0 || row >= GridController.GRID_SIZE || col < 0 || col >= GridController.GRID_SIZE) {
      return null;
    }
    return { row, col };
  }
}
