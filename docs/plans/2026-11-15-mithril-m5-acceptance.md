# 《秘银远征》M5 验收记录（营地 5 设施）

> 日期：2026-11-15 · 分支：`develop` · 范围：M5（营地）
> 设计规格：`docs/plans/2026-11-14-game-mithril-design.md` §4.4 / §4.5 / §4.6 / §11
> 前置：M4 野外节点图已验收（`2026-11-15-mithril-m4-acceptance.md`）

## 1. 退出判据与实测

| 判据 | 要求 | 实测（真实点击，非改状态） | 结论 |
|---|---|---|---|
| 重铸一条词条 | 铁匠铺 Lv1 起，花金币重掷未锁定词条，点数守恒 | 铁匠铺升 Lv1（灰烬 ×4）后点「重铸 112 金」（ilvl 12：`40+6×12`）→ 词条 `全能→暴击`，金币 3000→2888；再锁 1 条（Lv2）后重铸 → `急速→全能`，锁定词条保持暴击不动，费用 157（×1.4） | ✅ |
| 附魔一条 | 附魔台 Lv1 起，把一条词条转移到另一件装备 | 附魔台升 Lv1（灰烬 ×4）→ 源「传说·圣靴」选「急速」→ 目标「史诗·秘银巨剑」→ 点「附魔」：金币 −80、灰烬 −2、源装备从背包消失（15→14）、目标变成 `暴击 + 急速`（2/4 条），提示「附魔完成：急速 → 秘银巨剑」 | ✅ |
| 重置天赋全通 | 训练场解锁后花金币清空天赋 | 训练场 Lv0 点「洗点天赋（需训练场 Lv1）」→ 提示「训练场还没建造…」、天赋 `{钢铁 1, 狂暴 3}` 原封不动；升到 Lv1（灰烬 ×4）→ 点「洗点天赋 200 金」→ 金币 2696→2496、`talents = {}`、面板「已投 0/14」，提示「洗点完成：−200 金」 | ✅ |
| 五设施都能用 | 铁匠铺 / 附魔台 / 训练场 / 厨房 / 军需官各页签可开、可升级 | 五页签逐一实点：铁匠铺（重铸 + 分解）、附魔台（转移）、训练场（洗点 + 方案槽）、厨房（买料理）、军需官（仓库 / 悬赏位读数）；每级升级只扣材料不扣金币 | ✅ |
| 分解（铁匠铺） | 背包里的装备可拆成材料，身上穿着的不能拆 | 选「传说·铁盔 23」→ 按钮「分解 +6 霜晶」→ 点击后背包 14→13、霜晶 20→26、提示「分解完成：霜晶 +6」；选中已装备的主手时按钮变灰「已装备·不能拆」 | ✅ |
| 料理（厨房） | 买一份料理，下一场战斗生效，打完扣 1 场 | 厨房升 Lv1 → 点「力量炖锅」旁「购买」→ 金币 −40、灰烬 −1、「生效中：力量炖锅（剩 1 场）」、「下一场加成：攻击强度 +10.0%」 | ✅ |
| 仓库（军需官） | 仓库上限随等级增长 | Lv1 后读数「装备仓库 14 / 66 格（基础 60 + 军需官 6）」；Lv2 文案「仓库共 +12 格，悬赏位 3→6」 | ✅ |
| 纯逻辑自检 | 全绿 | `node tools/verify-mithril-camp.js` → **337 项通过** | ✅ |
| 回归 | M1–M4 不受影响 | `verify-mithril-core.js` **202/202**；`verify-mithril-wild.js` **2828 项**；编辑器内置 tsc 5.8.2 `--noEmit` → TS_OK | ✅ |

## 2. 交付内容

### 2.1 纯逻辑（无 cc 依赖，可 node 自检）

| 文件 | 内容 |
|---|---|
| `MithrilCamp.ts`（新） | 材料存取（`materialCount` / `payMaterial` / `gainMaterial` / `materialForIlvl`）、设施定义与升级（`canUpgradeFacility` / `upgradeFacility`，只扣材料）、背包与穿戴统一视图（`ownedItems` / `findOwned` / `inventoryItems`）、重铸（`reforgeGold` / `canReforge` / `reforge`）、分解（`dismantleYield` / `canDismantle` / `dismantle`）、附魔（`enchantMaxTransfer` / `enchantTargetCap` / `enchantMaterialCost` / `canEnchant` / `enchant`）、天赋方案（`canSaveTalentPreset` / `saveTalentPreset` / `canLoadTalentPreset` / `loadTalentPreset`）、料理（`canBuyMeal` / `buyMeal` / `mealMultipliers` / `activeMeals` / `availableMeals` / `consumeMealBattle`）、军需官（`storageBonus` / `bountySlots`） |
| `MithrilConfig.ts` | `FACILITIES`（5 × 5 级效果与材料价）、重铸 / 附魔 / 分解 / 料理常量、`MEAL_BY_ID`、`MATERIALS` |
| `MithrilProgress.ts` | `facilityLevel`、洗点价随训练场等级（`talentRespecCost` / `variantRespecCost` / `trainingPriceMul`）、洗点本身（`respecTalents` / `respecVariants`，**训练场 Lv1 起**）、仓库上限与方案槽、存档归一（facilities / meals / talentPresets 往返） |
| `tools/verify-mithril-camp.js`（新） | 10 组 337 项：设施形状、默认值与坏档归一、升级费 / 解锁门槛 / 满级、仓库上限、洗点价与方案槽、重铸（锁位 / 费用 / 点数守恒 / 无重复 / 同 rng 同结果 / 单词条必换）、分解产出、附魔（条数上限 / 重复拦截 / Lv3 保留源 / Lv4 材料减半 / Lv5 突破品质条数）、料理（门槛 / 槽位 / 时长 / ×1.5 / 消耗 / 进 profile）、军需官 |

### 2.2 游戏层

| 文件 | 内容 |
|---|---|
| `MithrilCampPanel.ts`（新） | 720×1180 面板：5 页签 + 共用页头（金币与三种材料 / 设施等级与摘要 / 当前与下一级效果）+ 共用升级按钮 + 结果提示行；铁匠铺（装备列表 / 词条锁定 / 重铸 / 分解）、附魔台（源 / 词条 / 目标三列 + 分页）、训练场（洗点 + 两个方案槽）、厨房（料理列表 + 购买 + 生效中 + 下一场加成）、军需官（仓库 / 悬赏位 / 材料库存） |
| `MithrilGame.ts` | 营地开关（`openCamp` / `closeCamp` / `onCampChanged`）、地图底部「营地」入口与 `C` 键、面板打开时冻结战斗输入、营地改动后重算 profile 并刷新 HUD / 地图、`_settle` 里先结算料理（`consumeMealBattle`）再算生命上限，结算行「料理结束：…（下一场不再生效）」 |
| `MithrilWildMap.ts` | 底部按钮行改 5 个：开始远征 / 营地 / 成长 / 装备 / 返回大厅 |
| `MithrilGrowthMenu.ts` | 洗点按钮改读 `talentRespecCost` / `variantRespecCost`（训练场折扣可见），训练场未建时置灰并提示「去营地把它升到 Lv1」 |

### 2.3 数值口径

| 设施 | 1–5 级 | 材料价（每级） |
|---|---|---|
| 铁匠铺 | 解锁重铸 → 锁 1 条 → 锁 2 条 → 重铸费 −25% → −50% | 灰烬 4 / 灰烬 10 / 霜晶 8 / 霜晶 16 / 秘银 12 |
| 附魔台 | 转 1 条（源被消耗）→ 一次 2 条 → 保留源装备 → 材料减半 → 目标无视品质条数（最多 4 条） | 同上 |
| 训练场 | 解锁洗点（200 / 500）→ 半价（100 / 250）→ 免费 → 方案 A → 方案 B | 同上 |
| 厨房 | 3 种料理 → 5 种 → 双 buff → 效果 ×1.5 → 每份持续 3 场 | 同上 |
| 军需官 | 仓库 +6 → 共 +12 且悬赏位 3→6 → +18 → +24 → +30 | 同上 |

- 重铸：`(40 + 6×装等) × (1 + 0.4×锁数) × 折扣`，只花金币；点数与装等不变，词条不重复。
- 分解：`1 + 品质档 + floor(装等/15)`；装等 <15 灰烬、<30 霜晶、其余秘银；已装备不可拆。
- 附魔：80 金 + 目标装等档材料 ×2（Lv4 起 ×1）；目标词条上限按品质，Lv5 统一 4 条。
- 料理：每份持续 1 场（Lv5 3 场），在**打完一场战斗**时扣 1（本场仍吃得到）；Lv3 起可同时 2 种，Lv4 效果 ×1.5。
- 仓库：`60 + 军需官×6`（满级 90），满仓时掉落折算成金币。

## 3. 自查发现与修复

| 类型 | 问题 | 修复 | 复验 |
|---|---|---|---|
| **逻辑 / 体验** | 单词条装备重铸时，抽签可能抽回自己（25%），玩家花了钱看到「重铸完成：词条点数不变」却什么都没变，像按钮失灵 | `reforge` 的候选池优先排除「这条词条现在的 id」（池里还有别的就必换）；面板提示改为「重铸完成：全能→暴击（点数不变）」 | 实测两次：`全能→暴击`、`急速→全能`；单测新增「单词条重铸一定会换词条」「只剩一个空位时允许同名且无重复」 |
| **规则一致性** | 配置写「训练场 Lv1 解锁洗点」，但 `respecTalents` 在 Lv0 就允许（同样是 200 金），Lv1 变成没有收益的台阶 | `respecTalents` / `respecVariants` 增加 `facilityLevel(save,'training') > 0` 门槛；营地与成长面板的按钮在 Lv0 置灰，文案「需训练场 Lv1」，点击给出明确提示 | 实测：Lv0 点击 → 提示且天赋不动；升 Lv1 后 −200 金清空。`verify-mithril-camp.js` +5 项、`verify-mithril-core.js` 的洗点用例补 `training = 1` |
| **文案** | 提示行「升到 Lv1 解锁：解锁洗点…」双「解锁」 | 改为「升到 Lv1 就能用：…」 | 源码核对 + 实点五页签 |
| **文案** | 附魔完成只说「词条已转移」，不说是哪条、到哪件 | 改为「附魔完成：急速 → 秘银巨剑」（转移前抓源 / 目标名） | 实测同上 |

## 4. 复现命令

```bash
TSC="/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc"
node "$TSC" --noEmit && echo TS_OK
node tools/verify-mithril-camp.js      # 337 项
node tools/verify-mithril-core.js      # 202/202
node tools/verify-mithril-wild.js      # 2828 项
```

预览复验：`http://127.0.0.1:7456/` → 野外地图 → 底部「营地」（或按 `C`）。
改过 `.ts` 后顺序固定：tsc → MCP `project_refresh_assets` → 整页重载。

**验证时的存档处理**：本轮为了不必先刷 8 个灰烬，在预览里用 `comp._save.materials/gold` 播种材料与金币后 `comp._persist()`（**不能**先写 `localStorage` 再 reload —— 页面卸载时游戏会用旧内存状态覆盖，见 M4 文档 §4）。验证过程真实扣费、真实消耗装备，因此**预览里的开发存档被改动**（设施 Lv1–2、一件传说头盔被分解、主手词条变成暴击 + 全能、天赋已洗），不是干净的旧档。

## 5. 遗留

- 悬赏系统本体在 M8；军需官的悬赏位现在只显示数值（面板已注明）。
- 料理「团队 buff」按单机调整为「双 buff」（§4.6 表已同步为实际实现）。
- 副本节点仍是占位（M6），营地与副本之间暂无联动（如「副本内不能开营地」这类限制尚未涉及）。
- 大厅注册与图标按计划推迟到 M11（当前**未**改 `GameConfig.ts`、未加大厅图标）。
- 下一轮：第 13 轮试玩（fresh 子代理）针对 M5，编号从 N51 起。
