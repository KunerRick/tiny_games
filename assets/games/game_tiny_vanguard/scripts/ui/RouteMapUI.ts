import { _decorator, Component, Node, ScrollView, instantiate, Prefab, Button, Label, Color, Sprite, UITransform, Graphics, Vec3, tween, Tween, Event } from 'cc';
import { ALPHA, COLOR, FONT_CAPTION, FONT_TITLE, applyFontAndColor, hex } from '../config/Theme';
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

  generateRoute(): RouteNode[] {
    const nodes: RouteNode[] = [
      { id: 0, type: 'battle', row: 0, col: 0, connections: [1, 2], completed: false },
      { id: 1, type: 'battle', row: 1, col: 0, connections: [3], completed: false },
      { id: 2, type: 'battle', row: 1, col: 1, connections: [3], completed: false },
      { id: 3, type: 'shop', row: 2, col: 0, connections: [4, 5], completed: false },
      { id: 4, type: 'elite', row: 3, col: 0, connections: [6], completed: false },
      { id: 5, type: 'event', row: 3, col: 1, connections: [6], completed: false },
      { id: 6, type: 'battle', row: 4, col: 0, connections: [7, 8], completed: false },
      { id: 7, type: 'rest', row: 5, col: 0, connections: [9], completed: false },
      { id: 8, type: 'elite', row: 5, col: 1, connections: [9], completed: false },
      { id: 9, type: 'boss', row: 6, col: 0, connections: [], completed: false },
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

    this.nodesContainer.removeAllChildren();
    const typeIcons: Record<string, string> = {
      battle: '\u2694\uFE0F', elite: '\uD83D\uDD25', shop: '\uD83C\uDFEA',
      rest: '\uD83D\uDCA4', event: '\uD83E\uDDEA', boss: '\uD83C\uDFC6'
    };

    for (const node of nodes) {
      const btnNode = instantiate(this.nodePrefab);
      if (!btnNode?.isValid) continue;
      btnNode.name = `Node_${node.id}`;
      const pos = this.nodePosition(node.col, node.row);
      btnNode.setPosition(pos.x, pos.y, 0);

      // 节点按 NODE_SIZE 统一尺寸（NodePrefab 原为 70，与列/行距配合不佳）
      const ui = btnNode.getComponent(UITransform);
      if (ui) ui.setContentSize(NODE_SIZE, NODE_SIZE);

      const label = btnNode.getComponentInChildren(Label);
      if (label) {
        label.string = typeIcons[node.type] || '?';
        applyFontAndColor(label, FONT_TITLE, COLOR.TEXT_PRIMARY);
        const labelUi = label.node.getComponent(UITransform);
        if (labelUi) labelUi.setContentSize(NODE_SIZE, FONT_TITLE.lineHeight);
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
    const total = this._nodes.length;
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
    const sprite = btnNode.getComponent(Sprite);
    if (!sprite) return;

    // 先停止并复位上一次的循环高亮动画，避免重复叠加
    Tween.stopAllByTarget(btnNode);
    btnNode.setScale(1, 1, 1);

    const isReachable = this.isReachable(node.id);
    if (node.completed) {
      sprite.color = hex(COLOR.TEXT_SECONDARY, ALPHA.SOLID);          // 已完成：灰实心
    } else if (isReachable) {
      sprite.color = hex(COLOR.SUCCESS, ALPHA.SOLID);                 // 可达：绿实心 + 呼吸
      tween(btnNode)
        .to(0.5, { scale: new Vec3(1.08, 1.08, 1) })
        .to(0.5, { scale: new Vec3(1.0, 1.0, 1) })
        .union()
        .repeatForever()
        .start();
    } else {
      // 未解锁：深色实心（不是半透明），彻底遮住线头
      sprite.color = hex(COLOR.SURFACE, ALPHA.SOLID);
    }
  }

  private isReachable(nodeId: number): boolean {
    if (nodeId === 0) return true;
    // connections 存的是"从本节点能去往的节点ID"（正向边）
    // 检查是否有某个节点的 connections 包含 nodeId 且该节点已完成
    return this._nodes.some(n =>
      n.connections.includes(nodeId) && n.completed
    );
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
