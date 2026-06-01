import { _decorator, Component, Node, ScrollView, instantiate, Prefab, Button, Label, Color, Sprite, UITransform } from 'cc';
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

      const button = btnNode.getComponent(Button);
      if (button) {
        button.interactable = this.isReachable(node.id);
        btnNode['_routeNodeId'] = node.id;
        button.node.on(Button.EventType.CLICK, this.onRouteNodeClicked, this);
      }

      this.nodesContainer.addChild(btnNode);
    }
  }

  private isReachable(nodeId: number): boolean {
    if (nodeId === 0) return true;
    const node = this._nodes.find(n => n.id === nodeId);
    if (!node) return false;
    return node.connections.some(connId => {
      const conn = this._nodes.find(n => n.id === connId);
      return conn && conn.completed;
    });
  }

  private onNodeTapped(nodeId: number): void {
    if (!this.isReachable(nodeId)) return;
    this._currentNodeId = nodeId;
    if (this._onNodeClickCallback) {
      this._onNodeClickCallback(nodeId);
    }
  }

  completeNode(nodeId: number): void {
    const node = this._nodes.find(n => n.id === nodeId);
    if (node) node.completed = true;
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
    const nodeId = button.node['_routeNodeId'] as number;
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
