# Cocos 排期与补间陷阱：自排期回调被静默丢弃

> **适用**：写任何"等一会儿再做下一拍"的回合/动画链路（AI 回合、连击、结算序列）。
> **来源**：Tiny Vanguard 敌方回合卡死（本项目 2026-10-18 修复），速查版见
> [`../../AGENTS.md`](../../AGENTS.md) 的**当前教训**表 F 行。

---

## 1. 症状

玩家实测：**双方各剩 2 个单位时，敌方回合直接卡死** —— 界面停在「敌方回合 · 敌人行动中…」，
敌人不动、不回我方回合、控制台不报错（`console.error` 计数 0）。

探针指纹（修前）：

```js
{ _phase: 'enemy_turn', _aiQueue: [], _actionLocked: false }   // 队列已空，却没人推进
```

关键点：**不报错**。所以不能靠看日志/异常栈定位，必须看**状态机停在哪儿** +
**下一步是谁的责任**。

## 2. 根因：在正在执行的回调里，用同一 `(target, method)` 再排期

旧写法（`_processNextAIUnit` 每一拍结尾）：

```ts
// ❌ 旧：一拍结束后，从"自己这一拍"里再排下一拍
this.scheduleOnce(this._onAINextStep, delay);

private _onAINextStep(): void {
  this._processNextAIUnit();   // → 又走到上面那句 scheduleOnce
}
```

`Scheduler.schedule` 的语义是「同一 `target` + 同一 `callback` 视为**同一个排期**」：
若该回调已在排期表里，它只**更新间隔**、不再新建条目（引擎内部该分支的 id 为 `1507`）。
而 `scheduleOnce` 排的是一次性计时器，`Timer.update` 在它到期时会把条目**取消**。
两条规则叠在一起就出现了这个序列：

1. 本拍由 `_onAINextStep` 触发 —— 此刻它**还在排期表里**（正在执行，尚未移除）；
2. 回调内部 `scheduleOnce(_onAINextStep, d)` → 被判定为"同一排期" → 只更新间隔，不新建；
3. 本次触发收尾，`Timer.update` 按期把这条一次性计时器**取消**；
4. 下一拍永远不会来 → `_phase` 永久停在 `enemy_turn`。

即：**排期被静默丢弃**，没有异常、没有警告。

## 3. 为什么只有"敌人在其目标格上"才复现

`UnitController.moveToPositionAnimated()`（`battle/UnitController.ts:432`）有两条路径：

```ts
if (duration <= 0 || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) {
  finish();          // ← 同步路径：onComplete 在**调用栈内**立刻执行
  return;
}
this._moveTween = tween(this.node).to(...).to(...).call(finish).start();  // ← 异步路径
```

敌人**已经在决策目标格**（原地攻击/原地放技能）时走同步路径，于是下一拍的 `scheduleOnce`
落在**同一帧、同一调用栈**里 —— 正是 §2 描述的"回调仍在排期表中"的时机，去重必然命中。
走补间路径时回调在若干帧后触发，那一拍早已从排期表移除，所以**绝大多数回合都正常**，
只有这一种拍长才会卡 —— 这解释了为什么症状是"偶发、且要打到残局才出现"。

同理，若这段逻辑改为 `tween` 转跳（`.call(() => this._processNextAIUnit())`），
也会在同一帧命中同一问题。

## 4. 实测数据（编辑器预览 + 页内探针）

| 写法 | 结果 |
|------|------|
| 自排期同一 `(target, method)` | 下一拍只触发 **1 次**，之后静默停止 |
| 每拍包一个新闭包 `scheduleOnce(() => ...)` | 连跑 **5/5** 拍正常 |
| `tween` 链转跳 | 6 个敌方回合、**11 拍**无停顿 |

> 教训：只靠"下一拍"修（换新闭包）能治症状，但"在回调里排期"这个**模式**本身仍在，
> 换个人、换个地方就会再犯。要换成不依赖调度器同一性的驱动方式（见 §5）。

## 5. 推荐范式：`update()` 泵 + 看门狗

把"延迟"从**调度器状态**降级成**一个数字**，推进交给每帧轮询：

```ts
private _clock = 0;          // 组件内累计时钟（秒），保证单调
private _aiNextStepAt = 0;   // 下一拍绝对时间；0 = 无待执行
private _aiWatchdogAt = 0;   // 心跳截止；过期 = 链路断了
private static readonly AI_WATCHDOG_GRACE = 2.0;   // ≥ 单拍上限，但要留出余量

update(dt: number): void {
  this._clock += dt;
  if (this._phase !== 'enemy_turn') return;                 // 成本守卫：绝大多数帧就这一行
  if (this._aiNextStepAt > 0 && this._clock >= this._aiNextStepAt) {
    this._aiNextStepAt = 0;
    this._processNextAIUnit();
    return;
  }
  if (this._aiWatchdogAt > 0 && this._clock >= this._aiWatchdogAt) {
    console.warn('[BattleManager] 敌方回合看门狗触发，强制推进');
    this._aiNextStepAt = 0; this._aiWatchdogAt = 0;
    this._aiQueue.length === 0 ? this.finishAITurn() : this._processNextAIUnit();
  }
}
```

每拍（**从** `_processNextAIUnit` 入口**起**）续期看门狗；补间/动作的收尾**只写时间点**：

```ts
this._aiWatchdogAt = this._clock + AI_WATCHDOG_GRACE;      // 入口续期
enemy.moveToPositionAnimated(moveTarget, MOVE_ANIM_DURATION, () => {
  if (this._phase !== 'enemy_turn') return;                 // 途中已分出胜负就别续回合
  /* … 出手 … */
  this._aiNextStepAt = this._clock + (acted ? AI_STEP_AFTER_ACTION : AI_STEP_AFTER_MOVE);
});
```

配套的四个"取消"点，**清数字就是取消**（比存 tween 句柄更彻底 —— 句柄还可能被别的
bug 弄丢）：

| 位置 | 做什么 |
|------|--------|
| `startBattle` | `_aiNextStepAt = 0; _aiWatchdogAt = 0; _clock = 0;`（`_clock` **只**在开局重置） |
| `onBattleEnd` | 清两个时间点（`unscheduleAllCallbacks()` **停不掉**这个泵） |
| `onDestroy` | 同上；只清数字，不碰 `@property(Node)`（守则 2） |
| 补间回调开头 | `if (this._phase !== 'enemy_turn') return;` |

**注意**：`_clock` 用绝对时间比较，**必须单调**，不要在 `update` 内或中途重置；
判定统一用 `>=`，等号归上一拍处理。

**代价/边界**：`update` 每帧一次比较，可忽略；但组件被 `enabled = false` 时 `update` 停摆、
看门狗也随之失效 —— 与旧 `scheduleOnce` 方案同样受限，可接受。

## 6. 排查清单：怀疑"排期被吞"时

1. 先打**状态指纹**：`_phase` / 队列长度 / `_actionLocked`。队列空 + 无人推进 = 候选。
2. 看"下一拍"是不是**从正在执行的同一回调**里排出来的？是 → 基本可以定性。
3. 临时把 `scheduleOnce(this._cb, …)` 换成 `scheduleOnce(() => this._cb(), …)`：
   **只触发 1 次 → N 次** 就等于证实（这是判据，不是修法）。
4. 顺便检查有没有同一形状的**自递归**：`while` 循环排空队列，别用函数自调用
   （队列里连着一串尸体时会一口气递归到底）。
5. 修完复验：连跑 ≥6 个敌方回合不停顿 + 注入 `_aiWatchdogAt = _clock + 0.1` 看
   `console.warn` 是否出现且回合仍能推进。

## 7. 相关

- 敌方回合的**逐帧验收记录**与动画时序：[`../plans/2026-10-18-tiny-vanguard-combat-feel.md`](../plans/2026-10-18-tiny-vanguard-combat-feel.md)
- 挡下"回调丢失"的看门狗之外，还要防**重复点击**造成的重入：`_actionLocked` 的作用见
  `battle/BattleManager.ts` 的字段注释
- 预览里怎么跑探针：[`browser-verify-cocos-preview.md`](./browser-verify-cocos-preview.md)
