# 《秘银远征》round42 修复批 · fresh 独立复核

- 日期：2026-11-19
- 角色：**fresh 独立复核者**（不是开发者；结论只来自本轮自取的证据）
- 复核对象：[`2026-11-19-playtest-round42-gameplay-mithril.md`](./2026-11-19-playtest-round42-gameplay-mithril.md)（N205 / N206 / N207）
- 上游证据：[round41 fresh 玩法拍](./2026-11-19-playtest-round41-gameplay-mithril.md)；台账 [`playtest-ledger-mithril.md`](./playtest-ledger-mithril.md) §3.2
- 环境：预览 `http://127.0.0.1:7456/`；存档桥 `http://127.0.0.1:8799/`；视口 1280×720，canvas 393×679，dpr = 1；坐标按 `cam.worldToScreen` 反解（本轮 k = 1，现场标定）
- 一句话结论：**3/3 CONFIRMED**（N205 P2 / N206 P3 / N207 P3 均维持原级，建议 `verified`）；附加复核 N193（台账待 fresh 签字）**CONFIRMED**；存档逐字节还原；新发现 1 条（只描述，不自编号）

---

## 1. 逐条裁决

| 条目 | 裁决 | 级别建议 | 一句话证据 |
|---|---|---|---|
| **N205** 首战教学门 | **CONFIRMED** | 维持 **P2** → 建议 `verified` | 进节点后 `core.time` 恒 0、敌人坐标 / 血量与玩家 HP 逐字段不变（实等 3.2 s）；真实键 A / 按住 J 均**同帧**解除并恢复推进；`combatHintDone=true` 时不再上锁；`_enterMapMode` 清锁；暂停 / 继续不破锁 |
| **N206** 首建礼免费重铸券 | **CONFIRMED** | 维持 **P3** → 建议 `verified` | 真实点击链（营地→铁匠铺→升级→重铸）成功：`smith=1 / freeReforges=1 / gold=0` → 重铸后 `free=0、gold 仍 0`、按钮回「重铸 184 金」；1→2 不赠、其它四设施不赠、失败分支不扣券、`toInt` 夹取 0..9 七组边界全对 |
| **N207** 阵亡后点节点有回应 | **CONFIRMED** | 维持 **P3** → 建议 `verified` | 无远征时点任意节点：Toast 文本与底部提示行**同句**「本次远征已结束：先点下方「开始远征」再出发」，提示行为警示色 `e8b04b`；N174 不可达 / 已清理 / 可达进战三种对照均未被连带改坏 |
| N193（附加，台账 `fixed-pending-review`） | **CONFIRMED** | 维持 **P2** → 建议 `verified` | 真实点击 `TalentCell_warrior_steel_t2_0`：`TalentCardToast` 出现在**被点卡片同坐标** (200,718)，文案「第 2 层需要本线已有 5 点」，底部 `_hintLabel` 同文案双通道；`talents` 未变 |

---

## 2. 逐条证据

### 2.1 N205 首战教学门

**代码级**

- `MithrilGame.update()` 在 `this._buildInput()` 之后新增：
  ```ts
  if (this._introGate) {
      if (!this._hasInputIntent()) { this._acc = 0; return; }
      this._introGate = false;
      this._hudRef?.releaseCombatHintGate();
  }
  ```
  冻结靠 `return` 跳过后续核心推进，并把 `_acc` 归零（不会补帧爆发）。
- `_hasInputIntent()` 覆盖 `moveX / moveY / basic / skill1 / skill2 / skill3 / burst / dodge` 八路输入，无遗漏键位。
- 上锁点**唯一**：`_beginNodeCombat` 尾部 `if (hud && !save.combatHintDone) { hud.showCombatHint(true); this._introGate = true; }`；`_enterMapMode()` 显式 `_introGate = false`。
- `MithrilHud`：`_hintGated` 控制首行文案「先看看操作，动一下或按攻击键就开始」，`releaseCombatHintGate()` 清标记并 `_refreshHintText()` 回常规三行；`hideCombatHint()` 同时清 gated。

**实机级**

| 时点 | 读回 |
|---|---|
| 进入节点 1（battle） | `_introGate=true` · `_hintGated=true` · 首行 = gated 文案；`core.time=0` · 玩家 HP **258/258** · 敌人 1:(190,1030,66) 2:(303,1101,66) |
| **不操作等 3.2 s** | 上述四个字段**逐字段相同**（时间仍 0、敌人坐标 / 血量、玩家 HP 全不变） |
| 真实按 `A`（先点画布取焦点） | **同帧** `_introGate=false`、`_hintGated=false`；随后 `core.time` 正常推进，首行回「左半屏拖动移动 · 按住「劈砍」边打边走」 |
| **按住普攻键 `J` 不放**（专项） | `_keys=[74]`、`basic=true`、`_introGate=false` —— 按住攻击键即解除，不需要先移动 |
| 解除后继续跑 | `core.time` 8.1→8.9、HP 250→246；**未再次上锁**（不存在「松手又冻」） |
| 暂停 / 继续 | 打开暂停面板再关闭，`_introGate` 与 `_hintGated` 状态不变 |
| `combatHintDone=true` 后再进战斗 | 无门：500 ms 后 `core.time=0.52`，世界照常推进 |
| 退回地图 `_enterMapMode` | `_introGate=false`（无残留锁） |

截图：`docs/assets/2026-11-19-mithril-round42r/r42r-n205-gate-hint.png`（gated 首行 + 敌我同屏，血量未掉）。

**未覆盖的边界**：真实触屏拖动 / 微信真机的手势解除路径未测（见 §6）。

### 2.2 N206 首建礼免费重铸券

**代码级**

- 赠券条件精确：`if (id === 'smith' && check.nextLevel === 1)`，上限 `Math.min(9, …)`；`freeReforgeCount()` 做 `max(0, floor(x||0))` 读侧兜底。
- `MithrilProgress.sanitizeSave`：`out.freeReforges = toInt(src.freeReforges, 0, 9, 0)` —— 与 `toInt(value, min, max, fallback)` 签名逐参对齐（已对照同文件其它 `toInt` 调用）。
- `canReforge` 报价：`gold = freeReforgeCount(save) > 0 ? 0 : reforgeGold(...)`。
- `reforge` 扣券位置在**所有失败 return 之后**、金币扣减之后：`if ((check.cost.gold || 0) <= 0 && freeReforgeCount(save) > 0) save.freeReforges -= 1` —— 失败 / 金币分支不会误扣。
- 面板四处显示：信息行 `reforgeCostLine`、按钮 `reforgeBtnText`、帮助行（有券时高度 72→96、y −212→−224）、完成提示；`_changed()` 统一 `refresh()`。

**实机级**

| 时点 | 读回 |
|---|---|
| 升级前 | `smith=0`、`freeReforges=0`、`gold=0`；按钮「升级（灰烬 ×2）」；重铸按钮置灰「重铸（需铁匠铺 Lv1）」；帮助行含「建造赠 1 次免费」 |
| **真实点击**「升级」后 | `smith=1`、`freeReforges=1`、`gold=0`；按钮变「**重铸 免费 ×1**」；信息行「免费（首建礼 ×1）」；帮助行多一条首建礼说明（布局无压盖，见截图） |
| **真实点击**「重铸」后 | 词条重roll成功；`freeReforges=0`、`gold` 仍 **0**；按钮回「重铸 184 金」；帮助行首建礼一条消失 |
| 券耗尽瞬间 | 四处显示同帧回到金币口径，无残留「免费」字样 |
| smith 1→2（再升级） | `freeReforges` 保持 0（不再赠送） |
| 失败分支（全部词条锁定） | 返回失败提示，`freeReforges` 不变（1→1），未扣券 |
| 金币分支（无券、gold=1000） | 重铸后 `gold=816`（= 扣 184），券保持 0 |
| 旧档兼容 | 恢复的纯净旧档读回 `freeReforges=0`、`smith=3`、`gold=5010`，行为与改动前一致 |

**独立矩阵（编译后的纯逻辑模块，非开发者脚本结论）**

- `sanitizeSave` 七组：字段缺失→0、99→9、−3→0、`"5"`→5、4.7→4、`null`→0、`"abc"`→0。
- 赠券矩阵：仅 `smith` 0→1 赠；`smith` 1→2 不赠；附魔台 / 训练场 / 厨房 / 军需官 0→1 均不赠。

截图：`r42r-n206-before-upgrade.png`（Lv0/5、灰烬 2、重铸灰）、`r42r-n206-free-ticket.png`（「重铸 免费 ×1」+ 首建礼帮助行，按钮与帮助行无重叠）。

### 2.3 N207 阵亡后点节点有回应

**代码级**

- `onWildNodeTap` 的 `!exp` 分支：`GameUIKit.toast(this.node, '本次远征已结束：先点下方「开始远征」再出发', 1.8)` + `this._refreshMap(同文案, true)`（`warn=true`）。
- 未改节点高亮 / 可达性判定：原来的「预览态高亮」语义保留。

**实机级**

| 场景 | 读回 |
|---|---|
| 无远征，点节点 1 | `hint = 「本次远征已结束：先点下方「开始远征」再出发」`；Toast 列表**同句**；hint 颜色 `e8b04b`（警示色） |
| 对照：远征中击不可达节点 | 仍是 N174 原文「这个节点走不到：只能点金色高亮圈连着的相邻节点…」 |
| 对照：点已清理节点 | 仍是「已清理」提示（颜色 `b9ab8b`），文案未被覆盖 |
| 对照：点可达节点 | 正常进入战斗（未被 N207 分支误吞） |
| 高亮语义 | 未变：预览态亮圈照旧 |

截图：`r42r-n207-toast.png`（底部警示色提示行同句；Toast 为 1.8 s 瞬态，截图时已淡出，Toast 存在性与文本由探针读回）。

### 2.4 附加：N193（台账待 fresh 签字）

真实鼠标点击（非内部调用）`TalentCell_warrior_steel_t2_0`（CSS 555.1, 339.4）：

- `TalentCardToast` `activeInHierarchy=true`，世界坐标 **(200,718)** 与被点卡片**同坐标**，文本「第 2 层需要本线已有 5 点」；
- 底部 `_hintLabel` 同文案（双通道保留）；
- `save.talents` 保持 `"{}"`，未误加点。

截图：`r42r-n193-talent-toast.png`（toast 直接压在被点卡片上，红描边可辨）。

---

## 3. 闸门（全部实跑，退出码 0）

| 闸门 | 结果 |
|---|---|
| `tsc --noEmit`（编辑器自带 5.8.2） | **TS_OK** |
| `verify-mithril-camp` | **355/355** `MITHRIL_CAMP_OK` |
| `verify-mithril-core` | **245/245** |
| `verify-mithril-wild` | **2975/2975** |
| `verify-mithril-dungeons` | **892/892** |
| `verify-mithril-newplayer` | **123/123** |
| `verify-mithril-balance` | **139/139** |
| `verify-template-core` | **15/15** |
| `check-game-icons` | **25 款全覆盖** |

**改坏自测（仅临时，已还原）**

- 把赠券条件 `check.nextLevel === 1` 改成 `>= 1` 后重跑 `verify-mithril-camp`：**转红，3 条失败** ——「后续升级不再赠送 期望 1 实际 2」「券被消耗 期望 0 实际 1」「没券后恢复金币校验 期望 no-gold 实际 空」。
- 还原后复跑：**355/355 通过**；`git diff --stat` 为空；`git status --short` 仅剩拍前就存在的 `settings/v2/packages/information.json`（M）与未跟踪的 `tools/package-private-keys/`，**复核未留任何改动**。

---

## 4. 冒烟

- 浏览器 console：全流程 **0 error / 2 warning**（引擎弃用类告警，与项目代码无关）。
- 场景切换：恢复存档后 `Lobby → Mithril` 均正常加载（`Mithril` 场景 mode=`map`），返回后存档仍 1813 / 同 sha。
- reload：恢复后整页 reload 直接落在地图态，`_save` 可读、无空引用报错。

---

## 5. 存档往返

| 时点 | 长度 | sha256 |
|---|---|---|
| 拍前纯净快照（桥） | 1813 | `b381ab617d1bec0ca3fbc87ea91ed302a1ae480382c6a751f482d82fcebee769` |
| 验证期间 | 被真实改写（进战斗、升级、重铸、场景切换） | — |
| 恢复后读回 | **1813** | **`b381ab61…bee769`（逐字节一致）** |
| 场景切换 + 天赋面板开关后 | 1813 | 同 sha（未漂移） |

恢复方式：**reload 之前** `page.addInitScript`（同步 XHR `GET http://127.0.0.1:8799/` → 写 `localStorage['tiny_games_mithril_save']`，`sessionStorage` 一次性 guard=`1`），随后整页 reload；读回 `freeReforges=0 / smith=3 / gold=5010`，旧档回落行为正确。

---

## 6. 覆盖声明

**到达**

- 路线图地图态 → 层 1 战斗节点（教学门：冻结 / A 解除 / J 解除 / 暂停恢复 / 二次进入不再上锁 / 退回地图清锁）；
- 营地铁匠铺（Lv0→1 真实点击赠券、重铸真实点击消耗券、再升级不赠、失败分支、金币分支、券耗尽 UI 同步）；
- 阵亡后无远征态点节点（Toast + 警示提示行）+ 三种对照节点；
- 成长 → 天赋（锁定格真实点击 → 卡片 toast）；
- 大厅 ↔ 秘银远征场景往返、整页 reload。

**未到达 / 未覆盖**

- **完整旅程脚本 v1 未跑**（本轮是复核批，不是试玩拍，E1–E4 未测）；
- 真实触屏拖动 / 微信真机：N205 的「拖动解除」只用键盘验证，触屏手势路径未采样；
- 副本 / 区域 BOSS / 篝火 / 宝箱 / 事件节点 / 其它四设施页 / 重铸成功之外的附魔分解：未覆盖；
- 多视口（1280×720 以外）未重跑。

**声明式捷径（逐条标是否影响判定）**

1. **存档字段在内存中构造**（N205 的 `combatHintDone=false` + 清远征；N206 的 `smith=0 / freeReforges=0 / gold=0 / ash=2`）——判定依赖的正是「入口条件」本身，**不影响**「教学门是否冻结」「赠券 / 扣券语义」的结论；验证后未落盘，整档从桥恢复。
2. **进节点 / 点野外节点用 `g.onWildNodeTap(id)`**（游戏自己的节点点击入口，不经指针层）——N205 / N207 的判定对象是状态机与文案，**不影响**；指针层命中由 N206 / N193 的真实点击覆盖。
3. **N206 失败分支用面板自身 `_onReforgeTap()`** 触发（结果只读状态）——判定的是「失败不扣券」，**不影响**；主链路（升级 / 重铸）走的是真实鼠标点击。
4. **N205 暂停验证调 `_openPause()` / `closePause()`** —— 判定「暂停不破锁」，**不影响**。
5. **N193 用真实鼠标点击**（非 handler 直调），坐标由 `cam.worldToScreen` 反解并现场标定（k=1）。
6. 截图取景：N207 的 Toast 为 1.8 s 瞬态，截图落在淡出后，Toast 存在性以探针为准；N205 截图在冻结期拍摄。

---

## 7. 新发现（只描述，不自编号；编号由主会话分配）

1. **N206 的失败提示在「有免费券」时自相矛盾**：词条全锁时重铸失败提示为「锁定的词条太多了：需要 **331 金**，现有 0 金」，而同屏按钮写「重铸 **免费 ×1**」。根因是 `MithrilCampPanel._onReforgeTap` 的失败提示统一追加 `：需要 ${reforgeGold(...)} 金，现有 ${gold}`，未走 `canReforge` 的「有券即 0 费」口径。免费券存在时这句「需要 331 金」会把玩家劝退。建议失败分支复用 `canReforge` 的报价（券 > 0 时不追加金币句，或写「本次免费，但…」）。
2. （观察，不构成问题）N193 的卡片 toast 覆盖被点卡片下半部约 1.2 s，属瞬态且在玩家视线处，可接受。

---

## 8. 停止原因：`reverify`

- 3/3 主项逐条取证完毕（代码级 + 实机级），另补台账待签字的 N193；
- 全部闸门实跑 exit 0，改坏自测证明 §6b 能拦住回归且已零残留还原；
- 存档逐字节还原（1813 / `b381ab61…bee769`）；
- 无 P0/P1，无回归；新发现 1 条（P3 级文案矛盾，描述性，待主会话定号）。
