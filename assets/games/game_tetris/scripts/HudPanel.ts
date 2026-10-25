/**
 * 方块坠落 — HUD 渲染：分数 / 等级 / 行数、暂存预览、Next 预览。
 *
 * 只负责显示，不含任何规则逻辑。
 */

import { _decorator, Color, Component, Label, Node, SpriteFrame, Tween, Vec3, tween } from 'cc';
import { NEXT_MINI_CELL, PIECE_COLORS, UI_TEXT_DIM } from './TetrisConfig';
import { colorOf, drawCell, ensureGraphics, skinCard } from './TetrisSkin';
import { PieceType, ROTATIONS } from './TetrisPieces';

const { ccclass, property } = _decorator;

@ccclass('HudPanel')
export class HudPanel extends Component {
    @property(Label)
    scoreLabel: Label | null = null;

    @property(Label)
    levelLabel: Label | null = null;

    @property(Label)
    linesLabel: Label | null = null;

    @property(Node)
    holdPreviewRoot: Node | null = null;

    // 拆成三个独立属性：MCP 的 scene set-property 写不了 Node 数组
    @property({ type: Node, tooltip: '下一个预览 1' })
    nextPreview0: Node | null = null;

    @property({ type: Node, tooltip: '下一个预览 2' })
    nextPreview1: Node | null = null;

    @property({ type: Node, tooltip: '下一个预览 3' })
    nextPreview2: Node | null = null;

    @property({ type: Node, tooltip: '暂存卡片底板（圆角皮肤用）' })
    holdCard: Node | null = null;

    @property({ type: Node, tooltip: '下一个卡片底板（圆角皮肤用）' })
    nextCard: Node | null = null;

    /** 旧版预览用的贴图；M7 起改 Graphics 绘制，这里保留绑定以免场景数据失联 */
    @property(SpriteFrame)
    miniSpriteFrame: SpriteFrame | null = null;

    private _colorCache: Map<number, Color> = new Map<number, Color>();

    /** 上一帧的等级：升级时放大回弹一次（§5.4） */
    private _lastLevel = 0;

    private _nextRoots(): Node[] {
        const roots: Node[] = [];
        if (this.nextPreview0) roots.push(this.nextPreview0);
        if (this.nextPreview1) roots.push(this.nextPreview1);
        if (this.nextPreview2) roots.push(this.nextPreview2);
        return roots;
    }

    onLoad(): void {
        // 暂存/下一个两块的方形底色换成圆角卡片
        skinCard(this.holdCard, { radius: 26 });
        skinCard(this.nextCard, { radius: 26 });
        // 两张卡片的标题从白色改成次要色：视线优先给分数和方块
        this._dimTitle('HoldPanel', 'HoldTitle');
        this._dimTitle('NextPanel', 'NextTitle');
    }

    private _dimTitle(panelName: string, titleName: string): void {
        const panel = this.node.getChildByName(panelName);
        const title = panel ? panel.getChildByName(titleName) : null;
        const label = title ? title.getComponent(Label) : null;
        if (label) {
            label.color = colorOf(UI_TEXT_DIM);
        }
    }

    updateStats(score: number, level: number, lines: number): void {
        if (this.scoreLabel) {
            this.scoreLabel.string = formatScore(score);
        }
        if (this.levelLabel) {
            this.levelLabel.string = `等级 ${level}`;
            if (this._lastLevel > 0 && level > this._lastLevel) {
                this._popLevel();
            }
        }
        this._lastLevel = level;
        if (this.linesLabel) {
            this.linesLabel.string = `行 ${lines}`;
        }
    }

    /** 等级数字放大回弹：先停掉上一次的补间，避免连续升级时缩放叠加 */
    private _popLevel(): void {
        const node = this.levelLabel ? this.levelLabel.node : null;
        if (!node || !node.isValid) return;
        Tween.stopAllByTarget(node);
        node.setScale(1, 1, 1);
        tween(node)
            .to(0.08, { scale: new Vec3(1.3, 1.3, 1) })
            .to(0.14, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    setHold(type: PieceType | null): void {
        this._drawPreview(this.holdPreviewRoot, type);
    }

    setNext(types: PieceType[]): void {
        const roots = this._nextRoots();
        for (let i = 0; i < roots.length; i++) {
            this._drawPreview(roots[i], types[i] === undefined ? null : types[i]);
        }
    }

    /** 预览用 Graphics 现画圆角小格：20px 的贴图方块在圆角界面里太突兀 */
    private _drawPreview(root: Node | null, type: PieceType | null): void {
        if (!root || !root.isValid) return;

        const graphics = ensureGraphics(root);
        graphics.clear();
        if (type === null || type === undefined) return;

        const cells = ROTATIONS[type][0];
        let minX = Number.MAX_SAFE_INTEGER;
        let maxX = -Number.MAX_SAFE_INTEGER;
        let minY = Number.MAX_SAFE_INTEGER;
        let maxY = -Number.MAX_SAFE_INTEGER;
        for (const cell of cells) {
            minX = Math.min(minX, cell.x);
            maxX = Math.max(maxX, cell.x);
            minY = Math.min(minY, cell.y);
            maxY = Math.max(maxY, cell.y);
        }
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const color = this._pieceColor(type);
        const size = NEXT_MINI_CELL - 2;
        for (const cell of cells) {
            const cx = (cell.x - centerX) * NEXT_MINI_CELL;
            const cy = (cell.y - centerY) * NEXT_MINI_CELL;
            drawCell(graphics, cx - size / 2, cy - size / 2, size, color);
        }
    }

    private _pieceColor(type: PieceType): Color {
        let color = this._colorCache.get(type);
        if (!color) {
            color = new Color();
            color.fromHEX(PIECE_COLORS[type] || '#FFFFFF');
            this._colorCache.set(type, color);
        }
        return color;
    }
}

/** 千分位；不用 toLocaleString —— 小游戏部分机型缺 locale 数据 */
export function formatScore(value: number): string {
    const text = String(Math.max(0, Math.floor(value)));
    let out = '';
    for (let i = 0; i < text.length; i++) {
        if (i > 0 && (text.length - i) % 3 === 0) {
            out += ',';
        }
        out += text[i];
    }
    return out;
}
