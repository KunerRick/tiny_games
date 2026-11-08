/**
 * 星际弹幕 —— 运行时界面（全 Graphics 绘制，零贴图零音频）。
 *
 * 世界坐标（见 ShmupCore）：x ∈ [0,720] 左→右，y ∈ [0,1280] 上→下。
 * 节点局部坐标换算：`localX = wx - 360`、`localY = 640 - wy`。
 */

import {
    _decorator,
    Component,
    EventTouch,
    Graphics,
    Label,
    Node,
    UITransform,
    Vec3,
} from 'cc';
import {
    COLOR,
    FONT_BODY,
    FONT_CAPTION,
    FONT_DISPLAY,
    FONT_TITLE,
    createBackButton,
    createButton,
    createLabel,
    createNode,
    drawRoundRect,
    hex,
} from '../../../common/ui/GameUIKit';
import { StorageManager } from '../../../common/managers/StorageManager';
import { SceneManager } from '../../../common/managers/SceneManager';
import {
    FIELD_H,
    FIELD_W,
    PLAYER_VISUAL_R,
    SHMUP_WAVES,
    ShmupWorld,
    type Enemy,
    type EnemyKind,
    type Powerup,
} from './ShmupCore';

const { ccclass } = _decorator;

const GAME_ID = 'shmup';
const SAVE_BEST = 'best';
const HUD_H = 118;

const C = {
    star: '#3B4A6B',
    starBright: '#7C8DB5',
    player: '#4FD1FF',
    playerCore: '#DFF7FF',
    playerBullet: '#FFE27A',
    enemyBullet: '#FF5C7A',
    grunt: '#F97362',
    weaver: '#B388FF',
    tank: '#FBBF24',
    boss: '#EF4444',
    power: '#34D399',
    life: '#F472B6',
    panel: '#141B28',
};

const ENEMY_COLOR: Record<EnemyKind, string> = {
    grunt: C.grunt,
    weaver: C.weaver,
    tank: C.tank,
    boss: C.boss,
};

type UiPhase = 'ready' | 'playing' | 'won' | 'lost';

@ccclass('ShmupGame')
export class ShmupGame extends Component {
    private _world = new ShmupWorld();
    private _phase: UiPhase = 'ready';

    private _bgGfx: Graphics | null = null;
    private _fieldGfx: Graphics | null = null;
    private _hudGfx: Graphics | null = null;

    private _scoreLabel: Label | null = null;
    private _waveLabel: Label | null = null;
    private _powerLabel: Label | null = null;

    private _startOverlay: Node | null = null;
    private _endOverlay: Node | null = null;
    private _endTitle: Label | null = null;
    private _endScore: Label | null = null;
    private _endBest: Label | null = null;

    private _best = 0;

    private _dragging = false;
    private _touchId = -1;
    private _dragOffX = 0;
    private _dragOffY = 0;

    private _time = 0;
    private _starScroll = 0;

    private _lastScore = -1;
    private _lastWave = '';
    private _lastPower = -1;

    onLoad(): void {
        // 根节点必须是全屏 UITransform：Cocos 的 UI 点击按 UITransform 命中测试，
        // 尺寸只有 100×100 时屏幕边缘的触摸根本到不了监听器（实测拖不动飞船）。
        const rootUt = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        rootUt.setAnchorPoint(0.5, 0.5);
        rootUt.setContentSize(FIELD_W, FIELD_H);

        this._best = this._getItem(SAVE_BEST, 0);
        this._buildUi();
        this._bindEvents();
        this._showStart();
    }

    onDestroy(): void {
        this.node.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        this.node.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        this.unscheduleAllCallbacks();
        this._bgGfx = null;
        this._fieldGfx = null;
        this._hudGfx = null;
        this._scoreLabel = null;
        this._waveLabel = null;
        this._powerLabel = null;
        this._startOverlay = null;
        this._endOverlay = null;
        this._endTitle = null;
        this._endScore = null;
        this._endBest = null;
    }

    // ==================== 构建 ====================

    private _buildUi(): void {
        const root = this.node;

        const bg = createNode('Bg', root, FIELD_W, FIELD_H);
        this._bgGfx = bg.addComponent(Graphics);
        this._drawStars();

        const field = createNode('Field', root, FIELD_W, FIELD_H);
        this._fieldGfx = field.addComponent(Graphics);

        const hud = createNode('Hud', root, FIELD_W, FIELD_H);
        this._hudGfx = hud.addComponent(Graphics);

        this._scoreLabel = createLabel(hud, '分数 0', FONT_BODY.fontSize, {
            x: 130 - 360,
            y: 640 - 46,
            color: COLOR.TEXT_PRIMARY,
            bold: true,
            width: 240,
        });

        this._powerLabel = createLabel(hud, '火力 ×1', FONT_CAPTION.fontSize, {
            x: 130 - 360,
            y: 640 - 82,
            color: C.player,
            width: 240,
        });

        this._waveLabel = createLabel(hud, '', FONT_CAPTION.fontSize, {
            x: 420 - 360,
            y: 640 - 46,
            color: COLOR.TEXT_SECONDARY,
            width: 300,
        });

        createBackButton(root, () => this._onBackTap());
    }

    private _drawStars(): void {
        const g = this._bgGfx;
        if (!g) return;
        g.clear();
        let seed = 20261108;
        const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        // 底色铺满「可见区」而不只是 1280：本作画布按 fit-width 适配，
        // 上下会各多出约 140 设计像素，不铺满就会露出相机的灰色清屏色。
        g.fillColor = hex('#070C16');
        g.rect(-FIELD_W / 2, -900, FIELD_W, 3100);
        g.fill();

        // 星点按 FIELD_H 为周期重复：滚动满 1280 后画面完全一致，回卷不会有跳变
        // 同时覆盖「可见区比 1280 设计高、上下各多约 140」的溢出部分。
        for (let layer = 0; layer < 3; layer++) {
            const count = layer === 0 ? 70 : layer === 1 ? 34 : 16;
            const r = 1 + layer * 0.9;
            g.fillColor = hex(layer === 2 ? C.starBright : C.star);
            for (let i = 0; i < count; i++) {
                const x = -FIELD_W / 2 + rand() * FIELD_W;
                const baseY = -FIELD_H / 2 + rand() * FIELD_H;
                for (let k = -1; k <= 2; k++) {
                    g.circle(x, baseY + k * FIELD_H, r);
                    g.fill();
                }
            }
        }
    }

    // ==================== 事件 ====================

    private _bindEvents(): void {
        this.node.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
    }

    private _onTouchStart(ev: EventTouch): void {
        if (this._phase !== 'playing' || this._dragging) return;
        this._dragging = true;
        this._touchId = ev.getID();
        const p = this._designPoint(ev);
        this._dragOffX = this._world.player.x - p.x;
        this._dragOffY = this._world.player.y - p.y;
    }

    private _onTouchMove(ev: EventTouch): void {
        if (!this._dragging || ev.getID() !== this._touchId) return;
        if (this._phase !== 'playing') return;
        const p = this._designPoint(ev);
        this._world.movePlayerTo(p.x + this._dragOffX, p.y + this._dragOffY);
    }

    private _onTouchEnd(ev: EventTouch): void {
        if (ev.getID() !== this._touchId) return;
        this._dragging = false;
        this._touchId = -1;
    }

    /** UI 触摸点 → 设计坐标（原点左上）；getUILocation 是视图坐标，必须先转世界坐标 */
    private _designPoint(event: EventTouch): { x: number; y: number } {
        const ui = event.getUILocation();
        const ut = this.node.getComponent(UITransform);
        const parent = this.node.parent;
        const parentUT = parent ? parent.getComponent(UITransform) : null;
        if (!ut || !parentUT) return { x: ui.x, y: FIELD_H - ui.y };
        const canvasLocal = new Vec3(
            ui.x - parentUT.width * parentUT.anchorX,
            ui.y - parentUT.height * parentUT.anchorY,
            0
        );
        const local = ut.convertToNodeSpaceAR(parentUT.convertToWorldSpaceAR(canvasLocal));
        return { x: local.x + FIELD_W / 2, y: FIELD_H / 2 - local.y };
    }

    private _onBackTap(): void {
        SceneManager.gotoLobby();
    }

    private _onStartTap(): void {
        if (this._startOverlay && this._startOverlay.isValid) this._startOverlay.active = false;
        if (this._endOverlay && this._endOverlay.isValid) this._endOverlay.active = false;
        this._world.reset();
        this._phase = 'playing';
        this._dragging = false;
        this._lastScore = -1;
        this._lastWave = '';
        this._lastPower = -1;
        this._draw();
        this._syncHud();
    }

    // ==================== 开始 / 结束面板 ====================

    private _showStart(): void {
        this._phase = 'ready';
        this._world.reset();
        this._draw();

        if (this._startOverlay && this._startOverlay.isValid) {
            this._startOverlay.active = true;
            return;
        }

        const overlay = createNode('StartOverlay', this.node, FIELD_W, FIELD_H);
        const dim = overlay.addComponent(Graphics);
        dim.fillColor = hex('#050A14', 226);
        dim.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H);
        dim.fill();

        createLabel(overlay, '星际弹幕', FONT_DISPLAY.fontSize, {
            x: 0,
            y: 640 - 400,
            color: COLOR.TEXT_PRIMARY,
            bold: true,
        });
        createLabel(overlay, 'S H M U P', FONT_CAPTION.fontSize, {
            x: 0,
            y: 640 - 448,
            color: C.player,
        });

        const tips = [
            '拖动屏幕移动飞船，自动开火',
            '击落敌机，拾取火力与生命补给',
            `${SHMUP_WAVES.length - 1} 波敌机 + 母舰压阵`,
        ];
        tips.forEach((text, i) => {
            createLabel(overlay, text, FONT_BODY.fontSize, {
                x: 0,
                y: 640 - (580 + i * 50),
                color: COLOR.TEXT_SECONDARY,
            });
        });

        createLabel(overlay, `最高分 ${this._best}`, FONT_BODY.fontSize, {
            x: 0,
            y: 640 - 760,
            color: C.tank,
            bold: true,
        });

        const btn = createButton(overlay, {
            w: 320,
            h: 96,
            text: '开始战斗',
            fontSize: FONT_TITLE.fontSize,
            fill: C.player,
            textColor: '#06212E',
            onTap: () => this._onStartTap(),
        });
        btn.node.setPosition(0, 640 - 900, 0);

        this._startOverlay = overlay;
    }

    private _showEnd(won: boolean): void {
        if (!this._endOverlay || !this._endOverlay.isValid) {
            const overlay = createNode('EndOverlay', this.node, FIELD_W, FIELD_H);
            const dim = overlay.addComponent(Graphics);
            dim.fillColor = hex('#050A14', 228);
            dim.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H);
            dim.fill();

            const panel = createNode('Panel', overlay, 580, 560);
            const pg = panel.addComponent(Graphics);
            drawRoundRect(pg, 580, 560, 28, hex(C.panel), hex('#2C3A52'), 2);

            this._endTitle = createLabel(panel, '战斗结束', FONT_TITLE.fontSize, {
                x: 0,
                y: 200,
                color: COLOR.TEXT_PRIMARY,
                bold: true,
            });
            this._endScore = createLabel(panel, '得分 0', FONT_BODY.fontSize, {
                x: 0,
                y: 112,
                color: COLOR.TEXT_PRIMARY,
            });
            this._endBest = createLabel(panel, '最高分 0', FONT_BODY.fontSize, {
                x: 0,
                y: 66,
                color: C.tank,
            });

            const again = createButton(panel, {
                w: 320,
                h: 92,
                text: '再来一局',
                fontSize: FONT_BODY.fontSize,
                fill: C.player,
                textColor: '#06212E',
                onTap: () => this._onStartTap(),
            });
            again.node.setPosition(0, -16, 0);

            const back = createButton(panel, {
                w: 320,
                h: 84,
                text: '返回大厅',
                fontSize: FONT_BODY.fontSize,
                onTap: () => this._onBackTap(),
            });
            back.node.setPosition(0, -126, 0);

            this._endOverlay = overlay;
        }

        if (this._endTitle) this._endTitle.string = won ? '母舰击沉！' : '飞船被击落';
        if (this._endScore) this._endScore.string = `得分 ${this._world.score}`;
        if (this._endBest) this._endBest.string = `最高分 ${this._best}`;
        this._endOverlay.active = true;
    }

    private _endGame(won: boolean): void {
        this._phase = won ? 'won' : 'lost';
        this._dragging = false;
        if (this._world.score > this._best) {
            this._best = this._world.score;
            this._setItem(SAVE_BEST, this._best);
        }
        this._draw();
        this._showEnd(won);
    }

    // ==================== 主循环 ====================

    update(dt: number): void {
        this._time += dt;

        if (this._phase !== 'playing') {
            this._scrollStars(dt * 0.3);
            return;
        }

        const w = this._world;
        w.update(dt);

        if (w.phase === 'won') {
            this._endGame(true);
            return;
        }
        if (w.phase === 'lost') {
            this._endGame(false);
            return;
        }

        this._scrollStars(dt);
        this._draw();
        this._syncHud();
    }

    private _scrollStars(dt: number): void {
        this._starScroll = (this._starScroll + dt * 24) % FIELD_H;
        if (this._bgGfx && this._bgGfx.node.isValid) {
            this._bgGfx.node.setPosition(0, -this._starScroll, 0);
        }
    }

    private _syncHud(): void {
        const w = this._world;
        if (this._scoreLabel && w.score !== this._lastScore) {
            this._lastScore = w.score;
            this._scoreLabel.string = `分数 ${w.score}`;
        }
        if (this._powerLabel && w.player.power !== this._lastPower) {
            this._lastPower = w.player.power;
            this._powerLabel.string = `火力 ×${w.player.power}`;
        }
        const waveText = `第 ${w.waveIndex + 1} 波 · ${w.wave.name}`;
        if (this._waveLabel && waveText !== this._lastWave) {
            this._lastWave = waveText;
            this._waveLabel.string = waveText;
        }
    }

    // ==================== 绘制 ====================

    private _draw(): void {
        const g = this._fieldGfx;
        if (!g) return;
        g.clear();

        this._drawPlayer(g);
        for (const e of this._world.enemies) this._drawEnemy(g, e);
        for (const u of this._world.powerups) this._drawPowerup(g, u);

        // 玩家子弹：细长胶囊（同色一次性 fill）
        g.fillColor = hex(C.playerBullet);
        for (const b of this._world.playerBullets) {
            g.roundRect(-FIELD_W / 2 + b.x - 2.5, FIELD_H / 2 - b.y - 9, 5, 18, 2.5);
        }
        g.fill();

        // 敌弹：外晕 + 红球 + 亮芯
        for (const b of this._world.enemyBullets) {
            const x = -FIELD_W / 2 + b.x;
            const y = FIELD_H / 2 - b.y;
            g.fillColor = hex(C.enemyBullet, 80);
            g.circle(x, y, b.r + 4);
            g.fill();
            g.fillColor = hex(C.enemyBullet);
            g.circle(x, y, b.r);
            g.fill();
            g.fillColor = hex('#FFD9E1');
            g.circle(x, y, b.r * 0.42);
            g.fill();
        }

        this._drawHudGfx();
    }

    private _drawPlayer(g: Graphics): void {
        const p = this._world.player;
        const x = -FIELD_W / 2 + p.x;
        const y = FIELD_H / 2 - p.y;

        // 无敌期间：机体照常画（隐身的飞船没法操作），只用闪烁的光环提示
        if (p.invuln > 0 && Math.floor(this._time * 10) % 2 === 0) {
            g.strokeColor = hex(C.player, 160);
            g.lineWidth = 2.5;
            g.circle(x, y, PLAYER_VISUAL_R + 11);
            g.stroke();
        }

        if (p.invuln <= 0) {
            g.fillColor = hex(C.player, 60);
            g.circle(x, y, PLAYER_VISUAL_R + 9);
            g.fill();
        }

        // 机身
        g.fillColor = hex(C.player);
        g.moveTo(x, y + 22);
        g.lineTo(x + 13, y - 6);
        g.lineTo(x + 5, y - 14);
        g.lineTo(x, y - 8);
        g.lineTo(x - 5, y - 14);
        g.lineTo(x - 13, y - 6);
        g.close();
        g.fill();

        // 机翼
        g.fillColor = hex('#2A7FA8');
        g.moveTo(x - 13, y - 2);
        g.lineTo(x - 22, y - 12);
        g.lineTo(x - 13, y - 12);
        g.close();
        g.moveTo(x + 13, y - 2);
        g.lineTo(x + 22, y - 12);
        g.lineTo(x + 13, y - 12);
        g.close();
        g.fill();

        // 驾驶舱
        g.fillColor = hex(C.playerCore);
        g.circle(x, y + 3, 4.5);
        g.fill();

        // 尾焰
        const flame = 8 + Math.sin(this._time * 40) * 3;
        g.fillColor = hex('#7DD3FC', 150);
        g.moveTo(x - 5, y - 12);
        g.lineTo(x + 5, y - 12);
        g.lineTo(x, y - 12 - flame);
        g.close();
        g.fill();
    }

    private _drawEnemy(g: Graphics, e: Enemy): void {
        const x = -FIELD_W / 2 + e.x;
        const y = FIELD_H / 2 - e.y;
        const color = ENEMY_COLOR[e.kind];

        if (e.hp < e.maxHp) {
            g.strokeColor = hex('#FFFFFF', 55);
            g.lineWidth = 2;
            g.circle(x, y, e.radius + 3);
            g.stroke();
        }

        if (e.kind === 'grunt') {
            g.fillColor = hex(color);
            g.moveTo(x, y + e.radius);
            g.lineTo(x + e.radius * 0.9, y - e.radius * 0.7);
            g.lineTo(x - e.radius * 0.9, y - e.radius * 0.7);
            g.close();
            g.fill();
            g.fillColor = hex('#7F1D1D', 190);
            g.circle(x, y, e.radius * 0.3);
            g.fill();
        } else if (e.kind === 'weaver') {
            g.fillColor = hex(color);
            g.moveTo(x, y + e.radius);
            g.lineTo(x + e.radius, y);
            g.lineTo(x, y - e.radius);
            g.lineTo(x - e.radius, y);
            g.close();
            g.fill();
            g.fillColor = hex('#EDE9FE', 220);
            g.circle(x, y, e.radius * 0.28);
            g.fill();
        } else if (e.kind === 'tank') {
            g.fillColor = hex(color);
            g.roundRect(x - e.radius, y - e.radius * 0.8, e.radius * 2, e.radius * 1.6, 8);
            g.fill();
            g.fillColor = hex('#78350F');
            g.roundRect(x - e.radius * 0.55, y - e.radius * 0.45, e.radius * 1.1, e.radius * 0.9, 5);
            g.fill();
            g.fillColor = hex('#FDE68A', 210);
            g.circle(x - e.radius * 0.62, y, 3.5);
            g.fill();
            g.circle(x + e.radius * 0.62, y, 3.5);
            g.fill();
        } else {
            // 母舰：主舰体 + 两侧炮舱 + 会脉动的核心
            g.fillColor = hex(color);
            g.roundRect(x - e.radius, y - e.radius * 0.55, e.radius * 2, e.radius * 1.1, 16);
            g.fill();
            g.fillColor = hex('#7F1D1D');
            g.roundRect(x - e.radius * 1.3, y - e.radius * 0.26, e.radius * 0.5, e.radius * 0.52, 8);
            g.fill();
            g.roundRect(x + e.radius * 0.8, y - e.radius * 0.26, e.radius * 0.5, e.radius * 0.52, 8);
            g.fill();
            const pulse = 0.5 + 0.5 * Math.sin(e.t * 6);
            g.fillColor = hex('#FFD1D1', 120 + 100 * pulse);
            g.circle(x, y + 2, e.radius * 0.34);
            g.fill();
            g.fillColor = hex('#FFF1F2');
            g.circle(x, y + 2, e.radius * 0.16);
            g.fill();
        }
    }

    private _drawPowerup(g: Graphics, u: Powerup): void {
        const x = -FIELD_W / 2 + u.x;
        const y = FIELD_H / 2 - u.y;
        const color = u.kind === 'power' ? C.power : C.life;
        g.fillColor = hex(color, 55);
        g.circle(x, y, u.r + 7);
        g.fill();
        g.fillColor = hex('#0B1220');
        g.roundRect(x - u.r, y - u.r, u.r * 2, u.r * 2, 5);
        g.fill();
        g.strokeColor = hex(color);
        g.lineWidth = 2.5;
        g.roundRect(x - u.r, y - u.r, u.r * 2, u.r * 2, 5);
        g.stroke();
        if (u.kind === 'power') {
            g.moveTo(x - 5, y - 5);
            g.lineTo(x + 5, y + 5);
            g.moveTo(x + 5, y - 5);
            g.lineTo(x - 5, y + 5);
            g.stroke();
        } else {
            g.fillColor = hex(color);
            g.circle(x, y, 4.5);
            g.fill();
        }
    }

    private _drawHudGfx(): void {
        const g = this._hudGfx;
        if (!g) return;
        g.clear();

        // 生命：小飞船图标
        const lives = this._world.player.lives;
        for (let i = 0; i < lives; i++) {
            const x = FIELD_W / 2 - 40 - i * 38;
            const y = FIELD_H / 2 - 46;
            g.fillColor = hex(C.player);
            g.moveTo(x, y + 13);
            g.lineTo(x + 9, y - 8);
            g.lineTo(x, y - 3);
            g.lineTo(x - 9, y - 8);
            g.close();
            g.fill();
        }

        // 当前波次剩余敌人比例（条状）
        const w = this._world;
        const remain = w.remainingInWave();
        const barW = 260;
        const bx = -barW / 2;
        const by = FIELD_H / 2 - HUD_H + 6;
        g.fillColor = hex('#1B2740');
        g.roundRect(bx, by, barW, 6, 3);
        g.fill();
        const ratio = Math.min(1, remain / 12);
        if (ratio > 0.001) {
            g.fillColor = hex(C.player, 200);
            g.roundRect(bx, by, barW * ratio, 6, 3);
            g.fill();
        }

        // 母舰血条
        const boss = w.boss;
        if (boss) {
            const ratio2 = Math.max(0, boss.hp / boss.maxHp);
            const bw = 520;
            const bbx = -bw / 2;
            const bby = FIELD_H / 2 - HUD_H - 26;
            g.fillColor = hex('#2A1620');
            g.roundRect(bbx, bby, bw, 14, 7);
            g.fill();
            if (ratio2 > 0.001) {
                g.fillColor = hex(C.boss);
                g.roundRect(bbx + 2, bby + 2, (bw - 4) * ratio2, 10, 5);
                g.fill();
            }
        }
    }

    // ==================== 存档 ====================

    private _getItem(key: string, fallback: number): number {
        try {
            const raw = StorageManager.instance.getItem(GAME_ID, key);
            if (raw === null || raw === undefined) return fallback;
            const n = parseInt(raw, 10);
            return Number.isFinite(n) ? n : fallback;
        } catch (e) {
            return fallback;
        }
    }

    private _setItem(key: string, value: number): void {
        try {
            StorageManager.instance.setItem(GAME_ID, key, String(value));
        } catch (e) {
            /* 存档失败不影响游戏 */
        }
    }
}
