# 第 22 轮试玩报告 · 秘银远征（P2-5 首通记账 + 结算顺序回归）

- 日期：2026-11-16
- 构建：`build/web-mobile`（Cocos Creator 3.8.8，web-mobile）
- 预览地址：`http://127.0.0.1:8127/index.html`（原服务，未启停）
- 视口：720 × 1280，dpr = 1，canvas = 720 × 1280
- 结论口径：只报玩家能感知的问题

## 0. 结论

- **P0 = 0，P1 = 0，P2 = 0，P3 = 1**
- P2-5 的 5 个场景（满包首通 / 满包再通关 / 腾格补发 / 补发后第三次 / 有位首通）全部按预期工作；结算顺序（首通经验、技能书、饰品、节点 done、满包折金币）无回归；N61–N63 三项复查均通过。唯一问题是满包首通时「固定紫装折金币」的具体金额被结算面板 4 行收益上限挤掉，玩家无法从面板对上金币差额（P3，N64）。

## 1. 问题清单（机读）

| ID | 级别 | 游戏 | 入口 | 现象 | 复现 | 期望 | 证据 |
|----|------|------|------|------|------|------|------|
| N64 | P3 | 秘银远征 | 副本「废弃矿坑」首通，背包 60/60 | 固定紫装折金币 41 已实际入账（gold 0 → 215），但 `_rewardLines` 只保留前 4 行：`[本局收益 +174/+677, 已记账提示, 首通奖励 +800, 技能书 +2]`，第 5 行「背包已满：史诗·灰烬战斧（主手 8）折算 41 金币」被截掉。面板上金币只写 +174，与真实 +215 对不上，且玩家看不到这 41 金的来源。 | 注入 60 件白装 + `expedition:{regionId:'ash',seed:1,pos:9,...}`；`comp.onWildNodeTap(9)`；`debugGotoBoss()` + `debugKillAll()` 直到 `_settled`；读 `comp._save.gold` 与 `comp._hudRef._rewardLines`。 | 折金币金额在结算面板可见（例如并入「已记账」同一行：「背包已满，已折 41 金并记账」），或不占用 4 行收益名额。 | `.playwright-mcp/r22-pt-a1-fullbag-firstclear.png`；探针：gold 0→215，reward 第 4 行后无折算行 |

## 2. 覆盖范围与实测数据

### A. P2-5 首通记账（主目标，全部实测）

所有数值来自页内探针（`comp._save`、`comp._hudRef._rewardLines`），同一 ash + seed 1 地图、节点 9 = 废弃矿坑（`dungeonId='mine'`）。

| 场景 | 进入前 | 首通判定 | 结束后 | 结算面板关键行 | 判定 |
|------|--------|----------|--------|----------------|------|
| A1 满包首通 | inv 60，gold 0，Lv1，exp 0，书 0，pending [] | `_firstClear=true` | inv 60，gold **215**，Lv6，exp 316，书 **2**，pending **['mine']**，cleared ['mine']，饰品包 ['thorn_crown'] | 本局收益 +174/+677；**首通固定装备：背包已满，已记账（下次通关本副本时补发）**；首通奖励 +800；技能书 +2（现有 2） | 通过（仅 N64） |
| A1b 仍满包再通关 | inv 60，gold 215，书 2，pending ['mine'] | `false` | inv 60，gold **420**，Lv7，书 **3**，pending **['mine']** | 本局收益 +174/+677；技能书 +1（现有 3）；背包已满：史诗·灰烬战斧（主手 8）折算 31 金币；节点结束 | 通过：无首通经验、无「补发」字样、pending 不丢 |
| A2 腾 1 格补发 | inv **59**，gold 420，书 3，pending ['mine'] | `false` | inv **60**，gold **633**，Lv8，书 **4**，pending **[]**；最后一件 = 史诗 `mainHand_0`（主手 12）；饰品包新增 `greed_eye`（重复 25%） | 本局收益 +174/+677；**补发首通固定装备（上次首通时背包已满）**；技能书 +1（现有 4）；背包已满：传说·法袍腿（腿 8）折算 39 金币；获得 史诗·秘银巨剑（主手 12） | 通过：补发件先于随机掉落入包，随机件满包折 39 金；无首通经验/技能书重复 |
| A3 补发后第三次 | inv 60，gold 633，书 4，pending [] | `false` | inv 60，gold **846**，Lv9，书 **5**，pending **[]** | 本局收益；技能书 +1（现有 5）；背包已满：传说·深渊腿（腿 8）折算 39 金币；节点结束 | 通过：`body.indexOf('补发')<0`，`indexOf('首通奖励')<0` |
| A4 有位首通（10 件） | inv **10**，gold 846，Lv9，书 5，pending []，cleared [] | `true` | inv **11**，gold **1020**，Lv10，exp 771，书 **7**，pending **[]**，cleared ['mine']，饰品包新增未拥有的 `blood_ring` | 本局收益 +174/+677；首通奖励 +800；技能书 +2（现有 7）；升级 Lv10；获得 史诗·秘银巨剑（主手 12） | 通过：固定紫装直接入包，gold 恰好 +174，pending 为空 |

A5 可读性（截图）：

- A1 面板正文 7 行，全部可见，无裁切；「已记账」提示位于第 4 行，字号 17 / 行高 26，清晰可读。
- A2 面板正文 8 行，全部可见；「补发首通固定装备」位于第 4 行，清晰可读。
- 结算正文 Label 为 `overflow: NONE`（`GameUIKit.createLabel` 默认），无遮罩裁切；实测 8–9 行仍完整显示。A4 正文 9 行（3 行头 + 4 行收益 + 1 行掉落 + 可成长）也在框外继续渲染、未被切掉。
- 但 A1 的折算金币行确实被 `setRewardLines` 的 4 行上限丢弃（见 N64）。

### B. 结算顺序回归

- 首通饰品：A4 在已拥有 `thorn_crown` / `greed_eye` 的情况下，首通仍给出本副本未拥有的 `blood_ring`（首通必给未拥有件）。
- 重复 25%：A2（非首通）饰品包新增 `greed_eye`；A1b/A3 未触发。符合重复通关 25%。
- 技能书：首通 +2（通关 1 + 首通 1），重复 +1；A1 书 2、A1b 3、A2 4、A3 5、A4 7，逐场自洽。
- 节点 done：A1 后 `exp.done=[9]`、`pos=9`；A4 后仍 `done=[9]`、`complete=false`。
- 金币：A2 420→633 = +213（174 + 39 折算，面板两行可见）；A3 633→846 = +213（同上）；A4 846→1020 = +174（无折算），均与面板一致。仅 A1 的 +215 = 174 + 41 中 41 未显示（N64）。
- 经验：A4 首通 677 + 800，Lv9→Lv10、余 771，面板「首通奖励 +800 / 升级 Lv10」自洽；A1b/A2/A3 无首通奖励行。

### C. 前几轮修复点抽查

- **N61**：成长面板 →「技能」页，右上角按钮文案 `变体重置（需训练场 Lv1）`，按钮宽 250、Label 内容宽 238，截图确认**单行不折行**。
- **N62**：清空饰品后打开「角色 → 饰品」，空态文案 `还没有饰品 —— 副本 BOSS 首通必掉一件本副本未拥有的` 在整棵面板树中只出现 **1 次**，计数 `已拥有饰品 0/20`。
- **N63**：装备页真实点击空「头」槽，玩家侧反馈 `头 · 空槽位` + `该槽位为空，可从背包选一件同槽位装备穿上。`，非「点了没反应」。

### D. 本轮新探索（部分）

- **D3 营地 / 悬赏**：真实点击路线图「营地」打开成功；5 个设施页签（铁匠铺 / 附魔台 / 训练场 / 厨房 / 军需官）逐个真实点击均切换成功；把军需官临时设为 Lv2 后悬赏板渲染 `悬赏板 0/6 条 · 自动追踪，完成即可领取 · Lv4 起每日刷新` 与空态说明；点「返回」关闭后 `_campRef.isOpen()=false`、路线图恢复，无卡死。
- **D1 余烬叠层**：法师 + 橡木法杖（`modifier='ember_stack'`）进战斗，受控 `core.step` 连放火球，观察到燃烧 DoT `3.51 → 7.02`（基础 3.51 = AP 11.69 × 0.3，叠到 2 层）。第 3 层因探针里刷怪波次替换目标未能稳定复现，未判缺陷（见 §4）。

## 3. 方法与注入存档

- **坐标标定**：视口设为 720×1280、dpr=1；canvas 720×1280，设计分辨率也是 720×1280。真实点击空头槽时，节点 `worldPosition=(444,892)` → 点击 `(444, 1280-892=388)` 成功选中 `head`，**k=1**（CSS 像素 = 设备像素）。本报告所有点击均按此换算。
- **注入方式**：`page.addInitScript` 在每次导航前写 `localStorage['tiny_games_mithril_save']`，再 `page.goto`，然后页内 `cc.director.loadScene('Mithril')` 并等待 5s。initScript 每次导航重放，符合预期。
- **基础存档模板**（A1）：
```json
{
  "v":2,"classId":"warrior","level":1,"exp":0,"gold":0,"materials":{},
  "equips":{"mainHand":null,"offHand":null,"head":null,"chest":null,"hands":null,"legs":null,"feet":null,"ring":null},
  "inventory":[{"uid":"probe-0","baseId":"mainHand_0","slot":"mainHand","ilvl":10,"quality":"common","affixes":[]}],
  "trinkets":[null,null],"trinketBag":[],"talents":{},"skills":{},"variants":{},
  "skillBooks":0,"dungeonsCleared":[],"pendingFirstClear":[],"regionsCleared":[],
  "expedition":{"regionId":"ash","seed":1,"supply":8,"hp":400,"pos":9,"visited":[0,9],"done":[],"runMaterials":{},"complete":false},
  "bounties":[],"bountyProgress":{},"bountyDay":0,"bountyCursor":0,
  "facilities":{"smith":0,"enchant":0,"training":0,"kitchen":0,"quartermaster":0},
  "meals":[],"talentPresets":[]
}
```
  实际 inventory 填 60 件（8 槽轮转、`baseId='<slot>_0'`、common/ilvl10）。注意 `supply:8 / hp:400` 被读档净化夹到本局上限 `supply=3 / hp=60`（正常规则，不是缺陷）。
- **战斗捷径**：`comp.onWildNodeTap(9)`（pos=9 为 resume，不扣补给）→ `comp.debugGotoBoss()` 同步清小怪 → 循环 `comp.debugKillAll()` + 30ms 等待直到 `comp._settled`（实测 1 轮即结算）。**这些捷径均在本文中明示，非正常玩家操作。**
- **重复通关**：直接重置 `comp._save.expedition = {regionId:'ash',seed:1,supply:3,hp:150,pos:9,visited:[0,9],done:[],runMaterials:{},complete:false}`，调用 `comp._enterMapMode()`，再 `onWildNodeTap(9)`；A2 用 `inventory.pop()` 腾出 1 格。
- **D1**：临时 `comp._mode='map'` 冻结引擎 update，手动 `core.step(1/60, {aimX,aimY,skill1:true})`；为观察叠层把目标 `hp` 与玩家 `hp/rage` 设为高值并固定玩家在目标左侧 200px（仅探针手段）。
- **真实点击**：营地、5 个设施页签、装备空槽、返回、结算「返回路线图」均用 `page.mouse.click`（k=1）。

## 4. 排除的疑似问题

- **注入的 supply 8 / hp 400 变成 3 / 60**：`sanitizeExpedition` 按 `SUPPLY_PER_RUN` 与当前 profile 上限夹取，属正常读档规则，不是存档损坏。
- **A2 补发轮又拿到一件饰品 `greed_eye`**：该轮 `_firstClear=false`，走重复通关 25% 掉落，不是首通饰品重复发放。
- **A1 金币 0→215 与面板 +174 不一致**：折算 41 金实际入账，只是提示被 4 行上限挤掉；「已记账」提示本身可见。已单列 N64（P3），不另算数值错误。
- **结算正文 9 行会超出 224px 配置高度**：`createLabel` 默认 `overflow: NONE`，无遮罩裁切，实测 9 行仍完整显示；未判缺陷。
- **A1/A2/A3 的「本局收益 +174/+677」完全相同**：同种子（seed 1）确定性结算，属预期。
- **首通 Lv1→Lv6**：首通 800 + 战斗 677 经验，属设计值。
- **favicon.ico 404**：已知非缺陷，控制台仅此一条错误。
- **D1 第 3 层余烬没测到**：探针里战斗波次会替换/新增目标，固定单个目标的观测不稳定；已确认 1→2 层叠层与单调不降逻辑，未把「没测到 3 层」当缺陷。

## 5. 复现配方

1. 起服务（本轮直接复用）：`python3 -m http.server 8127 --bind 127.0.0.1 --directory build/web-mobile`。
2. 浏览器设 720×1280、dpr=1，打开 `http://127.0.0.1:8127/index.html`。
3. `addInitScript` 写入 §3 的 60 件满包存档；`goto` 后页内 `cc.director.loadScene('Mithril')`，等 5s。
4. `comp.onWildNodeTap(9)` → `comp.debugGotoBoss()` → 循环 `debugKillAll()` 至 `_settled`。
5. 读 `comp._save.gold`（应为 215）与 `comp._hudRef._rewardLines`（4 行，无折算行）→ 复现 N64。
6. 重置 expedition 并重复步骤 4：验证不再发首通（书 +1、pending 保留）。
7. `inventory.pop()` 后再重复：验证补发固定紫装（`mainHand_0` ilvl12）、pending 清空、出现「补发」行。
8. 再重复一次：验证无「补发」/「首通奖励」。
9. 另起存档：inventory 10 件、`dungeonsCleared=[]`、`pendingFirstClear=[]`，首通验证固定紫装直接入包且 pending 为空。

## 6. 结束状态

- 浏览器已 `browser_close` 关闭。
- 服务端口：8127 仍为本轮开始时的 `python3 -m http.server` 进程，未启停；未启动 8128。
- 仓库文件：仅新增本报告（`docs/plans/2026-11-16-playtest-round22-mithril-p25.md`）；未改任何 `.ts` / 场景 / 构建产物。工作区原有的 3 个 modified 文件（`MithrilGame.ts`、`MithrilProgress.ts`、`tools/verify-mithril-core.js`）是开发者本轮改动，试玩未触碰。
- 截图（`.playwright-mcp/`）：
  - `r22-pt-a1-fullbag-firstclear.png`（A1 满包首通结算）
  - `r22-pt-a2-backfill.png`（A2 补发结算）
  - `r22-pt-c1-growth-skill-tab.png`（N61 技能页单行）
  - `r22-pt-c2-trinket-empty.png`（N62 空态单段）
  - `r22-pt-c3-empty-slot.png`（N63 空槽位反馈）
  - `r22-pt-d3-camp-bounty.png`（营地军需官/悬赏板）

## 7. 开发者修复记录

本轮改动集中在「首通记账」这条线上，共三处，均在本轮试玩前/后当场验证：

| # | 问题 | 改法 | 文件 |
|---|------|------|------|
| 1 | P2-5：满包首通时 `dungeonsCleared` 不落库，首通经验 / 技能书 / 饰品可反复领 | 新增 `pendingFirstClear` 欠账队列；`_settle` 里「记账」与「物品入包」解耦 —— 首通永远只发一次奖励，装备没进包就记账；新增纯函数 `markDungeonCleared` / `queuePendingFirstClear` / `takePendingFirstClear` 与 `parseSave` 净化 | `MithrilProgress.ts`、`MithrilGame.ts` |
| 2 | （开发自测发现）补发判定排在 `bossLoot` 之后：玩家只腾出 1 格时随机紫装先占掉最后一格，欠账永远补不出去 | 把「偿还欠账」分支提到 `bossLoot` 之前，固定紫装优先于本局随机掉落；没配置固定掉落时清账避免永久挂账 | `MithrilGame.ts` |
| 3 | N64（本轮 P3）：折算金币的具体金额被结算面板 4 行收益上限挤掉，玩家对不上金币差额 | 金额并入靠前的记账提示：`首通紫装：满包折 N 金币，已记账（下次通关补发）`，`N` 与 `_grantItem` 折叠同用 `sellPrice(item)` 口径 | `MithrilGame.ts` |

验证：

- 新增断言 **241–244**（首通记账幂等、欠账入队去重 / 补发清账、`pendingFirstClear` 净化、旧档缺字段不重置其它字段），`node tools/verify-mithril-core.js` → `MITHRIL_CORE_OK 244/244`。
- 编辑器自带 `tsc --noEmit` → 通过；CLI 重建 `build/web-mobile`（26 场景 / 73 uuid，无 importer 报错，`.meta` 干净），产物含 `首通紫装` / `pendingFirstClear`。
- 开发侧三阶段探针（满包首通 → 腾格补发 → 第三次通关）与常规入包路径均符合预期，证据 `.playwright-mcp/r22-dev-01-fullbag-result.png`、`r22-dev-02-n64-fixed.png`；N64 修复后 `gold 1000→1215`，面板第 2 行可见「满包折 41 金币」，与差额 174+41 对得上。

## 8. 独立复核（第 22 轮）

- 复核者：独立子代理（非开发者）。只使用构建产物 `build/web-mobile`、代码 diff 与自建探针，**未采信**试玩报告与开发者结论。
- 产物核对：`build/web-mobile` mtime 11-16 22:54，`assets/main/index.js` 同时含 `首通紫装` 与 `pendingFirstClear` 字符串，确认运行的是修复后产物（非旧包）。

### 8.1 结论行

- **N64：CONFIRMED CLOSED**
- **P2-5 五场景：A1 PASS / A1b PASS / A2 PASS / A3 PASS / A4 PASS（5/5）**
- **回归：全绿**（重复通关饰品 25%、技能书 +1、节点 done、满包折金币提示、结算面板不溢出、按钮真实可点；N61/N62/N63 抽查均通过）
- **新发现：0 条**（N65 起无）
- 自检：`node tools/verify-mithril-core.js` → `MITHRIL_CORE_OK 244/244`（含新增 241–244）；编辑器自带 `tsc --noEmit` → exit 0。

### 8.2 检查项与证据

| 检查项 | 结果 | 证据（探针读数 / 截图） |
|--------|------|--------------------------|
| N64 折算金额在面板可见 | PASS | 结算正文第 2 行：`首通紫装：满包折 41 金币，已记账（下次通关补发）`；`r22-rev-a1-fullbag-firstclear.png` |
| N64 金额与金币增量自洽 | PASS | `gold 0→215`，delta **215** = 本局收益 **174** + 折算 **41**；`pending=['mine']`、`cleared=['mine']` |
| A1b 仍满包再通关不重复发首通 | PASS | `firstClear=false`；书 2→3（仅 +1）；无「首通奖励」；pending 仍 `['mine']`；delta 205 = 174+31 |
| A2 腾 1 格优先补发固定紫装 | PASS | inv 59→60，袋内新增 `first_mine_*` / `mainHand_0` / ilvl 12 / epic；pending 清空；正文第 2 行「补发首通固定装备（上次首通时背包已满）」；随机件才折 58 金，delta 232 = 174+58；`r22-rev-a2-backfill.png` |
| A3 补发后第三次不再补发 | PASS | 无「补发」/「首通奖励」；pending `[]`；ilvl12 epic 数量 1→1；delta 205 = 174+31 |
| A4 有位首通直接入包 | PASS | inv 10→11，首通紫装（`first_mine_*`、mainHand、ilvl12、epic）直接在包内；pending `[]`；delta **174**（无折算）；书 +2（5→7）；首通经验 +800；Lv9→10 |
| 旧档兼容（缺 `pendingFirstClear`） | PASS | 注入不含该字段的 v2 档：内存 pending 为 `[]`，level 5 / gold 500 / books 4 / `dungeonsCleared=['mine']` 全部保留，无重置 |
| 重复通关饰品 25% | PASS | 连续 8 次重复通关新增 2 件（`greed_eye`、`thorn_crown`，2/8）；池空后正文「本副本饰品已集齐：金币 +66」 |
| 技能书 +1 / 节点 done | PASS | 8 次重复每次书 +1（7→15）；每轮 `done=[9]`、`pos=9` |
| 满包折金币提示 | PASS | `背包已满：史诗·… 折算 31 金币`、`…折算 58 金币` 等行正常出现 |
| 结算面板不溢出 / 按钮可点 | PASS | 正文 9 行（`overflow NONE`）完整显示、无裁切；真实点击「返回路线图」「装备」「成长」「饰品页签」均生效（mode 回 `map`、面板打开、页签切换） |
| N61 变体重置文案 | PASS | 技能页按钮 label 宽 238 < 按钮 250，截图单行「变体重置（需训练场 Lv1）」；`r22-rev-c1-growth-skill.png` |
| N62 饰品空态去重 | PASS | 清空饰品后整棵场景树中「还没有饰品…」计数 **= 1**，计数标签 `已拥有饰品 0/20`；`r22-rev-c2-trinket-empty.png` |
| N63 空槽位反馈 | PASS | 真实点击空「头」槽 → `头 · 空槽位` + `该槽位为空，可从背包选一件同槽位装备穿上。`；`r22-rev-c3-empty-slot.png` |
| 自检脚本 / tsc | PASS | 244/244，exit 0；`TSC_EXIT=0` |

### 8.3 新发现

**0 条。** 本轮未发现需要编号的新问题。

### 8.4 代码审查（diff）

- **金额口径一致**：`_grantItem` 在满包时用 `sellPrice(item)` 折金并返回 `''`（`MithrilGame.ts:831-834`）；N64 提示复用同一 `sellPrice(item)`，且 `item` 在 `_grantItem` 内不被改质，二者同口径。实测 41 = 面板 41 = gold 增量差。
- **记账与入包解耦**：`markDungeonCleared` 在 `firstClear` 时无条件记账（`MithrilGame.ts:979-980`），满包也记；`_firstClear` 由进节点时的 `dungeonsCleared` 计算（`:746`），所以下一轮必为 `false`。旧实现「满包 → 不记账 → 可无限刷首通经验/技能书/保底饰品」的洞已堵（A1→A1b 实测 `firstClear=false`）。
- **不重复发 / 不丢账**：`queuePendingFirstClear` 去重、`takePendingFirstClear` 仅在补发真正入包（`_grantItem` 返回非空）后调用；`!firstClear` 补发分支与 `firstClear` 发放分支互斥，不存在同轮双发。补发分支排在 `bossLoot` 之前，保证「只腾 1 格」时欠账先落地、随机件才折金（A2 实测）。
- **旧档兼容**：`defaultSave` 补 `[]`，`sanitizeSave` 对非数组回落空、逐条丢弃非字符串/空串/重复（`MithrilProgress.ts:876-885`）；实测真实构建加载旧档不重置其它字段。
- **RNG 顺序**：补发分支额外消耗 `firstClearDrop` + `maybeLowerQuality` 的随机数，只在「有欠账」的存档发生；同存档同种子仍可复现（同一注入档两次首通均得到同一饰品 `blood_ring`），不构成可复现性缺陷。
- **覆盖缺口（非缺陷）**：`tools/verify-mithril-core.js` 241–244 只覆盖纯函数与存档净化，未覆盖 `_settle` 整段分支；该整合路径由本轮探针场景覆盖。

**复核差异说明（不判缺陷）**：报告 §2 的 A1 首通饰品为 `thorn_crown`、A4 余经验 771；我用报告同款模板独立注入得到 `blood_ring`、A4 余经验 506。A4 差异可由起始 exp 不同解释；A1 饰品差异说明报告个别 RNG 派生值不可跨构建/注入复现，但不影响任何不变量（首通仍必给一件未拥有饰品，金币/经验/技能书逐项自洽）。复核以本轮探针读数为准。

### 8.5 方法与坐标标定（照实记录）

- 视口 720×1280，`dpr=1`；canvas 720×1280，`getBoundingClientRect` = (0,0,720,1280)。
- **k=1 现场标定**：结算「返回路线图」按钮 `worldPosition=(183,450)` → 点击设备像素 `(183, 830)`（换算 `deviceX=wx, deviceY=1280-wy`），面板关闭、`_mode='map'`；空「头」槽 `world=(444,892)` → 点击 `(444,388)` 成功选中 `head`。两次均命中，确认本轮 **k=1**。
- **注入**：`page.addInitScript` 写 `localStorage['tiny_games_mithril_save']`，`goto` 后在页内 `cc.director.loadScene('Mithril')` 等 5s。满包模板 60 件：`{uid:'probe-N', baseId:'<slot>_0', slot:<8 槽轮转>, ilvl:10, quality:'common', affixes:[]}`；远征 `{regionId:'ash',seed:1,supply:10,hp:400,pos:9,visited:[0,9],done:[],runMaterials:{},complete:false}`（读档净化夹到 `supply=3 / hp=60`，属正常规则）。
- **debug 捷径（非正常玩家操作，特此声明）**：`comp.onWildNodeTap(9)` → `comp.debugGotoBoss()` → 循环 `comp.debugKillAll()`（约 1 轮即 `_settled`）。重复通关：直接重置 `comp._save.expedition` → `comp._enterMapMode()` → `onWildNodeTap(9)`。腾格：`comp._save.inventory.pop()`。N62 空态：探针置 `trinketBag=[]`、`trinkets=[null,null]`。
- **截图**：`.playwright-mcp/r22-rev-a1-fullbag-firstclear.png`、`r22-rev-a2-backfill.png`、`r22-rev-c1-growth-skill.png`、`r22-rev-c2-trinket-empty.png`、`r22-rev-c3-empty-slot.png`。
- **控制台**：最终导航后 `error=0`（仅已知 favicon 资源无关项，未出现脚本异常）。

复核者声明：本轮结论仅基于构建产物 build/web-mobile 与代码 diff。
