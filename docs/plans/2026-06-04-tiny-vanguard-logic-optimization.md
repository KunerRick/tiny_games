# Tiny Vanguard 逻辑代码优化任务

> 本任务由 Hermes 规划，OpenCode 执行。
> **只修改 `.ts` 逻辑代码**，不动 `.scene` / `.prefab` / `.meta`。

---

## 优化目标

修复 3 个核心逻辑问题，不引入新功能（不改场景、不改 UI 绑定、不改配置数据）。

---

## 🔴 任务 A：升级系统支持多单位选择

**文件**: `TinyVanguardMain.ts`
**接口文件**: `GameData.ts`, `UpgradeUI.ts`

### 当前问题
- `generateUpgradeOptions()` 只从 `playerUnits[0]` 生成升级选项
- `applyUpgrade()` 永远把技能加给 `playerUnits[0]`
- 3 人小队另外 2 个单位永远不会获得技能

### 改动要求

#### A1. 修改 `generateUpgradeOptions()` 签名和逻辑

```typescript
// 原: generateUpgradeOptions(): UpgradeOption[]
// 改为:
generateUpgradeOptions(): UpgradeOption[][] {
  // 为每个存活单位生成独立的 3 个升级选项
  // 返回二维数组: unitIndex → UpgradeOption[]
}
```

每个单位的选项池逻辑：
1. 从该单位职业的 `skillPool` 中随机抽 3 个技能
2. 如果该单位已有技能数 >= 3（起始 + 2 升级槽），标记为"替换"模式
3. 最后附加一个该单位的数值 Buff（`+1 最大血量` / `+1 攻击` / `+1 能量上限` 随机）
4. 从 4 个候选(3 技能 + 1 buff)中随机选 3 个展示

#### A2. 修改 `UpgradeUI.ts` — 支持多组卡片

`showUpgradeOptions()` 改为接受二维选项数组，在界面上：
- 显示当前是"为哪个单位升级"的标题（比如"为战士选技能"）
- 每单位一组 3 张卡片
- 用户选择后自动切换到下一单位/关闭

#### A3. 修改 `applyUpgrade()` 

改为接受 `(unitIndex: number, optionIndex: number)`，将技能/Buff 应用到对应单位的对应单位。

#### A4. 修改 `TinyVanguardMain.ts` 中的调用端

`showUpgradeScreen()` 中：
1. 生成所有单位的选项
2. 逐个展示给用户选择
3. 所有单位选择完成后返回路线图

---

## 🔴 任务 B：技能效果执行引擎

**文件**: `BattleManager.ts`
**接口文件**: `GameData.ts`（已经有 `SkillEffect.type` 定义）

### 当前问题
所有技能使用 `executeAttack()` 做基础攻击，但 GameData 定义了 20+ 种 `SkillEffect.type`，只有 `damage` 和 `damage_multiplier` 被部分实现。

### 改动要求

在 `BattleManager.ts` 中新增（或重构）一个方法：

```typescript
/**
 * 执行技能效果列表
 * @param caster 施法者 UnitController
 * @param target 目标 UnitController（如果是单目标技能）
 * @param targetPos 目标格子位置（如果是范围/格子技能）
 * @param effects SkillEffect[] 要执行的效果列表
 */
private executeSkillEffects(
  caster: UnitController,
  target: UnitController | null,
  targetPos: GridPosition | null,
  effects: SkillEffect[]
): void
```

必须支持的效果类型（逐个实现）：

| effect type | 行为 |
|---|---|
| `damage` | 基础伤害，`params.amount` 扣血，经过防御减免 |
| `damage_multiplier` | 伤害 = 攻击力 × `params.multiplier`，经防御减免 |
| `heal` | 恢复 `params.amount` 血量 |
| `ignore_defense` | 如果 `params.value === 1`，本次伤害无视防御 |
| `multi_attack` | 重复攻击 `params.count` 次，每次伤害 × `params.multiplier` |
| `aoe_adjacent` | 对施法者相邻的所有敌方造成 攻击×`params.multiplier` 伤害 |
| `aoe_3x3` | 对目标位置 3×3 范围内所有敌方造成 攻击×`params.multiplier` 伤害 |
| `aoe_1radius` | 对目标周围 1 格 AOE，伤害 攻击×`params.multiplier` |
| `aoe_heal` | 对以目标为中心的 `params.radius` 格内所有友方恢复 `params.amount` 血量 |
| `execute` | 如果目标血量百分比 < `params.threshold`，伤害 = 攻击×`params.multiplier`，否则正常伤害 |
| `knockback` | 击退目标 `params.distance` 格（朝施法者反方向） |
| `buff_attack` | 目标（通常是自己或友方）获得攻击力加成 `params.amount`，持续 `params.duration` 回合 |
| `buff_move` | 目标获得移速加成 `params.amount`，持续 `params.duration` 回合 |
| `mark` | 目标受伤加深 `params.amount`，持续 `params.duration` 回合 |
| `immobilize` | 目标定身 `params.duration` 回合（不能移动） |
| `shield` | 目标获得 `params.amount` 护盾，持续 `params.duration` 回合 |
| `chain` | 主目标伤害，然后连锁攻击最近 `params.chainCount` 个其他敌人，伤害 × `params.multiplier` |
| `teleport` | 目标（自己）瞬移到 `targetPos`（需在外面传 targetPos 参数） |
| `buff_next_skill` | 下一次技能伤害 × `params.multiplier` |
| `retreat` | 攻击后向后移动 `params.distance` 格 |

**伤害计算公式统一为**：
```
实际伤害 = max(1, 攻击力 × 倍率 - 目标防御力)
```
如果有效果包含 `ignore_defense`，则：
```
实际伤害 = max(1, 攻击力 × 倍率)
```

**连锁已有回调**：
- 每次造成伤害时，调用 `this._onDamageDealtCallback(target.node, actualDamage)`
- 每次治疗时，如果已有回调机制可扩展，否则先不加

**护盾系统**（重要）：
- 在 `UnitData` 中已有 `buffs`，护盾可以作为特殊的 buff 类型
- 受到伤害时：先扣护盾（shield amount），护盾归零后扣血
- 在 `UnitController.takeDamage()` 中实现护盾抵扣逻辑

---

## 🔴 任务 C：被动技能触发机制

**文件**: `UnitController.ts`, `BattleManager.ts`

### 当前问题
GameData 中定义了 6 个被动技能（counter, toughness, eagle_eye, poison_arrows, arcane_flow, aura_of_blessing），但代码中没有任何触发器检查或执行被动效果。

### 改动要求

#### C1. 在 `UnitController.ts` 中：

**C1a. 在 `onTurnStart()` 末尾添加被动检查**
```
遍历单位当前所有技能（skills）
  如果技能是 passive 类型：
    根据 triggerCondition 调用对应效果
```

具体触发点：
- `on_turn_start` → 在 `onTurnStart()` 中遍历被动技能并应用效果
  - `toughness`: 永久 +1 最大血量、+1 防御（仅在首次应用，用 flag 标记避免重复）
  - `eagle_eye`: 射程 +1（同样首次应用标记）
  - `arcane_flow`: 能量回复 +1（修改 `energyRegen`）
  - `aura_of_blessing`: 周围 1 格友方回血（调用 `heal()`）

**C1b. 在 `takeDamage()` 中添加反击检查**
```
如果攻击者不为空且单位有 'counter' 技能（on_hit 触发条件）：
  对攻击者造成 攻击力 × 0.5 的反击伤害
```

#### C2. 新的触发点

在 `BattleManager.executeAttack()` 中调用攻击后回调：
```
在成功造成伤害后，除了通知 UI，还需要触发攻击者的 on_attack 被动：
  - poison_arrows: 对目标施加中毒 debuff（每回合 1 伤害，持续 2 回合）
```

在 `onTurnStart()` 中处理 debuff 伤害：
```
遍历单位的 buffs，如果有 poison 类型的，每回合开始时扣血
```

---

## 实施注意事项

1. **不要修改 `GameData.ts`** — 配置数据已经是正确的
2. **不要修改 `.scene` / `.prefab` / `.meta` 文件**
3. **遵循 Cocos Creator 防崩溃守则**（AGENTS.md 中的规则）
4. **不要改接口文件名和类名** — 保持现有导出名
5. **每个修改完成后，检查 TypeScript 语法正确性**（如果 Cocos 编辑器/TS 编译可用）

## 验证方式

任务完成后可以在 Cocos Creator 编辑器中：
1. 打开 TinyVanguard 场景
2. 检查 Console 无报错
3. 检查 TypeScript 编译无错误
