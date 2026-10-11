/**
 * 小小先锋 设计令牌（Design Tokens）
 *
 * 唯一权威依据：docs/plans/2026-10-08-tiny-vanguard-ui-ux-redesign.md §3、§7
 * 风格：深色科技风 —— 深底（#1E2430 系）+ 单一蓝色主强调（#3B82F6）。
 *
 * 约定：
 * - 颜色一律用本文件的语义令牌，不再在业务代码里散落魔法 RGB。
 * - 字号/行高必须成对使用 FONT_* 令牌；硬性约束 lineHeight >= fontSize * 1.2。
 * - 需要 Color 实例时用 hex(...) 工厂取新对象，不要共享实例（tween(Color) 会就地改值）。
 */
import { Color, Label } from 'cc';

// ---------------------------------------------------------------------------
// 色板（§3.1）
// ---------------------------------------------------------------------------

/** 语义色令牌（十六进制，不含 alpha） */
export const COLOR = {
  /** 全屏遮罩 */
  BG_OVERLAY: '#000000',
  /** 面板底 */
  PANEL_BG: '#1E2430',
  /** 面板内次级块（列表行、卡片底） */
  SURFACE: '#263041',
  /** 面板描边 */
  PANEL_BORDER: '#3A4658',

  /** 主操作：继续 / 确认 */
  PRIMARY: '#3B82F6',
  /** 主操作按下态 */
  PRIMARY_DARK: '#2563EB',
  /** 禁用态底 */
  PRIMARY_DISABLED: '#374151',

  /** 可用 / 成功 / 回血 */
  SUCCESS: '#22C55E',
  /** 敌人 / 伤害 / 失败 */
  DANGER: '#EF4444',
  /** 高亮 / 金币 / 奖励 */
  WARNING: '#F59E0B',
  /** 能量 / 技能 */
  INFO: '#06B6D4',

  /** 正文 */
  TEXT_PRIMARY: '#F3F4F6',
  /** 次要说明 */
  TEXT_SECONDARY: '#9CA3AF',
  /** 不可用文字 */
  TEXT_DISABLED: '#6B7280',
} as const;

/** 语义色的标准透明度（0–255），与 COLOR 配套使用 */
export const ALPHA = {
  BG_OVERLAY: 180,
  PANEL_BG: 245,
  SOLID: 255,
  /** 禁用/不可达元素（非半透明覆盖层，仍为实心块，只是整体压暗） */
  DIMMED: 255,
  /** 连线等装饰性描边 */
  LINE: 220,
} as const;

/** 取一个新的 Color 实例。不要共享实例：Color 是可变的 ValueType。 */
export function hex(hexString: string, alpha: number = ALPHA.SOLID): Color {
  const c = new Color();
  c.fromHEX(hexString);
  c.a = alpha;
  return c;
}

/** 血条填充色：按血量比例切换（§4 问题 6） */
export function hpBarColor(current: number, max: number): Color {
  const ratio = max > 0 ? current / max : 0;
  if (ratio > 0.5) return hex(COLOR.SUCCESS);
  if (ratio > 0.2) return hex(COLOR.WARNING);
  return hex(COLOR.DANGER);
}

// ---------------------------------------------------------------------------
// 字号阶梯（§3.2，行高 = 字号 × 1.4）
// ---------------------------------------------------------------------------

export interface FontToken {
  readonly fontSize: number;
  readonly lineHeight: number;
}

/** 通关/胜利大标题 */
export const FONT_DISPLAY: FontToken = { fontSize: 40, lineHeight: 56 };
/** 面板标题 */
export const FONT_TITLE: FontToken = { fontSize: 28, lineHeight: 40 };
/** 正文 / 按钮文字 */
export const FONT_BODY: FontToken = { fontSize: 20, lineHeight: 28 };
/** 次要说明 */
export const FONT_CAPTION: FontToken = { fontSize: 16, lineHeight: 22 };
/** 单位名牌 */
export const FONT_TINY: FontToken = { fontSize: 13, lineHeight: 18 };

/** 硬性约束：行高至少为字号的 1.2 倍 */
export const MIN_LINE_HEIGHT_RATIO = 1.2;

/** 行高是否满足硬性约束 */
export function lineHeightOk(fontSize: number, lineHeight: number): boolean {
  return lineHeight >= fontSize * MIN_LINE_HEIGHT_RATIO;
}

/**
 * 统一应用字号令牌到 Label（同时写 fontSize 与 lineHeight）。
 * 用它替代手写 `label.fontSize = 40` —— 后者会留下默认 lineHeight 40 的旧值，
 * 正是「fontSize > lineHeight」这类拥挤问题的成因。
 */
export function applyFont(label: Label | null, token: FontToken): void {
  if (!label || !label.isValid) return;
  label.fontSize = token.fontSize;
  label.lineHeight = token.lineHeight;
}

/** 应用字号令牌 + 文字颜色令牌 */
export function applyFontAndColor(
  label: Label | null,
  token: FontToken,
  colorHex: string,
  alpha: number = ALPHA.SOLID
): void {
  applyFont(label, token);
  if (label && label.isValid) {
    label.color = hex(colorHex, alpha);
  }
}

// ---------------------------------------------------------------------------
// 间距与尺寸（§3.3）
// ---------------------------------------------------------------------------

/** 间距基准 8 */
export const SPACE = {
  XS: 4,
  SM: 8,
  MD: 16,
  LG: 24,
  XL: 32,
} as const;

/** 画布设计分辨率 */
export const CANVAS = { width: 720, height: 1280 } as const;

/** 面板统一推荐尺寸与留白 */
export const PANEL = {
  /** 推荐面板宽（画布 720 留安全边距） */
  WIDTH: 640,
  /** 推荐面板高上限 */
  MAX_HEIGHT: 960,
  /** 面板内边距 */
  PADDING: 24,
  /** 标题与正文间距 */
  TITLE_GAP: 16,
  /** 面板圆角（用 Sprite/Graphics 时的参考值） */
  RADIUS: 16,
} as const;

/** 控件尺寸 */
export const CONTROL = {
  /** 按钮统一高度（当前 36/40/60 混用） */
  BTN_HEIGHT: 48,
  /** 主按钮宽度 */
  BTN_WIDTH: 200,
  /** 列表行高 */
  ROW_HEIGHT: 64,
  /** 列表行间距 */
  ROW_GAP: 12,
  /** 卡片尺寸（升级三选一） */
  CARD_WIDTH: 180,
  CARD_HEIGHT: 260,
  CARD_GAP: 20,
} as const;

/** 战斗界面分区高度（§4 问题 5 的分区重构） */
export const BATTLE_LAYOUT = {
  /** 顶部 HUD：左回合 / 右金币 */
  HUD_HEIGHT: 64,
  /** 阶段条：合并后的唯一提示行 */
  PHASE_BAR_WIDTH: 640,
  PHASE_BAR_HEIGHT: 40,
  /** 行动栏 */
  ACTION_BAR_HEIGHT: 72,
  /** 行动栏按钮等宽 */
  ACTION_BTN_WIDTH: 132,
  ACTION_BTN_HEIGHT: CONTROL.BTN_HEIGHT,
  ACTION_BTN_GAP: SPACE.MD,
} as const;
