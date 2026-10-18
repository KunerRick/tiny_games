# 浏览器操作验证 Cocos 预览（可视化交互验证手册）

> **适用**：需要在**真实运行**的游戏上验证交互（点击、技能释放、面板流转、报错/崩溃），而不是仅凭读代码下结论。
> **来源**：2026-10-08 小小先锋（TinyVanguard）可视化验证与修复实践（见 [`../plans/2026-10-08-tiny-vanguard-visual-verification.md`](../plans/2026-10-08-tiny-vanguard-visual-verification.md)）。
> **补充**：2026-10-12 布阵交互改版一轮（拖拽手势、事件语义与能力边界，见 §11）。
> **补充 2**：2026-10-17 布阵交互复查一轮（轻触被拖拽阈值吞掉的语义与修法，见 §11.6）。
> 与 [`../cocos-best-practices.md`](../cocos-best-practices.md) 互补：那份讲**怎么写不崩**，这份讲**怎么验得准**。

---

## 1. 启动与接入预览

先确认编辑器自带的**预览服务器已在运行**：

```bash
lsof -nP -iTCP:7456 -sTCP:LISTEN            # 应看到 CocosCrea 进程
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7456/   # 期望 200
```

预览地址固定为 **`http://127.0.0.1:7456/`**。

> **MCP 无法启动预览**，别在这上面浪费时间：
> - `project_run_project({platform:"browser"})` → 只返回 `Build panel opened. Preview functionality requires manual setup.`
> - `project_start_preview_server({port})` → 返回 `Preview server control is not supported through MCP API`
>
> 正确做法：用编辑器的预览服务器 + 浏览器工具打开上述地址。

---

## 2. ⚠️ 改完 `.ts` 必须刷新资产库（最容易白验的坑）

编辑器**不会**自动重编译你从文件系统改动的脚本，预览页仍在跑**旧代码**——此时无论怎么点、怎么重载，都会看到"改动没生效"。

标准流程：

```
改 .ts  →  MCP project_refresh_assets  →  重载预览页  →  再验证
```

- `project_refresh_assets` 正常返回 `{"success":true,"message":"Assets refreshed in: db://assets"}`。
- **判定是否真加载了新代码**：在页内读你新加方法的类型，必须是 `'function'`：

  ```js
  typeof comp.bindRunVictoryPanel   // 'function' 才算生效；'undefined' = 还是旧代码
  ```

> 实例：本轮改了 `TinyVanguardMain.ts` 后重载预览，新方法仍是 `undefined`；调用 `project_refresh_assets` 再重载才生效。

---

## 3. 页内探针（把"看到什么"变成"可核对的数据"）

预览页里 `window.cc` 可用（`cc.ENGINE_VERSION`、`cc.director` 等）。用 `eval` 直接读运行态：

```js
const cc = window.cc;
const root = cc.director.getScene().getChildByName('Canvas');
// 按名递归查找（同名节点多时要用路径定位，见 §7）
const byName = (name) => { const f = (n) => { if (n.name === name) return n;
  for (const c of n.children) { const r = f(c); if (r) return r; } return null; }; return f(root); };
```

要点：

- **组件查询用字符串名**：`node.getComponent('cc.UITransform')`。
  在当前上下文里 `cc.UITransform` 可能是 `undefined`，直接 `getComponent(cc.UITransform)` 会报 `getComponent: Type must be non-nil`。
- **`cc.*` 命名空间导出在页内 `eval` 常缺失**：实测 `cc.input`、`cc.Input`、`cc.UITransform` 都取不到
  （`Object.keys(cc)` 里带 `input` 的只有 `BlockInputEventsComponent`）。要读全局输入监听可改用
  节点捕获层挂探针（手法见 §11.3），不要依赖 `cc.input`。
- **读私有状态做断言**（比看截图可靠）：`comp._state`、`bm._phase`、`bm._selectedUnit`、`bm._deployedPositions`、`panel.children` 等。
- **可见性**用 `node.activeInHierarchy`（区分自身 `active` 与父链激活态）。
- 组件全清单：`node.components.map(c => c.constructor.name)`——排查"同节点挂了两个渲染组件"这类问题很好用。

---

## 4. ⚠️ 点击坐标：入参比例**每轮先校准**，不要套用固定倍数

浏览器自动化点击工具的 `x/y` 落在**截图空间**，与 CSS 坐标之间有一个比例 `k`：

```
clientX = 传入 x / k        // k 即「投影缩放」，不一定等于 dpr
```

**`k` 会随视口/设备模拟变化，同一会话内都会变**，因此每轮点击前必须现场标定，不能记住上次的倍数。

本机实测的两个不同 k（同一台机器、同一个 canvas `rect`）：

| 时机 | canvas 物理尺寸 | `devicePixelRatio` | 实测 k |
|------|----------------|--------------------|--------|
| 首次打开 | 786 × 1354 | 2 | **1**（传 274 → `clientX` 274） |
| 重载后（编辑器切到 iPhone 14 Pro 模拟） | 786 × 1354 | 2 | **2**（传 400 → `clientX` 200） |
| 2026-10-12 布阵改版（iPhone 14 Pro 模拟） | 786 × 1308 | 2 | **1.225**（传 400 → `clientX` 326.5） |

> 注意这几个 k 下的 `rect`、`dpr`、`innerWidth` 读数完全一致 —— **只读这些属性推不出 k**，必须实测。
> 同一台机器上 k 已实测出现过 **1 / 2 / 1.225** 三个值，且 canvas `rect` 也会变（上表后两行的高度就不同），
> 所以「上次是几」没有任何参考价值。

### 4.1 标定 k（每次要点击之前先做）

```js
// 1) 注入监听
window.__raw = [];
document.querySelector('canvas').addEventListener(
  'pointerdown', (e) => window.__raw.push([e.clientX, e.clientY]), true);

// 2) 随便点一次已知点，例如 (200, 200)
// 3) 读回实际派发值，算出 k
window.__raw;      // 若得到 [100,100] → k = 2；若得到 [200,200] → k = 1
```

标定后，把节点世界坐标换算成**点击入参**：

```js
const canvasEl = document.querySelector('canvas');
const rect = canvasEl.getBoundingClientRect();
const cam = root.getChildByName('Camera').getComponent('cc.Camera');
const ui  = node.getComponent('cc.UITransform');
const w   = ui.convertToWorldSpaceAR(new cc.Vec3(0, 0, 0));
const sp  = cam.worldToScreen(w.clone(), new cc.Vec3());   // 物理像素
const cssX = rect.left + sp.x / canvasEl.width  * rect.width;
const cssY = rect.top + (1 - sp.y / canvasEl.height) * rect.height;
const CLICK = (css) => css * k;      // k 来自上面的现场标定
```

**做过一次就封装成探针**，后续所有点击直接取现成入参：

```js
window.__dev = function (path) {
  const cc = window.cc, scene = cc.director.getScene();
  let n = scene.getChildByName('Canvas');
  for (const p of String(path).split('/').filter(Boolean)) { if (!n) return null; n = n.getChildByName(p); }
  if (!n) return null;
  const cam = scene.getChildByName('Canvas').getChildByName('Camera').getComponent('cc.Camera');
  const ui = n.getComponent('cc.UITransform');
  const w = ui.convertToWorldSpaceAR(new cc.Vec3(0, 0, 0));
  const sp = cam.worldToScreen(w.clone(), new cc.Vec3());
  const c = document.querySelector('canvas'), r = c.getBoundingClientRect();
  const cssY = r.top + (1 - sp.y / c.height) * r.height;
  const cssX = r.left + sp.x / c.width * r.width;
  return { path, css: [cssX, cssY], click: [Math.round(cssX * K), Math.round(cssY * K)], active: n.activeInHierarchy };
};
```

> ⚠️ **页面重载会清掉页内探针**（`window.__dev`/`__uiAudit` 都定义在页面上下文）。重载后必须重新注入。
> 省事做法：把探针源码存进 `localStorage`，重载后一行 `eval` 恢复：
> ```js
> // 注入时
> localStorage.setItem('__uiAuditSrc', 'window.__uiAudit = (' + factory.toString() + ')()');
> // 重载后
> eval(localStorage.getItem('__uiAuditSrc'));
> ```

### 4.2 别把"点偏"当成游戏缺陷

`k` 变了而你没重新标定 → 点击落在别的节点上 → 现象是"点了没反应/按钮失效"，很容易误判成**回归或流程卡死**。

本轮踩过：一次视口切换后 k 由 1 变 2，误判为"布阵点击格子不生效（回归）"；重新标定后同一坐标立刻正常，`deployed` 0 → 1。

**判据**：点击后状态没变时，先 `window.__raw` 看实际派发坐标，再决定是否算缺陷。

> 尺度提醒：`convertToWorldSpaceAR` 的世界坐标是**设计像素**（本项目 720×1280）。
> 判断"两个 UI 是否重叠"要用**世界坐标 + 自身尺寸**比较（`|Δy| < (h1+h2)/2`），不要拿设计像素当设备像素估——本轮曾因此误报"按钮重叠"。

---

## 5. 日志取证

| 来源 | 手段 |
|------|------|
| 浏览器 console / 网络 | 浏览器工具的 logs / network |
| 编辑器 console | MCP `debug_get_console_logs`（`filter:"error"` → `total:0` 即无错）、`debug_clear_console` |
| 项目日志文件 | MCP `debug_search_project_logs`（查 `temp/logs/project.log`，可按 `error\|Exception` 正则） |

**记基线**：动之前先 `debug_clear_console`，动之后看新增日志。
**注意甄别**：`systemEvent/SystemEvent is deprecated` 是引擎自身警告；你自己的探针写错（如 `getComponent` 传错类型）也会在 console 里报错，别算到游戏头上。

---

## 6. 加速手段与声明纪律

末端流程（Boss 通关、全灭失败、需要特定血量）可用页内 `eval` 直接驱动**真实代码路径**，例如：

```js
bm.enemyUnits.forEach(e => { e.data.currentHp = 0; e.data.isAlive = false; if (e.node) e.node.active = false; });
if (typeof bm.checkBattleEnd === 'function') bm.checkBattleEnd();   // 走真实结算
gm.onRunComplete(true);                                            // 走真实通关路径
```

> **必须在报告里声明**哪些结论来自注入而非自然流程。别把"注入能跑通"写成"玩家自然通关没问题"。

**还有一条同样要声明的**：用 `eval` **直接调方法**（`bm.placeUnit(...)`）验证，会绕过事件系统，
从而漏掉"节点上拿不到组件就跳过"这类**静默失效**缺陷。**能点/能拖的路径就点、就拖**，
`eval` 只用来读状态与加速末端流程。反例见 §11.4。

---

## 7. 本项目易错的字段与命名

读探针时先核对字段，否则会造出"自相矛盾"的假象：

| 易错点 | 正确 | 错误示例 |
|--------|------|---------|
| 单位血量 | `unit.data.currentHp` / `maxHp` | `unit.data.hp`（那只是 `stats.hp` 模板值） |
| 当前单位 | `battleManager.selectedUnit` | `battleManager.currentUnit`（不存在该 getter） |
| 同名节点 | 按**路径**定位，如 `Canvas/GoldLabel` 与 `BattleUI/VictoryPanel/GoldLabel` | 按名字全局搜 → 命中错误层级 |
| 面板/列表状态 | `node.activeInHierarchy`（含父链） | `node.active`（父节点关掉时仍为 true） |

**纪律**：读数互相矛盾时（如"血量 1 但 `alive: true`"），**先怀疑自己的探针**（字段名、坐标换算），确认无误再判定游戏缺陷。本轮多次误报都源于此。

### 7.1 量化审计探针自身的坑（写重叠检测时必看）

本轮的「重叠 + 字号」审计探针踩过两个坑，都会产出**看似合理却完全错误**的结论：

**① 坐标算式里写错变量 → 假零重叠。** 算 y 方向交叠时误写成 `b.y + b.y`（少了一个 `height`），交集恒为 0，探针会兴高采烈地报 `overlapCount: 0`。肉眼看到的却是明显压在一起。

> 防御：写完先拿一个**已知会重叠**的样本自测（例如故意把两个节点摆到同一点），确认探针报出非零重叠，再用于审计。一个新探针第一次跑就报"全 0"，要当可疑信号而不是好消息。

**② 重叠只在同层比较，别跨父节点判。** 父子关系（如 `HighlightBorder` 覆盖整张卡片）本身就是"设计上叠放"，不是缺陷。本轮改为**按 `parent` 分组，同层内两两比较**：

```js
// 只在同一父节点下比较，避免把父子叠放误报成重叠
const groups = {};
for (const e of visible) (groups[e.parent || 'ROOT'] ||= []).push(e);
```

**③ 判据要能区分「设计性叠加」与「缺陷」。** 本项目里 `UnitPrefab/selectionIndicator`（选中光圈）天然覆盖 `unitSprite` 与 `HpBar` —— 它**渲染在两者之间**（sibling 顺序 `unitSprite → selectionIndicator → HpBar`），是刻意的视觉设计。审计报出来后要逐个判定归属（哪一层、什么语义），不要直接当 bug 修。

**④ 探针要给「字号违规」而不是只给字号。** 把判定固化成 `lineHeight < fontSize × 1.2`，输出违规清单而不是让读者自己比大小 —— 本项目 `fontSize 48 / lineHeight 40`、`28 / 25` 这类问题就是这样被稳定检出的。

### 7.2 读 `Sprite.color` 会被 `Button` 的 COLOR 过渡改写

**现象**：代码明明写了 `btnSprite.color = hex(COLOR.WARNING)`，探针却读到另一个颜色；
而且**时读时对** —— 同一段代码换一轮点击就读到了"正确"值。

**原因**：`Button.transition = COLOR` 时，引擎在**状态变化**（normal → hover → pressed）那一刻
把 `normalColor`/`hoverColor`/`pressedColor` 写进目标 Sprite。于是：

- 若设色之后**没有**状态变化（鼠标一直停在同一个按钮上），读到的是代码设的值；
- 若鼠标**移出再移入**（或移到了另一个按钮上），过渡会立刻覆盖它 —— 读到的是过渡色。

**纪律**：用颜色断言 UI 状态时，**必须显式制造状态变化**（先 `mouse.move` 到棋盘中央，再
`mouse.move` 到目标按钮，等 ~300ms 再读），否则你的断言只是在测"鼠标恰好在哪"。
本轮"锁定技能按钮的琥珀色被悬停冲掉"这个真实缺陷，就是靠这个动作才稳定复现的
（见 `docs/plans/2026-10-18-tiny-vanguard-fixes.md` §4）。

**推论**：凡是用 Button 过渡色表达的"状态指示"，都要检查**每个过渡态**是否都写对了 ——
只在 `normalColor` 上做标记，桌面预览里鼠标一碰就消失；微信触屏没有 hover 才不会暴露。

---

## 8. 面板显隐被 `_showCalled` 拦截（易踩的模式）

项目里的面板常用这种懒初始化：

```ts
onLoad(): void { if (!this._showCalled) this.node.active = false; }

show(): void { this._showCalled = true; this.node.active = true; }   // 先置位，再激活
```

**顺序不能反**：给 `active` 赋 `true` 会**同步**触发 `onLoad`，若此时 `_showCalled` 仍为 `false`，面板刚显示就被关掉。

> 实例：`EventUI.showEvent()` 曾漏置 `_showCalled`，导致事件面板永远无法交互、流程卡在 `gmState === 'event'`。新增面板类时务必对照 `UpgradeUI` / `RouteMapUI` / `BattleUI` 检查是否置位。

---

## 9. 可复用验证顺序

1. 确认预览服务器在跑（`curl` 返回 200）。
2. 改了 `.ts` → `project_refresh_assets` → 重载页面（并用 `typeof` 核对新方法）。
3. 探针读初始状态（可见性、节点树、关键组件）。
4. **标定点击比例 k**（§4.1）→ 真实点击 → 探针断言状态变化。
5. 涉及**拖拽 / 手势**时：先按 §11.1 确认事件语义，再用真实 `drag` 驱动（§11.4 列了能验与不能验的边界）。
6. 读日志（error 计数、新增 warning）。
7. 类型检查（见 §10）。
8. 结论里区分：自然流程 / 加速注入；设计像素 / 设备像素。

---

## 10. 类型检查命令（本机）

`npx tsc --noEmit` 会解析到全局 **tsc 6.x**，报的是 `tsconfig.json` 自身的弃用项：

```
tsconfig.json(6,3): error TS5107: Option 'moduleResolution=node10' is deprecated ...
```

这与你的改动**无关**，不要据此判断代码有问题（`npx --yes -p typescript@5.4.5` 也可能因 npm cache 权限失败）。用 Cocos 自带的那份：

```bash
TSC=/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc
node "$TSC" --version        # Version 5.8.2
node "$TSC" --noEmit && echo TS_OK
```

---

## 11. 拖拽 / 手势验证：事件语义与能力边界

> **来源**：2026-10-12 小小先锋「布阵交互改版」（拖拽双向 + 棋盘内换位）一轮的实测。

浏览器工具**能**驱动真实的指针拖拽，但桌面预览下 Cocos 对「拖拽结束」的事件语义与点击**不同**。
不了解这一点，会把"实现没收到结束事件"误判成"工具不支持拖拽"。

### 11.1 `click` 与 `drag` 派发的事件序列不同

同一个 Canvas 捕获监听，两种工具动作的实测结果：

| 工具动作 | Cocos 侧派发序列 |
|---------|-----------------|
| `click` | `touch-start` → **`touch-end`** |
| `drag`  | `touch-start` → 多次 `touch-move` → **`touch-cancel`**（**没有 `touch-end`**） |

而**纯 DOM 层**（在 canvas 上挂原生监听、不经 Cocos）看，`drag` 的底层指针序列是**完整的**：

```
pointerdown(btn=1) → 多段 pointermove(btn=1) → pointerup(btn=0) → mouseup(btn=0)
```

**结论**：桌面（`navigator.maxTouchPoints === 0`）下，Cocos 把「以拖拽方式结束」的指针序列
合成为 **`TOUCH_CANCEL`**，而不是 `TOUCH_END`。

**实现含义**：若把手势实现写成"`TOUCH_CANCEL` 一律视为中断、回位"，桌面拖拽将**永远不生效**
（只有真机触摸才走 `TOUCH_END`）。判据用 `navigator.maxTouchPoints`：
`0` ⇒ 这次 CANCEL 就是手势正常结束，照常结算；`> 0` ⇒ 按真机语义回位、不改变状态。

> 别写成 `cc.sys.maxTouchPoints` —— 该字段在 3.8.8 不存在（TS 报
> `Property 'maxTouchPoints' does not exist`），要用浏览器 `navigator`。

### 11.2 监听宿主：兄弟子树收不到对方的事件

布阵场景里 `Grid`（棋盘）与 `BattleUI`（兵牌）是 `Canvas` 下的**两个兄弟子树**。把
`TOUCH_*` 监听挂在 `BattleUI` 自身，**收不到**"起点在棋盘格上"的手势 —— 表现为
"棋盘内换位整条路径失效"，极易误判成手势逻辑写错。

规则：

- 要覆盖子树 A 与子树 B 的手势，监听挂在二者的**共同父级**（本例 `Canvas`）。
- 事件起点在更深的子节点时，用**捕获阶段**（`useCapture = true`）：棋盘格的 `Button`
  在 `TOUCH_START` 时会 `stopPropagation`，冒泡阶段读不到起点在棋盘上的手势。
  捕获阶段只读事件、不阻断传播，不干扰 `Button` 自身的点击判定。

### 11.3 诊断法：区分「工具没发」与「实现没收到」

现象是"拖了没反应"时，按这个顺序定位，**不要先怀疑工具**：

1. 在 `canvas` 上挂**纯 DOM** 监听（`pointerdown/up`、`mousedown/up`）→ 底层指针是否完整？
2. 在目标节点的**捕获层**挂 Cocos 监听（`touch-start/move/end/cancel`）→ 事件是否到达？

| DOM 层 | Cocos 层 | 结论 |
|--------|---------|------|
| 完整 | 只到 `start`/`move`，无 `end` | 属预期 —— 桌面把结束合成为 `touch-cancel`（§11.1） |
| 完整 | 一个都没到 | **宿主或阶段选错**（§11.2），不是工具的问题 |
| 缺失 | — | 工具真的没发；改用页内派发序列（§11.5，需声明为注入） |

> ⚠️ **探针别重复注册**：`node.on(type, cb, target, useCapture)` 按 `(cb, target)` 判重，
> 用**不同的 `target` 对象**挂两次同名监听，每个事件会被 push 两次 —— 看起来像"引擎派发了两遍"。
> 诊断计数异常时先查这个（本轮踩过：`touch-start` / `touch-end` 各被记成 2 次，差点据此下错结论）。

> 本轮正是因为**先怀疑工具**，把"宿主选错"误判成"`drag` 工具丢失 `pointerup`"，
> 在报告里写错了归因。改用上面的双路取证后一次定位。

### 11.4 能力边界（能验 / 不能验）

**能验**：

- 真实指针拖拽，含**中间态**：幽灵节点（跟随手指）、原槽位/单位淡化（`UIOpacity`）、落点高亮色；
- 拖拽的**阈值分支**：位移 < 阈值（如 8px 设计像素）不触发拖拽，仍算点击；
- **拖拽守卫**：拖拽已消费本次触摸时抑制随后派发的格点击（否则会重复落子）；
- 四条路径（兵牌→棋盘 / 棋盘→兵牌 / 棋盘内换位 / 非法落点回位）都能读回真实状态做断言。

**不能验 / 必须声明**：

- **真机触摸分支**：本机 `maxTouchPoints = 0`，只能覆盖桌面分支；真机的 `TOUCH_END`
  路径属**逻辑推导**而非实测，结论里要讲清。
- **`eval` 直调方法会绕过真实 UI 路径**：绕过事件系统 ⇒ 漏掉"节点上拿不到组件就跳过"
  这类**静默失效**缺陷。本轮实例：`setDragDimmed` 写成"拿不到 `UIOpacity` 就不做"，
  而槽位节点本就没有该组件 —— 用 `eval` 直调时"看起来正常"，改用真实拖拽才暴露
  （现象：槽位淡化零反馈）。修法与同类坑见
  [`mcp-scene-authoring-pitfalls.md`](./mcp-scene-authoring-pitfalls.md) §3.5 ⑧。
- **`k` 每轮现场标定**（§4），本轮实测 `k = 1.225`。

### 11.5 页内派发拖拽序列（兜底手段）

**优先用真实 `drag`**；仅当它确实不可用时才用下面的注入，并在报告里声明。

```js
// 设计像素 → canvas 客户端坐标（cam / rect 取法见 §4.1）
const fire = (t, cx, cy) => c.dispatchEvent(new MouseEvent(t,
  { clientX: cx, clientY: cy, bubbles: true, button: 0, detail: 1 }));

const a = toClient(x1, y1); fire('mousedown', a[0], a[1]);
for (let i = 1; i <= 6; i++) {                    // 分步移动，确保越过拖拽阈值
  const q = toClient(x1 + (x2 - x1) * i / 6, y1 + (y2 - y1) * i / 6);
  fire('mousemove', q[0], q[1]);
}
const z = toClient(x2, y2); fire('mouseup', z[0], z[1]);
```

> ⚠️ **必须分步 `await`**（`(async () => { ... })()`）：引擎按帧消费输入，把
> `down/move/up` 在同一帧同步派发完，会只走到部分 `move`、拿不到 `end`。
> 每步之间加约 40ms 延时。

### 11.6 「拖拽把点击吞掉」：轻触被静默吃掉的一类缺陷

> **来源**：2026-10-17 布阵交互复查（发现兵牌"点选没反应"）。

#### ① §11.1 的 "drag ⇒ `touch-cancel`" 只在**离开起点节点**时成立

补测（同一 Canvas 捕获监听 + 目标节点监听）：在**起点节点内部**按下并抬起，节点收到的是
**`touch-end`**；只有指针在抬起前**离开**了该节点，起点节点收到的才是 `touch-cancel`。

| 动作 | 起点节点收到 | 落点节点收到 |
|------|-------------|-------------|
| 按下 → 抬起（原地） | `touch-start` → `touch-end` | — |
| 按下 → 节点**内**移动 → 抬起 | `touch-start` → `touch-move` → **`touch-end`** | — |
| 按下 → 移到节点**外** → 抬起 | `touch-start` → `touch-move` → `touch-cancel` | 落点若有 `Button`：其自身未收到 `touch-start`，**不派发 CLICK** |

推论：**"清掉消费标记、等引擎补发 `TOUCH_END`"这条修法只在落点还在同一个节点上时可用**；
落点跑出起点节点时，起点根本收不到 `touch-end`，补不回来。

#### ② 缺陷模式：阈值很小 + 消费标记 = 轻触静默失败

布阵的兵牌只有 `100×64` **设计**像素，而拖拽阈值 `DRAG_THRESHOLD = 8` **设计**像素
（本项目 720 设计宽 → 实测 `k = 1`、渲染比 ≈ 0.546，即 **≈ 4.3 CSS 像素 / 4.3pt**）。
手指或鼠标抖动极易越过阈值 ⇒ 手势被判为拖拽、`_dragConsumed = true` 抑制随后的点击；
而"落点什么都没改"时拖拽本身也不产生任何效果 ⇒ **点击与拖拽双双无作为**。

**量化取证**（横移抖动，`page.mouse` 真实指针）：

| 抖动（CSS 像素） | 换算设计像素 | 兵牌是否被选中 |
|-----------------|-------------|--------------|
| 0 / 3 | 0 / 5.5 | ✅ 选中 |
| **5 及以上** | **≈ 9.2 起** | ❌ **无任何反应**（阈值 8 被越过） |

> 判据要落在**CSS 像素**上量（现场用二分法测"从几像素开始失效"），不要用设计像素想当然 ——
> 两者的比例由渲染缩放决定（§4 的 `k` 只解决点击入参，不解决这个）。

#### ③ 修法：让"拖了个空"的手势退回轻触，且**显式调用点击路径**（不要依赖引擎补发）

`applyDrop(...)` 改为**返回本次是否真的改变了状态**；`false` 且手势起于兵牌时，直接调用兵牌
的点击回调（即 `selectDeployUnit(idx)`）：

```ts
const applied = this.applyDrop(this._dragUnitIndex, this._dragFromBoard, p.x, p.y);
if (!applied) this.fallbackToCardTap();   // 仅兵牌；棋盘另见下
this.endDragGesture();                    // 消费标记照旧保留 → 引擎点击被抑制，不会双触发
```

三个"为什么"（都是实测/推理得出的，换别的写法会错）：

1. **不能只清 `_dragConsumed`**：落点在起点兵牌之外时压根收不到 `touch-end`（见 ①）。
2. **即便收到也不能只清标记**：点击会派发给**落点那个**节点 —— 落在棋盘格上会拿"当前选中"
   去落子、落在别的兵牌上会选中别人，语义完全错位。
3. **只兜底兵牌、不动棋盘**：棋盘上"拖起又放回原格"是 `applyDrop` 明确定义的**无操作**，
   补发点击会变成"撤回该单位"（点击路径里点已上阵单位 = 撤回），与"放回去"的意图相反。

**验证口径**：包一层 `_onDeployCardCb` 计数，断言每次手势**恰好触发 1 次**
（>1 说明引擎点击没被压住，=0 说明兜底没生效）；同时读 `_selectedDeployUnitIndex` 与槽位
`_deployState` 三态串。四条拖拽路径 + 非法落点回位都要复跑一遍确认没被这次改动波及。

---

## 附：本轮用到的 MCP 工具

`project_refresh_assets`、`debug_get_console_logs`、`debug_clear_console`、`debug_search_project_logs`、`scene_get_current_scene`、`scene_get_scene_hierarchy`、`node_get_all_nodes`、`component_get_component_info`、`debug_validate_scene`。

场景结构变更（P1 战斗界面重构）另用：`sceneAdvanced_begin_undo_recording` / `sceneAdvanced_end_undo_recording`、`node_create_node`、`node_delete_node`、`node_move_node`、`node_set_node_transform`、`component_set_component_property`、`scene_save_scene`。

> `debug_validate_scene` **必须无参调用**；带 `checkMissingAssets` / `checkPerformance` 会报
> `Message does not exist: scene - check-missing-assets`。期望结果 `issueCount: 0`。

（MCP 接入：项目级 `reasonix.toml` 的 `[[plugins]] cocos-creator`，`type=http`、`url=http://localhost:3000/mcp`。）
