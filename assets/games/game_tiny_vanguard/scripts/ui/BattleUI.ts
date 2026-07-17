import { _decorator, Component, Node, Label, Button, Sprite, Color, tween, Vec3, instantiate, Prefab, UITransform, Event, EventTouch } from 'cc';
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

  @property({ type: Node, tooltip: '结束回合按钮节点' })
  endTurnButton: Node = null;

  @property({ type: Node, tooltip: '确认布阵按钮节点' })
  confirmDeployButton: Node = null;

  @property({ type: Node, tooltip: '等待（跳过行动）按钮节点' })
  waitButton: Node = null;

  @property({ type: Node, tooltip: '普通攻击按钮节点' })
  attackButton: Node = null;

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

  private _showCalled: boolean = false;
  private _eventsBound: boolean = false;
  private _deployCards: Node[] = [];
  private _onDeployCardCb: ((index: number) => void) | null = null;
  private _autoSkipNoticeCb: (() => void) | null = null;
  private _battleStartOverlay: Node | null = null;
  private _onBattleStartComplete: (() => void) | null = null;
  private _skillButtonPool: Node[] = [];
  private _onAttackCallback: (() => void) | null = null;

  onLoad(): void {
    if (!this._showCalled) {
      this.node.active = false;
    }
    if (this.victoryPanel) this.victoryPanel.active = false;
    if (this.defeatPanel) {
      this.defeatPanel.active = false;
      // 确保失败面板在渲染层级最顶层（避免被单位遮挡）
      this.ensurePanelOnTop(this.defeatPanel);
    }

    if (this.waitButton) {
      const wtLabel = this.waitButton.getComponentInChildren(Label);
      if (wtLabel) {
        wtLabel.string = '\u7B49\u5F85';
      }
    }
    if (this.confirmDeployButton) {
      this.confirmDeployButton.setPosition(0, -320);
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

    // 预创建胜利面板子节点
    if (this.victoryPanel) {
      let continueBtn = this.victoryPanel.getChildByName('ContinueBtn');
      if (!continueBtn) {
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
        this.victoryPanel.addChild(continueBtn);
      }

      let goldLabel = this.victoryPanel.getChildByName('GoldLabel');
      if (!goldLabel) {
        goldLabel = new Node('GoldLabel');
        const gl = goldLabel.addComponent(Label);
        gl.fontSize = 28;
        gl.color = new Color(255, 215, 0);
        gl.horizontalAlign = Label.HorizontalAlign.CENTER;
        gl.verticalAlign = Label.VerticalAlign.CENTER;
        goldLabel.setPosition(0, -30, 0);
        this.victoryPanel.addChild(goldLabel);
      }

      let turnLabel = this.victoryPanel.getChildByName('TurnCountLabel');
      if (!turnLabel) {
        turnLabel = new Node('TurnCountLabel');
        const tl = turnLabel.addComponent(Label);
        tl.fontSize = 22;
        tl.color = Color.WHITE;
        tl.horizontalAlign = Label.HorizontalAlign.CENTER;
        tl.verticalAlign = Label.VerticalAlign.CENTER;
        turnLabel.setPosition(0, 40, 0);
        this.victoryPanel.addChild(turnLabel);
      }

      let dmgLabel = this.victoryPanel.getChildByName('DamageLabel');
      if (!dmgLabel) {
        dmgLabel = new Node('DamageLabel');
        const dl = dmgLabel.addComponent(Label);
        dl.fontSize = 22;
        dl.color = new Color(255, 180, 100);
        dl.horizontalAlign = Label.HorizontalAlign.CENTER;
        dl.verticalAlign = Label.VerticalAlign.CENTER;
        dmgLabel.setPosition(0, 5, 0);
        this.victoryPanel.addChild(dmgLabel);
      }
    }
  }

  show(): void {
    this._showCalled = true;
    this.node.active = true;
    if (!this._eventsBound) {
      this._eventsBound = true;
      this.bindEvents();
    }
  }

  hide(): void {
    this.node.active = false;
    if (this._eventsBound) {
      this._eventsBound = false;
      this.unbindEvents();
    }
  }

  private bindEvents(): void {
    if (this.confirmDeployButton) {
      this.confirmDeployButton.on(Node.EventType.TOUCH_END, this.onConfirmDeployClicked, this);
    }
    if (this.waitButton) {
      this.waitButton.on(Node.EventType.TOUCH_END, this.onWaitClicked, this);
    }
    if (this.attackButton) {
      this.attackButton.on(Node.EventType.TOUCH_END, this.onAttackClicked, this);
    }
    if (this.endTurnButton) {
      this.endTurnButton.on(Node.EventType.TOUCH_END, this.onEndTurnClicked, this);
    }
  }

  private unbindEvents(): void {
    if (this.confirmDeployButton) {
      this.confirmDeployButton.off(Node.EventType.TOUCH_END, this.onConfirmDeployClicked, this);
    }
    if (this.waitButton) {
      this.waitButton.off(Node.EventType.TOUCH_END, this.onWaitClicked, this);
    }
    if (this.attackButton) {
      this.attackButton.off(Node.EventType.TOUCH_END, this.onAttackClicked, this);
    }
    if (this.endTurnButton) {
      this.endTurnButton.off(Node.EventType.TOUCH_END, this.onEndTurnClicked, this);
    }
  }

  /**
   * 确保面板节点在父节点的最顶层渲染
   */
  private ensurePanelOnTop(panel: Node | null): void {
    if (panel && panel.parent) {
      panel.setSiblingIndex(panel.parent.children.length - 1);
    }
  }

  private _onConfirmDeploy: (() => void) | null = null;
  private _onWait: (() => void) | null = null;
  private _onEndTurn: (() => void) | null = null;
  private _onContinueVictory: (() => void) | null = null;

  setConfirmDeployCallback(callback: () => void): void {
    this._onConfirmDeploy = callback;
  }

  setWaitCallback(callback: () => void): void {
    this._onWait = callback;
  }

  setEndTurnCallback(callback: () => void): void {
    this._onEndTurn = callback;
  }

  setVictoryContinueCallback(callback: () => void): void {
    this._onContinueVictory = callback;
  }

  private onConfirmDeployClicked(): void {
    if (this._onConfirmDeploy) this._onConfirmDeploy();
  }

  private onWaitClicked(): void {
    if (this._onWait) this._onWait();
  }

  private onEndTurnClicked(): void {
    if (this._onEndTurn) this._onEndTurn();
  }

  private onVictoryContinueClicked(): void {
    if (this._onContinueVictory) {
      this._onContinueVictory();
    }
  }

  showDeployPhase(): void {
    // 进入新战斗前隐藏上一场的结算面板
    if (this.victoryPanel) this.victoryPanel.active = false;
    if (this.defeatPanel) this.defeatPanel.active = false;
    if (this.deployPrompt) this.deployPrompt.active = true;
    if (this.confirmDeployButton) this.confirmDeployButton.active = true;
    if (this.waitButton) this.waitButton.active = false;
    // 隐藏状态栏面板（仅在部署阶段）
    this.setStatPanelVisible(false);
    // 设置顶部阶段标签
    if (this.phaseLabel) this.phaseLabel.string = '\u5E03\u9635\u9636\u6BB5';
    if (this.actionHintLabel) this.actionHintLabel.string = '\u70B9\u51FB\u524D\u4E24\u884C\u653E\u7F6E\u5355\u4F4D';
    if (this.deployUnitList) this.deployUnitList.active = false;
  }

  hideDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = false;
    if (this.confirmDeployButton) this.confirmDeployButton.active = false;
    if (this.waitButton) this.waitButton.active = true;
    // 恢复状态栏面板
    this.setStatPanelVisible(true);
    if (this.deployUnitList) this.deployUnitList.active = false;
  }

  /** 部署阶段隐藏 / 战斗阶段恢复 状态栏面板 */
  private setStatPanelVisible(visible: boolean): void {
    // UnitInfoPanel 是 unitNameLabel/hpLabel/energyLabel 的父节点
    if (this.unitNameLabel?.node?.parent) {
      this.unitNameLabel.node.parent.active = visible;
    }
    if (this.turnLabel?.node) {
      this.turnLabel.node.active = visible;
    }
    if (this.skillButtonContainer) {
      this.skillButtonContainer.active = visible;
    }
    if (this.unitTurnLabel?.node) {
      this.unitTurnLabel.node.active = visible;
    }
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
        card.off(Node.EventType.TOUCH_END, this.onDeployCardClicked, this);
        card.removeFromParent();
      }
    }
    this._deployCards = [];
    this._onDeployCardCb = callback;

    const cardWidth = 110;
    const cardHeight = 65;
    const gap = 8;
    const count = unitNames.length;
    // 棋盘左边界 x=-200，棋盘底部 y=-200
    // 兵牌位于棋盘左侧外，与棋盘底部平齐
    // 调整 baseX 使卡片更靠近棋盘（从 -325 改为 -265，间距约 25px）
    const baseX = -265;
    const baseY = -200;

    for (let i = 0; i < count; i++) {
      const card = new Node(`PlatoonCard_${i}`);
      // 从下往上排列：i=0 最底，i=2 最高
      card.setPosition(baseX, baseY + i * (cardHeight + gap), 0);

      // 背景
      const bg = card.addComponent(Sprite);
      bg.color = new Color(50, 55, 75, 230);
      bg.sizeMode = Sprite.SizeMode.CUSTOM;
      const bgTransform = card.addComponent(UITransform);
      bgTransform.setContentSize(cardWidth, cardHeight);

      // 图标 (文字 emoji，放在上半部分)
      const iconNode = new Node('IconLabel');
      const iconLabel = iconNode.addComponent(Label);
      iconLabel.string = unitIcons[i] || '';
      iconLabel.fontSize = 22;
      iconLabel.color = Color.WHITE;
      iconLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      iconLabel.verticalAlign = Label.VerticalAlign.CENTER;
      iconNode.setPosition(0, 10, 0);
      card.addChild(iconNode);

      // 名字（放在下半部分）
      const nameLabel = new Node('NameLabel');
      const nl = nameLabel.addComponent(Label);
      nl.string = unitNames[i];
      nl.fontSize = 13;
      nl.color = Color.WHITE;
      nl.horizontalAlign = Label.HorizontalAlign.CENTER;
      nl.verticalAlign = Label.VerticalAlign.CENTER;
      nameLabel.setPosition(0, -14, 0);
      card.addChild(nameLabel);

      // 交互
      card['_deployIdx'] = i;
      card.on(Node.EventType.TOUCH_END, this.onDeployCardClicked, this);

      this.node.addChild(card);
      this._deployCards.push(card);
    }
  }

  private onDeployCardClicked(evt: EventTouch): void {
    const card = evt.currentTarget as Node;
    if (!card?.isValid) return;
    const idx = card['_deployIdx'] as number;
    if (this._onDeployCardCb) this._onDeployCardCb(idx);
  }

  setDeployCardState(index: number, state: 'unplaced' | 'selected' | 'placed'): void {
    const card = this._deployCards[index];
    if (!card?.isValid) return;

    const bg = card.getComponent(Sprite);

    // 找到或创建 HighlightBorder
    let border = card.getChildByName('HighlightBorder');

    switch (state) {
      case 'unplaced':
        // 深蓝灰色背景，淡色边框提示可交互
        if (bg) bg.color = new Color(45, 50, 70, 220);
        card.setScale(new Vec3(1, 1, 1));
        if (border) {
          const bSprite = border.getComponent(Sprite);
          if (bSprite) bSprite.color = new Color(120, 130, 160, 200);
          const bTrans = border.getComponent(UITransform);
          if (bTrans) bTrans.setContentSize(116, 71);
          border.active = true;
        }
        break;

      case 'selected':
        // 亮绿色背景 + 绿色边框表示当前选中
        if (bg) bg.color = new Color(60, 180, 60, 240);
        card.setScale(new Vec3(1.12, 1.12, 1));
        if (!border) {
          border = new Node('HighlightBorder');
          const bSprite = border.addComponent(Sprite);
          bSprite.color = new Color(120, 255, 120, 255);
          bSprite.sizeMode = Sprite.SizeMode.CUSTOM;
          const bTrans = border.addComponent(UITransform);
          bTrans.setContentSize(116, 71);
          border.setPosition(0, 0, -1);
          card.addChild(border);
        }
        border.active = true;
        break;

      case 'placed':
        // 深色半透明背景 + 金色边框表示已完成部署
        if (bg) bg.color = new Color(30, 35, 50, 150);
        card.setScale(new Vec3(1, 1, 1));
        if (!border) {
          border = new Node('HighlightBorder');
          const bSprite = border.addComponent(Sprite);
          bSprite.color = new Color(255, 200, 80, 255);
          bSprite.sizeMode = Sprite.SizeMode.CUSTOM;
          const bTrans = border.addComponent(UITransform);
          bTrans.setContentSize(116, 71);
          border.setPosition(0, 0, -1);
          card.addChild(border);
        }
        const placedBorderSprite = border.getComponent(Sprite);
        if (placedBorderSprite) placedBorderSprite.color = new Color(255, 200, 80, 255);
        border.active = true;
        break;
    }

    // 记录状态用于 selectDeployCard 判断
    card['_deployState'] = state;
  }

  selectDeployCard(index: number): void {
    // 先重置所有卡片为 unplaced（已放置的保持 placed 态）
    for (let i = 0; i < this._deployCards.length; i++) {
      const card = this._deployCards[i];
      if (!card?.isValid) continue;
      // 不重置已放置的卡片
      if (card['_deployState'] === 'placed') continue;
      this.setDeployCardState(i, 'unplaced');
    }
    // 设置目标卡片为选中态（仅当未放置时）
    const targetCard = this._deployCards[index];
    if (targetCard?.isValid && targetCard['_deployState'] !== 'placed') {
      this.setDeployCardState(index, 'selected');
    }
  }

  clearUnitInfo(): void {
    if (this.unitNameLabel) this.unitNameLabel.string = '';
    if (this.hpLabel) this.hpLabel.string = '';
    if (this.energyLabel) this.energyLabel.string = '';
  }

  showSkillButtons(skillNames: string[], canUse: boolean[], callback: (index: number) => void): void {
    if (!this.skillButtonContainer) return;
    
    const btnWidth = 120;
    const gap = 15;
    const count = skillNames.length;
    const totalWidth = count * btnWidth + (count - 1) * gap;
    const startX = -totalWidth / 2 + btnWidth / 2;
    
    const containerTransform = this.skillButtonContainer.getComponent(UITransform);
    if (containerTransform) {
      containerTransform.setContentSize(Math.max(totalWidth, 100), btnWidth + 20);
    }
    
    while (this.skillButtonContainer.children.length > count) {
      const extraBtn = this.skillButtonContainer.children[this.skillButtonContainer.children.length - 1];
      extraBtn.removeFromParent();
      this._skillButtonPool.push(extraBtn);
    }
    
    while (this.skillButtonContainer.children.length < count) {
      const btnNode = this._skillButtonPool.length > 0 
        ? this._skillButtonPool.shift()! 
        : instantiate(this.skillButtonPrefab);
      this.skillButtonContainer.addChild(btnNode);
    }
    
    for (let i = 0; i < count; i++) {
      const btnNode = this.skillButtonContainer.children[i];
      const label = btnNode.getComponentInChildren(Label);
      if (label) {
        label.string = skillNames[i];
        label.fontSize = 20;
      }
      const btn = btnNode.getComponent(Button);
      if (btn) {
        btn.transition = Button.Transition.SCALE;
        btn.interactable = canUse[i];
        btnNode['_skillBtnIndex'] = i;
        btnNode['_skillBtnCallback'] = callback;
        btn.node.off(Button.EventType.CLICK, this.onSkillBtnClicked, this);
        btn.node.on(Button.EventType.CLICK, this.onSkillBtnClicked, this);
      }
      btnNode.setPosition(startX + i * (btnWidth + gap), 0, 0);
      btnNode.active = true;
    }
  }

  clearSkillButtons(): void {
    if (this.skillButtonContainer) {
      while (this.skillButtonContainer.children.length > 0) {
        const btn = this.skillButtonContainer.children[0];
        btn.removeFromParent();
        this._skillButtonPool.push(btn);
      }
    }
  }

  setAttackCallback(callback: () => void): void {
    this._onAttackCallback = callback;
  }

  showAttackButton(): void {
    if (this.attackButton) this.attackButton.active = true;
  }

  hideAttackButton(): void {
    if (this.attackButton) this.attackButton.active = false;
  }

  private onAttackClicked(): void {
    if (this._onAttackCallback) this._onAttackCallback();
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

  showVictory(gold: number, turnCount: number = 0, totalDamage: number = 0): void {
    if (this.victoryPanel) {
      this.ensurePanelOnTop(this.victoryPanel);
      this.victoryPanel.active = true;
    }
    if (this.waitButton) {
      this.waitButton.active = false;
    }
    if (this.endTurnButton) {
      this.endTurnButton.active = false;
    }
    if (this.skillButtonContainer) {
      this.skillButtonContainer.active = false;
    }

    // 更新金币显示
    const goldLabel = this.victoryPanel?.getChildByName('GoldLabel');
    const glComp = goldLabel?.getComponent(Label);
    if (glComp) {
      glComp.string = `\uD83D\uDCB0 +${gold}`;
    }

    // 更新回合数
    const turnLabel = this.victoryPanel?.getChildByName('TurnCountLabel');
    const tlComp = turnLabel?.getComponent(Label);
    if (tlComp) {
      tlComp.string = `用时回合：${turnCount}`;
    }

    // 更新总伤害
    const dmgLabel = this.victoryPanel?.getChildByName('DamageLabel');
    const dlComp = dmgLabel?.getComponent(Label);
    if (dlComp) {
      dlComp.string = `造成伤害：${totalDamage}`;
    }

    // 绑定继续按钮事件
    const continueBtn = this.victoryPanel?.getChildByName('ContinueBtn');
    if (continueBtn) {
      const btn = continueBtn.getComponent(Button);
      if (btn) {
        btn.node.off(Button.EventType.CLICK, this.onVictoryContinueClicked, this);
        btn.node.on(Button.EventType.CLICK, this.onVictoryContinueClicked, this);
      }
    }
  }

  showDefeat(): void {
    if (this.defeatPanel) {
      // 确保面板在最顶层（避免被单位遮挡）
      this.ensurePanelOnTop(this.defeatPanel);
      this.defeatPanel.active = true;

      // 设置失败文案居中
      const resultLabel = this.defeatPanel.getComponentInChildren(Label);
      if (resultLabel) {
        resultLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        resultLabel.verticalAlign = Label.VerticalAlign.CENTER;
        resultLabel.string = '失 败';
        resultLabel.color = new Color(255, 80, 80);
      }
    }
    if (this.waitButton) {
      this.waitButton.active = false;
    }
    if (this.skillButtonContainer) {
      this.skillButtonContainer.active = false;
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

    // 根据阶段控制按钮可见性
    const isEnemyTurn = phase.includes('\u654C\u65B9');
    const isDeploy = phase.includes('\u5E03\u9635');
    if (this.waitButton) {
      this.waitButton.active = !isEnemyTurn && !isDeploy;
    }
    if (this.endTurnButton) {
      this.endTurnButton.active = !isEnemyTurn && !isDeploy;
    }
    if (this.skillButtonContainer) {
      this.skillButtonContainer.active = !isEnemyTurn && !isDeploy;
    }

    // 根据阶段设置背景色
    if (this.phaseBg) {
      let phaseType: string;
      if (phase.includes('\u5E03\u9635')) {
        phaseType = 'deploy';
      } else if (phase.includes('\u654C\u65B9')) {
        phaseType = 'enemy';
      } else if (phase.includes('\u6211\u65B9')) {
        phaseType = 'player';
      } else if (phase.includes('\u80DC\u5229')) {
        phaseType = 'victory';
      } else if (phase.includes('\u5931\u8D25')) {
        phaseType = 'defeat';
      } else {
        phaseType = 'none';
      }

      switch (phaseType) {
        case 'deploy':
          this.phaseBg.color = new Color(0, 120, 60, 120);
          break;
        case 'enemy':
          this.phaseBg.color = new Color(180, 40, 40, 120);
          break;
        case 'player':
          this.phaseBg.color = new Color(0, 80, 180, 120);
          break;
        case 'victory':
          this.phaseBg.color = new Color(180, 140, 0, 120);
          break;
        case 'defeat':
          this.phaseBg.color = new Color(80, 80, 80, 120);
          break;
        default:
          this.phaseBg.color = new Color(0, 0, 0, 0);
          break;
      }
    }
  }

  clearPhase(): void {
    if (this.phaseLabel) this.phaseLabel.string = '';
    if (this.unitTurnLabel) this.unitTurnLabel.string = '';
    if (this.actionHintLabel) this.actionHintLabel.string = '';
    this.hideAttackButton();
    if (this.phaseBg) {
      this.phaseBg.color = new Color(0, 0, 0, 0);
    }
  }

  /** 显示自动跳过提示（短暂展示后恢复） */
  showAutoSkipNotice(unitName: string): void {
    if (this.actionHintLabel) {
      this.actionHintLabel.string = `${unitName} \u65E0\u53EF\u653B\u51FB\u76EE\u6807\uFF0C\u81EA\u52A8\u8DF3\u8FC7`;
      this.actionHintLabel.color = new Color(255, 200, 80);
    }
    // 2 秒后自动恢复提示
    if (this._autoSkipNoticeCb) {
      this.unschedule(this._autoSkipNoticeCb);
      this._autoSkipNoticeCb = null;
    }
    this._autoSkipNoticeCb = () => {
      this._autoSkipNoticeCb = null;
      if (this.actionHintLabel) {
        this.actionHintLabel.string = '';
      }
    };
    this.scheduleOnce(this._autoSkipNoticeCb, 2);
  }

  playBattleStartAnimation(onComplete: () => void): void {
    this._onBattleStartComplete = onComplete;
    if (!this._battleStartOverlay) {
      if (onComplete) onComplete();
      return;
    }

    // 动画期间隐藏 waitButton，动画结束后恢复
    const waitBtnWasActive = this.waitButton?.active ?? false;
    if (this.waitButton) this.waitButton.active = false;

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
                // 恢复 waitButton 状态
                if (this.waitButton) this.waitButton.active = waitBtnWasActive;
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
    // onDestroy 不访问 @property(Node) — 事件解绑已在 hide() 中完成
    // 只清 JS 引用和 schedule 回调
    if (this._autoSkipNoticeCb) {
      this.unschedule(this._autoSkipNoticeCb);
      this._autoSkipNoticeCb = null;
    }
    this._deployCards = [];
    this._onDeployCardCb = null;
    this._onConfirmDeploy = null;
    this._onWait = null;
    this._onEndTurn = null;
    this._battleStartOverlay = null;
    this._onBattleStartComplete = null;
    this._onContinueVictory = null;
    this._skillButtonPool = [];
  }
}
