/**
 * 雷霆战机 —— 运行时界面（全 Graphics 绘制，零贴图零音频）。
 *
 * 世界坐标（见 ThunderCore）：x ∈ [0,720] 左→右，y ∈ [0,1280] 上→下。
 * 节点局部坐标换算：`localX = wx - 360`、`localY = 640 - wy`。
 */

import {
    _decorator,
    Component,
    EventTouch,
    Graphics,
    Label,
    Node,
    UIOpacity,
    UITransform,
    Vec3,
} from 'cc';
import {
    COLOR,
    FONT_BODY,
    FONT_CAPTION,
    FONT_DISPLAY,
    FONT_TITLE,
    createButton,
    createLabel,
    createNode,
    drawRoundRect,
    hex,
    toast,
} from '../../../common/ui/GameUIKit';
import { StorageManager } from '../../../common/managers/StorageManager';
import { createAudio } from '../../../common/audio/GameAudio';
import { SceneManager } from '../../../common/managers/SceneManager';
import {
    FIELD_H,
    FIELD_W,
    MAX_UPGRADE,
    PLAYER_VISUAL_R,
    THUNDER_LEVELS,
    ThunderWorld,
    UPGRADE_LABEL,
    applyUpgrade,
    clearReward,
    defaultSave,
    isMaxUpgrade,
    playerStats,
    sanitizeSave,
    starsFor,
    upgradeCost,
    type Enemy,
    type EnemyKind,
    type PlayerStats,
    type Powerup,
    type ThunderSave,
    type UpgradeTrack,
} from './ThunderCore';

const { ccclass } = _decorator;

const GAME_ID = 'thunder';
/** 全站统一音效 / 震动总线（试玩修复 C1）：配方在 common/audio/GameAudio */
const sfx = createAudio(GAME_ID);
const SAVE_KEY = 'save';
const HUD_H = 118;
const REVIVE_SECONDS = 5;

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
    destroyer: '#EF4444',
    fortress: '#A855F7',
    carrier: '#FB923C',
    core: '#FACC15',
    power: '#34D399',
    bomb: '#FB923C',
    shield: '#22D3EE',
    panel: '#141B28',
    panelLine: '#2C3A52',
    gold: '#FBBF24',
};

const ENEMY_COLOR: Record<EnemyKind, string> = {
    grunt: C.grunt,
    weaver: C.weaver,
    tank: C.tank,
    destroyer: C.destroyer,
    fortress: C.fortress,
    carrier: C.carrier,
    core: C.core,
};

type UiScreen = 'levels' | 'hangar' | 'battle' | 'settle';

@ccclass('ThunderGame')
export class ThunderGame extends Component {
    private _save: ThunderSave = defaultSave();
    private _world: ThunderWorld | null = null;
    private _levelIndex = 0;
    private _screen: UiScreen = 'levels';
    private _paused = false;
    private _finished = false;

    private _bgGfx: Graphics | null = null;
    private _fieldGfx: Graphics | null = null;
    private _hudGfx: Graphics | null = null;

    private _levelLabel: Label | null = null;
    private _scoreLabel: Label | null = null;
    /** 生命数字（报告 §3.25：三个无标签小三角，看不出是命） */
    private _livesLabel: Label | null = null;

    private _overlay: Node | null = null;
    private _bombBtn: Node | null = null;
    private _pauseBtn: Node | null = null;

    private _reviveShown = false;
    private _reviveT = 0;
    private _reviveLabel: Label | null = null;

    private _dragging = false;
    private _touchId = -1;
    private _dragOffX = 0;
    private _dragOffY = 0;

    private _time = 0;
    private _starScroll = 0;
    private _bombFxT = 0;
    private _bombFxX = 360;
    private _bombFxY = 1090;

    /** 上一帧的敌人位置：用来定位「这一帧被打掉」的敌人（飘字 / 爆炸的位置） */
    private _prevEnemies = new Map<number, { x: number; y: number }>();
    private _lastKills = 0;
    /** 击毁闪光与得分飘字（update 驱动，不建 tween） */
    private _fx: { x: number; y: number; t: number; max: number; r: number; color: string }[] = [];
    private _popups: { node: Node; x: number; y: number; t: number }[] = [];

    private _lastScore = -1;
    private _lastCoins = -1;
    private _lastLevel = '';
    private _lastLives = -1;
    private _lastBombs = -1;

    onLoad(): void {
        // 根节点必须是全屏 UITransform：Cocos 的 UI 点击按 UITransform 命中测试。
        const rootUt = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        rootUt.setAnchorPoint(0.5, 0.5);
        rootUt.setContentSize(FIELD_W, FIELD_H);

        this._save = this._loadSave();
        this._buildUi();
        this._bindEvents();
        this._showLevels();
    }

    onDestroy(): void {
        this.node.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        this.node.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        this.unscheduleAllCallbacks();
        this._overlay = null;
        this._bgGfx = null;
        this._fieldGfx = null;
        this._hudGfx = null;
        this._levelLabel = null;
        this._scoreLabel = null;
        this._livesLabel = null;
        this._bombBtn = null;
        this._pauseBtn = null;
        this._reviveLabel = null;
        this._prevEnemies.clear();
        this._popups = [];
        this._fx = [];
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

        this._levelLabel = createLabel(hud, '', FONT_BODY.fontSize, {
            x: 150 - 360,
            y: 640 - 40,
            color: COLOR.TEXT_PRIMARY,
            bold: true,
            width: 380,
        });
        this._levelLabel.node.setPosition(150 - 360, 640 - 40, 0);

        this._scoreLabel = createLabel(hud, '', FONT_CAPTION.fontSize, {
            x: 150 - 360,
            y: 640 - 78,
            color: COLOR.TEXT_SECONDARY,
            width: 420,
        });
        this._scoreLabel.node.setPosition(150 - 360, 640 - 78, 0);

        // 生命数字：贴在生命三角右侧（三角从 local x=250 往左排）
        this._livesLabel = createLabel(hud, '生命 ×0', FONT_CAPTION.fontSize, {
            x: 278,
            y: 42,
            color: C.player,
            width: 110,
            align: 'left',
        });

        // 炸弹钮从 112 降到 84：比飞船还抢眼会把视线从战场拉走（报告 §3.25）
        this._bombBtn = this._makeSmallButton(hud, '炸弹 1', 650, 1178, 84, C.bomb, () => this._onBombTap());
        this._pauseBtn = this._makeSmallButton(hud, 'II', 670, 62, 56, '#1B2740', () => this._onPauseTap());
        this._bombBtn.active = false;
        this._pauseBtn.active = false;
    }

    /** 带按压反馈 + 阻止拖动穿透的小按钮 */
    private _makeSmallButton(
        parent: Node,
        text: string,
        designX: number,
        designY: number,
        size: number,
        fill: string,
        onTap: () => void,
    ): Node {
        const btn = createButton(parent, {
            w: size,
            h: size,
            text,
            fontSize: size >= 100 ? FONT_BODY.fontSize : FONT_CAPTION.fontSize,
            fill,
            textColor: '#08121E',
            radius: size / 2,
            onTap,
        });
        btn.node.setPosition(designX - 360, 640 - designY, 0);
        btn.node.on(Node.EventType.TOUCH_START, this._onButtonTouchStart, this);
        return btn.node;
    }

    private _drawStars(): void {
        const g = this._bgGfx;
        if (!g) return;
        g.clear();
        let seed = 20261109;
        const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        // 画布按 fit-width 适配，上下会多出约 140 设计像素，底色必须铺满
        g.fillColor = hex('#070C16');
        g.rect(-FIELD_W / 2, -900, FIELD_W, 3100);
        g.fill();

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

    // ==================== 输入 ====================

    private _bindEvents(): void {
        this.node.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
    }

    /** 按钮上的触摸不再冒泡到根节点，避免「按炸弹 = 开始拖飞船」 */
    private _onButtonTouchStart(ev: EventTouch): void {
        ev.propagationStopped = true;
    }

    private _onTouchStart(ev: EventTouch): void {
        // 浏览器要求用户手势后才允许出声（微信同样建议首次触摸解锁）
        sfx.unlock();
        if (this._screen !== 'battle' || this._paused || !this._world) return;
        if (this._world.phase !== 'playing' || this._dragging) return;
        this._dragging = true;
        this._touchId = ev.getID();
        const p = this._designPoint(ev);
        this._dragOffX = this._world.playerX - p.x;
        this._dragOffY = this._world.playerY - p.y;
    }

    private _onTouchMove(ev: EventTouch): void {
        if (!this._dragging || ev.getID() !== this._touchId) return;
        if (this._screen !== 'battle' || this._paused || !this._world) return;
        const p = this._designPoint(ev);
        this._world.movePlayerTo(p.x + this._dragOffX, p.y + this._dragOffY);
    }

    private _onTouchEnd(ev: EventTouch): void {
        if (ev.getID() !== this._touchId) return;
        this._dragging = false;
        this._touchId = -1;
    }

    /** UI 触摸点 → 设计坐标（原点左上） */
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

    // ==================== 主循环 ====================

    update(dt: number): void {
        this._time += dt;

        if (this._screen !== 'battle') {
            this._scrollStars(dt * 0.25);
            return;
        }
        if (this._paused) {
            this._scrollStars(dt * 0.1);
            return;
        }

        const w = this._world;
        if (!w) return;

        if (this._bombFxT > 0) this._bombFxT = Math.max(0, this._bombFxT - dt);

        if (w.phase === 'revive') {
            if (!this._reviveShown) this._showRevive();
            this._reviveT -= dt;
            if (this._reviveT <= 0) {
                w.declineRevive();
                this._finish(false);
            } else if (this._reviveLabel) {
                this._reviveLabel.string = `自动放弃：${Math.ceil(this._reviveT)}s`;
            }
            return;
        }

        this._snapshotEnemies(w);
        w.update(dt);
        this._detectCombat(w, dt);

        if (w.phase === 'won') {
            this._finish(true);
            return;
        }
        if (w.phase === 'lost') {
            this._finish(false);
            return;
        }

        this._stepFx(dt);
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

    // ==================== 关卡选择 ====================

    private _isLevelUnlocked(index: number): boolean {
        if (index <= 0) return true;
        return this._save.stars[index - 1] >= 1;
    }

    private _showLevels(): void {
        this._screen = 'levels';
        this._paused = false;
        this._finished = false;
        this._hideBattleChrome();
        this._clearOverlay();

        const overlay = createNode('LevelsOverlay', this.node, FIELD_W, FIELD_H);
        const g = overlay.addComponent(Graphics);
        g.fillColor = hex('#050A14', 232);
        g.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H);
        g.fill();

        createLabel(overlay, '雷霆战机', FONT_DISPLAY.fontSize, {
            x: 0, y: 640 - 86, color: COLOR.TEXT_PRIMARY, bold: true,
        });
        createLabel(overlay, 'T H U N D E R', FONT_CAPTION.fontSize, {
            x: 0, y: 640 - 132, color: C.player,
        });

        this._drawCoinBadge(overlay, 640, 62);

        const colX = [190, 530];
        for (let i = 0; i < THUNDER_LEVELS.length; i++) {
            const lv = THUNDER_LEVELS[i];
            const col = i % 2;
            const row = Math.floor(i / 2);
            const x = colX[col];
            const y = 220 + row * 168;
            const unlocked = this._isLevelUnlocked(i);
            const stars = this._save.stars[i] ?? 0;

            const card = createButton(overlay, {
                w: 300,
                h: 148,
                text: '',
                fill: unlocked ? '#182234' : '#111827',
                stroke: unlocked ? (stars >= 3 ? C.gold : C.panelLine) : '#1F2937',
                radius: 18,
                onTap: unlocked
                    ? () => this._startBattle(i)
                    : () => toast(this.node, `通关第 ${i} 关解锁`, 1.4),
            });
            card.node.setPosition(x - 360, 640 - y, 0);
            card.label.node.active = false;

            createLabel(card.node, `${i + 1 < 10 ? '0' : ''}${i + 1} · ${lv.name}`, FONT_BODY.fontSize, {
                x: 0, y: 42, color: unlocked ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED,
                bold: true, width: 270,
            });
            createLabel(card.node, stars > 0 ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : (unlocked ? '未通关' : '未解锁'), FONT_BODY.fontSize, {
                x: 0, y: 4,
                color: stars > 0 ? C.gold : COLOR.TEXT_DISABLED,
                width: 270,
            });
            createLabel(card.node, unlocked
                ? `最高 ${this._save.bestScore[i] ?? 0}　推荐 Lv.${lv.recommendAttack + 1}`
                : `通关第 ${i} 关解锁`, FONT_CAPTION.fontSize, {
                x: 0, y: -38, color: COLOR.TEXT_SECONDARY, width: 270,
            });
        }

        const hangar = createButton(overlay, {
            w: 300,
            h: 88,
            text: '机库升级',
            fontSize: FONT_BODY.fontSize,
            fill: C.player,
            textColor: '#06212E',
            onTap: () => this._showHangar(),
        });
        hangar.node.setPosition(0, 640 - 1140, 0);

        this._addBackButton(overlay);
        this._overlay = overlay;
    }

    private _drawCoinBadge(parent: Node, designX: number, designY: number): void {
        const node = createNode('CoinBadge', parent, 220, 44);
        node.setPosition(designX - 360, 640 - designY, 0);
        const g = node.addComponent(Graphics);
        g.fillColor = hex(C.gold);
        g.circle(-72, 0, 13);
        g.fill();
        g.fillColor = hex('#7C4A03');
        g.circle(-72, 0, 8);
        g.fill();
        const label = createLabel(node, `金币 ${this._save.coins}`, FONT_BODY.fontSize, {
            x: 17, y: 0, color: C.gold, bold: true, width: 150, align: 'left',
        });
        label.node.setPosition(17, 0, 0);
    }

    private _addBackButton(parent: Node): void {
        const back = createButton(parent, {
            w: 72,
            h: 72,
            text: '‹',
            fontSize: 46,
            fill: '#1B2740',
            textColor: '#E5E7EB',
            stroke: '#3A4658',
            radius: 36,
            onTap: () => SceneManager.gotoLobby(),
        });
        back.node.setPosition(58 - 360, 640 - 62, 0);
    }

    // ==================== 机库 ====================

    private _showHangar(): void {
        this._screen = 'hangar';
        this._hideBattleChrome();
        this._clearOverlay();

        const overlay = createNode('HangarOverlay', this.node, FIELD_W, FIELD_H);
        const g = overlay.addComponent(Graphics);
        g.fillColor = hex('#050A14', 238);
        g.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H);
        g.fill();

        createLabel(overlay, '机库', FONT_TITLE.fontSize, {
            x: 0, y: 640 - 86, color: COLOR.TEXT_PRIMARY, bold: true,
        });
        this._drawCoinBadge(overlay, 620, 62);

        const tracks: UpgradeTrack[] = ['attack', 'armor', 'wing', 'bomb'];
        const stats = playerStats(this._save);
        tracks.forEach((track, i) => {
            const y = 240 + i * 190;
            const row = createNode(`${track}Row`, overlay, 640, 164);
            row.setPosition(0, 640 - y, 0);
            const rg = row.addComponent(Graphics);
            drawRoundRect(rg, 640, 164, 20, hex('#182234'), hex(C.panelLine), 2);

            const lv = this._save.upgrades[track];
            const max = isMaxUpgrade(this._save, track);
            createLabel(row, UPGRADE_LABEL[track], FONT_TITLE.fontSize, {
                x: -230, y: 44, color: COLOR.TEXT_PRIMARY, bold: true, width: 180,
            });
            createLabel(row, `Lv.${lv + 1} / ${MAX_UPGRADE[track] + 1}`, FONT_CAPTION.fontSize, {
                x: -110, y: 44, color: COLOR.TEXT_SECONDARY, width: 140,
            });
            createLabel(row, this._upgradeEffect(track, stats), FONT_BODY.fontSize, {
                x: -160, y: -18, color: C.player, width: 300,
            });

            const cost = max ? 0 : upgradeCost(track, lv);
            const canAfford = !max && this._save.coins >= cost;
            const btn = createButton(row, {
                w: 200,
                h: 92,
                text: max ? 'MAX' : `升级 ${cost}`,
                fontSize: FONT_BODY.fontSize,
                fill: max ? '#374151' : canAfford ? C.player : '#374151',
                textColor: max ? '#9CA3AF' : canAfford ? '#06212E' : '#9CA3AF',
                radius: 16,
                onTap: () => this._onUpgradeTap(track),
            });
            btn.node.setPosition(190, -8, 0);
        });

        const back = createButton(overlay, {
            w: 320,
            h: 88,
            text: '返回关卡',
            fontSize: FONT_BODY.fontSize,
            onTap: () => this._showLevels(),
        });
        back.node.setPosition(0, 640 - 1150, 0);

        this._overlay = overlay;
    }

    private _upgradeEffect(track: UpgradeTrack, stats: PlayerStats): string {
        const lv = this._save.upgrades[track];
        if (track === 'attack') return `伤害 ${stats.damage}${lv >= 9 ? '' : ` → ${stats.damage + 1}`}`;
        if (track === 'armor') return `生命 ${stats.maxLives}${lv >= 4 ? '' : ` → ${stats.maxLives + 1}`}`;
        if (track === 'wing') {
            const counts = [0, 2, 2, 4];
            const next = counts[Math.min(3, lv + 1)];
            return `僚机 ${stats.wingCount} 架${lv >= 3 ? '' : ` → ${next} 架`}`;
        }
        return `炸弹容量 ${stats.bombCapacity}${lv >= 2 ? '' : ` → ${stats.bombCapacity + 1}`}`;
    }

    private _onUpgradeTap(track: UpgradeTrack): void {
        if (isMaxUpgrade(this._save, track)) return;
        if (!applyUpgrade(this._save, track)) {
            toast(this.node, '金币不足', 1.2);
            return;
        }
        this._saveGame();
        this._showHangar();
    }

    // ==================== 战斗 ====================

    private _startBattle(levelIndex: number): void {
        const safeIndex = Number.isFinite(levelIndex) ? levelIndex : 0;
        this._levelIndex = Math.max(0, Math.min(THUNDER_LEVELS.length - 1, safeIndex));
        const stats = playerStats(this._save);
        this._world = new ThunderWorld(this._levelIndex, stats);
        this._world.reset();
        this._screen = 'battle';
        this._paused = false;
        this._finished = false;
        this._dragging = false;
        this._reviveShown = false;
        this._bombFxT = 0;
        this._clearOverlay();
        this._lastScore = -1;
        this._lastCoins = -1;
        this._lastLevel = '';
        this._lastLives = -1;
        this._lastBombs = -1;
        this._lastKills = 0;
        this._prevEnemies.clear();
        this._clearFx();
        this._showBattleChrome();
        this._draw();
        this._syncHud();
    }

    private _showBattleChrome(): void {
        if (this._bombBtn && this._bombBtn.isValid) this._bombBtn.active = true;
        if (this._pauseBtn && this._pauseBtn.isValid) this._pauseBtn.active = true;
        if (this._levelLabel) this._levelLabel.node.active = true;
        if (this._scoreLabel) this._scoreLabel.node.active = true;
    }

    private _hideBattleChrome(): void {
        if (this._bombBtn && this._bombBtn.isValid) this._bombBtn.active = false;
        if (this._pauseBtn && this._pauseBtn.isValid) this._pauseBtn.active = false;
        if (this._levelLabel) this._levelLabel.node.active = false;
        if (this._scoreLabel) this._scoreLabel.node.active = false;
        const field = this._fieldGfx;
        if (field) field.clear();
        const hud = this._hudGfx;
        if (hud) hud.clear();
    }

    private _onBombTap(): void {
        const w = this._world;
        if (!w || this._screen !== 'battle' || this._paused || w.phase !== 'playing') return;
        if (!w.useBomb()) {
            toast(this.node, '炸弹不足', 1.0);
            return;
        }
        this._bombFxT = 0.35;
        sfx.play('boom');
        this._bombFxX = w.playerX;
        this._bombFxY = w.playerY;
        this._syncHud();
    }

    private _onPauseTap(): void {
        if (this._screen !== 'battle' || this._paused) return;
        this._paused = true;
        this._showPause();
    }

    private _showPause(): void {
        this._clearOverlay();
        const overlay = createNode('PauseOverlay', this.node, FIELD_W, FIELD_H);
        const g = overlay.addComponent(Graphics);
        g.fillColor = hex('#050A14', 210);
        g.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H);
        g.fill();

        const panel = createNode('Panel', overlay, 480, 380);
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, 480, 380, 26, hex(C.panel), hex(C.panelLine), 2);
        createLabel(panel, '暂停', FONT_TITLE.fontSize, {
            x: 0, y: 110, color: COLOR.TEXT_PRIMARY, bold: true,
        });
        const resume = createButton(panel, {
            w: 320, h: 88, text: '继续', fontSize: FONT_BODY.fontSize,
            fill: C.player, textColor: '#06212E',
            onTap: () => this._resumeGame(),
        });
        resume.node.setPosition(0, 10, 0);
        const quit = createButton(panel, {
            w: 320, h: 80, text: '退出本关', fontSize: FONT_BODY.fontSize,
            onTap: () => this._quitBattle(),
        });
        quit.node.setPosition(0, -100, 0);

        this._overlay = overlay;
    }

    private _resumeGame(): void {
        this._paused = false;
        this._clearOverlay();
        // 暂停时若正卡在复活倒计时，恢复后要让 update() 重新拉起复活面板
        const w = this._world;
        if (w && w.phase === 'revive' && !this._overlay) {
            this._reviveShown = false;
        }
    }

    private _quitBattle(): void {
        const w = this._world;
        if (!w) return;
        w.phase = 'lost';
        this._paused = false;
        this._clearOverlay();
        this._finish(false);
    }

    // ==================== 复活 / 结算 ====================

    private _showRevive(): void {
        this._reviveShown = true;
        this._reviveT = REVIVE_SECONDS;
        this._clearOverlay();

        const overlay = createNode('ReviveOverlay', this.node, FIELD_W, FIELD_H);
        const g = overlay.addComponent(Graphics);
        g.fillColor = hex('#050A14', 226);
        g.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H);
        g.fill();

        const panel = createNode('Panel', overlay, 560, 440);
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, 560, 440, 26, hex(C.panel), hex(COLOR.DANGER), 2);
        createLabel(panel, '战机被击落', FONT_TITLE.fontSize, {
            x: 0, y: 130, color: COLOR.TEXT_PRIMARY, bold: true,
        });
        createLabel(panel, '本关免费复活一次', FONT_BODY.fontSize, {
            x: 0, y: 66, color: COLOR.TEXT_SECONDARY,
        });
        this._reviveLabel = createLabel(panel, `自动放弃：${REVIVE_SECONDS}s`, FONT_CAPTION.fontSize, {
            x: 0, y: 24, color: COLOR.DANGER,
        });

        const revive = createButton(panel, {
            w: 380, h: 96, text: '复活', fontSize: FONT_TITLE.fontSize,
            fill: C.player, textColor: '#06212E',
            onTap: () => this._onReviveTap(),
        });
        revive.node.setPosition(0, -64, 0);
        const giveUp = createButton(panel, {
            w: 380, h: 76, text: '放弃', fontSize: FONT_BODY.fontSize,
            onTap: () => this._onGiveUpTap(),
        });
        giveUp.node.setPosition(0, -160, 0);

        this._overlay = overlay;
    }

    private _onReviveTap(): void {
        const w = this._world;
        if (!w) return;
        if (!w.revive()) return;
        this._reviveShown = false;
        this._reviveLabel = null;
        this._clearOverlay();
        this._draw();
        this._syncHud();
    }

    private _onGiveUpTap(): void {
        const w = this._world;
        if (!w) return;
        w.declineRevive();
        this._reviveShown = false;
        this._reviveLabel = null;
        this._clearOverlay();
        this._finish(false);
    }

    private _finish(won: boolean): void {
        if (this._finished) return;
        const w = this._world;
        if (!w) return;
        this._finished = true;
        this._screen = 'settle';
        sfx.play(won ? 'won' : 'dead');
        this._clearFx();
        this._paused = false;
        this._hideBattleChrome();

        const stars = starsFor(won, w.usedRevive, w.usedBomb);
        const reward = clearReward(this._levelIndex, stars);
        // 试玩报告 §3.25：飞 15 秒被击落只拿 3 金币，而首个升级要 100 → 约 30 局才能升一级。
        // 失败局保底 30 金币，让「打不过」也在推进机库养成；胜利仍按星级另算奖励。
        const consolation = won ? 0 : Math.max(0, 30 - w.coinsEarned);
        const earned = w.coinsEarned + consolation + (won ? reward.clearCoins + reward.starCoins : 0);

        this._save.coins += earned;
        if (stars > (this._save.stars[this._levelIndex] ?? 0)) {
            this._save.stars[this._levelIndex] = stars;
        }
        if (w.score > (this._save.bestScore[this._levelIndex] ?? 0)) {
            this._save.bestScore[this._levelIndex] = w.score;
        }
        this._saveGame();

        this._showSettle(won, stars, earned);
    }

    private _showSettle(won: boolean, stars: number, earned: number): void {
        this._clearOverlay();
        const w = this._world;

        const overlay = createNode('SettleOverlay', this.node, FIELD_W, FIELD_H);
        const g = overlay.addComponent(Graphics);
        g.fillColor = hex('#050A14', 232);
        g.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H);
        g.fill();

        const panel = createNode('Panel', overlay, 600, 680);
        const pg = panel.addComponent(Graphics);
        drawRoundRect(pg, 600, 680, 28, hex(C.panel), hex(won ? C.player : '#7F1D1D'), 2);

        createLabel(panel, won ? '关卡完成' : '任务失败', FONT_TITLE.fontSize, {
            x: 0, y: 258, color: won ? C.player : COLOR.DANGER, bold: true,
        });
        createLabel(panel, `${this._levelIndex + 1} · ${THUNDER_LEVELS[this._levelIndex].name}`, FONT_CAPTION.fontSize, {
            x: 0, y: 212, color: COLOR.TEXT_SECONDARY,
        });
        createLabel(panel, won
            ? '击破关底 Boss'
            : `在「${w ? w.wave.name : '战场'}」被击落`, FONT_CAPTION.fontSize, {
            x: 0, y: 184, color: won ? C.player : COLOR.DANGER,
        });

        createLabel(panel, won ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '☆☆☆', FONT_DISPLAY.fontSize, {
            x: 0, y: 142, color: won ? C.gold : COLOR.TEXT_DISABLED, bold: true,
        });

        createLabel(panel, `得分 ${w ? w.score : 0}`, FONT_BODY.fontSize, {
            x: 0, y: 72, color: COLOR.TEXT_PRIMARY,
        });
        createLabel(panel, `本局金币 +${earned}`, FONT_BODY.fontSize, {
            x: 0, y: 28, color: C.gold,
        });
        createLabel(panel, `累计金币 ${this._save.coins}`, FONT_CAPTION.fontSize, {
            x: 0, y: -6, color: COLOR.TEXT_SECONDARY,
        });

        const retry = createButton(panel, {
            w: 360, h: 88, text: '重试', fontSize: FONT_BODY.fontSize,
            fill: '#1E293B', onTap: () => this._startBattle(this._levelIndex),
        });
        retry.node.setPosition(0, -92, 0);

        const hasNext = won && this._levelIndex + 1 < THUNDER_LEVELS.length;
        if (hasNext) {
            const next = createButton(panel, {
                w: 360, h: 88, text: '下一关', fontSize: FONT_BODY.fontSize,
                fill: C.player, textColor: '#06212E',
                onTap: () => this._startBattle(this._levelIndex + 1),
            });
            next.node.setPosition(0, -186, 0);
        }

        const back = createButton(panel, {
            w: 360, h: 76, text: '返回关卡', fontSize: FONT_BODY.fontSize,
            onTap: () => this._showLevels(),
        });
        back.node.setPosition(0, hasNext ? -278 : -190, 0);

        this._overlay = overlay;
    }

    private _clearOverlay(): void {
        if (this._overlay && this._overlay.isValid) {
            this._overlay.destroy();
        }
        this._overlay = null;
        this._reviveLabel = null;
    }

    // ==================== HUD ====================

    private _syncHud(): void {
        const w = this._world;
        if (!w) return;

        const levelText = `第 ${this._levelIndex + 1} 关 · ${w.level.name}`;
        if (this._levelLabel && levelText !== this._lastLevel) {
            this._lastLevel = levelText;
            this._levelLabel.string = levelText;
        }

        const info = `分数 ${w.score}　金币 ${w.coinsEarned}`;
        const infoKey = `${w.score}:${w.coinsEarned}`;
        if (this._scoreLabel && infoKey !== this._lastScore + ':' + this._lastCoins) {
            this._lastScore = w.score;
            this._lastCoins = w.coinsEarned;
            this._scoreLabel.string = info;
        }

        if (this._bombBtn && w.bombs !== this._lastBombs) {
            this._lastBombs = w.bombs;
            const label = this._bombBtn.getComponentInChildren(Label);
            if (label) label.string = `炸弹 ${w.bombs}`;
        }

        if (w.lives !== this._lastLives) {
            this._lastLives = w.lives;
            if (this._livesLabel) this._livesLabel.string = `生命 ×${w.lives}`;
        }

        this._drawHudGfx();
    }

    private _drawHudGfx(): void {
        const g = this._hudGfx;
        const w = this._world;
        if (!g || !w) return;
        g.clear();

        // 生命：小三角
        for (let i = 0; i < w.lives; i++) {
            const x = FIELD_W / 2 - 110 - i * 30;
            const y = FIELD_H / 2 - 42;
            g.fillColor = hex(C.player);
            g.moveTo(x, y + 11);
            g.lineTo(x + 8, y - 6);
            g.lineTo(x, y - 2);
            g.lineTo(x - 8, y - 6);
            g.close();
            g.fill();
        }

        // 护盾提示
        if (w.shields > 0) {
            g.strokeColor = hex(C.shield, 220);
            g.lineWidth = 2.5;
            g.circle(-FIELD_W / 2 + w.playerX, FIELD_H / 2 - w.playerY, PLAYER_VISUAL_R + 12);
            g.stroke();
        }

        // Boss 血条
        const boss = w.boss;
        if (boss) {
            const ratio = Math.max(0, boss.hp / boss.maxHp);
            const bw = 520;
            const bx = -bw / 2;
            const by = FIELD_H / 2 - HUD_H - 30;
            g.fillColor = hex('#2A1620');
            g.roundRect(bx, by, bw, 14, 7);
            g.fill();
            if (ratio > 0.001) {
                g.fillColor = hex(ENEMY_COLOR[boss.kind]);
                g.roundRect(bx + 2, by + 2, (bw - 4) * ratio, 10, 5);
                g.fill();
            }
        }

        // 波次剩余进度
        const remain = w.remainingInWave();
        const barW = 240;
        const bx2 = -barW / 2;
        const by2 = FIELD_H / 2 - HUD_H + 4;
        g.fillColor = hex('#1B2740');
        g.roundRect(bx2, by2, barW, 5, 2.5);
        g.fill();
        const ratio2 = Math.min(1, remain / 12);
        if (ratio2 > 0.001) {
            g.fillColor = hex(C.player, 200);
            g.roundRect(bx2, by2, barW * ratio2, 5, 2.5);
            g.fill();
        }
    }

    // ==================== 绘制 ====================

    private _draw(): void {
        const g = this._fieldGfx;
        const w = this._world;
        if (!g || !w) return;
        g.clear();

        this._drawPlayer(g);
        for (const e of w.enemies) this._drawEnemy(g, e);
        for (const u of w.powerups) this._drawPowerup(g, u);

        // 玩家子弹
        g.fillColor = hex(C.playerBullet);
        for (const b of w.playerBullets) {
            g.roundRect(-FIELD_W / 2 + b.x - 2.5, FIELD_H / 2 - b.y - 9, 5, 18, 2.5);
        }
        g.fill();

        // 敌弹
        for (const b of w.enemyBullets) {
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

        // 炸弹扩散光环
        if (this._bombFxT > 0) {
            const t = 1 - this._bombFxT / 0.35;
            const x = -FIELD_W / 2 + this._bombFxX;
            const y = FIELD_H / 2 - this._bombFxY;
            g.strokeColor = hex('#BFE9FF', Math.round(220 * (1 - t)));
            g.lineWidth = 6 * (1 - t) + 2;
            g.circle(x, y, 40 + t * 620);
            g.stroke();
        }

        // 击毁闪光：短促的扩散圆环 + 内实心点（打击感的核心反馈）
        for (const f of this._fx) {
            const t = 1 - f.t / f.max;
            const x = -FIELD_W / 2 + f.x;
            const y = FIELD_H / 2 - f.y;
            g.fillColor = hex(f.color, Math.round(150 * (1 - t)));
            g.circle(x, y, f.r * (0.35 + t * 0.9));
            g.fill();
            g.strokeColor = hex(f.color, Math.round(220 * (1 - t)));
            g.lineWidth = 3;
            g.circle(x, y, f.r * (0.8 + t * 2.2));
            g.stroke();
        }
    }

    // ==================== 战斗反馈（命中 / 击毁 / 受伤） ====================

    /** 每帧记录敌人位置，下一帧用来判断谁消失了 */
    private _snapshotEnemies(w: ThunderWorld): void {
        this._prevEnemies.clear();
        for (const e of w.enemies) this._prevEnemies.set(e.id, { x: e.x, y: e.y });
    }

    /**
     * 从 world 的状态差推断这一帧发生了什么：
     * 击杀数增加 → 击毁音 + 爆炸 + 得分飘字；生命减少 → 受击音 + 震动。
     * 不改 core（ThunderCore 没有事件队列），代价是「飞出屏幕的敌人」也会被当成消失，
     * 所以只对击杀数以内的消失做特效，且限制在场地内。
     */
    private _detectCombat(w: ThunderWorld, dt: number): void {
        const gained = w.kills - this._lastKills;
        this._lastKills = w.kills;

        if (gained > 0) {
            const gone: { x: number; y: number }[] = [];
            for (const [id, pos] of this._prevEnemies) {
                if (w.enemies.some((e) => e.id === id)) continue;
                if (pos.x < -40 || pos.x > FIELD_W + 40 || pos.y < -40 || pos.y > FIELD_H + 40) continue;
                gone.push(pos);
            }
            let fxCount = 0;
            for (const pos of gone) {
                if (fxCount >= gained) break;
                fxCount++;
                sfx.play('kill');
                this._fx.push({ x: pos.x, y: pos.y, t: 0.26, max: 0.26, r: 26, color: C.core });
                this._spawnPopup(pos.x, pos.y, `+${Math.max(1, Math.round(w.score / Math.max(1, w.kills)))}`, C.gold);
            }
            if (fxCount < gained) {
                // 找不到尸体（同时消失好几个 / 屏幕外）时，至少给一声 + 中央闪光
                sfx.play('kill');
                this._fx.push({ x: FIELD_W / 2, y: FIELD_H / 2, t: 0.2, max: 0.2, r: 30, color: C.core });
            }
        }

        if (this._lastLives >= 0 && w.lives < this._lastLives) {
            sfx.play('playerHit');
            this._fx.push({ x: w.playerX, y: w.playerY, t: 0.3, max: 0.3, r: 34, color: C.enemyBullet });
        }
        this._lastLives = w.lives;
    }

    /** 得分飘字：小号金字向上飘 70px 后淡出（update 驱动，避免 tween 生命周期问题） */
    private _spawnPopup(x: number, y: number, text: string, color: string): void {
        const label = createLabel(this.node, text, FONT_CAPTION.fontSize, {
            x: x - FIELD_W / 2,
            y: FIELD_H / 2 - y,
            color,
            bold: true,
        });
        const node = label.node;
        const op = node.addComponent(UIOpacity) ?? node.getComponent(UIOpacity);
        if (op) op.opacity = 255;
        this._popups.push({ node, x: x - FIELD_W / 2, y: FIELD_H / 2 - y, t: 0.7 });
    }

    private _stepFx(dt: number): void {
        for (let i = this._fx.length - 1; i >= 0; i--) {
            this._fx[i].t -= dt;
            if (this._fx[i].t <= 0) this._fx.splice(i, 1);
        }
        for (let i = this._popups.length - 1; i >= 0; i--) {
            const p = this._popups[i];
            p.t -= dt;
            if (p.t <= 0) {
                if (p.node.isValid) p.node.destroy();
                this._popups.splice(i, 1);
                continue;
            }
            const k = 1 - p.t / 0.7;
            if (p.node.isValid) {
                p.node.setPosition(p.x, p.y + 70 * k, 0);
                const op = p.node.getComponent(UIOpacity);
                if (op) op.opacity = Math.round(255 * (1 - k * k));
            }
        }
    }

    private _clearFx(): void {
        for (const p of this._popups) if (p.node.isValid) p.node.destroy();
        this._popups = [];
        this._fx = [];
    }

    private _drawPlayer(g: Graphics): void {
        const w = this._world;
        if (!w) return;
        const x = -FIELD_W / 2 + w.playerX;
        const y = FIELD_H / 2 - w.playerY;

        // 无敌只做闪烁提示，机体照常可见
        if (w.playerInvuln > 0 && Math.floor(this._time * 10) % 2 === 0) {
            g.strokeColor = hex(C.player, 160);
            g.lineWidth = 2.5;
            g.circle(x, y, PLAYER_VISUAL_R + 11);
            g.stroke();
        }

        // 僚机
        const offsets = w.stats.wingLevel === 3 ? [-64, -38, 38, 64] : w.stats.wingLevel > 0 ? [-46, 46] : [];
        for (const ox of offsets) {
            g.fillColor = hex('#2A7FA8');
            g.moveTo(x + ox, y + 8);
            g.lineTo(x + ox + 7, y - 8);
            g.lineTo(x + ox - 7, y - 8);
            g.close();
            g.fill();
            g.fillColor = hex(C.playerCore, 200);
            g.circle(x + ox, y - 1, 2.5);
            g.fill();
        }

        // 机身
        g.fillColor = hex(C.player);
        g.moveTo(x, y + 24);
        g.lineTo(x + 13, y - 6);
        g.lineTo(x + 5, y - 15);
        g.lineTo(x, y - 8);
        g.lineTo(x - 5, y - 15);
        g.lineTo(x - 13, y - 6);
        g.close();
        g.fill();

        // 机翼
        g.fillColor = hex('#2A7FA8');
        g.moveTo(x - 13, y - 2);
        g.lineTo(x - 23, y - 13);
        g.lineTo(x - 13, y - 13);
        g.close();
        g.moveTo(x + 13, y - 2);
        g.lineTo(x + 23, y - 13);
        g.lineTo(x + 13, y - 13);
        g.close();
        g.fill();

        // 驾驶舱
        g.fillColor = hex(C.playerCore);
        g.circle(x, y + 3, 4.5);
        g.fill();

        // 尾焰
        const flame = 8 + Math.sin(this._time * 40) * 3;
        g.fillColor = hex('#7DD3FC', 150);
        g.moveTo(x - 5, y - 13);
        g.lineTo(x + 5, y - 13);
        g.lineTo(x, y - 13 - flame);
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
            this._drawBoss(g, e, x, y, color);
        }
    }

    private _drawBoss(g: Graphics, e: Enemy, x: number, y: number, color: string): void {
        const r = e.radius;
        const pulse = 0.5 + 0.5 * Math.sin(e.t * 6);
        if (e.kind === 'destroyer') {
            g.fillColor = hex(color);
            g.roundRect(x - r, y - r * 0.5, r * 2, r, 14);
            g.fill();
            g.fillColor = hex('#7F1D1D');
            g.roundRect(x - r * 1.35, y - r * 0.24, r * 0.55, r * 0.48, 8);
            g.fill();
            g.roundRect(x + r * 0.8, y - r * 0.24, r * 0.55, r * 0.48, 8);
            g.fill();
        } else if (e.kind === 'fortress') {
            g.fillColor = hex(color);
            g.roundRect(x - r, y - r * 0.62, r * 2, r * 1.24, 16);
            g.fill();
            g.fillColor = hex('#4C1D95');
            for (let k = -1; k <= 1; k += 2) {
                g.roundRect(x + k * r * 0.78 - 8, y - r * 0.4, 16, r * 0.8, 6);
                g.fill();
            }
        } else if (e.kind === 'carrier') {
            g.fillColor = hex(color);
            g.roundRect(x - r, y - r * 0.55, r * 2, r * 1.1, 18);
            g.fill();
            g.fillColor = hex('#7C2D12');
            g.roundRect(x - r * 1.35, y - r * 0.28, r * 0.5, r * 0.56, 8);
            g.fill();
            g.roundRect(x + r * 0.85, y - r * 0.28, r * 0.5, r * 0.56, 8);
            g.fill();
        } else {
            // 雷霆核心：六边形 + 双层核心
            g.fillColor = hex(color);
            for (let k = 0; k < 6; k++) {
                const a = (k * Math.PI) / 3 - Math.PI / 6;
                const px = x + Math.cos(a) * r;
                const py = y + Math.sin(a) * r * 0.85;
                if (k === 0) g.moveTo(px, py);
                else g.lineTo(px, py);
            }
            g.close();
            g.fill();
        }

        // 核心
        g.fillColor = hex('#FFF1F2', 120 + 100 * pulse);
        g.circle(x, y + 2, r * 0.32);
        g.fill();
        g.fillColor = hex('#FFFFFF');
        g.circle(x, y + 2, r * 0.14);
        g.fill();
    }

    private _drawPowerup(g: Graphics, u: Powerup): void {
        const x = -FIELD_W / 2 + u.x;
        const y = FIELD_H / 2 - u.y;
        const color = u.kind === 'power' ? C.power : u.kind === 'bomb' ? C.bomb : C.shield;
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
            g.strokeColor = hex(color);
            g.lineWidth = 3;
            g.moveTo(x - 5, y);
            g.lineTo(x + 5, y);
            g.moveTo(x, y - 5);
            g.lineTo(x, y + 5);
            g.stroke();
        } else if (u.kind === 'bomb') {
            g.fillColor = hex(color);
            g.circle(x, y, 5.5);
            g.fill();
            g.strokeColor = hex(color);
            g.lineWidth = 2;
            g.circle(x, y, 9);
            g.stroke();
        } else {
            g.fillColor = hex(color);
            g.moveTo(x, y + 7);
            g.lineTo(x + 7, y);
            g.lineTo(x, y - 7);
            g.lineTo(x - 7, y);
            g.close();
            g.fill();
        }
    }

    // ==================== 存档 ====================

    private _loadSave(): ThunderSave {
        try {
            const raw = StorageManager.instance.getItem(GAME_ID, SAVE_KEY);
            if (!raw) return defaultSave();
            return sanitizeSave(JSON.parse(raw));
        } catch (e) {
            return defaultSave();
        }
    }

    private _saveGame(): void {
        try {
            StorageManager.instance.setItem(GAME_ID, SAVE_KEY, JSON.stringify(this._save));
        } catch (e) {
            /* 存档失败不影响游戏 */
        }
    }
}
