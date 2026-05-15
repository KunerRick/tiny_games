import { Color } from 'cc';

export const GRID_SIZES = [4, 5, 6, 7, 8] as const;
export type GridSize = typeof GRID_SIZES[number];

export const DEFAULT_GRID_SIZE: GridSize = 4;

export enum Direction {
    UP = 0,
    RIGHT = 1,
    DOWN = 2,
    LEFT = 3,
}

export interface TileData {
    id: number;
    value: number;
    row: number;
    col: number;
    isNew?: boolean;
    isMerged?: boolean;
}

export interface GameState {
    gridSize: GridSize;
    tiles: TileData[];
    score: number;
    bestScore: number;
    isGameOver: boolean;
    hasWon: boolean;
}

export interface MoveResult {
    tiles: TileData[];
    scoreGained: number;
    hasMoved: boolean;
}

// 颜色方案
export const TILE_COLORS: Record<number, { bg: Color; text: Color }> = {
    2: { bg: new Color(238, 228, 218), text: new Color(119, 110, 101) },
    4: { bg: new Color(237, 224, 200), text: new Color(119, 110, 101) },
    8: { bg: new Color(242, 177, 121), text: new Color(249, 246, 242) },
    16: { bg: new Color(245, 149, 99), text: new Color(249, 246, 242) },
    32: { bg: new Color(246, 124, 95), text: new Color(249, 246, 242) },
    64: { bg: new Color(246, 94, 59), text: new Color(249, 246, 242) },
    128: { bg: new Color(237, 207, 114), text: new Color(249, 246, 242) },
    256: { bg: new Color(237, 204, 97), text: new Color(249, 246, 242) },
    512: { bg: new Color(237, 200, 80), text: new Color(249, 246, 242) },
    1024: { bg: new Color(237, 197, 63), text: new Color(249, 246, 242) },
    2048: { bg: new Color(237, 194, 46), text: new Color(249, 246, 242) },
};

export function getTileColor(value: number): { bg: Color; text: Color } {
    return TILE_COLORS[value] || { 
        bg: new Color(60, 58, 50), 
        text: new Color(249, 246, 242) 
    };
}

let _tileIdCounter = 0;

export function generateTileId(): number {
    return ++_tileIdCounter;
}
