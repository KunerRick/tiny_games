import { _decorator, Component, Label } from 'cc';
import { GridSize } from './GameConfig';
import { StorageManager } from './StorageManager';

const { ccclass, property } = _decorator;

@ccclass('ScoreManager')
export class ScoreManager extends Component {
    @property(Label)
    scoreLabel: Label | null = null;
    
    @property(Label)
    bestScoreLabel: Label | null = null;

    @property(Label)
    scoreTitleLabel: Label | null = null;

    @property(Label)
    bestScoreTitleLabel: Label | null = null;
    
    private _currentScore: number = 0;
    private _bestScore: number = 0;
    private _gridSize: GridSize = 4;
    
    init(gridSize: GridSize): void {
        this._gridSize = gridSize;
        this._currentScore = 0;
        this._bestScore = StorageManager.instance.getBestScore(gridSize);
        this.updateDisplay();
    }
    
    addScore(points: number): void {
        this._currentScore += points;
        if (this._currentScore > this._bestScore) {
            this._bestScore = this._currentScore;
            StorageManager.instance.setBestScore(this._gridSize, this._bestScore);
        }
        this.updateDisplay();
    }
    
    getCurrentScore(): number {
        return this._currentScore;
    }
    
    getBestScore(): number {
        return this._bestScore;
    }
    
    reset(): void {
        this._currentScore = 0;
        this.updateDisplay();
    }
    
    private updateDisplay(): void {
        if (this.scoreLabel) {
            this.scoreLabel.string = `分数: ${this._currentScore}`;
        }
        if (this.bestScoreLabel) {
            this.bestScoreLabel.string = `最佳: ${this._bestScore}`;
        }
    }
}
