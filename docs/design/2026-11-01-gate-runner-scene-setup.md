# 数值冲刺 场景搭建记录（GateRunner.scene）

> 状态：**已搭建、已验收**（2026-11-01）。19/19 绑定全通，浏览器实测走完「拖动选门 → 对拼 → 暂停 → 通关 / 阵亡 → 重来一局 → 返回大厅」，0 console error。
> 场景：`assets/games/game_gate_runner/scenes/GateRunner.scene`（uuid `f2df3916-32b7-4314-9344-e7dd0e95828c`，83,956 B）
> 组件：`assets/games/game_gate_runner/scripts/GateGame.ts`（19 个 `@property`：12 个 Node + 7 个 Label，cid `08f5ezyttBPi5KrNq17ObbV`）
> 关联：[`../specs/2026-11-01-game-gate-runner-design.md`](../specs/2026-11-01-game-gate-runner-design.md)

---

## 1. 画布与坐标约定

与砖块远征 / 合合大作战完全一致（模板复用）：

| 项 | 值 |
|----|----|
| 设计分辨率 | 720 × 1280（`fitWidth` + `fitHeight`，`SHOW_ALL`，上下留黑边） |
| Canvas | 720 × 1280，锚点 (0.5, 0.5)，位置 (360, 640)，`cc.Widget` 四边对齐 |
| Camera | 子节点 (0, 0, 1000)，正交 `orthoHeight 640`，layer `1073741824` |
| PlayArea | 660 × 860，位置 (0, -70) —— 对应逻辑坐标 `PLAY_W` × `PLAY_H` |
| 逻辑坐标 → 节点坐标 | `x = -PLAY_W/2 + logicX`，`y = PLAY_H/2 - logicY`（原点左上、y 向下） |
| UI layer | `UI_2D = 33554432` |

`GateGame` 侧的换算集中在 `_sx()` / `_sy()` / `_screenY()`：

```ts
_sx(logicX)          = -PLAY_W/2 + logicX
_sy(screenY)         =  PLAY_H/2 - screenY
_screenY(worldY)     =  PLAYER_Y - (worldY - distance)     // 世界 → 屏幕
```

输入换算在 `_toLogic()`：

```ts
const local = this._inputTransform.convertToNodeSpaceAR(new Vec3(uiX, uiY, 0));
return { x: local.x + PLAY_W / 2, y: PLAY_H / 2 - local.y };
```

---

## 2. 节点树（**实建结果**，坐标取自 MCP 读回）

```
GateRunner (Scene)                                                           [f2df3916-…]
└── Canvas                   720×1280, cc.Canvas, cc.Widget(全屏)            [f8XO9tPRlKgbFSi4rWGDmH]
    ├── Camera               (0,0,1000) 正交                                 [6dxd38H49LQo5q01ZLgZkR]
    └── GameRoot             UITransform, GateGame (cid 08f5ezy…)           [cawVMGn9tLe7vdCjn0Td61]
        ├── PlayArea (0,-70)             660×860                            [1b6Z23Sx5J445G9RIbhmKW]
        │   ├── Background (0,0)         660×860  Graphics（静态背景网格 + 道路，每帧重画但内容只依赖 distance）  [6cHCb77vRKB4s5u0JoNAWg]
        │   ├── InputArea  (0,0)         660×860  UITransform（触摸区，无渲染组件）  [3bDcN9/ntCFLP5YsxWwzGu]
        │   └── ClipLayer  (0,0)         660×860  UITransform + cc.Mask(type=0 GRAPHICS_RECT) + cc.Graphics  [64tVutWN5NV7fi9i7yB/NI]
        │       ├── Field (0,0)          660×860  Graphics（门 / 敌人 / 子弹 / 队伍）  [2ezYkN2ChLjqBfiNnZcDKb]
        │       └── Effects (0,0)        660×860  Graphics（碎屑）                     [f8KJna1vZBrKgn7lqqzMO1]
        ├── HudTop (0,520)               660×220                            [4fzRWiYm9EtLhQ8FiAZPsa]
        │   ├── CountTitle    (0, 95)    26pt「人数」                          [7aFHs8dLBPXojiPoulUH+i]
        │   ├── CountLabel    (0, 40)    56pt 数值（>FIRE_CAP 变青）           [e3pHepxLxBiLLU+K5n72Tk]
        │   ├── DistanceLabel (0,-30)    28pt「N m · N km/h」                 [fapZCEx9JAsqLgHG/jMDh9]
        │   └── HintLabel     (0,-95)    24pt 状态提示语                       [5aulnWGx5MIItAZlYajlYZ]
        ├── PauseButton (300, 575)       96×96 + 子 Label「暂停」              [de1sUcWmdLaZlwtu48eWXI]
        ├── BackButton  (-300, 575)      96×96 + 子 Label「返回」              [d9yOwm3V9O36ShR+4y24eu]
        ├── PausePanel  (0,0)  [active=false]                                [49kcXSENRECrOSAGR5yKb2]
        │   ├── Dim (0,0)                720×1280  Sprite 白图染色            [fbFf2CQWNKjYtbeXa3wAhq]
        │   ├── Title (0,220)            48pt「暂停」                          [dcLOBEgClMcJg/BmBBJFkZ]
        │   ├── ResumeButton  (0, 80)    360×96「继续」                        [cb9LfcKwJMHLoq5COks6y3]
        │   ├── RestartButton (0,-40)    360×96「重新开始」                     [43b4+vBq1EDqiyHAo/6hDr]
        │   └── LobbyButton   (0,-160)   360×96「返回大厅」                     [89NbHnr6pBYJ8KfW/bpV1T]
        └── ResultPanel (0,0)  [active=false]                                [97pT1lqTdJ6pitMXPUBD8K]
            ├── Dim (0,0)                720×1280                             [95vf9/MoZB0arEpTyWy3pf]
            ├── ResultTitle   (0, 380)   56pt「通关！」/「全军覆没」              [79334dVaxDjLZqjkZgQyvm]
            ├── ScoreValue    (0, 250)   64pt 分数                             [a3Gf6JtnBOGJbZXmLrDpsN]
            ├── CountLine     (0, 150)   30pt「人数 N · M m」                   [f0yYs6UQhKUqR1DHcGQ3Zf]
            ├── BestValue     (0,  55)   28pt「最高分 N」                       [37HSYL15ZNar9d0AqhuM4h]
            ├── RestartButton (0,-120)   360×96「再来一局」                     [c3Qn5XUYRDdZvg9tV5EF5L]
            └── LobbyButton   (0,-240)   360×96「返回大厅」                     [2d/lBWHvFBjLLuRySNcfCM]
```

> **与合合大作战的两处结构差异**：
> 1. `BackButton` 与 `PauseButton` 平铺在 `GameRoot` 左右（`-300 / +300`, y=575），不依赖公共 `BackButton` 组件，走 `Node.EventType.TOUCH_END`；
> 2. 多了 `ClipLayer`（`cc.Mask`）—— 见 §6，是本次唯一的"结构性修复"。

---

## 3. 19 项 `@property` 绑定

| # | 属性 | 类型 | 绑定节点 |
|---|------|------|---------|
| 1 | `backgroundLayer` | Node | PlayArea/Background |
| 2 | `fieldLayer` | Node | PlayArea/ClipLayer/Field |
| 3 | `effectLayer` | Node | PlayArea/ClipLayer/Effects |
| 4 | `inputArea` | Node | PlayArea/InputArea |
| 5 | `countLabel` | Label | HudTop/CountLabel |
| 6 | `distanceLabel` | Label | HudTop/DistanceLabel |
| 7 | `hintLabel` | Label | HudTop/HintLabel |
| 8 | `pauseButton` | Node | PauseButton |
| 9 | `pausePanel` | Node | PausePanel |
| 10 | `pauseResumeButton` | Node | PausePanel/ResumeButton |
| 11 | `pauseRestartButton` | Node | PausePanel/RestartButton |
| 12 | `pauseLobbyButton` | Node | PausePanel/LobbyButton |
| 13 | `resultPanel` | Node | ResultPanel |
| 14 | `resultTitleLabel` | Label | ResultPanel/ResultTitle |
| 15 | `resultScoreLabel` | Label | ResultPanel/ScoreValue |
| 16 | `resultCountLabel` | Label | ResultPanel/CountLine |
| 17 | `resultBestLabel` | Label | ResultPanel/BestValue |
| 18 | `resultRestartButton` | Node | ResultPanel/RestartButton |
| 19 | `resultLobbyButton` | Node | ResultPanel/LobbyButton |

绑定纪律（沿用踩坑手册）：
- Node 类型属性绑**节点 UUID**；Label 类型属性用 `propertyType:'component'` + **节点 UUID**（写 `'cc.Label'` 会被拒）。
- 面板按钮 `@property({ type: Node })` + `Node.EventType.TOUCH_END`，**不挂 cc.Button**（红线 3）。

---

## 4. 搭建顺序（本次实跑，可直接复用）

1. 复制 `Merge.scene`/`BrickBreaker.scene` 的骨架思路：`scene_create_scene` → 自建 Canvas + Camera（空场景没有）
2. `GameRoot` ← `component_attach_script` `GateGame.ts`（返回"was not found"是假失败）
3. `PlayArea` → `Background`(Graphics) / `InputArea`(UITransform 660×860) / `Field`(Graphics) / `Effects`(Graphics)
4. `HudTop` + 4 个子 `Label`
5. `PauseButton` / `BackButton`（各 96×96 + 子 Label，走 Node 事件）
6. `PausePanel`（Dim + Title + 3 按钮）、`ResultPanel`（Dim + 4 Label + 2 按钮），建完立刻 `active=false`
7. 逐项 `component_set_component_property` 绑 19 个引用
8. `assetAdvanced_validate_asset_references` → `scene_save_scene`
9. 读回核对：`component_get_component_info` 确认 19 项非 null（页内 `missing: []`）

---

## 5. 搭建完成后读回核对的项

| 项 | 结果 |
|----|------|
| `InputArea` / `Background` / `Field` / `Effects` 的 `contentSize` 是 660×860（不是 2×2） | ✅ |
| 面板 `active` 初始为 false | ✅ 两个面板都是 false |
| `PauseButton` / `BackButton` 有 `UITransform` 96×96 且 `active=true` | ✅ |
| 19 项 `@property` 运行时非 null | ✅（直接 `?scene=` 与大厅入口各验一次） |
| `ClipLayer` 的 `cc.Mask.type` = 0（GRAPHICS_RECT） | ✅ |

---

## 6. 本轮唯一的坑：敌人画到了 HUD 上面（`cc.Mask` 修复）

**症状**：截图里敌人方块和它的血量数字画到了顶部 HUD 区域，把「人数 / 距离」压在下面。

**根因**：`Field` / `Effects` 是 `PlayArea` 的兄弟节点里的普通 `Graphics` 兄弟，
`_drawEnemies()` 只做距离裁剪（`sy < -200 || sy > PLAY_H + 200`），
当敌人还差 200 px 才到游戏区上边缘时就已经被画出来了 —— 而 `Graphics` 没有裁剪概念，
于是直接盖到 `HudTop`（与 `PlayArea` 同为 `GameRoot` 的子节点、渲染顺序在后）。

**修法（纯场景侧，不改代码）**：

1. `node_create_node` 建 `ClipLayer` 挂在 `PlayArea` 下
2. `component_add_component` `cc.UITransform` → `contentSize` 660×860（**必须在 `cc.Mask` 之前**）
3. `component_add_component` `cc.Mask`，`type = 0`（`GRAPHICS_RECT`）
   —— 引擎会自动给它补一个 `cc.Graphics` 作为遮罩渲染器，**不要再手动加**
4. `node_move_node` 把 `Field`、`Effects` 移进 `ClipLayer`
5. 保存后 `project_refresh_assets` → 刷新预览 → 截图确认敌人被裁在游戏区内

> 注意顺序：如果先加 `cc.Mask` 再设 `contentSize`，遮罩矩形会按默认 100×100 生效，
> 表现是"整个游戏区只剩左上角 100×100 有内容"（与踩坑手册 §3.5 "contentSize 必须在 spriteFrame 之后" 同源）。

**验证**：`gate-runner-masked.png`（修复后截图）中敌人方块被裁在游戏区上边缘，HUD 完整可读。

---

## 7. 浏览器实测清单（2026-11-01 全部通过）

| 步骤 | 断言 | 结果 |
|------|------|------|
| 大厅点「数值冲刺」 | 进入 GateRunner 场景，HUD 显示「20」「0 m · 42 km/h」 | ✅ |
| 在可玩区按住拖动 | 队伍中心 x 跟随手指（实测 152 ↔ 504），钳制在 [90, 570] | ✅ |
| 第一对门 | 从左/右一侧通过，人数按该侧数值变化（×2: 20 → 40） | ✅ |
| 敌人 | 接触后停止前进，敌血下降、我方人数下降（`squad_hit` 飘字） | ✅ |
| 暂停 → 继续 | 面板出现/消失；暂停期间 `distance` 冻结 | ✅ |
| 暂停 → 重新开始 | 回到 running，人数回 20，面板关闭 | ✅ |
| 暂停 → 返回大厅 | 回到 Lobby | ✅ |
| 打到 Boss | Boss 血条归零，`通关！` 结算，分数含 1000 通关奖励（实测 1884） | ✅ |
| 人数归零 | `全军覆没` 结算，`人数 0 · N m` + `最高分 N` | ✅ |
| 再来一局 | 场景重置、面板关闭、`state=running` | ✅ |
| console | 0 error | ✅ |

> **点击坐标换算（本轮唯一踩到的测量坑）**：预览画布是 CSS 拉伸的，
> 直接按 `rect.height / canvas.height` 缩放会算错。正确做法是
> `cssX = rect.left + camera.worldToScreen(node.worldPosition).x`、
> `cssY = rect.bottom − sp.y`（**不做额外缩放**）。
> 本轮先用错误公式导致「再来一局 / 暂停」点了没反应，改成上式后一次命中。
> 详见 [`../tech/browser-verify-cocos-preview.md`](../tech/browser-verify-cocos-preview.md) §4。

界面截图：[`../assets/gate_runner/01-boot.png`](../assets/gate_runner/01-boot.png)、
[`02-midgame.png`](../assets/gate_runner/02-midgame.png)、
[`03-mask-fix.png`](../assets/gate_runner/03-mask-fix.png)、
[`04-result.png`](../assets/gate_runner/04-result.png)、
[`05-lobby-8-games.png`](../assets/gate_runner/05-lobby-8-games.png)。

---

## 9. 结算面板可读性修复（代码侧）

**症状**：结算面板出现后，半透明 `Dim` 让底下的亮色门块（`×2` / `−10`）透上来，正好压在「最高分 N」那一行上，文字和色块叠在一起。

**修法**（`GateGame.ts`，一行状态 + 一个方法）：

```ts
private _showResult(victory: boolean): void {
    ...
    this._showPanel(this.resultPanel);
    this._setWorldVisible(false);      // 结算时收起世界层与特效层（背景层保留）
}

/** 显隐世界层与特效层；只在这个方法和 startNewRun 里调用，不走 onDestroy */
private _setWorldVisible(visible: boolean): void {
    const field = this.fieldLayer;
    if (field && field.isValid) field.active = visible;
    const effects = this.effectLayer;
    if (effects && effects.isValid) effects.active = visible;
}
```

`startNewRun()` 里 `_setWorldVisible(true)` 把它放回来。

- **暂停面板不收起世界**：暂停时玩家需要看着棋盘思考，这是有意的差异。
- 门/敌人/飘字的 `Label` 都挂在 `Field` / `Effects` 下，因此一并隐藏，不用逐个处理。
- 验证：`_showResult(false)` 后 `fieldActive=false / effectActive=false / bgActive=true`，
  截图 [`04-result.png`](../assets/gate_runner/04-result.png) 中「最高分」一行不再被色块穿过；
  随后 `_onRestartClicked()` → `fieldActive=true`、`state=running`、人数回到 20。

---

## 8. 大厅改动（同批次）

大厅从 6 款增到 8 款后，第三行卡片被裁掉，做了两处 `Layout` 调整（`Lobby.scene`）：

| 节点 | 属性 | 旧 | 新 |
|------|------|----|----|
| `content` | `Layout.spacingY` | 200 | **140** |
| `allGamesSection/allGamesGrid` | `Layout.spacingY` | 60 | **40** |

实测：`allGamesSection` 世界范围 29…709（设计区 0…1280），三行卡片中心 y = 559 / 339 / 119，标签全部可见（`lobby-8-games.png`）。
