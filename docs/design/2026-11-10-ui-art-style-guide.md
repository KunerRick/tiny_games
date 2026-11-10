# 全站 UI / 图标美术规范

> 2026-11-10 立稿。起因：大厅里 `wordle / bubble / sokoban / shmup / thunder / fridge`
> 六款游戏没在图标库里登记，全部落回「兜底问号」，在 24 张卡片里肉眼很难发现。
> 本文把「美术风格怎么统一」从口头约定变成**可执行的三件事**：令牌、图标登记表、自检命令。

---

## 0. 一页速查

| 我要做什么 | 看哪里 / 跑什么 |
|-----------|----------------|
| 改游戏内面板、按钮、文字 | 用 `assets/common/ui/UITheme.ts` 的令牌 + `GameUIKit.ts` 的画法，不写魔法 RGB |
| 给老场景（编辑器里手摆的节点）换皮 | `assets/common/ui/SceneSkin.ts`（`skinCard` / `skinButton` / `skinBackButton`） |
| 新增游戏的大厅图标 | `assets/main/scripts/GameIconArt.ts` 补 `ACCENTS` + `drawShape` case |
| 确认没有游戏漏图标 | `node tools/check-game-icons.js`（退出码 0 = 全站 24 款都有专属图标） |
| 图标字符串（emoji/符号）进 Label | 先过 `stripVariationSelectors()`（红线 10） |

---

## 1. 资产分层：一套令牌，两类界面

```
assets/common/ui/
├── UITheme.ts     ← 设计令牌（唯一权威来源）：COLOR / ALPHA / FONT_* / SPACE / CONTROL / PANEL / CANVAS
├── GameUIKit.ts   ← 构件与画法：createButton / drawFrame / drawBackSkin / makeMedallion / toast …
└── SceneSkin.ts   ← 老场景运行时换皮：skinCard / skinButton / skinBackButton / paintLabel / addDialogBackdrop
assets/main/scripts/
├── GameIconArt.ts ← 大厅图标登记表：ACCENTS（每款的主/次强调色）+ drawShape（每款的专属图形）
└── GameIcon.ts    ← 卡片装配：150×180 卡片、8 色底色轮转、名称文字、点击缩放
```

全站只有**两套视觉语言**，这是有意的：

| | 大厅（`Lobby.scene`） | 游戏内（各游戏场景） |
|---|---|---|
| 基调 | **浅色卡片货架**：识别优先 | **深色科技**：内容优先、沉浸 |
| 底色 | 8 色马卡龙轮转（`GameIcon.CARD_COLORS`） | `COLOR.BG_SCENE` `#0B1220` 系列 |
| 前景 | 深墨剪影 `INK #2B3550` + 强调色 | 浅色文字 `COLOR.TEXT_PRIMARY #F3F4F6` + 语义强调色 |
| 图标 | 程序化 Graphics 剪影 | 同样只用 Graphics / Label，不用位图 |
| 交界 | —— | 返回大厅的按钮统一为 `drawBackSkin` 圆盘 + `‹` |

**为什么大厅不复用游戏内的 `#0B1220` 深底？** 大厅是「挑游戏」的界面，
需要弱对比、低刺激，让 24 张卡片各自可辨；游戏内是「玩」的界面，需要深底衬托战斗信息。
两套语言的分界点只有一个：**进入 / 离开游戏的按钮**，两端都用同一个圆盘返回键。

---

## 2. 游戏内 UI：令牌优先

### 2.1 颜色（`UITheme.COLOR`）

| 令牌 | 值 | 用途 |
|------|-----|------|
| `BG_OVERLAY` | `#000000` | 全屏遮罩（配 `ALPHA.BG_OVERLAY` 180） |
| `BG_SCENE` | `#0B1220` | 场景/相机清屏色 |
| `PANEL_BG` | `#1E2430` | 面板底 |
| `SURFACE` | `#263041` | 列表行 / 卡片底 |
| `PANEL_BORDER` | `#3A4658` | 面板描边 |
| `PRIMARY` / `PRIMARY_DARK` | `#3B82F6` / `#2563EB` | 主操作（继续 / 确认） |
| `SUCCESS` / `DANGER` | `#22C55E` / `#EF4444` | 成功回血 / 敌人伤害 |
| `WARNING` / `INFO` / `PASSIVE` | `#F59E0B` / `#06B6D4` / `#A855F7` | 奖励 / 能量技能 / 被动与次强调 |
| `TEXT_PRIMARY` / `SECONDARY` / `DISABLED` | `#F3F4F6` / `#9CA3AF` / `#6B7280` | 三档文字 |

规则：

1. **新代码只用 `COLOR.*`**；`UI.*` 是 9 款老游戏的简写色板，取值刻意冻结，迁移完再收缩。
2. 需要 `Color` 实例时用 `hex(COLOR.X)` 新取一个（`Color` 是可变 ValueType，别共享）。
   取色一律走 `UITheme.hex()`，**不要在各游戏里再抄一份 `function hex()`**。
3. 透明度走 `ALPHA.*` / `hex(x, alpha)`，别再散落 180 / 220 / 245 这种数字。
4. **游戏身份色放该游戏的配置里**（`SurvivorConfig.COLORS`、`FridgeConfig.PAL`，只放十六进制字符串，
   配置不 import `cc` 才能被自检脚本直接编译），渲染层 `hex(COLORS.x, alpha)` 取值；
   业务代码里不再出现 `new Color(r, g, b, a)` 字面量。
   判据：通用界面（文字三档 / 面板底 / 遮罩）用令牌，**玩法身份色**（主角奶油黄、敌人豌豆绿、
   冰蓝强调色这类）才留在游戏调色板里。

### 2.2 字号与间距（`UITheme`）

- 字号必须成对用 `FontToken`：`FONT_DISPLAY 40/56`、`FONT_TITLE 28/40`、`FONT_BODY 20/28`、
  `FONT_CAPTION 16/22`、`FONT_TINY 13/18`、`FONT_ICON 32/40`；硬约束 `lineHeight ≥ fontSize × 1.2`。
- 间距以 8 为基准：`SPACE.XS 4 / SM 8 / MD 16 / LG 24 / XL 32`。
- 控件尺寸：按钮高 48、列表行 64、三选一卡片 180×260、面板宽 640 圆角 16。

### 2.3 图标

- 游戏内「图标」要么是 Graphics 画的图形，要么是**去掉变体选择符后**的 emoji。
  后者一律 `stripVariationSelectors()`（红线 10，否则微信字体渲染成方框）。
- 能用 Graphics 画就别用 emoji：emoji 在不同机型上的字形与基线不可控。

### 2.4 已知偏差（不影响当前可玩）

| 游戏 | 偏差 | 现状 |
|------|------|------|
| `tetris` | 自带 `TetrisSkin.ts` 一整套皮肤（历史原因），不走 `GameUIKit` | 保持；返回键已按约定例外（`BackButton` 检测到自带 Graphics 不再叠皮） |
| `survivor` / `fridge` | 玩法身份色不入 `COLOR` 令牌 | **已收敛**（2026-11-10）：身份色集中到 `SurvivorConfig.COLORS` / `FridgeConfig.PAL`，取色一律走共享 `hex()`；文字三档与面板底改用 `COLOR.*`。生产代码里已无 `new Color(r,g,b,a)` 字面量 |

---

## 3. 大厅图标：登记表 + 画法

### 3.1 卡片规格（`GameIcon.ts`）

- 卡片 **150×180**，圆角 22，浅色底 + 一圈 `rgba(255,255,255,0.35)` 内高光。
- 卡片底色 8 色轮转，按 **`GAME_LIST` 序号取色**（不是哈希）：
  相邻卡片保证不同色；超过 8 款后颜色会复用，**靠专属图标区分**。
- 游戏名：卡片内底部 `y = -58`，字号 24，颜色 `INK`，不带描边。
- 图标绘制区：**`x ∈ [-46, 46]`、`y ∈ [-20, 56]`**（卡片局部坐标，原点在中心）。

### 3.2 四色法

每个图标只用四种颜色：

| 角色 | 取值 | 说明 |
|------|------|------|
| 墨色 `INK` | `#2B3550` | 主剪影，占 60% 以上 |
| 纸白 `PAPER` | `#FFF9F0` | 反白细节（挖空、高光） |
| 主强调 `main` | 每款一个，见下表 | 玩法核心那一个元素 |
| 次强调 `soft` | 每款一个 | 少量点缀，同一色相更亮的一档 |

经验：`main` 取 Tailwind 600 档、`soft` 取 300 档，浅底上清楚又不刺眼。
**主色允许复用**（`#2563EB` 同时用在小小先锋与数独），但
**`(main, soft)` 组合与剪影必须唯一** —— 前者由自检脚本把关，后者靠评审。
次强调色可以跳色相（如 `match3` 用青色 `#2DD4BF` 点缀粉色主色）。

### 3.3 图形规则

1. **画玩法，不画名字**：图形要能让人不看名字猜到玩法（冰箱 → 双门冰箱；成语猜猜 → 一绿一黄的字格）。
2. **剪影唯一**：两个游戏不能都是「一个圆 + 一条线」；轮廓在 8 米外也应能区分。
3. **纯 Graphics，零贴图**：不引 PNG/SVG，`drawShape` 里只用 `roundRect / circle / triangle / line / moveTo`。
4. **不放文字**：图标里不写汉字/数字（字在卡片底部已有）。
5. **不落兜底**：`default` 分支只做防崩兜底（问号），**任何在册游戏都不允许走到它**。

### 3.4 现有 24 款一览（`ACCENTS`）

| id | main | soft | 图形 |
|----|------|------|------|
| `2048` | `#E07A3F` | `#F7C47A` | 2×2 数字块，右下高亮 |
| `war_evo` | `#C0392B` | `#EF9A76` | 相对推进的两支箭头 |
| `snake` | `#0E9F6E` | `#6EE7B7` | 折线蛇身 + 蛇头 |
| `tiny_vanguard` | `#2563EB` | `#93C5FD` | 盾牌 + 内嵌菱形 |
| `tetris` | `#7C3AED` | `#C4B5FD` | T 形方块 + 下落方块 |
| `brick` | `#D97706` | `#FCD34D` | 三排错缝砖 + 球 |
| `merge` | `#DB2777` | `#F9A8D4` | 三个越滚越大的球 |
| `gate_runner` | `#0891B2` | `#67E8F9` | 数值门 + 穿门箭头 |
| `solitaire` | `#B91C1C` | `#FECACA` | 叠放纸牌 + 菱形花色 |
| `survivor` | `#7C3AED` | `#D8B4FE` | 准星 |
| `minesweeper` | `#DC2626` | `#FECACA` | 小旗 |
| `sudoku` | `#2563EB` | `#BFDBFE` | 九宫格 + 已填格 |
| `idiom` | `#B45309` | `#FDE68A` | 十字填字格 |
| `gomoku` | `#1F2937` | `#94A3B8` | 棋盘 + 斜向五连 |
| `idle` | `#059669` | `#A7F3D0` | 条纹雨棚 + 店门 |
| `match3` | `#DB2777` | `#2DD4BF` | 圆 / 菱 / 三角三颗宝石 |
| `tower_defense` | `#475569` | `#94A3B8` | 城垛塔楼 + 旗 |
| `pool` | `#065F46` | `#34D399` | 三角球架 + 三颗球 |
| `wordle` | `#16A34A` | `#FACC15` | 一绿一黄字格 + 输入行 |
| `bubble` | `#0369A1` | `#7DD3FC` | 泡泡串 + 向上炮口 |
| `sokoban` | `#92400E` | `#FB923C` | 打叉木箱 + 目标格 + 小人 |
| `shmup` | `#6366F1` | `#A5B4FC` | 战机 + 两路弹幕 + 敌弹 |
| `thunder` | `#EAB308` | `#FFEDA0` | 闪电 + 机翼 |
| `fridge` | `#0D9488` | `#99F6E4` | 冰箱双门 + 把手 + 底部透光缝 |

---

## 4. 新增游戏：四步 + 一次自检

在原有「注册 / 建场景 / 对齐 sceneName」三步之外，**第 4 步是图标**：

1. `assets/common/managers/GameConfig.ts` 的 `GAME_LIST` 注册（id / name / sceneName / description）；
2. 建 `assets/games/game_xxx/scenes/Xxx.scene`，场景名与 `sceneName` 一致；
3. 游戏内 UI：引 `UITheme` 令牌 + `GameUIKit` 画法（老场景用 `SceneSkin` 换皮）；
4. 大厅图标：`GameIconArt.ts` 补 `ACCENTS[id] = { main, soft }` + `drawShape` 里补 `case 'id':`，
   图形符合 §3.2 / §3.3。

验证：

```bash
node tools/check-game-icons.js          # 退出码 0 = 24 款全覆盖；新增游戏后必须重跑
TSC="/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc"
node "$TSC" --noEmit                    # 编译通过
```

然后在浏览器预览里打开大厅，**上下滑动看一遍**：新卡片与左右邻居的底色、剪影、主色都要能一眼分开。

---

## 5. 自检脚本的边界（别把它当万能）

`tools/check-game-icons.js` 只能保证**登记表齐**：

| 能拦住 | 拦不住 |
|--------|--------|
| 新游戏漏登记 → 落兜底问号（正是这次的事故） | 两个图标画得「撞脸」（剪影相似） |
| `GAME_LIST` 删了游戏、图标库留僵尸条目 | 颜色在浅底上对比不足 |
| 两款游戏 `(main, soft)` 完全相同 | 图形超出绘制区、压住名称 |
| 图标库混入变体选择符（红线 10） | 布局在真机/微信上的实际观感 |

所以「登记表齐」之后，**必须再看一眼真实画面**（浏览器预览 + 微信模拟器），
两者都过才算完成。

---

## 6. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-11-10 | 六款新游戏（wordle / bubble / sokoban / shmup / thunder / fridge）补齐专属图标；新增 `tools/check-game-icons.js`；本文立稿 |
| 2026-11-10 | `survivor` / `fridge` 内联 RGB 收敛：身份色集中到 `SurvivorConfig.COLORS` / 新增 `FridgeConfig.PAL`，取色统一走 `UITheme.hex()`，文字与面板底改用 `COLOR.*`；补上「游戏身份色放哪」的规则（§2.1 第 4 条） |
