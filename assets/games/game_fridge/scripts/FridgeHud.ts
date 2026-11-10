/**
 * 冰箱底下 — 顶栏 / 道具栏 / 死亡提示（M1 版）。
 *
 * 节点全部运行时创建（与 SurvivorHud 一致），不改场景文件。
 * 顶栏在 Canvas 顶部，战斗区（Field）中心 y=160、半高 336，所以 HUD 放在 y≈580 一带。
 *
 * 约定：onDestroy 只清引用（红线 4）；所有文字直接 set Label.string（图标一律用 Graphics 画，避免字体 tofu）。
 */

import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from 'cc';
import type { FridgeSnapshot } from './FridgeConfig';
import { ITEM_BY_ID } from './FridgeConfig';

const { ccclass } = _decorator;

/** 顶栏基线（Canvas 坐标）：心格一行在上，数值一行在下 */
const HUD_Y = 604;
const STATS_Y = 566;
/** 半心方块边长 */
const PIP = 14;
const PIP_GAP = 3;

@ccclass('FridgeHud')
export class FridgeHud extends Component {
    private _pipGfx: Graphics | null = null;
    private _stats: Label | null = null;
    private _items: Label | null = null;
    private _hint: Label | null = null;
    private _dead: Label | null = null;

    private _cFull = new Color(226, 88, 84, 255);
    private _cEmpty = new Color(60, 60, 70, 255);
    private _cText = new Color(236, 240, 245, 255);

    static create(parent: Node): FridgeHud {
        const node = new Node('FridgeHud');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        parent.addChild(node);
        return node.addComponent(FridgeHud);
    }

    onLoad(): void {
        this._buildPips();
        this._stats = this._makeLabel('Stats', -340, STATS_Y, 20, Label.HorizontalAlign.LEFT, 420);
        this._items = this._makeLabel('Items', -340, -300, 20, Label.HorizontalAlign.LEFT, 680);
        this._hint = this._makeLabel('Hint', 0, -370, 18, Label.HorizontalAlign.CENTER, 680);
        this._hint.string = '左半屏拖动移动 · 右半屏拖动瞄准（松手自动瞄准）';
        this._dead = this._makeLabel('Dead', 0, 40, 44, Label.HorizontalAlign.CENTER, 640);
        this._dead.node.active = false;
    }

    onDestroy(): void {
        this._pipGfx = null;
        this._stats = null;
        this._items = null;
        this._hint = null;
        this._dead = null;
    }

    refresh(snap: FridgeSnapshot): void {
        this._drawPips(snap.player.hp, snap.player.maxHp);
        if (this._stats) {
            const p = snap.player;
            this._stats.string = `击杀 ${snap.kills}   波次 ${snap.wave}   伤害 ${p.dmg.toFixed(1)}   射速 ${p.rate.toFixed(1)}/s`;
        }
        if (this._items) {
            if (snap.items.length === 0) {
                this._items.string = '道具：无（走到中间的辣椒酱上拾取）';
            } else {
                const names: string[] = [];
                for (const id of snap.items) {
                    const def = ITEM_BY_ID[id];
                    names.push(def ? def.name : id);
                }
                this._items.string = `道具（${names.length}）：${names.join('、')}`;
            }
        }
        if (this._dead) {
            const dead = snap.phase === 'dead';
            if (this._dead.node.active !== dead) this._dead.node.active = dead;
            if (dead) this._dead.string = `被吃掉了…\n击杀 ${snap.kills} · 坚持 ${Math.floor(snap.time)} 秒\n点击任意处重开`;
        }
    }

    // ==================== 绘制 / 构建 ====================

    private _drawPips(hp: number, maxHp: number): void {
        const g = this._pipGfx;
        if (!g) return;
        g.clear();
        const startX = -340;
        for (let i = 0; i < maxHp; i++) {
            g.fillColor = i < hp ? this._cFull : this._cEmpty;
            g.rect(startX + i * (PIP + PIP_GAP), HUD_Y - PIP / 2, PIP, PIP);
            g.fill();
        }
    }

    private _buildPips(): void {
        const node = new Node('HeartPips');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 120);
        this.node.addChild(node);
        this._pipGfx = node.addComponent(Graphics);
    }

    private _makeLabel(name: string, x: number, y: number, size: number, align: number, width: number): Label {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(width, size * 3);
        // 左对齐的文字把锚点放在左边，否则 x 会被当成水平中心，整行被推到屏幕外
        ut.setAnchorPoint(align === Label.HorizontalAlign.LEFT ? 0 : 0.5, 0.5);
        node.setPosition(x, y, 0);
        const label = node.addComponent(Label);
        label.fontSize = size;
        label.lineHeight = Math.round(size * 1.3);
        label.color = this._cText;
        label.horizontalAlign = align;
        label.overflow = Label.Overflow.NONE;
        label.isBold = true;
        this.node.addChild(node);
        return label;
    }
}
