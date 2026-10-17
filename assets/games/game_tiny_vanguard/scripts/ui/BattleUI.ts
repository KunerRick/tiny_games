import { _decorator, Component, Node, Label, Button, Sprite, SpriteFrame, UIOpacity, Vec2, Vec3, tween, instantiate, Prefab, UITransform, EventTouch } from 'cc';
import {
  ALPHA, CLASS_COLOR, COLOR, CONTROL, FONT_BODY, FONT_CAPTION, FONT_DISPLAY, FONT_ICON, FONT_TITLE, FONT_TINY,
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

/**
 * 拖拽跟随徽章（ghost）的边长。
 *
 * 取 72 与 `UnitController.GLOW_SIZE`（棋盘单位的阵营光环）同值：拖拽中看到的就是
 * "落下去会变成的那个东西"的形状，与 80×80 的棋盘格子也对得上。
 * 旧实现直接复制兵牌形状（100×64 横条）且只有图标、没名字，下半截空着，
 * 读起来像一条色块 —— 与落点形状不一致，这是"长方形"观感不佳的根因。
 */
const DRAG_GHOST_SIZE = 72;
/** 徽章描边线宽 */
const DRAG_GHOST_BORDER = 2;
/** 徽章内图标块边长（避开四周边框，各留 1px 间隙，避免审计判为重叠） */
const DRAG_GHOST_ICON_SIZE = DRAG_GHOST_SIZE - 2 * DRAG_GHOST_BORDER - 2;

/** 棋盘坐标（与 GridController.GridPosition 结构一致；此处只做结构约束，避免 ui→battle 的类型依赖） */
export interface DeployDropPos {
  row: number;
  col: number;
}

/**
 * 布阵拖拽的规则层接口。视觉与手势全在 BattleUI，落子规则全在 BattleManager
 * （方案 §3.3 的职责划分）；由 TinyVanguardMain 在开局时接线。
 */
export interface DeployDragApi {
  /** UI 坐标（设计像素）→ 棋盘坐标；不在棋盘范围返回 null */
  worldToGrid: (x: number, y: number) => DeployDropPos | null;
  /** 该格上的己方单位下标；无则 -1 */
  unitAtGrid: (pos: DeployDropPos) => number;
  /** 是否可落子（row<=1 且未被别的单位占用） */
  canPlaceAt: (unitIndex: number, pos: DeployDropPos) => boolean;
  /** 落子（含棋盘内移动） */
  placeUnit: (unitIndex: number, pos: DeployDropPos) => void;
  /** 撤回到兵牌区 */
  unplaceUnit: (unitIndex: number) => void;
  /** 场上两兵换位 */
  swapUnits: (indexA: number, indexB: number) => void;
  /** 高亮落点（pos = null 表示清除高亮；valid 决定绿/灰） */
  previewDrop: (pos: DeployDropPos | null, valid: boolean) => void;
  /** 拖拽开始/结束（规则层借此停掉单位的选中缩放 tween，见 §6 风险） */
  beginDrag: (unitIndex: number) => void;
  endDrag: (unitIndex: number) => void;
  /** 拖拽期间把原单位/槽位置为半透明 */
  setUnitDimmed: (unitIndex: number, dimmed: boolean) => void;
}

/** 位移超过该距离（设计像素）才判定为拖拽，避免误伤点击（§3.3） */
const DRAG_THRESHOLD = 8;

/**
 * 是否存在真实触摸输入（桌面浏览器 = 0，真机 / 设备模拟 > 0）。
 *
 * 用于分辨 `TOUCH_CANCEL` 的两种含义，见 `onDragTouchCancel`：
 * 桌面鼠标拖拽在抬起时被引擎派发为 CANCEL（把 CANCEL 当"中断"会让桌面拖拽永不生效）；
 * 真机上的 CANCEL 才是真正的手势中断。
 */
function hasRealTouchInput(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.maxTouchPoints === 'number'
    && navigator.maxTouchPoints > 0;
}

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
  /**
   * 各槽位的图标与兵种 id，供**拖拽徽章**着色/取图标。
   *
   * 槽位自身不显示兵种（已上阵即"纯地面空格"），但拖拽徽章需要"这是哪个兵"的
   * 职业色与图标 —— 两者用途不同，故在此单独留存。
   */
  private _deployIcons: string[] = [];
  private _deployClassIds: string[] = [];
  /** 纯色块贴图缓存（undefined = 尚未查询；null = 查询失败，不再重试） */
  private _solidFrame: SpriteFrame | null | undefined = undefined;
  // --- 布阵拖拽（§3.3）：视觉与手势在本类，规则在 DeployDragApi ---
  private _dragApi: DeployDragApi | null = null;
  /** 仅布阵阶段响应全局触摸 */
  private _dragEnabled: boolean = false;
  /** 本次触摸锁定的兵下标；-1 = 未锁定 */
  private _dragUnitIndex: number = -1;
  /** 位移已超过阈值、确认为拖拽（用于区分轻触） */
  private _dragActive: boolean = false;
  /** 本次触摸已被拖拽消费 → 抑制随后派发的点击（格 Button / 槽位 TOUCH_END） */
  private _dragConsumed: boolean = false;
  /** 拖拽起点在棋盘上（而非兵牌槽位）→ 落到兵牌区才允许撤回 */
  private _dragFromBoard: boolean = false;
  private _dragStartPos: Vec2 | null = null;
  private _dragGhost: Node | null = null;
  /** 拖拽手势监听的宿主节点（= Canvas，Grid 与 BattleUI 的共同父节点） */
  private _dragHost: Node | null = null;
  /** 本次交互是否已开始过手势（幂等标记，见 setDeployDragEnabled 注释） */
  private _dragSession: boolean = false;
  /**
   * 本次手势所属触摸点的 id（`EventTouch.getID()`）；-1 = 无手势。
   *
   * 只用 `_dragSession` 挡不住**第二根手指**：多指时第二指按下会被幂等标记挡掉、不覆盖
   * `_dragUnitIndex`，但它的 `TOUCH_MOVE`/`TOUCH_END` 仍会走到本类 —— 于是第二指抬起会
   * 拿第一指锁定的兵去"结算落点"，把单位落到第二指的位置。桌面鼠标的 id 恒为 0（实测
   * start/move/cancel 全是 `id=0`），故该校验对桌面是无副作用的纯加固。
   */
  private _dragTouchId: number = -1;
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
    // 布阵阶段开启拖拽手势（P3）；离开时在 hideDeployPhase 关闭
    this.setDeployDragEnabled(true);
  }

  hideDeployPhase(): void {
    if (this.confirmDeployButton) this.confirmDeployButton.active = false;
    if (this.waitButton) this.waitButton.active = true;
    // 恢复状态栏面板
    this.setStatPanelVisible(true);
    // 离开布阵：收起站台槽位（容器内的槽位随之不可见）
    if (this.deployUnitList) this.deployUnitList.active = false;
    // 关闭拖拽手势监听（含清幽灵/高亮/淡化）
    this.setDeployDragEnabled(false);
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
  // -------------------------------------------------------------------------
  // 布阵拖拽（§3.3）：兵牌 ↔ 棋盘双向 + 棋盘内换位
  // -------------------------------------------------------------------------

  /** 注入规则层接口（由 TinyVanguardMain 在开局接线） */
  setDeployDragApi(api: DeployDragApi | null): void {
    this._dragApi = api;
  }

  /**
   * 布阵阶段开启 / 离开时关闭拖拽手势监听。
   *
   * 宿主与阶段两个选择都是实测结论：
   * - 宿主必须是 **`Canvas`**（`Grid` 与 `BattleUI` 的共同父节点）：`Grid` 不在
   *   `BattleUI` 子树内，挂 `BattleUI` 收不到"起点在棋盘格上"的触摸；全局 `input`
   *   在桌面浏览器只有 `MOUSE_*`、且 `MOUSE_UP` 不派发，没有可用的结束事件。
   * - 必须用**捕获阶段**（`useCapture = true`）：棋盘格的 `Button` 在
   *   `TOUCH_START` 时会 `stopPropagation`，冒泡阶段读不到起点在棋盘上的手势
   *   （表现为"棋盘内换位"整条路径失效）。捕获阶段只读事件、不阻断传播，
   *   故不影响 `Button` 自身的点击判定（点击兜底路径另由 `isDragConsumingTouch`
   *   在 `onDeployCellClicked` 里抑制）。
   *
   * 结束语义：桌面（无真实触摸）下拖拽抬起被引擎派发为 `TOUCH_CANCEL`、
   * 没有 `TOUCH_END`，而真机两者都有 —— 差异在 `onDragTouchCancel` 里分流。
   */
  setDeployDragEnabled(enabled: boolean): void {
    if (this._dragEnabled === enabled) return;
    this._dragEnabled = enabled;

    if (enabled) {
      const host = this.node?.parent ?? null;
      if (!host?.isValid) return;
      this._dragHost = host;
      host.on(Node.EventType.TOUCH_START, this.onDragTouchStart, this, true);
      host.on(Node.EventType.TOUCH_MOVE, this.onDragTouchMove, this, true);
      host.on(Node.EventType.TOUCH_END, this.onDragTouchEnd, this, true);
      host.on(Node.EventType.TOUCH_CANCEL, this.onDragTouchCancel, this, true);
    } else {
      const host = this._dragHost;
      if (host?.isValid) {
        host.off(Node.EventType.TOUCH_START, this.onDragTouchStart, this, true);
        host.off(Node.EventType.TOUCH_MOVE, this.onDragTouchMove, this, true);
        host.off(Node.EventType.TOUCH_END, this.onDragTouchEnd, this, true);
        host.off(Node.EventType.TOUCH_CANCEL, this.onDragTouchCancel, this, true);
      }
      this._dragHost = null;
      this.endDragGesture();
    }
  }

  /**
   * 拖拽守卫：本次触摸已被拖拽消费时返回 true。
   * 棋盘格的 Button 与槽位的 TOUCH_END 都会在拖拽结束后正常派发，
   * 若不拦截会与拖拽结果重复生效（落一次子后又按点击再落一次）。
   */
  isDragConsumingTouch(): boolean {
    return this._dragConsumed;
  }

  private onDragTouchStart(evt: EventTouch): void {
    if (!this._dragEnabled) return;
    this.beginDragGesture(evt);
  }

  private onDragTouchMove(evt: EventTouch): void {
    if (!this._dragEnabled || !this.isDragPointer(evt)) return;
    this.moveDragGesture(evt.getUILocation());
  }

  private onDragTouchEnd(evt: EventTouch): void {
    if (!this._dragEnabled || !this.isDragPointer(evt)) return;
    this.finishDragGesture(evt.getUILocation());
  }

  private onDragTouchCancel(evt: EventTouch): void {
    if (!this._dragEnabled || !this.isDragPointer(evt)) return;
    // ⚠️ 实测：桌面环境（无真实触摸）下鼠标拖拽抬起被引擎派发为 TOUCH_CANCEL 而非
    // TOUCH_END。若照搬方案"取消一律回位"，桌面拖拽永不生效 —— 故按输入设备分流：
    // 无真实触摸 ⇒ 这次 CANCEL 就是"手势正常结束"；真机 ⇒ 按方案回位、不改状态。
    if (!hasRealTouchInput()) {
      this.finishDragGesture(evt.getUILocation());
      return;
    }
    if (!this._dragActive) {
      this.resetDragGestureState();
      return;
    }
    this.endDragGesture();
  }

  /**
   * 该事件是否属于**当前手势**的那个触摸点。
   * 用于丢弃多指时其它手指的 MOVE/END/CANCEL（见 `_dragTouchId`）。
   * `beginDragGesture` 走的是 `_dragSession` 幂等标记，故这里也覆盖 START 之后的全部阶段。
   */
  private isDragPointer(evt: EventTouch): boolean {
    return this._dragSession && evt.getID() === this._dragTouchId;
  }

  /** 手势起点：锁定棋盘上的己方单位或兵牌槽位内的单位 */
  private beginDragGesture(evt: EventTouch): void {
    if (!this._dragEnabled || !this._dragApi) return;
    // 幂等：两套源都会派发 START/DOWN，第一个到达的认领本次手势，其余忽略
    if (this._dragSession) return;
    this._dragSession = true;
    this._dragTouchId = evt.getID();
    const p = evt.getUILocation();
    this._dragStartPos = new Vec2(p.x, p.y);
    this._dragActive = false;
    this._dragConsumed = false;
    this._dragFromBoard = false;
    this._dragUnitIndex = -1;

    const onBoard = this._dragApi.worldToGrid(p.x, p.y);
    if (onBoard) {
      const idx = this._dragApi.unitAtGrid(onBoard);
      if (idx >= 0) {
        this._dragUnitIndex = idx;
        this._dragFromBoard = true;
      }
      return;
    }
    const slotIdx = this.indexOfDeploySlotAt(p.x, p.y);
    if (slotIdx >= 0) this._dragUnitIndex = slotIdx;
  }

  /** 手势移动：超阈值才认定为拖拽；之后跟随幽灵并高亮落点 */
  private moveDragGesture(p: { x: number; y: number }): void {
    if (!this._dragEnabled || !this._dragApi) return;
    if (this._dragUnitIndex < 0) return;

    if (!this._dragActive) {
      // 位移未超阈值 → 仍可能是点击，不启动拖拽（避免误伤点选）
      if (!this._dragStartPos) return;
      const dx = p.x - this._dragStartPos.x;
      const dy = p.y - this._dragStartPos.y;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      this._dragActive = true;
      this._dragConsumed = true;
      this._dragApi.beginDrag(this._dragUnitIndex);
      this.showDragGhost(this._dragUnitIndex);
      this.setDragDimmed(this._dragUnitIndex, true);
    }
    this.moveDragGhost(p.x, p.y);
    this.updateDropHighlight(this._dragUnitIndex, this._dragFromBoard, p.x, p.y);
  }

  /**
   * 手势结束：位移未达阈值时交给既有点击路径；否则结算落点。
   * 结算后若**什么都没改**、且手势起于兵牌，则补一次「轻触兵牌」（见 `fallbackToCardTap`）。
   */
  private finishDragGesture(p: { x: number; y: number }): void {
    if (!this._dragEnabled || !this._dragApi) return;
    if (!this._dragActive) {
      // 未达阈值 = 轻触：交给既有点击路径（槽位/棋盘格），此处不动
      this.resetDragGestureState();
      return;
    }
    const applied = this.applyDrop(this._dragUnitIndex, this._dragFromBoard, p.x, p.y);
    if (!applied) this.fallbackToCardTap();
    this.endDragGesture();
  }

  /**
   * 拖拽「落空」时的兜底：手势起于兵牌 → 按轻触兵牌处理（调用与 `onDeploySlotClicked`
   * 同一个回调，即 `selectDeployUnit(idx)`）。
   *
   * 为什么需要：兵牌只有 100×64，而 `DRAG_THRESHOLD` 只有 8 **设计**像素（本机渲染比例下
   * ≈ 4.3pt），手指/鼠标稍有抖动就判定为拖拽；此时落点又什么都没改，`_dragConsumed` 还把
   * 随后派发的点击吞掉 —— 表现为**点兵牌选中/撤回完全没反应**。实测横移 5 CSS 像素即复现
   * （3 CSS 像素正常、5 起失效）；量测与事件语义见
   * `docs/tech/browser-verify-cocos-preview.md` §11.6。
   *
   * 为什么不「清掉 `_dragConsumed` 让引擎补发点击」：落点不在该兵牌上时引擎派发的是
   * `TOUCH_CANCEL` 而非 `TOUCH_END`，点击路径收不到；即便收到，点击也会派发给**落点那个**
   * 节点（落在棋盘格上会拿"当前选中"去落子、落在别的兵牌上会选中别人），语义完全错位。
   * 显式调用原槽位回调则与落点无关，跨平台一致。
   *
   * 只兜底**兵牌**、不动棋盘：棋盘上「拖起又放回原格」是 `applyDrop` 明确定义的**无操作**，
   * 若补发点击会变成「撤回该单位」（点击路径里点已上阵单位 = 撤回），与"放回去"的意图相反。
   */
  private fallbackToCardTap(): void {
    const idx = this._dragUnitIndex;
    if (this._dragFromBoard || idx < 0) return;
    if (this._onDeployCardCb) this._onDeployCardCb(idx);
  }

  /**
   * 拖拽落点结算（真实规则全部走 DeployDragApi）。
   * 返回本次是否真的改变了布阵状态 —— `false` 供 `fallbackToCardTap` 判断"拖了个空"。
   */
  private applyDrop(unitIndex: number, fromBoard: boolean, x: number, y: number): boolean {
    const api = this._dragApi;
    if (!api) return false;

    // 落在兵牌区 → 撤回（仅棋盘上提起的兵允许拖回，避免原地抬起又放下被当成撤回）
    if (this.hitTestDeploySlot(x, y)) {
      if (!fromBoard) return false;
      api.unplaceUnit(unitIndex);
      return true;
    }

    const pos = api.worldToGrid(x, y);
    if (!pos) return false;

    const occupant = api.unitAtGrid(pos);
    if (occupant === unitIndex) return false;              // 落回原格 → 无操作

    if (occupant >= 0) {
      // 目标格被己方占用：仅"棋盘内拖动"可换位；从兵牌拖来视为非法落点（回位）
      if (!fromBoard) return false;
      api.swapUnits(unitIndex, occupant);
      return true;
    }

    if (!api.canPlaceAt(unitIndex, pos)) return false;
    api.placeUnit(unitIndex, pos);
    return true;
  }

  /** 统一收尾：清幽灵/高亮/淡化，恢复选中缩放 */
  private endDragGesture(): void {
    const idx = this._dragUnitIndex;
    const wasActive = this._dragActive;
    const api = this._dragApi;
    this.resetDragGestureState();

    if (wasActive && api && idx >= 0) {
      api.previewDrop(null, true);
      api.endDrag(idx);
      this.setDragDimmed(idx, false);
      this.destroyDragGhost();
    }
    // 守卫必须**无条件**延后撤下：否则离开布阵/销毁时残留 true，
    // 会让后续所有棋盘点击被误判成"拖拽已消费"而静默失效。
    if (this._dragConsumed) {
      this.scheduleOnce(this.clearDragConsumed, 0);
    }
  }

  /** scheduleOnce 的命名回调（避免匿名闭包，符合 AGENTS 红线 5） */
  private clearDragConsumed(): void {
    this._dragConsumed = false;
  }

  /** 只重置手势状态，不动视觉（视觉由 endDragGesture 处理） */
  private resetDragGestureState(): void {
    this._dragUnitIndex = -1;
    this._dragActive = false;
    this._dragFromBoard = false;
    this._dragStartPos = null;
    // 会话标记随本次交互释放；不清会让下一次交互被残留挡掉
    this._dragSession = false;
    this._dragTouchId = -1;
  }

  /** UI 坐标是否落在兵牌容器范围内 */
  private hitTestDeploySlot(x: number, y: number): boolean {
    return this.indexOfDeploySlotAt(x, y) >= 0;
  }

  /** 命中的兵牌下标；未命中返回 -1 */
  private indexOfDeploySlotAt(x: number, y: number): number {
    const container = this.deployUnitList;
    if (!container?.isValid || !container.activeInHierarchy) return -1;
    // 直接用槽位自身的世界矩形判定（容器高度随数量变化，逐个比更可靠）
    for (let i = 0; i < this._deployCards.length; i++) {
      const slot = this._deployCards[i];
      const ui = slot?.isValid ? slot.getComponent(UITransform) : null;
      if (!ui) continue;
      const w = ui.convertToWorldSpaceAR(new Vec3(0, 0, 0));
      const halfW = ui.width * 0.5;
      const halfH = ui.height * 0.5;
      if (x >= w.x - halfW && x <= w.x + halfW && y >= w.y - halfH && y <= w.y + halfH) {
        return i;
      }
    }
    return -1;
  }

  /** 高亮落点：可放 = DEPLOYABLE 绿，不可放 = DEPLOY_DISABLED 灰，null 清除 */
  private updateDropHighlight(unitIndex: number, fromBoard: boolean, x: number, y: number): void {
    const api = this._dragApi;
    if (!api) return;
    if (this.hitTestDeploySlot(x, y)) {
      api.previewDrop(null, true);
      return;
    }
    const pos = api.worldToGrid(x, y);
    if (!pos) {
      api.previewDrop(null, true);
      return;
    }
    const occupant = api.unitAtGrid(pos);
    const ok = occupant === unitIndex
      || (occupant >= 0 ? fromBoard : false)
      || api.canPlaceAt(unitIndex, pos);
    api.previewDrop(pos, ok);
  }

  /**
   * 拖拽跟随徽章：**方形**（`DRAG_GHOST_SIZE`）+ 职业色底 + 居中职业图标 + 同色描边。
   *
   * 旧实现复制兵牌形状（100×64 横条）且只有图标、没名字，下半截空着 ——
   * 既读作"一条色块"，又与 80×80 的落点方格形状不一致。改成方形徽章后，
   * 拖拽中看到的形状就是"落下去会变成的那个单位"（与棋盘阵营光环同为 72）。
   */
  private showDragGhost(unitIndex: number): void {
    this.destroyDragGhost();
    const frame = this.getSolidSpriteFrame();
    const classColor = CLASS_COLOR[this._deployClassIds[unitIndex]] ?? CLASS_COLOR.fallback;

    const ghost = new Node('DeployDragGhost');
    const bg = ghost.addComponent(Sprite);
    if (frame) bg.spriteFrame = frame;
    bg.sizeMode = Sprite.SizeMode.CUSTOM;
    bg.type = Sprite.Type.SIMPLE;
    // 略透，露出下方的落点高亮，保留"幽灵"语义
    bg.color = hex(classColor, ALPHA.DRAG_GHOST);
    const ui = ghost.getComponent(UITransform);
    if (ui) ui.setContentSize(DRAG_GHOST_SIZE, DRAG_GHOST_SIZE);

    // 描边用职业色实心，与 200 的底色拉开层次（同一套拼接规则，不会有 2×2 自重叠）
    BattleUI.createBorderLines(
      ghost, DRAG_GHOST_SIZE, DRAG_GHOST_SIZE, DRAG_GHOST_BORDER, classColor, frame
    );

    const icon = this._deployIcons[unitIndex] ?? '';
    if (icon) {
      const iconNode = new Node('IconLabel');
      const iconUi = iconNode.addComponent(UITransform);
      iconUi.setContentSize(DRAG_GHOST_ICON_SIZE, DRAG_GHOST_ICON_SIZE);
      const l = iconNode.addComponent(Label);
      l.string = icon;
      applyFontAndColor(l, FONT_ICON, COLOR.TEXT_PRIMARY);
      l.horizontalAlign = Label.HorizontalAlign.CENTER;
      l.verticalAlign = Label.VerticalAlign.CENTER;
      l.overflow = Label.Overflow.CLAMP;
      iconNode.setPosition(0, 0, 0);
      ghost.addChild(iconNode);
    }

    // 挂在 deployUnitList 的父级下，保证与世界坐标同系
    const parent = this.deployUnitList?.parent ?? this.node;
    parent.addChild(ghost);
    this._dragGhost = ghost;
  }

  private moveDragGhost(x: number, y: number): void {
    const ghost = this._dragGhost;
    if (!ghost?.isValid) return;
    const parent = ghost.parent;
    const ui = parent?.getComponent(UITransform);
    if (ui) {
      const local = ui.convertToNodeSpaceAR(new Vec3(x, y, 0));
      ghost.setPosition(local);
    } else {
      ghost.setWorldPosition(new Vec3(x, y, 0));
    }
  }

  private destroyDragGhost(): void {
    if (this._dragGhost?.isValid) this._dragGhost.destroy();
    this._dragGhost = null;
  }

  /** 原兵牌/单位置为拖拽态（淡化），避免拖动时"两个自己"看着打架 */
  private setDragDimmed(unitIndex: number, dimmed: boolean): void {
    const slot = this._deployCards[unitIndex];
    if (slot?.isValid) {
      // 拿不到就自己建：写成"拿不到就跳过"会让淡化反馈静默失效
      // （同 AGENTS 教训 §3.5 ⑧：声明了却无人设置 → 整段可视化无声消失）
      let slotOpacity = slot.getComponent(UIOpacity);
      if (!slotOpacity) slotOpacity = slot.addComponent(UIOpacity);
      if (slotOpacity) slotOpacity.opacity = dimmed ? 120 : 255;
    }
    this._dragApi?.setUnitDimmed(unitIndex, dimmed);
  }

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
    // 供拖拽徽章取职业色/图标（槽位自身不显示兵种，见 _deployIcons 注释）
    this._deployIcons = unitIcons.slice();
    this._deployClassIds = unitClassIds.slice();

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
      BattleUI.createBorderLines(slot, SLOT_WIDTH, SLOT_HEIGHT, SLOT_BORDER_WIDTH, COLOR.PANEL_BORDER, frame);

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

  /** 边框节点名（4 条细 Sprite；供 `setDeploySlotState` 等只改色的地方按名查找） */
  private static readonly BORDER_NAMES = ['BorderTop', 'BorderBottom', 'BorderLeft', 'BorderRight'];

  /**
   * 给节点加 4 条细 Sprite 拼成的实线边框（项目无虚线贴图 → 方案 §3.4 默认 (a)）。
   * 上下边框两端各让出线宽，与左右边框**拼接**而非交叠 ——
   * 否则四角会形成 2×2 的自重叠（量化审计会判为重叠）。
   *
   * 兵牌槽位与拖拽徽章共用同一套规则，抽成静态方法避免两处各写一遍后改漏。
   */
  private static createBorderLines(
    parent: Node,
    width: number,
    height: number,
    thickness: number,
    colorHex: string,
    frame: SpriteFrame | null
  ): void {
    const defs = [
      { name: 'BorderTop',    x: 0,                          y:  height / 2 - thickness / 2, w: width - 2 * thickness, h: thickness },
      { name: 'BorderBottom', x: 0,                          y: -height / 2 + thickness / 2, w: width - 2 * thickness, h: thickness },
      { name: 'BorderLeft',   x: -width / 2 + thickness / 2, y: 0,                            w: thickness,             h: height },
      { name: 'BorderRight',  x:  width / 2 - thickness / 2, y: 0,                            w: thickness,             h: height },
    ];
    for (const d of defs) {
      const line = new Node(d.name);
      const lineSprite = line.addComponent(Sprite);
      if (frame) lineSprite.spriteFrame = frame;
      lineSprite.sizeMode = Sprite.SizeMode.CUSTOM;
      lineSprite.type = Sprite.Type.SIMPLE;
      lineSprite.color = hex(colorHex);
      const lineUi = line.getComponent(UITransform);
      if (lineUi) lineUi.setContentSize(d.w, d.h);
      line.setPosition(d.x, d.y, 0);
      parent.addChild(line);
    }
  }

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
    // 拖拽已消费本次触摸（含在槽位间拖动）→ 忽略随之而来的点击
    if (this._dragConsumed) return;
    const slot = evt.currentTarget as Node;
    if (!slot?.isValid) return;
    const idx = slot['_deployIdx'] as number;
    if (this._onDeployCardCb) this._onDeployCardCb(idx);
  }

  /**
   * 三态外观（§3.4）。
   *
   * `placed` 的语义是"兵已上场，位子空着"：显示为**纯地面空格**——暗色凹坑 + 内凹描边，
   * **隐藏图标与名字**。
   *
   * 为什么不再标兵种：左下槽位与单位是**强绑定**的（槽位 i 恒等于 `playerClasses[i]`，
   * 全程不变、不可买卖替换），所以"看到 slot0 空了"本身就说明是哪个兵上了场；
   * 再叠一层职业色描边属**冗余标识**。棋盘上的单位另带职业图标（`setupClassIcon`）可对照。
   * 撤回也不要求精确命中原槽位（拖到兵牌区任意位置即可）。
   */
  setDeploySlotState(index: number, state: 'unplaced' | 'selected' | 'placed'): void {
    const slot = this._deployCards[index];
    if (!slot?.isValid) return;

    const bg = slot.getComponent(Sprite);
    const applyBorder = (c: string) => {
      for (const name of BattleUI.BORDER_NAMES) {
        const line = slot.getChildByName(name);
        const sp = line?.getComponent(Sprite);
        if (sp) sp.color = hex(c);
      }
    };
    // 图标/名字显隐：仅"空站台"隐藏（让它真的读作一个空格）
    const setContentVisible = (visible: boolean) => {
      const icon = slot.getChildByName('IconLabel');
      const name = slot.getChildByName('NameLabel');
      if (icon) icon.active = visible;
      if (name) name.active = visible;
    };
    const setTextColor = (c: string) => {
      const icon = slot.getChildByName('IconLabel')?.getComponent(Label);
      const name = slot.getChildByName('NameLabel')?.getComponent(Label);
      if (icon) icon.color = hex(c);
      if (name) name.color = hex(c);
    };

    switch (state) {
      case 'unplaced':
        if (bg) bg.color = hex(COLOR.SURFACE, ALPHA.PANEL_BG);
        applyBorder(COLOR.PANEL_BORDER);
        setTextColor(COLOR.TEXT_PRIMARY);
        setContentVisible(true);
        break;

      case 'selected':
        // 选中：主色背景 + 主色边框（取代旧的 1.12 放大与整块绿框）
        if (bg) bg.color = hex(COLOR.PRIMARY, ALPHA.PANEL_BG);
        applyBorder(COLOR.PRIMARY);
        setTextColor(COLOR.TEXT_PRIMARY);
        setContentVisible(true);
        break;

      case 'placed':
        // 纯地面空格：暗色凹坑 + 内凹描边，不显示兵种
        if (bg) bg.color = hex(COLOR.SLOT_EMPTY_BG, ALPHA.SLOT_EMPTY_BG);
        applyBorder(COLOR.SLOT_EMPTY_BORDER);
        setContentVisible(false);
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
    // 拖拽监听挂在 Canvas（本节点的父级）上，需显式解绑
    this.unschedule(this.clearDragConsumed);
    this.setDeployDragEnabled(false);
    this.destroyDragGhost();
    this._dragApi = null;
    this._deployCards = [];
    this._deployIcons = [];
    this._deployClassIds = [];
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
