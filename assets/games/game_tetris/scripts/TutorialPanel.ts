/**
 * 方块坠落 — 新手引导 / 操作说明（设计文档 §4.1、§4.3、§4.4）。
 *
 * 内容按**当前操作模式**渲染：首局默认展示「全屏手势（推荐）」，
 * 次按钮一键切到按键模式并把说明整体换成按键版；暂停面板里再打开时同样按当前模式渲染。
 *
 * 约定同 PausePanel：`show()` 绑定事件、`hide()` 解绑；图示走 `Graphics`，禁止 emoji（红线 10）。
 */

import { _decorator, Color, Component, EventTouch, Label, Node } from 'cc';
import { COLOR_TEXT_SECONDARY } from './TetrisConfig';
import { skinButton, skinCard } from './TetrisSkin';
import { ControlMode } from './TetrisInput';
import { IconKind, drawIcon } from './TetrisIcons';

const { ccclass, property } = _decorator;

/** 面板接受的外部动作，由 TetrisGame 实现 */
export interface ITutorialHost {
    /** 主按钮：首局「开始游戏」/ 暂停中「返回」（退回暂停面板） */
    tutorialPrimary(): void;
    /** 次按钮：切到另一种操作方式（立即生效并落盘） */
    tutorialSwitchMode(mode: ControlMode): void;
}

interface TutorialContent {
    title: string;
    subtitle: string;
    rows: string[];
    icons: IconKind[];
    note: string;
    secondary: string;
}

const GESTURE_CONTENT: TutorialContent = {
    title: '推荐：全屏手势',
    subtitle: '手指不挡落点，移动更准',
    rows: [
        '左右拖动 — 移动方块',
        '轻点 — 顺时针旋转',
        '按住下拖 — 加速下落',
        '快速下甩 — 直接落地',
        '双指点按 — 逆时针旋转',
    ],
    icons: ['harrow', 'tap', 'down', 'fastdown', 'twodots'],
    note: '点左侧「暂存」= 保存当前方块，每块限一次',
    secondary: '我习惯按键操作',
};

const BUTTON_CONTENT: TutorialContent = {
    title: '当前：虚拟按键',
    subtitle: '底部按键区，拇指即可完成全部操作',
    rows: [
        '点按 ← → — 移动一格',
        '长按 ← → — 连续移动',
        '点按 旋转 — 顺时针旋转',
        '按住 下 — 加速下落',
        '点按 落地 — 立即落地',
    ],
    icons: ['harrow', 'harrowhold', 'rotate', 'down', 'fastdown'],
    note: '点左侧「暂存」= 保存当前方块，每块限一次',
    secondary: '改用全屏手势',
};

const ICON_COLOR = hexColor(COLOR_TEXT_SECONDARY);
const PRESS_SCALE = 0.97;

interface ButtonEntry {
    node: Node;
    action: () => void;
}

@ccclass('TutorialPanel')
export class TutorialPanel extends Component {
    @property(Node)
    backdrop: Node | null = null;

    @property(Label)
    titleLabel: Label | null = null;

    @property(Label)
    subtitleLabel: Label | null = null;

    @property(Label)
    row1Label: Label | null = null;

    @property(Label)
    row2Label: Label | null = null;

    @property(Label)
    row3Label: Label | null = null;

    @property(Label)
    row4Label: Label | null = null;

    @property(Label)
    row5Label: Label | null = null;

    @property(Label)
    noteLabel: Label | null = null;

    @property(Node)
    primaryButton: Node | null = null;

    @property(Node)
    secondaryButton: Node | null = null;

    private _host: ITutorialHost | null = null;
    private _entries: ButtonEntry[] = [];
    /** onDestroy 只碰缓存，不读 @property(Node) */
    private _cachedNodes: Node[] = [];
    private _bound = false;

    private _firstRun = true;
    private _mode: ControlMode = 'gesture';
    /** 皮肤只需上色一次 */
    private _skinned = false;

    init(host: ITutorialHost): void {
        this._host = host;
    }

    /** 首局引导（`firstRun=true`）或暂停中查看说明 */
    show(firstRun: boolean, mode: ControlMode): void {
        this._firstRun = firstRun;
        this._applySkin();
        this.refresh(mode);
        this.node.active = true;
        this._bind();
    }

    /** 圆角卡片、五行之间的分隔线、说明底纹、两个按钮 */
    private _applySkin(): void {
        if (this._skinned) return;
        this._skinned = true;

        const card = this.node.getChildByName('Card');
        skinCard(card, {
            radius: 40,
            // 五行说明之间的分隔线（取相邻两行的中点）
            dividers: [
                { y: 163.5, from: -280, to: 280 },
                { y: 80.5, from: -280, to: 280 },
                { y: -2.5, from: -280, to: 280 },
                { y: -85.5, from: -280, to: 280 },
            ],
        });

        if (this.noteLabel) {
            // 提示条文字居中：底纹是固定 500 宽的胶囊，左对齐时右侧会空出一大截，看着像没对齐
            this.noteLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
            // 提示条底纹：比卡片亮一档 + 一道描边，否则在深色卡片上几乎看不出来
            skinCard(this.noteLabel.node, {
                width: 500,
                height: 52,
                radius: 18,
                fill: '#1D2842',
                stroke: '#2E3C60',
            });
        }

        skinButton(this.primaryButton, 'primary', { radius: 30 });
        skinButton(this.secondaryButton, 'ghost', { radius: 26 });
    }

    hide(): void {
        this._unbind();
        this.node.active = false;
    }

    /** 按模式重绘：标题、五行说明、图示、底部按钮文案 */
    refresh(mode: ControlMode): void {
        this._mode = mode;
        const content = mode === 'gesture' ? GESTURE_CONTENT : BUTTON_CONTENT;

        if (this.titleLabel) this.titleLabel.string = content.title;
        if (this.subtitleLabel) this.subtitleLabel.string = content.subtitle;
        if (this.noteLabel) this.noteLabel.string = content.note;

        const rows = this._rowLabels();
        for (let i = 0; i < rows.length; i++) {
            const label = rows[i];
            if (!label) continue;
            label.string = content.rows[i] || '';
            drawIcon(iconOf(label), content.icons[i], ICON_COLOR);
        }

        const primaryLabel = labelOf(this.primaryButton);
        if (primaryLabel) {
            // 首局 = 开打；暂停中打开 = 回到暂停面板（不是直接继续游戏），所以文案别写「返回游戏」
            primaryLabel.string = this._firstRun ? '开始游戏' : '返回';
        }
        const secondaryLabel = labelOf(this.secondaryButton);
        if (secondaryLabel) {
            secondaryLabel.string = content.secondary;
        }
    }

    private _rowLabels(): Array<Label | null> {
        return [this.row1Label, this.row2Label, this.row3Label, this.row4Label, this.row5Label];
    }

    // ==================== 绑定 ====================

    private _bind(): void {
        if (this._bound) return;
        this._bound = true;
        this._entries.length = 0;
        this._cachedNodes.length = 0;

        if (this.backdrop) {
            this.backdrop.on(Node.EventType.TOUCH_START, this.onBackdropTouch, this);
            this._cachedNodes.push(this.backdrop);
        }

        this._bindButton(this.primaryButton, this.firePrimary);
        this._bindButton(this.secondaryButton, this.fireSecondary);
    }

    private _unbind(): void {
        if (!this._bound) return;
        this._bound = false;

        for (const entry of this._entries) {
            // 场景销毁时节点可能已先销毁，此时 off()/setScale() 会抛异常 —— 直接跳过
            if (!entry.node.isValid) continue;
            entry.node.off(Node.EventType.TOUCH_START, this.onButtonDown, this);
            entry.node.off(Node.EventType.TOUCH_END, this.onButtonUp, this);
            entry.node.off(Node.EventType.TOUCH_CANCEL, this.onButtonCancel, this);
            entry.node.setScale(1, 1, 1);
        }
        this._entries.length = 0;

        for (const node of this._cachedNodes) {
            if (!node.isValid) continue;
            node.off(Node.EventType.TOUCH_START, this.onBackdropTouch, this);
        }
        this._cachedNodes.length = 0;
    }

    private _bindButton(node: Node | null, action: () => void): void {
        if (!node) return;
        node.on(Node.EventType.TOUCH_START, this.onButtonDown, this);
        node.on(Node.EventType.TOUCH_END, this.onButtonUp, this);
        node.on(Node.EventType.TOUCH_CANCEL, this.onButtonCancel, this);
        // 传进来的是原型方法，`entry.action()` 调用时 this 是 undefined —— 必须在这里绑死组件
        this._entries.push({ node, action: action.bind(this) });
    }

    onDestroy(): void {
        this._unbind();
        this._host = null;
    }

    // ==================== 事件 ====================

    /** 背景挡住触摸：引导期间点棋盘不应触发手势层 */
    private onBackdropTouch(e: EventTouch): void {
        e.propagationStopped = true;
    }

    private onButtonDown(e: EventTouch): void {
        const node = e.target as Node;
        if (node && node.isValid) node.setScale(PRESS_SCALE, PRESS_SCALE, 1);
    }

    private onButtonUp(e: EventTouch): void {
        const node = e.target as Node;
        if (node && node.isValid) node.setScale(1, 1, 1);
        for (const entry of this._entries) {
            if (entry.node === node) {
                entry.action();
                return;
            }
        }
    }

    private onButtonCancel(e: EventTouch): void {
        const node = e.target as Node;
        if (node && node.isValid) node.setScale(1, 1, 1);
    }

    // ==================== 动作 ====================

    private firePrimary(): void {
        this._host?.tutorialPrimary();
    }

    private fireSecondary(): void {
        this._host?.tutorialSwitchMode(this._mode === 'gesture' ? 'button' : 'gesture');
    }
}

function iconOf(label: Label): Node | null {
    const row = label.node.parent;
    return row ? row.getChildByName('Icon') : null;
}

function labelOf(button: Node | null): Label | null {
    if (!button) return null;
    const child = button.getChildByName('Label');
    return child ? child.getComponent(Label) : null;
}

function hexColor(hex: string): Color {
    const color = new Color();
    color.fromHEX(hex);
    return color;
}
