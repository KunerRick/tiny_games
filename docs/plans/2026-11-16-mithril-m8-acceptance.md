# 《秘银远征》M8 验收记录（24 悬赏 + 终局循环）

> 日期：2026-11-16 · 分支：`develop` · 范围：M8（悬赏数据 × 悬赏板 × 战斗统计 × 领取闭环 × 每日刷新）
> 计划：`docs/plans/2026-11-16-mithril-m8-plan.md`
> 设计规格：`docs/plans/2026-11-14-game-mithril-design.md` §4.6（军需官）/ §14.3（24 条悬赏）
> 前置：M7 已验收（`2026-11-15-mithril-m7-acceptance.md`，`5cd6d9f`）
> 试玩：`2026-11-16-playtest-round17-mithril-m8.md`（第 17 轮）

## 1. 退出判据与实测

| 判据 | 要求 | 实测 | 结论 |
|---|---|---|---|
| 1. 24 条悬赏可机读 | 24 / 4 类各 6 / id 唯一 / metric 合法 / target>0 / 奖励可发放 | `verify-mithril-bounty.js` §1（001–024）：24 条、4 类各 6、id 唯一、22 个指标全部合法、每条 target 为正整数且金币为正；装备奖励品质、材料奖励 id 与数量、收集类 `consume` 合法性逐条断言；紫装仅 `hunt_region_boss`、橙装仅 `challenge_full_run` | ✅ |
| 2. 军需官分档 | Lv1 3 位 → Lv2 起 6 位 → Lv4 每日刷新 | 脚本 110–128 覆盖 0/3/6 位、扩容补位、领取补位、Lv4 跨日刷新与 Lv3 不刷新；浏览器三个夹具档实测：**Lv1 表头「悬赏板 3/3 条」+ 3 行**、Lv2 6 行、Lv4 跨日刷新（日号推进 + 进度清空 + 板面重洗，见 §3） | ✅ |
| 3. 自动追踪 / 收集扣除 | 18 条自动 + 6 条收集，全部由真实数据驱动 | 脚本 §3：16 个自动指标逐个用合成战斗报告推满，并逐条反证「条件不满足不推进」（无死亡 / ≤300 s / 技能尾刀 / 纯白装 / 无饰品 / 20 暴击 / 10 件战利品 / 12 节点）；§4：5 条上交按库存判定、精确扣 target、只扣背包不碰已装备；§7：`Camp.dismantle` 真实钩子推进分解悬赏 | ✅ |
| 4. 领取闭环 | 金币 / 材料 / 紫装 / 橙装、自动补位、刷新重置 | 脚本 §5：紫装 ilvl = clamp(level+8, 1, 40)、橙装直发、材料加成、重复领取 `not-active`、未完成 `not-ready`、非板上 `not-active`、未知 id `bad-def`、领取后删进度键；浏览器实点：+200 金 / +250 金且灰烬 22→2、空位立刻补新条（见 §3） | ✅ |
| 5. 存档 | 新字段有默认值、坏档净化、旧档可读、真实档往返不丢 | 脚本 §6（501–515）：往返保留板面 / 进度 / 日号 / 游标；坏档剔非法 id、去重、裁到 6、进度夹到 target、负进度归零、非板上键清掉、负日号归零、游标夹到 0–23；旧档（无悬赏字段）可读；浏览器实测真实档恢复后字段 diff 为空（见 §3.4） | ✅ |
| 6. 6 小时预算 | 分段合计 ≤ 6 h（literal 长跑归 M9） | 计划 §6 小时预算：1–30 级 3.5 h + 野外 1.0 h + 6 副本 0.5 h + 悬赏一轮 0.75 h = **5.75 h**；M8 未改经验曲线与副本时长，M9 用长跑脚本实测替换 | ✅（预算口径） |
| 7. 实点 + 试玩 | 浏览器实点记录 + 第 17 轮 P0/P1 清零 | 实点见 §3；第 17 轮（`2026-11-16-playtest-round17-mithril-m8.md`）：**P0 = 0 · P1 = 0 · P2 = 0 · P3 = 0**，7 个验收点全部通过，console 0 error，编号 N59 及以后未占用 | ✅ |

## 2. 交付内容

### 2.1 纯逻辑（无 `cc` 依赖，可 node 自检）

| 文件 | 内容 |
|---|---|
| `MithrilBounty.ts`（新） | `bountyOrder(day)`（同一天同一组、跨日换组，本地 `mulberry32` 副本避免 Core↔Camp↔Bounty 循环依赖）、`ensureBountyBoard`（补位 / Lv4 跨日重置 / 坏档裁切 / 游标回绕与夹取）、`bountyProgressOf`（自动类读存档、收集类读库存）、`isBountyReady`、`advanceBountyMetric`、`applyRunReport`（击杀类失败局也算；通关类逐条附加条件）、`claimBounty`（校验 → 扣收集物 → 发金币 / 材料 / 装备 → 移除并补位，返回结构化结果）、`bountyBoardRows`、`bountyItemIlvl`、`bountyToday` |
| `MithrilConfig.ts` | `BOUNTIES` 24 条补齐 `metric / target / gold / item / material / consume`；`BOUNTY_BY_ID`；`BountyStats` 与 `emptyBountyStats()`（放在 Config 避免 Core ↔ Bounty 运行期循环） |
| `MithrilProgress.ts` | 存档新增 `bounties: string[]`、`bountyProgress: Record<string, number>`、`bountyDay`、`bountyCursor`；`defaultSave` 给默认值；`sanitizeSave` 净化（非法 / 重复 id、超位、进度越界、负日号、游标） |
| `MithrilCore.ts` | `EnemyState.spawnTime`；每局 `stats`（`startPlan` 清零）+ `_killTimes`（10 秒窗口）+ `_lastPlayerDamageTime`（精英无伤）+ `_lastKillingSource`（BOSS 尾刀）；`_killEnemyAt` 分类计数；`_damageEnemy` 暴击计数与尾刀来源；`hitPlayer` 记录挨打时刻；`snapshot()` 带 `stats` 副本 |
| `MithrilCamp.ts` | `dismantle()` 成功后 `advanceBountyMetric(save, 'dismantle', 1)`（面板 / 脚本共用同一入口） |
| `MithrilGame.ts` | `_syncBountyBoard()`（onLoad / 打开营地时补板）；`_bountyRefreshPending` 让「跨日刷新」提示在重载后首次打开营地也能看到；`_beginNodeCombat` 取 `whiteOnly / noTrinket` 快照；`_settle` 组装 `BountyRunReport` 交给悬赏系统 |
| `MithrilCampPanel.ts` | 军需官页重写：库存两行摘要、`悬赏板 N/6 条 · 自动追踪…` 表头、6 行两列（左两行文案 / 右 120×46 按钮）、底部说明；`_onBountyClaim` 领奖（装备走 `addToInventory`，背包满按 `sellPrice` 折金币）、`open(save, notice)` 显示每日刷新提示 |

### 2.2 验证脚本

| 文件 | 覆盖 |
|---|---|
| `tools/verify-mithril-bounty.js`（新） | 8 组 **471 项**：① 纯度（禁 cc / `Date.now` / `Math.random` / `localStorage`）② 配置完整性 ③ 悬赏板（3/6 位、不重复、补位、Lv4 刷新、Lv3 不刷新、游标回绕、坏档裁切）④ 16 个自动指标逐个推满 + 10 条反证 + 失败局边界 ⑤ 5 条收集类精确扣除与已装备保护 ⑥ 领取奖励（紫/橙、装等夹取、重复领取、错误原因）⑦ 存档往返与坏档净化 ⑧ `Camp.dismantle` 钩子 |
| `tools/verify-mithril-core.js` | 202 → **221 项**：新增 §13 悬赏战斗统计（击杀分类 / 精英无伤 / 爆发 / 低血 / 10 秒窗口 / 暴击 / BOSS 尾刀） |

### 2.3 回归基线

```
verify-mithril-core      221/221
verify-mithril-camp      337
verify-mithril-dungeons  892
verify-mithril-trinkets  692
verify-mithril-wild      2829
verify-mithril-bounty    471
tsc --noEmit             TS_OK（编辑器自带 5.8.2）
```

## 3. 浏览器实点记录

夹具（开发者预装，只读）：金币 1000、灰烬 22、军需官 Lv2、板面 6 条（其中 `hunt_mobs` 30/30、`gather_ash` 灰烬 20/20、`dungeon_1` 1/1 可领，`gather_blue` 2/3 不可领）。坐标按 `camera.worldToScreen` + canvas `getBoundingClientRect()` 换算成页面 CSS 坐标，用真实鼠标点击（视口 1280×720，画布 393×679，`devicePixelRatio = 1`）。

### 3.1 击杀类领取

点第 1 行「领取」（`hunt_mobs`）→ 存档 `gold 1000 → 1200`；`bounties` 中 `hunt_mobs` 消失、空位立刻补入新条，板面保持 6 条；面板底行提示「悬赏完成：金币 +200」。

### 3.2 收集类领取

点 `gather_ash` 行「领取」→ `gold 1200 → 1450`；`materials.ash_dust 22 → 2`（精确扣 20）；提示「悬赏完成：金币 +250 · 交付 灰烬 ×20」；背包与已装备未受影响。

### 3.3 Lv4 跨日刷新

夹具改为军需官 Lv4、`bountyDay = 今天 - 1`、板上进度全部非 0 → 重载后：日号推进到今天、`bountyProgress` 清空、板面按当日顺序重洗 6 条；首次打开营地即显示「每日刷新：今日悬赏已更新（未领取进度已重置）」。

> 实点中发现并修复：刷新发生在 `onLoad`，`openCamp()` 再次同步时 `refreshed` 已为 false，重载后的玩家看不到任何提示。新增 `_bountyRefreshPending`，把 `onLoad` 的刷新结果带给首次打开营地。

> 纯逻辑侧同时补了一处：`ensureBountyBoard` 原只在「需要补位」时夹取 `bountyCursor`，板面已满时坏档里的越界游标会原样留在内存；改为每次同步都夹到 `0..23`。

### 3.4 真实存档还原

测试前把真实档（1948 字节）备份，测试后用 `addInitScript` 写回：`len = 1948`，`gold 1094 / Lv17 / exp 85 / trinkets [null,null] / 远征 pos 9、hp 342、supply 0、done [1,3,6,9]` 全部一致，字段级 diff 为空。夹具期间产生的临时 localStorage 键已清除。

### 3.5 Lv1 三位实点

另起夹具（军需官 Lv1、灰烬 4、3 条悬赏、`hunt_mobs` 12/30）→ 打开营地军需官页：表头「悬赏板　3/3 条 · 自动追踪，完成即可领取 · Lv4 起每日刷新」，仅 3 行（12/30、灰烬 4/20、0/1），三行按钮均为「未完成」，下方说明「下一级：仓库共 +12 格，悬赏位 3→6」。

## 4. 设计偏差（已写入配置注释 / 计划）

| 项 | 设计原文 | 实现 | 原因 |
|---|---|---|---|
| 6 位解锁等级 | 「3 级 6 条」 | **Lv2 起 6 位** | `MithrilCamp.bountySlots()` 自 M5 即为 3 → Lv2 起 6；改档位会牵动已验收的营地页与存档，收益低于成本；面板文案按实现写「悬赏位 3→6」 |
| 暴击悬赏 | 「连续 20 次暴击」 | 「单次副本内暴击 20 次」（`dungeon_crit`） | 暴击率上限 30%，20 连暴击概率 ≈ 1e-11，不可完成 |
| 橙装奖励 | 「橙装碎片」 | 直接给橙装 | M8–M11 没有锻造系统承载碎片，避免死货币 |

## 5. 数值口径

| 项 | 值 | 说明 |
|---|---|---|
| 悬赏金币总量 | 24 条合计 **13,550** | 计划写「≈13,000」；同量级，`verify-mithril-bounty.js` 024 以 ±1,000 容差断言 |
| 悬赏紫装 | 1 条（区域首领） | ilvl = clamp(level + 8, 1, 40)，品质 `epic` |
| 悬赏橙装 | 1 条（12 节点全清） | 品质 `legendary`，装等同夹取 |
| 进度上限 | 每条 ≤ target | 领取后删除进度键；板上最多 6 条 |
| 每日刷新 | 仅 Lv4 | 跨日重置未领取进度；Lv1–Lv3 不受影响 |

## 6. 未做 / 延后

- 悬赏「接取 / 放弃」：板上自动追踪，领取即完成（移动端少一次点击）。
- 悬赏专属剧情 / 长任务链：设计明确不做。
- **游戏注册（`GameConfig.GAME_LIST` / 大厅图标 / `docs/README.md`）**：按用户硬约束延后到 M11。
- M9：6 小时预算改长跑实测；M10：音效 / 触感 / 微信预检；M11：文档、图标与注册。

## 7. 第 17 轮试玩

报告：`docs/plans/2026-11-16-playtest-round17-mithril-m8.md`（fresh 子代理，独立试玩者）

| 项 | 结果 |
|---|---|
| 计数 | **P0 = 0 · P1 = 0 · P2 = 0 · P3 = 0**；编号 N59 及以后未占用 |
| 覆盖 | 7 个必测点全过：6 行渲染与包围盒无重叠（表头 y 878–906 / 首行 y 820–872）、领击杀类 +200 金并补位、领收集类 +250 金且灰烬 22→2 并写明「交付 灰烬 ×20」、同槽位补位行回调已重绑（再点提示「还没完成」）、未完成条不发奖不扣物、整页 reload 后落盘一致、console 0 error |
| 已排除疑点 | 「领完 `hunt_mobs` 立刻又出现同名条」经复算 `bountyOrder(day)` + 夹具手工板 + `bountyCursor=5`，判定为夹具 setup 现象；真实流程从空板铺满后 cursor 不会立刻回到刚领的条 |
| 未覆盖（已在报告写明） | 收集类「不扣已装备」的装备侧（夹具 equips 全空、蓝装 2/3 不可领，材料侧已证）；Lv4 刷新与另两条领奖与已测路径同构，由 §3.3 实点覆盖 |

试玩结束后真实档再次按 1948 字节原样写回（§3.4）。
