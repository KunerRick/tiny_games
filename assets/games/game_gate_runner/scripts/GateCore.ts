/**
 * 数值冲刺 — 纯逻辑核心（不依赖 cc，可被 Node 直接编译回归）。
 *
 * 规则要点：
 *   - 单资源：`count` 同时是血量与火力（dps = min(count, FIRE_CAP)）
 *   - 世界按 `distance` 推进；玩家固定在屏幕 PLAYER_Y，物体按 (worldY - distance) 落屏
 *   - 遇到敌人即停下对拼：我方按 dps 扣敌人血，敌人按 atk + count×比例 扣我方人数
 *   - 数值门成对出现，玩家中心落在左/右半区即触发对应一侧
 *   - 打掉 Boss = victory；人数归零 = game_over
 *
 * 坐标系：原点在游戏区左上角，y 向下（与其它游戏一致）。
 */

import {
    PLAY_W,
    PLAYER_X_MIN,
    PLAYER_X_MAX,
    START_COUNT,
    COUNT_MAX,
    FIRE_CAP,
    ENEMY_DRAIN_RATIO,
    BOSS_DRAIN_MULT,
    BOSS_HP,
    BOSS_DISTANCE,
    CONTACT_DIST,
    SUBSTEP_SEC,
    MAX_FRAME_DT,
    SQUAD_HIT_EVENT_SEC,
    SEGMENT_LEN,
    SEGMENT_COUNT,
    GATE_SPLIT_X,
    GATE_TEMPLATES,
    GateOp,
    GateOpKind,
    clampCount,
    applyGateOp,
    enemyHpAt,
    enemyAtkAt,
    bossAtkAt,
    enemyWidthAt,
    scrollSpeedAt,
    computeScore,
} from './GateConfig';

export type GateState = 'ready' | 'running' | 'game_over' | 'victory';

export type GateSideKey = 'left' | 'right';

export interface GateSide {
    op: GateOp;
    /** 该侧是否已被触发（一对门只有一侧生效，另一侧同时作废） */
    used: boolean;
}

export interface GatePair {
    id: number;
    /** 门板中心的世界位置 */
    y: number;
    left: GateSide;
    right: GateSide;
}

export interface Enemy {
    id: number;
    /** 敌人的世界位置 */
    y: number;
    hp: number;
    maxHp: number;
    /** 每秒基础伤害（不含按人数比例的消耗） */
    atk: number;
    width: number;
    boss: boolean;
    alive: boolean;
    /** 是否已经接触过（用于只发一次 enemy_engaged） */
    engaged: boolean;
}

export type GateEvent =
    | {
        type: 'gate_hit';
        side: GateSideKey;
        kind: GateOpKind;
        value: number;
        before: number;
        after: number;
        y: number;
    }
    | { type: 'enemy_engaged'; id: number; hp: number; boss: boolean }
    | { type: 'enemy_destroyed'; id: number; y: number; boss: boolean }
    | { type: 'squad_hit'; amount: number; count: number }
    | { type: 'victory'; score: number; count: number; distance: number }
    | { type: 'game_over'; count: number; distance: number };

// ==================== 工具 ====================

/** 确定性随机：同 seed 同序列，便于无头回归 */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function (): number {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 某个世界位置上的门，玩家从哪一侧通过 */
export function gateSideFor(playerX: number): GateSideKey {
    return playerX < GATE_SPLIT_X ? 'left' : 'right';
}

// ==================== 核心 ====================

export class GateCore {
    private _state: GateState = 'ready';
    private _seed = 1;
    private _rng: () => number = mulberry32(1);

    private _distance = 0;
    private _countF = START_COUNT;
    private _playerX = PLAY_W / 2;

    private _gates: GatePair[] = [];
    private _enemies: Enemy[] = [];

    private _events: GateEvent[] = [];
    private _acc = 0;
    private _nextId = 1;

    private _hitTimer = 0;
    private _pendingHit = 0;

    // ==================== 生命周期 ====================

    /** 开一局。seed 相同则门/敌人序列完全相同 */
    startRun(seed: number): void {
        this._seed = seed >>> 0;
        this._rng = mulberry32(this._seed);

        this._state = 'running';
        this._distance = 0;
        this._countF = START_COUNT;
        this._playerX = PLAY_W / 2;

        this._gates = [];
        this._enemies = [];
        this._events = [];
        this._acc = 0;
        this._nextId = 1;
        this._hitTimer = 0;
        this._pendingHit = 0;

        this._generate();
    }

    /** 重置成「还没开始」的干净状态 */
    reset(): void {
        this._state = 'ready';
        this._distance = 0;
        this._countF = START_COUNT;
        this._playerX = PLAY_W / 2;
        this._gates = [];
        this._enemies = [];
        this._events = [];
        this._acc = 0;
        this._hitTimer = 0;
        this._pendingHit = 0;
    }

    /** 横移：钳制在 [PLAYER_X_MIN, PLAYER_X_MAX] */
    setPlayerX(x: number): void {
        if (isNaN(x)) return;
        const v = x < PLAYER_X_MIN ? PLAYER_X_MIN : (x > PLAYER_X_MAX ? PLAYER_X_MAX : x);
        this._playerX = v;
    }

    /** 取走本帧产生的事件（取空即清空） */
    popEvents(): GateEvent[] {
        if (this._events.length === 0) return [];
        const out = this._events;
        this._events = [];
        return out;
    }

    // ==================== 推进 ====================

    step(dt: number): void {
        if (this._state !== 'running') return;
        if (!isFinite(dt) || dt <= 0) return;

        const frame = dt > MAX_FRAME_DT ? MAX_FRAME_DT : dt;
        this._acc += frame;

        let guard = 0;
        while (this._acc >= SUBSTEP_SEC && guard < 64) {
            this._acc -= SUBSTEP_SEC;
            guard++;
            this._substep(SUBSTEP_SEC);
            if (this._state !== 'running') {
                this._acc = 0;
                break;
            }
        }
    }

    private _substep(dt: number): void {
        const blocker = this._blockingEnemy();

        if (blocker) {
            this._fight(blocker, dt);
            if (this._state !== 'running') return;
        } else {
            this._distance += scrollSpeedAt(this._distance) * dt;
            if (this._distance > BOSS_DISTANCE + 400) this._distance = BOSS_DISTANCE + 400;
        }

        this._checkGates();
    }

    /** 前方最近的、已经接触到的活敌人 */
    private _blockingEnemy(): Enemy | null {
        for (let i = 0; i < this._enemies.length; i++) {
            const e = this._enemies[i];
            if (!e.alive) continue;
            if (e.y - this._distance <= CONTACT_DIST) return e;
        }
        return null;
    }

    private _fight(e: Enemy, dt: number): void {
        if (!e.engaged) {
            e.engaged = true;
            this._events.push({ type: 'enemy_engaged', id: e.id, hp: e.hp, boss: e.boss });
        }

        // 我方输出：dps 封顶，人数再多也不会更快
        const dps = Math.min(this.count, FIRE_CAP);
        e.hp -= dps * dt;

        if (e.hp <= 0) {
            e.hp = 0;
            e.alive = false;
            this._events.push({ type: 'enemy_destroyed', id: e.id, y: e.y, boss: e.boss });
            this._flushHit();
            if (e.boss) this._win();
            return;
        }

        // 敌方输出：基础伤害 + 按当前人数比例的消耗
        const mult = e.boss ? BOSS_DRAIN_MULT : 1;
        const drain = (e.boss ? bossAtkAt(e.y) : e.atk) + this.count * ENEMY_DRAIN_RATIO * mult;
        this._countF -= drain * dt;
        this._pendingHit += drain * dt;

        this._hitTimer += dt;
        if (this._hitTimer >= SQUAD_HIT_EVENT_SEC) {
            this._hitTimer = 0;
            this._flushHit();
        }

        if (this._countF <= 0) {
            this._countF = 0;
            this._flushHit();
            this._fail();
        }
    }

    private _flushHit(): void {
        const amount = Math.floor(this._pendingHit);
        if (amount <= 0) return;
        this._pendingHit -= amount;
        this._events.push({ type: 'squad_hit', amount, count: this.count });
    }

    private _checkGates(): void {
        for (let i = 0; i < this._gates.length; i++) {
            const g = this._gates[i];
            if (g.left.used || g.right.used) continue;
            if (this._distance < g.y) continue;

            const side = gateSideFor(this._playerX);
            const entry = side === 'left' ? g.left : g.right;
            const before = this.count;
            const after = applyGateOp(before, entry.op);

            g.left.used = true;
            g.right.used = true;
            this._countF = after;

            this._events.push({
                type: 'gate_hit',
                side,
                kind: entry.op.kind,
                value: entry.op.value,
                before,
                after,
                y: g.y,
            });

            if (after <= 0) {
                this._fail();
                return;
            }
        }
    }

    private _win(): void {
        if (this._state !== 'running') return;
        this._state = 'victory';
        this._events.push({
            type: 'victory',
            score: computeScore(this._distance, this.count, true),
            count: this.count,
            distance: this._distance,
        });
    }

    private _fail(): void {
        if (this._state !== 'running') return;
        this._state = 'game_over';
        this._events.push({
            type: 'game_over',
            count: this.count,
            distance: this._distance,
        });
    }

    // ==================== 关卡生成 ====================

    private _generate(): void {
        for (let i = 0; i < SEGMENT_COUNT; i++) {
            const base = i * SEGMENT_LEN;
            if (i % 2 === 0) {
                this._gates.push(this._makeGatePair(base + 260));
            } else {
                this._enemies.push(this._makeEnemy(base + 300, false));
            }
        }
        this._enemies.push(this._makeEnemy(BOSS_DISTANCE, true));
    }

    private _makeGatePair(y: number): GatePair {
        const pool = GATE_TEMPLATES.filter((t) => t.from <= y);
        const list = pool.length > 0 ? pool : GATE_TEMPLATES;
        const tpl = list[Math.floor(this._rng() * list.length)];
        const swap = this._rng() < 0.5;

        const a = swap ? tpl.b : tpl.a;
        const b = swap ? tpl.a : tpl.b;

        return {
            id: this._nextId++,
            y,
            left: { op: { kind: a.kind, value: a.value }, used: false },
            right: { op: { kind: b.kind, value: b.value }, used: false },
        };
    }

    private _makeEnemy(y: number, boss: boolean): Enemy {
        const maxHp = boss ? BOSS_HP : enemyHpAt(y);
        return {
            id: this._nextId++,
            y,
            hp: maxHp,
            maxHp,
            atk: boss ? bossAtkAt(y) : enemyAtkAt(y),
            width: boss ? 460 : enemyWidthAt(y),
            boss,
            alive: true,
            engaged: false,
        };
    }

    // ==================== 只读状态 ====================

    get state(): GateState { return this._state; }
    get seed(): number { return this._seed; }
    get distance(): number { return this._distance; }
    /** 显示用整数人数（内部按浮点结算，避免每子步取整导致伤害丢失） */
    get count(): number { return clampCount(this._countF); }
    /** 未取整的人数，供血条/调试用 */
    get countExact(): number { return this._countF; }
    get playerX(): number { return this._playerX; }
    get gates(): ReadonlyArray<GatePair> { return this._gates; }
    get enemies(): ReadonlyArray<Enemy> { return this._enemies; }
    get boss(): Enemy | null {
        for (let i = 0; i < this._enemies.length; i++) {
            if (this._enemies[i].boss) return this._enemies[i];
        }
        return null;
    }
    get score(): number {
        return computeScore(this._distance, this.count, this._state === 'victory');
    }
    /** 队伍数字上限（供 UI 判断是否需要缩写） */
    get countCap(): number { return COUNT_MAX; }
}
