/**
 * 方块坠落 — 底部提示条（设计文档 §4.2）。
 *
 * 提示**只做展示、不挂任何触摸监听**：HintBar 盖在手势层上面，
 * 一旦挂监听就会把全屏手势吃掉。
 *
 * 布局按模式二选一（按钮区占满了棋盘下方的空间，塞不下三行竖排）：
 * - 全屏手势：棋盘下方三行「拖动移动 / 轻点旋转 / 下拖加速」
 * - 虚拟按键：棋盘下方最低一条横线，已完成的那半句直接消失
 *
 * 第一次完成某个手势 → 对应提示降低到 40% 透明度（不用 ✓ 之类字符，红线 10）；
 * 全部完成或累计 3 局 → 整体隐藏。
 */

import { _decorator, Color, Component, Label, Node, UIOpacity } from 'cc';
import { COLOR_TEXT_SECONDARY } from './TetrisConfig';
import { ControlMode } from './TetrisInput';
import { drawIcon } from './TetrisIcons';

const { ccclass, property } = _decorator;

/** 提示条目的存储键（`TetrisStorage.getHintUsed()` 里的值） */
const HINT_KEYS = ['move', 'rotate', 'drop'];

const HINT_GESTURE = ['拖动移动', '轻点旋转', '下拖加速'];

/** 已完成条目的透明度（40%） */
const DONE_OPACITY = 102;
const ACTIVE_OPACITY = 255;

/** 累计多少局后自动隐藏 */
const HIDE_AFTER_GAMES = 3;

const ICON_COLOR = hexColor(COLOR_TEXT_SECONDARY);

@ccclass('HintBar')
export class HintBar extends Component {
    /** 手势模式的三行提示（行按 Row0/Row1/Row2 命名，顺序固定） */
    @property(Node)
    rowsRoot: Node | null = null;

    /** 按键模式的一条横线提示 */
    @property(Label)
    buttonHint: Label | null = null;

    private _rows: Node[] = [];
    private _labels: Array<Label | null> = [];
    private _opacities: Array<UIOpacity | null> = [];

    onLoad(): void {
        this._cacheRows();
        this._drawIcons();
    }

    /** 按当前模式与已完成记录重绘 */
    refresh(mode: ControlMode, used: string[], gamesPlayed: number): void {
        if (this._rows.length === 0) {
            this._cacheRows();
        }

        if (mode === 'gesture') {
            if (this.rowsRoot) {
                this.rowsRoot.active = this._refreshRows(used, gamesPlayed);
            }
            if (this.buttonHint) {
                this.buttonHint.node.active = false;
            }
            return;
        }

        if (this.rowsRoot) {
            this.rowsRoot.active = false;
        }
        this._refreshButtonHint(used, gamesPlayed);
    }

    // ==================== 内部 ====================

    /** @returns 三行是否应当显示 */
    private _refreshRows(used: string[], gamesPlayed: number): boolean {
        let allDone = true;

        for (let i = 0; i < this._rows.length; i++) {
            const label = this._labels[i];
            if (label) label.string = HINT_GESTURE[i] || '';

            const done = used.indexOf(HINT_KEYS[i]) >= 0;
            if (!done) allDone = false;

            const opacity = this._opacities[i];
            if (opacity) opacity.opacity = done ? DONE_OPACITY : ACTIVE_OPACITY;
        }

        return this._rows.length > 0 && !(allDone || gamesPlayed >= HIDE_AFTER_GAMES);
    }

    /** 按键模式：只留没完成的那半句，全部完成后整条隐藏 */
    private _refreshButtonHint(used: string[], gamesPlayed: number): void {
        if (!this.buttonHint) return;

        const parts: string[] = [];
        if (used.indexOf('move') < 0) parts.push('长按 ← → 连续移动');
        if (used.indexOf('drop') < 0) parts.push('按住 ↓ 加速下落');

        const show = parts.length > 0 && gamesPlayed < HIDE_AFTER_GAMES;
        this.buttonHint.string = parts.join('    ·    ');
        this.buttonHint.node.active = show;
    }

    private _cacheRows(): void {
        this._rows.length = 0;
        this._labels.length = 0;
        this._opacities.length = 0;

        const root = this.rowsRoot;
        if (!root) return;

        for (let i = 0; i < HINT_KEYS.length; i++) {
            const row = root.getChildByName(`Row${i}`);
            if (!row) continue;

            let opacity = row.getComponent(UIOpacity);
            if (!opacity) {
                opacity = row.addComponent(UIOpacity);
            }

            const labelNode = row.getChildByName('Label');
            this._rows.push(row);
            this._labels.push(labelNode ? labelNode.getComponent(Label) : null);
            this._opacities.push(opacity);
        }
    }

    /** 图示与模式无关（拖动 / 轻点 / 下拖），画一次即可 */
    private _drawIcons(): void {
        const root = this.rowsRoot;
        if (!root) return;

        // 线宽别低于 3：预览/小屏上缩放系数常在 0.5 左右，2px 描边经抗锯齿后只剩约 8% 覆盖率
        // （箭头两翼直接消失，整枚图标退化成一条短横线）。详见 docs/tech/mcp-scene-authoring-pitfalls.md。
        drawIcon(iconOf(root, 'Row0'), 'harrow', ICON_COLOR, 3.6);
        drawIcon(iconOf(root, 'Row1'), 'tap', ICON_COLOR, 3);
        drawIcon(iconOf(root, 'Row2'), 'down', ICON_COLOR, 3.6);
    }
}

function iconOf(root: Node, rowName: string): Node | null {
    const row = root.getChildByName(rowName);
    return row ? row.getChildByName('Icon') : null;
}

function hexColor(hex: string): Color {
    const color = new Color();
    color.fromHEX(hex);
    return color;
}
