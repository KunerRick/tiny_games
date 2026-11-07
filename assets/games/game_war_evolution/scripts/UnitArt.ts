/**
 * 战争进化史 - 单位剪影绘制
 *
 * 零贴图（计划 §0.1 铁律 2）：所有兵种都用 Graphics 画 2–4 笔剪影，
 * 保证关掉颜色也能靠外形区分（美术原则 A2）。绘制坐标系以单位中心为原点，
 * 基准尺寸约 30×30，外层节点再按 UnitConfig.scale 缩放。
 */

import { Color, Graphics } from 'cc';

function hex(hexStr: string, alpha = 255): Color {
    const h = hexStr.replace('#', '');
    return new Color(
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        alpha,
    );
}

/** 六种兵种的剪影形状（近战/远程/重型各自外形差异明显） */
export function drawUnitSilhouette(g: Graphics, icon: string, fill: Color, outline?: Color): void {
    g.clear();
    g.lineWidth = 2;
    g.fillColor = fill;
    g.strokeColor = outline ?? new Color(6, 12, 22, 200);

    switch (icon) {
        case 'caveman':
            // 头 + 三角身 + 木棒
            g.circle(0, 8, 5.5);
            g.moveTo(-8, -7);
            g.lineTo(8, -7);
            g.lineTo(0, 6);
            g.close();
            g.fill();
            g.stroke();
            g.lineWidth = 4;
            g.moveTo(6, 2);
            g.lineTo(13, 9);
            g.stroke();
            break;

        case 'mammoth':
            // 椭圆身 + 大头颅 + 象牙 + 短腿
            g.ellipse(1, 0, 11, 7.5);
            g.circle(-9, 3, 6);
            g.fill();
            g.stroke();
            g.lineWidth = 3;
            g.moveTo(-14, 1);
            g.lineTo(-20, -5);
            g.stroke();
            g.lineWidth = 3;
            g.moveTo(-6, -7);
            g.lineTo(-7, -12);
            g.moveTo(5, -7);
            g.lineTo(6, -12);
            g.stroke();
            break;

        case 'knight':
            // 盾牌 + 长矛 + 头盔
            g.roundRect(-9, -11, 15, 19, 4);
            g.fill();
            g.stroke();
            g.circle(3, 10, 4.5);
            g.fill();
            g.stroke();
            g.lineWidth = 3;
            g.moveTo(11, -13);
            g.lineTo(11, 13);
            g.stroke();
            // 矛尖
            g.moveTo(8, 11);
            g.lineTo(11, 17);
            g.lineTo(14, 11);
            g.close();
            g.fill();
            break;

        case 'archer':
            // 弓 + 箭 + 箭袋
            g.lineWidth = 3;
            g.arc(2, 0, 11, -1.1, 1.1, false);
            g.stroke();
            g.lineWidth = 1.5;
            g.moveTo(7, -9.8);
            g.lineTo(7, 9.8);
            g.stroke();
            g.lineWidth = 2.5;
            g.moveTo(-10, 0);
            g.lineTo(9, 0);
            g.stroke();
            g.rect(-12, -8, 5, 11);
            g.fill();
            g.stroke();
            break;

        case 'mech':
            // 方肩 + 躯干 + 单眼
            g.roundRect(-12, 3, 24, 7, 2);
            g.roundRect(-8, -11, 16, 14, 3);
            g.fill();
            g.stroke();
            g.fillColor = new Color(255, 255, 255, 255);
            g.circle(0, -3, 3);
            g.fill();
            g.lineWidth = 3;
            g.moveTo(-10, -10);
            g.lineTo(-10, -14);
            g.moveTo(10, -10);
            g.lineTo(10, -14);
            g.stroke();
            break;

        case 'laser':
            // 细身 + 天线 + 发射口
            g.roundRect(-4, -12, 8, 17, 2);
            g.fill();
            g.stroke();
            g.lineWidth = 2;
            g.moveTo(0, 5);
            g.lineTo(0, 13);
            g.stroke();
            g.fillColor = new Color(255, 255, 255, 255);
            g.circle(0, 2, 2.2);
            g.fill();
            g.fillColor = fill;
            g.roundRect(-8, -9, 4, 10, 1.5);
            g.roundRect(4, -9, 4, 10, 1.5);
            g.fill();
            g.stroke();
            break;

        default:
            g.circle(0, 0, 10);
            g.fill();
            g.stroke();
            break;
    }
}

/** 单位脚下的椭圆阴影 */
export function drawShadow(g: Graphics, width: number, alpha = 90): void {
    g.clear();
    g.fillColor = new Color(3, 7, 14, alpha);
    g.ellipse(0, 0, width / 2, width / 6);
    g.fill();
}

/** 冲锋状态下的金色光环 */
export function drawChargeRing(g: Graphics, radius: number): void {
    g.clear();
    g.lineWidth = 3;
    g.strokeColor = hex('#F59E0B', 210);
    g.circle(0, 0, radius);
    g.stroke();
}

export { hex as colorFromHex };
