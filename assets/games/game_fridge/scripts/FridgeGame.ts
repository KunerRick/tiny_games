/**
 * 冰箱底下 — 运行时主组件（M2）。
 *
 * 职责：把输入（左摇杆 / 右半屏瞄准 / 键盘调试）喂给纯逻辑核心，固定步长推进，调度渲染与 HUD。
 * 节点全部运行时创建（Field / Controls / HUD），场景里只需 Canvas + GameRoot 挂本组件，减少 MCP 手工绑定。
 *
 * M2 增补：断点续玩（进入房间 / 清房 / 拾取 / 宝箱时写档，死亡 / 通关删档，切后台补写）。
 *
 * 约定：
 *  - 事件 handler 全部命名方法（红线 5）
 *  - onDestroy 只解绑与清引用，不访问 @property 节点（红线 4）
 *  - 固定步长：核心只收到 FIXED_DT，追帧上限 3 步/帧
 */

import {
    _decorator, Component, EventKeyboard, EventMouse, EventTouch, Game, game, Input, input, KeyCode, Node, UITransform,
} from 'cc';
import { FridgeWorld } from './FridgeCore';
import type { FridgeInput } from './FridgeCore';
import { FIXED_DT, FIELD_H, FIELD_W } from './FridgeConfig';
import type { CoreEvent } from './FridgeConfig';
import { discardRun, loadRun, saveRun } from './FridgeDungeon';
import { FridgeAim } from './FridgeAim';
import { FridgeHud } from './FridgeHud';
import { FridgeJoystick } from './FridgeJoystick';
import { FridgePerf } from './FridgePerf';
import { FridgeRenderer } from './FridgeRenderer';

const { ccclass, property } = _decorator;

/** 战斗区在 Canvas 内的中心 y（顶栏 120 之下） */
const FIELD_Y = 160;
/** 每帧最多追的固定步数 */
const MAX_STEPS = 3;
/** HUD 刷新间隔（秒） */
const HUD_REFRESH = 0.1;
/** 设计分辨率高度，用于把 wx 的安全区像素换算成设计像素 */
const DESIGN_H = 1280;
/** 触摸层高度：留出顶部 140px 给 HUD 与返回按钮，避免全屏手势层吞掉按钮点击 */
const TOUCH_LAYER_H = 1140;
const TOUCH_LAYER_Y = -70;

@ccclass('FridgeGame')
export class FridgeGame extends Component {
    @property({ type: FridgeRenderer, tooltip: '渲染层（留空则运行时创建 Field 节点）' })
    renderer: FridgeRenderer | null = null;

    @property({ tooltip: '开局随机种子（0 = 用时间戳）' })
    seed = 0;

    /** 浏览器探针用 */
    _core: FridgeWorld | null = null;
    _joystick: FridgeJoystick | null = null;
    _aim: FridgeAim | null = null;
    _hud: FridgeHud | null = null;
    _perf: FridgePerf | null = null;
    _paused = false;

    private _acc = 0;
    private _steps = 0;
    private _hudTimer = 0;
    private _keys = new Set<KeyCode>();
    private _input: FridgeInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, firing: false };

    onLoad(): void {
        this._ensureField();
        this._ensureControls();
        this._ensureHud();
        this._ensurePerf();

        const safeTop = this._readSafeTop();
        this._hud?.setSafeTop(safeTop);
        this._perf?.setSafeTop(safeTop);
        if (safeTop > 0) this._shiftBackButton(safeTop);
        if (this._hud) {
            this._hud.onRestartRequested = () => this.startRun(false);
            this._hud.onTreasurePick = (index: number) => this.onTreasurePick(index);
            this._hud.onTreasureReroll = () => this.onTreasureReroll();
        }

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.TOUCH_END, this.onAnyTouchEnd, this);
        input.on(Input.EventType.MOUSE_UP, this.onAnyMouseUp, this);
        game.on(Game.EVENT_HIDE, this.onGameHide, this);
        this.startRun(true);
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.TOUCH_END, this.onAnyTouchEnd, this);
        input.off(Input.EventType.MOUSE_UP, this.onAnyMouseUp, this);
        game.off(Game.EVENT_HIDE, this.onGameHide, this);
        if (this._hud) {
            this._hud.onRestartRequested = null;
            this._hud.onTreasurePick = null;
            this._hud.onTreasureReroll = null;
        }
        this._keys.clear();
        this._core = null;
        this._joystick = null;
        this._aim = null;
        this._hud = null;
        this._perf = null;
        this._input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, firing: false };
    }

    /**
     * 开一局：resume=true 时优先读档续玩（页面重载 / 切后台回来），否则新开并清掉旧档。
     */
    startRun(resume = false): void {
        let core: FridgeWorld | null = null;
        if (resume) {
            const save = loadRun();
            if (save) {
                try {
                    core = FridgeWorld.fromSave(save);
                } catch {
                    core = null;
                }
            }
        }
        if (!core) {
            discardRun();
            const seed = this.seed || (Date.now() % 2147483647);
            core = FridgeWorld.newRun(seed, 'pudding');
        }
        this._core = core;
        this._acc = 0;
        this._steps = 0;
        this._paused = false;
        this._joystick?.release();
        this._aim?.release();
        this.renderer?.resetFx();
        if (this._hud) this._hud.refresh(core.snapshot());
        // 刚开一局就写一次档：瞬间杀进程也能回到起点房
        saveRun(core);
    }

    update(dt: number): void {
        const core = this._core;
        if (!core) return;
        let logicMs = 0;
        if (core.phase === 'playing' && !this._paused) {
            const t0 = nowMs();
            // 宝箱三选一期间冻结输入，避免误触与摇杆残留
            if (core.pendingTreasure) {
                this._joystick?.release();
                this._aim?.release();
            }
            this._readInput();
            this._acc += dt;
            const maxAcc = FIXED_DT * MAX_STEPS;
            if (this._acc > maxAcc) this._acc = maxAcc;
            let steps = 0;
            while (this._acc >= FIXED_DT && steps < MAX_STEPS) {
                core.step(FIXED_DT, this._input);
                this._acc -= FIXED_DT;
                steps++;
                if (core.phase !== 'playing') break;
            }
            this._steps = steps;
            const events = core.drainEvents();
            this._handleEvents(events);
            logicMs = nowMs() - t0;
        }

        const t1 = nowMs();
        const snap = core.snapshot();
        this.renderer?.render(snap, dt);

        this._hudTimer -= dt;
        if (this._hudTimer <= 0) {
            this._hudTimer = HUD_REFRESH;
            this._hud?.refresh(snap);
        }
        const renderMs = nowMs() - t1;

        this._perf?.sample(dt, logicMs, renderMs, snap);
        this._hud?.setFps(this._perf ? this._perf._fps : 0);
    }

    // ==================== 输入 ====================

    private _readInput(): void {
        if (this._core && this._core.pendingTreasure) {
            this._input.moveX = 0;
            this._input.moveY = 0;
            this._input.aimX = 0;
            this._input.aimY = 0;
            this._input.firing = false;
            return;
        }
        const j = this._joystick;
        if (j && j.isValid && j.isActive()) {
            const d = j.direction;
            this._input.moveX = d.x;
            this._input.moveY = d.y;
        } else {
            this._readKeyboardMove();
        }

        const a = this._aim;
        if (a && a.isValid && a.isFiring()) {
            this._input.aimX = a.direction.x;
            this._input.aimY = a.direction.y;
            this._input.firing = true;
        } else {
            this._input.firing = false;
            this._input.aimX = 0;
            this._input.aimY = 0;
        }
    }

    private _readKeyboardMove(): void {
        const k = this._keys;
        let x = 0;
        let y = 0;
        if (k.has(KeyCode.KEY_A) || k.has(KeyCode.ARROW_LEFT)) x -= 1;
        if (k.has(KeyCode.KEY_D) || k.has(KeyCode.ARROW_RIGHT)) x += 1;
        if (k.has(KeyCode.KEY_W) || k.has(KeyCode.ARROW_UP)) y += 1;
        if (k.has(KeyCode.KEY_S) || k.has(KeyCode.ARROW_DOWN)) y -= 1;
        if (x !== 0 && y !== 0) {
            x *= Math.SQRT1_2;
            y *= Math.SQRT1_2;
        }
        this._input.moveX = x;
        this._input.moveY = y;
    }

    private onKeyDown(ev: EventKeyboard): void {
        this._keys.add(ev.keyCode);
        if (ev.keyCode === KeyCode.KEY_R) {
            this.startRun(false);
        } else if (ev.keyCode === KeyCode.KEY_P) {
            this._paused = !this._paused;
        } else if (ev.keyCode === KeyCode.KEY_K) {
            this.debugStress(20);
        } else if (ev.keyCode === KeyCode.KEY_F) {
            this._perf?.toggle();
        }
    }

    private onKeyUp(ev: EventKeyboard): void {
        this._keys.delete(ev.keyCode);
    }

    /** 死亡 / 通关后点击任意处重开 */
    private onAnyTouchEnd(_ev: EventTouch): void {
        this._restartIfDead();
    }

    /** 桌面端鼠标抬起不会派发 TOUCH_END，需要单独接一份（手册 §11） */
    private onAnyMouseUp(_ev: EventMouse): void {
        this._restartIfDead();
    }

    private _restartIfDead(): void {
        const core = this._core;
        if (core && core.phase !== 'playing') this.startRun(false);
    }

    // ==================== 地牢事件 → 存档 ====================

    /** 渲染特效 + 断点续玩写档（§13.2：进房 / 清房 / 拾取 / 宝箱写，死亡 / 通关删） */
    private _handleEvents(events: CoreEvent[]): void {
        this.renderer?.pushEvents(events);
        const core = this._core;
        if (!core || events.length === 0) return;
        let dirty = false;
        let ended = false;
        for (const ev of events) {
            if (ev.type === 'room' || ev.type === 'clear' || ev.type === 'pickup' || ev.type === 'treasure') {
                dirty = true;
            } else if (ev.type === 'dead' || ev.type === 'won') {
                ended = true;
            }
        }
        if (ended) discardRun();
        else if (dirty) saveRun(core);
    }

    /** 切后台：补写一次档（微信可能直接杀进程） */
    private onGameHide(): void {
        const core = this._core;
        if (core && core.phase === 'playing') saveRun(core);
    }

    // ==================== 宝箱三选一 ====================

    private onTreasurePick(index: number): void {
        const core = this._core;
        if (!core) return;
        if (core.takeTreasure(index)) {
            saveRun(core);
        }
    }

    private onTreasureReroll(): void {
        const core = this._core;
        if (!core) return;
        if (core.rerollTreasure()) {
            saveRun(core);
        }
    }

    // ==================== 运行时节点 ====================

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
            ut.setContentSize(FIELD_W, FIELD_H);
            field.setPosition(0, FIELD_Y, 0);
            this.node.addChild(field);
        }
        this.renderer = field.getComponent(FridgeRenderer) || field.addComponent(FridgeRenderer);
    }

    private _ensureControls(): void {
        const parent = this.node.parent || this.node;
        let root = parent.getChildByName('Controls');
        if (!root) {
            root = new Node('Controls');
            root.layer = parent.layer;
            const ut = root.addComponent(UITransform);
            ut.setContentSize(720, 1280);
            parent.addChild(root);

            const left = new Node('JoystickLayer');
            left.layer = root.layer;
            const lut = left.addComponent(UITransform);
            lut.setContentSize(360, TOUCH_LAYER_H);
            left.setPosition(-180, TOUCH_LAYER_Y, 0);
            root.addChild(left);
            this._joystick = left.addComponent(FridgeJoystick);

            const right = new Node('AimLayer');
            right.layer = root.layer;
            const rut = right.addComponent(UITransform);
            rut.setContentSize(360, TOUCH_LAYER_H);
            right.setPosition(180, TOUCH_LAYER_Y, 0);
            root.addChild(right);
            this._aim = right.addComponent(FridgeAim);
        } else {
            const left = root.getChildByName('JoystickLayer');
            const right = root.getChildByName('AimLayer');
            this._joystick = left ? left.getComponent(FridgeJoystick) : null;
            this._aim = right ? right.getComponent(FridgeAim) : null;
        }
    }

    private _ensureHud(): void {
        const parent = this.node.parent || this.node;
        let node = parent.getChildByName('FridgeHud');
        if (!node) node = FridgeHud.create(parent).node;
        this._hud = node.getComponent(FridgeHud);
    }

    private _ensurePerf(): void {
        const parent = this.node.parent || this.node;
        let node = parent.getChildByName('FridgePerf');
        if (!node) node = FridgePerf.create(parent).node;
        this._perf = node.getComponent(FridgePerf);
    }

    // ==================== 安全区 ====================

    /** 读取 wx 安全区顶部，换算成设计像素；非小游戏环境返回 0 */
    private _readSafeTop(): number {
        const wx = (globalThis as unknown as {
            wx?: { getSystemInfoSync?: () => { safeArea?: { top?: number }; windowHeight?: number } };
        }).wx;
        if (!wx || typeof wx.getSystemInfoSync !== 'function') return 0;
        try {
            const sys = wx.getSystemInfoSync();
            const area = sys && sys.safeArea;
            if (!area || typeof area.top !== 'number' || !sys.windowHeight) return 0;
            return Math.max(0, Math.round(area.top * (DESIGN_H / sys.windowHeight)));
        } catch {
            return 0;
        }
    }

    /** 让返回按钮也避让刘海（场景节点，运行时只改位置，不改场景文件） */
    private _shiftBackButton(top: number): void {
        const parent = this.node.parent;
        if (!parent) return;
        const btn = parent.getChildByName('BackButton');
        if (btn && btn.isValid) btn.setPosition(btn.position.x, btn.position.y - top, 0);
    }

    // ==================== 调试接口（浏览器探针 / 验收） ====================

    debugStress(count: number): void {
        const core = this._core;
        if (!core) return;
        const kinds = ['moldball', 'canman'];
        for (let i = 0; i < count; i++) core.spawnEnemy(kinds[i % kinds.length]);
    }

    debugPerf(show?: boolean): void {
        const perf = this._perf;
        if (!perf) return;
        if (show === undefined) perf.toggle();
        else perf.setVisible(show);
    }
}

/** 高分辨率时钟；没有 `performance` 时退化为 Date.now（微信老基础库） */
function nowMs(): number {
    const p = (globalThis as unknown as { performance?: { now?: () => number } }).performance;
    return p && typeof p.now === 'function' ? p.now() : Date.now();
}
