# 贪吃蛇 — 游戏设计文档

## 概述

经典贪吃蛇手机版，触屏滑动控制，在网格中移动、吃食物、避免撞墙或撞自己。

## 游戏规格

| 属性 | 值 |
|------|-----|
| 网格 | 20×18（宽×高） |
| 单元格大小 | 28px |
| 初始蛇长 | 3 格 |
| 移动方向 | 上下左右（触屏滑动） |
| 速度 | 初速 5 格/秒，每吃 5 个食物加速 0.3 格/秒，上限 10 格/秒 |
| 计分 | 每吃一个食物 +1 分 |
| 结束条件 | 撞墙 / 撞自己 |

## 架构

### 文件结构

```
assets/games/game_snake/
  scenes/
    Snake.scene          ← 你搭建
  scripts/
    SnakeGame.ts          ← AI 写（主控制器）
    Snake.ts              ← AI 写（蛇逻辑）
    FoodSpawner.ts        ← AI 写（食物生成）
```

### 组件职责

| 组件 | 职责 | 需要你绑定的 @property |
|------|------|----------------------|
| **SnakeGame** | 游戏状态管理、update 主循环、计分、游戏结束判定 | gridRoot（网格容器节点）、scoreLabel、gameOverNode（结束面板）、restartBtn |
| **Snake** | 蛇身节点管理、移动逻辑、方向控制、自碰检测 | 无（纯数据 + 动态创建色块节点） |
| **FoodSpawner** | 在空位随机生成食物、吃后重新生成 | 无（动态创建食物色块节点） |

### 数据流

```
用户滑动 → SnakeGame 监听 touch → 更新 Snake.direction
         ↓
update(dt):
  Snake.tick(dt):
    1. 计算前进方向
    2. 如果到下一个格子的时间到了 → 移动一步
    3. 检测吃食物 → SnakeGame.onEat()
    4. 检测碰撞 → SnakeGame.onDeath()
  FoodSpawner 空闲时刷新
         ↓
  SnakeGame 更新 UI（分数、Game Over 面板）
```

## 你需要搭建的场景（Snake.scene）

**操作说明：**

1. 新建空场景，命名为 `Snake`
2. 创建以下节点结构：

```
Snake (Canvas)
├── gridRoot (Node)             # 网格容器，所有蛇身和食物的父节点
│   └── [动态创建色块]          # AI 代码动态生成
├── scoreLabel (Label)          # 左上角显示 "分数: 0"
│   ├── FontSize: 24
│   └── Position: (0, 350)
├── gameOverNode (Node)         # 游戏结束面板，默认隐藏
│   ├── bg (Sprite, 黑色半透明)
│   ├── title (Label) "游戏结束"
│   ├── finalScore (Label) "得分: 0"
│   └── restartBtn (Button) "重新开始"
│       └── btnLabel (Label)
└── touchArea (Node)            # 全屏触控区域，挂 UITransform 填满 Canvas
```

3. **在 SnakeGame 组件上绑定 @property：**
   - `gridRoot` → 拖入 gridRoot 节点
   - `scoreLabel` → 拖入 scoreLabel
   - `gameOverNode` → 拖入 gameOverNode
   - `restartBtn` → 拖入 restartBtn 节点上的 Button 组件

## 代码逻辑（AI 负责）

### SnakeGame.ts

- `onLoad()`: 初始化游戏，创建 Snake + FoodSpawner
- `update(dt)`: 驱动游戏循环
- 监听 touch 事件（在 gridRoot 或 Canvas 上监听触屏滑动）
- 管理分数和游戏结束状态

### Snake.ts

- 蛇身：由节点数组表示，head 是 index 0
- `tick(dt)`: 时间驱动移动
- `grow()`: 增加长度
- `checkCollision()`: 检测撞墙和撞自己

### FoodSpawner.ts

- `spawn()`: 在网格空位随机生成一个食物
- 食物用色块节点表示（绿色圆圈或方块）
