# 《秘银远征》第 14 轮独立复核报告（M5 · N49 / N51 / N52 三修复）

> 日期：2026-11-15 · 游戏：`mithril` · 场景：`assets/games/game_mithril/scenes/Mithril.scene`
> 复核对象：第 13 轮报告 `docs/plans/2026-11-15-playtest-round13-mithril-m5.md` 中 N49（P3 未修）、N51（P3 新）、N52（P3 新）的开发者修复（未提交改动仅 `MithrilCampPanel.ts`、`MithrilGame.ts`）
> 复核者：fresh 子代理（独立复核者，非开发者）。**所有结论来自真实点击 / 真实按键 + 只读探针**，未信任自述，未改任何 `.ts` / 场景 / 预制体，MCP 只读。
> 环境：Cocos Creator 3.8.8 编辑器预览 `http://127.0.0.1:7456/`（开工前 `lsof -nP -iTCP:7456 -sTCP:LISTEN` 确认在跑；开发者已 `project_refresh_assets`，本轮所有结论均在**整页 reload 之后**的会话里取得）

## 1. 结论

**P0 = 0 · P1 = 0 · P2 = 0 · 新增 P3 = 0（无新增编号，N53 起未使用）。**

| 编号 | 上一轮 | 本轮 | 一句话 |
|---|---|---|---|
| N49 | P3 未修 | **PASS（关闭）** | 事件结果弹窗打开期间顶栏生命已与 `expedition.hp` 一致（335/372），关闭后不再变化；弹窗本身与节点圈状态正常 |
| N51 | P3 新 | **PASS（关闭）** | 军需官页签 1280 与 414×896 的全部 Label 里 `M\d+` 匹配数为 0，文案改为「悬赏任务还没开放…」 |
| N52 | P3 新 | **PASS（关闭）** | 铁匠铺 Lv0 时「重铸 / 分解」均显示「需铁匠铺 Lv1」并置灰，点击先给设施门槛提示；底部帮助多出的一行在两种视口下都不重叠 |

回归项（营地开关 + `C` 键、五页签与页头、真实重铸 / 附魔 / 洗点门槛 / 料理购买、console）全部通过。**M5 主体可验收。**

## 2. 问题清单（机读区）

| ID | 级别 | 单条结论 | 现象与证据（本轮实测） | 复现步骤 |
|----|------|----------|------------------------|----------|
| N49 | P3 → **PASS / 关闭** | 修复有效 | 补给 1 进入事件节点选「冒险深挖」，**弹窗未关闭时**探针读回：`g._save.expedition.hp = 335`、`wm._hpLabel.string = '生命 335/372'`（一致）；弹窗正文「失去 37 生命（335/372）」。`done = [1,2,4]`，节点 4 的标签色 `#6b7280`（已清除），未清节点 3 为 `#f3f4f6`，说明节点圈状态在弹窗期间已是最新。点「知道了」后 `hp` 仍 335、`_hpLabel` 仍「生命 335/372」，hint 变「事件已处理 · 生命 335/372」。弹窗存在、按钮可点、选项流程与视觉无异常（截图 `mithril-m5-r14-event-result-modal.png`） | 野外事件节点（补给 1）→ 点「冒险深挖」→ 弹窗未关时读 `expedition.hp` 与 `wm._hpLabel.string` → 点「知道了」后重读 |
| N51 | P3 → **PASS / 关闭** | 修复有效 | 营地 → 军需官，把面板内全部 Label 文本 join 后匹配 `M\s?\d+`：**`milestoneMatches = []`**，`hasM8 = false`、`hasM6 = false`。原文案已变为「悬赏任务还没开放；开放后这里的悬赏位数量会直接生效。」1280 与 414×896 同文案，无重叠（截图 `mithril-m5-r14-quartermaster-1280.png`、`mithril-m5-r14-n51-quartermaster-414.png`） | 营地 → 军需官 → 读说明块并 grep `M\d` |
| N52 | P3 → **PASS / 关闭** | 修复有效 | **全 Lv0 新档**（金币 0、五设施 0、无装备）：铁匠铺两按钮文案为「重铸（需铁匠铺 Lv1）」「分解（需铁匠铺 Lv1）」，`__btnActive() = false`，文字色 `#6B7280`、底色 `#1A2332`（灰化）；**未选装备**直接点「重铸」→ hint「铁匠铺还没建造：把它升到 Lv1 才能重铸」，点「分解」→「…才能分解装备」（**不是**「先选一件装备」）；底部帮助首行为「铁匠铺还没建造：升到 Lv1 就能重铸与分解背包里的装备。」，1280 与 414×896 截图确认不与升级按钮 / hint 重叠 | 备份真实档 → 删档 reload 得全 Lv0 新档 → 营地 → 铁匠铺 → 读按钮文案/颜色 → 分别点「重铸」「分解」读 hint → 截图 |

> 本轮**无新增问题**，N53 及以后编号未使用。

## 3. 回归实测（真实点击 / 真实按键）

| 项 | 实测 | 结论 |
|---|---|---|
| 营地打开（底部按钮） | 1280 点「营地」(593.32,675.47)、414 点「营地」(158.97,776.44) → `camp.isOpen() = true`，默认 `_tab = 'smith'` | ✅ |
| `C` 键开关 | 画布内点击一次后按 `C`：`false → true → false` 两次切换均生效 | ✅ |
| 五页签 + 页头 | 1280 逐一点击五页签，页头等级/当前效果/下一级/金币与三材料与 `_save` 一致；414 点击铁匠铺 / 军需官均正确切换（`_tab` 匹配） | ✅ |
| 重铸（Lv3，ilvl 18） | 按钮「重铸 148 金」→ 点击：金币 **1326→1178（−148 = 40+6×18）**；词条 `crit+haste → mastery+vers`，无重复；提示「重铸完成：暴击→精通、急速→全能（点数不变）」 | ✅ |
| 重铸（Lv3，ilvl 12，恢复档） | 按钮「重铸 112 金」→ 点击：金币 **858→746（−112 = 40+6×12）**；词条 `crit/haste/vers → haste/crit/mastery`，`dup = false`；提示「重铸完成：暴击→急速、急速→暴击、全能→精通（点数不变）」 | ✅ |
| 附魔（Lv1） | 源「全能·灰烬之戒」→ 目标「优秀·秘银王冠」→ 点「附魔」：金币 **1178→1098（−80）**、灰烬 **9→7（−2）**、背包 **11→10**（源消失）、目标词条变 `crit+vers`、提示「附魔完成：全能 → 灰烬之戒」 | ✅ |
| 洗点门槛（训练场 Lv1） | 天赋为空时点洗点 → 提示「还没有投入天赋点」，金币不变；投入 `warrior_steel_t1_0` 后再点 → 金币 **1098→898（−200）**、`talents = {}`、提示「洗点完成：−200 金」 | ✅ |
| 洗点门槛（训练场 Lv0，fresh 档） | 按钮「洗点天赋（需训练场 Lv1）」，点击 →「训练场还没建造…」，`talents {}` / 金币 0 不变 | ✅ |
| 厨房（Lv1） | 买「力量炖锅」：金币 **898→858（−40）**、灰烬 **7→6**、`meals = [{pot_roast, runsLeft:1}]`、「生效中：力量炖锅（剩 1 场）」「下一场加成：攻击强度 +10.0%」 | ✅ |
| 面板打开时地图冻结 | 面板打开时对地图位置真实点击，`expedition` / `_save` 均未变（仅营地自身 `_selUid` 变化） | ✅ |
| console | `browser_console_messages(level:"error")` → **0 error**（2 warning，均为 Cocos 常规提示），会话日志 `.playwright-mcp/console-2026-11-15T11-43-58-780Z.log` | ✅ |

## 4. 方法与数据

### 4.1 视口与坐标标定（每轮现场反解，`k = 1`）

| 项 | 1280×720 | 414×896 |
|---|---|---|
| `#GameCanvas` rect | `{x:443.5, y:41.453, w:393, h:678.547}` | `{x:10.5, y:49.719, w:393, h:846.281}` |
| canvas 缓冲区 | `393 × 679` | `393 × 846` |
| `devicePixelRatio` | 1 | 1 |
| 点击入参 | `page.mouse.click` 直接吃 CSS 坐标（1:1） | 同 |

- 世界坐标 → CSS：`ui.convertToWorldSpaceAR(0,0,0)` → `camera.worldToScreen(...)` → `cssX = rect.left + sp.x / canvas.width * rect.width`、`cssY = rect.top + (1 − sp.y / canvas.height) * rect.height`，与 `browser_run_code_unsafe` 的 `page.mouse` 一致（本轮未出现偏移，k 实测 = 1）。
- 探针（每次 reload 后重注入）：`window.__walk` / `__comp(name)`（按 `constructor.name`）/ `__labels(root)` / `__cssOf(node)`。只读字段：`g._save`（gold / level / materials / facilities / inventory / equips / talents / meals / expedition）、`g._mode`、`camp._tab / _selUid / _hintLabel / _root / isOpen()`、`wm._hpLabel / _supplyLabel`、按钮节点 `__tapCb` / `__btnActive()` 与 Label 的 `color / fontSize`。
- 关键坐标（CSS）：1280 营地入口 `593.32,675.47`、页签 y=144.3（x=502.08/571.04/640/708.96/777.92）、重铸 `602.87,454.94`、分解 `719.57,454.94`、升级 `640,629.88`；414 营地入口 `158.97,776.44`、页签 y=229.34（x=65.08/136.04/207/277.96/348.92）、重铸 `168.79,549.3`、分解 `288.87,549.3`、升级 `207,729.49`。

### 4.2 存档处理（必须披露）

只做了简报允许的唯一例外（备份 → 看全 Lv0 新档 → 恢复），**备份内容从未被改写**：

| 步骤 | 证据 |
|---|---|
| 原始档备份（本轮开工时的真实档） | `sessionStorage.__mithril_r14_backup`，**2409 字节**，滚动 hash `132303011` |
| 进 N52 前把当时存档原样备份 | `sessionStorage.__mithril_r14_b2`，**2335 字节**，hash `2517849160`（内容是第 13 轮遗留 + 本轮回归的真实操作结果：金币 858、等级 15、五设施 3/1/1/1/1、背包 10） |
| 造新档 | `page.addInitScript` + `sessionStorage` 一次性守卫，在页面脚本前 `removeItem('tiny_games_mithril_save')` 后 reload；读回 `gold=0`、`level=1`、`facilities` 全 0、`inventory=0`、`equips` 全空 → 确认是全 Lv0 新档（新档自身落盘 558→567 字节默认档） |
| 恢复 B2 | 写回后立即读回 `identical=true`、`len=2335`、hash `2517849160`；整页加载后再次读回 `identical=true`、`len=2335`、hash `2517849160`、`gold=858`、`level=15`、`facilities={smith:3,enchant:1,training:1,kitchen:1,quartermaster:1}`、`inventory=10` |
| 最终恢复原始档 | 整页加载后读回 **`len=2409`、hash `132303011`、`identicalToBackup=true`**；关键字段：`gold=1250`、`level=14`、`exp=1467`、`classId=warrior`、`facilities={smith:3,enchant:1,training:1,kitchen:1,quartermaster:1}`、`materials={frost_crystal:22, ash_dust:3, mithril_ore:0}`、`inventory=11`、`equips.mainHand=first_mine_u7r80p`、`talents={}`、`meals=[]`、`expedition={seed:1592903110, pos:1, hp:354, supply:2, done:[]}`、HUD「生命 354/354」「补给 2/3」 |

- **恢复机制的偏差（已披露）**：先「写 localStorage 再 reload」会被**页面卸载时游戏把内存存档写回**覆盖——诊断探针在 document-start 读到的是 567 字节新档（`restoredAtStart` 机制生效后才拿到 B2）。因此恢复改用「`addInitScript` 在 document-start 写回原始字符串」，结果逐字节一致；这条偏差本身反而证明退出时游戏会自动存盘。
- 除上述备用/恢复外，**没有手写任何金币 / 材料 / 装备 / 进度**；所有数值变化均来自真实点击（重铸 2 次、附魔 1 次、洗点 1 次、料理 1 次）。这些变化在最终恢复后全部被原始档覆盖（读回即上表值）。

### 4.3 截图

`.playwright-mcp/mithril-m5-r14-n52-fresh-smith-1280.png`、`mithril-m5-r14-n52-fresh-smith-414.png`、`mithril-m5-r14-n51-quartermaster-414.png`、`mithril-m5-r14-quartermaster-1280.png`、`mithril-m5-r14-event-result-modal.png`、`mithril-m5-r14-event-choice.png`、`mithril-m5-r14-reforge.png`、`mithril-m5-r14-kitchen-bought.png`、`mithril-m5-r14-1280-{smith,enchant,training,kitchen,quartermaster}.png`。

## 5. 未复现 / 已排除的疑点

1. **「reload 后 `C` 键失效」** —— 预览环境行为，不是缺陷。证据：reload 后 `document` 已收到 `keydown`（`key='c', code='KeyC', keyCode=67, target=CANVAS`），但引擎未派发；在画布内真实点击一次后，`C` 立刻能开/关营地（`false → true → false`）。推测引擎键盘输入需先获得画布焦点。
2. **「写回存档后 reload 仍是新档」** —— 不是存档损坏：document-start 读到的是新档（567 字节），说明卸载时游戏把内存档写回，覆盖了 reload 前的手写值。改用 document-start 写回后逐字节一致。
3. **「N52 按钮不是真 disabled」** —— 验收要求是「置灰 + 点击给门槛提示」，实测 `active=false` + 灰化配色，点击仍会执行并给出门槛提示，这与训练场 Lv0 的既有口径一致，不算缺陷。
4. **「414 下底部新增一行会挤出面板」** —— 未复现：截图显示帮助块 3–4 行均为面板内，升级按钮与 hint 位置未变。
5. **N49 是否只是"读得太早"** —— 本轮在弹窗打开后直接读、并在关闭后再读，两次一致，且 `done` 节点圈同步，可排除。

## 6. 复现配方（最小步骤）

```text
# N49（弹窗期间顶栏生命）
补给 1 进事件节点 → 点「冒险深挖」→ 不关弹窗读 wm._hpLabel 与 g._save.expedition.hp（应一致）
→ 点「知道了」→ 再读（不应变化）

# N51（玩家文案无里程碑号）
营地 → 军需官 → join 全部 Label → 正则 /M\s?\d+/（应 0 命中）

# N52（铁匠铺 Lv0 门槛）
备份真实档 → addInitScript 删档 reload（得全 Lv0 新档）
→ 营地 → 铁匠铺：两按钮应为「重铸（需铁匠铺 Lv1）」「分解（需铁匠铺 Lv1）」且灰化
→ 未选装备分别点两按钮：应为「铁匠铺还没建造…」而非「先选一件装备」
→ 底部帮助首行「铁匠铺还没建造：升到 Lv1 就能重铸与分解背包里的装备。」
→ 恢复真实档

# 正常档重铸（Lv1+）
营地 → 铁匠铺 → 选一件装备 → 按钮显示金额（ilvl 12 = 112 金）→ 点击 → 金币恰好 −112、词条换新无重复
```

## 7. 剩余风险

1. 高等级设施行为仍未在浏览器侧覆盖（本轮实测设施为 Lv0–3）：铁匠铺 Lv4 折扣 / Lv5 −50%、附魔台 Lv2–5、训练场 Lv2–5、厨房 Lv2–5、军需官 Lv2+；由开发者 `verify-mithril-camp.js` 覆盖，本轮未复核。
2. 附魔拒绝路径（源=目标 / 目标词条已满 / 重复词条）、满仓折算金币、M6 副本与 M8 悬赏本体仍未覆盖（承接第 13 轮）。
3. 本轮恢复使用 document-start 注入写回（与「reload 前写入」不同），虽结果逐字节一致，但机制差异已如实披露；任何后续复核如沿用旧机制会被卸载存盘覆盖。
4. 键盘需先点画布属桌面预览行为，真机 / 微信无键盘入口，未在真机验证。

## 8. 结语

三处修复都落在正确的位置：N49 在弹窗弹出前刷新一次地图，弹窗与顶栏不再打架；N51 把内部里程碑号换成了玩家语言；N52 让 Lv0 的铁匠铺与训练场口径一致（文案带门槛、置灰、门槛判定优先于"先选装备"），底部帮助也在两种视口下排得开。回归路径（重铸扣费精确到公式、附魔消耗源装备、洗点与料理的扣费/状态、营地开关与五页签）全部复测通过，console 零错误，原始存档已逐字节恢复。

**M5 是否可以验收：是** —— N49 / N51 / N52 三条 P3 全部实测关闭，回归无新增 P0–P3，剩余风险均为浏览器侧不可达的高等级设施行为与未实现本体，不阻塞 M5 验收。
