# 结算遮罩与退出路径规范（全屏 overlay / 弹窗）

> 来源：试玩第五、六轮（`docs/plans/2026-11-13-playtest-round5-endstates.md`、
> `docs/plans/2026-11-13-playtest-round6-player.md`）。四款游戏的结算面板
> 曾把玩家锁死在终局页；修复过程中还牵出「主动退出被当成失败」的经济漏洞。
>
> 适用：任何全屏遮罩 + 面板的终局 / 暂停 / 设置 / 离线结算界面。

---

## 1. 症状：看得见、点不动的返回键

缤纷消除 / 扫雷 / 数独 / 成语填字的结算面板出现后：

- 左上角返回按钮**画得清清楚楚**，点下去毫无反应；
- 面板上只有「再来一局 / 换个难度 / 下一关」，**没有返回大厅**；
- 想回大厅只能先重开一局再退出。

四款代码结构完全一致，属于同一个模式缺陷，不是四份独立的 bug。

## 2. 根因：四个条件叠加才"锁死"

| # | 条件 | 说明 |
|---|------|------|
| 1 | 遮罩是 **720×1280 全屏**节点 | 不是只有面板那块 |
| 2 | 遮罩作为**后置兄弟**创建 | 盖在返回按钮之上 |
| 3 | 遮罩监听 `TOUCH_START` 并 `ev.propagationStopped = true` | 触摸不再分发 |
| 4 | 面板里**没有返回大厅按钮** | 没有任何代码路径能离开场景 |

关键机制：**同级节点之间不会冒泡**。返回键和遮罩是兄弟节点，遮罩吞掉事件后，
事件不会"漏"给同级的返回键 —— 所以返回键看起来好好的，实际永远收不到触摸。

## 3. 正确做法：双保险

只补按钮（方案 ①）时，玩家仍会先点左上返回键然后以为游戏卡死；
只调层级（方案 ②）时，又缺少显式的「返回大厅」出口。**两件都要做**：

### ① 结算面板自带「返回大厅」

```ts
const lobby = createButton(panel, {
    w: 164, h: 72, text: '返回大厅', fontSize: 24,
    fill: COLOR.SURFACE, textColor: COLOR.TEXT_PRIMARY, radius: 14,
    onTap: () => this.onBack(),          // 注意：别写 onTap: this.onBack
});
lobby.node.setPosition(178, 0, 0);
```

推荐三键一行（再来一局 / 换个难度 / 返回大厅），与五子棋、台球、推箱子保持一致。

### ② 把返回键抬到遮罩之上

```ts
/** 把左上返回键抬到全屏遮罩之上：结算态下仍然可见、可点 */
private _raiseBackButton(): void {
    const back = this._backBtn && this._backBtn.node;
    if (back && back.isValid && back.parent === this.node) {
        back.setSiblingIndex(this.node.children.length - 1);
    }
}
```

在创建遮罩 / 面板之后调用一次即可。返回键在左上角，面板居中，位置不冲突。

> 保存返回键引用：`this._backBtn = createBackButton(this.node, () => this.onBack());`
> （`createBackButton` 返回按钮包装对象；`onDestroy()` 里只置 null，不碰节点。）

## 4. 遮罩浓度：全站统一 `alpha = 235`（≈92%）

215（84%）时底下的底栏按钮"只暗一档、轮廓清晰"，读起来像还能点，配合吞事件会
放大"点了没反应"的挫败感。235 下底层彻底退成背景。

| 位置 | 值 |
|------|-----|
| 缤纷消除 / 扫雷 / 数独 / 成语填字结算 | 235 |
| 放置小店离线结算 | 235 |
| 雷霆战机结算 | 235 |

新增遮罩直接用 235，不要各自发挥（暂停面板可用稍低的值，但结算必须 235）。

## 5. 结算的经济语义：失败保底必须区分「被打死」与「主动退出」

雷霆战机曾出现：进关 → 暂停 → 「退出本关」→ 白拿失败保底 30 金币，可无限循环，
比真打一局还快，养成线被绕过。

修法（`ThunderGame.ts`）：

```ts
private _quitByPlayer = false;

private _quitBattle(): void {
    this._quitByPlayer = true;      // 主动退出标记
    w.phase = 'lost';
    this._finish(false);
}

private _finish(won: boolean): void {
    const quit = this._quitByPlayer;
    this._quitByPlayer = false;     // 每次结算后复位
    const consolation = won || quit ? 0 : Math.max(0, 30 - w.coinsEarned);
    this._showSettle(won, stars, earned, quit);
}
```

```ts
// _showSettle 里
createLabel(panel, quit ? '已退出本关' : won ? '关卡完成' : '任务失败', …);
createLabel(panel, quit ? '主动退出 · 不计失败保底' : …);
```

要点：

- 标记在 `_startBattle()` 里复位，避免上一局的退出状态污染下一局；
- 死者点「放弃复活」仍算被打死，照发保底（不要连这个分支一起砍掉）；
- 文案必须跟着分支走，否则「退出」也会显示「被击落」，玩家会当成 bug 报。

**通用检查**：任何"失败补偿 / 保底 / 失败掉落"都要能回答
「玩家主动退出时还给不给？」，给与不给都要有显式分支。

## 6. 附带坑：`createButton` 的 `onTap` 调用不带 `this`

```ts
// ❌ 运行时 TypeError: Cannot read properties of undefined
onTap: this.onBack,

// ✅ 包一层
onTap: () => this.onBack(),
```

`createButton` 内部是 `node.__tapCb()` 直接调用，没有绑定实例。
类字段箭头函数（`private onTap = () => {}`）也可以，但项目内统一用包装写法。

## 7. 新面板检查清单

新建任何全屏遮罩 / 结算面板时逐条过：

- [ ] 面板上有显式的「返回大厅」（或等价的离开路径）
- [ ] 左上返回键在遮罩出现后仍然可点（`setSiblingIndex` 抬到最上层）
- [ ] 遮罩 `alpha = 235`
- [ ] 吞事件只用于"阻止误触底层"，不依赖同级冒泡
- [ ] 按钮回调是命名方法或箭头包装，不用裸的 `this.method`
- [ ] 主动退出与失败结算在经济与文案上分开
- [ ] `onDestroy()` 只清 JS 引用，不访问任何 `@property(Node)`
