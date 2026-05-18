# 战争进化史 Lite - 实施计划

**日期**: 2026-05-18  
**版本**: v1.0  
**状态**: 计划中  
**关联设计**: [docs/specs/2026-05-18-game-war-evolution-design.md](../specs/2026-05-18-game-war-evolution-design.md)

---

## 1. 总体范围

| 维度 | 范围 |
|------|------|
| 时代 | 3 个（原始→中世纪→未来） |
| 兵种 | 每时代 2 种，共 6 种 |
| 操作 | 点按产兵 + 点按进化 |
| 对战 | 纯 AI 对战 |
| 单局 | 3-5 分钟 |

---

## 2. 文件清单

### 2.1 AI 负责：TypeScript 脚本（6 个文件）

| 文件名 | 路径 | 职责 | 预估行数 |
|--------|------|------|---------|
| `GameConfig.ts` | `assets/games/game_war_evolution/scripts/` | 常量、兵种配置表、时代配置表 | ~120 |
| `WarEvo.ts` | `assets/games/game_war_evolution/scripts/` | 主控制器（update 循环、状态管理、胜负判定） | ~300 |
| `Unit.ts` | `assets/games/game_war_evolution/scripts/` | 单位组件（移动、战斗、排队、技能、死亡） | ~280 |
| `Castle.ts` | `assets/games/game_war_evolution/scripts/` | 城堡组件（HP、自动防御） | ~70 |
| `AI.ts` | `assets/games/game_war_evolution/scripts/` | AI 控制器（波次出兵、进化决策） | ~130 |
| `UIController.ts` | `assets/games/game_war_evolution/scripts/` | 顶部栏/底部栏/结算面板逻辑 | ~200 |

### 2.2 人负责：Cocos Creator 编辑器操作

详见 [第 4 节场景搭建指南](#4-场景搭建指南人负责)。

---

## 3. 实施步骤（按顺序）

| 步骤 | 谁 | 内容 |
|------|---|------|
| 1 | AI | 编写 `GameConfig.ts`（纯数据，无依赖） |
| 2 | AI | 编写 `Unit.ts`（核心战斗逻辑） |
| 3 | AI | 编写 `Castle.ts` |
| 4 | AI | 编写 `AI.ts`（AI 出兵逻辑） |
| 5 | AI | 编写 `UIController.ts`（UI 逻辑） |
| 6 | AI | 编写 `WarEvo.ts`（主控制器，串联所有模块） |
| 7 | AI | 更新 `common/managers/GameConfig.ts` 注册新游戏 |
| 8 | 人 | 在 Cocos Creator 中搭建场景（见第 4 节） |
| 9 | 人 | 创建 Unit.prefab 预制体 |
| 10 | 人 | 将 `@property` 引用在场景中绑定 |
| 11 | 人+AI | 浏览器预览验证，修 bug |

---

## 4. 场景搭建指南（人负责）

### 4.1 场景结构

在 `assets/games/game_war_evolution/scenes/` 下创建 `WarEvo.scene`。

```
Canvas (720×1280 竖屏)
├── Background (Sprite)
│   └── 纯色深色背景，或简单草地纹理图
│
├── Castle_Player (Sprite + Castle 组件)
│   ├── position: x=-280, y=-400（左下区域）
│   ├── size: 80×100
│   └── 使用简单矩形色块即可（蓝色）
│
├── Castle_Enemy (Sprite + Castle 组件)
│   ├── position: x=280, y=-400（右下区域）
│   ├── size: 80×100
│   └── 简单矩形色块（红色）
│
├── UnitContainer (空 Node)
│   └── 用于挂载所有运行时创建的单位实例
│
└── UI (Node，UI 容器)
    ├── TopBar (Node)
    │   ├── BackButton (Button + Label "返回")
    │   │   └── position: 左上角
    │   ├── PlayerHP (ProgressBar 或 Label)
    │   │   └── 左上区域
    │   ├── VS (Label "VS")
    │   │   └── 顶部居中
    │   ├── EnemyHP (ProgressBar 或 Label)
    │   │   └── 右上区域
    │   ├── GoldLabel (Label "金币: 0")
    │   │   └── 中上区域
    │   └── AgeLabel (Label "原始时代")
    │       └── 中上区域
    │
    ├── BottomBar (Node)
    │   ├── UnitButton_0 (Button + Label)
    │   │   └── 底部左侧，显示兵种名+造价
    │   ├── UnitButton_1 (Button + Label)
    │   │   └── 底部中间
    │   └── EvolveButton (Button + Label "进化")
    │       └── 底部右侧
    │
    └── GameOverPanel (Node, active=false)
        ├── ResultLabel (Label "胜利!")
        ├── StatsLabel (Label 统计信息)
        ├── RestartButton (Button "再来一局")
        └── LobbyButton (Button "返回大厅")
```

### 4.2 Unit.prefab 预制体

在 `assets/games/game_war_evolution/resources/prefabs/` 下创建。

```
Unit (根节点，挂载 Unit 组件)
├── Sprite (Sprite 组件)
│   └── 用简单色块代替（玩家=蓝色方块，AI=红色方块）
│   └── size: 36×36
├── HPBar (ProgressBar 子节点)
│   └── 生命值条，绿色
└── Label (Label 子节点)
    └── 显示兵种名字
```

### 4.3 关键说明

- **所有 Sprite 用纯色色块即可**（v1 不做美术，先跑通逻辑）。可用 Cocos Creator 内置的 `default_sprite` 配合 Color 属性染色。
- **HP 条用 ProgressBar 或简单 Label 均可**，ProgressBar 效果更好但 Label 更简单。
- **战场区域**（UnitContainer）的 y 坐标大约在 -200 ~ -500 之间（城堡上方）。
- 单位在同一个 y 轴上水平移动即可（v1 不做多行）。
- 场景分辨率建议 720×1280（竖屏手机比例）。

---

## 5. 关键属性绑定清单

以下列出 WarEvo 组件上需要人在场景中绑定的 `@property`：

| 属性名 | 类型 | 绑到什么 |
|--------|------|---------|
| `castlePlayer` | `Castle` | Castle_Player 节点 |
| `castleEnemy` | `Castle` | Castle_Enemy 节点 |
| `unitContainer` | `Node` | UnitContainer 节点 |
| `unitPrefab` | `Prefab` | Unit.prefab |
| `uiController` | `UIController` | UI 节点（挂 UIController 组件的那个） |

UIController 组件上需要绑定的引用：

| 属性名 | 类型 | 绑到什么 |
|--------|------|---------|
| `goldLabel` | `Label` | TopBar/GoldLabel |
| `ageLabel` | `Label` | TopBar/AgeLabel |
| `evolveLabel` | `Label` | BottomBar/EvolveButton/Label |
| `playerHPLabel` | `Label` | TopBar/PlayerHP（如果不用 ProgressBar） |
| `enemyHPLabel` | `Label` | TopBar/EnemyHP |
| `unitButtons` | `Button[]` | [UnitButton_0, UnitButton_1] |
| `evolveButton` | `Button` | BottomBar/EvolveButton |
| `gameOverPanel` | `Node` | GameOverPanel |
| `resultLabel` | `Label` | GameOverPanel/ResultLabel |
| `statsLabel` | `Label` | GameOverPanel/StatsLabel |
| `restartButton` | `Button` | GameOverPanel/RestartButton |
| `lobbyButton` | `Button` | GameOverPanel/LobbyButton |

---

## 6. 技术决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 路径形式 | 水平单线（x 坐标） | 够用，避免贝塞尔曲线增加复杂度 |
| 战斗判定 | x 距离 ≤ attackRange | 简单直观，性能好 |
| 排队机制 | 检测前方己方单位状态 | 沿袭 Age of War 经典设计 |
| AI 系统 | 简单定时随机 | v1 不需要复杂 AI |
| 资产 | 纯色色块 | 先跑通逻辑再谈美术 |
| 动画 | 不做 tween | v1 先静态位置更新，后续再加 |

---

## 7. 验证清单

- [ ] `GameConfig.ts` 能正确 import，无类型错误
- [ ] `Unit.ts` 能独立创建、移动、战斗、死亡
- [ ] `AI.ts` 能定时产兵、自动进化
- [ ] `UIController.ts` 按钮点击有响应，Label 更新正确
- [ ] `WarEvo.ts` update 循环跑通，金币/经验正确累加
- [ ] 6 个兵种都能生产且行为符合设计
- [ ] 3 次时代进化流程正常
- [ ] 一方城堡 HP 归零后弹出结算面板
- [ ] 从大厅进入游戏、返回大厅功能正常
- [ ] LSP 诊断无 error（war_evolution 目录下所有文件）

---

*文档结束*
