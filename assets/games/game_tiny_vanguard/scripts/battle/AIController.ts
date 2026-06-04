import { UnitController } from './UnitController';
import { GridPosition } from './GridController';
import { AIType } from '../config/GameData';

export class AIController {
  executeEnemyTurn(enemies: UnitController[], players: UnitController[]): void {
    const aliveEnemies = enemies.filter(u => u.data?.isAlive);
    const alivePlayers = players.filter(u => u.data?.isAlive);

    for (const enemy of aliveEnemies) {
      if (!enemy.data?.isAlive) continue;
      enemy.onTurnStart();

      const behavior: AIType = enemy.data.aiBehavior || 'aggressive';
      const occupied = this.getAllOccupiedPositions(enemies, players);

      switch (behavior) {
        case 'aggressive':
          this.executeAggressive(enemy, alivePlayers, occupied);
          break;
        case 'ranged':
          this.executeRanged(enemy, alivePlayers, occupied);
          break;
        case 'defensive':
          this.executeDefensive(enemy, alivePlayers, aliveEnemies, occupied);
          break;
        case 'flanking':
          this.executeFlanking(enemy, alivePlayers, occupied);
          break;
      }
    }
  }

  // --- Aggressive: 剑兵默认行为，直线冲向最近/最低血目标 ---
  private executeAggressive(
    enemy: UnitController, players: UnitController[], occupied: GridPosition[]
  ): void {
    const target = this.findTarget(enemy, players);
    if (!target || !target.data) return;
    this.attackIfInRangeOrMoveToward(enemy, target, occupied);
  }

  // --- Ranged: 弩手，保持射程距离攻击 ---
  private executeRanged(
    enemy: UnitController, players: UnitController[], occupied: GridPosition[]
  ): void {
    const target = this.findTarget(enemy, players);
    if (!target || !target.data) return;

    const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
    const range = enemy.data.stats.range;

    if (dist > range) {
      // 太远 → 靠近到射程边缘
      this.moveTowardRanged(enemy, target.data.gridPos, range, occupied);
      const newDist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
      if (newDist <= range) {
        target.takeDamage(enemy.data.stats.attack);
      }
    } else if (dist <= 1) {
      // 贴脸了 → 先拉开距离再攻击
      this.tryRetreatAndAttack(enemy, target, occupied);
    } else {
      // 在最佳射程 → 攻击
      target.takeDamage(enemy.data.stats.attack);
    }
  }

  // --- Defensive: 盾兵，保护相邻友方 ---
  private executeDefensive(
    enemy: UnitController, players: UnitController[],
    allies: UnitController[], occupied: GridPosition[]
  ): void {
    const threatenedAlly = this.findThreatenedAlly(enemy, players, allies);

    if (threatenedAlly) {
      // 有友方被威胁 → 移动到该友方旁边保护
      this.moveToward(enemy, threatenedAlly.data.gridPos, occupied);
    } else {
      // 没有友方被威胁 → 就近攻击
      const target = this.findTarget(enemy, players);
      if (target && target.data) {
        this.attackIfInRangeOrMoveToward(enemy, target, occupied);
      }
    }
  }

  // --- Flanking: 影刺，优先打脆皮/绕后 ---
  private executeFlanking(
    enemy: UnitController, players: UnitController[], occupied: GridPosition[]
  ): void {
    const target = this.findWeakestTarget(enemy, players);
    if (!target || !target.data) return;

    const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);

    if (dist <= enemy.data.stats.range) {
      // 已在攻击范围 → 攻击
      target.takeDamage(enemy.data.stats.attack);
    } else {
      // 尝试绕到目标背后
      const flankPos = this.findFlankingPosition(enemy, target, occupied);
      if (flankPos) {
        enemy.setGridPosition(flankPos);
        const newDist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
        if (newDist <= enemy.data.stats.range) {
          target.takeDamage(enemy.data.stats.attack);
        }
      } else {
        this.moveToward(enemy, target.data.gridPos, occupied);
      }
    }
  }

  // ========== 共享辅助方法 ==========

  private attackIfInRangeOrMoveToward(
    enemy: UnitController, target: UnitController, occupied: GridPosition[]
  ): void {
    if (!enemy.data || !target.data) return;
    const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
    if (dist <= enemy.data.stats.range) {
      target.takeDamage(enemy.data.stats.attack);
    } else {
      this.moveToward(enemy, target.data.gridPos, occupied);
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
    return alive.reduce((a, b) =>
      (a.data?.currentHp ?? 999) < (b.data?.currentHp ?? 999) ? a : b
    );
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

  /** 通用移动：向目标位置靠近 */
  private moveToward(
    enemy: UnitController, targetPos: GridPosition, occupied: GridPosition[]
  ): void {
    if (!enemy.data) return;
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
        const candidate = { row: newRow, col: newCol };
        const isOccupied = occupied.some(o => o.row === newRow && o.col === newCol);
        if (isOccupied) continue;
        const dist = this.manhattanDist(candidate, targetPos);
        if (dist < closestDist) {
          closestDist = dist;
          bestPos = candidate;
        }
      }
    }
    enemy.setGridPosition(bestPos);
  }

  /** 远程移动：靠近目标但保持射程距离（dist > 1） */
  private moveTowardRanged(
    enemy: UnitController, targetPos: GridPosition,
    range: number, occupied: GridPosition[]
  ): void {
    if (!enemy.data) return;
    const pos = enemy.data.gridPos;
    const moveRange = enemy.data.stats.move;
    let bestPos = { ...pos };
    let bestDist = this.manhattanDist(pos, targetPos);
    let bestPriority = 0; // 0=不在射程, 1=在射程但贴脸, 2=在射程且不贴脸

    for (let r = -moveRange; r <= moveRange; r++) {
      for (let c = -moveRange; c <= moveRange; c++) {
        if (Math.abs(r) + Math.abs(c) > moveRange) continue;
        const newRow = pos.row + r;
        const newCol = pos.col + c;
        if (newRow < 0 || newRow >= 6 || newCol < 0 || newCol >= 6) continue;
        const candidate = { row: newRow, col: newCol };
        const isOccupied = occupied.some(o => o.row === newRow && o.col === newCol);
        if (isOccupied) continue;

        const dist = this.manhattanDist(candidate, targetPos);
        const priority = (dist <= range && dist > 1) ? 2 : (dist <= range) ? 1 : 0;

        if (priority > bestPriority || (priority === bestPriority && dist < bestDist)) {
          bestPriority = priority;
          bestDist = dist;
          bestPos = candidate;
        }
      }
    }
    enemy.setGridPosition(bestPos);
  }

  /** 被贴脸时：先拉开再攻击 */
  private tryRetreatAndAttack(
    enemy: UnitController, target: UnitController, occupied: GridPosition[]
  ): void {
    if (!enemy.data || !target.data) return;
    const pos = enemy.data.gridPos;
    const moveRange = enemy.data.stats.move;

    let bestPos = { ...pos };
    let bestDist = this.manhattanDist(pos, target.data.gridPos);
    let foundRetreat = false;

    for (let r = -moveRange; r <= moveRange; r++) {
      for (let c = -moveRange; c <= moveRange; c++) {
        if (Math.abs(r) + Math.abs(c) > moveRange || (r === 0 && c === 0)) continue;
        const newRow = pos.row + r;
        const newCol = pos.col + c;
        if (newRow < 0 || newRow >= 6 || newCol < 0 || newCol >= 6) continue;
        const candidate = { row: newRow, col: newCol };
        const isOccupied = occupied.some(o => o.row === newRow && o.col === newCol);
        if (isOccupied) continue;

        const dist = this.manhattanDist(candidate, target.data.gridPos);
        if (dist > bestDist) {
          bestDist = dist;
          bestPos = candidate;
          foundRetreat = true;
        }
      }
    }

    if (foundRetreat) {
      enemy.setGridPosition(bestPos);
    }

    const newDist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
    if (newDist <= enemy.data.stats.range) {
      target.takeDamage(enemy.data.stats.attack);
    }
  }

  /** 计算绕后位置：优先到目标背后，其次是两侧 */
  private findFlankingPosition(
    enemy: UnitController, target: UnitController, occupied: GridPosition[]
  ): GridPosition | null {
    if (!enemy.data || !target.data) return null;
    const pos = enemy.data.gridPos;
    const targetPos = target.data.gridPos;
    const moveRange = enemy.data.stats.move;

    // 计算"背后"方向：从敌人→目标的延长线上，越过目标一格
    const dr = targetPos.row - pos.row;
    const dc = targetPos.col - pos.col;
    const normDr = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
    const normDc = dc === 0 ? 0 : (dc > 0 ? 1 : -1);

    // 候选位置：背后(优先) + 两侧
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

    // 遍历所有可达位置，按优先级选择
    let bestPos: GridPosition | null = null;
    let bestPriority = -1;

    const isFlankCandidate = (c: GridPosition): number => {
      for (let i = 0; i < flankCandidates.length; i++) {
        if (c.row === flankCandidates[i].row && c.col === flankCandidates[i].col) {
          return i === 0 ? 2 : 1; // 背后=2，两侧=1
        }
      }
      // 是否在目标相邻格（兜底）
      if (this.manhattanDist(c, targetPos) <= 1) return 0;
      return -1;
    };

    for (let r = -moveRange; r <= moveRange; r++) {
      for (let c = -moveRange; c <= moveRange; c++) {
        if (Math.abs(r) + Math.abs(c) > moveRange) continue;
        const newRow = pos.row + r;
        const newCol = pos.col + c;
        if (newRow < 0 || newRow >= 6 || newCol < 0 || newCol >= 6) continue;
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
