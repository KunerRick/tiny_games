/**
 * 《秘银远征》战斗核心骨架（纯逻辑，**不得 import cc**）。
 *
 * M0 只立三件事：
 *  1. 确定性随机（mulberry32）
 *  2. 伤害公式（暴击 / 全能 / 精通，输出永不 NaN）
 *  3. 固定步长世界骨架（玩家 + 敌人 + 子弹 + 无敌帧 + 实体上限）
 *
 * 后续 M1 在这个骨架上加技能、AI、副本编排，不改上面的对外形状。
 */

import {
    FIELD_H,
    FIELD_W,
    FIXED_DT,
    MAX_BULLETS,
    MAX_ENEMIES,
} from './MithrilConfig';
import type { ClassId, EquipItem, GearSlot } from './MithrilConfig';
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

// ==================== 世界骨架 ====================

export interface PlayerState {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    radius: number;
    invuln: number;
    facing: number;
}

export interface EnemyState {
    id: number;
    kind: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    radius: number;
    speed: number;
    contactDamage: number;
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
}

export interface MithrilInput {
    moveX: number;
    moveY: number;
    aimX: number;
    aimY: number;
}

export type WorldPhase = 'playing' | 'dead' | 'won';

export interface MithrilSnapshot {
    time: number;
    phase: WorldPhase;
    player: PlayerState;
    enemies: EnemyState[];
    bullets: BulletState[];
    kills: number;
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

/** 固定步长世界：M0 只有移动 / 追击 / 接触伤害 / 无敌帧 / 实体上限 */
export class MithrilWorld {
    readonly profile: CombatProfile;
    readonly rng: () => number;

    time = 0;
    phase: WorldPhase = 'playing';
    kills = 0;

    player: PlayerState;
    enemies: EnemyState[] = [];
    bullets: BulletState[] = [];

    private _nextId = 1;

    constructor(profile: CombatProfile, seed = 1) {
        this.profile = profile;
        this.rng = mulberry32(seed);
        this.player = {
            x: FIELD_W / 2,
            y: FIELD_H / 2,
            hp: profile.maxHp,
            maxHp: profile.maxHp,
            radius: PLAYER_RADIUS,
            invuln: 0,
            facing: 0,
        };
    }

    /** 生成敌人；达到上限返回 null（上限 40） */
    spawnEnemy(kind: string, x: number, y: number, hp: number, speed = 60, contactDamage = 8): EnemyState | null {
        if (this.enemies.length >= MAX_ENEMIES) return null;
        const maxHp = Number.isFinite(hp) ? Math.max(1, hp) : 1;
        const enemy: EnemyState = {
            id: this._nextId++,
            kind,
            x: clamp(x, 0, FIELD_W),
            y: clamp(y, 0, FIELD_H),
            hp: maxHp,
            maxHp,
            radius: 20,
            speed: clamp(speed, 0, 400),
            contactDamage: Math.max(0, Number.isFinite(contactDamage) ? contactDamage : 0),
        };
        this.enemies.push(enemy);
        return enemy;
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
    ): BulletState | null {
        if (this.bullets.length >= MAX_BULLETS) return null;
        const bullet: BulletState = {
            id: this._nextId++,
            owner,
            x,
            y,
            vx: Number.isFinite(vx) ? vx : 0,
            vy: Number.isFinite(vy) ? vy : 0,
            radius: 8,
            damage: Number.isFinite(damage) ? Math.max(0, damage) : 0,
            life: Math.max(0, Number.isFinite(life) ? life : 0),
        };
        this.bullets.push(bullet);
        return bullet;
    }

    /**
     * 推进一个固定步长。dt 只用于测试贴合固定步长；正常调用一律 FIXED_DT。
     * 返回是否仍在进行中。
     */
    step(dt: number, input: MithrilInput): boolean {
        if (this.phase !== 'playing') return false;
        const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : FIXED_DT;
        this.time += d;

        this._movePlayer(d, input);
        this._updateEnemies(d);
        this._updateBullets(d);

        this.player.invuln = Math.max(0, this.player.invuln - d);
        return this.phase === 'playing';
    }

    /** 对玩家造成伤害；无敌帧内忽略。返回是否真的扣血 */
    hitPlayer(damage: number): boolean {
        if (this.phase !== 'playing' || this.player.invuln > 0) return false;
        const dmg = Number.isFinite(damage) ? Math.max(0, damage) : 0;
        this.player.hp = Math.max(0, this.player.hp - dmg);
        this.player.invuln = HIT_INVULN;
        if (this.player.hp <= 0) {
            this.player.hp = 0;
            this.phase = 'dead';
        }
        return true;
    }

    /** 对指定敌人造成伤害；击杀后移除并计数 */
    damageEnemy(index: number, damage: number): boolean {
        const enemy = this.enemies[index];
        if (!enemy) return false;
        const dmg = Number.isFinite(damage) ? Math.max(0, damage) : 0;
        enemy.hp -= dmg;
        if (enemy.hp > 0) return false;
        this.enemies.splice(index, 1);
        this.kills++;
        return true;
    }

    snapshot(): MithrilSnapshot {
        return {
            time: this.time,
            phase: this.phase,
            player: { ...this.player },
            enemies: this.enemies.map((e) => ({ ...e })),
            bullets: this.bullets.map((b) => ({ ...b })),
            kills: this.kills,
        };
    }

    private _movePlayer(dt: number, input: MithrilInput): void {
        let mx = Number.isFinite(input && input.moveX) ? input.moveX : 0;
        let my = Number.isFinite(input && input.moveY) ? input.moveY : 0;
        const len = Math.hypot(mx, my);
        if (len > 1) {
            mx /= len;
            my /= len;
        }
        this.player.x = clamp(this.player.x + mx * PLAYER_SPEED * dt, this.player.radius, FIELD_W - this.player.radius);
        this.player.y = clamp(this.player.y + my * PLAYER_SPEED * dt, this.player.radius, FIELD_H - this.player.radius);
        if (len > 0.01) this.player.facing = Math.atan2(my, mx);
    }

    private _updateEnemies(dt: number): void {
        const p = this.player;
        for (const e of this.enemies) {
            const dx = p.x - e.x;
            const dy = p.y - e.y;
            const len = Math.hypot(dx, dy) || 1;
            e.x = clamp(e.x + (dx / len) * e.speed * dt, 0, FIELD_W);
            e.y = clamp(e.y + (dy / len) * e.speed * dt, 0, FIELD_H);
            const reach = (e.radius + p.radius) * (e.radius + p.radius);
            if (dist2(e.x, e.y, p.x, p.y) <= reach) {
                this.hitPlayer(e.contactDamage);
                if (this.phase !== 'playing') return;
            }
        }
    }

    private _updateBullets(dt: number): void {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.life -= dt;
            if (b.life <= 0 || b.x < -40 || b.x > FIELD_W + 40 || b.y < -40 || b.y > FIELD_H + 40) {
                this.bullets.splice(i, 1);
            }
        }
    }
}
