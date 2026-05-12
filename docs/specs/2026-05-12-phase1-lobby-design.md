# Phase 1: 游戏大厅容器 - 设计文档

**日期**: 2026-05-12  
**版本**: v1.0  
**状态**: 设计中

---

## 1. 目标

搭建一个可运行的"游戏大厅"容器，作为所有游戏的入口。本阶段**不实现具体游戏**，只完成大厅框架和跳转机制。

---

## 2. 功能范围

### 2.1 包含功能
- [x] 游戏列表网格展示
- [x] "最近游玩"区域（最多3个，为空时隐藏）
- [x] "全部游戏"区域
- [x] 点击游戏图标进入游戏场景（占位）
- [x] 从游戏返回大厅
- [x] 本地存储最近游玩记录

### 2.2 不包含功能（后续阶段）
- [ ] 搜索功能
- [ ] 收藏功能
- [ ] 真实游戏逻辑
- [ ] 微信 API 接入
- [ ] 资源分包加载

---

## 3. 界面设计

### 3.1 布局结构

```
┌─────────────────────────────┐
│      Tiny Games 游戏大厅      │  ← 标题栏
├─────────────────────────────┤
│ 📌 最近游玩                  │  ← 区域标题（有数据时显示）
│ ┌────┐ ┌────┐ ┌────┐       │
│ │图标│ │图标│ │图标│       │  ← 横向滚动，最多3个
│ │名称│ │名称│ │名称│       │
│ └────┘ └────┘ └────┘       │
├─────────────────────────────┤
│ 🎮 全部游戏                  │  ← 区域标题
│ ┌────┐ ┌────┐ ┌────┐       │
│ │图标│ │图标│ │图标│       │  ← 网格布局，3列
│ │名称│ │名称│ │名称│       │
│ └────┘ └────┘ └────┘       │
│ ┌────┐ ┌────┐ ┌────┐       │
│ │图标│ │图标│ │图标│       │
│ │名称│ │名称│ │名称│       │
│ └────┘ └────┘ └────┘       │
└─────────────────────────────┘
```

### 3.2 游戏图标组件

```
┌────────────┐
│            │
│   游戏图标  │  ← 80x80 正方形
│   (占位图)  │
│            │
├────────────┤
│   游戏名称  │  ← 文字居中，最多6字
└────────────┘
```

### 3.3 游戏场景（占位）

```
┌─────────────────────────────┐
│  [返回]    游戏名称          │  ← 顶部导航栏
├─────────────────────────────┤
│                             │
│                             │
│      游戏占位画面            │  ← 中央显示游戏ID
│      (Game: xxx)            │
│                             │
│                             │
├─────────────────────────────┤
│  点击"返回"回到大厅          │  ← 底部提示
└─────────────────────────────┘
```

---

## 4. 数据结构

### 4.1 游戏配置

```typescript
// assets/common/managers/GameConfig.ts

export interface GameConfig {
    id: string;           // 游戏唯一标识，如 "2048"
    name: string;         // 游戏显示名称
    icon: string;         // 图标资源路径（暂时用默认图标）
    sceneName: string;    // 场景名称，如 "GamePlaceholder"
}

// 游戏列表（硬编码，后续可扩展为配置文件）
export const GAME_LIST: GameConfig[] = [
    { id: '2048', name: '2048', icon: 'default', sceneName: 'GamePlaceholder' },
    { id: 'snake', name: '贪吃蛇', icon: 'default', sceneName: 'GamePlaceholder' },
    { id: 'tetris', name: '俄罗斯方块', icon: 'default', sceneName: 'GamePlaceholder' },
    { id: 'puzzle', name: '推箱子', icon: 'default', sceneName: 'GamePlaceholder' },
    { id: 'flappy', name: '像素鸟', icon: 'default', sceneName: 'GamePlaceholder' },
    { id: 'breakout', name: '打砖块', icon: 'default', sceneName: 'GamePlaceholder' },
];
```

### 4.2 用户数据（本地存储）

```typescript
// assets/common/managers/StorageManager.ts

export interface UserGameData {
    recentGames: string[];  // 最近玩的游戏ID列表（按时间倒序，最多3个）
}

// 存储键名
const STORAGE_KEY = 'tiny_games_user_data';
```

---

## 5. 架构设计

### 5.1 场景结构

```
assets/
├── main/
│   ├── scenes/
│   │   └── Lobby.scene          # 大厅场景（主入口）
│   └── scripts/
│       ├── Lobby.ts             # 大厅主逻辑
│       ├── GameGrid.ts          # 游戏网格组件
│       └── GameIcon.ts          # 游戏图标组件
│
├── game_placeholder/
│   ├── scenes/
│   │   └── GamePlaceholder.scene  # 游戏占位场景
│   └── scripts/
│       └── GamePlaceholder.ts     # 占位场景逻辑
│
└── common/
    ├── managers/
    │   ├── GameConfig.ts        # 游戏配置
    │   ├── StorageManager.ts    # 本地存储管理
    │   └── SceneManager.ts      # 场景切换管理
    └── components/
        └── BackButton.ts        # 返回按钮组件
```

### 5.2 类职责

| 类 | 职责 |
|----|------|
| `Lobby` | 大厅主逻辑，协调各组件，处理用户数据 |
| `GameGrid` | 游戏网格布局，管理游戏图标列表 |
| `GameIcon` | 单个游戏图标，显示图标和名称，处理点击 |
| `GamePlaceholder` | 占位游戏场景，显示游戏ID，提供返回功能 |
| `GameConfig` | 定义游戏数据结构，提供游戏列表 |
| `StorageManager` | 封装本地存储读写，管理用户数据 |
| `SceneManager` | 封装场景切换逻辑，支持带参数跳转 |
| `BackButton` | 通用返回按钮，返回大厅场景 |

### 5.3 场景切换流程

```
┌─────────────┐      点击游戏图标      ┌─────────────────┐
│  Lobby      │ ────────────────────→ │  GamePlaceholder │
│  (大厅)     │   传递参数: gameId     │  (占位游戏场景)  │
└─────────────┘                       └─────────────────┘
       ↑                                      │
       │         点击返回按钮                  │
       └──────────────────────────────────────┘
```

---

## 6. 核心逻辑

### 6.1 进入游戏流程

```typescript
// Lobby.ts
onGameClick(gameId: string) {
    // 1. 更新最近游玩记录
    this.updateRecentGames(gameId);
    
    // 2. 跳转到游戏场景
    SceneManager.gotoGame(gameId);
}

updateRecentGames(gameId: string) {
    // 1. 从存储读取
    const data = StorageManager.getUserData();
    
    // 2. 更新列表（移除重复，添加到开头）
    data.recentGames = data.recentGames.filter(id => id !== gameId);
    data.recentGames.unshift(gameId);
    data.recentGames = data.recentGames.slice(0, 3);  // 最多保留3个
    
    // 3. 保存回存储
    StorageManager.setUserData(data);
}
```

### 6.2 大厅刷新逻辑

```typescript
// Lobby.ts
onLoad() {
    // 1. 读取用户数据
    const userData = StorageManager.getUserData();
    
    // 2. 渲染"最近游玩"区域（有数据才显示）
    if (userData.recentGames.length > 0) {
        this.recentSection.active = true;
        this.renderRecentGames(userData.recentGames);
    } else {
        this.recentSection.active = false;
    }
    
    // 3. 渲染"全部游戏"区域
    this.renderAllGames();
}
```

---

## 7. 开发检查点

完成以下检查点即表示第一阶段完成：

- [ ] 项目初始化，能在浏览器预览
- [ ] 大厅场景显示正常，布局正确
- [ ] 点击游戏图标能跳转到占位场景
- [ ] 占位场景显示正确的游戏ID
- [ ] 点击返回能回到大厅
- [ ] 最近游玩记录能正确保存和显示
- [ ] 最近游玩为空时，该区域隐藏

---

## 8. 后续扩展点

第一阶段完成后，可无缝扩展：

| 扩展 | 说明 |
|------|------|
| 添加真实游戏 | 新建游戏场景，修改 GameConfig 中的 sceneName |
| 收藏功能 | 在 GameIcon 添加收藏按钮，扩展 UserGameData |
| 搜索功能 | 在 Lobby 添加搜索栏，过滤 GameGrid |
| 游戏分类 | 扩展 GameConfig 添加 category 字段 |
| 分包加载 | 游戏场景改为动态加载，减少首包体积 |

---

## 9. 附录

### 9.1 命名规范
- 场景文件: `PascalCase.scene`
- 脚本文件: `PascalCase.ts`
- 组件类名: `PascalCase`
- 私有成员: `_camelCase`

### 9.2 文档位置
本文档存放于 `docs/specs/`，符合项目文档规范。

---

*文档结束*
