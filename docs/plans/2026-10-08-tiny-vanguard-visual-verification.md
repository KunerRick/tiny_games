# 小小先锋（Tiny Vanguard）可视化交互验证报告

> 验证日期：2026-10-08
> 验证方式：Cocos 编辑器预览服务器 + 浏览器真实点击/拖拽 + 页内引擎探针 + MCP 日志取证
> 前置诊断：[`2026-10-08-tiny-vanguard-issue-report.md`](./2026-10-08-tiny-vanguard-issue-report.md)（基于静态代码审查，本报告用运行时证据复核）
> 本轮范围：**只验证与记录，不修改任何代码或场景**

---

## 一、验证环境与方法

| 项 | 值 |
|----|----|
| 预览地址 | `http://127.0.0.1:7456/`（编辑器自带预览服务器，CocosCrea 监听） |
| 引擎 | Cocos Creator v3.8.8 |
| 设计分辨率 | 720 × 1280 |
| Canvas 物理像素 | 786 × 1308（devicePixelRatio = 2） |
| 当前场景 | `TinyVanguard`（uuid `ae4c9352-37c5-4eaa-8a88-65c429fb4ac9`） |

### 关键方法

1. **MCP 无法启动预览**：`project_run_project` 仅打开构建面板（返回 `Preview functionality requires manual setup`），`project_start_preview_server` 返回 `Preview server control is not supported through MCP API`。故改用编辑器已运行的 7456 预览服务器。
2. **页内探针**：预览页 `window.cc` 可用，通过 `cc.director.getScene()` 读取节点树、可见性、组件类型与私有字段（`_state`/`_phase`/`_selectedUnit`/`_deployedPositions` 等），把"看到什么"变成"可核对的数据"。
3. **坐标换算规则**（重要）：
   - 设备坐标 = `rect.left + wx / vs.width * rect.width`，其中 `rect` 为 canvas 的 `getBoundingClientRect()`，`vs` 为 `cc.view.getVisibleSize()`（720×1280）。
   - **浏览器自动化点击工具使用的是设备像素**（截图空间，786×1308），即 **设备坐标 = CSS 坐标 × dpr(2)**。传值错误会静默点偏，早期两次误判即源于此。
4. **加速手段声明**：为覆盖末端链路（击杀→胜利→Boss 通关），在运行时直接调用了真实代码路径（`onRunComplete(true)`、`bm.onAttackSelected()`）并临时调整了单位血量。**所有点击、结算、日志均为真实引擎行为**；未修改任何文件。
5. **字段更正**：单位血量真实字段为 `data.currentHp` / `data.maxHp`（`data.hp` 只是 stats 里的模板值）。

---

## 二、全流程走查结果

| 阶段 | 结果 | 关键观测 |
|------|------|---------|
| 职业选择 | ✅ 通过 | 可选 3 职业，`HighlightBorder`/`CheckMark` 联动；集满 3 个后 `StartBtn.interactable` 变 true、文案 `开始游戏 (3/3)` |
| 路线图 | ✅ 通过 | 10 节点、`ConnectionsLayer` 绘制连接线与箭头；起点 `Node_0` 绿色可达发光，其余灰色 alpha=128；**不可达节点点击被 `isReachable` 正确拦截**；点起点进入战斗 |
| 布阵 | ✅ 通过 | 36 格 6×6 网格（80×80）；前两行高亮为部署区；点格放置、点已放置格撤回；确认布阵进入 `player_turn` |
| 战斗 | ✅ 通过 | 单位自动选中（`UnitTurnLabel` `(1/3)`）；**移动二次确认**（首次点仅预览，再点才移动）；攻击含射程校验（超距正确取消）并真实减血（`currentHp` 6→2、`totalDamageDealt` +4）；等待/结束回合后 AI 敌方回合自动执行并回到下一轮；技能按钮渲染正常 |
| 结算 | ✅ 通过 | 单场胜利面板显示 `💰 +10`/`用时回合：2`/`造成伤害：11`，`ContinueBtn` 可点；升级三选一逐单位选卡并将技能真实写入；Boss 通关面板 `VictoryLabel="通关！"`，honor +100 |

**结论：主流程五个阶段全部可用，无流程阻塞、无崩溃、无 error 级日志。**

---

## 三、新发现问题（运行时证据）

### 问题 1（中）：`ContinueBtn` 同节点挂两个 renderable 组件 → 运行时警告

- **现象**：每次单场胜利面板显示时输出 warning：
  `Can't add renderable component to this node because it already have one.`
- **证据**：运行时读取 `VictoryPanel/ContinueBtn` 组件列表为
  `["UITransform", "Button", "UITransform", "Label", "Sprite"]`
  —— 同一节点同时存在 `Label` 与 `Sprite`。
- **关联位置**：`assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts:140-148`，先 `addComponent(Label)` 再 `addComponent(Sprite)`。
- **对照**：`ui/UpgradeUI.ts:96-99` 的同类写法**有** `getComponent(Sprite)` 判空，两处风格不一致。
- **建议**：按钮背景与文字拆分到子节点；或按 `UpgradeUI` 的写法先判空。

### 问题 2（中）：通关面板无任何可点击出口

- **现象**：打完 boss 节点后 `RunVictoryPanel` 显隐为 `active=true`，但**面板内 Button 数量 = 0**，玩家无法继续或返回。
- **证据**：递归统计 `RunVictoryPanel` 下 Button = 0；其子节点仅 `VictoryLabel`、`ContinueLabel`（均只有 `UITransform,Label`）。对照 `GameOverPanel` 有 1 个 Button（`RestartButton`）、Canvas 下 `ContinueRunButton` 文案为「继续上局」。
- **关联位置**：`scripts/TinyVanguardMain.ts:924-929`（`onRunComplete` 仅 `active = true`，未注册任何回调）；`TinyVanguardMain.ts:120-132` 仅给 `GameOverPanel/RestartButton` 绑事件。
- **建议**：为通关面板添加按钮并绑定「返回大厅 / 重开一局」。

### 问题 3（低）：`RunVictoryPanel/ContinueLabel` 文案为占位符

- **现象**：通关后该标签显示默认占位字符串 `label`，面向玩家可见。
- **证据**：运行时读取 `RunVictoryPanel/ContinueLabel` 的 `Label.string === "label"`。
- **关联节点**：`TinyVanguard/Canvas/RunVictoryPanel/ContinueLabel`。
- **建议**：在编辑器或代码中设置为正式文案（或该节点本就多余，随问题 2 一并整理）。

### 问题 4（低）：首屏两个按钮垂直重叠

- **现象**：`ClassSelectPanel` 中「开始游戏」按钮与「继续上局」按钮位置重叠。
- **证据**：设备坐标 `StartBtn` 中心 `(548, 881)`、尺寸 200×40；`ContinueRunButton` 中心 `(548, 1000)`、尺寸 80×40。按 dpr=2 折算，两者边缘相交（`ContinueRunButton` 显示时覆盖在 `StartBtn` 上）。
- **关联节点**：`ClassSelectPanel/StartBtn`、`Canvas/ContinueRunButton`。
- **建议**：调整 `ContinueRunButton` 的 Y 位置，与开始按钮拉开间距。

### 问题 5（低）：`move` 阶段行动提示为空

- **现象**：进入 `move` 阶段时 `ActionHintLabel` 为空字符串，玩家缺少"点击可移动位置"的提示；进入 `action`/`attack_target` 阶段才有文案。
- **证据**：`move` 阶段 `ActionHintLabel.Label.string === ""`，其尺寸宽度为 0；而提示节点在 `attack_target` 阶段为「选择攻击目标」。
- **关联位置**：`scripts/TinyVanguardMain.ts` `updateBattlePhaseUI` 的 `move` 分支。
- **建议**：为 `move` 阶段补齐提示文案。

---

## 四、旧问题清单复查（结论：均已修复）

对前置 [`2026-10-08-tiny-vanguard-issue-report.md`](./2026-10-08-tiny-vanguard-issue-report.md) 的 6 项逐条代码复核，**全部不再成立**：

| 旧编号 | 旧问题 | 现行代码证据 | 结论 |
|--------|--------|--------------|------|
| #1 | 续档恢复技能时重复添加起始技能 | `TinyVanguardMain.ts:441-453` 有 `!unit.hasSkill(skill.id)` 去重 | 已修复 |
| #2 | `EventUI` 事件 handler 用匿名 lambda | `ui/EventUI.ts:60`、`:89` 均为 `btn.node.on(..., this.onChoiceClicked, this)` | 已修复 |
| #3 | `onDestroy()` 访问 `@property(Node)` | `TinyVanguardMain.ts:1009`、`ui/UpgradeUI.ts:149`、`ui/EventUI.ts:111` 均只清 JS 引用并注明规范 | 已修复 |
| #4 | `onAttackSelected` 缺 `_phase` 守卫 | `battle/BattleManager.ts:570-574` 有 `_phase !== 'player_turn'` 与 `_unitPhase !== 'action'` 守卫 | 已修复 |
| #5 | `updatePhase` 未隐藏 `attackButton` | `ui/BattleUI.ts:703-705` 已控制 `attackButton.active`；且声明为 `@property(Node)`（第 28 行） | 已修复 |
| #6 | `RouteMapUI.completeNode` 全量重建节点 | `ui/RouteMapUI.ts:199-213` 已是增量刷新（`_nodeViews` + `applyNodeVisual`） | 已修复 |

> 另需修正前置报告的一处判断：**两个 `VictoryPanel` 并非**同名冗余——`BattleUI/VictoryPanel` 承担单场战斗结算，`Canvas/RunVictoryPanel` 承担整轮通关，且节点已重命名为 `RunVictoryPanel` / `ContinueRunButton`，不再是同名混淆。

---

## 五、验证过程中的自纠记录（避免误报）

以下曾在过程中被我判为缺陷，经查证均为**探针/坐标错误**，已撤回，不应进入修复清单：

1. 「相邻职业按钮重叠 15.6px」——把设计像素当 CSS 像素核算，实际间距 40 > 按钮高 36。
2. 「点击职业按钮无响应」——浏览器点击工具入参为设备像素，坐标少乘 dpr，实际点在按钮外。
3. 「进入玩家回合后 `currentUnit` 为 null」——`BattleManager` 并无 `currentUnit` getter，真实字段是 `_selectedUnit`。
4. 「点击剑兵不造成伤害」——血量字段应为 `data.currentHp`，误用不存在的 `data.hp` 造出矛盾读数。

---

## 六、未覆盖与限制

- **未走到的界面**：商店（`ShopPanel`）、休息（`RestPanel`）、事件（`EventUI`）、精英战、真实 Boss 战（本报告以 `onRunComplete(true)` 等价路径覆盖通关面板）、失败与 `GameOverPanel` 重开流程。
- **视觉回归**：截图为人工查看，未做像素级基线比对。
- **随机性**：升级选项与部分 AI 行为含随机，同一路径的表现可能存在差异。
- **平台差异**：仅在桌面浏览器预览验证；微信小游戏平台行为仍需微信开发者工具补测。
- **加速手段**：末端链路使用运行时注入达成，未完整经历自然战斗到 boss。

---

## 七、建议修复顺序

1. **问题 2**：通关面板补可点击出口（功能缺失，影响最大）。
2. **问题 1**：清理 `Label` + `Sprite` 同节点冲突（消除运行时警告）。
3. **问题 3 / 问题 4**：通关文案与首屏按钮重叠（观感与误触）。
4. **问题 5**：`move` 阶段提示补文案（引导）。

---

## 八、修复与回归（第二轮，2026-10-08）

> 本轮依据本报告修复问题并做端到端回归；修复均在预览中实测确认。

### 已修复

| 问题 | 修复方式 | 验证证据 |
|------|---------|---------|
| 问题 1 通关面板无出口 | `TinyVanguardMain.bindRunVictoryPanel()` 为 `RunVictoryPanel/ContinueLabel` 绑定 `Node.EventType.TOUCH_END` → `SceneManager.gotoLobby()`（Node 事件委托，符合守则 #3） | 点击「返回大厅」后 `cc.director.getScene().name === 'Lobby'` |
| 问题 2 `Label` + `Sprite` 同节点 | 文字改放到子节点 `ContinueText`；并清理 `ContinueBtn` 上重复的 `UITransform`（`Button` 的 `@requireComponent` 已自带） | 组件实测为 `[UITransform, Button, Sprite]`；运行时警告消失 |
| 问题 3 占位文案 `label` | 同问题 1，`bindRunVictoryPanel()` 中设为「返回大厅」 | 运行时 `Label.string === '返回大厅'` |

### 本轮新发现并修复

| 新问题 | 严重度 | 修复 |
|--------|--------|------|
| `EventUI.showEvent()` **漏置 `_showCalled`**，首次显示时 `node.active = true` 同步触发 `onLoad`，而 `_showCalled` 仍为 false，导致 `onLoad` 立刻把面板关掉——事件节点永远无法交互，流程卡死在 `gmState === 'event'` | **高（流程中断）** | 在 `showEvent()` 开头（早于 `node.active = true`）置 `this._showCalled = true`；并排查同类的 `UpgradeUI`/`RouteMapUI`/`BattleUI`（均正确，属单点缺陷） |
| `resetClassSelectionVisual()` 只置开始按钮 `interactable = false`，**未同步文案**，重开后残留上一局的「开始游戏 (n/3)」 | 低 | 改为调用 `updateStartBtnInteractable()`，使文案与可用性一同重置 |

### 更正（撤回上一轮误报）

- **问题 4（`StartBtn` 与 `ContinueRunButton` 重叠）经实测不成立，撤回。** 实测两按钮世界坐标 `y = 510` / `y = 440`，垂直间距 70 设计像素 > 两者半高和 40，不重叠。该误报源于上一轮把设计像素当作设备像素判读（同类错误在本报告第五节已记录）。
- **问题 5（`move` 阶段提示为空）经实测已修复**：`ActionHintLabel` 显示「点击可移动位置」，随 `29f4582` 落地。

### 回归结果

- **端到端链路已走通**：职业选择 → 路线图 → 布阵 → 战斗 → 单场胜利 → 升级三选一 → 精英战 → 休息 → 事件 → 商店 → Boss → 通关 → **返回大厅**。
- **运行时零 error**：浏览器 console 与编辑器 console 的 error 计数均为 0；`Can't add renderable component` 警告在修复后不再出现。
- **类型检查通过**：`tsc --noEmit`（Cocos 自带 TypeScript 5.8.2）无错误。
- 各面板交互均正常：商店（购买 10 金 / 治疗 5 金 / 离开）、休息（确认 / 跳过）、事件（多选项与结果回传）、失败与重开。

### 工作流提示（重要）

修改 `.ts` 后**编辑器不会自动重编译**。需先调用 Cocos MCP 的 `project_refresh_assets` 刷新资产库，预览页面重载后才会加载新代码——否则预览仍运行旧版本，容易误判“修复无效”。

### 第三轮深度验证（补测）

对上一轮未覆盖的核心交互做了补测，结果均通过：

| 补测项 | 结果 | 关键证据 |
|--------|------|---------|
| 技能使用 | ✅ | 技能按钮可用性随射程/能量联动（射程外 `interactable=false`，移入射程后 `true`）；点击进入 `skill_target` 并高亮目标（hint「选择技能目标，再次点击确认」）；二次点击确认释放——能量 5→3、剑兵 `currentHp` 6→0（2 倍伤害 + 无视防御）、用后自动切换下一单位 |
| 存档续档 | ✅ | 有存档时职业选择面板出现「继续上局」；点击后恢复 `route_map` 与 gold(25)/honor(40)/职业/已完成节点；进入战斗后技能按 id 恢复且**无重复** |
| 场景切换 | ✅ | `Lobby ↔ TinyVanguard` 连续切换 3 轮，`window.onerror` 无捕获，无 `onDestroy` 空引用崩溃（守则 #4 风险点） |

本轮**发现并修复 1 个新缺陷**：

| 新问题 | 严重度 | 说明与修复 |
|--------|--------|-----------|
| AOE 技能的范围预览与真实命中范围不一致 | 中 | `_getAoePreviewPositions` 仅识别 `aoe_3x3`，对 **`aoe_1radius`（火球）** 落到 `dr+dc<=1` 的十字分支，预览只显示 5 格；而 `executeSkillEffects` 的 `aoe_1radius` 分支用 `dr<=1 && dc<=1`，实际命中 3×3 共 9 格——**预览少显示，会误导玩家**。修复：两条 effect 都按 3×3 预览。修复后实测预览 9 格与实际命中 `match=true` |

其余深度验证项（技能使用、存档续档、场景切换）均通过。

---

## 附：本次使用的工具

- Cocos MCP：`scene_get_current_scene`、`debug_get_console_logs`、`debug_clear_console`、`debug_search_project_logs`、`project_run_project`、`project_start_preview_server`
- 浏览器自动化：`browser_open` / `browser_act`（click、eval）/ `browser_read`（snapshot、logs、screenshot）
- MCP 接入：项目级 `reasonix.toml` 的 `[[plugins]] cocos-creator`（`type=http`、`url=http://localhost:3000/mcp`）
