/**
 * 《秘银远征》装备面板（M2）：8 槽位 + 背包分页 + 属性总览 + 穿上/卸下/出售。
 *
 * 设计纪律（docs/plans/2026-11-14-game-mithril-design.md §12）：
 *  面板只做「数据 → 显示」的一次性刷新，不在 update 里逐帧重建；
 *  所有 handler 都是命名方法或按钮自带闭包，组件事件能解绑（AGENTS 红线 5）。
 *
 * 生效时机：装备变更只改存档，**下一局开始**才重建 CombatProfile。
 * 面板里会明确写出来，避免玩家以为当场 DPS 变了。
 */

import {
    _decorator, BlockInputEvents, Component, Graphics, Label, Node, UITransform,
} from 'cc';
import {
    COLOR, createButton, createLabel, hex,
} from '../../../common/ui/GameUIKit';
import type { UiButton } from '../../../common/ui/GameUIKit';
import {
    AFFIX_BY_ID, GEAR_BASE_BY_ID, GEAR_SLOT_NAMES, GEAR_SLOTS, MODIFIER_BY_ID, QUALITY_BY_ID,
    STAMINA_HP_PER_POINT,
} from './MithrilConfig';
import type { AffixId, EquipItem, GearSlot } from './MithrilConfig';
import {
    affixValue, equipFromInventory, equipStats, findInventoryIndex, sellFromInventory,
    sellPrice, sortedInventory, staminaOf, unequipToInventory,
} from './MithrilLoot';
import type { EquipStats } from './MithrilLoot';
import type { MithrilSave } from './MithrilProgress';
import { profileFromSave } from './MithrilCore';

const { ccclass } = _decorator;

const ROWS_PER_PAGE = 6;
const HINT_TEXT = '装备变更将在下一局生效';
const PANEL_W = 680;
const PANEL_H = 1180;

type Selection =
    | { kind: 'inv'; uid: string }
    | { kind: 'slot'; slot: GearSlot }
    | null;

@ccclass('MithrilMenu')
export class MithrilMenu extends Component {
    /** 关闭面板（回到战斗/结算） */
    onClose: (() => void) | null = null;
    /** 存档被修改（装备/出售），由主组件决定何时重算 profile */
    onChanged: (() => void) | null = null;

    private _save: MithrilSave | null = null;
    private _sel: Selection = null;
    private _page = 0;
    /** 下一场战斗的副属性地板（与 MithrilGame 出战 profile 取法一致） */
    private _floorIlvl = 0;

    private _built = false;
    /** 整棵树（遮罩 + 面板）：显隐只认它，避免「面板关了、全屏遮罩还在吞触摸」 */
    private _root: Node | null = null;
    private _panel: Node | null = null;
    private _statsLabel: Label | null = null;
    private _goldLabel: Label | null = null;
    private _pageLabel: Label | null = null;
    private _detailTitle: Label | null = null;
    private _detailBody: Label | null = null;
    private _slotBtns: Partial<Record<GearSlot, UiButton>> = {};
    private _rowRoot: Node | null = null;
    private _equipBtn: UiButton | null = null;
    private _unequipBtn: UiButton | null = null;
    private _sellBtn: UiButton | null = null;
    private _hintLabel: Label | null = null;

    open(save: MithrilSave, floorIlvl = 0): void {
        this._save = save;
        this._floorIlvl = floorIlvl;
        this._sel = null;
        this._page = 0;
        this._ensureBuilt();
        if (!this._root) return;
        this._root.active = true;
        this.refresh();
    }

    close(): void {
        if (this._root) this._root.active = false;
    }

    isOpen(): boolean {
        return !!(this._root && this._root.active);
    }

    /** 面板可见时才需要刷（也用于外部数据变化的主动刷新） */
    refresh(): void {
        const save = this._save;
        if (!save || !this._panel) return;
        // 每次刷新都把提示行复位：操作失败的信息只保留到下一次交互
        if (this._hintLabel) {
            this._hintLabel.string = HINT_TEXT;
            this._hintLabel.color = hex(COLOR.WARNING);
        }
        this._refreshStats();
        this._refreshSlots();
        this._refreshRows();
        this._refreshDetail();
    }

    // ==================== 构建 ====================

    private _ensureBuilt(): void {
        if (this._built) return;
        this._built = true;

        const root = new Node('Menu');
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
        this._panel = panel;
        // 首次构建不显示：整棵树关掉（面板 + 遮罩一起），open() 再打开
        root.active = false;

        createLabel(panel, '装备', 36, {
            width: 300, height: 48, color: COLOR.TEXT_PRIMARY, bold: true, x: 0, y: 540,
        });
        const closeBtn = createButton(panel, {
            w: 120, h: 54, text: '返回', fontSize: 24,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 14, onTap: () => this._onCloseTap(),
        });
        closeBtn.node.setPosition(268, 540, 0);

        this._statsLabel = createLabel(panel, '', 20, {
            width: 600, height: 132, color: COLOR.TEXT_SECONDARY, x: 0, y: 415, lineHeight: 33,
        });
        this._hintLabel = createLabel(panel, HINT_TEXT, 17, {
            width: 600, height: 24, color: COLOR.WARNING, x: 0, y: 342,
        });
        this._goldLabel = createLabel(panel, '', 18, {
            width: 600, height: 24, color: COLOR.WARNING, x: 0, y: 312,
        });

        // 8 槽位：2 行 × 4
        const slotPos: Array<[GearSlot, number, number]> = [
            ['mainHand', -252, 252], ['offHand', -84, 252], ['head', 84, 252], ['chest', 252, 252],
            ['hands', -252, 176], ['legs', -84, 176], ['feet', 84, 176], ['ring', 252, 176],
        ];
        for (const [slot, x, y] of slotPos) {
            const btn = createButton(panel, {
                w: 156, h: 66, text: '', fontSize: 17,
                fill: '#1E293B', textColor: COLOR.TEXT_PRIMARY, activeFill: '#1E3A5F',
                radius: 12, onTap: () => this._onSlotTap(slot),
            });
            btn.node.setPosition(x, y, 0);
            this._slotBtns[slot] = btn;
        }

        createLabel(panel, '背包', 24, {
            width: 200, height: 34, color: COLOR.TEXT_PRIMARY, bold: true, x: -230, y: 128,
        });
        const prev = createButton(panel, {
            w: 96, h: 44, text: '上一页', fontSize: 18,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 10, onTap: () => this._onPrevPage(),
        });
        prev.node.setPosition(96, 128, 0);
        this._pageLabel = createLabel(panel, '', 18, {
            width: 130, height: 28, color: COLOR.TEXT_SECONDARY, x: 204, y: 128,
        });
        const next = createButton(panel, {
            w: 96, h: 44, text: '下一页', fontSize: 18,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 10, onTap: () => this._onNextPage(),
        });
        next.node.setPosition(304, 128, 0);

        const rows = new Node('Rows');
        rows.layer = this.node.layer;
        rows.addComponent(UITransform).setContentSize(620, 370);
        rows.setPosition(0, -70, 0);
        panel.addChild(rows);
        this._rowRoot = rows;

        this._detailTitle = createLabel(panel, '', 22, {
            width: 600, height: 30, color: COLOR.TEXT_PRIMARY, bold: true, x: 0, y: -280,
        });
        this._detailBody = createLabel(panel, '', 18, {
            width: 600, height: 130, color: COLOR.TEXT_SECONDARY, x: 0, y: -355, lineHeight: 30,
        });

        this._equipBtn = createButton(panel, {
            w: 160, h: 56, text: '穿上', fontSize: 24,
            fill: COLOR.SUCCESS, textColor: '#FFFFFF', activeFill: '#15803D',
            radius: 12, onTap: () => this._onEquipTap(),
        });
        this._equipBtn.node.setPosition(-180, -485, 0);
        this._unequipBtn = createButton(panel, {
            w: 160, h: 56, text: '卸下', fontSize: 24,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 12, onTap: () => this._onUnequipTap(),
        });
        this._unequipBtn.node.setPosition(0, -485, 0);
        this._sellBtn = createButton(panel, {
            w: 160, h: 56, text: '出售', fontSize: 24,
            fill: '#B45309', textColor: '#FFFFFF', activeFill: '#92400E',
            radius: 12, onTap: () => this._onSellTap(),
        });
        this._sellBtn.node.setPosition(180, -485, 0);
    }

    // ==================== 刷新 ====================

    /**
     * 面板数值必须等于**下一局真正出战**的 profile（含地板），
     * 否则玩家会看到「面板 0% 暴击、实战打出暴击」这种自相矛盾的读数。
     */
    private _profileStats(extra: EquipStats): string {
        const save = this._save!;
        const prof = profileFromSave(save, this._floorIlvl);
        const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
        return [
            `攻击强度 ${prof.attackPower.toFixed(1)}    生命上限 ${Math.round(prof.maxHp)}（耐力 +${extra.stamina} / 生命 +${extra.bonusHp}）`,
            `暴击 ${pct(prof.critChance)}    急速 ${pct(prof.haste)}`,
            `精通 ${pct(prof.mastery)}    全能 ${pct(prof.vers)}`,
            `平均装等 ${extra.ilvl.toFixed(1)}    已装备 ${extra.equipped}/8`,
        ].join('\n');
    }

    private _refreshStats(): void {
        const save = this._save;
        if (!save || !this._statsLabel) return;
        const st = equipStats(save.equips);
        this._statsLabel.string = this._profileStats(st);
        if (this._goldLabel) this._goldLabel.string = `金币 ${Math.max(0, Math.floor(save.gold || 0))}`;
    }

    private _refreshSlots(): void {
        const save = this._save;
        if (!save) return;
        for (const slot of GEAR_SLOTS) {
            const btn = this._slotBtns[slot];
            if (!btn) continue;
            const item = save.equips[slot];
            if (item) {
                const q = QUALITY_BY_ID[item.quality];
                btn.setText(`${GEAR_SLOT_NAMES[slot]} ${item.ilvl}`);
                btn.setColor('#1E293B', q ? q.color : COLOR.TEXT_PRIMARY);
                btn.node.name = `Slot_${slot}`;
            } else {
                btn.setText(`${GEAR_SLOT_NAMES[slot]} 空`);
                btn.setColor('#1E293B', '#64748B');
                btn.node.name = `Slot_${slot}`;
            }
        }
    }

    private _refreshRows(): void {
        const save = this._save;
        const rows = this._rowRoot;
        if (!save || !rows) return;

        const kids = rows.children.slice();
        rows.removeAllChildren();
        for (const k of kids) k.destroy();

        const list = sortedInventory(save);
        const pages = Math.max(1, Math.ceil(list.length / ROWS_PER_PAGE));
        if (this._page >= pages) this._page = pages - 1;
        if (this._page < 0) this._page = 0;
        if (this._pageLabel) this._pageLabel.string = `${this._page + 1} / ${pages}（${list.length}）`;

        const start = this._page * ROWS_PER_PAGE;
        const pageItems = list.slice(start, start + ROWS_PER_PAGE);
        if (pageItems.length === 0) {
            createLabel(rows, '背包是空的 —— 击败矿坑巨魔会掉落紫装', 19, {
                width: 600, height: 40, color: COLOR.TEXT_SECONDARY, x: 0, y: 120,
            });
            return;
        }
        for (let i = 0; i < pageItems.length; i++) {
            const item = pageItems[i];
            const q = QUALITY_BY_ID[item.quality];
            const btn = createButton(rows, {
                w: 620, h: 56, text: '',
                fontSize: 20,
                fill: this._isSelectedInv(item) ? '#1E3A5F' : '#1E293B',
                textColor: q ? q.color : COLOR.TEXT_PRIMARY,
                activeFill: '#1E3A5F',
                radius: 10,
                onTap: () => this._onRowTap(item.uid),
            });
            btn.node.setPosition(0, 150 - i * 60, 0);
            btn.node.name = `Row_${item.uid}`;
            const moved = item.modifier ? ' ◆' : '';
            btn.setText(`${itemDesc(item)}${moved}`);
        }
    }

    private _refreshDetail(): void {
        if (!this._detailTitle || !this._detailBody) return;
        const item = this._selectedItem();
        if (!item) {
            this._detailTitle.string = '点击上方装备槽或背包物品查看详情';
            this._detailTitle.color = hex(COLOR.TEXT_SECONDARY);
            this._detailBody.string = '';
            this._setActions(false, false, false);
            return;
        }
        const q = QUALITY_BY_ID[item.quality];
        const base = GEAR_SLOT_NAMES[item.slot];
        this._detailTitle.string = `${itemName(item)}（${q ? q.name : ''} · ${base} · 装等 ${item.ilvl}）`;
        this._detailTitle.color = hex(q ? q.color : COLOR.TEXT_PRIMARY);

        const lines: string[] = [];
        for (const roll of item.affixes) {
            const def = AFFIX_BY_ID[roll.id as AffixId];
            if (!def) continue;
            lines.push(`${def.name} +${(affixValue(roll.id, roll.points) * 100).toFixed(1)}%（${roll.points} 点）`);
        }
        lines.push(`耐力 +${staminaOf(item)}（生命 +${staminaOf(item) * STAMINA_HP_PER_POINT}）`);
        if (item.modifier) {
            const m = MODIFIER_BY_ID[item.modifier];
            if (m) lines.push(`改造「${m.name}」：${m.desc}`);
        }
        this._detailBody.string = lines.join('\n');

        const isInv = this._sel?.kind === 'inv';
        // 出售只对背包件有效；选槽位时不给一个点了没反应的按钮
        this._setActions(isInv, this._sel?.kind === 'slot', isInv);
    }

    private _setActions(equip: boolean, unequip: boolean, sell: boolean): void {
        if (this._equipBtn) this._equipBtn.node.active = equip;
        if (this._unequipBtn) this._unequipBtn.node.active = unequip;
        if (this._sellBtn) {
            this._sellBtn.node.active = sell;
            if (sell && this._sel?.kind === 'inv') {
                const item = this._selectedItem();
                if (item) this._sellBtn.setText(`出售 ${sellPrice(item)}`);
            } else {
                this._sellBtn.setText('出售');
            }
        }
    }

    // ==================== 选择与操作 ====================

    private _isSelectedInv(item: EquipItem): boolean {
        return this._sel?.kind === 'inv' && this._sel.uid === item.uid;
    }

    private _selectedItem(): EquipItem | null {
        const save = this._save;
        const sel = this._sel;
        if (!save || !sel) return null;
        if (sel.kind === 'slot') return save.equips[sel.slot] || null;
        const idx = findInventoryIndex(save, sel.uid);
        return idx >= 0 ? save.inventory[idx] : null;
    }

    private _onRowTap(uid: string): void {
        this._sel = { kind: 'inv', uid };
        this.refresh();
    }

    private _onSlotTap(slot: GearSlot): void {
        this._sel = { kind: 'slot', slot };
        this.refresh();
    }

    private _onEquipTap(): void {
        const save = this._save;
        const sel = this._sel;
        if (!save || !sel || sel.kind !== 'inv') return;
        const item = equipFromInventory(save, sel.uid);
        if (!item) {
            this._notice('穿上失败：物品已不在背包');
            return;
        }
        this._sel = { kind: 'slot', slot: item.slot };
        this._changed();
    }

    private _onUnequipTap(): void {
        const save = this._save;
        const sel = this._sel;
        if (!save || !sel || sel.kind !== 'slot') return;
        if (!unequipToInventory(save, sel.slot)) {
            // 满包时静默失败会让人以为按钮坏了，明确说清原因
            this._notice('背包已满，先出售或换装一件再卸下');
            return;
        }
        this._sel = null;
        this._changed();
    }

    private _onSellTap(): void {
        const save = this._save;
        const sel = this._sel;
        if (!save || !sel || sel.kind !== 'inv') return;
        const gold = sellFromInventory(save, sel.uid);
        if (gold <= 0) return;
        this._sel = null;
        this._changed();
    }

    /** 失败提示：写进提示行，下一次任意交互（refresh）自动复位 */
    private _notice(text: string): void {
        if (!this._hintLabel) return;
        this._hintLabel.string = text;
        this._hintLabel.color = hex(COLOR.DANGER);
    }

    private _changed(): void {
        this.refresh();
        if (this.onChanged) this.onChanged();
    }

    private _onPrevPage(): void {
        if (this._page > 0) this._page--;
        this._refreshRows();
    }

    private _onNextPage(): void {
        const save = this._save;
        if (!save) return;
        const pages = Math.max(1, Math.ceil(sortedInventory(save).length / ROWS_PER_PAGE));
        if (this._page < pages - 1) this._page++;
        this._refreshRows();
    }

    private _onCloseTap(): void {
        this.close();
        if (this.onClose) this.onClose();
    }

    onDestroy(): void {
        // 红线 4：只清引用，不碰节点
        this._save = null;
        this._root = null;
        this._panel = null;
        this._rowRoot = null;
        this._statsLabel = null;
        this._goldLabel = null;
        this._pageLabel = null;
        this._detailTitle = null;
        this._detailBody = null;
        this._hintLabel = null;
        this._equipBtn = null;
        this._unequipBtn = null;
        this._sellBtn = null;
        this._slotBtns = {};
    }
}

// ==================== 小工具（保持文件内聚，不 export） ====================

function itemName(item: EquipItem): string {
    if (!item) return '';
    const base = GEAR_BASE_BY_ID[item.baseId];
    return base ? base.name : item.baseId;
}

function itemDesc(item: EquipItem): string {
    const q = QUALITY_BY_ID[item.quality];
    return `${q ? q.name : ''}·${itemName(item)} · ${GEAR_SLOT_NAMES[item.slot]} · ${item.ilvl}`;
}
