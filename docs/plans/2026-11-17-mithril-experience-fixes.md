# 秘银远征 · 体验官报告处理记录（E1–E7）

- 日期：2026-11-17
- 来源：[`2026-11-17-mithril-experience-review.md`](./2026-11-17-mithril-experience-review.md)（P0 = 0，P1 = 1，P2 = 1，P3 = 5）
- 处理范围：报告全部 7 条 + 同类问题排查；不新增玩法，只改引导 / 信息透明度 / 节奏
- 验证：编辑器自带 `tsc --noEmit` 通过；8 个 `tools/verify-mithril-*.js` 全绿（共 5,693 项断言）；**2026-11-17 补做预览实机点击回归**（编辑器 7456 + 真实鼠标事件，见 §3.1）

---

## 1. 结论表

| ID | 级别 | 处理 | 落地位置 |
|----|------|------|----------|
| E1 | P1 | **已修**：首战内嵌引导（学会才关）+ 第一波出生距离拉到 650+ | `MithrilHud.ts`（`showCombatHint` / `_tickCombatHint`）、`MithrilGame.ts`（开战时机）、`MithrilCore.ts`（`_spawnNextEncounter`）、`MithrilProgress.ts`（`combatHintDone`）、`MithrilWildMap.ts`（「?」操作说明） |
| E2 | P2 | **已修**：副本点开先出确认卡（装等 / 阶段 / 首通 / 消耗 / 低装等警告），地图标签改「装等 min-max」 | `MithrilGame.ts`（`_confirmDungeon`）、`MithrilWildMap.ts`（标签 + `showConfirm` 可传按钮色） |
| E3 | P3 | **已修**：营地首档 4 → 3 灰烬；升级按钮显示「现有/所需」，底部提示「再赢 N 场」 | `MithrilConfig.ts`（`FACILITIES`）、`MithrilCampPanel.ts`（按钮文案 / `_defaultHint`） |
| E4 | P3 | **已修**：战斗中返回先开暂停层（继续 / 返回路线图 / 返回大厅 / 音效开关），暂停期间核心冻结 | `MithrilHud.ts`（`_openPause` / `isPaused`）、`MithrilGame.ts`（`onPauseBackToMap`、`update` 冻结） |
| E5 | P3 | **已修**：文案改为「下一场战斗生效（面板数值已按新装备计算）」，饰品同理 | `MithrilMenu.ts`（`HINT_TEXT` / `TRINKET_HINT_TEXT`） |
| E6 | P3 | **已修（按报告可选项）**：非主手物品详情追加「任何职业可穿」；基型名保留美术主题 | `MithrilMenu.ts`（`_refreshDetail`） |
| E7 | P3 | **未能复现**：静态排查所有 `getComponent` 调用均为非空类；顺手加固 `_ensureAudio`；未改引擎调用 | `MithrilGame.ts`（`_ensureAudio`） |

---

## 2. 逐条改动

### E1 首战引导（P1）

- **新增存档位 `combatHintDone`**（`MithrilProgress.ts`）：`defaultSave` 为 `false`，`sanitizeSave` 只接受 `=== true`，旧档读入自然回落 `false`，**不升 `SAVE_VERSION`**。
- **HUD 内嵌提示**（`MithrilHud.showCombatHint()`）：两行文案「按住「劈砍」持续攻击 / 移动会自动朝向最近的敌人」，职业名随 `CLASS_SKILL_NAME.basic` 切换；放在 y=380 的空带（横幅下沿 233、BOSS 条上沿 546、技能键顶部 −316 之间）。
- **关闭条件**：累计 3 击杀或按住普攻 ≥ 1 秒（HUD 刷新节拍 0.1s）；触发后回调 `onCombatHintDone` → 写档。死亡 / 结算只是收掉提示，**不算学会**，下一场开局会再出现，直到真学会。
- **第一波节奏**（`MithrilCore._spawnNextEncounter`）：`encounterIndex === 0` 时出生点改为 y 1030–1200、x 190–530，离玩家 (360,380) 最近约 650 像素（原 460），按小怪 ~105 速度约 6 秒接近；后续波次不变。
- **HUD 键面**（`MithrilHud.ts`）：六个键从单字改为两字职业名（劈砍/冲锋/旋风/破甲/血怒/侧步；法师 奥弹/火球/冰霜/闪现/强化/屏障；游侠 射击/多重/陷阱/后跃/鹰眼/翻滚；牧师 圣光/治疗/神圣/守护/圣能/圣步），字号按两字自动缩小并关掉换行。
- **「?」入口**（`MithrilWildMap._buildHeader`）：地图右上（180, 598，音效键左侧）常驻，弹 6 行操作说明；一次性 toast 文案同步改成「路线图点绿圈启程 · 按住右下最大的键持续攻击 · 右上角「?」可重看操作」（3.4s → 4.2s）。

### E2 副本确认卡与标签（P2）

- `MithrilWildMap._drawNode`：副本节点第二行标签由 `Lv{node.level}` 改为 `装等 {ilvlMin}-{ilvlMax}`（其它节点不变）。
- `MithrilGame._confirmDungeon`：只在「新进入、可达、未通关、非当前未结算节点」时弹出，内容为：
  - 推荐装等区间 + 当前平均装等（`equipStats(save.equips).ilvl`）；
  - 三阶段机制名（`DUNGEONS[*].phases[].name` 串成 `→`）；
  - 首通奖励（经验 / 技能书 / 紫装）或「已通关：无首通奖励」；
  - 低于 `ilvlMin` 时橙色语义的警告文案，并把「进入副本」按钮设为 DANGER 色；
  - 进入消耗（补给 −1 或 8% 生命）与「阵亡丢失本程材料」。
- **扣费时机后移**：确认卡出现前不调用 `enterNode`，点「进入副本」才扣补给 / 生命；`showConfirm` 增加可选 `okFill` 参数（不传仍是原 DANGER 行为）。
- 原有 `onWildNodeTap` 后半段抽成 `_enterWildNode(node, plan)`，非副本节点行为完全不变。

### E3 营地首访（P3）

- `FACILITIES` 五处首档 `ash_dust` 4 → 3；升级曲线其余档位不动。
- `MithrilCampPanel`：材料不足时按钮写「升级到 Lv1 · 灰烬 2/3」；底部提示追加「灰烬 2/3 · 再赢 1 场可升 Lv1」（按每场 2 灰烬保守估）。

### E4 战斗内返回（P3）

- 左上返回键改为打开暂停层（`MithrilHud._openPause`）：遮罩 `BlockInputEvents` + 面板「暂停 / 本节点进度已保留 / 返回路线图后可点白圈接上」+ 继续战斗 / 返回路线图 / 返回大厅 / 音效与震动开关。
- `MithrilGame.update()` 在 `hud.isPaused()` 时整帧返回：核心、计时、输入都不推进；`closePause` 会 `releaseAllHeld()`。
- 结算面板已显示时，返回键保持「直接回大厅」语义（避免在结算上再叠一层暂停）。
- 「返回路线图」走 `onPauseBackToMap`：先 `_persist()` 再 `_enterMapMode()`，地图提示「已退出当前节点：本节点内容还在，点白圈可接上」。

### E5 装备生效口径（P3）

- `HINT_TEXT` → `装备变更将在下一场战斗生效（面板数值已按新装备计算）`；饰品同理；两处字号 17 → 16 防溢出。
- 实际生效点未改：战斗 profile 在 `_beginNodeCombat` 时构建，局内换装仍只影响下一场。

### E6 跨职业命名（P3）

- 物品详情里耐力行追加「· 任何职业可穿」（仅非主手槽位）。
- 不改基型表：名字承担副本首通紫装的职业主题（如「法师兜帽」是教堂首通固定件），全改中性名会丢掉这层识别；报告允许「至少补一句」。

### E7 Error 3804（P3）

- 复现尝试：对 `cc.Node.prototype.getComponent/addComponent` 打计数补丁，重放「进场景 → 选职业 → 路线图 → 首战 → 装备/成长/营地面板技能页 → 死亡结算」全流程，nil 调用 **0 次**，与报告一致，未能复现。
- 静态排查：mithril 全部 10 处 `getComponent` 传入的都是类字面量（`MithrilHud` / `MithrilMenu` / … / `UITransform`），不存在可能为 undefined 的变量；本作也没有动态类型字符串调用。
- 加固：`_ensureAudio` 原来假设「有节点就一定有组件」，改为缺组件时 `addComponent` 补挂，并合并两次 `getChildByName`。
- 结论：维持「偶发、无可见影响」，等下次出现时用 sourcemap 构建抓调用栈；不为此编造根因。

---

## 3. 验证

| 项目 | 结果 |
|------|------|
| `tsc --noEmit`（编辑器自带 5.8.2） | 通过 |
| `verify-mithril-core.js` | 245/245（新增 118b 首波出生距离 ≥ 600） |
| `verify-mithril-balance.js` | 139 项（新增 098a–098c `combatHintDone` 存档回落；050 首档灰烬总需求 70 → 65） |
| `verify-mithril-wild.js` | 2829 项通过 |
| `verify-mithril-camp.js` | 337 项通过 |
| `verify-mithril-dungeons.js` | 892 项通过 |
| `verify-mithril-trinkets.js` | 692 项通过 |
| `verify-mithril-bounty.js` | 471 项通过 |
| `verify-mithril-audio.js` | 88 项通过 |

**首次处理时的限制**：当天 Cocos 编辑器与预览服务未运行、MCP 不可用，UI 改动只过了静态审查与 `tsc`。

### 3.1 预览实机点击回归（2026-11-17 补做）

编辑器启动后（7456 预览 + MCP 3000），用 `project_refresh_assets` 刷新，浏览器加载真实预览页，按节点世界坐标换算成 CSS 坐标派发 `mousedown`/`mouseup`（`MouseEvent`，非 `PointerEvent`），走引擎真实命中与事件分发。逐项结果：

| 检查 | 操作 | 实测 |
|------|------|------|
| 新代码已加载 | `typeof` 探针 | `_confirmDungeon` / `onPauseBackToMap` / `showCombatHint` / `_tickCombatHint` / `isPaused` / `_openPause` 均为 function |
| E1 操作说明入口 | 地图右上「?」 | 弹出 6 行「操作说明」，含「按住右下最大的普攻键 → 持续攻击」「移动会自动朝向最近的敌人」 |
| E1 首战提示 | 进入腐化教堂，HUD 探针 | 提示条 active，文案「按住「劈砍」持续攻击 / 移动会自动朝向最近的敌人」；`combatHintDone=false` |
| E1 学会即关 | 按住普攻键 1.4 秒（真实按住） | 提示消失（`_hintActive=false`、节点 `active=false`），存档 `combatHintDone=true` |
| E1 技能键面 | HUD 文案 | 劈砍 / 冲锋 / 旋风 / 破甲 / 侧步 / 血怒（两字、不折行） |
| E2 副本标签 | 地图节点副标题 | 废弃矿坑「装等 1-10」、腐化教堂「装等 10-16」 |
| E2 确认卡 | 点废弃矿坑 | 出现确认卡：推荐装等 / 当前平均装等 1.0 / 三阶段 / 首通奖励 / 消耗；`hp`、`pos` 未变 |
| E2 取消不扣费 | 点「取消」 | 弹窗关闭，`hp 314`、`pos 11` 保持；未触发 `enterNode` |
| E2 低装等警告 | 点腐化教堂（推荐 10-16，平均 1.0） | 多出「警告：装等低于推荐下限 10，建议先清野外节点」，按钮为 DANGER 红 |
| E2 进入才扣费 | 点「进入副本」 | `hp 314 → 286`（8% 上限 28），`pos → 10`，HUD 开战 |
| E4 暂停层 | 战斗中点左上返回 | 面板「暂停 / 本节点进度已保留 / 返回路线图后可点白圈接上 / 继续战斗 / 返回路线图 / 返回大厅 / 音效与震动：开」 |
| E4 暂停冻结 | 暂停后采样 0.9s | 敌人坐标与玩家 `hp 143.2` 完全不变 |
| E4 继续 | 点「继续战斗」 | `isPaused=false`，0.7s 内 `hp` 掉到 112.6（模拟恢复） |
| E4 音效开关 | 点「音效与震动」 | 开 → 关 → 开，标签即时刷新 |
| E4 返回路线图 | 点「返回路线图」 | 回到地图，`pos 10` 保留，提示「已退出当前节点：本节点内容还在，点白圈可接上」，localStorage 同为 `pos=10` |
| E3 营地首档 | 打开营地 | 按钮「升级到 Lv1（灰烬 ×3）」；灰烬 5 时可升级，无短缺口提示 |
| E3 短缺口提示 | 临时把灰烬改为 1 后 `refresh()` | 按钮「升级到 Lv1 · 灰烬 1/3」，底部「灰烬 1/3 · 再赢 1 场可升 Lv1」 |
| E5 文案 | 打开装备面板 | 「装备变更将在下一场战斗生效（面板数值已按新装备计算）」 |
| E6 跨职业提示 | 点背包里的「史诗·铁盔」 | 详情「耐力 +10（生命 +100） · 任何职业可穿」 |
| E7 回归 | 全程控制台 | 整个会话 0 error、2 条引擎弃用 warning，3804 未复现 |

**边界与清理**：为避免离开游戏场景，暂停层的「返回大厅」只验证了存在与接线，没有真的点（该路径沿用既有 `onExit`，本次未改）。第一波出生距离未在浏览器里量（进的是秘境，非野外首场），由 `verify-mithril-core.js` 的 118b 断言覆盖。回归结束后把临时改动的存档字段（`dungeonsCleared` / `expedition.hp/pos/visited/done` / `ash_dust` / `combatHintDone`）恢复成回归前的值并 `_persist()`，localStorage 已读回核对一致。

---

## 4. 举一反三排查

- **同类一次性提示**：`showTutorialOnce` 在 brick / fridge / template 也有使用，但这些是一次性规则说明（拖动、射击），错过不影响生还；本作的「按住普攻」属于核心操作，才需要「学会才关」的独立存档位。已在 HUD 内实现可复用模式（`showCombatHint` / `onCombatHintDone`），其它动作类游戏若加复合操作可照抄。
- **同类「点即进、无预览」**：`MithrilWildMap` 的副本是唯一有「进入成本 + 固定强度」的节点；宝箱 / 事件 / 篝火本身自带结果弹窗，无需再加确认。
- **同类「文案与即时数值打架」**：全仓搜索「下一局生效」只剩本作两处，已改；成长面板本来写的就是「加点立刻作用于当前这一局」，口径一致。
- **同类「单字技能键」**：仅本作 HUD 使用单字缩写，其它游戏没有技能键面。
- **同类「战斗中返回直接换场景」**：其它动作类（shmup / survivor / vanguard / thunder）都是短局街机，退出即结束本局，没有「节点进度保留」语义，未改；本作因为远征跨节点才需要暂停层。
- **共享组件**：`GameUIKit.showConfirm` 未动；`MithrilWildMap.showConfirm` 新增可选按钮色，向后兼容（「放弃远征」仍为红色）。

---

## 5. 未纳入本次（报告 §8 小建议）

- 死亡面板加「再次远征」按钮（需设计「恢复补给/生命」口径，留给下一轮）。
- 技能键长按浮出全名 / 冷却 / 消耗（两字键面已解决对照问题，长按 tooltip 属增强）。
- 地图底部补给规则更醒目 / 首次远征再提示一次（当前底部规则行 + 补给耗尽警告已在；优先级低）。
- 若后续把 `node.level` 真正接进 `dungeonRunPlan`，可回头删掉确认卡里的「难度与节点等级无关」一句。

---

*处理原则：P1 做「必达 + 可重看」，P2 做「进前可知」，P3 只改信息与文案；不为了关报告而改数值曲线。*
