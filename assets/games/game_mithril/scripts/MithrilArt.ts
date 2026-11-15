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

/** 带透明度的临时色（不能改缓存色的 a —— Color.a 在 3.8 类型里是只读的） */
function CA(hexColor: string, alpha: number): Color {
    const base = C(hexColor);
    const c = new Color();
    c.set(base.r, base.g, base.b, Math.max(0, Math.min(255, Math.round(alpha))));
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

const CLASS_LOOK: Record<string, { robe: string; trim: string; glow: string }> = {
    mage: { robe: '#334E8C', trim: '#60A5FA', glow: '#93C5FD' },
    ranger: { robe: '#2C5C46', trim: '#34D399', glow: '#A7F3D0' },
    priest: { robe: '#7A5B24', trim: '#FBBF24', glow: '#FDE68A' },
};

/** 法系 / 远程玩家：长袍 + 职业武器（法杖 / 弓 / 圣杖）。比例与战士一致（肩宽 22、身高 40）。 */
function drawCaster(
    g: Graphics,
    x: number,
    y: number,
    facing: number,
    time: number,
    look: WarriorLook,
    classId: string,
): void {
    const pal = CLASS_LOOK[classId] || CLASS_LOOK.mage;
    const breath = Math.sin(time * 5) * 1.2;
    const blink = look.invuln && Math.floor(time * 10) % 2 === 0;

    g.fillColor = C(MITH_PAL.shadow + '66');
    g.ellipse(x, y - 16, 16, 7);
    g.fill();

    if (look.burst) {
        g.strokeColor = C(pal.glow);
        g.lineWidth = 2;
        g.circle(x, y, 34 + Math.sin(time * 9) * 3);
        g.stroke();
    }

    // 长袍（下摆比肩宽）
    g.fillColor = C(blink ? pal.glow : pal.robe);
    g.moveTo(x - 10, y + 8 + breath * 0.2);
    g.lineTo(x + 10, y + 8 + breath * 0.2);
    g.lineTo(x + 16, y - 20);
    g.lineTo(x - 16, y - 20);
    g.close();
    g.fill();
    // 腰带与领口
    g.fillColor = C(pal.trim);
    g.rect(x - 11, y - 2, 22, 4);
    g.fill();
    g.moveTo(x - 8, y + 8);
    g.lineTo(x, y + 2);
    g.lineTo(x + 8, y + 8);
    g.close();
    g.fill();

    // 兜帽 + 脸
    g.fillColor = C(pal.trim);
    g.circle(x, y + 15, 9 + breath * 0.15);
    g.fill();
    g.fillColor = C(blink ? '#FFFFFF' : MITH_PAL.skin);
    g.circle(x + Math.cos(facing) * 1.5, y + 14, 5.5);
    g.fill();
    drawEyes(g, x + Math.cos(facing) * 1.5, y + 14, MITH_PAL.black, 2.4, 1.1);

    // 武器沿朝向伸出
    const hx = x + Math.cos(facing) * 11;
    const hy = y + Math.sin(facing) * 5;
    const tipX = hx + Math.cos(facing) * 22;
    const tipY = hy + Math.sin(facing) * 22;
    if (classId === 'ranger') {
        // 弓：以朝向前方 10px 为圆心的一段弧 + 弦
        const cx = x + Math.cos(facing) * 14;
        const cy = y + Math.sin(facing) * 10;
        g.strokeColor = C('#8B5A2B');
        g.lineWidth = 3;
        g.arc(cx, cy, 15, facing - 1.1, facing + 1.1, false);
        g.stroke();
        g.strokeColor = C(pal.glow);
        g.lineWidth = 1;
        g.moveTo(cx + Math.cos(facing - 1.1) * 15, cy + Math.sin(facing - 1.1) * 15);
        g.lineTo(cx + Math.cos(facing + 1.1) * 15, cy + Math.sin(facing + 1.1) * 15);
        g.stroke();
    } else {
        // 法杖 / 圣杖
        g.strokeColor = C('#6B4A2A');
        g.lineWidth = 3;
        g.moveTo(hx, hy);
        g.lineTo(tipX, tipY);
        g.stroke();
        if (classId === 'priest') {
            g.fillColor = C(pal.glow);
            const nx = Math.cos(facing + Math.PI / 2);
            const ny = Math.sin(facing + Math.PI / 2);
            g.rect(tipX - 1.5, tipY - 1.5, 3, 3);
            g.fill();
            g.strokeColor = C(pal.glow);
            g.lineWidth = 2.5;
            g.moveTo(tipX + nx * 5, tipY + ny * 5);
            g.lineTo(tipX - nx * 5, tipY - ny * 5);
            g.stroke();
        } else {
            g.fillColor = C(pal.glow);
            g.circle(tipX, tipY, 5);
            g.fill();
            g.fillColor = C('#FFFFFF');
            g.circle(tipX, tipY, 2);
            g.fill();
        }
    }
}

/** 玩家按职业绘制（渲染层只认 classId，不关心具体画法） */
export function drawClassPlayer(
    g: Graphics,
    x: number,
    y: number,
    facing: number,
    time: number,
    look: WarriorLook,
    classId: string,
): void {
    if (!classId || classId === 'warrior') drawWarrior(g, x, y, facing, time, look);
    else drawCaster(g, x, y, facing, time, look, classId);
}

/** 游侠冰霜陷阱：冰蓝圆环 + 放射冰刺，剩余时间越短越淡 */
export function drawTrap(g: Graphics, x: number, y: number, radius: number, ratio: number, time: number): void {
    const a = Math.round(90 + 150 * Math.max(0, Math.min(1, ratio)));
    g.fillColor = CA('#0EA5E9', a * 0.25);
    g.circle(x, y, radius);
    g.fill();
    g.strokeColor = CA('#7DD3FC', a);
    g.lineWidth = 2;
    g.circle(x, y, radius * (0.9 + Math.sin(time * 3) * 0.04));
    g.stroke();
    for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * 2 * i) / 6;
        g.strokeColor = CA('#BAE6FD', a);
        g.lineWidth = 1.5;
        g.moveTo(x + Math.cos(ang) * radius * 0.35, y + Math.sin(ang) * radius * 0.35);
        g.lineTo(x + Math.cos(ang) * radius * 0.85, y + Math.sin(ang) * radius * 0.85);
        g.stroke();
    }
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

// ==================== 区域怪物（野外 / 区域首领） ====================

export type RegionArtStyle = 'beast' | 'spirit' | 'brute' | 'blob' | 'eye';

export interface RegionArtDef {
    style: RegionArtStyle;
    /** 主体色 */
    main: string;
    /** 暗面 / 轮廓色 */
    dark: string;
    /** 眼睛 / 发光点 */
    glow: string;
}

/**
 * 区域怪物画风表：新增区域敌人时**必须**在这里登记，否则渲染层只能画灰圆。
 * 配色按区域走（灰烬 = 橙红，霜牙 = 冰蓝，深渊 = 紫），一眼能看出走到了哪。
 */
export const REGION_ART: Record<string, RegionArtDef> = {
    // 灰烬荒原
    ash_lord: { style: 'brute', main: '#8A4A37', dark: '#4E2418', glow: '#FF9A3D' },
    // 霜牙峡谷
    frost_whelp: { style: 'beast', main: '#CFE9FB', dark: '#7FA8C4', glow: '#EAF9FF' },
    frost_wolf: { style: 'beast', main: '#E6F3FF', dark: '#7E9FBC', glow: '#8FE8FF' },
    ice_wisp: { style: 'spirit', main: '#9BDCFF', dark: '#4E90BA', glow: '#DFF6FF' },
    snow_reaver: { style: 'brute', main: '#AEC9DF', dark: '#647F98', glow: '#D6ECFF' },
    ice_golem: { style: 'brute', main: '#9FC3D9', dark: '#4F6E85', glow: '#BFF0FF' },
    // 秘银深渊
    abyss_spawn: { style: 'blob', main: '#7C4FA8', dark: '#3E2159', glow: '#C99BFF' },
    void_acolyte: { style: 'spirit', main: '#9A7BE8', dark: '#4B2E86', glow: '#D9C8FF' },
    shade_blade: { style: 'brute', main: '#4B3B6B', dark: '#241A38', glow: '#B08CFF' },
    void_horror: { style: 'blob', main: '#5E3A8C', dark: '#2E1A4C', glow: '#D07BFF' },
    abyss_watcher: { style: 'eye', main: '#3E2B63', dark: '#1E1236', glow: '#E07BFF' },
};

const SHADOW = '#00000055';

function drawBeast(g: Graphics, x: number, y: number, time: number, r: number, def: RegionArtDef): void {
    const breathe = Math.sin(time * 2.6 + x * 0.1) * r * 0.04;
    const cy = y + breathe;
    g.fillColor = C(SHADOW);
    g.ellipse(x, y - r * 0.9, r * 0.95, r * 0.22);
    g.fill();
    // 四条腿
    g.fillColor = C(def.dark);
    for (const dx of [-0.55, -0.2, 0.25, 0.6]) {
        g.roundRect(x + dx * r - r * 0.14, cy - r * 0.95, r * 0.28, r * 0.5, r * 0.1);
        g.fill();
    }
    // 身体
    g.fillColor = C(def.main);
    g.ellipse(x, cy - r * 0.12, r * 0.92, r * 0.55);
    g.fill();
    // 背脊
    g.fillColor = C(def.dark);
    g.moveTo(x - r * 0.72, cy + r * 0.12);
    g.lineTo(x - r * 0.3, cy + r * 0.58);
    g.lineTo(x + r * 0.08, cy + r * 0.3);
    g.lineTo(x + r * 0.42, cy + r * 0.52);
    g.lineTo(x + r * 0.76, cy + r * 0.06);
    g.close();
    g.fill();
    // 尾巴
    g.strokeColor = C(def.dark);
    g.lineWidth = Math.max(2, r * 0.14);
    g.moveTo(x - r * 0.8, cy + r * 0.06);
    g.lineTo(x - r * 1.22, cy + r * 0.42);
    g.stroke();
    // 头 + 耳
    g.fillColor = C(def.main);
    g.circle(x + r * 0.78, cy + r * 0.46, r * 0.4);
    g.fill();
    g.fillColor = C(def.dark);
    g.moveTo(x + r * 0.6, cy + r * 0.72);
    g.lineTo(x + r * 0.52, cy + r * 1.08);
    g.lineTo(x + r * 0.86, cy + r * 0.84);
    g.close();
    g.fill();
    g.moveTo(x + r * 0.94, cy + r * 0.78);
    g.lineTo(x + r * 1.02, cy + r * 1.12);
    g.lineTo(x + r * 1.14, cy + r * 0.72);
    g.close();
    g.fill();
    // 口鼻 + 眼
    g.fillColor = C(def.dark);
    g.ellipse(x + r * 1.04, cy + r * 0.34, r * 0.18, r * 0.13);
    g.fill();
    g.fillColor = C(def.glow);
    g.circle(x + r * 0.86, cy + r * 0.54, Math.max(1.6, r * 0.09));
    g.fill();
}

function drawSpirit(g: Graphics, x: number, y: number, time: number, r: number, def: RegionArtDef): void {
    const cy = y + Math.sin(time * 2.2 + x * 0.1) * r * 0.2;
    g.fillColor = C(def.glow + '2E');
    g.circle(x, cy, r * 1.12);
    g.fill();
    // 下摆
    g.fillColor = C(def.dark);
    g.moveTo(x - r * 0.48, cy);
    g.lineTo(x + r * 0.05, cy - r * 1.25);
    g.lineTo(x + r * 0.48, cy);
    g.close();
    g.fill();
    // 兜帽
    g.fillColor = C(def.main);
    g.moveTo(x, cy + r * 0.82);
    g.lineTo(x + r * 0.58, cy + r * 0.08);
    g.lineTo(x + r * 0.32, cy - r * 0.42);
    g.lineTo(x - r * 0.32, cy - r * 0.42);
    g.lineTo(x - r * 0.58, cy + r * 0.08);
    g.close();
    g.fill();
    g.fillColor = C(def.dark);
    g.moveTo(x, cy + r * 0.82);
    g.lineTo(x - r * 0.58, cy + r * 0.08);
    g.lineTo(x - r * 0.32, cy - r * 0.42);
    g.lineTo(x, cy - r * 0.12);
    g.close();
    g.fill();
    // 眼
    g.fillColor = C(def.glow);
    g.circle(x - r * 0.17, cy + r * 0.26, Math.max(1.5, r * 0.085));
    g.fill();
    g.circle(x + r * 0.17, cy + r * 0.26, Math.max(1.5, r * 0.085));
    g.fill();
    // 环绕光点
    for (let i = 0; i < 3; i++) {
        const a = time * 1.4 + i * 2.1;
        g.fillColor = C(def.glow + 'AA');
        g.circle(x + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.45 + r * 0.15, Math.max(1.2, r * 0.07));
        g.fill();
    }
}

function drawBrute(g: Graphics, x: number, y: number, time: number, r: number, def: RegionArtDef): void {
    const breathe = Math.sin(time * 2.1 + x * 0.1) * r * 0.05;
    const cy = y + breathe;
    g.fillColor = C(SHADOW);
    g.ellipse(x, y - r * 0.98, r * 0.85, r * 0.22);
    g.fill();
    // 腿
    g.fillColor = C(def.dark);
    g.roundRect(x - r * 0.52, cy - r * 0.95, r * 0.38, r * 0.55, r * 0.12);
    g.fill();
    g.roundRect(x + r * 0.14, cy - r * 0.95, r * 0.38, r * 0.55, r * 0.12);
    g.fill();
    // 躯干
    g.fillColor = C(def.main);
    g.moveTo(x - r * 0.6, cy + r * 0.28);
    g.lineTo(x - r * 0.42, cy - r * 0.44);
    g.lineTo(x + r * 0.42, cy - r * 0.44);
    g.lineTo(x + r * 0.6, cy + r * 0.28);
    g.close();
    g.fill();
    g.fillColor = C(def.dark);
    g.ellipse(x, cy - r * 0.12, r * 0.28, r * 0.24);
    g.fill();
    // 肩
    g.fillColor = C(def.dark);
    g.circle(x - r * 0.58, cy + r * 0.3, r * 0.25);
    g.fill();
    g.circle(x + r * 0.58, cy + r * 0.3, r * 0.25);
    g.fill();
    // 头 + 角
    g.fillColor = C(def.main);
    g.circle(x, cy + r * 0.7, r * 0.32);
    g.fill();
    g.strokeColor = C(def.glow);
    g.lineWidth = Math.max(2, r * 0.08);
    g.moveTo(x - r * 0.2, cy + r * 0.92);
    g.lineTo(x - r * 0.46, cy + r * 1.2);
    g.moveTo(x + r * 0.2, cy + r * 0.92);
    g.lineTo(x + r * 0.46, cy + r * 1.2);
    g.stroke();
    // 眼
    g.fillColor = C(def.glow);
    g.circle(x - r * 0.11, cy + r * 0.72, Math.max(1.5, r * 0.075));
    g.fill();
    g.circle(x + r * 0.11, cy + r * 0.72, Math.max(1.5, r * 0.075));
    g.fill();
    // 武器：一把横在身侧的刃
    g.strokeColor = C(def.dark);
    g.lineWidth = Math.max(3, r * 0.14);
    g.moveTo(x + r * 0.62, cy + r * 0.1);
    g.lineTo(x + r * 1.05, cy + r * 0.72);
    g.stroke();
    g.strokeColor = C(def.glow + 'CC');
    g.lineWidth = Math.max(1.5, r * 0.05);
    g.moveTo(x + r * 0.72, cy + r * 0.22);
    g.lineTo(x + r * 1.08, cy + r * 0.78);
    g.stroke();
}

function drawBlob(g: Graphics, x: number, y: number, time: number, r: number, def: RegionArtDef): void {
    const wob = Math.sin(time * 3 + x * 0.1) * r * 0.07;
    const cy = y + wob * 0.5;
    g.fillColor = C(SHADOW);
    g.ellipse(x, y - r * 0.82, r * 0.85, r * 0.2);
    g.fill();
    // 触须
    g.strokeColor = C(def.dark);
    g.lineWidth = Math.max(2.5, r * 0.16);
    for (const dx of [-0.5, 0, 0.5]) {
        g.moveTo(x + dx * r, cy - r * 0.3);
        g.lineTo(x + dx * r * 1.35, cy - r * 0.95 - Math.abs(dx) * r * 0.1);
        g.stroke();
    }
    // 本体（外层暗、内层亮）
    g.fillColor = C(def.dark);
    g.ellipse(x, cy - r * 0.05, r * 0.92, r * 0.68 + wob);
    g.fill();
    g.fillColor = C(def.main);
    g.ellipse(x, cy + r * 0.02, r * 0.74, r * 0.54 + wob * 0.6);
    g.fill();
    // 眼（三只，一大两小）
    g.fillColor = C(def.glow);
    g.circle(x - r * 0.26, cy + r * 0.2, Math.max(1.8, r * 0.11));
    g.fill();
    g.circle(x + r * 0.26, cy + r * 0.24, Math.max(1.5, r * 0.09));
    g.fill();
    g.circle(x + r * 0.02, cy - r * 0.08, Math.max(1.2, r * 0.06));
    g.fill();
}

function drawEye(g: Graphics, x: number, y: number, time: number, r: number, def: RegionArtDef): void {
    const cy = y + Math.sin(time * 1.7) * r * 0.1;
    g.fillColor = C(def.glow + '26');
    g.circle(x, cy, r * 1.2);
    g.fill();
    // 触须
    g.strokeColor = C(def.dark);
    g.lineWidth = Math.max(3, r * 0.12);
    for (const a of [Math.PI * 0.85, Math.PI * 0.55, Math.PI * 0.15, -Math.PI * 0.15]) {
        g.moveTo(x + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.4);
        g.lineTo(x + Math.cos(a + 0.2) * r * 1.15, cy + Math.sin(a + 0.2) * r * 1.05);
        g.stroke();
    }
    // 眼体
    g.fillColor = C(def.main);
    g.ellipse(x, cy, r * 0.95, r * 0.78);
    g.fill();
    g.fillColor = C(def.dark);
    g.ellipse(x, cy - r * 0.08, r * 0.78, r * 0.6);
    g.fill();
    // 虹膜 + 眨眼
    const blink = 0.22 + 0.78 * Math.abs(Math.sin(time * 0.9));
    g.fillColor = C(def.glow);
    g.ellipse(x, cy + r * 0.04, r * 0.48, r * 0.48 * blink);
    g.fill();
    g.fillColor = C('#0B0A14');
    g.ellipse(x, cy + r * 0.04, r * 0.17, r * 0.4 * blink);
    g.fill();
    g.fillColor = C('#FFFFFFCC');
    g.circle(x - r * 0.15, cy + r * 0.26, Math.max(1.4, r * 0.08));
    g.fill();
}

/**
 * 画区域怪物（灰烬 / 霜牙 / 深渊）。返回 false 表示这个 kind 没登记，
 * 由渲染层走自己的兜底。
 */
export function drawRegionEnemy(
    g: Graphics,
    x: number,
    y: number,
    time: number,
    radius: number,
    kind: string,
): boolean {
    const def = REGION_ART[kind];
    if (!def) return false;
    const r = Math.max(10, radius);
    if (def.style === 'beast') drawBeast(g, x, y, time, r, def);
    else if (def.style === 'spirit') drawSpirit(g, x, y, time, r, def);
    else if (def.style === 'brute') drawBrute(g, x, y, time, r, def);
    else if (def.style === 'blob') drawBlob(g, x, y, time, r, def);
    else drawEye(g, x, y, time, r, def);
    return true;
}

/** 血球：发光圆 + 十字 */export function drawOrb(g: Graphics, x: number, y: number, time: number): void {
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
