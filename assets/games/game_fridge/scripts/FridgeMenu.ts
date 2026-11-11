/**
 * 冰箱底下 — 主菜单 / 角色选择 / 图鉴 / 解锁树（M4）。
 *
 * 节点全部运行时创建（与 HUD 一致），所有可点元素用 Node 事件 + 命名 handler（红线 3/5）。
 * 菜单只读 meta 并发出「开始 / 继续 / 购买」意图，真正的存档扣费由 FridgeGame 负责。
 */

import { _decorator, Component, EventTouch, Graphics, Label, Node, UITransform } from 'cc';
import { COLOR, hex } from '../../../common/ui/UITheme';
import type { FridgeSave } from './FridgeDungeon';
import { sfx } from './FridgeAudio';
import {
    CHAR_BY_ID, CHARACTERS, HEAT_CURSES, ITEMS, UNLOCK_BY_ID, UNLOCK_NODES,
    collectionRate, dailyChar, dailyDateKey, hasUnlock, isCharUnlocked,
} from './FridgeConfig';

const { ccclass } = _decorator;

/** 菜单交给 FridgeGame 的开局意图 */
export interface MenuStartOptions {
    charId: string;
    mode: 'normal' | 'daily' | 'heat';
    startFloor: number;
    heatCurses: string[];
}

type MenuView = 'main' | 'chars' | 'codex' | 'unlocks';

/** 解锁树里纯装饰节点的调色板序号 */
const PALETTE_NODES = ['palette1', 'palette2', 'palette3'];

@ccclass('FridgeMenu')
export class FridgeMenu extends Component {
    /** 开始一局（正常 / 热度 / 每日由 mode 区分） */
    onStart: ((opts: MenuStartOptions) => void) | null = null;
    /** 继续上局 */
    onContinue: (() => void) | null = null;
    /** 买解锁节点（FridgeGame 扣冰箱贴并回写） */
    onBuyUnlock: ((id: string) => void) | null = null;
    /** 选中已解锁的配色（1–3，FridgeGame 存档并应用） */
    onSelectPalette: ((index: number) => void) | null = null;

    private _meta: FridgeSave | null = null;
    private _hasRun = false;
    private _view: MenuView = 'main';
    private _charId = 'pudding';
    private _heatCurses: string[] = HEAT_CURSES.map((c) => c.id);
    private _tip = '';

    private _root: Node | null = null;
    private _mainView: Node | null = null;
    private _charsView: Node | null = null;
    private _codexView: Node | null = null;
    private _unlockView: Node | null = null;

    private _title: Label | null = null;
    private _sub: Label | null = null;
    private _currency: Label | null = null;
    private _stats: Label | null = null;

    /** 主菜单按钮 */
    private _btnContinue: Node | null = null;
    private _btnStart: Node | null = null;
    private _btnDaily: Node | null = null;
    private _btnHeat: Node | null = null;
    private _btnCodex: Node | null = null;
    private _btnUnlock: Node | null = null;
    private _btnChars: Node | null = null;
    private _mainTip: Label | null = null;

    /** 角色卡片 */
    private _charCards: Node[] = [];
    private _charNameLabels: Label[] = [];
    private _charInfoLabels: Label[] = [];
    private _charStateLabels: Label[] = [];
    private _btnCharStart: Node | null = null;

    /** 图鉴 */
    private _codexTitle: Label | null = null;
    private _codexLabels: Label[] = [];

    /** 解锁树 */
    private _unlockTitle: Label | null = null;
    private _unlockRows: Node[] = [];
    private _unlockNameLabels: Label[] = [];
    private _unlockStateLabels: Label[] = [];

    private _cText = hex(COLOR.TEXT_PRIMARY);
    private _cDim = hex(COLOR.TEXT_SECONDARY);
    private _cAccent = hex('#7CE7FF');
    private _cInk = hex('#0A121C');
    private _cPanel = hex('#0A0E18');
    private _cCard = hex('#1C2638');

    static create(parent: Node): FridgeMenu {
        const node = new Node('FridgeMenu');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        parent.addChild(node);
        return node.addComponent(FridgeMenu);
    }

    onLoad(): void {
        this._buildRoot();
        this._buildMain();
        this._buildChars();
        this._buildCodex();
        this._buildUnlocks();
        this._switchView('main');
        this._root!.active = false;
        // 整屏点一下给个「咔」：子按钮的 TOUCH_END 会冒泡到根节点，不必逐个绑（M5）
        this._root!.on(Node.EventType.TOUCH_END, this.onAnyTapped, this);
    }

    onDestroy(): void {
        if (this._root && this._root.isValid) {
            this._root.off(Node.EventType.TOUCH_END, this.onAnyTapped, this);
        }
        this._offButton(this._btnContinue, this.onContinueTouch);
        this._offButton(this._btnStart, this.onStartTouch);
        this._offButton(this._btnDaily, this.onDailyTouch);
        this._offButton(this._btnHeat, this.onHeatTouch);
        this._offButton(this._btnCodex, this.onCodexTouch);
        this._offButton(this._btnUnlock, this.onUnlockTouch);
        this._offButton(this._btnChars, this.onCharsTouch);
        this._offButton(this._btnCharStart, this.onCharStartTouch);
        for (let i = 0; i < this._charCards.length; i++) this._offButton(this._charCards[i], this.onCharCardTouch);
        for (let i = 0; i < this._unlockRows.length; i++) this._offButton(this._unlockRows[i], this.onUnlockRowTouch);
        this._root = null;
        this._mainView = null;
        this._charsView = null;
        this._codexView = null;
        this._unlockView = null;
        this._title = null;
        this._sub = null;
        this._currency = null;
        this._stats = null;
        this._btnContinue = null;
        this._btnStart = null;
        this._btnDaily = null;
        this._btnHeat = null;
        this._btnCodex = null;
        this._btnUnlock = null;
        this._btnChars = null;
        this._mainTip = null;
        this._charCards = [];
        this._charNameLabels = [];
        this._charInfoLabels = [];
        this._charStateLabels = [];
        this._btnCharStart = null;
        this._codexTitle = null;
        this._codexLabels = [];
        this._unlockRows = [];
        this._unlockNameLabels = [];
        this._unlockStateLabels = [];
        this.onStart = null;
        this.onContinue = null;
        this.onBuyUnlock = null;
        this.onSelectPalette = null;
    }

    // ==================== 对外接口 ====================

    setMeta(meta: FridgeSave): void {
        this._meta = meta;
        const first = this._firstUnlockedChar(meta);
        if (!isCharUnlocked(meta.unlocks, this._charId)) this._charId = first;
        this.render();
    }

    setHasRun(has: boolean): void {
        this._hasRun = has;
        this.render();
    }

    /** 显示菜单（默认主视图） */
    show(view: MenuView = 'main'): void {
        if (!this._root) return;
        this._tip = '';
        this._switchView(view);
        this._root.active = true;
        this.render();
    }

    hide(): void {
        if (this._root) this._root.active = false;
    }

    isOpen(): boolean {
        return !!this._root && this._root.active;
    }

    /** 让外部显示一行提示（买不起 / 已解锁等） */
    setTip(text: string): void {
        this._tip = text;
        this.render();
    }

    get selectedChar(): string {
        return this._charId;
    }

    // ==================== 视图切换 ====================

    private _switchView(view: MenuView): void {
        this._view = view;
        // 子视图自带标题，主标题/副标题只在主视图显示，避免两行字叠在一起
        const onMain = view === 'main';
        if (this._title) this._title.node.active = onMain;
        if (this._sub) this._sub.node.active = onMain;
        if (this._mainView) this._mainView.active = view === 'main';
        if (this._charsView) this._charsView.active = view === 'chars';
        if (this._codexView) this._codexView.active = view === 'codex';
        if (this._unlockView) this._unlockView.active = view === 'unlocks';
    }

    // ==================== 渲染 ====================

    render(): void {
        const meta = this._meta;
        if (!meta || !this._root) return;
        if (this._view === 'main') this._renderMain(meta);
        else if (this._view === 'chars') this._renderChars(meta);
        else if (this._view === 'codex') this._renderCodex(meta);
        else this._renderUnlocks(meta);
    }

    private _renderMain(meta: FridgeSave): void {
        if (this._currency) this._currency.string = `冰箱贴 ${meta.magnets}`;
        const rate = collectionRate(meta.seenItems);
        const seenCount = Math.round(rate * ITEMS.length);
        if (this._stats) {
            const s = meta.stats;
            this._stats.string =
                `局数 ${s.runs} · 通关 ${s.wins} · 最佳第 ${Math.max(1, s.bestFloor)} 层　` +
                `图鉴 ${seenCount}/${ITEMS.length}`;
        }
        if (this._btnContinue) {
            this._btnContinue.active = this._hasRun;
            // 「继续上局」和「开始冒险」同为主入口：以前两者都是卡片底色，
            // 与真正不可用的灰按钮长得一样（第二轮复核 N4）。给继续上局加强调描边。
            if (this._hasRun) this._paintSecondary(this._btnContinue, '继续上局');
        }

        const dailyUnlocked = hasUnlock(meta.unlocks, 'daily');
        const heatUnlocked = hasUnlock(meta.unlocks, 'heat');
        const today = dailyDateKey(new Date());
        const dailyDone = !!meta.daily && meta.daily.date === today; // 每天一次：有今天的记录就锁
        const dailyLabel = !dailyUnlocked
            ? '每日挑战（未解锁）'
            : dailyDone
                ? (meta.daily && meta.daily.cleared ? '今日已完成' : '今日已挑战')
                : '每日挑战';
        this._paintButton(this._btnDaily, '每日挑战', dailyLabel, dailyUnlocked && !dailyDone);
        this._paintButton(this._btnHeat, '热度模式', heatUnlocked ? '热度模式（3 诅咒 · 贴 +50%）' : '热度模式（未解锁）', heatUnlocked);
        const char = CHAR_BY_ID[this._charId];
        this._paintButton(this._btnStart, '开始', `开始冒险 · ${char ? char.name : '布丁'}`, true);
        if (this._mainTip) this._mainTip.string = this._tip;
    }

    private _renderChars(meta: FridgeSave): void {
        for (let i = 0; i < CHARACTERS.length && i < this._charCards.length; i++) {
            const def = CHARACTERS[i];
            const unlocked = isCharUnlocked(meta.unlocks, def.id);
            const selected = def.id === this._charId;
            const nl = this._charNameLabels[i];
            const il = this._charInfoLabels[i];
            const sl = this._charStateLabels[i];
            if (nl) {
                nl.string = `${def.name}${selected ? ' ✓' : ''}`;
                nl.color = unlocked ? this._cText : this._cDim;
            }
            if (il) {
                il.string = `${def.hp / 2} 心 · 伤害 ×${def.dmgMul} · ${def.skill.name}`;
                il.color = unlocked ? this._cDim : this._cDim;
            }
            if (sl) {
                const nodeId = `char_${def.id}`;
                const price = UNLOCK_BY_ID[nodeId] ? UNLOCK_BY_ID[nodeId].price : 0;
                sl.string = unlocked ? (selected ? '已选择' : '点一下选择') : `${price} 贴解锁`;
                sl.color = unlocked ? (selected ? this._cAccent : this._cDim) : hex('#FFD65C');
            }
            this._repaintCharCard(i, selected, unlocked);
        }
    }

    private _renderCodex(meta: FridgeSave): void {
        const rate = collectionRate(meta.seenItems);
        const seenCount = Math.round(rate * ITEMS.length);
        if (this._codexTitle) {
            this._codexTitle.string = seenCount === 0
                ? `图鉴 0/${ITEMS.length} · 冒险中拾取道具即可点亮`
                : `图鉴 ${seenCount}/${ITEMS.length}（${Math.round(rate * 100)}%）`;
        }
        const showTags = hasUnlock(meta.unlocks, 'codex_up');
        for (let i = 0; i < ITEMS.length && i < this._codexLabels.length; i++) {
            const def = ITEMS[i];
            const label = this._codexLabels[i];
            if (!label) continue;
            const seen = meta.seenItems.indexOf(def.id) >= 0;
            if (!seen) {
                // 未收集条目：不能露出楼层 / 名字，但也不能是「?F ???」这种占位残留
                // （第二轮复核 N3），统一用中文问号，一眼看得出是「还没遇到」。
                label.string = '？？？';
                label.color = hex('#4A5266');
            } else {
                const fb = def.floor > 0 ? `${def.floor}F` : '池';
                const tags = showTags && def.tags.length > 0 ? ` [${def.tags.length}]` : '';
                label.string = `${fb} ${def.name}${tags}`;
                label.color = this._cText;
            }
        }
    }

    private _renderUnlocks(meta: FridgeSave): void {
        if (this._unlockTitle) this._unlockTitle.string = `解锁树 · 冰箱贴 ${meta.magnets}`;
        for (let i = 0; i < UNLOCK_NODES.length && i < this._unlockRows.length; i++) {
            const node = UNLOCK_NODES[i];
            const owned = hasUnlock(meta.unlocks, node.id);
            const can = !owned && meta.magnets >= node.price;
            const nl = this._unlockNameLabels[i];
            const sl = this._unlockStateLabels[i];
            if (nl) {
                const palIdx = PALETTE_NODES.indexOf(node.id);
                const active = palIdx >= 0 && meta.palette === palIdx + 1;
                nl.string = active ? `● ${node.name}` : `${node.name}`;
                nl.color = owned ? this._cDim : can ? this._cText : hex('#7C8498');
                if (active) nl.color = this._cAccent;
            }
            if (sl) {
                if (owned) {
                    sl.string = PALETTE_NODES.indexOf(node.id) >= 0 ? '已解锁 · 点选配色' : '已解锁';
                    sl.color = this._cAccent;
                } else {
                    sl.string = `${node.price} 贴`;
                    sl.color = can ? hex('#FFD65C') : hex('#7C8498');
                }
            }
            this._repaintUnlockRow(i, owned, can);
        }
    }

    // ==================== 主菜单 ====================

    private _buildRoot(): void {
        const root = new Node('MenuRoot');
        root.layer = this.node.layer;
        const ut = root.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        this.node.addChild(root);
        const g = root.addComponent(Graphics);
        g.fillColor = this._cPanel;
        g.rect(-360, -640, 720, 1280);
        g.fill();
        this._root = root;

        this._title = this._makeLabel(root, 'MenuTitle', 0, 470, 48, Label.HorizontalAlign.CENTER, 640);
        this._title.string = '冰箱底下';
        this._title.color = this._cAccent;

        this._sub = this._makeLabel(root, 'MenuSub', 0, 410, 18, Label.HorizontalAlign.CENTER, 640);
        this._sub.string = '房间制地牢 · 4 层 · 40 道具 · 14 协同';
        this._sub.color = this._cDim;
    }

    private _buildMain(): void {
        const root = this._root;
        if (!root) return;
        const view = this._makeView(root, 'MainView');
        this._mainView = view;

        this._currency = this._makeLabel(view, 'Currency', 0, 340, 26, Label.HorizontalAlign.CENTER, 640);
        this._currency.color = hex('#FFD65C');

        this._btnContinue = this._makeButton(view, 'BtnContinue', 0, 230, 460, 74, '继续上局');
        this._btnStart = this._makeButton(view, 'BtnStart', 0, 136, 460, 74, '开始冒险');
        this._btnDaily = this._makeButton(view, 'BtnDaily', 0, 42, 460, 74, '每日挑战');
        this._btnHeat = this._makeButton(view, 'BtnHeat', 0, -52, 460, 74, '热度模式');
        this._btnChars = this._makeButton(view, 'BtnChars', -118, -158, 224, 66, '角色');
        this._btnCodex = this._makeButton(view, 'BtnCodex', 118, -158, 224, 66, '图鉴');
        this._btnUnlock = this._makeButton(view, 'BtnUnlock', 0, -240, 460, 66, '解锁树');
        // 这三个是次级导航入口，可以点：用「卡片底 + 强调描边 + 正常字色」，
        // 与灰底灰字的禁用态明确区分（第二轮复核 N4）。
        this._paintSecondary(this._btnChars, '角色');
        this._paintSecondary(this._btnCodex, '图鉴');
        this._paintSecondary(this._btnUnlock, '解锁树');

        this._stats = this._makeLabel(view, 'MenuStats', 0, -330, 16, Label.HorizontalAlign.CENTER, 660);
        this._stats.color = this._cDim;

        this._mainTip = this._makeLabel(view, 'MenuTip', 0, -380, 18, Label.HorizontalAlign.CENTER, 660);
        this._mainTip.color = hex('#FFD65C');

        this._btnContinue.on(Node.EventType.TOUCH_END, this.onContinueTouch, this);
        this._btnStart.on(Node.EventType.TOUCH_END, this.onStartTouch, this);
        this._btnDaily.on(Node.EventType.TOUCH_END, this.onDailyTouch, this);
        this._btnHeat.on(Node.EventType.TOUCH_END, this.onHeatTouch, this);
        this._btnChars.on(Node.EventType.TOUCH_END, this.onCharsTouch, this);
        this._btnCodex.on(Node.EventType.TOUCH_END, this.onCodexTouch, this);
        this._btnUnlock.on(Node.EventType.TOUCH_END, this.onUnlockTouch, this);
    }

    /** 根节点收到冒泡的 TOUCH_END：播一声点击音（M5） */
    private onAnyTapped(_ev: EventTouch): void {
        sfx.play('click');
    }

    private onContinueTouch(): void {
        if (this.onContinue) this.onContinue();
    }

    private onStartTouch(): void {
        this._emitStart('normal');
    }

    private onDailyTouch(): void {
        const meta = this._meta;
        if (!meta) return;
        if (!hasUnlock(meta.unlocks, 'daily')) {
            this._tip = '先解锁「每日挑战」（30 贴）';
            this.render();
            return;
        }
        const today = dailyDateKey(new Date());
        if (meta.daily && meta.daily.date === today) {
            this._tip = '今天的挑战已经打过了，明天再来';
            this.render();
            return;
        }
        this._emitStart('daily');
    }

    private onHeatTouch(): void {
        const meta = this._meta;
        if (!meta) return;
        if (!hasUnlock(meta.unlocks, 'heat')) {
            this._tip = '通关第 4 层会解锁热度模式，也可以花 60 贴在解锁树购买';
            this.render();
            return;
        }
        this._emitStart('heat');
    }

    private onCharsTouch(): void {
        this._tip = '';
        this._switchView('chars');
        this.render();
    }

    private onCodexTouch(): void {
        this._switchView('codex');
        this.render();
    }

    private onUnlockTouch(): void {
        this._switchView('unlocks');
        this.render();
    }

    private _emitStart(mode: 'normal' | 'daily' | 'heat'): void {
        const meta = this._meta;
        if (!meta) return;
        let charId = this._charId;
        if (mode === 'daily') charId = dailyChar(dailyDateKey(new Date()));
        let startFloor = 1;
        if (mode !== 'daily' && hasUnlock(meta.unlocks, 'elevator')) startFloor = 2;
        const curses = mode === 'heat' ? this._heatCurses.slice() : [];
        this.hide();
        if (this.onStart) this.onStart({ charId, mode, startFloor, heatCurses: curses });
    }

    // ==================== 角色选择 ====================

    private _buildChars(): void {
        const root = this._root;
        if (!root) return;
        const view = this._makeView(root, 'CharsView');
        this._charsView = view;

        const title = this._makeLabel(view, 'CharsTitle', 0, 470, 34, Label.HorizontalAlign.CENTER, 600);
        title.string = '选择角色';
        title.color = this._cAccent;

        const xs = [-165, 165];
        const ys = [300, 120, -60];
        for (let i = 0; i < CHARACTERS.length; i++) {
            const x = xs[i % 2];
            const y = ys[Math.floor(i / 2)];
            const card = this._makeCard(view, `CharCard${i}`, x, y, 310, 160);
            const nl = this._makeLabel(card, `CharName${i}`, -140, 50, 24, Label.HorizontalAlign.LEFT, 280);
            const il = this._makeLabel(card, `CharInfo${i}`, -140, 6, 15, Label.HorizontalAlign.LEFT, 280);
            const sl = this._makeLabel(card, `CharState${i}`, -140, -46, 17, Label.HorizontalAlign.LEFT, 280);
            card.on(Node.EventType.TOUCH_END, this.onCharCardTouch, this);
            this._charCards.push(card);
            this._charNameLabels.push(nl);
            this._charInfoLabels.push(il);
            this._charStateLabels.push(sl);
        }

        this._btnCharStart = this._makeButton(view, 'CharStart', 0, -220, 420, 70, '用这个角色开始');
        this._btnCharStart.on(Node.EventType.TOUCH_END, this.onCharStartTouch, this);

        const back = this._makeButton(view, 'CharsBack', 0, -330, 300, 60, '返回');
        back.on(Node.EventType.TOUCH_END, this.onBackTouch, this);

        const tip = this._makeLabel(view, 'CharsTip', 0, -400, 15, Label.HorizontalAlign.CENTER, 640);
        tip.string = '未解锁角色可花冰箱贴直接购买；「继续上局」会沿用存档里的角色';
        tip.color = this._cDim;
    }

    private onCharCardTouch(ev: EventTouch): void {
        const target = ev.target as Node | null;
        const meta = this._meta;
        if (!target || !meta) return;
        const idx = parseInt(target.name.replace('CharCard', ''), 10);
        if (!Number.isFinite(idx) || idx < 0 || idx >= CHARACTERS.length) return;
        const def = CHARACTERS[idx];
        if (isCharUnlocked(meta.unlocks, def.id)) {
            this._charId = def.id;
            this._tip = '';
            this._switchView('main');
            this.render();
            return;
        }
        const nodeId = `char_${def.id}`;
        const price = UNLOCK_BY_ID[nodeId] ? UNLOCK_BY_ID[nodeId].price : 0;
        if (meta.magnets < price) {
            this._tip = `还差 ${price - meta.magnets} 贴`;
            this.render();
            return;
        }
        if (this.onBuyUnlock) this.onBuyUnlock(nodeId);
    }

    private onCharStartTouch(): void {
        this._switchView('main');
        this._emitStart('normal');
    }

    private onBackTouch(): void {
        this._tip = '';
        this._switchView('main');
        this.render();
    }

    // ==================== 图鉴 ====================

    private _buildCodex(): void {
        const root = this._root;
        if (!root) return;
        const view = this._makeView(root, 'CodexView');
        this._codexView = view;

        const title = this._makeLabel(view, 'CodexTitle', 0, 470, 30, Label.HorizontalAlign.CENTER, 640);
        title.color = this._cAccent;
        this._codexTitle = title;

        const xs = [-255, -85, 85, 255];
        let idx = 0;
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 4; col++) {
                if (idx >= ITEMS.length) break;
                const y = 400 - row * 74;
                const cell = this._makeCard(view, `CodexCell${idx}`, xs[col], y, 160, 62);
                const label = this._makeLabel(cell, `CodexLabel${idx}`, -72, 0, 15, Label.HorizontalAlign.LEFT, 150);
                this._codexLabels.push(label);
                idx++;
            }
        }

        const back = this._makeButton(view, 'CodexBack', 0, -470, 300, 60, '返回');
        back.on(Node.EventType.TOUCH_END, this.onBackTouch, this);
    }

    // ==================== 解锁树 ====================

    private _buildUnlocks(): void {
        const root = this._root;
        if (!root) return;
        const view = this._makeView(root, 'UnlockView');
        this._unlockView = view;

        const title = this._makeLabel(view, 'UnlockTitle', 0, 490, 28, Label.HorizontalAlign.CENTER, 640);
        title.color = this._cAccent;
        this._unlockTitle = title;

        for (let i = 0; i < UNLOCK_NODES.length; i++) {
            const y = 420 - i * 48;
            const row = this._makeCard(view, `UnlockRow${i}`, 0, y, 640, 42);
            const nl = this._makeLabel(row, `UnlockName${i}`, -300, 0, 17, Label.HorizontalAlign.LEFT, 420);
            const sl = this._makeLabel(row, `UnlockState${i}`, 290, 0, 16, Label.HorizontalAlign.RIGHT, 160);
            row.on(Node.EventType.TOUCH_END, this.onUnlockRowTouch, this);
            this._unlockRows.push(row);
            this._unlockNameLabels.push(nl);
            this._unlockStateLabels.push(sl);
        }

        const back = this._makeButton(view, 'UnlockBack', 0, -440, 300, 60, '返回');
        back.on(Node.EventType.TOUCH_END, this.onBackTouch, this);
    }

    private onUnlockRowTouch(ev: EventTouch): void {
        const target = ev.target as Node | null;
        const meta = this._meta;
        if (!target || !meta) return;
        const idx = parseInt(target.name.replace('UnlockRow', ''), 10);
        if (!Number.isFinite(idx) || idx < 0 || idx >= UNLOCK_NODES.length) return;
        const node = UNLOCK_NODES[idx];
        const owned = hasUnlock(meta.unlocks, node.id);
        if (owned) {
            const pal = PALETTE_NODES.indexOf(node.id);
            if (pal >= 0) {
                this._tip = '';
                if (this.onSelectPalette) this.onSelectPalette(pal + 1);
            }
            return;
        }
        if (meta.magnets < node.price) {
            this._tip = `${node.name} 还差 ${node.price - meta.magnets} 贴`;
            this.render();
            return;
        }
        if (this.onBuyUnlock) this.onBuyUnlock(node.id);
    }

    // ==================== 小部件 ====================

    private _makeView(root: Node, name: string): Node {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        root.addChild(node);
        node.active = false;
        return node;
    }

    private _makeCard(parent: Node, name: string, x: number, y: number, w: number, h: number): Node {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);
        ut.setAnchorPoint(0.5, 0.5);
        node.setPosition(x, y, 0);
        const g = node.addComponent(Graphics);
        g.fillColor = this._cCard;
        g.roundRect(-w / 2, -h / 2, w, h, 10);
        g.fill();
        parent.addChild(node);
        return node;
    }

    private _makeButton(parent: Node, name: string, x: number, y: number, w: number, h: number, text: string): Node {
        const node = this._makeCard(parent, name, x, y, w, h);
        const label = this._makeLabel(node, `${name}Label`, 0, 0, 24, Label.HorizontalAlign.CENTER, w - 24);
        label.string = text;
        label.color = this._cInk;
        return node;
    }

    /** 按钮底刷新：主按钮填充强调色 + 深色字，禁用时灰底灰字 */
    private _paintButton(node: Node | null, name: string, text: string, enabled: boolean): void {
        if (!node) return;
        const g = node.getComponent(Graphics);
        const ut = node.getComponent(UITransform);
        if (!g || !ut) return;
        const w = ut.contentSize.width;
        const h = ut.contentSize.height;
        g.clear();
        g.fillColor = enabled ? this._cAccent : this._cCard;
        g.roundRect(-w / 2, -h / 2, w, h, Math.round(h / 1.6));
        g.fill();
        if (!enabled) {
            g.lineWidth = 2;
            g.strokeColor = hex('#3A4256');
            g.roundRect(-w / 2, -h / 2, w, h, Math.round(h / 1.6));
            g.stroke();
        }
        const label = node.getComponentInChildren(Label);
        if (label) {
            label.string = text;
            label.color = enabled ? this._cInk : this._cDim;
        }
    }

    /**
     * 次级按钮：可点但比主按钮低调——卡片底 + 强调色描边 + 正文亮字。
     * 文字必须用 `_cText` 而不是 `_cInk`：`_cInk` 是给强调色填充的主按钮配的深色字，
     * 铺在 `_cCard`（#1C2638）上对比度只有 1.2:1，「角色 / 图鉴 / 解锁树」几乎看不见
     * （第二轮复核 R3 / N4 的视觉根因）。
     */
    private _paintSecondary(node: Node | null, text: string): void {
        if (!node) return;
        const g = node.getComponent(Graphics);
        const ut = node.getComponent(UITransform);
        if (!g || !ut) return;
        const w = ut.contentSize.width;
        const h = ut.contentSize.height;
        const radius = Math.round(h / 1.6);
        g.clear();
        g.fillColor = this._cCard;
        g.roundRect(-w / 2, -h / 2, w, h, radius);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = this._cAccent;
        g.roundRect(-w / 2, -h / 2, w, h, radius);
        g.stroke();
        const label = node.getComponentInChildren(Label);
        if (label) {
            label.string = text;
            label.color = this._cText;
        }
    }

    private _repaintCharCard(index: number, selected: boolean, unlocked: boolean): void {
        const node = this._charCards[index];
        if (!node) return;
        const g = node.getComponent(Graphics);
        const ut = node.getComponent(UITransform);
        if (!g || !ut) return;
        const w = ut.contentSize.width;
        const h = ut.contentSize.height;
        g.clear();
        g.fillColor = this._cCard;
        g.roundRect(-w / 2, -h / 2, w, h, 12);
        g.fill();
        g.lineWidth = selected ? 4 : 2;
        g.strokeColor = selected ? this._cAccent : (unlocked ? hex('#3A4658') : hex('#2B3244'));
        g.roundRect(-w / 2, -h / 2, w, h, 12);
        g.stroke();
    }

    private _repaintUnlockRow(index: number, owned: boolean, can: boolean): void {
        const node = this._unlockRows[index];
        if (!node) return;
        const g = node.getComponent(Graphics);
        const ut = node.getComponent(UITransform);
        if (!g || !ut) return;
        const w = ut.contentSize.width;
        const h = ut.contentSize.height;
        g.clear();
        g.fillColor = owned ? hex('#16202E') : this._cCard;
        g.roundRect(-w / 2, -h / 2, w, h, 8);
        g.fill();
        if (can) {
            g.lineWidth = 2;
            g.strokeColor = hex('#FFD65C');
            g.roundRect(-w / 2, -h / 2, w, h, 8);
            g.stroke();
        }
    }

    private _firstUnlockedChar(meta: FridgeSave): string {
        for (const c of CHARACTERS) if (isCharUnlocked(meta.unlocks, c.id)) return c.id;
        return 'pudding';
    }

    private _offButton(node: Node | null, handler: (...args: any[]) => void): void {
        if (node && node.isValid) node.off(Node.EventType.TOUCH_END, handler as any, this);
    }

    private _makeLabel(parent: Node, name: string, x: number, y: number, size: number, align: number, width: number): Label {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(width, size * 3);
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
        parent.addChild(node);
        return label;
    }
}
