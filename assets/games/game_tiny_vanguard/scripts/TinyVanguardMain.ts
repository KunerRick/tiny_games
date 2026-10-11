import { _decorator, Component, Node, Label, Button, Sprite } from 'cc';
import { COLOR, hex, applyButtonTheme, ButtonVariant } from './config/Theme';
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
  | 'shop' | 'rest' | 'event' | 'game_over' | 'class_select';

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
    if (this.goldLabel?.node) {
      this.goldLabel.node.active = false;
    }

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
      this._selectedClasses.push(classId);
      this.setClassButtonVisual(btn.node, true);
    }
    this.updateStartBtnInteractable();
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

    if (this.goldLabel?.node) {
      this.goldLabel.node.active = true;
    }

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
        this.battleUI.selectDeployCard(index);
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
    this.battleUI.setupPlatoonCards(unitNames, unitIcons, (index) => {
      this.battleManager.selectDeployUnit(index);
    });
    this.battleManager.setDeployUnitPlacedCallback((placed, total) => {
      // 三态更新：遍历所有单位，根据放置状态更新卡片
      for (let i = 0; i < this.battleManager.playerUnits.length; i++) {
        const unit = this.battleManager.playerUnits[i];
        const isPlaced = unit.data?.gridPos.col >= 0;
        this.battleUI.setDeployCardState(i, isPlaced ? 'placed' : 'unplaced');
      }
    });

    this.battleManager.startBattle(
      this._runData.playerClasses,
      this._currentDifficulty,
      isElite,
      isBoss,
      (result) => this.onBattleEnd(result)
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
    this.routeMapUI.hide();

    if (this.shopPanel) {
      this.shopPanel.active = true;
    }
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
    const firstUnit = this.battleManager?.playerUnits?.[0] ?? null;
    const learned = this.learnRandomSkillFor(firstUnit);
    if (!learned) {
      console.info('[Shop] \u65E0\u6CD5\u5B66\u4E60\u65B0\u6280\u80FD\uFF08\u6280\u80FD\u4F4D\u5DF2\u6EE1\u6216\u5DF2\u5168\u90E8\u5B66\u4F1A\uFF09\uFF0C\u672C\u6B21\u4E0D\u6263\u91D1\u5E01');
      return;
    }

    this._runData.gold -= 10;
    this._syncUnitSkillsToRunData();
    this.updateGoldDisplay();
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
  }

  private closeShop(): void {
    if (this.shopPanel) {
      this.shopPanel.active = false;
    }
    this.completeNonBattleNode();
  }

  private openRest(): void {
    this._state = 'rest';
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
    this.routeMapUI.hide();

    const eventIdx = Math.floor(Math.random() * EVENTS.length);
    const event = EVENTS[eventIdx];

    this.eventUI.showEvent(event, (choiceIndex) => {
      this.applyEventEffects(event, choiceIndex);
      this.eventUI.hide();
      this.completeNonBattleNode();
    }, this._runData.gold);
  }

  private applyEventEffects(event: import('./config/GameData').EventConfig, choiceIndex: number): void {
    if (event.type === 'choice' && event.choices?.[choiceIndex]) {
      const effects = event.choices[choiceIndex].effects;
      for (const effect of effects) {
        this.applySingleEffect(effect.type, effect.params);
      }
    } else if (event.type === 'random' && event.randomOutcomes?.[choiceIndex]) {
      const effects = event.randomOutcomes[choiceIndex].effects;
      for (const effect of effects) {
        this.applySingleEffect(effect.type, effect.params);
      }
    }
    this.updateGoldDisplay();
  }

  private applySingleEffect(type: string, params: Record<string, number>): void {
    switch (type) {
      case 'heal_all':
        for (const unit of this.battleManager.playerUnits) {
          unit.heal(params.amount ?? 3);
        }
        break;

      case 'gain_gold':
        this._runData.gold += params.amount ?? 10;
        break;

      case 'spend_gold':
        this._runData.gold = Math.max(0, this._runData.gold - (params.amount ?? 10));
        break;

      case 'damage_all':
        for (const unit of this.battleManager.playerUnits) {
          unit.takeDamage(params.amount ?? 1);
        }
        break;

      case 'learn_skill':
      case 'learn_rare_skill': {
        // 与商店一致：排除已学技能、技能位满时不产生副作用
        this.learnRandomSkillFor(this.battleManager.playerUnits[0] ?? null);
        this._syncUnitSkillsToRunData();
        break;
      }

      case 'buff_all_attack':
        for (const unit of this.battleManager.playerUnits) {
          if (unit.data) {
            unit.data.stats.attack += params.amount ?? 1;
          }
        }
        break;

      case 'debuff_random_attack': {
        const alive = this.battleManager.playerUnits.filter(u => u.data?.isAlive);
        if (alive.length > 0) {
          const target = alive[Math.floor(Math.random() * alive.length)];
          if (target.data) {
            target.data.stats.attack = Math.max(0, target.data.stats.attack - (params.amount ?? 1));
          }
        }
        break;
      }

      case 'sacrifice_hp': {
        const unit = this.battleManager.playerUnits[0];
        if (unit?.data?.isAlive) {
          unit.takeDamage(params.amount ?? 1);
        }
        break;
      }

      case 'buff_energy_max':
        for (const unit of this.battleManager.playerUnits) {
          if (unit.data) {
            unit.data.maxEnergy += params.amount ?? 1;
          }
        }
        break;
    }
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
    if (this.battleManager?.gridController?.node) {
      this.battleManager.gridController.node.active = false;
    }
    if (this.goldLabel?.node) {
      this.goldLabel.node.active = false;
    }
    if (this.routeMapUI) this.routeMapUI.hide();

    if (victory) {
      this._runData.honor += 100;

      if (this.victoryPanel) {
        this.victoryPanel.active = true;
      }
      // P2 统一版式：标题固定，数据写进两行摘要（不再往标题 Label 里拼多行字符串）
      this.fillPanelSummary(this.victoryPanel, 1, `\u62B5\u8FBE\u7B2C ${this._battleCount} \u5173`);
      this.fillPanelSummary(this.victoryPanel, 2, `\u8363\u8A89 +100 \u00B7 \u91D1\u5E01 ${this._runData.gold}`);
    } else {
      if (this.gameOverPanel) {
        this.gameOverPanel.active = true;
      }
      // 标题兜底：场景若被改动仍保证文案正确（GameOverLabel 即 GameOverPanel 的标题节点）
      if (this.gameOverLabel) {
        this.gameOverLabel.string = '\u6E38\u620F\u7ED3\u675F';
      }
      const honorGain = this._runData.honor > 100 ? this._runData.honor - 100 : 0;
      this.fillPanelSummary(this.gameOverPanel, 1, `\u62B5\u8FBE\u7B2C ${this._battleCount} \u5173`);
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

    if (this.battleManager) {
      this.battleManager.node.active = false;
      if (this.battleManager.gridController?.node) {
        this.battleManager.gridController.node.active = false;
      }
    }
    if (this.goldLabel?.node) {
      this.goldLabel.node.active = false;
    }
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
