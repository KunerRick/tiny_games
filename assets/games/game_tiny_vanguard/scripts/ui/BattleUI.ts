import { _decorator, Component, Node, Label, Button, Sprite, Color, tween, Vec3, instantiate, Prefab, UITransform } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('BattleUI')
export class BattleUI extends Component {
  @property({ type: Label, tooltip: '单位名称' })
  unitNameLabel: Label = null;

  @property({ type: Label, tooltip: '血量显示' })
  hpLabel: Label = null;

  @property({ type: Label, tooltip: '能量显示' })
  energyLabel: Label = null;

  @property({ type: Label, tooltip: '回合计数' })
  turnLabel: Label = null;

  @property({ type: Button, tooltip: '结束回合按钮' })
  endTurnButton: Button = null;

  @property({ type: Button, tooltip: '确认布阵按钮' })
  confirmDeployButton: Button = null;

  @property({ type: Node, tooltip: '布阵提示文本' })
  deployPrompt: Node = null;

  @property({ type: Node, tooltip: '技能按钮容器' })
  skillButtonContainer: Node = null;

  @property({ type: Prefab, tooltip: '技能按钮预制体' })
  skillButtonPrefab: Prefab = null;

  @property({ type: Prefab, tooltip: '伤害数字预制体' })
  damageNumberPrefab: Prefab = null;

  @property({ type: Node, tooltip: '胜利界面' })
  victoryPanel: Node = null;

  @property({ type: Node, tooltip: '失败界面' })
  defeatPanel: Node = null;

  private _skillClickCallbacks: ((index: number) => void)[] = [];
  private _showCalled: boolean = false;

  onLoad(): void {
    if (!this._showCalled) {
      this.node.active = false;
    }
    if (this.victoryPanel) this.victoryPanel.active = false;
    if (this.defeatPanel) this.defeatPanel.active = false;
  }

  show(): void {
    this._showCalled = true;
    this.node.active = true;
    this.bindEvents();
  }

  hide(): void {
    this.node.active = false;
    this.unbindEvents();
  }

  private bindEvents(): void {
    if (this.endTurnButton) {
      this.endTurnButton.node.on(Button.EventType.CLICK, this.onEndTurnClicked, this);
    }
    if (this.confirmDeployButton) {
      this.confirmDeployButton.node.on(Button.EventType.CLICK, this.onConfirmDeployClicked, this);
    }
  }

  private unbindEvents(): void {
    if (this.endTurnButton) {
      this.endTurnButton.node.off(Button.EventType.CLICK, this.onEndTurnClicked, this);
    }
    if (this.confirmDeployButton) {
      this.confirmDeployButton.node.off(Button.EventType.CLICK, this.onConfirmDeployClicked, this);
    }
  }

  private _onEndTurn: (() => void) | null = null;
  private _onConfirmDeploy: (() => void) | null = null;

  setEndTurnCallback(callback: () => void): void {
    this._onEndTurn = callback;
  }

  setConfirmDeployCallback(callback: () => void): void {
    this._onConfirmDeploy = callback;
  }

  private onEndTurnClicked(): void {
    if (this._onEndTurn) this._onEndTurn();
  }

  private onConfirmDeployClicked(): void {
    if (this._onConfirmDeploy) this._onConfirmDeploy();
  }

  showDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = true;
    if (this.confirmDeployButton) this.confirmDeployButton.node.active = true;
    if (this.endTurnButton) this.endTurnButton.node.active = false;
    if (this.unitNameLabel) this.unitNameLabel.string = '\u90E8\u7F72\u9635\u5BB9';
    if (this.hpLabel) this.hpLabel.string = '\u70B9\u51FB\u524D\u4E24\u884C\u653E\u7F6E\u5355\u4F4D';
    if (this.energyLabel) this.energyLabel.string = '';
    if (this.turnLabel) this.turnLabel.string = '';
  }

  hideDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = false;
    if (this.confirmDeployButton) this.confirmDeployButton.node.active = false;
    if (this.endTurnButton) this.endTurnButton.node.active = true;
  }

  updateUnitInfo(name: string, hp: number, maxHp: number, energy: number, maxEnergy: number, turn: number): void {
    if (this.unitNameLabel) this.unitNameLabel.string = name;
    if (this.hpLabel) this.hpLabel.string = `HP: ${hp}/${maxHp}`;
    if (this.energyLabel) this.energyLabel.string = `\u26A1 ${energy}/${maxEnergy}`;
    if (this.turnLabel) this.turnLabel.string = `\u8F6E\u6B21 ${turn}`;
  }

  clearUnitInfo(): void {
    if (this.unitNameLabel) this.unitNameLabel.string = '';
    if (this.hpLabel) this.hpLabel.string = '';
    if (this.energyLabel) this.energyLabel.string = '';
  }

  showSkillButtons(skillNames: string[], canUse: boolean[], callback: (index: number) => void): void {
    this._skillClickCallbacks = [];
    if (this.skillButtonContainer) {
      this.skillButtonContainer.removeAllChildren();
      for (let i = 0; i < skillNames.length; i++) {
        const btnNode = instantiate(this.skillButtonPrefab);
        const label = btnNode.getComponentInChildren(Label);
        if (label) label.string = skillNames[i];
        const btn = btnNode.getComponent(Button);
        if (btn) {
          btn.interactable = canUse[i];
          const index = i;
          btn.node.on(Button.EventType.CLICK, () => {
            callback(index);
          }, this);
        }
        this.skillButtonContainer.addChild(btnNode);
      }
    }
  }

  clearSkillButtons(): void {
    if (this.skillButtonContainer) {
      this.skillButtonContainer.removeAllChildren();
    }
  }

  showDamageNumber(worldPos: Vec3, amount: number): void {
    if (!this.damageNumberPrefab) return;

    const node = instantiate(this.damageNumberPrefab);
    node.setPosition(worldPos);
    this.node.addChild(node);

    const label = node.getComponentInChildren(Label);
    if (label) {
      label.string = `-${amount}`;
    }

    const sprite = node.getComponent(Sprite);
    if (sprite) {
      sprite.color = amount >= 0 ? Color.RED : Color.GREEN;
    }

    tween(node)
      .to(0.6, {
        position: new Vec3(worldPos.x, worldPos.y + 60, worldPos.z)
      })
      .call(() => {
        if (node?.isValid) {
          node.destroy();
        }
      })
      .start();
  }

  showVictory(gold: number): void {
    if (this.victoryPanel) {
      this.victoryPanel.active = true;
    }
    if (this.endTurnButton) {
      this.endTurnButton.node.active = false;
    }
  }

  showDefeat(): void {
    if (this.defeatPanel) {
      this.defeatPanel.active = true;
    }
    if (this.endTurnButton) {
      this.endTurnButton.node.active = false;
    }
  }

  onDestroy(): void {
    this._skillClickCallbacks = [];
    this._onEndTurn = null;
    this._onConfirmDeploy = null;
  }
}
