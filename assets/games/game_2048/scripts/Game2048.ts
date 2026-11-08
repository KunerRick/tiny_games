import { _decorator, Component, Node, director, Button, Graphics, Label, Color, Sprite, UITransform } from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager as CommonStorageManager } from '../../../common/managers/StorageManager';
import { GridSize, TileData, Direction, DEFAULT_GRID_SIZE } from './GameConfig';
import { StorageManager } from './StorageManager';
import { ScoreManager } from './ScoreManager';
import { InputHandler } from './InputHandler';
import { GameGrid } from './GameGrid';
import { SettingsPanel } from './SettingsPanel';
import { GameOverPanel } from './GameOverPanel';
import {
    createLabel, designPos, drawBackSkin, drawFrame, ensureChild, ensureScaleButton,
} from '../../../common/ui/GameUIKit';
import {
    COLOR, FONT_BODY, FONT_CAPTION, FONT_DISPLAY, FONT_TITLE,
    applyFontAndColor, hex,
} from '../../../common/ui/UITheme';

const { ccclass, property } = _decorator;

@ccclass('Game2048')
export class Game2048 extends Component {
    @property(GameGrid)
    gameGrid: GameGrid | null = null;
    
    @property(ScoreManager)
    scoreManager: ScoreManager | null = null;
    
    @property(InputHandler)
    inputHandler: InputHandler | null = null;
    
    @property(SettingsPanel)
    settingsPanel: SettingsPanel | null = null;
    
    @property(Button)
    settingsButton: Button | null = null;
    
    @property(Button)
    newGameButton: Button | null = null;
    
    @property(Button)
    backButton: Button | null = null;
    
    @property(GameOverPanel)
    gameOverPanelComponent: GameOverPanel | null = null;
    
    private _gridSize: GridSize = DEFAULT_GRID_SIZE;
    private _tiles: TileData[] = [];
    private _isGameOver: boolean = false;
    private _isMoving: boolean = false;
    private _hasWon: boolean = false;

    // onDestroy 只用这些缓存解绑：场景销毁时 @property 的 getter 可能已返回 null（红线 4）
    private _settingsNode: Node | null = null;
    private _newGameNode: Node | null = null;
    private _backNode: Node | null = null;
    /** 滑动动画后的补间结算；场景销毁时必须取消，否则会打到已销毁的组件上 */
    private _moveTimer = 0;

    onLoad() {
        // 设置按钮事件
        if (this.settingsButton) {
            this._settingsNode = this.settingsButton.node;
            this._settingsNode.on(Node.EventType.TOUCH_END, this.onSettingsClick, this);
        }
        if (this.newGameButton) {
            this._newGameNode = this.newGameButton.node;
            this._newGameNode.on(Node.EventType.TOUCH_END, this.onNewGameClick, this);
        }
        if (this.backButton) {
            this._backNode = this.backButton.node;
            this._backNode.on(Node.EventType.TOUCH_END, this.onBackClick, this);
        }

        // 设置输入回调
        if (this.inputHandler) {
            this.inputHandler.setCallback(this.onDirectionInput.bind(this));
        }
        
        // 记录最近游玩
        CommonStorageManager.instance.addRecentGame('2048');

        // 棋盘与底栏之间有一大段空白，补一行玩法提示（新玩家不知道要滑动）
        const hint = createLabel(this.node, '滑动屏幕合并相同数字 · 凑出 2048', 20, {
            width: 680,
            height: 28,
            color: COLOR.TEXT_DISABLED,
        });
        hint.node.setPosition(designPos(360, 940));

        this._applyUnifiedTheme();
    }

    // ------------------------------------------------------------------
    // 统一视觉：场景里的节点是早期手摆的米色皮肤（#8F7A66 / #CDC1B4 / #F8F5F0），
    // 和全站深色科技风不是一套。这里在运行时统一改色改框，不动场景文件：
    //   • 背景 → COLOR.BG_SCENE
    //   • 返回 → 与 BackButton / createBackButton 同款「圆盘 + ‹」
    //   • 卡片 / 面板 → SURFACE + PANEL_BORDER 细描边
    //   • 主按钮 → PRIMARY，次按钮 → SURFACE
    // 幂等：drawFrame / drawBackSkin 都按子节点名字复用。
    // ------------------------------------------------------------------

    /** 按 `a/b/c` 路径取子节点（找不到返回 null，不抛） */
    private pick(path: string): Node | null {
        let cur: Node | null = this.node;
        for (const part of path.split('/')) {
            if (!cur) return null;
            cur = cur.getChildByName(part);
        }
        return cur;
    }

    private _applyUnifiedTheme(): void {
        // 画布底色
        const bg = this.pick('bg')?.getComponent(Sprite);
        if (bg) bg.color = hex(COLOR.BG_SCENE);

        // 顶部标题
        const title = this.pick('gameContainer/header/title')?.getComponent(Label);
        if (title) applyFontAndColor(title, FONT_TITLE, COLOR.TEXT_PRIMARY);

        // 返回：统一成圆形 ‹（场景里是 100×40 的圆角条）
        const backNode = this.pick('gameContainer/header/backButton');
        if (backNode) {
            const ui = backNode.getComponent(UITransform);
            if (ui) ui.setContentSize(64, 64);
            const sp = backNode.getComponent(Sprite);
            if (sp) sp.enabled = false;
            for (const child of backNode.children) {
                if (child?.isValid && child.getComponent(Label)) child.active = false;
            }
            drawBackSkin(backNode, 64);
            ensureScaleButton(backNode);
        }

        // 设置按钮
        const settingsNode = this.pick('gameContainer/header/settingsButton');
        if (settingsNode) this.skinActionButton(settingsNode, 'secondary', 100, 44);

        // 分数卡片
        for (const name of ['gameContainer/scorePanel/scoreCard', 'gameContainer/scorePanel/bestScoreCard']) {
            const card = this.pick(name);
            if (!card) continue;
            const ui = card.getComponent(UITransform);
            const sp = card.getComponent(Sprite);
            if (sp) sp.enabled = false;
            if (!ui) continue;
            drawFrame(card, {
                width: ui.width, height: ui.height, radius: 12,
                fill: COLOR.SURFACE, fillAlpha: 255,
                border: COLOR.PANEL_BORDER, borderAlpha: 210, borderWidth: 2,
            });
        }
        this._polishScoreCards();

        // 底部主按钮
        const newGame = this.pick('gameContainer/footer/newGameButton');
        if (newGame) this.skinActionButton(newGame, 'primary', 240, 64);

        this._themePanels();
    }

    /** 设置 / 结算两个弹窗：遮罩、面板底、文字、滑条、按钮 */
    private _themePanels(): void {
        for (const panel of ['settingsPanel', 'gameOverPanel']) {
            const overlay = this.pick(`${panel}/bg`)?.getComponent(Sprite);
            if (overlay) overlay.color = new Color(0, 0, 0, 190);

            const content = this.pick(`${panel}/content`);
            if (content) {
                const ui = content.getComponent(UITransform);
                const sp = content.getComponent(Sprite);
                if (sp) sp.enabled = false;
                if (ui) {
                    drawFrame(content, {
                        width: ui.width, height: ui.height, radius: 20,
                        fill: COLOR.PANEL_BG, fillAlpha: 255,
                        border: COLOR.PRIMARY, borderAlpha: 95, borderWidth: 2,
                        accent: COLOR.PRIMARY, accentAlpha: 220,
                    });
                }
            }
        }

        // ---- 设置面板 ----
        this.paintLabel('settingsPanel/content/titleLabel', FONT_TITLE, COLOR.TEXT_PRIMARY);
        this.paintLabel('settingsPanel/content/gridSizeLabel', FONT_BODY, COLOR.TEXT_SECONDARY);
        this.paintLabel('settingsPanel/content/gridSizeValue', FONT_DISPLAY, COLOR.PRIMARY);
        this.paintLabel('settingsPanel/content/sliderContainer/minLabel', FONT_CAPTION, COLOR.TEXT_SECONDARY);
        this.paintLabel('settingsPanel/content/sliderContainer/maxLabel', FONT_CAPTION, COLOR.TEXT_SECONDARY);

        const track = this.pick('settingsPanel/content/sliderContainer/slider')?.getComponent(Sprite);
        if (track) track.color = hex(COLOR.SLOT_EMPTY_BG);
        this.skinSliderHandle();

        const cancel = this.pick('settingsPanel/content/buttonContainer/cancelButton');
        if (cancel) this.skinActionButton(cancel, 'secondary', 200, 64);
        const start = this.pick('settingsPanel/content/buttonContainer/startButton');
        if (start) this.skinActionButton(start, 'primary', 200, 64);

        // ---- 结算面板 ----
        this.paintLabel('gameOverPanel/content/titleLabel', FONT_DISPLAY, COLOR.PRIMARY);
        this.paintLabel('gameOverPanel/content/scoreLabel', FONT_BODY, COLOR.TEXT_SECONDARY);
        this.paintLabel('gameOverPanel/content/bestScoreLabel', FONT_BODY, COLOR.TEXT_SECONDARY);
        this.paintLabel('gameOverPanel/content/scoreValue', FONT_DISPLAY, COLOR.TEXT_PRIMARY);
        this.paintLabel('gameOverPanel/content/bestScoreValue', FONT_DISPLAY, COLOR.TEXT_PRIMARY);

        const restart = this.pick('gameOverPanel/content/restartButton');
        if (restart) this.skinActionButton(restart, 'primary', 400, 88);
        const backToLobby = this.pick('gameOverPanel/content/backButton');
        if (backToLobby) this.skinActionButton(backToLobby, 'secondary', 240, 60);
    }

    /**
     * 滑条手柄：场景里是 40×40 的方形贴图，放在深色滑轨上像个没对齐的色块。
     * 换成同尺寸圆点（主色填充 + 白色细环），与全站的圆形控件语言一致。
     */
    private skinSliderHandle(): void {
        const node = this.pick('settingsPanel/content/sliderContainer/slider/Handle');
        if (!node) return;
        const sp = node.getComponent(Sprite);
        if (sp) sp.enabled = false;
        const ui = node.getComponent(UITransform);
        const d = ui ? Math.min(ui.width, ui.height) : 40;
        const dot = ensureChild(node, '__handleDot', d, d);
        dot.setSiblingIndex(node.children.length - 1);
        const g = dot.getComponent(Graphics) ?? dot.addComponent(Graphics);
        g.clear();
        g.fillColor = hex(COLOR.PRIMARY);
        g.circle(0, 0, d / 2 - 2);
        g.fill();
        g.strokeColor = hex('#FFFFFF', 220);
        g.lineWidth = 2;
        g.circle(0, 0, d / 2 - 2);
        g.stroke();
    }

    private paintLabel(path: string, token: typeof FONT_BODY, colorHex: string): void {
        const label = this.pick(path)?.getComponent(Label);
        if (label) applyFontAndColor(label, token, colorHex);
    }

    /**
     * 把场景按钮换成令牌皮肤：隐藏九宫格 Sprite，改画圆角底板，过渡改 SCALE。
     * 保留原有 Button 组件与挂在节点上的 TOUCH_END 监听，点击行为不变。
     */
    private skinActionButton(node: Node, variant: 'primary' | 'secondary', w: number, h: number): void {
        const ui = node.getComponent(UITransform);
        if (!ui) return;
        ui.setContentSize(w, h);
        const sp = node.getComponent(Sprite);
        if (sp) sp.enabled = false;

        drawFrame(node, {
            width: w, height: h, radius: Math.min(16, h / 2),
            fill: variant === 'primary' ? COLOR.PRIMARY : COLOR.SURFACE,
            fillAlpha: 255,
            border: variant === 'primary' ? COLOR.PRIMARY_DARK : COLOR.PANEL_BORDER,
            borderAlpha: 220, borderWidth: 2,
        });
        ensureScaleButton(node);

        for (const child of node.children) {
            const label = child?.getComponent(Label);
            if (label) applyFontAndColor(label, FONT_BODY, '#FFFFFF');
        }
    }

    /**
     * 分数卡片的字号/字色统一走令牌。
     * 原先字色 #776E65 配奶油卡面几乎看不清（对比度约 1.1:1）。
     */
    private _polishScoreCards(): void {
        const titles = ['scoreTitle', 'bestScoreTitle'];
        const values = ['scoreLabel', 'bestScoreLabel'];
        const stack: Node[] = [this.node];
        while (stack.length > 0) {
            const node = stack.pop()!;
            if (!node || !node.isValid) continue;
            const isTitle = titles.indexOf(node.name) >= 0;
            const isValue = values.indexOf(node.name) >= 0;
            if (isTitle || isValue) {
                const label = node.getComponent(Label);
                if (label) {
                    applyFontAndColor(
                        label,
                        isTitle ? FONT_BODY : FONT_TITLE,
                        isTitle ? COLOR.TEXT_SECONDARY : COLOR.TEXT_PRIMARY,
                    );
                }
            }
            for (const child of node.children) stack.push(child);
        }
    }

    onDestroy(): void {
        this._cancelMoveTimer();
        const settings = this._settingsNode;
        if (settings && settings.isValid) {
            settings.off(Node.EventType.TOUCH_END, this.onSettingsClick, this);
        }
        const newGame = this._newGameNode;
        if (newGame && newGame.isValid) {
            newGame.off(Node.EventType.TOUCH_END, this.onNewGameClick, this);
        }
        const back = this._backNode;
        if (back && back.isValid) {
            back.off(Node.EventType.TOUCH_END, this.onBackClick, this);
        }
        this._settingsNode = null;
        this._newGameNode = null;
        this._backNode = null;
    }
    
    start() {
        const progress = StorageManager.instance.loadProgress();
        if (progress) {
            this._gridSize = progress.gridSize;
            this._tiles = progress.tiles.map(t => ({ ...t, isNew: undefined }));
            this.initGame(this._gridSize, false);
            this.scoreManager?.setScore(progress.score);
            this.saveProgress();
            this.renderTiles();
        } else {
            this._gridSize = StorageManager.instance.getDefaultGridSize();
            this.initGame(this._gridSize, true);
        }
    }
    
    initGame(gridSize: GridSize, spawnInitialTiles: boolean = true): void {
        // 重开时上一局的补间结算必须作废，否则会往新棋盘里多塞一块
        this._cancelMoveTimer();
        this._gridSize = gridSize;
        this._isGameOver = false;
        this._isMoving = false;
        this._hasWon = false;
        
        if (this.gameGrid) {
            this.gameGrid.init(gridSize);
        }
        
        if (this.scoreManager) {
            this.scoreManager.init(gridSize);
        }
        
        if (spawnInitialTiles) {
            this._tiles = [];
            // 生成两个初始方块
            const tile1 = this.gameGrid?.spawnRandomTile(this._tiles, this._gridSize);
            if (tile1) {
                this._tiles.push(tile1);
                this.gameGrid?.spawnTile(tile1);
            }
            const tile2 = this.gameGrid?.spawnRandomTile(this._tiles, this._gridSize);
            if (tile2) {
                this._tiles.push(tile2);
                this.gameGrid?.spawnTile(tile2);
            }
        }
        
        this.saveProgress();
    }
    
    private onDirectionInput(direction: Direction): void {
        if (this._isGameOver || this._isMoving) return;
        if (this.settingsPanel?.node.active || this.gameOverPanelComponent?.node.active) return;

        const result = this.gameGrid?.move(this._tiles, direction, this._gridSize);
        if (!result || !result.hasMoved) {
            // 棋盘没变，但需检测是否已死（满+无合并方向）
            this.checkGameEnd();
            return;
        }

        // 更新分数
        if (result.scoreGained > 0) {
            this.scoreManager?.addScore(result.scoreGained);
        }

        // 清理被吞的 tile，更新位置
        const newIds = new Set(result.tiles.map(t => t.id));
        const consumedIds = this._tiles.filter(t => !newIds.has(t.id)).map(t => t.id);
        this.gameGrid?.removeMergedTiles(consumedIds);
        this._tiles = result.tiles;
        this.gameGrid?.updateTiles(this._tiles, true);
        this._isMoving = true;

        // 滑动动画完成后 → 生新方块 → 统一结算检测
        this._cancelMoveTimer();
        this._moveTimer = setTimeout(this.onMoveSettled, 150);
    }

    /** 滑动动画结束：补新方块并结算（150ms 后执行，场景可能已经销毁） */
    private onMoveSettled = (): void => {
        this._moveTimer = 0;
        if (!this.isValid) return;
        this._isMoving = false;

        const newTile = this.gameGrid?.spawnRandomTile(this._tiles, this._gridSize);
        if (newTile) {
            this._tiles.push(newTile);
            this.gameGrid?.spawnTile(newTile);
        }

        // 检查是否达到 2048
        if (!this._hasWon && this._tiles.some(t => t.value >= 2048)) {
            this._hasWon = true;
            this.saveProgress();
            this.showWin();
            this._isGameOver = true;
            return;
        }

        // 统一结算检测（用最终棋盘 state）
        this.checkGameEnd();
        this.saveProgress();
    };

    private _cancelMoveTimer(): void {
        if (this._moveTimer) {
            clearTimeout(this._moveTimer);
            this._moveTimer = 0;
        }
    }

    /** 用当前棋盘检测是否 Game Over，是则弹出结算面板 */
    private checkGameEnd(): void {
        const isOver = this.gameGrid?.checkGameOver(this._tiles, this._gridSize) || false;
        if (isOver) {
            this._isGameOver = true;
            this.showGameOver();
        }
    }
    
    private onSettingsClick(): void {
        if (this.settingsPanel) {
            this.settingsPanel.show(this._gridSize, (size) => {
                StorageManager.instance.setDefaultGridSize(size);
                this.initGame(size, true);
            });
        }
    }
    
    private onNewGameClick(): void {
        this.initGame(this._gridSize, true);
    }
    
    private onBackClick(): void {
        SceneManager.gotoLobby();
    }
    
    private onRestartClick(): void {
        this.initGame(this._gridSize, true);
    }
    
    private onBackToLobbyClick(): void {
        SceneManager.gotoLobby();
    }
    
    private showWin(): void {
        const currentScore = this.scoreManager?.getCurrentScore() || 0;
        const bestScore = this.scoreManager?.getBestScore() || 0;

        this.gameOverPanelComponent?.show(
            currentScore,
            () => this.onRestartClick(),
            () => this.onBackToLobbyClick(),
            bestScore,
            true,
        );

        // 与失败结算一致：通关的棋盘不再续玩
        StorageManager.instance.clearProgress();
    }

    private showGameOver(): void {
        const currentScore = this.scoreManager?.getCurrentScore() || 0;
        const bestScore = this.scoreManager?.getBestScore() || 0;

        this.gameOverPanelComponent?.show(
            currentScore,
            () => this.onRestartClick(),
            () => this.onBackToLobbyClick(),
            bestScore,
        );

        StorageManager.instance.clearProgress();
    }
    
    private saveProgress(): void {
        if (!this._isGameOver && this.scoreManager) {
            StorageManager.instance.saveProgress(
                this._gridSize,
                this._tiles,
                this.scoreManager.getCurrentScore()
            );
        }
    }
    
    private renderTiles(): void {
        this._tiles.forEach(tileData => {
            this.gameGrid?.spawnTile(tileData);
        });
    }
}
