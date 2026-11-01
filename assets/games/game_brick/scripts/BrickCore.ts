/**
 * 砖块远征 — 纯逻辑核心（不依赖 cc）。
 *
 * 坐标系：原点在游戏区左上角，x 向右，y **向下**。渲染层负责映射到节点本地坐标。
 * 物理推进使用固定子步长，保证高速球不会穿砖。
 */

import {
    BALL_R,
    BALL_BASE_SPEED,
    BALL_MAX_SPEED,
    BALL_MIN_SPEED,
    BALL_SPEED_PER_LEVEL,
    BASE_LIVES,
    BOMB_MAX,
    BOMB_PER_3_LEVELS,
    BRICK_COLS,
    BRICK_GAP_X,
    BRICK_GAP_Y,
    BRICK_H,
    BRICK_MAX_ROWS,
    BRICK_TOP,
    BRICK_W,
    COMBO_STEP,
    FIXED_STEP_SEC,
    HOLE_CHANCE_BASE,
    HOLE_CHANCE_MAX,
    HORIZONTAL_NUDGE_VY,
    HORIZONTAL_STUCK_SEC,
    HORIZONTAL_STUCK_VY,
    HP3_CHANCE,
    HP3_FROM_LEVEL,
    LASER_BASE_INTERVAL,
    LASER_H,
    LASER_INTERVAL_PER_LV,
    LASER_SPEED,
    LASER_W,
    LAUNCH_ANGLE_DEG,
    MAX_FRAME_DT,
    MAX_LIVES,
    MAX_STEPS_PER_FRAME,
    NARROW_ANGLE_STEP_DEG,
    PADDLE_BOTTOM_MARGIN,
    PADDLE_FOLLOW_PER_SEC,
    PADDLE_H,
    PADDLE_MAX_ANGLE_DEG,
    PADDLE_MIN_ANGLE_DEG,
    PADDLE_W,
    PIERCE_SKIP_PER_LV,
    PIERCE_SKIP_SEC,
    PLAY_H,
    PLAY_W,
    SCORE_PER_HP,
    SLOW_BALL_STEP,
    SPLIT_CHANCE_PER_LV,
    SPLIT_MAX_BALLS,
    STALL_NUDGE_DEG,
    STALL_NUDGE_SEC,
    TOUGH_CHANCE_BASE,
    TOUGH_CHANCE_MAX,
    TOUGH_CHANCE_STEP,
    UPGRADES,
    getUpgradeDef,
} from './BrickConfig';
import type { UpgradeId } from './BrickConfig';

// ==================== 类型 ====================

export type BrickKind = 'normal' | 'tough' | 'bomb';
export type CoreState = 'ready' | 'playing' | 'level_clear' | 'game_over';

export interface Brick {
    id: number;
    row: number;
    col: number;
    /** 左上角 */
    x: number;
    y: number;
    w: number;
    h: number;
    hp: number;
    maxHp: number;
    kind: BrickKind;
    alive: boolean;
}

export interface Ball {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    /** 粘在挡板上 */
    stuck: boolean;
    /** 粘住时相对挡板中心的偏移 */
    stuckOffset: number;
    /** 穿透时忽略的砖块 id（-1 表示无） */
    skipId: number;
    skipTimer: number;
    horizontalTimer: number;
}

export interface Paddle {
    /** 中心点 */
    x: number;
    y: number;
    w: number;
    h: number;
    /** 手指目标位置（中心 x） */
    targetX: number;
}

export interface Laser {
    x: number;
    y: number;
    w: number;
    h: number;
    alive: boolean;
}

export type CoreEvent =
    | { type: 'brick_hit'; x: number; y: number; hp: number; maxHp: number; kind: BrickKind }
    | { type: 'brick_destroy'; x: number; y: number; kind: BrickKind }
    | { type: 'paddle_hit'; x: number; y: number }
    | { type: 'wall_hit'; x: number; y: number }
    | { type: 'laser_fire'; x: number; y: number }
    | { type: 'ball_lost'; x: number; y: number }
    | { type: 'life_lost'; lives: number }
    | { type: 'level_clear'; level: number }
    | { type: 'game_over'; score: number; level: number };

export interface CoreOptions {
    seed?: number;
}

// ==================== 工具 ====================

const DEG2RAD = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
    return v < min ? min : v > max ? max : v;
}

/** 确定性随机数（同 seed 同序列），用于关卡生成与升级抽卡 */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function next(): number {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function circleRectOverlap(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number): boolean {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
}

// ==================== 核心 ====================

export class BrickCore {
    private _state: CoreState = 'ready';
    private _level = 1;
    private _score = 0;
    private _lives = BASE_LIVES;
    private _combo = 0;
    private _runSeed = 1;

    private _bricks: Brick[] = [];
    private _balls: Ball[] = [];
    private _lasers: Laser[] = [];
    private _paddle: Paddle = {
        x: PLAY_W / 2,
        y: PLAY_H - PADDLE_BOTTOM_MARGIN - PADDLE_H / 2,
        w: PADDLE_W,
        h: PADDLE_H,
        targetX: PLAY_W / 2,
    };

    private _upgrades: { [id: string]: number } = {};
    private _pendingChoices: UpgradeId[] = [];
    private _events: CoreEvent[] = [];

    private _levelRng: () => number = mulberry32(1);
    private _upgradeRng: () => number = mulberry32(1);
    private _acc = 0;
    private _laserTimer = 0;
    private _sinceBrickHit = 0;
    private _nextBrickId = 1;
    private _nextBallId = 1;

    constructor(options?: CoreOptions) {
        this.startRun(options && options.seed !== undefined ? options.seed : Math.floor(Math.random() * 1e9));
    }

    // ==================== 只读访问 ====================

    get state(): CoreState {
        return this._state;
    }

    get level(): number {
        return this._level;
    }

    get score(): number {
        return this._score;
    }

    get lives(): number {
        return this._lives;
    }

    get combo(): number {
        return this._combo;
    }

    get bricks(): ReadonlyArray<Brick> {
        return this._bricks;
    }

    get balls(): ReadonlyArray<Ball> {
        return this._balls;
    }

    get lasers(): ReadonlyArray<Laser> {
        return this._lasers;
    }

    get paddle(): Readonly<Paddle> {
        return this._paddle;
    }

    get pendingChoices(): ReadonlyArray<UpgradeId> {
        return this._pendingChoices;
    }

    get runSeed(): number {
        return this._runSeed;
    }

    upgradeLevel(id: UpgradeId): number {
        return this._upgrades[id] || 0;
    }

    /** 弹球当前速度（随关数增长、受减速升级影响） */
    ballSpeed(): number {
        const base = Math.min(BALL_MAX_SPEED, BALL_BASE_SPEED + (this._level - 1) * BALL_SPEED_PER_LEVEL);
        return clamp(base - SLOW_BALL_STEP * this.upgradeLevel('slow_ball'), BALL_MIN_SPEED, BALL_MAX_SPEED);
    }

    ballDamage(): number {
        return 1 + this.upgradeLevel('ball_damage');
    }

    paddleWidth(): number {
        return PADDLE_W + 18 * this.upgradeLevel('paddle_widen');
    }

    maxBounceAngleDeg(): number {
        return Math.max(
            PADDLE_MIN_ANGLE_DEG,
            PADDLE_MAX_ANGLE_DEG - NARROW_ANGLE_STEP_DEG * this.upgradeLevel('narrow_angle'),
        );
    }

    /** 当前存活砖块数 */
    get aliveBrickCount(): number {
        let n = 0;
        for (const b of this._bricks) {
            if (b.alive) n++;
        }
        return n;
    }

    // ==================== 生命周期 ====================

    /** 开新的一局（清空分数、生命、升级） */
    startRun(seed?: number): void {
        this._runSeed = seed === undefined ? Math.floor(Math.random() * 1e9) : (seed >>> 0);
        this._level = 1;
        this._score = 0;
        this._lives = BASE_LIVES;
        this._combo = 0;
        this._upgrades = {};
        this._pendingChoices = [];
        this._events = [];
        this._acc = 0;
        this._sinceBrickHit = 0;
        this._nextBrickId = 1;
        this._nextBallId = 1;
        this._buildLevel();
        this._resetToReady();
    }

    /** 手指目标位置（挡板会平滑跟随，不是瞬移） */
    setPaddleTarget(x: number, immediate = false): void {
        this._paddle.targetX = clamp(x, this._paddle.w / 2, PLAY_W - this._paddle.w / 2);
        if (immediate) {
            this._paddle.x = this._paddle.targetX;
        }
    }

    /** 发球：ready 状态发主球（并按 extra_ball 层数补球）；粘性球则原地发球 */
    launch(): boolean {
        if (this._state === 'ready') {
            this._launchReadyBalls();
            return true;
        }
        if (this._state !== 'playing') {
            return false;
        }
        let launched = false;
        for (const ball of this._balls) {
            if (ball.stuck) {
                this._launchStuckBall(ball);
                launched = true;
            }
        }
        return launched;
    }

    // ==================== 推进 ====================

    step(dt: number): void {
        if (this._state !== 'playing' && this._state !== 'ready') {
            return;
        }
        const frame = Math.max(0, Math.min(dt, MAX_FRAME_DT));
        this._acc += frame;
        let guard = 0;
        while (this._acc >= FIXED_STEP_SEC && guard < MAX_STEPS_PER_FRAME) {
            this._substep(FIXED_STEP_SEC);
            this._acc -= FIXED_STEP_SEC;
            guard++;
            if (this._state !== 'playing' && this._state !== 'ready') {
                break;
            }
        }
        if (guard >= MAX_STEPS_PER_FRAME) {
            this._acc = 0;
        }
    }

    // ==================== 升级 ====================

    /** 从通关后弹出的三个候选中选一个；成功返回 true */
    applyUpgrade(id: UpgradeId): boolean {
        if (this._state !== 'level_clear') {
            return false;
        }
        const def = getUpgradeDef(id);
        const current = this.upgradeLevel(id);
        if (current >= def.maxLevel) {
            return false;
        }
        this._grantUpgrade(id);

        this._level += 1;
        this._buildLevel();
        this._resetToReady();
        this._pendingChoices = [];
        return true;
    }

    /**
     * 所有升级都满级时的兜底：没有可选项就直接进下一关。
     *
     * 没有这一步，通关面板会因为「三个候选都是已满级」而被过滤成空列表，
     * 玩家会被永久卡在通关界面。
     */
    skipUpgrade(): boolean {
        if (this._state !== 'level_clear') {
            return false;
        }
        this._level += 1;
        this._buildLevel();
        this._resetToReady();
        this._pendingChoices = [];
        return true;
    }

    /** 升级效果的实际落地（抽出来供 applyUpgrade 和测试钩子共用） */
    private _grantUpgrade(id: UpgradeId): void {
        const current = this.upgradeLevel(id);
        this._upgrades[id] = current + 1;

        if (id === 'extra_life') {
            this._lives = Math.min(MAX_LIVES, this._lives + 1);
        } else if (id === 'extra_ball') {
            // 当前关立即补一颗球（发球时还会按层数多发）
            if (this._state === 'playing') {
                this._spawnBallAtPaddle();
            }
        } else if (id === 'paddle_widen') {
            this._paddle.w = this.paddleWidth();
            const half = this._paddle.w / 2;
            this._paddle.x = clamp(this._paddle.x, half, PLAY_W - half);
            this._paddle.targetX = clamp(this._paddle.targetX, half, PLAY_W - half);
        } else if (id === 'slow_ball') {
            this._normalizeBallSpeeds();
        }
    }

    /** 滑动升级后让场上的球立刻采用新速度（保持方向） */
    private _normalizeBallSpeeds(): void {
        const speed = this.ballSpeed();
        for (const ball of this._balls) {
            if (ball.stuck) continue;
            const mag = Math.hypot(ball.vx, ball.vy);
            if (mag < 1e-6) continue;
            ball.vx = (ball.vx / mag) * speed;
            ball.vy = (ball.vy / mag) * speed;
        }
    }

    popEvents(): CoreEvent[] {
        if (this._events.length === 0) {
            return [];
        }
        const out = this._events;
        this._events = [];
        return out;
    }

    // ==================== 关卡生成 ====================

    private _buildLevel(): void {
        this._levelRng = mulberry32((this._runSeed * 1000 + this._level) >>> 0);
        this._upgradeRng = mulberry32((this._runSeed * 7919 + this._level * 131) >>> 0);

        this._bricks = [];
        this._nextBrickId = 1;

        const rows = Math.min(3 + Math.floor((this._level - 1) / 2), BRICK_MAX_ROWS);
        const holeChance = Math.min(HOLE_CHANCE_MAX, HOLE_CHANCE_BASE * this._level);
        const toughChance = Math.min(TOUGH_CHANCE_MAX, TOUGH_CHANCE_BASE + TOUGH_CHANCE_STEP * this._level);
        const totalW = BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * BRICK_GAP_X;
        const left = (PLAY_W - totalW) / 2;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < BRICK_COLS; col++) {
                if (row > 0 && this._levelRng() < holeChance) {
                    continue;
                }
                let hp = 1;
                if (this._levelRng() < toughChance) {
                    hp = 2;
                }
                if (this._level >= HP3_FROM_LEVEL && this._levelRng() < HP3_CHANCE) {
                    hp = 3;
                }
                this._bricks.push({
                    id: this._nextBrickId++,
                    row,
                    col,
                    x: left + col * (BRICK_W + BRICK_GAP_X),
                    y: BRICK_TOP + row * (BRICK_H + BRICK_GAP_Y),
                    w: BRICK_W,
                    h: BRICK_H,
                    hp,
                    maxHp: hp,
                    kind: hp >= 2 ? 'tough' : 'normal',
                    alive: true,
                });
            }
        }

        // 炸弹砖：从现有砖块里随机挑几个改成 1 耐久炸弹
        const bombCount = Math.min(BOMB_MAX, 1 + Math.floor(this._level / BOMB_PER_3_LEVELS));
        const candidates = this._bricks.slice();
        for (let i = 0; i < bombCount && candidates.length > 0; i++) {
            const idx = Math.floor(this._levelRng() * candidates.length);
            const brick = candidates.splice(idx, 1)[0];
            brick.kind = 'bomb';
            brick.hp = 1;
            brick.maxHp = 1;
        }

        // 保底：至少一块可打的砖
        if (this._bricks.length === 0) {
            const col = Math.floor(BRICK_COLS / 2);
            this._bricks.push({
                id: this._nextBrickId++,
                row: 0,
                col,
                x: left + col * (BRICK_W + BRICK_GAP_X),
                y: BRICK_TOP,
                w: BRICK_W,
                h: BRICK_H,
                hp: 1,
                maxHp: 1,
                kind: 'normal',
                alive: true,
            });
        }

        this._paddle.w = this.paddleWidth();
        this._paddle.x = clamp(this._paddle.x, this._paddle.w / 2, PLAY_W - this._paddle.w / 2);
        this._paddle.targetX = this._paddle.x;
        this._paddle.y = PLAY_H - PADDLE_BOTTOM_MARGIN - this._paddle.h / 2;
        this._lasers = [];
        this._laserTimer = 0;
    }

    private _resetToReady(): void {
        this._combo = 0;
        this._lasers = [];
        this._laserTimer = 0;
        this._sinceBrickHit = 0;
        this._balls = [this._makeStuckBall()];
        this._state = 'ready';
    }

    private _makeStuckBall(): Ball {
        const p = this._paddle;
        return {
            id: this._nextBallId++,
            x: p.x,
            y: p.y - p.h / 2 - BALL_R - 0.5,
            vx: 0,
            vy: 0,
            r: BALL_R,
            stuck: true,
            stuckOffset: 0,
            skipId: -1,
            skipTimer: 0,
            horizontalTimer: 0,
        };
    }

    // ==================== 发球 ====================

    private _launchReadyBalls(): void {
        const p = this._paddle;
        const speed = this.ballSpeed();
        const baseAngle = (this._levelRng() * 2 - 1) * LAUNCH_ANGLE_DEG * DEG2RAD;
        const count = 1 + this.upgradeLevel('extra_ball');
        this._balls = [];
        for (let i = 0; i < count; i++) {
            const spread = count === 1 ? 0 : (i - (count - 1) / 2) * 15 * DEG2RAD;
            const angle = clamp(baseAngle + spread, -60 * DEG2RAD, 60 * DEG2RAD);
            const ball = this._makeStuckBall();
            ball.x = p.x + spread * 20;
            ball.y = p.y - p.h / 2 - BALL_R - 0.5;
            ball.stuck = false;
            ball.vx = speed * Math.sin(angle);
            ball.vy = -speed * Math.cos(angle);
            this._balls.push(ball);
        }
        this._state = 'playing';
        this._laserTimer = 0;
    }

    private _launchStuckBall(ball: Ball): void {
        const p = this._paddle;
        const speed = this.ballSpeed();
        const offset = clamp((ball.x - p.x) / (p.w / 2), -1, 1);
        let angle = offset * this.maxBounceAngleDeg() * DEG2RAD * 0.8;
        const minAngle = 5 * DEG2RAD;
        if (Math.abs(angle) < minAngle) {
            angle = offset < 0 ? -minAngle : minAngle;
        }
        ball.stuck = false;
        ball.skipId = -1;
        ball.skipTimer = 0;
        ball.horizontalTimer = 0;
        ball.vx = speed * Math.sin(angle);
        ball.vy = -speed * Math.cos(angle);
        // 防止贴在挡板上时把球留在挡板里
        ball.y = Math.min(ball.y, p.y - p.h / 2 - BALL_R - 0.5);
        this._state = 'playing';
    }

    private _spawnBallAtPaddle(): void {
        if (this._balls.length >= SPLIT_MAX_BALLS + 2) {
            return;
        }
        const p = this._paddle;
        const speed = this.ballSpeed();
        const angle = (this._levelRng() * 2 - 1) * LAUNCH_ANGLE_DEG * DEG2RAD;
        this._balls.push({
            id: this._nextBallId++,
            x: p.x,
            y: p.y - p.h / 2 - BALL_R - 0.5,
            vx: speed * Math.sin(angle),
            vy: -speed * Math.cos(angle),
            r: BALL_R,
            stuck: false,
            stuckOffset: 0,
            skipId: -1,
            skipTimer: 0,
            horizontalTimer: 0,
        });
    }

    // ==================== 子步 ====================

    private _substep(dt: number): void {
        this._updatePaddle(dt);

        if (this._state === 'ready') {
            this._updateStuckBalls();
            return;
        }

        this._updateLasers(dt);
        this._updateBalls(dt);
        this._updateStallGuard(dt);
        this._checkLevelClear();
    }

    private _updatePaddle(dt: number): void {
        const p = this._paddle;
        const half = p.w / 2;
        const target = clamp(p.targetX, half, PLAY_W - half);
        const k = Math.min(1, PADDLE_FOLLOW_PER_SEC * dt);
        p.x += (target - p.x) * k;
        p.x = clamp(p.x, half, PLAY_W - half);
        p.y = PLAY_H - PADDLE_BOTTOM_MARGIN - p.h / 2;
    }

    private _updateStuckBalls(): void {
        const p = this._paddle;
        for (const ball of this._balls) {
            if (!ball.stuck) continue;
            const half = p.w / 2 - ball.r;
            ball.x = clamp(p.x + ball.stuckOffset, p.x - half, p.x + half);
            ball.y = p.y - p.h / 2 - ball.r - 0.5;
        }
    }

    // ==================== 球 ====================

    private _updateBalls(dt: number): void {
        const lost: Ball[] = [];

        for (const ball of this._balls) {
            if (ball.stuck) {
                const p = this._paddle;
                const half = p.w / 2 - ball.r;
                ball.x = clamp(p.x + ball.stuckOffset, p.x - half, p.x + half);
                ball.y = p.y - p.h / 2 - ball.r - 0.5;
                continue;
            }

            if (ball.skipTimer > 0) {
                ball.skipTimer -= dt;
                if (ball.skipTimer <= 0) {
                    ball.skipId = -1;
                    ball.skipTimer = 0;
                }
            }

            if (Math.abs(ball.vy) < HORIZONTAL_STUCK_VY) {
                ball.horizontalTimer += dt;
            } else {
                ball.horizontalTimer = 0;
            }
            if (ball.horizontalTimer >= HORIZONTAL_STUCK_SEC) {
                this._nudgeBallVertically(ball);
                ball.horizontalTimer = 0;
            }

            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;

            this._collideWalls(ball);
            this._collidePaddle(ball);
            if (ball.stuck) {
                continue;
            }
            this._collideBricks(ball);

            if (ball.y - ball.r > PLAY_H + 40) {
                lost.push(ball);
            }
        }

        if (lost.length > 0) {
            for (const ball of lost) {
                this._events.push({ type: 'ball_lost', x: ball.x, y: ball.y });
            }
            this._balls = this._balls.filter(b => lost.indexOf(b) < 0);
            if (this._balls.length === 0) {
                this._handleAllBallsLost();
            }
        }
    }

    /**
     * 长时间没打中砖时的偏转防呆。
     *
     * 球在空列里垂直往返时永远不会碰到砖；只把方向旋转 STALL_NUDGE_DEG，速度模长不变，
     * 手感上像球「自己拐了一下」，不会突然加速。
     */
    private _updateStallGuard(dt: number): void {
        this._sinceBrickHit += dt;
        if (this._sinceBrickHit < STALL_NUDGE_SEC) {
            return;
        }
        this._sinceBrickHit = 0;
        const angle = (this._levelRng() < 0.5 ? -1 : 1) * STALL_NUDGE_DEG * DEG2RAD;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        for (const ball of this._balls) {
            if (ball.stuck) continue;
            const vx = ball.vx * cos - ball.vy * sin;
            const vy = ball.vx * sin + ball.vy * cos;
            ball.vx = vx;
            ball.vy = vy;
        }
    }

    private _nudgeBallVertically(ball: Ball): void {        const speed = Math.hypot(ball.vx, ball.vy) || this.ballSpeed();
        const dir = ball.vy !== 0 ? Math.sign(ball.vy) : this._levelRng() < 0.5 ? -1 : 1;
        ball.vy = HORIZONTAL_NUDGE_VY * dir;
        const mag = Math.hypot(ball.vx, ball.vy) || 1;
        ball.vx = (ball.vx / mag) * speed;
        ball.vy = (ball.vy / mag) * speed;
    }

    private _collideWalls(ball: Ball): void {
        if (ball.y - ball.r < 0) {
            ball.y = ball.r;
            ball.vy = Math.abs(ball.vy);
            this._events.push({ type: 'wall_hit', x: ball.x, y: ball.y });
        }
        if (ball.x - ball.r < 0) {
            ball.x = ball.r;
            ball.vx = Math.abs(ball.vx);
            this._events.push({ type: 'wall_hit', x: ball.x, y: ball.y });
        } else if (ball.x + ball.r > PLAY_W) {
            ball.x = PLAY_W - ball.r;
            ball.vx = -Math.abs(ball.vx);
            this._events.push({ type: 'wall_hit', x: ball.x, y: ball.y });
        }
    }

    private _collidePaddle(ball: Ball): void {
        const p = this._paddle;
        if (ball.vy <= 0) {
            return;
        }
        const left = p.x - p.w / 2;
        const right = p.x + p.w / 2;
        const top = p.y - p.h / 2;
        const bottom = p.y + p.h / 2;
        if (!circleRectOverlap(ball.x, ball.y, ball.r, left, top, p.w, p.h)) {
            return;
        }
        // 从挡板下方穿过的不算接住
        if (ball.y > p.y + p.h) {
            return;
        }

        ball.y = top - ball.r - 0.5;
        this._combo = 0;
        this._events.push({ type: 'paddle_hit', x: ball.x, y: top });

        if (this.upgradeLevel('sticky') > 0) {
            ball.vx = 0;
            ball.vy = 0;
            ball.stuck = true;
            ball.stuckOffset = clamp(ball.x - p.x, -p.w / 2 + ball.r, p.w / 2 - ball.r);
            ball.horizontalTimer = 0;
            return;
        }

        const offset = clamp((ball.x - p.x) / (p.w / 2), -1, 1);
        const angle = offset * this.maxBounceAngleDeg() * DEG2RAD;
        const speed = this.ballSpeed();
        ball.vx = speed * Math.sin(angle);
        ball.vy = -speed * Math.cos(angle);
        ball.horizontalTimer = 0;
    }

    private _collideBricks(ball: Ball): void {
        for (const brick of this._bricks) {
            if (!brick.alive) continue;
            if (brick.id === ball.skipId && ball.skipTimer > 0) continue;
            if (!circleRectOverlap(ball.x, ball.y, ball.r, brick.x, brick.y, brick.w, brick.h)) {
                continue;
            }

            const destroyed = this._damageBrick(brick, this.ballDamage(), 'ball');
            const pierceLevel = this.upgradeLevel('pierce');
            const canPierce = pierceLevel > 0 && brick.kind === 'normal';

            if (canPierce) {
                ball.skipId = brick.id;
                ball.skipTimer = PIERCE_SKIP_SEC + PIERCE_SKIP_PER_LV * (pierceLevel - 1);
            } else {
                this._reflectOffBrick(ball, brick);
            }

            // 每步最多命中一块砖；分裂基于「这颗球打碎了砖」
            if (destroyed) {
                this._trySplitBall(brick);
            }
            return;
        }
    }

    private _reflectOffBrick(ball: Ball, brick: Brick): void {
        const cx = brick.x + brick.w / 2;
        const cy = brick.y + brick.h / 2;
        const overlapX = ball.r + brick.w / 2 - Math.abs(ball.x - cx);
        const overlapY = ball.r + brick.h / 2 - Math.abs(ball.y - cy);

        if (overlapX < overlapY) {
            ball.vx = -ball.vx;
            ball.x += (ball.x >= cx ? 1 : -1) * Math.max(0.5, overlapX);
        } else {
            ball.vy = -ball.vy;
            ball.y += (ball.y >= cy ? 1 : -1) * Math.max(0.5, overlapY);
        }
    }

    private _trySplitBall(brick: Brick): void {
        const level = this.upgradeLevel('split');
        if (level <= 0 || this._balls.length >= SPLIT_MAX_BALLS) {
            return;
        }
        if (this._levelRng() >= SPLIT_CHANCE_PER_LV * level) {
            return;
        }
        const speed = this.ballSpeed();
        const angle = (this._levelRng() * 2 - 1) * PADDLE_MAX_ANGLE_DEG * DEG2RAD;
        this._balls.push({
            id: this._nextBallId++,
            x: brick.x + brick.w / 2,
            y: brick.y + brick.h / 2,
            vx: speed * Math.sin(angle),
            vy: -Math.abs(speed * Math.cos(angle)),
            r: BALL_R,
            stuck: false,
            stuckOffset: 0,
            skipId: -1,
            skipTimer: 0,
            horizontalTimer: 0,
        });
    }

    private _handleAllBallsLost(): void {
        this._lives -= 1;
        this._events.push({ type: 'life_lost', lives: this._lives });
        if (this._lives <= 0) {
            this._lives = 0;
            this._state = 'game_over';
            this._lasers = [];
            this._events.push({ type: 'game_over', score: this._score, level: this._level });
            return;
        }
        this._resetToReady();
    }

    // ==================== 伤害 / 计分 ====================

    private _damageBrick(brick: Brick, amount: number, source: 'ball' | 'laser' | 'explosion'): boolean {
        if (!brick.alive || amount <= 0) {
            return false;
        }
        this._sinceBrickHit = 0;
        brick.hp -= amount;
        this._events.push({
            type: 'brick_hit',
            x: brick.x + brick.w / 2,
            y: brick.y + brick.h / 2,
            hp: Math.max(0, brick.hp),
            maxHp: brick.maxHp,
            kind: brick.kind,
        });

        if (brick.hp > 0) {
            return false;
        }

        brick.alive = false;
        this._combo += 1;
        const comboMult = 1 + COMBO_STEP * (this._combo - 1);
        const scoreMult = Math.pow(1.25, this.upgradeLevel('score_mult'));
        this._score += Math.round(SCORE_PER_HP * brick.maxHp * comboMult * scoreMult);
        this._events.push({
            type: 'brick_destroy',
            x: brick.x + brick.w / 2,
            y: brick.y + brick.h / 2,
            kind: brick.kind,
        });

        if (brick.kind === 'bomb') {
            this._explodeAround(brick, 1);
        }
        if (source === 'ball') {
            const explosive = this.upgradeLevel('explosive');
            if (explosive > 0) {
                this._splashAround(brick, explosive);
            }
        }
        return true;
    }

    /**
     * 炸弹：3×3 范围 1 点伤害。
     *
     * 连锁不需要队列：被波及的炸弹会在 `_damageBrick` 里再次调用本方法，
     * 而已经死亡的砖块不会重复受伤，递归自然终止。
     */
    private _explodeAround(source: Brick, damage: number): void {
        for (const brick of this._bricks) {
            if (!brick.alive) continue;
            if (Math.abs(brick.row - source.row) > 1 || Math.abs(brick.col - source.col) > 1) continue;
            this._damageBrick(brick, damage, 'explosion');
        }
    }

    /** 爆炸球：命中点周围 3×3 溅射（不含炸弹自身的连锁，由 _damageBrick 处理） */
    private _splashAround(center: Brick, damage: number): void {
        for (const brick of this._bricks) {
            if (!brick.alive) continue;
            if (brick.id === center.id) continue;
            if (Math.abs(brick.row - center.row) > 1 || Math.abs(brick.col - center.col) > 1) continue;
            this._damageBrick(brick, damage, 'explosion');
        }
    }

    // ==================== 激光 ====================

    private _updateLasers(dt: number): void {
        const level = this.upgradeLevel('laser');
        if (level > 0) {
            const interval = LASER_BASE_INTERVAL / (1 + LASER_INTERVAL_PER_LV * level);
            this._laserTimer -= dt;
            if (this._laserTimer <= 0) {
                this._fireLasers();
                this._laserTimer = interval;
            }
        }

        if (this._lasers.length === 0) {
            return;
        }

        for (const laser of this._lasers) {
            laser.y -= LASER_SPEED * dt;
            for (const brick of this._bricks) {
                if (!brick.alive) continue;
                const lx = laser.x - laser.w / 2;
                const ly = laser.y - laser.h / 2;
                if (lx + laser.w < brick.x || lx > brick.x + brick.w) continue;
                if (ly + laser.h < brick.y || ly > brick.y + brick.h) continue;
                this._damageBrick(brick, 1, 'laser');
                laser.alive = false;
                break;
            }
            if (laser.y + laser.h / 2 < -20) {
                laser.alive = false;
            }
        }
        this._lasers = this._lasers.filter(l => l.alive);
    }

    private _fireLasers(): void {
        const p = this._paddle;
        const y = p.y - p.h / 2 - LASER_H / 2;
        const inset = Math.min(14, p.w / 4);
        const xs = [p.x - p.w / 2 + inset, p.x + p.w / 2 - inset];
        for (const x of xs) {
            this._lasers.push({ x, y, w: LASER_W, h: LASER_H, alive: true });
            this._events.push({ type: 'laser_fire', x, y });
        }
    }

    // ==================== 通关 / 升级抽卡 ====================

    private _checkLevelClear(): void {
        if (this._state !== 'playing') {
            return;
        }
        if (this.aliveBrickCount > 0) {
            return;
        }
        this._state = 'level_clear';
        this._balls = [];
        this._lasers = [];
        this._pendingChoices = this.rollUpgrades();
        this._events.push({ type: 'level_clear', level: this._level });
    }

    /** 抽 3 个不重复、未满级的升级（权重采样，无放回） */
    rollUpgrades(): UpgradeId[] {
        const pool: { id: UpgradeId; weight: number }[] = [];
        for (const def of UPGRADES) {
            if (this.upgradeLevel(def.id) < def.maxLevel) {
                pool.push({ id: def.id, weight: def.weight });
            }
        }
        const picked: UpgradeId[] = [];
        const count = Math.min(3, pool.length);
        for (let i = 0; i < count; i++) {
            let total = 0;
            for (const item of pool) total += item.weight;
            let roll = this._upgradeRng() * total;
            let idx = 0;
            for (let j = 0; j < pool.length; j++) {
                roll -= pool[j].weight;
                if (roll <= 0) {
                    idx = j;
                    break;
                }
            }
            picked.push(pool[idx].id);
            pool.splice(idx, 1);
        }
        return picked;
    }

    // ==================== 测试辅助 ====================

    /**
     * 直接生成一颗指定位置/速度的球（仅测试与调试用）。
     * 正式流程请走 launch()。
     */
    debugAddBall(x: number, y: number, vx: number, vy: number): Ball {
        const ball: Ball = {
            id: this._nextBallId++,
            x,
            y,
            vx,
            vy,
            r: BALL_R,
            stuck: false,
            stuckOffset: 0,
            skipId: -1,
            skipTimer: 0,
            horizontalTimer: 0,
        };
        this._balls.push(ball);
        if (this._state === 'ready') {
            this._state = 'playing';
        }
        return ball;
    }

    /** 清空当前关卡砖块中的指定 id（仅测试用） */
    debugKillBrick(id: number): void {
        for (const brick of this._bricks) {
            if (brick.id === id) {
                brick.alive = false;
            }
        }
    }

    /** 移除除一颗以外的所有球，方便构造单球场景（仅测试用） */
    debugKeepOnlyBall(ball: Ball): void {
        this._balls = this._balls.filter(b => b === ball);
    }

    /** 直接设置生命（仅测试用） */
    debugSetLives(lives: number): void {
        this._lives = lives;
    }

    /** 直接跳到某一关并重建砖块（仅测试/调试用，不改分数与升级） */
    debugSetLevel(level: number): void {
        this._level = Math.max(1, Math.floor(level));
        this._buildLevel();
        this._resetToReady();
    }

    /** 直接设置某个升级的层数（仅测试/调试用） */
    debugSetUpgrade(id: UpgradeId, level: number): void {
        const def = getUpgradeDef(id);
        this._upgrades[id] = clamp(Math.floor(level), 0, def.maxLevel);
        this._paddle.w = this.paddleWidth();
        const half = this._paddle.w / 2;
        this._paddle.x = clamp(this._paddle.x, half, PLAY_W - half);
        this._paddle.targetX = clamp(this._paddle.targetX, half, PLAY_W - half);
        this._normalizeBallSpeeds();
    }

    /** 直接发放一个升级（仅测试/调试用，走与正常流程相同的效果落地） */
    debugGrantUpgrade(id: UpgradeId): void {
        this._grantUpgrade(id);
    }
}
