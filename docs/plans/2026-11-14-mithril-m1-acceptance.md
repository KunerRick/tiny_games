# 《秘银远征》M1 垂直切片验收记录（2026-11-14）

> 设计规格：[`plans/2026-11-14-game-mithril-design.md`](./2026-11-14-game-mithril-design.md)
> 里程碑：**M1 = 战士 + 废弃矿坑 + 矿坑巨魔**，5 分钟内可玩通、零报错。
> 设计闸门原文：**「M1 不通过不进入 M2。战斗手感是唯一无法事后补的东西。」**

## 1. 交付内容

| 文件 | 职责 |
|------|------|
| `scenes/Mithril.scene` | Canvas(720×1280 / UI_2D) + 正交相机(z=1000, orthoHeight 640, 清屏 `#0B1220`) + `GameRoot`；Field / Controls / HUD 全部运行时创建 |
| `scripts/MithrilCore.ts` | 纯逻辑：固定步长、战士 6 技能、3 遭遇、BOSS 三阶段状态机 |
| `scripts/MithrilGame.ts` | 输入（左摇杆 + 键盘调试）→ 核心 → 渲染 / HUD 调度，追帧上限 3 步/帧 |
| `scripts/MithrilHud.ts` | 顶栏（生命 / 怒气 / 进度）、BOSS 条与读条、右下技能扇形、结算面板 |
| `scripts/MithrilRenderer.ts` | 单 Graphics 每帧重绘 + 伤害数字 Label 池（上限 18） |
| `scripts/MithrilJoystick.ts` | 左半屏动态摇杆（按下处即圆心） |
| `scripts/MithrilArt.ts` | 全程序化绘制，零贴图 |
| `tools/verify-mithril-core.js` | 纯逻辑自检 **147 项**（含 2 条手机端输入回归 + 1 条普攻多目标结算） |

## 2. 验收数据（实测，非估算）

| 项 | 结果 |
|---|---|
| 真实帧循环全自动通关（3 遭遇 + 三阶段 BOSS） | **187.8 s**（3:08），终局 132/132 血、25 击杀 |
| 固定步长全自动通关（同代码，核心路径） | **168.0 s**，终局 89/132 血、23 击杀 |
| 帧率（浏览器预览，headless 无 GPU 加速） | 平均 **60 FPS**，p95 帧时 **19 ms**，峰值 **22.5 ms** |
| 单帧渲染耗时（`MithrilRenderer.lastRenderMs`） | ≤ **1 ms** |
| 控制台错误 | **0** |
| 连开 10 局后的节点数 | 69 / 44 / 20 → 69 / 44 / 20（无增长，伤害数字 Label 池稳定 19 节点） |
| 纯逻辑自检 | `MITHRIL_CORE_OK 147/147` |
| 类型检查 | `tsc --noEmit` 通过（Cocos 自带 TS 5.8.2） |

三个阶段都自然触发：`boom`（砸地预警）→ `phase2` + `regen`（召唤矿工回血）→ `phase3` + `cast`/`interrupt`/`enrage`（狂暴读条）。

## 3. 本轮修掉的三个真缺陷

### 3.1 出战装等用错来源 → BOSS 只有 4 DPS，实际打不死

`startNewRun()` 原来走 `profileFromSave(defaultSave())`。空存档没有装备 ⇒ 平均装等 = 1 ⇒ 副属性（暴击 / 急速 / 精通 / 全能）全为 0。
自检脚本的平衡闸门用的是 `makeProfile('warrior', 5, 5)`，于是出现「自检 185 秒通关、真机 300 秒 BOSS 还剩 1818 血」的分裂。
**修法**：M1 无装备界面，直接 `makeProfile('warrior', SLICE_LEVEL, SLICE_LEVEL)`，与闸门口径对齐（`MithrilGame.ts` 内有注释说明）。

### 3.2 索敌全部排除 BOSS + 朝向只跟移动 → 普攻永远空挥

三处 `_nearestEnemy(range, false)`（普攻 / 冲锋 / 破甲）都把 BOSS 排除在外；而手机端没有瞄准输入，朝向只能来自摇杆方向。
玩家绕圈走位时剑指向切向，普攻 45° 扇形判不到身前的 BOSS（半径 44、站位 120+），实测整场约 **5 DPS**。
**修法**：
- `_tickPlayer` 新增自动索敌朝向（无瞄准输入时朝最近敌人转身）；
- `_swing` 改为按「距离 − 敌人半径」索敌，与命中判定同口径，且包含 BOSS；
- `_charge` / `_armorBreak` 改为包含 BOSS（渲染层本来就会给 BOSS 画破甲标记，属于静默失效）；
- 站桩闪避改为朝目标反方向后撤（朝向被索敌吸住后，沿用 facing 会冲进敌人身体）。

回归检查：自检新增 **145（无瞄准输入同样通关，163.9 s）**、**146（切线走位普攻必须命中 BOSS）**。

### 3.3 HUD 排版：技能键重叠 / 贴底被裁

斩与怒圆心距 57 px < 半径和 112 px（叠在一起）；「破」y=−592、半径 44 → 底边 −636，在短预览窗口（可视高度约 1243 设计像素）被切掉一半。
**修法**：整组按三条硬约束重排 —— 右边界 ≤ 352、下边界 ≥ −588、两两圆心距 > 半径和；冷却标签偏移改到 `-size*0.3` 避免压住字形；怒气条加高到 18 并下移到 y=560。

### 3.4 独立复核确认的缺陷（同批修掉）

| # | 缺陷 | 后果 | 修法 |
|---|------|------|------|
| 1 | `_swing` 多目标**升序**结算 | 先死目标 `splice` 后下标前移：后面的伤害打偏 / 丢失，扇形外的旁观敌人反而掉血（自检实测：`behind` 吃 488 伤害、`mid` 一点没掉） | 结算改为**倒序**（掷骰仍升序，同种子不变） |
| 2 | `update()` 累加器无上限、不防 NaN | `dt` 为 NaN 后 `_acc` 永久污染（`>= FIXED_DT` 恒假），卡顿后蓄积步数无限涨 | 非有限 / 非正 `dt` 整帧丢弃；`_acc` 封顶 `MAX_STEPS × FIXED_DT` |
| 3 | 结算遮罩不拦触摸 | 结算期间点遮罩空白会漏给下层摇杆（幽灵输入） | 遮罩挂 `BlockInputEvents`；已用「同点按下」对照验证（遮罩在 = 摇杆不激活，遮罩藏 = 激活） |
| 4 | 遭遇清场无条件发回血事件 | 满血通关时弹出实际没加上的绿色数字 | 只在 `hp` 真增长时 `_emit('heal')` |
| 5 | 狂暴倍率写死 1.5、`enrageBonus` 成死配置；预警砸地不吃狂暴 | 改数值要同时改三处，砸地伤害与横幅文案脱节 | 新增 `_bossDamageMult()` 读配置；投射物在发射时烘焙倍率（避免小怪子弹跟着变疼）；砸地与横幅文案同源 |
| 6 | 切后台不清 HUD 按住状态 | 手机端切走不派发 `TOUCH_END`，回来技能键「粘住」持续施法 | `MithrilHud.releaseAllHeld()` + `onGameHide()` 调用 |
| 7 | 伤害数字每帧 `new Color` | 每帧每数字一次分配，GC 抖动 | 生成时记基准色，淡出复用 `_tmp` |

回归：自检新增 **147（普攻多目标致死时结算不打偏）** —— 用「最近一只 1 血 + 两只扇形内 + 一只扇形外」复现，已反向验证（把结算改回升序该条立刻变红：`mid` 不掉血、`behind` 掉 488）。

## 4. 复验步骤

```bash
# 1) 纯逻辑 + 类型
node tools/verify-mithril-core.js                 # 期望 MITHRIL_CORE_OK 147/147
MITHRIL_VERBOSE=1 node tools/verify-mithril-core.js | grep 14[0-9]   # 看通关时长
node "/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc" --noEmit

# 2) 浏览器
#    编辑器打开 Mithril.scene → 预览 http://127.0.0.1:7456/
#    改了 .ts 必须先 project_refresh_assets 再重载页面
```

页内探针（重载后粘进控制台即可跑完整局，约 3 分钟真实时间）：

```js
const g = cc.director.getScene().getChildByName('Canvas').getChildByName('GameRoot').getComponent('MithrilGame');
g.debugGotoBoss();   // 跳过小怪直达 BOSS
g.debugSnapshot();   // {time, phase, player, boss, enemies, telegraphs, orbs}
```

## 5. M1 明确未做（留给后续里程碑）

- 装备 / 饰品 / 背包界面（M2）、存档与离线收益、其他三职业、其余 5 个副本
- `GameConfig.ts` 注册与大厅图标（**M11 才做**，`GameIconArt.ts` 的 `ACCENTS` + `drawShape` 一并补）
- 音效 / 震动、微信构建产物预检
