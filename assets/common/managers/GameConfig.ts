import { _decorator } from 'cc';

export interface GameConfig {
    id: string;
    name: string;
    icon: string;
    sceneName: string;
    description?: string;
}

export const GAME_LIST: GameConfig[] = [
    { id: '2048', name: '2048', icon: 'default', sceneName: 'GamePlaceholder', description: '经典数字合并游戏' },
    { id: 'snake', name: '贪吃蛇', icon: 'default', sceneName: 'GamePlaceholder', description: '经典贪吃蛇' },
    { id: 'tetris', name: '俄罗斯方块', icon: 'default', sceneName: 'GamePlaceholder', description: '经典方块消除' },
    { id: 'puzzle', name: '推箱子', icon: 'default', sceneName: 'GamePlaceholder', description: '益智推箱子' },
    { id: 'flappy', name: '像素鸟', icon: 'default', sceneName: 'GamePlaceholder', description: '飞行躲避' },
    { id: 'breakout', name: '打砖块', icon: 'default', sceneName: 'GamePlaceholder', description: '经典打砖块' },
];

export function getGameById(id: string): GameConfig | undefined {
    return GAME_LIST.find(game => game.id === id);
}
