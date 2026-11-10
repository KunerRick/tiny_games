/**
 * 冰箱底下 — 运行时性能面板（M1 调试 / 验收用）。
 *
 * 显示：FPS、帧时间（均值 / 峰值）、逻辑步耗时、渲染耗时、实体数、JS 堆占用。
 * 面板挂在 Canvas 顶部中间那颗「帧率」小按钮上，点一下开关；桌面也可按 F。
 *
 * 约束：
 *  - 只在可见时刷新文字（4 Hz），隐藏时几乎零开销
 *  - 全部节点运行时创建，不改场景
 *  - onDestroy 只解绑自身事件与清引用（红线 4）
 */

import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from 'cc';
import type { FridgeSnapshot } from './FridgeConfig';

const { ccclass } = _decorator;

/** 面板左上角（Canvas 坐标） */
const PANEL_X = -340;
const PANEL_Y = 470;
const PANEL_W = 360;
const PANEL_H = 96;
/** 文字刷新间隔（秒），避免每帧重建字符串 */
const REFRESH = 0.25;
/** 统计窗口（秒） */
const WINDOW = 1;

@ccclass('FridgePerf')
export class FridgePerf extends Component {
    /** 浏览器探针用 */
    visible = false;
    _fps = 0;
    _frameMs = 0;
    _maxFrameMs = 0;
    _logicMs = 0;
    _renderMs = 0;
    _heapMb = -1;

    private _panel: Node | null = null;
    private _toggleNode: Node | null = null;
    private _text: Label | null = null;
    private _bg: Graphics | null = null;
    private _toggleLabel: Label | null = null;
    private _safeTop = 0;
    /** 上次写进「帧率」按钮的读数，避免每帧重建字符串（面板开合也算变化） */
    private _shownKey = '';

    private _winTime = 0;
    private _winFrames = 0;
    private _winFrameMax = 0;
    private _winLogic = 0;
    private _winRender = 0;
    private _timer = 0;
    private _counts = { e: 0, b: 0, p: 0 };

    static create(parent: Node): FridgePerf {
        const node = new Node('FridgePerf');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        parent.addChild(node);
        return node.addComponent(FridgePerf);
    }

    onLoad(): void {
        this._buildToggle();
        this._buildPanel();
        this.setVisible(false);
        // 供页内探针读取，不影响逻辑
        const g = globalThis as unknown as { __fridgePerf?: FridgePerf };
        g.__fridgePerf = this;
    }

    onDestroy(): void {
        this._panel = null;
        this._toggleNode = null;
        this._text = null;
        this._bg = null;
        this._toggleLabel = null;
        const g = globalThis as unknown as { __fridgePerf?: FridgePerf };
        if (g.__fridgePerf === this) g.__fridgePerf = undefined;
    }

    /** 顶栏整体下移刘海高度（设计像素） */
    setSafeTop(top: number): void {
        this._safeTop = Math.max(0, top);
        if (this._toggleNode && this._toggleNode.isValid) {
            this._toggleNode.setPosition(0, 604 - this._safeTop, 0);
        }
        if (this._panel && this._panel.isValid) {
            this._panel.setPosition(PANEL_X + PANEL_W / 2, PANEL_Y - PANEL_H / 2 - this._safeTop, 0);
        }
    }

    toggle(): void {
        this.setVisible(!this.visible);
    }

    setVisible(v: boolean): void {
        this.visible = v;
        if (this._panel && this._panel.isValid) this._panel.active = v;
        this._updateToggleText();
        if (v) this._refreshText();
    }

    /** 每帧调用；不可见时只累计最少的统计量 */
    sample(dt: number, logicMs: number, renderMs: number, snap: FridgeSnapshot): void {
        if (dt <= 0) return;
        this._winTime += dt;
        this._winFrames++;
        const frameMs = dt * 1000;
        if (frameMs > this._winFrameMax) this._winFrameMax = frameMs;
        this._winLogic += logicMs;
        this._winRender += renderMs;
        this._counts.e = snap.enemies.length;
        this._counts.b = snap.bullets.length;
        this._counts.p = snap.pickups.length;

        if (this._winTime >= WINDOW) {
            const n = Math.max(1, this._winFrames);
            this._fps = Math.round(n / this._winTime);
            this._frameMs = (this._winTime * 1000) / n;
            this._maxFrameMs = this._winFrameMax;
            this._logicMs = this._winLogic / n;
            this._renderMs = this._winRender / n;
            this._winTime = 0;
            this._winFrames = 0;
            this._winFrameMax = 0;
            this._winLogic = 0;
            this._winRender = 0;
            this._updateToggleText();
        }

        if (!this.visible) return;
        this._timer += dt;
        if (this._timer >= REFRESH) {
            this._timer = 0;
            this._refreshText();
        }
    }

    // ==================== 构建 ====================

    private _buildToggle(): void {
        const node = new Node('PerfToggle');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(112, 40);
        node.setPosition(0, 604, 0);
        this.node.addChild(node);
        this._toggleNode = node;

        const gfx = node.addComponent(Graphics);
        gfx.fillColor = new Color(24, 30, 46, 200);
        gfx.roundRect(-56, -20, 112, 40, 10);
        gfx.fill();

        // 文字在按钮里水平、垂直都居中：帧率读数就写在这颗按钮上，
        // 不再在顶栏右侧另起一行（之前「帧率」和数字分居两处，看着散）
        const labelNode = new Node('Text');
        labelNode.layer = this.node.layer;
        const lut = labelNode.addComponent(UITransform);
        lut.setContentSize(104, 40);
        lut.setAnchorPoint(0.5, 0.5);
        labelNode.setPosition(0, 0, 0);
        const label = labelNode.addComponent(Label);
        label.fontSize = 17;
        label.lineHeight = 22;
        label.color = new Color(210, 230, 240, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.NONE;
        node.addChild(labelNode);
        this._toggleLabel = label;
        this._updateToggleText();

        node.on(Node.EventType.TOUCH_END, this.onToggleClicked, this);
    }

    /** 「帧率 59」/「帧率 59 ✓」，0 表示还没采到样本 */
    private _updateToggleText(): void {
        const v = this._fps;
        const key = `${v}|${this.visible ? 1 : 0}`;
        if (key === this._shownKey) return;
        this._shownKey = key;
        if (!this._toggleLabel) return;
        this._toggleLabel.string = (v > 0 ? `帧率 ${v}` : '帧率') + (this.visible ? ' ✓' : '');
    }

    private _buildPanel(): void {
        const node = new Node('PerfPanel');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(PANEL_W, PANEL_H);
        node.setPosition(PANEL_X + PANEL_W / 2, PANEL_Y - PANEL_H / 2, 0);
        this.node.addChild(node);
        this._panel = node;

        const gfx = node.addComponent(Graphics);
        gfx.fillColor = new Color(10, 14, 24, 190);
        gfx.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 10);
        gfx.fill();
        this._bg = gfx;

        const label = this._makeLabel(node, -PANEL_W / 2 + 12, PANEL_H / 2 - 10, 15, Label.HorizontalAlign.LEFT, PANEL_W - 24);
        label.lineHeight = 21;
        this._text = label;
    }

    private _makeLabel(parent: Node, x: number, y: number, size: number, align: number, width: number): Label {
        const node = new Node('Text');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(width, size * 2);
        ut.setAnchorPoint(align === Label.HorizontalAlign.LEFT ? 0 : 0.5, 1);
        node.setPosition(x, y, 0);
        const label = node.addComponent(Label);
        label.fontSize = size;
        label.lineHeight = Math.round(size * 1.35);
        label.color = new Color(210, 230, 240, 255);
        label.horizontalAlign = align;
        label.verticalAlign = Label.VerticalAlign.TOP;
        label.overflow = Label.Overflow.NONE;
        parent.addChild(node);
        return label;
    }

    private _refreshText(): void {
        const label = this._text;
        if (!label) return;
        const heap = this._readHeap();
        this._heapMb = heap;
        const fps = this._fps;
        const warn = this._frameMs > 20 ? ' ⚠' : '';
        label.string =
            `FPS ${fps}   帧 ${this._frameMs.toFixed(1)}ms（峰 ${this._maxFrameMs.toFixed(1)}）${warn}\n` +
            `逻辑 ${this._logicMs.toFixed(2)}ms   渲染 ${this._renderMs.toFixed(2)}ms\n` +
            `敌 ${this._counts.e}   弹 ${this._counts.b}   拾 ${this._counts.p}\n` +
            `堆 ${heap >= 0 ? heap.toFixed(1) + 'MB' : '—'}`;
    }

    private _readHeap(): number {
        const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
        return perf && perf.memory ? perf.memory.usedJSHeapSize / 1048576 : -1;
    }

    private onToggleClicked(): void {
        this.toggle();
    }
}
