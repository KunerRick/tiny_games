# Tiny Vanguard — 交互优化与战斗重写设计

**日期**: 2026-06-06
**版本**: v1.1
**状态**: 设计完成，待实现

---

## 1. 概述

本文档记录 Tiny Vanguard 的两个核心问题的修复设计：
1. **选队界面**：职业选择按钮的视觉高亮失效，交互逻辑不符合预期
2. **战斗系统**：布阵/行动流程与设计规格偏差大，AI 无视觉反馈

### 修复原则

- 选队界面：精准修复，最小改动
- 战斗系统：全面重写，拆小任务，对齐 FE 式回合制操作模式
- 场景/预制体修改：全部通过 `cocos-creator` MCP 工具操作，不直接编辑 JSON

---

## 2. 选队界面修复

### 2.1 根因

`setClassButtonVisual()` 中 `btnNode.getComponent(Sprite)` 在 Cocos Creator 中不会递归查找子节点。

Button 节点结构：
```
Class1Btn (Button)
  ├── Background (Sprite)   ← Sprite 在子节点
  └── Label
```

`getComponent(Sprite)` 返回 `null`，导致颜色设置静默失败。

### 2.2 修复方式

通过 Button 组件的 `target` 属性定位背景 Sprite：

```typescript
private setClassButtonVisual(btnNode: Node, selected: boolean): void {
    const btn = btnNode.getComponent(Button);
    if (!btn?.target) return;
    const sprite = btn.target.getComponent(Sprite);
    if (sprite) {
        sprite.color = selected ? SELECTED_COLOR : UNSELECTED_COLOR;
    }
}
```

### 2.3 交互逻辑

- 初始 4 职业按钮均未选中（无高亮），`_selectedClasses = []`
- 点击职业按钮 → 高亮为绿色 `#50C850`，`_selectedClasses` 添加该职业
- 再次点击已选中按钮 → 取消选中，恢复灰色 `#969696`
- 选中不足 3 个时"开始"按钮 `interactable = false`
- 选中正好 3 个时"开始"按钮可用
- 可选组合：4 选 3，任意组合

### 2.4 改动文件

| 文件 | 改动 |
|------|------|
| `scripts/TinyVanguardMain.ts` | 修改 `setClassButtonVisual` 和 `setupClassSelectionUI` 初始状态 |

---

## 3. 战斗系统全面重写

### 3.1 单位行动: 二维状态机

每个单位的行动拆分为两个步骤，严格按顺序执行：

```
状态图（每单位独立）:

       ┌──────────────────────────────────────┐
       │          选中该单位                    │
       │              ↓                        │
       │  ┌─→ MOVE_PHASE (可跳过)              │
       │  │    ↓ 点击移动范围   ↑ 点击自身      │
       │  │  执行移动           │ 跳过移动      │
       │  │    ↓                │              │
       │  └─→ ACTION_PHASE                     │
       │         ↓ 点击敌人/技能/等待           │
       │       ┌─┬──┬──┐                      │
       │       │  │  │  │                      │
       │     攻击 技能 等待 (3 选 1)            │
       │       │  │  │  │                      │
       │       └─┴──┴──┘                      │
       │         ↓                             │
       │        DONE                           │
       │         ↓                             │
       └─────────┤                             │
                 ↓                              │
         自动推进下一单位 ←──────────────────────┘
```

### 3.2 状态与高亮对照

| 阶段 | 高亮内容 | 颜色 | 用户操作 |
|------|---------|------|---------|
| `SELECTED` | 当前单位选中光环 | 蓝色(已有) | — |
| `MOVE_PHASE` | 可移动格子 | 绿色 `(100,200,100,180)` | 点击可移入格 或 点击自身跳过 |
| `ACTION_PHASE` | 可攻击敌人位置 | 红色 `(200,100,100,180)` | 点击敌人/技能按钮/等待按钮 |
| `skill_target` | 技能有效目标 | 黄色 `(255,200,50,200)` | 点击目标释放 |

### 3.3 规则细节

| 规则 | 说明 |
|------|------|
| 移动优先 | 必须先决定是否移动，再决定行动。不可先攻击再移动 |
| 跳过移动 | 单位已在攻击范围内 → 点击自身可跳过移动，直接进入 ACTION_PHASE |
| 不能移动时 | 被定身(HALT)时 MOVE_PHASE 显示 0 格范围，自动跳过 |
| 行动选择 | 移动后攻击/技能(需能量)/等待 三选一 |
| 自动推进 | 攻击或技能释放后 → 自动调用 `selectNextPlayerUnit()` 切换到下一单位 |
| 无目标可打 | 移动后发现没有可攻击目标 → ACTION_PHASE 中只显示"等待"按钮 |
| 无能量放技能 | 技能按钮全部不可点击（灰色），只显示"等待"按钮 |

### 3.4 布阵阶段（M1）

**行为**：
1. 进入战斗 → 网格可见，敌人在下半区（row 3-5）直接显示
2. 己方半场（row 0-1）格子高亮为可部署区（浅绿色）
3. 玩家 3 个单位处于"预备区"——棋盘左侧 col=-1 位置（已由 `createPlayerUnits` 创建）
4. 点击己方可部署空格 → 将该单位放到点击位置
5. 已部署的单位再次点击 → 取消旧位置，回到预备队列（可重新选择位置）
6. 3 个都放完 → "确认布阵"按钮从不可点击变为可点击
7. 点确认 → 进入 `player_turn`，第 1 回合

### 3.5 AI 回合重构（M2）

**核心模式变更**：AI 不直接执行伤害/移动，改为**返回决策意图**，由 `BattleManager` 统一调度执行。

```typescript
interface AIAction {
    moveTo: GridPosition;
    attackTarget: UnitController | null; // null = 不攻击/够不着
}
```

AIController 现有方法从 `executeXXX(...): void` 改为 `decide(enemy, players, allies, occupied): AIAction`。所有 4 种行为（aggressive/ranged/defensive/flanking）都返回 `AIAction`。

**动画序列方案**（Cocos Creator 中无协程，用 `scheduleOnce` + tween 回调链实现）：

```
executeEnemyTurn():
  1. _aiQueue ← 所有存活敌人
  2. _processNextAIUnit()

_processNextAIUnit():
  3. 从队列取一个敌人
  4. aiController.decide() → 拿到 AIAction
  5. enemy.moveToPositionAnimated(action.moveTo, 0.3s) → tween 移动到目标位置
     → tween.callback:
  6. if action.attackTarget:
     this.executeAttack(enemy, action.attackTarget) → 触发伤害回调
  7. scheduleOnce(0.5s) → 回到 step 3
  8. 队列空 → finishAITurn()

finishAITurn():
  9. checkBattleEnd() → victory/defeat
  10. 未结束 → 回合+1 → startPlayerTurn()
```

### 3.6 回合状态 UI（M3）

通过 `cocos-creator` MCP 在 BattleUI 场景节点下创建 3 个 Label：

| 节点名 | 父节点 | 位置 | 用途 | 内容示例 |
|--------|--------|------|------|---------|
| `PhaseLabel` | BattleUI 根 | `(0, 300)` | 当前阶段大标题 | "我方回合" / "敌方回合" |
| `UnitTurnLabel` | BattleUI 根 | `(0, 270)` | 当前操作单位 | "战士 (1/3)" |
| `ActionHintLabel` | BattleUI 根 | `(0, 240)` | 操作提示 | "点击可移动位置" |

通过 `@property(Label)` 在 BattleUI.ts 中引用。

阶段文字显示规则：

| BattlePhase | PhaseLabel | UnitTurnLabel | ActionHintLabel |
|------------|-----------|--------------|----------------|
| `deploy` | "布阵阶段" | "点击前两行放置单位" | — |
| `player_turn` | "我方回合 第X轮" | "职业名 (N/3)" | "点击移动" / "选择目标" |
| `enemy_turn` | "敌方回合" | "敌人行动中..." | — |
| `victory` / `defeat` | 已有面板 | — | — |

### 3.7 边界情况

| 场景 | 处理 |
|------|------|
| 移动后无攻击目标 | ACTION_PHASE 显示提示"无目标"，仅"等待"按钮可点 |
| 所有技能能量不足 | 技能按钮 `interactable = false`，仅"等待"可点 |
| 杀死最后一个敌人 | 立即 `onBattleEnd(victory=true)`，跳过剩余动画 |
| 敌方杀死最后一个玩家 | 立即 `onBattleEnd(victory=false)` |
| 单位被定身 | MOVE_PHASE 范围 0 格，自动进入 ACTION_PHASE |

---

## 4. 改动文件清单

| 文件 | 改动内容 | 估计行数 |
|------|---------|---------|
| `scripts/TinyVanguardMain.ts` | 选队修复 + 布阵配合调整 | ~40 |
| `scripts/battle/BattleManager.ts` | 状态机(状态分发) + AI 执行(动画序列) | ~350 |
| `scripts/battle/AIController.ts` | 改为决策返回模式 (`executeXXX` → `decide`) | ~30 |
| `scripts/battle/UnitController.ts` | 添加 `moveToPositionAnimated()` | ~30 |
| `scripts/ui/BattleUI.ts` | 添加阶段标签引用 + `updatePhase()` 方法 | ~80 |
| `scenes/TinyVanguard.scene` | 添加 PhaseLabel/UnitTurnLabel/ActionHintLabel（MCP） | — |

---

## 5. 实现顺序

```
1. 选队高亮修复 (TinyVanguardMain.ts)
2. UnitController: 添加 moveToPositionAnimated()
3. AIController: 重构为决策返回模式
4. BattleManager: 状态机重写 (MOVE→ACTION→DONE)
5. BattleUI: 添加阶段标签 (MCP 场景操作 + 脚本)
6. BattleManager: AI 回合执行 + 动画序列
7. 场景绑点: 挂载新 Label 的 @property
8. 完整流程测试
```

---

## 6. 复核验证步骤

### 6.1 选队界面
- [ ] 4 个职业按钮初始均无高亮，`_selectedClasses` 为空
- [ ] 点击按钮高亮绿，再次点击恢复灰
- [ ] 选中 3 个后"开始"按钮可用
- [ ] 取消选到不足 3 个时"开始"不可用
- [ ] 开始后进入路线图，队伍成员与所选一致

### 6.2 布阵阶段
- [ ] 敌人显示在棋盘下半区
- [ ] 己方半场格子有高亮
- [ ] 可部署格点击 → 单位放到目标格
- [ ] 已部署单位可取消重新选位置
- [ ] 3 个放完后确认按钮激活

### 6.3 玩家回合
- [ ] 选中单位显示绿色移动范围
- [ ] 点击移动范围 → 走到目标格
- [ ] 点击自身 → 跳过移动进入行动阶段
- [ ] 行动阶段显示红色可攻击敌人
- [ ] 点击敌人 → 攻击 + 伤害数字
- [ ] 攻击后自动推进下一单位
- [ ] 全部行动完毕自动进入敌方回合
- [ ] 显示 "敌方回合" 提示

### 6.4 AI 回合
- [ ] 敌人逐个行动，每个间隔 ~0.5s
- [ ] 移动有 tween 动画
- [ ] 攻击显示伤害数字
- [ ] 不同类型敌人行为差异（剑兵冲、弩手保持距离、盾兵保护、影刺绕后）
- [ ] 敌人杀死玩家 → 战斗失败
- [ ] 玩家杀光敌人 → 战斗胜利

### 6.5 回归
- [ ] 路线图节点可正常选择进入
- [ ] 商店/休息/事件面板正常
- [ ] 战斗胜利后可正常升级返回路线图
- [ ] `onDestroy` 事件解绑无泄漏
