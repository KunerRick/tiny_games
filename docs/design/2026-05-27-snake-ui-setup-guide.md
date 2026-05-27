# 贪吃蛇游戏 UI 场景搭建指南（深色科技风）

**版本**: v1.0  
**日期**: 2026-05-27  
**主题**: 深色科技风（Dark Tech Theme）

---

## 一、整体配色方案

### 1.1 主色调

| 用途 | 颜色值 | RGB | 预览 |
|------|--------|-----|------|
| 游戏区域背景 | #1A1A2E | 26, 26, 46 | 深紫黑 |
| 顶部栏背景 | #00000066 | 0, 0, 0, 102 | 半透明黑 |
| 当前长度（霓虹青） | #00D9FF | 0, 217, 255 | 霓虹青 |
| 历史最佳（金黄） | #FFD700 | 255, 215, 0 | 金黄 |
| 蛇头 | #00F5FF | 0, 245, 255 | 亮青 |
| 蛇身 | #00B8C4 | 0, 184, 196 | 青色 |
| 光点 | #39FF14 | 57, 255, 20 | 荧光绿 |
| 结束面板背景 | #16213E | 22, 33, 62 | 深蓝灰 |
| 主按钮（再来一次） | #00D9FF | 0, 217, 255 | 霓虹青 |
| 次按钮（返回大厅） | #4A5568 | 74, 85, 104 | 灰蓝 |
| 白色文字 | #FFFFFF | 255, 255, 255 | 纯白 |
| 灰色文字 | #A0AEC0 | 160, 174, 192 | 灰蓝 |

---

## 二、节点结构

### 2.1 完整节点树

```
Canvas (DesignSize 720×1280)
├── gameArea (Node)                    # 游戏区域
│   ├── UITransform                    # Size: 720×1280
│   └── Sprite (背景色: #1A1A2E)       # 深紫黑背景
├── UI_Overlay (Node)                  # UI 层
│   ├── topBar (Node)                  # 顶部栏（高度 80px）
│   │   ├── UITransform                # Size: 720×80
│   │   ├── Sprite (背景)              # 颜色: #000000, Opacity: 102
│   │   ├── backBtn (Button)           # 返回按钮
│   │   │   ├── UITransform            # Size: 60×60, Position: (-320, 0)
│   │   │   └── Label                  # "←", 白色, 28px
│   │   └── scorePanel (Node)          # 分数面板
│   │       ├── UITransform            # Size: 400×60, Position: (0, 0)
│   │       ├── currentScore (Label)   # 当前长度
│   │       │   ├── UITransform        # Size: 180×40, Position: (-80, 0)
│   │       │   └── Label              # "长度: 5", 霓虹青 #00D9FF, 32px, Bold
│   │       └── bestScore (Label)      # 历史最佳
│   │           ├── UITransform        # Size: 180×40, Position: (80, 0)
│   │           └── Label              # "最佳: 12", 金黄 #FFD700, 28px
│   └── gameOverPanel (Node)           # 游戏结束面板（默认隐藏）
│       ├── UITransform                # Size: 720×1280
│       ├── bg (Sprite)                # 遮罩层
│       │   ├── UITransform            # Size: 720×1280
│       │   └── Sprite                 # 黑色, Opacity: 180
│       └── card (Sprite)              # 卡片容器
│           ├── UITransform            # Size: 420×400, Position: (0, 0)
│           ├── Sprite                 # #16213E, Opacity: 255
│           ├── title (Label)          # "游戏结束"
│           │   ├── UITransform        # Size: 200×50, Position: (0, 140)
│           │   └── Label              # 白色 #FFFFFF, 40px, Bold
│           ├── scoreDisplay (Node)    # 分数展示容器
│           │   ├── UITransform        # Size: 300×120, Position: (0, 40)
│           │   ├── finalScore (Label) # 最终长度
│           │   │   ├── UITransform    # Size: 300×60, Position: (0, 20)
│           │   │   └── Label          # "15", 霓虹青 #00D9FF, 56px, Bold
│           │   └── bestScore (Label)  # 历史最佳
│           │       ├── UITransform    # Size: 300×40, Position: (0, -30)
│           │       └── Label          # "历史最佳 20", 金黄 #FFD700, 24px
│           ├── restartBtn (Button)    # 再来一次
│           │   ├── UITransform        # Size: 280×60, Position: (0, -80)
│           │   ├── Sprite             # 霓虹青 #00D9FF, Type: SLICED
│           │   └── Label              # "再来一次", 深灰 #1A1A2E, 24px, Bold
│           └── backBtn (Button)       # 返回大厅
│               ├── UITransform        # Size: 280×50, Position: (0, -150)
│               ├── Sprite             # 灰蓝 #4A5568, Type: SLICED
│               └── Label              # "返回大厅", 白色 #FFFFFF, 22px
```

---

## 三、详细参数配置

### 3.1 gameArea（游戏区域）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, 0, 0) | 居中 |
| ContentSize | (720, 1280) | 全屏 |
| Sprite.Color | #1A1A2E | 深紫黑背景 |
| Sprite.Type | SIMPLE | 简单模式 |

### 3.2 topBar（顶部栏）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, 600, 0) | 顶部（Canvas 高度 1280，半高 640，减去 40 边距） |
| ContentSize | (720, 80) | 高度 80px |
| Sprite.Color | #000000 | 黑色背景 |
| Sprite.Opacity | 102 | 40% 透明度 |

#### 3.2.1 backBtn（返回按钮）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (-320, 0, 0) | 左侧 |
| ContentSize | (60, 60) | 按钮尺寸 |
| Label.String | "←" | 返回箭头 |
| Label.FontSize | 28 | 字体大小 |
| Label.Color | #FFFFFF | 白色 |

#### 3.2.2 scorePanel（分数面板）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, 0, 0) | 居中 |
| ContentSize | (400, 60) | 面板尺寸 |

##### currentScore（当前长度）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (-80, 0, 0) | 左偏 |
| ContentSize | (180, 40) | 标签尺寸 |
| Label.String | "长度: 5" | 初始文字 |
| Label.FontSize | 32 | 较大字体 |
| Label.IsBold | true | 粗体 |
| Label.Color | #00D9FF | 霓虹青 |
| Label.HorizontalAlign | CENTER | 水平居中 |

##### bestScore（历史最佳）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (80, 0, 0) | 右偏 |
| ContentSize | (180, 40) | 标签尺寸 |
| Label.String | "最佳: 0" | 初始文字 |
| Label.FontSize | 28 | 标准字体 |
| Label.Color | #FFD700 | 金黄 |
| Label.HorizontalAlign | CENTER | 水平居中 |

### 3.3 gameOverPanel（游戏结束面板）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, 0, 0) | 全屏居中 |
| ContentSize | (720, 1280) | 全屏 |
| Active | false | 默认隐藏 |

#### 3.3.1 bg（遮罩层）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, 0, 0) | 居中 |
| ContentSize | (720, 1280) | 全屏 |
| Sprite.Color | #000000 | 黑色 |
| Sprite.Opacity | 180 | 70% 透明度 |

#### 3.3.2 card（卡片容器）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, 0, 0) | 居中 |
| ContentSize | (420, 400) | 卡片尺寸 |
| Sprite.Color | #16213E | 深蓝灰 |
| Sprite.Type | SLICED | 九宫格（用于圆角） |
| Sprite.Opacity | 255 | 不透明 |

##### title（标题）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, 140, 0) | 顶部偏上 |
| ContentSize | (200, 50) | 标签尺寸 |
| Label.String | "游戏结束" | 标题文字 |
| Label.FontSize | 40 | 大标题 |
| Label.IsBold | true | 粗体 |
| Label.Color | #FFFFFF | 白色 |
| Label.HorizontalAlign | CENTER | 水平居中 |

##### scoreDisplay（分数展示容器）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, 40, 0) | 中部 |
| ContentSize | (300, 120) | 容器尺寸 |

###### finalScore（最终长度 - 大数字）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, 20, 0) | 偏上 |
| ContentSize | (300, 60) | 标签尺寸 |
| Label.String | "15" | 只显示数字 |
| Label.FontSize | 56 | 超大字体 |
| Label.IsBold | true | 粗体 |
| Label.Color | #00D9FF | 霓虹青 |
| Label.HorizontalAlign | CENTER | 水平居中 |

###### bestScore（历史最佳）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, -30, 0) | 偏下 |
| ContentSize | (300, 40) | 标签尺寸 |
| Label.String | "历史最佳 20" | 完整文字 |
| Label.FontSize | 24 | 小字 |
| Label.Color | #FFD700 | 金黄 |
| Label.HorizontalAlign | CENTER | 水平居中 |

##### restartBtn（再来一次按钮）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, -80, 0) | 中下部 |
| ContentSize | (280, 60) | 按钮尺寸 |
| Sprite.Color | #00D9FF | 霓虹青 |
| Sprite.Type | SLICED | 九宫格 |
| Label.String | "再来一次" | 按钮文字 |
| Label.FontSize | 24 | 字体大小 |
| Label.IsBold | true | 粗体 |
| Label.Color | #1A1A2E | 深灰（与背景形成对比） |
| Button.Transition | COLOR | 颜色过渡 |
| Button.NormalColor | #00D9FF | 正常状态 |
| Button.HoverColor | #33E0FF | 悬停状态（亮一点） |
| Button.PressedColor | #00B8D4 | 按下状态（暗一点） |

##### backBtn（返回大厅按钮）

| 属性 | 值 | 说明 |
|------|-----|------|
| Position | (0, -150, 0) | 底部 |
| ContentSize | (280, 50) | 按钮尺寸（略小） |
| Sprite.Color | #4A5568 | 灰蓝 |
| Sprite.Type | SLICED | 九宫格 |
| Label.String | "返回大厅" | 按钮文字 |
| Label.FontSize | 22 | 字体大小（略小） |
| Label.Color | #FFFFFF | 白色 |
| Button.Transition | COLOR | 颜色过渡 |
| Button.NormalColor | #4A5568 | 正常状态 |
| Button.HoverColor | #5A6578 | 悬停状态 |
| Button.PressedColor | #3A4558 | 按下状态 |

---

## 四、SnakeGame 组件属性绑定

在 **Canvas** 节点的 **SnakeGame** 组件上绑定以下属性：

| 属性名 | 绑定节点路径 | 组件类型 |
|--------|-------------|----------|
| gameArea | gameArea | Node |
| currentScoreLabel | UI_Overlay/topBar/scorePanel/currentScore | Label |
| bestScoreLabel | UI_Overlay/topBar/scorePanel/bestScore | Label |
| gameOverPanel | UI_Overlay/gameOverPanel | Node |
| finalScoreLabel | UI_Overlay/gameOverPanel/card/scoreDisplay/finalScore | Label |
| finalBestScoreLabel | UI_Overlay/gameOverPanel/card/scoreDisplay/bestScore | Label |
| restartBtn | UI_Overlay/gameOverPanel/card/restartBtn | Button |
| backBtn | UI_Overlay/topBar/backBtn | Button |
| panelBackBtn | UI_Overlay/gameOverPanel/card/backBtn | Button |

---

## 五、蛇和光点颜色调整（代码修改）

需要修改 **Snake.ts** 和 **FoodSpawner.ts** 中的颜色常量：

### 5.1 Snake.ts

```typescript
// 修改颜色常量
const HEAD_COLOR = new Color(0, 245, 255);    // #00F5FF 亮青
const BODY_COLOR = new Color(0, 184, 196);    // #00B8C4 青色
```

### 5.2 FoodSpawner.ts

```typescript
// 修改颜色常量
const FOOD_COLOR = new Color(57, 255, 20);    // #39FF14 荧光绿
```

---

## 六、操作步骤清单

### 步骤 1：修改 gameArea 背景色
- [ ] 选中 `gameArea` 节点
- [ ] 在 Sprite 组件中，将 Color 改为 **#1A1A2E**

### 步骤 2：调整 topBar
- [ ] 选中 `topBar` 节点
- [ ] 修改 ContentSize 为 **(720, 80)**
- [ ] 修改 Position Y 为 **600**
- [ ] 添加/修改 Sprite 组件：Color **#000000**，Opacity **102**

### 步骤 3：调整分数面板
- [ ] 选中 `currentScore` Label
- [ ] 修改 FontSize 为 **32**，IsBold 勾选
- [ ] 修改 Color 为 **#00D9FF**
- [ ] 选中 `bestScore` Label
- [ ] 修改 Color 为 **#FFD700**

### 步骤 4：重构 gameOverPanel
- [ ] 创建 `card` Sprite 节点作为子节点
- [ ] 将原有节点（title、finalScore、restartBtn）移动到 card 下
- [ ] 按文档参数调整各节点位置和颜色
- [ ] 创建 `scoreDisplay` 空节点作为容器
- [ ] 调整 finalScore 为只显示大数字（如 "15"）
- [ ] 添加 bestScore 标签显示 "历史最佳 XX"

### 步骤 5：调整按钮样式
- [ ] restartBtn：背景色 **#00D9FF**，文字色 **#1A1A2E**
- [ ] backBtn（面板内）：背景色 **#4A5568**，文字色 **#FFFFFF**

### 步骤 6：绑定组件属性
- [ ] 选中 Canvas 节点
- [ ] 在 SnakeGame 组件上按表格绑定所有属性

### 步骤 7：修改代码颜色
- [ ] 打开 Snake.ts，修改 HEAD_COLOR 和 BODY_COLOR
- [ ] 打开 FoodSpawner.ts，修改 FOOD_COLOR

### 步骤 8：保存并测试
- [ ] 按 Ctrl+S 保存场景
- [ ] 点击预览按钮测试效果

---

## 七、效果预览

### 游戏主界面
```
┌─────────────────────────────────────┐
│  [←]     长度: 5      最佳: 12       │  ← 半透明黑底，霓虹青+金黄
├─────────────────────────────────────┤
│                                     │
│           深紫黑背景                 │
│              #1A1A2E                │
│                                     │
│           ○ 荧光绿光点               │
│                                     │
│              ■ 亮青蛇头              │
│            ■■ 青色蛇身               │
│                                     │
└─────────────────────────────────────┘
```

### 游戏结束界面
```
┌─────────────────────────────────────┐
│                                     │
│    ┌─────────────────────────┐      │
│    │       游戏结束          │      │
│    │                         │      │
│    │         15              │      │  ← 大数字，霓虹青
│    │      历史最佳 20        │      │  ← 金黄小字
│    │                         │      │
│    │   [    再来一次    ]    │      │  ← 霓虹青按钮
│    │   [    返回大厅    ]    │      │  ← 灰蓝按钮
│    └─────────────────────────┘      │
│                                     │
└─────────────────────────────────────┘
```

---

## 八、注意事项

1. **九宫格图片**：如果按钮需要圆角效果，需要在 Sprite 组件中使用九宫格（SLICED）模式，并选择合适的 SpriteFrame
2. **透明度设置**：在 Cocos Creator 中，Sprite 的透明度通过 Color 的 A 通道设置（0-255）
3. **字体显示**：如果文字显示模糊，可以调整 Label 的 FontSize 或检查是否使用了系统字体
4. **层级关系**：确保 gameOverPanel 默认是隐藏状态（Active = false）

---

*文档结束*
