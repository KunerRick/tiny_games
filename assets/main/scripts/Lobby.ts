import { _decorator, Component, Node, director } from 'cc';
import { GAME_LIST, getGameById } from '../../common/managers/GameConfig';
import { StorageManager } from '../../common/managers/StorageManager';
import { SceneManager } from '../../common/managers/SceneManager';
import { GameGrid } from './GameGrid';

const { ccclass, property } = _decorator;

@ccclass('Lobby')
export class Lobby extends Component {
    @property(Node)
    recentSection: Node | null = null;
    
    @property(GameGrid)
    recentGrid: GameGrid | null = null;
    
    @property(GameGrid)
    allGamesGrid: GameGrid | null = null;
    
    onLoad() {
        this.refreshUI();
    }
    
    refreshUI() {
        const userData = StorageManager.instance.getUserData();
        
        // Setup recent games section
        if (userData.recentGames.length > 0 && this.recentSection && this.recentGrid) {
            this.recentSection.active = true;
            const recentGames = userData.recentGames
                .map(id => getGameById(id))
                .filter(game => game !== undefined) as typeof GAME_LIST;
            this.recentGrid.setup(recentGames, this.onGameClick.bind(this));
        } else if (this.recentSection) {
            this.recentSection.active = false;
        }
        
        // Setup all games grid
        if (this.allGamesGrid) {
            this.allGamesGrid.setup(GAME_LIST, this.onGameClick.bind(this));
        }
    }
    
    onGameClick(gameId: string) {
        const game = getGameById(gameId);
        if (!game) return;
        
        // Save to recent
        StorageManager.instance.addRecentGame(gameId);
        
        // Goto game scene
        SceneManager.gotoGame(gameId, game.sceneName);
    }
}
