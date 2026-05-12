import { _decorator, Component, Node, Label, director } from 'cc';
import { SceneManager } from '../../common/managers/SceneManager';
import { getGameById } from '../../common/managers/GameConfig';

const { ccclass, property } = _decorator;

@ccclass('GamePlaceholder')
export class GamePlaceholder extends Component {
    @property(Label)
    titleLabel: Label | null = null;
    
    @property(Label)
    infoLabel: Label | null = null;
    
    onLoad() {
        const gameId = SceneManager.currentGameId;
        const game = getGameById(gameId);
        
        if (game) {
            if (this.titleLabel) {
                this.titleLabel.string = game.name;
            }
            if (this.infoLabel) {
                this.infoLabel.string = `Game ID: ${game.id}\nScene: ${game.sceneName}\n\n(游戏开发中...)`;
            }
        } else {
            if (this.titleLabel) {
                this.titleLabel.string = 'Unknown Game';
            }
            if (this.infoLabel) {
                this.infoLabel.string = 'Game not found';
            }
        }
    }
}
