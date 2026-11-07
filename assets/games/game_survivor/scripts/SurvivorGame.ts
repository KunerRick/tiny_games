/**
 * 午夜幸存者 — 运行时主组件（M2 版）。
 *
 * 职责（规格 §6.2）：摇杆/键盘输入、固定步长推进、倍速、相机跟随、渲染调度、调试读数。
 *  - 核心永远只收到 `FIXED_DT`（倍速只在「一帧跑几步」上体现，规格 §4.3）
 *  - 追帧上限：1x 最多 3 步/帧、2x 6 步、4x 12 步；超出直接丢弃积压，避免回来就瞬移（规格 P7）
 *  - 本阶段还没有三选一面板（M3）：升级自动选第一张
 *  - 输入：触屏摇杆（运行时装在 Canvas 下的 `SurvivorJoystick`）为主，桌面 WASD/方向键仅作调试输入
 *
 * 约定：事件 handler 全部命名方法（红线 5）；`onDestroy()` 只解绑键盘，不碰 @property 节点（红线 4）。
 */

import { _decorator, Component, EventKeyboard, Input, input, KeyCode, Label, Node, UITransform, Vec3, Widget } from 'cc';
import { SurvivorCore } from './SurvivorCore';
import { SurvivorJoystick } from './SurvivorJoystick';
import { SurvivorRenderer } from './SurvivorRenderer';
import { SurvivorUpgradePanel } from './SurvivorUpgradePanel';
import { SurvivorHud } from './SurvivorHud';
import { SurvivorResultPanel } from './SurvivorResultPanel';
import { SceneManager } from '../../../common/managers/SceneManager';
import { FIXED_DT } from './SurvivorConfig';
import type { SurvivorInput } from './SurvivorConfig';

const { ccclass, property } = _decorator;

/** 倍速档位（规格 §3.12：1x → 2x → 4x → 1x） */
const SPEED_STEPS = [1, 2, 4];
/** 各倍速下的追帧上限（步/帧） */
const MAX_STEPS_1X = 3;
const MAX_STEPS_2X = 6;
const MAX_STEPS_4X = 12;
/** 调试读数刷新间隔（秒） */
const HUD_REFRESH = 0.25;

@ccclass('SurvivorGame')
export class SurvivorGame extends Component {
    @property({ type: SurvivorRenderer, tooltip: '渲染层（留空则取本节点上的 SurvivorRenderer）' })
    renderer: SurvivorRenderer | null = null;

    @property({ type: Node, tooltip: '世界根节点（相机跟随、随玩家反向移动）' })
    worldNode: Node | null = null;

    @property({ type: Label, tooltip: '调试读数（阶段验收用，正式 HUD 在 M3）' })
    debugLabel: Label | null = null;

    @property({ type: SurvivorJoystick, tooltip: '虚拟摇杆（留空则运行时自动创建到 Canvas 下）' })
    joystick: SurvivorJoystick | null = null;

    @property({ tooltip: '开局随机种子（0 = 用时间戳）' })
    seed = 0;

    /** 浏览器探针用：核心实例 */
    _core: SurvivorCore | null = null;
    /** 当前倍速 */
    _speed = 1;
    /** 上一帧渲染耗时（毫秒） */
    _lastRenderMs = 0;
    /** 累计平均渲染耗时（毫秒） */
    _avgRenderMs = 0;
    /** 上一帧实际跑的固定步数 */
    _steps = 0;
    /** 暂停标志 */
    _paused = false;
    /** 三选一升级面板（运行时创建） */
    _upgradePanel: SurvivorUpgradePanel | null = null;
    /** 正式 HUD（时间 / 等级 / 生命 / 经验 / 构筑） */
    _hud: SurvivorHud | null = null;
    /** 结算面板（胜利 / 失败） */
    _resultPanel: SurvivorResultPanel | null = null;

    private _acc = 0;
    private _keys = new Set<KeyCode>();
    private _input: SurvivorInput = { moveX: 0, moveY: 0 };
    private _hudTimer = 0;
    private _fps = 60;
    private _fpsAcc = 0;
    private _fpsFrames = 0;
    private _renderSum = 0;
    private _renderCount = 0;
    private _tmp = new Vec3();

    onLoad(): void {
        if (!this.renderer) this.renderer = this.getComponent(SurvivorRenderer);
        if (!this.worldNode) this.worldNode = this.node;
        if (!this.joystick) this.joystick = this._ensureJoystick();
        this._hud = this._ensureHud();
        this._upgradePanel = this._ensureUpgradePanel();
        this._resultPanel = this._ensureResultPanel();
        if (this._hud) {
            this._hud.onSpeedTap = this._onHudSpeed;
            this._hud.onPauseTap = this._onHudPause;
            this._hud.setSpeed(this._speed);
            this._hud.setPaused(this._paused);
        }
        // M2 的调试读数退场：正式 HUD 接管顶栏
        if (this.debugLabel) this.debugLabel.node.active = false;
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        this.startRun();
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        this._keys.clear();
        this._core = null;
        this._input = null;
        this.joystick = null;
        this._upgradePanel = null;
        this._hud = null;
        this._resultPanel = null;
    }

    /**
     * 摇杆在运行时创建，不改场景文件。
     *
     * 挂在 Canvas 下、压在世界层之上但**排在 BackButton 之前**：
     * 全屏的触摸节点若排在返回按钮之后，会把返回按钮的点击整个吞掉。
     */
    private _ensureJoystick(): SurvivorJoystick | null {
        const parent = this.node.parent;
        if (!parent) return null;

        let node = parent.getChildByName('Joystick');
        if (!node) {
            node = new Node('Joystick');
            node.layer = parent.layer;
            const ut = node.addComponent(UITransform);
            ut.setContentSize(720, 1280);
            node.addComponent(SurvivorJoystick);
            parent.addChild(node);

            // 铺满 Canvas，随窗口尺寸变化
            const widget = node.addComponent(Widget);
            widget.target = parent;
            widget.isAlignLeft = true;
            widget.isAlignRight = true;
            widget.isAlignTop = true;
            widget.isAlignBottom = true;
            widget.left = 0;
            widget.right = 0;
            widget.top = 0;
            widget.bottom = 0;
            widget.alignMode = Widget.AlignMode.ALWAYS;
            widget.updateAlignment();

            // 放到 BackButton 之前，别抢它的触摸
            const back = parent.getChildByName('BackButton');
            const idx = back ? back.getSiblingIndex() : -1;
            node.setSiblingIndex(idx >= 0 ? idx : parent.children.length - 1);
        }
        return node.getComponent(SurvivorJoystick);
    }

    private _ensureHud(): SurvivorHud | null {
        const parent = this.node.parent;
        if (!parent) return null;
        let node = parent.getChildByName('Hud');
        if (!node) node = SurvivorHud.create(parent).node;
        return node.getComponent(SurvivorHud);
    }

    /** 面板必须最后创建，渲染层级压在摇杆和 HUD 之上 */
    private _ensureUpgradePanel(): SurvivorUpgradePanel | null {
        const parent = this.node.parent;
        if (!parent) return null;
        let node = parent.getChildByName('UpgradePanel');
        if (!node) {
            SurvivorUpgradePanel.create(parent);
            node = parent.getChildByName('UpgradePanel');
        }
        if (node) node.setSiblingIndex(parent.children.length - 1);
        return node ? node.getComponent(SurvivorUpgradePanel) : null;
    }

    /** 结算面板压在升级面板之上（终局时升级面板已经不可能再出现） */
    private _ensureResultPanel(): SurvivorResultPanel | null {
        const parent = this.node.parent;
        if (!parent) return null;
        let node = parent.getChildByName('ResultPanel');
        if (!node) {
            SurvivorResultPanel.create(parent);
            node = parent.getChildByName('ResultPanel');
        }
        if (node) node.setSiblingIndex(parent.children.length - 1);
        return node ? node.getComponent(SurvivorResultPanel) : null;
    }

    /** 终局：核心停在同一帧，面板只读快照与 getRunSummary() */
    private _openResultPanel(): void {
        const core = this._core;
        const panel = this._resultPanel;
        if (!core || !panel) return;
        this._acc = 0;
        this.joystick?.release();
        panel.show(core.getRunSummary(), core.getSnapshot(), {
            onRestart: this._onResultRestart,
            onLobby: this._onResultLobby,
        });
    }

    private _onResultRestart = (): void => {
        this.startRun();
    };

    private _onResultLobby = (): void => {
        SceneManager.gotoLobby();
    };

    /** 开新局（重开也走这里） */
    startRun(): void {
        const seed = this.seed || (Date.now() % 2147483647);
        this._core = new SurvivorCore(seed);
        this._acc = 0;
        this._steps = 0;
        this._paused = false;
        if (this._upgradePanel) this._upgradePanel.hide();
        if (this._resultPanel) this._resultPanel.hide();
        if (this.renderer) {
            this.renderer.drawBackground();
            this.renderer.resetFx();
        }
        if (this._hud && this._core) this._hud.refresh(this._core.getSnapshot());
    }

    update(dt: number): void {
        if (!this._core) return;
        const phase = this._core.getSnapshot().phase;

        this._fpsAcc += dt;
        this._fpsFrames++;
        if (this._fpsAcc >= 0.5) {
            this._fps = this._fpsFrames / this._fpsAcc;
            this._fpsAcc = 0;
            this._fpsFrames = 0;
        }

        if (phase === 'victory' || phase === 'defeat') {
            // 调试快进可能从 levelup 直接翻到终局，残留的升级面板要收掉
            if (this._upgradePanel && this._upgradePanel.visible) this._upgradePanel.hide();
            if (this._resultPanel && !this._resultPanel.visible) this._openResultPanel();
        } else if (phase === 'levelup') {
            // 逻辑暂停：面板打开期间敌人不动、不掉血，只等玩家选择
            if (this._upgradePanel && !this._upgradePanel.visible) this._openUpgradePanel();
        } else if (!this._paused) {
            this._advance(dt);
        }
        this._syncView();
        this._render(dt);

        this._hudTimer -= dt;
        if (this._hudTimer <= 0) {
            this._hudTimer = HUD_REFRESH;
            this._refreshHud();
        }
    }

    /** 固定步长推进 + 倍速 + 追帧上限 */
    private _advance(dt: number): void {
        const core = this._core;
        if (!core) return;
        const mult = this._speed;
        const maxSteps = mult >= 4 ? MAX_STEPS_4X : mult >= 2 ? MAX_STEPS_2X : MAX_STEPS_1X;

        this._readInput();
        this._acc += dt * mult;
        // 追帧：一次性积压太多就丢弃，宁可慢放也不瞬移
        if (this._acc > FIXED_DT * maxSteps) this._acc = FIXED_DT * maxSteps;

        let steps = 0;
        while (this._acc >= FIXED_DT && steps < maxSteps) {
            core.step(FIXED_DT, this._input);
            this._acc -= FIXED_DT;
            steps++;
            if (core.getSnapshot().phase !== 'running') break;
        }
        this._steps = steps;

        const phase = core.getSnapshot().phase;
        if (phase === 'levelup') {
            // 三选一：停止推进并弹出面板。连升多级由 _onOfferChosen 接续。
            this._acc = 0;
            this._openUpgradePanel();
        } else if (phase !== 'running') {
            this._acc = 0;
        }

        const events = core.drainEvents();
        if (this.renderer) this.renderer.pushEvents(events);
    }

    /** 弹出升级面板；面板选择后调用 _onOfferChosen */
    private _openUpgradePanel(): void {
        const core = this._core;
        const panel = this._upgradePanel;
        if (!core || !panel) return;
        const snap = core.getSnapshot();
        if (snap.phase !== 'levelup' || snap.offers.length === 0) return;
        this._acc = 0;
        // 按住摇杆时升级：面板期间方向不该继续生效，松手前先归零
        this.joystick?.release();
        panel.show(snap.offers, snap.player.level, this._onOfferChosen);
    }

    /**
     * 面板回调：应用一张卡；如果经验还够就继续弹下一组（逐级弹，不合并）。
     * 用箭头属性保证面板调用时 this 仍指向本组件（面板只拿到函数引用）。
     */
    private _onOfferChosen = (index: number): void => {
        const core = this._core;
        if (!core) return;
        core.chooseUpgrade(index);
        const snap = core.getSnapshot();
        if (snap.phase === 'levelup' && snap.offers.length > 0) {
            if (this._upgradePanel) this._upgradePanel.show(snap.offers, snap.player.level, this._onOfferChosen);
        }
    };

    /** 摇杆优先（移动端唯一入口），没有触摸时回落到键盘（桌面调试） */
    private _readInput(): void {
        const joy = this.joystick;
        if (joy && joy.isValid && joy.isActive()) {
            const d = joy.direction;
            this._input.moveX = d.x;
            this._input.moveY = d.y;
            return;
        }
        this._readKeyboard();
    }

    private _readKeyboard(): void {
        const k = this._keys;
        let x = 0;
        let y = 0;
        if (k.has(KeyCode.KEY_A) || k.has(KeyCode.ARROW_LEFT)) x -= 1;
        if (k.has(KeyCode.KEY_D) || k.has(KeyCode.ARROW_RIGHT)) x += 1;
        if (k.has(KeyCode.KEY_W) || k.has(KeyCode.ARROW_UP)) y += 1;
        if (k.has(KeyCode.KEY_S) || k.has(KeyCode.ARROW_DOWN)) y -= 1;
        if (x !== 0 && y !== 0) {
            const inv = Math.SQRT1_2;
            x *= inv;
            y *= inv;
        }
        this._input.moveX = x;
        this._input.moveY = y;
    }

    /** 相机跟随：把世界根节点反向平移，让玩家固定在屏幕中心 */
    private _syncView(): void {
        const core = this._core;
        const world = this.worldNode;
        if (!core || !world) return;
        const p = core.getSnapshot().player;
        this._tmp.set(-p.x, -p.y, 0);
        world.setPosition(this._tmp);
    }

    private _render(dt: number): void {
        const core = this._core;
        const renderer = this.renderer;
        if (!core || !renderer) return;
        const t0 = performance.now();
        const snap = core.getSnapshot();
        renderer.render(snap, dt);
        if (this._hud) this._hud.refresh(snap);
        const ms = performance.now() - t0;
        this._lastRenderMs = ms;
        this._renderSum += ms;
        this._renderCount++;
        if (this._renderCount >= 60) {
            this._avgRenderMs = this._renderSum / this._renderCount;
            this._renderSum = 0;
            this._renderCount = 0;
        }
    }

    private _refreshHud(): void {
        const core = this._core;
        const label = this.debugLabel;
        // M2 调试读数已退场，节点关掉时不必再拼字符串
        if (!core || !label || !label.node.activeInHierarchy) return;
        const s = core.getSnapshot();
        const t = s.time;
        const mm = Math.floor(t / 60);
        const ss = Math.floor(t % 60);
        let enemies = 0;
        for (let i = 0; i < s.enemies.length; i++) if (s.enemies[i].active) enemies++;
        label.string =
            `FPS ${this._fps.toFixed(0)}  步 ${this._steps}  渲染 ${this._lastRenderMs.toFixed(2)}ms\n` +
            `Lv.${s.player.level}  HP ${Math.ceil(s.player.hp)}/${s.player.maxHp}  击杀 ${s.kills}\n` +
            `${mm}:${ss < 10 ? '0' : ''}${ss}  敌 ${enemies}  速 ${this._speed}x  ${this._paused ? '暂停' : s.phase}`;
    }

    // ==================== 键盘（桌面调试输入，M3 换摇杆） ====================

    private onKeyDown(ev: EventKeyboard): void {
        this._keys.add(ev.keyCode);
        if (ev.keyCode === KeyCode.DIGIT_1) this.applySpeed(SPEED_STEPS[0]);
        else if (ev.keyCode === KeyCode.DIGIT_2) this.applySpeed(SPEED_STEPS[1]);
        else if (ev.keyCode === KeyCode.DIGIT_4) this.applySpeed(SPEED_STEPS[2]);
        else if (ev.keyCode === KeyCode.KEY_X) this.cycleSpeed();
        else if (ev.keyCode === KeyCode.KEY_P) this.togglePause();
        else if (ev.keyCode === KeyCode.KEY_R) this.startRun();
        else if (ev.keyCode === KeyCode.KEY_K) this.debugStress(60);
    }

    private onKeyUp(ev: EventKeyboard): void {
        this._keys.delete(ev.keyCode);
    }

    // ==================== 对外调试接口（浏览器探针 / 验收用） ====================

    private _onHudSpeed = (): void => {
        this.cycleSpeed();
    };

    private _onHudPause = (): void => {
        this.togglePause();
    };

    cycleSpeed(): void {
        const i = SPEED_STEPS.indexOf(this._speed);
        this.applySpeed(SPEED_STEPS[(i + 1) % SPEED_STEPS.length]);
    }

    applySpeed(mult: number): void {
        this._speed = mult;
        if (this._hud) this._hud.setSpeed(mult);
    }

    togglePause(): void {
        this._paused = !this._paused;
        this._acc = 0;
        if (this._hud) this._hud.setPaused(this._paused);
    }

    /** 直接推进 N 秒逻辑（跳过等待，验收用） */
    debugAdvance(seconds: number): void {
        const core = this._core;
        if (!core) return;
        // 调试推进不弹面板：自动选第一张，保持旧的验收脚本可用
        if (this._upgradePanel && this._upgradePanel.visible) this._upgradePanel.hide();
        const steps = Math.round(seconds / FIXED_DT);
        for (let i = 0; i < steps; i++) {
            core.step(FIXED_DT, { moveX: 0, moveY: 0 });
            let guard = 0;
            while (core.getSnapshot().phase === 'levelup' && guard++ < 32) core.chooseUpgrade(0);
            if (core.getSnapshot().phase !== 'running') break;
        }
        const events = core.drainEvents();
        if (this.renderer) this.renderer.pushEvents(events);
        this._syncView();
        this._render(FIXED_DT);
    }

    /** 压测：直接刷 N 个敌人（Gate B 用） */
    debugStress(count: number): void {
        const core = this._core;
        if (!core) return;
        const kinds = ['chaser', 'weaver', 'shooter', 'bomber'] as const;
        for (let i = 0; i < count; i++) {
            core.debugSpawn(kinds[i % 4], 1, i % 10 === 0);
        }
    }
}
