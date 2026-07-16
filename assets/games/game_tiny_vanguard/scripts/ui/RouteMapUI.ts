import { _decorator, Component, Node, ScrollView, instantiate, Prefab, Button, Label, Color, Sprite, UITransform, Graphics, Vec3, tween } from 'cc';
const { ccclass, property } = _decorator;

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

  private _nodes: RouteNode[] = [];
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

  private drawConnections(): void {
    if (!this.connectionsLayer) return;
    const graphics = this.connectionsLayer.getComponent(Graphics);
    if (!graphics) return;
    graphics.clear();

    for (const node of this._nodes) {
      for (const targetId of node.connections) {
        const target = this._nodes.find(n => n.id === targetId);
        if (!target) continue;

        const x1 = node.col * 130 + 80;
        const y1 = -node.row * 110 - 60;
        const x2 = target.col * 130 + 80;
        const y2 = -target.row * 110 - 60;

        const bothDone = node.completed && target.completed;
        const reachToTarget = node.completed && this.isReachable(targetId);
        let lineColor: Color;
        if (bothDone) {
          lineColor = new Color(156, 163, 175, 200);
        } else if (reachToTarget) {
          lineColor = new Color(34, 197, 94, 220);
        } else {
          lineColor = new Color(209, 213, 219, 150);
        }

        graphics.strokeColor = lineColor;
        graphics.lineWidth = 3;
        graphics.moveTo(x1, y1);
        graphics.lineTo(x2, y2);
        graphics.stroke();

        // 小箭头
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const arrowLen = 8;
        const ax1 = x2 - arrowLen * Math.cos(angle - 0.4);
        const ay1 = y2 - arrowLen * Math.sin(angle - 0.4);
        const ax2 = x2 - arrowLen * Math.cos(angle + 0.4);
        const ay2 = y2 - arrowLen * Math.sin(angle + 0.4);
        graphics.moveTo(x2, y2);
        graphics.lineTo(ax1, ay1);
        graphics.moveTo(x2, y2);
        graphics.lineTo(ax2, ay2);
        graphics.stroke();
      }
    }
  }

  renderRoute(nodes: RouteNode[]): void {
    this._nodes = nodes;
    if (!this.nodesContainer) return;

    this.nodesContainer.removeAllChildren();
    const typeIcons: Record<string, string> = {
      battle: '\u2694\uFE0F', elite: '\uD83D\uDD25', shop: '\uD83C\uDFEA',
      rest: '\uD83D\uDCA4', event: '\uD83E\uDDEA', boss: '\uD83C\uDFC6'
    };

    for (const node of nodes) {
      const btnNode = instantiate(this.nodePrefab);
      btnNode.name = `Node_${node.id}`;
      btnNode.setPosition(node.col * 130 + 80, -node.row * 110 - 60);

      const label = btnNode.getComponentInChildren(Label);
      if (label) {
        label.string = typeIcons[node.type] || '?';
      }

      const isReachable = this.isReachable(node.id);
      const sprite = btnNode.getComponent(Sprite);
      if (sprite) {
        if (node.completed) {
          sprite.color = new Color(156, 163, 175, 255);
          btnNode.opacity = 200;
        } else if (isReachable) {
          sprite.color = new Color(34, 197, 94, 255);
          tween(btnNode)
            .to(0.5, { scale: new Vec3(1.1, 1.1, 1) })
            .to(0.5, { scale: new Vec3(1.0, 1.0, 1) })
            .union()
            .repeatForever()
            .start();
        } else {
          sprite.color = new Color(209, 213, 219, 255);
          btnNode.opacity = 128;
        }
      }

      const button = btnNode.getComponent(Button);
      if (button) {
        button.interactable = isReachable && !node.completed;
        btnNode['_routeNodeId'] = node.id;
        button.node.on(Button.EventType.CLICK, this.onRouteNodeClicked, this);
      }

      this.nodesContainer.addChild(btnNode);
    }

    this.drawConnections();
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
    if (node) {
      node.completed = true;
      this.renderRoute(this._nodes);
    }
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

  private onRouteNodeClicked(button: Button): void {
    if (!button?.node?.isValid) return;
    const nodeId = button.node['_routeNodeId'] as number;
    if (nodeId === undefined || nodeId === null) return;
    this.onNodeTapped(nodeId);
  }

  onDestroy(): void {
    this._onNodeClickCallback = null;
    this._nodes = [];
    if (this.nodesContainer) {
      this.nodesContainer.removeAllChildren();
    }
  }
}
