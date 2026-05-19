# 战争进化史 P0 核心体验改进 - 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现脆爽快节奏战斗（3 分钟时长、3-4 下击杀）、基础视觉反馈、记录系统

**架构：** 调整 GameConfig 数值配置，在 Unit 中添加视觉反馈逻辑，在 WarEvo 中集成记录存储，更新 UIController 显示多行结算数据

**技术栈：** Cocos Creator 3.x, TypeScript, 项目已有 StorageManager

---

## 文件清单

| 文件 | 职责 | 操作 |
|------|------|------|
| `GameConfig.ts` | 单位血量/攻击数值、城堡血量配置 | 修改 |
| `Unit.ts` | 受击闪白、死亡淡出、攻击抖动效果 | 修改 |
| `WarEvo.ts` | 游戏时间记录、最高击杀/最快通关存储逻辑 | 修改 |
| `UIController.ts` | 结算面板多行数据显示 | 修改 |

---

## 任务 1：调整单位数值（GameConfig.ts）

**文件：**
- 修改：`assets/games/game_war_evolution/scripts/GameConfig.ts`

**目标：** 将单位血量大幅降低，攻击力微调，实现 3-4 下击杀

- [ ] **步骤 1：修改 UNIT_CONFIGS 中所有单位的 hp 和 attack**

```typescript
export const UNIT_CONFIGS: UnitConfig[] = [
    // ===== 原始时代 =====
    {
        id: 'caveman', name: '穴居人', cost: 15,
        hp: 35, attack: 15, attackSpeed: 1.0, moveSpeed: 80,
        attackRange: 30, age: Age.PRIMITIVE, desc: '廉价近战',
    },
    {
        id: 'mammoth', name: '猛犸', cost: 80,
        hp: 120, attack: 35, attackSpeed: 0.6, moveSpeed: 60,
        attackRange: 35, age: Age.PRIMITIVE, desc: '重型践踏',
        hasStomp: true,
    },
    // ===== 中世纪 =====
    {
        id: 'knight', name: '骑士', cost: 200,
        hp: 90, attack: 50, attackSpeed: 1.0, moveSpeed: 110,
        attackRange: 30, age: Age.MEDIEVAL, desc: '冲锋击退',
        hasCharge: true,
    },
    {
        id: 'archer', name: '弓箭手', cost: 60,
        hp: 25, attack: 30, attackSpeed: 1.5, moveSpeed: 80,
        attackRange: 200, age: Age.MEDIEVAL, desc: '远程攻击',
    },
    // ===== 未来时代 =====
    {
        id: 'mech', name: '机甲', cost: 800,
        hp: 200, attack: 80, attackSpeed: 0.8, moveSpeed: 90,
        attackRange: 40, age: Age.FUTURE, desc: '能量护盾',
        hasShield: true,
    },
    {
        id: 'laser', name: '激光兵', cost: 350,
        hp: 50, attack: 45, attackSpeed: 1.2, moveSpeed: 95,
        attackRange: 260, age: Age.FUTURE, desc: '聚焦射击',
        hasLaserFocus: true,
    },
];
```

- [ ] **步骤 2：修改 CASTLE_CONFIG 的 HP**

```typescript
export const CASTLE_CONFIG = {
    HP: 800,  // 从 3000 改为 800
    ATTACK: 30,
    ATTACK_SPEED: 0.8,
    ATTACK_RANGE: 380,
};
```

- [ ] **步骤 3：Commit**

```bash
git add assets/games/game_war_evolution/scripts/GameConfig.ts
git commit -m "feat(war-evo): 调整数值实现脆爽战斗节奏

- 单位血量大幅降低（150->35, 600->120 等）
- 攻击力微调保持兵种平衡
- 城堡血量 3000->800，单局时长控制在 3 分钟左右"
```

---

## 任务 2：实现受击闪白效果（Unit.ts）

**文件：**
- 修改：`assets/games/game_war_evolution/scripts/Unit.ts`

**目标：** 单位受到伤害时闪白 100ms

- [ ] **步骤 1：添加受击闪白相关属性和方法**

在 `Unit` 类中添加：

```typescript
// ---- 视觉反馈 ----
private _flashTimer: number = 0;
private readonly FLASH_DURATION = 0.1; // 100ms
private readonly ORIGINAL_COLOR_PLAYER = new Color(68, 136, 255);
private readonly ORIGINAL_COLOR_ENEMY = new Color(255, 68, 68);
```

- [ ] **步骤 2：在 takeDamage 中触发闪白**

修改 `takeDamage` 方法：

```typescript
public takeDamage(amount: number, attacker: Unit | null): void {
    if (this._state === UnitState.DEAD) return;
    if (attacker) this._lastAttacker = attacker;

    let remaining = amount;

    // 护盾优先吸收
    if (this._shieldHp > 0) {
        if (remaining <= this._shieldHp) {
            this._shieldHp -= remaining;
            this.triggerFlash(); // 添加闪白
            return;
        }
        remaining -= this._shieldHp;
        this._shieldHp = 0;
    }

    this._hp -= remaining;
    this.triggerFlash(); // 添加闪白
    
    if (this._hp <= 0) {
        this._hp = 0;
        this._state = UnitState.DEAD;
    }
}

/** 触发受击闪白 */
private triggerFlash(): void {
    if (!this.body) return;
    this.body.color = Color.WHITE;
    this._flashTimer = this.FLASH_DURATION;
}
```

- [ ] **步骤 3：在 tick 中更新闪白恢复**

在 `tick` 方法开头添加：

```typescript
public tick(dt: number, allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
    if (this._state === UnitState.DEAD) return;
    if (!this._config) return;

    // 更新闪白恢复
    if (this._flashTimer > 0) {
        this._flashTimer -= dt;
        if (this._flashTimer <= 0) {
            this.restoreOriginalColor();
        }
    }
    
    // ... 原有代码
}

/** 恢复原始颜色 */
private restoreOriginalColor(): void {
    if (!this.body) return;
    this.body.color = this._side === 'player' 
        ? this.ORIGINAL_COLOR_PLAYER 
        : this.ORIGINAL_COLOR_ENEMY;
}
```

- [ ] **步骤 4：确保 Color 被导入**

检查文件顶部的导入：

```typescript
import { _decorator, Component, Sprite, Color, Label, UITransform } from 'cc';
```

- [ ] **步骤 5：Commit**

```bash
git add assets/games/game_war_evolution/scripts/Unit.ts
git commit -m "feat(war-evo): 添加受击闪白效果

- 单位受伤时身体变为白色
- 100ms 后自动恢复为原始颜色（玩家蓝/敌人红）"
```

---

## 任务 3：实现死亡淡出效果（Unit.ts）

**文件：**
- 修改：`assets/games/game_war_evolution/scripts/Unit.ts`

**目标：** 单位死亡时 1 秒内淡出，然后销毁

- [ ] **步骤 1：添加死亡淡出相关属性**

在 `Unit` 类中添加：

```typescript
// ---- 死亡淡出 ----
private _fadeTimer: number = 0;
private readonly FADE_DURATION = 1.0; // 1秒
private _isFading: boolean = false;
```

- [ ] **步骤 2：修改死亡处理逻辑**

修改 `takeDamage` 中死亡时的处理：

```typescript
public takeDamage(amount: number, attacker: Unit | null): void {
    // ... 前面代码不变

    this._hp -= remaining;
    this.triggerFlash();
    
    if (this._hp <= 0) {
        this._hp = 0;
        this._state = UnitState.DEAD;
        this.startFadeOut(); // 开始淡出
    }
}

/** 开始死亡淡出 */
private startFadeOut(): void {
    this._isFading = true;
    this._fadeTimer = this.FADE_DURATION;
}
```

- [ ] **步骤 3：在 tick 中更新淡出动画**

在 `tick` 方法中添加淡出更新（在 `if (this._state === UnitState.DEAD) return;` 之前）：

```typescript
public tick(dt: number, allUnits: Unit[], playerCastleX: number, enemyCastleX: number): void {
    // 处理死亡淡出
    if (this._isFading) {
        this._fadeTimer -= dt;
        const alpha = Math.max(0, this._fadeTimer / this.FADE_DURATION);
        this.updateNodeAlpha(alpha);
        
        if (this._fadeTimer <= 0) {
            this._isFading = false;
            // 淡出完成，标记为完全死亡
            this._state = UnitState.DEAD;
        }
        return; // 淡出期间不执行其他逻辑
    }

    if (this._state === UnitState.DEAD) return;
    // ... 原有代码
}

/** 更新节点透明度 */
private updateNodeAlpha(alpha: number): void {
    // 更新身体透明度
    if (this.body) {
        const color = this.body.color.clone();
        color.a = Math.floor(alpha * 255);
        this.body.color = color;
    }
    // 更新血条透明度
    if (this.hpBarFill) {
        const color = this.hpBarFill.color.clone();
        color.a = Math.floor(alpha * 255);
        this.hpBarFill.color = color;
    }
    if (this.hpBarBg) {
        const color = this.hpBarBg.color.clone();
        color.a = Math.floor(alpha * 255);
        this.hpBarBg.color = color;
    }
    // 更新名字标签透明度
    if (this.nameLabel) {
        this.nameLabel.node.setScale(alpha, alpha, 1);
    }
}
```

- [ ] **步骤 4：修改 isDead 判断**

```typescript
public isDead(): boolean {
    return this._state === UnitState.DEAD && !this._isFading;
}
```

- [ ] **步骤 5：Commit**

```bash
git add assets/games/game_war_evolution/scripts/Unit.ts
git commit -m "feat(war-evo): 添加死亡淡出效果

- 单位死亡时 1 秒内逐渐透明
- 淡出完成后才真正标记为死亡状态"
```

---

## 任务 4：实现攻击抖动效果（Unit.ts）

**文件：**
- 修改：`assets/games/game_war_evolution/scripts/Unit.ts`

**目标：** 单位攻击时缩放抖动 150ms

- [ ] **步骤 1：添加攻击抖动相关属性**

在 `Unit` 类中添加：

```typescript
// ---- 攻击抖动 ----
private _shakeTimer: number = 0;
private readonly SHAKE_DURATION = 0.15; // 150ms
private readonly SHAKE_SCALE = 1.15;
private _isShaking: boolean = false;
```

- [ ] **步骤 2：在 tryAttack 中触发抖动**

修改 `tryAttack` 方法：

```typescript
private tryAttack(dt: number, target: Unit, allUnits: Unit[]): void {
    this._attackCooldown -= dt;
    if (this._attackCooldown > 0) return;

    const cfg = this._config!;
    let damage = cfg.attack;

    // 骑士冲锋：首次攻击 2 倍
    if (cfg.hasCharge && !this._chargeUsed) {
        damage *= 2;
        this._chargeUsed = true;
    }

    // 激光聚焦
    if (cfg.hasLaserFocus) {
        if (target.getUnitId() !== this._laserTargetId) {
            this._laserFocus = 1.0;
            this._laserTargetId = target.getUnitId();
        }
        this._laserFocus = Math.min(this._laserFocus + 0.15, 2.0);
        damage = Math.round(damage * this._laserFocus);
    }

    target.takeDamage(damage, this);
    this._attackCooldown = 1.0 / cfg.attackSpeed;

    // 触发攻击抖动
    this.triggerAttackShake();

    // ... 后续代码不变
}

/** 触发攻击抖动 */
private triggerAttackShake(): void {
    this._isShaking = true;
    this._shakeTimer = this.SHAKE_DURATION;
    this.node.setScale(this.SHAKE_SCALE, this.SHAKE_SCALE, 1);
}
```

- [ ] **步骤 3：在 tick 中更新抖动恢复**

在 `tick` 方法中添加抖动更新（在闪白更新之后）：

```typescript
// 更新攻击抖动恢复
if (this._isShaking) {
    this._shakeTimer -= dt;
    if (this._shakeTimer <= 0) {
        this._isShaking = false;
        this.node.setScale(1, 1, 1);
    }
}
```

- [ ] **步骤 4：Commit**

```bash
git add assets/games/game_war_evolution/scripts/Unit.ts
git commit -m "feat(war-evo): 添加攻击抖动效果

- 单位攻击时缩放至 1.15 倍
- 150ms 后恢复原始大小"
```

---

## 任务 5：实现记录存储逻辑（WarEvo.ts）

**文件：**
- 修改：`assets/games/game_war_evolution/scripts/WarEvo.ts`

**目标：** 记录最高击杀数和最快通关时间

- [ ] **步骤 1：添加记录相关常量**

在文件顶部添加：

```typescript
// 存储键名
const STORAGE_KEYS = {
    MAX_KILLS: 'war_evo_max_kills',
    BEST_TIME: 'war_evo_best_time',
};
```

- [ ] **步骤 2：在 WarEvo 类中添加获取记录的方法**

```typescript
/** 获取最高击杀记录 */
private getMaxKillsRecord(): number {
    const stored = StorageManager.instance.getItem(STORAGE_KEYS.MAX_KILLS);
    return stored ? parseInt(stored, 10) : 0;
}

/** 获取最快通关记录（秒） */
private getBestTimeRecord(): number {
    const stored = StorageManager.instance.getItem(STORAGE_KEYS.BEST_TIME);
    return stored ? parseInt(stored, 10) : Infinity;
}
```

- [ ] **步骤 3：修改 showResult 方法，传入并显示记录**

```typescript
private showResult(win: boolean): void {
    const maxKills = this.getMaxKillsRecord();
    const bestTime = this.getBestTimeRecord();
    
    // 更新记录
    let newMaxKills = maxKills;
    let newBestTime = bestTime;
    let isNewKillRecord = false;
    let isNewTimeRecord = false;
    
    if (this._playerKills > maxKills) {
        newMaxKills = this._playerKills;
        StorageManager.instance.setItem(STORAGE_KEYS.MAX_KILLS, newMaxKills.toString());
        isNewKillRecord = true;
    }
    
    if (win && this._gameTime < bestTime) {
        newBestTime = this._gameTime;
        StorageManager.instance.setItem(STORAGE_KEYS.BEST_TIME, Math.floor(newBestTime).toString());
        isNewTimeRecord = true;
    }
    
    this.uiController?.showGameOver(
        win,
        this._playerAge,
        this._playerKills,
        this._playerGold,
        this._gameTime,
        newMaxKills,
        newBestTime,
        isNewKillRecord,
        isNewTimeRecord,
    );
}
```

- [ ] **步骤 4：确保 StorageManager 已导入**

检查导入语句：

```typescript
import { StorageManager } from '../../../common/managers/StorageManager';
```

- [ ] **步骤 5：Commit**

```bash
git add assets/games/game_war_evolution/scripts/WarEvo.ts
git commit -m "feat(war-evo): 添加记录存储逻辑

- 存储最高击杀记录 war_evo_max_kills
- 存储最快通关记录 war_evo_best_time
- 结算时判断是否破纪录并更新"
```

---

## 任务 6：更新结算面板显示（UIController.ts）

**文件：**
- 修改：`assets/games/game_war_evolution/scripts/UIController.ts`

**目标：** 多行显示本局数据、最高记录，破纪录时高亮

- [ ] **步骤 1：修改 showGameOver 方法签名和实现**

```typescript
public showGameOver(
    win: boolean, 
    age: Age, 
    kills: number, 
    totalGold: number,
    gameTime: number,
    maxKills: number,
    bestTime: number,
    isNewKillRecord: boolean,
    isNewTimeRecord: boolean,
): void {
    if (!this.gameOverPanel) return;
    
    if (this.resultLabel) {
        this.resultLabel.string = win ? '胜利！' : '失败...';
    }
    
    if (this.statsLabel) {
        // 格式化时间显示
        const formatTime = (seconds: number): string => {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };
        
        // 构建多行文本
        let statsText = '';
        
        // 击杀记录
        statsText += `本局击杀: ${kills}\n`;
        if (isNewKillRecord) {
            statsText += `最高记录: ${maxKills}  ← 新纪录！\n\n`;
        } else {
            statsText += `最高记录: ${maxKills}\n\n`;
        }
        
        // 时间记录（只有胜利时显示）
        if (win) {
            statsText += `本局用时: ${formatTime(gameTime)}\n`;
            if (isNewTimeRecord) {
                statsText += `最快通关: ${formatTime(bestTime)}  ← 新纪录！`;
            } else {
                statsText += `最快通关: ${formatTime(bestTime)}`;
            }
        }
        
        this.statsLabel.string = statsText;
    }
    
    this.gameOverPanel.active = true;
}
```

- [ ] **步骤 2：Commit**

```bash
git add assets/games/game_war_evolution/scripts/UIController.ts
git commit -m "feat(war-evo): 更新结算面板多行显示

- 本局击杀/最高记录分行显示
- 本局用时/最快通关分行显示（仅胜利）
- 破纪录时显示新纪录标签"
```

---

## 任务 7：场景配置说明（人工操作）

**注意：** 以下步骤需要在 Cocos Creator 编辑器中人工完成，AI 不直接修改场景文件。

- [ ] **步骤 1：配置结算面板的 statsLabel**

在 Cocos Creator 中：
1. 打开 `WarEvo.scene`
2. 找到 `GameOverPanel` 下的 `statsLabel` 节点
3. 在 Inspector 中：
   - 勾选 `Enable Wrap Text`
   - `Overflow` 设为 `CLAMP` 或 `RESIZE_HEIGHT`
   - 调整节点宽度以适应多行文本

---

## 自检清单

- [ ] 所有单位数值已调整（hp 和 attack）
- [ ] 城堡血量已改为 800
- [ ] 受击闪白效果实现（triggerFlash + restoreOriginalColor）
- [ ] 死亡淡出效果实现（startFadeOut + updateNodeAlpha）
- [ ] 攻击抖动效果实现（triggerAttackShake）
- [ ] 记录存储逻辑实现（getMaxKillsRecord + getBestTimeRecord）
- [ ] 结算面板多行显示实现（\n 换行符）
- [ ] 场景配置说明已提供（Enable Wrap Text）

---

## 验收测试

1. **数值测试：** 穴居人攻击穴居人，3 下内死亡
2. **时长测试：** 正常游戏一局在 2-4 分钟内结束
3. **闪白测试：** 单位受击时身体变白，100ms 后恢复
4. **淡出测试：** 单位死亡时逐渐透明，1 秒后消失
5. **抖动测试：** 单位攻击时有明显的缩放效果
6. **记录测试：** 结算面板正确显示最高击杀和最快通关
7. **破纪录测试：** 超过历史记录时显示"新纪录！"标签
