/**
 * 《秘银远征》音效与震动入口（M10）。
 *
 * 合成引擎在 `assets/common/audio/GameAudio.ts`（全站总线，`pool` / `thunder` / `fridge` 已接入）：
 * 程序化 WebAudio 合成、`wx.vibrateShort/vibrateLong`、`navigator.vibrate`、按名字节流、
 * 偏好存单键 `tiny_games_mithril_audio`（**不进游戏存档 schema**）。
 * 本文件只提供「秘银远征」的单例与路线图顶栏开关 UI；事件 → 音效名的映射在
 * `MithrilAudioMap.ts`（零 import 纯模块，脚本可在 Node 里断言）。
 *
 * 全部节点运行时创建，不改场景；`onDestroy` 只清引用（红线 4）。
 */

import { _decorator, Component, Graphics, Label, Node, UITransform } from 'cc';
import { GameAudio } from '../../../common/audio/GameAudio';
import { COLOR, hex } from '../../../common/ui/GameUIKit';
import type { CoreEvent } from './MithrilCore';
import { coreEventSfx } from './MithrilAudioMap';

const { ccclass } = _decorator;

export type { SfxName } from '../../../common/audio/GameAudio';
export { coreEventSfx } from './MithrilAudioMap';
export type { MithrilSfx } from './MithrilAudioMap';

/** 秘银远征的音效单例 */
export class MithrilAudio extends GameAudio {
    constructor() {
        super('mithril');
    }
}

export const sfx = new MithrilAudio();

/** 一批核心事件 → 逐条发声（同一帧内同名音效由 `GameAudio` 的 gap 节流） */
export function playCoreEvents(events: readonly CoreEvent[]): void {
    for (const ev of events) {
        const name = coreEventSfx(ev);
        if (name) sfx.play(name);
    }
}

// ==================== 路线图顶栏开关 ====================

const BTN_W = 104;
const BTN_H = 40;
/**
 * 顶栏右上角。位置约束（`MithrilWildMap` 实测布局）：
 *  - 标题 34 号字居中（宽 680），实际字形在 x −140..140 之间 → 右侧 240..352 空着；
 *  - 下沿 578 不碰区域页签（y 478，高 42 → 上沿 499）与三条状态标签（y 526）。
 * 战斗 HUD 没有同等空位（顶栏右侧是进度/计时、下方 BOSS 条横跨中线），
 * 所以开关只在路线图（hub）出现 —— 进战斗前/后各一次点按足够。
 */
const BTN_X = 300;
const BTN_Y = 598;

/**
 * 顶栏「音效」开关：同时控制音效与震动，偏好跨会话持久。
 * 文字用汉字而不是 ✓/✕（红线 10：微信字体对符号支持不稳）。
 */
@ccclass('MithrilAudioUi')
export class MithrilAudioUi extends Component {
    private _btn: Node | null = null;
    private _bg: Graphics | null = null;
    private _label: Label | null = null;

    static create(parent: Node): MithrilAudioUi {
        const node = new Node('MithrilAudioUi');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        parent.addChild(node);
        return node.addComponent(MithrilAudioUi);
    }

    onLoad(): void {
        this._build();
        // 浏览器 / 试玩探针：读 available / sfxOn / vibOn，不依赖组件查找
        const g = globalThis as unknown as { __mithrilAudio?: MithrilAudio };
        g.__mithrilAudio = sfx;
    }

    onDestroy(): void {
        if (this._btn && this._btn.isValid) {
            this._btn.off(Node.EventType.TOUCH_END, this.onToggleTapped, this);
        }
        this._btn = null;
        this._bg = null;
        this._label = null;
        const g = globalThis as unknown as { __mithrilAudio?: MithrilAudio };
        if (g.__mithrilAudio === sfx) g.__mithrilAudio = undefined;
    }

    /** 测试 / 调试用：直接读开关状态（与偏好文件一致） */
    get enabled(): boolean {
        return sfx.enabled;
    }

    private onToggleTapped(): void {
        // 首次点击必然是用户手势：顺手把 AudioContext 解锁（浏览器自动播放限制）
        sfx.unlock();
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
        g.fillColor = hex(COLOR.SLOT_EMPTY_BG, sfx.enabled ? 200 : 130);
        g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, 10);
        g.fill();
        g.strokeColor = hex(COLOR.PANEL_BORDER, sfx.enabled ? 170 : 90);
        g.lineWidth = 1.5;
        g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, 10);
        g.stroke();
    }

    private _updateText(): void {
        if (!this._label) return;
        this._label.string = sfx.enabled ? '音效 开' : '音效 关';
        this._label.color = hex(sfx.enabled ? COLOR.TEXT_SECONDARY : COLOR.TEXT_DISABLED);
    }
}
