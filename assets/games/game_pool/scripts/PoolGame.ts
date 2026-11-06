/**
 * 台球 —— 运行时主组件。
 *
 * 场景里只需要一个挂在 Canvas 下的空节点（本组件），所有 UI 在 onLoad 中构建。
 *  - 单人清台：把目标球全部打进袋，杆数用完即失败
 *  - 按住台面往回拖 → 拉杆，松手出杆；拖得越远力度越大
 *  - 单 Graphics 整盘重绘：库边 / 台面 / 袋口 / 球 / 瞄准线 / 幽灵球 / 球杆
 *  - 每关最佳分 / 通关标记 / 上次关卡存档
 *
 * 约定：事件 handler 全部具名（红线 5）；onDestroy 只清 JS 引用（红线 4）；
 *      逻辑用 update 直接喂 core.step（核心内部已是固定步长）。
 */

import { _decorator, Component, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager } from '../../../common/managers/StorageManager';
import {
    UI,
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
    TABLE_W,
    TABLE_H,
    BALL_R,
    POOL_POCKETS,
    POOL_LEVEL_COUNT,
    PoolSave,
    ballColor,
    createDefaultPoolSave,
    isStriped,
    parsePoolSave,
} from './PoolConfig';
import { PoolCore } from './PoolCore';

const { ccclass } = _decorator;

const GAME_ID = 'pool';
const SAVE_KEY = 'save';

/** 赛台节点尺寸（含库边），比台面大一圈，便于边缘触摸 */
const VIEW_W = TABLE_W + 56;
const VIEW_H = TABLE_H + 56;
/** 赛台中心（设计坐标） */
const TABLE_CX = 360;
const TABLE_CY = 480;

/** 拉杆手势：死区 / 满力距离（设计像素） */
const DRAG_DEAD_ZONE = 16;
const DRAG_FULL_POWER = 260;

const COLOR_RAIL = '#5A3A22';
const COLOR_RAIL_LIGHT = '#7A5030';
const COLOR_FELT = '#0F6B4A';
const COLOR_FELT_DARK = '#0A4E36';
const COLOR_POCKET = '#08120E';
const COLOR_AIM = '#F8FAFC';

const PANEL_IN_SEC = 0.18;

@ccclass('PoolGame')
export class PoolGame extends Component {
    /** 浏览器探针用 */
    core: PoolCore | null = null;
    levelId = 1;
    /** 拉杆力度 0..1（探针用） */
    aimPower = 0;
    /** 是否正在拖拽拉杆（探针用） */
    dragging = false;

    private _save: PoolSave = createDefaultPoolSave();
    private _table: Node | null = null;
    private _gfx: Graphics | null = null;
    private _powerG: Graphics | null = null;
    private _levelLabel: Label | null = null;
    private _strokeLabel: Label | null = null;
    private _scoreLabel: Label | null = null;
    private _statusLabel: Label | null = null;
    private _levelBtn: Node | null = null;

    private _panel: Node | null = null;
    private _panelNode: Node | null = null;
    private _panelAnim = 0;

    private _dragStartX = 0;
    private _dragStartY = 0;
    private _hudTimer = 0;

    // ==================== 生命周期 ====================

    onLoad(): void {
        this._save = this._loadSave();
        this._buildUi();
        this._startLevel(this._save.lastLevel);
    }

    update(dt: number): void {
        const core = this.core;
        if (!core) return;

        if (core.state === 'rolling') core.step(dt);
        const events = core.drainEvents();
        if (events.length > 0) this._handleEvents(events);

        this._drawTable();
        this._drawPower();
        this._tickPanelIn(dt);

        this._hudTimer -= dt;
        if (this._hudTimer <= 0) {
            this._hudTimer = 0.1;
            this._refreshHud();
        }
    }

    onDestroy(): void {
        this.core = null;
        this._table = null;
        this._gfx = null;
        this._powerG = null;
        this._levelLabel = null;
        this._strokeLabel = null;
        this._scoreLabel = null;
        this._statusLabel = null;
        this._levelBtn = null;
        this._panel = null;
        this._panelNode = null;
    }

    // ==================== 开局 / 关卡 ====================

    private _startLevel(levelId: number): void {
        const id = Math.max(1, Math.min(POOL_LEVEL_COUNT, Math.floor(levelId)));
        this.levelId = id;
        const core = new PoolCore();
        core.startLevel(id, (Date.now() >>> 0));
        // 初始瞄准方向指向球堆（母球与球堆都在中线，方向就是 +x）
        core.setAimAngle(0);
        this.core = core;
        this.aimPower = 0;
        this.dragging = false;
        this._save.lastLevel = id;
        this._persist();
        this._destroyPanel();
        this._refreshHud();
        this._drawTable();
    }

    private _restartLevel(): void {
        this._startLevel(this.levelId);
    }

    private _cycleLevel(dir: number): void {
        const next = ((this.levelId - 1 + dir + POOL_LEVEL_COUNT) % POOL_LEVEL_COUNT) + 1;
        this._startLevel(next);
    }

    private onBack(): void {
        this._persist();
        SceneManager.gotoLobby();
    }

    // ==================== 事件 ====================

    private _handleEvents(events: any[]): void {
        const core = this.core;
        if (!core) return;
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (!ev) continue;
            if (ev.type === 'pot') {
                if (ev.combo > 1) toast(this.node, `连击 x${ev.combo} · +${ev.gain}`, 1.0, 660);
            } else if (ev.type === 'scratch') {
                toast(this.node, '母球落袋 · 已复位', 1.2, 660);
            } else if (ev.type === 'won') {
                this._finish(true);
            } else if (ev.type === 'lost') {
                this._finish(false);
            }
        }
        this._refreshHud();
    }

    private _finish(win: boolean): void {
        const core = this.core;
        if (!core) return;
        const idx = this.levelId - 1;
        if (core.score > this._save.bestScore[idx]) this._save.bestScore[idx] = core.score;
        if (win) this._save.cleared[idx] = true;
        this._save.totalPots += core.pottedCount;
        this._persist();
        this._showResult(win);
    }

    // ==================== 输入：拉杆 ====================

    private onTableTouchStart(ev: EventTouch): void {
        const core = this.core;
        if (!core || core.state !== 'aiming') return;
        const p = this._toTable(ev);
        if (!p) return;
        this.dragging = true;
        this.aimPower = 0;
        this._dragStartX = p.x;
        this._dragStartY = p.y;
    }

    private onTableTouchMove(ev: EventTouch): void {
        const core = this.core;
        if (!core || !this.dragging || core.state !== 'aiming') return;
        const p = this._toTable(ev);
        if (!p) return;
        // 拉杆向量 = 起点 - 当前点：往回拖，球往反方向走
        const dx = this._dragStartX - p.x;
        const dy = this._dragStartY - p.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < DRAG_DEAD_ZONE) {
            this.aimPower = 0;
            return;
        }
        core.setAimAngle(Math.atan2(dy, dx));
        const span = DRAG_FULL_POWER - DRAG_DEAD_ZONE;
        this.aimPower = Math.max(0, Math.min(1, (len - DRAG_DEAD_ZONE) / span));
    }

    /** 松手出杆（桌面预览下拖拽结束派发的是 TOUCH_CANCEL，两者都当松手） */
    private onTableTouchEnd(ev: EventTouch): void {
        this._releaseShot();
    }

    private onTableTouchCancel(ev: EventTouch): void {
        this._releaseShot();
    }

    private _releaseShot(): void {
        const core = this.core;
        const power = this.aimPower;
        this.dragging = false;
        this.aimPower = 0;
        if (!core || core.state !== 'aiming') return;
        if (power <= 0) return; // 拖得太短 → 取消，不出杆
        core.setPower(power);
        core.shoot();
        this._refreshHud();
    }

    private _toTable(ev: EventTouch): { x: number; y: number } | null {
        const table = this._table;
        if (!table || !table.isValid) return null;
        const ut = table.getComponent(UITransform);
        if (!ut) return null;
        const ui = ev.getUILocation();
        const local = ut.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        return { x: local.x + TABLE_W / 2, y: TABLE_H / 2 - local.y };
    }

    private onOverlayTouchStart(ev: EventTouch): void {
        ev.propagationStopped = true;
    }

    // ==================== 结算 ====================

    private _showResult(win: boolean): void {
        const core = this.core;
        if (!core) return;
        this._destroyPanel();

        const root = createNode('ResultOverlay', this.node, 720, 1280);
        root.on(Node.EventType.TOUCH_START, this.onOverlayTouchStart, this);
        const dim = root.addComponent(Graphics);
        dim.fillColor = toColor(UI.overlay, 220);
        dim.rect(-360, -640, 720, 1280);
        dim.fill();

        const panel = createNode('Panel', root, 580, 480);
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, 580, 480, 24, toColor(UI.panel), toColor(UI.panelStroke), 2);

        createLabel(panel, win ? '清台成功！' : '杆数用尽', 44, {
            x: 0, y: 160, bold: true,
            color: win ? UI.success : UI.danger,
            width: 500, height: 60,
        });
        createLabel(panel, `${core.level.name} · ${core.pottedCount} / ${core.totalBalls} 颗`, 22, {
            x: 0, y: 100, color: UI.textDim, width: 500, height: 30,
        });
        createLabel(panel, `杆数 ${core.strokes} / ${core.strokeLimit} · 得分 ${core.score}`, 21, {
            x: 0, y: 62, color: UI.textMuted, width: 500, height: 28,
        });
        const best = this._save.bestScore[this.levelId - 1];
        createLabel(panel, `本关最佳 ${best}`, 19, {
            x: 0, y: 26, color: UI.textMuted, width: 500, height: 24,
        });

        const again = createButton(panel, {
            w: 230, h: 78, text: '再玩一次', fontSize: 25,
            fill: UI.primary, activeFill: UI.primary, radius: 16,
            onTap: () => this.onRestart(),
        });
        again.node.setPosition(-125, -46, 0);

        const next = createButton(panel, {
            w: 230, h: 78, text: '换一关', fontSize: 25,
            fill: '#1E293B', activeFill: UI.accentDark, radius: 16, stroke: '#26364F',
            onTap: () => this.onNextLevel(),
        });
        next.node.setPosition(125, -46, 0);

        const lobby = createButton(panel, {
            w: 300, h: 70, text: '返回大厅', fontSize: 24,
            fill: '#1E293B', activeFill: UI.accentDark, radius: 14, stroke: '#26364F',
            onTap: () => this.onBack(),
        });
        lobby.node.setPosition(0, -160, 0);

        this._playPanelIn(panel);
        this._panel = root;
    }

    private onRestart(): void {
        this._restartLevel();
    }

    private onNextLevel(): void {
        this._cycleLevel(1);
    }

    private onPrevLevel(): void {
        this._cycleLevel(-1);
    }

    private _destroyPanel(): void {
        if (this._panel && this._panel.isValid) this._panel.destroy();
        this._panel = null;
        this._panelNode = null;
        this._panelAnim = 0;
    }

    private _playPanelIn(panel: Node): void {
        this._panelNode = panel;
        this._panelAnim = PANEL_IN_SEC;
        panel.setScale(0.92, 0.92, 1);
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
    }

    // ==================== 存档 ====================

    private _loadSave(): PoolSave {
        try {
            const raw = StorageManager.instance.getItem(GAME_ID, SAVE_KEY);
            if (!raw) return createDefaultPoolSave();
            return parsePoolSave(JSON.parse(raw));
        } catch (err) {
            console.warn('台球读档失败：', err);
            return createDefaultPoolSave();
        }
    }

    private _persist(): void {
        try {
            StorageManager.instance.setItem(GAME_ID, SAVE_KEY, JSON.stringify(this._save));
        } catch (err) {
            console.warn('台球存档失败：', err);
        }
    }

    // ==================== UI 构建 ====================

    private _buildUi(): void {
        const bg = createNode('Bg', this.node, 720, 1280);
        const bgG = bg.addComponent(Graphics);
        drawRoundRect(bgG, 720, 1280, 0, toColor(UI.bg));

        createBackButton(this.node, () => this.onBack());
        createLabel(this.node, '台球', 44, { ...this._at(360, 64), bold: true, width: 380, height: 66 });
        createLabel(this.node, 'POOL', 15, { ...this._at(360, 104), color: UI.textMuted, width: 320, height: 24 });

        this._levelLabel = createLabel(this.node, '关卡 1/3', 22, {
            ...this._at(130, 160), bold: true, width: 220, height: 34,
        });
        this._strokeLabel = createLabel(this.node, '杆数 0/0', 22, {
            ...this._at(360, 160), bold: true, color: UI.accent, width: 260, height: 34,
        });
        this._scoreLabel = createLabel(this.node, '分数 0', 22, {
            ...this._at(590, 160), bold: true, color: UI.warning, width: 200, height: 34,
        });

        this._table = createNode('Table', this.node, VIEW_W, VIEW_H);
        this._table.setPosition(designPos(TABLE_CX, TABLE_CY));
        this._gfx = this._table.addComponent(Graphics);
        this._table.on(Node.EventType.TOUCH_START, this.onTableTouchStart, this);
        this._table.on(Node.EventType.TOUCH_MOVE, this.onTableTouchMove, this);
        this._table.on(Node.EventType.TOUCH_END, this.onTableTouchEnd, this);
        this._table.on(Node.EventType.TOUCH_CANCEL, this.onTableTouchCancel, this);

        this._statusLabel = createLabel(this.node, '', 19, {
            ...this._at(360, 700), color: UI.textDim, width: 680, height: 28,
        });

        createLabel(this.node, '力度', 19, {
            ...this._at(64, 758), color: UI.textMuted, width: 90, height: 26,
        });
        const powerBar = createNode('PowerBar', this.node, 520, 26);
        powerBar.setPosition(designPos(430, 758));
        this._powerG = powerBar.addComponent(Graphics);

        const prevBtn = createButton(this.node, {
            w: 150, h: 70, text: '◀ 换关', fontSize: 22,
            fill: '#1E293B', activeFill: UI.accentDark, radius: 16, stroke: '#26364F',
            onTap: () => this.onPrevLevel(),
        });
        prevBtn.node.setPosition(designPos(140, 850));

        this._levelBtn = createButton(this.node, {
            w: 220, h: 70, text: '重开本关', fontSize: 22,
            fill: UI.primary, activeFill: UI.success, radius: 16,
            onTap: () => this.onRestart(),
        }).node;
        this._levelBtn.setPosition(designPos(360, 850));

        const nextBtn = createButton(this.node, {
            w: 150, h: 70, text: '换关 ▶', fontSize: 22,
            fill: '#1E293B', activeFill: UI.accentDark, radius: 16, stroke: '#26364F',
            onTap: () => this.onNextLevel(),
        });
        nextBtn.node.setPosition(designPos(580, 850));

        createLabel(this.node, '按住台面往回拖 → 拉杆，松手出杆 · 拖得越远力度越大', 17, {
            ...this._at(360, 940), color: UI.textMuted, width: 680, height: 24,
        });
    }

    private _at(xFromLeft: number, yFromTop: number): { x: number; y: number } {
        const p = designPos(xFromLeft, yFromTop);
        return { x: p.x, y: p.y };
    }

    private _refreshHud(): void {
        const core = this.core;
        if (!core) return;
        if (this._levelLabel) {
            this._levelLabel.string = `关卡 ${this.levelId}/${POOL_LEVEL_COUNT} · ${core.level.name}`;
        }
        if (this._strokeLabel) this._strokeLabel.string = `杆数 ${core.strokes}/${core.strokeLimit}`;
        if (this._scoreLabel) this._scoreLabel.string = `分数 ${core.score}`;
        if (this._statusLabel) {
            if (core.state === 'rolling') {
                this._statusLabel.string = '球在滚动……';
            } else if (core.state === 'aiming') {
                this._statusLabel.string = `剩余 ${core.totalBalls - core.pottedCount} 颗球 · 目标：清台`;
            } else {
                this._statusLabel.string = '';
            }
        }
        if (this._levelBtn) this._levelBtn.active = core.state !== 'won' && core.state !== 'lost';
    }

    // ==================== 绘制 ====================

    private _lx(x: number): number {
        return x - TABLE_W / 2;
    }

    private _ly(y: number): number {
        return TABLE_H / 2 - y;
    }

    private _drawTable(): void {
        const g = this._gfx;
        const core = this.core;
        if (!g || !core) return;
        g.clear();

        // 库边（木质外框）
        drawRoundRect(g, VIEW_W, VIEW_H, 26, toColor(COLOR_RAIL), toColor(COLOR_RAIL_LIGHT), 3);

        // 台面
        g.fillColor = toColor(COLOR_FELT);
        g.rect(-TABLE_W / 2, -TABLE_H / 2, TABLE_W, TABLE_H);
        g.fill();
        // 台面内阴影，让库边有厚度
        g.strokeColor = toColor(COLOR_FELT_DARK);
        g.lineWidth = 6;
        g.rect(-TABLE_W / 2 + 3, -TABLE_H / 2 + 3, TABLE_W - 6, TABLE_H - 6);
        g.stroke();

        // 袋口
        for (let i = 0; i < POOL_POCKETS.length; i++) {
            const pk = POOL_POCKETS[i];
            g.fillColor = toColor(COLOR_POCKET);
            g.circle(this._lx(pk.x), this._ly(pk.y), pk.r * 1.1);
            g.fill();
        }

        // 瞄准线（仅瞄准阶段）
        if (core.state === 'aiming') this._drawAim(g, core);

        // 球
        for (let i = 0; i < core.balls.length; i++) {
            const b = core.balls[i];
            if (!b.onTable) continue;
            this._drawBall(g, b.x, b.y, b.num);
        }

        // 拉杆中的球杆
        if (core.state === 'aiming' && this.aimPower > 0) this._drawCueStick(g, core);
    }

    private _drawBall(g: Graphics, x: number, y: number, num: number): void {
        const cx = this._lx(x);
        const cy = this._ly(y);
        const r = BALL_R;

        if (num === 0) {
            g.fillColor = toColor('#F8FAF5');
            g.circle(cx, cy, r);
            g.fill();
            g.fillColor = toColor('#C7CCC4');
            g.circle(cx - r * 0.28, cy + r * 0.28, r * 0.22);
            g.fill();
            g.strokeColor = toColor('#9AA39B');
            g.lineWidth = 1.5;
            g.circle(cx, cy, r);
            g.stroke();
            return;
        }

        const color = toColor('#' + ballColor(num));
        if (isStriped(num)) {
            g.fillColor = toColor('#F8FAF5');
            g.circle(cx, cy, r);
            g.fill();
            g.fillColor = color;
            g.rect(cx - r * 0.8, cy - r * 0.5, r * 1.6, r);
            g.fill();
        } else {
            g.fillColor = color;
            g.circle(cx, cy, r);
            g.fill();
        }

        // 高光
        g.fillColor = toColor('#FFFFFF', 70);
        g.circle(cx - r * 0.3, cy + r * 0.32, r * 0.3);
        g.fill();
        // 描边
        g.strokeColor = toColor('#0B1220', 150);
        g.lineWidth = 1.4;
        g.circle(cx, cy, r);
        g.stroke();
    }

    private _drawAim(g: Graphics, core: PoolCore): void {
        const cue = core.cueBall;
        if (!cue || !cue.onTable) return;
        const hit = core.predictAim();
        if (hit.kind === 'none' || hit.dist <= 0) return;

        const sx = this._lx(cue.x);
        const sy = this._ly(cue.y);
        const ex = this._lx(hit.ghostX);
        const ey = this._ly(hit.ghostY);

        // 虚线
        const total = Math.hypot(ex - sx, ey - sy);
        if (total > 1) {
            const dash = 9;
            const gap = 7;
            const nx = (ex - sx) / total;
            const ny = (ey - sy) / total;
            g.strokeColor = toColor(COLOR_AIM, 190);
            g.lineWidth = 2;
            let t = 0;
            while (t < total) {
                const t2 = Math.min(total, t + dash);
                g.moveTo(sx + nx * t, sy + ny * t);
                g.lineTo(sx + nx * t2, sy + ny * t2);
                t = t2 + gap;
            }
            g.stroke();
        }

        // 幽灵球
        g.strokeColor = toColor(COLOR_AIM, 150);
        g.lineWidth = 1.6;
        g.circle(ex, ey, BALL_R);
        g.stroke();

        // 目标球被撞后的去向
        if (hit.kind === 'ball' && hit.ballNum >= 0) {
            let tx = 0;
            let ty = 0;
            for (let i = 0; i < core.balls.length; i++) {
                const b = core.balls[i];
                if (b.num === hit.ballNum && b.onTable) { tx = b.x; ty = b.y; break; }
            }
            let dx = tx - hit.ghostX;
            let dy = ty - hit.ghostY;
            const len = Math.hypot(dx, dy);
            if (len > 0.5) {
                dx /= len;
                dy /= len;
                g.strokeColor = toColor(UI.warning, 210);
                g.lineWidth = 3;
                g.moveTo(this._lx(tx), this._ly(ty));
                g.lineTo(this._lx(tx + dx * 70), this._ly(ty + dy * 70));
                g.stroke();
            }
        }
    }

    private _drawCueStick(g: Graphics, core: PoolCore): void {
        const cue = core.cueBall;
        if (!cue || !cue.onTable) return;
        const a = core.aimAngle;
        const dx = -Math.cos(a);
        const dy = -Math.sin(a);
        const cx = this._lx(cue.x);
        const cy = this._ly(cue.y);
        const back = BALL_R + 10 + this.aimPower * 60;
        const len = 170;

        g.strokeColor = toColor('#E8C89A');
        g.lineWidth = 6;
        g.moveTo(cx + dx * back, cy + dy * back);
        g.lineTo(cx + dx * (back + len), cy + dy * (back + len));
        g.stroke();

        g.strokeColor = toColor('#3B5C86');
        g.lineWidth = 6;
        g.moveTo(cx + dx * back, cy + dy * back);
        g.lineTo(cx + dx * (back + 14), cy + dy * (back + 14));
        g.stroke();
    }

    private _drawPower(): void {
        const g = this._powerG;
        if (!g) return;
        const w = 520;
        const h = 26;
        g.clear();
        drawRoundRect(g, w, h, 13, toColor('#0E1626'), toColor('#2A3A57'), 2);
        const p = this.aimPower;
        if (p > 0) {
            const fw = Math.max(h, (w - 6) * p);
            const color = p > 0.75 ? UI.danger : p > 0.45 ? UI.warning : UI.success;
            drawRoundRect(g, fw, h - 6, 10, toColor(color));
        }
    }
}
