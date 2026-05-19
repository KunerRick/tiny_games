import { _decorator } from 'cc';

const STORAGE_KEY = 'tiny_games_user_data';

export interface UserGameData {
    recentGames: string[];
}

export class StorageManager {
    private static _instance: StorageManager | null = null;
    
    static get instance(): StorageManager {
        if (!this._instance) {
            this._instance = new StorageManager();
        }
        return this._instance;
    }
    
    getUserData(): UserGameData {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                return JSON.parse(data);
            }
        } catch (e) {
            console.warn('Failed to load user data:', e);
        }
        return { recentGames: [] };
    }
    
    setUserData(data: UserGameData): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save user data:', e);
        }
    }
    
    addRecentGame(gameId: string): void {
        const data = this.getUserData();

        // Remove if exists
        data.recentGames = data.recentGames.filter(id => id !== gameId);

        // Add to front
        data.recentGames.unshift(gameId);

        // Keep only 3
        data.recentGames = data.recentGames.slice(0, 3);

        this.setUserData(data);
    }

    // ==================== 通用键值存储 ====================

    private getGameKey(gameId: string, key: string): string {
        return `tiny_games_${gameId}_${key}`;
    }

    /** 获取游戏特定的存储项 */
    getItem(gameId: string, key: string): string | null {
        try {
            return localStorage.getItem(this.getGameKey(gameId, key));
        } catch (e) {
            console.warn(`Failed to get item ${key} for ${gameId}:`, e);
            return null;
        }
    }

    /** 设置游戏特定的存储项 */
    setItem(gameId: string, key: string, value: string): void {
        try {
            localStorage.setItem(this.getGameKey(gameId, key), value);
        } catch (e) {
            console.warn(`Failed to set item ${key} for ${gameId}:`, e);
        }
    }
}
