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

## 4. ⚠️ 点击坐标：设备像素 = CSS × devicePixelRatio

浏览器自动化点击工具传的 `x/y` 是**设备像素**（截图空间），而 CSS 坐标需再乘 `devicePixelRatio`。

本机预览实测：canvas **786 × 1308**（物理）、CSS **393 × 654**、`dpr = 2`。

求某节点的可靠设备坐标：

```js
const canvasEl = document.querySelector('canvas');
const rect = canvasEl.getBoundingClientRect();
const cam = root.getChildByName('Camera').getComponent('cc.Camera');
const ui  = node.getComponent('cc.UITransform');
const w   = ui.convertToWorldSpaceAR(new cc.Vec3(0, 0, 0));
const sp  = cam.worldToScreen(w.clone(), new cc.Vec3());   // 物理像素
const cssX = rect.left + sp.x / canvasEl.width  * rect.width;
const cssY = rect.top + (1 - sp.y / canvasEl.height) * rect.height;
// 点击入参 = css × dpr ；本机 dpr=2，即 cssX*2 / cssY*2
```

> 尺度提醒：`convertToWorldSpaceAR` 的世界坐标是**设计像素**（本项目 720×1280）。
> 判断"两个 UI 是否重叠"要用**世界坐标 + 自身尺寸**比较（`|Δy| < (h1+h2)/2`），不要拿设计像素当设备像素估——本轮曾因此误报"按钮重叠"。

**校验落点**（传值错会静默点偏）：

```js
// 注入监听，看浏览器实际派发的坐标
for (const t of ['pointerdown','mousedown','pointerup','mouseup','click'])
  canvasEl.addEventListener(t, (e) => log.push({ t, cx: e.clientX, cy: e.clientY }), true);
```

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

**纪律**：读数互相矛盾时（如"血量 1 但 `alive: true`"），**先怀疑自己的探针**（字段名、坐标换算），确认无误再判定游戏缺陷。本轮多次误报都源于此。

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
4. **真实点击**（设备像素坐标）→ 探针断言状态变化。
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

（MCP 接入：项目级 `reasonix.toml` 的 `[[plugins]] cocos-creator`，`type=http`、`url=http://localhost:3000/mcp`。）
