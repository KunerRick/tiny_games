# 《秘银远征》M10 实施计划（音效 / 震动 / 微信预检）

> 日期：2026-11-16 · 分支：`develop` · 前置：M9 已验收（`2026-11-16-mithril-m9-acceptance.md`，`15e6ead`）
> 设计规格：`docs/plans/2026-11-14-game-mithril-design.md` §9（目录结构：`MithrilAudio.ts`）/ §11（里程碑表）/ §12（风险表）
> 里程碑原文：`| **M10** | 音效 / 震动 / 微信预检 | check-wechat-build.js + 模拟器实机 |`

## 退出判据

| # | 判据 | 验证方式 |
|---|------|---------|
| 1 | 战斗与主要 UI 节点都有声音：命中 / 击杀 / 受伤 / 爆炸 / BOSS 阶段 / 通关 / 阵亡 / 升级 / 宝箱 / 悬赏领取 | `verify-mithril-audio.js` 断言事件映射表 + 浏览器实机听（第 19 轮试玩） |
| 2 | 震动分级正确且可关：受伤 medium、通关 heavy、阵亡 long | 同一脚本断言 `GameAudio.SPECS` 的 `vib` / `vibLong`；浏览器里 `navigator.vibrate` 缺失时静默 |
| 3 | 全站开关：路线图顶栏「音效 开/关」同时控制音效与震动，偏好跨会话持久 | 浏览器探针：点开关 → `tiny_games_mithril_audio` 落盘 → reload 后开关状态保持 |
| 4 | 零音频资源：仍不引入任何 `.mp3/.wav/.ogg`，微信走 `wx.createWebAudioContext()` | 脚本断言 `assets/` 下音频文件数 = 0；读 `GameAudio.createAudioContext()` 的 wx 优先分支 |
| 5 | 静默降级：没有 AudioContext（老基础库 / 关闭开关 / 静音）不崩、不报错、玩法不变 | 浏览器里把 `sfx.setEnabled(false)` 后打完一整场；console 0 error |
| 6 | 微信预检：`check-wechat-build.js` 9 项全绿、`replay-wechat-bundle.js` 通过、模拟器实机启动 | 命令行退出码 0 + 模拟器截图 |
| 7 | 回归 + 编译：7 个既有 verify 全绿、`tsc --noEmit` = TS_OK | 全量跑一遍 |
| 8 | 独立试玩（第 19 轮）P0/P1 清零 | `2026-11-16-playtest-round19-mithril-m10.md` |

## 现状盘点（M9 结束时）

- **有现成引擎**：`assets/common/audio/GameAudio.ts`（M 前置工作已从《冰箱底下》上提）——WebAudio 程序化合成 + `wx.vibrateShort/vibrateLong` + `navigator.vibrate` + 节流 + 静音偏好（键 `tiny_games_${gameId}_audio`）。`pool` / `thunder` / `fridge` 三款已接入。
- **秘银远征一次都没接**：`grep GameAudio assets/games/game_mithril` 为空；设计规格 §9 里的 `MithrilAudio.ts` 尚未创建。
- **没有音频资源**：`assets/` 下 0 个 `.mp3/.wav/.ogg`——本来就不该有，程序化合成是既定方案。
- **战斗事件够用**：`CoreEvent` 已带 `damage(target: enemy|player)` / `kill` / `boom` / `blast` / `lightning` / `phase` / `stage` / `heal` / `enrage`，不需要改核心。
- **HUD 没有空位**：战斗 HUD 顶栏左侧是返回键 + 血条，右侧是进度 / 计时，下方 BOSS 条横跨 x −320..320，右下是六个技能键、左下是摇杆。**战斗态全屏无空位**，开关只能放路线图（hub）顶栏。
- **微信构建清单缺本作**：`node tools/sync-build-scenes.js --check` 退出码 1，三处（`builder.common.scenes` / taskMap 快照 / `wechatgame.json`）都缺 `Mithril.scene`；`build/wechatgame/` 是 2026-11-14 的旧产物（25 个场景，不含 M10 之前的任何 M5–M9 代码）。

## 子步骤

### M10.1 纯逻辑映射表（`MithrilAudioMap.ts`，新）

不改 `MithrilCore`。新建一个**零 import** 的纯模块，把「战斗事件 → 音效名」从场景层剥离出来，好让脚本能在 Node 里断言：

```ts
/** 秘银远征用到的音效名（是 common/audio/GameAudio 的 SfxName 子集） */
export type MithrilSfx =
    | 'hit' | 'playerHit' | 'kill' | 'pickup' | 'boom' | 'secret'
    | 'core' | 'clear' | 'active' | 'won' | 'dead' | 'coin' | 'click';

/** CoreEvent 形状（只用 type/target，避免 import cc 链） */
export interface EventLike { type: string; target?: string }

export function coreEventSfx(ev: EventLike): MithrilSfx | null;
```

映射表（一个事件最多一声；节流交给 `GameAudio` 的 `gap`）：

| 事件 | 音效 | 理由 |
|---|---|---|
| `damage.target === 'enemy'` | `hit` | 命中反馈（gap 0.05，密集战斗不会糊） |
| `damage.target === 'player'` | `playerHit` | 自带 medium 震动 |
| `kill` | `kill` | 击杀 |
| `heal` | `pickup` | 吃血球 / 治疗 |
| `boom` / `blast` | `boom` | 爆炸（自带 medium 震动） |
| `lightning` | `secret` | 饰品落雷，用高频三连音区分 |
| `phase` | `core` | BOSS 换阶段（自带 medium 震动） |
| `stage === 'boss'` | `active` | 进入 BOSS 战 |
| `stage === 'cleared'` | `clear` | 清场 |
| `enrage` | `active` | 狂暴 |
| `castStart` / `castEnd` / `swing` / `whirl` / `charge` / `dodge` / `regen` / `stage === 'encounter'` | 无 | 要么太频繁（走近战每 0.4 s 一刀），要么已有视觉横幅，出声只会噪 |

### M10.2 音效总线单例 + 顶栏开关（`MithrilAudio.ts`，新）

抄 `FridgeAudio.ts` 的形态（设计规格原文「抄 FridgeAudio」）：

- `export class MithrilAudio extends GameAudio { constructor() { super('mithril'); } }`
- `export const sfx = new MithrilAudio();`
- `MithrilAudioUi`：运行时创建（不改场景），104×40 圆角按钮，文字「音效 开 / 音效 关」（**不用 ✓/✕**，红线 10），点一下 `unlock()` + `toggle()`。
- 挂点：`MithrilGame._ensureAudio()` 把它加到**路线图节点**上并 `setSiblingIndex` 到最后（`WildMap.show()` 会把整棵树抬到最上，开关自动跟着显隐）；位置 = 顶栏右上 `(300, 598)`，与标题（居中）和区域页签（y 478）都不重叠。
- 探针：`globalThis.__mithrilAudio = sfx`（`onLoad` 写、`onDestroy` 清），供浏览器/试玩断言 `available / sfxOn / vibOn`。

### M10.3 战斗与玩法钩子（`MithrilGame.ts`，改）

| 位置 | 动作 |
|---|---|
| `update()` 拿到 `events` 后 | `this._playCombatAudio(events)`：遍历 → `coreEventSfx` → `sfx.play(name)` |
| 升级分支（`_onCoreEvents` 里 `levels > 0`） | `sfx.play('core')`（与横幅同时） |
| `_settle(won)` 开头 | `won ? sfx.play('won') : sfx.play('dead')` |
| `onWildNodeTap` / `onWildPrimary` / `onWildRegionTap` | `sfx.play('click')` |
| `_resolveChest`（开启成功） | `sfx.play('coin')`；触发陷阱 → `sfx.play('playerHit')` |
| `_resolveEvent` / `_resolveSupply` | `sfx.play('pickup')` |
| `onGameHide`（切后台） | 已有：不新增（`GameAudio` 没有需要暂停的循环音） |

**不在 `update()` 里按血量变化猜音效**——只用核心事件，避免与实体渲染逻辑重复判断。

### M10.4 营地 / 悬赏（`MithrilCampPanel.ts`，改）

- `_onBountyClaim` 成功 → `sfx.play('coin')`；失败提示不出声（保持「失败只有文字」的既定口径）。

### M10.5 自检脚本（`tools/verify-mithril-audio.js`，新）

不启动引擎，三层断言（约 40 项）：

1. **纯映射表**：用 `runTsc` 把 `MithrilAudioMap.ts` 编译到 `temp/mithril-audio-test` 后 `require`，逐条断言上表 13 条映射 + 6 条「必须静默」的事件。
2. **共享总线契约**：正则解析 `assets/common/audio/GameAudio.ts` 的 `SPECS`，断言 `MithrilSfx` 全部有配方（拼错名字会静默，这是最容易漏的一类 bug）；断言 `playerHit` 带 `vib`、`won` 带 `vib: 'heavy'`、`dead` 带 `vibLong`。
3. **工程约束**：`assets/` 下音频文件数 = 0；秘银脚本里所有 `sfx.play('<x>')` 的字面量都属于 `MithrilSfx`；音效模块与配置不含 `U+FE0E/U+FE0F`；偏好键是 `tiny_games_mithril_audio`（前缀与 `StorageManager` 约定一致）。

### M10.6 微信预检与实机

1. **场景清单**（三条构建清单都缺本作）：编辑器在跑 → 按 AGENTS 阶梯用 MCP `preferences_set_preferences_config` 带 `path` 写 `builder.common.scenes` 与 `BuildTaskManager.taskMap.<任务号>.options.scenes`；`wechatgame.json`（`profiles/v2/packages/`）MCP 够不到，用脚本在**编辑器关闭时**写或直接改该 JSON（非 `.scene` 资产，允许）。判据：`node tools/sync-build-scenes.js --check` 退出码 0。
2. **重新构建 wechatgame**：`project_build_project(platform: 'wechatgame')`；构建前先关掉微信开发者工具里的该项目（时序竞态，`wechat-build-pitfalls.md` §3）。
3. **预检**：`node tools/check-wechat-build.js` 9 项全绿（含场景数从 25 → 26、主包 ≤ 4 MB、无 VS16、小游戏包装）。
4. **回放**：`node tools/replay-wechat-bundle.js` 退出码 0。
5. **模拟器实机**：`wechatwebdevtools` 打开新构建 → 模拟器跑起来 → 用大厅（尚未注册本作，从场景 URL 进）确认能进战斗、放技能不出错；口径与操作要点见 `wechat-build-pitfalls.md` §9.2（Electron AX 树为空，只能截图 + 坐标点击）。**`simulator launch success` 不证明无异常**，要看调试器 Console 无红色报错。

### M10.7 回归与试玩

- `node tools/verify-mithril-core.js` / `-camp` / `-dungeons` / `-trinkets` / `-wild` / `-bounty` / `-balance` / **`-audio`** 全绿；`tsc --noEmit` = TS_OK。
- 第 19 轮试玩（fresh 子代理）：音效开关默认开 → 关 → 落盘 → reload 后仍是关；关闭后打完一整场不崩、console 0 error；路线图 / 战斗 / 结算面板都无遮挡；`__mithrilAudio.available` 在浏览器为 `true`。

## 红线

- 不改 `MithrilCore` 的事件形状（音效只读事件）。
- 不引入音频资源文件；不新增 `AudioSource` / 场景节点（全部运行时创建）。
- `onDestroy()` 里不碰 `@property(Node)`；`MithrilAudioUi` 只解绑自己的按钮。
- 音效名必须存在于 `GameAudio.SPECS`（脚本拦），否则 `play()` 静默失败。
- 开关按钮文字不用符号字符（红线 10）。
- 构建前必须关掉开发者工具里的项目；构建后先预检再打开。

## 风险

| 风险 | 处理 |
|---|---|
| 浏览器自动播放限制导致首次无声 | `GameAudio.unlock()` 在开关点击时调用；`play()` 内部对 suspended ctx 自行 `resume()`；试玩以「点过屏幕后有声音」为准 |
| 每帧多次 `play` 拖慢帧率 | 配方表自带 `gap`（0.03–1 s），且只在事件层调用，不在 `update` 每帧无条件调用 |
| 微信 WebAudio 节点支持不全 | `GameAudio` 每个合成调用都 try/catch，失败只是少一声；`replay-wechat-bundle.js` + 模拟器实测 |
| 构建清单三处不一致导致包内少场景 | `sync-build-scenes.js --check` 必须退出码 0 才算完成 |
| 模拟器验收依赖 GUI | 先用脚本与回放覆盖「能不能启动」；GUI 只做最终冒烟，操作按 §9.2 |

## 不做（留给 M11）

- `GameConfig.GAME_LIST` 注册、大厅图标、`docs/README.md` 条目（用户硬约束：M11）。
- 背景音乐（设计未要求，程序化 BGM 成本高且非本批目标）。
- 音量滑杆 / 单独静音震动（开关是音效 + 震动一键切，与 `thunder` / `fridge` 一致）。
