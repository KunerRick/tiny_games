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
    ALTAR_COST, ARENA_MAX_X, ARENA_MAX_Y, ARENA_MIN_X, ARENA_MIN_Y,
    AUTO_AIM_RANGE, BASE_SPEED, BOMB_DROP_CHANCE, BOMB_DMG, BOMB_FUSE, BOMB_RADIUS, BOMBS_MAX, BOSS_DEFS, BOSS_KIND_BY_FLOOR,
    BULLET_R, CORE_FILLERS, CORE_FILLER_BY_ID, CORE_FREEZE_CHANCE, CORE_FREEZE_TIME, CORE_SPLIT_CHANCE, CORES, DOOR_HALF, ENEMY_BULLET_R,
    ENEMY_DEFS, FLOOR_ENEMIES, FILLER_BOMB, FILLER_HP, GREED_COIN_MUL, GREED_SHOP_MUL, HEAT_CURSE_FAST, HEAT_CURSE_HALFHP,
    HEAT_CURSE_NO_SHOP,
    HEAT_FAST_MUL, HEAT_HALF_CAP, HEAT_MAGNET_MUL, MAGNET_FAIL_MIN, MAGNET_PER_BOSS, MAGNET_PER_CLEAR, MAGNET_PER_SECRET, MAGNET_PER_WIN,
    OVERHEAT_MAX, OVERHEAT_STEP, isBossKind,
    FIXED_DT, HEART_DROP_CHANCE, INVULN, ITEM_BY_ID, ITEMS, MAX_BULLETS, MAX_ENEMIES, MAX_HP, PICKUP_R, PLAYER_R,
    REROLL_COST, ROOM_COIN_MAX, ROOM_COIN_MIN, SECRET_HINT_LUCK,
    SHOP_BOMB_PRICE, SHOP_HEART_PRICE, SHOP_ITEM_MAX, SHOP_ITEM_MIN,
    clamp, computeStats, CHAR_BY_ID, findSynergies, hasUnlock, mulberry32, rollItemPool, synergyItemPool,
} from './FridgeConfig';
import type {
    AltarState, Bullet, CharDef, CoreEvent, Enemy, EnemyDef, FridgeSnapshot, ItemTag, Pickup, PlacedBomb,
    PlayerState, PlayerStats, RunSummary, ShopOffer, ShopState,
} from './FridgeConfig';
import {
    DIRS, DIR_DELTA, generateFloor, oppositeDir,
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

/** 开局参数（M4）：普通 / 每日挑战 / 热度；电梯可从第 2 层起 */
export interface RunOptions {
    mode?: 'normal' | 'daily' | 'heat';
    startFloor?: number;
    heatCurses?: string[];
    /** 已拥有的解锁节点（深度补给 / 每日特供等） */
    unlocks?: string[];
}

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
    /** 商店货架（非 null 时世界冻结） */
    pendingShop: ShopState | null = null;
    /** 祭坛献祭（非 null 时世界冻结） */
    pendingAltar: AltarState | null = null;
    /** 已放置、正在倒计时的炸弹 */
    bomb: PlacedBomb | null = null;
    /** M4：Boss 击破后的核心三选一（非 null 时世界冻结） */
    pendingCore: string[] | null = null;
    /** M4：通往下一层的传送口（Boss 层选完核心后出现） */
    stairs: { x: number; y: number } | null = null;

    /** M4：模式与跨局解锁 */
    mode: 'normal' | 'daily' | 'heat' = 'normal';
    startFloor = 1;
    heatCurses: string[] = [];
    unlocks: string[] = [];
    /** M4：本局累计冰箱贴 / 秘密房 / 商店消费 / 炸弹（结算用） */
    magnets = 0;
    secretOpened = 0;
    shopSpent = 0;
    bombsUsed = 0;

    runId: string;

    /** M3：本局已点亮的协同 id（HUD / 图鉴用） */
    synergiesSeen: string[] = [];
    /** M3：冻土留下的冰面（爆炸生成，2s 减速 50%） */
    iceFields: Array<{ x: number; y: number; t: number; r: number }> = [];

    /** bug 补丁：本房间还能让几发子弹穿墙 */
    private _patchShots = 0;

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

    constructor(seed: number, charId = 'pudding', opts: RunOptions = {}) {
        this.seed = seed >>> 0;
        this.charId = charId;
        this.char = CHAR_BY_ID[charId] || CHAR_BY_ID.pudding;
        this.mode = opts.mode === 'daily' || opts.mode === 'heat' ? opts.mode : 'normal';
        this.startFloor = clamp(Math.round(opts.startFloor || 1), 1, 4);
        this.heatCurses = this.mode === 'heat' ? (opts.heatCurses || []).slice() : [];
        this.unlocks = (opts.unlocks || []).slice();
        this._rng = mulberry32(this.seed);
        this.runId = `r${this.seed.toString(36)}${Date.now().toString(36)}`;
        this._stats = computeStats(charId, []);
        this.player = this._makePlayer(this._stats);
        this.items = [];
        this.synergiesSeen = [];
        this.iceFields = [];
        this._patchShots = 3;
        // M1 沙盒：房间里放一个辣椒酱底座，走过即拾取；地牢模式会在 _enterDungeon 里清空
        this.pickups.push({ id: this._nextId++, kind: 'item', itemId: 'chili', x: 0, y: 110, bob: 0 });
        // 初始三只霉球
        for (let i = 0; i < 3; i++) this.spawnEnemy('moldball');
        this.wave = 1;
    }

    // ==================== 开局 / 续玩 ====================

    /** 地牢开局：生成起始层地图（第三参兼容旧的 floor: number） */
    static newRun(seed: number, charId = 'pudding', opts: RunOptions | number = {}): FridgeWorld {
        const o: RunOptions = typeof opts === 'number' ? { startFloor: opts } : (opts || {});
        const w = new FridgeWorld(seed, charId, o);
        w._enterDungeon(o.startFloor || 1);
        return w;
    }

    /** 从快照恢复：地图 / 道具 / 金币按存档，当前房间实体重新生成（§13.2） */
    static fromSave(save: RunSave): FridgeWorld {
        const w = new FridgeWorld(save.seed, save.charId, {
            mode: save.mode, startFloor: save.startFloor, heatCurses: save.heatCurses, unlocks: save.unlocks,
        });
        const map = save.map ? floorMapFromSave(save.map, save.floor) : null;
        if (!map) return FridgeWorld.newRun(save.seed, save.charId, {
            mode: save.mode, startFloor: save.floor, heatCurses: save.heatCurses, unlocks: save.unlocks,
        });

        w.map = map;
        w.floor = save.floor;
        w.roomId = clamp(save.roomId, 0, map.rooms.length - 1);
        w.enteringFrom = save.enteringFrom;
        w.runId = save.runId;
        w.items = save.items.filter((id) => !!ITEM_BY_ID[id]);
        w.cores = save.cores.slice();
        w.activeItem = save.activeItem && ITEM_BY_ID[save.activeItem] ? save.activeItem : null;
        w.synergiesSeen = Array.isArray(save.synergies)
            ? save.synergies.filter((id) => typeof id === 'string')
            : [];
        w.magnets = Math.max(0, Math.floor(Number(save.magnets) || 0));
        w.secretOpened = Math.max(0, Math.floor(Number(save.secretOpened) || 0));
        w.shopSpent = Math.max(0, Math.floor(Number(save.shopSpent) || 0));
        w.bombsUsed = Math.max(0, Math.floor(Number(save.bombsUsed) || 0));
        w._recomputeStats();
        const p = save.player;
        w.player.maxHp = clamp(p.maxHp, 2, MAX_HP);
        w.player.hp = clamp(p.hp, 1, w.player.maxHp);
        w.player.maxCharges = clamp(p.maxCharges, 1, 12);
        w.player.charges = clamp(p.charges, 0, w.player.maxCharges);
        w.player.bombs = clamp(p.bombs, 0, w._maxBombs());
        w.player.frozenSpeedPenalty = clamp(p.frozenSpeedPenalty, 0, 0.4);
        w.player.deathWardUsed = !!p.deathWardUsed;
        w.player.savepointUsedRoom = Number.isFinite(Number(p.savepointUsedRoom))
            ? Math.round(Number(p.savepointUsedRoom)) : -1;
        w.player.roomDmgMul = 1;
        w.player.rootT = 0;
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
        // 商店 / 祭坛：存档里还有未消费的面板就恢复（null = 已离开，不再弹）
        if (room.kind === 'shop') {
            w.pendingShop = save.shop && save.shop.offers.length > 0
                ? { offers: save.shop.offers.slice(), sold: save.shop.sold.slice() }
                : null;
        }
        if (room.kind === 'altar' && save.altar && !save.altar.used) {
            w.pendingAltar = { itemId: save.altar.itemId, used: false };
        }
        // 核心三选一 / 传送口：Boss 房已清但还没选核心 → 冻结在三选一；选完 → 楼梯已开
        if (Array.isArray(save.pendingCore) && save.pendingCore.length === 3) {
            w.pendingCore = save.pendingCore.slice();
            room.cleared = true;
        }
        if (room.kind === 'boss' && room.cleared && !w.pendingCore && w.floor < 4) {
            w.stairs = { x: 0, y: 120 };
        }
        w.roomCleared = room.cleared;
        w._placeAtDoor(w.enteringFrom);
        // 续玩不重复收进房代价（overclock），但护盾类按「每房间」重新给
        w._applyRoomEntryEffects(false);
        w._patchShots = 3;
        w._syncSynergies(false);
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
        this.pendingShop = null;
        this.pendingAltar = null;
        this.pendingCore = null;
        this.stairs = null;
        this.bomb = null;
        this.enteringFrom = null;
        this.player.x = 0;
        this.player.y = -40;
        this.player.vx = 0;
        this.player.vy = 0;
        this.wave = 0;
        this.time = 0;
        this.kills = 0;
        this.coins = 0;
        this.synergiesSeen = [];
        this.iceFields = [];
        this.magnets = 0;
        this.secretOpened = 0;
        this.shopSpent = 0;
        this.bombsUsed = 0;
        this.player.deathWardUsed = false; // 保鲜膜：每层重置
        this._patchShots = 3;
        this._applyRoomEntryEffects(false);
        this._syncSynergies(false);
    }

    // ==================== 对外 API ====================

    step(dt: number, input: FridgeInput): void {
        if (this.phase !== 'playing') return;
        if (this.pendingTreasure || this.pendingShop || this.pendingAltar || this.pendingCore) return; // 面板打开时冻结
        const step = Math.min(Math.max(dt, 0), MAX_DT);
        this.time += step;

        this._updatePlayer(step, input);
        this._updateFiring(step, input);
        this._updateBullets(step);
        this._updateIceFields(step);
        this._updateBomb(step);
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
            charId: this.charId,
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
            pendingShop: this.pendingShop,
            pendingAltar: this.pendingAltar,
            bomb: this.bomb,
            secretHints: this._secretHints(),
            iceFields: this.iceFields,
            pendingCore: this.pendingCore,
            stairs: this.stairs,
            mode: this.mode,
            heatCurses: this.heatCurses,
            magnets: this.magnets,
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

    /** 战斗 / Boss 房未清空 → 锁门（热度「无商店」把商店房也变成战斗房） */
    isRoomLocked(): boolean {
        const room = this.currentRoom();
        if (!room) return false;
        return this._isCombatRoom(room) && !room.cleared;
    }

    private _isCombatRoom(room: RoomNode): boolean {
        if (room.kind === 'fight' || room.kind === 'boss') return true;
        return room.kind === 'shop' && this.hasCurse(HEAT_CURSE_NO_SHOP);
    }

    hasCurse(id: string): boolean {
        return this.heatCurses.indexOf(id) >= 0;
    }

    hasCore(id: string): boolean {
        return this.cores.indexOf(id) >= 0;
    }

    private _countCore(id: string): number {
        let n = 0;
        for (const c of this.cores) if (c === id) n++;
        return n;
    }

    private _maxBombs(): number {
        return BOMBS_MAX + this._countCore('fill_bomb');
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

    // ---------- Boss 核心三选一 / 下一层（§8.4 / §6.1） ----------

    /** 选第 index 个核心；选完楼梯出现在房间中央上方 */
    chooseCore(index: number): boolean {
        const options = this.pendingCore;
        if (!options || !Number.isInteger(index) || index < 0 || index >= options.length) return false;
        const id = options[index];
        this.pendingCore = null;
        // 补位核心也记进 cores，后面 _recomputeStats 用 _countCore 还原数值
        this.cores.push(id);
        this._recomputeStats();
        if (id === 'fill_hp') {
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + FILLER_HP);
        } else if (id === 'fill_bomb') {
            this.player.bombs = Math.min(this._maxBombs(), this.player.bombs + FILLER_BOMB);
        } else if (id === 'fill_charge') {
            this.player.charges = Math.min(this.player.maxCharges, this.player.charges + 1);
        } else if (id === 'shield') {
            this.player.shield = Math.max(this.player.shield, 1);
        }
        // 楼梯：房间中央偏上，避免与「刚打完 Boss 的站位」重合
        this.stairs = { x: 0, y: 120 };
        return true;
    }

    /** 踏入传送口 → 下一层（第 4 层没有再下一层，返回 false） */
    nextFloor(): boolean {
        if (!this.map || this.phase !== 'playing' || this.pendingCore) return false;
        if (!this.stairs || this.floor >= 4) return false;
        this._advanceFloor();
        return true;
    }

    private _advanceFloor(): void {
        this.floor = clamp(this.floor + 1, 2, 4);
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
        this.pendingShop = null;
        this.pendingAltar = null;
        this.pendingCore = null;
        this.stairs = null;
        this.bomb = null;
        this.enteringFrom = null;
        this.iceFields = [];
        this.player.x = 0;
        this.player.y = -40;
        this.player.vx = 0;
        this.player.vy = 0;
        this.player.invuln = Math.max(this.player.invuln, 0.6);
        this.player.deathWardUsed = false; // 保鲜膜：每层重置
        this.player.savepointUsedRoom = -1;
        this._fireCd = 0;
        this._patchShots = 3;
        this.wave = 1;
        this._applyRoomEntryEffects(false);
        this._events.push({ type: 'room', id: room.id, kind: room.kind });
        this._events.push({ type: 'floor', floor: this.floor });
    }

    /** 结算：本局冰箱贴（失败折半，最少 1；热度模式 ×1.5） */
    magnetReward(): number {
        let m = this.magnets;
        if (this.mode === 'heat') m = Math.floor(m * HEAT_MAGNET_MUL);
        if (this.phase !== 'won') m = Math.floor(m / 2);
        return Math.max(MAGNET_FAIL_MIN, m);
    }

    /** 结算摘要（解锁条件判定用） */
    runSummary(): RunSummary {
        const maxCleared = this.phase === 'won' ? 4 : Math.max(0, this.floor - 1);
        let maxTagCount = 0;
        const tagCount: Record<string, number> = {};
        for (const id of this.items) {
            const it = ITEM_BY_ID[id];
            if (!it) continue;
            for (const t of it.tags) {
                tagCount[t] = (tagCount[t] || 0) + 1;
                if (tagCount[t] > maxTagCount) maxTagCount = tagCount[t];
            }
        }
        return {
            charId: this.charId,
            floorReached: this.floor,
            maxClearedFloor: maxCleared,
            won: this.phase === 'won',
            kills: this.kills,
            secretsOpened: this.secretOpened,
            shopSpent: this.shopSpent,
            bombsUsed: this.bombsUsed,
            maxTagCount,
            clearedWhileHalfHeart: false,
            clearedFloorWithoutBomb: this.bombsUsed === 0,
        };
    }

    // ---------- 商店（规格 §8.3） ----------

    /**
     * 买第 index 个货位。成功返回成交的货位（FridgeGame 用来弹提示），失败返回 null。
     * 买不起 / 已售出 / 面板没开都不扣币。
     */
    buyShop(index: number): ShopOffer | null {
        const shop = this.pendingShop;
        if (!shop || !Number.isInteger(index) || index < 0 || index >= shop.offers.length) return null;
        if (shop.sold[index]) return null;
        const offer = shop.offers[index];
        if (this.coins < offer.price) return null;
        // 半心满血时不允许白买：直接视为失败（HUD 会灰显）
        if (offer.kind === 'heart' && this.player.hp >= this.player.maxHp) return null;

        this.coins -= offer.price;
        this.shopSpent += offer.price;
        shop.sold[index] = true;
        if (offer.kind === 'item') {
            this.addItem(offer.id);
            this._events.push({ type: 'pickup', x: this.player.x, y: this.player.y, itemId: offer.id });
        } else if (offer.kind === 'heart') {
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
        } else {
            this.player.bombs = Math.min(this._maxBombs(), this.player.bombs + 1);
        }
        return offer;
    }

    /** 离开商店（货架保留到离房；房间已记为清理，回头不再开面板） */
    closeShop(): void {
        this.pendingShop = null;
    }

    // ---------- 祭坛（规格 §8.3） ----------

    /**
     * 献祭 1 颗心（2 半心）换高价值道具。
     * 血量必须 > 2（自伤不致死，只有 1 颗心 / 2 半心时按钮灰显），每座祭坛只能用一次。
     */
    takeAltar(): boolean {
        const altar = this.pendingAltar;
        if (!altar || altar.used) return false;
        if (this.player.hp <= ALTAR_COST) return false;
        this.player.hp -= ALTAR_COST;
        altar.used = true;
        this.addItem(altar.itemId);
        this._events.push({ type: 'pickup', x: this.player.x, y: this.player.y, itemId: altar.itemId });
        this._events.push({ type: 'playerHit', x: this.player.x, y: this.player.y });
        return true;
    }

    closeAltar(): void {
        this.pendingAltar = null;
    }

    // ---------- 炸弹（规格 §7.3） ----------

    /** 在脚下放一颗炸弹：半径 140 / 伤害 50 / 清敌弹 / 炸开秘密墙 */
    useBomb(): boolean {
        if (this.phase !== 'playing') return false;
        if (this.pendingTreasure || this.pendingShop || this.pendingAltar || this.pendingCore) return false;
        if (this.bomb || this.player.bombs <= 0) return false;
        this.player.bombs--;
        this.bombsUsed++;
        this.bomb = { x: this.player.x, y: this.player.y, t: BOMB_FUSE };
        this._events.push({ type: 'bomb', x: this.bomb.x, y: this.bomb.y, r: 0 });
        return true;
    }

    private _updateBomb(dt: number): void {
        const b = this.bomb;
        if (!b) return;
        b.t -= dt;
        if (b.t > 0) return;
        this.bomb = null;
        this._explode(b.x, b.y, BOMB_RADIUS, BOMB_DMG);
        // 清空场上敌方子弹
        const keep: Bullet[] = [];
        for (const x of this.bullets) if (x.owner === 'player') keep.push(x);
        this.bullets = keep;
        const opened = this._openSecretAt(b.x, b.y);
        this._events.push({ type: 'bomb', x: b.x, y: b.y, r: opened ? BOMB_RADIUS : 0 });
    }

    /** 炸弹落在某堵墙边 → 把相邻秘密房打通（返回是否真的开了新门） */
    private _openSecretAt(x: number, y: number): boolean {
        const room = this.currentRoom();
        if (!room || !this.map || this.map.secretId === null) return false;
        let opened = false;
        for (const dir of DIRS) {
            const nx = room.x + DIR_DELTA[dir].x;
            const ny = room.y + DIR_DELTA[dir].y;
            let secret: RoomNode | null = null;
            for (const r of this.map.rooms) {
                if (r.kind === 'secret' && r.x === nx && r.y === ny) {
                    secret = r;
                    break;
                }
            }
            if (!secret || secret.visited) continue;
            // 墙中心：与门的判定同一坐标系
            let wx = 0;
            let wy = 0;
            if (dir === 'up') wy = ARENA_MAX_Y;
            else if (dir === 'down') wy = ARENA_MIN_Y;
            else if (dir === 'left') wx = ARENA_MIN_X;
            else wx = ARENA_MAX_X;
            if (Math.hypot(x - wx, y - wy) > BOMB_RADIUS) continue;
            if (room.doors.indexOf(dir) < 0) room.doors.push(dir);
            secret.visited = true;
            room.cleared = true;
            opened = true;
            this.secretOpened++;
            this.magnets += MAGNET_PER_SECRET;
            this._events.push({ type: 'secret', x: secret.x, y: secret.y });
        }
        return opened;
    }

    /** 秘密房提示：幸运 ≥ SECRET_HINT_LUCK 时朝该方向的墙上画裂纹，越高越明显 */
    private _secretHints(): Array<{ dir: string; strength: number }> {
        const out: Array<{ dir: string; strength: number }> = [];
        const room = this.currentRoom();
        if (!room || !this.map) return out;
        const luck = this.player.luck;
        if (luck < SECRET_HINT_LUCK) return out;
        for (const dir of DIRS) {
            const nx = room.x + DIR_DELTA[dir].x;
            const ny = room.y + DIR_DELTA[dir].y;
            let hit = false;
            for (const r of this.map.rooms) {
                if (r.kind === 'secret' && !r.visited && r.x === nx && r.y === ny) {
                    hit = true;
                    break;
                }
            }
            if (hit) out.push({ dir, strength: clamp((luck - SECRET_HINT_LUCK + 2) / 10, 0.2, 1) });
        }
        return out;
    }

    private _rollShop(): ShopState {
        const greed = this.hasCore('greed') ? GREED_SHOP_MUL : 1;
        const base = SHOP_ITEM_MIN + Math.floor(this._rng() * (SHOP_ITEM_MAX - SHOP_ITEM_MIN + 1));
        const price = Math.max(1, Math.round(base * greed));
        const offers: ShopOffer[] = [
            { kind: 'item', id: this._rollFloorItem(), price },
            { kind: 'heart', price: Math.max(1, Math.round(SHOP_HEART_PRICE * greed)) },
            { kind: 'bomb', price: Math.max(1, Math.round(SHOP_BOMB_PRICE * greed)) },
        ];
        // 每日特供：多一个半价货位（§11.2 解锁）
        if (this._hasUnlock('daily_supply')) {
            offers.push({ kind: 'item', id: this._rollFloorItem(), price: Math.max(1, Math.floor(price * 0.5)) });
        }
        return { offers, sold: offers.map(() => false) };
    }

    private _hasUnlock(id: string): boolean {
        return hasUnlock(this.unlocks, id);
    }

    /** 本层可出的道具里随机一个（深度补给会扩大池子，最多持有 3 个） */
    private _rollFloorItem(): string {
        const pool: string[] = [];
        for (const it of rollItemPool(this.floor, this.unlocks)) {
            if (this._countItem(it.id) < 3) pool.push(it.id);
        }
        if (pool.length === 0) return 'sugar';
        return pool[Math.floor(this._rng() * pool.length)];
    }

    /** 祭坛高价值池：带标签的道具（有构筑意义），池空时退回普通池 */
    private _rollAltarItem(): string {
        const high: string[] = [];
        const all: string[] = [];
        for (const it of rollItemPool(this.floor, this.unlocks)) {
            if (this._countItem(it.id) >= 3) continue;
            all.push(it.id);
            if (it.tags.length > 0) high.push(it.id);
        }
        const pool = high.length > 0 ? high : all;
        if (pool.length === 0) return 'sugar';
        return pool[Math.floor(this._rng() * pool.length)];
    }

    /** 秘密房奖励：1 个道具 + 3 金币（规格 §8.3） */
    private _spawnSecretLoot(): void {
        this.pickups.push({
            id: this._nextId++, kind: 'item', itemId: this._rollFloorItem(),
            x: 0, y: 40, bob: 0,
        });
        for (let i = 0; i < 3; i++) {
            this.pickups.push({ id: this._nextId++, kind: 'coin', x: -40 + i * 40, y: -60, bob: this._rng() * 6 });
        }
    }

    /** 拾取道具（宝箱 / 商店 / 底座共用） */
    addItem(itemId: string): boolean {
        const def = ITEM_BY_ID[itemId];
        if (!def) return false;
        const oldMax = this.player.maxHp;
        this.items.push(itemId);
        // 电池：立刻 +2 当前充能，上限由 _recomputeStats 计算（+1/个）
        if (itemId === 'battery') {
            this.player.charges = Math.min(9, this.player.charges + 2);
        }
        this._recomputeStats();
        if (def.active) {
            this.activeItem = itemId;
            this.player.charges = 0;
            this._recomputeStats();
        }
        // 提升生命上限时同步补当前血量
        if (this.player.maxHp > oldMax) this.player.hp = Math.min(this.player.maxHp, this.player.hp + (this.player.maxHp - oldMax));
        // 奶酪 / 罐头盖：拾取即享受本房间的一次护盾
        if (itemId === 'cheese' || itemId === 'canlid') this.player.shield = Math.max(this.player.shield, 1);
        this._syncSynergies(true);
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
            slowT: 0,
            slowMul: 1,
            freezeT: 0,
            poisonT: 0,
            poisonDps: 0,
            burnT: 0,
            burnDps: 0,
            lastElem: null,
            elemCount: 0,
            overheat: 0,
            special: 0,
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
        this.pendingShop = null;
        this.pendingAltar = null;
        this.bomb = null;
        this._fireCd = 0;
        this.roomCleared = room.cleared;
        this.player.roomDmgMul = 1;
        this.player.rootT = 0;
        this.player.savepointUsedRoom = -1;
        this.iceFields = [];
        this._patchShots = 3;
        this._placeAtDoor(from);
        this._applyRoomEntryEffects(true);
        if (!room.cleared) {
            if (room.kind === 'treasure') {
                this.pendingTreasure = this._rollTreasure();
                this._events.push({ type: 'treasure', roomId: room.id });
            } else if (room.kind === 'shop' && !this.hasCurse(HEAT_CURSE_NO_SHOP)) {
                this.pendingShop = this._rollShop();
                room.cleared = true;
                this.roomCleared = true;
                this._events.push({ type: 'shop', roomId: room.id });
            } else if (room.kind === 'altar') {
                this.pendingAltar = { itemId: this._rollAltarItem(), used: false };
                room.cleared = true;
                this.roomCleared = true;
                this._events.push({ type: 'altar', roomId: room.id });
            } else if (room.kind === 'secret') {
                this._spawnSecretLoot();
                room.cleared = true;
                this.roomCleared = true;
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

    /** 按层 / 深度刷本房敌人（数量 4–9，§9.3；热度「无商店」的商店房也刷怪） */
    private _spawnRoomEnemies(room: RoomNode): void {
        if (room.kind === 'boss') {
            const kind = BOSS_KIND_BY_FLOOR[this.floor] || 'moldking';
            this.spawnEnemy(kind, 0, ARENA_MAX_Y - 110);
            // Boss 房的小怪按层取池子（缝线熊的钟表兵 / 蓝屏的 bug / 压缩机的锈骑）
            const pool = FLOOR_ENEMIES[this.floor] || FLOOR_ENEMIES[1];
            this.spawnEnemy(pool[0], -110, ARENA_MAX_Y - 90);
            this.spawnEnemy(pool[pool.length - 1], 110, ARENA_MAX_Y - 90);
            return;
        }
        if (!this._isCombatRoom(room)) return;
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
        this.magnets += MAGNET_PER_CLEAR;
        if (room.kind === 'boss') {
            this.magnets += MAGNET_PER_BOSS;
            if (this.floor >= 4) {
                // 第 4 层 Boss = 通关
                this.magnets += MAGNET_PER_WIN;
                this.phase = 'won';
                this._events.push({ type: 'won' });
            } else {
                // 1–3 层：三选一核心，选完出现通往下一层的传送口（§8.4）
                this.pendingCore = this._rollCores();
                this._events.push({ type: 'core', roomId: room.id, options: this.pendingCore.slice() });
            }
        }
    }

    /** 未持有的核心里确定性抽 3 个；不足时用补位核心补齐（补位也不重复持有） */
    private _rollCores(): string[] {
        const pool: string[] = [];
        for (const c of CORES) if (!this.hasCore(c.id)) pool.push(c.id);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(this._rng() * (i + 1));
            const t = pool[i];
            pool[i] = pool[j];
            pool[j] = t;
        }
        const out = pool.slice(0, 3);
        if (out.length < 3) {
            for (const f of CORE_FILLERS) {
                if (out.length >= 3) break;
                if (!this.hasCore(f.id)) out.push(f.id);
            }
        }
        while (out.length < 3) out.push(CORE_FILLERS[0].id);
        return out;
    }

    private _rollTreasure(): { offered: string[]; rerolled: boolean } {
        const base = rollItemPool(this.floor, this.unlocks);
        const pool: string[] = [];
        for (const it of base) {
            if (this._countItem(it.id) < 3) pool.push(it.id);
        }
        const offered: string[] = [];
        // 深度补给 III：至少保底 1 个与现有标签协同的道具
        if (this._hasUnlock('supply3')) {
            const syn = synergyItemPool(this.items, base);
            const avail: string[] = [];
            for (const it of syn) if (this._countItem(it.id) < 3) avail.push(it.id);
            if (avail.length > 0) offered.push(avail[Math.floor(this._rng() * avail.length)]);
        }
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
            schemaVersion: 3,
            runId: this.runId,
            mode: this.mode,
            seed: this.seed,
            rngState: this._rng.getState(),
            charId: this.charId,
            floor: clamp(this.floor, 1, 4) as 1 | 2 | 3 | 4,
            startFloor: this.startFloor,
            heatCurses: this.heatCurses.slice(),
            unlocks: this.unlocks.slice(),
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
                deathWardUsed: this.player.deathWardUsed,
                savepointUsedRoom: this.player.savepointUsedRoom,
            },
            items: this.items.slice(),
            activeItem: this.activeItem,
            cores: this.cores.slice(),
            synergies: this.synergiesSeen.slice(),
            pendingCore: this.pendingCore ? this.pendingCore.slice() : null,
            magnets: this.magnets,
            secretOpened: this.secretOpened,
            shopSpent: this.shopSpent,
            bombsUsed: this.bombsUsed,
            treasure: this.pendingTreasure
                ? { offered: this.pendingTreasure.offered.slice(), rerolled: this.pendingTreasure.rerolled }
                : null,
            shop: this.pendingShop
                ? { offers: this.pendingShop.offers.slice(), sold: this.pendingShop.sold.slice() }
                : null,
            altar: this.pendingAltar
                ? { itemId: this.pendingAltar.itemId, used: this.pendingAltar.used }
                : null,
            savedAt: Date.now(),
            gameVersion: 'm4',
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
            roomDmgMul: 1,
            rootT: 0,
            deathWardUsed: false,
            savepointUsedRoom: -1,
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
        // 生命扩容补位 + 热度「半心上限」
        const hpCap = this.hasCurse(HEAT_CURSE_HALFHP) ? Math.min(MAX_HP, HEAT_HALF_CAP) : MAX_HP;
        p.maxHp = clamp(stats.maxHp + this._countCore('fill_hp') * FILLER_HP, 2, hpCap);
        // 主动槽上限：主动道具取自身充能值，否则取角色技能；电池 +1/个、充能扩容 +1/个（规格 §8.3）
        const base = this.activeItem && ITEM_BY_ID[this.activeItem]
            ? (ITEM_BY_ID[this.activeItem].charges || 3)
            : this.char.skill.charges;
        p.maxCharges = clamp(base + this._countItem('battery') + this._countCore('fill_charge'), 1, 12);
        p.charges = Math.min(p.charges, p.maxCharges);
        if (p.hp > p.maxHp) p.hp = p.maxHp;
        p.hp = clamp(p.hp, 1, p.maxHp);
        this._stats = stats;
    }

    get stats(): PlayerStats {
        return this._stats;
    }

    private _updatePlayer(dt: number, input: FridgeInput): void {
        const p = this.player;
        if (p.rootT > 0) {
            // 冰块「自冻」：无敌但不能移动
            p.rootT = Math.max(0, p.rootT - dt);
            p.vx = 0;
            p.vy = 0;
            if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
            return;
        }
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
        if (this.map) {
            // 站上传送口 → 下一层（Boss 房选完核心后）
            if (this.stairs) {
                const d = Math.hypot(p.x - this.stairs.x, p.y - this.stairs.y);
                if (d <= PLAYER_R + 14 && this.nextFloor()) return;
            }
            this._checkDoorEntry();
        }
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
            const target = this.hasSynergy('precise_magnet') && p.luck >= 3
                ? this._strongestEnemy(AUTO_AIM_RANGE)
                : this._nearestEnemy(AUTO_AIM_RANGE);
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

    /** 幸运 ≥3 + 磁吸协同：瞄准血量最高的敌人（规格 §8.2） */
    private _strongestEnemy(maxDist: number): Enemy | null {
        const p = this.player;
        let best: Enemy | null = null;
        let bestHp = -1;
        for (const e of this.enemies) {
            if (e.hp <= 0) continue;
            if (Math.hypot(e.x - p.x, e.y - p.y) > maxDist) continue;
            if (e.hp > bestHp) {
                bestHp = e.hp;
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
        // bug 补丁：本房间前 3 发可以穿墙一次
        const wallPierce = this.hasItem('patch') && this._patchShots > 0 ? 1 : 0;
        if (wallPierce > 0) this._patchShots--;
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
                dmg: p.dmg * p.roomDmgMul,
                life: p.range / BULLET_SPEED,
                pierce: this.hasTag('pierce') ? 1 : 0,
                bounces: (this.hasTag('bounce') ? 1 : 0) + this._countItem('rubberband') + (this.hasCore('bounce') ? 1 : 0),
                wallPierce,
                kind: 'tear',
                hitIds: [],
            });
        }
        this._events.push({ type: 'shoot', x: p.x, y: p.y });
    }

    private _pushBullet(b: Bullet): void {
        const used = this.bullets.length + (this._bulletSink ? this._bulletSink.length : 0);
        if (used >= MAX_BULLETS) return;
        if (this._bulletSink) this._bulletSink.push(b);
        else this.bullets.push(b);
    }

    /** 子弹更新期间的落点（分裂弹不能在遍历旧数组时直接塞回 this.bullets） */
    private _bulletSink: Bullet[] | null = null;

    hasTag(tag: ItemTag): boolean {
        for (const id of this.items) {
            const it = ITEM_BY_ID[id];
            if (it && it.tags.indexOf(tag) >= 0) return true;
        }
        return false;
    }

    hasItem(id: string): boolean {
        return this._countItem(id) > 0;
    }

    hasSynergy(id: string): boolean {
        for (const s of findSynergies(this.items)) if (s.id === id) return true;
        return false;
    }

    /** 道具变化后同步协同列表；emit=true 时把新点亮的协同推给 HUD */
    private _syncSynergies(emit: boolean): void {
        for (const s of findSynergies(this.items)) {
            if (this.synergiesSeen.indexOf(s.id) >= 0) continue;
            this.synergiesSeen.push(s.id);
            if (emit) this._events.push({ type: 'synergy', name: s.name });
        }
    }

    /**
     * 进房结算（护盾 / overclock 代价）。refresh=false 用于续玩 / 开局，
     * 只补护盾、不收代价，避免刷新页面能反复扣血或被反复收税。
     */
    private _applyRoomEntryEffects(chargeCost: boolean): void {
        const p = this.player;
        if (this.hasItem('cheese') || this.hasItem('canlid') ||
            (this.hasTag('shield') && this.hasTag('heal')) || this.hasCore('shield')) {
            p.shield = Math.max(p.shield, 1);
        }
        if (chargeCost && this.hasItem('overclock') && p.hp > 1) {
            p.hp -= 1;
            this._events.push({ type: 'playerHit', x: p.x, y: p.y });
        }
        p.roomDmgMul = 1;
    }

    /** 主动槽当前名字（HUD 显示） */
    activeName(): string {
        if (this.activeItem && ITEM_BY_ID[this.activeItem]) return ITEM_BY_ID[this.activeItem].name;
        return this.char.skill.name;
    }

    /** 主动槽当前所需充能 */
    activeCost(): number {
        if (this.activeItem && ITEM_BY_ID[this.activeItem]) return ITEM_BY_ID[this.activeItem].charges || 3;
        return this.char.skill.charges;
    }

    /**
     * 使用主动槽：角色技能 / 主动道具共用（规格 §5.1 / §8.3）。
     * 充能不足、死亡、宝箱冻结时返回 false。
     */
    useActive(): boolean {
        if (this.phase !== 'playing' || this.pendingTreasure || this.pendingShop || this.pendingAltar || this.pendingCore) return false;
        const p = this.player;
        const cost = this.activeCost();
        if (p.charges < cost) return false;
        const name = this.activeName();
        const spent = (): void => {
            p.charges = Math.max(0, p.charges - cost);
            this._events.push({ type: 'active', name, x: p.x, y: p.y });
        };

        // 主动道具
        if (this.activeItem === 'lastpudding') {
            p.invuln = Math.max(p.invuln, 3);
            for (const e of this.enemies) this._damageEnemy(e, 30);
            spent();
            return true;
        }
        if (this.activeItem === 'savepoint') {
            // 存档点是死亡时自动触发，主动按键不消耗
            return false;
        }

        // 角色技能
        if (this.charId === 'pudding') {
            p.x = clamp(p.x + p.facingX * 120, ARENA_MIN_X + PLAYER_R, ARENA_MAX_X - PLAYER_R);
            p.y = clamp(p.y + p.facingY * 120, ARENA_MIN_Y + PLAYER_R, ARENA_MAX_Y - PLAYER_R);
            p.invuln = Math.max(p.invuln, 0.3);
        } else if (this.charId === 'candy') {
            if (p.roomDmgMul > 1 || p.hp <= 1) return false;
            p.roomDmgMul = 1.5;
            p.hp -= 1;
        } else if (this.charId === 'icecube') {
            p.rootT = Math.max(p.rootT, 1.5);
            p.invuln = Math.max(p.invuln, 1.5);
        } else if (this.charId === 'soda') {
            for (const e of this.enemies) {
                const dx = e.x - p.x;
                const dy = e.y - p.y;
                const d = Math.hypot(dx, dy) || 1;
                if (d <= 140) {
                    this._damageEnemy(e, p.dmg * 1.5);
                    if (e.hp > 0) {
                        e.x = clamp(e.x + (dx / d) * 60, ARENA_MIN_X + e.r, ARENA_MAX_X - e.r);
                        e.y = clamp(e.y + (dy / d) * 60, ARENA_MIN_Y + e.r, ARENA_MAX_Y - e.r);
                    }
                }
            }
        } else if (this.charId === 'yogurt') {
            for (const e of this.enemies) {
                if (e.poisonT > 0) {
                    this._damageEnemy(e, e.poisonDps * e.poisonT);
                    e.poisonT = 0;
                    e.poisonDps = 0;
                }
            }
        } else if (this.charId === 'magneto') {
            let gained = 0;
            const keep: Bullet[] = [];
            for (const b of this.bullets) {
                if (b.owner === 'enemy' && gained < 20) {
                    gained++;
                } else {
                    keep.push(b);
                }
            }
            this.bullets = keep;
            this.coins += gained;
        } else {
            return false;
        }
        spent();
        return true;
    }

    // ==================== 子弹 ====================

    private _updateBullets(dt: number): void {
        const out: Bullet[] = [];
        this._bulletSink = out;
        for (const b of this.bullets) {
            if (b.owner === 'player' && this.hasTag('homing')) this._homeToward(b, dt);
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.life -= dt;

            // 墙：先吃「穿墙」，再吃反弹，都没有就消失
            let removed = false;
            if (b.x < ARENA_MIN_X || b.x > ARENA_MAX_X) {
                if (b.wallPierce > 0) {
                    b.wallPierce--;
                    b.x = clamp(b.x, ARENA_MIN_X + 1, ARENA_MAX_X - 1);
                } else if (b.bounces > 0) {
                    b.bounces--;
                    b.vx = -b.vx;
                    b.x = clamp(b.x, ARENA_MIN_X, ARENA_MAX_X);
                    this._onBounce(b);
                } else {
                    removed = true;
                }
            }
            if (!removed && (b.y < ARENA_MIN_Y || b.y > ARENA_MAX_Y)) {
                if (b.wallPierce > 0) {
                    b.wallPierce--;
                    b.y = clamp(b.y, ARENA_MIN_Y + 1, ARENA_MAX_Y - 1);
                } else if (b.bounces > 0) {
                    b.bounces--;
                    b.vy = -b.vy;
                    b.y = clamp(b.y, ARENA_MIN_Y, ARENA_MAX_Y);
                    this._onBounce(b);
                } else {
                    removed = true;
                }
            }
            if (removed) continue;
            if (b.life <= 0) continue;

            if (b.owner === 'player') {
                let dead = false;
                for (const e of this.enemies) {
                    if (e.hp <= 0) continue;
                    if (b.hitIds.indexOf(e.id) >= 0) continue;
                    const rr = e.r + b.r;
                    if ((e.x - b.x) * (e.x - b.x) + (e.y - b.y) * (e.y - b.y) <= rr * rr) {
                        // 过热核心：同一目标连续挨打的伤害递增（0.1/层，最多 +50%）
                        const heatMul = this.hasCore('overheat')
                            ? 1 + Math.min(OVERHEAT_MAX, e.overheat * OVERHEAT_STEP)
                            : 1;
                        this._damageEnemy(e, b.dmg * heatMul);
                        b.hitIds.push(e.id);
                        this._onBulletHit(e, b);
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
        this._bulletSink = null;
        this.bullets = out;
    }

    /** 磁铁 / 遥控车：子弹轻微追踪（最大转向速度 2.6 rad/s） */
    private _homeToward(b: Bullet, dt: number): void {
        let best: Enemy | null = null;
        let bestD = 220 * 220;
        for (const e of this.enemies) {
            if (e.hp <= 0 || b.hitIds.indexOf(e.id) >= 0) continue;
            const d = (e.x - b.x) * (e.x - b.x) + (e.y - b.y) * (e.y - b.y);
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        if (!best) return;
        const cur = Math.atan2(b.vy, b.vx);
        const want = Math.atan2(best.y - b.y, best.x - b.x);
        let diff = want - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = 2.6 * dt;
        const a = cur + clamp(diff, -maxTurn, maxTurn);
        const speed = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
    }

    /** 弹跳时：弹跳冲刺协同让伤害逐次 +20%（封顶在原始伤害 1.2 倍附近）；弹力针让贯穿弹可反复命中 */
    private _onBounce(b: Bullet): void {
        if (b.owner !== 'player') return;
        if (this.hasSynergy('elastic_needle')) {
            b.hitIds = [];
            b.pierce = Math.max(b.pierce, 1);
        }
        if (!this.hasSynergy('bounce_dash')) return;
        const cap = this.player.dmg * this.player.roomDmgMul * 1.2;
        b.dmg = Math.min(cap, b.dmg * 1.2);
    }

    /** 命中后的元素 / 道具 / 协同效果（规格 §8.2 / §8.3） */
    private _onBulletHit(e: Enemy, b: Bullet): void {
        if (b.owner !== 'player') return;
        const dmg = b.dmg;

        // 核心（M4）：过热叠层 / 霜冻冻结
        if (this.hasCore('overheat')) e.overheat = Math.min(5, e.overheat + 1);
        if (this.hasCore('freeze') && this._rng() < CORE_FREEZE_CHANCE) {
            e.freezeT = Math.max(e.freezeT, CORE_FREEZE_TIME);
        }

        // 冰：蜂蜜 35% / 冷冻豌豆 20% 减速；薄荷 15% 冻结
        if (this.hasItem('honey')) this._slow(e, 0.65, 1.2);
        if (this.hasItem('peas')) this._slow(e, 0.8, 1.2);
        if (this.hasItem('mint') && this._rng() < 0.15) e.freezeT = Math.max(e.freezeT, 0.8);

        // 毒：发霉面包每秒 15% 伤害，持续 3s
        if (this.hasItem('mold')) {
            e.poisonT = Math.max(e.poisonT, 3);
            e.poisonDps = Math.max(e.poisonDps, dmg * 0.15);
        }
        // 火：打火机 20% 点燃
        if (this.hasItem('lighter') && this._rng() < 0.2) this._ignite(e, dmg * 0.3, 3, dmg);

        // 爆炸：辣椒油每次命中 40px；玩具锤 25% 60px
        if (this.hasItem('chilioil')) {
            this._explode(e.x, e.y, 40, dmg * 0.5, e.id);
        } else if (this.hasItem('hammer') && this._rng() < 0.25) {
            this._explode(e.x, e.y, 60, dmg * 0.5, e.id);
        } else if (this.hasItem('rust')) {
            this._explode(e.x, e.y, 40, dmg * 0.4, e.id);
        }
        // 火 + 爆炸协同：火球命中 60px 爆炸
        if (this.hasSynergy('caramel_burst') && this.hasTag('fire')) {
            this._explode(e.x, e.y, 60, dmg * 0.5, e.id);
        }

        // 连锁：冰+链 / 贯穿+链
        if (this.hasSynergy('frost_chain') && this.hasTag('ice') && this.hasTag('chain')) {
            this._chain(e, dmg * 0.4, 2, true);
        } else if (this.hasSynergy('pierce_arc') && b.pierce > 0) {
            this._chain(e, dmg * 0.4, 2, false);
        }

        // 分裂：卡带 30% 分裂 2 发；糖渣协同每发再多 2 片
        let split = 0;
        if (this.hasCore('split') && this._rng() < CORE_SPLIT_CHANCE) split += 1;
        if (this.hasItem('cartridge') && this._rng() < 0.3) split += 2;
        if (this.hasSynergy('sugar_dregs')) split += 2;
        if (split > 0) this._splitBullet(b, split);

        // 冷热交替：同一目标交替命中 3 次 → 蒸汽爆发
        if (this.hasSynergy('hot_cold') && e.hp > 0) {
            const elem: 'fire' | 'ice' = (b.id & 1) === 0 ? 'fire' : 'ice';
            if (e.lastElem && e.lastElem !== elem) e.elemCount++;
            else e.elemCount = 1;
            e.lastElem = elem;
            if (e.elemCount >= 3) {
                e.elemCount = 0;
                this._explode(e.x, e.y, 80, dmg * 1.5, e.id);
            }
        }
    }

    private _slow(e: Enemy, mul: number, t: number): void {
        e.slowMul = Math.min(e.slowT > 0 ? e.slowMul : 1, mul);
        e.slowT = Math.max(e.slowT, t);
    }

    /** 点燃；若目标已中毒且点亮「毒雾爆燃」，先 80px 爆燃再挂燃烧 */
    private _ignite(e: Enemy, dps: number, t: number, burstDmg: number): void {
        if (e.poisonT > 0 && this.hasSynergy('poison_blaze')) {
            e.poisonT = 0;
            e.poisonDps = 0;
            this._explode(e.x, e.y, 80, burstDmg * 0.5, e.id);
        }
        e.burnDps = Math.max(e.burnDps, dps);
        e.burnT = Math.max(e.burnT, t);
    }

    /** 范围伤害；冻土协同会留下冰面，子母雷协同会再分裂 3 发 */
    private _explode(x: number, y: number, r: number, dmg: number, exceptId = -1): void {
        this._events.push({ type: 'boom', x, y, r });
        for (const e of this.enemies) {
            if (e.hp <= 0 || e.id === exceptId) continue;
            if (Math.hypot(e.x - x, e.y - y) <= r + e.r) this._damageEnemy(e, dmg);
        }
        if (this.hasSynergy('permafrost')) {
            this.iceFields.push({ x, y, t: 2, r: Math.max(60, r) });
        }
        if (this.hasSynergy('cluster_bomb')) {
            for (let i = 0; i < 3; i++) {
                const a = (Math.PI * 2 * i) / 3 + 0.4;
                this._pushBullet({
                    id: this._nextId++, owner: 'player', x, y,
                    vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED,
                    r: BULLET_R * 0.7, dmg: dmg * 0.6, life: 0.55,
                    pierce: 0, bounces: 0, wallPierce: 0, kind: 'split', hitIds: [],
                });
            }
        }
    }

    /** 连锁 N 个最近目标（不含已经命中的源目标） */
    private _chain(e: Enemy, dmg: number, count: number, slow: boolean): void {
        const hits = new Set<number>([e.id]);
        let fromX = e.x;
        let fromY = e.y;
        for (let n = 0; n < count; n++) {
            let best: Enemy | null = null;
            let bestD = 150 * 150;
            for (const o of this.enemies) {
                if (o.hp <= 0 || hits.has(o.id)) continue;
                const d = (o.x - fromX) * (o.x - fromX) + (o.y - fromY) * (o.y - fromY);
                if (d < bestD) {
                    bestD = d;
                    best = o;
                }
            }
            if (!best) return;
            hits.add(best.id);
            this._damageEnemy(best, dmg);
            if (slow) this._slow(best, 0.7, 1.2);
            this._events.push({ type: 'boom', x: best.x, y: best.y, r: 12 });
            fromX = best.x;
            fromY = best.y;
        }
    }

    /** 分裂子弹（卡带 / 糖渣） */
    private _splitBullet(b: Bullet, count: number): void {
        const base = Math.atan2(b.vy, b.vx);
        const speed = Math.hypot(b.vx, b.vy) * 0.85;
        for (let i = 0; i < count; i++) {
            const a = base + (i - (count - 1) / 2) * 0.5;
            this._pushBullet({
                id: this._nextId++, owner: 'player',
                x: b.x, y: b.y,
                vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
                r: BULLET_R * 0.75, dmg: b.dmg * 0.6, life: Math.max(0.25, b.life),
                pierce: 0, bounces: 0, wallPierce: 0, kind: 'split', hitIds: [],
            });
        }
    }

    private _damageEnemy(e: Enemy, dmg: number, silent = false): void {
        if (e.hp <= 0) return;
        e.hp -= dmg;
        if (!silent) e.hitFlash = 0.12;
        if (!silent) this._events.push({ type: 'hit', x: e.x, y: e.y });
        if (e.hp <= 0) {
            e.hp = 0;
            this.kills++;
            this._events.push({ type: 'kill', x: e.x, y: e.y, kind: e.kind });
            // 贪婪核心：金币掉落概率 +50%
            const coinChance = 0.35 * (this.hasCore('greed') ? GREED_COIN_MUL : 1);
            if (this._rng() < coinChance) {
                this.pickups.push({ id: this._nextId++, kind: 'coin', x: e.x, y: e.y, bob: this._rng() * 6 });
            }
            // 火舌：燃烧中的敌人死亡时点燃最近的敌人
            if (e.burnT > 0 && this.hasSynergy('fire_tongue')) {
                let best: Enemy | null = null;
                let bestD = 220 * 220;
                for (const o of this.enemies) {
                    if (o.hp <= 0 || o.id === e.id) continue;
                    const d = (o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y);
                    if (d < bestD) {
                        bestD = d;
                        best = o;
                    }
                }
                if (best) this._ignite(best, e.burnDps, 3, e.burnDps);
            }
        }
    }

    // ==================== 敌人 ====================

    private _updateIceFields(dt: number): void {
        if (this.iceFields.length === 0) return;
        const out: Array<{ x: number; y: number; t: number; r: number }> = [];
        for (const f of this.iceFields) {
            f.t -= dt;
            if (f.t > 0) out.push(f);
        }
        this.iceFields = out;
    }

    /** 冻结 / 减速 / 毒 / 燃烧，全部确定性，不消耗随机数 */
    private _tickStatus(e: Enemy, dt: number): void {
        if (e.freezeT > 0) e.freezeT = Math.max(0, e.freezeT - dt);
        if (e.slowT > 0) {
            e.slowT -= dt;
            if (e.slowT <= 0) {
                e.slowT = 0;
                e.slowMul = 1;
            }
        }
        if (e.poisonT > 0) {
            e.poisonT -= dt;
            this._damageEnemy(e, e.poisonDps * dt, true);
            if (e.hp <= 0) return;
        }
        if (e.burnT > 0) {
            e.burnT -= dt;
            this._damageEnemy(e, e.burnDps * dt, true);
        }
    }

    /** 减速倍率：道具冷却管 0.8、冰面 0.5、状态减速取相乘 */
    private _enemySpeedMul(e: Enemy): number {
        let m = e.slowT > 0 ? e.slowMul : 1;
        if (this.hasItem('coolant')) m *= 0.8;
        if (this.hasCurse(HEAT_CURSE_FAST)) m *= HEAT_FAST_MUL;
        for (const f of this.iceFields) {
            if ((e.x - f.x) * (e.x - f.x) + (e.y - f.y) * (e.y - f.y) <= (f.r + e.r) * (f.r + e.r)) {
                m *= 0.5;
                break;
            }
        }
        return m;
    }

    private _updateEnemies(dt: number): void {
        const p = this.player;
        const out: Enemy[] = [];
        for (const e of this.enemies) {
            if (e.hp <= 0) continue;
            if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);
            this._tickStatus(e, dt);
            if (e.hp <= 0) continue; // 毒 / 燃烧可能刚好致死
            const def = ENEMY_DEFS[e.kind] || BOSS_DEFS[this.floor] || ENEMY_DEFS.moldball;
            const dx = p.x - e.x;
            const dy = p.y - e.y;
            const dist = Math.hypot(dx, dy) || 1;
            const nx = dx / dist;
            const ny = dy / dist;
            const spd = e.speed * this._enemySpeedMul(e);
            const frozen = e.freezeT > 0;
            if (!frozen) e.timer += dt;

            // 冷凝炸弹：贴近玩家自爆
            if (!frozen && e.kind === 'conddrop' && dist <= 56) {
                this._explode(e.x, e.y, 72, 12, e.id);
                if (Math.hypot(p.x - e.x, p.y - e.y) <= 72) this._damagePlayer(e.dmg);
                e.hp = 0;
                continue;
            }
            // 卡带：每 8 秒召唤 1 只 bug
            if (!frozen && e.kind === 'cartridge' && e.timer >= 8) {
                e.timer = 0;
                this.spawnEnemy('bug', clamp(e.x + 30, ARENA_MIN_X + 20, ARENA_MAX_X - 20), e.y);
            }

            if (frozen) {
                // 冻结：不走位、不攻击，但接触伤害仍生效
            } else if (isBossKind(e.kind)) {
                this._updateBoss(e, dt, nx, ny, dist);
            } else switch (def.ai) {
                case 'chase': {
                    const stop = def.ranged ? 150 : 0;
                    if (dist > stop) {
                        e.x += nx * spd * dt;
                        e.y += ny * spd * dt;
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
                    e.x += e.vx * dt * this._enemySpeedMul(e);
                    e.y += e.vy * dt * this._enemySpeedMul(e);
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
                        e.x += nx * spd * 2.6 * dt;
                        e.y += ny * spd * 2.6 * dt;
                    } else if (phaseT - dt < 0.45) {
                        // 冲刺方向在每次蓄力结束时刷新
                        e.vx = nx;
                        e.vy = ny;
                    } else {
                        e.x += nx * spd * 0.2 * dt;
                        e.y += ny * spd * 0.2 * dt;
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
                        e.x += nx * spd * dt;
                        e.y += ny * spd * dt;
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
            if (room && !room.cleared && this._isCombatRoom(room) && this.enemies.length === 0) {
                this._clearRoom(room);
            }
        }
    }

    /**
     * Boss 分派（M4：四层各一套）。所有攻击 ≥0.4s 前摇，弹幕角度确定性（不依赖随机）。
     * 通用冲刺：0.4–0.5s 前摇 → 0.5s 直线冲刺。
     */
    private _updateBoss(e: Enemy, dt: number, nx: number, ny: number, dist: number): void {
        const phase2 = e.hp <= e.maxHp * 0.5;
        e.gen = phase2 ? 2 : 1;
        e.atk += dt;

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
            e.x += e.vx * dt * this._enemySpeedMul(e);
            e.y += e.vy * dt * this._enemySpeedMul(e);
            return;
        }

        switch (e.kind) {
            case 'moldking':
                this._bossMoldking(e, dt, nx, ny, dist, phase2);
                break;
            case 'stitchbear':
                this._bossStitchbear(e, dt, nx, ny, dist, phase2);
                break;
            case 'bluescreen':
                this._bossBluescreen(e, dt, nx, ny, dist, phase2);
                break;
            default:
                this._bossCompressor(e, dt, nx, ny, dist, phase2);
                break;
        }
    }

    /** Boss 走位：保持 far–near 距离带 */
    private _bossWalk(e: Enemy, dt: number, nx: number, ny: number, dist: number,
        speed: number, far = 260, near = 150): void {
        if (dist > far) {
            e.x += nx * speed * dt;
            e.y += ny * speed * dt;
        } else if (dist < near) {
            e.x -= nx * speed * 0.7 * dt;
            e.y -= ny * speed * 0.7 * dt;
        }
    }

    /** 第 1 层霉王：三向孢子 + 召唤霉球；半血后五向弧弹 + 冲刺 */
    private _bossMoldking(e: Enemy, dt: number, nx: number, ny: number, dist: number, phase2: boolean): void {
        const def = BOSS_DEFS[1];
        this._bossWalk(e, dt, nx, ny, dist, def.speed * this._enemySpeedMul(e));
        if (!phase2) {
            if (e.atk >= 1.8) {
                e.atk = 0;
                this._bossSpores(e, nx, ny, 3, 0.38, 165);
            }
            if (e.timer >= 7) {
                e.timer = 0;
                this._bossSummon(e, 'moldball', 2);
            }
        } else {
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

    /** 第 2 层缝线熊：棉花四向 + 召唤钟表兵；半血后六向 + 高频冲刺 */
    private _bossStitchbear(e: Enemy, dt: number, nx: number, ny: number, dist: number, phase2: boolean): void {
        const def = BOSS_DEFS[2];
        this._bossWalk(e, dt, nx, ny, dist, def.speed * this._enemySpeedMul(e), 240, 130);
        if (!phase2) {
            if (e.atk >= 1.6) {
                e.atk = 0;
                this._bossSpores(e, nx, ny, 4, 0.35, 150);
            }
            if (e.timer >= 6) {
                e.timer = 0;
                this._bossSummon(e, 'clockbot', 2);
            }
        } else {
            if (e.atk >= 1.2) {
                e.atk = 0;
                this._bossSpores(e, nx, ny, 6, 0.28, 175);
            }
            if (e.timer >= 4.5) {
                e.timer = 0;
                e.windup = 0.5;
            }
        }
    }

    /** 第 3 层蓝屏：十字报错弹 + 传送；半血后环形弹 + 全场冻结 1s */
    private _bossBluescreen(e: Enemy, dt: number, nx: number, ny: number, dist: number, phase2: boolean): void {
        const def = BOSS_DEFS[3];
        this._bossWalk(e, dt, nx, ny, dist, def.speed * this._enemySpeedMul(e), 300, 180);
        if (!phase2) {
            if (e.atk >= 1.5) {
                e.atk = 0;
                this._bossCross(e, nx, ny, 4, 150);
            }
            if (e.timer >= 5) {
                e.timer = 0;
                const pos = this._randomSpawnPos();
                e.x = pos.x;
                e.y = pos.y;
            }
        } else {
            if (e.atk >= 1.1) {
                e.atk = 0;
                this._bossRing(e, 8, 0.5, 155);
            }
            if (e.timer >= 7) {
                e.timer = 0;
                // 全场冻结：玩家 1s 不能移动（不无敌）
                this.player.rootT = Math.max(this.player.rootT, 1);
                this._events.push({ type: 'boom', x: this.player.x, y: this.player.y, r: 80 });
            }
        }
    }

    /** 第 4 层压缩机之心：冷风扇形 + 活塞拍击；半血后环形弹 + 拉拽场 */
    private _bossCompressor(e: Enemy, dt: number, nx: number, ny: number, dist: number, phase2: boolean): void {
        const def = BOSS_DEFS[4];
        this._bossWalk(e, dt, nx, ny, dist, def.speed * this._enemySpeedMul(e), 230, 120);
        if (!phase2) {
            if (e.atk >= 1.7) {
                e.atk = 0;
                this._bossSpores(e, nx, ny, 5, 0.22, 170);
            }
            if (e.timer >= 5) {
                e.timer = 0;
                e.windup = 0.5; // 活塞前摇后直接冲向玩家
            }
        } else {
            if (e.atk >= 1.3) {
                e.atk = 0;
                this._bossRing(e, 10, 0, 160);
            }
            if (e.special > 0) {
                e.special = Math.max(0, e.special - dt);
                const p = this.player;
                const dx = e.x - p.x;
                const dy = e.y - p.y;
                const d = Math.hypot(dx, dy) || 1;
                p.x = clamp(p.x + (dx / d) * 90 * dt, ARENA_MIN_X + PLAYER_R, ARENA_MAX_X - PLAYER_R);
                p.y = clamp(p.y + (dy / d) * 90 * dt, ARENA_MIN_Y + PLAYER_R, ARENA_MAX_Y - PLAYER_R);
            }
            if (e.timer >= 6) {
                e.timer = 0;
                e.special = 1.2;
                this._events.push({ type: 'boom', x: e.x, y: e.y, r: 110 });
            }
        }
    }

    private _bossSummon(e: Enemy, kind: string, count: number): void {
        for (let i = 0; i < count; i++) {
            if (this.enemies.length >= MAX_ENEMIES) return;
            const a = (Math.PI * 2 * i) / Math.max(1, count) + 0.6;
            this.spawnEnemy(kind,
                clamp(e.x + Math.cos(a) * 50, ARENA_MIN_X + 20, ARENA_MAX_X - 20),
                clamp(e.y + Math.sin(a) * 50, ARENA_MIN_Y + 20, ARENA_MAX_Y - 20));
        }
    }

    /** 十字（90° 间隔）弹幕 */
    private _bossCross(e: Enemy, nx: number, ny: number, count: number, speed: number): void {
        const base = Math.atan2(ny, nx);
        for (let i = 0; i < count; i++) this._bossBullet(e, base + (Math.PI * 2 * i) / count, speed);
    }

    /** 环形弹幕（offset 让环错开，避免每波重叠） */
    private _bossRing(e: Enemy, count: number, offset: number, speed: number): void {
        for (let i = 0; i < count; i++) {
            this._bossBullet(e, (Math.PI * 2 * i) / count + offset, speed);
        }
    }

    private _bossBullet(e: Enemy, a: number, speed: number): void {
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
            wallPierce: 0,
            kind: 'tear',
            hitIds: [],
        });
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
                wallPierce: 0,
                kind: 'tear',
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
            wallPierce: 0,
            kind: 'tear',
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
        // 焦糖壳：受伤时减速周围敌人
        if (this.hasItem('caramel')) {
            for (const e of this.enemies) {
                if (e.hp <= 0) continue;
                if (Math.hypot(e.x - p.x, e.y - p.y) <= 70) this._slow(e, 0.6, 1.5);
            }
        }
        this._events.push({ type: 'playerHit', x: p.x, y: p.y });
        if (p.hp > 0) return;

        // 保鲜膜：每层首次死亡免疫，保留 1 半心
        if (this.hasItem('wrap') && !p.deathWardUsed) {
            p.deathWardUsed = true;
            p.hp = 1;
            p.invuln = Math.max(p.invuln, 1.5);
            this._events.push({ type: 'boom', x: p.x, y: p.y, r: 60 });
            return;
        }
        // 存档点（主动）：本房间一次，消耗全部充能原地复活
        if (this.activeItem === 'savepoint' && p.savepointUsedRoom !== this.roomId) {
            const cost = this.activeCost();
            if (p.charges >= cost) {
                p.charges -= cost;
                p.savepointUsedRoom = this.roomId;
                p.hp = p.maxHp;
                p.invuln = Math.max(p.invuln, 2);
                this._events.push({ type: 'active', name: 'savepoint', x: p.x, y: p.y });
                return;
            }
        }
        this.phase = 'dead';
        this._events.push({ type: 'dead' });
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
                    p.bombs = Math.min(this._maxBombs(), p.bombs + 1);
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
        if (p.bombs < 0 || p.bombs > this._maxBombs()) errs.push(`炸弹越界 ${p.bombs}`);
        if (p.charges < 0 || p.charges > p.maxCharges) errs.push(`充能越界 ${p.charges}`);
        if (this.pendingCore && this.pendingCore.length !== 3) errs.push('核心三选一数量不为 3');
        if (this.phase === 'won' && this.floor !== 4) errs.push(`非第 4 层却已通关（floor=${this.floor}）`);
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
