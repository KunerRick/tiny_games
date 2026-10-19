import { _decorator, Component, Node, Label, Button, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import { COLOR, CLASS_COLOR, CONTROL, FONT_BODY, FONT_CAPTION, FONT_TINY, applyFont, applyFontAndColor, hex, applyButtonTheme, ButtonVariant, stripVariationSelectors } from './config/Theme';
import { RouteMapUI, RouteNode } from './ui/RouteMapUI';
import { BattleManager, BattleResult, UnitActionPhase } from './battle/BattleManager';
import { UpgradeUI, UpgradeOption } from './ui/UpgradeUI';
import { EventUI } from './ui/EventUI';
import { BattleUI } from './ui/BattleUI';
import { TalentUI, TalentUiHost } from './ui/TalentUI';
import { SaveManager, RunData, ensureProgress, expToNext } from './ui/SaveManager';
import {
  CardSpec, UnitRowSpec, renderCardGrid, renderUnitRows,
  CARD_W, CARD_H, OPTION_W, OPTION_H, ROW_W, ROW_H,
} from './ui/PanelCards';
import {
  CLASSES, EVENTS, getClassById, getSkillById, getRandomSkillsFromPool,
  SkillConfig, SKILLS, TALENTS
} from './config/GameData';
import { UnitController } from './battle/UnitController';
import { SceneManager } from '../../../common/managers/SceneManager';

const { ccclass, property } = _decorator;

const CLASS_ORDER = ['warrior', 'archer', 'mage', 'cleric'];

/**
 * 队伍人数上限（设计 §1/§2.2：玩家指挥一支 **3 人**小队）。
 * 原实现只要 `>= 3` 就能开局，可以选满 4 个职业 → 按钮文案出现"(4/3)"这种自相矛盾读数，
 * 且 4 人明显更简单（多一具肉盾、每场多一张升级卡），而敌人数量/强度不随人数变化。
 */
const SQUAD_SIZE = 3;

/** 技能卡图标：按目标类型/主动被动推导（SkillConfig 无 icon 字段） */
function skillIconOf(skill: SkillConfig): string {
  if (skill.type === 'passive') return '\uD83D\uDEE1';        // 🛡
  switch (skill.targetType) {
    case 'aoe': return '\uD83D\uDCA5';                              // 💥
    case 'ally': return '\u2764';                             // ❤
    case 'tile': return '\uD83C\uDF00';                             // 🌀
    case 'self': return '\u2728';                                   // ✨
    default: return '\u2694';                                 // ⚔
  }
}

/** 属性增益卡图标 */
const BUFF_ICON: Record<string, string> = {
  hp: '\u2764',      // ❤
  attack: '\u2694',  // ⚔
  energy: '\u26A1',        // ⚡
};

/** 商店：技能卡基准价（买不起会写明原因，不再静默置灰） */
const SHOP_SKILL_PRICE = 12;
/** 商店：全队永久 +1 攻击的基准价 */
const SHOP_TEAM_PRICE = 15;

/** 圣泉第二步的提示文案（下标与 renderRest 的选项一一对应） */
const REST_OPTION_TITLE: Record<number, string> = {
  0: '选择要淬炼的英雄',
  1: '选择要精进的英雄',
  2: '选择要传授秘技的英雄',
};

/**
 * 战斗经验结算参数。
 *
 * 改造前没有经验概念：每场胜利后 `generateUpgradeOptions()` 给**每个存活单位**
 * 各弹一次三选一 —— 相当于"每人每场都升级"，成长曲线完全平掉、强弱战斗也没有区别。
 * 现在经验按「参战 + 击杀 + 输出」分配到人，只有跨过阈值的单位才拿到升级。
 */
const EXP_PARTICIPATE = 2;
const EXP_PER_KILL = 5;
/** 每造成 10 点伤害折算 1 点经验 */
const EXP_PER_DAMAGE = 10;

export type GameState =
  | 'route_map' | 'deploy' | 'battle' | 'upgrade'
  | 'shop' | 'rest' | 'event' | 'game_over' | 'run_victory' | 'class_select';

@ccclass('TinyVanguardMain')
export class TinyVanguardMain extends Component {
  @property({ type: RouteMapUI, tooltip: '路线图UI' })
  routeMapUI: RouteMapUI = null;

  @property({ type: BattleManager, tooltip: '战斗管理器' })
  battleManager: BattleManager = null;

  @property({ type: BattleUI, tooltip: '战斗UI' })
  battleUI: BattleUI = null;

  @property({ type: UpgradeUI, tooltip: '升级UI' })
  upgradeUI: UpgradeUI = null;

  @property({ type: EventUI, tooltip: '事件UI' })
  eventUI: EventUI = null;

  @property({ type: Node, tooltip: '游戏结束面板' })
  gameOverPanel: Node = null;

  @property({ type: Label, tooltip: '游戏结束文字' })
  gameOverLabel: Label = null;

  @property({ type: Node, tooltip: '胜利面板' })
  victoryPanel: Node = null;

  @property({ type: Node, tooltip: '商店面板' })
  shopPanel: Node = null;

  @property({ type: Node, tooltip: '休息面板' })
  restPanel: Node = null;

  @property({ type: Label, tooltip: '金币显示' })
  goldLabel: Label = null;

  @property({ type: Label, tooltip: '回合显示（仅战斗中可见）' })
  turnLabel: Label = null;

  @property({ type: Button, tooltip: '继续按钮（存档）' })
  continueButton: Button = null;

  @property({ type: Node, tooltip: '初始职业选择面板' })
  classSelectPanel: Node = null;

  private _state: GameState = 'class_select';
  private _selectedClasses: string[] = [];
  private _runData: RunData = {
    currentRouteNode: 0,
    playerClasses: [],
    unitSkills: {},
    gold: 0,
    honor: 0,
    honorSpent: 0,
    talents: [],
    difficulty: 'normal',
    unlockedClasses: ['warrior', 'archer', 'mage', 'cleric'],
    unlockedSkills: [],
  };
  private _currentNode: RouteNode | null = null;
  private _currentEnemyCount: number = 0;
  private _currentDifficulty: number = 0;
  private _battleCount: number = 0;
  /**
   * 本局开始时的荣誉值快照。
   * `honor` 是**跨局累积**的（存在 meta 里），所以结算面板不能拿绝对值当"本局收益"。
   */
  private _honorAtRunStart: number = 0;
  /** 荣誉天赋面板（运行时构建，见 TalentUI） */
  private _talentUI: TalentUI | null = null;

  /**
   * 本场战斗后**真正升级**的单位（只有它们会拿到升级三选一）。
   * 见 `awardBattleExp`：经验按参战/击杀/输出分配到人，达不到阈值就不升级。
   */
  private _leveledUnits: UnitController[] = [];
  /** 圣泉：当前选中的强化项下标（-1 = 停在"选强化"步骤，≥0 = 已进入"指定英雄"步骤） */
  private _restOptionIndex: number = -1;
  /** 商店/圣泉的操作反馈（面板内一行文字，解决"点了没反应"） */
  private _panelFeedback: string = '';

  /** 当前所在**层**（1..总层数）。路线图是 12 节点 7 层，同一层只能走一个节点 */
  private get routeNo(): number {
    return (this._currentNode?.row ?? 0) + 1;
  }

  /** 路线图总层数（分母口径，与 RouteMapUI.updateProgressLabel 一致） */
  private get totalRouteLayers(): number {
    const rows = new Set((this.routeMapUI?.nodes ?? []).map(n => n.row));
    return rows.size > 0 ? rows.size : 7;
  }

  onLoad(): void {
    if (this.gameOverPanel) this.gameOverPanel.active = false;
    if (this.victoryPanel) this.victoryPanel.active = false;
    if (this.shopPanel) this.shopPanel.active = false;
    if (this.restPanel) this.restPanel.active = false;
    if (this.classSelectPanel) {
      this.classSelectPanel.active = true;
      this.setupClassSelectionUI();
    }

    if (this.battleManager?.gridController?.node) {
      this.battleManager.gridController.node.active = false;
    }
    // HudTop 挂在 Canvas 根级，必须在开局就按状态机收起来。
    // 原先只关 goldLabel，turnLabel 无人关（BattleUI 节点是 inactive，
    // 其 onLoad 不执行）→ 职业选择/路线图/通关界面残留「回合 1」。
    this.setHudVisible(false, false);

    const meta = SaveManager.loadMeta();
    if (meta) {
      this._runData.honor = meta.honor;
      this._runData.honorSpent = meta.honorSpent ?? 0;
      this._runData.talents = meta.talents;
      this._runData.unlockedClasses = meta.unlockedClasses;
      this._runData.unlockedSkills = meta.unlockedSkills;
    }

    if (SaveManager.hasSavedRun()) {
      if (this.continueButton) {
        this.continueButton.node.active = true;
        this.continueButton.node.on(Button.EventType.CLICK, this.onContinueRun, this);
      }
    }

    if (this.classSelectPanel) {
      const startBtnNode = this.classSelectPanel.getChildByName('StartBtn');
      if (startBtnNode) {
        const startBtn = startBtnNode.getComponent(Button);
        if (startBtn) {
          startBtn.node.on(Button.EventType.CLICK, this.startClassSelect, this);
        }
      }
    }

    if (this.gameOverPanel) {
      const restartBtnNode = this.gameOverPanel.getChildByName('RestartButton');
      if (restartBtnNode) {
        const restartBtn = restartBtnNode.getComponent(Button);
        if (restartBtn) {
          restartBtn.node.on(Button.EventType.CLICK, this.restartFromRouteMap, this);
        }
      }
    }

    this.bindShopPanelEvents();
    this.bindRestPanelEvents();
    this.bindRunVictoryPanel();
    this.applyPanelButtonThemes();
    // 荣誉天赋入口（设计 §6.2）：跨局消费荣誉，放在职业选择页
    this.ensureTalentEntry();
    // B5⑤：底板对齐内容包围盒 —— 必须放在按钮规格统一与天赋入口**之后**，
    // 否则按钮变高、或天赋按钮后加进来时会超出已算好的底板
    this.fitPanelBackground(this.classSelectPanel);
    this.fitPanelBackground(this.shopPanel);
    this.fitPanelBackground(this.restPanel);
  }

  /**
   * 统一各面板按钮的过渡色（P5 配色收敛）。
   * Button 的 COLOR 过渡若沿用引擎默认值，hover/disabled 会显示成灰
   * （实测 StartBtn 禁用时显示 7c7c7c，而不是我们设的 PRIMARY_DISABLED），
   * 因此四个状态色都必须显式写令牌。
   */
  private applyPanelButtonThemes(): void {
    const setBtn = (node: Node | null, variant: ButtonVariant): void => {
      if (!node?.isValid) return;
      applyButtonTheme(node.getComponent(Button), variant);
    };
    // 职业选择：开始游戏=主操作；四个职业按钮用 SCALE（选中态由代码控色）
    if (this.classSelectPanel) {
      setBtn(this.classSelectPanel.getChildByName('StartBtn'), 'primary');
    }
    setBtn(this.continueButton?.node ?? null, 'secondary');
    // 商店 / 圣泉：改造后各自只剩一个"离开"按钮，商品与强化项都是运行时卡片
    // （卡片自带 Button，过渡色在 PanelCards 里统一为 secondary）
    if (this.shopPanel) {
      setBtn(this.shopPanel.getChildByName('CloseBtn'), 'danger');
    }
    if (this.restPanel) {
      setBtn(this.restPanel.getChildByName('SkipBtn'), 'secondary');
    }
    // 结算面板
    if (this.gameOverPanel) {
      setBtn(this.gameOverPanel.getChildByName('RestartButton'), 'primary');
    }
    if (this.victoryPanel) {
      setBtn(this.victoryPanel.getChildByName('ReturnBtn'), 'primary');
    }
    // 商店/休息面板的按钮尺寸与字号不在改版 §8.1 的场景重构清单里，仍是 30/36 高、16 号字，
    // 运行时统一到令牌（高 48、正文 20），避免与战斗界面并存两套控件规格。
    this.normalizeSmallPanelButtons();
  }

  /**
   * 商店/休息面板的小按钮统一到设计令牌（幂等）。
   *
   * **宽高都要统一**：场景里这些按钮底色只有 100/80/60 宽，而标签是 `overflow=NONE`
   * —— 引擎会按文案把标签节点撑到 140/109/80，于是"买技能 - 10金币"这种文案直接戳到
   * 按钮底色外面（放大截图可见文字两侧露在蓝色底之外）。这里按本面板最宽的文案 +32 内边距
   * 给同面板的按钮取**统一宽度**。
   */
  private normalizeSmallPanelButtons(): void {
    const groups: [Node | null, string[]][] = [
      [this.shopPanel, ['CloseBtn']],
      [this.restPanel, ['SkipBtn']],
    ];
    for (const [panel, names] of groups) {
      if (!panel?.isValid) continue;
      const btns: Node[] = [];
      let widest = 0;
      for (const name of names) {
        const node = panel.getChildByName(name);
        if (!node?.isValid) continue;
        btns.push(node);
        const label = node.getComponentInChildren(Label);
        const labelUi = label?.node.getComponent(UITransform);
        if (!label || !labelUi) continue;
        // Label 是 overflow=NONE：节点宽度由引擎按文案自动撑开，而这一步发生在
        // 字号改动之前，所以按字号比例把旧宽度折算到 FONT_BODY 下
        const before = label.fontSize;
        applyFont(label, FONT_BODY);
        const scaled = before > 0 ? labelUi.contentSize.width * (FONT_BODY.fontSize / before) : labelUi.contentSize.width;
        widest = Math.max(widest, scaled);
      }
      const width = Math.max(widest + 32, 160);
      for (const node of btns) {
        const ui = node.getComponent(UITransform);
        if (ui) ui.setContentSize(width, CONTROL.BTN_HEIGHT);
      }
    }
  }

  /**
   * 把面板底色的尺寸/位置对齐到它的内容包围盒（B5⑤）。
   *
   * 这三个面板的场景数据是"一块小底板 + 一堆绝对坐标子节点"：
   * 例如 `ShopPanel` 底板只有 300×280 且锚点在中心，而标题 `ShopTitle` 宽 480、
   * 位于 y=300 —— 标题和第一个按钮**整个在底板之外**，深色底板只盖住了下半截，
   * 看起来就是"内容偏上、下半空"。
   *
   * 不在场景里改：那要挪几十个节点的坐标，而且会切走编辑器当前场景。
   * 这里运行时按子节点包围盒重算底板；子节点会随父节点一起位移，
   * 所以再按包围盒中心反向补偿，保证**内容的屏幕位置一点不动**，只是把底色撑开。
   *
   * 幂等：执行后内容已关于面板原点居中，再调用时包围盒中心为 0，尺寸不再变化。
   */
  private fitPanelBackground(panel: Node | null, pad: number = 40): void {
    if (!panel?.isValid) return;
    const panelUi = panel.getComponent(UITransform);
    if (!panelUi) return;

    // 子节点坐标是相对面板**原点**的（锚点位置），这里就是画布坐标
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const child of panel.children) {
      const ui = child.getComponent(UITransform);
      if (!ui) continue;
      const p = child.position;
      minX = Math.min(minX, p.x - ui.contentSize.width * ui.anchorPoint.x);
      maxX = Math.max(maxX, p.x + ui.contentSize.width * (1 - ui.anchorPoint.x));
      minY = Math.min(minY, p.y - ui.contentSize.height * ui.anchorPoint.y);
      maxY = Math.max(maxY, p.y + ui.contentSize.height * (1 - ui.anchorPoint.y));
    }
    if (!isFinite(minX) || !isFinite(minY)) return;

    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    if (Math.abs(width - panelUi.width) < 1 && Math.abs(height - panelUi.height) < 1) return;

    panelUi.setContentSize(width, height);
    // 底板本身按包围盒居中，子节点反向平移，二者相对位置因此保持原样
    panel.setPosition(panel.position.x + centerX, panel.position.y + centerY, panel.position.z);
    for (const child of panel.children) {
      child.setPosition(child.position.x - centerX, child.position.y - centerY, child.position.z);
    }
  }

  /**
   * 重绘商店面板（队伍行 + 商品卡 + 反馈行）。
   *
   * 改造前的商店只有"买技能 - 10金币 / 回血 - 5金币"两个按钮：
   * ① 技能是**随机**学的、不给名字，玩家不知道买到了什么；
   * ② 回血在本作里毫无意义 —— `BattleManager.startBattle()` 每场都
   *    `clearAllUnits()` + `createPlayerUnits()` 重建单位，`resetForNewBattle()`
   *    把 `currentHp = maxHp`，血量从不跨场保留；
   * ③ 按钮买不起时只置灰、点了连提示都没有（实测金币 4 时点下去毫无反应）。
   * 现在改为：明码技能卡（按队伍职业各一张，卡上写清技能名与效果）+ 一张
   * 全队永久强化，队伍面板实时显示等级/经验/技能，任何一次点击都有反馈行。
   */
  private renderShop(): void {
    const panel = this.shopPanel;
    if (!panel?.isValid) return;

    const goldLine = panel.getChildByName('GoldLine')?.getComponent(Label);
    if (goldLine) {
      applyFontAndColor(goldLine, FONT_BODY, COLOR.WARNING);
      goldLine.string = `💰 金币 ${this._runData.gold}`;
    }

    this.renderPartyRows(panel.getChildByName('PartyContainer'), null);

    const frame = this.getSolidFrame();
    const cards: CardSpec[] = [];

    // ① 每个出战职业一张技能卡（技能明码，而不是"随机学一个"）
    for (const classId of this._runData.playerClasses) {
      const classConfig = getClassById(classId);
      if (!classConfig) continue;
      const price = this.shopPrice(SHOP_SKILL_PRICE);
      const learners = this.unitsOfClassWithFreeSlot(classId);
      const learned = this.learnedSkillIdsOfClass(classId);
      const pool = classConfig.skillPool.filter(id => !learned.includes(id));
      const skill = pool.length > 0 ? getSkillById(pool[0]) : null;

      const affordable = this._runData.gold >= price;
      const enabled = !!skill && learners.length > 0 && affordable;
      let reason = '';
      if (!skill) reason = '该职业已全部学会';
      else if (learners.length === 0) reason = '技能栏已满';
      else if (!affordable) reason = '金币不足';

      cards.push({
        // 图标用**职业**图标（不是 skillIconOf）：卡片是按职业卖的，而 skillIconOf 按
        // 目标类型推导，三个职业的主动技会推导出同一张 ⚔ → 三张卡长得一模一样。
        icon: classConfig.icon || (skill ? skillIconOf(skill) : '❓'),
        title: skill ? skill.name : '已全部学会',
        subtitle: `${classConfig.name} 可学 · ${price} 金币`,
        desc: enabled || !reason ? (skill?.description ?? '') : reason,
        accent: CLASS_COLOR[classId] ?? CLASS_COLOR.fallback,
        enabled,
        onPick: () => this.buySkillForClass(classId, price),
      });
    }

    // ② 全队永久强化（金币在本作里唯一的"团队向"出口）
    const teamPrice = this.shopPrice(SHOP_TEAM_PRICE);
    const teamAffordable = this._runData.gold >= teamPrice;
    cards.push({
      icon: '📜',                                   // 📜
      title: '强攻卷轴',
      subtitle: `全队永久 · ${teamPrice} 金币`,
      desc: teamAffordable
        ? '每位英雄攻击力永久 +1（跨战斗生效）'
        : '金币不足',
      accent: COLOR.SUCCESS,
      enabled: teamAffordable,
      onPick: () => this.buyTeamAttack(teamPrice),
    });

    renderCardGrid(panel.getChildByName('OfferContainer'), frame, cards, 2, CARD_W, CARD_H);
    this.renderPanelFeedback(panel);
    // 内容尺寸变了：底板必须跟着重算，否则卡片会溢出深色底板
    this.fitPanelBackground(panel);
  }

  /** 面板内的一行操作反馈（买入成功 / 为何不能买），替代原先只写 console 的做法 */
  private renderPanelFeedback(panel: Node): void {
    const label = panel.getChildByName('FeedbackLabel')?.getComponent(Label);
    if (!label) return;
    applyFontAndColor(label, FONT_CAPTION, this._panelFeedback.startsWith('已') ? COLOR.SUCCESS : COLOR.TEXT_SECONDARY);
    label.string = stripVariationSelectors(this._panelFeedback);
  }

  /**
   * 队伍面板：一行一个英雄，显示等级 / 经验进度 / 已学技能。
   * @param onPick 传了才可点（圣泉"指定英雄"步骤复用同一个渲染）
   */
  private renderPartyRows(
    container: Node | null, onPick: ((unit: UnitController) => void) | null
  ): void {
    const rows: UnitRowSpec[] = [];
    const frame = this.getSolidFrame();
    const units = this.battleManager?.playerUnits ?? [];

    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      if (!unit?.data) continue;
      const d = unit.data;
      const progress = ensureProgress(this._runData, i);
      const need = expToNext(progress.level);
      const classConfig = getClassById(d.classId);
      const skillNames = d.skills.map(s => s.name).join('、') || '（无）';
      rows.push({
        name: `${classConfig?.icon ? stripVariationSelectors(classConfig.icon) + ' ' : ''}${d.name}`,
        level: `Lv${progress.level}`,
        detail: `技能 ${d.skills.length}/${unit.maxSkillSlots} · ${skillNames} · 经验 ${progress.exp}/${need}`,
        percent: need > 0 ? progress.exp / need : 0,
        accent: CLASS_COLOR[d.classId] ?? CLASS_COLOR.fallback,
        onPick: onPick ? () => onPick(unit) : undefined,
      });
    }

    renderUnitRows(container, frame, rows, ROW_W, ROW_H);
  }

  /** 该职业里还有技能空位的英雄（商店技能卡的"谁能学"判定） */
  private unitsOfClassWithFreeSlot(classId: string): UnitController[] {
    return (this.battleManager?.playerUnits ?? []).filter(u =>
      u.data?.classId === classId && u.data.isAlive && u.hasFreeSkillSlot
    );
  }

  /** 该职业**已有人学会**的技能 id（避免商店重复卖同一个技能） */
  private learnedSkillIdsOfClass(classId: string): string[] {
    const ids: string[] = [];
    for (const u of this.battleManager?.playerUnits ?? []) {
      if (u.data?.classId !== classId) continue;
      for (const s of u.data.skills) ids.push(s.id);
    }
    return ids;
  }

  /** 商店：为某职业买下指定的一张技能卡（学给该职业里技能最少的那位） */
  private buySkillForClass(classId: string, price: number): void {
    const classConfig = getClassById(classId);
    if (!classConfig) return;
    if (this._runData.gold < price) { this._panelFeedback = '金币不足'; this.renderShop(); return; }

    const learners = this.unitsOfClassWithFreeSlot(classId);
    if (learners.length === 0) { this._panelFeedback = '该职业技能栏已满'; this.renderShop(); return; }

    const learned = this.learnedSkillIdsOfClass(classId);
    const pool = classConfig.skillPool.filter(id => !learned.includes(id));
    if (pool.length === 0) { this._panelFeedback = '该职业已全部学会'; this.renderShop(); return; }

    const skill = getSkillById(pool[0]);
    // 学给技能最少的那位，避免奖励全砸在 0 号身上
    let target = learners[0];
    for (const u of learners) {
      if (u.data!.skills.length < target.data!.skills.length) target = u;
    }
    if (!skill || !target.addSkill(skill)) {
      this._panelFeedback = '学习失败（本次不扣金币）';
      this.renderShop();
      return;
    }

    this._runData.gold -= price;
    this._syncUnitSkillsToRunData();
    SaveManager.saveRun(this._runData);
    this.updateGoldDisplay();
    this._panelFeedback = `已买下「${skill.name}」 → ${target.data!.name}`;
    this.renderShop();
  }

  /** 商店：全队永久 +1 攻击（写 RunData，开战时由 applyRunProgressToParty 灌回单位） */
  private buyTeamAttack(price: number): void {
    if (this._runData.gold < price) { this._panelFeedback = '金币不足'; this.renderShop(); return; }

    this._runData.gold -= price;
    const units = this.battleManager?.playerUnits ?? [];
    for (let i = 0; i < units.length; i++) {
      const progress = ensureProgress(this._runData, i);
      progress.bonus.attack += 1;
      // 当场也生效（本节点之后若立即开战，单位会重建，届时由 applyRunProgressToParty 再灌一次）
      if (units[i].data) {
        units[i].data!.baseStats.attack += 1;
        units[i].data!.stats.attack += 1;
      }
    }
    SaveManager.saveRun(this._runData);
    this.updateGoldDisplay();
    this._panelFeedback = '已购入「强攻卷轴」：全队攻击 +1';
    this.renderShop();
  }

  /**
   * 圣泉：三选一强化（取代原先"全员回满血"）。
   *
   * 为什么要改：血量每场自动回满（`resetForNewBattle`），"休息恢复满血"等于什么都没做。
   * 现在圣泉给的是**跨战斗永久**的三类成长，与商店形成取舍：
   * 商店花金币买技能，圣泉是免费但每局只有一次的定向强化。
   */
  private renderRest(): void {
    const panel = this.restPanel;
    if (!panel?.isValid) return;

    const desc = panel.getChildByName('RestDesc')?.getComponent(Label);
    const container = panel.getChildByName('OptionContainer');
    const frame = this.getSolidFrame();

    if (this._restOptionIndex < 0) {
      if (desc) {
        applyFontAndColor(desc, FONT_CAPTION, COLOR.TEXT_SECONDARY);
        desc.string = '选一项强化，再指定英雄';
      }
      const noFreeSlot = (this.battleManager?.playerUnits ?? []).every(u => !u.hasFreeSkillSlot);
      const options: CardSpec[] = [
        {
          icon: '⚔', title: '淬炼',
          subtitle: '指定英雄',
          desc: '该英雄攻击 +1、最大生命 +2（永久）',
          accent: COLOR.DANGER, enabled: true,
          onPick: () => this.chooseRestOption(0),
        },
        {
          icon: '🧹', title: '精进',
          subtitle: '指定英雄',
          desc: '该英雄技能栏 +1（永久）',
          accent: COLOR.PRIMARY, enabled: true,
          onPick: () => this.chooseRestOption(1),
        },
        {
          icon: '📖', title: '秘传',
          subtitle: '指定英雄',
          desc: noFreeSlot
            ? '全队技能栏已满'
            : '该英雄随机学一个本职业新技能',
          accent: COLOR.PASSIVE, enabled: !noFreeSlot,
          onPick: () => this.chooseRestOption(2),
        },
      ];
      renderCardGrid(container, frame, options, 3, OPTION_W, OPTION_H);
      this.setSkipLabel('跳过');
      const skip = panel.getChildByName('SkipBtn');
      if (skip) skip.active = true;
    } else {
      if (desc) {
        applyFontAndColor(desc, FONT_CAPTION, COLOR.WARNING);
        desc.string = REST_OPTION_TITLE[this._restOptionIndex] ?? '';
      }
      // 第二步：指定英雄（复用队伍行，可点）
      this.renderPartyRows(container, (unit) => this.applyRestOption(unit));
      this.setSkipLabel('返回');
      const skip = panel.getChildByName('SkipBtn');
      if (skip) skip.active = true;
    }

    this.renderPanelFeedback(panel);
    this.fitPanelBackground(panel);
  }

  private setSkipLabel(text: string): void {
    const lb = this.restPanel?.getChildByName('SkipBtn')?.getComponentInChildren(Label);
    if (lb) lb.string = text;
  }

  private chooseRestOption(index: number): void {
    this._restOptionIndex = index;
    this._panelFeedback = '';
    this.renderRest();
  }

  /** 安全退出圣泉：确认/跳过/返回都走这里（cleanup 与交付分离） */
  private leaveRest(): void {
    if (this.restPanel) this.restPanel.active = false;
    this._restOptionIndex = -1;
    this._panelFeedback = '';
    this.completeNonBattleNode();
  }

  private skipRest(): void {
    // 第二步（指定英雄）时"跳过"按钮是**返回**，不结束节点
    if (this._restOptionIndex >= 0) {
      this._restOptionIndex = -1;
      this._panelFeedback = '';
      this.renderRest();
      return;
    }
    this.leaveRest();
  }

  /** 把选中的强化应用到指定英雄（并持久化到 RunData.unitProgress） */
  private applyRestOption(unit: UnitController): void {
    if (!unit?.data) return;
    const index = (this.battleManager?.playerUnits ?? []).indexOf(unit);
    if (index < 0) return;
    const progress = ensureProgress(this._runData, index);
    const d = unit.data;

    if (this._restOptionIndex === 0) {
      progress.bonus.attack += 1;
      progress.bonus.hp += 2;
      d.baseStats.attack += 1; d.stats.attack += 1;
      d.baseStats.hp += 2; d.maxHp += 2;
      d.currentHp = Math.min(d.currentHp + 2, d.maxHp);
      unit.refreshHealthBarVisual();
      this._panelFeedback = `已淬炼 ${d.name}：攻击 +1、最大生命 +2`;
    } else if (this._restOptionIndex === 1) {
      progress.extraSkillSlots += 1;
      d.skillSlotBonus += 1;
      this._panelFeedback = `已精进 ${d.name}：技能栏 +1（现为 ${unit.maxSkillSlots}）`;
    } else if (this._restOptionIndex === 2) {
      const skill = this.learnRandomSkillFor(unit);
      if (!skill) {
        this._panelFeedback = `${d.name} 已无可学技能`;
        this._restOptionIndex = -1;
        this.renderRest();
        return;
      }
      this._panelFeedback = `已传授 ${d.name}：「${skill.name}」`;
    } else {
      return;
    }

    this._syncUnitSkillsToRunData();
    SaveManager.saveRun(this._runData);
    this.leaveRest();
  }

  /**
   * 通关面板出口。
   * P2 重构后 RunVictoryPanel 有了真正的按钮节点 ReturnBtn（200×48 PRIMARY），
   * 不再依赖原先那个既是占位文案又当点击热区的 ContinueLabel。
   */
  private bindRunVictoryPanel(): void {
    if (!this.victoryPanel) return;
    const returnBtnNode = this.victoryPanel.getChildByName('ReturnBtn');
    if (!returnBtnNode) return;
    const btn = returnBtnNode.getComponent(Button);
    if (btn) {
      btn.node.on(Button.EventType.CLICK, this.onReturnToLobby, this);
    }
  }

  /** 填充结算面板的摘要行（P2 统一版式：RunVictoryPanel 与 GameOverPanel 同为 SummaryLine1/2） */
  private fillPanelSummary(panel: Node | null, line: number, text: string): void {
    if (!panel) return;
    const label = panel.getChildByName(`SummaryLine${line}`)?.getComponent(Label);
    if (label) label.string = text;
  }

  private onReturnToLobby(): void {
    SceneManager.gotoLobby();
  }

  /**
   * 商店/圣泉改造后各自只剩一个"离开"按钮 —— 商品卡与强化卡都是运行时创建的，
   * 点击由卡片自带的 `PanelCardButton` 承载，不需要在这里绑 @property。
   */
  private bindShopPanelEvents(): void {
    if (!this.shopPanel) return;
    const closeBtn = this.shopPanel.getChildByName('CloseBtn');
    if (closeBtn) {
      const btn = closeBtn.getComponent(Button);
      if (btn) btn.node.on(Button.EventType.CLICK, this.closeShop, this);
    }
  }

  private bindRestPanelEvents(): void {
    if (!this.restPanel) return;
    const skipBtn = this.restPanel.getChildByName('SkipBtn');
    if (skipBtn) {
      const btn = skipBtn.getComponent(Button);
      if (btn) btn.node.on(Button.EventType.CLICK, this.skipRest, this);
    }
  }

  private unbindShopPanelEvents(): void {
    if (!this.shopPanel?.isValid) return;
    const closeBtn = this.shopPanel.getChildByName('CloseBtn');
    if (closeBtn?.isValid) {
      const btn = closeBtn.getComponent(Button);
      if (btn) btn.node.off(Button.EventType.CLICK, this.closeShop, this);
    }
  }

  private unbindRestPanelEvents(): void {
    if (!this.restPanel?.isValid) return;
    const skipBtn = this.restPanel.getChildByName('SkipBtn');
    if (skipBtn?.isValid) {
      const btn = skipBtn.getComponent(Button);
      if (btn) btn.node.off(Button.EventType.CLICK, this.skipRest, this);
    }
  }

  private bindClassSelectionEvents(): void {
    for (let i = 0; i < CLASS_ORDER.length; i++) {
      const btnName = `Class${i + 1}Btn`;
      const btnNode = this.classSelectPanel.getChildByName(btnName);
      if (!btnNode) continue;
      const btn = btnNode.getComponent(Button);
      if (!btn) continue;
      const classId = CLASS_ORDER[i];
      btnNode['_classId'] = classId;
      // Button 默认 COLOR 过渡会按 hover/pressed 改写节点 Sprite 颜色，
      // 会冲掉我们在 setClassButtonVisual 里设的选中配色（选中行显示成 hover 灰）。
      // 改用 SCALE 过渡，颜色完全由代码控制。
      btn.transition = Button.Transition.SCALE;
      btn.node.on(Button.EventType.CLICK, this.onClassToggleClicked, this);
    }
  }

  private resetClassSelectionVisual(): void {
    for (let i = 0; i < CLASS_ORDER.length; i++) {
      const btnName = `Class${i + 1}Btn`;
      const btnNode = this.classSelectPanel.getChildByName(btnName);
      if (!btnNode) continue;
      this.setClassButtonVisual(btnNode, false);
    }
    // 同步开始按钮的可用性与文案（否则重开后文案会残留上一局的 “开始游戏 (n/3)”）
    this.updateStartBtnInteractable();
  }

  private setupClassSelectionUI(): void {
    this.bindClassSelectionEvents();
    this.resetClassSelectionVisual();
  }

  private onClassToggleClicked(btn: Button): void {
    const classId = btn.node['_classId'] as string;
    if (!classId) return;
    if (this._selectedClasses.includes(classId)) {
      if (this._selectedClasses.length <= 1) return;
      this._selectedClasses = this._selectedClasses.filter(c => c !== classId);
      this.setClassButtonVisual(btn.node, false);
    } else {
      // 队伍固定 3 人：选满后再点第 4 个 → 顶掉**最早选**的那个（FIFO）。
      // 既不是静默无反应（玩家会以为按钮坏了），也不用"先取消再选"两步操作。
      if (this._selectedClasses.length >= SQUAD_SIZE) {
        const dropped = this._selectedClasses.shift();
        const droppedNode = dropped ? this.classButtonNodeOf(dropped) : null;
        if (droppedNode) this.setClassButtonVisual(droppedNode, false);
      }
      this._selectedClasses.push(classId);
      this.setClassButtonVisual(btn.node, true);
    }
    this.updateStartBtnInteractable();
  }

  /** 按 classId 反查职业按钮节点（供"顶掉最早选择"时复位它的外观） */
  private classButtonNodeOf(classId: string): Node | null {
    if (!this.classSelectPanel) return null;
    for (let i = 0; i < CLASS_ORDER.length; i++) {
      const n = this.classSelectPanel.getChildByName(`Class${i + 1}Btn`);
      if (n && n['_classId'] === classId) return n;
    }
    return null;
  }

  /**
   * 职业按钮选中态。
   * P3 起不再放大节点（1.1 倍会让 592×64 的行与邻行相贴），
   * 改用「左侧竖条 + 底板配色」表达选中（场景内节点名为 SelectBar）。
   */
  private setClassButtonVisual(btnNode: Node, selected: boolean): void {
    // 底板：选中用主色，未选中用 SURFACE
    const sprite = btnNode.getComponent(Sprite);
    if (sprite) {
      sprite.color = selected ? hex(COLOR.PRIMARY, 255) : hex(COLOR.SURFACE, 255);
    }
    // 左侧竖条（原 HighlightBorder 改名而来）
    const selectBar = btnNode.getChildByName('SelectBar');
    if (selectBar) {
      const barSprite = selectBar.getComponent(Sprite);
      if (barSprite) {
        barSprite.color = selected ? hex(COLOR.TEXT_PRIMARY, 255) : hex(COLOR.PANEL_BORDER, 255);
      }
      selectBar.active = true;   // 竖条常态可见（未选中用暗色），避免行宽跳动
    }
    // 选中勾标记
    const checkMark = btnNode.getChildByName('CheckMark');
    if (checkMark) checkMark.active = selected;
    // 兜底复位：早期版本可能残留缩放
    btnNode.setScale(1, 1, 1);
  }

  private updateStartBtnInteractable(): void {
    const startBtnNode = this.classSelectPanel.getChildByName('StartBtn');
    if (!startBtnNode) return;
    const startBtn = startBtnNode.getComponent(Button);
    if (startBtn) {
      const canStart = this._selectedClasses.length >= 3;
      startBtn.interactable = canStart;
      const label = startBtnNode.getComponentInChildren(Label);
      if (label) {
        label.string = canStart
          ? `\u5F00\u59CB\u6E38\u620F (${this._selectedClasses.length}/3)`
          : `\u9009\u62E9\u961F\u53CB (${this._selectedClasses.length}/3)`;
      }
    }
  }

  startClassSelect(): void {
    if (this._selectedClasses.length < 3) return;

    if (this.classSelectPanel) {
      this.classSelectPanel.active = false;
    }
    if (this.continueButton) {
      this.continueButton.node.active = false;
    }

    this._runData.playerClasses = [...this._selectedClasses];
    this._runData.gold = 0;
    // 天赋「启动资金」：开局 +5 金币/次。只在**真正开新局**时发（续档走 onContinueRun，不重复发）
    this._runData.gold += this._runData.talents.filter(t => t === 'start_gold').length * 5;
    this._runData.currentRouteNode = 0;
    // 新开局：丢弃上一局的布阵（职业组合已变，旧阵型无意义）
    this._runData.deployLayout = undefined;

    this.startNewRun();
  }

  private onContinueRun(): void {
    const saved = SaveManager.loadRun();
    if (saved) {
      this._runData = saved;
      // 天赋/已消费荣誉属于**跨局永久**进度：以 meta 为准。
      // 存档里的快照可能落后于本次在职业选择页刚买的天赋。
      const meta = SaveManager.loadMeta();
      if (meta) {
        this._runData.honorSpent = meta.honorSpent ?? 0;
        this._runData.talents = meta.talents;
      }
      if (this.classSelectPanel) this.classSelectPanel.active = false;
      if (this.continueButton) this.continueButton.node.active = false;
      this.startNewRun();
    }
  }

  private startNewRun(): void {
    this._state = 'route_map';
    this._battleCount = 0;
    // 记录起点荣誉：结算面板的"本局荣誉收益"要用它与当前值的差
    this._honorAtRunStart = this._runData.honor;
    this._leveledUnits = [];

    // 路线图：金币可见（局内资源）、回合隐藏（仅战斗有意义）
    this.setHudVisible(true, false);
    this.updateGoldDisplay();

    if (this.routeMapUI) {
      this.routeMapUI.show();
      const nodes = this.routeMapUI.generateRoute();
      this.routeMapUI.renderRoute(nodes);
      // 续档恢复：标记已完成的节点
      const currentNodeId = this._runData.currentRouteNode;
      if (currentNodeId > 0) {
        this._battleCount = nodes.filter(n =>
          n.id < currentNodeId && (n.type === 'battle' || n.type === 'elite' || n.type === 'boss')
        ).length;
        for (const node of nodes) {
          if (node.id < currentNodeId) {
            this.routeMapUI.completeNode(node.id);
          }
        }
      }
      this.routeMapUI.setNodeClickCallback((nodeId) => this.onNodeSelected(nodeId));
    }

    if (this.battleUI) {
      this.battleUI.setConfirmDeployCallback(() => this.onConfirmDeploy());
      this.battleUI.setWaitCallback(() => this.onWaitClicked());
      this.battleUI.setEndTurnCallback(() => this.battleManager.endCurrentUnitTurn());
      this.battleUI.setVictoryContinueCallback(() => this.onVictoryContinue());
      this.battleUI.setAttackCallback(() => this.battleManager.onAttackSelected());
    }
    if (this.battleManager) {
      this.battleManager.setDamageDealtCallback((targetNode, amount) => {
        this.battleUI.showDamageNumber(targetNode, amount);
      });
      this.battleManager.setUnitPhaseChangedCallback((phase, unit, actionPhase) => {
        this.updateBattlePhaseUI(phase, unit, actionPhase);
      });
      // 布阵卡片选中回调 → 更新 UI 卡片高亮
      this.battleManager.setDeploySelectionChangedCallback((index) => {
        this.battleUI.selectDeploySlot(index);
      });
      // 自动跳过提示（文案由 BattleManager 组装：它才知道是"无事可做"还是"有技能可放"）
      this.battleManager.setAutoSkipCallback((message) => {
        this.battleUI.showAutoSkipNotice(message);
      });
      // 玩家一动手就撤销跳过 → 顺手收掉横幅
      this.battleManager.setAutoSkipCancelledCallback(() => {
        this.battleUI.clearAutoSkipNotice();
      });
      // 技能按钮现在**不再靠置灰吞点击**：用不了的技能点下去也要给出原因
      this.battleManager.setSkillRejectedCallback((message) => {
        this.battleUI.showAutoSkipNotice(message);
      });
    }

    this.updateGoldDisplay();
  }

  private onNodeSelected(nodeId: number): void {
    this._currentNode = this.routeMapUI?.getNodeById(nodeId) ?? null;
    if (!this._currentNode) return;

    this._currentDifficulty = this._battleCount;

    switch (this._currentNode.type) {
      case 'battle':
        this.startBattle(false, false);
        break;
      case 'elite':
        this.startBattle(true, false);
        break;
      case 'boss':
        this.startBattle(false, true);
        break;
      case 'shop':
        this.openShop();
        break;
      case 'rest':
        this.openRest();
        break;
      case 'event':
        this.triggerEvent();
        break;
    }
  }

  private startBattle(isElite: boolean, isBoss: boolean): void {
    this._state = 'battle';
    // 战斗中 HUD 双端可见：左回合、右金币
    this.setHudVisible(true, true);
    this.routeMapUI.hide();
    if (this.battleManager?.node) {
      this.battleManager.node.active = true;
    }
    if (this.battleManager?.gridController?.node) {
      this.battleManager.gridController.node.active = true;
    }
    this.battleUI.show();
    this.battleUI.showDeployPhase();

    const unitNames = this._runData.playerClasses.map(c => {
      const config = getClassById(c);
      return config ? config.name : c;
    });
    const unitIcons = this._runData.playerClasses.map(c => {
      const config = getClassById(c);
      return config ? stripVariationSelectors(config.icon) : '';
    });
    this.battleUI.setupDeploySlots(unitNames, unitIcons, [...this._runData.playerClasses], (index) => {
      this.battleManager.selectDeployUnit(index);
    });
    this.battleManager.setDeployUnitPlacedCallback((placed, total) => {
      // 三态更新：遍历所有单位，根据放置状态更新站台槽位
      for (let i = 0; i < this.battleManager.playerUnits.length; i++) {
        const unit = this.battleManager.playerUnits[i];
        const isPlaced = unit.data?.gridPos.col >= 0;
        this.battleUI.setDeploySlotState(i, isPlaced ? 'placed' : 'unplaced');
      }
    });

    // 拖拽（§3.3）：视觉与手势在 BattleUI，规则全在 BattleManager，这里只做接线
    this.battleUI.setDeployDragApi({
      worldToGrid: (x, y) => this.battleManager.gridPosFromUI(x, y),
      unitAtGrid: (pos) => this.battleManager.playerUnitAt(pos),
      canPlaceAt: (unitIndex, pos) => this.battleManager.canPlaceAt(unitIndex, pos),
      // 拖拽路径一律 advanceSelection=false：拖拽是"点着哪个拖哪个"的直接操作，
      // 与"当前选中是哪张"无关，不得改写选中态（否则拖走 A 会把 B 点亮）。
      placeUnit: (unitIndex, pos) => this.battleManager.placeUnit(unitIndex, pos, false),
      unplaceUnit: (unitIndex) => this.battleManager.unplaceUnit(unitIndex, false),
      swapUnits: (indexA, indexB) => this.battleManager.swapUnits(indexA, indexB),
      previewDrop: (pos, valid) => this.battleManager.previewDeployDrop(pos, valid),
      beginDrag: (unitIndex) => this.battleManager.setDeployDragging(unitIndex, true),
      endDrag: (unitIndex) => this.battleManager.setDeployDragging(unitIndex, false),
      setUnitDimmed: (unitIndex, dimmed) => this.battleManager.setUnitDimmed(unitIndex, dimmed),
    });
    // 拖拽已消费本次触摸时，忽略棋盘格 Button 随后派发的点击
    this.battleManager.setDeployDragGuard(() => this.battleUI.isDragConsumingTouch());

    this.battleManager.startBattle(
      this._runData.playerClasses,
      this._currentDifficulty,
      isElite,
      isBoss,
      (result) => this.onBattleEnd(result),
      this._runData.deployLayout ?? null
    );

    // 荣誉天赋加成（设计 §6.2）：单位每场战斗都会重建，故在本场生成后应用一次
    this.applyTalentsToParty();
    // 局内成长（经验/永久属性/额外技能栏）必须先于技能恢复应用，
    // skillSlotBonus 决定 addSkill 的上限；见 applyRunProgressToParty
    this.applyRunProgressToParty();

    // 恢复存档中的技能（按 id 去重：创建单位时已自动添加起始技能，避免重复）
    if (Object.keys(this._runData.unitSkills).length > 0) {
      for (let i = 0; i < this.battleManager.playerUnits.length; i++) {
        const unit = this.battleManager.playerUnits[i];
        const skillIds = this._runData.unitSkills[i];
        if (skillIds && unit) {
          for (const skillId of skillIds) {
            const skill = getSkillById(skillId);
            if (skill && !unit.hasSkill(skill.id)) {
              unit.addSkill(skill);
            }
          }
        }
      }
    }
  }

  private onConfirmDeploy(): void {
    if (!this.battleManager.confirmDeploy()) return;
    // 布阵确认成功 → 把本场阵型写入存档，下次战斗沿用（§3.2）
    this._runData.deployLayout = this.battleManager.exportDeployLayout();
    SaveManager.saveRun(this._runData);
    this.battleUI.hideDeployPhase();

    // 播放战前动画，动画完成后开始战斗
    this.battleUI.playBattleStartAnimation(() => {
        this.battleManager.startBattleAfterAnimation();
        this.updateBattleUI();
    });
  }

  private onWaitClicked(): void {
    this.battleManager.waitCurrentUnit();
    this.updateBattleUI();
  }

  private updateBattlePhaseUI(phase: import('./battle/BattleManager').BattlePhase, unit: UnitController | null, actionPhase: UnitActionPhase | null): void {
    if (!this.battleUI) return;
    const aliveUnits = this.battleManager.playerUnits.filter(u => u.data?.isAlive);
    const totalAlive = aliveUnits.length;

    switch (phase) {
      case 'deploy':
        this.battleUI.updatePhase('\u5E03\u9635\u9636\u6BB5', '\u70B9\u51FB\u524D\u4E24\u884C\u90E8\u7F72\u5355\u4F4D');
        break;

      case 'player_turn':
        if (unit?.data) {
          const idx = aliveUnits.findIndex(u => u === unit) + 1;
          // 提示语要能解释"点自己"的语义 —— 这是本次交互改造的核心：
          // 移动阶段点自己 = 原地待命，行动阶段点自己 = 撤销待命
          const hint = actionPhase === 'move' ? '点击可移动位置；点自己原地待命' :
                       actionPhase === 'attack_target' ? '选择攻击目标' :
                       actionPhase === 'skill_target' ? '选择技能目标，再次点击确认' :
                       actionPhase === 'skill_target_aoe' ? '选择AOE中心点，再次点击确认' :
                       '点击攻击/技能，点自己可撤销待命';
          this.battleUI.updatePhase(
            `\u6211\u65B9\u56DE\u5408 \u7B2C${this.battleManager.turnCount}\u8F6E`,
            hint,
            unit.data.name,
            idx,
            totalAlive
          );
          // 同步刷新单位状态栏（血量/能量/技能按钮）
          this.updateBattleUI();
          if (actionPhase === 'action' || actionPhase === 'attack_target') {
            this.battleUI.showAttackButton();
          } else {
            this.battleUI.hideAttackButton();
          }
        }
        break;

      case 'enemy_turn':
        this.battleUI.updatePhase('\u654C\u65B9\u56DE\u5408', '\u654C\u4EBA\u884C\u52A8\u4E2D...');
        // 敌方回合清除上一个玩家单位的信息残留
        this.battleUI.clearUnitInfo();
        this.battleUI.clearSkillButtons();
        break;
    }
  }

  private updateBattleUI(): void {
    const selected = this.battleManager.selectedUnit;
    if (selected?.data) {
      this.battleUI.updateUnitInfo(
        selected.data.name,
        selected.data.currentHp,
        selected.data.maxHp,
        selected.data.energy,
        selected.data.maxEnergy,
        this.battleManager.turnCount
      );

      // 只显示主动技能。被动（counter/toughness/eagle_eye/…）摆进技能栏是个陷阱：
      // 点一下会走 useSkill(setActed=true) 直接结束回合，玩家以为"点了没反应"。
      // 用「保留原始下标」的方式过滤 —— showSkillButtons 回调的下标语义（原始 skillIndex）不变。
      const skillIndices: number[] = [];
      for (let i = 0; i < selected.data.skills.length; i++) {
        if (selected.data.skills[i].type !== 'passive') skillIndices.push(i);
      }
      const skillNames = skillIndices.map(i => {
        const s = selected.data.skills[i];
        return `${s.name} [${s.energyCost}\u26A1]`;
      });
      const canUse = skillIndices.map(i =>
        this.battleManager.canUseSkillWithTargets(selected, i)
      );
      // 把"当前锁定技能"的**显示下标**告诉 UI（-1 = 没锁定），让它用异色标出来，
      // 玩家才知道"再点一次就是取消"
      const activeDisplayIndex = skillIndices.indexOf(this.battleManager.pendingSkillIndex);
      this.battleUI.showSkillButtons(skillNames, canUse, (index) => {
        this.battleManager.onSkillUsed(skillIndices[index]);
        this.updateBattleUI();
      }, activeDisplayIndex);
    } else {
      this.battleUI.clearUnitInfo();
      this.battleUI.clearSkillButtons();
    }
  }

  private onBattleEnd(result: BattleResult): void {
    if (result.victory) {
      if (this._currentNode) {
        this._runData.currentRouteNode = this._currentNode.id;
        this.routeMapUI?.completeNode(this._currentNode.id);
      }
      this._battleCount++;
      this._runData.gold += result.goldReward;
      this._runData.honor += 5;
      // 经验结算：只有跨过阈值的单位才会拿到升级三选一
      this.awardBattleExp(this._currentNode?.type === 'elite', this._currentNode?.type === 'boss');
      this._syncUnitSkillsToRunData();
      SaveManager.saveRun(this._runData);
      this.updateGoldDisplay();

      this.battleUI.clearPhase();
      this.battleUI.showVictory(
        result.goldReward,
        this.battleManager.turnCount,
        this.battleManager.totalDamageDealt
      );

      // 不自动跳转，等待玩家点击胜利面板的"继续"按钮
      // Boss 战的胜利处理在 onVictoryContinue 中判断
    } else {
      this._runData.honor += Math.max(1, this._battleCount * 5);
      this.battleUI.clearPhase();
      // 失败面板补一行战绩摘要（P2 统一版式后不再留空）
      this.battleUI.showDefeat(`\u62B5\u8FBE\u7B2C ${this.routeNo}/${this.totalRouteLayers} \u5173 \u00B7 \u9020\u6210\u4F24\u5BB3 ${this.battleManager.totalDamageDealt}`);
      this.scheduleOnce(() => {
        this.onRunComplete(false);
      }, 2.0);
    }
  }

  private onVictoryContinue(): void {
    if (this._currentNode?.type === 'boss') {
      this.onRunComplete(true);
      return;
    }

    SaveManager.saveRun(this._runData);

    this.scheduleOnce(() => {
      this.battleManager.reviveAllUnits();
      this.battleUI.hide();
      if (this.battleManager) this.battleManager.node.active = false;
      if (this.battleManager?.gridController?.node) {
        this.battleManager.gridController.node.active = false;
      }
      this.showUpgradeScreen();
    }, 0.3);
  }

  /**
   * 升级三选一（只问**本场真正升级**的单位，见 awardBattleExp）。
   *
   * 改造前是"每个存活单位各弹一次" —— 每人每场都升级，成长曲线被完全抹平，
   * 打精英/普通怪也毫无差别。现在没人升级就不弹面板，直接回路线图。
   */
  private showUpgradeScreen(): void {
    const leveled = (this._leveledUnits ?? []).filter(u => !!u?.data);
    if (leveled.length === 0) {
      console.info('[Upgrade] \u672C\u573A\u65E0\u4EBA\u5347\u7EA7');
      this.returnToRouteMap();
      return;
    }

    const allOptions = this.generateUpgradeOptions();
    const unitNames = leveled.map(u => u.data!.name);
    if (allOptions.length === 0) {
      this.returnToRouteMap();
      return;
    }

    this.upgradeUI.show();
    this.upgradeUI.showUpgradeOptions(
      allOptions,
      unitNames,
      (unitIndex, optionIndex) => {
        this.applyUpgrade(unitIndex, optionIndex, allOptions);
      },
      () => {
        this.returnToRouteMap();
      },
      (unitIndex) => {
        const unit = leveled[unitIndex];
        console.info(`[UpgradeUI] \u8DF3\u8FC7 ${unit?.data?.name ?? '#' + unitIndex} \u7684\u672C\u6B21\u5347\u7EA7`);
      }
    );
  }

  private get alivePlayerUnits(): UnitController[] {
    return this.battleManager.playerUnits.filter(u => u.data?.isAlive);
  }

  private generateUpgradeOptions(): UpgradeOption[][] {
    const result: UpgradeOption[][] = [];

    for (const unit of this._leveledUnits) {
      if (!unit.data) continue;

      const unitOptions: UpgradeOption[] = [];
      const classConfig = CLASSES.find(c => c.id === unit.data!.classId);

      if (classConfig && unit.hasFreeSkillSlot) {
        // 已学技能不再进卡池（与 UI 的「已学置灰」互为兜底，杜绝重复技能）；
        // 技能位已满时也不出技能卡，否则玩家选了会因 addSkill 拒绝而"没生效"
        const learnedIds = unit.data.skills.map(s => s.id);
        const availablePool = classConfig.skillPool.filter(id => !learnedIds.includes(id));
        const skills = getRandomSkillsFromPool(availablePool, 3);
        for (const skill of skills) {
          unitOptions.push({
            name: skill.name,
            description: skill.description,
            type: 'skill',
            skillId: skill.id,
            skillKind: skill.type,
            icon: skillIconOf(skill),
          });
        }
      }

      // 可学技能不足 3 项时用属性增益补位，保证始终是「三选一」
      const buffVariants = [
        { name: '\u2764 +1 \u6700\u5927\u8840\u91CF', buffType: 'hp', buffAmount: 1 },
        { name: '\u2694 +1 \u653B\u51FB\u529B', buffType: 'attack', buffAmount: 1 },
        { name: '\u26A1 +1 \u80FD\u91CF\u4E0A\u9650', buffType: 'energy', buffAmount: 1 },
      ];
      while (unitOptions.length < 3 && buffVariants.length > 0) {
        const picked = buffVariants.splice(Math.floor(Math.random() * buffVariants.length), 1)[0];
        unitOptions.push({
          name: picked.name,
          description: `${unit.data.name} \u83B7\u5F97\u6C38\u4E45\u589E\u76CA`,
          type: 'buff',
          buffType: picked.buffType,
          buffAmount: picked.buffAmount,
          icon: BUFF_ICON[picked.buffType] ?? '\u2728',
        });
      }

      const shuffled = unitOptions.sort(() => Math.random() - 0.5);
      result.push(shuffled.slice(0, Math.min(3, shuffled.length)));
    }

    return result;
  }

  private applyUpgrade(unitIndex: number, optionIndex: number, allOptions: UpgradeOption[][]): void {
    const option = allOptions[unitIndex]?.[optionIndex];
    if (!option) return;

    // 与 generateUpgradeOptions 保持同一寻址基准（存活单位），
    // 否则阵亡单位会让下标整体偏移、增益加到错误的单位上
    const unit = this._leveledUnits[unitIndex];
    if (!unit?.data) return;

    if (option.type === 'skill' && option.skillId) {
      const skill = getSkillById(option.skillId);
      if (skill && !unit.addSkill(skill)) {
        // addSkill 已拒绝（重复或技能位已满）：不静默，留痕便于排查
        console.info(`[Upgrade] ${unit.data.name} \u672A\u5B66\u4F1A ${skill.name}\uFF08\u5DF2\u62E5\u6709\u6216\u6280\u80FD\u4F4D\u5DF2\u6EE1\uFF09`);
      }
      this._syncUnitSkillsToRunData();
      return;
    }

    if (option.type === 'buff') {
      const amount = option.buffAmount ?? 1;
      // ① 当场生效：结算后立刻在面板/血条上看得见
      switch (option.buffType) {
        case 'hp':
          unit.data.maxHp += amount;
          unit.data.currentHp = Math.min(unit.data.currentHp + amount, unit.data.maxHp);
          break;
        case 'attack':
          unit.data.baseStats.attack += amount;
          unit.data.stats.attack += amount;
          break;
        case 'energy':
          unit.data.baseStats.maxEnergy += amount;
          unit.data.maxEnergy += amount;
          unit.data.energy = Math.min(unit.data.energy + amount, unit.data.maxEnergy);
          break;
      }
      // ② 同时写进 RunData.unitProgress。每场战斗 BattleManager 都会
      //    clearAllUnits + createPlayerUnits 重建单位，只写 UnitData 的永久属性
      //    在下一场开始时会**静默丢失**（技能靠 unitSkills 单独续命，
      //    属性类升级此前一直是白选的 —— 这是本轮修掉的一个真实缺陷）。
      const progressIndex = (this.battleManager?.playerUnits ?? []).indexOf(unit);
      if (progressIndex >= 0) {
        const progress = ensureProgress(this._runData, progressIndex);
        if (option.buffType === 'hp') progress.bonus.hp += amount;
        else if (option.buffType === 'attack') progress.bonus.attack += amount;
        else if (option.buffType === 'energy') progress.bonus.maxEnergy += amount;
      }
    }
    this._syncUnitSkillsToRunData();
    SaveManager.saveRun(this._runData);
  }

  private returnToRouteMap(): void {
    this._state = 'route_map';
    // 确保所有子面板已隐藏（防止跨阶段残留）
    if (this.upgradeUI) this.upgradeUI.hide();
    if (this.eventUI) this.eventUI.hide();
    if (this.battleUI) this.battleUI.hide();
    if (this.routeMapUI?.node?.isValid) {
      this.routeMapUI.show();
      this.routeMapUI.renderRoute(this.routeMapUI.nodes);
    }
    if (this.battleManager?.node?.isValid) {
      this.battleManager.node.active = false;
    }
    if (this.battleManager?.gridController?.node) {
      this.battleManager.gridController.node.active = false;
    }
  }

  private openShop(): void {
    this._state = 'shop';
    // 非战斗节点：金币可见、回合隐藏
    this.setHudVisible(true, false);
    this.routeMapUI.hide();

    if (this.shopPanel) {
      this.shopPanel.active = true;
    }
    this._panelFeedback = '';
    this.renderShop();
  }

  /**
   * 挑一个能学新技能的存活单位：**技能位未满者中技能数最少**的（并列取下标最小）。
   *
   * 为什么要挑：商店与事件的"学技能"原先写死 `playerUnits[0]`，等于把奖励全砸在 0 号身上；
   * 它一旦满位，这两个奖励就在**整局**里彻底失效（实测：金币 100 连点 3 次买技能纹丝不动）。
   */
  private pickUnitForNewSkill(): UnitController | null {
    let best: UnitController | null = null;
    for (const u of this.battleManager?.playerUnits ?? []) {
      if (!u.data?.isAlive || !u.hasFreeSkillSlot) continue;
      if (!best || u.data.skills.length < (best.data?.skills.length ?? Number.MAX_SAFE_INTEGER)) {
        best = u;
      }
    }
    return best;
  }

  /** 队里是否还有单位能学新技能（事件面板据此把"学技能"选项置灰） */
  private hasAnyFreeSkillSlot(): boolean {
    return (this.battleManager?.playerUnits ?? []).some(u => u.data?.isAlive && u.hasFreeSkillSlot);
  }

  /**
   * 为一个单位随机学一个新技能。
   * 会排除已学技能；技能位已满或卡池已空时返回 null（不产生任何副作用），
   * 让调用方决定是否扣费/提示。
   */
  private learnRandomSkillFor(unit: UnitController | null): SkillConfig | null {
    if (!unit?.data || !unit.hasFreeSkillSlot) return null;
    const classConfig = CLASSES.find(c => c.id === unit.data!.classId);
    if (!classConfig) return null;
    const learnedIds = unit.data.skills.map(s => s.id);
    const pool = classConfig.skillPool.filter(id => !learnedIds.includes(id));
    const skills = getRandomSkillsFromPool(pool, 1);
    if (skills.length === 0) return null;
    return unit.addSkill(skills[0]) ? skills[0] : null;
  }

  private closeShop(): void {
    if (this.shopPanel) {
      this.shopPanel.active = false;
    }
    this._panelFeedback = '';
    this.completeNonBattleNode();
  }

  private openRest(): void {
    this._state = 'rest';
    this.setHudVisible(true, false);
    this.routeMapUI.hide();

    if (this.restPanel) {
      this.restPanel.active = true;
    }
    this._restOptionIndex = -1;
    this._panelFeedback = '';
    this.renderRest();
  }

  private triggerEvent(): void {
    this._state = 'event';
    this.setHudVisible(true, false);
    this.routeMapUI.hide();

    const eventIdx = Math.floor(Math.random() * EVENTS.length);
    const event = EVENTS[eventIdx];

    this.eventUI.showEvent(event, (choiceIndex) => {
      this.applyEventEffects(event, choiceIndex);
      this.eventUI.hide();
      this.completeNonBattleNode();
    }, this._runData.gold, this.hasAnyFreeSkillSlot(), this.luckPercent());
  }

  /** 天赋「幸运儿」：随机事件好结果概率 +20%/次 */
  private luckPercent(): number {
    return this._runData.talents.filter(t => t === 'lucky').length * 20;
  }

  /**
   * 应用事件选项的效果。
   *
   * **两遍执行**：先跑"交付类"效果，再跑"代价类"（`spend_gold`），且只有在交付成功时才收代价。
   * 原实现按数据顺序执行，而 `spend_gold` 在数据里排在前 ⇒ 先扣款；若随后的 `learn_skill`
   * 因技能位已满而失败，玩家就白花 10 金币（实测金币 95→85、三个单位技能数完全不变）。
   * 商店的同名路径早已改成"先学、成功才扣费"，这里补齐到同一语义。
   */
  private applyEventEffects(event: import('./config/GameData').EventConfig, choiceIndex: number): void {
    let effects: { type: string; params: Record<string, number> }[] | undefined;
    if (event.type === 'choice') {
      effects = event.choices?.[choiceIndex]?.effects;
    } else if (event.type === 'random') {
      effects = event.randomOutcomes?.[choiceIndex]?.effects;
    }

    if (effects && effects.length > 0) {
      const payload = effects.filter(e => e.type !== 'spend_gold');
      const costs = effects.filter(e => e.type === 'spend_gold');

      let delivered = payload.length === 0;
      for (const effect of payload) {
        if (this.applySingleEffect(effect.type, effect.params)) delivered = true;
      }
      // 什么都没交付 → 不收代价（纯代价选项除外：payload 为空时按数据照收）
      if (delivered) {
        for (const effect of costs) {
          this.applySingleEffect(effect.type, effect.params);
        }
      } else {
        console.info('[Event] 本次选项未交付任何结果，跳过代价结算');
      }
    }
    this.updateGoldDisplay();
  }

  /**
   * 应用单个事件效果。
   * @returns 该效果是否**真的交付了结果** —— `spend_gold` 据此决定收不收费
   *          （见 `applyEventEffects` 的两遍执行）。
   */
  private applySingleEffect(type: string, params: Record<string, number>): boolean {
    switch (type) {
      case 'heal_all':
        for (const unit of this.battleManager.playerUnits) {
          unit.heal(params.amount ?? 3);
        }
        return true;

      case 'gain_gold':
        this._runData.gold += params.amount ?? 10;
        return true;

      case 'spend_gold':
        this._runData.gold = Math.max(0, this._runData.gold - (params.amount ?? 10));
        return true;

      case 'damage_all':
        for (const unit of this.battleManager.playerUnits) {
          unit.takeDamage(params.amount ?? 1);
        }
        return true;

      case 'learn_skill':
      case 'learn_rare_skill': {
        // 与商店一致：排除已学技能、技能位满时不产生副作用；
        // 并且**自动挑一个还能学的单位**（原先死盯 0 号单位 —— 它一旦满位，
        // 本局所有"学技能"类奖励就全部失效了）
        const unit = this.pickUnitForNewSkill();
        const learned = unit ? this.learnRandomSkillFor(unit) : null;
        if (learned) this._syncUnitSkillsToRunData();
        return !!learned;
      }

      case 'buff_all_attack':
        for (const unit of this.battleManager.playerUnits) {
          if (unit.data) {
            unit.data.stats.attack += params.amount ?? 1;
          }
        }
        return true;

      case 'debuff_random_attack': {
        const alive = this.battleManager.playerUnits.filter(u => u.data?.isAlive);
        if (alive.length > 0) {
          const target = alive[Math.floor(Math.random() * alive.length)];
          if (target.data) {
            target.data.stats.attack = Math.max(0, target.data.stats.attack - (params.amount ?? 1));
          }
          return true;
        }
        return false;
      }

      case 'sacrifice_hp': {
        const unit = this.battleManager.playerUnits[0];
        if (unit?.data?.isAlive) {
          unit.takeDamage(params.amount ?? 1);
          return true;
        }
        return false;
      }

      case 'buff_energy_max':
        for (const unit of this.battleManager.playerUnits) {
          if (unit.data) {
            unit.data.maxEnergy += params.amount ?? 1;
          }
        }
        return true;
    }
    // 未知效果类型：视为没有交付，不收代价
    return false;
  }

  /** 将当前 playerUnits 的技能列表同步到 _runData.unitSkills */
  private _syncUnitSkillsToRunData(): void {
    if (!this.battleManager) return;
    this._runData.unitSkills = {};
    for (let i = 0; i < this.battleManager.playerUnits.length; i++) {
      const unit = this.battleManager.playerUnits[i];
      if (unit.data) {
        this._runData.unitSkills[i] = unit.data.skills.map(s => s.id);
      }
    }
  }

  private completeNonBattleNode(): void {
    this.routeMapUI.completeNode(this._currentNode?.id ?? 0);
    if (this._currentNode) {
      this._runData.currentRouteNode = this._currentNode.id;
    }
    SaveManager.saveRun(this._runData);
    this.returnToRouteMap();
  }

  private onRunComplete(victory: boolean): void {
    if (this.battleUI) this.battleUI.hide();
    // 战斗单位是 BattleManager 的直接子节点。原先只关 gridController（网格），
    // 最后一关残留的敌人会叠在通关/失败面板上（实测 5 个单位显示在面板前）。
    if (this.battleManager?.node?.isValid) {
      this.battleManager.node.active = false;
    }
    if (this.battleManager?.gridController?.node) {
      this.battleManager.gridController.node.active = false;
    }
    // 结算页不需要任何 HUD（回合与金币一并收起）
    this.setHudVisible(false, false);
    if (this.routeMapUI) this.routeMapUI.hide();
    // 终局态：原先两种结算都停在 'battle'（GameState 里的 'game_over' 从未被赋值过）
    this._state = victory ? 'run_victory' : 'game_over';

    if (victory) {
      this._runData.honor += 100;

      // 本局**实际入账**的荣誉：honor 存在 meta 里、跨局累积，不能拿绝对值当收益。
      // 原来通关面板写死 "+100"、失败面板用 `honor - 100` 猜本局起点 ——
      // 实测失败时本局只 +1，面板却显示 "获得 +21 荣誉"。
      const honorGain = this._runData.honor - this._honorAtRunStart;
      // 摘要里的关卡用**路线节点序号**（设计 §4.1 的关卡概念）。
      // 原来用 _battleCount（战斗场次），通关时会显示"抵达第 4 关"，而实际已在第 9 节点/Boss。
      const routeNo = this.routeNo;
      const totalLayers = this.totalRouteLayers;

      // 两个结算面板互斥：Boss 关通关与失败可能连续触发，不收起另一个会叠版
      if (this.gameOverPanel) this.gameOverPanel.active = false;
      if (this.victoryPanel) {
        this.victoryPanel.active = true;
      }
      // P2 统一版式：标题固定，数据写进两行摘要（不再往标题 Label 里拼多行字符串）
      this.fillPanelSummary(this.victoryPanel, 1, `\u62B5\u8FBE\u7B2C ${routeNo}/${totalLayers} \u5173`);
      this.fillPanelSummary(this.victoryPanel, 2, `\u8363\u8A89 +${honorGain} \u00B7 \u91D1\u5E01 ${this._runData.gold}`);
    } else {
      if (this.victoryPanel) this.victoryPanel.active = false;
      if (this.gameOverPanel) {
        this.gameOverPanel.active = true;
      }
      // 标题兜底：场景若被改动仍保证文案正确（GameOverLabel 即 GameOverPanel 的标题节点）
      if (this.gameOverLabel) {
        this.gameOverLabel.string = '\u6E38\u620F\u7ED3\u675F';
      }
      const honorGain = this._runData.honor - this._honorAtRunStart;
      const routeNo = this.routeNo;
      const totalLayers = this.totalRouteLayers;
      this.fillPanelSummary(this.gameOverPanel, 1, `\u62B5\u8FBE\u7B2C ${routeNo}/${totalLayers} \u5173`);
      this.fillPanelSummary(this.gameOverPanel, 2, `\u83B7\u5F97 +${honorGain} \u8363\u8A89`);
    }

    SaveManager.saveMeta(this.buildMeta());

    if (victory) {
      this.checkAchievements();
      // checkAchievements 可能修改了 unlockedClasses，重新保存 meta
      SaveManager.saveMeta(this.buildMeta());
    }

    SaveManager.clearRun();
  }

  // -------------------------------------------------------------------------
  // 荣誉天赋树（设计 §6.2）
  // -------------------------------------------------------------------------

  /** 交给 TalentUI 的宿主接口（余额查询 + 购买落到 meta） */
  private readonly talentHost: TalentUiHost = {
    getHonorBalance: () => this.honorBalance(),
    getPurchases: (talentId: string) => this._runData.talents.filter(t => t === talentId).length,
    purchaseTalent: (talentId: string) => this.buyTalent(talentId),
  };

  /** 可用荣誉 = 累计获得 − 已消费（`honor` 仍保留累计值供成就判定） */
  private honorBalance(): number {
    return Math.max(0, this._runData.honor - (this._runData.honorSpent ?? 0));
  }

  /** 购买一次天赋：校验限购/余额 → 扣荣誉 → 写 talents → 存 meta */
  private buyTalent(talentId: string): boolean {
    const cfg = TALENTS.find(t => t.id === talentId);
    if (!cfg) return false;
    const owned = this._runData.talents.filter(t => t === talentId).length;
    if (owned >= cfg.maxPurchases) return false;
    if (this.honorBalance() < cfg.cost) return false;

    this._runData.honorSpent = (this._runData.honorSpent ?? 0) + cfg.cost;
    this._runData.talents.push(talentId);
    SaveManager.saveMeta(this.buildMeta());
    console.info(`[Talent] 购买 ${cfg.name}（${cfg.cost} 荣誉，已购 ${owned + 1}/${cfg.maxPurchases}）`);
    return true;
  }

  /** meta 快照（几处存档共用一个口径，避免漏字段） */
  private buildMeta(): {
    honor: number; honorSpent: number; talents: string[];
    unlockedClasses: string[]; unlockedSkills: string[];
  } {
    return {
      honor: this._runData.honor,
      honorSpent: this._runData.honorSpent ?? 0,
      talents: this._runData.talents,
      unlockedClasses: this._runData.unlockedClasses,
      unlockedSkills: this._runData.unlockedSkills,
    };
  }

  /**
   * 把已购天赋应用到本场新建的单位上（设计 §6.2 的 9 种效果）。
   *
   * 写入 `baseStats`：`resetForNewBattle` 会用 baseStats 重算 stats，这样跨战斗不会被清掉。
   * 「启动资金」不在这里（金币是局级资源，在 startClassSelect 发）；「议价 / 幸运儿」
   * 在各自的消费/抽取点生效（见 shopPrice / triggerEvent）。
   */
  private applyTalentsToParty(): void {
    const units = this.battleManager?.playerUnits ?? [];
    if (units.length === 0 || !units[0]?.data) return;

    const count = (id: string) => this._runData.talents.filter(t => t === id).length;
    const atk = count('power_up');
    const hp = count('hp_up');
    const def = count('armor_up');
    const energyMax = count('energy_up');
    const energyRegen = count('energy_regen');
    const masteryAtk = count('class_mastery') * 2;
    const firstClass = units[0].data.classId;

    for (const u of units) {
      if (!u.data) continue;
      const d = u.data;
      const bonusAtk = atk + (d.classId === firstClass ? masteryAtk : 0);
      if (bonusAtk > 0) {
        d.baseStats.attack += bonusAtk;
        d.stats.attack += bonusAtk;
      }
      if (hp > 0) {
        d.baseStats.hp += hp;
        d.maxHp += hp;
        d.currentHp = Math.min(d.currentHp + hp, d.maxHp);
      }
      if (def > 0) {
        d.baseStats.defense += def;
        d.stats.defense += def;
      }
      if (energyMax > 0) {
        d.baseStats.maxEnergy += energyMax;
        d.maxEnergy += energyMax;
        d.energy = Math.min(d.energy + energyMax, d.maxEnergy);
      }
      if (energyRegen > 0) {
        d.energyRegen += energyRegen;
      }
      if (hp > 0) u.refreshHealthBarVisual();
    }
  }

  /**
   * 天赋「议价」：商店价格每级 -10%。
   * 用 floor 而不是 round：5×0.9 = 4.5，四舍五入回 5 等于折扣无效；
   * 向下取整后 5→4、10→9（两级 5→4、10→8），玩家能看见变化。
   */
  /**
   * 战后经验结算（把"每人每场都升级"改成按贡献升级）。
   *
   * 经验来源全在 `UnitController.takeDamage` 里记账（记在**攻击方**身上）：
   * 参战 +2、每击杀 +5、每 10 点有效伤害 +1；精英 ×1.5、Boss ×2。
   * **阵亡单位不结算** —— 这是本作第一次让"送人头"有代价。
   */
  private awardBattleExp(isElite: boolean, isBoss: boolean): void {
    const units = this.battleManager?.playerUnits ?? [];
    const mult = isBoss ? 2 : (isElite ? 1.5 : 1);
    const leveled: UnitController[] = [];

    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      if (!unit?.data || !unit.data.isAlive) continue;

      const raw = EXP_PARTICIPATE
        + unit.data.kills * EXP_PER_KILL
        + Math.floor(unit.data.damageDealt / EXP_PER_DAMAGE);
      const gained = Math.max(1, Math.round(raw * mult));

      const progress = ensureProgress(this._runData, i);
      progress.exp += gained;

      let leveledUp = false;
      while (progress.exp >= expToNext(progress.level)) {
        progress.exp -= expToNext(progress.level);
        progress.level += 1;
        leveledUp = true;
      }
      if (leveledUp) leveled.push(unit);
      console.info(`[EXP] ${unit.data.name} +${gained}\uFF08\u51FB\u6740 ${unit.data.kills} \u00B7 \u8F93\u51FA ${unit.data.damageDealt}\uFF09\u2192 Lv${progress.level}`);
    }

    this._leveledUnits = leveled;
  }

  /**
   * 把局内成长灌回本场新建的单位（永久属性 / 额外技能栏）。
   *
   * 必须在**恢复技能之前**调用：`skillSlotBonus` 决定 `addSkill` 的上限，
   * 否则圣泉给的"技能栏 +1"会在下一场把第 4 个技能挡在门外。
   */
  private applyRunProgressToParty(): void {
    const units = this.battleManager?.playerUnits ?? [];
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      if (!unit?.data) continue;
      const progress = ensureProgress(this._runData, i);
      const d = unit.data;

      d.skillSlotBonus = progress.extraSkillSlots;

      if (progress.bonus.attack > 0) {
        d.baseStats.attack += progress.bonus.attack;
        d.stats.attack += progress.bonus.attack;
      }
      if (progress.bonus.defense > 0) {
        d.baseStats.defense += progress.bonus.defense;
        d.stats.defense += progress.bonus.defense;
      }
      if (progress.bonus.hp > 0) {
        d.baseStats.hp += progress.bonus.hp;
        d.maxHp += progress.bonus.hp;
        d.currentHp = Math.min(d.currentHp + progress.bonus.hp, d.maxHp);
        unit.refreshHealthBarVisual();
      }
      if (progress.bonus.maxEnergy > 0) {
        d.baseStats.maxEnergy += progress.bonus.maxEnergy;
        d.maxEnergy += progress.bonus.maxEnergy;
        d.energy = Math.min(d.energy + progress.bonus.maxEnergy, d.maxEnergy);
      }
    }
  }

  private shopPrice(base: number): number {
    const discount = this._runData.talents.filter(t => t === 'discount').length * 10;
    return Math.max(1, Math.floor(base * (100 - discount) / 100));
  }

  /** 借场景里已在用的纯色贴图（运行时创建的节点必须有 spriteFrame 才绘制） */
  private getSolidFrame(): SpriteFrame | null {
    const donors = [
      this.classSelectPanel?.getChildByName('StartBtn'),
      this.shopPanel?.getChildByName('CloseBtn'),
      this.victoryPanel?.getChildByName('ReturnBtn'),
    ];
    for (const d of donors) {
      const sp = d?.isValid ? d.getComponent(Sprite) : null;
      if (sp?.spriteFrame) return sp.spriteFrame;
    }
    return null;
  }

  /**
   * 职业选择页的「荣誉天赋」入口。
   * 运行时创建而不改场景：面板内容本就由 TALENTS 数据驱动，场景里只多一个按钮没有收益；
   * 位置放在 StartBtn 下方的空白区（面板 640×720 的下半部分原本是空的）。
   */
  private ensureTalentEntry(): void {
    const panel = this.classSelectPanel;
    if (!panel?.isValid) return;
    if (panel.getChildByName('TalentBtn')) return;

    const btnNode = new Node('TalentBtn');
    const ui = btnNode.addComponent(UITransform);
    ui.setContentSize(200, CONTROL.BTN_HEIGHT);
    const sp = btnNode.addComponent(Sprite);
    // 先 CUSTOM 再赋贴图：否则赋贴图会把尺寸改成贴图原始尺寸（AGENTS 教训 C）
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    const frame = this.getSolidFrame();
    if (frame) sp.spriteFrame = frame;
    sp.color = hex(COLOR.SURFACE);
    const btn = btnNode.addComponent(Button);
    applyButtonTheme(btn, 'secondary');
    btnNode.on(Node.EventType.TOUCH_END, this.onTalentClicked, this);

    const labelNode = new Node('Label');
    const labelUi = labelNode.addComponent(UITransform);
    labelUi.setContentSize(200, FONT_BODY.lineHeight);
    const lb = labelNode.addComponent(Label);
    lb.string = '🏅 荣誉天赋';
    applyFontAndColor(lb, FONT_BODY, COLOR.TEXT_PRIMARY);
    lb.horizontalAlign = Label.HorizontalAlign.CENTER;
    lb.verticalAlign = Label.VerticalAlign.CENTER;
    btnNode.addChild(labelNode);

    const panelUi = panel.getComponent(UITransform);
    const local = panelUi
      ? panelUi.convertToNodeSpaceAR(new Vec3(360, 430, 0))
      : new Vec3(0, -210, 0);
    btnNode.setPosition(local.x, local.y, 0);
    panel.addChild(btnNode);
  }

  private onTalentClicked(): void {
    const parent = this.classSelectPanel ?? this.node;
    if (!this._talentUI) this._talentUI = new TalentUI(this.talentHost);
    this._talentUI.show(parent, this.getSolidFrame());
  }

  private checkAchievements(): void {
    if (this._runData.unlockedClasses.length < 5 && !this._runData.unlockedClasses.includes('knight')) {
      this._runData.unlockedClasses.push('knight');
    }

    const runsCompleted = SaveManager.loadMeta()?.honor ?? 0;
    if (runsCompleted >= 300 && !this._runData.unlockedClasses.includes('assassin')) {
      this._runData.unlockedClasses.push('assassin');
    }
  }

  /**
   * 顶部 HUD（HudTop 下的回合/金币）显隐的唯一出口。
   * HudTop 是 Canvas 根级常驻节点，不属于 BattleUI —— 若让 BattleUI 与本类
   * 各管一半，非战斗界面就会残留 HUD（实测职业选择页只显示「回合 1」，
   * 金币被本类关掉、回合无人管，左右不对称）。
   * 约定：金币在局内（路线图起）可见；回合仅战斗可见。
   */
  private setHudVisible(gold: boolean, turn: boolean): void {
    if (this.goldLabel?.node?.isValid) this.goldLabel.node.active = gold;
    if (this.turnLabel?.node?.isValid) this.turnLabel.node.active = turn;
  }

  private updateGoldDisplay(): void {
    if (this.goldLabel) {
      this.goldLabel.string = `\uD83D\uDCB0 ${this._runData.gold}`;
    }
  }

  restartFromRouteMap(): void {
    if (this.victoryPanel) this.victoryPanel.active = false;
    if (this.gameOverPanel) this.gameOverPanel.active = false;
    if (this.battleUI) this.battleUI.hide();
    if (this.upgradeUI) this.upgradeUI.hide();
    if (this.eventUI) this.eventUI.hide();
    if (this.shopPanel) this.shopPanel.active = false;
    if (this.restPanel) this.restPanel.active = false;

    this._state = 'class_select';
    this._selectedClasses = [];
    SaveManager.clearRun();
    this.resetClassSelectionVisual();

    if (this.battleManager?.node?.isValid) {
      this.battleManager.node.active = false;
      if (this.battleManager.gridController?.node) {
        this.battleManager.gridController.node.active = false;
      }
    }
    // 回到职业选择：HUD 整体收起（原只关 goldLabel，turnLabel 残留）
    this.setHudVisible(false, false);
    if (this.classSelectPanel) {
      this.classSelectPanel.active = true;
    }
    if (this.routeMapUI) {
      this.routeMapUI.hide();
    }
  }

  onDestroy(): void {
    // 场景销毁时各子节点会一并销毁并自动解绑事件；
    // 按规范 onDestroy 不访问任何 @property(Node)，仅清理 JS 引用。
    this.battleManager = null;
    this.routeMapUI = null;
    this.battleUI = null;
    this.upgradeUI = null;
    this.eventUI = null;
  }
}
