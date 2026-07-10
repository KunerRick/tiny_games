import { _decorator, Component, Node, Sprite, Color, tween, Vec3, Label } from 'cc';
import { GridPosition, GridController } from './GridController';
import { SkillConfig, getClassById, EnemyConfig, AIType } from '../config/GameData';

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
  passiveApplied: string[];
  aiBehavior: AIType;
  preMoveSkillUsed: boolean;
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

  @property({ type: Node, tooltip: '阵营光环节点' })
  factionGlow: Node = null;

  private _data: UnitData | null = null;
  private _isSelected: boolean = false;
  private _countering: boolean = false;

  private static readonly CLASS_COLORS: Record<string, Color> = {
    warrior: new Color(100, 180, 255),
    archer:  new Color(100, 220, 100),
    mage:    new Color(180, 100, 220),
    cleric:  new Color(240, 210, 80),
  };

  private static readonly CLASS_ICONS: Record<string, string> = {
    warrior: '\u2694',   // ⚔
    archer:  '\uD83C\uDFF9', // 🏹
    mage:    '\uD83D\uDD2E', // 🔮
    cleric:  '\u271D',   // ✝
  };

  initFromEnemyConfig(config: EnemyConfig, gridPos: GridPosition): void {
    this._data = {
      id: `e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: config.name,
      classId: config.id,
      isPlayer: false,
      stats: { ...config.stats },
      currentHp: config.stats.hp,
      maxHp: config.stats.hp,
      energy: 0,
      maxEnergy: 0,
      energyRegen: 0,
      baseStats: { ...config.stats },
      skills: [],
      gridPos: { ...gridPos },
      isAlive: true,
      hasMoved: false,
      hasActed: false,
      buffs: [],
      shieldAmount: 0,
      passiveApplied: [],
      aiBehavior: config.aiBehavior,
      preMoveSkillUsed: false,
    };

    this.updatePosition();

    if (this.selectionIndicator) {
      this.selectionIndicator.active = false;
    }

    this.setTintColor(new Color(255, 100, 100));
    this.setupFactionVisual();
    this.setupClassIcon();
  }

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
      passiveApplied: [],
      aiBehavior: 'aggressive',
      preMoveSkillUsed: false,
    };

    this.updatePosition();

    if (this.selectionIndicator) {
      this.selectionIndicator.active = false;
    }

    if (isPlayer) {
      const classColor = UnitController.CLASS_COLORS[classId];
      this.setTintColor(classColor ?? new Color(100, 180, 255));
    } else {
      this.setTintColor(new Color(255, 100, 100));
    }
    this.setupFactionVisual();
    this.setupClassIcon();
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
    if (selected && this.node?.isValid) {
      tween(this.node)
        .to(0.2, { scale: new Vec3(1.08, 1.08, 1) })
        .start();
    } else if (this.node?.isValid) {
      this.node.setScale(new Vec3(1, 1, 1));
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

  private setupFactionVisual(): void {
    if (!this.factionGlow) return;
    const glowSprite = this.factionGlow.getComponent(Sprite);
    if (!glowSprite) return;
    if (this._data?.isPlayer) {
      glowSprite.color = new Color(60, 140, 255, 100);
    } else {
      glowSprite.color = new Color(255, 60, 60, 100);
    }
    this.factionGlow.active = true;
  }

  private setupClassIcon(): void {
    if (!this.unitSprite) return;
    const classId = this._data?.classId;
    if (!classId) return;
    const icon = UnitController.CLASS_ICONS[classId];
    if (!icon) return;

    // 复用已有图标节点，避免重复创建
    let iconNode = this.unitSprite.getChildByName('ClassIcon');
    if (!iconNode) {
      iconNode = new Node('ClassIcon');
      const iconLabel = iconNode.addComponent(Label);
      iconLabel.fontSize = 32;
      iconLabel.color = Color.WHITE;
      iconLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      iconLabel.verticalAlign = Label.VerticalAlign.CENTER;
      // 居中于 unitSprite
      iconNode.setPosition(0, 0, 0);
      this.unitSprite.addChild(iconNode);
    }
    const iconLabel = iconNode.getComponent(Label);
    if (iconLabel) {
      iconLabel.string = icon;
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

  moveToPositionAnimated(pos: GridPosition, duration: number = 0.3, onComplete?: () => void): void {
    if (!this._data || !this.node?.isValid) {
      if (onComplete) onComplete();
      return;
    }
    this._data.gridPos = { ...pos };
    this._data.hasMoved = true;
    const targetX = (pos.col - 2.5) * GridController.CELL_SIZE;
    const targetY = (pos.row - 2.5) * GridController.CELL_SIZE;
    tween(this.node)
      .to(duration, { position: new Vec3(targetX, targetY, 0) })
      .call(() => { if (onComplete) onComplete(); })
      .start();
  }

  takeDamage(rawAmount: number, ignoreDefense: boolean = false, attacker?: UnitController): number {
    if (!this._data || !this._data.isAlive) return 0;
    
    const wasAlive = this._data.isAlive;

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

    if (attacker && wasAlive && !this._countering && !ignoreDefense && this.hasPassive('counter')) {
      this._countering = true;
      const counterDmg = Math.max(1, Math.floor(this._data.stats.attack * 0.5));
      // 反击伤害标记为 ignoreDefense=true，防止链式反击死循环
      attacker.takeDamage(counterDmg, true, this);
      this._countering = false;
    }

    return actualDamage;
  }

  hasPassive(skillId: string): boolean {
    return this._data?.skills.some(s => s.id === skillId) ?? false;
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

  peekSkill(skillIndex: number): SkillConfig | null {
    if (!this._data || skillIndex < 0 || skillIndex >= this._data.skills.length) return null;
    return this._data.skills[skillIndex];
  }

  useSkill(skillIndex: number, setActed: boolean = true): SkillConfig | null {
    if (!this._data || !this.canUseSkill(skillIndex)) return null;
    const skill = this._data.skills[skillIndex];
    this._data.energy -= skill.energyCost;
    if (setActed) {
      this._data.hasActed = true;
    }
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
      this._data.baseStats.defense += 1;
      this._data.stats.defense += 1;
      if (!this._data.passiveApplied.includes('toughness')) {
        this._data.passiveApplied.push('toughness');
      }
    }
    if (skillId === 'arcane_flow') {
      this._data.energyRegen += 1;
      if (!this._data.passiveApplied.includes('arcane_flow')) {
        this._data.passiveApplied.push('arcane_flow');
      }
    }
  }

  onTurnStart(allies?: UnitController[]): void {
    if (!this._data || !this._data.isAlive) return;

    for (let i = this._data.buffs.length - 1; i >= 0; i--) {
      const buff = this._data.buffs[i];
      if (buff.type === 'poison') {
        const poisonDmg = buff.params.damage ?? 1;
        this.takeDamage(poisonDmg, true);
      }
    }

    this._data.energy = Math.min(this._data.maxEnergy, this._data.energy + this._data.energyRegen);
    this._data.hasMoved = false;
    this._data.hasActed = false;
    this._data.preMoveSkillUsed = false;

    for (let i = this._data.buffs.length - 1; i >= 0; i--) {
      const buff = this._data.buffs[i];
      buff.turnsLeft--;
      if (buff.turnsLeft <= 0) {
        this.removeBuff(buff);
        this._data.buffs.splice(i, 1);
      }
    }

    for (const skill of this._data.skills) {
      if (skill.type !== 'passive' || skill.triggerCondition !== 'on_turn_start') continue;

      // 判断是否为每回合都触发的效果（光环类）
      const isAuraType = skill.effects.some(e =>
        e.type === 'passive_aura_heal'
      );
      // 非光环类永久被动只应用一次
      if (!isAuraType && this._data.passiveApplied.includes(skill.id)) continue;

      for (const effect of skill.effects) {
        switch (effect.type) {
          case 'passive_toughness':
            this._data.maxHp += effect.params.hp ?? 1;
            this._data.currentHp = Math.min(this._data.currentHp + (effect.params.hp ?? 1), this._data.maxHp);
            this._data.baseStats.defense += effect.params.defense ?? 1;
            this._data.stats.defense += effect.params.defense ?? 1;
            this._data.passiveApplied.push(skill.id);
            break;
          case 'passive_eagle_eye':
            this._data.baseStats.range += effect.params.range ?? 1;
            this._data.stats.range += effect.params.range ?? 1;
            this._data.passiveApplied.push(skill.id);
            break;
          case 'passive_energy_regen':
            this._data.energyRegen += effect.params.amount ?? 1;
            this._data.passiveApplied.push(skill.id);
            break;
          case 'passive_aura_heal': {
            if (allies) {
              const radius = effect.params.radius ?? 1;
              const amount = effect.params.amount ?? 1;
              for (const ally of allies) {
                if (ally !== this && ally.data?.isAlive) {
                  const dist = Math.abs(ally.data.gridPos.row - this._data.gridPos.row) +
                    Math.abs(ally.data.gridPos.col - this._data.gridPos.col);
                  if (dist <= radius) {
                    ally.heal(amount);
                  }
                }
              }
            }
            break;
          }
        }
      }
    }
  }

  private removeBuff(buff: BuffEntry): void {
    if (!this._data) return;
    if (buff.type === 'buff_move') {
      this._data.stats.move -= buff.params.amount ?? 0;
      this._data.stats.move = Math.max(this._data.baseStats.move, this._data.stats.move);
    }
    if (buff.type === 'buff_attack') {
      this._data.stats.attack -= buff.params.amount ?? 0;
      this._data.stats.attack = Math.max(this._data.baseStats.attack, this._data.stats.attack);
    }
  }

  addBuff(type: string, turnsLeft: number, params: Record<string, number>): void {
    if (!this._data) return;
    const existing = this._data.buffs.find(b => b.type === type);
    
    if (existing) {
      existing.turnsLeft = Math.max(existing.turnsLeft, turnsLeft);
    } else {
      this._data.buffs.push({ type, turnsLeft, params: { ...params } });
      
      if (type === 'buff_move') {
        this._data.stats.move += params.amount ?? 0;
      }
      if (type === 'buff_attack') {
        this._data.stats.attack += params.amount ?? 0;
      }
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
    this._data.preMoveSkillUsed = false;
    this._data.stats = { ...this._data.baseStats };
    // 不清空 passiveApplied — 永久被动（铁壁/鹰眼/魔力涌动）已写入 baseStats
    // 每次战斗开始时 onTurnStart 会通过 passiveApplied 检查避免重复应用
  }
}
