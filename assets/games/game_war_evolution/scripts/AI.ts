import { Age, AgeConfig, UnitConfig, AI_CONFIG, getAgeConfig, getAvailableUnits, getNextAgeConfig, BUY_EXP } from './GameConfig';
import { Unit } from './Unit';
import { Castle } from './Castle';

/**
 * AI 对手控制器
 * 非 Cocos 组件，由 WarEvo 创建并驱动
 */
export class AI {
    private _gold: number = 100;            // AI 金币
    private _exp: number = 0;               // AI 经验
    private _currentAge: Age = Age.PRIMITIVE;
    private _spawnTimer: number = 0;
    private _spawnInterval: number = 2.0;
    private _gameTime: number = 0;

    // 外部引用
    private _spawnFn: (configId: string, side: 'enemy') => Unit | null;
    private _castle: Castle;
    private _onEvolve: ((age: Age) => void) | null = null;

    constructor(
        spawnFn: (configId: string, side: 'enemy') => Unit | null,
        castle: Castle,
        onEvolve?: (age: Age) => void,
    ) {
        this._spawnFn = spawnFn;
        this._castle = castle;
        this._onEvolve = onEvolve ?? null;
    }

    public getGold(): number { return this._gold; }
    public getExp(): number { return this._exp; }
    public getCurrentAge(): Age { return this._currentAge; }

    /** 由 WarEvo 每帧调用 */
    public tick(dt: number): void {
        this._gameTime += dt;

        // 金币由 WarEvo.update 通过 addGold 统一增长（避免与 WarEvo 重复给金币）
        // AI 额外击杀奖励通过 addKillReward 获得

        // 产兵
        this._spawnTimer -= dt;
        if (this._spawnTimer <= 0) {
            this._spawnTimer = this.getSpawnInterval();
            this.trySpawnUnit();
        }

        // 买经验（用多余金币加速进化）
        this.tryBuyExp();

        // 进化
        this.tryEvolve();
    }

    /** 获得击杀奖励 */
    public addKillReward(goldAmount: number): void {
        this._gold += goldAmount;
        this._exp += goldAmount;  // 经验 = 击杀金币（简化）
    }

    /** 手动加金币（如基础收入以外的场合） */
    public addGold(amount: number): void {
        this._gold += amount;
    }

    // ==================== 内部逻辑 ====================

    private getSpawnInterval(): number {
        // 前期出兵快，后期随时代变慢（因为造更贵的兵）
        const base = AI_CONFIG.SPAWN_INTERVAL_MIN +
            Math.random() * (AI_CONFIG.SPAWN_INTERVAL_MAX - AI_CONFIG.SPAWN_INTERVAL_MIN);
        return base;
    }
    /** 产兵 */
    private trySpawnUnit(): void {
        const available = getAvailableUnits(this._currentAge);
        // 保留 50 金币余额，只考虑买得起的兵
        const affordable = available.filter(u => this._gold >= u.cost + 50);
        if (affordable.length === 0) return;

        // 60% 概率造最贵的兵，40% 概率随机
        let chosen: UnitConfig;
        if (Math.random() < 0.6) {
            chosen = affordable.reduce((a, b) => a.cost > b.cost ? a : b);
        } else {
            chosen = affordable[Math.floor(Math.random() * affordable.length)];
        }

        // 生产
        this._gold -= chosen.cost;
        this._spawnFn(chosen.id, 'enemy');
    }

    /**
     * AI 买经验逻辑
     * 在保证安全余额的前提下，用多余金币加速进化
     */
    private tryBuyExp(): void {
        const next = getNextAgeConfig(this._currentAge);
        if (!next) return; // 已满级

        const expNeeded = next.expRequired - this._exp;
        if (expNeeded <= 0) return; // 经验已经够了

        // 每个时代至少等 30 秒才开始买经验，让 AI 先建基础部队
        const minBuyTime = (this._currentAge + 1) * 30;
        if (this._gameTime < minBuyTime) return;

        // 城堡血量低于 50% 时不买经验 → 被压制了，优先出兵防御
        if (this._castle.getHP() < this._castle.getMaxHP() * 0.5) return;

        // 计算安全余额：至少保留 goldReserve 或 100 金
        const reserve = Math.max(next.goldReserve, 100);
        const excessGold = this._gold - reserve;
        if (excessGold < BUY_EXP.COST) return; // 多余金币不够买一次

        // 计算需要买几次 + 能买几次
        const buysNeeded = Math.ceil(expNeeded / BUY_EXP.GAIN);
        const maxBuys = Math.floor(excessGold / BUY_EXP.COST);
        const actualBuys = Math.min(maxBuys, buysNeeded);
        if (actualBuys <= 0) return;

        this._gold -= actualBuys * BUY_EXP.COST;
        this._exp += actualBuys * BUY_EXP.GAIN;
    }

    /** AI 进化（同时检查经验和金币门槛） */
    private tryEvolve(): void {
        const next = getNextAgeConfig(this._currentAge);
        if (!next) return; // 已满级

        // 延迟：每个时代至少 20 秒后才考虑进化
        const minTime = (this._currentAge + 1) * 20;
        if (this._gameTime < minTime) return;

        // 检查经验和金币（AI 进化需要保留一定余额用于后续出兵）
        if (this._exp >= next.expRequired && this._gold >= next.goldRequired + next.goldReserve) {
            // 进化！
            this._gold -= next.goldRequired;
            this._gold += 200; // 进化奖励
            this._currentAge = next.age;
            // 通知外部进化事件
            this._onEvolve?.(this._currentAge);
        }
    }
}

/** 根据 AI 当前时代返回收入倍率 */
export function getAIIncomeMultiplier(age: Age): number {
    switch (age) {
        case Age.PRIMITIVE: return 1.0;
        case Age.MEDIEVAL:   return 1.2;
        case Age.FUTURE:     return 1.4;
        default:             return 1.0;
    }
}
