/**
 * 数值冲刺 — 纯逻辑核心（不依赖 cc，可被 Node 直接编译回归）。
 *
 * 规则要点：
 *   - 单资源：`count` 同时是血量与火力（dps = min(count, 火力上限)，上限随距离/升级卡成长）
 *   - 世界按 `distance` 推进；玩家固定在屏幕 PLAYER_Y，物体按 (worldY - distance) 落屏
 *   - 遇到敌人即停下对拼：我方按 dps 扣敌人血，敌人按 (atk + count×比例) × (1−护甲) 扣我方人数
 *   - 数值门成对出现，玩家中心落在左/右半区即触发对应一侧；
 *     带附加效果的门（护甲/火力/集火冷却）挂在「立即数字更吃亏」的一侧，制造现在 vs 之后的取舍
 *   - 敌人分类型（步兵/盾兵/刺客/再生），每种考不同的东西
 *   - 对拼时敌人身上有金色弱点，队伍停在下方 = dps ×倍率 —— 复用横移输入，不新增手势
 *   - 第 3、6 对门之后弹三选一升级卡，期间世界冻结
 *   - 连续选到更优的一侧记「完美」，每 3 连击额外加一点人数
 *   - 点屏幕触发「集火」：短时 dps 翻倍，冷却 4.5 s —— 对拼阶段的爆发手段
 *   - Boss 分三个阶段（血量 66% / 33% 处切换），越残血越硬越疼
 *   - 打掉 Boss = victory；人数归零 = game_over
 *
 * 坐标系：原点在游戏区左上角，y 向下（与其它游戏一致）。
 */

import {
    PLAY_W,
    PLAYER_X_MIN,
    PLAYER_X_MAX,
    START_COUNT,
    COUNT_MAX,
    ENEMY_DRAIN_RATIO,
    BOSS_DRAIN_MULT,
    BOSS_HP,
    BOSS_DISTANCE,
    CONTACT_DIST,
    SUBSTEP_SEC,
    MAX_FRAME_DT,
    SQUAD_HIT_EVENT_SEC,
    SEGMENT_LEN,
    SEGMENT_COUNT,
    GATE_SPLIT_X,
    GATE_TEMPLATES,
    PULSE_DURATION_SEC,
    PULSE_COOLDOWN_SEC,
    PULSE_DPS_MULT,
    STREAK_BONUS_STEP,
    streakBonus,
    GateOp,
    GateOpKind,
    GateMod,
    GateSideDef,
    GateTemplate,
    EnemyKind,
    UpgradeDef,
    UpgradeId,
    UPGRADE_CHOICES,
    UPGRADE_POOL,
    UPGRADE_FIRE_CAP_BONUS,
    UPGRADE_PULSE_CD_MULT,
    UPGRADE_PULSE_CD_FLOOR,
    UPGRADE_AIM_BONUS,
    UPGRADE_ARMOR_BONUS,
    UPGRADE_ARMOR_CAP,
    UPGRADE_STREAK_MULT,
    UPGRADE_HEAL_RATIO,
    UPGRADE_HEAL_MIN,
    CHOICE_AFTER_GATE_INDEX,
    CHOICE_TRIGGER_OFFSET,
    AIM_DPS_MULT,
    AIM_TOLERANCE,
    WEAK_AMP_MAX,
    WEAK_SPEED,
    BOSS_WEAK_AMP,
    BOSS_WEAK_SPEED,
    BOSS_PHASE_DPS_MULT,
    BOSS_PHASE_ATK_MULT,
    bossPhaseOf,
    fireCapAt,
    clampCount,
    applyGateOp,
    ENEMY_KIND_POOLS,
    enemyHpAt,
    enemyAtkAt,
    enemyRegenAt,
    enemyProfile,
    enemyWidthAt,
    bossAtkAt,
    scrollSpeedAt,
    computeScore,
} from './GateConfig';

export type GateState = 'ready' | 'running' | 'game_over' | 'victory';

export type GateSideKey = 'left' | 'right';

export interface GateSide {
    op: GateOp;
    /** 选这一侧附带的「延迟收益」 */
    mod?: GateMod;
    /** 该侧是否已被触发（一对门只有一侧生效，另一侧同时作废） */
    used: boolean;
}

export interface GatePair {
    id: number;
    /** 门板中心的世界位置 */
    y: number;
    left: GateSide;
    right: GateSide;
}

export interface Enemy {
    id: number;
    /** 敌人的世界位置 */
    y: number;
    hp: number;
    maxHp: number;
    /** 每秒基础伤害（不含按人数比例的消耗） */
    atk: number;
    width: number;
    kind: EnemyKind;
    boss: boolean;
    alive: boolean;
    /** 是否已经接触过（用于只发一次 enemy_engaged） */
    engaged: boolean;
    /** 弱点当前所在 x（对拼中每子步更新） */
    weakX: number;
    /** Boss 阶段 1/2/3；普通敌人恒为 1 */
    phase: number;
}

/** 生效中的门附加效果 */
export interface ActiveMod {
    kind: 'armor' | 'power';
    value: number;
    fightsLeft: number;
}

export type GateEvent =
    | {
        type: 'gate_hit';
        side: GateSideKey;
        kind: GateOpKind;
        value: number;
        before: number;
        after: number;
        y: number;
        /** 这一侧的结果严格优于另一侧 */
        perfect: boolean;
        /** 当前连续完美次数 */
        streak: number;
        /** 连击奖励带来的人数增量（0 表示这次没有奖励） */
        bonus: number;
        /** 这一侧附带的延迟收益 */
        mod: GateMod | null;
    }
    | { type: 'pulse' }
    | { type: 'enemy_engaged'; id: number; hp: number; boss: boolean; kind: EnemyKind }
    | { type: 'enemy_destroyed'; id: number; y: number; boss: boolean }
    | { type: 'boss_phase'; phase: number }
    | { type: 'squad_hit'; amount: number; count: number }
    | { type: 'upgrade_chosen'; id: UpgradeId; name: string }
    | { type: 'victory'; score: number; count: number; distance: number }
    | { type: 'game_over'; count: number; distance: number };

// ==================== 工具 ====================

/** 确定性随机：同 seed 同序列，便于无头回归 */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function (): number {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 某个世界位置上的门，玩家从哪一侧通过 */
export function gateSideFor(playerX: number): GateSideKey {
    return playerX < GATE_SPLIT_X ? 'left' : 'right';
}

// ==================== 核心 ====================

export class GateCore {
    private _state: GateState = 'ready';
    private _seed = 1;
    private _rng: () => number = mulberry32(1);

    private _distance = 0;
    private _countF = START_COUNT;
    private _playerX = PLAY_W / 2;

    private _gates: GatePair[] = [];
    private _enemies: Enemy[] = [];

    private _events: GateEvent[] = [];
    private _acc = 0;
    private _nextId = 1;

    private _hitTimer = 0;
    private _pendingHit = 0;

    /** 集火剩余时长 / 剩余冷却 */
    private _pulseTimer = 0;
    private _pulseCd = 0;
    /** 连续完美选门次数 */
    private _streak = 0;

    /** 全局时间（弱点摆动用，与距离无关，对拼时也推进） */
    private _time = 0;

    /** 升级卡带来的永久成长 */
    private _fireCapBonus = 0;
    private _aimBonus = 0;
    private _armorBonus = 0;
    private _streakMult = 1;
    private _pulseCdMult = 1;

    /** 生效中的门附加效果（护甲 / 火力） */
    private _mods: ActiveMod[] = [];
    /** 当前这场对拼吃到的附加效果快照（进门时结算，打完清零） */
    private _fightArmor = 0;
    private _fightPower = 1;

    /** 升级卡三选一 */
    private _choiceOpen = false;
    private _choiceOptions: UpgradeDef[] = [];
    private _choiceTriggerIdx = 0;

    // ==================== 生命周期 ====================

    /** 开一局。seed 相同则门/敌人序列完全相同 */
    startRun(seed: number): void {
        this._seed = seed >>> 0;
        this._rng = mulberry32(this._seed);

        this._state = 'running';
        this._distance = 0;
        this._countF = START_COUNT;
        this._playerX = PLAY_W / 2;

        this._gates = [];
        this._enemies = [];
        this._events = [];
        this._acc = 0;
        this._nextId = 1;
        this._hitTimer = 0;
        this._pendingHit = 0;
        this._pulseTimer = 0;
        this._pulseCd = 0;
        this._streak = 0;

        this._time = 0;
        this._fireCapBonus = 0;
        this._aimBonus = 0;
        this._armorBonus = 0;
        this._streakMult = 1;
        this._pulseCdMult = 1;
        this._mods = [];
        this._fightArmor = 0;
        this._fightPower = 1;
        this._choiceOpen = false;
        this._choiceOptions = [];
        this._choiceTriggerIdx = 0;

        this._generate();
    }

    /** 重置成「还没开始」的干净状态 */
    reset(): void {
        this._state = 'ready';
        this._distance = 0;
        this._countF = START_COUNT;
        this._playerX = PLAY_W / 2;
        this._gates = [];
        this._enemies = [];
        this._events = [];
        this._acc = 0;
        this._hitTimer = 0;
        this._pendingHit = 0;
        this._pulseTimer = 0;
        this._pulseCd = 0;
        this._streak = 0;
        this._time = 0;
        this._fireCapBonus = 0;
        this._aimBonus = 0;
        this._armorBonus = 0;
        this._streakMult = 1;
        this._pulseCdMult = 1;
        this._mods = [];
        this._fightArmor = 0;
        this._fightPower = 1;
        this._choiceOpen = false;
        this._choiceOptions = [];
        this._choiceTriggerIdx = 0;
    }

    /** 横移：钳制在 [PLAYER_X_MIN, PLAYER_X_MAX] */
    setPlayerX(x: number): void {
        if (isNaN(x)) return;
        const v = x < PLAYER_X_MIN ? PLAYER_X_MIN : (x > PLAYER_X_MAX ? PLAYER_X_MAX : x);
        this._playerX = v;
    }

    /**
     * 集火：冷却好了就开，短时 dps ×PULSE_DPS_MULT。
     * 返回 false 表示没吃到（冷却中 / 不在对局中），调用方据此决定是否给反馈。
     */
    pulse(): boolean {
        if (this._state !== 'running') return false;
        if (this._choiceOpen) return false;
        if (this._pulseCd > 0) return false;
        this._pulseTimer = PULSE_DURATION_SEC;
        this._pulseCd = PULSE_COOLDOWN_SEC * this._pulseCdMult;
        this._events.push({ type: 'pulse' });
        return true;
    }

    /**
     * 从三选一里挑一张卡。
     * 返回 false 表示当前没有待选卡或下标非法。
     */
    choose(index: number): boolean {
        if (!this._choiceOpen) return false;
        const opt = this._choiceOptions[index];
        if (!opt) return false;
        this._applyUpgrade(opt.id);
        this._choiceOpen = false;
        this._choiceOptions = [];
        this._events.push({ type: 'upgrade_chosen', id: opt.id, name: opt.name });
        return true;
    }

    private _applyUpgrade(id: UpgradeId): void {
        switch (id) {
            case 'fire_cap':
                this._fireCapBonus += UPGRADE_FIRE_CAP_BONUS;
                break;
            case 'pulse_cd':
                this._pulseCdMult = Math.max(UPGRADE_PULSE_CD_FLOOR, this._pulseCdMult * UPGRADE_PULSE_CD_MULT);
                break;
            case 'aim':
                this._aimBonus += UPGRADE_AIM_BONUS;
                break;
            case 'armor':
                this._armorBonus = Math.min(UPGRADE_ARMOR_CAP, this._armorBonus + UPGRADE_ARMOR_BONUS);
                break;
            case 'streak':
                this._streakMult = Math.min(4, this._streakMult * UPGRADE_STREAK_MULT);
                break;
            case 'heal': {
                const heal = Math.max(UPGRADE_HEAL_MIN, Math.floor(this.count * UPGRADE_HEAL_RATIO));
                this._countF = clampCount(this._countF + heal);
                break;
            }
            default:
                break;
        }
    }

    /** 取走本帧产生的事件（取空即清空） */
    popEvents(): GateEvent[] {
        if (this._events.length === 0) return [];
        const out = this._events;
        this._events = [];
        return out;
    }

    // ==================== 推进 ====================

    step(dt: number): void {
        if (this._state !== 'running') return;
        if (this._choiceOpen) return;      // 三选一期间世界冻结
        if (!isFinite(dt) || dt <= 0) return;

        const frame = dt > MAX_FRAME_DT ? MAX_FRAME_DT : dt;
        if (this._pulseTimer > 0) this._pulseTimer = Math.max(0, this._pulseTimer - frame);
        if (this._pulseCd > 0) this._pulseCd = Math.max(0, this._pulseCd - frame);
        this._acc += frame;

        let guard = 0;
        while (this._acc >= SUBSTEP_SEC && guard < 64) {
            this._acc -= SUBSTEP_SEC;
            guard++;
            this._substep(SUBSTEP_SEC);
            if (this._state !== 'running' || this._choiceOpen) {
                this._acc = 0;
                break;
            }
        }
    }

    private _substep(dt: number): void {
        this._time += dt;
        const blocker = this._blockingEnemy();

        if (blocker) {
            this._fight(blocker, dt);
            if (this._state !== 'running') return;
        } else {
            this._distance += scrollSpeedAt(this._distance) * dt;
            if (this._distance > BOSS_DISTANCE + 400) this._distance = BOSS_DISTANCE + 400;
        }

        this._checkGates();
        if (this._state !== 'running') return;
        this._checkChoiceTrigger();
    }

    /** 前方最近的、已经接触到的活敌人 */
    private _blockingEnemy(): Enemy | null {
        for (let i = 0; i < this._enemies.length; i++) {
            const e = this._enemies[i];
            if (!e.alive) continue;
            if (e.y - this._distance <= CONTACT_DIST) return e;
        }
        return null;
    }

    private _fight(e: Enemy, dt: number): void {
        if (!e.engaged) this._beginFight(e);

        // 弱点：对拼中左右摆动，队伍停在它下方就能打出更高伤害
        this._updateWeakX(e);
        const aim = this._aimFactor(e);

        // 我方输出：dps 封顶（随距离与升级卡成长），集火 / 火力效果 / 弱点各自放大
        const dps = Math.min(this.count, this.fireCap)
            * this._fightPower
            * (this._pulseTimer > 0 ? PULSE_DPS_MULT : 1)
            * aim
            * (e.boss ? BOSS_PHASE_DPS_MULT[e.phase - 1] : 1);
        e.hp -= dps * dt;

        // 再生兵：被打的同时回血，惩罚「打得慢」
        const regen = enemyRegenAt(e.kind, e.maxHp);
        if (regen > 0 && e.hp > 0) e.hp = Math.min(e.maxHp, e.hp + regen * dt);

        if (e.hp <= 0) {
            e.hp = 0;
            e.alive = false;
            this._endFight();
            this._events.push({ type: 'enemy_destroyed', id: e.id, y: e.y, boss: e.boss });
            this._flushHit();
            if (e.boss) this._win();
            return;
        }

        // Boss 阶段：血量跨过阈值时切换（更硬的甲 / 更狠的伤害）
        if (e.boss) {
            const phase = bossPhaseOf(e.hp, e.maxHp);
            if (phase !== e.phase) {
                e.phase = phase;
                this._events.push({ type: 'boss_phase', phase });
            }
        }

        // 敌方输出：基础伤害 + 按当前人数比例的消耗，护甲统一减免
        const mult = e.boss ? BOSS_DRAIN_MULT : enemyProfile(e.kind).drainMult;
        const atk = e.boss ? bossAtkAt(e.y) * BOSS_PHASE_ATK_MULT[e.phase - 1] : e.atk;
        const reduction = this.armorReduction;
        const drain = (atk + this.count * ENEMY_DRAIN_RATIO * mult) * (1 - reduction);
        this._countF -= drain * dt;
        this._pendingHit += drain * dt;

        this._hitTimer += dt;
        if (this._hitTimer >= SQUAD_HIT_EVENT_SEC) {
            this._hitTimer = 0;
            this._flushHit();
        }

        if (this._countF <= 0) {
            this._countF = 0;
            this._flushHit();
            this._fail();
        }
    }

    /** 首次接触：发出事件，并结算「下一战生效」的门附加效果（每场消耗一次） */
    private _beginFight(e: Enemy): void {
        e.engaged = true;

        let armor = 0;
        let power = 1;
        for (let i = 0; i < this._mods.length; i++) {
            const m = this._mods[i];
            if (m.kind === 'armor') armor = Math.max(armor, m.value);
            else power = Math.max(power, 1 + m.value);
        }
        this._fightArmor = armor;
        this._fightPower = power;

        // 这场对拼消耗掉一层
        for (let i = this._mods.length - 1; i >= 0; i--) {
            this._mods[i].fightsLeft--;
            if (this._mods[i].fightsLeft <= 0) this._mods.splice(i, 1);
        }

        this._events.push({ type: 'enemy_engaged', id: e.id, hp: e.hp, boss: e.boss, kind: e.kind });
    }

    private _endFight(): void {
        this._fightArmor = 0;
        this._fightPower = 1;
    }

    private _updateWeakX(e: Enemy): void {
        const amp = e.boss
            ? BOSS_WEAK_AMP
            : Math.min(WEAK_AMP_MAX, Math.max(30, e.width / 2 - 30));
        const speed = e.boss ? BOSS_WEAK_SPEED : WEAK_SPEED;
        const raw = PLAY_W / 2 + Math.sin(this._time * speed + e.id * 1.7) * amp;
        e.weakX = Math.max(PLAYER_X_MIN, Math.min(PLAYER_X_MAX, raw));
    }

    private _aimFactor(e: Enemy): number {
        return Math.abs(this._playerX - e.weakX) <= AIM_TOLERANCE ? this.aimMult : 1;
    }

    private _addMod(mod: GateMod): void {
        if (mod.kind === 'cooldown') {
            this._pulseCd = Math.max(0, this._pulseCd - mod.value);
            return;
        }
        for (let i = 0; i < this._mods.length; i++) {
            const m = this._mods[i];
            if (m.kind !== mod.kind) continue;
            m.value = Math.max(m.value, mod.value);
            m.fightsLeft = Math.min(4, m.fightsLeft + mod.fights);
            return;
        }
        this._mods.push({ kind: mod.kind, value: mod.value, fightsLeft: mod.fights });
    }

    private _flushHit(): void {
        const amount = Math.floor(this._pendingHit);
        if (amount <= 0) return;
        this._pendingHit -= amount;
        this._events.push({ type: 'squad_hit', amount, count: this.count });
    }

    private _checkGates(): void {
        for (let i = 0; i < this._gates.length; i++) {
            const g = this._gates[i];
            if (g.left.used || g.right.used) continue;
            if (this._distance < g.y) continue;

            const side = gateSideFor(this._playerX);
            const entry = side === 'left' ? g.left : g.right;
            const other = side === 'left' ? g.right : g.left;
            const before = this.count;
            const after = applyGateOp(before, entry.op);

            // 完美选门：这一侧的结果严格优于另一侧。两侧同结果不算，避免白送连击
            const perfect = after > applyGateOp(before, other.op);
            this._streak = perfect ? this._streak + 1 : 0;

            let bonus = 0;
            // 门把自己的队伍清空时不给连击奖励，否则 −N 门会被奖励救回来，惩罚失效
            if (after > 0 && perfect && this._streak % STREAK_BONUS_STEP === 0) {
                bonus = streakBonus(after) * this._streakMult;
            }
            const finalCount = clampCount(after + bonus);

            g.left.used = true;
            g.right.used = true;
            this._countF = finalCount;

            // 附加效果在门生效时立即挂上（护甲/火力从下一场对拼开始算，冷却立即生效）
            if (entry.mod) this._addMod(entry.mod);

            this._events.push({
                type: 'gate_hit',
                side,
                kind: entry.op.kind,
                value: entry.op.value,
                before,
                after: finalCount,
                y: g.y,
                perfect,
                streak: this._streak,
                bonus,
                mod: entry.mod ? { ...entry.mod } : null,
            });

            if (finalCount <= 0) {
                this._fail();
                return;
            }
        }
    }

    /** 第 N 对门之后弹三选一；世界会冻结到玩家选完 */
    private _checkChoiceTrigger(): void {
        if (this._choiceOpen) return;
        while (this._choiceTriggerIdx < CHOICE_AFTER_GATE_INDEX.length) {
            const gate = this._gates[CHOICE_AFTER_GATE_INDEX[this._choiceTriggerIdx]];
            if (!gate) {
                this._choiceTriggerIdx++;
                continue;
            }
            if (this._distance < gate.y + CHOICE_TRIGGER_OFFSET) return;
            this._choiceTriggerIdx++;
            this._openChoice();
            return;
        }
    }

    private _openChoice(): void {
        const pool = UPGRADE_POOL.slice();
        const picked: UpgradeDef[] = [];
        for (let i = 0; i < UPGRADE_CHOICES && pool.length > 0; i++) {
            const index = Math.floor(this._rng() * pool.length);
            picked.push(pool.splice(index, 1)[0]);
        }
        this._choiceOptions = picked;
        this._choiceOpen = picked.length > 0;
    }

    private _win(): void {
        if (this._state !== 'running') return;
        this._state = 'victory';
        this._events.push({
            type: 'victory',
            score: computeScore(this._distance, this.count, true),
            count: this.count,
            distance: this._distance,
        });
    }

    private _fail(): void {
        if (this._state !== 'running') return;
        this._state = 'game_over';
        this._events.push({
            type: 'game_over',
            count: this.count,
            distance: this._distance,
        });
    }

    // ==================== 关卡生成 ====================

    private _generate(): void {
        let enemyIndex = 0;
        for (let i = 0; i < SEGMENT_COUNT; i++) {
            const base = i * SEGMENT_LEN;
            if (i % 2 === 0) {
                // 第一对门固定用「两侧都加人」的温和模板：教学要的是「选得更好」，
                // 不是「站着不动就掉一半」。
                const prefer = i === 0
                    ? (t: GateTemplate) => t.a.op.kind === 'add' && t.b.op.kind === 'add'
                    : undefined;
                this._gates.push(this._makeGatePair(base + 260, prefer));
            } else {
                const pool = ENEMY_KIND_POOLS[enemyIndex] || (['grunt'] as EnemyKind[]);
                const kind = pool[Math.floor(this._rng() * pool.length)];
                this._enemies.push(this._makeEnemy(base + 300, false, kind));
                enemyIndex++;
            }
        }
        this._enemies.push(this._makeEnemy(BOSS_DISTANCE, true, 'boss'));

        // 第一对门：把「更差的一侧」放在出生点方向。
        // 否则开局站着不动也能走对侧，玩家第一次学不到「我得选」。
        const first = this._gates[0];
        if (first) {
            const spawnSide = gateSideFor(this._playerX);
            const spawnVal = applyGateOp(START_COUNT, spawnSide === 'left' ? first.left.op : first.right.op);
            const otherVal = applyGateOp(START_COUNT, spawnSide === 'left' ? first.right.op : first.left.op);
            if (spawnVal >= otherVal) {
                const tmp = first.left;
                first.left = first.right;
                first.right = tmp;
            }
        }
    }

    private _makeGateSide(def: GateSideDef): GateSide {
        return {
            op: { kind: def.op.kind, value: def.op.value },
            mod: def.mod ? { ...def.mod } : undefined,
            used: false,
        };
    }

    private _makeGatePair(y: number, prefer?: (t: GateTemplate) => boolean): GatePair {
        let list = GATE_TEMPLATES.filter((t) => t.from <= y);
        if (list.length === 0) list = GATE_TEMPLATES;
        if (prefer) {
            const preferred = list.filter(prefer);
            if (preferred.length > 0) list = preferred;
        }
        const tpl = list[Math.floor(this._rng() * list.length)];
        const swap = this._rng() < 0.5;

        const a = swap ? tpl.b : tpl.a;
        const b = swap ? tpl.a : tpl.b;

        return {
            id: this._nextId++,
            y,
            left: this._makeGateSide(a),
            right: this._makeGateSide(b),
        };
    }

    private _makeEnemy(y: number, boss: boolean, kind: EnemyKind): Enemy {
        const maxHp = boss ? BOSS_HP : enemyHpAt(y, kind);
        return {
            id: this._nextId++,
            y,
            hp: maxHp,
            maxHp,
            atk: boss ? bossAtkAt(y) : enemyAtkAt(y, kind),
            width: boss ? 460 : enemyWidthAt(y, kind),
            kind,
            boss,
            alive: true,
            engaged: false,
            weakX: PLAY_W / 2,
            phase: 1,
        };
    }

    // ==================== 只读状态 ====================

    get state(): GateState { return this._state; }
    get seed(): number { return this._seed; }
    get distance(): number { return this._distance; }
    /** 显示用整数人数（内部按浮点结算，避免每子步取整导致伤害丢失） */
    get count(): number { return clampCount(this._countF); }
    /** 未取整的人数，供血条/调试用 */
    get countExact(): number { return this._countF; }
    get playerX(): number { return this._playerX; }
    /** 集火是否正在生效 */
    get pulseActive(): boolean { return this._pulseTimer > 0; }
    /** 集火能不能点（对局中且冷却已好） */
    get pulseReady(): boolean { return this._state === 'running' && this._pulseCd <= 0; }
    /** 集火剩余冷却（秒），0 = 已就绪 */
    get pulseCooldown(): number { return this._pulseCd; }
    /** 集火剩余生效时长（秒） */
    get pulseRemaining(): number { return this._pulseTimer; }
    /** 当前连续完美选门次数 */
    get streak(): number { return this._streak; }
    /** 当前火力上限（随距离与升级卡成长） */
    get fireCap(): number { return fireCapAt(this._distance, this._fireCapBonus); }
    /** 弱点击破的 dps 倍率（含升级卡加成） */
    get aimMult(): number { return AIM_DPS_MULT + this._aimBonus; }
    /** 当前是否正打在弱点上（UI 提示用） */
    get aiming(): boolean {
        const blocker = this._blockingEnemy();
        if (!blocker) return false;
        return Math.abs(this._playerX - blocker.weakX) <= AIM_TOLERANCE;
    }
    /** 总受伤减免比例（永久护甲 + 本场附加护甲），上限 0.6 */
    get armorReduction(): number {
        return Math.min(0.6, this._armorBonus + this._fightArmor);
    }
    /** 生效中的门附加效果（只读） */
    get activeMods(): ReadonlyArray<ActiveMod> { return this._mods; }
    /** 是否正在三选一 */
    get choiceOpen(): boolean { return this._choiceOpen; }
    /** 当前三选一的卡（无待选时为空数组） */
    get choiceOptions(): ReadonlyArray<UpgradeDef> { return this._choiceOptions; }
    /** 连击奖励倍率 */
    get streakMultiplier(): number { return this._streakMult; }
    /** 集火冷却倍率（升级卡叠乘） */
    get pulseCooldownMultiplier(): number { return this._pulseCdMult; }
    get gates(): ReadonlyArray<GatePair> { return this._gates; }
    get enemies(): ReadonlyArray<Enemy> { return this._enemies; }
    get boss(): Enemy | null {
        for (let i = 0; i < this._enemies.length; i++) {
            if (this._enemies[i].boss) return this._enemies[i];
        }
        return null;
    }
    get score(): number {
        return computeScore(this._distance, this.count, this._state === 'victory');
    }
    /** 队伍数字上限（供 UI 判断是否需要缩写） */
    get countCap(): number { return COUNT_MAX; }
}
