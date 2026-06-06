# Tiny Vanguard 交互优化 + 战斗重写 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复选队界面职业按钮高亮问题（视觉静默失败 + 交互不符合直觉），全面重写战斗系统（单位二维状态机 + AI 回合可视化 + 回合状态 UI）

**架构：**
- 选队修复：`setClassButtonVisual` 改用 `Button.target.getComponent(Sprite)` 定位背景 Sprite
- 战斗重写：单位行为改为 MOVE→ACTION 二维状态机（BattleManager 分发），AI 改为决策返回模式（AIController.decide → BM 统一执行），AI 动画用 tween + scheduleOnce 回调链

**技术栈：** Cocos Creator 3.8.8 / TypeScript / MCP

**设计文档：** `docs/specs/2026-06-06-tiny-vanguard-fixes.md`

---

### 任务 1：选队界面高亮修复

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`

- [ ] **步骤 1：修改 `setClassButtonVisual` 方法**

将 Sprite 查找路径从 `btnNode.getComponent(Sprite)` 改为通过 `Button.target` 定位背景节点：

```typescript
// 改之前的 setClassButtonVisual（第 244-248 行）
private setClassButtonVisual(btnNode: Node, selected: boolean): void {
    const sprite = btnNode.getComponent(Sprite);
    if (sprite) {
      sprite.color = selected ? new Color(80, 200, 80, 255) : new Color(150, 150, 150, 255);
    }
}

// 改为：
private readonly SELECTED_COLOR = new Color(80, 200, 80, 255);
private readonly UNSELECTED_COLOR = new Color(150, 150, 150, 255);

private setClassButtonVisual(btnNode: Node, selected: boolean): void {
  const btn = btnNode.getComponent(Button);
  if (!btn?.target) return;
  const sprite = btn.target.getComponent(Sprite);
  if (sprite) {
    sprite.color = selected ? this.SELECTED_COLOR : this.UNSELECTED_COLOR;
  }
}
```

- [ ] **步骤 2：修改初始选中逻辑和 StartBtn 交互**

将 `_selectedClasses` 的初始值从 `['warrior', 'archer', 'mage']` 改为 `[]`，并在 `setupClassSelectionUI` 中设置 StartBtn 初始为不可点击：

```typescript
// 第 64 行：改初始值
private _selectedClasses: string[] = [];  // 原来: ['warrior', 'archer', 'mage']

// 第 203-228 行：setupClassSelectionUI 中移除初始高亮逻辑
private setupClassSelectionUI(): void {
  for (let i = 0; i < CLASS_ORDER.length; i++) {
    const btnName = `Class${i + 1}Btn`;
    const btnNode = this.classSelectPanel.getChildByName(btnName);
    if (!btnNode) continue;
    const btn = btnNode.getComponent(Button);
    if (!btn) continue;
    const classId = CLASS_ORDER[i];
    btnNode['_classId'] = classId;
    btn.node.on(Button.EventType.CLICK, this.onClassToggleClicked, this);
    // 移除: if (this._selectedClasses.includes(classId)) { this.setClassButtonVisual(btnNode, true); }
    // 全部初始为未选中
    this.setClassButtonVisual(btnNode, false);
  }
  // 设置 StartBtn 初始不可点击
  const startBtnNode = this.classSelectPanel.getChildByName('StartBtn');
  if (startBtnNode) {
    const startBtn = startBtnNode.getComponent(Button);
    if (startBtn) {
      startBtn.interactable = false;  // <-- 新增
    }
  }
}
```

- [ ] **步骤 3：修改 `onClassToggleClicked` 更新 StartBtn 状态**

每次切换职业选择后，检查是否满 3 个，动态更新 StartBtn 的 `interactable`：

```typescript
// 改之前的 onClassToggleClicked（第 230-242 行）
private onClassToggleClicked(btn: Button): void {
  const classId = btn.node['_classId'] as string;
  if (!classId) return;
  if (this._selectedClasses.includes(classId)) {
    if (this._selectedClasses.length <= 1) return;
    this._selectedClasses = this._selectedClasses.filter(c => c !== classId);
    this.setClassButtonVisual(btn.node, false);
  } else {
    this._selectedClasses.push(classId);
    this.setClassButtonVisual(btn.node, true);
  }
}

// 改为：
private onClassToggleClicked(btn: Button): void {
  const classId = btn.node['_classId'] as string;
  if (!classId) return;
  if (this._selectedClasses.includes(classId)) {
    if (this._selectedClasses.length <= 1) return;
    this._selectedClasses = this._selectedClasses.filter(c => c !== classId);
    this.setClassButtonVisual(btn.node, false);
  } else {
    this._selectedClasses.push(classId);
    this.setClassButtonVisual(btn.node, true);
  }
  // 更新开始按钮状态
  this.updateStartBtnInteractable();
}

// 新增方法：
private updateStartBtnInteractable(): void {
  const startBtnNode = this.classSelectPanel.getChildByName('StartBtn');
  if (!startBtnNode) return;
  const startBtn = startBtnNode.getComponent(Button);
  if (startBtn) {
    startBtn.interactable = this._selectedClasses.length >= 3;
  }
}
```

- [ ] **步骤 4：lsp_diagnostics 检查**

```bash
# 通过 lsp_diagnostics 工具检查
# 路径: assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts
# 预期: 无 error
```

- [ ] **步骤 5：Commit**

```bash
git add assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts
git commit -m "fix(tiny-vanguard): 修复选队按钮高亮失效 + 交互改为从零选3"
```

---

### 任务 2：UnitController 添加动画移动方法

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/battle/UnitController.ts`

- [ ] **步骤 1：添加 `moveToPositionAnimated` 方法**

```typescript
// 在 UnitController 类中，setGridPosition 方法之后添加（约第 167 行之后）：
import { tween } from 'cc';
// 注意：tween 已在顶层从 'cc' import，检查现有 import 行

/**
 * 带 tween 动画的移动。移动完成后调用 onComplete 回调。
 */
moveToPositionAnimated(pos: GridPosition, duration: number = 0.3, onComplete?: () => void): void {
  if (!this._data || !this.node?.isValid) {
    if (onComplete) onComplete();
    return;
  }
  this._data.gridPos = { ...pos };
  this._data.hasMoved = true;
  const targetX = (pos.col - 2.5) * GridController.CELL_SIZE;
  const targetY = (pos.row - 2.5) * GridController.CELL_SIZE;
  tween(this.node)
    .to(duration, { position: { value: targetX, prop: 'x' }, position: { value: targetY, prop: 'y' } })
    .call(() => {
      if (onComplete) onComplete();
    })
    .start();
}
```

**注意**：`tween` 方法调用方式需要与 Cocos Creator 3.x API 一致。Cocos Creator 3.x 中 tween 对象的 `to()` 参数为 `(duration: number, props: object, opts?: object)`。属性名直接传 `{ position: new Vec3(x, y, 0) }`。

实际代码应为：
```typescript
import { tween, Vec3 } from 'cc';

moveToPositionAnimated(pos: GridPosition, duration: number = 0.3, onComplete?: () => void): void {
  if (!this._data || !this.node?.isValid) {
    if (onComplete) onComplete();
    return;
  }
  this._data.gridPos = { ...pos };
  this._data.hasMoved = true;
  const targetX = (pos.col - 2.5) * GridController.CELL_SIZE;
  const targetY = (pos.row - 2.5) * GridController.CELL_SIZE;
  tween(this.node)
    .to(duration, { position: new Vec3(targetX, targetY, 0) })
    .call(() => { if (onComplete) onComplete(); })
    .start();
}
```

- [ ] **步骤 2：lsp_diagnostics 检查**

路径: `assets/games/game_tiny_vanguard/scripts/battle/UnitController.ts`
预期: 无 error

- [ ] **步骤 3：Commit**

```bash
git add assets/games/game_tiny_vanguard/scripts/battle/UnitController.ts
git commit -m "feat(tiny-vanguard): UnitController 添加 moveToPositionAnimated 动画移动"
```

---

### 任务 3：AIController 重构为决策返回模式

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/battle/AIController.ts`

- [ ] **步骤 1：添加 `AIAction` 接口 + 改造 `executeEnemyTurn` 为 `decide`**

将整个 AIController 从"执行"模式改为"决策"模式。每个 AI 行为方法返回 `AIAction`，不再直接调 `takeDamage` 和 `setGridPosition`。

```typescript
// 在文件顶部，import 后添加：
export interface AIAction {
  moveTo: GridPosition;
  attackTarget: UnitController | null;
}
```

改造 `executeEnemyTurn` 为 `decideAll`，返回数组：
```typescript
// 原来的 executeEnemyTurn 改为 decideAll
decideAll(enemies: UnitController[], players: UnitController[]): AIAction[] {
  const actions: AIAction[] = [];
  const aliveEnemies = enemies.filter(u => u.data?.isAlive);
  const alivePlayers = players.filter(u => u.data?.isAlive);
  const occupied = this.getAllOccupiedPositions(enemies, players);

  for (const enemy of aliveEnemies) {
    if (!enemy.data?.isAlive) continue;
    const behavior: AIType = enemy.data.aiBehavior || 'aggressive';
    let action: AIAction;

    switch (behavior) {
      case 'aggressive':
        action = this.decideAggressive(enemy, alivePlayers, occupied);
        break;
      case 'ranged':
        action = this.decideRanged(enemy, alivePlayers, occupied);
        break;
      case 'defensive':
        action = this.decideDefensive(enemy, alivePlayers, aliveEnemies, occupied);
        break;
      case 'flanking':
        action = this.decideFlanking(enemy, alivePlayers, occupied);
        break;
      default:
        action = { moveTo: { ...enemy.data.gridPos }, attackTarget: null };
    }
    actions.push(action);
  }
  return actions;
}
```

改造 `executeAggressive` 为 `decideAggressive`：
```typescript
private decideAggressive(
  enemy: UnitController, players: UnitController[], occupied: GridPosition[]
): AIAction {
  const target = this.findTarget(enemy, players);
  if (!target?.data) return { moveTo: { ...enemy.data.gridPos }, attackTarget: null };

  const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
  if (dist <= enemy.data.stats.range) {
    // 已在攻击范围 → 不移动，直接攻击
    return { moveTo: { ...enemy.data.gridPos }, attackTarget: target };
  }
  // 不在范围 → 先靠近
  const moveTo = this.bestMoveToward(enemy.data.gridPos, target.data.gridPos, enemy.data.stats.move, occupied);
  const newDist = this.manhattanDist(moveTo, target.data.gridPos);
  return {
    moveTo,
    attackTarget: newDist <= enemy.data.stats.range ? target : null,
  };
}
```

改造 `executeRanged` 为 `decideRanged`：
```typescript
private decideRanged(
  enemy: UnitController, players: UnitController[], occupied: GridPosition[]
): AIAction {
  const target = this.findTarget(enemy, players);
  if (!target?.data) return { moveTo: { ...enemy.data.gridPos }, attackTarget: null };

  const pos = enemy.data.gridPos;
  const dist = this.manhattanDist(pos, target.data.gridPos);
  const range = enemy.data.stats.range;

  if (dist > range) {
    // 太远 → 靠近到射程边缘
    const moveTo = this.bestMoveTowardRanged(pos, target.data.gridPos, range, enemy.data.stats.move, occupied);
    const newDist = this.manhattanDist(moveTo, target.data.gridPos);
    return { moveTo, attackTarget: newDist <= range ? target : null };
  } else if (dist <= 1) {
    // 贴脸 → 找一个远离目标的位置后退
    const moveTo = this.bestRetreatPosition(pos, target.data.gridPos, enemy.data.stats.move, occupied);
    const newDist = this.manhattanDist(moveTo, target.data.gridPos);
    return { moveTo, attackTarget: newDist <= range ? target : null };
  } else {
    // 最佳射程 → 不移动直接攻击
    return { moveTo: { ...pos }, attackTarget: target };
  }
}
```

改造 `executeDefensive` 为 `decideDefensive`：
```typescript
private decideDefensive(
  enemy: UnitController, players: UnitController[], allies: UnitController[], occupied: GridPosition[]
): AIAction {
  const threatenedAlly = this.findThreatenedAlly(enemy, players, allies);
  if (threatenedAlly?.data) {
    const moveTo = this.bestMoveToward(enemy.data.gridPos, threatenedAlly.data.gridPos, enemy.data.stats.move, occupied);
    return { moveTo, attackTarget: null };
  }
  const target = this.findTarget(enemy, players);
  if (!target?.data) return { moveTo: { ...enemy.data.gridPos }, attackTarget: null };
  const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
  if (dist <= enemy.data.stats.range) {
    return { moveTo: { ...enemy.data.gridPos }, attackTarget: target };
  }
  const moveTo = this.bestMoveToward(enemy.data.gridPos, target.data.gridPos, enemy.data.stats.move, occupied);
  return { moveTo, attackTarget: null };
}
```

改造 `executeFlanking` 为 `decideFlanking`：
```typescript
private decideFlanking(
  enemy: UnitController, players: UnitController[], occupied: GridPosition[]
): AIAction {
  const target = this.findWeakestTarget(enemy, players);
  if (!target?.data) return { moveTo: { ...enemy.data.gridPos }, attackTarget: null };

  const pos = enemy.data.gridPos;
  const dist = this.manhattanDist(pos, target.data.gridPos);

  if (dist <= enemy.data.stats.range) {
    return { moveTo: { ...pos }, attackTarget: target };
  }
  const flankPos = this.findFlankingPosition(enemy, target, occupied);
  if (flankPos) {
    const newDist = this.manhattanDist(flankPos, target.data.gridPos);
    return { moveTo: flankPos, attackTarget: newDist <= enemy.data.stats.range ? target : null };
  }
  const moveTo = this.bestMoveToward(pos, target.data.gridPos, enemy.data.stats.move, occupied);
  return { moveTo, attackTarget: null };
}
```

- [ ] **步骤 2：添加纯移动计算辅助方法（从原 moveToward 拆分）**

原 `moveToward` 和 `moveTowardRanged` 会直接调用 `enemy.setGridPosition()`，修改为只计算最佳位置不执行移动：

```typescript
/** 计算离目标最近的合法位置（不执行移动） */
private bestMoveToward(
  from: GridPosition, targetPos: GridPosition, moveRange: number, occupied: GridPosition[]
): GridPosition {
  let bestPos = { ...from };
  let closestDist = this.manhattanDist(from, targetPos);

  for (let r = -moveRange; r <= moveRange; r++) {
    for (let c = -moveRange; c <= moveRange; c++) {
      if (Math.abs(r) + Math.abs(c) > moveRange) continue;
      const newRow = from.row + r;
      const newCol = from.col + c;
      if (newRow < 0 || newRow >= 6 || newCol < 0 || newCol >= 6) continue;
      if (occupied.some(o => o.row === newRow && o.col === newCol)) continue;
      const dist = this.manhattanDist({ row: newRow, col: newCol }, targetPos);
      if (dist < closestDist) {
        closestDist = dist;
        bestPos = { row: newRow, col: newCol };
      }
    }
  }
  return bestPos;
}

/** 远程单位：计算靠近但不贴脸的最佳位置 */
private bestMoveTowardRanged(
  from: GridPosition, targetPos: GridPosition, range: number, moveRange: number, occupied: GridPosition[]
): GridPosition {
  let bestPos = { ...from };
  let bestDist = this.manhattanDist(from, targetPos);
  let bestPriority = 0;

  for (let r = -moveRange; r <= moveRange; r++) {
    for (let c = -moveRange; c <= moveRange; c++) {
      if (Math.abs(r) + Math.abs(c) > moveRange) continue;
      const newRow = from.row + r;
      const newCol = from.col + c;
      if (newRow < 0 || newRow >= 6 || newCol < 0 || newCol >= 6) continue;
      if (occupied.some(o => o.row === newRow && o.col === newCol)) continue;
      const dist = this.manhattanDist({ row: newRow, col: newCol }, targetPos);
      const priority = (dist <= range && dist > 1) ? 2 : (dist <= range) ? 1 : 0;
      if (priority > bestPriority || (priority === bestPriority && dist < bestDist)) {
        bestPriority = priority;
        bestDist = dist;
        bestPos = { row: newRow, col: newCol };
      }
    }
  }
  return bestPos;
}

/** 计算远离目标的最佳位置（贴脸时后退用） */
private bestRetreatPosition(
  from: GridPosition, targetPos: GridPosition, moveRange: number, occupied: GridPosition[]
): GridPosition {
  let bestPos = { ...from };
  let bestDist = this.manhattanDist(from, targetPos);

  for (let r = -moveRange; r <= moveRange; r++) {
    for (let c = -moveRange; c <= moveRange; c++) {
      if (Math.abs(r) + Math.abs(c) > moveRange || (r === 0 && c === 0)) continue;
      const newRow = from.row + r;
      const newCol = from.col + c;
      if (newRow < 0 || newRow >= 6 || newCol < 0 || newCol >= 6) continue;
      if (occupied.some(o => o.row === newRow && o.col === newCol)) continue;
      const dist = this.manhattanDist({ row: newRow, col: newCol }, targetPos);
      if (dist > bestDist) {
        bestDist = dist;
        bestPos = { row: newRow, col: newCol };
      }
    }
  }
  return bestPos;
}
```

移除原 `moveToward`, `moveTowardRanged`, `tryRetreatAndAttack` 方法（已被 `bestMoveToward`, `bestMoveTowardRanged`, `bestRetreatPosition` 替代）。

保留 `attackIfInRangeOrMoveToward` 不删除（目前未使用，保留兼容；或移除并确保无引用）。

- [ ] **步骤 3：lsp_diagnostics 检查**

路径: `assets/games/game_tiny_vanguard/scripts/battle/AIController.ts`
预期: 无 error，无未使用方法引用

- [ ] **步骤 4：Commit**

```bash
git add assets/games/game_tiny_vanguard/scripts/battle/AIController.ts
git commit -m "refactor(tiny-vanguard): AIController 改为决策返回模式 (AIAction)"
```

---

### 任务 4：BattleManager 单位状态机 + AI 回合执行

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

这是最核心的改动。需要：
1. 引入单位行动阶段枚举 
2. 重构 `onCellClicked` 按状态分发
3. 攻击/技能后自动推进
4. 添加 AI 回合执行（队列 + scheduleOnce 驱动）

- [ ] **步骤 1：添加阶段枚举 + 类型定义**

```typescript
// 在现有 BattlePhase 旁边添加：
export type UnitActionPhase = 'move' | 'action' | 'done';

// 在 BattleManager 内：
private _unitPhase: UnitActionPhase = 'move';
private _aiQueue: { enemy: UnitController; action: AIAction }[] = [];
private _executingAI: boolean = false;
```

- [ ] **步骤 2：重构 `selectNextPlayerUnit` — 每次选中重置为 MOVE_PHASE**

```typescript
private selectNextPlayerUnit(): void {
  if (this._selectedUnit) {
    this._selectedUnit.setSelected(false);
    this._selectedUnit = null;
  }
  this.gridController.clearHighlights();

  while (this._currentUnitIndex < this._playerUnits.length) {
    const unit = this._playerUnits[this._currentUnitIndex];
    if (unit.data?.isAlive) {
      this._selectedUnit = unit;
      unit.setSelected(true);
      // 重置为移动阶段
      this._unitPhase = 'move';
      this.highlightMoveRange(unit);
      // 通知 UI 更新
      if (this._onUnitPhaseChanged) {
        this._onUnitPhaseChanged('player_turn', unit, 'move');
      }
      return;
    }
    this._currentUnitIndex++;
  }
  this.endPlayerTurn();
}

private _onUnitPhaseChanged: ((phase: BattlePhase, unit: UnitController | null, actionPhase: UnitActionPhase | null) => void) | null = null;

setUnitPhaseChangedCallback(cb: typeof this._onUnitPhaseChanged): void {
  this._onUnitPhaseChanged = cb;
}
```

- [ ] **步骤 3：按状态分发 `onCellClicked`**

```typescript
onCellClicked(gridPos: GridPosition): void {
  if (this._phase === 'skill_target') {
    this.handleSkillTargetClick(gridPos);
    return;
  }
  if (this._phase !== 'player_turn') return;
  const unit = this._selectedUnit;
  if (!unit?.data?.isAlive) return;

  if (this._unitPhase === 'move') {
    this.handleMovePhase(unit, gridPos);
  } else if (this._unitPhase === 'action') {
    this.handleActionPhase(unit, gridPos);
  }
}

private handleMovePhase(unit: UnitController, gridPos: GridPosition): void {
  // 点击自身 → 跳过移动
  if (unit.data.gridPos.row === gridPos.row && unit.data.gridPos.col === gridPos.col) {
    this._unitPhase = 'action';
    this.highlightAttackRange(unit);
    if (this._onUnitPhaseChanged) {
      this._onUnitPhaseChanged('player_turn', unit, 'action');
    }
    return;
  }
  // 点击不在移动范围 → 忽略
  if (unit.data.hasMoved) return;
  const moves = this.getReachablePositions(unit.data.gridPos, unit.data.stats.move);
  const canMove = moves.some(m => m.row === gridPos.row && m.col === gridPos.col);
  if (!canMove) return;
  // 执行移动
  unit.setGridPosition(gridPos);
  // 进入行动阶段
  this._unitPhase = 'action';
  this.highlightAttackRange(unit);
  if (this._onUnitPhaseChanged) {
    this._onUnitPhaseChanged('player_turn', unit, 'action');
  }
}

private handleActionPhase(unit: UnitController, gridPos: GridPosition): void {
  if (unit.data.hasActed) return;
  // 点击可攻击敌人 → 攻击
  const targetEnemy = this._enemyUnits.find(e =>
    e.data?.isAlive && e.data.gridPos.row === gridPos.row && e.data.gridPos.col === gridPos.col
  );
  if (targetEnemy) {
    const dist = Math.abs(gridPos.row - unit.data.gridPos.row) + Math.abs(gridPos.col - unit.data.gridPos.col);
    if (dist <= unit.data.stats.range) {
      this.executeAttack(unit, targetEnemy);
      unit.data.hasActed = true;
      this.finishUnitTurn();
      return;
    }
  }
  // 点击其他位置 → 忽略（按设计，等待用按钮操作）
}
```

新增 `highlightMoveRange` 和 `highlightAttackRange` 方法：
```typescript
private highlightMoveRange(unit: UnitController): void {
  this.gridController.clearHighlights();
  if (!unit.data) return;
  if (!unit.data.hasMoved) {
    const moves = this.getReachablePositions(unit.data.gridPos, unit.data.stats.move);
    this.gridController.highlightCells(moves, new Color(100, 200, 100, 180));
  } else {
    // 已移动过（定身恢复的情况），直接进 action
    this._unitPhase = 'action';
    this.highlightAttackRange(unit);
  }
}

private highlightAttackRange(unit: UnitController): void {
  this.gridController.clearHighlights();
  if (!unit.data) return;
  const attacks = this.getAttackableEnemies(unit);
  this.gridController.highlightCells(attacks, new Color(200, 100, 100, 180));
}
```

- [ ] **步骤 4：添加 `finishUnitTurn` 自动推进**

```typescript
/** 当前单位行动完成，自动推进到下一单位 */
private finishUnitTurn(): void {
  this._unitPhase = 'done';
  if (this._selectedUnit) {
    this._selectedUnit.setSelected(false);
    this._selectedUnit = null;
  }
  this.gridController.clearHighlights();
  this._currentUnitIndex++;
  this.selectNextPlayerUnit();
}
```

修改 `endCurrentUnitTurn` 为"等待"功能：
```typescript
/** "等待"按钮点击：结束当前单位行动，不攻击不放技能 */
endCurrentUnitTurn(): void {
  const unit = this._selectedUnit;
  if (!unit?.data?.isAlive) return;
  unit.data.hasActed = true;  // 标记已行动
  this.finishUnitTurn();
}
```

- [ ] **步骤 5：重写 AI 回合执行**

替换 `endPlayerTurn` 和移除旧的 AI 调用逻辑：

```typescript
private endPlayerTurn(): void {
  if (this._phase !== 'player_turn') return;
  this._phase = 'enemy_turn';
  if (this._selectedUnit) {
    this._selectedUnit.setSelected(false);
    this._selectedUnit = null;
  }
  this.gridController.clearHighlights();

  if (this._onUnitPhaseChanged) {
    this._onUnitPhaseChanged('enemy_turn', null, null);
  }

  // 获取所有 AI 决策
  const aliveEnemies = this._enemyUnits.filter(u => u.data?.isAlive);
  for (const enemy of aliveEnemies) {
    enemy.onTurnStart();
  }
  const actions = this._aiController.decideAll(this._enemyUnits, this._playerUnits);
  this._aiQueue = aliveEnemies;

  // 将 enemy 和 action 配对入队
  this._aiQueue = aliveEnemies.map((enemy, i) => ({
    enemy,
    action: actions[i] ?? { moveTo: { ...enemy.data?.gridPos ?? { row: 0, col: 0 } }, attackTarget: null },
  }));

  this._processNextAIUnit();
}

private _processNextAIUnit(): void {
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

  // 移动阶段
  const moveDuration = 0.25;
  const moveTarget = action.moveTo ?? enemy.data.gridPos;
  enemy.moveToPositionAnimated(moveTarget, moveDuration, () => {
    // 攻击阶段
    if (action.attackTarget?.data?.isAlive) {
      this.executeAttack(enemy, action.attackTarget);
    }
    // 延迟后处理下一个敌人
    this.scheduleOnce(() => {
      this._processNextAIUnit();
    }, 0.5);
  });
}

private finishAITurn(): void {
  this.checkBattleEnd();
  if (this._phase === 'enemy_turn') {
    this._turnCount++;
    this._phase = 'player_turn';
    for (const unit of this._playerUnits) {
      if (unit.data?.isAlive) {
        unit.onTurnStart(this._playerUnits);
      }
    }
    this._currentUnitIndex = 0;
    this.selectNextPlayerUnit();
  }
}
```

需要在文件顶部添加 import：
```typescript
import { AIAction } from './AIController';
```

- [ ] **步骤 6：更新 `onSkillUsed` 以兼容新状态机**

现有 `onSkillUsed` 需要配合新流程调整——释放技能后调用 `finishUnitTurn`：

```typescript
// 在 onSkillUsed 末尾，self-targeting 技能使用后：
if (skill.targetType === 'self') {
  unit.useSkill(skillIndex);
  if (unit.data) {
    this.executeSkillEffects(unit, unit, unit.data.gridPos, skill.effects);
  }
  unit.data.hasActed = true;  // 确保标记
  this.finishUnitTurn();      // 替代 selectNextPlayerUnit
}
```

对于目标型技能（`handleSkillTargetClick` 末尾）：
```typescript
// 在执行 executeSkillEffects 后
unit.data.hasActed = true;
this.finishUnitTurn();
// 替换原有的 selectNextPlayerUnit()
```

- [ ] **步骤 7：添加 AIAction import 并确保无循环引用**

注意：`BattleManager.ts` 已 import `AIController`，`AIAction` 接口在 `AIController.ts` 中导出，直接 import 即可。

```typescript
// 扩展现有 import
import { AIController, AIAction } from './AIController';
```

- [ ] **步骤 8：lsp_diagnostics 检查**

路径: `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`
预期: 无 error

- [ ] **步骤 9：Commit**

```bash
git add assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts
git commit -m "refactor(tiny-vanguard): BattleManager 状态机重写 + AI 回合动画序列"
```

---

### 任务 5：BattleUI 添加阶段状态标签

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`
- 修改：通过 MCP 操作 `scenes/TinyVanguard.scene`

- [ ] **步骤 1：BattleUI.ts 添加 `@property` 引用和新方法**

```typescript
// 在现有 @property 块中添加：
@property({ type: Label, tooltip: '阶段文字（我方回合/敌方回合）' })
phaseLabel: Label = null;

@property({ type: Label, tooltip: '当前单位 (1/3)' })
unitTurnLabel: Label = null;

@property({ type: Label, tooltip: '操作提示' })
actionHintLabel: Label = null;
```

添加 `updatePhase` 方法：
```typescript
/**
 * 更新阶段状态 UI
 * @param phase 战斗阶段
 * @param unitName 当前单位名称（玩家回合）
 * @param unitIndex 当前单位序号
 * @param totalUnits 单位总数
 * @param turn 回合数
 * @param actionHint 操作提示
 */
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
}

/** 清空阶段状态 */
clearPhase(): void {
  if (this.phaseLabel) this.phaseLabel.string = '';
  if (this.unitTurnLabel) this.unitTurnLabel.string = '';
  if (this.actionHintLabel) this.actionHintLabel.string = '';
}
```

- [ ] **步骤 2：MCP 场景操作 — 创建 Label 节点**

通过 `cocos-creator` MCP 打开场景并创建 3 个 Label 节点：

```
// 1. 打开场景
cocos-creator_scene_open_scene({scenePath: "db://assets/games/game_tiny_vanguard/scenes/TinyVanguard.scene"})

// 2. 获取 BattleUI 节点 UUID（通过 find_node_by_name 或 get_scene_hierarchy）
// 记下 BattleUI 节点的 UUID

// 3. 开始撤销录制
cocos-creator_sceneAdvanced_begin_undo_recording({nodeUuid: "<BattleUI-node-uuid>"})

// 4. 创建 PhaseLabel
cocos-creator_node_create_node({
  name: "PhaseLabel",
  parentUuid: "<BattleUI-node-uuid>",
  components: ["cc.Label"],
  initialTransform: { position: { x: 0, y: 300, z: 0 } }
})

// 5. 创建 UnitTurnLabel
cocos-creator_node_create_node({
  name: "UnitTurnLabel",
  parentUuid: "<BattleUI-node-uuid>",
  components: ["cc.Label"],
  initialTransform: { position: { x: 0, y: 270, z: 0 } }
})

// 6. 创建 ActionHintLabel
cocos-creator_node_create_node({
  name: "ActionHintLabel",
  parentUuid: "<BattleUI-node-uuid>",
  components: ["cc.Label"],
  initialTransform: { position: { x: 0, y: 240, z: 0 } }
})

// 7. 设置每个 Label 的初始属性（字号、颜色、对齐等）
cocos-creator_component_set_component_property({
  nodeUuid: "<PhaseLabel-uuid>",
  componentType: "cc.Label",
  property: "fontSize",
  propertyType: "integer",
  value: 28
})
cocos-creator_component_set_component_property({
  nodeUuid: "<PhaseLabel-uuid>",
  componentType: "cc.Label",
  property: "string",
  propertyType: "string",
  value: ""
})
cocos-creator_component_set_component_property({
  nodeUuid: "<PhaseLabel-uuid>",
  componentType: "cc.Label",
  property: "color",
  propertyType: "color",
  value: {"r":255,"g":255,"b":255,"a":255}
})

// 同理设置 UnitTurnLabel (fontSize=22) 和 ActionHintLabel (fontSize=20, color 灰色)

// 8. 结束录制
cocos-creator_sceneAdvanced_end_undo_recording({undoId: "<undo-id>"})

// 9. 保存场景
cocos-creator_scene_save_scene()

// 10. 验证场景
cocos-creator_debug_validate_scene({})
```

- [ ] **步骤 3：MCP 挂载 BattleUI 脚本的 `@property` 引用**

获取 3 个 Label 节点的 UUID 后，通过 `set_component_property` 设置 BattleUI 组件上的 `phaseLabel`/`unitTurnLabel`/`actionHintLabel` 引用：

```
// 获取 BattleUI 节点上的 BattleUI 组件信息
cocos-creator_component_get_components({nodeUuid: "<BattleUI-node-uuid>"})
// 找到 cc 脚本组件的完整类型名（如 "BattleUI" 或较长的类 id）

// 挂载 PhaseLabel 引用
cocos-creator_component_set_component_property({
  nodeUuid: "<BattleUI-node-uuid>",
  componentType: "BattleUI",  // 或组件返回的 type
  property: "phaseLabel",
  propertyType: "node",  // @property(Label) 存的是组件引用，通过节点 UUID 挂载
  value: "<PhaseLabel-node-uuid>"
})

// 挂载 UnitTurnLabel
cocos-creator_component_set_component_property({
  nodeUuid: "<BattleUI-node-uuid>",
  componentType: "BattleUI",
  property: "unitTurnLabel",
  propertyType: "node",
  value: "<UnitTurnLabel-node-uuid>"
})

// 挂载 ActionHintLabel
cocos-creator_component_set_component_property({
  nodeUuid: "<BattleUI-node-uuid>",
  componentType: "BattleUI",
  property: "actionHintLabel",
  propertyType: "node",
  value: "<ActionHintLabel-node-uuid>"
})
```

**注意**：`@property(Label)` 在 Cocos Creator 中存的是组件引用而非节点引用。但 MCP 的 `set_component_property` 的 `propertyType: "node"` 可以通过节点 UUID 自动找到对应的 Label 组件并建立引用。如果此方式不通，尝试 `propertyType: "component"`。

- [ ] **步骤 4：lsp_diagnostics 检查**

路径: `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`
预期: 无 error

- [ ] **步骤 5：Commit**

```bash
git add assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts
git add assets/games/game_tiny_vanguard/scenes/TinyVanguard.scene
git commit -m "feat(tiny-vanguard): BattleUI 添加阶段状态标签 (PhaseLabel/UnitTurnLabel/ActionHintLabel)"
```

---

### 任务 6：TinyVanguardMain 适配新战斗流程

**文件：**
- 修改：`assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`

- [ ] **步骤 1：更新 `startNewRun` — 注册阶段变更回调**

```typescript
// 在 startNewRun 中，添加对 battleManager 的阶段变更回调注册：
if (this.battleManager) {
  this.battleManager.setUnitPhaseChangedCallback((phase, unit, actionPhase) => {
    this.updateBattlePhaseUI(phase, unit, actionPhase);
  });
}

private updateBattlePhaseUI(phase: BattlePhase, unit: UnitController | null, actionPhase: UnitActionPhase | null): void {
  if (!this.battleUI) return;
  const aliveUnits = this.battleManager.playerUnits.filter(u => u.data?.isAlive);
  const totalAlive = aliveUnits.length;

  switch (phase) {
    case 'deploy':
      this.battleUI.updatePhase('布阵阶段', '点击前两行放置单位');
      break;

    case 'player_turn':
      if (unit?.data) {
        const idx = aliveUnits.findIndex(u => u === unit) + 1;
        const hint = actionPhase === 'move' ? '点击可移动位置' : '选择攻击目标或等待';
        this.battleUI.updatePhase(
          `我方回合 第${this.battleManager.turnCount}轮`,
          unit.data.name,
          idx,
          totalAlive,
          this.battleManager.turnCount,
          hint
        );
      }
      break;

    case 'enemy_turn':
      this.battleUI.updatePhase('敌方回合', '敌人行动中...');
      break;
  }
}
```

- [ ] **步骤 2：在 `onBattleEnd` 中清除阶段状态**

```typescript
// 战斗结束时清除 UI 阶段状态
private onBattleEnd(result: BattleResult): void {
  // ... 现有逻辑
  // 在 victory/defeat 分支添加：
  this.battleUI.clearPhase();
}
```

- [ ] **步骤 3：lsp_diagnostics 检查**

路径: `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`
预期: 无 error

- [ ] **步骤 4：Commit**

```bash
git add assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts
git commit -m "feat(tiny-vanguard): 主控制器适配新战斗流程 + 阶段 UI 联动"
```

---

### 任务 7：集成验证

**文件：**
- 无代码修改，运行验证

- [ ] **步骤 1：检查所有修改文件的 lsp_diagnostics**

```bash
# 对所有修改过的文件检查
# TinyVanguardMain.ts, BattleManager.ts, AIController.ts, UnitController.ts, BattleUI.ts
# 预期：全部无 error
```

- [ ] **步骤 2：逐项复核验证清单（规格文档第 6 节）**

按 `docs/specs/2026-06-06-tiny-vanguard-fixes.md` 第 6 节的验证清单逐项测试：

```
6.1 选队界面（5项）
6.2 布阵阶段（5项）
6.3 玩家回合（8项）
6.4 AI 回合（6项）
6.5 回归（4项）
```

记录测试结果，标注通过/失败。

- [ ] **步骤 3：提交最终验证**

```bash
git add -A
git commit -m "chore(tiny-vanguard): 集成验证完成"
```
