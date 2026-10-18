import { _decorator, Component, Node, Label, Button, Sprite, UITransform } from 'cc';
import { COLOR, CONTROL, FONT_BODY, applyFont, hex, applyButtonTheme, ButtonVariant } from './config/Theme';
import { RouteMapUI, RouteNode } from './ui/RouteMapUI';
import { BattleManager, BattleResult, UnitActionPhase } from './battle/BattleManager';
import { UpgradeUI, UpgradeOption } from './ui/UpgradeUI';
import { EventUI } from './ui/EventUI';
import { BattleUI } from './ui/BattleUI';
import { SaveManager, RunData } from './ui/SaveManager';
import {
  CLASSES, EVENTS, getClassById, getSkillById, getRandomSkillsFromPool,
  SkillConfig, SKILLS
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
  if (skill.type === 'passive') return '\uD83D\uDEE1\uFE0F';        // 🛡️
  switch (skill.targetType) {
    case 'aoe': return '\uD83D\uDCA5';                              // 💥
    case 'ally': return '\u2764\uFE0F';                             // ❤️
    case 'tile': return '\uD83C\uDF00';                             // 🌀
    case 'self': return '\u2728';                                   // ✨
    default: return '\u2694\uFE0F';                                 // ⚔️
  }
}

/** 属性增益卡图标 */
const BUFF_ICON: Record<string, string> = {
  hp: '\u2764\uFE0F',      // ❤️
  attack: '\u2694\uFE0F',  // ⚔️
  energy: '\u26A1',        // ⚡
};

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
    // 商店
    if (this.shopPanel) {
      setBtn(this.shopPanel.getChildByName('BuySkillBtn'), 'primary');
      setBtn(this.shopPanel.getChildByName('HealBtn'), 'success');
      setBtn(this.shopPanel.getChildByName('CloseBtn'), 'danger');
    }
    // 休息
    if (this.restPanel) {
      setBtn(this.restPanel.getChildByName('ConfirmRestBtn'), 'success');
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

  /** 商店/休息面板的小按钮统一到设计令牌（幂等） */
  private normalizeSmallPanelButtons(): void {
    const norm = (node: Node | null): void => {
      if (!node?.isValid) return;
      const ui = node.getComponent(UITransform);
      if (ui) ui.setContentSize(ui.width, CONTROL.BTN_HEIGHT);
      applyFont(node.getComponentInChildren(Label), FONT_BODY);
    };
    for (const name of ['BuySkillBtn', 'HealBtn', 'CloseBtn']) {
      norm(this.shopPanel?.getChildByName(name) ?? null);
    }
    for (const name of ['ConfirmRestBtn', 'SkipBtn']) {
      norm(this.restPanel?.getChildByName(name) ?? null);
    }
  }

  /**
   * 商店按钮可用性：买不起 / 全队没单位能学 → 置灰。
   * 原先这两个按钮外观永远是"可点"，点了只写一行 console（实测金币 4 < 10 时
   * 点"买技能 - 10金币"毫无反应）。与事件面板的金币不足置灰保持一致。
   */
  private updateShopButtons(): void {
    const setEnabled = (node: Node | null, enabled: boolean): void => {
      const btn = node?.getComponent(Button);
      if (btn) btn.interactable = enabled;
    };
    setEnabled(
      this.shopPanel?.getChildByName('BuySkillBtn') ?? null,
      this._runData.gold >= 10 && this.hasAnyFreeSkillSlot()
    );
    setEnabled(this.shopPanel?.getChildByName('HealBtn') ?? null, this._runData.gold >= 5);
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

  private bindShopPanelEvents(): void {
    if (!this.shopPanel) return;
    const buyBtn = this.shopPanel.getChildByName('BuySkillBtn');
    if (buyBtn) {
      const btn = buyBtn.getComponent(Button);
      if (btn) btn.node.on(Button.EventType.CLICK, this.onShopBuySkill, this);
    }
    const healBtn = this.shopPanel.getChildByName('HealBtn');
    if (healBtn) {
      const btn = healBtn.getComponent(Button);
      if (btn) btn.node.on(Button.EventType.CLICK, this.onShopHeal, this);
    }
    const closeBtn = this.shopPanel.getChildByName('CloseBtn');
    if (closeBtn) {
      const btn = closeBtn.getComponent(Button);
      if (btn) btn.node.on(Button.EventType.CLICK, this.closeShop, this);
    }
  }

  private bindRestPanelEvents(): void {
    if (!this.restPanel) return;
    const confirmBtn = this.restPanel.getChildByName('ConfirmRestBtn');
    if (confirmBtn) {
      const btn = confirmBtn.getComponent(Button);
      if (btn) btn.node.on(Button.EventType.CLICK, this.confirmRest, this);
    }
    const skipBtn = this.restPanel.getChildByName('SkipBtn');
    if (skipBtn) {
      const btn = skipBtn.getComponent(Button);
      if (btn) btn.node.on(Button.EventType.CLICK, this.skipRest, this);
    }
  }

  private unbindShopPanelEvents(): void {
    if (!this.shopPanel?.isValid) return;
    const buyBtn = this.shopPanel.getChildByName('BuySkillBtn');
    if (buyBtn?.isValid) {
      const btn = buyBtn.getComponent(Button);
      if (btn) btn.node.off(Button.EventType.CLICK, this.onShopBuySkill, this);
    }
    const healBtn = this.shopPanel.getChildByName('HealBtn');
    if (healBtn?.isValid) {
      const btn = healBtn.getComponent(Button);
      if (btn) btn.node.off(Button.EventType.CLICK, this.onShopHeal, this);
    }
    const closeBtn = this.shopPanel.getChildByName('CloseBtn');
    if (closeBtn?.isValid) {
      const btn = closeBtn.getComponent(Button);
      if (btn) btn.node.off(Button.EventType.CLICK, this.closeShop, this);
    }
  }

  private unbindRestPanelEvents(): void {
    if (!this.restPanel?.isValid) return;
    const confirmBtn = this.restPanel.getChildByName('ConfirmRestBtn');
    if (confirmBtn?.isValid) {
      const btn = confirmBtn.getComponent(Button);
      if (btn) btn.node.off(Button.EventType.CLICK, this.confirmRest, this);
    }
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
    this._runData.currentRouteNode = 0;
    // 新开局：丢弃上一局的布阵（职业组合已变，旧阵型无意义）
    this._runData.deployLayout = undefined;

    this.startNewRun();
  }

  private onContinueRun(): void {
    const saved = SaveManager.loadRun();
    if (saved) {
      this._runData = saved;
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

    // 路线图：金币可见（局内资源）、回合隐藏（仅战斗有意义）
    this.setHudVisible(true, false);

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
      // 自动跳过提示
      this.battleManager.setAutoSkipCallback((unitName) => {
        this.battleUI.showAutoSkipNotice(unitName);
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
      return config ? config.icon : '';
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
          const hint = actionPhase === 'move' ? '\u70B9\u51FB\u53EF\u79FB\u52A8\u4F4D\u7F6E' :
                       actionPhase === 'attack_target' ? '\u9009\u62E9\u653B\u51FB\u76EE\u6807' :
                       actionPhase === 'skill_target' ? '\u9009\u62E9\u6280\u80FD\u76EE\u6807\uFF0C\u518D\u6B21\u70B9\u51FB\u786E\u8BA4' :
                       actionPhase === 'skill_target_aoe' ? '\u9009\u62E9AOE\u4E2D\u5FC3\u70B9\uFF0C\u518D\u6B21\u70B9\u51FB\u786E\u8BA4' :
                       '\u70B9\u51FB\u653B\u51FB\u6309\u94AE\u6216\u6280\u80FD\u6309\u94AE';
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

      const skillNames = selected.data.skills.map(s => `${s.name} [${s.energyCost}\u26A1]`);
      const canUse = selected.data.skills.map((_, i) =>
        this.battleManager.canUseSkillWithTargets(selected, i)
      );
      this.battleUI.showSkillButtons(skillNames, canUse, (index) => {
        this.battleManager.onSkillUsed(index);
        this.updateBattleUI();
      });
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
      this.battleUI.showDefeat(`\u62B5\u8FBE\u7B2C ${this._battleCount} \u5173 \u00B7 \u9020\u6210\u4F24\u5BB3 ${this.battleManager.totalDamageDealt}`);
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

  private showUpgradeScreen(): void {
    const allOptions = this.generateUpgradeOptions();
    const unitNames = this.alivePlayerUnits.map(u => u.data!.name);

    if (allOptions.length === 0 || unitNames.length === 0) {
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
        // 跳过该单位的本次升级：不应用任何增益，仅继续下一位
        const unit = this.alivePlayerUnits[unitIndex];
        const name = unit?.data?.name ?? `#${unitIndex}`;
        console.info(`[UpgradeUI] \u8DF3\u8FC7 ${name} \u7684\u672C\u6B21\u5347\u7EA7`);
      }
    );
  }

  /** 存活单位（升级选项与结算统一按此列表寻址，避免用 playerUnits 全量下标而错位） */
  private get alivePlayerUnits(): UnitController[] {
    return this.battleManager.playerUnits.filter(u => u.data?.isAlive);
  }

  private generateUpgradeOptions(): UpgradeOption[][] {
    const result: UpgradeOption[][] = [];

    for (const unit of this.alivePlayerUnits) {
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
        { name: '\u2764\uFE0F +1 \u6700\u5927\u8840\u91CF', buffType: 'hp', buffAmount: 1 },
        { name: '\u2694\uFE0F +1 \u653B\u51FB\u529B', buffType: 'attack', buffAmount: 1 },
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
    const unit = this.alivePlayerUnits[unitIndex];
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
    }
    this._syncUnitSkillsToRunData();
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
    this.updateShopButtons();
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

  private onShopBuySkill(): void {
    if (this._runData.gold < 10) return;

    // 先尝试学习，成功才扣费：原先无条件扣 10 金币，而技能位已满或随机到
    // 已学技能时 addSkill 会被拒绝 → 玩家花了钱却没得到任何东西
    // 学习目标由 pickUnitForNewSkill 挑（技能位未满者中技能数最少）；
    // 原先写死 0 号单位，它满位后这个购买项就永久失效
    const learner = this.pickUnitForNewSkill();
    const learned = learner ? this.learnRandomSkillFor(learner) : null;
    // 学不了时也要把按钮刷成不可点：按钮外观必须与实际能力一致，
    // 否则玩家会对着一个"看着能点"的按钮反复点（这正是本轮修的缺陷类）
    if (!learned) {
      this.updateShopButtons();
      console.info('[Shop] \u65E0\u6CD5\u5B66\u4E60\u65B0\u6280\u80FD\uFF08\u6280\u80FD\u4F4D\u5DF2\u6EE1\u6216\u5DF2\u5168\u90E8\u5B66\u4F1A\uFF09\uFF0C\u672C\u6B21\u4E0D\u6263\u91D1\u5E01');
      return;
    }

    this._runData.gold -= 10;
    this._syncUnitSkillsToRunData();
    this.updateGoldDisplay();
    this.updateShopButtons();
  }

  private onShopHeal(): void {
    if (this._runData.gold < 5) return;
    this._runData.gold -= 5;

    for (const unit of this.battleManager.playerUnits) {
      if (unit.data?.isAlive) {
        unit.heal(2);
      }
    }
    this.updateGoldDisplay();
    this.updateShopButtons();
  }

  private closeShop(): void {
    if (this.shopPanel) {
      this.shopPanel.active = false;
    }
    this.completeNonBattleNode();
  }

  private openRest(): void {
    this._state = 'rest';
    this.setHudVisible(true, false);
    this.routeMapUI.hide();

    if (this.restPanel) {
      this.restPanel.active = true;
    }
  }

  private confirmRest(): void {
    for (const unit of this.battleManager.playerUnits) {
      if (unit.data) {
        unit.healFull();
      }
    }
    if (this.restPanel) {
      this.restPanel.active = false;
    }
    this.completeNonBattleNode();
  }

  private skipRest(): void {
    if (this.restPanel) {
      this.restPanel.active = false;
    }
    this.completeNonBattleNode();
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
    }, this._runData.gold, this.hasAnyFreeSkillSlot());
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
      const routeNo = (this._currentNode?.id ?? 0) + 1;

      // 两个结算面板互斥：Boss 关通关与失败可能连续触发，不收起另一个会叠版
      if (this.gameOverPanel) this.gameOverPanel.active = false;
      if (this.victoryPanel) {
        this.victoryPanel.active = true;
      }
      // P2 统一版式：标题固定，数据写进两行摘要（不再往标题 Label 里拼多行字符串）
      this.fillPanelSummary(this.victoryPanel, 1, `\u62B5\u8FBE\u7B2C ${routeNo} \u5173`);
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
      const routeNo = (this._currentNode?.id ?? 0) + 1;
      this.fillPanelSummary(this.gameOverPanel, 1, `\u62B5\u8FBE\u7B2C ${routeNo} \u5173`);
      this.fillPanelSummary(this.gameOverPanel, 2, `\u83B7\u5F97 +${honorGain} \u8363\u8A89`);
    }

    SaveManager.saveMeta({
      honor: this._runData.honor,
      talents: this._runData.talents,
      unlockedClasses: this._runData.unlockedClasses,
      unlockedSkills: this._runData.unlockedSkills,
    });

    if (victory) {
      this.checkAchievements();
      // checkAchievements 可能修改了 unlockedClasses，重新保存 meta
      SaveManager.saveMeta({
        honor: this._runData.honor,
        talents: this._runData.talents,
        unlockedClasses: this._runData.unlockedClasses,
        unlockedSkills: this._runData.unlockedSkills,
      });
    }

    SaveManager.clearRun();
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
