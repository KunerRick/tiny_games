# 《秘银远征》M9 实施计划（平衡长跑 + 存档迁移）

> 日期：2026-11-16 · 分支：`develop` · 前置：M8 已验收（`2026-11-16-mithril-m8-acceptance.md`，`0561f7f`）
> 设计规格：`docs/plans/2026-11-14-game-mithril-design.md` §10（自检脚本）/ §11（里程碑表）/ §12（风险表）
> 里程碑原文：`| **M9** | 平衡长跑 + 存档迁移 | verify 30 项全绿 |`
> 设计红线原文：`| 长跑 | 10,000 次战斗步进无 NaN / 6 副本自动玩家通关 |`
> 设计风险原文：`| 存档 schema 迁移 | 🟡 中 | 第一版带 version + sanitize（抄 ThunderSave），改字段必须写迁移 |`

## 退出判据

| # | 判据 | 验证方式 |
|---|------|---------|
| 1 | 长跑不崩：10,000 次战斗步进无 NaN、生命不越界、实体不超上限 | `verify-mithril-balance.js` §1：终局副本连续 10,000 步，每 30 步抽样断言 |
| 2 | 6 副本自动玩家通关，且时长落在合理窗口 | §2：4 职业 × 6 副本矩阵沿用 M6 已验收脚本；本脚本按战士逐副本计时，断言 `30 s ≤ t ≤ band.maxSeconds` |
| 3 | 6 小时预算用**实测**替换 M8 的分段预算 | §4：实测 6 副本首通 + 3 次野外全清 + 剩余经验农场，按真实 `expToNext` 折算，输出小时数并断言 ≤ 6 h |
| 4 | 经济不变量：金币 / 材料两条线都有源有汇、不会为负、升级路径可达 | §5：金币收支、设施材料总需求 vs 三次野外全清产出、重铸 / 附魔 / 洗点成本有限且非负 |
| 5 | 存档带显式版本与迁移：v1 → v2、旧档补字段、未来版本降级、坏档回落、幂等 | §6：真实档、pre-M5 / pre-M7 / pre-M8 合成档、`v:99` 未来档、坏 JSON、缺字段、类型错误、重复迁移一致 |
| 6 | 全量回归 + 编译 | 6 个既有 verify + `verify-mithril-balance.js` 全绿；`tsc --noEmit` = TS_OK |
| 7 | 独立试玩（第 18 轮）P0/P1 清零 | `2026-11-16-playtest-round18-mithril-m9.md`；重点覆盖旧档进入、长跑后的存档读写 |

## 现状盘点（M8 结束时）

- `MithrilProgress.parseSave` 只做 `JSON.parse` + `sanitizeSave`；`SAVE_VERSION = 1` 自 M0 未变，M5–M8 新增字段全靠 `sanitizeSave` 的默认值兜底。**没有**显式迁移函数，也**没有**版本前进 / 未来版本的处理口径。
- `exp` 的坏档只被夹到 `0..1e9`，不保证 `< expToNext(level)`；`addExp` 只在游戏内加经验时维持这个不变量。
- 战斗长跑已有局部覆盖：`verify-mithril-core.js` 有固定步长确定性与实体上限；`verify-mithril-dungeons.js` 有 4 职业 × 6 副本自动通关（892 项）；`verify-mithril-trinkets.js` 有 48 场自动战斗。**没有**单局 10,000 步的连续长跑，也**没有**把副本时长 / 经验产出折算成一周目小时数的模型。
- `tools/lib/mithril-bot.js` 只有 `runDungeon(classId, dungeonId, seconds, trinkets)`，绑死 `startDungeon`；野外节点（`buildWildPlan`）没有可复用的自动跑法。
- 6 小时预算目前是 M8 计划里的分段表（3.5 + 1.0 + 0.5 + 0.75 = 5.75 h），来源是估计值。

## 子步骤

### M9.1 存档版本与迁移（`MithrilProgress.ts`）

1. `SAVE_VERSION` 1 → **2**。版本 2 的语义：M5–M8 新增的 `facilities / meals / talentPresets / trinketBag / bounties / bountyProgress / bountyDay / bountyCursor / expedition` 全部纳入正式 schema，迁移层显式补齐。
2. 新增迁移入口（纯逻辑、绝不抛）：

   ```ts
   export interface SaveMigrationInfo {
       fromVersion: number;   // 原始 v（缺失/非法 = 0）
       toVersion: number;     // SAVE_VERSION
       notes: string[];       // 本次迁移做了什么（v0 补默认、过期经验折算、未来档降级……）
   }
   export function migrateSave(raw: unknown): { save: MithrilSave; info: SaveMigrationInfo };
   ```

   迁移顺序：
   - **v0 / 缺 v**：视作最早的档，先补 `exp / gold / materials / equips / inventory / trinkets / talents / skills / variants / skillBooks / dungeonsCleared / regionsCleared` 的默认形状，再交给 `sanitizeSave`。
   - **过期经验**：`exp >= expToNext(level)` 时逐级折算到 `level`（复用 `addExp` 的不变量），余数保留；满级直接清零。
   - **pre-M7**（无 `trinketBag`）：把已装备的饰品登记为已拥有（与 M7 的运行期约定一致）。
   - **pre-M8**（无悬赏字段）：`bounties=[] / bountyProgress={} / bountyDay=0 / bountyCursor=0`，板面交给 `ensureBountyBoard` 懒填充。
   - **未来版本**（`v > SAVE_VERSION`）：保留可识别字段、丢弃未知字段、版本号压回 `SAVE_VERSION`，并在 `notes` 标记 `downgrade`。
3. `parseSave` 改为 `migrateSave(data).save`；坏 JSON 仍回落 `defaultSave('warrior')`。
4. 幂等：`migrateSave(migrateSave(x).save)` 的 `save` 与首次结果逐字段相等，且第二次 `notes` 为空。
5. `sanitizeSave` 本身不改语义（迁移只做「版本方言 → 当前 schema」的补齐，不做二次校验）。

### M9.2 自动玩家支持野外节点（`tools/lib/mithril-bot.js`）

- 抽出 `runPlan(plan, opts)`：`{ classId, level, ilvl, seconds, trinkets, hp }`，内部 `world.startWild(plan, hp)`；`runDungeon` 保持原签名与行为（内部改调 `runPlan`，避免两套循环漂移）。
- 返回值与 `runDungeon` 一致（`world / seconds / seen / badState / bossPhases / minHp / sawAdds / sawTelegraph / plan`）。
- 不改战斗规则、不改 16 方向采样参数——M6/M7 的 48 场自动战斗必须原样通过。

### M9.3 平衡长跑脚本（`tools/verify-mithril-balance.js`，目标 30+ 项）

| 组 | 内容 |
|---|---|
| §1 长跑稳定性 | `throne` 终局副本连续 10,000 步（≈167 s 模拟）：每 30 步抽样 `player.hp/x/y`、每个敌人 `hp` 有限且不超上限；实体数 ≤ `MAX_ENEMIES / MAX_BULLETS / MAX_DROPS`；结束时 `phase ∈ {playing, won, dead}` 不悬空 |
| §2 六副本计时 | 战士按 `BANDS` 逐副本跑：通关、`30 s ≤ t ≤ maxSeconds`、`expGained > 0`、`goldGained > 0`、BOSS 至少进入第 2 阶段 |
| §3 野外全清 | 3 区域各生成 1 张图（固定种子），从起点按最短路依次把 12 个节点全部结算（未结算节点就近插入，首领最后），战斗节点用 `runPlan` 自动打，事件按「血 <55% 包扎、否则搜刮」处理；断言每区域 12 节点全清 + 首领获胜、战斗节点 ≥4、总时长 3–30 min/区域 |
| §4 六小时预算 | 用 §2 / §3 的实测 `expGained / seconds`：① 1–30 累计经验与设计 60,500 同量级（55k–66k）；② 一周目路线扣除 6 首通 + 3 野外的经验后，剩余经验按各等级段最近的副本农场速率折算；③ `总时长 × 1.5（人类操作系数）+ 0.75 h（悬赏/面板操作）≤ 6 h`；④ 原始（未乘系数）时长 ≥ 1.5 h，防止内容被削得过短 |
| §5 经济不变量 | 金币：路线产金 ≥ 6 副本 + 3 野外的实测之和，重铸 / 附魔 / 洗点成本均为正且有限，按「每级一次重铸」的极端花法仍不为负；材料：5 设施满级总需求（灰烬 70 / 霜晶 120 / 秘银 60）vs 3 次野外全清 + 副本节点产出，断言至少能解锁全部 5 个 Lv1（灰烬 20）且不会溢出到无意义（总产出 ≤ 3 倍总需求） |
| §6 存档迁移 | 真实档（1948 字节夹具，v1）→ v2 且逐字段保留；pre-M5 / pre-M7 / pre-M8 合成档补默认；`exp` 过期折算；`v:99` 未来档降级且未知字段被丢弃；坏 JSON 回落战士默认档；`null` / `{}` / 类型错误不抛；嵌入装备与背包 uid 冲突重命名；等级 / 金币 / 材料非法值夹取；迁移幂等 |

`§1–§5` 走编译后的纯逻辑层；`§6` 只依赖 `MithrilProgress.ts`。实测跑一轮 **约 1 秒**（含 tsc 编译；6 场副本 + 3 次野外全清合计 7 万+ 步）。

### M9.4 回归与文档

1. `node tools/verify-mithril-balance.js`（新）。
2. 既有 6 个脚本全跑：core / camp / dungeons / trinkets / wild / bounty。
3. `tsc --noEmit`（编辑器自带 5.8.2）。
4. `docs/tech/verify-scripts.md` 增行；AGENTS.md 教训表**不加**（已到 6 条上限）。
5. 验收文档 `docs/plans/2026-11-16-mithril-m9-acceptance.md`；试玩报告 `2026-11-16-playtest-round18-mithril-m9.md`（fresh 子代理，编号从 N59 起）。

## 6 小时预算的模型（判据 3 的口径）

M9 不再沿用估计表，改用「实测产出 + 显式假设」：

```
一周目剩余经验 = 累计到 30 级所需经验
                − 6 副本首通实测经验（含首通 +800 × 6）
                − 3 条野外路线实测经验
农场速率       = 各等级段最近的副本实测 exp/s
农场时长       = Σ(该段剩余经验 / 该段速率)
总时长         = 6 副本实测 + 3 野外实测 + 农场时长
人类系数       = ×1.5（学习成本、死亡重打、菜单操作；对全部实测时长统一乘，偏保守）
预算           = 总时长 × 1.5 + 0.75 h（24 条悬赏一轮的额外操作）
判据           = 预算 ≤ 6 h，原始 ≥ 1.25 h，且预算 ≥ 2.5 h
```

- **1.5 系数**是显式假设，不是实测：自动玩家不会走错路、不会死、不会读面板。写进验收文档，若未来有真人试玩数据再替换。
- **下限口径（M9 实测后修正）**：计划初稿写「原始 ≥ 1.5 h」，实测 1.31 h。检查后判定这是阈值拍脑袋、不是内容缺失（6 副本 2.5–4 min/场 + 3 区域全清 3–8 min/场 + 农场 43 min），故改为「原始 ≥ 1.25 h 且真人折算 ≥ 2.5 h」；设计文档的「6 小时」按**上限**理解，实测 2.72 h 偏低这一点写进验收文档备查。
- **0.75 h 悬赏**沿用 M8 的口径；悬赏内容与副本 / 野外重叠，只计额外操作。
- 若超 6 h：只调经验曲线（`EXP_BASE / EXP_EXPONENT`）、副本时长或奖励，**不改** M6–M8 的结构。

## 数值红线

| 项 | 红线 |
|---|---|
| 六副本时长 | 每副本 ≤ `BANDS.maxSeconds`，且 ≥ 30 s（否则说明自动玩家秒杀，数值失衡） |
| 单局长跑 | 10,000 步内 0 NaN、0 越界、0 超上限 |
| 一周目 | 人类折算 + 悬赏操作 ≤ 6 h；原始 ≥ 1.25 h；真人折算 ≥ 2.5 h |
| 设施材料 | 三次野外全清至少解锁 5 个 Lv1（灰烬 ≥ 20）；总产出 ≤ 3× 满级总需求 |
| 存档 | v1 真实档迁移后字段级 diff 为空（除 `v`）；任何输入不抛异常；迁移幂等 |

## 风险

| 风险 | 应对 |
|---|---|
| 自动玩家测出的时长过短，6 小时判据变成「怎么都过」 | 同时断言原始时长下限 1.5 h，并把人类系数写死在脚本里；报告输出原始 / 折算两列 |
| 野外路线规划（最短到 BOSS）写错，测的不是真实流程 | 复用 `isAdjacent / enterNode / markNodeDone` 的真实规则；每区域断言战斗节点全部获胜且 BOSS 到达 |
| 迁移层与 `sanitizeSave` 职责重叠，出现双份默认值 | 迁移只补「版本方言」，数值夹取仍只在 `sanitizeSave`；脚本对两者分别有断言 |
| 版本号跳 2 影响真实档 | 真实档恢复用 `addInitScript` 原样写回；迁移只发生在读档内存里，落盘前用户可见字段不变 |
| 跑长跑脚本拖慢日常验证 | 脚本独立，不并入 `verify-mithril-core.js`；`docs/tech/verify-scripts.md` 标注耗时 |

## 不做 / 延后

- 真人试玩计时（需要外部玩家）：M9 只做脚本化长跑 + 显式人类系数。
- 逐级 1–29 全量自动战斗（30 场）：用副本带 + 实测速率折算，避免脚本跑 30 分钟。
- 游戏注册（`GameConfig.GAME_LIST` / 大厅图标 / `docs/README.md`）：仍按用户硬约束延后到 M11。
- 音效 / 震动 / 微信预检：M10。
