/**
 * 纸牌接龙 — 布局、交互与计分常量。
 *
 * 本文件不依赖 cc，可在 Node 侧直接编译验证。
 * 坐标系：设计分辨率 720 × 1280，原点在左上角，x 向右，y **向下**。
 */

// ==================== 画布 ====================

export const DESIGN_W = 720;
export const DESIGN_H = 1280;

// ==================== 列栅格 ====================

/** 左右边距 */
export const BOARD_MARGIN_X = 15;
/** 列间距 */
export const COL_GAP = 10;
/** 牌宽 / 牌高（1.4 比例） */
export const CARD_W = 90;
export const CARD_H = 126;
/** 相邻列中心距 = 牌宽 + 间距 */
export const COL_STEP = CARD_W + COL_GAP;

/** 第 i 列的中心 x（i = 0..6） */
export function colCenterX(i: number): number {
    return BOARD_MARGIN_X + i * COL_STEP + CARD_W / 2;
}

/** 第 i 列的左边缘 x */
export function colLeftX(i: number): number {
    return BOARD_MARGIN_X + i * COL_STEP;
}

// ==================== 纵向分区 ====================

/** 顶栏高度 */
export const TOP_BAR_H = 96;
/** 上排（牌堆 / 废牌堆 / 收牌区）的顶部 y */
export const TOP_ROW_Y = 108;
/** 列区顶部 y */
export const COLUMN_TOP_Y = 256;
/** 列区底部限制 y */
export const COLUMN_BOTTOM_Y = 1140;
/** 底栏顶部 y */
export const BOTTOM_BAR_Y = 1150;

// ==================== 上排映射 ====================

/** 牌堆占用第 0 列 */
export const STOCK_COL = 0;
/** 废牌堆占用第 1 列 */
export const WASTE_COL = 1;
/** 4 个收牌区占用第 3–6 列（第 2 列留空作分隔） */
export const FOUNDATION_COLS = [3, 4, 5, 6];

// ==================== 牌堆排布 ====================

/** 背面牌露出高度 */
export const FAN_DOWN = 14;
/** 正面牌露出高度 */
export const FAN_UP = 30;
/** 超长列压缩后的正面最小露出高度 */
export const FAN_UP_MIN = 18;
/** 废牌堆抽 3 张时的横向扇开间距 */
export const WASTE_FAN = 26;
/** 牌堆厚度暗示：每张偏移（最多叠 4 张的量） */
export const STOCK_THICKNESS = 2;

// ==================== 交互 ====================

/** 位移小于该值（设计像素）视为点击，且**不限时长** */
export const TAP_SLOP = 8;
/** 收牌槽落点判定的外扩量 */
export const DROP_FOUNDATION_PAD = 12;
/** 列区落点判定的上边界外扩 */
export const DROP_COLUMN_PAD_TOP = 24;

/** 拖拽吸附动画时长（秒） */
export const SNAP_SEC = 0.10;
/** 非法落点回弹动画时长（秒） */
export const REBOUND_SEC = 0.14;
/** 回弹抖动横向位移 */
export const REBOUND_SHAKE_X = 6;
/** 提示高亮持续时长（秒） */
export const HINT_SEC = 4;
/** 连续点击提示的最小间隔（秒） */
export const HINT_COOLDOWN_SEC = 1.5;

// ==================== 牌堆重洗 ====================

/**
 * 挑战模式（设置里可开）一局最多重洗几次。
 * 经典规则的 Klondike 允许无限重洗——桌面每动一次，重洗才有新意义；
 * 这里保留 3 次作为「挑战」档，默认走经典（无限）。
 */
export const MAX_RECYCLES = 3;

// ==================== 计分 ====================

/** 废牌堆 → 列 */
export const SCORE_WASTE_TO_TABLEAU = 5;
/** 废牌堆 / 列 → 收牌区 */
export const SCORE_TO_FOUNDATION = 10;
/** 翻开列底背面牌 */
export const SCORE_FLIP = 5;
/** 收牌区 → 列 */
export const SCORE_FOUNDATION_TO_TABLEAU = -15;
/** 重洗牌堆（仅抽 3 张） */
export const SCORE_RECYCLE = -20;

// ==================== 撤销 ====================

/** 撤销栈上限 */
export const UNDO_LIMIT = 50;

// ==================== 存档 ====================

export const SAVE_VERSION = 1;
/** 每次提交移动后存盘的节流时长（秒） */
export const SAVE_THROTTLE_SEC = 0.5;

// ==================== 配色 ====================

export const COLOR_BG = '#0B1020';
export const COLOR_TABLE = '#151E33';
export const COLOR_SLOT_STROKE = '#2E3A5E';
export const COLOR_CARD_FACE = '#FDFBF7';
export const COLOR_CARD_EDGE = '#D8D2C4';
export const COLOR_CARD_BACK = '#2C5F8A';
export const COLOR_RED = '#D9483B';
export const COLOR_BLACK = '#1F2937';
export const COLOR_TEXT_PRIMARY = '#F8FAFC';
export const COLOR_TEXT_SECONDARY = '#94A3B8';
export const COLOR_HIGHLIGHT = '#38BDF8';
