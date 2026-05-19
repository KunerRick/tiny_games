import { _decorator, Component, Sprite, UITransform } from 'cc';
import { CASTLE_CONFIG } from './GameConfig';
import { Unit } from './Unit';

const { ccclass, property } = _decorator;

/**
 * 城堡组件
 * 管理城堡 HP、自动防御攻击、脚下血条视觉
 */
@ccclass('Castle')
export class Castle extends Component {
    // ---- 场景绑定 ----
    @property(Sprite)
    hpBar: Sprite | null = null;       // 绿色填充条（脚下）

    @property(Sprite)
    hpBarBg: Sprite | null = null;     // 灰色背景条（脚下）

    // ---- 运行时 ----
    private _hp: number = 3000;
    private _maxHp: number = 3000;
    private _side: 'player' | 'enemy' = 'player';
    private _attackCooldown: number = 0;
    private _isDead: boolean = false;

    /** 初始化城堡 */
    public init(hp: number, side: 'player' | 'enemy'): void {
        this._hp = hp;
        this._maxHp = hp;
        this._side = side;
        this._isDead = false;
        this._attackCooldown = 0;
        this.updateHPBar();
    }

    /** 每帧更新自动防御 */
    public tick(dt: number, enemyUnits: Unit[]): void {
        if (this._isDead) return;

        this._attackCooldown -= dt;
        if (this._attackCooldown <= 0) {
            const target = this.findNearestTarget(enemyUnits);
            if (target) {
                target.takeDamage(CASTLE_CONFIG.ATTACK, null);
                this._attackCooldown = 1.0 / CASTLE_CONFIG.ATTACK_SPEED;
            }
        }
    }

    private findNearestTarget(units: Unit[]): Unit | null {
        const cx = this.node.position.x;
        let nearest: Unit | null = null;
        let minDist = CASTLE_CONFIG.ATTACK_RANGE;

        for (const u of units) {
            if (u.isDead()) continue;
            const dist = Math.abs(u.getX() - cx);
            if (dist <= CASTLE_CONFIG.ATTACK_RANGE && dist <= minDist) {
                minDist = dist;
                nearest = u;
            }
        }
        return nearest;
    }

    /** 承受伤害 */
    public takeDamage(amount: number): void {
        if (this._isDead) return;
        this._hp -= amount;
        if (this._hp <= 0) {
            this._hp = 0;
            this._isDead = true;
        }
        this.updateHPBar();
    }

    // ==================== 视觉更新 ====================

    /** 根据 HP 比例调整脚下血条宽度 */
    private updateHPBar(): void {
        if (!this.hpBar || !this.hpBarBg) return;
        const ratio = Math.max(0, this._hp / this._maxHp);
        const bgTransform = this.hpBarBg.node.getComponent(UITransform);
        if (!bgTransform) return;
        const bgWidth = bgTransform.width;
        const fillTransform = this.hpBar.node.getComponent(UITransform);
        if (fillTransform) {
            fillTransform.width = bgWidth * ratio;
        }
    }

    // Getters
    public getHP(): number { return this._hp; }
    public getMaxHP(): number { return this._maxHp; }
    public getSide(): 'player' | 'enemy' { return this._side; }
    public isDead(): boolean { return this._isDead; }
}
