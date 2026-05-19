# 战争进化 — 平衡性与体验优化设计

## 概述

对战争进化核心数值和体验问题的一次系统性修复，共 7 个优化项，全部纯代码实现，不修改 Cocos Creator 场景文件。

---

## 优化项 1：初始金币修正

**问题**：`WarEvo.ts` 字段声明 `_playerGold = 100`，但 `initGame()` 里硬编码为 `300`，两者不一致。

**修改文件**：`assets/games/game_war_evolution/scripts/WarEvo.ts`

**改动**：
- `initGame()` 中的 `_playerGold = 300` → `_playerGold = 100`
- AI 初始金币同样改为 `100`（在 AI 构造函数中统一，注释明确说明与玩家对称）

---

## 优化项 2：进化条件下调

**问题**：当前进化门槛（800/3000）偏高，普通对局难以进化到未来时代，爽感不足。

**新数值**：

| 时代 | 经验需求 | 金币需求 |
|------|----------|----------|
| 中世纪 | 400 | 400 |
| 未来 | 1500 | 1500 |

**修改文件**：`assets/games/game_war_evolution/scripts/GameConfig.ts`

**改动**：`AGE_CONFIGS` 数组中对应数值更新。

---

## 优化项 3：兵种视觉区分（颜色 + 大小）

**问题**：当前所有兵种外观统一为纯色方块，玩家无法快速识别敌方兵种类型。

**方案**：在阵营色（蓝/红）内部，按兵种分配不同的细分色调；同时按体型设定三档大小。

**颜色分配（阵营色内细分）**：

| 兵种 | 玩家色调 (RGB) | 敌方色调 (RGB) |
|------|----------------|----------------|
| 穴居人 | (68, 136, 255) 基准蓝 | (255, 68, 68) 基准红 |
| 猛犸 | (100, 80, 220) 紫蓝 | (220, 80, 80) 紫红 |
| 骑士 | (60, 180, 255) 天蓝 | (255, 100, 100) 橙红 |
| 弓箭手 | (80, 200, 120) 青绿 | (255, 140, 80) 橙 |
| 机甲 | (140, 100, 255) 紫 | (255, 100, 200) 粉红 |
| 激光兵 | (100, 220, 255) 亮青 | (255, 200, 80) 金黄 |

**大小分档**：

| 档位 | 兵种 | 缩放系数 |
|------|------|----------|
| 大型 | 猛犸、机甲 | 1.5× |
| 中型 | 穴居人、骑士、弓箭手 | 1.0×（基准） |
| 小型 | 激光兵 | 0.75× |

**修改文件**：`assets/games/game_war_evolution/scripts/Unit.ts` — `init()` 方法中按 `_config.id` 查表设置 `body.color` 和 `node.setScale()`。

**依赖**：在 `GameConfig.ts` 的 `UnitConfig` 接口中增加 `scale: number` 和 `tint: {r,g,b}` 字段，`UNIT_CONFIGS` 数组中补充对应值。

---

## 优化项 4：AI 镜像难度（隐性收入膨胀）

**问题**：AI 和玩家完全对称，中后期节奏单调。

**方案**：AI 收入在特定时代解锁后获得隐性倍率加成，玩家无感知。

| 条件 | AI 收入倍率 |
|------|-------------|
| 基础 | 1.0×（10/秒） |
| 中世纪解锁后 | 1.2×（12/秒） |
| 未来时代解锁后 | 1.4×（14/秒） |

**实现**：`WarEvo.ts` 的 `update()` 中，AI 加金币时根据 `_ai.getCurrentAge()` 乘以对应系数。

**修改文件**：`assets/games/game_war_evolution/scripts/WarEvo.ts`、`assets/games/game_war_evolution/scripts/AI.ts`

---

## 优化项 5：结算界面击杀数显示修复

**问题**：`UIController` 中 `killLabel` 变量名误导，实际显示的是累计经验而非击杀数。

**现象**：结算界面显示"击杀: 823"，其中 823 是经验值。

**修改文件**：`assets/games/game_war_evolution/scripts/UIController.ts`

**改动**：
- `updateTopBar()` 中 `killLabel` 改为显示真正的击杀数 `_playerKills`
- 新增一个 `expLabel` 显示当前经验进度条文案（或合并到进化条件显示中）
- `showGameOver()` 中 `statsLabel` 的"本局击杀"行使用正确的 `kills` 参数

---

## 优化项 6：激光聚焦视觉反馈

**问题**：激光兵的核心机制是"持续攻击同一目标伤害递增（最高2倍）"，但完全无视觉反馈。

**方案**：激光兵攻击时，目标单位头顶显示一个递增的数字或颜色变化，反映当前激光叠加倍率。

**具体设计**：
- 在 `Unit.ts` 中为激光兵目标添加一个子节点 Label（`_laserIndicator`），位于单位头顶
- 叠加 1.0× 时显示白色，1.5× 显示黄色，2.0× 显示红色并脉冲闪烁
- 切换目标时重置为白色

**修改文件**：`assets/games/game_war_evolution/scripts/Unit.ts`

---

## 优化项 7：机甲重设计

**问题**：800 金币定价过高导致出场率极低，定位模糊。

**新设计**：
- 价格：800 → **500 金币**
- HP：200（不变）
- 新增特性：**死亡自爆**
  - 死亡时对周围 100px 内所有敌方单位造成 **60 点范围伤害**
  - 视觉效果：死亡时产生一个扩散的红色圆圈动画（用 tween 扩大的 Sprite）

**修改文件**：
- `assets/games/game_war_evolution/scripts/GameConfig.ts` — `mech` 配置 cost: 800 → 500
- `assets/games/game_war_evolution/scripts/Unit.ts` — `performStomp()` 相邻位置增加 `performSelfDestruct()` 方法，在 `takeDamage()` 判断 HP ≤ 0 时触发

---

## 文件变更清单

| 文件 | 改动类型 |
|------|----------|
| `assets/games/game_war_evolution/scripts/GameConfig.ts` | 修改 |
| `assets/games/game_war_evolution/scripts/WarEvo.ts` | 修改 |
| `assets/games/game_war_evolution/scripts/AI.ts` | 修改 |
| `assets/games/game_war_evolution/scripts/Unit.ts` | 修改 |
| `assets/games/game_war_evolution/scripts/UIController.ts` | 修改 |

---

## 优先级排序

1. 优化项 1（初始金币）— 最简单，30 秒修完
2. 优化项 2（进化条件）— 改一个数组
3. 优化项 5（结算界面修复）— 改 UI 逻辑
4. 优化项 3（兵种视觉区分）— 较大，改动分布广
5. 优化项 4（AI 镜像难度）— 改两处
6. 优化项 6（激光视觉反馈）— 需新增子节点逻辑
7. 优化项 7（机甲重设计）— 需新增自爆逻辑和动画

---

## 测试验证

每项修改后需在 Cocos Creator 中运行验证：
1. 新游戏初始金币显示 100
2. 快速积累经验和金币，确认 400 时可进化到中世纪
3. 进化到中世纪后，AI 收入变为 12/秒（可通过击杀奖励倒推验证）
4. 对比同一屏幕内 6 个兵种的大小和颜色是否可辨识
5. 激光兵连续攻击同一目标，确认目标头顶有倍率指示
6. 机甲死亡时，周围敌方有可见的范围伤害反馈
