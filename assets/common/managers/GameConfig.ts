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
];

export function getGameById(id: string): GameConfig | undefined {
    return GAME_LIST.find(game => game.id === id);
}
