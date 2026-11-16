# 《秘银远征》M8 实施计划（24 悬赏 + 终局循环）

> 日期：2026-11-16 · 分支：`develop` · 前置：M7 已验收（`2026-11-15-mithril-m7-acceptance.md`，`5cd6d9f`）
> 设计规格：`docs/plans/2026-11-14-game-mithril-design.md` §4.6（军需官）/ §14.3（24 条悬赏）/ 里程碑表
> 里程碑原文：`| **M8** | 24 悬赏 + 终局循环 | 一周目 6 小时可通关 |`
> 解锁原文：「悬赏由军需官（营地设施 §4.6）分档解锁：1 级 3 条 → 3 级 6 条 → 4 级每日刷新。」

## 退出判据

| # | 判据 | 验证方式 |
|---|------|---------|
| 1 | 24 条悬赏全部有机器可读的完成条件、目标数与奖励，无占位文案 | `verify-mithril-bounty.js` §1：24 条 / 4 类各 6 条 / id 唯一 / metric 合法 / target>0 / 奖励可发放 |
| 2 | 军需官 Lv1 解锁悬赏板；Lv1 3 位、Lv2 起 6 位、Lv4 每日刷新 | 纯逻辑断言 + 浏览器实点（Lv1/Lv2 两个夹具档） |
| 3 | 18 条自动追踪悬赏由真实战斗/结算驱动；6 条收集悬赏领取时扣除材料或装备 | 每类至少 2 条在脚本里用「合成战斗报告」推进到可领取；收集类断言扣除精确数量 |
| 4 | 领取闭环：金币 / 材料 / 紫装 / 橙装发放，悬赏位自动补位，每日刷新重置未领取进度 | 纯逻辑 + 浏览器实点（领一条 → 金币/背包变化 → 空位补新悬赏） |
| 5 | 存档：新增字段有默认值、坏档净化、旧档可读、真实档往返不丢 | `verify-mithril-bounty.js` §6 + 真实档 `addInitScript` 恢复核对 |
| 6 | 一周目 6 小时可通关（**分段预算**，literal 长跑归 M9） | 见 §「6 小时预算」；M8 只证明各段可完成且合计 ≤ 6 h，M9 用长跑脚本实测 |
| 7 | 浏览器实点 + 第 17 轮试玩 P0/P1 清零 | 实点记录 + `2026-11-16-playtest-round17-mithril-m8.md` |

## 现状盘点（M7 结束时）

- `MithrilConfig.ts` 已有 `BOUNTIES` 24 条（仅 `id/kind/name/reward` 文案）与 `BOUNTY_BY_ID`；**没有**目标数、指标、奖励结构。
- `MithrilProgress.ts` 已有 `bounties: string[]`（默认 `[]`，净化只认字符串 id）；**没有**进度、刷新日、游标。
- `MithrilCamp.ts::bountySlots()` 已实现 3 → Lv2 起 6；`MithrilCampPanel` 军需官页只显示「悬赏位 N 个 / 悬赏任务还没开放」。
- 战斗侧没有可复用的统计：快照只有总 `kills`，没有精英/无伤/低血/10 秒窗口/暴击计数/最后一击来源。
- 分解入口 `MithrilCamp.dismantle()` 已存在，可挂进度钩子。

## 子步骤

### M8.1 悬赏数据与纯逻辑内核

1. 扩展 `BountyDef`：
   ```ts
   export type BountyMetric =
       | 'kill' | 'elite_kill' | 'region_boss' | 'elite_no_hit' | 'kill_5_in_10s' | 'burst_elite_kill'
       | 'dismantle' | 'dungeon_clear' | 'dungeon_nodeath' | 'dungeon_speed' | 'dungeon_last_hit'
       | 'dungeon_white' | 'dungeon_no_trinket' | 'low_hp_kill' | 'dungeon_crit' | 'dungeon_loot'
       | 'full_run' | 'turnin_ash' | 'turnin_frost' | 'turnin_mithril' | 'turnin_blue' | 'turnin_purple';
   ```
   每条补 `metric / target / gold / item? / material? / consume?`。收集类 `consume` 声明领取时扣什么：
   - `turnin_ash/frost/mithril` → 对应材料 × target
   - `turnin_blue/purple` → 背包里对应品质装备 × target（**不碰已装备**）
   - `dismantle` 是自动计数，不是扣除。
2. 新建 `assets/games/game_mithril/scripts/MithrilBounty.ts`（纯逻辑，不 import cc）：
   - `ensureBountyBoard(save, day, slots, allowDaily)`：空位补齐 / Lv4 跨日重置。顺序由 `mulberry32(day)` 洗牌 24 条得到，`bountyCursor` 记录游标；已在本板的 id 跳过。
   - `bountyProgressOf(save, def)`：自动类读 `bountyProgress[id]`；收集类读当前库存（上限 target）。
   - `isBountyReady` / `claimBounty(save, id, rng, ilvl, boardCtx)`：校验 → 扣收集物 → 发金币/材料 → 生成装备（紫/橙）→ 移除并补位；返回结构化结果。
   - `applyRunReport(save, report)`：一场战斗结算后统一推进（见 M8.3）。
   - `advanceBountyMetric(save, metric, amount)`：分解钩子用。
   - `bountyBoardRows(save)`：UI 用的行数据（def / progress / target / ready / 消耗文案）。
3. 存档字段（`MithrilProgress.ts`）：
   ```ts
   bounties: string[];                 // 当前板上的悬赏（≤ 悬赏位）
   bountyProgress: Record<string, number>; // 仅自动类，键必须是板上 id
   bountyDay: number;                  // 上次刷新日（epoch day）
   bountyCursor: number;               // 洗牌序列游标 0..23
   ```
   默认值 + 净化：非法 id / 重复 / 超过 6 位 / 进度越界 / 负日 / 游标越界全部回落。
4. 设计偏差记录：设计 §14.3 写「3 级 6 条」，代码与 §4.6 是「Lv2 起 6」——保持既有可玩性（M5 已验证），在验收文档注明。

### M8.2 战斗统计（Core 只读快照）

`MithrilCore.ts` 增加每局重置的 `BountyStats`（类型放 `MithrilConfig.ts`，避免 Core ↔ Bounty 依赖）：

| 字段 | 含义 | 采集点 |
|------|------|--------|
| `mobKills` | 非精英非 BOSS 击杀 | `_killEnemyAt` |
| `eliteKills` | 精英击杀 | 同上 |
| `bossKills` | BOSS 击杀 | 同上 |
| `eliteNoHitKills` | 精英存活期间玩家未受击 | 敌人加 `spawnTime`；`hitPlayer` 记录 `_lastPlayerDamageTime`；击杀时比较 |
| `burstEliteKills` | 爆发窗口内击杀精英 | 击杀时 `player.burst > 0` |
| `lowHpKills` | 玩家 <20% 生命时击杀 | 击杀时读 `hp/maxHp` |
| `maxKillsIn10s` | 10 秒滑动窗口最大击杀数 | `_killTimes` 环形数组 |
| `crits` | 直接命中暴击次数（basic/skill，DoT/反伤不算） | `_damageEnemy` |
| `bossLastHitSkill` | BOSS 最后一击来自技能 | `_damageEnemy` 记录击杀来源 |

- `startPlan()` 清零；`snapshot()` 带 `stats`。
- `verify-mithril-core.js` 增加「stats 初始为 0 / startPlan 重置 / 一次副本后 kills 一致」的断言。

### M8.3 游戏层接线

1. `MithrilGame` 在 `onLoad` 与 `openCamp` 调 `ensureBountyBoard`（`day = floor(Date.now()/86400000)`，`slots = bountySlots(save)`，`allowDaily = 军需官 Lv4`）。军需官 Lv0 不建板（UI 显示锁定）。
2. 每场战斗结算（胜/负都算）构造 `BountyRunReport` 并 `applyRunReport`：
   - 击杀类读 `snap.stats`；`maxKillsIn10s >= 5` 记 1 次；
   - 区域首领：`won && node.kind === 'boss'`；
   - 副本类：`won && node.kind === 'dungeon'` 才算通关 / 无死亡 / 5 分钟内 / 白装 / 无饰品 / BOSS 技能尾刀 / 单次拾取 ≥10 / 单次暴击 ≥20；
   - 全 12 节点：`markNodeDone` 后 `exp.done.length >= WILD_NODE_COUNT`；
   - 失败局仍推进击杀类（打过的怪算数），不推进通关类。
3. 分解：`MithrilCamp.dismantle()` 成功后 `advanceBountyMetric(save, 'dismantle', 1)`（所有入口共用，含脚本）。
4. 落盘：结算、领取、每日刷新、升级军需官后调 `_persist()`；`onCampChanged` 已覆盖面板操作。
5. 领取发装备走 `addToInventory`；背包满按 `sellPrice` 折金币，并在提示行写明。

### M8.4 悬赏板 UI（军需官页）

- 军需官 Lv0：保留仓库信息，悬赏区写「升到 Lv1 解锁悬赏板」。
- Lv≥1：顶部两行摘要（金币/材料 / 悬赏位与刷新状态），下面最多 6 行悬赏：
  - 行文本：`【讨伐】击杀 30 只小怪　12/30`
  - 右侧按钮：可领取 =「领取」（金色）；未完成 = 进度（灰色）；收集不足 = `材料 8/20`（灰色）。
  - 行 y：`190, 112, 34, -44, -122, -200`，按钮 110×44。
- 领取成功：`_changed('悬赏完成：… 金币 +200')`，面板刷新 + 主组件落盘。
- Lv4 每日刷新：打开面板时若跨日，提示「每日刷新：今日悬赏已更新（未领取进度已重置）」。
- 兼容旧文案：删掉「悬赏任务还没开放」。

### M8.5 验证

1. 新建 `tools/verify-mithril-bounty.js`（预计 250+ 项）：
   - §1 配置完整性（24 / 4×6 / 指标 / 目标 / 奖励）
   - §2 悬赏板（3/6 位、无重复、补位、Lv4 跨日重置、Lv3 不重置、游标回绕）
   - §3 22 条自动悬赏逐条用合成 `BountyRunReport` 推进到可领取（覆盖每个 metric）
   - §4 6 条收集悬赏：足够/不足、精确扣除、不动已装备
   - §5 领取奖励：金币、材料、紫装/橙装品质、重复领取拒绝、空位补位
   - §6 存档往返与坏档净化（非法 id / 重复 / 进度越界 / 位数超限 / 游标）
   - §7 分解钩子（Camp.dismantle 推进进度）
2. `node tools/verify-mithril-core.js`（+stats 断言）、`-camp.js`、`-dungeons.js`、`-trinkets.js` 全绿。
3. 浏览器实点（预览 + 真实输入）：
   - 夹具档军需官 Lv1：3 行悬赏；领一条已完成 → 金币/背包变化、空位补新悬赏；
   - 军需官 Lv2：6 行；
   - Lv4 跨日夹具：打开面板显示「每日刷新」且进度清零；
   - 真实档恢复（`addInitScript`，字节一致）。
4. 第 17 轮试玩（fresh 子代理，编号从 N58 起），P0/P1 清零后收轮。
5. 验收文档 `docs/plans/2026-11-16-mithril-m8-acceptance.md`。

## 6 小时预算（判据 6 的口径）

M8 用「分段可完成 + 预算合计」证明，不在 M8 跑 6 小时真实长跑（归 M9 平衡长跑）：

| 段 | 预算 | 依据 |
|---|---|---|
| 1–30 级 | 3.5 h | 设计 §6 曲线；M9 长跑校准 |
| 3 区域野外全 12 节点 ×3 | 1.0 h | M4/M6 实测单区域 18–22 min |
| 6 副本首通 | 0.5 h | M6/M7 自动战斗单副本 3–5 min |
| 24 条悬赏一轮 | 0.75 h | 与上述内容重叠，按额外操作计 |
| 合计 | **5.75 h ≤ 6 h** | 余量 15 min |

M9 必须用脚本化长跑替换本表（若超 6 h，调经验曲线或悬赏奖励，不改 M8 结构）。

## 数值红线

| 项 | 规则 |
|---|---|
| 悬赏金币总量 | 一轮 24 条 ≈ 13,000 金；不得高于营地主要材料沉没成本的一个数量级 |
| 紫装奖励 | 仅 `hunt_region_boss` 一条；ilvl = clamp(level+8, 1, 40)，品质 epic |
| 橙装奖励 | 仅 `challenge_full_run` 一条；**直接给橙装**（设计写「橙装碎片」，但 M8–M11 没有锻造系统承载碎片，避免死货币） |
| 暴击悬赏 | 设计写「连续 20 次暴击」；暴击率上限 30%（+爆发 30%），字面 20 连暴击概率 ≈ 1e-11，不可完成。改为「单次副本内暴击 20 次」，指标 `dungeon_crit` |
| 进度上限 | 每条进度 ≤ target；领取后删除进度；板上最多 6 条 |
| 每日刷新 | 仅 Lv4；跨日重置**未领取**进度（板上自动追踪，无「已接取」概念） |
| 收集扣除 | 只扣背包，不动已装备；数量不足时按钮不可领取 |

## 风险

| 风险 | 应对 |
|---|---|
| 进度重复累加 | 每局 `_settled` 只结算一次；`BountyStats` 每局在 `startPlan` 清零；`applyRunReport` 只在结算调用 |
| 领取刷金币 | 先校验/扣除，再发奖；领取后立刻从板上移除并补位，重复点击第二次必失败 |
| 存档膨胀 | 进度只保留板上 ≤6 条；净化时裁掉非板上键 |
| 面板行溢出 | 最多 6 行固定坐标；Lv2 才 6 行，Lv1 3 行留空 |
| 每日刷新丢进度挫败 | UI 明写「未领取进度会重置」；Lv4 才启用，前期不受影响 |
| 与 M9 长跑口径冲突 | 6 小时预算表写进验收，M9 用实测覆盖；超时只调曲线/奖励，不动结构 |

## 不做 / 延后

- 悬赏「接取 / 放弃」二次确认：板上条目自动追踪，领取即完成；减少一次点击，符合移动端。
- 橙装碎片货币与锻造：无承载系统，直接给橙装（见数值红线）。
- 悬赏专属文案 / 剧情：设计明确不做长任务链。
- 游戏注册（`GameConfig` / 大厅图标 / `docs/README.md`）：按用户硬约束延后到 M11。
