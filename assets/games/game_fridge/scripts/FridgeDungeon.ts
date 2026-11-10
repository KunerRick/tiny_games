/**
 * 冰箱底下 — 地牢地图生成 + 存档快照（规格 §6.4 / §13）。纯逻辑，不 import 'cc'。
 *
 * 覆盖 M2 所需：
 *  - `generateFloor(seed, floor)`：7×7 网格上的确定性随机游走树（7 房 + 1 秘密房）
 *  - `RunSave` / `FridgeSave` 的类型、序列化、净化（sanitizeRun / sanitizeMeta）与迁移
 *  - 存储适配层：微信 `wx.*StorageSync` → 浏览器 `localStorage` → 内存，均可注入（自检用）
 *
 * 确定性约定：地图 RNG 的种子 = `(seed ^ floor * 0x9E3779B1) ^ 尝试序号派生子种子`，
 * 同一 (seed, floor) 必然得到同一张图；RNG 只用于地图与房间刷怪，调用顺序固定。
 */

import { CHAR_BY_ID, ITEM_BY_ID, clamp, mulberry32 } from './FridgeConfig';

// ==================== 地图结构 ====================

export const MAP_W = 7;
export const MAP_H = 7;
/** 每层常规房间数（§6.2：7 房 = 起点 + 4 战斗 + 宝箱 + Boss 等） */
export const ROOM_COUNT = 7;

export type Dir = 'up' | 'down' | 'left' | 'right';
export type RoomKind = 'start' | 'fight' | 'treasure' | 'shop' | 'altar' | 'boss' | 'secret';

export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export const DIR_DELTA: Record<Dir, { x: number; y: number }> = {
    up: { x: 0, y: 1 },
    down: { x: 0, y: -1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};

export function oppositeDir(d: Dir): Dir {
    if (d === 'up') return 'down';
    if (d === 'down') return 'up';
    if (d === 'left') return 'right';
    return 'left';
}

export const ROOM_LABEL: Record<RoomKind, string> = {
    start: '起点',
    fight: '战斗房',
    treasure: '宝箱房',
    shop: '商店',
    altar: '祭坛',
    boss: 'Boss 房',
    secret: '秘密房',
};

export const ROOM_KINDS: readonly RoomKind[] = ['start', 'fight', 'treasure', 'shop', 'altar', 'boss', 'secret'];

export interface RoomNode {
    id: number;
    /** 7×7 网格坐标 */
    x: number;
    y: number;
    kind: RoomKind;
    /** 到起点的 BFS 距离 */
    depth: number;
    doors: Dir[];
    cleared: boolean;
    visited: boolean;
}

export interface FloorMap {
    floor: number;
    rooms: RoomNode[];
    startId: number;
    bossId: number;
    secretId: number | null;
}

// ==================== 地图生成 ====================

interface BuildCell {
    x: number;
    y: number;
    id: number;
    /** 出边方向（树边） */
    dirs: Dir[];
}

function inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
}

function cellKey(x: number, y: number): number {
    return y * MAP_W + x;
}

/** 随机游走建一棵恰 n 个节点的树；失败（走不动）返回 null，由外层换子种子重试 */
function buildTree(rng: () => number, n: number): { cells: BuildCell[]; startIdx: number } | null {
    const cells: BuildCell[] = [];
    const occupied = new Set<number>();

    const add = (x: number, y: number): BuildCell => {
        const c: BuildCell = { x, y, id: cells.length, dirs: [] };
        cells.push(c);
        occupied.add(cellKey(x, y));
        return c;
    };
    const freeDirs = (c: BuildCell): Dir[] => {
        const out: Dir[] = [];
        for (const d of DIRS) {
            const nx = c.x + DIR_DELTA[d].x;
            const ny = c.y + DIR_DELTA[d].y;
            if (inBounds(nx, ny) && !occupied.has(cellKey(nx, ny))) out.push(d);
        }
        return out;
    };
    const connect = (a: BuildCell, b: BuildCell, d: Dir): void => {
        a.dirs.push(d);
        b.dirs.push(oppositeDir(d));
    };

    let cur = add(3, 3);
    let guard = 0;
    while (cells.length < n && guard++ < 400) {
        const opts = freeDirs(cur);
        if (opts.length > 0) {
            const d = opts[Math.floor(rng() * opts.length)];
            const nx = cur.x + DIR_DELTA[d].x;
            const ny = cur.y + DIR_DELTA[d].y;
            const next = add(nx, ny);
            connect(cur, next, d);
            cur = next;
            continue;
        }
        const movable: BuildCell[] = [];
        for (const c of cells) if (freeDirs(c).length > 0) movable.push(c);
        if (movable.length === 0) break;
        cur = movable[Math.floor(rng() * movable.length)];
    }
    if (cells.length !== n) return null;
    return { cells, startIdx: 0 };
}

function bfsDepths(cells: BuildCell[], startIdx: number): number[] {
    const depth: number[] = cells.map(() => -1);
    depth[startIdx] = 0;
    const queue: number[] = [startIdx];
    while (queue.length > 0) {
        const id = queue.shift() as number;
        const c = cells[id];
        for (const d of c.dirs) {
            const nx = c.x + DIR_DELTA[d].x;
            const ny = c.y + DIR_DELTA[d].y;
            const ni = cells.findIndex((o) => o.x === nx && o.y === ny);
            if (ni < 0 || depth[ni] >= 0) continue;
            depth[ni] = depth[id] + 1;
            queue.push(ni);
        }
    }
    return depth;
}

/** 每层必须出现的特殊房（§6.2 固定分配） */
export function specialKindsForFloor(floor: number): RoomKind[] {
    if (floor === 1) return ['treasure'];
    if (floor === 2) return ['treasure', 'shop'];
    if (floor === 3 || floor === 4) return ['treasure', 'altar'];
    return ['treasure'];
}

function finalizeFloor(cells: BuildCell[], floor: number, rng: () => number): FloorMap {
    const depth = bfsDepths(cells, 0);
    const rooms: RoomNode[] = cells.map((c, i) => ({
        id: i,
        x: c.x,
        y: c.y,
        kind: (i === 0 ? 'start' : 'fight') as RoomKind,
        depth: depth[i] < 0 ? 0 : depth[i],
        doors: c.dirs.slice(),
        cleared: false,
        visited: false,
    }));
    const startId = 0;

    // Boss = 距离最远的节点（同距离取索引靠前者）
    let bossId = -1;
    for (let i = 1; i < rooms.length; i++) {
        if (bossId < 0) {
            bossId = i;
        } else if (rooms[i].depth > rooms[bossId].depth) {
            bossId = i;
        }
    }
    if (bossId < 0) bossId = 0;
    if (bossId !== startId) rooms[bossId].kind = 'boss';

    // 特殊房：叶子按离起点从近到远取；叶子不够时从度 ≥2 节点里取最远的补位
    const used = new Set<number>([startId, bossId]);
    const byDepthAsc = (a: RoomNode, b: RoomNode) => (a.depth - b.depth) || (a.id - b.id);
    const byDepthDesc = (a: RoomNode, b: RoomNode) => (b.depth - a.depth) || (a.id - b.id);
    const leaves = rooms.filter((r) => !used.has(r.id) && r.doors.length === 1).sort(byDepthAsc);
    const backfill = rooms.filter((r) => !used.has(r.id) && r.doors.length >= 2).sort(byDepthDesc);

    for (const kind of specialKindsForFloor(floor)) {
        let target: RoomNode | null = null;
        while (!target && leaves.length > 0) {
            const cand = leaves.shift() as RoomNode;
            if (!used.has(cand.id)) target = cand;
        }
        while (!target && backfill.length > 0) {
            const cand = backfill.shift() as RoomNode;
            if (!used.has(cand.id)) target = cand;
        }
        if (!target) {
            // 极端兜底：任意剩下的非起点 / 非 Boss 房
            const rest = rooms.filter((r) => !used.has(r.id));
            if (rest.length > 0) target = rest[0];
        }
        if (!target) break;
        target.kind = kind;
        used.add(target.id);
    }

    // 秘密房：空格里四邻接 ≥2 个房间；没有则退回只邻接 1 个的格子
    const normalByCell = new Map<number, RoomNode>();
    for (const r of rooms) normalByCell.set(cellKey(r.x, r.y), r);
    const pickSecret = (minAdj: number): { x: number; y: number; dirs: Dir[] } | null => {
        const cands: { x: number; y: number; dirs: Dir[] }[] = [];
        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                if (normalByCell.has(cellKey(x, y))) continue;
                const dirs: Dir[] = [];
                for (const d of DIRS) {
                    const nx = x + DIR_DELTA[d].x;
                    const ny = y + DIR_DELTA[d].y;
                    if (normalByCell.has(cellKey(nx, ny))) dirs.push(d);
                }
                if (dirs.length >= minAdj) cands.push({ x, y, dirs });
            }
        }
        if (cands.length === 0) return null;
        return cands[Math.floor(rng() * cands.length)];
    };
    let secretId: number | null = null;
    const spot = pickSecret(2) || pickSecret(1);
    if (spot) {
        let minDepth = Infinity;
        for (const d of spot.dirs) {
            const nb = normalByCell.get(cellKey(spot.x + DIR_DELTA[d].x, spot.y + DIR_DELTA[d].y));
            if (nb && nb.depth < minDepth) minDepth = nb.depth;
        }
        rooms.push({
            id: rooms.length,
            x: spot.x,
            y: spot.y,
            kind: 'secret',
            depth: (isFinite(minDepth) ? minDepth : 0) + 1,
            doors: spot.dirs,
            cleared: false,
            visited: false,
        });
        secretId = rooms.length - 1;
    }

    return { floor, rooms, startId, bossId, secretId };
}

function degenerateFloor(floor: number): FloorMap {
    const rooms: RoomNode[] = [{
        id: 0, x: 3, y: 3, kind: 'start', depth: 0, doors: [], cleared: false, visited: false,
    }];
    return { floor, rooms, startId: 0, bossId: 0, secretId: null };
}

/** 确定性生成一层地图：同一 (seed, floor) 逐字节一致（§6.4） */
export function generateFloor(seed: number, floor: number): FloorMap {
    const base = (((seed >>> 0) ^ Math.imul(floor, 0x9E3779B1)) >>> 0);
    for (let attempt = 0; attempt < 32; attempt++) {
        const sub = (((base ^ Math.imul(attempt, 0x85EBCA6B)) >>> 0));
        const rng = mulberry32(sub);
        const built = buildTree(rng, ROOM_COUNT);
        if (!built) continue;
        return finalizeFloor(built.cells, floor, rng);
    }
    return degenerateFloor(floor);
}

// ==================== 地图查询 ====================

export function roomAt(map: FloorMap, x: number, y: number): RoomNode | null {
    for (const r of map.rooms) if (r.x === x && r.y === y) return r;
    return null;
}

export function neighborOf(map: FloorMap, room: RoomNode, dir: Dir): RoomNode | null {
    return roomAt(map, room.x + DIR_DELTA[dir].x, room.y + DIR_DELTA[dir].y);
}

/** 常规房间（排除秘密房）数量 */
export function normalRoomCount(map: FloorMap): number {
    let n = 0;
    for (const r of map.rooms) if (r.kind !== 'secret') n++;
    return n;
}

// ==================== 存档快照（§13.2） ====================

export const RUN_KEY = 'tiny_games_fridge_run';
export const META_KEY = 'tiny_games_fridge_meta';
export const BACKUP_KEY = 'tiny_games_fridge_backup';

export const CURRENT_RUN_VERSION = 2;
export const CURRENT_META_VERSION = 2;

export interface RoomNodeSave {
    x: number;
    y: number;
    kind: RoomKind;
    doors: Dir[];
    cleared: boolean;
    visited: boolean;
}

/**
 * 与 §14.1 的 FloorMap 同构。**偏差说明**：`nodes` 里额外存了 `doors`。
 * 规格原文写的是「doors 由 nodes 邻接推导」，但随机游走树里两个相邻格不一定有门，
 * 只按邻接推导会把无门的相邻房误连成门 —— 所以这里显式存 doors（7 房 × ≤4 个方向，体积可忽略）。
 */
export interface FloorMapSave {
    w: number;
    h: number;
    nodes: RoomNodeSave[];
    startId: number;
    bossId: number;
    secretId: number | null;
}

export interface RunSave {
    schemaVersion: 2;
    runId: string;
    mode: 'normal' | 'daily' | 'heat';
    seed: number;
    /** mulberry32 当前状态（uint32）——不存它续玩后的掉落序列就变了 */
    rngState: number;
    charId: string;
    floor: 1 | 2 | 3 | 4;
    startFloor: 1 | 2;
    heatCurses: string[];
    map: FloorMapSave | null;
    roomId: number;
    enteringFrom: Dir | null;
    player: {
        hp: number;
        maxHp: number;
        coins: number;
        bombs: number;
        charges: number;
        maxCharges: number;
        frozenSpeedPenalty: number;
    };
    items: string[];
    activeItem: string | null;
    cores: string[];
    treasure: { offered: string[]; rerolled: boolean } | null;
    shop: { stock: (string | null)[]; rerolled: boolean } | null;
    savedAt: number;
    gameVersion: string;
}

export interface FridgeSave {
    schemaVersion: 2;
    magnets: number;
    unlocks: string[];
    seenItems: string[];
    stats: {
        runs: number;
        wins: number;
        kills: number;
        secrets: number;
        bestFloor: number;
        spent: number;
        charClears: string[];
    };
    daily: { date: string; charId: string; bestFloor: number; cleared: boolean } | null;
    settings: { sfx: boolean; music: boolean; shake: boolean };
}

export function serializeFloorMap(map: FloorMap | null): FloorMapSave | null {
    if (!map) return null;
    return {
        w: MAP_W,
        h: MAP_H,
        nodes: map.rooms.map((r) => ({
            x: r.x,
            y: r.y,
            kind: r.kind,
            doors: r.doors.slice(),
            cleared: r.cleared,
            visited: r.visited,
        })),
        startId: map.startId,
        bossId: map.bossId,
        secretId: map.secretId,
    };
}

function isDir(v: unknown): v is Dir {
    return v === 'up' || v === 'down' || v === 'left' || v === 'right';
}

function isRoomKind(v: unknown): v is RoomKind {
    return typeof v === 'string' && (ROOM_KINDS as readonly string[]).indexOf(v) >= 0;
}

/** 反序列化地图并重算 depth（depth 不入档，BFS 重算；更省体积也不怕旧档 depth 过期） */
export function floorMapFromSave(save: FloorMapSave, floor: number): FloorMap | null {
    const rooms: RoomNode[] = [];
    for (let i = 0; i < save.nodes.length; i++) {
        const n = save.nodes[i];
        if (!n || !isRoomKind(n.kind)) return null;
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return null;
        if (n.x < 0 || n.y < 0 || n.x >= MAP_W || n.y >= MAP_H) return null;
        const doors: Dir[] = [];
        if (Array.isArray(n.doors)) {
            for (const d of n.doors) if (isDir(d) && doors.indexOf(d) < 0) doors.push(d);
        }
        rooms.push({
            id: i,
            x: Math.round(n.x),
            y: Math.round(n.y),
            kind: n.kind,
            depth: 0,
            doors,
            cleared: !!n.cleared,
            visited: !!n.visited,
        });
    }
    if (rooms.length === 0) return null;
    if (!Number.isInteger(save.startId) || save.startId < 0 || save.startId >= rooms.length) return null;
    if (!Number.isInteger(save.bossId) || save.bossId < 0 || save.bossId >= rooms.length) return null;
    const secretId = save.secretId === null || save.secretId === undefined ? null : save.secretId;
    if (secretId !== null && (!Number.isInteger(secretId) || secretId < 0 || secretId >= rooms.length)) return null;

    // BFS 重算 depth
    const depth = rooms.map(() => -1);
    depth[save.startId] = 0;
    const queue: number[] = [save.startId];
    while (queue.length > 0) {
        const id = queue.shift() as number;
        const r = rooms[id];
        for (const d of r.doors) {
            const nb = roomAt({ floor, rooms, startId: save.startId, bossId: save.bossId, secretId }, r.x + DIR_DELTA[d].x, r.y + DIR_DELTA[d].y);
            if (!nb || depth[nb.id] >= 0) continue;
            depth[nb.id] = depth[id] + 1;
            queue.push(nb.id);
        }
    }
    for (let i = 0; i < rooms.length; i++) rooms[i].depth = depth[i] < 0 ? 0 : depth[i];
    // 秘密房没有反向门，BFS 到不了：按「相邻最浅房间 +1」补算，与 finalizeFloor 一致
    for (const r of rooms) {
        if (depth[r.id] >= 0) continue;
        let minDepth = Infinity;
        for (const d of DIRS) {
            const nb = roomAt({ floor, rooms, startId: save.startId, bossId: save.bossId, secretId }, r.x + DIR_DELTA[d].x, r.y + DIR_DELTA[d].y);
            if (nb && nb.id !== r.id && depth[nb.id] >= 0 && depth[nb.id] < minDepth) minDepth = depth[nb.id];
        }
        r.depth = isFinite(minDepth) ? minDepth + 1 : 0;
    }

    return { floor, rooms, startId: save.startId, bossId: save.bossId, secretId };
}

/** 净化一局快照：任何字段非法都返回 null（上层据此走「没有可续玩的局」） */
export function sanitizeRun(raw: unknown): RunSave | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, any>;
    const ver = Number(o.schemaVersion);
    if (!Number.isFinite(ver) || ver > CURRENT_RUN_VERSION) return null;
    const seed = Number(o.seed);
    if (!Number.isFinite(seed)) return null;
    const charId = typeof o.charId === 'string' && CHAR_BY_ID[o.charId] ? o.charId : null;
    if (!charId) return null;
    const floor = Math.round(Number(o.floor));
    if (!(floor >= 1 && floor <= 4)) return null;
    if (!o.map || typeof o.map !== 'object') return null;
    const ms = o.map as FloorMapSave;
    if (!Array.isArray(ms.nodes) || ms.nodes.length === 0 || ms.nodes.length > MAP_W * MAP_H) return null;
    const map = floorMapFromSave(ms, floor);
    if (!map) return null;
    const roomId = Math.round(Number(o.roomId));
    if (!Number.isInteger(roomId) || roomId < 0 || roomId >= map.rooms.length) return null;

    const p = (o.player && typeof o.player === 'object' ? o.player : {}) as Record<string, any>;
    const maxHpRaw = Math.round(Number(p.maxHp));
    const maxHp = clamp(Number.isFinite(maxHpRaw) ? maxHpRaw : 6, 2, 12);
    const hpRaw = Math.round(Number(p.hp));
    const hp = clamp(Number.isFinite(hpRaw) ? hpRaw : maxHp, 1, maxHp);
    const maxCharges = clamp(Math.round(Number(p.maxCharges)) || 3, 1, 9);
    const charges = clamp(Math.round(Number(p.charges)) || 0, 0, maxCharges);
    const coins = Math.max(0, Math.floor(Number(p.coins)) || 0);
    const bombs = clamp(Math.round(Number(p.bombs)) || 0, 0, 9);
    const frozen = clamp(Number(p.frozenSpeedPenalty) || 0, 0, 0.4);

    const items: string[] = [];
    if (Array.isArray(o.items)) {
        for (const id of o.items) {
            if (typeof id === 'string' && ITEM_BY_ID[id]) items.push(id);
        }
    }
    const cores: string[] = [];
    if (Array.isArray(o.cores)) {
        for (const id of o.cores) if (typeof id === 'string') cores.push(id);
    }
    const activeItem = typeof o.activeItem === 'string' && ITEM_BY_ID[o.activeItem] ? o.activeItem : null;

    let treasure: RunSave['treasure'] = null;
    if (o.treasure && typeof o.treasure === 'object' && Array.isArray(o.treasure.offered)) {
        const offered: string[] = [];
        for (const id of o.treasure.offered) {
            if (typeof id === 'string' && ITEM_BY_ID[id] && offered.indexOf(id) < 0) offered.push(id);
        }
        if (offered.length === 3) treasure = { offered, rerolled: !!o.treasure.rerolled };
    }

    const enteringFrom = isDir(o.enteringFrom) ? o.enteringFrom : null;
    const rngState = Number(o.rngState);
    return {
        schemaVersion: 2,
        runId: typeof o.runId === 'string' && o.runId ? o.runId : `run-${seed}`,
        mode: o.mode === 'daily' || o.mode === 'heat' ? o.mode : 'normal',
        seed: seed >>> 0,
        rngState: Number.isFinite(rngState) ? rngState >>> 0 : 0,
        charId,
        floor: floor as 1 | 2 | 3 | 4,
        startFloor: o.startFloor === 2 ? 2 : 1,
        heatCurses: Array.isArray(o.heatCurses) ? o.heatCurses.filter((c: unknown) => typeof c === 'string') : [],
        map: serializeFloorMap(map),
        roomId,
        enteringFrom,
        player: { hp, maxHp, coins, bombs, charges, maxCharges, frozenSpeedPenalty: frozen },
        items,
        activeItem,
        cores,
        treasure,
        shop: null,
        savedAt: Number(o.savedAt) || 0,
        gameVersion: typeof o.gameVersion === 'string' ? o.gameVersion : '',
    };
}

/** 旧档迁移：目前只有 v2；未来字段只增不改，逐级升版（§13.4） */
export function migrateRun(raw: unknown): RunSave | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, any>;
    const ver = Number(o.schemaVersion);
    if (Number.isFinite(ver) && ver > CURRENT_RUN_VERSION) return null; // 未来版本：不覆盖、不崩
    if (!Number.isFinite(ver)) o.schemaVersion = 1; // 无版本号的极旧档按 v1 处理
    // v1 → v2：v1 没有 rngState / treasure / enteringFrom，sanitizeRun 会补默认值
    return sanitizeRun(o);
}

export function defaultMeta(): FridgeSave {
    return {
        schemaVersion: 2,
        magnets: 0,
        unlocks: [],
        seenItems: [],
        stats: { runs: 0, wins: 0, kills: 0, secrets: 0, bestFloor: 0, spent: 0, charClears: [] },
        daily: null,
        settings: { sfx: true, music: true, shake: true },
    };
}

/** 净化 meta：字段按类型夹取，缺失补默认值 */
export function sanitizeMeta(raw: unknown): FridgeSave {
    const base = defaultMeta();
    if (!raw || typeof raw !== 'object') return base;
    const o = raw as Record<string, any>;
    const magnets = Math.floor(Number(o.magnets));
    if (Number.isFinite(magnets) && magnets > 0) base.magnets = magnets;
    if (Array.isArray(o.unlocks)) base.unlocks = o.unlocks.filter((x: unknown) => typeof x === 'string');
    if (Array.isArray(o.seenItems)) {
        base.seenItems = o.seenItems.filter((x: unknown) => typeof x === 'string' && !!ITEM_BY_ID[x as string]);
    }
    const s = (o.stats && typeof o.stats === 'object' ? o.stats : {}) as Record<string, any>;
    const num = (v: unknown): number => {
        const n = Math.floor(Number(v));
        return Number.isFinite(n) && n > 0 ? n : 0;
    };
    base.stats = {
        runs: num(s.runs),
        wins: num(s.wins),
        kills: num(s.kills),
        secrets: num(s.secrets),
        bestFloor: clamp(num(s.bestFloor), 0, 4),
        spent: num(s.spent),
        charClears: Array.isArray(s.charClears) ? s.charClears.filter((x: unknown) => typeof x === 'string') : [],
    };
    if (o.daily && typeof o.daily === 'object') {
        const d = o.daily as Record<string, any>;
        base.daily = {
            date: typeof d.date === 'string' ? d.date : '',
            charId: typeof d.charId === 'string' ? d.charId : 'pudding',
            bestFloor: clamp(num(d.bestFloor), 0, 4),
            cleared: !!d.cleared,
        };
    }
    if (o.settings && typeof o.settings === 'object') {
        const st = o.settings as Record<string, any>;
        base.settings = { sfx: st.sfx !== false, music: st.music !== false, shake: st.shake !== false };
    }
    return base;
}

/** meta 迁移：v1 只有 magnets / unlocks / seenItems / stats，其余补默认值（§13.4 纪律 1） */
export function migrateMeta(raw: unknown): FridgeSave {
    if (!raw || typeof raw !== 'object') return defaultMeta();
    const o = raw as Record<string, any>;
    const ver = Number(o.schemaVersion);
    if (Number.isFinite(ver) && ver > CURRENT_META_VERSION) return defaultMeta(); // 未来版本：起步默认值，原件由调用方备份
    return sanitizeMeta(o);
}

// ==================== 存储适配（微信 / 浏览器 / 内存） ====================

export interface FridgeStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

interface WxLike {
    getStorageSync?: (k: string) => unknown;
    setStorageSync?: (k: string, v: string) => void;
    removeStorageSync?: (k: string) => void;
}

/** 内存存储：自检 / 无 localStorage 环境兜底 */
export function createMemoryStore(): FridgeStore {
    const map = new Map<string, string>();
    return {
        getItem(k: string): string | null {
            const v = map.get(k);
            return v === undefined ? null : v;
        },
        setItem(k: string, v: string): void {
            map.set(k, v);
        },
        removeItem(k: string): void {
            map.delete(k);
        },
    };
}

let _fallbackStore: FridgeStore | null = null;

/** 优先微信同步存储（§13.3：写档用同步 API），其次 localStorage，最后内存 */
export function defaultStore(): FridgeStore {
    const g = globalThis as unknown as { wx?: WxLike; localStorage?: FridgeStore };
    const wx = g.wx;
    if (wx && typeof wx.getStorageSync === 'function' && typeof wx.setStorageSync === 'function') {
        return {
            getItem(k: string): string | null {
                try {
                    const v = wx.getStorageSync!(k);
                    return typeof v === 'string' && v.length > 0 ? v : null;
                } catch {
                    return null;
                }
            },
            setItem(k: string, v: string): void {
                try {
                    wx.setStorageSync!(k, v);
                } catch {
                    // 存储失败不影响本局
                }
            },
            removeItem(k: string): void {
                try {
                    if (wx.removeStorageSync) wx.removeStorageSync(k);
                    else wx.setStorageSync!(k, '');
                } catch {
                    // ignore
                }
            },
        };
    }
    if (g.localStorage && typeof g.localStorage.getItem === 'function') return g.localStorage;
    if (!_fallbackStore) _fallbackStore = createMemoryStore();
    return _fallbackStore;
}

/** 备份 meta 原始字符串（坏档兜底，§13.4 纪律 4） */
export function writeBackup(raw: string, store: FridgeStore = defaultStore()): void {
    try {
        store.setItem(BACKUP_KEY, JSON.stringify({ raw, savedAt: Date.now() }));
    } catch {
        // ignore
    }
}

/** 读 meta：解析 / 迁移 / 坏档先备份再回落默认值 */
export function loadMeta(store: FridgeStore = defaultStore()): FridgeSave {
    let raw: string | null = null;
    try {
        raw = store.getItem(META_KEY);
    } catch {
        raw = null;
    }
    if (!raw) return defaultMeta();
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        writeBackup(raw, store);
        return defaultMeta();
    }
    const ver = parsed && typeof parsed === 'object' ? Number((parsed as Record<string, any>).schemaVersion) : NaN;
    if (Number.isFinite(ver) && ver > CURRENT_META_VERSION) {
        // 未来版本：原样留备份，不覆盖
        writeBackup(raw, store);
        return defaultMeta();
    }
    return migrateMeta(parsed);
}

/** 写 meta：写前把当前 meta 复制进备份键（§13.1） */
export function saveMeta(save: FridgeSave, store: FridgeStore = defaultStore()): void {
    try {
        const prev = store.getItem(META_KEY);
        if (prev) store.setItem(BACKUP_KEY, prev);
    } catch {
        // ignore
    }
    try {
        store.setItem(META_KEY, JSON.stringify(save));
    } catch {
        // ignore
    }
}

/** 写本局快照（同步；调用方负责选时机，§13.3） */
export function saveRun(world: { toSave(): RunSave }, store: FridgeStore = defaultStore()): RunSave | null {
    let snap: RunSave | null = null;
    try {
        snap = world.toSave();
    } catch {
        return null;
    }
    if (!snap) return null;
    try {
        store.setItem(RUN_KEY, JSON.stringify(snap));
        return snap;
    } catch {
        return null;
    }
}

/** 读本局快照：非法 JSON / 缺字段 / 房间 id 越界一律返回 null，不抛异常 */
export function loadRun(store: FridgeStore = defaultStore()): RunSave | null {
    let raw: string | null = null;
    try {
        raw = store.getItem(RUN_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    return migrateRun(parsed);
}

/** 死亡 / 通关：同步删档（一命制，杀进程也不能回滚） */
export function discardRun(store: FridgeStore = defaultStore()): void {
    try {
        store.removeItem(RUN_KEY);
    } catch {
        // ignore
    }
}
