# 《秘银远征》round43 UI 减密批 · 独立复核报告（fresh 复核者）

- 日期：2026-11-20
- 角色：独立复核者（非开发者自证；按 `docs/tech/playtest-cycle.md` §3.1 条件 3 派出）
- 复核对象：commit `0720147`（base `1bd5c73`），round43 UI 减密批 N209 / N210 / N212 / N214 / N215
- 结论速览：**N210 / N212 / N214 / N215 = CONFIRMED；N209 = PARTIAL**（宝箱 Toast 已修，但 `饕餮` 回血增量两处仍裸拼浮点 → 新开 **N216**）
- 未改动任何源码 / 场景 / 台账；仅新增本报告与 `r43rev-*` 截图

---

## 1. 复核范围与环境

### 1.1 commit 与改动面

`git diff --stat 1bd5c73 0720147`：4 个脚本 + 2 个台账/计划文档，共 378 insertions / 74 deletions。

| 文件 | 改动 |
|---|---|
| `assets/games/game_mithril/scripts/MithrilGame.ts` | +`hpText()`（:87），替换 11 处生命文案 |
| `.../MithrilGrowthMenu.ts` | 技能页未解锁折叠、详情收敛、字号收敛 |
| `.../MithrilCampPanel.ts` | 厨房缺料按钮收敛、设施页头/提示/规则收敛 |
| `.../MithrilWildMap.ts` | 图例 8→5 单行、页脚去掉常驻补给警告 |

### 1.2 预览与代码加载验证

- 预览：`http://127.0.0.1:7456/`（`lsof` 确认 CocosCreator PID 32550 监听）。
- 首次操作前：MCP `project_refresh_assets`（success）→ 整页 `navigate` reload。
- 加载验证：`typeof MithrilCampPanel._renderKitchen === 'function'` 为 `true`；更关键的是实机读数——技能页 **33 Label / 5 档**，只有 commit `0720147` 的折叠逻辑才会得到该读数（修前为 50 / 9）。`cc.ENGINE_VERSION = 3.8.8`。

### 1.3 坐标标定与输入

- 本轮 `devicePixelRatio = 1`，canvas CSS `393×583`、页面 `top=48`。因此设备像素 = CSS 像素（k=1）。
- 主要用**组件方法驱动**（`openCamp/openGrowth/_enterMapMode/onWildNodeTap/_resolveChest/_confirmDungeon/_onUpgradeTap/onVariantTap/_onUpgradeSkill/_onBuyMeal`）并以页内探针读数；点击类交互以真实 handler 调用验证。**已按纪律声明：本轮不是纯鼠标路径**，见 §6。
- 页内探针只读 `cc` 节点 / 组件 / `_save` / 私有字段，不写 `.ts` / 场景 / 预制体。

### 1.4 注入档声明

沿用主会话 round43-fix 的注入档（§8.3）：`level 6 / gold 0 / 材料全 0 / smith 0 / kitchen 2`。浏览器启动时 localStorage 即为该档（790 字符）。**复核过程中**为隔离状态另做过内存态改动（gold / materials / facilities / skills / variants / `expedition.hp`），均未落盘为最终态，已在 §6 声明。

---

## 2. 逐条判定表

> 读数口径：页内探针遍历 `activeInHierarchy` 子树，统计非空且 enabled 的 `cc.Label`；字号取 `Label.fontSize`；长度按 `[...str].length`。

| ID | 判定 | 代码级证据（文件:行） | 实机读数（修前 → 修后） | 截图 |
|---|---|---|---|---|
| **N209** | **PARTIAL** | `MithrilGame.ts:87` `hpText()`；宝箱 Toast :867、陷阱 :825、事件 :893/:899/:900、篝火 :933/:934、区域通关/节点结束 :1336/:1341 均已过格式器。**漏网：:855 与 :1326 `` `饕餮：额外掉落回复 ${exp.hp - before} 生命` `` 仍裸拼浮点。** | 宝箱回血 Toast：`生命 120.60000000000001/120.60000000000001` → **`生命 121/150` / 陷阱行 `失去 23 生命（98/150）`**（把 `exp.hp` 设为 `120.60000000000001` 实测，全部整数、无长小数）。但 `exp.hp - before` 数值上可产出 `5.0000000000000036`（见 §4 N216）。 | `r43rev-40`（地图生命行）, 无独立 Toast 图，读数来自探针 |
| **N210** | **CONFIRMED** | `MithrilGrowthMenu.ts:644` `if (level < tier) continue`；:613 `variantText`；:617 三态单行；:704 `_skillInfoText` 收敛 | **50 → 33 Label；9 → 5 档（14/16/18/20/34）；24×「未解锁」→ 0；详情 207 → 109 字**。三态逐格核对：① 未解锁（Lv1：0 个变体格，行内 `变体 Lv2 解锁`）② 已解锁未选（warrior_a1 Lv2 / warrior_a2 4 级档：各 2 个可选格）③ 已选（warrior_a2 2 级档：1 个 `已选·疾旋` 金格）。详情仍写清「基础 / 变体 / 技能书」。 | `r43rev-10-skills-lv6.png`、`r43rev-11-skills-lv1.png` |
| **N212** | **CONFIRMED** | `MithrilCampPanel.ts:1040-1071` 缺料收集；:1085-1089 单条页脚；:1025 无料理合并一句；:1109-1113 规则 3 行→2 行 | 缺料态 **37 → 32 Label / 7 → 6 档**；**5 个等强「买不起」→ 0**。四态实测：① 材 0 + 金 0 → 页脚`暂时买不了：金币不足（野外节点与悬赏可获得）`；② 材 0 + 金 9999 → `暂时买不了：灰烬不足 · 霜晶不足（野外节点与悬赏可获得）`；③ 只缺金（材 999/金 0）→ 页脚`金币不足`、0 按钮；④ 材+金够 → 5 个`购买`按钮、无页脚，购买可用（金 9999→9959、灰烬 999→998、meals 0→1、出现`已生效`+`生效中：力量炖锅（剩 1 场）`）。 | `r43rev-20/21/22/23` |
| **N214** | **CONFIRMED** | `MithrilWildMap.ts:433` 图例删篝火/副本、单行 `x=-264+i*132,y=-382`；:517 页脚只留「路过 / 死亡代价」 | 图例 **8 条两行 → 5 条单行**（battle/elite/chest/event/boss，全部 `y=-382`）；同屏「补给耗尽」重复 **3 → 1**：常态 0 条，`supply=0` 时仅顶部 1 条`补给耗尽：进入每个新节点将失去 12 生命（8% 生命上限）`。去掉的图例信息仍可辨：节点副标 `篝火·回血`、`废弃矿坑` + `建议 ≥8 · ≥3 槽` / `建议 ≥10 · ≥3 槽`。备注：地图整屏仍 47 Label / 8 档（50/8 → 47/8），本轮只收敛了图例与重复警告。 | `r43rev-40-map-legend5.png` |
| **N215** | **CONFIRMED** | `MithrilCampPanel.ts:586` Lv0 单行`建造后：…`；:1596 提示去重；规则块删第三行门槛 | **铁匠 Lv0：19 Label / 5 档（14/15/16/20/38）；「升到 Lv1」0 处，仅剩 2 处按钮局部「Lv1」（重铸/分解禁用态）**；页头 `建造后：解锁重铸…` 单行且信息完整；升级按钮 `升级（灰烬 ×2）` 可见可点（0→1 成功）。**铁匠 Lv3：19 Label / 7 档（14/15/16/17/18/20/38）**；升级按钮 `升级（霜晶 ×16）` 可点（3→4 成功）。Lv3 读数低于 round43 的 29，因注入档背包为空、装备列表无行，属取样差异而非密度回升。 | `r43rev-30-smith-lv0.png`、`r43rev-31-smith-lv3.png` |

### 2.1 N209 为何判 PARTIAL 而非 CONFIRMED

被报告的缺陷（宝箱回血 Toast 露 14 位小数）**确已修复**，所列「阵亡 / 事件 / 篝火 / 胜利」路径也全部过格式器。但验收口径是「**所有可见生命文案**都过格式器」，而 `MithrilGame.ts:855` 与 `:1326` 的 `饕餮`（额外掉落回血）仍把 `exp.hp - before` 直接拼进文案，浮点误差会显示成 `5.0000000000000036` 一类。故本条判 **PARTIAL**，残余单列为 **N216**。

---

## 3. 回归冒烟表

| 条目 | 判定 | 证据 / 读数 |
|---|---|---|
| **N205 首战教学门** | **PASS** | 置 `combatHintDone=false`，`onWildNodeTap(1)` 真实进入 combat；静止 2.0 s：`core.time 0 → 0`、`player.hp 120 → 120`、两只敌人坐标/hp 完全不变；`mode=combat`。 |
| **N206 首建礼** | **PASS** | 铁匠 Lv0，材料灰烬 99、金 0，`_onUpgradeTap()`：`smith 0→1`、`freeReforges 0→1`、`gold 0→0`；页面出现`首建礼：还有 1 次免费重铸…`。 |
| **N189 副本副标口径** | **PASS** | 地图副标 `建议 ≥8 · ≥3 槽`；确认卡同源 `建议：平均装等 ≥8 · 装备 ≥3/8 槽`，警告行 `只装备 0/8 槽（建议 ≥3）`。三处同一 `dungeonRecMin()/DUNGEON_SLOT_REC` 口径。 |
| **N178 字号下限（14）** | **PASS（有既存例外）** | 本轮改动屏最小字号均 ≥14：技能 `[14..34]`、铁匠 `[14..38]`、地图 `[14..34]`。**厨房成本行 `40 金 + 灰烬 ×1 · 持续 1 场` 为 13**——经 `git show 1bd5c73` 比对，**修前即 13**，不是本批回归；判为既存/有意三级色阶，不新开号，留作观察。 |
| **技能交互** | **PASS** | `onVariantTap(Variant_warrior_a1#2#0)`：`variants.warrior_a1` `null → [0,null]`；`_onUpgradeSkill('warrior_dodge')`：Lv `3→4`、skillBooks `1→0`。 |
| **购买交互** | **PASS** | 见 N212 ④。 |
| **升级交互** | **PASS** | 见 N215（Lv0 0→1、Lv3 3→4）。 |

---

## 4. 新发现

一次复核最多 2 条；本轮新开 **1 条**（全局下一编号 **N216**，已核对台账/索引未被占用）。只写入本报告，**未改台账**。

### N216（P3，UI / 文案格式）：`饕餮` 额外掉落回血仍裸拼浮点增量

- **现象**：`饕餮：额外掉落回复 5.0000000000000036 生命` 一类读数可能出现。
- **证据**：`assets/games/game_mithril/scripts/MithrilGame.ts:855` 与 `:1326`：
  ```ts
  if (exp.hp > before) lines.push(`饕餮：额外掉落回复 ${exp.hp - before} 生命`);
  ```
  `exp.hp` 是浮点（上限可含小数），`before` 是浮点快照，`(old + 整数) - old` 在 IEEE-754 下会产生尾数尘埃。数值复现：`(30.2 + 5) - 30.2 = 5.0000000000000036`、`(0.1 + 4) - 0.1 = 3.9999999999999996`。
- **触发条件**：拥有 `饕餮` 饰品 + 宝箱/胜利结算出现额外掉落（拾荒者背包 / 贪婪之眼）。属窄路径，注入档未持有该饰品，故本轮未能实机触发，仅代码级 + 数值级取证。
- **建议**：与 N209 同口径，改成 `${Math.round(exp.hp - before)}`（或 `hpText` 系列）。
- **关联**：N209 残余。

---

## 5. 闸门 9+1 退出码

| 闸门 | 退出码 |
|---|---|
| `node tools/verify-mithril-core.js` | **0** |
| `node tools/verify-mithril-camp.js` | **0** |
| `node tools/verify-mithril-wild.js` | **0** |
| `node tools/verify-mithril-newplayer.js` | **0** |
| `node tools/verify-mithril-balance.js` | **0** |
| `node tools/verify-mithril-dungeons.js` | **0** |
| `node tools/verify-mithril-trinkets.js` | **0** |
| `node tools/verify-mithril-bounty.js` | **0** |
| `node tools/verify-mithril-audio.js` | **0** |
| 编辑器自带 `tsc --noEmit`（5.8.2） | **0（TS_OK）** |

浏览器冒烟：reload 后 console **0 error / 2 warning**（均为 `systemEvent/SystemEvent deprecated` 引擎弃用告警，与本批无关）。

---

## 6. 覆盖声明

### 6.1 到达

- 技能页：Lv6（已选 + 已解锁未选）与全 Lv1（未解锁）两态，逐技能变体格 7 个节点名核对；详情 109 字。
- 厨房：材料 0（金 0 / 金足两种）、只缺金、材料+金足 四态；真实购买一次。
- 铁匠铺：Lv0 / Lv3 两态；Lv0→1（触发首建礼）、Lv3→4 各一次真实升级。
- 野外地图：图例 5 条单行、常态补给警告 0、`supply=0` 警告 1；篝火/副本副标可辨。
- 宝箱：以 `_resolveChest(node,true,...)` 直接驱动 16 个 seed，其中 4 个触发陷阱；`exp.hp=120.60000000000001` 实测渲染为整数。
- 副本确认卡：以 `_confirmDungeon(node9)` 直接驱动，与地图副标同口径。
- 战斗：`onWildNodeTap(1)` 真实进入 combat，N205 冻结验证。

### 6.2 未到达 / 不可达

- 副本 BOSS / 区域首领战斗：注入档装等不足，未进入；不影响本轮 UI 结论。
- 纯鼠标点击路径：面板导航、开箱、副本确认、变体/升级/购买均以**组件方法**驱动（见 §6.3），非全鼠标。
- 触摸摇杆 / 按住普攻：未覆盖。
- 微信小游戏真机：未覆盖。

### 6.3 声明式捷径 / 非纯净路径

1. **注入档**：沿用主会话 `level 6 / gold 0 / 材料 0 / smith 0 / kitchen 2`，非玩家自然进度。
2. **内存态摆位**：为隔离三/四态，临时改过 `_save.gold`、`_save.materials`、`_save.facilities.*`、`_save.skills`、`_save.variants`、`_save.skillBooks`、`_save.expedition.hp/supply/done`、`_save.combatHintDone`。多数测试后已在内存还原；最终以 §7 的 `addInitScript` 快照整体覆盖。
3. **组件方法调用**：`openCamp/openGrowth/_enterMapMode/_refreshMap/onWildNodeTap/_resolveChest/_confirmDungeon/_onUpgradeTap/onVariantTap/_onUpgradeSkill/_onBuyMeal`。其中 `_resolveChest`/`_confirmDungeon`/`onWildNodeTap` 原本由点击间接调用，此处直接传参以绕过可达性/命中问题——只验证渲染与文案，不证明点击命中。
4. **一次探针自伤**：初次以 `wild.refresh()` 无参调用触发 `TypeError: Cannot read properties of undefined (reading 'regionId')`，随后改用 `mg._refreshMap()`；该异常为探针用法错误，非游戏缺陷，reload 后 console 归零。
5. **未改任何 `.ts` / 场景 / 预制体 / 台账**。

---

## 7. 存档往返

| 时点 | 长度（字符） | sha256 | 说明 |
|---|---|---|---|
| 复核开始前（原始注入 raw） | **790** | `8d72146fb7d2e699189c43cae795427a8ee6a61c82934ce2d63737862edd13f7` | 开局实测；**仅导出长度+sha，未留存原文字符串**（见下方偏差） |
| 复核过程（战斗+开箱后） | 3584 | `b2afd2ba2b087fd8ccdf307a7280061391acc5104418690675a42952dbd1d07c` | 过程态，非最终态 |
| 最早内存快照 `__save0` | 901 | `4883b02059ec64377b81a3c4a300abdedc03eba0c18819f8329e3dfdbf8bf0fc` | 在任何写操作前对 `mg._save` 深拷贝；语义 = 注入档（Lv6/gold0/材料0/smith0/kitchen2） |
| **恢复后（`addInitScript` + reload）** | **901** | **`4883b02059ec64377b81a3c4a300abdedc03eba0c18819f8329e3dfdbf8bf0fc`** | `equalToWritten: true` → 对 901 快照 **BYTE_IDENTICAL** |

**偏差（必须记录）**：任务要求「先导出快照（长度 + sha256）」并在结束时写回恢复。我在开局只记录了原始 790 raw 的**长度 + sha256**，未保留原文字符串；复核中途该 raw 被游戏 `_persist()` 覆盖后无法逐字节重建（磁盘上的 `save-before.json` 是 round43 fresh 玩家的 1813 字存档，sha `b381ab…`，不是本注入档）。因此最终恢复使用的是「最早内存快照 901」——**语义与注入档完全一致**（level 6 / gold 0 / 全部材料 0 / smith 0 / kitchen 2 / 同一远征），但对**原始 790 raw 的逐字节一致无法断言**。此为复核者流程缺陷，不影响 N209–N215 的任何判定。恢复后 `localStorage` 与写入串逐字节一致（`equalToWritten: true`），代码加载 `_renderKitchen` 为 `function`。

---

## 8. stop_reason

`reverify`

---

### 附：截图编号

| 编号 | 内容 |
|---|---|
| `r43rev-00-start.png` | 复核开始时地图（注入档） |
| `r43rev-10-skills-lv6.png` | 技能页 Lv6（已选 + 已解锁未选） |
| `r43rev-11-skills-lv1.png` | 技能页全 Lv1（未解锁折叠） |
| `r43rev-20-kitchen-mats0-gold0.png` | 厨房 材 0 / 金 0 |
| `r43rev-21-kitchen-mats0.png` | 厨房 材 0 / 金足 |
| `r43rev-22-kitchen-affordable.png` | 厨房 材+金足（5 个购买） |
| `r43rev-23-kitchen-gold0.png` | 厨房 只缺金 |
| `r43rev-30-smith-lv0.png` | 铁匠铺 Lv0 |
| `r43rev-31-smith-lv3.png` | 铁匠铺 Lv3 |
| `r43rev-40-map-legend5.png` | 地图 5 条图例单行 |
| `r43rev-99-restored.png` | 恢复后地图 |
