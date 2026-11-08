# 泡泡龙（Bubble Shooter）设计

- 日期：2026-11-08
- 状态：**已完成**（浏览器验收通过，见 §11）
- 场景：`assets/games/game_bubble/scenes/Bubble.scene`（场景名 `Bubble`）
- 玩法定位：大众休闲 · 瞄准弹射 · 关卡制
- 前置文档：[`../plans/2026-11-05-game-catalog-and-roadmap.md`](../plans/2026-11-05-game-catalog-and-roadmap.md)

---

## 1. 一句话玩法

底部炮台瞄准发射彩色泡泡，粘到盘面后同色 ≥3 连成片即消除；被打散的悬空泡泡一起掉落。**清空盘面即过关**。

---

## 2. 为什么补这一款

现有 20 款里「大众休闲」只有 `merge`（物理合成）和 `match3`（三消），两者的思考强度都不低。
合集缺一款**三分钟一局、单手可玩、零门槛**的入口，泡泡龙是这个空位里认知度最高的经典。

技术上是零风险选择：网格 + 瞄准弹道 + 连通块，全部可以写成纯逻辑 `BubbleCore.ts`，
用 `tools/verify-bubble-core.js` 在 Node 里跑；画面纯 `Graphics` 画圆，不引入任何贴图。

---

## 3. 盘面与坐标

六边形错位网格（odd-row offset），行号 0 在**最上方**：

| 常量 | 值 | 说明 |
|------|----|------|
| `BUBBLE_COLS` | 10 | 偶数行的泡泡数；奇数行 9 个 |
| `BUBBLE_R` | 32 | 泡泡半径（设计像素） |
| `BUBBLE_ROW_H` | `R·√3 ≈ 55.42` | 行高（六边形堆积） |
| `BUBBLE_MAX_ROWS` | 13 | 盘面最大行数（越界即判负） |
| 盘面宽 | `2R·COLS = 640` | 左右墙 x ∈ [0, 640] |

格心坐标（盘面局部空间，原点在左上，y 向下）：

```
偶数行 r：x = R + 2R·c          （c = 0…9，中心 320）
奇数行 r：x = 2R + 2R·c         （c = 0…8，中心 320）
任意行 r：y = R + r·BUBBLE_ROW_H
```

两种行的水平中心都是 320，视觉上左右对称。

**邻居表**（6 邻域，棋盘外一律视为不存在）：

```
偶数行 (r,c)：(-1,-1) (-1,0) (0,-1) (0,+1) (+1,-1) (+1,0)
奇数行 (r,c)：(-1, 0) (-1,+1) (0,-1) (0,+1) (+1, 0) (+1,+1)
```

---

## 4. 规则

### 4.1 发射

- 炮台固定在盘面正下方中央，瞄准角限制在 `[-80°, +80°]`（相对竖直向上，防止平射）；
- 松手发射，泡泡沿直线飞行，**碰到左右墙镜面反射**，不做能量损失（简化，保证可预测）；
- 命中判定：飞行泡泡中心与任一已存在泡泡中心距离 `< 2R` 即视为碰撞；
- 吸附：在碰撞点附近找一个**空的、且至少有一个已占用邻居（或位于第 0 行）**的格子，
  取与碰撞点距离最小者落位；找不到合法格子则本次发射作废（视为空放）。

### 4.2 消除

1. 落位后对同色做 4/6 邻域 flood fill，**同色连通块 ≥ 3 即整块消除**；
2. 消除后重新做「是否连到第 0 行」的连通性检查，**所有连不到顶部的泡泡整块掉落**（掉落也算消除，但不参与颜色计数）；
3. 消除与掉落都结算得分。

### 4.3 胜负

- **过关**：一次结算结束后盘面为空；
- **失败**：发射次数用尽仍未清空；
- 兜底：任何泡泡落到 `MAX_ROWS` 之外（理论上不会发生，因为落位前会校验）直接判负。

### 4.4 计分

```
每次消除：每个泡泡 10 分 × 连锁倍率
每次掉落：每个泡泡 20 分
过关奖励：剩余发射次数 × 50 分
```

最高分存档 `tiny_games_bubble_best`，通关进度 `tiny_games_bubble_progress`。

---

## 5. 关卡

30 关，参数表驱动 `BUBBLE_LEVELS`：

| 字段 | 含义 | 取值范围 |
|------|------|---------|
| `rows` | 初始行数 | 4 → 9 |
| `colors` | 颜色种类 | 4 / 5 / 6 |
| `shots` | 发射次数 | 26 → 74，随 `rows` 阶梯递增 |
| `seed` | 布局种子 | 固定，保证同关同一图案 |

发射次数按 `rows` 分档：4 行 26 发 / 5 行 34 发 / 6 行 42–46 发 / 7 行 50–54 发 /
8 行 58–64 发 / 9 行 68–74 发。设计约束是 **`shots` ≥ 「泡泡数 ÷ 3」的两倍**（理论最少发数的 2 倍宽松度）。

初始布局由 `rows × seed` 确定性逐格随机生成，随后做一次**颜色平衡**：

- 关卡声明的**每一种颜色都必须出现**（否则玩家可能整局见不到某个色）；
- 每种颜色在盘面上**至少 3 个**（否则该色永远凑不出一次消除）。

> 这两条约束与「2 倍宽松度」都在 verify 脚本里逐关断言；
> 另有「3 倍预算下贪心玩家能清空全部 30 关」的断言，用于证明关卡不会自锁。

---

## 6. 界面

720×1280 设计基准，全部运行时 `Graphics` + `Label`。

| 区块 | 内容 | 位置（设计坐标，y 自顶向下） |
|------|------|------|
| 顶栏 | 返回键 `‹`、标题「泡泡龙」、关卡进度 | 高 120 |
| 盘面 | 六边形泡泡阵列 + 左右墙 + 顶部横梁 | 第 0 行中心 y = 170 |
| 警戒线 | 一条虚线，接近 `MAX_ROWS` 位置 | y ≈ 830 |
| 炮台 | 圆形底座 + 当前泡泡 + 瞄准虚线（含一次反弹预测） | 中心 y = 1060 |
| 状态栏 | 剩余发射、得分、下一个泡泡、重开 | y ≈ 1160 |

配色：6 种泡泡色固定取自 `COLOR` 语义色板（主色 / 成功 / 危险 / 警告 / 信息 / 被动），
每个泡泡加**左上高光**与**底部暗边**，保证灰度下仍能靠明度区分。

---

## 7. 代码结构

```text
assets/games/game_bubble/
├── scenes/Bubble.scene          # Canvas + Root（挂 BubbleGame）
└── scripts/
    ├── BubbleCore.ts            # 纯逻辑，无 cc 依赖
    └── BubbleGame.ts            # 运行时 UI
tools/verify-bubble-core.js      # 纯逻辑自检
```

### 7.1 BubbleCore 对外接口

```ts
export const BUBBLE_COLS = 10;
export const BUBBLE_R = 32;
export const BUBBLE_ROW_H: number;
export const BUBBLE_MAX_ROWS = 13;
export const BUBBLE_EMPTY = -1;

export interface BubbleLevel { id: number; rows: number; colors: number; shots: number; seed: number; }
export const BUBBLE_LEVELS: readonly BubbleLevel[];

export function mulberry32(seed: number): () => number;
export function rowLength(row: number): number;
export function cellCenter(row: number, col: number): { x: number; y: number };
export function cellAtPoint(x: number, y: number): { row: number; col: number } | null;
export function neighborsOf(row: number, col: number): Array<{ row: number; col: number }>;

export interface ShotTrace {
  /** 落点格子；null = 空放 */
  cell: { row: number; col: number } | null;
  /** 折线路径（含反弹点），供 UI 播放动画与瞄准预览 */
  path: Array<{ x: number; y: number }>;
}

export class BubbleBoard {
  readonly maxRows: number;
  grid: Int16Array;
  snapshot(): BubbleSnapshot;
  static fromSnapshot(s: BubbleSnapshot): BubbleBoard;
  get(row: number, col: number): number;
  isFree(row: number, col: number): boolean;
  groupAt(row: number, col: number): CellRef[];
  /** 落位后结算：≥3 同色消除，再让悬空的整块掉落 */
  settle(row: number, col: number): { popped: CellRef[]; dropped: CellRef[]; score: number };
  isEmpty(): boolean;
  occupiedCount(): number;
  lowestOccupiedRow(): number;
  colorsPresent(): number[];
}

export function createBoard(level: BubbleLevel): BubbleBoard;
export function traceShot(board: BubbleBoard, origin: { x: number; y: number },
                          dir: { x: number; y: number }): ShotTrace;
export function pickNextColor(board: BubbleBoard, rand: () => number): number;
export function scoreFor(shotsLeft: number, won: boolean): number;

export const BUBBLE_AIM_LIMIT: number;   // 80° 弧度值
export function clampAim(angle: number): number;
export function aimToDir(angle: number): { x: number; y: number };
```

所有随机走 `mulberry32(seed)`，同种子结果完全可复现（与三消 / 五子棋一致）。

---

## 8. 存档

| 键 | 内容 |
|----|------|
| `tiny_games_bubble_best` | 最高分 |
| `tiny_games_bubble_progress` | 已通关的最大关卡号 |
| `tiny_games_bubble_save` | 当局断点（关卡、盘面快照、剩余发射、得分、下一个颜色） |

坏档一律回落为「从第 1 关重新开始」，不抛异常。

---

## 9. 验收用例

1. 同色连通 ≥3 消除，<3 不消除；
2. 消除后悬空泡泡整块掉落，且不会漏掉非悬空的；
3. 弹道在左右墙正确镜面反射，落点可预测；
4. 落位一定在合法空格内，不会与已有泡泡重叠；
5. 发射次数用尽 → 失败结算；清空 → 胜利结算（含剩余次数奖励）；
6. 返回大厅 → 再进入：断点恢复（盘面、剩余次数、得分一致）；
7. 30 关配置合法，初始布局每关都满足「至少一色出现 ≥3 次」；
8. `node tools/verify-bubble-core.js` 全绿、`tsc --noEmit` 通过、预览 console 0 error。

---

## 10. 明确不做（v1）

- 天花板下压 / 限时 / 连击特效层；
- 特殊泡泡（炸弹、彩虹、穿透）；
- 排行榜、每日挑战、后端；
- 音效与震动。

---

## 11. 验收记录（2026-11-08，编辑器预览 `127.0.0.1:7456`）

`node tools/verify-bubble-core.js` → **35 项全绿**；`tsc --noEmit` 通过；预览 console **0 error**。

坐标换算（设计坐标 → CSS）：canvas `left=163.5 / top=239`，`scale=0.54583`（720 宽塞进 393），
顶边有 76.33 的 letterbox，`cssY = top + 76.33 + 0.54583 × yFromTop`。

| 场景 | 结果 |
|------|------|
| 拖拽瞄准 | `_aim` 实时更新，虚线沿弹道走并**在墙上拐弯**，落点预览环贴合 |
| 松手发射 | 剩余 26 → 25，飞行插值正常，落位不与已有泡泡重叠 |
| 三连消除 | 同色 3 连 → 得分 +30，盘面 38 → 37 |
| 失败结算 | 发数耗尽 → 「挑战失败」面板，`phase='over'`，最高分落盘 |
| 胜利结算 | 盘面清空 → 「过关！…剩 7 发奖励 350 分」，总分 30+350=380，`maxLevel` +1 |
| 下一关 | 点「下一关」→ 关卡 2 → 3，发数重置为新关配置，遮罩关闭 |
| 选关面板 | 点顶部关卡标题可开，已解锁直达、未解锁点击无效，「关闭」正常收起 |
| 重玩本关 | 盘面/发数/得分回到本关初始值 |
| 断点恢复 | 打一发后回大厅再进 → 发数 / 得分 / 同色 next / **grid 逐格一致** |
| 大厅入口 | 大厅列表末位显示「泡泡龙」，点击进入 `Bubble.scene`、挂载 `BubbleGame` |

验收中修掉的两个真实缺陷：

1. **瞄准虚线几乎不可见**：原实现只画到 `AIM_DOT_STEP × 1.6 = 28.8` 设计像素（整段藏在炮口里）。
   改为从距炮口 72 起、每 22 画一个点、最多 40 个点 —— 一路画到落点并跟随反弹折线。
2. **瞄准层吃掉顶栏点击**：`AimLayer` 的可点区域上沿原为设计 y=96，盖住了关卡标题（y≈128），
   导致「点标题开选关」静默失效。把 `AIM_TOP` 下移到 152（标题之下、盘面首行之上）；
   同时给 `_onTouchAim` / `_onTouchRelease` 加 `_overlayOpen()` 守卫 ——
   遮罩节点没有监听器不拦事件，面板打开时点在面板外仍会发射。

