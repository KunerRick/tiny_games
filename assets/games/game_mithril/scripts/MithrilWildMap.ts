/**
 * 《秘银远征》野外节点图面板 —— 分层节点 + 连线 + 可达高亮 + 区域切换 + 宝箱 / 事件弹窗。
 *
 * 全部节点运行时创建（场景里只挂 GameRoot）。本组件只做展示与点击转发：
 * 走法合法性、补给扣减、奖励发放全在纯逻辑 `MithrilWild.ts` 与主组件里。
 *
 * 约定：onDestroy 只清引用（红线 4）；handler 全部命名方法（红线 5）；
 *       文字不放任何图标字符（红线 10）。
 */

import {
    _decorator, BlockInputEvents, Color, Component, EventTouch, Graphics, Node, UITransform,
} from 'cc';
import {
    COLOR, createButton, createLabel, drawRouteGlyph, hex,
} from '../../../common/ui/GameUIKit';
import type { UiButton } from '../../../common/ui/GameUIKit';
import {
    DUNGEON_BY_ID,
    DUNGEON_SLOT_REC,
    MATERIAL_BY_ID,
    NODE_KIND_NAMES,
    REGION_BY_ID,
    REGIONS,
    SUPPLY_EXHAUST_HP_PCT,
    SUPPLY_PER_RUN,
    WILD_LAYERS,
    dungeonRecMin,
    regionMaterialId,
} from './MithrilConfig';
import type { NodeKind } from './MithrilConfig';
import { REGION_GLYPH, addGlyphNode, repaintGlyphNode } from './MithrilArt';
import { MITH_UI as T } from './MithrilTheme';
import {
    isAdjacent,
    isNodeDone,
    isReachable,
    nodeName,
    onlyForwardIsElite,
} from './MithrilWild';
import type {
    ExpeditionState,
    WildEventChoice,
    WildEventOption,
    WildMap,
    WildNode,
} from './MithrilWild';

const { ccclass } = _decorator;

/** 各节点类型的主色（与战斗 / 大厅图标体系一致） */
/** 节点色按宝石色相压暗一档，避免在夜底上发荧光（第 25 轮 UI） */
export const WILD_NODE_COLORS: Record<NodeKind, string> = {
    // 2026-11-18 第 25 轮（N99）：原先是 Tailwind 荧光色（#5E9BD1 蓝 / #9F6FD9 紫 /
    // #5FB56A 绿 / #C85A5A 红），在石+木+黄铜的底子上像贴上去的贴纸。
    // 统一降饱和到「旧羊皮地图上的颜料」档：色相仍可区分，但不抢描边的黄铜。
    start: '#7A7466',
    battle: '#6E8CA8',
    elite: '#C29A46',
    chest: '#C4A64B',
    event: '#8C6FA8',
    supply: '#6F8F63',
    dungeon: '#A9564F',
    boss: '#C06B33',
};

const NODE_SIZE = 76;
const NODE_R = 26;

/**
 * 触控热区下限（试玩 N163）：44pt ≈ 83 design px（720 设计宽 / 393 CSS 宽）。
 * 只放大节点 UITransform，不改绘制样式 —— 贴图与连线保持原尺寸。
 * 宽度一般不动，避免相邻按钮（横向间隙只有 6–20 px）的热区互相吞。
 */
function padTouchHeight(node: Node, h: number): void {
    const ut = node.getComponent(UITransform);
    if (ut) ut.setContentSize(ut.width, h);
}

// 430 → 410：起点节点的可达光圈半径 r+14 = 40，按 430 时圈顶到 world 1110，
// 会插进区域页签导轨（1097–1139）里 13 px（页签先建、节点后建，圈压在线上面）。
// 下移一层间距的 16%，圈顶回到 1090，页签下方留 7 px 干净边。
const LAYER_TOP = 410;
const LAYER_GAP = 124;

export interface WildMapView {
    map: WildMap;
    expedition: ExpeditionState | null;
    regionId: string;
    playerLevel: number;
    maxHp: number;
    hp: number;
    /** 存档里的材料总量（含本次远征） */
    materials: Record<string, number>;
    cleared: string[];
    /** 已装备槽数（试玩 N142：首领节点要披露「装等是几件平均出来的」） */
    equippedSlots?: number;
    /** 装备槽总数；缺省按 8 */
    slotTotal?: number;
}

export interface ModalButtonSpec {
    label: string;
    fill?: string;
    textColor?: string;
    onTap: () => void;
}

@ccclass('MithrilWildMap')
export class MithrilWildMap extends Component {
    onEnterNode: ((nodeId: number) => void) | null = null;
    onPrimary: (() => void) | null = null;
    onSelectRegion: ((regionId: string) => void) | null = null;
    onOpenGrowth: (() => void) | null = null;
    onOpenCamp: (() => void) | null = null;
    onOpenBag: (() => void) | null = null;
    onExit: (() => void) | null = null;

    private _view: WildMapView | null = null;

    private _title: ReturnType<typeof createLabel> | null = null;
    private _subtitle: ReturnType<typeof createLabel> | null = null;
    private _hpLabel: ReturnType<typeof createLabel> | null = null;
    private _supplyLabel: ReturnType<typeof createLabel> | null = null;
    private _supplyWarn: ReturnType<typeof createLabel> | null = null;
    private _matLabel: ReturnType<typeof createLabel> | null = null;
    private _hint: ReturnType<typeof createLabel> | null = null;

    private _tabs: Array<{ id: string; btn: UiButton }> = [];
    /** 区域页签选中下划线 */
    private _tabMarks: Record<string, Node> = {};
    /** 区域页签图标节点（选中时换成对比墨色，N88） */
    private _tabIcons: Record<string, Node> = {};
    /** 区域页签的补充热区（试玩 N163）：页签本体只有 42 高，向上补一条触控带 */
    private _regionPadIds = new Map<Node, string>();
    private _primaryBtn: UiButton | null = null;

    private _edgeGfx: Graphics | null = null;
    private _nodeLayer: Node | null = null;
    private _nodeIds = new Map<Node, number>();

    private _modal: Node | null = null;

    onLoad(): void {
        this._buildBackground();
        this._buildHeader();
        this._buildTabs();
        this._buildMapLayer();
        this._buildBottom();
    }

    onDestroy(): void {
        this._view = null;
        this._tabs = [];
        this._tabIcons = {};
        this._nodeIds.clear();
        this._regionPadIds.clear();
        this._modal = null;
        this._primaryBtn = null;
    }

    // ==================== 对外 API ====================

    show(): void {
        this.node.active = true;
        this.node.setSiblingIndex(this.node.parent ? this.node.parent.children.length - 1 : 0);
    }

    hide(): void {
        this.closeModal();
        this.node.active = false;
    }

    isOpen(): boolean {
        return this.node.active;
    }

    /**
     * 常驻提示行。`warn` 用于「唯一前进边是精英 / 首领」——把回退方法写成警示色，
     * 避免玩家读成普通说明（试玩 N151）。
     */
    setHint(text: string, warn = false): void {
        if (!this._hint) return;
        this._hint.string = text;
        this._hint.color = hex(warn ? T.warning : T.parchmentDim);
    }

    refresh(view: WildMapView): void {
        // 进行中的远征只对所属区域生效；切到别的区域时按「未出发」显示
        const region = REGION_BY_ID[view.regionId] || REGIONS[0];
        const exp = view.expedition && view.expedition.regionId === region.id ? view.expedition : null;
        this._view = view;
        const matId = regionMaterialId(region.id);
        const matName = MATERIAL_BY_ID[matId] ? MATERIAL_BY_ID[matId].name : matId;
        const total = Math.max(0, Math.floor(view.materials[matId] || 0));
        const run = exp ? Math.max(0, Math.floor(exp.runMaterials[matId] || 0)) : 0;
        const cleared = view.cleared.indexOf(region.id) >= 0;

        if (this._title) {
            this._title.string = `野外 · ${region.name}${cleared ? '（已通关）' : ''}`;
        }
        const first = view.map.nodes[1] || view.map.nodes[0];
        const boss = view.map.nodes[view.map.nodes.length - 1];
        if (this._subtitle) {
            this._subtitle.string = `Lv${region.levelMin}-${region.levelMax} · 节点等级 ${first ? first.level : region.levelMin}-${boss ? boss.level : region.levelMax}`;
        }
        if (this._hpLabel) {
            const hp = Math.max(0, Math.round(exp ? exp.hp : view.hp));
            const maxHp = Math.max(1, Math.round(view.maxHp));
            this._hpLabel.string = `生命 ${hp}/${maxHp}`;
            this._hpLabel.color = hex(hp / maxHp <= 0.3 ? T.danger : T.parchment);
        }
        if (this._supplyLabel) {
            const supply = exp ? exp.supply : SUPPLY_PER_RUN;
            this._supplyLabel.string = `补给 ${supply}/${SUPPLY_PER_RUN}`;
            this._supplyLabel.color = hex(supply > 0 ? T.success : T.warning);
        }
        if (this._supplyWarn) {
            // 补给归零后把「下一脚要扣多少血」直接摆到台面上（试玩 N41 / N45）
            const maxHp = Math.max(1, Math.round(view.maxHp));
            const cost = Math.max(1, Math.round(maxHp * SUPPLY_EXHAUST_HP_PCT));
            const show = !!exp && exp.supply <= 0;
            this._supplyWarn.node.active = show;
            this._supplyWarn.string = show
                ? `补给耗尽：进入每个新节点将失去 ${cost} 生命（8% 生命上限）`
                : '';
        }
        if (this._matLabel) {
            this._matLabel.string = `${matName} ×${total}${exp ? `（本程 ${run}）` : ''}`;
        }

        this._refreshTabs(view);
        this._refreshPrimary(view, region.id, exp);
        this._drawMap(view, exp);
        if (this._hint && !this._hint.string) {
            this._hint.string = this._defaultHint(view, exp);
        }
    }

    /** 打开宝箱前的确认：有陷阱的提示不要提前泄露，只写风险 */
    showChest(
        node: WildNode, enterCost: number, onOpen: () => void, onLeave: () => void,
        extra?: { label: string; onTap: () => void },
    ): void {
        const lines = ['一个被遗弃的箱子，锁扣上还有干涸的血迹。'];
        if (enterCost > 0) lines.push(`补给耗尽：进来这一趟已失去 ${enterCost} 生命。`);
        lines.push('打开有风险（可能触发陷阱），但里面通常有装备。');
        const buttons: ModalButtonSpec[] = [
            { label: '打开', fill: T.gold, textColor: T.ink, onTap: onOpen },
            { label: '离开', fill: T.stonePressed, textColor: T.parchment, onTap: onLeave },
        ];
        // 拾荒者背包：多一个「额外搜刮」按钮，代价由调用方在结算里扣（这里只负责显示）
        if (extra) {
            lines.push('背包里的钩爪还能伸进去一次 —— 代价是生命。');
            buttons.push({ label: extra.label, fill: T.warning, textColor: T.ink, onTap: extra.onTap });
        }
        this.showModal('路边宝箱', lines, buttons);
    }

    showEvent(
        node: WildNode, options: WildEventOption[], enterCost: number,
        onPick: (id: WildEventChoice) => void,
    ): void {
        const lines = ['旅途中遇到一处异样的痕迹。', '你会怎么做？'];
        if (enterCost > 0) lines.push(`补给耗尽：进来这一趟已失去 ${enterCost} 生命。`);
        const buttons: ModalButtonSpec[] = options.map((o) => ({
            label: `${o.label}`,
            fill: o.id === 'dig' ? T.warning : T.gold,
            textColor: T.ink,
            onTap: () => onPick(o.id),
        }));
        this.showModal('路边事件', lines.concat(options.map((o) => `${o.label}：${o.desc}`)), buttons);
    }

    showMessage(title: string, lines: string[], onClose?: () => void): void {
        this.showModal(title, lines, [{
            label: '知道了',
            fill: T.gold,
            textColor: T.ink,
            onTap: onClose || (() => this.closeModal()),
        }]);
    }

    showConfirm(title: string, lines: string[], okLabel: string, onOk: () => void, okFill?: string): void {
        this.showModal(title, lines, [
            { label: okLabel, fill: okFill || T.danger, textColor: T.ink, onTap: onOk },
            { label: '取消', fill: T.stonePressed, textColor: T.parchment, onTap: () => this.closeModal() },
        ]);
    }

    closeModal(): void {
        if (this._modal && this._modal.isValid) this._modal.destroy();
        this._modal = null;
    }

    // ==================== 构建 ====================

    private _buildBackground(): void {
        const bg = new Node('Bg');
        bg.layer = this.node.layer;
        bg.addComponent(UITransform).setContentSize(720, 1280);
        this.node.addChild(bg);
        const g = bg.addComponent(Graphics);
        g.fillColor = hex(T.night, 255);
        g.rect(-360, -640, 720, 1280);
        g.fill();
        // 顶部区域色带：像一条压暗的石带，不再用蓝灰
        g.fillColor = hex(T.stone, 255);
        g.rect(-360, 470, 720, 170);
        g.fill();
        g.fillColor = hex(T.goldLine, 120);
        g.rect(-360, 470, 720, 1.5);
        g.fill();
        g.fillColor = hex(T.stoneDark, 255);
        g.rect(-360, -640, 720, 250);
        g.fill();
        g.fillColor = hex(T.goldLine, 90);
        g.rect(-360, -390, 720, 1.5);
        g.fill();
    }

    private _buildHeader(): void {
        this._title = createLabel(this.node, '野外', 34, {
            width: 680, height: 44, color: T.goldBright, bold: true, y: 596,
        });
        this._subtitle = createLabel(this.node, '', 17, {
            width: 680, height: 26, color: T.parchmentDim, y: 562,
        });
        this._hpLabel = createLabel(this.node, '', 18, {
            width: 220, height: 28, color: T.parchment, bold: true, x: -230, y: 526,
        });
        this._supplyLabel = createLabel(this.node, '', 18, {
            width: 180, height: 28, color: T.success, bold: true, x: -10, y: 526,
        });
        this._matLabel = createLabel(this.node, '', 17, {
            width: 260, height: 28, color: T.warning, x: 190, y: 526,
        });
        // 补给耗尽警告：常态隐藏。图例收进「?」后这条独占原图例那一行（-370），
        // 与上方提示行（-344）保持 26 px 行距，互不压字
        this._supplyWarn = createLabel(this.node, '', 17, {
            width: 680, height: 24, color: T.warning, bold: true, y: -370,
        });
        this._supplyWarn.node.active = false;

        // 「?」操作说明：音效开关左侧的空位（音效占 248–352，标题字形到 ±140）。
        // 一次性 toast 错过就没了，这里可随时重看（体验官 E1 建议③）。
        const help = createButton(this.node, {
            w: 56, h: 44, text: '?', fontSize: 26,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 12, onTap: () => this._onHelpTap(),
        });
        help.node.setPosition(180, 598, 0);
        // 试玩 N163：56×44 的「?」是地图上最小的可点目标；绘制不变，热区撑到 84×84
        const helpUt = help.node.getComponent(UITransform);
        if (helpUt) helpUt.setContentSize(84, 84);
    }

    private _onHelpTap(): void {
        // 地图上原本摊着「5 条图例 + 1 行底部规则 + 1 行 38 字提示」，全是常驻说明。
        // 改成按需：常驻只留一行当下的动作提示，图例与规则都收进这里（用户反馈：字多压力大）。
        this.showMessage('玩法说明', [
            '【操作】',
            '点金色高亮圈进入节点，沿连线推进',
            '左侧拖动移动 · 按住右下普攻 · 技能点按',
            '闪避无前摇可穿身；战斗中点返回会暂停',
            '【图例】',
            '蓝=战斗　金=精英　黄=宝箱　紫=事件　绿=篝火　橙=首领',
            '金圈=可进入 · 蓝圈=已清理可路过 · 白圈=当前',
            '【规则】',
            '退回起点不耗补给；死亡会失去本程材料',
            '补给耗尽后，每进一个新节点失去 8% 生命上限',
        ]);
    }

    private _buildTabs(): void {
        for (let i = 0; i < REGIONS.length; i++) {
            const region = REGIONS[i];
            const btn = createButton(this.node, {
                w: 200, h: 42, text: region.name, fontSize: 19,
                fill: T.stoneLight, textColor: T.parchmentDim,
                activeFill: T.gold, activeTextColor: T.ink,
                stroke: T.goldLine, radius: 12, onTap: () => this._onRegionTap(region.id),
            });
            btn.node.setPosition(-220 + i * 220, 478, 0);
            // 地形图标 + 选中下划线（N76：选中态不能只靠底色）
            const rg = REGION_GLYPH[region.id];
            if (rg) {
                this._tabIcons[region.id] = addGlyphNode(
                    btn.node, `RegionIcon_${region.id}`, rg.kind, 12, rg.color, -72, 0, 45,
                );
            }
            btn.label.node.setPosition(12, 0);
            const ut = btn.label.node.getComponent(UITransform);
            if (ut) ut.setContentSize(200 - 44, 38);
            const mark = new Node(`RegionMark_${region.id}`);
            mark.layer = btn.node.layer;
            mark.addComponent(UITransform).setContentSize(200, 42);
            const mk = mark.addComponent(Graphics);
            mk.fillColor = hex(T.goldBright, 255);
            mk.roundRect(-36, -19, 72, 3, 1.5);
            mk.fill();
            btn.node.addChild(mark);
            // 下划线跟着文字走：文字为给左侧地形图标让位右移了 12，下划线原本居中在按钮里，
            // 于是永远比文字偏左 12（四个页签全中）。整条节点平移同样的 12 即可
            mark.setPosition(12, 0);
            mark.active = false;
            this._tabMarks[region.id] = mark;
            // 试玩 N163：页签视觉仍是 200×42，但补一条同宽 42 高的向上热区带
            // （457–499 → 幽合到 541，合计 ≈84 design px）。向下补会压住地图最上层节点。
            const pad = new Node(`RegionPad_${region.id}`);
            pad.layer = this.node.layer;
            pad.addComponent(UITransform).setContentSize(200, 42);
            pad.setPosition(-220 + i * 220, 478 + 42, 0);
            this.node.addChild(pad);
            this._regionPadIds.set(pad, region.id);
            pad.on(Node.EventType.TOUCH_END, this._onRegionPadTap, this);
            this._tabs.push({ id: region.id, btn });
        }
    }

    private _buildMapLayer(): void {
        const edge = new Node('Edges');
        edge.layer = this.node.layer;
        edge.addComponent(UITransform).setContentSize(720, 1280);
        this.node.addChild(edge);
        this._edgeGfx = edge.addComponent(Graphics);

        const layer = new Node('Nodes');
        layer.layer = this.node.layer;
        layer.addComponent(UITransform).setContentSize(720, 1280);
        this.node.addChild(layer);
        this._nodeLayer = layer;

        // 提示行 -308 → -344：首领三行字（−r−74 那行在 world 314–336）压着旧位置。
        // 图例收进「?」后这一带空出来了，提示行下移 36 px，与首领末行留 6 px 间隙
        this._hint = createLabel(this.node, '', 16, {
            width: 660, height: 24, color: T.parchmentDim, y: -344,
        });
        this._hint.string = '';
    }

    private _buildBottom(): void {
        this._primaryBtn = createButton(this.node, {
            w: 176, h: 64, text: '开始远征', fontSize: 21,
            fill: T.gold, textColor: T.ink, activeFill: T.goldPressed,
            radius: 16, onTap: () => this._onPrimaryTap(),
        });
        this._primaryBtn.node.setPosition(-238, -556, 0);
        // 底部按钮图标（N76）：图标在上、文字在下，按钮不再只是一块色
        addGlyphNode(this._primaryBtn.node, 'PrimaryIcon', 'growth', 12, T.ink, -58, 0, 70);
        this._primaryBtn.label.node.setPosition(16, 0);
        const pUt = this._primaryBtn.label.node.getComponent(UITransform);
        if (pUt) pUt.setContentSize(176 - 46, 60);

        // M5 起这一行放 5 个按钮：开始远征 + 营地 / 成长 / 装备 / 返回大厅
        // N99：四个次级按钮改成同一套石底，身份只由图标色承担 —— 原先「青 / 棕 / 紫」三种
        // 满饱和填充并排，就是用户说的「配色有点奇怪」最集中的地方。
        const camp = createButton(this.node, {
            w: 104, h: 64, text: '营地', fontSize: 18,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 16, stroke: T.goldLine, onTap: () => { if (this.onOpenCamp) this.onOpenCamp(); },
        });
        camp.node.setPosition(-88, -556, 0);
        this._bottomIcon(camp, 'camp', '#7FA6A0');

        const grow = createButton(this.node, {
            w: 104, h: 64, text: '成长', fontSize: 18,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 16, stroke: T.goldLine, onTap: () => { if (this.onOpenGrowth) this.onOpenGrowth(); },
        });
        grow.node.setPosition(22, -556, 0);
        this._bottomIcon(grow, 'growth', T.goldBright);

        const bag = createButton(this.node, {
            w: 104, h: 64, text: '装备', fontSize: 18,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 16, stroke: T.goldLine, onTap: () => { if (this.onOpenBag) this.onOpenBag(); },
        });
        bag.node.setPosition(132, -556, 0);
        this._bottomIcon(bag, 'bag', '#A392B5');

        const exit = createButton(this.node, {
            w: 112, h: 64, text: '返回大厅', fontSize: 17,
            fill: T.stoneLight, textColor: T.parchmentDim, activeFill: T.stonePressed,
            radius: 16, stroke: T.goldLine, onTap: () => { if (this.onExit) this.onExit(); },
        });
        exit.node.setPosition(244, -556, 0);
        this._bottomIcon(exit, 'exit', T.parchmentDim);

        // 试玩 N163：底栏五颗按钮视觉保持 64 高，热区统一撑到 84（≈44pt）。
        // 横向间隙只有 6–20 px，宽度一律不动，以免相邻按钮的热区互相吞。
        padTouchHeight(this._primaryBtn.node, 84);
        for (const b of [camp, grow, bag, exit]) padTouchHeight(b.node, 84);

        // 底栏上方那行「已清理节点可路过 · 死亡失去本程材料」已并入「?」的【规则】：
        // 它是常驻却低频的信息，留在主视觉里只会把 12 个节点挤窄
    }

    /** 底部方按钮：图标在上（y=14）、文字压到下半（y=-14） */
    private _bottomIcon(btn: UiButton, kind: string, color: string): void {
        addGlyphNode(btn.node, `BottomIcon_${kind}`, kind, 12, color, 0, 15, 55);
        btn.label.node.setPosition(0, -15);
        const ut = btn.label.node.getComponent(UITransform);
        if (ut) ut.setContentSize(100, 26);
    }

    // ==================== 刷新 ====================

    private _refreshTabs(view: WildMapView): void {
        for (const tab of this._tabs) {
            const region = REGION_BY_ID[tab.id];
            const unlocked = view.playerLevel >= region.levelMin;
            const active = tab.id === view.regionId;
            const cleared = view.cleared.indexOf(tab.id) >= 0;
            // 已通关不能只靠变绿表达（试玩 N47）：直接写进页签文字
            tab.btn.setText(!unlocked
                ? `${region.name} Lv${region.levelMin}`
                : (cleared ? `${region.name}·已通关` : region.name));
            tab.btn.setActive(active);
            // 选中底是主题蓝：图标 / 下划线换对比墨色，否则同色系图形会整块消失（N88）
            const rg = REGION_GLYPH[tab.id];
            if (rg) {
                repaintGlyphNode(
                    this._tabIcons[tab.id] || null, rg.kind, 12,
                    active ? T.ink : (unlocked ? rg.color : T.parchmentMuted),
                    active ? 70 : 45,
                );
            }
            const mark = this._tabMarks[tab.id];
            if (mark && mark.isValid) {
                mark.active = active;
                const mg = mark.getComponent(Graphics);
                if (mg) {
                    mg.clear();
                    mg.fillColor = hex(T.ink, 255);
                    mg.roundRect(-36, -19, 72, 3, 1.5);
                    mg.fill();
                }
            }
            if (!active) {
                // setActive(false) 已恢复到默认配色，这里按「未解锁 / 已通关」再压一层
                tab.btn.setColor(
                    unlocked ? T.stoneLight : T.stoneDark,
                    !unlocked ? T.parchmentDim : cleared ? T.success : T.parchmentDim,
                );
            }
        }
    }

    private _refreshPrimary(view: WildMapView, regionId: string, exp: ExpeditionState | null): void {
        const btn = this._primaryBtn;
        if (!btn) return;
        const region = REGION_BY_ID[regionId];
        const unlocked = view.playerLevel >= region.levelMin;
        if (exp) {
            btn.setText('放弃远征');
            btn.setColor(T.danger, T.ink);
        } else if (!unlocked) {
            btn.setText(`Lv${region.levelMin} 解锁`);
            btn.setColor(T.stoneDark, T.parchmentDim);
        } else {
            btn.setText('开始远征');
            btn.setColor(T.gold, T.ink);
        }
    }

    private _drawMap(view: WildMapView, exp: ExpeditionState | null): void {
        const layer = this._nodeLayer;
        if (!layer) return;
        layer.destroyAllChildren();
        this._nodeIds.clear();

        const positions = new Map<number, { x: number; y: number }>();
        for (const node of view.map.nodes) positions.set(node.id, this._posOf(node));
        this._drawEdges(view, exp, positions);
        for (const node of view.map.nodes) this._drawNode(view, exp, node, positions.get(node.id)!);
    }

    private _posOf(node: WildNode): { x: number; y: number } {
        const count = WILD_LAYERS[node.layer] || 1;
        let xs: number[];
        if (count <= 1) xs = [0];
        else if (count === 2) xs = [-110, 110];
        else xs = [-220, 0, 220];
        return { x: xs[node.col] !== undefined ? xs[node.col] : 0, y: LAYER_TOP - node.layer * LAYER_GAP };
    }

    private _drawEdges(view: WildMapView, exp: ExpeditionState | null, positions: Map<number, { x: number; y: number }>): void {
        const g = this._edgeGfx;
        if (!g) return;
        g.clear();
        const drawn = new Set<string>();
        for (const node of view.map.nodes) {
            const a = positions.get(node.id);
            if (!a) continue;
            for (const otherId of node.links) {
                const key = node.id < otherId ? `${node.id}|${otherId}` : `${otherId}|${node.id}`;
                if (drawn.has(key)) continue;
                drawn.add(key);
                const b = positions.get(otherId);
                if (!b) continue;
                const reachable = !!exp && isReachable(view.map, exp, otherId) && node.id === exp.pos;
                const reachableBack = !!exp && isReachable(view.map, exp, node.id) && otherId === exp.pos;
                const visited = !!exp && (exp.visited.indexOf(node.id) >= 0 || exp.visited.indexOf(otherId) >= 0);
                const color = reachable || reachableBack
                    ? hex(T.goldBright, 200)
                    : hex(visited ? '#4A4234' : '#232833', 200);
                this._fillLine(g, a.x, a.y, b.x, b.y, reachable || reachableBack ? 4 : 2.5, color);
            }
        }
    }

    private _drawNode(view: WildMapView, exp: ExpeditionState | null, node: WildNode, pos: { x: number; y: number }): void {
        const layer = this._nodeLayer;
        if (!layer) return;
        const done = isNodeDone(exp, node.id);
        const current = !!exp && exp.pos === node.id;
        const reachable = !!exp && isReachable(view.map, exp, node.id);
        // 可路过 / 可回起点：已清理的相邻节点、以及远距离可点的起点（蓝圈，区别于金色高亮圈=有内容）
        const transit = !!exp && !current && (
            node.kind === 'start' || (done && isAdjacent(view.map, exp, node.id))
        );
        const boss = node.kind === 'boss';
        const r = boss ? NODE_R + 5 : NODE_R;

        const holder = new Node(`Wild_${node.id}`);
        holder.layer = this.node.layer;
        holder.addComponent(UITransform).setContentSize(NODE_SIZE + 8, NODE_SIZE + 8);
        holder.setPosition(pos.x, pos.y, 0);
        layer.addChild(holder);
        this._nodeIds.set(holder, node.id);

        const g = holder.addComponent(Graphics);
        const color = WILD_NODE_COLORS[node.kind] || T.parchmentMuted;

        // 外圈光晕：可达 = 黄铜，当前 = 纸白，首领 = 橙
        if (reachable) {
            g.fillColor = hex(T.goldBright, 40);
            g.circle(0, 0, r + 14);
            g.fill();
            g.strokeColor = hex(T.goldBright, 255);
            g.lineWidth = 4;
            g.circle(0, 0, r + 8);
            g.stroke();
        } else if (current) {
            g.fillColor = hex('#FFFFFF', 28);
            g.circle(0, 0, r + 14);
            g.fill();
            g.strokeColor = hex(T.parchment, 255);
            g.lineWidth = 4;
            g.circle(0, 0, r + 8);
            g.stroke();
        } else if (transit) {
            g.strokeColor = hex(T.goldDim, 220);
            g.lineWidth = 2.5;
            g.circle(0, 0, r + 7);
            g.stroke();
        } else if (boss) {
            g.fillColor = hex(color, 30);
            g.circle(0, 0, r + 12);
            g.fill();
        }

        g.fillColor = hex(done ? T.stonePressed : color, done ? 170 : 235);
        g.circle(0, 0, r);
        g.fill();
        g.strokeColor = hex(done ? T.goldLine : T.parchment, done ? 200 : 235);
        g.lineWidth = 2.5;
        g.circle(0, 0, r);
        g.stroke();

        this._drawGlyph(g, node.kind, r, done ? T.parchmentMuted : T.parchment, boss);

        if (done) {
            // 已清理的小勾用祖母绿而不是荧光绿（N99）
            g.fillColor = hex(T.emerald, 255);
            g.circle(r * 0.72, r * 0.72, 7);
            g.fill();
        }

        const name = nodeName(node);
        // 试玩 N178：节点名 13 design px ≈ 6.9 CSS px，是地图上最常读的一行。抬到 16，
        // 名字 / 等级 / 槽数三行同步下移，行距按 16 号字重排（见下两处 y）。
        const nameLabel = createLabel(holder, name, 16, {
            width: 120, height: 22, color: done ? T.parchmentMuted : T.parchment,
            bold: boss, y: -r - 18,
        });
        // 试玩 N153：名字 / 等级 / 槽数此前是死区 —— 玩家点文字没有任何反应，
        // 只有 84×84 的圆圈生效。把这两行也接进同一个点击入口。
        this._bindNodeHit(nameLabel.node, node.id);
        // 副本标签写「装等 1-10」而不是节点层数 Lv：两座副本都落在第 4 层，
        // 旧的「都写 Lv8」掩盖了 1–10 / 10–16 的真实强度差（体验官 E2）
        const dg = node.kind === 'dungeon' && node.dungeonId ? DUNGEON_BY_ID[node.dungeonId] : null;
        // 区域首领也标推荐装等：Lv{层数} 看不出强度，玩家在 ilvl 7 就点进 3536 血首领（试玩 N69）
        // 试玩 N189（round38）：副本副标不再写区间「装等 1-10」——区间会被读成官方许可，
        // 与确认卡的点估计「建议 平均装等 ≥8 · ≥3/8 槽」自相矛盾。改与确认卡同口径，
        // 口径源统一为 `dungeonRecMin()`，别再手抄第二个下界。
        const subLabel = dg
            ? `建议 ≥${dungeonRecMin(dg)} · ≥${DUNGEON_SLOT_REC} 槽`
            : boss ? `推荐装等 ${node.ilvl}` : `Lv${node.level}`;
        // 试玩 N178：11 design px ≈ 5.8 CSS px，手机上前路信息要凑近看。抬到 16
        // （=8.5 CSS px），标签盒同步加宽到 130；同层节点最小横向间距 219 design px，不会蹭到邻格。
        // 试玩 N183：三行 16/16/14 号字的包围盒相邻处只剩 ≈3 design px，
        // 微信字体度量与桌面不同，真机可能贴边。中心距统一抬到 28（46 / 74）：
        // 16 号字行高 25.2，包围盒之间留 2.8 / 4.0 design px。
        const sub = createLabel(holder, subLabel, 16, {
            // N189：副标从「装等 1-10」改成「建议 ≥8 · ≥3 槽」，字数变多，标签盒 130 → 180；
            // 同层节点最小横向间距 219 design px，两盒之间仍留 39 px，不会蹭到邻格。
            width: 180, height: 22, color: T.parchmentDim, y: -r - 46, overflow: 'shrink',
        });
        this._bindNodeHit(sub.node, node.id);
        // 试玩 N142：「平均装等」只对已装备槽求平均，2 件高装等会显示成 18.0，
        // 玩家拿它和「推荐装等 12」直接比就会误判。首领节点把槽数同屏写出来。
        // 首领固定在最后一层（layer 5），下方没有节点，这一行不会撞到别的东西。
        if (boss && view.equippedSlots !== undefined) {
            // 试玩 N178：10 → 14；同时下移到 −r−56，避开加高后的装等行
            const slots = createLabel(holder, `已装备 ${view.equippedSlots}/${view.slotTotal || 8} 槽`, 14, {
                width: 140, height: 20, color: T.parchmentDim, y: -r - 74,
            });
            this._bindNodeHit(slots.node, node.id);
        }

        holder.on(Node.EventType.TOUCH_END, this.onNodeTap, this);
    }

    /** 把文字节点也注册成节点点击区（试玩 N153）；TOUCH_END 会冒泡，onNodeTap 里去重 */
    private _bindNodeHit(labelNode: Node, nodeId: number): void {
        this._nodeIds.set(labelNode, nodeId);
        labelNode.on(Node.EventType.TOUCH_END, this.onNodeTap, this);
    }

    private _drawGlyph(g: Graphics, kind: NodeKind, r: number, color: string, boss: boolean): void {
        const size = boss ? r * 0.92 : r * 0.8;
        if (kind === 'battle' || kind === 'elite' || kind === 'event' || kind === 'boss') {
            drawRouteGlyph(g, kind, size, color);
            return;
        }
        const fill = hex(color, 255);
        if (kind === 'start') {
            g.fillColor = fill;
            g.moveTo(0, size * 0.62);
            g.lineTo(size * 0.58, -size * 0.2);
            g.lineTo(size * 0.2, -size * 0.2);
            g.lineTo(size * 0.2, -size * 0.6);
            g.lineTo(-size * 0.2, -size * 0.6);
            g.lineTo(-size * 0.2, -size * 0.2);
            g.lineTo(-size * 0.58, -size * 0.2);
            g.close();
            g.fill();
            return;
        }
        if (kind === 'chest') {
            g.fillColor = fill;
            g.roundRect(-size * 0.62, -size * 0.46, size * 1.24, size * 0.86, 3);
            g.fill();
            g.fillColor = hex('#000000', 90);
            g.rect(-size * 0.62, -size * 0.02, size * 1.24, size * 0.1);
            g.fill();
            return;
        }
        if (kind === 'supply') {
            g.fillColor = fill;
            g.rect(-size * 0.16, -size * 0.6, size * 0.32, size * 1.2);
            g.fill();
            g.rect(-size * 0.6, -size * 0.16, size * 1.2, size * 0.32);
            g.fill();
            return;
        }
        // dungeon：拱门
        g.fillColor = fill;
        g.moveTo(-size * 0.55, -size * 0.6);
        g.lineTo(-size * 0.55, size * 0.1);
        g.arc(0, size * 0.1, size * 0.55, Math.PI, 0, true);
        g.lineTo(size * 0.55, -size * 0.6);
        g.close();
        g.fill();
        g.fillColor = hex(T.night, 235);
        g.moveTo(-size * 0.28, -size * 0.6);
        g.lineTo(-size * 0.28, size * 0.1);
        g.arc(0, size * 0.1, size * 0.28, Math.PI, 0, true);
        g.lineTo(size * 0.28, -size * 0.6);
        g.close();
        g.fill();
    }

    private _fillLine(g: Graphics, x1: number, y1: number, x2: number, y2: number, w: number, color: Color): void {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len < 1) return;
        const nx = (-dy / len) * (w / 2);
        const ny = (dx / len) * (w / 2);
        g.fillColor = color;
        g.moveTo(x1 + nx, y1 + ny);
        g.lineTo(x2 + nx, y2 + ny);
        g.lineTo(x2 - nx, y2 - ny);
        g.lineTo(x1 - nx, y1 - ny);
        g.close();
        g.fill();
    }

    private _defaultHint(view: WildMapView, exp: ExpeditionState | null): string {
        if (!exp) {
            if (view.playerLevel < (REGION_BY_ID[view.regionId] || REGIONS[0]).levelMin) {
                return `等级不足：${view.regionId} 需要 Lv${(REGION_BY_ID[view.regionId] || REGIONS[0]).levelMin}`;
            }
            return '点「开始远征」，沿金色连线选下一站';
        }
        if (exp.complete) return '本次远征已结束';
        if (exp.pos !== 0 && exp.done.indexOf(exp.pos) < 0) return '上一个节点没结算：点白圈继续';
        // 试玩 N151：唯一前进边是精英 / 首领时，把「退回起点换支路且免费」直接写出来。
        // N157：首领也算「危险前进边」，文案不能再只说「精英」。
        if (onlyForwardIsElite(view.map, exp)) {
            return '前方只有精英或首领：点蓝圈退回起点换支路（不耗补给）';
        }
        return '点金圈继续 · 蓝圈回已清理节点';
    }

    // ==================== 交互 ====================

    private _onRegionTap(regionId: string): void {
        if (this.onSelectRegion) this.onSelectRegion(regionId);
    }

    /** 页签补充热区（试玩 N163）：与页签本体同一动作，靠 map 取区域 id */
    private _onRegionPadTap(ev: EventTouch): void {
        const id = this._regionPadIds.get(ev.target as Node);
        if (id) this._onRegionTap(id);
    }

    private _onPrimaryTap(): void {
        if (this.onPrimary) this.onPrimary();
    }

    private onNodeTap(ev: EventTouch): void {
        // 文字节点与圆圈是父子关系，TOUCH_END 会从文字冒泡到 holder：
        // 只处理真正被点中的那一个，否则一次点击会进两次节点（试玩 N153）。
        if (ev.target !== ev.currentTarget) return;
        const node = ev.currentTarget as Node;
        const id = this._nodeIds.get(node);
        if (id === undefined) return;
        if (this.onEnterNode) this.onEnterNode(id);
    }

    // ==================== 弹窗 ====================

    private showModal(title: string, lines: string[], buttons: ModalButtonSpec[]): void {
        this.closeModal();
        const root = new Node('WildModal');
        root.layer = this.node.layer;
        root.addComponent(UITransform).setContentSize(720, 1280);
        this.node.addChild(root);
        this._modal = root;

        const mask = new Node('Mask');
        mask.layer = this.node.layer;
        mask.addComponent(UITransform).setContentSize(720, 1280);
        const mg = mask.addComponent(Graphics);
        mg.fillColor = hex(COLOR.BG_OVERLAY, 235);
        mg.rect(-360, -640, 720, 1280);
        mg.fill();
        mask.addComponent(BlockInputEvents);
        root.addChild(mask);

        const panelW = 580;
        // 高度按行数自适应：帮助页（10 行）比宝箱确认卡（3–5 行）需要更多版面，
        // 固定 380 会把正文压成 13 号字（overflow shrink），反而更难读
        const panelH = Math.max(380, 200 + lines.length * 25);
        const panel = new Node('Panel');
        panel.layer = this.node.layer;
        panel.addComponent(UITransform).setContentSize(panelW, panelH);
        const pg = panel.addComponent(Graphics);
        pg.fillColor = hex(T.stone, 255);
        pg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24);
        pg.fill();
        pg.strokeColor = hex(T.goldDim, 255);
        pg.lineWidth = 3;
        pg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24);
        pg.stroke();
        // 内侧再来一道细金线，和营地面板的「双线铜边」同一语言
        pg.strokeColor = hex(T.gold, 70);
        pg.lineWidth = 1;
        pg.roundRect(-panelW / 2 + 9, -panelH / 2 + 9, panelW - 18, panelH - 18, 18);
        pg.stroke();
        root.addChild(panel);

        const titleY = panelH / 2 - 42;
        createLabel(panel, title, 30, {
            width: panelW - 60, height: 40, color: T.goldBright, bold: true, y: titleY,
        });
        const textH = lines.length * 25 + 8;
        // 正文摆在「标题底」和「按钮顶」的中点：两者都贴着面板上下边，
        // 所以这段空带的中点恒为 11.5（= ((H/2−62) + (−H/2+85)) / 2），与行数无关。
        // 短确认卡（3 行）与帮助页（10 行）都不会一头贴标题、一头悬在按钮上方
        createLabel(panel, lines.join('\n'), 17, {
            // 左对齐：条目是「【段名】+ 若干短句」，居中时每行起止位置都不同，读起来像打散的碎片。
            // align:'left' 必须配 overflow:'shrink'，否则会缩到内容宽度再按中心摆（N89）
            width: panelW - 64, height: textH, color: T.parchmentDim,
            y: 12, lineHeight: 25, align: 'left', overflow: 'shrink',
        });

        const n = Math.max(1, buttons.length);
        const bw = n >= 3 ? 160 : 170;
        for (let i = 0; i < n; i++) {
            const spec = buttons[i];
            const btn = createButton(panel, {
                w: bw, h: 56, text: spec.label, fontSize: 21,
                fill: spec.fill || T.gold, textColor: spec.textColor || T.ink,
                activeFill: T.goldPressed, radius: 14,
                onTap: () => {
                    this.closeModal();
                    spec.onTap();
                },
            });
            const step = n >= 3 ? 180 : 190;
            btn.node.setPosition((i - (n - 1) / 2) * step, -panelH / 2 + 58, 0);
        }

        root.setSiblingIndex(this.node.children.length - 1);
    }
}
