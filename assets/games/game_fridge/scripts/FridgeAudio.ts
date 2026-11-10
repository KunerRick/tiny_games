/**
 * 冰箱底下 — 音效与震动（M5）。
 *
 * 为什么不用音频资源：仓库里没有任何 `.mp3/.wav`，微信小游戏也没有原生资源加载路径。
 * 这里用 WebAudio **程序化合成**（振荡器 + 噪声）现算现播：
 *  - 浏览器：`AudioContext`（首次触摸后 `resume()`，绕开自动播放限制）
 *  - 微信小游戏：`wx.createWebAudioContext()`（基础库 2.19+，Cocos 适配层不提供标准 `AudioContext`）
 *  - 两者都没有时静默降级（`available = false`），不影响玩法与帧率
 *
 * 震动：
 *  - 微信：`wx.vibrateShort({ type })` / `wx.vibrateLong()`
 *  - 浏览器：`navigator.vibrate(...)`（iOS Safari 无此 API，自动跳过）
 *
 * 偏好存单键 `tiny_games_fridge_audio`，**不进存档 schema**（避免为一条开关升 v4）。
 * 全部节点运行时创建，不改场景；onDestroy 只清引用（红线 4）。
 */

import { _decorator, Component, Graphics, Label, Node, sys, UITransform } from 'cc';
import { COLOR, hex } from '../../../common/ui/UITheme';
import { PAL } from './FridgeConfig';

const { ccclass } = _decorator;

const PREF_KEY = 'tiny_games_fridge_audio';
/** 主音量（0–1）：合成音本身音量已按事件分级，这里只做总闸 */
const MASTER_VOL = 0.9;

export type SfxName =
    | 'shoot' | 'hit' | 'kill' | 'playerHit' | 'pickup' | 'coin' | 'boom'
    | 'clear' | 'synergy' | 'active' | 'core' | 'floor' | 'secret'
    | 'dead' | 'won' | 'click';

type VibKind = 'light' | 'medium' | 'heavy';

interface ToneSpec {
    /** 起始频率（Hz） */
    f: number;
    /** 结束频率（Hz），省略 = 不滑音 */
    to?: number;
    /** 时长（秒） */
    dur: number;
    type: 'sine' | 'square' | 'triangle' | 'sawtooth';
    /** 峰值音量（0–1） */
    vol: number;
    /** 相对触发时刻的延迟（秒） */
    at?: number;
}

interface NoiseSpec {
    dur: number;
    vol: number;
    /** 低通截止（Hz），省略 = 不滤波 */
    cutoff?: number;
    at?: number;
}

interface SfxSpec {
    tones?: ToneSpec[];
    noises?: NoiseSpec[];
    /** 同名音效最小间隔（秒），防止 60fps 下刷屏 */
    gap?: number;
    vib?: VibKind;
    /** 长震（死亡） */
    vibLong?: boolean;
}

/** 事件 → 声音的配方表（集中在这里调参，改音量不用翻逻辑） */
const SPECS: Record<SfxName, SfxSpec> = {
    shoot: { gap: 0.075, tones: [{ f: 780, to: 520, dur: 0.06, type: 'square', vol: 0.045 }] },
    hit: { gap: 0.05, tones: [{ f: 320, to: 180, dur: 0.05, type: 'triangle', vol: 0.05 }] },
    kill: {
        gap: 0.05,
        tones: [{ f: 440, to: 130, dur: 0.09, type: 'square', vol: 0.06 }],
        noises: [{ dur: 0.06, vol: 0.05, cutoff: 2600 }],
    },
    playerHit: {
        gap: 0.15,
        tones: [{ f: 200, to: 80, dur: 0.22, type: 'sawtooth', vol: 0.12 }],
        vib: 'medium',
    },
    pickup: {
        gap: 0.06,
        tones: [
            { f: 660, dur: 0.06, type: 'square', vol: 0.06 },
            { f: 990, dur: 0.07, type: 'square', vol: 0.06, at: 0.05 },
        ],
        vib: 'light',
    },
    coin: {
        gap: 0.1,
        tones: [
            { f: 880, dur: 0.07, type: 'triangle', vol: 0.07 },
            { f: 1180, dur: 0.07, type: 'triangle', vol: 0.06, at: 0.05 },
            { f: 1560, dur: 0.09, type: 'triangle', vol: 0.05, at: 0.1 },
        ],
    },
    boom: {
        gap: 0.12,
        noises: [{ dur: 0.32, vol: 0.18, cutoff: 900 }],
        tones: [{ f: 140, to: 45, dur: 0.3, type: 'sine', vol: 0.14 }],
        vib: 'medium',
    },
    clear: {
        gap: 0.2,
        tones: [
            { f: 520, dur: 0.08, type: 'triangle', vol: 0.06 },
            { f: 780, dur: 0.12, type: 'triangle', vol: 0.06, at: 0.07 },
        ],
    },
    synergy: {
        gap: 0.3,
        tones: [
            { f: 700, dur: 0.1, type: 'triangle', vol: 0.08 },
            { f: 1050, dur: 0.1, type: 'triangle', vol: 0.07, at: 0.07 },
            { f: 1400, dur: 0.14, type: 'triangle', vol: 0.06, at: 0.14 },
        ],
    },
    active: {
        gap: 0.15,
        tones: [{ f: 300, to: 960, dur: 0.18, type: 'sine', vol: 0.1 }],
    },
    core: {
        gap: 0.5,
        tones: [
            { f: 523, dur: 0.14, type: 'triangle', vol: 0.09 },
            { f: 659, dur: 0.14, type: 'triangle', vol: 0.09, at: 0.09 },
            { f: 784, dur: 0.14, type: 'triangle', vol: 0.09, at: 0.18 },
            { f: 1047, dur: 0.24, type: 'triangle', vol: 0.08, at: 0.27 },
        ],
        vib: 'medium',
    },
    floor: {
        gap: 0.5,
        tones: [{ f: 280, to: 1200, dur: 0.36, type: 'sine', vol: 0.09 }],
    },
    secret: {
        gap: 0.4,
        tones: [
            { f: 900, dur: 0.09, type: 'sine', vol: 0.06 },
            { f: 1350, dur: 0.1, type: 'sine', vol: 0.05, at: 0.08 },
            { f: 900, dur: 0.09, type: 'sine', vol: 0.05, at: 0.18 },
        ],
    },
    dead: {
        gap: 1,
        tones: [{ f: 330, to: 55, dur: 0.8, type: 'sawtooth', vol: 0.16 }],
        vibLong: true,
    },
    won: {
        gap: 1,
        tones: [
            { f: 523, dur: 0.12, type: 'square', vol: 0.08 },
            { f: 659, dur: 0.12, type: 'square', vol: 0.08, at: 0.12 },
            { f: 784, dur: 0.12, type: 'square', vol: 0.08, at: 0.24 },
            { f: 1047, dur: 0.3, type: 'square', vol: 0.08, at: 0.36 },
        ],
        vib: 'heavy',
    },
    click: { gap: 0.03, tones: [{ f: 520, to: 640, dur: 0.04, type: 'square', vol: 0.05 }] },
};

/** 各音效上次播放时刻，用于 gap 节流 */
const LAST_PLAY: Partial<Record<SfxName, number>> = {};

/**
 * 音效总线（单例）。逻辑层只管 `sfx.play('xxx')`，
 * 环境差异、节流、静音、震动全部收在这里。
 */
export class FridgeAudio {
    /** 音频上下文是否可用（没有则所有 play 静默） */
    available = false;
    /** 音效开关 */
    sfxOn = true;
    /** 震动开关 */
    vibOn = true;

    private _ctx: any = null;
    private _master: any = null;
    private _noise: any = null;
    private _lastVib = 0;
    private _tried = false;

    constructor() {
        this._loadPref();
    }

    /** 音效与震动同时开关（顶栏按钮一键切） */
    get enabled(): boolean {
        return this.sfxOn || this.vibOn;
    }

    setEnabled(on: boolean): void {
        this.sfxOn = on;
        this.vibOn = on;
        this._savePref();
        if (on) this.play('click');
    }

    toggle(): boolean {
        this.setEnabled(!this.enabled);
        return this.enabled;
    }

    /**
     * 首次真正发声时才建上下文：浏览器要求用户手势之后才能出声，
     * 提前创建只会在控制台留一条 warning。
     */
    unlock(): void {
        this._ensureContext();
        const ctx = this._ctx;
        if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
            try { ctx.resume(); } catch { /* 忽略：某些环境不支持 resume */ }
        }
    }

    play(name: SfxName): void {
        if (!this.sfxOn) return;
        const spec = SPECS[name];
        if (!spec) return;
        const now = nowSec();
        const gap = spec.gap ?? 0;
        const last = LAST_PLAY[name];
        if (last !== undefined && now - last < gap) return;
        LAST_PLAY[name] = now;

        if (spec.vib) this._vibrate(spec.vib);
        if (spec.vibLong) this._vibrateLong();

        const ctx = this._ensureContext();
        if (!ctx) return;
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
            try { ctx.resume(); } catch { /* 同 unlock */ }
        }
        if (spec.tones) for (const t of spec.tones) this._tone(ctx, t);
        if (spec.noises) for (const n of spec.noises) this._noiseBurst(ctx, n);
    }

    // ==================== 合成 ====================

    private _ensureContext(): any {
        if (this._ctx) return this._ctx;
        if (this._tried) return null;
        this._tried = true;
        const ctx = createAudioContext();
        if (!ctx) return null;
        this._ctx = ctx;
        this.available = true;
        try {
            this._master = typeof ctx.createGain === 'function' ? ctx.createGain() : null;
            if (this._master) {
                this._master.gain.value = MASTER_VOL;
                this._master.connect(ctx.destination);
            }
        } catch {
            this._master = null;
        }
        return ctx;
    }

    private _tone(ctx: any, spec: ToneSpec): void {
        if (typeof ctx.createOscillator !== 'function' || typeof ctx.createGain !== 'function') return;
        try {
            const t0 = ctx.currentTime + (spec.at ?? 0);
            const t1 = t0 + spec.dur;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = spec.type;
            osc.frequency.setValueAtTime(Math.max(1, spec.f), t0);
            if (spec.to && spec.to !== spec.f) {
                osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to), t1);
            }
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, spec.vol), t0 + Math.min(0.01, spec.dur * 0.3));
            gain.gain.exponentialRampToValueAtTime(0.0001, t1);
            osc.connect(gain);
            gain.connect(this._master || ctx.destination);
            osc.start(t0);
            osc.stop(t1 + 0.02);
        } catch {
            // 单个音效失败不影响其它（微信 WebAudio 对部分节点支持有差异）
        }
    }

    private _noiseBurst(ctx: any, spec: NoiseSpec): void {
        if (typeof ctx.createBufferSource !== 'function' || typeof ctx.createGain !== 'function') return;
        try {
            if (!this._noise) this._noise = this._buildNoise(ctx);
            if (!this._noise) return;
            const t0 = ctx.currentTime + (spec.at ?? 0);
            const src = ctx.createBufferSource();
            src.buffer = this._noise;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(Math.max(0.0002, spec.vol), t0);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur);
            let tail: any = src;
            if (spec.cutoff && typeof ctx.createBiquadFilter === 'function') {
                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = spec.cutoff;
                src.connect(filter);
                tail = filter;
            }
            tail.connect(gain);
            gain.connect(this._master || ctx.destination);
            src.start(t0);
            src.stop(t0 + Math.min(spec.dur, 0.5) + 0.02);
        } catch {
            // 同上
        }
    }

    /** 0.4s 白噪声，一次生成复用（避免每次爆炸都算一遍） */
    private _buildNoise(ctx: any): any {
        if (typeof ctx.createBuffer !== 'function') return null;
        try {
            const rate = typeof ctx.sampleRate === 'number' && ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
            const len = Math.floor(rate * 0.4);
            const buf = ctx.createBuffer(1, len, rate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
            return buf;
        } catch {
            return null;
        }
    }

    // ==================== 震动 ====================

    private _vibrate(kind: VibKind): void {
        if (!this.vibOn) return;
        const now = nowSec();
        if (now - this._lastVib < 0.06) return;
        this._lastVib = now;
        const wx = wxApi();
        if (wx && typeof wx.vibrateShort === 'function') {
            try { wx.vibrateShort({ type: kind }); } catch {
                try { wx.vibrateShort(); } catch { /* 老基础库不支持 type */ }
            }
            return;
        }
        const nav = navApi();
        if (nav && typeof nav.vibrate === 'function') {
            try { nav.vibrate(kind === 'heavy' ? 60 : kind === 'medium' ? 35 : 18); } catch { /* 忽略 */ }
        }
    }

    private _vibrateLong(): void {
        if (!this.vibOn) return;
        const wx = wxApi();
        if (wx && typeof wx.vibrateLong === 'function') {
            try { wx.vibrateLong(); return; } catch { /* 落回短震 */ }
        }
        if (wx && typeof wx.vibrateShort === 'function') {
            try { wx.vibrateShort({ type: 'heavy' }); return; } catch { /* 忽略 */ }
        }
        const nav = navApi();
        if (nav && typeof nav.vibrate === 'function') {
            try { nav.vibrate([0, 90, 60, 90]); } catch { /* 忽略 */ }
        }
    }

    // ==================== 偏好 ====================

    private _loadPref(): void {
        try {
            const raw = sys.localStorage.getItem(PREF_KEY);
            if (!raw) return;
            const obj = JSON.parse(raw) as { sfx?: boolean; vib?: boolean };
            if (typeof obj.sfx === 'boolean') this.sfxOn = obj.sfx;
            if (typeof obj.vib === 'boolean') this.vibOn = obj.vib;
        } catch {
            // 坏偏好文件：按默认（开）走
        }
    }

    private _savePref(): void {
        try {
            sys.localStorage.setItem(PREF_KEY, JSON.stringify({ sfx: this.sfxOn, vib: this.vibOn }));
        } catch {
            // 存储满 / 被禁用：静默
        }
    }
}

/** 全局单例 */
export const sfx = new FridgeAudio();

function nowSec(): number {
    const p = (globalThis as unknown as { performance?: { now?: () => number } }).performance;
    return (p && typeof p.now === 'function' ? p.now() : Date.now()) / 1000;
}

function createAudioContext(): any {
    const g = globalThis as unknown as {
        wx?: { createWebAudioContext?: () => any };
        AudioContext?: new () => any;
        webkitAudioContext?: new () => any;
    };
    // 微信小游戏优先：Cocos 适配层没有标准 AudioContext
    if (g.wx && typeof g.wx.createWebAudioContext === 'function') {
        try { return g.wx.createWebAudioContext() || null; } catch { return null; }
    }
    const Ctor = g.AudioContext || g.webkitAudioContext;
    if (typeof Ctor === 'function') {
        try { return new Ctor(); } catch { return null; }
    }
    return null;
}

function wxApi(): any {
    const wx = (globalThis as unknown as { wx?: any }).wx;
    return wx && typeof wx === 'object' ? wx : null;
}

function navApi(): { vibrate?: (p: number | number[]) => boolean } | null {
    const nav = (globalThis as unknown as { navigator?: any }).navigator;
    return nav && typeof nav === 'object' ? nav : null;
}

// ==================== 顶栏开关（右上角） ====================

const BTN_W = 104;
const BTN_H = 40;
/** 右上角：场景里的返回按钮在 x=300（宽 96，左缘 252），这里留出 10px 间隙 */
const BTN_X = 190;
const BTN_Y = 604;

/**
 * 顶栏「音效」开关（规格 §3：右上角 暂停 / 音效 / 返回）。
 * 关闭后音效与震动同时停；偏好跨局持久。
 */
@ccclass('FridgeAudioUi')
export class FridgeAudioUi extends Component {
    private _btn: Node | null = null;
    private _bg: Graphics | null = null;
    private _label: Label | null = null;
    private _safeTop = 0;

    static create(parent: Node): FridgeAudioUi {
        const node = new Node('FridgeAudioUi');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        parent.addChild(node);
        return node.addComponent(FridgeAudioUi);
    }

    onLoad(): void {
        this._build();
        const g = globalThis as unknown as { __fridgeAudio?: FridgeAudio };
        g.__fridgeAudio = sfx;
    }

    onDestroy(): void {
        if (this._btn && this._btn.isValid) {
            this._btn.off(Node.EventType.TOUCH_END, this.onToggleTapped, this);
        }
        this._btn = null;
        this._bg = null;
        this._label = null;
        const g = globalThis as unknown as { __fridgeAudio?: FridgeAudio };
        if (g.__fridgeAudio === sfx) g.__fridgeAudio = undefined;
    }

    /** 顶栏整体下移刘海高度（设计像素） */
    setSafeTop(top: number): void {
        this._safeTop = Math.max(0, top);
        if (this._btn && this._btn.isValid) this._btn.setPosition(BTN_X, BTN_Y - this._safeTop, 0);
    }

    /** 音效开关被点击时的回调（FridgeGame 用来播一声确认音） */
    private onToggleTapped(): void {
        sfx.toggle();
        this._repaint();
    }

    private _build(): void {
        const node = new Node('SfxToggle');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(BTN_W, BTN_H);
        node.setPosition(BTN_X, BTN_Y, 0);
        this.node.addChild(node);
        this._btn = node;

        this._bg = node.addComponent(Graphics);
        this._paintBg();

        const labelNode = new Node('Text');
        labelNode.layer = this.node.layer;
        const lut = labelNode.addComponent(UITransform);
        lut.setContentSize(BTN_W - 8, BTN_H);
        lut.setAnchorPoint(0.5, 0.5);
        const label = labelNode.addComponent(Label);
        label.fontSize = 17;
        label.lineHeight = 22;
        label.color = hex(COLOR.TEXT_SECONDARY);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.NONE;
        node.addChild(labelNode);
        this._label = label;
        this._updateText();

        node.on(Node.EventType.TOUCH_END, this.onToggleTapped, this);
    }

    private _repaint(): void {
        this._paintBg();
        this._updateText();
    }

    private _paintBg(): void {
        const g = this._bg;
        if (!g) return;
        g.clear();
        g.fillColor = hex(PAL.panel, sfx.enabled ? 200 : 130);
        g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, 10);
        g.fill();
    }

    private _updateText(): void {
        if (!this._label) return;
        // 用汉字而不是 ✓/✕：微信字体对符号的支持不稳（AGENTS 红线 10）
        this._label.string = sfx.enabled ? '音效 开' : '音效 关';
        this._label.color = hex(sfx.enabled ? COLOR.TEXT_SECONDARY : COLOR.TEXT_DISABLED);
    }
}
