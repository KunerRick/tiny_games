# Tiny Games — 项目规范

## 项目概述

小游戏集合，Cocos Creator **3.8.8**，TypeScript。独立场景模式，每游戏独立场景，通过游戏大厅切换时重新加载。

- **引擎**: Cocos Creator 3.8.8
- **语言**: TypeScript (`strict: false`)
- **优先平台**: 微信小游戏 → iOS/Android App
- **MCP**: `opencode.json` 配置远程 MCP — 编辑器启动后通过 `http://localhost:3000/mcp` 连接

## 项目结构

```
tiny_games/
├── assets/
│   ├── main/              # 游戏大厅（Lobby.scene）
│   │   ├── scripts/       # Lobby.ts, GameGrid.ts, GameIcon.ts
│   │   └── resources/prefabs/GameIcon.prefab
│   ├── games/             # 每游戏独立目录
│   │   ├── game_2048/         # 场景: Game2048
│   │   ├── game_snake/        # 场景: Snake
│   │   ├── game_war_evolution/ # 场景: WarEvo
│   │   ├── game_tiny_vanguard/ # 场景: TinyVanguard
│   │   └── ...future games
│   ├── common/            # 公共模块
│   │   ├── managers/      # SceneManager, StorageManager, GameConfig
│   │   └── components/    # BackButton, SafeAreaAdapter
│   ├── game_placeholder/  # 新游戏模板场景
│   └── resources/         # 动态加载资源
├── docs/                  # 所有文档统一存放
│   ├── specs/             # 游戏设计规格
│   ├── design/            # UI 设计指南
│   ├── plans/             # 实现计划
│   └── cocos-best-practices.md  # 防崩溃详解
├── settings/              # Cocos 编辑器设置
└── build/                 # 构建输出（gitignored）
```

## 游戏注册

所有游戏在 `assets/common/managers/GameConfig.ts` 的 `GAME_LIST` 中注册：

```typescript
{ id: '2048',      name: '2048',       icon: 'default', sceneName: 'Game2048' }
{ id: 'war_evo',   name: '战争进化',   icon: 'default', sceneName: 'WarEvo' }
{ id: 'snake',     name: '贪吃蛇',     icon: 'default', sceneName: 'Snake' }
```

**添加新游戏三步骤**：① `GameConfig.ts` 注册 ② 创建 `assets/games/game_xxx/scenes/Xxx.scene` ③ 场景名与 `sceneName` 一致。已有游戏清单和 `GamePlaceholder.scene` 可做模板。

## 架构与模式

### 场景导航

- 所有场景切换走 `director.loadScene('SceneName')`
- 公共 `SceneManager` 封装 `gotoLobby()` / `gotoGame(id, sceneName)`
- 返回大厅组件 `BackButton` 通过 `SceneManager.gotoLobby()` 跳转

### 存储

- `StorageManager`（单例）：通用键值存取（`getItem`/`setItem`），键前缀 `tiny_games_${gameId}_`
- 各游戏也可用自己的 `localStorage` 键（如蛇的 `tiny_games_snake_data`）

### 游戏生命周期约定

```
onLoad()    → 绑定事件、初始化状态
start()     → 延迟初始化（场景节点已就绪）
update(dt)  → 每帧逻辑
onDestroy() → 仅清 JS 引用，不碰任何 @property(Node) 方法和节点
```

### 代码模式（所有游戏一致）

```typescript
const { ccclass, property } = _decorator;
@ccclass('GameName')
export class GameName extends Component {
    @property(Node)     someNode: Node | null = null;
    @property(Label)    someLabel: Label | null = null;
    // 绑定在 onLoad，解绑在 onDestroy，用命名方法
    onLoad() { this.node.on(EVENT, this.onClick, this); }
    onDestroy() { this.node.off(EVENT, this.onClick, this); }
    // 重新开始用 _cleanupGame() 清理再初始化
    // onDestroy 只清引用，不调 _cleanupGame()
}
```

## 开发者命令

此项目由 Cocos Creator 编辑器管理，无 npm 脚本。构建/预览均通过编辑器 UI 操作。

唯一可用的 CLI 操作：

```bash
# 启动编辑器（等价于双击 .cconfig 或项目目录）
/path/to/CocosCreator --path .
```

## 防崩溃守则（违反即崩）

完整解释见 [`docs/cocos-best-practices.md`](./docs/cocos-best-practices.md)。

1. **永远不用匿名 lambda 做事件 handler** — 命名方法才能解绑
2. **`onDestroy()` 中不访问任何 `@property(Node)`** — getter 可能已返回 null
3. **重启清理 ≠ 场景销毁** — `_cleanupGame()` 和 `onDestroy()` 职责分离
4. **遍历销毁不用 `Array.from`** — 引擎清空字段后 `Array.from(null)` 抛异常
5. **destroy 前检查 `isValid`**
6. **面板类在 `show()` 中绑定事件** — 未激活节点 `onLoad()` 不执行
7. **Tween 前检查 `isValid`**，不直接 tween `Color` 对象

## MCP 使用守则（重要）

> ⚠️ 以下规则覆盖旧版"ＭCP 操作要点"中的全部内容，旧版已废弃。

### 核心原则

**所有 Cocos 场景相关的查询和修改，必须通过 Cocos MCP 完成。只有纯代码逻辑（TypeScript 源码增删改）才可以直接修改文件。**

这意味着：
- ❌ **禁止** 直接读取/写入 `.scene` 文件、`.prefab` 文件等 Cocos 编辑器管理的二进制资产
- ❌ **禁止** 通过 `write` / `edit` 等文件工具直接篡改场景 JSON
- ✅ Cocos 场景操作（创建节点、添加组件、修改属性、保存场景等）一律走 MCP 工具调用
- ✅ 纯 `.ts` 代码文件的增删改可以正常使用文件编辑工具

### MCP 工具调用约定

- 结构性变更前调用 `begin_undo_recording` → 操作后 `end_undo_recording`
- 操作后 `validate_scene` 检查一致性 + 修改的脚本 `lsp_diagnostics`
- 场景排查顺序：`get_scene_hierarchy` → `get_node_info` → `validate_scene` → 日志 → `execute_script`

## Git 规范

- 提交格式：`<type>(<scope>): <中文描述>`（如 `feat(snake): 添加虚拟摇杆`）
- type 使用：`feat`, `fix`, `docs`, `chore`, `refactor`
- 不要提交 build/、library/、temp/、local/、profiles/、native/（已在 .gitignore）

## 相关文档

- [Cocos Creator 最佳实践（完整版）](./docs/cocos-best-practices.md)
- [2048 游戏设计](./docs/specs/2026-05-13-game-2048-design.md)
- [贪吃蛇设计](./docs/specs/2026-05-26-game-snake-design.md)
- [战争进化设计](./docs/specs/2026-05-18-game-war-evolution-design.md)
- [Tiny Vanguard 设计](./docs/specs/2026-05-28-tiny-vanguard-design.md)
