import { _decorator, Component, Sprite, Color, Label, UITransform, tween, Tween, Vec3, Node } from 'cc';
import { UnitConfig, UnitState, WORLD, UNIT_COLORS } from './GameConfig';

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

    // UITransform 缓存，避免每帧重复获取
    private _hpBarBgTransform: UITransform | null = null;
    private _hpBarFillTransform: UITransform | null = null;

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

    // 视觉反馈
    private _flashTween: Tween<Sprite> | null = null;

    // 死亡淡出
    private _fadeTween: Tween<Node> | null = null;
    private _isFading: boolean = false;

    // 攻击抖动
    private _shakeTween: Tween<Node> | null = null;

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

        this._pendingCastleAttack = false;

        // 护盾
        if (config.hasShield) {
            this._shieldHp = Math.floor(config.hp * 0.5);
        } else {
            this._shieldHp = 0;
        }

        // 位置
        this.node.setPosition(startX, WORLD.BATTLE_Y, 0);

        // 缓存 UITransform 引用
        this._hpBarBgTransform = this.hpBarBg?.node.getComponent(UITransform) ?? null;
        this._hpBarFillTransform = this.hpBarFill?.node.getComponent(UITransform) ?? null;

        // 外观：蓝色玩家 / 红色敌人
        if (this.body) {
            const color = side === 'player' ? UNIT_COLORS.PLAYER : UNIT_COLORS.ENEMY;
            this.body.color = new Color(color.r, color.g, color.b);
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
        if (!this.node?.isValid) return 0;
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


        }

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
            // 使用 isDying() 跳过所有死亡中的单位（包括动画期间）
            if (u.getSide() === this._side || u.isDying()) continue;
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
     * 修改后：允许多个单位同时攻击同一目标（打群架效果）
     */
    private tryEngage(allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
        const enemy = this.findNearestEnemy(allUnits);
        if (enemy) {
            // 直接进入战斗状态，不再检查前方是否有队友
            // 近战兵会有轻微的位置错开，远程兵站定射击
            this._state = UnitState.FIGHTING;
            this._target = enemy;
            this._attackCooldown = 0; // 立即攻击

            // 近战单位稍微调整位置避免完全重叠
            if (this._config!.attackRange <= 100) {
                this.adjustMeleePosition(allUnits);
            }
            return;
        }

        // 无敌方单位 → 攻击城堡
        const castleX = this._side === 'player' ? enemyCastleX : playerCastleX;
        const distToCastle = Math.abs(this.getX() - castleX);
        if (distToCastle <= this._config!.attackRange + 30) {
            this._state = UnitState.FIGHTING;
            this._target = null; // null target signals castle attack
            return;
        }

        // 既无敌人在范围，也不在城堡攻击距离内
        if (this._state === UnitState.FIGHTING) {
            this._state = UnitState.MOVING;
        }
    }

    /**
     * 调整近战单位位置 - 让多个近战单位可以围攻同一目标
     */
    private adjustMeleePosition(allUnits: Unit[]): void {
        if (!this._target) return;

        const targetX = this._target.getX();
        const myX = this.getX();
        const direction = this._side === 'player' ? 1 : -1;

        // 计算目标周围已有多少己方单位在攻击
        let alliesAttackingSameTarget = 0;
        let myIndex = 0;
        for (const u of allUnits) {
            // 使用 isDying() 跳过死亡中的单位
            if (u === this || u.getSide() !== this._side || u.isDying()) continue;
            if (u.getState() === UnitState.FIGHTING && u._target === this._target) {
                if (u.getX() < myX) {
                    myIndex++;
                }
                alliesAttackingSameTarget++;
            }
        }

        // 根据序号错开位置（扇形围攻）
        // 第0个正前方，第1个偏左，第2个偏右，以此类推
        const offsetPatterns = [0, -25, 25, -50, 50, -75, 75];
        const offset = offsetPatterns[Math.min(myIndex, offsetPatterns.length - 1)];

        const idealX = targetX - direction * (this._config!.attackRange - 5) + offset;
        const currentX = this.getX();
        const diff = idealX - currentX;

        // 平滑移动到理想位置
        if (Math.abs(diff) > 2) {
            const moveStep = Math.sign(diff) * Math.min(Math.abs(diff), 5);
            this.node.setPosition(currentX + moveStep, WORLD.BATTLE_Y, 0);
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
            const cfg = this._config!;

            // 远程兵种：保持最优攻击距离
            if (cfg.attackRange > 100) {
                // 远程兵逻辑：敌人太靠近时后撤
                if (dist < cfg.attackRange * 0.4) {
                    // 敌人太近了，后撤
                    this.retreat(dt, allUnits);
                    return;
                } else if (dist > cfg.attackRange) {
                    // 敌人太远了，追击
                    this.advance(dt, allUnits);
                    return;
                }
                // 在最佳距离内，站定射击
                this.tryAttack(dt, this._target, allUnits);
            } else {
                // 近战兵逻辑（保持原有）
                if (dist > cfg.attackRange * 1.2) {
                    this._target = null;
                    this._state = UnitState.MOVING;
                    this.tryEngage(allUnits, playerCastleX, enemyCastleX);
                    return;
                }
                this.tryAttack(dt, this._target, allUnits);
            }

            // 攻击后检查目标是否死亡
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

            // 检查是否有敌人靠近，有则切换目标
            const nearbyEnemy = this.findNearestEnemy(allUnits);
            if (nearbyEnemy) {
                this._target = nearbyEnemy;
            }
        }
    }

    /**
     * 远程兵后撤 - 保持与敌人的距离
     */
    private retreat(dt: number, allUnits: Unit[]): void {
        if (!this._target) return;

        const direction = this._side === 'player' ? -1 : 1;
        const retreatSpeed = this._config!.moveSpeed * 0.8; // 后撤速度稍慢
        const dx = retreatSpeed * direction * dt;
        let newX = this.node.position.x + dx;

        // 检查是否会撞到己方单位
        const myX = this.getX();
        let blocked = false;
        for (const u of allUnits) {
            // 使用 isDying() 跳过死亡中的单位
            if (u === this || u.getSide() !== this._side || u.isDying()) continue;
            const ux = u.getX();
            const dist = Math.abs(ux - myX);
            // 如果后方有己方单位且距离太近，不能后退
            if (this._side === 'player' && ux < myX && dist < 30) {
                blocked = true;
                break;
            }
            if (this._side === 'enemy' && ux > myX && dist < 30) {
                blocked = true;
                break;
            }
        }

        if (!blocked) {
            this.node.setPosition(newX, WORLD.BATTLE_Y, 0);
        }
        // 即使被挡住，也可以继续攻击
        if (this._target) {
            this.tryAttack(dt, this._target, allUnits);
        }
    }

    /**
     * 远程兵追击 - 接近敌人到攻击范围
     */
    private advance(dt: number, allUnits: Unit[]): void {
        const direction = this._side === 'player' ? 1 : -1;
        const dx = this._config!.moveSpeed * direction * dt;
        let newX = this.node.position.x + dx;
        this.node.setPosition(newX, WORLD.BATTLE_Y, 0);
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

        // 触发攻击抖动效果
        this.triggerAttackShake();

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
        this._pendingCastleAttack = true;
    }

    private _pendingCastleAttack: boolean = false;

    /** 由 WarEvo 检查并消费 */
    public consumeCastleAttack(): boolean {
        if (this._pendingCastleAttack) {
            this._pendingCastleAttack = false;
            return true;
        }
        return false;
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
                this.triggerHitFlash();
                return;
            }
            remaining -= this._shieldHp;
            this._shieldHp = 0;
        }

        this._hp -= remaining;
        this.triggerHitFlash();
        if (this._hp <= 0) {
            this._hp = 0;
            this._state = UnitState.DEAD;
            this.startFadeOut();
        }
    }

    /** 触发受击闪白效果 */
    private triggerHitFlash(): void {
        if (!this.body || !this.body.isValid) return;

        // 停止之前的 tween
        if (this._flashTween) {
            this._flashTween.stop();
            this._flashTween = null;
        }

        // 使用 tween 实现闪白：变白 -> 恢复原色
        // 注意：使用 clone() 避免修改 Sprite 内部共享的 color 对象
        const color = this._side === 'player' ? UNIT_COLORS.PLAYER : UNIT_COLORS.ENEMY;
        const originalColor = new Color(color.r, color.g, color.b);

        // 设置白色（使用 clone 避免直接修改）
        this.body.color = Color.WHITE.clone();

        // 对 Sprite 组件的 color 属性做动画（而非对 Color 对象做动画）
        this._flashTween = tween(this.body)
            .to(0.1, { color: originalColor }, { easing: 'linear' })
            .call(() => {
                this._flashTween = null;
            })
            .start();
    }

    /**
     * 检查单位是否已完全死亡（可以被移除）
     * 注意：死亡动画期间返回 false，避免被提前移除或跳过碰撞检测
     */
    public isDead(): boolean {
        // 只有在死亡动画完成后才视为"完全死亡"
        return this._state === UnitState.DEAD && !this._isFading;
    }

    /**
     * 检查单位是否处于死亡状态（包括动画中）
     * 用于碰撞检测，死亡中的单位不应阻挡其他单位
     */
    public isDying(): boolean {
        return this._state === UnitState.DEAD;
    }

    /** 开始死亡淡出 - 颜色变暗 + 下沉 + 透明度淡出 */
    private startFadeOut(): void {
        if (this._isFading || !this.node?.isValid) return;
        this._isFading = true;

        // 停止之前的 tween（包括受击闪白）
        if (this._flashTween) {
            this._flashTween.stop();
            this._flashTween = null;
        }
        if (this._fadeTween) {
            this._fadeTween.stop();
            this._fadeTween = null;
        }

        // 获取当前位置
        const startX = this.node.position.x;
        const startY = this.node.position.y;
        const endY = startY - 15; // 向下移动 15 像素（倒地效果）

        // 使用 tween 实现：下沉 + 颜色变暗 + 淡出
        // 注意：直接对 Sprite 组件的 color 属性做动画
        this._fadeTween = tween(this.node)
            .to(0.3, { position: new Vec3(startX, endY, 0) }, { easing: 'quadOut' }) // 下沉
            .call(() => {
                // 颜色变暗为深灰色
                if (this.body) {
                    this.body.color = new Color(80, 80, 80, 255);
                }
            })
            .delay(0.5) // 停留片刻
            .call(() => {
                // 淡出透明度 - 对 Sprite 组件做动画
                if (this.body) {
                    const transparentColor = new Color(80, 80, 80, 0);
                    tween(this.body)
                        .to(0.7, { color: transparentColor }, { easing: 'linear' })
                        .call(() => {
                            this._isFading = false;
                            this._fadeTween = null;
                        })
                        .start();
                } else {
                    this._isFading = false;
                    this._fadeTween = null;
                }
            })
            .start();
    }

    /** 触发攻击抖动效果 */
    private triggerAttackShake(): void {
        if (!this.node?.isValid) return;

        // 停止之前的抖动
        if (this._shakeTween) {
            this._shakeTween.stop();
            this._shakeTween = null;
        }

        // 使用 tween 实现抖动：放大 -> 恢复
        this._shakeTween = tween(this.node)
            .to(0.075, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'quadOut' })
            .to(0.075, { scale: new Vec3(1, 1, 1) }, { easing: 'quadIn' })
            .call(() => {
                this._shakeTween = null;
            })
            .start();
    }

    // ==================== 技能 ====================

    private performStomp(allUnits: Unit[]): void {
        // 对周围 100px 内所有敌方单位造成 30 范围伤害
        const cx = this.getX();
        for (const u of allUnits) {
            // 使用 isDying() 跳过死亡中的单位
            if (u.getSide() === this._side || u.isDying()) continue;
            if (Math.abs(u.getX() - cx) <= 100) {
                u.takeDamage(30, this);
            }
        }
    }

    // ==================== 视觉更新 ====================

    private updateHPBar(): void {
        if (!this._hpBarBgTransform || !this._hpBarFillTransform) return;
        const ratio = Math.max(0, this._hp / this._maxHp);
        this._hpBarFillTransform.width = this._hpBarBgTransform.width * ratio;
    }
}
