/**
 * 《秘银远征》单位美术 —— 全部用 Graphics 程序化绘制，零贴图。
 *
 * 每个函数都假设调用方已经 `clear()`，坐标是**核心场坐标**（左下原点），
 * 由渲染层统一做 `x-360 / y-640` 的偏移。颜色只在本文件定义，渲染层不写魔法 RGB。
 *
 * 风格与大厅 / 冰箱保持一致：粗轮廓 + 双色块 + 一个高光点，不做细腻渐变。
 */

import { Color, Graphics } from 'cc';

/** 颜色缓存：每帧上百次绘制不能反复 new Color（微信小游戏 GC 压力） */
const colorCache: Record<string, Color> = {};
function C(hexColor: string): Color {
    let c = colorCache[hexColor];
    if (!c) {
        c = new Color();
        c.fromHEX(hexColor);
        colorCache[hexColor] = c;
    }
    return c;
}

export const MITH_PAL = {
    /** 矿坑地面 / 岩壁 */
    floor: '#141A22',
    floorAlt: '#11161D',
    grid: '#1E2733',
    rail: '#2A3546',
    railTie: '#384457',
    rock: '#2B3441',
    rockLight: '#3C4859',
    /** 战士板甲 */
    plate: '#7C8FA8',
    plateDark: '#4E5D72',
    plateLight: '#B8C6D8',
    cloth: '#8E3B3B',
    sword: '#D6DEE9',
    swordEdge: '#F4F8FC',
    skin: '#E8C39E',
    /** 敌人 */
    imp: '#E06A3B',
    impDark: '#A24322',
    miner: '#9A7B52',
    minerDark: '#6B5335',
    helmet: '#E0B24A',
    wraith: '#9B6BE0',
    wraithDark: '#5C3E96',
    golem: '#8A8F99',
    golemDark: '#5A5F68',
    golemCrack: '#E0B24A',
    troll: '#5F8C4A',
    trollDark: '#3A5C2C',
    trollBelly: '#A9B87A',
    horn: '#D9C8A0',
    /** 通用 */
    hpBack: '#000000',
    hp: '#D94B4B',
    hpElite: '#F0A23B',
    hpBoss: '#B44BE0',
    white: '#FFFFFF',
    black: '#000000',
    orb: '#4ADE80',
    orbCore: '#D9FBE5',
    boulder: '#8C6A46',
    bolt: '#C084FC',
    telegraph: '#EF4444',
    telegraphBoss: '#B44BE0',
    shadow: '#000000',
} as const;

export interface WarriorLook {
    invuln: boolean;
    burst: boolean;
    whirlwind: boolean;
    hitFlash: number;
}

/** 战士：宽肩板甲 + 大剑。facing 为弧度（0 = 右，π/2 = 上）。 */
export function drawWarrior(
    g: Graphics,
    x: number,
    y: number,
    facing: number,
    time: number,
    look: WarriorLook,
): void {
    const breath = Math.sin(time * 5) * 1.2;
    // 影子
    g.fillColor = C(MITH_PAL.shadow + '66');
    g.ellipse(x, y - 15, 18, 8);
    g.fill();

    // 旋风斩：外圈残影
    if (look.whirlwind) {
        g.strokeColor = C('#93C5FD');
        g.lineWidth = 3;
        g.arc(x, y, 46 + Math.sin(time * 18) * 4, time * 12, time * 12 + Math.PI * 1.4, false);
        g.stroke();
    }
    // 血怒：红色气场
    if (look.burst) {
        g.strokeColor = C('#EF4444');
        g.lineWidth = 2;
        g.circle(x, y, 34 + Math.sin(time * 9) * 3);
        g.stroke();
    }

    // 无敌帧闪烁（每 0.1s 一档）
    const blink = look.invuln && Math.floor(time * 10) % 2 === 0;

    // 披风（朝向反方向）
    const backX = x - Math.cos(facing) * 12;
    const backY = y - Math.sin(facing) * 12;
    g.fillColor = C(MITH_PAL.cloth);
    g.moveTo(backX + Math.cos(facing + Math.PI / 2) * 12, backY + Math.sin(facing + Math.PI / 2) * 12);
    g.lineTo(backX + Math.cos(facing + Math.PI / 2) * 12 - Math.cos(facing) * 12, backY + Math.sin(facing + Math.PI / 2) * 12 - Math.sin(facing) * 12);
    g.lineTo(backX - Math.cos(facing + Math.PI / 2) * 12 - Math.cos(facing) * 12, backY - Math.sin(facing + Math.PI / 2) * 12 - Math.sin(facing) * 12);
    g.lineTo(backX - Math.cos(facing + Math.PI / 2) * 12, backY - Math.sin(facing + Math.PI / 2) * 12);
    g.close();
    g.fill();

    // 躯干
    g.fillColor = C(blink ? MITH_PAL.plateLight : MITH_PAL.plate);
    g.roundRect(x - 11, y - 12 + breath * 0.2, 22, 24, 7);
    g.fill();
    // 肩甲
    g.fillColor = C(MITH_PAL.plateLight);
    g.circle(x - 10, y + 8, 6);
    g.fill();
    g.circle(x + 10, y + 8, 6);
    g.fill();
    // 腰带
    g.fillColor = C(MITH_PAL.plateDark);
    g.rect(x - 11, y - 6, 22, 4);
    g.fill();
    // 头盔
    g.fillColor = C(blink ? MITH_PAL.plateLight : MITH_PAL.plateDark);
    g.circle(x, y + 16, 8);
    g.fill();
    // 目缝朝向
    g.strokeColor = C(MITH_PAL.black);
    g.lineWidth = 2;
    g.moveTo(x + Math.cos(facing) * 2 - 3, y + 16 + Math.sin(facing) * 2);
    g.lineTo(x + Math.cos(facing) * 2 + 3, y + 16 + Math.sin(facing) * 2);
    g.stroke();

    // 大剑：从手部沿朝向伸出
    const hx = x + Math.cos(facing) * 12;
    const hy = y + Math.sin(facing) * 6;
    const tipX = hx + Math.cos(facing) * 34;
    const tipY = hy + Math.sin(facing) * 34;
    const nx = Math.cos(facing + Math.PI / 2);
    const ny = Math.sin(facing + Math.PI / 2);
    g.fillColor = C(MITH_PAL.sword);
    g.moveTo(hx + nx * 3, hy + ny * 3);
    g.lineTo(tipX + nx * 1.5, tipY + ny * 1.5);
    g.lineTo(tipX - nx * 1.5, tipY - ny * 1.5);
    g.lineTo(hx - nx * 3, hy - ny * 3);
    g.close();
    g.fill();
    // 剑刃高光
    g.strokeColor = C(MITH_PAL.swordEdge);
    g.lineWidth = 1.5;
    g.moveTo(hx + nx * 1.2, hy + ny * 1.2);
    g.lineTo(tipX + nx * 0.5, tipY + ny * 0.5);
    g.stroke();
    // 护手
    g.strokeColor = C(MITH_PAL.helmet);
    g.lineWidth = 3;
    g.moveTo(hx + nx * 6, hy + ny * 6);
    g.lineTo(hx - nx * 6, hy - ny * 6);
    g.stroke();
}

function drawEyes(g: Graphics, x: number, y: number, color: string, spread = 4, r = 1.6): void {
    g.fillColor = C(color);
    g.circle(x - spread, y, r);
    g.fill();
    g.circle(x + spread, y, r);
    g.fill();
}

export function drawImp(g: Graphics, x: number, y: number, time: number): void {
    const bob = Math.sin(time * 8 + x) * 1.5;
    const cy = y + bob;
    g.fillColor = C(MITH_PAL.shadow + '55');
    g.ellipse(x, y - 12, 12, 5);
    g.fill();
    // 身体菱形
    g.fillColor = C(MITH_PAL.imp);
    g.moveTo(x, cy + 11);
    g.lineTo(x + 12, cy);
    g.lineTo(x, cy - 11);
    g.lineTo(x - 12, cy);
    g.close();
    g.fill();
    // 腹部暗色
    g.fillColor = C(MITH_PAL.impDark);
    g.moveTo(x, cy + 4);
    g.lineTo(x + 5, cy);
    g.lineTo(x, cy - 4);
    g.lineTo(x - 5, cy);
    g.close();
    g.fill();
    // 角
    g.strokeColor = C(MITH_PAL.horn);
    g.lineWidth = 2;
    g.moveTo(x - 7, cy + 8);
    g.lineTo(x - 10, cy + 14);
    g.moveTo(x + 7, cy + 8);
    g.lineTo(x + 10, cy + 14);
    g.stroke();
    drawEyes(g, x, cy + 2, MITH_PAL.white, 4, 1.8);
}

export function drawMiner(g: Graphics, x: number, y: number, time: number): void {
    const bob = Math.sin(time * 6 + x) * 1.2;
    const cy = y + bob;
    g.fillColor = C(MITH_PAL.shadow + '55');
    g.ellipse(x, y - 14, 14, 5);
    g.fill();
    g.fillColor = C(MITH_PAL.miner);
    g.roundRect(x - 10, cy - 12, 20, 22, 5);
    g.fill();
    g.fillColor = C(MITH_PAL.minerDark);
    g.rect(x - 10, cy - 8, 20, 4);
    g.fill();
    // 头盔
    g.fillColor = C(MITH_PAL.helmet);
    g.arc(x, cy + 12, 9, 0, Math.PI, false);
    g.fill();
    g.fillColor = C(MITH_PAL.minerDark);
    g.rect(x - 11, cy + 10, 22, 3);
    g.fill();
    // 镐
    g.strokeColor = C(MITH_PAL.rockLight);
    g.lineWidth = 2.5;
    g.moveTo(x + 11, cy - 10);
    g.lineTo(x + 18, cy + 12);
    g.stroke();
    g.strokeColor = C(MITH_PAL.helmet);
    g.lineWidth = 2;
    g.moveTo(x + 13, cy + 12);
    g.lineTo(x + 23, cy + 9);
    g.stroke();
    drawEyes(g, x, cy + 3, MITH_PAL.black, 4, 1.5);
}

export function drawWraith(g: Graphics, x: number, y: number, time: number): void {
    const float = Math.sin(time * 3 + x) * 4;
    const cy = y + float;
    g.fillColor = C(MITH_PAL.shadow + '44');
    g.ellipse(x, y - 16, 15, 5);
    g.fill();
    // 斗篷
    g.fillColor = C(MITH_PAL.wraithDark + 'CC');
    g.moveTo(x, cy + 20);
    g.lineTo(x + 15, cy + 2);
    g.lineTo(x + 9, cy - 16);
    g.lineTo(x + 2, cy - 10);
    g.lineTo(x - 3, cy - 17);
    g.lineTo(x - 10, cy - 9);
    g.lineTo(x - 15, cy + 2);
    g.close();
    g.fill();
    g.fillColor = C(MITH_PAL.wraith + 'AA');
    g.moveTo(x, cy + 16);
    g.lineTo(x + 10, cy + 2);
    g.lineTo(x + 5, cy - 10);
    g.lineTo(x - 5, cy - 10);
    g.lineTo(x - 10, cy + 2);
    g.close();
    g.fill();
    // 兜帽里的眼睛
    g.fillColor = C(MITH_PAL.white);
    g.circle(x - 4, cy + 7, 1.8);
    g.fill();
    g.circle(x + 4, cy + 7, 1.8);
    g.fill();
}

export function drawGolem(g: Graphics, x: number, y: number, time: number): void {
    const stomp = Math.sin(time * 2 + x) * 1.5;
    const cy = y + stomp;
    g.fillColor = C(MITH_PAL.shadow + '66');
    g.ellipse(x, y - 24, 24, 7);
    g.fill();
    // 碎石身体
    g.fillColor = C(MITH_PAL.golem);
    g.moveTo(x - 18, cy + 4);
    g.lineTo(x - 12, cy + 20);
    g.lineTo(x + 6, cy + 24);
    g.lineTo(x + 20, cy + 10);
    g.lineTo(x + 16, cy - 8);
    g.lineTo(x + 2, cy - 22);
    g.lineTo(x - 14, cy - 14);
    g.close();
    g.fill();
    // 暗面
    g.fillColor = C(MITH_PAL.golemDark);
    g.moveTo(x - 18, cy + 4);
    g.lineTo(x - 14, cy - 14);
    g.lineTo(x + 2, cy - 22);
    g.lineTo(x + 4, cy - 4);
    g.close();
    g.fill();
    // 裂纹发光
    g.strokeColor = C(MITH_PAL.golemCrack);
    g.lineWidth = 2;
    g.moveTo(x - 4, cy + 18);
    g.lineTo(x + 2, cy + 8);
    g.lineTo(x - 2, cy + 2);
    g.lineTo(x + 6, cy - 8);
    g.stroke();
    // 眼睛
    g.fillColor = C(MITH_PAL.golemCrack);
    g.circle(x - 5, cy + 10, 2.4);
    g.fill();
    g.circle(x + 5, cy + 10, 2.4);
    g.fill();
    // 手臂
    g.fillColor = C(MITH_PAL.golemDark);
    g.circle(x - 20, cy + 2, 7);
    g.fill();
    g.circle(x + 21, cy + 2, 7);
    g.fill();
}

/** 矿坑巨魔：宽体 + 双角 + 木棒，体型约 44 半径。 */
export function drawTroll(g: Graphics, x: number, y: number, time: number, enraged: boolean): void {
    const breathe = Math.sin(time * 2.4) * 2;
    const cy = y + breathe;
    g.fillColor = C(MITH_PAL.shadow + '77');
    g.ellipse(x, y - 36, 42, 11);
    g.fill();

    // 腿
    g.fillColor = C(MITH_PAL.trollDark);
    g.roundRect(x - 26, cy - 36, 18, 22, 7);
    g.fill();
    g.roundRect(x + 8, cy - 36, 18, 22, 7);
    g.fill();

    // 身体
    g.fillColor = C(enraged ? '#7A3C2E' : MITH_PAL.troll);
    g.ellipse(x, cy - 4, 36, 30);
    g.fill();
    // 肚皮
    g.fillColor = C(MITH_PAL.trollBelly);
    g.ellipse(x, cy - 8, 22, 18);
    g.fill();
    // 肩
    g.fillColor = C(MITH_PAL.trollDark);
    g.circle(x - 30, cy + 12, 12);
    g.fill();
    g.circle(x + 30, cy + 12, 12);
    g.fill();
    // 头
    g.fillColor = C(enraged ? '#8A4A37' : MITH_PAL.troll);
    g.circle(x, cy + 24, 17);
    g.fill();
    // 角
    g.strokeColor = C(MITH_PAL.horn);
    g.lineWidth = 5;
    g.moveTo(x - 12, cy + 34);
    g.lineTo(x - 25, cy + 48);
    g.moveTo(x + 12, cy + 34);
    g.lineTo(x + 25, cy + 48);
    g.stroke();
    // 眼睛
    g.fillColor = C(enraged ? '#FF3B30' : '#F2D14E');
    g.circle(x - 6, cy + 26, 3.2);
    g.fill();
    g.circle(x + 6, cy + 26, 3.2);
    g.fill();
    // 獠牙
    g.fillColor = C(MITH_PAL.white);
    g.moveTo(x - 7, cy + 17);
    g.lineTo(x - 4, cy + 10);
    g.lineTo(x - 2, cy + 17);
    g.close();
    g.fill();
    g.moveTo(x + 7, cy + 17);
    g.lineTo(x + 4, cy + 10);
    g.lineTo(x + 2, cy + 17);
    g.close();
    g.fill();
    // 木棒
    g.strokeColor = C('#6B4B2A');
    g.lineWidth = 8;
    g.moveTo(x + 31, cy - 6);
    g.lineTo(x + 50, cy + 28);
    g.stroke();
    g.fillColor = C('#8A6438');
    g.circle(x + 52, cy + 32, 12);
    g.fill();
    g.strokeColor = C('#4A321C');
    g.lineWidth = 2;
    g.circle(x + 52, cy + 32, 12);
    g.stroke();
}

/** 血球：发光圆 + 十字 */
export function drawOrb(g: Graphics, x: number, y: number, time: number): void {
    const pulse = 1 + Math.sin(time * 6 + x) * 0.12;
    g.fillColor = C(MITH_PAL.orb + '33');
    g.circle(x, y, 14 * pulse);
    g.fill();
    g.fillColor = C(MITH_PAL.orb);
    g.circle(x, y, 7);
    g.fill();
    g.fillColor = C(MITH_PAL.orbCore);
    g.rect(x - 1.5, y - 4, 3, 8);
    g.fill();
    g.rect(x - 4, y - 1.5, 8, 3);
    g.fill();
}

/** 敌人血条（Boss 由 HUD 画，不走这里） */
export function drawEnemyBar(
    g: Graphics,
    x: number,
    y: number,
    width: number,
    ratio: number,
    color: string,
): void {
    const h = 5;
    g.fillColor = C(MITH_PAL.black + '99');
    g.rect(x - width / 2, y, width, h);
    g.fill();
    const w = Math.max(0, Math.min(1, ratio)) * width;
    if (w > 0) {
        g.fillColor = C(color);
        g.rect(x - width / 2, y, w, h);
        g.fill();
    }
}
