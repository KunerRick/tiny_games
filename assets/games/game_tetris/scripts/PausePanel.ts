/**
 * 方块坠落 — 暂停面板。
 *
 * 内容（设计文档 §4.3）：继续 / 操作方式单选 / 震动开关 / 操作说明 / 回大厅。
 * 事件在 `show()` 里绑定、`hide()` 里解绑 —— 面板默认 `active=false`，
 * 未激活节点的 `onLoad()` 不执行，绑在 onLoad 里会全部失效（AGENTS.md 防崩溃守则 6）。
 *
 * 操作方式用「按钮底色」表示选中：选中 `#3B82F6`，未选中 `#1F2942`。
 * 不用 ✓ / 圆点等字符 —— 小游戏字体里容易变方框（红线 10）。
 *
 * 面板外观（圆角卡片、分段选项、震动开关）由 `TetrisSkin` 现画，
 * 场景里留下的纯色 Sprite 会被皮肤关掉渲染。
 */

import { _decorator, Component, EventTouch, Label, Node } from 'cc';
import { skinButton, skinCard } from './TetrisSkin';
import { ControlMode } from './TetrisInput';

const { ccclass, property } = _decorator;

/** 面板接受的外部动作，由 TetrisGame 实现 */
export interface IPausePanelHost {
    resumeGame(): void;
    selectControlMode(mode: ControlMode): void;
    toggleVibrate(): boolean;
    openTutorial(): void;
    backToLobby(): void;
}

const PRESS_SCALE = 0.97;

const HINT_GESTURE = '推荐 · 手指不挡落点，移动更准';
const HINT_BUTTON = '底部按键区，拇指即可完成全部操作';

interface ButtonEntry {
    node: Node;
    action: () => void;
}

@ccclass('PausePanel')
export class PausePanel extends Component {
    @property(Node)
    backdrop: Node | null = null;

    @property(Node)
    resumeButton: Node | null = null;

    @property(Node)
    gestureOption: Node | null = null;

    @property(Node)
    buttonOption: Node | null = null;

    @property(Node)
    vibrateButton: Node | null = null;

    @property(Node)
    tutorialButton: Node | null = null;

    @property(Node)
    lobbyButton: Node | null = null;

    @property(Label)
    vibrateLabel: Label | null = null;

    @property(Label)
    modeHint: Label | null = null;

    /** 一次性提示（如首次切到按键模式）；由 TetrisGame 决定何时显示 */
    @property(Label)
    modeNotice: Label | null = null;

    private _host: IPausePanelHost | null = null;
    private _entries: ButtonEntry[] = [];
    /** onDestroy 只碰缓存，不读 @property(Node) */
    private _cachedNodes: Node[] = [];
    private _bound = false;
    /** 皮肤只需上色一次（卡片、按钮），内容刷新不影响结构 */
    private _skinned = false;

    init(host: IPausePanelHost): void {
        this._host = host;
    }

    /** 打开面板：先刷新内容再 active，避免闪一帧旧状态 */
    show(mode: ControlMode, vibrate: boolean): void {
        this._applySkin();
        this.refresh(mode, vibrate);
        this.node.active = true;
        this._bind();
    }

    hide(): void {
        this._unbind();
        this.node.active = false;
        // 一次性提示只在本次打开期间有效，关面板即清掉
        if (this.modeNotice) {
            this.modeNotice.node.active = false;
            this.modeNotice.string = '';
        }
    }

    /** 显示一次性提示（传空串即隐藏） */
    showNotice(text: string): void {
        if (!this.modeNotice) return;
        this.modeNotice.string = text;
        this.modeNotice.node.active = text.length > 0;
    }

    /** 内容刷新（面板不可见时也可调用） */
    refresh(mode: ControlMode, vibrate: boolean): void {
        this._applySkin();
        this._paintOption(this.gestureOption, mode === 'gesture');
        this._paintOption(this.buttonOption, mode === 'button');
        if (this.modeHint) {
            this.modeHint.string = mode === 'gesture' ? HINT_GESTURE : HINT_BUTTON;
        }
        if (this.vibrateLabel) {
            this.vibrateLabel.string = '震动反馈';
        }
        // 开关状态跟着存储走：这一行同时是按钮和指示器
        skinButton(this.vibrateButton, 'secondary', { toggle: vibrate });
    }

    /** 圆角卡片 + 各行的皮肤（只需一次，重复调用幂等） */
    private _applySkin(): void {
        if (this._skinned) return;
        const card = this.node.getChildByName('Card');
        skinCard(card, {
            radius: 40,
            // 「操作方式」与下面几行之间加一条分隔线
            dividers: [{ y: 140, from: -240, to: 240 }],
        });

        skinCard(this.modeNotice ? this.modeNotice.node : null, {
            width: 500,
            height: 46,
            radius: 20,
            fill: '#2A2113',
            stroke: '#4A3A1A',
        });

        skinButton(this.tutorialButton, 'secondary', { icon: 'chevronRight' });
        skinButton(this.resumeButton, 'primary', { radius: 30 });
        skinButton(this.lobbyButton, 'danger');
        this._skinned = true;
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

        this._bindButton(this.resumeButton, this.fireResume);
        this._bindButton(this.gestureOption, this.fireGesture);
        this._bindButton(this.buttonOption, this.fireButtonMode);
        this._bindButton(this.vibrateButton, this.fireVibrate);
        this._bindButton(this.tutorialButton, this.fireTutorial);
        this._bindButton(this.lobbyButton, this.fireLobby);
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

    /** 背景挡住触摸：暂停时点棋盘不应误触手势层 */
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

    private fireResume(): void {
        this._host?.resumeGame();
    }

    private fireGesture(): void {
        this._host?.selectControlMode('gesture');
    }

    private fireButtonMode(): void {
        this._host?.selectControlMode('button');
    }

    private fireVibrate(): void {
        const on = this._host?.toggleVibrate();
        // 开关是这一行唯一的指示器，拨完立刻重画
        if (on !== undefined) {
            skinButton(this.vibrateButton, 'secondary', { toggle: on });
        }
    }

    private fireTutorial(): void {
        this._host?.openTutorial();
    }

    private fireLobby(): void {
        this._host?.backToLobby();
    }

    private _paintOption(node: Node | null, selected: boolean): void {
        skinButton(node, selected ? 'optionSelected' : 'option', { radius: 26 });
    }
}
