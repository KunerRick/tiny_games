/**
 * 午夜幸存者 — 结算面板（胜利 / 失败）。
 *
 * 规格 §2.5「死得明白，重开得快」+ 计划 §2.1.3 G3：
 *  - 存活时长、击杀、等级、武器/被动等级、最后致命伤害来源
 *  - 「再来一局」「返回大厅」两个按钮
 *
 * 与其他面板同一套做法：代码运行时创建（不改 .scene），show() 绑定事件、hide() 解绑，
 * handler 全部命名方法（红线 5），onDestroy 只清引用（红线 4）。
 */

import { _decorator, Component, EventTouch, Graphics, Label, Node, UITransform } from 'cc';
import { COLOR, hex } from '../../../common/ui/UITheme';
import { COLORS, HIT_SOURCE_NAMES, PASSIVE_NAMES, WEAPON_NAMES } from './SurvivorConfig';
import type { PassiveTrack, RunSummary, SurvivorSnapshot, WeaponTrack } from './SurvivorConfig';

const { ccclass } = _decorator;

const CARD_W = 620;
const CARD_H = 760;
const BUTTON_W = 240;
const BUTTON_H = 84;

/** 面板遮罩底是本品夜色；卡片底与文字走全站令牌；胜负/主操作用本品调色板 */
const PANEL_BG = COLORS.panelBg;
const CARD_BG = COLOR.PANEL_BG;
const TEXT_PRIMARY = COLOR.TEXT_PRIMARY;
const TEXT_SECONDARY = COLOR.TEXT_SECONDARY;
const WIN = COLORS.win;
const LOSE = COLORS.chaser;
const ACTION = COLORS.player;

interface Callbacks {
    onRestart: () => void;
    onLobby: () => void;
}

function mmss(seconds: number): string {
    const t = Math.max(0, Math.floor(seconds));
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

@ccclass('SurvivorResultPanel')
export class SurvivorResultPanel extends Component {
    private _title: Label | null = null;
    private _sub: Label | null = null;
    private _stats: Label | null = null;
    private _buildLabel: Label | null = null;
    private _cause: Label | null = null;
    private _restartNode: Node | null = null;
    private _lobbyNode: Node | null = null;
    private _callbacks: Callbacks | null = null;
    private _visible = false;

    /** 由 SurvivorGame 在运行时调用；parent 必须是 Canvas */
    static create(parent: Node): SurvivorResultPanel {
        const node = new Node('ResultPanel');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(1600, 1600);
        parent.addChild(node);
        const panel = node.addComponent(SurvivorResultPanel);
        panel._build();
        node.active = false;
        return panel;
    }

    get visible(): boolean {
        return this._visible;
    }

    // ==================== 对外 ====================

    show(summary: RunSummary, snap: SurvivorSnapshot, callbacks: Callbacks): void {
        this._callbacks = callbacks;
        this._visible = true;
        this._unbind();
        this._bind();

        const win = snap.phase === 'victory';
        const accent = win ? WIN : LOSE;
        this._paintCard(accent);

        if (this._title) {
            this._title.string = win ? '胜利' : '阵亡';
            this._title.color = hex(accent);
        }
        if (this._sub) {
            this._sub.string = win ? 'Boss 已击杀，这一局守住了' : '这一局没能撑到最后';
        }
        if (this._stats) {
            this._stats.string =
                `存活 ${mmss(summary.time)}\n` +
                `击杀 ${summary.kills}    等级 Lv.${summary.level}`;
        }
        if (this._buildLabel) {
            this._buildLabel.string = this._buildText(snap);
        }
        if (this._cause) {
            this._cause.string = this._causeText(win, summary);
            this._cause.color = hex(win ? TEXT_SECONDARY : accent);
        }

        this.node.active = true;
    }

    hide(): void {
        this._visible = false;
        this._unbind();
        this._callbacks = null;
        if (this.node && this.node.isValid) this.node.active = false;
    }

    onDestroy(): void {
        this._title = null;
        this._sub = null;
        this._stats = null;
        this._buildLabel = null;
        this._cause = null;
        this._restartNode = null;
        this._lobbyNode = null;
        this._callbacks = null;
        this._visible = false;
    }

    // ==================== 文案 ====================

    private _buildText(snap: SurvivorSnapshot): string {
        const weapons: string[] = [];
        for (const key of Object.keys(snap.weapons)) {
            const lv = snap.weapons[key as WeaponTrack] || 0;
            if (lv > 0) weapons.push(`${WEAPON_NAMES[key as WeaponTrack]} Lv.${lv}`);
        }
        const passives: string[] = [];
        for (const key of Object.keys(snap.passives)) {
            const lv = snap.passives[key as PassiveTrack] || 0;
            if (lv > 0) passives.push(`${PASSIVE_NAMES[key as PassiveTrack]} Lv.${lv}`);
        }
        const lines: string[] = [];
        lines.push(`武器  ${weapons.length ? weapons.join('  ·  ') : '—'}`);
        lines.push(`被动  ${passives.length ? passives.join('  ·  ') : '—'}`);
        if (snap.temper > 0) lines.push(`淬炼  ×${snap.temper}（全武器伤害 +${snap.temper * 5}%）`);
        return lines.join('\n');
    }

    private _causeText(win: boolean, summary: RunSummary): string {
        if (win) return '下一局试试别的构筑';
        if (!summary.lastHitSource) return '致命伤害来源：未知';
        const name = HIT_SOURCE_NAMES[summary.lastHitSource] || summary.lastHitSource;
        const elite = summary.lastHitElite ? '（精英）' : '';
        const dmg = summary.lastHitDamage > 0 ? `，${summary.lastHitDamage} 点伤害` : '';
        return `最后一击：${name}${elite}${dmg}`;
    }

    // ==================== 构建 ====================

    private _build(): void {
        const root = this.node;

        const mask = root.addComponent(Graphics);
        mask.fillColor = hex(PANEL_BG, 214);
        mask.rect(-800, -800, 1600, 1600);
        mask.fill();

        // 卡片底板每帧状态不同（胜利金色 / 失败红色），单独一个子节点画
        const card = new Node('Card');
        card.layer = root.layer;
        const cardUt = card.addComponent(UITransform);
        cardUt.setContentSize(CARD_W, CARD_H);
        root.addChild(card);
        const cardGfx = card.addComponent(Graphics);
        cardGfx.fillColor = hex(CARD_BG, 246);
        cardGfx.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 24);
        cardGfx.fill();
        this._cardGfx = cardGfx;

        this._title = this._makeLabel(root, 0, 300, 560, 64, '', 46, TEXT_PRIMARY, true);
        this._sub = this._makeLabel(root, 0, 244, 560, 36, '', 22, TEXT_SECONDARY, false);
        this._stats = this._makeLabel(root, 0, 150, 520, 96, '', 30, TEXT_PRIMARY, false);
        this._buildLabel = this._makeLabel(root, 0, 10, 520, 120, '', 22, TEXT_SECONDARY, false);
        this._buildLabel.lineHeight = 36;
        this._cause = this._makeLabel(root, 0, -100, 540, 40, '', 22, LOSE, false);

        this._restartNode = this._makeButton(root, -130, -250, '再来一局', ACTION);
        this._lobbyNode = this._makeButton(root, 130, -250, '返回大厅', TEXT_SECONDARY);
    }

    private _cardGfx: Graphics | null = null;

    private _paintCard(accent: string): void {
        const g = this._cardGfx;
        if (!g) return;
        g.clear();
        g.fillColor = hex(CARD_BG, 246);
        g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 24);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = hex(accent, 200);
        g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 24);
        g.stroke();
    }

    private _makeButton(parent: Node, x: number, y: number, text: string, color: string): Node {
        const node = new Node(`Button_${text}`);
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(BUTTON_W, BUTTON_H);
        node.setPosition(x, y, 0);
        parent.addChild(node);

        const g = node.addComponent(Graphics);
        g.fillColor = hex(color, 36);
        g.roundRect(-BUTTON_W / 2, -BUTTON_H / 2, BUTTON_W, BUTTON_H, 16);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = hex(color, 220);
        g.roundRect(-BUTTON_W / 2, -BUTTON_H / 2, BUTTON_W, BUTTON_H, 16);
        g.stroke();

        this._makeLabel(node, 0, 0, BUTTON_W - 24, BUTTON_H, text, 28, color, true);
        return node;
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
        label.lineHeight = Math.round(size * 1.35);
        label.color = hex(color);
        label.isBold = bold;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;

        parent.addChild(node);
        return label;
    }

    // ==================== 事件 ====================

    private _bind(): void {
        this.node.on(Node.EventType.TOUCH_START, this._onMaskTouch, this);
        this.node.on(Node.EventType.TOUCH_END, this._onMaskTouch, this);
        this._restartNode?.on(Node.EventType.TOUCH_END, this._onRestartTouched, this);
        this._lobbyNode?.on(Node.EventType.TOUCH_END, this._onLobbyTouched, this);
    }

    private _unbind(): void {
        if (!this.node || !this.node.isValid) return;
        this.node.off(Node.EventType.TOUCH_START, this._onMaskTouch, this);
        this.node.off(Node.EventType.TOUCH_END, this._onMaskTouch, this);
        this._restartNode?.off(Node.EventType.TOUCH_END, this._onRestartTouched, this);
        this._lobbyNode?.off(Node.EventType.TOUCH_END, this._onLobbyTouched, this);
    }

    private _onMaskTouch(event: EventTouch): void {
        event.propagationStopped = true;
    }

    private _onRestartTouched(event: EventTouch): void {
        event.propagationStopped = true;
        const cb = this._callbacks;
        if (!cb) return;
        this.hide();
        cb.onRestart();
    }

    private _onLobbyTouched(event: EventTouch): void {
        event.propagationStopped = true;
        const cb = this._callbacks;
        if (!cb) return;
        this.hide();
        cb.onLobby();
    }
}
