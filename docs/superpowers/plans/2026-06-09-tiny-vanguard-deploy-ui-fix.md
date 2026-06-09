# Tiny Vanguard 布阵界面交互修复 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复布阵阶段 4 个问题：卡片无选中反馈、可部署格子点击无反应、不可部署区域有 Button 动画、文字重叠。

**架构：** 纯视觉/交互改动，不改数据模型。在 GridController 新增格子行交互控制方法，BattleManager 增加自动选卡/放置流转逻辑，BattleUI 卡片渲染改为三态。

**技术栈：** Cocos Creator 3.8.8, TypeScript

---

### 任务 1：GridController 新增 `setRowsInteractable`

**文件：** 修改 `assets/games/game_tiny_vanguard/scripts/battle/GridController.ts`

在 `clearHighlights()` 方法之后、`positionToGrid()` 之前插入新方法。

- [ ] **步骤 1.1：在 GridController 中添加 `setRowsInteractable` 方法**

```typescript
setRowsInteractable(rows: number[], interactable: boolean): void {
    for (const row of rows) {
        for (let col = 0; col < GridController.GRID_SIZE; col++) {
            const cell = this._cells[row]?.[col];
            if (!cell?.isValid) continue;
            const btn = cell.getComponent(Button);
            if (btn) btn.interactable = interactable;
            const sprite = cell.getComponent(Sprite);
            if (sprite) {
                sprite.color = interactable
                    ? GridController.DEFAULT_CELL_COLOR
                    : new Color(60, 60, 60, 100);
            }
        }
    }
}
```

确认 `Button` 已在文件顶部的 import 中（当前 import 已有 `Button`）。

---

### 任务 2：BattleManager 增加布阵选中和自动流转逻辑

**文件：** 修改 `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

- [ ] **步骤 2.1：新增 `_onDeploySelectionChanged` 回调字段**

在现有的回调字段（如 `_onDeployUnitPlacedCallback`）之后添加：

```typescript
private _onDeploySelectionChanged: ((index: number) => void) | null = null;
```

- [ ] **步骤 2.2：新增 `setDeploySelectionChangedCallback` 方法**

在 `setDeployUnitPlacedCallback` 方法之后添加：

```typescript
setDeploySelectionChangedCallback(cb: (index: number) => void): void {
    this._onDeploySelectionChanged = cb;
}
```

- [ ] **步骤 2.3：修改 `startDeployPhase()` — 自动选第 1 张卡 + 禁用后 4 行**

找到 `startDeployPhase()` 方法，在其末尾追加：

```typescript
private startDeployPhase(): void {
    this._phase = 'deploy';
    this._highlightDeployArea();
    this.gridController.setCellClickCallback((pos) => this.onDeployCellClicked(pos));
    // ==== 追加开始 ====
    // 自动选中第一张卡
    this._selectedDeployUnitIndex = 0;
    if (this._onDeploySelectionChanged) {
        this._onDeploySelectionChanged(0);
    }
    // 禁用后 4 行格子交互
    this.gridController.setRowsInteractable([2, 3, 4, 5], false);
    // ==== 追加结束 ====
}
```

- [ ] **步骤 2.4：修改 `selectDeployUnit()` — 分发选中通知**

找到 `selectDeployUnit()` 方法中的 `this._selectedDeployUnitIndex = index;` 行（约第 234 行），在其后添加通知分发：

原代码：
```typescript
    // 未放置，正常进入选中
    this._selectedDeployUnitIndex = index;
    this._highlightDeployArea();
```

改为：
```typescript
    // 未放置，正常进入选中
    this._selectedDeployUnitIndex = index;
    this._highlightDeployArea();
    // 分发选中通知
    if (this._onDeploySelectionChanged) {
        this._onDeploySelectionChanged(this._selectedDeployUnitIndex);
    }
```

- [ ] **步骤 2.5：修改 `onDeployCellClicked()` — 放置后自动选中下一张卡**

找到 `onDeployCellClicked()` 方法末尾的 `this._selectedDeployUnitIndex = -1;`，替换为自动流转逻辑：

原代码（约第 249-254 行）：
```typescript
    this.gridController.highlightCells(this._deployedPositions, new Color(100, 200, 100, 255));
    this._selectedDeployUnitIndex = -1;

    if (this._onDeployUnitPlacedCallback) {
        this._onDeployUnitPlacedCallback(this._deployedPositions.length, this._playerUnits.length);
    }
```

改为：
```typescript
    this.gridController.highlightCells(this._deployedPositions, new Color(100, 200, 100, 255));
    // 自动选中下一张未放置的卡
    const nextIndex = this._playerUnits.findIndex(
        (u, i) => i !== this._selectedDeployUnitIndex && u.data?.gridPos.col < 0
    );
    if (nextIndex >= 0) {
        this._selectedDeployUnitIndex = nextIndex;
        if (this._onDeploySelectionChanged) {
            this._onDeploySelectionChanged(nextIndex);
        }
    } else {
        this._selectedDeployUnitIndex = -1;
    }

    if (this._onDeployUnitPlacedCallback) {
        this._onDeployUnitPlacedCallback(this._deployedPositions.length, this._playerUnits.length);
    }
```

---

### 任务 3：BattleUI 卡片三态渲染

**文件：** 修改 `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

- [ ] **步骤 3.1：新增 `setDeployCardState` 方法（替代原 `updateDeployItemState`）**

找到 `updateDeployItemState(index, placed)` 方法，将其替换为三态版本：

```typescript
setDeployCardState(index: number, state: 'unplaced' | 'selected' | 'placed'): void {
    const card = this._deployCards[index];
    if (!card?.isValid) return;

    const bg = card.getComponent(Sprite);
    const checkMark = card.getChildByName('CheckMark');

    // 找到或创建 HighlightBorder
    let border = card.getChildByName('HighlightBorder');

    switch (state) {
        case 'unplaced':
            if (bg) bg.color = new Color(60, 60, 80, 200);
            card.setScale(new Vec3(1, 1, 1));
            if (checkMark) checkMark.active = false;
            if (border) border.active = false;
            break;

        case 'selected':
            if (bg) bg.color = new Color(80, 200, 80, 220);
            card.setScale(new Vec3(1.1, 1.1, 1));
            if (checkMark) checkMark.active = false;
            if (!border) {
                border = new Node('HighlightBorder');
                const bSprite = border.addComponent(Sprite);
                bSprite.color = new Color(80, 220, 80, 255);
                bSprite.sizeMode = Sprite.SizeMode.CUSTOM;
                const bTrans = border.addComponent(UITransform);
                bTrans.setContentSize(130, 80);
                border.setPosition(0, 0, -1);
                card.addChild(border);
            }
            border.active = true;
            break;

        case 'placed':
            if (bg) bg.color = new Color(40, 40, 60, 150);
            card.setScale(new Vec3(1, 1, 1));
            if (checkMark) checkMark.active = true;
            if (border) border.active = false;
            break;
    }
}
```

确保文件顶部 import 包含 `Node, Sprite, Label, Color, UITransform, Vec3`（当前已有）。

- [ ] **步骤 3.2：新增 `selectDeployCard` 公共方法**

在 `setDeployCardState` 方法之后添加：

```typescript
selectDeployCard(index: number): void {
    // 先重置所有卡片为 unplaced
    for (let i = 0; i < this._deployCards.length; i++) {
        const card = this._deployCards[i];
        if (!card?.isValid) continue;
        // 不重置已放置的卡片
        const checkMark = card.getChildByName('CheckMark');
        if (checkMark?.active) continue;
        this.setDeployCardState(i, 'unplaced');
    }
    // 设置目标卡片为选中态
    this.setDeployCardState(index, 'selected');
}
```

- [ ] **步骤 3.3：修改 `showDeployPhase()` — 精简文字**

找到 `showDeployPhase()`，改为：

```typescript
showDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = true;
    if (this.confirmDeployButton) this.confirmDeployButton.node.active = true;
    if (this.waitButton) this.waitButton.node.active = false;
    if (this.endTurnButton) this.endTurnButton.node.active = false;

    // 清空战斗信息区域的文字（只保留 PhaseLabel）
    if (this.unitNameLabel) this.unitNameLabel.string = '';
    if (this.hpLabel) this.hpLabel.string = '';
    if (this.energyLabel) this.energyLabel.string = '';
    if (this.turnLabel) this.turnLabel.string = '';
    if (this.unitTurnLabel) this.unitTurnLabel.string = '';
    if (this.actionHintLabel) this.actionHintLabel.string = '';

    if (this.deployUnitList) this.deployUnitList.active = false;
    if (this.deployCardContainer) {
        this.deployCardContainer.active = true;
    }
}
```

- [ ] **步骤 3.4：修改 `showDeployUnitList()` — 卡片点击回调分发选中状态**

在 `showDeployUnitList` 中，卡片点击回调（约第 307 行）不仅调用 callback，还应将点击索引传入备用。但为了避免耦合，保持原样——`selectDeployUnit` 回调会触发 `BattleManager.selectDeployUnit` → `_onDeploySelectionChanged` → `BattleUI.selectDeployCard`。

不修改此方法。依赖外部回调链路。

---

### 任务 4：TinyVanguardMain 接入新回调

**文件：** 修改 `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`

- [ ] **步骤 4.1：在 `startNewRun()` 中连接布阵选中回调**

在 `startNewRun()` 方法中，找到 `this.battleManager.setDeployUnitPlacedCallback(...)` 之后，添加：

```typescript
// 布阵卡片选中回调 → 更新 UI 卡片高亮
this.battleManager.setDeploySelectionChangedCallback((index) => {
    this.battleUI.selectDeployCard(index);
});
```

同时将 `setDeployUnitPlacedCallback` 中的回调改为调用新的三态 API：

找到现有的 `setDeployUnitPlacedCallback` 回调（约第 397-404 行）：

```typescript
this.battleManager.setDeployUnitPlacedCallback((placed, total) => {
    // 计算每个 index 的状态（支持取消）
    for (let i = 0; i < this.battleManager.playerUnits.length; i++) {
        const unit = this.battleManager.playerUnits[i];
        const isPlaced = unit.data?.gridPos.col >= 0;
        this.battleUI.updateDeployItemState(i, isPlaced);
    }
});
```

改为：

```typescript
this.battleManager.setDeployUnitPlacedCallback((placed, total) => {
    // 三态更新：遍历所有单位，根据放置状态更新卡片
    for (let i = 0; i < this.battleManager.playerUnits.length; i++) {
        const unit = this.battleManager.playerUnits[i];
        const isPlaced = unit.data?.gridPos.col >= 0;
        this.battleUI.setDeployCardState(i, isPlaced ? 'placed' : 'unplaced');
    }
});
```

- [ ] **步骤 4.2：确保 `onDestroy` 不产生新泄漏**

`setDeploySelectionChangedCallback` 不需要在 onDestroy 中特别处理，因为它只存储 JS 闭包引用，不涉及节点事件绑定。无需改动 `onDestroy`。

---

### 任务 5：验证改动

由于无测试框架，手动验证步骤：

- [ ] **步骤 5.1：确保 TypeScript 编译无错误**

在 Cocos Creator 编辑器中打开项目，检查控制台无红色错误。

- [ ] **步骤 5.2：功能验证清单**

在编辑器预览中逐项验证：

1. 从 ClassSelectPanel 选 3 个职业 → 点击"开始游戏" → 进入路线图 → 点击战斗节点
2. 进入布阵阶段后：
   - 第 1 张卡应自动高亮（绿色背景 + 1.1x 缩放 + 绿色边框）
   - 底部卡片区不应再有"部署阵容""点击卡片→点击格子放置"等文字
   - 顶部 PhaseLabel 显示"布阵阶段"
   - 点击后 4 行（row 2-5）格子：无 pressed 动画，格子呈灰色
3. 点击第 2 张卡：高亮切换到第 2 张
4. 点击 row 0-1 可部署格子：第 1 张卡变为暗色 + ✓，自动切换到下一张高亮
5. 全部放置后：所有卡变暗 + ✓，确认部署按钮可点击（已有逻辑）
6. 点击已放置的卡：撤回该单位，卡恢复亮色，格子恢复可部署

---
