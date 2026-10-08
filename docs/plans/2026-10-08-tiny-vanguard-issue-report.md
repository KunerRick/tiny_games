# 小小先锋（Tiny Vanguard）场景与交互问题诊断

> 诊断日期：2026-10-08
> 方法：借助 Cocos MCP（`mcp-tool:cocos-creator/*`）读取真实场景 + 通读 `docs/` 相关设计/计划 + 只读代码审查。
> 用途：作为后续修复的输入清单。**行号基于诊断当时的代码，修改前请以实际文件为准。**

---

## 一、结论摘要

- **场景结构本身没有损坏**：`debug_validate_scene` 返回 `valid=true, issueCount=0`。
- **不存在"无引用的冗余节点"**：扫描 92 个节点，同名节点均为层级内正常重名；曾被怀疑冗余的两个 `VictoryPanel` 实际各有用途（见下）。
- **真正的问题集中在代码交互逻辑**（事件绑定、状态机守卫、续档数据、onDestroy 规范）与**少量命名混淆**。

---

## 二、场景侧核查（MCP 实测）

### 2.1 `VictoryPanel` 同名（非冗余，但易混淆）

场景里有两个同名节点，且**各被不同脚本引用**：

| 节点 | 路径 | 引用者 | 用途 |
|------|------|--------|------|
| `VictoryPanel` | `TinyVanguard/Canvas/BattleUI/VictoryPanel` (`6ecOflgc…`) | `BattleUI.victoryPanel` | **单场战斗胜利结算**（金币/回合/伤害 + `ContinueBtn`） |
| `VictoryPanel` | `TinyVanguard/Canvas/VictoryPanel` (`4f2uLD2J…`) | `TinyVanguardMain.victoryPanel` | **整轮通关结算**（打完 `boss` 节点后 `onRunComplete(true)`） |

- 两条流程都能在代码中验证：`TinyVanguardMain.ts:556-561` 战斗胜利调用 `battleUI.showVictory(...)`；`TinyVanguardMain.ts:575-578` 的 `onVictoryContinue()` 在 `_currentNode.type==='boss'` 时调用 `onRunComplete(true)` → 激活根级 `victoryPanel`（`TinyVanguardMain.ts:927-928`）。
- **因此二者不可删除。** 问题是**同名**，容易被误操作/误绑定。
- 建议（可选，纯整理）：根级节点重命名为 `RunVictoryPanel`，其下 `ContinueLabel` 同步；或保留但补充 `@property` tooltip 注明用途。

### 2.2 根级 `ContinueButton`

- `TinyVanguard/Canvas/ContinueButton` (`de1Yrrcw…`)，被 `TinyVanguardMain.continueButton`（`Button` 类型，`TinyVanguardMain.ts:58`）引用，用于"有存档时继续上局"入口（`TinyVanguardMain.ts:108-113` 绑定 `onContinueRun`）。
- **非冗余**。

### 2.3 其他

- `BattleUI.showVictory()` 会在运行时**动态创建** `ContinueBtn`/`GoldLabel`/`TurnCountLabel`/`DamageLabel` 子节点（`BattleUI.ts:132-185`），因此这些子节点在场景里不存在属预期。
- `BattleUI` 的子节点用 `ActionBar` 容器承载 `WaitButton`/`EndTurnButton`/`AttackButton`，三者均已挂 `cc.Button`。

---

## 三、代码交互缺陷清单

| # | 严重 | 位置 | 问题 | 建议 |
|---|------|------|------|------|
| 1 | 高 | `TinyVanguardMain.ts:441-453` | 续档恢复技能时**重复添加起始技能** | 续档恢复前先清空或去重 `skills` |
| 2 | 中 | `ui/EventUI.ts:58`、`ui/EventUI.ts:89` | 事件 handler 用**匿名 lambda**（违反 AGENTS 红线 #5，无法 `off` 解绑） | 改为命名方法并在 `hide()/onDestroy()` 解绑 |
| 3 | 中 | `TinyVanguardMain.onDestroy()`、`ui/UpgradeUI.onDestroy()`、`ui/EventUI.onDestroy()` | `onDestroy()` 中**访问 `@property(Node)`**（违反红线 #4，销毁时 getter 可能为 null） | 仅清 JS 引用，不触碰 `@property` 节点 |
| 4 | 中 | `TinyVanguardMain.ts` `onAttackSelected`/`onSkillUsed` | 缺 `_phase==='player_turn'` 的**显式守卫**，存在非玩家回合越权操作风险 | 入口处加 phase 守卫 |
| 5 | 中 | `ui/BattleUI.ts` `updatePhase` | 敌方回合/非行动阶段**未隐藏 `attackButton`** | `updatePhase` 中统一控制 `attackButton` 显隐 |
| 6 | 低 | `ui/RouteMapUI.ts` `completeNode` | 每次递归**全量重建**路线图节点（性能/闪烁） | 只更新受影响节点 |

> 说明：#1–#6 来自 2026-10-08 的只读代码审查子任务，对照 `AGENTS.md` 防崩溃守则与下列计划文档得出；#1 与状态机相关项建议修复前再复核行号。

---

## 四、对照历史计划：已落地项

以下在代码里**已确认落实**（本轮审查结论，非文档声称）：

- `docs/plans/2026-07-10-tiny-vanguard-fix.md` 的 Bug1–Bug5。
- `docs/plans/2026-07-15-tiny-vanguard-fix-all.md` 的任务 1/2/4/5/6。
- `docs/plans/2026-07-16-tiny-vanguard-ux-improvements.md` 的任务 1/2/4/5。

> 注意：上述 plans 文档中的步骤复选框多为**未勾选**，文档未记录完成状态；本清单以代码实际为准。

---

## 五、建议修复顺序

1. **#1 续档技能重复**（数据正确性，影响最大）。
2. **#3/#2 onDestroy 与事件解绑规范**（防崩溃红线）。
3. **#4/#5 状态机守卫与按钮显隐**（交互正确性）。
4. **#6 路线图性能**（体验）。
5. 场景侧命名整理（§2.1，可选）。

---

## 附：本次诊断用到的 MCP 工具

`scene_get_current_scene`、`scene_get_scene_hierarchy`、`debug_validate_scene`、`node_find_nodes`、`node_get_all_nodes`、`component_get_components`、`component_get_component_info`。

MCP 接入：项目级 `reasonix.toml` 中 `[[plugins]]` 声明 `cocos-creator`（`type=http`, `url=http://localhost:3000/mcp`）。
