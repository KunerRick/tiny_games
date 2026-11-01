/**
 * 纸牌接龙 — 单张牌的绘制与动效。
 *
 * 一个 CardView = 1 个节点：
 *   - Graphics 画牌底、牌背纹理与花色（花色一律画路径，禁止 Unicode ♠♥♦♣）
 *   - 子节点 Label 画左上角点数
 *
 * 节点由 SolitaireGame 在 onLoad 时一次性创建 52 个，整局复用；不销毁、不重建。
 */

import { _decorator, Color, Component, Graphics, Label, Node, Tween, UITransform, Vec3, tween } from 'cc';
import {
    CARD_H,
    CARD_W,
    COLOR_BLACK,
    COLOR_CARD_BACK,
    COLOR_CARD_EDGE,
    COLOR_CARD_FACE,
    COLOR_HIGHLIGHT,
    COLOR_RED,
} from './SolitaireConfig';
import { Card, Suit, isRed } from './SolitaireCore';

const { ccclass } = _decorator;

const CORNER_RADIUS = 10;
const CENTER_SUIT_R = 23;
const CORNER_SUIT_R = 7;
const RANK_FONT_SIZE = 28;
const RANK_TOP_INSET = 6;
const RANK_LEFT_INSET = 8;

function hexColor(hex: string, alpha = 255): Color {
    const color = new Color();
    color.fromHEX(hex);
    color.a = alpha;
    return color;
}

export function rankText(rank: number): string {
    if (rank === 1) return 'A';
    if (rank === 11) return 'J';
    if (rank === 12) return 'Q';
    if (rank === 13) return 'K';
    return String(rank);
}

@ccclass('SolitaireCard')
export class SolitaireCard extends Component {
    private _graphics: Graphics | null = null;
    private _rankLabel: Label | null = null;
    private _card: Card | null = null;
    private _highlight = false;
    private _lifted = false;
    private _moveTween: Tween<Node> | null = null;
    private _flipTween: Tween<Node> | null = null;

    /** 由 SolitaireGame 调用；节点会挂到 parent 下并完成内部构建 */
    static create(parent: Node): SolitaireCard {
        const node = new Node('Card');
        node.layer = parent.layer;
        const view = node.addComponent(SolitaireCard);
        parent.addChild(node);
        view._init();
        return view;
    }

    // ==================== 对外接口 ====================

    get card(): Card | null {
        return this._card;
    }

    /** 设置牌面并重绘；传 null 隐藏节点。同一张牌对象不重复重绘（每帧布局开销） */
    setCard(card: Card | null): void {
        const same = this._card === card;
        this._card = card;
        const active = !!card;
        if (this.node.active !== active) this.node.active = active;
        if (active && !same) this._draw();
    }

    setHighlight(on: boolean): void {
        if (this._highlight === on) return;
        this._highlight = on;
        this._draw();
    }

    /** 拿在手上时的悬浮感：阴影 + 轻微放大 */
    setLifted(on: boolean): void {
        if (this._lifted === on) return;
        this._lifted = on;
        this.node.setScale(on ? 1.04 : 1, on ? 1.04 : 1, 1);
        this._draw();
    }

    /** 翻面动画；dest 的 faceUp 与当前一致时直接重绘 */
    flipTo(card: Card, duration = 0.12): void {
        const current = this._card;
        if (!current || current.faceUp === card.faceUp || duration <= 0) {
            this.setCard(card);
            return;
        }

        this._stopFlip();
        const half = duration * 0.5;
        this._flipTween = tween(this.node)
            .to(half, { scale: new Vec3(0.02, 1, 1) })
            .call(() => {
                this.setCard(card);
            })
            .to(half, { scale: new Vec3(1, 1, 1) })
            .call(() => {
                this._flipTween = null;
            })
            .start();
    }

    /** 直接落位（无动画） */
    placeAt(x: number, y: number): void {
        if (this._moveTween) {
            this._moveTween.stop();
            this._moveTween = null;
        }
        this.node.setPosition(x, y, 0);
    }

    /** 带动画移动到目标位置 */
    moveTo(x: number, y: number, duration = 0.1): void {
        if (duration <= 0) {
            this.placeAt(x, y);
            return;
        }
        if (this._moveTween) this._moveTween.stop();
        this._moveTween = tween(this.node)
            .to(duration, { position: new Vec3(x, y, 0) }, { easing: 'quadOut' })
            .call(() => {
                this._moveTween = null;
            })
            .start();
    }

    /** 回到原始视觉状态（缩放、阴影、高亮）；已经是原始状态时不重绘 */
    resetVisual(): void {
        const dirty = this._lifted || this._highlight || this.node.scale.x !== 1;
        this._lifted = false;
        this._highlight = false;
        this.node.setScale(1, 1, 1);
        if (dirty) this._draw();
    }

    onDestroy(): void {
        // 只清引用，不访问节点与 @property（防崩溃守则 2 / 红线 4）
        this._graphics = null;
        this._rankLabel = null;
        this._card = null;
        this._moveTween = null;
        this._flipTween = null;
    }

    // ==================== 构建 ====================

    private _init(): void {
        const transform = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        transform.setContentSize(CARD_W, CARD_H);
        transform.setAnchorPoint(0.5, 0.5);

        this._graphics = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);

        const rankNode = new Node('Rank');
        rankNode.layer = this.node.layer;
        const rankTransform = rankNode.addComponent(UITransform);
        rankTransform.setAnchorPoint(0, 1);
        rankTransform.setContentSize(CARD_W - RANK_LEFT_INSET * 2, RANK_FONT_SIZE + 6);
        rankNode.setPosition(-CARD_W / 2 + RANK_LEFT_INSET, CARD_H / 2 - RANK_TOP_INSET, 0);

        const label = rankNode.addComponent(Label);
        label.string = '';
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.verticalAlign = Label.VerticalAlign.TOP;
        label.overflow = Label.Overflow.NONE;
        label.fontSize = RANK_FONT_SIZE;
        label.lineHeight = RANK_FONT_SIZE + 4;
        label.isBold = true;
        this.node.addChild(rankNode);
        this._rankLabel = label;
    }

    // ==================== 绘制 ====================

    private _draw(): void {
        const g = this._graphics;
        if (!g) return;

        const card = this._card;
        const left = -CARD_W / 2;
        const bottom = -CARD_H / 2;

        g.clear();

        if (this._lifted) {
            g.fillColor = hexColor('#000000', 70);
            g.roundRect(left + 3, bottom - 3, CARD_W, CARD_H, CORNER_RADIUS);
            g.fill();
        }

        const faceUp = !!card && card.faceUp;
        g.fillColor = hexColor(faceUp ? COLOR_CARD_FACE : COLOR_CARD_BACK);
        g.roundRect(left, bottom, CARD_W, CARD_H, CORNER_RADIUS);
        g.fill();

        g.lineWidth = this._highlight ? 3 : 2;
        g.strokeColor = hexColor(this._highlight ? COLOR_HIGHLIGHT : COLOR_CARD_EDGE);
        g.roundRect(left, bottom, CARD_W, CARD_H, CORNER_RADIUS);
        g.stroke();

        if (!card) {
            if (this._rankLabel) this._rankLabel.node.active = false;
            return;
        }

        if (!card.faceUp) {
            if (this._rankLabel) this._rankLabel.node.active = false;
            this._drawBackPattern(g);
            return;
        }

        const color = hexColor(isRed(card.suit) ? COLOR_RED : COLOR_BLACK);
        // 中心大花色
        this._drawSuit(g, card.suit, 0, -8, CENTER_SUIT_R, color);
        // 左上角小花色（紧贴点数右侧）
        this._drawSuit(g, card.suit, -CARD_W / 2 + 24, CARD_H / 2 - 22, CORNER_SUIT_R, color);

        if (this._rankLabel) {
            this._rankLabel.node.active = true;
            this._rankLabel.string = rankText(card.rank);
            this._rankLabel.color = color;
        }
    }

    /** 牌背：内描边 + 中央菱形徽记（不越出圆角，避免无裁剪时溢出） */
    private _drawBackPattern(g: Graphics): void {
        const inset = 10;
        g.lineWidth = 2;
        g.strokeColor = hexColor('#1F4A6D', 200);
        g.roundRect(-CARD_W / 2 + inset, -CARD_H / 2 + inset, CARD_W - inset * 2, CARD_H - inset * 2, CORNER_RADIUS - 4);
        g.stroke();

        g.fillColor = hexColor('#1F4A6D', 170);
        const cx = 0;
        const cy = 0;
        const r = 16;
        g.moveTo(cx, cy + r);
        g.lineTo(cx + r * 0.7, cy);
        g.lineTo(cx, cy - r);
        g.lineTo(cx - r * 0.7, cy);
        g.close();
        g.fill();
    }

    /**
     * 花色路径。所有坐标都是相对 (cx, cy) 的绝对坐标，r 为半径。
     * 禁止用 ♠♥♦♣ 字符：微信字体可能渲染成 emoji / 方框（红线 10）。
     */
    private _drawSuit(g: Graphics, suit: Suit, cx: number, cy: number, r: number, color: Color): void {
        g.fillColor = color;

        if (suit === 'D') {
            g.moveTo(cx, cy + r);
            g.lineTo(cx + r * 0.72, cy);
            g.lineTo(cx, cy - r);
            g.lineTo(cx - r * 0.72, cy);
            g.close();
            g.fill();
            return;
        }

        if (suit === 'H') {
            this._heartPath(g, cx, cy, r);
            g.close();
            g.fill();
            return;
        }

        if (suit === 'S') {
            this._heartPath(g, cx, cy, -r);
            g.close();
            g.fill();
            // 牌柄
            g.moveTo(cx - r * 0.3, cy - r * 0.4);
            g.lineTo(cx + r * 0.3, cy - r * 0.4);
            g.lineTo(cx + r * 0.14, cy - r * 0.86);
            g.lineTo(cx - r * 0.14, cy - r * 0.86);
            g.close();
            g.fill();
            return;
        }

        // 梅花：三个圆 + 牌柄
        g.circle(cx, cy + r * 0.42, r * 0.42);
        g.fill();
        g.circle(cx - r * 0.45, cy - r * 0.16, r * 0.42);
        g.fill();
        g.circle(cx + r * 0.45, cy - r * 0.16, r * 0.42);
        g.fill();
        g.moveTo(cx - r * 0.28, cy - r * 0.34);
        g.lineTo(cx + r * 0.28, cy - r * 0.34);
        g.lineTo(cx + r * 0.12, cy - r * 0.9);
        g.lineTo(cx - r * 0.12, cy - r * 0.9);
        g.close();
        g.fill();
    }

    /**
     * 心形路径（尖端朝下）。
     * directionY = 1 画红桃；传 -1 得到黑桃主体（尖端朝上）。
     */
    private _heartPath(g: Graphics, cx: number, cy: number, r: number): void {
        const s = r < 0 ? -1 : 1;
        const a = Math.abs(r);
        g.moveTo(cx, cy - a * s);
        g.bezierCurveTo(
            cx - a * 0.55 * s, cy - a * 0.35 * s,
            cx - a * s, cy - a * 0.15 * s,
            cx - a * 0.7 * s, cy + a * 0.35 * s,
        );
        g.bezierCurveTo(
            cx - a * 0.5 * s, cy + a * 0.72 * s,
            cx - a * 0.1 * s, cy + a * 0.72 * s,
            cx, cy + a * 0.35 * s,
        );
        g.bezierCurveTo(
            cx + a * 0.1 * s, cy + a * 0.72 * s,
            cx + a * 0.5 * s, cy + a * 0.72 * s,
            cx + a * 0.7 * s, cy + a * 0.35 * s,
        );
        g.bezierCurveTo(
            cx + a * s, cy - a * 0.15 * s,
            cx + a * 0.55 * s, cy - a * 0.35 * s,
            cx, cy - a * s,
        );
    }

    private _stopFlip(): void {
        if (this._flipTween) {
            this._flipTween.stop();
            this._flipTween = null;
            this.node.setScale(1, 1, 1);
        }
    }
}
