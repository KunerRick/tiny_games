# 砖块远征 场景搭建记录（BrickBreaker.scene）

> 日期：2026-10-31
> 场景：`assets/games/game_brick/scenes/BrickBreaker.scene`（uuid `1ad57925-cccf-430b-9c93-16dc41ffdf15`）
> 组件：`assets/games/game_brick/scripts/BrickGame.ts`（27 个 `@property`，全部已绑定）
> 关联：[`../specs/2026-10-31-game-brick-breaker-design.md`](../specs/2026-10-31-game-brick-breaker-design.md) §5 节点契约

---

## 1. 画布与坐标约定

| 项 | 值 |
|----|----|
| 设计分辨率 | 720 × 1280（`fitWidth` + `fitHeight`，`SHOW_ALL`，上下留黑边） |
| Canvas | 720 × 1280，锚点 (0.5, 0.5)，位置 (360, 640) |
| PlayArea | 660 × 860，位置 (0, -70) —— 对应逻辑坐标 `PLAY_W` × `PLAY_H` |
| 逻辑坐标 → 节点坐标 | `x = -PLAY_W/2 + logicX`，`y = PLAY_H/2 - logicY`（原点左上、y 向下） |
| 触摸换算 | `InputArea` 的 `convertToNodeSpaceAR` 后 `+PLAY_W/2` / `PLAY_H/2-` |

`InputArea` 与 `PlayArea` 同尺寸同位置、覆盖整个可玩区，所有手势都挂在它上面；面板是它的**兄弟**节点，因此面板打开时不会穿透到游戏输入。

---

## 2. 资源：只用一张白图

全部纯色块（背景、砖块底、挡板、按钮、卡片、遮罩）都是同一个 Sprite + 颜色染色：

- `assets/games/game_brick/textures/white.png`（2×2 纯白）
- spriteFrame：`efc96c60-3057-471a-b553-5f4d794ccfec@f9941`

好处：不依赖任何图集 / 字体图标，微信端不会出现方框（红线 10）。砖块、球、挡板本体则全部由 `Graphics` 绘制，Sprite 只做底。

> 设置 `contentSize` 必须在 `spriteFrame` **之后**，否则会被贴图原始尺寸（2×2）覆盖（踩坑手册 §3.5 ③）。

---

## 3. 最终节点树

```
BrickBreaker (Scene)
└── Canvas                       UITransform 720×1280, Canvas, Widget, GamePlaceholder(disabled)
    ├── Camera
    ├── GameRoot                 UITransform, BrickGame
    │   ├── PlayArea  (0,-70)    660×860
    │   │   ├── Background        Graphics
    │   │   ├── BrickLayer        Graphics
    │   │   ├── EffectLayer       Graphics（球/挡板/激光/碎屑）
    │   │   └── InputArea         660×860（触摸区）
    │   ├── HudTop  (0,520)
    │   │   ├── ScoreTitle/ScoreLabel   x=-170（世界 x=190）
    │   │   ├── LevelLabel              x=0
    │   │   ├── LivesTitle/LivesLabel   x=+170（世界 x=530）
    │   │   ├── ComboLabel              x=0, y=+52
    │   │   └── GuideLabel              x=0, y=-62
    │   ├── PauseButton (280,560) 96×96
    │   ├── PausePanel            [active=false]
    │   │   ├── Dim               Sprite 720×1280, rgba(8,14,22,215)
    │   │   ├── Title
    │   │   └── ResumeButton / RestartButton / LobbyButton
    │   ├── UpgradePanel          [active=false]
    │   │   ├── Dim               rgba(8,14,22,215)
    │   │   ├── Title
    │   │   └── Card0/1/2  560×120（y = 780 / 630 / 480）+ 子节点 Text
    │   └── GameOverPanel         [active=false]
    │       ├── Dim               rgba(8,14,22,215)
    │       ├── Title / ScoreLabel / BestLabel / LevelLabel
    │       └── RestartButton / LobbyButton
    └── BackButton (Canvas 子节点, (-290,560), 96×96)  → BackButton 组件 → SceneManager.gotoLobby()
```

> `GamePlaceholder` 是复制模板场景时带过来的，**没有移除成功**（见 §5），最终处置是 `enabled=false`；它 `onLoad` 里有判空，禁用后完全无副作用。

---

## 4. 组件绑定（27 项，全部已核对非空）

| 分组 | 属性 | 绑定节点 / 组件 |
|------|------|----------------|
| 渲染层 | `backgroundLayer` / `brickLayer` / `effectLayer` | PlayArea 下三个 Graphics 节点 |
| 输入 | `inputArea` | PlayArea/InputArea |
| HUD | `scoreLabel` `livesLabel` `levelLabel` `comboLabel` `guideLabel` | HudTop 下同名 Label（`propertyType:'component'` + **节点 UUID**） |
| 暂停 | `pauseButton` `pausePanel` `pauseResumeButton` `pauseRestartButton` `pauseLobbyButton` | PauseButton / PausePanel 及其子按钮（`Node`） |
| 升级 | `upgradePanel` `upgradeCard0..2` `upgradeText0..2` | UpgradePanel 与 Card0..2 / 其 Text 子节点 |
| 结算 | `gameOverPanel` `gameOverScoreLabel` `gameOverBestLabel` `gameOverLevelLabel` `gameOverRestartButton` `gameOverLobbyButton` | GameOverPanel 及子节点 |

按钮一律是 `@property({ type: Node })` + `Node.EventType.TOUCH_END`（红线 3），面板按钮在 `_showPanel()` 里绑定、`_hidePanel()` 里解绑（防崩溃守则 6）。

---

## 5. MCP 搭建时踩到的坑（本次实测）

| 现象 | 处置 |
|------|------|
| `component_remove_component` 对脚本组件**始终失败**（传 cid、类名、完整 UUID 都不行） | 放弃移除，改 `component_set_component_property` 传 **cid** 设 `enabled=false` |
| `component_set_component_property` 传类名 `'BrickGame'` 报 `Component not found` | 必须用压缩 cid（如 `0d70fCtCatNTozrMumC1P6x`），可在 `component_get_available_components` 里查 |
| `component_attach_script` 报 “Script 'X' was not found on node after addition”，**实际已挂上** | 以 `component_get_components` / 可用组件列表为准，不要重复挂 |
| `node_duplicate_node` 不返回 uuid，副本名为 `X-001` | 先 `scene_get_scene_hierarchy` 找 uuid，再 `node_move_node` + `node_set_node_property` 改名 |
| `debug_validate_scene` 报 `Message does not exist: scene - check-missing-assets` | 改用 `assetAdvanced_validate_asset_references`（本次 959 资产 / 0 断链） |
| `debug_execute_script` 报 `Scenario scripts do not exist: console` | 用浏览器页内 `cc` 探针代替 |
| Label 绑定传 `componentType:'cc.Label'` 被拒或 uuid 为 null | `propertyType:'component'` + **节点** UUID，系统自动解析 Label 组件 |

---

## 6. 预览与浏览器实测

**预览默认只会打开编辑器当前场景**（本次是 Tetris）。想直接跑某场景，在地址后加 `?scene=<场景 uuid>`：

```
http://127.0.0.1:7456/?scene=1ad57925-cccf-430b-9c93-16dc41ffdf15
```

浏览器坐标换算（本次视口 390×844，`dpr=1`）：canvas `rect.left=-1.5, top=48, 393×796`，设计缩放 `k=0.54583`，
`screenX = left + designX*k`，`screenY = top + (1280 - designY)*k`。**每轮现场标定**，别套用别的视口。

实测结论（全部通过，0 条 console error）：

| 场景 | 结果 |
|------|------|
| 进入 | 大厅点「砖块远征」→ `BrickBreaker` 加载，HUD「第 1 关 / 生命 3」 |
| 拖拽 | 挡板跟随手指（330 → 193），松手（桌面 `TOUCH_CANCEL`）**不误发球** |
| 点击发球 | `state: ready → playing`，球速约 620 px/s |
| 计分/掉球 | 命中砖块 +10、combo=1；漏接 → 生命 −1 回到 ready |
| 暂停/继续 | 面板出现、球冻结；继续后恢复 |
| 过关升级 | 清空砖块 → 三选一（收束反弹 / 得分倍率 / 多一颗球）→ 选中后进入第 2 关、升级生效 |
| 结算 | 「本局结束 / 得分 10 / 最高 23 / 到达第 1 关」，最高分跨局持久化 |
| 重开 / 返回 | 再来一局复位为 0 分 3 命；左上「返回」与面板「返回大厅」都能回到大厅 |

界面截图：[`../assets/brick/01-ready.png`](../assets/brick/01-ready.png)、[`02-upgrade.png`](../assets/brick/02-upgrade.png)、[`03-pause.png`](../assets/brick/03-pause.png)、[`04-gameover.png`](../assets/brick/04-gameover.png)。

### 本次做的两处界面修正

1. **HUD 与返回键重叠**：`ScoreTitle/ScoreLabel` 原本 x=-220（世界 140），与 Canvas 的 `BackButton`（中心 x=70、宽 96）压在一起。改为 x=**-170**；`LivesTitle/LivesLabel` 同步由 150 调到 **170**，与暂停键留出间距。
2. **面板遮罩太透**：三个面板的 `Dim` 原为 `rgba(8,14,20,175)`，结算标题压在砖块上看不清。统一改为 `rgba(8,14,22,215)`。

---

## 7. 收尾清单

- [x] 场景保存、资产引用校验 0 断链
- [x] `GameConfig.ts` 注册（id `brick` / 场景 `BrickBreaker`）
- [x] `npx tsc --noEmit` 通过（Cocos 自带 5.8.2）
- [x] `node tools/verify-brick-core.js` 50/50
- [x] 浏览器全流程实测（上表）
- [ ] `node tools/sync-build-scenes.js`（**需先退出编辑器**）
- [ ] 编辑器内构建微信小游戏 → `node tools/check-wechat-build.js`
