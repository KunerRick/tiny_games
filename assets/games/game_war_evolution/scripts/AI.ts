import {
    Age,
    AIDifficulty,
    AI_DIFFICULTY,
    AIDifficultyConfig,
    UnitConfig,
    BUY_EXP,
    EVOLVE_BONUS_GOLD,
    getAvailableUnits,
    getBuyExpCost,
    getNextAgeConfig,
} from './GameConfig';
import { Unit } from './Unit';
import { Castle } from './Castle';

/**
 * AI 对手控制器
 * 非 Cocos 组件，由 WarEvo 创建并驱动
 *
 * 难度（G4）：收入倍率 / 出兵间隔 / 进化延迟；玩家进化后 AI 有追赶窗口，
 * 避免「玩家未来时代、AI 还在原始」的单边碾压。
 */
export class AI {
    private _gold: number = 100;            // AI 金币
    private _exp: number = 0;               // AI 经验
    private _currentAge: Age = Age.PRIMITIVE;
    private _spawnTimer: number = 0;
    private _gameTime: number = 0;
    private _buyExpCount: number = 0;       // 本时代已购买经验次数（G1）
    private _difficulty: AIDifficulty;
    private _config: AIDifficultyConfig;
    private _catchUpAt: number = -1;        // 追赶窗口到期时间点（-1 = 无）

    // 外部引用
    private _spawnFn: (configId: string, side: 'enemy') => Unit | null;
    private _castle: Castle;
    private _onEvolve: ((age: Age) => void) | null = null;

    constructor(
        spawnFn: (configId: string, side: 'enemy') => Unit | null,
        castle: Castle,
        onEvolve?: (age: Age) => void,
        difficulty: AIDifficulty = AIDifficulty.NORMAL,
    ) {
        this._spawnFn = spawnFn;
        this._castle = castle;
        this._onEvolve = onEvolve ?? null;
        this._difficulty = difficulty;
        this._config = AI_DIFFICULTY[difficulty] ?? AI_DIFFICULTY[AIDifficulty.NORMAL];
    }

    public getGold(): number { return this._gold; }
    public getExp(): number { return this._exp; }
    public getCurrentAge(): Age { return this._currentAge; }
    public getDifficulty(): AIDifficulty { return this._difficulty; }
    public getIncomeMultiplier(): number { return this._config.incomeMul; }

    /** 由 WarEvo 每帧调用 */
    public tick(dt: number): void {
        this._gameTime += dt;

        this._spawnTimer -= dt;
        if (this._spawnTimer <= 0) {
            this._spawnTimer = this.getSpawnInterval();
            this.trySpawnUnit();
        }

        this.tryBuyExp();
        this.tryCatchUp();
        this.tryEvolve();
    }

    /** 获得击杀奖励 */
    public addKillReward(goldAmount: number, expAmount: number): void {
        this._gold += goldAmount;
        this._exp += expAmount;
    }

    /** 手动加金币 */
    public addGold(amount: number): void {
        this._gold += amount;
    }

    /**
     * 玩家进化后调用：开启追赶窗口（G4）。
     * 窗口到期时补足经验，困难档还会补齐进化所需的金币。
     */
    public notifyPlayerEvolved(playerAge: Age): void {
        if (playerAge <= this._currentAge) return;
        if (this._catchUpAt > 0) return; // 已有窗口，不重复叠加
        this._catchUpAt = this._gameTime + this._config.catchUpDelay;
    }

    // ==================== 内部逻辑 ====================

    private getSpawnInterval(): number {
        const min = this._config.spawnIntervalMin;
        const max = this._config.spawnIntervalMax;
        return min + Math.random() * (max - min);
    }

    private trySpawnUnit(): void {
        const available = getAvailableUnits(this._currentAge);
        // 与玩家同一经济口径：不留固定储备（旧版留 50，等于把出兵速度砍到 1/4）
        const affordable = available.filter(u => this._gold >= u.cost);
        if (affordable.length === 0) return;

        // 经验够了但金币不够：进入攒钱期，优先把进化打出来
        const next = getNextAgeConfig(this._currentAge);
        if (next && this._exp >= next.expRequired
            && this._gold < next.goldRequired + next.goldReserve
            && this._castle.getHP() > this._castle.getMaxHP() * 0.5) {
            return;
        }

        let chosen: UnitConfig;
        if (Math.random() < 0.6) {
            chosen = affordable.reduce((a, b) => (a.cost < b.cost ? a : b));
        } else {
            chosen = affordable[Math.floor(Math.random() * affordable.length)];
        }

        this._gold -= chosen.cost;
        this._spawnFn(chosen.id, 'enemy');
    }

    /** 买经验：价格递增 + 每时代限购（与玩家同一套规则） */
    private tryBuyExp(): void {
        const next = getNextAgeConfig(this._currentAge);
        if (!next) return;

        const expNeeded = next.expRequired - this._exp;
        if (expNeeded <= 0) return;
        if (this._buyExpCount >= BUY_EXP.MAX_PER_AGE) return;

        // 每个时代至少等一小段时间，让 AI 先建基础部队
        if (this._gameTime < (this._currentAge + 1) * this._config.firstBuyExpDelay) return;

        // 城堡血量低于 50% 时不买经验 → 优先出兵防御
        if (this._castle.getHP() < this._castle.getMaxHP() * 0.5) return;

        const cost = getBuyExpCost(this._buyExpCount);
        // 与玩家侧的经验购买门槛同量级（玩家：余额 ≥ 150 才考虑），否则 AI 永远买不起
        if (this._gold < cost + 60) return;

        this._gold -= cost;
        this._exp += BUY_EXP.GAIN;
        this._buyExpCount++;
    }

    /** 追赶窗口：玩家领先时代时，到期补经验（困难档补金币） */
    private tryCatchUp(): void {
        if (this._catchUpAt <= 0 || this._gameTime < this._catchUpAt) return;
        this._catchUpAt = -1;

        const next = getNextAgeConfig(this._currentAge);
        if (!next) return;

        const missingExp = Math.max(0, next.expRequired - this._exp);
        this._exp += Math.ceil(missingExp * this._config.catchUpExpBonus);

        // 困难档同时补足进化金币缺口，确保追赶真的落地
        if (this._difficulty === AIDifficulty.HARD) {
            const need = next.goldRequired + next.goldReserve;
            if (this._gold < need) this._gold = need;
        }
    }

    /** AI 进化（经验 + 金币双门槛，与玩家一致） */
    private tryEvolve(): void {
        const next = getNextAgeConfig(this._currentAge);
        if (!next) return;

        if (this._gameTime < (this._currentAge + 1) * this._config.evolveDelay) return;

        if (this._exp >= next.expRequired && this._gold >= next.goldRequired + next.goldReserve) {
            this._gold -= next.goldRequired;
            this._gold += EVOLVE_BONUS_GOLD;
            this._currentAge = next.age;
            this._buyExpCount = 0;
            this._onEvolve?.(this._currentAge);
        }
    }
}
