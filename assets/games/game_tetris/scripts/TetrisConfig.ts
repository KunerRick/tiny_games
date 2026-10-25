/**
 * 方块坠落 — 规则与表现常量。
 *
 * 本文件不依赖 cc，可在 Node 侧直接编译验证。
 */

// ==================== 棋盘 ====================

export const BOARD_COLS = 10;

/** 逻辑行数：0–19 可见，20–21 为旋转踢墙与顶出的隐藏行 */
export const BOARD_ROWS = 22;

/** 可见行数（row 0 在底，19 在顶） */
export const VISIBLE_ROWS = 20;

/** 新方块的「最低占用格」落在这一行，保证出生即见 */
export const SPAWN_LOWEST_ROW = 18;

// ==================== 时间参数（秒） ====================

/** 触底后的锁延迟 */
export const LOCK_DELAY_SEC = 0.5;

/** 锁延迟最多被移动/旋转重置的次数 */
export const MAX_LOCK_RESETS = 15;

/** 软降每行间隔 */
export const SOFT_DROP_INTERVAL_SEC = 0.04;

/** 消行闪白时长 */
export const LINE_CLEAR_SEC = 0.12;

/** 重力间隔下限 */
export const MIN_GRAVITY_SEC = 0.03;

// ==================== 计分与等级 ====================

/** 一次消 1/2/3/4 行的基础分，再乘以等级 */
export const SCORE_PER_LINES = [0, 100, 300, 500, 800];

export const SOFT_DROP_POINTS_PER_CELL = 1;
export const HARD_DROP_POINTS_PER_CELL = 2;
export const LINES_PER_LEVEL = 10;

export function levelForLines(lines: number): number {
    return Math.floor(Math.max(0, lines) / LINES_PER_LEVEL) + 1;
}

/**
 * 重力间隔（秒/行）。
 * 等级 1 = 1s，等级 5 ≈ 0.36s，等级 10 ≈ 0.06s。
 */
export function gravityInterval(level: number): number {
    const lv = Math.max(1, Math.floor(level));
    const base = Math.max(0, 0.8 - (lv - 1) * 0.007);
    return Math.max(MIN_GRAVITY_SEC, Math.pow(base, lv - 1));
}

export function scoreForLines(count: number, level: number): number {
    const idx = Math.max(0, Math.min(4, Math.floor(count)));
    return SCORE_PER_LINES[idx] * Math.max(1, Math.floor(level));
}

// ==================== 触屏参数（设计像素，720 宽基准） ====================

/** 轻点判定：最大位移 */
export const TAP_MAX_MOVE = 18;

/** 轻点判定：最长时长（秒） */
export const TAP_MAX_SEC = 0.26;

/** 「拖了个空」回退为轻点的最长时长（秒） */
export const DRAG_FALLBACK_MAX_SEC = 0.4;

/** 硬降判定：竖向速度阈值（设计像素/毫秒） */
export const HARD_DROP_MIN_SPEED = 1.5;

/** 硬降判定：最小下移格数 */
export const HARD_DROP_MIN_ROWS = 2;

/** 按键长按后开始连发的延迟 */
export const DAS_SEC = 0.16;

/** 按键连发间隔 */
export const ARR_SEC = 0.05;

// ==================== 配色 ====================

export const PIECE_COLORS: Record<number, string> = {
    0: '#22D3EE', // I
    1: '#FACC15', // O
    2: '#A855F7', // T
    3: '#22C55E', // S
    4: '#EF4444', // Z
    5: '#3B82F6', // J
    6: '#F97316', // L
};

export const COLOR_BACKGROUND = '#0B1020';
export const COLOR_BOARD_BG = '#151E33';
export const COLOR_GRID_LINE = '#2E3A5E';
export const COLOR_TEXT_PRIMARY = '#F8FAFC';
export const COLOR_TEXT_SECONDARY = '#94A3B8';

// ==================== UI 主题（圆角面板 / 按钮 / 开关，见 TetrisSkin.ts） ====================

/** 卡片表面 */
export const UI_CARD = '#141C2E';
/** 卡片上的主文字（与 COLOR_TEXT_PRIMARY 同色，皮肤里按 UI_ 前缀取） */
export const UI_TEXT = '#F8FAFC';
/** 列表行 / 次要按钮表面 */
export const UI_ROW = '#1B2440';
/** 按下时的表面（比 UI_ROW 亮一档，只在按下态用） */
export const UI_ROW_PRESS = '#233052';
/** 描边 */
export const UI_STROKE = '#2B3757';
/** 主操作色 */
export const UI_ACCENT = '#3B82F6';
/** 主操作色的亮边 / 浅填充 */
export const UI_ACCENT_LIGHT = '#60A5FA';
export const UI_ACCENT_SOFT = '#1E3A8A';
/** 危险动作的文字色（返回大厅这类「退出」操作，不做成大红色块） */
export const UI_DANGER = '#F87171';
export const UI_DANGER_STROKE = '#40303C';
/** 奖励/新纪录 */
export const UI_GOLD = '#FACC15';
/** 次要文字（说明、标题小字） */
export const UI_TEXT_DIM = '#94A3B8';
/** 弱化的图示线条 */
export const UI_ICON_DIM = '#64748B';
/** 背景渐变：底部 → 顶部 */
export const UI_BG_BOTTOM = '#080C18';
export const UI_BG_TOP = '#101A31';

// ==================== 布局 ====================

/** 键盘/按钮模式下棋盘下方预留的高度（设计像素） */
export const BUTTON_BOTTOM_ZONE = 300;

/** 手势模式下棋盘下方预留的高度 */
export const GESTURE_BOTTOM_ZONE = 120;

/** 棋盘上方与下方的基础留白（算格子时扣掉） */
export const BOARD_TOP_RESERVED = 200;

export const MIN_CELL_SIZE = 36;
export const MAX_CELL_SIZE = 56;

/** 暂存面板尺寸 */
export const HOLD_PANEL_SIZE = 120;

/** Next 面板里的小方格边长（84 宽的面板放得下 4 格宽的 I） */
export const NEXT_MINI_CELL = 20;

/** Hold / Next 预览面板的绘制区域边长 */
export const PREVIEW_SIZE = 84;

/**
 * 运行时格宽：按可见区域算，取偶数便于居中。
 * 只按按钮模式（BOTTOM_ZONE 更大）算一次，切模式不重算——否则方块尺寸会跳变。
 */
export function computeCellSize(visibleWidth: number, visibleHeight: number): number {
    const byWidth = (visibleWidth - 240) / BOARD_COLS;
    const byHeight = (visibleHeight - BOARD_TOP_RESERVED - BUTTON_BOTTOM_ZONE) / VISIBLE_ROWS;
    const raw = Math.floor(Math.min(byWidth, byHeight) / 2) * 2;
    return Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, raw));
}

// ==================== 存储键（StorageManager 会再加 tiny_games_tetris_ 前缀） ====================

export const STORAGE_BEST_SCORE = 'best_score';
export const STORAGE_BEST_LINES = 'best_lines';
export const STORAGE_CONTROL_MODE = 'control_mode';
export const STORAGE_VIBRATE = 'vibrate';
export const STORAGE_TUTORIAL_DONE = 'tutorial_done';
export const STORAGE_HINT_USED = 'hint_used';
export const STORAGE_GAMES_PLAYED = 'games_played';
