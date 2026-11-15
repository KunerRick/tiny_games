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
    MATERIAL_BY_ID,
    NODE_KIND_NAMES,
    REGION_BY_ID,
    REGIONS,
    SUPPLY_EXHAUST_HP_PCT,
    SUPPLY_PER_RUN,
    WILD_LAYERS,
    regionMaterialId,
} from './MithrilConfig';
import type { NodeKind } from './MithrilConfig';
import {
    isAdjacent,
    isNodeDone,
    isReachable,
    nodeName,
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
export const WILD_NODE_COLORS: Record<NodeKind, string> = {
    start: '#64748B',
    battle: '#38BDF8',
    elite: '#F59E0B',
    chest: '#EAB308',
    event: '#A855F7',
    supply: '#22C55E',
    dungeon: '#EF4444',
    boss: '#F97316',
};

const NODE_SIZE = 76;
const NODE_R = 26;

const LAYER_TOP = 430;
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
        this._buildLegend();
        this._buildBottom();
    }

    onDestroy(): void {
        this._view = null;
        this._tabs = [];
        this._nodeIds.clear();
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

    setHint(text: string): void {
        if (this._hint) this._hint.string = text;
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
            this._hpLabel.color = hex(hp / maxHp <= 0.3 ? COLOR.DANGER : COLOR.TEXT_PRIMARY);
        }
        if (this._supplyLabel) {
            const supply = exp ? exp.supply : SUPPLY_PER_RUN;
            this._supplyLabel.string = `补给 ${supply}/${SUPPLY_PER_RUN}`;
            this._supplyLabel.color = hex(supply > 0 ? COLOR.SUCCESS : COLOR.WARNING);
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
    showChest(node: WildNode, enterCost: number, onOpen: () => void, onLeave: () => void): void {
        const lines = ['一个被遗弃的箱子，锁扣上还有干涸的血迹。'];
        if (enterCost > 0) lines.push(`补给耗尽：进来这一趟已失去 ${enterCost} 生命。`);
        lines.push('打开有风险（可能触发陷阱），但里面通常有装备。');
        this.showModal('路边宝箱', lines, [
            { label: '打开', fill: COLOR.PRIMARY, onTap: onOpen },
            { label: '离开', fill: '#334155', onTap: onLeave },
        ]);
    }

    showEvent(
        node: WildNode, options: WildEventOption[], enterCost: number,
        onPick: (id: WildEventChoice) => void,
    ): void {
        const lines = ['旅途中遇到一处异样的痕迹。', '你会怎么做？'];
        if (enterCost > 0) lines.push(`补给耗尽：进来这一趟已失去 ${enterCost} 生命。`);
        const buttons: ModalButtonSpec[] = options.map((o) => ({
            label: `${o.label}`,
            fill: o.id === 'dig' ? COLOR.WARNING : COLOR.PRIMARY,
            onTap: () => onPick(o.id),
        }));
        this.showModal('路边事件', lines.concat(options.map((o) => `${o.label}：${o.desc}`)), buttons);
    }

    showMessage(title: string, lines: string[], onClose?: () => void): void {
        this.showModal(title, lines, [{
            label: '知道了',
            fill: COLOR.PRIMARY,
            onTap: onClose || (() => this.closeModal()),
        }]);
    }

    showConfirm(title: string, lines: string[], okLabel: string, onOk: () => void): void {
        this.showModal(title, lines, [
            { label: okLabel, fill: COLOR.DANGER, onTap: onOk },
            { label: '取消', fill: '#334155', onTap: () => this.closeModal() },
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
        g.fillColor = hex('#0B1220', 255);
        g.rect(-360, -640, 720, 1280);
        g.fill();
        // 顶部区域色带：让三个区域一眼能区分
        g.fillColor = hex('#1E293B', 255);
        g.rect(-360, 470, 720, 170);
        g.fill();
        g.fillColor = hex('#0F172A', 255);
        g.rect(-360, -640, 720, 250);
        g.fill();
    }

    private _buildHeader(): void {
        this._title = createLabel(this.node, '野外', 34, {
            width: 680, height: 44, color: COLOR.TEXT_PRIMARY, bold: true, y: 596,
        });
        this._subtitle = createLabel(this.node, '', 17, {
            width: 680, height: 26, color: COLOR.TEXT_SECONDARY, y: 562,
        });
        this._hpLabel = createLabel(this.node, '', 18, {
            width: 220, height: 28, color: COLOR.TEXT_PRIMARY, bold: true, x: -230, y: 526,
        });
        this._supplyLabel = createLabel(this.node, '', 18, {
            width: 180, height: 28, color: COLOR.SUCCESS, bold: true, x: -10, y: 526,
        });
        this._matLabel = createLabel(this.node, '', 17, {
            width: 260, height: 28, color: COLOR.WARNING, x: 190, y: 526,
        });
        // 补给耗尽警告：常态隐藏。顶栏与页签之间没有空档（页签 y478 高 42），
        // 所以放在地图说明行正下方，图例整体让位（试玩 N41 / N45）
        this._supplyWarn = createLabel(this.node, '', 17, {
            width: 680, height: 24, color: COLOR.WARNING, bold: true, y: -334,
        });
        this._supplyWarn.node.active = false;
    }

    private _buildTabs(): void {
        for (let i = 0; i < REGIONS.length; i++) {
            const region = REGIONS[i];
            const btn = createButton(this.node, {
                w: 200, h: 42, text: region.name, fontSize: 19,
                fill: '#1E293B', textColor: COLOR.TEXT_SECONDARY,
                activeFill: COLOR.PRIMARY, activeTextColor: '#FFFFFF',
                stroke: '#334155', radius: 12, onTap: () => this._onRegionTap(region.id),
            });
            btn.node.setPosition(-220 + i * 220, 478, 0);
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

        this._hint = createLabel(this.node, '', 16, {
            width: 660, height: 24, color: COLOR.TEXT_SECONDARY, y: -292,
        });
        this._hint.string = '';
    }

    private _buildLegend(): void {
        const entries: Array<{ kind: NodeKind; label: string }> = [
            { kind: 'battle', label: '战斗' },
            { kind: 'elite', label: '精英' },
            { kind: 'chest', label: '宝箱' },
            { kind: 'event', label: '事件' },
            { kind: 'supply', label: '篝火' },
            { kind: 'dungeon', label: '副本' },
            { kind: 'boss', label: '首领' },
        ];
        for (let i = 0; i < entries.length; i++) {
            const row = i < 4 ? 0 : 1;
            const col = i < 4 ? i : i - 4;
            // 两行共用同一列网格（第二行左对齐），否则 3 项那行会整体右移 70px（试玩 N46）
            const x = -240 + col * 140;
            const y = -382 - row * 34;
            const dot = new Node(`Legend_${entries[i].kind}`);
            dot.layer = this.node.layer;
            dot.addComponent(UITransform).setContentSize(18, 18);
            dot.setPosition(x - 34, y, 0);
            this.node.addChild(dot);
            const g = dot.addComponent(Graphics);
            g.fillColor = hex(WILD_NODE_COLORS[entries[i].kind], 235);
            g.circle(0, 0, 6);
            g.fill();
            createLabel(this.node, entries[i].label, 15, {
                width: 80, height: 22, color: COLOR.TEXT_SECONDARY, x: x + 10, y,
            });
        }
    }

    private _buildBottom(): void {
        this._primaryBtn = createButton(this.node, {
            w: 180, h: 64, text: '开始远征', fontSize: 22,
            fill: COLOR.PRIMARY, textColor: '#FFFFFF', activeFill: COLOR.PRIMARY_DARK,
            radius: 16, onTap: () => this._onPrimaryTap(),
        });
        this._primaryBtn.node.setPosition(-190, -556, 0);

        const grow = createButton(this.node, {
            w: 130, h: 64, text: '成长', fontSize: 21,
            fill: '#B45309', textColor: '#FFFFFF', activeFill: '#92400E',
            radius: 16, onTap: () => { if (this.onOpenGrowth) this.onOpenGrowth(); },
        });
        grow.node.setPosition(-32, -556, 0);

        const bag = createButton(this.node, {
            w: 130, h: 64, text: '装备', fontSize: 21,
            fill: '#A855F7', textColor: '#FFFFFF', activeFill: '#7E3AF2',
            radius: 16, onTap: () => { if (this.onOpenBag) this.onOpenBag(); },
        });
        bag.node.setPosition(110, -556, 0);

        const exit = createButton(this.node, {
            w: 130, h: 64, text: '返回大厅', fontSize: 21,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 16, onTap: () => { if (this.onExit) this.onExit(); },
        });
        exit.node.setPosition(252, -556, 0);

        // 这行是全游戏唯一解释 8% 规则的地方，字号 / 对比度不能再往低调（试玩 N45）
        createLabel(this.node, '补给耗尽后每新节点 −8% 生命 · 已清理节点可路过 · 死亡失去本程材料', 16, {
            width: 690, height: 24, color: COLOR.TEXT_SECONDARY, y: -614,
        });
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
            if (!active) {
                // setActive(false) 已恢复到默认配色，这里按「未解锁 / 已通关」再压一层
                tab.btn.setColor(
                    unlocked ? '#1E293B' : '#141A24',
                    !unlocked ? COLOR.TEXT_DISABLED : cleared ? COLOR.SUCCESS : COLOR.TEXT_SECONDARY,
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
            btn.setColor(COLOR.DANGER, '#FFFFFF');
        } else if (!unlocked) {
            btn.setText(`Lv${region.levelMin} 解锁`);
            btn.setColor(COLOR.PRIMARY_DISABLED, COLOR.TEXT_DISABLED);
        } else {
            btn.setText('开始远征');
            btn.setColor(COLOR.PRIMARY, '#FFFFFF');
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
                    ? hex(COLOR.SUCCESS, 200)
                    : hex(visited ? '#3A4658' : '#2A3342', 200);
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
        // 可路过 / 可回起点：已清理的相邻节点、以及远距离可点的起点（蓝圈，区别于绿圈=有内容）
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
        const color = WILD_NODE_COLORS[node.kind] || '#64748B';

        // 外圈光晕：可达 = 绿，当前 = 白，首领 = 橙
        if (reachable) {
            g.fillColor = hex(COLOR.SUCCESS, 40);
            g.circle(0, 0, r + 14);
            g.fill();
            g.strokeColor = hex(COLOR.SUCCESS, 255);
            g.lineWidth = 4;
            g.circle(0, 0, r + 8);
            g.stroke();
        } else if (current) {
            g.fillColor = hex('#FFFFFF', 28);
            g.circle(0, 0, r + 14);
            g.fill();
            g.strokeColor = hex('#FFFFFF', 255);
            g.lineWidth = 4;
            g.circle(0, 0, r + 8);
            g.stroke();
        } else if (transit) {
            g.strokeColor = hex(COLOR.PRIMARY, 220);
            g.lineWidth = 2.5;
            g.circle(0, 0, r + 7);
            g.stroke();
        } else if (boss) {
            g.fillColor = hex(color, 30);
            g.circle(0, 0, r + 12);
            g.fill();
        }

        g.fillColor = hex(done ? '#334155' : color, done ? 170 : 235);
        g.circle(0, 0, r);
        g.fill();
        g.strokeColor = hex(done ? '#475569' : '#FFFFFF', done ? 160 : 235);
        g.lineWidth = 2.5;
        g.circle(0, 0, r);
        g.stroke();

        this._drawGlyph(g, node.kind, r, done ? '#94A3B8' : '#FFFFFF', boss);

        if (done) {
            g.fillColor = hex(COLOR.SUCCESS, 255);
            g.circle(r * 0.72, r * 0.72, 7);
            g.fill();
        }

        const name = nodeName(node);
        createLabel(holder, name, boss ? 14 : 13, {
            width: 110, height: 20, color: done ? COLOR.TEXT_DISABLED : COLOR.TEXT_PRIMARY,
            bold: boss, y: -r - 16,
        });
        createLabel(holder, `Lv${node.level}`, 11, {
            width: 80, height: 18, color: COLOR.TEXT_SECONDARY, y: -r - 34,
        });

        holder.on(Node.EventType.TOUCH_END, this.onNodeTap, this);
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
        g.fillColor = hex('#0B1220', 235);
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
            return '点「开始远征」后，沿绿色连线选择下一站';
        }
        if (exp.complete) return '本次远征已结束';
        if (exp.pos !== 0 && exp.done.indexOf(exp.pos) < 0) return '上一次的节点还没结算：点白圈继续';
        return '绿圈进新节点 · 蓝圈可路过已清理节点 · 起点随时可回';
    }

    // ==================== 交互 ====================

    private _onRegionTap(regionId: string): void {
        if (this.onSelectRegion) this.onSelectRegion(regionId);
    }

    private _onPrimaryTap(): void {
        if (this.onPrimary) this.onPrimary();
    }

    private onNodeTap(ev: EventTouch): void {
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
        const panelH = 380;
        const panel = new Node('Panel');
        panel.layer = this.node.layer;
        panel.addComponent(UITransform).setContentSize(panelW, panelH);
        const pg = panel.addComponent(Graphics);
        pg.fillColor = hex(COLOR.PANEL_BG, 255);
        pg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24);
        pg.fill();
        pg.strokeColor = hex(COLOR.PANEL_BORDER, 255);
        pg.lineWidth = 3;
        pg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 24);
        pg.stroke();
        root.addChild(panel);

        createLabel(panel, title, 30, {
            width: panelW - 60, height: 40, color: COLOR.TEXT_PRIMARY, bold: true, y: 148,
        });
        createLabel(panel, lines.join('\n'), 17, {
            width: panelW - 64, height: 210, color: COLOR.TEXT_SECONDARY, y: 24, lineHeight: 25,
        });

        const n = Math.max(1, buttons.length);
        const bw = n >= 3 ? 160 : 170;
        for (let i = 0; i < n; i++) {
            const spec = buttons[i];
            const btn = createButton(panel, {
                w: bw, h: 56, text: spec.label, fontSize: 21,
                fill: spec.fill || COLOR.PRIMARY, textColor: spec.textColor || '#FFFFFF',
                activeFill: COLOR.PRIMARY_DARK, radius: 14,
                onTap: () => {
                    this.closeModal();
                    spec.onTap();
                },
            });
            const step = n >= 3 ? 180 : 190;
            btn.node.setPosition((i - (n - 1) / 2) * step, -132, 0);
        }

        root.setSiblingIndex(this.node.children.length - 1);
    }
}
