/**
 * 冰箱底下 — 配置与共享类型。
 *
 * 规格：docs/specs/2026-11-09-game-fridge-design.md
 *  - 纯数据 + 常量，不 import 'cc'，可被 Node 自检脚本直接编译运行
 *  - 数值全部来自规格 §7 / §8 / §9 / §10，改动请同步文档
 */

// ==================== 时间与场地 ====================

/** 固定步长（秒）。核心只接受这个 dt，渲染帧率与之解耦 */
export const FIXED_DT = 1 / 60;

/** 战斗区尺寸（设计像素），规格 §6.1 */
export const FIELD_W = 504;
export const FIELD_H = 672;

/** 逻辑网格（9×12），格 56px */
export const TILE = 56;
export const COLS = 9;
export const ROWS = 12;

/** 墙厚 24px；可走区域 = 场地内缩墙厚 */
export const WALL = 24;
export const ARENA_MIN_X = -FIELD_W / 2 + WALL;
export const ARENA_MAX_X = FIELD_W / 2 - WALL;
export const ARENA_MIN_Y = -FIELD_H / 2 + WALL;
export const ARENA_MAX_Y = FIELD_H / 2 - WALL;

/** 门宽 / 门开口半宽 */
export const DOOR_W = 96;
export const DOOR_HALF = DOOR_W / 2;

// ==================== 玩家基础值（规格 §7.1） ====================

export const BASE_HP = 6;            // 半心为单位（3 颗心）
export const MAX_HP = 12;            // 上限 12 半心
export const BASE_DMG = 3.5;
export const BASE_RATE = 2.5;        // 发/秒
export const BASE_RANGE = 340;
export const BASE_SPEED = 215;
export const PLAYER_R = 14;
export const INVULN = 0.9;

export const RATE_MIN = 0.8;
export const RATE_MAX = 6;
export const SHOTS_MAX = 5;
export const SPEED_MUL_MAX = 1.6;
export const DMG_MUL_MIN = 0.25;
export const DMG_MUL_MAX = 3.0;

// ==================== 子弹与敌人上限（规格 §8.5 / §14.3） ====================

export const BULLET_R = 12;
export const MAX_BULLETS = 300;
export const MAX_ENEMIES = 40;
export const ENEMY_BULLET_R = 8;
export const CONTACT_CD = 0.6;

/** 自动瞄准的最大距离 */
export const AUTO_AIM_RANGE = 520;
/** 拾取吸附半径 */
export const PICKUP_R = 40;

// ==================== 标签（规格 §8.1，共 14 个） ====================

export type ItemTag = 'fire' | 'ice' | 'bounce' | 'pierce' | 'explosive'
                    | 'split' | 'homing' | 'chain' | 'poison' | 'shield'
                    | 'speed' | 'luck' | 'heal' | 'shots';

/** 修饰器键：与规格 §8.1 一致 */
export type ModKey = 'dmgFlat' | 'dmgMul' | 'rate' | 'range' | 'shots' | 'speed' | 'luck' | 'hp';

export interface ItemDef {
    id: string;
    name: string;
    /** 0 = 全局池；1–4 = 该层专属 */
    floor: 0 | 1 | 2 | 3 | 4;
    tags: ItemTag[];
    mods: Partial<Record<ModKey, number>>;
    desc: string;
    /** 主动道具：占用唯一主动槽（规格 §8.3 主动槽规则） */
    active?: boolean;
    /** 主动道具充能需求 */
    charges?: number;
}

export interface CharDef {
    id: string;
    name: string;
    /** 初始生命（半心） */
    hp: number;
    dmgMul: number;
    rateMul: number;
    speedMul: number;
    startItem: string;
    skill: { name: string; charges: number; desc: string };
    unlock: { kind: 'default' | 'reachFloor' | 'clearFloor' | 'kills' | 'spend' | 'secrets'; n?: number };
}

export interface EnemyDef {
    kind: string;
    name: string;
    hp: number;
    speed: number;
    r: number;
    /** 接触伤害（半心） */
    dmg: number;
    ranged?: boolean;
    /** 射击间隔（秒） */
    fireCd?: number;
    bulletSpeed?: number;
    /** 行为标记：chase 追踪 / drift 直线反弹 / turret 固定炮台 / dash 冲刺 */
    ai: 'chase' | 'drift' | 'turret' | 'dash' | 'phase';
}

/** 玩家最终属性（角色 × 道具修饰后） */
export interface PlayerStats {
    hp: number;
    maxHp: number;
    dmg: number;
    rate: number;
    shots: number;
    range: number;
    speed: number;
    luck: number;
    maxCharges: number;
}

/** 运行时玩家状态 */
export interface PlayerState extends PlayerStats {
    x: number;
    y: number;
    vx: number;
    vy: number;
    invuln: number;
    shield: number;
    bombs: number;
    charges: number;
    frozenSpeedPenalty: number;
    /** 当前朝向（单位向量），渲染与自动瞄准兜底用 */
    facingX: number;
    facingY: number;
}

export interface Enemy {
    id: number;
    kind: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    r: number;
    speed: number;
    dmg: number;
    vx: number;
    vy: number;
    /** 射击 / 冲刺计时 */
    timer: number;
    /** 受击闪白剩余时间 */
    hitFlash: number;
    gen: number;
}

export interface Bullet {
    id: number;
    owner: 'player' | 'enemy';
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    dmg: number;
    life: number;
    /** 剩余穿透次数 */
    pierce: number;
    /** 剩余反弹次数 */
    bounces: number;
    /** 已命中的敌人 id（防止贯穿弹重复打同一个） */
    hitIds: number[];
}

export interface Pickup {
    id: number;
    kind: 'item' | 'coin' | 'heart';
    itemId?: string;
    x: number;
    y: number;
    bob: number;
}

export type CoreEvent =
    | { type: 'hit'; x: number; y: number }
    | { type: 'kill'; x: number; y: number; kind: string }
    | { type: 'playerHit'; x: number; y: number }
    | { type: 'pickup'; x: number; y: number; itemId: string }
    | { type: 'shoot'; x: number; y: number }
    | { type: 'dead' }
    | { type: 'wave'; n: number };

/** 渲染 / HUD 只读快照 */
export interface FridgeSnapshot {
    phase: 'playing' | 'dead';
    roomCleared: boolean;
    time: number;
    kills: number;
    wave: number;
    player: PlayerState;
    enemies: Enemy[];
    bullets: Bullet[];
    pickups: Pickup[];
    items: string[];
    cores: string[];
    activeItem: string | null;
    /** 当前自动瞄准目标 id（渲染准星用，-1 = 无） */
    aimTargetId: number;
    aimX: number;
    aimY: number;
}

// ==================== 道具表（规格 §8.3，共 40 个） ====================

export const ITEMS: ItemDef[] = [
    // ---- 全局池 16 ----
    { id: 'chili', name: '辣椒酱', floor: 0, tags: ['fire'], mods: { dmgFlat: 1.2 }, desc: '伤害 +1.2' },
    { id: 'sugar', name: '方糖', floor: 0, tags: [], mods: { rate: 0.35, luck: 1 }, desc: '射速 +0.35，幸运 +1' },
    { id: 'straw', name: '吸管', floor: 0, tags: [], mods: { range: 0.3 }, desc: '射程 +30%' },
    { id: 'honey', name: '蜂蜜罐', floor: 0, tags: ['ice'], mods: {}, desc: '命中减速 35%' },
    { id: 'poprock', name: '跳跳糖', floor: 0, tags: ['shots'], mods: { rate: 0.5, shots: 1, dmgMul: 0.8 }, desc: '射速 +0.5，散射 +1，伤害 ×0.8' },
    { id: 'cheese', name: '奶酪护盾', floor: 0, tags: ['shield'], mods: {}, desc: '每房间首次受伤免疫' },
    { id: 'soda', name: '苏打水', floor: 0, tags: ['split', 'shots'], mods: { shots: 1, dmgMul: 0.75 }, desc: '散射 +1，伤害 ×0.75' },
    { id: 'mint', name: '薄荷糖', floor: 0, tags: ['ice'], mods: {}, desc: '命中 15% 概率冻结' },
    { id: 'spatula', name: '锅铲', floor: 0, tags: ['bounce'], mods: {}, desc: '子弹撞墙反弹一次' },
    { id: 'toothpick', name: '牙签', floor: 0, tags: ['pierce'], mods: { dmgMul: 0.8 }, desc: '贯穿敌人，伤害 ×0.8' },
    { id: 'rubberband', name: '橡皮筋', floor: 0, tags: ['bounce'], mods: { range: 0.2 }, desc: '反弹 +1 次，射程 +20%' },
    { id: 'magnifier', name: '放大镜', floor: 0, tags: ['luck'], mods: { luck: 2, range: 0.15 }, desc: '幸运 +2，射程 +15%' },
    { id: 'lighter', name: '打火机', floor: 0, tags: ['fire'], mods: {}, desc: '命中 20% 概率点燃' },
    { id: 'wrap', name: '保鲜膜', floor: 0, tags: ['shield'], mods: {}, desc: '每层首次死亡免疫' },
    { id: 'magnet', name: '磁铁', floor: 0, tags: ['homing'], mods: { rate: -0.2 }, desc: '子弹轻微追踪，射速 −0.2' },
    { id: 'vitamin', name: '维生素', floor: 0, tags: ['heal'], mods: { hp: 2 }, desc: '生命 +2 半心' },

    // ---- 第 1 层专属 6 ----
    { id: 'mold', name: '发霉面包', floor: 1, tags: ['poison'], mods: {}, desc: '命中使敌人持续掉血' },
    { id: 'chilioil', name: '辣椒油', floor: 1, tags: ['fire', 'explosive'], mods: { dmgFlat: 0.8 }, desc: '伤害 +0.8，命中 40px 小爆炸' },
    { id: 'milk', name: '牛奶瓶', floor: 1, tags: ['heal'], mods: { hp: 4, dmgMul: 0.8 }, desc: '回 4 半心，伤害 ×0.8' },
    { id: 'peas', name: '冷冻豌豆', floor: 1, tags: ['ice', 'split', 'shots'], mods: { shots: 1 }, desc: '散射 +1，命中减速 20%' },
    { id: 'canlid', name: '罐头盖', floor: 1, tags: ['bounce', 'shield'], mods: {}, desc: '反弹一次，每房间 1 护盾' },
    { id: 'caramel', name: '焦糖壳', floor: 1, tags: [], mods: {}, desc: '受伤时减速周围敌人' },

    // ---- 第 2 层专属 6 ----
    { id: 'clockwork', name: '发条', floor: 2, tags: [], mods: { rate: 0.6, speed: -0.1 }, desc: '射速 +0.6，移速 −10%' },
    { id: 'bricks', name: '积木', floor: 2, tags: ['split', 'shots'], mods: { shots: 2, dmgMul: 0.65 }, desc: '散射 +2，伤害 ×0.65' },
    { id: 'spring', name: '弹簧鞋', floor: 2, tags: ['bounce', 'speed'], mods: { speed: 0.25 }, desc: '移速 +25%' },
    { id: 'rcar', name: '遥控车', floor: 2, tags: ['homing', 'speed'], mods: { speed: 0.1 }, desc: '子弹追踪，移速 +10%' },
    { id: 'battery', name: '电池', floor: 2, tags: [], mods: {}, desc: '主动道具充能 +2，上限 +1' },
    { id: 'hammer', name: '玩具锤', floor: 2, tags: ['explosive'], mods: {}, desc: '命中 25% 概率爆炸' },

    // ---- 第 3 层专属 6 ----
    { id: 'cartridge', name: '卡带', floor: 3, tags: ['split'], mods: {}, desc: '命中后 30% 分裂' },
    { id: 'patch', name: 'bug 补丁', floor: 3, tags: ['pierce', 'bounce'], mods: {}, desc: '子弹穿墙一次' },
    { id: 'overclock', name: '超频', floor: 3, tags: [], mods: { rate: 1.0 }, desc: '射速翻倍，进房扣 1 半心' },
    { id: 'savepoint', name: '存档点', floor: 3, tags: [], mods: {}, desc: '充能 6：死亡时原地复活（每房一次）', active: true, charges: 6 },
    { id: 'gamepad', name: '手柄', floor: 3, tags: ['shots'], mods: { speed: 0.15, shots: 1 }, desc: '移速 +15%，散射 +1' },
    { id: 'pixel', name: '像素化', floor: 3, tags: ['pierce'], mods: { dmgFlat: 2, range: -0.25 }, desc: '伤害 +2，射程 −25%' },

    // ---- 第 4 层专属 6 ----
    { id: 'frostheart', name: '霜之心', floor: 4, tags: ['ice', 'chain'], mods: {}, desc: '命中连锁 2 个目标' },
    { id: 'rust', name: '铁锈', floor: 4, tags: ['pierce', 'explosive'], mods: {}, desc: '贯穿且命中爆炸' },
    { id: 'compress', name: '压缩弹簧', floor: 4, tags: ['explosive', 'split'], mods: {}, desc: '爆炸裂成 3 小弹' },
    { id: 'coolant', name: '冷冻液', floor: 4, tags: ['ice'], mods: {}, desc: '所有敌人移速 −20%' },
    { id: 'corebit', name: '核心碎片', floor: 4, tags: [], mods: { dmgMul: 1.5, hp: -2 }, desc: '伤害 ×1.5，生命上限 −2 半心' },
    { id: 'lastpudding', name: '最后的布丁', floor: 4, tags: [], mods: {}, desc: '充能 8：3 秒无敌 + 全屏 30 伤害', active: true, charges: 8 },
];

export const ITEM_BY_ID: Record<string, ItemDef> = (() => {
    const map: Record<string, ItemDef> = {};
    for (const it of ITEMS) map[it.id] = it;
    return map;
})();

// ==================== 角色表（规格 §10.1，共 6 个） ====================

export const CHARACTERS: CharDef[] = [
    {
        id: 'pudding', name: '布丁', hp: 6, dmgMul: 1, rateMul: 1, speedMul: 1,
        startItem: 'caramel',
        skill: { name: '糖浆冲刺', charges: 3, desc: '向当前方向冲 120px，0.3s 无敌' },
        unlock: { kind: 'default' },
    },
    {
        id: 'candy', name: '硬糖', hp: 6, dmgMul: 1.35, rateMul: 0.8, speedMul: 0.9,
        startItem: 'spatula',
        skill: { name: '咬碎', charges: 2, desc: '本房间伤害 +50%，代价掉 1 半心' },
        unlock: { kind: 'reachFloor', n: 2 },
    },
    {
        id: 'icecube', name: '冰块', hp: 6, dmgMul: 0.9, rateMul: 1, speedMul: 1.2,
        startItem: 'mint',
        skill: { name: '自冻', charges: 4, desc: '1.5s 无敌但不能移动' },
        unlock: { kind: 'kills', n: 200 },
    },
    {
        id: 'soda', name: '气泡水', hp: 8, dmgMul: 0.8, rateMul: 0.9, speedMul: 1,
        startItem: 'soda',
        skill: { name: '摇晃爆发', charges: 4, desc: '四周 140px 击退 + 1.5 倍伤害' },
        unlock: { kind: 'spend', n: 300 },
    },
    {
        id: 'yogurt', name: '过期酸奶', hp: 10, dmgMul: 1.1, rateMul: 0.9, speedMul: 0.95,
        startItem: 'mold',
        skill: { name: '发酵', charges: 5, desc: '引爆全场敌人的中毒层数' },
        unlock: { kind: 'clearFloor', n: 3 },
    },
    {
        id: 'magneto', name: '冰箱贴', hp: 2, dmgMul: 1.2, rateMul: 1.05, speedMul: 1.1,
        startItem: 'magnet',
        skill: { name: '吸星', charges: 6, desc: '把全场敌弹吸成金币' },
        unlock: { kind: 'secrets', n: 5 },
    },
];

export const CHAR_BY_ID: Record<string, CharDef> = (() => {
    const map: Record<string, CharDef> = {};
    for (const c of CHARACTERS) map[c.id] = c;
    return map;
})();

// ==================== 敌人表（规格 §9.1） ====================

export const ENEMY_DEFS: Record<string, EnemyDef> = {
    // 第 1 层
    moldball: { kind: 'moldball', name: '霉球', hp: 10, speed: 58, r: 16, dmg: 1, ai: 'chase' },
    jelly: { kind: 'jelly', name: '果冻', hp: 12, speed: 46, r: 18, dmg: 1, ai: 'chase' },
    canman: { kind: 'canman', name: '罐头兵', hp: 14, speed: 40, r: 17, dmg: 1, ranged: true, fireCd: 2.0, bulletSpeed: 170, ai: 'chase' },
    roach: { kind: 'roach', name: '蟑螂', hp: 8, speed: 90, r: 13, dmg: 1, ai: 'dash' },
    // 第 2 层
    clockbot: { kind: 'clockbot', name: '发条兵', hp: 16, speed: 52, r: 16, dmg: 1, ranged: true, fireCd: 2.2, bulletSpeed: 165, ai: 'drift' },
    duck: { kind: 'duck', name: '橡皮鸭', hp: 14, speed: 95, r: 16, dmg: 1, ai: 'drift' },
    blocktower: { kind: 'blocktower', name: '积木塔', hp: 30, speed: 0, r: 22, dmg: 1, ranged: true, fireCd: 2.6, bulletSpeed: 150, ai: 'turret' },
    top: { kind: 'top', name: '陀螺', hp: 18, speed: 110, r: 15, dmg: 1, ai: 'dash' },
    // 第 3 层
    ghost: { kind: 'ghost', name: '像素幽灵', hp: 18, speed: 62, r: 16, dmg: 1, ai: 'chase' },
    bug: { kind: 'bug', name: 'bug', hp: 20, speed: 55, r: 15, dmg: 1, ai: 'phase' },
    cartridge: { kind: 'cartridge', name: '卡带', hp: 26, speed: 45, r: 18, dmg: 1, ai: 'chase' },
    dpad: { kind: 'dpad', name: '十字键', hp: 24, speed: 0, r: 20, dmg: 1, ranged: true, fireCd: 2.0, bulletSpeed: 160, ai: 'turret' },
    // 第 4 层
    frostspike: { kind: 'frostspike', name: '霜刺', hp: 28, speed: 130, r: 15, dmg: 1, ai: 'dash' },
    rustknight: { kind: 'rustknight', name: '铁锈骑士', hp: 45, speed: 48, r: 22, dmg: 1, ai: 'chase' },
    conddrop: { kind: 'conddrop', name: '冷凝滴', hp: 22, speed: 70, r: 15, dmg: 1, ai: 'chase' },
    piston: { kind: 'piston', name: '活塞', hp: 60, speed: 0, r: 26, dmg: 1, ai: 'turret' },
};

/** 每层敌人池（刷怪用） */
export const FLOOR_ENEMIES: Record<number, string[]> = {
    1: ['moldball', 'jelly', 'canman', 'roach'],
    2: ['clockbot', 'duck', 'blocktower', 'top'],
    3: ['ghost', 'bug', 'cartridge', 'dpad'],
    4: ['frostspike', 'rustknight', 'conddrop', 'piston'],
};

/** 每层调色板（规格 §3） */
export interface FloorPalette {
    bg: string;
    wall: string;
    floor: string;
    door: string;
    accent: string;
}

export const FLOOR_PALETTES: Record<number, FloorPalette> = {
    1: { bg: '#0E1B26', wall: '#20323F', floor: '#14232F', door: '#F2C14E', accent: '#F2C14E' },
    2: { bg: '#2A1F17', wall: '#3E2C1F', floor: '#33251A', door: '#E8A33D', accent: '#E8A33D' },
    3: { bg: '#121026', wall: '#1F1A3A', floor: '#171430', door: '#7CFF6B', accent: '#C77DFF' },
    4: { bg: '#12141C', wall: '#222634', floor: '#171A24', door: '#9FE8FF', accent: '#9FE8FF' },
};

// ==================== 属性计算（规格 §7.1 公式，自检直接断言） ====================

export function clamp(v: number, lo: number, hi: number): number {
    if (!isFinite(v)) return lo;
    return v < lo ? lo : v > hi ? hi : v;
}

export interface StatMods {
    dmgFlat: number;
    dmgMul: number;
    rate: number;
    range: number;
    shots: number;
    speed: number;
    luck: number;
    hp: number;
}

export function emptyMods(): StatMods {
    return { dmgFlat: 0, dmgMul: 1, rate: 0, range: 0, shots: 0, speed: 0, luck: 0, hp: 0 };
}

/** 把道具列表的修饰器累加进 mods（加法叠加，dmgMul 相乘） */
export function accumulateMods(mods: StatMods, items: string[]): StatMods {
    for (const id of items) {
        const it = ITEM_BY_ID[id];
        if (!it) continue;
        const m = it.mods;
        if (m.dmgFlat) mods.dmgFlat += m.dmgFlat;
        if (m.dmgMul) mods.dmgMul *= m.dmgMul;
        if (m.rate) mods.rate += m.rate;
        if (m.range) mods.range += m.range;
        if (m.shots) mods.shots += m.shots;
        if (m.speed) mods.speed += m.speed;
        if (m.luck) mods.luck += m.luck;
        if (m.hp) mods.hp += m.hp;
    }
    mods.dmgMul = clamp(mods.dmgMul, DMG_MUL_MIN, DMG_MUL_MAX);
    return mods;
}

/** 角色 + 道具 → 最终属性（规格 §7.1） */
export function computeStats(charId: string, items: string[]): PlayerStats {
    const char = CHAR_BY_ID[charId] || CHARACTERS[0];
    const mods = accumulateMods(emptyMods(), items);
    const dmg = (BASE_DMG + mods.dmgFlat) * char.dmgMul * mods.dmgMul;
    const rate = clamp(BASE_RATE * char.rateMul * (1 + mods.rate), RATE_MIN, RATE_MAX);
    const shots = clamp(1 + mods.shots, 1, SHOTS_MAX);
    const range = BASE_RANGE * (1 + mods.range);
    const speed = BASE_SPEED * char.speedMul * clamp(1 + mods.speed, 0.3, SPEED_MUL_MAX);
    const maxHp = clamp(char.hp + mods.hp, 2, MAX_HP);
    return {
        hp: maxHp,
        maxHp,
        dmg,
        rate,
        shots,
        range,
        speed,
        luck: mods.luck,
        maxCharges: 3,
    };
}
