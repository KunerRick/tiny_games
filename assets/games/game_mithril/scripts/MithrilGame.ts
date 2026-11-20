/**
 * 《秘银远征》主组件 —— 路线图（野外节点图）↔ 节点战斗 两态主循环。
 *
 * 职责：地图点选 → 扣补给 / 判可达 → 编译成 RunPlan 交给纯逻辑核心；
 *       战斗结束把结果写回远征状态（生命延续、材料入档、装备掉落、区域通关）。
 * 场景里只需 Canvas + Camera + GameRoot 挂本组件；Field / Controls / HUD / 面板全部运行时创建。
 *
 * 约定（AGENTS.md 红线）：
 *  - 事件 handler 全部命名方法
 *  - onDestroy 只解绑与清引用，不访问任何 @property 节点
 *  - 固定步长：核心只收到 FIXED_DT，追帧上限 3 步/帧
 *  - .ts 改动后先 project_refresh_assets 再重载预览
 */

import {
    _decorator, Component, EventKeyboard, Game, game, Input, input, KeyCode, Node, UITransform,
} from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager } from '../../../common/managers/StorageManager';
import { COLOR, showTutorialOnce, toast } from '../../../common/ui/GameUIKit';
import {
    FIXED_DT, MithrilWorld, PLAYER_START_X, PLAYER_START_Y, equippedModifiers, mulberry32, profileFromSave,
} from './MithrilCore';
import type { CoreEvent, MithrilInput, MithrilSnapshot } from './MithrilCore';
import {
    addToInventory, addTrinket, bossLoot, bossTrinket, equipStats, firstClearDrop, gluttonyExtraDrop,
    maybeLowerQuality, rollItem, sellPrice, trinketGoldValue, unownedTrinkets,
} from './MithrilLoot';
import {
    chestExtraOptionOf,
    chestHpCostOf,
    extraDropCountOf,
    feastHealOnExtraLoot,
    lowerQualityChanceOf,
} from './MithrilTrinkets';
import {
    SAVE_STORAGE_KEY, addExp, defaultSave, expToNext, facilityLevel, inventoryCapFor, markDungeonCleared,
    maxHpAt, parseSave, pendingVariantCount, queuePendingFirstClear, serializeSave, takePendingFirstClear,
    talentPointsForLevel, talentPointsSpent,
} from './MithrilProgress';
import type { MithrilSave } from './MithrilProgress';
import {
    COMBAT_ILVL_FLOOR, DUNGEON_BOSS_SCRIPTS, DUNGEON_BY_ID, DUNGEON_SLOT_REC,
    FIRST_CLEAR_EXP, GEAR_BASE_BY_ID, GEAR_SLOT_NAMES, GEAR_SLOTS,
    QUALITY_BY_ID,
    REGION_BOSS_BY_ID, REGION_BY_ID, REGIONS, SKILL_BOOK_FIRST_CLEAR, SKILL_BOOK_PER_CLEAR,
    SUPPLY_EXHAUST_HP_PCT, SUPPLY_PER_RUN,
    TRINKET_BY_ID, TRINKET_TAG_NAMES,
    WILD_NODE_COUNT, WILD_REWARDS, dungeonRecMin, materialName, regionMaterialId,
} from './MithrilConfig';
import type { ClassId, EquipItem, RunPlan } from './MithrilConfig';
import {
    WILD_EVENT_OPTIONS, applyWildEvent, buildWildPlan, chargeNodeEntry, chestGold, chestHasTrap, chestTrapDamage,
    createExpedition, enterNode, failExpedition, generateWildMap, grantRunMaterials, isAdjacent, isReachable,
    markNodeDone, nextRegionHint, onlyForwardIsElite,
    nodeById, nodeName, rollNodeMaterials, supplyHeal, wildRng,
} from './MithrilWild';
import type { ExpeditionState, WildEventChoice, WildMap, WildNode } from './MithrilWild';
import { MithrilWildMap } from './MithrilWildMap';
import { MithrilGrowthMenu } from './MithrilGrowthMenu';
import { MithrilCampPanel } from './MithrilCampPanel';
import { MithrilClassSelect } from './MithrilClassSelect';
import { consumeMealBattle, bountySlots } from './MithrilCamp';
import {
    BOUNTY_DAILY_REFRESH_LEVEL, BOUNTY_UNLOCK_LEVEL, applyRunReport, bountyToday, ensureBountyBoard,
    emptyBountyStats,
} from './MithrilBounty';
import type { BountyRunReport } from './MithrilBounty';
import { MithrilAudioUi, playCoreEvents, sfx } from './MithrilAudio';
import { MithrilHud } from './MithrilHud';
import type { SkillKey } from './MithrilHud';
import { MithrilJoystick } from './MithrilJoystick';
import { MithrilMenu } from './MithrilMenu';
import { MithrilRenderer } from './MithrilRenderer';

const { ccclass, property } = _decorator;

/** 每帧最多追的固定步数 */
const MAX_STEPS = 3;
/** HUD 刷新间隔（秒） */
const HUD_REFRESH = 0.1;

/**
 * N209：生命上限是浮点（如 120.60000000000001），直接拼进文案会露 14 位小数。
 * 所有「现生命 / 上限」文本统一走这里，取整口径与地图顶栏、战斗 HUD 一致（四舍五入）。
 */
function hpText(hp: number, maxHp: number): string {
    return `${Math.max(0, Math.round(hp))}/${Math.max(1, Math.round(maxHp))}`;
}

@ccclass('MithrilGame')
export class MithrilGame extends Component {
    @property({ type: MithrilRenderer, tooltip: '渲染层（留空则运行时创建 Field 节点）' })
    renderer: MithrilRenderer | null = null;

    @property({ type: MithrilHud, tooltip: 'HUD（留空则运行时创建）' })
    hud: MithrilHud | null = null;

    @property({ tooltip: '开局随机种子（0 = 用时间戳）' })
    seed = 0;

    /** 浏览器探针用 */
    _core: MithrilWorld | null = null;
    _joystick: MithrilJoystick | null = null;
    _hudRef: MithrilHud | null = null;
    _menuRef: MithrilMenu | null = null;
    _growthRef: MithrilGrowthMenu | null = null;
    _campRef: MithrilCampPanel | null = null;
    _classRef: MithrilClassSelect | null = null;
    _wildMapRef: MithrilWildMap | null = null;
    /** 路线图顶栏的音效开关（战斗中不显示，见 `MithrilAudio.ts` 位置注释） */
    _audioRef: MithrilAudioUi | null = null;
    _save: MithrilSave | null = null;
    _lastSnapshot: MithrilSnapshot | null = null;
    /** 当前界面态：路线图 / 节点战斗 */
    _mode: 'map' | 'combat' = 'map';
    /** 路线图当前预览的区域 id */
    _regionId = '';
    /** 路线图节点图（与 `_regionId` 对应；进行中的远征按存档种子重建） */
    _wildMap: WildMap | null = null;
    /** 正在打的野外节点（null = 非野外战斗） */
    _wildNode: WildNode | null = null;

    private _acc = 0;
    private _hudTimer = 0;
    private _keys = new Set<KeyCode>();
    private _input: MithrilInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
    private _runSeed = 0;
    /** 本局累计收益（结算面板展示用；击杀时已即时写进存档） */
    private _runExp = 0;
    private _runGold = 0;
    /** 本局是否首通（决定副本 BOSS 掉落走固定紫装还是随机保底紫） */
    private _firstClear = true;
    /** 本次进节点因补给耗尽扣掉的生命（结算面板要如实回报，试玩 N41） */
    private _nodeHpCost = 0;
    /** 结算只处理一次（update 每帧都会看到非 playing） */
    private _settled = false;
    /**
     * 首战教学门（试玩 N205）：操作提示还挂着时核心先不推进 ——
     * 新玩家停下来读三行提示的十几秒里，小怪已经贴脸输出，第一把必死。
     * 玩家给出第一次移动 / 攻击输入后解除，同帧照常推进。
     */
    private _introGate = false;
    /** 路线图预览种子（`seed > 0` 时固定，便于复现） */
    private _mapSeed = 1;
    /** 本局开打时全身是否只有白装 / 两个饰品槽是否都空（副本挑战悬赏要在开打前取快照） */
    private _runWhiteOnly = false;
    private _runNoTrinket = false;
    /** 进场景时已跨日刷新过悬赏板 —— 首次打开营地要补一条提示（不然玩家看不到刷新） */
    private _bountyRefreshPending = false;

    onLoad(): void {
        this._save = parseSave(StorageManager.instance.getItem('mithril', SAVE_STORAGE_KEY));
        // 悬赏板（M8）：进游戏先把板补齐（军需官 Lv1 起；Lv4 跨日重置）
        this._bountyRefreshPending = this._syncBountyBoard().refreshed;
        this._ensureField();
        this._ensureControls();
        this._ensureHud();
        this._ensureMenu();
        this._ensureGrowth();
        this._ensureCamp();
        this._ensureWildMap();
        this._ensureClassSelect();
        this._ensureAudio();

        const hud = this._hudRef;
        if (hud) {
            hud.onExit = () => this.exitToLobby();
            hud.onRestart = () => this.onRestartRequested();
            hud.onOpenBag = () => this.openMenu();
            hud.onOpenGrowth = () => this.openGrowth();
            hud.onBackToMap = () => this.onPauseBackToMap();
            hud.onCombatHintDone = () => this.onCombatHintDone();
        }
        const menu = this._menuRef;
        if (menu) {
            menu.onClose = () => this.onMenuClosed();
            menu.onChanged = () => this.onEquipmentChanged();
        }
        const growth = this._growthRef;
        if (growth) {
            growth.onClose = () => this.closeGrowth();
            growth.onChanged = () => this.onGrowthChanged();
        }
        const camp = this._campRef;
        if (camp) {
            camp.onClose = () => this.closeCamp();
            camp.onChanged = () => this.onCampChanged();
        }
        const wild = this._wildMapRef;
        if (wild) {
            wild.onEnterNode = (nodeId: number) => this.onWildNodeTap(nodeId);
            wild.onPrimary = () => this.onWildPrimary();
            wild.onSelectRegion = (regionId: string) => this.onWildRegionTap(regionId);
            wild.onOpenGrowth = () => this.openGrowth();
            wild.onOpenCamp = () => this.openCamp();
            wild.onOpenBag = () => this.openMenu();
            wild.onExit = () => this.exitToLobby();
        }
        const cls = this._classRef;
        if (cls) {
            cls.onPick = (classId) => this.onClassPicked(classId);
            cls.onCancel = () => this.exitToLobby();
        }

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        game.on(Game.EVENT_HIDE, this.onGameHide, this);

        this._mapSeed = this.seed > 0 ? (this.seed & 0x7fffffff) : (Date.now() & 0x7fffffff);
        if (this._save) {
            showTutorialOnce(this.node, 'mithril', '路线图点金色高亮圈启程 · 按住右下最大的键持续攻击 · 右上角「?」可重看操作', 4.2);
            this._enterMapMode();
        } else {
            // 首次进入：先选职业。战斗层与路线图都先收起来，避免玩家透过面板点到摇杆
            this._setWorldVisible(false);
            this._wildMapRef?.hide();
            this._classRef?.open();
        }
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        game.off(Game.EVENT_HIDE, this.onGameHide, this);
        this._core = null;
        this._joystick = null;
        this._hudRef = null;
        this._menuRef = null;
        this._growthRef = null;
        this._campRef = null;
        this._wildMapRef = null;
        this._audioRef = null;
        this._save = null;
        this._lastSnapshot = null;
        this._wildMap = null;
        this._wildNode = null;
        this._keys.clear();
        const g = globalThis as unknown as { __mithrilAudio?: unknown };
        if (g.__mithrilAudio === sfx) g.__mithrilAudio = undefined;
    }

    update(dt: number): void {
        // 路线图态没有核心，也不推时间
        if (this._mode === 'map') return;
        const core = this._core;
        if (!core) return;
        // 面板打开时整局冻结：不推进核心、不刷 HUD（面板自己管显示）
        const menuOpen = this._menuRef && this._menuRef.isOpen();
        const growthOpen = this._growthRef && this._growthRef.isOpen();
        const campOpen = this._campRef && this._campRef.isOpen();
        if (menuOpen || growthOpen || campOpen) return;
        // 暂停层（E4）：整局冻结，核心与计时器都不推进
        if (this._hudRef && this._hudRef.isPaused()) return;

        // 切后台回来 / 长卡顿时 dt 可能是 NaN 或巨大值：
        // NaN 会永久污染 _acc（`_acc >= FIXED_DT` 恒假且再也不会回正），巨大值会让蓄积步数无限涨。
        // 非有限值整帧丢弃；累加器封顶在 MAX_STEPS 步，卡顿后最多补 3 帧，不追旧账。
        if (!Number.isFinite(dt) || dt <= 0) return;
        // 输入：摇杆 + 键盘（桌面调试）
        this._buildInput();
        // 首战教学门（N205）：提示卡还在时敌人先不动。任何移动 / 技能输入都算「我准备好了」，
        // 同帧解除、照常推进 —— 读提示的十几秒不再白掉一条命。
        if (this._introGate) {
            if (!this._hasInputIntent()) {
                this._acc = 0;
                return;
            }
            this._introGate = false;
            this._hudRef?.releaseCombatHintGate();
        }
        this._acc = Math.min(this._acc + Math.min(dt, 0.1), MAX_STEPS * FIXED_DT);
        let steps = 0;
        while (this._acc >= FIXED_DT && steps < MAX_STEPS) {
            core.step(FIXED_DT, this._input);
            this._acc -= FIXED_DT;
            steps++;
            if (core.phase !== 'playing') {
                this._acc = 0;
                break;
            }
        }

        const events = core.drainEvents();
        // 音效（M10）：只读事件，节流在 GameAudio 的配方表里
        playCoreEvents(events);
        // 击杀的金币 / 经验在事件里，先进存档再结算（结算面板要显示本局收益）
        this._onCoreEvents(events);
        const snap = core.snapshot();
        this._lastSnapshot = snap;
        // 结算必须在 HUD 刷结果面板之前：掉落行要随结果面板一起出现
        if (snap.phase !== 'playing' && !this._settled) this._settle(snap.phase === 'won');
        if (this.renderer) {
            this.renderer.onEvents(events);
            this.renderer.render(snap, dt);
        }
        const hud = this._hudRef;
        if (hud) {
            hud.onEvents(events);
            this._hudTimer += dt;
            if (this._hudTimer >= HUD_REFRESH || snap.phase !== 'playing') {
                this._hudTimer = 0;
                this._refreshGrowthHud();
                hud.updateHud(snap);
            }
        }
    }

    // ==================== 路线图（野外节点图） ====================

    private _ensureMapFor(regionId: string): void {
        const exp = this._save ? this._save.expedition : null;
        const id = REGION_BY_ID[regionId] ? regionId : REGIONS[0].id;
        // 进行中的远征按存档种子重建，保证退出重进是同一张图
        const seed = exp && exp.regionId === id ? exp.seed : this._mapSeed;
        this._wildMap = generateWildMap(id, seed);
        this._regionId = this._wildMap.regionId;
    }

    /**
     * N190：一趟远征结束（放弃 / 阵亡 / 通关）后换一张图。
     * 出发时直接用 `_mapSeed` 保证「预览图 == 远征图」；若之后不换种子，
     * 同一会话里每次重开都是同一张图，规划乐趣会消失。
     * 用 LCG 而不是 `Date.now()`，保证同一次构建里可复现。
     */
    private _rotateMapSeed(): void {
        this._mapSeed = ((Math.imul(this._mapSeed, 1664525) + 1013904223) >>> 0) & 0x7fffffff;
        if (this._mapSeed <= 0) this._mapSeed = 1;
    }

    private _defaultRegionId(): string {
        const level = this._save ? this._save.level : 1;
        let id = REGIONS[0].id;
        for (const r of REGIONS) if (level >= r.levelMin) id = r.id;
        return id;
    }

    /** 回到路线图：清掉核心与战斗态，重建/刷新节点图 */
    private _enterMapMode(): void {
        const save = this._save;
        if (!save) return;
        this._menuRef?.close();
        this._growthRef?.close();
        this._campRef?.close();
        this._mode = 'map';
        this._core = null;
        this._lastSnapshot = null;
        this._wildNode = null;
        this._settled = true;
        this._introGate = false;
        this._nodeHpCost = 0;
        this._acc = 0;
        this._hudTimer = 0;
        this._input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
        this._keys.clear();
        this._joystick?.release();
        this._hudRef?.releaseAllHeld();
        this._hudRef?.resetForNewRun();
        this._setWorldVisible(false);

        const exp = save.expedition;
        // 等级 / 装备变了以后旧远征的血量可能超过新上限：夹一次，别让地图出现 200/168
        if (exp) {
            const profile = profileFromSave(save, COMBAT_ILVL_FLOOR);
            exp.hp = Math.max(1, Math.min(profile.maxHp, Math.round(exp.hp)));
        }
        const regionId = exp && REGION_BY_ID[exp.regionId]
            ? exp.regionId
            : (REGION_BY_ID[this._regionId] ? this._regionId : this._defaultRegionId());
        this._ensureMapFor(regionId);
        this._wildMapRef?.show();
        this._applyMapHint();
    }

    /** 战斗层（Field / Controls / HUD）整组显隐，避免地图态下技能键还能被点到 */
    private _setWorldVisible(visible: boolean): void {
        if (this.renderer) this.renderer.node.active = visible;
        const controls = this.node.getChildByName('Controls');
        if (controls) controls.active = visible;
        const hud = this._hudRef;
        if (hud) hud.node.active = visible;
    }

    private _refreshMap(hint?: string, warn = false): void {
        const wild = this._wildMapRef;
        const save = this._save;
        if (!wild || !save || !this._wildMap) return;
        const profile = profileFromSave(save, COMBAT_ILVL_FLOOR);
        const exp = save.expedition;
        wild.refresh({
            map: this._wildMap,
            expedition: exp,
            regionId: this._regionId,
            playerLevel: save.level,
            maxHp: profile.maxHp,
            hp: exp ? exp.hp : profile.maxHp,
            materials: save.materials,
            cleared: save.regionsCleared,
            // 试玩 N142：首领节点副标题要写「已装备 n/8 槽」，否则 avg 18.0 会被读成远超推荐装等
            equippedSlots: equipStats(save.equips).equipped,
            slotTotal: GEAR_SLOTS.length,
        });
        if (hint !== undefined) wild.setHint(hint, warn);
    }

    /** 刷新常驻提示（含「前方只有精英」的警示色，试玩 N151） */
    private _applyMapHint(): void {
        this._refreshMap(this._mapHint(), this._mapHintIsDanger());
    }

    /**
     * 当前是否「唯一前进边是精英 / 首领」。
     * 只有这种情况才在常驻行提醒「退回起点换支路」——普通地图不污染提示行。
     */
    private _mapHintIsDanger(): boolean {
        const save = this._save;
        const exp = save ? save.expedition : null;
        if (!save || !exp || !this._wildMap || exp.complete) return false;
        // 停在未结算节点时提示是「点白圈续开」，不该叠加回退提示
        if (exp.pos !== 0 && exp.done.indexOf(exp.pos) < 0) return false;
        return onlyForwardIsElite(this._wildMap, exp);
    }

    private _mapHint(): string {
        const save = this._save;
        if (!save) return '';
        const exp = save.expedition;
        if (exp) {
            // 刷新 / 意外退出会停在「进了节点但内容没结算」的状态：提示直接续开
            if (exp.pos !== 0 && exp.done.indexOf(exp.pos) < 0) {
                // 主动撤离（暂停层 / 切后台）会置 retreat：再点当前节点是新挑战，要重新付入场消耗
                return exp.retreat
                    ? '上次的战斗未结算：点当前节点重新挑战（会再扣一次入场消耗）'
                    : '上次的节点还没结算：点当前节点（白圈）把内容接上';
            }
            // 试玩 N151：面对精英墙时，玩家此前在四处界面都看不到「可以退回起点换支路」。
            // 这不是提示不够详细，而是唯一解法不可见；只在这条路真的走不通时出现。
            if (this._mapHintIsDanger()) {
                return `已清理 ${exp.done.length}/${WILD_NODE_COUNT} · 前方只有精英/首领：点蓝圈退回起点换支路（不耗补给）`;
            }
            const supplyNote = exp.supply <= 0 ? ' · 补给耗尽：下一节点按 8% 生命扣血' : '';
            return `已清理 ${exp.done.length}/${WILD_NODE_COUNT} · 点金圈继续 · 蓝圈回已清理节点${supplyNote}`;
        }
        const region = REGION_BY_ID[this._regionId] || REGIONS[0];
        if (save.level < region.levelMin) {
            return `等级不足：${region.name} 需要 Lv${region.levelMin}（当前 Lv${save.level}）`;
        }
        return '点「开始远征」，沿金色连线选下一站';
    }

    private onRestartRequested(): void {
        if (this._mode === 'combat') {
            this._returnToMap();
            return;
        }
        this._enterMapMode();
    }

    private _returnToMap(): void {
        const hud = this._hudRef;
        if (hud) {
            hud.setRewardLines([]);
            hud.setLootItems([]);
            hud.setPostLootLines([]);
        }
        this._enterMapMode();
    }

    private onWildRegionTap(regionId: string): void {
        sfx.play('click');
        const save = this._save;
        if (!save) return;
        const region = REGION_BY_ID[regionId];
        if (!region) return;
        const exp = save.expedition;
        if (exp) {
            if (exp.regionId === regionId) {
                // 点回当前页签：恢复与当前区域相关的提示，别让上一条提示粘住（试玩 N43）
                this._applyMapHint();
                return;
            }
            const running = REGION_BY_ID[exp.regionId] || region;
            const levelNote = save.level < region.levelMin
                ? `；${region.name} 还需 Lv${region.levelMin}（当前 Lv${save.level}）`
                : '';
            this._refreshMap(`远征进行中（${running.name}）：完成或放弃后才能换区域${levelNote}`);
            return;
        }
        if (save.level < region.levelMin) {
            this._refreshMap(`等级不足：${region.name} 需要 Lv${region.levelMin}（当前 Lv${save.level}）`);
            return;
        }
        this._ensureMapFor(regionId);
        this._refreshMap('点「开始远征」后沿金色连线选下一站；走不通可点蓝圈退回起点换支路');
    }

    private onWildPrimary(): void {
        sfx.play('click');
        const save = this._save;
        const wild = this._wildMapRef;
        if (!save || !wild) return;
        const exp = save.expedition;
        if (exp) {
            const lost = this._materialSummary(exp.runMaterials);
            wild.showConfirm('放弃远征', [
                '放弃后本次远征立即结束。',
                lost ? `将丢失本程材料：${lost}` : '本程还没有拾取材料。',
                '已获得的装备、经验与等级保留。',
            ], '放弃', () => this._abandonExpedition());
            return;
        }
        const region = REGION_BY_ID[this._regionId];
        if (!region) return;
        if (save.level < region.levelMin) {
            this._refreshMap(`等级不足：${region.name} 需要 Lv${region.levelMin}`);
            return;
        }
        const profile = profileFromSave(save, COMBAT_ILVL_FLOOR);
        // N190：出发必须落在玩家正看着的那张图上。预览图由 `_mapSeed` 生成
        // （`_ensureMapFor` 无远征时用 `_mapSeed`），这里若另外摇种子，
        // `_ensureMapFor` 会换成另一张图——拓扑相同、节点种类互换，玩家按预览
        // 规划的路线必然踩空。远征结束后由 `_rotateMapSeed()` 换图。
        const seed = this._mapSeed;
        save.expedition = createExpedition(region.id, seed, profile.maxHp);
        this._ensureMapFor(region.id);
        this._persist();
        this._refreshMap('已出发：点第一层任意节点');
    }

    private _abandonExpedition(): void {
        const save = this._save;
        const exp = save ? save.expedition : null;
        if (!save || !exp) return;
        const lost = failExpedition(exp);
        const text = this._applyMaterialLoss(save, lost);
        save.expedition = null;
        this._rotateMapSeed();
        this._persist();
        this._ensureMapFor(this._regionId);
        this._refreshMap(text ? `已放弃远征，丢失 ${text}` : '已放弃远征');
    }

    private _materialSummary(mats: Record<string, number>): string {
        const parts: string[] = [];
        const src = mats || {};
        for (const key of Object.keys(src)) {
            const n = Math.max(0, Math.floor(src[key] || 0));
            if (n > 0) parts.push(`${materialName(key)} ×${n}`);
        }
        return parts.join('，');
    }

    /** 从存档扣掉丢失的材料，返回「名称 ×N」摘要 */
    private _applyMaterialLoss(save: MithrilSave, lost: Record<string, number>): string {
        const parts: string[] = [];
        const src = lost || {};
        for (const key of Object.keys(src)) {
            const n = Math.max(0, Math.floor(src[key] || 0));
            if (n <= 0) continue;
            save.materials[key] = Math.max(0, Math.floor(save.materials[key] || 0) - n);
            parts.push(`${materialName(key)} ×${n}`);
        }
        return parts.join('，');
    }

    // ==================== 节点交互 ====================

    private onWildNodeTap(nodeId: number): void {
        // 点节点先给一声：不管这次能不能走（提示文字同时在底部说明原因）
        sfx.play('click');
        const save = this._save;
        const map = this._wildMap;
        if (!save || !map) return;
        const exp = save.expedition;
        if (!exp) {
            // 试玩 N207：阵亡 / 放弃后地图节点仍是高亮样子，点下去原来只改底部小字，
            // 玩家的第一反应是「点了没反应」。给一次明确提示，并指到唯一有效入口。
            toast(this.node, '本次远征已结束：先点下方「开始远征」再出发', 1.8);
            this._refreshMap('本次远征已结束：先点下方「开始远征」再出发', true);
            return;
        }
        const node = nodeById(map, nodeId);
        if (!node) return;

        // 试玩 N174：走不到的节点此前只有底部提示，而提示行本来就常驻同一句文案，
        // 点下去看起来「毫无反应」——玩家分不清是点偏了还是去不了。给一次明确的轻提示。
        if (node.kind !== 'start' && node.id !== exp.pos && exp.done.indexOf(node.id) < 0
            && !isAdjacent(map, exp, node.id)) {
            toast(this.node, '这个节点走不到：只能点金色高亮圈连着的相邻节点', 1.6);
            this._refreshMap('这个节点走不到：只能点金色高亮圈连着的相邻节点（蓝圈已清理节点可回退）', true);
            return;
        }

        // 战斗类节点先确认能编译出内容，再扣补给 —— 免得白扣
        const combat = node.kind === 'battle' || node.kind === 'elite'
            || node.kind === 'boss' || node.kind === 'dungeon';
        let plan: RunPlan | null = null;
        if (combat) {
            plan = buildWildPlan(map, node);
            if (!plan) {
                this._refreshMap('这个节点暂时没有可打的内容');
                return;
            }
        }

        // 副本新进入先出确认卡（E2）：装等区间 / 机制 / 首通奖励 / 消耗，
        // 点了「进入」才扣补给 —— 之前一点即进，Lv4 撞 ilvl16 的教堂毫无提示。
        if (node.kind === 'dungeon' && node.dungeonId && !exp.complete
            && node.id !== exp.pos
            && isReachable(map, exp, node.id)
            && exp.done.indexOf(node.id) < 0) {
            this._confirmDungeon(node);
            return;
        }

        // 试玩 N175：精英 / 首领此前一击即入，精英圈与普通节点长得一样，玩家没有任何
        // 「打不打得过 / 这一下会不会终结远征」的信号。与副本同一套确认卡，低于掉落档时警告。
        if ((node.kind === 'elite' || node.kind === 'boss')
            && node.id !== exp.pos && exp.done.indexOf(node.id) < 0 && plan) {
            this._confirmDangerNode(node, plan);
            return;
        }
        this._enterWildNode(node, plan);
    }

    /** 进节点的公共后半段：扣补给 / 生命，按节点类型开内容 */
    private _enterWildNode(node: WildNode, plan: RunPlan | null): void {
        const save = this._save;
        const map = this._wildMap;
        const exp = save ? save.expedition : null;
        if (!save || !map || !exp) {
            this._refreshMap();
            return;
        }
        const maxHp = profileFromSave(save, COMBAT_ILVL_FLOOR).maxHp;
        const res = enterNode(map, exp, node.id, maxHp);
        if (!res.ok) {
            let text = '远征已结束，请重新开始';
            if (res.reason === 'not_reachable') text = '只能走金色高亮连线连着的相邻节点（蓝圈已清理节点可回退，不耗补给）';
            else if (res.reason === 'done') text = '该节点已清理，不能重复进入（相邻的已清理节点可以路过）';
            // 走不通是最需要被看见的时刻：用警示色，不要读成一句普通说明（试玩 N151）
            this._refreshMap(text, res.reason === 'not_reachable');
            return;
        }
        // 中途主动离开后再点当前节点（试玩 N66）：不免费续开，而是新一次挑战，重新扣入场消耗。
        // 离开时生命已落盘（见 _commitCombatExit），所以撤离不能当成免费回血；
        // 不重新收费的话可以「打几只 → 回地图 → 再进」无限刷击杀金币 / 经验。
        let hpCost = res.hpCost;
        const combatNode = node.kind === 'battle' || node.kind === 'elite'
            || node.kind === 'boss' || node.kind === 'dungeon';
        if (res.reason === 'resume' && exp.retreat && combatNode) {
            exp.retreat = false;
            const again = chargeNodeEntry(exp, maxHp);
            hpCost += again.hpCost;
            if (again.dead) {
                this._persist();
                this._expeditionDown('补给耗尽，倒在了路上', []);
                return;
            }
        }
        this._persist();
        if (res.dead) {
            this._expeditionDown('补给耗尽，倒在了路上', []);
            return;
        }
        if (res.reason === 'transit') {
            this._refreshMap('已清理的节点：可以路过，奖励不会重复');
            return;
        }
        if (node.kind === 'start') {
            this._refreshMap('回到起点：金色高亮圈进新节点，蓝圈可路过已清理节点');
            return;
        }

        // 进节点时补给 / 生命已经变了，先把顶栏读数刷新到位再开内容弹窗（试玩 N49）
        this._refreshMap();

        switch (node.kind) {
            case 'chest':
                this._openChest(node, hpCost);
                return;
            case 'event':
                this._openEvent(node, hpCost);
                return;
            case 'supply':
                this._resolveSupply(node, maxHp, hpCost);
                return;
            default:
                if (plan) this._beginNodeCombat(node, plan, hpCost);
                else this._refreshMap();
                return;
        }
    }

    /**
     * 副本入口确认卡（体验官 E2）：标签写的是「装等 1-10 / 10-16」，
     * 但玩家点进来之前看不到机制、首通和消耗，也不知道自己装等够不够。
     */
    private _confirmDungeon(node: WildNode): void {
        const wild = this._wildMapRef;
        const save = this._save;
        const map = this._wildMap;
        const exp = save ? save.expedition : null;
        const def = node.dungeonId ? DUNGEON_BY_ID[node.dungeonId] : null;
        if (!wild || !save || !map || !exp || !def) return;
        const plan = buildWildPlan(map, node);
        const st = equipStats(save.equips);
        const cur = st.ilvl;
        // 试玩 N177（round34 数值拍 C）：区间「1–10」被读成官方许可，但真实门槛是
        // 「槽数 ≥3 且会躲机制」——同是 ilvl3，2 槽 0/24、8 槽 17/24；槽数比装等更能
        // 预测成败。下界改成可胜性点估计；口径源统一在 `MithrilConfig.dungeonRecMin()`，
        // 地图副标 / 阵亡归因与这里必须同一句话（N189）。
        const recMin = dungeonRecMin(def);
        const underIlvl = cur + 0.05 < recMin;
        const underSlots = st.equipped < DUNGEON_SLOT_REC;
        const under = underIlvl || underSlots;
        const cleared = save.dungeonsCleared.indexOf(def.id) >= 0;
        // 首领机制比阶段名更能指导操作：玩家看「砸地 AoE」并不知道要走出去（N177）。
        const bossScript = DUNGEON_BOSS_SCRIPTS[def.id];
        const movePhase = bossScript ? bossScript.phases.filter((p) => p.mechanic === 'move')[0] : null;
        const lines = [
            // 试玩 N138：平均装等只按已装备槽算，2 件高装等会显示成 18.0，
            // 玩家会拿它和「推荐 12」直接比。槽数必须同屏写出来。
            `建议：平均装等 ≥${recMin} · 装备 ≥${DUNGEON_SLOT_REC}/8 槽`,
            `当前：平均装等 ${cur.toFixed(1)} · 已装备 ${st.equipped}/8 槽`,
        ];
        if (movePhase) {
            lines.push(`首领机制：${movePhase.name} —— ${movePhase.desc}（${bossScript.moveWarn} 秒预警）`);
        }
        lines.push(`阶段：${def.phases.map((p) => p.name).join(' → ')}`);
        lines.push(cleared
            ? '已通关：本次没有首通奖励（仍掉副本装备与技能书）'
            : `首通奖励：经验 +${FIRST_CLEAR_EXP} · 技能书 +${SKILL_BOOK_FIRST_CLEAR} · 一件紫装`);
        if (under) {
            const bits: string[] = [];
            if (underIlvl) bits.push(`平均装等低于建议 ${recMin}`);
            if (underSlots) bits.push(`只装备 ${st.equipped}/8 槽（建议 ≥${DUNGEON_SLOT_REC}）`);
            lines.push(`警告：${bits.join(' · ')}，建议先清野外节点`);
        } else {
            lines.push('难度：与节点等级无关，按副本装等固定结算');
        }
        const maxHp = profileFromSave(save, COMBAT_ILVL_FLOOR).maxHp;
        if (exp.supply > 0) {
            // 试玩 N166：确认卡是「按下之前」的界面，用完成时会读成「现在已经耗尽 / 已经扣了」
            lines.push(`进入时：补给 −1（当前 ${exp.supply}/${SUPPLY_PER_RUN}）· 阵亡会丢失本程材料`);
        } else {
            const cost = Math.max(1, Math.round(maxHp * SUPPLY_EXHAUST_HP_PCT));
            lines.push(`进入时：补给已耗尽 →生命 −${cost}（${Math.round(SUPPLY_EXHAUST_HP_PCT * 100)}% 上限）`);
        }
        wild.showConfirm(def.name, lines, '进入副本',
            () => this._enterWildNode(node, plan),
            under ? COLOR.DANGER : COLOR.PRIMARY);
    }

    /**
     * 精英 / 首领节点的进场确认（试玩 N175）。
     * 普通战斗仍是一击即入；精英与首领是「打不过就会终结整趟远征」的门槛，
     * 必须先把节点档位、当前装等和进场消耗摆出来。低于掉落档时用警示色。
     */
    private _confirmDangerNode(node: WildNode, plan: RunPlan): void {
        const wild = this._wildMapRef;
        const save = this._save;
        const exp = save ? save.expedition : null;
        if (!wild || !save || !exp) return;
        const st = equipStats(save.equips);
        const cur = st.ilvl;
        const under = cur + 0.05 < node.ilvl;
        const kindName = node.kind === 'boss' ? '区域首领' : '精英';
        const lines = [
            `节点等级 Lv${node.level} · 该节点掉落装等 ${node.ilvl}`,
            // 与副本确认同一口径：平均装等只按已装备槽算，槽数必须同屏（试玩 N138）
            `当前平均装等 ${cur.toFixed(1)}（${st.equipped}/8 槽）`,
            `${kindName}战：敌人更强，建议状态好再进`,
            under
                ? `警告：装等低于该节点掉落档 ${node.ilvl}，建议先清普通节点或练级`
                : '难度：装等与节点档位相当，可正常挑战',
        ];
        const maxHp = profileFromSave(save, COMBAT_ILVL_FLOOR).maxHp;
        if (exp.supply > 0) {
            // 试玩 N166：确认卡是「按下之前」的界面，用完成时会读成「现在已经耗尽 / 已经扣了」
            lines.push(`进入时：补给 −1（当前 ${exp.supply}/${SUPPLY_PER_RUN}）· 阵亡会丢失本程材料`);
        } else {
            const cost = Math.max(1, Math.round(maxHp * SUPPLY_EXHAUST_HP_PCT));
            lines.push(`进入时：补给已耗尽 →生命 −${cost}（${Math.round(SUPPLY_EXHAUST_HP_PCT * 100)}% 上限）`);
        }
        wild.showConfirm(plan.name || `${kindName}节点`, lines, under ? '仍然开打' : '开打',
            () => this._enterWildNode(node, plan),
            under ? COLOR.DANGER : COLOR.PRIMARY);
    }

    private _openChest(node: WildNode, hpCost: number): void {
        const wild = this._wildMapRef;
        if (!wild) return;
        const extra = this._save ? chestExtraOptionOf(this._save.trinkets) : false;
        wild.showChest(
            node, hpCost,
            () => this._resolveChest(node, true, hpCost, false),
            () => this._resolveChest(node, false, hpCost, false),
            extra
                ? { label: '额外搜刮', onTap: () => this._resolveChest(node, true, hpCost, true) }
                : undefined,
        );
    }

    private _resolveChest(node: WildNode, opened: boolean, hpCost: number, extra = false): void {
        const save = this._save;
        const exp = save ? save.expedition : null;
        if (!save || !exp) {
            this._refreshMap();
            return;
        }
        if (!opened) {
            sfx.play('click');
            markNodeDone(exp, node.id);
            this._persist();
            this._refreshMap('你绕开了那个箱子');
            return;
        }
        const maxHp = profileFromSave(save, COMBAT_ILVL_FLOOR).maxHp;
        const lines: string[] = [];
        if (chestHasTrap(node)) {
            const dmg = chestTrapDamage(maxHp);
            exp.hp = Math.max(0, exp.hp - dmg);
            sfx.play('playerHit');
            lines.push(`锁扣弹开：失去 ${Math.round(dmg)} 生命（${hpText(exp.hp, maxHp)}）`);
        }
        const gold = chestGold(node);
        save.gold = Math.max(0, Math.floor(save.gold || 0) + gold);
        sfx.play('coin');
        lines.push(`金币 +${gold}`);
        // 贪婪之眼的降档概率与额外件数只在这里读一次，保证同一节点内口径一致
        const lowerChance = lowerQualityChanceOf(save.trinkets);
        const rng = wildRng((node.seed ^ 0x9e37) >>> 0);
        const item = rollItem(rng, { ilvl: node.ilvl, classId: save.classId, minQuality: 'uncommon' });
        if (item) {
            maybeLowerQuality(rng, item, lowerChance);
            const label = this._grantItem(save, item, [], lines, undefined, rng);
            if (label) lines.push(`获得装备：${label}`);
        }
        // 拾荒者背包：额外搜刮一件，代价是最大生命 5%（饕餮协同会把这口血补回来一部分）
        if (extra) {
            const cost = Math.max(1, Math.round(maxHp * chestHpCostOf(save.trinkets)));
            exp.hp = Math.max(0, exp.hp - cost);
            lines.push(`拾荒者背包：额外搜刮失去 ${cost} 生命（${hpText(exp.hp, maxHp)}）`);
            const bonus = rollItem(rng, { ilvl: node.ilvl, classId: save.classId, minQuality: 'uncommon' });
            if (bonus) {
                maybeLowerQuality(rng, bonus, lowerChance);
                const label = this._grantItem(save, bonus, [], lines, undefined, rng);
                if (label) lines.push(`拾荒者背包 · 额外获得：${label}`);
            }
            const heal = feastHealOnExtraLoot(save.trinkets, maxHp);
            if (heal > 0) {
                const before = exp.hp;
                exp.hp = Math.min(maxHp, exp.hp + Math.round(heal));
                if (exp.hp > before) lines.push(`饕餮：额外掉落回复 ${Math.round(exp.hp - before)} 生命`);
            }
        }
        markNodeDone(exp, node.id);
        this._persist();
        if (exp.hp <= 0) {
            this._expeditionDown('宝箱的陷阱太狠了', lines);
            return;
        }
        // 扣血已生效：弹窗开着时顶栏也要显示扣完的生命（试玩 N49）
        this._refreshMap();
        this._wildMapRef?.showMessage('宝箱', lines, () => {
            this._refreshMap(`宝箱已开 · 生命 ${hpText(exp.hp, maxHp)}`);
        });
    }

    private _openEvent(node: WildNode, hpCost: number): void {
        const wild = this._wildMapRef;
        if (!wild) return;
        wild.showEvent(
            node, WILD_EVENT_OPTIONS, hpCost,
            (choice: WildEventChoice) => this._resolveEvent(node, choice, hpCost),
        );
    }

    private _resolveEvent(node: WildNode, choice: WildEventChoice, hpCost: number): void {
        const save = this._save;
        const exp = save ? save.expedition : null;
        if (!save || !exp) {
            this._refreshMap();
            return;
        }
        const maxHp = profileFromSave(save, COMBAT_ILVL_FLOOR).maxHp;
        const res = applyWildEvent(exp, choice, maxHp);
        // 事件结果：掉血用挨打音（带震动），其余算拾取
        sfx.play(res.hpDelta < 0 ? 'playerHit' : 'pickup');
        const matId = regionMaterialId(exp.regionId);
        const lines: string[] = [];
        if (hpCost > 0) lines.push(`补给耗尽：进入节点失去 ${Math.round(hpCost)} 生命（现 ${hpText(exp.hp, maxHp)}）`);
        if (res.materialDelta > 0) {
            // 事件材料同样「先入档、计入本程」，死亡时按本程扣除
            save.materials[matId] = Math.max(0, Math.floor(save.materials[matId] || 0)) + res.materialDelta;
            lines.push(`${materialName(matId)} +${res.materialDelta}（现有 ${save.materials[matId]}）`);
        }
        if (res.hpDelta > 0) lines.push(`生命 +${Math.round(res.hpDelta)}（${hpText(exp.hp, maxHp)}）`);
        else if (res.hpDelta < 0) lines.push(`失去 ${Math.round(-res.hpDelta)} 生命（${hpText(exp.hp, maxHp)}）`);
        markNodeDone(exp, node.id);
        this._persist();
        if (res.dead) {
            this._expeditionDown('伤势太重，倒在了路上', lines);
            return;
        }
        // 扣血已生效：弹窗开着时顶栏也要显示扣完的生命（试玩 N49）
        this._refreshMap();
        this._wildMapRef?.showMessage('事件结果', lines, () => {
            this._refreshMap(`事件已处理 · 生命 ${hpText(exp.hp, maxHp)}`);
        });
    }

    private _resolveSupply(node: WildNode, maxHp: number, hpCost: number): void {
        const save = this._save;
        const exp = save ? save.expedition : null;
        if (!save || !exp) {
            this._refreshMap();
            return;
        }
        const heal = supplyHeal(maxHp, exp.hp);
        exp.hp = Math.max(0, Math.min(maxHp, exp.hp + heal));
        sfx.play('pickup');
        markNodeDone(exp, node.id);
        this._persist();
        // 治疗已生效：弹窗开着时顶栏也要显示治完的生命（试玩 N49）
        this._refreshMap();
        const lines: string[] = ['你在这里生火、包扎，歇了一口气。'];
        if (hpCost > 0) lines.push(`补给耗尽：进入节点失去 ${Math.round(hpCost)} 生命`);
        const healText = Math.round(heal);
        const netText = Math.round(heal - hpCost);
        lines.push(heal > 0
            ? `治疗 +${healText}（${hpText(exp.hp, maxHp)}）${hpCost > 0 ? `　净变化 ${netText >= 0 ? '+' : ''}${netText}` : ''}`
            : `生命已满（${hpText(exp.hp, maxHp)}）`);
        // 试玩 N186：节点叫「篝火」时玩家会默认它补补给（内部 kind=supply），
        // 文案自洽但与直觉冲突。改叫「篝火·回血」，标题与图例、节点名保持同一叫法。
        lines.push('这里只恢复生命，不补充补给。进度已记录：退出游戏后可以从当前节点继续。');
        this._wildMapRef?.showMessage('篝火·回血', lines, () => this._refreshMap('休整完毕，继续前进'));
    }

    /** 路线图上的死亡（补给耗尽 / 陷阱 / 事件）：丢材料、清远征，弹窗告知 */
    private _expeditionDown(reason: string, extra: string[]): void {
        const save = this._save;
        const exp = save ? save.expedition : null;
        if (!save || !exp) {
            this._enterMapMode();
            return;
        }
        const lost = failExpedition(exp);
        const lostText = this._applyMaterialLoss(save, lost);
        save.expedition = null;
        this._rotateMapSeed();
        this._persist();
        const lines = [reason];
        lines.push(lostText ? `丢失本程材料：${lostText}` : '本次还没有拾取材料。');
        lines.push('装备、经验与等级保留。');
        this._wildMapRef?.showMessage('远征失败', lines.concat(extra), () => {
            this._ensureMapFor(this._regionId);
            this._refreshMap('从起点重新出发吧');
        });
    }

    /** 进节点战斗：生命从远征当前值接着走 */
    private _beginNodeCombat(node: WildNode, plan: RunPlan, hpCost: number): void {
        const save = this._save;
        const exp = save ? save.expedition : null;
        if (!save || !exp) {
            this._enterMapMode();
            return;
        }
        const profile = profileFromSave(save, COMBAT_ILVL_FLOOR);
        const seed = this.seed > 0
            ? ((this.seed ^ ((node.id + 1) * 7919)) >>> 0)
            : (Date.now() & 0x7fffffff);
        // 饰品（M7）：两个饰品槽 + 协同效果由战斗内核自行结算
        const core = new MithrilWorld(profile, seed, save.trinkets);
        core.startWild(plan, Math.max(1, Math.round(exp.hp)));
        this._core = core;
        this._mode = 'combat';
        this._wildNode = node;
        this._runSeed = seed;
        this._runExp = 0;
        this._runGold = 0;
        this._firstClear = node.kind === 'dungeon' && !!node.dungeonId
            && save.dungeonsCleared.indexOf(node.dungeonId) < 0;
        this._nodeHpCost = Math.max(0, Math.floor(hpCost || 0));
        // 悬赏挑战（M8）：这两个条件必须在开打前取快照 —— 打完拿到装备就不算「只用白装」
        this._runWhiteOnly = this._isWhiteOnlyEquipped(save);
        this._runNoTrinket = !save.trinkets || (!save.trinkets[0] && !save.trinkets[1]);
        this._settled = false;
        this._acc = 0;
        this._hudTimer = 0;
        this._input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
        this._keys.clear();
        this._joystick?.release();
        this._hudRef?.releaseAllHeld();

        const hud = this._hudRef;
        if (hud) {
            hud.setResultMode({
                winTitle: node.kind === 'boss' ? '远征完成' : node.kind === 'dungeon' ? '副本通关' : '节点肃清',
                winLine: node.kind === 'boss' ? `${nodeName(node)}已击败` : `${nodeName(node)}已肃清`,
                loseTitle: '你倒下了',
                againLabel: '返回路线图',
            });
            hud.resetForNewRun();
            hud.setLootItems([]);
            hud.setRewardLines([]);
        }
        this._wildMapRef?.hide();
        this._setWorldVisible(true);
        this.renderer?.resetView();
        const snap = core.snapshot();
        this._lastSnapshot = snap;
        this.renderer?.render(snap, 0);
        this._refreshGrowthHud();
        hud?.updateHud(snap);
        // 首战操作引导（E1）：不写进 once-only toast —— 玩家真学会（3 击杀 / 按住 1 秒）才关，
        // 在那之前每场战斗开头都会再出现一次。
        // 试玩 N205：提示出现时开教学门 —— 敌人在玩家第一次操作前不动，
        // 读提示的十几秒不再以「0 击杀阵亡」收场。
        if (hud && !save.combatHintDone) {
            hud.showCombatHint(true);
            this._introGate = true;
        }
    }

    /** 全身装备是否只有白装（空槽允许）：副本挑战悬赏「仅用白装」用 */
    private _isWhiteOnlyEquipped(save: MithrilSave): boolean {
        for (const slot of GEAR_SLOTS) {
            const item = save.equips ? save.equips[slot] : null;
            if (item && item.quality !== 'common') return false;
        }
        return true;
    }

    /**
     * 发一件装备：成功返回「品质·名称（槽位 装等）」标签并入包；
     * 背包满则折金币、把提示写进 notes 并返回空串（别让玩家白打一局）。
     */
    private _grantItem(
        save: MithrilSave,
        item: EquipItem,
        granted: EquipItem[],
        notes: string[],
        onGranted?: () => void,
        rng?: () => number,
    ): string {
        const base = GEAR_BASE_BY_ID[item.baseId];
        const q = QUALITY_BY_ID[item.quality];
        const label = `${q ? q.name : ''}·${base ? base.name : item.baseId}（${GEAR_SLOT_NAMES[item.slot]} ${item.ilvl}）`;
        if (addToInventory(save, item)) {
            granted.push(item);
            if (onGranted) onGranted();
            // 改造词条「贪食」：拾取装备时 5% 再掉一件（同槽位、品质不高于当前）。
            // 只触发一层（额外那件直接入包，不再走本函数），避免连锁到背包爆仓。
            // 随机数走本局种子（调用方传入），让「贪食触发」在复现脚本里可重放。
            if (equippedModifiers(save).indexOf('gluttony') >= 0) {
                const extra = gluttonyExtraDrop(rng || Math.random, item);
                if (extra) {
                    const eq = GEAR_BASE_BY_ID[extra.baseId];
                    const eqq = QUALITY_BY_ID[extra.quality];
                    const extraLabel = `${eqq ? eqq.name : ''}·${eq ? eq.name : extra.baseId}（${GEAR_SLOT_NAMES[extra.slot]} ${extra.ilvl}）`;
                    if (addToInventory(save, extra)) {
                        granted.push(extra);
                        notes.push(`贪食 · 额外拾取：${extraLabel}`);
                    } else {
                        // 背包刚好被主件填满：按主件同一规则折金币，别让玩家「触发了却什么都没拿到」
                        const gold = sellPrice(extra);
                        save.gold = Math.max(0, Math.floor(save.gold || 0) + gold);
                        notes.push(`贪食 · 背包已满：${extraLabel} 折算 ${gold} 金币`);
                    }
                }
            }
            return label;
        }
        const gold = sellPrice(item);
        save.gold = Math.max(0, Math.floor(save.gold || 0) + gold);
        notes.push(`背包已满：${label} 折算 ${gold} 金币`);
        return '';
    }

    /**
     * 击杀事件 → 经验 / 金币入档。
     * 升级时立刻把新 profile 喂回核心（`setProfile` 会按 maxHp 差值补血），
     * 所以「打一半升级」是真能变强的，而不是要等下一局。
     */
    private _onCoreEvents(events: CoreEvent[]): void {
        const save = this._save;
        if (!save) return;
        let exp = 0;
        let gold = 0;
        for (const ev of events) {
            if (ev.type !== 'kill') continue;
            exp += Math.max(0, Math.floor(ev.exp || 0));
            gold += Math.max(0, Math.floor(ev.gold || 0));
        }
        if (exp <= 0 && gold <= 0) return;
        if (gold > 0) {
            save.gold = Math.max(0, Math.floor(save.gold || 0) + gold);
            this._runGold += gold;
        }
        if (exp > 0) {
            this._runExp += exp;
            const levelBefore = save.level;
            const levels = addExp(save, exp);
            if (levels > 0) {
                const profile = profileFromSave(save, COMBAT_ILVL_FLOOR);
                if (this._core) this._core.setProfile(profile);
                this._persist();
                // 升级用 BOSS 换阶段同一条上扬音（'core' 带 medium 震动）：战斗中这是最该被听到的一次
                sfx.play('core');
                // 试玩 N194 残余：横幅只写「生命上限 152」时，玩家会读成「升级回满血」。
                // 写清增量（+18）并保留「只补差额、不回满」的事实（代码见 setProfile）。
                const hpGain = Math.round(maxHpAt(save.level)) - Math.round(maxHpAt(levelBefore));
                this._hudRef?.showGrowthBanner(
                    `升级！Lv ${save.level}`,
                    `生命上限 ${Math.round(profile.maxHp)}${hpGain > 0 ? `（+${hpGain}）` : ''} · 天赋点 +${levels}`,
                );
                this._refreshGrowthHud();
            }
        }
    }

    /**
     * 一局结束（胜/负）的结算 —— 野外节点与副本入口共用。
     *
     * 金币 / 经验在击杀时已经入档；这里补节点奖励（材料 / 装备 / 首通 / 技能书），
     * 把剩余生命写回远征状态，并处理区域通关或远征失败。
     * 掉落 rng 与战斗 rng 分开（runSeed 派生），避免结算消耗战斗随机数影响同种子复现。
     */
    private _settle(won: boolean): void {
        this._settled = true;
        // 胜负各一声（通关 heavy 短震、阵亡长震），与结算面板同时出现
        sfx.play(won ? 'won' : 'dead');
        const save = this._save;
        const node = this._wildNode;
        if (!save || !node) return;
        const exp = save.expedition;
        if (!exp) {
            this._enterMapMode();
            return;
        }
        // 这场已经打完：撤离标记没有意义了，别让下一次进别的节点被误收一次入场消耗
        exp.retreat = false;
        const hud = this._hudRef;
        // 料理按「打完一场」扣场次：本场仍吃到效果，结算时才递减。
        // 必须在 maxHp 之前——扣完之后上限可能下降，后面写回 exp.hp 才不会被夹错。
        const finishedMeals = consumeMealBattle(save);
        const maxHp = profileFromSave(save, COMBAT_ILVL_FLOOR).maxHp;
        const matId = regionMaterialId(exp.regionId);
        const reward: string[] = [`本局收益：金币 +${this._runGold}　经验 +${this._runExp}`];
        if (finishedMeals.length > 0) {
            reward.push(`料理结束：${finishedMeals.join('、')}（下一场不再生效）`);
        }
        if (this._nodeHpCost > 0) {
            reward.push(`补给耗尽：进入本节点失去 ${this._nodeHpCost} 生命`);
        }
        this._nodeHpCost = 0;
        const granted: EquipItem[] = [];
        /** 结算一次性奖励带来的升级数（用于同步顶栏生命上限，试玩 N37） */
        let settleLevels = 0;

        if (won) {
            // 战斗里剩下的血带出节点：野外是「一条命走完整张图」
            const snap = this._lastSnapshot;
            exp.hp = Math.max(1, Math.min(maxHp, Math.round(snap ? snap.player.hp : exp.hp)));
            const rng = mulberry32((this._runSeed ^ 0x5bd1e995) >>> 0);
            // 贪婪之眼（M7）：所有节点掉落统一走同一个降档概率
            const greedChance = lowerQualityChanceOf(save.trinkets);

            const mats = rollNodeMaterials(node);
            if (mats > 0) {
                grantRunMaterials(exp, matId, mats);
                save.materials[matId] = Math.max(0, Math.floor(save.materials[matId] || 0)) + mats;
                reward.push(`${materialName(matId)} +${mats}（本程 ${exp.runMaterials[matId] || 0}）`);
            }

            if (node.kind === 'dungeon' && node.dungeonId) {
                // 副本入口：沿用 M1–M3 的首通经验 / 技能书 / 紫装
                const firstClear = this._firstClear;
                let levels = 0;
                // 本局发放的技能书本数（首通额外 +1）
                let books = 0;
                if (firstClear) {
                    levels += addExp(save, FIRST_CLEAR_EXP);
                    books += SKILL_BOOK_FIRST_CLEAR;
                    reward.push(`首通奖励：经验 +${FIRST_CLEAR_EXP}`);
                }
                books += SKILL_BOOK_PER_CLEAR;
                save.skillBooks = Math.max(0, Math.floor(save.skillBooks || 0)) + books;
                reward.push(firstClear
                    ? `技能书 +${books}（通关 +${SKILL_BOOK_PER_CLEAR} / 首通 +${SKILL_BOOK_FIRST_CLEAR}，现有 ${save.skillBooks}）`
                    : `技能书 +${books}（现有 ${save.skillBooks}）`);
                if (levels > 0) {
                    reward.push(`升级！现在是 Lv ${save.level}（天赋点 +${levels}）`);
                    settleLevels = levels;
                }
                const dgId = node.dungeonId;
                // 首通欠账必须排在本局随机掉落之前（试玩 P2-5 复核）：否则玩家只腾出一格时，
                // 随机紫装会先占掉最后一格，记账永远补不出去。
                if (!firstClear
                    && save.pendingFirstClear.indexOf(dgId) >= 0
                    && save.inventory.length < inventoryCapFor(save)) {
                    const owed = firstClearDrop(rng, save.classId, dgId);
                    if (!owed) {
                        // 没配置固定掉落就没有东西可欠，别让这笔记账永远挂着
                        takePendingFirstClear(save, dgId);
                    } else {
                        maybeLowerQuality(rng, owed, greedChance);
                        if (this._grantItem(save, owed, granted, reward, undefined, rng) !== '') {
                            takePendingFirstClear(save, dgId);
                            // 结算面板只保留前 4 行收益：补发说明紧跟「本局收益」才不会被截掉
                            reward.splice(1, 0, '补发首通固定装备（上次首通时背包已满）');
                        }
                    }
                }
                const item = bossLoot(rng, {
                    classId: save.classId,
                    dungeonId: dgId,
                    firstClear,
                });
                // 首通记账与物品入包解耦（试玩 P2-5）：满包折金币那一轮也要记账，
                // 否则下次通关仍判定为首通，首通经验 / 技能书 / 保底饰品可以无限刷。
                let firstClearItemOwed = false;
                if (item) {
                    maybeLowerQuality(rng, item, greedChance);
                    // _grantItem 返回 '' = 背包满、已按同一规则折金币
                    firstClearItemOwed = this._grantItem(save, item, granted, reward, undefined, rng) === '';
                }
                if (firstClear) {
                    markDungeonCleared(save, dgId);
                    if (firstClearItemOwed && item) {
                        queuePendingFirstClear(save, dgId);
                        // 试玩 N64：面板只留 4 行收益，_grantItem 追加的「折算 N 金币」会被挤掉，
                        // 玩家对不上金币差额 —— 把金额直接并进这句靠前的记账提示。
                        const folded = sellPrice(item);
                        reward.splice(1, 0, `首通紫装：满包折 ${folded} 金币，已记账（下次通关补发）`);
                    }
                }
                // 饰品（M7）：首通必给本副本未拥有的一件，重复通关 25%；
                // 本副本饰品已集齐时退化为金币，结算行照实写，不假装出货
                const poolEmpty = unownedTrinkets(save, node.dungeonId).length === 0;
                const trinketId = bossTrinket(rng, save, node.dungeonId, firstClear);
                if (trinketId) {
                    addTrinket(save, trinketId);
                    const tdef = TRINKET_BY_ID[trinketId];
                    reward.push(`获得饰品：${tdef.name}（${TRINKET_TAG_NAMES[tdef.tag]}）`);
                } else if (poolEmpty) {
                    const gold = trinketGoldValue(node.dungeonId);
                    save.gold = Math.max(0, Math.floor(save.gold || 0)) + gold;
                    reward.push(`本副本饰品已集齐：金币 +${gold}`);
                }
            } else if (node.kind === 'boss') {
                // 区域首领：必掉（rare / epic）+ 橙装概率
                const bdef = node.bossId ? REGION_BOSS_BY_ID[node.bossId] : null;
                const quality = bdef && rng() < bdef.legendaryChance
                    ? 'legendary'
                    : (bdef ? bdef.guaranteed : 'epic');
                const item = rollItem(rng, { ilvl: node.ilvl, classId: save.classId, quality });
                if (item) {
                    maybeLowerQuality(rng, item, greedChance);
                    this._grantItem(save, item, granted, reward, undefined, rng);
                }
            } else {
                const def = node.kind === 'battle' || node.kind === 'elite' ? WILD_REWARDS[node.kind] : null;
                let dropped = false;
                // rolled ≠ dropped：背包满时 _grantItem 返回 ''（已折金币），装备其实掷出来了，
                // 此时同屏已有「背包已满…折算 N 金币」，不能再写「本节点无装备掉落」。
                let rolled = false;
                if (def && def.gearChance > 0 && rng() < def.gearChance) {
                    const item = rollItem(rng, {
                        ilvl: node.ilvl,
                        classId: save.classId,
                        minQuality: def.gearMinQuality,
                    });
                    if (item) {
                        rolled = true;
                        maybeLowerQuality(rng, item, greedChance);
                        dropped = this._grantItem(save, item, granted, reward, undefined, rng) !== '';
                    }
                }
                // 试玩 N134：首件装备必须在玩家第一次清掉战斗节点时到手。
                // 原来战斗节点只有 25% 掉率，新手「首胜 → 什么都没有」，前 30 分钟没有成长感（E3=1）。
                // 只在「身上与背包都没有任何装备」时保底；拿到第一件后立刻恢复常规概率，不滚雪球。
                if (!dropped) {
                    const st = equipStats(save.equips);
                    if (st.equipped === 0 && save.inventory.length === 0) {
                        const item = rollItem(rng, {
                            ilvl: node.ilvl,
                            classId: save.classId,
                            minQuality: 'uncommon',
                        });
                        if (item) {
                            rolled = true;
                            maybeLowerQuality(rng, item, greedChance);
                            dropped = this._grantItem(save, item, granted, reward, undefined, rng) !== '';
                        }
                    }
                }
                if (!rolled && (node.kind === 'battle' || node.kind === 'elite')) {
                    // 试玩 N137：无掉落时明说，避免玩家以为漏领
                    reward.push('本节点无装备掉落（精英 / 宝箱更容易出装备）');
                }
            }

            // 贪婪之眼：每个节点额外掉一件（最低档起步，免得白送高品质）
            const extraDrops = extraDropCountOf(save.trinkets);
            if (extraDrops > 0) {
                const before = exp.hp;
                let gained = 0;
                for (let i = 0; i < extraDrops; i++) {
                    const bonus = rollItem(rng, { ilvl: node.ilvl, classId: save.classId });
                    if (!bonus) continue;
                    maybeLowerQuality(rng, bonus, greedChance);
                    const label = this._grantItem(save, bonus, granted, reward, undefined, rng);
                    if (label) {
                        reward.push(`贪婪之眼 · 额外掉落：${label}`);
                        gained++;
                    }
                }
                // 饕餮协同：有额外掉落就回 3% 生命（上限仍是 maxHp）
                const heal = feastHealOnExtraLoot(save.trinkets, maxHp);
                if (heal > 0 && gained > 0) {
                    exp.hp = Math.min(maxHp, exp.hp + Math.round(heal));
                    if (exp.hp > before) reward.push(`饕餮：额外掉落回复 ${Math.round(exp.hp - before)} 生命`);
                }
            }

            markNodeDone(exp, node.id);
            if (node.kind === 'boss') {
                exp.complete = true;
                if (save.regionsCleared.indexOf(exp.regionId) < 0) save.regionsCleared.push(exp.regionId);
                save.expedition = null;
                this._rotateMapSeed();
                reward.push(`区域通关：${nodeName(node)}已击败（生命 ${hpText(exp.hp, maxHp)}）`);
                // 下一区域的等级门槛直接写进结算：否则玩家回到地图点页签才被拒绝（试玩 N68）
                const nextHint = nextRegionHint(exp.regionId, save.level);
                if (nextHint) reward.push(nextHint);
            } else {
                reward.push(`节点结束：生命 ${hpText(exp.hp, maxHp)} · 补给 ${exp.supply}/${SUPPLY_PER_RUN} · 返回路线图继续`);
            }
        } else {
            // 死亡只丢本程材料，装备 / 经验 / 等级保留（设计 §7 决策 3）
            const lost = failExpedition(exp);
            const lostText = this._applyMaterialLoss(save, lost);
            save.expedition = null;
            this._rotateMapSeed();
            reward.push('远征失败：本程材料已丢失（装备、经验与等级保留）');
            // 试玩 N53：阵亡是「整次远征结束」而非退回副本门口，结算里要写明白，
            // 否则玩家会以为还能原地重进，回路线图才发现要重新开始远征。
            // N86：原句 30 字，在 470 宽的正文里越出面板；压到 21 字一行放得下。
            reward.push('远征结束：本程进度不保留，回路线图重新开始');
            reward.push(lostText ? `丢失：${lostText}` : '本程还没有拾取材料');
            // 试玩 N136：副本 / 区域首领失败要给可行动的归因。
            // 只说「远征失败」时，玩家分不清是装等不够还是机制没躲（打掉 84% 后阵亡尤其憋屈）。
            const dieSnap = this._lastSnapshot;
            if ((node.kind === 'dungeon' || node.kind === 'boss') && dieSnap && dieSnap.boss) {
                const bos = dieSnap.boss;
                const pct = Math.max(0, Math.round((bos.hp / Math.max(1, bos.maxHp)) * 100));
                reward.push(`首领还剩 ${pct}%（${Math.round(bos.hp)}/${Math.round(bos.maxHp)} 生命）`);
                const worn = equipStats(save.equips);
                // N189：副本归因原来还写区间「推荐装等 1–10」，与确认卡点估计打架；
                // 统一走 `dungeonRecMin()` 的同口径文案（阵亡后玩家最需要知道差在哪）。
                const recText = node.kind === 'dungeon' && node.dungeonId
                    ? `建议：平均装等 ≥${dungeonRecMin(DUNGEON_BY_ID[node.dungeonId])} · ≥${DUNGEON_SLOT_REC}/8 槽`
                    : `推荐装等 ${node.ilvl}`;
                reward.push(`${recText} · 当前平均装等 ${worn.ilvl.toFixed(1)}（${worn.equipped}/8 槽）`);
            }
        }

        // 悬赏（M8）：胜/负都推进击杀类；通关类只在胜利且节点类型匹配时推进
        const snap = this._lastSnapshot;
        const stats = snap && snap.stats ? snap.stats : emptyBountyStats();
        const reportKind: BountyRunReport['kind'] = node.kind === 'boss' ? 'boss'
            : node.kind === 'dungeon' ? 'dungeon'
                : node.kind === 'elite' ? 'elite'
                    : node.kind === 'battle' ? 'battle' : 'other';
        applyRunReport(save, {
            won,
            kind: reportKind,
            elapsed: snap ? snap.time : 0,
            stats,
            lootCount: granted.length,
            // 没有复活机制：输了就是死了；赢了全程无死亡
            deaths: won ? 0 : 1,
            whiteOnly: this._runWhiteOnly,
            noTrinket: this._runNoTrinket,
            fullRunDone: exp.done.length,
            fullRunTotal: WILD_NODE_COUNT,
        });

        // 试玩 N156（round31 fresh 玩家复核为 P2）：掉落行只写「获得 X」，玩家不知道
        // 它进了背包，也不知道结算面板本身就有「装备」按钮。有空槽时给一句可行动引导；
        // 无空槽（只能换装）时提示换装，避免玩家以为掉落丢了。
        // 这句必须排在「获得 X」之后（N156 复核）：先看到「已入背包」再看掉落，行序是反的。
        const postLoot: string[] = [];
        if (won && granted.length > 0) {
            const emptySlots = GEAR_SLOTS.filter((slot) => !save.equips[slot]).length;
            if (emptySlots > 0) {
                postLoot.push(`新装备已入背包：点下方「装备」穿上（空槽 ${emptySlots}/${GEAR_SLOTS.length}）`);
            } else {
                postLoot.push('新装备已入背包：点下方「装备」可比对并换装');
            }
        }

        this._persist();
        this._refreshGrowthHud();
        // HUD 在同一个 update 里随后刷新结果面板，收益 / 掉落行会一起出现
        if (hud) {
            hud.setRewardLines(reward);
            hud.setLootItems(granted);
            hud.setPostLootLines(postLoot);
        }
        // 结算一次性奖励升了级：把新 profile 同步给核心并重画顶栏，
        // 免得 HUD「生命 x / 168」与成长页「生命上限 186」对不上（试玩 N37）
        if (settleLevels > 0 && this._core) {
            this._core.setProfile(profileFromSave(save, COMBAT_ILVL_FLOOR));
            if (hud) hud.updateHud(this._core.snapshot());
        }
    }

    /** 把等级 / 经验 / 技能书 / 待选变体喂给 HUD 顶栏与结算面板 */
    private _refreshGrowthHud(): void {
        const save = this._save;
        const hud = this._hudRef;
        if (!save || !hud) return;
        hud.setGrowthInfo({
            level: save.level,
            exp: save.exp,
            expNeed: expToNext(save.level),
            books: Math.max(0, Math.floor(save.skillBooks || 0)),
            pending: pendingVariantCount(save),
            points: Math.max(0, talentPointsForLevel(save.level) - talentPointsSpent(save.talents)),
        });
    }

    private _persist(): void {
        if (!this._save) return;
        StorageManager.instance.setItem('mithril', SAVE_STORAGE_KEY, serializeSave(this._save));
    }

    // ==================== 装备面板 ====================

    private openMenu(): void {
        const menu = this._menuRef;
        const save = this._save;
        if (!menu || !save) return;
        // 两个面板不叠：成长面板在上面的话先收起来
        this._growthRef?.close();
        // 从路线图打开时地图在上层，装备面板要抬到最顶（AGENTS 教训 H）
        menu.node.setSiblingIndex(this.node.children.length - 1);
        menu.open(save, COMBAT_ILVL_FLOOR);
        // 打开面板时清掉输入，避免关面板后还带着按下状态
        this._joystick?.release();
        this._keys.clear();
        this._hudRef?.releaseAllHeld();
    }

    private closeMenu(): void {
        this._menuRef?.close();
        this._acc = 0;
    }

    private onMenuClosed(): void {
        this.closeMenu();
    }

    /**
     * 装备变化：立刻落盘（防切后台丢档），并刷新路线图头部（试玩 N154）。
     *
     * 此前只落盘不刷新：穿上三件装备后地图头部仍是「生命 114/114」，
     * 要整页重载才变成 184 —— 玩家会以为白穿了。换装后 maxHp 可能变小，
     * 顺手把本次远征的当前生命夹到新上限，别让地图出现 200/184。
     *
     * 战斗中的 profile 仍按设计「下一场战斗」生效（面板里也这么写），
     * 这里只同步地图读数，不把新装备硬塞进进行中的这一局。
     */
    private onEquipmentChanged(): void {
        const save = this._save;
        if (save && save.expedition) {
            const maxHp = profileFromSave(save, COMBAT_ILVL_FLOOR).maxHp;
            save.expedition.hp = Math.max(1, Math.min(Math.round(maxHp), Math.round(save.expedition.hp)));
        }
        this._persist();
        if (this._mode === 'map') this._applyMapHint();
    }

    // ==================== 成长面板（天赋 / 技能） ====================

    private openGrowth(): void {
        const growth = this._growthRef;
        const save = this._save;
        if (!growth || !save) return;
        this._menuRef?.close();
        // 面板是运行时建的独立节点，每次打开都抬到最上层：
        // 结算遮罩 + BlockInputEvents 会吞掉同级下面的点击（AGENTS 教训 H）
        growth.node.setSiblingIndex(this.node.children.length - 1);
        growth.open(save);
        this._joystick?.release();
        this._keys.clear();
        this._hudRef?.releaseAllHeld();
    }

    private closeGrowth(): void {
        this._growthRef?.close();
        this._acc = 0;
        // 关面板时把最新天赋同步给当前这一局（面板里可能刚加完点）
        this._applyGrowthProfile();
        this._refreshGrowthHud();
    }

    /**
     * 成长变化（天赋点 / 技能等级 / 变体）：落盘，并**立刻**作用到进行中的这一局。
     * 天赋是战斗数值，等下一局才生效会让玩家以为「点了没反应」；
     * `setProfile` 会按 maxHp 差值补血，中途升级不会白送 / 白扣满血。
     */
    private onGrowthChanged(): void {
        this._persist();
        this._applyGrowthProfile();
        this._refreshGrowthHud();
        const core = this._core;
        const hud = this._hudRef;
        if (core && hud && core.phase === 'playing') {
            const snap = core.snapshot();
            this._lastSnapshot = snap;
            hud.updateHud(snap);
        }
    }

    private _applyGrowthProfile(): void {
        const save = this._save;
        const core = this._core;
        if (!save || !core) return;
        if (core.phase !== 'playing') return;
        core.setProfile(profileFromSave(save, COMBAT_ILVL_FLOOR));
    }

    // ==================== 营地面板（5 设施） ====================

    /**
     * 悬赏板（M8）：军需官 Lv1 起建板，Lv2 起 6 位，Lv4 跨日重置。
     * 返回本次是否刷新 / 补位（面板用来提示「每日刷新」）。
     */
    private _syncBountyBoard(): { refreshed: boolean; added: number } {
        const save = this._save;
        const none = { refreshed: false, added: 0 };
        if (!save) return none;
        const level = facilityLevel(save, 'quartermaster');
        if (level < BOUNTY_UNLOCK_LEVEL) return none;
        const res = ensureBountyBoard(
            save,
            bountyToday(Date.now()),
            bountySlots(save),
            level >= BOUNTY_DAILY_REFRESH_LEVEL,
        );
        if (res.refreshed || res.added > 0) this._persist();
        return res;
    }

    private openCamp(): void {
        const camp = this._campRef;
        const save = this._save;
        if (!camp || !save) return;
        const board = this._syncBountyBoard();
        const refreshed = board.refreshed || this._bountyRefreshPending;
        this._bountyRefreshPending = false;
        this._menuRef?.close();
        this._growthRef?.close();
        // 面板是运行时建的独立节点：每次打开都抬到最上层（AGENTS 教训 H）
        camp.node.setSiblingIndex(this.node.children.length - 1);
        camp.open(save, refreshed ? '每日刷新：今日悬赏已更新（未领取进度已重置）' : '');
        this._joystick?.release();
        this._keys.clear();
        this._hudRef?.releaseAllHeld();
    }

    private closeCamp(): void {
        this._campRef?.close();
        this._acc = 0;
        // 洗点 / 载入方案可能改了天赋：立刻同步给当前这一局（若正在战斗）
        this._applyGrowthProfile();
        this._refreshGrowthHud();
        if (this._mode === 'map') this._refreshMap();
    }

    /**
     * 营地改动：落盘 + 刷新路线图。
     * 设施升级只影响上限 / 后续规则，料理在**下一场开打时**才进 profile，
     * 所以这里不把料理硬塞进进行中的战斗（会凭空回血）。
     */
    private onCampChanged(): void {
        this._persist();
        this._applyGrowthProfile();
        this._refreshGrowthHud();
        if (this._mode === 'map') this._refreshMap();
    }

    /** 暂停层「返回路线图」：落盘后直接回地图；本节点算中断，再进是新一次挑战（N66） */
    private onPauseBackToMap(): void {
        this._commitCombatExit();
        this._persist();
        this._enterMapMode();
        this._refreshMap('已退出当前节点：生命已保留，点白圈重新挑战（会再扣一次入场消耗）');
    }

    /**
     * 战斗中途离开：把当前生命写回远征状态，并标记「再进是新挑战」。
     * 不写回生命的话，撤离再进 = 满血重开，配合击杀收益已入账就是无限刷（试玩 N66）。
     * 只对未结算的战斗有效；结算后的生命由 `_settle` 负责写回。
     */
    private _commitCombatExit(): boolean {
        const save = this._save;
        const exp = save ? save.expedition : null;
        if (!save || !exp || this._mode !== 'combat' || this._settled) return false;
        const snap = this._lastSnapshot;
        if (snap && snap.player) {
            const maxHp = profileFromSave(save, COMBAT_ILVL_FLOOR).maxHp;
            exp.hp = Math.max(1, Math.min(maxHp, Math.round(snap.player.hp)));
        }
        exp.retreat = true;
        return true;
    }

    /** 首战引导学会（3 击杀 / 按住普攻 1 秒）：写成持久标记，之后不再打扰 */
    private onCombatHintDone(): void {
        const save = this._save;
        if (!save || save.combatHintDone) return;
        save.combatHintDone = true;
        this._persist();
    }

    private exitToLobby(): void {
        // 战斗内 / 地图直接回大厅同样算「中途离开」：不落盘生命与 retreat 的话，
        // 从大厅重进可以零成本续开同一节点，击杀收益保留 → 无限刷（复核 N72）
        this._commitCombatExit();
        this._persist();
        SceneManager.gotoLobby();
    }

    private onGameHide(): void {
        // 击杀收益是逐帧写内存、按需落盘的，切后台时补一次，避免进程被杀丢金币 / 经验
        // 同时把战斗当前生命落盘：进程被杀后重进不会满血续开（N66）
        this._commitCombatExit();
        this._persist();
        // 切后台不会派发 TOUCH_END，HUD 的 held 不清就会一直普攻 / 持续施法
        this._joystick?.release();
        this._keys.clear();
        this._hudRef?.releaseAllHeld();
    }

    // ==================== 输入 ====================

    private _buildInput(): void {
        let mx = 0;
        let my = 0;
        const j = this._joystick;
        if (j && j.isActive()) {
            mx = j.direction.x;
            my = j.direction.y;
        }
        const k = this._keys;
        if (k.has(KeyCode.KEY_A) || k.has(KeyCode.ARROW_LEFT)) mx -= 1;
        if (k.has(KeyCode.KEY_D) || k.has(KeyCode.ARROW_RIGHT)) mx += 1;
        if (k.has(KeyCode.KEY_W) || k.has(KeyCode.ARROW_UP)) my += 1;
        if (k.has(KeyCode.KEY_S) || k.has(KeyCode.ARROW_DOWN)) my -= 1;
        const len = Math.hypot(mx, my);
        if (len > 1) {
            mx /= len;
            my /= len;
        }

        const held = this._hudRef?.held;
        const pending = this._hudRef?.pending;
        // 试玩 N139：短按锁存只消费一次。按住仍走 held（普攻需要持续施放），
        // 但 0 ms 单击必须可靠放出一次，不能由帧相位决定。
        const tap = (key: SkillKey): boolean => {
            if (!pending || !pending[key]) return false;
            pending[key] = false;
            return true;
        };
        // 先无条件消费：若写成 `held || tap(key)` 的短路式，按住时 pending 会留到松手那帧，
        // 放完技能再补一次「幽灵施放」。
        const tapped: Record<SkillKey, boolean> = {
            basic: tap('basic'), skill1: tap('skill1'), skill2: tap('skill2'),
            skill3: tap('skill3'), burst: tap('burst'), dodge: tap('dodge'),
        };
        this._input = {
            moveX: mx,
            moveY: my,
            aimX: 0,
            aimY: 0,
            basic: !!held?.basic || tapped.basic || k.has(KeyCode.KEY_J),
            skill1: !!held?.skill1 || tapped.skill1 || k.has(KeyCode.KEY_K) || k.has(KeyCode.SPACE),
            skill2: !!held?.skill2 || tapped.skill2 || k.has(KeyCode.KEY_L),
            skill3: !!held?.skill3 || tapped.skill3 || k.has(KeyCode.KEY_U),
            burst: !!held?.burst || tapped.burst || k.has(KeyCode.KEY_I),
            dodge: !!held?.dodge || tapped.dodge || k.has(KeyCode.KEY_H),
        };
    }

    /** 本轮是否给出了任何操作意图（移动或任意技能；首战教学门用，N205） */
    private _hasInputIntent(): boolean {
        const i = this._input;
        if (!i) return false;
        return i.moveX !== 0 || i.moveY !== 0
            || !!i.basic || !!i.skill1 || !!i.skill2 || !!i.skill3 || !!i.burst || !!i.dodge;
    }

    private onKeyDown(ev: EventKeyboard): void {
        // B = 装备面板、T = 成长面板、C = 营地（桌面调试入口；手机走路线图按钮）
        if (ev.keyCode === KeyCode.KEY_B) {
            if (this._growthRef && this._growthRef.isOpen()) {
                this.closeGrowth();
                return;
            }
            if (this._menuRef && this._menuRef.isOpen()) this.closeMenu();
            else this.openMenu();
            return;
        }
        if (ev.keyCode === KeyCode.KEY_T) {
            if (this._growthRef && this._growthRef.isOpen()) this.closeGrowth();
            else this.openGrowth();
            return;
        }
        if (ev.keyCode === KeyCode.KEY_C) {
            if (this._campRef && this._campRef.isOpen()) this.closeCamp();
            else this.openCamp();
            return;
        }
        this._keys.add(ev.keyCode);
    }

    private onKeyUp(ev: EventKeyboard): void {
        this._keys.delete(ev.keyCode);
    }

    // ==================== 节点创建 ====================

    private _ensureClassSelect(): void {
        let root = this.node.getChildByName('ClassSelect');
        if (!root) {
            root = new Node('ClassSelect');
            root.layer = this.node.layer;
            root.addComponent(UITransform).setContentSize(720, 1280);
            this.node.addChild(root);
        }
        // 开档面板压在最上层：首次进入没有任何其它 UI 应该盖住它
        root.setSiblingIndex(this.node.children.length - 1);
        this._classRef = root.getComponent(MithrilClassSelect) || root.addComponent(MithrilClassSelect);
    }

    /** 新档：建存档 → 落盘 → 收面板 → 进路线图 */
    private onClassPicked(classId: ClassId): void {
        if (this._save) {
            this._classRef?.close();
            this._enterMapMode();
            return;
        }
        this._save = defaultSave(classId);
        this._persist();
        this._classRef?.close();
        showTutorialOnce(this.node, 'mithril', '路线图点金色高亮圈启程 · 按住右下最大的键持续攻击 · 右上角「?」可重看操作', 4.2);
        this._enterMapMode();
    }

    private _ensureField(): void {
        if (this.renderer) {
            if (!this.renderer.node.parent) this.node.addChild(this.renderer.node);
            return;
        }
        let field = this.node.getChildByName('Field');
        if (!field) {
            field = new Node('Field');
            field.layer = this.node.layer;
            const ut = field.addComponent(UITransform);
            ut.setContentSize(720, 1280);
            field.setPosition(0, 0, 0);
            this.node.addChild(field);
        }
        this.renderer = field.getComponent(MithrilRenderer) || field.addComponent(MithrilRenderer);
    }

    private _ensureControls(): void {
        let root = this.node.getChildByName('Controls');
        if (!root) {
            root = new Node('Controls');
            root.layer = this.node.layer;
            const ut = root.addComponent(UITransform);
            ut.setContentSize(720, 1280);
            this.node.addChild(root);

            const left = new Node('JoystickLayer');
            left.layer = root.layer;
            const lut = left.addComponent(UITransform);
            // 左半屏底部 840 高：上方留给顶栏与 BOSS 条
            lut.setContentSize(360, 840);
            left.setPosition(-180, -220, 0);
            root.addChild(left);
            this._joystick = left.addComponent(MithrilJoystick);
        } else {
            const left = root.getChildByName('JoystickLayer');
            this._joystick = left ? left.getComponent(MithrilJoystick) : null;
        }
    }

    private _ensureHud(): void {
        if (this.hud) {
            this._hudRef = this.hud;
            if (!this.hud.node.parent) this.node.addChild(this.hud.node);
            return;
        }
        let root = this.node.getChildByName('HUD');
        if (!root) {
            root = new Node('HUD');
            root.layer = this.node.layer;
            const ut = root.addComponent(UITransform);
            ut.setContentSize(720, 1280);
            this.node.addChild(root);
        }
        this._hudRef = root.getComponent(MithrilHud) || root.addComponent(MithrilHud);
        this.hud = this._hudRef;
    }

    private _ensureMenu(): void {
        let root = this.node.getChildByName('EquipMenu');
        if (!root) {
            root = new Node('EquipMenu');
            root.layer = this.node.layer;
            root.addComponent(UITransform).setContentSize(720, 1280);
            this.node.addChild(root);
        }
        // 装备面板必须盖在 HUD / 结算面板之上：同级节点之间不冒泡，
        // 结算遮罩挡住的话「装备」按钮会变哑（AGENTS 教训 H）
        root.setSiblingIndex(this.node.children.length - 1);
        this._menuRef = root.getComponent(MithrilMenu) || root.addComponent(MithrilMenu);
    }

    private _ensureGrowth(): void {
        let root = this.node.getChildByName('GrowthMenu');
        if (!root) {
            root = new Node('GrowthMenu');
            root.layer = this.node.layer;
            root.addComponent(UITransform).setContentSize(720, 1280);
            this.node.addChild(root);
        }
        // 与装备面板同一个理由：必须压在结算遮罩之上
        root.setSiblingIndex(this.node.children.length - 1);
        this._growthRef = root.getComponent(MithrilGrowthMenu) || root.addComponent(MithrilGrowthMenu);
    }

    private _ensureCamp(): void {
        let root = this.node.getChildByName('CampMenu');
        if (!root) {
            root = new Node('CampMenu');
            root.layer = this.node.layer;
            root.addComponent(UITransform).setContentSize(720, 1280);
            this.node.addChild(root);
        }
        // 营地也从路线图打开，同样必须压在 HUD / 结算遮罩之上
        root.setSiblingIndex(this.node.children.length - 1);
        this._campRef = root.getComponent(MithrilCampPanel) || root.addComponent(MithrilCampPanel);
    }

    private _ensureWildMap(): void {
        let root = this.node.getChildByName('WildMap');
        if (!root) {
            root = new Node('WildMap');
            root.layer = this.node.layer;
            root.addComponent(UITransform).setContentSize(720, 1280);
            this.node.addChild(root);
        }
        // 地图压在所有面板之上（面板打开时会自己再抬一层）
        root.setSiblingIndex(this.node.children.length - 1);
        this._wildMapRef = root.getComponent(MithrilWildMap) || root.addComponent(MithrilWildMap);
        // 先收起来：真正的 UI 在首次 show() 的 onLoad 里构建
        root.active = false;
    }

    /**
     * 音效开关（M10）：挂到路线图节点上，跟着地图一起显隐。
     * 战斗 HUD 全屏无空位（顶栏右侧是进度/计时、下方 BOSS 条横跨中线），
     * 所以开关只在 hub 出现；`MithrilAudioUi` 自己负责位置与重绘。
     */
    private _ensureAudio(): void {
        const host = this._wildMapRef ? this._wildMapRef.node : this.node;
        const existing = host.getChildByName('MithrilAudioUi');
        // 节点在但组件被摘掉（热重载 / 旧构建残留）时补挂，别留一个读到 null 的引用
        this._audioRef = existing
            ? (existing.getComponent(MithrilAudioUi) || existing.addComponent(MithrilAudioUi))
            : MithrilAudioUi.create(host);
        // 浏览器 / 试玩探针：地图未激活（选职业界面）时也能读到开关状态
        const g = globalThis as unknown as { __mithrilAudio?: unknown };
        g.__mithrilAudio = sfx;
    }

    // ==================== 调试接口（浏览器探针） ====================

    debugSnapshot(): MithrilSnapshot | null {
        return this._lastSnapshot;
    }

    debugSetPlayerPos(x: number, y: number): void {
        if (!this._core) return;
        this._core.player.x = x;
        this._core.player.y = y;
    }

    debugKillAll(): void {
        const core = this._core;
        if (!core) return;
        for (let i = core.enemies.length - 1; i >= 0; i--) core.damageEnemy(i, 1e9);
    }

    debugGotoBoss(): void {
        const core = this._core;
        if (!core) return;
        while (core.stage === 'encounter') {
            this.debugKillAll();
            for (let i = 0; i < 180; i++) core.step(FIXED_DT, { moveX: 0, moveY: 0, aimX: 0, aimY: 0 });
        }
    }
}

/** 供场景脚本 / 探针读取出生点常量 */
export const MITHRIL_SPAWN = { x: PLAYER_START_X, y: PLAYER_START_Y };
