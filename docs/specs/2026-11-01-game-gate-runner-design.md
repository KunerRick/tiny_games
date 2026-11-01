# 数值冲刺（Gate Runner）设计规格

> 日期：2026-11-01
> 状态：**已实现、已验收**（纯逻辑 12/12、场景 19 项绑定、浏览器实测通过）
> 场景：`assets/games/game_gate_runner/scenes/GateRunner.scene`
> 代码：`assets/games/game_gate_runner/scripts/{GateConfig,GateCore,GateGame}.ts`
> 回归：`node tools/verify-gate-core.js`
> 关联：[`../plans/2026-10-31-gate-runner-design-draft.md`](../plans/2026-10-31-gate-runner-design-draft.md)（草案）、
> [`../plans/2026-10-31-next-games-roadmap.md`](../plans/2026-10-31-next-games-roadmap.md)（第 8 款）、
> [`../design/2026-11-01-gate-runner-scene-setup.md`](../design/2026-11-01-gate-runner-scene-setup.md)（场景搭建记录）

---

## 1. 品类与核心循环

**gate runner / count runner（数值门跑酷）**，代表作《Count Masters》《Number Gates》。
用户原始描述：「往前走，发射子弹，左右两边都有选择，是 ×2 或者 ÷2 或者 +20」。

```
自动前进 → 左右两扇数值门 → 横移选一边 → 数值变化
        → 遇到挡路敌人 → 停下对拼（我方 dps 扣敌人血 / 敌人持续消耗我方人数）
        → 继续前进 → …… → 终点 Boss → 结算（通关 / 全军覆没）
```

乐趣不在操作精度，而在**数值滚雪球的决策**：每次二选一都在「现在更强」和「之后更稳」之间下注。

**单资源设计**：队伍人数 `count` 同时是**火力**和**血量**。

- 火力：`dps = min(count, FIRE_CAP)`，每发子弹 1 点伤害，子弹只是表现
- 血量：对拼期间持续扣 `count`
- `count ≤ 0` → 立即 `game_over`（比"走到终点"更常见的失败方式）

于是 ×门同时让你打得更快、更耐打；÷门双重惩罚，选择有分量。

---

## 2. 代码结构

严格三层，`Config` / `Core` 不 import `cc`，可被 Node 直接编译回归（与 Tetris / 砖块远征 / 合合大作战一致）：

```
assets/games/game_gate_runner/scripts/
├── GateConfig.ts    // 常量、门模板、敌人/速度曲线、计分、色板
├── GateCore.ts      // 纯逻辑：滚动、门触发、对拼、关卡生成、事件
└── GateGame.ts      // Cocos 组件：Graphics 绘制 + 触摸 + HUD/暂停/结算
tools/verify-gate-core.js
```

`GateCore` 对外接口：

```ts
startRun(seed: number): void
reset(): void
step(dt: number): void
setPlayerX(x: number): void
popEvents(): GateEvent[]
// 只读：state / distance / count / countExact / playerX / gates / enemies / boss / score
```

**确定性**：`mulberry32(seed)`，同 seed 的门/敌人序列逐位相同（回归 #9）。

---

## 3. 数值与规则

### 3.1 坐标系与镜头

逻辑坐标原点左上、y **向下**（与其它游戏一致）。玩家固定在屏幕 `PLAYER_Y`，世界按 `distance` 向下滚动：

```
screenY(worldY) = PLAYER_Y - (worldY - distance)
```

| 常量 | 值 | 说明 |
|------|----|------|
| `PLAY_W` / `PLAY_H` | 660 / 860 | 与 PlayArea 节点一致 |
| `PLAYER_Y` | 700 | 队伍中心所在屏幕 y |
| `PLAYER_X_MIN` / `MAX` | 90 / 570 | 横移范围（中心） |
| `PLAYER_R` | 26 | 方阵名义半径（仅表现） |
| `SCROLL_BASE` | 420 px/s | 起始速度 |
| `SCROLL_MAX` | 620 px/s | 封顶 |
| `SCROLL_ACCEL` | 0.05 px/s per px | 速度随距离线性增长 |
| `CONTACT_DIST` | 64 | 与敌人"接触"的世界距离（对方 y − distance ≤ 64 即开打） |

### 3.2 数值

| 常量 | 值 | 说明 |
|------|----|------|
| `START_COUNT` | 20 | 初始人数 |
| `COUNT_MAX` | 9999 | 上限（显示/溢出双保险） |
| `FIRE_CAP` | 60 | 每秒发射数 = 秒伤上限 |
| `ENEMY_DRAIN_RATIO` | 0.08 | 敌人每秒额外消耗「当前人数 × 该比例」 |
| `BOSS_DRAIN_MULT` | 1.5 | Boss 的消耗倍率（比例部分同乘） |
| `BOSS_HP` | 160 | Boss 固定血量 |
| `SUBSTEP_SEC` | 1/120 | 固定子步长，避免大 dt 跳门 |
| `MAX_FRAME_DT` | 0.05 | 单帧 dt 上限（切后台回来不一次算爆） |
| `SQUAD_HIT_EVENT_SEC` | 0.2 | `squad_hit` 飘字的产出间隔 |

> **为什么 `ENEMY_DRAIN_RATIO` 按当前人数按比例扣**：只有固定 atk 时，人数滚起来后对拼几乎无风险；
> 按比例扣让「人多也怕拖」，同时保证对拼时长可控（`1/0.08 ≈ 12.5 s` 是纯比例的天然上限）。

### 3.3 数值门

- 成对出现：左门 `x ∈ [40, 320]`，右门 `x ∈ [340, 620]`，`GATE_W = 280`、`GATE_H = 90`
- 玩家中心 `x < GATE_SPLIT_X(330)` 判为走左门，否则走右门
- 一对门只有**一侧**生效；另一侧同时作废（`used` 双侧置 true），保证「同一对门只触发一次」
- 门板在 `distance ≥ gate.y` 的那一子步触发

门模板池（`GATE_TEMPLATES`，每对随机抽一个模板、左右随机交换）：

| 模板（a / b） | 出现距离 `from` | 设计意图 |
|------|------|------|
| `×2` / `+30` | 0 | 教学：乘法 vs 加法 |
| `×2` / `÷2` | 0 | 经典高风险 |
| `+20` / `+50` | 0 | 纯加法保底 |
| `−10` / `×2` | 720 | 付费换倍率 |
| `×3` / `÷2` | 1440 | 后期激进 |
| `÷2` / `+100` | 1440 | 大数时的赌博 |

`applyGateOp(count, op)`：

| 操作 | 规则 |
|------|------|
| `mul` | `count × v` |
| `div` | `max(1, floor(count / v))` —— **除不出 0**，否则一次倒霉的 ÷2 等于直接判负，而玩家那一刻没做错任何事 |
| `add` | `count + v` |
| `sub` | `count − v`，可以打到 0 |

结果统一过 `clampCount()`：NaN / 负数 → 0，超上限 → `COUNT_MAX`，向下取整。
**能把人数打到 0 的只有 `−N` 门和敌人**，这条是回归 #2 的判据。

### 3.4 敌人

| 属性 | 公式 |
|------|------|
| `hp` | `round(24 + 0.05 × distance)` |
| `atk`（每秒基础伤害） | `2 + distance / 800` |
| `width`（只用于绘制，v1 不允许绕行） | `min(420, 260 + distance / 20)` |
| Boss `hp` | 固定 160 |
| Boss `atk` | `enemyAtkAt(distance) × 1.5` |

对拼（`_fight`，每子步）：

```
dps   = min(count, FIRE_CAP)
hp   -= dps × dt
drain = (boss ? bossAtkAt : atk) + count × ENEMY_DRAIN_RATIO × (boss ? 1.5 : 1)
count -= drain × dt
```

- 敌人 `hp ≤ 0` → 敌人消失、继续前进（Boss 死亡即 `victory`）
- 我方 `count ≤ 0` → `game_over`
- 对拼期间 `distance` 不增长（玩家被"挡住"）

### 3.5 关卡生成

`SEGMENT_LEN = 360`、`SEGMENT_COUNT = 8`：

- 偶数段（0/2/4/6）在 `i × 360 + 260` 放一对门
- 奇数段（1/3/5/7）在 `i × 360 + 300` 放一个敌人
- 最后在 `BOSS_DISTANCE = 3200` 放 Boss

即 **4 对门 + 4 个敌人 + 1 个 Boss**，落点互不重叠（回归 #10 校验最小间距 ≥ `GATE_H`）。

### 3.6 计分

```
score = distance × 0.1 + count × 10 + (victory ? 1000 : 0)
```

HUD 距离显示为「米」，即 `floor(distance / 10)`；速度显示为 `round(scrollSpeed / 10) km/h`。

---

## 4. 状态机与事件

```
ready → running → (game_over | victory) → 结算面板 → 重来一局 / 返回大厅
```

`GateCore` 产出的事件（`popEvents()` 一次取空）：

```ts
type GateEvent =
  | { type: 'gate_hit';        side: 'left'|'right'; kind: 'mul'|'div'|'add'|'sub';
      value: number; before: number; after: number; y: number }
  | { type: 'enemy_engaged';   id: number; hp: number; boss: boolean }
  | { type: 'enemy_destroyed'; id: number; y: number; boss: boolean }
  | { type: 'squad_hit';       amount: number; count: number }
  | { type: 'victory';         score: number; count: number; distance: number }
  | { type: 'game_over';       count: number; distance: number };
```

表现层消费：`gate_hit` → 门变绿/变红 + 飘字；`squad_hit` → 红字 −N + 队伍抖动；`enemy_destroyed` → 碎屑。

---

## 5. 输入

| 手势 | 行为 |
|------|------|
| 按住拖动（`TOUCH_START` / `TOUCH_MOVE`） | 队伍中心 x 跟随手指，钳制 `[90, 570]` |
| 抬起（`TOUCH_END` / `TOUCH_CANCEL`） | **不做任何事**——横移是纯位移，没有"确认"动作 |
| 暂停 / 结算面板打开 | `_acceptsPlayInput()` 返回 false，输入穿透被挡住 |

触摸节点是 `PlayArea/InputArea`（660×860），面板是它的兄弟节点，打开时不会误触。
`_toLogic()` 用 `convertToNodeSpaceAR` 换算后再加回 `PLAY_W/2`、`PLAY_H/2`。

---

## 6. 表现（零美术）

全部 `cc.Graphics`，不新增贴图资源（面板 `Dim` 复用砖块远征的 `white.png` 染色）。

| 元素 | 画法 |
|------|------|
| 背景 | 深蓝底 `#151E33` + 随 `distance` 向下滚动的横向细线（`rect + fill`，不用 `stroke`） |
| 道路 | 中间一块略亮的 `roundRect` + 两侧边框线 |
| 数值门 | 左右各一块半透明圆角色块（乘=蓝 `#4EA8FF`、除=红 `#FF6B6B`、加=绿 `#6EE7B7`、减=橙 `#FFA94D`）+ 顶部高光条 + 中间 `Label` 写 `×2` / `÷2` / `+20` / `−10` |
| 队伍 | 最多 40 个小圆点按 `ceil(sqrt(n))` 方阵排列，带正弦抖动；半径随人数从 11 收到 5；超过 `FIRE_CAP` 时脚下画一条暗色"火力封顶"小条 |
| 人数标签 | 队伍上方大号数字（`HudTop/CountLabel`），超过 `FIRE_CAP` 用青色提示"火力已封顶" |
| 敌人 | 红色圆角块（Boss 更大更红）+ 顶部暗条 + 血条（实心矩形）+ 剩余血量数字 |
| 子弹 | 从队伍前方周期性射出的 4×14 实心小矩形，命中消失并溅碎屑 |
| 特效 | 碎屑（`MAX_DEBRIS = 120`）、飘字（池化 `Label`）、命中时整体 `shake` |

**性能**：子弹 `MAX_BULLETS = 80`、碎屑 120，全部池化；门/敌人的文字用 `Label` 池（建好后只改 `string` 与 `position`，不 `destroy`）。

**HUD 文案**（`_hintFor()`）：

| 情形 | 文案 |
|------|------|
| 普通状态 | `左右拖动选门 · × 卖血换收益` |
| `count > FIRE_CAP` | `火力已封顶 · 优先选 × 门攒血量` |
| 对拼中 | `交火中 · 横移躲不开，硬打` |
| Boss 战 | `Boss 战：撑住！` |
| 人数封顶 | `人数已封顶` |
| 失败 / 通关 | `人数归零 · 再来一局` / `已通关` |

**结算面板**：`通关！`（绿）/ `全军覆没`（红）→ 分数 → `人数 N · M m` → `最高分 N` → 再来一局 / 返回大厅。

---

## 7. 场景节点契约

完整节点树、UUID、坐标见 [`../design/2026-11-01-gate-runner-scene-setup.md`](../design/2026-11-01-gate-runner-scene-setup.md)。

`GateGame` 共 **19 个 `@property`**（12 个 `Node` + 7 个 `Label`）：

| 层 | 属性 |
|----|------|
| 渲染 | `backgroundLayer` / `fieldLayer` / `effectLayer` |
| 输入 | `inputArea` |
| HUD | `countLabel` / `distanceLabel` / `hintLabel` |
| 暂停 | `pauseButton` / `pausePanel` / `pauseResumeButton` / `pauseRestartButton` / `pauseLobbyButton` |
| 结算 | `resultPanel` / `resultTitleLabel` / `resultScoreLabel` / `resultCountLabel` / `resultBestLabel` / `resultRestartButton` / `resultLobbyButton` |

**关键结构约束**：`fieldLayer` 与 `effectLayer` 必须位于一个带 `cc.Mask` 的 `ClipLayer`（660×860）之下。
否则敌人/门飘到游戏区上方会画到 HUD 上面（本轮实测踩到，见场景文档 §6）。

---

## 8. 回归测试（`tools/verify-gate-core.js`，12/12 全绿）

| # | 用例 | 判据 |
|---|------|------|
| 1 | 门模板 | 每对门左右各一个、操作类型合法、值 > 0、位置递增、左右不相同 |
| 2 | 乘除 | `×2` 翻倍；`÷2` 向下取整且**最低保留 1**；`−N` 可以打到 0 |
| 3 | 钳制 | 连续 ×3 不越 `COUNT_MAX`、无 NaN；NaN/负数 → 0 |
| 4 | 门只触发一次 | 同一对门停留 2 s 只生效一次，双侧 `used` |
| 5 | 对拼公式 | 我方伤害 = `min(count, FIRE_CAP) × dt`，我方损失 = `(atk + count × 0.08) × dt`（按 `countExact` 比较，避免 floor 差被误判成"人数上涨"） |
| 6 | 敌人死亡后继续前进 | 事件顺序 `enemy_engaged → enemy_destroyed`，之后 `distance` 恢复增长 |
| 7 | 人数归零 | 立即 `game_over`、不再前进、人数不回升 |
| 8 | Boss | 一路选优门 → `victory`，Boss 已死，`distance ≥ BOSS_DISTANCE − CONTACT_DIST`，分数含通关奖励 |
| 9 | 生成确定性 | 同 seed 门/敌人序列逐位相同，不同 seed 会变 |
| 10 | 生成合法性 | 物体最小间距 ≥ `GATE_H`、Boss 唯一且在最后、不在出生点 |
| 11 | 180 s 自动游玩 | 5 个 seed 都能到终态，人数/距离合法，横移不越界 |
| 12 | 平衡性 | 3 个 seed：一路优门通关且有盈余；一路劣门必死 |

```bash
node tools/verify-gate-core.js
# → GATE_CORE_OK  通过 12/12
```

---

## 9. 与草案（`plans/2026-10-31-gate-runner-design-draft.md`）的差异

草案是"开工前的一页纸"，实现时按手感与回归数据做了以下调整，**以本文为准**：

| 项 | 草案 | 实现 | 原因 |
|----|------|------|------|
| `FIRE_CAP` | 30 | **60** | 30 时强力 build 也要打 3–4 s 才能清掉一个敌人，节奏拖沓；60 让中后期对拼控制在 1–2 s |
| `SEGMENT_LEN` | 420 | **360** | 8 段 × 420 = 3360 略长；360 让一局约 45–60 s |
| `BOSS_DISTANCE` | 2400 | **3200** | 与段长联动，保证 4 对门 + 4 敌人排满后 Boss 在最后 |
| 敌人 HP 曲线 | `30 + 0.08d` | **`24 + 0.05d`** | 配合 FIRE_CAP 60，让"优门路线"刚好吃得下 |
| 敌人扣血 | 仅 `atk` | **`atk + count × 0.08`** | 纯固定 atk 时人数滚起来对拼无风险，见 §3.2 注 |
| `÷` 保底 | "至少扣 1" | **结果最低 1** | 两种说法都成立，实现按"结果 ≥ 1" |
| 门模板出现距离 | 未定义 | `from` 字段（0 / 720 / 1440） | 前期只给教学与保底模板 |
| 结算字段 | 草案无 | 分数 / 人数 / 距离 / 最高分 | 与另外三款游戏的结算面板对齐 |

**未做的（v1 非目标）**：点击左右半屏换道、Boss 多阶段、每日挑战固定 seed、音效、排行榜、敌人可绕行。

---

## 10. 已知平衡观察

- **站着不动能赢**：初始 `x = PLAY_W/2 = 330`，恰好 `GATE_SPLIT_X = 330`（`<` 判定），即不动时**总是走右门**。
  实测右门运气好时可以不操作通关。这是"二选一"品类的固有现象（总有一侧是"对的"），
  但意味着**新手第一次玩可能感觉不到操作的价值**。后续可考虑：
  把初始 x 挪到 `GATE_SPLIT_X ± 一些`（强制第一次必须操作），或前 2 对门设计成"两侧都正向但增幅不同"。
- **横移手感**：手指跟随而非加速度，`PLAYER_X_MIN/MAX` 90/570 留出了 90 px 的边距，
  不会因为贴边而看不清门上的数字。
- **对拼不可躲**：v1 敌人占满道路，`_blockingEnemy()` 不判断 x。这是刻意的——如果横移能躲，
  "人数"就不再是被考核的资源。若后续要加「闪避」，需要同时改对拼公式。
