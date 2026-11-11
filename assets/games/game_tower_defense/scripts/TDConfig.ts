/**
 * 守卫塔楼 —— 配置与数值（纯数据，不依赖 cc，可被 Node 自检直接编译）。
 *
 * 地图用 9×12 的 ASCII 网格描述：
 *   `S` 起点、`#` 路径、`E` 终点、`o` 可建塔的固定塔位、`.` 空格。
 * 路径由 TDCore 从 S 到 E 做 BFS 自动推导，因此地图只需保证连通即可。
 *
 * 坐标约定：格子坐标 (col, row)，格心为 (col + 0.5, row + 0.5)，row 0 在最上方。
 * 距离单位都是「格」，时间单位是秒。
 */

export type TDTowerKind = 'gun' | 'mortar' | 'frost' | 'sniper';
export type TDEnemyKind = 'grunt' | 'runner' | 'tank' | 'boss';
export type TDTargetMode = 'first' | 'closest' | 'lowest';

export interface TDTowerLevelStats {
    /** 升到该等级的花费（等级 1 即建造价） */
    cost: number;
    damage: number;
    /** 射程（格） */
    range: number;
    /** 两发之间的间隔（秒） */
    interval: number;
}

export interface TDTowerDef {
    kind: TDTowerKind;
    name: string;
    desc: string;
    target: TDTargetMode;
    /** 弹丸速度（格/秒）；很大即为瞬发 */
    projectileSpeed: number;
    /** 溅射半径（格）；0 为单体 */
    splash: number;
    /** 减速比例（0.45 = 速度降低 45%）；0 为不减速 */
    slowFactor: number;
    slowDuration: number;
    levels: TDTowerLevelStats[];
}

export interface TDEnemyDef {
    kind: TDEnemyKind;
    name: string;
    hp: number;
    /** 移动速度（格/秒） */
    speed: number;
    /** 击杀金币 */
    reward: number;
    /** 绘制半径（格） */
    radius: number;
    /** 漏到终点扣的生命 */
    leak: number;
}

export interface TDMapDef {
    id: number;
    name: string;
    grid: string[];
    gold: number;
    lives: number;
    /** 敌人血量倍率（地图难度） */
    hpScale: number;
}

export interface TDWaveGroup {
    kind: TDEnemyKind;
    count: number;
    /** 同组内两只之间的间隔（秒） */
    interval: number;
    /** 本组第一只的出场时间（秒） */
    delay: number;
}

export interface TDWaveDef {
    groups: TDWaveGroup[];
    /** 清完本波的金币奖励 */
    bonus: number;
}

export const TD_COLS = 9;
export const TD_ROWS = 12;
export const TD_TOWER_MAX_LEVEL = 3;
/** 出售返还比例 */
export const TD_SELL_REFUND = 0.5;
/** 每波敌人血量成长 */
export const TD_HP_GROWTH = 0.16;

// ==================== 塔 ====================

export const TD_TOWERS: Record<TDTowerKind, TDTowerDef> = {
    gun: {
        kind: 'gun',
        name: '机枪塔',
        desc: '单体速射，性价比高',
        target: 'first',
        projectileSpeed: 14,
        splash: 0,
        slowFactor: 0,
        slowDuration: 0,
        levels: [
            { cost: 60, damage: 12, range: 2.8, interval: 0.35 },
            { cost: 55, damage: 20, range: 3.0, interval: 0.33 },
            { cost: 80, damage: 32, range: 3.2, interval: 0.30 },
        ],
    },
    mortar: {
        kind: 'mortar',
        name: '迫击炮',
        desc: '范围溅射，专治成群',
        target: 'closest',
        projectileSpeed: 6,
        splash: 1.15,
        slowFactor: 0,
        slowDuration: 0,
        levels: [
            { cost: 110, damage: 24, range: 3.2, interval: 1.20 },
            { cost: 100, damage: 38, range: 3.4, interval: 1.10 },
            { cost: 140, damage: 60, range: 3.6, interval: 1.00 },
        ],
    },
    frost: {
        kind: 'frost',
        name: '冰霜塔',
        desc: '减速 45%，拖住整队',
        target: 'first',
        projectileSpeed: 10,
        splash: 0.9,
        slowFactor: 0.45,
        slowDuration: 1.5,
        levels: [
            { cost: 90, damage: 5, range: 2.6, interval: 0.80 },
            { cost: 80, damage: 8, range: 2.8, interval: 0.70 },
            { cost: 110, damage: 12, range: 3.0, interval: 0.60 },
        ],
    },
    sniper: {
        kind: 'sniper',
        name: '狙击塔',
        desc: '超远射程，点杀残血',
        target: 'lowest',
        projectileSpeed: 30,
        splash: 0,
        slowFactor: 0,
        slowDuration: 0,
        levels: [
            { cost: 140, damage: 60, range: 5.5, interval: 1.60 },
            { cost: 130, damage: 95, range: 6.0, interval: 1.50 },
            { cost: 180, damage: 150, range: 6.5, interval: 1.40 },
        ],
    },
};

export const TD_TOWER_ORDER: TDTowerKind[] = ['gun', 'mortar', 'frost', 'sniper'];

export const TD_ENEMIES: Record<TDEnemyKind, TDEnemyDef> = {
    grunt: { kind: 'grunt', name: '小兵', hp: 55, speed: 1.6, reward: 8, radius: 0.24, leak: 1 },
    runner: { kind: 'runner', name: '疾行者', hp: 32, speed: 2.9, reward: 7, radius: 0.2, leak: 1 },
    tank: { kind: 'tank', name: '装甲兵', hp: 180, speed: 1.0, reward: 18, radius: 0.31, leak: 2 },
    boss: { kind: 'boss', name: '攻城车', hp: 2200, speed: 0.9, reward: 150, radius: 0.5, leak: 5 },
};

// ==================== 地图 ====================

export const TD_MAPS: TDMapDef[] = [
    {
        id: 1,
        name: 'S 形走廊',
        grid: [
            'S######..',
            '..o.o.#.o',
            '..o.o.#.o',
            '.######..',
            '.#.o.o..o',
            '.#.o.o..o',
            '.#.o.o..o',
            '.#######E',
            'o.o.o.o.o',
            '..o...o..',
            '.........',
            '.........',
        ],
        // 试玩报告：180 只够 1 座塔，第 1 波就教会玩家「守不住」。统一提到 260（够 2–3 座）
        gold: 260,
        lives: 10,
        hpScale: 1.15,
    },
    {
        id: 2,
        name: 'U 形回廊',
        grid: [
            'S........',
            '#.o.o.o.#',
            '#...#####',
            '#o..#o..#',
            '#.o.#.o.#',
            '#o..#..o#',
            '#..o#o..#',
            '#...#E..#',
            '#o..o..o#',
            '#########',
            'o.o.o.o.o',
            '..o...o..',
        ],
        gold: 260,
        lives: 10,
        hpScale: 1.3,
    },
    {
        id: 3,
        name: '折返栈道',
        grid: [
            '..o.S.o..',
            '..o.#.o..',
            '..o.#.o..',
            '.#####...',
            'o..#...#.',
            '...#...#.',
            '...#...#.',
            '.######..',
            'o.o.o.#o.',
            '..o...#..',
            'o...o.#.o',
            'o.o.o.#E.',
        ],
        gold: 260,
        lives: 10,
        hpScale: 1.45,
    },
];

export const TD_MAP_COUNT = TD_MAPS.length;

export function getTDMap(id: number): TDMapDef {
    const index = Math.floor(id) - 1;
    if (index < 0 || index >= TD_MAPS.length) return TD_MAPS[0];
    return TD_MAPS[index];
}

// ==================== 波次 ====================

function g(kind: TDEnemyKind, count: number, interval: number, delay = 0): TDWaveGroup {
    return { kind, count, interval, delay };
}

export const TD_WAVES: TDWaveDef[] = [
    { groups: [g('grunt', 6, 0.9)], bonus: 25 },
    { groups: [g('grunt', 8, 0.8)], bonus: 30 },
    { groups: [g('grunt', 6, 0.8), g('runner', 5, 0.7, 2)], bonus: 35 },
    { groups: [g('grunt', 8, 0.7), g('runner', 8, 0.6, 1.5)], bonus: 40 },
    { groups: [g('grunt', 8, 0.7), g('tank', 2, 2.0, 3)], bonus: 45 },
    { groups: [g('runner', 12, 0.5), g('tank', 2, 2.0, 2)], bonus: 50 },
    { groups: [g('grunt', 12, 0.6), g('tank', 3, 1.8, 2)], bonus: 55 },
    { groups: [g('runner', 10, 0.5), g('tank', 4, 1.6, 1)], bonus: 60 },
    { groups: [g('grunt', 14, 0.5), g('runner', 6, 0.6, 2), g('tank', 4, 1.6, 4)], bonus: 70 },
    { groups: [g('boss', 1, 1), g('runner', 8, 0.5, 2), g('tank', 3, 1.8, 4)], bonus: 120 },
];

export const TD_WAVE_COUNT = TD_WAVES.length;

/** 第 wave 波（1 起）的敌人血量 */
export function enemyHp(map: TDMapDef, kind: TDEnemyKind, wave: number): number {
    const def = TD_ENEMIES[kind];
    const waveScale = 1 + TD_HP_GROWTH * Math.max(0, wave - 1);
    return Math.round(def.hp * map.hpScale * waveScale);
}

/** 波次内敌人总数 */
export function waveEnemyCount(wave: TDWaveDef): number {
    let sum = 0;
    for (let i = 0; i < wave.groups.length; i++) sum += wave.groups[i].count;
    return sum;
}

// ==================== 存档 ====================

export interface TDSave {
    v: 1;
    /** 每张地图到达过的最远波次（0 = 还没打过） */
    bestWave: number[];
    lastMap: number;
    totalKills: number;
}

export function createDefaultSave(): TDSave {
    return { v: 1, bestWave: new Array(TD_MAP_COUNT).fill(0), lastMap: 1, totalKills: 0 };
}

export function parseTDSave(raw: unknown): TDSave {
    const out = createDefaultSave();
    if (!raw || typeof raw !== 'object') return out;
    const data = raw as Partial<TDSave>;
    if (Array.isArray(data.bestWave)) {
        for (let i = 0; i < TD_MAP_COUNT; i++) {
            const n = Math.floor(Number(data.bestWave[i]));
            out.bestWave[i] = Number.isFinite(n) && n > 0 ? Math.min(n, TD_WAVE_COUNT) : 0;
        }
    }
    const last = Math.floor(Number(data.lastMap));
    if (Number.isFinite(last) && last >= 1 && last <= TD_MAP_COUNT) out.lastMap = last;
    const kills = Math.floor(Number(data.totalKills));
    if (Number.isFinite(kills) && kills > 0) out.totalKills = kills;
    return out;
}
