/**
 * 方块坠落 — 界面皮肤：圆角面板 / 按钮 / 开关 / 方块砖块都在这画。
 *
 * 为什么改用 `Graphics`：场景里的面板与按钮原本都是一块**纯色 Sprite**，
 * 四角是直角、没有描边，缩放后显得很粗糙。换贴图要新做美术资源，
 * 用 `Graphics.roundRect` 现画则一处代码统一所有圆角与配色。
 *
 * 约定：
 * - 皮肤**不删原组件**，只把 `Sprite.enabled` 关掉（内置组件删不掉，见验收报告 §7）；
 * - 因此 `ButtonInput` 里「改 Sprite 颜色表示按下」的反馈会失效，按下态由
 *   `TetrisSkinButton` 自己重画（变暗 + 轻微下沉）；
 * - 触摸回调全部是具名方法（红线 5），`onDestroy` 不碰节点（红线 4）。
 */

import { _decorator, Color, Component, Graphics, Label, Node, Sprite, UIRenderer, UITransform } from 'cc';
import { TetrisSkinFollower } from './TetrisSkinFollower';
import {
    UI_ACCENT,
    UI_ACCENT_LIGHT,
    UI_ACCENT_SOFT,
    UI_BG_BOTTOM,
    UI_BG_TOP,
    UI_CARD,
    UI_DANGER,
    UI_DANGER_STROKE,
    UI_ICON_DIM,
    UI_ROW,
    UI_STROKE,
    UI_TEXT,
    UI_TEXT_DIM,
} from './TetrisConfig';

const { ccclass } = _decorator;

// ==================== 样式表 ====================

export type SkinStyle =
    | 'card' // 大面板底
    | 'primary' // 主操作（蓝色实心）
    | 'secondary' // 次要操作 / 列表行（深蓝实心）
    | 'ghost' // 透明底，只有描边
    | 'danger' // 退出类操作：透明底 + 红字
    | 'option' // 选项未选中
    | 'optionSelected' // 选项已选中
    | 'accent'; // 强调按钮（硬降）

interface SkinSpec {
    fill: string;
    stroke: string;
    text: string;
    radius: number;
}

const STYLES: Record<SkinStyle, SkinSpec> = {
    card: { fill: UI_CARD, stroke: UI_STROKE, text: UI_TEXT, radius: 38 },
    primary: { fill: UI_ACCENT, stroke: UI_ACCENT_LIGHT, text: '#FFFFFF', radius: 28 },
    secondary: { fill: UI_ROW, stroke: UI_STROKE, text: UI_TEXT, radius: 26 },
    ghost: { fill: '', stroke: UI_STROKE, text: UI_TEXT_DIM, radius: 26 },
    danger: { fill: '', stroke: UI_DANGER_STROKE, text: UI_DANGER, radius: 26 },
    option: { fill: UI_ROW, stroke: UI_STROKE, text: UI_TEXT, radius: 24 },
    optionSelected: { fill: UI_ACCENT, stroke: UI_ACCENT_LIGHT, text: '#FFFFFF', radius: 24 },
    accent: { fill: UI_ACCENT_SOFT, stroke: UI_ACCENT, text: '#DBEAFE', radius: 26 },
};

/** 按下时的整体压暗系数 */
const PRESS_DARKEN = 0.82;

export type SkinIcon = 'pause' | 'back' | 'chevronRight';

export interface SkinOptions {
    /** 显式尺寸：不传则读节点 UITransform（面板按钮都用节点尺寸） */
    width?: number;
    height?: number;
    /** 不传则按短边算圆角 */
    radius?: number;
    icon?: SkinIcon;
    /** 画图示时把同名文字藏掉（暂停/返回按钮） */
    hideLabel?: boolean;
    /** 在行尾画一个开关（震动行）；`undefined` = 不画 */
    toggle?: boolean;
}

export interface CardOptions {
    width?: number;
    height?: number;
    radius?: number;
    fill?: string;
    stroke?: string;
    /** 卡片内的分隔线（局部坐标）：y、左右端点 */
    dividers?: Array<{ y: number; from: number; to: number }>;
}

// ==================== 颜色工具 ====================

const COLOR_CACHE: Map<string, Color> = new Map<string, Color>();

/** 十六进制 → Color（带缓存，绘制时不要每次都 new） */
export function colorOf(hex: string): Color {
    let color = COLOR_CACHE.get(hex);
    if (!color) {
        color = new Color();
        color.fromHEX(hex);
        COLOR_CACHE.set(hex, color);
    }
    return color.clone();
}

export function withAlpha(color: Color, alpha: number): Color {
    return new Color(color.r, color.g, color.b, alpha);
}

function shade(color: Color, factor: number, alpha = 255): Color {
    return new Color(
        Math.round(color.r * factor),
        Math.round(color.g * factor),
        Math.round(color.b * factor),
        alpha,
    );
}

/** 两色线性插值（t=0 取 bottom，t=1 取 top） */
export function mixColor(bottom: string, top: string, t: number): Color {
    const a = colorOf(bottom);
    const b = colorOf(top);
    const k = Math.max(0, Math.min(1, t));
    return new Color(
        Math.round(a.r + (b.r - a.r) * k),
        Math.round(a.g + (b.g - a.g) * k),
        Math.round(a.b + (b.b - a.b) * k),
        255,
    );
}

// ==================== 基础绘制 ====================

/** 皮肤子节点的名字：有 Sprite 的节点把 Graphics 画在它身上 */
const SKIN_NODE = '__skin';

/** 底纹兄弟节点的名字前缀：自身就是 Label 的节点（胶囊、提示条）用 */
const SKIN_SIBLING = '__skin_';

/**
 * 取一个能画皮肤的 Graphics。
 *
 * 注意：同一节点上只能有**一个** UIRenderer 生效：实测给已有 `Sprite`（或 `Label`）的节点补 Graphics，
 * `enabled=true`、命令也记录了，但**完全不渲染**（引擎按节点挑第一个 UIRenderer）。
 * 所以皮肤要挪到别的节点上画，位置分两种：
 * - 目标是 `Sprite`：皮肤画在子节点上（Sprite 反正会被关掉），子节点天然在该节点之后绘制；
 * - 目标是 `Label`：**不能**用子节点 —— 引擎先画节点自己的 Label 再画子节点，
 *   子节点会盖住文字（实测提示底纹直接盖掉了「暂存」那行说明）。改用**前一个兄弟节点**，
 *   它在 Label 之前绘制，也就是垫在文字下面。
 */
export function ensureGraphics(node: Node): Graphics {
    if (!hasOtherRenderer(node)) {
        let own = node.getComponent(Graphics);
        if (!own) own = node.addComponent(Graphics);
        return own;
    }
    if (node.getComponent(Label)) return siblingSkin(node);
    return childSkin(node);
}

/** 子节点皮肤（Sprite 节点） */
function childSkin(node: Node): Graphics {
    let child = node.getChildByName(SKIN_NODE);
    if (!child) {
        child = new Node(SKIN_NODE);
        child.layer = node.layer;
        child.addComponent(UITransform);
        node.insertChild(child, 0);
    }
    let graphics = child.getComponent(Graphics);
    if (!graphics) graphics = child.addComponent(Graphics);
    return graphics;
}

/**
 * 兄弟节点皮肤（Label 节点）：插在自己前一位。
 *
 * 位置与显隐由 {@link TetrisSkinFollower} 跟着标签走 —— 面板会 `node.active = false`
 * 来藏「新纪录」这类胶囊，兄弟节点不跟就会剩下一块空底纹。
 */
function siblingSkin(node: Node): Graphics {
    const parent = node.parent;
    if (!parent) {
        // 理论上不会走到这里；兜底退回自身，至少不会崩
        let own = node.getComponent(Graphics);
        if (!own) own = node.addComponent(Graphics);
        return own;
    }

    const name = SKIN_SIBLING + node.name;
    let sibling = parent.getChildByName(name);
    if (!sibling) {
        sibling = new Node(name);
        sibling.layer = node.layer;
        sibling.addComponent(UITransform);
        parent.insertChild(sibling, node.getSiblingIndex());
    }

    // 底纹的显隐/位置由挂在标签上的 TetrisSkinFollower 同步
    let follower = node.getComponent(TetrisSkinFollower);
    if (!follower) follower = node.addComponent(TetrisSkinFollower);
    follower.attach(sibling);

    let graphics = sibling.getComponent(Graphics);
    if (!graphics) graphics = sibling.addComponent(Graphics);
    return graphics;
}

/** 让底纹兄弟节点跟着目标 Label 节点：位置、缩放、显隐（组件见 TetrisSkinFollower.ts） */

/** 节点上是否已有 Sprite / Label 这类非 Graphics 的渲染组件（皮肤要避开的） */
function hasOtherRenderer(node: Node): boolean {
    for (const comp of node.components) {
        if (comp instanceof UIRenderer && !(comp instanceof Graphics)) return true;
    }
    return false;
}

/** 关掉占位的纯色 Sprite：圆角由 Graphics 交代，方形底色不能留 */
function hideSprite(node: Node): void {
    const sprite = node.getComponent(Sprite);
    if (sprite && sprite.enabled) {
        sprite.enabled = false;
    }
}

/** 画一块圆角矩形（居中于节点原点） */
function paintSurface(
    g: Graphics,
    width: number,
    height: number,
    radius: number,
    fill: string,
    stroke: string,
    lineWidth: number,
    darken: number,
): void {
    if (fill) {
        g.fillColor = shade(colorOf(fill), darken);
        g.roundRect(-width / 2, -height / 2, width, height, radius);
        g.fill();
    } else if (darken < 1) {
        // 透明底按钮的按下反馈：铺一层很淡的白
        g.fillColor = new Color(255, 255, 255, 16);
        g.roundRect(-width / 2, -height / 2, width, height, radius);
        g.fill();
    }
    if (stroke) {
        g.lineWidth = lineWidth;
        g.strokeColor = shade(colorOf(stroke), darken);
        const inset = lineWidth / 2;
        g.roundRect(
            -width / 2 + inset,
            -height / 2 + inset,
            width - lineWidth,
            height - lineWidth,
            Math.max(0, radius - inset),
        );
        g.stroke();
    }
}

/**
 * 画一块「砖」：圆角实心 + 内层高光。
 * 棋盘、Ghost、HUD 预览共用，保证大小不同的方块观感一致。
 */
export function drawCell(
    g: Graphics,
    x: number,
    y: number,
    size: number,
    color: Color,
    look: 'solid' | 'ghost' = 'solid',
): void {
    const radius = Math.max(3, size * 0.26);

    if (look === 'ghost') {
        // 落点预览：只画描边 + 极淡的填充，玩家要能透过它看见棋盘
        g.fillColor = withAlpha(color, 26);
        g.roundRect(x, y, size, size, radius);
        g.fill();
        g.lineWidth = Math.max(1.5, size * 0.07);
        g.strokeColor = withAlpha(color, 190);
        g.roundRect(x, y, size, size, radius);
        g.stroke();
        return;
    }

    g.fillColor = color;
    g.roundRect(x, y, size, size, radius);
    g.fill();

    const inset = Math.max(2, size * 0.09);
    g.fillColor = new Color(255, 255, 255, 34);
    g.roundRect(x + inset, y + inset, size - inset * 2, size - inset * 2, Math.max(2, radius - inset));
    g.fill();
}

// ==================== 卡片 / 行 ====================

/** 把一块方形底色改成圆角卡片（可在上面补分隔线） */
export function skinCard(node: Node | null, options: CardOptions = {}): void {
    if (!node || !node.isValid) return;

    const transform = node.getComponent(UITransform);
    const width = options.width ?? (transform ? transform.width : 0);
    const height = options.height ?? (transform ? transform.height : 0);
    if (width <= 0 || height <= 0) return;

    const radius = options.radius ?? Math.min(width, height) * 0.06;
    const graphics = ensureGraphics(node);
    hideSprite(node);
    graphics.clear();
    paintSurface(
        graphics,
        width,
        height,
        radius,
        options.fill ?? UI_CARD,
        // 卡片默认带一道描边：纯色块叠在深色背景上没有边界，看着像贴图错位
        options.stroke ?? UI_STROKE,
        2,
        1,
    );

    const dividers = options.dividers;
    if (dividers) {
        // 用实心细矩形而不是 stroke()：实测在同一个 Graphics 里「先 fill 圆角矩形、再 stroke 一条线」，
        // 线段的描边几何不会被生成（同样的坐标画红也看不见），而 fill 一定生效。
        for (const line of dividers) {
            const thickness = 2;
            graphics.fillColor = withAlpha(colorOf('#3A4870'), 200);
            graphics.rect(line.from, line.y - thickness / 2, line.to - line.from, thickness);
            graphics.fill();
        }
    }
}

// ==================== 按钮 ====================

@ccclass('TetrisSkinButton')
export class TetrisSkinButton extends Component {
    private _style: SkinStyle = 'secondary';
    private _options: SkinOptions = {};
    private _pressed = false;
    private _bound = false;

    onLoad(): void {
        this._bind();
    }

    onDestroy(): void {
        // 与 TetrisGame.onDestroy 同因：场景销毁时节点的 _eventProcessor 可能已为 null，
        // 此时 off() 会抛异常。节点都没了，监听自然不存在，只丢标记（红线 4）。
        this._bound = false;
    }

    /** 应用样式；重复调用是幂等的（每次都会重画） */
    configure(style: SkinStyle, options: SkinOptions = {}): void {
        this._style = style;
        this._options = options;
        this._pressed = false;
        this._paint();
        this._styleLabel();
        this._bind();
    }

    /** 开关状态变化（震动行） */
    setToggle(on: boolean): void {
        if (this._options.toggle === on) return;
        this._options.toggle = on;
        this._paint();
    }

    get style(): SkinStyle {
        return this._style;
    }

    private _bind(): void {
        if (this._bound || !this.node.isValid) return;
        this._bound = true;
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    private _size(): { width: number; height: number } | null {
        const transform = this.node.getComponent(UITransform);
        const width = this._options.width ?? (transform ? transform.width : 0);
        const height = this._options.height ?? (transform ? transform.height : 0);
        if (width <= 0 || height <= 0) return null;
        return { width, height };
    }

    private _paint(): void {
        if (!this.node.isValid) return;

        const size = this._size();
        const graphics = ensureGraphics(this.node);
        hideSprite(this.node);
        graphics.clear();
        if (!size) return;

        const spec = STYLES[this._style];
        const radius = this._options.radius ?? Math.min(size.width, size.height) * 0.3;
        paintSurface(
            graphics,
            size.width,
            size.height,
            radius,
            spec.fill,
            spec.stroke,
            2,
            this._pressed ? PRESS_DARKEN : 1,
        );

        if (this._options.icon) {
            this._paintIcon(graphics, size);
        }
        if (this._options.toggle !== undefined) {
            paintToggle(graphics, size.width, this._options.toggle);
        }
    }

    private _paintIcon(graphics: Graphics, size: { width: number; height: number }): void {
        switch (this._options.icon) {
            case 'pause':
                graphics.fillColor = colorOf('#E2E8F0');
                graphics.roundRect(-13, -16, 9, 32, 4);
                graphics.fill();
                graphics.roundRect(4, -16, 9, 32, 4);
                graphics.fill();
                break;

            case 'back':
                graphics.lineWidth = 4;
                graphics.strokeColor = colorOf('#CBD5E1');
                graphics.moveTo(7, 13);
                graphics.lineTo(-6, 0);
                graphics.lineTo(7, -13);
                graphics.stroke();
                break;

            case 'chevronRight': {
                const x = size.width / 2 - 30;
                graphics.lineWidth = 2.5;
                graphics.strokeColor = colorOf(UI_ICON_DIM);
                graphics.moveTo(x - 4, 9);
                graphics.lineTo(x + 4, 0);
                graphics.lineTo(x - 4, -9);
                graphics.stroke();
                break;
            }
        }
    }

    /** 文字按样式上色；画图示时把文字整体藏掉 */
    private _styleLabel(): void {
        const labelNode = this.node.getChildByName('Label') || this.node.getChildByName('label');
        if (!labelNode || !labelNode.isValid) return;

        if (this._options.hideLabel) {
            labelNode.active = false;
            return;
        }
        labelNode.active = true;
        const label = labelNode.getComponent(Label);
        if (label) {
            label.color = colorOf(STYLES[this._style].text);
        }
    }

    private onTouchStart(): void {
        this._pressed = true;
        this._paint();
    }

    private onTouchEnd(): void {
        this._pressed = false;
        this._paint();
    }

    private onTouchCancel(): void {
        this._pressed = false;
        this._paint();
    }
}

/** 给节点套上按钮皮肤（幂等） */
export function skinButton(node: Node | null, style: SkinStyle, options: SkinOptions = {}): TetrisSkinButton | null {
    if (!node || !node.isValid) return null;
    let skin = node.getComponent(TetrisSkinButton);
    if (!skin) {
        skin = node.addComponent(TetrisSkinButton);
    }
    skin.configure(style, options);
    return skin;
}

/** 开关本体（右对齐在行尾） */
function paintToggle(graphics: Graphics, width: number, on: boolean): void {
    const trackWidth = 88;
    const trackHeight = 48;
    const centerX = width / 2 - 26 - trackWidth / 2;

    graphics.fillColor = on ? colorOf(UI_ACCENT) : colorOf('#33415C');
    graphics.roundRect(centerX - trackWidth / 2, -trackHeight / 2, trackWidth, trackHeight, trackHeight / 2);
    graphics.fill();

    graphics.fillColor = colorOf('#FFFFFF');
    const knobRadius = trackHeight / 2 - 6;
    const knobX = on ? centerX + trackWidth / 2 - trackHeight / 2 : centerX - trackWidth / 2 + trackHeight / 2;
    graphics.circle(knobX, 0, knobRadius);
    graphics.fill();
}

// ==================== 棋盘辅助层 ====================

/**
 * 落点所在的竖条光带：圆角 + 极低不透明度。
 * 原来是一块纯色 Sprite（直角、硬边），在圆角棋盘里看着像没清理干净的贴图。
 *
 * `emphasis`：软降加速期间加亮。此时横移被锁住、方块只受重力以外的「加速」驱动，
 * 光带变亮是唯一能告诉玩家「这一列已经定了」的反馈（两种操作模式共用）。
 */
export function skinBand(node: Node | null, width: number, height: number, emphasis = false): void {
    if (!node || !node.isValid) return;
    const graphics = ensureGraphics(node);
    hideSprite(node);
    graphics.clear();
    if (width <= 0 || height <= 0) return;

    graphics.fillColor = new Color(255, 255, 255, emphasis ? 34 : 12);
    graphics.roundRect(-width / 2, -height / 2, width, height, Math.min(18, width / 2));
    graphics.fill();
}

// ==================== 背景 ====================
/**
 * 竖向渐变背景。
 * `Graphics` 没有渐变填充，用几十条横向色带插值模拟；只在启动时画一次，
 * 不是每帧开销（1280 高、48 条 ≈ 每条 27px，色差极小，看不出接缝）。
 */
export function skinBackground(node: Node | null, bottom: string = UI_BG_BOTTOM, top: string = UI_BG_TOP): void {
    if (!node || !node.isValid) return;
    const transform = node.getComponent(UITransform);
    if (!transform) return;

    const width = transform.width;
    const height = transform.height;
    const graphics = ensureGraphics(node);
    hideSprite(node);
    graphics.clear();

    const bands = 48;
    const bandHeight = height / bands;
    for (let i = 0; i < bands; i++) {
        graphics.fillColor = mixColor(bottom, top, i / (bands - 1));
        graphics.rect(-width / 2, -height / 2 + bandHeight * i, width, bandHeight + 1);
        graphics.fill();
    }
}
