# Tiny Vanguard 场景搭建与预制体创建指南

> 本文档供人在 Cocos Creator 编辑器中操作，包含所有节点位置、大小、颜色和组件挂载的精确信息。

---

## 1. 主题色板

| 用途 | 颜色 | 色值 |
|------|------|------|
| 背景色 | 深蓝灰 | `#1A1A2E` |
| 网格格子（默认） | 浅灰白 | `#E8E8E8` |
| 可移动高亮 | 绿色半透明 | `rgba(100, 200, 100, 180)` |
| 可攻击高亮 | 红色半透明 | `rgba(200, 100, 100, 180)` |
| 已部署格子 | 绿色 | `rgba(100, 200, 100, 255)` |
| 玩家单位 | 蓝色 | `#64B4FF` |
| 敌人单位 | 红色 | `#FF6464` |
| 选中高亮 | 金色 | `#FFD700` |
| UI 面板背景 | 半透黑 | `rgba(0, 0, 0, 180)` |
| 按钮主色 | 深蓝 | `#2C3E50` |
| 按钮文字 | 白色 | `#FFFFFF` |
| 金币文字 | 金色 | `#FFD700` |
| 危险文字（伤害） | 红色 | `#FF4444` |
| 治疗文字 | 绿色 | `#44FF44` |
| 能量文字 | 青色 | `#00DDDD` |

---

## 2. 场景创建

| 操作 | 值 |
|------|-----|
| 路径 | `assets/games/game_tiny_vanguard/scenes/TinyVanguard.scene` |
| 画布大小 | **750 × 1334**（手机竖屏） |
| Canvas -> Design Resolution | Width: 750, Height: 1334 |
| Camera -> 位置 | (0, 0, 1000) |
| Camera -> Size | **667**（适配竖屏） |

---

## 3. 网格系统

### 3.1 CellPrefab 预制体

**创建路径**: `assets/games/game_tiny_vanguard/prefabs/CellPrefab.prefab`

| 属性 | 值 |
|------|-----|
| 节点类型 | **Sprite** |
| 大小 | **80 × 80 px** |
| 锚点 | (0.5, 0.5) |
| SpriteFrame | 使用默认白色方块 |
| Color | `#E8E8E8` |
| 添加组件 | **Button** |
| Button -> Transition | Color |
| Button -> Normal Color | `#E8E8E8` |
| Button -> Pressed Color | `#CCCCCC` |
| Button -> Hover Color | `#E8E8E8` |
| Button -> Disabled Color | `#AAAAAA` |

> 不需要 Label 子节点，格子上不显示文字。

### 3.2 Grid 根节点

在场景根节点下创建以下层级：

```
Grid (Node)
  挂载: GridController 组件
  位置: (0, 0)
  └── GridContainer (Node)   ← 空的子节点，用作格子容器
       位置: (0, 0)
```

**在 Inspector 中绑定 GridController 的属性**:

| @property 字段 | 拖入什么 |
|---------------|---------|
| **gridContainer** | 从层级拖入 **GridContainer** 子节点 |
| **cellPrefab** | 从资源管理器拖入 **CellPrefab** |

> 注意：Grid 的坐标就是网格中心。代码中每个格子会以 80px 为单位从中心向四周排列。单元格子由代码 `instantiate(cellPrefab)` 自动生成并添加到 GridContainer 下，你不需要手动创建 36 个。

---

## 4. 单位预制体

### 4.1 UnitPrefab

**创建路径**: `assets/games/game_tiny_vanguard/prefabs/UnitPrefab.prefab`

**节点结构**:
```
UnitPrefab (Sprite)   ← 根节点
  ├── UnitSprite (Sprite)   ← 单位本体
  ├── SelectionIndicator (Sprite)   ← 选中高亮
  └── HpBar (Sprite)   ← 血条背景
       └── HpFill (Sprite)   ← 血条填充
```

#### 根节点参数

| 属性 | 值 |
|------|-----|
| 节点类型 | **Sprite** |
| 大小 | **60 × 60 px** |
| 锚点 | (0.5, 0.5) |
| Color | `#64B4FF`（玩家颜色，敌人由代码改色） |
| 添加组件 | **UnitController** |
| 添加组件 | **Button**（用于点击选中） |
| Button -> Transition | Color |
| UnitController -> unitSprite | 拖入 UnitSprite 子节点 |
| UnitController -> selectionIndicator | 拖入 SelectionIndicator 子节点 |

#### UnitSprite 子节点

| 属性 | 值 |
|------|-----|
| 节点类型 | **Sprite** |
| 大小 | **40 × 40 px** |
| 位置 | (0, 0) |
| 锚点 | (0.5, 0.5) |
| SpriteFrame | 白色圆形（后续可换为职业图标） |
| 颜色 | 留白（由代码设置） |

#### SelectionIndicator 子节点

| 属性 | 值 |
|------|-----|
| 节点类型 | **Sprite** |
| 大小 | **70 × 70 px** |
| 位置 | (0, 0) |
| 锚点 | (0.5, 0.5) |
| Color | `#FFD700` |
| Opacity | **128** |
| active | **false**（默认隐藏，由代码控制） |

#### HpBar / HpFill

| 节点 | HpBar | HpFill |
|------|-------|--------|
| 类型 | Sprite | Sprite |
| 大小 | 50 × 6 px | 50 × 6 px |
| 位置 | (0, -35) | (0, -35) |
| 锚点 | (0, 0.5) | (0, 0.5) |
| Color | `#333333` | `#44FF44` |
| SpriteFrame | 白色方块 | 白色方块 |

---

## 5. 战斗 UI（BattleUI）

### 5.1 BattleUI 根节点

| 属性 | 值 |
|------|-----|
| 节点名 | **BattleUI** |
| 位置 | (0, 0) |
| 大小 | 覆盖全屏（750 × 1334） |
| active | **false**（默认隐藏，代码控制） |
| 添加组件 | **Canvas**（渲染为 UI） |
| 添加组件 | **BattleUI** |

### 5.2 单位信息面板（左上角）

**节点路径**: `BattleUI > UnitInfoPanel`

```
UnitInfoPanel (Sprite, 半透黑背景)
  位置: (-262, 500)   ← 左上
  大小: 200 × 100
  Color: rgba(0, 0, 0, 180)
  Anchor: (0, 1)     ← 左上角对齐
  ├── UnitNameLabel (Label)
  │     位置: (10, -10)
  │     大小: 180 × 30
  │     字号: 22
  │     对齐: 左对齐
  │     颜色: #FFFFFF
  │     内容: ''（初始空）
  ├── HpLabel (Label)
  │     位置: (10, -40)
  │     大小: 180 × 25
  │     字号: 18
  │     颜色: #FF4444
  │     内容: 'HP: 0/0'
  └── EnergyLabel (Label)
        位置: (10, -65)
        大小: 180 × 25
        字号: 18
        颜色: #00DDDD
        内容: '⚡ 0/5'
```

**BattleUI 绑定**:
| @property 字段 | 从哪拖入 |
|---------------|---------|
| unitNameLabel | 层级中拖入 UnitNameLabel |
| hpLabel | 层级中拖入 HpLabel |
| energyLabel | 层级中拖入 EnergyLabel |

### 5.3 回合信息（顶部中间）

```
TurnLabel (Label)
  位置: (0, 500)
  大小: 150 × 30
  字号: 20
  对齐: 居中
  颜色: #FFFFFF
  内容: '回合 1'
```

**BattleUI 绑定**: turnLabel

### 5.4 技能按钮容器（右下角）

**节点路径**: `BattleUI > SkillButtonContainer`

```
SkillButtonContainer (Node)
  位置: (250, -450)
  大小: 300 × 80
  水平布局: 等间距排列
```

**BattleUI 绑定**: skillButtonContainer

### 5.5 SkillBtnPrefab 预制体

**创建路径**: `assets/games/game_tiny_vanguard/prefabs/SkillBtnPrefab.prefab`

| 属性 | 值 |
|------|-----|
| 节点类型 | **Button** |
| 大小 | **90 × 50 px** |
| Color | `#2C3E50` |
| 添加子节点 Label | 居中，字号 16，白色 |
| Button -> Transition | Color |
| Button -> Disabled Color | `#555555` |

**BattleUI 绑定**: skillButtonPrefab

### 5.6 结束回合按钮（右侧中间）

```
EndTurnButton (Button)
  位置: (310, 0)
  大小: 100 × 60
  颜色: #2C3E50
  文字: '结束回合' (Label子节点, 字号18, 白色)
```

**BattleUI 绑定**: endTurnButton

### 5.7 确认布阵按钮

```
ConfirmDeployButton (Button)
  位置: (0, -500)
  大小: 160 × 60
  颜色: #27AE60
  文字: '确认布阵' (Label子节点, 字号20, 白色)
  active: false（默认隐藏）
```

**BattleUI 绑定**: confirmDeployButton

### 5.8 布阵提示

```
DeployPrompt (Label)
  位置: (0, 300)
  字号: 24
  颜色: #FFFFFF
  内容: '点击前两行部署单位'
  对齐: 居中
  active: false（默认隐藏）
```

**BattleUI 绑定**: deployPrompt

### 5.9 DamageNumberPrefab 预制体

**创建路径**: `assets/games/game_tiny_vanguard/prefabs/DamageNumberPrefab.prefab`

| 属性 | 值 |
|------|-----|
| 节点类型 | **Node**（带 Label 子节点） |
| 大小 | 60 × 40 |
| 子节点 Label | 居中，字号 28，粗体，白色 |
| Label 内容 | '-0'（代码设置数值和颜色） |

**BattleUI 绑定**: damageNumberPrefab

### 5.10 胜利/失败面板

```
VictoryPanel (Sprite, 覆盖全屏)
  位置: (0, 0)
  大小: 750 × 1334
  Color: rgba(0, 0, 0, 180)
  active: false
  ├── VictoryLabel (Label)
  │     位置: (0, 100)
  │     字号: 48
  │     颜色: #FFD700
  │     内容: '胜利！'
  └── ContinueLabel (Label)
        位置: (0, -100)
        字号: 24
        颜色: #FFFFFF
        内容: '进入升级...'

DefeatPanel (Sprite, 覆盖全屏)
  位置: (0, 0)
  大小: 750 × 1334
  Color: rgba(0, 0, 0, 180)
  active: false
  ├── DefeatLabel (Label)
  │     位置: (0, 100)
  │     字号: 48
  │     颜色: #FF4444
  │     内容: '失败'
  └── ScoreLabel (Label)
        位置: (0, -100)
        字号: 24
        颜色: #FFFFFF
        内容: ''
```

**BattleUI 绑定**: victoryPanel, defeatPanel

---

## 6. 路线图 UI（RouteMapUI）

### 6.1 RouteMapUI 根节点

| 属性 | 值 |
|------|-----|
| 节点名 | **RouteMapUI** |
| 位置 | (0, 0) |
| 大小 | 750 × 1334 |
| active | **false**（默认隐藏） |
| 添加组件 | **ScrollView** |
| ScrollView -> content | 拖入 NodesContainer 子节点 |
| ScrollView -> Horizontal | **false** |
| ScrollView -> Vertical | **true** |
| ScrollView -> Bounce | true |
| 添加组件 | **RouteMapUI** |

### 6.2 节点结构

```
RouteMapUI (ScrollView)
  ├── view
  │    └── content
  │         └── NodesContainer (Node)
  │               └── (NodePrefab 实例, 由代码生成)
  └── (背景图片，可选)
```

| 节点 | 属性 |
|------|------|
| **view** | 大小 750 × 1334 |
| **content** | 自动根据内容调整高度 |
| **NodesContainer** | 位置 (0, 0) |

**RouteMapUI 绑定**:
| @property 字段 | 从哪拖入 |
|---------------|---------|
| scrollView | 层级中拖入 RouteMapUI 节点自身的 ScrollView 组件 |
| nodePrefab | 资源管理器中拖入 NodePrefab |
| nodesContainer | 层级中拖入 NodesContainer 子节点 |

### 6.3 NodePrefab 预制体

**创建路径**: `assets/games/game_tiny_vanguard/prefabs/NodePrefab.prefab`

| 属性 | 值 |
|------|-----|
| 节点类型 | **Button** |
| 大小 | **70 × 70 px** |
| 形状 | **圆形**（用 Sprite 做圆角/圆形图） |
| Color | `#2C3E50` |
| 添加组件 | **Button** |
| Button -> Transition | Color |
| Button -> Normal Color | `#2C3E50` |
| Button -> Disabled Color | `#555555` |
| Button -> Disabled | interactable 由代码控制 |
| 子节点 Label | 居中，字号 28 |
| 子节点 Label 内容 | '⚔️'（代码设置图标） |

---

## 7. 升级 UI（UpgradeUI）

### 7.1 UpgradeUI 根节点

| 属性 | 值 |
|------|-----|
| 节点名 | **UpgradeUI** |
| 位置 | (0, 0) |
| 大小 | 750 × 1334 |
| 背景 | 半透黑 Sprite (rgba(0,0,0,180)) |
| active | **false** |
| 添加组件 | **UpgradeUI** |

### 7.2 节点结构

```
UpgradeUI (Sprite, 半透黑覆盖全屏)
  ├── TitleLabel (Label)
  │     位置: (0, 300)
  │     字号: 36
  │     颜色: #FFD700
  │     内容: '升级选择'
  ├── CardContainer (Node)
  │     位置: (0, 0)
  │     大小: 600 × 400
  │     水平布局, 等间距
  │     （由代码生成 3 张 CardPrefab）
  └── CardPrefab (预制体, 详见下方)
```

**UpgradeUI 绑定**:
| @property 字段 | 从哪拖入 |
|---------------|---------|
| cardContainer | 层级中拖入 CardContainer 节点 |
| cardPrefab | 资源管理器中拖入 CardPrefab |
| titleLabel | 层级中拖入 TitleLabel 节点 |

### 7.3 CardPrefab 预制体

**创建路径**: `assets/games/game_tiny_vanguard/prefabs/CardPrefab.prefab`

| 节点 | 属性 |
|------|------|
| **根节点 (Button)** | 大小 180 × 240, 颜色 `#2C3E50` |
| **CardNameLabel (Label)** | 位置 (0, 60), 字号 22, 白色, '技能名' |
| **CardDescLabel (Label)** | 位置 (0, -20), 字号 16, 灰色 `#CCCCCC`, 换行, '技能描述' |

---

## 8. 事件 UI（EventUI）

### 8.1 EventUI 根节点

| 属性 | 值 |
|------|-----|
| 节点名 | **EventUI** |
| 位置 | (0, 0) |
| 大小 | 750 × 1334 |
| 背景 | 半透黑 Sprite (rgba(0,0,0,180)) |
| active | **false** |
| 添加组件 | **EventUI** |

### 8.2 节点结构

```
EventUI (Sprite, 半透黑覆盖全屏)
  ├── EventTitleLabel (Label)
  │     位置: (0, 300)
  │     字号: 32
  │     颜色: #FFD700
  │     内容: ''
  ├── EventDescLabel (Label)
  │     位置: (0, 150)
  │     字号: 22
  │     颜色: #FFFFFF
  │     内容: ''
  │     换行: 是, 宽度 500
  └── ChoiceContainer (Node)
        位置: (0, -100)
        （由代码生成 ChoiceBtnPrefab）
```

**EventUI 绑定**:
| @property 字段 | 从哪拖入 |
|---------------|---------|
| eventTitleLabel | 层级中拖入 EventTitleLabel |
| eventDescLabel | 层级中拖入 EventDescLabel |
| choiceButtonPrefab | 资源管理器中拖入 ChoiceBtnPrefab |
| choiceContainer | 层级中拖入 ChoiceContainer |

### 8.3 ChoiceBtnPrefab 预制体

**创建路径**: `assets/games/game_tiny_vanguard/prefabs/ChoiceBtnPrefab.prefab`

| 属性 | 值 |
|------|-----|
| 类型 | **Button** |
| 大小 | **400 × 60** |
| 颜色 | `#2C3E50` |
| 子节点 Label | 居中，字号 20，白色 |

---

## 9. 主控节点

### 9.1 GameManager

在场景根节点创建：

```
GameManager (Node)
  位置: (0, 0)
  挂载组件: TinyVanguardMain
  
TinyVanguardMain @property 绑定:
| @property 字段 | 从哪拖入 |
|---------------|---------|
| routeMapUI | 层级中拖入 RouteMapUI 节点 |
| battleManager | 层级中拖入 BattleManager 节点 |
| battleUI | 层级中拖入 BattleUI 节点 |
| upgradeUI | 层级中拖入 UpgradeUI 节点 |
| eventUI | 层级中拖入 EventUI 节点 |
| gameOverPanel | 层级中拖入 GameOverPanel 节点 |
| gameOverLabel | 层级中拖入 GameOverLabel |
| victoryPanel | 层级中拖入 VictoryPanel 节点 |
| shopPanel | 层级中拖入 ShopPanel 节点 |
| restPanel | 层级中拖入 RestPanel 节点 |
| goldLabel | 层级中拖入 GoldLabel |
| continueButton | 层级中拖入 ContinueButton |
| classSelectPanel | 层级中拖入 ClassSelectPanel |
```

### 9.2 BattleManager

```
BattleManager (Node)
  位置: (0, 0)
  挂载组件: BattleManager
  @property 绑定:
    gridController → 从层级拖入 Grid 节点
    unitPrefab     → 从资源管理器拖入 UnitPrefab
```

### 9.3 GameOverPanel / VictoryPanel

```
GameOverPanel (Sprite, 覆盖全屏)
  位置: (0, 0), 大小: 750×1334
  Color: rgba(0, 0, 0, 200)
  active: false
  ├── GameOverLabel (Label)
  │     位置: (0, 0), 字号 36, 白色, 多行居中
  └── RestartButton (Button)
        位置: (0, -200), 大小 200×60
        颜色: #2C3E50
        文字: '重新开始'
        回调: 绑定到 TinyVanguardMain.restartFromRouteMap

VictoryPanel 结构类似，但文字是"通关！"
```

### 9.4 ShopPanel（简化版）

```
ShopPanel (Sprite, 半透黑覆盖全屏)
  active: false
  ├── ShopTitle (Label): '商店'
  ├── BuySkillBtn (Button): '买技能 - 10金币'
  ├── HealBtn (Button): '回血 - 5金币'
  └── CloseBtn (Button): '离开商店'
```

### 9.5 RestPanel（简化版）

```
RestPanel (Sprite, 半透黑覆盖全屏)
  active: false
  ├── RestTitle (Label): '休息点'
  ├── RestDesc (Label): '全员恢复满血'
  ├── ConfirmRestBtn (Button): '休息'
  └── SkipBtn (Button): '跳过'
```

### 9.6 金币显示 & 继续按钮

```
GoldLabel (Label)
  位置: (310, 500)
  字号: 24
  颜色: #FFD700
  内容: '💰 0'

ContinueButton (Button)
  位置: (0, -200)
  大小: 200 × 60
  颜色: #27AE60
  文字: '继续上局'
  active: false
```

### 9.7 ClassSelectPanel（初始职业选择）

```
ClassSelectPanel (Sprite, 深色背景)
  active: true（默认显示）
  ├── TitleLabel: 'Tiny Vanguard'
  ├── DescLabel: '选择你的小队'
  ├── Class1Btn (Button): '战士 + 弓箭手 + 法师'
  └── StartBtn (Button): '开始'
       回调: 绑定到 TinyVanguardMain.startClassSelect
```

---

## 10. 最终节点层级总览

```
Canvas
├── GameManager (TinyVanguardMain)
├── Grid (GridController)
├── BattleManager (BattleManager)
├── BattleUI (BattleUI) [active=false]
├── RouteMapUI (RouteMapUI) [active=false]
├── UpgradeUI (UpgradeUI) [active=false]
├── EventUI (EventUI) [active=false]
├── GoldLabel (Label)
├── ContinueButton (Button) [active=false]
├── ClassSelectPanel [active=true]
├── ShopPanel [active=false]
├── RestPanel [active=false]
├── GameOverPanel [active=false]
└── VictoryPanel [active=false]
```

---

## 11. 创建顺序建议

按依赖关系排，推荐你按以下顺序操作：

```
1. CellPrefab.prefab          ← 网格基础
2. Grid 节点 + GridController  ← 场景搭建
3. UnitPrefab.prefab          ← 单位预制体
4. SkillBtnPrefab.prefab      ← 技能按钮
5. DamageNumberPrefab.prefab  ← 伤害数字
6. BattleUI 层级搭建          ← 战斗界面
7. NodePrefab.prefab          ← 路线节点
8. RouteMapUI 层级搭建        ← 路线图
9. CardPrefab.prefab          ← 升级卡片
10. UpgradeUI 层级搭建        ← 升级界面
11. ChoiceBtnPrefab.prefab    ← 选项按钮
12. EventUI 层级搭建          ← 事件界面
13. ShopPanel / RestPanel     ← 简化面板
14. GameOver / VictoryPanel   ← 结算界面
15. BattleManager 节点         ← 战斗管理器
16. GameManager 节点 + 绑定    ← 最终集成
```

每步约 2~10 分钟。做完后告诉我，我来确认所有绑定是否正确，然后就可以跑起来了！
