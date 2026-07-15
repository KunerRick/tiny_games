# Tiny Vanguard 全量审查修复计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复小小先锋游戏逻辑、UI 显示隐藏时机、布局位置等全部已识别问题（10 个 P0/P1/P2 项）。

**架构：** 纯 TypeScript 代码修改 + Cocos MCP 场景节点调整，不改变游戏架构和状态机设计。

**技术栈：** Cocos Creator 3.8.8 / TypeScript / Cocos MCP (localhost:3000/mcp)

**验证方式：** 每个任务完成后通过 Cocos MCP `debug_validate_scene` 检查场景一致性，修改代码后手动检查逻辑正确性。

---

## 修改文件清单

| 文件 | 职责 |
|------|------|
| `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts` | 主控制器：存档修复、续档修复、completeNode 去重 |
| `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts` | 战斗 UI：敌方回合隐藏技能按钮、WaitButton 修正、位置修正 |
| `assets/games/game_tiny_vanguard/scripts/ui/SaveManager.ts` | 存档：无改动（数据结构已满足需求） |

---

### 任务 1：P0 — 敌方回合隐藏 SkillButtonContainer

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts:621-629`（`updatePhase` 方法）

**问题：** `updatePhase` 中进入敌方回合时只隐藏 `waitButton` 和 `endTurnButton`，`SkillButtonContainer` 仍然可见可点击。

- [ ] **步骤 1：在 `updatePhase` 中隐藏 SkillButtonContainer**

在 `BattleUI.ts` 的 `updatePhase` 方法中，`isEnemyTurn` 判断块中添加隐藏技能按钮容器的逻辑。

```typescript
// 现有代码（约第 622-629 行）：
const isEnemyTurn = phase.includes('\u654C\u65B9');
const isDeploy = phase.includes('\u5E03\u9635');
if (this.waitButton) {
  this.waitButton.node.active = !isEnemyTurn && !isDeploy;
}
if (this.endTurnButton) {
  this.endTurnButton.node.active = !isEnemyTurn && !isDeploy;
}

// 新增：敌方回合和布阵阶段隐藏技能按钮容器
if (this.skillButtonContainer) {
  this.skillButtonContainer.active = !isEnemyTurn && !isDeploy;
}
```

- [ ] **步骤 2：验证修改**

检查以下调用链：
- `startPlayerTurn` → `selectNextPlayerUnit` → `_onUnitPhaseChanged('player_turn')` → `updateBattlePhaseUI` → `updatePhase` → 此时 `isEnemyTurn=false, isDeploy=false`，技能按钮恢复可见 ✅
- `endPlayerTurn` → `_onUnitPhaseChanged('enemy_turn')` → `updateBattlePhaseUI` → `updatePhase` → 此时 `isEnemyTurn=true`，技能按钮隐藏 ✅
- `showDeployPhase` 已通过 `setStatPanelVisible(false)` 隐藏技能按钮，但 `updatePhase` 也会被调用来设置 phaseLabel，所以双重保障 ✅

---

### 任务 2：P0 — 存档系统 unitSkills 写入和恢复

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`
  - `applyUpgrade` 方法（约第 611-640 行）：添加 unitSkills 写入
  - `startBattle` 方法（约第 385-424 行）：添加存档技能恢复
  - `onShopBuySkill` 方法（约第 665-680 行）：添加存档写入
  - `applySingleEffect` 中 `learn_skill`/`learn_rare_skill` 分支（约第 781-792 行）：添加存档写入
  - `onBattleEnd` 胜利分支（约第 501-514 行）：添加存档同步

**问题：** `_runData.unitSkills` 从未在 `applyUpgrade` 等方法中写入，存档中永远是 `{}`。续档后技能丢失。

- [ ] **步骤 1：添加私有方法 `_syncUnitSkillsToRunData`**

在 `TinyVanguardMain.ts` 中添加辅助方法，从 `battleManager.playerUnits` 同步技能到 `_runData.unitSkills`：

```typescript
/** 将当前 playerUnits 的技能列表同步到 _runData.unitSkills */
private _syncUnitSkillsToRunData(): void {
  if (!this.battleManager) return;
  this._runData.unitSkills = {};
  for (let i = 0; i < this.battleManager.playerUnits.length; i++) {
    const unit = this.battleManager.playerUnits[i];
    if (unit.data) {
      this._runData.unitSkills[i] = unit.data.skills.map(s => s.id);
    }
  }
}
```

- [ ] **步骤 2：在 `applyUpgrade` 末尾调用同步**

在 `applyUpgrade` 方法末尾（约第 639 行 `}` 之前）添加：

```typescript
this._syncUnitSkillsToRunData();
```

- [ ] **步骤 3：在 `onShopBuySkill` 末尾添加同步**

在 `onShopBuySkill` 方法末尾（约第 680 行 `}` 之前）添加：

```typescript
this._syncUnitSkillsToRunData();
```

- [ ] **步骤 4：在 `applySingleEffect` 的 `learn_skill`/`learn_rare_skill` 分支末尾添加同步**

在 `applySingleEffect` 方法中，`case 'learn_skill'` 和 `case 'learn_rare_skill'` 的 break 之前添加：

```typescript
this._syncUnitSkillsToRunData();
```

- [ ] **步骤 5：在 `startBattle` 中恢复存档技能**

在 `startBattle` 方法中，`battleManager.startBattle()` 调用之后、设置布阵回调之前，添加技能恢复逻辑：

```typescript
// 恢复存档中的技能
if (Object.keys(this._runData.unitSkills).length > 0) {
  for (let i = 0; i < this.battleManager.playerUnits.length; i++) {
    const skillIds = this._runData.unitSkills[i];
    if (skillIds) {
      for (const skillId of skillIds) {
        const skill = getSkillById(skillId);
        if (skill) {
          this.battleManager.playerUnits[i].addSkill(skill);
        }
      }
    }
  }
}
```

注意：`addSkill` 会自动跳过被动技能的重复应用（通过 `passiveApplied` 检查），但主动技能会追加（最多 3 个）。这保证了续档后技能正确恢复。

- [ ] **步骤 6：在 `onBattleEnd` 胜利分支的 `saveRun` 之前同步技能**

在 `onBattleEnd` 方法中，胜利分支 `SaveManager.saveRun(this._runData)` 之前（约第 507 行），添加：

```typescript
this._syncUnitSkillsToRunData();
```

- [ ] **步骤 7：验证**

- 新游戏流程：`applyUpgrade` 添加技能 → `_syncUnitSkillsToRunData` 写入 → `saveRun` 保存 ✅
- 商店购买技能 → `_syncUnitSkillsToRunData` → `saveRun` ✅
- 续档流程：`onContinueRun` 加载 `_runData` → `startBattle` 恢复技能到单位 ✅
- 存档数据结构 `{ [unitId: string]: string[] }` 已匹配（SaveManager.ts 无需改动）

---

### 任务 3：P0 — 确认 BattleUI 的 Canvas/Camera 组件必要性

**文件：**
- 场景操作（通过 Cocos MCP）
- 代码：`assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

**问题：** BattleUI 节点上有 cc.Canvas 和 cc.Camera 组件，与主 Canvas 形成双 Canvas 架构。需要确认这是否是刻意的分层设计。

- [ ] **步骤 1：通过 MCP 检查 BattleUI 上 Canvas 和 Camera 的详细配置**

调用 `component_get_component_info` 查看 BattleUI 上 cc.Canvas 和 cc.Camera 的属性（clearFlags、visibility 等）。

- [ ] **步骤 2：根据结果决定**

- 如果 Canvas 的 clearFlags 是 `DEPTH_ONLY` 且 Camera visibility 设置为与主 Camera 不同层 → **保留**（刻意分层）
- 如果 Canvas 的 clearFlags 是 `SOLID_COLOR` 且 Camera 与主 Camera 完全重叠 → **移除多余组件**

鉴于场景 `debug_validate_scene` 返回 valid=true 且无问题，且这可能是为了让 BattleUI 的 VictoryPanel/DefeatPanel 全屏遮罩能覆盖在棋盘之上，**暂时保留此架构**，在计划中标记为"已审查、暂不修改"。

---

### 任务 4：P1 — 胜利面板 VictoryPanel ContinueBtn 动态创建清理

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts:522-571`（`showVictory` 方法）

**问题：** `showVictory` 每次调用时检查是否存在 `ContinueBtn`，不存在则动态创建。该节点从不被清理，多次调用（理论上不会）会累积。

- [ ] **步骤 1：将 ContinueBtn 和 GoldLabel 的创建逻辑移到 onLoad**

在 `BattleUI.ts` 的 `onLoad` 方法末尾（约第 141 行 `}` 之前），添加预创建逻辑：

```typescript
// 预创建胜利面板的 ContinueBtn 和 GoldLabel（避免每次 showVictory 动态创建）
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
    goldLabel.setPosition(0, -20, 0);
    this.victoryPanel.addChild(goldLabel);
  }
}
```

- [ ] **步骤 2：简化 `showVictory` 方法**

将 `showVictory` 中创建 ContinueBtn 和 GoldLabel 的逻辑替换为简单的属性更新：

```typescript
showVictory(gold: number): void {
  if (this.victoryPanel) {
    this.ensurePanelOnTop(this.victoryPanel);
    this.victoryPanel.active = true;
  }
  if (this.endTurnButton) {
    this.endTurnButton.node.active = false;
  }
  if (this.waitButton) {
    this.waitButton.node.active = false;
  }

  // 更新金币显示
  const goldLabel = this.victoryPanel?.getChildByName('GoldLabel');
  const glComp = goldLabel?.getComponent(Label);
  if (glComp) {
    glComp.string = `\uD83D\uDCB0 +${gold}`;
  }

  // 绑定继续按钮事件（每次显示时重新绑定，确保 context 正确）
  const continueBtn = this.victoryPanel?.getChildByName('ContinueBtn');
  if (continueBtn) {
    const btn = continueBtn.getComponent(Button);
    if (btn) {
      btn.node.off(Button.EventType.CLICK, this.onVictoryContinueClicked, this);
      btn.node.on(Button.EventType.CLICK, this.onVictoryContinueClicked, this);
    }
  }
}
```

- [ ] **步骤 3：验证**

- `onLoad` 创建 ContinueBtn 和 GoldLabel（仅一次） ✅
- `showVictory` 只更新文字和重新绑定事件 ✅
- `onVictoryContinueClicked` → `_onContinueVictory` → `onVictoryContinue` ✅

---

### 任务 5：P1 — 续档后恢复路线图已完成节点

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts:317-354`（`startNewRun` 方法）

**问题：** `startNewRun` 每次调用都 `generateRoute()` 生成全新路线，所有节点 `completed=false`。续档后已完成的节点显示为未完成。

- [ ] **步骤 1：在 `startNewRun` 中判断是否为续档，恢复节点完成状态**

在 `startNewRun` 方法中，`routeMapUI.renderRoute(nodes)` 之后添加恢复逻辑：

```typescript
if (this.routeMapUI) {
  this.routeMapUI.show();
  const nodes = this.routeMapUI.generateRoute();
  this.routeMapUI.renderRoute(nodes);
  this.routeMapUI.setNodeClickCallback((nodeId) => this.onNodeSelected(nodeId));

  // 续档恢复：标记已完成的节点
  // _battleCount 被重置为 0，但存档中可通过 _runData.currentRouteNode 推算
  // currentRouteNode 表示当前正在进行的节点 ID，之前 ID 小于等于它的战斗节点应标记完成
  // 更可靠的方式：遍历所有节点，通过 connections 判断哪些应在 currentRouteNode 之前
  // 简化方案：节点 ID < currentRouteNode 的直接标记完成（因为固定路线是线性的）
  const currentNodeId = this._runData.currentRouteNode;
  if (currentNodeId > 0) {
    // 还原 battleCount：已完成的战斗节点数
    this._battleCount = nodes.filter(n =>
      n.id < currentNodeId && (n.type === 'battle' || n.type === 'elite' || n.type === 'boss')
    ).length;
    // 标记已通过的节点
    for (const node of nodes) {
      if (node.id < currentNodeId) {
        this.routeMapUI.completeNode(node.id);
      }
    }
  }
}
```

- [ ] **步骤 2：修改 `onBattleEnd` 胜利分支，更新 currentRouteNode**

在 `onBattleEnd` 胜利分支中，`this._battleCount++` 之前添加：

```typescript
if (this._currentNode) {
  this._runData.currentRouteNode = this._currentNode.id;
}
```

注意：这里 `completeNode` 已被调用（第 504 行），存档在 507 行保存，currentRouteNode 需要在保存前更新。

- [ ] **步骤 3：修改 `completeNonBattleNode`，更新 currentRouteNode**

在 `completeNonBattleNode` 方法中，`SaveManager.saveRun` 之前添加：

```typescript
if (this._currentNode) {
  this._runData.currentRouteNode = this._currentNode.id;
}
```

- [ ] **步骤 4：移除 `onVictoryContinue` 中的重复 `completeNode`**

`onVictoryContinue` 第 532 行 `this.routeMapUI?.completeNode(this._currentNode?.id ?? 0)` 是冗余的（`onBattleEnd` 第 504 行已调用）。删除这行：

```typescript
// 删除这行：
// this.routeMapUI?.completeNode(this._currentNode?.id ?? 0);
```

- [ ] **步骤 5：验证**

- 新游戏：`currentRouteNode=0`，不触发恢复 ✅
- 胜利战斗后：`currentRouteNode` 更新为当前节点 ID，`saveRun` 保存 ✅
- 商店/休息/事件后：`currentRouteNode` 更新，`saveRun` 保存 ✅
- 续档：`currentRouteNode > 0`，恢复已完成节点，恢复 `_battleCount` ✅

---

### 任务 6：P1 — WaitButton 位置和文字修正

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts:83-98`（`onLoad` 中位置设置）和 `122-128`（WaitButton 文字）

**问题：**
1. `WaitButton` 和 `EndTurnButton` 代码位置 `(175,-280)` / `(290,-280)` 在屏幕底部，紧挨右边缘
2. `WaitButton` 文字被改为"结束行动"，与 `EndTurnButton`（"结束回合"）语义重复
3. `WaitButton` 编辑器尺寸 100x100 被代码覆盖为 100x60

- [ ] **步骤 1：修正 WaitButton 文字和位置**

将 `onLoad` 中的 WaitButton 设置改为：

```typescript
if (this.waitButton) {
  const wtTransform = this.waitButton.node.getComponent(UITransform);
  if (wtTransform) {
    wtTransform.setContentSize(100, 60);
  }
  this.waitButton.node.setPosition(175, -280);
}
```

（位置保持不变 `(175, -280)`，与 EndTurnButton `(290, -280)` 形成间距 15px 的并排布局）

将 WaitButton 文字改回原意：

```typescript
// waitButton 文字
if (this.waitButton) {
  const wtLabel = this.waitButton.node.getComponentInChildren(Label);
  if (wtLabel) {
    wtLabel.string = '\u7B49\u5F85';  // "等待"
  }
}
```

- [ ] **步骤 2：验证**

- WaitButton 文字为"等待"，EndTurnButton 文字为"结束回合"（编辑器中设置），语义不重复 ✅
- 两按钮在屏幕底部右侧并排，间距合理 ✅

---

### 任务 7：P1 — StartBtn 超出 ClassSelectPanel 边界

**文件：**
- 场景操作（通过 Cocos MCP）

**问题：** ClassSelectPanel 尺寸 280x220，StartBtn 位于 y=-130（从中心计算），按钮高度 40，底边在 y=-150，Panel 底边在 y=-110。按钮超出 Panel 约 40px。

- [ ] **步骤 1：通过 MCP 扩大 ClassSelectPanel 的 UITransform 高度**

调用 `component_set_component_property` 将 ClassSelectPanel 的 `contentSize.height` 从 220 改为 300：

```json
{
  "name": "component_set_component_property",
  "arguments": {
    "nodeUuid": "5bYhAYtt9J3ZxJBTFkrj9p",
    "componentType": "cc.UITransform",
    "propertyName": "contentSize",
    "propertyValue": {"width": 280, "height": 300}
  }
}
```

- [ ] **步骤 2：验证**

- ClassSelectPanel 新尺寸 280x300，底边在 y=-150，StartBtn 底边 y=-150，恰好包容 ✅
- 调用 `debug_validate_scene` 确认无问题 ✅

---

### 任务 8：P2 — SkillButtonContainer 位置调整

**文件：**
- 场景操作（通过 Cocos MCP）

**问题：** SkillButtonContainer 编辑器位置 (250, -450)，尺寸 300x80。代码中 `showSkillButtons` 动态布局按钮在容器内水平居中排列。由于容器偏右下方，技能按钮可能溢出屏幕（设计分辨率 750x1334，有效 UI 区域约 360x640）。

- [ ] **步骤 1：通过 MCP 调整 SkillButtonContainer 位置**

将 SkillButtonContainer 从 (250, -450) 移到 (0, -350)，使其水平居中、垂直位置在棋盘下方但不过低：

```json
{
  "name": "node_set_node_transform",
  "arguments": {
    "uuid": "0dyc99P9dNF6685Wx7t/Th",
    "position": {"x": 0, "y": -350, "z": 0}
  }
}
```

- [ ] **步骤 2：验证**

- SkillButtonContainer 新位置 (0, -350)，技能按钮水平居中 ✅
- 与 WaitButton (175, -280) 和 EndTurnButton (290, -280) 不重叠 ✅

---

### 任务 9：P2 — DefeatPanel 中 ScoreLabel 未使用

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts:573-597`（`showDefeat` 方法）

**问题：** 编辑器中 DefeatPanel 有 DefeatLabel 和 ScoreLabel，代码只设置了 DefeatLabel 内容为"失 败"，ScoreLabel 未使用。

- [ ] **步骤 1：利用 ScoreLabel 显示击败信息**

在 `showDefeat` 方法中，添加 ScoreLabel 的更新逻辑：

```typescript
showDefeat(): void {
  if (this.defeatPanel) {
    this.ensurePanelOnTop(this.defeatPanel);
    this.defeatPanel.active = true;

    const resultLabel = this.defeatPanel.getComponentInChildren(Label);
    if (resultLabel) {
      resultLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      resultLabel.verticalAlign = Label.VerticalAlign.CENTER;
      resultLabel.string = '\u5931 \u8D25';
      resultLabel.color = new Color(255, 80, 80);
    }
  }
  if (this.endTurnButton) {
    this.endTurnButton.node.active = false;
  }
  if (this.waitButton) {
    this.waitButton.node.active = false;
  }
  if (this.skillButtonContainer) {
    this.skillButtonContainer.active = false;
  }
}
```

（ScoreLabel 在编辑器中已存在，但当前代码没有引用它的 `@property`。由于 `showDefeat` 已通过 `getComponentInChildren(Label)` 获取 Label，如果有多个 Label 可能不准确。**暂时不修改**，因为不影响功能，只是冗余节点。）

→ **标记为"已审查、暂不修改"**

---

### 任务 10：P2 — GoldLabel 与 TurnLabel y 坐标对齐

**文件：**
- 场景操作（通过 Cocos MCP）

**问题：** GoldLabel (310, 500) 和 TurnLabel (0, 500) 在同一 y 坐标。当两者同时显示时（战斗阶段），布局上在同一行但各自水平位置不同，视觉上不冲突但可能显得散乱。

- [ ] **步骤 1：通过 MCP 调整 GoldLabel 位置**

将 GoldLabel 从 (310, 500) 移到 (310, 520)，使其略高于 TurnLabel，形成上下层次：

```json
{
  "name": "node_set_node_transform",
  "arguments": {
    "uuid": "b7RPYkZstMB4if7Vou1JBm",
    "position": {"x": 310, "y": 520, "z": 0}
  }
}
```

- [ ] **步骤 2：验证**

- GoldLabel (310, 520) 在右上角偏上，TurnLabel (0, 500) 在顶部中间 ✅
- 两者不重叠 ✅

---

### 任务 11：通过 Cocos MCP 验证场景一致性

**文件：** 无代码修改，仅 MCP 查询

- [ ] **步骤 1：调用 `debug_validate_scene` 验证所有场景修改后一致性**

- [ ] **步骤 2：通过 `scene_get_scene_hierarchy` 确认所有位置修改已生效**

- [ ] **步骤 3：调用 `scene_save_scene` 保存修改**

---

## 执行顺序

```
任务 1 (P0 代码) → 任务 2 (P0 代码) → 任务 3 (P0 验证) → 任务 4 (P1 代码) → 任务 5 (P1 代码) → 任务 6 (P1 代码) → 任务 7 (P1 MCP) → 任务 8 (P2 MCP) → 任务 9 (P2 跳过) → 任务 10 (P2 MCP) → 任务 11 (最终验证)
```

代码修改可并行执行，MCP 操作需串行（同一场景）。
