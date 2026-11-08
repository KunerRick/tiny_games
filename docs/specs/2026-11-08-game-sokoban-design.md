# 推箱子（Sokoban）设计

- 日期：2026-11-08
- 状态：**已完成**（浏览器验收通过，见 §12）
- 场景：`assets/games/game_sokoban/scenes/Sokoban.scene`（场景名 `Sokoban`）
- 玩法定位：益智解谜 · 关卡制 · 可撤销重来
- 前置文档：[`../plans/2026-11-05-game-catalog-and-roadmap.md`](../plans/2026-11-05-game-catalog-and-roadmap.md)（P2-2）

---

## 1. 一句话玩法

滑动或按方向键推动小人，把每个箱子推到目标点上；不能拉、不能穿墙、不能同时推两个箱子。

---

## 2. 为什么补这一款

合集里「益智解谜」只有 `sudoku`（填数）和 `minesweeper`（推断），两者都是**静态棋盘**。
推箱子是唯一需要**空间规划 + 顺序试错**的品类：一步推错箱子就卡死，必须靠撤销 / 重来救，
这正是「解谜机关」的乐趣来源，也补上了合集缺的一档「会推错的游戏」。

技术上风险最低：规则完全可枚举 → 纯逻辑 + **BFS 证明每关可解**，
关卡用 ASCII 文本描述，新增关卡不用改代码。画面全 `Graphics`，零贴图零音频。

---

## 3. 关卡文本格式

每个字符一格，所有行必须等长（否则解析直接报错）：

| 字符 | 含义 |
|------|------|
| `#` | 墙 |
| ` ` | 地板 |
| `.` | 目标点 |
| `$` | 箱子 |
| `*` | 箱子**在目标点上** |
| `@` | 玩家 |
| `+` | 玩家**站在目标点上** |

解析时强校验：玩家恰好 1 个、箱子数 = 目标数、箱子数 ≥ 1、字符合法。

---

## 4. 规则

- 玩家向 4 个方向走一格；目标格是墙 → 不动；
- 目标格有箱子 → 箱子再前进一格的格子必须**既不是墙也没有箱子**，否则不动；
- 推成功时 `moves` 与 `pushes` 都 +1；走空路只 +1 `moves`；
- 撤销精确还原（含 `moves` / `pushes`）；
- **通关**：所有箱子都在目标点上（箱子数 = 目标数）。
- 没有步数上限，也没有时间限制 —— 推死只能自己撤销 / 重来。

---

## 5. 关卡与难度

20 关，参数表驱动。每关箱子数 ≤ 3（**这一条是硬约束**：BFS 需要在秒级内证明可解并算出最短步数）。

| 关卡 | 名称 | 箱子 | 最短步数（par） |
|------|------|------|-----------------|
| 1 | 第一推动 | 1 | 1 |
| 2 | 拐个弯 | 1 | 5 |
| 3 | 一起往右 | 2 | 7 |
| 4 | 门口堵车 | 2 | 11 |
| 5 | 三连推 | 3 | 13 |
| 6 | 顶着墙 | 2 | 22 |
| 7 | 两个房间 | 2 | 16 |
| 8 | 十字路口 | 3 | 17 |
| 9 | 两侧开工 | 2 | 15 |
| 10 | 流水线 | 3 | 19 |
| 11 | 拐两次 | 2 | 15 |
| 12 | 一排推 | 3 | 9 |
| 13 | 上下两路 | 2 | 11 |
| 14 | 错位 | 3 | 16 |
| 15 | 门缝 | 2 | 10 |
| 16 | 双通道 | 2 | 22 |
| 17 | 中间有墙 | 2 | 18 |
| 18 | 三个角 | 3 | 29 |
| 19 | 窄门 | 1 | 13 |
| 20 | 三个箱子 | 3 | 21 |

`par` **不是手填的**：`tools/verify-sokoban-core.js` 用 BFS 求出最优步数，
自检逐关断言 `par === 最优步数`，并且把解序列回放一遍确认真能通关。

星级：`步数 ≤ par` 三星，`≤ 1.5 × par` 两星，其余一星。

---

## 6. 界面

720×1280 设计基准，全部运行时 `Graphics` + `Label`。

| 区块 | 内容 | 位置（设计坐标，y 自顶向下） |
|------|------|------|
| 顶栏 | 返回键 `‹`、标题「推箱子」、`第 N 关 · 名称`（点击开选关） | 高 150 |
| 盘面 | 墙 / 地板 / 目标环 / 箱子 / 小人 | 176 – 872，居中 |
| 状态行 | `步数 12 · 最少 11` | y ≈ 906 |
| 方向键 | 十字方向键（上下左右四个圆角键） | 左侧，中心 (200, 1060) |
| 操作键 | 「撤销」「重来」 | 右侧，x = 560 |
| 提示 | 「滑动屏幕或用方向键推箱子」 | y ≈ 1216 |

**盘面自适应**：`cell = min(648 / 宽格数, 696 / 高格数)`，取整保证边缘清晰；
格子中心换算 `px = (cx + 0.5) · cell − W/2`、`py = H/2 − (cy + 0.5) · cell`。

配色语义：墙 = 深蓝灰块 + 顶面亮边；地板 = 更暗的方块；目标 = 空心环（警告色）；
箱子 = 木色圆角块，**推到目标上变成功色**；小人 = 主色圆 + 两只眼睛 + 朝向三角。

### 6.1 输入

- **方向键**：四个 `Node` + `TOUCH_END`；
- **滑动**：盘面层监听 `TOUCH_START` / `TOUCH_END`，位移 ≥ 24 取主轴方向；
- 两种输入都走同一个 `_step(dir)`，被挡时**静默不动**（不做错误提示，避免刷屏）；
- 面板打开时输入层通过 `_overlayOpen()` 提前返回（遮罩节点没有监听器，不拦事件）。

### 6.2 动画

一次移动用 90ms 插值：`update()` 里推进 `_animT`，重绘时把小人（和被推的箱子）
画在起止格之间的插值位置。不阻塞输入，新输入直接覆盖上一段动画。

---

## 7. 代码结构

```text
assets/games/game_sokoban/
├── scenes/Sokoban.scene         # Canvas + Root（挂 SokobanGame）
└── scripts/
    ├── SokobanCore.ts           # 纯逻辑，无 cc 依赖
    └── SokobanGame.ts           # 运行时 UI
tools/verify-sokoban-core.js     # 纯逻辑自检（含 BFS 可解性 + par 校验）
```

### 7.1 SokobanCore 对外接口

```ts
export type SokobanDir = 0 | 1 | 2 | 3;            // 上右 下 左
export const SOKOBAN_DIR_VEC: readonly [number, number][];
export interface SokobanLevel { id; name; par; rows: readonly string[]; }
export const SOKOBAN_LEVELS: readonly SokobanLevel[];
export const SOKOBAN_PARS: readonly number[];

export class SokobanBoard {
  readonly width; readonly height;
  readonly walls: Uint8Array; readonly goals: Uint8Array; boxes: Uint8Array;
  playerX; playerY; moves; pushes;
  move(dir: SokobanDir): SokobanMoveResult;   // 被挡时 moved=false 且状态不变
  undo(): boolean;
  reset(): void;
  isSolved(): boolean;
  canUndo(): boolean;
  snapshot(): SokobanSnapshot;
  static fromSnapshot(s): SokobanBoard;       // 坏档回落 1×1 空盘
  static fromRows(rows: readonly string[]): SokobanBoard;  // 非法输入抛错
  static fromLevel(level): SokobanBoard;
  clone(): SokobanBoard;
}

export function solve(board, maxStates?): SokobanDir[] | null;  // BFS 最短解
export function optimalMoves(board, maxStates?): number;        // -1 = 无解
export function levelById(id: number): SokobanLevel;
export function starsFor(moves: number, par: number): number;
export function boxCountOf(level: SokobanLevel): number;
```

### 7.2 BFS 求解器的实现要点

状态 = `玩家格索引 | 排序后的箱子索引列表`，**队列里只存紧凑 key**，
单步转移在复用的 `scratch` 数组上完成，不克隆盘面 —— 否则几十万状态会爆内存。
状态上限 150 万，超过返回 `null`（自检会因此报错，提示关卡太大）。

---

## 8. 存档

| 键 | 内容 |
|----|------|
| `tiny_games_sokoban_progress` | 已解锁的最大关卡号 |
| `tiny_games_sokoban_save` | 当局断点（关卡号 + 盘面快照 + 步数） |

坏档一律回落为「从第 1 关重新开始」，不抛异常。

---

## 9. 验收用例

1. 撞墙 / 推不动时盘面完全不变；
2. 推箱：箱子与玩家同时前进，步数与推箱数各自 +1；
3. 撤销走空路 / 撤销推箱都能逐格还原；撤到底后与原局完全一致；
4. 20 关全部可解，`par` 等于 BFS 最优步数，解序列回放能通关；
5. 通关后弹出结算，步数 = par 时三星；解锁下一关；
6. 选关面板：已解锁直达，未解锁点了没反应；
7. 返回大厅再进入：断点恢复（关卡、盘面、步数一致）；
8. 滑动与方向键都能推箱子；面板打开时盘面输入被屏蔽；
9. `node tools/verify-sokoban-core.js` 全绿、`tsc --noEmit` 通过、预览 console 0 error。

---

## 10. 明确不做（v1）

- 关卡编辑器 / 自定义关卡导入；
- 提示（hint）与自动求解演示；
- 死锁检测（推死只能自己撤销）；
- 步数排行榜、每日挑战、后端；
- 音效与震动。

---

## 11. 关键教训（本次踩到的）

**撤销推箱的箱子回位算错了**：推完一步后玩家站在箱子原来的格子上，
所以撤销时箱子应该回到**玩家当前格**，玩家退到「玩家格 − 方向」。
第一版写成「箱子回到玩家当前格 − 方向」（= 玩家上一格），
单步撤销看起来没问题，**连续多步撤销/随机长跑才暴露**，最终由
「20 关 × 每关随机 120 步再全撤销，逐格比对原局」这条断言抓住。

---

## 12. 验收记录（2026-11-08，编辑器预览 `127.0.0.1:7456`）

自动化：`node tools/verify-sokoban-core.js` → **40 项通过 / 0 项失败**（BFS 总计 900 ms，最慢 763 ms）；
`tsc --noEmit`（编辑器自带 5.8.2）→ 退出码 0；预览 console **0 error**（2 条 warning 均为引擎
`systemEvent` 弃用提示，与本项目无关）。

浏览器真实操作（视口 480×1000，`dpr = 1`；本轮画布 393×852，
设计坐标 → 页面坐标换算：`pageX = 43.5 + 0.5458·dx`，`pageY = 175.7 + 0.5458·dy`，
与 `camera.worldToScreen` 反算逐点核对一致）：

| # | 用例 | 结果 |
|---|------|------|
| 1 | 方向键走上 / 下 / 左，`步数` 与 `moves` 同步累加 | ✅ 3 次点击 → `moves=3`，玩家 (2,2)→(2,1)→(2,2)→(1,2) |
| 2 | 再往左（撞墙）盘面无变化 | ✅ `moves` 停在 3，坐标不变 |
| 3 | 撤销 3 次精确还原 | ✅ 玩家回 (2,2)、`moves=0`、`canUndo=false`、状态行回「步数 0 · 最少 1」 |
| 4 | 盘面滑动（右拖 110 CSS px）推箱 | ✅ 箱子入目标、`pushes=1`、`phase=win` |
| 5 | 结算面板 | ✅ 3 星、`第 1 关 · 步数 1 ／ 最少 1`、三个按钮齐全；`_maxLevel` 解锁为 2 |
| 6 | 「下一关」 | ✅ 载入第 2 关（7×6，par 5），标题「第 2 关 · 拐个弯」 |
| 7 | 「重来」/ 结算里的「重玩本关」 | ✅ 均回到本关初始局面（`moves=0`、布局复原） |
| 8 | 点标题开选关面板 | ✅ 面板 20 个关卡按钮；已解锁的 1/2 高亮，其余置灰 |
| 9 | 点未解锁的第 5 关 | ✅ 无反应，仍在第 2 关、面板不关 |
| 10 | 点已解锁的第 1 关 | ✅ 切到第 1 关、面板关闭 |
| 11 | 面板打开时方向键 / 盘面滑动 | ✅ 均被屏蔽（`moves` 不变） |
| 12 | 「关闭」按钮 | ✅ 面板关闭，盘面状态不变 |
| 13 | 返回大厅（`‹`） | ✅ 切到 `Lobby`，存档键保留 |
| 14 | 大厅滚动到「推箱子」图标再点进来 | ✅ 场景 `Sokoban`，第 1 关、玩家 (1,1)、`步数 2`、箱子位置与离开前逐格一致 |

存档实测内容：`tiny_games_sokoban_save` 存 `levelId + board 快照`（walls/goals/boxes/playerX/playerY/moves/pushes），
`tiny_games_sokoban_progress` 存已解锁上限（通关第 1 关后为 `2`）。

### 12.1 本轮验证要点（供下次复用）

- **坐标换算必须现场标定**：本轮 `dpr = 1`，但设计缩放在本轮是 `0.5458`（画布 393×852 = fit-width，
  上下各留 76.7 设计像素的空白），页面 Y 因此多了 76.7 的偏移；直接拿 CSS 高度/1280 会算错。
- 用 `camera.worldToScreen(node 中心)` 反算页面坐标最稳（见 §12 表格上方公式），比数截图更可靠。
- 探测运行时状态直接读组件的私有字段（`_board` / `_phase` / `_maxLevel`），
  `getComponent('SokobanGame')` 可用字符串类名，无需拿到类引用。
- 选关按钮的点击坐标要按 **Panel 局部位移** 换算（面板居中，按钮在其局部坐标上）。
