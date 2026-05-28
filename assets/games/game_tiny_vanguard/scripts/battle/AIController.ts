import { UnitController } from './UnitController';
import { GridPosition } from './GridController';

export class AIController {
  executeEnemyTurn(enemies: UnitController[], players: UnitController[]): void {
    const aliveEnemies = enemies.filter(u => u.data?.isAlive);
    for (const enemy of aliveEnemies) {
      if (!enemy.data?.isAlive) continue;

      enemy.onTurnStart();
      const target = this.findTarget(enemy, players);
      if (!target || !target.data) continue;

      const dist = this.manhattanDist(enemy.data.gridPos, target.data.gridPos);
      if (dist <= enemy.data.stats.range) {
        target.takeDamage(enemy.data.stats.attack);
      } else {
        this.moveToward(enemy, target.data.gridPos);
      }
    }
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

  private moveToward(enemy: UnitController, targetPos: GridPosition): void {
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
