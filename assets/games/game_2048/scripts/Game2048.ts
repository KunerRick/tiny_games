import { _decorator, Component, Node, director, Button, Label } from 'cc';
import { SceneManager } from '../../../common/managers/SceneManager';
import { StorageManager as CommonStorageManager } from '../../../common/managers/StorageManager';
import { GridSize, TileData, Direction, DEFAULT_GRID_SIZE } from './GameConfig';
import { StorageManager } from './StorageManager';
import { ScoreManager } from './ScoreManager';
import { InputHandler } from './InputHandler';
import { GameGrid } from './GameGrid';
import { SettingsPanel } from './SettingsPanel';
import { GameOverPanel } from './GameOverPanel';

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
    
    onLoad() {
        // 设置按钮事件
        if (this.settingsButton) {
            this.settingsButton.node.on(Node.EventType.TOUCH_END, this.onSettingsClick, this);
        }
        if (this.newGameButton) {
            this.newGameButton.node.on(Node.EventType.TOUCH_END, this.onNewGameClick, this);
        }
        if (this.backButton) {
            this.backButton.node.on(Node.EventType.TOUCH_END, this.onBackClick, this);
        }

        // 设置输入回调
        if (this.inputHandler) {
            this.inputHandler.setCallback(this.onDirectionInput.bind(this));
        }
        
        // 记录最近游玩
        CommonStorageManager.instance.addRecentGame('2048');
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
        console.log('[Game2048] onDirectionInput called, direction:', direction, '_isGameOver:', this._isGameOver, '_isMoving:', this._isMoving);
        
        if (this._isGameOver || this._isMoving) {
            console.log('[Game2048] Ignoring input, _isGameOver:', this._isGameOver, '_isMoving:', this._isMoving);
            return;
        }
        
        if (this.settingsPanel?.node.active) {
            console.log('[Game2048] Ignoring input, settingsPanel is active');
            return;
        }
        
        if (this.gameOverPanelComponent?.node.active) {
            console.log('[Game2048] Ignoring input, gameOverPanel is active');
            return;
        }

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
        setTimeout(() => {
            console.log('[Game2048] setTimeout callback executed');
            this._isMoving = false;

            const newTile = this.gameGrid?.spawnRandomTile(this._tiles, this._gridSize);
            console.log('[Game2048] spawnRandomTile result:', newTile ? `tile at (${newTile.row},${newTile.col})` : 'null');
            
            if (newTile) {
                this._tiles.push(newTile);
                this.gameGrid?.spawnTile(newTile);
            }

            // 检查是否达到 2048
            if (!this._hasWon && this._tiles.some(t => t.value >= 2048)) {
                console.log('[Game2048] Player won!');
                this._hasWon = true;
                this.showWin();
                this._isGameOver = true;
                return;
            }

            // 统一结算检测（用最终棋盘 state）
            console.log('[Game2048] Calling checkGameEnd from setTimeout');
            this.checkGameEnd();
            this.saveProgress();
        }, 150);
    }

    /** 用当前棋盘检测是否 Game Over，是则弹出结算面板 */
    private checkGameEnd(): void {
        console.log('[Game2048] Checking game end, tiles count:', this._tiles.length, 'gridSize:', this._gridSize);
        const isOver = this.gameGrid?.checkGameOver(this._tiles, this._gridSize) || false;
        console.log('[Game2048] checkGameOver result:', isOver);
        if (isOver) {
            console.log('[Game2048] Game is over, showing game over panel');
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
    }

    private showGameOver(): void {
        const currentScore = this.scoreManager?.getCurrentScore() || 0;
        const bestScore = this.scoreManager?.getBestScore() || 0;

        if (!this.gameOverPanelComponent) {
            console.error('[Game2048] gameOverPanelComponent is null, cannot show game over panel');
            return;
        }

        if (!this.gameOverPanelComponent.node) {
            console.error('[Game2048] gameOverPanelComponent.node is null');
            return;
        }

        console.log('[Game2048] Showing game over panel, score:', currentScore, 'bestScore:', bestScore);
        this.gameOverPanelComponent.show(
            currentScore,
            () => this.onRestartClick(),
            () => this.onBackToLobbyClick(),
            bestScore,
        );

        // 清除保存的进度
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
