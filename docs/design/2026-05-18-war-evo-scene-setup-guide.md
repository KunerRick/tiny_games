# 战争进化史 Lite — 场景搭建指导手册

**关联文档**: [设计文档](../specs/2026-05-18-game-war-evolution-design.md) | [实施计划](../plans/2026-05-18-game-war-evolution-plan.md)

---

## 准备工作

1. **打开 Cocos Creator**，确保项目已加载
2. 在 `assets/games/game_war_evolution/` 目录下：
   - 创建 `scenes/` 文件夹
   - 创建 `scripts/` 文件夹
   - 创建 `resources/prefabs/` 文件夹
3. 场景创建在 `scenes/` 下，命名：**`WarEvo.scene`**
4. 场景分辨率：**720 × 1280**（设计分辨率）
5. 创建后先 **保存场景**，再开始搭建

---

## 第一部分：设置 Canvas

### 步骤 1：配置 Canvas

1. 在场景中默认有 **Canvas** 节点，选中它
2. 在 Inspector 中设置：
   - **Design Resolution**: 宽度 `720`，高度 `1280`
   - **Fit Height**: ✅ 勾选
   - **Fit Width**: ✅ 勾选
3. 添加 **Widget** 组件（适配器）：
   - Top: `0`, Bottom: `0`, Left: `0`, Right: `0`
   - 全部对齐方式选 `ALWAYS`

> **为什么这样设置**：确保在不同尺寸的手机屏幕上，Canvas 自动等比缩放填满屏幕。

---

## 第二部分：搭建战场区（BattleArea）

所有战斗相关的视觉元素放在这一层。

### 步骤 2：创建 BattleArea 节点

1. 在 **Canvas** 上右键 → **创建空节点**
2. 命名：`BattleArea`
3. 位置：`(0, 0, 0)`
4. 不要勾选 Widget

### 步骤 3：创建战场背景 `bgGround`

1. 在 **BattleArea** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`bgGround`
3. 位置：`(0, 30, 0)`
4. 在 Inspector 中找到 **Sprite** 组件：
   - `SpriteFrame`: 选择 `builtin-white-round`（内置白色圆角图）
   - `Color`: `#16213e`（深蓝黑色）
   - `Size Mode`: `CUSTOM`
5. **UITransform** 组件：
   - `Content Size`: 宽度 `700`，高度 `620`
6. **添加 Widget 组件**（让背景自适应）：
   - Top: `80`（为顶部 UI 留空间）
   - Bottom: `280`（为底部 UI 留空间）
   - Left: `10`
   - Right: `10`
   - 全部对齐：`ALWAYS`

> **最终效果**：深蓝黑色的矩形铺满中部区域，作为战场底板。

### 步骤 4：创建路径线 `pathLine`

1. 在 **BattleArea** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`pathLine`
3. 位置：`(0, 60, 0)`
4. **Sprite** 组件：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#4a5568`（暗灰色）
   - `Size Mode`: `CUSTOM`
5. **UITransform** 组件：
   - `Content Size`: 宽度 `640`，高度 `3`

> **最终效果**：一条暗灰色的细水平线，标注单位的行走路径。

### 步骤 5：创建玩家城堡 `Castle_Player`

1. 在 **BattleArea** 上右键 → **创建空节点**
2. 命名：`Castle_Player`
3. 位置：`(-280, 60, 0)`
4. **添加组件 → Sprite**：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#4488FF`（蓝色）
   - `Size Mode`: `CUSTOM`
5. **UITransform**：
   - `Content Size`: 宽度 `80`，高度 `100`
6. **添加组件 → Castle**（脚本，稍后挂，先留位）

### 步骤 6：创建玩家城堡脚下血条 `hpBar`

1. 在 **Castle_Player** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`hpBar`
3. 位置：`(0, -55, 0)`（城堡下方）
4. **Sprite** 组件：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#44BB44`（绿色）
   - `Size Mode`: `CUSTOM`
5. **UITransform**：
   - `Content Size`: 宽度 `70`，高度 `6`
6. **Anchor**（锚点）：`(0, 0.5)` ← **重要！血条左对齐**

**另配血条背景：**
1. 在 **Castle_Player** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`hpBarBg`
3. 位置：`(0, -55, 0)`
4. **Sprite** 组件：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#333333`（深灰色背景）
   - `Size Mode`: `CUSTOM`
5. **UITransform**：
   - `Content Size`: 宽度 `70`，高度 `6`

> 将 `hpBarBg` 在层级管理器中拖到 `hpBar` **上方**（确保 bg 在 fill 的后面渲染）。

### 步骤 7：创建敌方城堡 `Castle_Enemy`

1. 在 **BattleArea** 上右键 → **创建空节点**
2. 命名：`Castle_Enemy`
3. 位置：`(280, 60, 0)`
4. **添加组件 → Sprite**：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#FF4444`（红色）
   - `Size Mode`: `CUSTOM`
5. **UITransform**：
   - `Content Size`: 宽度 `80`，高度 `100`
6. **添加组件 → Castle**（脚本，稍后挂）

**配血条（和步骤 6 完全一样，克隆也可）：**
1. 在 **Castle_Enemy** 下创建 `hpBarBg`（灰底），位置 `(0, -55, 0)`，尺寸 `70×6`
2. 在 **Castle_Enemy** 下创建 `hpBar`（绿条），位置 `(0, -55, 0)`，锚点 `(0, 0.5)`，尺寸 `70×6`

### 步骤 8：创建单位容器 `UnitContainer`

1. 在 **BattleArea** 上右键 → **创建空节点**
2. 命名：`UnitContainer`
3. 位置：`(0, 0, 0)`
4. 不需要任何组件，纯粹的容器节点

> **说明**：游戏中所有动态生成的单位都会作为 UnitContainer 的子节点。单位的位置由脚本运行时设置，不需要你在场景中预先放置。

### 步骤 8b：战场区层级确认

此时 **BattleArea** 下的层级顺序（从上到下渲染）应如下调整：

```
BattleArea
├── bgGround            (最底层背景)
├── pathLine            (路径线)
├── Castle_Player       (玩家城堡)
│   ├── hpBarBg
│   └── hpBar
├── Castle_Enemy        (敌方城堡)
│   ├── hpBarBg
│   └── hpBar
└── UnitContainer       (单位容器，最上层)
```

**调整方法**：在层级管理器中拖拽节点的排列顺序即可。上层节点遮挡下层。

---

## 第三部分：搭建 UI 覆盖层（UI_Overlay）

### 步骤 9：创建 UI_Overlay

1. 在 **Canvas** 上右键 → **创建空节点**
2. 命名：`UI_Overlay`
3. 位置：`(0, 0, 0)`
4. **添加组件 → UIController**（脚本）

### 步骤 10：创建顶部信息栏 `topBar`

1. 在 **UI_Overlay** 上右键 → **创建空节点**
2. 命名：`topBar`
3. 位置：`(0, 560, 0)`（靠近屏幕顶部，Canvas y 范围 -640~640）

> **⚠️ 布局总览**（所有坐标均为 topBar 下的局部坐标）：
> ```
> 第 1 行 (y=  0)： [←]  [玩家HP ██████]   VS   [██████ 敌方HP]
> 第 2 行 (y=-24)：        5000                     5000
> 第 3 行 (y=-52)：  [$ 100000]    [原始时代]   [击杀: 0/800]
> 第 4 行 (y=-72)：  ─────────────────────────────────────────
> ```

#### 10a：创建返回按钮 `backButton`（第 1 行）

1. 在 **topBar** 上右键 → **创建 UI 组件 → Button**
2. 命名：`backButton`
3. 位置：`(-300, 0, 0)`
4. **Button** 组件：
   - `Transition`: `COLOR`
   - `Normal Color`: `#333333`
   - `Hovered Color`: `#444444`
   - `Pressed Color`: `#555555`
5. **UITransform**：宽度 `60`，高度 `50`
6. 替换 Button 默认的 Label 子节点：
   - 删除自动创建的 Label
   - 在 `backButton` 上右键 → **创建 2D 对象 → Label**
   - 文本：`←`
   - 字号：`28`
   - 颜色：`#FFFFFF`
   - 位置：`(0, 0, 0)`
   - 水平对齐：居中，垂直对齐：居中

> 脚本中会绑定 `backButton` 的 `TOUCH_END` 事件返回大厅。

#### 10b：创建双方血条（第 1 行 + 第 2 行）

**布局说明**：HP 条在第 1 行（y=0），数字在第 2 行（y=-24），数字居中于对应的 HP 条下方。

**玩家血条 `playerHP`（ProgressBar）：**
1. 在 **topBar** 上右键 → **创建 UI 组件 → ProgressBar**
2. 命名：`playerHP`
3. 位置：`(-150, 0, 0)`
4. **ProgressBar** 组件设置：
   - `Bar Sprite`: 稍后绑定子节点 Bar_Sprite
   - `Total Length`: `100`
   - `Direction`: `LEFT_TO_RIGHT`
5. **同时创建背景底**（在 `playerHP` 同级、位置相同）：
   - 在 **topBar** 上右键 → **2D 对象 → Sprite**，命名 `playerHP_bg`
   - 位置：`(-150, 0, 0)`（与 ProgressBar 重叠）
   - Sprite：`builtin-white-round`，颜色 `#333333`，`Size Mode: CUSTOM`
   - UITransform：宽度 `100`，高度 `12`
   - **层级中 `playerHP_bg` 拖到 `playerHP` 上方**（先渲染背景）
6. 修改自动生成的子节点 `Bar_Sprite`：
   - 颜色：`#44BB44`（绿色）
   - UITransform：宽度 `100`，高度 `12`
7. 回到 `playerHP` 属性，将 `Bar_Sprite` 拖入 `Bar Sprite` 槽

> **Total Length 必须等于背景 Sprite 宽度（均为 100）**，否则进度条长度和背景不匹配。

**VS 文字 `vsLabel`：**
1. 在 **topBar** 上右键 → **创建 2D 对象 → Label**
2. 命名：`vsLabel`
3. 位置：`(0, 0, 0)`
4. 文本：`VS`
5. 字号：`16`
6. 颜色：`#AAAAAA`
7. 水平对齐：居中

**敌方血条 `enemyHP`（ProgressBar）：**
1. 在 **topBar** 上右键 → **创建 UI 组件 → ProgressBar**
2. 命名：`enemyHP`
3. 位置：`(150, 0, 0)`
4. **ProgressBar** 组件：`Total Length: 100`，`Direction: LEFT_TO_RIGHT`
5. 配背景 Sprite：`enemyHP_bg`，位置 `(150, 0)`，颜色 `#333333`，尺寸 `100×12`
6. 修改 `Bar_Sprite`：颜色 `#FF4444`（红色），尺寸 `100×12`
7. 绑定 `Bar Sprite`

**HP 数字（第 2 行，y=-24）：**
- `hpPlayerLabel`：在 **topBar** 下创建 Label
  - 位置：`(-150, -24, 0)` ← 居中于玩家血条下方
  - 文本：`5000`，字号：`12`，颜色：`#44BB44`，水平对齐：居中
- `hpEnemyLabel`：在 **topBar** 下创建 Label
  - 位置：`(150, -24, 0)` ← 居中于敌方血条下方
  - 文本：`5000`，字号：`12`，颜色：`#FF6666`，水平对齐：居中

#### 10c：创建金币 + 时代 + 击杀进度（第 3 行，y=-52）

这行水平分为三栏：左（金币）、中（时代名称）、右（击杀进度），互不重叠。

**左栏 — 金币图标 `goldIcon`：**
1. 在 **topBar** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`goldIcon`
3. 位置：`(-160, -52, 0)`
4. **Sprite** 组件：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#FFD700`（金色）
   - `Size Mode`: `CUSTOM`
5. **UITransform**：宽度 `20`，高度 `20`

**左栏 — 金币数字 `goldLabel`：**
1. 在 **topBar** 上右键 → **创建 2D 对象 → Label**
2. 命名：`goldLabel`
3. 位置：`(-137, -52, 0)` ← 紧贴图标右侧
4. 文本：`0`
5. 字号：`20`
6. 颜色：`#FFD700`
7. 水平对齐：**左对齐**
8. **不要设置 UITransform 宽度** ← ⚠️ 关键！文本自适应

> **为什么不能设宽度**：金币数值可能增长到 100000+，设死宽度（如 100）会让长数字溢出到 ageLabel。左对齐 + 无宽度限制，让 Label 自动扩展，但起始位置足够靠左，最坏情况（"100000"约 70px 宽）右边界也只会到 -67，离 ageLabel（左边界约 -24）还有 43px 安全间距。

**中栏 — 时代名称 `ageLabel`：**
1. 在 **topBar** 上右键 → **创建 2D 对象 → Label**
2. 命名：`ageLabel`
3. 位置：`(0, -52, 0)` ← 居中
4. 文本：`原始时代`
5. 字号：`16`
6. 颜色：`#FFFFFF`
7. 水平对齐：居中
8. **不要设置 UITransform 宽度**

**右栏 — 击杀进度 `killLabel`：**
1. 在 **topBar** 上右键 → **创建 2D 对象 → Label**
2. 命名：`killLabel`
3. 位置：`(130, -52, 0)` ← 靠右
4. 文本：`击杀: 0/800`
5. 字号：`12`
6. 颜色：`#AAAAAA`
7. 水平对齐：**右对齐** ← 文本从右往左延伸，不会超出屏幕

> 三栏间距：金币最大右边界 -67，击杀左边界 130 - 文本宽度 ≈ 85+，中间有充足空间。

#### 10d：创建分隔线（第 4 行，y=-72）

1. 在 **topBar** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`divider`
3. 位置：`(0, -72, 0)`
4. **Sprite** 组件：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#333333`
   - `Size Mode`: `CUSTOM`
5. **UITransform**：宽度 `700`，高度 `1`

#### 10e：最终 topBar 层级结构

```
topBar (0, 560)
├── backButton (Button, -300, 0, 60×50)
│   └── Label "←"
├── playerHP_bg (Sprite, -150, 0, #333333, 100×12)
├── playerHP (ProgressBar, -150, 0, Total Length: 100)
│   └── Bar_Sprite (Sprite, #44BB44, 100×12)
├── vsLabel (Label, 0, 0, "VS", centered)
├── enemyHP_bg (Sprite, 150, 0, #333333, 100×12)
├── enemyHP (ProgressBar, 150, 0, Total Length: 100)
│   └── Bar_Sprite (Sprite, #FF4444, 100×12)
├── hpPlayerLabel (Label, -150, -24, "5000", centered)
├── hpEnemyLabel (Label, 150, -24, "5000", centered)
├── goldIcon (Sprite, -160, -52, #FFD700, 20×20)
├── goldLabel (Label, -137, -52, "0", left-align, NO width) ← ⚠️ 无固定宽度
├── ageLabel (Label, 0, -52, "原始时代", centered, NO width)
├── killLabel (Label, 130, -52, "击杀: 0/800", right-align)
└── divider (Sprite, 0, -72, #333333, 700×1)
```

### 步骤 11：创建底部操作栏 `bottomBar`

1. 在 **UI_Overlay** 上右键 → **创建空节点**
2. 命名：`bottomBar`
3. 位置：`(0, -460, 0)`（近屏幕底部）

> **布局总览**（局部坐标）：
> ```
> y= 68：  ──────────────────────────────────────────
> y=  0：  [  穴居人  ]  [  猛犸骑手  ]  [   进化   ]
>            15g             80g            0/800
> ```
> 三个按钮间距均匀：-140、0、+140，各 120px 宽。

#### 11a：底部上分隔线 `bottomDivider`

1. 在 **bottomBar** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`bottomDivider`
3. 位置：`(0, 68, 0)`
4. **Sprite** 组件：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#333333`
   - `Size Mode`: `CUSTOM`
5. **UITransform**：宽度 `700`，高度 `1`

#### 11b：创建兵种按钮 1 `unitBtn_0`

1. 在 **bottomBar** 上右键 → **创建 UI 组件 → Button**
2. 命名：`unitBtn_0`
3. 位置：`(-140, 0, 0)`
4. **Button** 组件：
   - `Transition`: `COLOR`
   - `Normal`: `#2d3748`
   - `Hovered`: `#4a5568`
   - `Pressed`: `#1a202c`
   - `Disabled`: `#1a202c`
5. **UITransform**：宽度 `120`，高度 `95`
6. 在 `unitBtn_0` 下创建两个 Label 子节点（先创建 nameLabel，后创建 costLabel）：

**兵种名 `nameLabel`（子节点一）：**
- 命名：`nameLabel`
- 位置：`(0, 16, 0)`
- 文本：`穴居人`
- 字号：`16`
- 颜色：`#FFFFFF`
- 水平对齐：居中

**费用 `costLabel`（子节点二）：**
- 命名：`costLabel`
- 位置：`(0, -14, 0)`
- 文本：`15g`
- 字号：`14`
- 颜色：`#FFD700`
- 水平对齐：居中

> **层级顺序**：后创建的 Label 遮挡先创建的，确保 `costLabel` 在层级中位于 `nameLabel` 之上（即先创建 `nameLabel` 再创建 `costLabel`）。

#### 11c：创建兵种按钮 2 `unitBtn_1`

1. 在 **bottomBar** 上右键 → **创建 UI 组件 → Button**
2. 命名：`unitBtn_1`
3. 位置：`(0, 0, 0)`
4. **Button** 颜色同 `unitBtn_0`
5. **UITransform**：宽度 `120`，高度 `95`
6. 同样创建两个 Label 子节点：
   - `nameLabel`：文本 `猛犸骑手`，位置 `(0, 16)`
   - `costLabel`：文本 `80g`，位置 `(0, -14)`

#### 11d：创建进化按钮 `evolveBtn`

1. 在 **bottomBar** 上右键 → **创建 UI 组件 → Button**
2. 命名：`evolveBtn`
3. 位置：`(140, 0, 0)`
4. **Button** 组件：
   - `Transition`: `COLOR`
   - `Normal`: `#553C00`（暗金色）
   - `Hovered`: `#886600`
   - `Pressed`: `#332200`
   - `Disabled`: `#1a202c`
5. **UITransform**：宽度 `120`，高度 `95`
6. 创建两个 Label 子节点：

**"进化"文字 `nameLabel`：**
- 命名：`nameLabel`
- 位置：`(0, 16, 0)`
- 文本：`进化`
- 字号：`20`
- 颜色：`#FFD700`
- 水平对齐：居中

**进化费用状态 `costLabel`：**
- 命名：`costLabel`
- 位置：`(0, -14, 0)`
- 文本：`0/800`
- 字号：`12`
- 颜色：`#CCCCCC`
- 水平对齐：居中

### 步骤 12：创建冷却覆盖层（可选，增强版）

> 冷却遮罩用于在生产后显示半透明倒计时。把它们放在 **bottomBar 的子级**（而非 UI_Overlay 子级），位置与对应按钮的相对坐标一致，这样 bottomBar 移动时自动跟随。

**`unitBtn_0_cd`：**
1. 在 **bottomBar** 上右键 → **创建空节点**
2. 命名：`unitBtn_0_cd`
3. 位置：`(-140, 0, 0)` ← 与 unitBtn_0 在 bottomBar 下的局部坐标一致
4. **UITransform**：宽度 `120`，高度 `95`
5. 初始 **Active 取消勾选**
6. **添加组件 → Sprite**：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#000000`
   - Color Alpha: `153`（约 60% 不透明）
   - `Size Mode`: `CUSTOM`
7. 在其下创建 **Label** 子节点：
   - 位置：`(0, 0, 0)`
   - 文本：`3s`
   - 字号：`24`
   - 颜色：`#FFFFFF`
   - 水平对齐：居中

**`unitBtn_1_cd`：**
1. 同理，创建在 **bottomBar** 下
2. 命名：`unitBtn_1_cd`
3. 位置：`(0, 0, 0)` ← 与 unitBtn_1 一致
4. 其余相同（尺寸 120×95、Active 取消勾选、Sprite 半透明黑、子 Label "3s"）

---

## 第四部分：创建 GameOverPanel（结算面板）

### 步骤 13：创建结算面板 `GameOverPanel`

1. 在 **UI_Overlay** 上右键 → **创建空节点**
2. 命名：`GameOverPanel`
3. 位置：`(0, 0, 0)`
4. **初始 Active 取消勾选** ← **非常重要！**

#### 13a：创建全屏遮罩

1. 在 **GameOverPanel** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`maskBg`
3. 位置：`(0, 0, 0)`
4. **Sprite** 组件：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#000000`
   - `Size Mode`: `CUSTOM`
   - 自定义材质（如有）设置透明度；否则用 Color 的 alpha
   - **Color 的 Alpha**: 180（约 70% 不透明）
5. **UITransform**：宽度 `720`，高度 `1280`
6. **添加 Widget 组件**：
   - Top: 0, Bottom: 0, Left: 0, Right: 0
   - 全部对齐：`ALWAYS`

#### 13b：创建面板内容容器

1. 在 **GameOverPanel** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`panelBg`
3. 位置：`(0, 0, 0)`
4. **Sprite** 组件：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#1a202c`（深色面板）
   - `Size Mode`: `CUSTOM`
5. **UITransform**：宽度 `380`，高度 `340`

#### 13c：创建结果文字

1. 在 **GameOverPanel** 上右键 → **创建 2D 对象 → Label**
2. 命名：`resultLabel`
3. 位置：`(0, 100, 0)`
4. 文本：`胜利！`
5. 字号：`36`
6. 颜色：`#FFD700`
7. 水平对齐：居中

#### 13d：创建统计文字

1. 在 **GameOverPanel** 上右键 → **创建 2D 对象 → Label**
2. 命名：`statsLabel`
3. 位置：`(0, 30, 0)`
4. 文本：`时代: 中世纪\n击杀数: 42\n金币收入: 1860`
5. 字号：`16`
6. 颜色：`#CCCCCC`
7. 水平对齐：居中
8. 行高：`26`（Line Height）

#### 13e：创建"再来一局"按钮

1. 在 **GameOverPanel** 上右键 → **创建 UI 组件 → Button**
2. 命名：`restartBtn`
3. 位置：`(-80, -70, 0)`
4. **Button** 组件：
   - `Transition`: `COLOR`
   - `Normal`: `#2B6CB0`（蓝色）
   - `Hovered`: `#3182CE`
   - `Pressed`: `#1A365D`
5. **UITransform**：宽度 `130`，高度 `48`
6. 其下创建 **Label** 子节点：
   - 文本：`再来一局`
   - 字号：`18`
   - 颜色：`#FFFFFF`
   - 水平对齐：居中

#### 13f：创建"返回大厅"按钮

1. 在 **GameOverPanel** 上右键 → **创建 UI 组件 → Button**
2. 命名：`lobbyBtn`
3. 位置：`(80, -70, 0)`
4. **Button** 组件：
   - `Transition`: `COLOR`
   - `Normal`: `#4A5568`（灰色）
   - `Hovered`: `#718096`
   - `Pressed`: `#2D3748`
5. **UITransform**：宽度 `130`，高度 `48`
6. 其下创建 **Label** 子节点：
   - 文本：`返回大厅`
   - 字号：`18`
   - 颜色：`#FFFFFF`
   - 水平对齐：居中

> **顺序技巧**：先将 `maskBg` 拖到最下面（最底层渲染），然后是 `panelBg`，`resultLabel`，`statsLabel`，`restartBtn`，`lobbyBtn`。确保按钮在最上面。

---

## 第五部分：创建 Unit.prefab（单位预制体）

### 步骤 14：创建 UnitPrefab

1. 在 **资源管理器** 中导航到 `assets/games/game_war_evolution/resources/prefabs/`
2. 右键 → **创建 → 预制体**
3. 命名：`Unit`
4. 双击打开预制体编辑

#### 14a：预制体根节点

1. 在预制体编辑场景中，根节点已自动创建（`Unit`）
2. 设置：
   - 位置：`(0, 0, 0)`
   - **UITransform**: 宽度 `32`，高度 `32`
3. **添加组件 → Unit**（脚本组件，稍后挂）

#### 14b：创建单位身体 `body`

1. 在 **Unit** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`body`
3. 位置：`(0, 0, 0)`
4. **Sprite** 组件：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#4488FF`（蓝色，玩家默认，运行时脚本会改）
   - `Size Mode`: `CUSTOM`
5. **UITransform**：宽度 `32`，高度 `32`

#### 14c：创建血条背景

1. 在 **Unit** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`hpBarBg`
3. 位置：`(0, -18, 0)`（身体下方）
4. **Sprite** 组件：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#333333`
   - `Size Mode`: `CUSTOM`
5. **UITransform**：宽度 `28`，高度 `4`

#### 14d：创建血条填充

1. 在 **Unit** 上右键 → **创建 2D 对象 → Sprite**
2. 命名：`hpBarFill`
3. 位置：`(-14, -18, 0)` ← 左对齐偏移
4. **Sprite** 组件：
   - `SpriteFrame`: `builtin-white-round`
   - `Color`: `#44BB44`
   - `Size Mode`: `CUSTOM`
5. **UITransform**：宽度 `28`，高度 `4`
6. **Anchor**（锚点）：`(0, 0.5)` ← **这是关键！**
   - 在 UITransform 组件中找到 `Anchor`，X 改为 `0`，Y 改为 `0.5`
   - 这样血条减少时从右往左缩，而不是从中间缩

> 将 `hpBarBg` 的层级拖到 `hpBarFill` **上方**（先渲染 bg，再渲染 fill 覆盖在上面）。

#### 14e：创建名称标签（可选）

1. 在 **Unit** 上右键 → **创建 2D 对象 → Label**
2. 命名：`nameLabel`
3. 位置：`(0, 18, 0)`（身体上方）
4. 文本：`穴居人`（运行时脚本会改）
5. 字号：`10`
6. 颜色：`#FFFFFF`
7. 水平对齐：居中

#### 14f：保存预制体

点击编辑器左上角的 **保存** 按钮，确保预制体已保存。

> **预制体层级确认**（从下到上渲染顺序）：
> ```
> Unit (根节点)
> ├── hpBarBg       (灰底，最下层)
> ├── hpBarFill     (绿条，覆盖在 bg 上)
> ├── nameLabel     (名字，在身体上方)
> └── body          (单位色块，最上层)
> ```

---

## 第六部分：最终层级结构确认

搭建完成后，层级管理器应如下所示：

```
Canvas (Widget 填满屏幕)
├── BattleArea
│   ├── bgGround (Sprite, #16213e)
│   ├── pathLine (Sprite, #4a5568)
│   ├── Castle_Player [Castle 组件]
│   │   ├── hpBarBg (Sprite, #333333)
│   │   └── hpBar (Sprite, #44BB44, anchor 左)
│   ├── Castle_Enemy [Castle 组件]
│   │   ├── hpBarBg (Sprite, #333333)
│   │   └── hpBar (Sprite, #44BB44, anchor 左)
│   └── UnitContainer (空 Node)
│
├── UI_Overlay [UIController 组件]
│   ├── topBar
│   │   ├── backButton (Button, -300, 0)
│   │   │   └── Label "←"
│   │   ├── playerHP_bg (Sprite, -150, 0, #333333, 100×12)
│   │   ├── playerHP (ProgressBar, -150, 0, Total Length: 100)
│   │   │   └── Bar_Sprite (Sprite, #44BB44, 100×12)
│   │   ├── vsLabel (Label, 0, 0, "VS")
│   │   ├── enemyHP_bg (Sprite, 150, 0, #333333, 100×12)
│   │   ├── enemyHP (ProgressBar, 150, 0, Total Length: 100)
│   │   │   └── Bar_Sprite (Sprite, #FF4444, 100×12)
│   │   ├── hpPlayerLabel (Label, -150, -24, "5000")
│   │   ├── hpEnemyLabel (Label, 150, -24, "5000")
│   │   ├── goldIcon (Sprite, -160, -52, #FFD700, 20×20)
│   │   ├── goldLabel (Label, -137, -52, "0", left-align, NO width)
│   │   ├── ageLabel (Label, 0, -52, "原始时代")
│   │   ├── killLabel (Label, 130, -52, "击杀: 0/800", right-align)
│   │   └── divider (Sprite, 0, -72, #333333, 700×1)
│   │
│   ├── bottomBar
│   │   ├── bottomDivider (Sprite, 0, 68, #333333, 700×1)
│   │   ├── unitBtn_0 (Button, -140, 0, 120×95)
│   │   │   ├── nameLabel (Label "穴居人", 0, 16)
│   │   │   └── costLabel (Label "15g", 0, -14)
│   │   ├── unitBtn_1 (Button, 0, 0, 120×95)
│   │   │   ├── nameLabel (Label "猛犸骑手", 0, 16)
│   │   │   └── costLabel (Label "80g", 0, -14)
│   │   ├── evolveBtn (Button, 140, 0, 120×95)
│   │   │   ├── nameLabel (Label "进化", 0, 16)
│   │   │   └── costLabel (Label "0/800", 0, -14)
│   │   ├── unitBtn_0_cd (Node, -140, 0, active=false)
│   │   │   └── Label "3s"
│   │   └── unitBtn_1_cd (Node, 0, 0, active=false)
│   │       └── Label "3s"
│   │
│   └── GameOverPanel (Node, 0, 0, active=false)
│       ├── maskBg (Sprite, 全屏半透明 #000000, alpha=180)
│       ├── panelBg (Sprite, #1a202c, 380×340)
│       ├── resultLabel (Label "胜利！", 0, 100, 36)
│       ├── statsLabel (Label "统计数据", 0, 30, 16)
│       ├── restartBtn (Button "再来一局", -80, -70, 130×48)
│       └── lobbyBtn (Button "返回大厅", 80, -70, 130×48)
```

---

## 第七部分：脚本与属性绑定

> ⚠️ **这一步在我（AI）写完脚本后做**。先按以上步骤搭好场景结构和预制体，等我提交代码后，你再按此对照表进行拖拽绑定。

### WarEvo.ts 绑定表（挂 Canvas）

| 属性 | 类型 | 拖拽绑定目标 |
|------|------|------------|
| `castlePlayer` | Castle | Castle_Player 节点 |
| `castleEnemy` | Castle | Castle_Enemy 节点 |
| `unitContainer` | Node | UnitContainer 节点 |
| `unitPrefab` | Prefab | Unit 预制体资源（从资源管理器拖） |
| `uiController` | UIController | UI_Overlay 节点 |

### UIController.ts 绑定表（挂 UI_Overlay）

| 属性 | 类型 | 拖拽绑定目标 |
|------|------|------------|
| `goldLabel` | Label | topBar → goldLabel |
| `ageLabel` | Label | topBar → ageLabel |
| `killLabel` | Label | topBar → killLabel |
| `playerHP` | ProgressBar | topBar → playerHP |
| `enemyHP` | ProgressBar | topBar → enemyHP |
| `hpPlayerLabel` | Label | topBar → hpPlayerLabel |
| `hpEnemyLabel` | Label | topBar → hpEnemyLabel |
| `unitBtn0` | Button | bottomBar → unitBtn_0 |
| `unitBtn1` | Button | bottomBar → unitBtn_1 |
| `evolveBtn` | Button | bottomBar → evolveBtn |
| `unitName0` | Label | unitBtn_0 → nameLabel |
| `unitCost0` | Label | unitBtn_0 → costLabel |
| `unitName1` | Label | unitBtn_1 → nameLabel |
| `unitCost1` | Label | unitBtn_1 → costLabel |
| `evolveNameLabel` | Label | evolveBtn → nameLabel |
| `evolveCostLabel` | Label | evolveBtn → costLabel |
| `gameOverPanel` | Node | GameOverPanel 节点 |
| `resultLabel` | Label | GameOverPanel → resultLabel |
| `statsLabel` | Label | GameOverPanel → statsLabel |
| `restartBtn` | Button | GameOverPanel → restartBtn |
| `lobbyBtn` | Button | GameOverPanel → lobbyBtn |

### Castle.ts 绑定表（挂每个城堡节点）

| 属性 | 类型 | 拖拽绑定目标 |
|------|------|------------|
| `hpBar` | Sprite | castle → hpBar（脚下绿条） |
| `hpBarBg` | Sprite | castle → hpBarBg（脚下灰底） |

### Unit.ts 绑定表（挂 Unit 预制体根节点）

| 属性 | 类型 | 拖拽绑定目标 |
|------|------|------------|
| `body` | Sprite | Unit → body |
| `hpBarFill` | Sprite | Unit → hpBarFill |
| `hpBarBg` | Sprite | Unit → hpBarBg |

> **绑定方法**：在场景中选中目标节点 → Inspector 中脚本组件的对应属性槽 → 从层级管理器或资源管理器把目标拖拽进去。

---

## 第八部分：自检清单

搭建完成后，逐项检查：

- [ ] Canvas 设计分辨率 720×1280，Fit Height + Fit Width
- [ ] 战场背景 `bgGround` 颜色 `#16213e`，定位正确
- [ ] 路径线 `pathLine` 在 y=60，颜色 `#4a5568`
- [ ] 玩家城堡在 `(-280, 60)`，颜色蓝色 `#4488FF`
- [ ] 敌方城堡在 `(280, 60)`，颜色红色 `#FF4444`
- [ ] 两个城堡都有 Castle 脚本占位
- [ ] 两个城堡脚下都有 `hpBarBg` + `hpBar`，锚点正确
- [ ] UnitContainer 为空节点，在 BattleArea 下
- [ ] topBar 在 y=560，合理四行布局
- [ ] `playerHP_bg` + `enemyHP_bg` 背景 Sprite 已创建（#333333, 100×12）
- [ ] `playerHP` 和 `enemyHP` 均为 ProgressBar，Total Length=100，Bar Sprite 已绑定
- [ ] `hpPlayerLabel` 居中于 playerHP 下方（x=-150, y=-24）
- [ ] `hpEnemyLabel` 居中于 enemyHP 下方（x=150, y=-24）
- [ ] `goldLabel` **没有设置 UITransform 宽度**（文本自适应，避免溢出到 ageLabel）
- [ ] `goldLabel` 左对齐，位置靠左（x=-137），与 ageLabel 有充足间距
- [ ] `killLabel` 右对齐，在右侧（x=130），不从右边界溢出
- [ ] `ageLabel` 居中，无固定宽度
- [ ] `divider` 在 y=-72
- [ ] `bottomBar` 在 y=-460
- [ ] `bottomDivider` 在 y=68（局部坐标），700×1
- [ ] 三个按钮 `unitBtn_0`（-140）、`unitBtn_1`（0）、`evolveBtn`（140），各 120×95
- [ ] 每个按钮内 `nameLabel`（y=16）+ `costLabel`（y=-14）都存在
- [ ] `unitBtn_0_cd` 和 `unitBtn_1_cd` 是 **bottomBar 的子级**（不是 UI_Overlay 的子级）
- [ ] 冷却遮罩初始 Active 取消勾选
- [ ] GameOverPanel **active 取消勾选**
- [ ] GameOverPanel 内 `resultLabel`、`statsLabel`、`restartBtn`、`lobbyBtn` 全部存在
- [ ] Unit.prefab 中 `hpBarFill` 锚点 X=0（左对齐）
- [ ] 场景已保存

---

*文档结束*
