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
import {
    addGlyphNode, drawGlyphMedallion, drawMithrilGlyph, trinketAccent,
} from './MithrilArt';
import { MITH_UI as T, drawInsetBoard, drawStoneTrim, qualityTextColor } from './MithrilTheme';

const { ccclass } = _decorator;

const ROWS_PER_PAGE = 6;
const HINT_TEXT = '装备变更将在下一场战斗生效（面板数值已按新装备计算）';
// 试玩 N140：原句「面板数值已按新饰品计算」与「饰品只改规则、不加固定数值」同屏互相矛盾。
// 饰品既然不加数值，就不要承诺「已按新饰品计算」，只说明生效时点。
const TRINKET_HINT_TEXT = '饰品规则从下一场战斗开始生效';
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
    /** 背包翻页按钮：空背包 / 单页时整组隐藏（N96） */
    private _prevBtn: UiButton | null = null;
    private _nextBtn: UiButton | null = null;
    private _detailTitle: Label | null = null;
    private _detailBody: Label | null = null;
    private _slotBtns: Partial<Record<GearSlot, UiButton>> = {};
    /** 槽位部位图标：刷新时按品质色重画（N77） */
    private _slotIcons: Partial<Record<GearSlot, Node>> = {};
    private _rowRoot: Node | null = null;
    private _equipBtn: UiButton | null = null;
    private _unequipBtn: UiButton | null = null;
    private _sellBtn: UiButton | null = null;
    private _emptyGlyph: Node | null = null;
    private _hintLabel: Label | null = null;

    // ---- 页签与饰品页（M7） ----
    private _tab: MenuTab = 'gear';
    /** 装备页的全部节点：切到饰品页时整体隐藏，页签按钮与饰品页不在其中 */
    private _gearNodes: Node[] = [];
    private _trinketRoot: Node | null = null;
    private _tSlotBtns: UiButton[] = [];
    /** 饰品槽图形（空槽灰宝石 / 已装备按标签色画徽章） */
    private _tSlotIcons: Node[] = [];
    private _tRowRoot: Node | null = null;
    private _tCountLabel: Label | null = null;
    private _tPageLabel: Label | null = null;
    /** 翻页按钮：只有一页时隐藏（试玩 N56） */
    private _tPrevBtn: UiButton | null = null;
    private _tNextBtn: UiButton | null = null;
    private _gearTabBtn: UiButton | null = null;
    private _trinketTabBtn: UiButton | null = null;
    private _gearTabMark: Node | null = null;
    private _trinketTabMark: Node | null = null;
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
            this._hintLabel.color = hex(T.warning);
        }
        if (this._tHintLabel) {
            this._tHintLabel.string = TRINKET_HINT_TEXT;
            this._tHintLabel.color = hex(T.warning);
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
        if (this._gearTabBtn) this._gearTabBtn.setColor(gear ? T.rowActive : T.stoneLight, T.parchment);
        if (this._trinketTabBtn) {
            this._trinketTabBtn.setColor(gear ? T.stoneLight : T.rowActive, T.parchment);
        }
        if (this._gearTabMark && this._gearTabMark.isValid) this._gearTabMark.active = gear;
        if (this._trinketTabMark && this._trinketTabMark.isValid) this._trinketTabMark.active = !gear;
    }

    /** 给页签补图标与选中下划线（N76）；文字左移给图标让位 */
    private _tabMarkOf(btn: UiButton, kind: string, color: string, tab: MenuTab): void {
        btn.label.node.setPosition(12, 0);
        const ut = btn.label.node.getComponent(UITransform);
        if (ut) ut.setContentSize(140 - 36, 40);
        addGlyphNode(btn.node, `TabIcon_${tab}`, kind, 10, color, -42, 0, 40);
        const mark = new Node(`TabMark_${tab}`);
        mark.layer = btn.node.layer;
        mark.addComponent(UITransform).setContentSize(140, 44);
        const g = mark.addComponent(Graphics);
        g.fillColor = hex(color, 255);
        g.roundRect(-34, -20, 68, 3, 1.5);
        g.fill();
        btn.node.addChild(mark);
        // 下划线跟着文字走（文字右移 12 给左侧图标让位，线原本居中 → 永远偏左 12）
        mark.setPosition(12, 0);
        mark.active = false;
        if (tab === 'gear') this._gearTabMark = mark;
        else this._trinketTabMark = mark;
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
        pg.fillColor = hex(T.stone, 255);
        pg.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 26);
        pg.fill();
        pg.strokeColor = hex(T.goldDim, 255);
        pg.lineWidth = 3;
        pg.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 26);
        pg.stroke();
        drawStoneTrim(pg, PANEL_W, PANEL_H, 26);
        root.addChild(panel);
        this._panel = panel;
        // 首次构建不显示：整棵树关掉（面板 + 遮罩一起），open() 再打开
        root.active = false;

        const titleLabel = createLabel(panel, '角色', 36, {
            width: 300, height: 48, color: T.parchment, bold: true, x: 0, y: 540,
        });
        const closeBtn = createButton(panel, {
            w: 120, h: 54, text: '返回', fontSize: 24,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 14, onTap: () => this._onCloseTap(),
        });
        closeBtn.node.setPosition(268, 540, 0);

        this._statsLabel = createLabel(panel, '', 19, {
            width: 660, height: 90, color: T.parchmentDim, x: 0, y: 400, lineHeight: 30,
        });
        this._hintLabel = createLabel(panel, HINT_TEXT, 16, {
            width: 600, height: 24, color: T.warning, x: 0, y: 342,
        });
        this._goldLabel = createLabel(panel, '', 18, {
            width: 600, height: 24, color: T.warning, x: 0, y: 312,
        });

        // 8 槽位：2 行 × 4
        const slotPos: Array<[GearSlot, number, number]> = [
            ['mainHand', -252, 252], ['offHand', -84, 252], ['head', 84, 252], ['chest', 252, 252],
            ['hands', -252, 176], ['legs', -84, 176], ['feet', 84, 176], ['ring', 252, 176],
        ];
        for (const [slot, x, y] of slotPos) {
            const btn = createButton(panel, {
                w: 156, h: 66, text: '', fontSize: 17,
                fill: T.row, textColor: T.parchment, activeFill: T.rowActive,
                radius: 12, stroke: T.goldLine, onTap: () => this._onSlotTap(slot),
            });
            btn.node.setPosition(x, y, 0);
            // 部位剪影 + 品质色（N77：槽位不能只是一行文字）
            const icon = addGlyphNode(btn.node, `SlotIcon_${slot}`, slot, 14, T.parchmentMuted, -54, 0, 60);
            this._slotIcons[slot] = icon;
            btn.label.node.setPosition(17, 0);
            const ut = btn.label.node.getComponent(UITransform);
            if (ut) ut.setContentSize(156 - 48, 62);
            this._slotBtns[slot] = btn;
        }

        createLabel(panel, '背包', 24, {
            width: 200, height: 34, color: T.parchment, bold: true, x: -230, y: 128,
        });
        const prev = createButton(panel, {
            w: 96, h: 44, text: '上一页', fontSize: 18,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 10, onTap: () => this._onPrevPage(),
        });
        prev.node.setPosition(96, 128, 0);
        this._prevBtn = prev;
        this._pageLabel = createLabel(panel, '', 18, {
            width: 130, height: 28, color: T.parchmentDim, x: 204, y: 128,
        });
        const next = createButton(panel, {
            w: 96, h: 44, text: '下一页', fontSize: 18,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 10, onTap: () => this._onNextPage(),
        });
        next.node.setPosition(304, 128, 0);
        this._nextBtn = next;

        const rows = new Node('Rows');
        rows.layer = this.node.layer;
        rows.addComponent(UITransform).setContentSize(620, 370);
        rows.setPosition(0, -70, 0);
        panel.addChild(rows);
        this._rowRoot = rows;

        // 详情凹板：正文不再直接铺在石底上，空态也有一个明确的「框」（N96）
        const detailBoard = new Node('DetailBoard');
        detailBoard.layer = this.node.layer;
        detailBoard.addComponent(UITransform).setContentSize(620, 244);
        detailBoard.setPosition(0, -372, 0);
        drawInsetBoard(detailBoard.addComponent(Graphics), 620, 122, -122);
        panel.addChild(detailBoard);

        this._detailTitle = createLabel(panel, '', 22, {
            width: 600, height: 30, color: T.parchment, bold: true, x: 0, y: -282,
        });
        // 高度自助增长（Overflow.NONE 会把节点撑到内容大小）。行数上限 9：
        // 4 词条 + 耐力 + 改造 + 品质特效（传说 unique / 秘境 negative）+ 2 行换装预览。
        // 此处只给初始值，实际字号 / 行高 / 纵向锚点由 _refreshDetail 按行数分三档设置。
        this._detailBody = createLabel(panel, '', 18, {
            width: 600, height: 130, color: T.parchmentDim, x: 0, y: -398, lineHeight: 26,
        });
        // 未选中任何物品时，详情区不要留成一块空地：给一个低饱和大图形
        this._emptyGlyph = addGlyphNode(panel, 'MenuEmptyGlyph', 'mainHand', 40, T.goldDim, 0, -320, 12);

        this._equipBtn = createButton(panel, {
            w: 160, h: 56, text: '穿上', fontSize: 24,
            fill: T.emerald, textColor: T.parchment, activeFill: T.emeraldPressed,
            radius: 12, onTap: () => this._onEquipTap(),
        });
        this._equipBtn.node.setPosition(-180, -530, 0);
        this._unequipBtn = createButton(panel, {
            w: 160, h: 56, text: '卸下', fontSize: 24,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 12, onTap: () => this._onUnequipTap(),
        });
        this._unequipBtn.node.setPosition(0, -530, 0);
        this._sellBtn = createButton(panel, {
            w: 160, h: 56, text: '出售', fontSize: 24,
            fill: T.gold, textColor: T.ink, activeFill: T.goldPressed,
            radius: 12, onTap: () => this._onSellTap(),
        });
        this._sellBtn.node.setPosition(180, -530, 0);

        // ---- 页签（常驻）与饰品页（M7） ----
        // 先给装备页拍快照：此刻面板的子节点全部是装备页控件，
        // 页签按钮与饰品页在其后创建，不会被一起隐藏。
        // 标题与「返回」例外：两个页签都要能看到、能按到（否则饰品页上没有退出路径，
        // 遮罩还会把点击全吞掉）。
        this._gearNodes = panel.children.filter((n) => n !== closeBtn.node && n !== titleLabel.node);

        this._gearTabBtn = createButton(panel, {
            w: 140, h: 44, text: '装备', fontSize: 21,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 10, stroke: T.goldLine, onTap: () => this._onGearTabTap(),
        });
        this._gearTabBtn.node.setPosition(-92, 478, 0);
        this._trinketTabBtn = createButton(panel, {
            w: 140, h: 44, text: '饰品', fontSize: 21,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 10, stroke: T.goldLine, onTap: () => this._onTrinketTabTap(),
        });
        this._trinketTabBtn.node.setPosition(64, 478, 0);
        // 页签图标 + 选中下划线（N76：选中态不能只靠底色）
        this._tabMarkOf(this._gearTabBtn, 'mainHand', T.goldBright, 'gear');
        this._tabMarkOf(this._trinketTabBtn, 'trinket', T.gold, 'trinket');

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
                fill: T.row, textColor: T.parchment, activeFill: T.rowActive,
                radius: 14, stroke: T.goldLine, onTap: () => this._onTrinketSlotTap(i),
            });
            btn.node.setPosition(i === 0 ? -160 : 160, 400, 0);
            btn.node.name = `TrinketSlot_${i}`;
            // 饰品槽图形（N78）：空槽是灰宝石，装上后按标签色画成徽章
            const icon = addGlyphNode(btn.node, `TrinketSlotIcon_${i}`, 'trinket', 26, T.parchmentMuted, -104, 0, 30);
            this._tSlotIcons[i] = icon;
            btn.label.node.setPosition(28, 0);
            const ut = btn.label.node.getComponent(UITransform);
            if (ut) ut.setContentSize(300 - 76, 92);
            this._tSlotBtns[i] = btn;
        }

        this._tCountLabel = createLabel(root, '', 20, {
            width: 320, height: 34, color: T.parchment, bold: true, x: -190, y: 320,
        });
        const prev = createButton(root, {
            w: 84, h: 40, text: '上一页', fontSize: 16,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 10, onTap: () => this._onTrinketPrevPage(),
        });
        prev.node.setPosition(104, 320, 0);
        this._tPrevBtn = prev;
        this._tPageLabel = createLabel(root, '', 17, {
            width: 130, height: 28, color: T.parchmentDim, x: 204, y: 320,
        });
        const next = createButton(root, {
            w: 84, h: 40, text: '下一页', fontSize: 16,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 10, onTap: () => this._onTrinketNextPage(),
        });
        next.node.setPosition(298, 320, 0);
        this._tNextBtn = next;
        this._tHintLabel = createLabel(root, TRINKET_HINT_TEXT, 16, {
            width: 600, height: 24, color: T.warning, x: 0, y: 284,
        });

        const rows = new Node('TRows');
        rows.layer = this.node.layer;
        rows.addComponent(UITransform).setContentSize(620, 370);
        rows.setPosition(0, 20, 0);
        root.addChild(rows);
        this._tRowRoot = rows;

        this._tDetailTitle = createLabel(root, '', 21, {
            width: 600, height: 30, color: T.parchment, bold: true, x: 0, y: -212,
        });
        this._tDetailBody = createLabel(root, '', 17, {
            width: 600, height: 190, color: T.parchmentDim, x: 0, y: -330, lineHeight: 28,
        });
        this._tSynergyLabel = createLabel(root, '', 18, {
            width: 600, height: 52, color: T.warning, x: 0, y: -470, lineHeight: 26,
        });

        this._tEquipBtn = createButton(root, {
            w: 180, h: 56, text: '装备', fontSize: 24,
            fill: T.emerald, textColor: T.parchment, activeFill: T.emeraldPressed,
            radius: 12, onTap: () => this._onTrinketEquipTap(),
        });
        this._tEquipBtn.node.setPosition(-105, -540, 0);
        this._tUnequipBtn = createButton(root, {
            w: 180, h: 56, text: '卸下', fontSize: 24,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
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
            // 一件都没穿时不要显示「平均装等 1.0」这种假读数（N96）
            `平均装等 ${extra.equipped > 0 ? extra.ilvl.toFixed(1) : '—'}    已装备 ${extra.equipped}/8    耐力 +${extra.stamina}（生命 +${extra.bonusHp}）`,
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
            const q = item ? QUALITY_BY_ID[item.quality] : null;
            if (item) {
                btn.setText(`${GEAR_SLOT_NAMES[slot]} ${item.ilvl}`);
                btn.setColor(T.row, qualityTextColor(q, T.parchment));
            } else {
                btn.setText(`${GEAR_SLOT_NAMES[slot]} 空`);
                btn.setColor(T.row, T.parchmentMuted);
            }
            btn.node.name = `Slot_${slot}`;
            // 部位图标按品质上色：空槽灰、有装备取品质色
            const icon = this._slotIcons[slot];
            const g = icon ? icon.getComponent(Graphics) : null;
            if (g) {
                g.clear();
                drawMithrilGlyph(g, slot, 14, q ? q.color : T.parchmentMuted, item ? 70 : 26);
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
        // 空背包 / 只有一页时不给翻页按钮：点了也永远不动（N96）
        const pagerVisible = list.length > 0 && pages > 1;
        if (this._prevBtn) this._prevBtn.node.active = pagerVisible;
        if (this._nextBtn) this._nextBtn.node.active = pagerVisible;
        if (this._pageLabel) {
            this._pageLabel.node.active = list.length > 0;
            // 试玩 N179：「1 / 1（1）」三个数字没有单位，玩家猜不出是件数还是筛选结果。
            this._pageLabel.string = pages > 1
                ? `共 ${list.length} 件 · 第 ${this._page + 1}/${pages} 页`
                : `共 ${list.length} 件`;
        }

        const start = this._page * ROWS_PER_PAGE;
        const pageItems = list.slice(start, start + ROWS_PER_PAGE);
        if (pageItems.length === 0) {
            createLabel(rows, '背包是空的 —— 击败矿坑巨魔会掉落紫装', 19, {
                width: 600, height: 40, color: T.parchmentDim, x: 0, y: 24,
            });
            return;
        }
        for (let i = 0; i < pageItems.length; i++) {
            const item = pageItems[i];
            const q = QUALITY_BY_ID[item.quality];
            const btn = createButton(rows, {
                w: 620, h: 56, text: '',
                fontSize: 20,
                fill: this._isSelectedInv(item) ? T.rowActive : T.row,
                textColor: qualityTextColor(q, T.parchment),
                activeFill: T.rowActive,
                radius: 10,
                onTap: () => this._onRowTap(item.uid),
            });
            btn.node.setPosition(0, 150 - i * 60, 0);
            btn.node.name = `Row_${item.uid}`;
            const moved = item.modifier ? ' ◆' : '';
            btn.setText(`${itemDesc(item)}${moved}`);
            // 行首部位图标 + 品质色（N77）
            addGlyphNode(btn.node, `RowIcon_${item.uid}`, item.slot, 14,
                q ? q.color : T.parchmentDim, -286, 0, 55);
            btn.label.node.setPosition(18, 0);
            const rowUt = btn.label.node.getComponent(UITransform);
            if (rowUt) rowUt.setContentSize(620 - 46, 52);
        }
    }

    private _refreshDetail(): void {
        if (!this._detailTitle || !this._detailBody) return;
        const save = this._save;
        if (!save) return;
        const item = this._selectedItem();
        if (!item) {
            // 试玩 N63：点到空槽位时给明确反馈，别让玩家以为自己点空了
            const sel = this._sel;
            if (sel?.kind === 'slot') {
                if (this._emptyGlyph) this._emptyGlyph.active = false;
                this._detailTitle.node.setPosition(0, -300, 0);
                this._detailBody.node.setPosition(0, -352, 0);
                this._detailTitle.string = `${GEAR_SLOT_NAMES[sel.slot]} · 空槽位`;
                this._detailTitle.color = hex(T.parchmentDim);
                this._detailBody.string = '该槽位为空，可从背包选一件同槽位装备穿上。';
                this._setActions(false, false, false);
                return;
            }
            if (this._emptyGlyph) {
                this._emptyGlyph.active = true;
                this._emptyGlyph.setPosition(0, -330, 0);
            }
            this._detailTitle.node.setPosition(0, -392, 0);
            this._detailBody.node.setPosition(0, -440, 0);
            this._detailTitle.string = '点击上方装备槽或背包物品查看详情';
            this._detailTitle.color = hex(T.parchmentDim);
            this._detailBody.string = '打怪掉落的装备会进背包；点一件即可穿上或出售。';
            this._setActions(false, false, false);
            return;
        }
        if (this._emptyGlyph) this._emptyGlyph.active = false;
        this._detailTitle.node.setPosition(0, -282, 0);
        this._detailBody.node.setPosition(0, -398, 0);
        const q = QUALITY_BY_ID[item.quality];
        const base = GEAR_SLOT_NAMES[item.slot];
        this._detailTitle.string = `${itemName(item)}（${q ? q.name : ''} · ${base} · 装等 ${item.ilvl}）`;
        this._detailTitle.color = hex(qualityTextColor(q, T.parchment));

        const lines: string[] = [];
        for (const roll of item.affixes) {
            const def = AFFIX_BY_ID[roll.id as AffixId];
            if (!def) continue;
            lines.push(`${def.name} +${(affixValue(roll.id, roll.points) * 100).toFixed(1)}%（${roll.points} 点）`);
        }
        // 非主手基型共用掉落池（体验官 E6）：名字里的职业词只是美术主题，属性不分职业
        const wearNote = item.slot === 'mainHand' ? '' : ' · 任何职业可穿';
        lines.push(`耐力 +${staminaOf(item)}（生命 +${staminaOf(item) * STAMINA_HP_PER_POINT}）${wearNote}`);
        if (item.modifier) {
            const m = MODIFIER_BY_ID[item.modifier];
            if (m) lines.push(`改造「${m.name}」：${m.desc}`);
        }
        for (const line of qualitySpecialLines(item)) lines.push(line);
        // 试玩 N155：穿上装备后攻击强度可能不升反降 —— 攻击倍率按**平均装等**折算，
        // 往空槽塞一件低于平均的装备会把平均拉低。这不是算错，但玩家无从判断
        // 「到底变强没有」。背包件直接给换装前后的差值，并把折算口径写在同一屏。
        const isInv = this._sel?.kind === 'inv';
        if (isInv) {
            const nextEquips = { ...save.equips, [item.slot]: item };
            const stBefore = equipStats(save.equips);
            const stAfter = equipStats(nextEquips);
            const before = profileFromSave(save, this._floorIlvl);
            const after = profileFromSave({ ...save, equips: nextEquips }, this._floorIlvl);
            const arrow = (a: number, b: number, digits: number): string => {
                const diff = b - a;
                const eps = digits > 0 ? 0.05 : 0.5;
                if (Math.abs(diff) < eps) return '持平';
                return `${diff > 0 ? '↑' : '↓'}${Math.abs(diff).toFixed(digits)}`;
            };
            lines.push(`换装预览：攻击 ${before.attackPower.toFixed(1)} → ${after.attackPower.toFixed(1)}`
                + `（${arrow(before.attackPower, after.attackPower, 1)}）`
                + ` · 生命 ${Math.round(before.maxHp)} → ${Math.round(after.maxHp)}`
                + `（${arrow(before.maxHp, after.maxHp, 0)}）`);
            lines.push(`平均装等 ${stBefore.ilvl.toFixed(1)} → ${stAfter.ilvl.toFixed(1)}（攻击强度按平均装等折算）`);
        }
        this._detailBody.string = lines.join('\n');
        // 试玩 N162（round31）：判断「是否变强」的关键行只有 18px ≈ 9.8 CSS px。
        // 可用区是**标题下沿到板底**：标题中心 −282（高 30 ⇒ 下沿 −297），凹板底 −492，
        // 约 186 px。一开始按「板顶 −250」排会直接顶进标题里（复核截图 43）。
        // 行高按行数压，保证 n × lh ≤ 186；Label 按 n × lineHeight 估算高度，
        // 不用 UITransform.height —— 它要等渲染帧才更新，同步读到的是上一条文案的旧值。
        const n = lines.length;
        const lh = n <= 7 ? 26 : n === 8 ? 23 : 20;
        this._detailBody.fontSize = 20;
        this._detailBody.lineHeight = lh;
        // 正文块顶端固定在标题下沿 −305（留 8 px 呼吸），按实际文字高度反算中心
        this._detailBody.node.setPosition(0, -305 - (n * lh) / 2, 0);

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
                ? `槽 ${i + 1} · ${def.name}\n${TRINKET_TAG_NAMES[def.tag]}`
                : `槽 ${i + 1} · 空\n点下方饰品再「装备」`);
            btn.setColor(picked ? T.rowActive : T.row, def ? T.parchment : T.parchmentMuted);
            // 槽位图形：装上后按标签色画徽章，空槽留灰宝石
            const icon = this._tSlotIcons[i];
            const g = icon ? icon.getComponent(Graphics) : null;
            if (g) {
                g.clear();
                if (def) drawGlyphMedallion(g, 'trinket', 30, trinketAccent(def.tag));
                else drawMithrilGlyph(g, 'trinket', 24, T.parchmentMuted, 22);
            }
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
                width: 600, height: 40, color: T.parchmentDim, x: 0, y: 120,
            });
        }
        for (let i = 0; i < pageItems.length; i++) {
            const def = pageItems[i];
            const equippedAt = this._trinketSlotOf(def.id);
            const selected = this._sel?.kind === 'trinket' && this._sel.id === def.id;
            const btn = createButton(rows, {
                w: 620, h: 56, text: '',
                fontSize: 19,
                fill: selected ? T.rowActive : T.row,
                textColor: T.parchment,
                activeFill: T.rowActive,
                radius: 10,
                onTap: () => this._onTrinketRowTap(def.id),
            });
            btn.node.setPosition(0, 150 - i * 60, 0);
            btn.node.name = `TrinketRow_${def.id}`;
            const mark = equippedAt >= 0 ? `[已装备 ${equippedAt + 1}]` : '';
            btn.setText(`${def.name}（${TRINKET_TAG_NAMES[def.tag]}）${mark}`);
            // 行首徽章按标签色（N78）
            addGlyphNode(btn.node, `TrinketRowIcon_${def.id}`, 'trinket', 14,
                trinketAccent(def.tag), -286, 0, 55);
            btn.label.node.setPosition(18, 0);
            const tRowUt = btn.label.node.getComponent(UITransform);
            if (tRowUt) tRowUt.setContentSize(620 - 46, 52);
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
            this._tDetailTitle.color = hex(T.parchmentDim);
            this._tDetailBody.string = '饰品只改规则、不加固定数值：\n击败副本首领可以获得。';
            this._setTrinketActions(false, false);
            this._refreshSynergyFooter();
            return;
        }

        const at = this._trinketSlotOf(def.id);
        this._tDetailTitle.string = `${def.name}（${TRINKET_TAG_NAMES[def.tag]}）`;
        this._tDetailTitle.color = hex(T.parchment);
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
            this._tSynergyLabel.color = hex(T.warning);
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
        this._tSynergyLabel.color = hex(T.parchmentDim);
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
        label.color = hex(T.danger);
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
        this._prevBtn = null;
        this._nextBtn = null;
        this._detailTitle = null;
        this._detailBody = null;
        this._hintLabel = null;
        this._equipBtn = null;
        this._unequipBtn = null;
        this._sellBtn = null;
        this._emptyGlyph = null;
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
