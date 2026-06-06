# Tiny Vanguard — 战斗流程交互优化设计

**日期**: 2026-06-06
**版本**: v1.0
**状态**: 设计完成

---

## 1. 概述

基于玩家反馈，Tiny Vanguard 的战斗流程（布阵 → 战斗 → 胜利）存在交互不直观、阶段过渡生硬、按钮混淆等问题。本文档对战斗流程进行全面的 UX 优化设计。

**设计原则**:
- 最小改动原则：尽量复用现有代码架构
- 每阶段意图清晰：玩家随时知道"现在该做什么"
- 减少冗余操作：合并重复按钮，智能跳过无用操作

---

## 2. 改造范围

涉及文件（均只改纯 TypeScript 代码，不碰场景/预制体）：

| 文件 | 改动量 |
|------|--------|
| `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts` | 中 — 新增布阵卡片容器、战前遮罩、修改按钮布局 |
| `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts` | 小 — `confirmDeploy` 回调改为等待动画完成；`selectDeployUnit` 支持取消放置 |
| `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts` | 中 — 胜利改为等待用户点击；适配新回调 |

---

## 3. 详细设计

### 3.1 布阵阶段改造

#### 当前问题
- 左侧文字列表 + 点名字→点格子两步操作缺少视觉反馈
- 放置后不能重新调整

#### 设计方案

**单位卡片**（替换左侧 `deployUnitList`）：
- 在 BattleUI 底部新增 `deployCardContainer` 节点，横排 3 张卡片
- 每张卡片 = 职业图标 + 名字，有边框背景
- 来自 `showDeployUnitList` 的数据，改为渲染卡片而非纯文本

**放置操作**：
1. 点击卡片 → 卡片放大高亮 + 网格前两行绿底高亮
2. 点击网格格子 → 单位放置到该格 → 卡片变灰 + 右下角显示绿色勾标记
3. 再次点击已放置的卡片 → 清除原位置 → 卡片恢复可放置状态 → 重新选格
4. 所有卡片都标记"已放置"后，"部署完成"按钮亮起

**视觉区分**：
- 己方半场（row 0-1）底色浅蓝
- 敌方半场（row 2-5）底色浅红（不遮挡单位）
- 分界线加粗显示

#### 涉及修改

`BattleUI.ts`:
- 新增 `deployCardContainer: Node` 属性声明（用 @property，可在编辑器绑定现有节点或代码动态创建）
- `showDeployDeployUnitList` 改为创建卡片节点（带 Sprite 背景 + Label + CheckMark）
- `updateDeployItemState` 改为更新卡片视觉（变灰 + 勾标记）
- `showDeployPhase` 中 `deployUnitList` 隐去，显示 `deployCardContainer`
- `hideDeployPhase` 关闭 `deployCardContainer`

`BattleManager.ts`:
- `selectDeployUnit(index)` 修改：如果该单位 `gridPos.col >= 0`（已放置），则清除其位置、从 `_deployedPositions` 移除、回调通知 UI 取消状态
- `_onDeployUnitPlacedCallback` 增加一个 `cancelled` 参数

`TinyVanguardMain.ts`:
- 适配 `setDeployUnitPlacedCallback` 回调签名变化

---

### 3.2 战斗开始过渡

#### 当前问题
确认布阵后直接跳到第 1 回合，缺少"战斗开始"的仪式感。

#### 设计方案

在 BattleUI 新增 `battleStartOverlay` 节点（半透明遮罩 + 大字）：

流程：
```
confirmDeploy() 被调用
  → BattleUI 显示遮罩动画（0.3s 渐暗）
  → 浮现 "⚔ 战斗开始！" 大字（1.2s，带缩放 + 淡入动画）
  → 遮罩淡出（0.3s）
  → 回调通知 TinyVanguardMain → 进入 startPlayerTurn()
```

改动：
- `BattleUI.ts`：新增 `battleStartOverlay` 属性 + `playBattleStartAnimation(callback)` 方法
- `BattleManager.ts`：`confirmDeploy()` 不再直接调 `startPlayerTurn()`，改为触发动画后回调再调用
- `TinyVanguardMain.ts`：在 `onConfirmDeploy` 中适配动画完成回调

---

### 3.3 按钮合并

#### 当前问题
"等待"和"结束回合"两个按钮功能重复（都结束当前单位行动）。

#### 设计方案

| 按钮 | 状态 | 说明 |
|------|------|------|
| **结束行动** | 保留（原"等待"位置） | 结束当前单位行动，切到下一个单位 |
| 结束回合 | **移除** | 由"所有单位行动完毕自动切敌方回合"替代 |

交互简化后，玩家只有一个操作按钮。单位按以下方式结束：
- 主动攻击 / 使用技能 → 自动结束（已实现）
- 点击"结束行动" → 手动跳过
- 无可攻击目标且无可用技能 → 自动跳过（已有 `_checkAutoSkipIfNoTargets`）

改动：
- `BattleUI.ts`：隐藏 `endTurnButton`，`waitButton` 改名为逻辑上的"结束行动"
- `TinyVanguardMain.ts`：`onEndTurn` 相关逻辑移除

---

### 3.4 阶段提示 Banner 增强

#### 当前问题
阶段信息通过分散的 Label 显示，不够醒目。

#### 设计方案

利用现有的 `phaseLabel` / `unitTurnLabel` / `actionHintLabel`，统一为顶部阶段 Banner：

| 阶段 | 文字内容 | 视觉 |
|------|---------|------|
| 布阵 | `🟢 布阵阶段 · 放置你的单位到前两行` | 绿底白字 |
| 我方回合 | `🔵 第 N 回合 · 我方行动 · 战士(1/3)` | 蓝底白字 |
| 敌方回合 | `🔴 敌方回合 · 敌人行动中...` | 红底白字 |
| 胜利 | `🏆 战斗胜利！` | 金底 |
| 失败 | `💀 战斗失败` | 灰底 |

改动：
- `BattleUI.ts`：`updatePhase` 方法增强——为 `phaseLabel` 设置背景色 Sprite
- 只需要新增一个 `phaseBg: Sprite` 属性来设置背景色

---

### 3.5 胜利界面改造

#### 当前问题
- 胜利面板（`victoryPanel`）闪 1 秒就自动跳升级
- 玩家没来得及看结果

#### 设计方案

**胜利面板增强**：

| 内容 | 数据来源 |
|------|---------|
| 🎉 **战斗胜利！** | 固定文字 |
| 金币 `+10` | `result.goldReward` |
| 所用回合 | `battleManager.turnCount` |
| 造成总伤害 | 需 `BattleManager` 累计 `_totalDamageDealt` |
| **"继续"按钮** | 玩家点击 → 进入升级界面 |

**流程改造**：
```
onBattleEnd(victory=true)
  → BattleUI.showVictory(gold, turnCount, totalDamage)
  → 显示胜利面板（含"继续"按钮）
  → 玩家点击"继续"
  → reviveAllUnits()
  → battleUI.hide() + gridController.hide()
  → showUpgradeScreen()
```

改动：
- `BattleManager.ts`：新增 `_totalDamageDealt` 累计字段 + getter
- `BattleUI.ts`：`showVictory` 改为带完整参数，暴露 `setVictoryContinueCallback`
- `TinyVanguardMain.ts`：`onBattleEnd` 中移除自动 `scheduleOnce`，绑定"继续"按钮点击事件

**战败界面**：
- 已实现 `defeatPanel` + "RestartButton"
- 保持不变

---

## 4. 数据流变化

### 4.1 布阵取消流程

```
玩家点击已放置卡片
  → TinyVanguardMain.onDeployCardTapped(index)
    → BattleManager.selectDeployUnit(index)
      → 单位已放置？→ 清除 pos，从 _deployedPositions 移除
      → 回调 onDeployUnitPlacedCallback(index, false) // cancelled
    → BattleUI.updateDeployItemState(index, false) // 取消灰色状态
```

### 4.2 胜利延遲流程

```
原来: onBattleEnd → scheduleOnce 1s → 升级
现在: onBattleEnd → showVictory → 等待点击 → 升级
```

---

## 5. 不变部分

以下功能/逻辑保持不变：
- 网格系统（`GridController`）
- 单位属性与战斗数值（`UnitController`）
- 技能效果引擎（`BattleManager.executeSkillEffects`）
- AI 决策与行动动画（`AIController`）
- 回合流转逻辑（`selectNextPlayerUnit` / `endPlayerTurn` / `finishAITurn`）
- 升级界面（`UpgradeUI`）
- 存档系统（`SaveManager`）
- 路线图系统（`RouteMapUI`）