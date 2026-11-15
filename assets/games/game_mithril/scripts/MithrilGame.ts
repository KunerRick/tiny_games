/**
 * 《秘银远征》M1 垂直切片主组件 —— 战士 + 废弃矿坑 + 矿坑巨魔。
 *
 * 职责：把输入（左摇杆 / 键盘调试）喂给纯逻辑核心，固定步长推进，调度渲染与 HUD。
 * 场景里只需 Canvas + Camera + GameRoot 挂本组件；Field / Controls / HUD 全部运行时创建。
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
import { showTutorialOnce } from '../../../common/ui/GameUIKit';
import {
    FIXED_DT, MithrilWorld, PLAYER_START_X, PLAYER_START_Y, mulberry32, profileFromSave,
} from './MithrilCore';
import type { CoreEvent, MithrilInput, MithrilSnapshot } from './MithrilCore';
import { addToInventory, bossLoot } from './MithrilLoot';
import {
    SAVE_STORAGE_KEY, addExp, expToNext, parseSave, pendingVariantCount, serializeSave,
    talentPointsForLevel, talentPointsSpent,
} from './MithrilProgress';
import type { MithrilSave } from './MithrilProgress';
import {
    COMBAT_ILVL_FLOOR, FIRST_CLEAR_EXP, SKILL_BOOK_FIRST_CLEAR, SKILL_BOOK_PER_CLEAR,
} from './MithrilConfig';
import type { EquipItem } from './MithrilConfig';
import { MithrilGrowthMenu } from './MithrilGrowthMenu';
import { MithrilHud } from './MithrilHud';
import { MithrilJoystick } from './MithrilJoystick';
import { MithrilMenu } from './MithrilMenu';
import { MithrilRenderer } from './MithrilRenderer';

const { ccclass, property } = _decorator;

/** 每帧最多追的固定步数 */
const MAX_STEPS = 3;
/** HUD 刷新间隔（秒） */
const HUD_REFRESH = 0.1;

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
    _save: MithrilSave | null = null;
    _lastSnapshot: MithrilSnapshot | null = null;

    private _acc = 0;
    private _hudTimer = 0;
    private _keys = new Set<KeyCode>();
    private _input: MithrilInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
    private _runSeed = 0;
    /** 本局累计收益（结算面板展示用；击杀时已即时写进存档） */
    private _runExp = 0;
    private _runGold = 0;
    /** 本局是否首通（决定 BOSS 掉落走固定紫装还是随机保底紫） */
    private _firstClear = true;
    /** 结算只处理一次（update 每帧都会看到非 playing） */
    private _settled = false;

    onLoad(): void {
        this._save = parseSave(StorageManager.instance.getItem('mithril', SAVE_STORAGE_KEY));
        this._ensureField();
        this._ensureControls();
        this._ensureHud();
        this._ensureMenu();
        this._ensureGrowth();

        const hud = this._hudRef;
        if (hud) {
            hud.onExit = () => this.exitToLobby();
            hud.onRestart = () => this.startNewRun();
            hud.onOpenBag = () => this.openMenu();
            hud.onOpenGrowth = () => this.openGrowth();
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

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        game.on(Game.EVENT_HIDE, this.onGameHide, this);

        showTutorialOnce(this.node, 'mithril', '左侧拖动移动 · 右下技能键 · 普攻自动索敌', 3.4);
        this.startNewRun();
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
        this._save = null;
        this._lastSnapshot = null;
        this._keys.clear();
    }

    update(dt: number): void {
        const core = this._core;
        if (!core) return;
        // 面板打开时整局冻结：不推进核心、不刷 HUD（面板自己管显示）
        const menuOpen = this._menuRef && this._menuRef.isOpen();
        const growthOpen = this._growthRef && this._growthRef.isOpen();
        if (menuOpen || growthOpen) return;

        // 切后台回来 / 长卡顿时 dt 可能是 NaN 或巨大值：
        // NaN 会永久污染 _acc（`_acc >= FIXED_DT` 恒假且再也不会回正），巨大值会让蓄积步数无限涨。
        // 非有限值整帧丢弃；累加器封顶在 MAX_STEPS 步，卡顿后最多补 3 帧，不追旧账。
        if (!Number.isFinite(dt) || dt <= 0) return;
        // 输入：摇杆 + 键盘（桌面调试）
        this._buildInput();
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

    // ==================== 生命周期 ====================

    private startNewRun(): void {
        const save = this._save;
        if (!save) return;
        // M3 起不再强制等级：新档 1 级上场，靠击杀经验自己练；只保留装等地板
        const profile = profileFromSave(save, COMBAT_ILVL_FLOOR);
        const seed = this.seed > 0 ? this.seed : (Date.now() & 0x7fffffff);
        const core = new MithrilWorld(profile, seed);
        core.startDungeon('mine');
        this._core = core;
        this._acc = 0;
        this._hudTimer = 0;
        this._runSeed = seed;
        this._runExp = 0;
        this._runGold = 0;
        this._firstClear = save.dungeonsCleared.indexOf('mine') < 0;
        this._settled = false;
        this._input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
        this._keys.clear();
        this._joystick?.release();
        this._menuRef?.close();
        this._growthRef?.close();
        this._hudRef?.resetForNewRun();
        this._hudRef?.setLootItems([]);
        this._hudRef?.setRewardLines([]);
        this.renderer?.resetView();
        // 立刻渲染一帧，避免重开后短暂黑屏
        const snap = core.snapshot();
        this._lastSnapshot = snap;
        this.renderer?.render(snap, 0);
        this._refreshGrowthHud();
        this._hudRef?.updateHud(snap);
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
            const levels = addExp(save, exp);
            if (levels > 0) {
                const profile = profileFromSave(save, COMBAT_ILVL_FLOOR);
                if (this._core) this._core.setProfile(profile);
                this._persist();
                this._hudRef?.showGrowthBanner(
                    `升级！Lv ${save.level}`,
                    `生命上限 ${Math.round(profile.maxHp)} · 天赋点 +${levels}`,
                );
                this._refreshGrowthHud();
            }
        }
    }

    /**
     * 一局结束（胜/负）的结算。
     * 金币 / 经验在击杀时已经入档，这里只发**一次性**奖励（首通经验、技能书）与掉落；
     * 掉落 rng 与战斗 rng 分开（runSeed 派生），避免结算消耗战斗随机数影响同种子复现。
     */
    private _settle(won: boolean): void {
        this._settled = true;
        const save = this._save;
        if (!save) return;
        const hud = this._hudRef;
        const reward: string[] = [`本局收益：金币 +${this._runGold}　经验 +${this._runExp}`];
        const granted: EquipItem[] = [];
        /** 结算一次性奖励带来的升级数（用于同步顶栏生命上限，试玩 N37） */
        let settleLevels = 0;

        if (won) {
            const firstClear = this._firstClear;
            let levels = 0;
            // 本局发放的技能书本数（首通额外 +1）；不用跨局累计字段，界面数字才对得上
            let books = 0;
            if (firstClear) {
                levels += addExp(save, FIRST_CLEAR_EXP);
                books += SKILL_BOOK_FIRST_CLEAR;
                reward.push(`首通奖励：经验 +${FIRST_CLEAR_EXP}`);
            }
            books += SKILL_BOOK_PER_CLEAR;
            save.skillBooks = Math.max(0, Math.floor(save.skillBooks || 0)) + books;
            // 两行都写「技能书 +N」会看着自相矛盾，一本行写清来源（试玩 N38）
            reward.push(firstClear
                ? `技能书 +${books}（通关 +${SKILL_BOOK_PER_CLEAR} / 首通 +${SKILL_BOOK_FIRST_CLEAR}，现有 ${save.skillBooks}）`
                : `技能书 +${books}（现有 ${save.skillBooks}）`);
            if (levels > 0) reward.push(`升级！现在是 Lv ${save.level}（天赋点 +${levels}）`);
            settleLevels = levels;

            const rng = mulberry32((this._runSeed ^ 0x5bd1e995) >>> 0);
            const item = bossLoot(rng, {
                classId: save.classId,
                dungeonId: 'mine',
                firstClear,
            });
            if (item) {
                if (addToInventory(save, item)) {
                    granted.push(item);
                    // 首通只在奖励真正入包时才消耗：满包折金币那一轮，首通紫装保留到下次
                    if (firstClear) {
                        save.dungeonsCleared.push('mine');
                        this._firstClear = false;
                    }
                } else {
                    // 背包满：折金币，别让玩家白打一把
                    const gold = 20 + item.ilvl * 2;
                    save.gold = Math.max(0, Math.floor(save.gold || 0) + gold);
                    reward.push(`背包已满：掉落折算 ${gold} 金币（首通奖励已保留）`);
                }
            }
        }
        this._persist();
        this._refreshGrowthHud();
        // HUD 在同一个 update 里随后刷新结果面板，收益 / 掉落行会一起出现
        if (hud) {
            hud.setRewardLines(reward);
            hud.setLootItems(granted);
        }
        // 结算一次性奖励升了级：把新 profile 同步给核心并重画顶栏，
        // 免得 HUD「生命 x / 168」与成长页「生命上限 186」对不上（试玩 N37）
        if (won && settleLevels > 0 && this._core) {
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
     * 装备变化：立刻落盘（防切后台丢档），但**不改当前这一局**的 profile ——
     * 换装生效点统一在 startNewRun，HUD / 面板上都写明了这一点。
     */
    private onEquipmentChanged(): void {
        this._persist();
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

    private exitToLobby(): void {
        this._persist();
        SceneManager.gotoLobby();
    }

    private onGameHide(): void {
        // 击杀收益是逐帧写内存、按需落盘的，切后台时补一次，避免进程被杀丢金币 / 经验
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
        this._input = {
            moveX: mx,
            moveY: my,
            aimX: 0,
            aimY: 0,
            basic: !!held?.basic || k.has(KeyCode.KEY_J),
            skill1: !!held?.skill1 || k.has(KeyCode.KEY_K) || k.has(KeyCode.SPACE),
            skill2: !!held?.skill2 || k.has(KeyCode.KEY_L),
            skill3: !!held?.skill3 || k.has(KeyCode.KEY_U),
            burst: !!held?.burst || k.has(KeyCode.KEY_I),
            dodge: !!held?.dodge || k.has(KeyCode.KEY_H),
        };
    }

    private onKeyDown(ev: EventKeyboard): void {
        // B = 装备面板、T = 成长面板（桌面调试入口；手机走结算面板按钮）
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
        this._keys.add(ev.keyCode);
    }

    private onKeyUp(ev: EventKeyboard): void {
        this._keys.delete(ev.keyCode);
    }

    // ==================== 节点创建 ====================

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
