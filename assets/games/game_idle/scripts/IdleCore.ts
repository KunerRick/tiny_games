/**
 * 小店日记 —— 纯逻辑核心（不依赖 cc，可被 Node 自检直接编译）。
 *
 * 负责：设施费用与等级、点击 / 自动 / 离线收益、大数格式化、存档快照。
 * 所有数值入口都做 clamp：不产出 NaN / Infinity / 负数，金币上限 1e15。
 */

export type IdleFacilityId = 'shelf' | 'counter' | 'clerk' | 'warehouse';

export interface IdleFacilityDef {
    id: IdleFacilityId;
    name: string;
    desc: string;
    baseCost: number;
    growth: number;
}

export const IDLE_MAX_LEVEL = 5;
export const IDLE_MAX_COINS = 1e15;
export const IDLE_OFFLINE_CAP_SEC = 8 * 3600;
/** 离线效率基础值：仓库 0 级时只结算 40% */
export const IDLE_OFFLINE_BASE_RATE = 0.4;
/** 仓库每级增加的离线效率 */
export const IDLE_OFFLINE_RATE_PER_LEVEL = 0.12;
/** 收银台每级的基础每秒收入 */
export const IDLE_COUNTER_RATE = 0.6;
/** 货架每级的点击加成 */
export const IDLE_SHELF_CLICK = 2;
/** 店员每级的全局加成 */
export const IDLE_CLERK_BONUS = 0.2;
/** 单帧在线收益的 dt 上限（秒），防止切后台回来一次灌入巨额收益 */
export const IDLE_MAX_TICK_DT = 5;

export const IDLE_FACILITIES: IdleFacilityDef[] = [
    { id: 'shelf', name: '货架', desc: '提高每次点击收益', baseCost: 20, growth: 3.4 },
    { id: 'counter', name: '收银台', desc: '自动收入来源', baseCost: 50, growth: 4.0 },
    { id: 'clerk', name: '店员', desc: '点击与自动收益加成', baseCost: 120, growth: 4.2 },
    { id: 'warehouse', name: '仓库', desc: '提高离线收益效率', baseCost: 80, growth: 3.8 },
];

export const IDLE_FACILITY_IDS: IdleFacilityId[] = ['shelf', 'counter', 'clerk', 'warehouse'];

export interface IdleLevels {
    shelf: number;
    counter: number;
    clerk: number;
    warehouse: number;
}

export interface IdleSnapshot {
    v: 1;
    coins: number;
    levels: IdleLevels;
    lastTick: number;
    totalEarned: number;
}

export interface IdleOfflineResult {
    /** 实际离线秒数（可能大于上限） */
    elapsedSec: number;
    /** 计入收益的秒数（不超过 8 小时） */
    countedSec: number;
    /** 本次离线获得的金币 */
    gain: number;
    /** 每秒离线收益 */
    rate: number;
    /** 是否触发 8 小时上限 */
    capped: boolean;
    /** 本地时间是否倒退（倒退按 0 结算） */
    rewound: boolean;
}

const UNIT_NAMES = ['', 'K', 'M', 'B', 'T'];
const FACILITY_MAP: Record<string, IdleFacilityDef> = {};
for (let i = 0; i < IDLE_FACILITIES.length; i++) {
    FACILITY_MAP[IDLE_FACILITIES[i].id] = IDLE_FACILITIES[i];
}

export function createZeroLevels(): IdleLevels {
    return { shelf: 0, counter: 0, clerk: 0, warehouse: 0 };
}

export function clampLevel(value: unknown): number {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(IDLE_MAX_LEVEL, n);
}

export function clampCoins(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(IDLE_MAX_COINS, n);
}

/** 大数格式化：1.2K / 3.4M / 5.6B / 7.8T，上限 1000T */
export function formatIdleNumber(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0';
    if (value >= IDLE_MAX_COINS) return '1000T';
    if (value < 1000) return String(Math.floor(value));

    let v = value;
    let unit = 0;
    while (v >= 1000 && unit < UNIT_NAMES.length - 1) {
        v /= 1000;
        unit++;
    }
    let text = v >= 100 ? v.toFixed(0) : v.toFixed(1);
    // 999.96K 这类四舍五入后应进位成 1M
    if (Number.parseFloat(text) >= 1000 && unit < UNIT_NAMES.length - 1) {
        v /= 1000;
        unit++;
        text = v >= 100 ? v.toFixed(0) : v.toFixed(1);
    }
    return `${text.replace(/\.0$/, '')}${UNIT_NAMES[unit]}`;
}

/** 收益速率格式化：小于 100 保留一位小数（0.6 / 12.5），否则走大数格式 */
export function formatIdleRate(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0';
    if (value < 100) {
        return String(Math.round(value * 10) / 10);
    }
    return formatIdleNumber(value);
}

/** 当前等级升到下一级的费用；已满级或非法等级返回 -1 */
export function idleUpgradeCost(id: IdleFacilityId, level: number): number {
    const def = FACILITY_MAP[id];
    if (!def) return -1;
    const lv = clampLevel(level);
    if (lv >= IDLE_MAX_LEVEL) return -1;
    return Math.round(def.baseCost * Math.pow(def.growth, lv));
}

export function idleClickPower(levels: IdleLevels): number {
    const shelf = clampLevel(levels.shelf);
    const clerk = clampLevel(levels.clerk);
    return (1 + IDLE_SHELF_CLICK * shelf) * (1 + IDLE_CLERK_BONUS * clerk);
}

export function idleAutoRate(levels: IdleLevels): number {
    const counter = clampLevel(levels.counter);
    const clerk = clampLevel(levels.clerk);
    return IDLE_COUNTER_RATE * counter * (1 + IDLE_CLERK_BONUS * clerk);
}

export function idleOfflineRate(levels: IdleLevels): number {
    const warehouse = clampLevel(levels.warehouse);
    return Math.min(1, IDLE_OFFLINE_BASE_RATE + IDLE_OFFLINE_RATE_PER_LEVEL * warehouse);
}

export class IdleCore {
    coins = 0;
    levels: IdleLevels = createZeroLevels();
    lastTick = 0;
    totalEarned = 0;

    constructor(now: number = Date.now()) {
        this.lastTick = Number.isFinite(now) ? now : Date.now();
    }

    get clickPower(): number {
        return idleClickPower(this.levels);
    }

    get autoRate(): number {
        return idleAutoRate(this.levels);
    }

    get offlineRate(): number {
        return idleOfflineRate(this.levels);
    }

    get isMaxed(): boolean {
        for (let i = 0; i < IDLE_FACILITY_IDS.length; i++) {
            if (this.levels[IDLE_FACILITY_IDS[i]] < IDLE_MAX_LEVEL) return false;
        }
        return true;
    }

    get upgradeCount(): number {
        let sum = 0;
        for (let i = 0; i < IDLE_FACILITY_IDS.length; i++) sum += this.levels[IDLE_FACILITY_IDS[i]];
        return sum;
    }

    levelOf(id: IdleFacilityId): number {
        return clampLevel(this.levels[id]);
    }

    costOf(id: IdleFacilityId): number {
        return idleUpgradeCost(id, this.levelOf(id));
    }

    /** 一次点击；返回实际获得的金币 */
    tap(): number {
        return this._earn(this.clickPower);
    }

    /** 购买一级；满级或金币不足返回 false */
    buy(id: IdleFacilityId): boolean {
        const def = FACILITY_MAP[id];
        if (!def) return false;
        const cost = this.costOf(id);
        if (cost < 0) return false;
        if (this.coins < cost) return false;
        this.coins = clampCoins(this.coins - cost);
        this.levels[id] = clampLevel(this.levels[id]) + 1;
        return true;
    }

    /** 在线自动收益；返回实际获得的金币 */
    tick(dt: number): number {
        if (!Number.isFinite(dt) || dt <= 0) return 0;
        const step = Math.min(dt, IDLE_MAX_TICK_DT);
        return this._earn(this.autoRate * step);
    }

    /**
     * 离线结算：把 lastTick 到 now 之间的收益补上。
     * 负时长按 0；单次上限 8 小时；金币封顶后不再增加。
     */
    settleOffline(now: number = Date.now()): IdleOfflineResult {
        const ts = Number.isFinite(now) ? now : Date.now();
        let elapsed = (ts - this.lastTick) / 1000;
        let rewound = false;
        if (!Number.isFinite(elapsed) || elapsed < 0) {
            elapsed = 0;
            rewound = true;
        }

        const countedSec = Math.min(elapsed, IDLE_OFFLINE_CAP_SEC);
        const rate = this.autoRate * this.offlineRate;
        const gain = this._earn(rate * countedSec);

        this.lastTick = ts;
        return {
            elapsedSec: elapsed,
            countedSec,
            gain,
            rate,
            capped: elapsed > IDLE_OFFLINE_CAP_SEC,
            rewound,
        };
    }

    snapshot(now: number = Date.now()): IdleSnapshot {
        return {
            v: 1,
            coins: clampCoins(this.coins),
            levels: {
                shelf: this.levelOf('shelf'),
                counter: this.levelOf('counter'),
                clerk: this.levelOf('clerk'),
                warehouse: this.levelOf('warehouse'),
            },
            lastTick: Number.isFinite(now) ? now : Date.now(),
            totalEarned: clampCoins(this.totalEarned),
        };
    }

    /** 坏档 / 缺字段一律回落默认值，绝不抛异常 */
    static fromSnapshot(raw: unknown, now: number = Date.now()): IdleCore {
        const core = new IdleCore(now);
        if (!raw || typeof raw !== 'object') return core;

        const data = raw as Partial<IdleSnapshot>;
        core.coins = clampCoins(data.coins);
        core.totalEarned = clampCoins(data.totalEarned);

        const levels = data.levels as Partial<IdleLevels> | undefined;
        if (levels && typeof levels === 'object') {
            for (let i = 0; i < IDLE_FACILITY_IDS.length; i++) {
                const id = IDLE_FACILITY_IDS[i];
                core.levels[id] = clampLevel(levels[id]);
            }
        }

        const lastTick = Number(data.lastTick);
        core.lastTick = Number.isFinite(lastTick) && lastTick > 0 ? lastTick : core.lastTick;
        return core;
    }

    /** 累计收益并封顶；返回本次实际获得的金币 */
    private _earn(amount: number): number {
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        const room = IDLE_MAX_COINS - this.coins;
        if (room <= 0) {
            this.coins = IDLE_MAX_COINS;
            return 0;
        }
        const gain = Math.min(amount, room);
        this.coins = clampCoins(this.coins + gain);
        this.totalEarned = clampCoins(this.totalEarned + gain);
        return gain;
    }
}
