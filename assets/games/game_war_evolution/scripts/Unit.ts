import {
    _decorator, Component, Sprite, Color, Label, UITransform, tween, Tween, Vec3, Node, Graphics, UIOpacity,
} from 'cc';
import { UnitConfig, UnitState, WORLD, UNIT_COLORS, UNIT_ROW } from './GameConfig';
import { drawUnitSilhouette, drawShadow, drawChargeAura, drawShieldBubble, drawImpactSpark, drawStompRing, drawRing, colorFromHex } from './UnitArt';

const { ccclass, property } = _decorator;

/** 伤害飘字寿命（秒） */
const DAMAGE_FLOAT_LIFE = 0.55;

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
    body: Sprite | null = null;             // 单位身体色块（预制体 -> body，运行时隐藏改用剪影）

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

    // 激光聚焦视觉
    private _laserIndicator: Node | null = null;  // 头顶叠加指示器节点
    private _laserLabel: Label | null = null;      // 叠加倍率文字

    // 机甲专属
    private _hasSelfDestruct: boolean = false;   // 机甲死亡自爆标记

    // ---- 表现层 ----
    private _renderY: number = WORLD.BATTLE_Y;    // 分行后的渲染 y（逻辑坐标不变）
    private _silhouetteNode: Node | null = null;  // 剪影节点（两侧镜像靠它）
    private _silhouette: Graphics | null = null;  // 兵种剪影
    private _shadow: Graphics | null = null;      // 脚下阴影
    private _chargeRing: Graphics | null = null;  // 冲锋光环
    private _chargeNode: Node | null = null;      // 冲锋光环节点（脉冲用）
    private _chargeOpacity: UIOpacity | null = null;
    private _shieldNode: Node | null = null;      // 机甲护盾泡
    private _visualPhase: number = 0;             // 循环动效相位（tick 驱动，不挂补间）
    private _sparkCd: number = 0;                 // 命中火花节流
    private _opacity: UIOpacity | null = null;    // 死亡淡出
    private _bodyColor: Color = new Color(255, 255, 255);
    private _speedMul: number = 1;
    private _attackSpeedMul: number = 1;
    private _isCharging: boolean = false;

    // 视觉反馈
    private _flashTween: Tween<Node> | null = null;
    private _fadeTween: Tween<Node> | null = null;
    private _isFading: boolean = false;
    private _shakeTween: Tween<Node> | null = null;
    private _knockbackTween: Tween<Node> | null = null;
    private _floatTween: Tween<Node> | null = null;

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
        this._stompTimer = 0; // 践踏初始就绪，遇到敌人立即触发

        this._pendingCastleAttack = false;
        this._speedMul = 1;
        this._attackSpeedMul = 1;
        this._isCharging = false;

        // 护盾
        this._shieldHp = config.hasShield ? Math.floor(config.hp * 0.5) : 0;

        // 机甲专属：死亡自爆
        this._hasSelfDestruct = config.id === 'mech';

        // 初始分行：远程兵退到后排
        this._renderY = this.computeRowY(config);

        // 位置
        this.node.setPosition(startX, this._renderY, 0);

        // 应用大小缩放
        const scale = config.scale;
        this.node.setScale(scale, scale, 1);

        // 阵营/兵种混合色
        this._bodyColor = this.mixColor(side, config);

        // 隐藏旧的色块 Sprite，改用剪影（零贴图，A2 剪影优先）
        if (this.body) this.body.enabled = false;

        // 缓存 UITransform 引用
        this._hpBarBgTransform = this.hpBarBg?.node.getComponent(UITransform) ?? null;
        this._hpBarFillTransform = this.hpBarFill?.node.getComponent(UITransform) ?? null;
        if (this.hpBarBg) this.hpBarBg.color = new Color(10, 18, 30, 220);
        if (this.hpBarFill) {
            this.hpBarFill.color = side === 'player'
                ? colorFromHex('#38BDF8')
                : colorFromHex('#EF4444');
        }

        // 血条挪到脚下，避开剪影
        if (this.hpBarBg) this.hpBarBg.node.setPosition(0, -25, 0);
        if (this.hpBarFill) this.hpBarFill.node.setPosition(0, -25, 0);

        // 战场里不显示兵种名（20+ 单位时会互相压字），信息交给剪影
        if (this.nameLabel) this.nameLabel.node.active = false;

        this._opacity = this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);
        this._opacity.opacity = 255;

        this.buildVisual();
        this.updateHPBar();

        // 只有激光兵需要叠加指示器
        if (config.hasLaserFocus) {
            const indicatorNode = new Node('laserIndicator');
            indicatorNode.setParent(this.node);
            const indicatorY = 34 * scale;
            indicatorNode.setPosition(0, indicatorY, 0);
            indicatorNode.addComponent(UITransform).setContentSize(36, 20);
            // 深色药丸底，避免白字直接压在战场/天空上读不清
            const pill = indicatorNode.addComponent(Graphics);
            pill.fillColor = new Color(8, 14, 26, 200);
            pill.roundRect(-17, -10, 34, 20, 10);
            pill.fill();
            pill.lineWidth = 1.4;
            pill.strokeColor = new Color(125, 211, 252, 180);
            pill.roundRect(-17, -10, 34, 20, 10);
            pill.stroke();

            const label = indicatorNode.addComponent(Label);
            label.string = '1.0×';
            label.fontSize = 15;
            label.isBold = true;
            label.color = Color.WHITE.clone();
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            this._laserIndicator = indicatorNode;
            this._laserLabel = label;
        }
    }

    /** 按兵种决定所在行；同排按单位 id 抖动，避免完全重叠 */
    private computeRowY(config: UnitConfig): number {
        const ranged = config.attackRange > UNIT_ROW.RANGED_RANGE_THRESHOLD;
        const base = ranged ? UNIT_ROW.RANGED_Y : UNIT_ROW.MELEE_Y;
        return base;
    }

    private mixColor(side: 'player' | 'enemy', config: UnitConfig): Color {
        const base = side === 'player' ? UNIT_COLORS.PLAYER : UNIT_COLORS.ENEMY;
        const tint = config.tint;
        return new Color(
            Math.round(base.r * 0.6 + tint.r * 0.4),
            Math.round(base.g * 0.6 + tint.g * 0.4),
            Math.round(base.b * 0.6 + tint.b * 0.4),
        );
    }

    /** 创建阴影 / 剪影 / 护盾泡 / 冲锋光环 */
    private buildVisual(): void {
        if (!this._config) return;

        const shadowNode = new Node('shadow');
        shadowNode.setParent(this.node);
        shadowNode.setSiblingIndex(0);
        const shadowUt = shadowNode.addComponent(UITransform);
        shadowUt.setContentSize(48, 20);
        shadowNode.setPosition(0, -25, 0);
        this._shadow = shadowNode.addComponent(Graphics);
        drawShadow(this._shadow, 46);

        const shapeNode = new Node('silhouette');
        shapeNode.setParent(this.node);
        shapeNode.setSiblingIndex(1);
        const ut = shapeNode.addComponent(UITransform);
        ut.setContentSize(56, 56);
        // UnitArt 一律按「面向右」绘制：敌方镜像，两军面对面冲锋
        shapeNode.setScale(this._side === 'player' ? 1 : -1, 1, 1);
        this._silhouetteNode = shapeNode;
        this._silhouette = shapeNode.addComponent(Graphics);
        drawUnitSilhouette(this._silhouette, this._config.icon ?? 'default', this._bodyColor);

        // 机甲护盾泡（有护盾时显示，打破时消失）
        let nextIndex = 2;
        if (this._config.hasShield) {
            const shieldNode = new Node('shield');
            shieldNode.setParent(this.node);
            shieldNode.setSiblingIndex(nextIndex++);
            shieldNode.addComponent(UITransform).setContentSize(72, 72);
            drawShieldBubble(shieldNode.addComponent(Graphics), 28);
            shieldNode.active = this._shieldHp > 0;
            this._shieldNode = shieldNode;
        }

        const ringNode = new Node('chargeRing');
        ringNode.setParent(this.node);
        ringNode.setSiblingIndex(nextIndex);
        ringNode.addComponent(UITransform).setContentSize(64, 64);
        this._chargeRing = ringNode.addComponent(Graphics);
        drawChargeAura(this._chargeRing, 26);
        this._chargeOpacity = ringNode.addComponent(UIOpacity);
        this._chargeNode = ringNode;
        ringNode.active = false;
    }

    public setUnitId(id: number): void {
        this._unitId = id;
        // 同排抖动：让同兵种不重叠成一条线
        if (this._config && this.node?.isValid) {
            const jitter = ((id % 3) - 1) * UNIT_ROW.JITTER;
            this._renderY = this.computeRowY(this._config) + jitter;
            this.node.setPosition(this.node.position.x, this._renderY, 0);
        }
    }
    public getUnitId(): number { return this._unitId; }
    public getConfig(): UnitConfig { return this._config!; }
    public getSide(): 'player' | 'enemy' { return this._side; }
    public getHP(): number { return this._hp; }
    public getMaxHP(): number { return this._maxHp; }
    public getShieldHP(): number { return this._shieldHp; }
    public isRanged(): boolean {
        return !!this._config && this._config.attackRange > UNIT_ROW.RANGED_RANGE_THRESHOLD;
    }
    public getX(): number {
        // 防御性检查：node 可能已被销毁，避免 "Cannot read properties of undefined"
        if (!this.node?.isValid) return 0;
        return this.node.position.x;
    }
    public getRenderY(): number { return this._renderY; }
    public getState(): UnitState { return this._state; }
    public getLastAttacker(): Unit | null { return this._lastAttacker; }

    /** 用于 WarEvo 在 processDeadUnits 中清除活体单位对死亡单位的 _target 引用 */
    public clearTargetIf(targetUnit: Unit): void {
        if (this._target === targetUnit) {
            this._target = null;
        }
    }

    /** 全军冲锋（G2）：WarEvo 在冲锋开始/结束时统一调用 */
    public setChargeBuff(active: boolean): void {
        if (this._isCharging === active) return;
        this._isCharging = active;
        this._speedMul = active ? 1.6 : 1;
        this._attackSpeedMul = active ? 1.3 : 1;
        if (this._chargeNode && this._chargeNode.isValid) {
            this._chargeNode.active = active && !this.isDying();
            this._chargeNode.setScale(1, 1, 1);
        }
    }

    // ==================== 主 Tick（由 WarEvo 每帧调用） ====================

    public tick(dt: number, allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
        // 节点可能已被外部销毁（重开局 / 验收探针直接 destroy），此时 this.node 为 null，
        // 继续往下走会在 this.node.parent 上抛异常并刷满控制台
        if (!this.node || !this.node.isValid) return;
        if (this._state === UnitState.DEAD) return;
        if (!this._config) return;

        this.updateVisuals(dt);

        switch (this._state) {
            case UnitState.MOVING:
                this.updateMovement(dt, enemyCastleX);
                this.tryEngage(allUnits, playerCastleX, enemyCastleX);
                break;

            case UnitState.FIGHTING:
                this.updateFighting(dt, allUnits, playerCastleX, enemyCastleX);
                this.tickSkillCooldowns(dt);
                break;
        }

        this.updateHPBar();
    }

    /**
     * 循环动效（冲锋光焰 / 护盾泡脉动）。
     * 用 tick 驱动节点缩放与透明度，而不是给每个单位挂 repeatForever 补间 ——
     * 20 个单位 × 1 条循环补间就会超掉美术原则 A5 的「单屏 ≤ 20 个补间」。
     */
    private updateVisuals(dt: number): void {
        this._visualPhase += dt;
        if (this._sparkCd > 0) this._sparkCd -= dt;

        if (this._chargeNode && this._chargeNode.active) {
            const p = this._visualPhase * 7;
            const s = 1 + Math.sin(p) * 0.08;
            this._chargeNode.setScale(s, s, 1);
            if (this._chargeOpacity) {
                this._chargeOpacity.opacity = Math.round(190 + Math.sin(p * 1.6) * 55);
            }
        }
        if (this._shieldNode && this._shieldNode.active) {
            const s = 1 + Math.sin(this._visualPhase * 3.4) * 0.045;
            this._shieldNode.setScale(s, s, 1);
        }
    }

    // ==================== 移动 ====================

    private updateMovement(dt: number, enemyCastleX: number): void {
        const direction = this._side === 'player' ? 1 : -1;
        const dx = this._config!.moveSpeed * this._speedMul * direction * dt;
        let newX = this.node.position.x + dx;

        // 到达敌方城堡边界则停
        if (this._side === 'player' && newX >= enemyCastleX - 20) {
            newX = enemyCastleX - 20;
        } else if (this._side === 'enemy' && newX <= -enemyCastleX + 20) {
            newX = -enemyCastleX + 20;
        }

        this.node.setPosition(newX, this._renderY, 0);
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
     */
    private tryEngage(allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
        const enemy = this.findNearestEnemy(allUnits);
        if (enemy) {
            this._state = UnitState.FIGHTING;
            this._target = enemy;
            this._attackCooldown = 0; // 立即攻击

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

        let alliesAttackingSameTarget = 0;
        let myIndex = 0;
        for (const u of allUnits) {
            if (u === this || u.getSide() !== this._side || u.isDying()) continue;
            if (u.getState() === UnitState.FIGHTING && u._target === this._target) {
                if (u.getX() < myX) myIndex++;
                alliesAttackingSameTarget++;
            }
        }
        void alliesAttackingSameTarget;

        // 扇形围攻（扩展模式支持最多 15 个单位）
        const offsetPatterns = [0, -25, 25, -50, 50, -75, 75, -100, 100, -125, 125, -150, 150, -175, 175];
        const offset = offsetPatterns[Math.min(myIndex, offsetPatterns.length - 1)];

        const idealX = targetX - direction * (this._config!.attackRange - 5) + offset;
        const currentX = this.getX();
        const diff = idealX - currentX;

        if (Math.abs(diff) > 2) {
            const moveStep = Math.sign(diff) * Math.min(Math.abs(diff), 5);
            this.node.setPosition(currentX + moveStep, this._renderY, 0);
        }
    }

    /**
     * 战斗中更新
     */
    private updateFighting(dt: number, allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
        // 每帧先检查践踏 —— 技能优先于普攻
        this.tryTriggerStomp(allUnits);

        if (this._target) {
            if (this._target.getState() === UnitState.DEAD) {
                this._target = null;
                this.tryEngage(allUnits, playerCastleX, enemyCastleX);
                return;
            }
            const dist = Math.abs(this._target.getX() - this.getX());
            const cfg = this._config!;

            if (cfg.attackRange > 100) {
                if (dist < cfg.attackRange * 0.2) {
                    this.retreat(dt, allUnits);
                    return;
                } else if (dist > cfg.attackRange) {
                    this.advance(dt, allUnits);
                    return;
                }
                this.tryAttack(dt, this._target, allUnits);
            } else {
                if (dist > cfg.attackRange) {
                    this._target = null;
                    this._state = UnitState.MOVING;
                    this.tryEngage(allUnits, playerCastleX, enemyCastleX);
                    return;
                }
                this.tryAttack(dt, this._target, allUnits);
            }

            if (this._target && this._target.isDead()) {
                this._target = null;
                this.tryEngage(allUnits, playerCastleX, enemyCastleX);
                return;
            }
        } else {
            const castleX = this._side === 'player' ? enemyCastleX : playerCastleX;
            const distToCastle = Math.abs(this.getX() - castleX);
            if (distToCastle <= this._config!.attackRange + 30) {
                this.tryAttackCastle(dt, playerCastleX, enemyCastleX);
            } else {
                this._state = UnitState.MOVING;
                return;
            }

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
        const retreatSpeed = this._config!.moveSpeed * this._speedMul * 0.5;
        const dx = retreatSpeed * direction * dt;
        const newX = this.node.position.x + dx;

        const myX = this.getX();
        let blocked = false;
        for (const u of allUnits) {
            if (u === this || u.getSide() !== this._side || u.isDying()) continue;
            const ux = u.getX();
            const dist = Math.abs(ux - myX);
            if (this._side === 'player' && ux < myX && dist < 30) { blocked = true; break; }
            if (this._side === 'enemy' && ux > myX && dist < 30) { blocked = true; break; }
        }

        if (!blocked) {
            this.node.setPosition(newX, this._renderY, 0);
        }
        if (this._target) {
            this.tryAttack(dt, this._target, allUnits);
        }
    }

    /**
     * 远程兵追击 - 接近敌人到攻击范围
     */
    private advance(dt: number, allUnits: Unit[]): void {
        void allUnits;
        const direction = this._side === 'player' ? 1 : -1;
        const dx = this._config!.moveSpeed * this._speedMul * direction * dt;
        const newX = this.node.position.x + dx;
        this.node.setPosition(newX, this._renderY, 0);
    }

    /**
     * 执行单位攻击
     */
    private tryAttack(dt: number, target: Unit, allUnits: Unit[]): void {
        this._attackCooldown -= dt;
        if (this._attackCooldown > 0) return;

        const dist = Math.abs(target.getX() - this.getX());
        if (dist > this._config!.attackRange) return;

        const cfg = this._config!;
        let damage = cfg.attack;

        // 骑士冲锋：首次攻击 2 倍（并留一道冲刺残影）
        const isChargeHit = !!cfg.hasCharge && !this._chargeUsed;
        if (isChargeHit) {
            damage *= 2;
        }

        // 激光聚焦：持续攻击同一目标伤害递增，切换目标衰减 0.3（不重置）
        if (cfg.hasLaserFocus) {
            if (target.getUnitId() !== this._laserTargetId) {
                this._laserFocus = Math.max(1.0, this._laserFocus - 0.3);
                this._laserTargetId = target.getUnitId();
            }
            this._laserFocus = Math.min(this._laserFocus + 0.3, 2.0);
            damage = Math.round(damage * this._laserFocus);

            if (this._laserLabel) {
                const mult = Math.round(this._laserFocus * 10) / 10;
                this._laserLabel.string = `${mult}×`;
                if (this._laserFocus >= 2.0) {
                    this._laserLabel.color = new Color(255, 50, 50);
                } else if (this._laserFocus >= 1.5) {
                    this._laserLabel.color = new Color(255, 220, 80);
                } else {
                    this._laserLabel.color = Color.WHITE.clone();
                }
            }
        }

        // 近战惩罚：被贴身时伤害打折（如弓箭手 50%）
        if (cfg.closeRangePenalty && dist <= 50) {
            damage = Math.floor(damage * cfg.closeRangePenalty);
        }

        // 远程单位先画弹道，再结算伤害
        if (cfg.attackRange > 100) {
            this.spawnProjectile(target);
        }

        target.takeDamage(damage, this, allUnits);
        if (isChargeHit) {
            this._chargeUsed = true;
            this.spawnChargeStreak();
        }
        this._attackCooldown = (1.0 / cfg.attackSpeed) / this._attackSpeedMul;

        this.playAttackSwing();
    }

    /**
     * 执行城堡攻击
     */
    private tryAttackCastle(dt: number, playerCastleX: number, enemyCastleX: number): void {
        this._attackCooldown -= dt;
        if (this._attackCooldown > 0) return;

        const castleX = this._side === 'player' ? enemyCastleX : playerCastleX;
        const distToCastle = Math.abs(this.getX() - castleX);
        if (distToCastle > this._config!.attackRange + 30) return;

        this._attackCooldown = (1.0 / this._config!.attackSpeed) / this._attackSpeedMul;
        this._pendingCastleAttack = true;
        this.playAttackSwing();
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

    /** 战斗中倒计时技能冷却 */
    private tickSkillCooldowns(dt: number): void {
        if (this._config!.hasStomp && this._stompTimer > 0) {
            this._stompTimer -= dt;
        }
    }

    private tryTriggerStomp(allUnits: Unit[]): boolean {
        if (!this._config!.hasStomp || this._stompTimer > 0) return false;

        for (const u of allUnits) {
            if (u.getSide() === this._side || u.isDying()) continue;
            if (Math.abs(u.getX() - this.getX()) <= Unit.STOMP_RANGE) {
                this._stompTimer = 8.0;
                this.performStomp(allUnits);
                this._attackCooldown = 0;
                return true;
            }
        }
        return false;
    }

    // ==================== 受伤害 & 死亡 ====================

    public takeDamage(amount: number, attacker: Unit | null, allUnits?: Unit[]): void {
        if (this._state === UnitState.DEAD) return;
        if (attacker) this._lastAttacker = attacker;

        let remaining = amount;

        if (this._shieldHp > 0) {
            if (remaining <= this._shieldHp) {
                this._shieldHp -= remaining;
                this.triggerHitFlash();
                this.spawnHitSpark('#67E8F9');
                this.spawnDamageNumber(remaining, attacker?.getSide() ?? 'enemy');
                return;
            }
            remaining -= this._shieldHp;
            this._shieldHp = 0;
            this.breakShield();
        }

        this._hp -= remaining;
        this.triggerHitFlash();
        this.spawnHitSpark();
        this.spawnDamageNumber(remaining, attacker?.getSide() ?? 'enemy');

        if (attacker && attacker.getConfig().hasCharge && !attacker.hasChargeUsed()) {
            this.applyKnockback(attacker, allUnits);
        }

        if (this._hp <= 0) {
            this._hp = 0;
            this.updateHPBar();
            this._state = UnitState.DEAD;
            if (this._chargeNode) this._chargeNode.active = false;
            if (this._hasSelfDestruct && allUnits) {
                this.performSelfDestruct(allUnits);
            }
            this.startFadeOut();
        }
    }

    /** 护盾被打穿：护盾泡消失 + 一圈青色爆环 */
    private breakShield(): void {
        if (this._shieldNode && this._shieldNode.isValid) {
            this._shieldNode.active = false;
        }
        this.spawnRingBurst('#67E8F9', 30, 0.28);
    }

    /** 命中火花：受击点一顆四角星（节流到 ~16 帧一次，避免 AoE 刷屏） */
    private spawnHitSpark(hexColor = '#FFFFFF'): void {
        if (this._sparkCd > 0) return;
        this._sparkCd = 0.06;
        const container = this.node.parent;
        if (!container || !container.isValid) return;
        const node = new Node('spark');
        container.addChild(node);
        node.addComponent(UITransform).setContentSize(24, 24);
        node.setPosition(
            this.node.position.x + (Math.random() * 20 - 10),
            this.node.position.y + (Math.random() * 22 - 4),
            0,
        );
        const g = node.addComponent(Graphics);
        drawImpactSpark(g, 9);
        if (hexColor !== '#FFFFFF') {
            g.fillColor = colorFromHex(hexColor, 200);
            g.circle(0, 0, 3);
            g.fill();
        }
        const op = node.addComponent(UIOpacity);
        tween(node).to(0.16, { scale: new Vec3(1.7, 1.7, 1) }, { easing: 'quadOut' }).start();
        tween(op).to(0.16, { opacity: 0 })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
    }

    /** 通用扩散圆环（护盾破碎 / 爆炸等） */
    private spawnRingBurst(hexColor: string, maxRadius: number, life = 0.3): void {
        const container = this.node.parent;
        if (!container || !container.isValid) return;
        const node = new Node('ringBurst');
        container.addChild(node);
        node.addComponent(UITransform).setContentSize(80, 80);
        node.setPosition(this.node.position.x, this.node.position.y, 0);
        drawRing(node.addComponent(Graphics), 12, hexColor, 4, 230);
        const op = node.addComponent(UIOpacity);
        const s = maxRadius / 12;
        tween(node).to(life, { scale: new Vec3(s, s, 1) }, { easing: 'quadOut' })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
        tween(op).to(life, { opacity: 0 }).start();
    }

    /** 应用击退效果 */
    private applyKnockback(attacker: Unit, allUnits?: Unit[]): void {
        if (!this.node?.isValid) return;

        const knockbackDir = attacker.getSide() === 'player' ? 1 : -1;
        const knockbackDist = 35;
        const currentX = this.node.position.x;
        let targetX = currentX + knockbackDist * knockbackDir;

        if (allUnits) {
            const minGap = 25;
            for (const u of allUnits) {
                if (u === this || u.getSide() !== this._side || u.isDying()) continue;
                const ux = u.getX();
                if (knockbackDir > 0 && ux > currentX && ux < targetX + minGap) {
                    targetX = Math.min(targetX, ux - minGap);
                } else if (knockbackDir < 0 && ux < currentX && ux > targetX - minGap) {
                    targetX = Math.max(targetX, ux + minGap);
                }
            }
        }

        targetX = Math.max(-350, Math.min(350, targetX));

        if (this._knockbackTween) {
            this._knockbackTween.stop();
            this._knockbackTween = null;
        }

        this._knockbackTween = tween(this.node)
            .to(0.2, { position: new Vec3(targetX, this._renderY, 0) }, { easing: 'quadOut' })
            .call(() => {
                this._knockbackTween = null;
            })
            .start();
    }

    public hasChargeUsed(): boolean {
        return this._chargeUsed;
    }

    /** 受击闪白：用剪影重绘实现（Graphics 的 color 不做顶点染色） */
    private triggerHitFlash(): void {
        if (!this._silhouette || !this._silhouette.isValid || !this._config) return;

        if (this._flashTween) {
            this._flashTween.stop();
            this._flashTween = null;
        }

        drawUnitSilhouette(this._silhouette, this._config.icon ?? 'default', Color.WHITE.clone(),
            new Color(255, 255, 255, 220));

        this._flashTween = tween(this.node)
            .delay(0.08)
            .call(() => {
                if (this._silhouette && this._silhouette.isValid && this._config) {
                    drawUnitSilhouette(this._silhouette, this._config.icon ?? 'default', this._bodyColor);
                }
                this._flashTween = null;
            })
            .start();
    }

    /** 伤害飘字：玩家造成的伤害白色，敌方红色（A4 反馈三件套之②） */
    private spawnDamageNumber(amount: number, attackerSide: 'player' | 'enemy'): void {
        const container = this.node.parent;
        if (!container || !container.isValid) return;

        const node = new Node('dmg');
        container.addChild(node);
        node.setSiblingIndex(container.children.length - 1);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(70, 28);
        node.setPosition(this.node.position.x + (Math.random() * 16 - 8), this.node.position.y + 22, 0);
        const label = node.addComponent(Label);
        label.string = `-${Math.max(1, Math.round(amount))}`;
        label.fontSize = 20;
        label.isBold = true;
        label.color = attackerSide === 'player' ? colorFromHex('#F8FAFC') : colorFromHex('#FCA5A5');
        label.horizontalAlign = Label.HorizontalAlign.CENTER;

        const startY = node.position.y;
        tween(node)
            .to(DAMAGE_FLOAT_LIFE, { position: new Vec3(node.position.x, startY + 34, 0) }, { easing: 'quadOut' })
            .call(() => {
                if (node.isValid) node.destroy();
            })
            .start();
    }

    /** 远程弹道：激光兵走持续光束，其余（弓箭手）飞一支带箭头的实体箭 */
    private spawnProjectile(target: Unit): void {
        if (this._config?.hasLaserFocus) {
            this.spawnLaserBeam(target);
        } else {
            this.spawnArrow(target);
        }
    }

    /** 弓箭：一支实体箭从自身飞到目标（带朝向），命中即消失 */
    private spawnArrow(target: Unit): void {
        const container = this.node.parent;
        if (!container || !container.isValid) return;

        const fromX = this.node.position.x;
        const fromY = this.node.position.y;
        const toX = target.getX();
        const toY = target.getRenderY();

        const node = new Node('arrow');
        container.addChild(node);
        node.addComponent(UITransform).setContentSize(28, 28);
        node.setPosition(fromX, fromY, 0);
        const g = node.addComponent(Graphics);
        g.lineCap = Graphics.LineCap.ROUND;
        g.lineWidth = 3;
        g.strokeColor = colorFromHex('#FDE68A', 235);
        g.moveTo(-9, 0);
        g.lineTo(5, 0);
        g.stroke();
        g.fillColor = colorFromHex('#F8FAFC', 245);
        g.moveTo(12, 0);
        g.lineTo(4, 4);
        g.lineTo(4, -4);
        g.close();
        g.fill();

        node.angle = Math.atan2(toY - fromY, toX - fromX) * 180 / Math.PI;
        const dist = Math.hypot(toX - fromX, toY - fromY);
        const dur = Math.max(0.08, Math.min(0.26, dist / 1200));
        tween(node)
            .to(dur, { position: new Vec3(toX, toY, 0) }, { easing: 'sineOut' })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
    }

    /** 激光：三层光束（外晕 / 中层 / 白核），聚焦倍率越高越粗越亮 */
    private spawnLaserBeam(target: Unit): void {
        const container = this.node.parent;
        if (!container || !container.isValid) return;

        const fromX = this.node.position.x;
        const fromY = this.node.position.y;
        const toX = target.getX();
        const toY = target.getRenderY();
        const power = Math.max(0, Math.min(1, this._laserFocus - 1));

        const node = new Node('laser');
        container.addChild(node);
        node.addComponent(UITransform).setContentSize(28, 28);
        const g = node.addComponent(Graphics);
        g.lineCap = Graphics.LineCap.ROUND;

        g.lineWidth = 10;
        g.strokeColor = colorFromHex('#22D3EE', Math.round(70 + 70 * power));
        g.moveTo(fromX, fromY);
        g.lineTo(toX, toY);
        g.stroke();

        g.lineWidth = 4.4;
        g.strokeColor = colorFromHex('#67E8F9', 225);
        g.moveTo(fromX, fromY);
        g.lineTo(toX, toY);
        g.stroke();

        g.lineWidth = 1.8 + power * 1.6;
        g.strokeColor = colorFromHex('#FFFFFF', 245);
        g.moveTo(fromX, fromY);
        g.lineTo(toX, toY);
        g.stroke();

        // 枪口闪光 + 命中点光斑
        g.fillColor = colorFromHex('#CFFAFE', 235);
        g.circle(fromX, fromY, 4 + power * 2);
        g.fill();
        g.circle(toX, toY, 5 + power * 3);
        g.fill();

        const op = node.addComponent(UIOpacity);
        tween(op)
            .to(0.16, { opacity: 0 })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
    }

    /** 骑士首击残影：身后一道金色横向拖尾 */
    private spawnChargeStreak(): void {
        const container = this.node.parent;
        if (!container || !container.isValid) return;
        const node = new Node('chargeStreak');
        container.addChild(node);
        node.addComponent(UITransform).setContentSize(80, 24);
        node.setPosition(this.node.position.x, this.node.position.y, 0);
        const dir = this._side === 'player' ? -1 : 1;

        const g = node.addComponent(Graphics);
        g.lineCap = Graphics.LineCap.ROUND;
        g.lineWidth = 9;
        g.strokeColor = colorFromHex('#F59E0B', 200);
        g.moveTo(0, 0);
        g.lineTo(34 * dir, 0);
        g.stroke();
        g.lineWidth = 3.5;
        g.strokeColor = colorFromHex('#FEF3C7', 240);
        g.moveTo(0, 0);
        g.lineTo(30 * dir, 0);
        g.stroke();

        const op = node.addComponent(UIOpacity);
        tween(node).to(0.22, { position: new Vec3(this.node.position.x + 26 * dir, this.node.position.y, 0) }).start();
        tween(op).to(0.22, { opacity: 0 })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
    }

    /** 攻击前摇：压扁→回弹（0.12s 视觉，不影响逻辑时点），近战额外画一道挥砍弧 */
    private playAttackSwing(): void {
        if (!this.node?.isValid || !this._config) return;
        if (this._shakeTween) {
            this._shakeTween.stop();
            this._shakeTween = null;
        }
        const base = this._config.scale;
        this._shakeTween = tween(this.node)
            .to(0.06, { scale: new Vec3(base * 1.12, base * 0.86, 1) }, { easing: 'quadOut' })
            .to(0.06, { scale: new Vec3(base, base, 1) }, { easing: 'quadIn' })
            .call(() => { this._shakeTween = null; })
            .start();

        if (this._config.attackRange <= 100) this.spawnSwingArc();
    }

    /** 近战挥砍弧：身前一道白色弧形闪光（0.16s） */
    private spawnSwingArc(): void {
        const container = this.node.parent;
        if (!container || !container.isValid) return;
        const dir = this._side === 'player' ? 1 : -1;

        const node = new Node('swing');
        container.addChild(node);
        node.addComponent(UITransform).setContentSize(64, 64);
        node.setPosition(this.node.position.x + dir * 10, this.node.position.y, 0);
        const g = node.addComponent(Graphics);
        g.lineCap = Graphics.LineCap.ROUND;
        g.lineWidth = 3.2;
        g.strokeColor = colorFromHex('#F8FAFC', 175);
        g.arc(0, 0, 20, -0.95, 0.95, false);
        g.stroke();
        g.lineWidth = 1.4;
        g.strokeColor = colorFromHex('#93C5FD', 170);
        g.arc(0, 0, 24, -0.8, 0.8, false);
        g.stroke();
        node.setScale(dir, 1, 1);

        const op = node.addComponent(UIOpacity);
        tween(node)
            .to(0.16, { scale: new Vec3(dir * 1.25, 1.25, 1) }, { easing: 'quadOut' })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
        tween(op).to(0.16, { opacity: 0 }).start();
    }

    public isDead(): boolean {
        return this._state === UnitState.DEAD && !this._isFading;
    }

    public isDying(): boolean {
        return this._state === UnitState.DEAD;
    }

    /** 开始死亡淡出 - 碎裂 + 下沉 + 透明度淡出 */
    private startFadeOut(): void {
        if (this._isFading || !this.node?.isValid) return;
        this._isFading = true;

        if (this._flashTween) { this._flashTween.stop(); this._flashTween = null; }
        if (this._fadeTween) { this._fadeTween.stop(); this._fadeTween = null; }

        this.spawnDeathShards();

        const startX = this.node.position.x;
        const startY = this.node.position.y;
        const endY = startY - 12;

        this._fadeTween = tween(this.node)
            .to(0.25, { position: new Vec3(startX, endY, 0) }, { easing: 'quadOut' })
            .call(() => {
                if (this._silhouette && this._silhouette.isValid && this._config) {
                    drawUnitSilhouette(this._silhouette, this._config.icon ?? 'default',
                        new Color(70, 75, 85, 255));
                }
            })
            .delay(0.15)
            .call(() => {
                if (this._opacity) {
                    tween(this._opacity)
                        .to(0.35, { opacity: 0 })
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

    /** 死亡碎裂：冲击环 + 6 块带描边的身体颜色碎块 + 扬尘 */
    private spawnDeathShards(): void {
        const container = this.node.parent;
        if (!container || !container.isValid) return;
        const cx = this.node.position.x;
        const cy = this.node.position.y;

        this.spawnRingBurst('#F8FAFC', 34, 0.3);

        for (let i = 0; i < 6; i++) {
            const shard = new Node('shard');
            container.addChild(shard);
            shard.addComponent(UITransform).setContentSize(12, 12);
            shard.setPosition(cx, cy, 0);
            const g = shard.addComponent(Graphics);
            g.fillColor = this._bodyColor;
            g.strokeColor = new Color(8, 14, 26, 220);
            g.lineWidth = 1.6;
            // 不规则五边形碎块，比正方形更像"被打碎"
            const r = 3.2 + Math.random() * 1.6;
            g.moveTo(-r, -r * 0.6);
            g.lineTo(r * 0.2, -r);
            g.lineTo(r, -r * 0.2);
            g.lineTo(r * 0.5, r);
            g.lineTo(-r * 0.8, r * 0.5);
            g.close();
            g.fill();
            g.stroke();

            const op = shard.addComponent(UIOpacity);
            const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
            const dist = 20 + Math.random() * 16;
            const ex = cx + Math.cos(angle) * dist;
            const ey = cy + Math.sin(angle) * dist - 8;
            tween(shard)
                .to(0.32, {
                    position: new Vec3(ex, ey, 0),
                    scale: new Vec3(0.2, 0.2, 1),
                    angle: (Math.random() * 2 - 1) * 220,
                }, { easing: 'quadOut' })
                .call(() => { if (shard.isValid) shard.destroy(); })
                .start();
            tween(op).to(0.32, { opacity: 0 }).start();
        }
    }

    // ==================== 技能 ====================

    private static readonly STOMP_RANGE = 100;
    private static readonly STOMP_DAMAGE = 30;

    private performStomp(allUnits: Unit[]): void {
        this.spawnShockwave(() => {
            this.applyStompDamage(allUnits);
        });
    }

    private spawnShockwave(onComplete: () => void): void {
        if (!this.node?.isValid) return;
        const container = this.node.parent;
        if (!container || !container.isValid) return;

        const waveNode = new Node('Shockwave');
        container.addChild(waveNode);
        waveNode.setPosition(this.node.position.x, this._renderY, 0);
        waveNode.addComponent(UITransform).setContentSize(Unit.STOMP_RANGE * 2, Unit.STOMP_RANGE * 2);

        const g = waveNode.addComponent(Graphics);
        drawStompRing(g, 12.5);

        const op = waveNode.addComponent(UIOpacity);
        op.opacity = 235;

        const targetScale = (Unit.STOMP_RANGE * 2) / 25;

        tween(waveNode)
            .to(0.32, { scale: new Vec3(targetScale, targetScale, 1) }, { easing: 'quadOut' })
            .call(() => {
                onComplete();
                if (waveNode.isValid) waveNode.destroy();
            })
            .start();

        tween(op).to(0.32, { opacity: 0 }).start();

        // 扬尘：6 块小土块向两侧蹦出（与冲击环同寿命）
        for (let i = 0; i < 6; i++) {
            const dust = new Node('dust');
            container.addChild(dust);
            dust.addComponent(UITransform).setContentSize(12, 12);
            dust.setPosition(this.node.position.x, this._renderY - 6, 0);
            const dg = dust.addComponent(Graphics);
            dg.fillColor = colorFromHex('#E7C48A', 210);
            dg.circle(0, 0, 3 + Math.random() * 2);
            dg.fill();
            const dop = dust.addComponent(UIOpacity);
            const dir = i < 3 ? 1 : -1;
            const ex = this.node.position.x + dir * (30 + Math.random() * 55);
            const ey = this._renderY + 10 + Math.random() * 16;
            tween(dust)
                .to(0.32, { position: new Vec3(ex, ey, 0), scale: new Vec3(0.4, 0.4, 1) }, { easing: 'quadOut' })
                .call(() => { if (dust.isValid) dust.destroy(); })
                .start();
            tween(dop).to(0.32, { opacity: 0 }).start();
        }
    }

    private applyStompDamage(allUnits: Unit[]): void {
        if (!this.node?.isValid) return;
        const cx = this.getX();

        for (const u of allUnits) {
            if (u.getSide() === this._side || u.isDying()) continue;
            if (Math.abs(u.getX() - cx) <= Unit.STOMP_RANGE) {
                u.takeDamage(Unit.STOMP_DAMAGE, this);
                u.triggerFloatEffect();
            }
        }
    }

    /** 受击弹跳效果（践踏等范围技能触发） */
    public triggerFloatEffect(): void {
        if (!this.node?.isValid) return;
        if (this.isDying()) return;

        if (this._floatTween) {
            this._floatTween.stop();
            this._floatTween = null;
        }

        const origX = this.node.position.x;
        const origY = this._renderY;

        this._floatTween = tween(this.node)
            .to(0.08, { position: new Vec3(origX, origY + 8, 0) }, { easing: 'quadOut' })
            .to(0.08, { position: new Vec3(origX, origY, 0) }, { easing: 'quadIn' })
            .call(() => { this._floatTween = null; })
            .start();
    }

    private performSelfDestruct(allUnits: Unit[]): void {
        const cx = this.getX();
        for (const u of allUnits) {
            if (u.getSide() === this._side || u.isDying()) continue;
            if (Math.abs(u.getX() - cx) <= 100) {
                u.takeDamage(60, null);
            }
        }
        this.triggerExplosionEffect();
    }

    private triggerExplosionEffect(): void {
        if (!this.node?.isValid) return;
        const container = this.node.parent;
        if (!container || !container.isValid) return;
        const cx = this.node.position.x;
        const cy = this._renderY;

        // 内核闪光
        const node = new Node('boom');
        container.addChild(node);
        node.addComponent(UITransform).setContentSize(72, 72);
        node.setPosition(cx, cy, 0);
        const g = node.addComponent(Graphics);
        g.fillColor = colorFromHex('#F59E0B', 200);
        g.circle(0, 0, 14);
        g.fill();
        g.fillColor = colorFromHex('#FEF3C7', 235);
        g.circle(0, 0, 7);
        g.fill();
        const op = node.addComponent(UIOpacity);
        tween(node).to(0.26, { scale: new Vec3(4.2, 4.2, 1) }, { easing: 'quadOut' })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
        tween(op).to(0.26, { opacity: 0 }).start();

        // 外圈橙色冲击环
        const ring = new Node('boomRing');
        container.addChild(ring);
        ring.addComponent(UITransform).setContentSize(200, 200);
        ring.setPosition(cx, cy, 0);
        drawRing(ring.addComponent(Graphics), 14, '#FBBF24', 5, 210);
        const rop = ring.addComponent(UIOpacity);
        const rs = 100 / 14;
        tween(ring).to(0.34, { scale: new Vec3(rs, rs, 1) }, { easing: 'quadOut' })
            .call(() => { if (ring.isValid) ring.destroy(); })
            .start();
        tween(rop).to(0.34, { opacity: 0 }).start();

        // 迸射碎片
        for (let i = 0; i < 8; i++) {
            const bit = new Node('bit');
            container.addChild(bit);
            bit.addComponent(UITransform).setContentSize(10, 10);
            bit.setPosition(cx, cy, 0);
            const bg = bit.addComponent(Graphics);
            bg.fillColor = colorFromHex(i % 2 === 0 ? '#F59E0B' : '#FCD34D');
            bg.circle(0, 0, 2.5 + Math.random() * 1.5);
            bg.fill();
            const bop = bit.addComponent(UIOpacity);
            const a = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
            const d = 40 + Math.random() * 26;
            tween(bit)
                .to(0.32, { position: new Vec3(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0), scale: new Vec3(0.3, 0.3, 1) }, { easing: 'quadOut' })
                .call(() => { if (bit.isValid) bit.destroy(); })
                .start();
            tween(bop).to(0.32, { opacity: 0 }).start();
        }
    }

    // ==================== 视觉更新 ====================

    private updateHPBar(): void {
        if (!this._hpBarBgTransform || !this._hpBarFillTransform) return;
        const total = this._maxHp + (this._config?.hasShield ? Math.floor(this._config.hp * 0.5) : 0);
        const ratio = Math.max(0, (this._hp + this._shieldHp) / Math.max(1, total));
        this._hpBarFillTransform.width = this._hpBarBgTransform.width * ratio;
    }
}
