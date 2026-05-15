# Cocos Creator 3.x 最佳实践与常见陷阱

本文档汇总了项目开发中遇到的 Cocos Creator 3.x 常见问题和最佳实践，供开发参考。

---

## 1. 节点生命周期与 `active` 状态

### 1.1 核心规则

| 节点状态 | `onLoad` 是否执行 | 组件是否可用 |
|---------|------------------|-------------|
| `active = true`（场景勾选） | ✅ 执行 | ✅ 可用 |
| `active = false`（场景未勾选） | ❌ 不执行 | ❌ 不可用 |

### 1.2 弹窗/面板类组件的最佳实践

**问题场景**：
- GameOverPanel 节点在场景中未勾选（`active = false`）
- 代码中在 `onLoad()` 里绑定按钮事件
- 结果：`onLoad()` 不执行，按钮事件未绑定，面板显示后按钮无法点击

**解决方案**：像 SettingsPanel 一样，在 `show()` 方法中绑定事件

```typescript
// ❌ 错误：在 onLoad 中绑定，如果节点未勾选则不执行
onLoad() {
    this.restartButton?.node.on(Node.EventType.TOUCH_END, this.onRestart, this);
}

show() {
    this.node.active = true; // 按钮事件未绑定！
}

// ✅ 正确：在 show 中绑定，确保节点已激活
onLoad() {
    this.node.active = false; // 只负责隐藏
}

show() {
    this.bindEvents();        // 绑定事件
    this.node.active = true;  // 显示面板
}

hide() {
    this.unbindEvents();      // 解绑事件
    this.node.active = false; // 隐藏面板
}
```

### 1.3 节点初始状态规范

| 组件类型 | 场景中的 `active` | 代码处理 |
|---------|------------------|---------|
| 始终显示的 UI | ✅ 勾选 | 无需处理 |
| 弹窗/面板 | ❌ 不勾选 | `onLoad()` 中设为 `false` |
| 动态创建的元素 | ❌ 不勾选 | 实例化后控制显示 |

---

## 2. 事件绑定与解绑

### 2.1 必须成对出现

```typescript
// ✅ 正确：绑定和解绑成对
bindEvents() {
    this.button?.node.on(Node.EventType.TOUCH_END, this.onClick, this);
}

unbindEvents() {
    this.button?.node.off(Node.EventType.TOUCH_END, this.onClick, this);
}

// 在 show/hide 中调用
show() {
    this.bindEvents();
    this.node.active = true;
}

hide() {
    this.unbindEvents();
    this.node.active = false;
}
```

### 2.2 使用箭头函数注意

```typescript
// ❌ 错误：无法解绑
show() {
    this.button?.node.on(Node.EventType.TOUCH_END, () => {
        this.onClick();
    }, this);
}

hide() {
    // 无法解绑匿名函数！
}

// ✅ 正确：使用具名方法
show() {
    this.button?.node.on(Node.EventType.TOUCH_END, this.onClick, this);
}

hide() {
    this.button?.node.off(Node.EventType.TOUCH_END, this.onClick, this);
}
```

---

## 3. 渲染顺序与层级

### 3.1 确保面板在最上层

```typescript
show() {
    // 设置 siblingIndex 确保在最上层
    this.node.setSiblingIndex(9999);
    this.node.active = true;
}
```

### 3.2 层级管理建议

```
Canvas
├── 背景层 (zIndex: 0)
├── 游戏层 (zIndex: 10)
├── UI 层 (zIndex: 100)
│   ├── HUD (zIndex: 100)
│   └── 弹窗/面板 (zIndex: 200)
└── 顶层遮罩 (zIndex: 999)
```

---

## 4. 数据与显示同步

### 4.1 Tile ID 生成

**问题**：随机 ID 可能冲突，导致 `move()` 逻辑错误

**解决**：使用全局递增计数器

```typescript
// ❌ 错误：可能产生重复 ID
function generateTileId(): number {
    return Math.floor(Math.random() * 1000000);
}

// ✅ 正确：全局递增
let _tileIdCounter = 0;
function generateTileId(): number {
    return ++_tileIdCounter;
}
```

### 4.2 数组去重与有效性检查

```typescript
// 过滤无效 tile（位置未定义或超出边界）
const validTiles = tiles.filter(t =>
    t.row !== undefined && t.col !== undefined &&
    t.row >= 0 && t.row < gridSize &&
    t.col >= 0 && t.col < gridSize
);

// 使用 Map 去重（同一位置可能有多个 tile）
const positionMap = new Map<string, TileData>();
for (const t of validTiles) {
    const key = `${t.row},${t.col}`;
    if (!positionMap.has(key)) {
        positionMap.set(key, t);
    }
}
const uniqueTiles = Array.from(positionMap.values());
```

---

## 5. 常见错误排查清单

### 5.1 UI 不显示

| 检查项 | 排查方法 |
|-------|---------|
| 节点 `active` | 在场景中勾选节点 |
| 父节点 `active` | 检查父节点层级 |
| `siblingIndex` | 确保在最上层 |
| `opacity` | 检查透明度是否为 0 |
| `scale` | 检查缩放是否为 0 |
| `position` | 检查是否在屏幕外 |
| `UITransform` | 检查组件是否存在 |

### 5.2 按钮点击无响应

| 检查项 | 排查方法 |
|-------|---------|
| 节点 `active` | 确保节点已激活 |
| 事件绑定 | 在 `show()` 中绑定而非 `onLoad()` |
| 事件解绑 | 检查是否被意外解绑 |
| 遮挡层 | 检查是否有透明节点遮挡 |

### 5.3 游戏逻辑异常

| 检查项 | 排查方法 |
|-------|---------|
| Tile ID 冲突 | 使用全局递增 ID |
| 位置重复 | 使用 Map 去重 |
| 边界检查 | 确保行列在有效范围内 |
| 数组长度 | 检查 `tiles.length` 是否符合预期 |

---

## 6. AI 协作相关

### 6.1 代码与场景的配合

- **AI 负责**：`.ts` 脚本逻辑、组件代码
- **人负责**：`.scene` 场景配置、节点绑定

### 6.2 属性绑定检查清单

当 AI 修改了 `@property` 定义后，人需要检查：

- [ ] 新属性在 Inspector 中可见
- [ ] 节点/组件已拖拽绑定
- [ ] 节点 `active` 状态正确
- [ ] 层级关系正确

---

## 相关文档

- [项目规范](../AGENTS.md)
- [2048 游戏设计](./specs/2026-05-13-game-2048-design.md)
