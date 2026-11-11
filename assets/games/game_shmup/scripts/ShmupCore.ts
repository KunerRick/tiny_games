/**
 * 星际弹幕 —— 纯逻辑核心（不依赖 cc，可被 Node 自检直接编译）。
 *
 * 坐标系：x ∈ [0, 720] 从左到右，y ∈ [0, 1280] **从上到下**（与设计坐标一致）。
 * 玩家在下方（y 大），子弹向上飞（vy < 0）。
 *
 * 负责：玩家移动与自动开火、敌人按波次生成 / 移动 / 开火、子弹（均按圆判定）、
 *       碰撞与计分、道具掉落、波次推进与胜负判定。
 * 全部确定性（不使用随机数），便于自检复现与回归。
 */

export const FIELD_W = 720;
export const FIELD_H = 1280;

/** 玩家碰撞半径（远小于视觉半径，弹幕游戏惯例：判定小、观感大） */
export const PLAYER_R = 9;
export const PLAYER_VISUAL_R = 17;
export const PLAYER_START_X = FIELD_W / 2;
export const PLAYER_START_Y = 1090;
export const PLAYER_MIN_Y = 240;
export const PLAYER_MAX_Y = FIELD_H - 60;
export const PLAYER_MAX_LIVES = 5;
export const PLAYER_MAX_POWER = 3;

/** 自动开火间隔（秒） */
export const PLAYER_FIRE_INTERVAL = 0.12;
/** 玩家子弹速度（向上为负） */
export const PLAYER_BULLET_SPEED = 900;
/** 中弹后的无敌时间 */
export const INVULN_TIME = 1.6;
/** 两波之间的间隔 */
export const WAVE_GAP = 0.9;
/** 单个数组的硬上限，防极端情况爆内存 */
export const MAX_BULLETS = 800;

export type ShmupPhase = 'playing' | 'won' | 'lost';
export type EnemyKind = 'grunt' | 'weaver' | 'tank' | 'boss';
export type BulletSide = 'p' | 'e';
export type PowerupKind = 'power' | 'life';

export interface Bullet {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    side: BulletSide;
    /** 对敌伤害（玩家子弹）或对玩家伤害（敌弹固定 1） */
    dmg: number;
}

export interface Enemy {
    id: number;
    kind: EnemyKind;
    x: number;
    y: number;
    /** 出生点 x：weaver / boss 的摆动基准 */
    baseX: number;
    hp: number;
    maxHp: number;
    radius: number;
    /** 存活的秒数，驱动摆动与开火节奏 */
    t: number;
    /** 开火计时 */
    fireT: number;
    /** 这次开火在图案里的序号（spread/ring/spiral 用） */
    shotIndex: number;
    /** boss 是否已经就位（登场动画结束） */
    arrived?: boolean;
}

export interface Powerup {
    x: number;
    y: number;
    vy: number;
    kind: PowerupKind;
    r: number;
}

export interface ShmupPlayer {
    x: number;
    y: number;
    lives: number;
    /** 火力等级 1..3，决定同时发射的弹数 */
    power: number;
    /** 剩余无敌秒数 */
    invuln: number;
    /** 距离下一发还有多少秒 */
    fireT: number;
}

export interface ShmupEnemyDef {
    kind: EnemyKind;
    hp: number;
    radius: number;
    score: number;
    /** 下落速度（px/s）；boss 为 0 */
    speed: number;
    /** 开火间隔（秒），0 表示不开火 */
    fireEvery: number;
    bulletSpeed: number;
    pattern: 'aim' | 'spread3' | 'ring8' | 'spiral';
}

export const ENEMY_DEFS: Record<EnemyKind, ShmupEnemyDef> = {
    grunt: {
        kind: 'grunt',
        hp: 2,
        radius: 20,
        score: 10,
        speed: 130,
        fireEvery: 1.8,
        bulletSpeed: 230,
        pattern: 'aim',
    },
    weaver: {
        kind: 'weaver',
        hp: 3,
        radius: 20,
        score: 20,
        speed: 110,
        fireEvery: 1.5,
        bulletSpeed: 210,
        pattern: 'spread3',
    },
    tank: {
        kind: 'tank',
        hp: 8,
        radius: 28,
        score: 50,
        speed: 70,
        fireEvery: 1.6,
        bulletSpeed: 190,
        pattern: 'ring8',
    },
    boss: {
        kind: 'boss',
        hp: 140,
        radius: 62,
        score: 500,
        speed: 0,
        fireEvery: 1.15,
        bulletSpeed: 200,
        pattern: 'spiral',
    },
};

/** 一个波次里的一次生成 */
export interface ShmupEntry {
    /** 波次开始后第几秒生成 */
    at: number;
    kind: EnemyKind;
    x: number;
    /** 同时生成的个数（横向排开） */
    count?: number;
    /** 相邻两个的横向间距 */
    gapX?: number;
    /** 生成高度，默认在屏幕上方外 */
    y?: number;
}

export interface ShmupWave {
    name: string;
    /** 生成窗口；超过这个时间不再等生成，只等清场 */
    span: number;
    entries: ShmupEntry[];
}

/** 8 个波次 + 1 个 Boss */
export const SHMUP_WAVES: readonly ShmupWave[] = [
    {
        name: '侦察编队',
        span: 3.2,
        entries: [
            { at: 0.0, kind: 'grunt', x: 200, count: 3, gapX: 160 },
            { at: 1.4, kind: 'grunt', x: 280, count: 2, gapX: 160 },
            { at: 2.6, kind: 'grunt', x: 360, count: 1 },
        ],
    },
    {
        name: '蛇形突入',
        span: 4.0,
        entries: [
            { at: 0.0, kind: 'weaver', x: 180, count: 2, gapX: 360 },
            { at: 1.2, kind: 'weaver', x: 360, count: 1 },
            { at: 2.2, kind: 'grunt', x: 160, count: 3, gapX: 200 },
            { at: 3.2, kind: 'weaver', x: 220, count: 2, gapX: 280 },
        ],
    },
    {
        name: '重装压境',
        span: 4.2,
        entries: [
            { at: 0.0, kind: 'tank', x: 360, count: 1 },
            { at: 1.0, kind: 'grunt', x: 140, count: 2, gapX: 440 },
            { at: 2.4, kind: 'tank', x: 220, count: 1 },
            { at: 3.0, kind: 'weaver', x: 500, count: 1 },
        ],
    },
    {
        name: '两翼包夹',
        span: 4.6,
        entries: [
            { at: 0.0, kind: 'grunt', x: 120, count: 2, gapX: 480 },
            { at: 1.0, kind: 'weaver', x: 200, count: 2, gapX: 320 },
            { at: 2.0, kind: 'grunt', x: 200, count: 3, gapX: 160 },
            { at: 3.2, kind: 'weaver', x: 260, count: 2, gapX: 200 },
        ],
    },
    {
        name: '铁壁推进',
        span: 5.0,
        entries: [
            { at: 0.0, kind: 'tank', x: 180, count: 1 },
            { at: 0.6, kind: 'tank', x: 540, count: 1 },
            { at: 1.8, kind: 'grunt', x: 360, count: 3, gapX: 130 },
            { at: 3.0, kind: 'weaver', x: 160, count: 2, gapX: 400 },
            { at: 4.0, kind: 'grunt', x: 260, count: 2, gapX: 200 },
        ],
    },
    {
        name: '交叉火网',
        span: 5.4,
        entries: [
            { at: 0.0, kind: 'weaver', x: 140, count: 3, gapX: 220 },
            { at: 1.2, kind: 'grunt', x: 360, count: 4, gapX: 110 },
            { at: 2.6, kind: 'tank', x: 360, count: 1 },
            { at: 3.6, kind: 'weaver', x: 200, count: 2, gapX: 320 },
        ],
    },
    {
        name: '双坦克',
        span: 5.6,
        entries: [
            { at: 0.0, kind: 'tank', x: 240, count: 1 },
            { at: 0.4, kind: 'tank', x: 480, count: 1 },
            { at: 1.6, kind: 'grunt', x: 160, count: 3, gapX: 200 },
            { at: 2.8, kind: 'weaver', x: 360, count: 3, gapX: 180 },
            { at: 4.2, kind: 'grunt', x: 300, count: 2, gapX: 120 },
        ],
    },
    {
        name: '最后一波',
        span: 6.0,
        entries: [
            { at: 0.0, kind: 'weaver', x: 180, count: 2, gapX: 360 },
            { at: 1.0, kind: 'tank', x: 300, count: 1 },
            { at: 2.0, kind: 'grunt', x: 160, count: 4, gapX: 130 },
            { at: 3.2, kind: 'weaver', x: 260, count: 2, gapX: 200 },
            { at: 4.4, kind: 'tank', x: 420, count: 1 },
        ],
    },
    {
        name: '母舰',
        span: 1.0,
        entries: [{ at: 0.4, kind: 'boss', x: FIELD_W / 2, y: -120 }],
    },
];

/** 波次里一共会生成多少敌人（自检与 HUD 用） */
export function countWaveEnemies(wave: ShmupWave): number {
    let n = 0;
    for (const e of wave.entries) n += Math.max(1, e.count || 1);
    return n;
}

// ==================== 世界 ====================

export class ShmupWorld {
    readonly player: ShmupPlayer = {
        x: PLAYER_START_X,
        y: PLAYER_START_Y,
        lives: 3,
        power: 1,
        invuln: 0,
        fireT: 0,
    };

    readonly playerBullets: Bullet[] = [];
    readonly enemyBullets: Bullet[] = [];
    readonly enemies: Enemy[] = [];
    readonly powerups: Powerup[] = [];

    phase: ShmupPhase = 'playing';
    score = 0;
    /** 存活时间（秒） */
    time = 0;
    /** 已击杀数量（决定道具掉落节奏） */
    kills = 0;
    /** 累计生成过的敌人数（自检用来核对波次配置） */
    spawnedTotal = 0;

    waveIndex = 0;
    /** 当前波次已经过的时间 */
    waveTime = 0;
    /** 生成清单里下一条待生成的 entry 下标 */
    private entryIndex = 0;
    /** 清场后等待下一波的计时 */
    private gapTimer = 0;

    private nextEnemyId = 1;
    /** Boss 出场后归一化的血条比例（HUD 用，-1 表示没有 Boss） */
    bossHpRatio = -1;

    constructor() {
        this.reset();
    }

    reset(): void {
        this.player.x = PLAYER_START_X;
        this.player.y = PLAYER_START_Y;
        this.player.lives = 3;
        this.player.power = 1;
        this.player.invuln = 0;
        this.player.fireT = 0;
        this.playerBullets.length = 0;
        this.enemyBullets.length = 0;
        this.enemies.length = 0;
        this.powerups.length = 0;
        this.phase = 'playing';
        this.score = 0;
        this.time = 0;
        this.kills = 0;
        this.spawnedTotal = 0;
        this.waveIndex = 0;
        this.waveTime = 0;
        this.entryIndex = 0;
        this.gapTimer = 0;
        this.bossHpRatio = -1;
    }

    get wave(): ShmupWave {
        return SHMUP_WAVES[Math.min(this.waveIndex, SHMUP_WAVES.length - 1)];
    }

    get boss(): Enemy | null {
        for (const e of this.enemies) if (e.kind === 'boss') return e;
        return null;
    }

    /** 把玩家夹到可活动范围内 */
    clampPlayer(): void {
        this.player.x = clamp(this.player.x, PLAYER_R + 8, FIELD_W - PLAYER_R - 8);
        this.player.y = clamp(this.player.y, PLAYER_MIN_Y, PLAYER_MAX_Y);
    }

    /** 拖动输入：直接给目标位置（世界坐标） */
    movePlayerTo(x: number, y: number): void {
        this.player.x = x;
        this.player.y = y;
        this.clampPlayer();
    }

    /** 相对位移（虚拟摇杆 / 键盘） */
    movePlayerBy(dx: number, dy: number): void {
        this.player.x += dx;
        this.player.y += dy;
        this.clampPlayer();
    }

    // ---------------- 主循环 ----------------

    update(dt: number): void {
        if (this.phase !== 'playing') return;
        // 单帧上限，避免切后台回来时一帧几百毫秒导致穿模
        const step = Math.min(Math.max(dt, 0), 0.05);
        this.time += step;
        this.updatePlayer(step);
        this.updateEnemies(step);
        this.updateBullets(step, this.playerBullets);
        this.updateBullets(step, this.enemyBullets);
        this.updatePowerups(step);
        this.collidePlayerBullets();
        this.collideEnemyBullets();
        this.updateWaves(step);
        if (this.phase !== 'playing') return;
        const boss = this.boss;
        this.bossHpRatio = boss ? boss.hp / boss.maxHp : -1;
    }

    private updatePlayer(dt: number): void {
        const p = this.player;
        if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);

        p.fireT -= dt;
        if (p.fireT <= 0) {
            p.fireT += PLAYER_FIRE_INTERVAL;
            this.firePlayerWeapon();
        }
    }

    /** 玩家的自动射击：火力等级决定弹数与角度 */
    private firePlayerWeapon(): void {
        const p = this.player;
        const y = p.y - PLAYER_VISUAL_R;
        if (p.power <= 1) {
            this.spawnPlayerBullet(p.x, y, 0);
        } else if (p.power === 2) {
            this.spawnPlayerBullet(p.x - 9, y, 0);
            this.spawnPlayerBullet(p.x + 9, y, 0);
        } else {
            this.spawnPlayerBullet(p.x, y - 6, 0);
            this.spawnPlayerBullet(p.x - 13, y + 4, -0.16);
            this.spawnPlayerBullet(p.x + 13, y + 4, 0.16);
        }
    }

    /** 以 t 为角度（rad，0 = 正上方）发射一颗玩家子弹 */
    private spawnPlayerBullet(x: number, y: number, angle: number): void {
        if (this.playerBullets.length >= MAX_BULLETS) this.playerBullets.shift();
        this.playerBullets.push({
            x,
            y,
            vx: Math.sin(angle) * PLAYER_BULLET_SPEED,
            vy: -Math.cos(angle) * PLAYER_BULLET_SPEED,
            r: 6,
            side: 'p',
            dmg: 1,
        });
    }

    private updateEnemies(dt: number): void {
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            const def = ENEMY_DEFS[e.kind];
            e.t += dt;

            if (e.kind === 'boss') {
                this.updateBoss(e, dt);
            } else if (e.kind === 'weaver') {
                e.y += def.speed * dt;
                e.x = e.baseX + Math.sin(e.t * 2.1) * 92;
            } else {
                e.y += def.speed * dt;
            }

            // 飞出屏幕底部即消失（不扣血，也不给分）
            if (e.y > FIELD_H + 80) {
                this.enemies.splice(i, 1);
                continue;
            }

            // 开火
            if (def.fireEvery > 0 && e.y > 40 && e.y < FIELD_H - 120) {
                e.fireT -= dt;
                if (e.fireT <= 0) {
                    e.fireT = def.fireEvery;
                    this.enemyFire(e);
                }
            }
        }
    }

    private updateBoss(e: Enemy, dt: number): void {
        const HOME_Y = 250;
        if (!e.arrived) {
            e.y += 110 * dt;
            if (e.y >= HOME_Y) {
                e.y = HOME_Y;
                e.arrived = true;
            }
        } else {
            e.y = HOME_Y + Math.sin(e.t * 0.9) * 22;
            e.x = FIELD_W / 2 + Math.sin(e.t * 0.62) * 210;
        }
    }

    /** 敌人开火：四种图案 */
    private enemyFire(e: Enemy): void {
        const def = ENEMY_DEFS[e.kind];
        const speed = def.bulletSpeed;
        switch (def.pattern) {
            case 'aim': {
                const a = angleTo(e.x, e.y, this.player.x, this.player.y);
                this.spawnEnemyBullet(e.x, e.y + e.radius, a, speed);
                break;
            }
            case 'spread3': {
                const a = angleTo(e.x, e.y, this.player.x, this.player.y);
                for (const off of [-0.26, 0, 0.26]) {
                    this.spawnEnemyBullet(e.x, e.y + e.radius, a + off, speed);
                }
                break;
            }
            case 'ring8': {
                const base = (e.shotIndex * Math.PI) / 8;
                for (let i = 0; i < 8; i++) {
                    this.spawnEnemyBullet(e.x, e.y, base + (i * Math.PI) / 4, speed);
                }
                e.shotIndex++;
                break;
            }
            case 'spiral': {
                const base = e.shotIndex * 0.42;
                for (let i = 0; i < 3; i++) {
                    this.spawnEnemyBullet(e.x, e.y, base + (i * Math.PI * 2) / 3, speed);
                }
                // 每两次再补一发瞄准弹
                if (e.shotIndex % 2 === 1) {
                    this.spawnEnemyBullet(
                        e.x,
                        e.y,
                        angleTo(e.x, e.y, this.player.x, this.player.y),
                        speed * 1.25
                    );
                }
                e.shotIndex++;
                break;
            }
        }
    }

    private spawnEnemyBullet(x: number, y: number, angle: number, speed: number): void {
        if (this.enemyBullets.length >= MAX_BULLETS) this.enemyBullets.shift();
        this.enemyBullets.push({
            x,
            y,
            vx: Math.sin(angle) * speed,
            vy: Math.cos(angle) * speed,
            r: 7,
            side: 'e',
            dmg: 1,
        });
    }

    private updateBullets(dt: number, list: Bullet[]): void {
        for (let i = list.length - 1; i >= 0; i--) {
            const b = list[i];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            if (b.y < -60 || b.y > FIELD_H + 60 || b.x < -60 || b.x > FIELD_W + 60) {
                list.splice(i, 1);
            }
        }
    }

    private updatePowerups(dt: number): void {
        for (let i = this.powerups.length - 1; i >= 0; i--) {
            const u = this.powerups[i];
            u.y += u.vy * dt;
            if (u.y > FIELD_H + 40) {
                this.powerups.splice(i, 1);
                continue;
            }
            if (dist2(u.x, u.y, this.player.x, this.player.y) <= (u.r + PLAYER_R + 12) ** 2) {
                this.powerups.splice(i, 1);
                this.applyPowerup(u.kind);
            }
        }
    }

    private applyPowerup(kind: PowerupKind): void {
        if (kind === 'power') {
            this.player.power = Math.min(PLAYER_MAX_POWER, this.player.power + 1);
        } else {
            this.player.lives = Math.min(PLAYER_MAX_LIVES, this.player.lives + 1);
        }
    }

    private collidePlayerBullets(): void {
        for (let bi = this.playerBullets.length - 1; bi >= 0; bi--) {
            const b = this.playerBullets[bi];
            let hit = false;
            for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
                const e = this.enemies[ei];
                if (dist2(b.x, b.y, e.x, e.y) <= (b.r + e.radius) ** 2) {
                    e.hp -= b.dmg;
                    hit = true;
                    if (e.hp <= 0) this.killEnemy(ei);
                    break;
                }
            }
            if (hit) this.playerBullets.splice(bi, 1);
        }
        // 同步 Boss 血条
        const boss = this.boss;
        this.bossHpRatio = boss ? boss.hp / boss.maxHp : -1;
    }

    private killEnemy(index: number): void {
        const e = this.enemies[index];
        this.enemies.splice(index, 1);
        this.score += ENEMY_DEFS[e.kind].score;
        this.kills++;
        // 每 7 个击杀掉一个火力，每 20 个送一条命；Boss 必掉火力
        if (e.kind === 'boss' || this.kills % 7 === 0) {
            this.powerups.push({ x: e.x, y: e.y, vy: 90, kind: 'power', r: 15 });
        } else if (this.kills % 20 === 0) {
            this.powerups.push({ x: e.x, y: e.y, vy: 90, kind: 'life', r: 15 });
        }
        if (e.kind === 'boss') {
            // 母舰坠落即通关
            this.phase = 'won';
        }
    }

    private collideEnemyBullets(): void {
        const p = this.player;
        for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
            const b = this.enemyBullets[i];
            if (dist2(b.x, b.y, p.x, p.y) <= (b.r + PLAYER_R) ** 2) {
                this.enemyBullets.splice(i, 1);
                this.hurtPlayer();
                if (this.phase !== 'playing') return;
            }
        }
        // 敌机体撞也算中弹
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            if (dist2(e.x, e.y, p.x, p.y) <= (e.radius + PLAYER_R) ** 2) {
                this.enemies.splice(i, 1);
                this.hurtPlayer();
                if (this.phase !== 'playing') return;
            }
        }
    }

    private hurtPlayer(): void {
        const p = this.player;
        if (p.invuln > 0) return;
        p.lives--;
        p.invuln = INVULN_TIME;
        if (p.lives <= 0) {
            p.lives = 0;
            this.phase = 'lost';
        }
    }

    // ---------------- 波次 ----------------

    private updateWaves(dt: number): void {
        const wave = this.wave;

        if (this.gapTimer > 0) {
            this.gapTimer -= dt;
            if (this.gapTimer <= 0 && this.waveIndex < SHMUP_WAVES.length) {
                this.waveIndex++;
                this.waveTime = 0;
                this.entryIndex = 0;
                if (this.waveIndex >= SHMUP_WAVES.length) return;
            }
            return;
        }

        this.waveTime += dt;

        // 按时间点生成
        while (
            this.entryIndex < wave.entries.length &&
            wave.entries[this.entryIndex].at <= this.waveTime
        ) {
            const entry = wave.entries[this.entryIndex++];
            this.spawnEntry(entry);
        }

        // 全部生成完 + 场上清空 → 进下一波
        const allSpawned = this.entryIndex >= wave.entries.length;
        if (allSpawned && this.enemies.length === 0) {
            if (this.waveIndex >= SHMUP_WAVES.length - 1) {
                // 最后一波（母舰）清空 = 通关
                this.phase = 'won';
                return;
            }
            this.gapTimer = WAVE_GAP;
        }
    }

    private spawnEntry(entry: ShmupEntry): void {
        const count = Math.max(1, entry.count || 1);
        const gapX = entry.gapX || 0;
        const startX = entry.x - (gapX * (count - 1)) / 2;
        for (let i = 0; i < count; i++) {
            this.spawnEnemy(entry.kind, startX + gapX * i, entry.y === undefined ? -60 : entry.y);
        }
    }

    private spawnEnemy(kind: EnemyKind, x: number, y: number): void {
        const def = ENEMY_DEFS[kind];
        this.spawnedTotal++;
        this.enemies.push({
            id: this.nextEnemyId++,
            kind,
            x,
            y,
            baseX: x,
            hp: def.hp,
            maxHp: def.hp,
            radius: def.radius,
            t: 0,
            fireT: def.fireEvery > 0 ? def.fireEvery * 0.7 : 0,
            shotIndex: 0,
            arrived: kind === 'boss' ? false : undefined,
        });
    }

    /** 当前波次敌人总数（HUD 进度条分母用） */
    waveTotal(): number {
        let total = 0;
        for (const e of this.wave.entries) total += Math.max(1, e.count || 1);
        return total;
    }

    /** 当前波次还剩多少敌人生成 / 存活（HUD 用） */
    remainingInWave(): number {
        const wave = this.wave;
        let pending = 0;
        for (let i = this.entryIndex; i < wave.entries.length; i++) {
            pending += Math.max(1, wave.entries[i].count || 1);
        }
        return this.enemies.length + pending;
    }
}

/** 从 (x0,y0) 指向 (x1,y1) 的角度：0 = 正下方（+y），顺时针为正 */
export function angleTo(x0: number, y0: number, x1: number, y1: number): number {
    return Math.atan2(x1 - x0, y1 - y0);
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}
