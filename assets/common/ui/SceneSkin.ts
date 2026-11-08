/**
 * 场景皮肤改造工具（跨游戏统一视觉用）。
 *
 * 背景：早期 9 款游戏的面板/按钮是直接在场景编辑器里手摆的——九宫格 Sprite 染色
 * （#8F7A66 棕、#CDC1B4 米、#16213E 深紫……）、按钮字号 20~36 混用。这些场景节点
 * 不能靠改 `.scene` 来统一（红线 2），所以统一放在运行时「换皮」：隐藏原 Sprite、
 * 用 `drawFrame` 画令牌底板、把 Label 换成字号令牌。
 *
 * 用法（在各游戏的 `onLoad` 里调）：
 *   skinCard(this.node, 'gameContainer/scorePanel/scoreCard');
 *   skinButton(this.node, 'gameContainer/footer/newGameButton', 'primary', 240, 64);
 *   skinBackButton(this.node, 'UI_Overlay/topBar/backBtn');
 *   paintLabel(this.node, 'UI_Overlay/topBar/scorePanel/currentScore', FONT_TITLE, COLOR.TEXT_PRIMARY);
 *
 * 所有函数都是**幂等**的（按子节点名复用），且找不到节点时静默返回 null——
 * 换皮不该因为某个场景少了节点就把游戏弄挂。
 */
import { Label, Node, Sprite, UITransform } from 'cc';
import {
    COLOR,
    FONT_BODY,
    applyFontAndColor,
} from './UITheme';
import type { FontToken } from './UITheme';
import { drawBackSkin, drawFrame, ensureChild, ensureScaleButton } from './GameUIKit';

/** 按 `a/b/c` 路径取子节点 */
export function findPath(root: Node | null, path: string): Node | null {
    if (!root || !root.isValid) return null;
    let cur: Node | null = root;
    for (const part of path.split('/')) {
        if (!cur) return null;
        cur = cur.getChildByName(part);
    }
    return cur;
}

export type SkinVariant = 'primary' | 'secondary' | 'danger' | 'success';

const VARIANT_FILL: Record<SkinVariant, string> = {
    primary: COLOR.PRIMARY,
    secondary: COLOR.SURFACE,
    danger: COLOR.DANGER,
    success: COLOR.SUCCESS,
};

function variantBorder(variant: SkinVariant): string {
    if (variant === 'primary') return COLOR.PRIMARY_DARK;
    if (variant === 'danger') return COLOR.DANGER_DARK;
    return COLOR.PANEL_BORDER;
}

/**
 * 把场景按钮换成令牌皮肤：隐藏九宫格 Sprite → 画圆角底板 → 过渡改 SCALE，
 * 并把子 Label 统一成 FONT_BODY 白字。原有 Button 组件与 TOUCH_END 监听保持不变。
 *
 * @param w/h 不传则保留场景尺寸
 */
export function skinButton(
    root: Node | null, path: string, variant: SkinVariant, w?: number, h?: number,
): Node | null {
    const node = findPath(root, path);
    if (!node) return null;
    const ui = node.getComponent(UITransform);
    if (!ui) return null;
    if (w !== undefined && h !== undefined) ui.setContentSize(w, h);

    const sp = node.getComponent(Sprite);
    if (sp) sp.enabled = false;

    const width = ui.width;
    const height = ui.height;
    drawFrame(node, {
        width, height,
        radius: Math.min(16, height / 2),
        fill: VARIANT_FILL[variant], fillAlpha: 255,
        border: variantBorder(variant), borderAlpha: 220, borderWidth: 2,
    });
    ensureScaleButton(node);

    for (const child of node.children) {
        if (!child?.isValid) continue;
        const label = child.getComponent(Label);
        if (label) applyFontAndColor(label, FONT_BODY, '#FFFFFF');
    }
    return node;
}

/**
 * 统一返回按钮：隐藏原 Sprite 与文字，画「圆盘 + ‹」。
 * 直径默认 64（与 `createBackButton` 的 72 属同一档，场景里的节点通常更小）。
 */
export function skinBackButton(root: Node | null, path: string, diameter = 64): Node | null {
    const node = findPath(root, path);
    if (!node) return null;
    const ui = node.getComponent(UITransform);
    if (!ui) return null;

    const sp = node.getComponent(Sprite);
    if (sp) sp.enabled = false;
    for (const child of node.children) {
        if (child?.isValid && child.getComponent(Label)) child.active = false;
    }
    ui.setContentSize(diameter, diameter);
    drawBackSkin(node, diameter);
    ensureScaleButton(node);
    return node;
}

/** 统一一个 Label 的字号与颜色（可选改文案） */
export function paintLabel(
    root: Node | null, path: string, token: FontToken, colorHex: string, text?: string,
): Label | null {
    const label = findPath(root, path)?.getComponent(Label) ?? null;
    if (!label) return null;
    if (text !== undefined) label.string = text;
    applyFontAndColor(label, token, colorHex);
    return label;
}

export interface CardSkin {
    fill?: string;
    fillAlpha?: number;
    border?: string;
    borderAlpha?: number;
    radius?: number;
    /** 顶部强调条 */
    accent?: string;
}

/**
 * 把一块底板（分数卡 / 弹窗面板 / 结算卡）换成令牌皮肤。
 * 隐藏原 Sprite 并叠一张 Graphics 底板，避免两种底纹叠在一起。
 */
export function skinCard(root: Node | null, path: string, skin: CardSkin = {}): Node | null {
    const node = findPath(root, path);
    if (!node) return null;
    const ui = node.getComponent(UITransform);
    if (!ui || ui.width <= 2 || ui.height <= 2) return null;

    const sp = node.getComponent(Sprite);
    if (sp) sp.enabled = false;

    drawFrame(node, {
        width: ui.width,
        height: ui.height,
        radius: skin.radius ?? 14,
        fill: skin.fill ?? COLOR.SURFACE,
        fillAlpha: skin.fillAlpha ?? 255,
        border: skin.border ?? COLOR.PANEL_BORDER,
        borderAlpha: skin.borderAlpha ?? 210,
        borderWidth: 2,
        accent: skin.accent,
        accentAlpha: 220,
    });
    return node;
}

/** 全屏遮罩：原节点通常是不透明白/黑，改成半透明黑 */
export function skinOverlay(root: Node | null, path: string, alpha = 190): void {
    const sp = findPath(root, path)?.getComponent(Sprite);
    if (!sp) return;
    sp.enabled = true;
    sp.color.set(0, 0, 0, alpha);
}

/**
 * 给「直接铺在遮罩上的弹窗」补一块卡片底（打砖块 / 合合大作战这类场景：
 * 弹窗只有 Dim + 标题 + 按钮，没有底板，深色遮罩下文字按钮直接浮着）。
 *
 * 尺寸按**非 Dim 子节点的包围盒**算，再留出内边距，所以标题长短、按钮行数
 * 不同也不需要逐游戏写死坐标。卡片插在 Dim 之后、内容之前。
 */
export function addDialogBackdrop(
    panel: Node | null,
    skin: CardSkin = {},
    opts: { padX?: number; padY?: number; minWidth?: number; name?: string } = {},
): Node | null {
    if (!panel || !panel.isValid) return null;
    const name = opts.name ?? '__dialogCard';

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const child of panel.children) {
        if (!child?.isValid) continue;
        if (child.name === name) continue;
        if (child === panel.children[0] && /dim|overlay|mask|bg/i.test(child.name)) continue;
        const ui = child.getComponent(UITransform);
        if (!ui || ui.width <= 2 || ui.height <= 2) continue;
        // 全屏遮罩不参与包围盒
        if (ui.width >= 700 && ui.height >= 1200) continue;
        const x = child.position.x;
        const y = child.position.y;
        minX = Math.min(minX, x - ui.width / 2);
        maxX = Math.max(maxX, x + ui.width / 2);
        minY = Math.min(minY, y - ui.height / 2);
        maxY = Math.max(maxY, y + ui.height / 2);
    }
    if (!isFinite(minX)) return null;

    const padX = opts.padX ?? 40;
    const padY = opts.padY ?? 44;
    const w = Math.max(opts.minWidth ?? 520, maxX - minX + padX * 2);
    const h = maxY - minY + padY * 2;

    const card = ensureChild(panel, name, w, h);
    card.setPosition((minX + maxX) / 2, (minY + maxY) / 2, 0);
    card.setSiblingIndex(1);

    drawFrame(card, {
        width: w,
        height: h,
        radius: skin.radius ?? 22,
        fill: skin.fill ?? COLOR.PANEL_BG,
        fillAlpha: skin.fillAlpha ?? 252,
        border: skin.border ?? COLOR.PRIMARY,
        borderAlpha: skin.borderAlpha ?? 90,
        borderWidth: 2,
        accent: skin.accent,
        accentAlpha: 220,
    });
    return card;
}

