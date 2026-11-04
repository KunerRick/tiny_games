/**
 * 午夜幸存者 — 升级三选一面板（M3）。
 *
 * 规格 §3.6.2 / §5.1：全屏遮罩 + 3 张竖排卡片（560 × 180），点哪张选哪张。
 *  - 面板由代码在运行时创建（不往 .scene 里加节点），与摇杆同一套做法
 *  - 打开时游戏层停止推进核心；遮罩吞掉 TOUCH_START，避免点卡片时摇杆跟着动
 *  - 卡面只写「变化量」（核心已经生成好 title / detail）
 *  - 事件在 show() 绑定、hide() 解绑（防崩溃守则 6），handler 全部命名方法（红线 5）
 */

import { _decorator, Color, Component, EventTouch, Graphics, Label, Node, UITransform } from 'cc';
import { UpgradeOffer } from './SurvivorConfig';

const { ccclass } = _decorator;

const CARD_W = 560;
const CARD_H = 180;
/** 三张卡的中心 y（Canvas 中心为原点） */
const CARD_YS = [250, 40, -170];

const PANEL_BG = '#0B0C14';
const CARD_BG = '#1E2130';
const TEXT_PRIMARY = '#F8FAFC';
const TEXT_SECONDARY = '#94A3B8';

/** 卡牌类别 → 边框/标签颜色（沿用敌人与玩家的主色，不新增色） */
const KIND_COLORS: Record<string, string> = {
    weaponUpgrade: '#7FE7FF',
    newWeapon: '#7FE7FF',
    passiveUpgrade: '#5DE89A',
    newPassive: '#5DE89A',
    heal: '#FF5FA2',
    temper: '#FFD166',
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

function hex(hexStr: string, alpha = 255): Color {
    const c = new Color();
    c.fromHEX(hexStr);
    c.a = alpha;
    return c;
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

        // 文本节点用居中锚点，宽度 = 卡片内宽；x 取 0 才能让左对齐从卡片左边距开始
        const tag = this._makeLabel(node, 0, 56, CARD_W - 64, 28, '', 20, TEXT_SECONDARY, false);
        tag.horizontalAlign = Label.HorizontalAlign.LEFT;
        const title = this._makeLabel(node, 0, 12, CARD_W - 64, 40, '', 30, TEXT_PRIMARY, true);
        title.horizontalAlign = Label.HorizontalAlign.LEFT;
        const detail = this._makeLabel(node, 0, -44, CARD_W - 64, 34, '', 21, TEXT_SECONDARY, false);
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
