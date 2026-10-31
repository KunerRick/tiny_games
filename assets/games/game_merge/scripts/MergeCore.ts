/**
 * 合合大作战 — 纯逻辑核心（不依赖 cc，可被 Node 直接编译回归）。
 *
 * 物理方案：自研二维圆形求解器（评估结论见 docs/plans/2026-10-31-merge-physics-evaluation.md）。
 *   - 固定子步 1/240，重力 + 线性阻尼 + 速度上限
 *   - 每个子步：积分 → 8 轮「墙 + 圆-圆」位置修正（第 1 轮附带法向冲量与摩擦）
 *   - 低速持续 0.4 s 进入休眠；受到高速撞击时唤醒
 *   - 同层圆距 ≤ r1+r2+1.5 合并；同一子步内新生成的水果不再参与本步合并
 *   - 静止水果中心越过警戒线并持续 2 s 判定失败
 *
 * 坐标系：原点在游戏区左上角，y 向下。
 */

import {
    PLAY_W,
    PLAY_H,
    WALL_T,
    DROP_Y,
    DROP_COOLDOWN_SEC,
    GRAVITY,
    FIXED_STEP_SEC,
    MAX_STEPS_PER_FRAME,
    MAX_FRAME_DT,
    MAX_SPEED,
    ITERATIONS,
    POSITION_CORRECTION,
    CONTACT_SLOP,
    RESTITUTION,
    FRICTION,
    LINEAR_DAMPING,
    SLEEP_SPEED,
    SLEEP_HOLD_SEC,
    MERGE_SLOP,
    MERGE_VELOCITY_KEEP,
    COMBO_WINDOW_SEC,
    TOP_MERGE_SCORE,
    GAME_OVER_LINE,
    GAME_OVER_HOLD_SEC,
    MAX_FRUITS,
    MAX_TIER,
    SPAWN_WEIGHTS,
    tierRadius,
    mergeScore,
    comboMultiplier,
} from './MergeConfig';

export type MergeState = 'ready' | 'playing' | 'game_over';

export interface Fruit {
    id: number;
    tier: number;
    r: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** 生成于第几帧：同帧内新水果不再参与合并（禁链式） */
    freshFrame: number;
    /** 本子步内是否发生过接触（墙或其它水果），用于静止堆叠的额外衰减 */
    contact: boolean;
    /** 上一帧的实际位移速度（px/s）：判定"真的静止"比内部速度可靠 */
    moveSpeed: number;
    frameX: number;
    frameY: number;
    sleeping: boolean;
    sleepTimer: number;
}

export type MergeEvent =
    | { type: 'drop'; id: number; tier: number; x: number; y: number }
    | { type: 'merge'; tier: number; x: number; y: number; score: number; combo: number }
    | { type: 'top_merge'; x: number; y: number; score: number; combo: number }
    | { type: 'game_over'; score: number };

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

/** 圆与圆的接触判定（供视图层做落点提示复用） */
export function circlesOverlap(
    x1: number, y1: number, r1: number,
    x2: number, y2: number, r2: number,
): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lim = r1 + r2 + MERGE_SLOP;
    return dx * dx + dy * dy <= lim * lim;
}

/**
 * 「停在警戒线上方」：中心越过警戒线，且**有支撑**（贴墙/压着别的水果，或已休眠）。
 *
 * 不用「位移速度接近 0」判定：高柱刚从上方落下时会持续"呼吸" 2–5 s，
 * 真正静止的时刻不确定，失败判定会被无谓推迟（实测 16 颗柱要 5 s 才判负）。
 * 而自由下落的水果全程没有接触，所以「穿过警戒线」的瞬间天然不会误判。
 */
export function isRestingAboveLine(f: Fruit): boolean {
    return f.y < GAME_OVER_LINE && (f.contact || f.sleeping);
}

// ==================== 核心 ====================

export class MergeCore {
    private _state: MergeState = 'ready';
    private _score = 0;
    private _combo = 0;
    private _comboTimer = 0;
    private _fruits: Fruit[] = [];
    private _events: MergeEvent[] = [];
    private _acc = 0;
    private _dropCooldown = 0;
    private _gameOverTimer = 0;
    private _nextId = 1;
    private _frame = 0;
    private _lastFrameDt = 0;

    private _dropX = PLAY_W / 2;
    private _currentTier = 0;
    private _nextTier = 1;

    private _rand: () => number = mulberry32(1);
    private _runSeed = 1;

    // ---------- 只读状态 ----------

    get state(): MergeState { return this._state; }
    get score(): number { return this._score; }
    get combo(): number { return this._combo; }
    get comboMultiplier(): number { return comboMultiplier(this._combo); }
    get fruits(): ReadonlyArray<Fruit> { return this._fruits; }
    get dropX(): number { return this._dropX; }
    get currentTier(): number { return this._currentTier; }
    get nextTier(): number { return this._nextTier; }
    get dropCooldown(): number { return this._dropCooldown; }
    get runSeed(): number { return this._runSeed; }
    get canDrop(): boolean {
        return this._state !== 'game_over'
            && this._dropCooldown <= 0
            && this._fruits.length < MAX_FRUITS;
    }
    /** 场上最高层，用于 HUD「最大果实」 */
    get maxTierOnBoard(): number {
        let max = -1;
        for (const f of this._fruits) if (f.tier > max) max = f.tier;
        return max;
    }
    /** 越过警戒线且「有支撑」的水果数量（视图层画警示） */
    get aboveLineCount(): number {
        let n = 0;
        for (const f of this._fruits) {
            if (isRestingAboveLine(f)) n++;
        }
        return n;
    }

    // ---------- 生命周期 ----------

    startRun(seed?: number): void {
        this._runSeed = seed === undefined ? (Date.now() >>> 0) : (seed >>> 0);
        this._rand = mulberry32(this._runSeed);
        this._state = 'ready';
        this._score = 0;
        this._combo = 0;
        this._comboTimer = 0;
        this._fruits = [];
        this._events = [];
        this._acc = 0;
        this._dropCooldown = 0;
        this._gameOverTimer = 0;
        this._nextId = 1;
        this._frame = 0;
        this._lastFrameDt = 0;
        this._dropX = PLAY_W / 2;
        this._currentTier = this._rollTier();
        this._nextTier = this._rollTier();
    }

    // ---------- 输入 ----------

    /** 移动待落水果（会被夹到当前半径允许的范围内） */
    setDropX(x: number): void {
        const r = tierRadius(this._currentTier);
        this._dropX = clamp(x, WALL_T + r, PLAY_W - WALL_T - r);
    }

    /** 投放当前水果；成功返回 true */
    drop(): boolean {
        if (!this.canDrop) return false;
        const tier = this._currentTier;
        const r = tierRadius(tier);
        const x = clamp(this._dropX, WALL_T + r, PLAY_W - WALL_T - r);
        const fruit = this._createFruit(tier, x, DROP_Y);
        this._fruits.push(fruit);
        this._currentTier = this._nextTier;
        this._nextTier = this._rollTier();
        this._dropCooldown = DROP_COOLDOWN_SEC;
        if (this._state === 'ready') this._state = 'playing';
        this._events.push({ type: 'drop', id: fruit.id, tier, x, y: DROP_Y });
        return true;
    }

    /** 调试/测试用：直接放一颗水果到场内 */
    spawnFruit(tier: number, x: number, y: number, vx = 0, vy = 0): Fruit {
        const t = clamp(tier | 0, 0, MAX_TIER - 1);
        const f = this._createFruit(t, x, y);
        f.vx = vx;
        f.vy = vy;
        this._fruits.push(f);
        if (this._state === 'ready') this._state = 'playing';
        return f;
    }

    // ---------- 时间推进 ----------

    step(dt: number): void {
        const frame = clamp(dt, 0, MAX_FRAME_DT);
        this._frame++;
        // 每帧刷新一次"实际位移速度"。不能按子步算：堆叠里的位置抖动可达 0.1 px/子步
        // （= 24 px/s），但整帧净位移接近 0，按子步判定会让静止的果子永远不休眠。
        if (this._lastFrameDt > 0) {
            for (let i = 0; i < this._fruits.length; i++) {
                const f = this._fruits[i];
                const dx = f.x - f.frameX;
                const dy = f.y - f.frameY;
                f.moveSpeed = Math.sqrt(dx * dx + dy * dy) / this._lastFrameDt;
            }
        }
        for (let i = 0; i < this._fruits.length; i++) {
            const f = this._fruits[i];
            f.frameX = f.x;
            f.frameY = f.y;
        }
        this._lastFrameDt = frame;
        if (this._dropCooldown > 0) this._dropCooldown = Math.max(0, this._dropCooldown - frame);
        if (this._comboTimer > 0) {
            this._comboTimer -= frame;
            if (this._comboTimer <= 0) {
                this._comboTimer = 0;
                this._combo = 0;
            }
        }
        if (this._state !== 'playing') return;

        this._acc += frame;
        let steps = 0;
        while (this._acc >= FIXED_STEP_SEC && steps < MAX_STEPS_PER_FRAME) {
            this._substep(FIXED_STEP_SEC);
            this._acc -= FIXED_STEP_SEC;
            steps++;
            if (this._state !== 'playing') break;
        }
        // 追不上就丢弃积压，避免切后台回来后的雪崩
        if (steps >= MAX_STEPS_PER_FRAME) this._acc = 0;
    }

    popEvents(): MergeEvent[] {
        if (this._events.length === 0) return [];
        const out = this._events;
        this._events = [];
        return out;
    }

    // ---------- 内部：子步 ----------

    private _substep(dt: number): void {
        const fruits = this._fruits;
        const damp = 1 - LINEAR_DAMPING * dt;
        const maxSpeed2 = MAX_SPEED * MAX_SPEED;

        // 1) 重力 / 阻尼 / 积分
        for (let i = 0; i < fruits.length; i++) {
            const f = fruits[i];
            f.contact = false;
            if (f.sleeping) continue;
            f.vy += GRAVITY * dt;
            f.vx *= damp;
            f.vy *= damp;
            const sp2 = f.vx * f.vx + f.vy * f.vy;
            if (sp2 > maxSpeed2) {
                const s = MAX_SPEED / Math.sqrt(sp2);
                f.vx *= s;
                f.vy *= s;
            }
            f.x += f.vx * dt;
            f.y += f.vy * dt;
        }

        // 2) 约束求解：每轮都施加冲量（顺序冲量迭代），恢复系数只在第 1 轮生效
        //    只在第 1 轮加冲量时，10 层堆叠会出现 ~370 px/s 的驻波（位置看着不动、速度在震荡）
        for (let it = 0; it < ITERATIONS; it++) {
            const first = it === 0;
            for (let i = 0; i < fruits.length; i++) this._solveWalls(fruits[i], first);
            for (let i = 0; i < fruits.length; i++) {
                const a = fruits[i];
                for (let j = i + 1; j < fruits.length; j++) {
                    this._solvePair(a, fruits[j], first);
                }
            }
        }
        // 圆-圆修正排在墙之后，可能把水果压出地板/侧墙；收尾再钳一次并把贴墙的慢速度清零，
        // 否则静止的果子永远达不到休眠阈值（实测残余速度 13.5 > SLEEP_SPEED）
        for (let i = 0; i < fruits.length; i++) this._settleWalls(fruits[i]);

        // 3) 休眠
        for (let i = 0; i < fruits.length; i++) {
            const f = fruits[i];
            if (f.sleeping) continue;
            // 重力每个子步都会重新注入 8.33 px/s，单次冲量压不到休眠阈值以下
            // （实测叠放残余 12.4 > SLEEP_SPEED）：接触中的慢速水果额外衰减
            if (f.contact && this._speedOf(f) < SLEEP_SPEED * 2) {
                f.vx *= 0.6;
                f.vy *= 0.6;
            }
            if (f.moveSpeed < SLEEP_SPEED) {
                f.sleepTimer += dt;
                if (f.sleepTimer >= SLEEP_HOLD_SEC) {
                    f.sleeping = true;
                    f.sleepTimer = 0;
                    f.vx = 0;
                    f.vy = 0;
                }
            } else {
                f.sleepTimer = 0;
            }
        }

        // 4) 合并
        this._resolveMerges();

        // 5) 失败判定
        this._checkGameOver(dt);
    }

    /**
     * 墙约束。冲量每轮都施加：墙是静态无穷大质量，贴墙的水果不允许继续朝墙内运动。
     * 只在第 1 轮施加时，10 层柱子里"整列一起缓慢下落 + 位置修正推回"会锁死成
     * 一个 ~120 px/s 的驻波（位置完全不动，速度却永远不衰减）。
     */
    private _solveWalls(f: Fruit, withImpulse: boolean): void {
        const minX = WALL_T + f.r;
        const maxX = PLAY_W - WALL_T - f.r;
        const maxY = PLAY_H - WALL_T - f.r;

        if (f.x < minX) {
            f.x = minX;
            f.contact = true;
            if (f.vx < 0) f.vx = withImpulse ? -f.vx * RESTITUTION : 0;
        } else if (f.x > maxX) {
            f.x = maxX;
            f.contact = true;
            if (f.vx > 0) f.vx = withImpulse ? -f.vx * RESTITUTION : 0;
        }

        if (f.y > maxY) {
            f.y = maxY;
            f.contact = true;
            if (f.vy > 0) {
                f.vy = withImpulse ? -f.vy * RESTITUTION : 0;
                if (Math.abs(f.vy) < SLEEP_SPEED) f.vy = 0;
            }
        }
    }

    /** 子步收尾：把被圆-圆修正压出边界的水果拉回，并把贴墙的慢速度清零 */
    private _settleWalls(f: Fruit): void {
        const minX = WALL_T + f.r;
        const maxX = PLAY_W - WALL_T - f.r;
        const maxY = PLAY_H - WALL_T - f.r;
        // 用容差判断"贴边"：位置修正常常把水果恰好压在边界上（y === maxY），
        // 严格大于号会漏掉，速度也就清不掉，静止体永远到不了休眠阈值
        const EPS = 0.01;

        if (f.x <= minX + EPS) {
            f.x = minX;
            if (f.vx < 0) f.vx = 0;
        } else if (f.x >= maxX - EPS) {
            f.x = maxX;
            if (f.vx > 0) f.vx = 0;
        }
        if (f.y >= maxY - EPS) {
            f.y = maxY;
            if (f.vy > 0) f.vy = 0;
        }
    }

    private _solvePair(a: Fruit, b: Fruit, firstPass: boolean): void {
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

        const pen = minD - d;
        const invA = 1 / (a.r * a.r);
        const invB = 1 / (b.r * b.r);
        const invSum = invA + invB;

        a.contact = true;
        b.contact = true;

        if (pen > CONTACT_SLOP) {
            const corr = (pen * POSITION_CORRECTION) / invSum;
            a.x -= nx * corr * invA;
            a.y -= ny * corr * invA;
            b.x += nx * corr * invB;
            b.y += ny * corr * invB;
        }

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;

        // 高速撞击把休眠水果唤醒，否则会出现"压在休眠体上却不动"
        if (Math.abs(vn) > SLEEP_SPEED) {
            if (a.sleeping) { a.sleeping = false; a.sleepTimer = 0; }
            if (b.sleeping) { b.sleeping = false; b.sleepTimer = 0; }
        }
        if (vn >= 0) return; // 正在分离

        // 慢速接触用完全非弹性冲量（e = 0）：静止堆叠里每次重力都会制造一次
        // 微小分离速度，带 0.05 恢复系数会让残余速度永远降不到休眠阈值
        const e = firstPass && Math.abs(vn) >= SLEEP_SPEED ? RESTITUTION : 0;
        const j = (-(1 + e) * vn) / invSum;
        a.vx -= j * nx * invA;
        a.vy -= j * ny * invA;
        b.vx += j * nx * invB;
        b.vy += j * ny * invB;

        // 切向摩擦
        const tx = -ny;
        const ty = nx;
        const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
        let jt = -vt / invSum;
        const lim = FRICTION * j;
        if (jt > lim) jt = lim;
        else if (jt < -lim) jt = -lim;
        a.vx -= jt * tx * invA;
        a.vy -= jt * ty * invA;
        b.vx += jt * tx * invB;
        b.vy += jt * ty * invB;
    }

    private _resolveMerges(): void {
        const fruits = this._fruits;
        const n = fruits.length;
        if (n < 2) return;

        const consumed = new Set<number>();
        const pairs: Fruit[][] = [];
        for (let i = 0; i < n; i++) {
            const a = fruits[i];
            if (a.freshFrame === this._frame || consumed.has(a.id)) continue;
            for (let j = i + 1; j < n; j++) {
                const b = fruits[j];
                if (b.freshFrame === this._frame || b.tier !== a.tier || consumed.has(b.id)) continue;
                if (!circlesOverlap(a.x, a.y, a.r, b.x, b.y, b.r)) continue;
                pairs.push([a, b]);
                consumed.add(a.id);
                consumed.add(b.id);
                break;
            }
        }

        if (pairs.length === 0) return;

        for (let k = 0; k < pairs.length; k++) {
            const a = pairs[k][0];
            const b = pairs[k][1];
            const tier = a.tier;
            const mx = (a.x + b.x) * 0.5;
            const my = (a.y + b.y) * 0.5;
            const ma = a.r * a.r;
            const mb = b.r * b.r;
            const vx = ((a.vx * ma + b.vx * mb) / (ma + mb)) * MERGE_VELOCITY_KEEP;
            const vy = ((a.vy * ma + b.vy * mb) / (ma + mb)) * MERGE_VELOCITY_KEEP;

            this._removeFruit(a);
            this._removeFruit(b);

            if (this._comboTimer > 0) this._combo += 1;
            else this._combo = 1;
            this._comboTimer = COMBO_WINDOW_SEC;
            const mult = comboMultiplier(this._combo);

            if (tier >= MAX_TIER - 1) {
                const gain = Math.round(TOP_MERGE_SCORE * mult);
                this._score += gain;
                this._events.push({ type: 'top_merge', x: mx, y: my, score: gain, combo: this._combo });
            } else {
                const next = this._createFruit(tier + 1, mx, my);
                next.vx = vx;
                next.vy = vy;
                next.freshFrame = this._frame;
                this._fruits.push(next);
                const gain = Math.round(mergeScore(tier) * mult);
                this._score += gain;
                this._events.push({
                    type: 'merge',
                    tier: tier + 1,
                    x: mx,
                    y: my,
                    score: gain,
                    combo: this._combo,
                });
            }
        }
    }

    private _checkGameOver(dt: number): void {
        let above = false;
        for (let i = 0; i < this._fruits.length; i++) {
            if (isRestingAboveLine(this._fruits[i])) {
                above = true;
                break;
            }
        }
        if (above) {
            this._gameOverTimer += dt;
            if (this._gameOverTimer >= GAME_OVER_HOLD_SEC) {
                this._state = 'game_over';
                this._events.push({ type: 'game_over', score: this._score });
            }
        } else {
            this._gameOverTimer = 0;
        }
    }

    // ---------- 内部：工具 ----------

    private _createFruit(tier: number, x: number, y: number): Fruit {
        const r = tierRadius(tier);
        return {
            id: this._nextId++,
            tier,
            r,
            x,
            y,
            vx: 0,
            vy: 0,
            freshFrame: -1,
            contact: false,
            moveSpeed: 0,
            frameX: x,
            frameY: y,
            sleeping: false,
            sleepTimer: 0,
        };
    }

    private _removeFruit(f: Fruit): void {
        const idx = this._fruits.indexOf(f);
        if (idx >= 0) this._fruits.splice(idx, 1);
    }

    private _speedOf(f: Fruit): number {
        return Math.sqrt(f.vx * f.vx + f.vy * f.vy);
    }

    private _rollTier(): number {
        const w = SPAWN_WEIGHTS;
        let total = 0;
        for (let i = 0; i < w.length; i++) total += w[i];
        let r = this._rand() * total;
        for (let i = 0; i < w.length; i++) {
            r -= w[i];
            if (r < 0) return i;
        }
        return w.length - 1;
    }
}
