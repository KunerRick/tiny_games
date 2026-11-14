# 第七轮试玩报告（2026-11-13）

> 角色：玩家 / QA。开发方已把第六轮报告（N19–N24）的修复提交（`0f7d5d4`），
> 本轮：① 复验这 6 项；② 重点深挖「冰箱底下」（完整通关一局 + 每日挑战 / 热度模式 / 续局）；
> ③ 记录新问题。
>
> **结论：第六轮 6 项修复全部成立（§2）。冰箱深层试玩发现 2 个 P2 + 3 个 P3（§3），
> 并排除 1 个疑点（§3.3）。**

---

## 1. 方法与范围

- 预览 `http://127.0.0.1:7456/`，视口 390×844（设计分辨率 720×1280，dpr=1）。
- 当前仓库 `develop` 工作区干净（修复已提交），本轮**未改任何代码 / 场景 / 预制体**。
- 交互一律派发真实 `mousedown`/`mouseup` / `mousemove` 到 canvas；坐标按
  「设计坐标 → CSS letterbox 换算」现场计算：
  `cssX = rect.left + vp.x + designX * sc`、
  `cssY = rect.top + vp.y + (1280 − designY) * sc`
  （实测 canvas rect ≈ 393×796，`vp.y ≈ 49`，`sc ≈ 0.5458`）。
- 状态用页内探针读回（组件私有字段 `_core` / `_w`、Label 世界坐标、localStorage），
  不只看截图。
- 覆盖：雷霆战机、泡泡龙、冰箱底下（完整一局 + 每日 + 热度 + 续局 + 菜单三视图）。

## 2. 第六轮修复复验（全部成立）

| # | 项 | 结论 | 本轮证据 |
|---|---|---|---|
| N19 | 雷霆「暂停→退出本关」白拿 30 金币 | ✅ 成立 | 真实点击：金币 255 进关 → 暂停 → 退出 → 结算标题「已退出本关」、副标题「主动退出 · 不计失败保底」、本局金币 +0、累计金币 255；localStorage 仍是 255。代码 `ThunderGame.ts:793-800` 用 `_quitByPlayer` 把保底置 0 |
| N20 | 锁定关卡点击无反馈 | ✅ 成立 | 泡泡龙：点「选择关卡」→ 点灰掉的第 10 关 → 底部 toast「通关第 9 关解锁」出现。推箱子同样改法（`SokobanGame.ts:719`，本轮只读代码，未重复点） |
| N21 | 放置小店离线遮罩 215 | ✅ 成立 | `IdleGame.ts:497` 已改为 `toColor(UI.overlay, 235)` |
| N22 | 接龙通关面板缺「返回大厅」 | ✅ 成立（代码） | `SolitaireGame.ts:384-392 / 563` 已补按钮并排到「再来一局」右侧；本轮未重玩整局接龙 |
| N23 | 雷霆「生命 ×N」脱离战斗仍常驻 | ✅ 成立（代码） | `ThunderGame.ts:635 / 643` 已把 `_livesLabel` 纳入 `_showBattleChrome` / `_hideBattleChrome` |
| N24 | 雷霆结算遮罩 232 | ✅ 成立 | 结算遮罩 `ThunderGame.ts:821` 已是 235 |

## 3. 冰箱底下深挖

### 3.1 完整一局（第 1 层中途 → 通关）

- 清过秘密房：炸弹炸墙后 `magnets +2`，中心掉落 1 件道具 + 3 枚金币。
- Boss 核心：第 1 层护盾、第 2 层过热、第 3 层贪婪；第 4 层（最终 Boss）打完**不再给核心**，符合
  `FridgeCore.ts:246` 的 `w.floor < 4` 守卫。
- 楼层过渡：护盾 +1，金币 / 冰箱贴 / 道具 / 核心都带入；血量按道具推导的上限重置。
- 商店：买下 / 售罄后不可重复买 / 买不起都走 toast（`FridgeGame.ts:522-542`：`买下：…（−N 币）` /
  `这个已经卖掉了` / `金币不够`）。本轮复核了 toast 的层级与遮罩范围：toast 在顶部
  （设计 y≈1140），商店遮罩只到 y≈1130，字基本露在遮罩上方，**第六轮记录的「买不起没反馈」未复现**
  （当时很可能是 toast 2.4s 已过期后才读回）；祭坛：献祭扣 1 心、不献祭可直接离开。
- 主动技能「糖浆冲刺」：充能 3→0，位移约 120px，0.3s 无敌。
- 最终 Boss「压缩机」460 HP；胜利结算：标题、`976s / 5680 / 80 击杀`、新纪录行、冰箱贴 +54、
  图鉴新增与解锁列表；点空白处回主菜单；meta 落盘（wins 1、charClears ['pudding']、
  maxClearedFloor 4、unlocks 5、best 5680）。
- 菜单在胜利后没有残留 HUD 标签（截图与 `activeInHierarchy` 双重确认）。

### 3.2 新发现

#### N25（P2，建议优先）每日挑战不是固定种子，而是每次开新局随机；还能反复重开换地牢

**复现（同一台机器、同一天、两次真实点击）**：

1. 菜单点「每日挑战」→ 开局，读回 `{ mode: 'daily', charId: 'yogurt', seed: 1407747006 }`；
2. 退出场景再点「每日挑战」→ `{ mode: 'daily', charId: 'yogurt', seed: 1407870232 }`；
3. 第三次（热度模式对照）种子又变成 `1407930573`。

**代码原因**：

- `FridgeGame.ts:195`：`const seed = this.seed || (Date.now() % 2147483647);` —— 没有任何按日期派生的分支；
- 菜单 `_emitStart()`（`FridgeMenu.ts:461-468`）只传 `charId / mode / startFloor / heatCurses`，
  **不传 seed**；
- 解锁树对「每日挑战」的承诺是「**固定种子** + 固定角色，每天一次」（`FridgeConfig.ts:626`）；
- 现成的 `dailySeed(dateKey)`（`FridgeConfig.ts:686`）只被自检脚本 `tools/verify-fridge-core.js:1197`
  调用，游戏代码从未使用（全仓 grep 仅此一处）。

**实际影响**：

- 「每日」只剩固定角色，地牢每次重开都不同，想凹开局可以反复重开；
- `startNewRun()` 第一行 `discardRun()` 会**静默丢弃进行中的每日存档**：实测第二次点每日挑战后
  `tiny_games_fridge_run` 的 seed 从 1407747006 变成 1407870232，没有任何确认或提示。

**建议**：在 `startNewRun()` 内统一派生 ——
`const seed = this.seed || (opts.mode === 'daily' ? dailySeed(dailyDateKey(new Date())) : Date.now() % 2147483647);`，
并补一条自检断言「同一天两次 daily 开局 seed 相同」。重开覆盖存档可另行加一句确认。

#### N26（P2）菜单提示 `_tip` 只在主视图渲染 —— 角色 / 解锁树里的购买反馈全部不可见

**复现（真实点击）**：

- 解锁树里点「角色 · 冰块」：冰箱贴 `61 → 21`，只有该行文字变成「已解锁」；
  预期中的「已解锁：角色 · 冰块」**没有出现在任何位置**。
- 买不起时（`FridgeMenu.ts:620` / `FridgeGame.ts:249-250` 设置 `还差 X 贴` / `还需要 X 个冰箱贴`）同样看不到。

**代码原因**：

- `_tip` 唯一的渲染点在 `FridgeMenu._renderMain()`（`FridgeMenu.ts:259`），对应标签 `MenuTip`
  也只在主视图创建（`FridgeMenu.ts:392`）；
- 角色视图（`onCharCardTouch`，`FridgeMenu.ts:512-533`）和解锁树（`onUnlockRowTouch`，`603-625`）
  都会改 `_tip`，但这两个视图没有对应标签，`setTip()` 还会触发一次渲染，等于白做；
- 失败路径也在这些视图里：`FridgeGame.buyUnlock()` 的 `还需要…` / `已解锁：…`
  （`FridgeGame.ts:249-261`）只在主视图可见。

**建议**：把提示标签挂到 `MenuRoot` 根上（所有视图共享），或每个视图各放一行；
成功购买也可以复用 `FridgeHud.showToast` 的样式。解锁树现在「点一下直接扣钱」，
没有二次确认也没有反馈，加速冲解锁时容易误触。

#### N27（P3）宝箱「换一批」按钮用过不更新，第二次点击静默无响应

**复现（两次）**：宝箱三选一 → 点「换一批（2 金币）」→ 卡片刷新、扣 2 金币；按钮文案**仍是**
「换一批（2 金币）」；再点一次没有任何反应（不扣钱、不刷新、无提示）。

**代码原因**：

- 按钮文案只在构建时写一次（`FridgeHud.ts:906`）；`_refreshTreasure()` 的 key 已经包含
  `rerolled` 标记（`FridgeHud.ts:932`），但只刷新三张卡，没碰按钮；
- `FridgeGame.onTreasureReroll()`（`FridgeGame.ts:661-668`）对 `rerollTreasure()` 返回 false
  不做任何处理。

**建议**：`rerolled` 后把按钮置灰、文案改「已换过」，或至少 toast「每层只能换一次」。

#### N28（P3）图鉴集齐 30 件会写入一个界面上不存在的 `collector` 解锁

**现象**：`evaluateUnlocks()` 在 `seenItems ≥ 30` 时 `add('collector')`（`FridgeConfig.ts:764`，
注释写着「占位」）。但 `UNLOCK_NODES` 里没有 `collector`（`FridgeConfig.ts:616-633`），
解锁树只按 `UNLOCK_NODES` 渲染（`FridgeMenu.ts:590-608`），所以它永远不显示；
结算的「新解锁」行会走兜底把**原始 id** 打出来（`FridgeGame.ts:341-345` 的 `n ? n.name : id`），
玩家会看到「新解锁：collector」。该 id 还会永久写进 `meta.unlocks`（`FridgeGame.ts:296-298`）。

**建议**：在节点补齐前不要写入 `meta.unlocks`（或给 `collector` 补一条节点与描述）；
同时给解锁名加兜底过滤，别把内部 id 直接展示给玩家。

#### N29（P3）道具栏文案与场景提示自相矛盾

**现象**：同一帧里 HUD 显示

- `道具：无（清房后回中心拾取）`（`FridgeHud.ts:377-394`，`items.length === 0` 且当前有地图时固定这句）
- `本房间已清空 · 走到门口进入下一个房间`

房间已经清空、中心也没有可拾取物，却提示「清房后回中心拾取」，容易让玩家在原地找东西。

**建议**：空道具时只写「道具：无」；「回中心拾取」只在当前房间确实有未拾取掉落时拼接。

### 3.3 已排除的疑点（不计入缺陷）

第六轮观察到「第 4 层房间 (5,3) 刚进门 `cleared: true` 且零敌人」。本轮核对代码：
`_changeRoom()` 对**首次进入的宝箱 / 商店 / 祭坛 / 秘密房**会直接 `room.cleared = true`
（`FridgeCore.ts:826-872`），这些房间本来就不刷怪。因此该现象与「特殊房首次进入」一致，
**判定为非缺陷，撤销上一轮挂起的观察**。

## 4. 冰箱底下其它验证（通过）

| 模块 | 证据 |
|---|---|
| 每日挑战 | 角色按日期固定（`yogurt`），每日记录 / 「每天一次」逻辑正常；**种子问题见 N25** |
| 热度模式 | 3 诅咒 `fast / noshot / halfhp` 生效；maxHp 6；因已解锁电梯从第 2 层开始；磁铁 +50% 结算路径在 `core.magnetReward()` |
| 续局 | 中途点右上返回键 → Lobby，`tiny_games_fridge_run` 保留；重进「继续上局」完整恢复 `mode=heat / seed=1407930573 / floor=2 / roomId=0 / hp=6/6 / 3 诅咒`，菜单自动关闭、`phase=playing` |
| 返回键 | 战斗中 `BackButton (660,1236)` 可回 Lobby（注意与其它游戏左上角位置不同） |
| 菜单 | `继续上局` 仅在存在可续存档时出现（设计坐标 `(360,870)`）；主视图 11 个标签位置与截图一致 |
| 商店 / 祭坛 / 核心 / 主动技能 / 胜利结算 | 见 §3.1 |

## 5. 方法与数据说明

- **探针坑**：`labels()` 会把 `active === false` 的 Label 也读出来。判断「菜单上是否残留 HUD」
  必须以 `activeInHierarchy` + 截图为准，否则会把隐藏节点误报成残留。
- **探针坑**：冰箱的房间对象字段是 `roomId`（不是 `room`）；地图房间是普通对象
  （`id/x/y/kind/depth/doors/cleared/visited`），不要当类实例调方法。
- **HUD 不在 GameRoot 下**：`FridgeHud` 挂在 `Canvas` 上，`GameRoot.getComponent('FridgeHud')`
  返回 null，要遍历场景按 `constructor.name` 找。
- **进门位置**：从某房间的**左门**进入，落点是 `x = −188`（`ARENA_MIN_X + 40`），不是 +213；
  每换房后重新读一次玩家坐标再规划点击。
- **门半宽 48**：走出门需要让玩家中心落在门口中线附近（实测偏 30px 内即可）。
- **自动瞄准射程 340**：离敌人太远时子弹不发射，表现为「敌人血量不变」；先靠近再判定是否 bug。
- **手势**：摇杆用 `mousedown → mousemove（40ms）→ 保持 → mouseup` 驱动；桌面拖拽结束派发的是
  `TOUCH_CANCEL`，不是 `TOUCH_END`。
- **测试数据污染**（localStorage，未提交）：
  `tiny_games_fridge_meta`（magnets 21、unlocks 含 `char_icecube`、runs 8 / wins 1 / bestFloor 4 / best 5680、seenItems 6）、
  `tiny_games_fridge_run`（heat 进行中，seed 1407930573，floor 2，hp 6/6）、
  `tiny_games_thunder_*`（金币 255，第 1 关最高分 1234）、
  `tiny_games_bubble_*` / `tiny_games_sokoban_*`（maxLevel 2）。
  还原：清对应键 + 整页 reload（活着的场景会把旧值写回，只清 storage 不 reload 会得出错误结论）。

## 6. 优先级汇总

| 级别 | 编号 | 一句话 |
|---|---|---|
| P2 | N25 | 每日挑战未使用 `dailySeed()`，每次重开随机地牢；重开还会静默丢弃进行中存档 |
| P2 | N26 | 菜单 `_tip` 只在主视图渲染，角色 / 解锁树的购买成功与买不起提示全部不可见 |
| P3 | N27 | 宝箱「换一批」用过不置灰、文案不更新，第二次点击静默无响应 |
| P3 | N28 | `collector` 是界面不存在的解锁，结算会直接显示内部 id |
| P3 | N29 | 道具栏「清房后回中心拾取」与本房间已清空提示矛盾 |
