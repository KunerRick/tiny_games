import { director } from 'cc';

export class SceneManager {
    private static _currentGameId: string = '';
    
    static get currentGameId(): string {
        return this._currentGameId;
    }
    
    static gotoLobby(): void {
        this._currentGameId = '';
        director.loadScene('Lobby');
    }
    
    static gotoGame(gameId: string, sceneName: string): void {
        this._currentGameId = gameId;
        director.loadScene(sceneName);
    }
}
