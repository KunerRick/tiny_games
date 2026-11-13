# 第五轮闭环复验记录（2026-11-13）

> 范围：`docs/plans/2026-11-13-playtest-round5-endstates.md` 的 P1-1 与 P2-1 / P2-2 / P2-3。
> 方法：`tsc --noEmit` → `project_refresh_assets` → 预览 `http://127.0.0.1:7456/`
> `cc.director.loadScene()` 强推终局 → 真实 `mousedown`/`mouseup` 点击 → 读回场景名 / 面板状态 + 截图。
> 预览控制台：整页 reload 后 **0 error**（2 条引擎 `systemEvent` 弃用 warning，与项目无关）。

## 回归自检（全部通过）

- `tsc --noEmit`（编辑器自带 5.8.2）→ `TS_OK`
- `verify-match3-core.js` → 25/25；`verify-idiom-core.js` → 24/24
- `git diff --stat` → 仅 7 个 `.ts`（4 款结算 + 接龙 + 冰箱 HUD/Game），无场景/预制体改动

## 逐项结论

| # | 项 | 结论 | 证据 |
|---|---|---|---|
| P1-1 | 四款结算面板锁死玩家 | ✅ 已修 | ① 每款补「返回大厅」按钮；② 结算时把左上返回键 `setSiblingIndex` 抬到全屏遮罩之上。**12 次真实点击**（4 款 × 面板大厅键 / 左上返回键）全部回到 Lobby |
| P2-1 | 接龙首局不计入局数 | ✅ 已修 | 清档进场景 → `played=1`；`_onWin()` → `won=1, played=1`（100%）；旧档 `{played:0,won:2}` 读入后自愈为 2/2 |
| P2-2 | 冰箱死亡摘要 5 行 34 号字贴边 | ✅ 已修 | 拆成 6 个标签（标题 34 / 正文 23 / 最佳 20 / 奖励 23 / 附加 19 / 提示 17）；最宽正文行 358 设计像素（原 676），卡片 600×240 |
| P2-3 | 遮罩太浅、底层像能点 | ✅ 已修 | 四款 dim alpha 215 → 235（≈92%）；截图确认底栏退成背景 |
| N18 | 星际弹幕失败后背景静止 | ✅ 接受报告结论（本轮未改） | 报告已实测像素不再变化，代码在 `update()` 里显式跳过 |

## 改动说明

**P1-1（两款方案都做）**：报告建议「① 补按钮、② 调层级」二选一，实际两件都做了 ——
只做 ① 时左上返回键仍是死的（玩家可能先点那里）；只做 ② 时没有显式出口。
按钮布局（设计坐标，面板居中）：

| 游戏 | 三键行 | 备注 |
|---|---|---|
| 缤纷消除 | 有下一关：下一关 / 重来 / 返回大厅，w160 h72 @ x=-178/0/178；无下一关：再玩一次 / 重来 / 返回大厅，w230 @ x=-125/0/125 | `Match3Game.ts:754-771` |
| 扫雷 | 再来一局 / 换个难度 / 返回大厅，w164 h72 @ x=-178/0/178 | `MinesweeperGame.ts:724-746` |
| 数独 | 同上，行 y=-170 | `SudokuGame.ts:678-700` |
| 成语填字 | 再来一局 / 换个难度 / 返回大厅，w180 h72 y=-248 @ x=-196/0/196 | `IdiomGame.ts:715-737` |

遮罩仍在 `TOUCH_START` 吞事件（面板外点击不会误触底层），返回键靠兄弟序抬到最上层后正常收触摸。
`_backBtn` 在 `onDestroy()` 里只置 null，不碰节点。

**P2-1**：`_startNewGame(countAsPlayed = true)` 改为无参 `_startNewGame()`，**每次发牌都计一局**
（含进场景首局），`_restoreOrDeal()` 的兜底分支不再传 `false`。另外加了双保险：
`_loadStats()` 读档时 `played = Math.max(played, won)` 自愈旧脏数据；
显示处 `won = Math.min(won, played)` 兜底。`SolitaireGame.ts:483-517 / 1404 / 1641-1653 / 1795-1808`。

**P2-2**：死亡卡片从单个 `Dead` 标签拆成 6 个（`FridgeHud.ts:162-171`）——
标题按胜/负变色（成功绿 / 危险红），「冰箱贴 +N」用金币色强调，操作提示用次级色；
`FridgeGame.ts` 的 `_resultLines` 不再重复标题内容。`hideGameOver()` / `onDestroy()` 同步覆盖全部 6 个标签。

## 复验中踩到的坑（写代码时注意）

- `createButton(..., { onTap })` 调用回调时**不带 `this`**。扫雷那枚按钮初版写成
  `onTap: this.onBack`，运行时 `this` 为 undefined。类方法引用必须包一层 `() => this.onBack()`。
- 冰箱进场景先停在主菜单（`_core` 为 null）。要验死亡面板，需先
  `startNewRun({ charId:'pudding', mode:'normal', startFloor:1, heatCurses:[] })` 再置 `hp = 0`。
- 接龙战绩验证必须先 `localStorage.removeItem` **且整页 reload** ——
  活着的场景实例会把旧统计写回去，只清 storage 不 reload 会得出错误结论。

## 未处理（按报告优先级留在下一轮）

- 第四轮 P2-1（7 款左上装饰圆像污渍）、P2-2（弹幕遮罩压暗返回键）、P2-4（战争进化返回键皮肤）：
  视觉统一类，等美术定稿一起改。其中 P2-2 与本轮遮罩改动同源，弹幕那款可顺带复用 235 alpha 的做法。
- N13 后半（塔防建塔面板盖下半图）：布局重构，非 bug。
