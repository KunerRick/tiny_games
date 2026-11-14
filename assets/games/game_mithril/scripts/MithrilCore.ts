/**
 * 《秘银远征》战斗核心（纯逻辑，**不得 import cc**）。
 *
 * M0 立的骨架（确定性随机 / 伤害公式 / 固定步长世界）保持对外形状不变；
 * M1 在其上补齐垂直切片：
 *  - 战士六技能与怒气循环
 *  - 近战 / 远程 / 精英 / BOSS 四类敌人 AI
 *  - 3 遭遇 + 1 BOSS 的副本推进
 *  - BOSS 三阶段机制解算器：走位（预警圈）/ 转火（小怪回血）/ 打断（读条）
 *
 * 所有随机都走 world.rng，保证同种子同输入 → 同快照。
 * 渲染层只读 snapshot + drainEvents，绝不改这里的任何状态。
 */

import {
    BOSS_INTRO_GAP,
    BOSS_PHASE_HEAL_PCT,
    ENCOUNTER_GAP,
    ENCOUNTER_HEAL_PCT,
    ENEMY_BY_ID,
    FIELD_H,
    FIELD_W,
    FIXED_DT,
    MAX_BULLETS,
    MAX_ENEMIES,
    MAX_ORBS,
    MINE_BOSS_SCRIPT,
    MINE_ENCOUNTERS,
    ORB_ADD_DROP_CHANCE,
    ORB_DROP_CHANCE,
    ORB_HEAL_PCT,
    ORB_LIFE,
    ORB_PICKUP_RADIUS,
    PLAYER_TUNING,
} from './MithrilConfig';
import type { BossScriptDef, ClassId, EnemyDef, EquipItem, GearSlot } from './MithrilConfig';
import {
    BALANCED_ALLOC,
    CRIT_MULT,
    attackPowerAt,
    maxHpAt,
    secondaryStats,
} from './MithrilProgress';
import type { AffixAlloc, MithrilSave } from './MithrilProgress';

export { FIELD_H, FIELD_W, FIXED_DT, MAX_BULLETS, MAX_ENEMIES };

/** 受击后无敌时长（秒） */
export const HIT_INVULN = 0.5;
/** 玩家碰撞半径 */
export const PLAYER_RADIUS = 18;
/** 玩家基础移速（设计像素 / 秒） */
export const PLAYER_SPEED = 240;

/** 玩家出生点（下方，给上方敌人留出走位空间） */
export const PLAYER_START_X = FIELD_W / 2;
export const PLAYER_START_Y = 380;

// ==================== 随机 ====================

/** 同种子必然同序列；返回 [0, 1) */
export function mulberry32(seed: number): () => number {
    let a = (Math.floor(seed) >>> 0) || 1;
    return function next(): number {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ==================== 战斗属性 ====================

export interface CombatProfile {
    classId: ClassId;
    level: number;
    attackPower: number;
    maxHp: number;
    critChance: number;
    critMult: number;
    haste: number;
    mastery: number;
    vers: number;
}

/** 由等级 + 装备装等 + 词条配点推导出实战属性 */
export function makeProfile(
    classId: ClassId,
    level: number,
    ilvl: number,
    alloc: AffixAlloc = BALANCED_ALLOC,
): CombatProfile {
    const sec = secondaryStats(ilvl, alloc);
    return {
        classId,
        level,
        attackPower: attackPowerAt(level),
        maxHp: maxHpAt(level),
        critChance: sec.crit,
        critMult: CRIT_MULT,
        haste: sec.haste,
        mastery: sec.mastery,
        vers: sec.vers,
    };
}

/** 从存档推导（M0 用平均装等近似；M2 改成逐件求和） */
export function profileFromSave(save: MithrilSave): CombatProfile {
    let sum = 0;
    let count = 0;
    for (const slot of Object.keys(save.equips) as GearSlot[]) {
        const item: EquipItem | null | undefined = save.equips[slot];
        if (!item) continue;
        sum += item.ilvl;
        count++;
    }
    const ilvl = count > 0 ? sum / count : 1;
    return makeProfile(save.classId, save.level, ilvl);
}

export interface DamageResult {
    damage: number;
    crit: boolean;
}

/**
 * 单次伤害：攻击强度 × 全能 × 精通 × 技能倍率，暴击再乘 1.6。
 * 任何非有限输入都退化为 0，保证长跑不会污染出 NaN。
 */
export function computeDamage(
    profile: CombatProfile,
    rng: () => number,
    skillMultiplier = 1,
    guaranteedCrit = false,
): DamageResult {
    const ap = Number.isFinite(profile.attackPower) ? Math.max(0, profile.attackPower) : 0;
    const vers = Number.isFinite(profile.vers) ? Math.max(0, profile.vers) : 0;
    const mastery = Number.isFinite(profile.mastery) ? Math.max(0, profile.mastery) : 0;
    const mul = Number.isFinite(skillMultiplier) && skillMultiplier > 0 ? skillMultiplier : 0;
    const critChance = Number.isFinite(profile.critChance) ? Math.max(0, Math.min(1, profile.critChance)) : 0;
    const crit = guaranteedCrit || rng() < critChance;
    const critMult = Number.isFinite(profile.critMult) ? Math.max(1, profile.critMult) : 1;
    const damage = ap * (1 + vers) * (1 + mastery) * mul * (crit ? critMult : 1);
    return { damage: Number.isFinite(damage) ? damage : 0, crit };
}

// ==================== 状态 ====================

export interface PlayerCooldowns {
    basic: number;
    charge: number;
    whirlwind: number;
    armorBreak: number;
    dodge: number;
    burst: number;
}

export interface PlayerState {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    radius: number;
    invuln: number;
    facing: number;
    /** 怒气 0–100 */
    rage: number;
    cd: PlayerCooldowns;
    /** 旋风斩剩余持续时间 */
    whirlwind: number;
    /** 旋风斩下一跳倒计时 */
    whirlTick: number;
    /** 血怒剩余持续时间 */
    burst: number;
}

export interface EnemyStatus {
    stun: number;
    slow: number;
    armorBreak: number;
    burnDps: number;
    burnRemaining: number;
}

export interface EnemyState {
    id: number;
    kind: string;
    name: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    radius: number;
    speed: number;
    contactDamage: number;
    isElite: boolean;
    isBoss: boolean;
    status: EnemyStatus;
    /** 攻击计时器（远程 / 精英 / BOSS 共用） */
    shotCd: number;
    slamCd: number;
    /** 接触伤害冷却（秒）：贴脸时也只在归零后结算一次 */
    contactCd: number;
    /** BOSS 读条期间停止移动 */
    casting: boolean;
}

export type BulletOwner = 'player' | 'enemy';

export interface BulletState {
    id: number;
    owner: BulletOwner;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    damage: number;
    life: number;
    kind: string;
}

export interface TelegraphState {
    id: number;
    x: number;
    y: number;
    radius: number;
    /** 已预警时长 */
    t: number;
    /** 预警总时长 */
    warn: number;
    damage: number;
    kind: string;
    /** 是否已经结算 */
    done: boolean;
}

/** 血球：击杀掉落，靠近自动拾取回血 */
export interface OrbState {
    id: number;
    x: number;
    y: number;
    amount: number;
    life: number;
}

export interface BossCastState {
    name: string;
    total: number;
    remaining: number;
    /** 打断所需累计伤害 */
    need: number;
    taken: number;
}

export interface BannerState {
    title: string;
    subtitle: string;
    t: number;
}

export type DungeonStage = 'idle' | 'encounter' | 'boss' | 'cleared';

export interface MithrilInput {
    moveX: number;
    moveY: number;
    aimX: number;
    aimY: number;
    /** 按住即持续普攻 */
    basic?: boolean;
    skill1?: boolean;
    skill2?: boolean;
    skill3?: boolean;
    burst?: boolean;
    dodge?: boolean;
}

export type WorldPhase = 'playing' | 'dead' | 'won';

export type CoreEvent =
    | { type: 'damage'; target: 'enemy' | 'player'; x: number; y: number; amount: number; crit: boolean }
    | { type: 'heal'; x: number; y: number; amount: number }
    | { type: 'kill'; x: number; y: number; kind: string; exp: number; gold: number }
    | { type: 'swing'; x: number; y: number; facing: number; radius: number }
    | { type: 'whirl'; x: number; y: number; radius: number }
    | { type: 'dodge'; x: number; y: number; facing: number }
    | { type: 'charge'; x: number; y: number }
    | { type: 'boom'; x: number; y: number; radius: number }
    | { type: 'castStart'; name: string; total: number; need: number }
    | { type: 'castEnd'; interrupted: boolean }
    | { type: 'phase'; phase: number; name: string }
    | { type: 'stage'; stage: DungeonStage; index: number }
    | { type: 'regen'; x: number; y: number; amount: number }
    | { type: 'enrage'; duration: number };

export interface MithrilSnapshot {
    time: number;
    phase: WorldPhase;
    player: PlayerState;
    enemies: EnemyState[];
    bullets: BulletState[];
    telegraphs: TelegraphState[];
    orbs: OrbState[];
    kills: number;
    stage: DungeonStage;
    encounterIndex: number;
    encounterName: string;
    banner: BannerState | null;
    boss: {
        id: number;
        name: string;
        hp: number;
        maxHp: number;
        phase: number;
        casting: boolean;
        enraged: number;
    } | null;
    bossCast: BossCastState | null;
    bossEnraged: number;
    dungeonName: string;
    dungeonProgress: string;
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

/** 归一化到 (-π, π] */
function wrapAngle(a: number): number {
    let v = a;
    while (v > Math.PI) v -= Math.PI * 2;
    while (v <= -Math.PI) v += Math.PI * 2;
    return v;
}

function makeCooldowns(): PlayerCooldowns {
    return { basic: 0, charge: 0, whirlwind: 0, armorBreak: 0, dodge: 0, burst: 0 };
}

function makeStatus(): EnemyStatus {
    return { stun: 0, slow: 0, armorBreak: 0, burnDps: 0, burnRemaining: 0 };
}

function copyPlayer(p: PlayerState): PlayerState {
    return { ...p, cd: { ...p.cd } };
}

function copyEnemy(e: EnemyState): EnemyState {
    return { ...e, status: { ...e.status } };
}

/** 固定步长世界 */
export class MithrilWorld {
    readonly profile: CombatProfile;
    readonly rng: () => number;

    time = 0;
    phase: WorldPhase = 'playing';
    kills = 0;
    expGained = 0;
    goldGained = 0;

    player: PlayerState;
    enemies: EnemyState[] = [];
    bullets: BulletState[] = [];
    telegraphs: TelegraphState[] = [];
    orbs: OrbState[] = [];

    /** 副本运行态 */
    dungeonId = '';
    dungeonName = '';
    stage: DungeonStage = 'idle';
    encounterIndex = -1;
    banner: BannerState | null = null;

    boss: EnemyState | null = null;
    bossPhase = 0;
    bossCast: BossCastState | null = null;
    bossEnraged = 0;

    private _script: BossScriptDef = MINE_BOSS_SCRIPT;
    private _nextId = 1;
    private _gap = 0;
    private _mechanicTimer = 0;
    private _regenTick = 0;
    private _events: CoreEvent[] = [];

    constructor(profile: CombatProfile, seed = 1) {
        this.profile = profile;
        this.rng = mulberry32(seed);
        this.player = {
            x: PLAYER_START_X,
            y: PLAYER_START_Y,
            hp: profile.maxHp,
            maxHp: profile.maxHp,
            radius: PLAYER_RADIUS,
            invuln: 0,
            facing: Math.PI / 2,
            rage: 0,
            cd: makeCooldowns(),
            whirlwind: 0,
            whirlTick: 0,
            burst: 0,
        };
    }

    // ==================== 生成 ====================

    /** 生成敌人；达到上限返回 null（上限 40）。kind 命中配置表时自动带体型与名字。 */
    spawnEnemy(
        kind: string,
        x: number,
        y: number,
        hp: number,
        speed = 60,
        contactDamage = 8,
    ): EnemyState | null {
        if (this.enemies.length >= MAX_ENEMIES) return null;
        const def: EnemyDef | undefined = ENEMY_BY_ID[kind];
        const maxHp = Number.isFinite(hp) ? Math.max(1, hp) : 1;
        const enemy: EnemyState = {
            id: this._nextId++,
            kind,
            name: def ? def.name : kind,
            x: clamp(x, 0, FIELD_W),
            y: clamp(y, 0, FIELD_H),
            hp: maxHp,
            maxHp,
            radius: def ? def.radius : 20,
            speed: clamp(speed, 0, 400),
            contactDamage: Math.max(0, Number.isFinite(contactDamage) ? contactDamage : 0),
            isElite: !!def && def.kind === 'elite',
            isBoss: !!def && def.kind === 'boss',
            status: makeStatus(),
            shotCd: def && def.shotCd ? def.shotCd : 0,
            slamCd: def && def.slamCd ? def.slamCd : 0,
            contactCd: 0,
            casting: false,
        };
        this.enemies.push(enemy);
        return enemy;
    }

    /** 按配置表生成（副本编排用），scale 用于后续装等缩放 */
    spawnDef(defId: string, x: number, y: number, scale = 1): EnemyState | null {
        const def = ENEMY_BY_ID[defId];
        if (!def) return null;
        const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
        return this.spawnEnemy(defId, x, y, def.hp * k, def.speed, def.contactDamage);
    }

    /** 发射子弹；达到上限返回 null（上限 300） */
    fireBullet(
        owner: BulletOwner,
        x: number,
        y: number,
        vx: number,
        vy: number,
        damage: number,
        life = 2,
        kind = '',
    ): BulletState | null {
        if (this.bullets.length >= MAX_BULLETS) return null;
        const bullet: BulletState = {
            id: this._nextId++,
            owner,
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
            vx: Number.isFinite(vx) ? vx : 0,
            vy: Number.isFinite(vy) ? vy : 0,
            radius: kind === 'boulder' ? 14 : 8,
            damage: Number.isFinite(damage) ? Math.max(0, damage) : 0,
            life: Math.max(0, Number.isFinite(life) ? life : 0),
            kind,
        };
        this.bullets.push(bullet);
        return bullet;
    }

    // ==================== 副本推进 ====================

    /** 开始「废弃矿坑」垂直切片：3 遭遇 + BOSS */
    startDungeon(dungeonId = 'mine'): void {
        this.dungeonId = dungeonId;
        this.dungeonName = dungeonId === 'mine' ? '废弃矿坑' : dungeonId;
        this.stage = 'encounter';
        this.encounterIndex = -1;
        this.boss = null;
        this.bossPhase = 0;
        this.bossCast = null;
        this.bossEnraged = 0;
        this._mechanicTimer = 0;
        this._regenTick = 0;
        this._gap = 0;
        this.orbs.length = 0;
        this.phase = 'playing';
        this.player.hp = this.player.maxHp;
        this.player.rage = 0;
        this._spawnNextEncounter();
    }

    /** 当前遭遇结束到下一波之间的空档（秒） */
    get gap(): number {
        return this._gap;
    }

    get bossScript(): BossScriptDef {
        return this._script;
    }

    drainEvents(): CoreEvent[] {
        if (this._events.length === 0) return [];
        const out = this._events;
        this._events = [];
        return out;
    }

    // ==================== 主循环 ====================

    /**
     * 推进一个固定步长。dt 只用于测试贴合固定步长；正常调用一律 FIXED_DT。
     * 返回是否仍在进行中。
     */
    step(dt: number, input: MithrilInput): boolean {
        if (this.phase !== 'playing') return false;
        const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : FIXED_DT;
        this.time += d;

        this._tickPlayer(d, input || { moveX: 0, moveY: 0, aimX: 0, aimY: 0 });
        if (this.phase !== 'playing') {
            this._tickTimersOnly(d);
            return false;
        }
        this._tickEnemies(d);
        this._tickTelegraphs(d);
        this._tickBullets(d);
        this._tickOrbs(d);
        this._tickBoss(d);
        this._tickRun(d);
        this._tickTimersOnly(d);
        return this.phase === 'playing';
    }

    /** 对玩家造成伤害；无敌帧内忽略。返回是否真的扣血 */
    hitPlayer(damage: number): boolean {
        if (this.phase !== 'playing' || this.player.invuln > 0) return false;
        let dmg = Number.isFinite(damage) ? Math.max(0, damage) : 0;
        if (this.player.burst > 0) dmg *= 1 + PLAYER_TUNING.burst.takenBonus;
        this.player.hp = Math.max(0, this.player.hp - dmg);
        this.player.invuln = HIT_INVULN;
        this.player.rage = Math.min(100, this.player.rage + PLAYER_TUNING.rageOnHurt);
        this._emit({ type: 'damage', target: 'player', x: this.player.x, y: this.player.y, amount: dmg, crit: false });
        if (this.player.hp <= 0) {
            this.player.hp = 0;
            this.phase = 'dead';
        }
        return true;
    }

    /** 对指定敌人造成伤害；击杀后移除并计数。保留 M0 签名。 */
    damageEnemy(index: number, damage: number): boolean {
        return this._damageEnemy(index, damage, false);
    }

    snapshot(): MithrilSnapshot {
        return {
            time: this.time,
            phase: this.phase,
            player: copyPlayer(this.player),
            enemies: this.enemies.map(copyEnemy),
            bullets: this.bullets.map((b) => ({ ...b })),
            telegraphs: this.telegraphs.map((t) => ({ ...t })),
            orbs: this.orbs.map((o) => ({ ...o })),
            kills: this.kills,
            stage: this.stage,
            encounterIndex: this.encounterIndex,
            encounterName: this.encounterIndex >= 0 && this.encounterIndex < MINE_ENCOUNTERS.length
                ? MINE_ENCOUNTERS[this.encounterIndex].name
                : '',
            banner: this.banner ? { ...this.banner } : null,
            boss: this.boss
                ? {
                    id: this.boss.id,
                    name: this.boss.name,
                    hp: this.boss.hp,
                    maxHp: this.boss.maxHp,
                    phase: this.bossPhase,
                    casting: this.boss.casting,
                    enraged: this.bossEnraged,
                }
                : null,
            bossCast: this.bossCast ? { ...this.bossCast } : null,
            bossEnraged: this.bossEnraged,
            dungeonName: this.dungeonName,
            dungeonProgress: this._progressText(),
        };
    }

    // ==================== 玩家 ====================

    private _tickTimersOnly(d: number): void {
        this.player.invuln = Math.max(0, this.player.invuln - d);
        if (this.banner) {
            this.banner.t = Math.max(0, this.banner.t - d);
            if (this.banner.t <= 0) this.banner = null;
        }
    }

    private _tickPlayer(d: number, input: MithrilInput): void {
        const p = this.player;
        const cd = p.cd;
        cd.basic = Math.max(0, cd.basic - d);
        cd.charge = Math.max(0, cd.charge - d);
        cd.whirlwind = Math.max(0, cd.whirlwind - d);
        cd.armorBreak = Math.max(0, cd.armorBreak - d);
        cd.dodge = Math.max(0, cd.dodge - d);
        cd.burst = Math.max(0, cd.burst - d);
        p.burst = Math.max(0, p.burst - d);

        // 旋风斩持续时间与跳伤
        if (p.whirlwind > 0) {
            p.whirlwind = Math.max(0, p.whirlwind - d);
            p.whirlTick -= d;
            if (p.whirlTick <= 0) {
                p.whirlTick += PLAYER_TUNING.whirlwind.tick;
                this._whirlTick();
                if (this.phase !== 'playing') return;
            }
        }

        // 移动
        let mx = Number.isFinite(input.moveX) ? input.moveX : 0;
        let my = Number.isFinite(input.moveY) ? input.moveY : 0;
        const len = Math.hypot(mx, my);
        if (len > 1) {
            mx /= len;
            my /= len;
        }
        let speed = PLAYER_SPEED;
        if (p.whirlwind > 0) speed *= PLAYER_TUNING.whirlwind.moveScale;
        p.x = clamp(p.x + mx * speed * d, p.radius, FIELD_W - p.radius);
        p.y = clamp(p.y + my * speed * d, p.radius, FIELD_H - p.radius);

        const aimX = Number.isFinite(input.aimX) ? input.aimX : 0;
        const aimY = Number.isFinite(input.aimY) ? input.aimY : 0;
        if (Math.hypot(aimX, aimY) > 0.2) {
            p.facing = Math.atan2(aimY, aimX);
        } else {
            // 自动索敌朝向：手机端只有摇杆、没有瞄准输入。若朝向只跟移动方向走，
            // 玩家绕圈走位时剑永远指向切向，普攻 45° 扇形扫不到身前的目标
            // （BOSS 半径 44、站位 120+，实测整场只有约 5 DPS，BOSS 打不死）。
            const focus = this._nearestEnemy(PLAYER_TUNING.basic.radius + 90, true);
            if (focus) p.facing = Math.atan2(focus.y - p.y, focus.x - p.x);
            else if (len > 0.01) p.facing = Math.atan2(my, mx);
        }

        // 闪避
        if (input.dodge && cd.dodge <= 0) {
            // 站着不动时朝向已被自动索敌吸住，直接沿用 facing 会冲进敌人身体里，
            // 所以无移动输入时朝目标反方向后撤。
            const dir = Math.hypot(mx, my) > 0.2
                ? Math.atan2(my, mx)
                : (this._nearestEnemy(PLAYER_TUNING.basic.radius + 90, true) ? p.facing + Math.PI : p.facing);
            this._dash(dir, PLAYER_TUNING.dodge.distance);
            p.invuln = Math.max(p.invuln, PLAYER_TUNING.dodge.invuln);
            cd.dodge = PLAYER_TUNING.dodge.cd / (1 + this.profile.haste);
            this._emit({ type: 'dodge', x: p.x, y: p.y, facing: dir });
        }

        // 普攻
        if (input.basic && cd.basic <= 0) {
            this._swing();
            cd.basic = PLAYER_TUNING.basic.cd / (1 + this.profile.haste);
        }

        // 冲锋
        if (input.skill1 && cd.charge <= 0) {
            this._charge();
            cd.charge = PLAYER_TUNING.charge.cd / (1 + this.profile.haste);
        }

        // 旋风斩
        if (input.skill2 && cd.whirlwind <= 0 && p.whirlwind <= 0) {
            p.whirlwind = PLAYER_TUNING.whirlwind.duration;
            p.whirlTick = 0;
            cd.whirlwind = PLAYER_TUNING.whirlwind.cd / (1 + this.profile.haste);
        }

        // 破甲
        if (input.skill3 && cd.armorBreak <= 0) {
            if (this._armorBreak()) {
                cd.armorBreak = PLAYER_TUNING.armorBreak.cd / (1 + this.profile.haste);
            }
        }

        // 血怒
        if (input.burst && cd.burst <= 0 && p.rage >= PLAYER_TUNING.burst.rageCost) {
            p.rage = 0;
            p.burst = PLAYER_TUNING.burst.duration;
            cd.burst = PLAYER_TUNING.burst.cd;
        }
    }

    private _dash(dir: number, distance: number): void {
        const p = this.player;
        p.x = clamp(p.x + Math.cos(dir) * distance, p.radius, FIELD_W - p.radius);
        p.y = clamp(p.y + Math.sin(dir) * distance, p.radius, FIELD_H - p.radius);
        p.facing = dir;
    }

    private _swing(): void {
        const p = this.player;
        const t = PLAYER_TUNING.basic;
        // 自动索敌：命中判定用「距离 − 敌人半径」，转身也必须同口径，
        // 否则大体积的 BOSS 站在 120 距离上会被判成「不在扇形内」而永远空挥。
        let target: EnemyState | null = null;
        let bestReach = Infinity;
        for (const e of this.enemies) {
            const reach = Math.hypot(e.x - p.x, e.y - p.y) - e.radius;
            if (reach <= t.radius && reach < bestReach) {
                bestReach = reach;
                target = e;
            }
        }
        if (target) p.facing = Math.atan2(target.y - p.y, target.x - p.x);
        const hitsList: Array<[number, DamageResult]> = [];
        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            const dx = e.x - p.x;
            const dy = e.y - p.y;
            const dist = Math.hypot(dx, dy);
            if (dist > t.radius + e.radius) continue;
            const angle = Math.abs(wrapAngle(Math.atan2(dy, dx) - p.facing));
            if (angle > t.halfAngle && e !== target) continue;
            hitsList.push([i, computeDamage(this.profile, this.rng, t.mult)]);
        }
        this._emit({ type: 'swing', x: p.x, y: p.y, facing: p.facing, radius: t.radius });
        // 结算必须**倒序**：_damageEnemy 打死人会 splice 掉该敌人，升序结算会让后面所有下标
        // 前移一位 —— 轻则丢伤害，重则把伤害打到扇形外的旁观敌人身上（怒气也会按虚高次数多发）。
        // 掷骰顺序仍是升序，同种子结果不变。
        const hitCount = hitsList.length;
        for (let i = hitsList.length - 1; i >= 0; i--) {
            const [index, res] = hitsList[i];
            const dmg = res.damage * this._playerDamageMult();
            this._damageEnemy(index, dmg, res.crit);
        }
        if (hitCount > 0) {
            p.rage = Math.min(100, p.rage + t.rage + Math.min(4, (hitCount - 1) * 2));
        }
    }

    private _whirlTick(): void {
        const p = this.player;
        const t = PLAYER_TUNING.whirlwind;
        this._emit({ type: 'whirl', x: p.x, y: p.y, radius: t.radius });
        let hit = false;
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            if (!e) continue;
            if (dist2(e.x, e.y, p.x, p.y) > (t.radius + e.radius) * (t.radius + e.radius)) continue;
            const res = computeDamage(this.profile, this.rng, t.mult);
            hit = true;
            this._damageEnemy(i, res.damage * this._playerDamageMult(), res.crit);
        }
        if (hit) p.rage = Math.min(100, p.rage + 3);
    }

    private _charge(): void {
        const p = this.player;
        const t = PLAYER_TUNING.charge;
        let dir = p.facing;
        if (this.enemies.length > 0) {
            const near = this._nearestEnemy(360, true);
            if (near) dir = Math.atan2(near.y - p.y, near.x - p.x);
        }
        const sx = p.x;
        const sy = p.y;
        this._dash(dir, t.distance);
        this._emit({ type: 'charge', x: p.x, y: p.y });
        const seen: Record<number, true> = {};
        let hitAny = false;
        for (let s = 0; s <= 8; s++) {
            const k = s / 8;
            const px = sx + (p.x - sx) * k;
            const py = sy + (p.y - sy) * k;
            for (let i = this.enemies.length - 1; i >= 0; i--) {
                const e = this.enemies[i];
                if (!e || seen[e.id]) continue;
                const reach = t.radius + e.radius;
                if (dist2(e.x, e.y, px, py) > reach * reach) continue;
                seen[e.id] = true;
                hitAny = true;
                const res = computeDamage(this.profile, this.rng, t.mult);
                e.status.stun = Math.max(e.status.stun, t.stun);
                this._damageEnemy(i, res.damage * this._playerDamageMult(), res.crit);
            }
        }
        if (hitAny) p.rage = Math.min(100, p.rage + t.rage);
    }

    private _armorBreak(): boolean {
        const t = PLAYER_TUNING.armorBreak;
        // 破甲要能作用于 BOSS —— 渲染层会给 BOSS 画破甲标记，
        // 之前传 includeBoss=false 导致这招对 BOSS 静默无效。
        const target = this._nearestEnemy(t.range, true);
        if (!target) return false;
        const p = this.player;
        p.facing = Math.atan2(target.y - p.y, target.x - p.x);
        const index = this.enemies.indexOf(target);
        if (index < 0) return false;
        const res = computeDamage(this.profile, this.rng, t.mult);
        target.status.armorBreak = Math.max(target.status.armorBreak, t.duration);
        this._damageEnemy(index, res.damage * this._playerDamageMult(), res.crit);
        p.rage = Math.min(100, p.rage + t.rage);
        return true;
    }

    private _playerDamageMult(): number {
        return this.player.burst > 0 ? 1 + PLAYER_TUNING.burst.dmgBonus : 1;
    }

    private _nearestEnemy(range: number, includeBoss = true): EnemyState | null {
        let best: EnemyState | null = null;
        let bestD = range * range;
        for (const e of this.enemies) {
            if (!includeBoss && e.isBoss) continue;
            const d = dist2(e.x, e.y, this.player.x, this.player.y);
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    // ==================== 敌人 ====================

    private _tickEnemies(d: number): void {
        const p = this.player;
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            if (!e) continue;

            // 持续伤害（后续职业会用；M1 战士不触发）
            if (e.status.burnRemaining > 0) {
                e.status.burnRemaining = Math.max(0, e.status.burnRemaining - d);
                e.hp -= e.status.burnDps * d;
                if (e.hp <= 0) {
                    this._killEnemyAt(i);
                    continue;
                }
            }
            e.status.stun = Math.max(0, e.status.stun - d);
            e.status.slow = Math.max(0, e.status.slow - d);
            e.status.armorBreak = Math.max(0, e.status.armorBreak - d);
            e.contactCd = Math.max(0, e.contactCd - d);

            if (e.casting) continue;

            const dx = p.x - e.x;
            const dy = p.y - e.y;
            const dist = Math.hypot(dx, dy) || 1;
            const dirX = dx / dist;
            const dirY = dy / dist;

            // 远程：保持距离并射弹
            const def = ENEMY_BY_ID[e.kind];
            if (def && def.kind === 'ranged') {
                const keep = 260;
                if (dist < keep - 40) {
                    e.x = clamp(e.x - dirX * e.speed * d, e.radius, FIELD_W - e.radius);
                    e.y = clamp(e.y - dirY * e.speed * d, e.radius, FIELD_H - e.radius);
                } else if (dist > keep + 40) {
                    e.x = clamp(e.x + dirX * e.speed * d, e.radius, FIELD_W - e.radius);
                    e.y = clamp(e.y + dirY * e.speed * d, e.radius, FIELD_H - e.radius);
                }
                if (e.shotCd > 0) e.shotCd -= d;
                if (e.shotCd <= 0) {
                    e.shotCd = def.shotCd || 3;
                    const sp = def.shotSpeed || 240;
                    this.fireBullet('enemy', e.x, e.y, dirX * sp, dirY * sp, def.shotDamage || 5, 3, 'bolt');
                }
                this._contact(e);
                continue;
            }

            // 近战 / 精英 / BOSS：追击
            if (e.status.stun <= 0) {
                const speed = e.speed * (e.status.slow > 0 ? 0.5 : 1);
                e.x = clamp(e.x + dirX * speed * d, e.radius, FIELD_W - e.radius);
                e.y = clamp(e.y + dirY * speed * d, e.radius, FIELD_H - e.radius);
            }

            // 精英砸地
            if (def && def.kind === 'elite') {
                if (e.slamCd > 0) e.slamCd -= d;
                if (e.slamCd <= 0 && dist < 440) {
                    e.slamCd = def.slamCd || 5;
                    this._spawnTelegraph(p.x, p.y, def.slamRadius || 110, def.slamWarn || 1, (def.slamDamage || 8) * this._bossDamageMult(), 'slam');
                }
            }

            this._contact(e);
            if (this.phase !== 'playing') return;
        }

        this._separateEnemies();
    }

    private _contact(e: EnemyState): void {
        const p = this.player;
        if (e.contactCd > 0) return;
        const reach = e.radius + p.radius;
        if (dist2(e.x, e.y, p.x, p.y) <= reach * reach) {
            const mult = e.isBoss ? this._bossDamageMult() : 1;
            if (this.hitPlayer(e.contactDamage * mult)) {
                e.contactCd = PLAYER_TUNING.contactCooldown;
            }
        }
    }

    /** BOSS 狂暴伤害倍率；读配置而不是写死 1.5，改数值不用同时改三处 */
    private _bossDamageMult(): number {
        return this.bossEnraged > 0 ? 1 + this._script.enrageBonus : 1;
    }

    /** 轻量分离：避免小怪完全重叠成一坨 */
    private _separateEnemies(): void {
        for (let i = 0; i < this.enemies.length; i++) {
            const a = this.enemies[i];
            if (!a) continue;
            for (let j = i + 1; j < this.enemies.length; j++) {
                const b = this.enemies[j];
                if (!b) continue;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const min = a.radius + b.radius;
                const d2 = dx * dx + dy * dy;
                if (d2 >= min * min) continue;
                const dist = Math.sqrt(d2) || 0.001;
                const push = (min - dist) * 0.5;
                const ux = dx / dist;
                const uy = dy / dist;
                a.x = clamp(a.x - ux * push, a.radius, FIELD_W - a.radius);
                a.y = clamp(a.y - uy * push, a.radius, FIELD_H - a.radius);
                b.x = clamp(b.x + ux * push, b.radius, FIELD_W - b.radius);
                b.y = clamp(b.y + uy * push, b.radius, FIELD_H - b.radius);
            }
        }
    }

    // ==================== 预警圈 / 子弹 / BOSS ====================

    private _spawnTelegraph(x: number, y: number, radius: number, warn: number, damage: number, kind: string): void {
        this.telegraphs.push({
            id: this._nextId++,
            x: clamp(x, 0, FIELD_W),
            y: clamp(y, 0, FIELD_H),
            radius: Math.max(1, radius),
            t: 0,
            warn: Math.max(0.1, warn),
            damage: Math.max(0, damage),
            kind,
            done: false,
        });
    }

    private _tickTelegraphs(d: number): void {
        for (let i = this.telegraphs.length - 1; i >= 0; i--) {
            const t = this.telegraphs[i];
            t.t += d;
            if (!t.done && t.t >= t.warn) {
                t.done = true;
                const reach = t.radius + this.player.radius;
                if (dist2(t.x, t.y, this.player.x, this.player.y) <= reach * reach) {
                    this.hitPlayer(t.damage);
                }
                this._emit({ type: 'boom', x: t.x, y: t.y, radius: t.radius });
            }
            if (t.t >= t.warn + 0.25) this.telegraphs.splice(i, 1);
        }
    }

    private _tickBullets(d: number): void {
        const p = this.player;
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.x += b.vx * d;
            b.y += b.vy * d;
            b.life -= d;
            let remove = b.life <= 0 || b.x < -40 || b.x > FIELD_W + 40 || b.y < -40 || b.y > FIELD_H + 40;

            if (!remove && b.owner === 'enemy') {
                const reach = b.radius + p.radius;
                if (dist2(b.x, b.y, p.x, p.y) <= reach * reach) {
                    // 狂暴倍率在发射时就烘进伤害，避免「BOSS 狂暴了，小怪的子弹也跟着变疼」
                    this.hitPlayer(b.damage);
                    remove = true;
                }
            } else if (!remove && b.owner === 'player') {
                for (let j = this.enemies.length - 1; j >= 0; j--) {
                    const e = this.enemies[j];
                    if (!e) continue;
                    const reach = b.radius + e.radius;
                    if (dist2(b.x, b.y, e.x, e.y) > reach * reach) continue;
                    this._damageEnemy(j, b.damage, false);
                    remove = true;
                    break;
                }
            }
            if (remove) this.bullets.splice(i, 1);
            if (this.phase !== 'playing') return;
        }
    }

    private _tickOrbs(d: number): void {
        const p = this.player;
        const reach = p.radius + ORB_PICKUP_RADIUS;
        for (let i = this.orbs.length - 1; i >= 0; i--) {
            const o = this.orbs[i];
            o.life -= d;
            if (o.life <= 0) {
                this.orbs.splice(i, 1);
                continue;
            }
            if (p.hp >= p.maxHp) continue;
            if (dist2(o.x, o.y, p.x, p.y) > reach * reach) continue;
            const heal = Math.min(o.amount, p.maxHp - p.hp);
            p.hp = Math.min(p.maxHp, p.hp + heal);
            this._emit({ type: 'heal', x: o.x, y: o.y, amount: heal });
            this.orbs.splice(i, 1);
        }
    }

    private _tickBoss(d: number): void {
        if (this.stage !== 'boss') return;
        const boss = this.boss;
        if (!boss) return;

        this.bossEnraged = Math.max(0, this.bossEnraged - d);

        // 死亡结算
        if (boss.hp <= 0 || this.enemies.indexOf(boss) < 0) {
            this.boss = null;
            this.bossCast = null;
            this.stage = 'cleared';
            this.phase = 'won';
            return;
        }

        // 阶段推进（按血线，不卡阶段）
        const script = this._script;
        while (this.bossPhase < 2 && boss.hp / boss.maxHp <= script.thresholds[this.bossPhase]) {
            this.bossPhase++;
            this._mechanicTimer = 0;
            const phase = script.phases[this.bossPhase];
            // 阶段转换回血：让玩家有机会整理节奏，而不是被血线直接压死
            const heal = Math.round(this.player.maxHp * BOSS_PHASE_HEAL_PCT);
            const before = this.player.hp;
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
            if (this.player.hp > before) {
                this._emit({ type: 'heal', x: this.player.x, y: this.player.y, amount: this.player.hp - before });
            }
            this._emit({ type: 'phase', phase: this.bossPhase + 1, name: phase.name });
            this._showBanner(`阶段 ${this.bossPhase + 1} · ${phase.name}`, phase.desc, 2.6);
        }

        // 读条
        if (this.bossCast) {
            boss.casting = true;
            this.bossCast.remaining -= d;
            if (this.bossCast.remaining <= 0) {
                const name = this.bossCast.name;
                this.bossCast = null;
                boss.casting = false;
                this.bossEnraged = script.enrageDuration;
                this._emit({ type: 'castEnd', interrupted: false });
                this._emit({ type: 'enrage', duration: script.enrageDuration });
                this._showBanner('打断失败', `${name}完成：BOSS 伤害 +${Math.round(script.enrageBonus * 100)}%，持续 ${script.enrageDuration} 秒`, 2.2);
            }
            return;
        }

        // BOSS 投射物
        if (boss.shotCd > 0) boss.shotCd -= d;
        if (boss.shotCd <= 0) {
            const def = ENEMY_BY_ID[boss.kind];
            boss.shotCd = def && def.shotCd ? def.shotCd : 3.5;
            const dx = this.player.x - boss.x;
            const dy = this.player.y - boss.y;
            const len = Math.hypot(dx, dy) || 1;
            const sp = def && def.shotSpeed ? def.shotSpeed : 260;
            this.fireBullet(
                'enemy', boss.x, boss.y,
                (dx / len) * sp, (dy / len) * sp,
                (def && def.shotDamage ? def.shotDamage : 8) * this._bossDamageMult(),
                4, 'boulder',
            );
        }

        // 机制
        const phase = script.phases[this.bossPhase];
        this._mechanicTimer += d;
        if (phase.mechanic === 'move') {
            if (this._mechanicTimer >= script.moveInterval) {
                this._mechanicTimer = 0;
                this._spawnTelegraph(
                    this.player.x, this.player.y,
                    script.moveRadius, script.moveWarn, script.moveDamage, 'boss_slam',
                );
            }
        } else if (phase.mechanic === 'adds') {
            const addsAlive = this._countAdds() > 0;
            if (addsAlive) {
                const before = boss.hp;
                boss.hp = Math.min(boss.maxHp, boss.hp + script.addsRegen * d);
                this._regenTick += d;
                if (this._regenTick >= 1) {
                    this._regenTick = 0;
                    this._emit({
                        type: 'regen', x: boss.x, y: boss.y,
                        amount: Math.max(0, boss.hp - before),
                    });
                }
            } else if (this._mechanicTimer >= script.addsInterval) {
                this._mechanicTimer = 0;
                this._spawnAdds();
            }
        } else if (phase.mechanic === 'interrupt') {
            if (this._mechanicTimer >= script.interruptInterval) {
                this._mechanicTimer = 0;
                this.bossCast = {
                    name: phase.name,
                    total: script.interruptCast,
                    remaining: script.interruptCast,
                    need: script.interruptNeed,
                    taken: 0,
                };
                boss.casting = true;
                this._emit({
                    type: 'castStart',
                    name: phase.name,
                    total: script.interruptCast,
                    need: script.interruptNeed,
                });
            }
        }
    }

    private _countAdds(): number {
        let n = 0;
        for (const e of this.enemies) if (e.kind === this._script.addsEnemyId) n++;
        return n;
    }

    private _spawnAdds(): void {
        const boss = this.boss;
        if (!boss) return;
        const count = this._script.addsCount;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const x = boss.x + Math.cos(angle) * 120;
            const y = boss.y + Math.sin(angle) * 120;
            this.spawnDef(this._script.addsEnemyId, x, y);
        }
        this._showBanner('BOSS 召唤矿工', '小怪存活时 BOSS 持续回血，先转火', 2.2);
    }

    // ==================== 伤害与击杀 ====================

    private _damageEnemy(index: number, damage: number, crit: boolean): boolean {
        const e = this.enemies[index];
        if (!e) return false;
        let dmg = Number.isFinite(damage) ? Math.max(0, damage) : 0;
        if (e.status.armorBreak > 0) dmg *= 1 + PLAYER_TUNING.armorBreak.bonus;
        e.hp -= dmg;
        this._emit({ type: 'damage', target: 'enemy', x: e.x, y: e.y, amount: dmg, crit });

        // BOSS 读条：累计伤害用于打断
        if (this.bossCast && this.boss === e) {
            this.bossCast.taken += dmg;
            if (this.bossCast.taken >= this.bossCast.need) {
                const name = this.bossCast.name;
                this.bossCast = null;
                if (this.boss) this.boss.casting = false;
                this._emit({ type: 'castEnd', interrupted: true });
                this._showBanner('打断成功', `${name}被终止`, 1.6);
            }
        }

        if (e.hp > 0) return false;
        this._killEnemyAt(index);
        return true;
    }

    private _killEnemyAt(index: number): void {
        const e = this.enemies[index];
        if (!e) return;
        const def = ENEMY_BY_ID[e.kind];
        const exp = def ? def.exp : 0;
        const gold = def ? def.gold : 0;
        this.enemies.splice(index, 1);
        this.kills++;
        this.expGained += exp;
        this.goldGained += gold;

        // 血球：普通怪 28%，精英 / BOSS 召唤物 60%
        if (!e.isBoss && this.orbs.length < MAX_ORBS) {
            const chance = e.isElite || e.kind === this._script.addsEnemyId
                ? ORB_ADD_DROP_CHANCE
                : ORB_DROP_CHANCE;
            if (this.rng() < chance) {
                this.orbs.push({
                    id: this._nextId++,
                    x: e.x,
                    y: e.y,
                    amount: Math.max(1, Math.round(this.player.maxHp * ORB_HEAL_PCT)),
                    life: ORB_LIFE,
                });
            }
        }

        if (this.boss === e) {
            this.boss = null;
            this.bossCast = null;
        }
        this._emit({ type: 'kill', x: e.x, y: e.y, kind: e.kind, exp, gold });
    }

    // ==================== 副本流程 ====================

    private _tickRun(d: number): void {
        if (this.stage === 'cleared') return;

        if (this.stage === 'encounter') {
            if (this._gap > 0) {
                this._gap -= d;
                if (this._gap <= 0) {
                    this._gap = 0;
                    if (this.encounterIndex + 1 < MINE_ENCOUNTERS.length) this._spawnNextEncounter();
                    else this._enterBoss();
                }
                return;
            }
            if (this.enemies.length === 0) {
                if (this.encounterIndex >= 0) {
                    const heal = Math.round(this.player.maxHp * ENCOUNTER_HEAL_PCT);
                    const before = this.player.hp;
                    this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
                    // 满血清场时别弹一个实际没加上的绿色数字
                    if (this.player.hp > before) {
                        this._emit({ type: 'heal', x: this.player.x, y: this.player.y, amount: this.player.hp - before });
                    }
                }
                this._gap = this.encounterIndex + 1 < MINE_ENCOUNTERS.length
                    ? ENCOUNTER_GAP
                    : BOSS_INTRO_GAP;
            }
            return;
        }

        if (this.stage === 'boss' && !this.boss) {
            // _tickBoss 已处理；这里兜底，避免 BOSS 意外丢失卡住
            this.stage = 'cleared';
            this.phase = 'won';
        }
    }

    private _spawnNextEncounter(): void {
        this.encounterIndex++;
        const enc = MINE_ENCOUNTERS[this.encounterIndex];
        if (!enc) {
            this._enterBoss();
            return;
        }
        this.stage = 'encounter';
        this._showBanner(`遭遇 ${this.encounterIndex + 1}/3 · ${enc.name}`, enc.subtitle, 2.2);
        let i = 0;
        for (const group of enc.spawns) {
            for (let n = 0; n < group.count; n++) {
                const x = 130 + ((i * 97 + this.encounterIndex * 53) % 460);
                const y = 840 + ((i * 61 + this.encounterIndex * 47) % 260);
                this.spawnDef(group.enemyId, x, y);
                i++;
            }
        }
        this._emit({ type: 'stage', stage: 'encounter', index: this.encounterIndex });
    }

    private _enterBoss(): void {
        this.stage = 'boss';
        this.encounterIndex = MINE_ENCOUNTERS.length - 1;
        this.bossPhase = 0;
        this.bossCast = null;
        this.bossEnraged = 0;
        this._mechanicTimer = 0;
        this._regenTick = 0;
        this.telegraphs.length = 0;
        this.enemies.length = 0;
        const boss = this.spawnDef(this._script.enemyId, FIELD_W / 2, 1000);
        this.boss = boss;
        this._showBanner('矿坑巨魔', '走位躲砸地 · 转火矿工 · 打断狂暴读条', 3.2);
        this._emit({ type: 'stage', stage: 'boss', index: this.encounterIndex });
    }

    private _showBanner(title: string, subtitle: string, t: number): void {
        this.banner = { title, subtitle, t };
    }

    private _progressText(): string {
        if (this.stage === 'idle') return '';
        if (this.stage === 'encounter') return `遭遇 ${Math.max(1, this.encounterIndex + 1)}/3`;
        if (this.stage === 'boss') return `BOSS 阶段 ${this.bossPhase + 1}/3`;
        if (this.stage === 'cleared') return '副本通关';
        return '';
    }

    private _emit(ev: CoreEvent): void {
        if (this._events.length >= 240) this._events.shift();
        this._events.push(ev);
    }
}
