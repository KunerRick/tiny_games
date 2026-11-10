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
import { FIXED_DT, FIELD_H, FIELD_W, ITEM_BY_ID, UNLOCK_BY_ID, dailyDateKey, evaluateUnlocks } from './FridgeConfig';
import type { CoreEvent } from './FridgeConfig';
import { discardRun, loadMeta, loadRun, saveMeta, saveRun } from './FridgeDungeon';
import type { FridgeSave } from './FridgeDungeon';
import { FridgeAim } from './FridgeAim';
import { FridgeAudioUi, sfx } from './FridgeAudio';
import { FridgeHud } from './FridgeHud';
import { FridgeJoystick } from './FridgeJoystick';
import { FridgeMenu } from './FridgeMenu';
import type { MenuStartOptions } from './FridgeMenu';
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
    _menu: FridgeMenu | null = null;
    _sfxUi: FridgeAudioUi | null = null;
    _meta: FridgeSave | null = null;
    _paused = false;

    /** 上一局的模式，按 R 快速重开用 */
    private _lastOpts: MenuStartOptions | null = null;
    /** 本局是否已结算（避免 dead / won 事件重复结算） */
    private _settled = false;

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
        // 音效开关节点先于菜单创建，菜单全屏时才能盖住它
        this._ensureAudio();
        this._ensureMenu();

        const safeTop = this._readSafeTop();
        this._hud?.setSafeTop(safeTop);
        this._perf?.setSafeTop(safeTop);
        this._sfxUi?.setSafeTop(safeTop);
        if (safeTop > 0) this._shiftBackButton(safeTop);
        if (this._hud) {
            this._hud.onRestartRequested = () => this.openMenu();
            this._hud.onTreasurePick = (index: number) => this.onTreasurePick(index);
            this._hud.onTreasureReroll = () => this.onTreasureReroll();
            this._hud.onActiveRequested = () => this.useActive();
            this._hud.onBombRequested = () => this.useBomb();
            this._hud.onShopBuy = (index: number) => this.onShopBuy(index);
            this._hud.onShopLeave = () => this.onShopLeave();
            this._hud.onAltarTake = () => this.onAltarTake();
            this._hud.onAltarLeave = () => this.onAltarLeave();
            this._hud.onCorePick = (index: number) => this.onCorePick(index);
        }

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        // 首次交互时解锁音频上下文（浏览器自动播放限制 / 微信需要用户手势）
        input.on(Input.EventType.TOUCH_START, this.onAnyTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this.onAnyTouchEnd, this);
        input.on(Input.EventType.MOUSE_UP, this.onAnyMouseUp, this);
        game.on(Game.EVENT_HIDE, this.onGameHide, this);

        // 菜单优先：有存档就显示「继续上局」，不自动开局（M4）
        this._meta = loadMeta();
        this.renderer?.setPlayerPalette(this._meta.palette);
        if (this._menu) {
            this._menu.onStart = (opts: MenuStartOptions) => this.startNewRun(opts);
            this._menu.onContinue = () => this.continueRun();
            this._menu.onBuyUnlock = (id: string) => this.buyUnlock(id);
            this._menu.onSelectPalette = (index: number) => this.selectPalette(index);
            this._menu.setMeta(this._meta);
            this._menu.setHasRun(!!loadRun());
            this._menu.show();
        }
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.TOUCH_START, this.onAnyTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onAnyTouchEnd, this);
        input.off(Input.EventType.MOUSE_UP, this.onAnyMouseUp, this);
        game.off(Game.EVENT_HIDE, this.onGameHide, this);
        if (this._hud) {
            this._hud.onRestartRequested = null;
            this._hud.onTreasurePick = null;
            this._hud.onTreasureReroll = null;
            this._hud.onActiveRequested = null;
            this._hud.onBombRequested = null;
            this._hud.onShopBuy = null;
            this._hud.onShopLeave = null;
            this._hud.onAltarTake = null;
            this._hud.onAltarLeave = null;
            this._hud.onCorePick = null;
        }
        if (this._menu) {
            this._menu.onStart = null;
            this._menu.onContinue = null;
            this._menu.onBuyUnlock = null;
            this._menu.onSelectPalette = null;
        }
        this._keys.clear();
        this._core = null;
        this._joystick = null;
        this._aim = null;
        this._hud = null;
        this._perf = null;
        this._menu = null;
        this._sfxUi = null;
        this._meta = null;
        this._input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, firing: false };
    }

    /**
     * 继续上局：读档续玩（页面重载 / 切后台回来）。坏档直接丢弃并提示。
     */
    continueRun(): void {
        const save = loadRun();
        if (save) {
            try {
                const core = FridgeWorld.fromSave(save);
                this._lastOpts = {
                    charId: save.charId, mode: save.mode,
                    startFloor: save.startFloor, heatCurses: save.heatCurses.slice(),
                };
                this._beginCore(core);
                return;
            } catch {
                // 坏档：落到下面丢弃
            }
        }
        discardRun();
        if (this._menu) {
            this._menu.setHasRun(false);
            this._menu.setTip('没有可继续的存档');
        }
    }

    /** 开新局（菜单选好模式 / 角色 / 起始层） */
    startNewRun(opts: MenuStartOptions): void {
        discardRun();
        const seed = this.seed || (Date.now() % 2147483647);
        const core = FridgeWorld.newRun(seed, opts.charId, {
            mode: opts.mode,
            startFloor: opts.startFloor,
            heatCurses: opts.heatCurses.slice(),
            unlocks: this._meta ? this._meta.unlocks.slice() : [],
        });
        this._lastOpts = opts;
        this._beginCore(core);
    }

    private _beginCore(core: FridgeWorld): void {
        this._core = core;
        this._settled = false;
        this._acc = 0;
        this._steps = 0;
        this._paused = false;
        this._joystick?.release();
        this._aim?.release();
        this.renderer?.resetFx();
        this._hud?.clearResultLines();
        this._hud?.refresh(core.snapshot());
        this._menu?.hide();
        // 刚开一局就写一次档：瞬间杀进程也能回到起点房
        saveRun(core);
        this._menu?.setHasRun(true);
    }

    /** 回主菜单（死亡 / 通关后点击，或主动退出）；局内存档保留 */
    openMenu(): void {
        this._core = null;
        this._acc = 0;
        this._steps = 0;
        this._paused = false;
        this._joystick?.release();
        this._aim?.release();
        if (!this._meta) this._meta = loadMeta();
        if (this._menu) {
            this._menu.setMeta(this._meta);
            this._menu.setHasRun(!!loadRun());
            this._menu.show();
        }
    }

    /** 花冰箱贴买解锁节点（菜单回调） */
    buyUnlock(id: string): void {
        const meta = this._meta;
        const node = UNLOCK_BY_ID[id];
        if (!meta || !node || !this._menu) return;
        if (meta.unlocks.indexOf(id) >= 0) return;
        if (meta.magnets < node.price) {
            this._menu.setTip(`还需要 ${node.price - meta.magnets} 个冰箱贴`);
            return;
        }
        meta.magnets -= node.price;
        meta.unlocks.push(id);
        if (id === 'palette1') meta.palette = 1;
        else if (id === 'palette2') meta.palette = 2;
        else if (id === 'palette3') meta.palette = 3;
        saveMeta(meta);
        this.renderer?.setPlayerPalette(meta.palette);
        this._menu.setMeta(meta);
        this._menu.setTip(`已解锁：${node.name}`);
    }

    /** 选中已解锁的配色（解锁树里点调色板节点） */
    selectPalette(index: number): void {
        const meta = this._meta;
        if (!meta || !this._menu) return;
        if (index < 0 || index > 3) return;
        meta.palette = index;
        saveMeta(meta);
        this.renderer?.setPlayerPalette(index);
        this._menu.setMeta(meta);
    }

    /** 死亡 / 通关结算：冰箱贴、统计、图鉴、条件解锁、每日记录 */
    private _settle(core: FridgeWorld): void {
        if (this._settled) return;
        this._settled = true;
        const meta = this._meta || loadMeta();
        const summary = core.runSummary();
        const magnets = core.magnetReward();

        const newItems: string[] = [];
        for (const id of core.items) {
            if (meta.seenItems.indexOf(id) < 0) {
                meta.seenItems.push(id);
                newItems.push(id);
            }
        }
        for (const id of core.synergiesSeen) {
            if (meta.seenSynergies.indexOf(id) < 0) meta.seenSynergies.push(id);
        }

        // 条件解锁必须在统计累加之前判定（它自己会把本局 summary 一起算进去）
        const newUnlocks = evaluateUnlocks(meta, summary);
        for (const id of newUnlocks) {
            if (meta.unlocks.indexOf(id) < 0) meta.unlocks.push(id);
        }

        meta.stats.runs += 1;
        if (summary.won) {
            meta.stats.wins += 1;
            if (meta.stats.charClears.indexOf(summary.charId) < 0) meta.stats.charClears.push(summary.charId);
        }
        meta.stats.kills += summary.kills;
        meta.stats.secrets += summary.secretsOpened;
        meta.stats.spent += summary.shopSpent;
        meta.stats.bestFloor = Math.max(meta.stats.bestFloor, summary.floorReached);
        meta.stats.maxClearedFloor = Math.max(meta.stats.maxClearedFloor, summary.maxClearedFloor);
        meta.magnets += magnets;

        if (core.mode === 'daily') {
            const key = dailyDateKey(new Date());
            const prev = meta.daily && meta.daily.date === key ? meta.daily.bestFloor : 0;
            meta.daily = {
                date: key,
                charId: core.charId,
                bestFloor: Math.max(prev, summary.floorReached),
                // cleared 表示这次每日是否通关；「每天一次」由「今天已有记录」保证
                cleared: summary.won,
            };
        }

        saveMeta(meta);
        discardRun();
        this._meta = meta;

        const lines: string[] = [];
        lines.push(summary.won ? `逃出生天！冰箱贴 +${magnets}` : `冰箱贴 +${magnets}（失败折半）`);
        if (newItems.length > 0) {
            const names: string[] = [];
            for (const id of newItems.slice(0, 4)) {
                const def = ITEM_BY_ID[id];
                names.push(def ? def.name : id);
            }
            lines.push(`图鉴新增 ${newItems.length} 件：${names.join('、')}${newItems.length > 4 ? '…' : ''}`);
        }
        if (newUnlocks.length > 0) {
            const names: string[] = [];
            for (const id of newUnlocks) {
                const n = UNLOCK_BY_ID[id];
                names.push(n ? n.name : id);
            }
            lines.push(`新解锁：${names.join('、')}`);
        }
        this._hud?.setResultLines(lines);
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
        } else {
            // 非 playing（死亡 / 通关）时也要把事件排空，否则结算与删档会漏掉
            const pending = core.drainEvents();
            if (pending.length > 0) this._handleEvents(pending);
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
    }

    // ==================== 输入 ====================

    private _readInput(): void {
        const core = this._core;
        if (core && (core.pendingTreasure || core.pendingCore || core.pendingShop || core.pendingAltar)) {
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
        sfx.unlock();
        if (ev.keyCode === KeyCode.KEY_R) {
            const core = this._core;
            if (!core) return;
            if (core.phase !== 'playing') this.openMenu();
            else if (this._lastOpts) this.startNewRun(this._lastOpts);
        } else if (ev.keyCode === KeyCode.KEY_P) {
            this._paused = !this._paused;
        } else if (ev.keyCode === KeyCode.KEY_K) {
            this.debugStress(20);
        } else if (ev.keyCode === KeyCode.KEY_F) {
            this._perf?.toggle();
        } else if (ev.keyCode === KeyCode.KEY_Q) {
            this.useActive();
        } else if (ev.keyCode === KeyCode.KEY_E) {
            this.useBomb();
        }
    }

    private onKeyUp(ev: EventKeyboard): void {
        this._keys.delete(ev.keyCode);
    }

    /** 死亡 / 通关后点击任意处：回主菜单看结算 */
    private onAnyTouchEnd(_ev: EventTouch): void {
        this._restartIfDead();
    }

    /** 首次触摸解锁音频（浏览器要求用户手势之后才能出声） */
    private onAnyTouchStart(_ev: EventTouch): void {
        sfx.unlock();
    }

    /** 桌面端鼠标抬起不会派发 TOUCH_END，需要单独接一份（手册 §11） */
    private onAnyMouseUp(_ev: EventMouse): void {
        this._restartIfDead();
    }

    private _restartIfDead(): void {
        const core = this._core;
        if (core && core.phase !== 'playing') this.openMenu();
    }

    /** 主动槽：角色技能 / 主动道具共用（按钮点击或 Q 键） */
    private useActive(): void {
        const core = this._core;
        if (!core) return;
        const used = core.useActive();
        this._handleEvents(core.drainEvents());
        if (!used) {
            const cost = core.activeCost();
            if (core.phase === 'playing' && !core.pendingTreasure && core.player.charges < cost) {
                this._hud?.showToast(`充能不足（${core.player.charges}/${cost}）`);
            }
        }
        this._hud?.refresh(core.snapshot());
    }

    /** 炸弹：按钮或 E 键（桌面调试） */
    private useBomb(): void {
        const core = this._core;
        if (!core) return;
        const ok = core.useBomb();
        this._handleEvents(core.drainEvents());
        if (!ok && core.phase === 'playing'
            && !core.pendingTreasure && !core.pendingShop && !core.pendingAltar
            && core.player.bombs <= 0) {
            this._hud?.showToast('没有炸弹了');
            sfx.play('click');
        }
        this._hud?.refresh(core.snapshot());
    }

    // ==================== 商店 / 祭坛 ====================

    private onShopBuy(index: number): void {
        const core = this._core;
        if (!core) return;
        const offer = core.buyShop(index);
        if (offer) {
            const name = offer.kind === 'item'
                ? (ITEM_BY_ID[offer.id] ? ITEM_BY_ID[offer.id].name : offer.id)
                : offer.kind === 'heart' ? '半颗心' : '炸弹';
            this._hud?.showToast(`买下：${name}（−${offer.price} 币）`);
            sfx.play('coin');
            saveRun(core);
        } else {
            const shop = core.pendingShop;
            if (shop) {
                const sold = shop.sold[index];
                this._hud?.showToast(sold ? '这个已经卖掉了' : '金币不够');
                sfx.play('click');
            }
        }
        this._hud?.refresh(core.snapshot());
    }

    private onShopLeave(): void {
        const core = this._core;
        if (!core) return;
        core.closeShop();
        saveRun(core);
        this._hud?.refresh(core.snapshot());
    }

    private onAltarTake(): void {
        const core = this._core;
        if (!core) return;
        if (core.takeAltar()) {
            this._hud?.showToast('献祭 1 颗心，换来一件道具');
            sfx.play('pickup');
            saveRun(core);
        } else if (core.pendingAltar) {
            this._hud?.showToast(core.pendingAltar.used ? '祭坛已经空了' : '心不够（至少留 1 颗心）');
            sfx.play('click');
        }
        this._hud?.refresh(core.snapshot());
    }

    private onAltarLeave(): void {
        const core = this._core;
        if (!core) return;
        core.closeAltar();
        saveRun(core);
        this._hud?.refresh(core.snapshot());
    }

    /** 渲染特效 + 断点续玩写档（§13.2：进房 / 清房 / 拾取 / 宝箱写，死亡 / 通关删） */
    private _handleEvents(events: CoreEvent[]): void {
        this.renderer?.pushEvents(events);
        const core = this._core;
        if (!core || events.length === 0) return;
        let dirty = false;
        let ended = false;
        for (const ev of events) {
            this._playEventSfx(ev);
            if (ev.type === 'room' || ev.type === 'clear' || ev.type === 'pickup'
                || ev.type === 'treasure' || ev.type === 'shop' || ev.type === 'altar') {
                dirty = true;
            } else if (ev.type === 'secret') {
                dirty = true;
                this._hud?.showToast('墙后好像有东西…秘密房！');
            } else if (ev.type === 'bomb' && ev.r > 0) {
                dirty = true;
            } else if (ev.type === 'dead' || ev.type === 'won') {
                ended = true;
            } else if (ev.type === 'core') {
                this._hud?.showToast('Boss 倒下：选一枚核心');
            } else if (ev.type === 'floor') {
                this._hud?.showToast(`进入第 ${ev.floor} 层`);
            } else if (ev.type === 'synergy') {
                this._hud?.showToast(`协同点亮：${ev.name}`);
            } else if (ev.type === 'active') {
                this._hud?.showToast(`释放：${ev.name}`);
            }
        }
        if (ended) this._settle(core);
        else if (dirty) saveRun(core);
    }

    /** 核心事件 → 音效 / 震动（M5）。节流与静音判断都在 FridgeAudio 内部 */
    private _playEventSfx(ev: CoreEvent): void {
        switch (ev.type) {
            case 'shoot': sfx.play('shoot'); break;
            case 'hit': sfx.play('hit'); break;
            case 'kill': sfx.play('kill'); break;
            case 'playerHit': sfx.play('playerHit'); break;
            case 'pickup': sfx.play('pickup'); break;
            case 'boom': sfx.play('boom'); break;
            case 'bomb': if (ev.r > 0) sfx.play('boom'); break;
            case 'treasure':
            case 'shop':
            case 'altar': sfx.play('coin'); break;
            case 'clear': sfx.play('clear'); break;
            case 'synergy': sfx.play('synergy'); break;
            case 'active': sfx.play('active'); break;
            case 'core': sfx.play('core'); break;
            case 'floor': sfx.play('floor'); break;
            case 'secret': sfx.play('secret'); break;
            case 'dead': sfx.play('dead'); break;
            case 'won': sfx.play('won'); break;
            default: break;
        }
    }

    /** 切后台：补写一次档（微信可能直接杀进程） */
    private onGameHide(): void {
        const core = this._core;
        if (core && core.phase === 'playing') saveRun(core);
    }

    /** Boss 核心三选一（M4） */
    private onCorePick(index: number): void {
        const core = this._core;
        if (!core) return;
        if (core.chooseCore(index)) {
            saveRun(core);
            sfx.play('pickup');
            this._hud?.showToast(`获得核心（本局 ${core.cores.length} 枚）`);
        }
        this._hud?.refresh(core.snapshot());
    }

    // ==================== 宝箱三选一 ====================

    private onTreasurePick(index: number): void {
        const core = this._core;
        if (!core) return;
        if (core.takeTreasure(index)) {
            saveRun(core);
            sfx.play('pickup');
        }
    }

    private onTreasureReroll(): void {
        const core = this._core;
        if (!core) return;
        if (core.rerollTreasure()) {
            saveRun(core);
            sfx.play('click');
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

    private _ensureAudio(): void {
        const parent = this.node.parent || this.node;
        let node = parent.getChildByName('FridgeAudioUi');
        if (!node) node = FridgeAudioUi.create(parent).node;
        this._sfxUi = node.getComponent(FridgeAudioUi);
    }

    private _ensureMenu(): void {
        const parent = this.node.parent || this.node;
        let node = parent.getChildByName('FridgeMenu');
        if (!node) node = FridgeMenu.create(parent).node;
        this._menu = node.getComponent(FridgeMenu);
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
