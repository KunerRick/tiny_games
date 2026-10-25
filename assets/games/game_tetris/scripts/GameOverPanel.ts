/**
 * 方块坠落 — 结算面板：本局得分 / 最高分 / 消行数，重开或回大厅。
 *
 * 与 PausePanel 同一套绑定约定：`show()` 绑定事件，`hide()` 解绑。
 */

import { _decorator, Component, EventTouch, Label, Node } from 'cc';
import { formatScore } from './HudPanel';
import { skinButton, skinCard } from './TetrisSkin';

const { ccclass, property } = _decorator;

export interface IGameOverHost {
    restartGame(): void;
    backToLobby(): void;
}

const PRESS_SCALE = 0.97;

interface ButtonEntry {
    node: Node;
    action: () => void;
}

@ccclass('GameOverPanel')
export class GameOverPanel extends Component {
    @property(Node)
    backdrop: Node | null = null;

    @property(Node)
    restartButton: Node | null = null;

    @property(Node)
    lobbyButton: Node | null = null;

    @property(Label)
    scoreLabel: Label | null = null;

    @property(Label)
    bestLabel: Label | null = null;

    @property(Label)
    linesLabel: Label | null = null;

    @property(Label)
    newBestLabel: Label | null = null;

    private _host: IGameOverHost | null = null;
    private _entries: ButtonEntry[] = [];
    private _cachedNodes: Node[] = [];
    private _bound = false;
    private _skinned = false;

    init(host: IGameOverHost): void {
        this._host = host;
    }

    show(score: number, bestScore: number, lines: number, isNewBest: boolean): void {
        this._applySkin();
        if (this.scoreLabel) this.scoreLabel.string = formatScore(score);
        if (this.bestLabel) this.bestLabel.string = `最高分 ${formatScore(bestScore)}`;
        if (this.linesLabel) this.linesLabel.string = `消行 ${Math.max(0, Math.floor(lines))}`;
        if (this.newBestLabel) this.newBestLabel.node.active = isNewBest;

        this.node.active = true;
        this._bind();
    }

    /** 圆角卡片 + 两枚数据胶囊 + 新纪录标 + 两个按钮 */
    private _applySkin(): void {
        if (this._skinned) return;
        this._skinned = true;

        skinCard(this.node.getChildByName('Card'), { radius: 40 });

        // 「最高分 / 消行」并排成两枚胶囊；字号不变，靠底纹分出层级
        if (this.bestLabel) {
            skinCard(this.bestLabel.node, { width: 220, height: 64, radius: 22, fill: '#18213A', stroke: '#243052' });
        }
        if (this.linesLabel) {
            skinCard(this.linesLabel.node, { width: 220, height: 64, radius: 22, fill: '#18213A', stroke: '#243052' });
        }
        if (this.newBestLabel) {
            skinCard(this.newBestLabel.node, { width: 176, height: 52, radius: 26, fill: '#2A2410', stroke: '#5C4A12' });
        }

        skinButton(this.restartButton, 'primary', { radius: 30 });
        skinButton(this.lobbyButton, 'danger');
    }

    hide(): void {
        this._unbind();
        this.node.active = false;
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

        this._bindButton(this.restartButton, this.fireRestart);
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

    private fireRestart(): void {
        this._host?.restartGame();
    }

    private fireLobby(): void {
        this._host?.backToLobby();
    }
}
