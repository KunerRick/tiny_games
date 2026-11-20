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
    _decorator, BlockInputEvents, Component, EventTouch, Graphics, Label, Node,
    UIOpacity, UITransform, tween,
} from 'cc';
import {
    COLOR, clearChildren, createButton, createLabel, hex, stopTweens,
} from '../../../common/ui/GameUIKit';
import type { UiButton } from '../../../common/ui/GameUIKit';
import {
    COMBAT_ILVL_FLOOR, SKILL_BY_ID, SKILLS, TALENT_BY_ID, TALENT_LINE_CAP,
    TALENT_TREE_NAMES, TALENT_TREE_ORDER, talentTierGate, talentsOf,
} from './MithrilConfig';
import type { SkillDef, TalentDef, TalentTree } from './MithrilConfig';
import {
    canChooseVariant, canSpendTalent, canUpgradeSkill, chooseVariant, facilityLevel,
    pendingVariantCount,
    respecTalents, respecVariants, skillLevel, SKILL_LEVEL_MAX, spendTalent,
    talentPointsForLevel, talentPointsInTree, talentPointsSpent, talentRespecCost,
    upgradeSkill, variantRespecCost, variantState,
} from './MithrilProgress';
import type { MithrilSave, TalentSpendReason } from './MithrilProgress';
import { SKILL_CD_PER_LEVEL, SKILL_DMG_PER_LEVEL, talentEffects } from './MithrilTalents';
import type { TalentEffects } from './MithrilTalents';
import { profileFromSave } from './MithrilCore';
import {
    CLASS_ACCENT, SKILL_GLYPH_KIND, addGlyphNode, inkOnFill, repaintGlyphNode, treeGlyph,
} from './MithrilArt';
import { MITH_UI as T, drawStoneTrim } from './MithrilTheme';

const { ccclass } = _decorator;

const PANEL_W = 680;
const PANEL_H = 940;

/**
 * 天赋格尺寸与行距。
 * round33 / N161：原「三线并排 × 每线 2 列 = 6 列 × 100×78」在 620 宽里已满，
 * 描述 12 design px ≈ 6.6 CSS px，手机上看不清。改为一屏一线（三线切换），
 * 格子 300×104，名称 20 / 门槛 16 / 描述 16，信息可读优先于同屏对比；
 * 三线各自的投入点数仍由选择行 `N/25` 与总点数行给出。
 */
const TALENT_CELL_W = 300;
const TALENT_CELL_H = 104;
const TALENT_ROW_STEP = 112;
const TALENT_ROW_TOP = 190;
const TALENT_CELL_X = [-160, 160];
/** 三线切换行（一屏一线，见上） */
const TALENT_TREE_X = [-215, 0, 215];
const TALENT_TREE_Y = 272;

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

/**
 * 试玩 N185：天赋格一直只写相对百分比（`受伤 −1%` / `护甲 +2%`），玩家没有基准，
 * 也不知道「点下去这一格面板会变成多少」。这里把 `talentEffects` 的差值翻成
 * 「下一档收益」与「本次加点生效了什么」两处读数：
 *  - 格子行末 `→受伤 −1.0%`（只在可加点时出现，锁定格不画饼）
 *  - 三线切换按钮第二行写本线当前贡献，三线同屏可比
 *  - 点完格子后底部提示行写「本次加点生效：…」
 * 顺序即优先级：排在前面的更常被玩家拿来做决策。
 */
const EFFECT_DISPLAY: Array<{
    /**
     * `dir` = 存档里该字段「每点的数值增量」与「玩家看到的方向」之间的关系：
     * +1 表示数值变大就是变强（暴击 / 护甲…），-1 表示字段存的是「削减量」，
     * 数值变大对玩家来说反而是变弱（技能CD / 闪避CD）。
     * 注意 `takenMul` 是个例外：它存的是带符号的承伤系数（每点 -0.01），
     * 所以方向直接由数值本身给出，`dir` 保持 +1。
     */
    key: keyof TalentEffects; label: string; unit: 'pct' | 'sec' | 'flat'; dir?: 1 | -1;
}> = [
    { key: 'takenMul', label: '受伤', unit: 'pct' },
    { key: 'armor', label: '护甲', unit: 'flat' },
    { key: 'critChance', label: '暴击', unit: 'pct' },
    { key: 'critMult', label: '暴伤', unit: 'pct' },
    { key: 'attackSpeed', label: '攻速', unit: 'pct' },
    { key: 'skillDamage', label: '技能伤害', unit: 'pct' },
    { key: 'apPct', label: '攻强', unit: 'pct' },
    { key: 'healMul', label: '治疗量', unit: 'pct' },
    { key: 'lowHpDr', label: '残血减伤', unit: 'pct' },
    { key: 'burstDamage', label: '爆发伤害', unit: 'pct' },
    { key: 'burstAttackSpeed', label: '爆发攻速', unit: 'pct' },
    { key: 'executeDamage', label: '斩杀伤害', unit: 'pct' },
    { key: 'woundedDamage', label: '残血增伤', unit: 'pct' },
    { key: 'killHealPct', label: '击杀回血', unit: 'pct' },
    { key: 'meleeReflect', label: '反伤', unit: 'pct' },
    { key: 'counterReflect', label: '格挡反击', unit: 'pct' },
    { key: 'thornAoe', label: '荆棘扩散', unit: 'pct' },
    { key: 'ccResist', label: '控制抗性', unit: 'pct' },
    { key: 'lowHpDamage', label: '残血伤害', unit: 'pct' },
    { key: 'burstShield', label: '爆发护盾', unit: 'pct' },
    { key: 'burstTaken', label: '爆发减伤', unit: 'pct' },
    { key: 'stackDamage', label: '狂潮增伤', unit: 'pct' },
    { key: 'slowBonus', label: '减速时长', unit: 'pct' },
    { key: 'stunBonus', label: '眩晕时长', unit: 'sec' },
    { key: 'armorBreakBonus', label: '减甲', unit: 'pct' },
    { key: 'skillCd', label: '技能CD', unit: 'pct', dir: -1 },
    { key: 'dodgeCdCut', label: '闪避CD', unit: 'sec', dir: -1 },
    { key: 'rageGain', label: '怒气获取', unit: 'pct' },
    { key: 'rageRegen', label: '怒气回复', unit: 'flat' },
];

/** 差值 → 可读文本；`dir` 决定符号（存「削减量」的字段要反过来写） */
function effectDeltaText(from: TalentEffects, to: TalentEffects, maxItems: number): string {
    const out: string[] = [];
    for (const e of EFFECT_DISPLAY) {
        if (out.length >= maxItems) break;
        const d = (to[e.key] || 0) - (from[e.key] || 0);
        if (Math.abs(d) < 1e-6) continue;
        // 显示的增量按 `dir` 换算成玩家视角的方向（技能CD -2% 而不是 +2%）
        const shown = (e.dir || 1) * d;
        const sign = shown > 0 ? '+' : '−';
        const abs = Math.abs(shown);
        const num = e.unit === 'pct' ? `${(abs * 100).toFixed(1)}%`
            : e.unit === 'sec' ? `${abs.toFixed(2)}s`
                : `${abs.toFixed(1)}`;
        out.push(`${e.label} ${sign}${num}`);
    }
    return out.join(' · ');
}

@ccclass('MithrilGrowthMenu')
export class MithrilGrowthMenu extends Component {
    /** 关闭面板 */
    onClose: (() => void) | null = null;
    /** 存档被修改（天赋 / 技能 / 变体）：主组件负责落盘并同步当前战斗 profile */
    onChanged: (() => void) | null = null;

    private _save: MithrilSave | null = null;
    private _tab: TabId = 'talent';
    private _selSkill = '';
    /** 天赋页当前查看的线（N161：一屏一线，0–2 对应 TALENT_TREE_ORDER） */
    private _talentTree = 0;

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
    /** 试玩 N193：被点格子旁的即时反馈气泡（底部提示行距格 ≈360 CSS px，玩家看不到） */
    private _cardToast: Node | null = null;

    // ==================== 对外 ====================

    open(save: MithrilSave): void {
        this._save = save;
        this._tab = 'talent';
        this._talentTree = 0;
        const defs = SKILLS.filter((d) => d.classId === save.classId);
        this._selSkill = defs.length > 0 ? defs[0].id : '';
        this._ensureBuilt();
        if (!this._root) return;
        this._root.active = true;
        this.refresh();
    }

    close(): void {
        this._clearCardToast();
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
        this._paintTabDecor('talent', 'star', T.gold, this._tab === 'talent');
        this._paintTabDecor('skill', 'skill', T.gold, this._tab === 'skill');
        if (this._tabTalentMark && this._tabTalentMark.isValid) {
            this._tabTalentMark.active = this._tab === 'talent';
        }
        if (this._tabSkillMark && this._tabSkillMark.isValid) {
            this._tabSkillMark.active = this._tab === 'skill';
        }
        if (this._pointsLabel) this._pointsLabel.string = this._pointsText(save);
        if (this._hintLabel) {
            this._hintLabel.string = this._defaultHint();
            this._hintLabel.color = hex(T.warning);
        }
        this._clearCardToast();
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
        // 首次构建不显示：整棵树（含遮罩）一起关
        root.active = false;

        createLabel(panel, '成长', 34, {
            width: 300, height: 48, color: T.parchment, bold: true, x: 0, y: 418,
        });
        const closeBtn = createButton(panel, {
            w: 116, h: 50, text: '返回', fontSize: 20,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 14, onTap: () => this._onCloseTap(),
        });
        closeBtn.node.setPosition(272, 418, 0);

        this._tabTalentBtn = createButton(panel, {
            w: 164, h: 50, text: '天赋', fontSize: 20,
            fill: T.stoneLight, textColor: T.parchment,
            activeFill: T.gold, activeTextColor: T.parchment,
            radius: 12, stroke: T.goldLine, onTap: () => this._onTabTap('talent'),
        });
        this._tabTalentBtn.node.setPosition(-88, 360, 0);
        this._tabSkillBtn = createButton(panel, {
            w: 164, h: 50, text: '技能', fontSize: 20,
            fill: T.stoneLight, textColor: T.parchment,
            activeFill: T.gold, activeTextColor: T.parchment,
            radius: 12, stroke: T.goldLine, onTap: () => this._onTabTap('skill'),
        });
        this._tabSkillBtn.node.setPosition(88, 360, 0);
        // 页签图标 + 选中下划线（N76）
        this._tabTalentMark = this._decorateTab(this._tabTalentBtn, 'star', T.gold, 'talent');
        this._tabSkillMark = this._decorateTab(this._tabSkillBtn, 'skill', T.gold, 'skill');

        this._pointsLabel = createLabel(panel, '', 16, {
            width: 380, height: 26, color: T.parchmentDim, align: 'left', x: -132, y: 316,
            overflow: 'shrink',
        });

        const content = new Node('Content');
        content.layer = this.node.layer;
        content.addComponent(UITransform).setContentSize(660, 880);
        panel.addChild(content);
        this._content = content;

        this._hintLabel = createLabel(panel, '', 16, {
            width: 640, height: 36, color: T.warning, x: 0, y: -450, lineHeight: 20,
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
        const ink = T.ink;
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
        if (this._talentTree < 0 || this._talentTree >= trees.length) this._talentTree = 0;

        // 三线切换行（N161）：一屏只铺一条线，格子才够宽把字号抬到可读档。
        // 三条线各自的投入点数直接写进按钮（`N/25`），跨线比较不必来回切页。
        for (let tr = 0; tr < trees.length; tr++) {
            const tree = trees[tr];
            const inTree = talentPointsInTree(save.talents, save.classId, tree);
            const active = tr === this._talentTree;
            const tg = treeGlyph(tree);
            const btn = createButton(content, {
                w: 200, h: 56,
                text: `${TALENT_TREE_NAMES[tree]}  ${inTree}/${TALENT_LINE_CAP}`,
                fontSize: 19,
                fill: active ? T.rowActive : T.row,
                textColor: active ? T.parchment : T.parchmentDim,
                activeFill: T.stonePressed,
                radius: 12, stroke: active ? T.gold : T.goldDim,
                onTap: () => this._onTreeTap(tr),
            });
            btn.node.setPosition(TALENT_TREE_X[tr], TALENT_TREE_Y, 0);
            addGlyphNode(btn.node, `TreeIcon_${tree}`, tg.kind, 11, tg.color, -76, 0, active ? 85 : 55);
            btn.label.node.setPosition(14, 0);
            const tut = btn.label.node.getComponent(UITransform);
            if (tut) tut.setContentSize(200 - 44, 44);
            // N185：三线同屏对比不只比投入点数，也比「这条线现在给了什么」。
            // 只在本线已有实际面板贡献时加第二行；没有贡献的线保持单行（不画空饼）。
            const summary = this._treeSummary(save, tree);
            if (summary) {
                btn.label.node.setPosition(14, 9);
                if (tut) tut.setContentSize(200 - 44, 30);
                createLabel(btn.node, summary, 15, {
                    width: 186, height: 20, color: active ? T.parchmentDim : T.parchmentMuted,
                    x: 14, y: -14, overflow: 'shrink',
                });
            }
        }

        const tree = trees[this._talentTree];
        for (let tier = 1; tier <= 5; tier++) {
            const y = TALENT_ROW_TOP - (tier - 1) * TALENT_ROW_STEP;
            for (let col = 0; col < 2; col++) {
                const def = TALENT_BY_ID[`${save.classId}_${tree}_t${tier}_${col}`];
                if (!def) continue;
                this._makeTalentCell(content, def, TALENT_CELL_X[col], y);
            }
        }

        const prof = profileFromSave(save, COMBAT_ILVL_FLOOR);
        const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
        const spent = talentPointsSpent(save.talents);
        createLabel(content, [
            `攻击强度 ${prof.attackPower.toFixed(1)}　生命上限 ${Math.round(prof.maxHp)}　暴击 ${pct(prof.critChance)}　急速 ${pct(prof.haste)}`,
            `精通 ${pct(prof.mastery)}　全能 ${pct(prof.vers)}　·　已投 ${spent}/${talentPointsForLevel(save.level)} 点，加点立刻作用于当前这一局`,
        ].join('\n'), 16, {
            width: 640, height: 48, color: T.parchmentDim, x: 0, y: -340, lineHeight: 24,
        });

        const respecCost = talentRespecCost(save);
        const campReady = facilityLevel(save, 'training') > 0;
        const respec = createButton(content, {
            w: 260, h: 52,
            text: !campReady ? '洗点（营地训练场 Lv1 解锁）'
                : (respecCost > 0 ? `洗点 ${respecCost} 金` : '洗点（免费）'),
            fontSize: 18,
            fill: campReady ? T.stoneLight : T.stoneDark,
            textColor: campReady ? T.parchment : T.parchmentMuted,
            activeFill: T.stonePressed,
            radius: 12, stroke: T.goldLine, onTap: () => this._onRespecTalents(),
        });
        // 试玩 N161：面板底部 y=−438 有一条页脚提示（`_hintLabel`），这里按
        // 「网格 → 数值两行 → 洗点 → 页脚」的顺序重排，避免与提示行叠字。
        respec.node.setPosition(0, -400, 0);
    }

    /** 三线切换（N161，具名 handler；createButton 的 onTap 不带 this，包装一次） */
    private _onTreeTap(index: number): void {
        if (this._talentTree === index) return;
        this._talentTree = index;
        this.refresh();
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

        const fill = rank > 0 ? (maxed ? T.rowActive : T.rowActive) : (gateOk ? T.row : T.stoneDark);
        const border = maxed ? T.goldBright : (canSpend ? T.gold : (gateOk ? T.stonePressed : T.stonePressed));
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
        addGlyphNode(node, `TalentIcon_${def.id}`, tg.kind, 12, tg.color, -118, 30, rank > 0 ? 70 : 35);

        // 试玩 N203（round39 fresh 玩家）：锁定行与可投行「长得一模一样」，点下去才知道
        // 是层数门槛 —— 玩家第一反应是「点了没反应」，第二眼才看到底部那行小红字。
        // N193 的卡片 toast 实测能弹出，但 1.5 s 的瞬时反馈救不了「点之前不知道」。
        // 这里给锁定格一个**常驻**标记：矢量挂锁压在天赋图标上（不依赖字体 / emoji），
        // 名称与描述再降一档到 parchmentMuted，行内直接写「需本线 N 点」。
        if (!gateOk) {
            // 独立子节点：父节点的 Graphics 会画在子节点下面，挂在图标上会被图标盖住
            const lock = new Node('TalentLock');
            lock.layer = node.layer;
            lock.addComponent(UITransform).setContentSize(34, 34);
            lock.setPosition(-116, 30, 0);
            // 深底垫一层；尺寸按「设计像素 ×0.5 = CSS 像素」反推：24 设计 px 只有 12 CSS px，
            // 门环糊成金色小方块，提到 34 设计 px（≈17 CSS px）才读得出是锁。
            const lg = lock.addComponent(Graphics);
            lg.fillColor = hex(T.stoneDark, 200);
            lg.circle(0, 1, 15);
            lg.fill();
            lg.strokeColor = hex(T.warning, 255);
            lg.lineWidth = 3;
            lg.arc(0, 7, 7, 0, Math.PI, true);
            lg.stroke();
            lg.fillColor = hex(T.warning, 255);
            lg.roundRect(-9, -8, 18, 14, 3);
            lg.fill();
            node.addChild(lock);
        }

        const nameColor = maxed ? T.goldBright : (gateOk ? T.parchment : T.parchmentMuted);
        // N161：300 宽的格子把字号抬到 20 / 16 / 16（原 14 / 12 / 12，≈6.6 CSS px）
        createLabel(node, def.name, 20, {
            width: 200, height: 26, color: nameColor, bold: true, x: 28, y: 32,
            overflow: 'shrink',
        });
        // 试玩 N176：锁定格原本用「本线需 N 点」顶替效果文本，玩家看不到这格给什么，
        // 只能凭名字猜投资方向。门槛改挂到等级行（`0/1 · 需5`），效果文本始终显示；
        // 锁定态文字同时从 parchmentMuted(#8A7E66) 提到 parchmentDim(#B9AB8B)，深底上不再糊。
        // N185：可加点时把「这一档具体给什么」写在行末（绝对数值，不再只有相对百分比）；
        // 锁定格不预告，避免把「点不了的东西」写成承诺。
        let rankText = gateOk ? `${rank}/${def.maxRank}` : `${rank}/${def.maxRank} · 需本线 ${gate} 点`;
        if (canSpend) {
            const preview = effectDeltaText(
                talentEffects(save.talents, save.classId),
                talentEffects({ ...save.talents, [def.id]: rank + 1 }, save.classId),
                1,
            );
            if (preview) rankText += ` · →${preview}`;
        }
        createLabel(node, rankText, 16, {
            width: 260, height: 22,
            color: maxed ? T.warning : (gateOk ? T.parchmentDim : T.parchmentMuted), x: 10, y: 8,
            overflow: 'shrink',
        });
        // 描述两行（行高 20）占 -46..-6，离 104 高的格子下边框留 6px
        createLabel(node, def.desc, 16, {
            width: 276, height: 44, color: gateOk ? T.parchmentDim : T.parchmentMuted,
            x: 0, y: -26, lineHeight: 20, overflow: 'shrink',
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
                width: 630, height: 205, color: T.parchmentDim, x: 0, y: -302, lineHeight: 22,
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
            fill: campReady ? T.stoneLight : T.stoneDark,
            textColor: campReady ? T.parchment : T.parchmentMuted,
            activeFill: T.stonePressed,
            radius: 12, stroke: T.goldLine, onTap: () => this._onRespecVariants(),
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
        bg.fillColor = hex(selected ? T.rowActive : T.row, 255);
        bg.roundRect(-90, -36, 180, 72, 10);
        bg.fill();
        bg.strokeColor = hex(selected ? T.gold : T.goldDim, selected ? 235 : 160);
        bg.lineWidth = 2;
        bg.roundRect(-90, -36, 180, 72, 10);
        bg.stroke();
        // 技能图标（N80）：按职业强调色，六个技能位各有图形
        const accent = CLASS_ACCENT[save.classId] || T.gold;
        addGlyphNode(block, `SkillIcon_${def.id}`, SKILL_GLYPH_KIND[def.id] || 'skill', 15, accent, -64, 2, 45);
        createLabel(block, `${def.name}  Lv${level}`, 18, {
            width: 130, height: 22, color: T.parchment, bold: true, x: 17,
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
            // N210：未解锁的档位不再逐格写「未解锁」，行内只留一句解锁门槛
            const variantText = anyPicked
                ? `变体 ${pickedNames.join(' · ')}`
                : (level < 2 ? '变体 Lv2 解锁' : '变体 未选');
            // 试玩 N178：12 → 14（技能块宽 180，134 的文案盒放 9 个全角 ≈126，仍有余量）
            createLabel(block, variantText, 14, {
                width: 134, height: 18, x: 15,
                color: anyPicked ? T.info : T.parchmentMuted, y: -18, overflow: 'shrink',
            });
        }
        block.on(Node.EventType.TOUCH_END, this.onSkillInfoTap, this);

        // 升级按钮
        const check = canUpgradeSkill(save, def.id);
        const up = createButton(parent, {
            w: 104, h: 46,
            text: level >= SKILL_LEVEL_MAX ? '已满级' : '升级 1 本',
            fontSize: 16,
            fill: check.ok ? T.stoneLight : T.stoneDark,
            textColor: check.ok ? T.parchment : T.parchmentMuted,
            activeFill: T.stonePressed,
            radius: 10,
            onTap: () => this._onUpgradeSkill(def.id),
        });
        up.node.setPosition(-55, y, 0);

        // 2 级 / 4 级变体：N210 锁定档不再渲染灰格（原来每技能 4 个「未解锁」×6 = 24 个），
        // 已选的档位收成一格「已选·名称」，只有「已解锁且未选」才摊开两个可点选项。
        for (const tier of [2, 4]) {
            const slot = tier === 2 ? 0 : 1;
            const rowY = y + (tier === 2 ? 18 : -18);
            const chosen = state[slot];
            if (level < tier) continue;
            if (chosen !== null) {
                this._makeVariantCell(parent, def, tier, chosen as 0 | 1, chosen, 132, rowY);
                continue;
            }
            for (const choice of [0, 1]) {
                this._makeVariantCell(
                    parent, def, tier, choice as 0 | 1, chosen,
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
        x: number,
        y: number,
    ): void {
        if (!def.variants) return;
        const pair = def.variants[tier === 2 ? 0 : 1];
        if (!pair) return;
        const vdef = pair[choice];
        const isChosen = chosen === choice;
        const pickable = chosen === null;

        const node = new Node(`Variant_${def.id}#${tier}#${choice}`);
        node.layer = this.node.layer;
        node.addComponent(UITransform).setContentSize(126, 32);
        node.setPosition(x, y, 0);
        parent.addChild(node);

        const fill = isChosen ? T.gold : (pickable ? T.stoneLight : T.stoneDark);
        const border = isChosen ? T.goldBright : (pickable ? T.stonePressed : T.stonePressed);
        const g = node.addComponent(Graphics);
        g.fillColor = hex(fill, 255);
        g.roundRect(-63, -16, 126, 32, 8);
        g.fill();
        g.strokeColor = hex(border, isChosen ? 235 : 160);
        g.lineWidth = 1.5;
        g.roundRect(-63, -16, 126, 32, 8);
        g.stroke();
        // 状态点：已选实心金 / 可选蓝 / 未解锁灰（N80：变体栏也有第二重信号）
        g.fillColor = hex(isChosen ? T.gold : (pickable ? T.goldBright : T.stonePressed), 255);
        g.circle(-54, 0, 3.5);
        g.fill();

        const text = isChosen ? `已选·${vdef.name}` : `${tier}级·${vdef.name}`;
        createLabel(node, text, 14, {
            width: 100, height: 26, bold: isChosen, x: 7,
            color: isChosen ? T.parchment : (pickable ? T.parchment : T.parchmentMuted),
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
        // N210：207 字 → 5 行内。已选档只写选了什么，未解锁档只写名字（解锁后再给描述）
        const lines: string[] = [
            `${def.name} Lv${level}　伤害 ${Math.round(dmgMul * 100)}%　冷却 ${Math.round(cdMul * 100)}%`,
            `基础：${def.desc}`,
        ];
        if (def.variants) {
            for (const i of [0, 1]) {
                const tier = i === 0 ? 2 : 4;
                const pair = def.variants[i];
                const chosen = state[i];
                if (chosen !== null) {
                    lines.push(`${tier}级已选 ${pair[chosen].name}：${pair[chosen].desc}`);
                } else if (level >= tier) {
                    lines.push(`${tier}级可选：${pair[0].name}（${pair[0].desc}） / ${pair[1].name}（${pair[1].desc}）`);
                } else {
                    lines.push(`${tier}级变体（Lv${tier} 解锁）：${pair[0].name} / ${pair[1].name}`);
                }
            }
        }
        lines.push('技能书：每通关 +1 本，首通再 +1');
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
            // N193：同时给「格子上」与「面板底部」两处反馈 —— 前者是玩家视线所在，
            // 后者保留给错过淡出（1.2 s）或读屏式的回头查看。
            const text = check.reason === 'tier-gate' && def
                ? `第 ${def.tier} 层需要本线已有 ${talentTierGate(def.tier)} 点`
                : (TALENT_FAIL[check.reason] || '无法加点');
            this._cellToast(node, text);
            this._notice(text);
            return;
        }
        // N185：点完立刻告诉玩家「这次加点换来了什么」，而不是让底部面板数字悄悄跳一格
        const before = talentEffects(save.talents, save.classId);
        spendTalent(save, id);
        const gained = effectDeltaText(before, talentEffects(save.talents, save.classId), 2);
        this._changed();
        this._flash(gained ? `本次加点生效：${gained}` : '本次加点已生效');
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
            return '点击格子加点：行末 → 是下一档收益；每线最多 25 点，第 N 层需本线已有 5×(N−1) 点';
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
        this._hintLabel.color = hex(T.danger);
    }

    /**
     * 试玩 N193（round37r 复核维持 P2）：加点失败的提示原本只写面板底部 `_hintLabel`——
     * 距被点卡片约 360 CSS px、字号约 8 CSS px，玩家点完格子视线还在格子上，等于没反馈。
     * 这里在被点格子正上方（覆盖格子上半）弹一条掉血色的气泡，1.2 s 后淡出。
     * 位置必须跟着格子走（行距 112、格高 104，格与格之间没有空隙，放外面会撞邻格）。
     */
    private _cellToast(cell: Node, text: string): void {
        const parent = cell.parent;
        if (!parent) return;
        this._clearCardToast();
        const node = new Node('TalentCardToast');
        node.layer = this.node.layer;
        node.addComponent(UITransform).setContentSize(TALENT_CELL_W, 60);
        node.setPosition(cell.position.x, cell.position.y, 0);
        parent.addChild(node);
        node.setSiblingIndex(parent.children.length - 1);
        const g = node.addComponent(Graphics);
        g.fillColor = hex('#0A1120', 236);
        g.roundRect(-TALENT_CELL_W / 2 + 8, -30, TALENT_CELL_W - 16, 60, 12);
        g.fill();
        g.strokeColor = hex(T.danger, 235);
        g.lineWidth = 2;
        g.roundRect(-TALENT_CELL_W / 2 + 8, -30, TALENT_CELL_W - 16, 60, 12);
        g.stroke();
        createLabel(node, text, 20, {
            width: TALENT_CELL_W - 40, height: 52, color: T.danger, bold: true, overflow: 'shrink',
        });
        const op = node.addComponent(UIOpacity);
        op.opacity = 255;
        tween(op)
            .delay(1.2)
            .to(0.3, { opacity: 0 })
            .call(() => {
                if (node.isValid) node.destroy();
                if (this._cardToast === node) this._cardToast = null;
            })
            .start();
        this._cardToast = node;
    }

    /** 重建面板 / 关闭前清掉残留气泡（避免 tween 回调打到已销毁节点） */
    private _clearCardToast(): void {
        const node = this._cardToast;
        this._cardToast = null;
        if (!node || !node.isValid) return;
        stopTweens(node);
        node.destroy();
    }

    /** 正向反馈（加点生效）：写在提示行，颜色与错误提示区分开 */
    private _flash(text: string): void {
        if (!this._hintLabel) return;
        this._hintLabel.string = text;
        this._hintLabel.color = hex(T.goldBright);
    }

    /**
     * 某条线当前贡献的面板效果（N185）。做法：把该线的天赋点数清零再算一次
     * `talentEffects`，两次的差就是「这条线现在给你的东西」；没有效果表的职业返回空串。
     */
    private _treeSummary(save: MithrilSave, tree: TalentTree): string {
        const zero: Record<string, number> = { ...(save.talents || {}) };
        let any = false;
        for (const def of talentsOf(save.classId)) {
            if (def.tree === tree) {
                zero[def.id] = 0;
                any = true;
            }
        }
        if (!any) return '';
        return effectDeltaText(talentEffects(zero, save.classId), talentEffects(save.talents, save.classId), 1);
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
        this._cardToast = null;
    }
}
