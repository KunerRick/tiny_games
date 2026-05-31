import { UnitController } from './UnitController';
import { GridPosition } from './GridController';

export class AIController {
  executeEnemyTurn(enemies: UnitController[], players: UnitController[]): void {
    const aliveEnemies = enemies.filter(u => u.data?.isAlive);
    const allOccupied = this.getAllOccupiedPositions(enemies, players);
    for (const enemy of aliveEnemies) {
      if (!enemy.data?.isAlive) continue;

      enemy.onTurnStart();
      const target = this.findTarget(enemy, players);
      if (!target || !target.data) continue;

      const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
      if (dist <= enemy.data.stats.range) {
        target.takeDamage(enemy.data.stats.attack);
      } else {
        this.moveToward(enemy, target.data.gridPos, allOccupied);
        // 移动后重新检查是否进入攻击范围
        const newDist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
        if (newDist <= enemy.data.stats.range) {
          target.takeDamage(enemy.data.stats.attack);
        }
      }
    }
  }

  private getAllOccupiedPositions(enemies: UnitController[], players: UnitController[]): GridPosition[] {
    const positions: GridPosition[] = [];
    for (const u of enemies) {
      if (u.data?.isAlive) positions.push(u.data.gridPos);
    }
    for (const u of players) {
      if (u.data?.isAlive) positions.push(u.data.gridPos);
    }
    return positions;
  }

  private findTarget(enemy: UnitController, players: UnitController[]): UnitController | null {
    const alive = players.filter(u => u.data?.isAlive);
    if (alive.length === 0) return null;

    return alive.reduce((a, b) =>
      (a.data?.currentHp ?? 999) < (b.data?.currentHp ?? 999) ? a : b
    );
  }

  private manhattanDist(a: GridPosition, b: GridPosition): number {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
  }

  private moveToward(enemy: UnitController, targetPos: GridPosition, occupied: GridPosition[]): void {
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
}
