# `tools/` 脚本清单

> 本文是 `tools/` 下全部脚本的**唯一清单**。AGENTS.md 只保留必备命令与指针。
> 新增/删除脚本时改这里，别在 AGENTS.md 里复写一遍。

## 运行方式

```bash
node tools/<script>.js                    # 全部脚本都直接跑，无需 npm script
node tools/verify-<game>-core.js          # 退出码 0 = 通过
```

`verify-*-core.js` 会用 `tsc` 把对应 `*Core.ts` 编译到 `temp/` 再在 Node 里跑。tsc 的查找顺序
（`$TSC` → `node_modules` → Cocos Creator 自带版本）与调用**统一在** [`tools/lib/core-compile.js`](../../tools/lib/core-compile.js)，
新脚本 `require('./lib/core-compile')` 后直接用 `runTsc` / `requireTsc`，不要再手抄路径。
**改过 `*Core.ts` 之后必跑对应脚本**，纯 UI/场景改动不必跑。

新游戏的骨架（含一份 `verify-<id>-core.js`）用 `node tools/new-game.js --id <id> --name <中文名>` 生成，
规矩见 [`../design/2026-11-15-new-game-contract.md`](../design/2026-11-15-new-game-contract.md)。

## 纯逻辑自检（不启动编辑器）

| 脚本 | 对应游戏 | 覆盖要点 |
|---|---|---|
| `verify-template-core.js` | **模板（game_template）** | Core 纯度（禁 cc / `Date.now` / `Math.random` / `localStorage`）、开局计时、点击计分与确定性奖励、可复现 RNG、best 只增、存档往返与坏档回落（15 项）。**改 `GameUIKit` / `UITheme` 后也跑它** |
| `verify-tetris-core.js` | 方块坠落 | SRS 四态与踢墙、7-bag、出生位置、消行、Ghost、计分与重力表 |
| `verify-brick-core.js` | 砖块远征 | RNG 确定性、关卡生成与难度曲线、弹板/发球/反弹、砖块耐久/穿透/爆炸球/炸弹连锁、计分连击、激光/粘性/分裂、生命结算、防穿模 |
| `verify-merge-core.js` | 合合大作战 | 对应 `plans/2026-10-31-merge-physics-evaluation.md` §5 的 12 项：自由落体、叠放稳定、10 果堆塔、合并、禁链式合并、顶果消除、墙体钳制、高速不穿模、确定性、失败判定、投放冷却、长跑 |
| `verify-gate-core.js` | 数值冲刺 | 对应设计 §8 的 20 项：门模板、乘除、钳制、只触发一次、对拼公式、人数归零、Boss 三阶段、生成确定性、180 s 自动游玩、集火、完美选门连击等 |
| `verify-solitaire-core.js` | 纸牌接龙 | 洗牌确定性、发牌形状、抽 1/抽 3、重洗顺序、列/收牌区合法性、整段移动、翻牌计分、自动移动、撤销、一键收牌、提示优先级、存档往返与坏数据、随机对局不变式 |
| `verify-survivor-core.js` | 午夜幸存者 | 规格 §8.5 的 29 项；另配 `sim-survivor-balance.js` 跑 N 局平衡模拟（默认 100 局） |
| `verify-minesweeper-core.js` | 扫雷 | 规则自检（首点安全、和弦等） |
| `verify-sudoku-core.js` | 数独 | 生成合法性与唯一解、给定数、输入/笔记/擦除、冲突、撤销、提示、完成判定、存档往返、生成耗时 |
| `verify-idiom-core.js` | 成语填字 | 词库、三档难度各 100 个种子生成、交叉/邻接约束、填字校验、提示死锁回归、计分与存档（24 项） |
| `verify-wordle-core.js` | 成语猜猜 | 词库合法性、绿/黄/灰判定含重复字、答案与候选池确定性、三档难度池尺寸与干扰字唯一、每日种子、计分、分享文本、1,000 局长跑（29 项） |
| `verify-gomoku-core.js` | 五子棋 | 四方向胜负与边界/长连、平局、悔棋精确还原、AI 必赢必堵与合法性、530 局自对弈、同种子确定性、评分与候选点剪枝（24 项） |
| `verify-idle-core.js` | 小店日记 | 费用表、点击/自动/离线公式、8h 封顶、时间倒退、30 天模拟、10 万次操作无 NaN、大数格式化、存档往返与坏档回落（27 项） |
| `verify-match3-core.js` | 缤纷消除 | 500 种子 × 4/5 色开局无三连、交换合法性与非法不改变棋盘、特殊块生成/触发/互炸不死循环、连锁计分、无解重排、10,000 次长跑、快照往返、30 关配置与星级边界（25 项） |
| `verify-td-core.js` | 守卫塔楼 | 3 张地图合法性与路径推导、建造/升级/出售经济、三种索敌、溅射与减速、漏怪扣血与判负、10 波全清判胜、1,000 局随机长跑、三张地图自动玩家通关（21 项） |
| `verify-pool-core.js` | 台球 | 摆球与关卡合法性、力度映射、正碰动量转移、库边反弹、摩擦必然停机、1,000 次高速对撞不穿透、1,000 杆随机长跑、落袋与连击计分、母球落袋复位、清台/杆数耗尽、瞄准预测、确定性、存档回落（24 项） |
| `verify-shmup-core.js` | 星际弹幕 | 场地与波次配置、自动开火与火力齐射、四种弹幕图案角度、碰撞计分、无敌帧、边界夹取、道具掉落与封顶、波次推进与 Boss 就位、通关/失败终态、60 秒长跑（34 项） |
| `verify-thunder-core.js` | 雷霆战机 | 10 关关卡表、存档净化、四条升级线与属性推导、星级/奖励、边界夹取、火力齐射与僚机、护盾/炸弹/复活、波次推进与 Boss 胜负、确定性掉落、1,000 次升级、10 分钟长跑与第 1 关自动驾驶通关（64 项） |
| `verify-bubble-core.js` | 泡泡龙 | 六边形网格几何与邻居对称性、关卡配置合法性、布局颜色平衡、同色连通与悬空掉落、弹道反射与吸附不重叠、快照往返、随机长跑 |
| `verify-sokoban-core.js` | 推箱子 | ASCII 解析与错误输入、走位/推箱/卡住判定、撤销精确还原、通关判定、快照往返、BFS 逐关可解 + par 一致、解法回放、长跑不变量 |
| `verify-fridge-core.js` | 冰箱底下 | M1 移动/瞄准/眼泪/敌人/拾取；M2 地图生成/门锁/清房/宝箱/Boss/存档；M3 40 道具、14 协同、6 角色技能、免死复活、商店/祭坛/炸弹/秘密房 |
| `verify-mithril-core.js` | 秘银远征 | M0：数值曲线、副属性预算、天赋规则、技能变体、存档净化、配置完整性、战斗骨架（确定性、实体上限、无 NaN、无敌帧）；M8：每局悬赏统计（击杀分类 / 精英无伤 / 爆发击杀 / 低血 / 10 秒窗口 / 暴击 / BOSS 尾刀）（221 项） |
| `verify-mithril-wild.js` | 秘银远征 | M4：地图生成（12 节点 / 6 层 / 连线对称 / 无孤岛）、走法规则（起点免费回退、相邻已清理节点路过、当前未结算节点重开、不相邻已清理节点拒绝）、补给扣减与耗尽 8% 扣血、宝箱 / 事件 / 篝火、死亡与放弃只吞本程材料、存档往返与坏档回落（2828 项） |
| `verify-mithril-camp.js` | 秘银远征 | M5：营地设施（铁匠铺 / 训练场 / 厨房）等级与解锁、材料产出与消耗、料理场次、天赋方案存取、经济不变量（337 项） |
| `verify-mithril-dungeons.js` | 秘银远征 | M6：24 敌人 / 6 副本 × 3 遭遇 / 6 份 BOSS 编排与阶段同序、6 件首通紫装、区域路由、美术登记、**4 职业 × 6 副本自动通关矩阵**（892 项） |
| `verify-mithril-trinkets.js` | 秘银远征 | M7：20 饰品 / 10 tag / 12 协同配置与掉落池闭环、协同只靠配对点亮、**20 件逐件规则效果**、12 条协同效果、两格装备与存档往返、打桩差异 ≥25%、**4 职业 × 6 副本 × {不戴, 戴} 自动通关矩阵**（692 项；含 48 场自动战斗，跑一轮约 3–5 分钟） |
| `verify-mithril-bounty.js` | 秘银远征 | M8：24 悬赏配置（4 类各 6 条 / 指标 / 目标 / 奖励 / 消耗合法性）、悬赏板（3→6 位、不重复、领取即补位、Lv4 跨日刷新与 Lv3 不刷新、游标回绕、坏档裁切）、**16 个自动指标逐个用合成战斗报告推满 + 失败局边界**、5 条收集类精确扣除（只扣背包不碰已装备）、领取奖励（金币 / 材料 / 紫装 / 橙装 / 装等夹取 / 重复领取拒绝）、存档往返与坏档净化、`Camp.dismantle` 真实钩子（471 项） |
| `verify-battle-fixes.js` | 小小先锋 | 战斗修复回归。**脚本内 ROOT 硬编码为作者的 Windows 路径，跨机运行前先改成本机绝对路径** |

## 脚手架与共享工具

| 脚本 | 用途 | 何时跑 |
|---|---|---|
| `new-game.js` | `--id <id> --name <中文名> [--class <X>] [--dry-run]`：从 `assets/games/game_template/` 生成骨架（Core/Game/Hud + `verify-<id>-core.js`），并打印必须手改的清单 | **新增游戏第一步** |
| `lib/core-compile.js` | 共用模块（非独立脚本）：`findTsc` / `requireTsc` / `runTsc`，所有 `verify-*-core.js` 的 tsc 定位都走它 | 新写 verify 脚本时 `require` |
| `lib/mithril-bot.js` | 共用模块（非独立脚本）：`createBot(F, C)` → `{ BANDS, runDungeon, botInput, pickMove }`。秘银远征的自动玩家（16 方向转向 + 躲预警圈 / 弹道 + 低血吃球），`runDungeon(classId, dungeonId, seconds, trinkets?)` 多接一个饰品数组 | 改战斗手感 / 加饰品矩阵自检时先用它跑一遍 |

## 图标 / 构建 / 场景清单

| 脚本 | 用途 | 何时跑 |
|---|---|---|
| `check-game-icons.js` | 校验 `GAME_LIST` 每款都登记了专属强调色与图形（退出码 0 = 全覆盖）；`--art <副本>` 可自测脚本能否拦住漏登记 | **新增游戏后必跑** |
| `check-wechat-build.js` | 微信小游戏产物 9 项预检：必需文件、JSON 可解析无 BOM、落盘稳定、ES2015/ES5 可解析、主包 ≤ 4 MB、无变体选择符、是否停在过期构建、AppID 非占位、**小游戏包装 vs 小程序包装** | **把 `build/wechatgame/` 交给微信开发者工具之前** |
| `replay-wechat-bundle.js` | 在「小游戏包装」下回放产物，复现/反证启动期崩溃 | 与上一条配套 |
| `sync-build-scenes.js` | 同步/校验构建场景清单（三处：`builder.common.scenes`、taskMap、`wechatgame.json`）；`--check` 只读、`--all` 顺带修其它平台 | **新增游戏后、构建之前**；编辑器在跑时拒绝写入，`--force` 可越过 |

构建场景清单的四种改法（MCP 首选 / 脚本 / 平台配置 / GUI 兜底）见
[`wechat-build-pitfalls.md`](./wechat-build-pitfalls.md) §9 与 AGENTS.md 的阶梯表。
