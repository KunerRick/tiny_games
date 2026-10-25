/**
 * 方块坠落 — 图标绘制：手势/按键图示全部用 `Graphics` 画。
 *
 * **不用 emoji**：变体选择符（U+FE0E / U+FE0F）在微信字体下会渲染成方框，
 * 桌面预览看不出来（红线 10）。图形只在刷新时重画，不进 update。
 */

import { Color, Graphics, Node } from 'cc';

export type IconKind =
    | 'harrow' // 左右双向箭头
    | 'harrowhold' // 左右箭头 + 长按条
    | 'tap' // 轻点：实心圆 + 外圈
    | 'rotate' // 顺时针旋转：圆弧 + 箭头
    | 'down' // 向下箭头
    | 'fastdown' // 双下箭头（快速下甩）
    | 'twodots'; // 双指点按

/** 箭头两翼长度 */
const HEAD = 8;

export function drawIcon(node: Node | null, kind: IconKind, color: Color, lineWidth = 3): void {
    if (!node || !node.isValid) return;

    let graphics = node.getComponent(Graphics);
    if (!graphics) {
        graphics = node.addComponent(Graphics);
    }

    graphics.clear();
    graphics.lineWidth = lineWidth;
    graphics.strokeColor = color;
    graphics.fillColor = color;

    switch (kind) {
        case 'harrow':
            drawHorizontalArrow(graphics, 0, 22);
            break;

        case 'harrowhold':
            drawHorizontalArrow(graphics, 8, 21);
            graphics.lineWidth = 6;
            graphics.moveTo(-15, -12);
            graphics.lineTo(15, -12);
            graphics.stroke();
            break;

        case 'tap':
            graphics.circle(0, 0, 13);
            graphics.stroke();
            graphics.circle(0, 0, 5);
            graphics.fill();
            break;

        case 'rotate': {
            // 顺时针旋转：缺口在正上方偏右的圆环 + **实心**三角箭头。
            // 原先用细弧 + 两条箭头翼，指点大小（30 设计 px）下两翼糊成一团，
            // 远看像一撇逗号，完全读不出「旋转」——实心三角在小尺寸下才立得住。
            const radius = 16;
            const start = (Math.PI * 2) / 3; // 120°
            const end = start + Math.PI * 1.6; // 408°（回到 48°）：缺口 72°
            graphics.lineWidth = 3.6; // 这一枚是曲线，比直线箭头再粗一点才同样醒目
            graphics.arc(0, 0, radius, start, end, false);
            graphics.stroke();

            const px = Math.cos(end) * radius;
            const py = Math.sin(end) * radius;
            // 顺时针切向（角度递减方向）及其法线
            const tx = Math.sin(end);
            const ty = -Math.cos(end);
            const nx = Math.cos(end);
            const ny = Math.sin(end);
            const len = 10;
            const half = 6;
            graphics.fillColor = color;
            graphics.moveTo(px + tx * len, py + ty * len);
            graphics.lineTo(px - tx * len * 0.35 + nx * half, py - ty * len * 0.35 + ny * half);
            graphics.lineTo(px - tx * len * 0.35 - nx * half, py - ty * len * 0.35 - ny * half);
            graphics.close();
            graphics.fill();
            break;
        }

        case 'down':
            drawDownArrow(graphics, 17, -15);
            break;

        case 'fastdown':
            // 两根箭头必须**上下错开且不首尾相接**：原来一根 20→2、一根 2→-16，
            // 尾首相接后描边叠成一条长竖线，在 30px 的图标框里读起来和单箭头没区别。
            drawDownArrow(graphics, 15, 3);
            drawDownArrow(graphics, 1, -11);
            break;

        case 'twodots':
            graphics.circle(-9, 0, 5);
            graphics.fill();
            graphics.circle(9, 0, 5);
            graphics.fill();
            break;
    }
}

function drawHorizontalArrow(g: Graphics, y: number, half: number): void {
    g.moveTo(-half, y);
    g.lineTo(half, y);

    g.moveTo(-half, y);
    g.lineTo(-half + HEAD, y + HEAD * 0.85);
    g.moveTo(-half, y);
    g.lineTo(-half + HEAD, y - HEAD * 0.85);

    g.moveTo(half, y);
    g.lineTo(half - HEAD, y + HEAD * 0.85);
    g.moveTo(half, y);
    g.lineTo(half - HEAD, y - HEAD * 0.85);
    g.stroke();
}

function drawDownArrow(g: Graphics, top: number, bottom: number): void {
    g.moveTo(0, top);
    g.lineTo(0, bottom);
    g.moveTo(0, bottom);
    g.lineTo(-HEAD, bottom + HEAD);
    g.moveTo(0, bottom);
    g.lineTo(HEAD, bottom + HEAD);
    g.stroke();
}
