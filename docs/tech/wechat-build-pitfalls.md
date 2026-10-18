# 微信小游戏构建产物：为什么会「编译报错」以及怎么保证能跑

> **适用**：把 Cocos 构建出的 `build/wechatgame/` 交给微信开发者工具，出现编译报错 / 模拟器起不来。
> **来源**：2026-10-18 本项目实测（DevTools 2.02.2608080，Cocos Creator 3.8.8）。
> 速查版见 [`../../AGENTS.md`](../../AGENTS.md) 的**当前教训**行 G。
> 预检脚本：[`../../tools/check-wechat-build.js`](../../tools/check-wechat-build.js)。

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

---

## 5. 预检脚本：`tools/check-wechat-build.js`

```bash
node tools/check-wechat-build.js                 # 默认检查 build/wechatgame
node tools/check-wechat-build.js <构建目录>       # 指定其它目录
# 退出码 0 = 通过；有 ❌ 时返回 1，可直接串进脚本
```

它检查 7 项，每项对应一类"真机上会翻车"的故障：

| # | 检查 | 挡住的故障 |
|---|------|-----------|
| 1 | 9 个必需文件齐全、且**非零字节** | 构建中途失败、写了一半（本次故障的直接指纹） |
| 2 | `game.json` / `project.config.json` 可解析、**无 BOM**、`compileType === "game"` | 「文件读取失败」的另一类原因：JSON 坏了 / 带 BOM / compileType 不对 |
| 3 | 构建是否已落盘稳定（最新文件 mtime < 60s 就提醒） | 「构建还在写，你就去开工具了」 |
| 4 | **全部产物 `.js` 按 ES2015 与 ES5 双重解析** | 开发者工具自带编译不支持该语法（本项目实测 17 个文件全通过） |
| 5 | 主包体积 ≤ 4 MB | 真机下载失败（本次 3.20 MB / 4 MB，余量 814.9 KB） |
| 6 | 产物 `.js`/`.json` 里无 `U+FE0E`/`U+FE0F` | 本项目不变量，见 [`wechat-text-rendering.md`](./wechat-text-rendering.md) |
| 7 | **工具是否停在过期构建**：比对产物最新 mtime 与日志里最后一次 `simulator launch` | 就是本次那个"永远停在报错上"的状态 |

第 4 项用 Cocos 自带的 TypeScript（`COCOS_TSC_LIB` 可覆盖），找不到就降级为提醒、不判失败。
第 7 项目前只认 macOS 的日志路径；Windows 上路径不同，会降级成一条提醒（见 §6）。

---

## 6. 自测与声明纪律

新写的校验探针**第一次跑就全绿时要当可疑信号**，要找反例证明它不是空检查。本次两条：

- **第 6 项**必须能对含变体选择符的样本命中。自测：含 U+FE0F 的样本 → `true`，只有 U+2694 的样本 → `false`（样本按**码位**描述而非字面量 —— 两者在编辑器里几乎看不出差别，这正是这个坑难查的原因）。
  （字符串按码位写，不写字面量 —— 两者在编辑器里几乎看不出差别，正是这个坑难查的原因）。
- **第 4/6 项**必须确认产物里的非 ASCII 是**原样 UTF-8 字面量**（若被转义成 `\uXXXX`，扫描就是空检查）。实测产物 `assets/main/index.js` 里 `能量不足`、`战士` 均为字面量 ⇒ 检查有效。

**本机验证不了的**（不要写成已验证）：

- **微信真机**。CLI 的 `preview` 需要登录，且本机 appid（`wx6ac3f5090a6b99c5`）不属于当前登录用户 —— 日志里有 `登录用户不是该小程序的开发者`、`fetchAppExptInfo fail`。所以本轮结论只到「**本机开发者工具能编译并 `simulator launch success`**」，不含真机。
- Windows 上的日志路径（`%USERPROFILE%\AppData\Local\微信开发者工具\User Data\<hash>\WeappLog\logs`）未实测，脚本对此只给提醒。

---

## 7. 可以先忽略的噪声

```
onProxyError /__pageframe__/instanceframe.html TypeError: Cannot convert undefined or null to object ... 500
```

**判据**：它在**成功**的会话里同样出现。实测 20:17 那次已被 `simulator launch success` + `appservice webview loadstop` 证实起来了，而该 `onProxyError` 照样在 20:17:22.965 打了一条。19:58 那个会话也是「2 次 launch success + 4 条此错误」并存。

⇒ 属开发者工具自身的噪声，**不要据此判游戏缺陷**。判据永远看同一会话里有没有 `simulator launch success`。

---

## 8. 相关

- 预检脚本：[`../../tools/check-wechat-build.js`](../../tools/check-wechat-build.js)
- 图标方框（本项目在微信上的另一个坑，与构建时序无关）：
  [`wechat-text-rendering.md`](./wechat-text-rendering.md)
- 文本编码（PowerShell 重编码成 GBK）：[`dev-toolchain-notes.md`](./dev-toolchain-notes.md) §1
- Cocos 排期/补间陷阱：[`cocos-scheduler-and-tween-pitfalls.md`](./cocos-scheduler-and-tween-pitfalls.md)
