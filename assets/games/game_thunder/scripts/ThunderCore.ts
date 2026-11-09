/**
 * 雷霆战机 —— 纯逻辑核心（不依赖 cc，可被 Node 自检直接编译）。
 *
 * 坐标系：x ∈ [0, 720] 从左到右，y ∈ [0, 1280] **从上到下**（与设计坐标一致）。
 * 玩家在下方（y 大），子弹向上飞（vy < 0）。
 *
 * 负责：关卡表、跨局养成、玩家移动 / 自动开火 / 僚机、敌人按波次生成 / 移动 / 开火、
 *       子弹（圆判定）、碰撞与计分、道具掉落、炸弹 / 护盾 / 复活、胜负判定。
 * 全部确定性（不使用随机数），便于自检复现与回归。
 */

export const FIELD_W = 720;
export const FIELD_H = 1280;

/** 玩家碰撞半径（远小于视觉半径，弹幕游戏惯例：判定小、观感大） */
export const PLAYER_R = 9;
export const PLAYER_VISUAL_R = 17;
export const PLAYER_START_X = FIELD_W / 2;
export const PLAYER_START_Y = 1090;
export const PLAYER_MIN_X = 20;
export const PLAYER_MAX_X = FIELD_W - 20;
export const PLAYER_MIN_Y = 260;
export const PLAYER_MAX_Y = FIELD_H - 60;

export const BASE_FIRE_INTERVAL = 0.12;
export const PLAYER_BULLET_SPEED = 900;
export const PLAYER_BULLET_R = 6;
export const WING_FIRE_INTERVAL = 0.18;

export const MAX_POWER = 5;
export const MAX_LIVES = 7;
export const MAX_SHIELDS = 1;
export const MAX_BULLETS = 1000;

export const WAVE_GAP = 0.9;
export const INVULN_TIME = 1.6;
export const SHIELD_INVULN = 0.8;
export const BOMB_INVULN = 2.0;
export const REVIVE_INVULN = 3.0;
export const REVIVE_LIVES = 2;

export const POWERUP_FALL_SPEED = 90;
export const POWERUP_R = 14;

export const LEVEL_COUNT = 10;
export const SAVE_VERSION = 1;

export type ThunderPhase = 'playing' | 'won' | 'lost' | 'revive';
export type EnemyKind = 'grunt' | 'weaver' | 'tank' | 'destroyer' | 'fortress' | 'carrier' | 'core';
export type BulletSide = 'p' | 'e';
export type PowerupKind = 'power' | 'bomb' | 'shield';
export type UpgradeTrack = 'attack' | 'armor' | 'wing' | 'bomb';

export type EnemyMode = 'straight' | 'sine' | 'flank' | 'boss';

// ==================== 数据结构 ====================

export interface ThunderSave {
    v: number;
    coins: number;
    upgrades: Record<UpgradeTrack, number>;
    stars: number[];
    bestScore: number[];
}

export interface PlayerStats {
    attackLevel: number;
    armorLevel: number;
    wingLevel: number;
    bombLevel: number;
    damage: number;
    maxLives: number;
    wingCount: number;
    wingRatio: number;
    bombCapacity: number;
}

export interface Bullet {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    side: BulletSide;
    dmg: number;
}

export interface Enemy {
    id: number;
    kind: EnemyKind;
    x: number;
    y: number;
    /** 出生点 x：sine / boss 的摆动基准 */
    baseX: number;
    /** flank 的横向速度 */
    vx: number;
    hp: number;
    maxHp: number;
    radius: number;
    mode: EnemyMode;
    /** 存活秒数，驱动摆动与开火节奏 */
    t: number;
    fireT: number;
    /** 本次开火在图案里的序号 */
    shotIndex: number;
    /** boss 是否已经就位 */
    arrived: boolean;
}

export interface Powerup {
    x: number;
    y: number;
    vy: number;
    kind: PowerupKind;
    r: number;
}

export interface SpawnEntry {
    /** 相对本波开始的秒数 */
    t: number;
    kind: EnemyKind;
    x: number;
    mode: EnemyMode;
    vx?: number;
    hpMul?: number;
}

export interface ThunderWave {
    name: string;
    /** 该波是否包含 Boss（用于 UI / 自检） */
    boss: boolean;
    entries: SpawnEntry[];
}

export interface ThunderLevelDef {
    index: number;
    name: string;
    /** 背景主色 */
    bg: string;
    waves: ThunderWave[];
    boss: EnemyKind;
    bossHp: number;
    recommendAttack: number;
}

export interface EnemyDef {
    hp: number;
    radius: number;
    score: number;
    coins: number;
    speed: number;
    fireInterval: number;
    bulletSpeed: number;
    pattern: FirePattern;
}

export type FirePattern =
    | 'aim'
    | 'spread3'
    | 'ring8'
    | 'boss_destroyer'
    | 'boss_fortress'
    | 'boss_carrier'
    | 'boss_core';

// ==================== 敌人配置 ====================

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
    grunt: {
        hp: 3, radius: 18, score: 10, coins: 3, speed: 140,
        fireInterval: 1.8, bulletSpeed: 230, pattern: 'aim',
    },
    weaver: {
        hp: 5, radius: 20, score: 20, coins: 5, speed: 110,
        fireInterval: 1.5, bulletSpeed: 210, pattern: 'spread3',
    },
    tank: {
        hp: 12, radius: 28, score: 50, coins: 10, speed: 70,
        fireInterval: 1.6, bulletSpeed: 190, pattern: 'ring8',
    },
    destroyer: {
        hp: 140, radius: 60, score: 240, coins: 0, speed: 80,
        fireInterval: 1.2, bulletSpeed: 220, pattern: 'boss_destroyer',
    },
    fortress: {
        hp: 260, radius: 64, score: 360, coins: 0, speed: 70,
        fireInterval: 1.15, bulletSpeed: 210, pattern: 'boss_fortress',
    },
    carrier: {
        hp: 560, radius: 68, score: 500, coins: 0, speed: 70,
        fireInterval: 1.05, bulletSpeed: 210, pattern: 'boss_carrier',
    },
    core: {
        hp: 1300, radius: 72, score: 800, coins: 0, speed: 70,
        fireInterval: 1.1, bulletSpeed: 210, pattern: 'boss_core',
    },
};

export function isBossKind(kind: EnemyKind): boolean {
    return kind === 'destroyer' || kind === 'fortress' || kind === 'carrier' || kind === 'core';
}

// ==================== 波次模板（常量表，构造期展开） ====================

function row(kind: EnemyKind, n: number, gap = 110, tGap = 0.14): SpawnEntry[] {
    const effGap = n > 1 ? Math.min(gap, (FIELD_W - 120) / (n - 1)) : 0;
    const total = (n - 1) * effGap;
    const out: SpawnEntry[] = [];
    for (let i = 0; i < n; i++) {
        out.push({ t: i * tGap, kind, x: FIELD_W / 2 - total / 2 + i * effGap, mode: 'straight' });
    }
    return out;
}

function vee(kind: EnemyKind, n: number, gap = 92, tGap = 0.12): SpawnEntry[] {
    const out: SpawnEntry[] = [];
    for (let i = 0; i < n; i++) {
        const k = Math.floor(i / 2);
        const side = i % 2 === 0 ? 1 : -1;
        const x = FIELD_W / 2 + side * (26 + k * gap);
        out.push({
            t: i * tGap,
            kind,
            x: Math.max(40, Math.min(FIELD_W - 40, x)),
            mode: 'straight',
        });
    }
    return out;
}

function sineWave(n: number, tGap = 0.24): SpawnEntry[] {
    const out: SpawnEntry[] = [];
    for (let i = 0; i < n; i++) {
        out.push({
            t: i * tGap,
            kind: 'weaver',
            x: 140 + (i % 4) * 146,
            mode: 'sine',
        });
    }
    return out;
}

function flank(n: number, tGap = 0.16): SpawnEntry[] {
    const out: SpawnEntry[] = [];
    for (let i = 0; i < n; i++) {
        const fromLeft = i % 2 === 0;
        out.push({
            t: i * tGap,
            kind: i % 3 === 2 ? 'tank' : 'grunt',
            x: fromLeft ? 70 : FIELD_W - 70,
            mode: 'flank',
            vx: fromLeft ? 46 : -46,
        });
    }
    return out;
}

function wall(n: number, gap = 150, tGap = 0.2): SpawnEntry[] {
    const effGap = n > 1 ? Math.min(gap, (FIELD_W - 160) / (n - 1)) : 0;
    const total = (n - 1) * effGap;
    const out: SpawnEntry[] = [];
    for (let i = 0; i < n; i++) {
        out.push({
            t: i * tGap,
            kind: 'tank',
            x: FIELD_W / 2 - total / 2 + i * effGap,
            mode: 'straight',
        });
    }
    return out;
}

function guard(): SpawnEntry[] {
    const out: SpawnEntry[] = [];
    out.push({ t: 0, kind: 'grunt', x: 100, mode: 'straight' });
    out.push({ t: 0.1, kind: 'tank', x: 300, mode: 'straight' });
    out.push({ t: 0.18, kind: 'tank', x: 420, mode: 'straight' });
    out.push({ t: 0.5, kind: 'grunt', x: 90, mode: 'straight' });
    out.push({ t: 0.62, kind: 'grunt', x: 630, mode: 'straight' });
    out.push({ t: 0.74, kind: 'grunt', x: 620, mode: 'straight' });
    return out;
}

function crossfire(): SpawnEntry[] {
    const out: SpawnEntry[] = [];
    for (let i = 0; i < 4; i++) {
        out.push({ t: i * 0.34, kind: 'weaver', x: 170 + (i % 2) * 380, mode: 'sine' });
    }
    for (let i = 0; i < 2; i++) {
        out.push({ t: 0.5 + i * 0.6, kind: 'tank', x: 360 + (i === 0 ? -110 : 110), mode: 'straight' });
    }
    return out;
}

function bossWave(kind: EnemyKind): ThunderWave {
    return {
        name: 'BOSS',
        boss: true,
        entries: [{ t: 0.9, kind, x: FIELD_W / 2, mode: 'boss' }],
    };
}

function wave(name: string, entries: SpawnEntry[]): ThunderWave {
    return { name, boss: false, entries };
}

export const THUNDER_LEVELS: readonly ThunderLevelDef[] = [
    {
        index: 0, name: '边境巡航', bg: '#0B1220', boss: 'destroyer', bossHp: 140, recommendAttack: 0,
        waves: [wave('侦察编队', row('grunt', 4)), wave('V 字突入', vee('grunt', 5)), bossWave('destroyer')],
    },
    {
        index: 1, name: '陨石带', bg: '#120B24', boss: 'destroyer', bossHp: 190, recommendAttack: 1,
        waves: [
            wave('V 字突入', vee('grunt', 5)),
            wave('游隼来袭', sineWave(4)),
            wave('两翼包夹', flank(6)),
            bossWave('destroyer'),
        ],
    },
    {
        index: 2, name: '敌方哨站', bg: '#07160F', boss: 'fortress', bossHp: 260, recommendAttack: 2,
        waves: [
            wave('哨兵列阵', row('grunt', 6)),
            wave('重装压境', wall(2)),
            wave('交叉火网', crossfire()),
            bossWave('fortress'),
        ],
    },
    {
        index: 3, name: '电磁风暴', bg: '#0A1418', boss: 'fortress', bossHp: 340, recommendAttack: 3,
        waves: [
            wave('游隼来袭', sineWave(6)),
            wave('两翼包夹', flank(8)),
            wave('重装压境', wall(2)),
            bossWave('fortress'),
        ],
    },
    {
        index: 4, name: '残骸区', bg: '#1A1109', boss: 'fortress', bossHp: 440, recommendAttack: 4,
        waves: [
            wave('铁壁推进', wall(3)),
            wave('护卫编队', guard()),
            wave('交叉火网', crossfire()),
            bossWave('fortress'),
        ],
    },
    {
        index: 5, name: '深海峡谷', bg: '#061426', boss: 'carrier', bossHp: 560, recommendAttack: 5,
        waves: [
            wave('V 字突入', vee('grunt', 8)),
            wave('游隼来袭', sineWave(6)),
            wave('铁壁推进', wall(3)),
            wave('两翼包夹', flank(8)),
            bossWave('carrier'),
        ],
    },
    {
        index: 6, name: '轨道要塞', bg: '#1B0A1F', boss: 'carrier', bossHp: 700, recommendAttack: 6,
        waves: [
            wave('哨兵列阵', row('grunt', 8)),
            wave('护卫编队', guard()),
            wave('交叉火网', crossfire()),
            wave('铁壁推进', wall(3)),
            bossWave('carrier'),
        ],
    },
    {
        index: 7, name: '熔岩星云', bg: '#1C0D06', boss: 'carrier', bossHp: 860, recommendAttack: 7,
        waves: [
            wave('两翼包夹', flank(10)),
            wave('游隼来袭', sineWave(8)),
            wave('护卫编队', guard()),
            wave('铁壁推进', wall(4)),
            bossWave('carrier'),
        ],
    },
    {
        index: 8, name: '虚空回廊', bg: '#05060A', boss: 'carrier', bossHp: 1040, recommendAttack: 8,
        waves: [
            wave('铁壁推进', wall(4)),
            wave('交叉火网', crossfire()),
            wave('两翼包夹', flank(10)),
            wave('护卫编队', guard()),
            bossWave('carrier'),
        ],
    },
    {
        index: 9, name: '雷霆核心', bg: '#1E0B0B', boss: 'core', bossHp: 1300, recommendAttack: 9,
        waves: [
            wave('护卫编队', guard()),
            wave('交叉火网', crossfire()),
            wave('铁壁推进', wall(4)),
            wave('两翼包夹', flank(12)),
            wave('V 字突入', vee('grunt', 10)),
            bossWave('core'),
        ],
    },
];

export function getLevel(index: number): ThunderLevelDef {
    return THUNDER_LEVELS[Math.max(0, Math.min(LEVEL_COUNT - 1, index))];
}

// ==================== 存档 / 养成 ====================

export const MAX_UPGRADE: Record<UpgradeTrack, number> = {
    attack: 9,
    armor: 4,
    wing: 3,
    bomb: 2,
};

const UPGRADE_BASE: Record<UpgradeTrack, number> = {
    attack: 100,
    armor: 200,
    wing: 300,
    bomb: 250,
};

const UPGRADE_MULT: Record<UpgradeTrack, number> = {
    attack: 1.55,
    armor: 1.8,
    wing: 2.0,
    bomb: 2.0,
};

export const UPGRADE_LABEL: Record<UpgradeTrack, string> = {
    attack: '武器',
    armor: '装甲',
    wing: '僚机',
    bomb: '炸弹',
};

export function defaultSave(): ThunderSave {
    return {
        v: SAVE_VERSION,
        coins: 0,
        upgrades: { attack: 0, armor: 0, wing: 0, bomb: 0 },
        stars: new Array(LEVEL_COUNT).fill(0),
        bestScore: new Array(LEVEL_COUNT).fill(0),
    };
}

function toInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
}

/** 坏档一律逐字段回落，绝不抛异常 */
export function sanitizeSave(raw: unknown): ThunderSave {
    const out = defaultSave();
    if (!raw || typeof raw !== 'object') return out;
    const src = raw as Record<string, unknown>;
    out.v = SAVE_VERSION;
    out.coins = toInt(src.coins, 0, 1e12, 0);

    const ups = src.upgrades;
    if (ups && typeof ups === 'object') {
        const u = ups as Record<string, unknown>;
        for (const track of Object.keys(MAX_UPGRADE) as UpgradeTrack[]) {
            out.upgrades[track] = toInt(u[track], 0, MAX_UPGRADE[track], 0);
        }
    }

    const stars = src.stars;
    if (Array.isArray(stars)) {
        for (let i = 0; i < LEVEL_COUNT; i++) {
            out.stars[i] = toInt(stars[i], 0, 3, 0);
        }
    }

    const best = src.bestScore;
    if (Array.isArray(best)) {
        for (let i = 0; i < LEVEL_COUNT; i++) {
            out.bestScore[i] = toInt(best[i], 0, 1e9, 0);
        }
    }
    return out;
}

export function upgradeCost(track: UpgradeTrack, level: number): number {
    const lv = Math.max(0, Math.min(MAX_UPGRADE[track], Math.floor(level)));
    if (lv >= MAX_UPGRADE[track]) return Infinity;
    return Math.round(UPGRADE_BASE[track] * Math.pow(UPGRADE_MULT[track], lv));
}

export function isMaxUpgrade(save: ThunderSave, track: UpgradeTrack): boolean {
    return save.upgrades[track] >= MAX_UPGRADE[track];
}

/** 金币足够且未满级时扣款升级；返回是否成功 */
export function applyUpgrade(save: ThunderSave, track: UpgradeTrack): boolean {
    if (isMaxUpgrade(save, track)) return false;
    const cost = upgradeCost(track, save.upgrades[track]);
    if (!Number.isFinite(cost) || save.coins < cost) return false;
    save.coins -= cost;
    save.upgrades[track] = Math.min(MAX_UPGRADE[track], save.upgrades[track] + 1);
    return true;
}

export function playerStats(save: ThunderSave): PlayerStats {
    const attackLevel = save.upgrades.attack;
    const armorLevel = save.upgrades.armor;
    const wingLevel = save.upgrades.wing;
    const bombLevel = save.upgrades.bomb;
    const wingCounts = [0, 2, 2, 4];
    const wingRatios = [0, 0.4, 0.7, 0.7];
    return {
        attackLevel,
        armorLevel,
        wingLevel,
        bombLevel,
        damage: 2 + attackLevel,
        maxLives: Math.min(MAX_LIVES, 3 + armorLevel),
        wingCount: wingCounts[wingLevel] ?? 0,
        wingRatio: wingRatios[wingLevel] ?? 0,
        bombCapacity: 1 + bombLevel,
    };
}

export function starsFor(win: boolean, usedRevive: boolean, usedBomb: boolean): number {
    if (!win) return 0;
    if (usedRevive) return 1;
    if (usedBomb) return 2;
    return 3;
}

export function clearReward(levelIndex: number, stars: number): { clearCoins: number; starCoins: number } {
    const lv = Math.max(0, Math.min(LEVEL_COUNT - 1, Math.floor(levelIndex)));
    const s = Math.max(0, Math.min(3, Math.floor(stars)));
    return {
        clearCoins: s > 0 ? 30 + lv * 10 : 0,
        starCoins: s > 0 ? (s - 1) * 20 : 0,
    };
}

// ==================== 工具 ====================

/** 角度约定：0 = 正下方（+y），顺时针为正 */
export function angleTo(x0: number, y0: number, x1: number, y1: number): number {
    return Math.atan2(x1 - x0, y1 - y0);
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

function dist2Hit(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
    const r = ar + br;
    return dist2(ax, ay, bx, by) <= r * r;
}

/** 玩家子弹齐射形态：偏移 + 角度（角度为正 = 向右偏） */
const POWER_SPREADS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
    [[0, 0]],
    [[-11, 0], [11, 0]],
    [[0, 0], [-12, -0.1], [12, 0.1]],
    [[-22, 0], [22, 0], [-8, -0.14], [8, 0.14]],
    [[0, 0], [-22, -0.22], [-8, -0.1], [8, 0.1], [22, 0.22]],
];

/** 僚机横向偏移 */
const WING_OFFSETS: ReadonlyArray<ReadonlyArray<number>> = [
    [],
    [-46, 46],
    [-46, 46],
    [-64, -38, 38, 64],
];

// ==================== 战斗世界 ====================

export class ThunderWorld {
    readonly level: ThunderLevelDef;
    readonly stats: PlayerStats;

    playerX = PLAYER_START_X;
    playerY = PLAYER_START_Y;
    playerInvuln = 0;
    playerFireT = 0;
    wingFireT = 0;

    playerBullets: Bullet[] = [];
    enemyBullets: Bullet[] = [];
    enemies: Enemy[] = [];
    powerups: Powerup[] = [];

    phase: ThunderPhase = 'playing';
    score = 0;
    coinsEarned = 0;
    kills = 0;
    time = 0;

    waveIndex = 0;
    waveTime = 0;
    entryIndex = 0;
    waveClearT = 0;

    power = 1;
    lives: number;
    bombs: number;
    shields = 0;

    usedBomb = false;
    usedRevive = false;
    reviveAvailable = true;

    private _nextEnemyId = 1;

    constructor(levelIndex: number, stats: PlayerStats) {
        this.level = getLevel(levelIndex);
        this.stats = stats;
        this.lives = stats.maxLives;
        this.bombs = stats.bombCapacity;
    }

    get wave(): ThunderWave {
        return this.level.waves[Math.min(this.waveIndex, this.level.waves.length - 1)];
    }

    get boss(): Enemy | null {
        for (const e of this.enemies) {
            if (isBossKind(e.kind)) return e;
        }
        return null;
    }

    get bombDamage(): number {
        return 80 + 20 * this.stats.attackLevel;
    }

    reset(): void {
        this.playerX = PLAYER_START_X;
        this.playerY = PLAYER_START_Y;
        this.playerInvuln = 0;
        this.playerFireT = 0;
        this.wingFireT = 0;
        this.playerBullets = [];
        this.enemyBullets = [];
        this.enemies = [];
        this.powerups = [];
        this.phase = 'playing';
        this.score = 0;
        this.coinsEarned = 0;
        this.kills = 0;
        this.time = 0;
        this.waveIndex = 0;
        this.waveTime = 0;
        this.entryIndex = 0;
        this.waveClearT = 0;
        this.power = 1;
        this.lives = this.stats.maxLives;
        this.bombs = this.stats.bombCapacity;
        this.shields = 0;
        this.usedBomb = false;
        this.usedRevive = false;
        this.reviveAvailable = true;
        this._nextEnemyId = 1;
    }

    clampPlayer(): void {
        this.playerX = Math.max(PLAYER_MIN_X, Math.min(PLAYER_MAX_X, this.playerX));
        this.playerY = Math.max(PLAYER_MIN_Y, Math.min(PLAYER_MAX_Y, this.playerY));
    }

    movePlayerTo(x: number, y: number): void {
        this.playerX = x;
        this.playerY = y;
        this.clampPlayer();
    }

    movePlayerBy(dx: number, dy: number): void {
        this.playerX += dx;
        this.playerY += dy;
        this.clampPlayer();
    }

    remainingInWave(): number {
        if (this.waveIndex >= this.level.waves.length) return 0;
        const wave = this.level.waves[this.waveIndex];
        return this.enemies.length + Math.max(0, wave.entries.length - this.entryIndex);
    }

    /** 主动炸弹：清屏 + 全场伤害 + 无敌；存量不足返回 false */
    useBomb(): boolean {
        if (this.phase !== 'playing' || this.bombs <= 0) return false;
        this.bombs--;
        this.usedBomb = true;
        this.enemyBullets = [];
        this.playerInvuln = Math.max(this.playerInvuln, BOMB_INVULN);
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            this._damageEnemyAt(i, this.bombDamage);
        }
        return true;
    }

    /** 每关一次复活；仅 phase = 'revive' 时可用 */
    revive(): boolean {
        if (this.phase !== 'revive' || !this.reviveAvailable) return false;
        this.reviveAvailable = false;
        this.usedRevive = true;
        this.lives = REVIVE_LIVES;
        this.shields = 0;
        this.enemyBullets = [];
        this.playerInvuln = Math.max(this.playerInvuln, REVIVE_INVULN);
        this.phase = 'playing';
        return true;
    }

    /** 放弃复活 → 失败 */
    declineRevive(): void {
        if (this.phase === 'revive') this.phase = 'lost';
    }

    update(dt: number): void {
        if (this.phase !== 'playing') return;
        const step = Math.max(0, Math.min(0.05, dt));
        this.time += step;

        if (this.playerInvuln > 0) this.playerInvuln = Math.max(0, this.playerInvuln - step);

        this._updateWaves(step);
        if (this.phase !== 'playing') return;

        this._updatePlayerFire(step);
        this._updateEnemies(step);
        this._updateBullets(step);
        this._updatePowerups(step);
        this._resolveCollisions();
    }

    // ==================== 波次 ====================

    private _updateWaves(dt: number): void {
        const waves = this.level.waves;
        if (this.waveIndex >= waves.length) return;
        const wave = waves[this.waveIndex];
        this.waveTime += dt;

        while (this.entryIndex < wave.entries.length && this.waveTime >= wave.entries[this.entryIndex].t) {
            this._spawn(wave.entries[this.entryIndex]);
            this.entryIndex++;
        }

        if (this.entryIndex >= wave.entries.length && this.enemies.length === 0) {
            this.waveClearT += dt;
            if (this.waveClearT >= WAVE_GAP) {
                this.waveIndex++;
                this.waveTime = 0;
                this.entryIndex = 0;
                this.waveClearT = 0;
                if (this.waveIndex >= waves.length) this.phase = 'won';
            }
        } else {
            this.waveClearT = 0;
        }
    }

    private _spawn(entry: SpawnEntry): void {
        const def = ENEMY_DEFS[entry.kind];
        const boss = isBossKind(entry.kind);
        const hp = boss
            ? this.level.bossHp
            : Math.max(1, Math.round(def.hp * (1 + 0.06 * this.level.index) * (entry.hpMul ?? 1)));
        this.enemies.push({
            id: this._nextEnemyId++,
            kind: entry.kind,
            x: entry.x,
            y: boss ? -90 : -40,
            baseX: entry.x,
            vx: entry.vx ?? 0,
            hp,
            maxHp: hp,
            radius: def.radius,
            mode: entry.mode,
            t: 0,
            fireT: boss ? 1.2 : def.fireInterval * 0.6,
            shotIndex: 0,
            arrived: !boss,
        });
    }

    // ==================== 玩家开火 ====================

    private _updatePlayerFire(dt: number): void {
        this.playerFireT -= dt;
        while (this.playerFireT <= 0) {
            this.playerFireT += BASE_FIRE_INTERVAL;
            this._fireVolley();
        }

        if (this.stats.wingCount > 0) {
            this.wingFireT -= dt;
            while (this.wingFireT <= 0) {
                this.wingFireT += WING_FIRE_INTERVAL;
                this._fireWings();
            }
        }
    }

    private _fireVolley(): void {
        if (this.playerBullets.length >= MAX_BULLETS) return;
        const spread = POWER_SPREADS[Math.max(0, Math.min(MAX_POWER, this.power) - 1)];
        for (const [offset, angle] of spread) {
            if (this.playerBullets.length >= MAX_BULLETS) return;
            this.playerBullets.push({
                x: this.playerX + offset,
                y: this.playerY - 16,
                vx: Math.sin(angle) * PLAYER_BULLET_SPEED,
                vy: -Math.cos(angle) * PLAYER_BULLET_SPEED,
                r: PLAYER_BULLET_R,
                side: 'p',
                dmg: this.stats.damage,
            });
        }
    }

    private _fireWings(): void {
        const offsets = WING_OFFSETS[this.stats.wingLevel] ?? [];
        const dmg = Math.max(1, Math.floor(this.stats.damage * this.stats.wingRatio));
        for (const offset of offsets) {
            if (this.playerBullets.length >= MAX_BULLETS) return;
            this.playerBullets.push({
                x: this.playerX + offset,
                y: this.playerY - 4,
                vx: 0,
                vy: -PLAYER_BULLET_SPEED * 0.92,
                r: 5,
                side: 'p',
                dmg,
            });
        }
    }

    // ==================== 敌人 ====================

    private _updateEnemies(dt: number): void {
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            const def = ENEMY_DEFS[e.kind];
            e.t += dt;

            if (e.mode === 'boss' && !e.arrived) {
                e.y += def.speed * 1.8 * dt;
                if (e.y >= 240) {
                    e.y = 240;
                    e.arrived = true;
                }
            } else if (e.mode === 'boss') {
                e.x = e.baseX + Math.sin(e.t * 0.9) * 150;
            } else if (e.mode === 'sine') {
                e.y += def.speed * dt;
                e.x = e.baseX + Math.sin(e.t * 2.1) * 96;
            } else if (e.mode === 'flank') {
                e.y += def.speed * dt;
                e.x += e.vx * dt;
            } else {
                e.y += def.speed * dt;
            }

            if (!isBossKind(e.kind) && e.y > FIELD_H + 80) {
                this.enemies.splice(i, 1);
                continue;
            }

            // 只有进入可见区域才开火
            if (e.y > 60 && e.y < FIELD_H - 80 && e.arrived) {
                e.fireT -= dt;
                if (e.fireT <= 0) {
                    e.fireT += def.fireInterval;
                    this._enemyFire(e, def);
                }
            }
        }
    }

    private _enemyFire(e: Enemy, def: EnemyDef): void {
        switch (def.pattern) {
            case 'aim':
                this._aimShot(e, def.bulletSpeed, 0);
                break;
            case 'spread3':
                this._aimShot(e, def.bulletSpeed, -0.26);
                this._aimShot(e, def.bulletSpeed, 0);
                this._aimShot(e, def.bulletSpeed, 0.26);
                break;
            case 'ring8': {
                const rot = (e.shotIndex * Math.PI) / 8;
                for (let k = 0; k < 8; k++) {
                    this._angleShot(e, def.bulletSpeed, rot + (k * Math.PI * 2) / 8);
                }
                break;
            }
            case 'boss_destroyer':
                if (e.shotIndex % 2 === 0) {
                    this._aimShot(e, def.bulletSpeed, 0);
                    this._aimShot(e, def.bulletSpeed, -0.18);
                    this._aimShot(e, def.bulletSpeed, 0.18);
                } else {
                    const rot = (e.shotIndex * Math.PI) / 8;
                    for (let k = 0; k < 8; k++) {
                        this._angleShot(e, def.bulletSpeed, rot + (k * Math.PI * 2) / 8);
                    }
                }
                break;
            case 'boss_fortress': {
                const rot = e.shotIndex * 0.42;
                for (let k = 0; k < 3; k++) {
                    this._angleShot(e, def.bulletSpeed, rot + (k * Math.PI * 2) / 3);
                }
                if (e.shotIndex % 2 === 1) {
                    this._aimShot(e, def.bulletSpeed * 1.15, 0);
                }
                break;
            }
            case 'boss_carrier': {
                const rot = e.shotIndex * 0.34;
                this._offsetAngleShot(e, -34, 0, def.bulletSpeed, rot);
                this._offsetAngleShot(e, 34, 0, def.bulletSpeed, -rot);
                if (e.shotIndex % 3 === 2) {
                    for (let k = -2; k <= 2; k++) this._aimShot(e, def.bulletSpeed, k * 0.13);
                }
                break;
            }
            case 'boss_core': {
                const enraged = e.hp <= e.maxHp * 0.5;
                const n = enraged ? 12 : 10;
                const rot = e.shotIndex * (enraged ? 0.3 : 0.22);
                for (let k = 0; k < n; k++) {
                    this._angleShot(e, def.bulletSpeed, rot + (k * Math.PI * 2) / n);
                }
                if (e.shotIndex % 2 === 0) {
                    for (let k = -2; k <= 2; k++) this._aimShot(e, def.bulletSpeed * 1.1, k * 0.14);
                }
                if (enraged && e.shotIndex % 3 === 0) {
                    for (let k = 0; k < 3; k++) {
                        this._angleShot(e, def.bulletSpeed * 0.9, rot * 0.5 + (k * Math.PI * 2) / 3);
                    }
                }
                break;
            }
        }
        e.shotIndex++;
    }

    private _aimShot(e: Enemy, speed: number, angleOffset: number): void {
        this._angleShot(e, speed, angleTo(e.x, e.y, this.playerX, this.playerY) + angleOffset);
    }

    private _angleShot(e: Enemy, speed: number, angle: number): void {
        this._offsetAngleShot(e, 0, 0, speed, angle);
    }

    private _offsetAngleShot(e: Enemy, ox: number, oy: number, speed: number, angle: number): void {
        if (this.enemyBullets.length >= MAX_BULLETS) return;
        this.enemyBullets.push({
            x: e.x + ox,
            y: e.y + oy,
            vx: Math.sin(angle) * speed,
            vy: Math.cos(angle) * speed,
            r: 7,
            side: 'e',
            dmg: 1,
        });
    }

    // ==================== 子弹 / 道具 ====================

    private _updateBullets(dt: number): void {
        for (let i = this.playerBullets.length - 1; i >= 0; i--) {
            const b = this.playerBullets[i];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            if (b.y < -40 || b.x < -40 || b.x > FIELD_W + 40) this.playerBullets.splice(i, 1);
        }
        for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
            const b = this.enemyBullets[i];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            if (b.y < -60 || b.y > FIELD_H + 60 || b.x < -60 || b.x > FIELD_W + 60) {
                this.enemyBullets.splice(i, 1);
            }
        }
    }

    private _updatePowerups(dt: number): void {
        for (let i = this.powerups.length - 1; i >= 0; i--) {
            const u = this.powerups[i];
            u.y += u.vy * dt;
            if (u.y > FIELD_H + 40) {
                this.powerups.splice(i, 1);
                continue;
            }
            if (dist2Hit(u.x, u.y, u.r, this.playerX, this.playerY, PLAYER_R + 12)) {
                this._pickup(u.kind);
                this.powerups.splice(i, 1);
            }
        }
    }

    private _pickup(kind: PowerupKind): void {
        if (kind === 'power') {
            this.power = Math.min(MAX_POWER, this.power + 1);
        } else if (kind === 'bomb') {
            this.bombs = Math.min(this.stats.bombCapacity, this.bombs + 1);
        } else {
            this.shields = Math.min(MAX_SHIELDS, this.shields + 1);
        }
    }

    // ==================== 碰撞 ====================

    private _resolveCollisions(): void {
        // 玩家子弹 → 敌人
        for (let bi = this.playerBullets.length - 1; bi >= 0; bi--) {
            const b = this.playerBullets[bi];
            for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
                const e = this.enemies[ei];
                if (!dist2Hit(b.x, b.y, b.r, e.x, e.y, e.radius)) continue;
                this.playerBullets.splice(bi, 1);
                this._damageEnemyAt(ei, b.dmg);
                break;
            }
        }

        // 敌弹 → 玩家
        for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
            const b = this.enemyBullets[i];
            if (!dist2Hit(b.x, b.y, b.r, this.playerX, this.playerY, PLAYER_R)) continue;
            this.enemyBullets.splice(i, 1);
            this._hitPlayer();
            if (this.phase !== 'playing') return;
        }

        // 机体相撞
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            if (!dist2Hit(e.x, e.y, e.radius, this.playerX, this.playerY, PLAYER_R)) continue;
            this._hitPlayer();
            if (this.phase !== 'playing') return;
            // 双方后退，避免同一帧反复判定
            this.playerY = Math.min(PLAYER_MAX_Y, this.playerY + 24);
            e.y -= 24;
            break;
        }
    }

    private _damageEnemyAt(index: number, dmg: number): void {
        const e = this.enemies[index];
        if (!e) return;
        e.hp -= dmg;
        if (e.hp > 0) return;

        const def = ENEMY_DEFS[e.kind];
        this.score += def.score;
        this.coinsEarned += def.coins;
        if (isBossKind(e.kind)) this.coinsEarned += 40 + this.level.index * 10;
        this.kills++;
        this._maybeDrop(e.x, e.y);
        this.enemies.splice(index, 1);
    }

    /** 固定掉落表：每 10 杀火力、20 杀炸弹、35 杀护盾 */
    private _maybeDrop(x: number, y: number): void {
        const kinds: PowerupKind[] = [];
        if (this.kills % 10 === 0) kinds.push('power');
        if (this.kills % 20 === 0) kinds.push('bomb');
        if (this.kills % 35 === 0) kinds.push('shield');
        for (let i = 0; i < kinds.length; i++) {
            this.powerups.push({
                x: x + (i - (kinds.length - 1) / 2) * 30,
                y,
                vy: POWERUP_FALL_SPEED,
                kind: kinds[i],
                r: POWERUP_R,
            });
        }
    }

    private _hitPlayer(): void {
        if (this.phase !== 'playing' || this.playerInvuln > 0) return;
        if (this.shields > 0) {
            this.shields--;
            this.playerInvuln = SHIELD_INVULN;
            return;
        }
        this.lives--;
        this.playerInvuln = INVULN_TIME;
        if (this.lives <= 0) {
            this.lives = 0;
            this.phase = this.reviveAvailable ? 'revive' : 'lost';
        }
    }
}
