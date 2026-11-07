import { _decorator, Component, Node, director, Button, Label, Color } from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager as CommonStorageManager } from '../../../common/managers/StorageManager';
import { GridSize, TileData, Direction, DEFAULT_GRID_SIZE } from './GameConfig';
import { StorageManager } from './StorageManager';
import { ScoreManager } from './ScoreManager';
import { InputHandler } from './InputHandler';
import { GameGrid } from './GameGrid';
import { SettingsPanel } from './SettingsPanel';
import { GameOverPanel } from './GameOverPanel';
import { createLabel, designPos } from '../../../common/ui/GameUIKit';

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
            color: '#64748B',
        });
        hint.node.setPosition(designPos(360, 940));

        this._polishScoreCards();
    }

    /**
     * 分数卡片的字色是 #776E65，配深棕卡面几乎看不清（对比度约 1.1:1）。
     * 预制体不便改，这里在运行时统一提亮，并把标题号稍微放大。
     */
    private _polishScoreCards(): void {
        const light = new Color(245, 239, 230, 255);
        const titles = ['scoreTitle', 'bestScoreTitle'];
        const values = ['scoreLabel', 'bestScoreLabel'];
        const stack: Node[] = [this.node];
        while (stack.length > 0) {
            const node = stack.pop()!;
            if (!node || !node.isValid) continue;
            if (titles.indexOf(node.name) >= 0 || values.indexOf(node.name) >= 0) {
                const label = node.getComponent(Label);
                if (label) {
                    label.color = light;
                    label.fontSize = titles.indexOf(node.name) >= 0 ? 20 : 36;
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
