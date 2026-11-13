# 第六轮闭环复验记录（2026-11-13）

> 范围：`docs/plans/2026-11-13-playtest-round6-player.md` 的 N19–N24。
> 方法：`tsc --noEmit` → `project_refresh_assets` → 预览 `http://127.0.0.1:7456/` 逐款
> `cc.director.loadScene()` + 页内探针定位 → 真实 `mousedown`/`mouseup` 点击 → 读回状态 / Label / alpha。
> 预览控制台整页 reload 后 **0 error**。

## 回归自检（全部通过）

- `tsc --noEmit`（编辑器自带 5.8.2）→ `TS_OK`
- `verify-thunder-core.js` → 64/64（`THUNDER_CORE_OK`）
- 本轮只改 `.ts`，无场景 / 预制体改动；接龙新增按钮为运行时创建，不落盘到场景

## 逐项结论

| # | 项 | 结论 | 证据（真实点击 / 读回） |
|---|---|---|---|
| N19 | 雷霆「退出本关」白拿 30 金币 | ✅ 已修 | 进第 1 关 → 点暂停 → 点「退出本关」：金币 **195 → 195（+0）**，结算「已退出本关 / 主动退出 · 不计失败保底 / 本局金币 +0」；对照真实死亡（3 次掉血 → 复活面板点「放弃」）：**195 → 225（+30）**，仍是「任务失败 / 被击落」 |
| N20 | 泡泡龙 / 推箱子点锁定关卡无反馈 | ✅ 已修 | 两款 `maxLevel=2`，点第 3 关（锁定）：均出现 toast「通关第 2 关解锁」，面板保持打开、不进入关卡 |
| N21 | 放置小店离线遮罩 215 | ✅ 已修 | `_showOfflineOverlay()` 后读 `OfflineOverlay` Graphics `fillColor.a = 235` |
| N22 | 接龙通关面板只有「再来一局」 | ✅ 已修 | WinPanel/Panel 新增 `WinLobbyBtn` 200×64 @ (110,-120)，「再来一局」移到 (-110,-120)；通关面板显示时真实点击「返回大厅」→ 进入 Lobby。截图 `.playwright-mcp/r6-solitaire-win.png`：两键并排、间距均匀 |
| N23 | 雷霆「生命 ×N」脱离战斗仍常驻 | ✅ 已修 | 返回关卡列表后 `_livesLabel.node.activeInHierarchy = false`（level/score/pause/bomb 同为 false）；重新进关后恢复 true |
| N24 | 雷霆结算遮罩 232 | ✅ 已修 | 结算 `SettleOverlay` Graphics `fillColor.a = 235` |

## 改动说明

- **N19**：`_quitBattle()` 置 `_quitByPlayer` 标记后走 `_finish(false)`；`_finish` 里
  `consolation = won || quit ? 0 : …`，并把 `quit` 传给 `_showSettle` 改用「已退出本关」标题、
  中性色边框与「主动退出 · 不计失败保底」说明。标记在 `_startBattle()` 里复位。
  主动退出仍保留本局已赚金币（只去掉失败保底），真实死亡 / 放弃复活仍拿 +30。
- **N20**：两款锁定关卡按钮的 `onTap` 从 `() => undefined` 改为弹 toast
  「通关第 N-1 关解锁」；点击后面板不关闭，玩家可继续选其他关。
- **N21 / N24**：遮罩 alpha 215 / 232 统一收敛到 **235**，与第五轮四款结算一致。
- **N22**：在 `_applyUnifiedTheme()` 里用 `ensureChild` + `makeLabel` + `skinButton` 运行时创建
  `WinLobbyBtn`（幂等），点击走命名方法 `_onLobbyClicked()` → `SceneManager.gotoLobby()`。
  「再来一局」按钮位置与宽度同步调整为 200×64 @ (-110,-120)，两键并排。
- **N23**：`_showBattleChrome()` / `_hideBattleChrome()` 补上 `_livesLabel.node.active`。

## 测试数据说明

探针为了让雷霆走到死亡结算，真实掉血并点了「放弃」，因此预览页
`tiny_games_thunder_save` 的金币从 195 涨到 225（与报告里的 195 不同属正常）。
其余键未改动。清档 + 整页 reload 可还原新手态。

## 未处理（仍留在后续轮次）

- 第四轮 P2-1（装饰圆像污渍）、P2-2（弹幕遮罩压暗返回键）、P2-4（战争进化返回键皮肤）：
  视觉统一类，等美术定稿。
- N13 后半（塔防建塔面板盖下半图）：布局重构，非 bug。
