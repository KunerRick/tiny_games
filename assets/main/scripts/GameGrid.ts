import { _decorator, Component, Node, Prefab, instantiate, Layout } from 'cc';
import { GameConfig } from '../../common/managers/GameConfig';
import { GameIcon } from './GameIcon';

const { ccclass, property } = _decorator;

@ccclass('GameGrid')
export class GameGrid extends Component {
    @property(Prefab)
    gameIconPrefab: Prefab | null = null;
    
    private _onGameClick: ((gameId: string) => void) | null = null;
    
    setup(games: GameConfig[], onGameClick: (gameId: string) => void) {
        this._onGameClick = onGameClick;
        this.refresh(games);
    }
    
    refresh(games: GameConfig[]) {
        // Clear existing
        this.node.removeAllChildren();
        
        // Create icons
        games.forEach(game => {
            if (this.gameIconPrefab) {
                const node = instantiate(this.gameIconPrefab);
                this.node.addChild(node);
                
                const gameIcon = node.getComponent(GameIcon);
                if (gameIcon) {
                    gameIcon.setup(game, (gameId) => {
                        if (this._onGameClick) {
                            this._onGameClick(gameId);
                        }
                    });
                }
            }
        });
        
        // Update layout
        const layout = this.node.getComponent(Layout);
        if (layout) {
            layout.updateLayout();
        }
    }
}
