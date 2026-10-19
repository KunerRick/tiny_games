import { UnitController } from './UnitController';
import { GridPosition, GridController } from './GridController';
import { AIType, getEnemyAbilityById } from '../config/GameData';

export interface AIAction {
  moveTo: GridPosition;
  attackTarget: UnitController | null;
  /** 本回合要释放的敌人技能 id（替换普通攻击）；不填 = 普通攻击 */
  abilityId?: string | null;
}

export class AIController {
  /**
   * 本回合**已经选定**的攻击目标计数（每回合 `decideAll` 开头清空）。
   * 用于让"后来决策的敌人"避开已被同伴盯上的目标 —— 见 `scoreTarget`。
   */
  private _focusCount: Map<UnitController, number> = new Map();
  /** 每回合自增的抖动种子，让同一局面下不同回合的选目标略有变化（可复现，不用 Math.random） */
  private _turnSeed: number = 0;

  decideAll(enemies: UnitController[], players: UnitController[]): AIAction[] {
    const aliveEnemies = enemies.filter(u => u.data?.isAlive);
    const alivePlayers = players.filter(u => u.data?.isAlive);
    const occupied = this.getAllOccupiedPositions(enemies, players);
    const actions: AIAction[] = [];
    this._focusCount.clear();
    this._turnSeed++;

    for (const enemy of enemies) {
      if (!enemy.data?.isAlive || enemy.data.hasActed) {
        // 保持与输入数组顺序一一对应，不可行动单位置空
        actions.push({
          moveTo: { ...enemy.data?.gridPos ?? { row: 0, col: 0 } },
          attackTarget: null
        });
        continue;
      }

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

      occupied.push(action.moveTo);
      const finalAction = this.withAbility(enemy, action, alivePlayers);
      // 记账：被选中的目标本回合已被 N 个敌人盯上，后续敌人会倾向换目标
      if (finalAction.attackTarget) {
        const t = finalAction.attackTarget;
        this._focusCount.set(t, (this._focusCount.get(t) ?? 0) + 1);
      }
      actions.push(finalAction);
    }

    return actions;
  }

  /**
   * 若敌人有**冷却完毕**且目标在射程内的主动技能，就用它替换本回合的普通攻击。
   *
   * 目标沿用 `findTarget` 的"血量最低"口径（在技能射程内另选一次，因为技能的射程
   * 可能与武器射程不同）。被动技能（盾墙/集结）不在这里处理：盾墙在受伤时生效、
   * 集结在敌方回合开始时由 BattleManager 处理。
   */
  private withAbility(
    enemy: UnitController, action: AIAction, players: UnitController[]
  ): AIAction {
    const data = enemy.data;
    if (!data) return action;

    for (const id of data.abilityIds) {
      const ability = getEnemyAbilityById(id);
      if (!ability || ability.type !== 'active') continue;
      if (!enemy.isAbilityReady(id)) continue;

      // 自身技能（嘲讽）：身边有玩家即可，不必有攻击目标
      if (ability.targetType === 'self') {
        const radius = ability.effects.find(e => e.type === 'taunt')?.params.radius ?? 1;
        const near = players.some(p =>
          p.data?.isAlive && this.manhattanDist(action.moveTo, p.data.gridPos) <= radius
        );
        if (near) return { ...action, abilityId: id };
        continue;
      }

      const range = ability.range ?? data.stats.range;
      const candidates = players.filter(p =>
        p.data?.isAlive && this.manhattanDist(action.moveTo, p.data.gridPos) <= range
      );
      if (candidates.length === 0) continue;
      // 与普通攻击共用同一套打分（距离 + 残血 + 集火惩罚），不再单独"挑血量最低"
      const target = this.pickBestTarget(enemy, candidates) ?? candidates[0];
      return { ...action, attackTarget: target, abilityId: id };
    }
    return action;
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

  /**
   * 选攻击目标。
   *
   * 历史实现有两个极端，都让玩家难受：
   * ① 只看**全图**血量最低 → 全员横穿棋盘追同一个残血；
   * ② 改成"够得着的里面挑血量最低"之后，仍然是**所有**敌人在同一回合里
   *    无条件选同一个人 → 后排脆皮（法师/牧师）每场开局即被集火秒杀。
   *
   * 现在改为**加权打分**（§5.4 的"血量最低"降级为一个次要项），三项：
   * - 距离（权重 5，主导）：优先打够得着的，天然保护后排；
   * - 血量比（权重 2，次要）：同等距离下先收残血，保留"斩杀"手感；
   * - 集火惩罚（权重 8/人）：本回合已被同伴盯上的目标大幅降权，
   *   于是最多约两人打同一个 —— 挨打面分散，不再"逮着脆皮切"；
   * 另加 ±2 的确定性抖动（同一局面同回合结果可复现），避免满盘同分时
   * 全部落到数组第一个。
   */
  private findTarget(
    enemy: UnitController, players: UnitController[]
  ): UnitController | null {
    if (!enemy.data) return null;
    const alive = players.filter(u => u.data?.isAlive);
    if (alive.length === 0) return null;

    const reach = enemy.data.stats.move + enemy.data.stats.range;
    const reachable = alive.filter(u =>
      this.manhattanDist(enemy.data!.gridPos, u.data!.gridPos) <= reach
    );
    const pool = reachable.length > 0 ? reachable : alive;
    return this.pickBestTarget(enemy, pool);
  }

  /**
   * 打分选目标（`pool` 为候选集合，调用方决定是"够得着的"还是"全部"）。
   * 分数越大越好；各项权重见 `findTarget` 注释。
   */
  private pickBestTarget(
    enemy: UnitController, pool: UnitController[]
  ): UnitController | null {
    if (!enemy.data || pool.length === 0) return null;
    let best: UnitController | null = null;
    let bestScore = -Infinity;

    for (const u of pool) {
      if (!u.data) continue;
      const dist = this.manhattanDist(enemy.data.gridPos, u.data.gridPos);
      const hpRatio = u.data.maxHp > 0 ? u.data.currentHp / u.data.maxHp : 1;
      const focus = this._focusCount.get(u) ?? 0;

      let score = -dist * 5;
      score -= (1 - hpRatio) * 2;
      score -= focus * 8;
      score += (this.hashNoise(enemy, u) - 0.5) * 4;

      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return best;
  }

  /** 确定性的 [0,1) 噪声：同一敌人×目标×回合恒定，便于复现与排查 */
  private hashNoise(enemy: UnitController, target: UnitController): number {
    const s = `${enemy.data?.id ?? '?'}|${target.data?.id ?? '?'}|${this._turnSeed}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1000) / 1000;
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

  /**
   * 找"好切"的目标（影刺/绕后单位用）。
   *
   * 原实现用一张写死的职业优先级表 `{mage:0, archer:1, cleric:1, warrior:2}`
   * 且**完全不看距离** → 场上只要有法师，所有影刺从第一回合起就认定它，
   * 哪怕隔着整个棋盘。现在同样改为打分：职业脆皮只是加分项，
   * 距离与集火惩罚仍然是主导，影刺会切**够得着的**软目标而不是认死法师。
   */
  private findWeakestTarget(
    enemy: UnitController, players: UnitController[]
  ): UnitController | null {
    const alive = players.filter(u => u.data?.isAlive);
    if (alive.length === 0 || !enemy.data) return null;

    const squishiness: Record<string, number> = { mage: 3, archer: 2, cleric: 2, warrior: 0 };

    let best: UnitController | null = null;
    let bestScore = -Infinity;
    for (const u of alive) {
      if (!u.data) continue;
      const dist = this.manhattanDist(enemy.data.gridPos, u.data.gridPos);
      const hpRatio = u.data.maxHp > 0 ? u.data.currentHp / u.data.maxHp : 1;
      const focus = this._focusCount.get(u) ?? 0;

      let score = -dist * 4;
      score -= (1 - hpRatio) * 2;
      score += squishiness[u.data.classId] ?? 0;
      score -= focus * 6;
      score += (this.hashNoise(enemy, u) - 0.5) * 3;

      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return best;
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
