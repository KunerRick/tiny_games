# Tiny Games 项目规范

## 文档存放规范

**所有项目文档统一存放到 `docs/` 目录下**，包括：
- 设计文档 (`docs/design/`)
- 规格说明 (`docs/specs/`)
- 技术方案 (`docs/tech/`)
- 会议记录 (`docs/meetings/`)
- API 文档 (`docs/api/`)

禁止将文档分散存放在项目根目录或其他位置。

## 项目概述

小游戏集合，基于 Cocos Creator 3.x 开发，支持发布到微信小游戏和移动端 App。

- **引擎**: Cocos Creator 3.x
- **语言**: TypeScript
- **首要平台**: 微信小游戏
- **次要平台**: iOS/Android App
- **架构**: 独立场景模式，每游戏独立场景，通过游戏大厅切换时重新加载

## 项目结构

```
tiny_games/
├── assets/
│   ├── main/           # 主入口（游戏大厅）
│   ├── games/          # 各游戏独立目录
│   ├── common/         # 公共模块
│   └── resources/      # 动态加载资源
├── build/              # 构建输出
├── docs/               # 项目文档（所有文档统一存放）
└── settings/           # Cocos 项目设置
```

## AI 协作规范

### 人与 AI 的分工

| 谁做 | 负责 | 原因 |
|------|------|------|
| **人** | `.scene` / `.prefab` / `.meta` / 资源导入 | Cocos Creator 可视化编辑器操作，AI 直接改场景 JSON 极其脆弱（`__id__` 是数组下标，增删易错且无视觉反馈） |
| **AI** | `.ts` 脚本逻辑、bug 诊断、代码结构设计、文档编写 | 代码是纯文本，AI 擅长 |

### 场景变更协作流程

1. **AI 需要改动场景（节点树、组件、布局、资源引用）时，不直接修改 `.scene` 文件**，而是给出精确的"操作说明"，由人在 Cocos Creator 编辑器中执行。
2. 操作说明按以下格式给出：
   - 操作目标（选中哪个节点）
   - 具体步骤（创建/修改/删除什么，参数值）
   - 预期的最终结构（树状图或布局示意图）
3. 对于**纯数值修复**（如修改一个字段的值、改一个 `__id__` 引用），不涉及数组结构变动的，AI 可以直接修改 `.scene` JSON。

### 脚本与场景的接口规范

- AI 在脚本中用 `@property` 装饰器定义需要场景连接的组件/节点引用
- 所有 `@property` 按用途分组、加注释，方便在 Inspector 中识别
- 人在编辑器中完成 `@property` 的拖拽绑定

## AI 写代码前必读 — Cocos Creator 防崩溃守则

以下规则来自 [最佳实践文档](./docs/cocos-best-practices.md)（内有详细解释和更多代码示例），违反会导致运行时崩溃。

### 🚨 规则 1：永远不用匿名 lambda 做事件 handler

```typescript
// ❌ 崩：无法解绑，每次重启泄露
button.node.on(CLICK, () => this.onClick(), this);
// ✅ 对：命名方法可解绑
button.node.on(CLICK, this.onClick, this);
```

详见 [§2.2](./docs/cocos-best-practices.md#22-使用箭头函数注意)

### 🚨 规则 2：`onDestroy()` 中不访问任何 `@property(Node)`

场景销毁时，被引用节点可能已被引擎销毁，`@property` getter 返回 `null`：

```typescript
// ❌ 崩：this.gameArea?.off(...) — gameArea getter 已返回 null
// ✅ 对：onDestroy 中只清 JS 引用，不碰任何节点方法
onDestroy() { this._snake = null; this._foodSpawner = null; }
```

事件由 Cocos 自动移除（注册时第三个参数 `this` 作为 target 的，全部自动清理）。

详见 [§4.4](./docs/cocos-best-practices.md#44-property-getter-在节点销毁后返回-null)

### 🚨 规则 3：重启清理 ≠ 场景销毁清理

| 路径 | 调用链 | 能否访问 `@property(Node)` | 谁销毁节点 |
|------|--------|---------------------------|-----------|
| 重新开始 | `_onRestart()` → `_cleanupGame()` | ✅ 存活节点 | 手动 `_cleanupGame()` |
| 返回大厅 | `loadScene()` → `onDestroy()` | ❌ 已被销毁 | Cocos 引擎 |

两条路径必须分别实现，`onDestroy()` 不能调用 `_cleanupGame()`。

详见 [§4.5](./docs/cocos-best-practices.md#45-cleanupgame-与-ondestroy-职责分离)

### ⚠️ 规则 4：遍历销毁不用 `Array.from`

引擎内部在场景销毁时可能清空组件字段，`Array.from(null)` 抛异常。用反向 `for` + null guard：

```typescript
if (this._bodyNodes) {
    for (let i = this._bodyNodes.length - 1; i >= 0; i--) { ... }
}
```

详见 [§4.3](./docs/cocos-best-practices.md#43-数组遍历销毁不用-arrayfrom)

### ⚠️ 规则 5：destroy 前检查 `isValid`

```typescript
if (node && node.isValid) { node.destroy(); }
```

### ⚠️ 规则 6：面板类在 `show()` 中绑定事件

未勾选的节点 `onLoad()` 不执行，事件绑定会丢失。

详见 [§1.2](./docs/cocos-best-practices.md#12-弹窗面板类组件的最佳实践)

## 相关文档

- [Cocos Creator 最佳实践（完整版）](./docs/cocos-best-practices.md)
- [2048 游戏设计](./docs/specs/2026-05-13-game-2048-design.md)
