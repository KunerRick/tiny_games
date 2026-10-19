/**
 * 单个英雄在一局内的成长进度（按 `playerClasses` 下标对齐）。
 *
 * 为什么必须有这个结构：每场战斗 `BattleManager.startBattle()` 都会
 * `clearAllUnits()` + `createPlayerUnits()` **重建**全部单位，`applyUpgrade()`
 * 写进 `UnitData` 的永久属性在下一场就没了（技能靠 `unitSkills` 单独续命，
 * 属性类升级此前是**静默丢失**的）。所以凡是"跨战斗保留"的成长都必须落到这里，
 * 开战时由 `applyRunProgressToParty()` 重新灌回单位。
 */
export interface UnitProgress {
  /** 经验值（达到 expToNext(level) 才升级） */
  exp: number;
  /** 累计升级次数，从 1 起 */
  level: number;
  /** 永久属性加成（与 TALENTS 同口径，直接加到 baseStats） */
  bonus: {
    hp: number;
    attack: number;
    defense: number;
    maxEnergy: number;
  };
  /** 额外技能栏位（圣泉「精进」） */
  extraSkillSlots: number;
}

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
  /**
   * 各英雄的局内成长（经验/等级/永久属性/额外技能栏）。
   * 可选字段：旧存档没有此项，读取时按"等级 1、零加成"处理。
   */
  unitProgress?: { [unitId: string]: UnitProgress };
}

/** 升到下一级所需经验：随等级线性增长，前期升得快、后期慢 */
export function expToNext(level: number): number {
  return 6 + Math.max(0, level - 1) * 5;
}

/** 取（或补齐）某下标的成长记录，旧存档也能安全调用 */
export function ensureProgress(runData: RunData, index: number): UnitProgress {
  if (!runData.unitProgress) runData.unitProgress = {};
  let p = runData.unitProgress[index];
  if (!p) {
    p = { exp: 0, level: 1, bonus: { hp: 0, attack: 0, defense: 0, maxEnergy: 0 }, extraSkillSlots: 0 };
    runData.unitProgress[index] = p;
  }
  // 字段级兜底：老档或手改档可能缺 bonus/extraSkillSlots
  p.bonus = { hp: 0, attack: 0, defense: 0, maxEnergy: 0, ...(p.bonus ?? {}) };
  p.extraSkillSlots = p.extraSkillSlots ?? 0;
  p.exp = p.exp ?? 0;
  p.level = p.level ?? 1;
  return p;
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
