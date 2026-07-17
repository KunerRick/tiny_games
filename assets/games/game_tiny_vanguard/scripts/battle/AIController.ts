import { UnitController } from './UnitController';
import { GridPosition, GridController } from './GridController';
import { AIType } from '../config/GameData';

export interface AIAction {
  moveTo: GridPosition;
  attackTarget: UnitController | null;
}

export class AIController {
  decideAll(enemies: UnitController[], players: UnitController[]): AIAction[] {
    const aliveEnemies = enemies.filter(u => u.data?.isAlive);
    const actionableEnemies = aliveEnemies.filter(u => !u.data.hasActed);
    const alivePlayers = players.filter(u => u.data?.isAlive);
    const occupied = this.getAllOccupiedPositions(enemies, players);
    const actions: AIAction[] = [];

    for (const enemy of actionableEnemies) {
      if (!enemy.data?.isAlive || enemy.data.hasActed) continue;

      const currentPos = enemy.data.gridPos;
      const posIdx = occupied.findIndex(
        p => p.row === currentPos.row && p.col === currentPos.col
      );
      if (posIdx >= 0) occupied.splice(posIdx, 1);

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
          action = this.decideAggressive(enemy, alivePlayers, occupied);
      }

      actions.push(action);
      occupied.push(action.moveTo);
    }

    return actions;
  }

  private decideAggressive(
    enemy: UnitController, players: UnitController[], occupied: GridPosition[]
  ): AIAction {
    const target = this.findTarget(enemy, players);
    if (!target || !target.data) {
      return { moveTo: enemy.data!.gridPos, attackTarget: null };
    }

    const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
    if (dist <= enemy.data.stats.range) {
      return { moveTo: enemy.data.gridPos, attackTarget: target };
    }

    const moveTo = this.bestMoveToward(
      enemy.data.gridPos, target.data.gridPos, enemy.data.stats.move, occupied
    );
    const newDist = this.manhattanDist(moveTo, target.data.gridPos);
    return {
      moveTo,
      attackTarget: newDist <= enemy.data.stats.range ? target : null,
    };
  }

  private decideRanged(
    enemy: UnitController, players: UnitController[], occupied: GridPosition[]
  ): AIAction {
    const target = this.findTarget(enemy, players);
    if (!target || !target.data) {
      return { moveTo: enemy.data!.gridPos, attackTarget: null };
    }

    const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
    const range = enemy.data.stats.range;

    if (dist > range) {
      const moveTo = this.bestMoveTowardRanged(
        enemy.data.gridPos, target.data.gridPos, range, enemy.data.stats.move, occupied
      );
      const newDist = this.manhattanDist(moveTo, target.data.gridPos);
      return {
        moveTo,
        attackTarget: newDist <= range ? target : null,
      };
    }

    if (dist <= 1) {
      const moveTo = this.bestRetreatPosition(
        enemy.data.gridPos, target.data.gridPos, enemy.data.stats.move, occupied
      );
      const newDist = this.manhattanDist(moveTo, target.data.gridPos);
      return {
        moveTo,
        attackTarget: newDist <= range ? target : null,
      };
    }

    return { moveTo: enemy.data.gridPos, attackTarget: target };
  }

  private decideDefensive(
    enemy: UnitController, players: UnitController[],
    allies: UnitController[], occupied: GridPosition[]
  ): AIAction {
    const threatenedAlly = this.findThreatenedAlly(enemy, players, allies);

    if (threatenedAlly && threatenedAlly.data) {
      const moveTo = this.bestMoveToward(
        enemy.data.gridPos, threatenedAlly.data.gridPos, enemy.data.stats.move, occupied
      );
      // 移动到保护位置后，若射程内有敌人则反击
      const nearest = this.findNearestTarget(moveTo, players);
      const newDist = nearest?.data ? this.manhattanDist(moveTo, nearest.data.gridPos) : Infinity;
      return {
        moveTo,
        attackTarget: (nearest && newDist <= enemy.data.stats.range) ? nearest : null
      };
    }

    const target = this.findTarget(enemy, players);
    if (!target || !target.data) {
      return { moveTo: enemy.data!.gridPos, attackTarget: null };
    }

    const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
    if (dist <= enemy.data.stats.range) {
      return { moveTo: enemy.data.gridPos, attackTarget: target };
    }

    const moveTo = this.bestMoveToward(
      enemy.data.gridPos, target.data.gridPos, enemy.data.stats.move, occupied
    );
    const newDist = this.manhattanDist(moveTo, target.data.gridPos);
    return {
      moveTo,
      attackTarget: newDist <= enemy.data.stats.range ? target : null,
    };
  }

  private decideFlanking(
    enemy: UnitController, players: UnitController[], occupied: GridPosition[]
  ): AIAction {
    const target = this.findWeakestTarget(enemy, players);
    if (!target || !target.data) {
      return { moveTo: enemy.data!.gridPos, attackTarget: null };
    }

    const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
    if (dist <= enemy.data.stats.range) {
      return { moveTo: enemy.data.gridPos, attackTarget: target };
    }

    const flankPos = this.findFlankingPosition(enemy, target, occupied);
    if (flankPos) {
      const newDist = this.manhattanDist(flankPos, target.data.gridPos);
      return {
        moveTo: flankPos,
        attackTarget: newDist <= enemy.data.stats.range ? target : null,
      };
    }

    const moveTo = this.bestMoveToward(
      enemy.data.gridPos, target.data.gridPos, enemy.data.stats.move, occupied
    );
    const newDist = this.manhattanDist(moveTo, target.data.gridPos);
    return {
      moveTo,
      attackTarget: newDist <= enemy.data.stats.range ? target : null,
    };
  }

  // ========== 纯位置计算辅助方法 ==========

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
        if (newRow < 0 || newRow >= GridController.GRID_SIZE || newCol < 0 || newCol >= GridController.GRID_SIZE) continue;
        const candidate = { row: newRow, col: newCol };
        if (occupied.some(o => o.row === newRow && o.col === newCol)) continue;
        const dist = this.manhattanDist(candidate, targetPos);
        if (dist < closestDist) {
          closestDist = dist;
          bestPos = candidate;
        }
      }
    }
    return bestPos;
  }

  private bestMoveTowardRanged(
    from: GridPosition, targetPos: GridPosition,
    range: number, moveRange: number, occupied: GridPosition[]
  ): GridPosition {
    let bestPos = { ...from };
    let bestDist = this.manhattanDist(from, targetPos);
    let bestPriority = 0;

    for (let r = -moveRange; r <= moveRange; r++) {
      for (let c = -moveRange; c <= moveRange; c++) {
        if (Math.abs(r) + Math.abs(c) > moveRange) continue;
        const newRow = from.row + r;
        const newCol = from.col + c;
        if (newRow < 0 || newRow >= GridController.GRID_SIZE || newCol < 0 || newCol >= GridController.GRID_SIZE) continue;
        const candidate = { row: newRow, col: newCol };
        if (occupied.some(o => o.row === newRow && o.col === newCol)) continue;

        const dist = this.manhattanDist(candidate, targetPos);
        const priority = (dist <= range && dist > 1) ? 2 : (dist <= range) ? 1 : 0;

        if (priority > bestPriority || (priority === bestPriority && dist < bestDist)) {
          bestPriority = priority;
          bestDist = dist;
          bestPos = candidate;
        }
      }
    }
    return bestPos;
  }

  private bestRetreatPosition(
    from: GridPosition, targetPos: GridPosition, moveRange: number, occupied: GridPosition[]
  ): GridPosition {
    let bestPos = { ...from };
    let farthestDist = this.manhattanDist(from, targetPos);

    for (let r = -moveRange; r <= moveRange; r++) {
      for (let c = -moveRange; c <= moveRange; c++) {
        if (Math.abs(r) + Math.abs(c) > moveRange || (r === 0 && c === 0)) continue;
        const newRow = from.row + r;
        const newCol = from.col + c;
        if (newRow < 0 || newRow >= GridController.GRID_SIZE || newCol < 0 || newCol >= GridController.GRID_SIZE) continue;
        const candidate = { row: newRow, col: newCol };
        if (occupied.some(o => o.row === newRow && o.col === newCol)) continue;

        const dist = this.manhattanDist(candidate, targetPos);
        if (dist > farthestDist) {
          farthestDist = dist;
          bestPos = candidate;
        }
      }
    }
    return bestPos;
  }

  // ========== 保留的辅助方法 ==========

  private attackIfInRangeOrMoveToward(
    enemy: UnitController, target: UnitController, occupied: GridPosition[]
  ): void {
    if (!enemy.data || !target.data) return;
    const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
    if (dist <= enemy.data.stats.range) {
      target.takeDamage(enemy.data.stats.attack);
    } else {
      const moveTo = this.bestMoveToward(
        enemy.data.gridPos, target.data.gridPos, enemy.data.stats.move, occupied
      );
      enemy.setGridPosition(moveTo);
      const newDist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
      if (newDist <= enemy.data.stats.range) {
        target.takeDamage(enemy.data.stats.attack);
      }
    }
  }

  private getAllOccupiedPositions(
    enemies: UnitController[], players: UnitController[]
  ): GridPosition[] {
    const positions: GridPosition[] = [];
    for (const u of enemies) {
      if (u.data?.isAlive) positions.push(u.data.gridPos);
    }
    for (const u of players) {
      if (u.data?.isAlive) positions.push(u.data.gridPos);
    }
    return positions;
  }

  /** 找最低血量目标（通用） */
  private findTarget(
    enemy: UnitController, players: UnitController[]
  ): UnitController | null {
    const alive = players.filter(u => u.data?.isAlive);
    if (alive.length === 0) return null;
    return alive.reduce((a: UnitController, b: UnitController) =>
      ((a.data?.currentHp ?? 999) < (b.data?.currentHp ?? 999)) ? a : b
    );
  }

  /** 找最近目标 */
  private findNearestTarget(pos: GridPosition, players: UnitController[]): UnitController | null {
    const alive = players.filter(u => u.data?.isAlive);
    if (alive.length === 0) return null;
    return alive.reduce((nearest, u) => {
      if (!u.data) return nearest;
      if (!nearest?.data) return u;
      const distU = this.manhattanDist(pos, u.data.gridPos);
      const distN = this.manhattanDist(pos, nearest.data.gridPos);
      return distU < distN ? u : nearest;
    }, null as UnitController | null);
  }

  /** 找最低防御目标（影刺用），优先法师→牧师→弓手→战士 */
  private findWeakestTarget(
    enemy: UnitController, players: UnitController[]
  ): UnitController | null {
    const alive = players.filter(u => u.data?.isAlive);
    if (alive.length === 0) return null;

    const defOrder: Record<string, number> = { mage: 0, archer: 1, cleric: 1, warrior: 2 };

    return alive.sort((a, b) => {
      const aDef = a.data ? (defOrder[a.data.classId] ?? a.data.stats.defense) : 99;
      const bDef = b.data ? (defOrder[b.data.classId] ?? b.data.stats.defense) : 99;
      if (aDef !== bDef) return aDef - bDef;
      return (a.data?.currentHp ?? 999) - (b.data?.currentHp ?? 999);
    })[0];
  }

  /** 找被玩家单位相邻威胁的友军（盾兵用） */
  private findThreatenedAlly(
    enemy: UnitController, players: UnitController[], allies: UnitController[]
  ): UnitController | null {
    const otherAllies = allies.filter(a => a !== enemy && a.data?.isAlive);
    if (otherAllies.length === 0) return null;

    const playerPositions = players.filter(p => p.data?.isAlive).map(p => p.data.gridPos);

    for (const ally of otherAllies) {
      if (!ally.data) continue;
      for (const pp of playerPositions) {
        if (this.manhattanDist(ally.data.gridPos, pp) <= 1) {
          return ally;
        }
      }
    }
    return null;
  }

  private manhattanDist(a: GridPosition, b: GridPosition): number {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
  }

  /** 计算绕后位置：优先到目标背后，其次是两侧 */
  private findFlankingPosition(
    enemy: UnitController, target: UnitController, occupied: GridPosition[]
  ): GridPosition | null {
    if (!enemy.data || !target.data) return null;
    const pos = enemy.data.gridPos;
    const targetPos = target.data.gridPos;
    const moveRange = enemy.data.stats.move;

    const dr = targetPos.row - pos.row;
    const dc = targetPos.col - pos.col;
    const normDr = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
    const normDc = dc === 0 ? 0 : (dc > 0 ? 1 : -1);

    const flankCandidates: GridPosition[] = [
      { row: targetPos.row + normDr, col: targetPos.col + normDc },
    ];

    if (dr === 0) {
      flankCandidates.push(
        { row: targetPos.row + 1, col: targetPos.col },
        { row: targetPos.row - 1, col: targetPos.col },
      );
    } else if (dc === 0) {
      flankCandidates.push(
        { row: targetPos.row, col: targetPos.col + 1 },
        { row: targetPos.row, col: targetPos.col - 1 },
      );
    } else {
      flankCandidates.push(
        { row: targetPos.row + normDr, col: targetPos.col },
        { row: targetPos.row, col: targetPos.col + normDc },
      );
    }

    let bestPos: GridPosition | null = null;
    let bestPriority = -1;

    const isFlankCandidate = (c: GridPosition): number => {
      for (let i = 0; i < flankCandidates.length; i++) {
        if (c.row === flankCandidates[i].row && c.col === flankCandidates[i].col) {
          return i === 0 ? 2 : 1;
        }
      }
      if (this.manhattanDist(c, targetPos) <= 1) return 0;
      return -1;
    };

    for (let r = -moveRange; r <= moveRange; r++) {
      for (let c = -moveRange; c <= moveRange; c++) {
        if (Math.abs(r) + Math.abs(c) > moveRange) continue;
        const newRow = pos.row + r;
        const newCol = pos.col + c;
        if (newRow < 0 || newRow >= GridController.GRID_SIZE || newCol < 0 || newCol >= GridController.GRID_SIZE) continue;
        const candidate = { row: newRow, col: newCol };
        if (occupied.some(o => o.row === newRow && o.col === newCol)) continue;

        const priority = isFlankCandidate(candidate);
        if (priority > bestPriority) {
          bestPriority = priority;
          bestPos = candidate;
        }
      }
    }

    return bestPos;
  }
}
