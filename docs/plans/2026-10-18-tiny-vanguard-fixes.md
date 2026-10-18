# Tiny Vanguard 四项缺陷修复（2026-10-18）

> 玩家实测提出 4 个问题（用户编号 1 / 2 / 4 / 5），本文件是**计划落档 + 实测验收记录**。
> 相关技术细节已抽到 [`../tech/cocos-scheduler-and-tween-pitfalls.md`](../tech/cocos-scheduler-and-tween-pitfalls.md)
> 与 [`../tech/wechat-text-rendering.md`](../tech/wechat-text-rendering.md)。

---

## 0. 一览

| 需求 | 现象 | 根因 | 提交 |
|------|------|------|------|
| **1** | 微信上战士图标右侧一个小方框；部署槽卡有方框、拖到地图上反而没有 | 两张**分叉的图标表**：`GameData.CLASSES[].icon` 带变体选择符 VS16，`UnitController.CLASS_ICONS` 不带。微信字体缺 VS16 字形 → tofu 方框 | `aceaf9a` |
| **2** | 单位高亮（期望下一步移动）时点单位自己，回合直接结束；本回合想放技能也不行 | 「点自己」分支不可逆（直接 `hasMoved=true` → `action`），且自动跳过**只看普通攻击射程**、无视技能，0.6s 后强制 `finishUnitTurn()`；`_cancelAutoSkip()` 只在「待命/结束回合」调用 | `db1e266` |
| **4** | 双方各剩 2 单位时敌方回合直接卡死 | 在 `_onAINextStep` **自身的触发中**再 `scheduleOnce(this._onAINextStep, …)`：引擎把同 `(target, method)` 判为重复排期、随后按一次性计时器取消 → **静默丢弃**，`_phase` 永远停在 `enemy_turn` | `044a946` |
| **5** | 选定技能后只能点敌方单位，无法切换/取消 | `onSkillUsed` 开头卡死 `_phase !== 'player_turn'` → 进入 `skill_target` 后技能按钮全成死键；取消路径硬编码回 `'action'`；`finishUnitTurn` 在非 `player_turn` 早退 → 留下脏相位 | `4e864da` |

**用户已定的设计口径**（不再确认）：自动跳过只应被「**真有用**」的技能拦住 ——
①技能射程内有敌人的；②自身增益类；③友方能吃到效果的。**不算** AoE 点空位、没意义的位移。

实施顺序：**4 → 1 → 2 → 5**（卡死会阻塞所有人工验证；2 与 5 都改
`onCellClicked` / `onSkillUsed`，必须串行）。每项完成后：
改 `.ts` → `node "$TSC" --noEmit` → `project_refresh_assets` → 重载预览 → `typeof` 确认新代码已加载。

---

## 1. 需求 4：敌方回合卡死 → `update()` 泵 + 看门狗

**方案**：把「延迟」从调度器状态降级成一个**数字**，推进交给每帧轮询；再加一个心跳看门狗
兜住"链路万一还是断了"。

- 新增 `_clock` / `_aiNextStepAt` / `_aiWatchdogAt` 三个数字 + 新增 `update(dt)`
  （全项目游戏脚本此前**无 `update`**）。
- `_processNextAIUnit()`：每拍入口续期看门狗；已阵亡敌人改 `while` 循环排空（原为自递归）；
  补间回调开头加 `if (this._phase !== 'enemy_turn') return;`；结尾**不再 `scheduleOnce` 自身**，
  改为 `this._aiNextStepAt = this._clock + (acted ? 0.34 : 0.10)`。节奏常量与语义**逐字保留**。
- 删除 `_onAINextStep`，避免两套机制并存。
- `startBattle` / `onBattleEnd` / `onDestroy` 清零两个时间点（泵**不是** scheduler 条目也不是补间，
  `unscheduleAllCallbacks()` 停不掉它 —— **清数字就是取消**）。

**验证**（编辑器预览 + 页内探针，详见 tech 文档 §4）：

- 修前指纹：`_phase==='enemy_turn'` + `_aiQueue.length===0` + `_actionLocked===false`。
- 同回调自排期只触发 **1 次**；改新闭包 **5/5**；`tween` 转跳 **6 回合 / 11 拍**无停顿。
- 本次复验（技能修复回合顺带跑到）：点「结束回合」→ 250ms 内
  `_phase='enemy_turn'`、`aiQueue=1`、看门狗已武装（`wd=1.73`）→ 1.5s 内回到
  `player_turn 第2轮`，**无停顿**。

## 2. 需求 1：图标方框 → 单一来源 + 出站消毒

- 删 `UnitController.CLASS_ICONS`，`setupClassIcon()` 统一取 `getClassById(classId)?.icon`
  （`GameData` 为唯一真源）；敌人 id 取不到 → 仍早退，**行为不变**。
- `Theme.stripVariationSelectors()` 在**每处**写 `Label.string` 前调用（单位 / 拖拽幽灵 /
  部署槽 / 路线图节点 / 升级卡 / 职业按钮，共 6 处）；`.ts` 字面量与场景硬编码字符串一并清零。
- 语义统一：`⚔️ → ⚔`；牧师 `💚 → ✝`（**可见变更**，是单一来源的必然结果；`CLASS_COLOR.cleric` 不变）。

**验证与声明**：`grep -rlP '[\x{fe0f}\x{fe0e}]' assets/` 输出为空（含 `.scene` / `.prefab`）；
探针逐处采样渲染文本，断言不含变体选择符。
**微信真机渲染无法在本机验证**，故只声称「码点层面已统一、单一来源已建立」，未声称"真机必然不再出框"。

## 3. 需求 2：点自身不再秒结束 + 跳过可撤销可取消

- 新增 `_stoodStill` 门控：**只有**「以原地待命进入 `action`」才允许点自己退回 `move`
  （否则 `hasMoved` 还原成 `false` = 白送一次移动）。复位点：`selectNextPlayerUnit` /
  `finishUnitTurn` / `endPlayerTurn` / `startBattle` / **任何真实移动完成后**。
- `move` 阶段点自己 → 三分支：有移动预览 → **只取消预览**（留在 `move`）；无预览 → 原地待命
  （`hasMoved=true; _stoodStill=true`）→ `action`；`action` 阶段点自己 → 撤销待命。
- 自动跳过：`_findUsefulSkill()` 落实用户口径；有可用技能时**不跳过**，横幅显示
  「{name} 无可攻击目标 · 可用技能：{技能名}」；启动跳过时**不再立刻** `hasActed = true`
  （移到 `_onAutoSkipTimeout`），宽限 `AUTO_SKIP_GRACE = 1.0s`（原硬编码 0.6）；
  **任何输入都能取消**（点格 / 技能 / 攻击 / 待命）。
- 横幅可清：匿名 lambda 改**命名方法**（红线 5），新增 `clearAutoSkipNotice()`。
- 顺带小修：被动技能不再出现在技能栏里（原先点一下会**直接结束回合**），过滤时**保留原始下标**。

**验证（本轮在新代码上回归）**：点自己 → `action` + `hasMoved=true` + `hasActed=false` +
`_stoodStill=true` + 横幅已出；0.4s 内再点自己 → 回 `move`、`hasMoved=false`、10 个绿色
可移动格恢复；再待命 1.6s → 横幅为「本回合无事可做，1.0 秒后自动跳过（点击可取消）」，
随后 `hasActed=true` 并切到下一单位。

## 4. 需求 5：技能可切换 / 可取消 / 说明原因

- `onSkillUsed` 守卫放宽为 `player_turn | skill_target`；点**同一**技能 = 取消，
  点**另一**技能 = 先干净退出再重新进入。进入前记 `_skillReturnPhase = _unitPhase`
  （**必须在翻转 `_phase` 之前**取，否则取消永远退到 `'action'`）。
- 统一退出函数 `_clearPendingSkill()`：恢复子阶段 + 高亮 + 通知 UI；**无待选技能时是纯 no-op**，
  因此可在任何收口处无脑调用。接入点：`handleSkillTargetClick` 非法目标、释放失败、
  `waitCurrentUnit`、`endCurrentUnitTurn`、`endPlayerTurn`、`finishUnitTurn`、
  `selectNextPlayerUnit`、`startBattle`、`onBattleEnd`。
- `getSkillUnusableReason()` 作为**单一真相**：`canUseSkillWithTargets()` 改为
  `reason === null`；UI 的"点亮/置灰"与"点了之后提示什么"共用同一份判断。
- 技能按钮**不再用 `interactable = false`** 表达不可用（那会让 Button 吞掉 CLICK，
  玩家永远听不到原因）；改用调色置灰 + 点击后横幅。锁定中的技能用**琥珀色**标出，
  且三个过渡色同色 —— 否则鼠标一悬停就被 Button 的 COLOR 过渡冲回常规蓝（预览实测发现）。

**验证（本轮实测，全部通过）**：

| 用例 | 断言 |
|------|------|
| 从 `move` 进技能 | `_phase='skill_target'`、`_skillReturnPhase='move'`、`pendingSkillIndex=0`、12 个目标格、标签「选择AOE中心点，再次点击确认」、按钮琥珀色 |
| 再点同一技能 | 取消：`player_turn`、`pendingSkillIndex=-1`、`unitPhase='move'`、移动高亮恢复 |
| 点射程外非法格 | 取消，同上 |
| **切换技能**（注入第 2 个主动技能，已声明） | `_pendingSkill.id` 由 `fireball` → `test_strike`、`_skillTargets` 重算 `12 → 2`、标签切为「选择技能目标」、琥珀色移到新按钮 |
| 切技能后点自己格 | 取消（自己格不是该技能合法目标） |
| **能量清零** | 点按钮 → 横幅「火球：能量不足」，相位与选中**不变**、无脏状态 |
| 远程技能射程内无人 | 横幅「猛击：射程内无目标，可先移动」 |
| **锁定态悬停** | 移出再移入按钮，仍为琥珀色 `245,158,11`（未褪回常规蓝） |
| `skill_target` 下点结束回合 | `pendingSkillIndex=-1`、`_pendingSkill===null`、目标清空、技能栏收起，敌方回合正常跑完进入第 2 轮 |

全程浏览器 `console.error` 计数 **0**（仅 2 条引擎自身的 `systemEvent` 弃用警告），
`node "$TSC" --noEmit` → `TS_OK`。

---

## 5. 提交清单

| # | 提交 | 内容 |
|---|------|------|
| 1 | `044a946` | 需求 4：`update` 泵 + 看门狗 |
| 2 | `aceaf9a` | 需求 1：图标单一来源 + 去变体选择符（含 `TinyVanguard.scene`） |
| 3 | `db1e266` | 需求 2：原地待命可撤销、自动跳过可取消 |
| 4 | `4e864da` | 需求 5：技能可切换/取消并提示不可用原因 |
| 5 | 本次 | 文档（本文件 + 两篇 tech 文档 + 索引 + AGENTS.md 教训行） |

## 6. 遗留与风险

- **微信真机渲染**（需求 1）与**真机触屏手感**（需求 2/5）需真机验收一次；本地只做到
  码点级 + 逻辑级 + 桌面预览级验证。
- 需求 2 的「撤销待命」若不守住 `_stoodStill` 门控，会把 `hasMoved` 还原成 `false`
  = 白送一次移动。`hasMoved` 的读取点只有 `highlightMoveRange` 一处（玩家侧），
  改动时务必按这一条复核 diff。
- 需求 4 的泵依赖组件 `update`：若 `BattleManager` 被 `enabled = false`，泵与看门狗**一起**
  停摆 —— 与旧 `scheduleOnce` 方案同样受限，可接受。
- 自动跳过的「有用技能」判定与「不可用原因」是两份口径（前者**故意**把
  aoe/tile/line 排除在外：「能点」不等于「有用」），改动其一时不要顺手合并。
