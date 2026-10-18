# 微信小游戏构建产物：为什么会「编译报错 / 启动即崩」以及怎么保证能跑

> **适用**：把 Cocos 构建出的 `build/wechatgame/` 交给微信开发者工具，出现编译报错 / 启动期异常 / 模拟器起不来。
> **来源**：2026-10-18 本项目实测（DevTools 2.02.2608080，Cocos Creator 3.8.8）。
> 速查版见 [`../../AGENTS.md`](../../AGENTS.md) 的**当前教训**行 G。
> 预检脚本：[`../../tools/check-wechat-build.js`](../../tools/check-wechat-build.js)（9 项）。
> 包装器复现器：[`../../tools/replay-wechat-bundle.js`](../../tools/replay-wechat-bundle.js)。

---

## 0. 两类故障，先分清

| 症状 | 时间点 | 根因 | 看 |
|------|--------|------|-----|
| 报 `game.json: 未找到 game.json 文件，或者文件读取失败`，项目一片红 | 编译期 | 构建目录被重写 × 工具自动重编译的**时序竞态** | §1–§4 |
| 编译能过，一打开就 **启动期崩**：`TypeError: Object.defineProperty called on non-object`（栈里有 `web-adapter.js` / `WAGameSubContext.js`） | 运行期 | 工具把项目编译成了**小程序**而不是**小游戏**（包装器不对） | §8 |

两者都不代表「构建产物坏了」。先看报错出现的时间点，再决定翻哪一节。

---

## 1. 现象

微信开发者工具里项目一片红（模拟器区显示报错），提示：

```
Error: game.json: 未找到 game.json 文件，或者文件读取失败
```

而 `build/wechatgame/game.json` 明明存在、是合法 JSON、无 BOM。日志里通常还伴随一句：

```
onProxyError /__pageframe__/instanceframe.html TypeError: Cannot convert undefined or null to object ... 500
```

**这句话是噪声，不是原因**（见 §7）。别顺着它查。

> 如果你看到的是**启动期**的 `Object.defineProperty called on non-object`，那是另一类故障，直接跳 §8。

---

## 2. 先取证：开发者工具自己的日志在哪

比截图和猜快得多。macOS：

```
~/Library/Application Support/微信开发者工具/<hash>/WeappLog/logs/*.log
```

`<hash>` 是随机目录名，用「哪个目录下有 `WeappLog`」来定位：

```bash
ls -d ~/Library/Application\ Support/微信开发者工具/*/WeappLog/logs
```

三条判据（`grep` 一下就有）：

| grep 关键字 | 含义 |
|------------|------|
| `game.json: 未找到` | 就是本次报错，**带完整堆栈**（`checkGameJSON`） |
| `simulator launch success` / `simulator launch failed` | 每次编译尝试的时间点，用来判断"工具停在哪一刻" |
| `compile onFileChange add` / `addDir` | 监听器此刻才发现某目录/文件是**刚被创建**的 —— 构建正在写入的直接证据 |

---

## 3. 根因：构建目录被重写 × 开发者工具自动重编译（时序竞态）

三个事实叠加：

1. **Cocos 构建是「先清空输出目录、再逐个写入」**，不是原子替换。
2. **开发者工具打开项目后会挂文件监听**，目录一有变动就自动重新编译、重启模拟器。
3. 于是当「构建开始」与「工具开着该项目」重叠时，工具会在**目录还空着或写了一半**的时刻去读 `game.json` → 报错。

最坑的是第 4 条：**它不会一直重试**。实测它放弃之后就不再自动编译，而构建是它放弃之后才写完的 —— 于是它永远停在那条报错上，看起来像"构建产物有问题"。

### 实测时间线（毫秒级，本项目）

| 时刻 | 事件 |
|------|------|
| 20:00:24 | 工具尝试启动模拟器 → **failed**（game.json 未找到） |
| 20:00:25 | 监听器报告 `src/`、`src/polyfills.bundle.js` 是**刚被新增** |
| 20:00:47 | Cocos 正在写 `src/polyfills.bundle.js` → 工具再试 **failed** |
| 20:00:48 | Cocos 正在写 `src/system.bundle.js` → 工具再试 **failed** |
| 20:00:49 | 工具最后一次尝试 **failed**，随后放弃 |
| **20:00:50** | **Cocos 才把 `application.js` / `assets/` / `game.js` / `game.json` 全部落盘** |
| 20:00:50 → 20:17 | **没有任何人再编译过一次**（工具停在过期状态） |
| 20:17:22 | 构建产物**一字未改**，仅触发一次重新编译 → **launch success** |

### 一眼判据

> 内容一字未改、只重新编译一次就恢复正常 ⇒ **时序问题**，不是构建内容问题。

对照法：如果重新编译后仍然报同一个错，才去查内容（用 §5 的预检）。

---

## 4. 保证能跑的操作顺序

1. **构建前**：把开发者工具里的该项目关掉（`cli close --project <路径>`，或直接在 UI 里关），**至少不要停在它上面**。
2. **Cocos**：构建 → 微信小游戏 → **等构建面板/日志明确显示完成**。不要看到进度条走一半就切过去看别的。
3. **跑预检**（见 §5，退出码 0 才算过）。
4. 预检通过后再打开 / 编译开发者工具项目。

> 若已经卡在报错状态：不用重新构建，**在工具里点一下「编译」**即可（本次就是这么恢复的）。

另外两件与「能跑」有关、和时序无关的事（见 §8）：

5. **AppID 用自己账号下的小游戏 AppID**（不是 Cocos 样例值），并**按【小游戏】导入**开发者工具 ——
   否则工具会按小程序编译，项目能编译但一打开就崩。预检第 8/9 项会直接告诉你中了没有。

---

## 5. 预检脚本：`tools/check-wechat-build.js`

```bash
node tools/check-wechat-build.js                 # 默认检查 build/wechatgame
node tools/check-wechat-build.js <构建目录>       # 指定其它目录
# 退出码 0 = 通过；有 ❌ 时返回 1，可直接串进脚本
```

它检查 9 项，每项对应一类"真机上会翻车"的故障：

| # | 检查 | 挡住的故障 |
|---|------|-----------|
| 1 | 9 个必需文件齐全、且**非零字节** | 构建中途失败、写了一半（本次故障的直接指纹） |
| 2 | `game.json` / `project.config.json` 可解析、**无 BOM**、`compileType === "game"` | 「文件读取失败」的另一类原因：JSON 坏了 / 带 BOM / compileType 不对 |
| 3 | 构建是否已落盘稳定（最新文件 mtime < 60s 就提醒） | 「构建还在写，你就去开工具了」 |
| 4 | **全部产物 `.js` 按 ES2015 与 ES5 双重解析** | 开发者工具自带编译不支持该语法（本项目实测 17 个文件全通过） |
| 5 | 主包体积 ≤ 4 MB | 真机下载失败（本次 3.20 MB / 4 MB，余量 814.9 KB） |
| 6 | 产物 `.js`/`.json` 里无 `U+FE0E`/`U+FE0F` | 本项目不变量，见 [`wechat-text-rendering.md`](./wechat-text-rendering.md) |
| 7 | **工具是否停在过期构建**：比对产物最新 mtime 与日志里最后一次 `simulator launch` | 就是本次那个"永远停在报错上"的状态 |
| 8 | **AppID 不是占位/样例值** | §8：样例 AppID 让工具认不出这是小游戏 → 按小程序编译 → 启动即崩 |
| 9 | **工具编译缓存里的包装方式**：读 `define(...)` 头，看是「小游戏包装」还是「小程序包装」 | §8 的直接判据 —— 小程序包装 = 打开必崩 |

第 4 项用 Cocos 自带的 TypeScript（`COCOS_TSC_LIB` 可覆盖），找不到就降级为提醒、不判失败。
第 7/9 项目前只认 macOS 的日志与缓存路径；Windows 上路径不同，会降级成一条提醒（见 §6）。
第 8/9 项是本项目 2026-10-18 新增的：它们把「构建产物对不对」扩展到了「**开发者工具会把它当什么编译**」。

---

## 6. 自测与声明纪律

新写的校验探针**第一次跑就全绿时要当可疑信号**，要找反例证明它不是空检查。本次两条：

- **第 6 项**必须能对含变体选择符的样本命中。自测：含 U+FE0F 的样本 → `true`，只有 U+2694 的样本 → `false`（样本按**码位**描述而非字面量 —— 两者在编辑器里几乎看不出差别，这正是这个坑难查的原因）。
  （字符串按码位写，不写字面量 —— 两者在编辑器里几乎看不出差别，正是这个坑难查的原因）。
- **第 4/6 项**必须确认产物里的非 ASCII 是**原样 UTF-8 字面量**（若被转义成 `\uXXXX`，扫描就是空检查）。实测产物 `assets/main/index.js` 里 `能量不足`、`战士` 均为字面量 ⇒ 检查有效。

**本机验证不了的**（不要写成已验证）：

- **微信真机**。CLI 的 `preview` 需要登录，且本机构建配置里的 appid 不属于当前登录的微信账号 —— 日志里有 `登录用户不是该小程序的开发者`、`fetchAppExptInfo fail`。所以本手册的结论只到「**本机开发者工具**」这一层，不含真机。
- **「模拟器进程起来了」≠「游戏跑起来了」**（2026-10-18 追加教训）。`simulator launch success` 只证明工具把模拟器进程拉起来了；游戏代码在模拟器里抛不抛异常是另一回事。真实反例：本项目 20:57 那次 **`launch success` + 编译全绿**，但一打开就是 §8 那个 `Object.defineProperty called on non-object`。判据要落在「产物在正确的包装下能否加载完」（`tools/replay-wechat-bundle.js`）与「工具把它编译成了哪种包装」（预检第 9 项），而不是日志里有没有 `launch success`。
- **微信侧的服务端属性**。`isGame` 来自 AppID 在微信服务端的 `attr.gameApp`（另有 `app_type === 4` 的判定），本机无法查询；第 8 项只能判「是不是样例/空 AppID」，不能判「这个 AppID 是否已注册为小游戏且归当前账号所有」。
- Windows 上的日志与编译缓存路径（`%USERPROFILE%\AppData\Local\微信开发者工具\User Data\<hash>\...`）未实测，脚本对此只给提醒。

---

## 7. 可以先忽略的噪声

```
onProxyError /__pageframe__/instanceframe.html TypeError: Cannot convert undefined or null to object ... 500
```

**判据**：它在**成功**的会话里同样出现。实测 20:17 那次已被 `simulator launch success` + `appservice webview loadstop` 证实起来了，而该 `onProxyError` 照样在 20:17:22.965 打了一条。19:58 那个会话也是「2 次 launch success + 4 条此错误」并存。

⇒ 属开发者工具自身的噪声，**不要据此判游戏缺陷**。

**但注意**（2026-10-18 修正）：以前这里写的是「判据永远看同一会话里有没有 `simulator launch success`」，**这条已被证伪**。`simulator launch success` 只说明工具把模拟器进程拉起来了，**不代表游戏代码没抛异常** —— 本项目 20:57 那次日志里 `launch success`、预检 1–7 项全绿，实际一打开就是 §8 的启动期崩溃。正确判据见 §6 末条。

---

## 8. 启动期崩溃：`Object.defineProperty called on non-object`（包装器 / 项目类型）

### 8.1 现象与堆栈

编译能过，但项目一打开（或一编译完就）报：

```
WAGame.js:1 TypeError: MiniProgramError Object.defineProperty called on non-object
    at Object.defineProperty (<anonymous>)
    at define.27…/../../../common/xmldom/dom-parser (web-adapter.js? [sm]:1)
    at g (web-adapter.js? [sm]:1)
    at r (web-adapter.js? [sm]:1)
    at web-adapter.js? [sm]:1
    at <require(web-adapter.js)>
    at p (WAGameSubContext.js:1)
    at WAGameSubContext.js:1
    at Object.runWith (WAGameSubContext.js:1)
    at P (WAGameSubContext.js:1)
```

栈里出现 `WAGameSubContext.js` / `runWith`，说明这是**小游戏运行时**在加载模块 —— 崩的却是「加载第一个碰 `window` 的模块」这一步。

### 8.2 根因：开发者工具给「小游戏」和「小程序」套的模块包装不同，运行时传的实参个数也不同

开发者工具（`app.asar` 里，2026-10-18 版本）生成模块包装器的两个函数：

```js
function wrapSourceCodeInDefine(e, n, r = '') {      // ← 小程序
  return `define("${e}", (function(require, module, exports, ${NO_BOM_VAR.join(',')}){ ${n}\n}));${r}`;
}
function wrapGameSourceCodeInDefine(e, n, r = '') {  // ← 小游戏
  return `define("${e}", (function(require, module, exports, process){ ${n}\n}));${r}`;
}
// 分派：const o = t.isGame ? wrapGameSourceCodeInDefine : wrapSourceCodeInDefine;
```

而小游戏运行时 `WAGameSubContext.js` 调用模块工厂**只传 3 个实参**：

```js
p("", `require(${e})`, w, void 0, [T(e), b, b.exports], !0)   // p 内 = r.apply(n, o)
```

⇒ 一旦用了「小程序」包装，`window` / `top` / `document` / `navigator` / … 全部是 **`undefined`**（它们是形参，会遮蔽全局）。
再叠上第三件事实：运行时里**没有任何地方定义 `__devtoolssubcontext`**（41 MB 运行时包全量 0 命中；小游戏只定义 `__clientsubcontext`），于是适配器里这段在模拟器里**恒成立**：

```js
if ('undefined' == typeof __devtoolssubcontext && 'devtools' === platform) {
  for (var v in k) { …; Object['defineProperty'](window, v, {'value': k[v]}); }   // window === undefined → 抛
}
```

`Object.defineProperty(undefined, …)` 就是那条原生 `TypeError`。位置在 bundle 偏移 ~88013（本项目 3.20 MB 构建）。

### 8.3 本地复现与反证（`tools/replay-wechat-bundle.js`）

同一份 `build/wechatgame/web-adapter.js`，只换包装方式：

| 加载方式 | 结果 |
|----------|------|
| A) 小程序包装（BOM 全形参）+ 运行时只传 3 实参 | ❌ `TypeError: Object.defineProperty called on non-object`，偏移 ~88013 —— **与线上报错逐字一致** |
| B) 小游戏包装（`function(…, process)`） | ✅ 加载完成 |
| C) 仍是小程序包装，但把真 `window` 传进去 | ✅ 加载完成 |

⇒ 差异只在「包装方式 + 实参个数」，**产物本身没有缺陷**。另外两条负结果（省得再试）：

- 试图在产物里预置 `__devtoolssubcontext` 让它走 `else` 分支**无效** —— 那个分支会把 BOM 装到 `__global` 形参上，同样 undefined，换成 `TypeError: Cannot set properties of undefined (setting 'DOMParser')`。
- 在小游戏入口 `game.js` 里补 `globalThis.window = …` 也**无效** —— 形参遮蔽全局，补不上。

**所以这条故障没有「改产物」的绕法**，只能让工具按小游戏编译。

### 8.4 判定：工具到底编译成了哪种包装

看开发者工具自己的编译缓存（macOS）：

```
~/Library/Application Support/微信开发者工具/<hash>/WeappCache/WeappCompileCache/<项目hash>/<md5>
```

每个条目旁边有 `<md5>.json` 侧车，里面 `mtimeMs` 就是**被编译的源文件的 mtime** —— 用它和构建产物比对，就能确定「这份产物被编译成了什么」。本项目实测：

```
467b140f….json:  mtimeMs = 1792326980215.52
build/wechatgame/web-adapter.js: mtimeMs = 1792326980215.52   ← 逐位相同，确属同一份
467b140f…:       define("web-adapter.js", (function(require, module, exports, window,top,document,…   ← 小程序包装
```

实扫本项目 18 个缓存模块，**全部**是「小程序包装」（`game.js` / `engine-adapter.js` / `web-adapter.js` / `cocos-js/cc.js` …）⇒ 整个项目被当成小程序编译。

预检第 9 项就是把上面这件事自动化了。

### 8.5 为什么会被当成小程序 / 怎么修

- `isGame` 的来源是 AppID 在**微信服务端**的属性：开发者工具的项目映射里写的是
  `isGame: t.attr?.gameApp`，另一处判定为 `isGame: !!attr.game_app || 4 === Number(attr.app_type)`。
  本地 `project.config.json` 的 `compileType: "game"` 是必要条件，但不决定包装器的选择。
- 本项目 `build/wechatgame/project.config.json` 里的 appid 是 **Cocos Creator 自带样例项目的 AppID**
  （它出现在编辑器自身打包的构建 profile 里，而项目源码/设置里都没有它），当前登录账号不是它的开发者 ——
  日志里早有 `登录用户不是该小程序的开发者` + `fetchAppExptInfo fail`。服务端查不到属性 ⇒ `isGame` 为假 ⇒ 按小程序编译。
- **动作**（按顺序试）：
  1. 在 Cocos Creator「构建 → 微信小游戏」里把 **AppID 换成自己的小游戏 AppID**（或先用微信测试号），重新构建；
  2. 在开发者工具的「新建/导入项目」处**按【小游戏】导入**本目录（不要从小程序入口进）；
  3. 只想先看画面：用测试号新建一个【小游戏】项目，或直接用真机预览。

### 8.6 一句话判据

> 编译全绿、`simulator launch success`，但一打开就是 `Object.defineProperty called on non-object`
> ⇒ 先跑 `node tools/check-wechat-build.js`（第 8、9 项）与 `node tools/replay-wechat-bundle.js`，
> 确认是不是「被当成小程序编译了」，而**不要去改构建产物**。

---

## 9. 相关

- 预检脚本（9 项）：[`../../tools/check-wechat-build.js`](../../tools/check-wechat-build.js)
- 包装器复现器：[`../../tools/replay-wechat-bundle.js`](../../tools/replay-wechat-bundle.js)
- 图标方框（本项目在微信上的另一个坑，与构建时序无关）：
  [`wechat-text-rendering.md`](./wechat-text-rendering.md)
- 文本编码（PowerShell 重编码成 GBK）：[`dev-toolchain-notes.md`](./dev-toolchain-notes.md) §1
- Cocos 排期/补间陷阱：[`cocos-scheduler-and-tween-pitfalls.md`](./cocos-scheduler-and-tween-pitfalls.md)
