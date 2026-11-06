/**
 * 台球（`pool`）—— 纯逻辑核心（不依赖 cc，可被 Node 直接编译回归）。
 *
 * 物理方案：自研二维圆形求解器，与 `merge` 同源但针对台球做了三处改动：
 *   1. **无重力**：只有滚动摩擦（线性减速度 780 px/s²）与库边 / 球间碰撞。
 *   2. **自适应子步**：外层固定 1/120 秒，内层按「本步最大速度 × dt ≤ 0.4·r」再细分，
 *      因此即使出杆速度 1900 px/s，单个子步的位移也只有 3.6 px，高速球不会穿球 / 穿库。
 *   3. **等质量弹性碰撞**：球间恢复系数 0.95，法向交换动量 + 位置分离。
 *
 * 规则：单人清台。杆数用完还没清完即判负；母球落袋（滑杆）在下一杆前复位到开球点。
 *
 * 坐标系：原点在赛台左上角，y 向下；长度单位 px，时间单位秒。
 */

import {
    TABLE_W,
    TABLE_H,
    BALL_R,
    POOL_POCKETS,
    CUE_SPOT_X,
    CUE_SPOT_Y,
    RACK_APEX_X,
    RACK_APEX_Y,
    RACK_GAP,
    POOL_PHYS,
    POOL_POT_SCORE,
    POOL_SPARE_STROKE_SCORE,
    POOL_LEVELS,
    getPoolLevel,
    PoolLevelDef,
} from './PoolConfig';

export type PoolState = 'aiming' | 'rolling' | 'won' | 'lost';

export interface PoolBall {
    id: number;
    /** 球号：0 = 母球，1..15 = 目标球 */
    num: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    /** 是否还在台面上 */
    onTable: boolean;
    /** 在第几杆落袋（-1 = 还没落袋） */
    pottedBy: number;
    /** 落袋时的位置（视图层做飞入袋动画用） */
    potX: number;
    potY: number;
}

export type PoolEvent =
    | { type: 'shoot'; dirX: number; dirY: number; speed: number }
    | { type: 'pot'; num: number; x: number; y: number; combo: number; gain: number }
    | { type: 'scratch'; x: number; y: number }
    | { type: 'stroke_end'; potted: number; strokes: number; strokesLeft: number }
    | { type: 'won'; score: number; strokes: number; strokesLeft: number }
    | { type: 'lost'; potted: number; total: number; strokes: number };

export type PoolAimKind = 'ball' | 'cushion' | 'none';

export interface PoolAimHit {
    kind: PoolAimKind;
    /** 母球球心沿瞄准方向能到达的最远位置（幽灵球位置） */
    ghostX: number;
    ghostY: number;
    /** 被瞄准的目标球号；撞库 / 无目标为 -1 */
    ballNum: number;
    /** 撞击点（目标球心 - 2r·dir，或库边交点） */
    hitX: number;
    hitY: number;
    /** 母球球心走过的距离 */
    dist: number;
}

// ==================== 工具 ====================

export function clamp(v: number, lo: number, hi: number): number {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

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

/** 两球是否重叠（含容差），视图层做摆球提示复用 */
export function ballsOverlap(
    x1: number, y1: number, r1: number,
    x2: number, y2: number, r2: number,
): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lim = r1 + r2;
    return dx * dx + dy * dy < lim * lim;
}

/** 三角摆球的球心坐标（不含球号），行数 rows 共 rows(rows+1)/2 个 */
export function rackPositions(rows: number): { x: number; y: number }[] {
    const dx = (2 * BALL_R + RACK_GAP) * Math.cos(Math.PI / 6);
    const dy = 2 * BALL_R + RACK_GAP;
    const out: { x: number; y: number }[] = [];
    for (let row = 0; row < rows; row++) {
        for (let i = 0; i <= row; i++) {
            out.push({
                x: RACK_APEX_X + row * dx,
                y: RACK_APEX_Y + (i - row / 2) * dy,
            });
        }
    }
    return out;
}

// ==================== 核心 ====================

export class PoolCore {
    private _state: PoolState = 'aiming';
    private _level: PoolLevelDef = POOL_LEVELS[0];
    private _balls: PoolBall[] = [];
    private _events: PoolEvent[] = [];

    private _score = 0;
    private _strokes = 0;
    /** 本杆已进的目标球数 */
    private _strokePots = 0;
    /** 本局累计进球（目标球） */
    private _pottedCount = 0;

    private _acc = 0;
    private _rollTimer = 0;
    private _nextId = 1;

    private _aimAngle = 0;
    private _power = 0.7;

    private _seed = 1;
    private _rand: () => number = mulberry32(1);

    // ---------- 只读状态 ----------

    get state(): PoolState { return this._state; }
    get level(): PoolLevelDef { return this._level; }
    get levelId(): number { return this._level.id; }
    get balls(): ReadonlyArray<PoolBall> { return this._balls; }
    get score(): number { return this._score; }
    get strokes(): number { return this._strokes; }
    get strokeLimit(): number { return this._level.strokeLimit; }
    get strokesLeft(): number { return Math.max(0, this._level.strokeLimit - this._strokes); }
    get pottedCount(): number { return this._pottedCount; }
    get totalBalls(): number { return this._level.ballCount; }
    get aimAngle(): number { return this._aimAngle; }
    get power(): number { return this._power; }
    get settled(): boolean { return this._state !== 'rolling'; }
    get cueBall(): PoolBall | null {
        for (const b of this._balls) if (b.num === 0) return b;
        return null;
    }

    /** 台面上还剩的目标球（用于 HUD / 视图） */
    get remainingBalls(): PoolBall[] {
        const out: PoolBall[] = [];
        for (const b of this._balls) if (b.num > 0 && b.onTable) out.push(b);
        return out;
    }

    // ---------- 生命周期 ----------

    /** 开始一局；seed 只影响 1..N 号球在三角里的排布 */
    startLevel(levelId: number, seed?: number): void {
        this._level = getPoolLevel(levelId);
        this._seed = seed === undefined ? (Date.now() >>> 0) : (seed >>> 0);
        this._rand = mulberry32(this._seed);

        this._state = 'aiming';
        this._events = [];
        this._score = 0;
        this._strokes = 0;
        this._strokePots = 0;
        this._pottedCount = 0;
        this._acc = 0;
        this._rollTimer = 0;
        this._nextId = 1;
        this._aimAngle = 0;
        this._power = 0.7;

        this._balls = [];
        const cue = this._makeBall(0, CUE_SPOT_X, CUE_SPOT_Y);
        this._balls.push(cue);

        const spots = rackPositions(this._level.rows);
        const nums: number[] = [];
        for (let i = 1; i <= this._level.ballCount; i++) nums.push(i);
        this._shuffle(nums);
        for (let i = 0; i < nums.length && i < spots.length; i++) {
            this._balls.push(this._makeBall(nums[i], spots[i].x, spots[i].y));
        }
    }

    // ---------- 瞄准 / 出杆 ----------

    /** 设置瞄准角度（弧度，0 = +x，顺时针为正，因为 y 向下） */
    setAimAngle(angle: number): void {
        if (!Number.isFinite(angle)) return;
        this._aimAngle = angle;
    }

    /** 朝向某个点瞄准（目标球 / 触摸点） */
    aimAt(x: number, y: number): void {
        const cue = this.cueBall;
        if (!cue) return;
        this._aimAngle = Math.atan2(y - cue.y, x - cue.x);
    }

    /** 设置力度 0..1 */
    setPower(p: number): void {
        if (!Number.isFinite(p)) return;
        this._power = clamp(p, 0, 1);
    }

    /** 出杆。成功返回 true；非瞄准阶段返回 false */
    shoot(): boolean {
        if (this._state !== 'aiming') return false;
        const cue = this.cueBall;
        if (!cue || !cue.onTable) return false;

        const dirX = Math.cos(this._aimAngle);
        const dirY = Math.sin(this._aimAngle);
        const speed = POOL_PHYS.minShotSpeed
            + this._power * (POOL_PHYS.maxShotSpeed - POOL_PHYS.minShotSpeed);
        cue.vx = dirX * speed;
        cue.vy = dirY * speed;

        this._strokes += 1;
        this._strokePots = 0;
        this._rollTimer = 0;
        this._acc = 0;
        this._state = 'rolling';
        this._events.push({ type: 'shoot', dirX, dirY, speed });
        return true;
    }

    // ---------- 时间推进 ----------

    step(dt: number): void {
        if (this._state !== 'rolling') return;
        const frame = clamp(dt, 0, POOL_PHYS.maxFrameDt);
        this._acc += frame;
        this._rollTimer += frame;

        let steps = 0;
        while (this._acc >= POOL_PHYS.stepSec && steps < POOL_PHYS.maxStepsPerFrame) {
            this._advance(POOL_PHYS.stepSec);
            this._acc -= POOL_PHYS.stepSec;
            steps++;
            if (this._state !== 'rolling') break;
        }
        if (steps >= POOL_PHYS.maxStepsPerFrame) this._acc = 0;

        // 兜底：摩擦一定会把球停下，但万一有数值病态也不允许永久 rolling
        if (this._state === 'rolling' && this._rollTimer > 25) {
            for (const b of this._balls) { b.vx = 0; b.vy = 0; }
            this._settle();
        }
    }

    drainEvents(): PoolEvent[] {
        if (this._events.length === 0) return [];
        const out = this._events;
        this._events = [];
        return out;
    }

    /** 预览瞄准线：返回第一颗会被撞到的球（幽灵球位置）或库边交点 */
    predictAim(): PoolAimHit {
        const cue = this.cueBall;
        const result: PoolAimHit = {
            kind: 'none',
            ghostX: CUE_SPOT_X,
            ghostY: CUE_SPOT_Y,
            ballNum: -1,
            hitX: CUE_SPOT_X,
            hitY: CUE_SPOT_Y,
            dist: 0,
        };
        if (!cue || !cue.onTable) return result;

        const dirX = Math.cos(this._aimAngle);
        const dirY = Math.sin(this._aimAngle);
        let bestT = Infinity;

        // 球
        for (const b of this._balls) {
            if (b === cue || !b.onTable) continue;
            const relX = b.x - cue.x;
            const relY = b.y - cue.y;
            const along = relX * dirX + relY * dirY;
            if (along <= 0) continue;
            const perp = Math.abs(relX * dirY - relY * dirX);
            const sum = cue.r + b.r;
            if (perp > sum) continue;
            const back = Math.sqrt(Math.max(0, sum * sum - perp * perp));
            const t = along - back;
            if (t < 0 || t >= bestT) continue;
            bestT = t;
            result.kind = 'ball';
            result.ballNum = b.num;
            result.ghostX = cue.x + dirX * t;
            result.ghostY = cue.y + dirY * t;
            result.hitX = result.ghostX + dirX * cue.r;
            result.hitY = result.ghostY + dirY * cue.r;
            result.dist = t;
        }

        // 库边
        const minX = cue.r;
        const maxX = TABLE_W - cue.r;
        const minY = cue.r;
        const maxY = TABLE_H - cue.r;
        let wallT = Infinity;
        if (dirX > 1e-9) wallT = Math.min(wallT, (maxX - cue.x) / dirX);
        else if (dirX < -1e-9) wallT = Math.min(wallT, (minX - cue.x) / dirX);
        if (dirY > 1e-9) wallT = Math.min(wallT, (maxY - cue.y) / dirY);
        else if (dirY < -1e-9) wallT = Math.min(wallT, (minY - cue.y) / dirY);
        if (Number.isFinite(wallT) && wallT < bestT) {
            bestT = wallT;
            result.kind = 'cushion';
            result.ballNum = -1;
            result.ghostX = cue.x + dirX * wallT;
            result.ghostY = cue.y + dirY * wallT;
            result.hitX = result.ghostX;
            result.hitY = result.ghostY;
            result.dist = wallT;
        }

        if (!Number.isFinite(bestT)) {
            result.kind = 'none';
            result.dist = 0;
            return result;
        }
        if (result.dist === 0) result.dist = bestT;
        return result;
    }

    // ---------- 调试 / 测试钩子 ----------

    /** 直接把某颗目标球判为落袋（自检规则用，不经过物理） */
    debugSinkBall(num: number): boolean {
        for (const b of this._balls) {
            if (b.num === num && b.onTable) {
                this._potBall(b);
                return true;
            }
        }
        return false;
    }

    /** 把某颗球搬到指定位置并清零速度（自检 / 摆球用） */
    debugPlaceBall(num: number, x: number, y: number): void {
        for (const b of this._balls) {
            if (b.num === num) {
                b.x = clamp(x, b.r, TABLE_W - b.r);
                b.y = clamp(y, b.r, TABLE_H - b.r);
                b.vx = 0;
                b.vy = 0;
                return;
            }
        }
    }

    /** 把母球搬到指定位置（自检 / 摆放用） */
    debugPlaceCue(x: number, y: number): void {
        const cue = this.cueBall;
        if (!cue) return;
        cue.x = clamp(x, cue.r, TABLE_W - cue.r);
        cue.y = clamp(y, cue.r, TABLE_H - cue.r);
        cue.vx = 0;
        cue.vy = 0;
    }

    /** 让某颗球以指定速度滚起来（自检物理用） */
    debugKick(num: number, vx: number, vy: number): void {
        for (const b of this._balls) {
            if (b.num === num && b.onTable) {
                b.vx = vx;
                b.vy = vy;
                this._rollTimer = 0;
                this._acc = 0;
                this._strokePots = 0;
                this._state = 'rolling';
                return;
            }
        }
    }

    /** 结束本杆（自检用：跳过滚动的等待） */
    debugSettle(): void {
        for (const b of this._balls) { b.vx = 0; b.vy = 0; }
        if (this._state === 'rolling') this._settle();
    }

    // ---------- 内部：推进 ----------

    private _advance(h: number): void {
        const balls = this._balls;

        // 本步最大速度 → 决定内层子步数（等质量碰撞不会让任何球超过入射最大速度）
        let maxSpeed = 0;
        for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            if (!b.onTable) continue;
            const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (s > maxSpeed) maxSpeed = s;
        }
        let n = 1;
        if (maxSpeed > 0) {
            const limit = POOL_PHYS.substepDisplacement * BALL_R;
            n = Math.ceil((maxSpeed * h) / limit);
            if (n < 1) n = 1;
            if (n > POOL_PHYS.maxSubsteps) n = POOL_PHYS.maxSubsteps;
        }
        const sub = h / n;
        for (let i = 0; i < n; i++) {
            this._substep(sub);
            if (this._state !== 'rolling') return;
        }

        // 全部停下 → 结算本杆
        if (!this._anyMoving()) this._settle();
    }

    private _substep(dt: number): void {
        const balls = this._balls;
        const maxSpeed2 = POOL_PHYS.maxSpeed * POOL_PHYS.maxSpeed;
        const dec = POOL_PHYS.frictionDecel * dt;

        // 1) 摩擦 + 积分
        for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            if (!b.onTable) continue;
            let sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (sp > 0) {
                const ns = sp - dec;
                if (ns <= POOL_PHYS.stopSpeed) {
                    b.vx = 0;
                    b.vy = 0;
                    sp = 0;
                } else {
                    const k = ns / sp;
                    b.vx *= k;
                    b.vy *= k;
                }
            }
            if (sp > 0) {
                const sp2 = b.vx * b.vx + b.vy * b.vy;
                if (sp2 > maxSpeed2) {
                    const s = POOL_PHYS.maxSpeed / Math.sqrt(sp2);
                    b.vx *= s;
                    b.vy *= s;
                }
                b.x += b.vx * dt;
                b.y += b.vy * dt;
            }
        }

        // 2) 约束求解：位置修正 + 冲量
        for (let it = 0; it < POOL_PHYS.solverIterations; it++) {
            for (let i = 0; i < balls.length; i++) {
                const a = balls[i];
                if (a.onTable) this._solveWalls(a);
            }
            for (let i = 0; i < balls.length; i++) {
                const a = balls[i];
                if (!a.onTable) continue;
                for (let j = i + 1; j < balls.length; j++) {
                    const b = balls[j];
                    if (!b.onTable) continue;
                    this._solvePair(a, b);
                }
            }
        }

        // 3) 收尾：把被子步修正挤出界外的球拉回
        for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            if (b.onTable) this._clampToTable(b);
        }

        // 4) 落袋
        for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            if (!b.onTable) continue;
            for (let p = 0; p < POOL_POCKETS.length; p++) {
                const pk = POOL_POCKETS[p];
                const dx = b.x - pk.x;
                const dy = b.y - pk.y;
                if (dx * dx + dy * dy <= pk.r * pk.r) {
                    this._potBall(b);
                    break;
                }
            }
        }

        if (!this._anyMoving()) this._settle();
    }

    private _solveWalls(b: PoolBall): void {
        const minX = b.r;
        const maxX = TABLE_W - b.r;
        const minY = b.r;
        const maxY = TABLE_H - b.r;
        const e = POOL_PHYS.cushionRestitution;

        if (b.x < minX) {
            b.x = minX;
            if (b.vx < 0) b.vx = -b.vx * e;
        } else if (b.x > maxX) {
            b.x = maxX;
            if (b.vx > 0) b.vx = -b.vx * e;
        }
        if (b.y < minY) {
            b.y = minY;
            if (b.vy < 0) b.vy = -b.vy * e;
        } else if (b.y > maxY) {
            b.y = maxY;
            if (b.vy > 0) b.vy = -b.vy * e;
        }
    }

    /** 收尾钳制：库边慢速法向分量清零，避免贴库球永远抖动 */
    private _clampToTable(b: PoolBall): void {
        const EPS = 0.01;
        const minX = b.r;
        const maxX = TABLE_W - b.r;
        const minY = b.r;
        const maxY = TABLE_H - b.r;

        if (b.x <= minX + EPS) {
            b.x = minX;
            if (b.vx < 0) b.vx = 0;
        } else if (b.x >= maxX - EPS) {
            b.x = maxX;
            if (b.vx > 0) b.vx = 0;
        }
        if (b.y <= minY + EPS) {
            b.y = minY;
            if (b.vy < 0) b.vy = 0;
        } else if (b.y >= maxY - EPS) {
            b.y = maxY;
            if (b.vy > 0) b.vy = 0;
        }
    }

    private _solvePair(a: PoolBall, b: PoolBall): void {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minD = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD) return;

        const d = Math.sqrt(d2);
        let nx: number;
        let ny: number;
        if (d < 1e-6) {
            // 完全重合：按 id 决定方向，保证确定性
            nx = a.id < b.id ? 1 : -1;
            ny = 0;
        } else {
            nx = dx / d;
            ny = dy / d;
        }

        // 位置分离（等质量各退一半）
        const pen = minD - d;
        if (pen > 0) {
            const half = pen * 0.5;
            a.x -= nx * half;
            a.y -= ny * half;
            b.x += nx * half;
            b.y += ny * half;
        }

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn >= 0) return; // 正在分离

        const j = (-(1 + POOL_PHYS.ballRestitution) * vn) / 2;
        a.vx -= j * nx;
        a.vy -= j * ny;
        b.vx += j * nx;
        b.vy += j * ny;
    }

    private _anyMoving(): boolean {
        const v = POOL_PHYS.stopSpeed;
        for (let i = 0; i < this._balls.length; i++) {
            const b = this._balls[i];
            if (!b.onTable) continue;
            if (b.vx !== 0 || b.vy !== 0) {
                if (b.vx * b.vx + b.vy * b.vy > v * v) return true;
            }
        }
        return false;
    }

    // ---------- 内部：落袋 / 结算 ----------

    private _potBall(b: PoolBall): void {
        if (!b.onTable) return;
        b.onTable = false;
        b.potX = b.x;
        b.potY = b.y;
        b.vx = 0;
        b.vy = 0;
        b.pottedBy = this._strokes;

        if (b.num === 0) {
            this._events.push({ type: 'scratch', x: b.x, y: b.y });
            return;
        }

        this._strokePots += 1;
        this._pottedCount += 1;
        const mult = 1 + (this._strokePots - 1) * this._level.multiPotBonus;
        const gain = Math.round(POOL_POT_SCORE * mult);
        this._score += gain;
        this._events.push({
            type: 'pot',
            num: b.num,
            x: b.x,
            y: b.y,
            combo: this._strokePots,
            gain,
        });
    }

    /** 所有球停下后结算本杆 */
    private _settle(): void {
        // 母球落袋 → 复位到开球点（找不到空位就就近找）
        const cue = this.cueBall;
        if (cue && !cue.onTable) {
            const spot = this._findCueSpot();
            cue.x = spot.x;
            cue.y = spot.y;
            cue.vx = 0;
            cue.vy = 0;
            cue.onTable = true;
        }
        this._acc = 0;
        this._rollTimer = 0;

        this._events.push({
            type: 'stroke_end',
            potted: this._strokePots,
            strokes: this._strokes,
            strokesLeft: this.strokesLeft,
        });

        if (this._pottedCount >= this._level.ballCount) {
            const spare = this.strokesLeft;
            this._score += spare * POOL_SPARE_STROKE_SCORE;
            this._state = 'won';
            this._events.push({
                type: 'won',
                score: this._score,
                strokes: this._strokes,
                strokesLeft: spare,
            });
            return;
        }

        if (this._strokes >= this._level.strokeLimit) {
            this._state = 'lost';
            this._events.push({
                type: 'lost',
                potted: this._pottedCount,
                total: this._level.ballCount,
                strokes: this._strokes,
            });
            return;
        }

        this._state = 'aiming';
    }

    /** 母球复位点：优先开球点，被占则围绕开球点螺旋搜索空位 */
    private _findCueSpot(): { x: number; y: number } {
        const minX = BALL_R + 1;
        const maxX = TABLE_W - BALL_R - 1;
        const minY = BALL_R + 1;
        const maxY = TABLE_H - BALL_R - 1;
        const fits = (x: number, y: number): boolean => {
            if (x < minX || x > maxX || y < minY || y > maxY) return false;
            for (const b of this._balls) {
                if (!b.onTable || b.num === 0) continue;
                if (ballsOverlap(x, y, BALL_R, b.x, b.y, b.r)) return false;
            }
            return true;
        };

        if (fits(CUE_SPOT_X, CUE_SPOT_Y)) return { x: CUE_SPOT_X, y: CUE_SPOT_Y };

        for (let radius = 2 * BALL_R; radius <= TABLE_W; radius += 6) {
            for (let k = 0; k < 24; k++) {
                const a = (k / 24) * Math.PI * 2;
                const x = CUE_SPOT_X + Math.cos(a) * radius;
                const y = CUE_SPOT_Y + Math.sin(a) * radius;
                if (fits(x, y)) return { x, y };
            }
        }
        return { x: TABLE_W / 2, y: TABLE_H / 2 };
    }

    // ---------- 内部：工具 ----------

    private _makeBall(num: number, x: number, y: number): PoolBall {
        return {
            id: this._nextId++,
            num,
            x,
            y,
            vx: 0,
            vy: 0,
            r: BALL_R,
            onTable: true,
            pottedBy: -1,
            potX: 0,
            potY: 0,
        };
    }

    private _shuffle(arr: number[]): void {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this._rand() * (i + 1));
            const t = arr[i];
            arr[i] = arr[j];
            arr[j] = t;
        }
    }
}
