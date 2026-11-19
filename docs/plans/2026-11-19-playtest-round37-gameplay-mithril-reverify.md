# round37 玩法修复批 · 独立复核（reverify）

> 角色：独立复核者（fresh 上下文，未参与修复）
> 复核对象：`docs/plans/2026-11-19-playtest-round37-gameplay-mithril.md`（N190 / N192 / N191 / N193 / N194 / N198）
> 环境：Cocos Creator 3.8.8 预览 `http://127.0.0.1:7456/`，HEAD `9301bb3`，branch `develop`
> 时间：2026-11-19；预算内完成
> 纪律：未改任何 `.ts` / `.scene` / `.prefab`，未提交 git；预览/MCP 单例由本轮独占；收工已 `browser_close`

---

## 1 结论摘要表

| 项 | 优先级（开发） | 复核结论 | 证据强度 | 备注 |
|----|--------------|---------|---------|------|
| **N190** 地图种子一致 | P2 | **CONFIRMED** | 代码 + 实机双向 | 4 条结束路径全部轮换；副本不结束远征（报告措辞需修正） |
| **N192** 预警圈可读性 | P2 | **CONFIRMED（渲染层）** | 代码 + 声明式注入实测 | 真实 BOSS 战未到达，按「渲染层可见」降级验收 |
| **N191** 脚环/阴影（partial） | P2 | **CONFIRMED（partial）** | 代码 + 实机截图 | 只画不写、顺序正确；保持 `open` |
| **N193** 天赋点反馈 | P3（开发建议） | **维持 P2**（复核上调） | 代码 + 实机 | 症状「点了没反应」仍在；提示行离卡片 ~360 CSS px、字号 ~8 CSS px |
| **N194** 生命上限重复叠加 | P3 观感 | **CONFIRMED 非缺陷** | 代码 + 实机数值 | 只加 delta；同意 P3 观感（文案应写「上限 +N」） |
| **N198** 职业卡只显示一个 | P3 观感 | **REFUTED「只显示一个」** | 实机截图 + 节点树 | 四张卡全 `activeInHierarchy`；未选中卡偏暗是诱因 |
| 闸门 | — | **全绿** | 5/5 退出码 0 | 见 §3 |
| 冒烟 | — | **通过** | 控制台 0 error | 见 §4 |

---

## 2 逐条证据

### N190（P2）地图种子一致 —— CONFIRMED

**代码取证（`MithrilGame.ts`）**
- `onWildPrimary()`（L497）`: const seed = this._mapSeed;` 随后 `save.expedition = createExpedition(...)`，即远征建图用的是「当前地图种子」。
- `_ensureMapFor()`（L286-292）`: const seed = exp && exp.regionId === id ? exp.seed : this._mapSeed;` —— 有同区域远征时优先用 `exp.seed`，保证「进图看到的」与「存档里的」一致。
- `_rotateMapSeed()`（L301-304）为 LCG：`seed' = ((Math.imul(seed,1664525)+1013904223)>>>0)&0x7fffffff`。
- **穷举 `expedition = null` 的四条路径**，全部紧跟 `_rotateMapSeed()`：
  1. L510 `_abandonExpedition`
  2. L920 `_expeditionDown`（路线图死亡）
  3. L1294 BOSS/区域通关结算
  4. L1307 战斗死亡
  脚本内未发现「清空远征但不轮换」的路径。

**实机取证（预览）**
- 进「开始远征」后：预览 `_mapSeed` = `save.expedition.seed` = `_wildMap.seed` = `1431513760`，节点种类序列完全一致：
  `0:start, 1:battle, 2:battle, 3:event, 4:battle, 5:elite, 6:chest, 7:supply, 8:battle, 9:dungeon, 10:dungeon, 11:boss`。
- 放弃远征：`1904059650 → 750854265`（与 LCG 逐位吻合），节点种类随之改变，`expedition` 变 `null`。
- 战斗死亡：`750854265 → 553570180`（LCG 吻合）。
- 第三次轮换：`553570180 → 871503123`。
- 远征途中整页 reload：`_wildMap.seed == exp.seed`（地图不变），而 `_mapSeed` 被重置为 `Date.now()` —— 证明「远征地图由存档种子决定、不随临时的 `_mapSeed` 漂移」。

**结论**：CONFIRMED。报告描述基本成立，但**「副本通关」一条实为路线图死亡 `_expeditionDown`；副本（dungeon）本身并不结束远征**，属措辞不精确（不影响修复正确性，已在 §8 记录）。

### N192（P2）预警圈可读性 —— CONFIRMED（渲染层）

**代码取证（`MithrilRenderer.ts` `_drawTelegraphs` L328-359）**
- `k = t / warn`；填充 alpha `90 + k*85`；描边 alpha `210 + k*45`；`lineWidth = 5`；内圈 `lineWidth = 3`，内圈半径 `radius*(1-k)+6`。

**实机取证（声明式注入 `{x,y,radius:120,kind:'slam',warn:2}`，连拍 3 帧）**
- 直径：横向 129 CSS px、纵向 374–502 = 129 CSS px（画布宽 393 CSS px）—— 半径 120 设计 px × 0.537 ≈ 64.5，直径 ≈ 129，吻合。
- 填充色 RGB `(141,49,53)` vs 地板 `(20,26,34)`，对比明显；描边亮带 2–3 CSS px（5 设计 px × 0.537 ≈ 2.7）。
- 内圈可见（y=410 / y=467 两处亮环）。
- 三帧截图：`r37r-02-telegraph-f0/f1/f2.png`，随时间推进填充/描边变亮。
- 层级：玩家脚印在预警圈**之前**绘制（不遮挡圈）；敌人阴影在之后绘制但仅约 9×3 CSS px，不构成实质遮挡。

**降级说明**：存档 ilvl ≈ 2，BOSS 推荐 12，**真实 BOSS 战未到达**；未做存档注入。按「渲染层可见」验收，不宣称「实战可读性」全绿。

**结论**：CONFIRMED（渲染层）。

### N191（P2，partial）脚环/阴影 —— CONFIRMED（partial），保持 open

- 代码：`_drawPlayerFootMark`（L304-326）**只读**，不写 core，`PLAYER_RADIUS = 18` 未变；渲染顺序 `_drawFloor → _drawPlayerFootMark → _drawTelegraphs → …`，符合报告。
- 实机（`r37r-04-combat-footprint.png`、`r37r-04-combat-player-zoom.png`（+4x）`r37r-04-combat-enemies-zoom.png`（+4x））：脚下深色椭圆阴影 + 战士橙色淡环可见；敌人也带阴影。
- **观察**：战士脚环色 `#F59E0B` 与橙色小恶魔同色系，密集怪群时「找自己」信号被削弱（属新观察，见 §8，不并入 N191 结论）。

**结论**：partial 成立，**N191 保持 `open`**。

---

## 3 闸门表

| 闸门 | 命令 | 结果 | 日志 |
|------|------|------|------|
| core 自检 | `node tools/verify-mithril-core.js` | **245/245，exit 0** | `/tmp/r37r-gate-core.log` |
| wild 自检 | `node tools/verify-mithril-wild.js` | **2975，exit 0** | `/tmp/r37r-gate-wild.log` |
| dungeons 自检 | `node tools/verify-mithril-dungeons.js` | **892，exit 0** | `/tmp/r37r-gate-dungeons.log` |
| balance 自检 | `node tools/verify-mithril-balance.js` | **139，exit 0** | `/tmp/r37r-gate-balance.log` |
| 编辑器 tsc | Creator 3.8.8 自带 `tsc --noEmit` | **exit 0** | `/tmp/r37r-gate-tsc.log` |

---

## 4 冒烟

- 控制台：整轮 **0 error / 2 warning**（warning 为引擎 `systemEvent` 弃用提示，非本轮引入）。
  - 注：中途曾出现 78 条 `getComponent: Type must be non-nil`，经定位是**我自己的探针**误用 `cc.UITransform`（非全局）所致；`?t=` 重载并改用字符串类名后归零，**非游戏缺陷**。
- Lobby ↔ Mithril 往返（暂停菜单「返回大厅」→ Lobby → mithril GameIcon）：返回后仍保留远征 seed `871503123` / hp `93` / visited `[0,1]` / 天赋 2 点。
- 整页 reload（`?t=r37r-4`）读回一致：level 2 / exp 10 / gold 5010。

---

## 5 覆盖声明

**到达 / 已覆盖**
- 荒野地图开局建图、放弃远征轮换、战斗死亡轮换、第三次轮换、远征途中 reload。
- 预警圈渲染（声明式注入 slam warn=2，3 帧连拍 + 像素测量）。
- 战斗中的脚印/阴影（玩家与敌人，含 4× 放大截图）。
- 天赋面板无点数时的提示行（文案/颜色/active/坐标）。
- `setProfile` 上限变化对当前血量（声明式调方法）。
- 职业选择四卡节点树 + 截图。
- 五道闸门 + Lobby↔Mithril 往返 + reload。

**声明式捷径（均已在取证时说明是否影响判定）**
| 注入 | 是否影响判定 | 说明 |
|------|-------------|------|
| 预警圈 `{x,y,radius:120,kind:'slam',warn:2}` 写入 `_core.telegraphs` | 否（仅渲染层） | 只验证 `_drawTelegraphs` 的可见性，不改任何结算逻辑；真实 BOSS 战未到达已降级声明 |
| `core.setProfile({maxHp:+20})` 后读 hp | 否 | 单纯验证「只加 delta」，验证后已把 hp 恢复为 pre-test 254.16/258 |
| 存档快照/还原（CORS 本地服务器 + `sessionStorage` 一次性守卫） | 否（仅环境还原） | 纯 localStorage 写回，不参与任何判定；见 §6 |

**未到达 / 不可达**
- **真实 BOSS 战**：存档 ilvl ≈ 2、BOSS 推荐 12，未做存档注入去拔高进度；N192 按「渲染层可见」降级验收。
- 副本（dungeon）内玩法流程未走完整闭环（N190 只验证副本**不结束**远征，这已由代码穷举确认）。

---

## 6 存档往返

| 阶段 | 长度 | sha256 |
|------|------|--------|
| 开工前快照（`.playwright-mcp/r37r-save-before.txt`） | **1813** | `b381ab617d1bec0ca3fbc87ea91ed302a1ae480382c6a751f482d82fcebee769` |
| 收工还原后读回 | **1813** | `b381ab617d1bec0ca3fbc87ea91ed302a1ae480382c6a751f482d82fcebee769` |

- 还原方式：`page.addInitScript` + `sessionStorage` 一次性守卫（守卫键 `__r37r_done_1`，本轮新键），写回 `localStorage['tiny_games_mithril_save']` 后带 `?t=` 整页 reload 读回。
- 逐字段核对（与原快照一致）：
  - classId `warrior`，level `2`，exp `10`，gold `5010`
  - expedition.seed `1818887116`，visited `[0,1,3]`，hp `212`，supply `0`
  - talents `{}`

**脱敏 / 隔离**：快照含存档原始 JSON，仅落 `.playwright-mcp/`（已 gitignore），未进版本库。

---

## 7 stop_reason

`budget` —— 六个复核项 + 五道闸门 + 冒烟全部完成，时间预算内收工。两处天然的验收降级已如实记录：① 真实 BOSS 战未到达（N192 只能验到渲染层）；② 副本内完整闭环未走（N190 仅验证「副本不结束远征」这一代码事实）。N193 的提示行距离/字号与开发者报告的自测值不一致（我测得 ~360 CSS px 远、~8 CSS px 大字，开发者记的是 ~10 设计 px / 5.5 CSS px），不影响「反馈存在」的结论，但影响「可达性」判断。

---

## 8 新发现（只描述，不自编号）

1. **战士脚环配色与橙色小恶魔撞色**（关联 N191）：`CLASS_PROJECTILE_COLOR.warrior = #F59E0B` 与橙色敌人同色系，密集怪群中脚环「找自己」的信噪比下降。建议后续考虑给脚环加与敌人无关的对比色/闪烁，或提高环线 alpha。
2. **N193 提示行可达性差**：实测提示「没有可用天赋点」位于页面 (640,620)，距被点卡片约 **360 CSS px**，字号约 **8 CSS px**（15 设计 px × 0.537）。虽然反馈存在，但玩家在当前视野内几乎不会注意到 —— 这是我把优先级**维持 P2** 的实机依据。建议改为卡片旁 toast / 气泡，或直接在卡片上做禁用态。
3. **开发者报告措辞不精确**：报告写「副本通关」会清空远征，实际清空远征的是**路线图死亡 `_expeditionDown`**；副本（dungeon）本身不结束远征。不影响修复，但会误导下一轮读者，建议在落账时改口径。
4. **N198 未选中卡偏暗**：`ClassCard_*` 四张全在树且 `activeInHierarchy`，但未选中卡体色偏暗（body `b9ab8b`、「点击选择」副标题 `8a7e66`），视觉上易被读成「禁用/只剩一个可选」。同意 P3 观感，若后续打磨可给未选中卡加轻微描边或提高副标题对比。

---

> 截图目录：`docs/assets/2026-11-19-mithril-round37r/`（gitignored，不提交）
> 落账由主会话完成；本报告不含任何 git 操作。
