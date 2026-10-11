import { _decorator, Component, Node, Label, Button, Sprite, Color, tween, Vec3, instantiate, Prefab, UITransform, Event, EventTouch } from 'cc';
import {
  ALPHA, COLOR, CONTROL, SPACE, FONT_BODY, FONT_CAPTION, FONT_DISPLAY, FONT_TINY,
  applyFont, applyFontAndColor, hex,
} from '../config/Theme';
const { ccclass, property } = _decorator;

/** 兵牌宽度（高度取 CONTROL.ROW_HEIGHT） */
const CARD_WIDTH = 110;
/** 选中态左侧竖条宽度（§4 问题 1：用竖条替代整块覆盖高亮） */
const SELECT_BAR_WIDTH = 4;

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

  private _showCalled: boolean = false;
  private _eventsBound: boolean = false;
  private _deployCards: Node[] = [];
  private _onDeployCardCb: ((index: number) => void) | null = null;
  private _autoSkipNoticeCb: (() => void) | null = null;
  private _battleStartOverlay: Node | null = null;
  private _onBattleStartComplete: (() => void) | null = null;
  private _skillButtonPool: Node[] = [];
  private _onAttackCallback: (() => void) | null = null;
  /** 阶段条被自动跳过提示临时覆盖前的文本/颜色，用于 2 秒后恢复 */
  private _lastPhaseText: string = '';
  private _lastPhaseColor: string = COLOR.TEXT_PRIMARY;

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

    // 阶段条与状态栏统一走设计令牌（P1：提示合并为单一阶段条，删除重复文案）
    applyFontAndColor(this.phaseLabel, FONT_BODY, COLOR.TEXT_PRIMARY);
    applyFontAndColor(this.unitTurnLabel, FONT_CAPTION, COLOR.TEXT_SECONDARY);
    applyFontAndColor(this.turnLabel, FONT_BODY, COLOR.TEXT_PRIMARY);
    applyFont(this.hpLabel, FONT_CAPTION);
    applyFont(this.energyLabel, FONT_CAPTION);
    applyFont(this.unitNameLabel, FONT_BODY);

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
    applyFontAndColor(titleLabel, FONT_DISPLAY, COLOR.WARNING);
    titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    titleLabel.verticalAlign = Label.VerticalAlign.CENTER;
    titleNode.setPosition(0, 0, 0);
    titleNode.setScale(0, 0, 1);
    this._battleStartOverlay.addChild(titleNode);

    // 预创建胜利面板子节点
    if (this.victoryPanel) {
      let continueBtn = this.victoryPanel.getChildByName('ContinueBtn');
      if (!continueBtn) {
        continueBtn = new Node('ContinueBtn');
        const btn = continueBtn.addComponent(Button);
        // Button 的 @requireComponent 已自动带上 UITransform，这里取用而非重复添加
        const btnTransform = continueBtn.getComponent(UITransform);
        if (btnTransform) btnTransform.setContentSize(160, 50);
        continueBtn.setPosition(0, -80, 0);
        const btnSprite = continueBtn.addComponent(Sprite);
        btnSprite.color = new Color(0, 120, 200);
        btnSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        // 同一节点不能同时挂两个渲染组件（Label + Sprite 会触发
        // "Can't add renderable component to this node"），文字放到子节点
        const textNode = new Node('ContinueText');
        const textTransform = textNode.addComponent(UITransform);
        textTransform.setContentSize(160, 50);
        const btnLabel = textNode.addComponent(Label);
        btnLabel.string = '\u7EE7\u7EED';
        applyFontAndColor(btnLabel, FONT_BODY, COLOR.TEXT_PRIMARY);
        btnLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        btnLabel.verticalAlign = Label.VerticalAlign.CENTER;
        continueBtn.addChild(textNode);
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
    if (this.confirmDeployButton) this.confirmDeployButton.active = true;
    if (this.waitButton) this.waitButton.active = false;
    // 隐藏状态栏面板（仅在部署阶段）
    this.setStatPanelVisible(false);
    // 单一阶段条：阶段 + 操作提示合成一句，不再有多处重复文案
    this.setPhaseBar('\u5E03\u9635\u9636\u6BB5', '\u70B9\u51FB\u524D\u4E24\u884C\u90E8\u7F72\u5355\u4F4D');
    if (this.deployUnitList) this.deployUnitList.active = false;
  }

  hideDeployPhase(): void {
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
      // 敌人统一 DANGER 系，玩家用正文色（§4 问题 6）
      this.unitNameLabel.color = isEnemy ? hex(COLOR.DANGER) : hex(COLOR.TEXT_PRIMARY);
    }
    if (this.hpLabel) {
      this.hpLabel.string = `HP: ${hp}/${maxHp}`;
      this.hpLabel.color = isEnemy ? hex(COLOR.DANGER) : hex(COLOR.SUCCESS);
    }
    if (this.energyLabel) {
      this.energyLabel.string = `\u26A1 ${energy}/${maxEnergy}`;
      this.energyLabel.color = hex(COLOR.INFO);
    }
    if (this.turnLabel) this.turnLabel.string = `\u56DE\u5408 ${turn}`;
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

    // 兵牌：纵向堆叠在棋盘左侧，行高与间距统一走设计令牌
    const cardWidth = CARD_WIDTH;
    const cardHeight = CONTROL.ROW_HEIGHT;
    const gap = CONTROL.ROW_GAP;
    const count = unitNames.length;
    const baseX = -265;
    const baseY = -200;

    for (let i = 0; i < count; i++) {
      const card = new Node(`PlatoonCard_${i}`);
      // 从下往上排列：i=0 最底，i=2 最高
      card.setPosition(baseX, baseY + i * (cardHeight + gap), 0);

      // 背景：Sprite 的 @requireComponent 已自带 UITransform，不可重复 addComponent
      // （重复添加会让 setContentSize 设到未被使用的那一个上，节点仍是默认 100×100
      //   → 卡片按 100 高与 8 间距排布时必然重叠）
      const bg = card.addComponent(Sprite);
      bg.color = hex(COLOR.SURFACE, ALPHA.PANEL_BG);
      bg.sizeMode = Sprite.SizeMode.CUSTOM;
      const cardTransform = card.getComponent(UITransform);
      if (cardTransform) cardTransform.setContentSize(cardWidth, cardHeight);

      // 图标（上半部分）
      const iconNode = new Node('IconLabel');
      const iconUi = iconNode.addComponent(UITransform);
      iconUi.setContentSize(cardWidth, 32);
      const iconLabel = iconNode.addComponent(Label);
      iconLabel.string = unitIcons[i] || '';
      applyFontAndColor(iconLabel, FONT_BODY, COLOR.TEXT_PRIMARY);
      iconLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      iconLabel.verticalAlign = Label.VerticalAlign.CENTER;
      iconNode.setPosition(0, 14, 0);
      card.addChild(iconNode);

      // 名字（下半部分）
      const nameNode = new Node('NameLabel');
      const nameUi = nameNode.addComponent(UITransform);
      nameUi.setContentSize(cardWidth, 20);
      const nl = nameNode.addComponent(Label);
      nl.string = unitNames[i];
      applyFontAndColor(nl, FONT_TINY, COLOR.TEXT_SECONDARY);
      nl.horizontalAlign = Label.HorizontalAlign.CENTER;
      nl.verticalAlign = Label.VerticalAlign.CENTER;
      nameNode.setPosition(0, -18, 0);
      card.addChild(nameNode);

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
    const cardHeight = CONTROL.ROW_HEIGHT;

    // 左侧竖条即选中指示条，不再用整块 HighlightBorder 覆盖卡片
    // （覆盖式高亮会与卡片内的图标/名字 100% 重叠；见改版方案 §4 问题 1）
    let bar = card.getChildByName('SelectBar');
    if (!bar) {
      bar = new Node('SelectBar');
      const barSprite = bar.addComponent(Sprite);
      barSprite.sizeMode = Sprite.SizeMode.CUSTOM;
      const barUi = bar.getComponent(UITransform);
      if (barUi) barUi.setContentSize(SELECT_BAR_WIDTH, cardHeight - SPACE.SM);
      // 贴卡片左缘内侧，竖直居中
      bar.setPosition(-CARD_WIDTH / 2 + SELECT_BAR_WIDTH / 2 + 1, 0, 0);
      card.addChild(bar);
    }

    const barSpriteComp = bar.getComponent(Sprite);

    switch (state) {
      case 'unplaced':
        if (bg) bg.color = hex(COLOR.SURFACE, ALPHA.PANEL_BG);
        card.setScale(new Vec3(1, 1, 1));
        bar.active = false;
        break;

      case 'selected':
        // 选中：主色背景 + 左侧主色竖条（取代原来的 1.12 放大与整块绿框）
        if (bg) bg.color = hex(COLOR.PRIMARY, ALPHA.PANEL_BG);
        card.setScale(new Vec3(1, 1, 1));
        if (barSpriteComp) barSpriteComp.color = hex(COLOR.TEXT_PRIMARY);
        bar.active = true;
        break;

      case 'placed':
        // 已部署：压暗底色 + 金色竖条
        if (bg) bg.color = hex(COLOR.PRIMARY_DISABLED, ALPHA.PANEL_BG);
        card.setScale(new Vec3(1, 1, 1));
        if (barSpriteComp) barSpriteComp.color = hex(COLOR.WARNING);
        bar.active = true;
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

  /**
   * 更新阶段条与当前单位。
   * 参数顺序以「阶段条」为中心：phase 与 actionHint 是阶段条的唯一内容，
   * 单位信息（unitName/unitIndex/totalUnits）写在左侧状态面板里。
   * 原签名把 actionHint 放在最后，导致部署/敌方回合的提示被当作 unitName 丢失。
   */
  updatePhase(
    phase: string,
    actionHint?: string,
    unitName?: string,
    unitIndex?: number,
    totalUnits?: number
  ): void {
    // 单一阶段条：阶段名 + 操作提示合成一句（P1 合并原 PhaseLabel/ActionHintLabel/DeployPrompt）
    this.setPhaseBar(phase, actionHint);
    if (this.unitTurnLabel) {
      if (unitName && unitIndex !== undefined && totalUnits !== undefined) {
        this.unitTurnLabel.string = `${unitName} (${unitIndex}/${totalUnits})`;
      } else {
        this.unitTurnLabel.string = unitName ?? '';
      }
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
    if (this.attackButton) {
      this.attackButton.active = !isEnemyTurn && !isDeploy;
    }
    if (this.skillButtonContainer) {
      this.skillButtonContainer.active = !isEnemyTurn && !isDeploy;
    }
  }

  /**
   * 单一阶段条：把「阶段」与「操作提示」写进同一个 Label。
   * 原实现把两者分散在 PhaseLabel / DeployPrompt / ActionHintLabel 三个节点上，
   * 造成文案重复与相互重叠（见改版方案 §4 问题 5）。
   */
  private setPhaseBar(phase: string, actionHint?: string): void {
    if (!this.phaseLabel) return;
    if (actionHint && actionHint.length > 0) {
      this.phaseLabel.string = `${phase} \u00B7 ${actionHint}`;
    } else {
      this.phaseLabel.string = phase;
    }
    this._lastPhaseText = this.phaseLabel.string;
    this._lastPhaseColor = COLOR.TEXT_PRIMARY;
    this.phaseLabel.color = hex(COLOR.TEXT_PRIMARY);
  }

  clearPhase(): void {
    if (this.phaseLabel) {
      this.phaseLabel.string = '';
      this.phaseLabel.color = hex(COLOR.TEXT_PRIMARY);
    }
    if (this.unitTurnLabel) this.unitTurnLabel.string = '';
    this.hideAttackButton();
  }

  /** 显示自动跳过提示（短暂展示后恢复） */
  showAutoSkipNotice(unitName: string): void {
    if (this.phaseLabel) {
      this.phaseLabel.string = `${unitName} \u65E0\u53EF\u653B\u51FB\u76EE\u6807\uFF0C\u81EA\u52A8\u8DF3\u8FC7`;
      this.phaseLabel.color = hex(COLOR.WARNING);
    }
    // 2 秒后自动恢复提示
    if (this._autoSkipNoticeCb) {
      this.unschedule(this._autoSkipNoticeCb);
      this._autoSkipNoticeCb = null;
    }
    this._autoSkipNoticeCb = () => {
      this._autoSkipNoticeCb = null;
      if (this.phaseLabel) {
        this.phaseLabel.string = this._lastPhaseText;
        this.phaseLabel.color = hex(this._lastPhaseColor);
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
