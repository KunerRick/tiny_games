export interface RunData {
  currentRouteNode: number;
  playerClasses: string[];
  unitSkills: { [unitId: string]: string[] };
  gold: number;
  honor: number;
  /**
   * 已消费的荣誉（天赋树，设计 §6.2）。
   * `honor` 表示**累计获得**（成就判定用它），可用余额 = `honor - honorSpent`。
   * 可选字段：旧存档没有此项，按 0 处理。
   */
  honorSpent?: number;
  talents: string[];
  difficulty: string;
  unlockedClasses: string[];
  unlockedSkills: string[];
  /**
   * 上次战斗的布阵结果（按 playerClasses 下标对齐）；null = 该单位未上阵。
   * 可选字段：旧存档没有此项，读取时按"无记录"处理、回退默认阵型。
   */
  deployLayout?: ({ row: number; col: number } | null)[];
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
    honorSpent?: number;
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
    honorSpent?: number;
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
