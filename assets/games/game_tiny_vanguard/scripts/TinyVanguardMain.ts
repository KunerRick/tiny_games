import { _decorator, Component, Node, Label, Button } from 'cc';
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
    if (this.classSelectPanel) this.classSelectPanel.active = true;

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
  }

  startClassSelect(): void {
    if (this.classSelectPanel) {
      this.classSelectPanel.active = false;
    }
    if (this.continueButton) {
      this.continueButton.node.active = false;
    }

    this._runData.playerClasses = ['warrior', 'archer', 'mage'];
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
  }

  private openShop(): void {
    this._state = 'shop';
    this.routeMapUI.hide();

    if (this.shopPanel) {
      this.shopPanel.active = true;
    }
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
        if (effect.type === 'heal_all') {
          for (const unit of this.battleManager.playerUnits) {
            unit.heal(effect.params.amount ?? 3);
          }
        }
        if (effect.type === 'gain_gold') {
          this._runData.gold += effect.params.amount ?? 10;
        }
        if (effect.type === 'spend_gold') {
          this._runData.gold = Math.max(0, this._runData.gold - (effect.params.amount ?? 10));
        }
        if (effect.type === 'learn_skill' || effect.type === 'learn_rare_skill') {
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
        }
      }
    } else if (event.type === 'random' && event.randomOutcomes?.[choiceIndex]) {
      const effects = event.randomOutcomes[choiceIndex].effects;
      for (const effect of effects) {
        if (effect.type === 'gain_gold') {
          this._runData.gold += effect.params.amount ?? 10;
        }
        if (effect.type === 'learn_rare_skill') {
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
        }
        if (effect.type === 'damage_all') {
          for (const unit of this.battleManager.playerUnits) {
            unit.takeDamage(effect.params.amount ?? 1);
          }
        }
      }
    }
    this.updateGoldDisplay();
  }

  private completeNonBattleNode(): void {
    this.routeMapUI.completeNode(this._currentNode?.id ?? 0);
    SaveManager.saveRun(this._runData);
    this.returnToRouteMap();
  }

  private onRunComplete(victory: boolean): void {
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

    if (this.classSelectPanel) {
      this.classSelectPanel.active = true;
    }
    if (this.routeMapUI) {
      this.routeMapUI.hide();
    }
  }

  onDestroy(): void {
    this.battleManager = null;
    this.routeMapUI = null;
    this.battleUI = null;
    this.upgradeUI = null;
    this.eventUI = null;
  }
}
