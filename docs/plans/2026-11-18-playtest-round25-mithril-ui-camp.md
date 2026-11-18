# 第 25 轮试玩报告 · 秘银远征 · UI · 营地视觉体系重做

| 项 | 值 |
|---|---|
| 日期 | 2026-11-18 |
| 轮次 / 维度 | round25 / **UI（用户指定焦点）** |
| 范围 | 营地五设施页 + 页头/页签/凹板/按钮/空态；连带统一野外图、装备、成长、选职业的配色与框架 |
| 触发 | 用户：「整体风格希望致敬 WoW，包括配色；尤其是营地，布局和配色有点奇怪」 |
| 实现 | 主会话（开发者） |
| 独立复核 | fresh 子代理（只读巡检；结论见 §6） |
| 存档 | `clean` 新档（空态）+ 页内注入的未落盘存档（有内容态） |
| 视口 | 实现期：桌面 Chrome 1280×720 CSS（游戏居中缩放）；回修期：`cc.view.setFrameSize(720,1280)` 放大到 720×1280 CSS / dpr 1；复核截图见 §6 |
| 结束 | `converged`（详见 §10） |

> 截图存于 `docs/assets/2026-11-18-mithril-round25/`（本机证据，按 [`playtest-cycle.md`](../tech/playtest-cycle.md) §7.5 不入库；下文证据链接仅本机可点开）。

---

## 1. 结论摘要

本轮把营地从「深蓝灰 SaaS 仪表盘 + Tailwind 霓虹色」改造成一套**暗色石墙 + 深色木梁 + 黄铜包角 + 羊皮纸文字**的 WoW 致敬语言，并把同一套令牌铺到所有非战斗界面。

四个关键变化：

1. **材质层次**：营地页头是一条 124px 木带，面板是石底 + 黄铜双线 + 四角铆钉，内容区是一块内凹板；不再是「一张圆角深色卡片上摆控件」。
2. **金色只做结构**：金底只给主操作与选中页签，文字一律换墨色；正文回到羊皮纸色，屏幕不再整片发光。
3. **身份色收敛**：设施/职业/品质色从高饱和霓虹改成珠宝色与 WoW 稀有度色相；设施色只出现在图形和未选页签，五个页签不再互相打架。
4. **空态补齐**：新档首访的五个设施页与装备详情不再是大块空凹槽，统一「大图形 + 标题 + 下一步提示」。

## 2. 机读问题表

| ID | 级别 | 打磨分 | 维度 | 状态 | 界面 | 现象 | 处理 | 证据 |
|---|---|---|---|---|---|---|---|---|
| N91 | P2 | 3 | UI | `fixed` | 营地（全五页） | 整体是深蓝灰仪表盘：无材质、无页头、页签高饱和、主按钮彩虹色，与「WoW 暗色奇幻」方向不符 | 新增 `MithrilTheme.ts` 令牌；`drawCampFrame` 木带页头 + 双金线 + 铆钉；页签金底墨字；主操作金底墨字；内容凹板统一 | [`camp-final.png`](../assets/2026-11-18-mithril-round25/camp-final.png) |
| N92 | P2 | 3 | UI | `fixed` | 营地五设施（新档） | 新档首访时铁匠/附魔/厨房/军需/训练均为整块空凹槽或半屏空白；附魔空态说明与费用行重叠；训练场 Lv1 渲染两个锁死槽 + 大留白 | 统一 `_emptyState`（图形 54 + 标题 + 两行说明）；厨房/军需未建造态上移并补获取提示；附魔费用行在双空时隐藏；训练场按 `slots` 出槽并在 0 槽时给解锁提示 | [`camp-enchant-empty-final.png`](../assets/2026-11-18-mithril-round25/camp-enchant-empty-final.png) · [`camp-kitchen-empty-round25.png`](../assets/2026-11-18-mithril-round25/camp-kitchen-empty-round25.png) · [`camp-qm-empty-final.png`](../assets/2026-11-18-mithril-round25/camp-qm-empty-final.png) · [`camp-training-round25b.png`](../assets/2026-11-18-mithril-round25/camp-training-round25b.png) |
| N93 | P2 | 3 | UI | `fixed` | 野外图 / 装备 / 成长 / 选职业 | 这些界面仍是旧的蓝紫 Tailwind 配色与无装饰面板，与营地并排像两个游戏 | 面板 / 文字 / 按钮 / 框架全部迁到 `MITH_UI`；面板补 `drawStoneTrim`；野外图改夜色底 + 石色上下带 + 珠宝色节点 + 黄铜可达圈；天赋 12 系图标保留高辨识色（仅图形，语义色） | [`camp-quartermaster-round25.png`](../assets/2026-11-18-mithril-round25/camp-quartermaster-round25.png) · [`growth-round25.png`](../assets/2026-11-18-mithril-round25/growth-round25.png) · [`class-round25.png`](../assets/2026-11-18-mithril-round25/class-round25.png) |
| N94 | P3 | 3 | UI | `fixed` | 品质 / 职业 / 设施 | 品质色与职业色是零散 Tailwind 色，未采用 WoW 稀有度/职业色相；同屏辨识度与主题不一致 | `QUALITIES` 改灰/绿/蓝/紫/橙/红；`MITH_QUALITY` 镜像；设施/职业改珠宝色；设施色只用于图形与未选页签 | 代码：`MithrilConfig.ts:464`、`MithrilTheme.ts:66`、`MithrilArt.ts:896/907`；实机品质色分支未取证（见 §7） |
| N95 | P3 | 3 | UI | `fixed` | 角色 · 装备详情 | 未选中物品时，详情区下半屏全空，只剩一行提示 | 未选中态加低饱和大图形 + 提示；选中/槽位空态分别复位标题位置，避免压图 | [`menu-v3.png`](../assets/2026-11-18-mithril-round25/menu-v3.png) |

| N96 | P2 | 3 | UI | `fixed` | 营地 · 铁匠铺 / 附魔台（新档空态） | 列表为空时仍画「装备（含身上）」「词条（点一行切换锁定）」「源（背包）/ 转移词条 / 目标」列头，列头下整片空白，空态被推到凹板中部，仍有 ~230px 空档 | 列头改为**列表非空才画**；空态整体上移（铁匠 96 / 附魔 96） | [`camp-smith-empty.png`](../assets/2026-11-18-mithril-round25/camp-smith-empty.png) · [`camp-enchant-empty.png`](../assets/2026-11-18-mithril-round25/camp-enchant-empty.png) |
| N97 | P2 | 3 | UI | `fixed` | 营地 · 训练场（Lv0） | 说明写「现在可以先洗点或重置变体」，同屏两个按钮却是禁用的「需训练场 Lv1」 | 文案按 `unlocked` 分支：Lv0 写「升到 Lv1 后可洗点 / 重置变体」 | [`camp-training-lv0.png`](../assets/2026-11-18-mithril-round25/camp-training-lv0.png) |
| N98 | P2 | 3 | UI | `fixed` | 营地 · 附魔台（有内容） | 目标列表「稀有·秘银巨剑 12（穿）」把右括号挤成孤行 | 后缀缩成 `·穿`，行宽不变也不再换行 | [`enchant-paren-before.png`](../assets/2026-11-18-mithril-round25/enchant-paren-before.png)（修复前） |
| N99 | P2 | 3 | UI | `fixed` | 野外图 | 节点是 Tailwind 荧光色（`#5E9BD1`/`#9F6FD9`/`#5FB56A`/`#C85A5A`），底栏「营地/成长/装备」是三块青/棕/紫满饱和填充，与石+金体系脱节 | 节点色降到「旧地图颜料」档；底栏四个次级按钮统一 `stoneLight` 石底 + 金边，身份只留 12px 图标色；已清理小勾改 `emerald` | [`wildmap-muted.png`](../assets/2026-11-18-mithril-round25/wildmap-muted.png) |
| N100 | P3 | 3 | UI | `fixed` | 全局文字 | `parchmentMuted` 在 `stoneDark` 上 3.98:1；祖母绿按钮 4.03:1，低于 AA 4.5 | `parchmentMuted` → `#8A7E66`（4.66:1）；`emerald` 压深 → `#356B3C`（4.95:1） | `MithrilTheme.ts` 令牌注释；色值按 WCAG 公式计算 |
| N101 | P3 | 3 | UI | `fixed` | 营地 · 厨房 / 军需官 | 两页列表行没有行底（铁匠/附魔的行是 Button 自带填充），同屏两种行样式 | 新增 `_rowBackdrops()`：640 宽圆角行底 + 细金线，与列表按钮同色 | [`camp-kitchen-rows.png`](../assets/2026-11-18-mithril-round25/camp-kitchen-rows.png) · [`camp-qm-rows.png`](../assets/2026-11-18-mithril-round25/camp-qm-rows.png) |
| N102 | P2 | 3 | UI | `fixed` | 角色 · 装备详情 | 背包列表底到剑形图标约 370px 空白，详情贴在面板底部 | 详情区改成一块 `drawInsetBoard` 凹板（620×244）；空态图形/标题/说明与选中态各自复位 y | [`menu-detail.png`](../assets/2026-11-18-mithril-round25/menu-detail.png) · [`equip-empty-before.png`](../assets/2026-11-18-mithril-round25/equip-empty-before.png) |
| N103 | P3 | 3 | UI | `fixed` | 选职业 | 战士卡「爆发技清空」后「怒气」孤行；游侠卡「（站桩 / 输出）」断括号；选中态「已选中」用语义绿 | 资源说明显式按第一个「，」断行；选中态改 `goldBright` | [`classselect-gold.png`](../assets/2026-11-18-mithril-round25/classselect-gold.png) |
| N104 | P3 | 3 | UI | `fixed` | 角色 · 装备（空背包） | 0 件时仍显示「上一页 1/1 下一页」，平均装等显示 1.0 | 分页 `list.length > 0 && pages > 1` 才显示；0 件平均装等显示「—」 | [`equip-empty-before.png`](../assets/2026-11-18-mithril-round25/equip-empty-before.png) |
| N105 | P3 | 3 | UI | `fixed` | 野外图 | 「音效 开」仍是旧 `#9CA3AF` 灰；锁定区域页签 `parchmentMuted` on `stoneLight` 3.3:1 偏暗 | 音效改 `parchmentDim`；锁定页签文字提亮到 `parchmentDim`，锁定信息由文案承担 | [`wildmap-muted.png`](../assets/2026-11-18-mithril-round25/wildmap-muted.png) |
| N106 | P3 | 3 | UI | `fixed` | 品质色 | 品质色偏 iOS/Tailwind 荧光（`#3D8BDE`/`#B05CE6`/`#FF8A1E`/`#F04A4A`） | 对齐 WoW 稀有度色相：普通 `#9D9D9D`、优秀 `#3FC24E`、稀有 `#2A7FDE`、史诗 `#A335EE`、传说 `#FF8000`、秘境 `#E03A3A` | [`camp-smith-filled.png`](../assets/2026-11-18-mithril-round25/camp-smith-filled.png) |

> **N89 / N90 已关闭**：N89 的厨房「生效中」/军需官统计与提示全部改成 `align:'left' + overflow:'shrink'`（原先只写 `align`，`Overflow.NONE` 会把节点缩到内容宽度继续居中）；N90 的等级条空槽已改木色、徽记图形亮度 95→150。
> **N107（`accepted`）**：营地遮罩 235α 下，野外图底部那行 8% 提示仍隐约可见（[`mask-bottom-leak.png`](../assets/2026-11-18-mithril-round25/mask-bottom-leak.png)）。遮罩 alpha 是 AGENTS 教训 H 的统一约定，单为一行字改全局 alpha 不划算 → 记录接受，不再追。复核清单里的 5 条 P2 与 5 条 P3 全部落地。

## 3. 改动清单

### 3.1 新增：`MithrilTheme.ts`

- `MITH_UI`：夜/石 7 色、木 3 色、黄铜 5 色、羊皮纸 4 色、语义 6 色；
- ~~`MITH_QUALITY`：WoW 稀有度色相~~（回修时删除：与 `MithrilConfig.QUALITIES` 重复，品质色唯一源改为 `QUALITY_BY_ID`）；
- 绘制助手：`drawDiamond`、`drawCampFrame`、`drawGoldDivider`、`drawInsetBoard`、`addButtonSheen`、`addHeaderDiamond`、`holdDiamondAccent`、`drawStoneTrim`。

### 3.2 营地：`MithrilCampPanel.ts`

- 面板 680×1180：木带页头（7 道暗纹 + 顶部受光 + 双金线）→ 石底 → 外框双线 + 四角铆钉；
- 页头左对齐：菱形饰件 + 「营地」38px `goldBright` + 返回键；第二行货币；
- 5 页签 120×46：未选石底 + 设施色图形；选中金底 + 墨字 + 墨色下划线；
- 设施说明块：徽记 → 名称/等级 → 当前效果 → 下一级效果，统一左对齐；
- 内容凹板 656 宽：暗底 + 顶部内阴影 + 金线 + 四角括线；内容整体下移 36px；
- 按钮统一 `addButtonSheen`；金底用 `T.ink`，购买/领取用祖母绿 + 羊皮纸；
- 空态：铁匠、附魔、训练、厨房、军需五处 + 悬赏空列表。

### 3.3 野外图：`MithrilWildMap.ts`

- 夜色底 + 石色顶带/暗色底带 + 金线；
- 页签与营地同规则；底部主按钮金底墨字，**营地 / 成长 / 装备 / 返回大厅四个次级按钮统一 `stoneLight` 石底 + 金边**，身份只由 12px 图标色承担（N99）；
- 节点色降到「旧地图颜料」档（N99）；可达圈由绿改黄铜；已清理小勾改 `emerald`；弹窗石底 + 金框。

### 3.4 角色 / 成长 / 选职业

- `MithrilMenu.ts`：令牌迁移 + `drawStoneTrim` + 详情空态图形；
- `MithrilGrowthMenu.ts`：令牌迁移 + `drawStoneTrim`，选中页签金底墨字；
- `MithrilClassSelect.ts`：选中卡暖皮革底 + 金边，主按钮金底墨字；
- `MithrilConfig.ts` / `MithrilArt.ts`：品质、设施、职业色收敛。

## 4. 界面巡检表

| 界面 | 状态 | 结果 | 证据 |
|---|---|---|---|
| 营地 · 铁匠铺 | 有装备 | PASS：列表行、品质色、重铸/分解按钮、升级块无重叠 | `camp-final.png` |
| 营地 · 附魔台 | 新档空态 | PASS：空态图形/标题/说明完整，费用行不再压字 | `camp-enchant-empty-final.png` |
| 营地 · 训练场 | 方案槽 0 / 有槽 | PASS：0 槽给解锁提示，不再渲染两个锁死槽 | `camp-training-round25b.png` |
| 营地 · 厨房 | 未建造 / 已建造 | PASS：未建造态补获取提示；建造后有 3 种料理行 | `camp-kitchen-empty-round25.png` |
| 营地 · 军需官 | 未建造 / 悬赏为空 / 有悬赏 | PASS：三种状态均有内容或空态，无半屏空白 | `camp-qm-empty-final.png` · `camp-quartermaster-round25.png` |
| 角色 · 装备 | 未选 / 已选 | PASS：未选有大图形提示；已选详情复位正常 | `menu-v3.png` |
| 成长 · 天赋/技能 | 默认 | PASS：同一石底 + 金框 + 金选中页签 | `growth-round25.png` |
| 选职业 | 新档 | PASS：选中卡暖皮革底 + 金边，主按钮金底墨字 | `class-round25.png` |
| 野外图 | 默认 | PASS：夜色底 + 石色带 + 珠宝色节点 + 黄铜可达圈 | 见 §6 复核截图 |
| 野外图 | 回修后 | PASS：节点色降饱和、四个次级按钮统一石底、音效按钮改羊皮纸色 | `wildmap-muted.png` |
| 营地 · 铁匠/附魔 | 有内容（注入） | PASS：五档品质色可辨、附魔 `·穿` 不再孤行、目标列表分页正常 | `camp-smith-filled.png` · `camp-enchant-filled.png` |
| 营地 · 厨房/军需 | 有内容（注入） | PASS：列表行有了统一行底，与铁匠/附魔同一样式 | `camp-kitchen-rows.png` · `camp-qm-rows.png` |
| 选职业 | 回修后 | PASS：「已选中」改金色，资源说明显式断行无孤词 | `classselect-gold.png` |

## 5. 空态与节奏（本轮重点）

**问题不是「空」，而是「空得没有信息」**。新档玩家打开营地，五个设施里有四个不可用；旧实现给一块大凹槽 + 一行灰字，看起来像加载失败。

统一空态结构（`_emptyState`）：

```
        [ 54px 设施/部位图形，goldDim 14α ]
              标题 20px parchmentDim
        说明 15px parchmentMuted（≤2 行）
        [ 禁用态操作按钮 / 获取提示 ]
```

同时按页面重排纵向节奏：

- 厨房：空态 y=120，下方保留「升到 Lv1 解锁 3 种料理」；
- 军需：空态 y=110 → 下一级 y=-30 → 材料/仓库提示 y=-170；
- 训练：0 槽时只给「训练方案还没解锁」+ 获取路径，效果文案下移到 y=-150；
- 附魔：左右都空时只留一个空态，费用行隐藏；
- 铁匠：整页无装备时才说「背包里还没有装备」，否则说「这一页没有装备」。

## 6. 独立复核

复核者为 **fresh 子代理**（无本轮开发上下文），只读巡检 + 页内探针 + 竖屏截图，结束时已 `browser_close`。

### 6.1 结论

> 「WoW 暗色方向已落地，无 **P0/P1**（无重叠、无越界、无不可读的金底文字、无控制台报错）；营地『奇怪』的观感基本消除。剩余都是排版与文案细节。」

### 6.2 缺陷与响应

| 复核级别 | 界面 | 现象 | 本轮处理 |
|---|---|---|---|
| P2 | 铁匠铺 / 附魔台（空态） | 空列表仍画列头，空态被推到凹板中部 | N96 `fixed` |
| P2 | 训练场（Lv0） | 文案指路「洗点 / 重置变体」，按钮却全禁用 | N97 `fixed` |
| P2 | 附魔台（有内容） | 「（穿）」被挤成只剩「）」的孤行 | N98 `fixed` |
| P2 | 装备面板 | 背包底到剑形图标约 370px 空白 | N102 `fixed` |
| P2 | 选职业 | 「怒气」孤行、「（站桩 / 输出）」断括号 | N103 `fixed` |
| P3 | 野外图 | 「音效 开」仍是旧 Tailwind 灰 | N105 `fixed` |
| P3 | 野外图 | 锁定区域页签 3.3:1 偏暗 | N105 `fixed` |
| P3 | 厨房 / 军需官 | 列表行没有行底，与铁匠/附魔两种行样式 | N101 `fixed` |
| P3 | 厨房 | 祖母绿按钮 / `parchmentMuted` 正文约 4.0:1 | N100 `fixed`（4.95 / 4.66） |
| P3 | 装备面板 | 空背包仍显示分页；0 件平均装等 1.0 | N104 `fixed` |

复核同时确认通过的项（不重复验证）：营地外框 / 木带 / 双金线 / 铆钉 / 凹板全部正常；页头「返回」在 235α 遮罩之上可连点 4 次；页签选中 = 金底 + 墨字 + 下划线 + 墨色图标；金底一律墨字；五设施空态齐备；mithril 脚本内旧 Tailwind 蓝紫/霓虹十六进制 **0 命中**；720×1280 内无压边；控制台 0 error。

### 6.3 复核打分（0–3）与本轮后自评

| 界面 | 复核 | 修完后自评 | 依据 |
|---|---|---|---|
| 营地 | 2.5 | **3** | 扣分项（空态列头 / 训练 Lv0 文案 / 行底不一致）已修 |
| 野外图 | 2.5 | **3** | 扣分项（音效灰 / 锁定页签偏暗）已修；另把节点与底栏配色拉回体系（N99） |
| 装备 | 2.0 | **2.5** | 详情凹板 + 分页/平均装等已修；仍未覆盖品质色分支实机 |
| 成长 | 2.0 | **2.0** | 6×5 天赋网格在 720 宽偏密，未动（复核认为可接受，属设计取舍） |
| 选职业 | 2.0 | **2.5** | 孤词/断括号已修；卡片小字密度仍是 §3.3 的 `wontfix` |

### 6.4 复核覆盖声明（复核者自述，摘录）

- 到达：野外图（有内容）、营地五页 ×2（有内容 + 真·新档 Lv0）、装备（有内容 + 空背包）、成长（天赋页）、选职业；
- 捷径：用 `Storage.prototype.setItem` 拦截存档键 + `loadScene('Mithril')` 拿到真正的 null 档（直接删档会被卸载时写回），未改游戏代码；`cc.view.setFrameSize(720,1280)` 只为放大判读；
- 未到达：战斗 HUD、选职业的「返回大厅」、饰品页签、技能页签、Lv4/Lv5 营地。

## 7. 覆盖声明

### 7.1 到达

- 营地五设施：新档空态（clean）+ 有内容态（注入）；
- 营地页头、页签选中/未选、设施说明块、内容凹板、返回键；
- 角色装备（未选/已选/空背包）、成长（天赋/技能）、选职业、野外图默认态；
- **回修后的复验**：铁匠/附魔空态（列头已隐藏）、训练场 Lv0 文案、附魔 `·穿` 后缀、装备详情凹板与选中态、空背包分页/平均装等、厨房与军需官行底、野外图新节点色与统一底栏、选职业金色「已选中」；
- **品质色分支**：注入档同时含 普通 / 优秀 / 稀有 / 史诗 / 传说 五档（秘银巨剑·传说、法师兜帽·稀有、板甲胸·史诗、塔盾·优秀、板甲腿·普通），在铁匠列表、附魔源/目标列表、装备详情三处实机取证；`秘境` 未取证。

### 7.2 声明式捷径

- **有内容态**：页内注入一份未落盘的存档对象，仅用于本轮截图，未调用 `_persist()`；关闭页面即消失。
- **新档空态**：清空 `tiny_games_mithril_save` 后整页 reload，走真实建号路径。
- 未使用 `debugGotoBoss()` 等会冻结页面的调试入口。

### 7.3 未到达 / 不可达

| 项 | 原因 | 下次 |
|---|---|---|
| 战斗 HUD / 暂停 / 结算 | 本轮范围外，且战斗中优先可读性 | UI 收尾补拍 |
| 胜利结算、地牢确认卡、区域 BOSS | 需真实进度或声明式捷径 | UI 收尾补拍 |
| 品质色 `秘境`（红）分支 | 注入档只放了另外五档 | UI 收尾补拍 |
| 微信真机 | 发布闸门，非本轮维度 | 发布回归 |
| 多视口 | 本轮仅桌面预览 | 交互拍 |

### 7.4 视口限制

开发者截图是桌面 Chrome **1280×720 CSS / dpr 1**，720×1280 设计分辨率被整体缩放到约 405×720 居中显示；因此 ≤2px 的细金线、14px 小字在截图上偏小，细节结论以复核子代理的竖屏截图与页内读数为准。

## 8. 校验

| 项 | 命令 | 结果 |
|---|---|---|
| TypeScript | 编辑器自带 `tsc --noEmit` | `TS_OK` |
| 核心逻辑 | `node tools/verify-mithril-core.js` | OK |
| 营地 | `node tools/verify-mithril-camp.js` | OK |
| 野外 | `node tools/verify-mithril-wild.js` | OK |
| 悬赏 | `node tools/verify-mithril-bounty.js` | OK |

本轮只改表现层，未改任何玩法/数值逻辑；上述脚本用于确认没有误伤。

## 9. 维度评分与下一步

| 维度 | 本轮前 | 本轮后（自评） | 说明 |
|---|---|---|---|
| UI | 2 | **2.5** | 统一视觉语言 + 五设施空态 + 复核 10 条全修；不给 3 是因为覆盖缺口还在：胜利结算、地牢确认卡、区域 BOSS 面板、事件/宝箱/篝火新 UI、品质色分支均未在本轮实机取证 |
| 玩法 / 交互 / 数值 / 稳定性 | 2 / 2 / 2 / 3 | 不变 | 只做表现层，未触碰逻辑 |

**下一步**：

1. UI 收尾补拍：胜利结算、地牢确认卡、区域 BOSS、事件/宝箱/篝火、品质色分支（走声明式捷径）；
2. 覆盖缺口清零后置 UI `frozen`，再进数值拍；
3. 复核提的两条设计取舍（成长天赋网格密度、选职业卡内小字）保持 `wontfix`，除非改设计分辨率。

## 10. stop_reason

`converged`：用户指定的 UI 焦点已完成实现、自检与一轮独立复核回修；P0/P1 = 0；复核开出 5 条 P2 + 5 条 P3，全部在本轮关闭；另修 N89/N90 两条 round24 遗留；仅 N107（遮罩下 8% 提示可见）记录为 `accepted`。UI 覆盖缺口转下一拍补拍，维度分 2 → 2.5。

**本轮实际耗费超出「单拍」预算**：实现 + 复核 + 回修 + 复验共走了三个 beat（构建视觉体系 → 复核 → 回修与配色收敛），但仍落在单批 3 拍内，故写 `converged` 而非 `budget`。
