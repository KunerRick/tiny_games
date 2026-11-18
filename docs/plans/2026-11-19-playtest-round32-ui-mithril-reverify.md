# 《秘银远征》round32（UI / 信息呈现）独立复核报告

- 日期：2026-11-19
- 复核者：fresh 子代理（未参与本轮开发；只读结论，不改代码 / 台账）
- 对象：`docs/plans/2026-11-19-playtest-round32-ui-mithril.md` §8 的五条修复 N164 / N174 / N175 / N176 / N179
- 环境：Cocos 预览 `http://127.0.0.1:7456/`（MCP `http://localhost:3000/mcp` 在线，`project_refresh_assets` 成功）；视口 1280×720，canvas 393×679，dpr 1，k 现场标定
- 截图：`docs/assets/2026-11-19-mithril-round32/r32v-*.png`（目录 gitignored）
- 存档：起始基线与快照逐字一致；结束用 `addInitScript` 还原，三键 sha256 逐一比对一致（§5.3）；浏览器已 `browser_close`

---

## 1. 结论表（先看这里）

| 编号 | 结论 | 一句话证据 |
|---|---|---|
| **N164** 颜色语汇统一 | **CONFIRMED** | 真实点击「?」读回帮助首行「地图：点**金色高亮圈**进入节点…」；战斗后地图常驻提示读回「…**金色高亮圈**进新节点，蓝圈可路过」；一次性教程实机读回「路线图点**金色高亮圈**启程…」；仓库内「绿圈」只剩 1 处注释（`MithrilWildMap.ts:340`） |
| **N174** 不可达点击反馈 | **CONFIRMED** | 不可达分支：toast 逐字为「这个节点走不到：只能点金色高亮圈连着的相邻节点」+ 提示行转警示色 `e8b04b`；**已清理分支实机复验**：pos 6 / done=[1,3,6] 时点旧节点 1，提示为「该节点已清理，不能重复进入（相邻的已清理节点可以路过）」，未出现「走不到」，存档状态未变（supply 0、pos 6） |
| **N175** 精英 / 首领确认 | **CONFIRMED** | 两个分支均验证：普通战（avg 18.0 / 节点掉 5）弹出完整确认卡、按钮「开打 / 取消」、取消无状态变化；低于掉落档（ilvl30 副本）整卡警示色 + 按钮「仍然开打」；**普通战斗不拦截**：pos 0 点 battle 节点 → `mode` 直接 `map→combat`、无 `WildModal`、supply 3→2 |
| **N176** 天赋锁定格给效果 | **CONFIRMED** | 锁定格实机读回 `0/5 · 需5` + 效果文本「格挡时反击 40% / 生命 <30% 减伤 4% / 闪避 CD -0.4s」，文字色 `#B9AB8B`（读回 `b9ab8b`） |
| **N179** 背包计数写单位 | **CONFIRMED**（单页实机；多页代码级） | 单页读回「共 3 件」、翻页器不激活、3 行；多页文案 `共 N 件 · 第 a/b 页` 仅在源码确认（不改存档无法造 4+ 件，见 §5.2） |

无 REJECTED / PARTIAL。

---

## 2. 逐条证据

### 2.1 N164 颜色语汇（CONFIRMED）

| 证据类型 | 内容 |
|---|---|
| 实机（真实点击「?」，r32v-12-help.png） | 帮助首行逐字：`地图：点金色高亮圈进入节点，沿途清剿推进` |
| 实机（胜利结算返回地图后读回 `_hint.string`） | `远征进行中：已清理 1/12 个节点 · 金色高亮圈进新节点，蓝圈可路过`（色 `b9ab8b`） |
| 实机（新档真实点「以战士开局」后 350 ms 内读回，r32v-08-new-tutorial.png） | `路线图点金色高亮圈启程 · 按住右下最大的键持续攻击 · 右上角「?」可重看操作` |
| 源码 | 两处一次性教程文案一致：`MithrilGame.ts:197` / `MithrilGame.ts:1671`；帮助首行 `MithrilWildMap.ts:342`；常驻提示 `MithrilWildMap.ts:793`、`MithrilGame.ts:405/626` |
| 全仓 grep | `grep -rn "绿圈" assets/ --include='*.ts'` 仅命中 `MithrilWildMap.ts:340` 的**注释**（N164 说明），无玩家可见文案 |

图例绿点仍表示「篝火」节点类型，与「可达」不再共用「绿圈」一词，语义不再冲突。

### 2.2 N174 不可达点击（CONFIRMED）

- **不可达分支（实机，`r32v-01-n174-toast.png`）**：新档 pos 0 点不可达的事件节点（node4，ilvl5）→ Toast 节点存在且文案逐字 `这个节点走不到：只能点金色高亮圈连着的相邻节点`；地图提示行颜色由常态变警示色 `e8b04b`；`mode` 仍 `map`、存档不变。
- **已清理分支（本轮重点复验，实机）**：真实操作走 `1(battle 胜) → 3(事件) → 6(篝火)`，得 `exp = {pos:6, done:[1,3,6], supply:0}`；此时点已清理且**不相邻**的 node1 →
  - 提示逐字变为 `该节点已清理，不能重复进入（相邻的已清理节点可以路过）`（`MithrilGame.ts:595` 的 done 文案）；
  - **未**出现「这个节点走不到」；
  - 存档读回不变：`pos 6 / done [1,3,6] / supply 0`。
- 源码判据：`MithrilGame.ts:542` 的前置分支带 `exp.done.indexOf(node.id) < 0`，done 节点继续走 `enterNode → _enterWildNode` 的 `res.reason === 'done'` 分支（§8.4 自查缺陷 2 已修好）。
- 备注：done 分支只更新常驻提示行，不弹 toast（与原有的说明方式一致），不构成「被吞」。

### 2.3 N175 精英 / 首领确认（CONFIRMED，两分支）

| 分支 | 方式 | 读回 |
|---|---|---|
| 不低于掉落档 | 实机点击精英节点（既有快照存档，avg 18.0 / 8 槽中 2 槽，节点 Lv5 / 掉落 5） | 卡片齐五行：`节点等级 Lv5 · 该节点掉落装等 5`、`当前平均装等 18.0（2/8 槽）`、`精英战：敌人更强，建议状态好再进`、进场消耗、`阵亡会丢失本程材料`；按钮「开打 / 取消」；取消后 `_mode` 仍 `map`、supply / hp 未变 |
| 低于掉落档 | **直接调用** `_confirmDangerNode`（入参为 ilvl30 的 plan 副本，不改存档；见 §5.2） | 整卡警示色，按钮文案「仍然开打」、填充为警示色（`r32v-04-n175-elite-under.png`） |
| 普通战斗不拦截 | 实机：新档 pos 0 点 battle 节点 → `mode: map → combat`，`WildModal` 不存在，supply 3→2，`_hudRef` 激活 | 与「只在 elite/boss 分支拦截」的代码一致（`MithrilGame.ts:572-576`） |

补充：副本节点仍走原有副本确认卡（推荐装等 / 当前装等 / 阶段 / 首通奖励 / 进入消耗），与精英卡互不干扰。

### 2.4 N176 天赋锁定格（CONFIRMED）

- 真实点击底栏「成长」打开天赋页（`r32v-05-n176-talent-locked.png`）；锁定格读回等级行 `0/5 · 需5`（其余抽样为 `需10 / 需15 / 需20`），描述行**有**效果文本（`格挡时反击 40%`、`生命 <30% 减伤 4%`、`闪避 CD -0.4s`）。
- 文字色读回 `b9ab8b`（`MithrilTheme.parchmentDim = '#B9AB8B'`），不再是 `8a7e66`。
- 源码一致：`MithrilGrowthMenu.ts` 中 `desc` 任何状态都取 `def.desc`，门槛挪到 rank 行。
- 未改字号（仍 12 design px），与开发者声明一致；可读性仍归 N161 / N178。

### 2.5 N179 背包计数（CONFIRMED，含覆盖限制）

- 单页实机（`r32v-06-n179-bag-count.png`）：真实点击底栏「装备」→ 背包标题读回 `共 3 件`，翻页器不激活，列表 3 行。
- 多页分支：`MithrilMenu.ts` 中 `pages > 1 ? \`共 ${list.length} 件 · 第 ${this._page + 1}/${pages} 页\` : \`共 ${list.length} 件\``；本轮**未实机造出 4+ 件**（会改动存档，按纪律不伪造进度），仅代码级确认。

---

## 3. 回归冒烟 10 项

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 新档进入游戏（清档 + reload） | **PASS** | 同源 404 页清三键 → reload → 职业选择可见；真实点「以战士开局」（640,555.5）生成 warrior Lv1 存档并播放一次性教程（r32v-07 / r32v-08） |
| 2 | 大厅 → 游戏 → 返回大厅 | **PASS** | 暂停层「返回大厅」→ `scene=Lobby`；真实点大厅「秘银远征」卡片 → `scene=Mithril`，读回 `level 3 / gold 36 / exp.pos 9 / retreat true`，进度未丢 |
| 3 | 核心循环一轮（真实胜利） | **PASS** | 实机键鼠（WASD 移动 + J/K/L/U/I 攻击）打赢 battle 节点：`0:26 / 击杀 10 / 生命 96/96 / stage=cleared`；结算逐字含「本局收益：金币 +28 经验 +144 / 灰烬 +2（本程 2）…新装备已入背包…可成长：天赋点 3」（r32v-10） |
| 4 | 一次失败结算 | **PASS** | 真实阵亡 `0:21 / 击杀 0`（该次为首战未操作导致的真实失败，非脚本伪造）：面板含「本局几乎没有移动…」「远征失败：本程材料已丢失…」「远征结束：本程进度不保留…」「本程还没有拾取材料」「返回路线图 / 成长 / 装备 / 返回大厅」；`exp` 置 null，按钮回到「开始远征」（r32v-09） |
| 5 | 暂停 / 继续 | **PASS** | 副本战斗内点左上返回：`_lastSnapshot.time = 10.1167` 1.5 s 内两次读数完全一致（冻结）；点「继续战斗」后 `10.117 → 11.62 → 12.82`，恢复计时 |
| 6 | 返回 / 退出路径 | **PASS** | 失败 / 胜利结算「返回路线图」均回到地图并重置远征入口；暂停层「返回大厅」→ Lobby，无残留面板；再进游戏状态保持 |
| 7 | 存档 reload 后恢复 | **PASS** | 整页 reload 后回到秘银场景，读回 `level 3 / gold 36 / expedition {pos 9, retreat true, supply 0}` 与 reload 前一致 |
| 8 | 相邻界面 | **PASS** | 成长（N176）与装备 / 背包（N179）实机打开、切换、读回正常；营地本轮未重开（本轮修复不涉及营地，round32 试玩已覆盖） |
| 9 | 控制台 error | **PASS** | 浏览器 `error` 级 0 条、warning 2 条（引擎 `systemEvent` 弃用类）；MCP `debug_get_console_logs filter:error` 返回 `total: 0` |
| 10 | `tsc --noEmit`（编辑器 5.8.2） | **PASS** | 见 §4，exit 0 |

---

## 4. 闸门复跑

| 闸门 | 命令 | 结果 |
|---|---|---|
| tsc | 编辑器自带 `.../typescript/bin/tsc --noEmit`（5.8.2） | exit **0**（TS_OK） |
| core | `node tools/verify-mithril-core.js` | exit **0**，`245/245 项通过` |
| wild | `node tools/verify-mithril-wild.js` | exit **0**，`2973 项检查全部通过` |
| balance | `node tools/verify-mithril-balance.js` | exit **0**，`139 项通过` |
| dungeons | `node tools/verify-mithril-dungeons.js` | exit **0**，`892 项检查全部通过` |
| newplayer | `node tools/verify-mithril-newplayer.js` | exit **0**，`123 项检查全部通过` |

与开发者记录的计数逐项一致（245 / 2973 / 139 / 892 / 123）。

---

## 5. 覆盖声明

### 5.1 实机路径（真实点击 / 键鼠）

大厅往返、职业选择（清档新档）、路线图节点点击（战斗 / 事件 / 篝火 / 副本 / 不可达 / 已清理）、帮助弹层（真实点「?」）、成长面板、装备背包面板、普通战斗（真实胜利 + 真实阵亡）、副本确认与进入、暂停层（暂停 / 继续 / 返回大厅）、三个结算出口、整页 reload。

战斗输入用**键盘**驱动（WASD 移动、J/K/L/U/I 技能，均属游戏内置键位，非注入）：一次真实胜利 0:26 / 10 杀。

### 5.2 声明式捷径（逐项）

1. **清档复测新档**：导航到同源 404 页使游戏停止后 `localStorage.removeItem` 三个 mithril 键，再回游戏，避免 `EVENT_HIDE` / `_persist()` 覆盖；随后通过真实点击职业卡重新生成纯净新档。冒烟 1–6 均使用该新档。
2. **seen_tutorial 清除**：为复验一次性教程文案（N164），清档时一并移除该键；随后真实点职业卡触发教程并读回。
3. **N175 低装等分支**：直接调用 `_confirmDangerNode(node, plan)`，`plan` 用 ilvl30 的**副本对象副本**（纯内存），**未改存档**、未接受确认、未进战斗。
4. **读探针**：`openGrowth()` / `openMenu()`（面板只读）、`_hint.string` / `Label.color` / `_modal` / `_core` 状态读回、`_nodeIds` 计算节点 CSS 坐标；未调用任何改变存档的方法。
5. **坐标**：每轮用同一个 `cssOf`（`convertToWorldSpaceAR` + `camera.worldToScreen` + canvas rect 缩放）现场换算；本轮换算值与视觉一致（点击全部命中）。
6. 未注入金币 / 血量 / 装备 / 战斗结果；唯一改动存档的操作是 §5.2-1 的清档（已声明）。

### 5.3 快照与恢复（结束态）

用 `page.addInitScript` 在 reload 前写入快照三键（内容取自 `docs/assets/2026-11-19-mithril-round32/save-snapshot-raw.txt` / `save-snapshot.json`），reload 后读回并计算 sha256，**两次（间隔 2.5 s）完全一致**：

| 键 | 长度 | sha256（快照 = 恢复后） |
|---|---|---|
| `tiny_games_mithril_save` | 1812 B | `09c10d9137862375180c766bb9219b2718aa63b1a9fda3bf2119a41aad3df86b` |
| `tiny_games_mithril_seen_tutorial` | 1 B | `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b` |
| `tiny_games_mithril_audio` | 23 B | `83913b1253d57423cf0aee23caf2457caa20865344ab8a6719d91c840266cbda` |

游戏读回 `level 2 / gold 5010 / classId warrior / expedition.pos 1 / combatHintDone true`，地图渲染正常（r32v-11-restored-map.png）。浏览器已 `browser_close`。

---

## 6. 新发现（仅建议，编号与分级由主会话分配）

> 以下均为**单级证据 / 未定性**，不计入本轮 5 条结论。

1. **（建议 N182，P2 待复现）退出未结算战斗后 `expedition.hp` 疑似被改写**：副本入场后读回 `exp.hp = 88`（96 − 8 入场消耗）；暂停 → 返回大厅 → reload 后读回 `exp.hp = 60`（当时当前生命为 88/96）。60 恰为低等级血量口径，疑似退出 / 恢复路径把 hp 夹到旧上限。需要一次定向复现（进入战斗 → 改 hp → 返回大厅 → reload 对比）。
2. **（观察，无编号）modal 开启期间地图常驻提示不刷新**：事件结算后 `done = [1,3]`，但 modal 未关时 `_hint` 仍为「已清理 1/12 个节点」；`MithrilGame.ts:405` 用的是 `exp.done.length`，关闭 modal 后是否刷新本轮未读到（我直接点了下一节点）。优先级低，确认后再决定是否立号。

---

## 7. E 分

本轮为修复复核，未执行新旅程：**E1–E4 不适用，维持试玩者基线 2 / 2 / 2 / 2**。

观察（不进分数）：新档真实胜利 0:26 / 10 杀、生命 96/96（键鼠 + 技能全开），与 round32 试玩者「第二次 0:51 胜」同量级，未见难度回归；精英 / 副本的越级风险仍由 N177 覆盖，本轮未改。

---

## 8. 一句话结论

五条修复（N164 / N174 / N175 / N176 / N179）全部 **CONFIRMED**：文案、拒绝路径（含「已清理」分支不被吞）、精英双分支确认与普通战一击即入、锁定格效果与配色、背包计数均与声明一致；冒烟 10/10、六道闸门 exit 0 且计数与开发者记录一致，快照三键 sha256 精确还原，未发现需要打回的回归。
