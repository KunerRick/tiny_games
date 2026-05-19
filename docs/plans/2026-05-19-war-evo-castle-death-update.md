# 战争进化史 - 城堡防御与死亡效果更新计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将城堡改为纯防御建筑（移除自动攻击），并改进单位死亡效果（颜色变暗+下沉+淡出）

**架构：** 
1. 移除 Castle.ts 中的攻击逻辑（tick 方法和相关辅助方法）
2. 修改 Unit.ts 的死亡动画，从缩放淡出改为颜色变暗+位置下沉+透明度淡出

**技术栈：** Cocos Creator 3.x, TypeScript

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `assets/games/game_war_evolution/scripts/Castle.ts` | 城堡组件：HP管理、受伤、血条显示 | 修改：移除 tick() 攻击逻辑和 findNearestTarget() 方法 |
| `assets/games/game_war_evolution/scripts/Unit.ts` | 单位组件：移动、战斗、死亡动画 | 修改：重写 startFadeOut() 方法，实现新的死亡效果 |
| `assets/games/game_war_evolution/scripts/WarEvo.ts` | 游戏主逻辑：驱动城堡 tick | 修改：移除对 castle.tick() 的调用 |

---

## 任务 1：移除城堡自动攻击逻辑

**文件：**
- 修改：`assets/games/game_war_evolution/scripts/Castle.ts`
- 修改：`assets/games/game_war_evolution/scripts/WarEvo.ts`

### 步骤 1.1：修改 Castle.ts - 移除攻击相关代码

- [ ] **找到并删除 tick 方法及其辅助方法**

在 Castle.ts 中，删除以下代码：

```typescript
// 删除第 24 行：攻击冷却字段
private _attackCooldown: number = 0;

// 删除第 33 行：在 init 方法中重置攻击冷却
this._attackCooldown = 0;

// 删除第 37-66 行：整个 tick 方法和 findNearestTarget 方法
public tick(dt: number, enemyUnits: Unit[]): void {
    if (this._isDead) return;

    this._attackCooldown -= dt;
    if (this._attackCooldown <= 0) {
        const target = this.findNearestTarget(enemyUnits);
        if (target) {
            // 城堡作为攻击者传入，但单位死亡时会识别为城堡击杀（无击杀奖励）
            target.takeDamage(CASTLE_CONFIG.ATTACK, this as unknown as Unit);
            this._attackCooldown = 1.0 / CASTLE_CONFIG.ATTACK_SPEED;
        }
    }
}

private findNearestTarget(units: Unit[]): Unit | null {
    const cx = this.node.position.x;
    let nearest: Unit | null = null;
    let minDist = CASTLE_CONFIG.ATTACK_RANGE;

    for (const u of units) {
        if (u.isDead()) continue;
        const dist = Math.abs(u.getX() - cx);
        if (dist <= CASTLE_CONFIG.ATTACK_RANGE && dist <= minDist) {
            minDist = dist;
            nearest = u;
        }
    }
    return nearest;
}
```

- [ ] **清理未使用的导入**

删除第 3 行对 Unit 的导入（如果 Castle.ts 不再直接使用 Unit）：
```typescript
// 删除
import { Unit } from './Unit';
```

注意：如果 takeDamage 的参数类型仍然引用 Unit，则保留导入。

### 步骤 1.2：修改 WarEvo.ts - 移除城堡 tick 调用

- [ ] **找到并删除城堡 tick 调用**

在 WarEvo.ts 中，找到类似以下的代码并删除：

```typescript
// 删除对城堡 tick 的调用，例如：
this._playerCastle.tick(dt, this._enemyUnits);
this._enemyCastle.tick(dt, this._playerUnits);
```

具体代码位置需要查看 WarEvo.ts 确认。

---

## 任务 2：改进单位死亡效果

**文件：**
- 修改：`assets/games/game_war_evolution/scripts/Unit.ts`

### 步骤 2.1：重写 startFadeOut 方法

- [ ] **替换现有的 startFadeOut 方法**

找到第 501-520 行的 `startFadeOut` 方法，替换为以下代码：

```typescript
/** 开始死亡淡出 - 颜色变暗 + 下沉 + 透明度淡出 */
private startFadeOut(): void {
    if (this._isFading || !this.node?.isValid) return;
    this._isFading = true;

    // 停止之前的 tween
    if (this._fadeTween) {
        this._fadeTween.stop();
        this._fadeTween = null;
    }

    // 获取当前位置和颜色
    const startX = this.node.position.x;
    const startY = this.node.position.y;
    const endY = startY - 15; // 向下移动 15 像素（倒地效果）

    // 颜色变暗：从原色变为深灰色
    const deadColor = new Color(80, 80, 80, 255);
    if (this.body) {
        this.body.color = deadColor;
    }

    // 使用 tween 实现下沉 + 淡出
    // 注意：Sprite 的透明度通过 color.a 控制
    this._fadeTween = tween(this.node)
        .to(0.3, { position: new Vec3(startX, endY, 0) }, { easing: 'quadOut' }) // 下沉
        .delay(0.5) // 停留片刻
        .call(() => {
            // 淡出透明度
            if (this.body) {
                tween(this.body.color)
                    .to(0.7, { a: 0 }, { easing: 'linear' })
                    .call(() => {
                        this._isFading = false;
                        this._fadeTween = null;
                    })
                    .start();
            }
        })
        .start();
}
```

### 步骤 2.2：确保 body 属性有效

- [ ] **检查 body 属性的类型**

确保 `body` 属性是 `Sprite` 类型，这样才能通过 `body.color` 控制颜色和透明度。

在 Unit.ts 第 15-16 行确认：
```typescript
@property(Sprite)
body: Sprite | null = null;             // 单位身体色块（预制体 -> body）
```

---

## 任务 3：验证修改

### 步骤 3.1：TypeScript 编译检查

- [ ] **运行 Cocos Creator 的 TypeScript 编译**

在 Cocos Creator 编辑器中打开项目，检查控制台是否有编译错误。

预期结果：无编译错误。

### 步骤 3.2：功能验证

- [ ] **验证城堡不再攻击**

1. 运行游戏
2. 观察敌方单位接近玩家城堡时，城堡不会发射攻击
3. 玩家单位接近敌方城堡时，敌方城堡也不会攻击

- [ ] **验证新的死亡效果**

1. 让单位死亡（通过战斗）
2. 观察死亡动画：
   - 单位颜色变为深灰色
   - 单位向下移动（倒地）
   - 停留片刻后淡出消失

---

## 自检清单

- [ ] Castle.ts 中的 `tick` 方法已完全删除
- [ ] Castle.ts 中的 `findNearestTarget` 方法已完全删除
- [ ] Castle.ts 中的 `_attackCooldown` 字段已删除
- [ ] WarEvo.ts 中对城堡 `tick` 的调用已删除
- [ ] Unit.ts 中的 `startFadeOut` 方法已重写为新的死亡效果
- [ ] 所有 TypeScript 编译通过
- [ ] 游戏运行时城堡不自动攻击
- [ ] 单位死亡时显示新的动画效果
