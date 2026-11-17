# 秘银远征（mithril）· 试玩打磨台账

> 最后更新：2026-11-18 ｜ 当前阶段：**稳定**（P0/P1 = 0；五维 2 / 2 / 2 / 2 / 3）
> 下一批建议焦点：**UI 收尾** → 数值 → 交互（理由见 §7）
> 协议：[`../tech/playtest-cycle.md`](../tech/playtest-cycle.md) ｜ 五维方法：[`../tech/playtest-dimensions.md`](../tech/playtest-dimensions.md)
> 全局下一编号：**N91**（见 [`playtest-ledger-index.md`](./playtest-ledger-index.md)）
>
> 报告是 append-only 证据，本文件是唯一状态源。状态变更由主会话落账，复核者只建议。

---

## 1. 维度状态

| 维度 | 打磨分 | 未关闭 P0/P1 | 未关闭 P2/P3 | 覆盖缺口 | 最近全量轮 |
|---|---|---|---|---|---|
| UI | 2 | 0 | 2（N89/N90，P3） | 胜利结算、地牢确认卡、BOSS 面板、事件/宝箱/篝火新 UI、装备品质色分支 | round24 |
| 玩法 | 2 | 0 | 0 | 区域 BOSS 实机、品质色分支、变体内容 7/24（内容缺口，非缺陷） | round24（系统盘点 round16/23） |
| 交互 | 2 | 0 | 0 | 输入延迟 / 连点 / 多视口交互未做全量清单 | round23/24 |
| 数值 | 2 | 0 | 0（watch：区域 BOSS 低装等 TTK） | 三进度点未在同一拍取样；面板 vs 实际未逐字段全量核对 | round23（脚本）/ round22（面板口径） |
| 稳定性 | 3 | 0 | 0 | 微信真机未验（属发布闸门，不阻塞维度分） | round20（构建冒烟）/ round24（回归） |

**阶段判据**：可玩（P0/P1=0）✅ → 稳定（稳定性=3 + 连续 2 拍无回归）✅ → 精致（五维全 ≥3 或 frozen）⏳

## 2. 覆盖矩阵

### 2.1 界面

| 界面 | 首验轮 | 最近验证 | 状态 | 备注 |
|---|---|---|---|---|
| 游戏大厅 | round24 | round24 | 已覆盖 | 24 卡专属图形，pass |
| 野外地图 | round10 | round24 | 已覆盖 | N76 页签装饰已修 |
| 地图 · 节点选中 | round10 | round24 | 已覆盖 | pass |
| 选择职业（新档） | round24 | round24 | 已覆盖 | N81 已修（卡内小字接受现状） |
| 战斗 HUD | round10 | round24 | 已覆盖 | N82–N85 已修 |
| 暂停面板 | round23 | round24 | 已覆盖 | 四按钮真实点击通过 |
| 死亡结算 | round15 | round24 | 已覆盖 | N86 换行居中已修 |
| 战斗胜利结算 | round23 | round24 | **部分覆盖** | round23 有真实胜结算；round24 未复看新 UI |
| 营地 × 5 设施 | round13 | round24 | 已覆盖 | N75/N76 已修；N89/N90 待修 |
| 角色 · 装备 | round21 | round24 | **部分覆盖** | N77 已修；**品质色分支存档为空未取证** |
| 角色 · 饰品 | round16 | round24 | 已覆盖 | N78 图形已补；协鸣图形 deferred |
| 成长 · 天赋 | round10 | round24 | 已覆盖 | N79/N87 已修 |
| 成长 · 技能 | round10 | round24 | 已覆盖 | N80 已修；变体槽位 deferred |
| 事件 / 宝箱 / 篝火弹窗 | round12 | round13 | **部分覆盖** | 功能验证过；round24 新 UI 轮未复看 |
| 地牢确认卡 | round23 | round23 | **部分覆盖** | E2 通过；round24 未复看 |
| 区域 BOSS 战 / 结算 | — | — | **未覆盖** | 低等级打不到；需声明式捷径 |
| 悬赏板（军需官） | round24 | round24 | **部分覆盖** | 五设施页内看过；悬赏交互未全量 |
| 结算 / 奖励面板 | round22 | round24 | 已覆盖 | 首通记账 + 12 行排版已验证 |
| 音效 / 震动开关 | round23 | round23 | 已覆盖 | 即时刷新 |

### 2.2 系统

| 系统 | 状态 | 自动覆盖 | 下次验证点 |
|---|---|---|---|
| 战斗基础 | 已覆盖 | `verify-mithril-core` | 手感项转交互维 |
| 4 职业 × 6 技能 | 已覆盖 | `verify-mithril-core` / `-dungeons` | 变体内容缺口单独排期 |
| 装备 | **部分覆盖** | `verify-mithril-core` / `-camp` | 品质色 + 词条可感知 |
| 饰品 / 协同 | 已覆盖 | `verify-mithril-trinkets`（48 场自动战斗） | — |
| 天赋 / 洗点 | 已覆盖 | `verify-mithril-core` | 玩家向可读性转 UI |
| 营地 | 已覆盖 | `verify-mithril-camp` | — |
| 悬赏 | 已覆盖 | `verify-mithril-bounty` | — |
| 野外 / 补给 / 节点类型 | 已覆盖 | `verify-mithril-wild`（2828 项） | — |
| 副本 / 首通 | 已覆盖 | `verify-mithril-dungeons`（4×6 自动通关） | — |
| 区域 BOSS | **部分覆盖** | `verify-mithril-balance` | 推荐装等附近实机 TTK |
| 存档迁移 | 已覆盖 | `verify-mithril-balance` | — |
| 音效 / 震动 | 已覆盖 | `verify-mithril-audio`（88 项） | — |

## 3. 问题台账

### 3.1 已关闭（按区间归档；逐条证据在各轮报告）

| 区间 | 级别 | 维度 | 引入轮 | 关闭轮 | 证据 |
|---|---|---|---|---|---|
| N36–N38（含 N36a） | P2/P3 | UI / 玩法 | round10 | round10 | round10 报告；[`m3 acceptance`](./2026-11-15-mithril-m3-acceptance.md) |
| N39–N48 | P1/P2/P3 | 玩法 / UI | round11 | round12 | [`round12`](./2026-11-15-playtest-round12-mithril-m4-recheck.md) 逐条 PASS |
| N49–N52 | P3 | UI / 交互 | round12–13 | round14 | [`round14`](./2026-11-15-playtest-round14-mithril-m5-recheck.md) |
| N53 | P3 | UI | round15 | round16 | round16 报告回归节 |
| N54–N57 | P2/P3 | 玩法 / 交互 / UI | round16 | M7 验收 | [`m7 acceptance`](./2026-11-15-mithril-m7-acceptance.md) §6 |
| N61–N63 | P2/P3 | UI | round21 | round22 | [`round22`](./2026-11-16-playtest-round22-mithril-p25.md) 复核表 |
| N64 | P3 | UI / 数据口径 | round22 | round22 | round22 复核表（面板与金币增量自洽） |
| N66–N74 | P1/P2/P3 | 交互 / 玩法 / UI | round23 | round23 | [`round23`](./2026-11-17-playtest-round23-mithril-deep.md) 两轮独立复核 |
| N75–N88 | P1/P2/P3 | UI / 交互 | round24 | round24 | [`round24`](./2026-11-17-playtest-round24-mithril-ui.md) §10（含修复中新发现 N87/N88） |

### 3.2 未关闭

| ID | 级别 | 打磨分 | 维度 | 状态 | 引入轮 | 现象 | 下一步 |
|---|---|---|---|---|---|---|---|
| N89 | P3 | 2 | UI | `open` | round24 | 营地页头改左对齐后，厨房「生效中」、军需官悬赏块仍是 `x:0/width:620` 居中，同屏混排 | UI 收尾拍：改为 `x:34/width:552/align:'left'`，与 N90 一并实机复验 |
| N90 | P3 | 2 | UI | `open` | round24 | 营地页头徽记与等级条对比度偏低（需放大 480% 才看清纹章；Lv0 等级条与底色几乎同色） | UI 收尾拍：调 `drawGlyphMedallion` 琥珀亮度与未点亮段颜色 |

### 3.3 有意保留 / 延期

| 项 | 级别 | 维度 | 状态 | 原因 | 复查条件 |
|---|---|---|---|---|---|
| N78「协鸣规则用图标/连线表达」 | P3 | UI | `deferred` | 需重新设计信息图；当前两段文字可读 | 有信息图设计或 UI 专项余量时 |
| N80「变体用图形槽位」 | P3 | UI | `deferred` | 槽位卡会与 6 行技能列表抢空间 | 技能页重排时 |
| N81「职业卡内小字偏挤」 | P3 | UI | `wontfix` | 字号已到 14–16px 可读下限；292×246 卡片在 720 宽已排满 | 改设计分辨率或卡片布局时 |
| 区域 BOSS 低装等 TTK ≈ 140 s | — | 数值 | `watch` | N69 按「推荐装等 12」标签与 balance 脚本通过判 PASS；低装等硬闯仍很苦 | 数值拍：在推荐装等附近复测 TTK，确定可接受区间 |

## 4. 收敛指标（每拍）

| 轮 | 日期 | 焦点 | 新开 P2+ | 关闭 | 净增 | 回归 | 新增覆盖 | stop_reason |
|---|---|---|---|---|---|---|---|---|
| 21 | 2026-11-16 | M12 词条 / 菜单 | 3 | 0 | +3 | — | 菜单 / 排版 | converged（修复待复核） |
| 22 | 2026-11-16 | 复核 + 首通记账 | 1 | 4 | −3 | PASS | 结算口径 | converged |
| 23 | 2026-11-17 | 深度回归 | 9 | 9 | 0 | PASS | 暂停 / 返回 / 远程锁定 / 首战 | converged（两轮复核） |
| 24 | 2026-11-17 | **UI 全量首扫** | 16 | 14 | +2 | PASS | 12 屏 + 新增 N87/N88/N89/N90 | converged |

**读法**：第 24 轮是新开 UI 维度的首拍，新开数高属预期（此前从未逐屏扫）；
**下一拍 UI 收尾若新开 P2+ 仍 > 3，按协议 §10.3 停止试玩、回到实现诊断**，不要继续加拍。
同维度连续两拍新开 P2+ ≤ 1 且无回归 → UI 可置 `frozen`。

## 5. 冻结 / 解冻记录

| 维度 / 系统 | 状态 | 轮次 | 理由 |
|---|---|---|---|
| 稳定性（桌面 / 构建） | 候选冻结 | round24 | 连续 2 拍无回归、0 error、构建冒烟通过；下一拍回归冒烟通过即置 `frozen` |
| 其他维度 | 未冻结 | — | 见 §1 覆盖缺口与打磨分 |

## 6. 环境与存档约定

- **预览**：`http://127.0.0.1:7456/`（编辑器预览）；构建产物冒烟用 `http://127.0.0.1:8127/index.html`（round20/22 先例）。
- **存档键**：`tiny_games_mithril_save`。
- **两个 profile**：
  - `clean`：清档新档，用于新手前 3 分钟、空态、首战；
  - `progress`：接近目标进度的真实档，用于 BOSS / 高等级界面。
- **快照**：拍前把 `localStorage` 值导出到变量 / 文件；恢复用 `page.addInitScript` 在 reload **之前**写入
  （reload 前直接写会被卸载时的 `_persist()` 盖掉）。
- **已知工具坑**（详见 [`browser-verify-cocos-preview.md`](../tech/browser-verify-cocos-preview.md)）：
  - 点击换算系数 `k` 每轮现场标定（出现过 1 / 2 / 1.225）；
  - 桌面拖拽结束是 `TOUCH_CANCEL`；监听挂共同父级；
  - 改 `.ts` 后先 `project_refresh_assets` 再整页 reload；
  - `debugGotoBoss()` 在普通节点会死循环冻结页面，复核不要这样用；
  - 结束必须 `browser_close`；headless 残留会烧 CPU。
- **捷径声明**：注入存档 / 调 debug 必须写进报告「覆盖声明」；纯净路径结论不得建立在捷径上。

## 7. 下一批建议焦点 + 理由

1. **UI 收尾拍（首选）**
   - 修 N89 / N90；
   - 用声明式捷径补覆盖：胜利结算、地牢确认卡、区域 BOSS 面板、事件/宝箱/篝火新 UI、装备品质色分支；
   - 复审 §3.3 的三条 deferred / wontfix 是否仍成立；
   - 目标：UI 打磨分 2 → 3，覆盖缺口清零 → 置 `frozen`。
2. **数值拍**
   - 跑 `verify-mithril-balance.js` + `-dungeons` / `-trinkets`；
   - 三进度点（新档 Lv1 / 首个区域 BOSS 推荐装等 / 第二区域入口）各实测 10–15 分钟；
   - 确定区域 BOSS 的 TTK 可接受区间，把 `watch` 判成 `within` 或 `defect`；
   - 结算面板逐字段核对（首通 / 满包折算 / 材料溢出）。
3. **交互拍**
   - 按 [`playtest-dimensions.md`](../tech/playtest-dimensions.md) §3.2 的 15 项清单全量走一遍；
   - 重点：输入延迟、连点、禁用态反馈、多视口（1280×720 / 414×896，resize 后 reload）。
4. **玩法拍**
   - 系统盘点表逐项补齐「可感知 / 有意义选择 / 闭环」；
   - 重点补装备品质色、变体实际行为、悬赏指标可达成性；
   - 功能正确性主要信自动矩阵，实机只抽玩家向可读性。
5. **稳定性 / 发布回归**
   - 等 UI / 数值冻结后做；跑 `check-wechat-build.js` + `replay-wechat-bundle.js` + 微信真机。

---

## 8. 数据来源

- 各轮报告：`docs/plans/*-playtest-round*-mithril*.md`（round10–24）；
- 验收记录：`docs/plans/2026-11-14-mithril-m1-acceptance.md` … `2026-11-16-mithril-m11-acceptance.md`；
- 体验官报告：`docs/plans/2026-11-17-mithril-experience-review.md` 与 `-fixes.md`（E1–E7，已处理）；
- 回归脚本：见 [`verify-scripts.md`](../tech/verify-scripts.md) 的秘银部分。
