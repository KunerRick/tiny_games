# Phase 1: 游戏大厅容器 - 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 使用 Cocos Creator 3.x 搭建可运行的游戏大厅，包含游戏列表展示、最近游玩记录、场景跳转功能。

**架构：** 采用组件化设计，大厅场景(Lobby)包含游戏网格(GameGrid)和游戏图标(GameIcon)组件，通过 StorageManager 管理本地存储，SceneManager 处理场景切换。

**技术栈：** Cocos Creator 3.x, TypeScript

---

## 文件清单

| 文件路径 | 职责 |
|---------|------|
| `assets/common/managers/GameConfig.ts` | 游戏配置接口和游戏列表数据 |
| `assets/common/managers/StorageManager.ts` | 本地存储读写封装 |
| `assets/common/managers/SceneManager.ts` | 场景切换管理 |
| `assets/main/scripts/Lobby.ts` | 大厅主逻辑组件 |
| `assets/main/scripts/GameGrid.ts` | 游戏网格布局组件 |
| `assets/main/scripts/GameIcon.ts` | 游戏图标组件 |
| `assets/game_placeholder/scripts/GamePlaceholder.ts` | 占位游戏场景逻辑 |
| `assets/common/components/BackButton.ts` | 通用返回按钮组件 |

---

## 任务 1：创建游戏配置管理器

**文件：**
- 创建：`assets/common/managers/GameConfig.ts`

- [ ] **步骤 1：编写 GameConfig.ts**

```typescript
import { _decorator } from 'cc';

export interface GameConfig {
    id: string;
    name: string;
    icon: string;
    sceneName: string;
    description?: string;
}

export const GAME_LIST: GameConfig[] = [
    { id: '2048', name: '2048', icon: 'default', sceneName: 'GamePlaceholder', description: '经典数字合并游戏' },
    { id: 'snake', name: '贪吃蛇', icon: 'default', sceneName: 'GamePlaceholder', description: '经典贪吃蛇' },
    { id: 'tetris', name: '俄罗斯方块', icon: 'default', sceneName: 'GamePlaceholder', description: '经典方块消除' },
    { id: 'puzzle', name: '推箱子', icon: 'default', sceneName: 'GamePlaceholder', description: '益智推箱子' },
    { id: 'flappy', name: '像素鸟', icon: 'default', sceneName: 'GamePlaceholder', description: '飞行躲避' },
    { id: 'breakout', name: '打砖块', icon: 'default', sceneName: 'GamePlaceholder', description: '经典打砖块' },
];

export function getGameById(id: string): GameConfig | undefined {
    return GAME_LIST.find(game => game.id === id);
}
```

- [ ] **步骤 2：Commit**

```bash
git add assets/common/managers/GameConfig.ts
git commit -m "feat: add game config manager with game list"
```

---

## 任务 2：创建存储管理器

**文件：**
- 创建：`assets/common/managers/StorageManager.ts`

- [ ] **步骤 1：编写 StorageManager.ts**

```typescript
import { _decorator } from 'cc';

const STORAGE_KEY = 'tiny_games_user_data';

export interface UserGameData {
    recentGames: string[];
}

export class StorageManager {
    private static _instance: StorageManager | null = null;
    
    static get instance(): StorageManager {
        if (!this._instance) {
            this._instance = new StorageManager();
        }
        return this._instance;
    }
    
    getUserData(): UserGameData {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                return JSON.parse(data);
            }
        } catch (e) {
            console.warn('Failed to load user data:', e);
        }
        return { recentGames: [] };
    }
    
    setUserData(data: UserGameData): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save user data:', e);
        }
    }
    
    addRecentGame(gameId: string): void {
        const data = this.getUserData();
        
        // Remove if exists
        data.recentGames = data.recentGames.filter(id => id !== gameId);
        
        // Add to front
        data.recentGames.unshift(gameId);
        
        // Keep only 3
        data.recentGames = data.recentGames.slice(0, 3);
        
        this.setUserData(data);
    }
}
```

- [ ] **步骤 2：Commit**

```bash
git add assets/common/managers/StorageManager.ts
git commit -m "feat: add storage manager for user data"
```

---

## 任务 3：创建场景管理器

**文件：**
- 创建：`assets/common/managers/SceneManager.ts`

- [ ] **步骤 1：编写 SceneManager.ts**

```typescript
import { director } from 'cc';

export class SceneManager {
    private static _currentGameId: string = '';
    
    static get currentGameId(): string {
        return this._currentGameId;
    }
    
    static gotoLobby(): void {
        this._currentGameId = '';
        director.loadScene('Lobby');
    }
    
    static gotoGame(gameId: string, sceneName: string): void {
        this._currentGameId = gameId;
        director.loadScene(sceneName);
    }
}
```

- [ ] **步骤 2：Commit**

```bash
git add assets/common/managers/SceneManager.ts
git commit -m "feat: add scene manager for navigation"
```

---

## 任务 4：创建游戏图标组件

**文件：**
- 创建：`assets/main/scripts/GameIcon.ts`

- [ ] **步骤 1：编写 GameIcon.ts**

```typescript
import { _decorator, Component, Node, Label, Sprite, Color, EventTouch, tween, Vec3 } from 'cc';
import { GameConfig } from '../../common/managers/GameConfig';

const { ccclass, property } = _decorator;

@ccclass('GameIcon')
export class GameIcon extends Component {
    @property(Label)
    nameLabel: Label | null = null;
    
    @property(Sprite)
    iconSprite: Sprite | null = null;
    
    @property(Node)
    bgNode: Node | null = null;
    
    private _gameConfig: GameConfig | null = null;
    private _onClickCallback: ((gameId: string) => void) | null = null;
    
    onLoad() {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }
    
    onDestroy() {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }
    
    setup(config: GameConfig, onClick: (gameId: string) => void) {
        this._gameConfig = config;
        this._onClickCallback = onClick;
        
        if (this.nameLabel) {
            this.nameLabel.string = config.name;
        }
        
        // Set default background color based on game id
        if (this.bgNode) {
            const colors = [
                new Color(255, 150, 150),
                new Color(150, 255, 150),
                new Color(150, 150, 255),
                new Color(255, 255, 150),
                new Color(255, 150, 255),
                new Color(150, 255, 255),
            ];
            const index = config.id.charCodeAt(0) % colors.length;
            const sprite = this.bgNode.getComponent(Sprite);
            if (sprite) {
                sprite.color = colors[index];
            }
        }
    }
    
    private onTouchStart(event: EventTouch) {
        // Scale down effect
        tween(this.node)
            .to(0.1, { scale: new Vec3(0.95, 0.95, 1) })
            .start();
    }
    
    private onTouchEnd(event: EventTouch) {
        // Scale back
        tween(this.node)
            .to(0.1, { scale: new Vec3(1, 1, 1) })
            .start();
        
        // Trigger click
        if (this._gameConfig && this._onClickCallback) {
            this._onClickCallback(this._gameConfig.id);
        }
    }
    
    private onTouchCancel(event: EventTouch) {
        // Scale back
        tween(this.node)
            .to(0.1, { scale: new Vec3(1, 1, 1) })
            .start();
    }
}
```

- [ ] **步骤 2：Commit**

```bash
git add assets/main/scripts/GameIcon.ts
git commit -m "feat: add game icon component with click animation"
```

---

## 任务 5：创建游戏网格组件

**文件：**
- 创建：`assets/main/scripts/GameGrid.ts`

- [ ] **步骤 1：编写 GameGrid.ts**

```typescript
import { _decorator, Component, Node, Prefab, instantiate, Layout } from 'cc';
import { GameConfig } from '../../common/managers/GameConfig';
import { GameIcon } from './GameIcon';

const { ccclass, property } = _decorator;

@ccclass('GameGrid')
export class GameGrid extends Component {
    @property(Prefab)
    gameIconPrefab: Prefab | null = null;
    
    private _onGameClick: ((gameId: string) => void) | null = null;
    
    setup(games: GameConfig[], onGameClick: (gameId: string) => void) {
        this._onGameClick = onGameClick;
        this.refresh(games);
    }
    
    refresh(games: GameConfig[]) {
        // Clear existing
        this.node.removeAllChildren();
        
        // Create icons
        games.forEach(game => {
            if (this.gameIconPrefab) {
                const node = instantiate(this.gameIconPrefab);
                this.node.addChild(node);
                
                const gameIcon = node.getComponent(GameIcon);
                if (gameIcon) {
                    gameIcon.setup(game, (gameId) => {
                        if (this._onGameClick) {
                            this._onGameClick(gameId);
                        }
                    });
                }
            }
        });
        
        // Update layout
        const layout = this.node.getComponent(Layout);
        if (layout) {
            layout.updateLayout();
        }
    }
}
```

- [ ] **步骤 2：Commit**

```bash
git add assets/main/scripts/GameGrid.ts
git commit -m "feat: add game grid component for layout"
```

---

## 任务 6：创建大厅主逻辑组件

**文件：**
- 创建：`assets/main/scripts/Lobby.ts`

- [ ] **步骤 1：编写 Lobby.ts**

```typescript
import { _decorator, Component, Node, director } from 'cc';
import { GAME_LIST, getGameById } from '../../common/managers/GameConfig';
import { StorageManager } from '../../common/managers/StorageManager';
import { SceneManager } from '../../common/managers/SceneManager';
import { GameGrid } from './GameGrid';

const { ccclass, property } = _decorator;

@ccclass('Lobby')
export class Lobby extends Component {
    @property(Node)
    recentSection: Node | null = null;
    
    @property(GameGrid)
    recentGrid: GameGrid | null = null;
    
    @property(GameGrid)
    allGamesGrid: GameGrid | null = null;
    
    onLoad() {
        this.refreshUI();
    }
    
    refreshUI() {
        const userData = StorageManager.instance.getUserData();
        
        // Setup recent games section
        if (userData.recentGames.length > 0 && this.recentSection && this.recentGrid) {
            this.recentSection.active = true;
            const recentGames = userData.recentGames
                .map(id => getGameById(id))
                .filter(game => game !== undefined) as typeof GAME_LIST;
            this.recentGrid.setup(recentGames, this.onGameClick.bind(this));
        } else if (this.recentSection) {
            this.recentSection.active = false;
        }
        
        // Setup all games grid
        if (this.allGamesGrid) {
            this.allGamesGrid.setup(GAME_LIST, this.onGameClick.bind(this));
        }
    }
    
    onGameClick(gameId: string) {
        const game = getGameById(gameId);
        if (!game) return;
        
        // Save to recent
        StorageManager.instance.addRecentGame(gameId);
        
        // Goto game scene
        SceneManager.gotoGame(gameId, game.sceneName);
    }
}
```

- [ ] **步骤 2：Commit**

```bash
git add assets/main/scripts/Lobby.ts
git commit -m "feat: add lobby main component with recent games support"
```

---

## 任务 7：创建返回按钮组件

**文件：**
- 创建：`assets/common/components/BackButton.ts`

- [ ] **步骤 1：编写 BackButton.ts**

```typescript
import { _decorator, Component, Node, director } from 'cc';
import { SceneManager } from '../managers/SceneManager';

const { ccclass, property } = _decorator;

@ccclass('BackButton')
export class BackButton extends Component {
    onLoad() {
        this.node.on(Node.EventType.TOUCH_END, this.onClick, this);
    }
    
    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this.onClick, this);
    }
    
    private onClick() {
        SceneManager.gotoLobby();
    }
}
```

- [ ] **步骤 2：Commit**

```bash
git add assets/common/components/BackButton.ts
git commit -m "feat: add back button component"
```

---

## 任务 8：创建占位游戏场景组件

**文件：**
- 创建：`assets/game_placeholder/scripts/GamePlaceholder.ts`

- [ ] **步骤 1：编写 GamePlaceholder.ts**

```typescript
import { _decorator, Component, Node, Label, director } from 'cc';
import { SceneManager } from '../../common/managers/SceneManager';
import { getGameById } from '../../common/managers/GameConfig';

const { ccclass, property } = _decorator;

@ccclass('GamePlaceholder')
export class GamePlaceholder extends Component {
    @property(Label)
    titleLabel: Label | null = null;
    
    @property(Label)
    infoLabel: Label | null = null;
    
    onLoad() {
        const gameId = SceneManager.currentGameId;
        const game = getGameById(gameId);
        
        if (game) {
            if (this.titleLabel) {
                this.titleLabel.string = game.name;
            }
            if (this.infoLabel) {
                this.infoLabel.string = `Game ID: ${game.id}\nScene: ${game.sceneName}\n\n(游戏开发中...)`;
            }
        } else {
            if (this.titleLabel) {
                this.titleLabel.string = 'Unknown Game';
            }
            if (this.infoLabel) {
                this.infoLabel.string = 'Game not found';
            }
        }
    }
}
```

- [ ] **步骤 2：Commit**

```bash
git add assets/game_placeholder/scripts/GamePlaceholder.ts
git commit -m "feat: add game placeholder scene component"
```

---

## 任务 9：Cocos Creator 项目初始化

**前置条件：** 已安装 Cocos Dashboard 和 Cocos Creator 3.x

- [ ] **步骤 1：创建 Cocos Creator 项目**

在 Cocos Dashboard 中：
1. 点击"新建项目"
2. 选择"Empty (2D)"模板
3. 项目路径选择 `d:\code\github\tiny_games`
4. 项目名称保持默认或设为 `tiny_games`
5. 点击"创建"

- [ ] **步骤 2：配置项目设置**

在 Cocos Creator 编辑器中：
1. 菜单栏 → 项目 → 项目设置
2. 在"项目数据"中：
   - 设计宽度: 720
   - 设计高度: 1280
   - 适配屏幕宽度: 勾选
3. 在"功能裁剪"中：
   - 3D 引擎: 取消勾选（暂时不需要）
   - 物理引擎: 取消勾选

- [ ] **步骤 3：创建目录结构**

在资源管理器中创建以下文件夹：
```
assets/
├── common/
│   ├── managers/
│   └── components/
├── main/
│   ├── scenes/
│   ├── scripts/
│   └── resources/
└── game_placeholder/
    ├── scenes/
    ├── scripts/
    └── resources/
```

- [ ] **步骤 4：Commit 项目初始化**

```bash
git add .
git commit -m "chore: initialize cocos creator 3.x project"
```

---

## 任务 10：创建大厅场景

- [ ] **步骤 1：创建 Lobby 场景**

1. 在资源管理器中，右键 `assets/main/scenes` → 新建 → Scene
2. 命名为 `Lobby`
3. 双击打开场景

- [ ] **步骤 2：设置 Canvas**

1. 选中 Canvas 节点
2. 在属性检查器中：
   - Canvas 组件 → 设计分辨率: 720 x 1280
   - 适配屏幕宽度: 勾选

- [ ] **步骤 3：创建 UI 节点结构**

在 Canvas 下创建以下节点结构：
```
Canvas
├── bg (Sprite) - 背景
├── content (Node)
│   ├── title (Label) - "Tiny Games"
│   ├── recentSection (Node)
│   │   ├── sectionTitle (Label) - "📌 最近游玩"
│   │   └── recentGrid (Node) - 添加 GameGrid 组件
│   └── allGamesSection (Node)
│       ├── sectionTitle (Label) - "🎮 全部游戏"
│       └── allGamesGrid (Node) - 添加 GameGrid 组件
```

- [ ] **步骤 4：配置 Lobby 组件**

1. 在 Canvas 节点上添加 `Lobby` 组件（脚本）
2. 拖拽对应节点到组件属性：
   - Recent Section: recentSection 节点
   - Recent Grid: recentGrid 节点
   - All Games Grid: allGamesGrid 节点

- [ ] **步骤 5：配置 GameGrid 组件**

1. 选中 recentGrid 节点，添加 `GameGrid` 组件
2. 选中 allGamesGrid 节点，添加 `GameGrid` 组件
3. 为两个节点添加 Layout 组件：
   - Type: GRID
   - Resize Mode: CONTAINER
   - Cell Size: 150 x 180
   - Spacing: 20 x 20
   - Start Axis: HORIZONTAL
   - Constraint: FIXED_COLUMN
   - Constraint Count: 3

- [ ] **步骤 6：创建 GameIcon 预制体**

1. 在 `assets/main/resources` 下创建 `prefabs` 文件夹
2. 在场景中创建一个节点：
   - 命名为 `GameIcon`
   - 大小: 150 x 180
   - 添加 Sprite 作为背景（bgNode）
   - 添加 Label 作为名称（nameLabel）
3. 添加 `GameIcon` 脚本组件
4. 拖拽对应节点到组件属性
5. 将节点拖到 `assets/main/resources/prefabs` 文件夹，创建预制体
6. 删除场景中的 GameIcon 节点

- [ ] **步骤 7：配置 GameGrid 的预制体引用**

1. 选中 recentGrid 节点
2. 将 GameIcon 预制体拖到 GameGrid 组件的 `Game Icon Prefab` 属性
3. 对 allGamesGrid 节点重复相同操作

- [ ] **步骤 8：设置场景为启动场景**

1. 菜单栏 → 项目 → 构建发布
2. 在"场景"中确保 Lobby 被勾选
3. 将 Lobby 拖到最上方作为启动场景

- [ ] **步骤 9：Commit**

```bash
git add assets/main/scenes/Lobby.scene
git add assets/main/resources/prefabs/
git commit -m "feat: create lobby scene with ui layout"
```

---

## 任务 11：创建占位游戏场景

- [ ] **步骤 1：创建 GamePlaceholder 场景**

1. 右键 `assets/game_placeholder/scenes` → 新建 → Scene
2. 命名为 `GamePlaceholder`

- [ ] **步骤 2：创建 UI 节点结构**

```
Canvas
├── bg (Sprite) - 背景色设为深色
├── header (Node)
│   ├── backButton (Node) - 添加 BackButton 组件
│   │   └── label (Label) - "返回"
│   └── title (Label) - 游戏名称
├── content (Node)
│   └── info (Label) - 显示游戏信息
└── footer (Label) - "点击返回回到大厅"
```

- [ ] **步骤 3：配置组件**

1. 在 Canvas 节点添加 `GamePlaceholder` 脚本组件
2. 拖拽 titleLabel 和 infoLabel 到对应属性
3. 在 backButton 节点添加 `BackButton` 脚本组件

- [ ] **步骤 4：Commit**

```bash
git add assets/game_placeholder/scenes/GamePlaceholder.scene
git commit -m "feat: create game placeholder scene"
```

---

## 任务 12：浏览器预览测试

- [ ] **步骤 1：启动预览**

1. 在 Cocos Creator 编辑器中，点击上方工具栏的"预览"按钮
2. 等待浏览器自动打开
3. 预期：看到游戏大厅界面，显示"全部游戏"区域

- [ ] **步骤 2：测试游戏列表**

验证：
- 显示 6 个游戏图标
- 每个图标有名称和彩色背景
- 布局为 3 列网格

- [ ] **步骤 3：测试点击进入游戏**

1. 点击任意游戏图标
2. 预期：跳转到 GamePlaceholder 场景
3. 验证：显示正确的游戏名称和 ID

- [ ] **步骤 4：测试返回大厅**

1. 点击"返回"按钮
2. 预期：回到 Lobby 场景
3. 验证："最近游玩"区域出现，显示刚才点击的游戏

- [ ] **步骤 5：测试最近游玩功能**

1. 点击另一个游戏
2. 返回大厅
3. 验证：最近游玩按时间倒序排列，最多显示 3 个

- [ ] **步骤 6：Commit 测试结果**

```bash
git commit -m "test: verify lobby and game placeholder scenes work correctly"
```

---

## 完成检查清单

Phase 1 完成标准：

- [ ] 项目能在 Cocos Creator 中正常打开
- [ ] 浏览器预览能显示大厅界面
- [ ] 游戏列表显示 6 个游戏图标
- [ ] 点击图标能跳转到占位场景
- [ ] 占位场景显示正确的游戏信息
- [ ] 点击返回能回到大厅
- [ ] 最近游玩记录正确保存和显示
- [ ] 最近游玩为空时区域隐藏
- [ ] 所有代码已提交到 git

---

## 自检

**规格覆盖度检查：**
- ✅ 游戏列表网格展示 → 任务 10
- ✅ "最近游玩"区域 → 任务 6, 10
- ✅ "全部游戏"区域 → 任务 6, 10
- ✅ 点击跳转占位场景 → 任务 6, 8, 11
- ✅ 返回大厅 → 任务 7, 11
- ✅ 本地存储最近记录 → 任务 2, 6

**占位符扫描：**
- ✅ 无"待定"、"TODO"
- ✅ 所有代码完整可执行
- ✅ 所有文件路径明确

**类型一致性：**
- ✅ `GameConfig` 接口在各文件中一致
- ✅ `SceneManager` 方法签名一致
- ✅ 存储键名一致

---

*计划结束*
