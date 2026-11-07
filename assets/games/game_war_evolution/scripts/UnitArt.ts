/**
 * 战争进化史 - 单位剪影与技能特效绘制
 *
 * 零贴图（计划 §0.1 铁律 2）：所有兵种都用 Graphics 现画。
 *
 * 画法（卡通贴纸风，参考《皇室战争》小尺寸图标的辨识度）：
 *   1. 统一的厚深色描边（3.2，四肢 +2.4），保证任何背景上都有硬轮廓；
 *   2. 三色分层：本体色 → 暗部（压暗 38%）→ 高光（提亮 45%），靠明度而非撞色出体积；
 *   3. 夸张比例：头 / 武器显著大于写实比例，缩到 20 个 CSS 像素仍能认出是谁；
 *   4. 朝向由外层节点镜像（Unit.buildVisual），绘制坐标一律「面向右」（+x 为前）。
 *
 * 坐标系：以单位中心为原点，地面 y=-26，头顶 y=+26（尽量吃满 56×56 的画布，
 * 同样的单位尺寸下图形更大、更好认）。外层节点再按 UnitConfig.scale 缩放。
 *
 * 设计原则：先保证「关掉颜色、只看黑色剪影」能一眼分清六个兵种，
 * 再往里堆明暗与细节 —— 战场上实际只有 20 来个 CSS 像素。
 */

import { Color, Graphics } from 'cc';

const OUTLINE = new Color(8, 14, 26, 235);
const BLACK = new Color(0, 0, 0, 255);
const WHITE = new Color(255, 255, 255, 255);

function hex(hexStr: string, alpha = 255): Color {
    const h = hexStr.replace('#', '');
    return new Color(
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        alpha,
    );
}

function mix(a: Color, b: Color, t: number): Color {
    return new Color(
        Math.round(a.r + (b.r - a.r) * t),
        Math.round(a.g + (b.g - a.g) * t),
        Math.round(a.b + (b.b - a.b) * t),
        Math.round(a.a + (b.a - a.a) * t),
    );
}

interface Tones { base: Color; shade: Color; light: Color; }

/** 由阵营混合色推导出「暗部 / 高光」，保证六兵种共用同一套明度关系 */
function tones(fill: Color): Tones {
    return {
        base: fill,
        shade: mix(fill, BLACK, 0.4),
        light: mix(fill, WHITE, 0.5),
    };
}

/** 填充 + 描边（描边可为 null 表示只填不描，用于高光层） */
function paint(g: Graphics, color: Color, outline: Color | null = OUTLINE, lw = 3.2): void {
    g.fillColor = color;
    g.fill();
    if (outline) {
        g.lineWidth = lw;
        g.strokeColor = outline;
        g.stroke();
    }
}

/** 带描边的粗线段（四肢 / 武器 / 长鼻），圆头收口 */
function limb(g: Graphics, x1: number, y1: number, x2: number, y2: number,
    width: number, color: Color, outline: Color | null = OUTLINE): void {
    g.lineCap = Graphics.LineCap.ROUND;
    if (outline) {
        g.lineWidth = width + 2.8;
        g.strokeColor = outline;
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
    }
    g.lineWidth = width;
    g.strokeColor = color;
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
}

function dot(g: Graphics, x: number, y: number, r: number, color: Color): void {
    g.fillColor = color;
    g.circle(x, y, r);
    g.fill();
}

/** 眼睛：白色底 + 深色瞳孔，小尺寸下比单个黑点更「活」 */
function eye(g: Graphics, x: number, y: number, r = 2.4): void {
    dot(g, x, y, r, WHITE);
    dot(g, x + r * 0.28, y - r * 0.12, r * 0.56, new Color(12, 18, 30, 255));
}

/**
 * 六种兵种的剪影（近战 / 远程 / 重型外形差异明显，关掉颜色也能分清 —— 美术原则 A2）
 * 所有图形一律「面向右」绘制；敌方由外层节点 setScale(-1, 1, 1) 镜像。
 */
export function drawUnitSilhouette(g: Graphics, icon: string, fill: Color, outline?: Color): void {
    g.clear();
    g.lineJoin = Graphics.LineJoin.ROUND;
    const ol = outline ?? OUTLINE;
    const t = tones(fill);

    switch (icon) {
        case 'caveman': {
            // 剪影特征：巨大的头 + 肩上斜扛的大棒
            // 棍棒（先画，被身体压住一部分）
            limb(g, 10, -2, 21, 15, 6, hex('#A9723F'));
            dot(g, 22, 17, 7.6, hex('#B8834E'));
            dot(g, 22, 17, 5.6, hex('#C99A63'));

            // 腿
            g.roundRect(-9, -26, 8, 15, 4);
            g.roundRect(1.5, -26, 8, 15, 4);
            paint(g, t.shade, ol);

            // 躯干（上宽下窄的倒梯形，胸口有高光）
            g.moveTo(-11, -13);
            g.lineTo(11, -13);
            g.lineTo(8, 3);
            g.lineTo(-8, 3);
            g.close();
            paint(g, t.base, ol);
            g.moveTo(-8, -10);
            g.lineTo(-3, -10);
            g.lineTo(-2.4, 0);
            g.lineTo(-6, 0);
            g.close();
            paint(g, t.light, null);

            // 大头（半径 11，占整个身高的 1/3）
            g.circle(1, 14, 11);
            paint(g, t.base, ol);
            g.circle(-3.4, 19, 4.2);
            paint(g, t.light, null);
            // 眉骨 + 眼睛
            g.roundRect(-7.5, 14, 16, 4.4, 2.2);
            paint(g, t.shade, null);
            eye(g, 4.6, 11.4, 2.8);
            // 头顶一撮毛
            g.moveTo(-2, 24.4);
            g.lineTo(1.5, 27.5);
            g.lineTo(5, 24);
            g.close();
            paint(g, t.shade, ol, 2.2);
            break;
        }

        case 'mammoth': {
            // 剪影特征：低矮的拱背 + 朝前的长鼻与象牙（一律朝右）
            // 关键：头必须「凸」出身体轮廓，否则整只读起来只是一坨椭圆
            // 腿（三条，后腿更粗）
            g.roundRect(-15, -26, 8, 16, 4);
            g.roundRect(-4, -26, 8, 16, 4);
            g.roundRect(7, -26, 8, 14, 4);
            paint(g, t.shade, ol);

            // 躯干 + 肩峰（前高后低，野兽的骨架）
            g.ellipse(-5, -1, 14, 11);
            paint(g, t.base, ol);
            g.circle(-2, 7, 8);
            paint(g, t.base, ol);
            g.ellipse(-6, 5, 9, 4.2);
            paint(g, t.light, null);

            // 头：明显探出躯干之外
            g.circle(15, 4, 8.2);
            paint(g, t.base, ol);
            // 下颌压暗
            g.ellipse(15, -1.5, 7, 3.6);
            paint(g, t.shade, null);
            // 长鼻：向右下方甩出两段，粗到能在小尺寸里看见
            limb(g, 21, 1, 25, -6, 6, t.shade);
            limb(g, 25, -6, 23, -14, 5, t.shade);
            // 象牙（朝前上方翘，浅色才跳得出来）
            limb(g, 19, -3, 28, 4, 4, hex('#F7EBD2'));
            // 眼睛 + 大耳朵（耳朵向后展开，拉开剪影）
            eye(g, 18, 7, 2.3);
            g.ellipse(5, 9, 4.8, 6.4);
            paint(g, t.shade, ol, 2.6);
            break;
        }

        case 'knight': {
            // 剪影特征：骑士枪 + 盾牌 + 头盔盔缨（最「人形」的一个，靠装备区分）
            // 盾牌（身后）
            g.moveTo(-17, 4);
            g.lineTo(-5, 4);
            g.lineTo(-5, -8);
            g.lineTo(-11, -15);
            g.lineTo(-17, -8);
            g.close();
            paint(g, t.light, ol);
            g.roundRect(-12.4, -8, 2.8, 9.5, 1.2);
            g.roundRect(-15, -3.6, 8.2, 2.8, 1.2);
            paint(g, t.shade, null);

            // 腿
            g.roundRect(-8, -26, 7, 13, 3.5);
            g.roundRect(1, -26, 7, 13, 3.5);
            paint(g, t.shade, ol);

            // 胸甲
            g.roundRect(-9.5, -16, 19, 20, 6);
            paint(g, t.base, ol);
            g.roundRect(-5.5, -5, 11, 6.5, 3);
            paint(g, t.light, null);

            // 头盔（大一圈）+ 面甲
            g.circle(0, 11, 9);
            paint(g, t.base, ol);
            g.roundRect(-8, 8.5, 15, 5.5, 2.6);
            paint(g, t.shade, null);
            dot(g, 4.2, 11.5, 1.5, hex('#FDE68A'));

            // 盔缨
            g.moveTo(-3, 18);
            g.lineTo(0.5, 26);
            g.lineTo(6, 18);
            g.close();
            paint(g, hex('#DC2626'), ol, 2.4);

            // 骑士枪（粗、带护手，指向正前方）
            limb(g, 3, 1, 25, 8, 4.6, hex('#B9C6D8'));
            g.moveTo(25, 8);
            g.lineTo(19, 12.5);
            g.lineTo(20, 3.5);
            g.close();
            paint(g, hex('#EEF2F7'), ol, 2.4);
            break;
        }

        case 'archer': {
            // 剪影特征：尖兜帽 + 身前一张大弓（弓的弧线是唯一的识别点，必须够大）
            // 腿
            g.roundRect(-7.5, -26, 6, 12, 3);
            g.roundRect(1.5, -26, 6, 12, 3);
            paint(g, t.shade, ol);

            // 斗篷：上窄下宽的梯形
            g.moveTo(-8, -16);
            g.lineTo(8, -16);
            g.lineTo(11, 2);
            g.lineTo(-9, 2);
            g.close();
            paint(g, t.base, ol);
            g.moveTo(-6, -13);
            g.lineTo(-2, -13);
            g.lineTo(-1, 0);
            g.lineTo(-5, 0);
            g.close();
            paint(g, t.light, null);

            // 尖兜帽（三角形，顶点偏后）
            g.moveTo(-9, 1);
            g.lineTo(9, 1);
            g.lineTo(0, 20);
            g.close();
            paint(g, t.light, ol);
            // 阴影里的脸 + 一只眼
            dot(g, 1.5, 6.5, 4.6, t.shade);
            dot(g, 3, 6.8, 1.4, hex('#FDE68A'));

            // 大弓：半径 15，占据身前整个半圆
            g.lineCap = Graphics.LineCap.ROUND;
            g.lineJoin = Graphics.LineJoin.ROUND;
            g.lineWidth = 5.4;
            g.strokeColor = ol;
            g.arc(13, 0, 15, -1.28, 1.28, false);
            g.stroke();
            g.lineWidth = 3;
            g.strokeColor = hex('#B4784E');
            g.arc(13, 0, 15, -1.28, 1.28, false);
            g.stroke();
            // 弓弦
            g.lineWidth = 1.4;
            g.strokeColor = hex('#E2E8F0', 225);
            g.moveTo(17.4, 14.4);
            g.lineTo(17.4, -14.4);
            g.stroke();
            // 搭在弦上的箭
            limb(g, -2, 0, 20, 0, 2.2, hex('#E2E8F0'));
            break;
        }

        case 'mech': {
            // 剪影特征：方头 + 宽肩甲 + 单条发光眼缝（唯一「直角」很多的造型）
            // 腿（粗，机械感靠直角）
            g.roundRect(-10, -26, 8, 15, 2.5);
            g.roundRect(2, -26, 8, 15, 2.5);
            paint(g, t.shade, ol);

            // 手臂（垂在身侧，末端拳套）
            g.roundRect(-16, -12, 6.5, 13, 2.5);
            g.roundRect(9.5, -12, 6.5, 13, 2.5);
            paint(g, t.base, ol);

            // 躯干 + 胸口能量核
            g.roundRect(-8.5, -13, 17, 18, 3.5);
            paint(g, t.base, ol);
            g.roundRect(-6, -9, 12, 5, 2.5);
            paint(g, t.light, null);
            dot(g, 0, -3.5, 3.8, hex('#7DD3FC'));
            dot(g, 0, -3.5, 2, hex('#E0F7FF'));

            // 肩甲（压在躯干上，宽度 26）
            g.roundRect(-13, 4, 26, 8, 3.5);
            paint(g, t.light, ol);
            g.roundRect(-11.5, 6.2, 7.5, 3.2, 1.6);
            paint(g, mix(t.light, WHITE, 0.55), null);

            // 方头 + 一条横贯的发光眼缝
            g.roundRect(-7, 12, 14, 10.5, 3);
            paint(g, t.base, ol);
            g.roundRect(-5.2, 15.6, 10.4, 3.4, 1.7);
            paint(g, hex('#7DD3FC'), null);
            break;
        }

        case 'laser': {
            // 剪影特征：细高身形 + 超长炮管（长度几乎等于身高）
            limb(g, -3.4, -26, -4, -9, 4, t.shade);
            limb(g, 3.4, -26, 4, -9, 4, t.shade);

            // 躯干（窄高）
            g.roundRect(-6, -12, 12, 26, 5);
            paint(g, t.base, ol);
            g.roundRect(-4, 4, 8, 6, 3);
            paint(g, hex('#7DD3FC'), null);
            g.roundRect(-3.6, -8, 3.4, 10, 1.6);
            paint(g, t.light, null);

            // 炮管（从身体中段向右伸到 x=27）
            g.roundRect(4, -3, 22, 7.5, 3.4);
            paint(g, t.light, ol);
            g.roundRect(20, -1.6, 6, 4.8, 2.2);
            paint(g, hex('#A5F3FC'), null);
            // 炮身散热槽
            g.roundRect(8, 0.6, 8, 2.2, 1.1);
            paint(g, t.shade, null);

            // 天线 + 尖端能量（细杆不描边，否则缩到 20px 会变成一团黑疙瘩）
            limb(g, -1, 14, -1, 19, 1.6, hex('#CBD5E1'), null);
            dot(g, -1, 21, 3.2, hex('#22D3EE', 110));
            dot(g, -1, 21, 1.8, hex('#CFFAFE'));
            break;
        }

        default: {
            g.circle(0, 0, 14);
            paint(g, t.base, ol);
            dot(g, -4, 5, 4.4, t.light);
            break;
        }
    }
}

/** 单位脚下的椭圆阴影（两层，内深外浅） */
export function drawShadow(g: Graphics, width: number, alpha = 90): void {
    g.clear();
    const rx = width / 2;
    const ry = width / 7;
    g.fillColor = new Color(3, 7, 14, Math.round(alpha * 0.55));
    g.ellipse(0, 0, rx, ry);
    g.fill();
    g.fillColor = new Color(3, 7, 14, alpha);
    g.ellipse(0, 0, rx * 0.62, ry * 0.62);
    g.fill();
}

/**
 * 冲锋光环（静态图形，脉冲由 Unit 用 tick 驱动节点缩放/透明度，
 * 避免每个单位各挂一条循环补间 —— 美术原则 A5「单屏补间 ≤ 20」）
 */
export function drawChargeAura(g: Graphics, radius: number): void {
    g.clear();
    const gold = hex('#F59E0B', 225);
    const glow = hex('#FCD34D', 150);

    g.lineWidth = 3.4;
    g.strokeColor = gold;
    g.circle(0, 0, radius);
    g.stroke();

    g.lineWidth = 1.6;
    g.strokeColor = glow;
    g.circle(0, 0, radius * 0.74);
    g.stroke();

    // 环外 8 道小火焰（三角），增强「燃起来了」的观感
    g.fillColor = hex('#FBBF24', 200);
    for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
        const cx = Math.cos(a) * radius;
        const cy = Math.sin(a) * radius;
        const tx = Math.cos(a) * (radius + 9);
        const ty = Math.sin(a) * (radius + 9);
        const nx = -Math.sin(a) * 3;
        const ny = Math.cos(a) * 3;
        g.moveTo(cx + nx, cy + ny);
        g.lineTo(tx, ty);
        g.lineTo(cx - nx, cy - ny);
        g.close();
    }
    g.fill();
}

/** 机甲护盾泡（半透明能量外壳） */
export function drawShieldBubble(g: Graphics, radius: number): void {
    g.clear();
    g.fillColor = hex('#22D3EE', 30);
    g.circle(0, 0, radius);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = hex('#67E8F9', 190);
    g.circle(0, 0, radius);
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeColor = hex('#CFFAFE', 140);
    g.arc(0, 0, radius - 4, Math.PI * 0.55, Math.PI * 1.35, false);
    g.stroke();
}

/** 命中火花（四角星），由调用方缩放淡出 */
export function drawImpactSpark(g: Graphics, size = 9): void {
    g.clear();
    const s = size;
    const k = s * 0.3;
    g.fillColor = hex('#FFFFFF', 235);
    g.moveTo(0, s);
    g.lineTo(k, k);
    g.lineTo(s, 0);
    g.lineTo(k, -k);
    g.lineTo(0, -s);
    g.lineTo(-k, -k);
    g.lineTo(-s, 0);
    g.lineTo(-k, k);
    g.close();
    g.fill();
    g.fillColor = hex('#FDE68A', 200);
    g.circle(0, 0, s * 0.34);
    g.fill();
}

/** 猛犸践踏：厚土黄色冲击环 */
export function drawStompRing(g: Graphics, radius: number): void {
    g.clear();
    g.lineWidth = 7;
    g.strokeColor = hex('#E7C48A', 220);
    g.circle(0, 0, radius);
    g.stroke();
    g.lineWidth = 3;
    g.strokeColor = hex('#FFF3D6', 240);
    g.circle(0, 0, radius - 6);
    g.stroke();
}

/** 通用圆环（技能 / 命中用，调用方自行缩放淡出） */
export function drawRing(g: Graphics, radius: number, colorHex: string, width = 3, alpha = 220): void {
    g.clear();
    g.lineWidth = width;
    g.strokeColor = colorFromHex(colorHex, alpha);
    g.circle(0, 0, radius);
    g.stroke();
}

export function colorFromHex(hexStr: string, alpha = 255): Color {
    return hex(hexStr, alpha);
}
