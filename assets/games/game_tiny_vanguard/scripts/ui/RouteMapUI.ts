import { _decorator, Component, Node, ScrollView, instantiate, Prefab, Button, Label, Color, Sprite, UITransform, Graphics, Vec3, tween, Tween, Event } from 'cc';
import { ALPHA, COLOR, FONT_BODY, FONT_CAPTION, FONT_TITLE, applyFontAndColor, hex, stripVariationSelectors } from '../config/Theme';
import { drawRouteGlyph, makeLabel } from './GameUIKit';
const { ccclass, property } = _decorator;

// ---------------------------------------------------------------------------
// 路线图布局常量（必须与场景里 content / NodesContainer 的尺寸保持一致）
// ---------------------------------------------------------------------------
/** 列距：两列时 x = -COL_GAP/2 与 +COL_GAP/2（原 130 太窄，节点挤在左侧） */
const COL_GAP = 180;
/** 行距 */
const ROW_GAP = 140;
/** 图节点边长（< COL_GAP 且 < ROW_GAP，保证不重叠） */
const NODE_SIZE = 80;
/** 内容区顶部留白（第一行中心的 y） */
const CONTENT_TOP = 400;
/** 内容区最小宽度（画布 720 留安全边距） */
const CONTENT_MIN_W = 688;

/**
 * V4：节点类型配色（一眼识别"这层是什么"）。
 * 与图例文案一一对应；可达时用满色 + 呼吸，不可达时压暗为同色系深色。
 */
const TYPE_LABEL: Record<string, string> = {
  battle: '战斗',
  elite: '精英',
  shop: '商店',
  rest: '休息',
  event: '事件',
  boss: 'Boss',
};

const TYPE_COLOR: Record<string, string> = {
  battle: COLOR.PRIMARY,
  elite: COLOR.WARNING,
  shop: COLOR.SUCCESS,
  rest: COLOR.INFO,
  event: COLOR.PASSIVE,
  boss: COLOR.DANGER,
};


export interface RouteNode {
  id: number;
  type: 'battle' | 'elite' | 'shop' | 'rest' | 'event' | 'boss';
  row: number;
  col: number;
  connections: number[];
  completed: boolean;
}

@ccclass('RouteMapUI')
export class RouteMapUI extends Component {
  @property({ type: ScrollView, tooltip: '路线图滚动容器' })
  scrollView: ScrollView = null;

  @property({ type: Prefab, tooltip: '路线节点预制体' })
  nodePrefab: Prefab = null;

  @property({ type: Node, tooltip: '节点容器' })
  nodesContainer: Node = null;

  @property({ type: Node, tooltip: '连接线图层' })
  connectionsLayer: Node = null;

  @property({ type: Label, tooltip: '关卡进度（已通关 N/M）' })
  progressLabel: Label = null;

  @property({ type: Label, tooltip: '节点类型图例' })
  legendLabel: Label = null;

  private _nodes: RouteNode[] = [];
  private _nodeViews: Map<number, Node> = new Map();
  private _currentNodeId: number = 0;
  private _onNodeClickCallback: ((nodeId: number) => void) | null = null;
  private _showCalled: boolean = false;

  onLoad(): void {
    if (!this._showCalled) {
      this.node.active = false;
    }
  }

  show(): void {
    this._showCalled = true;
    this.node.active = true;
  }

  hide(): void {
    this.node.active = false;
  }

  setNodeClickCallback(callback: (nodeId: number) => void): void {
    this._onNodeClickCallback = callback;
  }

  /**
   * 生成路线图（12 节点 / 7 层，与设计 §4.1 的构成一致：
   * 6 战斗 + 2 精英 + 商店 + 休息 + 事件 + Boss）。
   *
   * id 必须**按层递增**：续档时用 `id < currentNodeId` 推断已通关节点/战斗场次。
   * 每层 2 个节点 = 一次"选路"，配合 `isReachable` 的同层互斥，一局每层只能走一个。
   */
  generateRoute(): RouteNode[] {
    const nodes: RouteNode[] = [
      { id: 0, type: 'battle', row: 0, col: 0, connections: [1, 2], completed: false },

      { id: 1, type: 'battle', row: 1, col: 0, connections: [3, 4], completed: false },
      { id: 2, type: 'battle', row: 1, col: 1, connections: [3, 4], completed: false },

      // 第 3 层：商店 / 战斗 —— 要钱还是要升级
      { id: 3, type: 'shop', row: 2, col: 0, connections: [5, 6], completed: false },
      { id: 4, type: 'battle', row: 2, col: 1, connections: [5, 6], completed: false },

      { id: 5, type: 'elite', row: 3, col: 0, connections: [7, 8], completed: false },
      { id: 6, type: 'event', row: 3, col: 1, connections: [7, 8], completed: false },

      { id: 7, type: 'battle', row: 4, col: 0, connections: [9, 10], completed: false },
      { id: 8, type: 'battle', row: 4, col: 1, connections: [9, 10], completed: false },

      { id: 9, type: 'rest', row: 5, col: 0, connections: [11], completed: false },
      { id: 10, type: 'elite', row: 5, col: 1, connections: [11], completed: false },

      { id: 11, type: 'boss', row: 6, col: 0, connections: [], completed: false },
    ];
    return nodes;
  }

  /** 图节点中心坐标（渲染与连线必须共用同一公式，否则线头对不上节点） */
  private nodePosition(col: number, row: number): { x: number; y: number } {
    return {
      x: (col - 0.5) * COL_GAP,
      y: CONTENT_TOP - row * ROW_GAP,
    };
  }

  private drawConnections(): void {
    if (!this.connectionsLayer) return;
    const graphics = this.connectionsLayer.getComponent(Graphics);
    if (!graphics) return;
    graphics.clear();

    for (const node of this._nodes) {
      for (const targetId of node.connections) {
        const target = this._nodes.find(n => n.id === targetId);
        if (!target) continue;

        const from = this.nodePosition(node.col, node.row);
        const to = this.nodePosition(target.col, target.row);

        // 颜色取自设计令牌：已完成=次要文字、可达=成功、未解锁=面板描边
        const bothDone = node.completed && target.completed;
        const reachToTarget = node.completed && this.isReachable(targetId);
        let lineColor: Color;
        if (bothDone) {
          lineColor = hex(COLOR.TEXT_SECONDARY, ALPHA.LINE);
        } else if (reachToTarget) {
          lineColor = hex(COLOR.SUCCESS, ALPHA.LINE);
        } else {
          lineColor = hex(COLOR.PANEL_BORDER, ALPHA.SOLID);
        }

        graphics.strokeColor = lineColor;
        graphics.lineWidth = 4;
        graphics.moveTo(from.x, from.y);
        graphics.lineTo(to.x, to.y);
        graphics.stroke();

        // 折线中点的路标圆点：让路线走向更可读
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        graphics.fillColor = lineColor;
        graphics.circle(midX, midY, 3);
        graphics.fill();

        // 箭头（指向目标）
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const arrowLen = 8;
        const ax1 = to.x - arrowLen * Math.cos(angle - 0.4);
        const ay1 = to.y - arrowLen * Math.sin(angle - 0.4);
        const ax2 = to.x - arrowLen * Math.cos(angle + 0.4);
        const ay2 = to.y - arrowLen * Math.sin(angle + 0.4);
        graphics.moveTo(to.x, to.y);
        graphics.lineTo(ax1, ay1);
        graphics.moveTo(to.x, to.y);
        graphics.lineTo(ax2, ay2);
        graphics.stroke();
      }
    }
  }

  renderRoute(nodes: RouteNode[]): void {
    this._nodes = nodes;
    if (!this.nodesContainer) return;

    // 先把连接线层级移到最底部，确保其在节点图标和背景下方
    if (this.connectionsLayer?.isValid) {
      this.connectionsLayer.setSiblingIndex(0);
    }

    this.nodesContainer.destroyAllChildren();
    this._nodeViews.clear();

    if (this.legendLabel) {
      // 场景里这两个 Label 用的是默认小字（13 号 ≈ 手机 7px），图例与进度几乎读不出来；
      // 统一提到正文 / 说明字号，跟其它页面的信息层级对齐。
      this.legendLabel.string = '战斗 \u00B7 精英 \u00B7 商店 \u00B7 休息 \u00B7 事件 \u00B7 Boss';
      applyFontAndColor(this.legendLabel, FONT_CAPTION, COLOR.TEXT_SECONDARY);
    }
    if (this.progressLabel) {
      applyFontAndColor(this.progressLabel, FONT_BODY, COLOR.TEXT_PRIMARY);
    }

    for (const node of nodes) {
      const btnNode = instantiate(this.nodePrefab);
      if (!btnNode?.isValid) continue;
      btnNode.name = `Node_${node.id}`;
      const pos = this.nodePosition(node.col, node.row);
      btnNode.setPosition(pos.x, pos.y, 0);

      // 节点按 NODE_SIZE 统一尺寸（NodePrefab 原为 70，与列/行距配合不佳）
      const ui = btnNode.getComponent(UITransform);
      if (ui) ui.setContentSize(NODE_SIZE, NODE_SIZE);

      // 旧 prefab 的方块底与 emoji 文字全部让位给矢量勋章
      const sprite = btnNode.getComponent(Sprite);
      if (sprite) sprite.enabled = false;
      for (const child of btnNode.children) {
        const lb = child.getComponent(Label);
        if (lb && child.name !== 'CheckMark') child.active = false;
      }

      // 已完成打勾标记（运行时补齐，避免再动 prefab）
      const check = this.ensureCheckMark(btnNode);
      if (check) check.active = node.completed;

      // 存储节点 ID，使用事件委托避免 Button 组件依赖
      btnNode['_routeNodeId'] = node.id;
      btnNode.on(Node.EventType.TOUCH_END, this.onRouteNodeTouchEnd, this);

      this.nodesContainer.addChild(btnNode);
      this._nodeViews.set(node.id, btnNode);
      this.applyNodeVisual(node, btnNode);

      // 节点下方的类型名：让"这一站是什么"不必靠记图标
      const nameLb = makeLabel(
        btnNode, 'TypeName', TYPE_LABEL[node.type] ?? node.type,
        FONT_CAPTION, COLOR.TEXT_SECONDARY, 'center', 110, FONT_CAPTION.lineHeight
      );
      nameLb.node.setPosition(0, -NODE_SIZE / 2 - 14, 0);
    }

    this.updateProgressLabel();
    this.drawConnections();
  }

  /** 右上角的完成勾选标记（幂等创建） */
  private ensureCheckMark(btnNode: Node): Node | null {
    const existing = btnNode.getChildByName('CheckMark');
    if (existing?.isValid) return existing;
    const mark = new Node('CheckMark');
    const markUi = mark.addComponent(UITransform);
    markUi.setContentSize(24, 20);
    const markLabel = mark.addComponent(Label);
    markLabel.string = '\u2713';
    applyFontAndColor(markLabel, FONT_CAPTION, COLOR.SUCCESS);
    markLabel.horizontalAlign = Label.HorizontalAlign.RIGHT;
    markLabel.verticalAlign = Label.VerticalAlign.TOP;
    mark.setPosition(NODE_SIZE / 2 - 12, NODE_SIZE / 2 - 10, 0);
    btnNode.addChild(mark);
    return mark;
  }

  /** 顶部进度：已通关节点数 / 总节点数 */
  private updateProgressLabel(): void {
    if (!this.progressLabel) return;
    // 分母不能用节点总数：分支互斥（见 isReachable）后一局最多"每层走一个"，
    // 10 个节点最多走 7 个 —— 用总数会让进度条永远填不满。
    const total = new Set(this._nodes.map(n => n.row)).size;
    const done = this._nodes.filter(n => n.completed).length;
    this.progressLabel.string = `\u5DF2\u901A\u5173 ${done}/${total}`;
  }

  /**
   * 按节点状态刷新单个节点图标的颜色与高亮动画（供增量更新复用）。
   * 节点一律用**不透明实心**底色：原来未解锁节点用 alpha=128 半透明，
   * 连接线会从底下透出，看起来像"线画在节点上方"（改版方案 §4 问题 2）。
   */
  private applyNodeVisual(node: RouteNode, btnNode: Node): void {
    if (!btnNode?.isValid) return;

    // 先停止并复位上一次的循环高亮动画，避免重复叠加
    Tween.stopAllByTarget(btnNode);
    btnNode.setScale(1, 1, 1);

    const isReachable = this.isReachable(node.id);
    const typeHex = TYPE_COLOR[node.type] ?? COLOR.PRIMARY;
    const state: 'done' | 'open' | 'locked' = node.completed
      ? 'done'
      : isReachable ? 'open' : 'locked';

    // 勋章：类型色外盘 + 深色内盘 + 矢量图标
    let artNode = btnNode.getChildByName('NodeArt');
    if (!artNode?.isValid) {
      artNode = new Node('NodeArt');
      artNode.addComponent(UITransform).setContentSize(NODE_SIZE, NODE_SIZE);
      btnNode.addChild(artNode);
    }
    artNode.setSiblingIndex(0);
    const g = artNode.getComponent(Graphics) ?? artNode.addComponent(Graphics);
    g.clear();

    const R = NODE_SIZE / 2 - 4;
    if (state === 'open') {
      g.fillColor = hex(typeHex, 46);
      g.circle(0, 0, R + 4);
      g.fill();
    }

    g.fillColor = state === 'done'
      ? hex(COLOR.TEXT_DISABLED, 255)
      : state === 'open' ? hex(typeHex, 255) : this.darken(typeHex);
    g.circle(0, 0, R);
    g.fill();

    g.strokeColor = state === 'open'
      ? hex(COLOR.TEXT_PRIMARY, 210)
      : state === 'done' ? hex(COLOR.PANEL_BORDER, 255) : hex(typeHex, 150);
    g.lineWidth = state === 'open' ? 3.5 : 2.5;
    g.circle(0, 0, R - 1);
    g.stroke();

    // 内盘：让图标从彩色边环中"浮"出来
    g.fillColor = hex(COLOR.PANEL_BG, state === 'locked' ? 210 : 236);
    g.circle(0, 0, R - 9);
    g.fill();

    drawRouteGlyph(
      g, node.type, R * 0.46,
      state === 'done' ? COLOR.TEXT_SECONDARY
        : state === 'open' ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED
    );

    // 类型名颜色跟随状态（open 用类型色，紧凑但不喧宾夺主）
    const typeName = btnNode.getChildByName('TypeName')?.getComponent(Label);
    if (typeName) {
      typeName.string = stripVariationSelectors(TYPE_LABEL[node.type] ?? node.type);
      applyFontAndColor(typeName, FONT_CAPTION,
        state === 'open' ? typeHex : (state === 'done' ? COLOR.TEXT_SECONDARY : COLOR.TEXT_DISABLED));
    }

    if (state === 'open') {
      tween(btnNode)
        .to(0.5, { scale: new Vec3(1.07, 1.07, 1) })
        .to(0.5, { scale: new Vec3(1.0, 1.0, 1) })
        .union()
        .repeatForever()
        .start();
    }

    const check = btnNode.getChildByName('CheckMark');
    if (check?.isValid) check.active = node.completed;
  }

  /** 把类型色向面板底色压暗 60%，得到"未解锁"的深色版（仍为不透明实心） */
  private darken(colorHex: string): Color {
    const base = hex(colorHex, ALPHA.SOLID);
    const dim = hex(COLOR.SURFACE, ALPHA.SOLID);
    return new Color(
      Math.round(base.r * 0.4 + dim.r * 0.6),
      Math.round(base.g * 0.4 + dim.g * 0.6),
      Math.round(base.b * 0.4 + dim.b * 0.6),
      ALPHA.SOLID
    );
  }

  /**
   * 该节点现在是否可点。
   *
   * 两条规则：
   * 1. 有**已完成**的节点连向它（`connections` 存的是正向边，见 `generateRoute`）；
   * 2. **同一层（row）的兄弟节点尚未走过** —— 否则一局能把两个分支都打完
   *    （原实现只有规则 1：实测完成节点 2 之后节点 1 仍然可达，一局可清空全部 10 个节点），
   *    "选路"形同虚设、资源被刷满，削弱肉鸽取舍（设计 §4.1 是树形选路）。
   */
  private isReachable(nodeId: number): boolean {
    if (nodeId === 0) return true;
    const me = this._nodes.find(n => n.id === nodeId);
    if (!me) return false;
    const hasCompletedParent = this._nodes.some(n =>
      n.connections.includes(nodeId) && n.completed
    );
    if (!hasCompletedParent) return false;
    const siblingTaken = this._nodes.some(n =>
      n.row === me.row && n.id !== me.id && n.completed
    );
    return !siblingTaken;
  }

  private onNodeTapped(nodeId: number): void {
    if (!this.isReachable(nodeId)) return;
    const node = this._nodes.find(n => n.id === nodeId);
    if (node?.completed) return;
    this._currentNodeId = nodeId;
    if (this._onNodeClickCallback) {
      this._onNodeClickCallback(nodeId);
    }
  }

  completeNode(nodeId: number): void {
    const node = this._nodes.find(n => n.id === nodeId);
    if (!node) return;
    node.completed = true;
    // 增量刷新：只更新现有节点图标的视觉，不整棵树重建
    for (const n of this._nodes) {
      const view = this._nodeViews.get(n.id);
      if (view?.isValid) {
        this.applyNodeVisual(n, view);
        const check = view.getChildByName('CheckMark');
        if (check) check.active = n.completed;
      }
    }
    this.updateProgressLabel();
    this.drawConnections();
  }

  get currentNodeId(): number {
    return this._currentNodeId;
  }

  getNodeById(id: number): RouteNode | undefined {
    return this._nodes.find(n => n.id === id);
  }

  get nodes(): RouteNode[] {
    return this._nodes;
  }

  private onRouteNodeTouchEnd(event: Event): void {
    const node = (event?.target as Node) ?? (event?.currentTarget as Node);
    if (!node?.isValid) return;
    const nodeId = node['_routeNodeId'] as number;
    if (nodeId === undefined || nodeId === null) return;
    this.onNodeTapped(nodeId);
  }

  onDestroy(): void {
    // 子节点随本节点销毁自动释放；按规范不访问 @property(Node)
    this._onNodeClickCallback = null;
    this._nodes = [];
    this._nodeViews.clear();
  }
}
