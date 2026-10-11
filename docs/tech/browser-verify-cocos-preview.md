# 浏览器操作验证 Cocos 预览（可视化交互验证手册）

> **适用**：需要在**真实运行**的游戏上验证交互（点击、技能释放、面板流转、报错/崩溃），而不是仅凭读代码下结论。
> **来源**：2026-10-08 小小先锋（TinyVanguard）可视化验证与修复实践（见 [`../plans/2026-10-08-tiny-vanguard-visual-verification.md`](../plans/2026-10-08-tiny-vanguard-visual-verification.md)）。
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

> 注意两个 k 下的 `rect`、`dpr`、`innerWidth` 读数完全一致 —— **只读这些属性推不出 k**，必须实测。

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
5. 读日志（error 计数、新增 warning）。
6. 类型检查（见 §10）。
7. 结论里区分：自然流程 / 加速注入；设计像素 / 设备像素。

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

## 附：本轮用到的 MCP 工具

`project_refresh_assets`、`debug_get_console_logs`、`debug_clear_console`、`debug_search_project_logs`、`scene_get_current_scene`、`scene_get_scene_hierarchy`、`node_get_all_nodes`、`component_get_component_info`、`debug_validate_scene`。

场景结构变更（P1 战斗界面重构）另用：`sceneAdvanced_begin_undo_recording` / `sceneAdvanced_end_undo_recording`、`node_create_node`、`node_delete_node`、`node_move_node`、`node_set_node_transform`、`component_set_component_property`、`scene_save_scene`。

> `debug_validate_scene` **必须无参调用**；带 `checkMissingAssets` / `checkPerformance` 会报
> `Message does not exist: scene - check-missing-assets`。期望结果 `issueCount: 0`。

（MCP 接入：项目级 `reasonix.toml` 的 `[[plugins]] cocos-creator`，`type=http`、`url=http://localhost:3000/mcp`。）
