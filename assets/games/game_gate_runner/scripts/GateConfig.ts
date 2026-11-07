/**
 * 数值冲刺（Gate Runner）— 规则与表现常量。
 *
 * 本文件不依赖 cc，可在 Node 侧直接编译验证。
 * 坐标系：逻辑坐标原点在游戏区左上角，x 向右，y **向下**（与砖块远征/合合大作战一致）。
 * 世界里的物体用「已前进距离 distance」定位：屏幕 y = PLAYER_Y - (worldY - distance)。
 */

// ==================== 游戏区 ====================

export const PLAY_W = 660;
export const PLAY_H = 860;

/** 玩家（队伍方阵中心）固定在屏幕的这个高度 */
export const PLAYER_Y = 700;

/** 横移范围（队伍中心） */
export const PLAYER_X_MIN = 90;
export const PLAYER_X_MAX = 570;

/** 队伍方阵的名义半径，只影响表现与"接触距离"的可读性 */
export const PLAYER_R = 26;

// ==================== 世界推进 ====================

/** 一个段落的世界长度 */
export const SEGMENT_LEN = 360;

/**
 * 段落数（偶数段放门、奇数段放敌人）。
 *
 * 原 12 段（6 门 + 6 敌人）实测 autopilot 17 s 就通关，远低于本作 1–3 分钟的目标；
 * 22 段（11 门 + 11 敌人）+ 更慢的滚动速度把 casual 一局拉到 60–80 s，Boss 约 6–8 s。
 */
export const SEGMENT_COUNT = 22;

/** Boss 的世界位置：最后一段敌人之后留一小段空地（22 × 360 + 280） */
export const BOSS_DISTANCE = 8200;

/** 起始前进速度（px/s） */
export const SCROLL_BASE = 300;

/** 速度上限（原 620 下 4600 px 只够跑 8 s，撑不起一局） */
export const SCROLL_MAX = 440;

/** 每前进 1 px 增加的速度，封顶 SCROLL_MAX */
export const SCROLL_ACCEL = 0.05;

/** 与敌人的接触距离（世界坐标，位于播放器前方） */
export const CONTACT_DIST = 64;

// ==================== 数值 ====================

/** 初始人数 */
export const START_COUNT = 20;

/** 人数上限（防溢出/防显示撑爆）。22 段规模下单局人数可以到几万，9999 会过早封顶 */
export const COUNT_MAX = 99999;

/** 开局火力上限（之后随距离与升级卡成长，见 fireCapAt） */
export const FIRE_CAP = 60;

/** 每前进 1 px 火力上限的成长（4600 px 全程约 +15） */
export const FIRE_CAP_GROWTH_PER_PX = 1 / 300;

/**
 * 敌人每秒额外消耗队伍的比例。
 *
 * 旧值 0.08 让每场对拼固定掉 ~34% 人数，人数再多也一样 —— 攒数字的爽感在攒起来的那一刻消失。
 * 降到 0.03 后「固定伤害 + 少量比例」成为主体：人多真的更耐打，大数字重新有意义。
 */
export const ENEMY_DRAIN_RATIO = 0.03;

/** Boss 的额外消耗倍率（比例部分同乘） */
export const BOSS_DRAIN_MULT = 1.5;

/** Boss 血量（22 段局长跑后火力上限更高，300 血只够打 1–2 s，撑不起终局） */
export const BOSS_HP = 1200;

/** Boss 阶段阈值（剩余血量比例）与每阶段的 dps / 攻击倍率 */
export const BOSS_PHASE_2_RATIO = 0.66;
export const BOSS_PHASE_3_RATIO = 0.33;
export const BOSS_PHASE_DPS_MULT = [1, 0.78, 0.62];
export const BOSS_PHASE_ATK_MULT = [1, 1.15, 1.45];

/** 当前火力上限：基础值 + 距离成长 + 升级卡加成 */
export function fireCapAt(distance: number, bonus: number = 0): number {
    const grow = Math.floor(Math.max(0, distance) * FIRE_CAP_GROWTH_PER_PX);
    return FIRE_CAP + grow + bonus;
}

/** 由血量比例得到 Boss 阶段（1/2/3） */
export function bossPhaseOf(hp: number, maxHp: number): number {
    const ratio = maxHp > 0 ? hp / maxHp : 0;
    if (ratio > BOSS_PHASE_2_RATIO) return 1;
    if (ratio > BOSS_PHASE_3_RATIO) return 2;
    return 3;
}

// ==================== 弱点瞄准 ====================

/**
 * 对拼时敌人身上有一个左右摆动的金色弱点。队伍停在弱点下方即可放大输出。
 * 复用已有的横移输入，不新增手势；「提前就位选门」与「打满输出」因此形成取舍。
 */
export const AIM_DPS_MULT = 1.8;

/** 队伍中心与弱点中心的允许误差（逻辑 px） */
export const AIM_TOLERANCE = 34;

/** 弱点摆动幅度上限 / 基础角速度 */
export const WEAK_AMP_MAX = 96;
export const WEAK_SPEED = 1.5;

/** Boss 的弱点更宽更慢，避免终局变成纯手速 */
export const BOSS_WEAK_AMP = 120;
export const BOSS_WEAK_SPEED = 1.1;

/** 固定子步长：门触发与对拼都按子步推进，避免大 dt 跳门 */
export const SUBSTEP_SEC = 1 / 120;

/** 单帧 dt 上限（切后台回来不一次算爆） */
export const MAX_FRAME_DT = 0.05;

/** 每这么久产出一个 squad_hit 飘字事件 */
export const SQUAD_HIT_EVENT_SEC = 0.2;

// ==================== 集火（主动技能） ====================

/**
 * 点一下屏幕 = 集火：短时把 dps 拉高。
 * 对拼阶段原本是纯挂机看数字，加了集火之后玩家有事可做，而且"打得快 = 掉的少"，
 * 时机好坏直接换算成存活人数。
 */
export const PULSE_DURATION_SEC = 1.6;

/** 集火冷却 */
export const PULSE_COOLDOWN_SEC = 4.5;

/** 集火期间的 dps 倍率（仍以 FIRE_CAP 为基准放大） */
export const PULSE_DPS_MULT = 2.2;

// ==================== 完美选门连击 ====================

/**
 * 连续选到"更优的那一侧"记为完美。
 * 好处不能给太猛（×2 / ×3 门本身已经是复利），给一点点人数 + 明确的正反馈。
 */
export const STREAK_BONUS_STEP = 3;

/** 每满 STREAK_BONUS_STEP 连击，额外加当前人数的这个比例 */
export const STREAK_BONUS_RATIO = 0.15;

/** 连击奖励的下限，避免人数很少时奖励看不见 */
export const STREAK_BONUS_MIN = 5;

/** 连击奖励的人数增量 */
export function streakBonus(after: number): number {
    const b = Math.floor(after * STREAK_BONUS_RATIO);
    return b > STREAK_BONUS_MIN ? b : STREAK_BONUS_MIN;
}

// ==================== 局内三选一（升级卡） ====================

export type UpgradeId = 'fire_cap' | 'pulse_cd' | 'aim' | 'armor' | 'streak' | 'heal';

export interface UpgradeDef {
    id: UpgradeId;
    name: string;
    desc: string;
}

/** 每次升级卡给几张可选 */
export const UPGRADE_CHOICES = 3;

export const UPGRADE_FIRE_CAP_BONUS = 12;
export const UPGRADE_PULSE_CD_MULT = 0.8;
/** 冷却倍率的叠乘下限（再叠也不会低于这个比例） */
export const UPGRADE_PULSE_CD_FLOOR = 0.45;
export const UPGRADE_AIM_BONUS = 0.3;
export const UPGRADE_ARMOR_BONUS = 0.15;
export const UPGRADE_ARMOR_CAP = 0.45;
export const UPGRADE_STREAK_MULT = 2;
export const UPGRADE_HEAL_RATIO = 0.25;
export const UPGRADE_HEAL_MIN = 15;

/** 升级卡池。每次随机抽 UPGRADE_CHOICES 张不重复的。 */
export const UPGRADE_POOL: UpgradeDef[] = [
    { id: 'fire_cap', name: '火力扩容', desc: `火力上限 +${UPGRADE_FIRE_CAP_BONUS}` },
    { id: 'pulse_cd', name: '急速冷却', desc: '集火冷却 −20%' },
    { id: 'aim', name: '弱点专精', desc: '弱点击破伤害 +30%' },
    { id: 'armor', name: '全军护甲', desc: '每场对拼受伤 −15%' },
    { id: 'streak', name: '连击狂热', desc: '连击奖励翻倍' },
    { id: 'heal', name: '紧急补给', desc: `立即恢复 ${Math.round(UPGRADE_HEAL_RATIO * 100)}% 人数` },
];

/** 升级卡出现的时机：第 N 对门之后（按 gates 下标）。
 *  22 段局共 11 对门，三次分别落在中前段 / 中段 / Boss 前。 */
export const CHOICE_AFTER_GATE_INDEX: number[] = [2, 5, 8];

/** 门触发后前进这么远才弹卡片，避免和门的反馈叠在同一帧 */
export const CHOICE_TRIGGER_OFFSET = 100;

// ==================== 数值门 ====================

/** 门板宽度：左门 x ∈ [40, 320]，右门 x ∈ [340, 620] */
export const GATE_W = 280;

/** 门板高度 */
export const GATE_H = 90;

/** 左门左边线 / 右门左边线 */
export const GATE_LEFT_X = 40;
export const GATE_RIGHT_X = 340;

/** 玩家中心 x 小于该值即判定为走左门 */
export const GATE_SPLIT_X = 330;

export type GateOpKind = 'mul' | 'div' | 'add' | 'sub';

export interface GateOp {
    kind: GateOpKind;
    value: number;
}

export type GateModKind = 'armor' | 'power' | 'cooldown';

/**
 * 门的「延迟收益」：选这一侧除了立刻改人数，还附带一段持续到之后对拼的效果。
 *
 * 这是让二选一不再是假选择的关键：只有「人数」一个维度时，总有一侧数字更大、玩家永远选它。
 * 把另一侧改成「现在少一点、下一战更稳」，选择才真正变成下注。
 */
export interface GateMod {
    kind: GateModKind;
    /**
     * armor  : 受伤减免比例（0.35 = 少掉 35%）
     * power  : 对拼 dps 倍率增量（0.4 = ×1.4）
     * cooldown: 立即减少的集火冷却秒数
     */
    value: number;
    /** armor / power 生效的对拼场次；cooldown 忽略 */
    fights: number;
}

export interface GateSideDef {
    op: GateOp;
    mod?: GateMod;
}

export interface GateTemplate {
    a: GateSideDef;
    b: GateSideDef;
    /** 该模板从多远开始出现（世界坐标） */
    from: number;
}

function op(kind: GateOpKind, value: number): GateOp {
    return { kind, value };
}

function side(kind: GateOpKind, value: number, mod?: GateMod): GateSideDef {
    return mod ? { op: op(kind, value), mod } : { op: op(kind, value) };
}

const armorMod = (value: number, fights: number): GateMod => ({ kind: 'armor', value, fights });
const powerMod = (value: number, fights: number): GateMod => ({ kind: 'power', value, fights });
const cdMod = (value: number): GateMod => ({ kind: 'cooldown', value, fights: 0 });

/**
 * 门模板池。每对门随机抽一个模板，左右随机交换。
 * 前期只有加法/×2，中后期才出现 ÷2 / ÷3、−N 这类风险选项，以及带附加效果的「延迟收益」侧。
 * 附加效果一律挂在「立即数字更吃亏」的那一侧，制造「现在 vs 之后」的取舍。
 */
export const GATE_TEMPLATES: GateTemplate[] = [
    { a: side('mul', 2), b: side('add', 30), from: 0 },
    { a: side('mul', 2), b: side('div', 2), from: 0 },
    { a: side('add', 20), b: side('add', 50), from: 0 },
    // 附加效果开始出现：人数少时 +60 反而更大，人多时用护甲换掉一部分血量
    { a: side('mul', 2), b: side('add', 60, armorMod(0.35, 2)), from: 1300 },
    // 挨一刀换两场火力：给「下个敌人是再生/盾兵」的预判用
    { a: side('mul', 2), b: side('sub', 10, powerMod(0.35, 2)), from: 1300 },
    // 激进：÷2 换两场 ×1.5 火力
    { a: side('mul', 3), b: side('div', 2, powerMod(0.5, 2)), from: 2600 },
    // 拿大数，或拿一次立刻可用的爆发（冷却直接清零式缩短）
    { a: side('add', 100), b: side('div', 2, cdMod(3)), from: 2600 },
    { a: side('mul', 3), b: side('div', 3), from: 3900 },
    // 读秒题：−100 换三场 50% 减伤，扛得过下一个刺客就赚
    { a: side('add', 150), b: side('sub', 100, armorMod(0.5, 3)), from: 3900 },
    { a: side('mul', 2), b: side('div', 3), from: 6500 },
];

/** 附加效果的简短标签（门下方的小字） */
export function gateModLabel(mod: GateMod): string {
    switch (mod.kind) {
        case 'armor': return `−伤${Math.round(mod.value * 100)}%·${mod.fights}战`;
        case 'power': return `火力+${Math.round(mod.value * 100)}%·${mod.fights}战`;
        case 'cooldown': return `集火−${mod.value}s`;
        default: return '';
    }
}

/** 把人数钳进 [0, COUNT_MAX] */
export function clampCount(v: number): number {
    if (!isFinite(v) || isNaN(v)) return 0;
    if (v < 0) return 0;
    if (v > COUNT_MAX) return COUNT_MAX;
    return Math.floor(v);
}

/**
 * 应用一次门操作。
 *
 * 除法**不会**把队伍直接除到 0 —— 最低保留 1：
 * 否则前期一次倒霉的 ÷2（20 → 10 → 5 → 2 → 1 → 0）等于直接判负，
 * 而玩家在那一刻并没有做错任何操作。真正能把人数打到 0 的只有 `−N` 门和敌人。
 */
export function applyGateOp(count: number, op: GateOp): number {
    const before = clampCount(count);
    if (before <= 0) return 0;
    const v = Math.max(1, Math.floor(op.value));
    switch (op.kind) {
        case 'mul':
            return clampCount(before * v);
        case 'div':
            return clampCount(Math.max(1, Math.floor(before / v)));
        case 'add':
            return clampCount(before + v);
        case 'sub':
            return clampCount(before - v);
        default:
            return before;
    }
}

/** 门的显示文本：×2 / ÷2 / +20 / −10 */
export function gateOpLabel(op: GateOp): string {
    switch (op.kind) {
        case 'mul': return `×${op.value}`;
        case 'div': return `÷${op.value}`;
        case 'add': return `+${op.value}`;
        case 'sub': return `−${op.value}`;
        default: return '?';
    }
}

// ==================== 敌人 ====================

export type EnemyKind = 'grunt' | 'shield' | 'assassin' | 'regen' | 'boss';

export interface EnemyProfile {
    label: string;
    hpMult: number;
    atkMult: number;
    widthMult: number;
    /** 比例消耗倍率（刺客更狠） */
    drainMult: number;
    /** 每秒回复自身最大血量的比例（再生兵；0 = 不回血） */
    regenRatio: number;
    color: number;
}

/**
 * 敌人类型。除数值外给每种敌人一个明确的「问题」：
 * 盾兵考 dps 上限、刺客考爆发与减伤、再生兵惩罚拖延。
 * 玩家在门前就能看到类型标签，于是「为下一战选门」才有依据。
 */
export const ENEMY_PROFILES: Record<EnemyKind, EnemyProfile> = {
    grunt:    { label: '步兵', hpMult: 1,    atkMult: 1,    widthMult: 1,    drainMult: 1,   regenRatio: 0,    color: 0xff6b6b },
    shield:   { label: '盾兵', hpMult: 1.9,  atkMult: 0.65, widthMult: 1.15, drainMult: 1,   regenRatio: 0,    color: 0xff9a5c },
    assassin: { label: '刺客', hpMult: 0.55, atkMult: 1.9,  widthMult: 0.9,  drainMult: 1.2, regenRatio: 0,    color: 0xff4d9e },
    regen:    { label: '再生', hpMult: 1.15, atkMult: 0.8,  widthMult: 1,    drainMult: 1,   regenRatio: 0.06, color: 0x5ee0d0 },
    boss:     { label: 'BOSS', hpMult: 1,    atkMult: 1,    widthMult: 1,    drainMult: 1.5, regenRatio: 0,    color: 0xff4d6d },
};

/**
 * 11 个普通敌人的类型排期（22 段 = 11 场对拼）：前期教学，后期才出现刺客/再生。
 * 每一档给一个明确的「这一战考什么」，最后几场以组合池收尾。
 */
export const ENEMY_KIND_POOLS: EnemyKind[][] = [
    ['grunt'],
    ['grunt', 'shield'],
    ['shield', 'assassin'],
    ['assassin', 'regen'],
    ['shield', 'regen'],
    ['shield', 'assassin', 'regen'],
    ['shield', 'assassin', 'regen'],
    ['assassin', 'regen'],
    ['shield', 'assassin', 'regen'],
    ['shield', 'regen'],
    ['shield', 'assassin', 'regen'],
];

export function enemyProfile(kind: EnemyKind): EnemyProfile {
    return ENEMY_PROFILES[kind] || ENEMY_PROFILES.grunt;
}

export function enemyKindLabel(kind: EnemyKind): string {
    return enemyProfile(kind).label;
}

/**
 * 普通敌人血量：随前进距离线性增长，再乘类型系数。
 * 斜率 0.05→0.12：22 段局跑到 8200 px 时血量约 1000（配合成长后的火力上限约 3–6 s 一场），
 * 让后半程的对拼有足够重量，而不是一击秒杀。
 */
export function enemyHpAt(distance: number, kind: EnemyKind = 'grunt'): number {
    return Math.round((24 + 0.12 * distance) * enemyProfile(kind).hpMult);
}

/** 普通敌人每秒基础伤害 */
export function enemyAtkAt(distance: number, kind: EnemyKind = 'grunt'): number {
    return (2 + distance / 800) * enemyProfile(kind).atkMult;
}

/** 敌人挡路宽度（只用于绘制，v1 不允许绕行） */
export function enemyWidthAt(distance: number, kind: EnemyKind = 'grunt'): number {
    return Math.min(420, (260 + distance / 20) * enemyProfile(kind).widthMult);
}

/** 敌人每秒回血量 */
export function enemyRegenAt(kind: EnemyKind, maxHp: number): number {
    return maxHp * enemyProfile(kind).regenRatio;
}

/** Boss 每秒基础伤害 */
export function bossAtkAt(distance: number): number {
    return enemyAtkAt(distance) * BOSS_DRAIN_MULT;
}

/** 当前前进速度 */
export function scrollSpeedAt(distance: number): number {
    const v = SCROLL_BASE + distance * SCROLL_ACCEL;
    return v > SCROLL_MAX ? SCROLL_MAX : v;
}

// ==================== 计分 ====================

export const SCORE_PER_DISTANCE = 0.1;
export const SCORE_PER_COUNT = 10;
export const VICTORY_BONUS = 1000;

export function computeScore(distance: number, count: number, victory: boolean): number {
    const base = distance * SCORE_PER_DISTANCE + clampCount(count) * SCORE_PER_COUNT;
    return Math.round(base + (victory ? VICTORY_BONUS : 0));
}

// ==================== 表现 ====================

/** 队伍最多画这么多个圆点，超出用数字标签表示 */
export const SQUAD_DOTS_MAX = 40;

/** 队伍点半径下限/上限（人多时缩小） */
export const SQUAD_DOT_MIN_R = 5;
export const SQUAD_DOT_MAX_R = 11;

/** 子弹硬上限（对象池容量） */
export const MAX_BULLETS = 80;

/** 碎屑硬上限 */
export const MAX_DEBRIS = 120;

/** 枪口相对于队伍中心的前方偏移 */
export const MUZZLE_OFFSET_Y = 34;

/** 敌人名标签的最大宽度（超长按 SHRINK 缩字，避免压到相邻物体） */
export const ENEMY_LABEL_MAX_W = 240;

/** 敌人名标签与血条之间的最小间距（逻辑 px） */
export const ENEMY_LABEL_GAP = 4;

/**
 * 弱点靶心的可视半径。命中判定是「队伍中心 x 与弱点 x 相差 ≤ AIM_TOLERANCE」，
 * 视觉直径不能小于 44 设计像素（触屏命中区的通行下限），否则玩家会以为打不到。
 */
export const WEAK_POINT_R = 22;

/** 弱点外圈呼吸光环半径 */
export const WEAK_GLOW_R = 40;

/** Boss 阶段切换闪光时长 */
export const BOSS_PHASE_FLASH_SEC = 0.5;

export const COLORS = {
    bg: 0x151e33,
    bgLine: 0x1e2a44,
    road: 0x1a2440,
    roadEdge: 0x2a3a5c,
    ally: 0x6ee7ff,
    allyDark: 0x2b9fbf,
    enemy: 0xff6b6b,
    enemyDark: 0x9b2b2b,
    boss: 0xff4d6d,
    text: 0xffffff,
    textDim: 0x8ea3c8,
    /** 门：变多=绿、变少=红（配合门上的方向箭头，不看数字也能读出趋势） */
    mul: 0x22c55e,
    div: 0xef4444,
    add: 0x6ee7b7,
    sub: 0xffa94d,
    gateInk: 0xffffff,
    success: 0x6ee7b7,
    danger: 0xff6b6b,
    /** 集火 / 完美连击 / 弱点的高亮色 */
    gold: 0xffd166,
    goldDark: 0xb08a2e,
    /** 人数徽标 / 状态小胶囊 */
    badge: 0x0f172a,
    /** 升级卡 */
    card: 0x1b2a4a,
    cardEdge: 0x4ea8ff,
    cardInk: 0xffffff,
    cardDesc: 0x9fb6dc,
};

/** Boss 三阶段的配色（越长越危险） */
export const BOSS_PHASE_COLORS = [0xff4d6d, 0xff7a3d, 0xff2d55];

/** 门操作对应的色板 */
export function gateOpColor(kind: GateOpKind): number {
    switch (kind) {
        case 'mul': return COLORS.mul;
        case 'div': return COLORS.div;
        case 'add': return COLORS.add;
        case 'sub': return COLORS.sub;
        default: return COLORS.textDim;
    }
}
