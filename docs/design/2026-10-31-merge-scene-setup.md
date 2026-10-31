# 合合大作战 场景搭建记录（Merge.scene）

> 状态：**搭建设计已定稿，MCP 执行被编辑器卡住**（见 §7）。
> 场景：`assets/games/game_merge/scenes/Merge.scene`（uuid `146604a1-4690-4265-9de0-edf5df0f7823`，当前是默认空场景）
> 组件：`assets/games/game_merge/scripts/MergeGame.ts`（19 个 `@property`：13 个 Node + 6 个 Label）
> 关联：[`../specs/2026-10-31-game-merge-design.md`](../specs/2026-10-31-game-merge-design.md) §4 节点结构

---

## 1. 画布与坐标约定

与砖块远征完全一致（模板复用）：

| 项 | 值 |
|----|----|
| 设计分辨率 | 720 × 1280（`fitWidth` + `fitHeight`，`SHOW_ALL`，上下留黑边） |
| Canvas | 720 × 1280，锚点 (0.5, 0.5)，位置 (360, 640)，`cc.Widget` 四边对齐 |
| PlayArea | 660 × 860，位置 (0, -70) —— 对应逻辑坐标 `PLAY_W` × `PLAY_H` |
| 逻辑坐标 → 节点坐标 | `x = -PLAY_W/2 + logicX`，`y = PLAY_H/2 - logicY`（原点左上、y 向下） |
| 触摸换算 | `InputArea.convertToNodeSpaceAR` 后再 `+PLAY_W/2` / `PLAY_H/2 -` |

`InputArea` 与 `PlayArea` 同尺寸同位置、盖满可玩区；暂停/结算面板是它的**兄弟**节点，面板打开时不会穿透到游戏输入（`_acceptsPlayInput()` 另有一层 `paused` / `gameOverShown` 判定）。

坐标换算在 `MergeGame._toLogic()`：

```ts
const local = this._inputTransform.convertToNodeSpaceAR(new Vec3(uiX, uiY, 0));
return { x: local.x + PLAY_W / 2, y: PLAY_H / 2 - local.y };
```

---

## 2. 目标节点树

```
Merge (Scene)
└── Canvas                          UITransform 720×1280, cc.Canvas, cc.Widget(全屏)
    ├── Camera
    ├── GameRoot                    UITransform, MergeGame
    │   ├── PlayArea (0,-70)        660×860
    │   │   ├── Background          Graphics（背景网格 + 三面墙 + 警戒线虚线，静态只画一次）
    │   │   ├── FruitLayer          Graphics（每帧重绘水果）
    │   │   ├── EffectLayer         Graphics（待落水果 / 引导线 / 碎屑 / 合并圆环 / 抖动）
    │   │   └── InputArea           660×860，UITransform（触摸区）
    │   ├── HudTop (0,520)          660×220
    │   │   ├── ScoreTitle  (-190,42)   「得分」
    │   │   ├── ScoreLabel  (-190,6)    0
    │   │   ├── BestTitle   (+190,42)   「最高」
    │   │   ├── BestLabel   (+190,6)    最高 0
    │   │   ├── NextTitle   (0,42)      「下一个」
    │   │   ├── NextPreview (0,-4)      Graphics，本地原点居中，半径 ≤ 30
    │   │   ├── ComboLabel  (0,86)      连击 N ×2.0（连击 < 2 时清空）
    │   │   └── GuideLabel  (0,-58)     拖动选位置 · 松手投放
    │   ├── PauseButton (280,560)   96×96
    │   ├── PausePanel              [active=false]
    │   │   ├── Dim                 Sprite 720×1280，rgba(8,14,22,215)
    │   │   ├── Title               暂停
    │   │   ├── ResumeButton        继续
    │   │   ├── RestartButton       重新开始
    │   │   └── LobbyButton         返回大厅
    │   └── GameOverPanel           [active=false]
    │       ├── Dim                 同上
    │       ├── Title               游戏结束
    │       ├── ScoreTitle / GameOverScoreLabel
    │       ├── BestTitle  / GameOverBestLabel
    │       ├── RestartButton       再来一局
    │       └── LobbyButton         返回大厅
    └── BackButton                  公共组件（返回大厅）
```

> 面板的 `Dim` 使用「砖块远征同款白图 Sprite 染色」（`assets/games/game_brick/textures/white.png`，
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
| 17 | `gameOverBestLabel` | Label | GameOverPanel/GameOverBestLabel |
| 18 | `gameOverRestartButton` | Node | GameOverPanel/RestartButton |
| 19 | `gameOverLobbyButton` | Node | GameOverPanel/LobbyButton |

绑定纪律（沿用踩坑手册）：
- Node 类型属性绑**节点 UUID**；Label 类型属性用 `propertyType: 'component'` + **节点 UUID**（写 `'cc.Label'` 会被拒）。
- 面板按钮 `@property({ type: Node })` + `Node.EventType.TOUCH_END`，**不挂 cc.Button**（红线 3）。

---

## 4. MCP 执行顺序（可直接照跑）

1. `begin_undo_recording`
2. 逐级 `node_create_node`：Canvas（若默认场景已有则复用）→ GameRoot → PlayArea → 三层 Graphics + InputArea
3. `component_add_component`：Graphics × 3、UITransform（InputArea 660×860）
4. HudTop 与 6 个 Label（`fontSize` 28–40，`color` 按层级区分标题/数值）
5. NextPreview（Graphics）
6. PauseButton、PausePanel + Dim(Sprite) + 3 按钮，`active=false`
7. GameOverPanel + Dim + 2 Label + 2 按钮，`active=false`
8. `component_attach_script` GameRoot ← `MergeGame.ts`
9. `component_set_component_property` 逐项绑 19 个引用
10. `end_undo_recording` → `validate_scene` → `scene_save_scene`
11. 读回核对：`component_get_component_info` 确认 19 项非 null

---

## 5. 搭建完成后必须读回核对的项（踩坑手册 §3、§3.5）

- `InputArea` 的 `contentSize` 是 660×860（不是 2×2）：设 `contentSize` 必须在 `spriteFrame` 之后
- `Dim` 的 `anchorPoint.x` 是否真的写成 0.5（MCP 写 `x=0` 会被吞）
- 面板节点 `active` 初始为 false
- `PauseButton` 有 `UITransform` 96×96 且 `active=true`

---

## 6. 浏览器实测清单（§5 完成后执行）

| 步骤 | 断言 |
|------|------|
| 大厅点「合合大作战」 | 进入 Merge 场景，HUD 显示「得分 0 / 最高 N / 下一个 ●」 |
| 在可玩区按住拖动 | 待落水果跟随，且被夹在左右墙内 |
| 松手 | 水果下落、`state=playing`；0.35 s 内再松手不投放（半透明） |
| 两颗同级相撞 | 数量 −1、层级 +1、碎屑 + 圆环、得分增加 |
| 连击 | 0.5 s 内二次合并出现「连击 2 ×1.5」 |
| 暂停 → 继续 | 面板出现/消失，水果停止/继续下落 |
| 堆过警戒线 2 s | 结算面板出现，分数与最高分正确 |
| 再来一局 / 返回大厅 | 场景重置 / 回大厅 |
| console | 0 error |

---

## 7. 当前阻塞（2026-10-31 19:32 起）

- 触发点：`scene_save_scene_as`（想复制 BrickBreaker 当骨架）超时两次之后，编辑器主窗口消失
- 症状：`CocosCreator` 进程仍在（pid 38825）但 `System Events` 报 **0 个窗口**、`visible=false`；
  所有走场景面板的 MCP 调用（`scene_get_current_scene` / `node_*` / `scene_open_scene` / `soft_reload_scene`）全部超时，
  而走资产库的调用（`scene_get_scene_list` / `scene_create_scene` / `project_*`）正常
- 日志：`temp/logs/project.log` 最后一行停在 19:32:49，之后再无输出
- 结论：**场景编辑面板已随窗口一起消失**，必须重启 Cocos Creator 才能继续搭建
- 备注：`Merge.scene` 已由 `scene_create_scene` 落盘（2718 字节的默认空场景），没有丢东西
