/**
 * 战争进化史 - 战场绘制（运行时，零贴图）
 *
 * 场景里原有的 bgGround / pathLine 只覆盖屏幕中部，本组件把战场重排为
 * 「屏幕纵向 40%–55%」（计划 V1）：按时代换地面（草地 / 泥地 / 金属板）、
 * 加暗角、给两侧城堡加旗帜与护盾光。
 */

import { _decorator, Color, Component, Graphics, Node, UITransform } from 'cc';
import { Age, BATTLEFIELD, BATTLE_PALETTE, WORLD } from './GameConfig';
import { colorFromHex } from './UnitArt';

const { ccclass } = _decorator;

const HALF_W = 360;
const SKY_TOP = 600;

/** 简单确定性伪随机（每次重绘布局一致，避免闪动） */
function makeRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
    };
}

@ccclass('Battlefield')
export class Battlefield extends Component {
    private _bg: Graphics | null = null;
    private _deco: Graphics | null = null;
    private _age: Age = Age.PRIMITIVE;

    /** 挂到 BattleArea 下（坐标与单位容器一致） */
    public static create(parent: Node): Battlefield {
        const node = new Node('Battlefield');
        node.layer = parent.layer;
        parent.addChild(node);
        node.setSiblingIndex(0);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        ut.setAnchorPoint(0.5, 0.5);
        const comp = node.addComponent(Battlefield);
        comp._bg = node.addComponent(Graphics);
        const decoNode = new Node('Deco');
        decoNode.layer = parent.layer;
        node.addChild(decoNode);
        decoNode.addComponent(UITransform).setContentSize(720, 1280);
        comp._deco = decoNode.addComponent(Graphics);
        comp.draw();
        return comp;
    }

    public setAge(age: Age): void {
        if (this._age === age) return;
        this._age = age;
        this.draw();
    }

    public getAge(): Age { return this._age; }

    private draw(): void {
        this.drawBackground();
        this.drawDecoration();
    }

    /** 背景：天空带 + 地面 + 暗角 */
    private drawBackground(): void {
        const g = this._bg;
        if (!g) return;
        const palette = BATTLE_PALETTE.ground[this._age] ?? BATTLE_PALETTE.ground[0];
        g.clear();

        // 天空（战场上方到顶部 HUD 之间）
        g.fillColor = colorFromHex('#0C1524');
        g.rect(-HALF_W, BATTLEFIELD.TOP, HALF_W * 2, SKY_TOP - BATTLEFIELD.TOP);
        g.fill();

        // 地面主体
        g.fillColor = colorFromHex(palette.base);
        g.rect(-HALF_W, BATTLEFIELD.BOTTOM, HALF_W * 2, BATTLEFIELD.TOP - BATTLEFIELD.BOTTOM);
        g.fill();

        // 地面下方的操作区
        g.fillColor = colorFromHex('#0A1120');
        g.rect(-HALF_W, BATTLEFIELD.BOTTOM - 320, HALF_W * 2, 320);
        g.fill();

        // 地面横向分层：越靠近战线越亮
        const layers = 3;
        for (let i = 0; i < layers; i++) {
            const h = (BATTLEFIELD.TOP - BATTLEFIELD.BOTTOM) / layers;
            const alpha = 14 + i * 10;
            g.fillColor = colorFromHex(palette.path, alpha);
            g.rect(-HALF_W, BATTLEFIELD.BOTTOM + i * h, HALF_W * 2, h);
            g.fill();
        }

        // 战线跑道
        g.fillColor = colorFromHex(palette.path, 235);
        g.rect(-HALF_W + 4, WORLD.BATTLE_Y - 16, HALF_W * 2 - 8, 32);
        g.fill();

        // 中线（虚线段）
        g.lineWidth = 3;
        g.strokeColor = colorFromHex(palette.accent, 190);
        for (let x = -320; x < 320; x += 40) {
            g.moveTo(x, WORLD.BATTLE_Y);
            g.lineTo(x + 20, WORLD.BATTLE_Y);
        }
        g.stroke();

        // 左右边界墙
        g.fillColor = colorFromHex('#0E1A2A', 220);
        g.rect(-HALF_W, BATTLEFIELD.BOTTOM, 8, BATTLEFIELD.TOP - BATTLEFIELD.BOTTOM);
        g.rect(HALF_W - 8, BATTLEFIELD.BOTTOM, 8, BATTLEFIELD.TOP - BATTLEFIELD.BOTTOM);
        g.fill();

        // 上下暗角（多层窄带模拟渐变）
        for (let i = 0; i < 5; i++) {
            const alpha = 26 - i * 5;
            if (alpha <= 0) continue;
            g.fillColor = new Color(3, 7, 14, alpha);
            g.rect(-HALF_W, BATTLEFIELD.TOP - (i + 1) * 14, HALF_W * 2, 14);
            g.fill();
            g.rect(-HALF_W, BATTLEFIELD.BOTTOM + i * 14, HALF_W * 2, 14);
            g.fill();
        }

        // 地平线
        g.lineWidth = 2;
        g.strokeColor = colorFromHex(palette.accent, 140);
        g.moveTo(-HALF_W, BATTLEFIELD.TOP);
        g.lineTo(HALF_W, BATTLEFIELD.TOP);
        g.stroke();
    }

    /** 装饰：随时代变化的草地/石砖/金属板 + 城堡旗帜 */
    private drawDecoration(): void {
        const g = this._deco;
        if (!g) return;
        const palette = BATTLE_PALETTE.ground[this._age] ?? BATTLE_PALETTE.ground[0];
        g.clear();
        const rnd = makeRandom(1337 + this._age * 97);

        const floorTop = BATTLEFIELD.TOP - 24;
        const floorBottom = BATTLEFIELD.BOTTOM + 24;

        if (this._age === Age.PRIMITIVE) {
            // 草丛 + 石块
            g.lineWidth = 2;
            g.strokeColor = colorFromHex(palette.accent, 160);
            for (let i = 0; i < 90; i++) {
                const x = (rnd() * 2 - 1) * (HALF_W - 20);
                const y = floorBottom + rnd() * (floorTop - floorBottom);
                if (Math.abs(y - WORLD.BATTLE_Y) < 26) continue;
                const h = 5 + rnd() * 7;
                g.moveTo(x, y);
                g.lineTo(x + (rnd() * 6 - 3), y + h);
            }
            g.stroke();
            g.fillColor = colorFromHex(palette.accent, 120);
            for (let i = 0; i < 18; i++) {
                const x = (rnd() * 2 - 1) * (HALF_W - 30);
                const y = floorBottom + rnd() * (floorTop - floorBottom);
                g.circle(x, y, 3 + rnd() * 4);
            }
            g.fill();
        } else if (this._age === Age.MEDIEVAL) {
            // 石砖缝
            g.lineWidth = 2;
            g.strokeColor = colorFromHex(palette.accent, 90);
            for (let y = floorBottom; y < floorTop; y += 34) {
                if (Math.abs(y - WORLD.BATTLE_Y) < 26) continue;
                g.moveTo(-HALF_W + 12, y);
                g.lineTo(HALF_W - 12, y);
            }
            for (let x = -HALF_W + 30; x < HALF_W - 20; x += 64) {
                g.moveTo(x, floorBottom);
                g.lineTo(x, floorTop);
            }
            g.stroke();
        } else {
            // 未来：金属板 + 霓虹线
            g.lineWidth = 2;
            g.strokeColor = colorFromHex('#38BDF8', 55);
            for (let x = -HALF_W + 40; x < HALF_W - 20; x += 80) {
                g.moveTo(x, floorBottom);
                g.lineTo(x, floorTop);
            }
            for (let y = floorBottom; y < floorTop; y += 60) {
                if (Math.abs(y - WORLD.BATTLE_Y) < 26) continue;
                g.moveTo(-HALF_W + 12, y);
                g.lineTo(HALF_W - 12, y);
            }
            g.stroke();
            g.fillColor = colorFromHex('#38BDF8', 40);
            for (let i = 0; i < 12; i++) {
                const x = (rnd() * 2 - 1) * (HALF_W - 40);
                const y = floorBottom + rnd() * (floorTop - floorBottom);
                g.circle(x, y, 2);
            }
            g.fill();
        }

        // 两侧城堡：旗帜 + 护盾光
        this.drawCastleDecor(g, WORLD.PLAYER_X, '#38BDF8');
        this.drawCastleDecor(g, WORLD.ENEMY_X, '#EF4444');
    }

    private drawCastleDecor(g: Graphics, x: number, colorHex: string): void {
        const color = colorFromHex(colorHex, 170);
        // 旗杆
        g.lineWidth = 3;
        g.strokeColor = colorFromHex('#CBD5E1', 200);
        g.moveTo(x - 26, WORLD.BATTLE_Y + 64);
        g.lineTo(x - 26, WORLD.BATTLE_Y + 138);
        g.stroke();
        // 旗帜三角
        g.fillColor = color;
        g.moveTo(x - 26, WORLD.BATTLE_Y + 138);
        g.lineTo(x + 14, WORLD.BATTLE_Y + 126);
        g.lineTo(x - 26, WORLD.BATTLE_Y + 110);
        g.close();
        g.fill();
        // 护盾光（城堡脚下的半环）
        g.lineWidth = 4;
        g.strokeColor = colorFromHex(colorHex, 70);
        g.arc(x, WORLD.BATTLE_Y - 8, 74, Math.PI * 0.15, Math.PI * 0.85, true);
        g.stroke();
        g.lineWidth = 2;
        g.strokeColor = colorFromHex(colorHex, 110);
        g.arc(x, WORLD.BATTLE_Y - 8, 84, Math.PI * 0.2, Math.PI * 0.8, true);
        g.stroke();
    }
}
