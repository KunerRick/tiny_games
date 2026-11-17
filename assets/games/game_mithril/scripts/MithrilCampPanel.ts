/**
 * 《秘银远征》营地面板（M5）：5 设施页签 + 共用升级条。
 *
 * 设计依据（docs/plans/2026-11-14-game-mithril-design.md §4.6）：
 *  - 设施升级**只用材料**（金币留给重铸 / 附魔 / 料理 / 洗点，两条经济线不打架）
 *  - 铁匠铺：重铸（锁词条）/ 分解；附魔台：词条转移；训练场：洗点与天赋方案
 *  - 厨房：按场次生效的料理；军需官：仓库扩容与悬赏位
 *
 * 纪律（AGENTS 红线）：
 *  - 面板只做「数据 → 显示」的一次性刷新，不在 update 里逐帧重建；
 *  - 节点触摸 handler 一律具名（格子用节点名编码参数），按钮自身的 onTap 闭包是项目既有写法；
 *  - 面板挂在独立根节点上，打开时抬到最上层（同级不冒泡，AGENTS 教训 H）；
 *  - onDestroy 只清引用，不碰节点。
 */

import {
    _decorator, BlockInputEvents, Component, Graphics, Label, Node, UITransform,
} from 'cc';
import {
    COLOR, clearChildren, createButton, createLabel, hex,
} from '../../../common/ui/GameUIKit';
import type { UiButton } from '../../../common/ui/GameUIKit';
import {
    AFFIX_BY_ID, FACILITIES, FACILITY_BY_ID, FACILITY_MAX_LEVEL, GEAR_BASE_BY_ID, GEAR_SLOT_NAMES,
    KITCHEN_BONUS_LEVEL, KITCHEN_BONUS_MUL, MATERIALS, MEAL_BY_ID, QUALITY_BY_ID,
    TALENT_TREE_NAMES, TALENT_TREE_ORDER, materialName,
} from './MithrilConfig';
import type { EquipItem, FacilityId, MealStat } from './MithrilConfig';
import { affixValue, addToInventory, sellPrice, staminaOf } from './MithrilLoot';
import {
    activeMeals, availableMeals, bountySlots, buyMeal, canBuyMeal, canDismantle, canEnchant,
    canLoadTalentPreset, canReforge, canSaveTalentPreset, canUpgradeFacility, dismantle,
    dismantleYield, enchant, enchantMaterialCost, enchantMaxTransfer, enchantTargetCap,
    facilityDef, inventoryItems, loadTalentPreset, materialCount, maxReforgeLocks, mealMultipliers,
    ownedItems, reforge, reforgeGold, saveTalentPreset, storageBonus, upgradeFacility,
} from './MithrilCamp';
import type { OwnedItem } from './MithrilCamp';
import {
    BOUNTY_DAILY_REFRESH_LEVEL, BOUNTY_UNLOCK_LEVEL, BOUNTY_KIND_NAMES,
    bountyBoardRows, bountyItemIlvl, bountyToday, claimBounty,
} from './MithrilBounty';
import {
    facilityLevel, mealDurationFor, mealSlotsFor, respecTalents, respecVariants,
    talentPointsForLevel, talentPointsSpent, talentPresetSlots, talentRespecCost,
    variantRespecCost,
} from './MithrilProgress';
import type { MithrilSave } from './MithrilProgress';
import { mulberry32 } from './MithrilCore';
import { sfx } from './MithrilAudio';
import {
    FACILITY_ACCENT, addGlyphNode, drawGlyphMedallion, inkOnFill, repaintGlyphNode,
} from './MithrilArt';

const { ccclass } = _decorator;

const PANEL_W = 680;
const PANEL_H = 1180;

/** 页签一行：5 个 120 宽，间距 10 */
const TAB_Y = 446;
const TAB_W = 120;
const TAB_H = 46;
const TAB_X = [-260, -130, 0, 130, 260];

/** 内容区第一行标题的 y（面板中心为 0） */
const TOP = 336;

/** 操作按钮统一描边：禁用态填充 #1A2332 与面板底几乎同色，没有描边就只剩一行灰字（N75） */
const BTN_STROKE = '#3A4658';

/** 每页行数（铁匠铺装备列表 / 附魔源与目标） */
const SMITH_ROWS = 5;
const ENCHANT_ROWS = 4;

const MEAL_STAT_NAMES: Record<MealStat, string> = {
    ap: '攻击强度',
    hp: '生命上限',
    haste: '急速',
    crit: '暴击',
    vers: '全能',
};

/** 失败原因 → 人话（未列出的走兜底文案） */
const REASON_TEXT: Record<string, string> = {
    locked: '这处设施还没建造',
    'max-level': '已经满级了',
    'no-gold': '金币不足',
    'no-material': '材料不足',
    'bad-item': '先选一件装备',
    'bad-affix': '先选一条词条',
    'bad-target': '先选目标装备',
    'same-item': '源装备与目标不能是同一件',
    'no-affix': '这件装备没有词条',
    duplicate: '目标已有同名词条',
    'target-full': '目标装备的词条已满',
    'last-affix': '源装备至少要留 1 条词条',
    'too-many-locks': '锁定的词条太多了',
    'all-locked': '不能把所有词条都锁上',
    'no-slot': '槽位已满',
    tier: '这种料理需要厨房 Lv2',
    'empty-preset': '这个方案槽还空着',
    'no-points': '还没有投入天赋点',
};

@ccclass('MithrilCampPanel')
export class MithrilCampPanel extends Component {
    /** 关闭面板 */
    onClose: (() => void) | null = null;
    /** 存档被修改：主组件负责落盘、重算 profile、刷路线图 */
    onChanged: (() => void) | null = null;

    private _save: MithrilSave | null = null;
    private _tab: FacilityId = 'smith';

    // 铁匠铺
    private _selUid = '';
    private _locks: number[] = [];
    private _smPage = 0;

    // 附魔台
    private _srcUid = '';
    private _dstUid = '';
    private _picks: number[] = [];
    private _srcPage = 0;
    private _dstPage = 0;

    private _built = false;
    private _root: Node | null = null;
    private _panel: Node | null = null;
    private _content: Node | null = null;
    private _currencyLabel: Label | null = null;
    private _summaryLabel: Label | null = null;
    private _effectLabel: Label | null = null;
    private _upgradeBtn: UiButton | null = null;
    private _hintLabel: Label | null = null;
    private _tabBtns: Partial<Record<FacilityId, UiButton>> = {};
    /** 页签选中下划线：颜色二次信号（N76：不能只靠底色） */
    private _tabMarks: Partial<Record<FacilityId, Node>> = {};
    /** 页签图标节点：选中时底色=设施色，图标要换成对比墨色（N88） */
    private _tabIcons: Partial<Record<FacilityId, Node>> = {};
    /** 页头圆形徽记（随设施切换重画） */
    private _emblem: Node | null = null;
    /** 升级进度条（5 段，替代纯文字 Lv n/5） */
    private _levelBar: Node | null = null;

    /** 重铸随机数种子（每次点重铸换一个，页内不重复消耗同一串） */
    private _rngTick = 1;

    // ==================== 对外 ====================

    open(save: MithrilSave, notice = ''): void {
        this._save = save;
        this._tab = 'smith';
        this._selUid = '';
        this._locks = [];
        this._smPage = 0;
        this._srcUid = '';
        this._dstUid = '';
        this._picks = [];
        this._srcPage = 0;
        this._dstPage = 0;
        this._ensureBuilt();
        if (!this._root) return;
        this._root.active = true;
        this.refresh();
        // 打开时的外部提示（M8：每日刷新）只覆盖一次底部提示条
        if (notice && this._hintLabel) {
            this._hintLabel.string = notice;
            this._hintLabel.color = hex(COLOR.INFO);
        }
    }

    close(): void {
        if (this._root) this._root.active = false;
    }

    isOpen(): boolean {
        return !!(this._root && this._root.active);
    }

    /** 整页重建（升级 / 操作 / 切页签后调用；一次性成本，不在 update 里跑） */
    refresh(): void {
        const save = this._save;
        const content = this._content;
        if (!save || !content) return;
        for (const id of FACILITIES.map((f) => f.id)) {
            const btn = this._tabBtns[id];
            if (btn) btn.setActive(id === this._tab);
            const mark = this._tabMarks[id];
            if (mark && mark.isValid) mark.active = id === this._tab;
            this._paintTab(id, id === this._tab);
        }
        this._refreshFacilityArt(save);
        this._refreshHeader(save);
        if (this._hintLabel) {
            this._hintLabel.string = this._defaultHint(save);
            this._hintLabel.color = hex(COLOR.TEXT_SECONDARY);
        }
        clearChildren(content);
        switch (this._tab) {
            case 'smith': this._renderSmith(save); break;
            case 'enchant': this._renderEnchant(save); break;
            case 'training': this._renderTraining(save); break;
            case 'kitchen': this._renderKitchen(save); break;
            default: this._renderQuartermaster(save); break;
        }
    }

    // ==================== 骨架 ====================

    private _ensureBuilt(): void {
        if (this._built) return;
        this._built = true;

        const root = new Node('Camp');
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
        // 首次构建不显示：整棵树（含遮罩）一起关
        root.active = false;

        createLabel(panel, '营地', 34, {
            width: 300, height: 48, color: COLOR.TEXT_PRIMARY, bold: true, x: 0, y: 540,
        });
        const closeBtn = createButton(panel, {
            w: 116, h: 50, text: '返回', fontSize: 22,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 14, stroke: BTN_STROKE, onTap: () => this._onCloseTap(),
        });
        closeBtn.node.setPosition(272, 540, 0);

        this._currencyLabel = createLabel(panel, '', 17, {
            width: 640, height: 26, color: COLOR.WARNING, x: 0, y: 498, overflow: 'shrink',
        });

        for (let i = 0; i < FACILITIES.length; i++) {
            const def = FACILITIES[i];
            const accent = FACILITY_ACCENT[def.id] || COLOR.PRIMARY;
            const btn = createButton(panel, {
                w: TAB_W, h: TAB_H, text: def.name, fontSize: 17,
                fill: '#334155', textColor: COLOR.TEXT_PRIMARY,
                activeFill: accent, activeTextColor: '#FFFFFF',
                radius: 12, stroke: '#46536B', onTap: () => this._onTabTap(def.id),
            });
            btn.node.setPosition(TAB_X[i], TAB_Y, 0);
            // 页签图标（N75/N76）：文字左移，左边留出 22px 图标位
            btn.label.node.setPosition(13, 0);
            const labelUt = btn.label.node.getComponent(UITransform);
            if (labelUt) labelUt.setContentSize(TAB_W - 34, TAB_H - 4);
            this._tabIcons[def.id] = addGlyphNode(
                btn.node, `TabIcon_${def.id}`, def.id, 11, accent, -34, 0, 34,
            );
            // 选中态第二重信号：底部 3px 下划线
            const mark = new Node(`TabMark_${def.id}`);
            mark.layer = btn.node.layer;
            mark.addComponent(UITransform).setContentSize(TAB_W, TAB_H);
            const mg = mark.addComponent(Graphics);
            mg.fillColor = hex(accent, 255);
            mg.roundRect(-40, -TAB_H / 2 + 1, 80, 3, 1.5);
            mg.fill();
            btn.node.addChild(mark);
            mark.active = false;
            this._tabMarks[def.id] = mark;
            this._tabBtns[def.id] = btn;
        }

        // 页头徽记：设施一换就重画（见 _refreshFacilityArt）
        const emblem = new Node('FacilityEmblem');
        emblem.layer = this.node.layer;
        emblem.addComponent(UITransform).setContentSize(72, 72);
        emblem.setPosition(-292, 402, 0);
        emblem.addComponent(Graphics);
        panel.addChild(emblem);
        this._emblem = emblem;

        this._summaryLabel = createLabel(panel, '', 17, {
            width: 552, height: 26, color: COLOR.TEXT_PRIMARY, x: 34, y: 402,
            overflow: 'shrink', align: 'left',
        });
        this._effectLabel = createLabel(panel, '', 15, {
            width: 552, height: 42, color: COLOR.TEXT_SECONDARY, x: 34, y: 366,
            lineHeight: 20, overflow: 'shrink', align: 'left',
        });

        const content = new Node('Content');
        content.layer = this.node.layer;
        content.addComponent(UITransform).setContentSize(660, 700);
        panel.addChild(content);
        this._content = content;

        // 设施等级 5 段进度条（N75：原来只有一行 "Lv n/5" 文字）
        const levelBar = new Node('FacilityLevelBar');
        levelBar.layer = this.node.layer;
        levelBar.addComponent(UITransform).setContentSize(520, 18);
        levelBar.setPosition(0, -432, 0);
        levelBar.addComponent(Graphics);
        panel.addChild(levelBar);
        this._levelBar = levelBar;

        this._upgradeBtn = createButton(panel, {
            w: 340, h: 52, text: '升级', fontSize: 20,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 14, stroke: BTN_STROKE, onTap: () => this._onUpgradeTap(),
        });
        this._upgradeBtn.node.setPosition(0, -470, 0);

        this._hintLabel = createLabel(panel, '', 15, {
            width: 640, height: 44, color: COLOR.TEXT_SECONDARY, x: 0, y: -536, lineHeight: 20,
            overflow: 'shrink',
        });
    }

    // ==================== 页头 / 设施美术 ====================

    /** 页签图标 + 下划线换色（N88）：选中态底色就是设施色，同色图形会整块消失 */
    private _paintTab(id: FacilityId, active: boolean): void {
        const accent = FACILITY_ACCENT[id] || COLOR.PRIMARY;
        const ink = inkOnFill(accent);
        repaintGlyphNode(this._tabIcons[id] || null, id, 11, active ? ink : accent, active ? 70 : 34);
        const mark = this._tabMarks[id];
        if (!mark || !mark.isValid) return;
        const g = mark.getComponent(Graphics);
        if (!g) return;
        g.clear();
        g.fillColor = hex(active ? ink : accent, 255);
        g.roundRect(-40, -TAB_H / 2 + 1, 80, 3, 1.5);
        g.fill();
    }

    /** 页签切换时重画：徽记、水印、5 段等级条（都只在 refresh 里跑一次） */
    private _refreshFacilityArt(save: MithrilSave): void {
        const accent = FACILITY_ACCENT[this._tab] || COLOR.PRIMARY;
        const lv = facilityLevel(save, this._tab);

        if (this._emblem) {
            const g = this._emblem.getComponent(Graphics);
            if (g) {
                g.clear();
                drawGlyphMedallion(g, this._tab, 27, accent);
            }
        }

        if (this._levelBar) {
            const g = this._levelBar.getComponent(Graphics);
            if (g) {
                g.clear();
                const segW = 92;
                const gap = 10;
                const total = FACILITY_MAX_LEVEL * segW + (FACILITY_MAX_LEVEL - 1) * gap;
                let x = -total / 2;
                for (let i = 0; i < FACILITY_MAX_LEVEL; i++) {
                    g.fillColor = hex(i < lv ? accent : '#2E3A4D', i < lv ? 255 : 255);
                    g.roundRect(x, -5, segW, 10, 5);
                    g.fill();
                    x += segW + gap;
                }
                g.strokeColor = hex('#3A4658', 170);
                g.lineWidth = 1;
                g.roundRect(-total / 2 - 3, -8, total + 6, 16, 8);
                g.stroke();
            }
        }
    }

    // ==================== 头部与升级条 ====================

    private _refreshHeader(save: MithrilSave): void {
        const gold = Math.max(0, Math.floor(save.gold || 0));
        const mats = MATERIALS.map((m) => `${m.name} ${materialCount(save, m.id)}`).join(' · ');
        if (this._currencyLabel) this._currencyLabel.string = `金币 ${gold} · ${mats}`;

        const def = FACILITY_BY_ID[this._tab];
        const lv = facilityLevel(save, this._tab);
        if (this._summaryLabel) {
            this._summaryLabel.string = `${def.name} Lv${lv}/${FACILITY_MAX_LEVEL} · ${def.summary}`;
        }
        if (this._effectLabel) {
            const cur = lv > 0 ? def.effects[lv - 1] : '尚未建造（升到 1 级解锁）';
            const next = lv < FACILITY_MAX_LEVEL ? def.effects[lv] : null;
            this._effectLabel.string = next
                ? `当前：${cur}\n下一级：${next}`
                : `当前：${cur}\n已满级`;
        }

        const btn = this._upgradeBtn;
        if (!btn) return;
        const check = canUpgradeFacility(save, this._tab);
        if (check.level >= FACILITY_MAX_LEVEL) {
            btn.setText('已满级');
            btn.setColor('#1A2332', COLOR.TEXT_DISABLED);
            return;
        }
        const cost = check.cost;
        if (!cost) {
            btn.setText('无法升级');
            btn.setColor('#1A2332', COLOR.TEXT_DISABLED);
            return;
        }
        const have = materialCount(save, cost.materialId);
        // 材料不足时把「现有 / 所需」直接写在按钮上（体验官 E3：五个页签全是灰按钮，
        // 玩家看不出还要刷几场）
        btn.setText(have >= cost.count
            ? `升级到 Lv${check.nextLevel}（${materialName(cost.materialId)} ×${cost.count}）`
            : `升级到 Lv${check.nextLevel} · ${materialName(cost.materialId)} ${have}/${cost.count}`);
        btn.setColor(check.ok ? '#1D4ED8' : '#334155',
            check.ok ? '#FFFFFF' : (have > 0 ? COLOR.TEXT_SECONDARY : COLOR.TEXT_DISABLED));
    }

    // ==================== 铁匠铺 ====================

    private _renderSmith(save: MithrilSave): void {
        const content = this._content!;
        const lv = facilityLevel(save, 'smith');
        // 未建造时两个按钮都直接标出门槛（试玩 N52：别让玩家先选装备才发现用不了）
        const gate = lv <= 0;
        const list = ownedItems(save);
        const pages = Math.max(1, Math.ceil(list.length / SMITH_ROWS));
        if (this._smPage >= pages) this._smPage = pages - 1;
        if (this._smPage < 0) this._smPage = 0;

        const exists = list.some((e) => e.uid === this._selUid);
        if (!exists) {
            this._selUid = list.length > 0 ? list[0].uid : '';
            this._locks = [];
        }

        createLabel(content, '装备（含身上）', 16, {
            width: 320, height: 24, color: COLOR.TEXT_SECONDARY, bold: true, x: -150, y: TOP,
        });

        const start = this._smPage * SMITH_ROWS;
        const pageItems = list.slice(start, start + SMITH_ROWS);
        if (pageItems.length === 0) {
            createLabel(content, '还没有装备 —— 野外节点与副本会掉落', 16, {
                width: 320, height: 40, color: COLOR.TEXT_SECONDARY, x: -150, y: TOP - 60,
            });
        }
        for (let i = 0; i < pageItems.length; i++) {
            const entry = pageItems[i];
            const q = QUALITY_BY_ID[entry.item.quality];
            const btn = createButton(content, {
                w: 320, h: 50, text: '', fontSize: 15,
                fill: entry.uid === this._selUid ? '#1E3A5F' : '#1E293B',
                textColor: q ? q.color : COLOR.TEXT_PRIMARY,
                activeFill: '#1E3A5F',
                radius: 10, stroke: BTN_STROKE, onTap: () => this._onSelectItem(entry.uid),
            });
            btn.node.setPosition(-150, TOP - 46 - i * 62, 0);
            btn.setText(`${q ? q.name : ''}·${itemName(entry.item)} · ${entry.item.ilvl}${entry.equipped ? '（穿）' : ''}`);
            // 部位图标（N75：列表条目不能只有文字）+ 品质色描边环
            addGlyphNode(btn.node, `ItemIcon_${entry.uid}`, entry.item.slot, 13, q ? q.color : COLOR.TEXT_SECONDARY, -140, 0, 55);
            const rowLabelUt = btn.label.node.getComponent(UITransform);
            if (rowLabelUt) rowLabelUt.setContentSize(320 - 46, 50 - 4);
            btn.label.node.setPosition(12, 0);
        }
        if (pages > 1) {
            this._pager(content, -150, TOP - 46 - SMITH_ROWS * 62, this._smPage, pages,
                () => this._turnPage('sm', -1), () => this._turnPage('sm', 1));
        }

        // 右侧：选中装备的词条（点一行切换锁定）
        const sel = this._selectedOwned(save);
        createLabel(content, '词条（点一行切换锁定）', 16, {
            width: 270, height: 24, color: COLOR.TEXT_SECONDARY, bold: true, x: 190, y: TOP,
        });
        if (!sel) {
            createLabel(content, '左边选一件装备', 16, {
                width: 270, height: 40, color: COLOR.TEXT_DISABLED, x: 190, y: TOP - 60,
            });
        } else {
            const rolls = sel.item.affixes;
            const maxLocks = maxReforgeLocks(save);
            for (let i = 0; i < rolls.length; i++) {
                const def = AFFIX_BY_ID[rolls[i].id];
                const locked = this._locks.indexOf(i) >= 0;
                const btn = createButton(content, {
                    w: 270, h: 46, text: '', fontSize: 15,
                    fill: locked ? '#3B2A0B' : '#1E293B',
                    textColor: locked ? COLOR.WARNING : COLOR.TEXT_PRIMARY,
                    activeFill: '#3B2A0B',
                    radius: 10, stroke: BTN_STROKE, onTap: () => this._onToggleLock(i),
                });
                btn.node.setPosition(190, TOP - 46 - i * 52, 0);
                const name = def ? def.name : rolls[i].id;
                btn.setText(`${locked ? '锁 ' : ''}${name} +${(affixValue(rolls[i].id, rolls[i].points) * 100).toFixed(1)}%（${rolls[i].points} 点）`);
            }
            const info = [
                lv >= 2 ? `可锁 ${maxLocks} 条 · 已锁 ${this._locks.length}` : '升到 Lv2 才能锁定词条',
                `重铸费用 ${reforgeGold(save, sel.item, this._locks.length)} 金`,
                `耐力 +${staminaOf(sel.item)}`,
            ].join('\n');
            createLabel(content, info, 15, {
                width: 270, height: 70, color: COLOR.TEXT_SECONDARY, x: 190,
                y: TOP - 46 - rolls.length * 52 - 22, lineHeight: 21,
            });
        }

        const canForge = sel ? canReforge(save, sel.item, this._locks) : null;
        const forge = createButton(content, {
            w: 200, h: 50,
            text: gate ? '重铸（需铁匠铺 Lv1）' : (sel ? `重铸 ${reforgeGold(save, sel.item, this._locks.length)} 金` : '重铸'),
            fontSize: gate ? 15 : 18,
            fill: gate ? '#1A2332' : (canForge && canForge.ok ? '#B45309' : '#334155'),
            textColor: gate ? COLOR.TEXT_DISABLED : (canForge && canForge.ok ? '#FFFFFF' : COLOR.TEXT_SECONDARY),
            activeFill: '#92400E',
            radius: 12, stroke: BTN_STROKE, onTap: () => this._onReforgeTap(),
        });
        forge.node.setPosition(-70, -140, 0);

        const yieldInfo = sel && !sel.equipped ? dismantleYield(sel.item) : null;
        const dismantleBtn = createButton(content, {
            w: 200, h: 50,
            text: gate
                ? '分解（需铁匠铺 Lv1）'
                : (yieldInfo
                    ? `分解 +${yieldInfo.count} ${materialName(yieldInfo.materialId)}`
                    : (sel && sel.equipped ? '已装备·不能拆' : '分解')),
            fontSize: gate ? 15 : 17,
            fill: gate ? '#1A2332' : (yieldInfo ? '#334155' : '#1A2332'),
            textColor: gate ? COLOR.TEXT_DISABLED : (yieldInfo ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED),
            activeFill: '#475569',
            radius: 12, stroke: BTN_STROKE, onTap: () => this._onDismantleTap(),
        });
        dismantleBtn.node.setPosition(150, -140, 0);

        createLabel(content, [
            gate ? '铁匠铺还没建造：升到 Lv1 就能重铸与分解背包里的装备。' : '',
            '重铸：金币重掷**未锁定**的词条，点数与装等不变；每锁一条费用 +40%。',
            '分解：背包里的装备按装等换成材料；身上穿着的不能拆（先脱下）。',
        ].filter((line) => !!line).join('\n'), 15, {
            width: 620, height: 72, color: COLOR.TEXT_SECONDARY, x: 0, y: -230, lineHeight: 22,
        });
    }

    // ==================== 附魔台 ====================

    private _renderEnchant(save: MithrilSave): void {
        const content = this._content!;
        const srcList = inventoryItems(save);
        const dstList = ownedItems(save);
        this._srcPage = clampPage(this._srcPage, srcList.length, ENCHANT_ROWS);
        this._dstPage = clampPage(this._dstPage, dstList.length, ENCHANT_ROWS);

        if (!srcList.some((e) => e.uid === this._srcUid)) {
            this._srcUid = srcList.length > 0 ? srcList[0].uid : '';
            this._picks = [];
        }
        if (!dstList.some((e) => e.uid === this._dstUid)) this._dstUid = '';
        const srcEntry = srcList.find((e) => e.uid === this._srcUid) || null;
        const srcRolls = srcEntry ? srcEntry.item.affixes : [];
        this._picks = this._picks.filter((i) => i >= 0 && i < srcRolls.length);

        const maxTransfer = enchantMaxTransfer(save);

        // 左：源（只从背包里挑）
        createLabel(content, '源（背包）', 16, {
            width: 190, height: 24, color: COLOR.TEXT_SECONDARY, bold: true, x: -215, y: TOP,
        });
        this._renderPickList(content, -215, srcList, this._srcPage, this._srcUid, 'src');
        if (srcList.length === 0) {
            createLabel(content, '背包里没有装备', 15, {
                width: 190, height: 40, color: COLOR.TEXT_DISABLED, x: -215, y: TOP - 60,
            });
        }

        // 中：源装备的词条，点一下选 / 取消
        createLabel(content, `转移词条 ${this._picks.length}/${maxTransfer}`, 16, {
            width: 174, height: 24, color: COLOR.TEXT_SECONDARY, bold: true, x: 0, y: TOP,
        });
        if (srcRolls.length === 0) {
            createLabel(content, '先选一件源装备', 15, {
                width: 174, height: 40, color: COLOR.TEXT_DISABLED, x: 0, y: TOP - 60,
            });
        }
        for (let i = 0; i < srcRolls.length; i++) {
            const def = AFFIX_BY_ID[srcRolls[i].id];
            const picked = this._picks.indexOf(i) >= 0;
            const btn = createButton(content, {
                w: 174, h: 42, text: '', fontSize: 14,
                fill: picked ? '#1D4ED8' : '#1E293B',
                textColor: picked ? '#FFFFFF' : COLOR.TEXT_PRIMARY,
                activeFill: '#1D4ED8',
                radius: 9, stroke: BTN_STROKE, onTap: () => this._onPickTap(i),
            });
            btn.node.setPosition(0, TOP - 46 - i * 48, 0);
            btn.setText(`${picked ? '[已选] ' : ''}${def ? def.name : srcRolls[i].id} ${srcRolls[i].points} 点`);
        }

        // 右：目标（身上 + 背包）
        createLabel(content, '目标', 16, {
            width: 190, height: 24, color: COLOR.TEXT_SECONDARY, bold: true, x: 215, y: TOP,
        });
        this._renderPickList(content, 215, dstList, this._dstPage, this._dstUid, 'dst');

        // 费用与按钮
        const dstEntry = this._dstUid ? dstList.find((e) => e.uid === this._dstUid) || null : null;
        const costLines: string[] = [];
        if (dstEntry) {
            const matId = dstEntry.item.ilvl < 15 ? 'ash_dust' : (dstEntry.item.ilvl < 30 ? 'frost_crystal' : 'mithril_ore');
            costLines.push(`费用：${80} 金 + ${materialName(matId)} ×${enchantMaterialCost(save)}（目标装等 ${dstEntry.item.ilvl}）`);
            costLines.push(`目标词条 ${dstEntry.item.affixes.length}/${enchantTargetCap(save, dstEntry.item)} · ${srcEntry && srcEntry.uid === dstEntry.uid ? '不能选源装备自己' : '确认后立刻生效'}`);
        } else {
            costLines.push('选好源装备的一到两条词条，再点右边的目标装备');
            costLines.push(`费用：80 金 + 材料 ×${enchantMaterialCost(save)}`);
        }
        createLabel(content, costLines.join('\n'), 15, {
            width: 620, height: 46, color: COLOR.TEXT_SECONDARY, x: 0, y: -50, lineHeight: 22,
        });

        const check = srcEntry && dstEntry
            ? canEnchant(save, srcEntry.uid, this._picks, dstEntry.uid)
            : null;
        const ok = !!(check && check.ok);
        const cast = createButton(content, {
            w: 240, h: 52, text: '附魔', fontSize: 20,
            fill: ok ? '#1D4ED8' : '#334155',
            textColor: ok ? '#FFFFFF' : COLOR.TEXT_SECONDARY,
            activeFill: '#1E40AF',
            radius: 14, stroke: BTN_STROKE, onTap: () => this._onEnchantTap(),
        });
        cast.node.setPosition(0, -120, 0);

        createLabel(content, [
            `Lv1：转移 1 条 · 源装备被消耗　　Lv2：一次 2 条`,
            `Lv3：保留源装备　　Lv4：材料减半　　Lv5：目标无视品质条数（最多 4 条）`,
            '词条点数跟着词条走：低点数的词条转过去仍然只是低点数。',
        ].join('\n'), 15, {
            width: 620, height: 76, color: COLOR.TEXT_SECONDARY, x: 0, y: -215, lineHeight: 23,
        });
    }

    /** 一列装备列表（附魔台源 / 目标共用） */
    private _renderPickList(
        parent: Node,
        x: number,
        list: OwnedItem[],
        page: number,
        selectedUid: string,
        kind: 'src' | 'dst',
    ): void {
        const pages = Math.max(1, Math.ceil(list.length / ENCHANT_ROWS));
        const start = page * ENCHANT_ROWS;
        const items = list.slice(start, start + ENCHANT_ROWS);
        for (let i = 0; i < items.length; i++) {
            const entry = items[i];
            const q = QUALITY_BY_ID[entry.item.quality];
            const btn = createButton(parent, {
                w: 190, h: 46, text: '', fontSize: 14,
                fill: entry.uid === selectedUid ? '#1E3A5F' : '#1E293B',
                textColor: q ? q.color : COLOR.TEXT_PRIMARY,
                activeFill: '#1E3A5F',
                radius: 9,
                onTap: () => (kind === 'src' ? this._onSelectSrc(entry.uid) : this._onSelectDst(entry.uid)),
            });
            btn.node.setPosition(x, TOP - 46 - i * 56, 0);
            btn.setText(`${q ? q.name : ''}·${itemName(entry.item)} ${entry.item.ilvl}${entry.equipped ? '（穿）' : ''}`);
            addGlyphNode(btn.node, `PickIcon_${kind}_${entry.uid}`, entry.item.slot, 10, q ? q.color : COLOR.TEXT_SECONDARY, -78, 0, 55);
            const pickUt = btn.label.node.getComponent(UITransform);
            if (pickUt) pickUt.setContentSize(190 - 34, 46 - 4);
            btn.label.node.setPosition(10, 0);
        }
        if (pages > 1) {
            this._pager(parent, x, TOP - 46 - ENCHANT_ROWS * 56, page, pages,
                () => this._turnPage(kind, -1), () => this._turnPage(kind, 1));
        }
    }

    // ==================== 训练场 ====================

    private _renderTraining(save: MithrilSave): void {
        const content = this._content!;
        const spent = talentPointsSpent(save.talents);
        const total = talentPointsForLevel(save.level);
        createLabel(content, `天赋点：已投 ${spent}/${total} · 金币 ${Math.max(0, Math.floor(save.gold || 0))}`, 17, {
            width: 620, height: 26, color: COLOR.TEXT_PRIMARY, x: 0, y: 326,
        });

        const talentCost = talentRespecCost(save);
        const variantCost = variantRespecCost(save);
        const unlocked = facilityLevel(save, 'training') > 0;
        const respecT = createButton(content, {
            w: 260, h: 50,
            text: !unlocked ? '洗点天赋（需训练场 Lv1）'
                : (talentCost > 0 ? `洗点天赋 ${talentCost} 金` : '洗点天赋（免费）'),
            fontSize: 18,
            fill: unlocked ? '#334155' : '#1A2332',
            textColor: unlocked ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED,
            activeFill: '#475569',
            radius: 12, stroke: BTN_STROKE, onTap: () => this._onRespecTalents(),
        });
        respecT.node.setPosition(-150, 268, 0);
        const respecV = createButton(content, {
            w: 260, h: 50,
            text: !unlocked ? '重置变体（需训练场 Lv1）'
                : (variantCost > 0 ? `重置变体 ${variantCost} 金` : '重置变体（免费）'),
            fontSize: 18,
            fill: unlocked ? '#334155' : '#1A2332',
            textColor: unlocked ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED,
            activeFill: '#475569',
            radius: 12, stroke: BTN_STROKE, onTap: () => this._onRespecVariants(),
        });
        respecV.node.setPosition(150, 268, 0);

        const slots = talentPresetSlots(save);
        createLabel(content, `天赋方案（${slots} 个槽）`, 17, {
            width: 620, height: 26, color: COLOR.TEXT_PRIMARY, bold: true, x: 0, y: 196,
        });
        for (let slot = 0; slot < 2; slot++) {
            const y = 150 - slot * 62;
            const preset = save.talentPresets ? save.talentPresets[slot] : null;
            const text = slot >= slots
                ? `方案 ${slotLabel(slot)}：训练场 Lv${slot === 0 ? 4 : 5} 解锁`
                : (preset && Object.keys(preset).length > 0
                    ? `方案 ${slotLabel(slot)}：${presetSummary(preset, save)}`
                    : `方案 ${slotLabel(slot)}：空`);
            createLabel(content, text, 15, {
                width: 370, height: 44, color: slot >= slots ? COLOR.TEXT_DISABLED : COLOR.TEXT_SECONDARY,
                align: 'left', x: -120, y, lineHeight: 21, overflow: 'shrink',
            });
            const canSave = canSaveTalentPreset(save, slot);
            const saveBtn = createButton(content, {
                w: 104, h: 42, text: '存入', fontSize: 16,
                fill: canSave.ok ? '#334155' : '#1A2332',
                textColor: canSave.ok ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED,
                activeFill: '#475569',
                radius: 10, stroke: BTN_STROKE, onTap: () => this._onSavePreset(slot),
            });
            saveBtn.node.setPosition(158, y, 0);
            const canLoad = canLoadTalentPreset(save, slot);
            const loadBtn = createButton(content, {
                w: 104, h: 42, text: '载入', fontSize: 16,
                fill: canLoad.ok ? '#1D4ED8' : '#1A2332',
                textColor: canLoad.ok ? '#FFFFFF' : COLOR.TEXT_DISABLED,
                activeFill: '#1E40AF',
                radius: 10, stroke: BTN_STROKE, onTap: () => this._onLoadPreset(slot),
            });
            loadBtn.node.setPosition(268, y, 0);
        }

        createLabel(content, [
            '训练场等级效果：',
            'Lv1 解锁洗点　　Lv2 洗点半价　　Lv3 洗点免费',
            'Lv4 解锁方案 A　　Lv5 解锁方案 B',
            '「存入」把当前天赋抄进方案槽（免费）；「载入」用方案覆盖当前天赋，点数总量不变。',
        ].join('\n'), 15, {
            width: 620, height: 100, color: COLOR.TEXT_SECONDARY, x: 0, y: -40, lineHeight: 24,
        });
    }

    // ==================== 厨房 ====================

    private _renderKitchen(save: MithrilSave): void {
        const content = this._content!;
        const lv = facilityLevel(save, 'kitchen');
        const active = activeMeals(save);
        const activeText = active.length > 0
            ? `生效中：${active.map((m) => `${m.def.name}（剩 ${m.runsLeft} 场）`).join(' · ')}`
            : '生效中：没有料理（每场战斗都从满血打）';
        createLabel(content, activeText, 16, {
            width: 620, height: 26, color: active.length > 0 ? COLOR.SUCCESS : COLOR.TEXT_SECONDARY,
            x: 0, y: 326, overflow: 'shrink',
        });

        const meals = availableMeals(save);
        if (meals.length === 0) {
            createLabel(content, '厨房还没建造：升到 1 级解锁 3 种料理', 17, {
                width: 620, height: 40, color: COLOR.TEXT_SECONDARY, x: 0, y: 240,
            });
        }
        for (let i = 0; i < meals.length; i++) {
            const meal = meals[i];
            const y = 276 - i * 62;
            const def = MEAL_BY_ID[meal.id];
            if (!def) continue;
            const bonus = lv >= KITCHEN_BONUS_LEVEL ? `（×${KITCHEN_BONUS_MUL}）` : '';
            createLabel(content,
                `${def.name}　${MEAL_STAT_NAMES[def.stat]} +${(def.pct * 100).toFixed(0)}%${bonus}\n`
                + `${def.gold} 金 + ${materialName(def.materialId)} ×${def.materialCount} · 持续 ${mealDurationFor(save)} 场`,
                15, {
                    width: 380, height: 48, color: COLOR.TEXT_SECONDARY, align: 'left',
                    x: -110, y, lineHeight: 23, overflow: 'shrink',
                });
            const check = canBuyMeal(save, meal.id);
            const bought = active.some((m) => m.def.id === meal.id);
            const label = bought ? '已生效' : (check.ok ? '购买' : (check.reason === 'tier' ? '需要 Lv2' : (check.reason === 'no-slot' ? '槽位已满' : '买不起')));
            const buyBtn = createButton(content, {
                w: 120, h: 46, text: label, fontSize: 16,
                fill: check.ok ? '#15803D' : '#1A2332',
                textColor: check.ok ? '#FFFFFF' : COLOR.TEXT_DISABLED,
                activeFill: '#166534',
                radius: 10, stroke: BTN_STROKE, onTap: () => this._onBuyMeal(meal.id),
            });
            buyBtn.node.setPosition(258, y, 0);
        }

        const mul = mealMultipliers(save);
        const parts: string[] = [];
        if (mul.ap > 0) parts.push(`攻击强度 +${(mul.ap * 100).toFixed(1)}%`);
        if (mul.hp > 0) parts.push(`生命上限 +${(mul.hp * 100).toFixed(1)}%`);
        if (mul.crit > 0) parts.push(`暴击 +${(mul.crit * 100).toFixed(1)}%`);
        if (mul.haste > 0) parts.push(`急速 +${(mul.haste * 100).toFixed(1)}%`);
        if (mul.vers > 0) parts.push(`全能 +${(mul.vers * 100).toFixed(1)}%`);
        createLabel(content, parts.length > 0 ? `下一场加成：${parts.join(' · ')}` : '下一场加成：无', 15, {
            width: 620, height: 26, color: parts.length > 0 ? COLOR.INFO : COLOR.TEXT_DISABLED,
            x: 0, y: -50, overflow: 'shrink',
        });
        createLabel(content, [
            `料理在「打完一场战斗」时扣 1 场（本场仍吃到效果）。`,
            `厨房 Lv3 起可同时生效 2 种；Lv4 效果 ×${KITCHEN_BONUS_MUL}；Lv5 每份持续 3 场。`,
            `当前槽位 ${mealSlotsFor(save)} 个 · 每份持续 ${mealDurationFor(save)} 场。`,
        ].join('\n'), 15, {
            width: 620, height: 76, color: COLOR.TEXT_SECONDARY, x: 0, y: -130, lineHeight: 23,
        });
    }

    // ==================== 军需官 ====================

    private _renderQuartermaster(save: MithrilSave): void {
        const content = this._content!;
        const lv = facilityLevel(save, 'quartermaster');
        const bonus = storageBonus(save);
        const cap = 60 + bonus;
        const used = Array.isArray(save.inventory) ? save.inventory.length : 0;
        const slots = bountySlots(save);
        const mats = MATERIALS
            .map((m) => `${m.name} ${materialCount(save, m.id)}`)
            .join('    ');

        createLabel(content, [
            `装备仓库　${used} / ${cap} 格（基础 60 + 军需官 ${bonus}）`,
            `库存材料　${mats}`,
        ].join('\n'), 17, {
            width: 620, height: 56, color: COLOR.TEXT_SECONDARY, x: 0, y: 316,
            lineHeight: 28, overflow: 'shrink',
        });

        if (lv < BOUNTY_UNLOCK_LEVEL) {
            createLabel(content, [
                '悬赏板：还没建造',
                '升到军需官 Lv1 解锁悬赏板：Lv1 3 条 → Lv2 起 6 条 → Lv4 每日刷新。',
                `下一级：${lv < FACILITY_MAX_LEVEL ? FACILITY_BY_ID.quartermaster.effects[lv] : '已满级'}`,
                '仓库满时：战斗掉落的装备会折算成金币（不会白打）。',
            ].join('\n'), 16, {
                width: 620, height: 120, color: COLOR.TEXT_SECONDARY, x: 0, y: 190, lineHeight: 28,
            });
            return;
        }

        // ---- 悬赏板（M8）：自动追踪，完成即可领取 ----
        const rows = bountyBoardRows(save);
        createLabel(content,
            `悬赏板　${rows.length}/${slots} 条 · 自动追踪，完成即可领取 · `
            + (lv >= BOUNTY_DAILY_REFRESH_LEVEL ? '每日刷新已开启' : 'Lv4 起每日刷新'),
            16, {
                width: 620, height: 28, color: COLOR.TEXT_PRIMARY, x: 0, y: 252, overflow: 'shrink',
            });

        const rowYs = [206, 134, 62, -10, -82, -154];
        for (let i = 0; i < rows.length && i < rowYs.length; i++) {
            const row = rows[i];
            const y = rowYs[i];
            const kind = BOUNTY_KIND_NAMES[row.def.kind] || '';
            createLabel(content,
                `【${kind}】${row.name}\n进度 ${row.progressText} · 奖励 ${row.def.reward}`,
                15, {
                    width: 400, height: 52,
                    color: row.ready ? COLOR.SUCCESS : COLOR.TEXT_SECONDARY,
                    align: 'left', x: -105, y, lineHeight: 22, overflow: 'shrink',
                });
            const btn = createButton(content, {
                w: 120, h: 46, text: row.ready ? '领取' : '未完成', fontSize: 16,
                fill: row.ready ? '#15803D' : '#1A2332',
                textColor: row.ready ? '#FFFFFF' : COLOR.TEXT_DISABLED,
                activeFill: '#166534', radius: 10,
                onTap: () => this._onBountyClaim(row.def.id),
            });
            btn.node.setPosition(250, y, 0);
        }
        if (rows.length === 0) {
            createLabel(content, '悬赏板空着：下一次战斗结算后会补上新悬赏。', 16, {
                width: 620, height: 30, color: COLOR.TEXT_SECONDARY, x: 0, y: 190,
            });
        }

        createLabel(content, [
            '收集类悬赏按当前库存判定，领取时扣除（只扣背包，不动已装备）。',
            `下一级：${lv < FACILITY_MAX_LEVEL ? FACILITY_BY_ID.quartermaster.effects[lv] : '已满级'}`,
        ].join('\n'), 15, {
            width: 620, height: 50, color: COLOR.TEXT_SECONDARY, x: 0, y: -240, lineHeight: 22,
        });
    }

    /** 领取悬赏：扣收集物 → 发金币 / 材料 / 装备 → 补位 */
    private _onBountyClaim(id: string): void {
        const save = this._save;
        if (!save) return;
        const lv = facilityLevel(save, 'quartermaster');
        const rng = mulberry32((this._rngTick++ * 2654435761) >>> 0);
        const res = claimBounty(save, id, rng, bountyItemIlvl(save.level), {
            day: bountyToday(Date.now()),
            slots: bountySlots(save),
            allowDaily: lv >= BOUNTY_DAILY_REFRESH_LEVEL,
        });
        if (!res.ok) {
            const text = res.reason === 'insufficient' ? '收集物不够：先攒够再交'
                : res.reason === 'not-ready' ? '还没完成这条悬赏'
                    : '这条悬赏已经不在板上';
            this._notice(text);
            return;
        }
        const lines = [`悬赏完成：金币 +${res.gold}`];
        sfx.play('coin');
        if (res.consumeText) lines.push(`交付 ${res.consumeText}`);
        if (res.materialId && res.materialCount > 0) {
            lines.push(`${materialName(res.materialId)} +${res.materialCount}`);
        }
        if (res.item) {
            const base = GEAR_BASE_BY_ID[res.item.baseId];
            const q = QUALITY_BY_ID[res.item.quality];
            const label = `${q ? q.name : ''}·${base ? base.name : res.item.baseId}`
                + `（${GEAR_SLOT_NAMES[res.item.slot]} ${res.item.ilvl}）`;
            if (addToInventory(save, res.item)) {
                lines.push(`获得装备：${label}`);
            } else {
                const gold = sellPrice(res.item);
                save.gold = Math.max(0, Math.floor(save.gold || 0) + gold);
                lines.push(`背包已满：${label} 折算 ${gold} 金币`);
            }
        }
        this._changed(lines.join(' · '));
    }

    // ==================== 触摸 handler（具名） ====================

    private _onTabTap(id: FacilityId): void {
        if (this._tab === id) return;
        this._tab = id;
        this.refresh();
    }

    private _onSelectItem(uid: string): void {
        if (this._selUid === uid) return;
        this._selUid = uid;
        this._locks = [];
        this.refresh();
    }

    private _onToggleLock(index: number): void {
        const save = this._save;
        const sel = save ? this._selectedOwned(save) : null;
        if (!save || !sel) return;
        if (facilityLevel(save, 'smith') < 2) {
            this._notice('升到铁匠铺 Lv2 才能锁定词条');
            return;
        }
        const at = this._locks.indexOf(index);
        if (at >= 0) {
            this._locks.splice(at, 1);
        } else if (this._locks.length >= maxReforgeLocks(save)) {
            this._notice(`最多锁 ${maxReforgeLocks(save)} 条词条`);
            return;
        } else if (this._locks.length + 1 >= sel.item.affixes.length) {
            this._notice('至少留一条词条参与重铸');
            return;
        } else {
            this._locks.push(index);
        }
        this.refresh();
    }

    private _onReforgeTap(): void {
        const save = this._save;
        if (!save) return;
        if (facilityLevel(save, 'smith') <= 0) {
            this._notice('铁匠铺还没建造：把它升到 Lv1 才能重铸');
            return;
        }
        const sel = this._selectedOwned(save);
        if (!sel) {
            this._notice('先选一件装备');
            return;
        }
        const check = canReforge(save, sel.item, this._locks);
        if (!check.ok) {
            this._notice(`${REASON_TEXT[check.reason] || '无法重铸'}：需要 ${reforgeGold(save, sel.item, this._locks.length)} 金，现有 ${Math.max(0, Math.floor(save.gold || 0))}`);
            return;
        }
        this._rngTick = (this._rngTick * 1103515245 + 12345) & 0x7fffffff;
        const rng = mulberry32((Date.now() ^ this._rngTick) >>> 0);
        const res = reforge(save, sel.item, this._locks, rng);
        if (!res.ok) {
            this._notice(REASON_TEXT[res.reason] || '重铸失败');
            return;
        }
        const shown = res.changed
            .map((c) => `${AFFIX_BY_ID[c.from] ? AFFIX_BY_ID[c.from].name : c.from}→${AFFIX_BY_ID[c.to] ? AFFIX_BY_ID[c.to].name : c.to}`)
            .join('、');
        this._changed(`重铸完成：${shown}（点数不变）`);
    }

    private _onDismantleTap(): void {
        const save = this._save;
        if (!save) return;
        if (facilityLevel(save, 'smith') <= 0) {
            this._notice('铁匠铺还没建造：把它升到 Lv1 才能分解装备');
            return;
        }
        const sel = this._selectedOwned(save);
        if (!sel) {
            this._notice('先选一件装备');
            return;
        }
        const check = canDismantle(save, sel.uid);
        if (!check.ok || !check.yield) {
            this._notice(sel.equipped ? '身上穿着的不能拆：先脱到背包里' : (REASON_TEXT[check.reason] || '无法分解'));
            return;
        }
        const got = dismantle(save, sel.uid);
        if (!got) {
            this._notice('分解失败');
            return;
        }
        this._selUid = '';
        this._locks = [];
        this._changed(`分解完成：${materialName(got.materialId)} +${got.count}`);
    }

    private _onSelectSrc(uid: string): void {
        if (this._srcUid === uid) return;
        this._srcUid = uid;
        this._picks = [];
        this.refresh();
    }

    private _onSelectDst(uid: string): void {
        if (this._dstUid === uid) return;
        this._dstUid = uid;
        this.refresh();
    }

    private _onPickTap(index: number): void {
        const save = this._save;
        if (!save) return;
        const at = this._picks.indexOf(index);
        if (at >= 0) {
            this._picks.splice(at, 1);
            this.refresh();
            return;
        }
        if (this._picks.length >= enchantMaxTransfer(save)) {
            this._notice(`附魔台 Lv${facilityLevel(save, 'enchant') >= 2 ? '2' : '1'} 一次最多转移 ${enchantMaxTransfer(save)} 条`);
            return;
        }
        this._picks.push(index);
        this._picks.sort((a, b) => a - b);
        this.refresh();
    }

    private _onEnchantTap(): void {
        const save = this._save;
        if (!save) return;
        if (!this._srcUid) {
            this._notice('先选源装备（背包里的）');
            return;
        }
        if (!this._dstUid) {
            this._notice('再选目标装备');
            return;
        }
        if (this._picks.length === 0) {
            this._notice('先点要转移的词条');
            return;
        }
        const check = canEnchant(save, this._srcUid, this._picks, this._dstUid);
        if (!check.ok) {
            this._notice(REASON_TEXT[check.reason] || '无法附魔');
            return;
        }
        const owner = ownedItems(save);
        const srcEntry = owner.find((e) => e.uid === this._srcUid) || null;
        const dstEntry = owner.find((e) => e.uid === this._dstUid) || null;
        const movedNames = srcEntry
            ? this._picks
                .map((i) => srcEntry.item.affixes[i])
                .filter((r) => !!r && !!AFFIX_BY_ID[r.id])
                .map((r) => AFFIX_BY_ID[r.id].name)
                .join('、')
            : '';
        const dstName = dstEntry ? itemName(dstEntry.item) : '目标装备';
        const res = enchant(save, this._srcUid, this._picks, this._dstUid);
        if (!res.ok) {
            this._notice(REASON_TEXT[res.reason] || '附魔失败');
            return;
        }
        this._picks = [];
        this._changed(`附魔完成：${movedNames || '词条'} → ${dstName}`);
    }

    private _onSavePreset(slot: number): void {
        const save = this._save;
        if (!save) return;
        const check = canSaveTalentPreset(save, slot);
        if (!check.ok) {
            this._notice(REASON_TEXT[check.reason] || '无法存入方案');
            return;
        }
        if (!saveTalentPreset(save, slot)) {
            this._notice('存入失败');
            return;
        }
        this._changed(`已存入方案 ${slotLabel(slot)}`);
    }

    private _onLoadPreset(slot: number): void {
        const save = this._save;
        if (!save) return;
        const check = canLoadTalentPreset(save, slot);
        if (!check.ok) {
            this._notice(REASON_TEXT[check.reason] || '无法载入方案');
            return;
        }
        if (!loadTalentPreset(save, slot)) {
            this._notice('载入失败');
            return;
        }
        this._changed(`已载入方案 ${slotLabel(slot)}`);
    }

    private _onRespecTalents(): void {
        const save = this._save;
        if (!save) return;
        if (facilityLevel(save, 'training') <= 0) {
            this._notice('训练场还没建造：把它升到 Lv1 才能洗点');
            return;
        }
        if (talentPointsSpent(save.talents) <= 0) {
            this._notice('还没有投入天赋点');
            return;
        }
        const cost = talentRespecCost(save);
        if (!respecTalents(save)) {
            this._notice(`金币不足：洗点需要 ${cost} 金`);
            return;
        }
        this._changed(cost > 0 ? `洗点完成：−${cost} 金` : '洗点完成：训练场 Lv3 免费');
    }

    private _onRespecVariants(): void {
        const save = this._save;
        if (!save) return;
        if (facilityLevel(save, 'training') <= 0) {
            this._notice('训练场还没建造：把它升到 Lv1 才能重置变体');
            return;
        }
        const cost = variantRespecCost(save);
        if (!respecVariants(save)) {
            // 区分「没选过变体」与「金币不够」：前者是空操作，不该报缺钱
            let chosen = 0;
            for (const preset of save.variants ? Object.values(save.variants) : []) {
                if (Array.isArray(preset)) chosen += preset.filter((v) => v !== null).length;
            }
            this._notice(chosen <= 0 ? '还没有选定任何变体' : `金币不足：重置变体需要 ${cost} 金`);
            return;
        }
        this._changed(cost > 0 ? `变体重置完成：−${cost} 金` : '变体重置完成：训练场 Lv3 免费');
    }

    private _onBuyMeal(mealId: string): void {
        const save = this._save;
        if (!save) return;
        const check = canBuyMeal(save, mealId);
        if (!check.ok) {
            this._notice(REASON_TEXT[check.reason] || '无法购买料理');
            return;
        }
        if (!buyMeal(save, mealId)) {
            this._notice('购买失败');
            return;
        }
        const def = MEAL_BY_ID[mealId];
        this._changed(`料理入场：${def ? def.name : mealId}（${mealDurationFor(save)} 场）`);
    }

    private _onUpgradeTap(): void {
        const save = this._save;
        if (!save) return;
        const check = canUpgradeFacility(save, this._tab);
        if (!check.ok || !check.cost) {
            if (check.reason === 'no-material') {
                const cost = check.cost;
                const have = cost ? materialCount(save, cost.materialId) : 0;
                this._notice(cost
                    ? `材料不足：需要 ${materialName(cost.materialId)} ×${cost.count}（现有 ${have}）`
                    : '无法升级');
            } else {
                this._notice(REASON_TEXT[check.reason] || '无法升级');
            }
            return;
        }
        const def = FACILITY_BY_ID[this._tab];
        if (!upgradeFacility(save, this._tab)) {
            this._notice('升级失败');
            return;
        }
        const effect = def.effects[check.nextLevel - 1] || '';
        this._changed(`${def.name} 升到 Lv${check.nextLevel}：${effect}`);
    }

    private _onCloseTap(): void {
        this.close();
        if (this.onClose) this.onClose();
    }

    // ==================== 小工具 ====================

    private _turnPage(kind: 'sm' | 'src' | 'dst', delta: number): void {
        const save = this._save;
        if (!save) return;
        if (kind === 'sm') {
            const pages = Math.max(1, Math.ceil(ownedItems(save).length / SMITH_ROWS));
            this._smPage = Math.max(0, Math.min(pages - 1, this._smPage + delta));
        } else if (kind === 'src') {
            const pages = Math.max(1, Math.ceil(inventoryItems(save).length / ENCHANT_ROWS));
            this._srcPage = Math.max(0, Math.min(pages - 1, this._srcPage + delta));
        } else {
            const pages = Math.max(1, Math.ceil(ownedItems(save).length / ENCHANT_ROWS));
            this._dstPage = Math.max(0, Math.min(pages - 1, this._dstPage + delta));
        }
        this.refresh();
    }

    /** 上一页 / 页码 / 下一页（按钮由控件自己持闭包，节点触摸一律走具名方法） */
    private _pager(parent: Node, x: number, y: number, page: number, pages: number, prev: () => void, next: () => void): void {
        const p = createButton(parent, {
            w: 66, h: 32, text: '上页', fontSize: 14,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 8, onTap: prev,
        });
        p.node.setPosition(x - 84, y, 0);
        createLabel(parent, `${page + 1}/${pages}`, 14, {
            width: 60, height: 24, color: COLOR.TEXT_SECONDARY, x, y,
        });
        const n = createButton(parent, {
            w: 66, h: 32, text: '下页', fontSize: 14,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 8, onTap: next,
        });
        n.node.setPosition(x + 84, y, 0);
    }

    private _selectedOwned(save: MithrilSave): OwnedItem | null {
        if (!this._selUid) return null;
        return ownedItems(save).find((e) => e.uid === this._selUid) || null;
    }

    private _defaultHint(save: MithrilSave): string {
        const def = FACILITY_BY_ID[this._tab];
        const lv = facilityLevel(save, this._tab);
        // 材料不够时直接给出进度与预估场次（体验官 E3：别让首访营地只看到一排灰按钮）
        const check = canUpgradeFacility(save, this._tab);
        if (check.cost && !check.ok) {
            const have = materialCount(save, check.cost.materialId);
            const need = Math.max(1, check.cost.count - have);
            // 战斗节点掉 1–2 灰烬、精英 2–3：按每场 2 保守估，宁可说少了不夸大
            const wins = Math.max(1, Math.ceil(need / 2));
            const progress = `${materialName(check.cost.materialId)} ${have}/${check.cost.count} · 再赢 ${wins} 场可升 Lv${check.nextLevel}`;
            // effects[0] 自带「解锁」字样，这里不要再套一层「解锁：」
            return lv <= 0 ? `升到 Lv1 就能用：${def.effects[0]}\n${progress}` : progress;
        }
        if (lv <= 0) return `升到 Lv1 就能用：${def.effects[0]}`;
        return `设施升级只用材料 · 金币留给重铸 / 附魔 / 料理 / 洗点`;
    }

    /** 操作结果 / 失败提示：写进底部提示行，下次刷新自动复位 */
    private _notice(text: string): void {
        if (!this._hintLabel) return;
        this._hintLabel.string = text;
        this._hintLabel.color = hex(COLOR.DANGER);
    }

    private _changed(text?: string): void {
        this.refresh();
        if (text && this._hintLabel) {
            this._hintLabel.string = text;
            this._hintLabel.color = hex(COLOR.SUCCESS);
        }
        if (this.onChanged) this.onChanged();
    }

    onDestroy(): void {
        // 红线 4：只清引用，不碰节点
        this._save = null;
        this._root = null;
        this._panel = null;
        this._content = null;
        this._currencyLabel = null;
        this._summaryLabel = null;
        this._effectLabel = null;
        this._upgradeBtn = null;
        this._hintLabel = null;
        this._tabBtns = {};
        this._tabMarks = {};
        this._tabIcons = {};
        this._emblem = null;
        this._levelBar = null;
    }
}

// ==================== 小工具（保持文件内聚，不 export） ====================

function itemName(item: EquipItem): string {
    if (!item) return '';
    const base = GEAR_BASE_BY_ID[item.baseId];
    return base ? base.name : item.baseId;
}

function slotLabel(slot: number): string {
    return slot === 0 ? 'A' : 'B';
}

function clampPage(page: number, total: number, perPage: number): number {
    const pages = Math.max(1, Math.ceil(total / perPage));
    return Math.max(0, Math.min(pages - 1, Math.floor(page) || 0));
}

/** 「力量 8 点 · 钢铁 4 点」——方案槽摘要，最多两行 */
function presetSummary(preset: Record<string, number>, save: MithrilSave): string {
    const trees = TALENT_TREE_ORDER[save.classId] || [];
    const byTree: number[] = [0, 0, 0];
    for (const id of Object.keys(preset)) {
        const parts = id.split('_');
        const tree = parts.length >= 2 ? Number(parts[1]) : NaN;
        const idx = trees.indexOf(tree as never);
        if (idx >= 0) byTree[idx] += Math.max(0, Math.floor(preset[id] || 0));
    }
    const total = byTree.reduce((a, b) => a + b, 0);
    const detail = trees.map((t, i) => `${TALENT_TREE_NAMES[t]} ${byTree[i]}`).join(' · ');
    return `${total} 点（${detail}）`;
}
