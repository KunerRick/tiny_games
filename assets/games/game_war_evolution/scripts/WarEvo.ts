import {
    _decorator, Component, Node, Button, Prefab, instantiate, UITransform,
    Graphics, UIOpacity, tween, isValid, Vec3,
} from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager } from '../../../common/managers/StorageManager';
import { applySceneClearColor } from '../../../common/ui/GameUIKit';
import {
    Age, AIDifficulty, AIDifficultyConfig, AI_DIFFICULTY, AI_DIFFICULTY_NAMES,
    AGE_NAMES, BATTLEFIELD, BUY_EXP, CASTLE_CONFIG, CHARGE, EVOLVE_BONUS_GOLD,
    GOLD_INCOME, KILL_REWARD, WORLD,
    getAgeConfig, getBuyExpCost, getNextAgeConfig, getUnitConfig,
} from './GameConfig';
import { Unit } from './Unit';
import { Castle } from './Castle';
import { colorFromHex } from './UnitArt';
import { AI } from './AI';
import { UIController, HudState } from './UIController';
import { Battlefield } from './Battlefield';

// 存储键名
const GAME_ID = 'war_evo';
const STORAGE_KEYS = {
    MAX_KILLS: 'max_kills',
    BEST_TIME: 'best_time',
    DIFFICULTY: 'difficulty',
};

// Re-export for scene binding
export { Unit } from './Unit';
export { Castle } from './Castle';
export { UIController } from './UIController';
export { Battlefield } from './Battlefield';

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
    private _playerBuyExpCount: number = 0;   // 本时代已购买经验次数（G1）

    private _ai: AI | null = null;
    private _difficulty: AIDifficulty = AIDifficulty.NORMAL;
    private _battlefield: Battlefield | null = null;
    private _backNode: Node | null = null;

    // 冲锋（G2）
    private _chargeCd: number = 0;
    private _chargeTime: number = 0;

    // 城堡炮塔开火冷却（设计文档「城堡自动防御」，此前只有配置没有实现）
    private _castleFireCdPlayer: number = 0;
    private _castleFireCdEnemy: number = 0;

    // 结算统计（G5 失败归因）
    private _spawnedCount: number = 0;
    private _unitsLost: number = 0;
    private _goldSpent: number = 0;

    // ======== 生命周期 ========

    onLoad() {
        applySceneClearColor();
        StorageManager.instance.addRecentGame('war_evo');

        this._backNode = this.backButton?.node ?? null;
        this._backNode?.on(Node.EventType.TOUCH_END, this.onLobby, this);

        // 难度持久化
        const saved = StorageManager.instance.getItem(GAME_ID, STORAGE_KEYS.DIFFICULTY);
        this._difficulty = saved === AIDifficulty.HARD ? AIDifficulty.HARD : AIDifficulty.NORMAL;

        this.prepareScene();
        this.initGame();
    }

    onDestroy() {
        // 红线 4：只清 JS 引用，不访问 @property(Node)。
        // 缓存的返回按钮可能在场景卸载时已被引擎先行销毁 —— 此时 Node.off 内部的
        // _eventProcessor 已是 null，会抛 `Cannot read properties of null (reading 'off')`，
        // 且每帧重复刷屏（实测返回大厅时 1200+ 条）。严格模式 isValid 会把"正在销毁"也算无效。
        if (isValid(this._backNode, true)) {
            this._backNode!.off(Node.EventType.TOUCH_END, this.onLobby, this);
        }
        this._backNode = null;
        this._units = [];
        this._ai = null;
        this._battlefield = null;
    }

    /** 场景准备：隐藏旧战场底图、放大城堡、建战场底色、补 UITransform */
    private prepareScene(): void {
        const battleArea = this.unitContainer?.parent ?? null;
        if (battleArea) {
            // 旧的只覆盖中部的底图换成整块战场
            const bg = battleArea.getChildByName('bgGround');
            if (bg) bg.active = false;
            const path = battleArea.getChildByName('pathLine');
            if (path) path.active = false;

            if (!this._battlefield) {
                this._battlefield = Battlefield.create(battleArea);
            }
        }

        // 单位容器需要 UITransform 才能承载飘字/特效
        if (this.unitContainer) {
            if (!this.unitContainer.getComponent(UITransform)) {
                const ut = this.unitContainer.addComponent(UITransform);
                ut.setContentSize(720, 1280);
                ut.setAnchorPoint(0.5, 0.5);
            }
            // 清掉场景里遗留的示例单位（不参与逻辑，却会挡视线）
            for (let i = this.unitContainer.children.length - 1; i >= 0; i--) {
                const child = this.unitContainer.children[i];
                if (child && child.isValid) child.destroy();
            }
        }

        // 城堡放大并居中到战线
        this.castlePlayer?.node.setScale(1.45, 1.45, 1);
        this.castleEnemy?.node.setScale(1.45, 1.45, 1);
        this.castlePlayer?.node.setPosition(WORLD.PLAYER_X, WORLD.BATTLE_Y, 0);
        this.castleEnemy?.node.setPosition(WORLD.ENEMY_X, WORLD.BATTLE_Y, 0);
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
        this._playerBuyExpCount = 0;
        this._chargeCd = 0;
        this._chargeTime = 0;
        this._castleFireCdPlayer = 0;
        this._castleFireCdEnemy = 0;
        this._spawnedCount = 0;
        this._unitsLost = 0;
        this._goldSpent = 0;

        this.uiController?.resetAll();

        this.castlePlayer?.init(CASTLE_CONFIG.HP, 'player');
        this.castleEnemy?.init(CASTLE_CONFIG.HP, 'enemy');

        if (!this.castleEnemy) {
            console.error('[WarEvo] castleEnemy 未绑定，请检查场景');
            return;
        }

        const cfg = this.getAIConfig();
        this._ai = new AI(
            (configId: string, side: 'enemy') => this.spawnUnit(configId, side),
            this.castleEnemy,
            (age: Age) => this.onEnemyEvolve(age),
            this._difficulty,
        );
        void cfg;

        this.setupUI();
        // 初始时代也要填充产兵按钮（否则原始时代两个按钮是空白）
        this.uiController?.setupUnitButtons(this._playerAge);
        this._battlefield?.setAge(Age.PRIMITIVE);
        this.updateUI();
    }

    private getAIConfig(): AIDifficultyConfig {
        return AI_DIFFICULTY[this._difficulty] ?? AI_DIFFICULTY[AIDifficulty.NORMAL];
    }

    private setupUI(): void {
        this.uiController?.setCallbacks(
            (placeholder: string) => {
                const idx = placeholder === '__btn1__' ? 1 : 0;
                const cfg = this.uiController?.getUnitConfigByIndex(idx);
                if (cfg) this.playerSpawnUnit(cfg.id);
            },
            () => this.playerEvolveOrBuyExp(),
            () => this.onRestart(),
            () => this.onLobby(),
            () => this.onCharge(),
            () => this.onToggleDifficulty(),
        );
        this.uiController?.setupUnitButtons(this._playerAge);
    }

    // ======== 主循环 ========

    update(dt: number) {
        if (this._gameOver) return;

        this._gameTime += dt;

        // 1. 金币自动增长（AI 按难度倍率）
        this._goldTimer += dt;
        while (this._goldTimer >= 1.0) {
            this._goldTimer -= 1.0;
            this._playerGold += GOLD_INCOME.PLAYER;
            if (this._ai) {
                this._ai.addGold(Math.round(GOLD_INCOME.AI * this._ai.getIncomeMultiplier()));
            }
        }

        // 2. 冲锋计时（G2）
        this.tickCharge(dt);

        // 3. AI 决策
        this._ai?.tick(dt);

        // 4. 更新所有单位
        for (const unit of this._units) {
            unit.tick(dt, this._units, WORLD.PLAYER_X, WORLD.ENEMY_X);

            if (unit.consumeCastleAttack()) {
                const targetCastle = unit.getSide() === 'player'
                    ? this.castleEnemy
                    : this.castlePlayer;
                if (targetCastle && !targetCastle.isDead()) {
                    targetCastle.takeDamage(unit.getConfig().attack);
                }
            }
        }

        // 4.5 城堡自动防御（设计文档「城堡自动防御」）
        this.tickCastleDefense(dt);

        // 5. 处理死亡单位
        this.processDeadUnits();

        // 6. 胜负判定
        this.checkGameOver();

        // 7. 更新 UI
        this.updateUI();
    }

    // ======== 冲锋 ========

    private tickCharge(dt: number): void {
        if (this._chargeCd > 0) this._chargeCd = Math.max(0, this._chargeCd - dt);
        if (this._chargeTime > 0) {
            this._chargeTime = Math.max(0, this._chargeTime - dt);
            if (this._chargeTime === 0) {
                for (const u of this._units) u.setChargeBuff(false);
            }
        }
    }

    private onCharge(): void {
        if (this._gameOver) return;
        if (this._chargeCd > 0 || this._chargeTime > 0) return;

        this._chargeTime = CHARGE.DURATION;
        this._chargeCd = CHARGE.COOLDOWN;
        for (const u of this._units) u.setChargeBuff(true);
        this.uiController?.showChargeBanner();
    }

    // ======== 城堡自动防御 ========

    /**
     * 城堡炮塔：按 ATTACK_SPEED 对射程内最近的来袭单位开火。
     * 没有这层防御时「野战输掉 = 直接输」，单局被压到 1 分钟以内；
     * 有了它，防守方可以靠城堡顶住一波、再用攒下的金币反打。
     */
    private tickCastleDefense(dt: number): void {
        if (CASTLE_CONFIG.ATTACK <= 0 || CASTLE_CONFIG.ATTACK_RANGE <= 0) return;

        this._castleFireCdPlayer -= dt;
        this._castleFireCdEnemy -= dt;

        if (this._castleFireCdPlayer <= 0) {
            const target = this.findCastleTarget('player');
            if (target) {
                target.takeDamage(CASTLE_CONFIG.ATTACK, null);
                this.spawnCastleShot(WORLD.PLAYER_X, target.getX(), target.getRenderY());
                this._castleFireCdPlayer = 1 / Math.max(0.1, CASTLE_CONFIG.ATTACK_SPEED);
            }
        }
        if (this._castleFireCdEnemy <= 0) {
            const target = this.findCastleTarget('enemy');
            if (target) {
                target.takeDamage(CASTLE_CONFIG.ATTACK, null);
                this.spawnCastleShot(WORLD.ENEMY_X, target.getX(), target.getRenderY());
                this._castleFireCdEnemy = 1 / Math.max(0.1, CASTLE_CONFIG.ATTACK_SPEED);
            }
        }
    }

    /** 找本方城堡射程内最近的来袭单位 */
    private findCastleTarget(side: 'player' | 'enemy'): Unit | null {
        const castleX = side === 'player' ? WORLD.PLAYER_X : WORLD.ENEMY_X;
        let best: Unit | null = null;
        let bestDist = CASTLE_CONFIG.ATTACK_RANGE;
        for (const u of this._units) {
            if (u.getSide() === side || u.isDying()) continue;
            const d = Math.abs(u.getX() - castleX);
            if (d <= bestDist) {
                bestDist = d;
                best = u;
            }
        }
        return best;
    }

    /** 炮塔弹道：一颗带光晕的炮弹从城堡飞向目标，落点炸出亮点 */
    private spawnCastleShot(fromX: number, toX: number, toY: number): void {
        const container = this.unitContainer;
        if (!container?.isValid) return;

        const fromY = WORLD.BATTLE_Y + 46;
        const node = new Node('castleShot');
        container.addChild(node);
        node.addComponent(UITransform).setContentSize(28, 28);
        node.setPosition(fromX, fromY, 0);
        const g = node.addComponent(Graphics);
        g.fillColor = colorFromHex('#F59E0B', 120);
        g.circle(0, 0, 8);
        g.fill();
        g.fillColor = colorFromHex('#FDE68A', 245);
        g.circle(0, 0, 4.4);
        g.fill();
        g.fillColor = colorFromHex('#FFFFFF', 250);
        g.circle(-1.2, 1.2, 2);
        g.fill();

        const dist = Math.hypot(toX - fromX, toY - fromY);
        const dur = Math.max(0.1, Math.min(0.3, dist / 900));

        tween(node)
            .to(dur, { position: new Vec3(toX, toY, 0) }, { easing: 'quadIn' })
            .call(() => {
                if (!node.isValid) return;
                node.destroy();
                if (!container.isValid) return;
                const hit = new Node('castleHit');
                container.addChild(hit);
                hit.addComponent(UITransform).setContentSize(40, 40);
                hit.setPosition(toX, toY, 0);
                const hg = hit.addComponent(Graphics);
                hg.fillColor = colorFromHex('#FDE68A', 220);
                hg.circle(0, 0, 7);
                hg.fill();
                const hop = hit.addComponent(UIOpacity);
                tween(hit).to(0.2, { scale: new Vec3(2.2, 2.2, 1) }, { easing: 'quadOut' })
                    .call(() => { if (hit.isValid) hit.destroy(); })
                    .start();
                tween(hop).to(0.2, { opacity: 0 }).start();
            })
            .start();
    }

    // ======== 单位生产 ========

    private playerSpawnUnit(configId: string): void {
        if (this._gameOver) return;
        const cfg = getUnitConfig(configId);
        if (!cfg) return;
        if (this._playerGold < cfg.cost) return;
        if (cfg.age > this._playerAge) return;

        this._playerGold -= cfg.cost;
        this._goldSpent += cfg.cost;
        this.spawnUnit(configId, 'player');
    }

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
        if (this._chargeTime > 0) unit.setChargeBuff(true);

        this._units.push(unit);
        if (side === 'player') this._spawnedCount++;
        return unit;
    }

    // ======== 死亡处理 ========

    private processDeadUnits(): void {
        const toRemove: Unit[] = [];
        for (const unit of this._units) {
            if (!unit.isDead()) continue;

            const killer = unit.getLastAttacker();
            if (killer && killer instanceof Unit) {
                const cost = unit.getConfig().cost;
                const goldReward = Math.floor(cost * KILL_REWARD.GOLD_RATIO);
                const expReward = Math.floor(cost * KILL_REWARD.EXP_RATIO);
                if (killer.getSide() === 'player') {
                    this._playerGold += goldReward;
                    this._playerExp += expReward;
                    this._playerKills++;
                } else {
                    this._ai?.addKillReward(goldReward, expReward);
                }
            }

            if (unit.getSide() === 'player') this._unitsLost++;
            toRemove.push(unit);
        }

        // 先清 _target 引用，再销毁节点（避免后续帧访问已销毁节点）
        for (const dead of toRemove) {
            for (const alive of this._units) {
                if (alive !== dead) alive.clearTargetIf(dead);
            }
        }

        for (const u of toRemove) {
            const idx = this._units.indexOf(u);
            if (idx >= 0) this._units.splice(idx, 1);
            u.node.destroy();
        }
    }

    // ======== 进化 ========

    /** 点击进化按钮：满足双门槛就进化，否则买经验（价格递增） */
    private playerEvolveOrBuyExp(): void {
        if (this._gameOver) return;
        const next = getNextAgeConfig(this._playerAge);
        if (!next) return;

        const canEvolve = this._playerExp >= next.expRequired && this._playerGold >= next.goldRequired;
        if (canEvolve) {
            this.playerEvolve();
            return;
        }

        // 经验够了但金币不够 → 提示，不误买经验
        if (this._playerExp >= next.expRequired) {
            this.uiController?.showToast(`进化需要 ${next.goldRequired} 金币（当前 ${Math.floor(this._playerGold)}）`);
            return;
        }

        if (this._playerBuyExpCount >= BUY_EXP.MAX_PER_AGE) {
            this.uiController?.showToast('本时代买经验次数已用完，靠击杀积累经验');
            return;
        }

        const cost = getBuyExpCost(this._playerBuyExpCount);
        if (this._playerGold < cost) {
            this.uiController?.showToast(`购买经验需要 ${cost} 金币`);
            return;
        }

        this._playerGold -= cost;
        this._goldSpent += cost;
        this._playerExp += BUY_EXP.GAIN;
        this._playerBuyExpCount++;
    }

    /** 执行进化（G6：经验 + 金币双门槛真正生效） */
    private playerEvolve(): void {
        const next = getNextAgeConfig(this._playerAge);
        if (!next) return;
        if (this._playerExp < next.expRequired || this._playerGold < next.goldRequired) return;

        this._playerGold -= next.goldRequired;
        this._playerGold += EVOLVE_BONUS_GOLD;
        this._playerAge = next.age;
        this._playerBuyExpCount = 0;

        this._battlefield?.setAge(this._playerAge);
        this.uiController?.setupUnitButtons(this._playerAge);
        this.uiController?.showEvolveBanner(this._playerAge, true);

        // 玩家领先后开启 AI 追赶窗口（G4）
        this._ai?.notifyPlayerEvolved(this._playerAge);
    }

    private onEnemyEvolve(age: Age): void {
        this.uiController?.showEnemyEvolveNotice(age);
    }

    // ======== 难度 ========

    private onToggleDifficulty(): void {
        if (this._gameOver) return;
        this._difficulty = this._difficulty === AIDifficulty.NORMAL
            ? AIDifficulty.HARD
            : AIDifficulty.NORMAL;
        StorageManager.instance.setItem(GAME_ID, STORAGE_KEYS.DIFFICULTY, this._difficulty);
        this.uiController?.showToast(
            `已切换到${AI_DIFFICULTY_NAMES[this._difficulty]}难度，重新开局生效`,
        );
    }

    // ======== 胜负判定 ========

    private checkGameOver(): void {
        const playerDead = this.castlePlayer?.isDead() ?? false;
        const enemyDead = this.castleEnemy?.isDead() ?? false;

        if (playerDead && enemyDead) {
            this._gameOver = true;
            this.showResult('draw');
        } else if (playerDead) {
            this._gameOver = true;
            this.showResult('lose');
        } else if (enemyDead) {
            this._gameOver = true;
            this.showResult('win');
        }
    }

    private getMaxKillsRecord(): number {
        const stored = StorageManager.instance.getItem(GAME_ID, STORAGE_KEYS.MAX_KILLS);
        return stored ? parseInt(stored, 10) : 0;
    }

    private getBestTimeRecord(): number {
        const stored = StorageManager.instance.getItem(GAME_ID, STORAGE_KEYS.BEST_TIME);
        return stored ? parseInt(stored, 10) : Infinity;
    }

    /** 失败归因（G5）：给一句可执行的建议，而不是只显示"失败" */
    private buildLoseDiagnosis(): { reason: string; advice: string } {
        const enemyAge = this._ai?.getCurrentAge() ?? Age.PRIMITIVE;
        if (enemyAge > this._playerAge) {
            return {
                reason: `对方已进入${AGE_NAMES[enemyAge]}，你的兵种整体落后一个时代`,
                advice: '先攒够进化所需金币，科技领先比多造几个低级兵更值',
            };
        }
        if (this._unitsLost > Math.max(6, this._spawnedCount * 0.8)) {
            return {
                reason: '部队消耗过快，防线被打穿',
                advice: '前排先出肉盾兵，远程兵留在后排；敌方推进时用「全军冲锋」反打',
            };
        }
        if (this._playerGold >= 250) {
            return {
                reason: '金币囤积没能转化成兵力',
                advice: '金币不产兵就是浪费，保持每 2–3 秒补一个兵的节奏',
            };
        }
        return {
            reason: '城堡被持续强攻，缺乏反推能力',
            advice: '在己方城堡前拦截，别让敌方远程兵站定输出',
        };
    }

    private showResult(result: 'win' | 'lose' | 'draw'): void {
        const maxKills = this.getMaxKillsRecord();
        const bestTime = this.getBestTimeRecord();

        let newMaxKills = maxKills;
        let newBestTime = bestTime;
        let isNewKillRecord = false;
        let isNewTimeRecord = false;

        if (this._playerKills > maxKills) {
            newMaxKills = this._playerKills;
            StorageManager.instance.setItem(GAME_ID, STORAGE_KEYS.MAX_KILLS, newMaxKills.toString());
            isNewKillRecord = true;
        }

        if (result === 'win' && this._gameTime < bestTime) {
            newBestTime = this._gameTime;
            StorageManager.instance.setItem(GAME_ID, STORAGE_KEYS.BEST_TIME, Math.floor(newBestTime).toString());
            isNewTimeRecord = true;
        }

        const diagnosis = result === 'lose'
            ? this.buildLoseDiagnosis()
            : { reason: '', advice: '' };

        this.uiController?.showGameOver(
            result,
            this._playerAge,
            this._playerKills,
            this._playerGold,
            this._gameTime,
            newMaxKills,
            newBestTime,
            isNewKillRecord,
            isNewTimeRecord,
            diagnosis.reason,
            diagnosis.advice,
            AI_DIFFICULTY_NAMES[this._difficulty],
        );
    }

    // ======== UI 更新 ========

    private updateUI(): void {
        const next = getNextAgeConfig(this._playerAge);
        const expRequired = next ? next.expRequired : 0;
        const goldRequired = next ? next.goldRequired : 0;
        const canEvolve = !!next && this._playerExp >= next.expRequired && this._playerGold >= next.goldRequired;
        const buyCost = getBuyExpCost(this._playerBuyExpCount);
        const buyLeft = next ? Math.max(0, BUY_EXP.MAX_PER_AGE - this._playerBuyExpCount) : 0;
        const canBuyExp = !!next
            && this._playerExp < next.expRequired
            && buyLeft > 0
            && this._playerGold >= buyCost;

        let evolveTitle = '已满级';
        let evolveSub = '所有时代已解锁';
        if (next) {
            if (canEvolve) {
                evolveTitle = '进化';
                evolveSub = `→ ${AGE_NAMES[next.age]}`;
            } else if (this._playerExp >= next.expRequired) {
                evolveTitle = '进化';
                evolveSub = `金币不足 ${Math.floor(this._playerGold)}/${next.goldRequired}`;
            } else if (buyLeft > 0) {
                evolveTitle = '购买经验';
                // 原来「45g → 25经验 ×6」里的 ×6 会被读成「六倍经验」，
                // 实际是本时代还能买 6 次（第二轮复核 N12）。改成两行白话。
                evolveSub = `花 ${buyCost} 金币\n换 ${BUY_EXP.GAIN} 经验（剩${buyLeft}）`;
            } else {
                evolveTitle = '经验不足';
                evolveSub = `击杀敌人积累（${Math.floor(this._playerExp)}/${next.expRequired}）`;
            }
        }

        let chargeState: HudState['chargeState'] = 'ready';
        let chargeRemain = 0;
        if (this._chargeTime > 0) {
            chargeState = 'active';
            chargeRemain = this._chargeTime;
        } else if (this._chargeCd > 0) {
            chargeState = 'cooldown';
            chargeRemain = this._chargeCd;
        }

        const state: HudState = {
            gold: this._playerGold,
            kills: this._playerKills,
            age: this._playerAge,
            playerHP: this.castlePlayer?.getHP() ?? 0,
            playerMaxHP: this.castlePlayer?.getMaxHP() ?? 1,
            enemyHP: this.castleEnemy?.getHP() ?? 0,
            enemyMaxHP: this.castleEnemy?.getMaxHP() ?? 1,
            exp: this._playerExp,
            expRequired,
            goldRequired,
            canEvolve,
            canBuyExp,
            buyExpCost: buyCost,
            buyExpLeft: buyLeft,
            evolveTitle,
            evolveSub,
            chargeState,
            chargeRemain,
            difficulty: this._difficulty,
        };
        this.uiController?.updateHud(state);
    }

    // ======== 按钮操作 ========

    private onRestart(): void {
        this.uiController?.hideGameOver();
        this.clearAllUnits();
        this.initGame();
    }

    private clearAllUnits(): void {
        for (const u of this._units) {
            if (u.node?.isValid) u.node.destroy();
        }
        this._units = [];
    }

    private onLobby(): void {
        SceneManager.gotoLobby();
    }

    // 保留给未来的调试/验证使用
    public getDebugState(): Record<string, number | string> {
        return {
            gold: Math.floor(this._playerGold),
            exp: Math.floor(this._playerExp),
            age: this._playerAge,
            enemyAge: this._ai?.getCurrentAge() ?? -1,
            units: this._units.length,
            gameTime: Math.floor(this._gameTime),
            chargeCd: Math.round(this._chargeCd),
            chargeTime: Math.round(this._chargeTime),
            killCount: this._playerKills,
            battlefieldTop: BATTLEFIELD.TOP,
        };
    }
}
