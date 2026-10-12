import { _decorator, Component, Node, Sprite, Color, tween, Vec3, Label, Tween, UITransform } from 'cc';
import { GridPosition, GridController } from './GridController';
import { SkillConfig, getClassById, EnemyConfig, AIType } from '../config/GameData';
import { ALPHA, CLASS_COLOR, COLOR, FACTION, FONT_ICON, applyFontAndColor, hex, hpBarColor } from '../config/Theme';

const { ccclass, property } = _decorator;

/** 单位技能位上限（升级/商店/事件都按此判定，避免各自写 3） */
export const MAX_SKILLS = 3;

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
  baseStats: { hp: number; attack: number; defense: number; move: number; range: number; maxEnergy: number };
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

  /** 血条尺寸（与 UnitPrefab 里 HpBar/HpFill 的设定值一致） */
  private static readonly HP_BAR_WIDTH = 50;
  private static readonly HP_BAR_HEIGHT = 6;
  /** 阵营光环边长（略大于单位，形成外圈光晕） */
  private static readonly GLOW_SIZE = 72;

  private _data: UnitData | null = null;
  private _isSelected: boolean = false;
  private _countering: boolean = false;
  private _selectTween: Tween<Node> | null = null;
  /** 血条填充（HpBar/HpFill 在 prefab 里 spriteFrame 为空、无人驱动，运行时补齐） */
  private _hpFill: Sprite | null = null;
  private _hpFillUi: UITransform | null = null;
  private _hpFillFullWidth: number = 50;

  onDestroy(): void {
    if (this._selectTween) {
      this._selectTween.stop();
      this._selectTween = null;
    }
  }

  private static readonly CLASS_COLORS: Record<string, Color> = {
    warrior: hex(CLASS_COLOR.warrior),
    archer:  hex(CLASS_COLOR.archer),
    mage:    hex(CLASS_COLOR.mage),
    cleric:  hex(CLASS_COLOR.cleric),
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
      baseStats: { ...config.stats, maxEnergy: 0 },
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

    // 敌人一律用阵营色（DANGER 红）。原先用 CLASS_COLOR.fallback（蓝），
    // 与玩家战士同色 —— 棋盘上无法一眼分清敌我。
    this.setTintColor(FACTION.ENEMY_TINT);
    this.setupFactionVisual();
    this.setupClassIcon();
    this.setupHealthBar();
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
      baseStats: { ...classConfig.stats, maxEnergy: classConfig.energy.max },
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
      this.setTintColor(classColor ?? hex(CLASS_COLOR.fallback));
    } else {
      this.setTintColor(FACTION.ENEMY_TINT);
    }
    this.setupFactionVisual();
    this.setupClassIcon();
    this.setupHealthBar();
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
    if (!this.node?.isValid) return;
    if (this._selectTween) {
      this._selectTween.stop();
      this._selectTween = null;
    }
    if (selected) {
      this._selectTween = tween(this.node)
        .to(0.2, { scale: new Vec3(1.08, 1.08, 1) })
        .start();
    } else {
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
    // UnitPrefab 里没有 factionGlow 节点，@property 也未绑定 —— 原先首行
    // `if (!this.factionGlow) return;` 直接早退，敌我双方都没有阵营光环。
    // 改为：绑定了就用绑定的，否则运行时补一个（与 ClassIcon 同一套路）。
    const glow = this.factionGlow ?? this.ensureRuntimeGlow();
    if (!glow) return;
    const glowSprite = glow.getComponent(Sprite);
    if (glowSprite) {
      glowSprite.color = this._data?.isPlayer ? FACTION.PLAYER_GLOW : FACTION.ENEMY_GLOW;
    }
    glow.active = true;
  }

  /** 运行时创建阵营光环（单位背后的光圈），仅在未绑定 @property 时使用 */
  private ensureRuntimeGlow(): Node | null {
    if (!this.unitSprite) return null;
    let glowNode = this.node.getChildByName('FactionGlow');
    if (!glowNode) {
      glowNode = new Node('FactionGlow');
      const ui = glowNode.addComponent(UITransform);
      ui.setContentSize(UnitController.GLOW_SIZE, UnitController.GLOW_SIZE);
      const sp = glowNode.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      const base = this.unitSprite.getComponent(Sprite);
      if (base?.spriteFrame) sp.spriteFrame = base.spriteFrame;
      this.node.addChild(glowNode);
      // 置为 node 的首个子节点 → 渲染在 unitSprite/血条之下，形成背景光圈
      glowNode.setSiblingIndex(0);
    }
    return glowNode;
  }

  /**
   * 补齐血条：HpBar/HpFill 在 prefab 里 spriteFrame 为空且全代码无引用，
   * 即使 active=true 也不渲染。这里用单位自身的贴图作为底图接通它，
   * 宽度按 HP 比例缩放 —— 棋盘上直接可读血量，不必只靠左侧小面板。
   */
  private setupHealthBar(): void {
    if (!this.unitSprite) return;
    const hpBar = this.node.getChildByName('HpBar');
    const hpFill = hpBar?.getChildByName('HpFill');
    if (!hpBar || !hpFill) return;

    const base = this.unitSprite.getComponent(Sprite);
    const bgSprite = hpBar.getComponent(Sprite);
    const fillSprite = hpFill.getComponent(Sprite);

    // 顺序要紧：先设 spriteFrame，再 sizeMode=CUSTOM，最后 setContentSize。
    // 反过来会被贴图原始尺寸（2×2）覆盖 —— 见 AGENTS.md 教训 C。
    if (bgSprite) {
      if (!bgSprite.spriteFrame && base?.spriteFrame) bgSprite.spriteFrame = base.spriteFrame;
      bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
      bgSprite.color = hex(COLOR.PANEL_BORDER, ALPHA.SOLID);
    }
    if (fillSprite) {
      if (!fillSprite.spriteFrame && base?.spriteFrame) fillSprite.spriteFrame = base.spriteFrame;
      fillSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    }

    const bgUi = hpBar.getComponent(UITransform);
    const fillUi = hpFill.getComponent(UITransform);
    // 容器 HpBar 居中于单位（锚点 0.5/0.5、x=0），填充 HpFill 左端贴合容器左缘：
    // 锚点 (0, 0.5) + x = -HP_BAR_WIDTH/2，缩宽度时右端后退、左缘恒定。
    // prefab 里 anchorPoint 是 (0, 0.5)（左对齐），配上之前的 x=0 会让整条血条
    // 右移半个身位（实测偏右 27px）；上一轮改成"容器与填充都居中"，导致掉血时
    // 从两端同时内收、读感像"血从中间被吃掉"。这里只把填充改为左端锚定。
    if (bgUi) {
      bgUi.setAnchorPoint(0.5, 0.5);
      bgUi.setContentSize(UnitController.HP_BAR_WIDTH, UnitController.HP_BAR_HEIGHT);
    }
    if (fillUi) {
      fillUi.setAnchorPoint(0, 0.5);
      fillUi.setContentSize(UnitController.HP_BAR_WIDTH, UnitController.HP_BAR_HEIGHT);
    }

    this._hpFill = fillSprite;
    this._hpFillUi = fillUi;
    this._hpFillFullWidth = UnitController.HP_BAR_WIDTH;
    this.updateHealthBar();
  }

  /** 按 currentHp/maxHp 刷新血条宽度与颜色（左端锚定：左缘恒定、右端后退） */
  private updateHealthBar(): void {
    if (!this._data || !this._hpFill || !this._hpFillUi) return;
    const ratio = this._data.maxHp > 0
      ? Math.max(0, Math.min(1, this._data.currentHp / this._data.maxHp))
      : 0;
    this._hpFillUi.setContentSize(this._hpFillFullWidth * ratio, this._hpFillUi.height);
    // 锚点是 (0, 0.5) → 位置 x = 容器左缘（-宽/2），宽度收缩时左缘不动
    this._hpFill.node.setPosition(-this._hpFillFullWidth / 2, 0, 0);
    this._hpFill.color = hpBarColor(this._data.currentHp, this._data.maxHp);
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
      applyFontAndColor(iconLabel, FONT_ICON, COLOR.TEXT_PRIMARY);
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
    const targetX = (pos.col - 2.5) * GridController.CELL_SIZE;
    const targetY = (pos.row - 2.5) * GridController.CELL_SIZE;
    tween(this.node)
      .to(duration, { position: new Vec3(targetX, targetY, 0) })
      .call(() => {
        if (this._data) {
          this._data.hasMoved = true;
        }
        if (onComplete) onComplete();
      })
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
    const isDead = this._data.currentHp <= 0;
    if (isDead) {
      this._data.currentHp = 0;
      this._data.isAlive = false;
      this._data.hasActed = true;
    }

    // 设计意图：即使本次伤害导致死亡，也允许触发一次反击（同归于尽/濒死反扑）
    // 反击在 _onDeath 之前执行，确保 buff 仍生效
    if (attacker && !this._countering && !ignoreDefense && this.hasPassive('counter')) {
      this._countering = true;
      const counterDmg = Math.max(1, Math.floor(this._data.stats.attack * 0.5));
      // 反击伤害标记为 ignoreDefense=true，防止链式反击死循环
      attacker.takeDamage(counterDmg, true, this);
      this._countering = false;
    }

    if (isDead) {
      this._onDeath();
    }

    this.updateHealthBar();
    return actualDamage;
  }

  hasPassive(skillId: string): boolean {
    return this._data?.skills.some(s => s.id === skillId) ?? false;
  }

  hasSkill(skillId: string): boolean {
    return this._data?.skills.some(s => s.id === skillId) ?? false;
  }

  private _onDeath(): void {
    if (this._selectTween) {
      this._selectTween.stop();
      this._selectTween = null;
    }
    if (this.node?.isValid) {
      this.node.active = false;
    }
    if (this.selectionIndicator) {
      this.selectionIndicator.active = false;
    }
    // 清除所有 buff，避免尸体残留状态
    if (this._data) {
      this._data.buffs = [];
      this._data.shieldAmount = 0;
    }
  }

  heal(amount: number): void {
    if (!this._data || !this._data.isAlive) return;
    this._data.currentHp = Math.min(this._data.maxHp, this._data.currentHp + amount);
    this.updateHealthBar();
  }

  healFull(): void {
    if (!this._data || !this._data.isAlive) return;
    this._data.currentHp = this._data.maxHp;
    this.updateHealthBar();
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
    if (!this._data || !this._data.isAlive || !this.canUseSkill(skillIndex)) return null;
    const skill = this._data.skills[skillIndex];
    this._data.energy -= skill.energyCost;
    if (setActed) {
      this._data.hasActed = true;
    }
    return skill;
  }

  /**
   * 学习技能。
   * - 已拥有同一技能 → 返回 false（原先会重复 push，技能栏出现重复项）
   * - 技能位已满 3 个 → 返回 false（原先静默 pop 掉最后一个，玩家在不知情时丢技能）
   * @returns 是否真的学会
   */
  addSkill(skill: SkillConfig): boolean {
    if (!this._data || !skill) return false;
    if (this.hasSkill(skill.id)) return false;
    if (this._data.skills.length >= MAX_SKILLS) return false;

    this._data.skills.push(skill);

    if (skill.type === 'passive') {
      this.applyPassiveEffect(skill);
    }
    return true;
  }

  /** 技能位是否还有空位（升级/商店/事件在选择落点前先问这里） */
  get hasFreeSkillSlot(): boolean {
    return (this._data?.skills.length ?? MAX_SKILLS) < MAX_SKILLS;
  }

  /** 已学技能数 */
  get skillCount(): number {
    return this._data?.skills.length ?? 0;
  }

  replaceSkill(index: number, newSkill: SkillConfig): void {
    if (!this._data || index < 0 || index >= this._data.skills.length) return;
    const oldSkill = this._data.skills[index];
    // 先回退旧被动效果，避免永久叠加
    if (oldSkill && oldSkill.type === 'passive') {
      this._revertPassiveEffect(oldSkill);
    }
    this._data.skills[index] = newSkill;
    if (newSkill.type === 'passive') {
      this.applyPassiveEffect(newSkill);
    }
  }

  private applyPassiveEffect(skill: SkillConfig): void {
    if (!this._data || this._data.passiveApplied.includes(skill.id)) return;
    let applied = false;
    for (const effect of skill.effects) {
      switch (effect.type) {
        case 'passive_toughness':
          const hp = effect.params.hp ?? 1;
          const def = effect.params.defense ?? 1;
          this._data.maxHp += hp;
          this._data.currentHp = Math.min(this._data.currentHp + hp, this._data.maxHp);
          this._data.baseStats.defense += def;
          this._data.stats.defense += def;
          applied = true;
          break;
        case 'passive_eagle_eye':
          const range = effect.params.range ?? 1;
          this._data.baseStats.range += range;
          this._data.stats.range += range;
          applied = true;
          break;
        case 'passive_energy_regen':
          const amount = effect.params.amount ?? 1;
          this._data.energyRegen += amount;
          applied = true;
          break;
      }
    }
    // 只有真正处理了属性加成才标记，避免 onTurnStart 中同名被动被跳过
    if (applied) {
      this._data.passiveApplied.push(skill.id);
    }
  }

  private _revertPassiveEffect(skill: SkillConfig): void {
    if (!this._data) return;
    const idx = this._data.passiveApplied.indexOf(skill.id);
    if (idx < 0) return;
    this._data.passiveApplied.splice(idx, 1);
    for (const effect of skill.effects) {
      switch (effect.type) {
        case 'passive_toughness':
          const hp = effect.params.hp ?? 1;
          const def = effect.params.defense ?? 1;
          this._data.maxHp = Math.max(1, this._data.maxHp - hp);
          this._data.currentHp = Math.min(this._data.currentHp, this._data.maxHp);
          this._data.baseStats.defense = Math.max(0, this._data.baseStats.defense - def);
          this._data.stats.defense = Math.max(0, this._data.stats.defense - def);
          break;
        case 'passive_eagle_eye':
          const range = effect.params.range ?? 1;
          this._data.baseStats.range = Math.max(0, this._data.baseStats.range - range);
          this._data.stats.range = Math.max(0, this._data.stats.range - range);
          break;
        case 'passive_energy_regen':
          const amount = effect.params.amount ?? 1;
          this._data.energyRegen = Math.max(0, this._data.energyRegen - amount);
          break;
      }
    }
  }

  onTurnStart(allies?: UnitController[]): void {
    if (!this._data || !this._data.isAlive) return;

    // 毒伤结算
    for (let i = this._data.buffs.length - 1; i >= 0; i--) {
      const buff = this._data.buffs[i];
      if (buff.type === 'poison') {
        const poisonDmg = buff.params.damage ?? 1;
        this.takeDamage(poisonDmg, true);
      }
    }
    // 毒伤可能导致死亡，此时不再继续重置状态
    if (!this._data.isAlive) return;

    this._data.energy = Math.min(this._data.maxEnergy, this._data.energy + this._data.energyRegen);
    this._data.hasMoved = false;
    this._data.hasActed = false;
    this._data.preMoveSkillUsed = false;

    // buff 衰减
    for (let i = this._data.buffs.length - 1; i >= 0; i--) {
      const buff = this._data.buffs[i];
      buff.turnsLeft--;
      if (buff.turnsLeft <= 0) {
        this.removeBuff(buff);
        this._data.buffs.splice(i, 1);
      }
    }

    // 回合开始触发类被动
    for (const skill of this._data.skills) {
      if (skill.type !== 'passive' || skill.triggerCondition !== 'on_turn_start') continue;

      const isAuraType = skill.effects.some(e => e.type === 'passive_aura_heal');
      // 永久成长类只执行一次，通过 applyPassiveEffect 统一处理并标记
      if (!isAuraType) {
        this.applyPassiveEffect(skill);
        continue;
      }

      // 光环类每回合执行
      for (const effect of skill.effects) {
        if (effect.type === 'passive_aura_heal' && allies) {
          const radius = effect.params.radius ?? 1;
          const amount = effect.params.amount ?? 1;
          for (const ally of allies) {
            if (ally !== this && ally.data?.isAlive) {
              const data = ally.data;
              const dist = Math.abs(data.gridPos.row - this._data.gridPos.row) +
                Math.abs(data.gridPos.col - this._data.gridPos.col);
              if (dist <= radius) {
                ally.heal(amount);
              }
            }
          }
        }
      }
    }
  }

  private removeBuff(buff: BuffEntry): void {
    if (!this._data) return;
    const amount = buff.params.amount ?? 0;
    this._applyBuffStatDelta(buff.type, -amount, true);
  }

  private _applyBuffStatDelta(type: string, delta: number, clamp: boolean = false): void {
    if (!this._data) return;
    if (type === 'buff_move') {
      this._data.stats.move += delta;
      if (clamp) this._data.stats.move = Math.max(this._data.baseStats.move, this._data.stats.move);
    }
    if (type === 'buff_attack') {
      this._data.stats.attack += delta;
      if (clamp) this._data.stats.attack = Math.max(this._data.baseStats.attack, this._data.stats.attack);
    }
    if (type === 'buff_defense') {
      this._data.stats.defense += delta;
      if (clamp) this._data.stats.defense = Math.max(this._data.baseStats.defense, this._data.stats.defense);
    }
    if (type === 'buff_range') {
      this._data.stats.range += delta;
      if (clamp) this._data.stats.range = Math.max(this._data.baseStats.range, this._data.stats.range);
    }
  }

  addBuff(type: string, turnsLeft: number, params: Record<string, number>): void {
    if (!this._data || !this._data.isAlive) return;
    const existing = this._data.buffs.find(b => b.type === type);

    if (existing) {
      existing.turnsLeft = Math.max(existing.turnsLeft, turnsLeft);
      // 刷新为更大的数值效果（先回退旧值再叠加新值）
      const oldAmount = existing.params.amount ?? 0;
      const newAmount = params.amount ?? 0;
      if (newAmount !== oldAmount) {
        existing.params.amount = newAmount;
        const delta = newAmount - oldAmount;
        this._applyBuffStatDelta(type, delta);
      }
    } else {
      this._data.buffs.push({ type, turnsLeft, params: { ...params } });
      this._applyBuffStatDelta(type, params.amount ?? 0);
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
