/**
 * 小游戏通用运行时 UI 工具。
 *
 * 所有控件都在代码里创建，不改场景文件；视觉统一用 Graphics 画圆角块 + Label。
 *
 * 约定：
 *  - 触摸回调统一走**具名**的模块级 handler（红线 5），按钮把回调挂在节点上；
 *  - 图标字符串一律过 `stripVariationSelectors()`（红线 10，避免微信 tofu）；
 *  - 节点层级取父节点的 layer，保证 UI 相机能渲染。
 */

import {
    Camera,
    Color,
    director,
    EventTouch,
    Graphics,
    HorizontalTextAlignment,
    Label,
    Node,
    Tween,
    UIOpacity,
    UITransform,
    VerticalTextAlignment,
    tween,
    Vec3,
} from 'cc';

// ==================== 配色 ====================

export const UI = {
    bg: '#0B1220',
    bgSoft: '#111B2E',
    panel: '#151F33',
    panelStroke: '#27364F',
    text: '#F8FAFC',
    textDim: '#94A3B8',
    textMuted: '#64748B',
    accent: '#38BDF8',
    accentDark: '#0E7490',
    primary: '#2563EB',
    success: '#22C55E',
    danger: '#EF4444',
    warning: '#F59E0B',
    white: '#FFFFFF',
    overlay: '#050912',
};

// ==================== 基础 ====================

/**
 * 把当前场景相机清屏色改成统一的深蓝。
 *
 * 场景自带的相机默认是纯黑，切进来会和其它用 GameUIKit 的游戏明显不是一套 UI；
 * 这些场景又没有全屏底图，所以在 onLoad 里直接改相机即可（随场景销毁自动还原）。
 */
export function applySceneClearColor(hex: string = UI.bg): void {
    const scene = director.getScene();
    if (!scene) return;
    const canvas = scene.getChildByName('Canvas');
    if (!canvas) return;
    const camera = canvas.getComponentInChildren(Camera);
    if (camera) camera.clearColor = toColor(hex);
}

/** `#RRGGBB` / `#RRGGBBAA` → Color */
export function toColor(hex: string, alpha = 255): Color {
    let h = hex.replace('#', '');
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

/** 去掉变体选择符（U+FE0E / U+FE0F）——微信字体里会渲染成方框；用转义写，避免源码里躺看不见的字符 */
export function stripVariationSelectors(text: string): string {
    return text.replace(/[\uFE0E\uFE0F]/g, '');
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
    const btn = createButton(parent, {
        w: 72,
        h: 72,
        text: '‹',
        fontSize: 46,
        fill: '#1B2740',
        textColor: UI.text,
        radius: 36,
        onTap,
    });
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
