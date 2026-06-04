# T1: AI 行为差异化

## 文件
`assets/games/game_tiny_vanguard/scripts/battle/AIController.ts`

## 当前问题
`AIController.executeEnemyTurn()` 对所有敌人都执行同一套逻辑：找最低血量目标 → 靠近 → 攻击。但 `GameData.ts` 中每种敌人定义了 `aiBehavior` 字段：

```typescript
aiBehavior: 'aggressive' | 'ranged' | 'defensive' | 'flanking'
```

这些行为从未被读取和使用。

## 改动要求

### 1. 读取 enemy 的 aiBehavior

`executeEnemyTurn` 中，每个 enemy 是 `UnitController`，其 `data.classId` 可以用来查找对应的 `EnemyConfig` 来获取 `aiBehavior`。但更简单的方式：直接给 `UnitController` 加一个 `data.aiBehavior` 字段，在 `initFromEnemyConfig` 时从配置复制。

或者更简单：在 `AIController` 中接受一个 `UnitController` 数组，每个 unit 的 `behavior` 可以通过某种方式获取。

**最佳方案**：给 `UnitData` 加 `aiBehavior: AIType` 字段，在 `UnitController.initFromEnemyConfig()` 中从 `config.aiBehavior` 赋值。然后在 `AIController` 中用 `enemy.data.aiBehavior` 做分支。

### 2. 实现四种行为

```typescript
switch (enemy.data.aiBehavior) {
  case 'aggressive':
    // 当前行为：找最近/最低血量目标，直线走过去打
    // （这已经是现有逻辑，保持不变）
    break;
    
  case 'ranged':
    // 远程弩手行为：
    // - 如果目标在射程内 → 攻击
    // - 如果目标太近（距离=1）→ 先拉开距离再攻击
    // - 否则靠近到射程边缘（不是贴脸）
    // 优先攻击血量最低的目标
    break;
    
  case 'defensive':
    // 盾兵行为：
    // - 如果有友方在相邻格且正在被攻击 → 移动到该友方旁边
    // - 否则就近攻击
    // - 移动范围减半（慢速坦克）
    break;
    
  case 'flanking':
    // 影刺行为：
    // - 尝试绕到目标背后（从与当前 facing 相反方向接近）
    // - 高移动力，优先打法师/牧师（低防御目标）
    // - 如果已经在目标背后 → 攻击
    break;
}
```

### 3. 改动范围

只改 2 个文件：
- `UnitController.ts` — `UnitData` 加 `aiBehavior: string` 字段，`initFromEnemyConfig` 中赋值
- `AIController.ts` — 按 `aiBehavior` 分支执行不同行为

## 不动
- `.scene` / `.prefab` / `.meta`
- `GameData.ts`（配置已经是正确的）
- `BattleManager.ts`
