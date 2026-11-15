# 新增游戏契约（一页读完）

> **适用**：在这个仓库里加一款新游戏。
> **怎么用**：跑一条命令生成骨架，照着下面的清单改 —— 不要从别的游戏里挑一个 1,800 行的文件当起点。
>
> ```bash
> node tools/new-game.js --id gem_match --name 宝石消消乐 [--class GemMatch] [--dry-run]
> ```
>
> 它会从 [`assets/games/game_template/`](../../assets/games/game_template/) 复制一套骨架，并生成
> `tools/verify-<id>-core.js`；剩下必须人工做的步骤它会打印出来。不想用脚本就手动复制模板目录。

---

## 1. 三个文件，三种职责

| 文件 | 职责 | 硬约束 |
|---|---|---|
| `<X>Core.ts` | 全部规则：状态机、随机数、计分、存档序列化 | **零 `cc` 依赖**；不碰 `Date.now()` / `Math.random()` / `localStorage` |
| `<X>Game.ts` | Cocos 组件：建 UI、转发输入、把状态画出来 | 不写规则；handler 具名；`onDestroy()` 只解绑不清规则 |
| `<X>Hud.ts` | 常驻顶栏（可选，简单游戏可以合进 Game） | 显隐**只有一个出口**；只写文本，不改游戏状态 |

为什么这么切：规则层能在裸 Node 里跑，才有 [`verify-<id>-core.js`](../tech/verify-scripts.md) 这种回归自检；
UI 层随便改，自检不用跟着改。**20 款现有游戏都是这个形状，照抄不会错。**

模板里已经踩过的坑都写成了代码，直接读：

- 事件用命名方法 + `off()`（红线 5）—— `TemplateGame.onTapZone` / `onDestroy`
- 点我区域是「带 `UITransform` 的普通 Node」，不需要 `Button` 组件（红线 3）
- 重开走 `_cleanupGame()`，与 `onDestroy()` 分职（防崩溃守则 3）
- 结算遮罩自带「返回大厅」，返回键抬到遮罩之上（教训 H）
- 坏档一律回落新档，永不崩（`deserializeSave`）

---

## 2. 可机检的硬契约

这几条不是建议，是**检查脚本会拦的**：

1. **Core 纯度**：`verify-<id>-core.js` 会读 `Core.ts` 源码，命中 `from 'cc'` / `Date.now` / `Math.random` / `localStorage` 直接失败。
   （模板生成时已带这四条断言，别删。）
2. **必须有 `tools/verify-<id>-core.js` 且退出码 0** —— 新游戏没有纯逻辑自检 = 没交付。
3. **场景零绑定**：模板的 UI 全在代码里用 `GameUIKit` 建，`@property` **一个都不用绑**。
   要复用场景节点时再声明 `@property`，并按
   [`mcp-scene-authoring-pitfalls.md`](../tech/mcp-scene-authoring-pitfalls.md) §3.5 ④ 的方式绑（`propertyType:'component'` + 节点 UUID）。
4. **未知 id 不静默**：`GameConfig` 里没有的 id 要在 Game 层 `console.warn` 并回大厅，不要白屏。

---

## 3. 场景：三步，不碰 `.scene` 文件

`.scene` 只能通过编辑器 / MCP 修改（红线 2）。模板对场景的全部要求只有「Canvas + 相机 + 一个组件」：

1. 在编辑器里复制 `assets/game_placeholder/scenes/GamePlaceholder.scene` →
   `assets/games/game_<id>/scenes/<X>.scene`，改名为 `sceneName` 的名字；
2. 把 Canvas 上的 `GamePlaceholder` 组件换成 `<X>Game`（删掉旧的再加新的）；
3. `scene_save_scene` 落盘，跑 `validate_scene`。

> 不要用 `scene_save_scene_as` 另存新场景 —— 它会弹模态框，把整个场景面板堵死
> （[pitfalls §5.5](../tech/mcp-scene-authoring-pitfalls.md)）。

---

## 4. 注册四步（漏一步就"游戏在大厅里不存在"或"图标是问号"）

| # | 改哪 | 判据 |
|---|---|---|
| 1 | `assets/common/managers/GameConfig.ts` 的 `GAME_LIST` | `node tools/check-game-icons.js` 能走到这一款 |
| 2 | `assets/main/scripts/GameIconArt.ts` 的 `ACCENTS[id]` + `drawShape` 的 `case 'id':` | `node tools/check-game-icons.js` 退出码 0 |
| 3 | 场景名 == `GameConfig.sceneName` | 大厅点进去不白屏 |
| 4 | 构建场景清单 | `node tools/sync-build-scenes.js --check` 退出码 0 |

---

## 5. 交付门槛（缺一项就不算完成）

```bash
node tools/verify-<id>-core.js      # 纯逻辑自检，退出码 0
node tools/check-game-icons.js      # 新增游戏后必跑
node tools/sync-build-scenes.js --check
# 全项目类型检查（改完 .ts 必跑，路径见 AGENTS.md「开发者命令」）
node "$TSC" --noEmit
```

再补一项**人工**验证：在编辑器预览里从大厅点进新游戏，玩到结算、点「再来一局」、点「返回大厅」，
控制台无 `error`。只读代码不算验证（见 [`browser-verify-cocos-preview.md`](../tech/browser-verify-cocos-preview.md)）。

---

## 6. 明确不要做

| 不要 | 原因 |
|---|---|
| 抽 `BaseGame extends Component` 基类 / 搞运行时框架 | 25 款品类差异太大（接龙 1,873 行 vs 幸存者 474 行），基类会变成一堆 `override` 的枷锁；共享层停在**工具函数 + 纯逻辑契约** |
| 在 `verify-*.js` 里手抄 tsc 路径 | 用 [`tools/lib/core-compile.js`](../../tools/lib/core-compile.js) 的 `runTsc` / `requireTsc`（原先 20 份重复已合并） |
| 每个游戏复制一份 UI 小工具 | 先看 `UITheme` / `GameUIKit` / `SceneSkin` 有没有；没有再考虑加进共享层 |
| 直接改 `.scene` / `.prefab` JSON | 破坏编辑器元数据（红线 2） |

---

## 7. 相关文档

- 模板源码：[`assets/games/game_template/`](../../assets/games/game_template/)
- 场景 / 预制体坑：[`mcp-scene-authoring-pitfalls.md`](../tech/mcp-scene-authoring-pitfalls.md)
- 结算遮罩与退出：[`ui-overlay-exit-and-modal-patterns.md`](../tech/ui-overlay-exit-and-modal-patterns.md)
- 预览验证：[`browser-verify-cocos-preview.md`](../tech/browser-verify-cocos-preview.md)
- 自检脚本清单：[`verify-scripts.md`](../tech/verify-scripts.md)
- UI / 图标规范：[`2026-11-10-ui-art-style-guide.md`](./2026-11-10-ui-art-style-guide.md)
