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

### 大厅与整体

| 类型 | 文件 | 说明 |
|------|------|------|
| 整体设计 | [`specs/2026-05-12-tiny-games-design.md`](./specs/2026-05-12-tiny-games-design.md) | 小游戏集合整体设计 |
| 大厅设计 | [`specs/2026-05-12-phase1-lobby-design.md`](./specs/2026-05-12-phase1-lobby-design.md) | 第一阶段大厅设计 |
| 大厅计划 | [`plans/2026-05-12-phase1-lobby-plan.md`](./plans/2026-05-12-phase1-lobby-plan.md) | 大厅实现计划 |

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
