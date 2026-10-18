# 微信小游戏文本渲染：变体选择符（VS16）与图标方框

> **适用**：任何把 emoji / 符号写进 `Label.string` 的地方（职业图标、技能图标、路线图节点、
> 升级卡文案）。
> **来源**：Tiny Vanguard 微信实测「战士图标右侧一个小方框；部署卡片有、拖到地图上反而没有」
> （本项目，修复见 commit `aceaf9a`）。速查版见 [`../../AGENTS.md`](../../AGENTS.md) 的**红线清单**。

---

## 1. 现象与判据

| 现象 | 说明 |
|------|------|
| 图标右侧多一个**小方框** | 方框就是"字形缺失"的 tofu；它**不是**文字的一部分，是那个不可见字符被单独渲染 |
| 同一个图标**有的地方正常、有的地方出框** | 说明两处的字符串**不是同一个码点序列** —— 出框的那份多了变体选择符 |
| 桌面预览 / 浏览器一切正常 | 桌面字体通常有 emoji 变体字形；微信字体缺，**只在真机暴露** |

## 2. 根因：VS16 让同一个图标变成两个码点序列

`U+FE0F`（VS16，emoji 呈现）与 `U+FE0E`（VS15，文本呈现）是**不可见的**变体选择符：

```
⚔️  =  U+2694 U+FE0F     ← 带 VS16，字体缺该变体字形时只渲染出一个 tofu 方框
⚔   =  U+2694            ← 不带，落到基本字形
```

两者视觉效果几乎一样，肉眼、diff、审查都发现不了 —— 唯一的判据是**码点**：

```bash
grep -rlP '[\x{fe0f}\x{fe0e}]' assets/    # 有输出 = 有残留
```

本项目触发它的直接原因是**两张分叉的图标表**：`config/GameData.ts` 的
`CLASSES[].icon` 写的是带 VS16 的 `⚔️`，而 `battle/UnitController.ts` 自带一份
`CLASS_ICONS` 常量表，写的是不带 VS16 的 `⚔`。
于是**部署槽卡**（读前者）出方框，**地图上的单位**（读后者）正常 ——
"拖上去反而好了"这个诡异现象就是这么来的。

## 3. 修复：单一来源 + 出站消毒

### (a) 图标只有一个来源

删掉 `UnitController.CLASS_ICONS`，`setupClassIcon()` 统一取
`getClassById(classId)?.icon`（`config/GameData.ts` 为唯一真源）。
查不到的职业（敌人 `swordsman` / `elite_*` / `war_lord`）继续早退 —— **敌人本来就没有职业图标，
不要顺手补**。

顺带把语义收敛进 `GameData`：`⚔️ → ⚔`；牧师 `💚` → `✝`（绿心读起来像「回血」，
且地图上一直是十字，统一后**可见变更**，是刻意的；`CLASS_COLOR.cleric` 不受影响）。

### (b) 消毒函数：写进 `Label` 前一律过一遍

`config/Theme.ts`：

```ts
/**
 * 去掉变体选择符：U+FE0E（文本呈现）/ U+FE0F（emoji 呈现），两个都不可见。
 * 字体缺 VS16 字形时会把那个不可见字符渲染成一个方框（tofu）。
 * 所有要显示为图标的字符串，写进 Label.string 之前一律先过这里。
 */
export function stripVariationSelectors(text: string): string {
  if (!text) return text;
  // 用码点转义而不是字面量：这两个字符在编辑器里不可见，写成字面量以后没人能维护
  return text.replace(/[\uFE0E\uFE0F]/g, '');
}
```

当前挂载点（**新增图标显示位时照抄这个清单**）：

| 文件 | 位置 | 用途 |
|------|------|------|
| `battle/UnitController.ts` | `setupClassIcon` | 棋盘单位图标 |
| `ui/BattleUI.ts` | 拖拽幽灵 | 拖拽中跟随手指的副本 |
| `ui/BattleUI.ts` | 部署槽卡 | 兵牌槽位图标 |
| `ui/RouteMapUI.ts` | 路线节点图标 | 战斗 / 精英 / Boss |
| `ui/UpgradeUI.ts` | 升级卡图标 | 三选一卡片 |
| `TinyVanguardMain.ts` | 职业按钮 | 职业选择面板 |

### (c) 字面量也要清（消毒函数管不到文案）

`.ts` 字面量里的 emoji 有两类，**都要手工清**：
① 图例 / 属性图标（`TinyVanguardMain.ts`）；② 升级卡**文案**里的 emoji
（`UpgradeUI.ts`）—— 文案不经过 `stripVariationSelectors`，只能改字面量。

### (d) 场景里硬编码的字符串必须经 MCP 改

`TinyVanguard.scene` 里有 2 处：职业按钮文案「⚔️ 战士」、路线图图例。
`setupClassSelectionUI()` **不会**覆盖它们（只绑事件 / 设色），所以这是玩家可见的真修改。
改法：`node_get_all_nodes` → 找出 `Label.string` 含变体选择符的节点 →
`component_set_component_property(propertyType:'string')` → `scene_save_scene` → **读回核对**。
（红线 2：绝不直接读写 `.scene` JSON。）

## 4. 当前不变量

```bash
$ grep -rlP '[\x{fe0f}\x{fe0e}]' assets/
$                     # 空输出 = 全项目已清零（含 .scene / .prefab）
```

新增任何图标后请重跑这一条；有输出就说明又漏了一处。

## 5. 验证与声明纪律

- **本地可验证的**：①字面量级 —— 上面的 `grep` 必须为空；②逻辑级 —— 预览里用探针读
  实际渲染的 `Label.string`，断言 `s.indexOf('️') === -1`（部署槽、拖拽幽灵、
  棋盘单位、升级卡、职业按钮、路线图图例逐处采样）。
- **本地验证不了的**：微信真机字体是否缺字形、方框是否真的消失。
  本次修复**无法在本机复现或排除**微信渲染差异，因此结论只能写到
  「码点层面已统一、单一来源已建立」，**不声称"微信上必然不再出方框"** —— 需要真机验收。
  这条纪律和 [`browser-verify-cocos-preview.md`](./browser-verify-cocos-preview.md) 的
  「读数矛盾时先怀疑探针」是同一类：**没验证过的因果，不要写成已验证**。

## 6. 相关

- 图标配色 / 字号令牌：`config/Theme.ts`（`COLOR` / `CLASS_COLOR` / `FONT_ICON`）
- 场景字符串修改的操作规范：[`mcp-scene-authoring-pitfalls.md`](./mcp-scene-authoring-pitfalls.md)
- 文本编码（PowerShell 会把中文重编码成 GBK）：
  [`dev-toolchain-notes.md`](./dev-toolchain-notes.md) §1
