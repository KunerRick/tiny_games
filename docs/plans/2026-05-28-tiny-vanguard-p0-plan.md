# Tiny Vanguard P0 实现计划

> 面向 AI 代理：使用 subagent-driven-development 或 executing-plans 逐任务实现。步骤使用 `- [ ]` 语法跟踪进度。

**目标**: 实现 Tiny Vanguard P0 核心可玩版本 — 4 职业、4 敌人、完整战斗系统、路线图、商店/休息/事件、存档、局外成长雏形。

**架构**: 数据驱动架构，所有职业/技能/敌人/事件通过配置定义。BattleManager 驱动战斗循环，GridController 管理 6×6 网格交互，各 UI 组件独立。

**技术栈**: Cocos Creator 3.x + TypeScript

---

## 文件结构

```
assets/games/game_tiny_vanguard/
├── scenes/
│   └── TinyVanguard.scene           # 主场景（由人创建）
├── scripts/
│   ├── TinyVanguardMain.ts          # 入口：GameManager，管理状态流转
│   ├── config/
│   │   └── GameData.ts              # 所有配置数据（职业/技能/敌人/事件）
│   ├── battle/
│   │   ├── GridController.ts        # 6×6 网格渲染 + 交互
│   │   ├── UnitController.ts        # 单位逻辑（属性/能量/技能）
│   │   ├── BattleManager.ts         # 战斗循环控制
│   │   └── AIController.ts          # 敌人 AI
│   └── ui/
│       ├── BattleUI.ts              # 战斗 HUD
│       ├── RouteMapUI.ts            # 路线图
│       ├── UpgradeUI.ts             # 三选一升级界面
│       ├── EventUI.ts               # 事件界面
│       └── SaveManager.ts           # 存档/读档
```

---

### 任务 1：项目初始化 & GameData 配置

**文件**:
- 创建: `assets/games/game_tiny_vanguard/scripts/config/GameData.ts`

**说明**: 定义所有数据接口和配置数据。这是游戏的数据驱动基础。

**接口定义**:
```typescript
export interface Stats {
  hp: number;
  attack: number;
  defense: number;
  move: number;
  range: number;
}

export interface EnergyConfig {
  max: number;
  regen: number;
}

export type TargetType = 'self' | 'ally' | 'enemy' | 'tile' | 'aoe';
export type SkillType = 'active' | 'passive';
export type TriggerCondition = 'on_attack' | 'on_hit' | 'on_turn_start' | 'on_kill';
export type EventType = 'choice' | 'random';

export interface SkillConfig {
  id: string;
  name: string;
  type: SkillType;
  energyCost: number;
  targetType: TargetType;
  description: string;
  triggerCondition?: TriggerCondition;
  effects: { type: string; params: Record<string, number> }[];
}

export interface ClassConfig {
  id: string;
  name: string;
  icon: string;
  stats: Stats;
  energy: EnergyConfig;
  startingSkillId: string;
  skillPool: string[];
}

export interface EnemyConfig {
  id: string;
  name: string;
  stats: Stats;
  abilityIds: string[];
  aiBehavior: 'aggressive' | 'ranged' | 'defensive' | 'flanking';
}

export interface ChoiceOption {
  description: string;
  effects: { type: string; params: Record<string, number | string> }[];
}

export interface EventConfig {
  id: string;
  type: EventType;
  name: string;
  description: string;
  choices?: ChoiceOption[];
  randomOutcomes?: { description: string; weight: number; effects: { type: string; params: Record<string, number | string> }[] }[];
}

export interface TalentConfig {
  id: string;
  name: string;
  category: 'attack' | 'defense' | 'economy';
  description: string;
  maxPurchases: number;
  cost: number;
  effect: { type: string; params: Record<string, number> };
}
```

**数据定义** — 4 个 P0 职业：
```typescript
export const CLASSES: ClassConfig[] = [
  {
    id: 'warrior', name: '战士', icon: '⚔️',
    stats: { hp: 8, attack: 5, defense: 2, move: 3, range: 1 },
    energy: { max: 5, regen: 2 },
    startingSkillId: 'heavy_strike',
    skillPool: ['double_strike', 'cleave', 'battle_cry', 'execute', 'charge', 'counter', 'toughness']
  },
  {
    id: 'archer', name: '弓箭手', icon: '🏹',
    stats: { hp: 6, attack: 4, defense: 1, move: 3, range: 2 },
    energy: { max: 5, regen: 2 },
    startingSkillId: 'precise_shot',
    skillPool: ['barrage', 'rain_of_arrows', 'mark_target', 'evade', 'eagle_eye', 'poison_arrows']
  },
  {
    id: 'mage', name: '法师', icon: '🔮',
    stats: { hp: 5, attack: 5, defense: 0, move: 3, range: 2 },
    energy: { max: 5, regen: 2 },
    startingSkillId: 'fireball',
    skillPool: ['freeze', 'chain_lightning', 'teleport', 'amplify', 'arcane_shield', 'arcane_flow']
  },
  {
    id: 'cleric', name: '牧师', icon: '💚',
    stats: { hp: 7, attack: 2, defense: 1, move: 3, range: 1 },
    energy: { max: 5, regen: 2 },
    startingSkillId: 'heal',
    skillPool: ['group_heal', 'shield', 'bless', 'smite', 'haste', 'aura_of_blessing']
  }
];
```

技能、敌人、事件、天赋数据类似结构（详见最终代码）。

- [ ] **步骤 1**: 创建 GameData.ts 文件，定义所有接口和配置数据
- [ ] **步骤 2**: 检查 TypeScript 编译无报错

---

### 任务 2：GridController — 6×6 网格系统

**文件**:
- 创建: `assets/games/game_tiny_vanguard/scripts/battle/GridController.ts`
- 依赖场景中有一个名为 `Grid` 的节点，包含 36 个子节点（每个格子一个 Sprite）

**核心功能**:
- 渲染 6×6 网格
- 高亮可移动格子、可攻击格子、技能目标格子
- 处理点击交互（选中单位 → 显示可选范围 → 点击目标）

```typescript
import { _decorator, Component, Node, Sprite, Color, Vec3, instantiate, Prefab } from 'cc';
const { ccclass, property } = _decorator;

export interface GridPosition { row: number; col: number; }

@ccclass('GridController')
export class GridController extends Component {
  @property({ type: Node, tooltip: '网格容器节点' })
  gridContainer: Node = null;

  @property({ type: Prefab, tooltip: '格子预制体' })
  cellPrefab: Prefab = null;

  public static readonly GRID_SIZE = 6;
  public static readonly CELL_SIZE = 80; // px

  private _cells: Node[][] = [];
  private _selectedPos: GridPosition | null = null;
  private _highlightedCells: Node[] = [];

  onLoad() {
    this.initGrid();
  }

  initGrid() {
    for (let row = 0; row < GridController.GRID_SIZE; row++) {
      this._cells[row] = [];
      for (let col = 0; col < GridController.GRID_SIZE; col++) {
        const cell = instantiate(this.cellPrefab);
        cell.name = `Cell_${row}_${col}`;
        cell.setPosition(
          (col - 2.5) * GridController.CELL_SIZE,
          (row - 2.5) * GridController.CELL_SIZE
        );
        this.gridContainer.addChild(cell);
        this._cells[row][col] = cell;
      }
    }
  }

  getCell(row: number, col: number): Node | null {
    if (row < 0 || row >= GridController.GRID_SIZE || col < 0 || col >= GridController.GRID_SIZE) return null;
    return this._cells[row][col];
  }

  getGridPosition(cell: Node): GridPosition | null {
    for (let row = 0; row < GridController.GRID_SIZE; row++) {
      for (let col = 0; col < GridController.GRID_SIZE; col++) {
        if (this._cells[row][col] === cell) return { row, col };
      }
    }
    return null;
  }

  highlightCells(positions: GridPosition[], color: Color) {
    this.clearHighlights();
    for (const pos of positions) {
      const cell = this.getCell(pos.row, pos.col);
      if (cell) {
        const sprite = cell.getComponent(Sprite);
        if (sprite) { sprite.color = color; }
        this._highlightedCells.push(cell);
      }
    }
  }

  clearHighlights() {
    for (const cell of this._highlightedCells) {
      const sprite = cell.getComponent(Sprite);
      if (sprite) { sprite.color = Color.WHITE; }
    }
    this._highlightedCells = [];
  }

  gridPositions(): GridPosition[] {
    const positions: GridPosition[] = [];
    for (let row = 0; row < GridController.GRID_SIZE; row++) {
      for (let col = 0; col < GridController.GRID_SIZE; col++) {
        positions.push({ row, col });
      }
    }
    return positions;
  }
}
```

- [ ] **步骤 1**: 创建 GridController.ts，实现网格初始化、格子定位、高亮/清除高亮
- [ ] **步骤 2**: 人创建场景，添加 Grid 节点，挂载 GridController 组件，创建 Cell 预制体

---

### 任务 3：UnitController — 单位逻辑

**文件**:
- 创建: `assets/games/game_tiny_vanguard/scripts/battle/UnitController.ts`

```typescript
import { _decorator, Component, Node, Sprite, Color } from 'cc';
import { GridPosition } from './GridController';
import { Stats, SkillConfig, CLASSES } from '../config/GameData';

const { ccclass, property } = _decorator;

export interface UnitData {
  id: string;
  name: string;
  classId: string;
  isPlayer: boolean;
  stats: Stats;
  currentHp: number;
  energy: number;
  maxEnergy: number;
  energyRegen: number;
  skills: SkillConfig[];
  gridPos: GridPosition;
  isAlive: boolean;
  buffs: { type: string; turnsLeft: number; params: Record<string, number> }[];
}

@ccclass('UnitController')
export class UnitController extends Component {
  private _data: UnitData = null;

  init(classId: string, isPlayer: boolean, gridPos: GridPosition) {
    const classConfig = CLASSES.find(c => c.id === classId);
    if (!classConfig) return;

    this._data = {
      id: `${isPlayer ? 'p' : 'e'}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: classConfig.name,
      classId: classConfig.id,
      isPlayer,
      stats: { ...classConfig.stats },
      currentHp: classConfig.stats.hp,
      energy: classConfig.energy.max,
      maxEnergy: classConfig.energy.max,
      energyRegen: classConfig.energy.regen,
      skills: [],
      gridPos: { ...gridPos },
      isAlive: true,
      buffs: []
    };

    this.node.setPosition(
      (gridPos.col - 2.5) * 80,
      (gridPos.row - 2.5) * 80
    );
  }

  get data(): UnitData { return this._data; }

  takeDamage(amount: number): number {
    const actualDamage = Math.max(1, amount - this._data.stats.defense);
    this._data.currentHp -= actualDamage;
    if (this._data.currentHp <= 0) {
      this._data.currentHp = 0;
      this._data.isAlive = false;
    }
    return actualDamage;
  }

  heal(amount: number) {
    this._data.currentHp = Math.min(this._data.stats.hp, this._data.currentHp + amount);
  }

  canUseSkill(skillIndex: number): boolean {
    if (skillIndex < 0 || skillIndex >= this._data.skills.length) return false;
    return this._data.energy >= this._data.skills[skillIndex].energyCost;
  }

  useSkill(skillIndex: number) {
    const skill = this._data.skills[skillIndex];
    if (skill) {
      this._data.energy -= skill.energyCost;
    }
  }

  onTurnStart() {
    this._data.energy = Math.min(this._data.maxEnergy, this._data.energy + this._data.energyRegen);
    // Process buffs
    for (let i = this._data.buffs.length - 1; i >= 0; i--) {
      this._data.buffs[i].turnsLeft--;
      if (this._data.buffs[i].turnsLeft <= 0) {
        this._data.buffs.splice(i, 1);
      }
    }
  }

  resetForNewBattle() {
    this._data.currentHp = this._data.stats.hp;
    this._data.energy = this._data.maxEnergy;
    this._data.isAlive = true;
    this._data.buffs = [];
  }

  setGridPosition(pos: GridPosition) {
    this._data.gridPos = { ...pos };
    this.node.setPosition(
      (pos.col - 2.5) * 80,
      (pos.row - 2.5) * 80
    );
  }
}
```

- [ ] **步骤 1**: 创建 UnitController.ts，实现单位数据、受伤/治疗、能量管理、回合开始重置
- [ ] **步骤 2**: 验证 TypeScript 编译通过

---

### 任务 4：BattleManager — 战斗循环核心

**文件**:
- 创建: `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

**核心职责**: 管理整个战斗生命周期：布阵 → 回合循环（玩家操作 → 敌人 AI）→ 胜负判定 → 奖励结算。

```typescript
import { _decorator, Component, Node, Color } from 'cc';
import { GridController, GridPosition } from './GridController';
import { UnitController, UnitData } from './UnitController';
import { AIController } from './AIController';
import { BattleUI } from '../ui/BattleUI';
import { CLASSES, EnemyConfig, ENEMIES } from '../config/GameData';

const { ccclass, property } = _decorator;

export type BattlePhase = 'deploy' | 'player_turn' | 'enemy_turn' | 'victory' | 'defeat';

@ccclass('BattleManager')
export class BattleManager extends Component {
  @property({ type: GridController })
  gridController: GridController = null;

  @property({ type: UnitController })
  unitControllerPrefab: UnitController = null;

  private _playerUnits: UnitController[] = [];
  private _enemyUnits: UnitController[] = [];
  private _currentUnitIndex: number = 0;
  private _phase: BattlePhase = 'deploy';
  private _turnCount: number = 0;
  private _aiController: AIController = null;

  get phase(): BattlePhase { return this._phase; }
  get turnCount(): number { return this._turnCount; }
  get playerUnits(): UnitController[] { return this._playerUnits; }
  get enemyUnits(): UnitController[] { return this._enemyUnits; }

  startBattle(playerClasses: string[], enemyConfigs: EnemyConfig[]) {
    this._phase = 'deploy';
    this._turnCount = 0;
    this._aiController = new AIController();
    this.startDeployPhase(playerClasses, enemyConfigs);
  }

  private startDeployPhase(playerClasses: string[], enemyConfigs: EnemyConfig[]) {
    // Create player units - will be placed by player via UI
    for (let i = 0; i < playerClasses.length; i++) {
      const unit = this.createUnit(playerClasses[i], true, { row: i, col: 0 });
      this._playerUnits.push(unit);
    }
    // Pre-place enemies on enemy half (last 2 rows)
    for (let i = 0; i < enemyConfigs.length; i++) {
      const pos = { row: 5 - i, col: Math.floor(Math.random() * 6) };
      const unit = this.createEnemy(enemyConfigs[i], pos);
      this._enemyUnits.push(unit);
    }
  }

  confirmDeploy() {
    this._phase = 'player_turn';
    this._turnCount = 1;
    this.startPlayerTurn();
  }

  private startPlayerTurn() {
    this._currentUnitIndex = 0;
    for (const unit of this._playerUnits) {
      if (unit.data.isAlive) {
        unit.onTurnStart();
      }
    }
    this.selectNextPlayerUnit();
  }

  private selectNextPlayerUnit() {
    while (this._currentUnitIndex < this._playerUnits.length) {
      const unit = this._playerUnits[this._currentUnitIndex];
      if (unit.data.isAlive) {
        this.highlightUnitMoves(unit);
        return;
      }
      this._currentUnitIndex++;
    }
    this.endPlayerTurn();
  }

  private highlightUnitMoves(unit: UnitController) {
    const pos = unit.data.gridPos;
    const moveRange = unit.data.stats.move;
    const moves = this.getReachablePositions(pos, moveRange);
    this.gridController.highlightCells(moves, new Color(100, 200, 100, 255));
    // Also highlight attack range
    const attacks = this.getAttackablePositions(unit);
    this.gridController.highlightCells(attacks, new Color(200, 100, 100, 255));
  }

  private getReachablePositions(from: GridPosition, range: number): GridPosition[] {
    const positions: GridPosition[] = [];
    for (let r = -range; r <= range; r++) {
      for (let c = -range; c <= range; c++) {
        if (Math.abs(r) + Math.abs(c) > range) continue;
        const row = from.row + r;
        const col = from.col + c;
        if (row < 0 || row >= 6 || col < 0 || col >= 6) continue;
        if (this.isOccupied({ row, col })) continue;
        positions.push({ row, col });
      }
    }
    return positions;
  }

  private getAttackablePositions(unit: UnitController): GridPosition[] {
    const pos = unit.data.gridPos;
    const range = unit.data.stats.range;
    const positions: GridPosition[] = [];
    const targets = unit.data.isPlayer ? this._enemyUnits : this._playerUnits;
    for (const t of targets) {
      if (!t.data.isAlive) continue;
      const dist = Math.abs(t.data.gridPos.row - pos.row) + Math.abs(t.data.gridPos.col - pos.col);
      if (dist <= range) {
        positions.push(t.data.gridPos);
      }
    }
    return positions;
  }

  private isOccupied(pos: GridPosition): boolean {
    for (const u of this._playerUnits) {
      if (u.data.isAlive && u.data.gridPos.row === pos.row && u.data.gridPos.col === pos.col) return true;
    }
    for (const u of this._enemyUnits) {
      if (u.data.isAlive && u.data.gridPos.row === pos.row && u.data.gridPos.col === pos.col) return true;
    }
    return false;
  }

  onCellClicked(gridPos: GridPosition) {
    if (this._phase !== 'player_turn') return;
    const unit = this._playerUnits[this._currentUnitIndex];
    if (!unit || !unit.data.isAlive) return;

    // Check if clicked on enemy (attack)
    for (const enemy of this._enemyUnits) {
      if (!enemy.data.isAlive) continue;
      if (enemy.data.gridPos.row === gridPos.row && enemy.data.gridPos.col === gridPos.col) {
        const dist = Math.abs(gridPos.row - unit.data.gridPos.row) + Math.abs(gridPos.col - unit.data.gridPos.col);
        if (dist <= unit.data.stats.range) {
          this.executeAttack(unit, enemy);
          return;
        }
      }
    }

    // Check if clicked on valid move position
    const moves = this.getReachablePositions(unit.data.gridPos, unit.data.stats.move);
    for (const m of moves) {
      if (m.row === gridPos.row && m.col === gridPos.col) {
        unit.setGridPosition(gridPos);
        this.highlightUnitMoves(unit);
        return;
      }
    }
  }

  private executeAttack(attacker: UnitController, target: UnitController) {
    const damage = target.takeDamage(attacker.data.stats.attack);
    // Show damage number (UI callback)
    if (!target.data.isAlive) {
      this.checkBattleEnd();
    }
  }

  endCurrentUnitTurn() {
    this._currentUnitIndex++;
    this.selectNextPlayerUnit();
  }

  private endPlayerTurn() {
    this._phase = 'enemy_turn';
    this.gridController.clearHighlights();
    this._aiController.executeEnemyTurn(this._enemyUnits, this._playerUnits);
    // After enemies act, check end, then start new player turn
    this.checkBattleEnd();
    this._turnCount++;
    this._phase = 'player_turn';
    this.startPlayerTurn();
  }

  private checkBattleEnd() {
    const allEnemiesDead = this._enemyUnits.every(u => !u.data.isAlive);
    const allPlayersDead = this._playerUnits.every(u => !u.data.isAlive);
    if (allEnemiesDead) {
      this._phase = 'victory';
      this.onVictory();
    } else if (allPlayersDead) {
      this._phase = 'defeat';
      this.onDefeat();
    }
  }

  private onVictory() {
    // Battle won - give rewards, emit event
  }

  private onDefeat() {
    // Battle lost - game over
  }

  private createUnit(classId: string, isPlayer: boolean, pos: GridPosition): UnitController {
    const unit = this.unitControllerPrefab;
    unit.init(classId, isPlayer, pos);
    return unit;
  }

  private createEnemy(config: EnemyConfig, pos: GridPosition): UnitController {
    const unit = this.unitControllerPrefab;
    unit.init('warrior', false, pos); // Simplified: use enemy config directly
    return unit;
  }
}
```

- [ ] **步骤 1**: 创建 BattleManager.ts，实现布阵阶段、玩家回合循环、移动/攻击交互、回合切换
- [ ] **步骤 2**: 实现胜负判定和奖励结算

---

### 任务 5：AIController — 敌人 AI

**文件**:
- 创建: `assets/games/game_tiny_vanguard/scripts/battle/AIController.ts`

```typescript
import { UnitController, UnitData } from './UnitController';

export class AIController {
  executeEnemyTurn(enemies: UnitController[], players: UnitController[]) {
    const aliveEnemies = enemies.filter(u => u.data.isAlive);
    for (const enemy of aliveEnemies) {
      enemy.onTurnStart();
      const target = this.findTarget(enemy, players);
      if (target) {
        // Move toward target if not in range
        const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
        if (dist <= enemy.data.stats.range) {
          target.takeDamage(enemy.data.stats.attack);
        } else {
          this.moveToward(enemy, target.data.gridPos);
        }
      }
    }
  }

  private findTarget(enemy: UnitController, players: UnitController[]): UnitController | null {
    const alive = players.filter(u => u.data.isAlive);
    if (alive.length === 0) return null;
    // Target lowest HP player
    return alive.reduce((a, b) => a.data.currentHp < b.data.currentHp ? a : b);
  }

  private manhattanDist(a: { row: number; col: number }, b: { row: number; col: number }): number {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
  }

  private moveToward(enemy: UnitController, targetPos: { row: number; col: number }) {
    const pos = enemy.data.gridPos;
    const moveRange = enemy.data.stats.move;
    let bestPos = { ...pos };
    let closestDist = this.manhattanDist(pos, targetPos);

    for (let r = -moveRange; r <= moveRange; r++) {
      for (let c = -moveRange; c <= moveRange; c++) {
        if (Math.abs(r) + Math.abs(c) > moveRange) continue;
        const newRow = pos.row + r;
        const newCol = pos.col + c;
        if (newRow < 0 || newRow >= 6 || newCol < 0 || newCol >= 6) continue;
        const dist = this.manhattanDist({ row: newRow, col: newCol }, targetPos);
        if (dist < closestDist) {
          closestDist = dist;
          bestPos = { row: newRow, col: newCol };
        }
      }
    }
    enemy.setGridPosition(bestPos);
  }
}
```

- [ ] **步骤 1**: 创建 AIController.ts，实现敌人 AI（寻敌、移动、攻击）

---

### 任务 6：BattleUI — 战斗界面

**文件**:
- 创建: `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

**功能**:
- 显示当前选中单位的信息（HP、能量、技能按钮）
- 回合结束按钮
- 布阵阶段提示
- 伤害数字弹出
- 胜利/失败弹窗

```typescript
import { _decorator, Component, Node, Label, Button, Sprite, Color, tween, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('BattleUI')
export class BattleUI extends Component {
  @property({ type: Label })
  unitNameLabel: Label = null;

  @property({ type: Label })
  hpLabel: Label = null;

  @property({ type: Label })
  energyLabel: Label = null;

  @property({ type: Button })
  endTurnButton: Button = null;

  @property({ type: Button })
  skillButtonPrefab: Button = null;

  @property({ type: Node })
  skillButtonContainer: Node = null;

  @property({ type: Node })
  damageNumberPrefab: Node = null;

  updateUnitInfo(name: string, hp: number, maxHp: number, energy: number, maxEnergy: number) {
    if (this.unitNameLabel) this.unitNameLabel.string = name;
    if (this.hpLabel) this.hpLabel.string = `HP: ${hp}/${maxHp}`;
    if (this.energyLabel) this.energyLabel.string = `⚡ ${energy}/${maxEnergy}`;
  }

  showDamageNumber(position: Vec3, amount: number, isPlayer: boolean) {
    const node = this.damageNumberPrefab.clone();
    node.setPosition(position);
    this.node.addChild(node);
    const label = node.getComponent(Label);
    if (label) {
      label.string = `-${amount}`;
      label.color = isPlayer ? Color.RED : Color.WHITE;
    }
    tween(node)
      .to(0.5, { position: new Vec3(position.x, position.y + 50, position.z), opacity: 0 })
      .call(() => node.destroy())
      .start();
  }

  showVictory() { /* show victory popup */ }
  showDefeat() { /* show defeat popup */ }
  showDeployPrompt() { /* show deploy phase instructions */ }
}
```

- [ ] **步骤 1**: 创建 BattleUI.ts，实现信息显示、伤害数字动画、胜利/失败弹窗

---

### 任务 7：SaveManager — 存档系统

**文件**:
- 创建: `assets/games/game_tiny_vanguard/scripts/ui/SaveManager.ts`

复用 2048 的 StorageManager 模式：

```typescript
export interface RunData {
  currentRouteNode: number;
  playerClasses: string[];
  unitSkills: { [unitId: string]: string[] };
  gold: number;
  honor: number;
  talents: string[];
  difficulty: string;
  unlockedClasses: string[];
  unlockedSkills: string[];
}

export class SaveManager {
  private static readonly SAVE_KEY = 'tiny_vanguard_save';
  private static readonly META_KEY = 'tiny_vanguard_meta';

  static saveRun(data: RunData) {
    localStorage.setItem(this.SAVE_KEY, JSON.stringify(data));
  }

  static loadRun(): RunData | null {
    const data = localStorage.getItem(this.SAVE_KEY);
    return data ? JSON.parse(data) : null;
  }

  static clearRun() {
    localStorage.removeItem(this.SAVE_KEY);
  }

  static hasSavedRun(): boolean {
    return localStorage.getItem(this.SAVE_KEY) !== null;
  }

  static saveMeta(meta: { honor: number; talents: string[]; unlockedClasses: string[]; unlockedSkills: string[] }) {
    localStorage.setItem(this.META_KEY, JSON.stringify(meta));
  }

  static loadMeta(): { honor: number; talents: string[]; unlockedClasses: string[]; unlockedSkills: string[] } | null {
    const data = localStorage.getItem(this.META_KEY);
    return data ? JSON.parse(data) : null;
  }
}
```

- [ ] **步骤 1**: 创建 SaveManager.ts，实现存档/读档/元数据持久化

---

### 任务 8：RouteMapUI — 路线图

**文件**:
- 创建: `assets/games/game_tiny_vanguard/scripts/ui/RouteMapUI.ts`

**功能**: 渲染树形路线图，节点可点击，滚动查看，标记已过节点。

```typescript
import { _decorator, Component, Node, ScrollView, instantiate, Prefab, Button, Label, Color, Sprite } from 'cc';
const { ccclass, property } = _decorator;

export interface RouteNode {
  id: number;
  type: 'battle' | 'elite' | 'shop' | 'rest' | 'event' | 'boss';
  row: number;
  col: number;
  connections: number[]; // IDs of reachable next nodes
  completed: boolean;
}

@ccclass('RouteMapUI')
export class RouteMapUI extends Component {
  @property({ type: ScrollView })
  scrollView: ScrollView = null;

  @property({ type: Prefab })
  nodePrefab: Prefab = null;

  @property({ type: Node })
  nodesContainer: Node = null;

  private _nodes: RouteNode[] = [];
  private _currentNodeId: number = 0;

  generateRoute(): RouteNode[] {
    // Generate a simple tree: start → 2 paths → converge → 2 paths → boss
    const nodes: RouteNode[] = [
      { id: 0, type: 'battle', row: 0, col: 0, connections: [1, 2], completed: false },
      { id: 1, type: 'battle', row: 1, col: 0, connections: [3], completed: false },
      { id: 2, type: 'battle', row: 1, col: 1, connections: [3], completed: false },
      { id: 3, type: 'shop', row: 2, col: 0, connections: [4, 5], completed: false },
      { id: 4, type: 'elite', row: 3, col: 0, connections: [6], completed: false },
      { id: 5, type: 'event', row: 3, col: 1, connections: [6], completed: false },
      { id: 6, type: 'battle', row: 4, col: 0, connections: [7, 8], completed: false },
      { id: 7, type: 'rest', row: 5, col: 0, connections: [9], completed: false },
      { id: 8, type: 'elite', row: 5, col: 1, connections: [9], completed: false },
      { id: 9, type: 'boss', row: 6, col: 0, connections: [], completed: false },
    ];
    return nodes;
  }

  renderRoute(nodes: RouteNode[]) {
    this._nodes = nodes;
    this.nodesContainer.removeAllChildren();
    for (const node of nodes) {
      const btn = instantiate(this.nodePrefab);
      btn.name = `Node_${node.id}`;
      const label = btn.getComponentInChildren(Label);
      if (label) {
        const typeIcons: Record<string, string> = {
          battle: '⚔️', elite: '🔥', shop: '🏪', rest: '💤', event: '🧪', boss: '🏆'
        };
        label.string = typeIcons[node.type] || '?';
      }
      btn.setPosition(node.col * 120 + 60, -node.row * 100 - 50);
      const button = btn.getComponent(Button);
      if (button) {
        button.interactable = this.isReachable(node.id);
        button.node.on(Button.EventType.Click, () => this.onNodeClicked(node.id));
      }
      this.nodesContainer.addChild(btn);
    }
  }

  private isReachable(nodeId: number): boolean {
    if (nodeId === 0) return true;
    const node = this._nodes.find(n => n.id === nodeId);
    if (!node) return false;
    return node.connections.some(connId => {
      const conn = this._nodes.find(n => n.id === connId);
      return conn && conn.completed;
    });
  }

  private onNodeClicked(nodeId: number) {
    this._currentNodeId = nodeId;
    // Emit event to main game manager to enter the node
  }

  completeNode(nodeId: number) {
    const node = this._nodes.find(n => n.id === nodeId);
    if (node) node.completed = true;
  }

  get currentNodeId(): number { return this._currentNodeId; }
}
```

- [ ] **步骤 1**: 创建 RouteMapUI.ts，实现路线图生成、渲染、节点可点击状态、滚动

---

### 任务 9：UpgradeUI & EventUI — 升级和事件界面

**文件**:
- 创建: `assets/games/game_tiny_vanguard/scripts/ui/UpgradeUI.ts`
- 创建: `assets/games/game_tiny_vanguard/scripts/ui/EventUI.ts`

```typescript
// UpgradeUI.ts — 三选一升级界面
@ccclass('UpgradeUI')
export class UpgradeUI extends Component {
  @property({ type: Node })
  cardContainer: Node = null;

  @property({ type: Prefab })
  cardPrefab: Prefab = null;

  showUpgradeOptions(options: UpgradeOption[], onSelect: (index: number) => void) {
    this.node.active = true;
    this.cardContainer.removeAllChildren();
    for (let i = 0; i < options.length; i++) {
      const card = instantiate(this.cardPrefab);
      const labels = card.getComponentsInChildren(Label);
      if (labels.length >= 2) {
        labels[0].string = options[i].name;
        labels[1].string = options[i].description;
      }
      const btn = card.getComponent(Button);
      if (btn) {
        btn.node.on(Button.EventType.Click, () => {
          onSelect(i);
          this.node.active = false;
        });
      }
      this.cardContainer.addChild(card);
    }
  }
}

// EventUI.ts — 事件界面
@ccclass('EventUI')
export class EventUI extends Component {
  @property({ type: Label })
  eventTitleLabel: Label = null;

  @property({ type: Label })
  eventDescLabel: Label = null;

  @property({ type: Button })
  choiceButtonPrefab: Button = null;

  @property({ type: Node })
  choiceContainer: Node = null;

  showEvent(event: EventConfig, onChoice: (index: number) => void) {
    this.node.active = true;
    if (this.eventTitleLabel) this.eventTitleLabel.string = event.name;
    if (this.eventDescLabel) this.eventDescLabel.string = event.description;
    this.choiceContainer.removeAllChildren();
    if (event.type === 'choice' && event.choices) {
      for (let i = 0; i < event.choices.length; i++) {
        const btn = instantiate(this.choiceButtonPrefab);
        const label = btn.getComponentInChildren(Label);
        if (label) label.string = event.choices[i].description;
        btn.node.on(Button.EventType.Click, () => {
          onChoice(i);
          this.node.active = false;
        });
        this.choiceContainer.addChild(btn.node);
      }
    }
  }
}
```

- [ ] **步骤 1**: 创建 UpgradeUI.ts，三选一卡片渲染
- [ ] **步骤 2**: 创建 EventUI.ts，事件展示 + 选项按钮
- [ ] **步骤 3**: 人创建预制体绑定 @property

---

### 任务 10：TinyVanguardMain — 游戏主控制器

**文件**:
- 创建: `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`

**职责**: 串联所有系统：路线图 → 战斗/商店/休息/事件 → 升级 → 循环 → Boss → 结算。

```typescript
import { _decorator, Component, Node, director } from 'cc';
import { RouteMapUI, RouteNode } from './ui/RouteMapUI';
import { BattleManager } from './battle/BattleManager';
import { UpgradeUI } from './ui/UpgradeUI';
import { EventUI } from './ui/EventUI';
import { SaveManager, RunData } from './ui/SaveManager';
import { CLASSES, ENEMIES, EVENTS } from './config/GameData';

const { ccclass, property } = _decorator;

export type GameState = 'route_map' | 'deploy' | 'battle' | 'upgrade' | 'shop' | 'rest' | 'event' | 'game_over';

@ccclass('TinyVanguardMain')
export class TinyVanguardMain extends Component {
  @property({ type: RouteMapUI })
  routeMapUI: RouteMapUI = null;

  @property({ type: BattleManager })
  battleManager: BattleManager = null;

  @property({ type: UpgradeUI })
  upgradeUI: UpgradeUI = null;

  @property({ type: EventUI })
  eventUI: EventUI = null;

  private _state: GameState = 'route_map';
  private _runData: RunData = null;

  onLoad() {
    if (SaveManager.hasSavedRun()) {
      // Offer continue option
      this._runData = SaveManager.loadRun();
    } else {
      this._runData = {
        currentRouteNode: 0,
        playerClasses: ['warrior', 'archer', 'mage'],
        unitSkills: {},
        gold: 0,
        honor: 0,
        talents: [],
        difficulty: 'normal',
        unlockedClasses: ['warrior', 'archer', 'mage', 'cleric'],
        unlockedSkills: []
      };
    }
  }

  start() {
    const nodes = this.routeMapUI.generateRoute();
    this.routeMapUI.renderRoute(nodes);
  }

  onNodeSelected(nodeId: number) {
    const node = this.getNodeById(nodeId);
    if (!node) return;
    switch (node.type) {
      case 'battle':
      case 'elite':
      case 'boss':
        this.startBattle(node);
        break;
      case 'shop':
        this.openShop();
        break;
      case 'rest':
        this.openRest();
        break;
      case 'event':
        this.triggerEvent();
        break;
    }
  }

  private onBattleEnd(victory: boolean) {
    if (victory) {
      this.routeMapUI.completeNode(this._runData.currentRouteNode);
      this._runData.gold += 10;
      SaveManager.saveRun(this._runData);
      // Show upgrade choices
      this.upgradeUI.showUpgradeOptions(this.generateUpgradeOptions(), (index) => {
        // Apply upgrade
        SaveManager.saveRun(this._runData);
        this.returnToRouteMap();
      });
    } else {
      this.onRunEnd(false);
    }
  }

  private returnToRouteMap() {
    this._state = 'route_map';
    this.routeMapUI.renderRoute(this.routeMapUI.generateRoute()); // Re-render with updated states
  }

  private onRunEnd(completed: boolean) {
    if (completed) {
      this._runData.honor += 100;
    }
    SaveManager.saveMeta({
      honor: this._runData.honor,
      talents: this._runData.talents,
      unlockedClasses: this._runData.unlockedClasses,
      unlockedSkills: this._runData.unlockedSkills
    });
    SaveManager.clearRun();
    // Show result screen, then back to lobby
  }

  private getNodeById(id: number): RouteNode | null {
    return null; // Implement
  }

  private generateUpgradeOptions(): UpgradeOption[] {
    return []; // Implement
  }

  private startBattle(node: RouteNode) { /* start battle with appropriate difficulty */ }
  private openShop() { /* open shop UI */ }
  private openRest() { /* heal all units */ }
  private triggerEvent() { /* pick random event */ }
}
```

- [ ] **步骤 1**: 创建 TinyVanguardMain.ts，实现状态机流转（路线图 → 各节点 → 循环）
- [ ] **步骤 2**: 实现胜负判定和荣誉结算

---

## 执行顺序建议

```
1. GameData.ts          ← 数据基础，所有其他模块依赖
2. SaveManager.ts       ← 存档工具
3. GridController.ts    ← 网格渲染（需要人搭场景）
4. UnitController.ts    ← 单位逻辑
5. AIController.ts      ← AI
6. BattleManager.ts     ← 战斗核心（依赖 3,4,5）
7. BattleUI.ts          ← 战斗界面（需要人绑预制体）
8. RouteMapUI.ts        ← 路线图（需要人绑预制体）
9. UpgradeUI.ts         ← 升级界面（需要人绑预制体）
10. EventUI.ts          ← 事件界面（需要人绑预制体）
11. TinyVanguardMain.ts ← 主控制器（依赖所有以上）
```

每个任务包含多个子步骤，使用 `- [ ]` 复选框跟踪进度。
