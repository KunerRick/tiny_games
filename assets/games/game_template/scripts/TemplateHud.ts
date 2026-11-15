import { _decorator, Component, Label, Node } from 'cc';
import { createLabel, createRoundRect, designPos } from '../../../common/ui/GameUIKit';
import { FONT_CAPTION, FONT_TITLE, UI } from '../../../common/ui/UITheme';
import { formatSeconds, TemplateState } from './TemplateCore';

const { ccclass } = _decorator;

/** 设计像素布局（左上角原点，画布 720×1280） */
const LAYOUT = {
    CHIP_W: 208,
    CHIP_H: 92,
    SCORE_X: 148,
    TIME_X: 572,
    CHIP_Y: 118,
    CAPTION_DY: -24,
    VALUE_DY: 10,
    BEST_Y: 196,
};

/**
 * 模板 HUD —— 常驻顶部的得分/剩余时间/最佳。
 *
 * 两条规矩（踩过坑，见 docs/tech/mcp-scene-authoring-pitfalls.md §3.5 ⑤）：
 *   1. 显隐**只有一个出口** `setVisible()`，由 TemplateGame 在每个状态切换点显式调用；
 *      HUD 自己不改 `active`，也不在 onLoad 里猜当前该不该显示。
 *   2. HUD 只负责**写文本**，不负责游戏状态 —— 状态一律来自传进来的 `TemplateState`。
 *
 * 本组件由 TemplateGame 用 `addComponent` 在运行时挂上，不依赖任何场景绑定。
 */
@ccclass('TemplateHud')
export class TemplateHud extends Component {
    private scoreValue: Label | null = null;
    private timeValue: Label | null = null;
    private bestLabel: Label | null = null;

    /** 由 TemplateGame 调一次：建结构。重复调用是幂等的。 */
    setup(): void {
        if (this.scoreValue) return;

        const scoreChip = this.makeChip('ScoreChip', LAYOUT.SCORE_X, '得分');
        this.scoreValue = this.makeValue(scoreChip.node, UI.accent, '0');

        const timeChip = this.makeChip('TimeChip', LAYOUT.TIME_X, '剩余');
        this.timeValue = this.makeValue(timeChip.node, UI.warning, '0.0');

        this.bestLabel = createLabel(this.node, '最佳 0', FONT_CAPTION.fontSize, {
            color: UI.textDim,
            x: 0,
            y: designPos(0, LAYOUT.BEST_Y).y,
        });
    }

    /** 刷新文本。每帧调也不会出问题，但调用方通常按 0.1s 节流。 */
    refresh(state: TemplateState): void {
        if (this.scoreValue) this.scoreValue.string = `${state.score}`;
        if (this.timeValue) this.timeValue.string = formatSeconds(state.timeLeft);
        if (this.bestLabel) this.bestLabel.string = `最佳 ${state.best}`;
    }

    /** 显隐唯一出口 */
    setVisible(visible: boolean): void {
        if (this.node.isValid) this.node.active = visible;
    }

    private makeChip(name: string, xFromLeft: number, caption: string) {
        const g = createRoundRect(this.node, name, LAYOUT.CHIP_W, LAYOUT.CHIP_H, 18, UI.panel, UI.panelStroke);
        g.node.setPosition(designPos(xFromLeft, LAYOUT.CHIP_Y));
        createLabel(g.node, caption, FONT_CAPTION.fontSize, {
            color: UI.textMuted,
            y: LAYOUT.CAPTION_DY,
        });
        return g;
    }

    private makeValue(parent: Node, color: string, initial: string): Label {
        return createLabel(parent, initial, FONT_TITLE.fontSize, {
            color,
            bold: true,
            y: LAYOUT.VALUE_DY,
        });
    }
}
