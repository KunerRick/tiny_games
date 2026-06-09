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

  @property({ type: Sprite, tooltip: '阶段背景色' })
  phaseBg: Sprite = null;

  private _skillClickCallbacks: ((index: number) => void)[] = [];
  private _showCalled: boolean = false;
  private _deployCards: Node[] = [];
  private _battleStartOverlay: Node | null = null;
  private _onBattleStartComplete: (() => void) | null = null;

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

    // 创建战前遮罩
    this._battleStartOverlay = new Node('BattleStartOverlay');
    const overlayTransform = this._battleStartOverlay.addComponent(UITransform);
    overlayTransform.setContentSize(750, 1330); // 全屏
    this._battleStartOverlay.setPosition(0, 0, 0);
    const overlaySprite = this._battleStartOverlay.addComponent(Sprite);
    overlaySprite.color = new Color(0, 0, 0, 0);
    this._battleStartOverlay.active = false;
    this.node.addChild(this._battleStartOverlay);

    // 大字
    const titleNode = new Node('BattleStartTitle');
    const titleLabel = titleNode.addComponent(Label);
    titleLabel.string = '\u2694 \u6218\u6597\u5F00\u59CB\uff01';
    titleLabel.fontSize = 48;
    titleLabel.color = new Color(255, 215, 0);
    titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    titleLabel.verticalAlign = Label.VerticalAlign.CENTER;
    titleNode.setPosition(0, 0, 0);
    titleNode.setScale(0, 0, 1);
    this._battleStartOverlay.addChild(titleNode);

    // waitButton 文字
    if (this.waitButton) {
      const wtLabel = this.waitButton.node.getComponentInChildren(Label);
      if (wtLabel) {
        wtLabel.string = '\u7ED3\u675F\u884C\u52A8';
      }
    }

    // 阶段背景色（编辑器未绑定时自动创建）
    if (!this.phaseBg && this.phaseLabel) {
      const bgNode = new Node('PhaseBg');
      const bgSprite = bgNode.addComponent(Sprite);
      bgSprite.color = new Color(0, 100, 200, 100);
      const bgTrans = bgNode.addComponent(UITransform);
      bgTrans.setContentSize(400, 40);
      bgNode.setPosition(0, 260, -1);
      this.node.addChild(bgNode);
      this.phaseBg = bgSprite;
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
    if (this.confirmDeployButton) {
      this.confirmDeployButton.node.on(Button.EventType.CLICK, this.onConfirmDeployClicked, this);
    }
    if (this.waitButton) {
      this.waitButton.node.on(Button.EventType.CLICK, this.onWaitClicked, this);
    }
  }

  private unbindEvents(): void {
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
  private _onContinueVictory: (() => void) | null = null;

  setEndTurnCallback(callback: () => void): void {
    this._onEndTurn = callback;
  }

  setConfirmDeployCallback(callback: () => void): void {
    this._onConfirmDeploy = callback;
  }

  setWaitCallback(callback: () => void): void {
    this._onWait = callback;
  }

  setVictoryContinueCallback(callback: () => void): void {
    this._onContinueVictory = callback;
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

  private onVictoryContinueClicked(): void {
    if (this._onContinueVictory) {
      this._onContinueVictory();
    }
  }

  showDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = true;
    if (this.confirmDeployButton) this.confirmDeployButton.node.active = true;
    if (this.waitButton) this.waitButton.node.active = false;
    if (this.endTurnButton) this.endTurnButton.node.active = false;
    // 设置顶部阶段标签，清空其余文本
    if (this.phaseLabel) this.phaseLabel.string = '\u5E03\u9635\u9636\u6BB5';
    if (this.unitNameLabel) this.unitNameLabel.string = '';
    if (this.hpLabel) this.hpLabel.string = '';
    if (this.energyLabel) this.energyLabel.string = '';
    if (this.turnLabel) this.turnLabel.string = '';
    if (this.unitTurnLabel) this.unitTurnLabel.string = '';
    if (this.actionHintLabel) this.actionHintLabel.string = '';
    if (this.deployUnitList) this.deployUnitList.active = false;
  }

  hideDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = false;
    if (this.confirmDeployButton) this.confirmDeployButton.node.active = false;
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

  setupPlatoonCards(
    unitNames: string[],
    unitIcons: string[],
    callback: (index: number) => void
  ): void {
    // 清除旧的兵牌
    for (const card of this._deployCards) {
      if (card?.isValid) {
        card.removeFromParent();
      }
    }
    this._deployCards = [];

    const cardWidth = 120;
    const cardHeight = 70;
    const gap = 10;
    const count = unitNames.length;
    // 竖排居中：总高度 = count * cardHeight + (count-1) * gap
    const totalHeight = count * cardHeight + (count - 1) * gap;
    const startY = totalHeight / 2 - cardHeight / 2;

    for (let i = 0; i < count; i++) {
      const card = new Node(`PlatoonCard_${i}`);
      // 棋盘左边缘 x=-200，兵牌放在 x=-380 (左侧 180px)
      card.setPosition(-380, startY - i * (cardHeight + gap), 0);

      // 背景
      const bg = card.addComponent(Sprite);
      bg.color = new Color(60, 60, 80, 200);
      bg.sizeMode = Sprite.SizeMode.CUSTOM;
      const bgTransform = card.addComponent(UITransform);
      bgTransform.setContentSize(cardWidth, cardHeight);

      // 图标 (文字 emoji，放在上半部分)
      const iconNode = new Node('IconLabel');
      const iconLabel = iconNode.addComponent(Label);
      iconLabel.string = unitIcons[i] || '';
      iconLabel.fontSize = 24;
      iconLabel.color = Color.WHITE;
      iconLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      iconLabel.verticalAlign = Label.VerticalAlign.CENTER;
      iconNode.setPosition(0, 12, 0);
      card.addChild(iconNode);

      // 名字（放在下半部分）
      const nameLabel = new Node('NameLabel');
      const nl = nameLabel.addComponent(Label);
      nl.string = unitNames[i];
      nl.fontSize = 14;
      nl.color = Color.WHITE;
      nl.horizontalAlign = Label.HorizontalAlign.CENTER;
      nl.verticalAlign = Label.VerticalAlign.CENTER;
      nameLabel.setPosition(0, -15, 0);
      card.addChild(nameLabel);

      // 选中勾（默认隐藏，placed 时显示）
      const checkMark = new Node('CheckMark');
      const cmLabel = checkMark.addComponent(Label);
      cmLabel.string = '\u2713';
      cmLabel.fontSize = 20;
      cmLabel.color = new Color(80, 220, 80);
      checkMark.setPosition(cardWidth / 2 - 15, cardHeight / 2 - 10, 0);
      checkMark.active = false;
      card.addChild(checkMark);

      // 交互
      card['_deployIdx'] = i;
      card['_deployCb'] = callback;
      card.on(Node.EventType.TOUCH_END, (evt) => {
        const idx = evt.target['_deployIdx'] as number;
        const cb = evt.target['_deployCb'] as (index: number) => void;
        if (cb) cb(idx);
      });

      this.node.addChild(card);
      this._deployCards.push(card);
    }
  }

  setDeployCardState(index: number, state: 'unplaced' | 'selected' | 'placed'): void {
    const card = this._deployCards[index];
    if (!card?.isValid) return;

    const bg = card.getComponent(Sprite);
    const checkMark = card.getChildByName('CheckMark');

    // 找到或创建 HighlightBorder
    let border = card.getChildByName('HighlightBorder');

    switch (state) {
      case 'unplaced':
        if (bg) bg.color = new Color(60, 60, 80, 200);
        card.setScale(new Vec3(1, 1, 1));
        if (checkMark) checkMark.active = false;
        if (border) border.active = false;
        break;

      case 'selected':
        if (bg) bg.color = new Color(80, 200, 80, 220);
        card.setScale(new Vec3(1.1, 1.1, 1));
        if (checkMark) checkMark.active = false;
        if (!border) {
          border = new Node('HighlightBorder');
          const bSprite = border.addComponent(Sprite);
          bSprite.color = new Color(80, 220, 80, 255);
          bSprite.sizeMode = Sprite.SizeMode.CUSTOM;
          const bTrans = border.addComponent(UITransform);
          bTrans.setContentSize(130, 80);
          border.setPosition(0, 0, -1);
          card.addChild(border);
        }
        border.active = true;
        break;

      case 'placed':
        if (bg) bg.color = new Color(40, 40, 60, 150);
        card.setScale(new Vec3(1, 1, 1));
        if (checkMark) checkMark.active = true;
        if (border) border.active = false;
        break;
    }
  }

  selectDeployCard(index: number): void {
    // 先重置所有卡片为 unplaced
    for (let i = 0; i < this._deployCards.length; i++) {
      const card = this._deployCards[i];
      if (!card?.isValid) continue;
      // 不重置已放置的卡片
      const checkMark = card.getChildByName('CheckMark');
      if (checkMark?.active) continue;
      this.setDeployCardState(i, 'unplaced');
    }
    // 设置目标卡片为选中态
    this.setDeployCardState(index, 'selected');
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

    // 确保有"继续"按钮
    let continueBtn = this.victoryPanel?.getChildByName('ContinueBtn');
    if (!continueBtn && this.victoryPanel) {
      continueBtn = new Node('ContinueBtn');
      const btn = continueBtn.addComponent(Button);
      const btnTransform = continueBtn.addComponent(UITransform);
      btnTransform.setContentSize(160, 50);
      continueBtn.setPosition(0, -80, 0);
      const btnLabel = continueBtn.addComponent(Label);
      btnLabel.string = '\u7EE7\u7EED';
      btnLabel.fontSize = 24;
      btnLabel.color = Color.WHITE;
      btnLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      btnLabel.verticalAlign = Label.VerticalAlign.CENTER;
      const btnSprite = continueBtn.addComponent(Sprite);
      btnSprite.color = new Color(0, 120, 200);
      btnSprite.sizeMode = Sprite.SizeMode.CUSTOM;
      btn.node.on(Button.EventType.CLICK, this.onVictoryContinueClicked, this);
      this.victoryPanel.addChild(continueBtn);
    }

    // 显示金币
    let goldLabel = this.victoryPanel?.getChildByName('GoldLabel');
    if (!goldLabel && this.victoryPanel) {
      goldLabel = new Node('GoldLabel');
      const gl = goldLabel.addComponent(Label);
      gl.fontSize = 28;
      gl.color = new Color(255, 215, 0);
      gl.horizontalAlign = Label.HorizontalAlign.CENTER;
      gl.verticalAlign = Label.VerticalAlign.CENTER;
      goldLabel.setPosition(0, -20, 0);
      this.victoryPanel.addChild(goldLabel);
    }
    const glComp = goldLabel?.getComponent(Label);
    if (glComp) {
      glComp.string = `\uD83D\uDCB0 +${gold}`;
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

    // 根据阶段设置背景色
    if (this.phaseBg) {
      if (phase.includes('\u5E03\u9635')) {
        // 布阵 - 绿色
        this.phaseBg.color = new Color(0, 120, 60, 120);
      } else if (phase.includes('\u654C\u65B9')) {
        // 敌方 - 红色
        this.phaseBg.color = new Color(180, 40, 40, 120);
      } else if (phase.includes('\u6211\u65B9')) {
        // 我方 - 蓝色
        this.phaseBg.color = new Color(0, 80, 180, 120);
      } else if (phase.includes('\u80DC\u5229')) {
        this.phaseBg.color = new Color(180, 140, 0, 120);
      } else if (phase.includes('\u5931\u8D25')) {
        this.phaseBg.color = new Color(80, 80, 80, 120);
      } else {
        this.phaseBg.color = new Color(0, 0, 0, 0);
      }
    }
  }

  clearPhase(): void {
    if (this.phaseLabel) this.phaseLabel.string = '';
    if (this.unitTurnLabel) this.unitTurnLabel.string = '';
    if (this.actionHintLabel) this.actionHintLabel.string = '';
    if (this.phaseBg) {
      this.phaseBg.color = new Color(0, 0, 0, 0);
    }
  }

  playBattleStartAnimation(onComplete: () => void): void {
    this._onBattleStartComplete = onComplete;
    if (!this._battleStartOverlay) {
      if (onComplete) onComplete();
      return;
    }

    this._battleStartOverlay.active = true;
    const overlaySprite = this._battleStartOverlay.getComponent(Sprite);
    const titleNode = this._battleStartOverlay.getChildByName('BattleStartTitle');

    if (!overlaySprite || !titleNode) {
      this._battleStartOverlay.active = false;
      if (onComplete) onComplete();
      return;
    }

    // 步骤1: 遮罩渐暗 (0.3s)
    tween(overlaySprite)
      .to(0.3, { color: new Color(0, 0, 0, 180) })
      .call(() => {
        // 步骤2: 大字出现 (1.2s)
        tween(titleNode)
          .to(0.4, { scale: new Vec3(1.2, 1.2, 1) })
          .to(0.6, { scale: new Vec3(1, 1, 1) })
          .delay(0.2)
          .call(() => {
            // 步骤3: 遮罩淡出 (0.3s)
            tween(overlaySprite)
              .to(0.3, { color: new Color(0, 0, 0, 0) })
              .call(() => {
                this._battleStartOverlay.active = false;
                if (this._onBattleStartComplete) {
                  this._onBattleStartComplete();
                  this._onBattleStartComplete = null;
                }
              })
              .start();
          })
          .start();
      })
      .start();
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
    // onDestroy 中不访问 @property(Node) — 已由 hide() 中的 unbindEvents() 清理
    // 只清 JS 引用
    this._skillClickCallbacks = [];
    this._deployCards = [];
    this._onEndTurn = null;
    this._onConfirmDeploy = null;
    this._onWait = null;
    this._battleStartOverlay = null;
    this._onBattleStartComplete = null;
    this._onContinueVictory = null;
  }
}
