# 贪吃蛇游戏 - 摇杆设置指南

本文档说明如何在 Cocos Creator 中为贪吃蛇游戏配置虚拟摇杆。

## 概述

新版本的贪吃蛇游戏支持跟随式虚拟摇杆控制（类似王者荣耀），手指按下的位置即为摇杆出现的位置。

## 场景节点结构

```
Canvas
├── ... (其他游戏节点)
├── gameArea (游戏区域)
└── Joystick (摇杆根节点) [新增]
    ├── Base (摇杆底座 - 大圈)
    │   └── Button (摇杆按钮 - 小圈)
    └── Joystick (组件脚本)
```

## 创建步骤

### 步骤 1：创建摇杆根节点

1. 在 **层级管理器** 中，选中 **Canvas** 节点
2. 右键点击 → **创建空节点**
3. 命名为 `Joystick`
4. 选中 `Joystick` 节点
5. 在 **属性检查器** 中点击 **添加组件** → **自定义脚本** → 选择 `Joystick`

### 步骤 2：创建摇杆底座（大圈）

1. 选中 `Joystick` 节点
2. 右键点击 → **创建空节点**
3. 命名为 `Base`
4. 选中 `Base` 节点
5. 在 **属性检查器** 中点击 **添加组件** → **Graphics**

### 步骤 3：创建摇杆按钮（小圈）

1. 选中 `Base` 节点
2. 右键点击 → **创建空节点**
3. 命名为 `Button`
4. 选中 `Button` 节点
5. 在 **属性检查器** 中点击 **添加组件** → **Graphics**

### 步骤 4：绑定节点到脚本

1. 选中 `Joystick` 节点（根节点）
2. 在 **属性检查器** 中找到 **Joystick** 组件
3. 将子节点拖拽到对应属性：
   - **Base Node**: 拖入 `Base` 节点
   - **Button Node**: 拖入 `Button` 节点

### 步骤 5：绑定到 SnakeGame 组件

1. 在场景中找到挂载了 `SnakeGame` 脚本的主节点（通常是游戏主控节点）
2. 在 **属性检查器** 中找到 **SnakeGame** 组件
3. 找到 **Joystick** 属性，将刚才创建的 `Joystick` 根节点拖入

### 步骤 6：添加连击显示标签（可选）

1. 在 **Canvas** 下创建一个 **Label** 节点
2. 命名为 `ComboLabel`
3. 设置合适的字体大小和颜色（建议：24px，黄色/橙色）
4. 将该节点拖入 **SnakeGame** 组件的 **Combo Label** 属性槽

## 最终节点结构检查

```
Canvas
├── gameArea
│   └── ... (蛇、食物等游戏元素)
├── SnakeGame (主控节点)
│   └── SnakeGame 组件
│       ├── Game Area: gameArea
│       ├── Joystick: Joystick (绑定)
│       ├── Current Score Label: ...
│       ├── Best Score Label: ...
│       └── Combo Label: ComboLabel (可选)
└── Joystick
    ├── Joystick 组件
    │   ├── Base Node: Base
    │   └── Button Node: Button
    ├── Base (子节点)
    │   ├── Graphics 组件
    │   └── Button (子节点)
    │       └── Graphics 组件
```

## 注意事项

1. **Graphics 组件**：脚本会自动绘制摇杆的圆形外观，无需手动设置 Graphics 的绘制命令
2. **位置设置**：摇杆底座和按钮的初始位置由脚本控制，无需手动调整
3. **层级关系**：确保 `Button` 是 `Base` 的子节点，`Base` 是 `Joystick` 的子节点
4. **隐藏/显示**：摇杆初始状态为隐藏，只有在触摸时才会显示

## 摇杆参数说明

摇杆的行为参数在 `Joystick.ts` 脚本中定义：

| 参数 | 值 | 说明 |
|------|-----|------|
| JOYSTICK_RADIUS | 60px | 大圈半径，摇杆活动范围 |
| BUTTON_RADIUS | 25px | 小圈半径，可拖动按钮大小 |
| TRIGGER_THRESHOLD | 10px | 触发阈值，手指移动超过此距离才响应方向变化 |

如需调整这些参数，请修改 `Joystick.ts` 文件中的对应常量。

## 故障排查

### 摇杆不显示
- 检查节点是否正确绑定到 SnakeGame 组件的 Joystick 属性
- 检查 Base 和 Button 节点是否正确绑定到 Joystick 组件

### 摇杆位置不对
- 确保所有节点的 Position 都是 (0, 0, 0)
- 脚本使用世界坐标定位，不需要手动设置位置

### 多点触控问题
- 摇杆已内置多点触控处理，只响应第一个触摸点
- 如需修改此行为，请修改 `Joystick.ts` 中的 `onTouchStart` 方法
