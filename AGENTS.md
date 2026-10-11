# Tiny Games — AI 协作规范（必读）

> 本文件是给 AI 的协作指南。**开始任何代码修改前，先浏览本文的“红线清单”和“当前教训”**。详细背景见下方各章节。

---

## AI 写代码前必读

### 红线清单（违反任意一条 = 大概率崩溃或编码事故）

| # | 规则 | 典型后果 |
|---|------|---------|
| 1 | **禁止用 PowerShell `Set-Content`/`Out-File` 修改含中文的 TypeScript 文件** | UTF-8 字节被重编码为 GBK/ANSI，导致中文字符串全部乱码，`npx tsc` 报大量 `Unterminated string literal` |
| 2 | **所有 Cocos 场景/预制体的查询与修改必须通过 MCP 工具** | 直接读写 `.scene`/`.prefab` JSON 会破坏编辑器元数据 |
| 3 | **按钮/可点击元素优先用 `@property({ type: Node })` + `Node.EventType.TOUCH_END`** | `@property({ type: Button })` 绑定的是 **Button 组件引用**，MCP 绑节点 UUID 会导致运行时 `Cannot read properties of undefined (reading 'on')` |
| 4 | **`onDestroy()` 不访问任何 `@property(Node)`** | 场景销毁时 getter 可能返回 null，触发空引用崩溃 |
| 5 | **事件 handler 必须是命名方法，禁止匿名 lambda** | 匿名函数无法 `off()` 解绑，造成内存泄漏或重复触发 |
| 6 | **修改 `.ts` 后必须跑 `npx tsc --noEmit` 验证编译** | 早发现编码破坏和类型错误，避免提交后才发现 |
| 7 | **提交前用 `git diff --stat` 和 `git diff <file>` 检查变更范围** | 防止把临时文件/编码破坏/无关改动一起提交 |
| 8 | **改完 `.ts` 后先调 MCP `project_refresh_assets` 刷新资产库，再重载预览页** | 编辑器不会自动重编译文件系统改动，预览仍跑旧代码，会误判“修复无效” |
| 9 | **用浏览器工具点击预览时，坐标按设备像素传（= CSS 坐标 × `devicePixelRatio`）** | 传 CSS 坐标会静默点偏，造出“点了没反应”的假象 |

### 当前教训（速查；详情见 `docs/tech/`）

| # | 教训（一句话） | 详情 |
|---|---------------|------|
| A | PowerShell `Set-Content`/`Out-File` 会把含中文的 `.ts` 重编码成 GBK/ANSI：中文全乱码、`tsc` 报大量 `Unterminated string literal` | [`tech/dev-toolchain-notes.md`](./docs/tech/dev-toolchain-notes.md) §1 |
| B | `@property({ type: Button })` 绑的是 **Button 组件**、不是节点；MCP 绑节点 UUID → 运行时 `Cannot read properties of undefined (reading 'on')`。改用 `@property({ type: Node })` + `Node.EventType.TOUCH_END` | [`tech/mcp-scene-authoring-pitfalls.md`](./docs/tech/mcp-scene-authoring-pitfalls.md) §2 |
| C | 新建/复制的按钮节点可能**没有 `Button` 组件** → `getComponent(Button)` 返回 null、按钮无响应；补挂 `cc.Button` 时**别再 `addComponent(UITransform)`** | [`tech/mcp-scene-authoring-pitfalls.md`](./docs/tech/mcp-scene-authoring-pitfalls.md) §3–4 |
| D | 浏览器验证三坑：改完 `.ts` 先 `project_refresh_assets`；点击坐标传**设备像素**（CSS × dpr）；懒初始化面板 `show()` 先置 `_showCalled` 再置 `active` | [`tech/browser-verify-cocos-preview.md`](./docs/tech/browser-verify-cocos-preview.md) |

> 维护约定：本表保持 **3–5 条**高价值教训；新教训超出时按主题迁到 `docs/tech/`，这里只留一行索引。

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
│   ├── main/              # 游戏大厅（scenes/Lobby.scene）
│   │   ├── scripts/       # Lobby.ts, GameGrid.ts, GameIcon.ts
│   │   └── resources/prefabs/GameIcon.prefab
│   ├── games/             # 每游戏独立目录（每个含 scenes/ + scripts/）
│   │   ├── game_2048/          # 场景: Game2048
│   │   ├── game_snake/         # 场景: Snake
│   │   ├── game_war_evolution/ # 场景: WarEvo
│   │   └── game_tiny_vanguard/ # 场景: TinyVanguard
│   ├── common/            # 公共模块
│   │   ├── managers/      # SceneManager, StorageManager, GameConfig
│   │   └── components/    # BackButton, SafeAreaAdapter
│   ├── game_placeholder/  # 新游戏模板（scenes/GamePlaceholder.scene）
│   └── Cocos UI/          # 编辑器 UI 素材
├── docs/                  # 所有文档统一存放（见 docs/README.md）
│   ├── specs/             # 游戏设计规格
│   ├── design/            # UI/场景配置指南
│   ├── plans/             # 实现计划
│   ├── superpowers/       # 历史迭代计划/规格
│   ├── assets/            # 文档配图
│   ├── tech/              # 技术决策与踩坑详情（AGENTS.md 教训的展开）
│   └── cocos-best-practices.md
├── tools/                 # 本地校验脚本（如 verify-battle-fixes.js）
├── settings/              # Cocos 编辑器设置
├── extensions/            # 编辑器插件（tsconfig 排除；node_modules 已 gitignore）
└── build/                 # 构建输出（gitignored）
```

## 游戏注册

所有游戏在 `assets/common/managers/GameConfig.ts` 的 `GAME_LIST` 中注册：

```typescript
{ id: '2048',         name: '2048',     icon: 'default', sceneName: 'Game2048',     description: '经典数字合并游戏' }
{ id: 'war_evo',      name: '战争进化', icon: 'default', sceneName: 'WarEvo',       description: '时代进化对推' }
{ id: 'snake',        name: '贪吃蛇',   icon: 'default', sceneName: 'Snake',        description: '大作战风格贪吃蛇' }
{ id: 'tiny_vanguard', name: '小小先锋', icon: 'default', sceneName: 'TinyVanguard', description: 'Roguelike 回合制战棋' }
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

此项目由 Cocos Creator 编辑器管理，`package.json` 无 `scripts`，构建/预览均通过编辑器 UI 操作。唯一依赖是 `typescript@^5.4.5`（devDependency，需先 `npm install`）。

```bash
# 启动编辑器
/path/to/CocosCreator --path .

# 代码类型检查（修改 .ts 后必跑）
# 注意：tsconfig.json extends ./temp/tsconfig.cocos.json，需编辑器生成过 temp/ 才能通过
# 若 npx tsc 解析到全局 6.x，会报 tsconfig 自身的 TS5107 弃用错误（与你的改动无关），改用编辑器自带版本：
TSC="/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc"
node "$TSC" --noEmit && echo TS_OK   # 实测 Version 5.8.2 通过
```

静态校验脚本（可选，Tiny Vanguard 战斗修复回归自检）：

```bash
node tools/verify-battle-fixes.js
# 注意：脚本内 ROOT 硬编码为作者的 Windows 路径，跨机运行前需先改成本机绝对路径
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

### 浏览器操作验证（可视化交互验证）

验证真实交互（点击、技能释放、面板流转、报错/崩溃）时，用编辑器预览服务器 + 浏览器工具操作，**不要只读代码就下结论**。

- **预览地址**：`http://127.0.0.1:7456/`（先 `lsof -nP -iTCP:7456 -sTCP:LISTEN` 确认在跑）。MCP **不能**启动预览（`project_run_project` 只开构建面板、`project_start_preview_server` 返回不支持）。
- **改了 `.ts`**：`project_refresh_assets` → 重载页面 → 用 `typeof comp.新方法 === 'function'` 确认新代码已加载。
- **页内探针**：用 `eval` 读 `window.cc` 的节点/组件/私有状态（如 `_phase`、`_selectedUnit`、`activeInHierarchy`）做断言；组件用字符串名 `getComponent('cc.UITransform')`。
- **点击坐标**：按设备像素传（= CSS 坐标 × `devicePixelRatio`）。
- **日志**：浏览器 logs + `debug_get_console_logs`（`filter:"error"`）+ `debug_search_project_logs`。
- 读数互相矛盾时**先怀疑探针**（字段名/坐标换算），再判定是否游戏缺陷。

完整手册（坐标换算代码、加速注入与声明纪律、易错字段表、可复用验证顺序）：[`docs/tech/browser-verify-cocos-preview.md`](./docs/tech/browser-verify-cocos-preview.md)。

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
