/**
 * 守卫塔楼 —— 运行时主组件。
 *
 * 场景里只需要一个挂在 Canvas 下的空节点（本组件），所有 UI 在 onLoad 中构建。
 *  - 沿路径布置炮塔，撑过 10 波
 *  - 4 种塔（机枪 / 迫击炮 / 冰霜 / 狙击）× 3 级，塔位固定
 *  - 单 Graphics 整盘重绘；暂停时（面板打开）不推进逻辑
 *  - 金币 / 生命 / 波次 / 最远波次存档
 *
 * 约定：事件 handler 全部具名（红线 5）；onDestroy 只清 JS 引用（红线 4）；
 *      逻辑用 update 固定步长泵推进，不用 scheduleOnce 自排期。
 */

import { _decorator, Component, EventTouch, Graphics, Label, Node, UIOpacity, UITransform, Vec3 } from 'cc';
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
    TD_ENEMIES,
    TD_MAPS,
    TD_MAP_COUNT,
    TD_TOWERS,
    TD_TOWER_MAX_LEVEL,
    TD_TOWER_ORDER,
    TD_WAVES,
    TD_WAVE_COUNT,
    TDEnemyKind,
    TDSave,
    TDTowerKind,
    createDefaultSave,
    getTDMap,
    parseTDSave,
} from './TDConfig';
import { TDCore, TDEnemyState, TDTowerState } from './TDCore';

const { ccclass } = _decorator;

const GAME_ID = 'tower_defense';
const SAVE_KEY = 'save';

/** 格子大小（设计像素） */
const CELL = 66;
const COLS = 9;
const ROWS = 12;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const BOARD_CX = 360;
const BOARD_CY = 626;
/** 固定步长 */
const FIXED_DT = 1 / 60;
/** 每帧最多推进的固定步数 */
const MAX_STEPS_1X = 3;
const MAX_STEPS_2X = 6;

const COLOR_BOARD = '#0E1A2E';
const COLOR_BOARD_EDGE = '#22334F';
const COLOR_GRID = '#16233B';
const COLOR_PATH = '#283955';
const COLOR_PATH_INNER = '#3A5075';
const COLOR_SLOT = '#4C6690';
const COLOR_SLOT_FILL = '#152238';
const COLOR_START = '#22C55E';
const COLOR_END = '#EF4444';
const COLOR_HP_BACK = '#0A1120';
const COLOR_HP = '#22C55E';
const COLOR_HP_LOW = '#EF4444';
const COLOR_RANGE = '#F8FAFC';

/** 面板弹出动画时长 */
const PANEL_IN_SEC = 0.18;

const TOWER_COLORS: Record<TDTowerKind, string> = {
    gun: '#38BDF8',
    mortar: '#F59E0B',
    frost: '#22D3EE',
    sniper: '#A855F7',
};

const ENEMY_COLORS: Record<TDEnemyKind, string> = {
    grunt: '#EF4444',
    runner: '#F97316',
    tank: '#94A3B8',
    boss: '#E11D48',
};

@ccclass('TDGame')
export class TDGame extends Component {
    /** 浏览器探针用 */
    core: TDCore | null = null;
    mapId = 1;
    /** 倍速 */
    speed = 1;
    /** 面板打开时暂停逻辑 */
    paused = false;

    private _save: TDSave = createDefaultSave();
    private _board: Node | null = null;
    private _gfx: Graphics | null = null;
    private _waveLabel: Label | null = null;
    private _goldLabel: Label | null = null;
    private _livesLabel: Label | null = null;
    private _statusLabel: Label | null = null;
    private _startBtn: UiButton | null = null;
    private _speedBtn: UiButton | null = null;
    private _panel: Node | null = null;
    /** 面板弹出动画：目标节点 + 剩余时间（用 update 泵推进） */
    private _panelNode: Node | null = null;
    private _panelAnim = 0;
    private _selectedSlot = -1;

    private _acc = 0;
    private _hudTimer = 0;
    private _lastPhase = '';
    private _lastWave = -1;

    onLoad(): void {
        this._save = this._loadSave();
        this._buildUi();
        this._startMap(this._save.lastMap);
    }

    update(dt: number): void {
        const core = this.core;
        if (!core) return;

        if (!this.paused && !core.ended) {
            const maxSteps = this.speed >= 2 ? MAX_STEPS_2X : MAX_STEPS_1X;
            this._acc += dt * this.speed;
            if (this._acc > FIXED_DT * maxSteps) this._acc = FIXED_DT * maxSteps;
            let steps = 0;
            while (this._acc >= FIXED_DT && steps < maxSteps) {
                core.step(FIXED_DT);
                this._acc -= FIXED_DT;
                steps++;
            }
            const events = core.drainEvents();
            if (events.length > 0) this._handleEvents(events);
        }

        this._drawBoard();
        this._tickPanelIn(dt);
        this._hudTimer -= dt;
        if (this._hudTimer <= 0) {
            this._hudTimer = 0.1;
            this._refreshHud();
        }
    }

    onDestroy(): void {
        this.core = null;
        this._board = null;
        this._gfx = null;
        this._waveLabel = null;
        this._goldLabel = null;
        this._livesLabel = null;
        this._statusLabel = null;
        this._startBtn = null;
        this._speedBtn = null;
        this._panel = null;
    }

    // ==================== 开局 / 地图 ====================

    private _startMap(mapId: number): void {
        const id = Math.max(1, Math.min(TD_MAP_COUNT, Math.floor(mapId)));
        this.mapId = id;
        this.core = TDCore.create(id);
        this.speed = 1;
        this.paused = false;
        this._acc = 0;
        this._selectedSlot = -1;
        this._lastPhase = '';
        this._lastWave = -1;
        this._save.lastMap = id;
        this._persist();
        this._destroyPanel();
        this._refreshHud();
        this._drawBoard();
    }

    private _restartMap(): void {
        this._startMap(this.mapId);
    }

    private _nextMap(): void {
        const next = (this.mapId % TD_MAP_COUNT) + 1;
        this._startMap(next);
    }

    private onBack(): void {
        this._persist();
        SceneManager.gotoLobby();
    }

    // ==================== 事件 ====================

    private _handleEvents(events: string[]): void {
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (ev.indexOf('leak:') === 0) {
                const kind = ev.slice(5) as TDEnemyKind;
                const def = TD_ENEMIES[kind];
                toast(this.node, `${def ? def.name : '敌人'} 突破防线！-${def ? def.leak : 1}`, 1.1, 990);
            } else if (ev === 'boss') {
                toast(this.node, 'Boss 出现！', 1.4, 990);
            } else if (ev === 'waveClear') {
                this._onWaveCleared();
            } else if (ev === 'won') {
                this._finish(true);
            } else if (ev === 'lost') {
                this._finish(false);
            }
        }
        this._refreshHud();
    }

    private _onWaveCleared(): void {
        const core = this.core;
        if (!core) return;
        // waveClear 事件在 waveIndex 自增之后才被取走，所以「已清波数」= 当前下标（通关时 = 总波数）
        const cleared = core.phase === 'won' ? TD_WAVE_COUNT : core.waveIndex;
        const idx = this.mapId - 1;
        if (cleared > this._save.bestWave[idx]) {
            this._save.bestWave[idx] = cleared;
            this._persist();
        }
        const def = TD_WAVES[cleared - 1];
        if (core.phase === 'prep' && def) {
            toast(this.node, `第 ${cleared} 波守住 · +${def.bonus} 金币`, 1.3, 990);
        }
    }

    private _finish(win: boolean): void {
        const core = this.core;
        if (!core) return;
        const idx = this.mapId - 1;
        const reached = win ? TD_WAVE_COUNT : core.waveIndex;
        if (reached > this._save.bestWave[idx]) this._save.bestWave[idx] = reached;
        this._save.totalKills += core.totalKills;
        this._persist();
        this._showResult(win);
    }

    // ==================== 输入 ====================

    private onBoardTouch(ev: EventTouch): void {
        const core = this.core;
        const board = this._board;
        if (!core || !board || !board.isValid || core.ended) return;
        const ut = board.getComponent(UITransform);
        if (!ut) return;
        const ui = ev.getUILocation();
        const local = ut.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const col = local.x / CELL + COLS / 2;
        const row = ROWS / 2 - local.y / CELL;
        if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;

        let best = -1;
        let bestDist = 0.62;
        for (let i = 0; i < core.slots.length; i++) {
            const slot = core.slots[i];
            const d = Math.hypot(slot.x - col, slot.y - row);
            if (d < bestDist) {
                bestDist = d;
                best = i;
            }
        }
        if (best < 0) return;
        this._selectedSlot = best;
        if (core.slots[best].tower) this._openTowerPanel(best);
        else this._openBuildPanel(best);
        this._drawBoard();
    }

    private onStartWave(): void {
        const core = this.core;
        if (!core || core.phase !== 'prep') return;
        core.startWave();
        this._acc = 0;
        this._refreshHud();
    }

    private onToggleSpeed(): void {
        this.speed = this.speed >= 2 ? 1 : 2;
        if (this._speedBtn) this._speedBtn.setText(`倍速 ${this.speed}x`);
        this._acc = 0;
    }

    private onRestart(): void {
        this._restartMap();
    }

    private onCycleMap(): void {
        this._nextMap();
    }

    private onOverlayTouchStart(ev: EventTouch): void {
        ev.propagationStopped = true;
    }

    private onClosePanel(): void {
        this._destroyPanel();
        this._selectedSlot = -1;
        this.paused = false;
        this._drawBoard();
    }

    // ==================== 面板 ====================

    private _openBuildPanel(slotIndex: number): void {
        const core = this.core;
        if (!core) return;
        this._destroyPanel();
        this.paused = true;

        const root = createNode('BuildPanel', this.node, 720, 1280);
        root.on(Node.EventType.TOUCH_START, this.onOverlayTouchStart, this);
        // 遮罩改淡（170 → 90）：面板贴着塔位时，玩家仍要能看见路径与其它塔
        const dim = createNode('Dim', root, 720, 1280);
        const dimG = dim.addComponent(Graphics);
        dimG.fillColor = toColor(UI.overlay, 90);
        dimG.rect(-360, -640, 720, 1280);
        dimG.fill();
        // 点空白处关闭（面板自己是 root 的子节点，事件会被 onOverlayTouchStart 截住）
        dim.on(Node.EventType.TOUCH_END, this.onClosePanel, this);

        const panelW = 440;
        const panelH = 400;
        const panel = createNode('Panel', root, panelW, panelH);
        panel.setPosition(this._panelAnchor(slotIndex, panelW, panelH));
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, panelW, panelH, 22, toColor(UI.panel), toColor(UI.panelStroke), 2);

        createLabel(panel, '建造炮塔', 28, {
            x: 0, y: 168, bold: true, color: UI.text, width: 380, height: 38,
        });
        createLabel(panel, `金币 ${core.gold}`, 18, {
            x: 0, y: 134, color: UI.warning, width: 300, height: 26,
        });

        const positions = [
            { x: -104, y: 56 },
            { x: 104, y: 56 },
            { x: -104, y: -62 },
            { x: 104, y: -62 },
        ];
        for (let i = 0; i < TD_TOWER_ORDER.length; i++) {
            const kind = TD_TOWER_ORDER[i];
            const def = TD_TOWERS[kind];
            const cost = def.levels[0].cost;
            const affordable = core.gold >= cost;
            const btn = createButton(panel, {
                w: 196,
                h: 106,
                text: `${def.name} · ${cost} 金`,
                fontSize: 22,
                fill: affordable ? '#17243C' : '#101A2B',
                activeFill: TOWER_COLORS[kind],
                textColor: affordable ? UI.text : UI.textMuted,
                radius: 16,
                stroke: '#2A3A57',
                onTap: () => this.onBuild(kind),
            });
            btn.node.setPosition(positions[i].x, positions[i].y, 0);
            btn.label.node.setPosition(0, 16, 0);
            createLabel(btn.node, def.desc, 14, {
                x: 0, y: -28, color: UI.textMuted, width: 180, height: 22,
            });
        }

        const close = createButton(panel, {
            w: 180, h: 54, text: '关闭', fontSize: 22,
            fill: '#1E293B', activeFill: UI.accentDark, radius: 14, stroke: '#26364F',
            onTap: () => this.onClosePanel(),
        });
        close.node.setPosition(0, -158, 0);

        this._playPanelIn(panel);
        this._panel = root;
    }

    /**
     * 气泡定位：贴在**被点的塔位**旁边，而不是固定从底部弹出一块。
     *
     * 原来的 680×460 面板固定在屏幕下半屏，一打开就盖住下半张地图（第二轮复核 N13），
     * 玩家看不到自己点的是哪个格子、周围还有没有路。现在：
     * 1. 默认放在塔位上方（气泡底边距塔位 18 设计像素）；
     * 2. 上方放不下就翻到下方；
     * 3. 最后再把 x / y 夹进画布安全区，避免贴边溢出。
     */
    private _panelAnchor(slotIndex: number, w: number, h: number): Vec3 {
        const slot = this.core ? this.core.slots[slotIndex] : null;
        const sx = slot ? this._lx(slot.x) : 0;
        // 棋盘节点在 (0, 14)（designPos(BOARD_CX, BOARD_CY)）
        const sy = slot ? 14 + this._ly(slot.y) : 14;
        const gap = CELL / 2 + 18;

        let y = sy + gap + h / 2;
        const topLimit = 640 - 12;
        const bottomLimit = -640 + 12;
        if (y + h / 2 > topLimit) y = sy - gap - h / 2;
        y = Math.max(bottomLimit + h / 2, Math.min(topLimit - h / 2, y));

        const x = Math.max(-360 + w / 2 + 8, Math.min(360 - w / 2 - 8, sx));
        return new Vec3(x, y, 0);
    }

    private onBuild(kind: TDTowerKind): void {
        const core = this.core;
        if (!core) return;
        const res = core.build(this._selectedSlot, kind);
        if (!res.ok) {
            if (res.reason === 'gold') toast(this.node, '金币不足', 1.1, 1120);
            else if (res.reason === 'occupied') toast(this.node, '这个塔位已经有塔了', 1.1, 1120);
            return;
        }
        toast(this.node, `${TD_TOWERS[kind].name} 建造完成`, 0.9, 1120);
        this._destroyPanel();
        this.paused = false;
        this._refreshHud();
        this._drawBoard();
    }

    private _openTowerPanel(slotIndex: number): void {
        const core = this.core;
        if (!core) return;
        const tower = core.slots[slotIndex].tower;
        if (!tower) return;
        this._destroyPanel();
        this.paused = true;

        const def = TD_TOWERS[tower.kind];
        const stats = def.levels[tower.level - 1];
        const maxLevel = tower.level >= TD_TOWER_MAX_LEVEL;
        const upCost = maxLevel ? 0 : def.levels[tower.level].cost;
        const refund = Math.floor(tower.invested * 0.5);

        const root = createNode('TowerPanel', this.node, 720, 1280);
        root.on(Node.EventType.TOUCH_START, this.onOverlayTouchStart, this);
        const dim = createNode('Dim', root, 720, 1280);
        const dimG = dim.addComponent(Graphics);
        dimG.fillColor = toColor(UI.overlay, 90);
        dimG.rect(-360, -640, 720, 1280);
        dimG.fill();
        dim.on(Node.EventType.TOUCH_END, this.onClosePanel, this);

        const panelW = 430;
        const panelH = 340;
        const panel = createNode('Panel', root, panelW, panelH);
        panel.setPosition(this._panelAnchor(slotIndex, panelW, panelH));
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, panelW, panelH, 22, toColor(UI.panel), toColor(UI.panelStroke), 2);

        createLabel(panel, `${def.name} Lv.${tower.level}`, 30, {
            x: 0, y: 138, bold: true, color: TOWER_COLORS[tower.kind], width: 380, height: 40,
        });
        createLabel(panel, def.desc, 17, {
            x: 0, y: 104, color: UI.textDim, width: 390, height: 24,
        });
        const statParts = [
            `伤害 ${stats.damage}`,
            `射程 ${stats.range.toFixed(1)}`,
            `间隔 ${stats.interval.toFixed(2)}s`,
        ];
        if (def.splash > 0) statParts.push(`溅射 ${def.splash.toFixed(1)}`);
        if (def.slowFactor > 0) statParts.push(`减速 ${Math.round(def.slowFactor * 100)}%`);
        const statText = statParts.join('   ');
        createLabel(panel, statText, 17, {
            x: 0, y: 56, color: UI.textDim, width: 390, height: 48,
        });

        const upgradeBtn = createButton(panel, {
            w: 190,
            h: 88,
            text: maxLevel ? '已满级' : `升级 ${upCost} 金`,
            fontSize: 23,
            fill: maxLevel ? '#101A2B' : '#17243C',
            activeFill: UI.success,
            textColor: maxLevel ? UI.textMuted : UI.text,
            radius: 16,
            stroke: '#2A3A57',
            onTap: () => this.onUpgrade(),
        });
        upgradeBtn.node.setPosition(-100, -20, 0);

        const sellBtn = createButton(panel, {
            w: 190,
            h: 88,
            text: `出售 +${refund}`,
            fontSize: 23,
            fill: '#17243C',
            activeFill: UI.danger,
            radius: 16,
            stroke: '#2A3A57',
            onTap: () => this.onSell(),
        });
        sellBtn.node.setPosition(100, -20, 0);

        const close = createButton(panel, {
            w: 170, h: 50, text: '关闭', fontSize: 21,
            fill: '#1E293B', activeFill: '#0E7490', radius: 14, stroke: '#26364F',
            onTap: () => this.onClosePanel(),
        });
        close.node.setPosition(0, -124, 0);

        this._playPanelIn(panel);
        this._panel = root;
    }

    private onUpgrade(): void {
        const core = this.core;
        if (!core || this._selectedSlot < 0) return;
        const res = core.upgrade(this._selectedSlot);
        if (!res.ok) {
            if (res.reason === 'gold') toast(this.node, '金币不足', 1.1, 1120);
            else if (res.reason === 'max') toast(this.node, '已经满级了', 1.1, 1120);
            return;
        }
        toast(this.node, `升级完成 · -${res.cost} 金`, 0.9, 1120);
        const slot = this._selectedSlot;
        this._destroyPanel();
        this.paused = false;
        this._selectedSlot = slot;
        this._openTowerPanel(slot);
        this._refreshHud();
        this._drawBoard();
    }

    private onSell(): void {
        const core = this.core;
        if (!core || this._selectedSlot < 0) return;
        const res = core.sell(this._selectedSlot);
        if (!res.ok) return;
        toast(this.node, `出售成功 · +${res.refund} 金`, 0.9, 1120);
        this._selectedSlot = -1;
        this._destroyPanel();
        this.paused = false;
        this._refreshHud();
        this._drawBoard();
    }

    // ==================== 结算 / 换图 ====================

    private _showResult(win: boolean): void {
        this._destroyPanel();
        this.paused = true;

        const root = createNode('ResultOverlay', this.node, 720, 1280);
        root.on(Node.EventType.TOUCH_START, this.onOverlayTouchStart, this);
        const dim = root.addComponent(Graphics);
        dim.fillColor = toColor(UI.overlay, 220);
        dim.rect(-360, -640, 720, 1280);
        dim.fill();

        const panel = createNode('Panel', root, 580, 480);
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, 580, 480, 24, toColor(UI.panel), toColor(UI.panelStroke), 2);

        createLabel(panel, win ? '守住了！' : '防线失守', 44, {
            x: 0, y: 160, bold: true,
            color: win ? UI.success : UI.danger,
            width: 500, height: 60,
        });
        const core = this.core;
        const wave = core ? core.waveIndex + 1 : 0;
        createLabel(panel, `${getTDMap(this.mapId).name} · 第 ${Math.min(wave, TD_WAVE_COUNT)} / 10 波`, 22, {
            x: 0, y: 100, color: UI.textDim, width: 500, height: 30,
        });
        if (core) {
            createLabel(panel, `击杀 ${core.totalKills} · 剩余生命 ${core.lives}`, 20, {
                x: 0, y: 62, color: UI.textMuted, width: 500, height: 26,
            });
            if (!win) {
                createLabel(panel, `原因：累计漏过 ${core.totalLeaks} 只怪`, 19, {
                    x: 0, y: 24, color: UI.danger, width: 500, height: 24,
                });
            }
        }

        const again = createButton(panel, {
            w: 230, h: 78, text: '再玩一次', fontSize: 25,
            fill: UI.primary, activeFill: UI.primary, radius: 16,
            onTap: () => this.onRestart(),
        });
        again.node.setPosition(-125, -30, 0);

        const mapBtn = createButton(panel, {
            w: 230, h: 78, text: '换一张图', fontSize: 25,
            fill: '#1E293B', activeFill: '#0E7490', radius: 16, stroke: '#26364F',
            onTap: () => this.onCycleMap(),
        });
        mapBtn.node.setPosition(125, -30, 0);

        const lobby = createButton(panel, {
            w: 300, h: 70, text: '返回大厅', fontSize: 24,
            fill: '#1E293B', activeFill: '#0E7490', radius: 14, stroke: '#26364F',
            onTap: () => this.onBack(),
        });
        lobby.node.setPosition(0, -150, 0);

        this._playPanelIn(panel);
        this._panel = root;
    }

    private _destroyPanel(): void {
        if (this._panel && this._panel.isValid) this._panel.destroy();
        this._panel = null;
        this._panelNode = null;
        this._panelAnim = 0;
    }

    /** 面板弹出：从 0.92 缩放到 1 并淡入 */
    private _playPanelIn(panel: Node): void {
        this._panelNode = panel;
        this._panelAnim = PANEL_IN_SEC;
        panel.setScale(0.92, 0.92, 1);
        panel.addComponent(UIOpacity).opacity = 0;
    }

    private _tickPanelIn(dt: number): void {
        if (this._panelAnim <= 0) return;
        this._panelAnim = Math.max(0, this._panelAnim - dt);
        const node = this._panelNode;
        if (!node || !node.isValid) {
            this._panelAnim = 0;
            return;
        }
        const p = 1 - this._panelAnim / PANEL_IN_SEC;
        const ease = 1 - (1 - p) * (1 - p);
        const s = 0.92 + 0.08 * ease;
        node.setScale(s, s, 1);
        const op = node.getComponent(UIOpacity);
        if (op) op.opacity = Math.round(255 * ease);
    }

    // ==================== 存档 ====================

    private _loadSave(): TDSave {
        try {
            const raw = StorageManager.instance.getItem(GAME_ID, SAVE_KEY);
            if (!raw) return createDefaultSave();
            return parseTDSave(JSON.parse(raw));
        } catch (err) {
            console.warn('守卫塔楼读档失败：', err);
            return createDefaultSave();
        }
    }

    private _persist(): void {
        try {
            StorageManager.instance.setItem(GAME_ID, SAVE_KEY, JSON.stringify(this._save));
        } catch (err) {
            console.warn('守卫塔楼存档失败：', err);
        }
    }

    // ==================== UI 构建 ====================

    private _buildUi(): void {
        const bg = createNode('Bg', this.node, 720, 1280);
        const bgG = bg.addComponent(Graphics);
        drawRoundRect(bgG, 720, 1280, 0, toColor(UI.bg));

        createBackButton(this.node, () => this.onBack());
        createLabel(this.node, '守卫塔楼', 44, { ...this._at(360, 64), bold: true, width: 380, height: 66 });
        createLabel(this.node, 'TOWER DEFENSE', 15, { ...this._at(360, 104), color: UI.textMuted, width: 320, height: 24 });

        this._waveLabel = createLabel(this.node, '下一波 1 / 10', 24, {
            ...this._at(150, 156), bold: true, width: 240, height: 34,
        });
        this._goldLabel = createLabel(this.node, '金币 0', 24, {
            ...this._at(360, 156), bold: true, color: UI.warning, width: 240, height: 34,
        });
        this._livesLabel = createLabel(this.node, '生命 10/10', 24, {
            ...this._at(570, 156), bold: true, color: UI.danger, width: 240, height: 34,
        });

        this._board = createNode('Board', this.node, BOARD_W, BOARD_H);
        this._board.setPosition(designPos(BOARD_CX, BOARD_CY));
        // 棋盘（含射程圈）必须压在 HUD 下面：射程圆没有裁剪，若 Board 后创建会盖住
        // 「下一波 / 金币」文字（第二轮复核 N13）。Bg 之后、HUD 之前即可。
        this._board.setSiblingIndex(1);
        this._gfx = this._board.addComponent(Graphics);
        this._board.on(Node.EventType.TOUCH_END, this.onBoardTouch, this);

        this._statusLabel = createLabel(this.node, '', 18, {
            ...this._at(360, 1046), color: UI.textDim, width: 660, height: 26,
        });

        this._startBtn = createButton(this.node, {
            w: 300, h: 84, text: '开始第 1 波', fontSize: 26,
            fill: UI.primary, activeFill: UI.success, radius: 18,
            onTap: () => this.onStartWave(),
        });
        this._startBtn.node.setPosition(designPos(360, 1120));

        const mapBtn = createButton(this.node, {
            w: 180, h: 72, text: '换图', fontSize: 22,
            fill: '#1E293B', activeFill: '#0E7490', radius: 16, stroke: '#26364F',
            onTap: () => this.onCycleMap(),
        });
        mapBtn.node.setPosition(designPos(112, 1120));

        this._speedBtn = createButton(this.node, {
            w: 180, h: 72, text: '倍速 1x', fontSize: 22,
            fill: '#1E293B', activeFill: '#0E7490', radius: 16, stroke: '#26364F',
            onTap: () => this.onToggleSpeed(),
        });
        this._speedBtn.node.setPosition(designPos(608, 1120));

        createLabel(this.node, '点空塔位建塔 · 点塔升级 / 出售 · 漏怪扣生命', 17, {
            ...this._at(360, 1232), color: UI.textMuted, width: 660, height: 24,
        });
    }

    private _at(xFromLeft: number, yFromTop: number): { x: number; y: number } {
        const p = designPos(xFromLeft, yFromTop);
        return { x: p.x, y: p.y };
    }

    private _refreshHud(): void {
        const core = this.core;
        if (!core) return;
        if (this._waveLabel) {
            const wave = Math.min(core.waveIndex + 1, TD_WAVE_COUNT);
            this._waveLabel.string = core.phase === 'running'
                ? `第 ${wave} / 10 波`
                : `下一波 ${wave} / 10`;
        }
        if (this._goldLabel) this._goldLabel.string = `金币 ${core.gold}`;
        if (this._livesLabel) this._livesLabel.string = `生命 ${core.lives}/${core.map.lives}`;
        if (this._startBtn) {
            const show = core.phase === 'prep';
            this._startBtn.node.active = show;
            if (show) this._startBtn.setText(`开始第 ${Math.min(core.waveIndex + 1, TD_WAVE_COUNT)} 波`);
        }
        if (this._statusLabel) {
            if (core.phase === 'prep') {
                this._statusLabel.string = `准备阶段 · 第 ${Math.min(core.waveIndex + 1, TD_WAVE_COUNT)} 波即将来袭`;
            } else if (core.phase === 'running') {
                const remain = core.aliveEnemyCount + core.pendingSpawnCount;
                this._statusLabel.string = `第 ${Math.min(core.waveIndex + 1, TD_WAVE_COUNT)} 波 · 剩余敌人 ${remain}`;
            } else {
                this._statusLabel.string = '';
            }
        }
        if (this._speedBtn) this._speedBtn.setText(`倍速 ${this.speed}x`);
    }

    // ==================== 绘制 ====================

    private _drawBoard(): void {
        const g = this._gfx;
        const core = this.core;
        if (!g || !core) return;
        g.clear();

        // 底板
        g.fillColor = toColor(COLOR_BOARD);
        g.roundRect(-BOARD_W / 2, -BOARD_H / 2, BOARD_W, BOARD_H, 18);
        g.fill();
        g.strokeColor = toColor(COLOR_BOARD_EDGE);
        g.lineWidth = 2;
        g.roundRect(-BOARD_W / 2, -BOARD_H / 2, BOARD_W, BOARD_H, 18);
        g.stroke();

        // 淡网格，帮助判断塔位与路径的关系
        const inset = 10;
        const lw = 1.5;
        g.fillColor = toColor(COLOR_GRID, 150);
        for (let c = 1; c < COLS; c++) {
            g.rect(-BOARD_W / 2 + c * CELL - lw / 2, -BOARD_H / 2 + inset, lw, BOARD_H - inset * 2);
        }
        for (let r = 1; r < ROWS; r++) {
            g.rect(-BOARD_W / 2 + inset, -BOARD_H / 2 + r * CELL - lw / 2, BOARD_W - inset * 2, lw);
        }
        g.fill();

        this._drawPath(g, core);

        // 塔位
        for (let i = 0; i < core.slots.length; i++) {
            const slot = core.slots[i];
            if (!slot.tower) this._drawSlot(g, slot.x, slot.y, i === this._selectedSlot);
        }

        // 选中塔的射程圈
        if (this._selectedSlot >= 0) {
            const slot = core.slots[this._selectedSlot];
            if (slot && slot.tower) {
                const def = TD_TOWERS[slot.tower.kind];
                const stats = def.levels[slot.tower.level - 1];
                // 实心半透明填充 + 亮边：深色地图上纯虚线几乎看不见（试玩报告）
                g.fillColor = toColor(COLOR_RANGE, 34);
                g.circle(this._lx(slot.x), this._ly(slot.y), stats.range * CELL);
                g.fill();
                g.strokeColor = toColor(COLOR_RANGE, 190);
                g.lineWidth = 2.5;
                g.circle(this._lx(slot.x), this._ly(slot.y), stats.range * CELL);
                g.stroke();
            }
        }

        // 塔
        for (let i = 0; i < core.slots.length; i++) {
            const tower = core.slots[i].tower;
            if (tower) this._drawTower(g, tower, i === this._selectedSlot);
        }

        // 敌人 / 弹丸 / 爆炸
        for (let i = 0; i < core.enemies.length; i++) this._drawEnemy(g, core.enemies[i]);
        for (let i = 0; i < core.shots.length; i++) {
            const shot = core.shots[i];
            g.fillColor = toColor(TOWER_COLORS[shot.kind]);
            g.circle(this._lx(shot.x), this._ly(shot.y), shot.kind === 'sniper' ? 4 : 5);
            g.fill();
        }
        for (let i = 0; i < core.blasts.length; i++) {
            const b = core.blasts[i];
            const t = Math.max(0, b.ttl / b.maxTtl);
            g.fillColor = toColor(TOWER_COLORS[b.kind], Math.round(150 * t));
            g.circle(this._lx(b.x), this._ly(b.y), b.radius * CELL * (1.15 - 0.35 * t));
            g.fill();
        }

        // 选中但空塔位的提示圈
        if (this._selectedSlot >= 0 && !core.slots[this._selectedSlot].tower) {
            const slot = core.slots[this._selectedSlot];
            g.strokeColor = toColor(UI.accent);
            g.lineWidth = 3;
            g.circle(this._lx(slot.x), this._ly(slot.y), CELL * 0.42);
            g.stroke();
        }
    }

    private _drawPath(g: Graphics, core: TDCore): void {
        const points = core.pathPoints;
        if (points.length < 2) return;
        const half = CELL * 0.31;
        // 路面
        g.fillColor = toColor(COLOR_PATH);
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const ax = this._lx(a.x);
            const ay = this._ly(a.y);
            const bx = this._lx(b.x);
            const by = this._ly(b.y);
            g.rect(Math.min(ax, bx) - half, Math.min(ay, by) - half, Math.abs(bx - ax) + half * 2, Math.abs(by - ay) + half * 2);
        }
        g.fill();
        // 中心线
        g.fillColor = toColor(COLOR_PATH_INNER);
        const inner = CELL * 0.1;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const ax = this._lx(a.x);
            const ay = this._ly(a.y);
            const bx = this._lx(b.x);
            const by = this._ly(b.y);
            g.rect(Math.min(ax, bx) - inner, Math.min(ay, by) - inner, Math.abs(bx - ax) + inner * 2, Math.abs(by - ay) + inner * 2);
        }
        g.fill();

        // 起点 / 终点
        const start = points[0];
        const end = points[points.length - 1];
        g.fillColor = toColor(COLOR_START);
        g.circle(this._lx(start.x), this._ly(start.y), CELL * 0.24);
        g.fill();
        g.fillColor = toColor(COLOR_END);
        g.circle(this._lx(end.x), this._ly(end.y), CELL * 0.26);
        g.fill();
        g.fillColor = toColor(UI.bg);
        g.circle(this._lx(end.x), this._ly(end.y), CELL * 0.12);
        g.fill();

        // 漏怪点用红圈提醒
        g.strokeColor = toColor(COLOR_END, 120);
        g.lineWidth = 3;
        g.circle(this._lx(end.x), this._ly(end.y), CELL * 0.4);
        g.stroke();
    }

    private _drawSlot(g: Graphics, x: number, y: number, selected: boolean): void {
        const cx = this._lx(x);
        const cy = this._ly(y);
        const r = CELL * 0.3;
        g.fillColor = toColor(COLOR_SLOT_FILL);
        g.circle(cx, cy, r);
        g.fill();
        g.strokeColor = toColor(selected ? UI.accent : COLOR_SLOT);
        g.lineWidth = selected ? 3 : 2;
        g.circle(cx, cy, r);
        g.stroke();
        // 加号
        g.fillColor = toColor(selected ? UI.accent : COLOR_SLOT, 235);
        g.rect(cx - 4, cy - 13, 8, 26);
        g.rect(cx - 13, cy - 4, 26, 8);
        g.fill();
    }

    private _drawTower(g: Graphics, tower: TDTowerState, selected: boolean): void {
        const cx = this._lx(tower.x);
        const cy = this._ly(tower.y);
        const color = TOWER_COLORS[tower.kind];
        const base = CELL * 0.32;

        // 底座
        g.fillColor = toColor('#0D1728');
        g.circle(cx, cy, base + 4);
        g.fill();
        g.strokeColor = toColor(color, selected ? 255 : 210);
        g.lineWidth = selected ? 3 : 2;
        g.circle(cx, cy, base + 4);
        g.stroke();

        // 主体形状
        g.fillColor = toColor(color);
        if (tower.kind === 'gun') {
            g.circle(cx, cy, CELL * 0.19);
            g.fill();
        } else if (tower.kind === 'mortar') {
            g.rect(cx - CELL * 0.17, cy - CELL * 0.17, CELL * 0.34, CELL * 0.34);
            g.fill();
        } else if (tower.kind === 'frost') {
            g.moveTo(cx, cy + CELL * 0.22);
            g.lineTo(cx + CELL * 0.2, cy);
            g.lineTo(cx, cy - CELL * 0.22);
            g.lineTo(cx - CELL * 0.2, cy);
            g.close();
            g.fill();
        } else {
            g.moveTo(cx, cy + CELL * 0.22);
            g.lineTo(cx + CELL * 0.19, cy - CELL * 0.18);
            g.lineTo(cx - CELL * 0.19, cy - CELL * 0.18);
            g.close();
            g.fill();
        }

        // 炮管
        const len = tower.kind === 'sniper' ? CELL * 0.46 : CELL * 0.34;
        const nx = Math.cos(tower.angle);
        const ny = Math.sin(tower.angle);
        g.strokeColor = toColor('#0B1220', 230);
        g.lineWidth = tower.kind === 'mortar' ? 8 : 5;
        g.moveTo(cx + nx * CELL * 0.06, cy + ny * CELL * 0.06);
        g.lineTo(cx + nx * len, cy + ny * len);
        g.stroke();

        // 等级点
        for (let lv = 0; lv < tower.level; lv++) {
            g.fillColor = toColor(UI.white);
            g.circle(cx - 8 + lv * 8, cy - CELL * 0.42, 2.6);
            g.fill();
        }
    }

    private _drawEnemy(g: Graphics, enemy: TDEnemyState): void {
        if (!enemy.alive) return;
        const cx = this._lx(enemy.x);
        const cy = this._ly(enemy.y);
        const def = TD_ENEMIES[enemy.kind];
        const r = def.radius * CELL;
        const color = enemy.slowTimer > 0 ? '#7DD3FC' : ENEMY_COLORS[enemy.kind];

        g.fillColor = toColor(color);
        if (enemy.kind === 'runner') {
            g.circle(cx, cy, r * 0.9);
            g.fill();
        } else if (enemy.kind === 'tank') {
            g.rect(cx - r, cy - r, r * 2, r * 2);
            g.fill();
        } else if (enemy.kind === 'boss') {
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                const x = cx + Math.cos(a) * r;
                const y = cy + Math.sin(a) * r;
                if (i === 0) g.moveTo(x, y);
                else g.lineTo(x, y);
            }
            g.close();
            g.fill();
        } else {
            g.circle(cx, cy, r);
            g.fill();
        }

        // 血条
        const ratio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));
        const w = Math.max(26, r * 2.4);
        const top = cy + r + (enemy.kind === 'boss' ? 10 : 7);
        g.fillColor = toColor(COLOR_HP_BACK, 190);
        g.rect(cx - w / 2, top, w, 5);
        g.fill();
        if (ratio > 0) {
            g.fillColor = toColor(ratio > 0.35 ? COLOR_HP : COLOR_HP_LOW);
            g.rect(cx - w / 2, top, w * ratio, 5);
            g.fill();
        }
    }

    /** 世界格坐标 → 棋盘本地 x */
    private _lx(x: number): number {
        return (x - COLS / 2) * CELL;
    }

    /** 世界格坐标（y 向下）→ 棋盘本地 y */
    private _ly(y: number): number {
        return (ROWS / 2 - y) * CELL;
    }
}
