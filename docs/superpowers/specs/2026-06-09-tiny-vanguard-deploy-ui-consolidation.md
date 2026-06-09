# Tiny Vanguard 布阵界面去重设计

**日期**: 2026-06-09
**版本**: v1.0
**状态**: 设计完成
**关联文档**: [布阵界面交互修复设计](./2026-06-09-tiny-vanguard-deploy-ui-fix.md)

---

## 1. 问题概述

布阵阶段存在信息重复：`deployCardContainer`（底部三张单位卡片）和棋盘左侧 3 个单位实体同时存在，均展示同一组待部署单位，给玩家带来认知负担。

### 重复的两个区域

| 位置 | 内容 | 问题 |
|------|------|------|
| 棋盘左侧 | 3 个单位预制体实例（`col: -1` 定位在棋盘外） | 看起来像"三个方框"，无交互提示 |
| 底部 `deployCardContainer` | 3 张卡片（职业名 + 图标 + 三态视觉） | 与左侧信息完全重复 |

玩家需要在"看懂左边三个模型"和"理解底部三张卡片"之间来回切换，交互心智沉重。

---

## 2. 设计方案：左侧兵牌

### 2.1 核心思路

**去掉底部卡片，将棋盘左侧的单位本体改造为「可点击的兵牌」**——既是单位视觉实体，也是交互入口。兵牌竖排一列位于棋盘左侧，玩家直接点击兵牌选中，再点击棋盘格子部署。

### 2.2 布局

```
┌─────────────────────────────────────┐
│          布阵阶段                    │
│                                      │
│ ┌────┐  ┌─────────────────────┐     │
│ │⚔️  │  │                     │     │
│ │战士│  │    棋盘 (6×6)       │     │
│ ├────┤  │  前两行 绿色高亮     │     │
│ │🏹  │  │                     │     │
│ │弓手│  │                     │     │
│ ├────┤  │                     │     │
│ │🔮  │  │                     │     │
│ │法师│  │                     │     │
│ └────┘  └─────────────────────┘     │
│                                      │
│          [  确认布阵  ]              │
└─────────────────────────────────────┘
```

- 兵牌位棋盘左侧，y 方向居中偏向
- 垂直间距 8~12px，视觉上与棋盘对齐
- 兵牌尺寸约 120×70，与现有卡片一致

### 2.3 三态视觉

| 状态 | 底色 | 缩放 | 额外元素 | 描述 |
|------|------|------|---------|------|
| `unplaced` | `(60, 60, 80, 200)` | 1.0× | 无 | 待部署，总体暗色调符合游戏风格 |
| `selected` | `(80, 200, 80, 220)` | 1.05× | 翠绿边框 (`HighlightBorder`) | 当前选中，突出"可以上场了" |
| `placed` | `(40, 40, 60, 150)` | 1.0× | ✓ 勾标记 | 已部署，变暗+勾表示完成 |

### 2.4 交互流程

```
布阵开始 → 自动选中第 1 个兵牌 (selected)
              ↓
       玩家可做 3 种操作：
       ├── 点击另一个未部署兵牌 → 切换选中
       ├── 点击已部署兵牌 → 撤回该单位，兵牌恢复 unplaced
       └── 点击棋盘前两行格子 → 放置单位
              ↓
       放置成功 → 单位动画飞入格子，兵牌变为 placed
              ↓
       自动选中下一个未部署兵牌
              ↓
       全部放完 → "确认部署"按钮可点击
```

### 2.5 视觉风格（贴合暗色战棋风）

- 每个兵牌包含：职业图标（Label 实现的 emoji）+ 职业名（Label）
- 兵牌四角略圆（通过 Sprite 九宫格或纯色背景即可）
- 不可对兵牌使用 tween 脉冲动画（遵循防崩溃守则），选中态仅做 scale + 边框
- 已部署兵牌显示半透明 ✓ 勾，单位已实际出现在棋盘上

---

## 3. 改动范围

### 3.1 文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `BattleUI.ts` | 修改 | 替换 `deployCardContainer` 为左侧兵牌布局；保留 `setDeployCardState` / `selectDeployCard` 等三态逻辑 |
| `BattleManager.ts` | 微调 | `createPlayerUnits` 不再将单位定位到棋盘外左侧（因为兵牌由 UI 接管）；`selectDeployUnit` 中取消放置后的坐标逻辑调整 |
| `TinyVanguardMain.ts` | 可能微调 | 如果 `showDeployUnitList` 调用方式变化，相应调整 |

### 3.2 BattleUI.ts 具体改动

**(a) 去掉 `deployCardContainer` 的动态创建逻辑**

`onLoad()` 中不再创建 `DeployCardContainer`，`showDeployPhase()` 中不再激活它。

**(b) 新增 `setupPlatoonCards()` 方法**

替代 `showDeployUnitList`，在棋盘左侧创建竖排兵牌：

```typescript
setupPlatoonCards(unitNames: string[], unitIcons: string[], callback: (index: number) => void): void {
    this._deployCards = [];
    const cardWidth = 120;
    const cardHeight = 70;
    const gap = 8;
    const startY = (unitNames.length - 1) * (cardHeight + gap) / 2;

    for (let i = 0; i < unitNames.length; i++) {
        const card = new Node(`PlatoonCard_${i}`);
        card.setPosition(-380, startY - i * (cardHeight + gap), 0);
        // ... 与现有 showDeployUnitList 相同的卡片创建逻辑 ...
        this.node.addChild(card);
        this._deployCards.push(card);
    }
    this._deployCardContainerActive = true;
}
```

**(c) 保留三态方法**

`setDeployCardState()` 和 `selectDeployCard()` 的核心逻辑不变，只调整兵牌位置在左侧。

### 3.3 BattleManager.ts 具体改动

**(a) `startDeployPhase()` 中无需手动将单位定位到棋盘外**

因为布阵期间棋盘左侧不再展示单位实体，由兵牌 UI 接管展示。`createPlayerUnits` 中的 `col: -1` 位置保持但在 `GridController.node` 隐藏时单位节点不可见。

**(b) 保持现有 `selectDeployUnit` / `onDeployCellClicked` 逻辑不变**

选中、放置、撤回的核心逻辑不动。

### 3.4 不受影响的部分

- `UnitController.ts` — 不修改（单位行为不变）
- `GridController.ts` — 不修改（棋盘交互不变）
- `GameData.ts` — 不修改
- 场景文件 — 不直接读写
- 战斗阶段逻辑 — 不受影响

---

## 4. 验证方法

1. 进入布阵阶段 → 棋盘左侧出现 3 张兵牌（竖排），无底部卡片
2. 第 1 张兵牌自动高亮（selected）
3. 点击另一张兵牌 → 高亮切换
4. 点击棋盘前两行高亮格子 → 单位放置，兵牌变 placed（暗 + ✓）
5. 自动选中下一张待部署兵牌
6. 点击已部署兵牌 → 单位撤回，兵牌恢复 unplaced
7. 全部部署完毕 → "确认部署"可点击
8. 确认后进入战斗 → 兵牌隐藏，恢复正常战斗 UI

---

## 5. 规格自检

- [x] 无占位符/TODO/未完成章节
- [x] 内部一致：布局、交互、三态视觉描述匹配
- [x] 范围聚焦：仅解决布阵界面的信息重复问题
- [x] 需求明确：每个改动有具体说明和代码示意
- [x] 风格匹配：暗色战棋视觉风格
