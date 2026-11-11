/**
 * 守卫塔楼 —— 纯逻辑核心（不依赖 cc，可被 Node 自检直接编译）。
 *
 * 负责：从 ASCII 地图推导路径（BFS）、塔位与建造 / 升级 / 出售、波次出场、
 * 敌人沿折线移动、塔索敌与弹丸飞行、伤害 / 减速 / 溅射、金币与生命结算。
 *
 * 坐标：格子坐标 (col, row)，格心 (col + 0.5, row + 0.5)，row 0 在最上方；
 *      距离单位「格」，时间单位「秒」。
 */

import {
    TD_COLS,
    TD_ROWS,
    TD_ENEMIES,
    TD_MAPS,
    TD_MAP_COUNT,
    TD_SELL_REFUND,
    TD_TOWERS,
    TD_TOWER_MAX_LEVEL,
    TD_WAVE_COUNT,
    TD_WAVES,
    TDWaveDef,
    TDMapDef,
    TDEnemyKind,
    TDTowerKind,
    TDTargetMode,
    enemyHp,
    getTDMap,
    waveEnemyCount,
} from './TDConfig';

export interface TDPoint {
    x: number;
    y: number;
}

export interface TDTowerState {
    slotIndex: number;
    kind: TDTowerKind;
    /** 1..3 */
    level: number;
    /** 累计投入（用于出售返还） */
    invested: number;
    /** 距下一发还剩多少秒 */
    cooldown: number;
    /** 炮口朝向（弧度） */
    angle: number;
    x: number;
    y: number;
}

export interface TDSlotState {
    r: number;
    c: number;
    x: number;
    y: number;
    tower: TDTowerState | null;
}

export interface TDEnemyState {
    id: number;
    kind: TDEnemyKind;
    hp: number;
    maxHp: number;
    /** 沿路径已走的距离（格） */
    dist: number;
    speedBase: number;
    slowFactor: number;
    slowTimer: number;
    x: number;
    y: number;
    alive: boolean;
}

export interface TDShotState {
    kind: TDTowerKind;
    x: number;
    y: number;
    targetId: number;
    speed: number;
    damage: number;
    splash: number;
    slowFactor: number;
    slowDuration: number;
    ttl: number;
}

export interface TDBlastState {
    kind: TDTowerKind;
    x: number;
    y: number;
    radius: number;
    ttl: number;
    maxTtl: number;
}

export type TDPhase = 'prep' | 'running' | 'won' | 'lost';

export type TDActionReason = 'gold' | 'occupied' | 'empty' | 'max' | 'ended' | 'slot';

export interface TDActionResult {
    ok: boolean;
    reason?: TDActionReason;
    refund?: number;
    cost?: number;
}

export interface TDSnapshot {
    phase: TDPhase;
    /** 当前（running）或下一波（prep）的下标，0 起；显示时 +1 */
    waveIndex: number;
    totalWaves: number;
    gold: number;
    lives: number;
    mapId: number;
    mapName: string;
    pathPoints: TDPoint[];
    pathLength: number;
    slots: TDSlotState[];
    enemies: TDEnemyState[];
    shots: TDShotState[];
    blasts: TDBlastState[];
}

interface Segment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    len: number;
    start: number;
}

/** ASCII 网格里可通行的格子 */
function isPathChar(ch: string): boolean {
    return ch === 'S' || ch === '#' || ch === 'E';
}

/** 从 S 到 E 的 BFS 最短路径（格子下标 row * cols + col） */
export function findPathCells(grid: string[]): number[] {
    let start = -1;
    let end = -1;
    for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        for (let c = 0; c < row.length; c++) {
            if (row[c] === 'S') start = r * TD_COLS + c;
            else if (row[c] === 'E') end = r * TD_COLS + c;
        }
    }
    if (start < 0 || end < 0) return [];

    const prev = new Array(grid.length * TD_COLS).fill(-1);
    const visited = new Array(grid.length * TD_COLS).fill(false);
    visited[start] = true;
    const queue: number[] = [start];
    let head = 0;
    while (head < queue.length) {
        const idx = queue[head++];
        if (idx === end) break;
        const r = Math.floor(idx / TD_COLS);
        const c = idx % TD_COLS;
        const neighbors = [
            r > 0 ? idx - TD_COLS : -1,
            r < TD_ROWS - 1 ? idx + TD_COLS : -1,
            c > 0 ? idx - 1 : -1,
            c < TD_COLS - 1 ? idx + 1 : -1,
        ];
        for (let i = 0; i < neighbors.length; i++) {
            const n = neighbors[i];
            if (n < 0 || visited[n]) continue;
            const nr = Math.floor(n / TD_COLS);
            const nc = n % TD_COLS;
            const cell = grid[nr] ? grid[nr][nc] : undefined;
            if (!cell || !isPathChar(cell)) continue;
            visited[n] = true;
            prev[n] = idx;
            queue.push(n);
        }
    }
    if (!visited[end]) return [];

    const out: number[] = [];
    let cur = end;
    while (cur >= 0) {
        out.push(cur);
        if (cur === start) break;
        cur = prev[cur];
    }
    out.reverse();
    return out;
}

/** 地图自检：返回问题列表，空数组表示合法 */
export function validateMap(map: TDMapDef): string[] {
    const problems: string[] = [];
    if (map.grid.length !== TD_ROWS) problems.push(`行数应为 ${TD_ROWS}，实际 ${map.grid.length}`);
    for (let r = 0; r < map.grid.length; r++) {
        if (map.grid[r].length !== TD_COLS) problems.push(`第 ${r} 行宽度应为 ${TD_COLS}，实际 ${map.grid[r].length}`);
    }
    const path = findPathCells(map.grid);
    if (path.length < 2) problems.push('S 到 E 不连通');
    let slots = 0;
    for (let r = 0; r < map.grid.length; r++) {
        for (let c = 0; c < map.grid[r].length; c++) {
            const ch = map.grid[r][c];
            if (ch === 'o') {
                slots++;
                if (isPathChar(ch)) problems.push(`塔位 ${r},${c} 落在路径上`);
            } else if (ch !== 'S' && ch !== '#' && ch !== 'E' && ch !== '.') {
                problems.push(`非法字符 '${ch}' 于 ${r},${c}`);
            }
        }
    }
    if (slots === 0) problems.push('地图没有塔位');
    if (problems.length === 0) {
        for (let i = 0; i < path.length; i++) {
            const r = Math.floor(path[i] / TD_COLS);
            const c = path[i] % TD_COLS;
            if (map.grid[r][c] === 'o') problems.push('路径穿过塔位');
        }
    }
    return problems;
}

export function cellCenterX(c: number): number {
    return c + 0.5;
}

export function cellCenterY(r: number): number {
    return r + 0.5;
}

export class TDCore {
    readonly map: TDMapDef;
    readonly waves: TDWaveDef[];
    readonly pathPoints: TDPoint[] = [];
    readonly pathLength: number;
    readonly slots: TDSlotState[] = [];
    readonly enemies: TDEnemyState[] = [];
    readonly shots: TDShotState[] = [];
    readonly blasts: TDBlastState[] = [];

    phase: TDPhase = 'prep';
    /** 当前（running）/ 下一波（prep）的下标，0 起 */
    waveIndex = 0;
    gold: number;
    lives: number;
    totalKills = 0;
    /** 累计漏过的敌人数（结算「原因」行用） */
    totalLeaks = 0;

    private _segments: Segment[] = [];
    private _waveTime = 0;
    private _spawned: number[] = [];
    private _nextEnemyId = 1;
    private _events: string[] = [];

    constructor(map: TDMapDef, waves: TDWaveDef[] = TD_WAVES) {
        this.map = map;
        this.waves = waves;
        this.gold = map.gold;
        this.lives = map.lives;

        const cells = findPathCells(map.grid);
        const points: TDPoint[] = [];
        for (let i = 0; i < cells.length; i++) {
            points.push({
                x: cellCenterX(cells[i] % TD_COLS),
                y: cellCenterY(Math.floor(cells[i] / TD_COLS)),
            });
        }
        this.pathPoints = points;

        let total = 0;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            this._segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, len, start: total });
            total += len;
        }
        this.pathLength = Math.max(0.0001, total);

        for (let r = 0; r < map.grid.length; r++) {
            for (let c = 0; c < map.grid[r].length; c++) {
                if (map.grid[r][c] === 'o') {
                    this.slots.push({
                        r,
                        c,
                        x: cellCenterX(c),
                        y: cellCenterY(r),
                        tower: null,
                    });
                }
            }
        }
    }

    static create(mapId: number): TDCore {
        return new TDCore(getTDMap(mapId), TD_WAVES);
    }

    static get mapCount(): number {
        return TD_MAP_COUNT;
    }

    static get waveCount(): number {
        return TD_WAVE_COUNT;
    }

    // ==================== 查询 ====================

    get totalWaves(): number {
        return this.waves.length;
    }

    /** 是否已经开打（波次进行中） */
    get isRunning(): boolean {
        return this.phase === 'running';
    }

    get ended(): boolean {
        return this.phase === 'won' || this.phase === 'lost';
    }

    currentWaveDef(): TDWaveDef | null {
        if (this.waveIndex < 0 || this.waveIndex >= this.waves.length) return null;
        return this.waves[this.waveIndex];
    }

    /** 场上活着的敌人数 */
    get aliveEnemyCount(): number {
        let n = 0;
        for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].alive) n++;
        return n;
    }

    /** 本波还未出场的敌人数 */
    get pendingSpawnCount(): number {
        const wave = this.currentWaveDef();
        if (!wave || this.phase !== 'running') return 0;
        let remain = 0;
        for (let i = 0; i < wave.groups.length; i++) {
            remain += Math.max(0, wave.groups[i].count - (this._spawned[i] || 0));
        }
        return remain;
    }

    enemyAt(id: number): TDEnemyState | null {
        for (let i = 0; i < this.enemies.length; i++) {
            if (this.enemies[i].id === id) return this.enemies[i];
        }
        return null;
    }

    /** 下一座塔的建造 / 升级花费 */
    towerCost(kind: TDTowerKind, level = 1): number {
        const def = TD_TOWERS[kind];
        if (!def) return 0;
        const lv = Math.max(1, Math.min(TD_TOWER_MAX_LEVEL, Math.floor(level)));
        return def.levels[lv - 1].cost;
    }

    positionAtDistance(dist: number): TDPoint {
        const d = Math.max(0, Math.min(this.pathLength, dist));
        for (let i = 0; i < this._segments.length; i++) {
            const seg = this._segments[i];
            if (d <= seg.start + seg.len || i === this._segments.length - 1) {
                const t = seg.len <= 0 ? 0 : (d - seg.start) / seg.len;
                return {
                    x: seg.x1 + (seg.x2 - seg.x1) * t,
                    y: seg.y1 + (seg.y2 - seg.y1) * t,
                };
            }
        }
        return this.pathPoints[this.pathPoints.length - 1];
    }

    // ==================== 玩家操作 ====================

    /** 开始下一波（只在准备阶段有效） */
    startWave(): boolean {
        if (this.phase !== 'prep') return false;
        if (this.waveIndex >= this.waves.length) return false;
        this.phase = 'running';
        this._waveTime = 0;
        const wave = this.waves[this.waveIndex];
        this._spawned = new Array(wave.groups.length).fill(0);
        return true;
    }

    build(slotIndex: number, kind: TDTowerKind): TDActionResult {
        if (this.ended) return { ok: false, reason: 'ended' };
        const slot = this.slots[slotIndex];
        if (!slot) return { ok: false, reason: 'slot' };
        if (slot.tower) return { ok: false, reason: 'occupied' };
        const def = TD_TOWERS[kind];
        if (!def) return { ok: false, reason: 'slot' };
        const cost = def.levels[0].cost;
        if (this.gold < cost) return { ok: false, reason: 'gold', cost };

        this.gold -= cost;
        slot.tower = {
            slotIndex,
            kind,
            level: 1,
            invested: cost,
            cooldown: 0,
            angle: -Math.PI / 2,
            x: slot.x,
            y: slot.y,
        };
        this._events.push(`build:${kind}`);
        return { ok: true, cost };
    }

    upgrade(slotIndex: number): TDActionResult {
        if (this.ended) return { ok: false, reason: 'ended' };
        const slot = this.slots[slotIndex];
        if (!slot) return { ok: false, reason: 'slot' };
        const tower = slot.tower;
        if (!tower) return { ok: false, reason: 'empty' };
        if (tower.level >= TD_TOWER_MAX_LEVEL) return { ok: false, reason: 'max' };
        const cost = TD_TOWERS[tower.kind].levels[tower.level].cost;
        if (this.gold < cost) return { ok: false, reason: 'gold', cost };

        this.gold -= cost;
        tower.level += 1;
        tower.invested += cost;
        this._events.push(`upgrade:${tower.kind}`);
        return { ok: true, cost };
    }

    /** 出售塔，返还 50% 累计投入（向下取整） */
    sell(slotIndex: number): TDActionResult {
        if (this.ended) return { ok: false, reason: 'ended' };
        const slot = this.slots[slotIndex];
        if (!slot) return { ok: false, reason: 'slot' };
        const tower = slot.tower;
        if (!tower) return { ok: false, reason: 'empty' };
        const refund = Math.floor(tower.invested * TD_SELL_REFUND);
        this.gold += refund;
        slot.tower = null;
        this._events.push(`sell:${tower.kind}`);
        return { ok: true, refund };
    }

    // ==================== 主循环 ====================

    step(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const delta = Math.min(0.1, dt);

        this._decayEffects(delta);
        if (this.phase === 'running') {
            this._waveTime += delta;
            this._spawnDue(delta);
            this._moveEnemies(delta);
            this._fireTowers(delta);
            this._updateShots(delta);
            this._prune();
            this._checkWaveComplete();
        }
        this._prune();
    }

    private _decayEffects(dt: number): void {
        for (let i = this.blasts.length - 1; i >= 0; i--) {
            const b = this.blasts[i];
            b.ttl -= dt;
            if (b.ttl <= 0) this.blasts.splice(i, 1);
        }
    }

    private _spawnDue(dt: number): void {
        const wave = this.currentWaveDef();
        if (!wave) return;
        for (let gi = 0; gi < wave.groups.length; gi++) {
            const group = wave.groups[gi];
            while (
                (this._spawned[gi] || 0) < group.count &&
                this._waveTime >= group.delay + (this._spawned[gi] || 0) * group.interval
            ) {
                this._spawnEnemy(group.kind, this.waveIndex + 1);
                this._spawned[gi] = (this._spawned[gi] || 0) + 1;
            }
        }
    }

    private _spawnEnemy(kind: TDEnemyKind, wave: number): void {
        const def = TD_ENEMIES[kind];
        const hp = enemyHp(this.map, kind, wave);
        const start = this.pathPoints[0] || { x: 0, y: 0 };
        this.enemies.push({
            id: this._nextEnemyId++,
            kind,
            hp,
            maxHp: hp,
            dist: 0,
            speedBase: def.speed,
            slowFactor: 0,
            slowTimer: 0,
            x: start.x,
            y: start.y,
            alive: true,
        });
        if (kind === 'boss') this._events.push('boss');
    }

    private _moveEnemies(dt: number): void {
        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            if (!e.alive) continue;
            if (e.slowTimer > 0) {
                e.slowTimer = Math.max(0, e.slowTimer - dt);
                if (e.slowTimer <= 0) e.slowFactor = 0;
            }
            const factor = 1 - Math.max(0, Math.min(0.8, e.slowFactor));
            e.dist += e.speedBase * factor * dt;
            if (e.dist >= this.pathLength) {
                e.dist = this.pathLength;
                const p = this.positionAtDistance(e.dist);
                e.x = p.x;
                e.y = p.y;
                e.alive = false;
                this.totalLeaks++;
                this.lives = Math.max(0, this.lives - TD_ENEMIES[e.kind].leak);
                this._events.push(`leak:${e.kind}`);
                if (this.lives <= 0 && this.phase !== 'lost') {
                    this.phase = 'lost';
                    this._events.push('lost');
                }
                continue;
            }
            const p = this.positionAtDistance(e.dist);
            e.x = p.x;
            e.y = p.y;
        }
    }

    private _fireTowers(dt: number): void {
        for (let i = 0; i < this.slots.length; i++) {
            const tower = this.slots[i].tower;
            if (!tower) continue;
            tower.cooldown = Math.max(0, tower.cooldown - dt);
            if (tower.cooldown > 0) continue;

            const def = TD_TOWERS[tower.kind];
            const stats = def.levels[tower.level - 1];
            const target = this._findTarget(tower, stats.range, def.target);
            if (!target) continue;

            tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
            tower.cooldown = stats.interval;
            this.shots.push({
                kind: tower.kind,
                x: tower.x,
                y: tower.y,
                targetId: target.id,
                speed: def.projectileSpeed,
                damage: stats.damage,
                splash: def.splash,
                slowFactor: def.slowFactor,
                slowDuration: def.slowDuration,
                ttl: 3,
            });
            this._events.push(`shoot:${tower.kind}`);
        }
    }

    private _findTarget(tower: TDTowerState, range: number, mode: TDTargetMode): TDEnemyState | null {
        let best: TDEnemyState | null = null;
        let bestValue = 0;
        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            if (!e.alive) continue;
            const d = Math.hypot(e.x - tower.x, e.y - tower.y);
            if (d > range) continue;
            let value: number;
            if (mode === 'first') value = e.dist;
            else if (mode === 'closest') value = -d;
            else value = -e.hp;
            if (!best || value > bestValue) {
                best = e;
                bestValue = value;
            }
        }
        return best;
    }

    private _updateShots(dt: number): void {
        for (let i = this.shots.length - 1; i >= 0; i--) {
            const shot = this.shots[i];
            shot.ttl -= dt;
            const target = this.enemyAt(shot.targetId);
            if (!target || !target.alive || shot.ttl <= 0) {
                this.shots.splice(i, 1);
                continue;
            }
            const dx = target.x - shot.x;
            const dy = target.y - shot.y;
            const dist = Math.hypot(dx, dy);
            const step = shot.speed * dt;
            if (dist <= step + 0.12) {
                shot.x = target.x;
                shot.y = target.y;
                this._impact(shot, target);
                this.shots.splice(i, 1);
                continue;
            }
            shot.x += (dx / dist) * step;
            shot.y += (dy / dist) * step;
        }
    }

    private _impact(shot: TDShotState, target: TDEnemyState): void {
        const radius = shot.splash > 0 ? shot.splash : 0.4;
        const affected: TDEnemyState[] = [];
        if (shot.splash > 0) {
            for (let i = 0; i < this.enemies.length; i++) {
                const e = this.enemies[i];
                if (!e.alive) continue;
                if (Math.hypot(e.x - target.x, e.y - target.y) <= radius) affected.push(e);
            }
            if (affected.indexOf(target) < 0) affected.push(target);
        } else {
            affected.push(target);
        }
        for (let i = 0; i < affected.length; i++) {
            const e = affected[i];
            if (!e.alive) continue;
            e.hp -= shot.damage;
            if (shot.slowFactor > 0) {
                e.slowFactor = Math.max(e.slowFactor, shot.slowFactor);
                e.slowTimer = Math.max(e.slowTimer, shot.slowDuration);
            }
            if (e.hp <= 0) {
                e.hp = 0;
                e.alive = false;
                this.gold += TD_ENEMIES[e.kind].reward;
                this.totalKills++;
                this._events.push(`kill:${e.kind}`);
            }
        }
        this.blasts.push({
            kind: shot.kind,
            x: target.x,
            y: target.y,
            radius,
            ttl: 0.26,
            maxTtl: 0.26,
        });
    }

    private _prune(): void {
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            if (!this.enemies[i].alive) this.enemies.splice(i, 1);
        }
        for (let i = this.shots.length - 1; i >= 0; i--) {
            if (this.shots[i].ttl <= 0) this.shots.splice(i, 1);
        }
    }

    private _checkWaveComplete(): void {
        if (this.phase !== 'running') return;
        if (this.pendingSpawnCount > 0) return;
        if (this.aliveEnemyCount > 0) return;

        const wave = this.currentWaveDef();
        if (wave) this.gold += wave.bonus;
        this._events.push('waveClear');
        this.waveIndex++;
        if (this.waveIndex >= this.waves.length) {
            this.waveIndex = this.waves.length - 1;
            this.phase = 'won';
            this._events.push('won');
        } else {
            this.phase = 'prep';
        }
    }

    // ==================== 快照 / 事件 ====================

    getSnapshot(): TDSnapshot {
        return {
            phase: this.phase,
            waveIndex: this.waveIndex,
            totalWaves: this.totalWaves,
            gold: this.gold,
            lives: this.lives,
            mapId: this.map.id,
            mapName: this.map.name,
            pathPoints: this.pathPoints,
            pathLength: this.pathLength,
            slots: this.slots,
            enemies: this.enemies,
            shots: this.shots,
            blasts: this.blasts,
        };
    }

    /** 读取并清空事件（用于音效 / 提示） */
    drainEvents(): string[] {
        if (this._events.length === 0) return [];
        const events = this._events.slice();
        this._events.length = 0;
        return events;
    }

    /** 自检辅助：在路径指定距离处放一只敌人（不参与波次计数） */
    debugSpawn(kind: TDEnemyKind, dist: number, hp?: number): TDEnemyState {
        const def = TD_ENEMIES[kind];
        const maxHp = hp !== undefined ? Math.max(1, hp) : enemyHp(this.map, kind, 1);
        const p = this.positionAtDistance(dist);
        const enemy: TDEnemyState = {
            id: this._nextEnemyId++,
            kind,
            hp: maxHp,
            maxHp,
            dist: Math.max(0, Math.min(this.pathLength, dist)),
            speedBase: def.speed,
            slowFactor: 0,
            slowTimer: 0,
            x: p.x,
            y: p.y,
            alive: true,
        };
        this.enemies.push(enemy);
        return enemy;
    }

    /** 自检辅助：直接对场上敌人造成伤害（不常用，仅供压力测试） */
    debugDamageAll(amount: number): void {
        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            if (!e.alive) continue;
            e.hp -= amount;
            if (e.hp <= 0) {
                e.hp = 0;
                e.alive = false;
                this.gold += TD_ENEMIES[e.kind].reward;
                this.totalKills++;
            }
        }
        this._prune();
    }

    /** 本波敌人总数（含已出场 / 未出场） */
    waveTotal(waveIndex = this.waveIndex): number {
        const wave = this.waves[waveIndex];
        return wave ? waveEnemyCount(wave) : 0;
    }
}

export { TD_MAPS };
