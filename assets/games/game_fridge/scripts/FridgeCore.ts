/**
 * 冰箱底下 — 纯逻辑核心（不 import 'cc'）。
 *
 * M1 范围：一间测试房、左摇杆移动、自动 / 拖动瞄准、眼泪弹、两种敌人（霉球 + 罐头兵）、
 * 受击无敌帧、一个道具（辣椒酱）。地图、宝箱、Boss、存档在 M2 起接入。
 *
 * 约束（规格 §15）：
 *  - 世界内部只有一个 mulberry32，调用顺序固定；同一 seed + 同一输入脚本逐位一致
 *  - 所有可变量必须夹取，禁止 NaN / Infinity 外泄（规格 §7.1 / §8.5）
 *  - 本文件不碰任何 Cocos 节点，自检脚本直接编译运行
 */

import {
    ARENA_MAX_X, ARENA_MAX_Y, ARENA_MIN_X, ARENA_MIN_Y,
    AUTO_AIM_RANGE, BOMB_DROP_CHANCE, BOMBS_MAX, BOSS_DEFS, BOSS_KIND_BY_FLOOR,
    BULLET_R, DOOR_HALF, ENEMY_BULLET_R, ENEMY_DEFS, FLOOR_ENEMIES,
    FIXED_DT, HEART_DROP_CHANCE, INVULN, ITEM_BY_ID, ITEMS, MAX_BULLETS, MAX_ENEMIES, MAX_HP, PICKUP_R, PLAYER_R,
    REROLL_COST, ROOM_COIN_MAX, ROOM_COIN_MIN,
    clamp, computeStats, CHAR_BY_ID, mulberry32,
} from './FridgeConfig';
import type {
    Bullet, CharDef, CoreEvent, Enemy, EnemyDef, FridgeSnapshot, ItemTag, Pickup, PlayerState, PlayerStats,
} from './FridgeConfig';
import {
    DIR_DELTA, generateFloor, oppositeDir,
} from './FridgeDungeon';
import type {
    Dir, FloorMap, RoomNode, RunSave,
} from './FridgeDungeon';
import { serializeFloorMap, floorMapFromSave } from './FridgeDungeon';

export { mulberry32 };
export type { RngFn } from './FridgeConfig';

/** 子弹飞行速度（规格 §7.1） */
const BULLET_SPEED = 420;
/** 敌人子弹默认速度 */
const ENEMY_BULLET_SPEED = 165;
/** 每帧最大推进的 dt（防止切后台回来瞬移） */
const MAX_DT = 0.05;
/** 敌人重生 / 波次间隔（M1 测试房无限刷怪） */
const WAVE_INTERVAL = 2.4;
/** 每波递增的敌人数上限 */
const WAVE_STEP = 5;

/** 输入帧：移动方向 0..1，瞄准方向 0..1，firing = 右半屏正在拖动 */
export interface FridgeInput {
    moveX: number;
    moveY: number;
    aimX: number;
    aimY: number;
    firing: boolean;
}

export const EMPTY_INPUT: FridgeInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, firing: false };

export class FridgeWorld {
    readonly seed: number;
    readonly charId: string;
    readonly char: CharDef;

    phase: 'playing' | 'dead' | 'won' = 'playing';
    time = 0;
    kills = 0;
    wave = 0;
    roomCleared = false;

    player: PlayerState;
    enemies: Enemy[] = [];
    bullets: Bullet[] = [];
    pickups: Pickup[] = [];
    items: string[] = [];
    cores: string[] = [];
    activeItem: string | null = null;

    /** 地牢状态（null = M1 沙盒测试房：无限刷怪，自检用） */
    map: FloorMap | null = null;
    floor = 1;
    roomId = -1;
    coins = 0;
    enteringFrom: Dir | null = null;
    /** 宝箱三选一待选（非 null 时世界冻结，等玩家在面板上选择） */
    pendingTreasure: { offered: string[]; rerolled: boolean } | null = null;

    runId: string;

    /** 浏览器探针 / 自检用 */
    _rng: ReturnType<typeof mulberry32>;
    _rngState = 0;
    _fireCd = 0;
    _waveTimer = 0;

    private _nextId = 1;
    private _events: CoreEvent[] = [];
    private _stats: PlayerStats;
    private _aimX = 0;
    private _aimY = -1;
    private _aimTargetId = -1;

    constructor(seed: number, charId = 'pudding') {
        this.seed = seed >>> 0;
        this.charId = charId;
        this.char = CHAR_BY_ID[charId] || CHAR_BY_ID.pudding;
        this._rng = mulberry32(this.seed);
        this.runId = `r${this.seed.toString(36)}${Date.now().toString(36)}`;
        this._stats = computeStats(charId, []);
        this.player = this._makePlayer(this._stats);
        this.items = [];
        // M1 沙盒：房间里放一个辣椒酱底座，走过即拾取；地牢模式会在 _enterDungeon 里清空
        this.pickups.push({ id: this._nextId++, kind: 'item', itemId: 'chili', x: 0, y: 110, bob: 0 });
        // 初始三只霉球
        for (let i = 0; i < 3; i++) this.spawnEnemy('moldball');
        this.wave = 1;
    }

    // ==================== 开局 / 续玩 ====================

    /** 地牢开局：生成第 1 层地图，落到起点房 */
    static newRun(seed: number, charId = 'pudding', floor = 1): FridgeWorld {
        const w = new FridgeWorld(seed, charId);
        w._enterDungeon(floor);
        return w;
    }

    /** 从快照恢复：地图 / 道具 / 金币按存档，当前房间实体重新生成（§13.2） */
    static fromSave(save: RunSave): FridgeWorld {
        const w = new FridgeWorld(save.seed, save.charId);
        const map = save.map ? floorMapFromSave(save.map, save.floor) : null;
        if (!map) return FridgeWorld.newRun(save.seed, save.charId, 1);

        w.map = map;
        w.floor = save.floor;
        w.roomId = clamp(save.roomId, 0, map.rooms.length - 1);
        w.enteringFrom = save.enteringFrom;
        w.runId = save.runId;
        w.items = save.items.filter((id) => !!ITEM_BY_ID[id]);
        w.cores = save.cores.slice();
        w.activeItem = save.activeItem && ITEM_BY_ID[save.activeItem] ? save.activeItem : null;
        w._recomputeStats();
        const p = save.player;
        w.player.maxHp = clamp(p.maxHp, 2, MAX_HP);
        w.player.hp = clamp(p.hp, 1, w.player.maxHp);
        w.player.maxCharges = clamp(p.maxCharges, 1, 9);
        w.player.charges = clamp(p.charges, 0, w.player.maxCharges);
        w.player.bombs = clamp(p.bombs, 0, BOMBS_MAX);
        w.player.frozenSpeedPenalty = clamp(p.frozenSpeedPenalty, 0, 0.4);
        w.coins = Math.max(0, Math.floor(p.coins));
        w._rng.setState(save.rngState);

        // 实体全部重建：只保留地图上的 cleared / visited
        w.enemies = [];
        w.bullets = [];
        w.pickups = [];
        w.time = 0;
        w.wave = 0;
        const room = w.rooms()[w.roomId];
        room.visited = true;
        if (!room.cleared) w._spawnRoomEnemies(room);
        if (room.kind === 'treasure' && !room.cleared) {
            w.pendingTreasure = save.treasure && save.treasure.offered.length === 3
                ? { offered: save.treasure.offered.slice(), rerolled: save.treasure.rerolled }
                : w._rollTreasure();
        }
        w.roomCleared = room.cleared;
        w._placeAtDoor(w.enteringFrom);
        return w;
    }

    private _enterDungeon(floor: number): void {
        this.floor = clamp(Math.round(floor), 1, 4);
        this.map = generateFloor(this.seed, this.floor);
        this.roomId = this.map.startId;
        const room = this.rooms()[this.roomId];
        room.visited = true;
        room.cleared = true;
        this.roomCleared = true;
        this.enemies = [];
        this.bullets = [];
        this.pickups = [];
        this.pendingTreasure = null;
        this.enteringFrom = null;
        this.player.x = 0;
        this.player.y = -40;
        this.player.vx = 0;
        this.player.vy = 0;
        this.wave = 0;
        this.time = 0;
        this.kills = 0;
        this.coins = 0;
    }

    // ==================== 对外 API ====================

    step(dt: number, input: FridgeInput): void {
        if (this.phase !== 'playing') return;
        if (this.pendingTreasure) return; // 宝箱面板打开时冻结
        const step = Math.min(Math.max(dt, 0), MAX_DT);
        this.time += step;

        this._updatePlayer(step, input);
        this._updateFiring(step, input);
        this._updateBullets(step);
        this._updateEnemies(step);
        this._updatePickups(step);
        this._updateWaves(step);

        // _damagePlayer 已即时切死；这里兜底（例如外部直接改 hp 的自检路径）
        if (this.phase === 'playing' && this.player.hp <= 0) {
            this.player.hp = 0;
            this.phase = 'dead';
            this._events.push({ type: 'dead' });
        }
    }

    /** 只读快照（渲染 / HUD 不得修改其中对象） */
    snapshot(): FridgeSnapshot {
        const room = this.currentRoom();
        return {
            phase: this.phase,
            roomCleared: this.roomCleared,
            time: this.time,
            kills: this.kills,
            wave: this.wave,
            player: this.player,
            enemies: this.enemies,
            bullets: this.bullets,
            pickups: this.pickups,
            items: this.items,
            cores: this.cores,
            activeItem: this.activeItem,
            aimTargetId: this._aimTargetId,
            aimX: this._aimX,
            aimY: this._aimY,
            floor: this.floor,
            coins: this.coins,
            roomId: this.roomId,
            roomKind: room ? room.kind : null,
            doors: room ? room.doors.slice() : [],
            locked: this.isRoomLocked(),
            map: this.map,
            pendingTreasure: this.pendingTreasure,
        };
    }

    drainEvents(): CoreEvent[] {
        const out = this._events;
        this._events = [];
        return out;
    }

    /** 当前房间（沙盒模式返回 null） */
    rooms(): RoomNode[] {
        return this.map ? this.map.rooms : [];
    }

    currentRoom(): RoomNode | null {
        if (!this.map) return null;
        return this.map.rooms[this.roomId] || null;
    }

    /** 战斗 / Boss 房未清空 → 锁门 */
    isRoomLocked(): boolean {
        const room = this.currentRoom();
        if (!room) return false;
        return (room.kind === 'fight' || room.kind === 'boss') && !room.cleared;
    }

    /** 走进一扇门；锁门 / 没有这扇门时返回 false（规格 §15.1 第 16 条） */
    enterDoor(dir: Dir): boolean {
        if (!this.map || this.phase !== 'playing') return false;
        const room = this.currentRoom();
        if (!room || room.doors.indexOf(dir) < 0) return false;
        if (this.isRoomLocked()) return false;
        const nx = room.x + DIR_DELTA[dir].x;
        const ny = room.y + DIR_DELTA[dir].y;
        let target: RoomNode | null = null;
        for (const r of this.map.rooms) {
            if (r.x === nx && r.y === ny) {
                target = r;
                break;
            }
        }
        if (!target) return false;
        this._changeRoom(target.id, oppositeDir(dir));
        return true;
    }

    /** 宝箱三选一：index 越界 / 没有待选宝箱时返回 false */
    takeTreasure(index: number): boolean {
        if (!this.pendingTreasure) return false;
        const offered = this.pendingTreasure.offered;
        if (!Number.isInteger(index) || index < 0 || index >= offered.length) return false;
        const id = offered[index];
        this.pendingTreasure = null;
        this.addItem(id);
        const room = this.currentRoom();
        if (room && room.kind === 'treasure') room.cleared = true;
        this.roomCleared = true;
        this._events.push({ type: 'pickup', x: this.player.x, y: this.player.y, itemId: id });
        return true;
    }

    /** 花 2 金币重掷宝箱（§6.3 宝箱房） */
    rerollTreasure(): boolean {
        if (!this.pendingTreasure || this.pendingTreasure.rerolled) return false;
        if (this.coins < REROLL_COST) return false;
        this.coins -= REROLL_COST;
        this.pendingTreasure = Object.assign(this._rollTreasure(), { rerolled: true });
        return true;
    }

    /** 拾取道具（宝箱 / 商店 / 底座共用） */
    addItem(itemId: string): boolean {
        const def = ITEM_BY_ID[itemId];
        if (!def) return false;
        const oldMax = this.player.maxHp;
        this.items.push(itemId);
        this._recomputeStats();
        if (def.active) {
            this.activeItem = itemId;
            this.player.charges = 0;
        }
        // 提升生命上限时同步补当前血量
        if (this.player.maxHp > oldMax) this.player.hp = Math.min(this.player.maxHp, this.player.hp + (this.player.maxHp - oldMax));
        return true;
    }

    /** 调试 / 自检：直接刷一只敌人（位置随机但确定性） */
    spawnEnemy(kind: string, x?: number, y?: number): Enemy | null {
        if (this.enemies.length >= MAX_ENEMIES) return null;
        const bossDef = BOSS_DEFS[this.floor];
        const def = ENEMY_DEFS[kind] || (bossDef && bossDef.kind === kind ? bossDef : undefined);
        if (!def) return null;
        const pos = x === undefined || y === undefined ? this._randomSpawnPos() : { x, y };
        const e: Enemy = {
            id: this._nextId++,
            kind,
            x: pos.x,
            y: pos.y,
            hp: def.hp,
            maxHp: def.hp,
            r: def.r,
            speed: def.speed,
            dmg: def.dmg,
            vx: 0,
            vy: 0,
            timer: this._rng() * 0.5,
            hitFlash: 0,
            gen: 0,
            atk: 0,
            windup: 0,
            dashT: 0,
        };
        this.enemies.push(e);
        return e;
    }

    /** 给自检脚本用：直接推进 N 秒，返回 true 表示还活着 */
    simulate(seconds: number, input: FridgeInput = EMPTY_INPUT): boolean {
        const steps = Math.max(1, Math.round(seconds / FIXED_DT));
        for (let i = 0; i < steps && this.phase === 'playing'; i++) this.step(FIXED_DT, input);
        return this.phase === 'playing';
    }

    // ==================== 地牢：换房 / 清房 / 宝箱 ====================

    private _changeRoom(id: number, from: Dir | null): void {
        if (!this.map) return;
        this.roomId = clamp(id, 0, this.map.rooms.length - 1);
        this.enteringFrom = from;
        const room = this.map.rooms[this.roomId];
        room.visited = true;
        this.enemies = [];
        this.bullets = [];
        this.pickups = [];
        this.pendingTreasure = null;
        this._fireCd = 0;
        this.roomCleared = room.cleared;
        this._placeAtDoor(from);
        if (!room.cleared) {
            if (room.kind === 'treasure') {
                this.pendingTreasure = this._rollTreasure();
                this._events.push({ type: 'treasure', roomId: room.id });
            } else {
                this._spawnRoomEnemies(room);
                this.wave = 1;
            }
        }
        this._events.push({ type: 'room', id: room.id, kind: room.kind });
    }

    private _placeAtDoor(from: Dir | null): void {
        const p = this.player;
        const inset = PLAYER_R + 26;
        if (from === 'up') {
            p.x = 0;
            p.y = ARENA_MAX_Y - inset;
        } else if (from === 'left') {
            p.x = ARENA_MIN_X + inset;
            p.y = 0;
        } else if (from === 'right') {
            p.x = ARENA_MAX_X - inset;
            p.y = 0;
        } else {
            p.x = 0;
            p.y = ARENA_MIN_Y + inset;
        }
        p.vx = 0;
        p.vy = 0;
        p.invuln = Math.max(p.invuln, 0.4);
    }

    /** 按层 / 深度刷本房敌人（数量 4–9，§9.3） */
    private _spawnRoomEnemies(room: RoomNode): void {
        if (room.kind === 'boss') {
            const kind = BOSS_KIND_BY_FLOOR[this.floor] || 'moldking';
            this.spawnEnemy(kind, 0, ARENA_MAX_Y - 110);
            this.spawnEnemy('moldball', -110, ARENA_MAX_Y - 90);
            this.spawnEnemy('moldball', 110, ARENA_MAX_Y - 90);
            return;
        }
        if (room.kind !== 'fight') return;
        const pool = FLOOR_ENEMIES[this.floor] || FLOOR_ENEMIES[1];
        const count = clamp(3 + Math.max(1, room.depth), 4, 9);
        for (let i = 0; i < count; i++) {
            this.spawnEnemy(pool[Math.floor(this._rng() * pool.length)]);
        }
    }

    /** 最后一个敌人倒下：开门、+1 充能、掉落、写档事件 */
    private _clearRoom(room: RoomNode): void {
        if (room.cleared) return;
        room.cleared = true;
        this.roomCleared = true;
        this.player.charges = Math.min(this.player.maxCharges, this.player.charges + 1);
        this.wave = 0;

        // 清房掉落（§12）：2–4 币 + 30% 半心 + 15% 炸弹
        const coinCount = ROOM_COIN_MIN + Math.floor(this._rng() * (ROOM_COIN_MAX - ROOM_COIN_MIN + 1));
        for (let i = 0; i < coinCount; i++) {
            this.pickups.push({
                id: this._nextId++, kind: 'coin',
                x: -60 + i * 30, y: -60 + this._rng() * 30, bob: this._rng() * 6,
            });
        }
        if (this._rng() < HEART_DROP_CHANCE) {
            this.pickups.push({ id: this._nextId++, kind: 'heart', x: 40, y: 20, bob: 0 });
        }
        if (this._rng() < BOMB_DROP_CHANCE) {
            this.pickups.push({ id: this._nextId++, kind: 'bomb', x: -40, y: 30, bob: 0 });
        }
        this._events.push({ type: 'clear', roomId: room.id });
        if (room.kind === 'boss') {
            // M2 只到第 1 层：击破 Boss = 通关第 1 层（核心三选一在 M4 接入）
            this.phase = 'won';
            this._events.push({ type: 'won' });
        }
    }

    private _rollTreasure(): { offered: string[]; rerolled: boolean } {
        const pool: string[] = [];
        for (const it of ITEMS) {
            if (it.floor === 0 || it.floor === this.floor) {
                if (this._countItem(it.id) < 3) pool.push(it.id);
            }
        }
        const offered: string[] = [];
        let guard = 0;
        while (offered.length < 3 && pool.length > 0 && guard++ < 60) {
            const id = pool[Math.floor(this._rng() * pool.length)];
            if (offered.indexOf(id) < 0) offered.push(id);
        }
        while (offered.length < 3) offered.push('sugar');
        return { offered, rerolled: false };
    }

    private _countItem(id: string): number {
        let n = 0;
        for (const it of this.items) if (it === id) n++;
        return n;
    }

    /** 玩家贴到墙边且对着门洞 → 自动进入下一间 */
    private _checkDoorEntry(): void {
        const p = this.player;
        const eps = 0.75;
        if (p.y >= ARENA_MAX_Y - PLAYER_R - eps && Math.abs(p.x) <= DOOR_HALF) {
            this.enterDoor('up');
        } else if (p.y <= ARENA_MIN_Y + PLAYER_R + eps && Math.abs(p.x) <= DOOR_HALF) {
            this.enterDoor('down');
        } else if (p.x <= ARENA_MIN_X + PLAYER_R + eps && Math.abs(p.y) <= DOOR_HALF) {
            this.enterDoor('left');
        } else if (p.x >= ARENA_MAX_X - PLAYER_R - eps && Math.abs(p.y) <= DOOR_HALF) {
            this.enterDoor('right');
        }
    }

    // ==================== 存档快照（§13.2 / §14.1） ====================

    toSave(): RunSave {
        return {
            schemaVersion: 2,
            runId: this.runId,
            mode: 'normal',
            seed: this.seed,
            rngState: this._rng.getState(),
            charId: this.charId,
            floor: clamp(this.floor, 1, 4) as 1 | 2 | 3 | 4,
            startFloor: 1,
            heatCurses: [],
            map: serializeFloorMap(this.map),
            roomId: this.roomId,
            enteringFrom: this.enteringFrom,
            player: {
                hp: this.player.hp,
                maxHp: this.player.maxHp,
                coins: this.coins,
                bombs: this.player.bombs,
                charges: this.player.charges,
                maxCharges: this.player.maxCharges,
                frozenSpeedPenalty: this.player.frozenSpeedPenalty,
            },
            items: this.items.slice(),
            activeItem: this.activeItem,
            cores: this.cores.slice(),
            treasure: this.pendingTreasure
                ? { offered: this.pendingTreasure.offered.slice(), rerolled: this.pendingTreasure.rerolled }
                : null,
            shop: null,
            savedAt: Date.now(),
            gameVersion: 'm2',
        };
    }

    // ==================== 玩家 ====================

    private _makePlayer(stats: PlayerStats): PlayerState {
        return {
            hp: stats.hp,
            maxHp: stats.maxHp,
            dmg: stats.dmg,
            rate: stats.rate,
            shots: stats.shots,
            range: stats.range,
            speed: stats.speed,
            luck: stats.luck,
            maxCharges: stats.maxCharges,
            x: 0,
            y: -40,
            vx: 0,
            vy: 0,
            invuln: 0,
            shield: 0,
            bombs: 1,
            charges: 0,
            frozenSpeedPenalty: 0,
            facingX: 0,
            facingY: 1,
        };
    }

    private _recomputeStats(): void {
        const stats = computeStats(this.charId, this.items);
        const p = this.player;
        p.dmg = stats.dmg;
        p.rate = stats.rate;
        p.shots = stats.shots;
        p.range = stats.range;
        p.speed = stats.speed;
        p.luck = stats.luck;
        p.maxCharges = stats.maxCharges;
        p.maxHp = stats.maxHp;
        p.hp = clamp(p.hp, 1, p.maxHp);
        this._stats = stats;
    }

    get stats(): PlayerStats {
        return this._stats;
    }

    private _updatePlayer(dt: number, input: FridgeInput): void {
        const p = this.player;
        let mx = input.moveX;
        let my = input.moveY;
        const len = Math.hypot(mx, my);
        if (len > 1) {
            mx /= len;
            my /= len;
        }
        const slow = clamp(1 - p.frozenSpeedPenalty, 0.4, 1);
        p.vx = mx * p.speed * slow;
        p.vy = my * p.speed * slow;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.x = clamp(p.x, ARENA_MIN_X + PLAYER_R, ARENA_MAX_X - PLAYER_R);
        p.y = clamp(p.y, ARENA_MIN_Y + PLAYER_R, ARENA_MAX_Y - PLAYER_R);
        if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);

        if (len > 0.1) {
            p.facingX = mx / (len || 1);
            p.facingY = my / (len || 1);
        }
        // 贴到门洞边缘 → 自动进下一间（地牢模式）
        if (this.map) this._checkDoorEntry();
    }

    // ==================== 瞄准与开火 ====================

    private _updateFiring(dt: number, input: FridgeInput): void {
        const p = this.player;
        let ax = 0;
        let ay = 0;
        if (input.firing && (input.aimX !== 0 || input.aimY !== 0)) {
            const len = Math.hypot(input.aimX, input.aimY) || 1;
            ax = input.aimX / len;
            ay = input.aimY / len;
            this._aimTargetId = -1;
        } else {
            const target = this._nearestEnemy(AUTO_AIM_RANGE);
            if (target) {
                const dx = target.x - p.x;
                const dy = target.y - p.y;
                const len = Math.hypot(dx, dy) || 1;
                ax = dx / len;
                ay = dy / len;
                this._aimTargetId = target.id;
            } else {
                ax = p.facingX;
                ay = p.facingY;
                this._aimTargetId = -1;
            }
        }
        this._aimX = ax;
        this._aimY = ay;
        if (ax !== 0 || ay !== 0) {
            p.facingX = ax;
            p.facingY = ay;
        }

        this._fireCd -= dt;
        if (this._fireCd > 0) return;
        this._fireCd = 1 / Math.max(0.1, p.rate);
        this._shoot(ax, ay);
    }

    private _nearestEnemy(maxDist: number): Enemy | null {
        const p = this.player;
        let best: Enemy | null = null;
        let bestD = maxDist * maxDist;
        for (const e of this.enemies) {
            if (e.hp <= 0) continue;
            const dx = e.x - p.x;
            const dy = e.y - p.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    private _shoot(ax: number, ay: number): void {
        const p = this.player;
        const count = Math.round(clamp(p.shots, 1, 5));
        const spread = 0.14; // 每发之间约 8°
        const base = Math.atan2(ay, ax);
        for (let i = 0; i < count; i++) {
            const offset = count === 1 ? 0 : (i - (count - 1) / 2) * spread;
            const a = base + offset;
            this._pushBullet({
                id: this._nextId++,
                owner: 'player',
                x: p.x + Math.cos(a) * 18,
                y: p.y + Math.sin(a) * 18,
                vx: Math.cos(a) * BULLET_SPEED,
                vy: Math.sin(a) * BULLET_SPEED,
                r: BULLET_R,
                dmg: p.dmg,
                life: p.range / BULLET_SPEED,
                pierce: this.hasTag('pierce') ? 1 : 0,
                bounces: this.hasTag('bounce') ? 1 : 0,
                hitIds: [],
            });
        }
        this._events.push({ type: 'shoot', x: p.x, y: p.y });
    }

    private _pushBullet(b: Bullet): void {
        if (this.bullets.length >= MAX_BULLETS) return;
        this.bullets.push(b);
    }

    hasTag(tag: ItemTag): boolean {
        for (const id of this.items) {
            const it = ITEM_BY_ID[id];
            if (it && it.tags.indexOf(tag) >= 0) return true;
        }
        return false;
    }

    // ==================== 子弹 ====================

    private _updateBullets(dt: number): void {
        const out: Bullet[] = [];
        for (const b of this.bullets) {
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.life -= dt;

            // 墙
            if (b.x < ARENA_MIN_X || b.x > ARENA_MAX_X) {
                if (b.bounces > 0) {
                    b.bounces--;
                    b.vx = -b.vx;
                    b.x = clamp(b.x, ARENA_MIN_X, ARENA_MAX_X);
                } else {
                    continue;
                }
            }
            if (b.y < ARENA_MIN_Y || b.y > ARENA_MAX_Y) {
                if (b.bounces > 0) {
                    b.bounces--;
                    b.vy = -b.vy;
                    b.y = clamp(b.y, ARENA_MIN_Y, ARENA_MAX_Y);
                } else {
                    continue;
                }
            }
            if (b.life <= 0) continue;

            if (b.owner === 'player') {
                let dead = false;
                for (const e of this.enemies) {
                    if (e.hp <= 0) continue;
                    if (b.hitIds.indexOf(e.id) >= 0) continue;
                    const rr = e.r + b.r;
                    if ((e.x - b.x) * (e.x - b.x) + (e.y - b.y) * (e.y - b.y) <= rr * rr) {
                        this._damageEnemy(e, b.dmg);
                        b.hitIds.push(e.id);
                        if (b.pierce > 0) {
                            b.pierce--;
                        } else {
                            dead = true;
                        }
                        break;
                    }
                }
                if (dead) continue;
            } else {
                const p = this.player;
                const rr = pRadius() + b.r;
                if ((p.x - b.x) * (p.x - b.x) + (p.y - b.y) * (p.y - b.y) <= rr * rr) {
                    this._damagePlayer(b.dmg);
                    continue;
                }
            }
            out.push(b);
        }
        this.bullets = out;
    }

    private _damageEnemy(e: Enemy, dmg: number): void {
        if (e.hp <= 0) return;
        e.hp -= dmg;
        e.hitFlash = 0.12;
        this._events.push({ type: 'hit', x: e.x, y: e.y });
        if (e.hp <= 0) {
            e.hp = 0;
            this.kills++;
            this._events.push({ type: 'kill', x: e.x, y: e.y, kind: e.kind });
            if (this._rng() < 0.35) {
                this.pickups.push({ id: this._nextId++, kind: 'coin', x: e.x, y: e.y, bob: this._rng() * 6 });
            }
        }
    }

    // ==================== 敌人 ====================

    private _updateEnemies(dt: number): void {
        const p = this.player;
        const out: Enemy[] = [];
        for (const e of this.enemies) {
            if (e.hp <= 0) continue;
            if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);
            const def = ENEMY_DEFS[e.kind] || BOSS_DEFS[this.floor] || ENEMY_DEFS.moldball;
            const dx = p.x - e.x;
            const dy = p.y - e.y;
            const dist = Math.hypot(dx, dy) || 1;
            const nx = dx / dist;
            const ny = dy / dist;
            e.timer += dt;

            if (e.kind === 'moldking') {
                this._updateBoss(e, dt, nx, ny, dist);
            } else switch (def.ai) {
                case 'chase': {
                    const stop = def.ranged ? 150 : 0;
                    if (dist > stop) {
                        e.x += nx * e.speed * dt;
                        e.y += ny * e.speed * dt;
                    }
                    if (def.ranged && def.fireCd && e.timer >= def.fireCd) {
                        e.timer = 0;
                        this._enemyShoot(e, nx, ny, def);
                    }
                    break;
                }
                case 'drift': {
                    if (e.vx === 0 && e.vy === 0) {
                        e.vx = nx * e.speed;
                        e.vy = ny * e.speed;
                    }
                    e.x += e.vx * dt;
                    e.y += e.vy * dt;
                    if (e.x < ARENA_MIN_X + e.r || e.x > ARENA_MAX_X - e.r) {
                        e.vx = -e.vx;
                        e.x = clamp(e.x, ARENA_MIN_X + e.r, ARENA_MAX_X - e.r);
                    }
                    if (e.y < ARENA_MIN_Y + e.r || e.y > ARENA_MAX_Y - e.r) {
                        e.vy = -e.vy;
                        e.y = clamp(e.y, ARENA_MIN_Y + e.r, ARENA_MAX_Y - e.r);
                    }
                    if (def.ranged && def.fireCd && e.timer >= def.fireCd) {
                        e.timer = 0;
                        this._enemyShoot(e, nx, ny, def);
                    }
                    break;
                }
                case 'turret': {
                    if (def.fireCd && e.timer >= def.fireCd) {
                        e.timer = 0;
                        this._enemyShoot(e, nx, ny, def);
                    }
                    break;
                }
                case 'dash': {
                    // 1.0s 蓄力 → 0.45s 冲刺，循环
                    const phaseT = e.timer % 1.45;
                    if (phaseT < 0.45) {
                        e.x += nx * e.speed * 2.6 * dt;
                        e.y += ny * e.speed * 2.6 * dt;
                    } else if (phaseT - dt < 0.45) {
                        // 冲刺方向在每次蓄力结束时刷新
                        e.vx = nx;
                        e.vy = ny;
                    } else {
                        e.x += nx * e.speed * 0.2 * dt;
                        e.y += ny * e.speed * 0.2 * dt;
                    }
                    break;
                }
                case 'phase': {
                    if (e.timer >= 3) {
                        e.timer = 0;
                        const pos = this._randomSpawnPos();
                        e.x = pos.x;
                        e.y = pos.y;
                    } else {
                        e.x += nx * e.speed * dt;
                        e.y += ny * e.speed * dt;
                    }
                    break;
                }
                default:
                    break;
            }

            e.x = clamp(e.x, ARENA_MIN_X + e.r, ARENA_MAX_X - e.r);
            e.y = clamp(e.y, ARENA_MIN_Y + e.r, ARENA_MAX_Y - e.r);
            // 接触伤害
            const rr = e.r + PLAYER_R;
            if ((p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y) <= rr * rr) {
                this._damagePlayer(e.dmg);
                // 轻微击退，避免贴脸时被连续判定
                p.x = clamp(p.x + nx * 8, ARENA_MIN_X + PLAYER_R, ARENA_MAX_X - PLAYER_R);
                p.y = clamp(p.y + ny * 8, ARENA_MIN_Y + PLAYER_R, ARENA_MAX_Y - PLAYER_R);
            }

            out.push(e);
        }
        this.enemies = out;

        // 战斗 / Boss 房清空 → 开门（沙盒模式不判清房）
        if (this.map) {
            const room = this.currentRoom();
            if (room && !room.cleared && (room.kind === 'fight' || room.kind === 'boss') && this.enemies.length === 0) {
                this._clearRoom(room);
            }
        }
    }

    /**
     * Boss「霉王」：一阶段三向孢子 + 召唤霉球；半血后二阶段改冲刺 + 弧形孢弹（§9.2）。
     * 全部攻击有 ≥0.4s 前摇，弹幕角度确定性（不依赖随机）。
     */
    private _updateBoss(e: Enemy, dt: number, nx: number, ny: number, dist: number): void {
        const def = BOSS_DEFS[this.floor] || BOSS_DEFS[1];
        const phase2 = e.hp <= e.maxHp * 0.5;
        e.gen = phase2 ? 2 : 1;
        e.atk += dt;

        // 冲刺：0.4s 前摇 → 0.5s 直线冲刺
        if (e.windup > 0) {
            e.windup -= dt;
            if (e.windup <= 0) {
                e.windup = 0;
                e.dashT = 0.5;
                e.vx = nx * 300;
                e.vy = ny * 300;
            }
            return;
        }
        if (e.dashT > 0) {
            e.dashT = Math.max(0, e.dashT - dt);
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            return;
        }

        // 走位：保持 150–260px 距离
        if (dist > 260) {
            e.x += nx * def.speed * dt;
            e.y += ny * def.speed * dt;
        } else if (dist < 150) {
            e.x -= nx * def.speed * 0.7 * dt;
            e.y -= ny * def.speed * 0.7 * dt;
        }

        if (!phase2) {
            // 一阶段：每 1.8s 三向孢子；每 7s 召唤 2 只霉球
            if (e.atk >= 1.8) {
                e.atk = 0;
                this._bossSpores(e, nx, ny, 3, 0.38, 165);
            }
            if (e.timer >= 7) {
                e.timer = 0;
                if (this.enemies.length + 2 <= MAX_ENEMIES) {
                    this.spawnEnemy('moldball');
                    this.spawnEnemy('moldball');
                }
            }
        } else {
            // 二阶段：每 1.3s 五向弧形孢弹；每 4.5s 一次冲刺（带 0.4s 前摇）
            if (e.atk >= 1.3) {
                e.atk = 0;
                this._bossSpores(e, nx, ny, 5, 0.3, 190);
            }
            if (e.timer >= 4.5) {
                e.timer = 0;
                e.windup = 0.4;
            }
        }
    }

    private _bossSpores(e: Enemy, nx: number, ny: number, count: number, spread: number, speed: number): void {
        const base = Math.atan2(ny, nx);
        for (let i = 0; i < count; i++) {
            const offset = (i - (count - 1) / 2) * spread;
            const a = base + offset;
            this._pushBullet({
                id: this._nextId++,
                owner: 'enemy',
                x: e.x + Math.cos(a) * (e.r + 4),
                y: e.y + Math.sin(a) * (e.r + 4),
                vx: Math.cos(a) * speed,
                vy: Math.sin(a) * speed,
                r: ENEMY_BULLET_R,
                dmg: e.dmg,
                life: 5,
                pierce: 0,
                bounces: 0,
                hitIds: [],
            });
        }
    }

    private _enemyShoot(e: Enemy, nx: number, ny: number, def: EnemyDef): void {
        const speed = def.bulletSpeed || ENEMY_BULLET_SPEED;
        this._pushBullet({
            id: this._nextId++,
            owner: 'enemy',
            x: e.x + nx * (e.r + 4),
            y: e.y + ny * (e.r + 4),
            vx: nx * speed,
            vy: ny * speed,
            r: ENEMY_BULLET_R,
            dmg: e.dmg,
            life: 4,
            pierce: 0,
            bounces: 0,
            hitIds: [],
        });
    }

    private _damagePlayer(dmg: number): void {
        const p = this.player;
        if (p.invuln > 0 || this.phase !== 'playing') return;
        // 护盾优先（M1 只有核心 / 道具会加盾）
        if (p.shield > 0) {
            p.shield--;
            p.invuln = INVULN;
            this._events.push({ type: 'playerHit', x: p.x, y: p.y });
            return;
        }
        p.hp = Math.max(0, p.hp - dmg);
        p.invuln = INVULN;
        // 冰块特色：每次受伤移速惩罚（规格 §10.1），其他角色不累积
        if (this.charId === 'icecube') p.frozenSpeedPenalty = Math.min(0.4, p.frozenSpeedPenalty + 0.08);
        this._events.push({ type: 'playerHit', x: p.x, y: p.y });
        if (p.hp <= 0) {
            this.phase = 'dead';
            this._events.push({ type: 'dead' });
        }
    }

    // ==================== 拾取与波次 ====================

    private _updatePickups(dt: number): void {
        const p = this.player;
        const out: Pickup[] = [];
        for (const it of this.pickups) {
            it.bob += dt;
            const dx = p.x - it.x;
            const dy = p.y - it.y;
            const rr = PICKUP_R + PLAYER_R;
            if (dx * dx + dy * dy <= rr * rr) {
                if (it.kind === 'item' && it.itemId) {
                    this.addItem(it.itemId);
                    this._events.push({ type: 'pickup', x: it.x, y: it.y, itemId: it.itemId });
                } else if (it.kind === 'coin') {
                    this.coins++;
                    this._events.push({ type: 'pickup', x: it.x, y: it.y, itemId: 'coin' });
                } else if (it.kind === 'heart') {
                    // 半心回血，不超上限
                    if (p.hp < p.maxHp) {
                        p.hp = Math.min(p.maxHp, p.hp + 1);
                        this._events.push({ type: 'pickup', x: it.x, y: it.y, itemId: 'heart' });
                    } else {
                        // 满血时不浪费：折算成 1 金币
                        this.coins++;
                        this._events.push({ type: 'pickup', x: it.x, y: it.y, itemId: 'coin' });
                    }
                } else if (it.kind === 'bomb') {
                    p.bombs = Math.min(BOMBS_MAX, p.bombs + 1);
                    this._events.push({ type: 'pickup', x: it.x, y: it.y, itemId: 'bomb' });
                }
                continue;
            }
            out.push(it);
        }
        this.pickups = out;
    }

    private _updateWaves(dt: number): void {
        // 地牢模式：敌人由房间决定，不跑沙盒的无尽波次
        if (this.map) return;
        this._waveTimer += dt;
        if (this._waveTimer < WAVE_INTERVAL) return;
        this._waveTimer = 0;
        if (this.enemies.length >= MAX_ENEMIES) return;
        this.wave++;
        const count = 1 + Math.floor(this.wave / WAVE_STEP);
        const pool = ['moldball', 'moldball', 'canman', 'jelly'];
        for (let i = 0; i < count; i++) {
            if (this.enemies.length >= MAX_ENEMIES) break;
            this.spawnEnemy(pool[Math.floor(this._rng() * pool.length)]);
        }
        this._events.push({ type: 'wave', n: this.wave });
    }

    private _randomSpawnPos(): { x: number; y: number } {
        // 在场地边缘随机取一点，离玩家至少 140px
        const p = this.player;
        for (let i = 0; i < 12; i++) {
            const side = Math.floor(this._rng() * 4);
            let x = 0;
            let y = 0;
            if (side === 0) { x = ARENA_MIN_X + 30; y = lerp(ARENA_MIN_Y, ARENA_MAX_Y, this._rng()); }
            else if (side === 1) { x = ARENA_MAX_X - 30; y = lerp(ARENA_MIN_Y, ARENA_MAX_Y, this._rng()); }
            else if (side === 2) { x = lerp(ARENA_MIN_X, ARENA_MAX_X, this._rng()); y = ARENA_MAX_Y - 30; }
            else { x = lerp(ARENA_MIN_X, ARENA_MAX_X, this._rng()); y = ARENA_MIN_Y + 30; }
            if (Math.hypot(x - p.x, y - p.y) >= 140) return { x, y };
        }
        return { x: ARENA_MAX_X - 40, y: ARENA_MAX_Y - 40 };
    }

    // ==================== 供自检 / 探针 ====================

    /** 检查世界不变量（自检脚本每次长跑后调用） */
    checkInvariants(): string[] {
        const errs: string[] = [];
        const p = this.player;
        if (!isFinite(p.x) || !isFinite(p.y)) errs.push('player 坐标 NaN');
        if (p.hp < 0 || p.hp > p.maxHp) errs.push(`hp 越界 ${p.hp}/${p.maxHp}`);
        if (!isFinite(p.dmg) || p.dmg < 0) errs.push('dmg 非法');
        if (this.enemies.length > MAX_ENEMIES) errs.push('敌人超上限');
        if (this.bullets.length > MAX_BULLETS) errs.push('子弹超上限');
        if (!isFinite(this.coins) || this.coins < 0) errs.push(`金币非法 ${this.coins}`);
        if (p.bombs < 0 || p.bombs > BOMBS_MAX) errs.push(`炸弹越界 ${p.bombs}`);
        if (p.charges < 0 || p.charges > p.maxCharges) errs.push(`充能越界 ${p.charges}`);
        if (this.map) {
            const room = this.currentRoom();
            if (!room) errs.push(`房间不存在 ${this.roomId}`);
            else if (room.kind !== 'start' && room.doors.length === 0 && room.kind !== 'secret') {
                errs.push(`房间 ${room.id} 无门`);
            }
        }
        for (const e of this.enemies) {
            if (!isFinite(e.x) || !isFinite(e.y)) errs.push(`敌人 ${e.id} 坐标 NaN`);
            if (e.x < ARENA_MIN_X - 1 || e.x > ARENA_MAX_X + 1) errs.push(`敌人 ${e.id} 越界 x`);
            if (e.y < ARENA_MIN_Y - 1 || e.y > ARENA_MAX_Y + 1) errs.push(`敌人 ${e.id} 越界 y`);
        }
        return errs;
    }
}

// ==================== 小工具 ====================

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function pRadius(): number {
    return PLAYER_R;
}
