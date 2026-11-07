/**
 * 小店日记 —— 运行时主组件。
 *
 * 场景里只需要一个挂在 Canvas 下的空节点（本组件），所有 UI 在 onLoad 中构建。
 *  - 点「点我赚钱」赚金币；四个设施各 5 级，费用指数增长
 *  - 收银台提供自动收入；店员提供全局加成；仓库提高离线收益效率
 *  - 进入场景按本地时间戳结算离线收益（上限 8 小时），大于 60 秒才弹窗
 *  - 每 5 秒自动存档，返回大厅 / 场景销毁时立即存档
 *
 * 约定：事件 handler 全部具名（红线 5）；onDestroy 只清 JS 引用（红线 4）。
 */

import { _decorator, Component, EventTouch, Graphics, Label, Node, UIOpacity } from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager } from '../../../common/managers/StorageManager';
import {
    UI,
    UiButton,
    createBackButton,
    createButton,
    createLabel,
    createNode,
    designPos,
    drawRoundRect,
    toast,
    toColor,
} from '../../../common/ui/GameUIKit';
import {
    IDLE_FACILITIES,
    IDLE_FACILITY_IDS,
    IDLE_MAX_LEVEL,
    IdleCore,
    IdleFacilityId,
    IdleSnapshot,
    formatIdleNumber,
    formatIdleRate,
} from './IdleCore';

const { ccclass } = _decorator;

const GAME_ID = 'idle';
const SAVE_KEY = 'save';
const SAVE_INTERVAL = 5;
const REFRESH_INTERVAL = 0.2;
/** 离线不足 60 秒不弹窗，避免频繁进出反复打断 */
const OFFLINE_POPUP_MIN_SEC = 60;

const COLOR_CARD = '#141F33';
const COLOR_CARD_STROKE = '#24324A';
const COLOR_PIP_ON = '#FBBF24';
const COLOR_PIP_OFF = '#24324A';

interface FacilityCard {
    id: IdleFacilityId;
    level: Label;
    effect: Label;
    next: Label;
    btn: UiButton;
    pips: Graphics;
}

interface IdleDismissData {
    dismiss: () => void;
}

/** 点击时飘起的 +N 金币提示 */
interface CoinFloater {
    node: Node;
    opacity: UIOpacity;
    life: number;
    ttl: number;
    baseY: number;
}

const FLOATER_TTL = 0.65;
const FLOATER_RISE = 70;
const COIN_PULSE_SEC = 0.14;

function onOverlayTouchStart(ev: EventTouch): void {
    ev.propagationStopped = true;
    const node = ev.currentTarget as Node;
    if (ev.target !== node) return;
    const data = (node as unknown as { __idleDismiss?: IdleDismissData }).__idleDismiss;
    if (data) data.dismiss();
}

@ccclass('IdleGame')
export class IdleGame extends Component {
    /** 浏览器探针用 */
    _core: IdleCore | null = null;

    private _cards: FacilityCard[] = [];
    private _coinsLabel: Label | null = null;
    private _rateLabel: Label | null = null;
    private _tapBtn: UiButton | null = null;
    private _offlineOverlay: Node | null = null;
    private _saveTimer = 0;
    private _refreshTimer = 0;
    private _floaters: CoinFloater[] = [];
    private _coinPulse = 0;

    onLoad(): void {
        this._core = this._load();
        this._buildUi();
        const result = this._core.settleOffline(Date.now());
        this._refreshAll();
        if (result.gain >= 1 && result.elapsedSec >= OFFLINE_POPUP_MIN_SEC) {
            this._showOfflineOverlay(
                result.elapsedSec,
                result.countedSec,
                result.gain,
                result.rate,
                result.capped,
            );
        }
        this._persist();
    }

    start(): void {
        this._refreshAll();
    }

    update(dt: number): void {
        const core = this._core;
        if (!core) return;

        core.tick(dt);

        this._saveTimer += dt;
        if (this._saveTimer >= SAVE_INTERVAL) {
            this._saveTimer = 0;
            this._persist();
        }

        this._refreshTimer += dt;
        if (this._refreshTimer >= REFRESH_INTERVAL) {
            this._refreshTimer = 0;
            this._refreshCoins();
            this._refreshCards();
        }

        this._tickFloaters(dt);
        this._tickCoinPulse(dt);
    }

    /** 飘字：向上浮 + 淡出；到寿命即销毁（用 update 泵推进，不用 scheduleOnce 自排期） */
    private _tickFloaters(dt: number): void {
        if (this._floaters.length === 0) return;
        const left: CoinFloater[] = [];
        for (let i = 0; i < this._floaters.length; i++) {
            const f = this._floaters[i];
            f.life += dt;
            const t = Math.min(1, f.life / f.ttl);
            if (!f.node || !f.node.isValid) continue;
            if (t >= 1) {
                f.node.destroy();
                continue;
            }
            const ease = 1 - (1 - t) * (1 - t);
            f.node.setPosition(0, f.baseY + FLOATER_RISE * ease, 0);
            f.opacity.opacity = Math.round(255 * (1 - t * t));
            left.push(f);
        }
        this._floaters = left;
    }

    private _tickCoinPulse(dt: number): void {
        if (this._coinPulse <= 0) return;
        this._coinPulse = Math.max(0, this._coinPulse - dt);
        const label = this._coinsLabel;
        if (!label || !label.node || !label.node.isValid) return;
        const t = this._coinPulse / COIN_PULSE_SEC;
        const scale = 1 + 0.08 * t;
        label.node.setScale(scale, scale, 1);
    }

    private _spawnFloater(text: string): void {
        if (this._floaters.length >= 6) {
            const oldest = this._floaters.shift();
            if (oldest && oldest.node && oldest.node.isValid) oldest.node.destroy();
        }
        const label = createLabel(this.node, text, 34, {
            x: 0,
            y: -360,
            bold: true,
            color: UI.warning,
            width: 320,
            height: 44,
        });
        label.node.setSiblingIndex(this.node.children.length - 1);
        const opacity = label.node.addComponent(UIOpacity);
        this._floaters.push({ node: label.node, opacity, life: 0, ttl: FLOATER_TTL, baseY: -360 });
    }

    onDestroy(): void {
        this._persist();
        this._core = null;
        this._cards = [];
        this._floaters = [];
        this._coinsLabel = null;
        this._rateLabel = null;
        this._tapBtn = null;
        this._offlineOverlay = null;
    }

    // ==================== 交互 ====================

    private onBack(): void {
        this._persist();
        SceneManager.gotoLobby();
    }

    private _onTapMoney(): void {
        const core = this._core;
        if (!core) return;
        const gain = core.clickPower;
        core.tap();
        this._refreshAll();
        this._spawnFloater(`+${formatIdleNumber(gain)}`);
        this._coinPulse = COIN_PULSE_SEC;
    }

    private _onBuy(id: IdleFacilityId): void {
        const core = this._core;
        if (!core) return;
        const cost = core.costOf(id);
        if (cost < 0) {
            toast(this.node, '已经满级了');
            return;
        }
        if (core.coins < cost) {
            toast(this.node, `还差 ${formatIdleNumber(cost - core.coins)} 金币`);
            return;
        }
        if (core.buy(id)) {
            this._refreshAll();
            this._persist();
        }
    }

    // ==================== 存档 ====================

    private _load(): IdleCore {
        const raw = StorageManager.instance.getItem(GAME_ID, SAVE_KEY);
        if (!raw) return new IdleCore(Date.now());
        let parsed: IdleSnapshot | null = null;
        try {
            parsed = JSON.parse(raw) as IdleSnapshot;
        } catch (err) {
            parsed = null;
        }
        return IdleCore.fromSnapshot(parsed, Date.now());
    }

    private _persist(): void {
        const core = this._core;
        if (!core) return;
        try {
            StorageManager.instance.setItem(GAME_ID, SAVE_KEY, JSON.stringify(core.snapshot(Date.now())));
        } catch (err) {
            console.warn('小店日记存档失败：', err);
        }
    }

    // ==================== UI 构建 ====================

    private _buildUi(): void {
        const bg = createNode('Bg', this.node, 720, 1280);
        const bgG = bg.addComponent(Graphics);
        drawRoundRect(bgG, 720, 1280, 0, toColor(UI.bg));

        const glowNode = createNode('Glow', this.node, 720, 1280);
        const glow = glowNode.addComponent(Graphics);
        glow.fillColor = toColor('#12203A');
        // 光斑压进左上角，避免圆弧边切过金币数字
        glow.circle(-360, 500, 280);
        glow.fill();
        glow.fillColor = toColor('#0E1A30');
        glow.circle(280, -420, 360);
        glow.fill();

        createBackButton(this.node, () => this.onBack());
        createLabel(this.node, '小店日记', 44, {
            ...this._at(360, 64),
            bold: true,
            width: 360,
            height: 66,
        });
        createLabel(this.node, 'IDLE SHOP', 15, {
            ...this._at(360, 104),
            color: UI.textMuted,
            width: 300,
            height: 24,
        });

        createLabel(this.node, '金币', 16, {
            ...this._at(360, 152),
            color: UI.textMuted,
            width: 300,
            height: 22,
        });
        this._coinsLabel = createLabel(this.node, '0', 60, {
            ...this._at(360, 192),
            bold: true,
            width: 660,
            height: 76,
            color: UI.warning,
        });
        this._rateLabel = createLabel(this.node, '', 22, {
            ...this._at(360, 244),
            color: UI.textDim,
            width: 660,
            height: 30,
        });

        for (let i = 0; i < IDLE_FACILITIES.length; i++) {
            const def = IDLE_FACILITIES[i];
            this._cards.push(this._buildCard(def.id, 340 + i * 168));
        }

        this._tapBtn = createButton(this.node, {
            w: 600,
            h: 140,
            text: '点我赚钱',
            fontSize: 36,
            fill: UI.primary,
            activeFill: '#1D4ED8',
            radius: 28,
            stroke: '#3B82F6',
            onTap: () => this._onTapMoney(),
        });
        this._tapBtn.node.setPosition(designPos(360, 1080));

        createLabel(this.node, '点击赚钱 · 升级设施提高每秒收入 · 离线也会赚钱（上限 8 小时）', 18, {
            ...this._at(360, 1192),
            color: UI.textMuted,
            width: 690,
            height: 26,
        });
    }

    private _buildCard(id: IdleFacilityId, yFromTop: number): FacilityCard {
        const def = IDLE_FACILITIES.find((f) => f.id === id);
        const nameText = def ? def.name : id;

        const node = createNode(`Card_${id}`, this.node, 560, 150);
        node.setPosition(designPos(360, yFromTop));
        const g = node.addComponent(Graphics);
        drawRoundRect(g, 560, 150, 18, toColor(COLOR_CARD), toColor(COLOR_CARD_STROKE), 2);

        createLabel(node, nameText, 30, {
            x: -250,
            y: 44,
            width: 240,
            height: 38,
            bold: true,
            align: 'left',
        });
        const level = createLabel(node, 'Lv 0/5', 22, {
            x: -250,
            y: 10,
            width: 120,
            height: 30,
            color: UI.textDim,
            align: 'left',
        });
        const effect = createLabel(node, '', 21, {
            x: -250,
            y: -24,
            width: 300,
            height: 28,
            align: 'left',
        });
        const next = createLabel(node, '', 18, {
            x: -250,
            y: -56,
            width: 320,
            height: 24,
            color: UI.textMuted,
            align: 'left',
        });

        const pipsNode = createNode('Pips', node, 110, 20);
        pipsNode.setPosition(-70, 10, 0);
        const pips = pipsNode.addComponent(Graphics);

        const btn = createButton(node, {
            w: 170,
            h: 80,
            text: '升级',
            fontSize: 22,
            fill: '#1E293B',
            activeFill: '#0E7490',
            radius: 14,
            stroke: '#26364F',
            onTap: () => this._onBuy(id),
        });
        btn.node.setPosition(180, 0, 0);

        return { id, level, effect, next, btn, pips };
    }

    private _at(xFromLeft: number, yFromTop: number): { x: number; y: number } {
        const p = designPos(xFromLeft, yFromTop);
        return { x: p.x, y: p.y };
    }

    // ==================== 刷新 ====================

    private _refreshAll(): void {
        this._refreshCoins();
        this._refreshCards();
        this._refreshTapButton();
    }

    private _refreshCoins(): void {
        const core = this._core;
        if (!core) return;
        if (this._coinsLabel) this._coinsLabel.string = formatIdleNumber(core.coins);
        if (this._rateLabel) {
            this._rateLabel.string = `每秒 +${formatIdleRate(core.autoRate)} · 每次点击 +${formatIdleRate(core.clickPower)}`;
        }
    }

    private _refreshTapButton(): void {
        const core = this._core;
        if (!core || !this._tapBtn) return;
        this._tapBtn.setText(`点我赚钱 +${formatIdleRate(core.clickPower)}`);
    }

    private _refreshCards(): void {
        const core = this._core;
        if (!core) return;
        for (let i = 0; i < this._cards.length; i++) {
            const card = this._cards[i];
            const lv = core.levelOf(card.id);
            const cost = core.costOf(card.id);
            card.level.string = `Lv ${lv}/${IDLE_MAX_LEVEL}`;
            card.effect.string = this._effectText(card.id, lv);
            if (cost < 0) {
                card.next.string = '';
                card.btn.setText('已满级');
                card.btn.setActive(false);
            } else {
                card.next.string = `下一级 ${this._effectText(card.id, lv + 1)}`;
                card.btn.setText(`升级 ${formatIdleNumber(cost)}`);
                card.btn.setActive(core.coins >= cost);
            }
            this._drawPips(card.pips, lv);
        }
    }

    private _drawPips(g: Graphics, level: number): void {
        g.clear();
        const size = 16;
        const gap = 8;
        const total = IDLE_MAX_LEVEL * size + (IDLE_MAX_LEVEL - 1) * gap;
        let x = -total / 2 + size / 2;
        for (let i = 0; i < IDLE_MAX_LEVEL; i++) {
            g.fillColor = toColor(i < level ? COLOR_PIP_ON : COLOR_PIP_OFF);
            g.roundRect(x - size / 2, -size / 2, size, size, 4);
            g.fill();
            x += size + gap;
        }
    }

    private _effectText(id: IdleFacilityId, level: number): string {
        switch (id) {
            case 'shelf':
                return `点击 +${level * 2}`;
            case 'counter':
                return `自动 +${formatIdleRate(level * 0.6)}/秒`;
            case 'clerk':
                return `全局收益 +${level * 20}%`;
            case 'warehouse':
                return `离线效率 ${Math.round(Math.min(1, 0.4 + 0.12 * level) * 100)}%`;
            default:
                return '';
        }
    }

    // ==================== 离线结算面板 ====================

    private _showOfflineOverlay(
        elapsedSec: number,
        countedSec: number,
        gain: number,
        rate: number,
        capped: boolean,
    ): void {
        this._destroyOfflineOverlay();

        const root = createNode('OfflineOverlay', this.node, 720, 1280);
        root.on(Node.EventType.TOUCH_START, onOverlayTouchStart);
        (root as unknown as { __idleDismiss?: IdleDismissData }).__idleDismiss = { dismiss: () => this._dismissOfflineOverlay() };
        const dim = root.addComponent(Graphics);
        dim.fillColor = toColor(UI.overlay, 215);
        dim.rect(-360, -640, 720, 1280);
        dim.fill();

        const panel = createNode('Panel', root, 560, 480);
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, 560, 480, 24, toColor(UI.panel), toColor(UI.panelStroke), 2);

        const efficiency = Math.round((this._core ? this._core.offlineRate : 0) * 100);

        createLabel(panel, '离线收益', 42, {
            x: 0, y: 152,
            bold: true,
            color: UI.warning,
            width: 460,
            height: 56,
        });
        createLabel(panel, `离开 ${this._durationText(elapsedSec)}`, 22, {
            x: 0, y: 96,
            color: UI.textDim,
            width: 460,
            height: 30,
        });
        createLabel(panel, `+${formatIdleNumber(gain)}`, 56, {
            x: 0, y: 38,
            bold: true,
            color: UI.success,
            width: 460,
            height: 72,
        });
        createLabel(panel, `离线效率 ${efficiency}% · 每秒 +${formatIdleRate(rate)}`, 20, {
            x: 0, y: -18,
            color: UI.textMuted,
            width: 460,
            height: 28,
        });
        if (capped) {
            createLabel(panel, '离线时长超过 8 小时，已按上限结算', 18, {
                x: 0, y: -56,
                color: UI.warning,
                width: 460,
                height: 26,
            });
        } else if (countedSec < elapsedSec) {
            createLabel(panel, '部分时长未计入收益', 18, {
                x: 0, y: -56,
                color: UI.textMuted,
                width: 460,
                height: 26,
            });
        }

        const ok = createButton(panel, {
            w: 280,
            h: 78,
            text: '继续经营',
            fontSize: 26,
            fill: UI.primary,
            activeFill: UI.primary,
            radius: 16,
            onTap: () => this._dismissOfflineOverlay(),
        });
        ok.node.setPosition(0, -170, 0);

        this._offlineOverlay = root;
    }

    private _durationText(seconds: number): string {
        const total = Math.max(0, Math.floor(seconds));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
        if (minutes > 0) return `${minutes} 分钟`;
        return `${total} 秒`;
    }

    private _dismissOfflineOverlay(): void {
        this._destroyOfflineOverlay();
    }

    private _destroyOfflineOverlay(): void {
        if (this._offlineOverlay && this._offlineOverlay.isValid) {
            this._offlineOverlay.destroy();
        }
        this._offlineOverlay = null;
    }
}
