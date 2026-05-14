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
        // 检查是否有保存的进度
        const progress = StorageManager.instance.loadProgress();
        if (progress) {
            this._gridSize = progress.gridSize;
            this._tiles = progress.tiles;
            this.initGame(this._gridSize, false);
            this.scoreManager?.init(this._gridSize);
            // 恢复分数（直接设置，无需循环累加）
            this.scoreManager?.setScore(progress.score);
            this.renderTiles();
        } else {
            // 新游戏
            this._gridSize = StorageManager.instance.getDefaultGridSize();
            this.initGame(this._gridSize, true);
        }
    }
    
    initGame(gridSize: GridSize, spawnInitialTiles: boolean = true): void {
        this._gridSize = gridSize;
        this._isGameOver = false;
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
        
        // 执行移动
        const result = this.gameGrid?.move(this._tiles, direction, this._gridSize);
        if (!result || !result.hasMoved) return;
        
        // 更新分数
        if (result.scoreGained > 0) {
            this.scoreManager?.addScore(result.scoreGained);
        }
        
        // 找出合并后被吞掉的 TileId，清理节点
        const newIds = new Set(result.tiles.map(t => t.id));
        const consumedIds = this._tiles.filter(t => !newIds.has(t.id)).map(t => t.id);
        this.gameGrid?.removeMergedTiles(consumedIds);
        
        // 更新方块位置
        this._tiles = result.tiles;
        this.gameGrid?.updateTiles(this._tiles, true);
        
        this._isMoving = true;
        
        // 生成新方块
        setTimeout(() => {
            this._isMoving = false;
            
            const newTile = this.gameGrid?.spawnRandomTile(this._tiles, this._gridSize);
            if (newTile) {
                this._tiles.push(newTile);
                this.gameGrid?.spawnTile(newTile);
            }
            
            // 检查游戏结束
            this._isGameOver = this.gameGrid?.checkGameOver(this._tiles, this._gridSize) || false;
            
            // 检查是否达到 2048
            if (!this._hasWon && this._tiles.some(t => t.value >= 2048)) {
                this._hasWon = true;
                this.showWin();
                // 胜利后阻塞输入，防止面板背后继续操作
                this._isGameOver = true;
                return;
            }
            
            // 保存进度
            this.saveProgress();
            
            // 显示游戏结束
            if (this._isGameOver) {
                this.showGameOver();
            }
        }, 150);
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

        this.gameOverPanelComponent?.show(
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
