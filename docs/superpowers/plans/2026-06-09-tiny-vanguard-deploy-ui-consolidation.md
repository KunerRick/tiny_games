# Tiny Vanguard 布阵界面去重实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 消除布阵界面信息重复——去掉底部 `deployCardContainer`，将交互迁移到棋盘左侧的兵牌卡片。

**架构：** BattleUI 替代 `showDeployUnitList()` 为 `setupPlatoonCards()`，在棋盘左侧竖排创建卡片；BattleManager 在布阵阶段隐藏棋盘外的单位实体（`col=-1`），防止左侧出现重复的"三个方框"。

**技术栈：** Cocos Creator 3.8.8 + TypeScript

---

## 文件结构

| 文件 | 角色 | 改动 |
|------|------|------|
| `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts` | 布阵 UI 管理 | 去掉 `deployCardContainer`，新增 `setupPlatoonCards()`（左侧兵牌），保留三态方法 |
| `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts` | 战斗核心逻辑 | 布阵阶段隐藏 `col=-1` 的单位节点；放置/撤回时控制显隐 |
| `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts` | 主控制器 | 替换 `showDeployUnitList` 调用为 `setupPlatoonCards` |

---

### 任务 1：BattleUI.ts — 去掉底部卡片容器，新增左侧兵牌方法

**文件：** 修改 `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

**说明：** 此任务完成两个核心变更：(a) 移除旧的 `deployCardContainer` 创建逻辑和属性；(b) 新增 `setupPlatoonCards()` 方法，在棋盘左侧竖排创建兵牌。

- [ ] **步骤 1：移除 `deployCardContainer` 属性声明**

删除第 60-61 行：

```typescript
@property({ type: Node, tooltip: '布阵卡片容器' })
deployCardContainer: Node = null;
```

- [ ] **步骤 2：移除 `onLoad()` 中创建 `DeployCardContainer` 的代码**

删除第 90-97 行（从 `if (!this.deployCardContainer)` 到 `this.deployCardContainer.active = false;` 的整个块）：

```typescript
// 删除以下整个块
if (!this.deployCardContainer) {
    this.deployCardContainer = new Node('DeployCardContainer');
    const containerTransform = this.deployCardContainer.addComponent(UITransform);
    containerTransform.setContentSize(400, 80);
    this.deployCardContainer.setPosition(0, -280, 0);
    this.node.addChild(this.deployCardContainer);
}
this.deployCardContainer.active = false;
```

- [ ] **步骤 3：移除 `showDeployPhase()` 中对 `deployCardContainer` 的引用**

修改第 210-227 行的 `showDeployPhase()`，删除两处引用：

```typescript
showDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = true;
    if (this.confirmDeployButton) this.confirmDeployButton.node.active = true;
    if (this.waitButton) this.waitButton.node.active = false;
    if (this.endTurnButton) this.endTurnButton.node.active = false;
    // 设置顶部阶段标签，清空其余文本
    if (this.phaseLabel) this.phaseLabel.string = '\u5E03\u9635\u9636\u6BB5';
    if (this.unitNameLabel) this.unitNameLabel.string = '';
    if (this.hpLabel) this.hpLabel.string = '';
    if (this.energyLabel) this.energyLabel.string = '';
    if (this.turnLabel) this.turnLabel.string = '';
    if (this.unitTurnLabel) this.unitTurnLabel.string = '';
    if (this.actionHintLabel) this.actionHintLabel.string = '';
    if (this.deployUnitList) this.deployUnitList.active = false;
}
```

关键删除：`if (this.deployCardContainer) { this.deployCardContainer.active = true; }`

- [ ] **步骤 4：移除 `hideDeployPhase()` 中对 `deployCardContainer` 的引用**

修改第 229-237 行：

```typescript
hideDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = false;
    if (this.confirmDeployButton) this.confirmDeployButton.node.active = false;
    if (this.waitButton) this.waitButton.node.active = true;
    if (this.deployUnitList) this.deployUnitList.active = false;
}
```

关键删除：`if (this.deployCardContainer) { this.deployCardContainer.active = false; }`

- [ ] **步骤 5：将 `showDeployUnitList()` 重命名为 `setupPlatoonCards()`，改为左侧竖排布局**

将第 252-329 行的 `showDeployUnitList` 方法替换为以下内容：

```typescript
setupPlatoonCards(
    unitNames: string[],
    unitIcons: string[],
    callback: (index: number) => void
): void {
    // 清除旧的兵牌
    for (const card of this._deployCards) {
        if (card?.isValid) {
            card.removeFromParent();
        }
    }
    this._deployCards = [];

    const cardWidth = 120;
    const cardHeight = 70;
    const gap = 10;
    const count = unitNames.length;
    // 竖排居中：总高度 = count * cardHeight + (count-1) * gap
    const totalHeight = count * cardHeight + (count - 1) * gap;
    const startY = totalHeight / 2 - cardHeight / 2;

    for (let i = 0; i < count; i++) {
        const card = new Node(`PlatoonCard_${i}`);
        // 棋盘左边缘 x=-200，兵牌放在 x=-380 (左侧 180px)
        // y 方向居中偏下，布阵时棋盘中心在 (0,0)
        card.setPosition(-380, startY - i * (cardHeight + gap), 0);

        // 背景
        const bg = card.addComponent(Sprite);
        bg.color = new Color(60, 60, 80, 200);
        bg.sizeMode = Sprite.SizeMode.CUSTOM;
        const bgTransform = card.addComponent(UITransform);
        bgTransform.setContentSize(cardWidth, cardHeight);

        // 图标 (文字 emoji，放在上半部分)
        const iconNode = new Node('IconLabel');
        const iconLabel = iconNode.addComponent(Label);
        iconLabel.string = unitIcons[i] || '';
        iconLabel.fontSize = 24;
        iconLabel.color = Color.WHITE;
        iconLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        iconLabel.verticalAlign = Label.VerticalAlign.CENTER;
        iconNode.setPosition(0, 12, 0);
        card.addChild(iconNode);

        // 名字（放在下半部分）
        const nameLabel = new Node('NameLabel');
        const nl = nameLabel.addComponent(Label);
        nl.string = unitNames[i];
        nl.fontSize = 14;
        nl.color = Color.WHITE;
        nl.horizontalAlign = Label.HorizontalAlign.CENTER;
        nl.verticalAlign = Label.VerticalAlign.CENTER;
        nameLabel.setPosition(0, -15, 0);
        card.addChild(nameLabel);

        // 选中勾（默认隐藏，placed 时显示）
        const checkMark = new Node('CheckMark');
        const cmLabel = checkMark.addComponent(Label);
        cmLabel.string = '\u2713';
        cmLabel.fontSize = 20;
        cmLabel.color = new Color(80, 220, 80);
        checkMark.setPosition(cardWidth / 2 - 15, cardHeight / 2 - 10, 0);
        checkMark.active = false;
        card.addChild(checkMark);

        // 交互
        card['_deployIdx'] = i;
        card['_deployCb'] = callback;
        card.on(Node.EventType.TOUCH_END, (evt) => {
            const idx = evt.target['_deployIdx'] as number;
            const cb = evt.target['_deployCb'] as (index: number) => void;
            if (cb) cb(idx);
        });

        this.node.addChild(card);
        this._deployCards.push(card);
    }
}
```

注意：`showDeployUnitList` 原先是挂载到 `this.deployCardContainer` 下。现在改为 `this.node.addChild(card)`（挂到 BattleUI 节点下），因为兵牌是棋盘左侧的独立 UI。

- [ ] **步骤 6：更新 `selectDeployCard()` 不访问已移除的容器**

`selectDeployCard()`（第 375-387 行）只操作 `this._deployCards`，不依赖容器，所以**无需修改**。

- [ ] **步骤 7：更新 `onDestroy()` 不引用 `deployCardContainer`**

`onDestroy()`（第 626-637 行）只清 JS 引用，没有直接访问 `deployCardContainer`。检查确认**无需修改**。

---

### 任务 2：BattleManager.ts — 布阵阶段隐藏棋盘外单位节点

**文件：** 修改 `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

**说明：** 布阵阶段左侧的"三个方框"实际上是 `col=-1` 的单位实体。需要隐藏它们的节点，避免与兵牌 UI 重复。放置到棋盘时恢复显示，撤回时再次隐藏。

- [ ] **步骤 1：在 `startDeployPhase()` 末尾隐藏所有 `col=-1` 的单位节点**

在 `startDeployPhase()` 方法（第 162-173 行）末尾追加：

```typescript
// 隐藏棋盘外单位（防左侧出现重复的"三个方框"）
for (const unit of this._playerUnits) {
    if (unit.node?.isValid && unit.data?.gridPos.col < 0) {
        unit.node.active = false;
    }
}
```

完整后的 `startDeployPhase()`：

```typescript
private startDeployPhase(): void {
    this._phase = 'deploy';
    this._highlightDeployArea();
    this.gridController.setCellClickCallback((pos) => this.onDeployCellClicked(pos));
    // 自动选中第一张卡
    this._selectedDeployUnitIndex = 0;
    if (this._onDeploySelectionChanged) {
        this._onDeploySelectionChanged(0);
    }
    // 禁用后 4 行格子交互
    this.gridController.setRowsInteractable([2, 3, 4, 5], false);
    // 隐藏棋盘外单位（防左侧出现重复的"三个方框"）
    for (const unit of this._playerUnits) {
        if (unit.node?.isValid && unit.data?.gridPos.col < 0) {
            unit.node.active = false;
        }
    }
}
```

- [ ] **步骤 2：单位放置时显示节点**

在 `onDeployCellClicked()` 中，放置成功后（`unit.setGridPosition(pos)` 之后，`this._deployedPositions.push(pos)` 之后），追加显示节点：

修改第 279-285 行，在 `unit.setGridPosition(pos);` 之后插入：

```typescript
// 显示单位节点（放置到棋盘上后可见）
if (unit.node?.isValid) {
    unit.node.active = true;
}
```

完整后的代码段：

```typescript
unit.setGridPosition(pos);
this._deployedPositions.push(pos);

// 显示单位节点（放置到棋盘上后可见）
if (unit.node?.isValid) {
    unit.node.active = true;
}

this.gridController.highlightCells(this._deployedPositions, new Color(100, 200, 100, 255));
```

- [ ] **步骤 3：单位撤回时隐藏节点**

在 `selectDeployUnit()` 中，撤回逻辑（`col >= 0` 分支，第 223 行起），在重置位置后追加隐藏节点：

找到 `unit.node.setPosition(...)`（第 233-236 行）之后，追加：

```typescript
// 隐藏单位节点（撤回后不显示在棋盘外）
if (unit.node?.isValid) {
    unit.node.active = false;
}
```

完整后的撤回代码段（第 223-249 行）：

```typescript
if (unit.data.gridPos.col >= 0) {
    const oldPos = unit.data.gridPos;
    this._deployedPositions = this._deployedPositions.filter(
        p => !(p.row === oldPos.row && p.col === oldPos.col)
    );
    unit.data.gridPos = { row: index, col: -1 };
    unit.data.hasMoved = false;
    unit.node.setPosition(
        (-1 - 2.5) * GridController.CELL_SIZE,
        (index - 2.5) * GridController.CELL_SIZE
    );
    // 隐藏单位节点（撤回后不显示在棋盘外）
    if (unit.node?.isValid) {
        unit.node.active = false;
    }
    if (this._onDeployUnitPlacedCallback) {
        this._onDeployUnitPlacedCallback(this._deployedPositions.length, this._playerUnits.length);
    }
    this._highlightDeployArea();
    this._selectedDeployUnitIndex = index;
    if (this._onDeploySelectionChanged) {
        this._onDeploySelectionChanged(index);
    }
    return;
}
```

- [ ] **步骤 4：确认布阵后恢复单位节点显示（安全措施）**

在 `startBattleAfterAnimation()`（第 200-207 行）中，确认所有玩家单位节点可见：

```typescript
startBattleAfterAnimation(): void {
    this._phase = 'player_turn';
    this._turnCount = 1;
    this.gridController.setCellClickCallback((pos) => this.onCellClicked(pos));
    this.gridController.setRowsInteractable([2, 3, 4, 5], true);
    // 确保所有单位节点可见（防止 col=-1 的单位因为之前的隐藏而不可见）
    for (const unit of this._playerUnits) {
        if (unit.node?.isValid && unit.data?.isAlive) {
            unit.node.active = true;
        }
    }
    this.startPlayerTurn();
}
```

---

### 任务 3：TinyVanguardMain.ts — 更新调用方法名

**文件：** 修改 `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`

**说明：** 将 `showDeployUnitList` 调用替换为 `setupPlatoonCards`。

- [ ] **步骤 1：替换调用方法**

第 398 行：
```typescript
// 之前
this.battleUI.showDeployUnitList(unitNames, unitIcons, (index) => {

// 之后
this.battleUI.setupPlatoonCards(unitNames, unitIcons, (index) => {
```

完整上下文（第 394-400 行）：

```typescript
const unitIcons = this._runData.playerClasses.map(c => {
    const config = getClassById(c);
    return config ? config.icon : '';
});
this.battleUI.setupPlatoonCards(unitNames, unitIcons, (index) => {
    this.battleManager.selectDeployUnit(index);
});
```

---

## 规格覆盖度检查

| 规格需求 | 实现任务 |
|---------|---------|
| 去掉底部 deployCardContainer | 任务 1 步骤 1-4 |
| 左侧竖排兵牌 (setupPlatoonCards) | 任务 1 步骤 5 |
| 保留三态 selectDeployCard 方法 | 任务 1 步骤 6 (不变) |
| 布阵阶段隐藏棋盘外单位 | 任务 2 步骤 1 |
| 放置时显示单位节点 | 任务 2 步骤 2 |
| 撤回时隐藏单位节点 | 任务 2 步骤 3 |
| 确认布阵后恢复节点 | 任务 2 步骤 4 |
| TinyVanguardMain 调用更新 | 任务 3 步骤 1 |

## 占位符扫描

- [x] 无 TODO / 待定 / 未完成章节
- [x] 所有代码块包含完整代码
- [x] 所有引用的类型/方法/属性在项目中存在
- [x] DRY — 无重复代码
- [x] YAGNI — 无多余功能

## 执行顺序

1. 任务 1 → 任务 2 → 任务 3（有顺序依赖：TinyVanguardMain 依赖 BattleUI 的新方法名）
2. 每个任务完成后不中断，但建议在全部完成后运行 Cocos Creator 构建验证
