# Tiny Vanguard 战斗流程问题修复计划

**日期**: 2026-07-06  
**版本**: v1.0  
**状态**: 待实施  

---

## 一、修复概述

本次修复针对 Tiny Vanguard 战斗流程中发现的 12 个问题，按严重等级分为三级：

| 等级 | 数量 | 问题类型 |
|------|------|----------|
| 🔴 严重 | 4 | 软锁、技能失效 |
| 🟡 中等 | 5 | 逻辑缺陷、数值偏差 |
| 🟢 轻微 | 3 | UI优化、代码质量 |

---

## 二、🔴 严重漏洞修复方案

### 2.1 软锁漏洞：点击已行动友军导致无法操作

**问题描述**: 
`selectNextPlayerUnit()` 只检查 `isAlive`，不检查 `hasActed`。当玩家点击已行动的友军时，该单位被选中但无法移动/攻击/等待，导致玩家被卡住。

**影响范围**: 
- [BattleManager.ts](file:///d:/code/github/tiny_games/assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts)

**修复方案**:

```typescript
// 修改 selectNextPlayerUnit() 方法，增加 hasActed 检查
private selectNextPlayerUnit(): void {
    if (this._selectedUnit) {
        this._selectedUnit.setSelected(false);
        this._selectedUnit = null;
    }
    this.gridController.clearHighlights();

    while (this._currentUnitIndex < this._playerUnits.length) {
        const unit = this._playerUnits[this._currentUnitIndex];
        // 增加 hasActed 检查
        if (unit.data?.isAlive && !unit.data.hasActed) {
            this._selectedUnit = unit;
            unit.setSelected(true);
            this._unitPhase = 'move';
            this.highlightMoveRange(unit);
            if (this._onUnitPhaseChanged) {
                this._onUnitPhaseChanged('player_turn', unit, 'move');
            }
            return;
        }
        this._currentUnitIndex++;
    }
    this.endPlayerTurn();
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

---

### 2.2 冲锋技能完全失效

**问题描述**: 
冲锋技能（`charge`）设计意图是"移动前使用，本次移动+2格 + 攻击附带+2伤害"。但当前流程中，技能使用后立即调用 `finishUnitTurn()`，`buff_move+2` 根本没有机会生效。

**影响范围**:
- [BattleManager.ts](file:///d:/code/github/tiny_games/assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts)
- [GameData.ts](file:///d:/code/github/tiny_games/assets/games/game_tiny_vanguard/scripts/config/GameData.ts)

**修复方案**:

**步骤1**: 在 `SkillConfig` 接口中增加 `preMove` 属性

```typescript
// GameData.ts - SkillConfig 接口
export interface SkillConfig {
    id: string;
    name: string;
    type: SkillType;
    energyCost: number;
    targetType: TargetType;
    description: string;
    triggerCondition?: TriggerCondition;
    effects: SkillEffect[];
    // 新增：是否为移动前技能（使用后不立即结束行动）
    preMove?: boolean;
}
```

**步骤2**: 修改冲锋技能配置

```typescript
// GameData.ts - charge 技能
charge: {
    id: 'charge', name: '冲锋', type: 'active', energyCost: 2, targetType: 'enemy',
    description: '本次移动+2格 + 攻击附带+2伤害',
    preMove: true, // 标记为移动前技能
    effects: [{ type: 'buff_move', params: { amount: 2, duration: 1 } }, { type: 'bonus_damage', params: { amount: 2 } }]
},
```

**步骤3**: 在 BattleManager 类中添加字段声明

```typescript
// BattleManager.ts - 新增字段
private _preMoveSkillUsed: boolean = false;
private _currentBattleType: 'normal' | 'elite' | 'boss' = 'normal';
```

**步骤4**: 修改 `onSkillUsed()` 方法，添加完整的 preMove 流程

```typescript
// BattleManager.ts - onSkillUsed() 方法
onSkillUsed(skillIndex: number): void {
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;
    const skill = unit.peekSkill(skillIndex);
    if (!skill) return;
    
    // 检查是否已使用过移动前技能
    if (skill.preMove && this._preMoveSkillUsed) {
        return;
    }
    
    if (skill.targetType === 'self') {
        unit.useSkill(skillIndex);
        if (unit.data) {
            this.executeSkillEffects(unit, unit, unit.data.gridPos, skill.effects);
        }
        
        if (skill.preMove) {
            // 标记已使用移动前技能
            this._preMoveSkillUsed = true;
            // 切回 move 阶段并重新高亮移动范围
            this._unitPhase = 'move';
            this.gridController.clearHighlights();
            this.highlightMoveRange(unit);
            if (this._onUnitPhaseChanged) {
                this._onUnitPhaseChanged('player_turn', unit, 'move');
            }
        } else {
            unit.data.hasActed = true;
            this.finishUnitTurn();
        }
    } else {
        // ... 其余逻辑不变
    }
}
```

**步骤5**: 在 `onTurnStart()` 中重置 `_preMoveSkillUsed`

```typescript
// BattleManager.ts - onTurnStart() 方法
onTurnStart(isPlayer: boolean): void {
    // ... 原有逻辑
    
    if (isPlayer) {
        this._preMoveSkillUsed = false; // 重置移动前技能使用标记
        // ... 其余逻辑
    }
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/config/GameData.ts`
- `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

---

### 2.3 增幅技能无效：buff_next_skill 从未被消费

**问题描述**: 
`amplify`（增幅）技能添加 `buff_next_skill` buff，但 `executeSkillEffects()` 中没有任何地方检查该buff并应用伤害倍数。

**影响范围**:
- [BattleManager.ts](file:///d:/code/github/tiny_games/assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts)

**修复方案**:

```typescript
// BattleManager.ts - executeSkillEffects() 方法
private executeSkillEffects(
    caster: UnitController,
    target: UnitController | null,
    targetPos: GridPosition | null,
    effects: SkillEffect[]
): void {
    if (!caster.data) return;
    
    // 检查并应用 buff_next_skill
    const nextSkillBuff = caster.data.buffs.find(b => b.type === 'buff_next_skill');
    const skillMultiplier = nextSkillBuff ? (nextSkillBuff.params.multiplier ?? 1.5) : 1.0;
    
    const ignoreDefense = effects.some(e => e.type === 'ignore_defense' && e.params.value === 1);

    for (const effect of effects) {
        switch (effect.type) {
            // ... 其他效果不变
            
            case 'damage_multiplier': {
                if (!target?.data) break;
                const mult = effect.params.multiplier ?? 1;
                // 应用增幅倍数
                const rawDmg = Math.floor(caster.data.stats.attack * mult * skillMultiplier);
                const dmg = target.takeDamage(rawDmg, ignoreDefense);
                // ... 其余逻辑不变
                break;
            }
            
            case 'execute': {
                if (!target?.data) break;
                const threshold = effect.params.threshold ?? 0.3;
                const multiplier = effect.params.multiplier ?? 3.0;
                const isLowHp = (target.data.currentHp / target.data.maxHp) <= threshold;
                const rawDmg = isLowHp
                    ? Math.floor(caster.data.stats.attack * multiplier * skillMultiplier)
                    : Math.floor(caster.data.stats.attack * skillMultiplier);
                const dmg = target.takeDamage(rawDmg, ignoreDefense);
                // ... 其余逻辑不变
                break;
            }
            
            case 'multi_attack': {
                if (!target?.data) break;
                const count = effect.params.count ?? 2;
                const mult = effect.params.multiplier ?? 0.7;
                for (let i = 0; i < count; i++) {
                    // 应用增幅倍数
                    const rawDmg = Math.floor(caster.data.stats.attack * mult * skillMultiplier);
                    const dmg = target.takeDamage(rawDmg, ignoreDefense);
                    // ... 其余逻辑不变
                }
                break;
            }
            
            case 'bonus_damage': {
                if (!target?.data) break;
                const bonusRaw = caster.data.stats.attack + (effect.params.amount ?? 2);
                // 应用增幅倍数
                const dmg = target.takeDamage(Math.floor(bonusRaw * skillMultiplier), ignoreDefense);
                // ... 其余逻辑不变
                break;
            }
            
            case 'aoe_adjacent': {
                const mult2 = effect.params.multiplier ?? 1.0;
                // 应用增幅倍数
                const baseDmg = Math.floor(caster.data.stats.attack * mult2 * skillMultiplier);
                // ... 其余逻辑不变
                break;
            }
            
            case 'aoe_1radius': {
                const mult3 = effect.params.multiplier ?? 1.5;
                // 应用增幅倍数
                const baseDmg = Math.floor(caster.data.stats.attack * mult3 * skillMultiplier);
                // ... 其余逻辑不变
                break;
            }
            
            case 'aoe_3x3': {
                const mult4 = effect.params.multiplier ?? 0.6;
                // 应用增幅倍数
                const baseDmg = Math.floor(caster.data.stats.attack * mult4 * skillMultiplier);
                // ... 其余逻辑不变
                break;
            }
            
            case 'chain': {
                if (!target?.data) break;
                const chainCount = effect.params.chainCount ?? 2;
                const chainMult = effect.params.multiplier ?? 0.8;
                // 应用增幅倍数
                const baseChainDmg = Math.floor(caster.data.stats.attack * chainMult * skillMultiplier);
                // ... 其余逻辑不变
                break;
            }
            
            case 'damage': {
                if (!target?.data) break;
                const rawDmg = effect.params.amount ?? 0;
                // 应用增幅倍数
                const dmg = target.takeDamage(Math.floor(rawDmg * skillMultiplier), ignoreDefense);
                // ... 其余逻辑不变
                break;
            }
            
            // ... 其他效果不变
        }
    }
    
    // 消耗 buff_next_skill
    if (nextSkillBuff) {
        caster.data.buffs = caster.data.buffs.filter(b => b.type !== 'buff_next_skill');
    }
    
    // 技能攻击后触发淬毒箭被动（仅对敌人生效）
    if (caster.data && caster.hasPassive('poison_arrows') && target?.data && !target.data.isPlayer) {
        target.addBuff('poison', 2, { damage: 1 });
    }
    this.checkBattleEnd();
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

---

### 2.4 标记技能无效：mark buff 无实际效果

**问题描述**: 
`mark_target`（标记）技能添加 `mark` buff，但伤害计算中没有任何地方检查目标是否有 `mark` 并增加伤害。

**影响范围**:
- [BattleManager.ts](file:///d:/code/github/tiny_games/assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts)

**修复方案**:

**步骤1**: 添加辅助方法 `_getMarkBonus()`

```typescript
// BattleManager.ts - 新增辅助方法
private _getMarkBonus(target: UnitController): number {
    if (!target?.data) return 0;
    const markBuff = target.data.buffs.find(b => b.type === 'mark');
    return markBuff ? (markBuff.params.amount ?? 2) : 0;
}
```

**步骤2**: 修改 `executeSkillEffects()` 方法，将 markBonus 合入 rawDmg 再传入 takeDamage()

```typescript
// BattleManager.ts - executeSkillEffects() 方法
private executeSkillEffects(
    caster: UnitController,
    target: UnitController | null,
    targetPos: GridPosition | null,
    effects: SkillEffect[]
): void {
    if (!caster.data) return;
    
    const nextSkillBuff = caster.data.buffs.find(b => b.type === 'buff_next_skill');
    const skillMultiplier = nextSkillBuff ? (nextSkillBuff.params.multiplier ?? 1.5) : 1.0;
    
    const ignoreDefense = effects.some(e => e.type === 'ignore_defense' && e.params.value === 1);

    for (const effect of effects) {
        switch (effect.type) {
            case 'damage': {
                if (!target?.data) break;
                const rawDmg = effect.params.amount ?? 0;
                const markBonus = this._getMarkBonus(target);
                const totalDmg = Math.floor(rawDmg * skillMultiplier) + markBonus;
                const dmg = target.takeDamage(totalDmg, ignoreDefense);
                this._totalDamageDealt += dmg;
                if (dmg > 0 && this._onDamageDealtCallback && target.node?.isValid) {
                    this._onDamageDealtCallback(target.node, dmg);
                }
                break;
            }
            
            case 'damage_multiplier': {
                if (!target?.data) break;
                const mult = effect.params.multiplier ?? 1;
                const markBonus = this._getMarkBonus(target);
                const rawDmg = Math.floor(caster.data.stats.attack * mult * skillMultiplier);
                const dmg = target.takeDamage(rawDmg + markBonus, ignoreDefense);
                this._totalDamageDealt += dmg;
                if (dmg > 0 && this._onDamageDealtCallback && target.node?.isValid) {
                    this._onDamageDealtCallback(target.node, dmg);
                }
                break;
            }
            
            case 'execute': {
                if (!target?.data) break;
                const threshold = effect.params.threshold ?? 0.3;
                const multiplier = effect.params.multiplier ?? 3.0;
                const isLowHp = (target.data.currentHp / target.data.maxHp) <= threshold;
                const markBonus = this._getMarkBonus(target);
                const rawDmg = isLowHp
                    ? Math.floor(caster.data.stats.attack * multiplier * skillMultiplier)
                    : Math.floor(caster.data.stats.attack * skillMultiplier);
                const dmg = target.takeDamage(rawDmg + markBonus, ignoreDefense);
                this._totalDamageDealt += dmg;
                if (dmg > 0 && this._onDamageDealtCallback && target.node?.isValid) {
                    this._onDamageDealtCallback(target.node, dmg);
                }
                break;
            }
            
            case 'multi_attack': {
                if (!target?.data) break;
                const count = effect.params.count ?? 2;
                const mult = effect.params.multiplier ?? 0.7;
                for (let i = 0; i < count; i++) {
                    const markBonus = this._getMarkBonus(target);
                    const rawDmg = Math.floor(caster.data.stats.attack * mult * skillMultiplier);
                    const dmg = target.takeDamage(rawDmg + markBonus, ignoreDefense);
                    this._totalDamageDealt += dmg;
                    if (dmg > 0 && this._onDamageDealtCallback && target.node?.isValid) {
                        this._onDamageDealtCallback(target.node, dmg);
                    }
                    if (!target.data.isAlive) break;
                }
                break;
            }
            
            case 'bonus_damage': {
                if (!target?.data) break;
                const markBonus = this._getMarkBonus(target);
                const bonusRaw = caster.data.stats.attack + (effect.params.amount ?? 2);
                const totalDmg = Math.floor(bonusRaw * skillMultiplier) + markBonus;
                const dmg = target.takeDamage(totalDmg, ignoreDefense);
                this._totalDamageDealt += dmg;
                if (dmg > 0 && this._onDamageDealtCallback && target.node?.isValid) {
                    this._onDamageDealtCallback(target.node, dmg);
                }
                break;
            }
            
            case 'aoe_adjacent': {
                const mult2 = effect.params.multiplier ?? 1.0;
                const baseDmg = Math.floor(caster.data.stats.attack * mult2 * skillMultiplier);
                const enemies = this._enemyUnits.filter(e => e.data?.isAlive && e.node?.isValid);
                for (const enemy of enemies) {
                    if (!enemy.data || !targetPos) continue;
                    const dist = Math.abs(enemy.data.gridPos.row - targetPos.row) + Math.abs(enemy.data.gridPos.col - targetPos.col);
                    if (dist === 1) {
                        const markBonus = this._getMarkBonus(enemy);
                        const dmg = enemy.takeDamage(baseDmg + markBonus, ignoreDefense);
                        this._totalDamageDealt += dmg;
                        if (dmg > 0 && this._onDamageDealtCallback && enemy.node?.isValid) {
                            this._onDamageDealtCallback(enemy.node, dmg);
                        }
                    }
                }
                break;
            }
            
            case 'aoe_1radius': {
                const mult3 = effect.params.multiplier ?? 1.5;
                const baseDmg = Math.floor(caster.data.stats.attack * mult3 * skillMultiplier);
                const enemies = this._enemyUnits.filter(e => e.data?.isAlive && e.node?.isValid);
                for (const enemy of enemies) {
                    if (!enemy.data || !targetPos) continue;
                    const dist = Math.abs(enemy.data.gridPos.row - targetPos.row) + Math.abs(enemy.data.gridPos.col - targetPos.col);
                    if (dist <= 1) {
                        const markBonus = this._getMarkBonus(enemy);
                        const dmg = enemy.takeDamage(baseDmg + markBonus, ignoreDefense);
                        this._totalDamageDealt += dmg;
                        if (dmg > 0 && this._onDamageDealtCallback && enemy.node?.isValid) {
                            this._onDamageDealtCallback(enemy.node, dmg);
                        }
                    }
                }
                break;
            }
            
            case 'aoe_3x3': {
                const mult4 = effect.params.multiplier ?? 0.6;
                const baseDmg = Math.floor(caster.data.stats.attack * mult4 * skillMultiplier);
                const enemies = this._enemyUnits.filter(e => e.data?.isAlive && e.node?.isValid);
                for (const enemy of enemies) {
                    if (!enemy.data || !targetPos) continue;
                    const dist = Math.abs(enemy.data.gridPos.row - targetPos.row) + Math.abs(enemy.data.gridPos.col - targetPos.col);
                    if (dist <= 2) {
                        const markBonus = this._getMarkBonus(enemy);
                        const dmg = enemy.takeDamage(baseDmg + markBonus, ignoreDefense);
                        this._totalDamageDealt += dmg;
                        if (dmg > 0 && this._onDamageDealtCallback && enemy.node?.isValid) {
                            this._onDamageDealtCallback(enemy.node, dmg);
                        }
                    }
                }
                break;
            }
            
            case 'chain': {
                if (!target?.data) break;
                const chainCount = effect.params.chainCount ?? 2;
                const chainMult = effect.params.multiplier ?? 0.8;
                const targets = [target];
                const hitSet = new Set<string>();
                hitSet.add(`${target.data.gridPos.row},${target.data.gridPos.col}`);
                for (let i = 0; i < chainCount; i++) {
                    const current = targets[targets.length - 1];
                    if (!current?.data?.isAlive) break;
                    const markBonus = this._getMarkBonus(current);
                    const rawDmg = Math.floor(caster.data.stats.attack * Math.pow(chainMult, i) * skillMultiplier);
                    const dmg = current.takeDamage(rawDmg + markBonus, ignoreDefense);
                    this._totalDamageDealt += dmg;
                    if (dmg > 0 && this._onDamageDealtCallback && current.node?.isValid) {
                        this._onDamageDealtCallback(current.node, dmg);
                    }
                    const nearest = this._findNearestEnemy(current.data.gridPos, hitSet);
                    if (nearest) {
                        hitSet.add(`${nearest.data.gridPos.row},${nearest.data.gridPos.col}`);
                        targets.push(nearest);
                    }
                }
                break;
            }
            
            // ... 其余逻辑不变
        }
    }
    
    if (nextSkillBuff) {
        caster.data.buffs = caster.data.buffs.filter(b => b.type !== 'buff_next_skill');
    }
    
    if (caster.data && caster.hasPassive('poison_arrows') && target?.data && !target.data.isPlayer) {
        target.addBuff('poison', 2, { damage: 1 });
    }
    this.checkBattleEnd();
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

---

## 三、🟡 中等问题修复方案

### 3.1 原地不动不消耗移动次数

**问题描述**: 
`handleMovePhase()` 点击自身位置时直接进入 action 阶段，但没有设置 `hasMoved = true`，玩家可以"原地不动"后再移动。

**修复方案**:

```typescript
// BattleManager.ts - handleMovePhase() 方法
private handleMovePhase(unit: UnitController, gridPos: GridPosition): void {
    if (unit.data.gridPos.row === gridPos.row && unit.data.gridPos.col === gridPos.col) {
        // 设置 hasMoved = true
        unit.data.hasMoved = true;
        this._unitPhase = 'action';
        this.highlightAttackRange(unit);
        if (this._onUnitPhaseChanged) {
            this._onUnitPhaseChanged('player_turn', unit, 'action');
        }
        this._checkAutoSkipIfNoTargets(unit);
        return;
    }
    // ... 其余逻辑不变
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

---

### 3.2 反击被动在一击必杀时不触发

**问题描述**: 
`counter`（反击）被动在 `takeDamage()` 中触发，但如果目标被一击必杀，`isAlive` 已经是 `false`，反击不会触发。

**修复方案**:

**步骤1**: 在 UnitController 类中添加 `_countering` 字段声明

```typescript
// UnitController.ts - 新增字段
private _countering: boolean = false;
```

**步骤2**: 修改 `takeDamage()` 方法

```typescript
// UnitController.ts - takeDamage() 方法
takeDamage(rawAmount: number, ignoreDefense: boolean = false, attacker?: UnitController): number {
    if (!this._data || !this._data.isAlive) return 0;
    
    const wasAlive = this._data.isAlive;
    
    let actualDamage = rawAmount;
    
    if (!ignoreDefense) {
        actualDamage = Math.max(1, rawAmount - this._data.stats.defense);
    }
    
    if (this._data.shieldAmount > 0) {
        const absorbed = Math.min(this._data.shieldAmount, actualDamage);
        this._data.shieldAmount -= absorbed;
        actualDamage -= absorbed;
    }
    
    if (actualDamage <= 0) return 0;
    
    this._data.currentHp -= actualDamage;
    if (this._data.currentHp <= 0) {
        this._data.currentHp = 0;
        this._data.isAlive = false;
    }
    
    if (attacker && wasAlive && !this._countering && this.hasPassive('counter')) {
        this._countering = true;
        const counterDmg = Math.max(1, Math.floor(this._data.stats.attack * 0.5));
        attacker.takeDamage(counterDmg, false, this);
        this._countering = false;
    }
    
    return actualDamage;
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/battle/UnitController.ts`

**步骤3**: 更新所有 `takeDamage()` 调用点，传入 `attacker` 参数

```typescript
// BattleManager.ts - executeSkillEffects() 中的所有 takeDamage 调用
// 需要将 caster 作为 attacker 传入

// 示例：修改 damage_multiplier 分支
case 'damage_multiplier': {
    if (!target?.data) break;
    const mult = effect.params.multiplier ?? 1;
    const markBonus = this._getMarkBonus(target);
    const rawDmg = Math.floor(caster.data.stats.attack * mult * skillMultiplier);
    const dmg = target.takeDamage(rawDmg + markBonus, ignoreDefense, caster); // 传入 caster
    // ... 其余逻辑不变
}

// BattleManager.ts - executeAttack() 方法
private executeAttack(attacker: UnitController, target: UnitController): void {
    const dmg = target.takeDamage(attacker.data?.stats.attack ?? 0, false, attacker);
    // ... 其余逻辑不变
}

// AIController.ts - attackIfInRangeOrMoveToward() 方法
target.takeDamage(enemy.data.stats.attack, false, enemy); // 传入 enemy
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`
- `assets/games/game_tiny_vanguard/scripts/battle/AIController.ts`

---

### 3.3 Buff 叠加/移除逻辑缺陷

**问题描述**:
- `buff_move` 移除时直接重置为基础值，如果有多个同类buff叠加，移除其中一个会导致全部失效
- `buff_attack` 移除时减去参数值，如果buff被刷新（turnsLeft重置），参数值会被合并，移除时可能减多

**修复方案**:

**步骤1**: 修改 `addBuff()` 方法

```typescript
// UnitController.ts - addBuff() 方法
addBuff(type: string, turnsLeft: number, params: Record<string, number>): void {
    if (!this._data) return;
    const existing = this._data.buffs.find(b => b.type === type);
    
    if (existing) {
        existing.turnsLeft = Math.max(existing.turnsLeft, turnsLeft);
    } else {
        this._data.buffs.push({ type, turnsLeft, params: { ...params } });
        
        if (type === 'buff_move') {
            this._data.stats.move += params.amount ?? 0;
        }
        if (type === 'buff_attack') {
            this._data.stats.attack += params.amount ?? 0;
        }
    }
}
```

**步骤2**: 添加 `removeBuff()` 方法

```typescript
// UnitController.ts - removeBuff() 方法
private removeBuff(buff: BuffEntry): void {
    if (!this._data) return;
    if (buff.type === 'buff_move') {
        this._data.stats.move -= buff.params.amount ?? 0;
        this._data.stats.move = Math.max(this._data.baseStats.move, this._data.stats.move);
    }
    if (buff.type === 'buff_attack') {
        this._data.stats.attack -= buff.params.amount ?? 0;
        this._data.stats.attack = Math.max(this._data.baseStats.attack, this._data.stats.attack);
    }
}
```

**步骤3**: 修改 `tickBuffs()` 方法，调用 `removeBuff()`

```typescript
// UnitController.ts - tickBuffs() 方法
tickBuffs(): void {
    if (!this._data) return;
    
    this._data.buffs = this._data.buffs.filter(buff => {
        buff.turnsLeft--;
        
        if (buff.type === 'poison' && buff.turnsLeft >= 0) {
            const poisonDmg = buff.params.damage ?? 1;
            this.takeDamage(poisonDmg, true);
        }
        
        if (buff.turnsLeft <= 0) {
            this.removeBuff(buff);
            return false;
        }
        
        return true;
    });
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/battle/UnitController.ts`

---

### 3.4 奖励计算与设计不符

**问题描述**:
- 普通战斗奖励计算为 `10 + 回合数×2`，设计文档是 5~10 金币
- 精英/Boss战斗奖励未区分，设计文档精英是 15~20，Boss 是 30
- 失败后荣誉计算为 `战斗数×2`，设计文档是每打过一关 +5

**修复方案**:

```typescript
// BattleManager.ts - onBattleEnd() 方法
private onBattleEnd(victory: boolean): void {
    if (this._selectedUnit) {
        this._selectedUnit.setSelected(false);
        this._selectedUnit = null;
    }
    this.gridController.clearHighlights();
    
    // 根据战斗类型计算奖励
    let goldReward = 0;
    if (victory) {
        if (this._currentBattleType === 'boss') {
            goldReward = 30;
        } else if (this._currentBattleType === 'elite') {
            goldReward = 15 + Math.floor(Math.random() * 6); // 15~20
        } else {
            goldReward = 5 + Math.floor(Math.random() * 6); // 5~10
        }
    }
    
    if (this._onBattleEndCallback) {
        this._onBattleEndCallback({ victory, goldReward });
    }
}
```

```typescript
// TinyVanguardMain.ts - onBattleEnd() 方法
private onBattleEnd(result: BattleResult): void {
    if (result.victory) {
        this._battleCount++;
        this.routeMapUI.completeNode(this._currentNode?.id ?? 0);
        this._runData.gold += result.goldReward;
        this._runData.honor += 5; // 设计文档：每打过一关 +5
        SaveManager.saveRun(this._runData);
        this.updateGoldDisplay();
        
        this.battleUI.clearPhase();
        this.battleUI.showVictory(result.goldReward);
    } else {
        // 设计文档：每打过一关 +5，失败时至少 +1
        this._runData.honor += Math.max(1, this._battleCount * 5);
        this.battleUI.clearPhase();
        this.battleUI.showDefeat();
        this.scheduleOnce(() => {
            this.onRunComplete(false);
        }, 2.0);
    }
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`
- `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`

---

### 3.5 AI 移动后攻击不重新计算距离

**问题描述**:
AI 移动回调中只检查 `action.attackTarget?.data?.isAlive`，没有重新计算移动后目标是否在攻击范围内。

**修复方案**:

```typescript
// BattleManager.ts - _processNextAIUnit() 方法
private _processNextAIUnit(): void {
    if (this._phase !== 'enemy_turn') {
        this._aiQueue = [];
        return;
    }
    if (this._aiQueue.length === 0) {
        this.finishAITurn();
        return;
    }
    const item = this._aiQueue.shift()!;
    const { enemy, action } = item;
    if (!enemy.data?.isAlive) {
        this._processNextAIUnit();
        return;
    }
    
    const moveDuration = 0.25;
    const moveTarget = action.moveTo ?? enemy.data.gridPos;
    enemy.moveToPositionAnimated(moveTarget, moveDuration, () => {
        // 重新计算目标是否在攻击范围内
        if (action.attackTarget?.data?.isAlive) {
            const dist = Math.abs(action.attackTarget.data.gridPos.row - enemy.data.gridPos.row) +
                Math.abs(action.attackTarget.data.gridPos.col - enemy.data.gridPos.col);
            if (dist <= enemy.data.stats.range) {
                this.executeAttack(enemy, action.attackTarget);
            }
        }
        this.scheduleOnce(() => {
            this._processNextAIUnit();
        }, 0.5);
    });
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

---

## 四、🟢 轻微问题修复方案

### 4.1 技能按钮每次重建

**问题描述**:
`showSkillButtons()` 每次切换单位都重建所有按钮，没有复用。

**修复方案**:
使用对象池模式复用技能按钮。

```typescript
// BattleUI.ts - 新增属性
private _skillButtonPool: Node[] = [];

// BattleUI.ts - showSkillButtons() 方法
showSkillButtons(skillNames: string[], canUse: boolean[], callback: (index: number) => void): void {
    this._skillClickCallbacks = [];
    if (!this.skillButtonContainer) return;
    
    const btnWidth = 100;
    const gap = 10;
    const count = skillNames.length;
    const totalWidth = count * btnWidth + (count - 1) * gap;
    const startX = -totalWidth / 2 + btnWidth / 2;
    
    const containerTransform = this.skillButtonContainer.getComponent(UITransform);
    if (containerTransform) {
        containerTransform.setContentSize(Math.max(totalWidth, 100), btnWidth + 20);
    }
    
    // 复用现有按钮，超出数量的销毁
    while (this.skillButtonContainer.children.length > count) {
        const extraBtn = this.skillButtonContainer.children[this.skillButtonContainer.children.length - 1];
        extraBtn.removeFromParent();
        this._skillButtonPool.push(extraBtn);
    }
    
    // 不足数量的创建新按钮
    while (this.skillButtonContainer.children.length < count) {
        const btnNode = this._skillButtonPool.length > 0 
            ? this._skillButtonPool.shift()! 
            : instantiate(this.skillButtonPrefab);
        this.skillButtonContainer.addChild(btnNode);
    }
    
    // 更新所有按钮
    for (let i = 0; i < count; i++) {
        const btnNode = this.skillButtonContainer.children[i];
        const label = btnNode.getComponentInChildren(Label);
        if (label) {
            label.string = skillNames[i];
            label.fontSize = 24;
        }
        const btn = btnNode.getComponent(Button);
        if (btn) {
            btn.interactable = canUse[i];
            btnNode['_skillBtnIndex'] = i;
            btnNode['_skillBtnCallback'] = callback;
            // 移除旧的点击事件
            btn.node.off(Button.EventType.CLICK, this.onSkillBtnClicked, this);
            btn.node.on(Button.EventType.CLICK, this.onSkillBtnClicked, this);
        }
        btnNode.setPosition(startX + i * (btnWidth + gap), 0, 0);
        btnNode.active = true;
    }
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

---

### 4.2 卡片位置硬编码

**问题描述**:
`baseX = -325, baseY = -200` 是硬编码值。

**修复方案**:
使用相对布局计算。

```typescript
// BattleUI.ts - setupPlatoonCards() 方法
setupPlatoonCards(
    unitNames: string[],
    unitIcons: string[],
    callback: (index: number) => void
): void {
    // ... 清除旧的兵牌逻辑不变
    
    const cardWidth = 110;
    const cardHeight = 65;
    const gap = 8;
    const count = unitNames.length;
    
    // 使用相对布局计算位置
    const gridWidth = GridController.GRID_SIZE * GridController.CELL_SIZE;
    const gridHeight = GridController.GRID_SIZE * GridController.CELL_SIZE;
    
    // 兵牌位于棋盘左侧，与棋盘底部平齐
    const baseX = -gridWidth / 2 - cardWidth - 15;
    const baseY = -gridHeight / 2;
    
    // ... 其余逻辑不变
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

---

### 4.3 阶段背景色字符串匹配

**问题描述**:
使用字符串匹配判断阶段，不够健壮。

**修复方案**:
使用枚举值判断。

```typescript
// BattleUI.ts - updatePhase() 方法
updatePhase(
    phase: string,
    unitName?: string,
    unitIndex?: number,
    totalUnits?: number,
    turn?: number,
    actionHint?: string
): void {
    if (this.phaseLabel) {
        this.phaseLabel.string = phase;
    }
    if (this.unitTurnLabel) {
        if (unitName && unitIndex !== undefined && totalUnits !== undefined) {
            this.unitTurnLabel.string = `${unitName} (${unitIndex}/${totalUnits})`;
        } else {
            this.unitTurnLabel.string = unitName ?? '';
        }
    }
    if (this.actionHintLabel) {
        this.actionHintLabel.string = actionHint ?? '';
    }
    
    // 使用 switch 语句判断阶段
    if (this.phaseBg) {
        switch (phase) {
            case '布阵阶段':
                this.phaseBg.color = new Color(0, 120, 60, 120);
                break;
            case '敌方回合':
                this.phaseBg.color = new Color(180, 40, 40, 120);
                break;
            case '我方回合':
                this.phaseBg.color = new Color(0, 80, 180, 120);
                break;
            case '胜利':
                this.phaseBg.color = new Color(180, 140, 0, 120);
                break;
            case '失败':
                this.phaseBg.color = new Color(80, 80, 80, 120);
                break;
            default:
                this.phaseBg.color = new Color(0, 0, 0, 0);
                break;
        }
    }
}
```

**修改文件**:
- `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

---

## 五、修复实施顺序

| 优先级 | 修复项 | 原因 |
|--------|--------|------|
| 1 | 软锁漏洞 | 影响游戏基本流程，必须优先修复 |
| 2 | 冲锋技能失效 | 核心战斗技能，影响游戏体验 |
| 3 | 增幅技能无效 | 核心战斗技能，影响游戏体验 |
| 4 | 标记技能无效 | 核心战斗技能，影响游戏体验 |
| 5 | 原地不动不消耗移动次数 | 影响战斗平衡 |
| 6 | 反击被动时机 | 影响战斗平衡 |
| 7 | Buff 叠加逻辑 | 影响状态管理 |
| 8 | 奖励计算 | 影响游戏经济平衡 |
| 9 | AI 攻击距离 | 影响 AI 行为 |
| 10 | 技能按钮复用 | 性能优化 |
| 11 | 卡片位置布局 | UI 优化 |
| 12 | 阶段背景色 | 代码质量 |

---

## 六、验证方案

修复完成后，需要进行以下验证：

### 6.1 布阵阶段验证
- [ ] 所有单位正确部署到棋盘前两行
- [ ] 确认部署按钮在所有单位部署后可用
- [ ] 撤回已部署单位后可重新部署

### 6.2 战斗中验证

**软锁漏洞测试**:
- [ ] 点击已行动的友军不会导致卡住（自动跳过或切换到下一个未行动单位）
- [ ] 所有友军行动完毕后自动结束玩家回合

**冲锋技能测试**:
- [ ] 冲锋技能在移动阶段使用后，单位仍可移动（不直接结束行动）
- [ ] 冲锋技能使用后，移动范围增加 2 格（实际可移动距离验证）
- [ ] 同单位一回合内只能使用一次冲锋技能
- [ ] 冲锋技能使用后切回移动阶段并重新高亮移动范围

**增幅技能测试**:
- [ ] 使用增幅技能后，目标 buff 列表中出现 buff_next_skill
- [ ] 使用增幅技能后的下一次技能伤害提升 50%（数值验证）
- [ ] 增幅 buff 在使用一次技能后被消耗（从 buff 列表消失）

**标记技能测试**:
- [ ] 使用标记技能后，目标 buff 列表中出现 mark
- [ ] 对标记目标造成伤害时，伤害值增加 2 点（数值验证）
- [ ] 标记 buff 持续时间结束后消失，伤害加成不再生效

**反击被动测试**:
- [ ] 单位被普通攻击时，成功触发反击（敌人受到伤害）
- [ ] 单位被一击必杀时，仍触发反击（死亡前反击）
- [ ] 反击伤害为攻击力的 50%（数值验证）

**移动机制测试**:
- [ ] 点击自身位置时，hasMoved 被设置为 true（后续无法再移动）
- [ ] 移动后正确进入 action 阶段
- [ ] 攻击范围内敌人正确高亮

**技能按钮测试**:
- [ ] 技能按钮根据能量状态正确启用/禁用
- [ ] 切换单位时技能按钮正确复用（不重复创建）

### 6.3 战斗结束验证
- [ ] 胜利后正确显示奖励金币（普通 5~10，精英 15~20，Boss 30）
- [ ] 失败后正确显示游戏结束
- [ ] 胜利后荣誉增加 5 点（数值验证）
- [ ] 失败后荣誉至少增加 1 点（数值验证）
- [ ] 单位复活后状态正确重置（血量、buff、被动状态）
- [ ] 精英/Boss 战斗奖励正确区分

### 6.4 AI 行为验证
- [ ] AI 移动后重新计算目标距离，不在攻击范围内不攻击
- [ ] AI 攻击目标存活时才执行攻击

### 6.5 Buff 系统验证
- [ ] 多个同类 buff 叠加时，效果正确累加
- [ ] 单个 buff 移除时，只减去该 buff 的效果值
- [ ] buff 移除后属性值不低于基础值
- [ ] buff 刷新时，持续时间更新但参数值不变

### 6.6 UI 验证
- [ ] 阶段背景色正确显示（布阵绿色、敌方红色、我方蓝色、胜利金色、失败灰色）
- [ ] 技能按钮复用正常
- [ ] 部署卡片位置正确（相对布局，不硬编码）

---

## 七、风险评估

| 修复项 | 风险等级 | 风险描述 | 缓解措施 |
|--------|----------|----------|----------|
| 软锁漏洞 | 低 | 修改 selectNextPlayerUnit 可能影响单位切换逻辑 | 增加单元测试验证单位切换流程 |
| 冲锋技能 | 中 | 修改技能使用流程可能影响其他技能 | 测试所有技能类型（self/enemy/ally/aoe） |
| 增幅/标记 | 中 | 修改伤害计算可能影响所有技能 | 测试所有伤害类型技能 |
| Buff 系统 | 高 | 修改 buff 逻辑可能导致状态混乱 | 增加 buff 添加/移除的单元测试 |
| 奖励计算 | 低 | 修改数值计算不会影响核心逻辑 | 验证不同战斗类型的奖励数值 |

---

## 八、附录

### 8.1 设计文档参考
- [Tiny Vanguard 设计文档](../specs/2026-05-28-tiny-vanguard-design.md)

### 8.2 相关代码文件
- [BattleManager.ts](../assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts)
- [UnitController.ts](../assets/games/game_tiny_vanguard/scripts/battle/UnitController.ts)
- [GameData.ts](../assets/games/game_tiny_vanguard/scripts/config/GameData.ts)
- [BattleUI.ts](../assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts)
- [TinyVanguardMain.ts](../assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts)