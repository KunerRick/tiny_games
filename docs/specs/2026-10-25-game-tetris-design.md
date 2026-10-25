# 方块坠落（Tetris）— 游戏设计文档

**日期**: 2026-10-25
**版本**: v1.0
**状态**: 设计中
**代号**: `tetris` / 场景 `Tetris` / 目录 `assets/games/game_tetris/`

---

## 1. 概述

经典俄罗斯方块玩法的单人马拉松模式，作为 Tiny Games 合集的第五款游戏。

**核心目标**

- **经典规则**: 10×20 棋盘、7-bag 随机器、SRS 旋转 + 踢墙、Next×3、Hold、Ghost、锁延迟
- **触屏优先**: 默认全屏相对手势，瞄准和遮挡问题在机制层面消除
- **双操作模式**: 设置内可切到虚拟按键，覆盖不习惯手势的玩家
- **零学习成本**: 首局引导 + 渐进式提示，三种手势各用一次后自动收起

**非目标（v1 不做）**

- 竞速 / 40 行 / 限时模式
- 对战、排行榜、皮肤商店
- T-Spin / Combo / B2B 等进阶计分
- 背景音乐与音效（先只做震动反馈）

---

## 2. 核心玩法规则

### 2.1 棋盘与坐标系

| 属性 | 值 |
|------|-----|
| 逻辑尺寸 | 10 列 × **22 行**（0–19 可见，20–21 为旋转踢墙/顶出的隐藏行） |
| 坐标约定 | `grid[row][col]`，`row` 0 在底、21 在顶；`col` 0 在左 |
| 渲染裁剪 | 只渲染 row 0–19；隐藏行不绘制（无需 Mask） |
| 初始状态 | 全空 |

### 2.2 方块定义与 7-bag

七种方块在 3×3（JLSTZ）、4×4（I）、2×2（O）包围盒内定义，**偏移量按 y 向上**：

| 方块 | 包围盒 | 状态 0 的格子偏移 `(x, y)` |
|------|--------|---------------------------|
| I | 4×4 | (0,2) (1,2) (2,2) (3,2) |
| O | 2×2 | (0,1) (1,1) (0,0) (1,0) |
| T | 3×3 | (1,2) (0,1) (1,1) (2,1) |
| S | 3×3 | (1,2) (2,2) (0,1) (1,1) |
| Z | 3×3 | (0,2) (1,2) (1,1) (2,1) |
| J | 3×3 | (0,2) (0,1) (1,1) (2,1) |
| L | 3×3 | (2,2) (0,1) (1,1) (2,1) |

> JLSTZ 占包围盒的**上两行**，底行留空——这与 SRS 的旋转中心一致，不能把方块整体下移一行，否则踢墙结果会全错。

**顺时针旋转**（y 向上，包围盒边长 `N`）：`(x, y) → (y, N - 1 - x)`。O 方块跳过旋转。
（屏幕坐标 y 向下时才是 `(x, y) → (N - 1 - y, x)`，不要混用。）

**生成规则**：7-bag。每袋包含 7 种各一个，Fisher–Yates 洗牌；袋空即补新袋。禁止"只随机不装袋"。

**出生位置**：

| 方块 | 出生点 `(x, y)`（包围盒左下角） |
|------|-------------------------------|
| JLSTZ | (3, 17) |
| I | (3, 16) |
| O | (4, 18) |

规则等价于"最低占用格落在第 18 行"（JLSTZ 的格子最低 y=1，所以原点在 17），保证新方块**立刻可见**，不会在隐藏行里空等一秒钟。
若出生位置与已有格子重叠 → **Block Out**，游戏结束。

### 2.3 旋转与 SRS 踢墙

旋转失败时按顺序尝试 5 个偏移，第一个不碰撞的位置生效。

```
JLSTZ（O 不旋转）
0→R: (0,0) (-1,0) (-1,+1) (0,-2) (-1,-2)
R→0: (0,0) (+1,0) (+1,-1) (0,+2) (+1,+2)
R→2: (0,0) (+1,0) (+1,-1) (0,+2) (+1,+2)
2→R: (0,0) (-1,0) (-1,+1) (0,-2) (-1,-2)
2→L: (0,0) (+1,0) (+1,+1) (0,-2) (+1,-2)
L→2: (0,0) (-1,0) (-1,-1) (0,+2) (-1,+2)
L→0: (0,0) (-1,0) (-1,-1) (0,+2) (-1,+2)
0→L: (0,0) (+1,0) (+1,+1) (0,-2) (+1,-2)

I
0→R: (0,0) (-2,0) (+1,0) (-2,-1) (+1,+2)
R→0: (0,0) (+2,0) (-1,0) (+2,+1) (-1,-2)
R→2: (0,0) (-1,0) (+2,0) (-1,+2) (+2,-1)
2→R: (0,0) (+1,0) (-2,0) (+1,-2) (-2,+1)
2→L: (0,0) (+2,0) (-1,0) (+2,+1) (-1,-2)
L→2: (0,0) (-2,0) (+1,0) (-2,-1) (+1,+2)
L→0: (0,0) (+1,0) (-2,0) (+1,-2) (-2,+1)
0→L: (0,0) (-1,0) (+2,0) (-1,+2) (+2,-1)
```

偏移量的 `y` 为正表示向上，与棋盘坐标系一致。

### 2.4 重力、锁定与消行

| 参数 | 值 |
|------|-----|
| 重力 | 按等级查表，见 2.5 |
| 软降 | `min(重力间隔, 40ms/行)` |
| 硬降 | 立即落到底并**立刻锁定**（不享受锁延迟） |
| 锁延迟 | **500ms**，方块触底后开始计时 |
| 锁延迟重置 | 成功移动或旋转时重置，**最多 15 次**；第 16 次后不再重置 |
| 消行动画 | 闪白 120ms → 收行 → 生成下一块（期间忽略输入） |
| 消行范围 | 只检查 row 0–19 |

**实现红线**：重力与锁延迟计时必须在 `update(dt)` 里累加，**禁止用 `scheduleOnce(this.xxx)` 自排期**——同一回调在自身执行中重新排期会被引擎静默丢弃（见 AGENTS.md 教训 F）。

### 2.5 计分与等级

| 项目 | 分值 |
|------|------|
| 消 1 行 | 100 × 等级 |
| 消 2 行 | 300 × 等级 |
| 消 3 行 | 500 × 等级 |
| 消 4 行 | 800 × 等级 |
| 软降 | +1 / 格 |
| 硬降 | +2 / 格 |

- 等级 = `floor(总行数 / 10) + 1`
- 重力间隔 = `(0.8 - (等级-1) × 0.007) ^ (等级-1)` 秒，下限 30ms

### 2.6 结束条件

- **Block Out**：新方块出生位置被占用
- **Lock Out**：方块锁定后全部占用格都在第 20 行以上

结算面板显示：本局分数、消行数、历史最高分、最高行数。

---

## 3. 操作设计（重点）

### 3.1 设计原则

触屏 Tetris 体验差，根因不是"手指粗"，而是三点：

1. **精度**：手指接触面约 44px，格宽约 48px，半格误差肉眼不可见
2. **遮挡**：手指压在落点区域上，看不见方块会落到哪
3. **手势歧义**：点按、横拖、下拖在前 100ms 内是同一个动作

**核心机制：相对位移，而不是方块跟手。**

> 手指不需要指向方块，只需要告诉它"往左/右移动了几格"。

- 手指可落在屏幕任意位置，包括棋盘下方的空白区 → 消除遮挡
- 吸附由逻辑层完成 `列 = 起始列 + round(dx / 格宽)` → 消除精度问题
- 半格误差被吸附吸收，玩家感知不到

### 3.2 模式一：全屏相对手势（默认，推荐）

操作区 = 整个屏幕。手势定义：

| 手势 | 行为 | 参数（设计像素，720 宽基准） |
|------|------|------------------------------|
| 轻点 | 顺时针旋转 | 位移 < 18px 且时长 < 260ms |
| 横向拖动 | 按列吸附移动，可连续跨多列 | 每 1 格 = `cellSize`（约 40px） |
| 按住向下拖 | 软降持续，松手停止 | 下移超过半格（20px）触发 |
| 快速下甩 | 硬降 | 竖向速度 > 1.5px/ms 且下移 > 2 格 |
| 双指点按 | 逆时针旋转 | 第一指按住时第二指按下 |
| 触摸左侧「暂存」面板 | Hold | 低频操作，用按钮而非手势 |

**为什么 Hold 不做手势**：上滑与旋转/拖拽冲突，且 Hold 是低频操作，给它一个明确的按钮比多一条手势规则更划算。

**边界规则（必须实现，否则会出现"点了没反应"）**：

- `TOUCH_CANCEL` = 手势结束：保留已经产生的移动，**不触发旋转、不触发硬降**
- 进入拖拽态但**一格都没移动**、且总位移小于一格、时长 < 400ms → **回退为轻点旋转**（对应手册 §11.6 的"拖了个空"）
- 方块在拖拽过程中锁定 → 重新取基准：`起始列 = 新方块列`，`startX = 当前手指 x`，手势保持存活（下拖软降可继续），但**旧位移不能带入新方块**
- 横拖撞墙后，位移累加器限制在「实际列 ±1 格」内，避免回拖时出现大段死区

**手势状态机**

```
IDLE
 └ TOUCH_START → PENDING（记录 startX/startY/startTime/startCol，绑定 touchId）
PENDING
 ├ 第二指按下                      → 逆时针旋转，标记 consumed
 ├ |dx| ≥ 18px 或 dy ≥ 半格        → DRAG
 └ TOUCH_END / CANCEL
      ├ 未 consumed 且位移 < 18px 且时长 < 260ms → 顺时针旋转
      └ 其他 → 无动作
DRAG
 ├ MOVE：col = startCol + clamp(round(dx / cell), 实际列-1, 实际列+1)
 │        dy ≥ 半格 → 软降开；dy < 半格 → 软降关
 ├ TOUCH_END
 │    ├ 竖向速度 > 1.5px/ms 且 dy > 2 格 → 硬降
 │    ├ 零列位移 + 零行位移 + 时长 < 400ms → 顺时针旋转
 │    └ 其他 → 结束
 └ TOUCH_CANCEL → 仅结束（不旋转、不硬降）
```

### 3.3 模式二：虚拟按键

两个拇指分区，避免五指挤在底部一条线上：

```
┌─────────────────────────────────┐
│           棋盘（不被遮挡）        │
│                                 │
│                                 │
│  ┌────────┐ ┌────────┐          │
│  │   ←    │ │   →    │  ┌─────┐ │
│  └────────┘ └────────┘  │硬降 │ │
│  ┌──────────────────┐   └─────┘ │
│  │      软降 ↓       │  ┌─────┐ │
│  └──────────────────┘  │旋转 │ │
│                        └─────┘ │
└─────────────────────────────────┘
```

| 按键 | 触发方式 | 连发 |
|------|----------|------|
| ← / → | TOUCH_START 立即移动 1 格 | 160ms 后每 50ms 一次 |
| 旋转 | TOUCH_END 触发一次 | 无 |
| 软降 | 按住持续 | 每 40ms 下一行 |
| 硬降 | TOUCH_END 触发一次 | 无 |

- 连发计时器写在 `update(dt)` 中，**不用 `scheduleOnce`**
- 必须处理 `TOUCH_CANCEL`（手指滑出按钮）→ 立即停止连发、恢复按钮常态
- 按下态：缩放 0.94 + 变暗，松开/CANCEL 恢复
- 按键模式下**棋盘触摸不做任何事**，避免两种模式行为混杂

### 3.4 输入层架构

游戏逻辑只认动作，不认输入设备：

```typescript
export enum TetrisAction {
    Left, Right, RotateCW, RotateCCW,
    SoftDropStart, SoftDropEnd,
    HardDrop, Hold,
}

export interface ITetrisInput {
    enable(): void;
    disable(): void;   // 必须清空手势/连发/软降等一切中间状态
}
```

- `GestureInput`：监听全屏 `GestureLayer` 的四个触摸事件
- `ButtonInput`：监听六个按钮节点
- `TetrisGame.setControlMode(mode)`：先 `old.disable()`，再 `new.enable()`，最后写存储
- **切模式必须清状态**，否则会出现"切回来还在软降/连发"的鬼影

### 3.5 触摸命中层级

Cocos 的触摸只会派发到注册了监听器的节点，按渲染层级取最上层：

```
Canvas
├── Background            （无监听，不拦触摸）
├── BoardRoot             （无监听）
├── GestureLayer          ← 全屏透明，手势模式才 enable
├── Hud                   （暂停按钮、暂存面板有监听，压在手势层之上）
├── ButtonLayer           ← 按键模式才 active
└── Panels                （暂停/教程/结算，全屏背景带拦截监听）
```

- 暂停按钮、暂存面板必须是 `GestureLayer` **之后的兄弟节点**，否则手势层会把触摸吞掉
- 面板根节点的全屏背景要挂 `TOUCH_START` 拦截，防止点击穿透到手势层
- 所有可点击元素统一用 `@property({ type: Node })` + `Node.EventType`（红线 3），不用 `@property(Button)`

---

## 4. 新手引导与模式说明

### 4.1 首次进入

`tutorial_done` 未设置时：

1. 游戏进入 `READY` 状态，重力暂停
2. 弹出 `TutorialPanel`，标题「推荐：全屏手势」
3. 三行图示 + 文案（箭头用 `Graphics` 画，**不用 emoji**，避免 VS16 渲染成方框，红线 10）：
   - 左右拖动 — 移动方块
   - 轻点 — 顺时针旋转
   - 按住下拖 — 加速下落；快速下甩 — 直接落地
4. 补充说明（小字）：「双指点按 = 逆时针旋转」「点左侧「暂存」= 保存当前方块」
5. 主按钮「开始游戏」；次按钮「我习惯按键操作」→ 切到按键模式并把教程内容换成按键说明
6. 关闭时写入 `tutorial_done = 1`

### 4.2 渐进式提示

- 底部 `HintBar` 显示三个未完成的手势提示，半透明、**不挂监听**（不能拦手势）
- 玩家第一次完成某个手势 → 该条提示降到 40% 透明度（不用 ✓ 字符）
- 三条全部完成或累计 3 局后自动隐藏，写入 `hint_used`
- 按键模式下显示对应文案：「长按 ← → 连续移动」「按住 ↓ 加速下落」

### 4.3 再次查看

暂停面板 → 「操作说明」重新打开 `TutorialPanel`（内容按当前模式渲染）。
暂停面板 → 「操作方式」单选：全屏手势（推荐）/ 虚拟按键，切换后立即生效并落盘。

### 4.4 文案要求

- 全屏手势模式下，设置项文案必须写明「推荐」，并给一句理由：「手指不挡落点，移动更准」
- 首次切到按键模式时提示一次：「按键模式会影响棋盘高度」
- 所有图标用 Graphics 或纯文字，禁止 emoji / 变体选择符

---

## 5. 界面与视觉

### 5.1 分辨率与适配

- 设计分辨率 720×1280（与现有游戏一致），`fitWidth + fitHeight`
- 顶部用 `SafeAreaAdapter`，底部为 Home 指示条预留 40px
- 格宽运行时计算，不写死：
  ```typescript
  const visible = view.getVisibleSize();
  const cell = Math.floor(Math.min(
      (visible.width  - 240) / 10,
      (visible.height - 200 - BOTTOM_ZONE) / 20,
  ) / 2) * 2;   // 取偶数，方便居中
  // clamp(36, 56)
  ```
- `BOTTOM_ZONE`：手势模式 120，按键模式 300。**一次布局按按键模式算**，切换模式不再改变棋盘尺寸（否则方块尺寸跳变，操作手感割裂）

### 5.2 布局

```
┌──────────────────────────────────┐ 720
│ [⏸]        分数 12,340           │  HUD（安全区下方）
│            等级 5 · 行 48         │
│ ┌────┐                  ┌─────┐  │
│ │暂存│   ┌──────────┐   │Next │  │
│ │ ▫  │   │          │   │ ▫   │  │
│ └────┘   │  10 × 20 │   │ ▫   │  │
│          │   棋盘    │   │ ▫   │  │
│          │          │   └─────┘  │
│          │          │            │
│          └──────────┘            │
│     [手势提示条 / 按键区]          │
└──────────────────────────────────┘
```

- 顶部右上是微信胶囊按钮区域，**保持空白**
- 暂存面板本身可点（= Hold），尺寸 120×120
- Next 显示 3 个，mini 格 24px
- 棋盘上方留 180、下方留 300（按键区），cell=40 时棋盘 400×800

### 5.3 配色

| 元素 | 颜色 |
|------|------|
| 背景 | `#0B1020` |
| 棋盘背景 | `#141B2E` |
| 网格线 | `#1F2942` |
| Ghost | 白色 16% |
| 当前列高亮 | 白色 6% |
| I / O / T / S / Z / J / L | `#22D3EE` `#FACC15` `#A855F7` `#22C55E` `#EF4444` `#3B82F6` `#F97316` |
| 主文字 / 次文字 | `#F8FAFC` / `#94A3B8` |
| 主按钮 / 危险按钮 | `#3B82F6` / `#EF4444` |
| 面板背景 | `#0F1628` 95% |

方块渲染：纯色 Sprite 染色 + 左上 2px 高光、右下 2px 暗边，做出轻微立体感。外观与现有 2048/贪吃蛇的暗色风格统一；后续想换像素风只需替换配色与贴图。

### 5.4 动效与反馈

| 事件 | 反馈 |
|------|------|
| 方块落地锁定 | 屏幕轻微震动 + 该方块闪一下（80ms） |
| 消行 | 行闪白 120ms → 收行 |
| 硬降 | 落点小范围粒子/缩放冲击（可选） |
| 等级提升 | HUD 等级数字放大回弹 |
| 震动 | `wx.vibrateShort({ type: 'light' })`，设置可关，`try/catch` 包裹 |

---

## 6. 场景与代码架构

### 6.1 文件结构

```
assets/games/game_tetris/
  scenes/
    Tetris.scene
  scripts/
    TetrisConfig.ts      // 常量：尺寸、颜色、速度表、计分表、SRS 表
    TetrisPieces.ts      // 方块定义、旋转、踢墙、7-bag（不 import cc）
    TetrisBoard.ts       // 棋盘数据 + 碰撞 + 收行
    TetrisGame.ts        // 主控：状态机、重力、锁定、计分、存档
    GestureInput.ts      // 全屏手势
    ButtonInput.ts       // 虚拟按键（含 DAS/ARR）
    HudPanel.ts          // 分数/等级/行数/暂存/Next 渲染
    PausePanel.ts        // 继续 / 操作方式 / 震动 / 操作说明 / 回大厅
    TutorialPanel.ts     // 新手引导
    GameOverPanel.ts     // 结算
    TetrisStorage.ts     // 最高分、设置、引导状态读写
```

**核心逻辑不依赖 `cc`**（`TetrisPieces` / `TetrisBoard` / `TetrisConfig`）：便于用页内探针或 Node 脚本直接构造棋盘做确定性验证，也让渲染层与规则层解耦。

### 6.2 组件职责

| 组件 | 职责 | 不负责 |
|------|------|--------|
| `TetrisGame` | 状态机、重力/锁延迟计时、动作分发、计分、存档调度 | 具体触摸解析、节点布局 |
| `TetrisBoard` | 网格数据、碰撞检测、合并、消行、Ghost 落点计算 | 渲染 |
| `TetrisPieces` | 方块形状、SRS 旋转与踢墙、7-bag | 棋盘状态 |
| `GestureInput` | 手势识别 → `TetrisAction` | 游戏规则 |
| `ButtonInput` | 按钮 + 连发 → `TetrisAction` | 游戏规则 |
| `HudPanel` | 分数/等级/行数/暂存/Next 显示 | 逻辑 |
| 面板类 | 显隐 + 回调，`show()` 内绑定事件（红线 6） | 游戏逻辑 |

### 6.3 状态机

```
READY ──开始──▶ PLAYING ──暂停──▶ PAUSED
                  │  ▲               │
                  │  └────继续───────┘
                  ├──消行──▶ CLEARING ──▶ PLAYING
                  └──顶出──▶ GAME_OVER ──重开──▶ READY
```

- `PAUSED` / `CLEARING` / `GAME_OVER` 时 `update()` 提前返回
- `CLEARING` 用 `update(dt)` 计时，不用 `scheduleOnce`
- `onDestroy()` 只清引用，不调用 `_cleanupGame()`，不访问任何 `@property(Node)`

### 6.4 `@property` 绑定清单

| 组件 | 属性 | 类型 | 节点 |
|------|------|------|------|
| TetrisGame | `boardRoot` | Node | `Canvas/GameLayer/BoardRoot` |
| | `blockLayer` | Node | `Canvas/GameLayer/BoardRoot/Blocks` |
| | `ghostLayer` | Node | `Canvas/GameLayer/BoardRoot/Ghost` |
| | `columnHighlight` | Node | `Canvas/GameLayer/BoardRoot/ColumnHighlight` |
| | `gestureLayer` | Node | `Canvas/GestureLayer` |
| | `buttonLayer` | Node | `Canvas/ButtonLayer` |
| | `hintBar` | Node | `Canvas/HintBar` |
| | `pauseButton` | Node | `Canvas/Hud/PauseButton` |
| | `holdPanel` | Node | `Canvas/Hud/HoldPanel` |
| | `holdPreviewRoot` | Node | `Canvas/Hud/HoldPanel/Preview` |
| | `nextPreviewRoots` | `[Node]` | `Canvas/Hud/NextPanel/Preview0..2` |
| | `scoreLabel` | Label | `Canvas/Hud/ScoreLabel` |
| | `levelLabel` | Label | `Canvas/Hud/LevelLabel` |
| | `linesLabel` | Label | `Canvas/Hud/LinesLabel` |
| | `pausePanel` | PausePanel | `Canvas/Panels/PausePanel` |
| | `tutorialPanel` | TutorialPanel | `Canvas/Panels/TutorialPanel` |
| | `gameOverPanel` | GameOverPanel | `Canvas/Panels/GameOverPanel` |
| ButtonInput | `leftButton` / `rightButton` | Node | `Canvas/ButtonLayer/Left` `/Right` |
| | `rotateButton` / `softDropButton` / `hardDropButton` | Node | 同上 |
| | `onAction` | 回调 | 由 TetrisGame 注入 |

MCP 绑定注意（教训 E）：`Label`/组件引用用 `propertyType:'component'` + **节点 UUID**；`Node` 用节点 UUID；可点击元素一律 `Node`。

### 6.5 调试接口

为浏览器验证暴露只读/构造接口（仅 `DEBUG` 常量开启时挂载）：

```typescript
game.__debug = {
    getState: () => ({ grid, current, next, hold, score, lines, level, state }),
    setBoard: (rows: string[]) => void,   // 用字符串画棋盘，便于构造消行场景
    spawn: (type: PieceType) => void,
    setMode: (mode: 'gesture' | 'button') => void,
    getInputState: () => ({ softDrop, column, repeatTimers }),
};
```

---

## 7. 存储

走公共 `StorageManager.instance`，键前缀 `tiny_games_tetris_`：

| key | 类型 | 说明 |
|-----|------|------|
| `best_score` | number | 历史最高分 |
| `best_lines` | number | 单局最高消行 |
| `control_mode` | `gesture` / `button` | 默认 `gesture` |
| `vibrate` | `0` / `1` | 默认 `1` |
| `tutorial_done` | `0` / `1` | 首局引导 |
| `hint_used` | JSON 数组 | `["move","rotate","drop"]` |
| `games_played` | number | 用于提示条自动隐藏 |

游戏 id 在 `GameConfig.ts` 注册：

```typescript
{ id: 'tetris', name: '方块坠落', icon: 'default', sceneName: 'Tetris', description: '经典方块消除' }
```

---

## 8. 微信小游戏适配

| 项目 | 做法 |
|------|------|
| 切后台 | `game.on(Game.EVENT_HIDE)` → 暂停；`EVENT_SHOW` 后**不自动继续**，显示暂停面板 |
| 常亮 | `wx.setKeepScreenOn({ keepScreenOn: true })`，`try/catch` |
| 震动 | `wx.vibrateShort({ type: 'light' })`，设置可关，`try/catch` |
| 胶囊按钮 | 顶部 HUD 右上 160×80 区域留空 |
| 安全区 | 顶部 `SafeAreaAdapter`，底部预留 40px |
| 图标 | 一律 Graphics/文字，产物中不得出现 `U+FE0E`/`U+FE0F`（红线 10） |
| 构建 | 交给开发者工具前跑 `node tools/check-wechat-build.js` |

---

## 9. 验收标准

### 9.1 功能

1. 7-bag：连开 14 块，每种恰好出现 2 次
2. 出生位置正确，新方块立刻可见；出生区被占 → 结算
3. SRS：T 贴左墙旋转能踢墙成功；I 在贴墙/贴地时旋转不穿模
4. 锁延迟：触底后 500ms 内移动/旋转可重置，最多 15 次
5. 硬降立即锁定，不再享受锁延迟
6. 消 1–4 行分值正确，等级每 10 行提升，重力按表加速
7. Ghost 落点与实际落点一致（含旋转后）
8. Hold 每块只能用一次；换出的方块回到出生位置
9. 结束条件：Block Out 与 Lock Out 都能触发结算
10. 最高分、模式、引导状态重启后保留

### 9.2 手势与双模式

11. 拖 1 格 → 移动 1 列；拖 5 格 → 撞墙后停在边界；拖回时无大段死区
12. 轻点 → 顺时针旋转；双指 → 逆时针旋转
13. 按住下拖 → 软降启动，松手停止
14. 快速下甩 → 硬降并立即锁定
15. 18px 以内的小幅抖动 → 旋转（"拖了个空"回退生效）
16. 拖拽中方块锁定 → 新方块从当前列开始，不继承旧位移，下拖软降继续
17. 设置切到按键模式 → 手势层失效、按键层出现、棋盘尺寸不变
18. 切回手势模式 → 无残留软降/连发状态
19. 按键模式：长按 ← 160ms 后开始连发；手指滑出按钮立刻停
20. 暂停/教程/结算面板打开时，棋盘手势无效
21. 节点销毁/切场景无报错，事件全部解绑

### 9.3 浏览器验证方法

1. `project_refresh_assets` → 重载预览 → `typeof comp.新方法 === 'function'` 确认新代码
2. 探针：
   ```js
   const g = cc.director.getScene().getChildByName('Canvas').getComponent('TetrisGame');
   g.__debug.getState()
   g.__debug.setBoard([
     '..........',
     '..........',
     '#########.',   // 缺一格，等 I 竖插
   ]);
   ```
3. **Playwright `drag` 结束派发的是 `TOUCH_CANCEL`**（手册 §11）：位移类断言用 drag，旋转/硬降断言用 `click`（`TOUCH_END`）
4. 点击坐标按设备像素传（CSS × `devicePixelRatio`），`k` 每轮现场标定（手册 §4）
5. 读数矛盾时先怀疑探针字段名/坐标换算

### 9.4 静态检查

- 纯逻辑自检：`node tools/verify-tetris-core.js`（SRS 四态/踢墙/7-bag/出生位置/消行/Ghost/计分）
- 编辑器自带 tsc：`node "$TSC" --noEmit`
- `git diff --stat` + 逐文件 `git diff` 确认范围
- `assets/` 内无变体选择符
- 微信构建前 `node tools/check-wechat-build.js`

---

## 10. 实施顺序

| 阶段 | 内容 | 产出 |
|------|------|------|
| M1 | 纯逻辑：棋盘、方块、SRS、7-bag、消行、计分 | `TetrisPieces` / `TetrisBoard` |
| M2 | 场景搭建（**全部走 MCP**）+ 注册 GameConfig | `Tetris.scene` |
| M3 | 渲染同步 + HUD + Ghost | 可看、可下落 |
| M4 | 手势输入 | 全屏手势可玩 |
| M5 | 按键输入 + 模式切换 | 双模式可玩 |
| M6 | 暂停/结算/存档/切后台 | 完整闭环 |
| M7 | 引导、提示条、动效与震动 | 可交付 |
| M8 | 浏览器逐项验收 + 微信构建预检 | 验收报告 |

**先做 M1 的理由**：规则层没有 `cc` 依赖，能在搭场景之前把旋转、消行、计分这些最容易出错的逻辑验证掉，避免在引擎里调试算法。

---

## 11. 风险与对策

| 风险 | 对策 |
|------|------|
| 自排期计时器被丢弃 → 重力/连发卡死（教训 F） | 所有周期逻辑用 `update(dt)` 累加 |
| 切模式后状态残留 | `disable()` 强制清空全部中间状态 |
| 手势与按钮命中冲突 | 分层兄弟节点，按钮/面板在手势层之上 |
| 拖动与点按互相吞掉（手册 §11.6） | "拖了个空"显式回退为旋转；CANCEL 不触发旋转 |
| 不同宽高比棋盘过大/过小 | 格宽运行时按可见区域计算，一次按按键模式定尺寸 |
| 微信端 emoji/VS16 变方框 | 图标全部 Graphics/文字，构建前扫描 |
| 顶部胶囊遮挡 HUD | 右上角留空 + SafeAreaAdapter |
| 帧率波动导致下落速度异常 | 重力用时间累加，不按帧计数；单帧 dt 上限 50ms |

---

## 12. 待定

- 游戏显示名最终定为「方块坠落」还是「落下方块」
- 是否需要左手/右手镜像按键布局（v1 不做，看反馈）
- 音效与背景音乐（v1 不做）
