# 第八轮试玩报告：冰箱底下「真·通关」与 Boss 房炸弹死局（2026-11-13）

> 角色：玩家 / QA。
> 背景：上一轮（[`2026-11-13-playtest-round7-player.md`](./2026-11-13-playtest-round7-player.md)）
> 被质疑「没有真正通关、没有玩到所有场景」。
> 本轮目标：**不作弊地把冰箱底下从第 1 层打到最终 Boss 通关**，逐项走过所有房型与面板，
> 并在过程中继续找问题。
>
> **结论：① 完成了一局真实通关（§2，seed 1426738267）；② 覆盖了全部房型与面板（§3）；
> ③ 发现一个 P1 死局——在 Boss 房炸开旁边的秘密墙，会让本层直接无法完成，第 4 层则永远无法通关（§4）；
> ④ 另一个 P1——六个角色的「开局道具」配置从未生效，酸奶的主动技能因此整局空转（§5 N32）。**

---

## 1. 方法与取证

- 预览 `http://127.0.0.1:7456/`，视口 390×844（设计 720×1280）。
- 操作全部走游戏自身的输入路径：页面内脚本直接维护键盘 handler 写入的同一个 `_keys` 集合
  （37/38/39/40），移动与自动射击由此驱动；面板选择调用 `onTreasurePick / onShopBuy /
  onAltarTake / onCorePick`，与面板按钮绑的是**同一个方法**；炸弹 / 技能分别调用
  `useBomb()` / `useActive()`，与炸弹键 / 技能键同源。
- **没有**改金币、血量、道具、核心、冰箱贴、地图或怪物，没有瞬移（唯一的“跳步”是开局面板里的
  起始层选项，用于 §4.3 的第 4 层对照，已单独标注）。
- 状态一律用页内探针读回（`_core` 的 `phase / floor / roomId / stairs / pendingCore /
  secretOpened / magnets / kills / time`、房间对象的 `cleared / doors / visited`、localStorage），
  不只看截图。
- **点击坐标必须现场标定，别信 `getBoundingClientRect()`**：本轮 rect 给的是
  `left=-1.5 / top=48 / 393×796`，按 `cssY = top + (1280 − 设计y) × 0.5458` 算出 323 点
  「开始冒险」**毫无反应**；把 y 加 52px（点 375）才命中。换算一律以「点下去有没有反应」为准。
- **本轮没有修改任何 `.ts` / 场景 / 预制体。** 自动化脚本在 `.playwright-mcp/`（已在 `.gitignore`）。

## 2. 真实通关记录（第 1 → 4 层）

| 项 | 值 |
|---|---|
| 种子 / 角色 / 模式 | `seed 1426738267` · 酸奶（yogurt） · 普通 |
| 起始层 | 第 1 层，起始房 → 逐层推进 |
| 结果 | `phase = 'won'`（第 4 层最终 Boss 压缩机 460 HP 被击杀） |
| 用时 / 击杀 / 金币 | 205.2 s · 79 杀 · 68 金币（冰箱贴本局 52） |
| 通关时状态 | hp 6/10 · 道具 `soda, wrap, magnet, mint, toothpick, wrap`（**没有 `mold`，所以酸奶的「发酵」整局空转，见 §5 N32**） · 核心 `bounce, split, shield` · 协同 `sugar_dregs, hunting_split` · 玩家伤害 2.31 / 射速 1.8 |
| meta 落盘 | `runs 26 / wins 2`、`charClears = ['pudding','yogurt']`、`bestFloor 4`、`maxClearedFloor 4`、`magnets 105`、`seenItems 16` |
| 结算面板 | 标题 + 用时/分数/击杀 + 新纪录行 + 冰箱贴收益 + 图鉴新增 + 解锁列表；点空白回主菜单后**无 HUD 残留** |

两处交叉验证「这不是假胜利」：

- `_updateEnemies` 只在 `hp <= 0` 时移除敌人，`phase = 'won'` 只能在第 4 层 Boss 房
  「敌人清零 + `_clearRoom` 正常执行」时产生（`FridgeCore.ts:937-949`）；
- 进场时敌人数量 3 = 最终 Boss + 同层随机 2 只小怪（`_spawnRoomEnemies`，`FridgeCore.ts:896-903`），
  与战斗日志吻合。

> 与第七轮手工点按的 976 s 差异来自操作方式（自动瞄准 + 不停顿），不影响结论。

## 3. 覆盖到的流程清单

| 场景 | 本轮证据 |
|---|---|
| 起始房 / 传送到下一层 | 每层起始房 `cleared=true`、无敌人；Boss 核心选完后 `stairs={x:0,y:120}`，走上去 `nextFloor()` 成功 |
| 战斗房（3–9 只） | 四层所有路过的战斗房全部清空，`+1 充能`、2–4 币 + 半心 / 炸弹掉落均观察到 |
| 宝箱三选一 | 每层均出现；自动化固定优先挑 `wrap`，三张卡与「换一批」按钮渲染正常 |
| 商店 | 第 2 层：电池 16 / 半心 4 / 炸弹 3；金币 1 时买半心（hp 1→2）成功，买不起走 toast |
| 祭坛 | 第 4 层：献祭 1 心（8→6）得 `toothpick`；不献祭可直接离开 |
| 秘密房 | 第七轮已走过（冰箱贴 +2、房间中心 1 件道具 + 3 币）；本轮另外**证实了炸弹开墙的另一条分支有问题**（§4） |
| Boss（4 层） | moldking 180 / stitchbear 260 / bluescreen 340 / compressor 460 全部击杀；1–3 层各得 1 次核心三选一 |
| 核心 / 协同 / 道具 | 核心 `bounce / split / shield` 生效（弹跳弹、分裂弹、开局护盾）；本局触发协同 `sugar_dregs`、`hunting_split`（`core.synergies`） |
| 续局 | 战斗中退出 → 重进「继续上局」，`phase=playing`、楼层 / 房间 / 血量 / 金币 / 冰箱贴一致（**击杀数与用时被清零，见 §5 N30**） |
| 主动技能 | 酸奶 =「发酵」（充能 5，引爆全场中毒层）。**通关那局它是全程空转的**：发酵只对中毒敌人有效，中毒唯一来源是道具「发霉面包」，而这个角色本该开局携带它却**从来没拿到过**（§5 N32），整局没引爆过任何东西。技能数值另用无头逻辑自检确定性验证：注入 `mold` → 子弹命中后敌人中毒 → 发酵使 `poisonT / poisonDps` 清零、爆发伤害 = `poisonDps × poisonT`、充能 5→0、产生 `active` 事件，9/9 通过（另 3 条：充能不足 / 面板冻结时拒绝、空放照样扣充能）。布丁「糖浆冲刺」第七轮已逐帧验证（充能 3→0、位移约 120、0.3 s 无敌）；汽水、磁铁人仍锁在 meta 里，**没有**用引擎调用强行体验 |

## 4. P1：Boss 房炸开秘密墙 → 本层直接报废（第 4 层 = 永远无法通关）

### 4.1 现场复现（seed 1 · 第 1 层 · 酸奶 · 普通）

种子 1 的第 1 层地图：Boss 房 `id 6 @ (4,4)`，秘密房 `id 7 @ (4,3)`——**就在 Boss 房正下方**，
两者之间只有一堵墙。

1. 全程留着一颗炸弹（自动化禁用了炸弹键），t=47 s 走进 Boss 房：hp 9/10、炸弹 1、金币 21、
   敌人 3（`moldking` 180 血 + 2 只小怪）；
2. 贴到下墙心前（落点 `(2, -282)`，墙心 `(0, -312)`，距离 30 < 炸弹半径 140），按炸弹键
   （此时 `moldking` 已被磨到 176 血）；
3. 引信爆炸后同一帧内：
   - `room6.cleared = true`（**Boss `moldking` 还活着，142 血**）
   - `room6.doors = ['left','down']`（新门已开）
   - `secret.visited = true`、`secretOpened = 1`、冰箱贴 4 → 6
   - `stairs = null`、`pendingCore = null`
4. 把 Boss 打死（`enemies = []`、kills 26）后再读：
   - `pendingCore = null`（**没有核心三选一**）
   - `stairs = null`（**没有传送口**）
   - `pickups = 0`、金币 21 → 21（**没有清房掉落的币 / 半心 / 炸弹**）
   - `nextFloor() = false`，楼层仍是 1

> 同一路径跑了两遍：第一遍手动把角色带到墙心（`moldking` 106 血时引爆，炸弹后仍存活），
> 中途角色被 Boss 打死；第二遍把「贴墙心 + 放弹」并入自动化后一次跑通，上表为第二遍的读数。

HUD 此时落到「本房间已清空 · 走到门口进入下一个房间」这一支（`FridgeHud.ts:1066-1068`，
条件是 `roomCleared && enemies.length === 0 && doors.length > 0`；实测这三个字段正是
`true / 0 / 2`），但地图上根本没有传送口——玩家会以为还有别的出口。

### 4.2 更省事的触发：炸完墙走出去再回来，Boss 直接消失

`room.cleared = true` 同时解开了「打完才能出门」的锁（`isRoomLocked()`，`FridgeCore.ts:379-383`），
而 `_changeRoom` 会清空敌人、且已 `cleared` 的房间不再刷怪（`FridgeCore.ts:826-866`）。
所以炸墙后走进新开的秘密房、再走回 Boss 房，**Boss 不会再出现**，连“打死它”这一步都省了。

### 4.3 第 4 层：连“退出→继续”的兜底都没有

`fromSave` 里有一条针对这种现象的兜底：Boss 房已 cleared 但没有待选核心时，补一个传送口
（`FridgeCore.ts:246-248`）。但它的条件是 **`w.floor < 4`**：

- 第 1–3 层：炸墙 → 打完 Boss 拿不到核心 → 退出场景 → 「继续上局」→ 传送口被补出来，
  可以继续，但**白丢一次核心选择**（实测续局后 `stairs={0,120}`、`pendingCore=null`，
  `nextFloor()` 成功进第 2 层）；
- 第 4 层：这个兜底不成立 → **最终 Boss 打完 `phase` 仍然是 `playing`**，拿不到胜利结算，
  也下不去，只能放弃本局。

第 4 层这个分支用无头逻辑自检做了确定性验证（与 `tools/verify-fridge-core.js` 同样的编译方式，
19 条断言全部通过）：

| 断言 | 结果 |
|---|---|
| seed 22 第 4 层（秘密房在最终 Boss 房左侧）炸墙 → Boss 存活但 `cleared=true` | ✅ |
| 炸墙后击杀最终 Boss → `phase` 仍为 `playing`（对照组不炸墙 → `won`） | ✅ |
| 第 4 层 `nextFloor()` 返回 false、`stairs` 恒为 null | ✅ |
| 第 1 层炸墙 → 清 Boss 后无核心、无传送口、`nextFloor()` false（对照组：有核心、有传送口、能进第 2 层） | ✅ |
| 第 1–3 层续局补回传送口但 `pendingCore=null`；第 4 层续局什么都不补 | ✅ |
| 炸墙后离开再进 Boss 房 → 敌人不再刷新 | ✅ |

> 说明：§4.3 的“第 4 层”一项是把玩家放到墙心使用（同一 `useBomb()` 路径），其余字段全部来自真实
> core 逻辑；没有为了让 Boss 死而改血量的执行路径——是把 `hp` 置 0 后**让引擎自己走
> `_updateEnemies → _clearRoom`**，与真实击杀后的清房分支完全一致。

### 4.4 代码原因

```ts
// FridgeCore.ts:641  炸墙：无条件把“当前房间”标记为已清空
private _openSecretAt(x: number, y: number): boolean {
    ...
    if (room.doors.indexOf(dir) < 0) room.doors.push(dir);
    secret.visited = true;
    room.cleared = true;        // ← 666 行：不看房间里还有没有活着的敌人
    opened = true;
    ...
}
```

```ts
// FridgeCore.ts:915  清房结算：房间只要已被标记 cleared 就直接返回
private _clearRoom(room: RoomNode): void {
    if (room.cleared) return;   // ← 916 行：核心三选一 / 传送口 / 充能 / 掉落 / 通关判定全在这之后
    ...
    if (room.kind === 'boss') {
        ...
        if (this.floor >= 4) this.phase = 'won';
        else this.pendingCore = this._rollCores();
    }
}
```

### 4.5 触发概率（seed 1–400 × 第 1–4 层 = 1600 个楼层实例）

| 统计 | 数量 | 占比 |
|---|---|---|
| 秘密房与 **Boss 房**相邻 | 694 | **43.4%**（第 1/2/3/4 层分别 189/174/166/165，第 4 层 41.3%） |
| 秘密房与**普通战斗房**相邻 | 1414 次 | **73% 的楼层**至少有一个相邻战斗房 |

也就是说：**四成多的楼层里，在 Boss 房靠墙随手放一颗炸弹就可能触发死局**；在普通战斗房触发时
后果轻一些（少 `+1 充能` 与一次清房掉落），但同样是“房间显示已清空却还在挨打”。

### 4.6 建议修复

1. `_openSecretAt` 不要动 `room.cleared`：只做「开门 + `secret.visited` + 冰箱贴」；
   若确实想保留“炸墙即清房”的手感，至少加 `this.enemies.filter(e => e.hp > 0).length === 0`；
2. 顺带让 `isRoomLocked()` 依赖“敌人是否清零”而不是 `cleared` 标记，避免带着怪离开；
3. `fromSave` 的兜底不要只认 `floor < 4`：第 4 层若已 `cleared` 且没有 `pendingCore`，
   应当直接补一次核心三选一（或直接判胜），否则玩家会被永久卡在最后一层；
4. 给这一条补自检：`炸墙 + 清 Boss` 在 1–4 层都必须拿到核心 / 胜利，不能再依赖手测。

## 5. 本轮其它发现

### N30（P2）续局把击杀数与用时清零

`toSave()`（`FridgeCore.ts:1020+`）不含 `kills` / `time` 字段，`fromSave` 里还显式 `w.time = 0`
（`FridgeCore.ts:222`）。实测：退出前 `kills 26 / time 75.6 s`，重进「继续上局」后
`kills 0 / time 0`。结算面板的分数 = `kills * SCORE_PER_KILL + floor(time) * SCORE_PER_SEC`
（`FridgeHud.ts:1072-1074`），所以**中途续玩等于把已得分抹掉**，也会让「最佳分数」失真。
建议把 `kills` / `time` 写进存档并在 `fromSave` 恢复。

### N32（P1）六个角色的「开局道具」配置全部没生效——`startItem` 是死数据

规格 §434 的角色表里每个角色都有「开局道具」（布丁=焦糖壳、过期酸奶=发霉面包、冰箱贴=磁铁……），
`FridgeConfig.ts:434-476` 的 `CharDef.startItem` 也全都填好了，但**全仓没有任何代码把它发出去**：

```ts
// FridgeCore.ts:150-165  构造函数：道具表恒为空
this.items = [];
// FridgeCore.ts:258-300  _enterDungeon：整局重开也只清空，没有 push char.startItem
this.pickups = [];
...
// 全仓唯一读 startItem 的地方是自检脚本，且只校验 id 在 ITEM_BY_ID 里存在
// tools/verify-fridge-core.js:134   if (!F.ITEM_BY_ID[c.startItem]) startOk = false;
```

**实测（两层证据）**：

- 无头：`newRun(seed, charId)` 六个角色全部 `items=[]`、`hasItem(startItem)=false`；
- 真实预览：主菜单点「开始冒险 · 布丁」开局后探针读回
  `charId=pudding / startItem=caramel / items=[] / hasStartItem=false`，HUD 道具栏直接是
  「道具：无（清房后回中心拾取）」。

**影响**（比“少一件道具”重）：

1. 规格 §453 说「角色不是皮肤，**开局就决定了一条构筑倾向**」——现在六个角色开局完全一样，
   差分只剩数值倍率；
2. **酸奶的主动技能「发酵」等于不存在**：全场唯一中毒来源是 `mold`（`FridgeCore.ts:1549-1553`），
   而它正是酸奶的开局道具。本次通关那局 6 件道具里没有 `mold`，发酵整局空转（见 §3）；
3. 冰箱贴（magneto）开局没磁铁、冰块没薄荷、汽水没汽水，`hasTag` 驱动的 14 条协同
   全部从“无标签”起步，前两层很难点亮任何协同。

**建议**：在 `_enterDungeon()` 末尾（`_syncSynergies` 之前）加
`if (this.char.startItem && ITEM_BY_ID[this.char.startItem]) this.addItem(this.char.startItem);`，
并给 `tools/verify-fridge-core.js` 的第 10 项补一条「开局后 `hasItem(c.startItem) === true`」——
现在这条自检只校验 id 拼写，属于“测了配置、没测行为”。

### N33（P3）主动技能空放照样扣满充能，且没有任何反馈

`useActive()`（`FridgeCore.ts:1390-1397`）对酸奶只遍历“已中毒”的敌人，**一个都没有时也照样
`spent()`**；磁铁人同理（没有敌弹也扣 6）。实测：全场无人中毒、充能 5 → `useActive()` 返回 true、
充能变 0、无任何提示。刚进新房间（敌人还没被子弹命中）随手一按就会白扔一整条技能。
建议：作用对象为空时返回 false、不扣充能（或至少 toast「没有可引爆的中毒」）。

### 遗留项（第七轮登记，本轮冰箱相关项复核仍成立）

| 级别 | 编号 | 一句话 | 本轮复核 |
|---|---|---|---|
| P2 | N25 | 每日挑战用随机种子而非 `dailySeed()`，重开就能换地牢 | 代码未变（`FridgeGame.ts:196`） |
| P2 | N26 | 菜单 `_tip` 只在主视图渲染，角色/解锁树里的购买反馈不可见 | 代码未变 |
| P3 | N27 | 宝箱「换一批」用过不置灰，第二次点击静默无响应 | 代码未变（按钮文案只在构建时写一次）；本轮自动化只走「直接选一张」，未再点换一批 |
| P3 | N28 | `collector` 是界面不存在的解锁，结算会显示内部 id | 未复现（需集齐 30 件图鉴） |
| P3 | N29 | 道具栏「清房后回中心拾取」与本房间已清空提示矛盾 | 代码未变（空道具时仍固定拼这句） |

## 6. 撤回声明

第七轮记录的「死亡面板『再来一局』失效」**撤销**：当时是探针在空白处补了一次 `mouseup`，
触发了 `_restartIfDead()` 之外的菜单逻辑；单次干净点击可以正常重开。本轮未再复现。

## 7. 测试数据污染（均在 localStorage，未提交）

- `tiny_games_fridge_meta`：`runs 26 / wins 2 / bestFloor 4 / maxClearedFloor 4 / magnets 105 /
  seenItems 16 / unlocks` 含 `char_candy`、`char_yogurt`、`char_icecube`、电梯等
  （复核 N32 时又开了一局布丁，菜单已变成 `局数 29 / 冰箱贴 111`）；
- `tiny_games_fridge_run`：复核 N32 时新开的布丁局（第 2 层、`phase=playing`、`items=[]`）；
  更早一次实验留下过 seed 22、第 1 层、`phase=dead` 的档；
- 仓库根目录有一张未跟踪截图 `fridge-death-1.png`（早期）；本轮的菜单截图放在
  `.playwright-mcp/`（已 gitignore）。
- 还原：清对应键 + **整页 reload**（活着的场景会把旧值写回，只清 storage 不 reload 会得出错误结论）。

## 8. 优先级汇总

| 级别 | 编号 | 一句话 |
|---|---|---|
| **P1** | **N31** | **炸弹在 Boss 房隔壁开秘密墙 → 房间被提前判清 → 本层无核心/无传送口；第 4 层最终 Boss 打完也不 `won`，永久卡死**（四成楼层可触发） |
| **P1** | **N32** | **六个角色的「开局道具」从未发放**（`startItem` 是死配置）→ 角色只差数值、酸奶「发酵」整局空转、协同从零标签起步 |
| P2 | N30 | 续局把 `kills` / `time` 清零，中途继续等于丢掉已得分 |
| P2 | N25 | 每日挑战未用 `dailySeed()`，每次重开随机地牢 |
| P2 | N26 | 菜单 `_tip` 只在主视图渲染，购买反馈不可见 |
| P3 | N27 / N28 / N29 | 宝箱换一批无反馈 / `collector` 内部 id / 道具栏文案矛盾 |
| P3 | N33 | 主动技能空放照样扣满充能，无任何反馈 |

### 复验配方（给开发）

1. `seed = 1`、普通、酸奶、第 1 层，开局（或直接 `startNewRun({startFloor:1})` 后令 `seed=1`）；
2. 从起始房按图走到 Boss 房 `(4,4)`，此时地图上秘密房在 `(4,3)`（正下方）；
3. 进 Boss 房后贴着下墙中心（`x≈0, y≈-290`）放一颗炸弹；
4. 断言：`room6.cleared === true` 而 `enemies.length > 0`；打死 Boss 后 `pendingCore === null`、
   `stairs === null`、`nextFloor() === false`；
5. 把种子换成 `22`、起始层 4（秘密房 `(3,4)` 在 Boss 房左侧，贴左墙 `x≈-225, y≈0` 放弹），
   打死压缩机后断言 `phase === 'playing'`（对照：不炸墙时为 `'won'`）。

N32 一分钟复现（不用碰炸弹）：任意角色开新局，读 `_core.items` —— 恒为 `[]`，
而 `_core.char.startItem` 有值；对照规格 §434「开局道具」一列，以及 `FridgeCore.ts:258` 的
`_enterDungeon()` 里没有任何 `addItem(char.startItem)`。
