/**
 * 推箱子 —— 纯逻辑核心（不依赖 cc，可被 Node 自检直接编译）。
 *
 * 负责：ASCII 关卡解析、移动 / 推箱、撤销历史、通关判定、
 *       状态快照、以及用 BFS 求最短解（既用于自检「关卡可解」，也用于求 par）。
 *
 * 关卡文本约定（每个字符一格，所有行必须等长）：
 *   `#` 墙   ` ` 地板   `.` 目标点   `$` 箱子   `*` 箱子在目标点上
 *   `@` 玩家  `+` 玩家站在目标点上
 */

/** 方向：0 上 1 右 2 下 3 左 */
export type SokobanDir = 0 | 1 | 2 | 3;

export const SOKOBAN_DIR_VEC: readonly [number, number][] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
];

export const SOKOBAN_DIR_NAME: readonly string[] = ['上', '右', '下', '左'];

export interface SokobanLevel {
    id: number;
    name: string;
    /** 最短步数（BFS 最优，自检脚本逐关核对） */
    par: number;
    rows: readonly string[];
}

export interface SokobanMoveResult {
    moved: boolean;
    pushed: boolean;
    /** 玩家落点（格坐标） */
    x: number;
    y: number;
    /** 被推箱子的起点 / 终点；未推箱时为 null */
    boxFrom: { x: number; y: number } | null;
    boxTo: { x: number; y: number } | null;
}

export interface SokobanSnapshot {
    v: 1;
    width: number;
    height: number;
    walls: number[];
    goals: number[];
    boxes: number[];
    playerX: number;
    playerY: number;
    moves: number;
    pushes: number;
}

export class SokobanBoard {
    readonly width: number;
    readonly height: number;
    readonly walls: Uint8Array;
    readonly goals: Uint8Array;
    boxes: Uint8Array;
    playerX = 0;
    playerY = 0;
    moves = 0;
    pushes = 0;

    /** 撤销栈 */
    private history: Array<{ dir: SokobanDir; pushed: boolean }> = [];

    /** 初始局面（重开 / 撤销到底用） */
    private _startBoxes: Uint8Array = new Uint8Array(0);
    private _startX = 0;
    private _startY = 0;

    constructor(width: number, height: number) {
        this.width = Math.max(1, width | 0);
        this.height = Math.max(1, height | 0);
        const n = this.width * this.height;
        this.walls = new Uint8Array(n);
        this.goals = new Uint8Array(n);
        this.boxes = new Uint8Array(n);
    }

    idx(x: number, y: number): number {
        return y * this.width + x;
    }

    inBounds(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }

    isWall(x: number, y: number): boolean {
        if (!this.inBounds(x, y)) return true;
        return this.walls[this.idx(x, y)] !== 0;
    }

    isGoal(x: number, y: number): boolean {
        if (!this.inBounds(x, y)) return false;
        return this.goals[this.idx(x, y)] !== 0;
    }

    hasBox(x: number, y: number): boolean {
        if (!this.inBounds(x, y)) return false;
        return this.boxes[this.idx(x, y)] !== 0;
    }

    goalCount(): number {
        let n = 0;
        for (let i = 0; i < this.goals.length; i++) if (this.goals[i]) n++;
        return n;
    }

    boxCount(): number {
        let n = 0;
        for (let i = 0; i < this.boxes.length; i++) if (this.boxes[i]) n++;
        return n;
    }

    boxesOnGoals(): number {
        let n = 0;
        for (let i = 0; i < this.boxes.length; i++) if (this.boxes[i] && this.goals[i]) n++;
        return n;
    }

    isSolved(): boolean {
        const total = this.goalCount();
        if (total === 0) return false;
        return this.boxCount() === total && this.boxesOnGoals() === total;
    }

    canUndo(): boolean {
        return this.history.length > 0;
    }

    /** 走一步。被挡（撞墙 / 推不动）时返回 moved=false，且不改变任何状态。 */
    move(dir: SokobanDir): SokobanMoveResult {
        const v = SOKOBAN_DIR_VEC[dir];
        const nx = this.playerX + v[0];
        const ny = this.playerY + v[1];
        const blocked: SokobanMoveResult = {
            moved: false,
            pushed: false,
            x: this.playerX,
            y: this.playerY,
            boxFrom: null,
            boxTo: null,
        };
        if (this.isWall(nx, ny)) return blocked;

        if (this.hasBox(nx, ny)) {
            const bx = nx + v[0];
            const by = ny + v[1];
            if (this.isWall(bx, by) || this.hasBox(bx, by)) return blocked;

            this.boxes[this.idx(nx, ny)] = 0;
            this.boxes[this.idx(bx, by)] = 1;
            this.playerX = nx;
            this.playerY = ny;
            this.moves++;
            this.pushes++;
            this.history.push({ dir, pushed: true });
            return {
                moved: true,
                pushed: true,
                x: nx,
                y: ny,
                boxFrom: { x: nx, y: ny },
                boxTo: { x: bx, y: by },
            };
        }

        this.playerX = nx;
        this.playerY = ny;
        this.moves++;
        this.history.push({ dir, pushed: false });
        return { moved: true, pushed: false, x: nx, y: ny, boxFrom: null, boxTo: null };
    }

    /** 撤销一步；没得撤返回 false */
    undo(): boolean {
        const last = this.history.pop();
        if (!last) return false;
        const v = SOKOBAN_DIR_VEC[last.dir];
        if (last.pushed) {
            // 箱子退回玩家当前格，玩家再退一格
            const px = this.playerX - v[0];
            const py = this.playerY - v[1];
            const bx = this.playerX + v[0];
            const by = this.playerY + v[1];
            if (this.inBounds(bx, by)) this.boxes[this.idx(bx, by)] = 0;
            if (this.inBounds(this.playerX, this.playerY)) {
                this.boxes[this.idx(this.playerX, this.playerY)] = 1;
            }
            this.playerX = px;
            this.playerY = py;
            this.pushes = Math.max(0, this.pushes - 1);
        } else {
            this.playerX -= v[0];
            this.playerY -= v[1];
        }
        this.moves = Math.max(0, this.moves - 1);
        return true;
    }

    /** 回到本关初始局面 */
    reset(): void {
        this.playerX = this._startX;
        this.playerY = this._startY;
        this.boxes.set(this._startBoxes);
        this.moves = 0;
        this.pushes = 0;
        this.history = [];
    }

    snapshot(): SokobanSnapshot {
        return {
            v: 1,
            width: this.width,
            height: this.height,
            walls: Array.from(this.walls),
            goals: Array.from(this.goals),
            boxes: Array.from(this.boxes),
            playerX: this.playerX,
            playerY: this.playerY,
            moves: this.moves,
            pushes: this.pushes,
        };
    }

    /** 从快照恢复；坏档/空档回落到 1×1 空盘，不抛异常 */
    static fromSnapshot(s: SokobanSnapshot): SokobanBoard {
        const width = s && typeof s.width === 'number' ? s.width : 1;
        const height = s && typeof s.height === 'number' ? s.height : 1;
        const board = new SokobanBoard(width, height);
        copyInto(board.walls, s && s.walls);
        copyInto(board.goals, s && s.goals);
        copyInto(board.boxes, s && s.boxes);
        board.playerX = clampInt(s && s.playerX, 0, board.width - 1);
        board.playerY = clampInt(s && s.playerY, 0, board.height - 1);
        board.moves = Math.max(0, (s && s.moves) | 0);
        board.pushes = Math.max(0, (s && s.pushes) | 0);
        board.captureStart();
        return board;
    }

    /** 从 ASCII 行构造；非法字符或行宽不一致会抛错 */
    static fromRows(rows: readonly string[]): SokobanBoard {
        if (!rows || rows.length === 0) throw new Error('关卡为空');
        const width = rows[0].length;
        if (width === 0) throw new Error('关卡宽度为 0');
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].length !== width) {
                throw new Error(`第 ${i} 行宽度 ${rows[i].length} ≠ ${width}`);
            }
        }
        const board = new SokobanBoard(width, rows.length);
        let players = 0;
        let boxes = 0;
        let goals = 0;
        for (let y = 0; y < rows.length; y++) {
            const line = rows[y];
            for (let x = 0; x < width; x++) {
                const ch = line[x];
                const i = board.idx(x, y);
                switch (ch) {
                    case '#':
                        board.walls[i] = 1;
                        break;
                    case ' ':
                    case '-':
                        break;
                    case '.':
                        board.goals[i] = 1;
                        goals++;
                        break;
                    case '$':
                        board.boxes[i] = 1;
                        boxes++;
                        break;
                    case '*':
                        board.boxes[i] = 1;
                        board.goals[i] = 1;
                        boxes++;
                        goals++;
                        break;
                    case '@':
                        board.playerX = x;
                        board.playerY = y;
                        players++;
                        break;
                    case '+':
                        board.playerX = x;
                        board.playerY = y;
                        board.goals[i] = 1;
                        goals++;
                        players++;
                        break;
                    default:
                        throw new Error(`非法字符 '${ch}' @ (${x},${y})`);
                }
            }
        }
        if (players !== 1) throw new Error(`玩家数 ${players} ≠ 1`);
        if (boxes !== goals) throw new Error(`箱子 ${boxes} ≠ 目标 ${goals}`);
        if (boxes === 0) throw new Error('没有箱子');
        board.captureStart();
        return board;
    }

    static fromLevel(level: SokobanLevel): SokobanBoard {
        return SokobanBoard.fromRows(level.rows);
    }

    /** 深拷贝（不含撤销历史，初始局面同步为当前局面） */
    clone(): SokobanBoard {
        const b = new SokobanBoard(this.width, this.height);
        b.walls.set(this.walls);
        b.goals.set(this.goals);
        b.boxes.set(this.boxes);
        b.playerX = this.playerX;
        b.playerY = this.playerY;
        b.moves = this.moves;
        b.pushes = this.pushes;
        b.captureStart();
        return b;
    }

    private captureStart(): void {
        this._startBoxes = new Uint8Array(this.boxes);
        this._startX = this.playerX;
        this._startY = this.playerY;
    }
}

function copyInto(dst: Uint8Array, src: number[] | undefined): void {
    if (!Array.isArray(src)) return;
    const n = Math.min(dst.length, src.length);
    for (let i = 0; i < n; i++) dst[i] = src[i] ? 1 : 0;
}

function clampInt(v: any, lo: number, hi: number): number {
    const n = typeof v === 'number' && isFinite(v) ? Math.round(v) : lo;
    return Math.max(lo, Math.min(hi, n));
}

// ==================== BFS 求解 ====================

/**
 * 广度优先求最短解（按「步」计，含走空路）。
 *
 * 状态 = 玩家位置 + 箱子集合，只存紧凑 key（不克隆盘面），
 * 单步转移在 scratch 数组上完成，几十万状态也不会爆内存。
 * 找不到解 / 超过状态上限返回 null。
 */
export function solve(board: SokobanBoard, maxStates = 1500000): SokobanDir[] | null {
    const n = board.width * board.height;
    const goalCount = board.goalCount();
    if (goalCount === 0) return null;

    const startBoxes = boxIndices(board);
    if (startBoxes.length === goalCount && allOnGoals(startBoxes, board.goals)) return [];

    const w = board.width;
    const h = board.height;
    const walls = board.walls;
    const goals = board.goals;
    const scratch = new Uint8Array(n);

    const startKey = makeKey(board.idx(board.playerX, board.playerY), startBoxes);
    const parent = new Map<string, { prev: string; dir: SokobanDir } | null>();
    parent.set(startKey, null);

    const queue: Array<{ key: string; player: number; boxes: number[] }> = [
        { key: startKey, player: board.idx(board.playerX, board.playerY), boxes: startBoxes },
    ];
    let head = 0;

    while (head < queue.length) {
        if (parent.size > maxStates) return null;
        const st = queue[head++];
        for (let i = 0; i < st.boxes.length; i++) scratch[st.boxes[i]] = 1;

        const px = st.player % w;
        const py = (st.player - px) / w;

        for (let d = 0; d < 4; d++) {
            const v = SOKOBAN_DIR_VEC[d];
            const nx = px + v[0];
            const ny = py + v[1];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (walls[ni]) continue;

            let nextBoxes = st.boxes;
            if (scratch[ni]) {
                const bx = nx + v[0];
                const by = ny + v[1];
                if (bx < 0 || by < 0 || bx >= w || by >= h) continue;
                const bi = by * w + bx;
                if (walls[bi] || scratch[bi]) continue;
                nextBoxes = replaceBox(st.boxes, ni, bi);
            }

            const key = makeKey(ni, nextBoxes);
            if (parent.has(key)) continue;
            parent.set(key, { prev: st.key, dir: d as SokobanDir });

            if (nextBoxes.length === goalCount && allOnGoals(nextBoxes, goals)) {
                return rebuildPath(parent, key);
            }
            queue.push({ key, player: ni, boxes: nextBoxes });
        }

        for (let i = 0; i < st.boxes.length; i++) scratch[st.boxes[i]] = 0;
    }
    return null;
}

/** 最短步数；无解返回 -1 */
export function optimalMoves(board: SokobanBoard, maxStates = 1500000): number {
    const path = solve(board, maxStates);
    return path ? path.length : -1;
}

function boxIndices(board: SokobanBoard): number[] {
    const out: number[] = [];
    for (let i = 0; i < board.boxes.length; i++) if (board.boxes[i]) out.push(i);
    return out;
}

function allOnGoals(boxes: number[], goals: Uint8Array): boolean {
    for (let i = 0; i < boxes.length; i++) if (!goals[boxes[i]]) return false;
    return true;
}

/** 把数组里的 from 换成 to 并保持升序（key 一致性依赖升序） */
function replaceBox(boxes: number[], from: number, to: number): number[] {
    const out = boxes.slice();
    const at = out.indexOf(from);
    out[at] = to;
    out.sort((a, b) => a - b);
    return out;
}

function makeKey(player: number, boxes: number[]): string {
    return player + '|' + boxes.join(',');
}

function rebuildPath(
    parent: Map<string, { prev: string; dir: SokobanDir } | null>,
    endKey: string
): SokobanDir[] {
    const out: SokobanDir[] = [];
    let key: string | null = endKey;
    while (key) {
        const node = parent.get(key);
        if (!node) break;
        out.push(node.dir);
        key = node.prev;
    }
    out.reverse();
    return out;
}

// ==================== 关卡 ====================
// 关卡只有布局；par 单独一列，由 tools/verify-sokoban-core.js 的 BFS 结果回填。
// 设计约束：每关箱子 ≤ 3（保证 BFS 能在秒级内证完可解性并与 par 对齐）。

const LEVEL_ROWS: ReadonlyArray<{ id: number; name: string; rows: readonly string[] }> = [
    {
        id: 1,
        name: '第一推动',
        rows: ['#######', '#     #', '# @$. #', '#     #', '#######'],
    },
    {
        id: 2,
        name: '拐个弯',
        rows: ['#######', '#.    #', '#  $  #', '#  @  #', '#     #', '#######'],
    },
    {
        id: 3,
        name: '一起往右',
        rows: ['########', '#      #', '#  $.  #', '#  @   #', '#  $.  #', '#      #', '########'],
    },
    {
        id: 4,
        name: '门口堵车',
        rows: ['########', '#      #', '#  ##  #', '# $..$ #', '#  @   #', '#      #', '########'],
    },
    {
        id: 5,
        name: '三连推',
        rows: ['#########', '#       #', '#  $$$  #', '#  ...  #', '#   @   #', '#       #', '#########'],
    },
    {
        id: 6,
        name: '顶着墙',
        rows: ['#########', '#.      #', '# $###  #', '#   $   #', '#  @    #', '#    .  #', '#########'],
    },
    {
        id: 7,
        name: '两个房间',
        rows: ['#########', '#  .#.  #', '# $ #$  #', '#   #   #', '#   #   #', '#   @   #', '#########'],
    },
    {
        id: 8,
        name: '十字路口',
        rows: ['#########', '#   .   #', '#  $ $  #', '# . @ . #', '#   $   #', '#       #', '#########'],
    },
    {
        id: 9,
        name: '两侧开工',
        rows: [
            '##########',
            '#        #',
            '#  ####  #',
            '#  #  #  #',
            '#  #  #  #',
            '#  ####  #',
            '# $ .. $ #',
            '#   @    #',
            '##########',
        ],
    },
    {
        id: 10,
        name: '流水线',
        rows: ['##########', '#        #', '# $ $ $  #', '#  ...   #', '#   @    #', '#        #', '##########'],
    },
    {
        id: 11,
        name: '拐两次',
        rows: [
            '##########',
            '#  .     #',
            '#  $     #',
            '#   ##   #',
            '#   $    #',
            '#      @ #',
            '#   .    #',
            '##########',
        ],
    },
    {
        id: 12,
        name: '一排推',
        rows: ['##########', '#  ...   #', '#  $$$   #', '#        #', '#   @    #', '#        #', '##########'],
    },
    {
        id: 13,
        name: '上下两路',
        rows: [
            '##########',
            '#        #',
            '#  ##    #',
            '#  ##  . #',
            '#      $ #',
            '#   @    #',
            '#  .   $ #',
            '##########',
        ],
    },
    {
        id: 14,
        name: '错位',
        rows: ['##########', '#.  .  . #', '# $$ $   #', '#   @    #', '#        #', '##########'],
    },
    {
        id: 15,
        name: '门缝',
        rows: ['##########', '#   @    #', '#  $  $  #', '###    ###', '#  .  .  #', '#        #', '##########'],
    },
    {
        id: 16,
        name: '双通道',
        rows: [
            '###########',
            '#    #    #',
            '# $  #  $ #',
            '# .  #  . #',
            '#    #    #',
            '#    @    #',
            '#         #',
            '###########',
        ],
    },
    {
        id: 17,
        name: '中间有墙',
        rows: [
            '###########',
            '#         #',
            '#  $   $  #',
            '#   ###   #',
            '#  .   .  #',
            '#    @    #',
            '###########',
        ],
    },
    {
        id: 18,
        name: '三个角',
        rows: [
            '###########',
            '#.       .#',
            '#  $      #',
            '#         #',
            '#    @    #',
            '#  $   $  #',
            '#.        #',
            '###########',
        ],
    },
    {
        id: 19,
        name: '窄门',
        rows: [
            '###########',
            '#     #   #',
            '# $   #   #',
            '#     #   #',
            '#     #   #',
            '#  .  #   #',
            '#     #   #',
            '#  @      #',
            '###########',
        ],
    },
    {
        id: 20,
        name: '三个箱子',
        rows: ['###########', '#         #', '#  $ $ $  #', '#         #', '#  . . .  #', '#         #', '#    @    #', '###########'],
    },
];

/** 与 LEVEL_ROWS 一一对应的最短步数 */
export const SOKOBAN_PARS: readonly number[] = [
    1, 5, 7, 11, 13, 22, 16, 17, 15, 19,
    15, 9, 11, 16, 10, 22, 18, 29, 13, 21,
];

export const SOKOBAN_LEVELS: readonly SokobanLevel[] = LEVEL_ROWS.map((lv, i) => ({
    id: lv.id,
    name: lv.name,
    rows: lv.rows,
    par: SOKOBAN_PARS[i] || 0,
}));

export function levelById(id: number): SokobanLevel {
    for (let i = 0; i < SOKOBAN_LEVELS.length; i++) {
        if (SOKOBAN_LEVELS[i].id === id) return SOKOBAN_LEVELS[i];
    }
    return SOKOBAN_LEVELS[0];
}

/** 通关评分：步数 ≤ par 三星，≤ 1.5 par 两星，其余一星 */
export function starsFor(moves: number, par: number): number {
    if (moves <= 0 || par <= 0) return 0;
    if (moves <= par) return 3;
    if (moves <= Math.ceil(par * 1.5)) return 2;
    return 1;
}

/** 供 UI 统计用：关卡里的箱子数 */
export function boxCountOf(level: SokobanLevel): number {
    let n = 0;
    for (const row of level.rows) for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '$' || ch === '*') n++;
    }
    return n;
}
