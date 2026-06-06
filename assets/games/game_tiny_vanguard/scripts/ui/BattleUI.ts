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

  @property({ type: Button, tooltip: '等待（跳过行动）按钮' })
  waitButton: Button = null;

  @property({ type: Node, tooltip: '布阵提示文本' })
  deployPrompt: Node = null;

  @property({ type: Node, tooltip: '布阵单位列表容器' })
  deployUnitList: Node = null;

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

  @property({ type: Label, tooltip: '阶段文字（我方回合/敌方回合）' })
  phaseLabel: Label = null;

  @property({ type: Label, tooltip: '当前单位 (1/3)' })
  unitTurnLabel: Label = null;

  @property({ type: Label, tooltip: '操作提示' })
  actionHintLabel: Label = null;

  private _skillClickCallbacks: ((index: number) => void)[] = [];
  private _showCalled: boolean = false;

  onLoad(): void {
    if (!this._showCalled) {
      this.node.active = false;
    }
    if (this.victoryPanel) this.victoryPanel.active = false;
    if (this.defeatPanel) this.defeatPanel.active = false;

    if (this.endTurnButton) {
      const etTransform = this.endTurnButton.node.getComponent(UITransform);
      if (etTransform) {
        etTransform.setContentSize(100, 60);
      }
      this.endTurnButton.node.setPosition(290, -280);
    }
    if (this.confirmDeployButton) {
      this.confirmDeployButton.node.setPosition(0, -320);
    }
    if (this.deployPrompt) {
      this.deployPrompt.setPosition(0, 260);
    }
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
    if (this.waitButton) {
      this.waitButton.node.on(Button.EventType.CLICK, this.onWaitClicked, this);
    }
  }

  private unbindEvents(): void {
    if (this.endTurnButton) {
      this.endTurnButton.node.off(Button.EventType.CLICK, this.onEndTurnClicked, this);
    }
    if (this.confirmDeployButton) {
      this.confirmDeployButton.node.off(Button.EventType.CLICK, this.onConfirmDeployClicked, this);
    }
    if (this.waitButton) {
      this.waitButton.node.off(Button.EventType.CLICK, this.onWaitClicked, this);
    }
  }

  private _onEndTurn: (() => void) | null = null;
  private _onConfirmDeploy: (() => void) | null = null;
  private _onWait: (() => void) | null = null;

  setEndTurnCallback(callback: () => void): void {
    this._onEndTurn = callback;
  }

  setConfirmDeployCallback(callback: () => void): void {
    this._onConfirmDeploy = callback;
  }

  setWaitCallback(callback: () => void): void {
    this._onWait = callback;
  }

  private onEndTurnClicked(): void {
    if (this._onEndTurn) this._onEndTurn();
  }

  private onConfirmDeployClicked(): void {
    if (this._onConfirmDeploy) this._onConfirmDeploy();
  }

  private onWaitClicked(): void {
    if (this._onWait) this._onWait();
  }

  showDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = true;
    if (this.confirmDeployButton) this.confirmDeployButton.node.active = true;
    if (this.endTurnButton) this.endTurnButton.node.active = false;
    if (this.waitButton) this.waitButton.node.active = false;
    if (this.unitNameLabel) this.unitNameLabel.string = '\u90E8\u7F72\u9635\u5BB9';
    if (this.hpLabel) this.hpLabel.string = '\u70B9\u51FB\u5DE6\u4FA7\u5355\u4F4D\u518D\u70B9\u683C\u5B50\u653E\u7F6E';
    if (this.energyLabel) this.energyLabel.string = '';
    if (this.turnLabel) this.turnLabel.string = '';
    if (this.deployUnitList) this.deployUnitList.active = true;
  }

  hideDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = false;
    if (this.confirmDeployButton) this.confirmDeployButton.node.active = false;
    if (this.endTurnButton) this.endTurnButton.node.active = true;
    if (this.waitButton) this.waitButton.node.active = true;
    if (this.deployUnitList) this.deployUnitList.active = false;
  }

  updateUnitInfo(name: string, hp: number, maxHp: number, energy: number, maxEnergy: number, turn: number, isEnemy: boolean = false): void {
    if (this.unitNameLabel) {
      this.unitNameLabel.string = name;
      this.unitNameLabel.color = isEnemy ? new Color(255, 100, 100) : Color.WHITE;
    }
    if (this.hpLabel) {
      this.hpLabel.string = `HP: ${hp}/${maxHp}`;
      this.hpLabel.color = isEnemy ? new Color(255, 80, 80) : new Color(80, 200, 255);
    }
    if (this.energyLabel) this.energyLabel.string = `\u26A1 ${energy}/${maxEnergy}`;
    if (this.turnLabel) this.turnLabel.string = `\u8F6E\u6B21 ${turn}`;
  }

  showDeployUnitList(
    unitNames: string[],
    unitIcons: string[],
    callback: (index: number) => void
  ): void {
    if (!this.deployUnitList) return;
    this.deployUnitList.removeAllChildren();

    for (let i = 0; i < unitNames.length; i++) {
      const item = new Node(`DeployItem_${i}`);
      const label = item.addComponent(Label);
      label.string = `${unitNames[i]}`;
      label.fontSize = 20;
      label.color = Color.WHITE;
      const trans = item.addComponent(UITransform);
      trans.setContentSize(200, 40);
      item.setPosition(0, -i * 50, 0);
      item['_deployIdx'] = i;
      item['_deployCb'] = callback;
      item.on(Node.EventType.TOUCH_END, (evt) => {
        const idx = evt.target['_deployIdx'];
        const cb = evt.target['_deployCb'];
        if (cb) cb(idx);
      });
      this.deployUnitList.addChild(item);
    }
  }

  updateDeployItemState(index: number, placed: boolean): void {
    if (!this.deployUnitList) return;
    const child = this.deployUnitList.children[index];
    if (child) {
      const label = child.getComponent(Label);
      if (label) {
        label.color = placed ? new Color(100, 100, 100) : Color.WHITE;
      }
    }
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

      const btnWidth = 100;
      const gap = 10;
      const count = skillNames.length;
      const totalWidth = count * btnWidth + (count - 1) * gap;
      const startX = -totalWidth / 2 + btnWidth / 2;

      const containerTransform = this.skillButtonContainer.getComponent(UITransform);
      if (containerTransform) {
        containerTransform.setContentSize(Math.max(totalWidth, 100), btnWidth + 20);
      }

      for (let i = 0; i < count; i++) {
        const btnNode = instantiate(this.skillButtonPrefab);
        const label = btnNode.getComponentInChildren(Label);
        if (label) {
          label.string = skillNames[i];
          label.fontSize = 24;
        }
        const btn = btnNode.getComponent(Button);
        if (btn) {
          btn.interactable = canUse[i];
          btnNode['_skillBtnIndex'] = i;
          btnNode['_skillBtnCallback'] = callback;
          btn.node.on(Button.EventType.CLICK, this.onSkillBtnClicked, this);
        }
        btnNode.setPosition(startX + i * (btnWidth + gap), 0, 0);
        this.skillButtonContainer.addChild(btnNode);
      }
    }
  }

  clearSkillButtons(): void {
    if (this.skillButtonContainer) {
      this.skillButtonContainer.removeAllChildren();
    }
  }

  showDamageNumber(targetNode: Node, amount: number): void {
    if (!this.damageNumberPrefab || !targetNode?.isValid) return;

    const node = instantiate(this.damageNumberPrefab);
    node.setPosition(0, 40, 0);
    targetNode.addChild(node);

    const label = node.getComponentInChildren(Label);
    if (label) {
      label.string = amount > 0 ? `-${amount}` : `${amount}`;
      label.fontSize = 28;
    }

    const sprite = node.getComponent(Sprite);
    if (sprite) {
      sprite.color = amount > 0 ? Color.RED : Color.GREEN;
    }

    tween(node)
      .to(0.6, { position: new Vec3(0, 100, 0) })
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

  updatePhase(
    phase: string,
    unitName?: string,
    unitIndex?: number,
    totalUnits?: number,
    turn?: number,
    actionHint?: string
  ): void {
    if (this.phaseLabel) {
      this.phaseLabel.string = phase;
    }
    if (this.unitTurnLabel) {
      if (unitName && unitIndex !== undefined && totalUnits !== undefined) {
        this.unitTurnLabel.string = `${unitName} (${unitIndex}/${totalUnits})`;
      } else {
        this.unitTurnLabel.string = unitName ?? '';
      }
    }
    if (this.actionHintLabel) {
      this.actionHintLabel.string = actionHint ?? '';
    }
  }

  clearPhase(): void {
    if (this.phaseLabel) this.phaseLabel.string = '';
    if (this.unitTurnLabel) this.unitTurnLabel.string = '';
    if (this.actionHintLabel) this.actionHintLabel.string = '';
  }

  private onSkillBtnClicked(btn: Button): void {
    const node = btn.node;
    const index = node['_skillBtnIndex'] as number;
    const callback = node['_skillBtnCallback'] as (index: number) => void;
    if (callback) {
      callback(index);
    }
  }

  onDestroy(): void {
    this.unbindEvents();
    if (this.skillButtonContainer) {
      this.skillButtonContainer.removeAllChildren();
    }
    this._skillClickCallbacks = [];
    this._onEndTurn = null;
    this._onConfirmDeploy = null;
    this._onWait = null;
  }
}
