import { _decorator } from 'cc';

export interface GameConfig {
    id: string;
    name: string;
    icon: string;
    sceneName: string;
    description?: string;
}

export const GAME_LIST: GameConfig[] = [
    { id: '2048', name: '2048', icon: 'default', sceneName: 'Game2048', description: '经典数字合并游戏' },
    { id: 'war_evo', name: '战争进化', icon: 'default', sceneName: 'WarEvo', description: '时代进化对推' },
    { id: 'snake', name: '贪吃蛇', icon: 'default', sceneName: 'Snake', description: '大作战风格贪吃蛇' },
];

export function getGameById(id: string): GameConfig | undefined {
    return GAME_LIST.find(game => game.id === id);
}
