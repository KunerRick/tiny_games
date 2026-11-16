# 《秘银远征》第 19 轮试玩报告（M10 · 音效 / 震动开关）

> 日期：2026-11-16 · 游戏：`mithril` · 场景：`assets/games/game_mithril/scenes/Mithril.scene`
> 试玩者：fresh 子代理（独立试玩者，非开发者）。**所有结论来自真实鼠标点击 / 页面 reload + 只读页内探针**；未改任何 `.ts` / 场景 / 预制体，未调用组件方法改状态，未直接写 `localStorage`。
> 环境：Cocos Creator 3.8.8 编辑器预览 `http://127.0.0.1:7456/?scene=a3d6ebf7-4a20-4b12-b82a-1da5c08b6218`（已在跑，未启动/重启编辑器）。
> 对照：M10 计划 `docs/plans/2026-11-16-mithril-m10-plan.md`；上一轮 `docs/plans/2026-11-16-playtest-round18-mithril-m9.md`（编号已用到 N59，本轮从 N60 起）。

## 1. 结论

**P0 = 0 · P1 = 0 · P2 = 0 · P3 = 0。**

本轮 6 个必测验收点全部通过：默认「音效 开」且探针 `sfxOn/vibOn = true`；真实点击后文案与偏好键同步变关、AudioContext 在用户手势后可用；整页 reload 后仍是关且存档字段无损；关音效下真实进入 BOSS 战并操作技能约 44 秒，未崩、console 新增 error = 0；顶栏按钮与标题 / 状态标签 / 区域页签均无重叠，换到 1024×768 视口仍能精确点中；最后点回「音效 开」并确认偏好与存档（v2 / Lv17 / gold 1094 / 已通副本 `["mine","chapel"]`）保持。

> 编号使用：**N60 及以后未占用**（本轮未复现任何缺陷）。

## 2. 覆盖清单

### 2.0 方法与数据说明

| 项 | 值 |
|---|---|
| 视口 | 1280 × 720（编辑器预览设备模拟 iPhone 14 Pro）；另测 1024 × 768 |
| canvas | `393 × 679`（缓冲）；CSS rect `{left:443.5, top:41.453, w:393, h:678.547}`（1280×720） |
| `devicePixelRatio` | 1 |
| 点击比例 `k` | **1**（现场标定：注入 canvas `pointerdown/mousedown` 监听后 `page.mouse.click(460,120)`，派发 `clientX/Y = 460/120`，故 CSS 即入参） |
| 坐标换算（1280×720） | `cssX = rect.left + sp.x / canvas.width * rect.width`；`cssY = rect.top + (1 - sp.y / canvas.height) * rect.height`，`sp = cam.worldToScreen(ui.convertToWorldSpaceAR(0,0,0))`。按钮实测 CSS **(799.13, 63.72)**，点击 `(799,64)` 命中 |
| 坐标换算（1024×768） | 此视口 canvas 缓冲 `393×679` 与 CSS 高 `724.297` 不再相等（手册 §4.5）。按 §4.1 公式得 `(671.14, 67.47)` **点空**；改用 `cssY = window.innerHeight - sp.y = 111.28` 后命中（节点 `TOUCH_START` 收到 `getUILocation = (658.85, 1238.53)`，与按钮世界坐标 `(660,1238)` 差约 1.2 设计像素）。`k` 仍为 1 |
| 探针 | `window.__mithrilAudio`（`sfxOn / vibOn / available / enabled`）；递归查 `SfxToggle` 读 `cc.Label.string`；`localStorage['tiny_games_mithril_save' / 'tiny_games_mithril_audio']`；`MithrilGame.debugSnapshot()` 只读战斗快照 |
| 状态改动方式 | **只通过真实点击**：顶栏开关、野外节点、战斗技能键、战斗返回键；另做视口 resize。无 localStorage 写入、无组件方法调用 |
| 只读注入 | `window.__dev` 坐标探针、canvas `pointerdown/mousedown` 计数、`SfxToggle` 的 `TOUCH_START` 监听（仅记录 `getUILocation`，不改状态） |

### 2.1 验收点 1：默认状态

| 项 | 实测 |
|---|---|
| `window.__mithrilAudio` | 存在 |
| `sfxOn / vibOn / enabled / available` | **true / true / true / false**（尚未有用户手势，符合设计） |
| 顶栏按钮文案 | **「音效 开」** |
| 节点 | `SfxToggle` active，世界坐标 `(660,1238)`，尺寸 `104×40` |
| 偏好键 | `{"sfx":true,"vib":true}` |
| 存档 | 2015 字节、`v2`、Lv17 / exp85 / gold1094 |
| 截图 | `.playwright-mcp/r19-00-initial-default-on.png` |

**结论：通过。**

### 2.2 验收点 2：真实点击关闭

- 操作：`page.mouse.click(799, 64)`（已现场标定 `k=1`）。

| 检查项 | 实测 |
|---|---|
| 文案 | **「音效 关」** |
| 探针 | `sfxOn === false && vibOn === false`，`enabled === false` |
| `available` | **true**（点击手势内 `unlock()` 建出 AudioContext） |
| 偏好键 | **`{"sfx":false,"vib":false}`** |
| 存档 | 长度 **2015**、`v2`、Lv17 / gold1094，未受开关影响 |
| 截图 | `.playwright-mcp/r19-01-toggle-off.png` |

**结论：通过。**

### 2.3 验收点 3：reload 持久

- 操作：`page.reload()`，等待约 3.8 s。

| 检查项 | 实测 |
|---|---|
| 探针 | 存在；`sfxOn === false && vibOn === false`；`available === false`（重载后尚未建上下文，符合设计） |
| 文案 | **「音效 关」** |
| 偏好键 | `{"sfx":false,"vib":false}` |
| 存档 | 长度 **2015**、`v2`、Lv17 / exp85 / gold1094、背包 9 件、已通副本 `["mine","chapel"]` |
| 远征 | `pos 9 / hp 342 / done [1,3,6,9]`，与重载前一致 |
| console | 0 error |

**结论：通过。**

### 2.4 验收点 4：关音效下真实战斗（15–30 秒以上）

- 进入路径：当前节点 9 的相邻节点只有 11（BOSS），真实点击 BOSS 节点 `(640, 481)`。
- 进入代价：补给 0/3 → 进入新节点扣 28 生命（8% 上限），`hp 342 → 314`，`pos 9 → 11`，落盘 `v2 / 2019 字节`（`pos` 两位数 + `visited` 新增 11，共 +4 字节，属允许的走节点变化）。
- 战斗：BOSS「灰烬领主」阶段 1/3，血量 3536；真实点击技能键 冲 / 旋 / 闪 / 怒 / 斩 共 8 次，战斗计时到 **43.88 s**，玩家 `hp 242 → 77.1`，BOSS 未死，未出现卡死或崩溃。
- 关音效期间 `available` 始终为 false（`play()` 在 `sfxOn === false` 时提前返回，不建上下文），与设计一致。
- console：本会话日志文件只有 `LOG/TIMEEND` 与 2 条引擎弃用 warning（`systemEvent/SystemEvent`），**新增 error = 0**。
- 退出：点击战斗 HUD 左上返回键 `(475,72)` → 进入 `Lobby`（`MithrilGame.exitToLobby()`，既有设计，非缺陷）；再用场景 URL 回到 `Mithril`，路线图恢复，按钮仍「音效 关」，提示「上一次的节点还没结算：点当前节点（白圈）把内容接上」。
- 截图：`.playwright-mcp/r19-02-battle-sfx-off.png`（战斗中）、`.playwright-mcp/r19-04-route-map-off.png`（回路线图后仍为关）。

**结论：通过。**

### 2.5 验收点 5：无遮挡 / 可点中

按钮世界 AABB：`x 608..712，y 1218..1258`（104×40）。

| 对照元素 | AABB（世界） | 与按钮交集 | 判定 |
|---|---|---|---|
| 标题「野外 · 灰烬荒原」 | `x 242..477，y 1208..1263` | x 方向 0（间隔 131 px），y 方向 40 | 不重叠 |
| 副标题「Lv1-10 · 节点等级 3-10」 | `x 273..446，y 1188..1215` | 0 / 0 | 不重叠 |
| 「生命 314/348」 | `x 76..183，y 1151..1180` | 0 / 0 | 不重叠 |
| 「补给 0/3」 | `x 316..383，y 1151..1180` | 0 / 0 | 不重叠 |
| 「灰烬 ×5（本程 5）」 | `x 479..620，y 1152..1179` | x 12.1，y 0（垂直间隔 39 px） | 不重叠 |
| 区域页签三枚 | `y 1097..1139` | y 方向间隔 79 px | 不重叠 |

- 1024×768 视口：截图 `.playwright-mcp/r19-05-viewport-1024x768-on.png` 显示按钮完整、无压字；并按 §4.5 换算后真实点中（`TOUCH_START` 收到 `ui (658.85,1238.53)`）。
- 截图：`.playwright-mcp/r19-00-initial-default-on.png`、`.playwright-mcp/r19-05-viewport-1024x768-on.png`。

**结论：通过。**

### 2.6 验收点 6：恢复「音效 开」

- 操作：在 1024×768 视口真实点击 `(671,111)`（§4.5 换算）→ 按钮变「音效 开」，`sfxOn/vibOn === true`、`available === true`、偏好键 `{"sfx":true,"vib":true}`。
- 视口改回 1280×720 后复核：文案「音效 开」（码点 `97f3 6548 20 5f00`，无 `U+FE0E/U+FE0F`），`sfxOn/vibOn === true`、`available === true`、偏好键 `{"sfx":true,"vib":true}`。
- 存档：**2019 字节、`v2`、Lv17 / exp85 / gold1094、背包 9 件、已通副本 `["mine","chapel"]`**；24 个键全在（`trinketBag []`、悬赏四字段齐全、`materials.ash_dust = 5`）。
- 与初始档的差异仅为走节点产生的 `expedition.pos 9→11 / hp 342→314 / visited` 追加 11（任务书允许），**无字段丢失、版本未降级**。
- 截图：`.playwright-mcp/r19-06-final-restored-on.png`。

**结论：通过。**

### 2.7 控制台

- 本会话两份日志（`console-2026-11-16T01-24-07-122Z.log`、`console-2026-11-16T01-27-10-411Z.log`）逐行核对：只有 `TIMEEND/LOG` 与 2 条引擎弃用 warning，**0 error**；`browser_console_messages(level:'error')` 全量查询 **0 条**。

**结论：通过（warnings 不计缺陷）。**

## 3. 问题清单（机读区）

| ID | 级别 | 游戏 | 入口 | 现象 | 复现 | 期望 | 证据 |
|----|------|------|------|------|----------|------|------|
| （无） | — | mithril | 路线图顶栏音效开关 / BOSS 战 | 6 个必测点全部通过，未复现 P0/P1/P2/P3 | 见 §2.1–§2.7 | — | 见 §2 探针读数、§5 结束状态、`.playwright-mcp/r19-00`…`r19-06` |

> N60 及以后编号未占用。

## 4. 与上轮对比 / 建议

1. **与第 18 轮（M9）对比**：上轮 0 缺陷；本轮新增的开关只影响偏好键与运行时合成，未触碰存档 schema，实测也确认开关操作不改变存档字节数（2015 不变）。
2. **存档长度口径**：任务书点 2/点 6 写「长度 2015」，同时允许走节点引起的落盘变化。本轮为进入战斗真实走了 BOSS 节点 11，`pos` 变为两位数且 `visited` 追加 11，长度变为 **2019**。除 `expedition.pos/hp/visited` 外所有字段与初始一致，`v` 仍为 2；这是允许的差异，不是丢档。未通过直接改存档把长度凑回 2015。
3. **战斗出口**：战斗 HUD 左上返回键走 `exitToLobby()`，直接从战斗回大厅而不是路线图；路线图「上一次的节点还没结算」提示能正确接上。该行为与既有实现一致，本轮不计缺陷；若希望「退出战斗回路线图」，属于产品决策而非 bug。
4. **预览页视口变化**：1024×768 下 canvas CSS 高与绘制缓冲不一致，需按手册 §4.5 换算才能点中；1280×720 下 `k=1` 且两套公式近似。这是预览页/工具特性，不是游戏缺陷。
5. **建议（非缺陷）**：微信真机上震动分支（`wx.vibrateShort/vibrateLong`）与静音降级仍需模拟器实机冒烟；本轮只覆盖浏览器桌面分支（`navigator.maxTouchPoints = 0`，震动不可感知）。

## 5. 结束状态

| 项 | 值 |
|---|---|
| 音效偏好 | **`{"sfx":true,"vib":true}`**（按钮「音效 开」） |
| 探针 | `sfxOn true / vibOn true / available true / enabled true` |
| localStorage 存档长度 | **2019**（走节点 11 后；初始 2015） |
| `v` / 等级 / 经验 / 金币 | **2 / 17 / 85 / 1094** |
| 背包 / 已通副本 | **9 件 / `["mine","chapel"]`** |
| 键完整性 | 24 个键全在；`trinketBag []`；`bounties 0`、`bountyProgress {}`、`bountyDay 0`、`bountyCursor 0`；`materials.ash_dust 5` |
| 远征 | `regionId ash / pos 11 / hp 314 / supply 0 / done [1,3,6,9] / visited [0,1,3,6,9,11] / runMaterials {ash_dust:5}` |
| console | 0 error；2 条引擎弃用 warning |
| 浏览器 | **已 `browser_close`**（无残留标签页） |

**截图**：`.playwright-mcp/r19-00-initial-default-on.png`、`r19-01-toggle-off.png`、`r19-02-battle-sfx-off.png`、`r19-04-route-map-off.png`、`r19-05-viewport-1024x768-on.png`、`r19-06-final-restored-on.png`。
