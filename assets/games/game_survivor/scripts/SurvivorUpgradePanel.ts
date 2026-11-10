/**
 * 午夜幸存者 — 升级三选一面板（M3）。
 *
 * 规格 §3.6.2 / §5.1：全屏遮罩 + 3 张竖排卡片（560 × 180），点哪张选哪张。
 *  - 面板由代码在运行时创建（不往 .scene 里加节点），与摇杆同一套做法
 *  - 打开时游戏层停止推进核心；遮罩吞掉 TOUCH_START，避免点卡片时摇杆跟着动
 *  - 卡面只写「变化量」（核心已经生成好 title / detail）
 *  - 事件在 show() 绑定、hide() 解绑（防崩溃守则 6），handler 全部命名方法（红线 5）
 */

import { _decorator, Component, EventTouch, Graphics, Label, Node, UITransform } from 'cc';
import { COLOR, hex } from '../../../common/ui/UITheme';
import { COLORS, UpgradeOffer } from './SurvivorConfig';

const { ccclass } = _decorator;

const CARD_W = 560;
const CARD_H = 180;
/** 文本区：图标占左侧 96 px */
const TEXT_X = 44;
const TEXT_W = 396;
/** 图标中心 */
const ICON_X = -216;
const ICON_R = 30;
/** 三张卡的中心 y（Canvas 中心为原点） */
const CARD_YS = [250, 40, -170];

/** 面板遮罩底：本品夜色；卡片底与文字走全站令牌 */
const PANEL_BG = COLORS.panelBg;
const CARD_BG = COLOR.PANEL_BG;
const TEXT_PRIMARY = COLOR.TEXT_PRIMARY;
const TEXT_SECONDARY = COLOR.TEXT_SECONDARY;

/** 卡牌类别 → 边框/标签颜色（沿用敌人与玩家的主色，不新增色） */
const KIND_COLORS: Record<string, string> = {
    weaponUpgrade: COLORS.player,
    newWeapon: COLORS.player,
    passiveUpgrade: COLORS.gem,
    newPassive: COLORS.gem,
    heal: COLORS.boss,
    temper: COLORS.win,
};

const KIND_TAGS: Record<string, string> = {
    weaponUpgrade: '武器强化',
    newWeapon: '新武器',
    passiveUpgrade: '被动强化',
    newPassive: '新被动',
    heal: '补给',
    temper: '淬炼',
};

interface CardView {
    node: Node;
    gfx: Graphics;
    tag: Label;
    title: Label;
    detail: Label;
}

@ccclass('SurvivorUpgradePanel')
export class SurvivorUpgradePanel extends Component {
    private _cards: CardView[] = [];
    private _titleLabel: Label | null = null;
    private _subLabel: Label | null = null;
    private _onChoose: ((index: number) => void) | null = null;
    private _visible = false;

    /** 由 SurvivorGame 在运行时调用；parent 必须是 Canvas（全屏节点） */
    static create(parent: Node): SurvivorUpgradePanel {
        const node = new Node('UpgradePanel');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        // 比设计分辨率大一圈，任何屏幕比例都能盖满
        ut.setContentSize(1600, 1600);
        parent.addChild(node);
        const panel = node.addComponent(SurvivorUpgradePanel);
        panel._build();
        node.active = false;
        return panel;
    }

    get visible(): boolean {
        return this._visible;
    }

    // ==================== 对外 ====================

    show(offers: readonly UpgradeOffer[], level: number, onChoose: (index: number) => void): void {
        this._onChoose = onChoose;
        this._visible = true;
        // 连升多级会连续 show()：先解绑再绑，避免监听叠加
        this._unbind();
        this._bind();

        if (this._titleLabel) this._titleLabel.string = `升级！Lv.${level}`;
        if (this._subLabel) this._subLabel.string = '选择一项强化，点击卡片确认';

        for (let i = 0; i < this._cards.length; i++) {
            const card = this._cards[i];
            const offer = offers[i];
            if (!offer) {
                card.node.active = false;
                continue;
            }
            card.node.active = true;
            this._paintCard(card, offer);
        }

        this.node.active = true;
    }

    hide(): void {
        this._visible = false;
        this._unbind();
        this._onChoose = null;
        if (this.node && this.node.isValid) this.node.active = false;
    }

    onDestroy(): void {
        // 只清引用：onDestroy 不访问 @property 节点（红线 4）
        this._cards = [];
        this._titleLabel = null;
        this._subLabel = null;
        this._onChoose = null;
        this._visible = false;
    }

    // ==================== 构建 ====================

    private _build(): void {
        const root = this.node;

        const mask = root.addComponent(Graphics);
        mask.fillColor = hex(PANEL_BG, 214);
        mask.rect(-800, -800, 1600, 1600);
        mask.fill();

        this._titleLabel = this._makeLabel(root, 0, 446, 680, 56, '升级！', 40, TEXT_PRIMARY, true);
        this._subLabel = this._makeLabel(root, 0, 398, 680, 40, '', 22, TEXT_SECONDARY, false);

        for (let i = 0; i < 3; i++) {
            this._cards.push(this._makeCard(root, i));
        }
    }

    private _makeCard(root: Node, index: number): CardView {
        const node = new Node(`UpgradeCard${index}`);
        node.layer = root.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(CARD_W, CARD_H);
        root.addChild(node);
        node.setPosition(0, CARD_YS[index], 0);

        const gfx = node.addComponent(Graphics);

        // 左侧 96 px 留给图标；文本从图标右侧起排（x=44 时左边缘在 -154）
        const tag = this._makeLabel(node, TEXT_X, 56, TEXT_W, 28, '', 20, TEXT_SECONDARY, false);
        tag.horizontalAlign = Label.HorizontalAlign.LEFT;
        const title = this._makeLabel(node, TEXT_X, 12, TEXT_W, 40, '', 30, TEXT_PRIMARY, true);
        title.horizontalAlign = Label.HorizontalAlign.LEFT;
        const detail = this._makeLabel(node, TEXT_X, -44, TEXT_W, 34, '', 21, TEXT_SECONDARY, false);
        detail.horizontalAlign = Label.HorizontalAlign.LEFT;
        detail.overflow = Label.Overflow.SHRINK;

        return { node, gfx, tag, title, detail };
    }

    private _makeLabel(
        parent: Node,
        x: number,
        y: number,
        w: number,
        h: number,
        text: string,
        size: number,
        color: string,
        bold: boolean,
    ): Label {
        const node = new Node('Text');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);
        node.setPosition(x, y, 0);

        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = Math.round(size * 1.3);
        label.color = hex(color);
        label.isBold = bold;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;

        parent.addChild(node);
        return label;
    }

    private _paintCard(card: CardView, offer: UpgradeOffer): void {
        const color = KIND_COLORS[offer.kind] || TEXT_PRIMARY;
        const g = card.gfx;
        g.clear();
        g.fillColor = hex(CARD_BG, 245);
        g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);
        g.fill();

        // 左侧色条：不靠颜色也能区分武器/被动/补给
        g.fillColor = hex(color);
        g.roundRect(-CARD_W / 2 + 8, -CARD_H / 2 + 18, 8, CARD_H - 36, 4);
        g.fill();

        g.lineWidth = 2;
        g.strokeColor = hex(color, 190);
        g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);
        g.stroke();

        card.tag.string = KIND_TAGS[offer.kind] || '';
        card.tag.color = hex(color);
        card.title.string = offer.title;
        card.detail.string = offer.detail;

        this._paintIcon(g, offer, color);
        this._paintPips(g, offer, color);
    }

    // ==================== 图标与等级点（V4） ====================

    /** 图标底板 + 武器/被动的几何记号；同一套形状在 HUD 构筑行也认得出 */
    private _paintIcon(g: Graphics, offer: UpgradeOffer, color: string): void {
        g.fillColor = hex(color, 28);
        g.circle(ICON_X, 0, ICON_R);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = hex(color, 120);
        g.circle(ICON_X, 0, ICON_R);
        g.stroke();

        g.fillColor = hex(color);
        const x = ICON_X;
        const y = 0;
        switch (offer.track) {
            case 'knife': {
                // 三片刀锋
                for (let i = -1; i <= 1; i++) {
                    const oy = i * 12;
                    g.moveTo(x + 16, y + oy);
                    g.lineTo(x - 12, y + oy + 5);
                    g.lineTo(x - 12, y + oy - 2);
                    g.close();
                }
                g.fill();
                break;
            }
            case 'orbit': {
                // 中心 + 两颗环绕
                g.circle(x, y, 5);
                g.fill();
                g.circle(x - 14, y + 10, 6);
                g.circle(x + 14, y - 8, 6);
                g.fill();
                break;
            }
            case 'lightning': {
                // 闪电折线
                g.moveTo(x + 4, y + 18);
                g.lineTo(x - 10, y - 2);
                g.lineTo(x - 1, y - 2);
                g.lineTo(x - 5, y - 18);
                g.lineTo(x + 11, y + 4);
                g.lineTo(x + 2, y + 4);
                g.close();
                g.fill();
                break;
            }
            case 'boomerang': {
                // 回旋镖（两段折角）
                g.moveTo(x - 14, y - 12);
                g.lineTo(x + 2, y + 14);
                g.lineTo(x + 7, y + 8);
                g.lineTo(x - 6, y - 8);
                g.close();
                g.fill();
                break;
            }
            case 'haste': {
                // 双箭头（攻速）
                for (let i = 0; i < 2; i++) {
                    const ox = i * 10 - 6;
                    g.moveTo(x + ox - 8, y + 14);
                    g.lineTo(x + ox + 6, y);
                    g.lineTo(x + ox - 8, y - 14);
                    g.lineTo(x + ox - 2, y);
                    g.close();
                }
                g.fill();
                break;
            }
            case 'swift': {
                // 单箭头（移速）
                g.moveTo(x + 16, y);
                g.lineTo(x - 2, y + 14);
                g.lineTo(x - 2, y + 5);
                g.lineTo(x - 16, y + 5);
                g.lineTo(x - 16, y - 5);
                g.lineTo(x - 2, y - 5);
                g.lineTo(x - 2, y - 14);
                g.close();
                g.fill();
                break;
            }
            case 'pickup': {
                // 菱形 + 外圈（拾取范围）
                g.strokeColor = hex(color, 160);
                g.lineWidth = 2;
                g.circle(x, y, 20);
                g.stroke();
                g.fillColor = hex(color);
                g.moveTo(x, y + 12);
                g.lineTo(x + 12, y);
                g.lineTo(x, y - 12);
                g.lineTo(x - 12, y);
                g.close();
                g.fill();
                break;
            }
            case 'vitality': {
                // 心形（体魄）
                g.circle(x - 7, y + 4, 9);
                g.circle(x + 7, y + 4, 9);
                g.fill();
                g.moveTo(x - 15, y + 1);
                g.lineTo(x, y - 16);
                g.lineTo(x + 15, y + 1);
                g.close();
                g.fill();
                break;
            }
            case 'heal': {
                // 十字
                g.rect(x - 6, y - 16, 12, 32);
                g.rect(x - 16, y - 6, 32, 12);
                g.fill();
                break;
            }
            default: {
                // 淬炼：八角星
                for (let i = 0; i < 8; i++) {
                    const a1 = (i / 8) * Math.PI * 2;
                    const a2 = a1 + Math.PI / 8;
                    const r1 = i % 2 === 0 ? 17 : 7;
                    const px = x + Math.cos(a1) * r1;
                    const py = y + Math.sin(a1) * r1;
                    const qx = x + Math.cos(a2) * 7;
                    const qy = y + Math.sin(a2) * 7;
                    if (i === 0) g.moveTo(px, py);
                    else g.lineTo(px, py);
                    g.lineTo(qx, qy);
                }
                g.close();
                g.fill();
                break;
            }
        }
    }

    /** 等级点：5 格，点亮到「选择后」的等级；补给/淬炼不适用就不画 */
    private _paintPips(g: Graphics, offer: UpgradeOffer, color: string): void {
        const max = 5;
        const isTrack = offer.kind === 'weaponUpgrade' || offer.kind === 'newWeapon' ||
            offer.kind === 'passiveUpgrade' || offer.kind === 'newPassive';
        if (!isTrack) return;
        const y = 62;
        const r = 4.5;
        const gap = 16;
        const right = CARD_W / 2 - 34;
        for (let i = 0; i < max; i++) {
            const x = right - (max - 1 - i) * gap;
            const filled = i < offer.nextLevel;
            g.fillColor = hex(color, filled ? 255 : 70);
            g.circle(x, y, r);
            g.fill();
        }
    }

    // ==================== 事件 ====================

    private _bind(): void {
        this.node.on(Node.EventType.TOUCH_START, this._onMaskTouch, this);
        this.node.on(Node.EventType.TOUCH_END, this._onMaskTouch, this);
        for (const card of this._cards) {
            card.node.on(Node.EventType.TOUCH_END, this._onCardTouched, this);
        }
    }

    private _unbind(): void {
        if (!this.node || !this.node.isValid) return;
        this.node.off(Node.EventType.TOUCH_START, this._onMaskTouch, this);
        this.node.off(Node.EventType.TOUCH_END, this._onMaskTouch, this);
        for (const card of this._cards) {
            if (card.node && card.node.isValid) {
                card.node.off(Node.EventType.TOUCH_END, this._onCardTouched, this);
            }
        }
    }

    /** 遮罩吞事件：面板打开时，摇杆与返回按钮都不该响应 */
    private _onMaskTouch(event: EventTouch): void {
        event.propagationStopped = true;
    }

    private _onCardTouched(event: EventTouch): void {
        event.propagationStopped = true;
        const node = event.currentTarget as Node;
        const index = this._cards.findIndex((c) => c.node === node);
        if (index < 0) return;
        const choose = this._onChoose;
        if (!choose) return;
        // 先解绑并隐藏，防止连点触发两次选择
        this.hide();
        choose(index);
    }
}
