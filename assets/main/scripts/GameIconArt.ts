/**
 * 游戏大厅图标：全部用 Graphics 现画，不依赖任何美术资源。
 *
 * 背景卡片是浅色（见 GameIcon 的 CARD_COLORS），所以图标统一用深墨色 + 一个高饱和强调色，
 * 保证 18 张卡片一眼可区分，且和别的游戏内 UI 的深色主题不冲突。
 *
 * 坐标：卡片局部坐标，卡片 150×180，原点在卡片中心；图标绘制区大致 x∈[-46,46]、y∈[-20,56]。
 */

import { Color, Graphics } from 'cc';

/** 图标墨色（与浅色卡片底对比足够） */
const INK = new Color(43, 53, 80, 255);
/** 浅色（用于反白细节） */
const PAPER = new Color(255, 249, 240, 255);

interface Accent {
    /** 主强调色 */
    main: Color;
    /** 次强调色（少量点缀） */
    soft: Color;
}

const ACCENTS: Record<string, Accent> = {
    '2048': { main: new Color(224, 122, 63, 255), soft: new Color(247, 196, 122, 255) },
    war_evo: { main: new Color(157, 23, 77, 255), soft: new Color(249, 168, 212, 255) },
    snake: { main: new Color(14, 159, 110, 255), soft: new Color(110, 231, 183, 255) },
    tiny_vanguard: { main: new Color(37, 99, 235, 255), soft: new Color(147, 197, 253, 255) },
    tetris: { main: new Color(124, 58, 237, 255), soft: new Color(196, 181, 253, 255) },
    brick: { main: new Color(217, 119, 6, 255), soft: new Color(252, 211, 77, 255) },
    merge: { main: new Color(219, 39, 119, 255), soft: new Color(249, 168, 212, 255) },
    gate_runner: { main: new Color(8, 145, 178, 255), soft: new Color(103, 232, 249, 255) },
    solitaire: { main: new Color(185, 28, 28, 255), soft: new Color(254, 202, 202, 255) },
    survivor: { main: new Color(124, 58, 237, 255), soft: new Color(216, 180, 254, 255) },
    minesweeper: { main: new Color(220, 38, 38, 255), soft: new Color(254, 202, 202, 255) },
    sudoku: { main: new Color(37, 99, 235, 255), soft: new Color(191, 219, 254, 255) },
    idiom: { main: new Color(180, 83, 9, 255), soft: new Color(253, 230, 138, 255) },
    gomoku: { main: new Color(31, 41, 55, 255), soft: new Color(148, 163, 184, 255) },
    idle: { main: new Color(5, 150, 105, 255), soft: new Color(167, 243, 208, 255) },
    match3: { main: new Color(219, 39, 119, 255), soft: new Color(45, 212, 191, 255) },
    tower_defense: { main: new Color(71, 85, 105, 255), soft: new Color(148, 163, 184, 255) },
    pool: { main: new Color(6, 95, 70, 255), soft: new Color(52, 211, 153, 255) },
    wordle: { main: new Color(202, 138, 4, 255), soft: new Color(253, 230, 138, 255) },
    bubble: { main: new Color(3, 105, 161, 255), soft: new Color(125, 211, 252, 255) },
    sokoban: { main: new Color(146, 64, 14, 255), soft: new Color(251, 146, 60, 255) },
    shmup: { main: new Color(99, 102, 241, 255), soft: new Color(165, 180, 252, 255) },
    thunder: { main: new Color(234, 179, 8, 255), soft: new Color(255, 237, 160, 255) },
    fridge: { main: new Color(13, 148, 136, 255), soft: new Color(153, 246, 228, 255) },
};

const DEFAULT_ACCENT: Accent = {
    main: new Color(37, 99, 235, 255),
    soft: new Color(147, 197, 253, 255),
};

function fill(g: Graphics, color: Color): void {
    g.fillColor = color;
    g.fill();
}

function stroke(g: Graphics, color: Color, width = 4): void {
    g.lineWidth = width;
    g.strokeColor = color;
    g.stroke();
}

/** 加粗线段（Graphics 的线宽在小尺寸下偏细，顺手包一层） */
function line(g: Graphics, x1: number, y1: number, x2: number, y2: number, color: Color, width = 5): void {
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    stroke(g, color, width);
}

function dot(g: Graphics, x: number, y: number, r: number, color: Color): void {
    g.circle(x, y, r);
    fill(g, color);
}

function square(g: Graphics, x: number, y: number, size: number, color: Color, radius = 4): void {
    g.roundRect(x - size / 2, y - size / 2, size, size, radius);
    fill(g, color);
}

function triangle(g: Graphics, pts: [number, number][], color: Color): void {
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.close();
    fill(g, color);
}

/** 画某个游戏的图标（不含卡片底） */
function drawShape(g: Graphics, id: string, accent: Accent): void {
    const main = accent.main;
    const soft = accent.soft;

    switch (id) {
        case '2048': {
            // 2×2 数字块，右下角一块高亮
            const pos: [number, number][] = [[-21, 21], [21, 21], [-21, -21], [21, -21]];
            for (let i = 0; i < 4; i++) {
                square(g, pos[i][0], pos[i][1] + 14, 34, i === 3 ? main : INK, 7);
            }
            square(g, 21, -7, 16, PAPER, 4);
            break;
        }
        case 'war_evo': {
            // 相对推进的两支箭头
            triangle(g, [[-40, 34], [-8, 12], [-40, -10]], INK);
            triangle(g, [[40, -34], [8, -12], [40, 10]], main);
            line(g, -40, 12, 40, -12, soft, 5);
            break;
        }
        case 'snake': {
            // 折线蛇身 + 蛇头
            const cells: [number, number][] = [
                [-27, 30], [-3, 30], [21, 30], [21, 8], [21, -14], [-3, -14], [-27, -14],
            ];
            for (let i = 0; i < cells.length - 1; i++) {
                square(g, cells[i][0], cells[i][1] + 14, 20, INK, 5);
            }
            square(g, cells[cells.length - 1][0], cells[cells.length - 1][1] + 14, 24, main, 8);
            dot(g, -31, 15, 3.5, PAPER);
            break;
        }
        case 'tiny_vanguard': {
            // 盾牌 + 内嵌菱形
            g.moveTo(0, 56);
            g.lineTo(32, 40);
            g.lineTo(32, 6);
            g.bezierCurveTo(32, -18, 14, -34, 0, -42);
            g.bezierCurveTo(-14, -34, -32, -18, -32, 6);
            g.lineTo(-32, 40);
            g.close();
            fill(g, INK);
            g.moveTo(0, 30);
            g.lineTo(16, 14);
            g.lineTo(0, -10);
            g.lineTo(-16, 14);
            g.close();
            fill(g, main);
            break;
        }
        case 'tetris': {
            // T 形方块 + 一颗下落的方块
            square(g, -22, 6, 22, INK, 4);
            square(g, 0, 6, 22, INK, 4);
            square(g, 22, 6, 22, INK, 4);
            square(g, 0, 28, 22, INK, 4);
            square(g, 26, 48, 20, main, 5);
            break;
        }
        case 'brick': {
            // 三排错缝砖 + 球
            const brick = (x: number, y: number, w: number) => {
                g.roundRect(x - w / 2, y - 7, w, 14, 3);
                fill(g, INK);
            };
            brick(-18, 38, 36);
            brick(20, 38, 32);
            brick(0, 18, 34);
            brick(30, 18, 26);
            brick(-30, 18, 26);
            brick(-18, -2, 34);
            brick(18, -2, 30);
            dot(g, 0, -32, 10, main);
            break;
        }
        case 'merge': {
            // 从小到大滚成三个球
            dot(g, -28, 0, 11, soft);
            dot(g, -4, 8, 16, main);
            dot(g, 24, 18, 22, INK);
            dot(g, 17, 26, 5, PAPER);
            break;
        }
        case 'gate_runner': {
            // 数值门 + 穿过它的箭头
            g.roundRect(-38, -4, 11, 56, 5);
            fill(g, INK);
            g.roundRect(27, -4, 11, 56, 5);
            fill(g, INK);
            g.roundRect(-38, 44, 76, 11, 5);
            fill(g, INK);
            line(g, -44, 20, 20, 20, main, 7);
            triangle(g, [[22, 32], [44, 20], [22, 8]], main);
            break;
        }
        case 'solitaire': {
            // 两张叠放的纸牌，前面一张带红桃
            g.roundRect(-32, -34, 44, 60, 6);
            fill(g, INK);
            g.roundRect(-14, -24, 46, 62, 6);
            fill(g, PAPER);
            g.roundRect(-14, -24, 46, 62, 6);
            stroke(g, INK, 3);
            // 菱形花色
            g.moveTo(9, 24);
            g.lineTo(22, 10);
            g.lineTo(9, -4);
            g.lineTo(-4, 10);
            g.close();
            fill(g, main);
            break;
        }
        case 'survivor': {
            // 准星
            g.circle(0, 12, 28);
            stroke(g, INK, 5);
            line(g, -42, 12, -18, 12, INK, 5);
            line(g, 18, 12, 42, 12, INK, 5);
            line(g, 0, 54, 0, 34, INK, 5);
            line(g, 0, -10, 0, -30, INK, 5);
            dot(g, 0, 12, 7, main);
            break;
        }
        case 'minesweeper': {
            // 小旗
            line(g, -8, -28, -8, 40, INK, 5);
            triangle(g, [[-6, 38], [30, 24], [-6, 10]], main);
            g.roundRect(-28, -36, 44, 10, 4);
            fill(g, INK);
            break;
        }
        case 'sudoku': {
            // 九宫格 + 几个已填格子
            g.roundRect(-38, -30, 76, 76, 6);
            stroke(g, INK, 4);
            for (let i = 1; i < 3; i++) {
                line(g, -38 + (76 / 3) * i, -30, -38 + (76 / 3) * i, 46, INK, 2);
                line(g, -38, -30 + (76 / 3) * i, 38, -30 + (76 / 3) * i, INK, 2);
            }
            square(g, -25, 33, 14, INK, 2);
            square(g, 0, 8, 14, main, 2);
            square(g, 25, -17, 14, INK, 2);
            break;
        }
        case 'idiom': {
            // 十字填字格
            const cells: [number, number][] = [[-32, 14], [0, 14], [32, 14], [0, 44], [0, -16]];
            for (const [x, y] of cells) {
                g.roundRect(x - 15, y - 15, 30, 30, 4);
                fill(g, x === 32 ? main : INK);
            }
            break;
        }
        case 'gomoku': {
            // 棋盘 + 斜向五连
            g.roundRect(-38, -30, 76, 76, 6);
            stroke(g, INK, 3);
            for (let i = 1; i < 4; i++) {
                line(g, -38 + 19 * i, -30, -38 + 19 * i, 46, INK, 1.5);
                line(g, -38, -30 + 19 * i, 38, -30 + 19 * i, INK, 1.5);
            }
            for (let i = 0; i < 5; i++) {
                dot(g, -38 + 19 * i + 9.5, -2 + 19 * i - 9.5, 6, i === 4 ? main : INK);
            }
            break;
        }
        case 'idle': {
            // 店铺：条纹雨棚 + 门
            g.roundRect(-36, -34, 72, 52, 5);
            fill(g, INK);
            for (let i = 0; i < 4; i++) {
                g.roundRect(-38 + i * 19, 24, 17, 18, 3);
                fill(g, i % 2 === 0 ? main : soft);
            }
            g.roundRect(-14, -34, 20, 30, 3);
            fill(g, PAPER);
            break;
        }
        case 'match3': {
            // 三种不同形状的宝石
            dot(g, -26, 18, 15, main);
            g.moveTo(2, 34);
            g.lineTo(18, 18);
            g.lineTo(2, 2);
            g.lineTo(-14, 18);
            g.close();
            fill(g, INK);
            triangle(g, [[24, 36], [42, 2], [6, 2]], soft);
            break;
        }
        case 'tower_defense': {
            // 城垛塔楼 + 旗
            g.roundRect(-30, -38, 60, 58, 4);
            fill(g, INK);
            for (let i = 0; i < 3; i++) {
                g.roundRect(-30 + i * 23, 20, 15, 12, 2);
                fill(g, INK);
            }
            g.roundRect(-14, -18, 28, 22, 3);
            fill(g, soft);
            line(g, 0, 32, 0, 56, INK, 4);
            triangle(g, [[2, 54], [26, 46], [2, 38]], main);
            break;
        }
        case 'pool': {
            // 三角球架 + 三颗球
            g.moveTo(0, 54);
            g.lineTo(40, -28);
            g.lineTo(-40, -28);
            g.close();
            stroke(g, INK, 4);
            dot(g, 0, 38, 9, main);
            dot(g, -12, 14, 9, INK);
            dot(g, 12, 14, 9, PAPER);
            g.circle(12, 14, 9);
            stroke(g, INK, 2);
            dot(g, 0, -8, 9, soft);
            break;
        }
        case 'wordle': {
            // 四格猜字：一绿（位置对）一黄（字对位不对）+ 下方输入行
            const row: [number, Color][] = [[-39, main], [-13, soft], [13, INK], [39, INK]];
            for (const [x, c] of row) square(g, x, 32, 26, c, 5);
            for (let i = 0; i < 3; i++) square(g, -30 + i * 23, -6, 19, i === 0 ? soft : INK, 4);
            g.roundRect(9, -16, 33, 20, 5);
            fill(g, main);
            break;
        }
        case 'bubble': {
            // 一串同色泡泡 + 向上发射的炮口
            dot(g, -20, 38, 14, main);
            dot(g, 11, 44, 12, INK);
            dot(g, 37, 30, 10, soft);
            dot(g, -35, 14, 9, soft);
            dot(g, -2, 16, 13, INK);
            triangle(g, [[0, 0], [-15, -30], [15, -30]], main);
            line(g, 0, -2, 0, 10, INK, 5);
            break;
        }
        case 'sokoban': {
            // 木箱（打叉）+ 目标格
            g.roundRect(-44, -30, 36, 36, 5);
            stroke(g, soft, 4);
            g.roundRect(-6, 8, 46, 46, 5);
            fill(g, INK);
            line(g, -1, 13, 35, 49, PAPER, 4);
            line(g, 35, 13, -1, 49, PAPER, 4);
            // 推箱的小人
            dot(g, -26, -16, 6, INK);
            triangle(g, [[-34, -26], [-18, -26], [-26, -6]], INK);
            break;
        }
        case 'shmup': {
            // 战机 + 两路弹幕 + 敌弹
            triangle(g, [[0, 22], [-16, -6], [16, -6]], main);
            triangle(g, [[0, -8], [-40, -30], [-6, -25]], INK);
            triangle(g, [[0, -8], [40, -30], [6, -25]], INK);
            dot(g, 0, 6, 5, PAPER);
            dot(g, -10, 40, 4, soft);
            dot(g, 10, 40, 4, soft);
            dot(g, 0, 52, 4, soft);
            dot(g, -32, 44, 4, INK);
            dot(g, 32, 44, 4, INK);
            break;
        }
        case 'thunder': {
            // 闪电 + 机翼
            triangle(g, [[-38, -34], [0, -14], [38, -34]], INK);
            g.moveTo(10, 56);
            g.lineTo(-16, 14);
            g.lineTo(2, 14);
            g.lineTo(-8, -24);
            g.lineTo(22, 20);
            g.lineTo(2, 20);
            g.close();
            fill(g, main);
            dot(g, -30, 34, 5, soft);
            dot(g, 30, 30, 4, soft);
            break;
        }
        case 'fridge': {
            // 冰箱：上下两门 + 把手，底部一条透光的缝
            g.roundRect(-30, -30, 60, 84, 8);
            fill(g, INK);
            line(g, -30, 12, 30, 12, PAPER, 3);
            g.roundRect(16, 22, 7, 16, 3);
            fill(g, soft);
            g.roundRect(16, -8, 7, 16, 3);
            fill(g, soft);
            g.roundRect(-34, -40, 68, 10, 5);
            fill(g, soft);
            break;
        }
        default: {
            // 兜底：一个问号形状的圆点阵
            dot(g, 0, 30, 26, INK);
            dot(g, 0, -12, 9, main);
            break;
        }
    }
}

/** 画整张卡片（卡片底 + 图标），并返回是否绘制成功 */
export function drawGameIconArt(g: Graphics, id: string, cardColor: Color, width = 150, height = 180): void {
    g.clear();

    // 卡片底：浅色圆角块 + 一圈更浅的高光边
    g.roundRect(-width / 2, -height / 2, width, height, 22);
    fill(g, cardColor);
    g.roundRect(-width / 2 + 1.5, -height / 2 + 1.5, width - 3, height - 3, 21);
    stroke(g, new Color(255, 255, 255, 90), 1.5);

    const accent = ACCENTS[id] || DEFAULT_ACCENT;
    drawShape(g, id, accent);
}
