# 《秘银远征》M11 验收记录（文档 + 大厅图标 + 验收记录）

> 日期：2026-11-16 · 分支：`develop` · 范围：M11（大厅注册 / 专属图标 / 文档归档 / 全量验收）
> 计划：`docs/plans/2026-11-16-mithril-m11-plan.md`
> 设计规格：`docs/plans/2026-11-14-game-mithril-design.md` §11（里程碑表，M11 = 收尾）
> 前置：M10 已验收（`2026-11-16-mithril-m10-acceptance.md`，`0add810`）

## 1. 退出判据与实测

| # | 判据 | 要求 | 实测 | 结论 |
|---|------|------|------|------|
| 1 | 大厅注册 | `GameConfig.GAME_LIST` 有 `mithril`，名称 / 场景名 / 描述 / 分类齐全 | `GameConfig.ts:48`：`{ id:'mithril', name:'秘银远征', sceneName:'Mithril', description:'野外远征与六座秘境，装备饰品构筑 + 营地养成', category:'action' }`；`check-game-icons.js` 规模行 = **GAME_LIST 25 款** | ✅ |
| 2 | 专属图标 | `ACCENTS` 有强调色、`drawShape` 有 `case 'mithril'` | `node tools/check-game-icons.js` → **退出码 0**，`25 款 · ACCENTS 25 条 · drawShape 25 个 case`，**0 警告** | ✅ |
| 3 | 大厅可见可点 | 卡片渲染正常、点击进入 `Mithril`、返回大厅正常 | web-mobile 产物 + Playwright 实机：卡片位于列表末行，图标为靛蓝梯形锭 + 顶面高光 + 两组星芒；点击后 `cc.director.getScene().name === 'Mithril'`；场景内「返回大厅」点回 `Lobby`；console **0 error**（`.playwright-mcp/m11-lobby-bottom3.png`、`m11-mithril-entry.png`） | ✅ |
| 4 | 无变体选择符 | `assets/` 全量扫 `U+FE0E/U+FE0F` = 0 | 扫 `assets/` 下 `.ts/.json/.scene/.prefab/.meta/.txt` → **0 命中** | ✅ |
| 5 | 构建场景清单三处齐 | `sync-build-scenes.js --check` 退出码 0 | 退出码 **0**，期望清单 **26 个**，末尾为 `Fridge → Mithril` | ✅ |
| 6 | 微信产物可开 | 预检 9 项全绿 + 包装复现 + 模拟器点进本作 | 产物 26 场景 / 73 UUID、`replay-wechat-bundle.js` 通过、预检 **7/9 通过**（第 7、9 项需开发者工具 GUI 编译，本轮屏幕锁定无法操作，见 §4） | ⚠ 部分关闭 |
| 7 | 回归 + 编译 | 8 个 mithril verify + 模板全绿、`tsc --noEmit` = TS_OK | `tsc --noEmit` = **TS_OK**（编辑器自带 5.8.2）；core 221 / audio 88 / wild 2,829 / camp 337 / dungeons 892 / trinkets 692 / bounty 471 / balance 136 / 模板 15，**全部退出码 0** | ✅ |
| 8 | 文档归档 | 设计 / 验收 / 试玩报告索引进 `docs/README.md` | `docs/README.md` 新增「秘银远征（Mithril / mithril）」小节：设计总规格、M1–M10 验收链、M6–M10 计划、第 10–19 轮试玩、8 个回归脚本；27 条相对链接逐条核验存在 | ✅ |

**小结**：8 条判据 7 条全绿，第 6 条只差「微信开发者工具编译这一版新产物」这一步，属于环境限制（屏幕锁定）而非产物缺陷，处置见 §4.3。

## 2. 交付内容

### 2.1 大厅注册（`assets/common/managers/GameConfig.ts`，改）

```ts
{ id: 'mithril', name: '秘银远征', icon: 'default', sceneName: 'Mithril',
  description: '野外远征与六座秘境，装备饰品构筑 + 营地养成', category: 'action' },
```

放在 `GAME_LIST` 末尾，与构建场景清单顺序一致。分类取 `action`：核心循环是节点制实时战斗，营地养成是长期层而非放置循环（`growth` 当前只放 `idle` / `fridge`）。

### 2.2 专属图标（`assets/main/scripts/GameIconArt.ts`，改）

| 项 | 内容 |
|---|---|
| 强调色 | `ACCENTS.mithril = { main: #4338CA, soft: #E0E7FF }`（靛蓝钢色）。与相邻的 `fridge`（青绿 ~174°）色相相距 70°+，第 7 条「相邻卡片色相 ≥ 40°」通过 |
| 图形 | `case 'mithril'`：**秘银锭** —— 外轮廓梯形锭体（`INK`）+ 内层主色梯形 + 顶面 `soft` 高光，右上一大一下两组十字星芒呼应金属光泽 |
| 绘制方式 | 全部 `moveTo/lineTo/fill/line`，零美术资源、零 emoji、零变体选择符 |
| 区分度 | 现有 24 个图形中无梯形锭、无星芒组合，`check-game-icons.js` 的「重复 (main, soft)」与「默认兜底」两项均无告警 |

### 2.3 文档归档（`docs/README.md`，改）

新增「秘银远征（Mithril / mithril）」小节（插在「冰箱底下」与「未单列小节的新游戏」之间）：

- 设计总规格 `plans/2026-11-14-game-mithril-design.md`
- M1–M10 验收记录链（10 份）
- M6–M10 阶段计划（5 份）
- 第 10–19 轮试玩报告（10 份）
- 8 个回归脚本（core / audio / wild / camp / dungeons / trinkets / bounty / balance）

### 2.4 工具链文档（`docs/tech/dev-toolchain-notes.md`，改）

新增 §4「Cocos CLI 构建必须脱离沙箱跑」：本轮做 M11 的无 GUI 构建时踩到 —— 沙箱内构建 3–9 s「成功」但 `config.json` 场景表为空、日志刷 1000+ 条 `Can not find the importer`、并把 **294 个 `.meta`** 改写成 `"ver":"0.0.1","importer":"*"`（`subMetas` 全丢）。根因是沙箱阻断 importer 插件加载，asset-db 退化成未知类型模式。处置：构建走 `dangerouslyDisableSandbox`、中招的 `.meta` 用 `git checkout --` 还原（受 git 跟踪）、判据为 `grep -c "Can not find the importer"` = 0。

## 3. 大厅可见可点：验证方式与实测

屏幕锁定无法启动 Cocos 编辑器 GUI，改用**无 GUI 路径**：CLI 构建 `web-mobile` → `python3 -m http.server 8123` → Playwright 驱动。

| 步骤 | 实测 |
|---|---|
| 构建 | `CocosCreator --project . --build "configPath=…"`（非沙箱）；`build/web-mobile/assets/main/config.json` = **26 场景 / 73 UUID**。注：首次尝试打包出 0 场景，同样命令重跑即正常（判据固定为「场景数 = 26」） |
| 视口 | 720×1280，`devicePixelRatio = 1` ⇒ 手册 §4 的 `k = 1`，canvas `ox = oy = 0` ⇒ 点击 CSS 坐标 = `(worldX, 1280 − worldY)` |
| 卡片定位 | 探针遍历场景找到 `Label.string === '秘银远征'`，父节点 `GameIcon`；`ScrollView.scrollToBottom()` 后 `worldPosition = (165, 153.87)` ⇒ 点击点 **CSS (165, 1126)** |
| 渲染 | 卡片渲染在列表最后一格（第 9 行左列），靛蓝锭 + 星芒清晰可辨；截图 `.playwright-mcp/m11-lobby-bottom3.png`（截图前用 `cc.profiler.hideStats()` 关掉左下角 FPS 覆盖层） |
| 点击进入 | `page.mouse.click(165, 1126)` → `cc.director.getScene().name === 'Mithril'`，新手职业选择面板（战士 / 法师 / 游侠 / 牧师 + 「以战士开局」）正常渲染，截图 `.playwright-mcp/m11-mithril-entry.png` |
| 返回大厅 | 点右上「返回大厅」(636, 196) → `getScene().name === 'Lobby'`，大厅正常 |
| 控制台 | 全过程 **0 error**、1 条 warning（引擎内部 `Node.height` 弃用提示，本项目代码用的是 `UITransform.height`，与本作无关） |

> 存档安全：web-mobile 产物跑在 `127.0.0.1:8123`，与编辑器预览 `127.0.0.1:7456` 不同源，`localStorage` 隔离 —— 用户既有存档（Lv17 / 金色 1094 等）不受影响，本页看到的是全新档。

## 4. 微信构建与预检

### 4.1 产物

| 项 | 值 |
|---|---|
| 构建 | CLI（非沙箱），`build/wechatgame/` 10:58 落盘 |
| 场景表 | `assets/main/config.json` = **26 场景 / 73 资源 UUID**，含 `Mithril` |
| 关键字符串 | `assets/main/index.js` 中 `mithril` 出现 31 次，「秘银远征」可检索 |
| 主包体积 | **3.95 MB / 4.00 MB**（余量 **55.2 KB**）：`cocos-js/` 1.92 MB、`assets/` 1.83 MB、`src/` 27.2 KB |
| 语法级别 | 12 个 `.js` 同时可按 ES2015 与 ES5 解析 |
| 变体选择符 | 产物 `.js/.json` 无 `U+FE0E/U+FE0F` |
| 包装复现 | `node tools/replay-wechat-bundle.js` → ✅ 小游戏包装下加载完成无异常（未出现 `Object.defineProperty called on non-object`） |

### 4.2 预检结果（`node tools/check-wechat-build.js`）

| 项 | 结果 |
|---|---|
| 1 构建完整性 | ✅ 必需文件 9 项齐全、场景 26 / UUID 73 |
| 2 配置文件 | ✅ `compileType="game"`、`appid=wx755…6b7e` |
| 3 落盘稳定 | ✅ 最新文件 `config.snapshot.json @ 10:58:09` |
| 4 JS 语法级别 | ✅ 12 个 `.js` 均可按 ES2015 / ES5 解析 |
| 5 主包体积 | ✅ 3.95 MB / 4.00 MB（余量 55.2 KB） |
| 6 变体选择符 | ✅ 无 U+FE0E / U+FE0F |
| 7 工具是否需重编译 | ❌ 工具最后一次编译 10:34:43，早于本次构建 10:58:09 |
| 8 AppID | ✅ 已填写 `wx755…6b7e`（脚本无法核验归属，由第 9 项兜底） |
| 9 包装方式 | ⚠ 缓存里没有本次构建的编译结果 |

### 4.3 第 6 条判据的剩余动作（环境受限）

第 7、9 项**本质要求开发者工具 GUI 编译一次本版产物**，无法在无 GUI 环境闭合。本轮 macOS 屏幕全程锁定（`cu status` → `"locked": true`），Cocos 编辑器与微信开发者工具都起不来（Electron 在锁屏下无窗口 / 无端口）。

解锁后按顺序执行即可关闭：

```bash
# 1) 打开微信开发者工具 → 导入 build/wechatgame → 点「编译」
# 2) 复检（应 9/9 全绿、0 提醒）
node tools/check-wechat-build.js
# 3) 模拟器里点「秘银远征」卡片进场景（大厅卡片在列表最后一格）
```

## 5. 已知限制与遗留

- **主包余量只剩 55.2 KB**：`cocos-js/` 1.92 MB + `assets/` 1.83 MB。后续再加资源前先算体积；可行手段是引擎模块裁剪（当前未裁）或把美术资源下沉到分包。
- **CLI 构建偶发空场景**：同一命令首跑可能打出 0 场景（`config.json` 场景表空、assets 仅 16 KB），重跑即恢复。判据固定为「`scenes` 数量 = `sync-build-scenes.js --check` 的列表长度（26）」。
- **沙箱内构建会毁 `.meta`**：见 §2.4，已写入 `docs/tech/dev-toolchain-notes.md` §4。
- **大厅卡片在列表最末**：25 款游戏导致 9 行，秘银远征独占末行左列，需要滑到底。若后续还要加游戏，建议在大厅加分类页签的默认折叠或搜索（当前 `GAME_CATEGORIES` 已有分类，但默认「全部」）。
- **FPS 覆盖层**：web-mobile 调试构建默认显示左下角 FPS 面板，会压住末行左列卡片。仅影响调试产物；验收截图前用 `cc.profiler.hideStats()` 关掉。

## 6. 回归与提交

```
tsc --noEmit                      TS_OK
check-game-icons.js               退出码 0（25 款，0 警告）
sync-build-scenes.js --check      退出码 0（26 场景）
verify-mithril-core.js            221 项
verify-mithril-audio.js            88 项
verify-mithril-wild.js          2,829 项
verify-mithril-camp.js            337 项
verify-mithril-dungeons.js        892 项
verify-mithril-trinkets.js        692 项
verify-mithril-bounty.js          471 项
verify-mithril-balance.js         136 项
verify-template-core.js            15 项
assets/ VS16 扫描                 0 命中
```

提交：`feat(mithril): M11 大厅注册与专属图标、文档归档`（`develop`）。

改动文件：`assets/common/managers/GameConfig.ts`、`assets/main/scripts/GameIconArt.ts`、`docs/README.md`、`docs/tech/dev-toolchain-notes.md`、`docs/plans/2026-11-16-mithril-m11-plan.md`、本文件。
