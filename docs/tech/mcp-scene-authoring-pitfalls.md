# MCP 操作 Cocos 场景/预制体的踩坑与规范

> **适用**：用 Cocos MCP 增删节点、挂组件、绑 `@property` 时。
> **来源**：本项目的实际事故记录（教训 B、C）与 MCP 使用守则。
> 速查版在 [`../../AGENTS.md`](../../AGENTS.md) 的 **MCP 使用守则**；这里给出根因与完整做法。

---

## 1. 核心原则

**所有 Cocos 场景/预制体的查询与修改都必须走 MCP，只有纯 `.ts` 源码可以直接改文件。**

- ❌ 不要用文件工具读写 `.scene` / `.prefab` JSON —— 会破坏编辑器元数据
- ✅ 场景查询与修改用 MCP 工具（本目录工具见 §5）

---

## 2. ⚠️ 按钮/可点击元素：优先 Node 事件委托

### 现象（事故 B）

新增 `AttackButton` 后，用 MCP 把 `BattleUI.attackButton` 绑到**节点 UUID**：

- 属性声明是 `@property({ type: Button })`
- 运行时 `attackButton.node` 为 `undefined`
- `bindEvents()` 抛 `Cannot read properties of undefined (reading 'on')`

### 根因

`@property({ type: Button })` 期望引用的是 **Button 组件的 `__id__`**，不是节点的 `__id__`。
MCP 绑节点 UUID → 拿到的是 Node 而非 Button 组件 → `.node` 不存在。

### ✅ 推荐做法：Node 事件委托

```typescript
@property({ type: Node, tooltip: 'XXX按钮节点' })
confirmButton: Node = null;

private bindEvents(): void {
    if (this.confirmButton) {
        this.confirmButton.on(Node.EventType.TOUCH_END, this.onConfirmClicked, this);
    }
}

private unbindEvents(): void {
    if (this.confirmButton) {
        this.confirmButton.off(Node.EventType.TOUCH_END, this.onConfirmClicked, this);
    }
}

private onConfirmClicked(): void { /* ... */ }
```

好处：MCP 只需绑**节点 UUID**，不必关心 Button 组件；显隐用 `this.confirmButton.active = true/false`。

---

## 3. ⚠️ 复制节点得到的新按钮可能没有 Button 组件

### 现象（事故 C）

复制 `WaitButton` 得到 `AttackButton`，但新节点缺少 `Button` 组件：

- `getComponent(Button)` 返回 `null`
- 按钮无响应

### 正确做法（二选一）

1. 走 §2 的 **Node 事件方案**（推荐，不依赖 Button 组件）；
2. 仍要用 Button 引用时，在 MCP 创建/复制节点后**显式补组件**：`component_add_component` 添加 `cc.Button`，
   并确保 `@property` 绑的是 **Button 组件 UUID**（不是节点 UUID）。

> `cc.Button` 的 `@requireComponent` 会自带 `UITransform`。**不要再 `addComponent(UITransform)`**，否则同节点挂两个 `UITransform`（本轮实测踩到）。需要时用 `getComponent(UITransform)` 取用。

### 重复 `UITransform` 的隐性后果：节点尺寸"看起来改了却没生效"

两个 `UITransform` 里只有引擎**实际使用的那一个**参与布局。后续 `setContentSize(...)` 若落到另一个上，节点的真实尺寸**仍是插入第一个渲染组件时的默认值 `100×100`**。

实例（P1 战斗界面兵牌）：代码里 `card.addComponent(Sprite)`（已自带 `UITransform`）后又 `card.addComponent(UITransform)`，再把 `setContentSize(110, 65)` 设到后者 —— 结果卡片真实尺寸仍是 `100×100`，而排布按"高 65 + 间距 8"计算 → **每张卡与下一张重叠 27~33px**。

运行时可这样自查（别只看代码，看实际值）：

```js
card.components.map(c => c.constructor.name)   // 出现两个 "UITransform" 就有问题
card.getComponent('cc.UITransform').contentSize  // 与预期不符即为症状
```

**正确写法**：`Sprite`/`Label`/`Button` 加完后，用 `getComponent(UITransform)` **取用**自带的那个：

```ts
const bg = card.addComponent(Sprite);            // @requireComponent 已带上 UITransform
bg.sizeMode = Sprite.SizeMode.CUSTOM;            // 让 color/contentSize 生效
const ui = card.getComponent(UITransform);       // 取用，不新增
if (ui) ui.setContentSize(w, h);
```

> 顺带：用纯色块做背景时 `sizeMode` 要设 `CUSTOM`，否则尺寸由 `spriteFrame` 决定。

### ⚠️ 赋值顺序：`contentSize` 必须最后设

即使 `sizeMode` 最终是 `CUSTOM`，**写入顺序错了尺寸依然会被覆盖**：设完 `contentSize` 再设 `spriteFrame`，引擎会按贴图原始尺寸重算一次（本项目默认贴图是 `2×2` 的九宫格），结果节点变成 `2×2`。

本项目两轮都踩到这个坑（P1 的 `PhaseBar`、P2 的 `ContinueBtn`），正确顺序固定为：

```
spriteFrame → sizeMode(CUSTOM) → type(SIMPLE) → color → contentSize（最后）
```

自查（**别只看代码，读实际值**）：

```js
const sp = node.getComponent('cc.Sprite');
const ui = node.getComponent('cc.UITransform');
console.log(sp.sizeMode, ui.contentSize);   // contentSize 与预期不符即为症状
```

> 实例：`PhaseBar` 期望 `640×40`，实测 `2×2` —— 面板底板与文字都对，只有背景块缩成一个点，肉眼容易漏看。

---

## 3.5 ⚠️ MCP 写入的两个静默失败（值看着设了、实际没生效）

这两个坑的共同点：**MCP 都返回 `success: true`**，只有读回实际值才能发现。

### ① `cc.UITransform.anchorPoint`：`value.x = 0` 会被吞掉

写 `{x: 0, y: 0.5}` 读回 `{x: 0.5, y: 0.5}`；写 `{x: 1, ...}` 则正常。也就是说**左对齐/上对齐的锚点在 MCP 里设不上**。

受影响的表现：`UnitInfoPanel` 的子节点按"左对齐"排布时整体右移 40px、溢出容器。

绕开方式 —— 用 `sceneAdvanced_execute_component_method` 直接调引擎方法：

```js
// 先取 UITransform 组件的 uuid
const ui = (await call('component_get_components', { nodeUuid }))
  .data.components.find(c => c.type === 'cc.UITransform');

await call('sceneAdvanced_execute_component_method', {
  uuid: ui.properties.uuid.value,     // 注意：组件 uuid，不是节点 uuid
  name: 'setAnchorPoint',
  args: [0, 0.5],
});
// 读回核对：anchorPoint 应为 {x:0, y:0.5}
```

> 任何 `anchorPoint` 写入后都要**读回核对**，尤其 `x=0`。

### ② 容器节点用 `getBoundingBoxToWorld()` 量尺寸会偏大

`getBoundingBoxToWorld()` **合并所有后代的包围盒**，所以对"有子节点的容器"返回的是子树并集，不是自身矩形。本项目实测：`UnitInfoPanel` 自身 `200×100`（`contentSize` 与 `getBoundingBox()` 都正确），但 `getBoundingBoxToWorld()` 返回 `380×141` → 早期探针据此报出一堆假重叠。

自算自身世界矩形：

```js
const ui = node.getComponent('cc.UITransform');
const w = ui.convertToWorldSpaceAR(new cc.Vec3(0, 0, 0));
const rect = [
  w.x - ui.width * ui.anchorX,
  w.y - ui.height * (1 - ui.anchorY),
  ui.width, ui.height,
];
```

### ③ 审计结论要用「真实代码路径」产出

手工把面板 `active = true` 去测，得到的重叠/溢出**可能与玩家看到的不一致**：那样绕过了 `showVictory()` 这类方法里"隐藏其他面板"的逻辑，于是测出 100% 重叠等假象。

**正确做法**：调真实入口（`showDeployPhase()` / `showVictory(...)` / `showDefeat(...)`）再测量；测完还原可见性。

### ④ `@property` 是组件类型时：`propertyType` 用 `component`、值传**节点** UUID

绑定 `@property({ type: Label })` 这类组件引用时，`propertyType` 写 `"cc.Label"` 会被直接拒绝：

```
Failed to set property: Unsupported property type: cc.Label
```

`propertyType` 的合法取值里**没有** `cc.Xxx`：

```
string | number | boolean | integer | float | color | vec2 | vec3 | size
node | component | spriteFrame | prefab | asset
nodeArray | colorArray | numberArray | stringArray
```

正确做法是 `propertyType: 'component'` + `value` = **目标节点 UUID**（MCP 会按属性元数据在该节点上自动找所需组件）：

```js
await call('component_set_component_property', {
  nodeUuid: gmNodeUuid,                      // 属性所在的节点
  componentType: 'd9ba2ybHbJLroUxmNge1oOA',  // 脚本 classId（不是类名）
  property: 'turnLabel',
  propertyType: 'component',                 // ← 不是 'cc.Label'
  value: 'TurnLabel 的节点 uuid',            // ← 节点 uuid，不是组件 uuid
});
```

两个配套注意点：

- `componentType` 用脚本的 **classId**（`@ccclass` 生成的短 id），不是 `TinyVanguardMain` 这类显示名。拿不到时先 `component_get_components`，读返回里那个非 `cc.` 前缀的 `type`。
- `component_get_components` 返回中，**内置组件的 `uuid` 常常是 `null`**（如 `cc.Label`、`cc.UITransform`），不要拿它当引用值 —— 这正是必须"传节点 uuid"的原因。

> 前提：新增 `@property` 之后必须先 `project_refresh_assets`，否则编辑器里还没有这个字段，绑定会报 `Property 'xxx' not found`。

### ⑤ 跨面板常驻的 HUD：显隐只能有**一个**管理者

`HudTop`（回合 + 金币）挂在 `Canvas` 根级，不属于任何面板。若让 `BattleUI` 管 `turnLabel`、`TinyVanguardMain` 管 `goldLabel`，必然出现"没人管的那个残留"：`BattleUI` 节点本身 `active = false` 时其 `onLoad()` **不执行**，于是没人关 `turnLabel` → 职业选择/路线图/通关界面都顶着「回合 1」，左右也不再对称。

规则：

- 常驻节点的 `active` 收敛到**一个**出口方法（如 `setHudVisible(gold, turn)`），在每个状态切换点（开局 / 路线图 / 战斗 / 商店 / 休息 / 事件 / 结算）显式调用；
- 面板类只负责写它的**文本**，不负责它的 `active`。

同理，结算时要顺手清掉"上一阶段的残留"：`onRunComplete()` 原先只关了 `gridController`（网格）—— 但战斗单位是 **`BattleManager` 的直接子节点**，最后一关的敌人会叠在结算面板上。改为一并 `battleManager.node.active = false`。

### ⑥ `ScrollView.horizontal = false` 不会校正 content 的 x

`content` 存的是 `x = -325`，而纵向 ScrollView 只对齐/夹取 `y`，**x 原样保留** → 整块内容左移 325px：左列节点 world `x ∈ [-95, -15]`，而画布可见区从 `x = 0` 起，**整列被裁到屏幕外**。

口诀：`content` 的位置要**读回实际值**，别只信"它应该居中"。

```js
// 水平居中：x 归 0（y 交给 ScrollView 自己 clamp）
await call('node_set_node_transform', { uuid: CONTENT, position: { x: 0, y: y0, z: 0 } });
```

### ⑦ 固定表头 + 全屏滚动区：第一行内容会被表头压住

`view` 占满 `720×1280` 时，`ScrollView` 会把 `content` 顶部钉在 view 顶部（`y = 1280`），而浮在顶部的进度/图例标签在 `y ≈ 1198~1270` —— 第一行节点（`y 1160~1240`）就被图例压住 `80×28`。

修法：把滚动区收到表头**之下**（本例 `view` 高 `1280 → 1160`、中心下移 60），让 `content` 的可视顶部落在图例下方。

**教训**：任何"固定表头 + 滚动内容"的组合，都要按**表头底边**给滚动区定高，而不是让滚动区占满全屏。

---

## 4. 同一节点只能有一个渲染组件

节点同时挂 `Label` 与 `Sprite` 会触发运行时警告：

```
Can't add renderable component to this node because it already have one.
```

**正确做法**：背景 `Sprite` 与文字 `Label` 分到不同节点（按钮节点放 `Sprite`，子节点放 `Label`）。

自查：`node.components.map(c => c.constructor.name)` 看是否出现两个渲染组件。

---

## 5. 结构性变更的调用顺序

```
begin_undo_recording
  → 增删节点 / 挂组件 / 改属性（node_* / component_*）
end_undo_recording
  → validate_scene            // 一致性检查
  → lsp_diagnostics           // 若改了脚本
  →（需要落盘时）save_scene
```

**场景排查顺序**：`get_scene_hierarchy` → `get_node_info` → `validate_scene` → 日志 → `execute_script`。

---

## 6. 检查清单

- [ ] 可点击元素声明为 `@property({ type: Node })`，事件用 `Node.EventType.TOUCH_END`
- [ ] `@property` 的绑定值与声明类型匹配（Node → 节点 UUID；Button → 组件 UUID）
- [ ] 新按钮节点确认有 `Button` 组件或走 Node 方案
- [ ] 同一节点没有两个渲染组件（`Sprite` + `Label` 分节点）
- [ ] 结构性变更被 `begin/end_undo_recording` 包裹，变更后跑过 `validate_scene`
- [ ] 没有用文件工具直接改 `.scene` / `.prefab`
