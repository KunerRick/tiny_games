/**
 * 冰箱底下 — 音效与震动入口（M5）。
 *
 * 合成引擎已上提到 `assets/common/audio/GameAudio.ts`（试玩修复 C1 统一全站音效），
 * 本文件只保留「冰箱底下」的单例与顶栏开关 UI。配方、音量、节流逻辑都在公共模块。
 *
 * 偏好键：`tiny_games_fridge_audio`（公共模块按 gameId 自动拼）。
 * 全部节点运行时创建，不改场景；onDestroy 只清引用（红线 4）。
 */

import { _decorator, Component, Graphics, Label, Node, UITransform } from 'cc';
import { GameAudio } from '../../../common/audio/GameAudio';
import { COLOR, hex } from '../../../common/ui/UITheme';
import { PAL } from './FridgeConfig';

const { ccclass } = _decorator;

export type { SfxName } from '../../../common/audio/GameAudio';

/** 冰箱底下的音效单例 */
export class FridgeAudio extends GameAudio {
    constructor() {
        super('fridge');
    }
}

export const sfx = new FridgeAudio();

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
