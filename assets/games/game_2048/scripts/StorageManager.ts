import { GridSize, TileData, DEFAULT_GRID_SIZE } from './GameConfig';

const STORAGE_KEY = 'tiny_games_2048_data';

export interface Game2048StorageData {
    bestScores: Record<GridSize, number>;
    defaultGridSize: GridSize;
    savedProgress?: {
        gridSize: GridSize;
        tiles: TileData[];
        score: number;
    };
}

export class StorageManager {
    private static _instance: StorageManager | null = null;
    
    static get instance(): StorageManager {
        if (!this._instance) {
            this._instance = new StorageManager();
        }
        return this._instance;
    }
    
    getData(): Game2048StorageData {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                return JSON.parse(data);
            }
        } catch (e) {
            console.warn('Failed to load 2048 data:', e);
        }
        return {
            bestScores: { 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 },
            defaultGridSize: DEFAULT_GRID_SIZE,
        };
    }
    
    setData(data: Game2048StorageData): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save 2048 data:', e);
        }
    }
    
    getBestScore(gridSize: GridSize): number {
        return this.getData().bestScores[gridSize] || 0;
    }
    
    setBestScore(gridSize: GridSize, score: number): void {
        const data = this.getData();
        if (score > data.bestScores[gridSize]) {
            data.bestScores[gridSize] = score;
            this.setData(data);
        }
    }
    
    getDefaultGridSize(): GridSize {
        return this.getData().defaultGridSize || DEFAULT_GRID_SIZE;
    }
    
    setDefaultGridSize(gridSize: GridSize): void {
        const data = this.getData();
        data.defaultGridSize = gridSize;
        this.setData(data);
    }
    
    saveProgress(gridSize: GridSize, tiles: TileData[], score: number): void {
        const data = this.getData();
        data.savedProgress = { gridSize, tiles, score };
        this.setData(data);
    }
    
    loadProgress(): { gridSize: GridSize; tiles: TileData[]; score: number } | null {
        return this.getData().savedProgress || null;
    }
    
    clearProgress(): void {
        const data = this.getData();
        delete data.savedProgress;
        this.setData(data);
    }
}
