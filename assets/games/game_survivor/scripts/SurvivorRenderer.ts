/**
 * 午夜幸存者 — 渲染层。
 *
 * 规格 §4.5：所有敌人 / 子弹 / 宝石画在 **1 个 Graphics** 上，每帧 `clear()` 后按层重画；
 * 玩家单独一个 Node + Graphics（方便旋转、拖尾与缩放反馈）。背景网格只画一次。
 *
 * 约定：
 *  - 本文件**只读快照**，不修改任何核心状态（规格 §6.2）
 *  - 细线一律 `rect()+fill()`，不依赖 `stroke()`（踩坑手册 §4.5）；只有精英 / Boss 才描白边
 *  - 每帧不 new 对象：颜色在 `onLoad()` 里解析好缓存
 *  - 浮动文字（合并击杀数）用池化 Label，不用 Graphics 现画字形
 */

import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from 'cc';
import { ARENA_HALF, COLORS, SurvivorSnapshot } from './SurvivorConfig';
import type { BulletState, CoreEvent, EnemyState, GemState } from './SurvivorConfig';

const { ccclass, property } = _decorator;

/** 背景网格间距（设计像素） */
const GRID_STEP = 160;
/** 宝石菱形半径 */
const GEM_R = 7;
/** 精英描边宽度 */
const ELITE_STROKE = 2.5;
/** 玩家拖尾采样点数 */
const TRAIL_LEN = 14;
/** 浮动文字池大小 */
const FLOAT_POOL = 6;

interface FxItem {
    kind: 'ring' | 'burst';
    x: number;
    y: number;
    r: number;
    t: number;
    life: number;
    color: Color;
}

interface FloatText {
    label: Label;
    t: number;
    life: number;
    x: number;
    y: number;
}

interface TrailPoint {
    x: number;
    y: number;
}

@ccclass('SurvivorRenderer')
export class SurvivorRenderer extends Component {
    @property({ type: Graphics, tooltip: '世界层：宝石 / 敌人 / 子弹（每帧重画）' })
    entityGfx: Graphics | null = null;

    @property({ type: Graphics, tooltip: '背景网格（只画一次）' })
    bgGfx: Graphics | null = null;

    @property({ type: Graphics, tooltip: '玩家（独立节点，便于旋转 / 缩放）' })
    playerGfx: Graphics | null = null;

    /** 每帧渲染耗时（毫秒），Gate B 读数用 */
    lastRenderMs = 0;

    private _cBg = new Color();
    private _cGrid = new Color();
    private _cPlayer = new Color();
    private _cChaser = new Color();
    private _cWeaver = new Color();
    private _cShooter = new Color();
    private _cBomber = new Color();
    private _cBomberWarn = new Color();
    private _cBoss = new Color();
    private _cGem = new Color();
    private _cFx = new Color();
    private _cWhite = new Color(255, 255, 255, 255);
    private _cBarBack = new Color(0, 0, 0, 160);
    private _cElite = new Color();
    private _cDark = new Color(0, 0, 0, 0);
    private _bgDrawn = false;

    private _fx: FxItem[] = [];
    private _floats: FloatText[] = [];
    private _floatNode: Node | null = null;
    private _trail: TrailPoint[] = [];
    private _lastKills = 0;
    private _hitFlash = 0;

    onLoad(): void {
        this._cBg.fromHEX(COLORS.bg);
        this._cGrid.fromHEX(COLORS.grid);
        this._cPlayer.fromHEX(COLORS.player);
        this._cChaser.fromHEX(COLORS.chaser);
        this._cWeaver.fromHEX(COLORS.weaver);
        this._cShooter.fromHEX(COLORS.shooter);
        this._cBomber.fromHEX(COLORS.bomber);
        this._cBomberWarn.fromHEX(COLORS.bomberWarn);
        this._cBoss.fromHEX(COLORS.boss);
        this._cGem.fromHEX(COLORS.gem);
        this._cFx.fromHEX(COLORS.fx);
        this._cElite.fromHEX(COLORS.shooter);
        this._ensureFloatPool();
    }

    onDestroy(): void {
        this._fx = [];
        this._floats = [];
        this._floatNode = null;
        this._trail = [];
    }

    /** 新开一局时清掉上一局残留的表现状态 */
    resetFx(): void {
        this._fx.length = 0;
        this._trail.length = 0;
        this._lastKills = 0;
        this._hitFlash = 0;
        for (const f of this._floats) {
            f.t = f.life;
            if (f.label && f.label.node && f.label.node.isValid) f.label.node.active = false;
        }
    }

    // ==================== 背景（只画一次） ====================

    /** 背景只在场景就绪后画一次（随 World 节点一起移动） */
    drawBackground(): void {
        const g = this.bgGfx;
        if (!g || this._bgDrawn) return;
        this._bgDrawn = true;
        g.clear();

        // 场地底色
        g.fillColor = this._cBg;
        g.rect(-ARENA_HALF, -ARENA_HALF, ARENA_HALF * 2, ARENA_HALF * 2);
        g.fill();

        // 网格：细线用 rect()+fill()，不用 stroke()
        g.fillColor = this._cGrid;
        const w = 1.5;
        for (let x = -ARENA_HALF; x <= ARENA_HALF; x += GRID_STEP) {
            g.rect(x - w / 2, -ARENA_HALF, w, ARENA_HALF * 2);
        }
        for (let y = -ARENA_HALF; y <= ARENA_HALF; y += GRID_STEP) {
            g.rect(-ARENA_HALF, y - w / 2, ARENA_HALF * 2, w);
        }
        g.fill();

        // 星点：固定种子的伪随机，静态不滚动（V3：有质感但不抢注意力）
        g.fillColor = this._cFx;
        let seed = 20261108;
        const rand = (): number => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };
        for (let i = 0; i < 90; i++) {
            const x = -ARENA_HALF + rand() * ARENA_HALF * 2;
            const y = -ARENA_HALF + rand() * ARENA_HALF * 2;
            const s = 1 + rand() * 1.6;
            g.rect(x - s / 2, y - s / 2, s, s);
        }
        g.fill();

        // 暗角：从四边向内叠 6 层半透明黑，代替渐变（Graphics 没有渐变）
        const bandW = 130;
        for (let i = 0; i < 6; i++) {
            const inset = i * (bandW / 6);
            const alpha = 26 - i * 4;
            if (alpha <= 0) break;
            g.fillColor = new Color(0, 0, 0, alpha);
            const t = bandW / 6;
            g.rect(-ARENA_HALF + inset, ARENA_HALF - inset - t, ARENA_HALF * 2 - inset * 2, t);
            g.rect(-ARENA_HALF + inset, -ARENA_HALF + inset, ARENA_HALF * 2 - inset * 2, t);
            g.rect(-ARENA_HALF + inset, -ARENA_HALF + inset, t, ARENA_HALF * 2 - inset * 2);
            g.rect(ARENA_HALF - inset - t, -ARENA_HALF + inset, t, ARENA_HALF * 2 - inset * 2);
        }
        g.fill();

        // 边界：亮边 + 四角 L 形加粗，走出可视区一眼可见
        g.fillColor = this._cFx;
        const edge = 3;
        g.rect(-ARENA_HALF, ARENA_HALF - edge, ARENA_HALF * 2, edge);
        g.rect(-ARENA_HALF, -ARENA_HALF, ARENA_HALF * 2, edge);
        g.rect(-ARENA_HALF, -ARENA_HALF, edge, ARENA_HALF * 2);
        g.rect(ARENA_HALF - edge, -ARENA_HALF, edge, ARENA_HALF * 2);
        g.fill();

        const corner = 90;
        const thick = 8;
        g.fillColor = this._cPlayer;
        g.rect(-ARENA_HALF, ARENA_HALF - thick, corner, thick);
        g.rect(-ARENA_HALF, ARENA_HALF - corner, thick, corner);
        g.rect(ARENA_HALF - corner, ARENA_HALF - thick, corner, thick);
        g.rect(ARENA_HALF - thick, ARENA_HALF - corner, thick, corner);
        g.rect(-ARENA_HALF, -ARENA_HALF, corner, thick);
        g.rect(-ARENA_HALF, -ARENA_HALF, thick, corner);
        g.rect(ARENA_HALF - corner, -ARENA_HALF, corner, thick);
        g.rect(ARENA_HALF - thick, -ARENA_HALF, thick, corner);
        g.fill();
    }

    // ==================== 事件（一次性特效） ====================

    /** SurvivorGame 每帧把核心事件转过来；只取表现层关心的类型 */
    pushEvents(events: readonly CoreEvent[]): void {
        for (const ev of events) {
            if (ev.type === 'pickup') {
                this._spawnRing(this._playerX, this._playerY, 26, 0.35, this._cGem);
            } else if (ev.type === 'hit') {
                this._hitFlash = 1;
                this._spawnRing(this._playerX, this._playerY, 30, 0.3, this._cBomberWarn);
            } else if (ev.type === 'lightning' && ev.x !== undefined && ev.y !== undefined) {
                this._spawnRing(ev.x, ev.y, ev.r || 52, 0.3, this._cPlayer);
            } else if (ev.type === 'explode' && ev.x !== undefined && ev.y !== undefined) {
                this._spawnRing(ev.x, ev.y, ev.r || 64, 0.4, this._cBomberWarn);
            }
        }
    }

    private _playerX = 0;
    private _playerY = 0;

    private _spawnRing(x: number, y: number, r: number, life: number, color: Color): void {
        if (this._fx.length > 48) this._fx.shift();
        this._fx.push({ kind: 'ring', x, y, r, t: 0, life, color });
    }

    // ==================== 每帧 ====================

    /** 每帧：清空 + 依次画 宝石 → 敌人 → Boss → 子弹 → 特效 → 玩家 */
    render(snap: SurvivorSnapshot, dt = 1 / 60): void {
        const g = this.entityGfx;
        if (!g) return;
        this._playerX = snap.player.x;
        this._playerY = snap.player.y;
        g.clear();

        const gems = snap.gems;
        for (let i = 0; i < gems.length; i++) {
            const gem = gems[i];
            if (gem.active) this._drawGem(g, gem, snap.player.x, snap.player.y);
        }

        const enemies = snap.enemies;
        const px = snap.player.x;
        const py = snap.player.y;
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (e.active) this._drawEnemy(g, e, px, py);
        }
        const boss = snap.boss;
        if (boss && boss.active) this._drawBoss(g, boss);

        const bullets = snap.bullets;
        for (let i = 0; i < bullets.length; i++) {
            const b = bullets[i];
            if (b.active) this._drawBullet(g, b);
        }

        this._drawFx(g, dt);
        this._updateFloats(dt, snap);
        this._drawPlayer(snap, dt);
    }

    // ==================== 图元 ====================

    private _drawGem(g: Graphics, gem: GemState, px: number, py: number): void {
        const r = gem.value >= 2 ? GEM_R * 1.25 : GEM_R;
        // 吸附中的宝石拉一条朝玩家的细线，让"吸过来"看得见
        if (gem.magnet) {
            const dx = px - gem.x;
            const dy = py - gem.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            this._cGem.a = 90;
            g.fillColor = this._cGem;
            const tail = Math.min(34, len);
            g.moveTo(gem.x - ux * tail, gem.y - uy * tail);
            g.lineTo(gem.x - ux * tail + -uy * 2.4, gem.y - uy * tail + ux * 2.4);
            g.lineTo(gem.x - ux * tail + uy * 2.4, gem.y - uy * tail - ux * 2.4);
            g.close();
            g.fill();
            this._cGem.a = 255;
        }
        g.fillColor = this._cGem;
        g.moveTo(gem.x, gem.y + r);
        g.lineTo(gem.x + r, gem.y);
        g.lineTo(gem.x, gem.y - r);
        g.lineTo(gem.x - r, gem.y);
        g.close();
        g.fill();
    }

    private _enemyColor(e: EnemyState): Color {
        if (e.flash > 0) return this._cWhite;
        switch (e.kind) {
            case 'chaser':
                return this._cChaser;
            case 'weaver':
                return this._cWeaver;
            case 'shooter':
                return this._cShooter;
            case 'bomber':
                return this._cBomber;
            default:
                return this._cBoss;
        }
    }

    /** 小怪统一用圆剪影（V1），兵种差异靠内部记号与配色，远处的怪不再是一片三角/方块 */
    private _drawEnemy(g: Graphics, e: EnemyState, px: number, py: number): void {
        const r = e.radius;
        g.fillColor = this._enemyColor(e);
        g.circle(e.x, e.y, r);
        g.fill();

        const flash = e.flash > 0;
        if (!flash) {
            const a = Math.atan2(py - e.y, px - e.x);
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            switch (e.kind) {
                case 'chaser': {
                    // 内部暗色箭头，指向玩家
                    g.fillColor = this._cBg;
                    g.moveTo(e.x + ca * r * 0.7, e.y + sa * r * 0.7);
                    g.lineTo(e.x - ca * r * 0.35 - sa * r * 0.45, e.y - sa * r * 0.35 + ca * r * 0.45);
                    g.lineTo(e.x - ca * r * 0.35 + sa * r * 0.45, e.y - sa * r * 0.35 - ca * r * 0.45);
                    g.close();
                    g.fill();
                    break;
                }
                case 'weaver': {
                    // 两侧小鳍：横移的视觉暗示
                    g.fillColor = this._cBg;
                    const px1 = -sa * r * 1.1;
                    const py1 = ca * r * 1.1;
                    g.circle(e.x + px1, e.y + py1, r * 0.3);
                    g.circle(e.x - px1, e.y - py1, r * 0.3);
                    g.fill();
                    break;
                }
                case 'shooter': {
                    // 十字准星
                    g.fillColor = this._cBg;
                    g.rect(e.x - r * 0.5, e.y - r * 0.12, r, r * 0.24);
                    g.rect(e.x - r * 0.12, e.y - r * 0.5, r * 0.24, r);
                    g.fill();
                    break;
                }
                default: {
                    // 自爆兵：中心引信
                    g.fillColor = this._cBomberWarn;
                    g.circle(e.x, e.y, r * 0.35);
                    g.fill();
                    break;
                }
            }
        }

        if (e.kind === 'bomber' && e.phase > 0) {
            // 引信预警：外圈闪红
            g.fillColor = this._cBomberWarn;
            g.circle(e.x, e.y, r * (1.4 + 0.25 * Math.sin(e.phase * 40)));
            g.fill();
            g.fillColor = this._cBomber;
            g.circle(e.x, e.y, r * 0.92);
            g.fill();
        }

        if (e.elite) this._drawEliteRing(g, e.x, e.y, r + 6);
    }

    /** 精英：紫色尖刺环（8 根三角刺 + 细环），一眼区别于普通小怪 */
    private _drawEliteRing(g: Graphics, x: number, y: number, r: number): void {
        g.fillColor = this._cElite;
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const base = 0.22;
            const tip = r + 9;
            g.moveTo(x + ca * tip, y + sa * tip);
            g.lineTo(x + ca * r - sa * r * base, y + sa * r + ca * r * base);
            g.lineTo(x + ca * r + sa * r * base, y + sa * r - ca * r * base);
            g.close();
        }
        g.fill();

        g.strokeColor = this._cElite;
        g.lineWidth = ELITE_STROKE;
        g.circle(x, y, r);
        g.stroke();
        g.strokeColor = this._cWhite;
        g.lineWidth = 1.2;
        g.circle(x, y, r + 2.5);
        g.stroke();
    }

    private _drawBoss(g: Graphics, boss: EnemyState): void {
        const r = boss.radius;
        const color = boss.flash > 0 ? this._cWhite : this._cBoss;

        // 外环慢转（4 颗轨道点），静态造型也能"活"
        const spin = (boss.phase || 0) * 0.6;
        g.fillColor = color;
        for (let i = 0; i < 4; i++) {
            const a = spin + (i / 4) * Math.PI * 2;
            g.circle(boss.x + Math.cos(a) * (r + 14), boss.y + Math.sin(a) * (r + 14), 5);
        }
        g.fill();

        // 外圈六边形
        g.fillColor = color;
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const x = boss.x + Math.cos(a) * r;
            const y = boss.y + Math.sin(a) * r;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
        }
        g.close();
        g.fill();

        // 中间暗环 + 亮核
        g.fillColor = this._cBg;
        g.circle(boss.x, boss.y, r * 0.62);
        g.fill();
        g.fillColor = color;
        g.circle(boss.x, boss.y, r * 0.34);
        g.fill();
        g.fillColor = this._cWhite;
        g.circle(boss.x, boss.y, r * 0.14);
        g.fill();

        // 内环描边
        g.strokeColor = this._cWhite;
        g.lineWidth = 2.5;
        g.circle(boss.x, boss.y, r * 0.78);
        g.stroke();

        // 头顶细血条（正式血条在 M3 顶栏）
        const w = r * 2.2;
        const ratio = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
        g.fillColor = this._cBarBack;
        g.rect(boss.x - w / 2, boss.y + r + 22, w, 6);
        g.fill();
        g.fillColor = this._cBoss;
        g.rect(boss.x - w / 2, boss.y + r + 22, w * ratio, 6);
        g.fill();
    }

    private _drawBullet(g: Graphics, b: BulletState): void {
        if (b.kind === 'enemy') {
            g.fillColor = this._cShooter;
            g.circle(b.x, b.y, b.radius);
            g.fill();
            g.fillColor = this._cWhite;
            g.circle(b.x, b.y, b.radius * 0.4);
            g.fill();
            return;
        }
        g.fillColor = b.kind === 'knife' ? this._cPlayer : this._cFx;
        const r = b.kind === 'knife' ? b.radius : b.radius * 1.6;
        // 细长菱形，沿速度方向
        const len = Math.hypot(b.vx, b.vy) || 1;
        const ux = b.vx / len;
        const uy = b.vy / len;
        const nx = -uy;
        const ny = ux;
        const half = r * (b.kind === 'knife' ? 2.4 : 1.4);
        g.moveTo(b.x + ux * half, b.y + uy * half);
        g.lineTo(b.x + nx * r, b.y + ny * r);
        g.lineTo(b.x - ux * half, b.y - uy * half);
        g.lineTo(b.x - nx * r, b.y - ny * r);
        g.close();
        g.fill();
    }

    // ==================== 特效 ====================

    private _drawFx(g: Graphics, dt: number): void {
        if (!this._fx.length) return;
        const keep: FxItem[] = [];
        for (const fx of this._fx) {
            fx.t += dt;
            if (fx.t >= fx.life) continue;
            keep.push(fx);
            const k = fx.t / fx.life;
            const radius = fx.r * (0.35 + 0.9 * k);
            const alpha = Math.round(190 * (1 - k));
            if (alpha <= 0) continue;
            fx.color.a = alpha;
            g.strokeColor = fx.color;
            g.lineWidth = 4 * (1 - k) + 1;
            g.circle(fx.x, fx.y, radius);
            g.stroke();
            fx.color.a = 255;
        }
        this._fx = keep;
    }

    // ==================== 浮动文字（合并击杀数） ====================

    private _ensureFloatPool(): void {
        const parent = this.entityGfx ? this.entityGfx.node : null;
        if (!parent) return;
        if (this._floatNode && this._floatNode.isValid) return;
        const node = new Node('FloatText');
        node.layer = parent.layer;
        node.addComponent(UITransform).setContentSize(10, 10);
        parent.addChild(node);
        this._floatNode = node;

        for (let i = 0; i < FLOAT_POOL; i++) {
            const label = this._makeFloatLabel(node);
            label.node.active = false;
            this._floats.push({ label, t: 0, life: 0, x: 0, y: 0 });
        }
    }

    private _makeFloatLabel(parent: Node): Label {
        const node = new Node('Float');
        node.layer = parent.layer;
        node.addComponent(UITransform).setContentSize(160, 36);
        const label = node.addComponent(Label);
        label.fontSize = 24;
        label.lineHeight = 30;
        label.isBold = true;
        label.color = this._cFx;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        parent.addChild(node);
        return label;
    }

    /** 击杀数按帧合并成一条「+N」飘字：满屏数字不如一次明确的收获 */
    private _updateFloats(dt: number, snap: SurvivorSnapshot): void {
        if (!this._floats.length) {
            this._lastKills = snap.kills;
            return;
        }

        const gained = snap.kills - this._lastKills;
        this._lastKills = snap.kills;
        if (gained > 0) {
            const f = this._floats.find((it) => it.t >= it.life);
            if (f) {
                f.t = 0;
                f.life = 0.7;
                f.x = snap.player.x + 26;
                f.y = snap.player.y + 26;
                f.label.string = `+${gained}`;
                f.label.color = this._cGem;
                f.label.node.active = true;
            }
        }

        for (const f of this._floats) {
            if (f.t >= f.life) continue;
            f.t += dt;
            if (f.t >= f.life) {
                f.label.node.active = false;
                continue;
            }
            const k = f.t / f.life;
            f.label.node.setPosition(f.x, f.y + 56 * k, 0);
            const alpha = Math.round(255 * (1 - k * k));
            const c = f.label.color;
            f.label.color = new Color(c.r, c.g, c.b, alpha);
        }
    }

    // ==================== 玩家 ====================

    private _drawPlayer(snap: SurvivorSnapshot, dt: number): void {
        const g = this.playerGfx;
        if (!g) return;
        const p = snap.player;
        // 世界根节点已按 -p 平移；玩家节点要补回自己的世界坐标，才能停在屏幕中心
        g.node.setPosition(p.x, p.y, 0);
        g.clear();

        // 拖尾：记录最近位置，按年龄淡出（HUD 之外最直接的"我在动"的反馈）
        this._trail.push({ x: p.x, y: p.y });
        if (this._trail.length > TRAIL_LEN) this._trail.shift();
        const n = this._trail.length;
        if (n >= 2) {
            for (let i = 0; i < n - 1; i++) {
                const a = this._trail[i];
                const b = this._trail[i + 1];
                const k = i / (n - 1);
                const w = 2 + 9 * k;
                this._cPlayer.a = Math.round(20 + 110 * k);
                g.fillColor = this._cPlayer;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len = Math.hypot(dx, dy) || 1;
                const nx = (-dy / len) * (w / 2);
                const ny = (dx / len) * (w / 2);
                g.moveTo(a.x + nx - p.x, a.y + ny - p.y);
                g.lineTo(b.x + nx - p.x, b.y + ny - p.y);
                g.lineTo(b.x - nx - p.x, b.y - ny - p.y);
                g.lineTo(a.x - nx - p.x, a.y - ny - p.y);
                g.close();
                g.fill();
            }
            this._cPlayer.a = 255;
        }

        // 无敌帧闪烁
        if (p.iframe > 0 && Math.floor(p.iframe * 12) % 2 === 0) return;

        // 受击红环（一次性）
        if (this._hitFlash > 0) {
            this._hitFlash = Math.max(0, this._hitFlash - dt * 4);
            this._cBomberWarn.a = Math.round(160 * this._hitFlash);
            g.fillColor = this._cBomberWarn;
            g.circle(0, 0, 20 + 8 * (1 - this._hitFlash));
            g.fill();
            this._cBomberWarn.a = 255;
        }

        // 三角本体，尖端朝向移动方向
        const a = p.facing;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        g.fillColor = this._cPlayer;
        g.moveTo(ca * 24, sa * 24);
        g.lineTo(ca * -14 - sa * 16, sa * -14 + ca * 16);
        g.lineTo(ca * -7, sa * -7);
        g.lineTo(ca * -14 + sa * 16, sa * -14 - ca * 16);
        g.close();
        g.fill();

        // 内层亮核
        g.fillColor = this._cWhite;
        g.circle(0, 0, 5);
        g.fill();
    }
}
