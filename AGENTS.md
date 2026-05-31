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
| **人** | 视觉资产制作（绘图/UI素材/音频）、资源导入 | 创作类工作，AI 无法替代 |
| **AI** | `.ts` 脚本逻辑、**场景操作（节点/组件/属性，通过 MCP）**、**bug 诊断（MCP 调试工具）**、场景问题排查、代码结构设计、文档编写 | MCP 工具通过编辑器引擎安全操作，比直接改 JSON 可靠 |
| **人 + AI 协作** | `.prefab` 管理、复杂布局调整 | AI 通过 MCP 创建/更新，人确认视觉效果 |

### 场景变更协作流程

1. **AI 优先通过 MCP 工具操作场景**，包括但不限于：
   - 创建/删除/移动节点（`create_node`、`delete_node`、`move_node`）
   - 添加/移除组件（`add_component`、`remove_component`）
   - 设置组件属性（`set_component_property`）
   - 修改节点变换（`set_node_transform`）
   - 绑定脚本到节点（`attach_script`）
   - 管理 Prefab（`create_prefab`、`instantiate_prefab`）
    - 场景资源操作（`import_asset`、`create_asset`、`read_asset_content`）

2. **MCP 操作安全规范：**
   - 结构性变更（创建/删除节点、增删组件）前调用 `begin_undo_recording`，操作后调用 `end_undo_recording`
   - 操作完成后调用 `validate_scene` 检查场景一致性
   - 对修改的脚本文件运行 `lsp_diagnostics` 确认无类型错误

3. **MCP 预制体修改注意事项：**
   - **`update_prefab` 操作方向是 Prefab→Instance（还原/回退），不是 Instance→Prefab（同步）**。实测 `update_prefab` 调用 `scene/apply-prefab`，会将场景中实例还原为预制体原始状态，预制体文件不受影响
   - 正确修改预制体内容的工作流：`read_asset_content` 读取 → 修改 JSON → `save_asset(url, content)` 写入文件 → `reimport_asset(url)` 刷新引擎
   - `save_asset(url, content)` 是**文件内容写入**操作，传空内容会清空文件，不要用它做"保存"操作
   - 如果 MCP `instantiate_prefab` 返回成功但未返回 `nodeUuid`，用 `get_all_nodes` 确认节点是否创建成功

4. **MCP 属性修改确认的工作流：**

   以下两条路径已通过实际测试验证可行：

   **场景节点属性修改**（修改 → 保存 → 重新打开依然有效）：
   - `component_set_component_property` → `scene_save_scene`
   - 实时修改场景中节点的组件属性（Label 文字、Sprite 颜色等）
   - 调用 `scene_save_scene` 后关闭并重新打开场景，修改持久化保留
   - 注意：需要 `scene_save_scene`，不是 `project_save_asset`

   **预制体资产内容修改**（读取 → 修改 → 写入 → 刷新 → 验证）：
   - `read_asset_content` → 内存中修改 JSON → `save_asset(url, content)` → `reimport_asset(url)`
   - `read_asset_content` 通过 `asset-db/query-asset-info` 获取资产信息，优先尝试 `asset-db/read-asset` API，不可用时回退到文件系统读取
   - `save_asset(url, jsonContent)` 直接将修改后的 JSON 写入 `.prefab` 文件
   - `reimport_asset(url)` 通知引擎重新导入文件，新实例化显示更新后的内容
   - 测试结果：新建实例显示修改内容，关闭场景后重新实例化依然保留修改

5. **以下情况仍给人操作说明：**
   - 复杂视觉布局调整（AI 看不到视觉效果）
   - 新的 UI 页面搭建（需要人在编辑器中看效果微调）
    - 操作说明格式：操作目标（选中哪个节点）→ 具体步骤（创建/修改/删除什么，参数值）→ 预期的最终结构（树状图或布局示意图）

### 场景问题排查

利用 Cocos Creator MCP 调试工具进行问题定位，排查顺序如下：

1. **查看节点结构** → `get_scene_hierarchy` 获取完整节点树
2. **查看节点详情** → `get_node_info` / `get_components` 检查特定节点和组件状态
3. **验证场景** → `validate_scene` 检查缺失引用、性能问题等
4. **查编辑器日志** → `get_console_logs` / `get_project_logs` / `search_project_logs`
5. **运行时调试** → `execute_script` 在场景上下文中执行 JS 代码辅助定位

### 脚本与场景的接口规范

- AI 在脚本中用 `@property` 装饰器定义需要场景连接的组件/节点引用
- 所有 `@property` 按用途分组、加注释，方便在 Inspector 中识别
- **绑定方式（二选一）**：
  - AI 通过 MCP `set_component_property(propertyType="node")` 直接绑定节点引用
  - 人在编辑器中拖拽绑定（适合需要视觉确认的复杂绑定）

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
