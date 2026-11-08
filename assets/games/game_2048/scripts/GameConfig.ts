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
//
// 原先照抄了官方的米色系（#EEE4DA / #F2B179 …），放在全站深色科技风里像一张贴图：
// 棋盘是浅棕、面板是奶油白，和别的游戏完全不是一套。改成「深底 + 冷色阶梯」：
//   2/4 低阶 → 石板灰；8~64 → 蓝到青；128~256 → 青绿到绿；512+ → 琥珀到橙红。
// 阶梯本身就是进度提示：颜色越暖，数值越高。
export const TILE_COLORS: Record<number, { bg: Color; text: Color }> = {
    2: { bg: new Color(51, 65, 85), text: new Color(226, 232, 240) },
    4: { bg: new Color(62, 76, 99), text: new Color(226, 232, 240) },
    8: { bg: new Color(29, 78, 216), text: new Color(255, 255, 255) },
    16: { bg: new Color(37, 99, 235), text: new Color(255, 255, 255) },
    32: { bg: new Color(2, 132, 199), text: new Color(255, 255, 255) },
    64: { bg: new Color(8, 145, 178), text: new Color(255, 255, 255) },
    128: { bg: new Color(13, 148, 136), text: new Color(255, 255, 255) },
    256: { bg: new Color(22, 163, 74), text: new Color(255, 255, 255) },
    512: { bg: new Color(202, 138, 4), text: new Color(255, 255, 255) },
    1024: { bg: new Color(234, 88, 12), text: new Color(255, 255, 255) },
    2048: { bg: new Color(220, 38, 38), text: new Color(255, 255, 255) },
};

export function getTileColor(value: number): { bg: Color; text: Color } {
    return TILE_COLORS[value] || {
        // 2048 以上：紫，和任意一档都不撞色
        bg: new Color(76, 29, 149),
        text: new Color(255, 255, 255),
    };
}

let _tileIdCounter = 0;

export function generateTileId(): number {
    return ++_tileIdCounter;
}
