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
        if (this.scoreTitleLabel) {
            this.scoreTitleLabel.string = '分数';
        }
        if (this.bestScoreTitleLabel) {
            this.bestScoreTitleLabel.string = '最高分';
        }
        this.updateDisplay();
    }
    
    setScore(score: number): void {
        this._currentScore = score;
        if (this._currentScore > this._bestScore) {
            this._bestScore = this._currentScore;
            StorageManager.instance.setBestScore(this._gridSize, this._bestScore);
        }
        this.updateDisplay();
    }

    addScore(points: number): void {
        this.setScore(this._currentScore + points);
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
            this.scoreLabel.string = `${this._currentScore}`;
        }
        if (this.bestScoreLabel) {
            this.bestScoreLabel.string = `${this._bestScore}`;
        }
    }
}
