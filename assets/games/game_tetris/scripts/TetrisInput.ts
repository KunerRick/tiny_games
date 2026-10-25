/**
 * 方块坠落 — 输入层契约。
 *
 * 游戏逻辑只认动作，不认输入设备（全屏手势 / 虚拟按键）。
 * 本文件不依赖 cc。
 */

export type ControlMode = 'gesture' | 'button';

export enum TetrisAction {
    Left,
    Right,
    RotateCW,
    RotateCCW,
    SoftDropStart,
    SoftDropEnd,
    HardDrop,
    Hold,
}

/**
 * 输入层接口。
 *
 * `disable()` 必须清空手势/连发/软降等**一切中间状态**，
 * 否则切换操作模式后会出现「切回来还在连发」的鬼影。
 */
export interface ITetrisInput {
    enable(): void;
    disable(): void;
}

/**
 * 输入层需要从游戏读取的少量信息。
 *
 * 手势是「相对位移」模型，必须知道当前方块在哪一列才能做列吸附；
 * 拖拽中方块可能锁定换新，所以还要一个身份令牌来判断是否需要重取基准。
 */
export interface ITetrisHost {
    applyAction(action: TetrisAction): void;

    /** 当前方块的逻辑列（piece.x）；无方块时返回 null */
    getPieceColumn(): number | null;

    /** 方块身份令牌：每次换块（生成/暂存交换）都变 */
    getPieceToken(): number;

    /** 当前格宽（设计像素） */
    getCellSize(): number;

    /** 把方块横移到目标列：逐格移动，撞墙即停（列吸附用） */
    snapPieceToColumn(column: number): void;
}
