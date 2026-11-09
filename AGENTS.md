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
| B | `@property({ type: Button })` 绑的是 **Button 组件**、不是节点；MCP 绑节点 UUID → 运行时 `Cannot read properties of undefined (reading 'on')`。改用 `@property({ type: Node })` + `Node.EventType.TOUCH_END` | [`tech/mcp-scene-authoring-pitfalls.md`](./docs/tech/mcp-scene-authoring-pitfalls.md) §2 |
| C | 新建/复制的按钮节点可能**没有 `Button` 组件** → `getComponent(Button)` 返回 null、按钮无响应；补挂 `cc.Button` 时**别再 `addComponent(UITransform)`**。另：设 `contentSize` 必须**在 `spriteFrame` 之后**（顺序反了会被贴图原始尺寸覆盖成 2×2），MCP 写 `anchorPoint` 的 `x=0` 会被吞掉，均须读回核对 | [`tech/mcp-scene-authoring-pitfalls.md`](./docs/tech/mcp-scene-authoring-pitfalls.md) §3、§3.5 |
| D | 浏览器验证六坑：改完 `.ts` 先 `project_refresh_assets`；**点击入参比例每轮现场标定**（`clientX = 传入 / k`，k 随视口变化，实测出现过 1/2/1.225，曾误判成回归）；页面重载会清掉页内探针；懒初始化面板 `show()` 先置 `_showCalled` 再置 `active`；**桌面拖拽结束派发的是 `TOUCH_CANCEL` 而非 `TOUCH_END`**（当成"中断回位"会让拖拽永不生效；但**抬起时指针仍在起点节点内则是 `TOUCH_END`**），且手势监听要挂到两个子树的**共同父级**；**拖拽阈值 + "已消费"标记会把轻触静默吃掉**（阈值 8 设计像素 ≈ 4.3pt，实测横移 5 CSS 像素即"点了没反应"，修法是让"拖了个空"的手势显式退回点击回调） | [`tech/browser-verify-cocos-preview.md`](./docs/tech/browser-verify-cocos-preview.md) §4、§7.1、§8、§11、§11.6 |
| E | 布局三坑：① 绑 `@property(Label)` 这类**组件引用**要 `propertyType:'component'` + **节点** UUID（写 `'cc.Label'` 会被拒，且内置组件返回的 `uuid` 常为 `null`）；② 跨面板常驻 HUD（`HudTop`）的显隐只能有**一个**管理者，否则 `active=false` 的面板 `onLoad()` 不执行、残留「回合 1」；③ 纵向 `ScrollView` **不校正 content 的 x**，且滚动区占满全屏时第一行会被固定表头压住 | [`tech/mcp-scene-authoring-pitfalls.md`](./docs/tech/mcp-scene-authoring-pitfalls.md) §3.5 ④–⑦ |
| F | **在正在执行的回调里用同一 `(target, method)` 自排期，会被引擎静默丢弃**（同回调去重 + 一次性计时器随即取消）→ 回合永久卡在 `enemy_turn`，且**不报错**。要等下一拍就用「时间点数字 + `update()` 泵」并加看门狗兜底；判据：把 `scheduleOnce(this.cb, …)` 换成 `scheduleOnce(() => this.cb(), …)`，从只触发 1 次变 N 次即证实 | [`tech/cocos-scheduler-and-tween-pitfalls.md`](./docs/tech/cocos-scheduler-and-tween-pitfalls.md) |
| G | **微信小游戏「能编译」不等于「能跑」**。① **时序**：Cocos 构建会「先清空目录、再逐个重写」，而开发者工具会随目录变动自动重编译 —— 重叠时它在 `game.json` 还没写出的瞬间去读它，报「未找到 game.json 文件」并**放弃后不再重试**（判据：内容一字未改、只重新编译一次就恢复 ⇒ 时序问题）。② **包装器/项目类型**：工具若把项目按**小程序**编译（`isGame` 取的是 AppID 的**服务端**属性 `attr.gameApp`，本地 `compileType:"game"` 不决定它），会给每个模块套上 `function(require, module, exports, window, top, …)`，而小游戏运行时只传 **3 个实参** ⇒ `window` 为 undefined ⇒ 启动期 `TypeError: Object.defineProperty called on non-object`。**`simulator launch success` 不证明游戏无异常**。构建前先关掉工具里的该项目，构建完成后跑 `node tools/check-wechat-build.js`（9 项，含 AppID 与包装判定）+ `node tools/replay-wechat-bundle.js` 再打开 | [`tech/wechat-build-pitfalls.md`](./docs/tech/wechat-build-pitfalls.md) §1–§8 |

> 维护约定：本表保持 **3–5 条**高价值教训（当前 6 条已达上限，再加一条前先把最旧的一条迁到 `docs/tech/` 并在此留索引）。
> 已迁出：原行 A（PowerShell `Set-Content`/`Out-File` 把含中文的 `.ts` 重编码成 GBK/ANSI）—— 规则本身见**红线 1**，详情已迁至 [`tech/dev-toolchain-notes.md`](./docs/tech/dev-toolchain-notes.md) §1。

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
│   │   ├── game_tiny_vanguard/ # 场景: TinyVanguard
│   │   ├── game_tetris/        # 场景: Tetris
│   │   ├── game_brick/         # 场景: BrickBreaker（打砖块 + 轻肉鸽）
│   │   ├── game_merge/         # 场景: Merge（合合大作战）
│   │   ├── game_gate_runner/   # 场景: GateRunner（数值冲刺）
│   │   ├── game_solitaire/     # 场景: Solitaire（纸牌接龙）
│   │   ├── game_survivor/      # 场景: Survivor（午夜幸存者）
│   │   ├── game_minesweeper/   # 场景: Minesweeper（扫雷）
│   │   ├── game_sudoku/        # 场景: Sudoku（数独）
│   │   ├── game_idiom/         # 场景: Idiom（成语填字）
│   │   ├── game_gomoku/        # 场景: Gomoku（五子棋）
│   │   ├── game_idle/          # 场景: Idle（小店日记）
│   │   ├── game_match3/        # 场景: Match3（缤纷消除）
│   │   ├── game_tower_defense/ # 场景: TowerDefense（守卫塔楼）
│   │   ├── game_pool/          # 场景: Pool（台球）
│   │   ├── game_wordle/        # 场景: Wordle（成语猜猜）
│   │   ├── game_shmup/         # 场景: Shmup（星际弹幕）
│   │   └── game_thunder/       # 场景: Thunder（雷霆战机）
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
├── tools/                 # 本地校验/同步脚本（verify-battle-fixes.js、verify-tetris-core.js、verify-idiom-core.js、verify-gomoku-core.js、verify-idle-core.js、verify-match3-core.js、verify-td-core.js、verify-pool-core.js、verify-wordle-core.js、verify-shmup-core.js、verify-thunder-core.js、check-wechat-build.js、replay-wechat-bundle.js、sync-build-scenes.js）
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
{ id: 'tetris',       name: '方块坠落', icon: 'default', sceneName: 'Tetris',       description: '经典方块消除' }
{ id: 'brick',        name: '砖块远征', icon: 'default', sceneName: 'BrickBreaker', description: '打砖块 + 肉鸽升级' }
{ id: 'merge',        name: '合合大作战', icon: 'default', sceneName: 'Merge',      description: '合成同类水果，越滚越大' }
{ id: 'gate_runner',  name: '数值冲刺', icon: 'default', sceneName: 'GateRunner',   description: '穿过 ×2 / ÷2 数值门，带队伍冲到 Boss' }
{ id: 'solitaire',    name: '纸牌接龙', icon: 'default', sceneName: 'Solitaire',    description: '克朗代克单人纸牌' }
{ id: 'survivor',     name: '午夜幸存者', icon: 'default', sceneName: 'Survivor',  description: '8 分钟肉鸽生存，自动攻击 + 三选一构筑' }
{ id: 'minesweeper',  name: '扫雷',     icon: 'default', sceneName: 'Minesweeper', description: '经典扫雷，首点安全 + 和弦' }
{ id: 'sudoku',       name: '数独',     icon: 'default', sceneName: 'Sudoku',      description: '经典数独，笔记 / 提示 / 撤销' }
{ id: 'idiom',        name: '成语填字', icon: 'default', sceneName: 'Idiom',       description: '纵横交叉填成语，全部锁定通关' }
{ id: 'gomoku',       name: '五子棋',   icon: 'default', sceneName: 'Gomoku',      description: '15×15 经典五子棋，人机三档 / 双人对战' }
{ id: 'idle',         name: '小店日记', icon: 'default', sceneName: 'Idle',        description: '点击经营小店，升级设施，离线也赚钱' }
{ id: 'match3',       name: '缤纷消除', icon: 'default', sceneName: 'Match3',      description: '交换相邻方块凑三连，连锁消除闯 30 关' }
{ id: 'tower_defense', name: '守卫塔楼', icon: 'default', sceneName: 'TowerDefense', description: '沿路径布塔，撑过 10 波进攻' }
{ id: 'pool',          name: '台球',     icon: 'default', sceneName: 'Pool',        description: '拉杆瞄准，把球全部打进袋' }
{ id: 'wordle',        name: '成语猜猜', icon: 'default', sceneName: 'Wordle',      description: '六次机会猜出四字成语' }
{ id: 'shmup',         name: '星际弹幕', icon: 'default', sceneName: 'Shmup',       description: '拖动飞船自动开火，9 波弹幕闯关' }
{ id: 'thunder',       name: '雷霆战机', icon: 'default', sceneName: 'Thunder',     description: '关卡制养成弹幕，升级机库击破雷霆核心' }
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

方块坠落纯逻辑自检（不启动编辑器，覆盖 SRS 四态与踢墙、7-bag、出生位置、消行、Ghost、计分与重力表）：

```bash
node tools/verify-tetris-core.js
# 需要 tsc：优先 $TSC，其次 node_modules，最后回落 Cocos Creator 自带版本
```

成语填字纯逻辑自检（不启动编辑器；覆盖词库、三档难度各 100 个种子生成、交叉 / 邻接约束、填字校验、提示死锁回归、计分与存档，共 24 项）：

```bash
node tools/verify-idiom-core.js
# 同样需要 tsc（编译 IdiomCore.ts / IdiomData.ts）
```

五子棋纯逻辑自检（不启动编辑器；覆盖四方向胜负与边界 / 长连、平局、悔棋精确还原、AI 必赢必堵与合法性、530 局自对弈、同种子确定性、评分与候选点剪枝，共 24 项）：

```bash
node tools/verify-gomoku-core.js
# 同样需要 tsc（编译 GomokuCore.ts）
```

放置经营纯逻辑自检（不启动编辑器；覆盖费用表、点击 / 自动 / 离线公式、8h 封顶、时间倒退、30 天模拟、10 万次操作无 NaN、大数格式化、存档往返与坏档回落，共 27 项）：

```bash
node tools/verify-idle-core.js
# 同样需要 tsc（编译 IdleCore.ts）
```

三消纯逻辑自检（不启动编辑器；覆盖 500 种子 × 4/5 色开局无三连、交换合法性与非法不改变棋盘、特殊块生成 / 触发 / 互炸不死循环、连锁计分公式、无解重排、10,000 次长跑、快照往返与坏档回落、30 关配置与星级边界，共 25 项）：

```bash
node tools/verify-match3-core.js
# 同样需要 tsc（编译 Match3Core.ts / Match3Levels.ts）
```

塔防纯逻辑自检（不启动编辑器；覆盖 3 张地图合法性与路径推导、建造 / 升级 / 出售经济、三种索敌、溅射与减速、漏怪扣血与判负、10 波全清判胜、1,000 局随机长跑不变量、三张地图自动玩家通关，共 21 项）：

```bash
node tools/verify-td-core.js
# 同样需要 tsc（编译 TDConfig.ts / TDCore.ts）
```

台球纯逻辑自检（不启动编辑器；覆盖摆球与关卡合法性、力度映射、正碰动量转移、库边反弹、摩擦必然停机、1,000 次高速对撞不穿透、1,000 杆随机长跑不变量、落袋与连击计分、母球落袋复位、清台 / 杆数耗尽胜负、瞄准预测、确定性与存档回落，共 24 项）：

```bash
node tools/verify-pool-core.js
# 同样需要 tsc（编译 PoolConfig.ts / PoolCore.ts）
```

成语猜猜纯逻辑自检（不启动编辑器；覆盖词库合法性、绿/黄/灰判定含重复字、答案与候选池确定性、三档难度池尺寸与干扰字唯一、候选池必含答案字、每日种子、计分、分享文本、1,000 局长跑，共 29 项）：

```bash
node tools/verify-wordle-core.js
# 同样需要 tsc（编译 WordleCore.ts / IdiomData.ts）
```

星际弹幕纯逻辑自检（不启动编辑器；覆盖场地与波次配置、自动开火与火力齐射、四种弹幕图案角度、碰撞与计分、无敌帧、边界夹取与越界清理、道具掉落与封顶、波次推进与 Boss 就位、通关 / 失败终态、60 秒长跑不变量与确定性，共 34 项）：

```bash
node tools/verify-shmup-core.js
# 同样需要 tsc（编译 ShmupCore.ts），通过时打印 SHMUP_CORE_OK
```

雷霆战机纯逻辑自检（不启动编辑器；覆盖 10 关关卡表、存档净化、四条升级线与属性推导、星级 / 奖励、边界夹取、火力齐射与僚机、护盾 / 炸弹 / 复活、波次推进与 Boss 胜负、确定性掉落、1,000 次升级、10 分钟长跑与第 1 关自动驾驶通关，共 64 项）：

```bash
node tools/verify-thunder-core.js
# 同样需要 tsc（编译 ThunderCore.ts），通过时打印 THUNDER_CORE_OK
```

微信小游戏构建产物预检（**把 `build/wechatgame/` 交给微信开发者工具之前跑**，退出码 0 = 可开）：

```bash
node tools/check-wechat-build.js                 # 默认检查 build/wechatgame
node tools/check-wechat-build.js <构建目录>       # 检查其它构建输出

node tools/replay-wechat-bundle.js               # 复现/反证：产物在「小游戏包装」下能否加载
```

构建场景清单同步（**新增游戏后、构建之前做**，省掉在构建面板里手动勾选场景）。按下面的阶梯选手段，**不要默认让用户去退出编辑器**：

| 顺序 | 场景 | 手段 |
|---|---|---|
| ① 首选 | 编辑器**正在跑** | MCP `preferences_set_preferences_config` **带 `path`**：`builder` + `common.scenes`、`builder` + `BuildTaskManager.taskMap.<任务号>.options.scenes` 各写一次（编辑器自己写盘，不会被内存刷回） |
| ② | 编辑器**没开** | `node tools/sync-build-scenes.js`（检测到编辑器在跑会拒绝写入，`--force` 可越过） |
| ③ | `wechatgame.json` 的平台副本（MCP 够不到） | 直接改 `profiles/v2/packages/wechatgame.json` 的 `builder.common.scenes`（该文件不在编辑器内存里，改完不会被刷回） |
| ④ 兜底 | 写完仍不生效 / 需要在面板上确认 | 用 `macos-computer-use` 技能（`~/.claude/skills/macos-computer-use/scripts/cu`）操作构建面板：`cu find CocosCreator "重新构建"` → `cu press --dry` → `cu press`，配 `cu shot` 截图核对勾选数 |

```bash
node tools/sync-build-scenes.js --check          # 校验：三处都齐才退出码 0（编辑器在跑也能跑，只读）
node tools/sync-build-scenes.js --all            # 顺带修其它平台的构建任务快照
```

**判据（写完怎么算生效）**：`--check` 退出码 0 + MCP 读回 `common.scenes` / taskMap 的项数与顺序都对得上；
面板上是否真的勾上，用 `cu shot` 截图看「构建场景」列表条数（不看 `set` 的 `success` 就下结论）。
⚠️ `sync-build-scenes.js` 与「退出编辑器」只是**其中一条路径**，不要再把它写成唯一做法。

> MCP 的构建能力：`project_build_project` 没有 `wechatgame` 平台；但 `preferences_query/set_preferences_config`
> **带 `path`** 时能直接读写运行中编辑器的构建配置（`builder` + `common` / `BuildTaskManager.taskMap.<id>.options.scenes`），
> 改场景清单不必退出编辑器，详见 [`docs/tech/wechat-build-pitfalls.md`](./docs/tech/wechat-build-pitfalls.md) §9。

9 项检查：必需文件齐全且非空（含产物清单非空，防空构建） / `game.json`·`project.config.json` 可解析无 BOM / 构建是否已落盘稳定 /
产物 `.js` 能否按 ES2015 与 ES5 解析 / 主包 ≤ 4 MB / 无变体选择符 / **开发者工具是否停在过期构建** /
**AppID 不是占位或样例值** / **工具编译缓存里用的是小游戏包装还是小程序包装**。
最后两项针对「能编译但一打开就崩」，故障排查见
[`docs/tech/wechat-build-pitfalls.md`](./docs/tech/wechat-build-pitfalls.md) §8。

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

- [Cocos Creator 最佳实践（完整版）](./docs/cocos-best-practices.md)
- [Graphics 动态部件（分层 / 镜像 / 程序化动作）](./docs/tech/cocos-graphics-animation-layering.md)
- [文档索引与定位指南](./docs/README.md)
- [排期/补间陷阱（自排期回调被丢弃 → 回合卡死）](./docs/tech/cocos-scheduler-and-tween-pitfalls.md)
- [微信文本渲染（变体选择符 VS16 → 图标方框）](./docs/tech/wechat-text-rendering.md)
- [微信小游戏构建产物（编译报错的时序根因 + 预检流程）](./docs/tech/wechat-build-pitfalls.md)
- [开发工具链备忘（文本编码、`tsc` 版本、提交前检查）](./docs/tech/dev-toolchain-notes.md)
- [2048 游戏设计](./docs/specs/2026-05-13-game-2048-design.md)
- [贪吃蛇设计](./docs/specs/2026-05-26-game-snake-design.md)
- [战争进化设计](./docs/specs/2026-05-18-game-war-evolution-design.md)
- [Tiny Vanguard 设计](./docs/specs/2026-05-28-tiny-vanguard-design.md)
- [方块坠落设计](./docs/specs/2026-10-25-game-tetris-design.md)
- [方块坠落验收报告（含界面美化记录）](./docs/plans/2026-10-25-game-tetris-acceptance.md)
- [午夜幸存者设计（含 M1/M2 实测记录）](./docs/specs/2026-11-02-game-survivor-design.md)
- [成语填字设计（含浏览器试玩复核）](./docs/specs/2026-11-05-game-idiom-design.md)
- [五子棋设计（含浏览器试玩复核）](./docs/specs/2026-11-05-game-gomoku-design.md)
- [小店日记设计（点击 / 自动 / 离线三线收益）](./docs/specs/2026-11-05-game-idle-design.md)
- [缤纷消除设计（交换消除 / 特殊块 / 30 关）](./docs/specs/2026-11-05-game-match3-design.md)
- [守卫塔楼设计（固定塔位 / 4 塔 3 级 / 10 波含 Boss）](./docs/specs/2026-11-06-game-tower-defense-design.md)
- [成语猜猜设计（候选字池 + 每日挑战 + 战绩分享，含浏览器验收记录）](./docs/specs/2026-11-08-game-wordle-design.md)
- [星际弹幕设计（自动开火 + 4 种弹幕图案 + 9 波含母舰，含浏览器验收记录）](./docs/specs/2026-11-08-game-shmup-design.md)
- [雷霆战机设计（10 关 + 机库四条升级线 + 炸弹 / 护盾 / 复活，含浏览器验收记录）](./docs/specs/2026-11-08-game-thunder-design.md)
- [品类盘点与下一批路线图](./docs/plans/2026-11-05-game-catalog-and-roadmap.md)
