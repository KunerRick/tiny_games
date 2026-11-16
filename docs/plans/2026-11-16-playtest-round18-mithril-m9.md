# 《秘银远征》第 18 轮试玩报告（M9 · 存档迁移 + 长跑稳定性）

> 日期：2026-11-16 · 游戏：`mithril` · 场景：`assets/games/game_mithril/scenes/Mithril.scene`
> 试玩者：fresh 子代理（独立试玩者，非开发者）。**所有结论来自真实鼠标点击 / 页面 reload + 只读页内探针**；未改任何 `.ts` / 场景 / 预制体，未调用组件内部方法改状态。唯一的 `localStorage` 写入是第 4 点要求的坏档夹具与测试后的原样恢复，均在下文标明。
> 环境：Cocos Creator 3.8.8 编辑器预览 `http://127.0.0.1:7456/?scene=a3d6ebf7-4a20-4b12-b82a-1da5c08b6218`（已在跑，未启动/重启编辑器）。
> 对照：M9 计划 `docs/plans/2026-11-16-mithril-m9-plan.md`；上一轮 `docs/plans/2026-11-16-playtest-round17-mithril-m8.md`（编号已用到 N58，本轮从 N59 起）。

## 1. 结论

**P0 = 0 · P1 = 0 · P2 = 0 · P3 = 0。**

本轮必测的 6 个验收点全部通过：真实 v1 旧档进入后内存升级为 v2 且字段无损；一次真实远征节点位移即把 v2 落盘；整页 reload 后状态一致；`v:99` 非法档与坏 JSON 均不崩、无红色报错且夹取/回落正确；远征位置、已清节点、生命、本程材料在 reload 与「返回大厅 → 重进」后保持一致；全程 browser console **0 error**。

另外补测了两条 M9 迁移语义（不在必测清单内）：pre-M7 已装备饰品登记进 `trinketBag`、`exp` 溢出逐级折算到 30 级，均通过。

> 编号使用：**N59 及以后未占用**（本轮未复现任何缺陷）。

## 2. 覆盖清单

### 2.0 方法与数据说明

| 项 | 值 |
|---|---|
| 视口 | 1280 × 720（编辑器预览设备模拟 iPhone 14 Pro） |
| canvas | `GameCanvas` 393 × 678.55，CSS rect `{x:443.5, y:41.45, w:393, h:678.55}` |
| `devicePixelRatio` | 1 |
| 点击比例 `k` | **1**（现场标定：注入 `pointerdown/mousedown` 监听后 `page.mouse.click(900,600)`，派发值 `clientX/Y = 900/600`，故 CSS 坐标即入参） |
| 坐标换算 | `cssX = rect.left + sp.x / canvas.width * rect.width`；`cssY = rect.top + (1 - sp.y / canvas.height) * rect.height`，`sp = cam.worldToScreen(ui.convertToWorldSpaceAR(0,0,0))` |
| 探针 | `Canvas/GameRoot` 上的 `MithrilGame._save`、`localStorage['tiny_games_mithril_save']`、场景 `cc.Label.string`、`cc.UITransform` 世界坐标 |
| 状态改动 | 只通过真实点击（装备面板打开/返回、远征节点、开始远征、返回大厅）产生；夹具注入只用于第 4 点与两条补充迁移探针，测完已原样恢复 |
| 夹具注入方式 | `page.addInitScript` + `sessionStorage['__mithril_fixture_once']` 一次性哨兵。**直接 reload 前写 localStorage 会被卸载时的 `_persist()` 覆盖**，故必须在新文档脚本执行前写；每次注入后哨兵自动清除，无残留 |

### 2.1 验收点 1：旧档进入（内存迁移，不落盘）

| 项 | 实测 |
|---|---|
| 进入后 `_save.v` | **2** |
| 等级 / 经验 / 金币 | **17 / 85 / 1094**，与旧档一致 |
| 背包 / 已通副本 | **9 件 / `["mine","chapel"]`** |
| 材料 / 远征 | `materials.ash_dust = 5`；`expedition = {regionId:"ash", seed:1598708522, supply:0, hp:342, pos:9, visited:[0,1,3,6,9], done:[1,3,6,9], runMaterials:{ash_dust:5}, complete:false}` |
| 新增字段 | `trinketBag: []`、`bounties: []`、`bountyProgress: {}`、`bountyDay: 0`、`bountyCursor: 0` 全部存在；`_save` 共 24 个键 |
| localStorage | 仍是 **v1、1948 字节**；键里已有空的 `bounties`，但**没有** `trinketBag / bountyProgress / bountyDay / bountyCursor`（符合「迁移只在内存、未落盘」） |
| UI 对照 | 野外页标题「野外 · 灰烬荒原」，`生命 342/348`、`补给 0/3`、`灰烬 ×5（本程 5）`、`已清理 4/12 个节点`；装备面板显示「金币 1094」「生命上限 348」「1 / 2（9）」「已装备 0/8」；与旧档逐项吻合 |

**结论：通过。** 截图 `.playwright-mcp/r18-00-initial.png`。

### 2.2 验收点 2：真实操作触发落盘升级

- 操作：打开装备面板（只读查看）→ 点「返回」关闭 → 在野外图点相邻的已清理节点 **6（宝箱）**（CSS `523,350`）。该操作走 `onWildNodeTap → enterNode(transit) → _persist()`，是真实的「走一个节点」。
- 实测：`expedition.pos` **9 → 6**（`transit`，不扣补给/生命），`hp 342`、`done [1,3,6,9]`、`runMaterials {ash_dust:5}` 不变。
- localStorage：**1948 → 2015 字节，`v: 2`**；新增 `trinketBag / bountyProgress / bountyDay / bountyCursor` 四个键。
- 字段 diff（v1 localStorage → 落盘 v2）：`level 17→17`、`exp 85→85`、`gold 1094→1094`、`classId warrior→warrior`、`inventory 9→9`、`dungeonsCleared ["mine","chapel"]→同值`，**均无丢失**。

**结论：通过。**

### 2.3 验收点 3：整页 reload 后进度仍在

- 操作：`page.reload()`，等待 3.5 s。
- 实测：`localLen 2015 / v2`；内存 `level 17 / exp 85 / gold 1094 / inv 9 / dungeons ["mine","chapel"] / pos 6 / hp 342 / done [1,3,6,9] / runMaterials {ash_dust:5}`；`visited [0,1,3,6,9]`；`trinketBag []`、`bounties []`、`bountyProgress {}`、`bountyDay 0`、`bountyCursor 0`。
- UI 自动回到野外图，标题读数 `生命 342/348`、`补给 0/3`、`灰烬 ×5（本程 5）`、`已清理 4/12`，与落盘一致。
- console：**0 error**（2 条引擎自身弃用 warning，见 §2.6）。

**结论：通过。**

### 2.4 验收点 4：未来版本 / 坏档容错（含夹具注入与恢复）

> 本节所有异常档均为**试玩者注入的夹具**，通过 `addInitScript` 一次性写入；每次测完已恢复为第 2 步落盘的 v2 档（2015 字节，逐字段核对）。

**夹具 A：`v:99` + 非法字段 + 未知键**

```json
{"v":99,"level":999,"exp":999999999,"gold":1e15,"materials":{"ash_dust":1e15},
 "unknownKey":"SHOULD_BE_DROPPED", ...}
```

| 检查项 | 实测 |
|---|---|
| 是否崩溃 / 红色报错 | 不崩，console 0 error |
| 内存版本 | **v2** |
| 等级夹取 | **30**（`LEVEL_MAX`） |
| 经验 | **0**（满级清零，未残留 999999999） |
| 金币夹取 | **1 000 000 000 000**（1e12 上限） |
| 材料夹取 | `ash_dust = 1 000 000 000`（1e9 上限） |
| 未知字段 | `_save` 无 `unknownKey`；随后真实点「开始远征」落盘后，localStorage 中也不含 `unknownKey` |
| 落盘 | 点「开始远征」（真实 UI）后 localStorage 变为 **v2、806 字节**，`level 30 / gold 1e12`，未知键被丢弃 |

**夹具 B：坏 JSON `{oops`**

| 检查项 | 实测 |
|---|---|
| 是否崩溃 / 红色报错 | 不崩，console 0 error |
| 回落结果 | **默认战士档**：`classId warrior / level 1 / exp 0 / gold 0 / inventory 0 / dungeons [] / expedition null`，`v2`；`trinketBag []`、悬赏四字段齐全 |
| 可正常开局 | 真实点「开始远征」→ `expedition {regionId:"ash", pos:0, hp:60, supply:3}`；localStorage 写为 **v2、743 字节** |

**恢复**：重新注入第 2 步落盘的 v2 原文（2015 字节），reload 后逐字段核对：`level 17 / exp 85 / gold 1094 / inv 9 / dungeons ["mine","chapel"] / pos 6 / hp 342 / done [1,3,6,9] / runMaterials {ash_dust:5}`，`localLen 2015 / v2`。sessionStorage 仅剩 `__mithril_m9_seed=1`，夹具哨兵已清除。

**结论：通过。**

### 2.5 验收点 5：远征长跑读写（走节点 → reload → 退出大厅 → 重进）

| 步骤 | 实测 |
|---|---|
| 起点 | 灰烬荒原，`pos 9`（废弃矿坑 / 已清理），`hp 342/348`，`done [1,3,6,9]`，`runMaterials {ash_dust:5}` |
| 走 1 个节点 | 点相邻已清理节点 6（宝箱）→ `pos 6`；`transit` 不扣补给/生命，`hp 342` 不变 |
| reload 后 | `pos 6 / hp 342 / done [1,3,6,9] / runMaterials {ash_dust:5}`，与落盘逐项一致 |
| 退出到大厅 | 点「返回大厅」→ 成功进入 `Lobby` 场景（读到大厅游戏列表标签：2048、战争进化、贪吃蛇…） |
| 重进远征界面 | 从场景 URL 重新进入 `Mithril` → `WildMap` 激活，`pos 6 / hp 342 / done [1,3,6,9] / runMaterials {ash_dust:5} / level 17 / gold 1094`，`localLen 2015` |

> 说明：`mithril` 尚未注册进 `GAME_LIST`（M11 才做），大厅里没有它的图标，因此「重进」只能靠场景 URL；这是计划内的延后项，不是本轮缺陷（见 §4.3）。

**结论：通过。**

### 2.6 验收点 6：控制台

- 全程 `browser_console_messages(level:'error')`：**0 error**（夹具 A/B、reload、退出/重进各阶段分别复查）。
- 2 条 warning 均为引擎自身弃用提示，与本轮改动无关：
  - `'systemEvent' is deprecated since v3.4.0, please use 'input' instead.`
  - `'SystemEvent' is deprecated since v3.4.0, please use 'Input' instead.`

**结论：通过（warnings 不计缺陷）。**

### 2.7 补充迁移探针（非必测，验证 M9.1 语义）

| 夹具 | 期望 | 实测 |
|---|---|---|
| v1、`level 17`、`exp 1e9`（溢出）、`trinkets ["greed_eye", null]`、无 `trinketBag`、无悬赏字段 | 经验逐级折算；已装备饰品登记为已拥有；悬赏字段补空 | **`level 30 / exp 0`**；**`trinketBag ["greed_eye"]`** 且 `trinkets ["greed_eye",null]` 保留；`bounties [] / bountyProgress {} / bountyDay 0 / bountyCursor 0`；`v2` |

**结论：通过。** 说明 pre-M7 与经验溢出两条迁移路径在真实读档入口生效。

## 3. 问题清单（机读区）

| ID | 级别 | 游戏 | 入口 | 现象 | 复现 | 期望 | 证据 |
|----|------|------|------|------|----------|------|------|
| （无） | — | mithril | 旧档进入 / 野外远征 / 坏档注入 | 本轮 6 个必测点 + 2 条补充迁移探针全部通过，未复现 P0/P1/P2/P3 | 见 §2.1–§2.7 | — | 见 §2 探针读数、§5 结束状态、`.playwright-mcp/r18-00-initial.png`、`.playwright-mcp/r18-01-restored-after-fixtures.png` |

> N59 及以后编号未占用。

## 4. 未覆盖 / 疑点

1. **真正的 10,000 步战斗长跑不在 UI 试玩范围**：那由 `tools/verify-mithril-balance.js` §1 覆盖；本轮只验证了远征状态在真实 UI / 落盘 / reload / 退场景后的读写一致性。
2. **远征只走了 1 个 transit 节点（9→6）**：满足「至少 1 个节点」，但未在本轮继续打战斗节点或 BOSS；`hp` 因 transit 规则保持 342，未验证战斗结算后的生命回写（M6/M7 已有覆盖）。
3. **大厅入口缺失**：`mithril` 未注册 `GameConfig.GAME_LIST`，点「返回大厅」后无图标可重进，只能通过 `?scene=` URL 回到游戏。计划明确延后到 M11，**不计本轮缺陷**；但真机/正式包前必须补齐，否则玩家无法二次进入。
4. **坏档 / 未来档回落对玩家完全静默**：坏 JSON 直接变成 Lv1 战士、`v:99` 静默降级，均无提示。这符合 M9 规格（「回落默认战士档」「未知字段丢弃」），但从玩家视角会被误认为「掉档 / 清档」。建议 M10+ 加一条一次性提示；**本轮不计缺陷**。
5. **未覆盖**：跨日 `bountyDay` 刷新、军需官 Lv4 每日重置、`gather_blue` 收集类悬赏在「有已装备件」时的扣除边界（沿用第 17 轮未覆盖面）。
6. **已排除的疑点**：
   - 「旧档进入后 localStorage 还是 v1」——**符合预期**，迁移只在内存；首次 `_persist()`（节点 transit）后即变 v2。
   - 「夹具 A 落盘前 `localV` 还是 99」——**符合预期**，只有真实写档才把夹取后的 v2 写入；已用「开始远征」验证。
   - 「Lv30 夹具点开始远征进入 `abyss` 而不是 `ash`」——查 `_defaultRegionId()` 为「按等级取最高已解锁区域」，**符合设计**。
   - 「关闭装备面板后 `EquipMenu.active` 仍为 true」——面板节点保持 active 但子节点为 0，视觉已关闭，**不是残留遮挡**。
   - 「reload 前直接写 localStorage 夹具无效」——卸载时 `_persist()` 会把旧档写回；改用 `addInitScript` 后生效，属于已知工具坑，不是产品缺陷。

### 复现配方（最小步骤）

```text
# 前置：真实 v1 档 1948 字节，页面已加载，sessionStorage.__mithril_m9_seed=1
# 验收 1：探针读 MithrilGame._save
v=2, level17, exp85, gold1094, inv9, dungeons[mine,chapel], pos9, hp342,
done[1,3,6,9], trinketBag[]/bounty 四字段齐全；localStorage 仍 v1/1948

# 验收 2：野外图点节点 6（CSS 523,350）
pos 9→6；localStorage 1948→2015，v2；等级/金币/背包/副本次数不变

# 验收 3：page.reload()
v2/2015、pos6、hp342、done[1,3,6,9]、runMaterials{ash_dust:5} 全部保持

# 验收 4：夹具（addInitScript + sessionStorage 哨兵）
A: {"v":99,"level":999,"gold":1e15,...,"unknownKey":"x"} → 不崩；level30/gold1e12/无 unknownKey；开始远征后落盘 v2/806
B: "{oops" → 默认战士 Lv1/gold0/inv0；开始远征 → ash pos0 hp60 supply3，落盘 v2/743
恢复：写回 2015 字节 v2 原文 → reload 后逐字段一致

# 验收 5：点「返回大厅」(CSS 769,675) → Lobby；用场景 URL 重进
WildMap pos6 / hp342 / done[1,3,6,9] / ash_dust5 / level17 / gold1094

# 验收 6：console error 0（2 条引擎弃用 warning）
```

## 5. 结束状态

| 项 | 值 |
|---|---|
| localStorage 长度 | **2015** |
| `v` | **2** |
| 等级 / 经验 / 金币 | **17 / 85 / 1094** |
| 背包 / 已通副本 | **9 件 / `["mine","chapel"]`** |
| `trinketBag` | `[]` |
| 悬赏字段 | `bounties []`、`bountyProgress {}`、`bountyDay 0`、`bountyCursor 0` |
| 远征 | `regionId ash / pos 6 / hp 342 / done [1,3,6,9] / runMaterials {ash_dust:5}`；`visited [0,1,3,6,9]` |
| sessionStorage | 仅 `__mithril_m9_seed = "1"`；夹具哨兵已清除 |
| console | 0 error；2 条引擎弃用 warning |
| 浏览器 | **已 `browser_close`**（无残留标签页） |

**截图**：`.playwright-mcp/r18-00-initial.png`（旧档进入后的野外图）、`.playwright-mcp/r18-01-restored-after-fixtures.png`（夹具测试并恢复后的同一界面）。
