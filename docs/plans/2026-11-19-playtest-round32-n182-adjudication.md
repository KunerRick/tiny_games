**结论：NOT REPRODUCED → 维持 open P2（等待复现；再复现条件见 §2.6）。**

# 《秘银远征》N182 定向复现裁决报告

- 日期：2026-11-19
- 角色：fresh 独立复核者（裁决者；未参与本轮开发，只读代码与台账，**未修改任何 `.ts` / 台账 / 已有报告**）
- 对象：N182（P2，存档类）——"退出未结算战斗后 `expedition.hp` 疑似被改写为低等级上限 60"
- 环境：Cocos 预览 `http://127.0.0.1:7456/`（编辑器在线，未调用 `project_refresh_assets`——本轮无代码改动）；视口 1280×720，canvas 393×679，dpr 1；`page.mouse.click` 直接用 CSS 坐标（本轮换算值与画面一致，点击全部命中）
- 截图：`docs/assets/2026-11-19-mithril-round32/n182-0*.png`（目录 gitignored）
- 存档：起始快照三键与预期 sha256 逐字一致；结束 `addInitScript` 还原，三键 sha256 两次读数一致（§3.4）；浏览器已 `browser_close`

---

## 1. 结论表

| 检查项 | 结论 | 一句话证据 |
|---|---|---|
| 副本入场消耗（补给 0，上限 96） | **符合预期** | 确认卡逐字"进入消耗：补给已耗尽，生命 −8（8% 上限）"；进入后 `exp.hp` 96→88，`_lastSnapshot` 88/96 |
| 暂停冻结 | **成立** | `_lastSnapshot.time` 两次读数均 `0.3667`（复现 1）/ `21.15`（复现 2），HUD 逐字"Lv 3　生命  88 / 96"、"Lv 3　生命  9 / 96" |
| 返回大厅落盘 | **正确** | 复现 1 磁盘 `exp.hp = 88`（964 B）；复现 2 磁盘 `exp.hp = 9`（972 B），与暂停 HUD 一致（9 为 8.6 取整） |
| reload 后地图血量 | **未被改写** | 复现 1 读回"生命 88/96"、`curHp 88`；复现 2 读回"生命 9/96"、`curHp 9` |
| reload 后 maxHp | **仍是 96（不是 60）** | 两次地图 HUD 分母均为 96；`_save.level = 3` |
| N182 原症状（hp 变 60） | **未复现**（0/2，累计 0/4，见 §2.6） | 四个读数（88/9 + 主报告 208/32）全部与暂停时一致，无任何一次出现 60 |
| 代码判据 | **60 只可能来自 `save.level === 1`** | `maxHpAt(level) = 60 + 18×(level−1)`；`_commitCombatExit` / `_enterMapMode` 均按 `profileFromSave(save).maxHp` 夹取 |

---

## 2. 逐条证据

### 2.1 步骤 1：起始快照（清档前）

`localStorage` 三键与预期逐字一致（清档前读取，见 §3.4 表）：save 1812 B / seen_tutorial 1 B / audio 23 B。快照另存为 `n182-pre-snapshot.json`（2275 B，文件 sha256 `d362241fc108e19dc304b01317be8c061f3974217a923e1e42793c2c765cec3e`）。

### 2.2 Lv3 / 上限 96 的纯净构造（真实输入，无存档注入）

| 项 | 读数 |
|---|---|
| 清档方式 | 同源 404 页停游戏 → `removeItem` 三键 → 回游戏（§3.3-1） |
| 开局 | 真实点击职业卡「以战士开局」，生成 Lv1 新档 |
| 升级 | 真实键盘 WASD 移动 + J 普攻 + K/L/U 技能 + I 爆发，逐个打赢路线图节点，**未装备任何掉落**（8 槽全 null，背包 1 件） |
| 目标状态 | `level 3`、裸装 `maxHp 96`、`supply 0`、`hp 96/96`、`pos 8` |
| 暂停核对 | `_lastSnapshot.time = 0.45` 间隔 1 s 两次一致；HUD 逐字"Lv 3　生命  96 / 96"；墙钟 1795038183429 |
| 截图 | `n182-01-win-lv3.png` |

进入副本前的确认卡（真实点击 node10「腐化教堂」）逐字包含：
`进入消耗：补给已耗尽，生命 −8（8% 上限）`——即 N182 原始场景的精确前置条件。

### 2.3 复现 1：入场 −8 → 暂停 → 返回大厅 → reload

| 环节 | 读数（原始值） |
|---|---|
| 点「进入副本」后 380 ms | `mode=combat`；`expedition {hp:88, pos:10, supply:0, seed:1889205261}`；`_lastSnapshot` `phase=playing, time=0.3667, hp=88, maxHp=96` |
| 暂停（HUD 左上键，真实点击 479.8, 74.3） | `time` 两次读数均 `0.3667`（冻结）；`hp=88, maxHp=96`；`paused=true`；HUD 逐字 **"Lv 3　生命  88 / 96"**；墙钟 `1795038203132` |
| 截图 | `n182-02-paused-88-96.png` |
| 真实点「返回大厅」 | `scene=Lobby`；localStorage `expedition.hp = 88`（save 964 B） |
| 整页 reload（5 s 后读） | `mode=map`, `level=3`, `diskHp=88`, `curHp=88`；地图 HUD 逐字 **"生命 88/96"**；补给耗尽提示两行正常 |
| 截图 | `n182-03-reload-88-96.png` |

**判定**：reload 后 hp（88）= 暂停 HUD 血量（88），maxHp（96）= 暂停时上限（96）。**未出现 60。**

### 2.4 复现 2：同档换一个血量值（排除"恰好等于某默认值"）

为排除"88 恰巧等于某被写入的常量"，在同一远征（seed 1889205261）再进一次同一副本节点：

| 环节 | 读数（原始值） |
|---|---|
| 再挑战入场 | 当前节点直入（游戏自身行为，无确认卡）；补给 0 → 再扣 8：`exp.hp` 88→80 |
| （说明）战斗中段 | 工具往返间隙约 21 s 无人操作，属**真实战斗**（非注入）：imp 接触伤害把生命打到 8.59999999999999 |
| 暂停 | `time` 两次读数均 `21.15`（冻结）；`hp=8.59999999999999, maxHp=96`；HUD 逐字 **"Lv 3　生命  9 / 96"**（8.6 取整）；墙钟 `1795038338176` |
| 返回大厅 | `scene=Lobby`；磁盘 `expedition.hp = 9`（save 972 B，`Math.round(8.6)`） |
| 整页 reload | `mode=map`, `level=3`, `diskHp=9`, `curHp=9`；地图 HUD 逐字 **"生命 9/96"** |
| 截图 | `n182-04-reload-9-96.png` |

**判定**：一个非整数、非上限、非 60 的低血量（9/96）完整穿过"暂停 → 落盘 → reload"，**未被夹到 60、也未被重置为 96**。

### 2.5 代码判据（只读）

- `MithrilProgress.ts:81-82,123-124`：`HP_BASE=60`、`HP_PER_LEVEL=18`，`maxHpAt(level)=60+18×(level−1)`；`maxHpAt(1)=60`、`(2)=78`、`(3)=96`。
- `MithrilCore.ts:198-233`：`profileFromSave` 的 `maxHp = (makeProfile(...).maxHp + 装备 bonusHp) × 料理 × 荆棘`；`makeProfile` 的 `maxHp` 只来自 `maxHpAt(save.level)`（`:184`）。
- `MithrilGame.ts:1528-1539` `_commitCombatExit`：`exp.hp = clamp(round(snap.player.hp), 1, profileFromSave().maxHp)`，随后 `exp.retreat = true`；`exitToLobby`（`:1549-1555`）与 `onGameHide`（`:1557-1566`）都会先提交再 `_persist()`。
- `MithrilGame.ts:303-336` `_enterMapMode`：同样用 `profileFromSave(save).maxHp` 夹一次（防"200/168"）。

即：**在 `save.level === 3` 时，夹取上限是 96，不存在任何把 88/9 变成 60 的代码路径**；60 只能来自 `save.level === 1` 的存档。

### 2.6 为什么仍建议维持 open P2（而不是直接关闭）

1. 原症状（读回 60）来自 round32 复核的一次真实读数，本轮**未能解释它如何产生**；"不能复现"不等于"证明不存在"。
2. 本轮证据边界：两次复现都在**本轮新建的纯净 Lv3 档 + 同一 seed 的远征**上完成；原复核者的存档（`level 3 / gold 36 / pos 9`）在本轮开始时已被后续操作覆盖，**无法在其原始状态下重放**（原始存档快照未按该时刻保留）。
3. 存档类问题的代价是不对称的（丢进度 vs 多查一轮），且 P2 不阻塞流程，保留成本低。
4. **再复现条件（给下一拍）**：若再次读回可疑值，同一时刻抓三样东西——`save.level`、`save.expedition.seed`、`profileFromSave(save).maxHp`；只有 `level===1` 才能解释 60。若在那之前连续两拍仍为阴性，可考虑降为 `watch` 或 `wontfix`（需主会话决定，本报告只给建议）。

---

## 3. 覆盖声明

### 3.1 到达（全部真实输入）

- 清档 → 职业卡开局 → Lv1→Lv3（真实键鼠打赢节点，含一次事件节点「包扎伤口」选点）→ 裸装上限 96 核对 → 补给耗尽（3 次节点进入）→ 副本确认卡 → 进入副本 → HUD 暂停 → 暂停层「返回大厅」→ 整页 reload；同一远征再挑战一次（第二次副本进入 → 暂停 → 退出 → reload）。

### 3.2 未到达 / 不可达

- **未到达**：原复核者 N182 观察时刻的原始存档状态（其快照未在该时刻保留，见 §2.6-2）。
- **不可达本任务目标之外的项**：无（Lv3/96 档已按纯净路径达成，无需降级到更低档）。

### 3.3 声明式捷径（逐项）

1. **清档**：导航到同源 404 页使游戏停止后 `removeItem` 三个 mithril 键，再回游戏；随后**真实点击**职业卡生成纯净新档。仅此一处改动存档开局。
2. **第二次副本进入**：点当前节点（pos 10）时游戏**自身**判定为"再挑战"直入，无确认卡、再扣 8 生命——这是游戏行为，非注入；本轮如实记录。
3. **探针**：只读 `_save` / `_lastSnapshot` / `_hudRef.isPaused()` / `_wildMap.nodes` / Label 文本与坐标换算；未调用任何改状态的方法，未注入金币 / 血量 / 装备 / 战斗结果。
4. **战斗输入**：WASD + J/K/L/U/I，均为游戏内置键位；无自动脚本注入伤害或无敌。
5. **意外但真实的战斗**：复现 2 中约 21 s 无人操作导致生命掉到 8.6——是正常战斗结果，不是捷径；也正因此得到一个非整数血量样本。
6. 结束时用 `addInitScript` 写回快照三键并 reload（§3.4）。

### 3.4 快照还原（结束态）

用 `/tmp/n182-restore-init.js`（由 `n182-pre-snapshot.json` 直接生成 `localStorage.setItem` 字面量）在 reload 前写入三键，reload 后两次（间隔 2.5 s）读回一致：

| 键 | 长度 | sha256（快照 = 恢复后） |
|---|---|---|
| `tiny_games_mithril_save` | 1812 B | `09c10d9137862375180c766bb9219b2718aa63b1a9fda3bf2119a41aad3df86b` |
| `tiny_games_mithril_seen_tutorial` | 1 B | `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b` |
| `tiny_games_mithril_audio` | 23 B | `83913b1253d57423cf0aee23caf2457caa20865344ab8a6719d91c840266cbda` |

游戏读回：`level 2 / gold 5010 / classId warrior / expedition.pos 1 / hp 212`；地图渲染正常（`n182-05-restored.png`）。三键读数间隔 2.5 s 稳定。浏览器已 `browser_close`。

### 3.5 工具与环境

- 控制台 `error` 级 0 条、warning 2 条（引擎 `systemEvent` 弃用类，与改动无关）。
- 未调用 MCP 场景编辑类工具；未修改 `.scene` / `.prefab` / `.ts` / 台账 / 已有报告。
- 本任务期间预览与 MCP 单例只由本会话操作。

---

## 4. 停止原因

`stop_reason = converged`（定向复现任务完成：两档血量、两条链路均阴性，代码判据闭合；无须继续消耗预算）。N182 的台账状态建议为 **维持 open P2**，再复现条件见 §2.6-4；最终状态与级别变更由主会话决定。
