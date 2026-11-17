/**
 * 《秘银远征》成长面板（M3）：天赋 30 格 + 技能 6 行 / 变体二选一 / 付费洗点。
 *
 * 设计依据（docs/plans/2026-11-14-game-mithril-design.md §4.4 / §4.5）：
 *  - 每职业 3 线 × 5 层 × 2 选 1，每格 1–5 点；每线上限 25、层 N 需本线 5×(N−1) 点
 *  - 技能 1–5 级（技能书升级），2 级 / 4 级各解锁一次变体二选一，永久生效
 *  - 洗点：天赋 200 金、技能变体 500 金（M5 营地会打折）
 *
 * 纪律（AGENTS 红线）：面板只做「数据 → 显示」的一次性刷新，不在 update 里逐帧重建；
 * 触摸 handler 全部是具名方法（自定义格子用节点名编码参数，不挂匿名 lambda）；
 * onDestroy 只清引用，不碰节点。
 */

import {
    _decorator, BlockInputEvents, Component, EventTouch, Graphics, Label, Node, UITransform,
} from 'cc';
import {
    COLOR, clearChildren, createButton, createLabel, hex,
} from '../../../common/ui/GameUIKit';
import type { UiButton } from '../../../common/ui/GameUIKit';
import {
    COMBAT_ILVL_FLOOR, SKILL_BY_ID, SKILLS, TALENT_BY_ID, TALENT_LINE_CAP,
    TALENT_TREE_NAMES, TALENT_TREE_ORDER, talentTierGate,
} from './MithrilConfig';
import type { SkillDef, TalentDef } from './MithrilConfig';
import {
    canChooseVariant, canSpendTalent, canUpgradeSkill, chooseVariant, facilityLevel,
    pendingVariantCount,
    respecTalents, respecVariants, skillLevel, SKILL_LEVEL_MAX, spendTalent,
    talentPointsForLevel, talentPointsInTree, talentPointsSpent, talentRespecCost,
    upgradeSkill, variantRespecCost, variantState,
} from './MithrilProgress';
import type { MithrilSave, TalentSpendReason } from './MithrilProgress';
import { SKILL_CD_PER_LEVEL, SKILL_DMG_PER_LEVEL } from './MithrilTalents';
import { profileFromSave } from './MithrilCore';
import {
    CLASS_ACCENT, SKILL_GLYPH_KIND, addGlyphNode, inkOnFill, repaintGlyphNode, treeGlyph,
} from './MithrilArt';

const { ccclass } = _decorator;

const PANEL_W = 680;
const PANEL_H = 940;

/** 天赋格尺寸与行距 */
const TALENT_CELL_W = 100;
const TALENT_CELL_H = 78;
const TALENT_ROW_STEP = 90;
const TALENT_ROW_TOP = 240;
const TALENT_COL_X = [-215, 0, 215];

/** 技能行距（6 行 × 78 = 470 高） */
const SKILL_ROW_STEP = 78;
const SKILL_ROW_TOP = 236;

type TabId = 'talent' | 'skill';

/** 加点失败的提示文案（reason 见 MithrilProgress.TalentSpendReason） */
const TALENT_FAIL: Partial<Record<TalentSpendReason, string>> = {
    unknown: '未知天赋',
    class: '职业不符',
    'no-points': '没有可用天赋点',
    'max-rank': '该天赋已满级',
    'line-cap': `本线最多投入 ${TALENT_LINE_CAP} 点`,
};

@ccclass('MithrilGrowthMenu')
export class MithrilGrowthMenu extends Component {
    /** 关闭面板 */
    onClose: (() => void) | null = null;
    /** 存档被修改（天赋 / 技能 / 变体）：主组件负责落盘并同步当前战斗 profile */
    onChanged: (() => void) | null = null;

    private _save: MithrilSave | null = null;
    private _tab: TabId = 'talent';
    private _selSkill = '';

    private _built = false;
    /** 整棵树（遮罩 + 面板）：显隐只认它，避免「面板关了、遮罩还在吞触摸」 */
    private _root: Node | null = null;
    private _panel: Node | null = null;
    private _content: Node | null = null;
    private _tabTalentBtn: UiButton | null = null;
    private _tabSkillBtn: UiButton | null = null;
    private _tabTalentMark: Node | null = null;
    private _tabSkillMark: Node | null = null;
    private _tabTalentIcon: Node | null = null;
    private _tabSkillIcon: Node | null = null;
    private _pointsLabel: Label | null = null;
    private _hintLabel: Label | null = null;

    // ==================== 对外 ====================

    open(save: MithrilSave): void {
        this._save = save;
        this._tab = 'talent';
        const defs = SKILLS.filter((d) => d.classId === save.classId);
        this._selSkill = defs.length > 0 ? defs[0].id : '';
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

    /** 整页重建（加点 / 切页 / 洗点后调用；一次性成本，不在 update 里跑） */
    refresh(): void {
        const save = this._save;
        const content = this._content;
        if (!save || !content) return;
        if (this._tabTalentBtn) this._tabTalentBtn.setActive(this._tab === 'talent');
        if (this._tabSkillBtn) this._tabSkillBtn.setActive(this._tab === 'skill');
        // 选中页签底色就是主题蓝：图标与下划线必须换对比墨色（N88）
        this._paintTabDecor('talent', 'star', '#FBBF24', this._tab === 'talent');
        this._paintTabDecor('skill', 'skill', '#60A5FA', this._tab === 'skill');
        if (this._tabTalentMark && this._tabTalentMark.isValid) {
            this._tabTalentMark.active = this._tab === 'talent';
        }
        if (this._tabSkillMark && this._tabSkillMark.isValid) {
            this._tabSkillMark.active = this._tab === 'skill';
        }
        if (this._pointsLabel) this._pointsLabel.string = this._pointsText(save);
        if (this._hintLabel) {
            this._hintLabel.string = this._defaultHint();
            this._hintLabel.color = hex(COLOR.WARNING);
        }
        clearChildren(content);
        if (this._tab === 'talent') this._renderTalent();
        else this._renderSkill();
    }

    // ==================== 骨架 ====================

    private _ensureBuilt(): void {
        if (this._built) return;
        this._built = true;

        const root = new Node('Growth');
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

        createLabel(panel, '成长', 34, {
            width: 300, height: 48, color: COLOR.TEXT_PRIMARY, bold: true, x: 0, y: 418,
        });
        const closeBtn = createButton(panel, {
            w: 116, h: 50, text: '返回', fontSize: 22,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 14, onTap: () => this._onCloseTap(),
        });
        closeBtn.node.setPosition(272, 418, 0);

        this._tabTalentBtn = createButton(panel, {
            w: 164, h: 50, text: '天赋', fontSize: 21,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY,
            activeFill: COLOR.PRIMARY, activeTextColor: '#FFFFFF',
            radius: 12, stroke: '#46536B', onTap: () => this._onTabTap('talent'),
        });
        this._tabTalentBtn.node.setPosition(-88, 360, 0);
        this._tabSkillBtn = createButton(panel, {
            w: 164, h: 50, text: '技能', fontSize: 21,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY,
            activeFill: COLOR.PRIMARY, activeTextColor: '#FFFFFF',
            radius: 12, stroke: '#46536B', onTap: () => this._onTabTap('skill'),
        });
        this._tabSkillBtn.node.setPosition(88, 360, 0);
        // 页签图标 + 选中下划线（N76）
        this._tabTalentMark = this._decorateTab(this._tabTalentBtn, 'star', '#FBBF24', 'talent');
        this._tabSkillMark = this._decorateTab(this._tabSkillBtn, 'skill', '#60A5FA', 'skill');

        this._pointsLabel = createLabel(panel, '', 16, {
            width: 380, height: 26, color: COLOR.TEXT_SECONDARY, align: 'left', x: -132, y: 316,
            overflow: 'shrink',
        });

        const content = new Node('Content');
        content.layer = this.node.layer;
        content.addComponent(UITransform).setContentSize(660, 880);
        panel.addChild(content);
        this._content = content;

        this._hintLabel = createLabel(panel, '', 15, {
            width: 640, height: 40, color: COLOR.WARNING, x: 0, y: -438, lineHeight: 20,
        });
    }

    /** 页签图标 + 选中下划线（N76），返回下划线节点由 refresh 切换显隐 */
    private _decorateTab(btn: UiButton, kind: string, color: string, id: TabId): Node {
        btn.label.node.setPosition(14, 0);
        const ut = btn.label.node.getComponent(UITransform);
        if (ut) ut.setContentSize(164 - 40, 46);
        const icon = addGlyphNode(btn.node, `TabIcon_${id}`, kind, 11, color, -50, 0, 40);
        if (id === 'talent') this._tabTalentIcon = icon;
        else this._tabSkillIcon = icon;
        const mark = new Node(`TabMark_${id}`);
        mark.layer = btn.node.layer;
        mark.addComponent(UITransform).setContentSize(164, 50);
        const g = mark.addComponent(Graphics);
        g.fillColor = hex(color, 255);
        g.roundRect(-40, -23, 80, 3, 1.5);
        g.fill();
        btn.node.addChild(mark);
        mark.active = false;
        return mark;
    }

    /** 页签选中态换色（N88）：选中底是主题蓝，同色图标/下划线会整块消失 */
    private _paintTabDecor(id: TabId, kind: string, color: string, active: boolean): void {
        const ink = inkOnFill(COLOR.PRIMARY);
        repaintGlyphNode(
            id === 'talent' ? this._tabTalentIcon : this._tabSkillIcon,
            kind, 11, active ? ink : color, active ? 70 : 40,
        );
        const mark = id === 'talent' ? this._tabTalentMark : this._tabSkillMark;
        if (!mark || !mark.isValid) return;
        const g = mark.getComponent(Graphics);
        if (!g) return;
        g.clear();
        g.fillColor = hex(active ? ink : color, 255);
        g.roundRect(-40, -23, 80, 3, 1.5);
        g.fill();
    }

    // ==================== 天赋页 ====================

    private _renderTalent(): void {
        const save = this._save;
        const content = this._content;
        if (!save || !content) return;

        const trees = TALENT_TREE_ORDER[save.classId];
        for (let tr = 0; tr < 3; tr++) {
            const tree = trees[tr];
            const inTree = talentPointsInTree(save.talents, save.classId, tree);
            // 系别徽记 + 名称（N79：三系不能只靠文字区分）
            const tg = treeGlyph(tree);
            addGlyphNode(content, `TreeIcon_${tree}`, tg.kind, 11, tg.color, TALENT_COL_X[tr] - 78, 288, 45);
            createLabel(content, `${TALENT_TREE_NAMES[tree]}  ${inTree}/${TALENT_LINE_CAP}`, 19, {
                width: 176, height: 28, bold: true, x: TALENT_COL_X[tr] + 10, y: 288,
                color: inTree >= TALENT_LINE_CAP ? COLOR.WARNING : COLOR.TEXT_PRIMARY,
            });
            for (let tier = 1; tier <= 5; tier++) {
                const y = TALENT_ROW_TOP - (tier - 1) * TALENT_ROW_STEP;
                for (let col = 0; col < 2; col++) {
                    const def = TALENT_BY_ID[`${save.classId}_${tree}_t${tier}_${col}`];
                    if (!def) continue;
                    const x = TALENT_COL_X[tr] + (col === 0 ? -51 : 51);
                    this._makeTalentCell(content, def, x, y);
                }
            }
        }

        const prof = profileFromSave(save, COMBAT_ILVL_FLOOR);
        const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
        const spent = talentPointsSpent(save.talents);
        createLabel(content, [
            `攻击强度 ${prof.attackPower.toFixed(1)}　生命上限 ${Math.round(prof.maxHp)}　暴击 ${pct(prof.critChance)}`,
            `急速 ${pct(prof.haste)}　精通 ${pct(prof.mastery)}　全能 ${pct(prof.vers)}`,
            `已投 ${spent}/${talentPointsForLevel(save.level)} 点 · 加点立刻作用于当前这一局`,
        ].join('\n'), 16, {
            width: 620, height: 108, color: COLOR.TEXT_SECONDARY, x: 0, y: -224, lineHeight: 30,
        });

        const respecCost = talentRespecCost(save);
        const campReady = facilityLevel(save, 'training') > 0;
        const respec = createButton(content, {
            w: 260, h: 48,
            text: !campReady ? '洗点（营地训练场 Lv1 解锁）'
                : (respecCost > 0 ? `洗点 ${respecCost} 金` : '洗点（免费）'),
            fontSize: 18,
            fill: campReady ? '#334155' : '#1A2332',
            textColor: campReady ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED,
            activeFill: '#475569',
            radius: 12, stroke: '#3A4658', onTap: () => this._onRespecTalents(),
        });
        respec.node.setPosition(0, -338, 0);
    }

    private _makeTalentCell(parent: Node, def: TalentDef, x: number, y: number): void {
        const save = this._save;
        if (!save) return;

        const rank = Math.max(0, Math.floor(save.talents[def.id] || 0));
        const inTree = talentPointsInTree(save.talents, save.classId, def.tree);
        const gate = talentTierGate(def.tier);
        const gateOk = inTree >= gate;
        const maxed = rank >= def.maxRank;
        const avail = talentPointsForLevel(save.level) - talentPointsSpent(save.talents);
        const canSpend = gateOk && !maxed && avail > 0 && inTree < TALENT_LINE_CAP;

        const node = new Node(`TalentCell_${def.id}`);
        node.layer = this.node.layer;
        node.addComponent(UITransform).setContentSize(TALENT_CELL_W, TALENT_CELL_H);
        node.setPosition(x, y, 0);
        parent.addChild(node);

        const fill = rank > 0 ? (maxed ? '#3B2A0B' : '#1E3A5F') : (gateOk ? '#1E293B' : '#141B28');
        const border = maxed ? '#F59E0B' : (canSpend ? '#60A5FA' : (gateOk ? '#475569' : '#2A3446'));
        const g = node.addComponent(Graphics);
        g.fillColor = hex(fill, 255);
        g.roundRect(-TALENT_CELL_W / 2, -TALENT_CELL_H / 2, TALENT_CELL_W, TALENT_CELL_H, 10);
        g.fill();
        g.strokeColor = hex(border, canSpend || maxed ? 235 : 150);
        g.lineWidth = 2;
        g.roundRect(-TALENT_CELL_W / 2, -TALENT_CELL_H / 2, TALENT_CELL_W, TALENT_CELL_H, 10);
        g.stroke();
        // 系别色侧条：已投实、可投半实、锁定很淡（N79：三系与三态都能一眼分出）
        const tg = treeGlyph(def.tree);
        g.fillColor = hex(tg.color, rank > 0 ? 215 : (gateOk ? 110 : 45));
        g.roundRect(-TALENT_CELL_W / 2 + 3, -TALENT_CELL_H / 2 + 8, 4, TALENT_CELL_H - 16, 2);
        g.fill();
        // 角落天赋图标
        addGlyphNode(node, `TalentIcon_${def.id}`, tg.kind, 8, tg.color, -35, 25, rank > 0 ? 70 : 35);

        const nameColor = maxed ? '#F59E0B' : (gateOk ? COLOR.TEXT_PRIMARY : '#64748B');
        createLabel(node, def.name, 14, {
            width: 72, height: 20, color: nameColor, bold: true, x: 10, y: 24,
            overflow: 'shrink',
        });
        createLabel(node, `${rank}/${def.maxRank}`, 12, {
            width: 84, height: 16,
            color: maxed ? COLOR.WARNING : (gateOk ? COLOR.TEXT_SECONDARY : '#64748B'), y: 8,
        });
        // 试玩 N87：描述折成两行时第二行会被格子下边框切掉（如「击杀回 1% 生命」只剩「生命」半截），
        // 描述框下移到 -18、加宽到 88、行高 14 → 两行占 -32..-4，离下边框仍留 7px。
        createLabel(node, gateOk ? def.desc : `本线需 ${gate} 点`, 12, {
            width: 88, height: 30, color: gateOk ? COLOR.TEXT_SECONDARY : '#64748B',
            x: 2, y: -18, lineHeight: 14, overflow: 'shrink',
        });

        node.on(Node.EventType.TOUCH_END, this.onTalentCellTap, this);
    }

    // ==================== 技能页 ====================

    private _renderSkill(): void {
        const save = this._save;
        const content = this._content;
        if (!save || !content) return;

        const defs = SKILLS.filter((d) => d.classId === save.classId);
        if (!defs.some((d) => d.id === this._selSkill)) {
            this._selSkill = defs.length > 0 ? defs[0].id : '';
        }
        for (let i = 0; i < defs.length; i++) {
            this._makeSkillRow(content, defs[i], SKILL_ROW_TOP - i * SKILL_ROW_STEP);
        }

        const sel = SKILL_BY_ID[this._selSkill] || defs[0];
        if (sel) {
            createLabel(content, this._skillInfoText(sel), 16, {
                width: 630, height: 205, color: COLOR.TEXT_SECONDARY, x: 0, y: -302, lineHeight: 22,
                overflow: 'shrink',
            });
        }

        const variantCost = variantRespecCost(save);
        const campReady = facilityLevel(save, 'training') > 0;
        // 试玩 N61：200 宽时「变体重置（需训练场 Lv1）」会被折成两行、第二行只剩一个「）」，
        // 加宽到 250 并左移保持右缘不变（右缘 324，仍留 6px 内边距）。
        const respec = createButton(content, {
            w: 250, h: 46,
            text: !campReady ? '变体重置（需训练场 Lv1）'
                : (variantCost > 0 ? `重置变体 ${variantCost} 金` : '重置变体（免费）'),
            fontSize: 18,
            fill: campReady ? '#334155' : '#1A2332',
            textColor: campReady ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED,
            activeFill: '#475569',
            radius: 12, stroke: '#3A4658', onTap: () => this._onRespecVariants(),
        });
        respec.node.setPosition(199, 316, 0);
    }

    private _makeSkillRow(parent: Node, def: SkillDef, y: number): void {
        const save = this._save;
        if (!save) return;

        const level = skillLevel(save, def.id);
        const selected = this._selSkill === def.id;
        const state = variantState(save, def.id);

        // 名称块：点它切换左侧详情
        const block = new Node(`SkillInfo_${def.id}`);
        block.layer = this.node.layer;
        block.addComponent(UITransform).setContentSize(180, 72);
        block.setPosition(-240, y, 0);
        parent.addChild(block);
        const bg = block.addComponent(Graphics);
        bg.fillColor = hex(selected ? '#1E3A5F' : '#1E293B', 255);
        bg.roundRect(-90, -36, 180, 72, 10);
        bg.fill();
        bg.strokeColor = hex(selected ? '#60A5FA' : COLOR.PANEL_BORDER, selected ? 235 : 160);
        bg.lineWidth = 2;
        bg.roundRect(-90, -36, 180, 72, 10);
        bg.stroke();
        // 技能图标（N80）：按职业强调色，六个技能位各有图形
        const accent = CLASS_ACCENT[save.classId] || COLOR.PRIMARY;
        addGlyphNode(block, `SkillIcon_${def.id}`, SKILL_GLYPH_KIND[def.id] || 'skill', 15, accent, -64, 2, 45);
        createLabel(block, `${def.name}  Lv${level}`, 17, {
            width: 130, height: 22, color: COLOR.TEXT_PRIMARY, bold: true, x: 17,
            y: def.variants ? 18 : 0, overflow: 'shrink',
        });
        // 基础描述只在右侧详情展示：12pt 塞进 168 宽会折两行，和技能名挤在一起几乎读不清（复核排版回归）
        const pickedNames: string[] = [];
        for (const i of [0, 1]) {
            const pair = def.variants ? def.variants[i] : null;
            const pick = state[i];
            // 只列出已选档位；两档都没选时显示「未选」，别写成「— · —」
            if (pair && pick !== null) pickedNames.push(pair[pick].name);
        }
        if (def.variants) {
            const anyPicked = pickedNames.length > 0;
            createLabel(block, anyPicked ? `变体 ${pickedNames.join(' · ')}` : '变体 未选', 12, {
                width: 134, height: 16, x: 15,
                color: anyPicked ? COLOR.INFO : COLOR.TEXT_DISABLED, y: -18, overflow: 'shrink',
            });
        }
        block.on(Node.EventType.TOUCH_END, this.onSkillInfoTap, this);

        // 升级按钮
        const check = canUpgradeSkill(save, def.id);
        const up = createButton(parent, {
            w: 104, h: 46,
            text: level >= SKILL_LEVEL_MAX ? '已满级' : '升级 1 本',
            fontSize: 15,
            fill: check.ok ? '#334155' : '#1A2332',
            textColor: check.ok ? COLOR.TEXT_PRIMARY : '#64748B',
            activeFill: '#475569',
            radius: 10,
            onTap: () => this._onUpgradeSkill(def.id),
        });
        up.node.setPosition(-55, y, 0);

        // 2 级 / 4 级变体：两档各两个选项
        for (const tier of [2, 4]) {
            const slot = tier === 2 ? 0 : 1;
            const rowY = y + (tier === 2 ? 18 : -18);
            for (const choice of [0, 1]) {
                this._makeVariantCell(
                    parent, def, tier, choice as 0 | 1, state[slot], level >= tier,
                    66 + choice * 132, rowY,
                );
            }
        }
    }

    private _makeVariantCell(
        parent: Node,
        def: SkillDef,
        tier: number,
        choice: 0 | 1,
        chosen: number | null,
        unlocked: boolean,
        x: number,
        y: number,
    ): void {
        if (!def.variants) return;
        const pair = def.variants[tier === 2 ? 0 : 1];
        if (!pair) return;
        const vdef = pair[choice];
        const isChosen = chosen === choice;
        const pickable = unlocked && chosen === null;

        const node = new Node(`Variant_${def.id}#${tier}#${choice}`);
        node.layer = this.node.layer;
        node.addComponent(UITransform).setContentSize(126, 32);
        node.setPosition(x, y, 0);
        parent.addChild(node);

        const fill = isChosen ? '#B45309' : (pickable ? '#334155' : '#1A2332');
        const border = isChosen ? '#F59E0B' : (pickable ? '#475569' : '#2A3446');
        const g = node.addComponent(Graphics);
        g.fillColor = hex(fill, 255);
        g.roundRect(-63, -16, 126, 32, 8);
        g.fill();
        g.strokeColor = hex(border, isChosen ? 235 : 160);
        g.lineWidth = 1.5;
        g.roundRect(-63, -16, 126, 32, 8);
        g.stroke();
        // 状态点：已选实心金 / 可选蓝 / 未解锁灰（N80：变体栏也有第二重信号）
        g.fillColor = hex(isChosen ? '#FBBF24' : (pickable ? '#93C5FD' : '#475569'), 255);
        g.circle(-54, 0, 3.5);
        g.fill();

        const text = !unlocked
            ? `${tier}级 未解锁`
            : (isChosen ? `已选·${vdef.name}` : `${tier}级·${vdef.name}`);
        createLabel(node, text, 13, {
            width: 100, height: 26, bold: isChosen, x: 7,
            color: isChosen ? '#FFFFFF' : (pickable ? COLOR.TEXT_PRIMARY : '#64748B'),
            overflow: 'shrink',
        });
        node.on(Node.EventType.TOUCH_END, this.onVariantTap, this);
    }

    private _skillInfoText(def: SkillDef): string {
        const save = this._save!;
        const level = skillLevel(save, def.id);
        const state = variantState(save, def.id);
        // 等级带来的实际乘数（与 MithrilTalents 同源，避免文案和实战对不上 —— 试玩 N36）
        const dmgMul = 1 + SKILL_DMG_PER_LEVEL * (level - 1);
        const cdMul = Math.max(0.5, 1 - SKILL_CD_PER_LEVEL * (level - 1));
        const lines: string[] = [
            `${def.name} Lv${level}　伤害 ×${dmgMul.toFixed(3)}　冷却 ×${cdMul.toFixed(3)}`,
            `基础：${def.desc}`,
        ];
        if (def.variants) {
            for (const i of [0, 1]) {
                const tier = i === 0 ? 2 : 4;
                const pair = def.variants[i];
                const chosen = state[i];
                const tag = chosen === null ? '待选' : `已选 ${pair[chosen].name}`;
                lines.push(`${tier}级（${tag}）：${pair[0].name} / ${pair[1].name}`);
                lines.push(`　${pair[0].name}：${pair[0].desc}`);
                lines.push(`　${pair[1].name}：${pair[1].desc}`);
            }
        }
        lines.push('技能书：每通关 +1 本，首通再 +1；等级与变体选定后立刻作用于这一局');
        return lines.join('\n');
    }

    // ==================== 触摸 handler（具名） ====================

    private onTalentCellTap(ev: EventTouch): void {
        const save = this._save;
        const node = ev.currentTarget as Node;
        if (!save || !node) return;
        const id = node.name.slice('TalentCell_'.length);
        const check = canSpendTalent(save, id);
        if (!check.ok) {
            const def = TALENT_BY_ID[id];
            if (check.reason === 'tier-gate' && def) {
                this._notice(`第 ${def.tier} 层需要本线已有 ${talentTierGate(def.tier)} 点`);
            } else {
                this._notice(TALENT_FAIL[check.reason] || '无法加点');
            }
            return;
        }
        spendTalent(save, id);
        this._changed();
    }

    private onVariantTap(ev: EventTouch): void {
        const save = this._save;
        const node = ev.currentTarget as Node;
        if (!save || !node) return;
        const parts = node.name.split('#');
        if (parts.length !== 3) return;
        const skillId = parts[0].slice('Variant_'.length);
        const tier = Number(parts[1]);
        const choice = Number(parts[2]) as 0 | 1;

        if (skillLevel(save, skillId) < tier) {
            this._notice(`技能升到 ${tier} 级才能解锁这一档变体`);
            return;
        }
        if (!canChooseVariant(save, skillId, tier)) {
            this._notice('这一档变体已选定，洗点后可重选');
            return;
        }
        if (!chooseVariant(save, skillId, tier, choice)) {
            this._notice('无法选择该变体');
            return;
        }
        this._selSkill = skillId;
        this._changed();
    }

    private onSkillInfoTap(ev: EventTouch): void {
        const node = ev.currentTarget as Node;
        if (!node) return;
        this._selSkill = node.name.slice('SkillInfo_'.length);
        this.refresh();
    }

    private _onTabTap(tab: TabId): void {
        if (this._tab === tab) return;
        this._tab = tab;
        this.refresh();
    }

    private _onUpgradeSkill(defId: string): void {
        const save = this._save;
        if (!save) return;
        const check = canUpgradeSkill(save, defId);
        if (!check.ok) {
            this._notice(check.reason === 'no-books'
                ? '没有技能书：通关副本掉落'
                : (check.reason === 'max-level' ? '该技能已满级' : '无法升级'));
            return;
        }
        upgradeSkill(save, defId);
        this._selSkill = defId;
        this._changed();
    }

    private _onRespecTalents(): void {
        const save = this._save;
        if (!save) return;
        if (facilityLevel(save, 'training') <= 0) {
            this._notice('训练场还没建造：去营地把它升到 Lv1 才能洗点');
            return;
        }
        if (talentPointsSpent(save.talents) <= 0) {
            this._notice('还没有投入天赋点');
            return;
        }
        if (!respecTalents(save)) {
            const cost = talentRespecCost(save);
            this._notice(cost > 0
                ? `金币不足：洗点需要 ${cost} 金（营地将训练场升级可打折 / 免费）`
                : '洗点失败');
            return;
        }
        this._changed();
    }

    private _onRespecVariants(): void {
        const save = this._save;
        if (!save) return;
        if (facilityLevel(save, 'training') <= 0) {
            this._notice('训练场还没建造：去营地把它升到 Lv1 才能重置变体');
            return;
        }
        let chosen = 0;
        for (const def of SKILLS) {
            if (def.classId !== save.classId || !def.variants) continue;
            const state = variantState(save, def.id);
            if (state[0] !== null) chosen++;
            if (state[1] !== null) chosen++;
        }
        if (chosen <= 0) {
            this._notice('还没有选定任何变体');
            return;
        }
        if (!respecVariants(save)) {
            const cost = variantRespecCost(save);
            this._notice(cost > 0
                ? `金币不足：重置变体需要 ${cost} 金（营地将训练场升级可打折 / 免费）`
                : '重置变体失败');
            return;
        }
        this._changed();
    }

    private _onCloseTap(): void {
        this.close();
        if (this.onClose) this.onClose();
    }

    // ==================== 小工具 ====================

    private _pointsText(save: MithrilSave): string {
        const gold = Math.max(0, Math.floor(save.gold || 0));
        if (this._tab === 'talent') {
            const spent = talentPointsSpent(save.talents);
            const avail = Math.max(0, talentPointsForLevel(save.level) - spent);
            return `天赋点：可用 ${avail} · 已投 ${spent}/${talentPointsForLevel(save.level)} · 金币 ${gold}`;
        }
        const books = Math.max(0, Math.floor(save.skillBooks || 0));
        return `技能书 ${books} · 变体待选 ${pendingVariantCount(save)} · 金币 ${gold}`;
    }

    private _defaultHint(): string {
        if (this._tab === 'talent') {
            return '点击格子加点：每线最多 25 点，第 N 层需本线已有 5×(N−1) 点';
        }
        const head = '点技能名看详情 · 等级与变体选定后立刻生效 · 变体二选一';
        const save = this._save;
        if (!save) return head;
        const cost = variantRespecCost(save);
        return cost > 0 ? `${head}（重置需 ${cost} 金）` : `${head}（重置免费）`;
    }

    /** 失败提示：写进底部提示行，下次刷新自动复位 */
    private _notice(text: string): void {
        if (!this._hintLabel) return;
        this._hintLabel.string = text;
        this._hintLabel.color = hex(COLOR.DANGER);
    }

    private _changed(): void {
        this.refresh();
        if (this.onChanged) this.onChanged();
    }

    onDestroy(): void {
        // 红线 4：只清引用，不碰节点
        this._save = null;
        this._root = null;
        this._panel = null;
        this._content = null;
        this._tabTalentBtn = null;
        this._tabSkillBtn = null;
        this._pointsLabel = null;
        this._hintLabel = null;
    }
}
