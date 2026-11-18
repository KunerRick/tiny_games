/**
 * 《秘银远征》· WoW 致敬视觉主题（2026-11-18 第 25 轮 UI 拍）
 *
 * 目标：把「深蓝灰仪表盘 + Tailwind 霓虹色」换成一套统一的
 * **暗夜石墙 + 深色木框 + 黄铜描边 + 羊皮纸文字** 语言。
 *
 * 用色纪律（沿用 UITheme 的分层约定）：
 *  - 通用文字三档 / 面板底仍应优先用 `UITheme.COLOR.*`，但本游戏为了风格统一
 *    在 UI 层使用这里的 `MITH_UI` 令牌；玩法身份色（品质 / 职业 / 设施）另表；
 *  - 所有令牌只放十六进制字符串，画图时统一走 `hex()`，不在各处 new Color；
 *  - 金色只做**结构**（边框、分隔、选中态、主操作），不给大块正文上金，
 *    否则整屏会「发光」失去层次。
 *
 * 详设见 docs/design/2026-11-18-mithril-wow-art-direction.md。
 */

import { Graphics, Node, UITransform } from 'cc';
import { hex } from '../../../common/ui/GameUIKit';

export const MITH_UI = {
    /** 全屏遮罩下的夜色 */
    night: '#0A0D12',
    /** 面板石底 */
    stone: '#141922',
    /** 石底亮一档（次级按钮 / 页签底） */
    stoneLight: '#1D242F',
    /** 石底按下态 */
    stonePressed: '#283241',
    /** 凹槽 / 禁用底 */
    stoneDark: '#0F131A',
    /** 列表行 */
    row: '#1A202A',
    /** 列表行选中：偏暖的皮革色，而不是科技蓝 */
    rowActive: '#2E2510',

    /** 页头木带 */
    wood: '#3A2716',
    woodDark: '#241708',
    woodLight: '#4B341D',

    /** 黄铜三档 */
    gold: '#C9A227',
    goldBright: '#F0D77B',
    goldPressed: '#A9861B',
    goldDim: '#8A6C1E',
    /** 细描边（比 goldDim 更暗，避免到处都是亮线） */
    goldLine: '#5E4C1B',

    /** 羊皮纸文字三档 */
    parchment: '#EFE3C2',
    parchmentDim: '#B9AB8B',
    /** N100：原来是 #7E735C，在 stoneDark 上只有 3.98:1；提亮到 4.66:1 过 AA */
    parchmentMuted: '#8A7E66',
    /** 金底上的墨色文字 */
    ink: '#241A0F',

    /** 语义色（在暗底上降低荧光感） */
    success: '#6FCF6F',
    danger: '#E06060',
    warning: '#E8B04B',
    info: '#6FB6D9',
    /** 购买 / 领取这类「正向但非主操作」的祖母绿（N100：压深到 4.95:1） */
    emerald: '#356B3C',
    emeraldPressed: '#2C5A33',
} as const;

/**
 * 品质色的「文字档」：`QUALITY_BY_ID[x].color` 是 WoW 原色，留给圆点 / 描边 / 图标；
 * 连续文字（列表行、详情标题）用 `textColor`，深蓝 / 深紫 / 红在原色下只有 3.4–4.0:1。
 * 参数用结构类型，避免 Theme 反向依赖 Config。
 */
export function qualityTextColor(
    q: { color: string; textColor?: string } | null | undefined,
    fallback: string,
): string {
    if (!q) return fallback;
    return q.textColor || q.color;
}

/** 小菱形（铆钉 / 分隔符 / 页头装饰） */
export function drawDiamond(
    g: Graphics, x: number, y: number, r: number, colorHex: string, alpha = 255,
): void {
    g.fillColor = hex(colorHex, alpha);
    g.moveTo(x, y + r);
    g.lineTo(x + r, y);
    g.lineTo(x, y - r);
    g.lineTo(x - r, y);
    g.close();
    g.fill();
}

/**
 * 营地面板外框：石底 + 页头木带 + 双线黄铜边 + 四角铆钉。
 * 只画在面板自身的 Graphics 上，子内容随后追加即可自然叠在上面。
 */
export function drawCampFrame(g: Graphics, w: number, h: number): void {
    const hw = w / 2;
    const hh = h / 2;
    const r = 26;

    // ---- 石底 ----
    g.fillColor = hex(MITH_UI.stone, 255);
    g.roundRect(-hw, -hh, w, h, r);
    g.fill();

    // 上半部极轻的受光（8 条递减弱带，避免一块死平的颜色）
    for (let i = 0; i < 6; i++) {
        const a = 6 - i;
        if (a <= 0) break;
        g.fillColor = hex('#FFFFFF', a);
        g.rect(-hw + 8, hh - 30 - (i + 1) * 18, w - 16, 18);
        g.fill();
    }

    // ---- 页头木带（顶部圆角；底部用石底盖平方角，形成「嵌进石框的木板」）----
    const bandH = 124;
    const bandY = hh - bandH;
    g.fillColor = hex(MITH_UI.wood, 255);
    g.roundRect(-hw + 6, bandY, w - 12, bandH + r, r - 4);
    g.fill();
    // 木纹：底部更暗，制造厚度
    for (let i = 0; i < 7; i++) {
        g.fillColor = hex(MITH_UI.woodDark, 18 + i * 8);
        g.rect(-hw + 6, bandY + 24 + i * ((bandH - 24) / 7), w - 12, (bandH - 24) / 7);
        g.fill();
    }
    g.fillColor = hex(MITH_UI.woodLight, 60);
    g.rect(-hw + 6, hh - 26, w - 12, 20);
    g.fill();
    // 把木带圆角的下半段盖掉，与石底齐平
    g.fillColor = hex(MITH_UI.stone, 255);
    g.rect(-hw + 6, bandY, w - 12, r - 2);
    g.fill();

    // ---- 黄铜结构线 ----
    // 顶部受光 + 木带下沿
    g.fillColor = hex(MITH_UI.goldBright, 120);
    g.rect(-hw + 16, hh - 3, w - 32, 2);
    g.fill();
    g.fillColor = hex(MITH_UI.gold, 210);
    g.rect(-hw + 8, bandY - 2, w - 16, 2);
    g.fill();
    g.fillColor = hex(MITH_UI.goldDim, 110);
    g.rect(-hw + 8, bandY - 5, w - 16, 1);
    g.fill();
    // 底沿一道很暗的金线，交代「这块板有厚度」
    g.fillColor = hex(MITH_UI.goldDim, 70);
    g.rect(-hw + 26, -hh + 10, w - 52, 1);
    g.fill();

    // ---- 双线边框 ----
    g.strokeColor = hex(MITH_UI.goldDim, 235);
    g.lineWidth = 3;
    g.roundRect(-hw + 2, -hh + 2, w - 4, h - 4, r - 1);
    g.stroke();
    g.strokeColor = hex(MITH_UI.gold, 70);
    g.lineWidth = 1;
    g.roundRect(-hw + 11, -hh + 11, w - 22, h - 22, r - 8);
    g.stroke();

    // ---- 四角铆钉 ----
    const inset = 22;
    const studs: Array<[number, number]> = [
        [-hw + inset, hh - inset], [hw - inset, hh - inset],
        [-hw + inset, -hh + inset], [hw - inset, -hh + inset],
    ];
    for (const [x, y] of studs) drawDiamond(g, x, y, 5, MITH_UI.goldBright, 190);
}

/**
 * 石底面板的统一收边：内侧细金线 + 四角小铆钉。
 * 用于背包 / 成长 / 选职业这类「有自己标题行」的面板，不画木带、不改布局。
 */
export function drawStoneTrim(g: Graphics, w: number, h: number, radius = 26): void {
    const hw = w / 2;
    const hh = h / 2;
    g.strokeColor = hex(MITH_UI.gold, 70);
    g.lineWidth = 1;
    g.roundRect(-hw + 9, -hh + 9, w - 18, h - 18, Math.max(6, radius - 8));
    g.stroke();
    const inset = 20;
    const studs: Array<[number, number]> = [
        [-hw + inset, hh - inset], [hw - inset, hh - inset],
        [-hw + inset, -hh + inset], [hw - inset, -hh + inset],
    ];
    for (const [x, y] of studs) drawDiamond(g, x, y, 4, MITH_UI.goldBright, 170);
}

/** 带中心菱形的水平黄铜分隔线 */
export function drawGoldDivider(g: Graphics, y: number, halfW: number): void {
    g.fillColor = hex(MITH_UI.goldDim, 150);
    g.rect(-halfW, y - 0.75, halfW * 2, 1.5);
    g.fill();
    // 两翼更淡，中心一个亮菱形
    g.fillColor = hex(MITH_UI.gold, 110);
    g.rect(-halfW * 0.72, y - 0.5, halfW * 1.44, 1);
    g.fill();
    drawDiamond(g, 0, y, 5, MITH_UI.goldBright, 235);
    drawDiamond(g, -halfW + 8, y, 3, MITH_UI.gold, 170);
    drawDiamond(g, halfW - 8, y, 3, MITH_UI.gold, 170);
}

/**
 * 内容凹板：深石底 + 内阴影 + 黄铜细边 + 四角括线。
 * 让列表 / 空态都有「放在台面上」的边界，不再是一块无边无际的深色。
 */
export function drawInsetBoard(g: Graphics, w: number, top: number, bottom: number): void {
    const h = top - bottom;
    const hw = w / 2;
    const cy = (top + bottom) / 2;

    g.fillColor = hex(MITH_UI.stoneDark, 236);
    g.roundRect(-hw, cy - h / 2, w, h, 16);
    g.fill();

    // 内阴影：顶部往下压暗
    for (let i = 0; i < 5; i++) {
        g.fillColor = hex('#000000', 46 - i * 8);
        g.rect(-hw + 10, top - 8 - (i + 1) * 7, w - 20, 7);
        g.fill();
    }

    g.strokeColor = hex(MITH_UI.goldLine, 200);
    g.lineWidth = 1.5;
    g.roundRect(-hw, cy - h / 2, w, h, 16);
    g.stroke();

    // 四角括线（比科技风的短，更像金属包角）
    const len = 18;
    const x = hw - 9;
    const y = h / 2 - 9;
    g.strokeColor = hex(MITH_UI.goldBright, 120);
    g.lineWidth = 2;
    g.moveTo(-x, y - len); g.lineTo(-x, y); g.lineTo(-x + len, y);
    g.moveTo(x - len, y); g.lineTo(x, y); g.lineTo(x, y - len);
    g.moveTo(-x, -y + len); g.lineTo(-x, -y); g.lineTo(-x + len, -y);
    g.moveTo(x - len, -y); g.lineTo(x, -y); g.lineTo(x, -y + len);
    g.stroke();
}

/**
 * 按钮的金属倒角：顶部受光 + 底部阴影。
 * 挂在按钮节点上、位于底板之上与文字之下（sibling 0），
 * `UiButton.setColor()` 重画底板时不会把它清掉。
 */
export function addButtonSheen(
    node: Node, w: number, h: number, radius: number, tone: 'gold' | 'stone' = 'gold',
): void {
    if (!node || !node.isValid) return;
    if (node.getChildByName('ButtonSheen')) return; // 幂等

    const holder = new Node('ButtonSheen');
    holder.layer = node.layer;
    holder.addComponent(UITransform).setContentSize(w, h);
    const g = holder.addComponent(Graphics);
    const inset = Math.max(6, radius * 0.7);
    const topY = h / 2 - 2;
    const botY = -h / 2 + 2;

    g.strokeColor = hex(tone === 'gold' ? MITH_UI.goldBright : '#FFFFFF', tone === 'gold' ? 120 : 26);
    g.lineWidth = 1;
    g.moveTo(-w / 2 + inset, topY);
    g.lineTo(w / 2 - inset, topY);
    g.stroke();

    g.strokeColor = hex('#000000', tone === 'gold' ? 70 : 55);
    g.moveTo(-w / 2 + inset, botY);
    g.lineTo(w / 2 - inset, botY);
    g.stroke();

    node.addChild(holder);
    holder.setSiblingIndex(0);
}

/** 页头标题两侧的小菱形装饰 */
export function addHeaderDiamond(parent: Node, x: number, y: number, r: number): Node {
    const node = new Node('HeaderDiamond');
    node.layer = parent.layer;
    node.addComponent(UITransform).setContentSize(r * 2 + 4, r * 2 + 4);
    node.setPosition(x, y, 0);
    const g = node.addComponent(Graphics);
    drawDiamond(g, 0, 0, r, MITH_UI.goldBright, 220);
    holdDiamondAccent(g, r);
    parent.addChild(node);
    return node;
}

/** 菱形中心再点一笔深色，读起来像一颗镶嵌的宝石而不是纯色块 */
function holdDiamondAccent(g: Graphics, r: number): void {
    drawDiamond(g, 0, 0, Math.max(1.5, r * 0.42), MITH_UI.woodDark, 190);
}
