import { _decorator, Component, Node, Color, instantiate, Prefab } from 'cc';
import { GridController, GridPosition } from './GridController';
import { UnitController } from './UnitController';
import { AIController, AIAction } from './AIController';
import { EnemyConfig, SkillEffect, ENEMIES, ELITE_ENEMIES, BOSS_CONFIG, getClassById, getRandomSkillsFromPool } from '../config/GameData';

const { ccclass, property } = _decorator;

export type BattlePhase = 'deploy' | 'player_turn' | 'enemy_turn' | 'skill_target' | 'victory' | 'defeat';
export type UnitActionPhase = 'move' | 'action' | 'done';

export interface BattleResult {
  victory: boolean;
  goldReward: number;
}

@ccclass('BattleManager')
export class BattleManager extends Component {
  @property({ type: GridController })
  gridController: GridController = null;

  @property({ type: Prefab, tooltip: '单位预制体' })
  unitPrefab: Prefab = null;

  private _playerUnits: UnitController[] = [];
  private _enemyUnits: UnitController[] = [];
  private _currentUnitIndex: number = 0;
  private _phase: BattlePhase = 'deploy';
  private _turnCount: number = 0;
  private _unitPhase: UnitActionPhase = 'move';
  private _aiQueue: { enemy: UnitController; action: AIAction }[] = [];
  private _onUnitPhaseChanged: ((phase: BattlePhase, unit: UnitController | null, actionPhase: UnitActionPhase | null) => void) | null = null;
  private _aiController: AIController = new AIController();
  private _onBattleEndCallback: ((result: BattleResult) => void) | null = null;
  private _onDamageDealtCallback: ((targetNode: Node, amount: number) => void) | null = null;
  private _onAutoSkipCallback: ((unitName: string) => void) | null = null;
  private _deployedPositions: GridPosition[] = [];
  private _selectedDeployUnitIndex: number = -1;
  private _onDeployUnitPlacedCallback: ((placedCount: number, totalCount: number) => void) | null = null;
  private _onDeploySelectionChanged: ((index: number) => void) | null = null;
  private _selectedUnit: UnitController | null = null;
  private _pendingSkill: import('../config/GameData').SkillConfig | null = null;
  private _skillTargets: GridPosition[] = [];
  private _totalDamageDealt: number = 0;
  private _currentBattleType: 'normal' | 'elite' | 'boss' = 'normal';
  private _autoSkipUnitRef: UnitController | null = null;

  get phase(): BattlePhase { return this._phase; }
  get playerUnits(): UnitController[] { return this._playerUnits; }
  get enemyUnits(): UnitController[] { return this._enemyUnits; }
  get selectedUnit(): UnitController | null { return this._selectedUnit; }
  get turnCount(): number { return this._turnCount; }
  get totalDamageDealt(): number { return this._totalDamageDealt; }

  setUnitPhaseChangedCallback(cb: typeof this._onUnitPhaseChanged): void {
    this._onUnitPhaseChanged = cb;
  }

  startBattle(
    playerClasses: string[],
    difficulty: number,
    isElite: boolean,
    isBoss: boolean,
    onEnd: (result: BattleResult) => void
  ): void {
    this._onBattleEndCallback = onEnd;
    this._phase = 'deploy';
    this._turnCount = 0;
    this._deployedPositions = [];
    
    if (isBoss) {
      this._currentBattleType = 'boss';
    } else if (isElite) {
      this._currentBattleType = 'elite';
    } else {
      this._currentBattleType = 'normal';
    }

    this.clearAllUnits();
    this.createPlayerUnits(playerClasses);
    this.createEnemyUnits(difficulty, isElite, isBoss);
    this.startDeployPhase();
  }

  private clearAllUnits(): void {
    const allUnits = [...this._playerUnits, ...this._enemyUnits];
    for (const unit of allUnits) {
      if (unit?.node?.isValid) {
        unit.node.destroy();
      }
    }
    this._playerUnits = [];
    this._enemyUnits = [];
    this._selectedUnit = null;
    this._totalDamageDealt = 0;
  }

  private createPlayerUnits(playerClasses: string[]): void {
    for (let i = 0; i < playerClasses.length; i++) {
      const unitNode = instantiate(this.unitPrefab);
      unitNode.name = `Player_${playerClasses[i]}`;
      this.node.addChild(unitNode);

      const unitCtrl = unitNode.getComponent(UnitController);
      if (unitCtrl) {
        const classConfig = getClassById(playerClasses[i]);
        const startingPos = { row: i, col: -1 };
        unitCtrl.init(playerClasses[i], true, startingPos);
        if (classConfig) {
          const startingSkill = getRandomSkillsFromPool([classConfig.startingSkillId], 1);
          if (startingSkill.length > 0) {
            unitCtrl.addSkill(startingSkill[0]);
          }
        }
        this._playerUnits.push(unitCtrl);
      }
    }
  }

  private createEnemyUnits(difficulty: number, isElite: boolean, isBoss: boolean): void {
    let enemyConfigs: EnemyConfig[];

    if (isBoss) {
      const bossUnit = this.spawnEnemy(BOSS_CONFIG as EnemyConfig, { row: 5, col: 3 });
      if (bossUnit) {
        this._enemyUnits.push(bossUnit);
      }
      enemyConfigs = [
        { ...ENEMIES[0], stats: { ...ENEMIES[0].stats, hp: Math.floor(ENEMIES[0].stats.hp * (1 + difficulty * 0.1)) } },
        { ...ENEMIES[1], stats: { ...ENEMIES[1].stats, hp: Math.floor(ENEMIES[1].stats.hp * (1 + difficulty * 0.1)) } },
      ];
    } else if (isElite) {
      const elitePool = isElite ? ELITE_ENEMIES : ENEMIES;
      const count = Math.min(3 + difficulty, elitePool.length);
      enemyConfigs = [];
      for (let i = 0; i < count; i++) {
        const config = { ...elitePool[i % elitePool.length] };
        config.stats = { ...config.stats, hp: Math.floor(config.stats.hp * (1 + difficulty * 0.1)) };
        enemyConfigs.push(config);
      }
    } else {
      const count = Math.min(2 + difficulty, ENEMIES.length);
      enemyConfigs = [];
      for (let i = 0; i < count; i++) {
        const config = { ...ENEMIES[i % ENEMIES.length] };
        config.stats = { ...config.stats, hp: Math.floor(config.stats.hp * (1 + difficulty * 0.1)) };
        enemyConfigs.push(config);
      }
    }

    const cols = [1, 2, 3, 4];
    for (let i = 0; i < enemyConfigs.length; i++) {
      const col = cols[i % cols.length];
      const row = 5 - Math.floor(i / 2);
      this.spawnEnemy(enemyConfigs[i], { row, col });
    }
  }

  private spawnEnemy(config: EnemyConfig, pos: GridPosition): UnitController | null {
    const unitNode = instantiate(this.unitPrefab);
    unitNode.name = `Enemy_${config.name}`;
    this.node.addChild(unitNode);

    const unitCtrl = unitNode.getComponent(UnitController);
    if (unitCtrl) {
      unitCtrl.initFromEnemyConfig(config, pos);
      this._enemyUnits.push(unitCtrl);
      return unitCtrl;
    }
    return null;
  }

  private startDeployPhase(): void {
    this._phase = 'deploy';
    this._highlightDeployArea();
    this.gridController.setCellClickCallback((pos) => this.onDeployCellClicked(pos));
    // 自动选中第一张卡
    this._selectedDeployUnitIndex = 0;
    if (this._onDeploySelectionChanged) {
      this._onDeploySelectionChanged(0);
    }
    // 禁用后 4 行格子交互
    this.gridController.setRowsInteractable([2, 3, 4, 5], false);
    // 隐藏棋盘外单位（防左侧出现重复的"三个方框"）
    for (const unit of this._playerUnits) {
      if (unit.node?.isValid && unit.data?.gridPos.col < 0) {
        unit.node.active = false;
      }
    }
  }

  public highlightDeployArea(): void {
    this._highlightDeployArea();
  }

  private _highlightDeployArea(): void {
    this.gridController.clearHighlights();

    // 顶部两行：浅绿色（可部署区域，玩家在己方半场部署）
    const deployableColor = new Color(150, 230, 150, 180);
    for (let c = 0; c < 6; c++) {
      this.gridController.setCellColor({ row: 0, col: c }, deployableColor);
      this.gridController.setCellColor({ row: 1, col: c }, deployableColor);
    }

    // 底部四行：淡灰色（不可部署区域，敌方区域）
    const disabledColor = new Color(200, 200, 200, 100);
    for (let r = 2; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        this.gridController.setCellColor({ row: r, col: c }, disabledColor);
      }
    }

    // 已部署位置：深绿色（覆盖之前的颜色）
    const placedColor = new Color(100, 200, 100, 220);
    for (const pos of this._deployedPositions) {
      this.gridController.setCellColor(pos, placedColor);
    }
  }

  setDamageDealtCallback(callback: (targetNode: Node, amount: number) => void): void {
    this._onDamageDealtCallback = callback;
  }

  setAutoSkipCallback(callback: (unitName: string) => void): void {
    this._onAutoSkipCallback = callback;
  }

  confirmDeploy(): boolean {
    if (this._deployedPositions.length < this._playerUnits.length) {
      return false;
    }
    return true;
  }

  // 动画完成后调用，真正开始战斗
  startBattleAfterAnimation(): void {
    this._phase = 'player_turn';
    this._turnCount = 1;
    this.gridController.setCellClickCallback((pos) => this.onCellClicked(pos));
    this.gridController.setRowsInteractable([2, 3, 4, 5], true);
    // 确保所有单位节点可见（防止 col=-1 的单位因为之前的隐藏而不可见）
    for (const unit of this._playerUnits) {
      if (unit.node?.isValid && unit.data?.isAlive) {
        unit.node.active = true;
      }
    }
    this.startPlayerTurn();
  }

  setDeployUnitPlacedCallback(cb: (placedCount: number, totalCount: number) => void): void {
    this._onDeployUnitPlacedCallback = cb;
  }

  setDeploySelectionChangedCallback(cb: (index: number) => void): void {
    this._onDeploySelectionChanged = cb;
  }

  selectDeployUnit(index: number): void {
    if (index < 0 || index >= this._playerUnits.length) return;
    const unit = this._playerUnits[index];
    if (!unit.data) return;

    // 如果该单位已放置（col >= 0），则取消放置
    if (unit.data.gridPos.col >= 0) {
      const oldPos = unit.data.gridPos;
      // 从已部署列表中移除
      this._deployedPositions = this._deployedPositions.filter(
        p => !(p.row === oldPos.row && p.col === oldPos.col)
      );
      // 重置单位位置到棋盘外
      unit.data.gridPos = { row: index, col: -1 };
      unit.data.hasMoved = false;
      // 重新定位节点到棋盘外（与 init 时 updatePosition 的计算一致）
      unit.node.setPosition(
        (-1 - 2.5) * GridController.CELL_SIZE,
        (index - 2.5) * GridController.CELL_SIZE
      );
      // 隐藏单位节点（撤回后不显示在棋盘外）
      if (unit.node?.isValid) {
        unit.node.active = false;
      }
      // 通知 UI 取消状态
      if (this._onDeployUnitPlacedCallback) {
        this._onDeployUnitPlacedCallback(this._deployedPositions.length, this._playerUnits.length);
      }
      // 重新高亮部署区域
      this._highlightDeployArea();
      // 自动选中刚才撤回的卡
      this._selectedDeployUnitIndex = index;
      if (this._onDeploySelectionChanged) {
        this._onDeploySelectionChanged(index);
      }
      return;
    }

    // 未放置，正常进入选中
    this._selectedDeployUnitIndex = index;
    this._highlightDeployArea();
    // 分发选中通知
    if (this._onDeploySelectionChanged) {
      this._onDeploySelectionChanged(this._selectedDeployUnitIndex);
    }
  }

  private onDeployCellClicked(pos: GridPosition): void {
    if (pos.row > 1) return;

    // 如果该格子有己方单位 → 撤回（通过 selectDeployUnit 触发）
    const existingIndex = this._playerUnits.findIndex(
      u => u.data?.gridPos.row === pos.row && u.data?.gridPos.col === pos.col
    );
    if (existingIndex >= 0) {
      this.selectDeployUnit(existingIndex);
      return;
    }

    if (this._selectedDeployUnitIndex < 0) return;
    if (this.isOccupied(pos)) return;

    const unit = this._playerUnits[this._selectedDeployUnitIndex];
    if (!unit?.data) return;
    if (unit.data.gridPos.col >= 0) return;

    unit.setGridPosition(pos);
    this._deployedPositions.push(pos);

    // 显示单位节点（放置到棋盘上后可见）
    if (unit.node?.isValid) {
      unit.node.active = true;
    }

    // 重新高亮整个部署区域（顶部两行绿色 + 底部四行灰色 + 已部署位置深绿）
    this._highlightDeployArea();
    // 先通知 UI 卡片放置状态变化，再切换选中（避免选中态被覆盖）
    if (this._onDeployUnitPlacedCallback) {
      this._onDeployUnitPlacedCallback(this._deployedPositions.length, this._playerUnits.length);
    }
    // 自动选中下一张未放置的卡
    const nextIndex = this._playerUnits.findIndex(
      (u, i) => i !== this._selectedDeployUnitIndex && u.data?.gridPos.col < 0
    );
    if (nextIndex >= 0) {
      this._selectedDeployUnitIndex = nextIndex;
      if (this._onDeploySelectionChanged) {
        this._onDeploySelectionChanged(nextIndex);
      }
    } else {
      this._selectedDeployUnitIndex = -1;
    }
  }

  private startPlayerTurn(): void {
    this._currentUnitIndex = 0;
    for (const unit of this._playerUnits) {
      if (unit.data?.isAlive) {
        unit.onTurnStart(this._playerUnits);
      }
    }
    this.selectNextPlayerUnit();
  }

  private selectNextPlayerUnit(): void {
    // 取消任何未完成的自动跳过延迟，防止用户切换单位后回调冲突
    this._cancelAutoSkip();

    if (this._selectedUnit) {
      this._selectedUnit.setSelected(false);
      this._selectedUnit = null;
    }
    this.gridController.clearHighlights();

    // 从 0 开始遍历，确保不会跳过前面未行动的单位
    for (let i = 0; i < this._playerUnits.length; i++) {
      const unit = this._playerUnits[i];
      if (unit.data?.isAlive && !unit.data.hasActed) {
        this._currentUnitIndex = i;
        this._selectedUnit = unit;
        unit.setSelected(true);
        this._unitPhase = 'move';
        this.highlightMoveRange(unit);
        // 标记选中单位所在格子
        this.gridController.highlightSelectedCell(unit.data.gridPos);
        if (this._onUnitPhaseChanged) {
          this._onUnitPhaseChanged('player_turn', unit, 'move');
        }
        return;
      }
    }
    this.endPlayerTurn();
  }

  private highlightMoveRange(unit: UnitController): void {
    this.gridController.clearHighlights();
    if (!unit.data) return;
    if (!unit.data.hasMoved) {
      const moves = this.getReachablePositions(unit.data.gridPos, unit.data.stats.move);
      this.gridController.highlightCells(moves, new Color(100, 200, 100, 180));
    } else {
      this._unitPhase = 'action';
      this.highlightAttackRange(unit);
    }
    // 始终标记选中单位所在格子
    this.gridController.highlightSelectedCell(unit.data.gridPos);
  }

  private highlightAttackRange(unit: UnitController): void {
    this.gridController.clearHighlights();
    if (!unit.data) return;
    const attacks = this.getAttackableEnemies(unit);
    this.gridController.highlightCells(attacks, new Color(200, 100, 100, 180));
    // 始终标记选中单位所在格子
    this.gridController.highlightSelectedCell(unit.data.gridPos);
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

  private getAttackableEnemies(unit: UnitController): GridPosition[] {
    if (!unit.data) return [];
    const pos = unit.data.gridPos;
    const range = unit.data.stats.range;
    const targets = this._enemyUnits.filter(u => u.data?.isAlive);

    return targets
      .filter(t => {
        const dist = Math.abs(t.data!.gridPos.row - pos.row) + Math.abs(t.data!.gridPos.col - pos.col);
        return dist <= range;
      })
      .map(t => t.data!.gridPos);
  }

  private isOccupied(pos: GridPosition): boolean {
    for (const u of this._playerUnits) {
      if (u.data?.isAlive && u.data.gridPos.row === pos.row && u.data.gridPos.col === pos.col) return true;
    }
    for (const u of this._enemyUnits) {
      if (u.data?.isAlive && u.data.gridPos.row === pos.row && u.data.gridPos.col === pos.col) return true;
    }
    return false;
  }

  private handleMovePhase(unit: UnitController, gridPos: GridPosition): void {
    if (unit.data.gridPos.row === gridPos.row && unit.data.gridPos.col === gridPos.col) {
      unit.data.hasMoved = true;
      this._unitPhase = 'action';
      this.highlightAttackRange(unit);
      if (this._onUnitPhaseChanged) {
        this._onUnitPhaseChanged('player_turn', unit, 'action');
      }
      this._checkAutoSkipIfNoTargets(unit);
      return;
    }
    if (unit.data.hasMoved) return;
    const moves = this.getReachablePositions(unit.data.gridPos, unit.data.stats.move);
    const canMove = moves.some(m => m.row === gridPos.row && m.col === gridPos.col);
    if (!canMove) return;
    unit.setGridPosition(gridPos);
    this._unitPhase = 'action';
    this.highlightAttackRange(unit);
    if (this._onUnitPhaseChanged) {
      this._onUnitPhaseChanged('player_turn', unit, 'action');
    }
    return;
  }

  private _checkAutoSkipIfNoTargets(unit: UnitController): void {
    if (!unit.data) return;
    const targets = this.getAttackableEnemies(unit);
    if (targets.length === 0) {
      // 通知 UI 显示自动跳过提示
      if (this._onAutoSkipCallback) {
        this._onAutoSkipCallback(unit.data.name);
      }
      unit.data.hasActed = true;
      this._autoSkipUnitRef = unit;
      // 延迟跳过，让玩家看到提示
      this.scheduleOnce(this._onAutoSkipTimeout, 0.6);
    }
  }

  private _cancelAutoSkip(): void {
    if (this._autoSkipUnitRef) {
      this._autoSkipUnitRef = null;
      this.unschedule(this._onAutoSkipTimeout);
    }
  }

  private _onAutoSkipTimeout(): void {
    if (!this._autoSkipUnitRef?.data?.isAlive) {
      this._autoSkipUnitRef = null;
      return;
    }
    this._autoSkipUnitRef = null;
    this.finishUnitTurn();
  }

  private handleActionPhase(unit: UnitController, gridPos: GridPosition): void {
    if (unit.data.hasActed) return;
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
  }

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

  waitCurrentUnit(): void {
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;
    unit.data.hasActed = true;
    this.finishUnitTurn();
  }

  onCellClicked(gridPos: GridPosition): void {
    if (this._phase === 'skill_target') {
      this.handleSkillTargetClick(gridPos);
      return;
    }
    if (this._phase !== 'player_turn') return;
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;

    const clickedPlayer = this._playerUnits.find(u =>
      u.data?.isAlive && u.data.gridPos.row === gridPos.row && u.data.gridPos.col === gridPos.col
    );
    if (clickedPlayer && clickedPlayer !== unit && !clickedPlayer.data.hasActed) {
      this._currentUnitIndex = this._playerUnits.indexOf(clickedPlayer);
      this.selectNextPlayerUnit();
      return;
    }

    if (this._unitPhase === 'move') {
      // 移动阶段点击自己 = 原地不动，进入行动阶段
      if (unit.data.gridPos.row === gridPos.row && unit.data.gridPos.col === gridPos.col) {
        unit.data.hasMoved = true;
        this._unitPhase = 'action';
        this.highlightAttackRange(unit);
        if (this._onUnitPhaseChanged) {
          this._onUnitPhaseChanged('player_turn', unit, 'action');
        }
        return;
      }
      this.handleMovePhase(unit, gridPos);
    } else if (this._unitPhase === 'action') {
      // 行动阶段点击自己 = 不处理（必须通过等待按钮或攻击来结束）
      if (unit.data.gridPos.row === gridPos.row && unit.data.gridPos.col === gridPos.col) {
        return;
      }
      this.handleActionPhase(unit, gridPos);
    }
  }

  private handleSkillTargetClick(gridPos: GridPosition): void {
    const isTarget = this._skillTargets.some(t => t.row === gridPos.row && t.col === gridPos.col);
    if (!isTarget) {
      this._pendingSkill = null;
      this._skillTargets = [];
      this._phase = 'player_turn';
      this.highlightAttackRange(this._selectedUnit!);
      return;
    }

    const unit = this._selectedUnit;
    if (!unit?.data || !this._pendingSkill) return;
    const skillIndex = this._pendingSkill['_skillIndex'] as number;
    unit.useSkill(skillIndex);

    const targetUnit = [...this._enemyUnits, ...this._playerUnits].find(u =>
      u.data?.isAlive && u.data.gridPos.row === gridPos.row && u.data.gridPos.col === gridPos.col
    );

    this.executeSkillEffects(unit, targetUnit, gridPos, this._pendingSkill.effects);

    this._pendingSkill = null;
    this._skillTargets = [];

    unit.data.hasActed = true;
    this.finishUnitTurn();
  }

  private _getMarkBonus(target: UnitController): number {
    if (!target?.data) return 0;
    const markBuff = target.data.buffs.find(b => b.type === 'mark');
    return markBuff ? (markBuff.params.amount ?? 2) : 0;
  }

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
        case 'ignore_defense':
          break;

        case 'damage': {
          if (!target?.data) break;
          const rawDmg = effect.params.amount ?? 0;
          const markBonus = this._getMarkBonus(target);
          const totalDmg = Math.floor(rawDmg * skillMultiplier) + markBonus;
          const dmg = target.takeDamage(totalDmg, ignoreDefense, caster);
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
          const dmg = target.takeDamage(rawDmg + markBonus, ignoreDefense, caster);
          this._totalDamageDealt += dmg;
          if (dmg > 0 && this._onDamageDealtCallback && target.node?.isValid) {
            this._onDamageDealtCallback(target.node, dmg);
          }
          break;
        }

        case 'heal': {
          if (!target?.data) break;
          target.heal(effect.params.amount ?? 4);
          break;
        }

        case 'multi_attack': {
          if (!target?.data) break;
          const count = effect.params.count ?? 2;
          const mult = effect.params.multiplier ?? 0.7;
          for (let i = 0; i < count; i++) {
            const markBonus = this._getMarkBonus(target);
            const rawDmg = Math.floor(caster.data.stats.attack * mult * skillMultiplier);
            const dmg = target.takeDamage(rawDmg + markBonus, ignoreDefense, caster);
            this._totalDamageDealt += dmg;
            if (dmg > 0 && this._onDamageDealtCallback && target.node?.isValid) {
              this._onDamageDealtCallback(target.node, dmg);
            }
            if (!target.data.isAlive) break;
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
          const dmg = target.takeDamage(rawDmg + markBonus, ignoreDefense, caster);
          this._totalDamageDealt += dmg;
          if (dmg > 0 && this._onDamageDealtCallback && target.node?.isValid) {
            this._onDamageDealtCallback(target.node, dmg);
          }
          break;
        }

        case 'bonus_damage': {
          if (!target?.data) break;
          const markBonus = this._getMarkBonus(target);
          const bonusRaw = caster.data.stats.attack + (effect.params.amount ?? 2);
          const totalDmg = Math.floor(bonusRaw * skillMultiplier) + markBonus;
          const dmg = target.takeDamage(totalDmg, ignoreDefense, caster);
          this._totalDamageDealt += dmg;
          if (dmg > 0 && this._onDamageDealtCallback && target.node?.isValid) {
            this._onDamageDealtCallback(target.node, dmg);
          }
          break;
        }

        case 'aoe_adjacent': {
          const mult2 = effect.params.multiplier ?? 1.0;
          const baseDmg = Math.floor(caster.data.stats.attack * mult2 * skillMultiplier);
          for (const enemy of this._enemyUnits) {
            if (enemy.data?.isAlive && caster.data) {
              const dist = Math.abs(enemy.data.gridPos.row - caster.data.gridPos.row) +
                Math.abs(enemy.data.gridPos.col - caster.data.gridPos.col);
              if (dist <= 1) {
                const markBonus = this._getMarkBonus(enemy);
                const dmg = enemy.takeDamage(baseDmg + markBonus, ignoreDefense, caster);
                this._totalDamageDealt += dmg;
                if (dmg > 0 && this._onDamageDealtCallback && enemy.node?.isValid) {
                  this._onDamageDealtCallback(enemy.node, dmg);
                }
              }
            }
          }
          break;
        }

        case 'aoe_1radius': {
          const mult3 = effect.params.multiplier ?? 1.5;
          const baseDmg = Math.floor(caster.data.stats.attack * mult3 * skillMultiplier);
          const center = target?.data?.gridPos ?? targetPos ?? caster.data.gridPos;
          for (const enemy of this._enemyUnits) {
            if (enemy.data?.isAlive) {
              const dist = Math.abs(enemy.data.gridPos.row - center.row) +
                Math.abs(enemy.data.gridPos.col - center.col);
              if (dist <= 1) {
                const markBonus = this._getMarkBonus(enemy);
                const dmg = enemy.takeDamage(baseDmg + markBonus, ignoreDefense, caster);
                this._totalDamageDealt += dmg;
                if (dmg > 0 && this._onDamageDealtCallback && enemy.node?.isValid) {
                  this._onDamageDealtCallback(enemy.node, dmg);
                }
              }
            }
          }
          break;
        }

        case 'aoe_3x3': {
          const mult4 = effect.params.multiplier ?? 0.6;
          const baseDmg = Math.floor(caster.data.stats.attack * mult4 * skillMultiplier);
          const center = target?.data?.gridPos ?? targetPos ?? caster.data.gridPos;
          for (const enemy of this._enemyUnits) {
            if (enemy.data?.isAlive) {
              const dr = Math.abs(enemy.data.gridPos.row - center.row);
              const dc = Math.abs(enemy.data.gridPos.col - center.col);
              if (dr <= 1 && dc <= 1) {
                const markBonus = this._getMarkBonus(enemy);
                const dmg = enemy.takeDamage(baseDmg + markBonus, ignoreDefense, caster);
                this._totalDamageDealt += dmg;
                if (dmg > 0 && this._onDamageDealtCallback && enemy.node?.isValid) {
                  this._onDamageDealtCallback(enemy.node, dmg);
                }
              }
            }
          }
          break;
        }

        case 'aoe_heal': {
          const radius = effect.params.radius ?? 2;
          const amount = effect.params.amount ?? 3;
          const center = target?.data?.gridPos ?? targetPos ?? caster.data.gridPos;
          for (const ally of this._playerUnits) {
            if (ally.data?.isAlive) {
              const dist = Math.abs(ally.data.gridPos.row - center.row) +
                Math.abs(ally.data.gridPos.col - center.col);
              if (dist <= radius) {
                ally.heal(amount);
              }
            }
          }
          break;
        }

        case 'chain': {
          if (!target?.data) break;
          const chainCount = effect.params.chainCount ?? 2;
          const chainMult = effect.params.multiplier ?? 0.8;
          const baseChainDmg = Math.floor(caster.data.stats.attack * chainMult * skillMultiplier);
          const markBonus = this._getMarkBonus(target);
          const mainDmg = target.takeDamage(baseChainDmg + markBonus, ignoreDefense, caster);
          this._totalDamageDealt += mainDmg;
          if (mainDmg > 0 && this._onDamageDealtCallback && target.node?.isValid) {
            this._onDamageDealtCallback(target.node, mainDmg);
          }
          const otherEnemies = this._enemyUnits.filter(e =>
            e !== target && e.data?.isAlive
          );
          otherEnemies.sort((a, b) => {
            const da = Math.abs(a.data!.gridPos.row - target!.data!.gridPos.row) +
              Math.abs(a.data!.gridPos.col - target!.data!.gridPos.col);
            const db = Math.abs(b.data!.gridPos.row - target!.data!.gridPos.row) +
              Math.abs(b.data!.gridPos.col - target!.data!.gridPos.col);
            return da - db;
          });
          for (let i = 0; i < Math.min(chainCount, otherEnemies.length); i++) {
            const chainTarget = otherEnemies[i];
            const chainMarkBonus = this._getMarkBonus(chainTarget);
            const chainDmg = chainTarget.takeDamage(baseChainDmg + chainMarkBonus, ignoreDefense, caster);
            this._totalDamageDealt += chainDmg;
            if (chainDmg > 0 && this._onDamageDealtCallback && chainTarget.node?.isValid) {
              this._onDamageDealtCallback(chainTarget.node, chainDmg);
            }
            if (!chainTarget.data?.isAlive) break;
          }
          break;
        }

        case 'knockback': {
          if (!target?.data || !caster.data) break;
          const distance = effect.params.distance ?? 1;
          const dir = {
            row: target.data.gridPos.row - caster.data.gridPos.row,
            col: target.data.gridPos.col - caster.data.gridPos.col,
          };
          const newRow = target.data.gridPos.row + (dir.row !== 0 ? Math.sign(dir.row) * distance : 0);
          const newCol = target.data.gridPos.col + (dir.col !== 0 ? Math.sign(dir.col) * distance : 0);
          if (newRow >= 0 && newRow < 6 && newCol >= 0 && newCol < 6 && !this.isOccupied({ row: newRow, col: newCol })) {
            target.setGridPosition({ row: newRow, col: newCol });
          }
          break;
        }

        case 'retreat': {
          if (!caster.data || !target?.data) break;
          const retreatDist = effect.params.distance ?? 1;
          const retreatDir = {
            row: caster.data.gridPos.row - target.data.gridPos.row,
            col: caster.data.gridPos.col - target.data.gridPos.col,
          };
          const newRow = caster.data.gridPos.row + (retreatDir.row !== 0 ? Math.sign(retreatDir.row) * retreatDist : 0);
          const newCol = caster.data.gridPos.col + (retreatDir.col !== 0 ? Math.sign(retreatDir.col) * retreatDist : 0);
          if (newRow >= 0 && newRow < 6 && newCol >= 0 && newCol < 6 && !this.isOccupied({ row: newRow, col: newCol })) {
            caster.setGridPosition({ row: newRow, col: newCol });
          }
          break;
        }

        case 'teleport': {
          if (!caster.data || !targetPos) break;
          caster.setGridPosition(targetPos);
          break;
        }

        case 'shield': {
          const targetUnit = target ?? caster;
          if (targetUnit?.data) {
            targetUnit.data.shieldAmount += effect.params.amount ?? 3;
          }
          break;
        }

        case 'buff_attack': {
          const buffTarget = target ?? caster;
          buffTarget?.addBuff('buff_attack', effect.params.duration ?? 99, { amount: effect.params.amount ?? 2 });
          break;
        }

        case 'buff_move': {
          const buffTarget = target ?? caster;
          buffTarget?.addBuff('buff_move', effect.params.duration ?? 1, { amount: effect.params.amount ?? 2 });
          break;
        }

        case 'mark': {
          if (target) {
            target.addBuff('mark', effect.params.duration ?? 2, { amount: effect.params.amount ?? 2 });
          }
          break;
        }

        case 'immobilize': {
          if (target) {
            target.addBuff('immobilize', effect.params.duration ?? 1, {});
          }
          break;
        }

        case 'buff_next_skill': {
          caster.addBuff('buff_next_skill', 99, { multiplier: effect.params.multiplier ?? 1.5 });
          break;
        }
      }
    }
    
    if (nextSkillBuff && caster.data) {
      caster.data.buffs = caster.data.buffs.filter(b => b.type !== 'buff_next_skill');
    }
    
    if (caster.data && caster.hasPassive('poison_arrows') && target?.data && !target.data.isPlayer) {
      target.addBuff('poison', 2, { damage: 1 });
    }
    this.checkBattleEnd();
  }

  private executeAttack(attacker: UnitController, target: UnitController): void {
    const damage = target.takeDamage(attacker.data?.stats.attack ?? 0, false, attacker);
    this._totalDamageDealt += damage;
    if (this._onDamageDealtCallback && target.node?.isValid) {
      this._onDamageDealtCallback(target.node, damage);
    }
    // 攻击后触发被动
    if (attacker.data && attacker.hasPassive('poison_arrows')) {
      target.addBuff('poison', 2, { damage: 1 });
    }
    if (!target.data?.isAlive) {
      this.checkBattleEnd();
    }
  }

  onSkillUsed(skillIndex: number): void {
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;
    const skill = unit.peekSkill(skillIndex);
    if (!skill) return;
    
    if (skill.preMove && unit.data.preMoveSkillUsed) {
      return;
    }
    
    if (skill.targetType === 'self') {
      // pre-move 技能不消耗行动次数（仅消耗能量），后续仍可攻击
      unit.useSkill(skillIndex, !skill.preMove);
      if (unit.data) {
        this.executeSkillEffects(unit, unit, unit.data.gridPos, skill.effects);
      }
      
      if (skill.preMove) {
        unit.data.preMoveSkillUsed = true;
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
      this._pendingSkill = skill;
      this._pendingSkill['_skillIndex'] = skillIndex;
      this._phase = 'skill_target';
      this._skillTargets = this.getValidSkillTargets(unit, skill);
      this.gridController.highlightCells(this._skillTargets, new Color(255, 200, 50, 200));
    }
  }

  private getValidSkillTargets(unit: UnitController, skill: import('../config/GameData').SkillConfig): GridPosition[] {
    if (!unit.data) return [];
    if (skill.targetType === 'enemy') {
      return this._enemyUnits
        .filter(e => e.data?.isAlive)
        .map(e => e.data!.gridPos);
    }
    if (skill.targetType === 'ally') {
      return this._playerUnits
        .filter(p => p.data?.isAlive && p.data.id !== unit.data.id)
        .map(p => p.data!.gridPos);
    }
    if (skill.targetType === 'aoe') {
      return this._enemyUnits
        .filter(e => e.data?.isAlive)
        .map(e => e.data!.gridPos);
    }
    if (skill.targetType === 'tile') {
      const range = skill.effects.find(e => e.type === 'teleport')?.params?.range ?? 3;
      const pos = unit.data.gridPos;
      const tiles: GridPosition[] = [];
      for (let r = -range; r <= range; r++) {
        for (let c = -range; c <= range; c++) {
          if (Math.abs(r) + Math.abs(c) > range) continue;
          const row = pos.row + r;
          const col = pos.col + c;
          if (row < 0 || row >= 6 || col < 0 || col >= 6) continue;
          if (this.isOccupied({ row, col })) continue;
          tiles.push({ row, col });
        }
      }
      return tiles;
    }
    return [];
  }

  endCurrentUnitTurn(): void {
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;
    unit.data.hasActed = true;
    this.finishUnitTurn();
  }

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

    const aliveEnemies = this._enemyUnits.filter(u => u.data?.isAlive);
    for (const enemy of aliveEnemies) {
      enemy.onTurnStart();
    }
    const actions = this._aiController.decideAll(this._enemyUnits, this._playerUnits);
    this._aiQueue = aliveEnemies.map((enemy, i) => ({
      enemy,
      action: actions[i] ?? { moveTo: { ...enemy.data?.gridPos ?? { row: 0, col: 0 } }, attackTarget: null },
    }));

    this._processNextAIUnit();
  }

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

  private checkBattleEnd(): void {
    // 死亡单位立即隐藏（敌方单位死亡不消失 bug 修复）
    for (const u of this._enemyUnits) {
      if (!u.data?.isAlive && u.node?.isValid) {
        u.node.active = false;
      }
    }
    for (const u of this._playerUnits) {
      if (!u.data?.isAlive && u.node?.isValid) {
        u.node.active = false;
      }
    }
    const allEnemiesDead = this._enemyUnits.every(u => !u.data?.isAlive);
    const allPlayersDead = this._playerUnits.every(u => !u.data?.isAlive);

    if (allEnemiesDead) {
      this._phase = 'victory';
      this.onBattleEnd(true);
    } else if (allPlayersDead) {
      this._phase = 'defeat';
      this.onBattleEnd(false);
    }
  }

  private onBattleEnd(victory: boolean): void {
    if (this._selectedUnit) {
      this._selectedUnit.setSelected(false);
      this._selectedUnit = null;
    }
    this.gridController.clearHighlights();

    // 战斗结束后：胜利方保持显示，失败方隐藏（避免棋盘杂乱）
    if (victory) {
      // 胜利：隐藏所有敌方单位，友方单位保持显示
      for (const enemy of this._enemyUnits) {
        if (enemy.node?.isValid) {
          enemy.node.active = false;
        }
      }
    } else {
      // 失败：隐藏所有友方单位，敌方保持显示
      for (const player of this._playerUnits) {
        if (player.node?.isValid) {
          player.node.active = false;
        }
      }
    }

    let goldReward = 0;
    if (victory) {
      if (this._currentBattleType === 'boss') {
        goldReward = 30;
      } else if (this._currentBattleType === 'elite') {
        goldReward = 15 + Math.floor(Math.random() * 6);
      } else {
        goldReward = 5 + Math.floor(Math.random() * 6);
      }
    }

    if (this._onBattleEndCallback) {
      this._onBattleEndCallback({ victory, goldReward });
    }
  }

  reviveAllUnits(): void {
    for (const unit of this._playerUnits) {
      if (unit.data) {
        unit.resetForNewBattle();
        // 阵亡单位重新显示
        if (unit.node?.isValid) {
          unit.node.active = true;
        }
      }
    }
  }

  onDestroy(): void {
    this._playerUnits = [];
    this._enemyUnits = [];
    this._selectedUnit = null;
    this._onBattleEndCallback = null;
    this._aiController = null;
  }
}
