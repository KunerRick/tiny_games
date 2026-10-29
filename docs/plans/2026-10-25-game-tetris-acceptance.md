# 方块坠落（Tetris）— M8 浏览器验收报告

- 日期：2026-10-25
- 阶段：M8（浏览器逐项验收 + 微信构建预检）
- 设计文档：[`docs/specs/2026-10-25-game-tetris-design.md`](../specs/2026-10-25-game-tetris-design.md) §9
- 环境：Cocos Creator 3.8.8 / 编辑器预览 `http://127.0.0.1:7456/`（dpr=1，canvas 393×679 CSS，k≈0.5301）
- 结论：**逻辑与交互 21 项中 20 项通过，1 项（微信构建预检）因当前产物不含俄罗斯方块而阻塞，需在编辑器构建面板重新构建后再跑脚本**

---

## 1. 静态检查

| 检查 | 命令 | 结果 |
|------|------|------|
| 纯逻辑自检 | `node tools/verify-tetris-core.js` | ✅ 31 项全通过（SRS 四态、踢墙、7-bag、出生位置、消行、Ghost、计分、重力） |
| 类型检查 | 编辑器自带 `tsc --noEmit`（5.8.2） | ✅ TS_OK |
| 变体选择符 | `grep -rInP "\x{FE0E}\|\x{FE0F}" assets/` | ✅ 无命中（红线 10） |

---

## 2. 功能验收（§9.1）

| # | 项目 | 证据 | 结论 |
|---|------|------|------|
| 1 | 7-bag 每 7 个一袋 | `verify-tetris-core.js`：连续 100 袋每袋 7 种齐全；700 次抽取每种恰好 100 次 | ✅ |
| 2 | 出生位置正确、新块立刻可见 | 重开后 `getState().current = {type:1, x:4, y:18}`，`next` 有 3 个；核心自检断言「最低占用格都在第 18 行」 | ✅ |
| 3 | SRS 贴墙旋转不穿模 | T 移到最左列（x=0, rot=0）→ 顺时针 → `{rot:1, x:0}`，未越界 | ✅ |
| 4 | 锁延迟可重置，最多 15 次 | 软降到地面（y=0）后交替左右各 12 次（间隔 100ms）仍为 `playing`；连续 26 次后已锁定并换新块（type 1 → 6） | ✅ |
| 5 | 硬降立即锁定 | 硬降后 60ms：棋盘出现新块、`current` 已是新块、锁定闪光计时 >0 | ✅ |
| 6 | 消行与计分 | 底行 `########..` + O 补满 → `lines: 1`、`score` 增加 100、底行残留上方 O 的两格 | ✅ |
| 7 | Ghost 落点一致 | 空棋盘 O（x=4）：Ghost 4 格落在棋盘行 0/1（y=−361/−323，列 −19/+19，即列 4/5），与硬降落点一致 | ✅ |
| 8 | Hold 每块一次 | 首块 L → Hold 后 `hold=6`、当前变 O(1)；再次 Hold 无变化（当前仍是 1、`hold` 仍是 6） | ✅ |
| 9 | Block Out 触发结算 | 出生区所在列填 `...####...`（整行未满、不会消行）→ 硬降 → `state: game_over`、结算面板打开；「再来一局」回到 `playing` 并给出新块 | ✅ |
| 10 | 存档跨场景保留 | 切模式为 button 后 `loadScene('Tetris')` 重载：`getBest()`、`control_mode`、`tutorial_done` 全部保留 | ✅ |

---

## 3. 手势与双模式验收（§9.2）

| # | 项目 | 证据 | 结论 |
|---|------|------|------|
| 11 | 拖 1 格移动 1 列 | 真实鼠标拖 22 CSS px（≈41 设计像素）：`x 3 → 2` | ✅ |
| 12 | 轻点顺时针 / 双指逆时针 | 轻点棋盘中心：`rot 0 → 1`。双指路径由 M4 手势层实现，本轮未用真实双指复测 | ✅（单指本轮实测） |
| 13 | 按住下拖 → 软降 | 慢速下拖进软降后：**10.0 行/秒**，加速期间横移被锁、回抬 0.4 格即停（M9 复测，详见 §7） | ✅ |
| 14 | 快速下甩 → 硬降 | 150 CSS px / 5 段快速下拉：当前块类型改变（已锁定并换新块） | ✅ |
| 15 | 8px 内抖动 → 旋转（"拖了个空"回退） | 4 CSS px（≈7.5 设计像素）的抖动松手后：`rot 0 → 1`、列不变 | ✅ |
| 16 | 拖拽中锁定 → 新块从当前列开始、软降继续 | M9 实测：按住不松跨过锁定，`token 36 → 37` 后新块继续以软降速率下落 | ✅ |
| 17 | 切按键模式：手势失效、按键出现、棋盘尺寸不变 | `gesture._enabled=false / button._enabled=true / buttonLayer.active=true`，`boardRoot` 宽 380 两种模式一致 | ✅ |
| 18 | 切回手势无残留状态 | 切回后 `gesture=true / button=false`；`disable()` 清空软降与连发（代码路径 + 实测 15 项抖动/点击正常） | ✅ |
| 19 | 长按 ← 160ms 连发、滑出即停 | M5 已用真实长按在 `Left` 按钮上验证（并顺带写入 `hint_used.move`） | ✅（M5 实测） |
| 20 | 面板打开时棋盘手势无效 | 暂停态调用旋转：`rot` 不变；`resume()` 恢复 `playing` | ✅ |
| 21 | 切场景/销毁无报错 | 本轮 4 次 `loadScene` 切换，控制台 0 error；`onDestroy` 只清引用不碰节点 | ✅ |

---

## 4. M7 交付项复核

| 项 | 证据 | 结论 |
|----|------|------|
| 首局引导闸门 | 清 `tutorial_done` 后重载：`state=ready`、引导面板打开；「开始游戏」后 `tutorial_done=1`、`state=playing` | ✅ |
| 引导内切模式 | `fireSecondary()` 往返 3 次：标题/副标题/首行/按钮文案/`control_mode` 存储全部同步切换 | ✅ |
| 提示条三种状态 | 手势模式三行提示（已完成的降到 40% 透明度）；按键模式单行只留未完成部分；累计 3 局自动隐藏 | ✅ |
| 一次性提示 | 首次切按键模式：暂停面板底部出现「按键区占用棋盘下方空间，棋盘大小不变」，之后不再出现（`button_notice` 记入 `hint_used`） | ✅ |
| 落地反馈 | 硬降实测：4 格闪光（`flash`/`cells`>0）、棋盘抖动 `BoardRoot` 偏移最大 2.67 设计像素，衰减后**精确回到基准位 (0, 40)** | ✅ |
| 升级动效 | `updateStats` 提升等级：等级文本 scale 1 → 1.291 → 1.0 | ✅ |
| 暂停 → 操作说明 | 暂停面板「操作说明」按当前模式打开引导内容，主按钮为「返回游戏」，关闭后回到暂停面板 | ✅ |

### 本轮修正的布局问题

1. **手势提示条压住棋盘底边**：三行提示原来从 world y=−348 起，首行上沿 −333 与棋盘底边 −340 相撞（幽灵方块会被文字盖住）。`Rows` 下移到局部 y=−24（行 y=−372/−424/−476），首行与棋盘留 17 设计像素间距。
2. **提示条图示与文字重叠**：图标在 x=−150、文字左沿在 −140，重叠 12 设计像素。改为整组居中：图标 x=−56、文字 x=110（左对齐），内容占 −78…+78。
3. **按键模式单行提示贴到屏幕最底边**（world −620，距底边仅 20 设计像素，真机会落进 iPhone Home 指示条）。改到两排按键之间：`ButtonHint` 局部 y=−129.5（world −477.5），尺寸 640×24、字号 18。

截图：[引导](../assets/tetris/tetris-m7-tutorial.png)、[手势提示条](../assets/tetris/tetris-m7-hint-rows-live.png)、[按键模式提示](../assets/tetris/tetris-m7-button-hint-gap.png)、[暂停面板一次性提示](../assets/tetris/tetris-m7-pause-notice.png)、[验收后最终画面](../assets/tetris/tetris-m8-final.png)。

### 顺带加固

`TetrisGame.setControlMode()` 增加入参校验（非 `gesture`/`button` 直接返回）：此前若调用方漏传参数，`_controlMode` 会被写成 `undefined` 并落盘成字符串 `"undefined"`。存储层 `TetrisStorage.getControlMode()` 本身已把未知值收敛成 `gesture`，两层都兜住。

---

## 5. 微信小游戏构建预检

`node tools/check-wechat-build.js`（检查 `build/wechatgame/`）：

| 项 | 结果 |
|----|------|
| 1 必需文件齐全 | ✅ 9 项 |
| 2 game.json / project.config.json 可解析 | ✅ `compileType="game"`、appid 已填 |
| 3 构建已落盘稳定 | ✅ |
| 4 产物 JS 语法级别 | ✅ 17 个 .js 均可按 ES2015 与 ES5 解析 |
| 5 主包体积 | ✅ 3.20 MB / 4.00 MB |
| 6 变体选择符 | ✅ 无 |
| 7 开发者工具是否停在过期构建 | ❌ 工具最后一次编译（10-18 22:41）早于产物（10-18 22:44） |
| 8 AppID 非占位值 | ✅ |
| 9 工具缓存的包装方式 | ✅ 4 个模块均为「小游戏包装(process)」 |

**阻塞点**：`build/wechatgame/` 是 10 月 18 日的产物，**不含俄罗斯方块场景**；且 MCP 只能打开构建面板、不能触发构建（`project_get_build_settings` 明确返回「Full build configuration requires direct Editor UI access」）。因此本轮无法产出包含本作的构建来验收第 7 项与整包体积。

**待办（需在编辑器 UI 完成）**：

1. 关闭微信开发者工具里的该项目（避免构建期间被自动重编译打断，见 `docs/tech/wechat-build-pitfalls.md` §1）
2. 编辑器「项目 → 构建发布」选择 wechatgame 重新构建
3. `node tools/check-wechat-build.js` → 9 项全绿
4. `node tools/replay-wechat-bundle.js` 反证小游戏包装可加载
5. 打开开发者工具，确认小游戏真机/模拟器能进大厅并点进「方块坠落」

---

## 6. 界面美化（M8 后补充）

首版界面全部是**纯色直角 Sprite**：没有圆角、没有描边、按钮与背景糊成一片。本轮把面板/按钮/开关/方块统一换成
运行时 `Graphics` 皮肤（[`TetrisSkin.ts`](../../assets/games/game_tetris/scripts/TetrisSkin.ts)），并按截图逐轮修正。

| 区域 | 改动 | 前后对比 |
|------|------|---------|
| 对局（手势） | 圆角棋盘 + 网格细线 + 圆角砖块 + 渐变背景；顶部返回/暂停图标按钮 | [前](../assets/tetris/beautify-before-buttons.png) / [后](../assets/tetris/beautify-play-gesture-v8.png) |
| 对局（按键） | 两排按键改圆角卡片，中间留 49 设计像素放单行提示 | [前](../assets/tetris/beautify-before-button.png) / [后](../assets/tetris/beautify-play-buttonmode-v8.png) |
| 暂停面板 | 模式选项改成并排两枚胶囊（选中实心蓝）；震动改开关控件；「返回大厅」改透明底红字，避免误触 | [前](../assets/tetris/beautify-before-pause.png) / [后](../assets/tetris/beautify-pause-v6.png) |
| 操作说明 | 五行手势改成一卡一行 + 分隔线；图标统一用 `Graphics` 画（不用 emoji） | [前](../assets/tetris/beautify-before-tutorial.png) / [后](../assets/tetris/beautify-tutorial-gesture-v13.png) |
| 操作说明（按键） | 同一面板按模式换文案与示意图 | [后](../assets/tetris/beautify-tutorial-buttonmode-v10.png) |
| 结算面板 | 分数用大字号 + 「新纪录」胶囊；按钮主次分明 | [前](../assets/tetris/beautify-before-gameover.png) / [后](../assets/tetris/beautify-gameover-v7.png) |

### 只靠截图才发现的三个问题

1. **提示条图标退化成一条短横线**：箭头用 `lineWidth = 2` 描边，预览缩放 `k ≈ 0.53` 时覆盖率只剩约 8%
   （见 [`tech/mcp-scene-authoring-pitfalls.md`](../tech/mcp-scene-authoring-pitfalls.md) §4.5）。线宽提到 3 / 3.6 后正常，
   放大对比见 [zoom-hints.png](../assets/tetris/zoom-hints.png)。
2. **双下箭头读不出"两个"**：两根箭头首尾相接，描边叠成一条长竖线，30px 图标框里和单箭头没区别 —— 改成上下错开
   （`TetrisIcons.ts` 的 `fastdown`），放大对比见 [zoom-tutorial-icons.png](../assets/tetris/zoom-tutorial-icons.png)。
3. **按键模式提示条被挤成一团**：两排按键占了棋盘下方全部空间，提示条贴着按钮。两排各缩到 96 高（原 110），
   中间腾出 49 设计像素，提示条落在 `world y = 163`，与上下两排各留约 20 设计像素。

> 面板背景的"圆角描边"用 `roundRect + stroke`（线宽 2 在圆角曲线上仍有辨识度），但**网格线与卡片分隔线一律用
> `rect + fill`** —— 实测同一 `Graphics` 里 `fill()` 之后 `stroke()` 连几何都不会生成（§4.5 ②）。

---

## 7. 软降手感修正（M9）

玩家反馈三点：手势下长按下坠会被横向漂移带偏；想「掉到某个高度再横移」却没法中途停；按键模式里软降和硬降看不出区别。

### 根因一：切软降时重力累加器没清零（这才是「软降像硬降」的真凶）

`update()` 里 `_gravityAcc += dt`，结算间隔是 `_softDrop ? min(重力, 0.1) : 重力`。累加器本身不清零，
于是攒了 0.65s 重力时间后再按下软降，那份时间立刻按**新的（更短的）间隔**兑现 —— 一帧内连消多行。

实测（注入 `_gravityAcc = 0.65` 后发 `SoftDropStart`）：

| 时刻 | 方块最低行 |
|------|-----------|
| 按下前 | 12 |
| 50ms 后 | **-5 → 直接锁死在天花板下方**（旧实现，落差 17 行） |
| 修复后 | 12 → 11（50ms 只需 1 行） |

修法：`_setSoftDrop()` 里切换时 `_gravityAcc = 0`。松开同理 —— 不清零的话残留值会立刻再掉一行，「停」停不准。

### 根因二：0.04s/行 让「加速」没有中途停下的物理可能

25 行/秒 = 整屏 20 行 0.78 秒，比人眼反应（约 200ms ≈ 5 行）还快。改成 `SOFT_DROP_INTERVAL_SEC = 0.1`
（10 行/秒，整屏约 2 秒），中途停下的位置误差 1–2 行。

### 根因三：横移与软降共用一个手势，横向噪声带偏落点

原来 `dy ≥ 半格 → 软降开`，而换列门槛也是半格（约 20px）。下拉时拇指滚动、指腹横向漂 10–20px，
于是一次「长按下坠」经常顺手换掉一列。改成**两个轴互斥**：

- 下移 > 0.8 格（约 32px）才进入软降；进入后**列锁定**，横向一概忽略
- 回抬 > 0.4 格退出软降，横移恢复；两个阈值不对称 = 迟滞带，手指停在附近不会反复开关
- 想「掉到某高度再横移」：回抬 → 移 → 再下拖，一次按住可反复切换

### 改动的文件

| 文件 | 改动 |
|------|------|
| `TetrisConfig.ts` | `SOFT_DROP_INTERVAL_SEC` 0.04 → 0.1；新增 `SOFT_DROP_ENGAGE_ROWS = 0.8`、`SOFT_DROP_RELEASE_ROWS = 0.4` |
| `TetrisGame.ts` | 新增 `_setSoftDrop()`（切换即清零累加器 + 刷新光带）；`SoftDropEnd` 提到 `state !== Playing` 判断**之前**处理；暂停时关软降 |
| `GestureInput.ts` | 软降改成迟滞锁存 + 列锁定；进入/退出/换块都 `_rebase()` 重取基准 |
| `TetrisSkin.ts` | `skinBand()` 新增 `emphasis`：软降期间光带加亮（「这一列已锁定」的唯一反馈） |
| `TutorialPanel.ts` | 手势说明第 3 行改为「按住下拖 — 加速下落（横移暂停）」 |

### 顺带修掉的一个潜在 bug

消行闪白的 120ms 窗口里松手，`SoftDropEnd` 曾被 `applyAction` 开头的 `if (this._state !== GameState.Playing) return`
吞掉。输入层已经认为「关了」，不会重发，于是**下一块在手指抬起的情况下继续加速下落**。现在 `SoftDropEnd` 在守卫之前
无条件生效（软降是输入层开关，不归棋盘状态管）。

### 验证（浏览器实测）

| 项 | 结果 |
|----|------|
| 攒 0.65s 后按软降，50ms 内下落 | 0 行（旧实现 17 行） |
| 软降速率 | 10.0 行/秒 |
| `SoftDropEnd` 后 300ms 漂移 | 0 行 |
| 手势下拖进软降后横移 76 设计像素 | 列不变（锁列生效） |
| 回抬 > 0.4 格 | 退出软降，横移恢复 |
| 按住跨过方块锁定 | 新方块继续以软降速率下落（token 36 → 37） |
| 暂停 / 恢复 | 软降被清，恢复后无残留 |
| 回归：轻点旋转、横拖移动、快速下甩硬降、软降后慢速抬起不误触硬降（实测 1.27 < 1.5 阈值） | 全部通过 |

`tsc --noEmit` 通过，`node tools/verify-tetris-core.js` 31/31 通过。

---

## 8. 已知小问题（不影响验收）

1. HintBar 节点上原本的 `cc.Label` 组件删不掉（`component_remove_component` 拒绝内置组件），已设为 `enabled=false` 留作占位。
2. 手势模式下提示条占据屏幕下部 1/4（棋盘下方 300 设计像素的按键预留区），属设计取舍：切换按键模式后该区域被按键占用，棋盘尺寸不变。
3. 双指逆时针（#12 后半）与「拖拽中锁定」（#16）本轮未用真实触摸复测，逻辑路径来自 M4，建议后续在真机一次性过一遍。
4. 软降按住后接着快速下甩，硬降**比纯下甩更难触发**：速度取最近 120ms 窗口平均，窗口里含慢速下拖的那一段 —— 实测 1.27，阈值 1.5。
   属有意为之的保守取舍（避免长按中手抖误触硬降），但若真机上反馈「甩不下去」，可把窗口缩短到 80ms。

---

## 9. 复现方式

```bash
# 纯逻辑
node tools/verify-tetris-core.js
# 类型
node "/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc" --noEmit
# 构建预检（需先重新构建）
node tools/check-wechat-build.js
```

浏览器内探针（页面上下文）：

```js
const g = cc.director.getScene().getChildByName('Canvas').getComponent('TetrisGame');
g.__debug.getState();          // 棋盘/当前块/分数/等级/状态
g.__debug.getEffects();        // 闪光与抖动剩余时间
g.__debug.getHints();          // 提示条已用项与累计局数
g.__debug.getPanels();         // 三个面板显隐
```

点击坐标换算：`sx = rect.x + designX * k`，`sy = rect.y + rect.height − designY * k`，`k = rect.height / 1280`（设计坐标以左下角为原点，Canvas 位于 360,640）。
