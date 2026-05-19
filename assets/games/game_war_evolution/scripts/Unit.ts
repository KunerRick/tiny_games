import { _decorator, Component, Sprite, Color, Label, UITransform } from 'cc';
import { UnitConfig, UnitState, WORLD } from './GameConfig';

const { ccclass, property } = _decorator;

/**
 * 单位组件
 * 每个单位实例维护自己的移动、战斗、排队、技能逻辑
 *
 * 注意：不使用 Cocos 内置 update(dt)，由 WarEvo 统一驱动 tick()
 */
@ccclass('Unit')
export class Unit extends Component {
    // ---- 场景/预制体绑定 ----
    @property(Sprite)
    body: Sprite | null = null;             // 单位身体色块（预制体 -> body）

    @property(Sprite)
    hpBarFill: Sprite | null = null;       // 血条填充（预制体 -> hpBarFill）

    @property(Sprite)
    hpBarBg: Sprite | null = null;         // 血条背景（预制体 -> hpBarBg）

    @property(Label)
    nameLabel: Label | null = null;

    // ---- 运行时状态 ----
    private _unitId: number = 0;
    private _config: UnitConfig | null = null;
    private _side: 'player' | 'enemy' = 'player';
    private _hp: number = 0;
    private _maxHp: number = 0;
    private _state: UnitState = UnitState.MOVING;
    private _attackCooldown: number = 0;
    private _target: Unit | null = null;
    private _lastAttacker: Unit | null = null;

    // 技能状态
    private _shieldHp: number = 0;          // 机甲护盾
    private _stompTimer: number = 0;         // 猛犸践踏计时
    private _laserFocus: number = 1.0;       // 激光聚焦倍率
    private _laserTargetId: number = 0;      // 当前聚焦目标 ID（切换目标时重置聚焦）
    private _chargeUsed: boolean = false;    // 冲锋是否已用

    // ==================== 初始化 ====================

    /** 由 WarEvo 在实例化后调用 */
    public init(config: UnitConfig, side: 'player' | 'enemy', startX: number): void {
        this._config = config;
        this._side = side;
        this._hp = config.hp;
        this._maxHp = config.hp;
        this._state = UnitState.MOVING;
        this._attackCooldown = 0;
        this._target = null;
        this._lastAttacker = null;
        this._chargeUsed = false;
        this._laserFocus = 1.0;
        this._laserTargetId = 0;
        this._stompTimer = 0;

        this._attackingCastle = false;

        // 护盾
        if (config.hasShield) {
            this._shieldHp = Math.floor(config.hp * 0.5);
        } else {
            this._shieldHp = 0;
        }

        // 位置
        this.node.setPosition(startX, WORLD.BATTLE_Y, 0);

        // 外观：蓝色玩家 / 红色敌人
        if (this.body) {
            this.body.color = side === 'player'
                ? new Color(68, 136, 255)   // 蓝
                : new Color(255, 68, 68);   // 红
        }

        // 名字
        if (this.nameLabel) {
            this.nameLabel.string = config.name;
        }

        this.updateHPBar();
    }

    public setUnitId(id: number): void { this._unitId = id; }
    public getUnitId(): number { return this._unitId; }
    public getConfig(): UnitConfig { return this._config!; }
    public getSide(): 'player' | 'enemy' { return this._side; }
    public getHP(): number { return this._hp; }
    public getMaxHP(): number { return this._maxHp; }
    public getX(): number {
        // 防御性检查：node 可能已被销毁，避免 "Cannot read properties of undefined"
        if (!this.node) return 0;
        return this.node.position.x;
    }
    public getState(): UnitState { return this._state; }
    public getLastAttacker(): Unit | null { return this._lastAttacker; }

    /** 用于 WarEvo 在 processDeadUnits 中清除活体单位对死亡单位的 _target 引用 */
    public clearTargetIf(targetUnit: Unit): void {
        if (this._target === targetUnit) {
            this._target = null;
        }
    }

    // ==================== 主 Tick（由 WarEvo 每帧调用） ====================

    public tick(dt: number, allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
        if (this._state === UnitState.DEAD) return;
        if (!this._config) return;

        switch (this._state) {
            case UnitState.MOVING:
                this.updateMovement(dt, enemyCastleX);
                this.tryEngage(allUnits, playerCastleX, enemyCastleX);
                break;

            case UnitState.FIGHTING:
                this.updateFighting(dt, allUnits, playerCastleX, enemyCastleX);
                break;

            case UnitState.QUEUING:
                this.updateQueueing(dt, allUnits);
                // 排队中也检查是否可以顶上
                this.tryStepUp(allUnits, playerCastleX, enemyCastleX);
                break;
        }

        // 技能冷却
        this.updateSkills(dt, allUnits);
        this.updateHPBar();
    }

    // ==================== 移动 ====================

    private updateMovement(dt: number, enemyCastleX: number): void {
        const direction = this._side === 'player' ? 1 : -1;
        const dx = this._config!.moveSpeed * direction * dt;
        let newX = this.node.position.x + dx;

        // 到达敌方城堡边界则停
        if (this._side === 'player' && newX >= enemyCastleX - 20) {
            newX = enemyCastleX - 20;
        } else if (this._side === 'enemy' && newX <= -enemyCastleX + 20) {
            newX = -enemyCastleX + 20;
        }

        this.node.setPosition(newX, WORLD.BATTLE_Y, 0);
    }

    // ==================== 战斗逻辑 ====================

    /**
     * 找到攻击范围内最近的敌方单位
     */
    private findNearestEnemy(allUnits: Unit[]): Unit | null {
        let nearest: Unit | null = null;
        let minDist = this._config!.attackRange;
        const myX = this.getX();
        for (const u of allUnits) {
            if (u.getSide() === this._side || u.isDead()) continue;
            const dist = Math.abs(u.getX() - myX);
            if (dist <= minDist) {
                minDist = dist;
                nearest = u;
            }
        }
        return nearest;
    }

    /**
     * 尝试进入战斗：检查是否有敌方单位在攻击范围内
     */
    private tryEngage(allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
        const enemy = this.findNearestEnemy(allUnits);
        if (enemy) {
            // 检查前方是否有己方单位已在战斗（排队机制）
            if (this.hasFightingAllyAhead(allUnits)) {
                this._state = UnitState.QUEUING;
            } else {
                this._state = UnitState.FIGHTING;
                this._target = enemy;
                this._attackCooldown = 0; // 立即攻击
            }
            return;
        }

        // 无敌方单位 → 攻击城堡（需要距离判断）
        const castleX = this._side === 'player' ? enemyCastleX : playerCastleX;
        const distToCastle = Math.abs(this.getX() - castleX);
        if (distToCastle <= this._config!.attackRange + 30) {
            if (!this.hasFightingAllyAhead(allUnits)) {
                this._state = UnitState.FIGHTING;
                this._target = null; // null target signals castle attack
            }
            return;
        }

        // 既无敌人在范围，也不在城堡攻击距离内
        // 如果是 FIGHTING 状态（从 updateFighting 清空 target 后进入）：
        //   - 有队友在前方战斗 → QUEUING 排队
        //   - 没有队友在前方 → MOVING 继续前进
        // 防止卡在 FIGHTING + null target 状态导致下一帧无距离限制攻击城堡
        if (this._state === UnitState.FIGHTING) {
            if (this.hasFightingAllyAhead(allUnits)) {
                this._state = UnitState.QUEUING;
            } else {
                this._state = UnitState.MOVING;
            }
        }
    }

    /**
     * 战斗中更新
     */
    private updateFighting(dt: number, allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
        // 如果目标是单位
        if (this._target) {
            if (this._target.getState() === UnitState.DEAD) {
                this._target = null;
                this.tryEngage(allUnits, playerCastleX, enemyCastleX);
                return;
            }
            const dist = Math.abs(this._target.getX() - this.getX());
            if (dist > this._config!.attackRange * 1.2) {
                this._target = null;
                this._state = UnitState.MOVING;
                this.tryEngage(allUnits, playerCastleX, enemyCastleX);
                return;
            }
            // 执行攻击
            this.tryAttack(dt, this._target, allUnits);

            // 攻击后检查目标是否死亡（包括被践踏等后续伤害击杀的情况）
            // 立即清除 _target 引用，避免后续帧访问已销毁节点的 position
            if (this._target && this._target.isDead()) {
                this._target = null;
                this.tryEngage(allUnits, playerCastleX, enemyCastleX);
                return;
            }
        } else {
            // 攻击城堡（仅在距离足够时）
            const castleX = this._side === 'player' ? enemyCastleX : playerCastleX;
            const distToCastle = Math.abs(this.getX() - castleX);
            if (distToCastle <= this._config!.attackRange + 30) {
                this.tryAttackCastle(dt, playerCastleX, enemyCastleX);
            } else {
                // 离城堡太远且没有敌人 → 退回 MOVING 继续前进
                this._state = UnitState.MOVING;
                return;
            }

            // 检查是否有敌人靠近，有则切换目标（避免无视敌人一直打城堡）
            const nearbyEnemy = this.findNearestEnemy(allUnits);
            if (nearbyEnemy) {
                this._target = nearbyEnemy;
            }
        }
    }

    /**
     * 执行单位攻击
     */
    private tryAttack(dt: number, target: Unit, allUnits: Unit[]): void {
        this._attackCooldown -= dt;
        if (this._attackCooldown > 0) return;

        const cfg = this._config!;
        let damage = cfg.attack;

        // 骑士冲锋：首次攻击 2 倍
        if (cfg.hasCharge && !this._chargeUsed) {
            damage *= 2;
            this._chargeUsed = true;
        }

        // 激光聚焦：持续攻击同一目标伤害递增，切换目标重置
        if (cfg.hasLaserFocus) {
            if (target.getUnitId() !== this._laserTargetId) {
                this._laserFocus = 1.0;
                this._laserTargetId = target.getUnitId();
            }
            this._laserFocus = Math.min(this._laserFocus + 0.15, 2.0);
            damage = Math.round(damage * this._laserFocus);
        }

        target.takeDamage(damage, this);
        this._attackCooldown = 1.0 / cfg.attackSpeed;

        // 注：不在这里清除 _target——由 updateFighting 中的 post-attack 检查统一处理，
        //     以立即触发 tryEngage 重新索敌，避免延迟一帧。
        // 注2：但 processDeadUnits 会在销毁节点前强制清除所有活体的 _target 引用，
        //     防止跨帧访问已销毁节点。

        // 猛犸践踏（随攻击触发）
        if (cfg.hasStomp) {
            this._stompTimer += 1.0 / cfg.attackSpeed;
            if (this._stompTimer >= 8.0) {
                this._stompTimer = 0;
                this.performStomp(allUnits);
            }
        }
    }

    /**
     * 执行城堡攻击
     */
    private tryAttackCastle(dt: number, playerCastleX: number, enemyCastleX: number): void {
        this._attackCooldown -= dt;
        if (this._attackCooldown > 0) return;

        // 二层防御：必须在本方城堡朝向的敌方城堡方向且距离足够
        const castleX = this._side === 'player' ? enemyCastleX : playerCastleX;
        const distToCastle = Math.abs(this.getX() - castleX);
        if (distToCastle > this._config!.attackRange + 30) return;

        this._attackCooldown = 1.0 / this._config!.attackSpeed;
        this._attackingCastle = true;
    }

    private _attackingCastle: boolean = false;

    /** 由 WarEvo 检查并消费 */
    public consumeCastleAttack(): boolean {
        if (this._attackingCastle) {
            this._attackingCastle = false;
            return true;
        }
        return false;
    }

    // ==================== 排队逻辑 ====================

    /**
     * 检查前方是否有己方单位正在战斗（排队依据）
     */
    private hasFightingAllyAhead(allUnits: Unit[]): boolean {
        const myX = this.getX();
        for (const u of allUnits) {
            if (u === this || u.getSide() !== this._side || u.getState() !== UnitState.FIGHTING) continue;
            if (u.isDead()) continue;
            const ux = u.getX();
            if (this._side === 'player' && ux >= myX) return true;
            if (this._side === 'enemy' && ux <= myX) return true;
        }
        return false;
    }

    /**
     * 排队中保持位置
     */
    private updateQueueing(dt: number, allUnits: Unit[]): void {
        // 找到最前方战斗的己方单位
        const front = this.findFrontAlly(allUnits);
        if (!front) {
            // 没有前方战斗单位 → 尝试顶上
            this._state = UnitState.MOVING;
            return;
        }
        // 保持在战斗单位后方 QUEUE_DIST 处
        const direction = this._side === 'player' ? -1 : 1;
        const targetX = front.getX() + direction * WORLD.QUEUE_DIST;
        const currentX = this.getX();
        const diff = targetX - currentX;
        if (Math.abs(diff) > 3) {
            const speed = 300 * dt;
            const newX = currentX + Math.sign(diff) * Math.min(Math.abs(diff), speed);
            this.node.setPosition(newX, WORLD.BATTLE_Y, 0);
        }
    }

    /**
     * 尝试从排队→战斗（前方没人了）
     */
    private tryStepUp(allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
        if (!this.hasFightingAllyAhead(allUnits)) {
            // 前方无敌方单位在战斗 → 检查是否有敌人可打
            this._state = UnitState.MOVING;
            this.tryEngage(allUnits, playerCastleX, enemyCastleX);
        }
    }

    /**
     * 找到前方最近的己方战斗单位
     */
    private findFrontAlly(allUnits: Unit[]): Unit | null {
        let front: Unit | null = null;
        let bestDist = Infinity;
        const myX = this.getX();
        for (const u of allUnits) {
            if (u === this || u.getSide() !== this._side || u.getState() !== UnitState.FIGHTING) continue;
            if (u.isDead()) continue;
            const ux = u.getX();
            const dist = Math.abs(ux - myX);
            // 必须在前方
            const isAhead = this._side === 'player' ? ux > myX : ux < myX;
            if (isAhead && dist < bestDist) {
                bestDist = dist;
                front = u;
            }
        }
        return front;
    }

    // ==================== 受伤害 & 死亡 ====================

    public takeDamage(amount: number, attacker: Unit | null): void {
        if (this._state === UnitState.DEAD) return;
        if (attacker) this._lastAttacker = attacker;

        let remaining = amount;

        // 护盾优先吸收
        if (this._shieldHp > 0) {
            if (remaining <= this._shieldHp) {
                this._shieldHp -= remaining;
                return;
            }
            remaining -= this._shieldHp;
            this._shieldHp = 0;
        }

        this._hp -= remaining;
        if (this._hp <= 0) {
            this._hp = 0;
            this._state = UnitState.DEAD;
        }
    }

    public isDead(): boolean {
        return this._state === UnitState.DEAD;
    }

    // ==================== 技能 ====================

    private updateSkills(_dt: number, allUnits: Unit[]): void {
        // 猛犸践踏（在 tryAttack 中累积计时，在此触发）
        // 逻辑已移到 tryAttack 中
    }

    private performStomp(allUnits: Unit[]): void {
        // 对周围 100px 内所有敌方单位造成 30 范围伤害
        const cx = this.getX();
        for (const u of allUnits) {
            if (u.getSide() === this._side || u.isDead()) continue;
            if (Math.abs(u.getX() - cx) <= 100) {
                u.takeDamage(30, this);
            }
        }
    }

    // ==================== 视觉更新 ====================

    private updateHPBar(): void {
        if (!this.hpBarFill || !this.hpBarBg) return;
        const ratio = Math.max(0, this._hp / this._maxHp);
        const bgTransform = this.hpBarBg.node.getComponent(UITransform);
        if (!bgTransform) return;
        const fillTransform = this.hpBarFill.node.getComponent(UITransform);
        if (fillTransform) {
            fillTransform.width = bgTransform.width * ratio;
        }
    }
}
