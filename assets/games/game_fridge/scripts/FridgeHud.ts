/**
 * 冰箱底下 — 顶栏 / 道具栏 / 小地图 / 宝箱三选一 / 死亡与通关提示。
 *
 * 节点全部运行时创建（与 SurvivorHud 一致），不改场景文件。
 * 顶栏在 Canvas 顶部，战斗区（Field）中心 y=160、半高 336，所以 HUD 放在 y≈580 一带。
 *
 * 约定：onDestroy 只清引用（红线 4）；所有文字直接 set Label.string（图标一律用 Graphics 画，避免字体 tofu）。
 */

import { _decorator, Color, Component, EventTouch, Graphics, Label, Node, sys, UITransform } from 'cc';
import { COLOR, hex } from '../../../common/ui/UITheme';
import type { FridgeSnapshot } from './FridgeConfig';
import { ITEM_BY_ID, PAL, REROLL_COST, CHAR_BY_ID, CORE_BY_ID, CORE_FILLER_BY_ID, HEAT_CURSES } from './FridgeConfig';
import type { FloorMap } from './FridgeDungeon';
import { MAP_H, MAP_W } from './FridgeDungeon';

const { ccclass } = _decorator;

/** 顶栏基线（Canvas 坐标）：心格一行在上，数值一行在下 */
const HUD_Y = 604;
const STATS_Y = 566;
/** 半心方块边长 */
const PIP = 14;
const PIP_GAP = 3;
/** M1 计分：击杀 10 分 + 每秒 5 分（死亡结算与最高分用） */
const SCORE_PER_KILL = 10;
const SCORE_PER_SEC = 5;
const BEST_KEY = 'tiny_games_fridge_best';

@ccclass('FridgeHud')
export class FridgeHud extends Component {
    /** 死亡遮罩被点击时回调（由 FridgeGame 注入，避免 HUD 直接依赖主组件） */
    onRestartRequested: (() => void) | null = null;
    /** 宝箱三选一：选了第 index 个（FridgeGame 转给核心） */
    onTreasurePick: ((index: number) => void) | null = null;
    /** 宝箱三选一：重掷 */
    onTreasureReroll: (() => void) | null = null;
    /** 主动槽按钮（技能 / 主动道具） */
    onActiveRequested: (() => void) | null = null;
    /** 炸弹按钮（右下角同款圆钮） */
    onBombRequested: (() => void) | null = null;
    /** 商店：买第 index 个货位 / 离开 */
    onShopBuy: ((index: number) => void) | null = null;
    onShopLeave: (() => void) | null = null;
    /** 祭坛：献祭 / 离开 */
    onAltarTake: (() => void) | null = null;
    onAltarLeave: (() => void) | null = null;
    /** Boss 核心三选一：选了第 index 个（M4） */
    onCorePick: ((index: number) => void) | null = null;

    private _pipGfx: Graphics | null = null;
    private _stats: Label | null = null;
    private _sub: Label | null = null;
    private _items: Label | null = null;
    private _hint: Label | null = null;
    private _dead: Label | null = null;
    private _deadDim: Node | null = null;
    /** 死亡遮罩上的「再来一局」按钮（只它重开，遮罩空白处仍是回主菜单） */
    private _deadAgain: Node | null = null;

    /** 主动槽按钮 */
    private _activeNode: Node | null = null;
    private _activeGfx: Graphics | null = null;
    private _activeName: Label | null = null;
    private _activeCharge: Label | null = null;
    private _activeReady = false;

    /** 协同 / 技能提示（顶部下沿浮出，2.4s 后淡出） */
    private _toast: Label | null = null;
    private _toastT = 0;

    /** 小地图 */
    private _mapGfx: Graphics | null = null;
    private _mapNode: Node | null = null;
    private _mapKey = '';

    /** 宝箱三选一面板 */
    private _treasureDim: Node | null = null;
    private _treasureCards: Node[] = [];
    private _treasureNameLabels: Label[] = [];
    private _treasureDescLabels: Label[] = [];
    private _treasureReroll: Node | null = null;
    private _treasureKey = '';

    /** 炸弹按钮 */
    private _bombNode: Node | null = null;
    private _bombGfx: Graphics | null = null;
    private _bombCount: Label | null = null;
    private _bombEnabled = true;

    /** 商店面板 */
    private _shopPanel: Node | null = null;
    private _shopCards: Node[] = [];
    private _shopNameLabels: Label[] = [];
    private _shopDescLabels: Label[] = [];
    private _shopPriceLabels: Label[] = [];
    private _shopLeave: Node | null = null;
    private _shopKey = '';

    /** 祭坛面板 */
    private _altarPanel: Node | null = null;
    private _altarName: Label | null = null;
    private _altarDesc: Label | null = null;
    private _altarTake: Node | null = null;
    private _altarTakeGfx: Graphics | null = null;
    private _altarTakeLabel: Label | null = null;
    private _altarLeave: Node | null = null;
    private _altarKey = '';

    /** Boss 核心三选一面板（M4） */
    private _corePanel: Node | null = null;
    private _coreCards: Node[] = [];
    private _coreNameLabels: Label[] = [];
    private _coreDescLabels: Label[] = [];
    private _coreKey = '';

    /** 结算附加行（冰箱贴收益 / 图鉴新增 / 新解锁），由 FridgeGame 注入 */
    private _resultLines: string[] = [];

    private _safeTop = 0;
    private _best = 0;
    private _wasDead = false;
    private _newRecord = false;

    private _cFull = hex(PAL.red);
    private _cEmpty = hex(PAL.barEmpty);
    private _cText = hex(COLOR.TEXT_PRIMARY);
    private _cAccent = hex(PAL.accent);
    private _cInk = hex(PAL.ink);

    static create(parent: Node): FridgeHud {
        const node = new Node('FridgeHud');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        parent.addChild(node);
        return node.addComponent(FridgeHud);
    }

    onLoad(): void {
        this._best = this._loadBest();
        this._buildDeadDim();
        this._buildPips();
        this._stats = this._makeLabel('Stats', -340, STATS_Y, 20, Label.HorizontalAlign.LEFT, 420);
        this._sub = this._makeLabel('Sub', -340, STATS_Y - 28, 16, Label.HorizontalAlign.LEFT, 520);
        this._items = this._makeLabel('Items', 0, -300, 20, Label.HorizontalAlign.CENTER, 680);
        this._hint = this._makeLabel('Hint', 0, -370, 18, Label.HorizontalAlign.CENTER, 680);
        this._hint.string = '左半屏拖动移动 · 右半屏拖动瞄准 / 射击 · 点技能 / 炸弹（Q / E）';
        this._dead = this._makeLabel('Dead', 0, 40, 34, Label.HorizontalAlign.CENTER, 640);
        this._dead.node.active = false;
        this._toast = this._makeLabel('Toast', 0, 500, 24, Label.HorizontalAlign.CENTER, 640);
        this._toast.node.active = false;
        this._buildActiveButton();
        this._buildBombButton();
        this._buildMinimap();
        this._buildTreasurePanel();
        this._buildShopPanel();
        this._buildAltarPanel();
        this._buildCorePanel();
        this._applySafeTop();
    }

    onDestroy(): void {
        if (this._deadAgain && this._deadAgain.isValid) {
            this._deadAgain.off(Node.EventType.TOUCH_END, this.onDeadDimTouch, this);
        }
        for (const card of this._treasureCards) {
            if (card && card.isValid) card.off(Node.EventType.TOUCH_END, this.onTreasureCardTouch, this);
        }
        if (this._treasureReroll && this._treasureReroll.isValid) {
            this._treasureReroll.off(Node.EventType.TOUCH_END, this.onTreasureRerollTouch, this);
        }
        if (this._activeNode && this._activeNode.isValid) {
            this._activeNode.off(Node.EventType.TOUCH_END, this.onActiveTouch, this);
        }
        if (this._bombNode && this._bombNode.isValid) {
            this._bombNode.off(Node.EventType.TOUCH_END, this.onBombTouch, this);
        }
        for (const card of this._shopCards) {
            if (card && card.isValid) card.off(Node.EventType.TOUCH_END, this.onShopCardTouch, this);
        }
        if (this._shopLeave && this._shopLeave.isValid) {
            this._shopLeave.off(Node.EventType.TOUCH_END, this.onShopLeaveTouch, this);
        }
        if (this._altarTake && this._altarTake.isValid) {
            this._altarTake.off(Node.EventType.TOUCH_END, this.onAltarTakeTouch, this);
        }
        if (this._altarLeave && this._altarLeave.isValid) {
            this._altarLeave.off(Node.EventType.TOUCH_END, this.onAltarLeaveTouch, this);
        }
        for (const card of this._coreCards) {
            if (card && card.isValid) card.off(Node.EventType.TOUCH_END, this.onCoreCardTouch, this);
        }
        this._pipGfx = null;
        this._stats = null;
        this._sub = null;
        this._items = null;
        this._hint = null;
        this._dead = null;
        this._deadDim = null;
        this._deadAgain = null;
        this._activeNode = null;
        this._activeGfx = null;
        this._activeName = null;
        this._activeCharge = null;
        this._toast = null;
        this._mapGfx = null;
        this._mapNode = null;
        this._treasureDim = null;
        this._treasureCards = [];
        this._treasureNameLabels = [];
        this._treasureDescLabels = [];
        this._treasureReroll = null;
        this._bombNode = null;
        this._bombGfx = null;
        this._bombCount = null;
        this._shopPanel = null;
        this._shopCards = [];
        this._shopNameLabels = [];
        this._shopDescLabels = [];
        this._shopPriceLabels = [];
        this._shopLeave = null;
        this._altarPanel = null;
        this._altarName = null;
        this._altarDesc = null;
        this._altarTake = null;
        this._altarTakeGfx = null;
        this._altarTakeLabel = null;
        this._altarLeave = null;
        this._corePanel = null;
        this._coreCards = [];
        this._coreNameLabels = [];
        this._coreDescLabels = [];
        this._resultLines = [];
        this.onRestartRequested = null;
        this.onTreasurePick = null;
        this.onTreasureReroll = null;
        this.onActiveRequested = null;
        this.onBombRequested = null;
        this.onShopBuy = null;
        this.onShopLeave = null;
        this.onAltarTake = null;
        this.onAltarLeave = null;
        this.onCorePick = null;
    }

    update(dt: number): void {
        if (this._toastT <= 0) return;
        this._toastT -= dt;
        const t = this._toast;
        if (!t) return;
        if (this._toastT <= 0) {
            t.node.active = false;
        } else if (this._toastT < 0.5) {
            const a = Math.max(0, this._toastT / 0.5);
            t.color = new Color(t.color.r, t.color.g, t.color.b, Math.round(255 * a));
        }
    }

    /** 顶部浮字：协同点亮 / 技能释放 / 充能不足 */
    showToast(text: string): void {
        const t = this._toast;
        if (!t) return;
        t.string = text;
        t.color = new Color(this._cAccent.r, this._cAccent.g, this._cAccent.b, 255);
        t.node.active = true;
        t.node.setPosition(0, 500 - this._safeTop, 0);
        this._toastT = 2.4;
    }

    /** 顶栏整体下移刘海高度（设计像素）；wx 下由 FridgeGame 注入 */
    setSafeTop(top: number): void {
        this._safeTop = Math.max(0, top);
        this._applySafeTop();
    }

    /** 常驻帧率读数由 FridgePerf 的「帧率」按钮显示，这里不再单独占一行 */

    refresh(snap: FridgeSnapshot): void {
        this._drawPips(snap.player.hp, snap.player.maxHp);
        const score = this._scoreOf(snap);
        const map = snap.map as FloorMap | null;
        if (this._stats) {
            if (map) {
                const total = map.rooms.length;
                let visited = 0;
                for (const r of map.rooms) if (r.visited) visited++;
                const tag = snap.mode === 'daily' ? '每日 · ' : snap.mode === 'heat' ? '热度 · ' : '';
                this._stats.string =
                    `${tag}第 ${snap.floor} 层 · 房间 ${visited}/${total} · 币 ${snap.coins} · ` +
                    `弹 ${snap.player.bombs} · 充能 ${snap.player.charges}/${snap.player.maxCharges} · 贴 ${snap.magnets}`;
            } else {
                this._stats.string = `击杀 ${snap.kills}   波次 ${snap.wave}   分数 ${score}`;
            }
        }
        if (this._sub) {
            const p = snap.player;
            this._sub.string = `伤害 ${p.dmg.toFixed(1)}   射速 ${p.rate.toFixed(1)}/s   最高 ${this._best}`;
        }
        this._refreshMinimap(map, snap);
        this._refreshTreasure(snap);

        const over = snap.phase !== 'playing';
        if (!over) {
            this._wasDead = false;
            this._newRecord = false;
        } else if (!this._wasDead) {
            // 只在刚结束的这一拍结算最高分，避免每 0.1s 刷新时「新纪录」闪一下就消失
            this._wasDead = true;
            this._newRecord = score > this._best;
            if (this._newRecord) {
                this._best = score;
                this._saveBest(score);
            }
        }
        if (this._dead) {
            if (this._dead.node.active !== over) this._dead.node.active = over;
            if (over) {
                const bestText = this._newRecord ? `历史最高 ${this._best}（新纪录！）` : `历史最高 ${this._best}`;
                const head = snap.phase === 'won' ? '逃出冰箱！' : '被吃掉了…';
                const floorText = map ? `第 ${snap.floor} 层 · ` : '';
                const extra = this._resultLines.length > 0 ? `\n${this._resultLines.join('\n')}` : '';
                this._dead.string =
                    `${head}\n${floorText}得分 ${score} · 击杀 ${snap.kills} · 坚持 ${Math.floor(snap.time)} 秒\n` +
                    `${bestText}${extra}\n点空白处回主菜单 · 点「再来一局」立即重开`;
            }
        }
        if (this._deadDim) {
            if (this._deadDim.active !== over) this._deadDim.active = over;
        }
        const playing = snap.phase === 'playing';
        const treasureOpen = !!snap.pendingTreasure && playing;
        const shopOpen = !!snap.pendingShop && playing;
        const altarOpen = !!snap.pendingAltar && playing;
        const coreOpen = !!snap.pendingCore && playing;
        const panelOpen = treasureOpen || shopOpen || altarOpen || coreOpen;
        if (this._items) {
            if (snap.items.length === 0) {
                this._items.string = map ? '道具：无（清房后回中心拾取）' : '道具：无（走到中间的辣椒酱上拾取）';
            } else {
                const names: string[] = [];
                for (const id of snap.items) {
                    const def = ITEM_BY_ID[id];
                    names.push(def ? def.name : id);
                }
                const cores: string[] = [];
                for (const id of snap.cores) {
                    const def = CORE_BY_ID[id] || CORE_FILLER_BY_ID[id];
                    if (def) cores.push(def.name);
                }
                this._items.string =
                    `道具（${names.length}）：${names.join('、')}` +
                    (cores.length > 0 ? `　核心：${cores.join('、')}` : '');
            }
            this._items.node.active = playing && !panelOpen;
        }
        if (this._hint) {
            this._hint.node.active = playing && !panelOpen;
            this._hint.string = this._hintText(snap);
        }
        this._refreshActive(snap, playing, panelOpen);
        this._refreshBombButton(snap, playing, panelOpen);
        this._refreshShop(snap, shopOpen);
        this._refreshAltar(snap, altarOpen);
        this._refreshCore(snap, coreOpen);
        if (this._mapNode) this._mapNode.active = !!map && !over;
    }

    private _refreshActive(snap: FridgeSnapshot, playing: boolean, treasureOpen: boolean): void {
        const node = this._activeNode;
        if (!node) return;
        const show = playing && !treasureOpen;
        if (node.active !== show) node.active = show;
        if (!show) return;
        const def = snap.activeItem ? ITEM_BY_ID[snap.activeItem] : null;
        const char = CHAR_BY_ID[snap.charId];
        const name = def ? def.name : (char ? char.skill.name : '技能');
        const cost = def ? (def.charges || 3) : (char ? char.skill.charges : 3);
        if (this._activeName) this._activeName.string = name;
        if (this._activeCharge) {
            this._activeCharge.string = snap.player.charges >= cost
                ? `可用 ${snap.player.charges}`
                : `${snap.player.charges}/${cost}`;
        }
        const ready = snap.player.charges >= cost;
        if (this._activeReady !== ready) {
            this._activeReady = ready;
            this._redrawActiveButton();
        }
    }

    // ==================== 炸弹按钮 ====================

    /** 与主动槽同款的圆钮，放在左上角：显示炸弹数，点击 / 按 E 投掷 */
    private _buildBombButton(): void {
        const node = new Node('BombButton');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(100, 100);
        ut.setAnchorPoint(0.5, 0.5);
        node.setPosition(-282, 462, 0);
        this.node.addChild(node);
        this._bombNode = node;
        this._bombGfx = node.addComponent(Graphics);

        const count = this._makeLabel('BombCount', 0, -18, 20, Label.HorizontalAlign.CENTER, 90);
        count.node.setPosition(0, -18, 0);
        count.string = '0';
        node.addChild(count.node);
        this._bombCount = count;

        node.on(Node.EventType.TOUCH_END, this.onBombTouch, this);
        this._redrawBombButton();
    }

    private _redrawBombButton(): void {
        const g = this._bombGfx;
        if (!g) return;
        g.clear();
        g.fillColor = this._bombEnabled ? hex(PAL.accent, 235) : hex(PAL.panel, 220);
        g.circle(0, 0, 44);
        g.fill();
        g.lineWidth = 4;
        g.strokeColor = this._bombEnabled ? this._cAccent : hex(PAL.barEmpty);
        g.circle(0, 0, 44);
        g.stroke();
        // 炸弹图标：黑球 + 引信 + 火星
        g.fillColor = this._bombEnabled ? this._cInk : this._cText;
        g.circle(0, 10, 15);
        g.fill();
        g.fillColor = this._bombEnabled ? this._cInk : this._cText;
        g.rect(-2, 22, 4, 10);
        g.fill();
        g.fillColor = this._bombEnabled ? this._cInk : this._cText;
        g.circle(2, 34, 4);
        g.fill();
        if (this._bombCount) this._bombCount.color = this._bombEnabled ? this._cInk : this._cText;
    }

    private _refreshBombButton(snap: FridgeSnapshot, playing: boolean, panelOpen: boolean): void {
        const node = this._bombNode;
        if (!node) return;
        const show = playing && !panelOpen;
        if (node.active !== show) node.active = show;
        if (!show) return;
        if (this._bombCount) this._bombCount.string = `${snap.player.bombs}`;
        const enabled = snap.player.bombs > 0 && !snap.bomb;
        if (this._bombEnabled !== enabled) {
            this._bombEnabled = enabled;
            this._redrawBombButton();
        }
    }

    private onBombTouch(): void {
        if (this.onBombRequested) this.onBombRequested();
    }

    // ==================== 商店 ====================

    private _buildShopPanel(): void {
        const node = this._buildPanelRoot('ShopPanel');
        this._shopPanel = node;

        const title = this._makeLabel('ShopTitle', 0, 380, 30, Label.HorizontalAlign.CENTER, 600);
        title.string = '商店 · 看好了再买';
        node.addChild(title.node);
        title.node.setPosition(0, 380, 0);

        const ys = [190, 30, -130];
        for (let i = 0; i < 3; i++) {
            const card = new Node(`ShopCard${i}`);
            card.layer = this.node.layer;
            const cut = card.addComponent(UITransform);
            cut.setContentSize(600, 130);
            cut.setAnchorPoint(0.5, 0.5);
            card.setPosition(0, ys[i], 0);
            card.addComponent(Graphics);
            node.addChild(card);

            const name = this._makeLabel(`ShopName${i}`, -270, 26, 24, Label.HorizontalAlign.LEFT, 360);
            name.node.setPosition(-270, 26, 0);
            card.addChild(name.node);

            const desc = this._makeLabel(`ShopDesc${i}`, -270, -22, 16, Label.HorizontalAlign.LEFT, 380);
            desc.node.setPosition(-270, -22, 0);
            card.addChild(desc.node);

            const price = this._makeLabel(`ShopPrice${i}`, 250, 0, 24, Label.HorizontalAlign.RIGHT, 120);
            price.node.setPosition(250, 0, 0);
            card.addChild(price.node);

            card.on(Node.EventType.TOUCH_END, this.onShopCardTouch, this);
            this._shopCards.push(card);
            this._shopNameLabels.push(name);
            this._shopDescLabels.push(desc);
            this._shopPriceLabels.push(price);
        }

        const leave = this._buildPillButton('ShopLeave', 0, -280, 260, 64, '离开商店');
        leave.on(Node.EventType.TOUCH_END, this.onShopLeaveTouch, this);
        node.addChild(leave);
        this._shopLeave = leave;

        const tip = this._makeLabel('ShopTip', 0, -360, 16, Label.HorizontalAlign.CENTER, 600);
        tip.string = '金币不够的货位会变灰 · 离开后不能回头再买';
        node.addChild(tip.node);
        tip.node.setPosition(0, -360, 0);

        node.active = false;
    }

    private _refreshShop(snap: FridgeSnapshot, show: boolean): void {
        const node = this._shopPanel;
        if (!node) return;
        if (node.active !== show) node.active = show;
        if (!show) {
            this._shopKey = '';
            return;
        }
        const shop = snap.pendingShop;
        if (!shop) return;
        let affordableKey = '';
        for (let i = 0; i < 3; i++) {
            const offer = shop.offers[i];
            const sold = !!shop.sold[i];
            if (!offer) {
                if (this._shopNameLabels[i]) this._shopNameLabels[i].string = '—';
                if (this._shopDescLabels[i]) this._shopDescLabels[i].string = '';
                if (this._shopPriceLabels[i]) this._shopPriceLabels[i].string = '';
                continue;
            }
            let name = '';
            let desc = '';
            if (offer.kind === 'item') {
                const def = ITEM_BY_ID[offer.id];
                name = def ? def.name : offer.id;
                desc = def ? def.desc : '';
            } else if (offer.kind === 'heart') {
                name = '半颗心';
                desc = '回复 1 半心（满血时不能买）';
            } else {
                name = '炸弹 ×1';
                desc = '半径 140 / 伤害 50 / 能炸开秘密墙';
            }
            const full = offer.kind === 'heart' && snap.player.hp >= snap.player.maxHp;
            const canBuy = !sold && !full && snap.coins >= offer.price;
            affordableKey += canBuy ? '1' : '0';
            if (this._shopNameLabels[i]) {
                this._shopNameLabels[i].string = sold ? `${name}（已售）` : name;
            }
            if (this._shopDescLabels[i]) this._shopDescLabels[i].string = desc;
            if (this._shopPriceLabels[i]) {
                this._shopPriceLabels[i].string = sold ? '—' : `${offer.price} 币`;
                this._shopPriceLabels[i].color = canBuy ? this._cAccent : hex(PAL.barEmpty);
            }
        }
        const key = shop.offers.map((o) => o.kind === 'item' ? o.id : o.kind).join(',')
            + '|' + shop.sold.map((s) => (s ? 1 : 0)).join('') + '|' + affordableKey;
        if (key === this._shopKey) return;
        this._shopKey = key;
        for (let i = 0; i < this._shopCards.length; i++) {
            const offer = shop.offers[i];
            const sold = !!shop.sold[i];
            const full = !!offer && offer.kind === 'heart' && snap.player.hp >= snap.player.maxHp;
            const canBuy = !!offer && !sold && !full && snap.coins >= offer.price;
            const g = this._shopCards[i].getComponent(Graphics);
            if (!g) continue;
            g.clear();
            g.fillColor = sold ? hex(PAL.panel, 200) : hex(PAL.card, 245);
            g.roundRect(-300, -65, 600, 130, 16);
            g.fill();
            g.lineWidth = 3;
            g.strokeColor = canBuy ? hex(PAL.coin, 220) : hex(PAL.barEmpty, 160);
            g.roundRect(-300, -65, 600, 130, 16);
            g.stroke();
        }
    }

    private onShopCardTouch(ev: EventTouch): void {
        const target = ev.target as Node | null;
        if (!target) return;
        const idx = parseInt(target.name.replace('ShopCard', ''), 10);
        if (!Number.isFinite(idx)) return;
        if (this.onShopBuy) this.onShopBuy(idx);
    }

    private onShopLeaveTouch(): void {
        if (this.onShopLeave) this.onShopLeave();
    }

    /** 商店 / 祭坛共用的全屏面板底（半透明遮罩 + 圆角面板） */
    private _buildPanelRoot(name: string): Node {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1060);
        node.setPosition(0, -40, 0);
        this.node.addChild(node);

        const g = node.addComponent(Graphics);
        g.fillColor = hex(PAL.overlay, 190);
        g.rect(-360, -530, 720, 1060);
        g.fill();
        g.fillColor = hex(PAL.panelDeep, 240);
        g.roundRect(-320, -440, 640, 880, 24);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = hex(PAL.accent, 120);
        g.roundRect(-320, -440, 640, 880, 24);
        g.stroke();
        node.active = false;
        return node;
    }

    /** 胶囊按钮（离开 / 确认） */
    private _buildPillButton(name: string, x: number, y: number, w: number, h: number, text: string): Node {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);
        ut.setAnchorPoint(0.5, 0.5);
        node.setPosition(x, y, 0);
        const g = node.addComponent(Graphics);
        g.fillColor = hex(PAL.accent, 235);
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.fill();
        const label = this._makeLabel(`${name}Label`, 0, 0, 22, Label.HorizontalAlign.CENTER, w - 20);
        label.string = text;
        label.color = this._cInk;
        label.node.setPosition(0, 0, 0);
        node.addChild(label.node);
        return node;
    }

    // ==================== 祭坛 ====================

    private _buildAltarPanel(): void {
        const node = this._buildPanelRoot('AltarPanel');
        this._altarPanel = node;

        const title = this._makeLabel('AltarTitle', 0, 380, 30, Label.HorizontalAlign.CENTER, 600);
        title.string = '祭坛 · 以心换物';
        node.addChild(title.node);
        title.node.setPosition(0, 380, 0);

        const card = new Node('AltarCard');
        card.layer = this.node.layer;
        const cut = card.addComponent(UITransform);
        cut.setContentSize(560, 200);
        cut.setAnchorPoint(0.5, 0.5);
        card.setPosition(0, 120, 0);
        const cg = card.addComponent(Graphics);
        cg.fillColor = hex(PAL.card, 245);
        cg.roundRect(-280, -100, 560, 200, 18);
        cg.fill();
        cg.lineWidth = 3;
        cg.strokeColor = hex(PAL.red, 200);
        cg.roundRect(-280, -100, 560, 200, 18);
        cg.stroke();
        node.addChild(card);

        const name = this._makeLabel('AltarName', 0, 42, 26, Label.HorizontalAlign.CENTER, 520);
        name.node.setPosition(0, 42, 0);
        card.addChild(name.node);
        this._altarName = name;

        const desc = this._makeLabel('AltarDesc', 0, -30, 17, Label.HorizontalAlign.CENTER, 500);
        desc.overflow = Label.Overflow.RESIZE_HEIGHT;
        desc.lineHeight = 26;
        desc.node.setPosition(0, -30, 0);
        card.addChild(desc.node);
        this._altarDesc = desc;

        const take = new Node('AltarTake');
        take.layer = this.node.layer;
        const tut = take.addComponent(UITransform);
        tut.setContentSize(420, 72);
        tut.setAnchorPoint(0.5, 0.5);
        take.setPosition(0, -140, 0);
        this._altarTakeGfx = take.addComponent(Graphics);
        const tl = this._makeLabel('AltarTakeLabel', 0, 0, 22, Label.HorizontalAlign.CENTER, 400);
        tl.node.setPosition(0, 0, 0);
        take.addChild(tl.node);
        this._altarTakeLabel = tl;
        take.on(Node.EventType.TOUCH_END, this.onAltarTakeTouch, this);
        node.addChild(take);
        this._altarTake = take;

        const leave = this._buildPillButton('AltarLeave', 0, -260, 260, 64, '离开祭坛');
        leave.on(Node.EventType.TOUCH_END, this.onAltarLeaveTouch, this);
        node.addChild(leave);
        this._altarLeave = leave;

        const tip = this._makeLabel('AltarTip', 0, -350, 16, Label.HorizontalAlign.CENTER, 600);
        tip.string = '献祭不会致死：只剩 1 颗心时不能献祭';
        node.addChild(tip.node);
        tip.node.setPosition(0, -350, 0);
    }

    private _refreshAltar(snap: FridgeSnapshot, show: boolean): void {
        const node = this._altarPanel;
        if (!node) return;
        if (node.active !== show) node.active = show;
        if (!show) {
            this._altarKey = '';
            return;
        }
        const altar = snap.pendingAltar;
        if (!altar) return;
        const def = ITEM_BY_ID[altar.itemId];
        const canTake = !altar.used && snap.player.hp > 2;
        const key = `${altar.itemId}|${altar.used ? 1 : 0}|${snap.player.hp}`;
        if (key === this._altarKey) return;
        this._altarKey = key;
        if (this._altarName) this._altarName.string = def ? def.name : altar.itemId;
        if (this._altarDesc) this._altarDesc.string = def ? def.desc : '';
        if (this._altarTakeLabel) {
            this._altarTakeLabel.string = altar.used
                ? '祭坛已空'
                : canTake ? '献祭 1 颗心（2 半心）' : '心不够';
            this._altarTakeLabel.color = canTake ? this._cInk : this._cText;
        }
        const g = this._altarTakeGfx;
        if (g) {
            g.clear();
            g.fillColor = canTake ? hex(PAL.red, 235) : hex(PAL.panel, 220);
            g.roundRect(-210, -36, 420, 72, 36);
            g.fill();
        }
    }

    private onAltarTakeTouch(): void {
        if (this.onAltarTake) this.onAltarTake();
    }

    private onAltarLeaveTouch(): void {
        if (this.onAltarLeave) this.onAltarLeave();
    }

    // ==================== 小地图 ====================

    private _buildMinimap(): void {
        const node = new Node('Minimap');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(MAP_W * 15, MAP_H * 15);
        ut.setAnchorPoint(1, 0);
        node.setPosition(340, -560, 0);
        this.node.addChild(node);
        this._mapGfx = node.addComponent(Graphics);
        this._mapNode = node;
        node.active = false;
    }

    private _refreshMinimap(map: FloorMap | null, snap: FridgeSnapshot): void {
        const g = this._mapGfx;
        if (!g || !map) return;
        // 只在房间状态变化时重画（visited / cleared / 当前房间）
        let visited = 0;
        for (const r of map.rooms) if (r.visited) visited++;
        const key = `${snap.roomId}|${visited}|${map.rooms.map((r) => (r.cleared ? 1 : 0)).join('')}`;
        if (key === this._mapKey) return;
        this._mapKey = key;

        const cell = 13;
        const gap = 3;
        const originX = -(MAP_W * (cell + gap) - gap);
        const originY = 0;
        g.clear();
        for (const r of map.rooms) {
            if (!r.visited) continue;
            let fill: Color;
            if (r.id === snap.roomId) fill = this._cMapCurrent;
            else if (r.cleared) fill = this._cMapCleared;
            else if (r.kind === 'boss') fill = this._cMapBoss;
            else if (r.kind === 'treasure') fill = this._cMapTreasure;
            else if (r.kind === 'shop') fill = this._cMapShop;
            else if (r.kind === 'altar') fill = this._cMapAltar;
            else if (r.kind === 'secret') fill = this._cMapSecret;
            else fill = this._cMapPlain;
            g.fillColor = fill;
            g.rect(originX + r.x * (cell + gap), originY + r.y * (cell + gap), cell, cell);
            g.fill();
        }
    }

    private _cMapPlain = hex(PAL.mapPlain, 235);
    private _cMapCleared = hex(PAL.accentLight, 235);
    private _cMapCurrent = hex(PAL.player);
    private _cMapBoss = hex(PAL.red, 235);
    private _cMapTreasure = hex(PAL.coin, 235);
    private _cMapShop = hex(PAL.accent, 235);
    private _cMapAltar = hex(PAL.red, 235);
    private _cMapSecret = hex(PAL.accentLight, 200);

    // ==================== 宝箱三选一 ====================

    private _buildTreasurePanel(): void {
        const node = new Node('TreasurePanel');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1060);
        node.setPosition(0, -40, 0);
        this.node.addChild(node);
        this._treasureDim = node;

        const dim = new Node('TreasureDim');
        dim.layer = this.node.layer;
        dim.addComponent(UITransform).setContentSize(720, 1060);
        const dg = dim.addComponent(Graphics);
        dg.fillColor = hex(PAL.overlay, 190);
        dg.rect(-360, -530, 720, 1060);
        dg.fill();
        node.addChild(dim);

        const title = this._makeLabel('TreasureTitle', 0, 400, 30, Label.HorizontalAlign.CENTER, 600);
        title.string = '宝箱！选一件带走';
        node.addChild(title.node);
        title.node.setPosition(0, 400, 0);

        const xs = [-220, 0, 220];
        for (let i = 0; i < 3; i++) {
            const card = new Node(`Card${i}`);
            card.layer = this.node.layer;
            const cut = card.addComponent(UITransform);
            cut.setContentSize(190, 260);
            cut.setAnchorPoint(0.5, 0.5);
            card.setPosition(xs[i], 120, 0);
            const cg = card.addComponent(Graphics);
            cg.fillColor = hex(PAL.card, 245);
            cg.roundRect(-95, -130, 190, 260, 16);
            cg.fill();
            cg.lineWidth = 3;
            cg.strokeColor = hex(PAL.coin, 200);
            cg.roundRect(-95, -130, 190, 260, 16);
            cg.stroke();
            node.addChild(card);

            const name = this._makeLabel(`CardName${i}`, 0, 60, 22, Label.HorizontalAlign.CENTER, 170);
            name.node.setPosition(0, 60, 0);
            card.addChild(name.node);

            const desc = this._makeLabel(`CardDesc${i}`, 0, -20, 16, Label.HorizontalAlign.CENTER, 170);
            desc.overflow = Label.Overflow.RESIZE_HEIGHT;
            desc.lineHeight = 24;
            desc.node.setPosition(0, -20, 0);
            card.addChild(desc.node);

            card.on(Node.EventType.TOUCH_END, this.onTreasureCardTouch, this);
            this._treasureCards.push(card);
            this._treasureNameLabels.push(name);
            this._treasureDescLabels.push(desc);
        }

        const reroll = new Node('Reroll');
        reroll.layer = this.node.layer;
        const rut = reroll.addComponent(UITransform);
        rut.setContentSize(300, 64);
        rut.setAnchorPoint(0.5, 0.5);
        reroll.setPosition(0, -110, 0);
        const rg = reroll.addComponent(Graphics);
        rg.fillColor = hex(PAL.accent, 235);
        rg.roundRect(-150, -32, 300, 64, 32);
        rg.fill();
        const rl = this._makeLabel('RerollLabel', 0, 0, 24, Label.HorizontalAlign.CENTER, 280);
        rl.string = `换一批（${REROLL_COST} 金币）`;
        rl.color = hex(PAL.ink);
        rl.node.setPosition(0, 0, 0);
        reroll.addChild(rl.node);
        reroll.on(Node.EventType.TOUCH_END, this.onTreasureRerollTouch, this);
        node.addChild(reroll);
        this._treasureReroll = reroll;

        const tip = this._makeLabel('TreasureTip', 0, -180, 16, Label.HorizontalAlign.CENTER, 600);
        tip.string = '点卡片领取 · 领完从门离开';
        node.addChild(tip.node);
        tip.node.setPosition(0, -180, 0);

        node.active = false;
    }

    private _refreshTreasure(snap: FridgeSnapshot): void {
        const node = this._treasureDim;
        if (!node) return;
        const offer = snap.pendingTreasure;
        const show = !!offer && snap.phase === 'playing';
        if (node.active !== show) node.active = show;
        if (!offer) {
            this._treasureKey = '';
            return;
        }
        const key = offer.offered.join(',') + (offer.rerolled ? '#r' : '');
        if (key === this._treasureKey) return;
        this._treasureKey = key;
        for (let i = 0; i < 3; i++) {
            const id = offer.offered[i];
            const def = id ? ITEM_BY_ID[id] : null;
            const nl = this._treasureNameLabels[i];
            const dl = this._treasureDescLabels[i];
            if (nl) nl.string = def ? def.name : '—';
            if (dl) dl.string = def ? def.desc : '';
        }
        void snap.coins;
    }

    private onTreasureCardTouch(ev: EventTouch): void {
        const target = ev.target as Node | null;
        if (!target) return;
        const idx = parseInt(target.name.replace('Card', ''), 10);
        if (!Number.isFinite(idx)) return;
        if (this.onTreasurePick) this.onTreasurePick(idx);
    }

    private onTreasureRerollTouch(): void {
        if (this.onTreasureReroll) this.onTreasureReroll();
    }

    // ==================== Boss 核心三选一（M4） ====================

    private _buildCorePanel(): void {
        const node = this._buildPanelRoot('CorePanel');
        this._corePanel = node;

        const title = this._makeLabel('CoreTitle', 0, 380, 30, Label.HorizontalAlign.CENTER, 600);
        title.string = 'Boss 核心 · 三选一';
        title.node.setPosition(0, 380, 0);
        node.addChild(title.node);

        const sub = this._makeLabel('CoreSub', 0, 330, 16, Label.HorizontalAlign.CENTER, 600);
        sub.string = '永久被动，本局有效';
        sub.node.setPosition(0, 330, 0);
        node.addChild(sub.node);

        const xs = [-215, 0, 215];
        for (let i = 0; i < 3; i++) {
            const card = new Node(`CoreCard${i}`);
            card.layer = this.node.layer;
            const cut = card.addComponent(UITransform);
            cut.setContentSize(190, 340);
            cut.setAnchorPoint(0.5, 0.5);
            card.setPosition(xs[i], 60, 0);
            const cg = card.addComponent(Graphics);
            cg.fillColor = hex(PAL.card, 245);
            cg.roundRect(-95, -170, 190, 340, 16);
            cg.fill();
            cg.lineWidth = 3;
            cg.strokeColor = hex(PAL.accent, 210);
            cg.roundRect(-95, -170, 190, 340, 16);
            cg.stroke();
            node.addChild(card);

            const name = this._makeLabel(`CoreName${i}`, 0, 108, 22, Label.HorizontalAlign.CENTER, 170);
            name.node.setPosition(0, 108, 0);
            card.addChild(name.node);

            const desc = this._makeLabel(`CoreDesc${i}`, 0, 0, 16, Label.HorizontalAlign.CENTER, 170);
            desc.overflow = Label.Overflow.RESIZE_HEIGHT;
            desc.lineHeight = 24;
            desc.node.setPosition(0, 0, 0);
            card.addChild(desc.node);

            card.on(Node.EventType.TOUCH_END, this.onCoreCardTouch, this);
            this._coreCards.push(card);
            this._coreNameLabels.push(name);
            this._coreDescLabels.push(desc);
        }

        const tip = this._makeLabel('CoreTip', 0, -250, 16, Label.HorizontalAlign.CENTER, 600);
        tip.string = '选好后走向传送口，进入下一层';
        tip.node.setPosition(0, -250, 0);
        node.addChild(tip.node);
    }

    private _refreshCore(snap: FridgeSnapshot, open: boolean): void {
        const node = this._corePanel;
        if (!node) return;
        if (node.active !== open) node.active = open;
        const offer = snap.pendingCore;
        if (!offer) {
            this._coreKey = '';
            return;
        }
        const key = offer.join(',');
        if (key === this._coreKey) return;
        this._coreKey = key;
        for (let i = 0; i < 3; i++) {
            const id = offer[i];
            const def = id ? (CORE_BY_ID[id] || CORE_FILLER_BY_ID[id]) : null;
            const nl = this._coreNameLabels[i];
            const dl = this._coreDescLabels[i];
            if (nl) nl.string = def ? def.name : '—';
            if (dl) dl.string = def ? def.desc : '';
        }
    }

    private onCoreCardTouch(ev: EventTouch): void {
        const target = ev.target as Node | null;
        if (!target) return;
        const idx = parseInt(target.name.replace('CoreCard', ''), 10);
        if (!Number.isFinite(idx)) return;
        if (this.onCorePick) this.onCorePick(idx);
    }

    /** 结算附加行（冰箱贴收益 / 图鉴新增 / 解锁提示），下一局开始时清空 */
    setResultLines(lines: string[]): void {
        this._resultLines = lines.slice();
    }

    clearResultLines(): void {
        this._resultLines = [];
    }

    /** 底部提示：楼层传送口 > 热度诅咒 > 操作说明 */
    private _hintText(snap: FridgeSnapshot): string {
        if (snap.stairs) return `传送口已出现：走上去进入第 ${snap.floor + 1} 层`;
        if (snap.mode === 'heat' && snap.heatCurses.length > 0) {
            const names: string[] = [];
            for (const id of snap.heatCurses) {
                for (const c of HEAT_CURSES) if (c.id === id) names.push(c.name);
            }
            if (names.length > 0) {
                return `热度：${names.join(' · ')}　左半屏拖动 / 右半屏瞄准`;
            }
        }
        // 空房间 / 清完怪的房间明确告诉玩家「已经没事可做」，别让玩家站在原地等怪
        if (snap.roomCleared && snap.enemies.length === 0 && snap.doors.length > 0) {
            return '本房间已清空 · 走到门口进入下一个房间';
        }
        return '左半屏拖动移动 · 右半屏拖动瞄准 / 射击 · 点技能 / 炸弹（Q / E）';
    }

    private _scoreOf(snap: FridgeSnapshot): number {
        return snap.kills * SCORE_PER_KILL + Math.floor(snap.time) * SCORE_PER_SEC;
    }

    private _loadBest(): number {
        try {
            const raw = sys.localStorage.getItem(BEST_KEY);
            const n = raw ? parseInt(raw, 10) : 0;
            return Number.isFinite(n) && n > 0 ? n : 0;
        } catch {
            return 0;
        }
    }

    private _saveBest(score: number): void {
        try {
            sys.localStorage.setItem(BEST_KEY, String(score));
        } catch {
            // 存档失败不影响本局
        }
    }

    // ==================== 绘制 / 构建 ====================

    private _applySafeTop(): void {
        const top = this._safeTop;
        if (this._stats) this._stats.node.setPosition(-340, STATS_Y - top, 0);
        if (this._sub) this._sub.node.setPosition(-340, STATS_Y - 28 - top, 0);
        if (this._activeNode) this._activeNode.setPosition(282, 462 - top, 0);
        if (this._bombNode) this._bombNode.setPosition(-282, 462 - top, 0);
        if (this._toast && this._toast.node.active) this._toast.node.setPosition(0, 500 - top, 0);
        if (this._pipGfx) this._redrawPips();
    }

    private _drawPips(hp: number, maxHp: number): void {
        this._pipHp = hp;
        this._pipMax = maxHp;
        this._redrawPips();
    }

    private _redrawPips(): void {
        const g = this._pipGfx;
        if (!g) return;
        const hp = this._pipHp;
        const maxHp = this._pipMax;
        const y = HUD_Y - this._safeTop;
        g.clear();
        const startX = -340;
        for (let i = 0; i < maxHp; i++) {
            g.fillColor = i < hp ? this._cFull : this._cEmpty;
            g.rect(startX + i * (PIP + PIP_GAP), y - PIP / 2, PIP, PIP);
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

    /** 主动槽按钮：右上角圆形，显示技能名 + 充能；点击或按 Q 触发 */
    private _buildActiveButton(): void {
        const node = new Node('ActiveButton');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(100, 100);
        ut.setAnchorPoint(0.5, 0.5);
        node.setPosition(282, 462, 0);
        this.node.addChild(node);
        this._activeNode = node;

        this._activeGfx = node.addComponent(Graphics);

        const name = this._makeLabel('ActiveName', 0, 12, 16, Label.HorizontalAlign.CENTER, 90);
        name.node.setPosition(0, 12, 0);
        node.addChild(name.node);
        this._activeName = name;

        const charge = this._makeLabel('ActiveCharge', 0, -16, 20, Label.HorizontalAlign.CENTER, 90);
        charge.node.setPosition(0, -16, 0);
        node.addChild(charge.node);
        this._activeCharge = charge;

        node.on(Node.EventType.TOUCH_END, this.onActiveTouch, this);
        this._redrawActiveButton();
    }

    private _redrawActiveButton(): void {
        const g = this._activeGfx;
        if (!g) return;
        g.clear();
        g.fillColor = this._activeReady ? hex(PAL.accent, 235) : hex(PAL.panel, 220);
        g.circle(0, 0, 44);
        g.fill();
        g.lineWidth = 4;
        g.strokeColor = this._activeReady ? this._cAccent : hex(PAL.barEmpty);
        g.circle(0, 0, 44);
        g.stroke();
        if (this._activeName) this._activeName.color = this._activeReady ? this._cInk : this._cText;
        if (this._activeCharge) this._activeCharge.color = this._activeReady ? this._cInk : this._cText;
    }

    private onActiveTouch(): void {
        if (this.onActiveRequested) this.onActiveRequested();
    }

    /**
     * 死亡遮罩：整块半透明区域 + 明确按钮，点击即重开。
     * 放在 HUD 子节点第 0 位（文字都在它上面），只在死亡时 active。
     */
    private _buildDeadDim(): void {
        const node = new Node('DeadDim');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1060);
        node.setPosition(0, -40, 0);
        this.node.addChild(node);
        node.setSiblingIndex(0);
        this._deadDim = node;

        const g = node.addComponent(Graphics);
        g.fillColor = hex(PAL.overlay, 170);
        g.rect(-360, -530, 720, 1060);
        g.fill();

        // 提示卡片
        g.fillColor = hex(PAL.panel, 235);
        g.roundRect(-300, -30, 600, 220, 22);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = hex(PAL.accent, 160);
        g.roundRect(-300, -30, 600, 220, 22);
        g.stroke();

        // 「再来一局」按钮底
        g.fillColor = hex(PAL.accent, 235);
        g.roundRect(-130, -150, 260, 64, 32);
        g.fill();

        const btn = new Node('AgainLabel');
        btn.layer = this.node.layer;
        const but = btn.addComponent(UITransform);
        but.setContentSize(260, 64);
        but.setAnchorPoint(0.5, 0.5);
        btn.setPosition(0, -118, 0);
        const bl = btn.addComponent(Label);
        bl.string = '再来一局';
        bl.fontSize = 26;
        bl.lineHeight = 32;
        bl.isBold = true;
        bl.color = hex(PAL.ink);
        bl.horizontalAlign = Label.HorizontalAlign.CENTER;
        bl.verticalAlign = Label.VerticalAlign.CENTER;
        node.addChild(btn);

        // 只有按钮重开；遮罩本身不再消费触摸 —— 空白处点击由全局手势回主菜单，
        // 否则「点哪都重开」会让玩家没法看结算（试玩报告 §3.2）
        this._deadAgain = btn;
        btn.on(Node.EventType.TOUCH_END, this.onDeadDimTouch, this);
        node.active = false;
    }

    /** 回主菜单时收起死亡遮罩（否则下次进入会看到残留的半透明层） */
    hideGameOver(): void {
        if (this._deadDim && this._deadDim.isValid) this._deadDim.active = false;
        if (this._dead && this._dead.node.isValid) this._dead.node.active = false;
    }

    private onDeadDimTouch(): void {
        if (this.onRestartRequested) this.onRestartRequested();
    }

    private _pipHp = 0;
    private _pipMax = 0;

    private _makeLabel(name: string, x: number, y: number, size: number, align: number, width: number): Label {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(width, size * 3);
        // 左对齐锚点在左、右对齐锚点在右，否则 x 会被当成水平中心，整行被推到屏幕外
        const anchorX = align === Label.HorizontalAlign.LEFT ? 0 : align === Label.HorizontalAlign.RIGHT ? 1 : 0.5;
        ut.setAnchorPoint(anchorX, 0.5);
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
