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
    { id: 'tiny_vanguard', name: '小小先锋', icon: 'default', sceneName: 'TinyVanguard', description: 'Roguelike 回合制战棋' },
    { id: 'tetris', name: '方块坠落', icon: 'default', sceneName: 'Tetris', description: '经典方块消除' },
    { id: 'brick', name: '砖块远征', icon: 'default', sceneName: 'BrickBreaker', description: '打砖块 + 肉鸽升级' },
    { id: 'merge', name: '合合大作战', icon: 'default', sceneName: 'Merge', description: '合成同类水果，越滚越大' },
    { id: 'gate_runner', name: '数值冲刺', icon: 'default', sceneName: 'GateRunner', description: '穿过 ×2 / ÷2 数值门，带队伍冲到 Boss' },
    { id: 'solitaire', name: '纸牌接龙', icon: 'default', sceneName: 'Solitaire', description: '克朗代克单人纸牌' },
    { id: 'survivor', name: '午夜幸存者', icon: 'default', sceneName: 'Survivor', description: '8 分钟肉鸽生存，自动攻击 + 三选一构筑' },
    { id: 'minesweeper', name: '扫雷', icon: 'default', sceneName: 'Minesweeper', description: '经典扫雷，首点安全 + 和弦' },
    { id: 'sudoku', name: '数独', icon: 'default', sceneName: 'Sudoku', description: '经典数独，笔记 / 提示 / 撤销' },
    { id: 'idiom', name: '成语填字', icon: 'default', sceneName: 'Idiom', description: '纵横交叉填成语，全部锁定通关' },
    { id: 'gomoku', name: '五子棋', icon: 'default', sceneName: 'Gomoku', description: '15×15 经典五子棋，人机三档 / 双人对战' },
    { id: 'idle', name: '小店日记', icon: 'default', sceneName: 'Idle', description: '点击经营小店，升级设施，离线也赚钱' },
];

export function getGameById(id: string): GameConfig | undefined {
    return GAME_LIST.find(game => game.id === id);
}
