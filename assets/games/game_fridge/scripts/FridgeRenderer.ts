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
import {
    ARENA_MAX_X, ARENA_MAX_Y, ARENA_MIN_X, ARENA_MIN_Y,
    COLS, FIELD_H, FIELD_W, FLOOR_PALETTES, ROWS, TILE, DOOR_HALF, WALL,
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
    private _cPlayer = new Color(255, 233, 153, 255);
    private _cPlayerDark = new Color(214, 168, 66, 255);
    private _cEye = new Color(30, 24, 16, 255);
    private _cTear = new Color(180, 236, 255, 255);
    private _cEnemy = new Color(158, 196, 120, 255);
    private _cEnemyDark = new Color(96, 128, 72, 255);
    private _cCan = new Color(200, 200, 210, 255);
    private _cCanRed = new Color(226, 88, 84, 255);
    private _cEnemyBullet = new Color(255, 122, 138, 255);
    private _cWhite = new Color(255, 255, 255, 255);
    private _cBlack = new Color(0, 0, 0, 255);
    private _cFlash = new Color(255, 90, 90, 90);
    private _cPedestal = new Color(242, 193, 78, 255);
    private _cCoin = new Color(255, 214, 92, 255);
    private _cAim = new Color(255, 255, 255, 140);
    private _cAimTarget = new Color(255, 120, 120, 180);
    private _cFrost = new Color(159, 232, 255, 255);

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

    private _applyPalette(floor: number): void {        const p = FLOOR_PALETTES[floor] || FLOOR_PALETTES[1];
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
        this._drawPickups(g, snap.pickups);
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

    private _drawFloor(g: Graphics): void {
        g.fillColor = this._cBg;
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
            } else if (e.kind === 'moldking') {
                // Boss：大霉球 + 王冠 + 二阶段光晕
                if (e.gen >= 2) {
                    this._fill(g, this._cCanRed, 70);
                    g.circle(e.x, e.y, e.r + 10);
                    g.fill();
                }
                g.fillColor = flash ? this._cWhite : this._cEnemyDark;
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
                g.circle(f.x, f.y, 10 + 26 * k);
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
