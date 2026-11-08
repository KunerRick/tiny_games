/**
 * 小游戏通用运行时 UI 工具。
 *
 * 所有控件都在代码里创建，不改场景文件；视觉统一用 Graphics 画圆角块 + Label。
 *
 * 两层 API：
 *  - **基础层**（`createNode` / `createLabel` / `createButton` / `createBackButton` /
 *    `toast`…）—— 早期各游戏直接调用的通用件；
 *  - **表现层**（`drawFrame` / `stylePanel` / `makeMedallion` / `makeStatBar` /
 *    `drawEmblem` / `drawRouteGlyph`…）—— 从《小小先锋》上提的「深色科技 + 纹章」构件，
 *    提供统一的面板外框、职业徽记、属性条、路线图标。
 *
 * 颜色/字号/尺寸一律走 `./UITheme` 的令牌（本模块把它们原样再导出，
 * 调用方既可以 `import { COLOR } from '.../GameUIKit'`，也可以单独引 UITheme）。
 *
 * 约定：
 *  - 触摸回调统一走**具名**的模块级 handler（红线 5），按钮把回调挂在节点上；
 *  - 图标字符串一律过 `stripVariationSelectors()`（红线 10，避免微信 tofu）；
 *  - 节点层级取父节点的 layer，保证 UI 相机能渲染。
 */

import {
    Button,
    Camera,
    Color,
    director,
    EventTouch,
    Graphics,
    HorizontalTextAlignment,
    Label,
    Node,
    Sprite,
    Tween,
    UIOpacity,
    UITransform,
    VerticalTextAlignment,
    tween,
    Vec3,
} from 'cc';
import {
    COLOR,
    FONT_CAPTION,
    FONT_TINY,
    UI,
    applyFontAndColor,
    hex,
    stripVariationSelectors,
} from './UITheme';
import type { FontToken } from './UITheme';

/** 令牌随构件一起再导出，调用方只需引一个模块 */
export * from './UITheme';

// ==================== 基础 ====================

/**
 * 把当前场景相机清屏色改成统一的深蓝。
 *
 * 场景自带的相机默认是纯黑，切进来会和其它用 GameUIKit 的游戏明显不是一套 UI；
 * 这些场景又没有全屏底图，所以在 onLoad 里直接改相机即可（随场景销毁自动还原）。
 */
export function applySceneClearColor(hexColor: string = UI.bg): void {
    const scene = director.getScene();
    if (!scene) return;
    const canvas = scene.getChildByName('Canvas');
    if (!canvas) return;
    const camera = canvas.getComponentInChildren(Camera);
    if (camera) camera.clearColor = toColor(hexColor);
}

/** `#RRGGBB` / `#RRGGBBAA` → Color */
export function toColor(hexColor: string, alpha = 255): Color {
    let h = hexColor.replace('#', '');
    let a = alpha;
    if (h.length === 8) {
        a = parseInt(h.slice(6, 8), 16);
        h = h.slice(0, 6);
    }
    if (h.length !== 6) return new Color(255, 255, 255, a);
    return new Color(
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        a,
    );
}


/** 创建一个带 UITransform 的节点，锚点默认居中 */
export function createNode(name: string, parent: Node, w = 100, h = 100): Node {
    const node = new Node(name);
    node.layer = parent.layer;
    parent.addChild(node);
    const ut = node.addComponent(UITransform);
    ut.setContentSize(w, h);
    ut.setAnchorPoint(0.5, 0.5);
    return node;
}

/** 设计坐标（左上角原点，y 向下）→ 父节点局部坐标（父节点铺满 720×1280 且居中） */
export function designPos(xFromLeft: number, yFromTop: number): Vec3 {
    return new Vec3(xFromLeft - 360, 640 - yFromTop, 0);
}

export interface LabelOpts {
    color?: string;
    align?: 'left' | 'center' | 'right';
    bold?: boolean;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    overflow?: 'none' | 'shrink' | 'clamp';
    lineHeight?: number;
}

/** 创建 Label 节点 */
export function createLabel(parent: Node, text: string, fontSize: number, opts: LabelOpts = {}): Label {
    const node = createNode('Label', parent, opts.width || 600, opts.height || fontSize * 1.5);
    const label = node.addComponent(Label);
    label.string = stripVariationSelectors(text);
    label.fontSize = fontSize;
    label.lineHeight = opts.lineHeight || Math.round(fontSize * 1.25);
    label.color = toColor(opts.color || UI.text);
    label.horizontalAlign = opts.align === 'left'
        ? HorizontalTextAlignment.LEFT
        : opts.align === 'right'
            ? HorizontalTextAlignment.RIGHT
            : HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.overflow = opts.overflow === 'shrink'
        ? Label.Overflow.SHRINK
        : opts.overflow === 'clamp'
            ? Label.Overflow.CLAMP
            : Label.Overflow.NONE;
    label.isBold = !!opts.bold;
    if (opts.x !== undefined || opts.y !== undefined) {
        node.setPosition(opts.x || 0, opts.y || 0, 0);
    }
    return label;
}

/** 在本地坐标（以节点中心为原点）画一个圆角矩形 */
export function drawRoundRect(
    g: Graphics,
    w: number,
    h: number,
    radius: number,
    fill?: Color,
    stroke?: Color,
    lineWidth = 2,
): void {
    g.clear();
    const r = Math.min(radius, w / 2, h / 2);
    g.roundRect(-w / 2, -h / 2, w, h, r);
    if (fill) {
        g.fillColor = fill;
        g.fill();
    }
    if (stroke) {
        g.lineWidth = lineWidth;
        g.strokeColor = stroke;
        g.stroke();
    }
}

/** 画圆角矩形节点（返回 Graphics，便于后续重绘） */
export function createRoundRect(
    parent: Node,
    name: string,
    w: number,
    h: number,
    radius: number,
    fill: string,
    stroke?: string,
    lineWidth = 2,
): Graphics {
    const node = createNode(name, parent, w, h);
    const g = node.addComponent(Graphics);
    drawRoundRect(g, w, h, radius, toColor(fill), stroke ? toColor(stroke) : undefined, lineWidth);
    return g;
}

// ==================== 按钮 ====================

export interface UiButton {
    node: Node;
    label: Label;
    graphics: Graphics;
    setText(text: string): void;
    setColor(fill: string, textColor?: string): void;
    setActive(active: boolean): void;
}

export interface ButtonOpts {
    w: number;
    h: number;
    text: string;
    fontSize?: number;
    fill?: string;
    textColor?: string;
    activeFill?: string;
    activeTextColor?: string;
    radius?: number;
    stroke?: string;
    onTap: () => void;
}

/** 具名按下反馈：所有按钮共用，避免匿名 lambda */
function onButtonTouchStart(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    if (node && node.isValid) node.setScale(0.96, 0.96, 1);
}

function onButtonTouchEndOrCancel(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    if (node && node.isValid) node.setScale(1, 1, 1);
}

function onButtonTap(ev: EventTouch): void {
    const node = ev.currentTarget as Node;
    if (!node || !node.isValid) return;
    const cb = (node as unknown as { __tapCb?: () => void }).__tapCb;
    if (cb) cb();
}

/** 圆角按钮（按下缩放反馈） */
export function createButton(parent: Node, opts: ButtonOpts): UiButton {
    const w = opts.w;
    const h = opts.h;
    const radius = opts.radius !== undefined ? opts.radius : Math.min(14, h / 2);
    const baseFill = opts.fill || '#1E293B';
    const baseText = opts.textColor || UI.text;
    const activeFill = opts.activeFill || UI.primary;
    const activeText = opts.activeTextColor || UI.white;

    const node = createNode('Button', parent, w, h);
    const g = node.addComponent(Graphics);
    const draw = (fill: string) => {
        drawRoundRect(g, w, h, radius, toColor(fill), opts.stroke ? toColor(opts.stroke) : undefined, 2);
    };
    draw(baseFill);

    const label = createLabel(node, opts.text, opts.fontSize || 24, {
        width: w - 12,
        height: h - 4,
        color: baseText,
        bold: true,
        overflow: 'shrink',
    });

    let active = false;
    const btn: UiButton = {
        node,
        label,
        graphics: g,
        setText(text: string) {
            label.string = stripVariationSelectors(text);
        },
        setColor(fill: string, textColor?: string) {
            draw(fill);
            if (textColor) label.color = toColor(textColor);
        },
        setActive(value: boolean) {
            active = value;
            draw(active ? activeFill : baseFill);
            label.color = toColor(active ? activeText : baseText);
        },
    };
    // 供外部读取当前状态（例如测试探针）
    (node as unknown as { __btnActive?: () => boolean }).__btnActive = () => active;

    (node as unknown as { __tapCb?: () => void }).__tapCb = opts.onTap;
    node.on(Node.EventType.TOUCH_START, onButtonTouchStart);
    node.on(Node.EventType.TOUCH_END, onButtonTap);
    node.on(Node.EventType.TOUCH_END, onButtonTouchEndOrCancel);
    node.on(Node.EventType.TOUCH_CANCEL, onButtonTouchEndOrCancel);
    return btn;
}

/** 左上角返回按钮（圆形，‹） */
export function createBackButton(parent: Node, onTap: () => void): UiButton {
    const D = 72;
    const btn = createButton(parent, {
        w: D,
        h: D,
        text: '',
        fontSize: 46,
        fill: BACK_BUTTON_FILL,
        textColor: BACK_BUTTON_CHEVRON,
        stroke: BACK_BUTTON_STROKE,
        radius: D / 2,
        onTap,
    });
    // 箭头用矢量画（屏幕字体在三端宽高比不一致，圆圈 + 字形会大小不一）
    btn.label.node.active = false;
    drawBackSkin(btn.node, D, false);
    btn.node.setPosition(designPos(58, 62));
    return btn;
}

// ==================== 轻提示 ====================

/** 底部浮层提示（自动淡出销毁） */
export function toast(parent: Node, text: string, seconds = 1.6, yFromTop = 1180): Node {
    const node = createNode('Toast', parent, 520, 64);
    node.setPosition(designPos(360, yFromTop));
    const g = node.addComponent(Graphics);
    drawRoundRect(g, 520, 64, 32, toColor('#0A1120', 230), toColor('#334155'), 2);
    createLabel(node, text, 24, { width: 480, height: 56, color: UI.text, overflow: 'shrink' });
    const op = node.addComponent(UIOpacity);
    op.opacity = 255;
    tween(op)
        .delay(seconds)
        .to(0.35, { opacity: 0 })
        .call(() => {
            if (node.isValid) node.destroy();
        })
        .start();
    return node;
}

// ==================== 返回按钮皮肤 ====================

/** 返回按钮的圆盘底色（场景里的 BackButton 与运行时 createBackButton 共用） */
export const BACK_BUTTON_FILL = '#1B2740';
/** 返回按钮描边 */
export const BACK_BUTTON_STROKE = '#3A4658';
/** ‹ 箭头颜色 */
export const BACK_BUTTON_CHEVRON = '#E5E7EB';

/**
 * 统一返回按钮皮肤：圆盘 + 细描边 + 白色 ‹。
 *
 * 箭头用 Graphics 画而不是 `Label.string = '‹'`：靠字形的话，字号/字体在不同平台
 * （浏览器 vs 微信）上宽高比不一致，同一句代码会渲染出两种大小。
 *
 * @param withDisc 节点自身已经有圆盘底板时传 false，只画箭头
 */
export function drawBackSkin(node: Node, diameter: number, withDisc = true): void {
    if (!node?.isValid || diameter <= 4) return;
    const ui = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const r = diameter / 2 - 1;
    const skin = ensureChild(node, '__backChevron', diameter, diameter);
    // 子节点坐标原点是父节点锚点
    skin.setPosition(
        (0.5 - ui.anchorPoint.x) * ui.width,
        (0.5 - ui.anchorPoint.y) * ui.height,
        0,
    );
    const g = skin.getComponent(Graphics) ?? skin.addComponent(Graphics);
    g.clear();

    if (withDisc) {
        g.fillColor = hex(BACK_BUTTON_FILL, 235);
        g.circle(0, 0, r);
        g.fill();
        g.strokeColor = hex(BACK_BUTTON_STROKE, 220);
        g.lineWidth = 2;
        g.circle(0, 0, r - 1);
        g.stroke();
    }

    const ax = r * 0.20;
    const ay = r * 0.42;
    g.strokeColor = hex(BACK_BUTTON_CHEVRON, 255);
    g.lineWidth = Math.max(3, r * 0.14);
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    g.moveTo(ax, ay);
    g.lineTo(-r * 0.22, 0);
    g.lineTo(ax, -ay);
    g.stroke();
}

/** 快速清空节点子级（用倒序下标，避免引擎清空字段后 Array.from(null) 崩溃） */
export function clearChildren(node: Node): void {
    for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (child && child.isValid) child.destroy();
    }
}

/** 停止节点上所有 Tween（销毁前调用，避免回调打到失效对象） */
export function stopTweens(node: Node): void {
    Tween.stopAllByTarget(node);
    const op = node.getComponent(UIOpacity);
    if (op) Tween.stopAllByTarget(op);
}

// ==================== 表现层：底板 / 外框 ====================

/** 补齐 UITransform 并设定尺寸（不传尺寸则保留原值） */
export function ensureTransform(node: Node, w?: number, h?: number): UITransform {
    const ui = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    if (w !== undefined && h !== undefined) ui.setContentSize(w, h);
    return ui;
}

/** 取/建同名子节点（多次刷新幂等） */
export function ensureChild(parent: Node, name: string, w?: number, h?: number): Node {
    const existing = parent.getChildByName(name);
    if (existing?.isValid) {
        if (w !== undefined && h !== undefined) ensureTransform(existing, w, h);
        return existing;
    }
    const n = new Node(name);
    n.layer = parent.layer;
    ensureTransform(n, w ?? 1, h ?? 1);
    parent.addChild(n);
    return n;
}

/** 取/建子节点的 Graphics（每节点只能有一个渲染组件，故用独立子节点） */
export function ensureGfx(parent: Node, name: string, w: number, h: number): Graphics {
    const n = ensureChild(parent, name, w, h);
    return n.getComponent(Graphics) ?? n.addComponent(Graphics);
}

/**
 * 统一 Label 创建（走字号令牌 + 颜色令牌 + 图标消毒）。
 *
 * 与基础层的 `createLabel` 区别：这里以**令牌**为单位（fontSize/lineHeight 成对），
 * 且节点名由调用方指定（便于 `ensureChild` 幂等复用）。
 */
export function makeLabel(
    parent: Node,
    name: string,
    text: string,
    token: FontToken,
    colorHex: string,
    align: 'left' | 'center' | 'right' = 'left',
    width: number = 100,
    height: number = token.lineHeight,
    alpha: number = 255,
): Label {
    const n = ensureChild(parent, name, width, height);
    const lb = n.getComponent(Label) ?? n.addComponent(Label);
    lb.string = stripVariationSelectors(text);
    applyFontAndColor(lb, token, colorHex, alpha);
    lb.horizontalAlign = align === 'left'
        ? Label.HorizontalAlign.LEFT
        : align === 'right'
            ? Label.HorizontalAlign.RIGHT
            : Label.HorizontalAlign.CENTER;
    lb.verticalAlign = Label.VerticalAlign.CENTER;
    lb.overflow = Label.Overflow.CLAMP;
    return lb;
}

/**
 * 圆角矩形路径（只描路径，不填充）。
 * 用引擎自带的 `Graphics.roundRect`：手写的 arc 拼接路径在窄高比下会自交，
 * 填充时按非零环绕规则渲染出斜向色块（实测 200×48 按钮底板变成斜带）。
 */
function roundRectPath(g: Graphics, w: number, h: number, r: number): void {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    g.roundRect(-w / 2, -h / 2, w, h, rr);
}

export interface FrameStyle {
    width: number;
    height: number;
    radius?: number;
    fill?: string;
    fillAlpha?: number;
    border?: string;
    borderAlpha?: number;
    borderWidth?: number;
    /** 顶部强调条颜色（不传则不画） */
    accent?: string;
    accentAlpha?: number;
    /** 内层顶部微光（默认关闭；开启时在顶部叠一条淡色） */
    sheen?: boolean;
}

/**
 * 往节点的 `frameGfx` 子 Graphics 里画圆角底板 + 描边 + 顶条。
 * 幂等：可反复调用（切换选中态时重画）。
 */
export function drawFrame(node: Node, style: FrameStyle): Graphics {
    const g = ensureGfx(node, 'frameGfx', style.width, style.height);
    // 底板必须垫在最底层：drawFrame 可能在子内容（文字/图标）之后才调用，
    // 不固定层级时 Graphics 会盖住已有 Label（实测「荣誉」按钮文字被底板吃掉）。
    g.node.setSiblingIndex(0);
    // 子节点坐标原点是**父节点锚点**：锚点不是 (0.5,0.5) 的场景按钮（如左对齐按钮）
    // 若按中心画，底板会整块偏移（实测「确认部署」深底斜着盖住原色）。
    const nodeUi = node.getComponent(UITransform);
    const ox = nodeUi ? (0.5 - nodeUi.anchorPoint.x) * style.width : 0;
    const oy = nodeUi ? (0.5 - nodeUi.anchorPoint.y) * style.height : 0;
    g.node.setPosition(ox, oy, 0);
    g.clear();
    const r = style.radius ?? 14;

    // 底板
    g.fillColor = hex(style.fill ?? COLOR.SURFACE, style.fillAlpha ?? 255);
    roundRectPath(g, style.width, style.height, r);
    g.fill();

    // 顶部微光：用 8 条递减弱度的横带拼出「从上往下渐隐」，制造金属受光感。
    // 单块半透白会留一条硬直边，看起来像卡片里又嵌了一张小卡片（实测圣泉三张卡都是"框中框"）。
    if (style.sheen) {
        const bands = 8;
        const bandH = (style.height * 0.5) / bands;
        const bw = style.width - 6;
        for (let i = 0; i < bands; i++) {
            const a = Math.round(10 * (1 - i / bands));
            if (a <= 0) break;
            g.fillColor = hex('#FFFFFF', a);
            const y = style.height / 2 - 3 - (i + 1) * bandH;
            if (i === 0) g.roundRect(-bw / 2, y, bw, bandH + 1, r * 0.7);
            else g.rect(-bw / 2, y, bw, bandH + 1);
            g.fill();
        }
    }

    // 顶部强调条
    if (style.accent) {
        const aw = style.width - 28;
        const barNode = ensureChild(node, 'accentBarGfx', aw, 6);
        barNode.active = true;
        barNode.setPosition(ox, oy + style.height / 2 - 9, 0);
        const ag = barNode.getComponent(Graphics) ?? barNode.addComponent(Graphics);
        ag.clear();
        ag.fillColor = hex(style.accent, style.accentAlpha ?? 255);
        roundRectPath(ag, aw, 6, 3);
        ag.fill();
    } else {
        // 重绘成"无强调条"时必须把上一次留下的那条藏起来：
        // 它是独立子节点，只清 frameGfx 不会动它（实测结算面板里「结束本局」头顶
        // 悬着一条青色条，看着像上面那个按钮的下划线）。
        const stale = node.getChildByName('accentBarGfx');
        if (stale) stale.active = false;
    }

    // 描边
    g.strokeColor = hex(style.border ?? COLOR.PANEL_BORDER, style.borderAlpha ?? 255);
    g.lineWidth = style.borderWidth ?? 2;
    roundRectPath(g, style.width, style.height, r);
    g.stroke();

    return g;
}

/** 四角括线（科技框感），画在 node 的 CornerGfx 子节点 */
export function drawCornerBrackets(
    node: Node, w: number, h: number, colorHex: string, alpha = 150, len = 18,
): void {
    const g = ensureGfx(node, 'CornerGfx', w, h);
    g.clear();
    g.strokeColor = hex(colorHex, alpha);
    g.lineWidth = 2;
    const x = w / 2 - 6;
    const y = h / 2 - 6;
    const l = len;
    // 左上
    g.moveTo(-x, y - l); g.lineTo(-x, y); g.lineTo(-x + l, y);
    // 右上
    g.moveTo(x - l, y); g.lineTo(x, y); g.lineTo(x, y - l);
    // 左下
    g.moveTo(-x, -y + l); g.lineTo(-x, -y); g.lineTo(-x + l, -y);
    // 右下
    g.moveTo(x - l, -y); g.lineTo(x, -y); g.lineTo(x, -y + l);
    g.stroke();
}

/**
 * 水平分隔线（渐隐感：中段亮、两端暗）。
 * `name` 可区分同一父节点上的多条线：默认名固定时多次调用会复用同一个 Graphics，
 * 后一次 `clear()` 会把前一条抹掉、并且只有一条线的位置生效。
 */
export function drawDivider(
    node: Node, w: number, colorHex: string = COLOR.PANEL_BORDER, alpha = 255, name = 'dividerGfx',
): Graphics {
    const g = ensureGfx(node, name, w, 4);
    g.clear();
    // 用填充细条而不是 stroke：预览/真机是 720 设计宽缩到 ~0.53 倍，
    // 2px 描边被抗锯齿摊薄后几乎看不见（实测结算面板的分隔线整条消失）。
    // 结构是"两端淡、中段实"，中段只占 60% 宽，仍保留渐隐感。
    const coreAlpha = Math.max(0, alpha);
    const edgeAlpha = Math.round(coreAlpha * 0.35);
    if (edgeAlpha > 0) {
        g.fillColor = hex(colorHex, edgeAlpha);
        g.rect(-w / 2, -0.5, w, 1);
        g.fill();
    }
    g.fillColor = hex(colorHex, coreAlpha);
    g.rect(-w * 0.3, -1, w * 0.6, 2);
    g.fill();
    return g;
}

// ==================== 表现层：纹章 / 路线图标 ====================

export type EmblemKind =
    | 'warrior' | 'archer' | 'mage' | 'cleric'
    | 'swordsman' | 'crossbowman' | 'shieldbearer' | 'shadowblade'
    | 'hammer' | 'spark' | 'scroll' | 'boss';

/**
 * 在 Graphics 里画职业/敌人纹章，半径 r（像素）。
 * 所有坐标以 r 为单位归一化后缩放，保证任意尺寸一致。
 */
export function drawEmblem(
    g: Graphics, kind: string, r: number, colorHex: string, lineAlpha = 235, fillAlpha = 46,
): void {
    const c = hex(colorHex, lineAlpha);
    const fill = hex(colorHex, fillAlpha);
    const lw = Math.max(1.6, r * 0.11);

    g.lineWidth = lw;
    g.strokeColor = c;
    g.fillColor = fill;

    switch (kind) {
        case 'warrior': {
            // 盾牌
            const shield = [
                [0, 0.92], [0.68, 0.6], [0.52, -0.34], [0, -0.92], [-0.52, -0.34], [-0.68, 0.6],
            ].map(([x, y]) => ({ x: x * r, y: y * r }));
            tracePoly(g, shield, true);
            g.fill();
            tracePoly(g, shield, true);
            g.stroke();
            // 剑
            g.moveTo(0, 0.55 * r); g.lineTo(0, -0.5 * r);
            g.moveTo(-0.32 * r, 0.12 * r); g.lineTo(0.32 * r, 0.12 * r);
            g.moveTo(-0.12 * r, -0.5 * r); g.lineTo(0.12 * r, -0.5 * r);
            g.stroke();
            break;
        }
        case 'archer':
        case 'crossbowman': {
            // 弓
            g.moveTo(-0.62 * r, -0.8 * r);
            g.bezierCurveTo(0.35 * r, -0.6 * r, 0.35 * r, 0.6 * r, -0.62 * r, 0.8 * r);
            g.stroke();
            // 弦
            g.moveTo(-0.62 * r, -0.8 * r); g.lineTo(-0.62 * r, 0.8 * r);
            g.stroke();
            // 箭
            g.moveTo(-0.82 * r, 0); g.lineTo(0.72 * r, 0);
            g.stroke();
            g.fillColor = c;
            tracePoly(g, [
                { x: 0.86 * r, y: 0 }, { x: 0.5 * r, y: 0.22 * r }, { x: 0.5 * r, y: -0.22 * r },
            ], true);
            g.fill();
            break;
        }
        case 'mage': {
            // 结晶
            const crystal = [
                { x: 0, y: 0.9 * r }, { x: 0.5 * r, y: 0.16 * r }, { x: 0.3 * r, y: -0.5 * r },
                { x: 0, y: -0.9 * r }, { x: -0.3 * r, y: -0.5 * r }, { x: -0.5 * r, y: 0.16 * r },
            ];
            tracePoly(g, crystal, true);
            g.fill();
            tracePoly(g, crystal, true);
            g.stroke();
            // 内层
            g.moveTo(0, 0.45 * r); g.lineTo(0.24 * r, 0.05 * r); g.lineTo(0, -0.45 * r); g.lineTo(-0.24 * r, 0.05 * r);
            g.close();
            g.stroke();
            // 环绕光点
            g.fillColor = c;
            g.circle(0.62 * r, 0.5 * r, 0.08 * r); g.fill();
            g.circle(-0.62 * r, -0.5 * r, 0.08 * r); g.fill();
            break;
        }
        case 'cleric': {
            // 十字
            const cross = [
                { x: -0.2 * r, y: 0.72 * r }, { x: 0.2 * r, y: 0.72 * r }, { x: 0.2 * r, y: 0.18 * r },
                { x: 0.72 * r, y: 0.18 * r }, { x: 0.72 * r, y: -0.18 * r }, { x: 0.2 * r, y: -0.18 * r },
                { x: 0.2 * r, y: -0.82 * r }, { x: -0.2 * r, y: -0.82 * r }, { x: -0.2 * r, y: -0.18 * r },
                { x: -0.72 * r, y: -0.18 * r }, { x: -0.72 * r, y: 0.18 * r }, { x: -0.2 * r, y: 0.18 * r },
            ];
            tracePoly(g, cross, true);
            g.fill();
            tracePoly(g, cross, true);
            g.stroke();
            // 光环
            g.circle(0, 0.9 * r, 0.14 * r);
            g.stroke();
            break;
        }
        case 'shieldbearer': {
            const shield = [
                { x: 0, y: 0.9 * r }, { x: 0.66 * r, y: 0.62 * r }, { x: 0.55 * r, y: -0.42 * r },
                { x: 0, y: -0.9 * r }, { x: -0.55 * r, y: -0.42 * r }, { x: -0.66 * r, y: 0.62 * r },
            ];
            tracePoly(g, shield, true); g.fill();
            tracePoly(g, shield, true); g.stroke();
            g.moveTo(0, 0.42 * r); g.lineTo(0, -0.42 * r);
            g.stroke();
            break;
        }
        case 'shadowblade': {
            // 匕首
            g.fillColor = c;
            tracePoly(g, [
                { x: 0, y: 0.9 * r }, { x: 0.2 * r, y: 0.05 * r }, { x: 0, y: -0.22 * r }, { x: -0.2 * r, y: 0.05 * r },
            ], true);
            g.fill();
            g.moveTo(-0.38 * r, -0.2 * r); g.lineTo(0.38 * r, -0.2 * r);
            g.moveTo(0, -0.2 * r); g.lineTo(0, -0.8 * r);
            g.stroke();
            break;
        }
        case 'boss': {
            // 王冠 + 尖齿
            const crown = [
                { x: -0.85 * r, y: 0.2 * r }, { x: -0.6 * r, y: 0.8 * r }, { x: -0.3 * r, y: 0.28 * r },
                { x: 0, y: 0.92 * r }, { x: 0.3 * r, y: 0.28 * r }, { x: 0.6 * r, y: 0.8 * r },
                { x: 0.85 * r, y: 0.2 * r }, { x: 0.7 * r, y: -0.3 * r }, { x: -0.7 * r, y: -0.3 * r },
            ];
            tracePoly(g, crown, true); g.fill();
            tracePoly(g, crown, true); g.stroke();
            // 双眼
            g.fillColor = c;
            g.circle(-0.28 * r, -0.62 * r, 0.12 * r); g.fill();
            g.circle(0.28 * r, -0.62 * r, 0.12 * r); g.fill();
            break;
        }
        case 'swordsman': {
            // 交叉双剑
            g.moveTo(-0.62 * r, 0.72 * r); g.lineTo(0.62 * r, -0.72 * r);
            g.moveTo(0.62 * r, 0.72 * r); g.lineTo(-0.62 * r, -0.72 * r);
            g.stroke();
            g.moveTo(-0.3 * r, 0.42 * r); g.lineTo(-0.62 * r, 0.72 * r);
            g.moveTo(0.3 * r, 0.42 * r); g.lineTo(0.62 * r, 0.72 * r);
            g.stroke();
            break;
        }
        case 'hammer': {
            // 铁锤（淬炼）：斜置锤头 + 手柄
            const head = [
                { x: -0.82 * r, y: 0.02 * r }, { x: -0.3 * r, y: 0.62 * r },
                { x: 0.04 * r, y: 0.3 * r }, { x: -0.48 * r, y: -0.3 * r },
            ];
            tracePoly(g, head, true); g.fill();
            tracePoly(g, head, true); g.stroke();
            g.lineWidth = lw * 0.9;
            g.moveTo(-0.2 * r, -0.18 * r); g.lineTo(0.62 * r, -0.86 * r);
            g.stroke();
            break;
        }
        case 'spark': {
            // 四角星（精进）：主星 + 侧边小星
            const star: { x: number; y: number }[] = [];
            for (let i = 0; i < 8; i++) {
                const ang = Math.PI / 2 + (i * Math.PI) / 4;
                const rad = i % 2 === 0 ? r : r * 0.3;
                star.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
            }
            tracePoly(g, star, true); g.fill();
            tracePoly(g, star, true); g.stroke();
            g.fillColor = c;
            g.circle(0.78 * r, 0.62 * r, 0.13 * r); g.fill();
            break;
        }
        case 'scroll': {
            // 卷轴（秘传）：正文 + 三道墨线 + 卷边
            g.roundRect(-0.62 * r, -0.78 * r, 1.24 * r, 1.56 * r, 0.2 * r);
            g.fill();
            g.roundRect(-0.62 * r, -0.78 * r, 1.24 * r, 1.56 * r, 0.2 * r);
            g.stroke();
            g.lineWidth = Math.max(1.4, r * 0.09);
            for (const y of [0.4, 0.06, -0.28]) {
                g.moveTo(-0.34 * r, y * r); g.lineTo(0.34 * r, y * r);
            }
            g.stroke();
            g.fillColor = c;
            g.circle(0, -0.56 * r, 0.1 * r); g.fill();
            break;
        }
        default: {
            g.circle(0, 0, 0.7 * r);
            g.stroke();
            g.circle(0, 0, 0.2 * r);
            g.fill();
            break;
        }
    }
}

function tracePoly(g: Graphics, pts: { x: number; y: number }[], close = false): void {
    if (!pts.length) return;
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    if (close) g.close();
}

/** 路线节点图标（矢量，替代 emoji）：战斗/精英/商店/休息/事件/Boss */
export function drawRouteGlyph(g: Graphics, type: string, r: number, colorHex: string): void {
    const c = hex(colorHex, 245);
    g.strokeColor = c;
    g.fillColor = c;
    const lw = Math.max(2.5, r * 0.16);

    switch (type) {
        case 'battle': {
            g.lineWidth = lw;
            g.moveTo(-r * 0.7, r * 0.7); g.lineTo(r * 0.7, -r * 0.7);
            g.moveTo(r * 0.7, r * 0.7); g.lineTo(-r * 0.7, -r * 0.7);
            g.stroke();
            g.lineWidth = lw * 0.8;
            g.moveTo(-r * 0.6, r * 0.15); g.lineTo(-r * 0.15, r * 0.6);
            g.moveTo(r * 0.6, r * 0.15); g.lineTo(r * 0.15, r * 0.6);
            g.stroke();
            break;
        }
        case 'elite': {
            const pts: { x: number; y: number }[] = [];
            for (let i = 0; i < 10; i++) {
                const ang = Math.PI / 2 + (i * Math.PI) / 5;
                const rad = i % 2 === 0 ? r : r * 0.45;
                pts.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
            }
            tracePoly(g, pts, true);
            g.fill();
            break;
        }
        case 'shop': {
            g.lineWidth = lw;
            g.circle(0, 0, r * 0.8); g.stroke();
            g.circle(0, 0, r * 0.42); g.stroke();
            g.lineWidth = lw * 0.8;
            g.moveTo(0, r * 0.8); g.lineTo(0, -r * 0.8);
            g.stroke();
            break;
        }
        case 'rest': {
            tracePoly(g, [
                { x: 0, y: r }, { x: r * 0.6, y: r * 0.1 }, { x: r * 0.35, y: -r * 0.75 },
                { x: -r * 0.35, y: -r * 0.75 }, { x: -r * 0.6, y: r * 0.1 },
            ], true);
            g.fill();
            g.fillColor = hex(COLOR.PANEL_BG, 220);
            g.ellipse(0, -r * 0.35, r * 0.24, r * 0.38);
            g.fill();
            break;
        }
        case 'event': {
            g.lineWidth = lw;
            tracePoly(g, [
                { x: 0, y: r }, { x: r, y: 0 }, { x: 0, y: -r }, { x: -r, y: 0 },
            ], true);
            g.stroke();
            g.circle(0, r * 0.12, r * 0.16); g.fill();
            g.circle(0, -r * 0.42, r * 0.11); g.fill();
            break;
        }
        case 'boss': {
            tracePoly(g, [
                { x: -r * 0.85, y: r * 0.2 }, { x: -r * 0.6, y: r * 0.85 }, { x: -r * 0.3, y: r * 0.32 },
                { x: 0, y: r * 0.95 }, { x: r * 0.3, y: r * 0.32 }, { x: r * 0.6, y: r * 0.85 },
                { x: r * 0.85, y: r * 0.2 }, { x: r * 0.7, y: -r * 0.5 }, { x: -r * 0.7, y: -r * 0.5 },
            ], true);
            g.fill();
            break;
        }
        default: {
            g.lineWidth = lw;
            g.circle(0, 0, r * 0.7); g.stroke();
            break;
        }
    }
}

/**
 * 圆形勋章：暗底 + 职业色外环 + 矢量纹章。
 * @param ringColorHex 外环颜色（默认取 accentHex）
 */
export function makeMedallion(
    parent: Node, name: string, kind: string, accentHex: string,
    radius: number, x: number, y: number, ringColorHex?: string,
): Node {
    const node = ensureChild(parent, name, radius * 2 + 8, radius * 2 + 8);
    node.setPosition(x, y, 0);
    const g = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    g.clear();
    // 外环光晕
    g.fillColor = hex(accentHex, 34);
    g.circle(0, 0, radius + 4);
    g.fill();
    // 内盘
    g.fillColor = hex(COLOR.SLOT_EMPTY_BG, 245);
    g.circle(0, 0, radius);
    g.fill();
    // 环
    g.strokeColor = hex(ringColorHex ?? accentHex, 220);
    g.lineWidth = Math.max(2, radius * 0.075);
    g.circle(0, 0, radius - 1);
    g.stroke();
    // 内细环
    g.strokeColor = hex(accentHex, 70);
    g.lineWidth = 1.5;
    g.circle(0, 0, radius * 0.82);
    g.stroke();
    // 纹章
    drawEmblem(g, kind, radius * 0.56, accentHex, 240, 40);
    return node;
}

// ==================== 表现层：属性条 / 徽章 / 按钮 ====================

/**
 * 属性条：左标签 + 中间轨道 + 右数值。
 *
 * 两个坑（实测截图确认）：
 * 1. `roundRectPath` 是以**节点原点为圆心**画的，配套 `anchorPoint(0, 0.5)` 对 Graphics 的
 *    绘制坐标毫无影响 —— 旧版进度条因此整体左移半个条宽，直接压在「生命」两个字上面。
 *    这里改成显式 `roundRect(0, -h/2, fillW, h, r)`：节点原点 = 轨道左端，往右画多少就是多少。
 * 2. 标签用 FONT_TINY(13) 在手机上只有 ~7px，中文糊成一团；改用 FONT_CAPTION(16)，
 *    并把数值写在右端，一眼能读出强弱而不只是"一条绿条"。
 */
export function makeStatBar(
    parent: Node, name: string, labelText: string, ratio: number,
    colorHex: string, x: number, y: number, width: number, valueText = '',
): Node {
    const ROW_H = 22;
    const BAR_H = 8;
    const LABEL_W = 44;
    const VALUE_W = 38;
    const GAP = 8;
    const halfW = width / 2;

    const row = ensureChild(parent, name, width, ROW_H);
    row.setPosition(x, y, 0);

    makeLabel(row, 'label', labelText, FONT_CAPTION, COLOR.TEXT_SECONDARY, 'left', LABEL_W, FONT_CAPTION.lineHeight)
        .node.setPosition(-halfW + LABEL_W / 2, 0, 0);

    if (valueText) {
        makeLabel(row, 'value', valueText, FONT_CAPTION, colorHex, 'right', VALUE_W, FONT_CAPTION.lineHeight)
            .node.setPosition(halfW - VALUE_W / 2, 0, 0);
    }

    const trackW = Math.max(24, width - LABEL_W - VALUE_W - GAP * 2);
    const track = ensureChild(row, 'track', trackW, BAR_H);
    track.setPosition(-halfW + LABEL_W + GAP + trackW / 2, 0, 0);
    const tg = track.getComponent(Graphics) ?? track.addComponent(Graphics);
    tg.clear();
    tg.fillColor = hex(COLOR.SLOT_EMPTY_BG, 255);
    roundRectPath(tg, trackW, BAR_H, BAR_H / 2);
    tg.fill();

    const clamped = Math.max(0, Math.min(1, ratio));
    const fillW = Math.max(6, trackW * clamped);
    // 节点原点放在轨道左端，图形从 0 往右画（不用 anchorPoint 补偿）
    const fill = ensureChild(track, 'fill', fillW, BAR_H);
    fill.setPosition(-trackW / 2, 0, 0);
    const fg = fill.getComponent(Graphics) ?? fill.addComponent(Graphics);
    fg.clear();
    fg.fillColor = hex(colorHex, 255);
    fg.roundRect(0, -BAR_H / 2, fillW, BAR_H, BAR_H / 2);
    fg.fill();

    return row;
}

/** 小徽章（圆角块 + 居中文字），返回节点 */
export function makeChip(
    parent: Node, name: string, text: string, colorHex: string,
    x: number, y: number, width = 78, height = 24, textColorHex = COLOR.TEXT_PRIMARY,
): Node {
    const chip = ensureChild(parent, name, width, height);
    chip.setPosition(x, y, 0);
    const g = chip.getComponent(Graphics) ?? chip.addComponent(Graphics);
    g.clear();
    g.fillColor = hex(colorHex, 230);
    roundRectPath(g, width, height, height / 2);
    g.fill();
    makeLabel(chip, 'text', text, FONT_TINY, textColorHex, 'center', width - 8, height - 2);
    return chip;
}

/** 圆点状态灯 */
export function makeDot(parent: Node, name: string, colorHex: string, r: number, x: number, y: number): Node {
    const node = ensureChild(parent, name, r * 2, r * 2);
    node.setPosition(x, y, 0);
    const g = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    g.clear();
    g.fillColor = hex(colorHex, 255);
    g.circle(0, 0, r);
    g.fill();
    return node;
}

/** 带圆角底板 + 文字的按钮外观（Button 组件由调用方决定是否追加） */
export function styleButton(
    node: Node, width: number, height: number, fillHex: string, radius = 12, borderHex = COLOR.PANEL_BORDER,
): Graphics {
    return drawFrame(node, {
        width, height, radius,
        fill: fillHex, fillAlpha: 255,
        border: borderHex, borderAlpha: 200, borderWidth: 2,
    });
}

/** 往节点追加 Button（SCALE 过渡，避免 COLOR 过渡冲掉自定义底板配色） */
export function ensureScaleButton(node: Node): Button {
    let btn = node.getComponent(Button);
    if (!btn) btn = node.addComponent(Button);
    btn.transition = Button.Transition.SCALE;
    btn.zoomScale = 0.96;
    return btn;
}

/**
 * 给**已有面板**套统一外框（商店 / 圣泉 / 战斗内的临时面板）。
 *
 * 面板是场景节点（自带贴图底板），不能直接加 Graphics（渲染组件互斥），
 * 因此在一个子节点上画：圆角双线描边 + 顶部强调条 + 四角括线。
 *
 * 关键：该子节点的 UITransform 只有 1×1 —— 只是为了让 Graphics 有承载节点，
 * 不参与面板背景的包围盒计算，否则每次重算都会把面板越撑越大。
 */
export function stylePanel(panel: Node, accentHex: string, fillHex = '#141B28'): void {
    if (!panel?.isValid) return;
    const ui = panel.getComponent(UITransform);
    if (!ui) return;

    // 面板自身底板统一成深蓝（有 Sprite 才改色，没有就只画框）
    const sp = panel.getComponent(Sprite);
    if (sp) sp.color = hex(fillHex, 252);

    const w = ui.width;
    const h = ui.height;
    if (w <= 2 || h <= 2) return;

    const frame = ensureChild(panel, 'PanelFrameGfx', 1, 1);
    frame.setSiblingIndex(0);
    // 子节点坐标原点是父节点锚点，换算成"面板中心"再居中绘制
    frame.setPosition((0.5 - ui.anchorPoint.x) * w, (0.5 - ui.anchorPoint.y) * h, 0);

    const g = frame.getComponent(Graphics) ?? frame.addComponent(Graphics);
    g.clear();

    // 外框 + 内细线
    g.strokeColor = hex(accentHex, 95);
    g.lineWidth = 2;
    roundRectPath(g, w - 6, h - 6, 22);
    g.stroke();
    g.strokeColor = hex(accentHex, 34);
    g.lineWidth = 1;
    roundRectPath(g, w - 18, h - 18, 18);
    g.stroke();

    // 顶部强调条（中段亮、两端淡）
    const barW = Math.min(w - 80, 220);
    const barY = h / 2 - 14;
    g.fillColor = hex(accentHex, 60);
    g.roundRect(-(w / 2 - 28), barY - 1, w - 56, 2, 1);
    g.fill();
    g.fillColor = hex(accentHex, 235);
    g.roundRect(-barW / 2, barY - 2, barW, 4, 2);
    g.fill();

    // 四角括线
    drawCornerBrackets(frame, w - 10, h - 10, accentHex, 120, 22);
}

/** 圆形进度/能量条（用于单位或卡片角落） */
export function drawRing(
    g: Graphics, radius: number, ratio: number, colorHex: string, trackHex = COLOR.SLOT_EMPTY_BG, lineWidth = 4,
): void {
    g.strokeColor = hex(trackHex, 255);
    g.lineWidth = lineWidth;
    g.circle(0, 0, radius);
    g.stroke();
    if (ratio <= 0) return;
    const start = Math.PI / 2;
    const end = start - Math.PI * 2 * Math.max(0, Math.min(1, ratio));
    g.strokeColor = hex(colorHex, 255);
    g.lineWidth = lineWidth;
    g.arc(0, 0, radius, start, end, true);
    g.stroke();
}
