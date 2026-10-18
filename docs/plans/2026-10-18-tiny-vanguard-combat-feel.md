# 小小先锋（Tiny Vanguard）战斗手感方案：布阵拖拽、移动/攻击/技能动画

> 日期：2026-10-18
> 触发：三项诉求 —— ①清遗留项；②确认"部署阶段的拖动放置 / 通过调整"是否实现；③战斗里"兵种移动、攻击、使用技能有点僵硬，不够丝滑"，要求整体处理并给一版方案
> 方式：**编辑器预览 + 浏览器工具**（真实鼠标点击/拖拽驱动，页内探针对节点 `scale`/`position`/`color` 逐帧采样，`.ts` 改动一律 `project_refresh_assets` → 重载 → 校验新代码已加载）
> 关联：[`2026-10-12-tiny-vanguard-deploy-interaction-plan.md`](./2026-10-12-tiny-vanguard-deploy-interaction-plan.md)（布阵交互）、[`2026-10-18-tiny-vanguard-acceptance-review.md`](./2026-10-18-tiny-vanguard-acceptance-review.md)（整体验收）、[`../tech/browser-verify-cocos-preview.md`](../tech/browser-verify-cocos-preview.md)（验证方法）
> 状态：**已实现 + 已逐帧实测**；文末 §五 列出**未实施**的后续打磨项（需要时再排期）

---

## 一、结论摘要

| # | 诉求 | 结论 | 关键证据 |
|---|------|------|---------|
| ① | 遗留项 B5⑦ 大厅标题仍是占位符"标题" | **已修**：`Lobby/Canvas/content/title` 的 Label 改为设计稿文案 **"Tiny Games 游戏大厅"**，场景已保存 | MCP 写入回报 `changeVerified: true`；**关闭并重新从磁盘打开 Lobby 场景**后 `string` 与 `_string` 均为新值（持久化验证） |
| ② | 部署阶段"拖动放置 / 通过调整"是否实现 | **原实现有缺陷、已修**：任何上报触摸能力的设备拖拽全部失效（根因是 `TOUCH_CANCEL` 被误判为"手势中断"） | 真实鼠标拖拽 3/3 兵牌成功落位；另修为"拖空"手势不再吞掉轻触（详见 §二） |
| ③ | 移动/攻击/技能"僵硬" | **已实现动画层并逐帧验证**：移动 216ms 双段缓动、近战突刺命中在顶点、受击红闪 + 阻尼抖动、远程闪白、施法脉冲、阵亡演出 + 结算面板延迟 | §三 表 1–表 8（全部为实测帧数据） |
| ③′ | 顺带修掉的缺陷 | **施法缩放脉冲此前完全不显示**（被同帧取消选中停掉了补间）；已修并实测脉冲可达设计峰值 1.12 | §四 |

---

## 二、布阵拖拽：为什么此前"没实现"，怎么修的

### 2.1 根因（现象：拖了没反应）

触摸结束事件在桌面浏览器下**可能是 `TOUCH_CANCEL` 而不是 `TOUCH_END`**：引擎按抬起位置做 hitTest，**拾起位置不在起始节点内就派发 `CANCEL`** —— 而"把兵牌拖到棋盘另一处再松手"恰恰就是这个样子。

旧代码把 `CANCEL` 当成"手势被系统打断"，用输入设备分流：

```ts
// 旧写法（错误）
if (navigator.maxTouchPoints > 0) { /* 回位，不结算落点 */ }
```

于是**任何 `maxTouchPoints > 0` 的环境**（真机、触屏笔记本、开触摸模拟的浏览器）拖拽落子全部被丢弃。实测复现：伪造 `navigator.maxTouchPoints = 3` 后，同一次拖拽只派发 `start` + `cancel`（没有 `end`），单位留在原地。

### 2.2 修法

`CANCEL` 与 `END` **同等结算**（都走 `finishDragGesture`），不再按设备分流；真正被中断时（场景切换/节点销毁）由 `_dragEnabled` / 落点合法性自然拦下，`applyDrop` 返回 `false`。

- 手势宿主必须是 `Grid` 与 `BattleUI` 的**共同父级 `Canvas`**，且用**捕获阶段**（`useCapture = true`）监听 —— 棋盘格的 `Button` 在 `TOUCH_START` 会 `stopPropagation`，冒泡阶段永远收不到"起点在棋盘上"的手势（表现为棋盘内换位整条路径失效）。
- 多指丢弃：只认本次手势的 `touchId`（`isDragPointer`）。
- 幂等：`START`/`MOUSE_DOWN` 两套源都派发，`_dragSession` 保证只认领一次。

### 2.3 相关缺陷：拖拽阈值 + "已消费"标记会静默吃掉轻触

兵牌 100×64，`DRAG_THRESHOLD` 只有 8 **设计**像素（本机 ≈ 4.3pt），手指/鼠标稍抖就判为拖拽；落点又什么都没改，`_dragConsumed` 还把随后的点击吞掉 → **点兵牌选中/撤回完全没反应**（实测横移 5 CSS 像素即复现，3 像素正常）。

修法：`applyDrop` 返回"本次是否真的改变了布阵状态"，落空且起于兵牌时显式退回轻触回调（`fallbackToCardTap` → `selectDeployUnit`）。**只兜底兵牌、不动棋盘** —— 棋盘上"拖起又放回原格"是定义好的无操作，若补发点击会变成"撤回该单位"，与意图相反。

### 2.4 实测

真实鼠标拖拽（非注入）3/3 兵牌从槽位拖到棋盘格成功落位；棋盘内换位、拖回槽位撤回、非法格拒绝回位均按语义生效。

---

## 三、战斗动画层：实现清单与逐帧实测

### 3.1 僵硬感从哪来（修改前的状态）

- 移动/攻击是"瞬移 + 立刻出结果"：位移、伤害、死亡都在同一帧完成，玩家看不到因果。
- 没有受击反馈（不掉血闪、不抖动），伤害数字与死亡演出缺失或与结算面板同时出现。
- 敌方回合逐单位瞬间结算，节奏为 0（多单位同帧一起动）。
- 输入没有锁定：动画期间可以继续点，容易出现"点两下滑两格"。

### 3.2 实现（文件级）

**`battle/UnitController.ts`（动画层，新增约 230 行）**

| 能力 | 说明 |
|------|------|
| 常量 | `MOVE_ANIM_DURATION=0.22`、`ANIM_LUNGE_OUT=0.08`、`ANIM_LUNGE_BACK=0.12`、`ANIM_SHAKE=0.18`、`ANIM_SLIDE=0.16`、`ANIM_CAST=0.14`、`ANIM_DEATH=0.30`、`DEATH_ANIM_DURATION=0.34` |
| `playAttackAnim(targetPos, onImpact)` | 近战：向目标突刺到顶点（**在顶点回调 `onImpact` 结算伤害**）再回位；远程：原地向后拉一下（`ANIM_SLIDE`）后闪白 |
| `playHitReaction()` | 目标：闪红 + 阻尼式三腿位移抖动，**严格回到原格坐标** |
| `playCastCue()` | 施法提示：淡蓝闪光 + 缩放脉冲 1 → 1.12 → 落位 |
| `playDeath()` / `isDeathPlaying` | 阵亡：闪白 → 弹一下 → 塌陷上飘淡出 → 隐藏节点（幂等，`takeDamage` 与 `checkBattleEnd` 重复触发只跑一遍） |
| `resetVisualState()` | 重开局把缩放/位置/不透明度/颜色一次性归位（配合 `_tintBase` 记录本色，避免闪色被永久写进 Sprite） |
| 补间句柄 | `_moveTween/_shakeTween/_lungeTween/_flashTween/_castTween/_deathTween/_fadeTween`，各自可停可重入 |

**`battle/BattleManager.ts`**

- `executeAttack(attacker, target, onDone)` 把"播动画 → 命中结算 → 完成回调"串成一条链，`_reportDamage` 负责伤害数字与血量刷新。
- `_actionLocked`：动画期间锁输入，动画结束再放行（杜绝重复点击）。
- AI 节奏常量 `AI_STEP_AFTER_ACTION=0.34` / `AI_STEP_AFTER_MOVE=0.10` + `_onAINextStep`：敌方逐单位排队演出，而不是同帧齐动（函数名已按语义命名，修复了原先"把 `endPlayerTurn` 当下一单位"的命名误导）。
- `_battleOver` + `_settleVictory()` / `_settleDefeat()`：胜负相位**立即**切换（逻辑不等待），但结算面板**延迟 `DEATH_ANIM_DURATION`** 弹出，让阵亡演出播完。

**`ui/BattleUI.ts`**

- `showDamageNumber`：伤害数字上飘 60px / 0.6s，`backOut` 缩放入场，红色（受伤）/绿色（治疗/增益）区分后销毁。
- 布阵拖拽（§二）。

### 3.3 逐帧实测（真实输入驱动，采样自节点 `position`/`scale`/Sprite `color`）

| 项 | 实测数据 | 结论 |
|----|---------|------|
| 我方移动 | 216ms ≈ `MOVE_ANIM_DURATION`；两段缓动：单调减速（39.7→39.2→30.4→26→20→17.2→13.5）到轻微过冲的 `mid`，再回加速（3.4→14.3→14.6）**精准落格**；斜向 x/y 对称 | ✔ 位移"有重量"且无残差 |
| 敌方移动 | 同上（敌人复用同一条补间） | ✔ 敌我手感一致 |
| 近战突刺 | 199ms；出去 `quadOut`（13.4→9→6.8→3.5→0.8）到顶点**恰好 +33.5 ≈ 0.42 格**，回来 `sineInOut`（2.4→4.6→6.8→7.8→6.1→4.2→1.6）**精确回原点** | ✔ 突刺幅度克制成 0.42 格（不越到相邻格） |
| 命中时机 | 伤害**落在突刺顶点那一帧**：目标 HP 6→1、目标抖动与伤害数字同帧开始 | ✔ 因果对齐（先到再打） |
| 受击反馈 | 红色 `255,92,92` → 本色约 163ms（`ANIM_SHAKE`≈0.18）；同时三腿阻尼位移抖动 161ms，**精确回到原格** | ✔ 不合位错格 |
| 远程攻击 | 攻击者**子节点** `unitSprite` 闪白 `255,255,255` ≈ 0.12s（注意闪烁写的是 `unitSprite`，不是单位节点本身） | ✔ 远程有前摇提示 |
| 施法提示 | 淡蓝 `120,200,255` ≈ 0.18s + 缩放脉冲峰值 **1.1199（= 1.12）** | ✔（见 §四） |
| 阵亡演出 | 296ms：先 ~112ms 顿点（闪白/放大）→ 加速上飘淡出（位移增量 0.2→2.2，`quadIn` +14y）→ 末帧隐藏节点 | ✔ 有"死亡重量" |
| 结算面板 | 相位切 `victory` 后 **370ms**（≈`DEATH_ANIM_DURATION` 0.34）面板激活；相位/`_battleOver` 同帧同步切换 | ✔ 演出先于面板 |
| 伤害数字 | `-6` 上飘 y 480→540（+60px）/ ~0.6s，`backOut` 入场，随后销毁 | ✔ 数值与位置正确 |
| 敌方回合节奏 | 剑兵"走位 → 出手 → 下一单位"间隔 ≈362ms（≈0.34），最后一段 ≈0.10；整回合 ≈1.2s | ✔ 逐单位可读，不糊成一团 |
| 输入锁 | `_actionLocked` 在位移期间为 `true`，落格后释放 | ✔ 不会点两下滑两格 |

---

## 四、实测发现并修掉的缺陷：施法缩放脉冲不显示

**现象**：技能只看到淡蓝闪光，看不到那记"蓄力一胀"。

**根因**：技能结算顺序是 `playCastCue()`（`BattleManager.ts:1147`）→ 本回合结束 → `finishUnitTurn()` → `setSelected(false)`，**都在同一帧**。而 `setSelected` 里写着"蓄力脉冲也在写 `scale`，选中态变化时让它让位"：

```ts
if (this._castTween) { this._castTween.stop(); this._castTween = null; }   // ← 同一帧就把脉冲停了
```

脉冲刚启动就被停掉，缩放直接归位 → 玩家看不到。

**修法**（`UnitController.ts`）：

1. `setSelected`：脉冲正在跑时**不打断**，让它自然收尾（`if (this._castTween) return;`，选中标记与指示器仍照常更新）。
2. `playCastCue`：收尾回调按**收尾那一刻**的选中态归位（选中 → 1.08，未选中 → 1.0），而不是用创建时捕获的 `rest`，避免脉冲期间选中态变化把缩放留在中间值。

**实测（两条路径都验）**：

| 场景 | 采样序列（每 32ms 取一次） | 结果 |
|------|--------------------------|------|
| A 同帧取消选中（原故障路径） | 1.08 → 1.0958 → 1.1162 → 1.1164 → 1.0902 → **1**（保持） | 脉冲出现，峰值 1.1199，落位 1.0 ✔ |
| B 保持选中 | 1.08 → 1.0967 → 1.1166 → 1.1045 → 1.0813 → **1.08**（保持） | 脉冲出现，落位 1.08 ✔ |

代码加载校验：`setSelected`/`playCastCue` 的新实现已在预览中生效（字符串特征匹配 + 行为一致）。

**残留的一点小瑕疵（已接受）**：第二腿回落目标仍是"创建时"的选中缩放，若选中态在 0.14s 脉冲**中途**变化，末帧会有一次 ≤0.08 的归位（约 3px）。要彻底消掉需在第二条腿用 `onUpdate` 逐帧插值到动态目标，收益极小、且依赖 `onUpdate` 取参行为，暂不做。

---

## 五、后续可选打磨（**均未实施**，供排期）

1. **移动动画加"影子/拖尾"或落地轻压**（`scale.y` 0.96 一帧）——进一步强化"落格"的触感。
2. **命中 hit-stop**：命中帧全局暂停 30–50ms（只停补间、不停逻辑），打击感提升明显，改动面在 `BattleManager` 的时间缩放。
3. **技能/攻击的"第一下只是预览"提示**：移动与技能都是"第一次点击只高亮、第二次才确认"。玩家第一次点常被读成"点了没反应"。建议：预览态给目标格加半透明幽灵单位 + 顶部一行短提示（如"再点一次确认"）。
4. **敌方回合节奏可调**：`AI_STEP_AFTER_ACTION` 目前固定 0.34s；建议加"快进/自动"开关（长按加速），Boss 战多单位时体验更好。
5. **统一补间缓动语义**：目前 `quadOut`（入场）与 `sineInOut`（回位）混用但未成文；建议在 `UnitController` 顶部写一行"缓动约定"注释，后续新增动画照抄。
6. **`DEATH_ANIM_DURATION` 与 `ANIM_DEATH` 的关系**：前者 0.34 是"看不见的等待"，后者 0.30 是补间本身。若调其一须同调，建议在代码里改成 `ANIM_DEATH + 0.04` 之类的派生式，避免以后只改一个。

---

## 六、遗留项 ①：大厅标题

- 节点：`Lobby/Canvas/content/title`（uuid `deheaHqXpFe4Gykp/Y7Gbz`，Label，`fontSize 20`、居中，位于 `y=614.8` 居中轴）。
- 文案来源：设计稿 [`../specs/2026-05-12-phase1-lobby-design.md`](../specs/2026-05-12-phase1-lobby-design.md) §3.1 标题栏 —— **"Tiny Games 游戏大厅"**（原为占位符"标题"，且 `Lobby.ts` 未在代码里覆盖，属真·遗留）。
- 操作：经 MCP `component_set_component_property`（`componentType: cc.Label`, `property: string`）写入 → `scene_save_scene` 保存。
- 验证：**关闭场景后重新从磁盘打开**，Label 的 `string` 与序列化字段 `_string` 均为新值 → 已持久化。
- **未做**：预览页可视化确认（`project_run_project` 只开构建面板、MCP 不能切换预览的场景，预览始终跑上次构建的场景）。如需眼见为实，请在编辑器里打开 `Lobby.scene` 后点预览。

---

## 七、变更文件与验收门槛

| 文件 | 变更 |
|------|------|
| `assets/games/game_tiny_vanguard/scripts/battle/UnitController.ts` | 动画层（+230 行）+ 本次脉冲修复 |
| `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts` | 攻击链、输入锁、AI 节奏、结算延迟 |
| `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts` | 布阵拖拽（CANCEL 结算、轻触兜底）、伤害数字 |
| `assets/main/scenes/Lobby.scene` | 标题文案（经 MCP 写入并保存） |

验收：`tsc --noEmit` → `TS_OK`；预览与控制台 `error` 计数 = 0（探针自身产生的 `getComponent: Type must be non-nil` 与一次 `forEach` 异常均为页内探针注入代码所致，非游戏代码；已确认调用栈落在 `eval at evaluate`）。

> 复现方式：`npx` 无脚本，走编辑器 UI 预览 + 浏览器工具；探针与坐标标定套路见 [`../tech/browser-verify-cocos-preview.md`](../tech/browser-verify-cocos-preview.md)。
