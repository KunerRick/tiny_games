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
