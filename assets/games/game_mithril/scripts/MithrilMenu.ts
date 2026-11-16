/**
 * 《秘银远征》角色面板（M2 / M7）：装备页（8 槽 + 背包 + 属性）+ 饰品页（两格 + 拥有列表 + 协同）。
 *
 * 设计纪律（docs/plans/2026-11-14-game-mithril-design.md §12）：
 *  面板只做「数据 → 显示」的一次性刷新，不在 update 里逐帧重建；
 *  所有 handler 都是命名方法或按钮自带闭包，组件事件能解绑（AGENTS 红线 5）。
 *
 * 生效时机：装备 / 饰品变更只改存档，**下一局开始**才重建 CombatProfile。
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
    STAMINA_HP_PER_POINT, SYNERGIES, TRINKETS, TRINKET_BY_ID, TRINKET_TAG_NAMES,
} from './MithrilConfig';
import type { AffixId, EquipItem, GearSlot, TrinketDef } from './MithrilConfig';
import {
    affixValue, equipFromInventory, equipStats, equipTrinket, findInventoryIndex, ownsTrinket,
    qualitySpecialLines, sellFromInventory, sellPrice, sortedInventory, staminaOf,
    unequipToInventory, unequipTrinket,
} from './MithrilLoot';
import type { EquipStats } from './MithrilLoot';
import type { MithrilSave } from './MithrilProgress';
import { profileFromSave } from './MithrilCore';
import { equippedTags, litSynergies } from './MithrilTrinkets';

const { ccclass } = _decorator;

const ROWS_PER_PAGE = 6;
const HINT_TEXT = '装备变更将在下一局生效';
const TRINKET_HINT_TEXT = '饰品变更将在下一局生效';
const PANEL_W = 680;
const PANEL_H = 1180;

type Selection =
    | { kind: 'inv'; uid: string }
    | { kind: 'slot'; slot: GearSlot }
    | { kind: 'trinket'; id: string }
    | { kind: 'trinketSlot'; slot: number }
    | null;

type MenuTab = 'gear' | 'trinket';

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

    // ---- 页签与饰品页（M7） ----
    private _tab: MenuTab = 'gear';
    /** 装备页的全部节点：切到饰品页时整体隐藏，页签按钮与饰品页不在其中 */
    private _gearNodes: Node[] = [];
    private _trinketRoot: Node | null = null;
    private _tSlotBtns: UiButton[] = [];
    private _tRowRoot: Node | null = null;
    private _tCountLabel: Label | null = null;
    private _tPageLabel: Label | null = null;
    /** 翻页按钮：只有一页时隐藏（试玩 N56） */
    private _tPrevBtn: UiButton | null = null;
    private _tNextBtn: UiButton | null = null;
    private _gearTabBtn: UiButton | null = null;
    private _trinketTabBtn: UiButton | null = null;
    private _tDetailTitle: Label | null = null;
    private _tDetailBody: Label | null = null;
    private _tSynergyLabel: Label | null = null;
    private _tHintLabel: Label | null = null;
    private _tEquipBtn: UiButton | null = null;
    private _tUnequipBtn: UiButton | null = null;
    /** 装备到哪一格（0/1），点槽位切换 */
    private _slotSel = 0;

    open(save: MithrilSave, floorIlvl = 0): void {
        this._save = save;
        this._floorIlvl = floorIlvl;
        this._sel = null;
        this._page = 0;
        // 记住上次停留的页签（试玩 N57）：只在内存里保留，重载后回到装备页。
        // 管理饰品是连续动作，每次重开都跳回装备页等于强迫玩家多点一次。
        // 默认落到第一个空槽，装备饰品时少点一次
        this._slotSel = save.trinkets[0] ? 1 : 0;
        this._ensureBuilt();
        if (!this._root) return;
        this._root.active = true;
        this._applyTabVisibility();
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
        if (this._tHintLabel) {
            this._tHintLabel.string = TRINKET_HINT_TEXT;
            this._tHintLabel.color = hex(COLOR.WARNING);
        }
        if (this._tab === 'trinket') {
            this._refreshTrinkets();
            return;
        }
        this._refreshStats();
        this._refreshSlots();
        this._refreshRows();
        this._refreshDetail();
    }

    // ==================== 页签 ====================

    private _applyTabVisibility(): void {
        const gear = this._tab === 'gear';
        for (const n of this._gearNodes) {
            if (n && n.isValid) n.active = gear;
        }
        if (this._trinketRoot && this._trinketRoot.isValid) this._trinketRoot.active = !gear;
        if (this._gearTabBtn) this._gearTabBtn.setColor(gear ? '#1E3A5F' : '#334155', COLOR.TEXT_PRIMARY);
        if (this._trinketTabBtn) {
            this._trinketTabBtn.setColor(gear ? '#334155' : '#1E3A5F', COLOR.TEXT_PRIMARY);
        }
    }

    private _setTab(tab: MenuTab): void {
        if (this._tab === tab) return;
        this._tab = tab;
        this._sel = null;
        this._applyTabVisibility();
        this.refresh();
    }

    private _onGearTabTap(): void {
        this._setTab('gear');
    }

    private _onTrinketTabTap(): void {
        this._setTab('trinket');
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

        const titleLabel = createLabel(panel, '角色', 36, {
            width: 300, height: 48, color: COLOR.TEXT_PRIMARY, bold: true, x: 0, y: 540,
        });
        const closeBtn = createButton(panel, {
            w: 120, h: 54, text: '返回', fontSize: 24,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 14, onTap: () => this._onCloseTap(),
        });
        closeBtn.node.setPosition(268, 540, 0);

        this._statsLabel = createLabel(panel, '', 19, {
            width: 660, height: 90, color: COLOR.TEXT_SECONDARY, x: 0, y: 400, lineHeight: 30,
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
        // 高度自助增长（Overflow.NONE 会把节点撑到内容大小）：4 词条 + 耐力 + 改造 + 品质特效
        // 最多 7 行，lineHeight 26 时 182 px，正好落在标题（−295）与按钮（−484）之间。
        this._detailBody = createLabel(panel, '', 18, {
            width: 600, height: 130, color: COLOR.TEXT_SECONDARY, x: 0, y: -389, lineHeight: 26,
        });

        this._equipBtn = createButton(panel, {
            w: 160, h: 56, text: '穿上', fontSize: 24,
            fill: COLOR.SUCCESS, textColor: '#FFFFFF', activeFill: '#15803D',
            radius: 12, onTap: () => this._onEquipTap(),
        });
        this._equipBtn.node.setPosition(-180, -512, 0);
        this._unequipBtn = createButton(panel, {
            w: 160, h: 56, text: '卸下', fontSize: 24,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 12, onTap: () => this._onUnequipTap(),
        });
        this._unequipBtn.node.setPosition(0, -512, 0);
        this._sellBtn = createButton(panel, {
            w: 160, h: 56, text: '出售', fontSize: 24,
            fill: '#B45309', textColor: '#FFFFFF', activeFill: '#92400E',
            radius: 12, onTap: () => this._onSellTap(),
        });
        this._sellBtn.node.setPosition(180, -512, 0);

        // ---- 页签（常驻）与饰品页（M7） ----
        // 先给装备页拍快照：此刻面板的子节点全部是装备页控件，
        // 页签按钮与饰品页在其后创建，不会被一起隐藏。
        // 标题与「返回」例外：两个页签都要能看到、能按到（否则饰品页上没有退出路径，
        // 遮罩还会把点击全吞掉）。
        this._gearNodes = panel.children.filter((n) => n !== closeBtn.node && n !== titleLabel.node);

        this._gearTabBtn = createButton(panel, {
            w: 140, h: 44, text: '装备', fontSize: 22,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 10, onTap: () => this._onGearTabTap(),
        });
        this._gearTabBtn.node.setPosition(-92, 478, 0);
        this._trinketTabBtn = createButton(panel, {
            w: 140, h: 44, text: '饰品', fontSize: 22,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 10, onTap: () => this._onTrinketTabTap(),
        });
        this._trinketTabBtn.node.setPosition(64, 478, 0);

        this._buildTrinketPage(panel);
        this._applyTabVisibility();
    }

    /** 饰品页：两个装备槽 + 拥有列表（分页）+ 详情 + 协同栏 */
    private _buildTrinketPage(panel: Node): void {
        const root = new Node('TrinketTab');
        root.layer = this.node.layer;
        root.addComponent(UITransform).setContentSize(PANEL_W, PANEL_H);
        panel.addChild(root);
        this._trinketRoot = root;

        for (let i = 0; i < 2; i++) {
            const btn = createButton(root, {
                w: 300, h: 96, text: '', fontSize: 19,
                fill: '#1E293B', textColor: COLOR.TEXT_PRIMARY, activeFill: '#1E3A5F',
                radius: 14, onTap: () => this._onTrinketSlotTap(i),
            });
            btn.node.setPosition(i === 0 ? -160 : 160, 400, 0);
            btn.node.name = `TrinketSlot_${i}`;
            this._tSlotBtns[i] = btn;
        }

        this._tCountLabel = createLabel(root, '', 20, {
            width: 320, height: 34, color: COLOR.TEXT_PRIMARY, bold: true, x: -190, y: 320,
        });
        const prev = createButton(root, {
            w: 84, h: 40, text: '上一页', fontSize: 16,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 10, onTap: () => this._onTrinketPrevPage(),
        });
        prev.node.setPosition(104, 320, 0);
        this._tPrevBtn = prev;
        this._tPageLabel = createLabel(root, '', 17, {
            width: 130, height: 28, color: COLOR.TEXT_SECONDARY, x: 204, y: 320,
        });
        const next = createButton(root, {
            w: 84, h: 40, text: '下一页', fontSize: 16,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 10, onTap: () => this._onTrinketNextPage(),
        });
        next.node.setPosition(298, 320, 0);
        this._tNextBtn = next;
        this._tHintLabel = createLabel(root, TRINKET_HINT_TEXT, 17, {
            width: 600, height: 24, color: COLOR.WARNING, x: 0, y: 284,
        });

        const rows = new Node('TRows');
        rows.layer = this.node.layer;
        rows.addComponent(UITransform).setContentSize(620, 370);
        rows.setPosition(0, 20, 0);
        root.addChild(rows);
        this._tRowRoot = rows;

        this._tDetailTitle = createLabel(root, '', 21, {
            width: 600, height: 30, color: COLOR.TEXT_PRIMARY, bold: true, x: 0, y: -212,
        });
        this._tDetailBody = createLabel(root, '', 17, {
            width: 600, height: 190, color: COLOR.TEXT_SECONDARY, x: 0, y: -330, lineHeight: 28,
        });
        this._tSynergyLabel = createLabel(root, '', 18, {
            width: 600, height: 52, color: COLOR.WARNING, x: 0, y: -470, lineHeight: 26,
        });

        this._tEquipBtn = createButton(root, {
            w: 180, h: 56, text: '装备', fontSize: 24,
            fill: COLOR.SUCCESS, textColor: '#FFFFFF', activeFill: '#15803D',
            radius: 12, onTap: () => this._onTrinketEquipTap(),
        });
        this._tEquipBtn.node.setPosition(-105, -540, 0);
        this._tUnequipBtn = createButton(root, {
            w: 180, h: 56, text: '卸下', fontSize: 24,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 12, onTap: () => this._onTrinketUnequipTap(),
        });
        this._tUnequipBtn.node.setPosition(105, -540, 0);
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
        // 3 行（不是 4 行）：「装备 / 饰品」页签压在 y=478，4 行会被页签吃掉第一行
        return [
            `攻击强度 ${prof.attackPower.toFixed(1)}    生命上限 ${Math.round(prof.maxHp)}`,
            `暴击 ${pct(prof.critChance)}    急速 ${pct(prof.haste)}    精通 ${pct(prof.mastery)}    全能 ${pct(prof.vers)}`,
            `平均装等 ${extra.ilvl.toFixed(1)}    已装备 ${extra.equipped}/8    耐力 +${extra.stamina}（生命 +${extra.bonusHp}）`,
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
        for (const line of qualitySpecialLines(item)) lines.push(line);
        this._detailBody.string = lines.join('\n');

        const isInv = this._sel?.kind === 'inv';
        // 出售只对背包件有效；选槽位时不给一个点了没反应的按钮
        this._setActions(isInv, this._sel?.kind === 'slot', isInv);
    }

    // ==================== 饰品页刷新（M7） ====================

    private _ownedTrinkets(): TrinketDef[] {
        const save = this._save;
        if (!save) return [];
        return TRINKETS.filter((t) => ownsTrinket(save, t.id));
    }

    private _trinketSlotOf(id: string): number {
        const save = this._save;
        return save ? save.trinkets.indexOf(id) : -1;
    }

    private _refreshTrinkets(): void {
        const save = this._save;
        const rows = this._tRowRoot;
        if (!save || !rows) return;

        // 两个装备槽：选中态高亮，空槽灰字
        for (let i = 0; i < 2; i++) {
            const btn = this._tSlotBtns[i];
            if (!btn) continue;
            const id = save.trinkets[i];
            const def = id ? TRINKET_BY_ID[id] : null;
            const picked = this._sel?.kind === 'trinketSlot' && this._sel.slot === i;
            btn.setText(def
                ? `槽 ${i + 1} · ${def.name}（${TRINKET_TAG_NAMES[def.tag]}）`
                : `槽 ${i + 1} · 空`);
            btn.setColor(picked ? '#1E3A5F' : '#1E293B', def ? COLOR.TEXT_PRIMARY : '#64748B');
        }

        const owned = this._ownedTrinkets();
        const pages = Math.max(1, Math.ceil(owned.length / ROWS_PER_PAGE));
        if (this._page >= pages) this._page = pages - 1;
        if (this._page < 0) this._page = 0;
        if (this._tCountLabel) {
            this._tCountLabel.string = `已拥有饰品 ${owned.length}/${TRINKETS.length}`;
        }
        if (this._tPageLabel) this._tPageLabel.string = `${this._page + 1} / ${pages}`;
        // 只有一页时翻页按钮点了也没反应，直接隐藏（试玩 N56）
        if (this._tPrevBtn) this._tPrevBtn.node.active = pages > 1;
        if (this._tNextBtn) this._tNextBtn.node.active = pages > 1;

        const kids = rows.children.slice();
        rows.removeAllChildren();
        for (const k of kids) k.destroy();

        const pageItems = owned.slice(this._page * ROWS_PER_PAGE, (this._page + 1) * ROWS_PER_PAGE);
        if (pageItems.length === 0) {
            createLabel(rows, '还没有饰品 —— 副本 BOSS 首通必掉一件本副本未拥有的', 18, {
                width: 600, height: 40, color: COLOR.TEXT_SECONDARY, x: 0, y: 120,
            });
        }
        for (let i = 0; i < pageItems.length; i++) {
            const def = pageItems[i];
            const equippedAt = this._trinketSlotOf(def.id);
            const selected = this._sel?.kind === 'trinket' && this._sel.id === def.id;
            const btn = createButton(rows, {
                w: 620, h: 56, text: '',
                fontSize: 19,
                fill: selected ? '#1E3A5F' : '#1E293B',
                textColor: COLOR.TEXT_PRIMARY,
                activeFill: '#1E3A5F',
                radius: 10,
                onTap: () => this._onTrinketRowTap(def.id),
            });
            btn.node.setPosition(0, 150 - i * 60, 0);
            btn.node.name = `TrinketRow_${def.id}`;
            const mark = equippedAt >= 0 ? `[已装备 ${equippedAt + 1}]` : '';
            btn.setText(`${def.name}（${TRINKET_TAG_NAMES[def.tag]}）${mark}`);
        }

        this._refreshTrinketDetail();
    }

    private _refreshTrinketDetail(): void {
        const save = this._save;
        if (!save || !this._tDetailTitle || !this._tDetailBody) return;
        const sel = this._sel;
        let def: TrinketDef | null = null;
        if (sel?.kind === 'trinket') def = TRINKET_BY_ID[sel.id] || null;
        else if (sel?.kind === 'trinketSlot') {
            const id = save.trinkets[sel.slot];
            def = id ? TRINKET_BY_ID[id] || null : null;
        }

        if (!def) {
            this._tDetailTitle.string = '点上方两格看已装备，点下方列表看详情';
            this._tDetailTitle.color = hex(COLOR.TEXT_SECONDARY);
            this._tDetailBody.string = '饰品只改规则、不加固定数值：\n'
                + `两件不同 tag 的饰品同时装备会点亮协同（共 ${SYNERGIES.length} 条）。`;
            this._setTrinketActions(false, false);
            this._refreshSynergyFooter();
            return;
        }

        const at = this._trinketSlotOf(def.id);
        this._tDetailTitle.string = `${def.name}（${TRINKET_TAG_NAMES[def.tag]}）`;
        this._tDetailTitle.color = hex(COLOR.TEXT_PRIMARY);
        const lines = [def.effect];
        lines.push(at >= 0 ? `状态：已装备 · 槽 ${at + 1}` : '状态：在背包中（未装备）');
        // 目标槽已有别的饰品时写明会被替换（试玩 N55：旧实现静默替换，玩家不知道丢了什么）
        const targetId = this._slotSel === 0 || this._slotSel === 1 ? save.trinkets[this._slotSel] : null;
        const targetDef = targetId && targetId !== def.id ? TRINKET_BY_ID[targetId] || null : null;
        if (targetDef) {
            lines.push(`目标槽：槽 ${this._slotSel + 1}（将替换「${targetDef.name}」，点上方槽位可切换）`);
        } else {
            lines.push(`目标槽：槽 ${this._slotSel + 1}（点上方槽位可切换）`);
        }
        this._tDetailBody.string = lines.join('\n');

        const slotOccupied = sel?.kind === 'trinketSlot' && !!save.trinkets[sel.slot];
        this._setTrinketActions(sel?.kind === 'trinket', !!slotOccupied);
        this._refreshSynergyFooter();
    }

    private _refreshSynergyFooter(): void {
        const save = this._save;
        if (!save || !this._tSynergyLabel) return;
        const lit = litSynergies(save.trinkets);
        const tags = equippedTags(save.trinkets);
        if (lit.length > 0) {
            const text = lit
                .map((s) => `${s.name}（${TRINKET_TAG_NAMES[s.a]} + ${TRINKET_TAG_NAMES[s.b]}）`)
                .join(' / ');
            this._tSynergyLabel.string = `协同已点亮：${text}`;
            this._tSynergyLabel.color = hex(COLOR.WARNING);
            return;
        }
        // 三态文案（试玩 N54）：空 / 真同 tag / tag 不同但没这条协同。
        // 旧实现把「两格都有但没点亮」一律说成「两件同 tag」，
        // 而 45 种 tag 配对里有 33 种是不同 tag 且无协同 —— 与两格显示的 tag 自相矛盾。
        if (tags.length < 2) {
            this._tSynergyLabel.string = `协同：两件不同 tag 的饰品同时装备可点亮（共 ${SYNERGIES.length} 条）`;
        } else if (tags[0] === tags[1]) {
            this._tSynergyLabel.string = `协同：两件都是「${TRINKET_TAG_NAMES[tags[0]]}」tag，同 tag 不产生协同 —— 换一件不同 tag 的试试`;
        } else {
            this._tSynergyLabel.string = `协同：${TRINKET_TAG_NAMES[tags[0]]} + ${TRINKET_TAG_NAMES[tags[1]]} 没有对应协同 —— 换一件试试`;
        }
        this._tSynergyLabel.color = hex(COLOR.TEXT_SECONDARY);
    }

    private _setTrinketActions(equip: boolean, unequip: boolean): void {
        if (this._tEquipBtn) {
            this._tEquipBtn.node.active = equip;
            this._tEquipBtn.setText(`装备到槽 ${this._slotSel + 1}`);
        }
        if (this._tUnequipBtn) this._tUnequipBtn.node.active = unequip;
    }

    private _onTrinketSlotTap(slot: number): void {
        this._slotSel = slot;
        this._sel = { kind: 'trinketSlot', slot };
        this.refresh();
    }

    private _onTrinketRowTap(id: string): void {
        this._sel = { kind: 'trinket', id };
        this.refresh();
    }

    private _onTrinketEquipTap(): void {
        const save = this._save;
        const sel = this._sel;
        if (!save || !sel || sel.kind !== 'trinket') return;
        if (!equipTrinket(save, sel.id, this._slotSel)) {
            this._notice('装备失败：同一件不能占两格 —— 先卸下另一格');
            return;
        }
        this._sel = { kind: 'trinketSlot', slot: this._slotSel };
        this._changed();
    }

    private _onTrinketUnequipTap(): void {
        const save = this._save;
        const sel = this._sel;
        if (!save || !sel || sel.kind !== 'trinketSlot') return;
        if (!unequipTrinket(save, sel.slot)) {
            this._notice('这一格没有饰品');
            return;
        }
        this._sel = null;
        this._changed();
    }

    private _onTrinketPrevPage(): void {
        if (this._page > 0) this._page--;
        this._refreshTrinkets();
    }

    private _onTrinketNextPage(): void {
        const pages = Math.max(1, Math.ceil(this._ownedTrinkets().length / ROWS_PER_PAGE));
        if (this._page < pages - 1) this._page++;
        this._refreshTrinkets();
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
        if (sel.kind !== 'inv') return null;
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

    /** 失败提示：写进当前页签的提示行，下一次任意交互（refresh）自动复位 */
    private _notice(text: string): void {
        const label = this._tab === 'trinket' ? this._tHintLabel : this._hintLabel;
        if (!label) return;
        label.string = text;
        label.color = hex(COLOR.DANGER);
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
        // 饰品页（M7）：同样只清引用
        this._gearNodes = [];
        this._trinketRoot = null;
        this._tSlotBtns = [];
        this._tRowRoot = null;
        this._tCountLabel = null;
        this._tPageLabel = null;
        this._tPrevBtn = null;
        this._tNextBtn = null;
        this._gearTabBtn = null;
        this._trinketTabBtn = null;
        this._tDetailTitle = null;
        this._tDetailBody = null;
        this._tSynergyLabel = null;
        this._tHintLabel = null;
        this._tEquipBtn = null;
        this._tUnequipBtn = null;
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
