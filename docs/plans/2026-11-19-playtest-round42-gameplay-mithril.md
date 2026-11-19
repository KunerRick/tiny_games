# 《秘银远征》round42 · 玩法修复批（主会话，无 fresh 玩家）

- 日期：2026-11-19
- 上游：round41 fresh 玩法拍（[`2026-11-19-playtest-round41-gameplay-mithril.md`](./2026-11-19-playtest-round41-gameplay-mithril.md)，E1–E4 = 3/3/3/2，stop_reason = `converged`，新开 N205–N207）
- 本拍角色：主会话（开发者）按 round41 问题表修 3 条（P2×1 / P3×2）
- 改动文件：`MithrilGame.ts` / `MithrilHud.ts` / `MithrilProgress.ts` / `MithrilCamp.ts` / `MithrilCampPanel.ts` / `MithrilConfig.ts` + `tools/verify-mithril-camp.js`
- E 分未测（修复批；按协议由下一拍 fresh 玩家用旅程脚本 v1 重测）

---

## 1. 改动表

| N 号 | 来源 | 级别 | 改动 | 文件 |
|---|---|---|---|---|
| **N205** | round41 P2 | P2 | **首战教学门**：操作提示出现时敌人先不动，玩家第一次移动 / 出手才开打。提示第一行改为「先看看操作，动一下或按攻击键就开始」，解除后回常规三行 | `MithrilGame.ts`（`_introGate` / `_hasInputIntent` / `update` / `_beginNodeCombat` / `_enterMapMode`）、`MithrilHud.ts`（`_hintGated` / `releaseCombatHintGate` / `_refreshHintText`） |
| **N206** | round41 P3 | P3 | **首建礼**：铁匠铺 Lv0→1 赠 **1 次免费重铸**（存档新字段 `freeReforges`，旧档回落 0）。有券时重铸费用 0，信息行 / 按钮 / 底部帮助 / 完成提示统一显示「免费 ×N」 | `MithrilProgress.ts`（字段 + default + sanitize）、`MithrilCamp.ts`（`freeReforgeCount` / `upgradeFacility` / `canReforge` / `reforge`）、`MithrilCampPanel.ts`、`MithrilConfig.ts`（Lv1 效果文案） |
| **N207** | round41 P3 | P3 | **阵亡后点节点有回应**：无远征时点任意节点 → Toast「本次远征已结束：先点下方「开始远征」再出发」+ 底部提示行同文案（警示色） | `MithrilGame.ts`（`onWildNodeTap` 的 `!exp` 分支） |

设计取舍：

- **N205 用的是「首次输入才开打」而不是「延迟 2–3 s 刷怪」**。首波敌人出生点本来就在 `y≈1030–1200`（玩家 `y≈380`），走近约需 6 s —— 单纯延迟几秒并不能覆盖「读完三行提示」的十几秒，只有把核心推进本身挂起才真正消掉教学窗口的死亡。挂在 `!save.combatHintDone` 上：提示出现 = 教学期，教学期就冻结，直到玩家给出输入；学到之后不再出现、也不再冻结。
- **N206 没有改成全局属性加成**。设施 Lv1 的既有语义是「解锁一个花钱的入口」，加永久属性会动战斗数值与 balance 闸的基线；免费券给的是「升级当下就能执行一次的动作」，且只影响一次经济行为。券数上限 9、旧档回落 0，坏档不会刷。
- **N207 只补反馈，没有改节点高亮**。远征失败后地图本来就回到「预览态」，节点亮的是「下一张图能打什么」；真正的问题是「点了没有任何回应」。Toast + 警示色提示把唯一有效入口指出来，不改地图态语义。

---

## 2. 逐条实机证据

### 2.1 N205 教学门（真实进入节点 1）

前置（声明式捷径，见 §4）：把当前档的 `combatHintDone` 置回 false、清掉旧远征后从预览图出发，进层 1 的 `battle` 节点（`id=1`）。

进入后立刻读：

```
_introGate = true
hud._hintActive = true · hud._hintGated = true
hintText = 「先看看操作，动一下或按攻击键就开始
            左半屏拖动移动 · 按住「劈砍」边打边走
            移动会自动朝向最近的敌人 · 远程会后撤」
core.time = 0 · hp = 258/258 · enemies = 1:(190,1030,66) 2:(303,1101,66)
```

**不操作等 3.2 s**：`core.time` 仍 0、敌人坐标与血量逐字段相同、玩家 hp 不变 —— 教学窗口内世界完全静止（截图 `n205-gate-hint.png`）。

按 `A`（页面先点一次画布中心右侧取焦点）：

```
按下后 0.3 s： _introGate = false · _hintGated = false · moveX = -1 · core.time = 0.3
再等 0.9 s：  core.time = 1.2 · 提示第一行已回到「左半屏拖动移动 · 按住「劈砍」边打边走」
```

即：**提示期冻结 → 首次输入同帧解除 → 时间正常推进**，两段都可从探针读出。

### 2.2 N206 首建礼（营地实机，走面板自己的 handler）

前置（声明式）：把档摆成 round41 现场 —— `facilities.smith=0`、`freeReforges=0`、`gold=0`、`materials.ash_dust=2`，`openCamp()`（面板默认落在铁匠铺页）。

| 时点 | 读回 |
|---|---|
| 升级前 | `facilities.smith=0`；升级按钮「升级（灰烬 ×2）」；帮助行「升到 Lv1 就能用：解锁重铸…（建造赠 1 次免费）」；重铸按钮置灰「重铸（需铁匠铺 Lv1）」 |
| 调 `_onUpgradeTap()` 后 | `smith=1`、`freeReforges=1`、`gold=0`；提示行「铁匠铺 升到 Lv1：解锁重铸…（建造赠 1 次免费）」；信息行「重铸费用 **免费（首建礼 ×1）**」；按钮「**重铸 免费 ×1**」；帮助行多一条「首建礼：还有 1 次免费重铸 —— 选一件装备点「重铸」就能用掉，不花金币。」 |
| 调 `_onReforgeTap()` 后 | 词条 `crit,haste,mastery,vers → vers,mastery,crit,haste`；`gold` 仍 **0**；`freeReforges=0`；提示「重铸完成：暴击→全能、急速→精通、精通→暴击、全能→急速（用掉 1 次免费重铸，剩 0 次）」；按钮回到「重铸 184 金」，帮助行的首建礼一条消失 |

截图 `n206-free-reforge.png`（取景时把券补回 1 张重绘，仅用于展示「免费 ×1」态；判定用的是上面的读数）。

### 2.3 N207 阵亡后点节点（走阵亡结算同一函数）

前置（声明式）：不真等被打死，直接 `_commitCombatExit()` → `_enterMapMode()` → `_expeditionDown('测试：补给耗尽，倒在了路上', [])`，关掉「远征失败」弹窗。

```
save.expedition = null · 主按钮 = 「开始远征」
底部提示行 = 「本次远征已结束：先点下方「开始远征」再出发」（警告色 e8b04b）
点节点 1 之后：Toast 节点出现并 active，文本与提示行同句
```

对照修复前：同一动作只改底部小字、无 Toast（round41 §1 的「点了没反应」）。

---

## 3. 闸门与冒烟

| 项 | 结果 |
|---|---|
| `tsc --noEmit`（编辑器自带 5.8.2） | **TS_OK** |
| `verify-mithril-camp` | **355/355**（新增 §6b 首建礼 15 项：赠 1 次 / 再升不赠 / 0 金可铸 / 券消耗 / 其它设施不赠 / 坏档夹取 / 往返保留） |
| `verify-mithril-core` | 245/245 |
| `verify-mithril-wild` | 2975/2975 |
| `verify-mithril-dungeons` | 892/892 |
| `verify-mithril-newplayer` | 123/123 |
| `verify-mithril-balance` | 139/139 |
| `verify-template-core` | 15/15 |
| `check-game-icons` | 25 款全覆盖 |
| 浏览器控制台 | **0 error**（2 warning 为引擎弃用告警，与项目代码无关） |

---

## 4. 覆盖声明

**捷径 / 非纯净路径（逐条标是否影响判定）**

1. **N205 用 `combatHintDone=false` + 清远征重开** 来复现「首战提示」场景（真实首战需要清档并重走职业选择）。判定依赖的是 `!save.combatHintDone` 这一条入口条件，与存档是否为全新无关 —— **不影响**「提示期是否冻结」的判定。
2. **进节点用 `g.onWildNodeTap(nodeId)`**（游戏自己的节点点击入口），不经指针层 —— 不影响 N205。
3. **N206 用面板自己的 `_onUpgradeTap()` / `_onReforgeTap()`**，不点画布按钮 —— 判定的是升级语义与券的扣减，**不覆盖**「从底栏点进营地 → 点升级按钮」的点击链路（该链路本拍未测）。
4. **N206 的档是临时摆出来的**（铁匠铺 0 级 / 金币 0 / 灰烬 2），验证后未落盘，整档从桥恢复。
5. **N207 不真等阵亡**，直接调用阵亡结算用的 `_expeditionDown(...)` —— 与真实死亡路径共用同一函数（`save.expedition=null` + 换图 + 落盘），**不影响**「无远征时点节点是否有回应」的判定；「远征失败」弹窗的正文另有 round41 真实截图。
6. **截图取景**：N206 截图前把券补回 1 张并 `refresh()`，只影响那一张图。
7. **存档**：所有验证结束后用 `addInitScript` + `sessionStorage` 一次性 guard + 同步 XHR 从本地桥恢复，见 §5。

**到达**：路线图 → 层 1 战斗节点（教学门开 / 冻结 3.2 s / 按键解除）→ 远征失败结算（无远征态）→ 点节点 Toast → 营地铁匠铺（Lv0→1 / 券消耗 / 重铸完成）。

**未到达**：本轮不是试玩拍，未走完整旅程；副本 / BOSS / 篝火 / 宝箱 / 其它四设施 / 微信真机 / 触屏拖拽未覆盖。E 分未测。

---

## 5. 存档往返

- 拍前（= round41 恢复后的纯净快照）：len **1813**，sha256 **b381ab617d1bec0ca3fbc87ea91ed302a1ae480382c6a751f482d82fcebee769**
- 验证期间存档被真实改写（进战斗扣补给 / HP、营地升级、重铸）
- 恢复后复核：len **1813**，sha256 **b381ab61…bee769**（逐字节一致，`guard=1`）
- 旧档兼容：`freeReforges` 缺失 → `sanitizeSave` 回落 0（round42 前所有存档均为旧档，读回 smith=3 / gold=5010 已实测）

---

## 6. 停止原因：`budget`（修复批完成，已派 fresh 独立复核）

- 按 round41 问题表处理完 3 条；
- 协议判定：本批改了玩法（教学门冻结世界）+ 数值经济（免费重铸券）+ 跨系统 3 条 → **必须复核**，已派 fresh 复核者，裁决见台账 §8；
- 下一拍 = **round43 fresh 玩法拍**（旅程脚本 v1 重测 E1–E4，重点回访 N205 首战教学门 / N206 首建礼 / N207 阵亡后重开）。
