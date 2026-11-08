import { _decorator, Component, Node, Sprite, Color, Graphics, UITransform, instantiate, Prefab, Button } from 'cc';
import { COLOR, GRID, hex } from '../config/Theme';
const { ccclass, property } = _decorator;

export interface GridPosition {
  row: number;
  col: number;
}

@ccclass('GridController')
export class GridController extends Component {
  public static readonly GRID_SIZE = 6;
  public static readonly CELL_SIZE = 80;
  // 棋盘格底色与选中格色统一走设计令牌（原为散落的魔法 RGB）
  public static readonly DEFAULT_CELL_COLOR = GRID.CELL_DEFAULT;
  public static readonly SELECTED_CELL_COLOR = GRID.CELL_SELECTED;

  @property({ type: Node, tooltip: '网格容器节点' })
  gridContainer: Node = null;

  @property({ type: Prefab, tooltip: '格子预制体' })
  cellPrefab: Prefab = null;

  private _cells: Node[][] = [];
  private _highlightedCells: Node[] = [];
  private _previewCell: Node | null = null;
  private _previewOriginalColor: Color | null = null;
  private _aoePreviewCells: Node[] = [];
  private _selectedTargetCell: Node | null = null;
  private _selectedTargetOriginalColor: Color | null = null;
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

        // 显式把格子设为令牌底色：CellPrefab 里写死的是旧色 e8e8e8，
        // 而 clearHighlights 恢复的也是 DEFAULT_CELL_COLOR —— 两处不一致会让
        // 首帧与后续帧颜色跳变。
        const cellSprite = cell.getComponent(Sprite);
        if (cellSprite) {
          cellSprite.color = GridController.DEFAULT_CELL_COLOR;
        }

        const button = cell.getComponent(Button);
        if (button) {
          cell['_gridRow'] = row;
          cell['_gridCol'] = col;
          button.node.on(Button.EventType.CLICK, this.onCellButtonClicked, this);
        }
      }
    }

    this.drawBoardOverlay();
  }

  /**
   * 棋盘分割线 + 中线 + 外框。
   *
   * 36 个格子是同一张白色 splash 贴图染色，部署阶段又被整片刷成"淡绿 / 淡灰"，
   * 相邻同色格直接糊成一整块矩形 —— 一眼看不出这是 6×6 的棋盘。
   * 这里在格子之上铺一层矢量分割线（1px、极低透明度），敌方半场与玩家半场之间
   * 再补一条更亮的中线；外框用圆角描边收边。
   */
  private drawBoardOverlay(): void {
    if (!this.gridContainer) return;
    const size = GridController.GRID_SIZE * GridController.CELL_SIZE;
    const half = size / 2;

    let overlay = this.gridContainer.getChildByName('BoardOverlay');
    if (!overlay) {
      overlay = new Node('BoardOverlay');
      overlay.addComponent(UITransform).setContentSize(size, size);
      this.gridContainer.addChild(overlay);
    }
    overlay.setPosition(0, 0, 0);

    const g = overlay.getComponent(Graphics) ?? overlay.addComponent(Graphics);
    g.clear();

    // 细分割线：太亮会抢单位的颜色，只保留"能看出格子"的强度
    g.strokeColor = hex(COLOR.TEXT_PRIMARY, 42);
    g.lineWidth = 1;
    for (let i = 1; i < GridController.GRID_SIZE; i++) {
      const p = -half + i * GridController.CELL_SIZE;
      g.moveTo(p, -half); g.lineTo(p, half);
      g.moveTo(-half, p); g.lineTo(half, p);
    }
    g.stroke();

    // 中线：玩家半场 / 敌方半场分界
    g.strokeColor = hex(COLOR.TEXT_SECONDARY, 90);
    g.lineWidth = 2;
    g.moveTo(-half, 0); g.lineTo(half, 0);
    g.stroke();

    // 外框 + 四角短括线：给棋盘一个"边界感"
    g.strokeColor = hex(COLOR.PANEL_BORDER, 220);
    g.lineWidth = 2;
    g.rect(-half - 1, -half - 1, size + 2, size + 2);
    g.stroke();

    g.strokeColor = hex(COLOR.TEXT_PRIMARY, 70);
    g.lineWidth = 3;
    const t = 18;
    const c = half + 1;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.moveTo(sx * c, sy * c - sy * t);
      g.lineTo(sx * c, sy * c);
      g.lineTo(sx * c - sx * t, sy * c);
    }
    g.stroke();
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

  setCellColor(pos: GridPosition, color: Color): void {
    const cell = this.getCell(pos.row, pos.col);
    if (cell) {
      const sprite = cell.getComponent(Sprite);
      if (sprite) {
        sprite.color = color;
      }
      if (!this._highlightedCells.includes(cell)) {
        this._highlightedCells.push(cell);
      }
    }
  }

  clearHighlights(): void {
    this.clearSelectedTarget();
    // 先恢复预览格原色（预览格可能属于 _highlightedCells），再清空高亮列表
    this.clearPreview();
    this.clearAoePreview();
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

  /** 高亮单个格子为移动预览，保留原色以便切换时恢复 */
  highlightPreviewCell(pos: GridPosition): void {
    this.clearPreview();
    const cell = this.getCell(pos.row, pos.col);
    if (cell) {
      const sprite = cell.getComponent(Sprite);
      if (sprite) {
        this._previewOriginalColor = sprite.color.clone();
        sprite.color = GRID.CELL_PREVIEW;
      }
      this._previewCell = cell;
    }
  }

  /** 清除预览高亮，恢复为原色（避免可移动区域变回地板色） */
  clearPreview(): void {
    if (this._previewCell?.isValid) {
      const sprite = this._previewCell.getComponent(Sprite);
      if (sprite) {
        sprite.color = this._previewOriginalColor ?? GridController.DEFAULT_CELL_COLOR;
      }
    }
    this._previewCell = null;
    this._previewOriginalColor = null;
  }

  /** 高亮选中目标（单体技能目标确认），叠加颜色 */
  highlightSelectedTarget(pos: GridPosition, color: Color): void {
    this.clearSelectedTarget();
    const cell = this.getCell(pos.row, pos.col);
    if (cell) {
      const sprite = cell.getComponent(Sprite);
      if (sprite) {
        this._selectedTargetOriginalColor = sprite.color.clone();
        sprite.color = color;
      }
      this._selectedTargetCell = cell;
    }
  }

  clearSelectedTarget(): void {
    if (this._selectedTargetCell?.isValid && this._selectedTargetOriginalColor) {
      const sprite = this._selectedTargetCell.getComponent(Sprite);
      if (sprite) sprite.color = this._selectedTargetOriginalColor;
    }
    this._selectedTargetCell = null;
    this._selectedTargetOriginalColor = null;
  }

  /** 高亮AOE范围预览（中心和范围用不同颜色） */
  highlightAoePreview(center: GridPosition, positions: GridPosition[], centerColor: Color, rangeColor: Color): void {
    this.clearAoePreview();

    const centerCell = this.getCell(center.row, center.col);
    if (centerCell) {
      const sprite = centerCell.getComponent(Sprite);
      if (sprite) sprite.color = centerColor;
      this._aoePreviewCells.push(centerCell);
    }

    for (const pos of positions) {
      if (pos.row === center.row && pos.col === center.col) continue;
      const cell = this.getCell(pos.row, pos.col);
      if (cell) {
        const sprite = cell.getComponent(Sprite);
        if (sprite) sprite.color = rangeColor;
        this._aoePreviewCells.push(cell);
      }
    }
  }

  clearAoePreview(): void {
    for (const cell of this._aoePreviewCells) {
      if (cell?.isValid && !this._highlightedCells.includes(cell)) {
        const sprite = cell.getComponent(Sprite);
        if (sprite) sprite.color = GridController.DEFAULT_CELL_COLOR;
      }
      // 若 cell 仍在 _highlightedCells 中，则保留其高亮色，避免擦掉移动/攻击范围
    }
    this._aoePreviewCells = [];
  }

  /** 高亮选中单位所在格子（金色标记，与移动/攻击高亮区分） */
  highlightSelectedCell(pos: GridPosition): void {
    const cell = this.getCell(pos.row, pos.col);
    if (cell?.isValid) {
      const sprite = cell.getComponent(Sprite);
      if (sprite) {
        sprite.color = GridController.SELECTED_CELL_COLOR;
      }
      if (!this._highlightedCells.includes(cell)) {
        this._highlightedCells.push(cell);
      }
    }
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
