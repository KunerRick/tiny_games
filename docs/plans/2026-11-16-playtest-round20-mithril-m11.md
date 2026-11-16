# 《秘银远征》第 20 轮试玩报告（M11 · 发布前构建产物冒烟）

> 日期：2026-11-16 · 游戏：`mithril` · 场景：`Mithril`
> 试玩者：fresh 子代理（独立试玩者，非开发者）。**所有结论来自真实鼠标操作 + 只读页内探针**；未改任何 `.ts` / 场景 / 配置 / 存档，未直接写 `localStorage`，未调用会改状态的组件方法。
> 范围：**已构建的 web 产物**（`build/web-mobile`），不是编辑器预览。冒烟 6 项，见 §2。

## 0. 环境说明（与常规轮次不同）

| 项 | 值 |
|---|---|
| 入口 | `build/web-mobile` + `python3 -m http.server 8127` → `http://127.0.0.1:8127/index.html` |
| 编辑器 / MCP | Cocos 编辑器不可用（macOS 屏幕锁定），**未**连接 7456 预览、**未**调用 Cocos MCP |
| 视口 | `browser_resize` 720 × 1280；`window.innerWidth/Height = 720/1280` |
| `devicePixelRatio` | **1** |
| canvas | 绘制缓冲 `720 × 1280`；CSS rect `{left:0, top:0, w:720, h:1280}`，无偏移、无缩放 |
| 坐标口径 | **`cssX = worldX`，`cssY = 1280 − worldY`**（dpr=1，CSS 像素即设备像素） |
| 点击方式 | Playwright `page.mouse.click / move / down / up`（真实鼠标事件）；坐标即 CSS 像素 |
| 探针 | `node.worldPosition`、`UITransform.getBoundingBoxToWorld()`、`cc.Label.string`、`node.activeInHierarchy`、`MithrilGame.debugSnapshot()`（只读快照）、`node.hasEventListener()`、`localStorage` 只读 |
| 只读注入 | 在 `Canvas` 与 `Skill_basic` 上挂 `TOUCH_START/END` 计数器（只记录，不改状态） |
| Profiler | 只调用 `cc.profiler.hideStats()`；**未**调用 `hide()` |
| 状态改动 | 只通过真实点击（大厅卡、职业卡、以战士开局、开始远征、路线图节点、技能键按住、死亡面板返回大厅、2048 卡） |

## 1. 结论

**P0 = 0 · P1 = 0 · P2 = 0 · P3 = 0。**

6 个必测点全部通过：大厅 25 张卡与标题正常、最后一行只有「秘银远征」且图标为靛蓝梯形锭 + 顶面高光 + 两组星芒；真实点击该卡进入 `Mithril` 职业选择（战士/法师/游侠/牧师 + 以战士开局）；开局后进入路线图，节点可点，进入战斗后 HUD（技能键、血条、资源条）齐全；按住技能键能施放并真实改变敌我血量（玩家 60→8，小怪 66→5.2，`冲` 命中后 61.8→41.7）；从场景内「返回大厅」回到 `Lobby`，再进 2048 仍正常加载；全程 console 除 favicon 404 外 0 error。

> 编号使用：**N61 及以后未占用**（本轮未复现任何缺陷）。

## 2. 覆盖清单

### 2.1 大厅渲染与卡片数

- `cc.director.getScene().name = "Lobby"`。
- `title` 的 `cc.Label.string = "Tiny Games 游戏大厅"`。
- `allGamesSection/allGamesGrid` 子节点数 = **25**，每张为 `GameIcon`（含 `Art` / `Shape` / `nameLabel`）。
- `ScrollView.scrollToBottom(0)` 后，最后一行（世界 y = 154）只有 1 张卡：索引 24、`nameLabel = "秘银远征"`、世界坐标 `(165, 154)` → CSS **`(165, 1126)`**（与任务书示例一致）。
- 截图：`.playwright-mcp/r20-01-lobby-bottom-clean.png`（隐藏 FPS 统计后）。

**结论：通过。**

### 2.2 秘银远征图标

- 真实截图目视：卡片为**靛蓝/紫色梯形锭**，顶面有一条**浅色高光**，左右上方各**一组 4 角星芒**；不是默认问号，也不是其它游戏图形。
- `Art` / `Shape` 节点均为 `Graphics` 绘制（无 Sprite），与全站图标规范一致。
- 截图：`.playwright-mcp/r20-01-lobby-bottom-clean.png`。

**结论：通过。**

### 2.3 真实点击 → 场景 Mithril → 职业选择

- 操作：`page.mouse.click(165, 1126)`，等待 2.5 s。
- 结果：`scene = "Mithril"`；`ClassSelect.activeInHierarchy = true`。
- 面板文案/元素（世界坐标 → CSS）：
  - 标题「选择职业」；
  - `ClassCard_warrior`「战士 / 近战 · 重甲 / 资源：怒气 / 已选中」；
  - `ClassCard_mage`「法师 / 远程 · 法术 / 资源：法力 / 点击选择」；
  - `ClassCard_ranger`「游侠 / 远程 · 物理 / 资源：能量 / 点击选择」；
  - `ClassCard_priest`「牧师 / 远程 · 治疗 / 资源：法力 + 圣能 / 点击选择」；
  - 按钮`「以战士开局」`，包围盒中心 CSS **`(360, 970)`**；
  - 右上「返回大厅」CSS `(628, 194)`。
- 截图：`.playwright-mcp/r20-02-class-select.png`。

**结论：通过。**

### 2.4 开局 → 路线图 → 战斗

- 操作：真实点击「以战士开局」`(360, 970)` → `WildMap.activeInHierarchy = true`。
- 路线图读数：标题「野外 · 灰烬荒原」；「生命 60/60」「补给 3/3」；12 个节点（起点 / 战斗 / 精英 / 事件 / 篝火 / 宝箱 / 副本 / 首领），节点均 active。
- 真实点击「开始远征」`(122, 1196)` → 标签变为「灰烬 ×0（本程 0）」，远征开始。
- 真实点击第一个战斗节点 `Wild_1`（CSS `(250, 347)`）→ `HUD.activeInHierarchy = true`、`Field.activeInHierarchy = true`、`WildMap` 隐藏；`debugSnapshot()`：`phase = playing`、`stage = encounter`、`encounterName = 第一波`、玩家 `hp 60/60`、3 只「矿坑小鬼」各 `66/66`。
- HUD 实测：
  - 「Lv 1　生命 60 / 60」（红色血条）、「怒气 0 / 100」（橙色资源条）；
  - 「遭遇 1/3」「灰烬荒原 · 战斗 0:0x 击杀 0」；
  - 技能键 6 个：斩 `(582,1172)`、冲 `(492,1000)`、旋 `(470,1092)`、破 `(460,1184)`、闪 `(670,988)`、怒 `(660,1092)`；
  - 左上返回键 `(58, 62)`。
- 截图：`.playwright-mcp/r20-03-wildmap.png`、`.playwright-mcp/r20-04-battle-hud.png`。

**结论：通过（节点可点、HUD 齐全）。**

### 2.5 技能真实生效 / 敌我血条变化

先做输入归因：在 `Skill_basic` 上挂只读计数器后，真实点击 `(582,1172)` 时 `TOUCH_START/END` 均到达该节点，`getUILocation = (582,108)` 与节点世界中心一致；但 `page.mouse.click`（同一帧内 down+up）不产生施法（`cd.basic = 0`、`swingCount = 0`）。改为**按住 350 ms 再抬起**后全部生效。读数如下（同一场战斗，均来自 `debugSnapshot()`）：

| 操作（真实按住） | 读数 |
|---|---|
| 等敌人接近到 139–164 px，按住「斩」350 ms | `cd.basic = 0.169`、`swingCount = 1`；敌人仍 66（尚未进入近战命中距离） |
| 按住「旋」350 ms | `cd.whirlwind = 9.36` |
| 按住「闪」220 ms | `cd.dodge = 5.59`；玩家后撤，敌人距离 92 → 339；`hp` 保持 60 |
| 按住「怒」350 ms（怒气 3） | **未触发**（`cd.burst = 0`，资源不足，符合设计） |
| 按住「冲」350 ms | `cd.charge = 7.39`；敌人血量 **61.8 → 41.7**（命中） |
| 连续 4 次按住「斩」400 ms | 玩家 `hp 60 → 14 → 12 → 10 → 8`；小怪 `66 → 37.6 / 57.7 / 46.3 → 34.9 → 23.4 → 5.2`；HUD 文字同步刷新（「生命 14/60」等） |

- 结果：玩家在 **20.45 s** 于「第一波」阵亡（`phase = dead`，`kills = 0`，一只小怪剩 5.2 血）。死亡面板出现：「你倒下了」+ 用时/击杀/推进度/收益 +「远征失败：本程材料已丢失」+ 按钮「返回路线图 / 成长 / 装备 / 返回大厅」。
- 存档侧确认死亡结算：`tiny_games_mithril_save` 中 `expedition = null`，与面板文案一致。
- 截图：`.playwright-mcp/r20-05-battle-dead.png`。

**结论：通过（能施放、敌我血条都变化；阵亡与结算正常，未卡死）。**

### 2.6 返回大厅 + 回归另一款游戏

- 真实点击死亡面板「返回大厅」`(537, 830)` → `scene = "Lobby"`。
- 大厅仍为 25 张卡；`scrollToTop(0)` 后点击 `2048` 卡（索引 0，CSS `(165, 895)`）→ `scene = "Game2048"`。
- 2048 读数：「2048 / 设置 / 分数 0 / 最高分 0 / 新游戏 / 撤销 / 滑动屏幕合并相同数字 · 凑出 2048」，棋盘 4×4 已生成两个「2」，渲染正常。
- 截图：`.playwright-mcp/r20-06-2048.png`。

**结论：通过（大厅 25 卡未被破坏，其它游戏可正常加载）。**

### 2.7 控制台

- `browser_console_messages(level:'error')`：**33 条消息，1 条 error，0 warning**；唯一 error 为 `favicon.ico` 404（任务书允许）。
- 战斗、死亡、两次场景切换、进入 2048 期间均无新增 error。

**结论：通过。**

## 3. 问题清单（机读区）

| ID | 级别 | 游戏 | 入口 | 现象 | 复现 | 期望 | 证据 |
|----|------|------|------|------|----------|------|------|
| （无） | — | mithril / lobby | 大厅 → 秘银远征 → 战斗 → 返回大厅 → 2048 | 本轮无 P0/P1/P2/P3 | 见 §5 | — | §2 探针读数；`.playwright-mcp/r20-00`…`r20-06` |

> N61 及以后编号未占用。

## 4. 未复现 / 已排除的疑点

1. **「鼠标单击技能键没反应」**：`page.mouse.click` 的 down/up 落在同一帧，游戏按帧轮询 `held`（HUD 在 `TOUCH_START` 置位、`TOUCH_END` 清零），因此单击不施法。只读计数器证明触摸事件确实到达 `Skill_basic`（`getUILocation = (582,108)`），按住 350 ms 后全部技能正常。触摸设备上按下/抬起天然跨帧，**不计缺陷**；桌面 QA 需用「按住」而非「单击」。
2. **「第一次进战斗 0 伤害」**：技能冷却正常进入（`cd.basic = 0.169`、`swingCount = 1`），只是敌人尚在 139 px 外、近战未命中；贴脸后同一技能立即扣血。**不是输入失效**。
3. **「死亡时 0 击杀」**：本轮为冒烟，站桩只按普攻、未用摇杆走位，3 只 Lv3 小怪持续接触伤害将 60 血打空；死亡结算与文案完整。属难度/操作结果，非缺陷。
4. **FPS 面板遮挡最后一张卡**：构建内置 Profiler 覆盖左下角，仅影响观察；`hideStats()` 后卡片完整可点。属调试覆盖层，非游戏缺陷。

## 5. 复现配方（最小步骤）

1. `cd build/web-mobile && python3 -m http.server 8127`；浏览器 720 × 1280 打开 `http://127.0.0.1:8127/index.html`。
2. 等大厅加载；`cc.profiler.hideStats()`；`ScrollView.scrollToBottom(0)` 后点 `(165, 1126)`。
3. 场景变 `Mithril` 后点 `(360, 970)`「以战士开局」。
4. 点 `(122, 1196)`「开始远征」，再点 `(250, 347)` 第一个战斗节点。
5. 等约 3 s 让敌人贴近，`mouse.move(582,1172)` + `down()` + 等 350 ms + `up()` 反复普攻；可再按住「旋」`(470,1092)`、`闪` `(670,988)`、`冲` `(492,1000)`。
6. 死亡面板点 `(537, 830)`「返回大厅」；回大厅后点 2048 卡 `(165, 895)` 验证回归。

## 6. 结束状态

| 项 | 值 |
|---|---|
| 最终场景 | **`Game2048`**（2048 棋盘已初始化，两个「2」；`tiny_games_2048_data` 已落盘） |
| 秘银存档 | `tiny_games_mithril_save` 625 字节，`v = 2`，`classId = warrior`，`level 1 / exp 0 / gold 0`，`expedition = null`（阵亡清空本程） |
| 秘银其它键 | `tiny_games_mithril_seen_tutorial = "1"` |
| 用户数据 | `tiny_games_user_data = {"recentGames":["2048","mithril"]}` |
| console | 33 条消息 / **1 error（仅 favicon 404）** / 0 warning |
| 浏览器 | 已 `browser_close` |
| 8127 服务 | 已 kill（`lsof -nP -iTCP:8127 -sTCP:LISTEN` 无输出） |

**截图**：`.playwright-mcp/r20-00-lobby-bottom.png`、`r20-01-lobby-bottom-clean.png`、`r20-02-class-select.png`、`r20-03-wildmap.png`、`r20-04-battle-hud.png`、`r20-05-battle-dead.png`、`r20-06-2048.png`。
