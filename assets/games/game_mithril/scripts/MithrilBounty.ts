/**
 * 《秘银远征》悬赏内核（M8，纯逻辑，**不得 import cc**）。
 *
 * 设计依据：`docs/plans/2026-11-14-game-mithril-design.md` §14.3（24 条悬赏）
 * 与 §4.6（军需官：Lv1 悬赏板 3 位 → Lv2 起 6 位 → Lv4 每日刷新）。
 *
 * 口径：
 *  - 悬赏板上的条目**自动追踪**，不需要「接取」；领奖即完成，空位立刻补下一条。
 *  - 战斗类进度来自 `applyRunReport()`（Core 的 `BountyStats` + 结算信息）；
 *    收集类进度 = 当前库存，领取时按 target 扣除（只扣背包，不碰身上装备）。
 *  - 悬赏位 / 每日刷新由调用方传参（Camp 的 `bountySlots` / Game 的当前日），
 *    本模块不 import Camp / cc，保持可 node 自检。
 */

import {
    BOUNTIES, BOUNTY_BY_ID, emptyBountyStats, materialName,
} from './MithrilConfig';
import type {
    BountyDef, BountyKind, BountyMetric, BountyStats, EquipItem, QualityId,
} from './MithrilConfig';
import type { MithrilSave } from './MithrilProgress';
import { rollItem } from './MithrilLoot';

/**
 * 与 `MithrilCore.mulberry32` 同算法的本地副本。
 * 内联是为了让 `MithrilCamp` 能安全引用本模块 —— Core 已经 import Camp，
 * 再让 Bounty → Core 会形成 Core ↔ Camp ↔ Bounty 的循环依赖。
 */
function mulberry32(seed: number): () => number {
    let a = (Math.floor(seed) >>> 0) || 1;
    return function next(): number {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 军需官 Lv1 解锁悬赏板 */
export const BOUNTY_UNLOCK_LEVEL = 1;
/** 军需官 Lv4 起每日刷新 */
export const BOUNTY_DAILY_REFRESH_LEVEL = 4;
/** 板面最多 6 条（与 BOUNTY_SLOTS_UPGRADED 一致） */
export const BOUNTY_SLOTS_MAX = 6;

export const BOUNTY_KIND_NAMES: Record<BountyKind, string> = {
    hunt: '讨伐',
    gather: '收集',
    dungeon: '副本',
    challenge: '挑战',
};

/** 收集类指标 → 扣除物文案用 */
const MATERIAL_TURNINS: Partial<Record<BountyMetric, string>> = {
    turnin_ash: 'ash_dust',
    turnin_frost: 'frost_crystal',
    turnin_mithril: 'mithril_ore',
};

function safeInt(value: unknown, fallback = 0): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.floor(n);
}

function materialCount(save: MithrilSave, id: string): number {
    const mats = save.materials || {};
    return Math.max(0, safeInt(mats[id], 0));
}

/** 背包里（不含已装备）指定品质的装备下标，按 ilvl 从低到高——先交差的，别把好装备交出去 */
export function gearIndexesOfQuality(save: MithrilSave, quality: QualityId): number[] {
    const out: number[] = [];
    if (!Array.isArray(save.inventory)) return out;
    for (let i = 0; i < save.inventory.length; i++) {
        const item = save.inventory[i];
        if (item && item.quality === quality) out.push(i);
    }
    out.sort((a, b) => {
        const ia = save.inventory[a];
        const ib = save.inventory[b];
        return (ia ? ia.ilvl : 0) - (ib ? ib.ilvl : 0);
    });
    return out;
}

/** 洗牌序列：同一天所有玩家看到同一组悬赏；跨日换一组 */
export function bountyOrder(day: number): string[] {
    const d = Math.max(0, safeInt(day, 0));
    const rng = mulberry32(((d * 2654435761) ^ 0x9e3779b9) >>> 0);
    const ids = BOUNTIES.map((b) => b.id);
    for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = ids[i];
        ids[i] = ids[j];
        ids[j] = tmp;
    }
    return ids;
}

function cleanBoard(save: MithrilSave, slots: number): void {
    const seen: Record<string, true> = {};
    const kept: string[] = [];
    const src = Array.isArray(save.bounties) ? save.bounties : [];
    for (const id of src) {
        if (!BOUNTY_BY_ID[id] || seen[id]) continue;
        if (kept.length >= slots) break;
        seen[id] = true;
        kept.push(id);
    }
    save.bounties = kept;

    const progress = save.bountyProgress && typeof save.bountyProgress === 'object'
        ? save.bountyProgress : {};
    const next: Record<string, number> = {};
    for (const id of kept) {
        const def = BOUNTY_BY_ID[id];
        if (!def) continue;
        const raw = progress[id];
        if (raw === undefined) continue;
        next[id] = Math.max(0, Math.min(def.target, safeInt(raw, 0)));
    }
    save.bountyProgress = next;
}

/**
 * 补齐/刷新悬赏板。返回 `{ refreshed, added }`：
 *  - `refreshed` = 跨日重置（仅 Lv4+）；
 *  - `added` = 本次补进来的条数。
 */
export function ensureBountyBoard(
    save: MithrilSave,
    day: number,
    slots: number,
    allowDaily: boolean,
): { refreshed: boolean; added: number } {
    const cap = Math.max(0, Math.min(BOUNTY_SLOTS_MAX, safeInt(slots, 0)));
    const today = Math.max(0, safeInt(day, 0));
    let refreshed = false;

    if (cap <= 0) {
        // 军需官未建造：不建板，也不动旧数据（升级后还能接着用）
        return { refreshed: false, added: 0 };
    }

    if (allowDaily && save.bountyDay > 0 && save.bountyDay !== today) {
        save.bounties = [];
        save.bountyProgress = {};
        save.bountyCursor = 0;
        save.bountyDay = today;
        refreshed = true;
    }
    if (!(save.bountyDay > 0)) save.bountyDay = today;

    cleanBoard(save, cap);

    // 游标无论补不补位都夹到合法范围：坏档 / 旧档里的越界值不该继续留在存档里
    const order = bountyOrder(save.bountyDay);
    let cursor = Math.max(0, Math.min(order.length - 1, safeInt(save.bountyCursor, 0)));
    let added = 0;
    if (save.bounties.length < cap) {
        const guard = order.length * 2;
        for (let n = 0; n < guard && save.bounties.length < cap; n++) {
            const id = order[cursor % order.length];
            cursor = (cursor + 1) % order.length;
            if (save.bounties.indexOf(id) >= 0) continue;
            save.bounties.push(id);
            added++;
        }
    }
    save.bountyCursor = cursor;
    return { refreshed, added };
}

/** 当前进度：自动类读存档，收集类读库存（上限 target） */
export function bountyProgressOf(save: MithrilSave, def: BountyDef): number {
    if (def.consume) {
        if (def.consume.kind === 'material') return Math.min(def.target, materialCount(save, def.consume.materialId));
        return Math.min(def.target, gearIndexesOfQuality(save, def.consume.quality).length);
    }
    const raw = save.bountyProgress ? save.bountyProgress[def.id] : 0;
    return Math.max(0, Math.min(def.target, safeInt(raw, 0)));
}

export function isBountyReady(save: MithrilSave, def: BountyDef): boolean {
    return bountyProgressOf(save, def) >= def.target;
}

/** 推进所有板上匹配指标的自动悬赏；返回被推进的条数 */
export function advanceBountyMetric(save: MithrilSave, metric: BountyMetric, amount = 1): number {
    const delta = Math.max(0, safeInt(amount, 0));
    if (delta <= 0) return 0;
    if (!Array.isArray(save.bounties)) return 0;
    if (!save.bountyProgress || typeof save.bountyProgress !== 'object') save.bountyProgress = {};
    let changed = 0;
    for (const id of save.bounties) {
        const def = BOUNTY_BY_ID[id];
        if (!def || def.consume || def.metric !== metric) continue;
        const cur = Math.max(0, safeInt(save.bountyProgress[id], 0));
        if (cur >= def.target) continue;
        save.bountyProgress[id] = Math.min(def.target, cur + delta);
        changed++;
    }
    return changed;
}

/** 一场战斗结算后交给悬赏系统的报告 */
export interface BountyRunReport {
    /** 是否通关（失败局仍推进击杀类） */
    won: boolean;
    /** 节点类型：野外 BOSS / 副本 / 普通战斗 */
    kind: 'battle' | 'elite' | 'boss' | 'dungeon' | 'other';
    elapsed: number;
    stats: BountyStats;
    /** 本局结算发到背包的装备件数（副本挑战用） */
    lootCount: number;
    /** 本局死亡次数（0 = 无死亡） */
    deaths: number;
    /** 结算时全身装备是否只有白装（空槽算允许） */
    whiteOnly: boolean;
    /** 进本时两个饰品槽是否都空 */
    noTrinket: boolean;
    /** 当前远征已清理节点数 / 总节点数 */
    fullRunDone: number;
    fullRunTotal: number;
}

/** 推进一场战斗能推进的全部悬赏 */
export function applyRunReport(save: MithrilSave, report: BountyRunReport): void {
    const stats = report.stats || emptyBountyStats();
    // 击杀类：失败局也算（打过的怪不白打）
    advanceBountyMetric(save, 'kill', stats.mobKills);
    advanceBountyMetric(save, 'elite_kill', stats.eliteKills);
    advanceBountyMetric(save, 'elite_no_hit', stats.eliteNoHitKills);
    advanceBountyMetric(save, 'burst_elite_kill', stats.burstEliteKills);
    advanceBountyMetric(save, 'low_hp_kill', stats.lowHpKills);
    if (stats.maxKillsIn10s >= 5) advanceBountyMetric(save, 'kill_5_in_10s', 1);

    if (!report.won) return;

    if (report.kind === 'boss') advanceBountyMetric(save, 'region_boss', 1);

    if (report.kind === 'dungeon') {
        advanceBountyMetric(save, 'dungeon_clear', 1);
        if (report.deaths <= 0) advanceBountyMetric(save, 'dungeon_nodeath', 1);
        if (report.elapsed > 0 && report.elapsed <= 300) advanceBountyMetric(save, 'dungeon_speed', 1);
        if (stats.bossLastHitSkill) advanceBountyMetric(save, 'dungeon_last_hit', 1);
        if (report.whiteOnly) advanceBountyMetric(save, 'dungeon_white', 1);
        if (report.noTrinket) advanceBountyMetric(save, 'dungeon_no_trinket', 1);
        if (stats.crits >= 20) advanceBountyMetric(save, 'dungeon_crit', 1);
        if (report.lootCount >= 10) advanceBountyMetric(save, 'dungeon_loot', 1);
    }

    if (report.fullRunTotal > 0 && report.fullRunDone >= report.fullRunTotal) {
        advanceBountyMetric(save, 'full_run', 1);
    }
}

export interface BountyBoardContext {
    day: number;
    slots: number;
    allowDaily: boolean;
}

export interface BountyClaimResult {
    ok: boolean;
    reason: 'ok' | 'not-active' | 'not-ready' | 'insufficient' | 'bad-def';
    def: BountyDef | null;
    gold: number;
    /** 额外装备（调用方负责入包 / 背包满折金币） */
    item: EquipItem | null;
    materialId: string;
    materialCount: number;
    /** 扣除的收集物（用于提示：灰烬 ×20 / 蓝装 ×3） */
    consumeText: string;
}

function emptyClaim(reason: BountyClaimResult['reason'], def: BountyDef | null): BountyClaimResult {
    return {
        ok: false, reason, def, gold: 0, item: null,
        materialId: '', materialCount: 0, consumeText: '',
    };
}

/** 领取：校验 → 扣收集物 → 发金币/材料/装备 → 移除并补位 */
export function claimBounty(
    save: MithrilSave,
    id: string,
    rng: () => number,
    ilvl: number,
    ctx: BountyBoardContext,
): BountyClaimResult {
    const def = BOUNTY_BY_ID[id];
    if (!def) return emptyClaim('bad-def', null);
    if (!Array.isArray(save.bounties) || save.bounties.indexOf(id) < 0) return emptyClaim('not-active', def);
    if (!isBountyReady(save, def)) {
        return emptyClaim(def.consume ? 'insufficient' : 'not-ready', def);
    }

    let consumeText = '';
    if (def.consume) {
        if (def.consume.kind === 'material') {
            const matId = def.consume.materialId;
            if (materialCount(save, matId) < def.target) return emptyClaim('insufficient', def);
            save.materials[matId] = materialCount(save, matId) - def.target;
            consumeText = `${materialName(matId)} ×${def.target}`;
        } else {
            const indexes = gearIndexesOfQuality(save, def.consume.quality);
            if (indexes.length < def.target) return emptyClaim('insufficient', def);
            const take = indexes.slice(0, def.target).sort((a, b) => b - a);
            for (const idx of take) save.inventory.splice(idx, 1);
            consumeText = `${QUALITY_LABEL[def.consume.quality] || def.consume.quality}装备 ×${def.target}`;
        }
    }

    // 先移除再发奖：重复点击第二次必然 not-active
    const index = save.bounties.indexOf(id);
    save.bounties.splice(index, 1);
    if (save.bountyProgress) delete save.bountyProgress[id];

    save.gold = Math.max(0, safeInt(save.gold, 0)) + def.gold;

    let materialId = '';
    let materialCountGain = 0;
    if (def.material) {
        materialId = def.material.id;
        materialCountGain = Math.max(0, safeInt(def.material.count, 0));
        save.materials[materialId] = materialCount(save, materialId) + materialCountGain;
    }

    let item: EquipItem | null = null;
    if (def.item) {
        item = rollItem(rng, {
            ilvl: Math.max(1, Math.min(40, safeInt(ilvl, 1))),
            classId: save.classId,
            quality: def.item.quality,
        });
    }

    ensureBountyBoard(save, ctx.day, ctx.slots, ctx.allowDaily);

    return {
        ok: true, reason: 'ok', def, gold: def.gold, item,
        materialId, materialCount: materialCountGain, consumeText,
    };
}

const QUALITY_LABEL: Partial<Record<QualityId, string>> = {
    common: '白', uncommon: '绿', rare: '蓝', epic: '紫', legendary: '橙', mythic: '红',
};

export interface BountyRow {
    def: BountyDef;
    progress: number;
    target: number;
    ready: boolean;
    /** 行主文案：`击杀 30 只小怪` */
    name: string;
    /** 进度文案：`12/30` / `灰烬 8/20` */
    progressText: string;
}

/** 面板行数据（顺序 = 板上顺序） */
export function bountyBoardRows(save: MithrilSave): BountyRow[] {
    const out: BountyRow[] = [];
    if (!Array.isArray(save.bounties)) return out;
    for (const id of save.bounties) {
        const def = BOUNTY_BY_ID[id];
        if (!def) continue;
        const progress = bountyProgressOf(save, def);
        let progressText = `${progress}/${def.target}`;
        if (def.consume && def.consume.kind === 'material') {
            progressText = `${materialName(def.consume.materialId)} ${progress}/${def.target}`;
        } else if (def.consume && def.consume.kind === 'gear') {
            progressText = `${QUALITY_LABEL[def.consume.quality] || ''}装 ${progress}/${def.target}`;
        }
        out.push({
            def, progress, target: def.target, ready: progress >= def.target,
            name: def.name, progressText,
        });
    }
    return out;
}

/** 领取奖励装备的装等：随等级走，夹在 1–40 */
export function bountyItemIlvl(level: number): number {
    return Math.max(1, Math.min(40, safeInt(level, 1) + 8));
}

/** 分解钩子用：定义存在且是分解指标 */
export function bountyUsesMetric(metric: BountyMetric): boolean {
    for (const def of BOUNTIES) if (def.metric === metric) return true;
    return false;
}

/** 供 UI 显示「悬赏位 N 个 / 今日已刷新」时的日号 */
export function bountyToday(nowMs: number): number {
    return Math.max(0, Math.floor(safeInt(nowMs, 0) / 86400000));
}

/** 兼容旧调用：空统计 */
export { emptyBountyStats };
