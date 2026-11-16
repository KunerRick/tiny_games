# 《秘银远征》第 21 轮试玩报告（M12 · 改造词条 / 菜单 / 排版 / 品质与核心循环）

> 日期：2026-11-16 · 游戏：`mithril` · 场景：`Mithril`
> 试玩者：fresh 子代理（独立试玩者，非开发者）。未修改任何 `.ts` / 场景 / 预制体；所有状态变化只经由游戏自身 UI（大厅卡、职业卡、路线图、技能键、装备面板按钮）。
> 范围：**已构建的 web 产物**（`build/web-mobile`，`http://127.0.0.1:8127/index.html`），非编辑器预览。上一轮报告 `docs/plans/2026-11-16-playtest-round20-mithril-m11.md` 只当待验证清单。

## 0. 结论

**P0 = 0 · P1 = 0 · P2 = 1 · P3 = 2。**

本轮重点的 4 条改造词条里，**3 条被真实触发并记录到探针读数**（回响、荆棘、裂魂），余烬/贪食未能在本轮自然触发（见 §4）。装备/背包/成长/营地菜单全部可开、可翻页、可穿脱出售，数值与背包同步刷新；属性面板三行、传说/秘境 7 行详情无重叠；六档品质与 15 个手工基型全部显示正常、无空值；核心循环（新档职业选择 → 开局 → 战斗 → 节点肃清 → 路线图 → 大厅 → 其它游戏）完整。发现的 3 条均为排版/反馈细节，不阻塞主流程。

## 1. 问题清单（机读区）

| ID | 级别 | 游戏 | 场景/入口 | 现象 | 复现步骤 | 期望 | 证据 |
|----|------|------|-----------|------|----------|------|------|
| N61 | P2 | mithril | `Mithril` 路线图 → 成长 → 技能 tab | 右上角按钮文案「变体重置（需训练场 Lv1）」被挤成两行，第二行只剩一个「）」，且紧贴面板右缘（bbox 左 490 / 右 678，面板右缘约 700） | 打开成长 → 点「技能」页签，看右上角 | 单行显示（缩短文案、缩小字号或加宽按钮），不出现孤立标点 | 截图 `.playwright-mcp/r21-13-growth-skill-recheck.png`；探针 bbox `{left:490,right:678,top:303,bottom:345,w:188,h:42}`（单行高约 26，42 即两行） |
| N62 | P3 | mithril | `Mithril` → 装备 → 饰品 tab（空状态） | 同一句协同说明重复出现两次：中部空态小字「…同时装备会点亮协同（共 12 条）。」与底部固定提示「协同：两件不同 tag 的饰品同时装备可点亮（共 12 条）」 | 装备 → 饰品（0 件时） | 只保留一处协同说明；空态区域可上移或补占位，避免中部大留白 | 截图 `.playwright-mcp/r21-08b-trinket-view.png`；探针同时读到两条含「协同」「12 条」的 Label |
| N63 | P3 | mithril | `Mithril` → 装备 → 装备 tab（空槽） | 点击空的装备槽（如「主手 空」）后详情区仍是占位文案「点击上方装备槽或背包物品查看详情」，无「该槽位为空」或任何选中反馈，且无操作按钮 | 卸下主手 → 点击「主手 空」 | 详情区提示「该槽位为空，可从背包选择装备」或至少高亮该槽 | 截图 `.playwright-mcp/r21-24-empty-slot-tap.png`；探针：`slot="主手 空"`、`detail="点击上方装备槽或背包物品查看详情"`、`buttons=[]` |

> 编号连续：上一轮未占用 N61 及以后，本轮使用 N61–N63，无重号。

## 2. 覆盖清单与探针读数

### 2.1 改造词条（5 条中真实触发 3 条）

装备来源：注入的合法存档（§3.1）中 8 件已装备物品，实测改造分布为 `echo_cd`×1（头）、`thorn_armor`×2（副手/胸）、`soul_split`×3（主手/手/脚）、`gluttony`×1（戒指）；`legs` 无改造。三条目标词条均处于激活状态。

| 词条 | 游戏内文案（探针逐字读回） | 触发方式 | 读数 |
|---|---|---|---|
| 回响 `echo_cd` | 「每第 3 次施放同一技能，冷却减半」 | 战斗中按住普攻（`Skill_basic`），第 3/6/9 次施放 | 施放后 90 ms 采样 `_core.player.cd.basic`：普通次 **0.433 s**；第 3 的倍数次 **0.183 s**（+90 ms 采样偏移折算约 0.523 → 0.273，约减半）；`_castCounts` 与命中次数同步递增；#9=0.183、#10=0.433 复现 |
| 荆棘 `thorn_armor` | 「受到近战伤害时反弹 30%，但最大生命 -10%」 | 站桩 1.2 s 不输入，让矿道幽魂贴身近战 | 玩家 HP **−4.6**，全部敌人 HP 合计 **−1.38**，比值 **1.38 / 4.6 = 0.300**（精确 30%）；同时最大生命从基础值被压到 `1027.8`（-10% 生效） |
| 裂魂 `soul_split` | 「暴击时有 20% 概率重置闪避冷却」 | 先「闪」进入 4.7 s 冷却，再「旋」+普攻打出暴击 | 实时 `_core.player.cd.dodge`：t=196.87 **4.717** → t=197.68 **3.900** → t=198.93 **2.650** → t=199.27 **0**。正常衰减约 0.33/0.34 s，按此应在 t≈201.7 才归零；在旋风斩连续命中 3 个敌人（含暴击）后的 0.34 s 内直接跳到 0，判定为重置触发 |
| 余烬 `ember_stack` | 「火球术变体 A 的持续伤害可以叠 3 层」 | 未触发 | 余烬装备只在背包（`mainHand_2`/`chest_5`），当前为战士，无火球术；本轮新开的法师档为 1 级空背包，未再注入装备。文案与 `MODIFIERS` 一致，行为未验证 |
| 贪食 `gluttony` | 「拾取掉落时 5% 概率额外掉一件（品质不高于当前）」 | 未触发 | 本轮仅肃清 1 个战斗节点，结算无掉落物品（金币/经验/灰烬），5% 无抽样机会；详情文案已逐字读回 |
| 秘境诅咒 | 「受到伤害 +15%（掉落装等 +3）」 | 文案/数值显示验证 | 戒指 `ring_0` 为 `mythic`，装等 **40**（同基型普通档 37，+3 生效）；详情最后一行显示诅咒原文；受到伤害 +15% 未做数值对照 |

**结论：词条 3/5 有真实行为证据；另 2 条未复现，原因已列。**

### 2.2 装备 / 背包 / 成长 / 营地菜单

底栏入口（路线图 CSS 坐标，均真实点击）：`营地 (272,1196)`、`成长 (382,1196)`、`装备 (492,1196)`、`返回大厅 (604,1196)`；`放弃远征` 会中断本程，本轮**未点**。

- **装备面板（8 槽全满）**：槽位 `主手 24 / 副手 22 / 头 30 / 胸 20 / 手 26 / 腿 18 / 脚 21 / 戒指 40`；三行属性逐字：`攻击强度 15.6　生命上限 1028` / `暴击 30.0%　急速 20.0%　精通 20.0%　全能 10.0%` / `平均装等 25.1　已装备 8/8　耐力 +101（生命 +1010）`；金币 171。
- **翻页**：背包 `1 / 2（7）` → 点「下一页」→ `2 / 2（7）`，第二页唯一一条为 `普通·巨魔战靴 · 脚 · 16 ◆`；点「上一页」回到 `1 / 2（7）`，行内容与金币不变。
- **穿上**：选 `史诗·橡木法杖（主手 25）` → 穿上后 `主手 25`，被替换的 `霜晶魔杖 24` 自动回到背包；`生命上限 1028→1037`、`耐力 +101→+102`、`平均装等 25.1→25.3`、`已装备 8/8`，金币不变。
- **卸下**：选主手槽 → 卸下后 `主手 空`、`已装备 7/8`、`生命上限 1037→920`、`耐力 +102→+89`、背包 `1 / 2（8）`；重新穿上连弩后恢复 `主手 24 / 8/8 / 生命上限 1028`。
- **出售**：选 `优秀·巨魔骨盔（头 19）` → 按钮显示 `出售 29` → 点击后金币 `171→200`，背包 `1 / 2（7）→ 1 / 1（6）`，属性行不变（未穿戴，符合预期）。
- **成长·天赋**：`天赋点：可用 5 · 已投 0/5 · 金币 171`；三条天赋线 × 5 层全部有名称/等级/效果/门槛（如「本线需 10 点」）；底部三行属性与「洗点（营地训练场 Lv1 解锁）」单行完整；提示行完整。
- **成长·技能**：6 个技能（劈砍/冲锋/旋风斩/破甲/侧步/血怒）均为 Lv1、变体未选；详情 9 行逐字可读（基础 90° 扇形、110% 攻击、积 8 怒气、2 级/4 级变体与技能书规则）；仅右上角文案换行问题 N61。
- **饰品**：`槽 1 · 空`、`槽 2 · 空`、`已拥有饰品 0/20`、`1 / 1`、空态说明与协同说明；重复提示见 N62。
- **营地**：铁匠铺/附魔台/训练场/厨房/军需官四项设施齐全；`金币 200 · 灰烬 1 · 霜晶 0 · 秘银 0`；装备（含身上）列表带「（穿）」标记；词条锁定列表与「升到 Lv2 才能锁定词条 / 重铸费用 184 金」；`升级到 Lv1（灰烬 ×4）` 按钮存在（当前灰烬 1，未点）。文本无截断/重叠。

### 2.3 属性面板与装备详情排版

- 三行属性块：`bbox {w:470,h:98}`，三行分别 34/34/30 px，无换行、无截断（截图 `r21-20-gear-page1.png`）。
- **最坏 7 行详情**（传说·深渊长袍：4 条词条 + 耐力 + 改造「余烬」 + 传说特效）：标题 y=902，正文 `top 935 / bottom 1123`（7 行，行高 26），按钮 `top 1126`；bbox 间隙仅 3 px，但实拍无重叠、无裁切，末行「传说特效：必带一条改造词条（规则改写）」完整可见（`r21-09-legendary-detail.png`）。
- **秘境 7 行详情**（力量之戒）：正文同样 7 行，末行「秘境诅咒：受到伤害 +15%（掉落装等 +3）」完整（`r21-10-mythic-detail.png`）。
- 长名称：`传说·深渊长袍`、`史诗·橡木法杖`、`力量之戒（秘境 · 戒指 · 装等 40）` 均单行完整，无省略号/越界。
- 空槽反馈问题见 N63。

### 2.4 品质与基型显示

八件已装备物品详情标题逐字读回，颜色取 `cc.Label.color`：

| 槽位 | 标题 | 品质色 |
|---|---|---|
| 主手 | 连弩（史诗 · 主手 · 装等 24） | `#A855F7` |
| 副手 | 塔盾（史诗 · 副手 · 装等 22） | `#A855F7` |
| 头 | 秘银王冠（传说 · 头 · 装等 30） | `#F59E0B` |
| 胸 | 鳞甲（优秀 · 胸 · 装等 20） | `#22C55E` |
| 手 | 秘银指套（史诗 · 手 · 装等 26） | `#A855F7` |
| 腿 | 深渊腿（普通 · 腿 · 装等 18） | `#9CA3AF` |
| 脚 | 秘银踏靴（稀有 · 脚 · 装等 21） | `#3B82F6` |
| 戒指 | 力量之戒（秘境 · 戒指 · 装等 40） | `#EF4444` |

- 六档品质全部出现且颜色与规范一致；背包行另有 `普通·巨魔战靴 · 脚 · 16 ◆`。
- **15 个手工基型全部出现**：连弩、塔盾、秘银王冠、鳞甲、秘银指套、深渊腿、秘银踏靴、力量之戒、深渊长袍、橡木法杖、霜晶魔杖、巨魔护手、灰烬之戒、巨魔骨盔、巨魔战靴。
- 无空字符串、无 `undefined`、无占位问号；有改造的物品行尾统一带 `◆`，无改造的 `深渊腿` 不带。

### 2.5 核心循环回归

- 大厅：`title = "Tiny Games 游戏大厅"`；`allGamesGrid` 25 张 + `recentGrid` 2 张（秘银远征/2048），共 27 个 `GameIcon`；最后一张为「秘银远征」，世界坐标 `(165,154)` → CSS `(165,1126)`。
- **新档职业选择**（独立 incognito 上下文，`localStorage` 为空，不触碰主存档）：4 个职业卡（战士/法师/游侠/牧师）均显示定位、资源、6 技能清单；默认战士「已选中」；真实点击「法师」后变为法师「已选中」，底部「已选择：法师（远程 · 法术）· 职业在开档后不能更改」，按钮变「以法师开局」；点击后进入 `WildMap`，`生命 60/60`、`补给 3/3`、`灰烬 ×0`（Lv1 新档正常）。
- **旧档续玩**：重载 → 大厅 → 秘银卡 → 直接进入路线图，`生命 652/1028`、`补给 2/3`、`灰烬 ×1（本程 1）`，节点进度保留。
- **战斗**：真实按住技能键；冲锋 `60.7→33.4`（27.3 伤害）并跨越 220 px，随后普攻击杀；清场后出现「节点肃清」结算：`用时 8:23　击杀 12`、`金币 +38　经验 +184`、`灰烬 +1（本程 1）`、`可成长：天赋点 5`，四个按钮「返回路线图 / 成长 / 装备 / 返回大厅」。
- 返回路线图：`远征进行中：已清理 1/12 个节点`，`生命 652/1028`、`补给 2/3`。
- 返回大厅：`Lobby` 27 图标（25+2 最近），点击 2048 卡 → `Game2048`，棋盘与「分数 0 / 最高分 0」正常。
- 死亡结算本轮未重跑（上一轮已覆盖且本轮未改动相关逻辑）；本轮覆盖的是**胜利结算**路径。

## 3. 方法与数据说明

- **视口 / dpr**：`browser_resize` 720 × 1280；`window.innerWidth/Height = 720/1280`，`devicePixelRatio = 1`；canvas CSS rect `{left:0, top:0, w:720, h:1280}`，绘制缓冲同尺寸。
- **坐标换算（本轮现场标定）**：在 `Canvas` 上挂一次性 `TOUCH_START` 只读探针，比较 `getUILocation()` 与事件 `clientX/Y`，得 **`cssX = uiX`、`cssY = 1280 − uiY`、`k = 1`**；随后用大厅卡 `(165,1126)` 真实点击进入 `Mithril` 复核成立。所有技能/按钮坐标均按此换算，并用节点 `worldPosition`/`getBoundingBoxToWorld()` 现场定位，未沿用旧轮公式。
- **输入方式**：`browser_click` 不接受裸坐标，统一用 `browser_run_code_unsafe` 内的 `page.mouse.move/down/wait/up`；桌面技能键必须按住约 350 ms（HUD 按帧轮询 held），本轮全部施法均用按住。
- **存档注入（唯一一次状态注入，按任务书允许的例外）**：自然档为 Lv1 空背包，20 分钟内无法到达中后期装备面板，故注入一份**符合 `sanitizeSave` 的合法 v2 存档**，在 app 启动前用 `page.addInitScript` 写入 `localStorage['tiny_games_mithril_save']`，并用一次性 `sessionStorage['r21_inj']` 防重复。注入原文（逐字）：

```json
{"v":2,"classId":"warrior","level":5,"exp":0,"gold":0,"materials":{},"equips":{"mainHand":{"uid":"inj-mh3","baseId":"mainHand_3","slot":"mainHand","ilvl":24,"quality":"rare","affixes":[{"id":"crit","points":8},{"id":"haste","points":6}],"modifier":"echo_cd"},"offHand":{"uid":"inj-oh0","baseId":"offHand_0","slot":"offHand","ilvl":22,"quality":"epic","affixes":[{"id":"vers","points":8}],"modifier":"thorn_armor"},"head":{"uid":"inj-h5","baseId":"head_5","slot":"head","ilvl":30,"quality":"legendary","affixes":[{"id":"crit","points":8},{"id":"haste","points":7},{"id":"mastery","points":7},{"id":"vers","points":6}],"modifier":"echo_cd"},"chest":{"uid":"inj-c4","baseId":"chest_4","slot":"chest","ilvl":20,"quality":"uncommon","affixes":[{"id":"mastery","points":5}],"modifier":"thorn_armor"},"hands":{"uid":"inj-ha5","baseId":"hands_5","slot":"hands","ilvl":26,"quality":"epic","affixes":[{"id":"crit","points":8}],"modifier":"soul_split"},"legs":{"uid":"inj-l5","baseId":"legs_5","slot":"legs","ilvl":18,"quality":"common","affixes":[{"id":"haste","points":4}]},"feet":{"uid":"inj-f5","baseId":"feet_5","slot":"feet","ilvl":21,"quality":"rare","affixes":[{"id":"crit","points":5},{"id":"vers","points":4}],"modifier":"soul_split"},"ring":{"uid":"inj-r0","baseId":"ring_0","slot":"ring","ilvl":40,"quality":"mythic","affixes":[{"id":"crit","points":10},{"id":"haste","points":8},{"id":"mastery","points":8},{"id":"vers","points":6}],"modifier":"gluttony"}},"inventory":[{"uid":"inv-1","baseId":"mainHand_2","slot":"mainHand","ilvl":25,"quality":"epic","affixes":[{"id":"mastery","points":7}],"modifier":"ember_stack"},{"uid":"inv-2","baseId":"ring_4","slot":"ring","ilvl":20,"quality":"rare","affixes":[{"id":"crit","points":6}],"modifier":"ember_stack"},{"uid":"inv-3","baseId":"chest_5","slot":"chest","ilvl":28,"quality":"legendary","affixes":[{"id":"crit","points":9},{"id":"haste","points":7},{"id":"mastery","points":7},{"id":"vers","points":5}],"modifier":"ember_stack"},{"uid":"inv-4","baseId":"ring_5","slot":"ring","ilvl":32,"quality":"mythic","affixes":[{"id":"crit","points":10},{"id":"haste","points":8},{"id":"mastery","points":8},{"id":"vers","points":6}],"modifier":"echo_cd"},{"uid":"inv-5","baseId":"mainHand_5","slot":"mainHand","ilvl":24,"quality":"epic","affixes":[{"id":"crit","points":8}],"modifier":"soul_split"},{"uid":"inv-6","baseId":"head_4","slot":"head","ilvl":19,"quality":"uncommon","affixes":[{"id":"vers","points":5}],"modifier":"thorn_armor"},{"uid":"inv-7","baseId":"feet_4","slot":"feet","ilvl":16,"quality":"common","affixes":[{"id":"haste","points":3}],"modifier":"gluttony"},{"uid":"inv-8","baseId":"hands_4","slot":"hands","ilvl":20,"quality":"rare","affixes":[{"id":"mastery","points":6}],"modifier":"gluttony"}],"trinkets":[null,null],"trinketBag":[],"talents":{},"skills":{"warrior_basic":1,"warrior_a1":1,"warrior_a2":1,"warrior_a3":1,"warrior_dodge":1,"warrior_burst":1},"variants":{},"skillBooks":0,"dungeonsCleared":[],"regionsCleared":[],"expedition":null,"bounties":[],"bountyProgress":{},"bountyDay":0,"bountyCursor":0,"facilities":{"smith":0,"enchant":0,"training":0,"kitchen":0,"quartermaster":0},"meals":[],"talentPresets":[null,null]}
```

- **注入后经由 UI 产生的合法变化（不隐藏缺陷）**：① 卖出 `inv-4`（秘境戒指），金币 0→133（早期读回）；② 击败节点结算 `金币 +38 / 经验 +184 / 灰烬 +1`，金币 133→171；③ 装备循环中试穿 `inv-1`（橡木法杖 25）再卸下、最终穿上 `inv-5`（连弩 24）：注入的 `inj-mh3`（霜晶魔杖 24）回到背包，`inv-1` 也留在背包；④ 卖出 `inv-6`（骨盔 29 金），金币 171→200、背包 7→6。其余操作（翻页、选中、穿/卸循环）只改选中或最终还原。
- **只读探针**：`node.worldPosition`、`UITransform.getBoundingBoxToWorld()`（通过字符串 `'cc.UITransform'`）、`cc.Label.string/color`、`node.activeInHierarchy`、`localStorage` 读取、`_core.player.cd`、`_core._castCounts`、`_core.enemies`、`_core.profile`。未调用 `debugKillAll` / `debugGotoBoss` / `debugSetPlayerPos` 等会改状态的调试方法。
- **新档回归的隔离**：职业选择两次都在新建的 incognito `browserContext` 中完成（进去前确认 `tiny_games_mithril_*` 键为空），关闭上下文即销毁，不影响主上下文存档。
- **Profiler**：仅 `cc.profiler.hideStats()` 隐藏内置 FPS 面板，未改游戏逻辑。

## 4. 未复现 / 已排除的疑点

1. **余烬（ember_stack）未触发**：战士无火球术；余烬装备均在背包。若要用行为验证，需要“法师 + 已装备余烬”的第二个注入档，本轮时间预算内未做。文案与描述一致，不算缺陷。
2. **贪食（gluttony）未触发**：5% 概率、本轮只有 1 次无掉落的节点结算，样本为 0。**未观察到反例**，不下结论。
3. **「矿道幽魂」反复拉开距离**：玩家靠近到约 60 px 时，幽魂会立刻回到约 220 px；战士普攻/旋风斩打不到，只能靠冲锋（220 px、27.3 伤害、约 6 s CD）逐次击杀。三次冲锋 + 一次普攻击杀第一只，再追击击杀第二只，节点可正常肃清（总用时 8:23 含大量探针/走位停顿）。判定为**远程敌人风筝设计 + 近战缺乏远程手段**，未列为缺陷；若后续要调平衡可关注。
4. **7 行详情与按钮“只差 3 px”**：bbox 间隙 3 px，但实拍文字末行与按钮之间仍有明显空白，无重叠/裁切（`r21-09`、`r21-10`），不报。
5. **结果面板 `生命 652/1027.8` 与属性面板 `生命上限 1028`**：一个是保留 1 位小数、一个是整数显示，同一数值的两种格式，非状态不同步。
6. **桌面单击技能不施法**：已知非缺陷（需按住跨帧），本轮所有施法均按住 350 ms，未再计入。
7. **favicon 404**：已知允许项，本轮出现 2 次。
8. **9 条 `getComponent: Type must be non-nil` 控制台错误**：全部由**我的探针**在早期误用 `getComponent(cc.UITransform)` 造成（该构建里 `cc.UITransform` 为 undefined），改用字符串 `'cc.UITransform'` 后不再出现；与游戏逻辑无关。

## 5. 复现配方（最小步骤）

1. `cd build/web-mobile && python3 -m http.server 8127`；浏览器 720×1280 打开 `http://127.0.0.1:8127/index.html`，等大厅；`cc.profiler.hideStats()`。
2. 大厅滚到底，点「秘银远征」卡 `(165,1126)`。
3. **新档线**：无存档时进入职业选择 → 点法师卡 → 点「以法师开局」→ 路线图（生命 60/60）。
4. **中后期线**：按 §3 的注入 JSON 用 `addInitScript` 写入存档并 reload → 点秘银卡 → 直接进路线图。
5. 点「开始远征」`(122,1196)` → 点第一个战斗节点 `(250,347)`（坐标以现场节点 bbox 为准）。
6. 靠近敌人后按住普攻 `(582,1172)` 350 ms；观察 `_core._castCounts` 与 `_core.player.cd.basic` 验证回响（每第 3 次约减半）。
7. 站桩 1.2 s，记录玩家与敌人 HP 变化验证荆棘（比值 0.300）。
8. 按「闪」`(670,988)` 后用「旋」+普攻打出暴击，轮询 `_core.player.cd.dodge` 验证裂魂（冷却中跳 0）。
9. 清场后「返回路线图」`(183,830)` → 「成长」`(382,1196)` / 「装备」`(492,1196)` / 「营地」`(272,1196)` 逐个打开；装备页翻到第 2 页、选物品穿上/卸下/出售。
10. 「返回大厅」`(604,1196)` → 点 2048 卡验证其它游戏。

## 6. 结束状态

| 项 | 值 |
|---|---|
| 最终场景 | `Mithril`（路线图，`CampMenu` 打开；`EquipMenu`/`GrowthMenu` 可正常开关） |
| 秘银存档 | `tiny_games_mithril_save` **2985 字节**；`v=2`、`classId=warrior`、`level 5 / exp 184 / gold 200`；`materials={ash_dust:1}`；`expedition={regionId:"ash", supply:2, hp:652, pos:1, visited:[0,1], done:[1], complete:false}` |
| 装备 | 8/8：`mainHand_5`(24,epic,soul_split)、`offHand_0`(22,epic,thorn)、`head_5`(30,legendary,echo)、`chest_4`(20,uncommon,thorn)、`hands_5`(26,epic,soul_split)、`legs_5`(18,common,-)、`feet_5`(21,rare,soul_split)、`ring_0`(40,mythic,gluttony) |
| 背包 / 饰品 | 6 件装备（含 `mainHand_3` 24 rare echo、`chest_5` 28 legendary ember、`ring_4` 20 rare ember、`feet_4` 16 common gluttony、`hands_4` 20 rare gluttony、`mainHand_2` 25 epic ember）；饰品 0 件 |
| 其它键 | `tiny_games_mithril_seen_tutorial = "1"`；`tiny_games_user_data` 含 recentGames（mithril/2048） |
| console | 会话累计 20 条消息、0 warning、**11 条 error 级**：2 条 favicon 404 + 9 条探针造成的 `getComponent` 非空错误；**0 条游戏逻辑错误** |
| 浏览器 | 已 `browser_close` |
| 8127 服务 | **保持运行**（任务要求不得 kill） |

**截图**：`.playwright-mcp/r21-01-route-map.png`、`r21-02-gear-empty.png`、`r21-03-growth-talent.png`、`r21-04-growth-skill.png`、`r21-05-gear-full.png`、`r21-06-detail-7lines.png`、`r21-07-victory.png`、`r21-08-trinket-tab.png`、`r21-08b-trinket-view.png`、`r21-09-legendary-detail.png`、`r21-10-mythic-detail.png`、`r21-12-growth-recheck.png`、`r21-13-growth-skill-recheck.png`、`r21-14-lobby-return.png`、`r21-15-2048.png`、`r21-16-fresh-classselect.png`、`r21-17-fresh-mage-selected.png`、`r21-18-fresh-mage-map.png`、`r21-19-resume-map.png`、`r21-20-gear-page1.png`、`r21-21-unequipped.png`、`r21-22-after-sell.png`、`r21-23-equipped-details.png`、`r21-24-empty-slot-tap.png`、`r21-25-camp-menu.png`。

## 7. 修复记录（开发者 · 主会话）

> 时间：2026-11-16 21:5x · 依据：本轮机读表 N61–N63。P0/P1 = 0，退出判据已满足；三条均为排版/反馈细节，一并修掉后交独立复核。

| ID | 改动 | 文件 | 验证 |
|----|------|------|------|
| N61 | 「变体重置（需训练场 Lv1）」按钮 `w 200 → 250`、`x 224 → 199`（右缘仍是 324，标签可用宽 188 → 238），文案保持完整 | `assets/games/game_mithril/scripts/MithrilGrowthMenu.ts` | 待复核者实机读 bbox |
| N62 | 饰品空态正文里重复的协同说明换成「击败副本首领可以获得」（协同说明只在底部提示保留一处） | `assets/games/game_mithril/scripts/MithrilMenu.ts` `_refreshTrinketDetail` | 待复核者读两条 Label |
| N63 | 点空装备槽时详情区显示「主手 · 空槽位 / 该槽位为空，可从背包选一件同槽位装备穿上。」，不再停在通用占位文案 | `assets/games/game_mithril/scripts/MithrilMenu.ts` `_refreshDetail` | 待复核者点击空槽 |

**自检**：

- `tsc --noEmit`（编辑器自带 5.8.2）→ `TS_OK`
- `node tools/verify-mithril-core.js` → `MITHRIL_CORE_OK 240/240`
- 重建 `web-mobile`（CLI + `configPath`，非沙箱）：28 s，`assets/main/config.json` = **26 场景 / 73 UUID**，`Can not find the importer` = **0**，`git status` 无 `.meta` 变更
- 产物字符串核对：`空槽位` / `击败副本首领可以获得` / `变体重置（需训练场 Lv1）` 均在新 `build/web-mobile/assets/main/index.js` 中

## 8. 独立复核（fresh 子代理）

> 复核者：fresh 子代理（只读工程 + 浏览器读回状态，**未改任何 `.ts` / 场景 / 预制体**）。
> 环境：`build/web-mobile` @ `http://127.0.0.1:8127`（21:52 产物，`assets/main/index.js` 1587065 字节，已 grep 到三条新文案、旧的重复协同句 0 次命中）。视口 720×1280，`dpr = 1`。
> 坐标现场标定：Canvas 挂一次性 `TOUCH_START` 探针，CSS `(700,1270)` → `getUILocation() = (700,10)` ⇒ **`cssX = uiX`、`cssY = 1280 − uiY`、k = 1`**。
> 存档：直接复用页面同源既有 `tiny_games_mithril_save`（复核开始 2985 字节，战士 Lv5 / 8 件装备 / 背包 6 件 / 饰品 0 件），**未注入新存档**。

**一行总结：P0 = 0 · P1 = 0 · P2 = 0 · P3 = 0（新增 0 条）；N61 / N62 / N63 三条全部关闭；回归 6/6 通过；console 仅 2 条 favicon 404，0 条游戏错误。**

### 8.1 N61 — 变体重置按钮换行

**结论：已修复。**

- 真实点击路径：大厅「秘银远征」卡（recent 行，世界 `(355,680)` → CSS `(355,600)`）→ 路线图 → 「成长」`(382,1196)` → 「技能」页签 `(448,280)`。
- `cc.Label.string` 逐字读回：**「变体重置（需训练场 Lv1）」**（14 字，与改动前文案一致，未被截短）。
- 按钮节点（`GrowthMenu/Growth/Panel/Content/Button`）`cc.UITransform.getBoundingBoxToWorld()` = `{x:434, y:933, w:250, h:46}` ⇒ **左缘 434 / 右缘 684**（改动前 w=200、左缘 490）。
- 内层 Label bbox = `{x:440, y:935, w:238, h:42}`，`lineHeight = 23`、`fontSize = 18`、`overflow = 2`（SHRINK）。**注意：h=42 是按钮内固定的文本容器高（按钮 h−4），不是行数证据** —— 原报告把它当两行判据其实不成立，唯一可靠判据是实拍。
- 实拍（`.playwright-mcp/r21-rev-01-growth-skill.png`）：**单行**，无孤立「）」，无换行残字。
- 左侧标签（技能页 `技能书 0 · 变体待选 0 · 金币 200`，面板局部 `x=−132 / w=380`）bbox = `{x:38, y:943, w:380, h:26}` ⇒ 右缘 **418**；与按钮左缘 434 相距 **16 px**，**未压到**。
- 面板右缘 = 700，按钮右缘 684 ⇒ 仍留 **16 px** 内边距，未贴边、未越界。

### 8.2 N62 — 饰品空态协同说明重复

**结论：已修复。**

- 真实点击：路线图「装备」`(492,1196)` → 「饰品」页签 `(424,162)`；页内**全部** Label 递归读回（含 `TrinketTab` 子树）。
- 含「协同」的 Label：**1 条**；含「12 条」的 Label：**1 条**；且是同一条 —— 底部固定提示 `协同：两件不同 tag 的饰品同时装备可点亮（共 12 条）`，bbox `{x:138, y:154, w:443, h:33}`。
- 中部空态正文逐字：`饰品只改规则、不加固定数值：\n击败副本首领可以获得。`，bbox `{x:241, y:278, w:238, h:63}`，`lineHeight = 28` ⇒ **正好 2 行**，无空行、无错位、无第三行溢出。
- 实拍（`.playwright-mcp/r21-rev-02-trinket-empty.png`）：上部「还没有饰品 —— 副本 BOSS 首通必掉一件本副本未拥有的」与底部协同提示各一处，中部不再出现第二句协同。

### 8.3 N63 — 空装备槽无反馈

**结论：已修复。**

- 前置：装备页选中「主手」`(108,388)` → 详情 `连弩（史诗 · 主手 · 装等 24）`、按钮 `穿上=false / 卸下=true / 出售=false`；点「卸下」`(360,1152)` → 槽位变 `主手 空`、生命上限 1028→920、已装备 8/8→7/8、背包 1/2（7）。卸下后选中被清空，详情回到通用占位（符合预期，不是 N63）。
- **点空槽** `(108,388)` 后探针读回：
  - `_detailTitle` = **`主手 · 空槽位`**（颜色 `#9ca3af`，次级灰）；
  - `_detailBody` = **`该槽位为空，可从背包选一件同槽位装备穿上。`**；
  - 三个操作按钮 `穿上 / 卸下 / 出售` **全部 `activeInHierarchy = false`**（不显示）。
- 实拍（`.playwright-mcp/r21-rev-03-empty-slot.png`）：详情区两行文案完整，底部无按钮。
- 未回归：随后点背包「史诗·橡木法杖 · 主手 · 25」→ 标题 `橡木法杖（史诗 · 主手 · 装等 25）`、正文 3 行（精通 / 耐力 / 改造「余烬」）、按钮 `穿上=true / 卸下=false / 出售 72=true`；点「穿上」→ 主手 25、生命上限 920→**1037**、已装备 **8/8**、平均装等 25.3、耐力 +102、背包 1/1（6，连弩自动回包）；再选连弩「穿上」→ 主手 24、生命上限 **1028**、8/8、平均装等 25.1、耐力 +101（回到复核前状态）。

### 8.4 回归检查表

| # | 项 | 结论 | 探针读数 |
|---|----|------|----------|
| ① | 成长「天赋」页 | **通过** | `天赋点：可用 5 · 已投 0/5 · 金币 200`；钢铁/狂怒/战术三线各 `0/25`、t1–t5 共 30 个 `TalentCell_*`；属性块三行 bbox `{w:470,h:98}`；`洗点（营地训练场 Lv1 解锁）` 单行 |
| ② | 装备页翻页 / 选中 / 穿 / 卸 / 出售 | **通过** | 翻页 `1 / 2（7）` → `2 / 2（7）`（唯一行 `普通·巨魔战靴 · 脚 · 16 ◆`）→ `1 / 2（7）`；卸下主手 1028→920、8/8→7/8、背包 7；穿上法杖 920→1037、8/8、25.3、+102；换回连弩 1037→1028、25.1、+101；出售 `出售 99` 按钮可点 → 金币 200→**299**、行数 6→5、未穿戴属性行不变 |
| ③ | 饰品页（空态 / 底部提示） | **通过** | `已拥有饰品 0/20`、`1 / 1`、协同提示仅 1 处；两格空槽点击无异常。本档 0 件饰品，**非空详情无法覆盖**（与原报告一致） |
| ④ | 核心循环冒烟 | **通过** | 事件节点 Wild_3 → 选项「搜刮物资」→ 结果「灰烬 +2（现有 3）」→「知道了」；战斗节点 Wild_6 → `_mode = combat`、`phase = playing`、3 敌人；按住「斩」350 ms → 敌人 HP `60→37`（全场合计 194→171）、`cd.basic 0→0.0667`、`phase` 仍 `playing`；退出后重进 → 路线图 `pos 6`、`supply 0/3`、`生命 652/1028`、`visited [0,1,3,6]`、`done [1,3]`，无报错 |
| ⑤ | 面板开关 | **通过** | 成长「返回」`(632,222)`、装备「返回」`(628,100)` 均正常回路线图；`GrowthMenu/Growth`、`EquipMenu/Menu` 关闭后 `active=false`，再开正常 |
| ⑥ | console | **通过** | 会话累计 5 条消息、0 warning、**2 条 error（均为 `favicon.ico` 404）**；**0 条游戏逻辑错误** |

**观察（非本次 diff、不计新问题）**：战斗中 HUD 左上角退出键 `(58,62)` 直接回**大厅**而非路线图；回路线图需重进「秘银远征」卡。该行为与本次三处改动无关，不计入 N 编号，仅记录供后续参考。

### 8.5 新问题（N64 起）

**无。** 未发现本次修复本身有问题或引入回归，N64 及以后编号未占用。

### 8.6 复核造成的状态变化（全部经由游戏 UI，已披露）

1. 事件节点 Wild_3 选「搜刮物资」：`materials.ash_dust 1 → 3`（+2），`done [1] → [1,3]`，`supply 2 → 1`。
2. 进入战斗节点 Wild_6（`supply 1 → 0`、`visited += 6`），按住普攻造成 23 点伤害后从 HUD 退出回大厅；`expedition.hp` 未变（652）。
3. 装备循环：卸下主手 → 穿上橡木法杖 → 换回连弩，**净变化为零**（8/8、生命上限 1028、平均装等 25.1）。
4. 为了测翻页卸下「脚」再穿回（净变化为零）；随后出售时因页码自动回到 `1/1`，实际卖出的是第一行 **`传说·深渊长袍（胸 28）`**，`gold 200 → 299`、背包 6 → 5（原计划卖的是 `普通·巨魔战靴`，未影响装备属性）。

### 8.7 结束状态

| 项 | 值 |
|---|---|
| 最终场景 | `Mithril`（路线图；`WildMap.active = true`，`HUD/Field.active = false`） |
| 秘银存档 | `tiny_games_mithril_save` **2768 字节**；`v=2`、`classId=warrior`、`level 5 / exp 184 / gold 299`；`materials={ash_dust:3}`；`expedition={regionId:"ash", supply:0, hp:652, pos:6, visited:[0,1,3,6], done:[1,3], complete:false}`；饰品 `[null,null]` |
| 装备 / 背包 | 8/8；背包 5 件：`mainHand_3`(24 rare echo)、`ring_4`(20 rare ember)、`feet_4`(16 common gluttony)、`hands_4`(20 rare gluttony)、`mainHand_2`(25 epic ember) |
| console | 5 条消息 / 0 warning / 2 error（favicon 404 ×2）/ **0 条游戏错误** |
| 浏览器 | 已 `browser_close` |
| 8127 服务 | 保持运行（未 kill） |

**复核截图**：`.playwright-mcp/r21-rev-01-growth-skill.png`、`r21-rev-02-trinket-empty.png`、`r21-rev-03-empty-slot.png`。
