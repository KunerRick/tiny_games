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
import { Button, Color, Label } from 'cc';

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
  /** 危险态按下（DANGER 的暗版，用于按钮 pressed） */
  DANGER_DARK: '#DC2626',
  /** 高亮 / 金币 / 奖励 */
  WARNING: '#F59E0B',
  /** 能量 / 技能 */
  INFO: '#06B6D4',
  /**
   * 被动技能（升级卡的"被动"分类色）。
   * 方案 §4 问题 4 指定"技能蓝 / 被动紫 / 属性绿"；原先被动用 INFO 青，
   * 与主动的 PRIMARY 蓝同属冷色系、相邻色相，一眼分不出分类 —— 故补这个紫。
   */
  PASSIVE: '#A855F7',

  /** 正文 */
  TEXT_PRIMARY: '#F3F4F6',
  /** 次要说明 */
  TEXT_SECONDARY: '#9CA3AF',
  /** 不可用文字 */
  TEXT_DISABLED: '#6B7280',
  /**
   * 「空站台」凹坑底色：比 `PANEL_BG` 更暗，读感像"挖掉一块的地面"。
   * 用于兵牌槽位已被拖上阵后的状态（§3.4）。
   */
  SLOT_EMPTY_BG: '#141A24',
  /** 「空站台」凹坑描边：介于凹坑与 `PANEL_BORDER` 之间，形成内凹感 */
  SLOT_EMPTY_BORDER: '#2A3342',
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
  /** 拖拽中的"幽灵"节点（跟随手指的半透明副本） */
  DRAG_GHOST: 200,
  /** “空站台”凹坑底色透明度（略透，露出下方面板色，强化凹陷感） */
  SLOT_EMPTY_BG: 225,
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
// 战斗棋盘与高亮（§4 问题 6）
// ---------------------------------------------------------------------------
// 这些颜色原先散落在 GridController / BattleManager / UnitController 里，
// 各写各的 RGB，同语义（如"可移动范围"）在多处出现近似但不相同的值。

export const GRID = {
  /** 棋盘格默认底色（渲染时始终实心不透明，避免 clearHighlights 后闪烁） */
  CELL_DEFAULT: hex(COLOR.PANEL_BG, 235),
  /** 选中单位所在格 */
  CELL_SELECTED: hex(COLOR.WARNING, 150),
  /** 移动预览格（鼠标悬停） */
  CELL_PREVIEW: hex(COLOR.WARNING, 220),
  /** 部署区可部署格 */
  DEPLOYABLE: hex(COLOR.SUCCESS, 180),
  /** 不可部署（敌方半场）格 */
  DEPLOY_DISABLED: hex(COLOR.TEXT_DISABLED, 110),
  /** 已部署格 */
  DEPLOYED: hex(COLOR.SUCCESS, 220),
  /**
   * 拖拽落点预览：可放。
   * 不能直接用 DEPLOYABLE（180）—— 那正是部署区两行的**底色**，设上去等于零反馈。
   * 用实心绿，保证相对底色可见。
   */
  DRAG_DROP_VALID: hex(COLOR.SUCCESS, 255),
  /**
   * 拖拽落点预览：不可放。
   * 同理不能用 DEPLOY_DISABLED（110 灰）—— 那是敌方半场的底色；改用 DANGER 红，
   * 与"敌方半场灰底"和"已占用绿底"都能区分。
   */
  DRAG_DROP_INVALID: hex(COLOR.DANGER, 210),
  /** 可移动范围 */
  MOVE_RANGE: hex(COLOR.SUCCESS, 180),
  /** 可攻击范围 */
  ATTACK_RANGE: hex(COLOR.DANGER, 180),
  /** 技能可选目标（单体，偏亮黄） */
  SKILL_TARGET: hex('#FBBF24', 200),
  /** 技能可选目标（AOE，偏橙） */
  SKILL_TARGET_AOE: hex(COLOR.WARNING, 200),
  /** AOE 预览中心 */
  AOE_CENTER: hex(COLOR.DANGER, 220),
  /** AOE 预览范围 */
  AOE_RANGE: hex(COLOR.DANGER, 120),
  /** 技能确认目标（单体二次点击） */
  SELECTED_TARGET: hex('#FDE047', 255),
} as const;

/** 阵营配色：玩家统一 PRIMARY 系、敌人统一 DANGER 系（§4 问题 6） */
export const FACTION = {
  PLAYER_TINT: hex(COLOR.PRIMARY, ALPHA.SOLID),
  ENEMY_TINT: hex(COLOR.DANGER, ALPHA.SOLID),
  PLAYER_GLOW: hex(COLOR.PRIMARY, 100),
  ENEMY_GLOW: hex(COLOR.DANGER, 100),
} as const;

// ---------------------------------------------------------------------------
// 按钮过渡色（§3.1）
// ---------------------------------------------------------------------------
// Button 的 COLOR 过渡会按状态改写节点 Sprite 颜色，若用引擎默认值
// （hover d3d3d3 / disabled 7c7c7c）会把设计令牌配色冲掉 —— 典型症状是
// 禁用按钮显示成灰色而不是 PRIMARY_DISABLED。故所有按钮统一走这里。

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger';

export const BUTTON_THEME: Record<ButtonVariant, {
  normal: string; pressed: string; hover: string; disabled: string;
}> = {
  primary:   { normal: COLOR.PRIMARY,   pressed: COLOR.PRIMARY_DARK,  hover: '#60A5FA', disabled: COLOR.PRIMARY_DISABLED },
  secondary: { normal: COLOR.SURFACE,   pressed: COLOR.PANEL_BORDER,  hover: '#31405A', disabled: COLOR.PRIMARY_DISABLED },
  success:   { normal: COLOR.SUCCESS,   pressed: '#16A34A',            hover: '#4ADE80', disabled: COLOR.PRIMARY_DISABLED },
  danger:    { normal: COLOR.DANGER,    pressed: COLOR.DANGER_DARK,    hover: '#F87171', disabled: COLOR.PRIMARY_DISABLED },
};

/**
 * 给按钮套用统一的 COLOR 过渡令牌。
 * 用 COLOR 而非 SCALE 是为了让「禁用态」也有明确视觉（PRIMARY_DISABLED），
 * 但四个状态色必须全部显式写令牌 —— 否则引擎默认值会把配色冲掉。
 */
export function applyButtonTheme(btn: Button | null, variant: ButtonVariant): void {
  if (!btn || !btn.isValid) return;
  const t = BUTTON_THEME[variant];
  btn.transition = Button.Transition.COLOR;
  btn.normalColor = hex(t.normal);
  btn.pressedColor = hex(t.pressed);
  btn.hoverColor = hex(t.hover);
  btn.disabledColor = hex(t.disabled);
}

/**
 * 职业区分色（保留语义区分：四个职业需要一眼可辨）。
 * 这些**不是**「同语义多色」，而是四种并列语义，故各自独立成令牌，
 * 但统一在同一色板体系内（蓝/绿/紫/金）。
 */
export const CLASS_COLOR = {
  warrior: '#64B4FF',
  archer: '#64DC64',
  mage: '#B464DC',
  cleric: '#F0D250',
  /** 未知职业兜底 */
  fallback: '#64B4FF',
} as const;

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
/** 图标字号（emoji 图形标记，非正文；单行无换行，行高取字号 1.25 倍） */
export const FONT_ICON: FontToken = { fontSize: 32, lineHeight: 40 };

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
