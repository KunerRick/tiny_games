# Tiny Vanguard 布阵界面交互修复设计

**日期**: 2026-06-09  
**版本**: v1.0  
**状态**: 已批准

---

## 1. 问题概述

布阵阶段存在 4 个交互/显示问题：

1. **卡片无选中反馈** — 点击底部单位卡片后无视觉状态变化，用户不知当前选中了谁
2. **可部署格子点击无反应** — 因为 `onDeployCellClicked` 要求 `_selectedDeployUnitIndex >= 0`，卡片无选中反馈导致用户点格子也无效
3. **不可部署区域有 Button 动画** — row 2-5 格子仍可交互，触发 pressed/hover 动画
4. **文字重叠** — PhaseLabel / UnitTurnLabel / ActionHintLabel / DeployPrompt 间距仅 30px，字体 24px+ 叠加；unitNameLabel 和 hpLabel 在布阵时展示了不必要的内容

## 2. 设计方案

### 2.1 卡片三态视觉

每张卡片严格区分三种状态，视觉互斥：

| 状态 | 底色 | 缩放 | 额外元素 |
|------|------|------|---------|
| `unplaced` | (60, 60, 80, 200) | 1.0× | 无 |
| `selected` | (80, 200, 80, 220) | 1.1× | 绿色边框 (HighlightBorder) |
| `placed` | (40, 40, 60, 150) | 1.0× | ✓ 勾标记 |

### 2.2 布阵交互流程

```
进入布阵 → 自动选中第 1 张卡(selected)
              ↓
       用户可做 3 种操作：
       ├── 点击另一张未放置卡 → 切换选中
       ├── 点击已放置卡 → 撤回该单位，卡恢复 unplaced
       └── 点击格子(row 0-1) → 放置单位
              ↓
       放置成功后 → 自动选中下一张未放置卡
              ↓
       全部放完 → "确认部署"按钮可点击
```

### 2.3 格子交互控制

- row 0-1（可部署）：正常高亮绿色半透明，Button 可点击
- row 2-5（不可部署）：深灰色半透明，`Button.interactable = false`，无任何点击反馈

在 `GridController` 新增 `setRowsInteractable(rows, bool)` 通用方法。

### 2.4 文字精简

布阵阶段只保留顶部 PhaseLabel 显示"布阵阶段"，其余文字节点全部设为空/隐藏：

| 节点 | 动作 |
|------|------|
| PhaseLabel | 显示"布阵阶段" |
| DeployPrompt | 保持 active=false（已正确隐藏） |
| unitNameLabel | 设为空字符串 |
| hpLabel | 设为空字符串 |
| energyLabel | 设为空字符串 |
| turnLabel | 设为空字符串 |
| unitTurnLabel | 设为空字符串 |
| actionHintLabel | 设为空字符串 |

## 3. 改动范围

### 3.1 文件清单

| 文件 | 改动类型 |
|------|---------|
| `assets/games/game_tiny_vanguard/scripts/battle/GridController.ts` | 新增 `setRowsInteractable()` |
| `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts` | 新增逻辑：自动选卡、放置后切卡、布阵开始/结束时控制格子状态 |
| `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts` | 重构卡片渲染：三态视觉 + 文字精简 |

### 3.2 GridController.ts 改动

新增方法：

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

### 3.3 BattleManager.ts 改动

**(a) 新增回调**

```typescript
private _onDeploySelectionChanged: ((index: number) => void) | null = null;
```

**(b) `startDeployPhase()` 末尾追加**

```typescript
// 自动选中第一张卡
this._selectedDeployUnitIndex = 0;
if (this._onDeploySelectionChanged) {
    this._onDeploySelectionChanged(0);
}
// 禁用后 4 行格子交互
this.gridController.setRowsInteractable([2, 3, 4, 5], false);
this._highlightDeployArea();
```

**(c) `selectDeployUnit()` 分发选中通知**

```typescript
// 在设置 _selectedDeployUnitIndex 后分发
if (this._onDeploySelectionChanged) {
    this._onDeploySelectionChanged(this._selectedDeployUnitIndex);
}
```

**(d) `onDeployCellClicked()` 放置成功后自动切换**

```typescript
// 放置成功后，自动选中下一张未放置的卡
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
```

**(e) 暴露 `setDeploySelectionChangedCallback` 和 `setRowsInteractable` 的监听方法**

**(f) 将 `deploy` 阶段的 `phase` 转发参数统一处理**
确认在 `setUnitPhaseChangedCallback` 中正确分发 `deploy` 阶段通知，确保 BattleUI 能收到。

### 3.4 BattleUI.ts 改动

**(a) 重构卡片的 `updateDeployItemState` → 三态**

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

**(b) `showDeployPhase()` 精简文字**

```typescript
// 只显示阶段名
if (this.unitNameLabel) this.unitNameLabel.string = '';
if (this.hpLabel) this.hpLabel.string = '';
if (this.energyLabel) this.energyLabel.string = '';
if (this.turnLabel) this.turnLabel.string = '';
if (this.unitTurnLabel) this.unitTurnLabel.string = '';
if (this.actionHintLabel) this.actionHintLabel.string = '';
// PhaseLabel 保留（由 updatePhase 设置）
```

**(c) 新增 `selectDeployCard(index)` 公共方法**

供 BattleManager 调用，内部调用 `setDeployCardState`。

## 4. 不涉及改动

- UnitController.ts — 无需更改
- TinyVanguardMain.ts — 仅调整回调绑定（新增 `setDeploySelectionChangedCallback`）
- GameData.ts / config — 无变化
- 场景文件 (.scene) — 不直接读写
- 战斗阶段逻辑 — 完全不受影响

## 5. 验证方法

1. 进入布阵阶段 → 确认第 1 张卡自动高亮（绿色边框+放大）
2. 点击另一张卡 → 高亮切换
3. 点击 row 2-5 格子 → 无任何动画，格子灰色
4. 点击 row 0-1 格子 → 放置单位，卡变暗+勾，自动切下一张
5. 点击已放置的卡 → 撤回，卡恢复亮色
6. 全部放完 → "确认部署"可点击（已有逻辑，未改动）
7. 确认部署后 → 进入战斗阶段，格子恢复正常交互

---

*文档结束*
