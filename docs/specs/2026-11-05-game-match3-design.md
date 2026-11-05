# 缤纷消除（`match3`）玩法设计

- 日期：2026-11-05
- 状态：设计定稿，实现中
- 对应路线图：[`2026-11-05-game-catalog-and-roadmap.md`](../plans/2026-11-05-game-catalog-and-roadmap.md) §5.4（P1-2）
- 场景：`assets/games/game_match3/scenes/Match3.scene`
- id / sceneName：`match3` / `Match3`

---

## 1. 一句话玩法

交换相邻两块糖果凑成三连，连锁消除完成关卡目标（分数 / 收集指定颜色 / 限步数）。

## 2. 目标体验

- 合集里第一款**大众休闲**品类：规则零学习成本，交换两块就能玩。
- 单关 1–3 分钟，失败可以立刻重来，不需要读任何说明。
- 反馈必须「炸得响」：四连出十字炸弹、五连出彩球，连锁时分数翻倍，让「多连一次」成为主动追求。
- 关卡推进给出短期目标：30 关，每关有步数上限与明确目标，通关给 1–3 星。

## 3. 规则

### 3.1 棋盘

- 8×8 网格，5 种颜色（关卡可降到 4 种）。
- 每个格子有 `color`（0–4）与 `special`（`none` / `row` / `col` / `rainbow`）。
- 坐标用一维下标 `index = row * 8 + col`，`row` 自上而下 0–7。

### 3.2 交换

- 只能交换上下左右相邻的两格。
- **只有交换后能形成至少一次消除时交换才成立**；否则两格换回原位、步数不扣、给出一次轻微提示。
- 两格都是炸弹时也按普通交换判定（v1 不做特殊组合技）。

### 3.3 消除与特殊块

- 横或竖方向连续 ≥3 个同色即消除。
- 消除后按下表生成特殊块，落点在**本次交换涉及的格子**中该连的第一个匹配格；若交换格不在匹配里则取连的中心格：

| 连长度 | 生成 | 效果（被消除时触发） |
|--------|------|----------------------|
| 3 | 不生成 | — |
| 4（横向连） | `col` 炸弹 | 清除整列 |
| 4（纵向连） | `row` 炸弹 | 清除整行 |
| ≥5 | `rainbow` 彩球 | 清除全盘同色块 |

- 特殊块被消除（无论是自己构成匹配，还是被别的炸弹/彩球波及）时立即触发效果，效果波及的格子再连锁判定，**用队列处理并去重**，避免死循环。
- 特殊块自身携带生成时的颜色，可参与同色匹配。

### 3.4 重力与补位

- 消除后，同一列上方的块整体下落，空位从顶部补入新颜色（随机，但**补位后立即再判定**，可形成连锁）。
- 连锁过程中 `chain` 从 1 开始递增；得分 = `10 × 消除格数 × chain`，特殊块触发额外 +30。

### 3.5 关卡与目标

30 关由配置表给出，三种目标类型：

| 类型 | 判定 |
|------|------|
| `score` | 单关累计得分 ≥ 目标分 |
| `collect` | 某颜色累计消除数 ≥ 目标数 |
| `clear` | 累计消除格数 ≥ 目标数 |

- 每关有 `moves` 步数上限；步数用完且目标未达成 → 失败，可立即重来。
- 星级：达标 1 星，得分 ≥ 目标分 ×1.5 → 2 星，≥ ×2 → 3 星（`collect` / `clear` 关按「达标时的剩余步数比例」折算：剩余 ≥ 30% → 2 星，≥ 60% → 3 星）。
- 关卡按顺序解锁：通关第 N 关解锁第 N+1 关。

### 3.6 无解处理

- 开局与每次结算后检查是否还存在合法交换（`hasMove`）。
- 无合法步时自动**重排**（保留所有块的 multiset，打乱位置），并在界面上提示「已重排」，不消耗步数。

## 4. 界面布局（设计分辨率 720×1280，左上原点）

| 区域 | 位置 / 尺寸 |
|------|-------------|
| 返回按钮 | 左上，复用 `createBackButton` |
| 标题 | 「缤纷消除」(360, 64) 44px；副标题 `MATCH 3` (360, 104) |
| 关卡 / 步数 | 顶部两条：(150, 166)「第 N 关」，(540, 166)「步数 12」 |
| 目标条 | (360, 214) 文字 + (360, 248) 进度条（520×14） |
| 棋盘 | 8×72 = 576，左上角 (72, 300) |
| 得分 | (360, 960) 大号分数，(360, 1002) 连锁提示 |
| 重开 / 提示 | 底部并排两个按钮 (220, 1090) / (500, 1090)，260×88 |
| 覆盖层 | 胜负结算 560×460 居中，含「下一关 / 重来」 |

- 糖果用 `Graphics` 圆角方块 + 高光，特殊块叠画箭头（`row`/`col`）或星芒（`rainbow`）。
- 选中格描白边；可交换目标格在选中时描淡边。
- 五种颜色各自配一个**形状**（圆 / 方 / 菱形 / 三角 / 星），不只靠颜色区分；`collect` 关目标文案直接写颜色名（红 / 蓝 / 绿 / 黄 / 紫）。

## 5. 交互流程

```
进入场景 → 载入存档（当前关卡、星级、最高分）
点一块 → 选中（再点同一块取消）
点相邻块 → 判定交换
  ├─ 合法：扣 1 步 → 播放消除 / 下落 / 连锁 → 判定目标
  └─ 不合法：换回 + 轻微抖动，不扣步
目标达成 → 结算弹窗（星级、得分）→ 下一关 / 重来
步数用尽未达成 → 失败弹窗 → 重来
「提示」→ 高亮一组可交换的块（不扣步，不消耗资源）
```

- 动画：消除 → 白色闪烁 100 ms → 下落补位 → 下一段连锁，每段 120 ms；用 `update` 计时泵推进，不用 `scheduleOnce` 自排期（见 `docs/tech/cocos-scheduler-and-tween-pitfalls.md`）。

## 6. 可玩性评估

**核心循环**：看一眼 → 找一个能凑三连的交换 → 炸开 → 连锁加分成倍 → 离目标更近一步。

**节奏**（按第 1 关：20 步、目标 1800 分）

| 阶段 | 体验 |
|------|------|
| 第 1–3 步 | 每次 3 连约 90 分，玩家感到「远远不够」 |
| 第 4–8 步 | 第一次四连出炸弹，一次 300+，形成「找四连」的策略 |
| 第 10 步后 | 连锁一次翻倍，出现五连彩球，单步 800+ |
| 结算 | 1.5 倍分达标拿 2 星，留出「再打一次冲 3 星」的动机 |

**风险与处理**

| 风险 | 影响 | 处理 |
|------|------|------|
| 开局就送三连 / 无解 | 体验崩坏 | 生成后校验：无现成三连、必有合法步；无解自动重排 |
| 连锁递归爆栈 / 死循环 | 卡死 | 队列 + `visited` 去重，链数上限 30 |
| 每块一个节点导致卡顿 | 掉帧 | 单 `Graphics` 整盘重绘，特殊块用二次绘制 |
| 颜色区分度不足 | 难辨认 | 5 色 + 圆形/方形/菱形/三角/星形轮廓差异，不只靠颜色 |
| 关卡数值不合理 | 卡关或白给 | 30 关按公式生成，自检里跑「自动玩家」评估每关可达性 |

**结论**：规则最简单、受众最广，且纯逻辑可完整自检（棋盘、连锁、目标、无解重排），是最适合补「大众休闲」空白的一款。

## 7. v1 不做

- 限时关、道具商店、皮肤、好友排行、剧情、音效。
- 障碍物（冰块 / 藤蔓 / 传送带）、多种棋盘形状。
- 特殊块组合技（炸弹 + 彩球 = 清屏等）。
- 云存档、内购、广告复活。

## 8. 技术方案

### 8.1 文件

```
assets/games/game_match3/
├── scenes/Match3.scene          # Canvas + 一个挂 Match3Game 的空节点，UI 全部运行时构建
└── scripts/
    ├── Match3Core.ts            # 纯逻辑：棋盘、交换、消除、连锁、特殊块、重排、存档（无 cc 依赖）
    ├── Match3Levels.ts          # 30 关配置 + 目标判定 + 星级
    └── Match3Game.ts            # Cocos 组件：渲染、输入、动画计时、关卡流程
tools/verify-match3-core.js      # Node 自检
```

### 8.2 `Match3Core` 公开接口

```ts
export type Match3Special = 'none' | 'row' | 'col' | 'rainbow';

export interface Match3Cell { color: number; special: Match3Special; }

export interface Match3Step {
    chain: number;
    cleared: number[];          // 本段消除的格子下标
    triggers: number[];         // 本段被触发的特殊块下标
    score: number;              // 本段得分
}

export interface Match3SwapResult {
    from: number;
    to: number;
    steps: Match3Step[];        // 逐段连锁
    score: number;
    clearedByColor: number[];   // 各颜色消除计数
    clearedTotal: number;
    shuffled: boolean;          // 结算后无解自动重排
}

export class Match3Core {
    readonly cols: number;      // 8
    readonly rows: number;      // 8
    readonly colorCount: number;
    cells: Match3Cell[];

    static create(seed: number, colorCount?: number): Match3Core;
    static fromSnapshot(raw: unknown, colorCount?: number): Match3Core | null;

    colorAt(index: number): number;
    specialAt(index: number): Match3Special;

    canSwap(a: number, b: number): boolean;      // 是否相邻且能形成消除
    findHint(): [number, number] | null;         // 一组合法交换
    hasMove(): boolean;

    /** 执行交换并结算全部连锁；非法交换返回 null（棋盘不变） */
    swap(a: number, b: number): Match3SwapResult | null;

    snapshot(): Match3Snapshot;
}

export function getMatch3Level(id: number): Match3Level;   // 序号越界自动落到 1 / 30
```

### 8.3 自检（`tools/verify-match3-core.js`）

- 生成：500 个种子 × 4/5 色，开局无现成三连、必有合法步、颜色都在范围内。
- 交换合法性：不相邻 / 相同格 / 无法形成消除 → 返回 null 且棋盘完全不变。
- 结算完整性：任意合法交换后棋盘 64 格填满、颜色合法、无残留三连。
- 特殊块：四连出 `row`/`col`、五连出 `rainbow`；炸弹触发清整行/整列；彩球清同色；触发链不死循环。
- 连锁：链数递增、得分 = `10 × 格数 × chain`、`clearedByColor` 与 `cleared` 总数一致。
- 无解重排：构造无合法步的棋盘 → `swap` 后 `shuffled` 为真且重排后 `hasMove` 为真、颜色 multiset 不变。
- 长跑：10,000 次随机合法交换不崩、不越界、无 `NaN`；单次结算耗时有上界。
- 关卡：30 关配置合法（目标 > 0、步数 > 0）、`getMatch3Level` 对越界序号兜底、星级折算边界、存档坏档回落。

### 8.4 场景接入

1. `Match3.scene`：Canvas + 空节点 `GameRoot`，挂 `Match3Game` 组件。
2. `GameConfig.ts` 注册：`{ id: 'match3', name: '缤纷消除', icon: 'default', sceneName: 'Match3', description: '交换相邻方块凑三连，连锁消除闯 30 关' }`。
3. 跑 `node tools/sync-build-scenes.js` 同步微信构建场景清单（需先退出编辑器）。

## 9. 验收清单

- ✅ `node tools/verify-match3-core.js` 全绿（25 项）。
- ✅ Cocos 自带 `tsc --noEmit` 通过。
- ✅ 浏览器预览实测（2026-11-05）：选中 / 交换 / 非法交换提示「这一步凑不成三连」且不扣步 / 连锁 ×2 加分 / 提示高亮 / 过关结算（1 星）/ 下一关（进度存档）/ 步数耗尽失败 / 重来 / 返回大厅并从大厅重新进入。
- ⬜ 微信真机：棋盘不超屏、点击命中准确、主包体与构建预检通过（需先退出编辑器跑 `node tools/sync-build-scenes.js`）。
