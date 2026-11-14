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
import { showTutorialOnce, toast } from '../../../common/ui/GameUIKit';
import {
    FIXED_DT, MithrilWorld, PLAYER_START_X, PLAYER_START_Y, mulberry32, profileFromSave,
} from './MithrilCore';
import type { MithrilInput, MithrilSnapshot } from './MithrilCore';
import { addToInventory, bossLoot } from './MithrilLoot';
import {
    SAVE_STORAGE_KEY, parseSave, serializeSave,
} from './MithrilProgress';
import type { MithrilSave } from './MithrilProgress';
import type { EquipItem } from './MithrilConfig';
import { MithrilHud } from './MithrilHud';
import { MithrilJoystick } from './MithrilJoystick';
import { MithrilMenu } from './MithrilMenu';
import { MithrilRenderer } from './MithrilRenderer';

const { ccclass, property } = _decorator;

/** 每帧最多追的固定步数 */
const MAX_STEPS = 3;
/** HUD 刷新间隔（秒） */
const HUD_REFRESH = 0.1;
/** M1 垂直切片的出战等级（与自检脚本的平衡门槛一致） */
const SLICE_LEVEL = 5;

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
    _save: MithrilSave | null = null;
    _lastSnapshot: MithrilSnapshot | null = null;

    private _acc = 0;
    private _hudTimer = 0;
    private _keys = new Set<KeyCode>();
    private _input: MithrilInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
    private _runSeed = 0;
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

        const hud = this._hudRef;
        if (hud) {
            hud.onExit = () => this.exitToLobby();
            hud.onRestart = () => this.startNewRun();
            hud.onOpenBag = () => this.openMenu();
        }
        const menu = this._menuRef;
        if (menu) {
            menu.onClose = () => this.onMenuClosed();
            menu.onChanged = () => this.onEquipmentChanged();
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
        this._save = null;
        this._lastSnapshot = null;
        this._keys.clear();
    }

    update(dt: number): void {
        const core = this._core;
        if (!core) return;
        // 装备面板打开时整局冻结：不推进核心、不刷 HUD（面板自己管显示）
        if (this._menuRef && this._menuRef.isOpen()) return;

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
                hud.updateHud(snap);
            }
        }
    }

    // ==================== 生命周期 ====================

    private startNewRun(): void {
        const save = this._save;
        if (!save) return;
        // 切片期等级下限：存档等级不足 5 时按 5 出战（M1 的平衡基线）
        if (save.level < SLICE_LEVEL) save.level = SLICE_LEVEL;
        // 装等由存档逐件求和推导（profileFromSave），地板取 SLICE_LEVEL：
        // 空档平均装等是 1、副属性全 0，直接按 1 算对 BOSS 只有约 4 DPS。
        const profile = profileFromSave(save, SLICE_LEVEL);
        const seed = this.seed > 0 ? this.seed : (Date.now() & 0x7fffffff);
        const core = new MithrilWorld(profile, seed);
        core.startDungeon('mine');
        this._core = core;
        this._acc = 0;
        this._hudTimer = 0;
        this._runSeed = seed;
        this._firstClear = save.dungeonsCleared.indexOf('mine') < 0;
        this._settled = false;
        this._input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
        this._keys.clear();
        this._joystick?.release();
        this._hudRef?.resetForNewRun();
        this._hudRef?.setLootItems([]);
        this.renderer?.resetView();
        // 立刻渲染一帧，避免重开后短暂黑屏
        const snap = core.snapshot();
        this._lastSnapshot = snap;
        this.renderer?.render(snap, 0);
        this._hudRef?.updateHud(snap);
    }

    /**
     * 一局结束（胜/负）的结算：只有胜利发装备。
     * 掉落 rng 与战斗 rng 分开（runSeed 派生），避免结算消耗战斗随机数影响同种子复现。
     */
    private _settle(won: boolean): void {
        this._settled = true;
        const save = this._save;
        if (!save || !won) return;

        const rng = mulberry32((this._runSeed ^ 0x5bd1e995) >>> 0);
        const firstClear = this._firstClear;
        const item = bossLoot(rng, {
            classId: save.classId,
            dungeonId: 'mine',
            firstClear,
        });
        if (!item) return;

        const granted: EquipItem[] = [];
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
            toast(this.node, `背包已满，掉落折算为 ${gold} 金币（首通奖励已保留）`, 2.6);
        }
        this._persist();
        // HUD 在同一个 update 里随后刷新结果面板，掉落行会一起出现
        this._hudRef?.setLootItems(granted);
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
        menu.open(save, SLICE_LEVEL);
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

    private exitToLobby(): void {
        SceneManager.gotoLobby();
    }

    private onGameHide(): void {
        // M1 不写档；切后台时清空输入，避免回来后摇杆 / 技能键卡在按下状态
        // （切后台不会派发 TOUCH_END，HUD 的 held 不清就会一直普攻 / 持续施法）
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
        // B 键 = 装备面板（桌面调试 / 无鼠标时的入口；手机走结算面板的「装备」按钮）
        if (ev.keyCode === KeyCode.KEY_B) {
            if (this._menuRef && this._menuRef.isOpen()) this.closeMenu();
            else this.openMenu();
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
