import { _decorator, Component, Node, Color, instantiate, Prefab } from 'cc';
import { GridController, GridPosition } from './GridController';
import { UnitController } from './UnitController';
import { AIController } from './AIController';
import { EnemyConfig, ENEMIES, ELITE_ENEMIES, BOSS_CONFIG, getClassById, getRandomSkillsFromPool } from '../config/GameData';

const { ccclass, property } = _decorator;

export type BattlePhase = 'deploy' | 'player_turn' | 'enemy_turn' | 'victory' | 'defeat';

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
  private _aiController: AIController = new AIController();
  private _onBattleEndCallback: ((result: BattleResult) => void) | null = null;
  private _deployedPositions: GridPosition[] = [];
  private _selectedUnit: UnitController | null = null;

  get phase(): BattlePhase { return this._phase; }
  get playerUnits(): UnitController[] { return this._playerUnits; }
  get enemyUnits(): UnitController[] { return this._enemyUnits; }
  get selectedUnit(): UnitController | null { return this._selectedUnit; }
  get turnCount(): number { return this._turnCount; }

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
      const existingId = config.id === BOSS_CONFIG.id ? 'warrior' : 'warrior';
      unitCtrl.init(existingId, false, pos);
      if (unitCtrl.data) {
        unitCtrl.data.name = config.name;
        unitCtrl.data.stats = { ...config.stats };
        unitCtrl.data.maxHp = config.stats.hp;
        unitCtrl.data.currentHp = config.stats.hp;
        unitCtrl.data.baseStats = { ...config.stats };
      }
      this._enemyUnits.push(unitCtrl);
      return unitCtrl;
    }
    return null;
  }

  private startDeployPhase(): void {
    this._phase = 'deploy';
    this.gridController.setCellClickCallback((pos) => this.onDeployCellClicked(pos));
  }

  confirmDeploy(): void {
    if (this._deployedPositions.length < this._playerUnits.length) {
      return;
    }
    this._phase = 'player_turn';
    this._turnCount = 1;
    this.gridController.setCellClickCallback((pos) => this.onCellClicked(pos));
    this.startPlayerTurn();
  }

  private onDeployCellClicked(pos: GridPosition): void {
    if (pos.row > 1) return;
    if (this.isOccupied(pos)) return;

    const nextUnit = this._playerUnits.find(u => u.data?.gridPos.col === -1);
    if (!nextUnit) return;

    nextUnit.setGridPosition(pos);
    this._deployedPositions.push(pos);
    this.gridController.highlightCells(this._deployedPositions, new Color(100, 200, 100, 255));
  }

  private startPlayerTurn(): void {
    this._currentUnitIndex = 0;
    for (const unit of this._playerUnits) {
      if (unit.data?.isAlive) {
        unit.onTurnStart();
      }
    }
    this.selectNextPlayerUnit();
  }

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
        this.highlightUnitActions(unit);
        return;
      }
      this._currentUnitIndex++;
    }
    this.endPlayerTurn();
  }

  private highlightUnitActions(unit: UnitController): void {
    if (!unit.data) return;
    this.gridController.clearHighlights();

    if (!unit.data.hasMoved) {
      const moves = this.getReachablePositions(unit.data.gridPos, unit.data.stats.move);
      this.gridController.highlightCells(moves, new Color(100, 200, 100, 180));
    }

    const attacks = this.getAttackableEnemies(unit);
    this.gridController.highlightCells(attacks, new Color(200, 100, 100, 180));
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

  onCellClicked(gridPos: GridPosition): void {
    if (this._phase !== 'player_turn') return;
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;

    const targetEnemy = this._enemyUnits.find(e =>
      e.data?.isAlive && e.data.gridPos.row === gridPos.row && e.data.gridPos.col === gridPos.col
    );

    if (targetEnemy && !unit.data.hasActed) {
      const dist = Math.abs(gridPos.row - unit.data.gridPos.row) + Math.abs(gridPos.col - unit.data.gridPos.col);
      if (dist <= unit.data.stats.range) {
        this.executeAttack(unit, targetEnemy);
        unit.data.hasActed = true;
      }
      return;
    }

    if (!unit.data.hasMoved) {
      const moves = this.getReachablePositions(unit.data.gridPos, unit.data.stats.move);
      const canMove = moves.some(m => m.row === gridPos.row && m.col === gridPos.col);
      if (canMove) {
        unit.setGridPosition(gridPos);
        this.highlightUnitActions(unit);
        return;
      }
    }

    const clickedPlayer = this._playerUnits.find(u =>
      u.data?.isAlive && u.data.gridPos.row === gridPos.row && u.data.gridPos.col === gridPos.col
    );
    if (clickedPlayer) {
      this._currentUnitIndex = this._playerUnits.indexOf(clickedPlayer);
      this.selectNextPlayerUnit();
    }
  }

  private executeAttack(attacker: UnitController, target: UnitController): void {
    const damage = target.takeDamage(attacker.data?.stats.attack ?? 0);
    if (!target.data?.isAlive) {
      this.checkBattleEnd();
    }
  }

  onSkillUsed(skillIndex: number): void {
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;
    unit.data.hasActed = true;
    unit.data.energy -= 2;
    this.selectNextPlayerUnit();
  }

  endCurrentUnitTurn(): void {
    this._currentUnitIndex++;
    this.selectNextPlayerUnit();
  }

  private endPlayerTurn(): void {
    if (this._phase !== 'player_turn') return;
    this._phase = 'enemy_turn';

    if (this._selectedUnit) {
      this._selectedUnit.setSelected(false);
      this._selectedUnit = null;
    }
    this.gridController.clearHighlights();

    this._aiController.executeEnemyTurn(this._enemyUnits, this._playerUnits);

    this.checkBattleEnd();
    if (this._phase === 'enemy_turn') {
      this._turnCount++;
      this._phase = 'player_turn';
      this.startPlayerTurn();
    }
  }

  private checkBattleEnd(): void {
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

    const goldReward = victory ? 10 + this._turnCount * 2 : 0;
    if (this._onBattleEndCallback) {
      this._onBattleEndCallback({ victory, goldReward });
    }
  }

  reviveAllUnits(): void {
    for (const unit of this._playerUnits) {
      if (unit.data && !unit.data.isAlive) {
        unit.resetForNewBattle();
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
