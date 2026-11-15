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
| 10 | **图标字符串写进 `Label.string` 前必须过 `stripVariationSelectors()`；`assets/` 内不得残留 `U+FE0E`/`U+FE0F`** | 变体选择符（VS16）在微信字体下渲染成小方框（tofu），桌面预览看不出来 |

### 当前教训（速查；详情见 `docs/tech/`）

| # | 教训（一句话） | 详情 |
|---|---------------|------|
| C | 新建/复制的按钮节点可能**没有 `Button` 组件** → `getComponent(Button)` 返回 null、按钮无响应；补挂 `cc.Button` 时**别再 `addComponent(UITransform)`**。另：设 `contentSize` 必须**在 `spriteFrame` 之后**（顺序反了会被贴图原始尺寸覆盖成 2×2），MCP 写 `anchorPoint` 的 `x=0` 会被吞掉，均须读回核对 | [`tech/mcp-scene-authoring-pitfalls.md`](./docs/tech/mcp-scene-authoring-pitfalls.md) §3、§3.5 |
| D | 浏览器验证六坑：改完 `.ts` 先 `project_refresh_assets`；**点击入参比例每轮现场标定**（`clientX = 传入 / k`，k 随视口变化，实测出现过 1/2/1.225，曾误判成回归）；页面重载会清掉页内探针；懒初始化面板 `show()` 先置 `_showCalled` 再置 `active`；**桌面拖拽结束派发的是 `TOUCH_CANCEL` 而非 `TOUCH_END`**（当成"中断回位"会让拖拽永不生效；但**抬起时指针仍在起点节点内则是 `TOUCH_END`**），且手势监听要挂到两个子树的**共同父级**；**拖拽阈值 + "已消费"标记会把轻触静默吃掉**（阈值 8 设计像素 ≈ 4.3pt，实测横移 5 CSS 像素即"点了没反应"，修法是让"拖了个空"的手势显式退回点击回调）；**页内注入只认 `MouseEvent`（`PointerEvent` 无效），全局 `input` 收不到桌面鼠标的 `TOUCH_END` 要另绑 `MOUSE_UP`** | [`tech/browser-verify-cocos-preview.md`](./docs/tech/browser-verify-cocos-preview.md) §4、§7.1、§8、§11、§11.6、§11.8 |
| E | 布局三坑：① 绑 `@property(Label)` 这类**组件引用**要 `propertyType:'component'` + **节点** UUID（写 `'cc.Label'` 会被拒，且内置组件返回的 `uuid` 常为 `null`）；② 跨面板常驻 HUD（`HudTop`）的显隐只能有**一个**管理者，否则 `active=false` 的面板 `onLoad()` 不执行、残留「回合 1」；③ 纵向 `ScrollView` **不校正 content 的 x**，且滚动区占满全屏时第一行会被固定表头压住 | [`tech/mcp-scene-authoring-pitfalls.md`](./docs/tech/mcp-scene-authoring-pitfalls.md) §3.5 ④–⑦ |
| F | **在正在执行的回调里用同一 `(target, method)` 自排期，会被引擎静默丢弃**（同回调去重 + 一次性计时器随即取消）→ 回合永久卡在 `enemy_turn`，且**不报错**。要等下一拍就用「时间点数字 + `update()` 泵」并加看门狗兜底；判据：把 `scheduleOnce(this.cb, …)` 换成 `scheduleOnce(() => this.cb(), …)`，从只触发 1 次变 N 次即证实 | [`tech/cocos-scheduler-and-tween-pitfalls.md`](./docs/tech/cocos-scheduler-and-tween-pitfalls.md) |
| G | **微信小游戏「能编译」不等于「能跑」**。① **时序**：Cocos 构建会「先清空目录、再逐个重写」，而开发者工具会随目录变动自动重编译 —— 重叠时它在 `game.json` 还没写出的瞬间去读它，报「未找到 game.json 文件」并**放弃后不再重试**（判据：内容一字未改、只重新编译一次就恢复 ⇒ 时序问题）。② **包装器/项目类型**：工具若把项目按**小程序**编译（`isGame` 取的是 AppID 的**服务端**属性 `attr.gameApp`，本地 `compileType:"game"` 不决定它），会给每个模块套上 `function(require, module, exports, window, top, …)`，而小游戏运行时只传 **3 个实参** ⇒ `window` 为 undefined ⇒ 启动期 `TypeError: Object.defineProperty called on non-object`。**`simulator launch success` 不证明游戏无异常**。构建前先关掉工具里的该项目，构建完成后跑 `node tools/check-wechat-build.js`（9 项，含 AppID 与包装判定）+ `node tools/replay-wechat-bundle.js` 再打开 | [`tech/wechat-build-pitfalls.md`](./docs/tech/wechat-build-pitfalls.md) §1–§8 |
| H | **全屏遮罩 + `TOUCH_START` 吞事件会让同级的返回键变哑**（同级之间不冒泡）：结算面板必须自带「返回大厅」，并把返回键 `setSiblingIndex` 抬到遮罩之上；遮罩 alpha 统一 235。另：`createButton` 的 `onTap` 调用**不带 `this`**，类方法要包 `() => this.x()` | [`tech/ui-overlay-exit-and-modal-patterns.md`](./docs/tech/ui-overlay-exit-and-modal-patterns.md) |

> 维护约定：本表保持 **3–6 条**高价值教训（当前 6 条，**已到上限**；再加一条前先把最旧的一条迁到 `docs/tech/` 并在此留索引）。
> 已迁出：原行 A（PowerShell `Set-Content`/`Out-File` 把含中文的 `.ts` 重编码成 GBK/ANSI）—— 规则本身见**红线 1**，详情已迁至 [`tech/dev-toolchain-notes.md`](./docs/tech/dev-toolchain-notes.md) §1；
> 原行 B（`@property({ type: Button })` 绑的是组件不是节点）—— 规则本身见**红线 3**，详情已迁至 [`tech/mcp-scene-authoring-pitfalls.md`](./docs/tech/mcp-scene-authoring-pitfalls.md) §2。

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
│   ├── games/             # 每游戏独立目录 game_<id>/（含 scenes/ + scripts/）
│   │                      # 场景名与 GameConfig.sceneName 一致；id 清单见 GameConfig.ts
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
├── tools/                 # 本地校验/同步脚本，清单与覆盖范围见 docs/tech/verify-scripts.md
├── settings/              # Cocos 编辑器设置
├── extensions/            # 编辑器插件（tsconfig 排除；node_modules 已 gitignore）
└── build/                 # 构建输出（gitignored）
```

## 游戏注册

**唯一源**：`assets/common/managers/GameConfig.ts` 的 `GAME_LIST`（id / name / icon / sceneName / description）。
本文件**不再抄写整张表**——手抄副本会漂移（已经发生过：脚本清单漏了 12 个，见 `docs/tech/verify-scripts.md`）。
查 id：`grep -oE "id: '[^']+'" assets/common/managers/GameConfig.ts`。

**添加新游戏四步骤**：① `GameConfig.ts` 注册 ② 创建 `assets/games/game_xxx/scenes/Xxx.scene` ③ 场景名与 `sceneName` 一致 ④ **在 `GameIconArt.ts` 补 `ACCENTS[id]` + `drawShape` 的 `case 'id':`**（漏了会落回兜底问号，大厅里和别的游戏长一样），改完跑 `node tools/check-game-icons.js`；规范见 [`design/2026-11-10-ui-art-style-guide.md`](./docs/design/2026-11-10-ui-art-style-guide.md)。

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

纯逻辑自检（**改过 `*Core.ts` 必跑对应脚本**，退出码 0 = 通过）：

```bash
node tools/verify-<game>-core.js      # 例：node tools/verify-tetris-core.js
```

全部脚本的清单、覆盖范围与「何时跑」见 [`docs/tech/verify-scripts.md`](./docs/tech/verify-scripts.md)。
每个游戏各有一份 `verify-*-core.js`，新增游戏时按惯例补一份。

大厅图标覆盖自检（**新增游戏后必跑**；退出码 0 = GAME_LIST 每款都有专属强调色与图形）：

```bash
node tools/check-game-icons.js                   # 全部游戏全覆盖才通过
node tools/check-game-icons.js --art <改坏的副本>  # 自测用：验证脚本真能拦住漏登记
# 只查登记表，不判「两个图标长得像」；规范见 docs/design/2026-11-10-ui-art-style-guide.md
```

微信小游戏构建产物预检（**把 `build/wechatgame/` 交给微信开发者工具之前跑**，退出码 0 = 可开）：

```bash
node tools/check-wechat-build.js                 # 默认检查 build/wechatgame
node tools/check-wechat-build.js <构建目录>       # 检查其它构建输出

node tools/replay-wechat-bundle.js               # 复现/反证：产物在「小游戏包装」下能否加载
```

构建场景清单同步（**新增游戏后、构建之前做**）。**不要默认让用户退出编辑器**，按阶梯选手段：

1. **编辑器在跑（首选）**：MCP `preferences_set_preferences_config` **带 `path`**，分别写
   `builder` + `common.scenes` 与 `builder` + `BuildTaskManager.taskMap.<任务号>.options.scenes`；
   编辑器自己写盘，不会被内存刷回。
2. **编辑器没开**：`node tools/sync-build-scenes.js`（检测到编辑器在跑会拒绝写入，`--force` 可越过）。
3. **平台副本**：`profiles/v2/packages/wechatgame.json` 的 `builder.common.scenes`（MCP 够不到）。
4. **兜底**：`macos-computer-use` 技能操作构建面板，`cu shot` 截图核对勾选数。

```bash
node tools/sync-build-scenes.js --check   # 只读校验：三处都齐才退出码 0（编辑器在跑也能跑）
node tools/sync-build-scenes.js --all     # 顺带修其它平台的构建任务快照
```

**判据**：`--check` 退出码 0 + MCP 读回 `common.scenes` / taskMap 的项数与顺序都对得上；
面板是否真勾上要靠 `cu shot` 截图，不能只看 `set` 的 `success`。
完整阶梯、MCP 构建能力边界与 9 项预检的故障排查见
[`docs/tech/wechat-build-pitfalls.md`](./docs/tech/wechat-build-pitfalls.md) §8–§9。

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
- **点击坐标**：按设备像素传（= CSS 坐标 × `devicePixelRatio`）。注意 `k` **不一定等于 dpr、且每轮会变**（实测出现过 1 / 2 / 1.225），务必现场标定，见手册 §4。
- **拖拽/手势**：能用真实 `drag` 驱动；但桌面下结束事件是 `TOUCH_CANCEL`、监听要挂共同父级 —— 语义与边界见手册 §11。
- **日志**：浏览器 logs + `debug_get_console_logs`（`filter:"error"`）+ `debug_search_project_logs`。
- 读数互相矛盾时**先怀疑探针**（字段名/坐标换算），再判定是否游戏缺陷。

完整手册（坐标换算代码、加速注入与声明纪律、易错字段表、可复用验证顺序、**拖拽/手势验证与能力边界**）：[`docs/tech/browser-verify-cocos-preview.md`](./docs/tech/browser-verify-cocos-preview.md)。

### 试玩-修复闭环（不用人工当信使）

「试玩者出报告 → 开发者修 → 复核」不要再用两个会话人工转发。说 **「试玩循环」**（或
`/playtest <范围>`）即可，协议见 [`tech/playtest-cycle.md`](./docs/tech/playtest-cycle.md)：
主会话当调度者 + 开发者，**fresh 子代理**当试玩者/复核者（`fork` 会继承开发者结论，不能用），
通过 `docs/plans/<日期>-playtest-round<N>-<scope>.md` 的文件交接，串行跑，P0/P1 清零即止。
三条硬约束：预览/MCP 单例 → 不能并行；编辑器只编译启动目录 → 不在 worktree 里验；
试玩者不得改状态作弊。

## Git 规范

- 提交格式：`<type>(<scope>): <中文描述>`（如 `feat(snake): 添加虚拟摇杆`）
- type 使用：`feat`, `fix`, `docs`, `chore`, `refactor`
- 不要提交 build/、library/、temp/、local/、profiles/、native/（已在 .gitignore）
- 提交前跑 `npx tsc --noEmit`

### 分支模型（两个长期分支，不再开一堆）

| 分支 | 角色 | 规则 |
|------|------|------|
| `develop` | **默认分支 / 日常开发** | 所有提交都落在这里，始终保持最新；仓库的默认分支就是它 |
| `main` | **发布分支** | 只在发版时从 `develop` 快进合并（`git merge --ff-only develop`），平时不动 |

- 临时特性分支从 `develop` 拉，合并回 `develop` 后**立刻删除**（本地 + 远端），不要留存
- `git worktree` 用完即删：`git worktree remove <路径>` + `git branch -d <分支>`，避免留下指向旧分支的僵尸目录
- 定期 `git remote prune origin` 清理已删除的远端分支；`git branch -vv --merged develop` 列出可删的已合并分支
- 历史上的 `worktree-*` / `feat/*` 分支已全部并入 `develop` 并删除，不要再捡回来当长期分支

## 相关文档

- [文档索引与定位指南](./docs/README.md) —— **按游戏找设计 / 计划 / 验脚本先看这里**
- [Cocos Creator 最佳实践（完整版）](./docs/cocos-best-practices.md)
- [浏览器操作验证手册](./docs/tech/browser-verify-cocos-preview.md)
- [全站 UI / 图标美术规范](./docs/design/2026-11-10-ui-art-style-guide.md)
- [MCP 场景 / 预制体编辑坑](./docs/tech/mcp-scene-authoring-pitfalls.md)
- [排期 / 补间陷阱（自排期回调被丢弃 → 回合卡死）](./docs/tech/cocos-scheduler-and-tween-pitfalls.md)
- [结算遮罩与退出路径](./docs/tech/ui-overlay-exit-and-modal-patterns.md)
- [微信文本渲染（VS16 → 图标方框）](./docs/tech/wechat-text-rendering.md)
- [微信小游戏构建产物与预检](./docs/tech/wechat-build-pitfalls.md)
- [开发工具链备忘（编码 / `tsc` / 提交检查）](./docs/tech/dev-toolchain-notes.md)
- [试玩-修复闭环（说「试玩循环」或 `/playtest`）](./docs/tech/playtest-cycle.md)
- [tools 脚本清单](./docs/tech/verify-scripts.md)
- [品类盘点与下一批路线图](./docs/plans/2026-11-05-game-catalog-and-roadmap.md)

> 各游戏的设计 / 验收 / 试玩报告在 [`docs/README.md`](./docs/README.md) 的**按游戏分类**里，
> 本文件不再逐款列链接。
