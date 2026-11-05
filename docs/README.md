# docs/ 文档索引

> **AI 速查**：修改代码前先读 `../AGENTS.md`，再看本索引定位相关文档。

---

## 按主题快速定位

| 你要做什么 | 先看 |
|-----------|------|
| 刚拿到项目，需要整体规范 | [`../AGENTS.md`](../AGENTS.md) |
| 写 Cocos 代码，担心崩溃 | [`cocos-best-practices.md`](./cocos-best-practices.md) |
| 修改场景/节点/MCP 操作 | [`../AGENTS.md`](../AGENTS.md) 的 **MCP 使用守则** |
| 要验证真实交互（点击/流程/报错） | [`tech/browser-verify-cocos-preview.md`](./tech/browser-verify-cocos-preview.md) |
| 写"等一会儿再做下一拍"的回合/动画链路 | [`tech/cocos-scheduler-and-tween-pitfalls.md`](./tech/cocos-scheduler-and-tween-pitfalls.md) |
| 显示 emoji/符号图标（尤其要在微信上跑） | [`tech/wechat-text-rendering.md`](./tech/wechat-text-rendering.md) |
| 构建微信小游戏、或开发者工具报编译错误 / 一打开就崩 | [`tech/wechat-build-pitfalls.md`](./tech/wechat-build-pitfalls.md) + `node tools/check-wechat-build.js`（9 项预检）+ `node tools/replay-wechat-bundle.js`（包装器复现器） |
| 新增游戏或场景 | [`../AGENTS.md`](../AGENTS.md) 的 **项目结构 + 游戏注册** |
| 查某游戏的设计/计划/场景配置 | 下文的 **按游戏分类** |

---

## 核心规范（必读）

- [`../AGENTS.md`](../AGENTS.md) — 项目总规范、红线清单、当前教训、Git 规范、MCP 守则
- [`cocos-best-practices.md`](./cocos-best-practices.md) — Cocos Creator 3.x 防崩溃详解与代码模式
- [`tech/browser-verify-cocos-preview.md`](./tech/browser-verify-cocos-preview.md) — 浏览器操作验证预览：刷新资产库、设备像素坐标、页内探针与日志取证
- [`tech/mcp-scene-authoring-pitfalls.md`](./tech/mcp-scene-authoring-pitfalls.md) — MCP 操作场景/预制体：按钮绑定类型、Button 组件、渲染组件冲突
- [`tech/cocos-scheduler-and-tween-pitfalls.md`](./tech/cocos-scheduler-and-tween-pitfalls.md) — 排期/补间陷阱：自排期回调被引擎静默丢弃、`update()` 泵 + 看门狗范式
- [`tech/wechat-text-rendering.md`](./tech/wechat-text-rendering.md) — 微信文本渲染：变体选择符 VS16 导致图标方框、图标单一来源规约
- [`tech/wechat-build-pitfalls.md`](./tech/wechat-build-pitfalls.md) — 微信小游戏构建产物：开发者工具「编译报错」的时序根因、**「能编译但一打开就崩」的包装器/项目类型根因**、日志与缓存取证、预检脚本与声明纪律
- [`tech/dev-toolchain-notes.md`](./tech/dev-toolchain-notes.md) — 文本编码（PowerShell 陷阱）、`tsc` 版本注意事项、提交前检查

---

## 按游戏分类

### 战争进化（War Evolution / war_evo）

| 类型 | 文件 | 说明 |
|------|------|------|
| 需求规格 | [`specs/2026-05-14-war-evo-requirements.md`](./specs/2026-05-14-war-evo-requirements.md) | 游戏整体需求与玩法设计 |
| 游戏设计 | [`specs/2026-05-18-game-war-evolution-design.md`](./specs/2026-05-18-game-war-evolution-design.md) | 核心玩法设计文档 |
| 实现计划 | [`plans/2026-05-18-game-war-evolution-plan.md`](./plans/2026-05-18-game-war-evolution-plan.md) | 开发计划 |
| 场景配置 | [`design/2026-05-18-war-evo-scene-setup-guide.md`](./design/2026-05-18-war-evo-scene-setup-guide.md) | WarEvo 场景搭建指南 |
| 场景配置 | [`design/2026-07-16-war-evo-enemy-evolve-notice-setup.md`](./design/2026-07-16-war-evo-enemy-evolve-notice-setup.md) | 敌方进化提示 UI 节点配置 |
| 后续迭代 | [`plans/2026-05-19-war-evo-p0-implementation.md`](./plans/2026-05-19-war-evo-p0-implementation.md) | P0 功能实现 |
| 后续迭代 | [`plans/2026-05-19-war-evo-castle-death-update.md`](./plans/2026-05-19-war-evo-castle-death-update.md) | 城堡死亡逻辑更新 |
| 后续迭代 | [`plans/2026-05-26-war-evo-combat-evo-ui-update.md`](./plans/2026-05-26-war-evo-combat-evo-ui-update.md) | 战斗与进化 UI 更新 |

### Tiny Vanguard（tiny_vanguard）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-05-28-tiny-vanguard-design.md`](./specs/2026-05-28-tiny-vanguard-design.md) | 核心玩法与系统设计 |
| P0 计划 | [`plans/2026-05-28-tiny-vanguard-p0-plan.md`](./plans/2026-05-28-tiny-vanguard-p0-plan.md) | 初期实现计划 |
| 场景配置 | [`design/2026-05-28-tiny-vanguard-scene-setup.md`](./design/2026-05-28-tiny-vanguard-scene-setup.md) | 场景搭建指南 |
| 战斗流程 | [`specs/2026-06-06-tiny-vanguard-battle-flow-design.md`](./specs/2026-06-06-tiny-vanguard-battle-flow-design.md) | 战斗流程设计 |
| 修复计划 | [`plans/2026-06-04-tiny-vanguard-logic-optimization.md`](./plans/2026-06-04-tiny-vanguard-logic-optimization.md) | 逻辑优化 |
| 修复计划 | [`plans/2026-06-06-tiny-vanguard-battle-flow-plan.md`](./plans/2026-06-06-tiny-vanguard-battle-flow-plan.md) | 战斗流程修复 |
| 修复计划 | [`plans/2026-06-06-tiny-vanguard-ui-fix-btn-battle.md`](./plans/2026-06-06-tiny-vanguard-ui-fix-btn-battle.md) | UI 按钮与战斗修复 |
| 修复计划 | [`plans/2026-06-06-tiny-vanguard-ux-improvements.md`](./plans/2026-06-06-tiny-vanguard-ux-improvements.md) | 体验优化 |
| 修复计划 | [`plans/2026-07-06-battle-fix-plan.md`](./plans/2026-07-06-battle-fix-plan.md) | 战斗系统修复 |
| 修复计划 | [`plans/2026-07-10-tiny-vanguard-fix.md`](./plans/2026-07-10-tiny-vanguard-fix.md) | 近期修复 |
| 修复计划 | [`plans/2026-07-15-tiny-vanguard-fix-all.md`](./plans/2026-07-15-tiny-vanguard-fix-all.md) | 综合修复 |
| 修复计划 | [`plans/2026-07-16-tiny-vanguard-ux-improvements.md`](./plans/2026-07-16-tiny-vanguard-ux-improvements.md) | 最新 UX 改进 |
| 手感方案 | [`plans/2026-10-18-tiny-vanguard-combat-feel.md`](./plans/2026-10-18-tiny-vanguard-combat-feel.md) | 布阵拖拽修复 + 移动/攻击/技能动画层（含逐帧实测与后续打磨项） |
| 修复计划 | [`plans/2026-10-18-tiny-vanguard-fixes.md`](./plans/2026-10-18-tiny-vanguard-fixes.md) | 四项缺陷：敌方回合卡死 / 微信图标方框 / 点自身秒结束 / 技能不可切换（含实测验收） |

### 贪吃蛇（Snake）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-05-26-game-snake-design.md`](./specs/2026-05-26-game-snake-design.md) | 玩法设计 |
| 实现计划 | [`plans/2026-05-26-game-snake-plan.md`](./plans/2026-05-26-game-snake-plan.md) | 开发计划 |
| 场景配置 | [`design/2026-05-27-snake-ui-setup-guide.md`](./design/2026-05-27-snake-ui-setup-guide.md) | UI 搭建指南 |
| 场景配置 | [`design/game_snake_joystick_setup.md`](./design/game_snake_joystick_setup.md) | 虚拟摇杆配置 |

### 2048

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-05-13-game-2048-design.md`](./specs/2026-05-13-game-2048-design.md) | 玩法设计 |
| 实现计划 | [`plans/2026-05-13-game-2048-plan.md`](./plans/2026-05-13-game-2048-plan.md) | 开发计划 |
| 场景配置 | [`design/2025-05-14-2048-ui-setup-guide.md`](./design/2025-05-14-2048-ui-setup-guide.md) | UI 搭建指南 |
| 场景配置 | [`design/2025-05-14-2048-ui-redesign.md`](./design/2025-05-14-2048-ui-redesign.md) | UI 重设计 |

### 方块坠落（Tetris）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-10-25-game-tetris-design.md`](./specs/2026-10-25-game-tetris-design.md) | 双操作模式（全屏手势 / 虚拟按键）+ 引导与提示条设计 |
| 验收报告 | [`plans/2026-10-25-game-tetris-acceptance.md`](./plans/2026-10-25-game-tetris-acceptance.md) | M8 逐项验收结论 + 微信构建预检（含阻塞项） |

### 纸牌接龙（Solitaire）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-11-01-game-solitaire-design.md`](./specs/2026-11-01-game-solitaire-design.md) | 克朗代克规则、拖拽交互、布局数字、存档与验收标准 |
| 验收报告 | [`plans/2026-11-01-game-solitaire-acceptance.md`](./plans/2026-11-01-game-solitaire-acceptance.md) | M8 逐项验收结论 + 微信构建预检（含阻塞项与空构建判据） |
| 后续排期 | [`plans/2026-11-01-next-games-roadmap.md`](./plans/2026-11-01-next-games-roadmap.md) | 接龙 P0 / 吸血鬼幸存者 lite P1 的先后顺序、MVP 边界与压测门槛 |

### 午夜幸存者（Survivor / survivor）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计（已定稿） | [`specs/2026-11-02-game-survivor-design.md`](./specs/2026-11-02-game-survivor-design.md) | 8 分钟群怪生存：4 武器 / 4 被动 / 3+2 槽、1x/2x/4x 倍速、本地局内存档、逐分钟节奏、数值与调参表、单 Graphics 性能预算与 M1/M2 双重 Go-No-Go |
| 后续排期 | [`plans/2026-11-01-next-games-roadmap.md`](./plans/2026-11-01-next-games-roadmap.md) | 纸牌接龙 P0 之后启动本作（P1）的先后顺序与压测门槛 |

### 成语填字（Idiom / idiom）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-11-05-game-idiom-design.md`](./specs/2026-11-05-game-idiom-design.md) | 交叉填字规则、候选字 + 干扰字、锁定 / 连击 / 计分、三档难度、可玩性评估与生成算法 |
| 回归自检 | [`../tools/verify-idiom-core.js`](../tools/verify-idiom-core.js) | 纯逻辑单测（24 项：词库、三档难度各 100 个种子生成、交叉 / 邻接约束、填字校验、光标前移 / 擦除回退、提示（含「提示补满带错字成语」死锁回归）、计分、存档） |

### 五子棋（Gomoku / gomoku）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-11-05-game-gomoku-design.md`](./specs/2026-11-05-game-gomoku-design.md) | 15×15 规则、人机三档 / 双人、悔棋与终局回滚、AI 剪枝与评分表、布局、浏览器复核记录（§12） |
| 回归自检 | [`../tools/verify-gomoku-core.js`](../tools/verify-gomoku-core.js) | 纯逻辑单测（24 项：四方向胜负、边界 / 长连、平局、悔棋精确还原、AI 必赢必堵 / 合法性、530 局自对弈、确定性、评分与候选点） |

### 小店日记（Idle / idle）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-11-05-game-idle-design.md`](./specs/2026-11-05-game-idle-design.md) | 点击 → 自动 → 离线三线收益、四设施 × 5 级、8 小时离线封顶、大数格式化、数值安全与验收清单 |
| 回归自检 | [`../tools/verify-idle-core.js`](../tools/verify-idle-core.js) | 纯逻辑单测（27 项：费用表、点击 / 自动 / 离线公式、8h 封顶、时间倒退、30 天模拟、10 万次操作无 NaN、大数格式化、存档往返与坏档回落） |

### 缤纷消除（Match 3 / match3）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-11-05-game-match3-design.md`](./specs/2026-11-05-game-match3-design.md) | 8×8 交换消除、四连炸弹 / 五连彩球、队列式触发扩散、重力补位与连锁计分、30 关三类目标与星级、无解自动重排、布局与验收清单 |
| 回归自检 | [`../tools/verify-match3-core.js`](../tools/verify-match3-core.js) | 纯逻辑单测（25 项：500 种子 × 4/5 色开局无三连、交换合法性与非法不改变棋盘、特殊块生成 / 触发 / 互炸不死循环、连锁计分公式、无解重排、10,000 次长跑、快照往返与坏档回落、30 关配置与星级边界） |

### 砖块远征（Brick Breaker / brick）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-10-31-game-brick-breaker-design.md`](./specs/2026-10-31-game-brick-breaker-design.md) | 玩法、数值、12 项升级、场景节点契约（含 MCP 搭建清单） |
| 场景搭建 | [`design/2026-10-31-brick-breaker-scene-setup.md`](./design/2026-10-31-brick-breaker-scene-setup.md) | 最终节点树、27 项绑定、MCP 踩坑、`?scene=` 预览技巧与浏览器实测清单（含界面截图） |
| 回归自检 | [`../tools/verify-brick-core.js`](../tools/verify-brick-core.js) | 纯逻辑单测（50 项：碰撞/反射/炸弹/升级/激光/120 秒自动游玩） |

### 合合大作战（Merge / merge）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-10-31-game-merge-design.md`](./specs/2026-10-31-game-merge-design.md) | 坐标系、11 级水果、自研圆形求解器参数、「停在警戒线上方」判负、场景节点树 |
| 场景搭建 | [`design/2026-10-31-merge-scene-setup.md`](./design/2026-10-31-merge-scene-setup.md) | **实建节点树（含 UUID/坐标）**、19 项绑定、MCP 执行顺序、读回核对、浏览器实测结果、编辑器丢场景的真因与恢复 |
| 回归自检 | [`../tools/verify-merge-core.js`](../tools/verify-merge-core.js) | 纯逻辑单测（12 项：叠放稳定性、合并/禁链式、确定性、失败判定、500 次长跑） |

### 数值冲刺（Gate Runner / gate_runner）

| 类型 | 文件 | 说明 |
|------|------|------|
| 游戏设计 | [`specs/2026-11-01-game-gate-runner-design.md`](./specs/2026-11-01-game-gate-runner-design.md) | 单资源（人数=火力=血条）、门模板与 `from` 曲线、对拼公式、敌人/Boss 曲线、与草案的 8 处差异 |
| 场景搭建 | [`design/2026-11-01-gate-runner-scene-setup.md`](./design/2026-11-01-gate-runner-scene-setup.md) | **实建节点树（含 UUID/坐标）**、19 项绑定、`ClipLayer`+`cc.Mask` 修「敌人画到 HUD 上」、浏览器实测清单 |
| 设计草案 | [`plans/2026-10-31-gate-runner-design-draft.md`](./plans/2026-10-31-gate-runner-design-draft.md) | 开工前的一页纸（以定稿规格为准，差异表见定稿 §9） |
| 回归自检 | [`../tools/verify-gate-core.js`](../tools/verify-gate-core.js) | 纯逻辑单测（14 项：门只触发一次、对拼公式、生成确定性与合法性、180 s 自动游玩、平衡性、集火、完美连击） |

### 大厅与整体

| 类型 | 文件 | 说明 |
|------|------|------|
| 整体设计 | [`specs/2026-05-12-tiny-games-design.md`](./specs/2026-05-12-tiny-games-design.md) | 小游戏集合整体设计 |
| 大厅设计 | [`specs/2026-05-12-phase1-lobby-design.md`](./specs/2026-05-12-phase1-lobby-design.md) | 第一阶段大厅设计 |
| 大厅排版 | [`design/2026-11-01-lobby-scroll-grid.md`](./design/2026-11-01-lobby-scroll-grid.md) | 重叠/超出的三个根因、**由内向外**逐层刷新的顺序、`scrollHint` 判据、卡片文案与配色的运行时收敛 |
| 大厅计划 | [`plans/2026-05-12-phase1-lobby-plan.md`](./plans/2026-05-12-phase1-lobby-plan.md) | 大厅实现计划 |
| 路线图 | [`plans/2026-10-31-next-games-roadmap.md`](./plans/2026-10-31-next-games-roadmap.md) | 第 6–8 款：砖块远征 → 合成大西瓜 → 数值门跑酷（三款均已可玩） |
| 品类盘点 + 路线图 | [`plans/2026-11-05-game-catalog-and-roadmap.md`](./plans/2026-11-05-game-catalog-and-roadmap.md) | 12 款现有游戏的品类覆盖、8 个缺口评分，下一批 8 款（P0 成语填字 ✅ / 五子棋 ✅ → P1 放置经营 / 三消 / 塔防 → P2 台球 / 推箱子 / 节奏）的实现计划与排期 |
| 物理方案评估 | [`plans/2026-10-31-merge-physics-evaluation.md`](./plans/2026-10-31-merge-physics-evaluation.md) | 合成大西瓜：自研圆形求解 vs Box2D，含求解器设计与 12 项验收 |

---

## 目录说明

- `specs/` — 游戏设计规格、需求文档
- `plans/` — 实现计划、修复计划、迭代任务
- `design/` — 场景搭建、UI 配置、组件绑定指南
- `tech/` — 技术决策与验证手册（如 `browser-verify-cocos-preview.md`）
- `assets/` — 文档配图

---

## 维护提示

- 新增文档请按 `<YYYY-MM-DD>-<scope>-<topic>.md` 命名
- 临时 artifact 文件不要直接放 `docs/` 根目录，应归类到对应 `specs/` / `plans/` / `design/`
- 修改 AGENTS.md 的“当前教训”时，保留最近 3-5 条高价值教训，过旧的迁移到 `tech/` 或 `cocos-best-practices.md`
