import { _decorator, Component, Node, Sprite, Color, tween, Vec3, Label, Tween, UITransform, UIOpacity } from 'cc';
import { GridPosition, GridController } from './GridController';
import { SkillConfig, getClassById, EnemyConfig, AIType, getEnemyAbilityById } from '../config/GameData';
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
  /** 敌人技能 id 列表（玩家单位为空；来自 EnemyConfig.abilityIds） */
  abilityIds: string[];
  /** 敌人技能冷却：id → 还需等待的回合数（0/缺省 = 可用；设计 §5.6 用冷却替代能量） */
  abilityCooldowns: { [id: string]: number };
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

  // ── 战斗演出时长（纯观感，与玩法规则无关） ───────────────────────────
  /** 一格/一次移动的时长（`BattleManager` 编排敌方回合时也按它排期） */
  static readonly MOVE_ANIM_DURATION = 0.22;
  /** 近战突刺：出击 / 回收 */
  private static readonly ANIM_LUNGE_OUT = 0.08;
  private static readonly ANIM_LUNGE_BACK = 0.12;
  /** 受击抖动（位移衰减振荡）总时长 */
  private static readonly ANIM_SHAKE = 0.18;
  /** 瞬移 / 击退 / 撤退的位移补间时长 */
  private static readonly ANIM_SLIDE = 0.16;
  /** 蓄力提示（施法 / 放技能）总时长 */
  private static readonly ANIM_CAST = 0.14;
  /** 阵亡演出总时长（弹一下 → 塌陷淡出） */
  private static readonly ANIM_DEATH = 0.30;
  /**
   * 阵亡演出对外时长（`BattleManager` 排到 Victory/Defeat 结算用的等待量）。
   * 故意比 `ANIM_DEATH` 多一点：结算面板出现前让尸体先消失干净。
   */
  static readonly DEATH_ANIM_DURATION = 0.34;

  private _data: UnitData | null = null;
  private _isSelected: boolean = false;
  private _countering: boolean = false;
  private _selectTween: Tween<Node> | null = null;
  /** 血条填充（HpBar/HpFill 在 prefab 里 spriteFrame 为空、无人驱动，运行时补齐） */
  private _hpFill: Sprite | null = null;
  private _hpFillUi: UITransform | null = null;
  private _hpFillFullWidth: number = 50;

  // ── 战斗演出状态 ───────────────────────────────────────────────────
  /** 单位精灵的本色（`setTintColor` 同步刷新）：闪白/闪红之后必须还原，否则色调永久变样 */
  private _tintBase: Color | null = null;
  private _moveTween: Tween<Node> | null = null;
  private _shakeTween: Tween<Node> | null = null;
  private _lungeTween: Tween<Node> | null = null;
  private _flashTween: Tween<Sprite> | null = null;
  private _castTween: Tween<Node> | null = null;
  private _deathTween: Tween<Node> | null = null;
  private _fadeTween: Tween<UIOpacity> | null = null;
  private _uiOpacity: UIOpacity | null = null;
  /** 突刺期间位移被占用：此时受击只闪不抖（两者都写 node.position，会互相抢） */
  private _lungeActive: boolean = false;
  /** 阵亡演出进行中（幂等标记，防止 takeDamage 与 checkBattleEnd 重复触发） */
  private _deathPlaying: boolean = false;
  /**
   * 同阵营单位列表的提供者（由 BattleManager 注入）。
   * 仅用于**光环类被动**（如盾兵的"盾墙：相邻友方受伤 -1"）—— `takeDamage`
   * 需要查相邻友军，而它拿不到战场数组。
   */
  private _allyProvider: (() => UnitController[]) | null = null;

  onDestroy(): void {
    // 只停 JS 引用持有的补间，不访问任何 @property(Node) —— 场景销毁时可能已是 null
    if (this._selectTween) {
      this._selectTween.stop();
      this._selectTween = null;
    }
    for (const t of [this._moveTween, this._shakeTween, this._lungeTween, this._castTween, this._deathTween]) {
      if (t) t.stop();
    }
    this._moveTween = null;
    this._shakeTween = null;
    this._lungeTween = null;
    this._castTween = null;
    this._deathTween = null;
    if (this._flashTween) {
      this._flashTween.stop();
      this._flashTween = null;
    }
    if (this._fadeTween) {
      this._fadeTween.stop();
      this._fadeTween = null;
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
      abilityIds: [...(config.abilityIds ?? [])],
      abilityCooldowns: {},
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
      abilityIds: [],
      abilityCooldowns: {},
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
    // 蓄力脉冲也在写 scale。脉冲正在跑时**不要打断它**：技能结算完紧接着就会取消选中
    // （本回合结束），在这里 stop 会让脉冲永远停在第一帧、看起来"放技能没动静"。
    // 交给它自己收尾：playCastCue 的回调按"收尾那一刻"的选中态把缩放归位。
    if (this._castTween) return;
    if (selected) {
      this._selectTween = tween(this.node)
        .to(0.2, { scale: new Vec3(1.08, 1.08, 1) })
        .start();
    } else {
      this.node.setScale(new Vec3(1, 1, 1));
    }
  }

  private setTintColor(color: Color): void {
    // 记录本色：闪白/闪红之后要还原到它（见 flashSprite），否则色调被永久改掉
    this._tintBase = color.clone();
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
  /** 外部改动 maxHp 后刷新血条（如天赋加成，见 TinyVanguardMain.applyTalentsToParty） */
  refreshHealthBarVisual(): void {
    this.updateHealthBar();
  }

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

  /** 网格坐标 → 节点本地坐标（棋盘 6×6，原点在棋盘中心） */
  positionForGrid(pos: GridPosition): Vec3 {
    return new Vec3(
      (pos.col - 2.5) * GridController.CELL_SIZE,
      (pos.row - 2.5) * GridController.CELL_SIZE,
      0
    );
  }

  private updatePosition(): void {
    if (this._data) {
      this.node.setPosition(this.positionForGrid(this._data.gridPos));
    }
  }

  setGridPosition(pos: GridPosition): void {
    if (!this._data) return;
    this._data.gridPos = { ...pos };
    this._data.hasMoved = true;
    this.updatePosition();
  }

  /**
   * 移动到位（战斗中的"走过去"）。手感要点：
   * - **先冲后缓**：前 70% 用 `quadOut` 冲出去，后 30% 用 `sineOut` 收速落位，
   *   读起来是"落脚"而不是"匀速滑行"（原先整段 `linear`，正是"僵硬"的来源之一）；
   * - 已经在目标格时**不补间、直接回调**（原先会白跑一段 0.3s 的空补间，敌方
   *   "原地不动也要等半秒"就是这个）；
   * - 以下语义与原实现保持一致，改动会波及玩法：`gridPos` 在**开始时**就更新
   *   （判定/射程/AI 在补间期间就要读到新坐标），`hasMoved` 在**结束时**才置位
   *   （调用方的回调依赖它）。
   */
  moveToPositionAnimated(
    pos: GridPosition,
    duration: number = UnitController.MOVE_ANIM_DURATION,
    onComplete?: () => void
  ): void {
    if (!this._data || !this.node?.isValid) {
      if (onComplete) onComplete();
      return;
    }
    this._data.gridPos = { ...pos };
    const target = this.positionForGrid(pos);
    this._stopMoveTween();
    const finish = (): void => {
      this._moveTween = null;
      if (this.node?.isValid) this.node.setPosition(target);
      if (this._data) this._data.hasMoved = true;
      if (onComplete) onComplete();
    };
    const from = this.node.position;
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    if (duration <= 0 || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) {
      finish();
      return;
    }
    // 中途点留 18% 的余量给第二段收速，避免"冲到位再抖一下"
    const mid = new Vec3(target.x - dx * 0.18, target.y - dy * 0.18, 0);
    this._moveTween = tween(this.node)
      .to(duration * 0.7, { position: mid }, { easing: 'quadOut' })
      .to(duration * 0.3, { position: target }, { easing: 'sineOut' })
      .call(finish)
      .start();
  }

  /**
   * 位移（击退 / 撤退 / 瞬移换位）：**逻辑位置立即生效**，只把视图补间过去。
   * 和 `moveToPositionAnimated` 的区别是刻意的 —— 这些是被外力搬动或瞬移，
   * 不该让判定等动画，也不该让单位"慢慢走过去"。
   */
  slideToPosition(
    pos: GridPosition,
    duration: number = UnitController.ANIM_SLIDE,
    onComplete?: () => void
  ): void {
    if (!this._data || !this.node?.isValid) {
      if (onComplete) onComplete();
      return;
    }
    this._data.gridPos = { ...pos };
    this._data.hasMoved = true;
    const target = this.positionForGrid(pos);
    this._stopMoveTween();
    if (duration <= 0) {
      this.node.setPosition(target);
      if (onComplete) onComplete();
      return;
    }
    this._moveTween = tween(this.node)
      .to(duration, { position: target }, { easing: 'sineOut' })
      .call(() => {
        this._moveTween = null;
        if (this.node?.isValid) this.node.setPosition(target);
        if (onComplete) onComplete();
      })
      .start();
  }

  /**
   * 攻击演出。近战：朝目标方向突刺一下再收回，`onImpact` 在**突刺顶点**回调 ——
   * 伤害数字/受击抖动应该排在"打到"的那一刻，而不是和出手同时。
   * 远程（射程 > 1）：只闪一下白，射程越远越不该有"扑上去"的错觉。
   */
  playAttackAnim(targetPos: GridPosition | null, onImpact?: () => void): void {
    if (!this._data || !this.node?.isValid) {
      if (onImpact) onImpact();
      return;
    }
    const isRanged = (this._data.stats.range ?? 1) > 1;
    if (isRanged || !targetPos) {
      this.flashSprite(Color.WHITE.clone(), 0.12);
      if (onImpact) onImpact();
      return;
    }

    const base = this.positionForGrid(this._data.gridPos);
    const dx = targetPos.col - this._data.gridPos.col;
    const dy = targetPos.row - this._data.gridPos.row;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // 只冲 0.42 个身位：够表达"扑上去"，又不至于盖住目标格上的单位
    const dart = GridController.CELL_SIZE * 0.42;
    const apex = new Vec3(base.x + (dx / len) * dart, base.y + (dy / len) * dart, 0);

    this._stopMoveTween();
    this._stopShakeTween();
    this.node.setPosition(base);
    if (this._lungeTween) {
      this._lungeTween.stop();
      this._lungeTween = null;
    }
    this._lungeActive = true;
    this._lungeTween = tween(this.node)
      .to(UnitController.ANIM_LUNGE_OUT, { position: apex }, { easing: 'quadOut' })
      .call(() => {
        if (onImpact) onImpact();
      })
      .to(UnitController.ANIM_LUNGE_BACK, { position: base }, { easing: 'sineInOut' })
      .call(() => {
        this._lungeActive = false;
        this._lungeTween = null;
        if (this.node?.isValid) this.node.setPosition(base);
      })
      .start();
  }

  /** 受击反馈：先闪红（一定会发生），位移抖动只在没有别的补间占用 position 时才做 */
  playHitReaction(): void {
    if (!this._data || !this.node?.isValid) return;
    this.flashSprite(new Color(255, 92, 92, 255), 0.16);
    // 突刺/移动期间 position 已被别人驱动，再叠一层抖动会互相抢（抖动会盖掉突刺）
    if (this._lungeActive || this._moveTween) return;
    this._stopShakeTween();
    const base = this.positionForGrid(this._data.gridPos);
    const dx = GridController.CELL_SIZE * 0.09 * (this._data.isPlayer ? -1 : 1);
    this._shakeTween = tween(this.node)
      .to(UnitController.ANIM_SHAKE * 0.25, { position: new Vec3(base.x + dx, base.y, 0) }, { easing: 'quadOut' })
      .to(UnitController.ANIM_SHAKE * 0.30, { position: new Vec3(base.x - dx * 0.6, base.y, 0) }, { easing: 'sineInOut' })
      .to(UnitController.ANIM_SHAKE * 0.45, { position: base }, { easing: 'sineOut' })
      .call(() => {
        this._shakeTween = null;
        if (this.node?.isValid) this.node.setPosition(base);
      })
      .start();
  }

  /** 施法/放技能前的蓄力提示：轻轻一胀 + 一层淡蓝闪光（调用方随后再结算效果） */
  playCastCue(): void {
    if (!this._data || !this.node?.isValid) return;
    this.flashSprite(new Color(120, 200, 255, 255), 0.18);
    if (this._castTween) {
      this._castTween.stop();
      this._castTween = null;
    }
    // 第二腿回落的目标是"创建时"的选中态，但脉冲期间选中态可能已经变了（技能结算后本回合
    // 结束 → 单位被取消选中），所以收尾时按**此刻**的选中态再归一次位，避免缩放停在
    // 中间值（差了选中缩放 1.08 与常态 1.0 之间的 0.08）。
    const rest = this._isSelected ? new Vec3(1.08, 1.08, 1) : new Vec3(1, 1, 1);
    this._castTween = tween(this.node)
      .to(UnitController.ANIM_CAST * 0.5, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'quadOut' })
      .to(UnitController.ANIM_CAST * 0.5, { scale: rest }, { easing: 'sineInOut' })
      .call(() => {
        this._castTween = null;
        if (this.node?.isValid) {
          this.node.setScale(this._isSelected ? new Vec3(1.08, 1.08, 1) : new Vec3(1, 1, 1));
        }
      })
      .start();
  }

  /**
   * 阵亡演出：闪白 → 弹一下 → 塌陷 + 上飘 + 淡出 → 隐藏节点。
   * 幂等（`_deathPlaying`）：`takeDamage` 和 `checkBattleEnd` 都可能触发它，
   * 重复进入只会白跑一遍补间。
   */
  playDeath(): void {
    if (this._deathPlaying || !this.node?.isValid) return;
    this._deathPlaying = true;
    this._stopMoveTween();
    this._stopShakeTween();
    if (this._castTween) {
      this._castTween.stop();
      this._castTween = null;
    }
    // 不主动停 `_lungeTween`：它可能是"正在执行的这一帧"（近战突刺顶点里被打死，
    // 例如同归于尽的反击）。在自己的回调里 stop 自己会让剩下那一段的归属变得
    // 不可预期；而它只写 position，且**注册早于**死亡补间 → 死亡补间每帧后写、
    // 天然覆盖它，0.12s 后它自己收尾（含 `_lungeActive = false`）。
    this.flashSprite(Color.WHITE.clone(), 0.1);

    const base = this.positionForGrid(this._data?.gridPos ?? { row: 0, col: 0 });
    if (this._deathTween) {
      this._deathTween.stop();
      this._deathTween = null;
    }
    this._deathTween = tween(this.node)
      .to(UnitController.ANIM_DEATH * 0.3, { scale: new Vec3(1.18, 1.18, 1) }, { easing: 'quadOut' })
      .to(
        UnitController.ANIM_DEATH * 0.7,
        { scale: new Vec3(0.3, 0.3, 1), position: new Vec3(base.x, base.y + 14, 0) },
        { easing: 'quadIn' }
      )
      .call(() => {
        this._deathTween = null;
        // 演出结束才真正隐藏（原先在 takeDamage 同帧就 active=false，看不到任何阵亡过程）
        if (this.node?.isValid) this.node.active = false;
      })
      .start();

    const opacity = this.ensureOpacity();
    if (opacity) {
      if (this._fadeTween) {
        this._fadeTween.stop();
        this._fadeTween = null;
      }
      this._fadeTween = tween(opacity)
        .to(UnitController.ANIM_DEATH, { opacity: 0 }, { easing: 'quadIn' })
        .call(() => {
          this._fadeTween = null;
        })
        .start();
    }
  }

  /** 阵亡演出是否在进行中（外部据此决定"这个单位還能不能被当作可点目标"） */
  get isDeathPlaying(): boolean {
    return this._deathPlaying;
  }

  /**
   * 复位所有演出状态（新战斗 / 复活时调用）。必须逐项还原 —— 残留的
   * scale / 透明度 / 位移 / 闪光色都会跨战斗带过去。
   */
  resetVisualState(): void {
    this._stopMoveTween();
    this._stopShakeTween();
    if (this._lungeTween) {
      this._lungeTween.stop();
      this._lungeTween = null;
    }
    this._lungeActive = false;
    if (this._castTween) {
      this._castTween.stop();
      this._castTween = null;
    }
    if (this._deathTween) {
      this._deathTween.stop();
      this._deathTween = null;
    }
    if (this._fadeTween) {
      this._fadeTween.stop();
      this._fadeTween = null;
    }
    if (this._flashTween) {
      this._flashTween.stop();
      this._flashTween = null;
    }
    this._deathPlaying = false;
    if (!this.node?.isValid) return;
    this.node.setScale(new Vec3(1, 1, 1));
    if (this._data) this.node.setPosition(this.positionForGrid(this._data.gridPos));
    if (this._uiOpacity?.isValid) this._uiOpacity.opacity = 255;
    const sprite = this.unitSprite?.getComponent(Sprite);
    if (sprite && this._tintBase) sprite.color = this._tintBase.clone();
  }

  private _stopMoveTween(): void {
    if (this._moveTween) {
      this._moveTween.stop();
      this._moveTween = null;
    }
  }

  private _stopShakeTween(): void {
    if (this._shakeTween) {
      this._shakeTween.stop();
      this._shakeTween = null;
    }
  }

  private ensureOpacity(): UIOpacity | null {
    if (!this.node?.isValid) return null;
    if (!this._uiOpacity || !this._uiOpacity.isValid) {
      this._uiOpacity = this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);
    }
    return this._uiOpacity;
  }

  /**
   * 把单位精灵短暂染成某色再还原。
   * 关键：还原目标是 `_tintBase`（职业/阵营本色），不是"当前色" ——
   * 否则闪白一次就会把战士的蓝、敌人的红永久洗掉。
   */
  private flashSprite(color: Color, duration: number): void {
    const sprite = this.unitSprite?.getComponent(Sprite);
    if (!sprite) return;
    const base = this._tintBase ?? sprite.color.clone();
    if (this._flashTween) {
      this._flashTween.stop();
      this._flashTween = null;
    }
    sprite.color = color.clone();
    this._flashTween = tween(sprite)
      .to(duration, { color: base.clone() }, { easing: 'linear' })
      .call(() => {
        this._flashTween = null;
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

    // 盾墙光环（盾兵被动）：相邻友方少受伤害（允许减到 0 = 完全挡下）
    const wallGuard = this.shieldWallGuard();
    if (wallGuard > 0) {
      actualDamage = Math.max(0, actualDamage - wallGuard);
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
    } else {
      // 受击反馈（闪红 + 抖动）。放在这里而不是 executeAttack 里：
      // 反击、毒伤、AOE 走的都是 takeDamage，一处接线全局生效。
      this.playHitReaction();
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

  /** 注入同阵营单位列表（光环类被动查相邻友军用；由 BattleManager 接线） */
  setAllyProvider(provider: (() => UnitController[]) | null): void {
    this._allyProvider = provider;
  }

  /** 是否拥有某个敌人技能（敌人技能存在 abilityIds，不进 skills，避免被玩家学习/显示） */
  hasAbility(abilityId: string): boolean {
    return this._data?.abilityIds.includes(abilityId) ?? false;
  }

  /** 该敌人技能是否已冷却完毕 */
  isAbilityReady(abilityId: string): boolean {
    return (this._data?.abilityCooldowns[abilityId] ?? 0) <= 0;
  }

  /** 释放后进入冷却（设计 §5.6：敌人不用能量，精英/Boss 技能走固定冷却） */
  startAbilityCooldown(abilityId: string, cooldown: number): void {
    if (!this._data) return;
    this._data.abilityCooldowns[abilityId] = Math.max(1, cooldown);
  }

  /** 回合开始时递减技能冷却 */
  private tickAbilityCooldowns(): void {
    if (!this._data) return;
    for (const id of Object.keys(this._data.abilityCooldowns)) {
      this._data.abilityCooldowns[id] = Math.max(0, this._data.abilityCooldowns[id] - 1);
    }
  }

  /**
   * 盾墙光环的减伤值：若存在**相邻**且带 `enemy_shield_wall` 的友军，取其 amount（只减一次）。
   * 语义按设计 §5.1"相邻友方受伤 -1" —— 提供者本人不享受自己的光环。
   */
  private shieldWallGuard(): number {
    if (!this._data || !this._allyProvider) return 0;
    const cfg = getEnemyAbilityById('enemy_shield_wall');
    const amount = cfg?.effects.find(e => e.type === 'shield_wall')?.params.amount ?? 1;
    for (const ally of this._allyProvider()) {
      if (!ally || ally === this || !ally.data?.isAlive || !ally.hasAbility('enemy_shield_wall')) continue;
      const dist = Math.abs(ally.data.gridPos.row - this._data.gridPos.row) +
        Math.abs(ally.data.gridPos.col - this._data.gridPos.col);
      if (dist <= 1) return amount;
    }
    return 0;
  }

  private _onDeath(): void {
    if (this._selectTween) {
      this._selectTween.stop();
      this._selectTween = null;
    }
    if (this.selectionIndicator) {
      this.selectionIndicator.active = false;
    }
    // 清除所有 buff，避免尸体残留状态
    if (this._data) {
      this._data.buffs = [];
      this._data.shieldAmount = 0;
    }
    // 演出结束后才隐藏节点（原先在此处同帧 active=false，阵亡是"啪一下就没了"）
    this.playDeath();
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
    // 敌人技能冷却递减（玩家单位没有 abilityIds，空转无副作用）
    this.tickAbilityCooldowns();
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
    // 先复位演出状态：上一场残留的缩放/透明度/闪光色/阵亡标记都会跟着节点进新战斗
    this.resetVisualState();
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
