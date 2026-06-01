import { _decorator, Component, Node, Label, Button, Sprite, Color } from 'cc';
import { RouteMapUI, RouteNode } from './ui/RouteMapUI';
import { BattleManager, BattleResult } from './battle/BattleManager';
import { UpgradeUI, UpgradeOption } from './ui/UpgradeUI';
import { EventUI } from './ui/EventUI';
import { BattleUI } from './ui/BattleUI';
import { SaveManager, RunData } from './ui/SaveManager';
import {
  CLASSES, EVENTS, getSkillById, getRandomSkillsFromPool,
  SkillConfig, SKILLS
} from './config/GameData';
import { UnitController } from './battle/UnitController';

const { ccclass, property } = _decorator;

const CLASS_ORDER = ['warrior', 'archer', 'mage', 'cleric'];

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
  private _selectedClasses: string[] = ['warrior', 'archer', 'mage'];
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

  private setupClassSelectionUI(): void {
    for (let i = 0; i < CLASS_ORDER.length; i++) {
      const btnName = `Class${i + 1}Btn`;
      const btnNode = this.classSelectPanel.getChildByName(btnName);
      if (!btnNode) continue;

      const btn = btnNode.getComponent(Button);
      if (!btn) continue;

      const classId = CLASS_ORDER[i];
      btnNode['_classId'] = classId;
      btn.node.on(Button.EventType.CLICK, this.onClassToggleClicked, this);

      if (this._selectedClasses.includes(classId)) {
        this.setClassButtonVisual(btnNode, true);
      }
    }

    const startBtnNode = this.classSelectPanel.getChildByName('StartBtn');
    if (startBtnNode) {
      const startBtn = startBtnNode.getComponent(Button);
      if (startBtn) {
        startBtn.node.on(Button.EventType.CLICK, this.startClassSelect, this);
      }
    }
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
  }

  private setClassButtonVisual(btnNode: Node, selected: boolean): void {
    const sprite = btnNode.getComponent(Sprite);
    if (sprite) {
      sprite.color = selected ? new Color(80, 200, 80, 255) : new Color(150, 150, 150, 255);
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
      this.routeMapUI.setNodeClickCallback((nodeId) => this.onNodeSelected(nodeId));
    }

    if (this.battleUI) {
      this.battleUI.setEndTurnCallback(() => this.onEndTurn());
      this.battleUI.setConfirmDeployCallback(() => this.onConfirmDeploy());
    }
    if (this.battleManager) {
      this.battleManager.setDamageDealtCallback((targetNode, amount) => {
        this.battleUI.showDamageNumber(targetNode, amount);
      });
    }

    this.updateGoldDisplay();
  }

  private onNodeSelected(nodeId: number): void {
    this._currentNode = this.routeMapUI.getNodeById(nodeId) ?? null;
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
    if (this.battleManager?.gridController?.node) {
      this.battleManager.gridController.node.active = true;
    }
    this.battleUI.show();
    this.battleUI.showDeployPhase();

    this.battleManager.startBattle(
      this._runData.playerClasses,
      this._currentDifficulty,
      isElite,
      isBoss,
      (result) => this.onBattleEnd(result)
    );
  }

  private onConfirmDeploy(): void {
    this.battleManager.confirmDeploy();
    this.battleUI.hideDeployPhase();

    this.updateBattleUI();
  }

  private onEndTurn(): void {
    this.battleManager.endCurrentUnitTurn();
    this.updateBattleUI();
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
        selected.canUseSkill(i) && !selected.data!.hasActed
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
      this._battleCount++;
      this.routeMapUI.completeNode(this._currentNode?.id ?? 0);
      this._runData.gold += result.goldReward;
      this._runData.honor += 5;
      SaveManager.saveRun(this._runData);
      this.updateGoldDisplay();

      this.battleUI.showVictory(result.goldReward);

      if (this._currentNode?.type === 'boss') {
        this.onRunComplete(true);
      } else {
        this.scheduleOnce(() => {
          this.battleManager.reviveAllUnits();
          this.battleUI.hide();
          if (this.battleManager?.gridController?.node) {
            this.battleManager.gridController.node.active = false;
          }
          this.showUpgradeScreen();
        }, 1.0);
      }
    } else {
      this._runData.honor += Math.max(1, this._battleCount * 2);
      this.battleUI.showDefeat();
      this.scheduleOnce(() => {
        this.onRunComplete(false);
      }, 2.0);
    }
  }

  private showUpgradeScreen(): void {
    const options = this.generateUpgradeOptions();
    this.upgradeUI.show();
    this.upgradeUI.showUpgradeOptions(options, (index) => {
      this.applyUpgrade(options[index]);
      this.upgradeUI.hide();
      this.returnToRouteMap();
    });
  }

  private generateUpgradeOptions(): UpgradeOption[] {
    const options: UpgradeOption[] = [];
    const unit = this.battleManager.playerUnits[0];
    if (!unit?.data) return options;

    const classConfig = CLASSES.find(c => c.id === unit.data.classId);
    if (classConfig) {
      const skills = getRandomSkillsFromPool(classConfig.skillPool, 3);
      for (const skill of skills) {
        options.push({
          name: skill.name,
          description: skill.description,
          type: 'skill',
          skillId: skill.id,
        });
      }
    }

    options.push({
      name: '+1 \u6C38\u4E45\u8840\u91CF',
      description: '\u5168\u5458 +1 \u6700\u5927\u8840\u91CF',
      type: 'buff',
      buffType: 'hp',
      buffAmount: 1,
    });

    if (options.length > 3) {
      return options.sort(() => Math.random() - 0.5).slice(0, 3);
    }
    return options;
  }

  private applyUpgrade(option: UpgradeOption): void {
    if (option.type === 'skill' && option.skillId) {
      const skill = getSkillById(option.skillId);
      if (skill) {
        const firstUnit = this.battleManager.playerUnits[0];
        if (firstUnit) {
          firstUnit.addSkill(skill);
        }
      }
    }
  }

  private returnToRouteMap(): void {
    this._state = 'route_map';
    this.routeMapUI.show();
    this.routeMapUI.renderRoute(this.routeMapUI.nodes);
    this.battleManager.node.active = false;
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

  private onShopBuySkill(): void {
    if (this._runData.gold < 10) return;
    this._runData.gold -= 10;

    const firstUnit = this.battleManager?.playerUnits?.[0];
    if (firstUnit?.data) {
      const classConfig = CLASSES.find(c => c.id === firstUnit.data.classId);
      if (classConfig) {
        const skills = getRandomSkillsFromPool(classConfig.skillPool, 1);
        if (skills.length > 0) {
          firstUnit.addSkill(skills[0]);
        }
      }
    }
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
    });
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
        const firstUnit = this.battleManager.playerUnits[0];
        if (firstUnit?.data) {
          const classConfig = CLASSES.find(c => c.id === firstUnit.data.classId);
          if (classConfig) {
            const skills = getRandomSkillsFromPool(classConfig.skillPool, 1);
            if (skills.length > 0) {
              firstUnit.addSkill(skills[0]);
            }
          }
        }
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

  private completeNonBattleNode(): void {
    this.routeMapUI.completeNode(this._currentNode?.id ?? 0);
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

    if (victory) {
      this._runData.honor += 100;

      if (this.victoryPanel) {
        this.victoryPanel.active = true;
      }
    } else {
      if (this.gameOverPanel) {
        this.gameOverPanel.active = true;
      }
      if (this.gameOverLabel) {
        this.gameOverLabel.string = `\u6E38\u620F\u7ED3\u675F\n\u62B5\u8FBE\u7B2C ${this._battleCount} \u5173\n\u83B7\u5F97 +${this._runData.honor > 100 ? this._runData.honor - 100 : 0} \u8363\u8A89`;
      }
    }

    SaveManager.saveMeta({
      honor: this._runData.honor,
      talents: this._runData.talents,
      unlockedClasses: this._runData.unlockedClasses,
      unlockedSkills: this._runData.unlockedSkills,
    });

    if (victory) {
      this.checkAchievements();
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

    this._state = 'class_select';
    SaveManager.clearRun();

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
    if (this.continueButton?.node?.isValid) {
      this.continueButton.node.off(Button.EventType.CLICK, this.onContinueRun, this);
    }
    if (this.classSelectPanel?.isValid) {
      const startBtnNode = this.classSelectPanel.getChildByName('StartBtn');
      if (startBtnNode) {
        const startBtn = startBtnNode.getComponent(Button);
        if (startBtn?.node?.isValid) {
          startBtn.node.off(Button.EventType.CLICK, this.startClassSelect, this);
        }
      }
      for (let i = 0; i < CLASS_ORDER.length; i++) {
        const btnName = `Class${i + 1}Btn`;
        const btnNode = this.classSelectPanel.getChildByName(btnName);
        if (btnNode?.isValid) {
          const btn = btnNode.getComponent(Button);
          if (btn) {
            btn.node.off(Button.EventType.CLICK, this.onClassToggleClicked, this);
          }
        }
      }
    }
    if (this.gameOverPanel?.isValid) {
      const restartBtnNode = this.gameOverPanel.getChildByName('RestartButton');
      if (restartBtnNode) {
        const restartBtn = restartBtnNode.getComponent(Button);
        if (restartBtn?.node?.isValid) {
          restartBtn.node.off(Button.EventType.CLICK, this.restartFromRouteMap, this);
        }
      }
    }
    this.unbindShopPanelEvents();
    this.unbindRestPanelEvents();
    this.battleManager = null;
    this.routeMapUI = null;
    this.battleUI = null;
    this.upgradeUI = null;
    this.eventUI = null;
  }
}
