import { _decorator, Component, Graphics, Label, Node } from 'cc';
import {
    UiButton,
    applySceneClearColor,
    createBackButton,
    createButton,
    createLabel,
    createNode,
    createRoundRect,
    designPos,
    drawRoundRect,
    showTutorialOnce,
    stylePanel,
    toColor,
    toast,
} from '../../../common/ui/GameUIKit';
import {
    CANVAS,
    CONTROL,
    FONT_BODY,
    FONT_DISPLAY,
    FONT_TITLE,
    UI,
} from '../../../common/ui/UITheme';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager } from '../../../common/managers/StorageManager';
import {
    TEMPLATE_GAME_ID,
    TemplateState,
    createState,
    deserializeSave,
    serializeSave,
    startRound,
    tap,
    tick,
    toSave,
} from './TemplateCore';
import { TemplateHud } from './TemplateHud';

const { ccclass } = _decorator;

/** StorageManager 的键；实际存储键是 `tiny_games_${gameId}_${key}` */
const SAVE_KEY = 'save';

/** 设计像素布局（左上角原点） */
const LAYOUT = {
    TITLE_Y: 300,
    SUBTITLE_Y: 352,
    TAP_ZONE_X: 360,
    TAP_ZONE_Y: 780,
    TAP_ZONE_W: 620,
    TAP_ZONE_H: 420,
    PANEL_W: 560,
    PANEL_H: 460,
};

/**
 * 模板游戏 —— Cocos 组件层（**只做三件事**：建 UI、转发输入、把状态画出来）
 *
 * 规矩：
 *   - 规则全在 `TemplateCore.ts`，本文件不写任何计分/计时/随机逻辑；
 *   - 事件 handler 一律具名（红线 5），`onDestroy()` 里原样 `off()`；
 *   - `onDestroy()` 只清自己绑的事件和 JS 引用，不读任何 `@property` 节点；
 *   - 重开走 `_cleanupGame()`，与 `onDestroy()` 职责分开（防崩溃守则 3）。
 *
 * 场景要求：**只有一个 Canvas（720×1280）+ 相机 + 本组件**，不需要绑任何属性 ——
 * 全部 UI 都在 `buildUi()` 里用 GameUIKit 建，复制模板时不用改场景。
 * 需要复用场景里现成节点时，再按下面注释的写法声明 `@property`：
 *
 *   // @property({ type: Node, tooltip: '可选：覆盖默认点击区域' })
 *   // tapZoneOverride: Node | null = null;
 */
@ccclass('TemplateGame')
export class TemplateGame extends Component {
    private state: TemplateState = createState();
    private hud: TemplateHud | null = null;
    private tapZone: Node | null = null;
    private tapCaption: Label | null = null;
    private overlay: Node | null = null;
    private overlayBackdrop: Node | null = null;
    private overlayScore: Label | null = null;
    private overlayBest: Label | null = null;
    private backBtn: UiButton | null = null;
    /** HUD 刷新节流计时（每 0.1s 刷一次，别每帧改 Label） */
    private refreshTimer = 0;

    onLoad(): void {
        applySceneClearColor();
        this.state = createState(this.loadSave());
        this.buildUi();
        this.bindEvents();
        this.refreshUi();
        this.hud?.setVisible(true);
        showTutorialOnce(this.node, TEMPLATE_GAME_ID, '点击中间区域得分，10 秒内尽可能多');
    }

    onDestroy(): void {
        // 只解绑自己绑的事件、清 JS 引用；不访问任何 @property 节点（本模板没有 @property）
        if (this.tapZone?.isValid) {
            this.tapZone.off(Node.EventType.TOUCH_END, this.onTapZone, this);
        }
        if (this.overlayBackdrop?.isValid) {
            this.overlayBackdrop.off(Node.EventType.TOUCH_START, this.onSwallowTouch, this);
        }
        this.tapZone = null;
        this.tapCaption = null;
        this.hud = null;
        this.overlay = null;
        this.overlayBackdrop = null;
        this.overlayScore = null;
        this.overlayBest = null;
        this.backBtn = null;
    }

    update(dt: number): void {
        if (this.state.phase !== 'playing') return;
        const ended = tick(this.state, dt);
        if (ended) {
            this.onRoundEnded();
            return;
        }
        this.refreshTimer += dt;
        if (this.refreshTimer >= 0.1) {
            this.refreshTimer = 0;
            this.refreshUi();
        }
    }

    // ==================== UI ====================

    private buildUi(): void {
        createLabel(this.node, '模板游戏', FONT_DISPLAY.fontSize, {
            bold: true,
            y: designPos(0, LAYOUT.TITLE_Y).y,
        });
        createLabel(this.node, '复制这一套，换成你的玩法', FONT_BODY.fontSize, {
            color: UI.textDim,
            y: designPos(0, LAYOUT.SUBTITLE_Y).y,
        });

        // 点击区域：带 UITransform 的普通节点就能收触摸，不需要 Button 组件（红线 3）
        this.tapZone = createNode('TapZone', this.node, LAYOUT.TAP_ZONE_W, LAYOUT.TAP_ZONE_H);
        this.tapZone.setPosition(designPos(LAYOUT.TAP_ZONE_X, LAYOUT.TAP_ZONE_Y));
        const g = this.tapZone.addComponent(Graphics);
        drawRoundRect(
            g,
            LAYOUT.TAP_ZONE_W,
            LAYOUT.TAP_ZONE_H,
            28,
            toColor(UI.panel),
            toColor(UI.panelStroke),
        );
        this.tapCaption = createLabel(this.tapZone, '点击开始', FONT_TITLE.fontSize, { bold: true });

        // HUD：运行时挂组件，显隐只由本类决定
        const hudNode = createNode('Hud', this.node, CANVAS.width, CANVAS.height);
        this.hud = hudNode.addComponent(TemplateHud);
        this.hud.setup();

        this.backBtn = createBackButton(this.node, () => this.onBackToLobby());
        this.buildResultOverlay();
    }

    private buildResultOverlay(): void {
        const overlay = createNode('ResultOverlay', this.node, CANVAS.width, CANVAS.height);
        overlay.active = false;
        this.overlay = overlay;

        // 全屏遮罩：alpha 统一 235；吞掉 TOUCH_START，别让点击穿到下面的点击区
        const backdrop = createNode('Backdrop', overlay, CANVAS.width, CANVAS.height);
        const bg = backdrop.addComponent(Graphics);
        bg.fillColor = toColor(UI.overlay, 235);
        bg.rect(-CANVAS.width / 2, -CANVAS.height / 2, CANVAS.width, CANVAS.height);
        bg.fill();
        this.overlayBackdrop = backdrop;

        const panel = createRoundRect(
            overlay, 'ResultPanel', LAYOUT.PANEL_W, LAYOUT.PANEL_H, 24, UI.panel, UI.panelStroke,
        );
        panel.node.setPosition(designPos(CANVAS.width / 2, CANVAS.height / 2));
        stylePanel(panel.node, UI.accent);

        createLabel(panel.node, '本局结束', FONT_TITLE.fontSize, {
            bold: true,
            y: LAYOUT.PANEL_H / 2 - 70,
        });
        this.overlayScore = createLabel(panel.node, '得分 0', FONT_DISPLAY.fontSize, {
            bold: true,
            color: UI.accent,
            y: 40,
        });
        this.overlayBest = createLabel(panel.node, '最佳 0', FONT_BODY.fontSize, {
            color: UI.textDim,
            y: -24,
        });

        // 结算面板必须自带「返回大厅」（教训 H：遮罩会把同级返回键变得哑）
        const restart = createButton(panel.node, {
            w: 220,
            h: Math.round(CONTROL.BTN_HEIGHT * 1.25),
            text: '再来一局',
            fill: UI.primary,
            onTap: () => this.onRestart(),
        });
        restart.node.setPosition(-130, -LAYOUT.PANEL_H / 2 + 76);

        const lobby = createButton(panel.node, {
            w: 220,
            h: Math.round(CONTROL.BTN_HEIGHT * 1.25),
            text: '返回大厅',
            onTap: () => this.onBackToLobby(),
        });
        lobby.node.setPosition(130, -LAYOUT.PANEL_H / 2 + 76);
    }

    private refreshUi(): void {
        this.hud?.refresh(this.state);
        if (!this.tapCaption?.isValid) return;
        this.tapCaption.string =
            this.state.phase === 'ready' ? '点击开始'
                : this.state.phase === 'playing' ? '点我 +1'
                    : '本局结束';
    }

    private setOverlayVisible(visible: boolean): void {
        if (!this.overlay?.isValid) return;
        this.overlay.active = visible;
        // 返回键要抬到遮罩之上（同级不冒泡，压住就等于没了）
        const back = this.backBtn?.node;
        if (visible && back?.isValid && back.parent) {
            back.setSiblingIndex(back.parent.children.length - 1);
        }
    }

    // ==================== 输入 ====================

    private bindEvents(): void {
        // handler 必须具名，且与 onDestroy 里 off 的引用一致
        if (this.tapZone) {
            this.tapZone.on(Node.EventType.TOUCH_END, this.onTapZone, this);
        }
        if (this.overlayBackdrop) {
            this.overlayBackdrop.on(Node.EventType.TOUCH_START, this.onSwallowTouch, this);
        }
    }

    private onTapZone(): void {
        if (this.state.phase === 'over') return;
        if (this.state.phase === 'ready') {
            this.beginRound();
            return;
        }
        const gain = tap(this.state);
        if (gain > 1) toast(this.node, `奖励 +${gain}`, 0.9, 1040);
        this.refreshUi();
    }

    private onSwallowTouch(): void {
        // 遮罩只吞事件，不做事（空白函数，故意留名以便 off）
    }

    private onRestart(): void {
        this.beginRound();
    }

    private onBackToLobby(): void {
        SceneManager.gotoLobby();
    }

    // ==================== 局流程 ====================

    private beginRound(): void {
        this._cleanupGame();
        startRound(this.state, Date.now() ^ (this.state.round * 0x9e3779b1));
        this.setOverlayVisible(false);
        this.hud?.setVisible(true);
        this.refreshUi();
    }

    private onRoundEnded(): void {
        this.save();
        this.refreshUi();
        if (this.overlayScore) this.overlayScore.string = `得分 ${this.state.score}`;
        if (this.overlayBest) this.overlayBest.string = `最佳 ${this.state.best}`;
        this.setOverlayVisible(true);
    }

    /**
     * 重开清理。本模板 UI 常驻不销毁，所以这里只重置状态；
     * 若你的游戏每次重开都重建节点，在这里 destroy 后重新 init（与 onDestroy 职责分开）。
     */
    private _cleanupGame(): void {
        this.state = createState(toSave(this.state));
        this.refreshTimer = 0;
    }

    // ==================== 存档 ====================

    private loadSave() {
        try {
            return deserializeSave(StorageManager.instance.getItem(TEMPLATE_GAME_ID, SAVE_KEY));
        } catch (e) {
            console.warn('[TemplateGame] 读存档失败，按新档开始', e);
            return null;
        }
    }

    private save(): void {
        try {
            StorageManager.instance.setItem(
                TEMPLATE_GAME_ID, SAVE_KEY, serializeSave(toSave(this.state)),
            );
        } catch (e) {
            console.warn('[TemplateGame] 写存档失败（不影响本局）', e);
        }
    }
}
