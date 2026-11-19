# 《秘银远征》round40 · 玩法修复批（主会话，无 fresh 玩家）

- 日期：2026-11-19
- 上游：round39 fresh 玩法拍（[`2026-11-19-playtest-round39-gameplay-mithril.md`](./2026-11-19-playtest-round39-gameplay-mithril.md)，E1–E4 = 2/3/1/1，stop_reason = plateau）
- 本拍角色：主会话（开发者）按 round39 的问题表修 6 条，并对外部误读的 2 条做取证式驳回
- 改动文件：`MithrilWild.ts` / `MithrilConfig.ts` / `MithrilRenderer.ts` / `MithrilHud.ts` / `MithrilGrowthMenu.ts` / `MithrilClassSelect.ts` + 两个验脚本
- E 分未测（修复批；按协议由下一拍 fresh 玩家用旅程脚本 v1 重测）

---

## 1. 改动表

| N 号 | 来源 | 级别 | 改动 | 文件 |
|---|---|---|---|---|
| **N199** | P-1 | P1 | 首战节点（层 1 第一个战斗节点）三波 **3/4/3 → 2/3/2**：imp×2 → miner+imp×2 → miner+imp；副标「先来两只 / 它们开始聚拢 / 最后一批」。非首战节点维持 3/4/3 与原副标 | `MithrilWild.ts:576–605`、`MithrilWild.ts:658` |
| **N200** | P-2 | P2 | 五个营地设施首档升级材料 **灰烬 ×3 → ×2**（其余档位不动） | `MithrilConfig.ts` `FACILITIES[*].costs[0]` |
| **N201** | P-3 | P2 | 玩家头顶加青色（`#7DE9FF`）三角标记：深色描边 + 脉动 alpha，位置 `py + PLAYER_RADIUS + 16` | `MithrilRenderer.ts:110`、`517–540` |
| **N202** | P-4 | P3 | 结算面板弹出时隐藏左上返回按钮（`_backBtnNode.active = false`），`resetForNewRun()` 恢复 | `MithrilHud.ts:208/370/1011/1424` |
| **N203** | P-5 | P3 | 锁定天赋行：独立 `TalentLock` 子节点画金锁（34 设计 px），名称/进度/描述降 `parchmentMuted`，进度行写 `0/5 · 需本线 N 点` | `MithrilGrowthMenu.ts:476–520` |
| **N204** | P-7 | P3 | 未选中职业卡描边 `gold@120 / 2.5px → gold@170 / 3px`，「点击选择」`parchmentDim → parchment` + 加粗 | `MithrilClassSelect.ts:178–184/229–234` |

另：`verify-mithril-wild.js` 首战构成断言按 2/3/2 重写（非首战断言不动）；`verify-mithril-balance.js` check 050「灰烬满级总需求」65 → **60**（2+10=12/设施 × 5）。

### 驳回（外部误读，代码 + 截图取证）

| 来源 | 原报 | 裁决 | 证据 |
|---|---|---|---|
| P-6 | 天赋页「可用 4 · 已投 04」与全 0 行矛盾 | **REFUTED → `within`** | `_pointsText` 产出的实际字符串是 `已投 0/4`；13–14 号字体下斜杠与 4 挤在一起被读成「04」。两张截图之间隔一次真实加点（钢铁 0→4/25），不是同一帧数据矛盾。残余只是小字号可读性，不单独立项 |
| P-8 | 结算写「推进到 通过 1/3」 | **REFUTED → `within`** | 源码无「通过」二字；把 r39-17 截图裁切放大后逐字读为「推进到 遭遇 1/3」。另 P-1/P-8 提到的首战「头目压阵」也不成立——首战第三波副标是「最后一批」（见 N199 实机读数） |

---

## 2. 逐条实机证据

### 2.1 N199 首战 2/3/2（真实进入战斗）

进节点 1（`layer: 1`，`ash_battle_1`）后读 `_core.plan.encounters`：

```
第一波  「先来两只」    imp×2
第二波  「它们开始聚拢」 miner×1 + imp×2
第三波  「最后一批」    miner×1 + imp×1
```

当前 `_core.enemies.length == 2`（与第一波 spawn 数一致）。修复前同节点为 3/4/3。

难度侧旁证（无头 bot，`tools/lib/mithril-bot.js`，朴素模型玩家 × 6 seed）：
- 3/4/3：**0/6 胜**；
- 2/3/2：**6/6 胜**，31.3 s，最低血 30%；
- 3/3/2：5/6 胜，最低血 16%（未采纳，边际收益不值）。

### 2.2 N200 首档灰烬 ×2（营地实机）

临时把 `_save.facilities.smith` 置 0 → `refresh()`，升级按钮文案 **「升级（灰烬 ×2）」**；置 1 时为「升级（灰烬 ×10）」（第二档未动）。读回后恢复原值 3。

### 2.3 N201 头顶青色三角（战斗截图）

战斗截图裁切 4×：玩家（灰色战士 + 剑盾）头顶正上方一枚青色三角，与旁边橙色 imp（红色血条）色相明显分离；三角不压 HP 条。`docs/assets/2026-11-19-mithril-round40/n201-player-chevron*.png`。

### 2.4 N202 结算时返回键隐藏（实机）

`hud.node.active = true` + `_showResult(...)` 后：`_backBtnNode.active == false`；截图（隐藏 WildMap 后）显示结算面板只有自带四按钮，左上角无返回箭头。`resetForNewRun()` 后 `_backBtnNode.active == true`。结算面板本身自带「返回大厅」（教训 H 的约定），不会出现「无退出路径」。

### 2.5 N203 锁定行（成长页实机 + 逐格探针）

等级 2、0 点投入时逐格读回：

| 格 | `TalentLock` | 进度行 |
|---|---|---|
| t1_0 / t1_1 | 无 | `0/5 · →受伤 −1.0%` / `0/5 · →护甲 +2.0` |
| t2_0 / t2_1 | **有** | `0/5 · 需本线 5 点` |
| t3/t4/t5 各两格 | **有** | `0/5 · 需本线 10 / 15 / 20 点` |

截图裁切 4×：金锁形状可辨认（深底圆垫 + 门环 + 锁体），与未锁的 t1 行一眼可分。`docs/assets/2026-11-19-mithril-round40/n203-talent-locks.png`。

> 过程记录：锁标首版 20 px、次版 24 px 在 0.5 缩放下都糊成金色方块；且 `arc` 绕向参数写反，门环画进了锁体被填充盖住。最终 34 设计 px（≈17 CSS px）+ `arc(..., true)` 才读得出。

### 2.6 N204 未选中职业卡（实机）

`_classRef.open()` 截图：选中战士 = 实心金底 + 4 px 金边 + 「已选中」；未选中三张 = 深底 + 3 px 金边（@170）+ 亮色加粗「点击选择」，强弱关系清楚且不再像禁用态。`docs/assets/2026-11-19-mithril-round40/n204-class-cards.png`。

---

## 3. 闸门与冒烟

| 项 | 结果 |
|---|---|
| `tsc --noEmit`（编辑器自带 5.8.2） | **TS_OK** |
| `verify-mithril-core` | 245/245 |
| `verify-mithril-wild` | **2975/2975**（含改写的首战构成断言） |
| `verify-mithril-dungeons` | 892/892 |
| `verify-mithril-newplayer` | 123/123 |
| `verify-mithril-balance` | 139/139（check 050 = 60） |
| `verify-template-core` | 15/15 |
| `check-game-icons` | 25 款全覆盖 |
| 浏览器控制台 | **0 error**（2 warning 为引擎弃用告警，与项目代码无关） |

---

## 4. 覆盖声明

**捷径 / 非纯净路径（逐条标是否影响判定）**

1. **进战斗**用 `g.onWildNodeTap(1)`（游戏自己的节点点击入口，跳过指针层）——**不影响** N199 构成判定（构成由 `_core.plan.encounters` 直接读出）。
2. **开面板**用 `_growthRef.open(_save)` / `_campRef.open(_save)` / `_classRef.open()` 直接调用——**不影响** N203/N204 的渲染判定（面板走正常构建路径），但不会覆盖「从底栏点进去」的点击链路（本拍未测）。
3. **截图前临时隐藏 `WildMap`**（同级遮挡）——纯取景手段，**不影响**判定。
4. **N201 取证时临时清空 `_core.enemies` 并把玩家挪到空地**——只影响那一张干净截图；另一张「贴脸混战」截图（`n201-player-chevron.png`）未清场，三角同样可见。
5. **N202 用 `_showResult(fake snapshot)` 直接拉结算面板**——**可能偏离**真实阵亡路径的正文内容（本拍只验返回键显隐，不验正文）。
6. **N200 临时改 `_save.facilities.smith` 读按钮文案后立刻恢复**——未落盘；恢复后 `smith = 3` 读回。
7. **存档**：进战斗会扣补给 / HP，属于真实行为（非注入）；所有验证结束后用 `addInitScript` + `sessionStorage` 一次性 guard + 同步 XHR 从本地桥恢复。

**到达**：路线图 → 节点 1 战斗（三波构成）→ 结算面板（隐藏返回键）→ 营地铁匠铺（升级文案两档）→ 成长 · 天赋（十格锁态）→ 职业选择（四卡）。

**未到达**：本轮不是试玩拍，未走完整旅程；副本 / BOSS / 篝火 / 宝箱 / 洗点 / 技能页未打开。E 分未测。

---

## 5. 存档往返

- 拍前（= round39 恢复后的纯净快照）：len **1813**，sha256 **b381ab617d1bec0ca3fbc87ea91ed302a1ae480382c6a751f482d82fcebee769**
- 验证期间进战斗后：存档被真实改写（未记录 len，只确认 ≠ 快照）
- 恢复后复核：len **1813**，sha256 与拍前 **一致**（`equal: true`，`restoredFlag = 1`）

---

## 6. 停止原因：`budget`（修复批完成，未派 fresh 玩家）

- 修复批按 round39 问题表处理完 6 条 + 驳回 2 条；
- 已派 **fresh 独立复核者**（协议：改玩法难度 + 跨系统 ≥3 条 → 必须复核），裁决见台账 §8 的复核条目；
- 下一拍 = **round41 fresh 玩法拍**（旅程脚本 v1，重测 E1–E4，重点回访 N199 首战与 N200 首升）。
