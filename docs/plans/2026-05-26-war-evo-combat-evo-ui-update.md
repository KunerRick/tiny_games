# 战争进化史 - 战斗特效/进化/UI 改进方案

**日期**: 2026-05-26
**目标**: 三个独立改进项，全部纯代码修改，不动场景文件

---

## 一、猛犸践踏视觉特效

### 现象
当前践踏（`performStomp`）只有数值伤害，零视觉反馈，玩家分不清普攻和技能。

### 改动

**1.1 震荡波扩散效果**（`performStomp` 触发时）

- 在猛犸当前位置动态创建一个圆形 Sprite 节点（使用内置 `builtin-white-round`）
- 颜色：半透明白 `Color(255, 255, 255, 150)`
- 起始大小：`UITransform(10, 10)`
- tween 链：
  - `0.3s`：`scale` 从 1 放大到 8（覆盖约 160px 范围）
  - 同时 Sprite 的 `color.a` 从 150 渐降到 0
- 结束后 `node.destroy()`

**1.2 被击单位受击反馈**

- 被践踏波及的每个敌方单位触发垂直弹跳：
  - `tween 0.1s`：`position.y` → `BATTLE_Y + 8`
  - `tween 0.1s`：`position.y` → `BATTLE_Y`
- 叠加一次闪白（复用已有的 `triggerHitFlash`）

### 涉及文件
- `Unit.ts`：修改 `performStomp()`，新增 `spawnShockwave()`、`triggerHitFloat()`

### 不涉及
- 不改 GameConfig、WarEvo、场景、数值

---

## 二、兵种按钮：进化后显示新时代兵种

### 现象
进化后按钮仍显示旧时代兵种（穴居人/猛犸），骑士和弓箭手无槽位可放。

### 改动

将 `UIController.setupUnitButtons()` 的逻辑从"显示所有<=当前时代的兵种"改为"仅显示当前时代的兵种"。

**具体修改：**

```typescript
// UIController.ts
public setupUnitButtons(age: Age): void {
    this._currentAge = age;
    // 旧：getAvailableUnits(age) → 返回所有 <= age 的兵种（4个）
    // 新：getUnitsByAge(age) → 仅返回 == age 的兵种（2个）
    this._unitConfigs = getUnitsByAge(age);
    
    this.updateButton(this.unitButton0, this.unitName0, this.unitCost0, 0);
    this.updateButton(this.unitButton1, this.unitName1, this.unitCost1, 1);
}
```

按钮变化示意：

| 时代 | 之前（错误） | 之后（正确） |
|------|-------------|-------------|
| 原始时代 | [穴居人, 猛犸] | [穴居人, 猛犸] |
| 中世纪 | [穴居人, 猛犸] ❌ | [骑士, 弓箭手] ✅ |
| 未来时代 | [穴居人, 猛犸] ❌ | [机甲, 激光兵] ✅ |

### 涉及文件
- `UIController.ts`：`setupUnitButtons()` 调用 `getUnitsByAge` 替代 `getAvailableUnits`
- （可选）`GameConfig.ts`：`getUnitsByAge()` 已存在，无需新增

---

## 三、进化系统：纯经验升级 + 金币购买经验

### 现象
当前进化需要同时满足经验和金币，但经验和金币来源重叠（击杀奖励同时加两者），玩家体验为"攒够两个数"而非策略选择。

### 改动

**3.1 移除金币进化门槛**

```typescript
// WarEvo.ts - playerEvolve()
private playerEvolve(): void {
    const next = getNextAgeConfig(this._playerAge);
    if (!next) return;
    if (this._playerExp < next.expRequired) return;
    // 移除金币检查
    
    // 不再扣除金币，但保留进化奖励（鼓励进化）
    this._playerGold += 200;
    this._playerAge = next.age;
    this.uiController?.setupUnitButtons(this._playerAge);
    this.uiController?.showPlayerEvolveNotice(this._playerAge);
}
```

**3.2 金币购买经验**

交互逻辑：点击 `evolveBtn` 时
- 经验够了 → 直接进化
- 经验不够 → 消耗金币买经验（50g → 20exp）

```typescript
// WarEvo.ts
private playerEvolveOrBuyExp(): void {
    const next = getNextAgeConfig(this._playerAge);
    if (!next) return;
    
    if (this._playerExp >= next.expRequired) {
        // 经验够 → 进化
        this.playerEvolve();
    } else {
        // 经验不够 → 金币买经验
        this.buyExp();
    }
}

private buyExp(): void {
    const COST = 50;
    const GAIN = 20;
    if (this._playerGold < COST) return;
    this._playerGold -= COST;
    this._playerExp += GAIN;
}
```

**3.3 进化按钮 UI 反馈**

```typescript
// UIController.ts - updateTopBar()
// evolveBtn 的 costLabel 显示提示
if (next) {
    if (exp >= next.expRequired) {
        // 可进化状态
        evolveCostLabel.string = `可进化`;
        evolveNameLabel.string = '进化';
        setEvolveButtonEnabled(true);
    } else {
        // 经验不足，提示购买
        evolveCostLabel.string = `${exp}/${next.expRequired}  50g→20exp`;
        evolveNameLabel.string = '购买经验';
        setEvolveButtonEnabled(gold >= 50); // 有50金就能点
    }
}
```

**3.4 更新进化按钮事件绑定**

```typescript
// WarEvo.ts setupUI() 中
this.uiController?.setCallbacks(
    (placeholder) => { /* 产兵逻辑不变 */ },
    () => this.playerEvolveOrBuyExp(),  // 原来绑 playerEvolve，现在绑新的
    () => this.onRestart(),
    () => this.onLobby(),
);
```

### 涉及文件
- `WarEvo.ts`：`playerEvolve()` 去掉金币检查/扣除；新增 `playerEvolveOrBuyExp()`、`buyExp()`
- `UIController.ts`：`updateTopBar()` 中 `evolveBtn` 的状态文字逻辑

### 不涉及
- `GameConfig.ts`：`AgeConfig.goldRequired` 保留不动（AI 可能还用，不影响玩家逻辑）

---

## 文件变更汇总

| 文件 | 改动项 | 类型 |
|------|--------|------|
| `Unit.ts` | 践踏特效：震荡波 + 受击抖动 | 新增代码 |
| `UIController.ts` | 兵种按钮：进化后显示新时代；进化按钮：可进化/买经验两种状态 | 修改逻辑 |
| `WarEvo.ts` | 进化：移除金币门槛；新增金币买经验 | 修改逻辑 |

---

## 不做的事情（明确排除）

- ❌ 不改场景文件（`.scene` / `.prefab`）
- ❌ 不改 `GameConfig.ts` 的数值配置
- ❌ 不加随时间自动增长经验
- ❌ 不加全时代按钮置灰
- ❌ 不改 AI 逻辑

---

## 验收标准

- [ ] 猛犸践踏时有扩散圆圈特效
- [ ] 被践踏击中的单位有垂直弹跳 + 闪白
- [ ] 穴居人和猛犸的攻击没有震荡波（区分度）
- [ ] 进化到中世纪后按钮显示 [骑士, 弓箭手]
- [ ] 进化到未来后按钮显示 [机甲, 激光兵]
- [ ] 进化不再消耗金币
- [ ] 经验不够时点击进化按钮消耗 50g 换 20exp
- [ ] 经验够了进化按钮显示"可进化"，点击正常进化
