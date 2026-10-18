import { _decorator, Component, Node, Color, Vec3, UITransform, UIOpacity, instantiate, Prefab } from 'cc';
import { GridController, GridPosition } from './GridController';
import { UnitController } from './UnitController';
import { AIController, AIAction } from './AIController';
import { EnemyConfig, SkillEffect, SkillConfig, ENEMIES, ELITE_ENEMIES, BOSS_CONFIG, getClassById, getEnemyAbilityById, getRandomSkillsFromPool } from '../config/GameData';
import { GRID } from '../config/Theme';

const { ccclass, property } = _decorator;

export type BattlePhase = 'deploy' | 'player_turn' | 'enemy_turn' | 'skill_target' | 'victory' | 'defeat';
export type UnitActionPhase = 'move' | 'action' | 'attack_target' | 'skill_target' | 'skill_target_aoe' | 'done';

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
  private _movePreviewPos: GridPosition | null = null;
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
  /** 拖拽已消费本次触摸时返回 true —— 用于忽略紧随其后的格点击（§3.3 拖拽与点击共存） */
  private _deployDragGuard: (() => boolean) | null = null;
  /**
   * 当前被落点预览着色的格子。
   * 拖拽会跨过多个格子，只给新格上色而不复原旧格 → 经过的格子会**残留高亮**
   * （实测：从 (0,0) 拖到 (1,0)，(0,0) 仍是实心预览绿，直到释放才被全量重绘抹掉）。
   */
  private _dropPreviewPos: GridPosition | null = null;
  private _selectedUnit: UnitController | null = null;  private _pendingSkill: import('../config/GameData').SkillConfig | null = null;
  private _skillTargets: GridPosition[] = [];
  private _skillPreviewPos: GridPosition | null = null;
  /** 当前锁定的技能下标（-1 = 没有）。与 `_pendingSkill` 并用：技能对象本身不带下标。 */
  private _pendingSkillIndex: number = -1;
  /**
   * 进入 `skill_target` **之前**的子阶段。取消技能时要原样退回去 ——
   * 玩家可能是从 `move`（还没移动就点技能）进来的，一律退回 `action` 是错的。
   * 必须在翻转 `_phase` 之前捕获，否则永远是 `action`。
   */
  private _skillReturnPhase: UnitActionPhase = 'action';
  private _onSkillRejectedCallback: ((message: string) => void) | null = null;
  private _totalDamageDealt: number = 0;
  private _currentBattleType: 'normal' | 'elite' | 'boss' = 'normal';
  /** 本场难度（0 起，= 已完成的战斗场次）：Boss 召唤物按同一曲线缩放 */
  private _difficulty: number = 0;
  private _autoSkipUnitRef: UnitController | null = null;
  private _onAutoSkipCancelledCallback: (() => void) | null = null;
  /**
   * 本回合是以「原地待命」进入 action 的（而不是真的移动过）。
   * 只有它为 true 时，action 阶段点自己才允许退回 move 阶段 ——
   * 否则「撤销待命」会把 `hasMoved` 还原成 false，等于白送一次移动。
   */
  private _stoodStill: boolean = false;
  /**
   * 本场是否已判出胜负。与 `_phase` 不同：`_phase` 到 `victory/defeat` 后
   * 还会留 ~0.34s 播阵亡演出（见 `checkBattleEnd`），这个标记是**幂等闸门**，
   * 避免同一个结算被重复排期（重复结算 = 重复发金币）。
   */
  private _battleOver: boolean = false;

  /**
   * 敌方回合里"两个单位之间"的间隔（秒）。原先是两个魔数写死在这条链上
   * （移动 0.25 + `scheduleOnce(…, 0.5)`），结果是**不管有没有出手都要等半秒**，
   * 一回合三四个敌人就拖成一长段沉默。现在按"这一拍有没有出手"分别取值：
   * 出手要留够攻击演出（突刺 0.08 + 回收 0.12 + 伤害飘字）收尾，只是走路则不必等。
   */
  private static readonly AI_STEP_AFTER_ACTION = 0.34;
  private static readonly AI_STEP_AFTER_MOVE = 0.10;
  /**
   * 自动跳过的宽限时间（秒）。原先是硬编码的 0.6 —— 玩家还没读完横幅就被跳过，
   * 而且这段时间里 `hasActed` 已经置位，想反悔也没救。放宽到 1s 并让**任何输入**
   * 都能取消（见 `_cancelAutoSkip`），这条路径才是"建议"而不是"判决"。
   */
  private static readonly AUTO_SKIP_GRACE = 1.0;
  /**
   * 行动演出（移动 / 攻击）进行中：期间**不接受新的棋盘点击与技能**。
   * 为什么需要它 —— 普通攻击的伤害现在落在突刺顶点（约 0.08s 后），
   * 如果这 0.08s 里还能点，玩家可以点第二个敌人让同一个单位连打两下
   * （`hasActed` 那一刻还没置位）。锁定从"发出动作"持续到"动作收尾"。
   */
  private _actionLocked: boolean = false;

  /**
   * 敌方回合看门狗宽限（秒）。每一拍都会续期它；链路任一环断裂
   * （补间回调没来、排期被引擎丢弃、回调抛异常）时超过该时限就强制推进，
   * 而不是把整个回合**硬卡死**。单拍上限 ≈ MOVE_ANIM_DURATION(0.22) +
   * AI_STEP_AFTER_ACTION(0.34)，2s 足够宽松。
   */
  private static readonly AI_WATCHDOG_GRACE = 2.0;

  /** 组件内累计时钟（秒）：给 AI 拍点/看门狗做绝对时间比较，不依赖性能时钟 */
  private _clock = 0;
  /**
   * 下一拍敌方 AI 的**绝对**时间；0 = 当前没有待执行的拍。
   * 为什么用"数字 + update() 泵"而不是 `scheduleOnce`：
   * 旧写法在 `_onAINextStep` 的**自身触发中**再排同一个 `(target, method)`，
   * 引擎 `Scheduler.schedule` 命中同回调去重（logID 1507）并把一次性计时器
   * 立即取消 → 排期被**静默丢弃**，`_phase` 永远停在 `enemy_turn`（实测卡死）。
   * 延迟变成纯状态就没有"调度器同一性"可冲突，也没有补间句柄可以被弄丢。
   */
  private _aiNextStepAt = 0;
  /** 敌方回合心跳截止时间；>0 且已过期 → 看门狗介入 */
  private _aiWatchdogAt = 0;

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
    onEnd: (result: BattleResult) => void,
    deployLayout?: ({ row: number; col: number } | null)[] | null
  ): void {
    this._onBattleEndCallback = onEnd;
    this._phase = 'deploy';
    this._turnCount = 0;
    this._deployedPositions = [];
    // 新一场开打：清掉上一场的胜负闸门（否则第二场会立刻被判成"已经结束"）
    this._battleOver = false;
    this._actionLocked = false;
    this._stoodStill = false;
    // 上一场若停在技能选择中途，残留的锁定会把新一场第一次点技能当成"取消"
    this._pendingSkill = null;
    this._pendingSkillIndex = -1;
    this._skillReturnPhase = 'action';
    this._skillTargets = [];
    this._skillPreviewPos = null;
    // 上一场可能留下未结算的排期（例如结束回合时的 AI 队列）
    this.unscheduleAllCallbacks();
    // AI 拍点泵不是 scheduler 条目、也不是补间：清这两个数字就是"取消"（见 _aiNextStepAt 注释）
    this._aiNextStepAt = 0;
    this._aiWatchdogAt = 0;
    // 时钟只在开局归零，保证一场之内绝对时间单调递增
    this._clock = 0;
    // 本场难度（0 起）：Boss 集结的召唤物要按同一曲线缩放，故存一份
    this._difficulty = difficulty;
    // 上一场可能留下未清除的落点预览引用（跨场脏状态）
    this._dropPreviewPos = null;
    
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
    // 落位必须在敌人生成之后：兜底校验要能检出"与敌人初始位置冲突"
    this.applyDeployLayout(deployLayout);
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
        // 光环类被动（盾墙）需要查同阵营单位
        unitCtrl.setAllyProvider(() => this._playerUnits);
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
      // spawnEnemy() 内部已经 push 进 _enemyUnits，此处不能再 push 一次
      // （否则 Boss 战出现两个「战争领主」，敌方回合让 Boss 行动两次）
      // Boss 属性不随进度缩放：设计 §5.3 给的是「Boss 特有属性」固定值
      this.spawnEnemy(BOSS_CONFIG as EnemyConfig, { row: 5, col: 3 });
      enemyConfigs = [
        { ...ENEMIES[0], stats: this.scaleEnemyStats(ENEMIES[0].stats, difficulty) },
        { ...ENEMIES[1], stats: this.scaleEnemyStats(ENEMIES[1].stats, difficulty) },
      ];
    } else if (isElite) {
      const elitePool = isElite ? ELITE_ENEMIES : ENEMIES;
      const count = Math.min(3 + difficulty, elitePool.length);
      enemyConfigs = [];
      for (let i = 0; i < count; i++) {
        const config = { ...elitePool[i % elitePool.length] };
        config.stats = this.scaleEnemyStats(config.stats, difficulty);
        enemyConfigs.push(config);
      }
    } else {
      const count = Math.min(2 + difficulty, ENEMIES.length);
      enemyConfigs = [];
      for (let i = 0; i < count; i++) {
        const config = { ...ENEMIES[i % ENEMIES.length] };
        config.stats = this.scaleEnemyStats(config.stats, difficulty);
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

  /**
   * 按进度缩放敌人**基础属性**（设计 §5.5：中期 ×1.2~1.4、后期 ×1.5~1.8）。
   *
   * 原实现只缩放 `hp`，攻击/防御恒为基础值 —— 实测打到第 4 场敌人仍是 atk3/atk2/atk4，
   * 玩家靠升级涨血涨攻之后伤害压力趋近于 0。改为同一倍率作用于 hp/攻击/防御
   * （向下取整：属性都是整数，且防御很敏感，宁可慢一点也不取整过头）。
   * **移速与射程不缩放**：它们决定走位与射程判定，放大后会让 AI 的可达性假设失效。
   * Boss 不调用本方法（设计 §5.3 的 Boss 属性是固定值）。
   */
  private scaleEnemyStats(base: EnemyConfig['stats'], difficulty: number): EnemyConfig['stats'] {
    const mult = 1 + difficulty * 0.1;
    return {
      ...base,
      hp: Math.floor(base.hp * mult),
      attack: Math.floor(base.attack * mult),
      defense: Math.floor(base.defense * mult),
    };
  }

  private spawnEnemy(config: EnemyConfig, pos: GridPosition): UnitController | null {
    const unitNode = instantiate(this.unitPrefab);
    unitNode.name = `Enemy_${config.name}`;
    this.node.addChild(unitNode);

    const unitCtrl = unitNode.getComponent(UnitController);
    if (unitCtrl) {
      unitCtrl.initFromEnemyConfig(config, pos);
      unitCtrl.setAllyProvider(() => this._enemyUnits);
      this._enemyUnits.push(unitCtrl);
      return unitCtrl;
    }
    return null;
  }

  private startDeployPhase(): void {
    this._phase = 'deploy';
    this._highlightDeployArea();
    this.gridController.setCellClickCallback((pos) => this.onDeployCellClicked(pos));
    // 自动选中第一张「尚未落位」的卡；沿用存档阵型时前面的卡可能已落位
    const firstUnplaced = this._playerUnits.findIndex(u => (u.data?.gridPos.col ?? -1) < 0);
    // 先按实际落位情况刷新兵牌三态（存档阵型可能已把部分/全部单位放好），
    // 再切换选中态 —— 顺序反了会让已上阵的卡被重置成 unplaced。
    if (this._onDeployUnitPlacedCallback) {
      this._onDeployUnitPlacedCallback(this._deployedPositions.length, this._playerUnits.length);
    }
    this._selectedDeployUnitIndex = firstUnplaced;
    if (this._onDeploySelectionChanged) {
      this._onDeploySelectionChanged(firstUnplaced);
    }
    // 禁用后 4 行格子交互
    this.gridController.setRowsInteractable([2, 3, 4, 5], false);
    // 隐藏棋盘外单位（防左侧出现重复的"三个方框"）
    for (const unit of this._playerUnits) {
      if (unit.node?.isValid && unit.data?.gridPos.col < 0) {
        unit.node.active = false;
      }
    }
    // 通知 UI 进入布阵阶段：UI 据此隐藏行动栏（等待/攻击/结束回合）。
    // 原先不通知，UI 停在上一场战斗的按钮状态 —— 布阵时「结束回合」会露出来。
    if (this._onUnitPhaseChanged) {
      this._onUnitPhaseChanged('deploy', null, null);
    }
  }

  /**
   * 按存档阵型落位（§3.2）。四条校验（长度一致 / row<=1 / 单位间不冲突 /
   * 不与敌人初始位置冲突）任一不满足即**整体回退默认阵型**，
   * 避免"半失效"状态（部分单位落位、部分散在棋盘外）。
   */
  private applyDeployLayout(layout?: ({ row: number; col: number } | null)[] | null): void {
    if (!layout || layout.length !== this._playerUnits.length) return;

    const enemyPos = new Set<string>();
    for (const e of this._enemyUnits) {
      if (e.data) enemyPos.add(`${e.data.gridPos.row},${e.data.gridPos.col}`);
    }

    const used = new Set<string>();
    const accepted: ({ row: number; col: number } | null)[] = [];
    for (const entry of layout) {
      if (!entry) {
        accepted.push(null);
        continue;
      }
      const { row, col } = entry;
      const key = `${row},${col}`;
      const inDeployArea = row >= 0 && row <= 1 && col >= 0 && col < GridController.GRID_SIZE;
      if (!inDeployArea || used.has(key) || enemyPos.has(key)) return;
      used.add(key);
      accepted.push({ row, col });
    }

    for (let i = 0; i < this._playerUnits.length; i++) {
      const pos = accepted[i];
      const unit = this._playerUnits[i];
      if (!pos || !unit?.data || !unit.node?.isValid) continue;
      unit.setGridPosition(pos);
      unit.node.active = true;
      this._deployedPositions.push(pos);
    }
  }

  /** 导出当前布阵（按 playerClasses 下标对齐；未上阵为 null），供存档持久化（§3.2） */
  exportDeployLayout(): ({ row: number; col: number } | null)[] {
    return this._playerUnits.map(u => {
      const pos = u.data?.gridPos;
      if (!pos || pos.col < 0) return null;
      return { row: pos.row, col: pos.col };
    });
  }

  public highlightDeployArea(): void {
    this._highlightDeployArea();
  }

  private _highlightDeployArea(): void {
    this.gridController.clearHighlights();

    // 顶部两行：可部署区域（玩家在己方半场部署）
    const deployableColor = GRID.DEPLOYABLE;
    for (let c = 0; c < GridController.GRID_SIZE; c++) {
      this.gridController.setCellColor({ row: 0, col: c }, deployableColor);
      this.gridController.setCellColor({ row: 1, col: c }, deployableColor);
    }

    // 底部四行：不可部署区域（敌方区域）
    const disabledColor = GRID.DEPLOY_DISABLED;
    for (let r = 2; r < GridController.GRID_SIZE; r++) {
      for (let c = 0; c < GridController.GRID_SIZE; c++) {
        this.gridController.setCellColor({ row: r, col: c }, disabledColor);
      }
    }

    // 已部署位置：覆盖之前的颜色
    const placedColor = GRID.DEPLOYED;
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

  /** 自动跳过被玩家输入取消时回调 —— UI 据此立刻收掉"即将跳过"横幅 */
  setAutoSkipCancelledCallback(callback: () => void): void {
    this._onAutoSkipCancelledCallback = callback;
  }

  /** 点了一个当前用不了的技能时回调 —— UI 据此把**原因**告诉玩家（而不是静默无反应） */
  setSkillRejectedCallback(callback: (message: string) => void): void {
    this._onSkillRejectedCallback = callback;
  }

  /** 当前锁定的技能下标（-1 = 未锁定）。UI 用它把"正在选的技能"高亮出来，让"再点一次取消"可被发现 */
  get pendingSkillIndex(): number {
    return this._pendingSkillIndex;
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
    this.gridController.clearHighlights();
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

    // 已经上阵：点击 = 撤回（与拖拽回调同一实现）
    if (unit.data.gridPos.col >= 0) {
      this.unplaceUnit(index);
      return;
    }

    // 未上阵，正常进入选中
    this._selectedDeployUnitIndex = index;
    this._highlightDeployArea();
    // 分发选中通知
    if (this._onDeploySelectionChanged) {
      this._onDeploySelectionChanged(this._selectedDeployUnitIndex);
    }
  }

  // -------------------------------------------------------------------------
  // 布阵规则层（无视觉），供 BattleUI 的拖拽手势调用（§3.3）
  // -------------------------------------------------------------------------

  /** 拖拽已消费本次触摸时返回 true，用于忽略紧随其后的格点击 */
  setDeployDragGuard(guard: (() => boolean) | null): void {
    this._deployDragGuard = guard;
  }

  /** 该格上的己方单位下标；无则 -1 */
  playerUnitAt(pos: GridPosition): number {
    return this._playerUnits.findIndex(
      u => u.data?.gridPos.row === pos.row && u.data?.gridPos.col === pos.col
    );
  }

  /** UI 坐标（设计像素）→ 棋盘坐标；不在棋盘范围返回 null（供拖拽落点判定） */
  gridPosFromUI(x: number, y: number): GridPosition | null {
    const gridNode = this.gridController?.node;
    const ui = gridNode?.isValid ? gridNode.getComponent(UITransform) : null;
    if (!ui) return null;
    const local = ui.convertToNodeSpaceAR(new Vec3(x, y, 0));
    return this.gridController.positionToGrid({ x: local.x, y: local.y });
  }

  /**
   * 拖拽落点预览：可放 = 实心绿，不可放 = 红（null = 清除预览）。
   * 注意不能复用 `GRID.DEPLOYABLE` / `GRID.DEPLOY_DISABLED` —— 那两个正是部署区
   * 两行与后四行的底色，设上去等于没有任何高亮反馈（实测色值完全相同）。
   *
   * 跨格拖拽必须先复原**上一个**预览格：只给新格上色会让拖过的格子留下残影
   * （见 `_dropPreviewPos` 注释）。离开棋盘时走全量重绘兜底，清掉任何残留。
   */
  previewDeployDrop(pos: GridPosition | null, valid: boolean): void {
    if (!pos) {
      // 离开棋盘 / 拖拽结束：全量重绘部署区，确保没有任何残影
      this._dropPreviewPos = null;
      this._highlightDeployArea();
      return;
    }
    // 同一格反复上报（拖拽中每帧都会调）→ 无需重设颜色
    if (this._dropPreviewPos
      && this._dropPreviewPos.row === pos.row
      && this._dropPreviewPos.col === pos.col) {
      // 但可放/不可放可能翻转（例如经过已占用格），仍需按最新判定刷新
      this.gridController.setCellColor(pos, valid ? GRID.DRAG_DROP_VALID : GRID.DRAG_DROP_INVALID);
      return;
    }

    this._clearDropPreview();
    this.gridController.setCellColor(pos, valid ? GRID.DRAG_DROP_VALID : GRID.DRAG_DROP_INVALID);
    this._dropPreviewPos = { row: pos.row, col: pos.col };
  }

  /** 把上一个预览格恢复成它「本来的」部署区底色（不整块重绘，避免闪烁） */
  private _clearDropPreview(): void {
    const prev = this._dropPreviewPos;
    this._dropPreviewPos = null;
    if (!prev) return;
    this.gridController.setCellColor(prev, this._deployCellBaseColor(prev));
  }

  /**
   * 部署阶段某格「未预览时应有的底色」。
   * 与 `_highlightDeployArea()` 的三条规则保持一致：已部署 > 可部署区 > 敌方半场。
   */
  private _deployCellBaseColor(pos: GridPosition): Color {
    const placed = this._deployedPositions.some(p => p.row === pos.row && p.col === pos.col);
    if (placed) return GRID.DEPLOYED;
    return pos.row <= 1 ? GRID.DEPLOYABLE : GRID.DEPLOY_DISABLED;
  }

  /**
   * 拖拽开始时收起该单位的选中缩放（1.08 tween 会拽动节点读感，§6 风险）。
   * 结束时不必恢复 —— 布阵阶段的缩放本就恒为 1。
   */
  setDeployDragging(unitIndex: number, dragging: boolean): void {
    const unit = this._playerUnits[unitIndex];
    if (!unit?.node?.isValid) return;
    if (dragging) {
      unit.setSelected(false);
    }
  }

  /** 拖拽期间把原单位置为半透明（视觉层调用，规则层只负责改组件） */
  setUnitDimmed(unitIndex: number, dimmed: boolean): void {
    const unit = this._playerUnits[unitIndex];
    if (!unit?.node?.isValid) return;
    let op = unit.node.getComponent(UIOpacity);
    if (!op) op = unit.node.addComponent(UIOpacity);
    if (op) op.opacity = dimmed ? 140 : 255;
  }

  /** 是否可落子：在部署区（row<=1）且未被别的单位占用 */
  canPlaceAt(unitIndex: number, pos: GridPosition): boolean {
    if (pos.row < 0 || pos.row > 1 || pos.col < 0 || pos.col >= GridController.GRID_SIZE) {
      return false;
    }
    const other = this.playerUnitAt(pos);
    return other < 0 || other === unitIndex;
  }

  /** 落子（棋盘内移动也走这里：先摘掉旧位置再放到新位置）
   *
   * `advanceSelection = false` 供**拖拽路径**使用：拖拽是"点着哪个拖哪个"的直接操作，
   * 与"当前选中是哪张"互不相干，因此不得改写选中态（否则拖走 A 会把 B 点亮）。
   */
  placeUnit(unitIndex: number, pos: GridPosition, advanceSelection: boolean = true): void {
    const unit = this._playerUnits[unitIndex];
    if (!unit?.data || !unit.node?.isValid) return;

    // 已在场则先移除旧记录，避免同一单位在 _deployedPositions 里出现两次
    const old = unit.data.gridPos;
    if (old.col >= 0) {
      this._deployedPositions = this._deployedPositions.filter(
        p => !(p.row === old.row && p.col === old.col)
      );
    }

    unit.setGridPosition(pos);
    this._deployedPositions.push({ row: pos.row, col: pos.col });
    unit.node.active = true;

    this._afterDeployChanged(unitIndex, false, advanceSelection);
  }

  /** 撤回上阵（持牌回到棋盘外）
   *
   * `advanceSelection = false` 供拖拽路径使用，理由同 `placeUnit`。
   */
  unplaceUnit(unitIndex: number, advanceSelection: boolean = true): void {
    const unit = this._playerUnits[unitIndex];
    if (!unit?.data || !unit.node?.isValid) return;

    const old = unit.data.gridPos;
    if (old.col >= 0) {
      this._deployedPositions = this._deployedPositions.filter(
        p => !(p.row === old.row && p.col === old.col)
      );
    }
    // 重置单位位置到棋盘外（与 init 时 updatePosition 的计算一致）
    unit.data.gridPos = { row: unitIndex, col: -1 };
    unit.data.hasMoved = false;
    unit.node.setPosition(
      (-1 - 2.5) * GridController.CELL_SIZE,
      (unitIndex - 2.5) * GridController.CELL_SIZE
    );
    unit.node.active = false;

    this._afterDeployChanged(unitIndex, true, advanceSelection);
  }

  /** 场上两兵互换位置 */
  swapUnits(indexA: number, indexB: number): void {
    const a = this._playerUnits[indexA];
    const b = this._playerUnits[indexB];
    if (!a?.data || !b?.data || !a.node?.isValid || !b.node?.isValid) return;
    const posA = { ...a.data.gridPos };
    const posB = { ...b.data.gridPos };
    if (posA.col < 0 || posB.col < 0) return;

    a.setGridPosition(posB);
    b.setGridPosition(posA);

    // _deployedPositions 是位置集合，换位后集合不变，只需重排为当前实际位置
    this._deployedPositions = this._playerUnits
      .filter(u => (u.data?.gridPos.col ?? -1) >= 0)
      .map(u => ({ row: u.data!.gridPos.row, col: u.data!.gridPos.col }));

    this._highlightDeployArea();
    this._notifyDeployPlaced();
    // 棋盘内换位同样不涉及"选中哪张"，但上面的三态刷新会抹掉选中高亮，故补绘
    this._paintDeploySelection();
  }

  /** 落子/撤回后的统一收尾：重绘部署区高亮 + 刷新兵牌三态 + 选中推进 */
  private _afterDeployChanged(
    changedIndex: number,
    selectSelf: boolean = false,
    advanceSelection: boolean = true
  ): void {
    this._highlightDeployArea();
    this._notifyDeployPlaced();
    if (advanceSelection) {
      this._advanceDeploySelection(changedIndex, selectSelf);
      return;
    }
    // 拖拽路径：不改写"选中哪张"。但上面的三态刷新会把所有未上阵槽位一律重置为
    // unplaced（含当前选中那张），故补绘一次选中态，避免高亮被静默抹掉。
    this._paintDeploySelection();
  }

  /**
   * 只**重绘**当前选中态，不推进。
   *
   * 供拖拽路径使用：拖拽是"点着哪个拖哪个"的直接操作，与"当前选中是哪张"无关，
   * 因此不得改写选中态；但若选中的那张已因本次操作上阵，则按点击路径的语义清空选中
   * （不会跳到别的卡上，这正是"拖走 A 却点亮 B"的割裂来源）。
   */
  private _paintDeploySelection(): void {
    let idx = this._selectedDeployUnitIndex;
    if (idx >= 0) {
      const cur = this._playerUnits[idx];
      if ((cur?.data?.gridPos.col ?? -1) >= 0) idx = -1;
    }
    this._selectedDeployUnitIndex = idx;
    if (this._onDeploySelectionChanged) {
      this._onDeploySelectionChanged(idx);
    }
  }

  private _notifyDeployPlaced(): void {
    if (this._onDeployUnitPlacedCallback) {
      this._onDeployUnitPlacedCallback(this._deployedPositions.length, this._playerUnits.length);
    }
  }

  /**
   * 落子/撤回后的选中推进。
   * `selectSelf` = 撤回后应重新选中该兵；否则自动选中下一张未上阵的牌。
   */
  private _advanceDeploySelection(changedIndex: number, selectSelf: boolean): void {
    let next = -1;
    if (selectSelf) {
      next = changedIndex;
    } else if (this._selectedDeployUnitIndex === changedIndex) {
      next = this._playerUnits.findIndex(
        (u, i) => i !== changedIndex && (u.data?.gridPos.col ?? -1) < 0
      );
    } else if (this._selectedDeployUnitIndex >= 0) {
      const cur = this._playerUnits[this._selectedDeployUnitIndex];
      next = (cur?.data?.gridPos.col ?? -1) >= 0 ? -1 : this._selectedDeployUnitIndex;
      if (next < 0) {
        next = this._playerUnits.findIndex(u => (u.data?.gridPos.col ?? -1) < 0);
      }
    }

    this._selectedDeployUnitIndex = next;
    if (this._onDeploySelectionChanged) {
      this._onDeploySelectionChanged(next);
    }
  }

  private onDeployCellClicked(pos: GridPosition): void {
    // 拖拽已处理过这次触摸 → 忽略随之而来的格点击（否则会二次落子）
    if (this._deployDragGuard?.()) return;

    if (pos.row > 1) return;

    // 如果该格子有己方单位 → 撤回（通过 selectDeployUnit 触发）
    const existingIndex = this.playerUnitAt(pos);
    if (existingIndex >= 0) {
      this.selectDeployUnit(existingIndex);
      return;
    }

    if (this._selectedDeployUnitIndex < 0) return;
    if (this.isOccupied(pos)) return;

    const unit = this._playerUnits[this._selectedDeployUnitIndex];
    if (!unit?.data) return;
    if (unit.data.gridPos.col >= 0) return;

    this.placeUnit(this._selectedDeployUnitIndex, pos);
  }

  private startPlayerTurn(): void {
    this._currentUnitIndex = 0;
    for (const unit of this._playerUnits) {
      if (unit.data?.isAlive) {
        unit.onTurnStart(this._playerUnits);
      }
    }
    // 回合开始毒伤可能导致全部玩家死亡，立即结算
    this.checkBattleEnd();
    if (this._phase !== 'player_turn') return;
    this.selectNextPlayerUnit();
  }

  private selectNextPlayerUnit(): void {
    // 取消任何未完成的自动跳过延迟，防止用户切换单位后回调冲突
    this._cancelAutoSkip();
    this._clearPendingSkill();   // 防御：换单位时绝不能带着上一个单位的技能锁定
    this._movePreviewPos = null;
    this._stoodStill = false;
    this.gridController.clearPreview();

    if (this._selectedUnit) {
      this._selectedUnit.setSelected(false);
      this._selectedUnit = null;
    }
    this.gridController.clearHighlights();

    // 从当前索引开始搜索，支持切换单位；若后面没有则回绕到前面
    const start = this._currentUnitIndex;
    const len = this._playerUnits.length;
    for (let offset = 0; offset < len; offset++) {
      const i = (start + offset) % len;
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
      this.gridController.highlightCells(moves, GRID.MOVE_RANGE);
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
    this.gridController.highlightCells(attacks, GRID.ATTACK_RANGE);
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
        if (row < 0 || row >= GridController.GRID_SIZE || col < 0 || col >= GridController.GRID_SIZE) continue;
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

    const inRange = targets.filter(t => {
      const dist = Math.abs(t.data!.gridPos.row - pos.row) + Math.abs(t.data!.gridPos.col - pos.col);
      return dist <= range;
    });

    // 嘲讽（精英盾兵）：强制普通攻击该单位。只在它**仍在射程内**时生效 ——
    // 否则玩家会被卡在无法攻击任何人的状态（可以先走开再打别处）。
    const taunt = unit.data.buffs.find(b => b.type === 'taunt');
    if (taunt) {
      const forced = inRange.find(t =>
        t.data!.gridPos.row === taunt.params.row && t.data!.gridPos.col === taunt.params.col
      );
      if (forced) return [forced.data!.gridPos];
    }

    return inRange.map(t => t.data!.gridPos);
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
      this._stoodStill = true;
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

  /**
   * 找出这个单位"真有用"的技能；返回技能配置（取名字做提示），没有则 null。
   *
   * 为什么要有它：自动跳过原先**只看普通攻击射程**，于是"攻击范围外、但技能够得着"
   * 的单位被系统抢走回合 —— 玩家想放技能都来不及点（用户报告的核心痛点）。
   * 判定口径（已与玩家确认）：①射程内有敌人的技能；②自身增益类技能；
   * ③友方能吃到效果的技能。**不算** AoE 点空位、没意义的位移 ——
   * aoe / tile / line 一律不计："能点"不等于"有用"，不该拦住自动跳过。
   */
  private _findUsefulSkill(unit: UnitController): SkillConfig | null {
    if (!unit.data) return null;
    for (let i = 0; i < unit.data.skills.length; i++) {
      const skill = unit.data.skills[i];
      if (skill.type === 'passive') continue;                    // 被动不是"能做的事"
      if (!unit.canUseSkill(i)) continue;                        // 能量不足
      if (skill.preMove && unit.data.preMoveSkillUsed) continue; // 本回合已用
      if (skill.targetType === 'self') return skill;             // ②自身增益
      if (skill.targetType === 'enemy' || skill.targetType === 'ally') {
        if (this.getValidSkillTargets(unit, skill).length > 0) return skill; // ① ③
      }
    }
    return null;
  }

  private _checkAutoSkipIfNoTargets(unit: UnitController): void {
    if (!unit.data) return;
    if (this.getAttackableEnemies(unit).length > 0) return;
    const usefulSkill = this._findUsefulSkill(unit);
    if (usefulSkill) {
      // 没得打、但技能有用 —— **不跳过**，保持选中，只提示玩家还有牌可打
      if (this._onAutoSkipCallback) {
        this._onAutoSkipCallback(`${unit.data.name} 无可攻击目标 · 可用技能：${usefulSkill.name}`);
      }
      return;
    }
    if (this._onAutoSkipCallback) {
      this._onAutoSkipCallback(
        `${unit.data.name} 本回合无事可做，${BattleManager.AUTO_SKIP_GRACE.toFixed(1)} 秒后自动跳过（点击可取消）`
      );
    }
    this._autoSkipUnitRef = unit;
    // 注意这里**不**立刻置 `hasActed`：宽限期内玩家点棋盘/技能都能把它撤回来，
    // 置位挪到 `_onAutoSkipTimeout` —— 否则"想反悔"时单位已经被判过行动了
    this.scheduleOnce(this._onAutoSkipTimeout, BattleManager.AUTO_SKIP_GRACE);
  }

  /**
   * 取消待执行的自动跳过。**任何玩家输入**（点格、放技能、攻击、待命）都该调它 ——
   * 一是让玩家能反悔，二是顺手收掉"即将跳过"横幅（回调给 UI）。
   */
  private _cancelAutoSkip(): void {
    if (!this._autoSkipUnitRef) return;
    this._autoSkipUnitRef = null;
    this.unschedule(this._onAutoSkipTimeout);
    if (this._onAutoSkipCancelledCallback) {
      this._onAutoSkipCancelledCallback();
    }
  }

  private _onAutoSkipTimeout(): void {
    const unit = this._autoSkipUnitRef;
    this._autoSkipUnitRef = null;
    if (!unit?.data?.isAlive) return;
    // 真到点了才落定"本回合不再行动"
    unit.data.hasActed = true;
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
    // 单位回合结束：技能选择模式必须一起收掉。
    // 原先漏了这一步 —— 在 `skill_target` 下点「结束回合」会留下 `_phase==='skill_target'`
    // 而 `_selectedUnit===null` 的脏状态，后续点格全被路由进 `handleSkillTargetClick`。
    this._clearPendingSkill();
    // 先清除选中状态和高亮：即使战斗结束（victory/defeat）也要清理残留高亮
    if (this._selectedUnit) {
      this._selectedUnit.setSelected(false);
      this._selectedUnit = null;
    }
    this.gridController.clearHighlights();
    this._skillPreviewPos = null;
    this._stoodStill = false;

    if (this._phase !== 'player_turn') return;
    this._unitPhase = 'done';
    this._currentUnitIndex++;
    this.selectNextPlayerUnit();
  }

  waitCurrentUnit(): void {
    if (this._actionLocked) return;
    if (this._phase === 'skill_target') this._clearPendingSkill();
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;
    unit.data.hasActed = true;
    this._cancelAutoSkip();
    this.finishUnitTurn();
  }

  /**
   * 退出技能选择模式，恢复进入前的子阶段。**所有取消/结束路径都走这里** ——
   * 原先各处手写「`_pendingSkill = null` + `_phase = 'player_turn'` + 硬编码回 `action`」，
   * 于是从 `move` 进的技能一取消就跳到 `action`（还顺手把行动化了）。
   *
   * 没有待选技能时是**纯 no-op**（不碰 `_phase`/`_unitPhase`）—— 因此可以在任何
   * 收口处无脑调用，不会把正常状态改坏。
   */
  private _clearPendingSkill(): void {
    const hadPending = this._pendingSkillIndex >= 0 || this._phase === 'skill_target';
    this._pendingSkill = null;
    this._pendingSkillIndex = -1;
    this._skillTargets = [];
    this._skillPreviewPos = null;
    if (!hadPending) return;

    if (this._phase === 'skill_target') this._phase = 'player_turn';
    const unit = this._selectedUnit;
    const back = this._skillReturnPhase;
    this._skillReturnPhase = 'action';
    if (!unit?.data?.isAlive) return;
    this._unitPhase = back;
    this.gridController.clearHighlights();
    if (back === 'move') {
      this.highlightMoveRange(unit);
    } else {
      this.highlightAttackRange(unit);
    }
    if (this._onUnitPhaseChanged) {
      this._onUnitPhaseChanged('player_turn', unit, back);
    }
  }

  /** 外部（UI 的"取消"入口）请求取消技能选择。不在技能选择模式时无副作用 */
  cancelPendingSkill(): void {
    if (this._phase === 'skill_target') this._clearPendingSkill();
  }

  /**
   * 技能此刻用不了的**原因**；可用则 null。
   *
   * 抽出来是因为原先只有布尔 `canUseSkillWithTargets`：按钮置灰但不点不动，
   * 玩家永远不知道是能量不够、还是射程内没人（"选了之后只能点敌方单位"的迷惑源头）。
   * 现在"按钮是否点亮"和"点了之后提示什么"共用同一份判断，不会两处口径不一致。
   */
  getSkillUnusableReason(unit: UnitController, skillIndex: number): string | null {
    if (!unit.data || !unit.data.isAlive) return '单位已阵亡';
    const skill = unit.data.skills[skillIndex];
    if (!skill) return '技能不存在';
    if (skill.type === 'passive') return '被动技能无需释放';
    // 「已行动」要在「能量不足」之前判：回合已结束的单位再说能量不足会误导
    if (unit.data.hasActed) return '本回合已行动';
    if (!unit.canUseSkill(skillIndex)) return '能量不足';
    if (skill.preMove && unit.data.preMoveSkillUsed) return '本回合已使用';
    if (skill.targetType === 'self') return null;
    if (this.getValidSkillTargets(unit, skill).length === 0) return '射程内无目标，可先移动';
    return null;
  }

  canUseSkillWithTargets(unit: UnitController, skillIndex: number): boolean {
    return this.getSkillUnusableReason(unit, skillIndex) === null;
  }

  onAttackSelected(): void {
    if (this._actionLocked) return;
    if (this._phase !== 'player_turn') return;
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive || unit.data.hasActed) return;
    if (this._unitPhase !== 'action') return;
    this._cancelAutoSkip();
    this._unitPhase = 'attack_target';
    this.highlightAttackRange(unit);
    if (this._onUnitPhaseChanged) {
      this._onUnitPhaseChanged('player_turn', unit, 'attack_target');
    }
  }

  onCellClicked(gridPos: GridPosition): void {
    // 行动演出期间锁输入（见 `_actionLocked`）：既防连打，也防"移动补间途中又落一个移动"
    if (this._actionLocked) return;
    // 任何棋盘输入都撤销待执行的自动跳过：跳过是"建议"，玩家一动手就该让位
    this._cancelAutoSkip();
    if (this._phase === 'skill_target') {
      this.handleSkillTargetClick(gridPos);
      return;
    }
    if (this._phase !== 'player_turn') return;
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;

    if (this._unitPhase === 'move') {
      const isOwnTile = unit.data.gridPos.row === gridPos.row && unit.data.gridPos.col === gridPos.col;
      // 点自己（已有移动预览）：只撤销预览，仍留在移动阶段
      if (isOwnTile && this._movePreviewPos) {
        this.gridController.clearPreview();
        this._movePreviewPos = null;
        return;
      }
      // 点自己（无预览）：原地待命，进入行动阶段。
      // 这是**可撤销**的（见下面 action 分支），所以先记 `_stoodStill`
      if (isOwnTile) {
        this.gridController.clearPreview();
        this._movePreviewPos = null;
        unit.data.hasMoved = true;
        this._stoodStill = true;
        this._unitPhase = 'action';
        this.highlightAttackRange(unit);
        if (this._onUnitPhaseChanged) {
          this._onUnitPhaseChanged('player_turn', unit, 'action');
        }
        this._checkAutoSkipIfNoTargets(unit);
        return;
      }

      // 检查是否在可移动范围内
      const moves = this.getReachablePositions(unit.data.gridPos, unit.data.stats.move);
      const canMove = moves.some(m => m.row === gridPos.row && m.col === gridPos.col);

      if (!canMove) {
        // 点击无效区域：完全无反应
        return;
      }

      // 已有预览且点击同一位置 → 确认移动（带动画）
      if (this._movePreviewPos &&
          this._movePreviewPos.row === gridPos.row &&
          this._movePreviewPos.col === gridPos.col) {
        this._movePreviewPos = null;
        this.gridController.clearPreview();
        this._actionLocked = true;
        unit.moveToPositionAnimated(gridPos, UnitController.MOVE_ANIM_DURATION, () => {
          this._actionLocked = false;
          if (!unit.data || this._phase !== 'player_turn') return;
          // 真的走过一步 → 不再是"原地待命"，这一手不可撤销
          this._stoodStill = false;
          this._unitPhase = 'action';
          this.highlightAttackRange(unit);
          if (this._onUnitPhaseChanged) {
            this._onUnitPhaseChanged('player_turn', unit, 'action');
          }
          this._checkAutoSkipIfNoTargets(unit);
        });
        this.gridController.clearHighlights();
        return;
      }

      // 第一次点击可移动格：设置预览
      this._movePreviewPos = { row: gridPos.row, col: gridPos.col };
      this.gridController.highlightPreviewCell(gridPos);
      return;
    }

    // action 阶段点自己 = 撤销「原地待命」，退回移动阶段。
    // 只在 `_stoodStill` 时允许 —— 真移动过的回合不给撤销，否则等于白送一次移动。
    if (this._unitPhase === 'action' &&
        unit.data.gridPos.row === gridPos.row && unit.data.gridPos.col === gridPos.col) {
      if (this._stoodStill) {
        // 顺序要紧：`highlightMoveRange` 会读 `hasMoved` 决定画移动范围还是攻击范围
        unit.data.hasMoved = false;
        this._stoodStill = false;
        this._unitPhase = 'move';
        this._cancelAutoSkip();
        this.highlightMoveRange(unit);
        if (this._onUnitPhaseChanged) {
          this._onUnitPhaseChanged('player_turn', unit, 'move');
        }
      }
      return;
    }

    if (this._unitPhase === 'attack_target') {
      const targetEnemy = this._enemyUnits.find(e =>
        e.data?.isAlive && e.data.gridPos.row === gridPos.row && e.data.gridPos.col === gridPos.col
      );
      if (targetEnemy) {
        const dist = Math.abs(gridPos.row - unit.data.gridPos.row) + Math.abs(gridPos.col - unit.data.gridPos.col);
        if (dist <= unit.data.stats.range) {
          this._actionLocked = true;
          // 打完（伤害落到突刺顶点）再收尾回合：这样"最后一击打死全部敌人"时
          // `checkBattleEnd` 已经把 `_phase` 切走，`endPlayerTurn` 会自行早退
          // （与原先同步结算时的时序一致，避免胜利后敌方还接着行动）
          this.executeAttack(unit, targetEnemy, () => {
            this._actionLocked = false;
            if (unit.data) unit.data.hasActed = true;
            this.finishUnitTurn();
          });
          return;
        }
      }
      // 点击无效目标或非敌方：取消攻击模式，回到 action
      this._unitPhase = 'action';
      this.gridController.clearHighlights();
      if (this._onUnitPhaseChanged) {
        this._onUnitPhaseChanged('player_turn', unit, 'action');
      }
      return;
    }

    // action 阶段：允许切换选中友方单位，不再直接响应敌方格子点击
    const clickedPlayer = this._playerUnits.find(u =>
      u.data?.isAlive && u.data.gridPos.row === gridPos.row && u.data.gridPos.col === gridPos.col
    );
    if (clickedPlayer && clickedPlayer !== unit && !clickedPlayer.data.hasActed) {
      this._currentUnitIndex = this._playerUnits.indexOf(clickedPlayer);
      this.selectNextPlayerUnit();
      return;
    }
  }

  private _getAoePreviewPositions(center: GridPosition, skill: import('../config/GameData').SkillConfig): GridPosition[] {
    const positions: GridPosition[] = [];
    // 实际命中范围在 executeSkillEffects 中：aoe_3x3 与 aoe_1radius 都是 3×3（dr<=1 && dc<=1）。
    // 预览必须与之一致，否则会把 3×3 的技能显示成十字，误导玩家。
    const has3x3 = skill.effects.some(e => e.type === 'aoe_3x3' || e.type === 'aoe_1radius');
    for (let r = 0; r < GridController.GRID_SIZE; r++) {
      for (let c = 0; c < GridController.GRID_SIZE; c++) {
        const dr = Math.abs(r - center.row);
        const dc = Math.abs(c - center.col);
        if (has3x3) {
          if (dr <= 1 && dc <= 1) positions.push({ row: r, col: c });
        } else {
          if (dr + dc <= 1) positions.push({ row: r, col: c });
        }
      }
    }
    return positions;
  }

  private _showSkillPreview(gridPos: GridPosition): void {
    if (!this._pendingSkill) return;
    this._skillPreviewPos = { row: gridPos.row, col: gridPos.col };
    const isAoe = this._pendingSkill.targetType === 'aoe';
    const baseColor = isAoe ? GRID.SKILL_TARGET_AOE : GRID.SKILL_TARGET;

    // 重新高亮所有可选目标，再叠加预览效果（避免切换时颜色残留）
    this.gridController.highlightCells(this._skillTargets, baseColor);

    if (isAoe) {
      const previewPositions = this._getAoePreviewPositions(gridPos, this._pendingSkill);
      this.gridController.highlightAoePreview(
        gridPos,
        previewPositions,
        GRID.AOE_CENTER,
        GRID.AOE_RANGE
      );
    } else {
      this.gridController.highlightSelectedTarget(gridPos, GRID.SELECTED_TARGET);
    }
  }

  private _executePendingSkill(gridPos: GridPosition): void {
    const unit = this._selectedUnit;
    if (!unit?.data || !this._pendingSkill) return;
    const skillIndex = this._pendingSkill['_skillIndex'] as number;
    const usedSkill = unit.useSkill(skillIndex);
    if (!usedSkill) {
      // 能量不足等导致使用失败：干净退出技能模式（回到进入前的子阶段），并说明原因
      const reason = this.getSkillUnusableReason(unit, skillIndex) ?? '技能无法释放';
      this._clearPendingSkill();
      if (this._onSkillRejectedCallback) this._onSkillRejectedCallback(reason);
      return;
    }

    const targetUnit = [...this._enemyUnits, ...this._playerUnits].find(u =>
      u.data?.isAlive && u.data.gridPos.row === gridPos.row && u.data.gridPos.col === gridPos.col
    );

    this.executeSkillEffects(unit, targetUnit, gridPos, usedSkill.effects);

    // 技能已消耗 → 这里**不**走 `_clearPendingSkill()`：不需要（也不该）恢复高亮，
    // 单位随后就结束回合，恢复一次只是白闪
    this._pendingSkill = null;
    this._pendingSkillIndex = -1;
    this._skillTargets = [];
    this._skillPreviewPos = null;
    this._skillReturnPhase = 'action';

    // 如果技能已导致战斗结束（victory/defeat），不要覆盖 phase
    if (this._phase === 'skill_target') {
      this._phase = 'player_turn';
    }
    unit.data.hasActed = true;
    this.finishUnitTurn();
  }

  private handleSkillTargetClick(gridPos: GridPosition): void {
    const isTarget = this._skillTargets.some(t => t.row === gridPos.row && t.col === gridPos.col);
    if (!isTarget) {
      // 点了非法目标（含"点自己"这种最常见的反悔动作）→ 取消技能选择。
      // AOE 可以以自己为中心，那时自己的格子**在** `_skillTargets` 里，走下面的预览/确认分支，
      // 两个分支天然互斥，不需要额外判断是不是自己。
      this._clearPendingSkill();
      return;
    }

    // 已有预览且点击同一位置 → 确认释放
    if (this._skillPreviewPos &&
        this._skillPreviewPos.row === gridPos.row &&
        this._skillPreviewPos.col === gridPos.col) {
      this._executePendingSkill(gridPos);
      return;
    }

    // 点击新目标 → 切换预览
    this._showSkillPreview(gridPos);
  }

  private _getMarkBonus(target: UnitController): number {
    if (!target?.data) return 0;
    const markBuff = target.data.buffs.find(b => b.type === 'mark');
    return markBuff ? (markBuff.params.amount ?? 2) : 0;
  }

  /**
   * 取出并消耗施法者身上的「下次攻击附加伤害」（charge 的 bonus_damage）。
   * 读取即移除，避免一次加成被连续攻击反复吃掉。
   */
  private _consumeBonusDamage(attacker: UnitController | null): number {
    if (!attacker?.data) return 0;
    const idx = attacker.data.buffs.findIndex(b => b.type === 'bonus_damage');
    if (idx < 0) return 0;
    const amount = attacker.data.buffs[idx].params.amount ?? 0;
    attacker.data.buffs.splice(idx, 1);
    return amount;
  }

  private executeSkillEffects(
    caster: UnitController,
    target: UnitController | null,
    targetPos: GridPosition | null,
    effects: SkillEffect[]
  ): void {
    if (!caster.data) return;

    // 施法提示（一胀 + 淡蓝闪）。放在统一的结算入口，玩家技能与敌人技能就都有反馈；
    // 效果本身仍同步结算 —— 演出只是"提示要放了"，不该让判定等动画。
    if (caster.node?.isValid) {
      caster.playCastCue();
    }
    
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
          this._reportDamage(target, dmg);
          break;
        }

        case 'damage_multiplier': {
          if (!target?.data) break;
          const mult = effect.params.multiplier ?? 1;
          const markBonus = this._getMarkBonus(target);
          const rawDmg = Math.floor(caster.data.stats.attack * mult * skillMultiplier);
          const dmg = target.takeDamage(rawDmg + markBonus, ignoreDefense, caster);
          this._totalDamageDealt += dmg;
          this._reportDamage(target, dmg);
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
            this._reportDamage(target, dmg);
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
          this._reportDamage(target, dmg);
          break;
        }

        case 'bonus_damage': {
          // 语义是「本次攻击附带伤害」，不是独立伤害。
          // 原实现直接对 target 造成伤害 —— 而冲锋（charge）是 targetType:'self'，
          // 此时 target === caster，于是「空放冲锋」会把自己打伤、连放两次直接
          // 打死并从棋盘消失（用户报告的「单位渲染没了」）。
          // 改为挂一次性加成 buff，由 _consumeBonusDamage 在攻击时消费。
          // duration 1：本回合没攻击则下回合开始自动过期，不会永久滞留。
          caster.addBuff('bonus_damage', 1, { amount: effect.params.amount ?? 2 });
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
                this._reportDamage(enemy, dmg);
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
              // 必须是 3×3 方块（Chebyshev），与 _getAoePreviewPositions 的高亮范围一致。
              // 原实现用曼哈顿距离（|dr|+|dc| <= 1）= 只打十字 5 格，而预览高亮 9 格 ——
              // 玩家看到对角格被高亮、技能落下去却打不到（实测：中心 (3,3)，对角 (2,4) 的
              // 弩手零伤害）。火球文案"目标周围 1 格"指的也是 3×3。
              const dr = Math.abs(enemy.data.gridPos.row - center.row);
              const dc = Math.abs(enemy.data.gridPos.col - center.col);
              if (dr <= 1 && dc <= 1) {
                const markBonus = this._getMarkBonus(enemy);
                const dmg = enemy.takeDamage(baseDmg + markBonus, ignoreDefense, caster);
                this._totalDamageDealt += dmg;
                this._reportDamage(enemy, dmg);
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
                this._reportDamage(enemy, dmg);
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
          this._reportDamage(target, mainDmg);
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
            this._reportDamage(chainTarget, chainDmg);
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
          if (newRow >= 0 && newRow < GridController.GRID_SIZE && newCol >= 0 && newCol < GridController.GRID_SIZE && !this.isOccupied({ row: newRow, col: newCol })) {
            // 击退是被外力搬动：立即生效、只补间视图（AGENTS 教训 D 的"瞬移不该走过去"）
            target.slideToPosition({ row: newRow, col: newCol });
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
          if (newRow >= 0 && newRow < GridController.GRID_SIZE && newCol >= 0 && newCol < GridController.GRID_SIZE && !this.isOccupied({ row: newRow, col: newCol })) {
            caster.slideToPosition({ row: newRow, col: newCol });
          }
          break;
        }

        case 'teleport': {
          if (!caster.data || !targetPos) break;
          caster.slideToPosition(targetPos);
          break;
        }

        case 'line_aoe': {
          // 直线 AOE（剑气斩 / Boss 横扫）：从施法者朝目标方向的第 1..length 格
          if (!caster.data) break;
          const length = effect.params.length ?? 2;
          const multLine = effect.params.multiplier ?? 1.2;
          const tPos = target?.data?.gridPos ?? targetPos;
          if (!tPos) break;
          const dr = Math.sign(tPos.row - caster.data.gridPos.row);
          const dc = Math.sign(tPos.col - caster.data.gridPos.col);
          if (dr === 0 && dc === 0) break;
          // 斜向时取主轴（未对齐的目标不扫出对角线，保持"直线"语义可读）
          const step = (dr !== 0 && dc !== 0) ? { row: dr, col: 0 } : { row: dr, col: dc };
          const lineDmg = Math.floor(caster.data.stats.attack * multLine * skillMultiplier);
          const foes = caster.data.isPlayer ? this._enemyUnits : this._playerUnits;
          for (let i = 1; i <= length; i++) {
            const row = caster.data.gridPos.row + step.row * i;
            const col = caster.data.gridPos.col + step.col * i;
            for (const foe of foes) {
              if (!foe.data?.isAlive) continue;
              if (foe.data.gridPos.row !== row || foe.data.gridPos.col !== col) continue;
              const markBonus = this._getMarkBonus(foe);
              const dmg = foe.takeDamage(lineDmg + markBonus, ignoreDefense, caster);
              this._totalDamageDealt += dmg;
              this._reportDamage(foe, dmg);
            }
          }
          break;
        }

        case 'teleport_behind': {
          // 暗影步：瞬移到目标**背后**（沿施法者→目标方向再外推一格）；被占/越界则原地出手
          if (!caster.data || !target?.data) break;
          const tPos = target.data.gridPos;
          const dr = Math.sign(tPos.row - caster.data.gridPos.row);
          const dc = Math.sign(tPos.col - caster.data.gridPos.col);
          const row = tPos.row + dr;
          const col = tPos.col + dc;
          if (row < 0 || row >= GridController.GRID_SIZE) break;
          if (col < 0 || col >= GridController.GRID_SIZE) break;
          if (this.isOccupied({ row, col })) break;
          caster.slideToPosition({ row, col });
          break;
        }

        case 'taunt': {
          // 精英盾兵嘲讽：给相邻玩家挂 taunt buff，记下施法者站位。
          // duration +1：buff 在玩家**回合开始时**先扣一层，不 +1 会当天就失效。
          if (!caster.data) break;
          const radius = effect.params.radius ?? 1;
          const duration = (effect.params.duration ?? 1) + 1;
          const cpos = caster.data.gridPos;
          for (const p of this._playerUnits) {
            if (!p.data?.isAlive) continue;
            const dist = Math.abs(p.data.gridPos.row - cpos.row) +
              Math.abs(p.data.gridPos.col - cpos.col);
            if (dist <= radius) {
              p.addBuff('taunt', duration, { row: cpos.row, col: cpos.col });
            }
          }
          break;
        }

        case 'shield_wall':
        case 'summon':
          // 被动：盾墙在 UnitController.takeDamage 里生效；集结在敌方回合开始时结算
          break;

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

  /**
   * 伤害数字上报的唯一入口。原先十几处各自判空 + 回调，改到一处是为了顺手统一
   * "0 伤害不飘字"这类规则（也避免以后加规则时漏掉某几处）。
   */
  private _reportDamage(target: UnitController | null | undefined, amount: number): void {
    if (amount <= 0) return;
    if (!target?.node?.isValid) return;
    if (!this._onDamageDealtCallback) return;
    this._onDamageDealtCallback(target.node, amount);
  }

  /**
   * 普通攻击。手感要点：**先出手、后结算** —— 近战的伤害落在突刺到顶的那一帧
   * （`playAttackAnim` 的 `onImpact`），远程（闪白）则是同步的。
   * 注意结算被推到回调里之后，`executeAttack` 返回时伤害**可能尚未生效**，
   * 调用方不要在这之后立刻假设目标已死（一律通过 `checkBattleEnd` 收口），
   * 需要"打完再走下一步"的调用方请用 `onDone`，不要另外排时间。
   */
  private executeAttack(attacker: UnitController, target: UnitController, onDone?: () => void): void {
    // 冲锋等 preMove 技能会给施法者挂「本次攻击附带伤害」，在此消费（读取即移除）
    const bonus = this._consumeBonusDamage(attacker);

    const impact = (): void => {
      // 与原先的同步版本语义一致：只判定"目标是否还活着"（takeDamage 对尸体返回 0）
      if (target.data?.isAlive) {
        const damage = target.takeDamage((attacker.data?.stats.attack ?? 0) + bonus, false, attacker);
        this._totalDamageDealt += damage;
        this._reportDamage(target, damage);
        // 攻击后触发被动
        if (attacker.data && attacker.hasPassive('poison_arrows')) {
          target.addBuff('poison', 2, { damage: 1 });
        }
        if (!attacker.data?.isAlive || !target.data?.isAlive) {
          this.checkBattleEnd();
        }
      }
      // 收尾回调一定执行：目标已死也要让调用方把回合走完（否则会卡住）
      if (onDone) onDone();
    };

    attacker.playAttackAnim(target.data?.gridPos ?? null, impact);
  }

  onSkillUsed(skillIndex: number): void {
    if (this._actionLocked) return;
    // 技能选择中也能再点技能按钮 —— 这正是"切换技能"的入口。
    // 原先这里卡死 `!== 'player_turn'`，进了 skill_target 技能按钮就全成死键。
    if (this._phase !== 'player_turn' && this._phase !== 'skill_target') return;
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;
    // 点技能 = 玩家要行动了，撤销待执行的自动跳过
    this._cancelAutoSkip();
    const skill = unit.peekSkill(skillIndex);
    if (!skill) return;

    // 不可用就**说明原因**（能量不足 / 射程内无目标 / 本回合已行动…）而不是静默返回
    const reason = this.getSkillUnusableReason(unit, skillIndex);
    if (reason) {
      if (this._onSkillRejectedCallback) this._onSkillRejectedCallback(`${skill.name}：${reason}`);
      return;
    }

    // 已在选这个技能 → 再点一次 = 取消
    if (this._phase === 'skill_target' && this._pendingSkillIndex === skillIndex) {
      this._clearPendingSkill();
      return;
    }
    // 换技能：先干净退出（把高亮与返回子阶段都还原），再按新技能重新进入
    if (this._phase === 'skill_target') {
      this._clearPendingSkill();
    }

    if (skill.targetType === 'self') {
      // pre-move 技能不消耗行动次数（仅消耗能量），后续仍可攻击
      const usedSkill = unit.useSkill(skillIndex, !skill.preMove);
      if (!usedSkill) return;
      if (unit.data) {
        this.executeSkillEffects(unit, unit, unit.data.gridPos, usedSkill.effects);
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
      // 顺序要紧：`_skillReturnPhase` 必须在翻转 `_phase` **之前**取，
      // 否则取消时永远退到 `'action'`（从 `move` 进的技能就退错阶段了）
      this._skillReturnPhase = this._unitPhase;
      this._pendingSkill = skill;
      this._pendingSkillIndex = skillIndex;
      this._pendingSkill['_skillIndex'] = skillIndex;
      this._phase = 'skill_target';
      this._skillPreviewPos = null;
      this._skillTargets = this.getValidSkillTargets(unit, skill);
      const isAoe = skill.targetType === 'aoe';
      const highlightColor = isAoe ? GRID.SKILL_TARGET_AOE : GRID.SKILL_TARGET;
      this.gridController.highlightCells(this._skillTargets, highlightColor);
      if (this._onUnitPhaseChanged) {
        this._onUnitPhaseChanged('player_turn', unit, isAoe ? 'skill_target_aoe' : 'skill_target');
      }
    }
  }

  private getValidSkillTargets(unit: UnitController, skill: import('../config/GameData').SkillConfig): GridPosition[] {
    if (!unit.data) return [];
    const pos = unit.data.gridPos;
    const maxRange = skill.range ?? unit.data.stats.range;

    const inRange = (targetPos: GridPosition) => {
      const dist = Math.abs(targetPos.row - pos.row) + Math.abs(targetPos.col - pos.col);
      return dist <= maxRange;
    };

    if (skill.targetType === 'enemy') {
      return this._enemyUnits
        .filter(e => e.data?.isAlive && inRange(e.data.gridPos))
        .map(e => e.data!.gridPos);
    }
    if (skill.targetType === 'aoe') {
      // AOE技能可以选择射程内任意格子作为中心点
      const tiles: GridPosition[] = [];
      for (let r = 0; r < GridController.GRID_SIZE; r++) {
        for (let c = 0; c < GridController.GRID_SIZE; c++) {
          const dist = Math.abs(r - pos.row) + Math.abs(c - pos.col);
          if (dist <= maxRange) {
            tiles.push({ row: r, col: c });
          }
        }
      }
      return tiles;
    }
    if (skill.targetType === 'ally') {
      return this._playerUnits
        .filter(p => p.data?.isAlive && p.data.id !== unit.data.id && inRange(p.data.gridPos))
        .map(p => p.data!.gridPos);
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
          if (row < 0 || row >= GridController.GRID_SIZE || col < 0 || col >= GridController.GRID_SIZE) continue;
          if (this.isOccupied({ row, col })) continue;
          tiles.push({ row, col });
        }
      }
      return tiles;
    }
    return [];
  }

  endCurrentUnitTurn(): void {
    if (this._actionLocked) return;
    if (this._phase === 'skill_target') this._clearPendingSkill();
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;
    unit.data.hasActed = true;
    this._cancelAutoSkip();
    this.finishUnitTurn();
  }

  private endPlayerTurn(): void {
    if (this._actionLocked) return;
    // 先退出技能选择模式，否则下面的 `_phase !== 'player_turn'` 守卫会早退，
    // 留下「还在选技能」的脏相位挂到敌方回合上
    if (this._phase === 'skill_target') this._clearPendingSkill();
    if (this._phase !== 'player_turn') return;
    this._phase = 'enemy_turn';
    this._stoodStill = false;

    if (this._selectedUnit) {
      this._selectedUnit.setSelected(false);
      this._selectedUnit = null;
    }
    this.gridController.clearHighlights();

    if (this._onUnitPhaseChanged) {
      this._onUnitPhaseChanged('enemy_turn', null, null);
    }

    // Boss「集结」：在敌方回合开始时召唤增援（设计 §5.3）
    this._processSummons();

    const aliveEnemies = this._enemyUnits.filter(u => u.data?.isAlive);
    for (const enemy of aliveEnemies) {
      enemy.onTurnStart();
    }
    const actions = this._aiController.decideAll(this._enemyUnits, this._playerUnits);
    this._aiQueue = aliveEnemies.map((enemy) => ({
      enemy,
      action: actions[this._enemyUnits.indexOf(enemy)] ?? { moveTo: { ...enemy.data?.gridPos ?? { row: 0, col: 0 } }, attackTarget: null },
    }));

    this._processNextAIUnit();
  }

  private _processNextAIUnit(): void {
    if (this._phase !== 'enemy_turn') {
      this._aiQueue = [];
      return;
    }
    // 每一拍续期看门狗：链路正常时它永远到不了点
    this._aiWatchdogAt = this._clock + BattleManager.AI_WATCHDOG_GRACE;
    if (this._aiQueue.length === 0) {
      this.finishAITurn();
      return;
    }
    // 非递归排空已阵亡的敌人：原先是自递归 `this._processNextAIUnit()`，
    // 与"在自身回调里排期"同源隐患（队列里连着一串尸体就会一口气递归到底）
    let next = this._aiQueue.shift();
    while (next && !next.enemy.data?.isAlive) next = this._aiQueue.shift();
    if (!next) {
      this.finishAITurn();
      return;
    }
    const { enemy, action } = next;

    const moveTarget = action.moveTo ?? enemy.data.gridPos;
    let acted = false;
    // 移动补间结束后才出手（出手要落在"到位之后"，而不是和移动同时开始）；
    // 已经在目标格时 moveToPositionAnimated 会**同步**回调，不再白等一段空补间。
    enemy.moveToPositionAnimated(moveTarget, UnitController.MOVE_ANIM_DURATION, () => {
      // 补间途中可能已经分出胜负（结算会切到 victory/defeat），不要再把回合续下去
      if (this._phase !== 'enemy_turn') return;
      // 有可用技能就用技能（冷却在释放时开始计）；否则普通攻击
      if (this._tryEnemyAbility(enemy, action)) {
        acted = true;
      } else if (action.attackTarget?.data?.isAlive) {
        const dist = Math.abs(action.attackTarget.data.gridPos.row - enemy.data.gridPos.row) +
          Math.abs(action.attackTarget.data.gridPos.col - enemy.data.gridPos.col);
        if (dist <= enemy.data.stats.range) {
          this.executeAttack(enemy, action.attackTarget);
          acted = true;
        }
      }
      // 出手了要留够攻击演出的时间；只是走了两步就不必再等（原先固定 0.5s 是浪费）。
      // 只写"下一拍的时间点"，由 update() 泵驱动 —— 不再 scheduleOnce 自身，
      // 否则同步回调路径下会被引擎当成重复排期静默丢弃（见 _aiNextStepAt 注释）。
      this._aiNextStepAt = this._clock +
        (acted ? BattleManager.AI_STEP_AFTER_ACTION : BattleManager.AI_STEP_AFTER_MOVE);
    });
  }

  /**
   * 执行本回合的敌人技能；返回 true 表示这次行动已被技能消耗。
   * 目标可能因前面单位行动而死亡/走远 → 用**移动后的当前位置**重新校验射程，
   * 不满足就返回 false，退回普通攻击（不会白放一次技能）。
   */
  private _tryEnemyAbility(enemy: UnitController, action: AIAction): boolean {
    const id = action.abilityId;
    if (!id || !enemy.data?.isAlive) return false;
    const ability = getEnemyAbilityById(id);
    if (!ability) return false;

    const target = action.attackTarget ?? null;
    const targetPos = target?.data?.gridPos ?? null;
    const range = ability.range ?? enemy.data.stats.range;
    const inRange = !!target?.data?.isAlive && !!targetPos &&
      Math.abs(targetPos.row - enemy.data.gridPos.row) +
      Math.abs(targetPos.col - enemy.data.gridPos.col) <= range;
    // 自身技能（嘲讽）只需身边有人，不需要攻击目标
    if (ability.targetType !== 'self' && !inRange) return false;

    enemy.startAbilityCooldown(ability.id, ability.cooldown ?? 1);
    this.executeSkillEffects(enemy, target, targetPos, ability.effects);
    return true;
  }

  /**
   * Boss「集结」（设计 §5.3）：每 `interval` 回合召唤 1 个剑兵增援。
   * 在敌方回合开始时结算，召唤物当回合即可行动；存活敌人数上限 6，避免无限滚雪球。
   */
  private _processSummons(): void {
    const bosses = this._enemyUnits.filter(e => e.data?.isAlive && e.hasAbility('boss_summon'));
    if (bosses.length === 0) return;
    const cfg = getEnemyAbilityById('boss_summon');
    const interval = cfg?.effects.find(e => e.type === 'summon')?.params.interval ?? 2;
    if (interval <= 0 || this._turnCount % interval !== 0) return;

    for (const boss of bosses) {
      const aliveCount = this._enemyUnits.filter(e => e.data?.isAlive).length;
      if (aliveCount >= 6) break;
      const spot = this._findFreeCellNear(boss.data!.gridPos);
      if (!spot) continue;
      this.spawnEnemy(
        { ...ENEMIES[0], stats: this.scaleEnemyStats(ENEMIES[0].stats, this._difficulty) },
        spot
      );
    }
  }

  /** 在给定格周围沿曼哈顿环找最近的空格（召唤用） */
  private _findFreeCellNear(center: GridPosition): GridPosition | null {
    for (let radius = 1; radius < GridController.GRID_SIZE; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) + Math.abs(dc) !== radius) continue;
          const row = center.row + dr;
          const col = center.col + dc;
          if (row < 0 || row >= GridController.GRID_SIZE) continue;
          if (col < 0 || col >= GridController.GRID_SIZE) continue;
          if (this.isOccupied({ row, col })) continue;
          return { row, col };
        }
      }
    }
    return null;
  }

  private finishAITurn(): void {
    // 敌方回合结束：泵与看门狗一并停掉（phase 守卫也会拦住，但显式清零更好排查）
    this._aiNextStepAt = 0;
    this._aiWatchdogAt = 0;
    this.checkBattleEnd();
    if (this._phase === 'enemy_turn') {
      this._turnCount++;
      this._phase = 'player_turn';
      for (const unit of this._playerUnits) {
        if (unit.data?.isAlive) {
          unit.onTurnStart(this._playerUnits);
        }
      }
      // 回合开始毒伤可能导致全部玩家死亡，立即结算
      this.checkBattleEnd();
      if (this._phase !== 'player_turn') return;
      this._currentUnitIndex = 0;
      this.selectNextPlayerUnit();
    }
  }

  /**
   * 胜负判定。两个要点：
   * 1. **同步**把 `_phase` 切到 `victory/defeat`（不再接受输入，`finishAITurn`
   *    之类的"还在敌方回合吗"判断也立刻失效），但**延后** ~0.34s 才真正结算 ——
   *    让阵亡演出播完再弹结算面板，否则"最后一击"的反馈和面板一起挤在同一帧；
   * 2. 幂等（`_battleOver`）：这个函数被十几处调用，重复进入会重复排期结算
   *    （重复发金币、重复触发回调）。
   * 另外这里**不再强制隐藏**死亡单位 —— 隐藏现在由 `UnitController.playDeath()`
   * 在演出结束时自己做；同帧 `active = false` 会把阵亡演出整个切掉。
   */
  private checkBattleEnd(): void {
    if (this._battleOver) return;

    const allEnemiesDead = this._enemyUnits.every(u => !u.data?.isAlive);
    const allPlayersDead = this._playerUnits.every(u => !u.data?.isAlive);
    if (!allEnemiesDead && !allPlayersDead) return;

    this._battleOver = true;
    this._phase = allEnemiesDead ? 'victory' : 'defeat';
    const victory = allEnemiesDead;
    this.scheduleOnce(
      victory ? this._settleVictory : this._settleDefeat,
      UnitController.DEATH_ANIM_DURATION
    );
  }

  private _settleVictory(): void {
    this.onBattleEnd(true);
  }

  private _settleDefeat(): void {
    this.onBattleEnd(false);
  }

  private onBattleEnd(victory: boolean): void {
    this.unscheduleAllCallbacks();
    this._aiQueue = [];
    // 战斗在技能选择途中结束（最后一击）时，锁定状态不能留到结算画面
    this._pendingSkill = null;
    this._pendingSkillIndex = -1;
    this._skillReturnPhase = 'action';
    this._skillTargets = [];
    this._skillPreviewPos = null;
    // 泵不是 scheduler 条目、也不是补间 —— `unscheduleAllCallbacks()` 停不掉它，
    // 「清这两个数字」才是取消（比存一个 tween 句柄更彻底：句柄还可能被别的 bug 弄丢）
    this._aiNextStepAt = 0;
    this._aiWatchdogAt = 0;
    // 结算时解开输入锁：锁是在"行动收尾回调"里释放的，而结算可能把这个回调打断
    // （例如最后一击打死全部敌人 → `finishUnitTurn` 早退），不解开会把下一场也卡住
    this._actionLocked = false;
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

  /**
   * 敌方回合的拍点泵 + 看门狗。
   *
   * 这一层存在的唯一理由是**让回合推进不依赖"在正在执行的回调里再排期"**：
   * 旧实现用 `scheduleOnce(this._onAINextStep, …)`，而那一句恰好是在
   * `_onAINextStep` 自身（经同步补间回调）触发时执行的，引擎会把同
   * `(target, callback)` 的排期当成"已存在"而只更新间隔、随后又按一次性
   * 计时器取消掉 → 回合永久卡在 `enemy_turn`。把延迟降级成一个数字后，
   * 推进由每帧轮询完成，没有任何"同一性"可冲突，链路万一还是断了
   * （补间回调没来 / 抛异常），看门狗也会在 2s 内强制接管。
   */
  update(dt: number): void {
    this._clock += dt;
    // 成本守卫：整场战斗里绝大多数帧都走这一行就返回
    if (this._phase !== 'enemy_turn') return;

    if (this._aiNextStepAt > 0 && this._clock >= this._aiNextStepAt) {
      this._aiNextStepAt = 0;
      this._processNextAIUnit();
      return;
    }
    if (this._aiWatchdogAt > 0 && this._clock >= this._aiWatchdogAt) {
      console.warn('[BattleManager] 敌方回合看门狗触发，强制推进');
      this._aiNextStepAt = 0;
      this._aiWatchdogAt = 0;
      if (this._aiQueue.length === 0) {
        this.finishAITurn();
      } else {
        this._processNextAIUnit();
      }
    }
  }

  onDestroy(): void {
    this.unscheduleAllCallbacks();
    this._playerUnits = [];
    this._enemyUnits = [];
    this._selectedUnit = null;
    this._onBattleEndCallback = null;
    this._aiController = null;
    this._deployDragGuard = null;
    this._dropPreviewPos = null;
    // 只清 JS 引用/数字，不碰任何 @property(Node)（守则 2）
    this._aiQueue = [];
    this._aiNextStepAt = 0;
    this._aiWatchdogAt = 0;
  }
}
