import { _decorator, Component, Node, Label, Button, Sprite, SpriteFrame, tween, Vec3, instantiate, Prefab, UITransform, EventTouch } from 'cc';
import {
  ALPHA, CLASS_COLOR, COLOR, CONTROL, FONT_BODY, FONT_CAPTION, FONT_DISPLAY, FONT_TITLE, FONT_TINY,
  applyButtonTheme, applyFont, applyFontAndColor, hex,
} from '../config/Theme';
const { ccclass, property } = _decorator;

/**
 * 站台槽位宽度。
 * §3.5：从 110 收到 100，配合中心左移到 SLOT_CENTER_X，与棋盘 col0 留出 10px 间隙
 * （左侧可用区仅 120px 宽，属紧贴排布）。
 */
const SLOT_WIDTH = 100;
/** 槽位高度 = 列表行高 */
const SLOT_HEIGHT = CONTROL.ROW_HEIGHT;
/** 槽位区中心相对 BattleUI 的 local x（世界 x = 60 → [10, 110]） */
const SLOT_CENTER_X = -300;
/** 最下方槽位中心相对 BattleUI 的 local y（world 440，与旧兵牌第 0 张一致） */
const SLOT_BASE_Y = -200;
/** 槽位边框线宽（4 条细 Sprite 拼实线，替代虚线——项目无虚线贴图，方案 §3.4 默认 (a)） */
const SLOT_BORDER_WIDTH = 2;
/**
 * 槽位内文字块尺寸与位置。
 * 标签**必须显式给宽高并 CLAMP**：Label 默认按内容自适应，emoji fallback 字体
 * 会把高度撑到 35px+ 顶穿边框；宽度留出左右边框的余量，避免与边框接触。
 * 各值与边框之间保留 ≥1px 间隙（审计判据为 >0.5px 即算重叠）。
 */
const SLOT_LABEL_WIDTH = SLOT_WIDTH - 2 * SLOT_BORDER_WIDTH - 2;
const SLOT_ICON_HEIGHT = 28;
const SLOT_ICON_Y = 15;
const SLOT_NAME_HEIGHT = 24;
const SLOT_NAME_Y = -17;

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

  @property({ type: Node, tooltip: '布阵单位列表容器（站台槽位的父节点）' })
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
  /** 纯色块贴图缓存（undefined = 尚未查询；null = 查询失败，不再重试） */
  private _solidFrame: SpriteFrame | null | undefined = undefined;
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
    overlaySprite.color = hex(COLOR.BG_OVERLAY, 0);   // 起始全透明，动画中渐暗
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

    // 结算面板结构由场景提供（P2 重构：三行左右对齐统计 + ContinueBtn / 图标 / 摘要行）。
    // 不再运行时创建 GoldLabel / TurnCountLabel / DamageLabel / ContinueLabel，
    // 避免「场景里已有」与「运行时再建一套」两个来源并存（改版方案 §8 目标）。
  }

  show(): void {
    this._showCalled = true;
    this.node.active = true;
    // 按钮主题放在 show() 而非 onLoad()：面板懒初始化时 onLoad 早已执行过，
    // 且 onLoad 期间节点尚未激活，部分组件尚未就绪。
    this.applyButtonThemes();
    if (!this._eventsBound) {
      this._eventsBound = true;
      this.bindEvents();
    }
  }

  /** 行动栏/布阵按钮的过渡色统一走令牌（P5） */
  private applyButtonThemes(): void {
    applyButtonTheme(this.attackButton?.getComponent(Button) ?? null, 'secondary');
    applyButtonTheme(this.waitButton?.getComponent(Button) ?? null, 'secondary');
    applyButtonTheme(this.endTurnButton?.getComponent(Button) ?? null, 'primary');
    applyButtonTheme(this.confirmDeployButton?.getComponent(Button) ?? null, 'primary');
    // 单场胜利面板的“继续”按钮（场景节点，P2 建的）
    const continueBtn = this.victoryPanel?.getChildByName('ContinueBtn');
    applyButtonTheme(continueBtn?.getComponent(Button) ?? null, 'primary');
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
    // 布阵阶段只保留「确认布阵」：等待/攻击/结束回合一并收起。
    // 原先只关 waitButton，而布阵期间 BattleManager 又不通知阶段变化，
    // 于是上一场残留的「结束回合」按钮会露在布阵界面下方。
    this.setActionButtonsVisible(false);
    // 隐藏状态栏面板（仅在部署阶段）
    this.setStatPanelVisible(false);
    // 单一阶段条：阶段 + 操作提示合成一句，不再有多处重复文案
    this.setPhaseBar('\u5E03\u9635\u9636\u6BB5', '\u70B9\u51FB\u524D\u4E24\u884C\u90E8\u7F72\u5355\u4F4D');
    // 站台槽位容器由 setupDeploySlots 直接置为可见（槽位挂在其中）
    if (this.deployUnitList) this.deployUnitList.active = true;
  }

  hideDeployPhase(): void {
    if (this.confirmDeployButton) this.confirmDeployButton.active = false;
    if (this.waitButton) this.waitButton.active = true;
    // 恢复状态栏面板
    this.setStatPanelVisible(true);
    // 离开布阵：收起站台槽位（容器内的槽位随之不可见）
    if (this.deployUnitList) this.deployUnitList.active = false;
  }

  /** 行动栏三按钮的统一出口（布阵/敌方回合收起，我方回合按需显示） */
  private setActionButtonsVisible(visible: boolean): void {
    if (this.waitButton) this.waitButton.active = visible;
    if (this.endTurnButton) this.endTurnButton.active = visible;
    if (this.attackButton) this.attackButton.active = visible;
  }

  /**
   * 部署阶段隐藏 / 战斗阶段恢复 状态栏面板。
   * 注意：不含 `turnLabel` —— HudTop 是 Canvas 根级常驻节点，其显隐由
   * TinyVanguardMain 的状态机统一管理（否则两个管理者各关一半，非战斗
   * 界面会残留「回合 1」）。本类只负责写它的文本。
   */
  private setStatPanelVisible(visible: boolean): void {
    // UnitInfoPanel 是 unitNameLabel/hpLabel/energyLabel 的父节点
    if (this.unitNameLabel?.node?.parent) {
      this.unitNameLabel.node.parent.active = visible;
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

  /**
   * 构建左下角的固定站台槽位（§3.4）。
   *
   * 与旧实现的区别：① 槽位复用场景里一直空置的 `deployUnitList` 作为容器
   * （旧代码把卡片直接挂在 BattleUI 下，该容器从未被使用）；② 宽度 110 → 100
   * 并整体左移，消除与棋盘第 0 列的重叠（§3.5）；③ 背景**必须设 spriteFrame**
   * —— 旧卡片只设了 color，`spriteFrame = null` 时 Cocos 什么都不画（背景不可见）。
   */
  setupDeploySlots(
    unitNames: string[],
    unitIcons: string[],
    unitClassIds: string[],
    callback: (index: number) => void
  ): void {
    const container = this.deployUnitList;
    if (!container?.isValid) {
      console.warn('[BattleUI] deployUnitList 未绑定，站台槽位无法创建');
      return;
    }

    // 清除旧槽位
    for (const slot of this._deployCards) {
      if (slot?.isValid) {
        slot.off(Node.EventType.TOUCH_END, this.onDeploySlotClicked, this);
      }
    }
    for (const child of container.children.slice()) {
      if (child?.isValid) child.removeFromParent();
    }
    this._deployCards = [];
    this._onDeployCardCb = callback;

    const count = unitNames.length;
    const totalHeight = count * SLOT_HEIGHT + Math.max(0, count - 1) * CONTROL.ROW_GAP;

    // 容器归位（场景里可能尚未设置，运行时按设计值补齐；幂等）。
    // 容器中心 = 最下方槽位中心 + 半个槽位区高度，这样 i=0 的槽位恒定落在 SLOT_BASE_Y
    // （与旧兵牌位置一致，避免整列无谓位移）。
    const listCenterY = SLOT_BASE_Y + Math.max(0, count - 1) * (SLOT_HEIGHT + CONTROL.ROW_GAP) / 2;
    container.setPosition(SLOT_CENTER_X, listCenterY, 0);
    const containerUi = container.getComponent(UITransform);
    if (containerUi) {
      containerUi.setAnchorPoint(0.5, 0.5);
      containerUi.setContentSize(SLOT_WIDTH, Math.max(totalHeight, SLOT_HEIGHT));
    }
    container.active = true;

    for (let i = 0; i < count; i++) {
      const slot = new Node(`DeploySlot_${i}`);
      // 从下往上排列：i=0 最底
      const y = -totalHeight / 2 + SLOT_HEIGHT / 2 + i * (SLOT_HEIGHT + CONTROL.ROW_GAP);
      slot.setPosition(0, y, 0);
      slot['_deployIdx'] = i;
      slot['_deployClassId'] = unitClassIds[i] ?? '';

      // 背景：Sprite 的 @requireComponent 已自带 UITransform，不可重复 addComponent
      // 顺序要紧：spriteFrame → sizeMode=CUSTOM → color → contentSize（最后），
      // 否则尺寸会被贴图原始尺寸覆盖（AGENTS.md 教训 C）。
      const bg = slot.addComponent(Sprite);
      const frame = this.getSolidSpriteFrame();
      if (frame) bg.spriteFrame = frame;
      bg.sizeMode = Sprite.SizeMode.CUSTOM;
      bg.type = Sprite.Type.SIMPLE;
      bg.color = hex(COLOR.SURFACE, ALPHA.PANEL_BG);
      const slotUi = slot.getComponent(UITransform);
      if (slotUi) slotUi.setContentSize(SLOT_WIDTH, SLOT_HEIGHT);

      // 4 条细 Sprite 拼实线边框（项目无虚线贴图 → 方案 §3.4 的默认方案 (a)）
      for (const b of BattleUI.SLOT_BORDERS) {
        const line = new Node(b.name);
        const lineSprite = line.addComponent(Sprite);
        if (frame) lineSprite.spriteFrame = frame;
        lineSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        lineSprite.type = Sprite.Type.SIMPLE;
        lineSprite.color = hex(COLOR.PANEL_BORDER);
        const lineUi = line.getComponent(UITransform);
        if (lineUi) lineUi.setContentSize(b.w, b.h);
        line.setPosition(b.x, b.y, 0);
        slot.addChild(line);
      }

      // 图标（上半部分）
      // 宽度避开左右边框、高度钳制后与上下边框各留 1px 间隙：
      // Label 默认按内容自适应（emoji fallback 字体把高度撑到 35px+），会与边框接触。
      const iconNode = new Node('IconLabel');
      const iconUi = iconNode.addComponent(UITransform);
      iconUi.setContentSize(SLOT_LABEL_WIDTH, SLOT_ICON_HEIGHT);
      const iconLabel = iconNode.addComponent(Label);
      iconLabel.string = unitIcons[i] || '';
      applyFontAndColor(iconLabel, FONT_BODY, COLOR.TEXT_PRIMARY);
      iconLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      iconLabel.verticalAlign = Label.VerticalAlign.CENTER;
      iconLabel.overflow = Label.Overflow.CLAMP;
      iconNode.setPosition(0, SLOT_ICON_Y, 0);
      slot.addChild(iconNode);

      // 名字（下半部分）
      const nameNode = new Node('NameLabel');
      const nameUi = nameNode.addComponent(UITransform);
      nameUi.setContentSize(SLOT_LABEL_WIDTH, SLOT_NAME_HEIGHT);
      const nl = nameNode.addComponent(Label);
      nl.string = unitNames[i];
      applyFontAndColor(nl, FONT_TINY, COLOR.TEXT_SECONDARY);
      nl.horizontalAlign = Label.HorizontalAlign.CENTER;
      nl.verticalAlign = Label.VerticalAlign.CENTER;
      nl.overflow = Label.Overflow.CLAMP;
      nameNode.setPosition(0, SLOT_NAME_Y, 0);
      slot.addChild(nameNode);

      // 交互（点击兜底路径，P3 另叠加拖拽）
      slot.on(Node.EventType.TOUCH_END, this.onDeploySlotClicked, this);

      container.addChild(slot);
      this._deployCards.push(slot);
    }
  }

  /**
   * 4 条边框相对槽位中心的偏移与尺寸（线宽 SLOT_BORDER_WIDTH）。
   * 上下边框两端各让出 SLOT_BORDER_WIDTH，与左右边框**拼接**而非交叠 ——
   * 否则四角会形成 2×2 的自重叠（审计会判为重叠）。
   */
  private static readonly SLOT_BORDERS = [
    { name: 'BorderTop',    x: 0, y:  SLOT_HEIGHT / 2 - SLOT_BORDER_WIDTH / 2, w: SLOT_WIDTH - 2 * SLOT_BORDER_WIDTH, h: SLOT_BORDER_WIDTH },
    { name: 'BorderBottom', x: 0, y: -SLOT_HEIGHT / 2 + SLOT_BORDER_WIDTH / 2, w: SLOT_WIDTH - 2 * SLOT_BORDER_WIDTH, h: SLOT_BORDER_WIDTH },
    { name: 'BorderLeft',   x: -SLOT_WIDTH / 2 + SLOT_BORDER_WIDTH / 2, y: 0, w: SLOT_BORDER_WIDTH, h: SLOT_HEIGHT },
    { name: 'BorderRight',  x:  SLOT_WIDTH / 2 - SLOT_BORDER_WIDTH / 2, y: 0, w: SLOT_BORDER_WIDTH, h: SLOT_HEIGHT },
  ] as const;

  /**
   * 纯色块用的贴图。旧实现只写 color 不写 spriteFrame，
   * 而 `spriteFrame = null` 时 Sprite 不做任何绘制 —— 这就是"兵牌背景不可见"的根因。
   *
   * 必须**借用场景里已在用的贴图**（默认九宫格 `default_sprite_splash`），
   * 不能用 `builtinResMgr.get('default-spriteframe')`：后者的 texture 是 2×2 的
   * `default-texture`，DynamicAtlas 打包它时会持续抛
   * `texSubImage2D: Overload resolution failed`。
   */
  private getSolidSpriteFrame(): SpriteFrame | null {
    if (this._solidFrame !== undefined) return this._solidFrame;
    let frame: SpriteFrame | null = null;
    const donors = [this.confirmDeployButton, this.waitButton, this.attackButton, this.endTurnButton];
    for (const d of donors) {
      const sp = d?.isValid ? d.getComponent(Sprite) : null;
      if (sp?.spriteFrame) { frame = sp.spriteFrame; break; }
    }
    if (!frame) {
      console.warn('[BattleUI] 场景中没有可借用贴图的按钮节点，槽位背景/边框将不可见');
    }
    this._solidFrame = frame;
    return frame;
  }

  private onDeploySlotClicked(evt: EventTouch): void {
    const slot = evt.currentTarget as Node;
    if (!slot?.isValid) return;
    const idx = slot['_deployIdx'] as number;
    if (this._onDeployCardCb) this._onDeployCardCb(idx);
  }

  /**
   * 三态外观（§3.4）。
   * `placed` 的语义是"兵还在、已上场"：底色压暗 + 图标/名字淡化，
   * 边框改用该单位的**职业色**，一眼看出是哪一兵种占着这个站台。
   */
  setDeploySlotState(index: number, state: 'unplaced' | 'selected' | 'placed'): void {
    const slot = this._deployCards[index];
    if (!slot?.isValid) return;

    const bg = slot.getComponent(Sprite);
    const classId = (slot['_deployClassId'] as string) ?? '';
    const classColor = CLASS_COLOR[classId] ?? CLASS_COLOR.fallback;
    const applyBorder = (c: string) => {
      for (const b of BattleUI.SLOT_BORDERS) {
        const line = slot.getChildByName(b.name);
        const sp = line?.getComponent(Sprite);
        if (sp) sp.color = hex(c);
      }
    };
    const setTextAlpha = (c: string) => {
      const icon = slot.getChildByName('IconLabel')?.getComponent(Label);
      const name = slot.getChildByName('NameLabel')?.getComponent(Label);
      if (icon) icon.color = hex(c);
      if (name) name.color = hex(c);
    };

    switch (state) {
      case 'unplaced':
        if (bg) bg.color = hex(COLOR.SURFACE, ALPHA.PANEL_BG);
        applyBorder(COLOR.PANEL_BORDER);
        setTextAlpha(COLOR.TEXT_PRIMARY);
        break;

      case 'selected':
        // 选中：主色背景 + 主色边框（取代旧的 1.12 放大与整块绿框）
        if (bg) bg.color = hex(COLOR.PRIMARY, ALPHA.PANEL_BG);
        applyBorder(COLOR.PRIMARY);
        setTextAlpha(COLOR.TEXT_PRIMARY);
        break;

      case 'placed':
        // 空站台：底色压暗 + 图标/名字淡化，边框用该单位职业色表示"兵还在、已上场"
        if (bg) bg.color = hex(COLOR.PRIMARY_DISABLED, ALPHA.PANEL_BG);
        applyBorder(classColor);
        setTextAlpha(COLOR.TEXT_DISABLED);
        break;
    }

    slot.setScale(new Vec3(1, 1, 1));
    // 记录状态用于 selectDeploySlot 判断
    slot['_deployState'] = state;
  }

  selectDeploySlot(index: number): void {
    // 先重置所有槽位为 unplaced（已上阵的保持 placed 态）
    for (let i = 0; i < this._deployCards.length; i++) {
      const slot = this._deployCards[i];
      if (!slot?.isValid) continue;
      if (slot['_deployState'] === 'placed') continue;
      this.setDeploySlotState(i, 'unplaced');
    }
    // 设置目标槽位为选中态（仅当未上阵时）
    const targetSlot = this._deployCards[index];
    if (targetSlot?.isValid && targetSlot['_deployState'] !== 'placed') {
      this.setDeploySlotState(index, 'selected');
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
      applyFont(label, FONT_TITLE);
    }

    const sprite = node.getComponent(Sprite);
    if (sprite) {
      // 掉血=危险色，回血=成功色（§3.1 语义色）
      sprite.color = amount > 0 ? hex(COLOR.DANGER) : hex(COLOR.SUCCESS);
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
    // 两个结算面板互斥：显示胜利面板时收起失败面板与布阵按钮
    if (this.defeatPanel) this.defeatPanel.active = false;
    if (this.confirmDeployButton) this.confirmDeployButton.active = false;
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
    // 结算面板与战斗 HUD 同屏会互相压叠（状态面板世界区域落在面板上方），
    // 结算期间隐藏状态面板；下一场由 showDeployPhase/hideDeployPhase 恢复。
    this.setStatPanelVisible(false);

    // 统计值写进场景里的右对齐 Value 节点（左键在场景，右值运行时填）
    const goldValue = this.victoryPanel?.getChildByName('StatsGoldValue')?.getComponent(Label);
    if (goldValue) {
      goldValue.string = `+${gold}`;
    }

    const turnValue = this.victoryPanel?.getChildByName('StatsTurnValue')?.getComponent(Label);
    if (turnValue) {
      turnValue.string = `${turnCount}`;
    }

    const dmgValue = this.victoryPanel?.getChildByName('StatsDamageValue')?.getComponent(Label);
    if (dmgValue) {
      dmgValue.string = `${totalDamage}`;
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

  /**
   * 失败面板。
   * P2 统一版式后结构与胜利/通关一致：标题 + 一行副信息 + 主按钮样式；
   * ScoreLabel 用于一行战绩摘要（原实现留空）。
   */
  showDefeat(summary: string = ''): void {
    // 与 showVictory 对称：两个结算面板互斥，并收起布阵按钮
    if (this.victoryPanel) this.victoryPanel.active = false;
    if (this.confirmDeployButton) this.confirmDeployButton.active = false;
    if (this.defeatPanel) {
      // 确保面板在最顶层（避免被单位遮挡）
      this.ensurePanelOnTop(this.defeatPanel);
      this.defeatPanel.active = true;

      const resultLabel = this.defeatPanel.getChildByName('DefeatLabel')?.getComponent(Label);
      if (resultLabel) {
        resultLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        resultLabel.verticalAlign = Label.VerticalAlign.CENTER;
        resultLabel.string = '\u5931 \u8D25';
        applyFontAndColor(resultLabel, FONT_DISPLAY, COLOR.DANGER);
      }

      const scoreLabel = this.defeatPanel.getChildByName('ScoreLabel')?.getComponent(Label);
      if (scoreLabel) {
        scoreLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        scoreLabel.verticalAlign = Label.VerticalAlign.CENTER;
        scoreLabel.string = summary;
        applyFontAndColor(scoreLabel, FONT_BODY, COLOR.TEXT_SECONDARY);
      }
    }
    if (this.waitButton) {
      this.waitButton.active = false;
    }
    if (this.skillButtonContainer) {
      this.skillButtonContainer.active = false;
    }
    // 同 showVictory：结算期间隐藏状态面板，避免与面板区域压叠
    this.setStatPanelVisible(false);
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
      .to(0.3, { color: hex(COLOR.BG_OVERLAY, ALPHA.BG_OVERLAY) })
      .call(() => {
        // 步骤2: 大字出现 (1.2s)
        tween(titleNode)
          .to(0.4, { scale: new Vec3(1.2, 1.2, 1) })
          .to(0.6, { scale: new Vec3(1, 1, 1) })
          .delay(0.2)
          .call(() => {
            // 步骤3: 遮罩淡出 (0.3s)
            tween(overlaySprite)
              .to(0.3, { color: hex(COLOR.BG_OVERLAY, 0) })
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
