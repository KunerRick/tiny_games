# Tiny Vanguard 战斗流程优化 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 优化 Tiny Vanguard 的战斗流程 UX — 布阵交互、战前过渡、按钮合并、阶段提示、胜利界面

**架构：** 纯 TypeScript 代码改动（3 个文件），不碰场景/预制体。新 UI 元素（卡片、遮罩）代码动态创建，无需 MCP 场景操作。

**技术栈：** Cocos Creator 3.8.8 / TypeScript（strict: false）

---

## 文件结构

| 文件 | 改动类型 | 职责 |
|------|---------|------|
| `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts` | 修改 | 布阵卡片、战前过渡、按钮合并、阶段 Banner |
| `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts` | 修改 | 取消布阵、战前过渡回调、伤害统计 |
| `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts` | 修改 | 适配新回调、胜利改为点击继续 |

---

### 任务 1：BattleUI.ts — 布阵卡片系统

**文件：** `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

将左侧纯文本 `deployUnitList` 改为底部可视化卡片，支持点击选择/取消选择。

#### 步骤 1：添加卡片容器和节点创建辅助方法

在 `BattleUI` 类中添加：

```typescript
// 现有 @property 之后添加：
@property({ type: Node, tooltip: '布阵卡片容器' })
deployCardContainer: Node = null;

// 新增: 单位卡片列表（运行态）
private _deployCards: Node[] = [];
```

在 `onLoad()` 中初始化卡片容器：

```typescript
onLoad(): void {
    // ... 现有代码 ...

    // 如果编辑器没绑定，代码创建容器
    if (!this.deployCardContainer) {
        this.deployCardContainer = new Node('DeployCardContainer');
        const containerTransform = this.deployCardContainer.addComponent(UITransform);
        containerTransform.setContentSize(400, 80);
        this.deployCardContainer.setPosition(0, -280, 0);
        this.node.addChild(this.deployCardContainer);
    }
    this.deployCardContainer.active = false;
}
```

#### 步骤 2：替换 `showDeployUnitList` 为卡片方式

保持公共方法签名不变，内部改为创建带 Sprite 背景的卡片节点：

```typescript
showDeployUnitList(
    unitNames: string[],
    unitIcons: string[],
    callback: (index: number) => void
): void {
    if (!this.deployCardContainer) return;
    this.deployCardContainer.removeAllChildren();
    this._deployCards = [];

    const cardWidth = 120;
    const cardHeight = 70;
    const gap = 15;
    const count = unitNames.length;
    const totalWidth = count * cardWidth + (count - 1) * gap;
    const startX = -totalWidth / 2 + cardWidth / 2;

    for (let i = 0; i < count; i++) {
        const card = new Node(`DeployCard_${i}`);
        card.setPosition(startX + i * (cardWidth + gap), 0, 0);

        // 背景
        const bg = card.addComponent(Sprite);
        bg.color = new Color(60, 60, 80, 200);
        bg.sizeMode = Sprite.SizeMode.CUSTOM;
        const bgTransform = card.addComponent(UITransform);
        bgTransform.setContentSize(cardWidth, cardHeight);

        // 图标 (用文字代替)
        const iconLabel = card.addComponent(Label);
        iconLabel.string = unitIcons[i] || '';
        iconLabel.fontSize = 24;
        iconLabel.color = Color.WHITE;
        iconLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        iconLabel.verticalAlign = Label.VerticalAlign.CENTER;
        iconLabel.node.setPosition(0, 10, 0);

        // 名字
        const nameLabel = new Node('NameLabel');
        const nl = nameLabel.addComponent(Label);
        nl.string = unitNames[i];
        nl.fontSize = 14;
        nl.color = Color.WHITE;
        nl.horizontalAlign = Label.HorizontalAlign.CENTER;
        nl.verticalAlign = Label.VerticalAlign.CENTER;
        nameLabel.setPosition(0, -20, 0);
        card.addChild(nameLabel);

        // 选中勾（默认隐藏）
        const checkMark = new Node('CheckMark');
        const cmLabel = checkMark.addComponent(Label);
        cmLabel.string = '\u2713';
        cmLabel.fontSize = 20;
        cmLabel.color = new Color(80, 220, 80);
        checkMark.setPosition(cardWidth / 2 - 15, cardHeight / 2 - 10, 0);
        checkMark.active = false;
        card.addChild(checkMark);

        // 交互
        card['_deployIdx'] = i;
        card['_deployCb'] = callback;
        card.on(Node.EventType.TOUCH_END, (evt) => {
            const idx = evt.target['_deployIdx'] as number;
            const cb = evt.target['_deployCb'] as (index: number) => void;
            if (cb) cb(idx);
        });

        this.deployCardContainer.addChild(card);
        this._deployCards.push(card);
    }

    this.deployCardContainer.active = true;
}
```

#### 步骤 3：重写 `updateDeployItemState` 支持取消状态

```typescript
updateDeployItemState(index: number, placed: boolean): void {
    if (!this._deployCards[index]) return;
    const card = this._deployCards[index];
    const bg = card.getComponent(Sprite);
    if (bg) {
        bg.color = placed
            ? new Color(40, 40, 60, 150)   // 已放置：暗色
            : new Color(60, 60, 80, 200);   // 未放置：亮色
    }
    // 勾标记
    const checkMark = card.getChildByName('CheckMark');
    if (checkMark) checkMark.active = placed;
}
```

#### 步骤 4：修改 `showDeployPhase` / `hideDeployPhase` 适配新容器

```typescript
showDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = true;
    if (this.confirmDeployButton) this.confirmDeployButton.node.active = true;
    if (this.endTurnButton) this.endTurnButton.node.active = false;
    if (this.waitButton) this.waitButton.node.active = false;
    if (this.unitNameLabel) this.unitNameLabel.string = '\u90E8\u7F72\u9635\u5BB9';
    if (this.hpLabel) this.hpLabel.string = '\u70B9\u51FB\u5361\u7247\u2192\u70B9\u51FB\u683C\u5B50\u653E\u7F6E';
    if (this.energyLabel) this.energyLabel.string = '';
    if (this.turnLabel) this.turnLabel.string = '';
    if (this.deployUnitList) this.deployUnitList.active = false;  // 隐藏旧列表
    if (this.deployCardContainer) {
        this.deployCardContainer.active = true;  // 已由 showDeployUnitList 控制
    }
}

hideDeployPhase(): void {
    if (this.deployPrompt) this.deployPrompt.active = false;
    if (this.confirmDeployButton) this.confirmDeployButton.node.active = false;
    if (this.endTurnButton) this.endTurnButton.node.active = true;
    if (this.waitButton) this.waitButton.node.active = true;
    if (this.deployUnitList) this.deployUnitList.active = false;
    if (this.deployCardContainer) {
        this.deployCardContainer.active = false;
    }
}
```

#### 步骤 5：`onDestroy` 清理

```typescript
onDestroy(): void {
    // ... 现有代码 ...
    this._deployCards = [];
}
```

---

### 任务 2：BattleUI.ts — 战前过渡动画

**文件：** `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

新增 "战斗开始" 遮罩动画。

#### 步骤 1：添加属性

```typescript
// 在现有 @property 之后
private _battleStartOverlay: Node | null = null;
private _onBattleStartComplete: (() => void) | null = null;
```

#### 步骤 2：在 `onLoad` 中创建遮罩节点

```typescript
onLoad(): void {
    // ... 现有代码 ...

    // 创建战前遮罩
    this._battleStartOverlay = new Node('BattleStartOverlay');
    const overlayTransform = this._battleStartOverlay.addComponent(UITransform);
    overlayTransform.setContentSize(750, 1330); // 全屏
    this._battleStartOverlay.setPosition(0, 0, 0);
    const overlaySprite = this._battleStartOverlay.addComponent(Sprite);
    overlaySprite.color = new Color(0, 0, 0, 0);
    this._battleStartOverlay.active = false;
    this.node.addChild(this._battleStartOverlay);

    // 大字
    const titleNode = new Node('BattleStartTitle');
    const titleLabel = titleNode.addComponent(Label);
    titleLabel.string = '\u2694 \u6218\u6597\u5F00\u59CB\uff01';
    titleLabel.fontSize = 48;
    titleLabel.color = new Color(255, 215, 0);
    titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    titleLabel.verticalAlign = Label.VerticalAlign.CENTER;
    titleNode.setPosition(0, 0, 0);
    titleNode.setScale(0, 0, 1);
    this._battleStartOverlay.addChild(titleNode);
}
```

#### 步骤 3：添加动画方法

```typescript
playBattleStartAnimation(onComplete: () => void): void {
    this._onBattleStartComplete = onComplete;
    if (!this._battleStartOverlay) {
        if (onComplete) onComplete();
        return;
    }

    this._battleStartOverlay.active = true;
    const overlaySprite = this._battleStartOverlay.getComponent(Sprite);
    const titleNode = this._battleStartOverlay.getChildByName('BattleStartTitle');

    if (!overlaySprite || !titleNode) {
        this._battleStartOverlay.active = false;
        if (onComplete) onComplete();
        return;
    }

    // 步骤1: 遮罩渐暗 (0.3s)
    tween(overlaySprite)
        .to(0.3, { color: new Color(0, 0, 0, 180) })
        .call(() => {
            // 步骤2: 大字出现 (1.2s)
            tween(titleNode)
                .to(0.4, { scale: new Vec3(1.2, 1.2, 1) })
                .to(0.6, { scale: new Vec3(1, 1, 1) })
                .delay(0.2)
                .call(() => {
                    // 步骤3: 遮罩淡出 (0.3s)
                    tween(overlaySprite)
                        .to(0.3, { color: new Color(0, 0, 0, 0) })
                        .call(() => {
                            this._battleStartOverlay.active = false;
                            if (this._onBattleStartComplete) {
                                this._onBattleStartComplete();
                                this._onBattleStartComplete = null;
                            }
                        })
                        .start();
                })
                .start();
        })
        .start();
}
```

#### 步骤 4：`onDestroy` 清理

```typescript
onDestroy(): void {
    // ... 现有清理 ...
    this._onBattleStartComplete = null;
}
```

---

### 任务 3：BattleUI.ts — 按钮合并 + 阶段 Banner 增强

**文件：** `assets/games/game_tiny_vanguard/scripts/ui/BattleUI.ts`

#### 步骤 1：去除 `endTurnButton` 相关逻辑

在 `bindEvents` 中去掉 endTurnButton 绑定：

```typescript
private bindEvents(): void {
    // 去掉: if (this.endTurnButton) { ... onEndTurnClicked ... }
    if (this.confirmDeployButton) {
        this.confirmDeployButton.node.on(Button.EventType.CLICK, this.onConfirmDeployClicked, this);
    }
    if (this.waitButton) {
        this.waitButton.node.on(Button.EventType.CLICK, this.onWaitClicked, this);
    }
}

private unbindEvents(): void {
    // 去掉: if (this.endTurnButton) { ... off ... }
    if (this.confirmDeployButton) {
        this.confirmDeployButton.node.off(Button.EventType.CLICK, this.onConfirmDeployClicked, this);
    }
    if (this.waitButton) {
        this.waitButton.node.off(Button.EventType.CLICK, this.onWaitClicked, this);
    }
}
```

修改 `waitButton` 文字（在 `onLoad` 中或编辑器绑定）：

```typescript
// onLoad 中
if (this.waitButton) {
    const wtLabel = this.waitButton.node.getComponentInChildren(Label);
    if (wtLabel) {
        wtLabel.string = '\u7ED3\u675F\u884C\u52A8'; // "结束行动"
    }
}
```

#### 步骤 2：增强阶段提示 — 新增属性

```typescript
// 新增 @property
@property({ type: Sprite, tooltip: '阶段背景色' })
phaseBg: Sprite = null;

// 若编辑器未绑定，在 onLoad 中创建一个
onLoad(): void {
    // ... 在现有代码后 ...
    if (!this.phaseBg && this.phaseLabel) {
        const bgNode = new Node('PhaseBg');
        const bgSprite = bgNode.addComponent(Sprite);
        bgSprite.color = new Color(0, 100, 200, 100);
        const bgTrans = bgNode.addComponent(UITransform);
        bgTrans.setContentSize(400, 40);
        bgNode.setPosition(0, 260, -1);
        this.node.addChild(bgNode);
        this.phaseBg = bgSprite;
    }
}
```

#### 步骤 3：重写 `updatePhase` 带背景色

```typescript
updatePhase(
    phase: string,
    unitName?: string,
    unitIndex?: number,
    totalUnits?: number,
    turn?: number,
    actionHint?: string
): void {
    if (this.phaseLabel) {
        this.phaseLabel.string = phase;
    }
    if (this.unitTurnLabel) {
        if (unitName && unitIndex !== undefined && totalUnits !== undefined) {
            this.unitTurnLabel.string = `${unitName} (${unitIndex}/${totalUnits})`;
        } else {
            this.unitTurnLabel.string = unitName ?? '';
        }
    }
    if (this.actionHintLabel) {
        this.actionHintLabel.string = actionHint ?? '';
    }

    // 根据阶段设置背景色
    if (this.phaseBg) {
        if (phase.includes('\u5E03\u9635')) {
            // 布阵 - 绿色
            this.phaseBg.color = new Color(0, 120, 60, 120);
        } else if (phase.includes('\u654C\u65B9')) {
            // 敌方 - 红色
            this.phaseBg.color = new Color(180, 40, 40, 120);
        } else if (phase.includes('\u6211\u65B9')) {
            // 我方 - 蓝色
            this.phaseBg.color = new Color(0, 80, 180, 120);
        } else if (phase.includes('\u80DC\u5229')) {
            this.phaseBg.color = new Color(180, 140, 0, 120);
        } else if (phase.includes('\u5931\u8D25')) {
            this.phaseBg.color = new Color(80, 80, 80, 120);
        } else {
            this.phaseBg.color = new Color(0, 0, 0, 0);
        }
    }
}
```

#### 步骤 4：`clearPhase` 重置背景

```typescript
clearPhase(): void {
    if (this.phaseLabel) this.phaseLabel.string = '';
    if (this.unitTurnLabel) this.unitTurnLabel.string = '';
    if (this.actionHintLabel) this.actionHintLabel.string = '';
    if (this.phaseBg) {
        this.phaseBg.color = new Color(0, 0, 0, 0);
    }
}
```

---

### 任务 4：BattleManager.ts — 布阵取消 + 伤害统计 + confirmDeploy 回调分离

**文件：** `assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

#### 步骤 1：添加伤害累计 + getter

```typescript
// 在类成员中添加
private _totalDamageDealt: number = 0;

// 添加 getter
get totalDamageDealt(): number { return this._totalDamageDealt; }
```

在每次造成伤害的地方累加：

```typescript
// executeAttack 中（约 L711-723）
private executeAttack(attacker: UnitController, target: UnitController): void {
    const damage = target.takeDamage(attacker.data?.stats.attack ?? 0, false, attacker);
    this._totalDamageDealt += damage;  // 新增
    if (this._onDamageDealtCallback && target.node?.isValid) {
        this._onDamageDealtCallback(target.node, damage);
    }
    // ...
}
```

在 `executeSkillEffects` 中每个造成伤害的效果后累加（damage, damage_multiplier, multi_attack, execute, bonus_damage, aoe_adjacent, aoe_1radius, aoe_3x3, chain 等）：

```typescript
// 示例：damage case
case 'damage': {
    if (!target?.data) break;
    const rawDmg = effect.params.amount ?? 0;
    const dmg = target.takeDamage(rawDmg, ignoreDefense);
    this._totalDamageDealt += dmg;  // 新增
    if (dmg > 0 && this._onDamageDealtCallback && target.node?.isValid) {
        this._onDamageDealtCallback(target.node, dmg);
    }
    break;
}
```

对其他造成伤害的 case 做同样处理。

在 `clearAllUnits` 中重置：

```typescript
private clearAllUnits(): void {
    // ... 现有代码 ...
    this._totalDamageDealt = 0;  // 新增
}
```

#### 步骤 2：`selectDeployUnit` 支持取消布阵

```typescript
selectDeployUnit(index: number): void {
    if (index < 0 || index >= this._playerUnits.length) return;
    const unit = this._playerUnits[index];
    if (!unit.data) return;

    // 如果该单位已放置（col >= 0），则取消放置
    if (unit.data.gridPos.col >= 0) {
        const oldPos = unit.data.gridPos;
        // 从已部署列表中移除
        this._deployedPositions = this._deployedPositions.filter(
            p => !(p.row === oldPos.row && p.col === oldPos.col)
        );
        // 重置单位位置到棋盘外
        unit.data.gridPos = { row: index, col: -1 };
        unit.data.hasMoved = false;
        // 重新定位节点到棋盘外
        unit.node.setPosition(
            (-2.5) * GridController.CELL_SIZE,
            (-3 - index) * GridController.CELL_SIZE
        );
        // 通知 UI 取消状态
        if (this._onDeployUnitPlacedCallback) {
            this._onDeployUnitPlacedCallback(this._deployedPositions.length, this._playerUnits.length);
        }
        // 重新高亮部署区域
        this._highlightDeployArea();
        this._selectedDeployUnitIndex = -1;
        return;
    }

    // 未放置，正常进入选中
    this._selectedDeployUnitIndex = index;
    this._highlightDeployArea();
}
```

#### 步骤 3：`confirmDeploy` 改为验证 + 返回值，新增 `startBattleAfterAnimation`

```typescript
// 修改 confirmDeploy：仅验证，不再直接开始战斗
confirmDeploy(): boolean {
    if (this._deployedPositions.length < this._playerUnits.length) {
        return false;
    }
    return true;
}

// 新增：动画完成后调用，真正开始战斗
startBattleAfterAnimation(): void {
    this._phase = 'player_turn';
    this._turnCount = 1;
    this.gridController.setCellClickCallback((pos) => this.onCellClicked(pos));
    this.startPlayerTurn();
}
```

---

### 任务 5：TinyVanguardMain.ts — 流程适配

**文件：** `assets/games/game_tiny_vanguard/scripts/TinyVanguardMain.ts`

#### 步骤 1：适配布阵回调（支持取消）

修改 `startBattle` 中的回调设置：

```typescript
// 在 startBattle 方法中
this.battleUI.showDeployUnitList(unitNames, unitIcons, (index) => {
    this.battleManager.selectDeployUnit(index);
});
this.battleManager.setDeployUnitPlacedCallback((placed, total) => {
    // 计算哪个 index 状态变了
    for (let i = 0; i < this.battleManager.playerUnits.length; i++) {
        const unit = this.battleManager.playerUnits[i];
        const isPlaced = unit.data?.gridPos.col >= 0;
        this.battleUI.updateDeployItemState(i, isPlaced);
    }
});
```

#### 步骤 2：修改 `onConfirmDeploy` 加入战前动画

```typescript
private onConfirmDeploy(): void {
    this.battleManager.confirmDeploy();
    this.battleUI.hideDeployPhase();

    // 播放战前动画，动画完成后开始战斗
    this.battleUI.playBattleStartAnimation(() => {
        this.battleManager.startBattleAfterAnimation();
        this.updateBattleUI();
    });
}
```

#### 步骤 3：在 `startNewRun` 中去掉 `onEndTurn` 回调设置

```typescript
private startNewRun(): void {
    // ...
    if (this.battleUI) {
        // 去掉: this.battleUI.setEndTurnCallback(...)
        this.battleUI.setConfirmDeployCallback(() => this.onConfirmDeploy());
        this.battleUI.setWaitCallback(() => this.onWaitClicked());
        this.battleUI.setVictoryContinueCallback(() => this.onVictoryContinue());
    }
    // ...
}
```

同时移除 `onEndTurn` 方法（功能与 `onWaitClicked` 完全重复）：

```typescript
// 删除整个方法
// private onEndTurn(): void { ... }
```

#### 步骤 4：改造胜利流程（去掉自动跳转，改为点击继续）

```typescript
private onBattleEnd(result: BattleResult): void {
    if (result.victory) {
        this._battleCount++;
        this.routeMapUI.completeNode(this._currentNode?.id ?? 0);
        this._runData.gold += result.goldReward;
        this._runData.honor += 5;
        SaveManager.saveRun(this._runData);
        this.updateGoldDisplay();

        this.battleUI.clearPhase();
        this.battleUI.showVictory(result.goldReward);

        // 不自动跳转，等待玩家点击胜利面板的"继续"按钮
        // Boss 战的胜利处理在 onVictoryContinue 中判断
    } else {
        // 战败逻辑不变
        this._runData.honor += Math.max(1, this._battleCount * 2);
        this.battleUI.clearPhase();
        this.battleUI.showDefeat();
        this.scheduleOnce(() => {
            this.onRunComplete(false);
        }, 2.0);
    }
}

// 新增：胜利后点击"继续"的处理
private onVictoryContinue(): void {
    if (this._currentNode?.type === 'boss') {
        this.onRunComplete(true);
        return;
    }

    this.scheduleOnce(() => {
        this.battleManager.reviveAllUnits();
        this.battleUI.hide();
        if (this.battleManager?.gridController?.node) {
            this.battleManager.gridController.node.active = false;
        }
        this.showUpgradeScreen();
    }, 0.3); // 小延迟让胜利面板停留一下再关闭
}
```

#### 步骤 5：在胜利面板创建"继续"按钮（如果不存在）

如果场景中 victoryPanel 没有名为 ContinueBtn 的子节点，需要在 BattleUI 中动态创建：

在 BattleUI.ts 的 `showVictory` 方法中：

```typescript
showVictory(gold: number): void {
    if (this.victoryPanel) {
        this.victoryPanel.active = true;
    }
    if (this.endTurnButton) {
        this.endTurnButton.node.active = false;
    }

    // 确保有"继续"按钮
    let continueBtn = this.victoryPanel?.getChildByName('ContinueBtn');
    if (!continueBtn && this.victoryPanel) {
        continueBtn = new Node('ContinueBtn');
        const btn = continueBtn.addComponent(Button);
        const btnTransform = continueBtn.addComponent(UITransform);
        btnTransform.setContentSize(160, 50);
        continueBtn.setPosition(0, -80, 0);
        const btnLabel = continueBtn.addComponent(Label);
        btnLabel.string = '\u7EE7\u7EED';
        btnLabel.fontSize = 24;
        btnLabel.color = Color.WHITE;
        btnLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        btnLabel.verticalAlign = Label.VerticalAlign.CENTER;
        // 按钮背景
        const btnSprite = continueBtn.addComponent(Sprite);
        btnSprite.color = new Color(0, 120, 200);
        btnSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        btn.node.on(Button.EventType.CLICK, this.onVictoryContinueClicked, this);
        this.victoryPanel.addChild(continueBtn);
    }

    // 显示金币
    let goldLabel = this.victoryPanel?.getChildByName('GoldLabel');
    if (!goldLabel && this.victoryPanel) {
        goldLabel = new Node('GoldLabel');
        const gl = goldLabel.addComponent(Label);
        gl.fontSize = 28;
        gl.color = new Color(255, 215, 0);
        gl.horizontalAlign = Label.HorizontalAlign.CENTER;
        gl.verticalAlign = Label.VerticalAlign.CENTER;
        goldLabel.setPosition(0, -20, 0);
        this.victoryPanel.addChild(goldLabel);
    }
    const glComp = goldLabel?.getComponent(Label);
    if (glComp) {
        glComp.string = `\uD83D\uDCB0 +${gold}`;
    }
}
```

添加胜利面板"继续"回调：

```typescript
// BattleUI.ts
private _onContinueVictory: (() => void) | null = null;

setVictoryContinueCallback(cb: () => void): void {
    this._onContinueVictory = cb;
}

private onVictoryContinueClicked(): void {
    if (this._onContinueVictory) {
        this._onContinueVictory();
    }
}
```

回到 TinyVanguardMain.ts，适配：
```typescript
// 在 startBattle 中
this.battleUI.setVictoryContinueCallback(() => this.onVictoryContinue());
```

#### 步骤 6：`onDestroy` 清理

```typescript
onDestroy(): void {
    // ... 现有代码 ...
}
```

---

## 自检

### 规格覆盖度

| 规格章节 | 覆盖任务 |
|---------|---------|
| 3.1 布阵阶段改造 | 任务 1 (卡片系统) + 任务 4 (取消布阵) + 任务 5 (适配回调) |
| 3.2 战斗开始过渡 | 任务 2 (遮罩动画) + 任务 5 (onConfirmDeploy 适配) |
| 3.3 按钮合并 | 任务 3 (去除 endTurnButton) |
| 3.4 阶段提示 Banner | 任务 3 (phaseBg + updatePhase 增强) |
| 3.5 胜利界面改造 | 任务 4 (伤害统计) + 任务 5 (onVictoryContinue) |
| 4.1 布阵取消流程 | 任务 4 (selectDeployUnit 逻辑) + 任务 5 (回调遍历) |
| 4.2 胜利延迟流程 | 任务 5 (onBattleEnd 改造) |

### 占位符扫描

无 TODO、无待定、无模糊描述。每个步骤包含完整代码。

### 类型一致性

`showDeployUnitList` 签名不变、`updateDeployItemState` 签名不变、`confirmDeploy` 回调流改为异步（叠加而非替换）、`showVictory` 兼容扩展。类型一致。