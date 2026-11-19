# round40 玩法修复批 · 独立复核（reverify）

> 角色：独立复核者（fresh 上下文，未参与修复）
> 复核对象：[`2026-11-19-playtest-round40-gameplay-mithril.md`](./2026-11-19-playtest-round40-gameplay-mithril.md)（N199–N204 六条）
> 环境：Cocos Creator 3.8.8 预览 `http://127.0.0.1:7456/`，branch `develop`（工作区 6 个改动文件与待复核项一一对应）
> 时间：2026-11-19；预算内完成
> 纪律：未改任何 `.ts` / `.scene` / `.prefab`，未改台账，未提交 git；预览 / MCP 由本轮独占；收工已 `browser_close`

---

## 1 结论摘要表

| 项 | 开发级别 | 复核结论 | 证据强度 | 备注 |
|----|---------|---------|---------|------|
| **N199** 首战 2/3/2 | P1 | **CONFIRMED** | 代码 + 实机 `plan.encounters` | 改动本身确认；「非首战 3/4/3」的描述口径有误，见 §4-1 |
| **N200** 首档灰烬 ×2 | P2 | **CONFIRMED** | 代码 + 营地实机两档文案 | 其余档位未动；balance 050 = 60 断言未放水 |
| **N201** 头顶青色三角 | P2 | **CONFIRMED** | 代码 + 4× 裁切 | 画在玩家之后 → 不会被小怪盖住；极端贴身未构造 |
| **N202** 结算隐藏返回键 | P3 | **CONFIRMED** | 代码 + 实机读回 + 截图 | 退出路径完整（结算自带四按钮） |
| **N203** 天赋锁 | P3 | **CONFIRMED** | 代码 + 十格探针 + 4× 裁切 | 连刷 3 次锁数恒 8，无泄漏 |
| **N204** 职业卡描边 | P3 | **CONFIRMED** | 代码 + 实机截图 | 强弱分明，不似禁用 |
| 闸门 | — | **全绿** | 8/8 退出码 0 | 见 §2 |
| 冒烟 | — | **通过** | 控制台 0 error / 2 无关 warning | 见 §2 |
| 存档 | — | **往返一致** | len 1813 / sha256 `b381ab61…` | 见 §3 |

---

## 2 闸门与冒烟

| 项 | 结果 |
|---|---|
| `tsc --noEmit`（编辑器自带 5.8.2） | EXIT=0 |
| `verify-mithril-core` | EXIT=0（245/245） |
| `verify-mithril-wild` | EXIT=0（2975） |
| `verify-mithril-dungeons` | EXIT=0（892） |
| `verify-mithril-newplayer` | EXIT=0（123） |
| `verify-mithril-balance` | EXIT=0（139） |
| `verify-template-core` | EXIT=0 |
| `check-game-icons` | EXIT=0（25 款全覆盖） |
| 浏览器控制台 | **0 error / 2 warning**（`systemEvent` / `SystemEvent` 引擎弃用提示，与改动无关） |

**闸门是否被改成恒真**：`verify-mithril-wild.js` 首战期望值是硬编码构成（intro `a×2` / `b×1+a×2` / `m1×1+m0×1`），非 `expected=actual`；另断言首战第三波无 `ranged`。代码若回退到 3/4/3 会失败 —— **闸门有效**。

---

## 3 存档往返

- 拍前桥快照：len **1813** / sha256 `b381ab617d1bec0ca3fbc87ea91ed302a1ae480382c6a751f482d82fcebee769`
- 实机进战斗后游戏自持久化：len 1675 / sha `6101a8f9…`（真实写盘）
- 收尾用 `page.addInitScript`（同步 XHR `http://127.0.0.1:8799/` + sessionStorage 一次性 guard）→ reload：**len 1813 / sha 与拍前一致**
- 额外核对：`JSON.stringify(g._save)` 与 localStorage 逐字节相同（`identical = true`）

**存档往返 MATCH。**

---

## 4 复核者新发现（只描述现象；§4-1 已由主会话当日更正）

1. **（描述口径错误，非代码缺陷）** 任务与 `verify-mithril-wild.js:402` 注释称「非 intro 维持 3/4/3」，但实际非 intro 构成为 **3/4/5**：第一波 `a×3`、第二波 `b×2+a×2`、第三波 `c×2+b×2+a×1`（5 只，含 2 只远程；`MithrilConfig.ts:1229` `wraith kind:'ranged'`），合计 12 只。该分支在 git diff 中属未改动上下文，非 N199 引入；`verify-mithril-wild.js` 的断言本身按 5 只写、是对的，只有注释写错。**「3/4/3 = 10 只」只适用于旧 `intro` 构成**，主会话已在代码注释 / 报告 / 台账三处更正为「非首战 3/4/5」。
2. **（措辞不精确）** `intro` 判定是 `node.layer === 1`（`MithrilWild.ts:658`），而层 1 有 **2 个** battle 节点（`LAYER_KINDS[1] = ['battle','battle']`），所以 2/3/2 同时作用于层 1 的两个战斗节点，不是「第一个战斗节点」。与既有 N144 设计一致，报告措辞已更正。
3. **（观感，非缺陷）** N201 标记画在玩家之后（敌人之上），小怪恰好压在头顶时会短时遮住其一小块，实测仍可读、不影响辨位。
4. **（安全确认）** N202 隐藏返回键后不是无退出路径：结算面板自带「再来一次 / 成长 / 装备 / 返回大厅」（`MithrilHud.ts:1589–1594`）。

---

## 5 已怀疑但未证实（留给 round41）

- **N199 难度调参的真实胜率**：复核只核构成与实机数量，**未独立复跑**无头 bot × 6 seed 的「2/3/2 → 6/6 胜、均 31 s、最低血 30%」。
- **N201 极端贴身混战**：只截到 2 只 imp 的瞬时，未构造多怪完全压住三角的密集场景。
- **N201 呼吸频率体感**：`sin(_time × 7.5)` ≈ 1.2 Hz 是否干扰，未做多帧观察。
- **N203 锁标在微信小游戏产物 / 低分辨率下的辨识度**：只在桌面预览缩放截图确认。

---

## 6 截图

`docs/assets/2026-11-19-mithril-round40/`（gitignored）：`n201-battle.png`、`n201-crop.png`、`n202-result.png`、`n203-growth.png`、`n203-lock-crop.png`、`n204-class.png`、`n204-cards-crop.png`。
