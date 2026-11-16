# 《秘银远征》M11 实施计划（文档 + 大厅图标 + 验收记录）

> 日期：2026-11-16 · 分支：`develop` · 前置：M10 已验收（`2026-11-16-mithril-m10-acceptance.md`，`0add810`）
> 设计规格：`docs/plans/2026-11-14-game-mithril-design.md` §11（里程碑表）
> 里程碑原文：`| **M11** | 文档 + 大厅图标 + 验收记录 | check-game-icons.js 退出码 0 |`

## 退出判据

| # | 判据 | 验证方式 |
|---|------|---------|
| 1 | 大厅注册：`GameConfig.GAME_LIST` 有 `mithril`（名称 / 场景名 / 描述 / 分类齐全） | `grep` + `check-game-icons.js` 规模行 = 25 款 |
| 2 | 专属图标：`GameIconArt.ACCENTS` 有强调色、`drawShape` 有 `case 'mithril'` | `node tools/check-game-icons.js` 退出码 **0**、0 警告 |
| 3 | 大厅可见可点：卡片渲染正常、点击进入 `Mithril` 场景、返回大厅正常 | 浏览器预览（或微信模拟器）实机点击 + 截图 |
| 4 | 图标无变体选择符、无残留 tofu 风险 | `assets/` 全量扫 `U+FE0E/U+FE0F` = 0 |
| 5 | 构建场景清单三处齐（含 Mithril） | `node tools/sync-build-scenes.js --check` 退出码 0 |
| 6 | 微信产物可开：预检 9 项全绿 + 包装复现通过 + 模拟器点进本作 | `check-wechat-build.js` + `replay-wechat-bundle.js` + 模拟器截图 |
| 7 | 回归 + 编译：8 个 mithril verify + 模板自检全绿、`tsc --noEmit` = TS_OK | 全量跑一遍 |
| 8 | 文档归档：设计 / 验收 / 试玩报告索引进 `docs/README.md` | 人工核对 |

## 子步骤

### M11.1 大厅注册（`GameConfig.ts`）

新增一行（放在列表末尾，与场景清单顺序一致）：

```ts
{ id: 'mithril', name: '秘银远征', icon: 'default', sceneName: 'Mithril',
  description: '野外远征与六座秘境，装备饰品构筑 + 营地养成', category: 'action' },
```

分类取 `action`：核心循环是节点制实时战斗，养成是长期层而非放置循环（`growth` 目前只放经营 / 肉鸽两款）。

### M11.2 专属图标（`GameIconArt.ts`）

- `ACCENTS.mithril = { main: #4338CA, soft: #E0E7FF }`：靛蓝钢色，与相邻的 `fridge`（青绿 174°）色相相距 70°+，也与 `shmup`（239°）之外的所有图标区分开。
- `drawShape` 的 `case 'mithril'`：**秘银锭**——梯形锭体（`INK` 描边）+ 内层主色 + 顶面高光，右上一大一小两组星芒呼应金属光泽；与现有 24 个图形无一同构（无梯形、无星芒组合）。
- 全部用 `moveTo/lineTo/fill/line`，无任何 emoji / 变体选择符。

### M11.3 文档归档

`docs/README.md` 新增「秘银远征（Mithril / mithril）」小节：设计总规格、M1–M10 验收表、阶段计划、第 10–19 轮试玩、8 个回归脚本。

### M11.4 验证与收尾

1. `node tools/check-game-icons.js`（退出码 0）、`tsc --noEmit`。
2. 全量回归：8 个 mithril verify + `verify-template-core.js`。
3. 构建清单同步 `--check` → 微信 CLI 构建 → `check-wechat-build.js` 9/9 → `replay-wechat-bundle.js` → 开发者工具模拟器点进本作。
4. 写 `2026-11-16-mithril-m11-acceptance.md`，提交 `feat(mithril): M11 大厅注册与专属图标、文档归档`。

## 风险

| 风险 | 应对 |
|------|------|
| 编辑器在跑时改 `profiles/` 会被内存旧值刷回 | 构建清单在编辑器关闭后由 `sync-build-scenes.js` 写盘，再 `--check` 复核 |
| 冷资产库导致构建产物场景表为空 | 构建前先让编辑器完整加载资产库，或确认 `temp/asset-db` 有 `startup-database` 计时标记 |
| 大厅图标与相邻卡片撞色 | `check-game-icons.js` 第 7 条按色相距离 ≥ 40° 兜底 |
