# Tiny Vanguard UX 优化 实现计划

> **面向 AI 代理的工作者:** 必需子技能: superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标:** 修复首页选人高亮、优化布阵交互、改善战斗敌我区分和行动流程

**架构:** 仅修改现有文件——TinyVanguardMain.ts / BattleManager.ts / BattleUI.ts / GridController.ts / UnitController.ts + 场景预制体微调。不改 GameData / RouteMapUI / 存档等。

**技术栈:** Cocos Creator 3.8.8 + TypeScript

---

### 任务 1: 首页选人高亮修复

**文件:**
- 修改: `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts:218-268`
- 修改: 场景预制体 `assets/games/game_tiny_vanguard/scenes/TinyVanguard.scene`（为每个 ClassXBtn 添加 HighlightBorder 和 CheckMark 子节点）

- [ ] **步骤 1: 修改 `setClassButtonVisual` 不依赖 btn.target**

将原来的 `btn.target.getComponent(Sprite)` 改为直接从 btnNode 的子节点 Sprite 操作，并增加边框和勾选标记控制：

```typescript
// TinyVanguardMain.ts — 替换 setClassButtonVisual
private setClassButtonVisual(btnNode: Node, selected: boolean): void {
    // 主图标 Sprite（btnNode 自身的 Sprite 或第一级子节点的 Sprite）
    const sprite = btnNode.getComponent(Sprite);
    if (sprite) {
        sprite.color = selected ? this.SELECTED_COLOR : this.UNSELECTED_COLOR;
    }

    // 高亮边框节点（金色边框 Sprite）
    const border = btnNode.getChildByName('HighlightBorder');
    if (border) border.active = selected;

    // 选中勾标记
    const checkMark = btnNode.getChildByName('CheckMark');
    if (checkMark) checkMark.active = selected;

    // 缩放动画
    if (selected) {
        tween(btnNode)
            .to(0.15, { scale: new Vec3(1.1, 1.1, 1) })
            .start();
    } else {
        btnNode.setScale(new Vec3(1, 1, 1));
    }
}
```

确保文件顶部导入 `tween` 和 `Vec3`（已在导入中，tween 已导入，Vec3 可能需要）。

```typescript
// 已有导入需确保包含:
import { _decorator, Component, Node, Label, Button, Sprite, Color, tween, Vec3 } from 'cc';
```

- [ ] **步骤 2: 在场景中为 4 个 ClassXBtn 添加高亮子节点**

通过 Cocos Creator MCP 操作场景 `TinyVanguard.scene`。对每个 `Class1Btn` ~ `Class4Btn` 节点：

```
ClassXBtn
  ├── HighlightBorder  (Sprite, 金色九宫格边框纹理, active=false)
  ├── CheckMark         (Label "✓", 颜色 #FFD700, active=false)
  └── ...现有子节点
```

操作:
- 用 `begin_undo_recording` 开始记录
- 对每个 ClassXBtn 创建两个子节点
- 设置属性
- `end_undo_recording`
- `validate_scene` + `scene_save_scene`

- [ ] **步骤 3: 重新设置 SELECTED_COLOR 和 UNSELECTED_COLOR 为更明显的值**

```typescript
// TinyVanguardMain.ts
private readonly SELECTED_COLOR = new Color(60, 180, 60, 255);   // 深绿色
private readonly UNSELECTED_COLOR = new Color(80, 80, 80, 255);  // 深灰色
```

- [ ] **步骤 4: 更新 `updateStartBtnInteractable` 增加已选单位计数显示**

```typescript
// TinyVanguardMain.ts — 在 select 数量变化时更新 UI 文字
private updateStartBtnInteractable(): void {
    const startBtnNode = this.classSelectPanel.getChildByName('StartBtn');
    if (!startBtnNode) return;
    const startBtn = startBtnNode.getComponent(Button);
    if (startBtn) {
        const canStart = this._selectedClasses.length >= 3;
        startBtn.interactable = canStart;
        // 更新按钮文字
        const label = startBtnNode.getComponentInChildren(Label);
        if (label) {
            label.string = canStart
                ? `\u5F00\u59CB\u6E38\u620F (${this._selectedClasses.length}/3)`
                : `\u9009\u62E9\u961F\u53CB (${this._selectedClasses.length}/3)`;
        }
    }
}
```

- [ ] **步骤 5: LSP 诊断验证**

运行: `lsp_diagnostics` on `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`
预期: 无错误

---

### 任务 2: 布阵阶段 — 高亮可部署区域 + 单位选择逻辑

**文件:**
- 修改: `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`
- 修改: `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`
- 修改: `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`

- [ ] **步骤 1: BattleManager 增加部署高亮 + 选择单位逻辑**

```typescript
// BattleManager.ts — 新增字段和方法

// 字段新增
private _selectedDeployUnitIndex: number = -1;  // -1 表示未选中
private _onDeployUnitPlacedCallback: ((placedCount: number, totalCount: number) => void) | null = null;

// 新增 setter
setDeployUnitPlacedCallback(cb: (placedCount: number, totalCount: number) => void): void {
    this._onDeployUnitPlacedCallback = cb;
}

// 修改 startDeployPhase — 高亮前两行
private startDeployPhase(): void {
    this._phase = 'deploy';
    this._highlightDeployArea();
    this.gridController.setCellClickCallback((pos) => this.onDeployCellClicked(pos));
}

// 新增：高亮可部署区域
public highlightDeployArea(): void {
    this._highlightDeployArea();
}

private _highlightDeployArea(): void {
    const positions: GridPosition[] = [];
    for (let c = 0; c < 6; c++) {
        positions.push({ row: 0, col: c });
        positions.push({ row: 1, col: c });
    }
    this.gridController.highlightCells(positions, new Color(100, 200, 100, 120));
}

// 新增：选中某个单位用于部署
selectDeployUnit(index: number): void {
    if (index < 0 || index >= this._playerUnits.length) return;
    const unit = this._playerUnits[index];
    if (unit.data && unit.data.gridPos.col >= 0) return; // 已部署
    this._selectedDeployUnitIndex = index;
    // 高亮可部署区域（重新高亮确保可见）
    this._highlightDeployArea();
}

// 修改 onDeployCellClicked — 支持选择单位
private onDeployCellClicked(pos: GridPosition): void {
    if (pos.row > 1) return;
    if (this.isOccupied(pos)) return;
    if (this._selectedDeployUnitIndex < 0) return;

    const unit = this._playerUnits[this._selectedDeployUnitIndex];
    if (!unit?.data) return;
    if (unit.data.gridPos.col >= 0) return; // 已部署

    unit.setGridPosition(pos);
    this._deployedPositions.push(pos);
    this.gridController.highlightCells(this._deployedPositions, new Color(100, 200, 100, 255));
    this._selectedDeployUnitIndex = -1;

    if (this._onDeployUnitPlacedCallback) {
        this._onDeployUnitPlacedCallback(this._deployedPositions.length, this._playerUnits.length);
    }
}
```

- [ ] **步骤 2: BattleUI 新增部署单位列表**

```typescript
// BattleUI.ts — 新增字段和方法

// @property 新增
@property({ type: Node, tooltip: '部署单位列表容器' })
deployUnitList: Node = null;

// 新增: 显示部署单位列表（3 个头像按钮）
showDeployUnitList(
    unitNames: string[],
    unitIcons: string[],
    callback: (index: number) => void
): void {
    if (!this.deployUnitList) return;
    this.deployUnitList.removeAllChildren();

    const startY = 60;
    for (let i = 0; i < unitNames.length; i++) {
        const item = new Node(`DeployItem_${i}`);
        item.setPosition(320, startY - i * 80, 0);

        // 添加 Label 显示职业名
        const label = item.addComponent(Label);
        label.string = `${unitIcons[i] || ''} ${unitNames[i]}`;
        label.fontSize = 22;
        label.color = Color.WHITE;

        // 添加 Button 组件
        const btn = item.addComponent(Button);
        item['_deployIdx'] = i;
        item['_deployCb'] = callback;
        btn.node.on(Button.EventType.CLICK, this.onDeployItemClicked, this);

        // 添加 UITransform
        const uiTransform = item.addComponent(UITransform);
        uiTransform.setContentSize(160, 50);

        this.deployUnitList.addChild(item);
    }
}

// 更新部署列表项状态
updateDeployItemState(index: number, deployed: boolean): void {
    const item = this.deployUnitList?.getChildByName(`DeployItem_${index}`);
    if (!item) return;
    const label = item.getComponent(Label);
    if (label) {
        label.color = deployed ? new Color(100, 100, 100, 255) : Color.WHITE;
    }
    const btn = item.getComponent(Button);
    if (btn) btn.interactable = !deployed;
}

private onDeployItemClicked(btn: Button): void {
    const idx = btn.node['_deployIdx'] as number;
    const cb = btn.node['_deployCb'] as (index: number) => void;
    if (cb) cb(idx);
}

// 修改 showDeployPhase — 显示列表
showDeployPhase(): void {
    // ... 现有代码 ...
    // 部署单位列表通过 startBattle 传递参数后在 startNewRun 或 startBattle 中调用
}
```

还要在 `showDeployPhase` 中添加:

```typescript
// 在 showDeployPhase 末尾
if (this.deployUnitList) this.deployUnitList.active = true;
```

在 `hideDeployPhase` 中添加:

```typescript
if (this.deployUnitList) this.deployUnitList.active = false;
```

- [ ] **步骤 3: TinyVanguardMain 串联布阵回调**

```typescript
// TinyVanguardMain.ts — 在 startBattle 中设置布阵 UI
private startBattle(isElite: boolean, isBoss: boolean): void {
    this._state = 'battle';
    this.routeMapUI.hide();
    if (this.battleManager?.gridController?.node) {
        this.battleManager.gridController.node.active = true;
    }
    this.battleUI.show();
    this.battleUI.showDeployPhase();

    // === 新增: 显示部署单位列表 ===
    const unitNames = this._runData.playerClasses.map(c => {
        const config = getClassById(c);
        return config ? config.name : c;
    });
    const unitIcons = this._runData.playerClasses.map(c => {
        const config = getClassById(c);
        return config ? config.icon : '';
    });
    this.battleUI.showDeployUnitList(unitNames, unitIcons, (index) => {
        this.battleManager.selectDeployUnit(index);
    });

    this.battleManager.setDeployUnitPlacedCallback((placed, total) => {
        this.battleUI.updateDeployItemState(placed - 1, true);
    });
    // ===========================

    this.battleManager.startBattle(
        this._runData.playerClasses,
        this._currentDifficulty,
        isElite,
        isBoss,
        (result) => this.onBattleEnd(result)
    );
}
```

- [ ] **步骤 4: LSP 诊断验证**

运行: `lsp_diagnostics` on `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`
运行: `lsp_diagnostics` on `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`
运行: `lsp_diagnostics` on `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`
预期: 无错误

---

### 任务 3: 战斗敌我区分优化

**文件:**
- 修改: `assets/games/game_tiny_vanguard/scripts/battle/UnitController.ts`
- 修改: `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

- [ ] **步骤 1: UnitController 增加光环节点和选中动画增强**

```typescript
// UnitController.ts — 新增字段和方法

@property({ type: Node, tooltip: '阵营光环节点' })
factionGlow: Node = null;

// 增强 setSelected 动画
setSelected(selected: boolean): void {
    this._isSelected = selected;
    if (this.selectionIndicator) {
        this.selectionIndicator.active = selected;
    }
    // 选中缩放动画
    if (selected && this.node?.isValid) {
        tween(this.node)
            .to(0.2, { scale: new Vec3(1.08, 1.08, 1) })
            .start();
    } else if (this.node?.isValid) {
        this.node.setScale(new Vec3(1, 1, 1));
    }
}

// 在 init / initFromEnemyConfig 中增加光环颜色设置
// init 中:
private setupFactionVisual(): void {
    if (!this.factionGlow) return;
    const glowSprite = this.factionGlow.getComponent(Sprite);
    if (!glowSprite) return;

    if (this._data?.isPlayer) {
        glowSprite.color = new Color(60, 140, 255, 100);   // 蓝色光环
    } else {
        glowSprite.color = new Color(255, 60, 60, 100);     // 红色光环
    }
    this.factionGlow.active = true;
}

// 在 init() 末尾和 initFromEnemyConfig() 末尾都调用 setupFactionVisual()
```

导入 `Vec3`:

```typescript
import { _decorator, Component, Node, Sprite, Color, tween, Vec3 } from 'cc';
```

- [ ] **步骤 2: BattleUI 血条颜色区分**

```typescript
// BattleUI.ts — 修改 updateUnitInfo

updateUnitInfo(
    name: string, hp: number, maxHp: number,
    energy: number, maxEnergy: number, turn: number,
    isEnemy: boolean = false  // 新增参数
): void {
    if (this.unitNameLabel) {
        this.unitNameLabel.string = name;
        this.unitNameLabel.color = isEnemy ? new Color(255, 100, 100) : Color.WHITE;
    }
    if (this.hpLabel) {
        this.hpLabel.string = `HP: ${hp}/${maxHp}`;
        this.hpLabel.color = isEnemy ? new Color(255, 80, 80) : new Color(80, 200, 255);
    }
    if (this.energyLabel) this.energyLabel.string = `\u26A1 ${energy}/${maxEnergy}`;
    if (this.turnLabel) this.turnLabel.string = `\u8F6E\u6B21 ${turn}`;
}
```

然后在 `TinyVanguardMain.ts` 调用处传入 `false`（当前只显示玩家信息，对应不变）。

- [ ] **步骤 3: LSP 诊断验证**

运行: `lsp_diagnostics` on `assets/games/game_tiny_vanguard/scripts/battle/UnitController.ts`
运行: `lsp_diagnostics` on `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`
预期: 无错误

---

### 任务 4: 行动流程优化 — 自动跳过 + 等待按钮

**文件:**
- 修改: `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`
- 修改: `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`
- 修改: `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`

- [ ] **步骤 1: BattleManager 增加移动后无目标自动跳过**

```typescript
// BattleManager.ts — 修改 handleMovePhase

private handleMovePhase(unit: UnitController, gridPos: GridPosition): void {
    if (unit.data.gridPos.row === gridPos.row && unit.data.gridPos.col === gridPos.col) {
        this._unitPhase = 'action';
        this.highlightAttackRange(unit);
        if (this._onUnitPhaseChanged) {
            this._onUnitPhaseChanged('player_turn', unit, 'action');
        }
        // 检查攻击范围是否为空
        this._checkAutoSkipIfNoTargets(unit);
        return;
    }
    if (unit.data.hasMoved) return;
    const moves = this.getReachablePositions(unit.data.gridPos, unit.data.stats.move);
    const canMove = moves.some(m => m.row === gridPos.row && m.col === gridPos.col);
    if (!canMove) return;
    unit.setGridPosition(gridPos);
    this._unitPhase = 'action';
    this.highlightAttackRange(unit);
    if (this._onUnitPhaseChanged) {
        this._onUnitPhaseChanged('player_turn', unit, 'action');
    }
    // 检查攻击范围是否为空
    this._checkAutoSkipIfNoTargets(unit);
}

// 新增: 无目标自动跳过
private _checkAutoSkipIfNoTargets(unit: UnitController): void {
    const attacks = this.getAttackableEnemies(unit);
    if (attacks.length === 0 && !unit.data?.hasActed) {
        // 延迟一点点以便 UI 能显示切换提示
        this.scheduleOnce(() => {
            if (unit.data?.isAlive && !unit.data.hasActed) {
                unit.data.hasActed = true;
                if (this._onUnitPhaseChanged) {
                    this._onUnitPhaseChanged('player_turn', unit, 'done');
                }
                this.finishUnitTurn();
            }
        }, 0.3);
    }
}
```

- [ ] **步骤 2: BattleManager 增加"等待"逻辑**

```typescript
// BattleManager.ts — 新增 wait 方法

// 新增: 等待（跳过当前单位行动）
waitCurrentUnit(): void {
    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;
    unit.data.hasActed = true;
    this.finishUnitTurn();
}

// 修改 onCellClicked 增加点击已选中的单位 = 等待
onCellClicked(gridPos: GridPosition): void {
    // ... 现有 skill_target 判断 ...

    const unit = this._selectedUnit;
    if (!unit?.data?.isAlive) return;

    // 点击自己 = 等待
    if (unit.data.gridPos.row === gridPos.row && unit.data.gridPos.col === gridPos.col) {
        this.waitCurrentUnit();
        return;
    }

    // ... 后续代码不变 ...
}
```

- [ ] **步骤 3: BattleUI 增加等待按钮**

```typescript
// BattleUI.ts — 新增字段

@property({ type: Button, tooltip: '等待（跳过行动）按钮' })
waitButton: Button = null;

// 修改 show — 绑定等待按钮
show(): void {
    this._showCalled = true;
    this.node.active = true;
    this.bindEvents();
}

private bindEvents(): void {
    // ... 现有绑定 ...
    if (this.waitButton) {
        this.waitButton.node.on(Button.EventType.CLICK, this.onWaitClicked, this);
    }
}

private unbindEvents(): void {
    // ... 现有解绑 ...
    if (this.waitButton) {
        this.waitButton.node.off(Button.EventType.CLICK, this.onWaitClicked, this);
    }
}

private _onWait: (() => void) | null = null;

setWaitCallback(callback: () => void): void {
    this._onWait = callback;
}

private onWaitClicked(): void {
    if (this._onWait) this._onWait();
}

// showDeployPhase 时隐藏等待按钮
showDeployPhase(): void {
    // ... 现有代码 ...
    if (this.waitButton) this.waitButton.node.active = false;
}

// hideDeployPhase 时显示等待按钮
hideDeployPhase(): void {
    // ... 现有代码 ...
    if (this.waitButton) this.waitButton.node.active = true;
}
```

在场景中为 `waitButton` 设置:
- 位置建议: `(200, -280)` — 在 endTurnButton 左边
- 文字: "等待"

- [ ] **步骤 4: TinyVanguardMain 串联等待回调**

```typescript
// TinyVanguardMain.ts — 在 startNewRun 中设置

private startNewRun(): void {
    // ... 现有代码 ...

    if (this.battleUI) {
        this.battleUI.setEndTurnCallback(() => this.onEndTurn());
        this.battleUI.setConfirmDeployCallback(() => this.onConfirmDeploy());
        this.battleUI.setWaitCallback(() => this.onWait());  // 新增
    }
}

// 新增: 等待回调
private onWait(): void {
    this.battleManager.waitCurrentUnit();
    this.updateBattleUI();
}

// 修改 updateBattlePhaseUI 增加 'done' 阶段处理
private updateBattlePhaseUI(phase: BattlePhase, unit: UnitController | null, actionPhase: UnitActionPhase | null): void {
    // ... 现有 switch ...
    // 在 player_turn case 中增加 done 判断
    case 'player_turn':
        if (unit?.data) {
            if (actionPhase === 'done') {
                this.battleUI.updatePhase(
                    `\u6211\u65B9\u56DE\u5408 \u7B2C${this.battleManager.turnCount}\u8F6E`,
                    `${unit.data.name} \u7ED3\u675F\u884C\u52A8`,
                    idx, totalAlive, this.battleManager.turnCount,
                    '\u8303\u56F4\u5185\u65E0\u654C\u4EBA\uFF0C\u81EA\u52A8\u7ED3\u675F'
                );
            } else {
                // ... 现有逻辑 ...
            }
        }
        break;
}
```

- [ ] **步骤 5: LSP 诊断验证**

运行: `lsp_diagnostics` on `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`
运行: `lsp_diagnostics` on `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`
运行: `lsp_diagnostics` on `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`
预期: 无错误

---

### 任务 5: 场景 / 预制体微调

**文件:**
- 修改: `assets/games/game_tiny_vanguard/scenes/TinyVanguard.scene`
- 修改: `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`（@property 声明）

- [ ] **步骤 1: 场景添加等待按钮**

通过 Cocos Creator MCP 在场景 `TinyVanguard.scene` 的 BattleUI 节点下:
1. 创建 Button 节点 "WaitButton"
2. 设置位置 `(200, -280)`
3. 设置子 Label 文字 "等待"
4. 设置大小 `UITransform (100, 60)`
5. 在 BattleUI 组件上绑定 waitButton 属性

- [ ] **步骤 2: 场景添加部署单位列表容器**

在 BattleUI 节点下创建 `DeployUnitList` 空节点作为容器。

- [ ] **步骤 3: 场景中 ClassXBtn 添加高亮子节点**

对每个 `Class1Btn` ~ `Class4Btn` 节点:
1. 创建子节点 `HighlightBorder`，添加 Sprite 组件，使用金色九宫格纹理（如无可临时代用一个纯色 Sprite）
2. 创建子节点 `CheckMark`，添加 Label 组件，文字 "✓"，颜色 #FFD700，字号 24
3. 初始状态 `active = false`

- [ ] **步骤 4: `validate_scene` 验证**

运行: `validate_scene` on TinyVanguard.scene
预期: 无严重问题

---

### 任务 6: 验证与集成测试

- [ ] **步骤 1: 全量 LSP 诊断**

```bash
# 对所有修改过的文件做最终检查
lsp_diagnostics on assets/games/game_tiny_vanguard/scripts/
```

预期: 0 error

- [ ] **步骤 2: 功能自检清单**

逐项检查:

| # | 检查项 | 预期 |
|---|--------|------|
| 1 | 选人界面点职业卡片 | 边框+勾+缩放+绿色背景 |
| 2 | 取消选中 | 恢复正常状态 |
| 3 | 选满 3 人 | 开始按钮可点击 |
| 4 | 进入战斗部署阶段 | 前两行绿色高亮 |
| 5 | 右侧显示部署列表 | 3 个头像可点击 |
| 6 | 点单位→点格子 | 单位放置到目标位置 |
| 7 | 部署后列表更新 | 已部署单位变灰 |
| 8 | 战斗中玩家有蓝色光环 | 敌人有红色光环 |
| 9 | 选中单位 | 放大 + 金色边框 |
| 10 | 移动后无目标 | 自动结束并提示 |
| 11 | 有"等待"按钮 | 点击后结束该单位回合 |
| 12 | 点击自己 | 效果同等待 |
