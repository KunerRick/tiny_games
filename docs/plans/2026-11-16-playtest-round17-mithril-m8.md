# 《秘银远征》第 17 轮试玩报告（M8 · 24 悬赏 + 终局循环：悬赏板）

> 日期：2026-11-16 · 游戏：`mithril` · 场景：`assets/games/game_mithril/scenes/Mithril.scene`
> 试玩者：fresh 子代理（独立试玩者，非开发者）。**所有结论来自真实鼠标点击 + 只读页内探针**；未改任何 `.ts` / 场景 / 预制体，未写 `localStorage`，未调用开发者内部方法伪造进度。
> 环境：Cocos Creator 3.8.8 编辑器预览 `http://127.0.0.1:7456/?scene=a3d6ebf7-4a20-4b12-b82a-1da5c08b6218`（已在跑，未启动/重启编辑器）。
> 对照：M8 计划 `docs/plans/2026-11-16-mithril-m8-plan.md`；上一轮 `docs/plans/2026-11-15-playtest-round16-mithril-m7.md`（编号已用到 N58，本轮从 N59 起）。

## 1. 结论

**P0 = 0 · P1 = 0 · P2 = 0 · P3 = 0。**

本轮必测的 7 个验收点全部通过：悬赏板 6 行渲染无重叠、进度文案与可领/未完成状态正确；领取击杀类（`hunt_mobs`）金币 +200 且空位立刻补位（板面保持 6 条）；领取收集类（`gather_ash`）金币 +250、灰烬 22→2、提示写明「交付 灰烬 ×20」、背包/装备不受损；「未完成」条目（挑战类与收集类各点一次）不发奖也不扣物；整页 reload 后金币/材料/板面与落盘一致。浏览器 console **0 error**。

> 编号使用：**N59 及以后未使用**（本轮未复现任何缺陷，不占用编号）。

## 2. 问题清单（机读区）

| ID | 级别 | 游戏 | 入口 | 现象 | 复现步骤 | 期望 | 证据 |
|----|------|------|------|------|----------|------|------|
| （无） | — | mithril | 野外地图 →「营地」→「军需官」悬赏板 | 本轮 7 个验收点全部通过，未复现 P0/P1/P2/P3 级问题 | 见 §3 覆盖矩阵 | — | 见 §4 探针读数、§5 截图 |

## 3. 覆盖矩阵（本轮必测 1–7）

| # | 验收点 | 结果 | 证据（真实点击 + 只读探针） |
|---|--------|------|------|
| 1 | 悬赏板正常渲染：6 行、进度文案、可领/未完成状态、无重叠/被表头压住 | **通过** | 6 行顺序：`hunt_mobs`「击杀 30 只小怪 · 进度 30/30 · 奖励 200 金」→`gather_ash`「交出 20 份灰烬 · 进度 灰烬 20/20 · 奖励 250 金」→`challenge_crit_streak`「单次副本内暴击 20 次 · 进度 0/1 · 奖励 600 金」→`dungeon_1`「通关副本 1 · 进度 1/1 · 奖励 400 金」→`hunt_burst`「10 秒内击杀 5 只怪 · 进度 1/1 · 奖励 400 金」→`gather_blue`「上交 3 件蓝装 · 进度 蓝装 2/3 · 奖励 350 金」。按钮：前 4 与 `hunt_burst` 为「领取」，`challenge_crit_streak`、`gather_blue` 为「未完成」。表头 "悬赏板 6/6 条 · 自动追踪…" 包围盒 y=878–906，首行文本包围盒 y=820–872，**间隔 6 世界像素，无重叠**（`UITransform.getBoundingBoxToWorld()`）。截图 `.playwright-mcp/r17-01-bounty-initial.png` |
| 2 | 领取击杀类：金币 +200、该条消失并立刻补一条、板面保持 6 条、有提示 | **通过** | 点首行「领取」(CSS 772.6,271.2)：`gold 1000→1200`；`bounties` 由 `[…,hunt_burst,gather_blue]` 变为 `[gather_ash,challenge_crit_streak,dungeon_1,hunt_burst,gather_blue,hunt_mobs]`（原 `hunt_mobs` 移除、补入新条、仍 6 条）；`bountyProgress.hunt_mobs` 被清空、补入的 `hunt_mobs` 现为 0/30「未完成」；`bountyCursor 5→6`；面板提示「悬赏完成：金币 +200」；顶部资源行同步「金币 1200 · 灰烬 22」 |
| 3 | 领取收集类（灰烬）：金币 +250、灰烬 22→2、提示「交付 灰烬 ×20」、只扣背包不扣已装备 | **通过（装备侧见 §6 限制）** | 点当前首行「领取」(772.6,271.2)：`gold 1200→1450`、`materials.ash_dust 22→2`；提示「悬赏完成：金币 +250 · 交付 灰烬 ×20」；补位 `dungeon_last_hit`「用单个技能完成副本 BOSS 最后一击 · 0/1 · 500 金」，板面仍 6/6；`bountyCursor 6→7`；背包 9 件不变、`equips` 全为 null（本轮夹具无已装备件，见 §6） |
| 4 | 重复点击同一条已领悬赏不会二次发奖 | **通过** | 领奖后探针确认 `gather_ash` 已不在 `bounties` 中（原 `hunt_mobs` 亦已移除，无从再点「同一条」）。为排除「同槽位复用旧回调」的隐患，在原坐标 (772.6,271.2)（现在已是补位的 `challenge_crit_streak` 未完成）再点一次：`gold` 恒 1450、`ash` 恒 2、`bounties` 不变、提示「还没完成这条悬赏」——补位行回调已正确重绑，无二次发奖 |
| 5 | 「未完成」条目点击不发奖、不扣物 | **通过** | ① 挑战类 `challenge_crit_streak`「未完成」(772.6,347.6)：`gold 1000`、`ash 22`、`bounties` 均不变，提示「还没完成这条悬赏」。② 收集类 `gather_blue`「未完成」(772.6,385.8)：`gold 1450`、`ash 2`、背包 9 件（`rare 2 / epic 4 / uncommon 3`）均不变，提示「收集物不够：先攒够再交」 |
| 6 | 领奖后刷新页面，金币/材料/板面保持一致（落盘正常） | **通过** | `page.reload()` 后 `gold 1450`、`ash 2`、`bounties [challenge_crit_streak,dungeon_1,hunt_burst,gather_blue,hunt_mobs,dungeon_last_hit]`、`bountyProgress {dungeon_1:1,hunt_burst:1}` 全部保持；重新进「营地」→「军需官」，板面 6 行与落盘逐条一致，顶部「金币 1450 · 灰烬 2」、卡片「库存材料 灰烬 2」、野外地图「灰烬 ×2（本程 5）」也一致。截图 `.playwright-mcp/r17-02-bounty-after-reload.png` |
| 7 | 探针读数（存档 + 场景 Label） | **通过** | 见 §4：读 `localStorage['tiny_games_mithril_save']` 的 `gold / materials.ash_dust / bounties / bountyProgress / bountyCursor / bountyDay`、`inventory` 品质计数、`equips`；场景侧遍历 `Canvas/GameRoot/CampMenu` 下 `cc.Label` 文案与 `Content` 行/按钮顺序 |

## 4. 方法与数据说明

### 4.1 视口与坐标（现场标定）

| 项 | 值 |
|---|---|
| 视口 | 1280 × 720 |
| `devicePixelRatio` | 1（本轮 k = 1，未出现偏移） |
| `canvas` rect | `{x:443.5, y:41.45, w:393, h:678.55}` |
| 坐标换算 | `cssX = rect.left + sp.x / dpr`；`cssY = rect.top + rect.height − sp.y / dpr`，其中 `sp = cam.worldToScreen(ui.convertToWorldSpaceAR(cc.v3(0,0,0)))` |
| 关键点位 | 营地按钮 (593.3,675.4)、军需官页签 (777.9,143.9)、6 个领奖/未完成按钮同在 x=772.6，y = 271.2 / 309.4 / 347.6 / 385.8 / 424.0 / 462.2（步长 38.2） |
| 按钮组件 | 行按钮为 `Node.EventType` 事件（节点上**无 `cc.Button` 组件**），真实点击均生效 |

每个页面 reload 后重新标定坐标（本轮 reload 前后坐标一致）。

### 4.2 探针字段（只读）

- 存档：`gold`、`materials.ash_dust`、`materials`、`bounties`、`bountyProgress`、`bountyCursor`、`bountyDay`、`inventory`（按 `quality` 计数）、`equips`。
- 场景：`Canvas/GameRoot/CampMenu/Camp/Panel/Content` 的子节点顺序（Label/Button 交替）、各 `cc.Label.string`、`UITransform.getBoundingBoxToWorld()`（判重叠）。

### 4.3 是否改过状态（本轮：没有用探针写状态）

| 项 | 说明 |
|---|---|
| 开工夹具 | `gold 1000`、`materials.ash_dust 22`、军需官 Lv2（悬赏位 6）、`bounties [hunt_mobs,gather_ash,challenge_crit_streak,dungeon_1,hunt_burst,gather_blue]`、`bountyProgress {hunt_mobs:30,dungeon_1:1,hunt_burst:1}`、远征灰烬荒原 4/12 |
| 本轮变化来源 | **全部通过真实点击游戏内「领取」产生**，未用探针写 `localStorage`、未改金币/材料/存档、未调用内部方法：领 `hunt_mobs`（+200 金）、领 `gather_ash`（+250 金、−20 灰烬） |
| 结束时 | `gold 1450`、`ash 2`、`bounties [challenge_crit_streak,dungeon_1,hunt_burst,gather_blue,hunt_mobs,dungeon_last_hit]`、`bountyProgress {dungeon_1:1,hunt_burst:1}`、`bountyCursor 7`、背包 9 件（`rare 2 / epic 4 / uncommon 3`）、`equips` 全 null |
| 未触碰 | 未写 `localStorage`；未改任何 `.ts` / 场景 / 预制体；探针只读 |

### 4.4 截图（`.playwright-mcp/`）

`r17-01-bounty-initial.png`（开工悬赏板 6 行）、`r17-02-bounty-after-reload.png`（领奖 + reload 后的板面：金币 1450 / 灰烬 2，6 行）。

## 5. 未复现 / 已排除的疑点

1. **「领完 `hunt_mobs` 后板上立刻又出现同名 `hunt_mobs」——不是补位缺陷，是夹具游标造成的**：补位走 `bountyOrder(day)` 洗牌序列。本轮 `bountyDay = 20773`，用与 `MithrilBounty.ts` 相同算法复算得 `order[5] = hunt_mobs`、`order[6] = dungeon_last_hit`；夹具把 `bountyCursor` 置为 5、且初始 6 条是**手工指定**的（并非 `order[0..5]`），故两次补位正好取到 `order[5]`（`hunt_mobs`）与 `order[6]`（`dungeon_last_hit`）。正常开局从空板按 `order` 顺序铺满 6 条后 `cursor=6`，补位取 `order[6]`，不会复现已领条目。**结论：夹具 setup 现象，非产品缺陷。**
2. **「领奖后板面行序整体上移」——符合预期**：领奖即从 `bounties` 移除该条、补位追加到末尾，面板按 `bounties` 顺序重排；不是错位。
3. **「首行紧贴表头」——已量化排除**：表头包围盒底 y=878，首行文本顶 y=872，间隔 6 世界像素，截图中亦无压字。
4. **「收集类未完成按钮点了却弹出『收集物不够』而非『还没完成』」——文案正确**：`gather_blue` 是收集类，库存 `rare=2 < 3`，提示「收集物不够：先攒够再交」；挑战类 `challenge_crit_streak` 才是「还没完成这条悬赏」。两者语义均正确。
5. **背包「蓝装 2/3」与库存一致**：探针按 `quality` 计数 `rare=2`，与进度 2/3 吻合，判定为「按当前库存判定」正确。
6. **「重复点击已领条目」无法直接构造**：领奖后该 id 已不在 `bounties` 中，UI 上不存在「同一条」可再点；已用「同槽位重点一次」与「补位行回调」双重排除二次发奖（见 §3 第 4 点）。

## 6. 剩余风险 / 未覆盖

1. **「收集类只扣背包不扣已装备」的装备侧未取得实证**：本轮夹具 `equips` 八个槽位全为 `null`（无已装备件），且唯一涉及装备的收集悬赏 `gather_blue` 进度仅 2/3（不可领）。已实测收集类**材料侧**（`gather_ash` 扣 20 灰烬、背包 9 件不变）；「不扣已装备」建议在 `gather_blue` 可领 + 有已装备件的夹具下补测。
2. **军需官 Lv4 每日刷新路径不在本轮范围**（夹具 Lv2）；未验证跨日 `bountyDay` 变化时的重置。
3. **`dungeon_1` / `hunt_burst` 两条可领悬赏本轮未点领**（仅验证一条击杀类与一条收集类，符合必测要求）；其领奖路径与已测两条同构，风险低。
4. 微信小游戏端未验证；本轮只覆盖桌面预览 1280×720。

## 7. 复现配方（最小步骤）

```text
# 进入悬赏板
预览页 → 底部「营地」(593.3,675.4) → 顶部「军需官」(777.9,143.9)

# 验收 2：领击杀类 hunt_mobs（首行，772.6,271.2）
gold 1000 → 1200；行消失；末尾补一条 hunt_mobs(0/30)「未完成」；板仍 6/6
提示「悬赏完成：金币 +200」

# 验收 3：领收集类 gather_ash（现首行，772.6,271.2）
gold 1200 → 1450；ash 22 → 2；补入 dungeon_last_hit
提示「悬赏完成：金币 +250 · 交付 灰烬 ×20」

# 验收 4：同槽位再点一次（772.6,271.2，现为 challenge_crit_streak 未完成）
gold 恒 1450；提示「还没完成这条悬赏」（无二次发奖）

# 验收 5：未完成条目
challenge_crit_streak（772.6,347.6）→ 不变，提示「还没完成这条悬赏」
gather_blue（772.6,385.8）→ 不变，提示「收集物不够：先攒够再交」

# 验收 6：整页 reload → 再进营地/军需官
gold 1450 / ash 2 / 6 条板面 与落盘一致
```

## 8. 结语

M8 悬赏板在桌面预览里的主体验全部走通：自动追踪、无需接取；领奖即完成并即时补位；击杀类与收集类奖励/扣除正确、提示文案明确；「未完成」不误发奖；整页刷新后金币、材料与板面均与 `localStorage` 一致；console 无报错。本轮未发现 P0/P1/P2/P3 问题；需要补强的只是「只扣背包不扣已装备」在夹具缺已装备件下无法实证（§6）。

---

**已 browser_close**（本轮结束时调用 `browser_close`，无残留标签页）。
