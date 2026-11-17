/**
 * 《秘银远征》野外节点图（纯逻辑，**不得 import cc**）。
 *
 * 设计依据（docs/plans/2026-11-14-game-mithril-design.md §5）：
 *  - 每区域 12 节点：起点 + 4 层（2/3/3/2）+ 区域首领
 *  - 每次远征 3 点补给；每进入一个节点扣 1 点，耗尽后每节点扣 8% 最大生命
 *  - 篝火首次访问回 40% 生命（不补补给）；宝箱 25% 陷阱；事件三选一
 *  - 死亡 / 放弃：失去本次远征材料，保留装备与等级
 *
 * 随机全部由调用方种子驱动（同种子 → 同图、同宝箱、同奖励），
 * 这样渲染层只读、自检可复现，存档里只存 seed + 进度。
 */

import {
    ENCOUNTER_HEAL_PCT,
    MATERIAL_BY_ID,
    MATERIALS,
    NODE_KIND_NAMES,
    REGION_BOSS_BY_ID,
    REGION_BY_ID,
    REGION_ENEMY_POOLS,
    REGIONS,
    SUPPLY_EXHAUST_HP_PCT,
    SUPPLY_PER_RUN,
    WILD_CHEST_GOLD,
    WILD_CHEST_TRAP_CHANCE,
    WILD_CHEST_TRAP_HP_PCT,
    WILD_EVENT_HEAL_PCT,
    WILD_EVENT_MATERIALS,
    WILD_EVENT_RISK_HP_PCT,
    WILD_EVENT_RISK_MATERIALS,
    WILD_LAYERS,
    WILD_NODE_COUNT,
    WILD_REWARDS,
    WILD_SUPPLY_HEAL_PCT,
    dungeonRunPlan,
    implementedDungeonIds,
    regionBossScript,
    regionMaterialId,
} from './MithrilConfig';
import type {
    EncounterDef,
    NodeKind,
    RegionDef,
    RegionEnemyPool,
    RunPlan,
} from './MithrilConfig';

// ==================== 类型 ====================

export interface WildNode {
    id: number;
    kind: NodeKind;
    /** 0 = 起点，5 = 区域首领 */
    layer: number;
    /** 层内序号（0 起），布局与连线按它算 */
    col: number;
    /** 节点等级（区域等级区间按层线性取整） */
    level: number;
    /** 节点掉落装等 */
    ilvl: number;
    /** 双向连通的节点 id */
    links: number[];
    /** 内容随机种子（宝箱 / 事件 / 战斗都从它派生） */
    seed: number;
    /** dungeon 节点的副本 id；每区域取一个已实装副本 */
    dungeonId: string | null;
    /** boss 节点的敌人 id */
    bossId: string | null;
}

export interface WildMap {
    regionId: string;
    seed: number;
    nodes: WildNode[];
}

/** 存档里的远征进度（关卡图本身由 seed 重新生成，不落盘） */
export interface ExpeditionState {
    regionId: string;
    seed: number;
    supply: number;
    hp: number;
    /** 当前所在节点 id */
    pos: number;
    /** 到过的节点（含起点） */
    visited: number[];
    /** 已结算过内容的节点（奖励只发一次） */
    done: number[];
    /** 本次远征已入档的材料数量，死亡 / 放弃时按此扣除 */
    runMaterials: Record<string, number>;
    /** 首领已击败（或已失败，等待界面清理） */
    complete: boolean;
    /**
     * 战斗中途主动离开（暂停层「返回路线图」/「返回大厅」/ 切后台）留下的标记（试玩 N66 / 复核 N72）。
     * 置位后再次点当前节点不是免费续开，而是**新一次挑战**：重新扣一次入场消耗。
     * 正常退出路径（含整页刷新、切后台）都会触发 `onGameHide` 而置位；
     * 只有进程被直接杀掉、没走到落盘的存档才可能是 false，此时按免费续开处理。
     */
    retreat?: boolean;
}

export type EnterFailReason = 'not_reachable' | 'complete' | 'unknown' | 'done';

/** ok = 新节点（扣补给）；start 回起点；transit 路过已清理节点；resume 重开未结算内容 */
export type EnterReason = 'ok' | 'start' | 'resume' | 'transit' | EnterFailReason;

export interface EnterNodeResult {
    ok: boolean;
    reason: EnterReason;
    /** 本次进入是否消耗了补给 */
    supplySpent: boolean;
    /** 补给耗尽时扣的生命 */
    hpCost: number;
    /** 扣血是否致死 */
    dead: boolean;
}

export type WildEventChoice = 'loot' | 'bandage' | 'dig';

export interface WildEventOption {
    id: WildEventChoice;
    label: string;
    desc: string;
}

export interface WildEventResult {
    hpDelta: number;
    materialDelta: number;
    dead: boolean;
}

// ==================== 种子随机 ====================

/** 与 Core 的 mulberry32 同分布；独立一份避免纯逻辑模块互相 import */
export function wildRng(seed: number): () => number {
    let a = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0;
    return function next(): number {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function mixSeed(a: number, b: number): number {
    let h = (a ^ 0x9e3779b9 ^ (b + (a << 6) + (a >>> 2))) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
    }
    return arr;
}

// ==================== 地图生成 ====================

/** 每层的节点类型（层内顺序会被打乱；L4 的副本入口在没有已实装副本时换成精英） */
const LAYER_KINDS: NodeKind[][] = [
    ['start'],
    ['battle', 'battle'],
    ['elite', 'event', 'battle'],
    ['chest', 'supply', 'battle'],
    ['dungeon', 'elite'],
    ['boss'],
];

export function regionOf(regionId: string): RegionDef {
    return REGION_BY_ID[regionId] || REGIONS[0];
}

export function regionUnlocked(regionId: string, level: number): boolean {
    const region = REGION_BY_ID[regionId];
    return !!region && level >= region.levelMin;
}

/**
 * 区域首领结算后的「下一区域」提示（试玩 N68）：
 * 没有下一区域（终局区域）或区域 id 无效时返回 null，不产出空文案。
 * 等级不足时给出门槛，够级则提示回路线图切换区域。
 */
export function nextRegionHint(regionId: string, level: number): string | null {
    const idx = REGIONS.findIndex((r) => r.id === regionId);
    const next = idx >= 0 ? REGIONS[idx + 1] : undefined;
    if (!next) return null;
    const lv = Math.max(1, Math.floor(Number(level) || 1));
    return lv < next.levelMin
        ? `下一区域 ${next.name} 将在 Lv${next.levelMin} 解锁（当前 Lv${lv}）`
        : `下一区域 ${next.name} 已解锁：回路线图切换区域`;
}

/** 生成一张 12 节点图：同 (regionId, seed) 必得同一张图 */
export function generateWildMap(regionId: string, seed: number): WildMap {
    const region = regionOf(regionId);
    const s = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0;
    const implemented = implementedDungeonIds();
    const dungeonPool = region.dungeonIds.filter((id) => implemented.indexOf(id) >= 0);

    const byLayer: number[][] = [];
    const nodes: WildNode[] = [];
    const rng = wildRng(mixSeed(s, 0xa11ce));
    const regionPool = REGION_ENEMY_POOLS[region.id];

    let dungeonCursor = 0;
    for (let layer = 0; layer < WILD_LAYERS.length; layer++) {
        const count = WILD_LAYERS[layer];
        let kinds = LAYER_KINDS[layer].slice();
        // 层 4 是副本入口层：区域内已实装几个副本就开几个门（两个副本 = 两个门，玩家自己选），
        // 一个都没有时退回双精英。选哪个副本不由种子决定，否则同一区域总有一层进不去。
        if (layer === 4) {
            kinds = dungeonPool.length === 0
                ? ['elite', 'elite']
                : new Array(count).fill('dungeon');
        }
        if (kinds.length < count) kinds = kinds.concat(new Array(count - kinds.length).fill('battle'));
        shuffle(kinds, rng);

        const row: number[] = [];
        for (let col = 0; col < count; col++) {
            const kind = kinds[col] as NodeKind;
            const id = nodes.length;
            const t = WILD_LAYERS.length > 1 ? layer / (WILD_LAYERS.length - 1) : 0;
            const level = Math.round(region.levelMin + (region.levelMax - region.levelMin) * t);
            const ilvl = Math.round(region.ilvlMin + (region.ilvlMax - region.ilvlMin) * t);
            const dungeonId = kind === 'dungeon' && dungeonPool.length > 0
                ? dungeonPool[dungeonCursor++ % dungeonPool.length]
                : null;
            nodes.push({
                id,
                kind,
                layer,
                col,
                level,
                ilvl,
                links: [],
                seed: mixSeed(s, id * 7919 + 17),
                dungeonId,
                bossId: kind === 'boss' && regionPool ? regionPool.boss : null,
            });
            row.push(id);
        }
        byLayer.push(row);
    }

    // 相邻层就近双向连线：每个节点都能向前走，也不会出现「下一层没人连」的孤岛
    for (let layer = 0; layer + 1 < byLayer.length; layer++) {
        const from = byLayer[layer];
        const to = byLayer[layer + 1];
        for (const a of from) {
            const na = nodes[a];
            let best = to[0];
            let bestD = Infinity;
            for (const b of to) {
                const d = Math.abs(nodes[b].col - na.col);
                if (d < bestD) {
                    bestD = d;
                    best = b;
                }
            }
            linkNodes(nodes, a, best);
        }
        for (const b of to) {
            const nb = nodes[b];
            let best = from[0];
            let bestD = Infinity;
            for (const a of from) {
                const d = Math.abs(nodes[a].col - nb.col);
                if (d < bestD) {
                    bestD = d;
                    best = a;
                }
            }
            linkNodes(nodes, best, b);
        }
    }
    // 起点连到所有第一层节点（否则另外两个节点第一层就不可达）
    for (const id of byLayer[1] || []) linkNodes(nodes, byLayer[0][0], id);
    // 所有第四层节点都能进 BOSS
    const bossId = byLayer[byLayer.length - 1][0];
    for (const id of byLayer[byLayer.length - 2] || []) linkNodes(nodes, id, bossId);

    return { regionId: region.id, seed: s, nodes };
}

function linkNodes(nodes: WildNode[], a: number, b: number): void {
    if (a === b) return;
    const na = nodes[a];
    const nb = nodes[b];
    if (!na || !nb) return;
    if (na.links.indexOf(b) < 0) na.links.push(b);
    if (nb.links.indexOf(a) < 0) nb.links.push(a);
}

export function nodeById(map: WildMap, id: number): WildNode | null {
    return map.nodes[id] || null;
}

export function nodeName(node: WildNode): string {
    if (node.kind === 'dungeon' && node.dungeonId) {
        const names: Record<string, string> = {
            mine: '废弃矿坑', chapel: '腐化教堂', tower: '冰封哨塔',
            forge: '熔火熔炉', shadow: '暗影回廊', throne: '秘银王座',
        };
        return names[node.dungeonId] || NODE_KIND_NAMES[node.kind];
    }
    return NODE_KIND_NAMES[node.kind];
}

// ==================== 远征状态 ====================

export function createExpedition(regionId: string, seed: number, maxHp: number): ExpeditionState {
    const hp = Math.max(1, Math.round(Number(maxHp) || 1));
    return {
        regionId: regionOf(regionId).id,
        seed: (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0,
        supply: SUPPLY_PER_RUN,
        hp,
        pos: 0,
        visited: [0],
        done: [],
        runMaterials: {},
        complete: false,
        retreat: false,
    };
}

export function isNodeDone(exp: ExpeditionState | null, nodeId: number): boolean {
    return !!exp && exp.done.indexOf(nodeId) >= 0;
}

export function isReachable(map: WildMap, exp: ExpeditionState | null, nodeId: number): boolean {
    if (!exp || exp.complete) return false;
    const node = nodeById(map, nodeId);
    if (!node) return false;
    if (exp.done.indexOf(nodeId) >= 0) return false;
    if (nodeId === exp.pos) return false;
    const cur = nodeById(map, exp.pos);
    if (!cur) return false;
    return cur.links.indexOf(nodeId) >= 0;
}

/** 与当前位置直接相连（不管是否已结算）；起点回退不看这个 */
export function isAdjacent(map: WildMap, exp: ExpeditionState | null, nodeId: number): boolean {
    if (!exp) return false;
    const cur = nodeById(map, exp.pos);
    return !!cur && cur.links.indexOf(nodeId) >= 0;
}

/** 当前节点（起点也算） */
export function currentNode(map: WildMap, exp: ExpeditionState | null): WildNode | null {
    if (!exp) return null;
    return nodeById(map, exp.pos);
}

/**
 * 进入节点：先付补给，再更新位置并返回代价。
 *
 * 规则（试玩第 11 轮 N39 后收紧）：
 *  - 起点随时可免费回去；因为已清理节点允许「路过」，回起点不会把路走死
 *  - 已结算节点可以路过：相邻即可点，不扣补给、不再发奖励（`transit`）
 *  - 站在未结算的节点上（整页刷新 / 意外退出）可以免费把内容重新点开（`resume`）
 *  - 只有进入未结算的新节点才扣补给；补给耗尽后每节点按 8% 最大生命扣血
 */
export function enterNode(
    map: WildMap,
    exp: ExpeditionState | null,
    nodeId: number,
    maxHp: number,
): EnterNodeResult {
    const deny = (reason: EnterFailReason): EnterNodeResult => (
        { ok: false, reason, supplySpent: false, hpCost: 0, dead: false }
    );
    if (!exp || exp.complete) return deny('complete');
    const node = nodeById(map, nodeId);
    if (!node) return deny('unknown');
    if (node.kind === 'start') {
        exp.pos = nodeId;
        return { ok: true, reason: 'start', supplySpent: false, hpCost: 0, dead: false };
    }

    const done = exp.done.indexOf(nodeId) >= 0;
    if (nodeId === exp.pos) {
        // 当前节点没结算就中断（刷新）：允许免费重开；已结算则只是「你在这里」
        return done ? deny('done') : { ok: true, reason: 'resume', supplySpent: false, hpCost: 0, dead: false };
    }
    // 不相邻的已清理节点报「已清理」，比「不相邻」更贴近玩家意图（N42）
    if (!isAdjacent(map, exp, nodeId)) return deny(done ? 'done' : 'not_reachable');
    if (done) {
        exp.pos = nodeId;
        return { ok: true, reason: 'transit', supplySpent: false, hpCost: 0, dead: false };
    }

    exp.pos = nodeId;
    if (exp.visited.indexOf(nodeId) < 0) exp.visited.push(nodeId);

    const charged = chargeNodeEntry(exp, maxHp);
    return {
        ok: true,
        reason: 'ok',
        supplySpent: charged.supplySpent,
        hpCost: charged.hpCost,
        dead: charged.dead,
    };
}

/**
 * 扣一次「进入节点」的消耗：优先补给，补给耗尽按最大生命 8% 扣血。
 * 供 `enterNode` 与「中途离开后的重新挑战」共用（试玩 N66：撤离再进必须重新付费，
 * 否则可以反复刷同一节点的击杀收益）。
 */
export function chargeNodeEntry(
    exp: ExpeditionState | null,
    maxHp: number,
): { supplySpent: boolean; hpCost: number; dead: boolean } {
    if (!exp) return { supplySpent: false, hpCost: 0, dead: false };
    let supplySpent = false;
    let hpCost = 0;
    if (exp.supply > 0) {
        exp.supply -= 1;
        supplySpent = true;
    } else {
        hpCost = Math.max(1, Math.round((Number(maxHp) || exp.hp) * SUPPLY_EXHAUST_HP_PCT));
        exp.hp = Math.max(0, exp.hp - hpCost);
    }
    const dead = exp.hp <= 0;
    if (dead) exp.hp = 0;
    return { supplySpent, hpCost, dead };
}

export function markNodeDone(exp: ExpeditionState | null, nodeId: number): void {
    if (!exp) return;
    if (exp.done.indexOf(nodeId) < 0) exp.done.push(nodeId);
}

export function grantRunMaterials(exp: ExpeditionState | null, materialId: string, amount: number): number {
    if (!exp) return 0;
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    if (n <= 0) return 0;
    const key = MATERIAL_BY_ID[materialId] ? materialId : regionMaterialId(exp.regionId);
    exp.runMaterials[key] = Math.max(0, Math.floor(exp.runMaterials[key] || 0)) + n;
    return n;
}

export function expeditionMaterialTotal(exp: ExpeditionState | null): number {
    if (!exp) return 0;
    let total = 0;
    for (const key of Object.keys(exp.runMaterials)) total += Math.max(0, exp.runMaterials[key] || 0);
    return total;
}

/** 死亡 / 放弃：清空本程材料并返回明细，调用方负责从存档里扣掉 */
export function failExpedition(exp: ExpeditionState | null): Record<string, number> {
    if (!exp) return {};
    const lost: Record<string, number> = {};
    for (const key of Object.keys(exp.runMaterials)) {
        const n = Math.max(0, Math.floor(exp.runMaterials[key] || 0));
        if (n > 0) lost[key] = n;
    }
    exp.runMaterials = {};
    exp.hp = 0;
    exp.pos = 0;
    exp.complete = true;
    return lost;
}

// ==================== 宝箱 / 事件 / 篝火 ====================

export function chestHasTrap(node: WildNode): boolean {
    return wildRng(mixSeed(node.seed, 0xc0ffee))() < WILD_CHEST_TRAP_CHANCE;
}

export function chestTrapDamage(maxHp: number): number {
    return Math.max(1, Math.round((Number(maxHp) || 1) * WILD_CHEST_TRAP_HP_PCT));
}

export function chestGold(node: WildNode): number {
    return WILD_CHEST_GOLD + Math.max(0, node.level) * 2;
}

export function supplyHeal(maxHp: number, hp: number): number {
    const cap = Math.max(0, Math.round(Number(maxHp) || 0));
    const cur = Math.max(0, Math.round(Number(hp) || 0));
    return Math.max(0, Math.min(cap - cur, Math.round(cap * WILD_SUPPLY_HEAL_PCT)));
}

export const WILD_EVENT_OPTIONS: WildEventOption[] = [
    { id: 'loot', label: '搜刮物资', desc: `材料 +${WILD_EVENT_MATERIALS}` },
    { id: 'bandage', label: '包扎伤口', desc: `恢复 ${Math.round(WILD_EVENT_HEAL_PCT * 100)}% 生命` },
    {
        id: 'dig',
        label: '冒险深挖',
        desc: `材料 +${WILD_EVENT_RISK_MATERIALS}，失去 ${Math.round(WILD_EVENT_RISK_HP_PCT * 100)}% 生命`,
    },
];

/** 应用事件选择；材料进 `runMaterials`，返回实际血量变化 */
export function applyWildEvent(
    exp: ExpeditionState | null,
    choice: WildEventChoice,
    maxHp: number,
): WildEventResult {
    if (!exp) return { hpDelta: 0, materialDelta: 0, dead: false };
    const cap = Math.max(1, Math.round(Number(maxHp) || 1));
    let hpDelta = 0;
    let materialDelta = 0;
    if (choice === 'bandage') {
        const before = exp.hp;
        exp.hp = Math.min(cap, exp.hp + Math.round(cap * WILD_EVENT_HEAL_PCT));
        hpDelta = exp.hp - before;
    } else if (choice === 'dig') {
        materialDelta = grantRunMaterials(exp, regionMaterialId(exp.regionId), WILD_EVENT_RISK_MATERIALS);
        const dmg = Math.max(1, Math.round(cap * WILD_EVENT_RISK_HP_PCT));
        exp.hp = Math.max(0, exp.hp - dmg);
        hpDelta = -dmg;
    } else {
        materialDelta = grantRunMaterials(exp, regionMaterialId(exp.regionId), WILD_EVENT_MATERIALS);
    }
    const dead = exp.hp <= 0;
    if (dead) exp.hp = 0;
    return { hpDelta, materialDelta, dead };
}

// ==================== 节点 → RunPlan ====================

function battleEncounters(pool: RegionEnemyPool): EncounterDef[] {
    const [a, b, c] = [pool.mobs[0], pool.mobs[1], pool.mobs[2]];
    return [
        { name: '第一波', subtitle: '前哨的游荡者', spawns: [{ enemyId: a, count: 3 }] },
        {
            name: '第二波', subtitle: '它们开始聚拢',
            spawns: [{ enemyId: b, count: 2 }, { enemyId: a, count: 2 }],
        },
        {
            name: '第三波', subtitle: '头目压阵',
            spawns: [{ enemyId: c, count: 2 }, { enemyId: b, count: 2 }, { enemyId: a, count: 1 }],
        },
    ];
}

function eliteEncounter(pool: RegionEnemyPool): EncounterDef[] {
    return [{
        name: '精英守卫',
        subtitle: '它守着通往深处的路',
        spawns: [{ enemyId: pool.elite, count: 1 }, { enemyId: pool.mobs[0], count: 2 }],
    }];
}

/**
 * 把野外节点编译成一局战斗。
 *  - battle：3 波小怪，无 BOSS
 *  - elite：精英 + 2 小怪，无 BOSS
 *  - boss：直接进区域首领
 *  - dungeon：复用对应副本编排（M4 只有废弃矿坑）
 * 其它节点（宝箱 / 事件 / 补给 / 起点）不产生战斗，返回 null。
 */
export function buildWildPlan(map: WildMap, node: WildNode | null): RunPlan | null {
    if (!node) return null;
    const region = regionOf(map.regionId);
    const pool = REGION_ENEMY_POOLS[region.id];
    if (node.kind === 'dungeon') {
        return node.dungeonId ? dungeonRunPlan(node.dungeonId) : null;
    }
    if (!pool) return null;

    if (node.kind === 'boss') {
        const boss = regionBossScript(node.bossId || pool.boss);
        if (!boss) return null;
        const bdef = REGION_BOSS_BY_ID[boss.enemyId];
        return {
            kind: 'wild',
            id: `${region.id}_boss`,
            name: `${region.name} · 区域首领`,
            encounters: [],
            healPct: ENCOUNTER_HEAL_PCT,
            boss,
            bossTitle: bdef ? bdef.name : boss.enemyId,
            bossHint: bdef ? bdef.phases.map((p) => p.name).join(' · ') : '',
            scale: 1,
            // 试玩 N69：4%/级让灰烬荒原终局首领到 1.36×，与实测玩家输出曲线脱节；降到 3%/级
            bossScale: 1 + Math.max(0, node.level - region.levelMin) * 0.03,
            ilvl: node.ilvl,
        };
    }

    if (node.kind !== 'battle' && node.kind !== 'elite') return null;
    const grade = Math.max(0, node.level - region.levelMin);
    return {
        kind: 'wild',
        id: `${region.id}_${node.kind}_${node.id}`,
        name: `${region.name} · ${NODE_KIND_NAMES[node.kind]}`,
        encounters: node.kind === 'elite' ? eliteEncounter(pool) : battleEncounters(pool),
        healPct: ENCOUNTER_HEAL_PCT,
        boss: null,
        bossTitle: '',
        bossHint: '',
        scale: 1 + grade * 0.05,
        bossScale: 1,
        ilvl: node.ilvl,
    };
}

/** 节点通关的材料数量（确定性；由节点种子决定） */
export function rollNodeMaterials(node: WildNode): number {
    if (node.kind !== 'battle' && node.kind !== 'elite' && node.kind !== 'boss') return 0;
    const def = WILD_REWARDS[node.kind];
    if (!def) return 0;
    const rng = wildRng(mixSeed(node.seed, 0x5eed));
    return def.matsMin + Math.floor(rng() * (def.matsMax - def.matsMin + 1));
}

// ==================== 存档净化 ====================

function toInt(value: unknown, min: number, max: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.floor(n)));
}

function uniqueIds(raw: unknown): number[] {
    const out: number[] = [];
    if (!Array.isArray(raw)) return out;
    for (const v of raw) {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isInteger(n) || n < 0 || n >= WILD_NODE_COUNT) continue;
        if (out.indexOf(n) < 0) out.push(n);
    }
    return out;
}

/** 坏档 / 旧档一律返回 null（= 没有进行中的远征），绝不抛异常 */
export function sanitizeExpedition(raw: unknown): ExpeditionState | null {
    if (!raw || typeof raw !== 'object') return null;
    const src = raw as Record<string, unknown>;
    const regionId = typeof src.regionId === 'string' && REGION_BY_ID[src.regionId]
        ? src.regionId
        : '';
    if (!regionId) return null;
    const seed = toInt(src.seed, 0, 0x7fffffff);
    const supply = toInt(src.supply, 0, SUPPLY_PER_RUN);
    const hp = toInt(src.hp, 0, 1e9);
    if (hp <= 0) return null;
    const pos = toInt(src.pos, 0, WILD_NODE_COUNT - 1);
    const visited = uniqueIds(src.visited);
    if (visited.indexOf(pos) < 0) visited.push(pos);
    if (visited.indexOf(0) < 0) visited.unshift(0);
    const runMaterials: Record<string, number> = {};
    if (src.runMaterials && typeof src.runMaterials === 'object') {
        const m = src.runMaterials as Record<string, unknown>;
        let keys = 0;
        for (const key of Object.keys(m)) {
            if (keys++ >= 8) break;
            if (!MATERIALS.some((d) => d.id === key)) continue;
            const n = toInt(m[key], 0, 1e9);
            if (n > 0) runMaterials[key] = n;
        }
    }
    return {
        regionId,
        seed,
        supply,
        hp,
        pos,
        visited,
        done: uniqueIds(src.done),
        runMaterials,
        complete: src.complete === true,
        retreat: src.retreat === true,
    };
}
