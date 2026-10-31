# 砖块远征（Brick Breaker）— 游戏设计文档

**日期**: 2026-10-31
**版本**: v1.0
**状态**: 设计中
**代号**: `brick` / 场景 `BrickBreaker` / 目录 `assets/games/game_brick/`

---

## 1. 概述

经典打砖块 + 轻肉鸽：挡板接球打碎砖块，每清空一关从三个升级里选一个，越打越离谱。

**核心目标**

- **一根手指就能玩**：横移挡板跟随手指，点击发球，没有双指、没有精确瞄准
- **每关一个决策**：三选一升级，选择本身构成策略（进攻 / 容错 / 控制）
- **无限关**：难度随关数增长，目标是活得更久、分更高
- **零美术**：全部用 `Graphics` 绘制，与现有五款保持一致

**非目标（v1 不做）**

- 道具掉落动画、Boss 关、皮肤、排行榜、音效
- 多指同时操作
- 关卡编辑器 / 固定关卡表

---

## 2. 核心玩法

### 2.1 单局流程

```
ready（球粘在挡板上）
  → 点击发球
playing（球飞、砖块碎、球掉落）
  → 清空全部砖块 → level_clear → 三选一升级 → 下一关
  → 球全部掉出底部 → 生命 −1 → 回到 ready（升级保留）
  → 生命为 0 → game_over
```

- 生命初始 3，`extra_life` 升级可增加（上限 6）
- 多球时**所有球都掉出**才扣生命
- 暂停：`playing` 状态可暂停，`level_clear` 升级不可跳过

### 2.2 坐标系

纯逻辑层（`BrickCore.ts`）使用**独立的局部坐标系**，与 Cocos 节点解耦：

| 属性 | 约定 |
|------|------|
| 原点 | 游戏区**左上角** |
| x | 向右为正，`[0, PLAY_W]` |
| y | **向下为正**，`[0, PLAY_H]` |
| 单位 | 设计像素（720 宽基准） |

渲染层负责把局部坐标映射到节点本地坐标：`nodeX = x - PLAY_W/2`，`nodeY = PLAY_H/2 - y`。

| 常量 | 值（设计 px） | 说明 |
|------|---------------|------|
| `PLAY_W` | 660 | 游戏区宽 |
| `PLAY_H` | 860 | 游戏区高 |
| `BALL_R` | 12 | 球半径 |
| `PADDLE_W` | 140 | 挡板初始宽 |
| `PADDLE_H` | 18 | 挡板高 |
| `PADDLE_BOTTOM_MARGIN` | 44 | 挡板底边距游戏区底部 |
| `BRICK_COLS` | 7 | 砖块列数 |
| `BRICK_W` | 86 | 砖块宽 |
| `BRICK_H` | 32 | 砖块高 |
| `BRICK_GAP_X` | 8 | 列间距 |
| `BRICK_GAP_Y` | 8 | 行间距 |
| `BRICK_TOP` | 24 | 第一行砖块顶部 y |

砖块网格总宽 `7×86 + 6×8 = 650`，水平居中（左右各留 5）。

### 2.3 球

- 基础速度 `620 px/s`，每关 +25，上限 `900`
- 发球角度：与竖直方向夹角在 `[-30°, 30°]` 内随机（向上）
- 挡板反弹角度由**命中位置**决定：

```
offset = clamp((ball.x - paddle.x) / (paddle.w / 2), -1, 1)
angle  = offset × maxBounceAngle        // 基础 60°，narrow_angle 每级 −8°
vx = speed × sin(angle)
vy = -speed × cos(angle)                // y 向下为正，向上是负
```

- 物理推进使用**固定子步长** `1/240 s`，避免高速穿砖（620 px/s 时每步约 2.6 px，远小于半径 12）
- 防呆：球速几乎水平（`|vy| < 60 px/s`）持续 1.0 s 时，给 `vy` 一个 ±120 的推力，避免无限横向弹跳

### 2.4 砖块

| 类型 | 外观 | 耐久 | 规则 |
|------|------|------|------|
| `normal` | 圆角矩形，按剩余耐久着色 | 1–3 | 耐久归零即碎 |
| `tough` | 深色边框 + 更亮内芯 | 2–3 | 与 normal 同规则，仅生成权重不同 |
| `bomb` | 带「炸」字/十字标记 | 1 | 被击碎时对周围 3×3 内所有砖块造成 1 点伤害（可连锁引爆） |

- 伤害：球命中造成 `ballDamage`（基础 1）；激光子弹造成 1
- 同一步长内同一砖块最多受 1 次伤害
- 穿透（`pierce`）生效时：命中普通砖**不反弹**，但**对 `tough`/`bomb` 仍然反弹**（避免穿透过强无脑）
- 穿透期间对同一砖块有 `0.15 s` 的忽略窗口，防止同一块砖被连续打爆

### 2.5 计分

```
基础分 = 10 × 砖块最大耐久
连击倍率 = 1 + 0.1 × combo           // combo 为连续击碎数
得分 = round(基础分 × 连击倍率 × scoreMultiplier)
```

- `combo` 在**球碰到挡板时清零**，击碎砖块时 +1（相同子步内多块累加）
- 最高分持久化：`tiny_games_brick_highScore`
- 总局数：`tiny_games_brick_runs`

### 2.6 关卡生成

第 `N` 关（N 从 1 开始）：

| 参数 | 规则 |
|------|------|
| 行数 | `min(3 + floor((N-1)/2), 8)` |
| 每格保留概率 | 第 0 行必留；其余行 `1 - min(0.12, 0.02×N)` 的概率挖空 |
| 耐久 | `hp = 1`，另按 `toughChance = min(0.5, 0.05 + 0.05×N)` 概率为 2；N ≥ 8 时再按 `0.15` 概率为 3 |
| bomb 数量 | `min(1 + floor(N/3), 4)`，随机落在空位 |
| 保底 | 至少存在 1 块可击碎砖；生成后校验，不足则补在第一行中央 |
| 随机源 | `mulberry32(seed)`，`seed = runSeed × 1000 + N`，保证可复现 |

### 2.7 升级（三选一）

每次过关后从**未满级**的升级里按权重抽 3 个不重复项。抽到的卡片包含名称、描述、当前等级。

| id | 名称 | 效果 | 上限 | 权重 |
|----|------|------|------|------|
| `paddle_widen` | 加宽挡板 | 挡板宽 +18 px | 6 | 10 |
| `extra_ball` | 多一颗球 | 当前关立即多一颗球，之后每关发球 +1（上限 5） | 4 | 9 |
| `pierce` | 穿透 | 球命中普通砖不反弹，可叠 2 层（每层延长忽略窗口） | 2 | 6 |
| `laser` | 激光挡板 | 每 `1.0 / (1 + 0.35×lv)` 秒从挡板两端发射子弹 | 3 | 7 |
| `split` | 分裂球 | 击碎砖块时 `20%×lv` 概率分裂出一颗球（场上上限 6） | 3 | 6 |
| `explosive` | 爆炸球 | 球命中砖块时，对周围 3×3 的其它砖块造成与升级等级相同的溅射伤害（1/2 点） | 2 | 5 |
| `sticky` | 粘性挡板 | 球碰到挡板后粘住，点击再次发球 | 1 | 5 |
| `score_mult` | 得分倍率 | 得分 ×1.25（叠乘） | 6 | 8 |
| `extra_life` | 额外生命 | 生命 +1（立即生效） | 3 | 4 |
| `slow_ball` | 减速 | 球速 −60 px/s，最低 420 | 3 | 7 |
| `narrow_angle` | 收束反弹 | 挡板最大反弹角 −8° | 3 | 7 |
| `ball_damage` | 强化球 | 球对砖块伤害 +1 | 2 | 5 |

**升级保留规则**：跨关保留，球掉落后也保留；仅 `extra_ball` 的「本关多一颗球」在下一关重新按总层数发球。

### 2.8 激光

- 激光子弹从挡板左右两端各发一颗，宽 4 px、高 14 px，速度 900 px/s 向上
- 命中第一块砖造成 1 点伤害后消失；命中即消耗该砖的「本步一次伤害」额度
- 子弹飞出顶部（`y < -20`）后移除

### 2.9 状态机与事件

渲染层通过 `popEvents()` 消费事件做特效/音效/震动，核心不持有任何 Cocos 对象。

| 事件 | 载荷 | 用途 |
|------|------|------|
| `brick_hit` | `x, y, hp, maxHp, kind` | 命中闪白、碎屑 |
| `brick_destroy` | `x, y, kind` | 爆裂粒子、连击飘字 |
| `paddle_hit` | `x, y` | 挡板压缩动画 |
| `wall_hit` | `x, y` | 轻微闪白（可选） |
| `laser_fire` | `x, y` | 激光音效 |
| `ball_lost` | `x, y` | 震动 |
| `life_lost` | `livesLeft` | HUD 更新 |
| `level_clear` | `level` | 进入升级界面 |
| `game_over` | `score, level` | 结算面板 |

核心状态：`ready` / `playing` / `level_clear` / `game_over`。暂停由渲染层自己停 `step()` 实现，核心不感知。

---

## 3. 输入

| 操作 | 行为 |
|------|------|
| 手指在游戏区内横向拖动 | 挡板中心跟随手指 x（带 `12 px` 平滑，不瞬移） |
| 点击（`TOUCH_END` 位移 < 12 px） | `ready` 状态发球；`sticky` 且球粘住时发球 |
| 松手 / `TOUCH_CANCEL` | 挡板停在当前位置，不触发发球 |

- 监听挂在覆盖整个游戏区的节点上；桌面下拖拽结束会派发 `TOUCH_CANCEL`，必须与 `TOUCH_END` 同样处理为「结束拖拽」，但**都不发球**（发球只认点击判定）
- 挡板目标位置 clamp 到 `[PADDLE_W/2, PLAY_W - PADDLE_W/2]`，避免半个挡板出界
- 球粘在挡板上时，球位置跟随挡板

---

## 4. 表现（Graphics）

| 元素 | 画法 |
|------|------|
| 背景 | 深蓝底 + 竖向实心细矩形网格（1 px），不用 `stroke`（见踩坑 §4.5） |
| 砖块 | `roundRect(x, y, w, h, 6)` + `fill`；耐久 3 亮、2 中、1 暗 |
| bomb 砖 | 底色 + 中央 8 px 十字（两根实心矩形） |
| 球 | `circle` + `fill`，外圈一道 2 px 亮环（用两个圆叠加而非 stroke） |
| 挡板 | `roundRect` + `fill`，两端各一个亮色小方块表示激光口 |
| 激光 | 实心矩形 |
| 飘字/粒子 | 渲染层自建短生命周期节点池（上限 60），不进入纯逻辑 |

色板沿用深海蓝底：底 `#151E33`、砖块按耐久 `#4EA8FF / #7C6CFF / #FFB547`、炸弹 `#FF6B6B`、球 `#FFFFFF`、挡板 `#6EE7FF`。

---

## 5. 场景结构（MCP 搭建）

设计分辨率 720×1280（`fitWidth` + `fitHeight`）。`PlayArea` 660×860 放在 `(0, -70)`：上沿 +360、下沿 -500，顶部留出 HUD 空间。

```
BrickBreaker (Canvas)
├── Camera
├── GameRoot                              [BrickGame 组件]  位置 (0,0)
│   ├── PlayArea                          UITransform 660×860，锚点 0.5/0.5，位置 (0,-70)
│   │   ├── Background                    [Graphics] → backgroundLayer
│   │   ├── BrickLayer                    [Graphics] → brickLayer
│   │   ├── EffectLayer                   [Graphics] → effectLayer
│   │   └── InputArea                     UITransform 660×860 → inputArea（不挂渲染组件）
│   ├── HudTop                            位置 (0, 520)
│   │   ├── ScoreLabel                    [Label] → scoreLabel
│   │   ├── LivesLabel                    [Label] → livesLabel
│   │   ├── LevelLabel                    [Label] → levelLabel
│   │   ├── ComboLabel                    [Label] → comboLabel
│   │   └── GuideLabel                    [Label] → guideLabel（提示"拖动挡板 · 点击发球"）
│   ├── PauseButton                       位置 (280, 560)，UITransform 96×96 → pauseButton
│   │   └── Label                         "暂停"
│   ├── PausePanel                        active=false → pausePanel
│   │   ├── Dim                           UITransform 720×1280，深色半透明
│   │   ├── Title                         [Label] "已暂停"
│   │   ├── ResumeButton                  → pauseResumeButton（子节点 Label "继续"）
│   │   ├── RestartButton                 → pauseRestartButton（"重开"）
│   │   └── LobbyButton                   → pauseLobbyButton（"返回大厅"）
│   ├── UpgradePanel                      active=false → upgradePanel
│   │   ├── Dim
│   │   ├── Title                         [Label] "选择一项升级"
│   │   ├── Card0                         UITransform 560×120 → upgradeCard0
│   │   │   └── Text                      [Label] → upgradeText0（两行：名称+等级 / 描述）
│   │   ├── Card1                         → upgradeCard1 / upgradeText1
│   │   └── Card2                         → upgradeCard2 / upgradeText2
│   └── GameOverPanel                     active=false → gameOverPanel
│       ├── Dim
│       ├── Title                         [Label] "本局结束"
│       ├── ScoreLabel                    [Label] → gameOverScoreLabel
│       ├── BestLabel                     [Label] → gameOverBestLabel
│       ├── LevelLabel                    [Label] → gameOverLevelLabel
│       ├── RestartButton                 → gameOverRestartButton（"再来一局"）
│       └── LobbyButton                   → gameOverLobbyButton（"返回大厅"）
└── BackButton                            [BackButton 组件]
```

**绑定注意**

- `BrickGame` 的节点属性全部 `@property({ type: Node })`，点击走 `Node.EventType.TOUCH_END`（红线 3）；按钮节点**不需要** `Button` 组件，但必须有 `UITransform` 尺寸才接收触摸
- Label 属性用 `@property({ type: Label })`，MCP 绑定时 `propertyType: 'component'`、传**节点** UUID（踩坑手册 §3.5 ①）
- 三张升级卡与各按钮的 `TOUCH_END` 在 `showXxxPanel()` 里绑定、隐藏时不再重复绑定（防崩溃守则 6）
- `onDestroy()` 只用 `_cachedNodes` 里的缓存节点解绑，不访问 `@property`（红线 4）
- `InputArea` 与各面板是**兄弟节点**，面板弹起时点卡片不会穿透到触摸区
- 关卡内 `Graphics` 由代码每帧重绘，场景里三个 Graphics 节点**不要**手画任何内容

**搭建顺序（必须在主工作区执行）**

1. 主工作区打开编辑器，MCP `scene_create_scene` → 存为 `assets/games/game_brick/scenes/BrickBreaker.scene`
2. 按上表建节点、挂 `Graphics` / `Label` / `BrickGame`，逐项绑属性（`begin_undo_recording` → 建 → `end_undo_recording`）
3. `debug_validate_scene` + 保存；刷新资产库
4. `GameConfig.GAME_LIST` 注册 `{ id: 'brick', name: '砖块远征', sceneName: 'BrickBreaker' }`
5. `node tools/sync-build-scenes.js`（先退出编辑器）
6. 预览验证 → `node tools/check-wechat-build.js`

> 工作区限制：MCP 绑定的是主 checkout 的编辑器，场景搭建无法在 worktree 内完成。

---

## 6. 存档

| 键 | 类型 | 说明 |
|----|------|------|
| `tiny_games_brick_highScore` | number | 历史最高分 |
| `tiny_games_brick_runs` | number | 总局数 |
| `tiny_games_brick_bestLevel` | number | 最高到达关数 |

---

## 7. 验收标准

- [ ] `node tools/verify-brick-core.js` 全绿（碰撞、反射、弹射角、耐久、爆炸、关卡生成、升级、生命、激光、粘性、防穿模、防呆）
- [ ] 浏览器预览：点击发球 → 横移接球 → 清关 → 三选一 → 下一关 → 暂停/继续 → 掉光生命 → 结算 → 返回大厅
- [ ] 连续 3 关无卡死；球横向弹跳 1 s 内被防呆修正
- [ ] 桌面下拖拽松手（`TOUCH_CANCEL`）不会误发球
- [ ] `npx tsc --noEmit` 通过
- [ ] `node tools/check-wechat-build.js` 9 项通过

---

## 8. 后续可做（v2）

- 固定手搓关卡 + 关卡内剧情气泡
- 升级重掷 / 跳过换金币
- 每日挑战（固定 seed）
- 道具砖（掉球/掉护盾）
