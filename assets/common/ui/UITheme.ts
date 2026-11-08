/**
 * 全站设计令牌（Design Tokens）—— 唯一权威来源。
 *
 * 两套历史色板在这里合流：
 *  - `COLOR`：语义令牌（深底 + 单一主强调），小小先锋 / 统一改造后的页面在用；
 *  - `UI`：早期各游戏直接引用的简写色板（bg / panel / accent …）。
 *    两者的语义一一对应（见 `UI` 上方注释），**新代码一律用 `COLOR`**；
 *    旧代码迁移完成后 `UI` 会收缩成 `COLOR` 的别名。
 *
 * 约定：
 * - 颜色一律用语义令牌，不在业务代码里散落魔法 RGB；
 * - 字号/行高必须成对使用 `FontToken`，并满足 `lineHeight >= fontSize * 1.2`；
 * - 需要 `Color` 实例时用 `hex(...)` 取新对象（Color 是可变的 ValueType）。
 */
import { Color, Label } from 'cc';

// ==================== 语义色板 ====================

/** 语义色令牌（十六进制，不含 alpha） */
export const COLOR = {
  /** 全屏遮罩 */
  BG_OVERLAY: '#000000',
  /** 场景底色（相机清屏色 / 全屏底板） */
  BG_SCENE: '#0B1220',
  /** 面板底 */
  PANEL_BG: '#1E2430',
  /** 面板底（浅一档，用于列表行 / 卡片） */
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
  /** 危险态按下 */
  DANGER_DARK: '#DC2626',
  /** 高亮 / 金币 / 奖励 */
  WARNING: '#F59E0B',
  /** 能量 / 技能 */
  INFO: '#06B6D4',
  /** 被动技能 / 次级强调 */
  PASSIVE: '#A855F7',

  /** 正文 */
  TEXT_PRIMARY: '#F3F4F6',
  /** 次要说明 */
  TEXT_SECONDARY: '#9CA3AF',
  /** 不可用文字 */
  TEXT_DISABLED: '#6B7280',

  /** 「空槽位」凹坑底色：比 PANEL_BG 更暗，像挖掉一块的地面 */
  SLOT_EMPTY_BG: '#141A24',
  /** 「空槽位」凹坑描边 */
  SLOT_EMPTY_BORDER: '#2A3342',
} as const;

/**
 * 早期简写色板（9 款已上线游戏在用）。
 *
 * **取值故意保持历史原样**，保证这次令牌合流不改动任何已上线画面的颜色；
 * 右列是第 2 步「跨游戏统一」要收敛到的语义令牌。
 *
 * | UI.*        | 现值（保持） | 目标语义令牌        |
 * |-------------|-------------|--------------------|
 * | bg          | #0B1220     | COLOR.BG_SCENE     |
 * | bgSoft      | #111B2E     | COLOR.SURFACE      |
 * | panel       | #151F33     | COLOR.PANEL_BG     |
 * | panelStroke | #27364F     | COLOR.PANEL_BORDER |
 * | text        | #F8FAFC     | COLOR.TEXT_PRIMARY |
 * | textDim     | #94A3B8     | COLOR.TEXT_SECONDARY |
 * | textMuted   | #64748B     | COLOR.TEXT_DISABLED|
 * | accent      | #38BDF8     | COLOR.INFO         |
 * | primary     | #2563EB     | COLOR.PRIMARY_DARK |
 * | success     | #22C55E     | COLOR.SUCCESS      |
 * | danger      | #EF4444     | COLOR.DANGER       |
 * | warning     | #F59E0B     | COLOR.WARNING      |
 *
 * 迁移方式：各游戏把 `UI.xxx` 换成对应的 `COLOR.YYY`（而不是直接改变 `UI`
 * 的取值）—— 后者会一次性改掉 9 款游戏的画面，出问题无法二分。
 *
 * 注意：这里**不能**写 `as const`。历史代码会把 `UI.warning` 当成 string 变量
 * 反复赋给同一个字段（`let tint = UI.textDim; tint = UI.success;`），
 * 加了字面量类型会把这类写法全判成错误。
 */
export const UI: Record<string, string> = {
  bg: COLOR.BG_SCENE,
  bgSoft: '#111B2E',
  panel: '#151F33',
  panelStroke: '#27364F',
  text: '#F8FAFC',
  textDim: '#94A3B8',
  textMuted: '#64748B',
  accent: '#38BDF8',
  accentDark: '#0E7490',
  primary: COLOR.PRIMARY_DARK,
  success: COLOR.SUCCESS,
  danger: COLOR.DANGER,
  warning: COLOR.WARNING,
  white: '#FFFFFF',
  overlay: '#050912',
};

/** 语义色的标准透明度（0–255），与 COLOR 配套使用 */
export const ALPHA = {
  BG_OVERLAY: 180,
  PANEL_BG: 245,
  SOLID: 255,
  /** 禁用/不可达元素（实心块整体压暗） */
  DIMMED: 255,
  /** 连线等装饰性描边 */
  LINE: 220,
  /** 拖拽中的"幽灵"节点 */
  DRAG_GHOST: 200,
  /** 「空槽位」凹坑底色 */
  SLOT_EMPTY_BG: 225,
} as const;

/** 取一个新的 Color 实例。不要共享实例：Color 是可变的 ValueType。 */
export function hex(hexString: string, alpha: number = ALPHA.SOLID): Color {
  const c = new Color();
  c.fromHEX(hexString);
  c.a = alpha;
  return c;
}

/** 血条填充色：按血量比例切换 */
export function hpBarColor(current: number, max: number): Color {
  const ratio = max > 0 ? current / max : 0;
  if (ratio > 0.5) return hex(COLOR.SUCCESS);
  if (ratio > 0.2) return hex(COLOR.WARNING);
  return hex(COLOR.DANGER);
}

// ==================== 字号阶梯 ====================

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
/** 单位名牌（手机端最小可读档） */
export const FONT_TINY: FontToken = { fontSize: 13, lineHeight: 18 };
/** 图标字号（emoji 图形标记，单行无换行） */
export const FONT_ICON: FontToken = { fontSize: 32, lineHeight: 40 };

/** 硬性约束：行高至少为字号的 1.2 倍 */
export const MIN_LINE_HEIGHT_RATIO = 1.2;

/** 行高是否满足硬性约束 */
export function lineHeightOk(fontSize: number, lineHeight: number): boolean {
  return lineHeight >= fontSize * MIN_LINE_HEIGHT_RATIO;
}

/** 统一应用字号令牌到 Label（同时写 fontSize 与 lineHeight） */
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

// ==================== 图标文本消毒 ====================

/**
 * 去掉变体选择符：U+FE0E（文本呈现符）/ U+FE0F（emoji 呈现符）。
 *
 * 同一个 emoji 带不带 VS16 是两个不同码点序列；字体缺 VS16 字形时会把那个
 * 不可见字符渲染成方框（tofu）。所有图标字符串写进 `Label.string` 前一律先过这里。
 */
export function stripVariationSelectors(text: string): string {
  if (!text) return text;
  // 用转义写，避免源码里躺看不见的字符
  return text.replace(/[\uFE0E\uFE0F]/g, '');
}

// ==================== 间距与尺寸 ====================

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
  WIDTH: 640,
  MAX_HEIGHT: 960,
  PADDING: 24,
  TITLE_GAP: 16,
  RADIUS: 16,
} as const;

/** 控件尺寸 */
export const CONTROL = {
  /** 按钮统一高度 */
  BTN_HEIGHT: 48,
  BTN_WIDTH: 200,
  /** 列表行高 */
  ROW_HEIGHT: 64,
  ROW_GAP: 12,
  /** 卡片尺寸（三选一） */
  CARD_WIDTH: 180,
  CARD_HEIGHT: 260,
  CARD_GAP: 20,
} as const;
