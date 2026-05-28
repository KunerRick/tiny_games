import { _decorator, Component, Node, Sprite, Color } from 'cc';
import { GridPosition, GridController } from './GridController';
import { SkillConfig, getClassById } from '../config/GameData';

const { ccclass, property } = _decorator;

export interface UnitData {
  id: string;
  name: string;
  classId: string;
  isPlayer: boolean;
  stats: { hp: number; attack: number; defense: number; move: number; range: number };
  currentHp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  energyRegen: number;
  baseStats: { hp: number; attack: number; defense: number; move: number; range: number };
  skills: SkillConfig[];
  gridPos: GridPosition;
  isAlive: boolean;
  hasMoved: boolean;
  hasActed: boolean;
  buffs: { type: string; turnsLeft: number; params: Record<string, number> }[];
  shieldAmount: number;
}

export interface BuffEntry {
  type: string;
  turnsLeft: number;
  params: Record<string, number>;
}

@ccclass('UnitController')
export class UnitController extends Component {
  @property({ type: Node, tooltip: '单位精灵节点' })
  unitSprite: Node = null;

  @property({ type: Node, tooltip: '选中高亮节点' })
  selectionIndicator: Node = null;

  private _data: UnitData | null = null;
  private _isSelected: boolean = false;

  init(classId: string, isPlayer: boolean, gridPos: GridPosition): void {
    const classConfig = getClassById(classId);
    if (!classConfig) return;

    this._data = {
      id: `${isPlayer ? 'p' : 'e'}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: classConfig.name,
      classId: classConfig.id,
      isPlayer,
      stats: { ...classConfig.stats },
      currentHp: classConfig.stats.hp,
      maxHp: classConfig.stats.hp,
      energy: classConfig.energy.max,
      maxEnergy: classConfig.energy.max,
      energyRegen: classConfig.energy.regen,
      baseStats: { ...classConfig.stats },
      skills: [],
      gridPos: { ...gridPos },
      isAlive: true,
      hasMoved: false,
      hasActed: false,
      buffs: [],
      shieldAmount: 0,
    };

    this.updatePosition();

    if (this.selectionIndicator) {
      this.selectionIndicator.active = false;
    }

    if (isPlayer) {
      this.setTintColor(new Color(100, 180, 255));
    } else {
      this.setTintColor(new Color(255, 100, 100));
    }
  }

  get data(): UnitData | null {
    return this._data;
  }

  get isSelected(): boolean {
    return this._isSelected;
  }

  setSelected(selected: boolean): void {
    this._isSelected = selected;
    if (this.selectionIndicator) {
      this.selectionIndicator.active = selected;
    }
  }

  private setTintColor(color: Color): void {
    if (this.unitSprite) {
      const sprite = this.unitSprite.getComponent(Sprite);
      if (sprite) {
        sprite.color = color;
      }
    }
  }

  private updatePosition(): void {
    if (this._data) {
      this.node.setPosition(
        (this._data.gridPos.col - 2.5) * GridController.CELL_SIZE,
        (this._data.gridPos.row - 2.5) * GridController.CELL_SIZE
      );
    }
  }

  setGridPosition(pos: GridPosition): void {
    if (!this._data) return;
    this._data.gridPos = { ...pos };
    this._data.hasMoved = true;
    this.updatePosition();
  }

  takeDamage(rawAmount: number, ignoreDefense: boolean = false): number {
    if (!this._data || !this._data.isAlive) return 0;

    let actualDamage = rawAmount;

    if (!ignoreDefense) {
      actualDamage = Math.max(1, rawAmount - this._data.stats.defense);
    }

    if (this._data.shieldAmount > 0) {
      const absorbed = Math.min(this._data.shieldAmount, actualDamage);
      this._data.shieldAmount -= absorbed;
      actualDamage -= absorbed;
    }

    if (actualDamage <= 0) return 0;

    this._data.currentHp -= actualDamage;
    if (this._data.currentHp <= 0) {
      this._data.currentHp = 0;
      this._data.isAlive = false;
    }

    return actualDamage;
  }

  heal(amount: number): void {
    if (!this._data || !this._data.isAlive) return;
    this._data.currentHp = Math.min(this._data.maxHp, this._data.currentHp + amount);
  }

  healFull(): void {
    if (!this._data) return;
    this._data.currentHp = this._data.maxHp;
  }

  canUseSkill(skillIndex: number): boolean {
    if (!this._data) return false;
    if (skillIndex < 0 || skillIndex >= this._data.skills.length) return false;
    return this._data.energy >= this._data.skills[skillIndex].energyCost;
  }

  useSkill(skillIndex: number): SkillConfig | null {
    if (!this._data || !this.canUseSkill(skillIndex)) return null;
    const skill = this._data.skills[skillIndex];
    this._data.energy -= skill.energyCost;
    this._data.hasActed = true;
    return skill;
  }

  addSkill(skill: SkillConfig): void {
    if (!this._data) return;
    if (this._data.skills.length >= 3) {
      this._data.skills.pop();
    }
    this._data.skills.push(skill);

    if (skill.type === 'passive') {
      this.applyPassiveEffect(skill.id);
    }
  }

  replaceSkill(index: number, newSkill: SkillConfig): void {
    if (!this._data || index < 0 || index >= this._data.skills.length) return;
    this._data.skills[index] = newSkill;
    if (newSkill.type === 'passive') {
      this.applyPassiveEffect(newSkill.id);
    }
  }

  private applyPassiveEffect(skillId: string): void {
    if (!this._data) return;
    if (skillId === 'toughness') {
      this._data.maxHp += 1;
      this._data.currentHp = Math.min(this._data.currentHp + 1, this._data.maxHp);
      this._data.stats.defense += 1;
    }
    if (skillId === 'arcane_flow') {
      this._data.energyRegen += 1;
    }
  }

  onTurnStart(): void {
    if (!this._data || !this._data.isAlive) return;

    this._data.energy = Math.min(this._data.maxEnergy, this._data.energy + this._data.energyRegen);
    this._data.hasMoved = false;
    this._data.hasActed = false;

    for (let i = this._data.buffs.length - 1; i >= 0; i--) {
      const buff = this._data.buffs[i];
      buff.turnsLeft--;
      if (buff.turnsLeft <= 0) {
        this.removeBuff(buff);
        this._data.buffs.splice(i, 1);
      }
    }
  }

  private removeBuff(buff: BuffEntry): void {
    if (!this._data) return;
    if (buff.type === 'buff_move') {
      this._data.stats.move = this._data.baseStats.move;
    }
    if (buff.type === 'buff_attack') {
      this._data.stats.attack -= buff.params.amount ?? 0;
    }
    if (buff.type === 'mark') {
    }
  }

  addBuff(type: string, turnsLeft: number, params: Record<string, number>): void {
    if (!this._data) return;
    const existing = this._data.buffs.find(b => b.type === type);
    if (existing) {
      existing.turnsLeft = Math.max(existing.turnsLeft, turnsLeft);
      Object.assign(existing.params, params);
    } else {
      this._data.buffs.push({ type, turnsLeft, params });
    }

    if (type === 'buff_move') {
      this._data.stats.move = this._data.baseStats.move + (params.amount ?? 0);
    }
    if (type === 'buff_attack') {
      this._data.stats.attack += params.amount ?? 0;
    }
  }

  resetForNewBattle(): void {
    if (!this._data) return;
    this._data.currentHp = this._data.maxHp;
    this._data.energy = this._data.maxEnergy;
    this._data.isAlive = true;
    this._data.buffs = [];
    this._data.shieldAmount = 0;
    this._data.hasMoved = false;
    this._data.hasActed = false;
    this._data.stats = { ...this._data.baseStats };
  }
}
