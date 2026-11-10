/**
 * 冰箱底下 — 渲染层。
 *
 * 用 1 个 Graphics 每帧 clear() 后按层重画（规格 §14.3 / §14.4）：
 * 地板 → 网格 → 墙与门 → 拾取物 → 敌人 → 子弹 → 玩家 → 特效。
 *
 * 约定：
 *  - 只读快照，不改核心状态
 *  - 细线一律 rect() + fill()（踩坑手册 §4.5），不用 stroke()
 *  - 颜色在 onLoad 解析好缓存，每帧不 new 对象
 *  - 零贴图：所有实体由圆 / 矩形 / 多边形拼出来
 */

import { _decorator, Color, Component, Graphics, Node, UITransform } from 'cc';
import { hex } from '../../../common/ui/UITheme';
import {
    ARENA_MAX_X, ARENA_MAX_Y, ARENA_MIN_X, ARENA_MIN_Y,
    BOMB_FUSE, BOMB_RADIUS, BOSS_TINT,
    COLS, FIELD_H, FIELD_W, FLOOR_PALETTES, PAL, PLAYER_PALETTES, ROWS, TILE, DOOR_HALF, WALL,
    isBossKind,
} from './FridgeConfig';
import type { CoreEvent, Enemy, FridgeSnapshot, Pickup } from './FridgeConfig';

const { ccclass, property } = _decorator;

interface Fx {
    kind: 'ring' | 'spark';
    x: number;
    y: number;
    r: number;
    t: number;
    life: number;
    color: Color;
}

@ccclass('FridgeRenderer')
export class FridgeRenderer extends Component {
    @property({ type: Graphics, tooltip: '实体层（留空则运行时自动创建）' })
    entityGfx: Graphics | null = null;

    /** 每帧渲染耗时（毫秒），性能验收用 */
    lastRenderMs = 0;

    private _g: Graphics | null = null;
    private _fx: Fx[] = [];
    private _flash = 0;
    /** 换房黑场剩余时间 */
    private _fade = 0;
    /** 赋色用的暂存色，避免污染缓存颜色 */
    private _tmpColor = new Color();

    // 颜色缓存
    private _cBg = new Color();
    private _cFloor = new Color();
    private _cGrid = new Color();
    private _cWall = new Color();
    private _cDoor = new Color();
    private _cAccent = new Color();
    private _cPlayer = hex(PAL.player);
    private _cPlayerDark = hex(PAL.playerDark);
    private _cEye = hex(PAL.eye);
    private _cTear = hex(PAL.tear);
    private _cEnemy = hex(PAL.enemy);
    private _cEnemyDark = hex(PAL.enemyDark);
    private _cCan = hex(PAL.can);
    private _cCanRed = hex(PAL.red);
    private _cEnemyBullet = hex(PAL.enemyBullet);
    private _cWhite = hex(PAL.white);
    private _cBlack = hex(PAL.black);
    private _cFlash = hex(PAL.flash, 90);
    private _cPedestal = hex(PAL.pedestal);
    private _cCoin = hex(PAL.coin);
    private _cAim = hex(PAL.white, 140);
    private _cAimTarget = hex(PAL.aimTarget, 180);
    private _cFrost = hex(PAL.frost);
    /** 四层 Boss 各自的副色（无贴图，靠颜色+王冠区分） */
    private _cBoss: Record<string, Color> = {
        moldking: hex(BOSS_TINT.moldking),
        stitchbear: hex(BOSS_TINT.stitchbear),
        bluescreen: hex(BOSS_TINT.bluescreen),
        compressor: hex(BOSS_TINT.compressor),
    };

    onLoad(): void {
        if (!this.entityGfx) {
            const node = new Node('EntityFx');
            node.layer = this.node.layer;
            const ut = node.addComponent(UITransform);
            ut.setContentSize(FIELD_W, FIELD_H);
            node.setPosition(0, 0, 0);
            this.node.addChild(node);
            this.entityGfx = node.addComponent(Graphics);
        }
        this._g = this.entityGfx;
        this._applyPalette(1);
    }

    private _applyPalette(floor: number): void {
        const p = FLOOR_PALETTES[floor] || FLOOR_PALETTES[1];
        this._cBg.fromHEX(p.bg);
        this._cFloor.fromHEX(p.floor);
        this._cGrid.fromHEX(p.wall);
        this._cWall.fromHEX(p.wall);
        this._cDoor.fromHEX(p.door);
        this._cAccent.fromHEX(p.accent);
    }

    setFloor(floor: number): void {
        this._applyPalette(floor);
    }

    /** 调色板（M4 纯装饰解锁）：0 = 默认奶油色 */
    setPlayerPalette(index: number): void {
        const p = PLAYER_PALETTES[index] || PLAYER_PALETTES[0];
        this._cPlayer.fromHEX(p.player);
        this._cPlayerDark.fromHEX(p.dark);
    }

    /** 安全赋色：复制到暂存色再改 alpha，不污染缓存 */
    private _fill(g: Graphics, c: Color, a = 255): void {
        this._tmpColor.set(c);
        this._tmpColor.a = a;
        g.fillColor = this._tmpColor;
    }

    private _stroke(g: Graphics, c: Color, a = 255): void {
        this._tmpColor.set(c);
        this._tmpColor.a = a;
        g.strokeColor = this._tmpColor;
    }

    pushEvents(events: CoreEvent[]): void {
        for (const ev of events) {
            if (ev.type === 'hit') {
                this._fx.push({ kind: 'spark', x: ev.x, y: ev.y, r: 10, t: 0, life: 0.14, color: this._cWhite });
            } else if (ev.type === 'kill') {
                this._fx.push({ kind: 'ring', x: ev.x, y: ev.y, r: 10, t: 0, life: 0.34, color: this._cAccent });
            } else if (ev.type === 'playerHit') {
                this._flash = 0.22;
                this._fx.push({ kind: 'ring', x: ev.x, y: ev.y, r: 16, t: 0, life: 0.3, color: this._cFlash });
            } else if (ev.type === 'boom') {
                // 爆炸 / 连锁 / 蒸汽爆发：按事件半径给一圈扩散环
                this._fx.push({ kind: 'ring', x: ev.x, y: ev.y, r: ev.r * 0.55, t: 0, life: 0.24, color: this._cCanRed });
            } else if (ev.type === 'bomb' && ev.r > 0) {
                this._fx.push({ kind: 'ring', x: ev.x, y: ev.y, r: ev.r * 0.5, t: 0, life: 0.32, color: this._cCanRed });
            } else if (ev.type === 'secret') {
                // 秘密房炸开：点亮一盏金圈
                this._fx.push({ kind: 'ring', x: 0, y: FIELD_H / 2 - WALL / 2, r: 30, t: 0, life: 0.6, color: this._cCoin });
            } else if (ev.type === 'room') {
                this._fade = 0.18;
            }
        }
    }

    resetFx(): void {
        this._fx.length = 0;
        this._flash = 0;
        this._fade = 0;
    }

    render(snap: FridgeSnapshot, dt: number): void {
        const g = this._g;
        if (!g) return;
        const t0 = performance.now();
        g.clear();

        this._drawFloor(g);
        this._drawWalls(g, snap);
        this._drawStairs(g, snap);
        this._drawSecretHints(g, snap);
        this._drawIceFields(g, snap);
        this._drawPickups(g, snap.pickups);
        this._drawBomb(g, snap);
        this._drawEnemies(g, snap.enemies);
        this._drawBullets(g, snap);
        this._drawPlayer(g, snap);
        this._drawAim(g, snap);
        this._drawFx(g, dt);
        if (this._flash > 0) {
            this._flash = Math.max(0, this._flash - dt);
            g.fillColor = this._cFlash;
            g.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H);
            g.fill();
        }
        if (this._fade > 0) {
            this._fade = Math.max(0, this._fade - dt);
            this._fill(g, this._cBlack, Math.round(200 * (this._fade / 0.18)));
            g.rect(-FIELD_W / 2 - WALL, -FIELD_H / 2 - WALL, FIELD_W + WALL * 2, FIELD_H + WALL * 2);
            g.fill();
        }
        this.lastRenderMs = performance.now() - t0;
    }

    // ==================== 场景 ====================

    /** 冻土协同的冰面：按剩余时间淡出 */
    private _drawIceFields(g: Graphics, snap: FridgeSnapshot): void {
        const fields = snap.iceFields;
        if (!fields || fields.length === 0) return;
        for (const f of fields) {
            const a = Math.max(0, Math.min(1, f.t / 2));
            this._fill(g, this._cFrost, Math.round(70 * a));
            g.circle(f.x, f.y, f.r);
            g.fill();
        }
    }

    /** 传送口（M4）：Boss 层选完核心后出现，踩上去进下一层 */
    private _drawStairs(g: Graphics, snap: FridgeSnapshot): void {
        const s = snap.stairs;
        if (!s) return;
        this._fill(g, this._cAccent, 55);
        g.circle(s.x, s.y, 34);
        g.fill();
        this._fill(g, this._cWhite, 40);
        g.circle(s.x, s.y, 26);
        g.fill();
        // 向上的三级台阶
        g.fillColor = this._cBlack;
        g.rect(s.x - 20, s.y - 14, 40, 7);
        g.rect(s.x - 13, s.y - 2, 26, 7);
        g.rect(s.x - 6, s.y + 10, 12, 7);
        g.fill();
        g.fillColor = this._cAccent;
        g.rect(s.x - 20, s.y - 16, 40, 2);
        g.rect(s.x - 13, s.y - 4, 26, 2);
        g.rect(s.x - 6, s.y + 8, 12, 2);
        g.fill();
    }

    private _drawFloor(g: Graphics): void {        g.fillColor = this._cBg;
        g.rect(-FIELD_W / 2 - WALL, -FIELD_H / 2 - WALL, FIELD_W + WALL * 2, FIELD_H + WALL * 2);
        g.fill();

        g.fillColor = this._cFloor;
        g.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H);
        g.fill();

        // 网格：细线用矩形填充（不用 stroke）
        this._fill(g, this._cGrid, 34);
        for (let c = 1; c < COLS; c++) {
            const x = -FIELD_W / 2 + c * TILE;
            g.rect(x - 0.5, -FIELD_H / 2, 1, FIELD_H);
        }
        for (let r = 1; r < ROWS; r++) {
            const y = -FIELD_H / 2 + r * TILE;
            g.rect(-FIELD_W / 2, y - 0.5, FIELD_W, 1);
        }
        g.fill();
    }

    private _drawWalls(g: Graphics, snap: FridgeSnapshot): void {
        g.fillColor = this._cWall;
        // 上 / 下
        g.rect(-FIELD_W / 2, FIELD_H / 2 - WALL, FIELD_W, WALL);
        g.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, WALL);
        // 左 / 右
        g.rect(-FIELD_W / 2, -FIELD_H / 2, WALL, FIELD_H);
        g.rect(FIELD_W / 2 - WALL, -FIELD_H / 2, WALL, FIELD_H);
        g.fill();

        // 沙盒模式（M1 自检房）：四面常开门洞
        if (!snap.map) {
            g.fillColor = this._cDoor;
            g.rect(-DOOR_HALF, FIELD_H / 2 - WALL, DOOR_HALF * 2, WALL);
            g.rect(-DOOR_HALF, -FIELD_H / 2, DOOR_HALF * 2, WALL);
            g.rect(-FIELD_W / 2, -DOOR_HALF, WALL, DOOR_HALF * 2);
            g.rect(FIELD_W / 2 - WALL, -DOOR_HALF, WALL, DOOR_HALF * 2);
            g.fill();
            this._fill(g, this._cAccent, 120);
            g.rect(-DOOR_HALF, FIELD_H / 2 - WALL - 2, DOOR_HALF * 2, 2);
            g.rect(-DOOR_HALF, -FIELD_H / 2 + WALL, DOOR_HALF * 2, 2);
            g.rect(-FIELD_W / 2 + WALL, -DOOR_HALF, 2, DOOR_HALF * 2);
            g.rect(FIELD_W / 2 - WALL - 2, -DOOR_HALF, 2, DOOR_HALF * 2);
            g.fill();
            return;
        }

        // 地牢模式：只画这张图上真实存在的门；未清房时门显示为墙 + 锁条
        const locked = snap.locked;
        const doorColor = locked ? this._cWall : this._cDoor;
        for (const dir of snap.doors) {
            g.fillColor = doorColor;
            if (dir === 'up') g.rect(-DOOR_HALF, FIELD_H / 2 - WALL, DOOR_HALF * 2, WALL);
            else if (dir === 'down') g.rect(-DOOR_HALF, -FIELD_H / 2, DOOR_HALF * 2, WALL);
            else if (dir === 'left') g.rect(-FIELD_W / 2, -DOOR_HALF, WALL, DOOR_HALF * 2);
            else g.rect(FIELD_W / 2 - WALL, -DOOR_HALF, WALL, DOOR_HALF * 2);
            g.fill();
        }

        if (locked) {
            // 锁条：门洞中央两道横杠
            this._fill(g, this._cCanRed, 230);
            for (const dir of snap.doors) {
                if (dir === 'up') g.rect(-24, FIELD_H / 2 - WALL + 8, 48, 8);
                else if (dir === 'down') g.rect(-24, -FIELD_H / 2 + 8, 48, 8);
                else if (dir === 'left') g.rect(-FIELD_W / 2 + 8, -24, 8, 48);
                else g.rect(FIELD_W / 2 - WALL + 8, -24, 8, 48);
            }
            g.fill();
        } else {
            // 可通行提示线
            this._fill(g, this._cAccent, 140);
            for (const dir of snap.doors) {
                if (dir === 'up') g.rect(-DOOR_HALF, FIELD_H / 2 - WALL - 2, DOOR_HALF * 2, 2);
                else if (dir === 'down') g.rect(-DOOR_HALF, -FIELD_H / 2 + WALL, DOOR_HALF * 2, 2);
                else if (dir === 'left') g.rect(-FIELD_W / 2 + WALL, -DOOR_HALF, 2, DOOR_HALF * 2);
                else g.rect(FIELD_W / 2 - WALL - 2, -DOOR_HALF, 2, DOOR_HALF * 2);
            }
            g.fill();
        }
    }

    /** 幸运够高时，秘密房方向的墙上出现极淡裂纹（越高越明显，规格 §6.4） */
    private _drawSecretHints(g: Graphics, snap: FridgeSnapshot): void {
        const hints = snap.secretHints;
        if (!hints || hints.length === 0) return;
        for (const hint of hints) {
            const a = Math.round(50 + 120 * hint.strength);
            this._fill(g, this._cWhite, a);
            if (hint.dir === 'up') {
                g.rect(-10, FIELD_H / 2 - WALL - 1, 3, WALL * 0.7 + 1);
                g.rect(6, FIELD_H / 2 - WALL - 8, 2, 12);
            } else if (hint.dir === 'down') {
                g.rect(-10, -FIELD_H / 2 + 1, 3, WALL * 0.7);
                g.rect(6, -FIELD_H / 2 + WALL - 4, 2, 12);
            } else if (hint.dir === 'left') {
                g.rect(-FIELD_W / 2 + 1, -10, WALL * 0.7, 3);
                g.rect(-FIELD_W / 2 + WALL - 4, 6, 12, 2);
            } else {
                g.rect(FIELD_W / 2 - WALL - 1, -10, WALL * 0.7 + 1, 3);
                g.rect(FIELD_W / 2 - WALL - 8, 6, 12, 2);
            }
            g.fill();
        }
    }

    /** 已放置的炸弹：红圈警示 + 闪烁的引信 */
    private _drawBomb(g: Graphics, snap: FridgeSnapshot): void {
        const b = snap.bomb;
        if (!b) return;
        const k = Math.max(0, Math.min(1, b.t / BOMB_FUSE));
        const pulse = 0.5 + 0.5 * Math.sin((1 - k) * 24);
        this._fill(g, this._cCanRed, Math.round(40 + 60 * pulse));
        g.circle(b.x, b.y, BOMB_RADIUS * (0.4 + 0.6 * (1 - k)));
        g.fill();
        g.fillColor = this._cBlack;
        g.circle(b.x, b.y, 11);
        g.fill();
        this._fill(g, this._cCoin, Math.round(140 + 115 * pulse));
        g.circle(b.x + 4, b.y + 14, 3 + 2 * pulse);
        g.fill();
    }

    // ==================== 实体 ====================

    private _drawPickups(g: Graphics, pickups: Pickup[]): void {
        for (const it of pickups) {
            const bob = Math.sin(it.bob * 3) * 3;
            if (it.kind === 'item') {
                g.fillColor = this._cPedestal;
                g.circle(it.x, it.y + bob, 13);
                g.fill();
                g.fillColor = this._cBlack;
                g.circle(it.x, it.y + bob, 6);
                g.fill();
                g.fillColor = this._cCanRed;
                g.circle(it.x, it.y + bob, 4);
                g.fill();
            } else if (it.kind === 'coin') {
                g.fillColor = this._cCoin;
                g.circle(it.x, it.y + bob, 5);
                g.fill();
            } else if (it.kind === 'heart') {
                // 半心：两圆 + 三角
                g.fillColor = this._cCanRed;
                g.circle(it.x - 5, it.y + bob + 3, 5.5);
                g.circle(it.x + 5, it.y + bob + 3, 5.5);
                g.fill();
                g.moveTo(it.x - 10, it.y + bob + 2);
                g.lineTo(it.x + 10, it.y + bob + 2);
                g.lineTo(it.x, it.y + bob - 10);
                g.close();
                g.fill();
            } else if (it.kind === 'bomb') {
                g.fillColor = this._cBlack;
                g.circle(it.x, it.y + bob, 8);
                g.fill();
                g.fillColor = this._cEnemyBullet;
                g.rect(it.x - 1, it.y + bob + 7, 2, 5);
                g.fill();
                g.fillColor = this._cCoin;
                g.circle(it.x + 3, it.y + bob + 12, 2.5);
                g.fill();
            }
        }
    }

    private _drawEnemies(g: Graphics, enemies: Enemy[]): void {
        for (const e of enemies) {
            if (e.hp <= 0) continue;
            const flash = e.hitFlash > 0;
            if (e.kind === 'canman') {
                g.fillColor = flash ? this._cWhite : this._cCan;
                g.rect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
                g.fill();
                g.fillColor = this._cCanRed;
                g.rect(e.x - e.r + 4, e.y - 2, e.r * 2 - 8, 5);
                g.fill();
            } else if (isBossKind(e.kind)) {
                // Boss：大圆 + 王冠 + 二阶段光晕（颜色区分四层）
                const tint = this._cBoss[e.kind] || this._cEnemyDark;
                if (e.gen >= 2) {
                    this._fill(g, this._cCanRed, 70);
                    g.circle(e.x, e.y, e.r + 10);
                    g.fill();
                }
                g.fillColor = flash ? this._cWhite : tint;
                g.circle(e.x, e.y, e.r);
                g.fill();
                g.fillColor = flash ? this._cWhite : this._cEnemy;
                g.circle(e.x, e.y - 2, e.r * 0.8);
                g.fill();
                // 王冠（三尖）
                g.fillColor = this._cCoin;
                g.moveTo(e.x - e.r * 0.7, e.y + e.r * 0.55);
                g.lineTo(e.x - e.r * 0.7, e.y + e.r * 1.15);
                g.lineTo(e.x - e.r * 0.2, e.y + e.r * 0.8);
                g.lineTo(e.x + e.r * 0.2, e.y + e.r * 1.15);
                g.lineTo(e.x + e.r * 0.7, e.y + e.r * 0.8);
                g.lineTo(e.x + e.r * 0.7, e.y + e.r * 0.55);
                g.close();
                g.fill();
                // 眼睛
                g.fillColor = this._cBlack;
                g.circle(e.x - 9, e.y + 4, 4);
                g.circle(e.x + 9, e.y + 4, 4);
                g.fill();
                // 冲刺前摇：红色预警环
                if (e.windup > 0) {
                    this._fill(g, this._cCanRed, 160);
                    g.circle(e.x, e.y, e.r + 14);
                    g.fill();
                }
            } else {
                g.fillColor = flash ? this._cWhite : this._cEnemy;
                g.circle(e.x, e.y, e.r);
                g.fill();
                g.fillColor = this._cEnemyDark;
                g.circle(e.x - e.r * 0.3, e.y - e.r * 0.3, e.r * 0.55);
                g.fill();
            }
            // 元素状态：冻结 / 燃烧 / 中毒（只画最优先的一种，避免糊成一团）
            if (e.freezeT > 0) {
                this._fill(g, this._cFrost, 110);
                g.circle(e.x, e.y, e.r + 3);
                g.fill();
            } else if (e.burnT > 0) {
                this._fill(g, this._cCanRed, 90);
                g.circle(e.x, e.y, e.r + 3);
                g.fill();
            } else if (e.poisonT > 0) {
                this._fill(g, this._cEnemy, 90);
                g.circle(e.x, e.y, e.r + 3);
                g.fill();
            }
            // 血条（受伤后才显示）
            if (e.hp < e.maxHp) {
                const w = e.r * 2;
                g.fillColor = this._cBlack;
                g.rect(e.x - w / 2, e.y + e.r + 4, w, 3);
                g.fill();
                g.fillColor = this._cCanRed;
                g.rect(e.x - w / 2, e.y + e.r + 4, w * (e.hp / e.maxHp), 3);
                g.fill();
            }
        }
    }

    private _drawBullets(g: Graphics, snap: FridgeSnapshot): void {
        for (const b of snap.bullets) {
            if (b.owner === 'player') {
                g.fillColor = this._cTear;
                g.circle(b.x, b.y, b.r);
                g.fill();
                g.fillColor = this._cWhite;
                g.circle(b.x - 3, b.y + 3, b.r * 0.35);
                g.fill();
            } else {
                g.fillColor = this._cEnemyBullet;
                g.circle(b.x, b.y, b.r);
                g.fill();
                g.fillColor = this._cWhite;
                g.circle(b.x, b.y, b.r * 0.35);
                g.fill();
            }
        }
    }

    private _drawPlayer(g: Graphics, snap: FridgeSnapshot): void {
        const p = snap.player;
        const blink = p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0;
        if (blink) return;

        // 影子
        this._fill(g, this._cBlack, 60);
        g.ellipse(p.x, p.y - 16, 22, 8);
        g.fill();

        // 布丁身体
        g.fillColor = this._cPlayerDark;
        g.circle(p.x, p.y - 2, 16);
        g.fill();
        g.fillColor = this._cPlayer;
        g.circle(p.x, p.y + 1, 14);
        g.fill();

        // 眼睛（朝向）
        const fx = p.facingX;
        const fy = p.facingY;
        g.fillColor = this._cEye;
        g.circle(p.x - 5 + fx * 4, p.y + 5 + fy * 3, 2.6);
        g.circle(p.x + 5 + fx * 4, p.y + 5 + fy * 3, 2.6);
        g.fill();

        // 护盾
        if (p.shield > 0) {
            this._fill(g, this._cFrost, 90);
            g.circle(p.x, p.y, 22);
            g.fill();
        }
    }

    private _drawAim(g: Graphics, snap: FridgeSnapshot): void {
        const p = snap.player;
        if (snap.aimTargetId >= 0) {
            for (const e of snap.enemies) {
                if (e.id !== snap.aimTargetId) continue;
                this._fill(g, this._cAimTarget, 150);
                g.circle(e.x, e.y, e.r + 5);
                g.fill();
                break;
            }
        }
        // 朝向短准星
        const ax = snap.aimX;
        const ay = snap.aimY;
        if (ax === 0 && ay === 0) return;
        this._fill(g, this._cAim, 120);
        const len = 26;
        const w = 3;
        g.rect(p.x + ax * 20 - w / 2, p.y + ay * 20 - w / 2, w, w);
        g.fill();
        g.rect(p.x + ax * 60 - 1, p.y + ay * 60 - 1, 2, 2);
        g.fill();
        void len;
    }

    private _drawFx(g: Graphics, dt: number): void {
        const out: Fx[] = [];
        for (const f of this._fx) {
            f.t += dt;
            if (f.t >= f.life) continue;
            const k = f.t / f.life;
            if (f.kind === 'ring') {
                g.lineWidth = 3;
                this._stroke(g, f.color, Math.round(200 * (1 - k)));
                g.circle(f.x, f.y, f.r + 26 * k);
                g.stroke();
            } else {
                this._fill(g, f.color, Math.round(230 * (1 - k)));
                const r = 3 + 5 * (1 - k);
                g.circle(f.x, f.y, r);
                g.fill();
            }
            out.push(f);
        }
        this._fx = out;
    }
}
