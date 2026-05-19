import {
    _decorator, Component, Node, Button, Prefab, instantiate,
} from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager } from '../../../common/managers/StorageManager';
import {
    Age, GOLD_INCOME, WORLD, CASTLE_CONFIG,
    getUnitConfig, getNextAgeConfig,
} from './GameConfig';
import { Unit } from './Unit';
import { Castle } from './Castle';
import { AI, getAIIncomeMultiplier } from './AI';
import { UIController } from './UIController';

// 存储键名
const GAME_ID = 'war_evo';
const STORAGE_KEYS = {
    MAX_KILLS: 'max_kills',
    BEST_TIME: 'best_time',
};

// Re-export for scene binding
export { Unit } from './Unit';
export { Castle } from './Castle';
export { UIController } from './UIController';

const { ccclass, property } = _decorator;

/**
 * 战争进化史 - 主游戏控制器
 * 管理游戏状态、update 循环、单位/城堡/AI/UI 的协调
 */
@ccclass('WarEvo')
export class WarEvo extends Component {
    // ======== 场景绑定 ========
    @property(Castle)
    castlePlayer: Castle | null = null;

    @property(Castle)
    castleEnemy: Castle | null = null;

    @property(Node)
    unitContainer: Node | null = null;

    @property(Prefab)
    unitPrefab: Prefab | null = null;

    @property(UIController)
    uiController: UIController | null = null;

    @property(Button)
    backButton: Button | null = null;

    // ======== 游戏状态 ========
    private _units: Unit[] = [];
    private _playerGold: number = 100;
    private _playerExp: number = 0;
    private _playerAge: Age = Age.PRIMITIVE;
    private _playerKills: number = 0;
    private _gameOver: boolean = false;
    private _nextUnitId: number = 0;
    private _goldTimer: number = 0;
    private _gameTime: number = 0;

    private _ai: AI | null = null;

    // ======== 生命周期 ========

    onLoad() {
        // 记录最近游玩
        StorageManager.instance.addRecentGame('war_evo');

        // 绑定返回按钮
        this.backButton?.node.on(Node.EventType.TOUCH_END, this.onLobby, this);

        this.initGame();
    }

    private initGame(): void {
        this._units = [];
        this._playerGold = 100;
        this._playerExp = 0;
        this._playerAge = Age.PRIMITIVE;
        this._playerKills = 0;
        this._gameOver = false;
        this._nextUnitId = 0;
        this._goldTimer = 0;
        this._gameTime = 0;

        // 初始化城堡
        this.castlePlayer?.init(CASTLE_CONFIG.HP, 'player');
        this.castleEnemy?.init(CASTLE_CONFIG.HP, 'enemy');

        // 初始化 AI
        if (!this.castleEnemy) {
            console.error('[WarEvo] castleEnemy 未绑定，请检查场景');
            return;
        }
        this._ai = new AI(
            (configId: string, side: 'enemy') => this.spawnUnit(configId, side),
            this.castleEnemy,
        );

        // 初始化 UI
        this.setupUI();
        this.updateUI();
    }

    private setupUI(): void {
        this.uiController?.setCallbacks(
            (placeholder: string) => {
                // 根据占位符确定按钮索引
                const idx = placeholder === '__btn1__' ? 1 : 0;
                const cfg = this.uiController?.getUnitConfigByIndex(idx);
                if (cfg) this.playerSpawnUnit(cfg.id);
            },
            () => this.playerEvolve(),
            () => this.onRestart(),
            () => this.onLobby(),
        );
        this.uiController?.setupUnitButtons(this._playerAge);
    }

    // ======== 主循环 ========

    update(dt: number) {
        if (this._gameOver) return;

        this._gameTime += dt;

        // 1. 金币自动增长
        this._goldTimer += dt;
        while (this._goldTimer >= 1.0) {
            this._goldTimer -= 1.0;
            this._playerGold += GOLD_INCOME.PLAYER;
            if (this._ai) {
                const aiAge = this._ai.getCurrentAge();
                const multiplier = getAIIncomeMultiplier(aiAge);
                this._ai.addGold(Math.round(GOLD_INCOME.AI * multiplier));
            }
        }

        // 2. AI 决策
        this._ai?.tick(dt);

        // 3. 更新所有单位
        for (const unit of this._units) {
            unit.tick(dt, this._units, WORLD.PLAYER_X, WORLD.ENEMY_X);

            // 单位攻击城堡检测（由 Unit 内部按攻击冷却触发）
            if (unit.consumeCastleAttack()) {
                const targetCastle = unit.getSide() === 'player'
                    ? this.castleEnemy
                    : this.castlePlayer;
                if (targetCastle && !targetCastle.isDead()) {
                    targetCastle.takeDamage(unit.getConfig().attack);
                }
            }
        }

        // 5. 处理死亡单位
        this.processDeadUnits();

        // 6. 胜负判定
        this.checkGameOver();

        // 7. 更新 UI
        this.updateUI();
    }

    // ======== 单位生产 ========

    /** 玩家产兵 */
    private playerSpawnUnit(configId: string): void {
        const cfg = getUnitConfig(configId);
        if (!cfg) return;
        if (this._playerGold < cfg.cost) return;

        // 检查当前时代是否已解锁
        if (cfg.age > this._playerAge) return;

        this._playerGold -= cfg.cost;
        this.spawnUnit(configId, 'player');
    }

    /** 通用产兵（玩家和 AI 都走这里） */
    private spawnUnit(configId: string, side: 'player' | 'enemy'): Unit | null {
        const cfg = getUnitConfig(configId);
        if (!cfg || !this.unitPrefab || !this.unitContainer) return null;

        const node = instantiate(this.unitPrefab);
        this.unitContainer.addChild(node);

        const startX = side === 'player'
            ? WORLD.PLAYER_X + WORLD.SPAWN_OFFSET
            : WORLD.ENEMY_X - WORLD.SPAWN_OFFSET;

        const unit = node.getComponent(Unit)!;
        unit.init(cfg, side, startX);
        unit.setUnitId(++this._nextUnitId);

        this._units.push(unit);
        return unit;
    }

    // ======== 死亡处理 ========

    private processDeadUnits(): void {
        const toRemove: Unit[] = [];
        for (const unit of this._units) {
            if (!unit.isDead()) continue;

            const killer = unit.getLastAttacker();
            // 只有单位击杀才发放奖励（城堡击杀无奖励）
            if (killer && killer instanceof Unit) {
                const reward = Math.floor(unit.getConfig().cost * 0.25);
                if (reward > 0) {
                    if (killer.getSide() === 'player') {
                        this._playerGold += reward;
                        this._playerExp += reward;
                        this._playerKills++;
                    } else {
                        this._ai?.addKillReward(reward);
                    }
                }
            }

            toRemove.push(unit);
        }

        // 在销毁节点前，先清除所有活体单位对死亡单位的 _target 引用
        // 避免后续帧访问已销毁节点的 position 导致崩溃
        for (const dead of toRemove) {
            for (const alive of this._units) {
                if (alive !== dead) {
                    alive.clearTargetIf(dead);
                }
            }
        }

        for (const u of toRemove) {
            const idx = this._units.indexOf(u);
            if (idx >= 0) this._units.splice(idx, 1);
            u.node.destroy();
        }
    }

    // ======== 进化 ========

    private playerEvolve(): void {
        const next = getNextAgeConfig(this._playerAge);
        if (!next) return; // 已满级

        if (this._playerExp < next.expRequired) return;
        if (this._playerGold < next.goldRequired) return;

        this._playerGold -= next.goldRequired;
        this._playerGold += 200; // 进化奖励
        this._playerAge = next.age;

        // 更新 UI 按钮
        this.uiController?.setupUnitButtons(this._playerAge);
    }

    // ======== 胜负判定 ========

    private checkGameOver(): void {
        if (this.castlePlayer?.isDead()) {
            this._gameOver = true;
            this.showResult(false);
        } else if (this.castleEnemy?.isDead()) {
            this._gameOver = true;
            this.showResult(true);
        }
    }

    /** 获取最高击杀记录 */
    private getMaxKillsRecord(): number {
        const stored = StorageManager.instance.getItem(GAME_ID, STORAGE_KEYS.MAX_KILLS);
        return stored ? parseInt(stored, 10) : 0;
    }

    /** 获取最快通关记录（秒） */
    private getBestTimeRecord(): number {
        const stored = StorageManager.instance.getItem(GAME_ID, STORAGE_KEYS.BEST_TIME);
        return stored ? parseInt(stored, 10) : Infinity;
    }

    private showResult(win: boolean): void {
        const maxKills = this.getMaxKillsRecord();
        const bestTime = this.getBestTimeRecord();

        // 更新记录
        let newMaxKills = maxKills;
        let newBestTime = bestTime;
        let isNewKillRecord = false;
        let isNewTimeRecord = false;

        if (this._playerKills > maxKills) {
            newMaxKills = this._playerKills;
            StorageManager.instance.setItem(GAME_ID, STORAGE_KEYS.MAX_KILLS, newMaxKills.toString());
            isNewKillRecord = true;
        }

        if (win && this._gameTime < bestTime) {
            newBestTime = this._gameTime;
            StorageManager.instance.setItem(GAME_ID, STORAGE_KEYS.BEST_TIME, Math.floor(newBestTime).toString());
            isNewTimeRecord = true;
        }

        this.uiController?.showGameOver(
            win,
            this._playerAge,
            this._playerKills,
            this._playerGold,
            this._gameTime,
            newMaxKills,
            newBestTime,
            isNewKillRecord,
            isNewTimeRecord,
        );
    }

    // ======== UI 更新 ========

    private updateUI(): void {
        const nextAge = getNextAgeConfig(this._playerAge);
        this.uiController?.updateTopBar(
            this._playerGold,
            this._playerAge,
            this._playerExp,
            nextAge?.expRequired ?? 0,
            this.castlePlayer?.getHP() ?? 0,
            this.castlePlayer?.getMaxHP() ?? 1,
            this.castleEnemy?.getHP() ?? 0,
            this.castleEnemy?.getMaxHP() ?? 1,
            this._playerKills,
        );

        // 进化按钮是否可用
        if (nextAge) {
            const canEvolve = this._playerExp >= nextAge.expRequired
                && this._playerGold >= nextAge.goldRequired;
            this.uiController?.setEvolveButtonEnabled(canEvolve);
        } else {
            this.uiController?.setEvolveButtonEnabled(false);
        }
    }

    // ======== 按钮操作 ========

    private onRestart(): void {
        this.uiController?.hideGameOver();
        this.clearAllUnits();
        this.initGame();
    }

    /** 清除所有单位节点 */
    private clearAllUnits(): void {
        for (const u of this._units) {
            if (u.node?.isValid) {
                u.node.destroy();
            }
        }
        this._units = [];
    }

    private onLobby(): void {
        SceneManager.gotoLobby();
    }
}
