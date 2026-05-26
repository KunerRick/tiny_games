# 贪吃蛇 — 游戏设计文档（v2：平滑移动版）

## 概述

受《贪吃蛇大作战》启发，手机触屏平滑拖拽操控。单人模式，在地图中吃光点长大，撞墙结束。

## 核心设计

| 属性 | 值 |
|------|-----|
| 操控方式 | 手指在屏幕上滑动 → 蛇头跟随手指方向转向 |
| 移动方式 | 头持续前进，身体沿轨迹追踪，平滑无格子 |
| 碰自己 | **不会死**（蛇身可从中间穿过） |
| 碰墙 | **死亡** |
| 生长 | 每吃 3 个光点增长一段 |
| 光点刷新 | 地图上始终存在 20-30 个随机光点 |
| 结束条件 | 蛇头碰到墙壁边界 |
| 游戏区域 | 720×1280 竖屏视野内移动 |
| 计分 | 显示蛇的长度（段数） |

## 架构

### 文件结构

```
assets/games/game_snake/
  scenes/
    Snake.scene              ← 你搭建
  scripts/
    SnakeGame.ts              ← AI 写（主控制器 + 游戏循环）
    Snake.ts                  ← AI 写（蛇逻辑：移动/生长/绘制）
    FoodSpawner.ts            ← AI 写（光点生成/管理）
```

### 组件职责

| 组件 | 职责 | 需要你绑定的 @property |
|------|------|----------------------|
| **SnakeGame** | 游戏状态管理、update 循环、触屏事件、计分、死亡判定 | `scoreLabel`、`gameOverNode`、`restartBtn`、`gameArea` |
| **Snake** | 蛇身路径点队列、每帧根据路径移动、生长逻辑、转向处理 | 无（纯数据 + dynamically draw） |
| **FoodSpawner** | 在游戏区域内随机生成光点、吃后补充、保持 20-30 个在线 | 无（动态创建圆形节点） |

### 蛇的移动原理（Boids 风格路径追踪）

```
蛇头：向前持续移动，每帧根据当前方向小幅推进
  bodySegment[0] = 蛇头位置
  bodySegment[1] = 延迟 N 帧的蛇头历史位置
  bodySegment[2] = 延迟 2N 帧的蛇头历史位置
  ...

  实际上：维护一个「位置历史队列」
          - 每帧将蛇头当前位置 push 到队列
          - 第 i 段身体 = 队列中第 i * SEGMENT_DIST 个位置
          - 吃光点时：增加 SEGMENT_DIST 值（让身体变长）或记录 extra 段数
```

更具体的说：
1. **蛇头**：每帧朝当前方向移动 `speed * dt` 像素，`direction` 由触屏滑动角度决定
2. **路径记录**：每帧把蛇头位置存到一个数组 `_path[]`
3. **蛇身绘制**：第 i 段身体的位置 = `_path[_path.length - 1 - i * segmentGap]`
4. **生长**：吃 3 个光点后，`segmentGap` 不变，但 `_headSegments` 计数 +1 段

### 触屏控制

- 在 `gameArea` 上监听 `TOUCH_MOVE` 事件
- 每次 touch move 计算当前触摸点与蛇头的角度差
- 蛇头方向平滑转向目标角度（最大转向角限制，防止瞬转）

### 数据流

```
用户滑动 → SnakeGame.onTouchMove → 更新 targetAngle
         ↓
update(dt):
  Snake.tick(dt, targetAngle):
    1. 蛇头方向朝 targetAngle 平滑转向
    2. 蛇头沿方向前进 speed * dt
    3. 蛇头位置入历史队列
    4. 绘制蛇身（从历史队列取点）
  FoodSpawner 检测蛇头与光点碰撞
    → 命中：蛇长大 + 计分 + 刷新光点
  SnakeGame 检测蛇头是否超出边界
    → 越界：游戏结束
  SnakeGame 更新 UI（分数）
```

## 你需要搭建的场景（Snake.scene）

**操作说明：**

1. 新建空场景，命名为 `Snake`
2. 创建以下节点结构：

```
Snake (Canvas, DesignSize 720×1280)
├── gameArea (Node)             # 游戏区域，蛇和食物都挂在这个节点下
│   ├── [光点]  ← 动态创建
│   └── [蛇身]  ← 动态创建
├── topBar (Node)               # 顶部信息栏
│   └── scoreLabel (Label)      # 显示 "长度: 5"（初始5段）
│       ├── FontSize: 28
│       ├── Position: (0, 350)
│       └── 水平居中
├── gameOverNode (Node)         # 游戏结束面板，默认 active=false
│   ├── bg (Sprite, 黑色半透明，覆盖全屏)
│   ├── title (Label) "游戏结束" (FontSize: 40, 粗体)
│   ├── finalScore (Label) "长度: 0" (FontSize: 28)
│   └── restartBtn (Button) "再来一次"
│       └── btnLabel (Label)
```

3. **给 Canvas 添加 SnakeGame 脚本组件**（创建空组件后选择 SnakeGame 脚本）
4. **在 SnakeGame 组件上绑定 @property：**
   - `gameArea` → 拖入 gameArea 节点
   - `scoreLabel` → 拖入 scoreLabel
   - `gameOverNode` → 拖入 gameOverNode（结束面板节点）
   - `restartBtn` → 拖入 restartBtn 节点上的 Button 组件

## 需要你做的

1. 在 Cocos Creator 中创建 `Snake.scene`
2. 按上述节点结构建好场景树
3. 在 SnakeGame 组件上拖拽绑定 @property
4. 告诉我场景做好了，我写代码逻辑

## 我来写的代码

| 文件 | 内容 |
|------|------|
| `SnakeGame.ts` | 游戏主循环、触屏事件、碰撞检测（光点 + 墙壁）、游戏状态管理 |
| `Snake.ts` | 蛇头移动逻辑、路径历史队列、蛇身绘制、转向控制、生长 |
| `FoodSpawner.ts` | 光点在地图随机位置生成、保持数量、碰撞响应 |
