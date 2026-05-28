# Cocos Creator 3.x 最佳实践与常见陷阱

本文档汇总了项目开发中遇到的 Cocos Creator 3.x 常见问题和最佳实践，供开发参考。**防崩溃规则速查请直接看 [AGENTS.md](../AGENTS.md#ai-写代码前必读--cocos-creator-防崩溃守则)**。

## 快速导航

| 章节 | 关键内容 |
|------|---------|
| [§1](#1-节点生命周期与-active-状态) | 面板类 `show()` 中绑定事件，`onLoad()` 不执行于未激活节点 |
| [§2](#2-事件绑定与解绑) | 成对绑定/解绑、避免匿名 lambda |
| [§3](#3-tween-动画最佳实践) | Tween 前检查 `isValid`；不直接 tween Color 对象 |
| [§4](#4-组件销毁安全规范) | **`onDestroy` 不碰 `@property(Node)`、`_cleanupGame` 与 `onDestroy` 分离、`Array.from` 陷阱** |

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

**解决方案**：在 `show()` 方法中绑定事件

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

**问题场景**：策划或开发者在场景中不小心勾选了面板节点（`active = true`），游戏启动时面板就显示出来。

**解决方案**：使用状态标志位确保初始状态正确

```typescript
@ccclass('GameOverPanel')
export class GameOverPanel extends Component {
    private _showCalled: boolean = false;

    onLoad() {
        if (!this._showCalled) {
            this.node.active = false;
        }
    }

    show() {
        this._showCalled = true;
        this.bindEvents();
        this.node.active = true;
    }
}
```

---

## 2. 事件绑定与解绑

### 2.1 必须成对出现

```typescript
bindEvents() {
    this.button?.node.on(Node.EventType.TOUCH_END, this.onClick, this);
}

unbindEvents() {
    this.button?.node.off(Node.EventType.TOUCH_END, this.onClick, this);
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

## 3. Tween 动画最佳实践

### 3.1 不要直接 Tween Color 对象

**问题**：`tween(colorObject)` 对普通 Color 对象不支持 `onUpdate` 等链式调用，且 `Sprite.color` 返回内部共享对象。

```typescript
// ❌ 错误：直接 tween Color 对象
const tweenColor = this.body.color.clone();
this._flashTween = tween(tweenColor)
    .to(0.1, originalColor)
    .onUpdate(() => { this.body.color = tweenColor.clone(); }) // ❌ 报错
    .start();

// ✅ 正确：对 Sprite 组件的 color 属性做动画
this.body.color = Color.WHITE.clone();
this._flashTween = tween(this.body)
    .to(0.1, { color: originalColor })
    .call(() => { this._flashTween = null; })
    .start();
```

### 3.2 Tween 前检查节点有效性

```typescript
private triggerHitFlash(): void {
    if (!this.body || !this.body.isValid) return;
    if (this._flashTween) {
        this._flashTween.stop();
        this._flashTween = null;
    }
}
```

### 3.3 Tween 清理规范

```typescript
if (this._flashTween) {
    this._flashTween.stop();
    this._flashTween = null;
}
```

### 3.4 触摸事件中的 Tween 安全

```typescript
// ❌ 错误：节点可能在动画完成前被销毁
private onTouchStart(event: EventTouch) {
    tween(this.node).to(0.1, { scale: 0.95 }).start();
}

// ✅ 正确：动画前检查节点有效性
private onTouchStart(event: EventTouch) {
    if (!this.node?.isValid) return;
    tween(this.node).to(0.1, { scale: 0.95 }).start();
}
```

### 3.5 公共动画方法的安全检查

```typescript
public playMergeAnimation(): void {
    if (!this.node?.isValid) return;
    tween(this.node).to(0.1, { scale: 1.25 }).start();
}
```

---

## 4. 组件销毁安全规范

### 4.1 使用 `isValid` 而非简单的空检查

```typescript
// ❌ 错误：只检查 null
if (!this.node) return;

// ✅ 正确：检查 isValid 属性
if (!this.node?.isValid) return;
if (!this.body?.isValid) return;
```

### 4.2 延迟操作中的有效性检查

```typescript
scheduleOnce(() => {
    if (!this.node?.isValid) return;  // 节点可能已被销毁
    this.doSomething();
}, 1.0);
```

### 4.3 数组遍历销毁不用 `Array.from`

**问题**：引擎内部在场景销毁时可能清空组件字段，`Array.from(null)` 抛 `"Can't call method on null"`。

```typescript
// ❌ 崩：_bodyNodes 可能为 null
const copy = Array.from(this._bodyNodes);

// ✅ 对：反向 for + null guard
if (this._bodyNodes) {
    for (let i = this._bodyNodes.length - 1; i >= 0; i--) {
        const node = this._bodyNodes[i];
        if (node && node.isValid) {
            node.destroy();
        }
    }
    this._bodyNodes = [];
}
```

### 4.4 `@property` getter 在节点销毁后返回 null

**Cocos Creator 3.x 的已知行为**：`@property(Node)` 装饰的属性通过 getter 访问。场景销毁时 Cocos 深度优先递归销毁子节点，如果 `@property` 引用的节点先于当前组件被销毁，后续访问 getter 会返回 `null`。

```typescript
@property(Node)
gameArea: Node | null = null;

onDestroy() {
    // ❌ 崩：if 判断时 gameArea 非空，但执行到下一行时 getter 返回 null
    if (this.gameArea) {
        this.gameArea.off(...);  // Cannot read properties of null
    }
}
```

**解决方案**：

```typescript
// ✅ onDestroy 中不访问任何 @property(Node)
onDestroy() {
    // Cocos 自动移除以当前组件为 target 的事件
    this._snake = null;
    this._foodSpawner = null;
}

// ✅ 非销毁场景下：缓存到局部变量，避免多次 getter
restartGame(): void {
    const area = this.gameArea;
    if (area) {
        area.removeAllChildren();
    }
}
```

### 4.5 `_cleanupGame()` 与 `onDestroy()` 职责分离

同一个组件中，**"同一场景内重新开始"** 和 **"场景销毁返回大厅"** 的清理逻辑必须分开：

```typescript
// ✅ 正确：两条路径各自独立
private _onRestart(): void {
    this._cleanupGame();  // 手动清理节点 + 事件（场景存活，节点可访问）
    this._initGame();
}

onDestroy() {
    // 场景销毁，Cocos 会处理节点和事件
    // 只清引用，不调任何节点/组件方法
    this._snake = null;
    this._foodSpawner = null;
}
```

| 路径 | 调用链 | 能否访问 `@property(Node)` | 谁销毁节点 |
|------|--------|---------------------------|-----------|
| 重新开始 | `_onRestart()` → `_cleanupGame()` | ✅ 存活节点 | 手动 `_cleanupGame()` |
| 返回大厅 | `loadScene()` → `onDestroy()` | ❌ 已被销毁 | Cocos 引擎 |
