/**
 * 小小先锋 设计令牌（Design Tokens）
 *
 * 通用令牌（色板 / 字号 / 间距 / 控件尺寸 / 消毒）已于 2026-11-08 上提到
 * `assets/common/ui/UITheme.ts`，全站共用一套；本文件只保留**本作专属**的：
 * 棋盘与高亮（GRID）、阵营色（FACTION）、职业色（CLASS_COLOR）、
 * 按钮过渡主题（BUTTON_THEME）、战斗分区（BATTLE_LAYOUT）。
 *
 * 兼容做法：把通用令牌原样再导出，这样既有的 `from '../config/Theme'` 导入无需改动；
 * 新代码建议直接引 `assets/common/ui/UITheme`。
 *
 * 约定：
 * - 颜色一律用语义令牌，不再在业务代码里散落魔法 RGB。
 * - 字号/行高必须成对使用 FONT_* 令牌；硬性约束 lineHeight >= fontSize * 1.2。
 * - 需要 Color 实例时用 hex(...) 工厂取新对象，不要共享实例（tween(Color) 会就地改值）。
 */
import { Button } from 'cc';
import { ALPHA, COLOR, CONTROL, SPACE, hex } from '../../../../common/ui/UITheme';

// 通用令牌再导出（色板 / 透明度 / 字号 / 间距 / 面板 / 控件 / 工具函数）
export * from '../../../../common/ui/UITheme';

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
  /** 部署区可部署格（淡绿薄涂：整块亮绿会盖过棋盘与单位，视觉太重） */
  DEPLOYABLE: hex(COLOR.SUCCESS, 105),
  /** 不可部署（敌方半场）格 */
  DEPLOY_DISABLED: hex(COLOR.TEXT_DISABLED, 80),
  /** 已部署格 */
  DEPLOYED: hex(COLOR.SUCCESS, 220),
  /**
   * 拖拽落点预览：可放。
   * 不能直接用 DEPLOYABLE —— 那正是部署区两行的**底色**，设上去等于零反馈。
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
// 战斗分区（§4 问题 5 的分区重构）
// ---------------------------------------------------------------------------

/** 战斗界面分区高度 */
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
