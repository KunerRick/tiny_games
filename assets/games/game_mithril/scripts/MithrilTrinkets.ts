/**
 * 《秘银远征》饰品效果引擎（纯逻辑，**不得 import cc**）。
 *
 * 设计 §7.1：饰品**不提供任何无条件数值**，只改写规则。所以这里没有一条
 * 「攻击强度 +X%」的常驻乘数，全部效果都挂在战斗事件上（命中 / 暴击 / 闪避 /
 * 受伤 / 击杀 / 拾取 / 施法 / 每秒）。
 *
 * 结构（M7.1）：
 *  - `TrinketHost`：Core 实现的最小宿主动作（治疗 / 护盾 / 伤害 / 掉落 / 冷却…）。
 *    所有效果只经过宿主动作，饰品之间不会互相踩状态，自检也能用假宿主断言。
 *  - `FIRE`：`Record<饰品 id, TrinketHooks>`，一件饰品一个条目、一条规则。
 *  - `SYNERGY_FIRE`：12 条协同的点亮效果，钩子点与饰品相同。
 *  - `TrinketFx`：运行时聚合器。持有触发计数 / 时间窗 / 待结算伤害队列。
 *
 * 伤害类效果**一律排队**（`queueEnemy` / `queueAoe`），由 Core 在一步结束时
 * 用 `flush()` 统一结算：否则「命中 → 落雷 → 击杀 → 爆炸」会在 `_damageEnemy`
 * 的循环里递归 splice 敌人数组，把伤害打到错位的目标上。
 */

import {
    SYNERGIES,
    TRINKETS,
    TRINKET_BY_ID,
    findSynergies,
} from './MithrilConfig';
import type { SynergyDef, TrinketDef, TrinketTag } from './MithrilConfig';

// ==================== 宿主接口（Core 实现） ====================

/** 冷却字段名（与 `PlayerCooldowns` 同形，避免 import Core 造成循环依赖） */
export type TrinketSlotKey = 'basic' | 'charge' | 'whirlwind' | 'armorBreak' | 'dodge' | 'burst';

/** 饰品视角的敌人（`EnemyState` 结构兼容，不需要 import） */
export interface TrinketEnemy {
    id: number;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    isElite: boolean;
    isBoss: boolean;
    radius: number;
    /** 朝向（弧度）：用于「背刺」判定，敌人移动时由 Core 更新 */
    facing: number;
    status: {
        stun: number;
        burnDps: number;
        burnRemaining: number;
    };
}

/** 饰品视角的玩家（只读字段；改状态一律走宿主动作） */
export interface TrinketPlayer {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    shield: number;
    /** 隐身（暗影披风）；渲染层按它压 alpha */
    hidden: boolean;
}

export interface TrinketHost {
    readonly time: number;
    readonly rng: () => number;
    readonly enemies: TrinketEnemy[];
    readonly player: TrinketPlayer;
    /** 当前攻击强度（落雷 / 爆炸的数值基准） */
    attackPower(): number;
    healPlayer(amount: number): number;
    /** 加护盾，并把护盾总量夹在 `capPct × 最大生命` 以内 */
    addShield(amount: number, capPct: number): void;
    addOrb(x: number, y: number, amount: number): void;
    /** 饰品额外金币（守财协同） */
    addGold(amount: number): void;
    resetCooldown(slot: TrinketSlotKey): void;
    grantHaste(amount: number, duration: number): void;
}

// ==================== 钩子表 ====================

export interface TrinketHooks {
    /** 面板 / 静态：每帧读取的乘数以外的常驻规则（本工程暂无无条件数值，保留钩子） */
    onEquip?(fx: TrinketFx): void;
    /** 命中（普攻 / 技能；不含 DoT 与反弹） */
    onHit?(fx: TrinketFx, enemy: TrinketEnemy, crit: boolean, source: 'basic' | 'skill'): void;
    /** 受伤（`taken` 为护盾吸收前的伤害） */
    onDamaged?(fx: TrinketFx, attacker: TrinketEnemy | null, taken: number, melee: boolean): void;
    /** 闪避成功（dodge 键） */
    onDodge?(fx: TrinketFx): void;
    /** 技能成功施放（槽位 `SlotKey`；`free` 表示这次被回响 / 影回免了资源） */
    onCast?(fx: TrinketFx, slot: TrinketSlotKey, free: boolean): void;
    /** 敌人死亡（`enemy` 已从数组移除，字段仍可读） */
    onKill?(fx: TrinketFx, enemy: TrinketEnemy): void;
    /** 拾取血球 */
    onOrbPicked?(fx: TrinketFx, amount: number): void;
    /** 每秒推进（静止 / 低血 / 计时器类效果） */
    onSecond?(fx: TrinketFx, dt: number): void;
    /** 每个节点（副本 / 野外战斗）开始 */
    onNodeStart?(fx: TrinketFx): void;
}

/** 20 件饰品：一件只改一条规则（设计 §7.2） */
export const FIRE: Record<string, TrinketHooks> = {
    // ---- 血 ----
    blood_amulet: {
        // 生命低于 30% 时技能冷却 -40%（在 Core 设冷却时读取）
        onSecond(fx) {
            if (fx.hpPct() < 0.3 && !fx.wasLow) {
                fx.proc('blood_amulet', '嗜血护符 · 冷却加速');
            }
            fx.wasLow = fx.hpPct() < 0.3;
        },
    },
    blood_ring: {
        onHit(fx, enemy, crit) {
            // 规则本身在 currentDamageMul 里读取；这里只做「低血首次触发」的提示
            if (fx.missingPct() >= 0.3 && !fx.bloodRingHinted) {
                fx.bloodRingHinted = true;
                fx.proc('blood_ring', '血契指环 · 伤害提升');
            }
        },
    },

    // ---- 影 ----
    silent_bell: {
        onDodge(fx) {
            fx.forcedSkillCritUntil = fx.time + 1;
            fx.proc('silent_bell', '静默之铃 · 下一技能必暴');
        },
    },
    shadow_cloak: {
        onSecond(fx, dt) {
            // 静止 2 秒进入隐身；移动即脱离（规则细节见 tick 的位移检测）
            if (!fx.stealthReady) return;
            fx.stealthReady = false;
            fx.setHidden(true);
            fx.proc('shadow_cloak', '暗影披风 · 隐身');
        },
    },

    // ---- 回响 ----
    echo_stone: {
        onCast(fx, slot, free) {
            if (free) fx.proc('echo_stone', '回响石 · 免耗施放');
        },
    },
    resonance_crystal: {
        onHit(fx, enemy, crit, source) {
            if (!crit || source !== 'skill') return;
            const slot = fx.recentCastSlot(2);
            if (!slot) return;
            if (fx.rng() >= 0.5) return;
            fx.host.resetCooldown(slot);
            fx.proc('resonance_crystal', '共鸣水晶 · 冷却重置');
            fx.lastResetAt = fx.time;
        },
    },

    // ---- 荆棘 ----
    thorn_crown: {
        onDamaged(fx, attacker, taken, melee) {
            if (!melee || !attacker || taken <= 0) return;
            const reflect = taken * 0.2;
            fx.queueEnemy(attacker.id, reflect);
            fx.proc('thorn_crown', '荆棘之冠 · 反弹');
            fx.reflectTotal += reflect;
        },
    },
    thorn_plate: {
        onDamaged(fx, attacker, taken, melee) {
            // 任何来源的伤害都向周围 80px 溅射 15%，0.5 秒最多一次
            if (taken <= 0 || fx.time < fx.thornPlateCd) return;
            fx.thornPlateCd = fx.time + 0.5;
            const dealt = taken * 0.15;
            fx.queueAoe(fx.player.x, fx.player.y, 80, dealt);
            fx.proc('thorn_plate', '反伤甲片 · 溅射');
            fx.reflectTotal += dealt;
        },
    },

    // ---- 贪婪（掉落侧在 M7.4 接入；这里只有战斗内可观察部分） ----
    greed_eye: {},
    scavenger_pack: {},

    // ---- 烬火 ----
    ember_ring: {
        onHit() {
            // 叠加规则在 applyBurn 里：这里不需要额外动作
        },
    },
    ember_stone: {
        onKill(fx, enemy) {
            if (enemy.status.burnRemaining <= 0) return;
            if (fx.time < fx.emberStoneCd) return;
            fx.emberStoneCd = fx.time + 0.5;
            fx.queueAoe(enemy.x, enemy.y, 60, fx.ap() * 0.9);
            fx.proc('ember_stone', '烬火石 · 爆炸');
        },
    },

    // ---- 霜 ----
    frost_pendant: {
        // 伤害乘数在 damageMulVs 里（被冻结 / 眩晕目标 +25%）
    },
    frost_heart: {
        // 半径乘数在 frostRadiusMul 里
    },

    // ---- 雷 ----
    storm_totem: {
        onHit(fx) {
            fx.hitCount++;
            if (fx.hitCount % 5 !== 0) return;
            if (fx.time < fx.stormCd) return;
            fx.stormCd = fx.time + 2;
            fx.dropLightning();
        },
    },
    charge_bracer: {
        onHit(fx, enemy, crit) {
            if (!crit) return;
            fx.host.grantHaste(0.5, 1);
            fx.proc('charge_bracer', '电荷护腕 · 攻速提升');
        },
    },

    // ---- 誓约 ----
    oath_sigil: {
        onNodeStart(fx) {
            fx.oathUsed = false;
        },
    },
    oath_chain: {
        // 溢出转盾在 onHealOverflow 里
    },

    // ---- 饥饿 ----
    hungry_stomach: {
        // 拾取半径 / 治疗系数在 orbPickupMul / orbHealMul 里
    },
    scavenger_pendant: {
        onKill(fx, enemy) {
            if (!enemy.isElite) return;
            const heal = fx.host.healPlayer(fx.player.maxHp * 0.1);
            if (heal > 0) fx.proc('scavenger_pendant', '食腐者吊坠 · 精英回血');
        },
    },
};

/** 12 条协同：只在配对点亮时调用（判定见 `findSynergies`） */
export const SYNERGY_FIRE: Record<string, TrinketHooks> = {
    bloodfire: {
        onSecond(fx) {
            fx.burnSynergyOn = fx.hpPct() < 0.3;
        },
    },
    shadowecho: {
        onDodge(fx) {
            fx.freeSkillUntil = fx.time + 1;
            fx.proc('synergy:shadowecho', '协同 · 影回');
        },
    },
    thrift: {
        onDamaged(fx, attacker, taken, melee) {
            if (!melee || taken <= 0) return;
            // 与荆棘之冠共用同一笔反弹基数：反弹伤害的 20% 转金币
            fx.goldBuffer += taken * 0.2 * 0.2;
            if (fx.goldBuffer >= 1) {
                const gold = Math.floor(fx.goldBuffer);
                fx.goldBuffer -= gold;
                fx.host.addGold(gold);
                fx.proc('synergy:thrift', '协同 · 守财');
            }
        },
    },
    icestorm: {
        // 在 dropLightning 内：冻结目标被雷击时向 60px 传导
    },
    oathblood: {
        // 伤害乘数在 currentDamageMul：有护盾时 +15%
    },
    feast: {
        // onExtraLoot
    },
    firestorm: {
        // 在 dropLightning 内：燃烧目标被雷击时点燃周围
    },
    shadowthorn: {
        onDodge(fx) {
            fx.backstabUntil = fx.time + 1.2;
        },
    },
    oathreturn: {
        // 冷却重置时给 3% 护盾（由 Core 在 onHit 的共鸣水晶路径后调用）
    },
    coldmeal: {
        onKill(fx, enemy) {
            if (enemy.status.stun <= 0) return;
            fx.host.addOrb(enemy.x, enemy.y, fx.player.maxHp * 0.06);
            fx.proc('synergy:coldmeal', '协同 · 寒食');
        },
    },
    thunderclap: {
        // 在 dropLightning 内：每 3 次雷击一次全屏
    },
    bloodfeast: {
        // 拾取半径乘数在 orbPickupMul
    },
};

// ==================== 工具 ====================

/** 已装备饰品 id（去重、只保留配置里存在的） */
export function equippedTrinketIds(trinkets: Array<string | null> | null | undefined): string[] {
    if (!Array.isArray(trinkets)) return [];
    const seen: Record<string, true> = {};
    const out: string[] = [];
    for (const id of trinkets) {
        if (typeof id !== 'string' || !TRINKET_BY_ID[id] || seen[id]) continue;
        seen[id] = true;
        out.push(id);
    }
    return out;
}

/** 已装备饰品的 tag（稳定顺序，供 UI 与协同判定） */
export function equippedTags(trinkets: Array<string | null> | null | undefined): TrinketTag[] {
    const out: TrinketTag[] = [];
    for (const id of equippedTrinketIds(trinkets)) {
        const def = TRINKET_BY_ID[id];
        if (def) out.push(def.tag);
    }
    return out;
}

/** 点亮的协同（按 id 稳定排序，UI 与自检共用） */
export function litSynergies(trinkets: Array<string | null> | null | undefined): SynergyDef[] {
    const list = findSynergies(equippedTags(trinkets));
    return list.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 全部饰品定义（给面板按 tag 分组用） */
export function trinketList(): TrinketDef[] {
    return TRINKETS.slice();
}

// ---- 掉落期可用的纯查询（结算 / 宝箱发生在战斗之外，没有 TrinketFx 实例） ----

/** 贪婪之眼：每个节点额外掉落几件 */
export function extraDropCountOf(trinkets: Array<string | null> | null | undefined): number {
    return equippedTrinketIds(trinkets).indexOf('greed_eye') >= 0 ? 1 : 0;
}

/** 贪婪之眼：每件掉落被降一档品质的概率 */
export function lowerQualityChanceOf(trinkets: Array<string | null> | null | undefined): number {
    return equippedTrinketIds(trinkets).indexOf('greed_eye') >= 0 ? 0.25 : 0;
}

/** 拾荒者背包：宝箱多一个「额外搜刮」选项 */
export function chestExtraOptionOf(trinkets: Array<string | null> | null | undefined): boolean {
    return equippedTrinketIds(trinkets).indexOf('scavenger_pack') >= 0;
}

/** 拾荒者背包：额外搜刮的生命代价（最大生命的比例） */
export function chestHpCostOf(trinkets: Array<string | null> | null | undefined): number {
    return equippedTrinketIds(trinkets).indexOf('scavenger_pack') >= 0 ? 0.05 : 0;
}

/** 饕餮协同：每件额外掉落回复多少生命（0 = 没点亮） */
export function feastHealOnExtraLoot(trinkets: Array<string | null> | null | undefined, maxHp: number): number {
    const lit = litSynergies(trinkets).some((s) => s.id === 'feast');
    return lit ? Math.max(0, maxHp) * 0.03 : 0;
}

// ==================== 运行时聚合器 ====================

/** 排队待结算的饰品伤害（Core 在一步末尾统一 flush） */
export interface PendingFx {
    /** 指定敌人（按 id，避免数组下标在结算期间失效） */
    targetId?: number;
    x: number;
    y: number;
    radius: number;
    amount: number;
}

const EMPTY_HOOKS: TrinketHooks = {};

/**
 * 待播放的饰品特效。纯逻辑层只记「哪儿、多大」，由 Core 转成 CoreEvent、
 * 渲染层负责画 —— 这样 `MithrilTrinkets` 仍然不 import cc。
 */
export interface TrinketVisual {
    kind: 'lightning' | 'blast';
    x: number;
    y: number;
    radius: number;
}

/** 特效半径上限：雷音是全屏判定（4000），画成圆环要夹住，否则整屏被糊住 */
const VISUAL_RADIUS_MAX = 420;

export class TrinketFx {
    readonly host: TrinketHost;
    readonly ids: string[];
    readonly tags: TrinketTag[];
    readonly synergies: SynergyDef[];
    private readonly _synergyIds: Record<string, true> = {};

    // ---- 通用计时 / 计数 ----
    hitCount = 0;
    wasLow = false;
    bloodRingHinted = false;
    stealthReady = false;
    private _stillTime = 0;
    private _lastX = NaN;
    private _lastY = NaN;
    private _hidden = false;
    ambushUntil = -1;
    /** 隐身重新就绪的时间点：伏击后必须重新积蓄静止，避免「站桩每击都 +80%」 */
    private _stealthCdUntil = -1;

    // ---- 各规则的时间窗 ----
    forcedSkillCritUntil = -1;
    freeSkillUntil = -1;
    backstabUntil = -1;
    stormCd = -1;
    emberStoneCd = -1;
    thornPlateCd = -1;
    lastResetAt = -99;
    reflectTotal = 0;
    goldBuffer = 0;
    burnSynergyOn = false;

    // ---- 施法计数（回响石 / 共鸣水晶） ----
    private _casts: Record<string, number> = {};
    private _lastSlot: TrinketSlotKey | null = null;
    private _lastSlotAt = -99;

    // ---- 待结算伤害 ----
    private _pending: PendingFx[] = [];
    // ---- 待播放特效（Core 在一步末尾转成 CoreEvent，纯逻辑层不 import cc） ----
    private _visuals: TrinketVisual[] = [];
    // ---- proc 提示 ----
    private _procs: Array<{ id: string; label: string; t: number }> = [];

    // ---- 节点内状态 ----
    oathUsed = false;
    private _lightningCount = 0;

    constructor(trinkets: Array<string | null> | null | undefined, host: TrinketHost) {
        this.host = host;
        this.ids = equippedTrinketIds(trinkets);
        this.tags = equippedTags(trinkets);
        this.synergies = litSynergies(trinkets);
        for (const s of this.synergies) this._synergyIds[s.id] = true;
        for (const id of this.ids) {
            const hooks = FIRE[id];
            if (hooks && hooks.onEquip) hooks.onEquip(this);
        }
    }

    // ---------- 查询 ----------

    get time(): number {
        return this.host.time;
    }

    get player(): TrinketPlayer {
        return this.host.player;
    }

    get rng(): () => number {
        return this.host.rng;
    }

    get empty(): boolean {
        return this.ids.length === 0;
    }

    has(id: string): boolean {
        return this.ids.indexOf(id) >= 0;
    }

    hasSynergy(id: string): boolean {
        return !!this._synergyIds[id];
    }

    ap(): number {
        return Math.max(1, this.host.attackPower());
    }

    hpPct(): number {
        const p = this.player;
        return p.maxHp > 0 ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 0;
    }

    missingPct(): number {
        return 1 - this.hpPct();
    }

    /** 最近 2 秒内施放的技能槽（共鸣水晶用） */
    recentCastSlot(window: number): TrinketSlotKey | null {
        if (!this._lastSlot || this.time - this._lastSlotAt > window) return null;
        return this._lastSlot;
    }

    // ---------- 受控动作（所有效果只经过这些出口） ----------

    proc(id: string, label: string): void {
        this._procs.push({ id, label, t: this.time });
        if (this._procs.length > 8) this._procs.shift();
    }

    /** 最近 1.5 秒的 proc id（快照 / HUD 读它） */
    procIds(): string[] {
        const out: string[] = [];
        for (const p of this._procs) {
            if (this.time - p.t <= 1.5) out.push(p.id);
        }
        return out;
    }

    /** 最近 1.5 秒的 proc 文案（HUD 直接显示） */
    procLabels(): string[] {
        const out: string[] = [];
        for (const p of this._procs) {
            if (this.time - p.t <= 1.5) out.push(p.label);
        }
        return out;
    }

    queueEnemy(targetId: number, amount: number): void {
        if (!(amount > 0)) return;
        this._pending.push({ targetId, x: 0, y: 0, radius: 0, amount });
    }

    queueAoe(x: number, y: number, radius: number, amount: number): void {
        if (!(amount > 0) || !(radius > 0)) return;
        this._pending.push({ x, y, radius, amount });
        // 爆炸类效果统一给一个扩散圆环（雷音 4000 的全屏判定夹到 VISUAL_RADIUS_MAX）
        this._visual('blast', x, y, Math.min(radius, VISUAL_RADIUS_MAX));
    }

    private _visual(kind: 'lightning' | 'blast', x: number, y: number, radius: number): void {
        if (this._visuals.length >= 24) return;
        this._visuals.push({ kind, x, y, radius });
    }

    /** 由 Core 取走本步产生的特效（取完即清空） */
    drainVisuals(): TrinketVisual[] {
        if (this._visuals.length === 0) return [];
        const out = this._visuals;
        this._visuals = [];
        return out;
    }

    /** 落雷：主目标 + 协同传导 / 点燃 / 全屏 */
    dropLightning(): void {
        const ap = this.ap();
        const amount = Math.max(10, ap * 1.1);
        const target = this._nearestToPlayer();
        if (!target) return;
        this.queueEnemy(target.id, amount);
        this._visual('lightning', target.x, target.y, 0);
        this.proc('storm_totem', '雷暴图腾 · 落雷');
        this._lightningCount++;

        // 冰雷：冻结（stun 通道）目标被雷击 → 向 60px 传导 60%
        if (this.hasSynergy('icestorm') && target.status.stun > 0) {
            this.queueAoe(target.x, target.y, 60, amount * 0.6);
            this.proc('synergy:icestorm', '协同 · 冰雷');
        }
        // 雷火：燃烧目标被雷击 → 周围 60px 点燃
        if (this.hasSynergy('firestorm') && target.status.burnRemaining > 0) {
            for (const e of this.host.enemies) {
                if (e.id === target.id) continue;
                const d = Math.hypot(e.x - target.x, e.y - target.y);
                if (d <= 60 + e.radius) {
                    e.status.burnDps = Math.max(e.status.burnDps, amount * 0.25);
                    e.status.burnRemaining = Math.max(e.status.burnRemaining, 2);
                }
            }
            this.proc('synergy:firestorm', '协同 · 雷火');
        }
        // 雷音：每 3 次雷击一次全屏 50% 伤害
        if (this.hasSynergy('thunderclap') && this._lightningCount % 3 === 0) {
            this.queueAoe(this.player.x, this.player.y, 4000, amount * 0.5);
            this.proc('synergy:thunderclap', '协同 · 雷音');
        }
    }

    private _nearestToPlayer(): TrinketEnemy | null {
        let best: TrinketEnemy | null = null;
        let bestD = Infinity;
        for (const e of this.host.enemies) {
            const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    setHidden(value: boolean): void {
        this._hidden = value;
        this.player.hidden = value;
        if (!value) {
            this.stealthReady = false;
            this.ambushUntil = -1;
        }
    }

    get hidden(): boolean {
        return this._hidden;
    }

    // ---------- 每帧 / 每节点 ----------

    /** 每步调用：位移检测（隐身）、时间类触发 */
    tick(_dt: number): void {
        const p = this.player;
        if (!Number.isFinite(this._lastX)) {
            this._lastX = p.x;
            this._lastY = p.y;
        }
        const moved = Math.hypot(p.x - this._lastX, p.y - this._lastY) > 0.55;
        this._lastX = p.x;
        this._lastY = p.y;
        if (moved) {
            this._stillTime = 0;
            if (this._hidden) this.setHidden(false);
        } else {
            this._stillTime += _dt;
        }
        if (this.has('shadow_cloak') && !this._hidden && this._stillTime >= 2
            && this.time >= this._stealthCdUntil) {
            this.stealthReady = true;
        }
        if (this.empty) return;
        this._runHooks('onSecond', _dt);
    }

    resetNode(): void {
        this.stealthReady = false;
        this.setHidden(false);
        this._stillTime = 0;
        this._stealthCdUntil = -1;
        this.forcedSkillCritUntil = -1;
        this.freeSkillUntil = -1;
        this.backstabUntil = -1;
        this.ambushUntil = -1;
        this._pending.length = 0;
        this._visuals.length = 0;
        this._lightningCount = 0;
        for (const id of this._hookIds()) {
            const hooks = this._hooksOf(id);
            if (hooks.onNodeStart) hooks.onNodeStart(this);
        }
    }

    /** 由 Core 在结算一步的末尾调用；伤害类效果在这里统一落地 */
    flush(apply: (fx: PendingFx) => void): void {
        let guard = 0;
        while (this._pending.length > 0 && guard++ < 8) {
            const batch = this._pending;
            this._pending = [];
            for (const fx of batch) apply(fx);
        }
        if (this._pending.length > 0) this._pending.length = 0;
    }

    // ---------- 读取型规则 ----------

    /** 技能冷却乘数（嗜血护符：低血 ×0.6） */
    skillCooldownMul(): number {
        if (this.has('blood_amulet') && this.hpPct() < 0.3) return 0.6;
        return 1;
    }

    /** 伤害乘数（血契 / 誓血 / 隐身伏击 / 影刺窗口） */
    currentDamageMul(): number {
        let mul = 1;
        if (this.has('blood_ring')) {
            const layers = Math.floor(this.missingPct() * 10 + 1e-6);
            mul *= 1 + Math.min(0.3, 0.06 * Math.max(0, layers));
        }
        if (this.hasSynergy('oathblood') && this.player.shield > 0) mul *= 1.15;
        if (this._hidden) {
            // 首次攻击 +80%：解除隐身，并给一小段窗口让同一次攻击的每一段都吃到
            this.setHidden(false);
            this.ambushUntil = this.time + 0.08;
            // 伏击后必须重新站定 2 秒且过 6 秒冷却，才可能再次隐身（防止站桩无限伏击）
            this._stillTime = 0;
            this._stealthCdUntil = this.time + 6;
            this.proc('shadow_cloak', '暗影披风 · 伏击');
        }
        if (this.time <= this.ambushUntil) mul *= 1.8;
        if (this.hasSynergy('shadowthorn') && this.time <= this.backstabUntil) mul *= 1.4;
        return mul;
    }

    /** 目标相关的伤害乘数（霜华坠饰 / 影刺背刺） */
    damageMulVs(enemy: TrinketEnemy, source: 'basic' | 'skill' | 'dot' | 'reflect'): number {
        if (source === 'dot' || source === 'reflect') return 1;
        let mul = 1;
        if (this.has('frost_pendant') && enemy.status.stun > 0) mul *= 1.25;
        if (this.hasSynergy('shadowthorn') && this._isBehind(enemy)) mul *= 1.4;
        return mul;
    }

    private _isBehind(enemy: TrinketEnemy): boolean {
        const dx = this.player.x - enemy.x;
        const dy = this.player.y - enemy.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-3) return false;
        const dot = (dx * Math.cos(enemy.facing) + dy * Math.sin(enemy.facing)) / len;
        // 玩家位于敌人背后 120° 扇区
        return dot < -0.2;
    }

    /** 燃烧每跳倍率（血燃：低血 ×2） */
    burnTickMul(): number {
        return this.hasSynergy('bloodfire') && this.hpPct() < 0.3 ? 2 : 1;
    }

    /** 冰霜技能半径倍率（寒冰之心） */
    frostRadiusMul(): number {
        return this.has('frost_heart') ? 1.4 : 1;
    }

    /** 血球拾取半径倍率（饥饿之胃 / 血食） */
    orbPickupMul(): number {
        let mul = 1;
        if (this.has('hungry_stomach')) mul *= 1.3;
        if (this.hasSynergy('bloodfeast') && this.hpPct() < 0.5) mul *= 1.8;
        return mul;
    }

    /** 血球治疗倍率（饥饿之胃 −15%） */
    orbHealMul(): number {
        return this.has('hungry_stomach') ? 0.85 : 1;
    }

    /** 移速倍率（荆棘之冠 −10%） */
    speedMul(): number {
        return this.has('thorn_crown') ? 0.9 : 1;
    }

    /** 额外掉落件数（贪婪之眼 +1；M7.4 由 Loot 读取） */
    extraDropCount(): number {
        return this.has('greed_eye') ? 1 : 0;
    }

    /** 降品质概率（贪婪之眼 +25%；M7.4 由 Loot 读取） */
    lowerQualityChance(): number {
        return this.has('greed_eye') ? 0.25 : 0;
    }

    /** 宝箱额外选项（拾荒者背包；M7.4 由野外事件读取） */
    chestExtraOption(): boolean {
        return this.has('scavenger_pack');
    }

    /** 宝箱额外生命代价（拾荒者背包） */
    chestHpCost(): number {
        return this.has('scavenger_pack') ? 0.05 : 0;
    }

    // ---------- 触发 ----------

    onHitLanded(enemy: TrinketEnemy, crit: boolean, source: 'basic' | 'skill'): void {
        if (this.empty) return;
        for (const id of this._hookIds()) {
            const hooks = this._hooksOf(id);
            if (hooks.onHit) hooks.onHit(this, enemy, crit, source);
        }
        // 协同里没有 onHit 钩子；共鸣水晶的重置路径要照顾「誓回」
        if (this.hasSynergy('oathreturn') && this.lastResetAt === this.time) {
            this.host.addShield(this.player.maxHp * 0.03, 0.35);
            this.proc('synergy:oathreturn', '协同 · 誓回');
        }
    }

    onDamaged(attacker: TrinketEnemy | null, taken: number, melee: boolean): void {
        if (this.empty || !(taken > 0)) return;
        for (const id of this._hookIds()) {
            const hooks = this._hooksOf(id);
            if (hooks.onDamaged) hooks.onDamaged(this, attacker, taken, melee);
        }
        for (const sid of Object.keys(this._synergyIds)) {
            const hooks = SYNERGY_FIRE[sid];
            if (hooks && hooks.onDamaged) hooks.onDamaged(this, attacker, taken, melee);
        }
    }

    onDodge(): void {
        if (this.empty) return;
        for (const id of this._hookIds()) {
            const hooks = this._hooksOf(id);
            if (hooks.onDodge) hooks.onDodge(this);
        }
        for (const sid of Object.keys(this._synergyIds)) {
            const hooks = SYNERGY_FIRE[sid];
            if (hooks && hooks.onDodge) hooks.onDodge(this);
        }
    }

    /** 这次技能是否可以免费（回响石 / 影回），只查询不记账 */
    wantFreeCast(slot: TrinketSlotKey): boolean {
        if (this.hasSynergy('shadowecho') && this.time <= this.freeSkillUntil) return true;
        if (this.has('echo_stone')) {
            const casts = this._casts[slot] || 0;
            return (casts + 1) % 3 === 0;
        }
        return false;
    }

    /** 静默之铃：消耗一次「下一技能必暴」 */
    consumeForcedSkillCrit(): boolean {
        if (this.time > this.forcedSkillCritUntil) return false;
        this.forcedSkillCritUntil = -1;
        return true;
    }

    /** 技能成功施放后记账 */
    onSkillCast(slot: TrinketSlotKey, free: boolean): void {
        const casts = (this._casts[slot] || 0) + 1;
        this._casts[slot] = casts;
        this._lastSlot = slot;
        this._lastSlotAt = this.time;
        this.freeSkillUntil = -1;
        if (this.empty) return;
        for (const id of this._hookIds()) {
            const hooks = this._hooksOf(id);
            if (hooks.onCast) hooks.onCast(this, slot, free);
        }
    }

    onEnemyKilled(enemy: TrinketEnemy): void {
        if (this.empty) return;
        for (const id of this._hookIds()) {
            const hooks = this._hooksOf(id);
            if (hooks.onKill) hooks.onKill(this, enemy);
        }
        for (const sid of Object.keys(this._synergyIds)) {
            const hooks = SYNERGY_FIRE[sid];
            if (hooks && hooks.onKill) hooks.onKill(this, enemy);
        }
    }

    onOrbPicked(amount: number): void {
        if (this.empty) return;
        for (const id of this._hookIds()) {
            const hooks = this._hooksOf(id);
            if (hooks.onOrbPicked) hooks.onOrbPicked(this, amount);
        }
    }

    /** 治疗溢出：誓约之链转护盾（上限 20% 生命） */
    onHealOverflow(amount: number): void {
        if (!(amount > 0)) return;
        if (!this.has('oath_chain')) return;
        this.host.addShield(amount, 0.2);
        this.proc('oath_chain', '誓约之链 · 溢转护盾');
    }

    /** 守誓者徽记：每个节点首次致死免疫；返回是否救回 */
    trySaveFromDeath(): boolean {
        if (!this.has('oath_sigil') || this.oathUsed) return false;
        this.oathUsed = true;
        this.proc('oath_sigil', '守誓者徽记 · 免死');
        return true;
    }

    /** 额外掉落被拾取（饕餮协同） */
    onExtraLoot(): void {
        if (!this.hasSynergy('feast')) return;
        if (this.host.healPlayer(this.player.maxHp * 0.03) > 0) {
            this.proc('synergy:feast', '协同 · 饕餮');
        }
    }

    /** 燃烧挂载：余烬之环允许 2 层叠加，其余保持「取最大」 */
    applyBurn(enemy: TrinketEnemy, dps: number, dur: number): void {
        if (!(dps > 0) || !(dur > 0)) return;
        if (this.has('ember_ring')) {
            enemy.status.burnDps = Math.min(dps * 2, enemy.status.burnDps + dps);
        } else {
            enemy.status.burnDps = Math.max(enemy.status.burnDps, dps);
        }
        enemy.status.burnRemaining = Math.max(enemy.status.burnRemaining, dur);
    }

    // ---------- 内部 ----------

    private _hookIds(): string[] {
        return this.ids;
    }

    private _hooksOf(id: string): TrinketHooks {
        return FIRE[id] || EMPTY_HOOKS;
    }

    private _runHooks(name: 'onSecond', dt: number): void {
        for (const id of this._hookIds()) {
            const hooks = this._hooksOf(id);
            if (hooks.onSecond) hooks.onSecond(this, dt);
        }
        for (const sid of Object.keys(this._synergyIds)) {
            const hooks = SYNERGY_FIRE[sid];
            if (hooks && hooks.onSecond) hooks.onSecond(this, dt);
        }
    }
}

/** 工厂：读存档的两格饰品，返回聚合器（同件不叠加由 `equippedTrinketIds` 保证） */
export function trinketFxOf(
    trinkets: Array<string | null> | null | undefined,
    host: TrinketHost,
): TrinketFx {
    return new TrinketFx(trinkets, host);
}

export type { SynergyDef, TrinketDef, TrinketTag };
export { SYNERGIES };
