/**
 * 《秘银远征》开档职业选择（M6）。
 *
 * 只在**没有存档**时出现：4 张职业卡（名称 / 定位 / 资源 / 6 个技能名），
 * 选中后点「以 XX 开局」才创建存档，避免误触直接开档。
 *
 * 纪律：图层全部运行时创建；卡片用节点名编码职业 id + 具名 handler（红线 5）；
 * onDestroy 只清引用（红线 4）；不放任何图标字符（红线 10）。
 */

import {
    _decorator, BlockInputEvents, Component, EventTouch, Graphics, Label, Node, UITransform,
} from 'cc';
import {
    COLOR, clearChildren, createButton, createLabel, hex,
} from '../../../common/ui/GameUIKit';
import type { UiButton } from '../../../common/ui/GameUIKit';
import { CLASSES, SKILLS } from './MithrilConfig';
import type { ClassId } from './MithrilConfig';
import {
    CLASS_ACCENT, drawGlyphMedallion, drawMithrilGlyph,
} from './MithrilArt';

const { ccclass } = _decorator;

const PANEL_W = 680;
const PANEL_H = 1010;
const CARD_W = 292;
const CARD_H = 246;
const CARD_X = [-158, 158];
const CARD_Y = [206, -62];

/** 技能槽顺序（和 HUD 六键一致） */
const SLOT_ORDER = ['basic', 'a1', 'a2', 'a3', 'dodge', 'burst'];

@ccclass('MithrilClassSelect')
export class MithrilClassSelect extends Component {
    /** 玩家确认职业：主组件负责建新档、落盘、进路线图 */
    onPick: ((classId: ClassId) => void) | null = null;
    /** 返回大厅（不想开档 / 走错场景） */
    onCancel: (() => void) | null = null;

    private _sel: ClassId = 'warrior';
    private _built = false;
    private _root: Node | null = null;
    private _content: Node | null = null;
    private _confirmBtn: UiButton | null = null;
    private _hintLabel: Label | null = null;

    // ==================== 对外 ====================

    open(): void {
        this._ensureBuilt();
        if (!this._root) return;
        this._sel = 'warrior';
        this._root.active = true;
        this.refresh();
    }

    close(): void {
        if (this._root) this._root.active = false;
    }

    isOpen(): boolean {
        return !!(this._root && this._root.active);
    }

    /** 当前选中的职业（浏览器探针用） */
    get selected(): ClassId {
        return this._sel;
    }

    refresh(): void {
        const content = this._content;
        if (!content) return;
        const def = CLASSES.find((c) => c.id === this._sel) || CLASSES[0];
        if (this._confirmBtn) this._confirmBtn.setText(`以${def.name}开局`);
        if (this._hintLabel) {
            this._hintLabel.string = `已选择：${def.name}（${def.archetype}）· 职业在开档后不能更改`;
            this._hintLabel.color = hex(COLOR.TEXT_SECONDARY);
        }
        clearChildren(content);
        this._renderCards(content);
    }

    // ==================== 骨架 ====================

    private _ensureBuilt(): void {
        if (this._built) return;
        this._built = true;

        const root = new Node('ClassSelect');
        root.layer = this.node.layer;
        root.addComponent(UITransform).setContentSize(720, 1280);
        this.node.addChild(root);
        this._root = root;

        const mask = new Node('Mask');
        mask.layer = this.node.layer;
        mask.addComponent(UITransform).setContentSize(720, 1280);
        const mg = mask.addComponent(Graphics);
        mg.fillColor = hex(COLOR.BG_OVERLAY, 235);
        mg.rect(-360, -640, 720, 1280);
        mg.fill();
        mask.addComponent(BlockInputEvents);
        root.addChild(mask);

        const panel = new Node('Panel');
        panel.layer = this.node.layer;
        panel.addComponent(UITransform).setContentSize(PANEL_W, PANEL_H);
        const pg = panel.addComponent(Graphics);
        pg.fillColor = hex(COLOR.PANEL_BG, 255);
        pg.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 26);
        pg.fill();
        pg.strokeColor = hex(COLOR.PANEL_BORDER, 255);
        pg.lineWidth = 3;
        pg.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 26);
        pg.stroke();
        root.addChild(panel);
        root.active = false;

        createLabel(panel, '选择职业', 34, {
            width: 300, height: 48, color: COLOR.TEXT_PRIMARY, bold: true, x: 0, y: 446,
        });
        createLabel(panel, '每职业 6 个技能、独立资源循环；职业在开档时确定', 16, {
            width: 620, height: 24, color: COLOR.TEXT_SECONDARY, x: 0, y: 406,
        });

        const cancel = createButton(panel, {
            w: 120, h: 48, text: '返回大厅', fontSize: 20,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 12, onTap: () => this._onCancelTap(),
        });
        cancel.node.setPosition(268, 446, 0);

        const content = new Node('Content');
        content.layer = panel.layer;
        content.addComponent(UITransform).setContentSize(PANEL_W, 700);
        panel.addChild(content);
        this._content = content;

        this._confirmBtn = createButton(panel, {
            w: 320, h: 62, text: '以战士开局', fontSize: 23,
            fill: COLOR.PRIMARY, textColor: '#FFFFFF', activeFill: COLOR.PRIMARY_DARK,
            radius: 16, onTap: () => this._onConfirmTap(),
        });
        this._confirmBtn.node.setPosition(0, -330, 0);
        this._hintLabel = createLabel(panel, '', 16, {
            width: 620, height: 24, color: COLOR.TEXT_SECONDARY, x: 0, y: -386,
            overflow: 'shrink',
        });
        createLabel(panel, '提示：远程职业靠走位拉开距离，牧师可以自我治疗；第一次玩建议战士。', 15, {
            width: 620, height: 22, color: COLOR.TEXT_DISABLED, x: 0, y: -424,
        });
    }

    // ==================== 卡片 ====================

    private _renderCards(content: Node): void {
        for (let i = 0; i < CLASSES.length; i++) {
            const def = CLASSES[i];
            const x = CARD_X[i % 2];
            const y = CARD_Y[Math.floor(i / 2)];
            const selected = def.id === this._sel;

            const card = new Node(`ClassCard_${def.id}`);
            card.layer = content.layer;
            card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
            card.setPosition(x, y, 0);
            content.addChild(card);

            const g = card.addComponent(Graphics);
            g.fillColor = hex(selected ? '#1E3A5F' : COLOR.SLOT_EMPTY_BG, 255);
            g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);
            g.fill();
            g.strokeColor = hex(selected ? COLOR.PRIMARY : COLOR.PANEL_BORDER, selected ? 255 : 180);
            g.lineWidth = selected ? 4 : 2;
            g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);
            g.stroke();
            // 职业剪影水印（N81：卡面不能只有文字）
            const accent = CLASS_ACCENT[def.id] || COLOR.PRIMARY;
            drawMithrilGlyph(g, def.id, 74, accent, selected ? 20 : 12, 26);
            // 名称左侧徽记
            const medal = new Node(`ClassMedal_${def.id}`);
            medal.layer = card.layer;
            medal.addComponent(UITransform).setContentSize(46, 46);
            medal.setPosition(-98, 84, 0);
            const mgG = medal.addComponent(Graphics);
            drawGlyphMedallion(mgG, def.id, 21, accent);
            card.addChild(medal);

            createLabel(card, def.name, 28, {
                width: 186, height: 40, color: selected ? '#FDE68A' : COLOR.TEXT_PRIMARY,
                bold: true, x: 22, y: 84, overflow: 'shrink',
            });
            createLabel(card, def.archetype, 16, {
                width: 250, height: 22, color: COLOR.TEXT_SECONDARY, x: 0, y: 52,
            });
            createLabel(card, `资源：${def.resource}`, 16, {
                width: 250, height: 22, color: COLOR.WARNING, bold: true, x: 0, y: 24,
            });
            createLabel(card, def.resourceDesc, 14, {
                width: 254, height: 40, color: COLOR.TEXT_SECONDARY, x: 0, y: -8,
                lineHeight: 19, overflow: 'shrink',
            });

            const names = SLOT_ORDER
                .map((slot) => SKILLS.find((sk) => sk.classId === def.id && sk.suffix === slot))
                .filter((sk) => !!sk)
                .map((sk) => sk!.name)
                .join(' · ');
            createLabel(card, names, 14, {
                width: 254, height: 40, color: selected ? '#BFDBFE' : COLOR.TEXT_SECONDARY,
                x: 0, y: -62, lineHeight: 19, overflow: 'shrink',
            });
            createLabel(card, selected ? '已选中' : '点击选择', 14, {
                width: 250, height: 20, color: selected ? COLOR.SUCCESS : COLOR.TEXT_DISABLED,
                x: 0, y: -100,
            });

            card.on(Node.EventType.TOUCH_END, this.onCardTap, this);
        }
    }

    private onCardTap(ev: EventTouch): void {
        const node = ev.currentTarget as Node;
        const name = node.name || '';
        const id = name.replace('ClassCard_', '') as ClassId;
        if (!CLASSES.some((c) => c.id === id)) return;
        this._sel = id;
        this.refresh();
    }

    private _onConfirmTap(): void {
        if (this.onPick) this.onPick(this._sel);
    }

    private _onCancelTap(): void {
        if (this.onCancel) this.onCancel();
    }
}
