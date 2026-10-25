/**
 * 方块坠落 — 方块定义、SRS 旋转与 7-bag 随机器。
 *
 * 坐标系：格子偏移以包围盒左下角为原点，x 向右、y 向上。
 * 本文件不依赖 cc。
 */

import { SPAWN_LOWEST_ROW } from './TetrisConfig';

export enum PieceType {
    I = 0,
    O = 1,
    T = 2,
    S = 3,
    Z = 4,
    J = 5,
    L = 6,
}

export interface Cell {
    x: number;
    y: number;
}

export interface ActivePiece {
    type: PieceType;
    /** 0 = 出生, 1 = 顺时针, 2 = 180°, 3 = 逆时针 */
    rot: number;
    /** 包围盒左下角在棋盘中的列 */
    x: number;
    /** 包围盒左下角在棋盘中的行（y 向上） */
    y: number;
}

export const PIECE_TYPES: PieceType[] = [
    PieceType.I,
    PieceType.O,
    PieceType.T,
    PieceType.S,
    PieceType.Z,
    PieceType.J,
    PieceType.L,
];

/**
 * 包围盒边长。SRS 的旋转中心依赖它，不能随意改。
 * O 用 2×2，I 用 4×4，其余用 3×3。
 */
const BOX_SIZE: Record<PieceType, number> = {
    [PieceType.I]: 4,
    [PieceType.O]: 2,
    [PieceType.T]: 3,
    [PieceType.S]: 3,
    [PieceType.Z]: 3,
    [PieceType.J]: 3,
    [PieceType.L]: 3,
};

/**
 * 状态 0 的格子偏移（SRS 出生朝向）。
 * 注意 JLSTZ 占包围盒的上两行，包围盒底行是空的——这与 SRS 的旋转中心一致。
 */
const BASE_CELLS: Record<PieceType, Cell[]> = {
    [PieceType.I]: [
        { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 },
    ],
    [PieceType.O]: [
        { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 },
    ],
    [PieceType.T]: [
        { x: 1, y: 2 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
    ],
    [PieceType.S]: [
        { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 0, y: 1 }, { x: 1, y: 1 },
    ],
    [PieceType.Z]: [
        { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 1 },
    ],
    [PieceType.J]: [
        { x: 0, y: 2 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
    ],
    [PieceType.L]: [
        { x: 2, y: 2 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
    ],
};

/** 出生时包围盒左下角的列 */
const SPAWN_X: Record<PieceType, number> = {
    [PieceType.I]: 3,
    [PieceType.O]: 4,
    [PieceType.T]: 3,
    [PieceType.S]: 3,
    [PieceType.Z]: 3,
    [PieceType.J]: 3,
    [PieceType.L]: 3,
};

/**
 * 顺时针旋转（y 向上的坐标系）：(x, y) -> (y, N - 1 - x)。
 * 屏幕坐标（y 向下）下的写法是 (x, y) -> (N - 1 - y, x)，两者不要混用。
 */
function rotateCellsCW(cells: Cell[], boxSize: number): Cell[] {
    return cells.map(c => ({ x: c.y, y: boxSize - 1 - c.x }));
}

function buildRotations(): Record<PieceType, Cell[][]> {
    const result = {} as Record<PieceType, Cell[][]>;
    for (const type of PIECE_TYPES) {
        const size = BOX_SIZE[type];
        const states: Cell[][] = [BASE_CELLS[type]];
        for (let i = 1; i < 4; i++) {
            states.push(rotateCellsCW(states[i - 1], size));
        }
        result[type] = states;
    }
    return result;
}

/** ROTATIONS[type][rot] = 该旋转状态下的格子偏移 */
export const ROTATIONS: Record<PieceType, Cell[][]> = buildRotations();

// ==================== SRS 踢墙表 ====================

function kickKey(from: number, to: number): string {
    return `${from}>${to}`;
}

/** JLSTZ 共用一张表，O 不旋转 */
const KICKS_JLSTZ: Record<string, Cell[]> = {
    '0>1': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: -2 }, { x: -1, y: -2 }],
    '1>0': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
    '1>2': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
    '2>1': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: -2 }, { x: -1, y: -2 }],
    '2>3': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -2 }, { x: 1, y: -2 }],
    '3>2': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: 2 }, { x: -1, y: 2 }],
    '3>0': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: 2 }, { x: -1, y: 2 }],
    '0>3': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -2 }, { x: 1, y: -2 }],
};

const KICKS_I: Record<string, Cell[]> = {
    '0>1': [{ x: 0, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 0 }, { x: -2, y: -1 }, { x: 1, y: 2 }],
    '1>0': [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 1 }, { x: -1, y: -2 }],
    '1>2': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 2 }, { x: 2, y: -1 }],
    '2>1': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 0 }, { x: 1, y: -2 }, { x: -2, y: 1 }],
    '2>3': [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 1 }, { x: -1, y: -2 }],
    '3>2': [{ x: 0, y: 0 }, { x: -2, y: 0 }, { x: 1, y: 0 }, { x: -2, y: -1 }, { x: 1, y: 2 }],
    '3>0': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -2, y: 0 }, { x: 1, y: -2 }, { x: -2, y: 1 }],
    '0>3': [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 2 }, { x: 2, y: -1 }],
};

export function getKicks(type: PieceType, from: number, to: number): Cell[] {
    if (type === PieceType.O) return [{ x: 0, y: 0 }];
    const table = type === PieceType.I ? KICKS_I : KICKS_JLSTZ;
    return table[kickKey(from & 3, to & 3)] || [{ x: 0, y: 0 }];
}

// ==================== 方块实例 ====================

/** 按 SRS 出生位置创建方块：最低占用格落在 SPAWN_LOWEST_ROW */
export function createPiece(type: PieceType): ActivePiece {
    let minY = Infinity;
    for (const c of BASE_CELLS[type]) {
        if (c.y < minY) minY = c.y;
    }
    return {
        type,
        rot: 0,
        x: SPAWN_X[type],
        y: SPAWN_LOWEST_ROW - minY,
    };
}

/** 方块当前占用的棋盘格子（绝对坐标） */
export function getPieceCells(piece: ActivePiece): Cell[] {
    const base = ROTATIONS[piece.type][piece.rot & 3];
    const cells: Cell[] = [];
    for (const c of base) {
        cells.push({ x: piece.x + c.x, y: piece.y + c.y });
    }
    return cells;
}

/**
 * 尝试旋转；按 SRS 顺序尝试踢墙，返回第一个可行的新方块。
 * 全部失败返回 null。
 *
 * @param dir 1 = 顺时针，-1 = 逆时针
 * @param canPlace 由棋盘提供的碰撞检测
 */
export function tryRotate(
    piece: ActivePiece,
    dir: 1 | -1,
    canPlace: (cells: Cell[]) => boolean,
): ActivePiece | null {
    const from = piece.rot & 3;
    const to = (from + (dir === 1 ? 1 : 3)) & 3;
    const kicks = getKicks(piece.type, from, to);
    for (const kick of kicks) {
        const candidate: ActivePiece = {
            type: piece.type,
            rot: to,
            x: piece.x + kick.x,
            y: piece.y + kick.y,
        };
        if (canPlace(getPieceCells(candidate))) {
            return candidate;
        }
    }
    return null;
}

// ==================== 7-bag ====================

/**
 * 7-bag 随机器：每袋 7 种方块各一个，洗牌后依次取出。
 * 注入 rng 便于测试复现。
 */
export class BagRandomizer {
    private _bag: PieceType[] = [];
    private _rng: () => number;

    constructor(rng: () => number = Math.random) {
        this._rng = rng;
    }

    next(): PieceType {
        if (this._bag.length === 0) {
            this.refill();
        }
        return this._bag.pop() as PieceType;
    }

    reset(): void {
        this._bag.length = 0;
    }

    private refill(): void {
        const bag = PIECE_TYPES.slice();
        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(this._rng() * (i + 1));
            const tmp = bag[i];
            bag[i] = bag[j];
            bag[j] = tmp;
        }
        this._bag = bag;
    }
}
