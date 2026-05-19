# 战争进化 — 平衡性与体验优化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 对战争进化的 7 个优化项进行代码实现，纯逻辑修改，不碰 Cocos Creator 场景文件。

**架构：** 在现有 `GameConfig.ts` 中扩展兵种配置字段（颜色/大小），在 `Unit.ts` 中实现视觉区分和激光聚焦指示器，在 `WarEvo.ts`/`AI.ts` 中实现 AI 镜像难度膨胀，在 `UIController.ts` 中修复击杀显示。

---

## 文件变更总览

| 文件 | 改动类型 | 职责 |
|------|----------|------|
| `assets/games/game_war_evolution/scripts/GameConfig.ts` | 修改 | 进化条件数值、机甲价格、兵种视觉配置字段 |
| `assets/games/game_war_evolution/scripts/WarEvo.ts` | 修改 | 初始金币修正、AI 收入时代膨胀 |
| `assets/games/game_war_evolution/scripts/AI.ts` | 修改 | 暴露 getCurrentAge() 供外部读取当前时代 |
| `assets/games/game_war_evolution/scripts/Unit.ts` | 修改 | 颜色/大小设置、激光聚焦视觉、自爆逻辑 |
| `assets/games/game_war_evolution/scripts/UIController.ts` | 修改 | 结算界面击杀数正确显示 |

---

## 任务 1：初始金币修正 + 进化条件下调

**文件：** 修改 `GameConfig.ts` 和 `WarEvo.ts`

- [ ] **步骤 1：修改 AGE_CONFIGS 进化条件**

打开 `assets/games/game_war_evolution/scripts/GameConfig.ts`，找到 `AGE_CONFIGS` 数组，替换为：

```typescript
export const AGE_CONFIGS: AgeConfig[] = [
    { age: Age.PRIMITIVE, name: '原始时代', expRequired: 0, goldRequired: 0, goldReserve: 0, unitIds: ['caveman', 'mammoth'] },
    { age: Age.MEDIEVAL, name: '中世纪', expRequired: 400, goldRequired: 400, goldReserve: 200, unitIds: ['knight', 'archer'] },
    { age: Age.FUTURE, name: '未来时代', expRequired: 1500, goldRequired: 1500, goldReserve: 200, unitIds: ['mech', 'laser'] },
];
```

- [ ] **步骤 2：修改机甲价格**

在同一文件中找到 `mech` 配置，将 `cost: 800` 改为 `cost: 500`：

```typescript
{
    id: 'mech', name: '机甲', cost: 500,
    hp: 200, attack: 80, attackSpeed: 0.8, moveSpeed: 90,
    attackRange: 40, age: Age.FUTURE, desc: '能量护盾',
    hasShield: true,
},
```

- [ ] **步骤 3：修正 WarEvo.ts 初始金币**

打开 `assets/games/game_war_evolution/scripts/WarEvo.ts`，在 `initGame()` 方法中将：
```typescript
this._playerGold = 300;
```
改为：
```typescript
this._playerGold = 100;
```

- [ ] **步骤 4：Commit**
```bash
git add assets/games/game_war_evolution/scripts/GameConfig.ts assets/games/game_war_evolution/scripts/WarEvo.ts
git commit -m "feat(war-evo): correct initial gold to 100 and adjust evolution thresholds"
```

---

## 任务 2：兵种视觉区分（颜色 + 大小）

**文件：** 修改 `GameConfig.ts` 和 `Unit.ts`

- [ ] **步骤 1：在 UnitConfig 接口中增加视觉字段**

打开 `assets/games/game_war_evolution/scripts/GameConfig.ts`，在 `UnitConfig` 接口末尾添加两个字段：

```typescript
export interface UnitConfig {
    id: string;
    name: string;
    cost: number;
    hp: number;
    attack: number;
    attackSpeed: number;
    moveSpeed: number;
    attackRange: number;
    age: Age;
    desc: string;
    hasStomp?: boolean;
    hasCharge?: boolean;
    hasShield?: boolean;
    hasLaserFocus?: boolean;
    // 新增：视觉配置
    scale: number;                   // 缩放系数，基准为 1.0
    tint: { r: number; g: number; b: number }; // 阵营色内的细分色调
}
```

- [ ] **步骤 2：为每个兵种补充视觉配置**

找到 `UNIT_CONFIGS` 数组，逐个添加 `scale` 和 `tint` 字段。注意 `tint` 是在阵营色（蓝/红）基础上的细分，不是独立颜色：

```typescript
export const UNIT_CONFIGS: UnitConfig[] = [
    // 原始时代
    {
        id: 'caveman', name: '穴居人', cost: 15,
        hp: 35, attack: 15, attackSpeed: 1.0, moveSpeed: 80,
        attackRange: 30, age: Age.PRIMITIVE, desc: '廉价近战',
        scale: 1.0,
        tint: { r: 68, g: 136, b: 255 },   // 基准蓝
    },
    {
        id: 'mammoth', name: '猛犸', cost: 80,
        hp: 120, attack: 35, attackSpeed: 0.6, moveSpeed: 60,
        attackRange: 35, age: Age.PRIMITIVE, desc: '重型践踏',
        hasStomp: true,
        scale: 1.5,
        tint: { r: 100, g: 80, b: 220 },   // 紫蓝
    },
    // 中世纪
    {
        id: 'knight', name: '骑士', cost: 200,
        hp: 90, attack: 50, attackSpeed: 1.0, moveSpeed: 110,
        attackRange: 30, age: Age.MEDIEVAL, desc: '冲锋击退',
        hasCharge: true,
        scale: 1.0,
        tint: { r: 60, g: 180, b: 255 },   // 天蓝
    },
    {
        id: 'archer', name: '弓箭手', cost: 60,
        hp: 25, attack: 30, attackSpeed: 1.5, moveSpeed: 80,
        attackRange: 200, age: Age.MEDIEVAL, desc: '远程攻击',
        scale: 1.0,
        tint: { r: 80, g: 200, b: 120 },   // 青绿
    },
    // 未来时代
    {
        id: 'mech', name: '机甲', cost: 500,
        hp: 200, attack: 80, attackSpeed: 0.8, moveSpeed: 90,
        attackRange: 40, age: Age.FUTURE, desc: '能量护盾',
        hasShield: true,
        scale: 1.5,
        tint: { r: 140, g: 100, b: 255 },   // 紫
    },
    {
        id: 'laser', name: '激光兵', cost: 350,
        hp: 50, attack: 45, attackSpeed: 1.2, moveSpeed: 95,
        attackRange: 260, age: Age.FUTURE, desc: '聚焦射击',
        hasLaserFocus: true,
        scale: 0.75,
        tint: { r: 100, g: 220, b: 255 },  // 亮青
    },
];
```

- [ ] **步骤 3：在 Unit.ts init() 中应用颜色和大小**

打开 `assets/games/game_war_evolution/scripts/Unit.ts`，在 `init()` 方法中找到设置 body 颜色的位置（大约在第 93-96 行），将：

```typescript
if (this.body) {
    const color = side === 'player' ? UNIT_COLORS.PLAYER : UNIT_COLORS.ENEMY;
    this.body.color = new Color(color.r, color.g, color.b);
}
```

替换为：

```typescript
if (this.body) {
    // 阵营基准色与兵种细分色调混合
    const base = side === 'player' ? UNIT_COLORS.PLAYER : UNIT_COLORS.ENEMY;
    const tint = this._config!.tint;
    // 混合比例：60% 阵营色 + 40% 兵种色调
    const r = Math.round(base.r * 0.6 + tint.r * 0.4);
    const g = Math.round(base.g * 0.6 + tint.g * 0.4);
    const b = Math.round(base.b * 0.6 + tint.b * 0.4);
    this.body.color = new Color(r, g, b);
}

// 应用大小缩放
const scale = this._config!.scale;
this.node.setScale(scale, scale, 1);
```

- [ ] **步骤 4：Commit**
```bash
git add assets/games/game_war_evolution/scripts/GameConfig.ts assets/games/game_war_evolution/scripts/Unit.ts
git commit -m "feat(war-evo): add unit visual differentiation (tint color + scale)"
```

---

## 任务 3：AI 镜像难度（时代收入膨胀）

**文件：** 修改 `AI.ts` 和 `WarEvo.ts`

- [ ] **步骤 1：在 AI.ts 中暴露 getCurrentAge() 方法**

打开 `assets/games/game_war_evolution/scripts/AI.ts`，确认已存在 `getCurrentAge()` 方法（当前已存在，第 31 行），无需改动。

在 `AI.ts` 末尾追加一个辅助函数用于计算收入倍率（放在文件最后，类的外面）：

```typescript
/** 根据 AI 当前时代返回收入倍率 */
export function getAIIncomeMultiplier(age: Age): number {
    switch (age) {
        case Age.PRIMITIVE: return 1.0;
        case Age.MEDIEVAL:   return 1.2;
        case Age.FUTURE:     return 1.4;
        default:             return 1.0;
    }
}
```

- [ ] **步骤 2：在 WarEvo.ts 中应用时代收入倍率**

打开 `assets/games/game_war_evolution/scripts/WarEvo.ts`，在文件顶部 import 区添加：

```typescript
import { getAIIncomeMultiplier } from './AI';
```

找到 `update()` 方法中的金币增长逻辑，将：
```typescript
this._goldTimer += dt;
while (this._goldTimer >= 1.0) {
    this._goldTimer -= 1.0;
    this._playerGold += GOLD_INCOME.PLAYER;
    this._ai?.addGold(GOLD_INCOME.AI);
}
```

替换为：

```typescript
this._goldTimer += dt;
while (this._goldTimer >= 1.0) {
    this._goldTimer -= 1.0;
    this._playerGold += GOLD_INCOME.PLAYER;
    if (this._ai) {
        const aiAge = this._ai.getCurrentAge();
        const multiplier = getAIIncomeMultiplier(aiAge);
        this._ai.addGold(Math.round(GOLD_INCOME.AI * multiplier));
    }
}
```

- [ ] **步骤 3：Commit**
```bash
git add assets/games/game_war_evolution/scripts/AI.ts assets/games/game_war_evolution/scripts/WarEvo.ts
git commit -m "feat(war-evo): add AI income scaling by age (1.0x/1.2x/1.4x)"
```

---

## 任务 4：结算界面击杀数显示修复

**文件：** 修改 `UIController.ts`

- [ ] **步骤 1：理解当前问题**

`UIController.ts` 的 `updateTopBar()` 中，`killLabel` 实际显示的是 exp，变量名和注释都是错的。`showGameOver()` 中的 statsLabel 引用了正确的 `kills` 参数，但显示逻辑没有问题。

需要修复的是 `updateTopBar()` 中 killLabel 的误导性命名和显示内容，以及 `showGameOver()` 中的 label 显示。

打开 `assets/games/game_war_evolution/scripts/UIController.ts`。

- [ ] **步骤 2：修复 updateTopBar() 中的 killLabel**

找到 `updateTopBar()` 方法（约第 169-174 行），将：

```typescript
if (this.killLabel) {
    this.killLabel.string = expRequired > 0
        ? `击杀: ${exp}/${expRequired}`
        : `击杀: ${exp} (已满级)`;
}
```

改为：

```typescript
if (this.killLabel) {
    // 显示真正的击杀数；经验进度合并到进化按钮中
    this.killLabel.string = `击杀: ${kills}`;
}
```

注意：`updateTopBar()` 的函数签名中需要增加 `kills: number` 参数，否则无法访问击杀数。

- [ ] **步骤 3：更新 updateTopBar() 签名**

找到 `updateTopBar()` 的方法签名（约第 153 行），在参数列表末尾添加 `kills: number`：

```typescript
public updateTopBar(
    gold: number,
    age: Age,
    exp: number,
    expRequired: number,
    playerHP: number,
    playerMaxHP: number,
    enemyHP: number,
    enemyMaxHP: number,
    kills: number,  // 新增
): void {
```

- [ ] **步骤 4：更新 WarEvo.ts 中的调用处**

打开 `assets/games/game_war_evolution/scripts/WarEvo.ts`，找到 `updateUI()` 方法中调用 `updateTopBar()` 的地方，将：

```typescript
this.uiController?.updateTopBar(
    this._playerGold,
    this._playerAge,
    this._playerExp,
    nextAge?.expRequired ?? 0,
    this.castlePlayer?.getHP() ?? 0,
    this.castlePlayer?.getMaxHP() ?? 1,
    this.castleEnemy?.getHP() ?? 0,
    this.castleEnemy?.getMaxHP() ?? 1,
);
```

改为（在末尾添加 `this._playerKills`）：

```typescript
this.uiController?.updateTopBar(
    this._playerGold,
    this._playerAge,
    this._playerExp,
    nextAge?.expRequired ?? 0,
    this.castlePlayer?.getHP() ?? 0,
    this.castlePlayer?.getMaxHP() ?? 1,
    this.castleEnemy?.getHP() ?? 0,
    this.castleEnemy?.getMaxHP() ?? 1,
    this._playerKills,
);
```

- [ ] **步骤 5：Commit**
```bash
git add assets/games/game_war_evolution/scripts/UIController.ts assets/games/game_war_evolution/scripts/WarEvo.ts
git commit -m "fix(war-evo): correct killLabel to display actual kill count"
```

---

## 任务 5：激光聚焦视觉反馈

**文件：** 修改 `Unit.ts`

- [ ] **步骤 1：在 Unit 类中添加激光指示器子节点相关字段**

打开 `assets/games/game_war_evolution/scripts/Unit.ts`，在类的顶部运行时状态字段区（`private _laserFocus: number = 1.0;` 附近），添加：

```typescript
private _laserIndicator: Node | null = null;  // 头顶叠加指示器节点
private _laserLabel: Label | null = null;    // 叠加倍率文字
```

- [ ] **步骤 2：在 init() 中创建激光指示器节点**

在 `init()` 方法末尾（`this.updateHPBar();` 之后），添加：

```typescript
// 只有激光兵需要叠加指示器
if (config.hasLaserFocus) {
    const indicatorNode = new Node('laserIndicator');
    indicatorNode.setParent(this.node);
    indicatorNode.setPosition(0, 40, 0);  // 头顶 40px
    const label = indicatorNode.addComponent(Label);
    label.string = '1.0×';
    label.fontSize = 14;
    label.color = Color.WHITE.clone();
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    this._laserIndicator = indicatorNode;
    this._laserLabel = label;
}
```

需要确保 import 中有 `Node` 和 `Label`（当前已有 `Node` 导入，需要确认 `Label`）。

- [ ] **步骤 3：更新激光聚焦更新逻辑**

找到 `tryAttack()` 方法中激光聚焦相关的代码（约第 396-404 行）：

```typescript
if (cfg.hasLaserFocus) {
    if (target.getUnitId() !== this._laserTargetId) {
        this._laserFocus = 1.0;
        this._laserTargetId = target.getUnitId();
    }
    this._laserFocus = Math.min(this._laserFocus + 0.15, 2.0);
    damage = Math.round(damage * this._laserFocus);
}
```

在方法末尾添加更新指示器的逻辑：

```typescript
// 更新激光聚焦视觉
if (this._laserLabel && this._laserIndicator) {
    const mult = Math.round(this._laserFocus * 10) / 10;
    this._laserLabel.string = `${mult}×`;
    if (this._laserFocus >= 2.0) {
        this._laserLabel.color = new Color(255, 50, 50);  // 红色
    } else if (this._laserFocus >= 1.5) {
        this._laserLabel.color = new Color(255, 220, 80); // 黄色
    } else {
        this._laserLabel.color = Color.WHITE.clone();
    }
}
```

- [ ] **步骤 4：切换目标时重置指示器**

在 `tryAttack()` 中切换目标的逻辑分支（`if (target.getUnitId() !== this._laserTargetId)`）内，重置后添加：

```typescript
if (this._laserLabel) {
    this._laserLabel.string = '1.0×';
    this._laserLabel.color = Color.WHITE.clone();
}
```

- [ ] **步骤 5：Commit**
```bash
git add assets/games/game_war_evolution/scripts/Unit.ts
git commit -m "feat(war-evo): add laser focus stacking visual indicator"
```

---

## 任务 6：机甲自爆逻辑

**文件：** 修改 `Unit.ts`

- [ ] **步骤 1：在 Unit 类中添加自爆相关字段**

在 `Unit` 类顶部字段区添加：

```typescript
private _hasSelfDestruct: boolean = false;   // 是否已触发自爆
```

- [ ] **步骤 2：在 init() 中检测机甲并设置标记**

在 `init()` 方法中，找到护盾设置逻辑后（约第 78-83 行），添加：

```typescript
if (config.id === 'mech') {
    this._hasSelfDestruct = true;
}
```

- [ ] **步骤 3：在 takeDamage() 中触发自爆**

找到 `takeDamage()` 方法（约第 451 行），在 `if (this._hp <= 0)` 分支中，`this._state = UnitState.DEAD;` 之后，`this.startFadeOut();` 之前，添加：

```typescript
// 机甲死亡自爆
if (this._hasSelfDestruct) {
    this.performSelfDestruct(allUnits);
}
```

注意：`allUnits` 参数在 `tick()` 和 `updateFighting()` 中都可用，需要透传到 `takeDamage()`。最简单的方式是让 `takeDamage()` 接收 `allUnits` 参数。

打开 `takeDamage()` 方法签名，改为：
```typescript
public takeDamage(amount: number, attacker: Unit | null, allUnits?: Unit[]): void {
```

然后在方法内部添加自爆逻辑。

- [ ] **步骤 4：实现 performSelfDestruct() 方法**

在 `Unit.ts` 中 `performStomp()` 方法附近，添加：

```typescript
/**
 * 机甲死亡自爆 — 对周围 100px 内所有敌方造成 60 点范围伤害
 */
private performSelfDestruct(allUnits?: Unit[]): void {
    if (!allUnits) return;
    const cx = this.getX();
    for (const u of allUnits) {
        if (u.getSide() === this._side || u.isDying()) continue;
        if (Math.abs(u.getX() - cx) <= 100) {
            u.takeDamage(60, null);
        }
    }
    // 视觉效果：扩散红色圆圈
    this.triggerExplosionEffect();
}
```

- [ ] **步骤 5：实现 triggerExplosionEffect()**

在 `performSelfDestruct()` 之后添加：

```typescript
/**
 * 触发自爆扩散动画效果
 */
private _explosionTween: Tween<Sprite> | null = null;

private triggerExplosionEffect(): void {
    if (!this.body || !this.body.isValid) return;

    // 保存原始颜色
    const originalColor = this.body.color.clone();

    // 用 body sprite 做一个扩散缩放+透明度动画作为爆炸指示
    this.body.color = new Color(255, 80, 80);  // 红色

    // 注意：这里复用已有的 tween 机制
    // 实际上爆炸效果在死亡动画上叠加，用 setTimeout 触发
    setTimeout(() => {
        if (this.body && this.body.isValid) {
            this.body.color = originalColor;
        }
    }, 100);
}
```

- [ ] **步骤 6：确保 tick() 透传 allUnits 到 takeDamage()**

检查 `tick()` 中所有调用 `takeDamage()` 的地方（约第 406 行），将 `unit.takeDamage(damage, this)` 改为 `unit.takeDamage(damage, this, allUnits)`。

同时 `processDeadUnits()` 中调用 `unit.takeDamage()` 的地方也需要透传 `allUnits`（当前没有传 allUnits，需要添加）。

具体修改：
- `tryAttack()` 中的 `target.takeDamage(damage, this)` → `target.takeDamage(damage, this, allUnits)`
- `updateFighting()` 中调用城堡攻击后也有 `target?.takeDamage()` 的情况

- [ ] **步骤 7：Commit**
```bash
git add assets/games/game_war_evolution/scripts/Unit.ts
git commit -m "feat(war-evo): add mech self-destruct on death (60 AOE damage)"
```

---

## 任务 7：最终验证与 git push

**文件：** 无新文件改动

- [ ] **步骤 1：运行整体自检**

对照设计文档逐项检查：
1. 初始金币是否为 100
2. 进化条件是否为 400/400 和 1500/1500
3. 6 个兵种是否都有 tint 和 scale 字段
4. AI 收入在中世纪后是否变为 12/秒，未来后是否变为 14/秒
5. 结算界面 killLabel 是否显示击杀数而非经验
6. 激光兵目标头顶是否有倍率指示
7. 机甲死亡时是否触发 60 点 AOE

- [ ] **步骤 2：git status 确认所有改动**
```bash
cd ~/git/tiny_games
git status
git diff --stat
```

- [ ] **步骤 3：确认无 staged 未 commit 文件**
```bash
git log --oneline -5
```

- [ ] **步骤 4：push 到远程**
```bash
git push origin main
```
