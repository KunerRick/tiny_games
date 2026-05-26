# 猛犸践踏技能重做

## 现状问题

1. **首次遭遇不触发** — `_stompTimer` 初始化 8.0，猛犸进入战斗后需打满 8 秒才出第一次践踏
2. **绑定普攻节奏导致延迟** — 践踏检测嵌在 `tryAttack()` 内，受攻击间隔限制（猛犸攻速 0.6，间隔 ~1.67s），CD 归零后最多滞后 1.67s 才触发
3. **攻击城堡时无效** — 城堡路径走 `tryAttackCastle()`，没有践踏检测，但 `tickSkillCooldowns` 持续倒计时，CD 空转
4. **MOVING 状态计时器暂停** — `tickSkillCooldowns` 只在 `FIGHTING` 调用，猛犸移动期间 CD 不走，加剧间隔不均

## 目标行为

- 猛犸出生时践踏就绪（初始 CD = 0）
- 首次遇到敌人 → 立即触发践踏
- 触发后进入 8s CD
- CD 转好后，技能优先于普攻触发（有技能先放技能，再普攻）
- 践踏后重置普攻 CD（踩完立刻接一下普攻）
- 攻击城堡时也能正常触发践踏

## 改动方案

### 涉及文件

- `assets/games/game_war_evolution/scripts/Unit.ts`

### 改动 1：初始 CD 设为 0

```typescript
// 位置：Unit.init()，~line 90
// 改前
this._stompTimer = 8.0;
// 改后
this._stompTimer = 0;
```

### 改动 2：新增独立践踏检测方法

新增 `tryTriggerStomp()` 方法，取代原来内嵌在 `tryAttack()` 中的践踏检测：

```typescript
/**
 * 独立检测践踏触发条件
 * - CD 就绪且附近有敌人 → 践踏 + 重置普攻 CD
 * - 技能优先于普攻（踩完接普攻）
 * @returns 是否触发了践踏
 */
private tryTriggerStomp(allUnits: Unit[]): boolean {
    if (!this._config!.hasStomp || this._stompTimer > 0) return false;

    for (const u of allUnits) {
        if (u.getSide() === this._side || u.isDying()) continue;
        if (Math.abs(u.getX() - this.getX()) <= Unit.STOMP_RANGE) {
            this._stompTimer = 8.0;
            this.performStomp(allUnits);
            this._attackCooldown = 0;  // 重置普攻 CD → 踩完立刻接普攻
            return true;
        }
    }
    return false;
}
```

### 改动 3：集成到 `updateFighting` 开头

在 `updateFighting` 第一行调用 `tryTriggerStomp()`，覆盖单位战和城堡战两条路径：

```typescript
private updateFighting(dt: number, allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
    // 【新增】每帧先检查践踏
    this.tryTriggerStomp(allUnits);

    // 后续原逻辑不变（单位目标 → tryAttack / 城堡 → tryAttackCastle）
    if (this._target) {
        // ...
    } else {
        // ...
    }
}
```

### 改动 4：清理 `tryAttack` 中的旧践踏代码

移除 `tryAttack()` 末尾的践踏检测（原 ~line 483-487），功能已完全由 `tryTriggerStomp` 承担。

### 改动 5：`tickSkillCooldowns` 保持不动

`tickSkillCooldowns` 的逻辑无需修改——它负责 CD 倒计时，检测和触发已交给 `tryTriggerStomp`。MOVING 状态下 CD 暂停的行为保留（避免在非战斗状态无意义倒计时）。

## 效果对比

| 场景 | 改前 | 改后 |
|------|------|------|
| 首次战斗 | 等 8s 才踩 | 第一刀就踩 |
| CD 转好 | 等下次攻击间隔（最多 1.67s 延迟） | 下一帧立即践踏 |
| 践踏后行为 | 普攻间隔不变 | 重置普攻 CD，踩完立刻接普攻 |
| 攻击城堡时 | 践踏哑火，CD 空转 | 正常检测，有敌人在范围内就踩 |
| 整体节奏 | 间隔不均，时灵时不灵 | 稳定 8s 循环，技能优先 |

## 风险与注意事项

- **践踏后重置普攻 CD**：每 8s 多一次普攻（额外 ~4.4 DPS），猛犸单体输出略有提升，在数值预期范围内
- **`tryTriggerStomp` 调用在 `updateFighting` 开头**：践踏触发后 `_attackCooldown = 0`，后续 `tryAttack` 会立即接一次普攻，同帧完成"踩+拍"，不会造成攻击间隔错乱
- **没有任何 `.scene` / `.prefab` 修改**，纯脚本改动
