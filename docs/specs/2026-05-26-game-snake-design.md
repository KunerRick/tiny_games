# 贪吃蛇 — 游戏设计文档（v3：完整版）

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
| 计分 | 显示蛇的长度（段数）和历史最高分 |

## 界面设计

### 4.1 主界面布局

```
┌─────────────────────────────────────┐
│  [←]    长度: 5    最佳: 12          │  ← 顶部导航栏（高度 100px）
├─────────────────────────────────────┤
│                                     │
│                                     │
│           [游戏区域]                 │  ← 蛇移动和吃光点
│         [光点] [蛇]                  │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

### 4.2 游戏结束弹窗

```
┌─────────────────────────────────────┐
│                                     │
│    ┌─────────────────────────┐      │
│    │       游戏结束          │      │
│    │                         │      │
│    │    最终长度: 15         │      │
│    │    历史最佳: 20         │      │
│    │                         │      │
│    │   [  再来一次  ]        │      │
│    │   [  返回大厅  ]        │      │
│    └─────────────────────────┘      │
│                                     │
└─────────────────────────────────────┘
```

### 4.3 颜色方案

| 元素 | 颜色值 | 说明 |
|------|--------|------|
| 游戏区域背景 | #696969 (深灰) | 蛇移动区域 |
| 蛇头 | #44C8FF (亮蓝) | 蛇头颜色 |
| 蛇身 | #32A0EB (蓝色) | 身体颜色 |
| 光点 | #64FF78 (亮绿) | 可吃光点 |
| 当前分数文字 | #FFFFFF (白色) | 顶部栏 |
| 最佳分数文字 | #FFD700 (金黄) | 顶部栏 |
| 结束面板卡片 | #FFFFFF (白色) | 半透明背景 |
| 结束面板标题 | #333333 (深灰) | "游戏结束" |
| 按钮-再来一次 | #2B6CB0 (蓝色) | 主按钮 |
| 按钮-返回大厅 | #718096 (灰色) | 次按钮 |

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
    StorageManager.ts         ← AI 写（本地存储管理）
```

### 组件职责

| 组件 | 职责 | 需要你绑定的 @property |
|------|------|----------------------|
| **SnakeGame** | 游戏状态管理、update 循环、触屏事件、计分、死亡判定、最高分管理 | `gameArea`、`currentScoreLabel`、`bestScoreLabel`、`gameOverPanel`、`finalScoreLabel`、`finalBestScoreLabel`、`restartBtn`、`backBtn`、`panelBackBtn` |
| **Snake** | 蛇身路径点队列、每帧根据路径移动、生长逻辑、转向处理 | 无（纯数据 + dynamically draw） |
| **FoodSpawner** | 在游戏区域内随机生成光点、吃后补充、保持 20-30 个在线 | 无（动态创建圆形节点） |
| **StorageManager** | 读写本地存储的最高分数据 | 无 |

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
  SnakeGame 更新 UI（分数、最高分）
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
├── UI_Overlay (Node)           # UI 层
│   ├── topBar (Node)           # 顶部信息栏
│   │   ├── backBtn (Button)    # 返回按钮
│   │   │   └── Label (Label)   # "←" 或 "返回"
│   │   └── scorePanel (Node)   # 分数面板
│   │       ├── currentScore (Label)  # "长度: 5"
│   │       └── bestScore (Label)     # "最佳: 12"
│   └── gameOverPanel (Node)    # 游戏结束面板，默认 active=false
│       ├── bg (Sprite)         # 黑色半透明遮罩，覆盖全屏
│       ├── card (Sprite)       # 白色圆角卡片
│       │   ├── title (Label)   # "游戏结束" (FontSize: 36, 粗体)
│       │   ├── finalScore (Label)    # "最终长度: 0" (FontSize: 28)
│       │   ├── bestScore (Label)     # "历史最佳: 0" (FontSize: 24, 金黄色)
│       │   ├── restartBtn (Button)   # "再来一次"
│       │   │   └── Label (Label)
│       │   └── backBtn (Button)      # "返回大厅"
│       │       └── Label (Label)
│       └── [其他装饰元素]
```

3. **节点详细参数：**

| 节点 | 父节点 | Position | Size | 颜色/其他 |
|------|--------|----------|------|----------|
| backBtn | topBar | (-320, 0) | 60×60 | 白色文字"←"或"返回" |
| scorePanel | topBar | (0, 0) | 400×60 | 透明 |
| currentScore | scorePanel | (-80, 0) | 180×40 | 白色 #FFFFFF, 28px |
| bestScore | scorePanel | (80, 0) | 180×40 | 金黄 #FFD700, 28px |
| gameOverPanel | UI_Overlay | (0, 0) | 720×1280 | 默认隐藏 |
| bg | gameOverPanel | (0, 0) | 720×1280 | 黑色 #000000, 透明度 180 |
| card | gameOverPanel | (0, 0) | 400×350 | 白色 #FFFFFF, 圆角 20px, 透明度 230 |
| title | card | (0, 100) | 200×50 | 深灰 #333333, 36px, 粗体 |
| finalScore | card | (0, 30) | 200×40 | 深灰 #333333, 28px |
| bestScore | card | (0, -30) | 200×40 | 金黄 #FFD700, 24px |
| restartBtn | card | (0, -100) | 200×60 | 蓝色 #2B6CB0, 白色文字 |
| backBtn (面板内) | card | (0, -170) | 200×50 | 灰色 #718096, 白色文字 |

4. **给 Canvas 添加 SnakeGame 脚本组件**（创建空组件后选择 SnakeGame 脚本）
5. **在 SnakeGame 组件上绑定 @property：**
   - `gameArea` → 拖入 gameArea 节点
   - `currentScoreLabel` → 拖入 currentScore Label 组件
   - `bestScoreLabel` → 拖入 bestScore Label 组件
   - `gameOverPanel` → 拖入 gameOverPanel 节点
   - `finalScoreLabel` → 拖入 finalScore Label 组件
   - `finalBestScoreLabel` → 拖入 bestScore (面板内) Label 组件
   - `restartBtn` → 拖入 restartBtn Button 组件
   - `backBtn` → 拖入顶部 backBtn Button 组件
   - `panelBackBtn` → 拖入面板内 backBtn Button 组件

## 存储数据结构

```typescript
// 存储键名
const STORAGE_KEY_SNAKE = 'tiny_games_snake_data';

interface SnakeStorageData {
    bestScore: number;  // 历史最高长度
}
```

## 开发检查点

完成以下检查点即表示贪吃蛇游戏开发完成：

- [ ] 项目能在 Cocos Creator 中正常打开
- [ ] 浏览器预览能显示游戏界面
- [ ] 触屏滑动能控制蛇转向
- [ ] 蛇能平滑移动并吃光点
- [ ] 吃光点后蛇身正确增长
- [ ] 撞墙后游戏结束
- [ ] 游戏结束面板正确显示最终分数和最高分
- [ ] "再来一次"按钮能重新开始游戏
- [ ] "返回大厅"按钮能返回主菜单
- [ ] 最高分正确保存和显示
- [ ] 所有代码已提交到 git

## 后续扩展点

| 扩展 | 说明 |
|------|------|
| 音效 | 添加吃光点、撞墙、游戏结束的音效 |
| 皮肤系统 | 支持更换蛇的颜色和样式 |
| 成就系统 | 达成特定长度解锁成就 |

---

*文档版本: v3*  
*更新日期: 2026-05-27*
