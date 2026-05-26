# 猛犸践踏技能优化 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让猛犸践踏技能独立于普攻节奏触发，初始就绪、技能优先、重置普攻 CD。

**架构：** 在 `Unit` 类中新增 `tryTriggerStomp()` 方法，每帧在 `updateFighting()` 开头独立检测践踏条件；修改初始化 CD 为 0；从 `tryAttack()` 移除旧检测；清理注释。

**技术栈：** TypeScript / Cocos Creator

**规格文件：** `docs/specs/2026-05-26-mammoth-stomp-redesign.md`

---

### 任务 1：实现独立践踏触发

**文件：**
- 修改：`assets/games/game_war_evolution/scripts/Unit.ts`

- [ ] **步骤 1：初始化 CD 改为 0**

修改 `init()` 中 `_stompTimer` 的初始值：

```typescript
// 改前
this._stompTimer = 8.0; // 践踏初始满 CD，战斗中倒计时

// 改后
this._stompTimer = 0; // 践踏初始就绪，遇到敌人立即触发
```

- [ ] **步骤 2：新增 `tryTriggerStomp()` 方法**

在 `tickSkillCooldowns()` 方法之后（~line 522）插入新方法：

```typescript
/**
 * 独立检测践踏触发
 * - CD 就绪 + 附近有敌人 → 践踏 + 重置普攻 CD
 * - 技能优先于普攻，踩完立刻接普攻
 * @returns 是否触发了践踏
 */
private tryTriggerStomp(allUnits: Unit[]): boolean {
    if (!this._config!.hasStomp || this._stompTimer > 0) return false;

    for (const u of allUnits) {
        if (u.getSide() === this._side || u.isDying()) continue;
        if (Math.abs(u.getX() - this.getX()) <= Unit.STOMP_RANGE) {
            this._stompTimer = 8.0;
            this.performStomp(allUnits);
            this._attackCooldown = 0;
            return true;
        }
    }
    return false;
}
```

- [ ] **步骤 3：在 `updateFighting()` 开头调用**

在 `updateFighting` 方法的第一行（~line 316）添加践踏检测：

```typescript
private updateFighting(dt: number, allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
    // 【新增】每帧先检查践踏 —— 技能优先于普攻
    this.tryTriggerStomp(allUnits);

    // 如果目标是单位
    if (this._target) {
        // ... 后续代码不变
```

- [ ] **步骤 4：从 `tryAttack()` 移除旧的践踏检测**

在 `tryAttack()` 方法末尾（~line 483-487）删除以下代码块：

```typescript
        // 猛犸践踏：CD 由 tick 管理，这里只判断是否触发
        if (cfg.hasStomp && this._stompTimer <= 0) {
            this._stompTimer = 8.0; // 重置 CD
            this.performStomp(allUnits);
        }
```

同时清理相关的注释（如果有）。

- [ ] **步骤 5：LSP 诊断验证**

运行 LSP 诊断检查改后的文件是否有类型/语法错误：

```
检查 Unit.ts 无报错
```

- [ ] **步骤 6：清理（移除不再需要的 import / 变量）**

检查 `tryAttack` 中的 `cfg` 变量在其他位置是否仍被使用（`hasCharge`, `hasLaserFocus`, `attack` 等），如果是则保留，否则清理。
