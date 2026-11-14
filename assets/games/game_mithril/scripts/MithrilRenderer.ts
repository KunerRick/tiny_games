/**
 * 《秘银远征》渲染层 —— 单 Graphics 每帧重绘（与 FridgeRenderer 同套路）。
 *
 * 层次：地面 → 预警圈 → 血球 → 敌人 → 子弹 → 玩家 → 特效 → 伤害数字。
 * 只读快照；所有状态变化都来自 `onEvents()`。
 *
 * 坐标：核心场 720×1280，左下原点；本节点居中于 Canvas，
 * 绘制时统一 `x-360 / y-640` 转成节点本地坐标。
 */

import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from 'cc';
import { createLabel } from '../../../common/ui/GameUIKit';
import type { CoreEvent, MithrilSnapshot } from './MithrilCore';
import { FIELD_H, FIELD_W } from './MithrilCore';
import {
    MITH_PAL,
    drawEnemyBar,
    drawGolem,
    drawImp,
    drawMiner,
    drawOrb,
    drawTroll,
    drawWarrior,
    drawWraith,
} from './MithrilArt';

const { ccclass, property } = _decorator;

interface Fx {
    kind: 'ring' | 'swing' | 'streak' | 'plus' | 'mote';
    x: number;
    y: number;
    r: number;
    angle: number;
    t: number;
    life: number;
    color: Color;
}

interface DamageNumber {
    label: Label;
    x: number;
    y: number;
    t: number;
    life: number;
    rise: number;
    /** 生成时的颜色；淡出用它 + 复用 _tmp，避免每帧给每个数字 new Color（GC 抖动） */
    base: Color;
}

const MAX_DAMAGE_NUMBERS = 18;
const FLOOR_ROCKS = [
    [70, 150, 18], [650, 220, 22], [110, 560, 26], [610, 640, 20],
    [60, 980, 24], [660, 1040, 26], [250, 1210, 18], [470, 1220, 20],
    [40, 380, 14], [690, 830, 16],
];

function cacheColor(hexColor: string): Color {
    const c = new Color();
    c.fromHEX(hexColor);
    return c;
}

@ccclass('MithrilRenderer')
export class MithrilRenderer extends Component {
    @property({ type: Graphics, tooltip: '实体层（留空则运行时自动创建）' })
    entityGfx: Graphics | null = null;

    /** 每帧渲染耗时（毫秒），探针用 */
    lastRenderMs = 0;

    private _g: Graphics | null = null;
    private _fx: Fx[] = [];
    private _numbers: DamageNumber[] = [];
    private _numberPool: Label[] = [];
    private _shake = 0;
    private _hurtFlash = 0;
    private _time = 0;
    private _tmp = new Color();

    private _cFloor = cacheColor(MITH_PAL.floor);
    private _cFloorAlt = cacheColor(MITH_PAL.floorAlt);
    private _cGrid = cacheColor(MITH_PAL.grid);
    private _cRail = cacheColor(MITH_PAL.rail);
    private _cRailTie = cacheColor(MITH_PAL.railTie);
    private _cRock = cacheColor(MITH_PAL.rock);
    private _cRockLight = cacheColor(MITH_PAL.rockLight);
    private _cHp = cacheColor(MITH_PAL.hp);
    private _cHpElite = cacheColor(MITH_PAL.hpElite);
    private _cHpBoss = cacheColor(MITH_PAL.hpBoss);
    private _cTelegraph = cacheColor(MITH_PAL.telegraph);
    private _cTelegraphBoss = cacheColor(MITH_PAL.telegraphBoss);
    private _cBoulder = cacheColor(MITH_PAL.boulder);
    private _cBolt = cacheColor(MITH_PAL.bolt);
    private _cOrb = cacheColor(MITH_PAL.orb);
    private _cGreen = cacheColor('#4ADE80');
    private _cGold = cacheColor('#FBBF24');
    private _cWhite = cacheColor(MITH_PAL.white);
    private _cRed = cacheColor('#EF4444');
    private _cPurple = cacheColor('#B44BE0');
    private _cBlue = cacheColor('#93C5FD');
    private _cHurt = cacheColor('#EF444455');

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
    }

    /** 重开一局：清掉残留特效 / 伤害数字 / 震屏 */
    resetView(): void {
        this._fx.length = 0;
        this._shake = 0;
        this._hurtFlash = 0;
        for (const n of this._numbers) {
            n.label.node.active = false;
            this._numberPool.push(n.label);
        }
        this._numbers.length = 0;
    }

    // ==================== 对外 ====================

    render(snap: MithrilSnapshot, dt: number): void {
        const g = this._g;
        if (!g) return;
        const start = Date.now();
        this._time += dt;
        this._shake = Math.max(0, this._shake - dt * 3);
        this._hurtFlash = Math.max(0, this._hurtFlash - dt * 4);

        g.clear();

        // 屏幕震动：用确定性正弦，避免 Math.random 每帧抖动不可复现
        let ox = 0;
        let oy = 0;
        if (this._shake > 0) {
            const s = this._shake * 7;
            ox = Math.sin(this._time * 97) * s;
            oy = Math.cos(this._time * 113) * s;
        }
        g.node.setPosition(ox, oy, 0);

        this._drawFloor(g);
        this._drawTelegraphs(g, snap);
        this._drawOrbs(g, snap);
        this._drawEnemies(g, snap);
        this._drawBullets(g, snap);
        this._drawPlayer(g, snap);
        this._drawFx(g, dt);
        this._drawHurtFlash(g);
        this._updateNumbers(dt);

        this.lastRenderMs = Date.now() - start;
    }

    onEvents(events: CoreEvent[]): void {
        for (const ev of events) {
            switch (ev.type) {
                case 'swing':
                    this._pushFx('swing', ev.x, ev.y, ev.radius, ev.facing, 0.18, this._cWhite);
                    break;
                case 'whirl':
                    this._pushFx('ring', ev.x, ev.y, ev.radius, 0, 0.28, this._cBlue);
                    break;
                case 'charge':
                    this._pushFx('streak', ev.x, ev.y, 46, 0, 0.22, this._cGold);
                    this._shake = Math.max(this._shake, 0.25);
                    break;
                case 'dodge':
                    this._pushFx('streak', ev.x, ev.y, 26, ev.facing, 0.18, this._cBlue);
                    break;
                case 'boom':
                    this._pushFx('ring', ev.x, ev.y, ev.radius, 0, 0.45, this._cRed);
                    this._shake = Math.max(this._shake, 0.6);
                    break;
                case 'kill':
                    this._pushFx('ring', ev.x, ev.y, 22, 0, 0.3, this._cGold);
                    break;
                case 'heal':
                    this._pushFx('plus', ev.x, ev.y, 16, 0, 0.55, this._cGreen);
                    this._addNumber(ev.x, ev.y + 12, `+${Math.round(ev.amount)}`, this._cGreen);
                    break;
                case 'regen':
                    if (ev.amount > 0.5) this._pushFx('mote', ev.x, ev.y, 30, 0, 0.6, this._cPurple);
                    break;
                case 'damage':
                    if (ev.target === 'player') {
                        this._hurtFlash = Math.max(this._hurtFlash, 0.8);
                        this._shake = Math.max(this._shake, 0.35);
                    } else {
                        this._addNumber(
                            ev.x, ev.y + 8,
                            String(Math.round(ev.amount)),
                            ev.crit ? this._cGold : this._cWhite,
                            ev.crit,
                        );
                    }
                    break;
                default:
                    break;
            }
        }
    }

    // ==================== 绘制 ====================

    private _drawFloor(g: Graphics): void {
        g.fillColor = this._cFloor;
        g.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H);
        g.fill();

        // 矿道地砖：交替色带，制造纵深
        for (let i = 0; i < 8; i++) {
            if (i % 2 === 1) continue;
            g.fillColor = this._cFloorAlt;
            g.rect(-FIELD_W / 2, -FIELD_H / 2 + i * 160, FIELD_W, 160);
            g.fill();
        }

        g.strokeColor = this._cGrid;
        g.lineWidth = 1;
        for (let x = 0; x <= FIELD_W; x += 80) {
            g.moveTo(x - FIELD_W / 2, -FIELD_H / 2);
            g.lineTo(x - FIELD_W / 2, FIELD_H / 2);
        }
        for (let y = 0; y <= FIELD_H; y += 80) {
            g.moveTo(-FIELD_W / 2, y - FIELD_H / 2);
            g.lineTo(FIELD_W / 2, y - FIELD_H / 2);
        }
        g.stroke();

        // 矿车轨道：两条竖线 + 枕木
        const railX = 160;
        g.strokeColor = this._cRail;
        g.lineWidth = 3;
        g.moveTo(railX - FIELD_W / 2, -FIELD_H / 2);
        g.lineTo(railX - FIELD_W / 2, FIELD_H / 2);
        g.moveTo(railX + 42 - FIELD_W / 2, -FIELD_H / 2);
        g.lineTo(railX + 42 - FIELD_W / 2, FIELD_H / 2);
        g.stroke();
        g.strokeColor = this._cRailTie;
        g.lineWidth = 2;
        for (let y = -FIELD_H / 2 + 20; y < FIELD_H / 2; y += 46) {
            g.moveTo(railX - 10 - FIELD_W / 2, y);
            g.lineTo(railX + 52 - FIELD_W / 2, y);
        }
        g.stroke();

        // 边缘碎石
        for (const [x, y, r] of FLOOR_ROCKS) {
            g.fillColor = this._cRock;
            g.circle(x - FIELD_W / 2, y - FIELD_H / 2, r);
            g.fill();
            g.fillColor = this._cRockLight;
            g.circle(x - FIELD_W / 2 - r * 0.25, y - FIELD_H / 2 + r * 0.25, r * 0.42);
            g.fill();
        }
    }

    private _drawTelegraphs(g: Graphics, snap: MithrilSnapshot): void {
        for (const t of snap.telegraphs) {
            if (t.done) continue;
            const k = Math.max(0, Math.min(1, t.t / Math.max(0.0001, t.warn)));
            const cx = t.x - FIELD_W / 2;
            const cy = t.y - FIELD_H / 2;
            const color = t.kind === 'boss_slam' ? this._cTelegraphBoss : this._cTelegraph;
            this._tmp.set(color);
            this._tmp.a = 40 + k * 55;
            g.fillColor = this._tmp;
            g.circle(cx, cy, t.radius);
            g.fill();

            this._tmp.set(color);
            this._tmp.a = 150 + k * 90;
            g.strokeColor = this._tmp;
            g.lineWidth = 3;
            g.circle(cx, cy, t.radius);
            g.stroke();
            // 内圈收缩：读条完成感
            g.strokeColor = this._tmp;
            g.lineWidth = 2;
            g.circle(cx, cy, t.radius * (1 - k) + 6);
            g.stroke();
        }
    }

    private _drawOrbs(g: Graphics, snap: MithrilSnapshot): void {
        for (const o of snap.orbs) drawOrb(g, o.x - FIELD_W / 2, o.y - FIELD_H / 2, this._time);
    }

    private _drawEnemies(g: Graphics, snap: MithrilSnapshot): void {
        for (const e of snap.enemies) {
            const x = e.x - FIELD_W / 2;
            const y = e.y - FIELD_H / 2;
            if (e.kind === 'imp') drawImp(g, x, y, this._time);
            else if (e.kind === 'miner') drawMiner(g, x, y, this._time);
            else if (e.kind === 'wraith') drawWraith(g, x, y, this._time);
            else if (e.kind === 'golem') drawGolem(g, x, y, this._time);
            else if (e.kind === 'troll') drawTroll(g, x, y, this._time, e.status.stun > 0 || e.casting || snap.bossEnraged > 0 || (snap.boss?.phase ?? 0) >= 1);
            else {
                g.fillColor = this._cRockLight;
                g.circle(x, y, e.radius);
                g.fill();
            }

            // 控制状态：冰蓝圈 / 破甲
            if (e.status.stun > 0) {
                g.strokeColor = this._cBlue;
                g.lineWidth = 2;
                g.circle(x, y, e.radius + 5);
                g.stroke();
            }
            if (e.status.armorBreak > 0) {
                g.strokeColor = this._cGold;
                g.lineWidth = 2;
                g.arc(x, y, e.radius + 3, 0.3, 2.4, false);
                g.stroke();
            }

            if (!e.isBoss) {
                const w = Math.max(26, e.radius * 2.2);
                drawEnemyBar(g, x, y + e.radius + 10, w, e.hp / e.maxHp, e.isElite ? MITH_PAL.hpElite : MITH_PAL.hp);
            }
        }
    }

    private _drawBullets(g: Graphics, snap: MithrilSnapshot): void {
        for (const b of snap.bullets) {
            const x = b.x - FIELD_W / 2;
            const y = b.y - FIELD_H / 2;
            if (b.kind === 'boulder') {
                g.fillColor = this._cBoulder;
                g.circle(x, y, b.radius);
                g.fill();
                g.fillColor = this._cRockLight;
                g.circle(x - 3, y + 3, b.radius * 0.4);
                g.fill();
                // 尾迹
                g.strokeColor = this._cBoulder;
                g.lineWidth = 2;
                g.moveTo(x, y);
                g.lineTo(x - b.vx * 0.04, y - b.vy * 0.04);
                g.stroke();
            } else if (b.kind === 'bolt') {
                g.fillColor = this._cBolt;
                g.circle(x, y, b.radius);
                g.fill();
                g.strokeColor = this._cWhite;
                g.lineWidth = 1;
                g.circle(x, y, b.radius - 2);
                g.stroke();
            } else {
                g.fillColor = b.owner === 'player' ? this._cGold : this._cBolt;
                g.circle(x, y, b.radius);
                g.fill();
            }
        }
    }

    private _drawPlayer(g: Graphics, snap: MithrilSnapshot): void {
        const p = snap.player;
        drawWarrior(g, p.x - FIELD_W / 2, p.y - FIELD_H / 2, p.facing, this._time, {
            invuln: p.invuln > 0,
            burst: p.burst > 0,
            whirlwind: p.whirlwind > 0,
            hitFlash: this._hurtFlash,
        });
    }

    private _drawFx(g: Graphics, dt: number): void {
        for (let i = this._fx.length - 1; i >= 0; i--) {
            const fx = this._fx[i];
            fx.t += dt;
            if (fx.t >= fx.life) {
                this._fx.splice(i, 1);
                continue;
            }
            const k = fx.t / fx.life;
            const x = fx.x - FIELD_W / 2;
            const y = fx.y - FIELD_H / 2;
            this._tmp.set(fx.color);
            if (fx.kind === 'ring') {
                this._tmp.a = Math.round(220 * (1 - k));
                g.strokeColor = this._tmp;
                g.lineWidth = 3;
                g.circle(x, y, fx.r * (0.3 + k * 0.8));
                g.stroke();
            } else if (fx.kind === 'swing') {
                this._tmp.a = Math.round(230 * (1 - k));
                g.strokeColor = this._tmp;
                g.lineWidth = 4;
                g.arc(x, y, fx.r * (0.5 + k * 0.4), fx.angle - 0.7, fx.angle + 0.7, false);
                g.stroke();
            } else if (fx.kind === 'streak') {
                this._tmp.a = Math.round(200 * (1 - k));
                g.strokeColor = this._tmp;
                g.lineWidth = 5;
                const len = fx.r * (1 - k * 0.4);
                g.moveTo(x - Math.cos(fx.angle) * len, y - Math.sin(fx.angle) * len);
                g.lineTo(x + Math.cos(fx.angle) * len, y + Math.sin(fx.angle) * len);
                g.stroke();
            } else if (fx.kind === 'plus') {
                this._tmp.a = Math.round(230 * (1 - k));
                g.strokeColor = this._tmp;
                g.lineWidth = 3;
                const r = fx.r * (0.8 + k * 0.5);
                g.moveTo(x - r, y);
                g.lineTo(x + r, y);
                g.moveTo(x, y - r);
                g.lineTo(x, y + r);
                g.stroke();
            } else if (fx.kind === 'mote') {
                this._tmp.a = Math.round(170 * (1 - k));
                g.fillColor = this._tmp;
                for (let n = 0; n < 4; n++) {
                    const a = (n / 4) * Math.PI * 2 + this._time;
                    g.circle(x + Math.cos(a) * fx.r * (0.4 + k), y + Math.sin(a) * fx.r * (0.4 + k) + k * 20, 3);
                    g.fill();
                }
            }
        }
    }

    private _drawHurtFlash(g: Graphics): void {
        if (this._hurtFlash <= 0) return;
        this._tmp.set(this._cHurt);
        this._tmp.a = Math.round(90 * this._hurtFlash);
        g.fillColor = this._tmp;
        g.rect(-FIELD_W / 2, -FIELD_H / 2, FIELD_W, FIELD_H);
        g.fill();
    }

    private _pushFx(
        kind: Fx['kind'], x: number, y: number, r: number,
        angle: number, life: number, color: Color,
    ): void {
        if (this._fx.length > 80) this._fx.shift();
        this._fx.push({ kind, x, y, r, angle, t: 0, life, color });
    }

    // ==================== 伤害数字 ====================

    private _addNumber(x: number, y: number, text: string, color: Color, crit = false): void {
        let label = this._numberPool.pop();
        if (!label) {
            if (this._numbers.length >= MAX_DAMAGE_NUMBERS) {
                // 满了就抢最老的
                const oldest = this._numbers.shift();
                if (oldest) label = oldest.label;
            }
        }
        if (!label) {
            label = createLabel(this.node, text, 20, {
                width: 120, height: 30, color: '#FFFFFF', bold: true, overflow: 'none',
            });
            label.node.active = false;
        }
        label.node.active = true;
        label.string = text;
        label.fontSize = crit ? 26 : 20;
        label.color = color;
        label.node.setPosition(x - FIELD_W / 2 + (Math.sin(x * 3) * 8), y - FIELD_H / 2, 0);
        this._numbers.push({ label, x, y, t: 0, life: crit ? 0.85 : 0.65, rise: crit ? 46 : 34, base: color });
    }

    private _updateNumbers(dt: number): void {
        for (let i = this._numbers.length - 1; i >= 0; i--) {
            const n = this._numbers[i];
            n.t += dt;
            if (n.t >= n.life) {
                n.label.node.active = false;
                this._numberPool.push(n.label);
                this._numbers.splice(i, 1);
                continue;
            }
            const k = n.t / n.life;
            n.label.node.setPosition(
                n.x - FIELD_W / 2 + Math.sin(n.x * 3) * 8,
                n.y - FIELD_H / 2 + n.rise * k,
                0,
            );
            const c = this._tmp;
            c.set(n.base);
            c.a = Math.round(255 * (1 - k));
            n.label.color = c;
        }
    }
}
