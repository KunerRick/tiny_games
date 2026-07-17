# Tiny Games — AI 协作规范（必读）

> 本文件是给 AI 的协作指南。**开始任何代码修改前，先浏览本文的“红线清单”和“当前教训”**。详细背景见下方各章节。

---

## AI 写代码前必读

### 红线清单（违反任意一条 = 大概率崩溃或编码事故）

| # | 规则 | 典型后果 |
|---|------|---------|
| 1 | **禁止用 PowerShell `Set-Content`/`Out-File` 修改含中文的 TypeScript 文件** | UTF-8 字节被重编码为 GBK/ANSI，导致中文字符串全部乱码，`npx tsc` 报大量 `Unterminated string literal` |
| 2 | **所有 Cocos 场景/预制体修改必须通过 MCP 工具** | 直接改 `.scene`/`.prefab` JSON 会破坏编辑器元数据 |
| 3 | **按钮/可点击元素优先用 `@property({ type: Node })` + `Node.EventType.TOUCH_END`** | `@property({ type: Button })` 绑定的是 **Button 组件引用**，MCP 绑节点 UUID 会导致运行时 `Cannot read properties of undefined (reading 'on')` |
| 4 | **`onDestroy()` 不访问任何 `@property(Node)`** | 场景销毁时 getter 可能返回 null，触发空引用崩溃 |
| 5 | **事件 handler 必须是命名方法，禁止匿名 lambda** | 匿名函数无法 `off()` 解绑，造成内存泄漏或重复触发 |
| 6 | **修改 `.ts` 后必须跑 `npx tsc --noEmit` 验证编译** | 早发现编码破坏和类型错误，避免提交后才发现 |
| 7 | **提交前用 `git diff --stat` 和 `git diff <file>` 检查变更范围** | 防止把临时文件/编码破坏/无关改动一起提交 |

### 当前教训（最近踩过的坑）

#### 教训 A：PowerShell 会破坏 UTF-8 中文文件

- **场景**：用 `Set-Content` 批量替换 `BattleUI.ts` 中的 `.node.active`
- **结果**：文件编码被破坏，所有中文字符串变成乱码，全项目编译失败
- **正确做法**：含中文的文件统一用 Python 读写（`encoding='utf-8'`），或直接用 `SearchReplace`/`Write` 工具
- **验证命令**：`npx tsc --noEmit`

#### 教训 B：MCP 绑定 `@property({ type: Button })` 导致运行时崩溃

- **场景**：新增 `AttackButton` 节点后，通过 MCP 把 `BattleUI.attackButton` 属性绑定到节点 UUID
- **结果**：运行时 `attackButton.node` 为 `undefined`，`bindEvents()` 触发 `Cannot read properties of undefined (reading 'on')`
- **根因**：Cocos `@property({ type: Button })` 期望引用 **Button 组件** 的 `__id__`，不是节点的 `__id__`
- **正确做法**：
  - 按钮属性声明为 `@property({ type: Node })`
  - 事件绑定用 `Node.EventType.TOUCH_END`
  - 显隐控制用 `this.attackButton.active = true/false`
  - 这样 MCP 只需绑定节点 UUID，无需关心 Button 组件

#### 教训 C：MCP 创建按钮节点后必须添加 Button 组件（如果仍用 Button 引用）

- **场景**：复制 `WaitButton` 节点得到 `AttackButton`，但新节点缺少 `Button` 组件
- **结果**：`getComponent(Button)` 返回 null，按钮无响应
- **正确做法**：要么走“教训 B”的 Node 方案，要么在 MCP 创建节点后显式 `component_add_component` 添加 `cc.Button`

---

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
│   │   ├── game_2048/
│   │   ├── game_snake/
│   │   ├── game_war_evolution/
│   │   ├── game_tiny_vanguard/
│   │   └── ...future games
│   ├── common/            # 公共模块
│   │   ├── managers/      # SceneManager, StorageManager, GameConfig
│   │   └── components/    # BackButton, SafeAreaAdapter
│   ├── game_placeholder/  # 新游戏模板场景
│   └── resources/         # 动态加载资源
├── docs/                  # 所有文档统一存放（见 docs/README.md）
│   ├── specs/             # 游戏设计规格
│   ├── design/            # UI/场景配置指南
│   ├── plans/             # 实现计划
│   ├── tech/              # 技术决策与踩坑记录
│   └── cocos-best-practices.md
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

**添加新游戏三步骤**：① `GameConfig.ts` 注册 ② 创建 `assets/games/game_xxx/scenes/Xxx.scene` ③ 场景名与 `sceneName` 一致。

## 架构与模式

### 场景导航

- 所有场景切换走 `director.loadScene('SceneName')`
- 公共 `SceneManager` 封装 `gotoLobby()` / `gotoGame(id, sceneName)`
- 返回大厅组件 `BackButton` 通过 `SceneManager.gotoLobby()` 跳转

### 存储

- `StorageManager`（单例）：通用键值存取（`getItem`/`setItem`），键前缀 `tiny_games_${gameId}_`
- 各游戏也可用自己的 `localStorage` 键

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

    onLoad() { this.node.on(EVENT, this.onClick, this); }
    onDestroy() { this.node.off(EVENT, this.onClick, this); }
    // 重新开始用 _cleanupGame() 清理再初始化
    // onDestroy 只清引用，不调 _cleanupGame()
}
```

### 可点击元素推荐写法（Node 事件委托）

```typescript
@property({ type: Node, tooltip: 'XXX按钮节点' })
confirmButton: Node = null;

private bindEvents(): void {
    if (this.confirmButton) {
        this.confirmButton.on(Node.EventType.TOUCH_END, this.onConfirmClicked, this);
    }
}

private unbindEvents(): void {
    if (this.confirmButton) {
        this.confirmButton.off(Node.EventType.TOUCH_END, this.onConfirmClicked, this);
    }
}

private onConfirmClicked(): void { /* ... */ }
```

## 开发者命令

此项目由 Cocos Creator 编辑器管理，无 npm 脚本。构建/预览均通过编辑器 UI 操作。

```bash
# 启动编辑器
/path/to/CocosCreator --path .

# 代码类型检查（修改后必跑）
npx tsc --noEmit
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

## MCP 使用守则

### 核心原则

**所有 Cocos 场景相关的查询和修改，必须通过 Cocos MCP 完成。只有纯代码逻辑（TypeScript 源码增删改）才可以直接修改文件。**

- ❌ **禁止** 直接读取/写入 `.scene` 文件、`.prefab` 文件等 Cocos 编辑器管理的二进制资产
- ❌ **禁止** 通过 `write` / `edit` 等文件工具直接篡改场景 JSON
- ✅ Cocos 场景操作（创建节点、添加组件、修改属性、保存场景等）一律走 MCP 工具调用
- ✅ 纯 `.ts` 代码文件的增删改可以正常使用文件编辑工具

### MCP 工具调用约定

- 结构性变更前调用 `begin_undo_recording` → 操作后 `end_undo_recording`
- 操作后 `validate_scene` 检查一致性 + 修改的脚本 `lsp_diagnostics`
- 场景排查顺序：`get_scene_hierarchy` → `get_node_info` → `validate_scene` → 日志 → `execute_script`
- 新增按钮节点后：**要么用 Node 事件方案（推荐），要么显式添加 `cc.Button` 组件**
- MCP 绑定 `@property` 时：按属性声明的类型绑定。`type: Node` 绑节点 UUID；`type: Button` 绑 Button 组件 UUID

## Git 规范

- 提交格式：`<type>(<scope>): <中文描述>`（如 `feat(snake): 添加虚拟摇杆`）
- type 使用：`feat`, `fix`, `docs`, `chore`, `refactor`
- 不要提交 build/、library/、temp/、local/、profiles/、native/（已在 .gitignore）
- 提交前跑 `npx tsc --noEmit`

## 相关文档

- [Cocos Creator 最佳实践（完整版）](./docs/cocos-best-practices.md)
- [文档索引与定位指南](./docs/README.md)
- [2048 游戏设计](./docs/specs/2026-05-13-game-2048-design.md)
- [贪吃蛇设计](./docs/specs/2026-05-26-game-snake-design.md)
- [战争进化设计](./docs/specs/2026-05-18-game-war-evolution-design.md)
- [Tiny Vanguard 设计](./docs/specs/2026-05-28-tiny-vanguard-design.md)
