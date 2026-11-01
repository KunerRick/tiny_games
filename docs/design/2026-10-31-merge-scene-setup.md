# 合合大作战 场景搭建记录（Merge.scene）

> 状态：**已搭建、已验收**（2026-11-01）。19/19 绑定全通，浏览器实测走完「投放→合并→连击→暂停→失败→重开→返回大厅」，0 console error。
> 场景：`assets/games/game_merge/scenes/Merge.scene`（uuid `146604a1-4690-4265-9de0-edf5df0f7823`，93,636 B）
> 组件：`assets/games/game_merge/scripts/MergeGame.ts`（19 个 `@property`：13 个 Node + 6 个 Label，cid `6c836aT53JMArqBdWvvAFQA`）
> 关联：[`../specs/2026-10-31-game-merge-design.md`](../specs/2026-10-31-game-merge-design.md) §4 节点结构

---

## 1. 画布与坐标约定

与砖块远征完全一致（模板复用）：

| 项 | 值 |
|----|----|
| 设计分辨率 | 720 × 1280（`fitWidth` + `fitHeight`，`SHOW_ALL`，上下留黑边） |
| Canvas | 720 × 1280，锚点 (0.5, 0.5)，位置 (360, 640)，`cc.Widget` 四边对齐（alignFlags 45, alignMode 2） |
| Camera | 子节点 (0, 0, 1000)，正交 `orthoHeight 640`，layer `1073741824`，clearFlags 7 |
| PlayArea | 660 × 860，位置 (0, -70) —— 对应逻辑坐标 `PLAY_W` × `PLAY_H` |
| 逻辑坐标 → 节点坐标 | `x = -PLAY_W/2 + logicX`，`y = PLAY_H/2 - logicY`（原点左上、y 向下） |
| 触摸换算 | `InputArea.convertToNodeSpaceAR` 后再 `+PLAY_W/2` / `PLAY_H/2 -` |
| UI layer | `UI_2D = 33554432` |

`InputArea` 与 `PlayArea` 同尺寸同位置、盖满可玩区；暂停/结算面板是它的**兄弟**节点，面板打开时不会穿透到游戏输入（`_acceptsPlayInput()` 另有一层 `paused` / `gameOverShown` 判定）。

坐标换算在 `MergeGame._toLogic()`：

```ts
const local = this._inputTransform.convertToNodeSpaceAR(new Vec3(uiX, uiY, 0));
return { x: local.x + PLAY_W / 2, y: PLAY_H / 2 - local.y };
```

---

## 2. 节点树（**实建结果**，坐标取自运行时读回）

```
Merge (Scene)
└── Canvas                              720×1280, cc.Canvas, cc.Widget(全屏)      [66ysuCXcJOn6oGHwtcjQWA]
    ├── Camera                          (0,0,1000) 正交                       [43wbNFgsZOpJ5A488HpNv+]
    ├── GameRoot                        UITransform, MergeGame                 [288DnlJm9FWbfXwGQIFjo2]
    │   ├── PlayArea (0,-70)            660×860                                [5cVo5G6YJFUKNBzg715D0J]
    │   │   ├── Background (0,0)        660×860  Graphics（背景网格 + 三面墙 + 警戒线虚线，静态只画一次）  [befmGebZ9LSaZnfwEUbki0]
    │   │   ├── FruitLayer (0,0)        660×860  Graphics（每帧重绘水果）       [e3DsGPBHdEfKjtHcGJAzVS]
    │   │   ├── EffectLayer (0,0)       660×860  Graphics（待落水果 / 引导线 / 碎屑 / 合并圆环 / 抖动）  [34lRwco7hLJJVz40+ktjWT]
    │   │   └── InputArea (0,0)         660×860  UITransform（触摸区，无渲染组件）  [b7R3b7YPJHoq7ts45vWCgd]
    │   ├── HudTop (0,520)              660×220                                [c3c5CqkHpCWJqrfRDX6lk5]
    │   │   ├── ScoreTitle  (-170, 70)  26pt「得分」                            [6bjzop+45AlLwfXV8JOw24]
    │   │   ├── ScoreLabel  (-170, 28)  46pt 数值                              [d6EN0VubROuaTnccczE2tx]
    │   │   ├── NextTitle   (0, 70)     26pt「下一个」                           [90H+0jdNlKuouF7NcC8wfO]
    │   │   ├── NextPreview (0, 18)     80×80   Graphics，本地原点居中，半径 ≤ 30  [74Crm4kstOhZwHGxY7qLhy]
    │   │   ├── BestTitle   (+170, 70)  26pt「最高」                            [92LGvX6xRPIq5c5D0Za/CR]
    │   │   ├── BestLabel   (+170, 28)  40pt 数值                              [fcVAEkFu1IlY5bivLFX71G]
    │   │   ├── ComboLabel  (0, -35)    34pt 连击 N ×2.0（连击 < 2 时清空）      [55jMyCnSpL5ovC8Batq2if]
    │   │   └── GuideLabel  (0, -85)    24pt「叠加同种水果合成更大的」             [46jFDg6URJsaBXFYyCLxcV]
    │   ├── BackButton (-300, 575)      96×96                               [7euR7AjvhG64qvyqFfuvRh]
    │   │   └── Label                   26pt「返回」
    │   ├── PauseButton (300, 575)      96×96                               [69r8TbFfxN1LqPWGcYBaxL]
    │   │   └── Label                   28pt「暂停」                            [c9vDngpm1O2KP40rts4L/G]
    │   ├── PausePanel (0,0)  [active=false]                               [84WMHR3uZHy47nmJWhRdC1]
    │   │   ├── Dim (0,0)               720×1280  Sprite 白图染色 rgba(8,14,22,215)  [ad/MW50DxN7obqamlaZs8m]
    │   │   ├── Title (0, 220)          48pt「暂停」                            [c0R488GkZK1a0bPEPrg7d4]
    │   │   ├── ResumeButton  (0, 80)   320×96「继续」                          [cd+kRMZCJNka9tXcZQKXVd]
    │   │   ├── RestartButton (0, -40)  320×96「重新开始」                        [ffQgW29kVJdIopXJmO/UDl]
    │   │   └── LobbyButton   (0,-160)  320×96「返回大厅」                        [55jsstXTBF8JpJNUc4bX5c]
    │   └── GameOverPanel (0,0)  [active=false]                            [87fnTgyVdCg7q6Ww5nZYCh]
    │       ├── Dim (0,0)               720×1280                             [19hTpU1ftMiIEJoNQasESG]
    │       ├── Title (0, 270)          48pt「游戏结束」                         [2euxVigVVH5IOWjvBfFy/w]
    │       ├── ScoreTitle (0, 185)     30pt「得分」                            [828xOSv3NHXrucbQFrVbCP]
    │       ├── GameOverScoreLabel (0, 96)   62pt 数值                        [1eNTeg0qVJKqT2wEOkAOlk]
    │       ├── BestTitle (0, 48)       30pt「最高」                            [a1oC5URF5JaqobGwHG9d3m]
    │       ├── GameOverBestLabel (0,-40)    46pt 数值                        [92bP6xfY1MYL6DsnXP6SIm]
    │       ├── RestartButton (0,-160)  320×96「再来一局」                        [42Q14bZLpMf4wzPP65RMP/]
    │       └── LobbyButton   (0,-280)  320×96「返回大厅」                        [4b5kmUIKtFbqgJioAyace7]
    └── （无其它子节点）
```

> 与最初设计（§2 旧稿）的三处差异，都记在踩坑里当参考：
> 1. `BackButton` 挂在 **GameRoot** 下（与 `PauseButton` 左右对称，`-300/+300`），不是 Canvas 根级 —— 它走 `Node.EventType.TOUCH_END`，不依赖公共 `BackButton` 组件；
> 2. `HudTop` 子节点最终是三列对齐（得分 / 下一个 / 最高，标题 y=70、数值 y=28），比旧稿的 (-190,+190) 更居中；
> 3. `ComboLabel` 落在 `(0,-35)`（数值区下方），`GuideLabel` 在 `(0,-85)` —— 连击出现时不会顶掉标题行。
>
> `Dim` 使用「砖块远征同款白图 Sprite 染色」（`assets/games/game_brick/textures/white.png`，
> spriteFrame `efc96c60-3057-471a-b553-5f4d794ccfec@f9941`），不新增贴图资源。

---

## 3. 19 项 `@property` 绑定

| # | 属性 | 类型 | 绑定节点 |
|---|------|------|---------|
| 1 | `backgroundLayer` | Node | PlayArea/Background |
| 2 | `fruitLayer` | Node | PlayArea/FruitLayer |
| 3 | `effectLayer` | Node | PlayArea/EffectLayer |
| 4 | `inputArea` | Node | PlayArea/InputArea |
| 5 | `nextPreview` | Node | HudTop/NextPreview |
| 6 | `scoreLabel` | Label | HudTop/ScoreLabel |
| 7 | `bestLabel` | Label | HudTop/BestLabel |
| 8 | `comboLabel` | Label | HudTop/ComboLabel |
| 9 | `guideLabel` | Label | HudTop/GuideLabel |
| 10 | `pauseButton` | Node | PauseButton |
| 11 | `pausePanel` | Node | PausePanel |
| 12 | `pauseResumeButton` | Node | PausePanel/ResumeButton |
| 13 | `pauseRestartButton` | Node | PausePanel/RestartButton |
| 14 | `pauseLobbyButton` | Node | PausePanel/LobbyButton |
| 15 | `gameOverPanel` | Node | GameOverPanel |
| 16 | `gameOverScoreLabel` | Label | GameOverPanel/GameOverScoreLabel |
| 17 | `gameOverBestLabel` | Label | GameOverPanel/BestLabel |
| 18 | `gameOverRestartButton` | Node | GameOverPanel/RestartButton |
| 19 | `gameOverLobbyButton` | Node | GameOverPanel/LobbyButton |

绑定纪律（沿用踩坑手册）：
- Node 类型属性绑**节点 UUID**；Label 类型属性用 `propertyType: 'component'` + **节点 UUID**（写 `'cc.Label'` 会被拒）。
- 面板按钮 `@property({ type: Node })` + `Node.EventType.TOUCH_END`，**不挂 cc.Button**（红线 3）。

---

## 4. MCP 执行顺序（本次实跑的顺序，可直接复用）

1. `begin_undo_recording`
2. 逐级 `node_create_node`：Canvas（`scene_create_scene` 建出的空场景没有 Canvas/Camera，需自建）→ Camera → GameRoot → PlayArea → 三层 Graphics + InputArea
3. `component_add_component`：`cc.Graphics` × 3、`cc.UITransform`（InputArea 660×860）
4. HudTop + 8 个子节点（6 个 Label + NextPreview(Graphics)），`fontSize` 24–46，标题/数值分色
5. BackButton / PauseButton（各 96×96 + 子 Label）
6. PausePanel + Dim(Sprite) + Title + 3 按钮，**建完立刻 `active=false`**
7. GameOverPanel + Dim + Title + 4 个 Label + 2 按钮，同样 `active=false`
8. `component_attach_script` GameRoot ← `MergeGame.ts`（返回“was not found”是假失败，见踩坑手册 §3.5 ⑨）
9. `component_set_component_property` 逐项绑 19 个引用
10. `end_undo_recording` → `assetAdvanced_validate_asset_references` → `scene_save_scene`
11. 读回核对：`component_get_component_info` 确认 19 项非 null

---

## 5. 搭建完成后必须读回核对的项（踩坑手册 §3、§3.5）

| 项 | 结果 |
|----|------|
| `InputArea` 的 `contentSize` 是 660×860（不是 2×2） | ✅ 660×860 |
| `PlayArea` / `Background` 尺寸没被贴图覆盖 | ✅ 660×860 |
| `Dim` 的 `anchorPoint` 是 (0.5, 0.5) | ✅（MCP 写 `x=0` 会被吞，本场景全部居中锚点，未触发） |
| 面板节点 `active` 初始为 false | ✅ 两个面板都是 false |
| `PauseButton` / `BackButton` 有 `UITransform` 96×96 且 `active=true` | ✅ |
| 19 项 `@property` 运行时非 null | ✅ `missing: []`（直接 `?scene=` 与大厅入口各验一次） |

---

## 6. 浏览器实测清单（2026-11-01 全部通过）

| 步骤 | 断言 | 结果 |
|------|------|------|
| 大厅点「合合大作战」 | 进入 Merge 场景，HUD 正常 | ✅ |
| 在可玩区按住拖动 | 待落水果跟随，且被夹在左右墙内 | ✅ |
| 松手 | 水果下落、`state=playing`；冷却内松手不投放 | ✅ |
| 两颗同级相撞 | 数量 −1、层级 +1、碎屑 + 圆环、得分增加 | ✅ 175 → 22745 |
| 连击 | 0.5 s 内二次合并出现「连击 2  ×1.5」 | ✅（26 次 150 ms 连投后按 100 ms 采样才抓到，合并本身要 ~1 s 才稳定） |
| 暂停 → 继续 | 面板出现/消失，水果停止/继续下落 | ✅ `_frame` 冻结在 6199 |
| 堆过警戒线 2 s | 结算面板出现，分数与最高分正确 | ✅ `得分 0 / 最高 22745` |
| 再来一局 / 返回大厅 | 场景重置 / 回大厅 | ✅ 重开后 `state=ready`，最高分保留 |
| 刷新页面 | 最高分持久化 | ✅ 22745 |
| console | 0 error | ✅ |

> 找「结算」的实用套路：乱投 47 次会把堆不断合并掉（minY 一直停在 324~502），**固定同一 x 连投 62 次**才把柱子顶破警戒线。

---

## 7. 编辑器侧阻塞的真因与恢复（2026-10-31 19:32 → 11-01）

这一节记录一次**耗时一整天**的排查，结论与最初判断相反，务必照此执行。

**症状**：所有走场景面板的 MCP 调用永久超时（`scene_get_current_scene` / `node_*` / `scene_open_scene` / `sceneView_*`），
而走主进程的调用（`scene_get_scene_list`、`scene_create_scene`、`project_*`）完全正常，
`sceneAdvanced_query_scene_ready` 还报 `ready: true`，编辑器窗口也在、没有弹窗。

**真因（第三次复现后确认）**：编辑器**长时间闲置后丢掉了当前场景** —— 窗口标题变成 `Untitled - …`，
场景面板不再处理 `query-hierarchy`（对应 `debug_get_node_tree` 报
`Message does not exist: scene - query-hierarchy`）。资产库与 MCP 服务跑在主进程，所以照常应答，
于是看起来像“只有场景模块死了”。

**恢复（纯命令行，不需要人工点编辑器，也不受锁屏影响）**：

```bash
osascript -e 'tell application "CocosCreator" to quit'
sleep 5
open -a "/Applications/Cocos/Creator/3.8.8/CocosCreator.app" --args --project "/Users/kuner/work/code/github/tiny_games"
# 等 40~60 s（首次索引更长），再用 scene_get_current_scene 探活；随后 scene_open_scene 打开目标场景
```

- `kill -TERM` 在沙箱里会被拒；`osascript quit` 走 Apple Events，能正常退出（会弹“保存场景？”时它自动选了不保存 —— 所以**每次结构变更后立刻 `scene_save_scene`**）。
- `caffeinate -di -t 7200 &` 只能**预防**：它让机器不睡，但**不能**解决“场景已丢”的状态；一旦丢场景就必须重启编辑器。
  **必须带 `-t` 并在收尾 `pkill -f "caffeinate -di"`** —— 不带超时的孤儿进程会永久阻止显示器休眠（2026-11-01 实例，详见技术手册 §5.5）。
- 早期误判是「锁屏导致渲染进程被节流」。锁屏确实会叠加干扰（`open -a` / `set frontmost` / 键盘事件都进不去），
  但它不是本故障的成因 —— 复现时机器并未锁屏，重启编辑器后同一条 MCP 调用立即恢复。

**两个次要发现（顺手记下，别当主因）**

| 现象 | 结论 |
|------|------|
| `scene_save_scene_as` 超时且之后场景模块失效 | 它会弹保存对话框（模态框一挂，场景面板的请求就全堵住）。要新场景用 `scene_create_scene`，别用 save-as |
| 跨场景 `copy_node` → 切场景 → `paste_node` | 粘贴**只得到空节点**（`New Node`，无子节点、无组件）。跨场景复用这条路径不通，按文档重建 |

**顺带**：`scene_create_scene` 建出来的场景是**完全空的**（连 Canvas / Camera 都没有），
从零搭必须自己建 `Canvas`（UITransform 720×1280 + cc.Canvas + cc.Widget alignFlags=45）和 `Camera` 子节点。

完整分诊流程见 [`../tech/mcp-scene-authoring-pitfalls.md`](../tech/mcp-scene-authoring-pitfalls.md) §5.5。

---

## 8. 浏览器取坐标的正确姿势（本轮踩错一次）

`camera.worldToScreen()` 返回的是**左下角为原点**的屏幕像素，比世界坐标 y 向上，但屏幕 y 向下 ——
直接 `y_css = rect.y + sp.y * k` 会**上下翻转**，点击静默点偏。

```js
const sp = camera.worldToScreen(node.worldPosition);   // 左下原点
const rect = canvasEl.getBoundingClientRect();
const x_css = rect.x + sp.x * (rect.width / canvas.width);
const y_css = rect.y + rect.height - sp.y * (rect.height / canvas.height);
```

本轮实测：暂停按钮按旧公式落到 y=685（实际在 y=76），点击落空；修正后一次命中。
有了正确的翻转 + 每轮标定好的 `k`，**每个节点都能精确换算**，不必再靠“试几个坐标看看”的试凑法。

> 已写进 [`../tech/browser-verify-cocos-preview.md`](../tech/browser-verify-cocos-preview.md) §4。
