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
export const BOARD_MARGIN_X = 6;
/** 列间距 */
export const COL_GAP = 4;
/** 牌宽 / 牌高（1.4 比例）。
 * 牌宽被 7 列卡死：7 × 98 + 6 × 4 + 2 × 6 = 722 已经贴满 720，横向放不大；
 * 第二轮复核 N14 的「再放大 15%」只能在**纵向**消化——牌高 137 → 148（+8%），
 * 比例变 1.51，牌面数字更好认，同时配合下面加大的扇开间距填满中部空白。 */
export const CARD_W = 98;
export const CARD_H = 148;
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

/** 背面牌露出高度（N14：加大扇开间距，让牌列更快占满纵向空间） */
export const FAN_DOWN = 24;
/** 正面牌露出高度 */
export const FAN_UP = 50;
/** 超长列压缩后的正面最小露出高度 */
export const FAN_UP_MIN = 26;
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
/** 连续点击提示的最小间隔（秒；计划 §2.1.8 G3：3 s 内重复点击只续亮当前提示） */
export const HINT_COOLDOWN_SEC = 3;

// ==================== 胜利过渡 ====================

/** 4 个收牌堆依次亮起的间隔（秒） */
export const WIN_FX_STEP = 0.18;
/** 单个收牌堆「亮起 → 收暗」的时长（秒） */
export const WIN_FX_SWEEP = 0.5;
/** 胜利流光总时长，结束后才弹结算面板（秒） */
export const WIN_FX_SEC = 1.4;

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
//
// 与 `common/ui/UITheme.ts` 的语义令牌对齐（本文件要在 Node 侧裸编译，不能 import cc，
// 所以在这里抄一份十六进制值，改动时两边同步）：
//   BG/文本/描边/主色 = COLOR.BG_SCENE / TEXT_* / PANEL_BORDER / PRIMARY
// 牌面仍是奶油白——真实扑克牌该有的样子，深色主题只换周围的「桌面」。
export const COLOR_BG = '#0B1220';
export const COLOR_TABLE = '#111B2E';
export const COLOR_SLOT_STROKE = '#3A4658';
export const COLOR_CARD_FACE = '#FDFBF7';
export const COLOR_CARD_EDGE = '#D8D2C4';
export const COLOR_CARD_BACK = '#1D4ED8';
/** 红 / 黑都往两端再拉一点，牌面在深色台面缩略图下也能一眼分花色 */
export const COLOR_RED = '#E23A2E';
export const COLOR_BLACK = '#111827';
export const COLOR_TEXT_PRIMARY = '#F3F4F6';
export const COLOR_TEXT_SECONDARY = '#9CA3AF';
export const COLOR_HIGHLIGHT = '#3B82F6';
/** 空槽虚线（比描边更弱一档，避免和牌框抢视觉） */
export const COLOR_SLOT_DASH = '#2A3342';
/** 空槽里的浅色提示图形（K / A） */
export const COLOR_SLOT_HINT = '#FFFFFF';
