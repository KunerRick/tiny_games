# Tiny Vanguard 体验优化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 优化小小先锋的战斗交互体验和路线图视觉效果

**架构：** 纯 TypeScript 代码修改（BattleManager/GridController/RouteMapUI/BattleUI）+ Cocos MCP 场景操作（新增节点/调整布局）。不改变状态机设计。

**技术栈：** Cocos Creator 3.8.8 / TypeScript / Cocos MCP (localhost:3000/mcp, POST JSON-RPC)

**重要约束：**
- 所有场景节点操作必须通过 Cocos MCP 完成，禁止直接编辑 .scene 文件
- MCP 工具调用方式：POST `http://localhost:3000/mcp`，JSON-RPC 2.0，`method: "tools/call"`，`params: { name: "工具名", arguments: {...} }`
- 结构性变更前调用 `begin_undo_recording`，操作后 `end_undo_recording`
- 每个任务完成后调用 `debug_validate_scene` 验证

---

## 修改文件清单

| 文件 | 职责 | 变更类型 |
|------|------|----------|
| `scripts/battle/BattleManager.ts` | 移动预览、phase 守卫、移动动画 | 修改 |
| `scripts/battle/GridController.ts` | 预览高亮、连接线绘制（无） | 修改 |
| `scripts/battle/UnitController.ts` | 已有 `moveToPositionAnimated`，无需修改 | 无 |
| `scripts/ui/BattleUI.ts` | 操作栏分离样式 | 修改 |
| `scripts/ui/RouteMapUI.ts` | 节点视觉区分、连接线、防重复点击 | 修改 |
| TinyVanguard.scene | 新增 ActionBar 节点、connectionsLayer 节点 | MCP 操作 |

---

### 任务 1：P0 — finishUnitTurn 添加 phase 守卫

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts:525-535`

**问题：** 技能击杀最后一个敌人后，`checkBattleEnd()` 将 phase 设为 'victory'，但 `finishUnitTurn` 仍继续执行 `selectNextPlayerUnit`，导致玩家仍可操作已结束的战斗。

- [ ] **步骤 1：在 finishUnitTurn 开头添加 phase 守卫**

在 `finishUnitTurn()` 方法体开头（第 525 行 `private finishUnitTurn(): void {` 之后）添加：

```typescript
private finishUnitTurn(): void {
  // 战斗已结束（胜利/失败），停止所有玩家回合流转
  if (this._phase !== 'player_turn') return;

  if (this._selectedUnit) {
    this._selectedUnit.setSelected(false);
    this._selectedUnit = null;
  }
  // ... 后续原有逻辑不变
```

- [ ] **步骤 2：验证覆盖范围**

确认以下调用链在 phase 变为 'victory'/'defeat' 后均被阻断：
- `handleSkillTargetClick` → `finishUnitTurn()` → phase !== 'player_turn' → return ✅
- `executeAttack`（self skill）→ `finishUnitTurn()` → phase !== 'player_turn' → return ✅
- `waitCurrentUnit` → `finishUnitTurn()` → phase !== 'player_turn' → return ✅
- `endCurrentUnitTurn` → `finishUnitTurn()` → phase !== 'player_turn' → return ✅

---

### 任务 2：P0 — 移动阶段交互优化（二次确认 + 动画）

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`
- 修改：`assets/games/game_tiny_vanguard/scripts/battle/GridController.ts`

**问题：** 点击可移动区域直接瞬移，无确认步骤和动画效果。点击友方单位在 move 阶段也会切换选中。

- [ ] **步骤 1：在 BattleManager 中添加移动预览状态**

在 BattleManager 类的成员变量区域（约第 30-50 行之间）添加：

```typescript
private _movePreviewPos: GridPosition | null = null;
```

- [ ] **步骤 2：在 GridController 中添加预览高亮方法**

在 `GridController.ts` 中添加方法，用于显示/清除移动预览（黄色虚框效果）：

```typescript
/** 高亮单个格子为移动预览（黄色半透明） */
highlightPreviewCell(pos: GridPosition): void {
  this.clearPreview();
  const cell = this.getCell(pos.row, pos.col);
  if (cell) {
    const sprite = cell.getComponent(Sprite);
    if (sprite) {
      sprite.color = new Color(255, 235, 59, 200); // 黄色预览
    }
    this._previewCell = cell;
  }
}

/** 清除预览高亮 */
clearPreview(): void {
  if (this._previewCell?.isValid) {
    const sprite = this._previewCell.getComponent(Sprite);
    if (sprite) {
      sprite.color = GridController.DEFAULT_CELL_COLOR;
    }
  }
  this._previewCell = null;
}
```

同时在成员变量区域添加：

```typescript
private _previewCell: Node | null = null;
```

在 `clearHighlights()` 方法末尾添加 `this.clearPreview();` 调用。

- [ ] **步骤 3：重写 onCellClicked 中的 move 阶段逻辑**

将 `onCellClicked` 方法中 move 阶段的逻辑（约第 556-573 行）修改为：

```typescript
onCellClicked(gridPos: GridPosition): void {
  if (this._phase === 'skill_target') {
    this.handleSkillTargetClick(gridPos);
    return;
  }
  if (this._phase !== 'player_turn') return;
  const unit = this._selectedUnit;
  if (!unit?.data?.isAlive) return;

  // move 阶段：不允许通过点击友方单位切换选中
  if (this._unitPhase === 'move') {
    // 点击自己：原地不动，进入行动阶段（清除预览）
    if (unit.data.gridPos.row === gridPos.row && unit.data.gridPos.col === gridPos.col) {
      this.gridController.clearPreview();
      this._movePreviewPos = null;
      unit.data.hasMoved = true;
      this._unitPhase = 'action';
      this.highlightAttackRange(unit);
      if (this._onUnitPhaseChanged) {
        this._onUnitPhaseChanged('player_turn', unit, 'action');
      }
      this._checkAutoSkipIfNoTargets(unit);
      return;
    }

    // 检查是否在可移动范围内
    const moves = this.getReachablePositions(unit.data.gridPos, unit.data.stats.move);
    const canMove = moves.some(m => m.row === gridPos.row && m.col === gridPos.col);

    if (!canMove) {
      // 点击无效区域：完全无反应（不清除高亮、不做任何操作）
      return;
    }

    // 如果已有预览且点击的是同一位置 → 确认移动
    if (this._movePreviewPos &&
        this._movePreviewPos.row === gridPos.row &&
        this._movePreviewPos.col === gridPos.col) {
      this._movePreviewPos = null;
      this.gridController.clearPreview();
      // 使用动画移动
      unit.moveToPositionAnimated(gridPos, 0.25, () => {
        if (!unit.data || this._phase !== 'player_turn') return;
        this._unitPhase = 'action';
        this.highlightAttackRange(unit);
        if (this._onUnitPhaseChanged) {
          this._onUnitPhaseChanged('player_turn', unit, 'action');
        }
        this._checkAutoSkipIfNoTargets(unit);
      });
      // 移动开始后清除移动高亮
      this.gridController.clearHighlights();
      return;
    }

    // 第一次点击可移动格：设置预览
    this._movePreviewPos = { ...gridPos };
    this.gridController.highlightPreviewCell(gridPos);
    return;
  }

  // action 阶段：允许切换选中友方单位（保留原有逻辑）
  const clickedPlayer = this._playerUnits.find(u =>
    u.data?.isAlive && u.data.gridPos.row === gridPos.row && u.data.gridPos.col === gridPos.col
  );
  if (clickedPlayer && clickedPlayer !== unit && !clickedPlayer.data.hasActed) {
    this._currentUnitIndex = this._playerUnits.indexOf(clickedPlayer);
    this.selectNextPlayerUnit();
    return;
  }

  if (this._unitPhase === 'action') {
    if (unit.data.gridPos.row === gridPos.row && unit.data.gridPos.col === gridPos.col) {
      return;
    }
    this.handleActionPhase(unit, gridPos);
  }
}
```

注意：原有的 `handleMovePhase` 方法可以保留不删（其他地方可能引用），但不再从 `onCellClicked` 调用。

- [ ] **步骤 4：在 selectNextPlayerUnit 中清除预览状态**

在 `selectNextPlayerUnit()` 方法开头添加：

```typescript
this._movePreviewPos = null;
this.gridController.clearPreview();
```

---

### 任务 3：P1 — BattleUI 操作栏与技能按钮视觉分离

**文件：**
- 场景操作（Cocos MCP）：创建 ActionBar 节点
- 修改：`assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

**问题：** 技能按钮和等待/结束按钮混排，视觉无区分。

- [ ] **步骤 1：通过 Cocos MCP 创建 ActionBar 节点**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "node_create_node",
    "arguments": {
      "parentUuid": "1eYZEXH19G8JbQn3RPr7xQ",
      "name": "ActionBar"
    }
  }
}
```

- [ ] **步骤 2：通过 MCP 给 ActionBar 添加 UITransform 和 Sprite（作为背景）**

```json
// 设置 UITransform
{
  "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": {
    "name": "component_add_component",
    "arguments": {
      "nodeUuid": "<ActionBar_UUID>",
      "componentType": "cc.UITransform",
      "propertyValues": { "contentSize": { "width": 300, "height": 50 } }
    }
  }
}
// 添加 Sprite 作为深色背景
{
  "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": {
    "name": "component_add_component",
    "arguments": {
      "nodeUuid": "<ActionBar_UUID>",
      "componentType": "cc.Sprite",
      "propertyValues": { "color": { "r": 30, "g": 30, "b": 40, "a": 220 }, "sizeMode": "CUSTOM" }
    }
  }
}
// 设置位置
{
  "jsonrpc": "2.0", "id": 4, "method": "tools/call",
  "params": {
    "name": "node_set_node_transform",
    "arguments": {
      "uuid": "<ActionBar_UUID>",
      "position": { "x": 30, "y": -420, "z": 0 }
    }
  }
}
```

- [ ] **步骤 3：通过 MCP 将 WaitButton 和 EndTurnButton 移到 ActionBar 下**

获取 WaitButton UUID (`79A1s/Sq9JKbvPIYdjqxUc`) 和 EndTurnButton UUID (`ac5I7PYt5HNarxW55j5tgJ`)，通过 `node_set_parent` 将它们移到 ActionBar 节点下。

- [ ] **步骤 4：通过 MCP 保存场景并验证**

调用 `debug_validate_scene` + `scene_save_scene`。

- [ ] **步骤 5：更新 BattleUI.ts 中的位置引用**

由于 WaitButton 和 EndTurnButton 现在是 ActionBar 的子节点，它们的 position 变为相对于 ActionBar 的局部坐标。需要在 `BattleUI.ts` 的 `onLoad` 中调整：

```typescript
// 操作栏按钮相对于 ActionBar 的位置
if (this.waitButton) {
  this.waitButton.node.setPosition(-70, 0);
}
if (this.endTurnButton) {
  this.endTurnButton.node.setPosition(70, 0);
}
```

注意：需要在 BattleUI 中添加 ActionBar 的 `@property` 引用（通过 MCP 绑定），或者直接在 onLoad 中通过 `find` 查找。更简单的方式是**不修改代码中的位置设置**，让 MCP 操作的坐标生效。

---

### 任务 4：P1 — RouteMapUI 节点视觉区分

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/ui/RouteMapUI.ts`
- 场景操作（Cocos MCP）：添加 connectionsLayer Graphics 节点

**问题：** 已完成/可达/不可达节点视觉无区分；节点间无连接线；已完成节点可重复点击。

- [ ] **步骤 1：在 RouteMapUI 中添加连接线绘制方法**

在 `RouteMapUI.ts` 中添加 `import { Graphics } from 'cc';`，然后添加 `@property` 和方法：

```typescript
@property({ type: Node, tooltip: '连接线图层' })
connectionsLayer: Node = null;

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

      // 颜色：已完成的路径灰色，可达路径绿色，其他浅灰
      const bothDone = node.completed && target.completed;
      const reachToTarget = node.completed && this.isReachable(targetId);
      let lineColor: Color;
      if (bothDone) {
        lineColor = new Color(156, 163, 175, 200); // 灰色
      } else if (reachToTarget) {
        lineColor = new Color(34, 197, 94, 220); // 绿色
      } else {
        lineColor = new Color(209, 213, 219, 150); // 浅灰
      }

      graphics.strokeColor = lineColor;
      graphics.lineWidth = 3;
      graphics.moveTo(x1, y1);
      // 简单直线连接
      graphics.lineTo(x2, y2);
      graphics.stroke();

      // 在终点画一个小箭头
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const arrowLen = 8;
      const arrowX = x2 - arrowLen * Math.cos(angle - 0.4);
      const arrowY = y2 - arrowLen * Math.sin(angle - 0.4);
      const arrowX2 = x2 - arrowLen * Math.cos(angle + 0.4);
      const arrowY2 = y2 - arrowLen * Math.sin(angle + 0.4);
      graphics.moveTo(x2, y2);
      graphics.lineTo(arrowX, arrowY);
      graphics.moveTo(x2, y2);
      graphics.lineTo(arrowX2, arrowY2);
      graphics.stroke();
    }
  }
}
```

- [ ] **步骤 2：修改 renderRoute 添加视觉区分**

在 `renderRoute` 方法中，创建节点后根据状态设置不同样式：

```typescript
renderRoute(nodes: RouteNode[]): void {
  this._nodes = nodes;
  if (!this.nodesContainer) return;

  this.nodesContainer.removeAllChildren();
  const typeIcons: Record<string, string> = {
    battle: '⚔️', elite: '🔥', shop: '🏗️',
    rest: '😴', event: '🧪', boss: '🏆'
  };

  for (const node of nodes) {
    const btnNode = instantiate(this.nodePrefab);
    btnNode.name = `Node_${node.id}`;
    btnNode.setPosition(node.col * 130 + 80, -node.row * 110 - 60);

    const label = btnNode.getComponentInChildren(Label);
    if (label) {
      label.string = typeIcons[node.type] || '?';
    }

    // 视觉区分：已完成、可达、不可达
    const sprite = btnNode.getComponent(Sprite);
    const isReachable = this.isReachable(node.id);
    if (sprite) {
      if (node.completed) {
        sprite.color = new Color(156, 163, 175, 255); // 灰色
        btnNode.opacity = 200;
      } else if (isReachable) {
        sprite.color = new Color(34, 197, 94, 255); // 绿色
        // 脉冲动画
        tween(btnNode)
          .to(0.5, { scale: new Vec3(1.1, 1.1, 1) })
          .to(0.5, { scale: new Vec3(1.0, 1.0, 1) })
          .union()
          .repeatForever()
          .start();
      } else {
        sprite.color = new Color(209, 213, 219, 255); // 浅灰
        btnNode.opacity = 128; // 半透明
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

  // 绘制连接线
  this.drawConnections();
}
```

注意：需要在文件顶部添加 `import { Vec3, tween } from 'cc';`。

- [ ] **步骤 3：修改 onNodeTapped 防止重复点击**

```typescript
private onNodeTapped(nodeId: number): void {
  if (!this.isReachable(nodeId)) return;
  // 防止重复点击已完成节点
  const node = this._nodes.find(n => n.id === nodeId);
  if (node?.completed) return;
  this._currentNodeId = nodeId;
  if (this._onNodeClickCallback) {
    this._onNodeClickCallback(nodeId);
  }
}
```

- [ ] **步骤 4：修改 completeNode 刷新视觉**

```typescript
completeNode(nodeId: number): void {
  const node = this._nodes.find(n => n.id === nodeId);
  if (node) {
    node.completed = true;
    // 重新渲染以更新视觉状态
    this.renderRoute(this._nodes);
  }
}
```

- [ ] **步骤 5：通过 Cocos MCP 创建 connectionsLayer 节点**

```json
{
  "jsonrpc": "2.0", "id": 10, "method": "tools/call",
  "params": {
    "name": "node_create_node",
    "arguments": {
      "parentUuid": "42FTfmHP5IW5sx1zGD7YCA",
      "name": "ConnectionsLayer"
    }
  }
}
```

然后添加 Graphics 组件和 UITransform（宽度 750，高度 1334），设 z-index 使其在节点下层。

- [ ] **步骤 6：通过 MCP 将 ConnectionsLayer 绑定到 RouteMapUI 的 connectionsLayer 属性**

使用 `component_set_component_property` 将创建的节点 UUID 设置到 RouteMapUI 脚本的 `connectionsLayer` 属性。

---

### 任务 5：P2 — GridController clearHighlights 联动 clearPreview

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/battle/GridController.ts:105-115`

- [ ] **步骤 1：在 clearHighlights 末尾添加 clearPreview 调用**

```typescript
clearHighlights(): void {
  for (const cell of this._highlightedCells) {
    if (cell?.isValid) {
      const sprite = cell.getComponent(Sprite);
      if (sprite) {
        sprite.color = GridController.DEFAULT_CELL_COLOR;
      }
    }
  }
  this._highlightedCells = [];
  this.clearPreview();
}
```

---

### 任务 6：最终验证

- [ ] **步骤 1：调用 debug_validate_scene 验证所有场景修改**

- [ ] **步骤 2：调用 scene_save_scene 保存**

- [ ] **步骤 3：手动检查代码一致性**

确认：
- `finishUnitTurn` phase 守卫正确阻断所有路径
- 移动预览逻辑：无效区域无反应、二次确认、动画移动
- RouteMapUI 的 `import { Vec3, tween, Graphics }` 正确
- ActionBar 节点在场景中正确创建且按钮已移入

---

## 执行顺序

```
任务 1 (P0 phase守卫) → 任务 2 (P0 移动交互) → 任务 5 (P2 GridController) → 任务 3 (P1 操作栏) → 任务 4 (P1 路线图) → 任务 6 (最终验证)
```

任务 1/2/5 是纯代码修改，可连续执行。任务 3 和 4 涉及 MCP 场景操作，需要串行。
