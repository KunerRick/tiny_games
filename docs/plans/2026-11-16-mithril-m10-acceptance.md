# 《秘银远征》M10 验收记录（音效 / 震动 / 微信预检）

> 日期：2026-11-16 · 分支：`develop` · 范围：M10（事件音效映射 / 震动分级 / 路线图音效开关 / 微信构建产物预检）
> 计划：`docs/plans/2026-11-16-mithril-m10-plan.md`
> 设计规格：`docs/plans/2026-11-14-game-mithril-design.md` §9（`MithrilAudio.ts`）/ §11（里程碑表）
> 前置：M9 已验收（`2026-11-16-mithril-m9-acceptance.md`，`15e6ead`）
> 试玩：`2026-11-16-playtest-round19-mithril-m10.md`（第 19 轮）

## 1. 退出判据与实测

| 判据 | 要求 | 实测 | 结论 |
|---|---|---|---|
| 1. 战斗与主要节点都有声音 | 命中 / 击杀 / 受伤 / 爆炸 / BOSS 阶段 / 通关 / 阵亡 / 升级 / 宝箱 / 悬赏领取 | `verify-mithril-audio.js` §1 逐条断言纯映射表：11 条发声（`damage(enemy)→hit`、`damage(player)→playerHit`、`kill`、`heal→pickup`、`boom`/`blast`、`lightning→secret`、`phase→core`、`enrage→active`、`stage(boss)→active`、`stage(cleared)→clear`）+ 10 类刻意静默；场景层直呼 5 处（升级 `core`、结算 `won/dead`、节点点击 `click`、宝箱 `coin`、悬赏领取 `coin`）、野外事件 `pickup/playerHit`。第 19 轮实机：关音效下 BOSS 战 44 s 内事件密集触发无异常。**说明**：桌面浏览器听不到 wx 震动、自动化也无法“听”，听觉验收以「事件映射逐条断言 + `available === true` + 实机无异常」替代 | ✅ |
| 2. 震动分级且可关 | 受伤 medium、通关 heavy、阵亡 long | 脚本断言 `GameAudio.SPECS`：`playerHit`/`boom` 带 `vib:'medium'`、`won` 带 `vib:'heavy'`、`dead` 带 `vibLong:true`；运行时 `navigator.vibrate` 不存在时整段 try/catch 静默（`GameAudio` 既有实现）；开关关闭时 `vibrate()` 直接返回 | ✅ |
| 3. 全站开关 + 持久 | 路线图顶栏「音效 开/关」同时控音效与震动，跨会话持久 | 浏览器探针：点 `SfxToggle` → 文案「音效 关」、`sfxOn/vibOn=false`、`tiny_games_mithril_audio={"sfx":false,"vib":false}`、`available` 变 true；`reload` 后仍「音效 关」、偏好保留；再点回「音效 开」并落 `{"sfx":true,"vib":true}`。第 19 轮独立复测同样通过（含 1024×768 视口点中） | ✅ |
| 4. 零音频资源 + 微信 WebAudio | 不引入任何音频文件；微信走 `wx.createWebAudioContext()` | 脚本断言 `assets/` 下 `.mp3/.wav/.ogg/.m4a/.aac/.flac` 计数 = 0；`GameAudio.createAudioContext()` 中 `wx.createWebAudioContext` 分支位于标准 `AudioContext` 之前 | ✅ |
| 5. 静默降级 | 关闭开关 / 无 AudioContext 时不崩、不报错、玩法不变 | 第 19 轮：保持「音效 关」真实进入 BOSS 战、点技能操作约 44 s 后返回，console 新增 error = **0**；所有合成调用都在 `try/catch` 内 | ✅ |
| 6. 微信预检 | `check-wechat-build.js` 9 项全绿 + `replay-wechat-bundle.js` 通过 + 模拟器实机启动 | CLI 构建 28 s 成功，`build/wechatgame/assets/main/config.json` 含 **26 个场景**（含 `Mithril.scene`）；`replay-wechat-bundle.js` = ✅ 加载完成无异常；开发者工具打开项目后自动编译，`check-wechat-build.js` = **9/9 全绿、0 条提醒**（4 个模块均为小游戏包装）；模拟器实机：大厅正常渲染、`LoadScene Lobby` 成功、控制台无红色报错（截图 `.playwright-mcp/m10-devtools-sim.png`） | ✅ |
| 7. 回归 + 编译 | 7 个既有 verify 全绿 + `tsc --noEmit` | `tsc --noEmit` = TS_OK（编辑器自带 5.8.2）；core 221 / audio **88** / wild 2,829 / camp 337 / dungeons 892 / trinkets 692 / bounty 471 / balance 136 + 模板 15 项，全部退出码 0 | ✅ |
| 8. 独立试玩（第 19 轮）P0/P1 清零 | 开关默认/关闭/持久、关声可玩、无遮挡 | 报告 `2026-11-16-playtest-round19-mithril-m10.md`：**P0 = 0 · P1 = 0 · P2 = 0 · P3 = 0**，编号 N60 及以后未占用；6 个必测点全过，console 0 error | ✅ |

## 2. 交付内容

### 2.1 事件 → 音效映射（`MithrilAudioMap.ts`，新）

零 import 的纯模块，单独编译供 Node 断言（`MithrilAudio.ts` 依赖 `cc`，无法在 Node 里加载）：

| 事件 | 音效 | 振动 |
|---|---|---|
| `damage(target:'enemy')` | `hit` | — |
| `damage(target:'player')` | `playerHit` | medium |
| `kill` | `kill` | — |
| `heal` | `pickup` | light |
| `boom` / `blast` | `boom` | medium |
| `lightning` | `secret` | — |
| `phase` | `core` | medium |
| `enrage` / `stage('boss')` | `active` | — |
| `stage('cleared')` | `clear` | — |
| `swing` / `whirl` / `charge` / `dodge` / `castStart` / `castEnd` / `regen` / `stage('encounter')` | 静默（刻意） | — |

设计取舍：玩家自身高频动作（普攻 0.4 s 一刀）不出声，避免糊成噪声；BOSS 读条已有横幅 + 进度条，不再抢注意力。

### 2.2 音效单例与顶栏开关（`MithrilAudio.ts`，新）

| 项 | 内容 |
|---|---|
| 单例 | `class MithrilAudio extends GameAudio { super('mithril') }`，`export const sfx`；偏好键 `tiny_games_mithril_audio`（不进游戏存档 schema） |
| 批量入口 | `playCoreEvents(events)`：逐条 `coreEventSfx` → `sfx.play(name)`；同帧同名由 `GameAudio` 的 `gap` 节流 |
| 开关 UI | 运行时创建（不改场景）：`MithrilAudioUi` 720×1280 容器 + `SfxToggle` 104×40 圆角按钮，位置 **(300, 598)**（顶栏右上，标题居中 / 区域页签 y 478 / 状态标签 y 526 都不重叠），文案「音效 开 / 音效 关」（汉字，红线 10） |
| 交互 | 点击先 `unlock()`（绕开浏览器自动播放限制）再 `toggle()`，`toggle()` 同时切换音效与震动并落盘；命名 handler，`onDestroy` 用同一引用 `off()` |
| 挂点 | `MithrilGame._ensureAudio()` 挂到路线图节点，随 `WildMap.show/hide` 显隐；战斗 HUD 无空位，故开关只在 hub |
| 探针 | `globalThis.__mithrilAudio`（`onLoad` 写 / `onDestroy` 清），供浏览器与试玩断言 `available / sfxOn / vibOn / enabled` |

### 2.3 场景层钩子（`MithrilGame.ts` / `MithrilCampPanel.ts`，改）

| 位置 | 动作 |
|---|---|
| `update()` → `drainEvents()` 之后 | `playCoreEvents(events)` |
| 升级分支 | `sfx.play('core')`（与升级横幅同时） |
| `_settle(won)` | `sfx.play(won ? 'won' : 'dead')` |
| `onWildNodeTap` / `onWildPrimary` / `onWildRegionTap` | `sfx.play('click')` |
| 宝箱（绕开 / 开箱陷阱 / 金币） | `click` / `playerHit` / `coin` |
| 野外事件 / 补给 | `playerHit`（掉血）或 `pickup` |
| 悬赏领取 | `sfx.play('coin')` |

`onDestroy()` 只清 `_audioRef` 与探针引用，不碰任何 `@property(Node)`（红线 4）。

### 2.4 自检脚本（`tools/verify-mithril-audio.js`，新，88 项）

| 组 | 覆盖 |
|---|---|
| §1 纯映射表 | 单独编译 `MithrilAudioMap.ts`；11 条发声 + 10 类静默 + 空事件 / 无 `type` 兜底 |
| §2 共享总线契约 | `SfxName` 联合与 `SPECS` 配方表逐项切片；秘银用到的 13 个名字都有配方（拼错 = 静默，最容易漏）；`playerHit/boom` medium、`won` heavy、`dead` 长震；`hit/kill/playerHit/click` 带 `gap`；wx 分支优先 |
| §3 工程约束 | `assets/` 零音频文件；无 `U+FE0E/U+FE0F`；全部 `sfx.play('x')` 字面量都有配方；战斗事件走 `playCoreEvents`；开关命名 handler + `onDestroy` 解绑；`super('mithril')` 与偏好键模板；开关坐标在顶栏右上；探针存在 |

## 3. 微信构建与预检

| 步骤 | 结果 |
|---|---|
| 场景清单同步（三处） | `node tools/sync-build-scenes.js --check` 退出码 **0**（`Lobby → … → Fridge → Mithril`，26 个） |
| 构建方式 | 屏幕锁定无法操作面板，改用 CLI：`CocosCreator --project . --build "configPath=<导出的同任务配置>"`（配置取自 `BuildTaskManager.taskMap.1792314068880.options`，release / `useSplashScreen` / `startScene=Lobby` 与上次一致） |
| 构建结果 | 28 s 完成；`build/wechatgame/` 重新生成；`assets/main/config.json` 场景数 **26**，含 `db://assets/games/game_mithril/scenes/Mithril.scene` |
| 产物加载复现 | `node tools/replay-wechat-bundle.js` → ✅ 小游戏包装下加载完成无异常（未出现 `Object.defineProperty called on non-object`） |
| 预检 | 开发者工具打开项目后自动编译这一版；`node tools/check-wechat-build.js` → **9/9 通过、0 条提醒**：AppID `wx755…6b7e`、`game.json` 齐全、4 个模块均为「小游戏包装」、主包体积正常 |
| 模拟器实机 | 项目窗口打开后模拟器自动启动：大厅标题 / 分类页签 / 游戏卡片正常渲染，控制台 `LoadScene db://assets/main/scenes/Lobby.scene` 成功、无红色报错（截图 `.playwright-mcp/m10-devtools-sim.png`） |

## 4. 已知限制与遗留

- **模拟器只验到大厅**：本轮大厅未注册本作（M11 才做），因此模拟器冒烟覆盖「产物启动 / 小游戏包装 / 引擎与场景加载」，秘银远征场景内的 Playwright 级交互已在浏览器预览与第 19 轮试玩覆盖；模拟器内点进本作的端到端验证留到 M11 注册之后。
- **构建走 CLI**：构建时屏幕锁定无法点面板，用 `CocosCreator --project . --build "configPath=…"`，配置取自上次任务快照（release / 同 `startScene`）。编辑器退出时会用内存里的旧清单整批覆盖 `profiles/`，所以同步脚本必须在编辑器**关闭**后跑（本次即如此，`--check` 退出码 0）。
- **开关只在路线图**：战斗 HUD 全屏无空位（顶栏左返回+血条、右进度/计时、BOSS 条横跨中线、右下六个技能键、左下摇杆）。设计上靠「进副本前后各一次点按」覆盖。
- **音频不可自动化验证**：桌面浏览器无真实听觉与震动，验收以事件映射断言 + 探针 + 无异常为准；真机听感留给微信模拟器/设备。
- **未注册大厅**：按 M11 计划，`GameConfig.GAME_LIST` / 大厅图标 / `docs/README.md` 条目仍留到 M11，`sync-build-scenes.js --check` 会打印相应提示（预期）。

## 5. 回归与提交

```
tsc --noEmit                      TS_OK
verify-mithril-core.js            221 项
verify-mithril-audio.js            88 项
verify-mithril-wild.js          2,829 项
verify-mithril-camp.js            337 项
verify-mithril-dungeons.js        892 项
verify-mithril-trinkets.js        692 项
verify-mithril-bounty.js          471 项
verify-mithril-balance.js         136 项
verify-template-core.js            15 项
```

提交：`feat(mithril): M10 音效与震动、路线图音效开关、微信构建预检`（`develop`）。
