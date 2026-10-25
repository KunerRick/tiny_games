/**
 * 方块坠落 — 棋盘数据与碰撞/收行逻辑。
 *
 * 坐标系：row 0 在底、row 19 在顶，row 20–21 为隐藏行。
 * 本文件不依赖 cc。
 */

import { BOARD_COLS, BOARD_ROWS, VISIBLE_ROWS } from './TetrisConfig';
import { ActivePiece, Cell, PieceType, getPieceCells } from './TetrisPieces';

/** null 表示空格；0 是 I 方块，所以判空必须用 `=== null` */
export type BoardCell = PieceType | null;

export class TetrisBoard {
    readonly cols: number = BOARD_COLS;
    readonly rows: number = BOARD_ROWS;

    private _grid: BoardCell[][] = [];

    constructor() {
        this.reset();
    }

    /** 调试与渲染用；修改棋盘请走 lock/clearRows */
    get grid(): BoardCell[][] {
        return this._grid;
    }

    reset(): void {
        const grid: BoardCell[][] = [];
        for (let y = 0; y < this.rows; y++) {
            const row: BoardCell[] = [];
            for (let x = 0; x < this.cols; x++) {
                row.push(null);
            }
            grid.push(row);
        }
        this._grid = grid;
    }

    /** 越界返回 null（渲染层容错用） */
    get(x: number, y: number): BoardCell {
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return null;
        return this._grid[y][x];
    }

    set(x: number, y: number, value: BoardCell): void {
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
        this._grid[y][x] = value;
    }

    /** 所有格子都在界内且为空 */
    canPlace(cells: Cell[]): boolean {
        for (const c of cells) {
            if (c.x < 0 || c.x >= this.cols) return false;
            if (c.y < 0 || c.y >= this.rows) return false;
            if (this._grid[c.y][c.x] !== null) return false;
        }
        return true;
    }

    /** 把方块写进棋盘，返回写入的格子 */
    lock(piece: ActivePiece): Cell[] {
        const cells = getPieceCells(piece);
        for (const c of cells) {
            if (c.x >= 0 && c.x < this.cols && c.y >= 0 && c.y < this.rows) {
                this._grid[c.y][c.x] = piece.type;
            }
        }
        return cells;
    }

    /** 满行（只检查可见行），升序 */
    findFullRows(): number[] {
        const rows: number[] = [];
        for (let y = 0; y < VISIBLE_ROWS; y++) {
            let full = true;
            for (let x = 0; x < this.cols; x++) {
                if (this._grid[y][x] === null) {
                    full = false;
                    break;
                }
            }
            if (full) rows.push(y);
        }
        return rows;
    }

    /**
     * 删除指定行并把上方整体下移。
     * 行号会在删除过程中变化，所以从高到低处理。
     */
    clearRows(rows: number[]): number {
        const unique = Array.from(new Set(rows)).sort((a, b) => b - a);
        let cleared = 0;
        for (const y of unique) {
            if (y < 0 || y >= VISIBLE_ROWS) continue;
            this._grid.splice(y, 1);
            const empty: BoardCell[] = [];
            for (let x = 0; x < this.cols; x++) empty.push(null);
            this._grid.push(empty);
            cleared++;
        }
        return cleared;
    }

    /** 方块还能下落多少格 */
    getDropDistance(piece: ActivePiece): number {
        let distance = 0;
        while (true) {
            const next: ActivePiece = {
                type: piece.type,
                rot: piece.rot,
                x: piece.x,
                y: piece.y - distance - 1,
            };
            if (!this.canPlace(getPieceCells(next))) break;
            distance++;
        }
        return distance;
    }

    /** Ghost（落点预览）的包围盒左下角 y */
    getGhostY(piece: ActivePiece): number {
        return piece.y - this.getDropDistance(piece);
    }

    /** 方块锁定后所有格子都在可见区之上 → Lock Out */
    isLockOut(piece: ActivePiece): boolean {
        return getPieceCells(piece).every(c => c.y >= VISIBLE_ROWS);
    }

    // ==================== 调试辅助 ====================

    /**
     * 用字符串画棋盘，便于构造确定性场景。
     * 传入的行按「从上到下」排列，映射到棋盘最下面的 N 行。
     * '.' 或空格 = 空，I/O/T/S/Z/J/L = 对应方块，'#'/X = J 色填充块。
     */
    loadFromStrings(lines: string[]): void {
        this.reset();
        const count = Math.min(lines.length, VISIBLE_ROWS);
        for (let i = 0; i < count; i++) {
            const y = count - 1 - i;
            const line = lines[i];
            const width = Math.min(line.length, this.cols);
            for (let x = 0; x < width; x++) {
                const ch = line[x];
                if (ch === '.' || ch === ' ') continue;
                this._grid[y][x] = charToType(ch);
            }
        }
    }

    /** 导出可见行，从顶到底 */
    toStrings(): string[] {
        const lines: string[] = [];
        for (let y = VISIBLE_ROWS - 1; y >= 0; y--) {
            let line = '';
            for (let x = 0; x < this.cols; x++) {
                const cell = this._grid[y][x];
                line += cell === null ? '.' : typeToChar(cell);
            }
            lines.push(line);
        }
        return lines;
    }
}

function charToType(ch: string): PieceType {
    switch (ch) {
        case 'I': return PieceType.I;
        case 'O': return PieceType.O;
        case 'T': return PieceType.T;
        case 'S': return PieceType.S;
        case 'Z': return PieceType.Z;
        case 'L': return PieceType.L;
        case 'J':
        case '#':
        case 'X':
        default:
            return PieceType.J;
    }
}

function typeToChar(type: PieceType): string {
    switch (type) {
        case PieceType.I: return 'I';
        case PieceType.O: return 'O';
        case PieceType.T: return 'T';
        case PieceType.S: return 'S';
        case PieceType.Z: return 'Z';
        case PieceType.J: return 'J';
        case PieceType.L: return 'L';
        default: return '?';
    }
}
