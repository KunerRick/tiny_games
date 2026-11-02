/**
 * 午夜幸存者 — 渲染层。
 *
 * 规格 §4.5：所有敌人 / 子弹 / 宝石画在 **1 个 Graphics** 上，每帧 `clear()` 后按层重画；
 * 玩家单独一个 Node + Graphics（方便旋转、缩放反馈）。背景网格只画一次。
 *
 * 约定：
 *  - 本文件**只读快照**，不修改任何核心状态（规格 §6.2）
 *  - 细线一律 `rect()+fill()`，不依赖 `stroke()`（踩坑手册 §4.5）；只有精英 / Boss 才描白边
 *  - 每帧不 new 对象：颜色在 `onLoad()` 里解析好缓存
 */

import { _decorator, Color, Component, Graphics } from 'cc';
import { ARENA_HALF, COLORS, SurvivorSnapshot } from './SurvivorConfig';
import type { BulletState, EnemyState, GemState } from './SurvivorConfig';

const { ccclass, property } = _decorator;

/** 背景网格间距（设计像素） */
const GRID_STEP = 160;
/** 宝石菱形半径 */
const GEM_R = 7;
/** 精英描边宽度 */
const ELITE_STROKE = 2.5;

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
    private _bgDrawn = false;

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
    }

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

        // 场地边框
        g.fillColor = this._cFx;
        const edge = 3;
        g.rect(-ARENA_HALF, ARENA_HALF - edge, ARENA_HALF * 2, edge);
        g.rect(-ARENA_HALF, -ARENA_HALF, ARENA_HALF * 2, edge);
        g.rect(-ARENA_HALF, -ARENA_HALF, edge, ARENA_HALF * 2);
        g.rect(ARENA_HALF - edge, -ARENA_HALF, edge, ARENA_HALF * 2);
        g.fill();
    }

    /** 每帧：清空 + 依次画 宝石 → 敌人 → Boss → 子弹 → 玩家 */
    render(snap: SurvivorSnapshot): void {
        const g = this.entityGfx;
        if (!g) return;
        g.clear();

        const gems = snap.gems;
        for (let i = 0; i < gems.length; i++) {
            const gem = gems[i];
            if (gem.active) this._drawGem(g, gem);
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

        this._drawPlayer(snap);
    }

    // ==================== 图元 ====================

    private _drawGem(g: Graphics, gem: GemState): void {
        g.fillColor = this._cGem;
        const r = gem.value >= 2 ? GEM_R * 1.25 : GEM_R;
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

    private _drawEnemy(g: Graphics, e: EnemyState, px: number, py: number): void {
        g.fillColor = this._enemyColor(e);
        const r = e.radius;
        switch (e.kind) {
            case 'chaser': {
                // 三角，尖端朝玩家
                const a = Math.atan2(py - e.y, px - e.x);
                const ca = Math.cos(a);
                const sa = Math.sin(a);
                g.moveTo(e.x + ca * r * 1.4, e.y + sa * r * 1.4);
                g.lineTo(e.x - ca * r * 0.75 - sa * r, e.y - sa * r * 0.75 + ca * r);
                g.lineTo(e.x - ca * r * 0.75 + sa * r, e.y - sa * r * 0.75 - ca * r);
                g.close();
                break;
            }
            case 'weaver': {
                // 菱形
                g.moveTo(e.x, e.y + r * 1.2);
                g.lineTo(e.x + r, e.y);
                g.lineTo(e.x, e.y - r * 1.2);
                g.lineTo(e.x - r, e.y);
                g.close();
                break;
            }
            case 'shooter': {
                // 方块
                g.rect(e.x - r, e.y - r, r * 2, r * 2);
                break;
            }
            default: {
                // 自爆兵：圆
                g.circle(e.x, e.y, r);
                break;
            }
        }
        g.fill();

        if (e.kind === 'shooter') {
            // 中心点
            g.fillColor = this._cBg;
            g.circle(e.x, e.y, r * 0.34);
            g.fill();
        } else if (e.kind === 'bomber' && e.phase > 0) {
            // 引信预警：外圈闪红
            g.fillColor = this._cBomberWarn;
            g.circle(e.x, e.y, r * (1.35 + 0.25 * Math.sin(e.phase * 40)));
            g.fill();
            g.fillColor = this._cBomber;
            g.circle(e.x, e.y, r * 0.9);
            g.fill();
        }

        if (e.elite) {
            g.strokeColor = this._cWhite;
            g.lineWidth = ELITE_STROKE;
            g.circle(e.x, e.y, r + 2);
            g.stroke();
        }
    }

    private _drawBoss(g: Graphics, boss: EnemyState): void {
        const r = boss.radius;
        g.fillColor = boss.flash > 0 ? this._cWhite : this._cBoss;
        // 六边形
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const x = boss.x + Math.cos(a) * r;
            const y = boss.y + Math.sin(a) * r;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
        }
        g.close();
        g.fill();

        // 内环（白）
        g.strokeColor = this._cWhite;
        g.lineWidth = 2.5;
        g.circle(boss.x, boss.y, r * 0.55);
        g.stroke();

        // 头顶细血条（正式血条在 M3 顶栏）
        const w = r * 2.2;
        const ratio = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
        g.fillColor = this._cBarBack;
        g.rect(boss.x - w / 2, boss.y + r + 10, w, 6);
        g.fill();
        g.fillColor = this._cBoss;
        g.rect(boss.x - w / 2, boss.y + r + 10, w * ratio, 6);
        g.fill();
    }

    private _drawBullet(g: Graphics, b: BulletState): void {
        if (b.kind === 'enemy') {
            g.fillColor = this._cShooter;
            g.circle(b.x, b.y, b.radius);
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

    private _drawPlayer(snap: SurvivorSnapshot): void {
        const g = this.playerGfx;
        if (!g) return;
        const p = snap.player;
        g.clear();

        // 无敌帧闪烁
        if (p.iframe > 0 && Math.floor(p.iframe * 12) % 2 === 0) return;

        g.fillColor = this._cPlayer;
        g.circle(0, 0, 14);
        g.fill();

        // 朝向楔形
        const a = p.facing;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        g.fillColor = this._cFx;
        g.moveTo(ca * 22, sa * 22);
        g.lineTo(ca * 10 - sa * 7, sa * 10 + ca * 7);
        g.lineTo(ca * 10 + sa * 7, sa * 10 - ca * 7);
        g.close();
        g.fill();

        // 中心点
        g.fillColor = this._cBg;
        g.circle(0, 0, 4);
        g.fill();
    }
}
