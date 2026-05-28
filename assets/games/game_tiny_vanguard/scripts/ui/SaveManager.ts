export interface RunData {
  currentRouteNode: number;
  playerClasses: string[];
  unitSkills: { [unitId: string]: string[] };
  gold: number;
  honor: number;
  talents: string[];
  difficulty: string;
  unlockedClasses: string[];
  unlockedSkills: string[];
}

export class SaveManager {
  private static readonly SAVE_KEY = 'tiny_vanguard_save';
  private static readonly META_KEY = 'tiny_vanguard_meta';

  static saveRun(data: RunData): void {
    try {
      localStorage.setItem(this.SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }

  static loadRun(): RunData | null {
    try {
      const data = localStorage.getItem(this.SAVE_KEY);
      return data ? JSON.parse(data) as RunData : null;
    } catch (e) {
      console.warn('Load failed:', e);
      return null;
    }
  }

  static clearRun(): void {
    localStorage.removeItem(this.SAVE_KEY);
  }

  static hasSavedRun(): boolean {
    return localStorage.getItem(this.SAVE_KEY) !== null;
  }

  static saveMeta(meta: {
    honor: number;
    talents: string[];
    unlockedClasses: string[];
    unlockedSkills: string[];
  }): void {
    try {
      localStorage.setItem(this.META_KEY, JSON.stringify(meta));
    } catch (e) {
      console.warn('Meta save failed:', e);
    }
  }

  static loadMeta(): {
    honor: number;
    talents: string[];
    unlockedClasses: string[];
    unlockedSkills: string[];
  } | null {
    try {
      const data = localStorage.getItem(this.META_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.warn('Meta load failed:', e);
      return null;
    }
  }
}
