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

### 1.4 防御性编程：处理场景配置错误

**问题场景**：
- 策划或开发者在场景中不小心勾选了面板节点（`active = true`）
- 游戏启动时面板就显示出来，破坏游戏体验

**解决方案**：使用状态标志位确保初始状态正确

```typescript
@ccclass('GameOverPanel')
export class GameOverPanel extends Component {
    private _showCalled: boolean = false;

    onLoad() {
        // 只有 show() 未被调用时才隐藏
        // 防止场景配置错误（节点被勾选）导致面板提前显示
        if (!this._showCalled) {
            this.node.active = false;
        }
    }

    show() {
        this._showCalled = true;
        // 绑定事件、更新数据...
        this.node.active = true;
    }
}
```

**关键点**：
- `_showCalled` 标志位确保 `onLoad()` 不会覆盖 `show()` 的状态
- 即使节点在场景中被勾选，游戏开始时也不会显示
- 只有显式调用 `show()` 后，面板才会显示

**适用场景**：
- 游戏结束面板
- 设置面板
- 弹窗/对话框
- 任何需要代码控制显示时机的 UI 组件

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

## 6. Tween 动画最佳实践

### 6.1 不要直接 Tween Sprite 的 color 属性

**问题场景**：
- 使用 `tween(this.body.color)` 直接对 Sprite 的 color 做动画
- 节点在动画过程中被销毁，导致 `Uint8ClampedArray.set` 越界错误

**根本原因**：
- `Sprite.color` 返回的是内部共享的 `Color` 对象
- 直接 tween 会修改这个共享对象，节点销毁后对象失效

**解决方案**：

```typescript
// ❌ 错误：直接 tween Sprite 的 color
this.body.color = Color.WHITE;
this._flashTween = tween(this.body.color)
    .to(0.1, originalColor, { easing: 'linear' })
    .start();

// ✅ 正确：使用独立的 color 对象做动画
this.body.color = Color.WHITE.clone();
const tweenColor = this.body.color.clone();

this._flashTween = tween(tweenColor)
    .to(0.1, originalColor, { easing: 'linear' })
    .onUpdate(() => {
        if (this.body?.isValid) {
            this.body.color = tweenColor.clone();
        }
    })
    .start();
```

### 6.2 Tween 前检查节点有效性

```typescript
// ✅ 正确：动画前检查节点是否有效
private triggerHitFlash(): void {
    if (!this.body || !this.body.isValid) return;
    
    // 停止之前的 tween
    if (this._flashTween) {
        this._flashTween.stop();
        this._flashTween = null;
    }
    
    // 开始新的 tween...
}
```

### 6.3 Tween 清理规范

```typescript
// ✅ 正确：停止 tween 后清空引用
if (this._flashTween) {
    this._flashTween.stop();
    this._flashTween = null;  // 清空引用，避免内存泄漏
}
```

---

## 7. 节点有效性检查

### 7.1 使用 `isValid` 而非简单的空检查

```typescript
// ❌ 错误：只检查 null
if (!this.node) return;

// ✅ 正确：检查 isValid 属性
if (!this.node?.isValid) return;

// ✅ 正确：组件也支持 isValid
if (!this.body?.isValid) return;
```

### 7.2 延迟操作中的有效性检查

```typescript
// 在回调或 tween 中访问节点前，务必检查有效性
scheduleOnce(() => {
    if (!this.node?.isValid) return;  // 节点可能已被销毁
    this.doSomething();
}, 1.0);
```

---

## 8. AI 协作相关

### 8.1 代码与场景的配合

- **AI 负责**：`.ts` 脚本逻辑、组件代码
- **人负责**：`.scene` 场景配置、节点绑定

### 8.2 属性绑定检查清单

当 AI 修改了 `@property` 定义后，人需要检查：

- [ ] 新属性在 Inspector 中可见
- [ ] 节点/组件已拖拽绑定
- [ ] 节点 `active` 状态正确
- [ ] 层级关系正确

---

## 相关文档

- [项目规范](../AGENTS.md)
- [2048 游戏设计](./specs/2026-05-13-game-2048-design.md)
