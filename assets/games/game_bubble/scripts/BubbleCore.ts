/**
 * 泡泡龙 —— 纯逻辑核心（不依赖 cc，可被 Node 自检直接编译）。
 *
 * 负责：六边形错位网格、关卡生成、发射弹道（含墙面镜面反射）、
 * 吸附落位、同色连通消除、悬空泡泡掉落、快照存取。
 *
 * 坐标系是「盘面局部空间」：原点在盘面左上角，x 向右、y 向下，
 * 与设计坐标的差值由 UI 层做平移，逻辑里不出现任何屏幕坐标。
 *
 * 行号 0 在最上方；偶数行 10 个泡泡、奇数行 9 个（左右各内缩一个半径）。
 */

/** 网格列数（偶数行的泡泡数；奇数行为 COLS-1） */
export const BUBBLE_COLS = 10;
/** 泡泡半径（设计像素） */
export const BUBBLE_R = 32;
/** 行高：六边形堆积的 √3·R */
export const BUBBLE_ROW_H = BUBBLE_R * Math.sqrt(3);
/** 盘面最大行数 */
export const BUBBLE_MAX_ROWS = 13;
/** 空格子标记 */
export const BUBBLE_EMPTY = -1;
/** 盘面宽度（左右墙内沿之间） */
export const BUBBLE_BOARD_W = BUBBLE_COLS * 2 * BUBBLE_R;

/** 同色连通块达到这个数量才消除 */
export const BUBBLE_MATCH_MIN = 3;

const TRACE_STEP = 4;
const TRACE_MAX_STEPS = 3000;
/** 判定「碰到已有泡泡」的距离系数：略小于 2R，避免擦边误判 */
const HIT_RATIO = 0.96;

export interface BubbleLevel {
    id: number;
    /** 初始行数 */
    rows: number;
    /** 颜色种类 4 / 5 / 6 */
    colors: number;
    /** 发射次数 */
    shots: number;
    /** 布局种子（同关同一图案） */
    seed: number;
}

export interface BubbleSnapshot {
    v: 1;
    maxRows: number;
    /** 长度 maxRows*COLS，BUBBLE_EMPTY 表示空 */
    grid: number[];
}

export interface BubbleCellRef {
    row: number;
    col: number;
}

export interface BubbleSettleResult {
    /** 被消除的格子（同色连通块） */
    popped: BubbleCellRef[];
    /** 因悬空而掉落的格子 */
    dropped: BubbleCellRef[];
    /** 本次结算得分 */
    score: number;
}

export interface ShotTrace {
    /** 落点格子；null = 空放（没有合法落点） */
    cell: BubbleCellRef | null;
    /** 折线路径，首点 = 发射点；有反弹时会多出拐点 */
    path: Array<{ x: number; y: number }>;
}

// ==================== 随机 ====================

/** 确定性 PRNG（与三消 / 五子棋 / 成语猜猜同一实现） */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function next(): number {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ==================== 网格几何 ====================

/** 第 row 行的可容纳列数 */
export function rowLength(row: number): number {
    return row % 2 === 0 ? BUBBLE_COLS : BUBBLE_COLS - 1;
}

/** 第 row 行是否右移半个格子 */
export function isOddRow(row: number): boolean {
    return row % 2 !== 0;
}

/** 格心坐标（盘面局部空间） */
export function cellCenter(row: number, col: number): { x: number; y: number } {
    const x = isOddRow(row) ? BUBBLE_R * 2 + col * BUBBLE_R * 2 : BUBBLE_R + col * BUBBLE_R * 2;
    return { x, y: BUBBLE_R + row * BUBBLE_ROW_H };
}

/** 距离某点最近的格子（不判断是否为空） */
export function cellAtPoint(x: number, y: number): BubbleCellRef | null {
    const rowF = (y - BUBBLE_R) / BUBBLE_ROW_H;
    let best: BubbleCellRef | null = null;
    let bestD = Infinity;
    for (let row = Math.floor(rowF) - 1; row <= Math.floor(rowF) + 1; row++) {
        if (row < 0 || row >= BUBBLE_MAX_ROWS) continue;
        const len = rowLength(row);
        for (let col = 0; col < len; col++) {
            const c = cellCenter(row, col);
            const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
            if (d < bestD) {
                bestD = d;
                best = { row, col };
            }
        }
    }
    return best;
}

/** 六邻域（越界的不返回） */
export function neighborsOf(row: number, col: number): BubbleCellRef[] {
    const odd = isOddRow(row);
    const deltas = odd
        ? [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]
        : [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
    const out: BubbleCellRef[] = [];
    for (let i = 0; i < deltas.length; i++) {
        const r = row + deltas[i][0];
        const c = col + deltas[i][1];
        if (r < 0 || r >= BUBBLE_MAX_ROWS) continue;
        if (c < 0 || c >= rowLength(r)) continue;
        out.push({ row: r, col: c });
    }
    return out;
}

// ==================== 盘面 ====================

export class BubbleBoard {
    readonly maxRows: number;
    /** row * BUBBLE_COLS + col → 颜色下标 / BUBBLE_EMPTY */
    grid: Int16Array;

    constructor(maxRows: number = BUBBLE_MAX_ROWS) {
        this.maxRows = Math.max(1, Math.min(BUBBLE_MAX_ROWS, maxRows | 0));
        this.grid = new Int16Array(this.maxRows * BUBBLE_COLS);
        this.grid.fill(BUBBLE_EMPTY);
    }

    private idx(row: number, col: number): number {
        return row * BUBBLE_COLS + col;
    }

    inRange(row: number, col: number): boolean {
        if (row < 0 || row >= this.maxRows) return false;
        return col >= 0 && col < rowLength(row);
    }

    get(row: number, col: number): number {
        if (!this.inRange(row, col)) return BUBBLE_EMPTY;
        return this.grid[this.idx(row, col)];
    }

    set(row: number, col: number, color: number): void {
        if (!this.inRange(row, col)) return;
        this.grid[this.idx(row, col)] = color;
    }

    clear(row: number, col: number): void {
        this.set(row, col, BUBBLE_EMPTY);
    }

    /** 空且在图内 */
    isFree(row: number, col: number): boolean {
        return this.inRange(row, col) && this.grid[this.idx(row, col)] === BUBBLE_EMPTY;
    }

    /** 同色连通块（不含自身以外颜色） */
    groupAt(row: number, col: number): BubbleCellRef[] {
        const color = this.get(row, col);
        if (color === BUBBLE_EMPTY) return [];
        const seen = new Uint8Array(this.grid.length);
        const out: BubbleCellRef[] = [];
        const stack: BubbleCellRef[] = [{ row, col }];
        seen[this.idx(row, col)] = 1;
        while (stack.length > 0) {
            const cur = stack.pop() as BubbleCellRef;
            out.push(cur);
            const ns = neighborsOf(cur.row, cur.col);
            for (let i = 0; i < ns.length; i++) {
                const n = ns[i];
                const id = this.idx(n.row, n.col);
                if (seen[id]) continue;
                if (this.grid[id] !== color) continue;
                seen[id] = 1;
                stack.push(n);
            }
        }
        return out;
    }

    /** 掉落的格子：占用但连不到第 0 行 */
    floaters(): BubbleCellRef[] {
        const reach = this.reachFromCeiling();
        const out: BubbleCellRef[] = [];
        for (let row = 0; row < this.maxRows; row++) {
            const len = rowLength(row);
            for (let col = 0; col < len; col++) {
                const id = this.idx(row, col);
                if (this.grid[id] === BUBBLE_EMPTY) continue;
                if (!reach[id]) out.push({ row, col });
            }
        }
        return out;
    }

    /** 从第 0 行向下、只经过「有泡泡」的格子能到达的集合 */
    private reachFromCeiling(): Uint8Array {
        const reach = new Uint8Array(this.grid.length);
        const stack: BubbleCellRef[] = [];
        for (let col = 0; col < rowLength(0); col++) {
            if (this.grid[this.idx(0, col)] !== BUBBLE_EMPTY) {
                const id = this.idx(0, col);
                if (!reach[id]) {
                    reach[id] = 1;
                    stack.push({ row: 0, col });
                }
            }
        }
        while (stack.length > 0) {
            const cur = stack.pop() as BubbleCellRef;
            const ns = neighborsOf(cur.row, cur.col);
            for (let i = 0; i < ns.length; i++) {
                const n = ns[i];
                const id = this.idx(n.row, n.col);
                if (reach[id]) continue;
                if (this.grid[id] === BUBBLE_EMPTY) continue;
                reach[id] = 1;
                stack.push(n);
            }
        }
        return reach;
    }

    /** 落位后结算：≥3 同色消除 → 悬空掉落 */
    settle(row: number, col: number): BubbleSettleResult {
        const color = this.get(row, col);
        if (color === BUBBLE_EMPTY) return { popped: [], dropped: [], score: 0 };

        const group = this.groupAt(row, col);
        if (group.length < BUBBLE_MATCH_MIN) return { popped: [], dropped: [], score: 0 };

        for (let i = 0; i < group.length; i++) this.clear(group[i].row, group[i].col);
        const dropped = this.floaters();
        for (let i = 0; i < dropped.length; i++) this.clear(dropped[i].row, dropped[i].col);

        const score = group.length * 10 + dropped.length * 20;
        return { popped: group, dropped, score };
    }

    isEmpty(): boolean {
        for (let i = 0; i < this.grid.length; i++) {
            if (this.grid[i] !== BUBBLE_EMPTY) return false;
        }
        return true;
    }

    occupiedCount(): number {
        let n = 0;
        for (let i = 0; i < this.grid.length; i++) {
            if (this.grid[i] !== BUBBLE_EMPTY) n++;
        }
        return n;
    }

    /** 最下面一行的行号；空盘返回 -1 */
    lowestOccupiedRow(): number {
        for (let row = this.maxRows - 1; row >= 0; row--) {
            const len = rowLength(row);
            for (let col = 0; col < len; col++) {
                if (this.grid[this.idx(row, col)] !== BUBBLE_EMPTY) return row;
            }
        }
        return -1;
    }

    /** 盘面上出现过的颜色（升序） */
    colorsPresent(): number[] {
        const seen: number[] = [];
        for (let i = 0; i < this.grid.length; i++) {
            const v = this.grid[i];
            if (v === BUBBLE_EMPTY) continue;
            if (seen.indexOf(v) < 0) seen.push(v);
        }
        seen.sort((a, b) => a - b);
        return seen;
    }

    snapshot(): BubbleSnapshot {
        return { v: 1, maxRows: this.maxRows, grid: Array.from(this.grid) };
    }

    static fromSnapshot(s: BubbleSnapshot): BubbleBoard {
        const maxRows = s && typeof s.maxRows === 'number' ? s.maxRows : BUBBLE_MAX_ROWS;
        const board = new BubbleBoard(maxRows);
        const raw = s && Array.isArray(s.grid) ? s.grid : [];
        const n = Math.min(raw.length, board.grid.length);
        for (let i = 0; i < n; i++) {
            const v = raw[i];
            board.grid[i] = typeof v === 'number' && v >= BUBBLE_EMPTY ? v : BUBBLE_EMPTY;
        }
        return board;
    }
}

// ==================== 关卡 ====================

export const BUBBLE_LEVELS: readonly BubbleLevel[] = [
    { id: 1, rows: 4, colors: 4, shots: 26, seed: 1101 },
    { id: 2, rows: 4, colors: 4, shots: 26, seed: 1102 },
    { id: 3, rows: 4, colors: 4, shots: 26, seed: 1103 },
    { id: 4, rows: 5, colors: 4, shots: 34, seed: 1104 },
    { id: 5, rows: 5, colors: 4, shots: 34, seed: 1105 },
    { id: 6, rows: 5, colors: 4, shots: 34, seed: 1106 },
    { id: 7, rows: 6, colors: 4, shots: 42, seed: 1107 },
    { id: 8, rows: 6, colors: 4, shots: 42, seed: 1108 },
    { id: 9, rows: 6, colors: 4, shots: 42, seed: 1109 },
    { id: 10, rows: 6, colors: 4, shots: 44, seed: 1110 },
    { id: 11, rows: 6, colors: 5, shots: 44, seed: 1111 },
    { id: 12, rows: 6, colors: 5, shots: 46, seed: 1112 },
    { id: 13, rows: 7, colors: 5, shots: 50, seed: 1113 },
    { id: 14, rows: 7, colors: 5, shots: 50, seed: 1114 },
    { id: 15, rows: 7, colors: 5, shots: 52, seed: 1115 },
    { id: 16, rows: 7, colors: 5, shots: 52, seed: 1116 },
    { id: 17, rows: 7, colors: 5, shots: 54, seed: 1117 },
    { id: 18, rows: 8, colors: 5, shots: 58, seed: 1118 },
    { id: 19, rows: 8, colors: 5, shots: 58, seed: 1119 },
    { id: 20, rows: 8, colors: 5, shots: 60, seed: 1120 },
    { id: 21, rows: 8, colors: 5, shots: 62, seed: 1121 },
    { id: 22, rows: 8, colors: 6, shots: 64, seed: 1122 },
    { id: 23, rows: 8, colors: 6, shots: 64, seed: 1123 },
    { id: 24, rows: 9, colors: 6, shots: 68, seed: 1124 },
    { id: 25, rows: 9, colors: 6, shots: 68, seed: 1125 },
    { id: 26, rows: 9, colors: 6, shots: 70, seed: 1126 },
    { id: 27, rows: 9, colors: 6, shots: 70, seed: 1127 },
    { id: 28, rows: 9, colors: 6, shots: 72, seed: 1128 },
    { id: 29, rows: 9, colors: 6, shots: 72, seed: 1129 },
    { id: 30, rows: 9, colors: 6, shots: 74, seed: 1130 },
];

export function levelById(id: number): BubbleLevel {
    for (let i = 0; i < BUBBLE_LEVELS.length; i++) {
        if (BUBBLE_LEVELS[i].id === id) return BUBBLE_LEVELS[i];
    }
    return BUBBLE_LEVELS[0];
}

/**
 * 按关卡生成盘面。
 *
 * 生成后做一次「颜色平衡」：保证每种颜色至少出现 3 次，且关卡声明的每一种颜色
 * 都确实出现过 —— 否则玩家可能整局见不到某个颜色，或某种颜色只出现 1 个永远消不掉。
 */
export function createBoard(level: BubbleLevel): BubbleBoard {
    const rand = mulberry32(level.seed);
    const board = new BubbleBoard(BUBBLE_MAX_ROWS);
    const rows = Math.max(1, Math.min(BUBBLE_MAX_ROWS - 2, level.rows));
    const colorCount = Math.max(2, Math.min(6, level.colors));

    for (let row = 0; row < rows; row++) {
        const len = rowLength(row);
        for (let col = 0; col < len; col++) {
            board.set(row, col, Math.floor(rand() * colorCount));
        }
    }
    balanceColors(board, colorCount, rand);
    return board;
}

/** 把盘面颜色调成「每种颜色至少 3 个、且每个颜色都出现」 */
function balanceColors(board: BubbleBoard, colorCount: number, rand: () => number): void {
    const cells: BubbleCellRef[] = [];
    for (let row = 0; row < board.maxRows; row++) {
        const len = rowLength(row);
        for (let col = 0; col < len; col++) {
            if (board.get(row, col) !== BUBBLE_EMPTY) cells.push({ row, col });
        }
    }
    if (cells.length === 0) return;

    for (let color = 0; color < colorCount; color++) {
        let count = 0;
        for (let i = 0; i < cells.length; i++) {
            if (board.get(cells[i].row, cells[i].col) === color) count++;
        }
        let guard = 0;
        while (count < BUBBLE_MATCH_MIN && guard < 64 && count < cells.length) {
            // 从「当前最多的颜色」里借一个格子，避免越借越偏
            const counts = new Array<number>(colorCount).fill(0);
            for (let i = 0; i < cells.length; i++) {
                const c = board.get(cells[i].row, cells[i].col);
                if (c >= 0 && c < colorCount) counts[c]++;
            }
            let donor = -1;
            let donorMax = 0;
            for (let c = 0; c < colorCount; c++) {
                if (c === color) continue;
                if (counts[c] > donorMax) {
                    donorMax = counts[c];
                    donor = c;
                }
            }
            if (donor < 0 || donorMax <= BUBBLE_MATCH_MIN) break;
            const pool: BubbleCellRef[] = [];
            for (let i = 0; i < cells.length; i++) {
                if (board.get(cells[i].row, cells[i].col) === donor) pool.push(cells[i]);
            }
            const pick = pool[Math.floor(rand() * pool.length) % pool.length];
            board.set(pick.row, pick.col, color);
            count++;
            guard++;
        }
    }
}

// ==================== 弹道 ====================

/**
 * 发射并求出落点。
 *
 * 物理是简化版：直线前进 + 左右墙镜面反射，不做重力与能量损失。
 * 每前进 TRACE_STEP 检查一次：撞墙反弹 / 撞已有泡泡 / 撞天花板。
 *
 * `origin` 与 `dir` 都在盘面局部空间；`dir` 不需要归一化。
 */
export function traceShot(
    board: BubbleBoard,
    origin: { x: number; y: number },
    dir: { x: number; y: number }
): ShotTrace {
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y) || 1;
    let dx = dir.x / len;
    let dy = dir.y / len;
    let x = origin.x;
    let y = origin.y;

    const path: Array<{ x: number; y: number }> = [{ x, y }];
    const minX = BUBBLE_R;
    const maxX = BUBBLE_BOARD_W - BUBBLE_R;
    const hitDist = BUBBLE_R * 2 * HIT_RATIO;

    for (let step = 0; step < TRACE_MAX_STEPS; step++) {
        x += dx * TRACE_STEP;
        y += dy * TRACE_STEP;

        // 左右墙：镜面反射，并把越界量折回来
        if (x < minX) {
            x = minX + (minX - x);
            dx = -dx;
            path.push({ x, y });
        } else if (x > maxX) {
            x = maxX - (x - maxX);
            dx = -dx;
            path.push({ x, y });
        }

        // 天花板：直接吸附
        if (y <= BUBBLE_R) {
            y = BUBBLE_R;
            path.push({ x, y });
            return { cell: snapNear(board, x, y), path };
        }

        // 与已有泡泡碰撞：扫附近三行的所有占用格（只查「最近格」会漏掉夹缝）
        if (hitsBubble(board, x, y, hitDist)) {
            path.push({ x, y });
            return { cell: snapNear(board, x, y), path };
        }
    }

    // 步数耗尽（理论不可达，兜底）
    path.push({ x, y });
    return { cell: snapNear(board, x, y), path };
}

/** `(x, y)` 是否落在某个已占用泡泡的 `radius` 范围内 */
function hitsBubble(board: BubbleBoard, x: number, y: number, radius: number): boolean {
    const rowF = (y - BUBBLE_R) / BUBBLE_ROW_H;
    const r0 = Math.max(0, Math.floor(rowF) - 1);
    const r1 = Math.min(board.maxRows - 1, Math.floor(rowF) + 1);
    const r2 = radius * radius;
    for (let row = r0; row <= r1; row++) {
        const len = rowLength(row);
        for (let col = 0; col < len; col++) {
            if (board.get(row, col) === BUBBLE_EMPTY) continue;
            const c = cellCenter(row, col);
            const dx = c.x - x;
            const dy = c.y - y;
            if (dx * dx + dy * dy < r2) return true;
        }
    }
    return false;
}

/** snapCell + 「离碰撞点太远就不算数」的兜底（避免满盘时吸到对面角落） */
function snapNear(board: BubbleBoard, x: number, y: number): BubbleCellRef | null {
    const cell = snapCell(board, x, y);
    if (!cell) return null;
    const c = cellCenter(cell.row, cell.col);
    const maxD = BUBBLE_R * 2.6;
    const dx = c.x - x;
    const dy = c.y - y;
    if (dx * dx + dy * dy > maxD * maxD) return null;
    return cell;
}

/**
 * 找一个可以落位的空格：靠近 `(x, y)`、且在盘内、且（在第 0 行或至少有一个占用邻居）。
 *
 * 「不重叠」是硬约束：候选格心与任何已占用泡泡的距离必须 ≥ 2R，否则贴面会叠在一起。
 */
export function snapCell(board: BubbleBoard, x: number, y: number): BubbleCellRef | null {
    const minSep = BUBBLE_R * 2 - 0.5;
    const minSepSq = minSep * minSep;
    let best: BubbleCellRef | null = null;
    let bestD = Infinity;

    for (let row = 0; row < board.maxRows; row++) {
        const len = rowLength(row);
        for (let col = 0; col < len; col++) {
            if (!board.isFree(row, col)) continue;
            const c = cellCenter(row, col);
            const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
            if (d >= bestD) continue;

            // 必须能挂住：第 0 行，或有已占用的邻居
            let anchored = row === 0;
            if (!anchored) {
                const ns = neighborsOf(row, col);
                for (let i = 0; i < ns.length; i++) {
                    if (board.get(ns[i].row, ns[i].col) !== BUBBLE_EMPTY) {
                        anchored = true;
                        break;
                    }
                }
            }
            if (!anchored) continue;

            // 不能与任何已有泡泡重叠
            let overlap = false;
            for (let r = Math.max(0, row - 2); r <= Math.min(board.maxRows - 1, row + 2) && !overlap; r++) {
                const l2 = rowLength(r);
                for (let cc = 0; cc < l2; cc++) {
                    if (board.get(r, cc) === BUBBLE_EMPTY) continue;
                    const o = cellCenter(r, cc);
                    const dd = (o.x - c.x) * (o.x - c.x) + (o.y - c.y) * (o.y - c.y);
                    if (dd < minSepSq) {
                        overlap = true;
                        break;
                    }
                }
            }
            if (overlap) continue;

            bestD = d;
            best = { row, col };
        }
    }
    return best;
}

// ==================== 出球与计分 ====================

/**
 * 下一颗泡泡的颜色：只从「盘面上还存在的颜色」里挑，保证每一发都可能有用。
 * 盘面已空时返回 0。
 */
export function pickNextColor(board: BubbleBoard, rand: () => number): number {
    const present = board.colorsPresent();
    if (present.length === 0) return 0;
    const i = Math.min(present.length - 1, Math.floor(rand() * present.length));
    return present[i];
}

/** 过关奖励：剩余发射次数 × 50 */
export function scoreFor(shotsLeft: number, won: boolean): number {
    return won ? Math.max(0, shotsLeft) * 50 : 0;
}

// ==================== 瞄准角 ====================

/** 炮台允许的瞄准角（弧度，0 = 竖直向上，正 = 偏右） */
export const BUBBLE_AIM_LIMIT = (80 * Math.PI) / 180;

/** 把任意角度夹到合法瞄准范围 */
export function clampAim(angle: number): number {
    if (!isFinite(angle)) return 0;
    if (angle > BUBBLE_AIM_LIMIT) return BUBBLE_AIM_LIMIT;
    if (angle < -BUBBLE_AIM_LIMIT) return -BUBBLE_AIM_LIMIT;
    return angle;
}

/** 由瞄准角得到方向向量（y 向下为正，所以向上是负） */
export function aimToDir(angle: number): { x: number; y: number } {
    return { x: Math.sin(angle), y: -Math.cos(angle) };
}
