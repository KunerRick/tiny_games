## AI 进化提示场景配置参数

### 节点结构

```
Canvas (已存在)
└── EnemyEvolveNotice (新建空节点)
    └── Label (子节点)
```

---

### EnemyEvolveNotice 节点

| 属性 | 值 |
|------|-----|
| 节点名称 | `EnemyEvolveNotice` |
| 位置 X | `0` |
| 位置 Y | `200` |
| 位置 Z | `0` |
| 缩放 X | `1` |
| 缩放 Y | `1` |
| 缩放 Z | `1` |
| 尺寸宽度 | `400` |
| 尺寸高度 | `80` |
| 锚点 X | `0.5` |
| 锚点 Y | `0.5` |

**组件：**
- **UITransform** - 默认
- **Sprite** 
  - Sprite Frame: 任意 9 宫格/纯色图片（如 `default_sprite`）
  - Color: `#8B0000` (128, 0, 0)
  - Type: `SIMPLE`

---

### Label 子节点

| 属性 | 值 |
|------|-----|
| 节点名称 | `Label` |
| 位置 X | `0` |
| 位置 Y | `0` |
| 位置 Z | `0` |

**组件：**
- **UITransform** - 默认
- **Label**
  - String: `敌方进化到 中世纪！`（占位文字）
  - Font Size: `24`
  - Color: `#FFFFFF` (255, 255, 255)
  - Horizontal Align: `CENTER`
  - Vertical Align: `CENTER`

---

### UIController 组件绑定

在 WarEvo 场景的 Canvas 节点上找到 `UIController` 组件：

| 属性 | 绑定对象 |
|------|---------|
| `enemyEvolveNotice` | `Canvas/EnemyEvolveNotice` |
| `enemyEvolveLabel` | `Canvas/EnemyEvolveNotice/Label` |

---

### 初始状态

`EnemyEvolveNotice` 节点的 **Active** 属性设为 `false`（代码会在需要时显示）