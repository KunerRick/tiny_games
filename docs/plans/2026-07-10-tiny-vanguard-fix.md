# 小小先锋漏洞修复计划

## 背景

对 `assets/games/game_tiny_vanguard/` 全量代码 review 后发现的逻辑漏洞修复计划。

---

## Bug 1 (P0): 战斗节点未标记 completed

**文件**: `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`

**现象**: 战斗胜利后路线图节点未标记已完成，玩家无法推进到后续节点。

**根因**: `completeNode()` 只在 `completeNonBattleNode()` (shop/rest/event) 中被调用，战斗胜利后没有任何地方调用它。

**修复**: 在 `onVictoryContinue()` 中，处理非 boss 胜利时补上 `routeMapUI.completeNode(this._currentNode.id)`。

---

## Bug 2 (P0): `isReachable()` 方向反了

**文件**: `assets/games/game_tiny_vanguard/scripts/ui/RouteMapUI.ts`

**现象**: 除了节点 0 硬编码可到达外，其他节点均不可到达。

**根因**: `RouteNode.connections` 存的是"从当前节点能去往的节点ID"（正向边），但 `isReachable()` 错误地用它来检查"是否有已完成的节点能到达当前节点"。应该反向查找：检查是否有某个节点的 `connections` 包含当前节点且该节点已完成。

**修复**: 将 `isReachable` 改为反向查找逻辑。

---

## Bug 3 (P1): 成就解锁未持久化

**文件**: `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`

**现象**: 胜利后达成的新职业解锁（knight / assassin）在下次启动游戏时丢失。

**根因**: `SaveManager.saveMeta()` 在 `checkAchievements()` 之前调用，`checkAchievements()` 修改了 `_runData.unlockedClasses` 但没有再次保存。

**修复**: 在 `checkAchievements()` 完成后重新保存 meta。

---

## Bug 4 (P1): teleport 技能缺少 'tile' 目标选择

**文件**: `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

**现象**: teleport 技能（targetType: 'tile'）在选择目标时永远返回空数组，无法使用。

**根因**: `getValidSkillTargets()` 只处理了 `'enemy'` / `'ally'` / `'aoe'` 三种 targetType，`'tile'` 以及 `'self'` 类型落入 `return []` 默认分支。

**修复**: 增加 `'tile'` 分支，返回 6x6 棋盘上所有未被占用的格子位置。

---

## Bug 5 (P2): auto-skip 延迟期间 `finishUnitTurn` 回调与用户输入冲突

**文件**: `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

**现象**: `_checkAutoSkipIfNoTargets` 设置 `hasActed=true` 后用 `scheduleOnce` 延迟 0.6s 调用 `finishUnitTurn`，在此期间玩家点击其他己方单位会切换选中，导致延迟回调触发时 `_currentUnitIndex` 已改变，造成单位索引错乱。

**修复**: 在 `finishUnitTurn` 开头增加 `isValid` 守卫，检查 `_selectedUnit` 是否仍指向正确的单位；同时在 auto-skip 期间禁用格子交互。

---

## 修复顺序

1. Bug 1 — 路线图可推进
2. Bug 2 — 路线图可推进（配合 Bug 1）
3. Bug 3 — 存档正确性
4. Bug 4 — 技能可用性
5. Bug 5 — 输入安全
