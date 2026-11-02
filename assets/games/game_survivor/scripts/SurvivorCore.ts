/**
 * 午夜幸存者（Survivor）— 纯逻辑核心。
 *
 * 约束（规格 §4.2 / §6.2）：
 *  - 不 import 'cc'，不访问 DOM / wx，可在 Node 侧直接编译运行
 *  - 不使用 Math.random，全部随机来自内部 mulberry32(seed)
 *  - step() 内不为每个对象 new，敌人/子弹/宝石全部预分配 + active 标记
 *  - 核心不知道倍速存在，永远只收到固定 dt = FIXED_DT
 *
 * 设计规格：docs/specs/2026-11-02-game-survivor-design.md §3、§6
 */

import {
    ARENA_HALF,
    ARENA_MARGIN,
    BOMBER_DAMAGE,
    BOMBER_FUSE,
    BOMBER_RADIUS,
    BOMBER_TRIGGER_DIST,
    BOOMERANG_HIT_RADIUS,
    BOOMERANG_LEVELS,
    BOOMERANG_RANGE,
    BOSS_BULLET_COUNT,
    BOSS_BULLET_DMG,
    BOSS_BULLET_RADIUS,
    BOSS_BULLET_SPEED,
    BOSS_CONTACT_DMG,
    BOSS_ENRAGE_RATIO,
    BOSS_ENRAGE_SPEED_MULT,
    BOSS_HP,
    BOSS_RADIUS,
    BOSS_SPAWN_DIST,
    BOSS_SPEED,
    BOSS_SUMMON_COUNT,
    BOSS_SUMMON_INTERVAL,
    BOSS_TIME,
    BOSS_VOLLEY_INTERVAL,
    BOSS_VOLLEY_INTERVAL_ENRAGED,
    BULLET_CAP,
    COLORS,
    CoreEvent,
    ELITE_DAMAGE_MULT,
    ELITE_GEM_COUNT,
    ELITE_GEM_VALUE,
    ELITE_HP_MULT,
    ELITE_SIZE_MULT,
    ELITE_SPEED_MULT,
    ELITE_TIMES,
    ELITE_XP,
    ENEMY_BASE,
    ENEMY_CAP,
    ENEMY_CONTACT_CD,
    ENEMY_DMG_SLOPE,
    ENEMY_HP_SLOPE,
    ENEMY_KIND_ORDER,
    ENEMY_RECYCLE_MARGIN,
    ENEMY_SPEED_MAX_BONUS,
    ENEMY_SPEED_SLOPE,
    EnemyKind,
    EnemyState,
    FIXED_DT,
    GEM_CAP,
    GEM_DROP_RATE,
    GEM_MAGNET_SPEED,
    GEM_PICK_DIST,
    HASH_CELL,
    HASTE_PER_LEVEL,
    KNIFE_LIFE,
    KNIFE_RADIUS,
    KNIFE_RANGE,
    KNIFE_LEVELS,
    LIGHTNING_LEVELS,
    MAX_LEVEL,
    MAX_TRACK_LEVEL,
    OFFER_COUNT,
    OFFER_WEIGHT_NEW_PASSIVE,
    OFFER_WEIGHT_NEW_WEAPON,
    OFFER_WEIGHT_OWNED_PASSIVE,
    OFFER_WEIGHT_OWNED_WEAPON,
    ORBIT_HIT_CD,
    ORBIT_HIT_RADIUS,
    ORBIT_LEVELS,
    PASSIVE_NAMES,
    PASSIVE_SLOTS,
    PASSIVE_TRACKS,
    PLAYER_HP,
    PLAYER_IFRAME,
    PLAYER_KNOCKBACK,
    PLAYER_PICKUP,
    PLAYER_RADIUS,
    PLAYER_SPEED,
    PICKUP_PER_LEVEL,
    Phase,
    RunSaveV1,
    RunSummary,
    SAVE_MAX_BULLETS,
    SAVE_MAX_ENEMIES,
    SAVE_MAX_GEMS,
    SAVE_VERSION,
    SHOOTER_BULLET_DMG,
    SHOOTER_BULLET_RADIUS,
    SHOOTER_BULLET_SPEED,
    SHOOTER_INTERVAL,
    SHOOTER_RANGE_MAX,
    SHOOTER_RANGE_MIN,
    SPAWN_RATE_BASE,
    SPAWN_RATE_MAX,
    SPAWN_RATE_SLOPE,
    SPAWN_RETRY,
    SPAWN_RING_MAX,
    SPAWN_RING_MIN,
    SPAWN_SAFE_DIST,
    SWIFT_PER_LEVEL,
    SurvivorInput,
    SurvivorSnapshot,
    TEMPER_DMG_BONUS,
    UpgradeOffer,
    VITALITY_PER_LEVEL,
    WAVE_ARC,
    WAVE_FIRST,
    WAVE_INTERVAL,
    WAVE_WARN,
    WEAVER_SWAY,
    WEAPON_NAMES,
    WEAPON_SLOTS,
    WEAPON_TRACKS,
    WeaponTrack,
    PassiveTrack,
    waveCount,
    xpNeed,
} from './SurvivorConfig';

// ==================== 确定性随机 ====================

/** mulberry32：状态可序列化，读档后随机序列连续 */
export class Rng {
    state: number;

    constructor(seed: number) {
        this.state = seed >>> 0;
    }

    next(): number {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    range(min: number, max: number): number {
        return min + (max - min) * this.next();
    }

    int(n: number): number {
        return Math.floor(this.next() * n);
    }
}

// ==================== 内部辅助 ====================

const HASH_DIM = Math.ceil((ARENA_HALF * 2) / HASH_CELL);
const HASH_COUNT = HASH_DIM * HASH_DIM;
const KIND_INDEX: Record<EnemyKind, number> = {
    chaser: 0,
    weaver: 1,
    shooter: 2,
    bomber: 3,
    boss: 4,
};

/** 每个桶最多检查的敌人数，防止极端聚集时退化成平方复杂度 */
const BUCKET_CHECK_LIMIT = 32;

/** 敌人紧凑数组固定长度 */
const COMPACT_ENEMY_LEN = 13;
const COMPACT_BULLET_BASE = 15;
const COMPACT_GEM_LEN = 4;

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

function norm(x: number, y: number): { x: number; y: number } {
    const d = Math.sqrt(x * x + y * y);
    if (d < 1e-6) return { x: 0, y: 0 };
    return { x: x / d, y: y / d };
}

function isFiniteNumber(v: any): boolean {
    return typeof v === 'number' && isFinite(v);
}

// ==================== 核心 ====================

export class SurvivorCore {
    // --- 基础 ---
    private _seed = 0;
    private _rng: Rng;
    private _time = 0;
    private _kills = 0;
    private _phase: Phase = 'running';

    // --- 玩家与构筑 ---
    private _player = {
        x: 0,
        y: 0,
        hp: PLAYER_HP,
        maxHp: PLAYER_HP,
        speed: PLAYER_SPEED,
        pickupRadius: PLAYER_PICKUP,
        iframe: 0,
        facing: 0,
        level: 1,
        xp: 0,
        xpNeed: xpNeed(1),
    };
    private _weapons: Partial<Record<WeaponTrack, number>> = {};
    private _passives: Partial<Record<PassiveTrack, number>> = {};
    private _temper = 0;

    // --- 对象池 ---
    private _enemies: EnemyState[] = [];
    private _bullets: BulletStatePool[] = [];
    private _gems: GemStatePool[] = [];
    private _enemyActive = 0;
    private _bulletCursor = 0;
    private _gemCursor = 0;
    private _uidCounter = 1;

    // --- 武器计时 ---
    private _knifeCd = 0;
    private _lightningCd = 0;
    private _boomerangCd = 0;
    private _orbitAngle = 0;

    // --- 关卡计时 ---
    private _spawnAcc = 0;
    private _nextEliteIndex = 0;
    private _nextWaveTime = WAVE_FIRST;
    private _waveWarned = false;
    private _bossSpawned = false;
    private _bossEnrage = false;
    private _bossIndex = -1;

    // --- 事件与快照 ---
    private _events: CoreEvent[] = [];
    private _offers: UpgradeOffer[] = [];
    private _firstOfferDone = false;
    private _snap: SurvivorSnapshot;

    // --- 空间分桶 ---
    private _buckets: number[][] = [];
    private _near: number[] = [];
    private _candidates: number[] = [];

    constructor(seed: number) {
        this._seed = seed >>> 0;
        this._rng = new Rng(this._seed);
        this._initPools();
        this._initRun();
        this._snap = {
            phase: 'running',
            time: 0,
            kills: 0,
            player: this._player,
            enemies: this._enemies,
            bullets: this._bullets,
            gems: this._gems,
            boss: null,
            offers: this._offers,
        };
    }

    // ==================== 初始化 ====================

    private _initPools(): void {
        for (let i = 0; i < ENEMY_CAP; i++) {
            this._enemies.push({
                active: false,
                kind: 'chaser',
                x: 0,
                y: 0,
                hp: 0,
                maxHp: 0,
                speed: 0,
                radius: 0,
                damage: 0,
                xp: 0,
                elite: false,
                uid: 0,
                hitCooldown: 0,
                flash: 0,
                phase: 0,
                shootTimer: 0,
                volleyTimer: 0,
                summonTimer: 0,
                orbitCd: [0, 0, 0, 0],
            });
        }
        for (let i = 0; i < BULLET_CAP; i++) {
            this._bullets.push({
                active: false,
                fromPlayer: true,
                kind: 'knife',
                x: 0,
                y: 0,
                vx: 0,
                vy: 0,
                damage: 0,
                radius: 0,
                pierce: 0,
                life: 0,
                originX: 0,
                originY: 0,
                traveled: 0,
                maxDistance: 0,
                returning: false,
                hitUids: [],
            });
        }
        for (let i = 0; i < GEM_CAP; i++) {
            this._gems.push({ active: false, x: 0, y: 0, value: 0, magnet: false });
        }
        for (let i = 0; i < HASH_COUNT; i++) this._buckets.push([]);
    }

    private _initRun(): void {
        this._time = 0;
        this._kills = 0;
        this._phase = 'running';
        this._player.x = 0;
        this._player.y = 0;
        this._player.hp = PLAYER_HP;
        this._player.maxHp = PLAYER_HP;
        this._player.speed = PLAYER_SPEED;
        this._player.pickupRadius = PLAYER_PICKUP;
        this._player.iframe = 0;
        this._player.facing = 0;
        this._player.level = 1;
        this._player.xp = 0;
        this._player.xpNeed = xpNeed(1);
        this._weapons = { knife: 1 };
        this._passives = {};
        this._temper = 0;
        this._knifeCd = 0;
        this._lightningCd = 0;
        this._boomerangCd = 0;
        this._orbitAngle = 0;
        this._spawnAcc = 0;
        this._nextEliteIndex = 0;
        this._nextWaveTime = WAVE_FIRST;
        this._waveWarned = false;
        this._bossSpawned = false;
        this._bossEnrage = false;
        this._bossIndex = -1;
        this._enemyActive = 0;
        this._bulletCursor = 0;
        this._gemCursor = 0;
        this._uidCounter = 1;
        this._events.length = 0;
        this._offers = [];
        this._firstOfferDone = false;
        for (let i = 0; i < this._enemies.length; i++) this._enemies[i].active = false;
        for (let i = 0; i < this._bullets.length; i++) this._bullets[i].active = false;
        for (let i = 0; i < this._gems.length; i++) this._gems[i].active = false;
    }

    /** 丢弃本局，用同一构造时的种子重开 */
    reset(): void {
        this._rng.state = this._seed;
        this._initRun();
    }

    // ==================== 对外 API ====================

    step(dt: number, input: SurvivorInput): void {
        if (this._phase !== 'running') return;
        this._events.length = 0;
        this._time += dt;

        this._updatePlayer(dt, input);
        this._updateWeapons(dt);
        if (this._phase !== 'running') return;
        this._updateEnemies(dt);
        if (this._phase !== 'running') return;
        this._buildHash();
        this._updateBullets(dt);
        if (this._phase !== 'running') return;
        this._updateGems(dt);
        if (this._phase !== 'running') return;
        this._updateSpawns(dt);
        this._checkDefeat();
    }

    getOffers(): readonly UpgradeOffer[] {
        return this._offers;
    }

    chooseUpgrade(index: number): void {
        if (this._phase !== 'levelup') return;
        const offer = this._offers[index];
        if (!offer) return;
        this._applyOffer(offer);
        this._offers = [];
        this._phase = 'running';
        // 一次拿到多级经验：逐级弹面板，不合并
        if (this._player.level < MAX_LEVEL && this._player.xp >= this._player.xpNeed) {
            this._levelUpOnce();
        }
    }

    getSnapshot(): Readonly<SurvivorSnapshot> {
        const s = this._snap;
        s.phase = this._phase;
        s.time = this._time;
        s.kills = this._kills;
        s.player = this._player;
        s.enemies = this._enemies;
        s.bullets = this._bullets;
        s.gems = this._gems;
        s.boss = this._bossIndex >= 0 && this._enemies[this._bossIndex].active ? this._enemies[this._bossIndex] : null;
        s.offers = this._offers;
        return s;
    }

    /** 取出本帧事件（数组复用，调用方需在下一步之前消费完） */
    drainEvents(): CoreEvent[] {
        return this._events;
    }

    getRunSummary(): RunSummary {
        return { time: this._time, level: this._player.level, kills: this._kills };
    }

    // ==================== 调试接口 ====================

    debugAdvance(seconds: number): void {
        const steps = Math.max(0, Math.floor(seconds / FIXED_DT));
        const input: SurvivorInput = { moveX: 0, moveY: 0 };
        for (let i = 0; i < steps; i++) {
            if (this._phase !== 'running') break;
            this.step(FIXED_DT, input);
        }
    }

    debugSpawn(kind: EnemyKind, count: number, elite?: boolean): void {
        for (let i = 0; i < count; i++) {
            const angle = this._rng.range(0, Math.PI * 2);
            const d = 300;
            this._spawnEnemy(
                kind,
                this._player.x + Math.cos(angle) * d,
                this._player.y + Math.sin(angle) * d,
                !!elite
            );
        }
    }

    debugSetWeapon(track: string, level: number): void {
        if (WEAPON_TRACKS.indexOf(track as WeaponTrack) < 0) return;
        if (level <= 0) {
            delete this._weapons[track as WeaponTrack];
            return;
        }
        this._weapons[track as WeaponTrack] = clamp(Math.round(level), 1, MAX_TRACK_LEVEL);
    }

    /** 测试/调试用：直接加经验（走正常升级流程） */
    debugAddXp(value: number): void {
        if (this._phase !== 'running') return;
        this._addXp(value);
    }

    // ==================== 玩家 ====================

    private _updatePlayer(dt: number, input: SurvivorInput): void {
        const p = this._player;
        let mx = input && input.moveX ? input.moveX : 0;
        let my = input && input.moveY ? input.moveY : 0;
        const len = Math.sqrt(mx * mx + my * my);
        if (len > 1) {
            mx /= len;
            my /= len;
        }
        if (mx !== 0 || my !== 0) {
            p.facing = Math.atan2(my, mx);
            p.x += mx * p.speed * dt;
            p.y += my * p.speed * dt;
            const lim = ARENA_HALF - ARENA_MARGIN;
            p.x = clamp(p.x, -lim, lim);
            p.y = clamp(p.y, -lim, lim);
        }
        if (p.iframe > 0) p.iframe = Math.max(0, p.iframe - dt);
    }

    private _damagePlayer(dmg: number): void {
        const p = this._player;
        if (this._phase !== 'running' || p.iframe > 0) return;
        p.hp -= dmg;
        p.iframe = PLAYER_IFRAME;
        this._events.push({ type: 'hit', data: Math.round(dmg) });
        if (p.hp <= 0) {
            p.hp = 0;
            this._phase = 'defeat';
            this._events.push({ type: 'defeat' });
        }
    }

    private _checkDefeat(): void {
        if (this._phase === 'running' && this._player.hp <= 0) {
            this._player.hp = 0;
            this._phase = 'defeat';
            this._events.push({ type: 'defeat' });
        }
    }

    // ==================== 武器 ====================

    private _hasteMult(): number {
        return 1 + HASTE_PER_LEVEL * (this._passives.haste || 0);
    }

    private _damageMult(): number {
        return 1 + TEMPER_DMG_BONUS * this._temper;
    }

    private _updateWeapons(dt: number): void {
        const haste = this._hasteMult();

        // 星环：持续旋转，按球各自冷却
        const orbitLv = this._weapons.orbit || 0;
        if (orbitLv > 0) {
            const st = ORBIT_LEVELS[orbitLv - 1];
            this._orbitAngle += st.angular * dt;
            this._updateOrbit(st, st.count);
        }

        // 飞刀
        const knifeLv = this._weapons.knife || 0;
        if (knifeLv > 0) {
            this._knifeCd -= dt;
            if (this._knifeCd <= 0) {
                const st = KNIFE_LEVELS[knifeLv - 1];
                this._fireKnives(st);
                this._knifeCd = st.interval / haste;
            }
        }

        // 落雷
        const lightningLv = this._weapons.lightning || 0;
        if (lightningLv > 0) {
            this._lightningCd -= dt;
            if (this._lightningCd <= 0) {
                const st = LIGHTNING_LEVELS[lightningLv - 1];
                this._strikeLightning(st);
                this._lightningCd = st.interval / haste;
            }
        }

        // 回旋镖
        const boomerangLv = this._weapons.boomerang || 0;
        if (boomerangLv > 0) {
            this._boomerangCd -= dt;
            if (this._boomerangCd <= 0) {
                const st = BOOMERANG_LEVELS[boomerangLv - 1];
                this._throwBoomerangs(st);
                this._boomerangCd = st.interval / haste;
            }
        }
    }

    private _nearestEnemy(x: number, y: number, range: number): EnemyState | null {
        let best: EnemyState | null = null;
        let bestD2 = range * range;
        const enemies = this._enemies;
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (!e.active) continue;
            const dx = e.x - x;
            const dy = e.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = e;
            }
        }
        return best;
    }

    private _fireKnives(st: (typeof KNIFE_LEVELS)[number]): void {
        const p = this._player;
        const target = this._nearestEnemy(p.x, p.y, KNIFE_RANGE);
        const baseAngle = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.facing;
        const mult = this._damageMult();
        const spreadRad = (st.spread * Math.PI) / 180;
        for (let i = 0; i < st.count; i++) {
            const offset = (i - (st.count - 1) / 2) * spreadRad;
            const angle = baseAngle + offset;
            const b = this._spawnBullet();
            if (!b) continue;
            b.active = true;
            b.fromPlayer = true;
            b.kind = 'knife';
            b.x = p.x;
            b.y = p.y;
            b.vx = Math.cos(angle) * st.speed;
            b.vy = Math.sin(angle) * st.speed;
            b.damage = Math.round(st.damage * mult);
            b.radius = KNIFE_RADIUS;
            b.pierce = st.pierce;
            b.life = KNIFE_LIFE;
            b.hitUids.length = 0;
        }
    }

    private _updateOrbit(st: (typeof ORBIT_LEVELS)[number], count: number): void {
        const p = this._player;
        const mult = this._damageMult();
        for (let orb = 0; orb < count; orb++) {
            const angle = this._orbitAngle + (orb * Math.PI * 2) / count;
            const ox = p.x + Math.cos(angle) * st.radius;
            const oy = p.y + Math.sin(angle) * st.radius;
            const n = this._collectNear(ox, oy, ORBIT_HIT_RADIUS);
            for (let k = 0; k < n; k++) {
                const e = this._enemies[this._near[k]];
                if (!e.active) continue;
                const dx = e.x - ox;
                const dy = e.y - oy;
                const rr = ORBIT_HIT_RADIUS + e.radius;
                if (dx * dx + dy * dy > rr * rr) continue;
                if (this._time - e.orbitCd[orb] < ORBIT_HIT_CD) continue;
                e.orbitCd[orb] = this._time;
                this._damageEnemy(e, st.damage * mult);
            }
        }
    }

    private _strikeLightning(st: (typeof LIGHTNING_LEVELS)[number]): void {
        const p = this._player;
        const mult = this._damageMult();
        for (let t = 0; t < st.targets; t++) {
            const enemy = this._pickWeightedEnemy(p.x, p.y, st.range);
            if (!enemy) return;
            const cx = enemy.x;
            const cy = enemy.y;
            this._events.push({ type: 'lightning', x: cx, y: cy, r: st.aoe });
            const enemies = this._enemies;
            for (let i = 0; i < enemies.length; i++) {
                const e = enemies[i];
                if (!e.active) continue;
                const dx = e.x - cx;
                const dy = e.y - cy;
                const rr = st.aoe + e.radius;
                if (dx * dx + dy * dy <= rr * rr) {
                    this._damageEnemy(e, st.damage * mult);
                }
            }
        }
    }

    private _throwBoomerangs(st: (typeof BOOMERANG_LEVELS)[number]): void {
        const p = this._player;
        const target = this._nearestEnemy(p.x, p.y, BOOMERANG_RANGE);
        const baseAngle = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.facing;
        const mult = this._damageMult();
        for (let i = 0; i < st.count; i++) {
            const offset = (i - (st.count - 1) / 2) * 0.35;
            const angle = baseAngle + offset;
            const b = this._spawnBullet();
            if (!b) continue;
            b.active = true;
            b.fromPlayer = true;
            b.kind = 'boomerang';
            b.x = p.x;
            b.y = p.y;
            b.originX = p.x;
            b.originY = p.y;
            b.vx = Math.cos(angle) * st.speed;
            b.vy = Math.sin(angle) * st.speed;
            b.damage = Math.round(st.damage * mult);
            b.radius = BOOMERANG_HIT_RADIUS;
            b.pierce = -1;
            b.life = 99;
            b.traveled = 0;
            b.maxDistance = st.range;
            b.returning = false;
            b.hitUids.length = 0;
        }
    }

    // ==================== 敌人 ====================

    private _hpMult(): number {
        return 1 + this._time * ENEMY_HP_SLOPE;
    }

    private _dmgMult(): number {
        return 1 + this._time * ENEMY_DMG_SLOPE;
    }

    private _speedMult(): number {
        return 1 + Math.min(ENEMY_SPEED_MAX_BONUS, this._time * ENEMY_SPEED_SLOPE);
    }

    private _spawnEnemy(kind: EnemyKind, x: number, y: number, elite: boolean): EnemyState | null {
        if (kind !== 'boss' && this._enemyActive >= ENEMY_CAP) return null;
        let slot: EnemyState | null = null;
        for (let i = 0; i < this._enemies.length; i++) {
            if (!this._enemies[i].active) {
                slot = this._enemies[i];
                break;
            }
        }
        if (!slot) return null;

        const base = ENEMY_BASE[kind];
        const hpMult = this._hpMult();
        const dmgMult = this._dmgMult();
        const spdMult = this._speedMult();
        const isBoss = kind === 'boss';

        slot.active = true;
        slot.kind = kind;
        slot.x = clamp(x, -ARENA_HALF + ARENA_MARGIN, ARENA_HALF - ARENA_MARGIN);
        slot.y = clamp(y, -ARENA_HALF + ARENA_MARGIN, ARENA_HALF - ARENA_MARGIN);
        slot.maxHp = isBoss ? BOSS_HP : base.hp * hpMult * (elite ? ELITE_HP_MULT : 1);
        slot.hp = slot.maxHp;
        slot.speed = isBoss ? BOSS_SPEED : base.speed * spdMult * (elite ? ELITE_SPEED_MULT : 1);
        slot.radius = isBoss ? BOSS_RADIUS : base.radius * (elite ? ELITE_SIZE_MULT : 1);
        // Boss 伤害固定不随时间缩放；精英仍按时间倍率
        slot.damage = isBoss
            ? BOSS_CONTACT_DMG
            : Math.round(base.damage * dmgMult * (elite ? ELITE_DAMAGE_MULT : 1));
        slot.xp = isBoss ? 0 : elite ? ELITE_XP : base.xp;
        slot.elite = elite && !isBoss;
        slot.uid = this._uidCounter++;
        slot.hitCooldown = 0;
        slot.flash = 0;
        slot.phase = kind === 'weaver' ? this._rng.range(0, Math.PI * 2) : 0;
        slot.shootTimer = SHOOTER_INTERVAL * 0.5;
        slot.volleyTimer = BOSS_VOLLEY_INTERVAL;
        slot.summonTimer = BOSS_SUMMON_INTERVAL;
        slot.orbitCd[0] = 0;
        slot.orbitCd[1] = 0;
        slot.orbitCd[2] = 0;
        slot.orbitCd[3] = 0;

        this._enemyActive++;
        if (isBoss) {
            this._bossIndex = this._enemies.indexOf(slot);
            this._bossSpawned = true;
            this._events.push({ type: 'boss' });
        }
        return slot;
    }

    private _updateEnemies(dt: number): void {
        const p = this._player;
        const enemies = this._enemies;
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (!e.active) continue;

            if (e.flash > 0) e.flash = Math.max(0, e.flash - dt);
            if (e.hitCooldown > 0) e.hitCooldown = Math.max(0, e.hitCooldown - dt);

            const dx = p.x - e.x;
            const dy = p.y - e.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const dir = norm(dx, dy);

            if (e.kind === 'chaser') {
                e.x += dir.x * e.speed * dt;
                e.y += dir.y * e.speed * dt;
            } else if (e.kind === 'weaver') {
                const sway = Math.cos(this._time * Math.PI * 2 * 2 + e.phase) * WEAVER_SWAY;
                const px = -dir.y;
                const py = dir.x;
                e.x += (dir.x + px * sway) * e.speed * dt;
                e.y += (dir.y + py * sway) * e.speed * dt;
            } else if (e.kind === 'shooter') {
                if (dist < SHOOTER_RANGE_MIN) {
                    e.x -= dir.x * e.speed * dt;
                    e.y -= dir.y * e.speed * dt;
                } else if (dist > SHOOTER_RANGE_MAX) {
                    e.x += dir.x * e.speed * dt;
                    e.y += dir.y * e.speed * dt;
                }
                e.shootTimer -= dt;
                if (e.shootTimer <= 0) {
                    e.shootTimer = SHOOTER_INTERVAL;
                    this._spawnEnemyBullet(e, dir, SHOOTER_BULLET_SPEED, SHOOTER_BULLET_DMG, SHOOTER_BULLET_RADIUS);
                }
            } else if (e.kind === 'bomber') {
                if (e.phase > 0) {
                    // 已点燃：停下并倒计时
                    e.phase += dt;
                    if (e.phase >= BOMBER_FUSE) {
                        this._explodeBomber(e);
                        this._killEnemy(e, true);
                        continue;
                    }
                } else if (dist < BOMBER_TRIGGER_DIST) {
                    e.phase = 0.0001;
                } else {
                    e.x += dir.x * e.speed * dt;
                    e.y += dir.y * e.speed * dt;
                }
            } else if (e.kind === 'boss') {
                const speed = e.speed * (this._bossEnrage ? BOSS_ENRAGE_SPEED_MULT : 1);
                if (dist > BOSS_RADIUS + PLAYER_RADIUS - 4) {
                    e.x += dir.x * speed * dt;
                    e.y += dir.y * speed * dt;
                }
                e.volleyTimer -= dt;
                if (e.volleyTimer <= 0) {
                    e.volleyTimer = this._bossEnrage ? BOSS_VOLLEY_INTERVAL_ENRAGED : BOSS_VOLLEY_INTERVAL;
                    this._bossVolley(e);
                }
                e.summonTimer -= dt;
                if (e.summonTimer <= 0) {
                    e.summonTimer = BOSS_SUMMON_INTERVAL;
                    this._bossSummon(e);
                }
                if (!this._bossEnrage && e.hp / e.maxHp < BOSS_ENRAGE_RATIO) {
                    this._bossEnrage = true;
                }
            }

            // 夹紧与回收
            const lim = ARENA_HALF - ARENA_MARGIN;
            e.x = clamp(e.x, -lim, lim);
            e.y = clamp(e.y, -lim, lim);
            if (Math.abs(e.x) > ARENA_HALF + ENEMY_RECYCLE_MARGIN || Math.abs(e.y) > ARENA_HALF + ENEMY_RECYCLE_MARGIN) {
                e.active = false;
                this._enemyActive--;
                continue;
            }

            // 接触玩家
            const rr = e.radius + PLAYER_RADIUS;
            if (dist * dist <= rr * rr && e.hitCooldown <= 0 && p.iframe <= 0 && e.damage > 0) {
                this._damagePlayer(e.damage);
                e.hitCooldown = ENEMY_CONTACT_CD;
                // 击退敌人 40 px（方向从玩家指向敌人）
                const back = norm(e.x - p.x, e.y - p.y);
                e.x += back.x * PLAYER_KNOCKBACK;
                e.y += back.y * PLAYER_KNOCKBACK;
            }
            if (this._phase !== 'running') return;
        }
    }

    private _spawnEnemyBullet(
        e: EnemyState,
        dir: { x: number; y: number },
        speed: number,
        damage: number,
        radius: number
    ): void {
        const b = this._spawnBullet();
        if (!b) return;
        b.active = true;
        b.fromPlayer = false;
        b.kind = 'enemy';
        b.x = e.x;
        b.y = e.y;
        b.vx = dir.x * speed;
        b.vy = dir.y * speed;
        b.damage = damage;
        b.radius = radius;
        b.pierce = 0;
        b.life = 6;
        b.hitUids.length = 0;
    }

    private _bossVolley(e: EnemyState): void {
        for (let i = 0; i < BOSS_BULLET_COUNT; i++) {
            const angle = (i * Math.PI * 2) / BOSS_BULLET_COUNT;
            this._spawnEnemyBullet(
                e,
                { x: Math.cos(angle), y: Math.sin(angle) },
                BOSS_BULLET_SPEED,
                BOSS_BULLET_DMG,
                BOSS_BULLET_RADIUS
            );
        }
    }

    private _bossSummon(e: EnemyState): void {
        for (let i = 0; i < BOSS_SUMMON_COUNT; i++) {
            const angle = this._rng.range(0, Math.PI * 2);
            this._spawnEnemy('chaser', e.x + Math.cos(angle) * 70, e.y + Math.sin(angle) * 70, false);
        }
    }

    private _explodeBomber(e: EnemyState): void {
        this._events.push({ type: 'explode', x: e.x, y: e.y, r: BOMBER_RADIUS });
        const dx = this._player.x - e.x;
        const dy = this._player.y - e.y;
        if (dx * dx + dy * dy <= BOMBER_RADIUS * BOMBER_RADIUS) {
            this._damagePlayer(BOMBER_DAMAGE * this._dmgMult());
        }
    }

    private _damageEnemy(e: EnemyState, dmg: number): void {
        if (!e.active) return;
        e.hp -= dmg;
        e.flash = 0.06;
        if (e.hp <= 0) this._killEnemy(e, false);
    }

    private _killEnemy(e: EnemyState, skipExplosion: boolean): void {
        if (!e.active) return;
        e.active = false;
        this._enemyActive--;
        this._kills++;

        if (e.kind === 'boss') {
            this._bossIndex = -1;
            this._phase = 'victory';
            this._events.push({ type: 'victory' });
            return;
        }
        if (e.kind === 'bomber' && !skipExplosion) {
            this._explodeBomber(e);
            if (this._phase !== 'running') return;
        }

        if (e.elite) {
            for (let i = 0; i < ELITE_GEM_COUNT; i++) {
                const angle = this._rng.range(0, Math.PI * 2);
                this._dropGem(e.x + Math.cos(angle) * 18, e.y + Math.sin(angle) * 18, ELITE_GEM_VALUE);
            }
            this._events.push({ type: 'elite', data: 1 });
        } else if (this._rng.next() < GEM_DROP_RATE) {
            this._dropGem(e.x, e.y, e.xp > 0 ? e.xp : 1);
        }
    }

    private _dropGem(x: number, y: number, value: number): void {
        let slot: GemStatePool | null = null;
        for (let i = 0; i < this._gems.length; i++) {
            const g = this._gems[(this._gemCursor + i) % this._gems.length];
            if (!g.active) {
                slot = g;
                this._gemCursor = (this._gemCursor + i + 1) % this._gems.length;
                break;
            }
        }
        if (!slot) {
            // 上限溢出：直接结算经验，不生成对象
            this._addXp(value);
            return;
        }
        slot.active = true;
        slot.x = x;
        slot.y = y;
        slot.value = value;
        slot.magnet = false;
    }

    private _addXp(value: number): void {
        const p = this._player;
        p.xp += value;
        if (this._phase === 'running' && p.level < MAX_LEVEL && p.xp >= p.xpNeed) {
            this._levelUpOnce();
        }
    }

    private _levelUpOnce(): void {
        const p = this._player;
        p.xp -= p.xpNeed;
        p.level++;
        p.xpNeed = xpNeed(p.level);
        this._offers = this._generateOffers();
        this._phase = 'levelup';
        this._events.push({ type: 'levelup', data: p.level });
    }

    // ==================== 宝石 ====================

    private _updateGems(dt: number): void {
        const p = this._player;
        for (let i = 0; i < this._gems.length; i++) {
            const g = this._gems[i];
            if (!g.active) continue;
            const dx = p.x - g.x;
            const dy = p.y - g.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (!g.magnet && dist <= p.pickupRadius) g.magnet = true;
            if (g.magnet) {
                if (dist <= GEM_PICK_DIST) {
                    g.active = false;
                    this._addXp(g.value);
                    this._events.push({ type: 'pickup', data: g.value });
                    continue;
                }
                const d = norm(dx, dy);
                g.x += d.x * GEM_MAGNET_SPEED * dt;
                g.y += d.y * GEM_MAGNET_SPEED * dt;
            }
        }
    }

    // ==================== 子弹 ====================

    private _spawnBullet(): BulletStatePool | null {
        for (let i = 0; i < this._bullets.length; i++) {
            const b = this._bullets[(this._bulletCursor + i) % this._bullets.length];
            if (!b.active) {
                this._bulletCursor = (this._bulletCursor + i + 1) % this._bullets.length;
                return b;
            }
        }
        // 池满：回收最旧的一颗
        const oldest = this._bullets[this._bulletCursor];
        this._bulletCursor = (this._bulletCursor + 1) % this._bullets.length;
        return oldest;
    }

    private _updateBullets(dt: number): void {
        const p = this._player;
        const lim = ARENA_HALF;
        for (let i = 0; i < this._bullets.length; i++) {
            const b = this._bullets[i];
            if (!b.active) continue;

            if (b.kind === 'boomerang') {
                if (!b.returning) {
                    b.x += b.vx * dt;
                    b.y += b.vy * dt;
                    b.traveled += Math.sqrt(b.vx * b.vx + b.vy * b.vy) * dt;
                    if (b.traveled >= b.maxDistance) b.returning = true;
                } else {
                    const dx = b.originX - b.x;
                    const dy = b.originY - b.y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    const step = Math.sqrt(b.vx * b.vx + b.vy * b.vy) * dt;
                    if (d <= step) {
                        b.active = false;
                        continue;
                    }
                    b.x += (dx / d) * step;
                    b.y += (dy / d) * step;
                }
            } else {
                b.x += b.vx * dt;
                b.y += b.vy * dt;
                b.life -= dt;
                if (b.life <= 0) {
                    b.active = false;
                    continue;
                }
            }

            if (Math.abs(b.x) > lim || Math.abs(b.y) > lim) {
                b.active = false;
                continue;
            }

            if (b.kind === 'enemy') {
                const dx = p.x - b.x;
                const dy = p.y - b.y;
                const rr = b.radius + PLAYER_RADIUS;
                if (dx * dx + dy * dy <= rr * rr) {
                    b.active = false;
                    this._damagePlayer(b.damage);
                    if (this._phase !== 'running') return;
                }
                continue;
            }

            // 玩家子弹
            const n = this._collectNear(b.x, b.y, b.radius + 24);
            for (let k = 0; k < n; k++) {
                const e = this._enemies[this._near[k]];
                if (!e.active) continue;
                const dx = e.x - b.x;
                const dy = e.y - b.y;
                const rr = b.radius + e.radius;
                if (dx * dx + dy * dy > rr * rr) continue;

                if (b.kind === 'knife') {
                    if (b.hitUids.indexOf(e.uid) >= 0) continue;
                    b.hitUids.push(e.uid);
                    this._damageEnemy(e, b.damage);
                    if (b.pierce <= 0) {
                        b.active = false;
                        break;
                    }
                    b.pierce--;
                } else if (b.kind === 'boomerang') {
                    // 去、回各记一次：同一个 uid 最多两次
                    const key = e.uid * 2 + (b.returning ? 1 : 0);
                    if (b.hitUids.indexOf(key) >= 0) continue;
                    b.hitUids.push(key);
                    this._damageEnemy(e, b.damage);
                }
                if (this._phase !== 'running') return;
            }
            if (this._phase !== 'running') return;
        }
    }

    // ==================== 空间分桶 ====================

    private _buildHash(): void {
        const buckets = this._buckets;
        for (let i = 0; i < buckets.length; i++) buckets[i].length = 0;
        const enemies = this._enemies;
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (!e.active) continue;
            const cx = clamp(Math.floor((e.x + ARENA_HALF) / HASH_CELL), 0, HASH_DIM - 1);
            const cy = clamp(Math.floor((e.y + ARENA_HALF) / HASH_CELL), 0, HASH_DIM - 1);
            buckets[cy * HASH_DIM + cx].push(i);
        }
    }

    /** 把半径 r 内的敌人槽位索引写入 _near，返回数量（上限 BUCKET_CHECK_LIMIT × 9） */
    private _collectNear(x: number, y: number, r: number): number {
        const near = this._near;
        near.length = 0;
        const cx = clamp(Math.floor((x + ARENA_HALF) / HASH_CELL), 0, HASH_DIM - 1);
        const cy = clamp(Math.floor((y + ARENA_HALF) / HASH_CELL), 0, HASH_DIM - 1);
        const span = Math.max(1, Math.ceil(r / HASH_CELL));
        for (let gy = cy - span; gy <= cy + span; gy++) {
            if (gy < 0 || gy >= HASH_DIM) continue;
            for (let gx = cx - span; gx <= cx + span; gx++) {
                if (gx < 0 || gx >= HASH_DIM) continue;
                const bucket = this._buckets[gy * HASH_DIM + gx];
                const limit = Math.min(bucket.length, BUCKET_CHECK_LIMIT);
                for (let i = 0; i < limit; i++) near.push(bucket[i]);
            }
        }
        return near.length;
    }

    private _pickWeightedEnemy(x: number, y: number, range: number): EnemyState | null {
        const cand = this._candidates;
        cand.length = 0;
        let total = 0;
        const enemies = this._enemies;
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (!e.active) continue;
            const dx = e.x - x;
            const dy = e.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 > range * range) continue;
            const d = Math.sqrt(d2);
            const w = 1 / (d / range + 0.2);
            cand.push(i);
            cand.push(w);
            total += w;
        }
        if (cand.length === 0) return null;
        let roll = this._rng.next() * total;
        for (let i = 0; i < cand.length; i += 2) {
            roll -= cand[i + 1];
            if (roll <= 0) return this._enemies[cand[i]];
        }
        return this._enemies[cand[cand.length - 2]];
    }

    // ==================== 刷怪与波次 ====================

    private _updateSpawns(dt: number): void {
        const t = this._time;

        // 常规刷新（Boss 在场时减半）
        let rate = Math.min(SPAWN_RATE_MAX, SPAWN_RATE_BASE + SPAWN_RATE_SLOPE * t);
        if (this._bossSpawned && this._bossIndex >= 0) rate *= 0.5;
        this._spawnAcc += rate * dt;
        let guard = 0;
        while (this._spawnAcc >= 1 && guard++ < 40) {
            this._spawnAcc -= 1;
            if (this._enemyActive >= ENEMY_CAP) break;
            this._spawnRandomEnemy(t);
        }

        // 精英
        if (this._nextEliteIndex < ELITE_TIMES.length && t >= ELITE_TIMES[this._nextEliteIndex]) {
            this._nextEliteIndex++;
            const kinds = this._unlockedKinds(t);
            const kind = kinds[this._rng.int(kinds.length)];
            const pos = this._spawnPosition();
            this._spawnEnemy(kind, pos.x, pos.y, true);
            this._events.push({ type: 'elite', data: 0 });
        }

        // 兽潮：每 45 s 一波，提前 2 s 提示
        if (!this._waveWarned && t >= this._nextWaveTime - WAVE_WARN) {
            this._waveWarned = true;
            this._events.push({ type: 'wave', data: waveCount(t) });
        }
        if (t >= this._nextWaveTime) {
            this._spawnWave(t);
            this._nextWaveTime += WAVE_INTERVAL;
            this._waveWarned = false;
        }

        // Boss
        if (!this._bossSpawned && t >= BOSS_TIME) {
            const angle = this._rng.range(0, Math.PI * 2);
            this._spawnEnemy(
                'boss',
                this._player.x + Math.cos(angle) * BOSS_SPAWN_DIST,
                this._player.y + Math.sin(angle) * BOSS_SPAWN_DIST,
                false
            );
        }
    }

    private _unlockedKinds(t: number): EnemyKind[] {
        const kinds: EnemyKind[] = ['chaser'];
        if (t >= 60) kinds.push('weaver');
        if (t >= 120) kinds.push('shooter');
        if (t >= 240) kinds.push('bomber');
        return kinds;
    }

    private _spawnPosition(): { x: number; y: number } {
        const p = this._player;
        let x = 0;
        let y = 0;
        for (let attempt = 0; attempt <= SPAWN_RETRY; attempt++) {
            const angle = this._rng.range(0, Math.PI * 2);
            const dist = this._rng.range(SPAWN_RING_MIN, SPAWN_RING_MAX);
            x = clamp(p.x + Math.cos(angle) * dist, -ARENA_HALF + ARENA_MARGIN, ARENA_HALF - ARENA_MARGIN);
            y = clamp(p.y + Math.sin(angle) * dist, -ARENA_HALF + ARENA_MARGIN, ARENA_HALF - ARENA_MARGIN);
            const dx = x - p.x;
            const dy = y - p.y;
            if (dx * dx + dy * dy >= SPAWN_SAFE_DIST * SPAWN_SAFE_DIST) break;
        }
        return { x, y };
    }

    private _spawnRandomEnemy(t: number): void {
        const w = spawnWeightsSafe(t);
        const roll = this._rng.next() * (w[0] + w[1] + w[2] + w[3]);
        let kind: EnemyKind = 'chaser';
        if (roll < w[0]) kind = 'chaser';
        else if (roll < w[0] + w[1]) kind = 'weaver';
        else if (roll < w[0] + w[1] + w[2]) kind = 'shooter';
        else kind = 'bomber';
        const pos = this._spawnPosition();
        this._spawnEnemy(kind, pos.x, pos.y, false);
    }

    private _spawnWave(t: number): void {
        const count = waveCount(t);
        const center = this._rng.range(0, Math.PI * 2);
        for (let i = 0; i < count; i++) {
            if (this._enemyActive >= ENEMY_CAP) return;
            const angle = center + this._rng.range(-WAVE_ARC / 2, WAVE_ARC / 2);
            const dist = this._rng.range(SPAWN_RING_MIN, SPAWN_RING_MAX);
            const kinds = this._unlockedKinds(t);
            const kind = kinds[this._rng.int(kinds.length)];
            this._spawnEnemy(
                kind,
                this._player.x + Math.cos(angle) * dist,
                this._player.y + Math.sin(angle) * dist,
                false
            );
        }
    }

    // ==================== 升级卡 ====================

    private _generateOffers(): UpgradeOffer[] {
        const pool: { offer: UpgradeOffer; weight: number }[] = [];

        let weaponCount = 0;
        for (let i = 0; i < WEAPON_TRACKS.length; i++) {
            const track = WEAPON_TRACKS[i];
            const lv = this._weapons[track] || 0;
            if (lv > 0) weaponCount++;
            if (lv > 0 && lv < MAX_TRACK_LEVEL) {
                pool.push({
                    offer: this._weaponOffer(track, lv, lv + 1, 'weaponUpgrade'),
                    weight: OFFER_WEIGHT_OWNED_WEAPON,
                });
            } else if (lv === 0 && weaponCount < WEAPON_SLOTS) {
                pool.push({
                    offer: this._weaponOffer(track, 0, 1, 'newWeapon'),
                    weight: OFFER_WEIGHT_NEW_WEAPON,
                });
            }
        }

        let passiveCount = 0;
        for (let i = 0; i < PASSIVE_TRACKS.length; i++) {
            const track = PASSIVE_TRACKS[i];
            const lv = this._passives[track] || 0;
            if (lv > 0) passiveCount++;
            if (lv > 0 && lv < MAX_TRACK_LEVEL) {
                pool.push({
                    offer: this._passiveOffer(track, lv, lv + 1, 'passiveUpgrade'),
                    weight: OFFER_WEIGHT_OWNED_PASSIVE,
                });
            } else if (lv === 0 && passiveCount < PASSIVE_SLOTS) {
                pool.push({
                    offer: this._passiveOffer(track, 0, 1, 'newPassive'),
                    weight: OFFER_WEIGHT_NEW_PASSIVE,
                });
            }
        }

        const picked: UpgradeOffer[] = [];
        while (picked.length < OFFER_COUNT && pool.length > 0) {
            let total = 0;
            for (let i = 0; i < pool.length; i++) total += pool[i].weight;
            let roll = this._rng.next() * total;
            let idx = pool.length - 1;
            for (let i = 0; i < pool.length; i++) {
                roll -= pool[i].weight;
                if (roll <= 0) {
                    idx = i;
                    break;
                }
            }
            picked.push(pool[idx].offer);
            pool.splice(idx, 1);
        }

        // 第一次升级：至少 1 张武器卡 + 1 张被动卡（可玩性红线：一开始就要看见两条成长线）
        if (!this._firstOfferDone) {
            this._firstOfferDone = true;
            if (!picked.some((o) => o.kind === 'weaponUpgrade' || o.kind === 'newWeapon')) {
                this._replaceOffer(picked, pool, 'weapon');
            }
            if (!picked.some((o) => o.kind === 'passiveUpgrade' || o.kind === 'newPassive')) {
                this._replaceOffer(picked, pool, 'passive');
            }
        }

        // 兜底：全部满级时用「淬炼 / 回复」填充
        const fillers: UpgradeOffer[] = [
            {
                kind: 'temper',
                track: '',
                currentLevel: this._temper,
                nextLevel: this._temper + 1,
                title: '淬炼',
                detail: `全部武器伤害 +${Math.round(TEMPER_DMG_BONUS * 100)}%（当前 +${Math.round(
                    this._temper * TEMPER_DMG_BONUS * 100
                )}%）`,
            },
            {
                kind: 'heal',
                track: '',
                currentLevel: 0,
                nextLevel: 30,
                title: '回复 30',
                detail: `生命 ${Math.round(this._player.hp)} → ${Math.round(
                    Math.min(this._player.maxHp, this._player.hp + 30)
                )}`,
            },
            {
                kind: 'heal',
                track: '',
                currentLevel: 0,
                nextLevel: 60,
                title: '回复 60',
                detail: `生命 ${Math.round(this._player.hp)} → ${Math.round(
                    Math.min(this._player.maxHp, this._player.hp + 60)
                )}`,
            },
        ];
        let fi = 0;
        while (picked.length < OFFER_COUNT && fi < fillers.length) {
            const f = fillers[fi++];
            if (!picked.some((o) => o.title === f.title)) picked.push(f);
        }

        return picked;
    }

    private _replaceOffer(
        picked: UpgradeOffer[],
        pool: { offer: UpgradeOffer; weight: number }[],
        kind: 'weapon' | 'passive'
    ): void {
        const isWeapon = (o: UpgradeOffer) => o.kind === 'weaponUpgrade' || o.kind === 'newWeapon';
        const isPassive = (o: UpgradeOffer) => o.kind === 'passiveUpgrade' || o.kind === 'newPassive';
        const test = kind === 'weapon' ? isWeapon : isPassive;
        const src = pool.find((p) => test(p.offer));
        if (!src) return;
        let replaceAt = -1;
        for (let i = picked.length - 1; i >= 0; i--) {
            if (!test(picked[i])) {
                replaceAt = i;
                break;
            }
        }
        if (replaceAt < 0) return;
        picked[replaceAt] = src.offer;
        pool.splice(pool.indexOf(src), 1);
    }

    private _weaponOffer(track: WeaponTrack, cur: number, next: number, kind: 'weaponUpgrade' | 'newWeapon'): UpgradeOffer {
        const name = WEAPON_NAMES[track];
        return {
            kind,
            track,
            currentLevel: cur,
            nextLevel: next,
            title: cur === 0 ? `新武器：${name}` : `${name} Lv${next}`,
            detail: cur === 0 ? this._weaponDetail(track, 0, 1) : this._weaponDetail(track, cur, next),
        };
    }

    private _passiveOffer(
        track: PassiveTrack,
        cur: number,
        next: number,
        kind: 'passiveUpgrade' | 'newPassive'
    ): UpgradeOffer {
        const name = PASSIVE_NAMES[track];
        return {
            kind,
            track,
            currentLevel: cur,
            nextLevel: next,
            title: cur === 0 ? `新被动：${name}` : `${name} Lv${next}`,
            detail: this._passiveDetail(track, cur, next),
        };
    }

    private _weaponDetail(track: WeaponTrack, cur: number, next: number): string {
        const parts: string[] = [];
        if (track === 'knife') {
            const a = cur > 0 ? KNIFE_LEVELS[cur - 1] : null;
            const b = KNIFE_LEVELS[next - 1];
            if (!a || a.count !== b.count) parts.push(`数量 ${a ? a.count : 0} → ${b.count}`);
            if (!a || a.damage !== b.damage) parts.push(`伤害 ${a ? a.damage : 0} → ${b.damage}`);
            if (a && a.interval !== b.interval) parts.push(`间隔 ${a.interval} → ${b.interval}s`);
            if (a && a.pierce !== b.pierce) parts.push(`穿透 ${a.pierce} → ${b.pierce}`);
        } else if (track === 'orbit') {
            const a = cur > 0 ? ORBIT_LEVELS[cur - 1] : null;
            const b = ORBIT_LEVELS[next - 1];
            if (!a || a.count !== b.count) parts.push(`球数 ${a ? a.count : 0} → ${b.count}`);
            if (!a || a.damage !== b.damage) parts.push(`伤害 ${a ? a.damage : 0} → ${b.damage}`);
            if (a && a.radius !== b.radius) parts.push(`半径 ${a.radius} → ${b.radius}`);
        } else if (track === 'lightning') {
            const a = cur > 0 ? LIGHTNING_LEVELS[cur - 1] : null;
            const b = LIGHTNING_LEVELS[next - 1];
            if (!a || a.targets !== b.targets) parts.push(`目标 ${a ? a.targets : 0} → ${b.targets}`);
            if (!a || a.damage !== b.damage) parts.push(`伤害 ${a ? a.damage : 0} → ${b.damage}`);
            if (a && a.aoe !== b.aoe) parts.push(`范围 ${a.aoe} → ${b.aoe}`);
        } else if (track === 'boomerang') {
            const a = cur > 0 ? BOOMERANG_LEVELS[cur - 1] : null;
            const b = BOOMERANG_LEVELS[next - 1];
            if (!a || a.count !== b.count) parts.push(`数量 ${a ? a.count : 0} → ${b.count}`);
            if (!a || a.damage !== b.damage) parts.push(`伤害 ${a ? a.damage : 0} → ${b.damage}`);
            if (a && a.range !== b.range) parts.push(`距离 ${a.range} → ${b.range}`);
        }
        return parts.join(' · ');
    }

    private _passiveDetail(track: PassiveTrack, cur: number, next: number): string {
        if (track === 'haste') {
            return `攻击间隔 ÷${(1 + HASTE_PER_LEVEL * next).toFixed(2)}`;
        }
        if (track === 'swift') {
            const a = Math.round(PLAYER_SPEED * (1 + SWIFT_PER_LEVEL * cur));
            const b = Math.round(PLAYER_SPEED * (1 + SWIFT_PER_LEVEL * next));
            return `移速 ${a} → ${b}`;
        }
        if (track === 'pickup') {
            const a = Math.round(PLAYER_PICKUP * (1 + PICKUP_PER_LEVEL * cur));
            const b = Math.round(PLAYER_PICKUP * (1 + PICKUP_PER_LEVEL * next));
            return `拾取半径 ${a} → ${b}`;
        }
        const a = this._player.maxHp;
        const b = Math.round(a + VITALITY_PER_LEVEL * (next - cur));
        return `生命上限 ${Math.round(a)} → ${b}（并回复同等生命）`;
    }

    private _applyOffer(offer: UpgradeOffer): void {
        const p = this._player;
        switch (offer.kind) {
            case 'weaponUpgrade':
            case 'newWeapon':
                this._weapons[offer.track as WeaponTrack] = offer.nextLevel;
                break;
            case 'passiveUpgrade':
            case 'newPassive': {
                const track = offer.track as PassiveTrack;
                const before = this._passives[track] || 0;
                this._passives[track] = offer.nextLevel;
                if (track === 'vitality') {
                    const gain = VITALITY_PER_LEVEL * (offer.nextLevel - before);
                    p.maxHp += gain;
                    p.hp = Math.min(p.maxHp, p.hp + gain);
                } else if (track === 'swift') {
                    p.speed = PLAYER_SPEED * (1 + SWIFT_PER_LEVEL * offer.nextLevel);
                } else if (track === 'pickup') {
                    p.pickupRadius = PLAYER_PICKUP * (1 + PICKUP_PER_LEVEL * offer.nextLevel);
                }
                break;
            }
            case 'heal':
                p.hp = Math.min(p.maxHp, p.hp + Math.max(1, offer.nextLevel || 30));
                break;
            case 'temper':
                this._temper++;
                break;
        }
    }

    // ==================== 存档 ====================

    serialize(): RunSaveV1 {
        const p = this._player;
        const enemies: number[][] = [];
        let boss: number[] | null = null;
        for (let i = 0; i < this._enemies.length; i++) {
            const e = this._enemies[i];
            if (!e.active) continue;
            const compact = this._compactEnemy(e);
            if (e.kind === 'boss') boss = compact;
            else enemies.push(compact);
        }
        const bullets: number[][] = [];
        for (let i = 0; i < this._bullets.length; i++) {
            const b = this._bullets[i];
            if (!b.active) continue;
            const compact: number[] = [
                b.kind === 'knife' ? 0 : b.kind === 'boomerang' ? 1 : 2,
                b.fromPlayer ? 1 : 0,
                b.x,
                b.y,
                b.vx,
                b.vy,
                b.damage,
                b.radius,
                b.pierce,
                b.life,
                b.originX,
                b.originY,
                b.traveled,
                b.maxDistance,
                b.returning ? 1 : 0,
            ];
            for (let k = 0; k < b.hitUids.length; k++) compact.push(b.hitUids[k]);
            bullets.push(compact);
        }
        const gems: number[][] = [];
        for (let i = 0; i < this._gems.length; i++) {
            const g = this._gems[i];
            if (!g.active) continue;
            gems.push([g.x, g.y, g.value, g.magnet ? 1 : 0]);
        }

        return {
            v: SAVE_VERSION,
            savedAt: Date.now(),
            seed: this._seed,
            rngState: this._rng.state,
            time: this._time,
            phase: this._phase,
            kills: this._kills,
            player: {
                x: p.x,
                y: p.y,
                hp: p.hp,
                maxHp: p.maxHp,
                speed: p.speed,
                pickupRadius: p.pickupRadius,
                iframe: p.iframe,
                facing: p.facing,
                level: p.level,
                xp: p.xp,
                xpNeed: p.xpNeed,
            },
            weapons: Object.assign({}, this._weapons),
            passives: Object.assign({}, this._passives),
            temper: this._temper,
            timers: {
                spawnAcc: this._spawnAcc,
                nextEliteIndex: this._nextEliteIndex,
                nextWaveTime: this._nextWaveTime,
                bossSpawned: this._bossSpawned,
                bossEnrage: this._bossEnrage,
            },
            enemies,
            bullets,
            gems,
            boss,
            offers: this._offers.map((o) => Object.assign({}, o)),
        };
    }

    private _compactEnemy(e: EnemyState): number[] {
        return [
            KIND_INDEX[e.kind],
            e.x,
            e.y,
            e.hp,
            e.maxHp,
            e.speed,
            e.radius,
            e.damage,
            e.xp,
            e.elite ? 1 : 0,
            e.uid,
            e.phase,
            e.shootTimer,
        ];
    }

    restore(save: RunSaveV1): boolean {
        if (!save || save.v !== SAVE_VERSION) return false;
        if (!this._validateSave(save)) return false;

        this._seed = save.seed >>> 0;
        this._rng = new Rng(save.rngState >>> 0);
        this._time = save.time;
        this._kills = save.kills;
        this._phase = save.phase === 'paused' ? 'running' : (save.phase as Phase);
        this._temper = save.temper;

        const p = this._player;
        p.x = save.player.x;
        p.y = save.player.y;
        p.hp = save.player.hp;
        p.maxHp = save.player.maxHp;
        p.speed = save.player.speed;
        p.pickupRadius = save.player.pickupRadius;
        p.iframe = save.player.iframe;
        p.facing = save.player.facing;
        p.level = save.player.level;
        p.xp = save.player.xp;
        p.xpNeed = save.player.xpNeed;

        this._weapons = {};
        for (const k in save.weapons) this._weapons[k as WeaponTrack] = save.weapons[k];
        this._passives = {};
        for (const k in save.passives) this._passives[k as PassiveTrack] = save.passives[k];

        this._spawnAcc = save.timers.spawnAcc;
        this._nextEliteIndex = save.timers.nextEliteIndex;
        this._nextWaveTime = save.timers.nextWaveTime;
        this._bossSpawned = !!save.timers.bossSpawned;
        this._bossEnrage = !!save.timers.bossEnrage;
        this._waveWarned = this._time >= this._nextWaveTime - WAVE_WARN;

        for (let i = 0; i < this._enemies.length; i++) this._enemies[i].active = false;
        for (let i = 0; i < this._bullets.length; i++) this._bullets[i].active = false;
        for (let i = 0; i < this._gems.length; i++) this._gems[i].active = false;
        this._enemyActive = 0;
        this._bossIndex = -1;
        this._uidCounter = 1;

        for (let i = 0; i < save.enemies.length; i++) {
            this._restoreEnemy(save.enemies[i]);
        }
        if (save.boss) this._restoreEnemy(save.boss);

        for (let i = 0; i < save.bullets.length; i++) {
            this._restoreBullet(save.bullets[i]);
        }
        for (let i = 0; i < save.gems.length; i++) {
            const g = this._gems[i];
            const c = save.gems[i];
            g.active = true;
            g.x = c[0];
            g.y = c[1];
            g.value = c[2];
            g.magnet = c[3] === 1;
        }

        this._offers = save.offers.map((o) => Object.assign({}, o));
        this._firstOfferDone = true;
        this._events.length = 0;
        this._knifeCd = 0;
        this._lightningCd = 0;
        this._boomerangCd = 0;
        return true;
    }

    private _restoreEnemy(c: number[]): void {
        let slot: EnemyState | null = null;
        for (let i = 0; i < this._enemies.length; i++) {
            if (!this._enemies[i].active) {
                slot = this._enemies[i];
                break;
            }
        }
        if (!slot) return;
        const kind = ENEMY_KIND_ORDER[c[0]] || 'chaser';
        slot.active = true;
        slot.kind = kind;
        slot.x = c[1];
        slot.y = c[2];
        slot.hp = c[3];
        slot.maxHp = c[4];
        slot.speed = c[5];
        slot.radius = c[6];
        slot.damage = c[7];
        slot.xp = c[8];
        slot.elite = c[9] === 1;
        slot.uid = c[10];
        slot.phase = c[11];
        slot.shootTimer = c[12];
        slot.volleyTimer = BOSS_VOLLEY_INTERVAL;
        slot.summonTimer = BOSS_SUMMON_INTERVAL;
        slot.hitCooldown = 0;
        slot.flash = 0;
        slot.orbitCd[0] = 0;
        slot.orbitCd[1] = 0;
        slot.orbitCd[2] = 0;
        slot.orbitCd[3] = 0;
        this._enemyActive++;
        if (slot.uid >= this._uidCounter) this._uidCounter = slot.uid + 1;
        if (kind === 'boss') this._bossIndex = this._enemies.indexOf(slot);
    }

    private _restoreBullet(c: number[]): void {
        const b = this._spawnBullet();
        if (!b) return;
        b.active = true;
        b.kind = c[0] === 0 ? 'knife' : c[0] === 1 ? 'boomerang' : 'enemy';
        b.fromPlayer = c[1] === 1;
        b.x = c[2];
        b.y = c[3];
        b.vx = c[4];
        b.vy = c[5];
        b.damage = c[6];
        b.radius = c[7];
        b.pierce = c[8];
        b.life = c[9];
        b.originX = c[10];
        b.originY = c[11];
        b.traveled = c[12];
        b.maxDistance = c[13];
        b.returning = c[14] === 1;
        b.hitUids.length = 0;
        for (let i = COMPACT_BULLET_BASE; i < c.length; i++) b.hitUids.push(c[i]);
    }

    private _validateSave(save: RunSaveV1): boolean {
        if (!isFiniteNumber(save.seed) || !isFiniteNumber(save.rngState)) return false;
        if (!isFiniteNumber(save.time) || save.time < 0 || save.time > 86400) return false;
        if (!isFiniteNumber(save.kills) || save.kills < 0) return false;
        if (save.phase !== 'running' && save.phase !== 'levelup' && save.phase !== 'paused' && save.phase !== 'victory' && save.phase !== 'defeat')
            return false;

        const p = save.player;
        if (!p) return false;
        const nums = [p.x, p.y, p.hp, p.maxHp, p.speed, p.pickupRadius, p.iframe, p.facing, p.level, p.xp, p.xpNeed];
        for (let i = 0; i < nums.length; i++) if (!isFiniteNumber(nums[i])) return false;
        if (Math.abs(p.x) > ARENA_HALF || Math.abs(p.y) > ARENA_HALF) return false;
        if (p.maxHp <= 0 || p.maxHp > 10000) return false;
        if (p.hp < 0 || p.hp > p.maxHp) return false;
        if (p.level < 1 || p.level > MAX_LEVEL) return false;
        if (p.xp < 0 || p.xpNeed <= 0) return false;

        if (!save.weapons || !save.passives) return false;
        let weaponCount = 0;
        for (const k in save.weapons) {
            const lv = save.weapons[k];
            if (WEAPON_TRACKS.indexOf(k as WeaponTrack) < 0) return false;
            if (!isFiniteNumber(lv) || lv < 1 || lv > MAX_TRACK_LEVEL) return false;
            weaponCount++;
        }
        if (weaponCount > WEAPON_SLOTS) return false;
        let passiveCount = 0;
        for (const k in save.passives) {
            const lv = save.passives[k];
            if (PASSIVE_TRACKS.indexOf(k as PassiveTrack) < 0) return false;
            if (!isFiniteNumber(lv) || lv < 1 || lv > MAX_TRACK_LEVEL) return false;
            passiveCount++;
        }
        if (passiveCount > PASSIVE_SLOTS) return false;
        if (!isFiniteNumber(save.temper) || save.temper < 0 || save.temper > 999) return false;

        const t = save.timers;
        if (!t) return false;
        if (![t.spawnAcc, t.nextEliteIndex, t.nextWaveTime].every(isFiniteNumber)) return false;
        if (t.spawnAcc < 0 || t.nextEliteIndex < 0 || t.nextEliteIndex > ELITE_TIMES.length) return false;

        if (!Array.isArray(save.enemies) || save.enemies.length > SAVE_MAX_ENEMIES) return false;
        for (let i = 0; i < save.enemies.length; i++) {
            if (!this._validCompactEnemy(save.enemies[i])) return false;
        }
        if (save.boss && !this._validCompactEnemy(save.boss)) return false;
        if (!Array.isArray(save.bullets) || save.bullets.length > SAVE_MAX_BULLETS) return false;
        for (let i = 0; i < save.bullets.length; i++) {
            const c = save.bullets[i];
            if (!Array.isArray(c) || c.length < COMPACT_BULLET_BASE) return false;
            for (let k = 0; k < COMPACT_BULLET_BASE; k++) if (!isFiniteNumber(c[k])) return false;
        }
        if (!Array.isArray(save.gems) || save.gems.length > SAVE_MAX_GEMS) return false;
        for (let i = 0; i < save.gems.length; i++) {
            const c = save.gems[i];
            if (!Array.isArray(c) || c.length !== COMPACT_GEM_LEN) return false;
            for (let k = 0; k < COMPACT_GEM_LEN; k++) if (!isFiniteNumber(c[k])) return false;
        }
        if (!Array.isArray(save.offers) || save.offers.length > OFFER_COUNT) return false;
        if (save.phase === 'levelup' && save.offers.length !== OFFER_COUNT) return false;
        for (let i = 0; i < save.offers.length; i++) {
            const o = save.offers[i];
            if (!o || typeof o.title !== 'string' || typeof o.kind !== 'string') return false;
        }
        return true;
    }

    private _validCompactEnemy(c: number[]): boolean {
        if (!Array.isArray(c) || c.length !== COMPACT_ENEMY_LEN) return false;
        for (let i = 0; i < COMPACT_ENEMY_LEN; i++) if (!isFiniteNumber(c[i])) return false;
        if (c[0] < 0 || c[0] >= ENEMY_KIND_ORDER.length) return false;
        if (c[3] < 0 || c[4] <= 0) return false;
        return true;
    }
}

// ==================== 内部池类型（与 Config 结构一致，便于 TS 收敛） ====================

interface BulletStatePool {
    active: boolean;
    fromPlayer: boolean;
    kind: 'knife' | 'boomerang' | 'enemy';
    x: number;
    y: number;
    vx: number;
    vy: number;
    damage: number;
    radius: number;
    pierce: number;
    life: number;
    originX: number;
    originY: number;
    traveled: number;
    maxDistance: number;
    returning: boolean;
    hitUids: number[];
}

interface GemStatePool {
    active: boolean;
    x: number;
    y: number;
    value: number;
    magnet: boolean;
}

/** 组合权重（避免在热路径里重复构造数组） */
function spawnWeightsSafe(t: number): number[] {
    if (t < 60) return WEIGHTS_EARLY;
    if (t < 120) return WEIGHTS_1;
    if (t < 240) return WEIGHTS_2;
    if (t < 360) return WEIGHTS_3;
    return WEIGHTS_4;
}

const WEIGHTS_EARLY = [100, 0, 0, 0];
const WEIGHTS_1 = [70, 30, 0, 0];
const WEIGHTS_2 = [50, 25, 25, 0];
const WEIGHTS_3 = [40, 25, 20, 15];
const WEIGHTS_4 = [35, 20, 20, 25];

// 主色表只用于渲染层；这里显式引用避免 tree-shaking 删掉配置导出
export const SURVIVOR_COLORS = COLORS;
