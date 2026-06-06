# Tiny Vanguard — UX 优化设计

**日期**: 2026-06-06
**版本**: v1.0
**状态**: 设计完成

---

## 概述

基于 `TinyVanguardMain.ts`、`BattleManager.ts`、`GridController.ts`、`UnitController.ts`、`BattleUI.ts` 等现有代码审计，针对三个 UX 问题进行优化：
1. 首页职业选择高亮无效
2. 布阵阶段交互不清晰
3. 战斗界面敌我区分不足 + 行动流程卡住

---

## 1. 首页选人高亮

### 问题根因

`TinyVanguardMain.ts:253-259` 中 `setClassButtonVisual` 依赖 `btn.target`（Button 组件的 target 属性），该属性在场景编辑器中未绑定时函数直接 `return`，颜色修改不生效。且仅改色无选中/未选中的明确视觉差异。

### 实现方案

**核心改动**: 不再依赖 `Button.target`，而是直接操作卡片节点的子 Sprite 组件或给卡片节点添加专用的高亮节点。

#### 1.1 选中状态视觉（方案 C）

| 状态 | 效果 |
|------|------|
| 未选中 | 半透明（opacity 0.4）+ 灰色调 + 正常大小 |
| 选中（selected） | 金色边框（子节点 Sprite）+ 背景深绿色 + scale(1.1) + 检查标记 ✓ |

#### 1.2 实现细节

```typescript
// 为每个职业卡片增加两个子节点:
// - 高亮边框节点 (Sprite, 默认 active=false, 金边纹理)
// - 选中标记节点 (Label "✓", 默认 active=false)

setClassButtonVisual(btnNode: Node, selected: boolean): void {
    // 1. 改主 Sprite 颜色/透明度
    const mainSprite = btnNode.getComponent(Sprite);
    if (mainSprite) {
        mainSprite.color = selected ? SELECTED_COLOR : UNSELECTED_COLOR;
    }

    // 2. 控制高亮边框节点
    const borderNode = btnNode.getChildByName('HighlightBorder');
    if (borderNode) borderNode.active = selected;

    // 3. 控制选中标记
    const checkNode = btnNode.getChildByName('CheckMark');
    if (checkNode) checkNode.active = selected;

    // 4. 缩放动画（tween）
    if (selected) {
        tween(btnNode)
            .to(0.15, { scale: new Vec3(1.1, 1.1, 1) })
            .start();
    } else {
        tween(btnNode)
            .to(0.15, { scale: new Vec3(1, 1, 1) })
            .start();
    }
}
```

#### 1.3 场景/预制体变更

- 每个 `ClassXBtn` 节点需要增加两个子节点：`HighlightBorder`（Sprite，金边九宫格图）、`CheckMark`（Label "✓"）
- 初始状态 `active = false`

---

## 2. 布阵阶段交互优化

### 问题根因

`BattleManager.ts:175-185` 的 `onDeployCellClicked` 自动按顺序部署（`find col === -1`），玩家无法选择单位放置位置；`GridController` 未在部署前高亮可供部署的区域（前两行）。

### 实现方案（方案 B）

#### 2.1 交互流程

```
布阵阶段开始
    ↓
1. 棋盘前两行 (row 0~1) 以浅绿色高亮
2. 右侧显示待部署单位列表（含职业名和图标）
3. 玩家点击单位列表中某个单位 → 该单位高亮
4. 玩家点击高亮区域中的一个格子 → 单位放置到该位置
5. 放置后格子变深绿（已占用），列表中的单位变灰/消失
6. 所有单位部署完毕 → "确认布阵"按钮高亮可点击
```

#### 2.2 新增/修改代码

**`TinyVanguardMain.ts`**:
- 在 `showDeployPhase` 时传入待部署单位列表给 `BattleUI`
- 监听单位点击事件处理选择/放置

**`BattleManager.ts`**:
- 替换 `onDeployCellClicked` 逻辑，支持"先选单位再点格子"
- 新增 `_selectedDeployUnit: UnitController | null` 追踪当前选中
- 修改 `startDeployPhase` 在布阵阶段就高亮前两行
- 新增 `startHighlightDeployArea` 方法

**`BattleUI.ts`**:
- 新增部署单位列表 UI（3 个头像按钮）
- 单位被选中时高亮边框
- 部署后该单位变灰

**`GridController.ts`**:
- 新增 `highlightArea(positions, color)` 方法（区别于已有的 `highlightCells`，不过已有方法可用）
- 在部署开始时调用高亮 `[(0,0)~(1,5)]` 区域

#### 2.3 关键代码改动示意

```typescript
// BattleManager.ts
private _selectedDeployUnit: UnitController | null = null;

private startDeployPhase(): void {
    this._phase = 'deploy';
    this._highlightDeployArea();
    this.gridController.setCellClickCallback((pos) => this.onDeployCellClicked(pos));
}

private _highlightDeployArea(): void {
    const deployable: GridPosition[] = [];
    for (let c = 0; c < 6; c++) {
        deployable.push({ row: 0, col: c });
        deployable.push({ row: 1, col: c });
    }
    this.gridController.highlightCells(deployable, new Color(100, 200, 100, 120));
}

// 玩家在 UI 中点击单位头像
selectDeployUnit(unitIndex: number): void {
    this._selectedDeployUnit = this._playerUnits[unitIndex];
    // 高亮选中单位的位置候选格
}

private onDeployCellClicked(pos: GridPosition): void {
    if (pos.row > 1) return;
    if (this.isOccupied(pos)) return;
    if (!this._selectedDeployUnit) return;

    this._selectedDeployUnit.setGridPosition(pos);
    this._deployedPositions.push(pos);
    this._selectedDeployUnit = null;

    // 通知 UI 更新部署列表
    if (this._onDeployUnitPlaced) {
        this._onDeployUnitPlaced(this._deployedPositions.length);
    }
}
```

---

## 3. 战斗界面优化

### 3.1 敌我区分优化（方案 A3）

#### 当前状态

| 阵营 | 当前颜色 | 问题 |
|------|---------|------|
| 玩家 | 职业色（战士蓝/弓手绿/法师紫/牧师黄） | 职业色之间对比度不足 |
| 敌人 | 全部红色 | 单一红色可区分但无辅助标识 |

#### 优化内容

| 视觉元素 | 玩家 | 敌人 |
|---------|------|------|
| 本体颜色 | 职业色（保留） | 暗红色（`Color(180, 60, 60)`） |
| 底部光环 | 蓝色光环子节点 | 红色光环子节点 |
| 血条颜色 | 蓝/绿色 | 红色 |
| 头顶信息 | 职业图标 + 名称 | 敌人名称 + 等级 |
| 选中状态 | 金色边框 + scale(1.05) + 脉冲动画 | 同（起效时） |

#### 实现细节

**`UnitController.ts`**:
- 新增光环子节点控制逻辑（onLoad 创建圆形 Sprite 或直接使用已有的 Sprite 子节点）
- `setSelected` 增加缩放动画和脉冲效果
- `update()` 中轻量脉冲逻辑

**`BattleUI.ts`**:
- 血条从纯文字改为基础血条条（如可能）或保持文字但加颜色前缀
- `updateUnitInfo` 中增加血条颜色参数

### 3.2 行动流程优化（B1 + B3 结合）

#### 当前问题

`BattleManager.ts:300-314` 的 `handleActionPhase` 只响应点击敌人格子，移动后如果附近无目标，高亮为空列表，玩家陷入"不知道下一步做什么"的状态。

#### 优化流程

```
当前单位回合开始
    ↓
显示可移动范围（绿色高亮）
    ↓
玩家点击移动目标或点击"等待"
    ↓
移动后检测攻击范围
    ↓
├─ 有可攻击敌人 → 显示红色高亮 → 玩家选择攻击/技能/等待
└─ 无可攻击敌人 → 自动结束行动 + 短暂提示 "范围内无敌人"
                        ↓
                   切换到下一个单位
```

#### 代码改动

**`BattleManager.ts`**:
1. `handleMovePhase` 执行 `highlightAttackRange` 后，如果返回空数组 → 自动 `finishUnitTurn`，UI 短暂显示提示
2. 新增 `showWaitAction()` 方法
3. `handleActionPhase` 增加对"点击自己"或"点击空地"的响应 → 调用 `finishUnitTurn`

```typescript
private handleMovePhase(unit: UnitController, gridPos: GridPosition): void {
    // ... 现有移动逻辑 ...

    // 移动后检查攻击范围
    const attacks = this.getAttackableEnemies(unit);
    if (attacks.length === 0) {
        // 无目标 - 自动结束
        unit.data.hasActed = true;
        if (this._onUnitPhaseChanged) {
            this._onUnitPhaseChanged('player_turn', unit, 'done');
        }
        this.finishUnitTurn();
        return;
    }

    // 有目标 - 进入 action 阶段
    this._unitPhase = 'action';
    this.highlightAttackRange(unit);
}
```

**`BattleUI.ts`**:
- 在技能按钮旁或底部新增"等待"按钮
- 无目标时自动高亮"等待"按钮提示
- 添加短暂提示文字动画 "范围内无敌人，自动结束"

---

## 4. 影响范围

| 文件 | 改动量 | 说明 |
|------|--------|------|
| `TinyVanguardMain.ts` | 中 | 选人高亮逻辑重构 + 布阵回调 |
| `BattleManager.ts` | 中 | 布阵选择逻辑 + 行动流程 auto-skip |
| `BattleUI.ts` | 中 | 部署列表 UI + 等待按钮 + 提示文字 |
| `GridController.ts` | 小 | 无新增 API，已有 `highlightCells` 可用 |
| `UnitController.ts` | 小 | 选中动画增强 + 光环控制 |
| 场景/预制体 | 中 | 卡片加高亮子节点 + UI 布局调整 |

## 5. 未涉及

- 游戏平衡性调整
- 新增职业/技能/敌人
- 性能优化
- 网络/存档相关

---

## 规格自检

- [x] 无占位符/TODO/未完成章节
- [x] 内部一致：架构与功能描述匹配
- [x] 范围聚焦：三个 UX 问题，可在一个实现计划覆盖
- [x] 需求明确：每个方案有具体实现细节和代码示意
