# 战争进化史 - Lite 游戏设计文档

**日期**: 2026-05-18  
**版本**: v1.0  
**状态**: 设计中

---

## 1. 游戏概述

**战争进化史 Lite** 是一款简化版的即时战略对推游戏，灵感来源于经典 Flash 游戏《战争进化史》（Age of War）。玩家与 AI 对手在水平战场上双向出兵，自动战斗，通过积攒资源进化时代以获得更强兵种，最终摧毁敌方城堡获胜。

**核心设计原则**：极简操作（只有产兵 + 进化两个决策）、自动战斗、3-5 分钟单局。

---

## 2. 核心玩法

### 2.1 基本规则

- **战场**: 水平单线，玩家城堡在左，AI 城堡在右
- **资源**: 金币随时间自动增长 + 击杀单位获得奖励
- **产兵**: 玩家点击底部按钮生产单位，单位自动向右行走
- **战斗**: 双方单位相遇时自动战斗，后排排队接战
- **进化**: 积累足够经验值（击杀获得）+ 金币后，可进化到下一时代
- **胜利**: 摧毁敌方城堡（HP 归零）
- **失败**: 我方城堡 HP 归零

### 2.2 队列接战机制

这是游戏最核心的差异化设计：

- 多个己方单位与同一敌方单位处于攻击范围时，**仅最靠前的单位接战**，其余排队等待
- 接战单位死亡后，排队中的下一个单位自动顶上
- 排队深度最大 8 个，超出则不再产兵
- 排队单位视觉上依次排列在接战单位后方

### 2.3 计分规则

- 击杀敌方单位获得金币：单位造价 × 25%（四舍五入）
- 自动收入：10 金币/秒（固定速率，v1 不含递增）
- 进化奖励：进化完成后赠送 200 金币

---

## 3. 时代与兵种

### 3.1 原始时代（起始）

| 兵种 | 造价 | 生命 | 攻击 | 攻速 | 移速 | 射程 | 特性 |
|------|------|------|------|------|------|------|------|
| 穴居人 | 15g | 150 | 12 | 1.0/s | 80 px/s | 近战 | 无 |
| 猛犸骑手 | 80g | 600 | 30 | 0.6/s | 60 px/s | 近战 | 践踏：每 8 秒对周围敌人造成 30 范围伤害 |

### 3.2 中世纪时代（进化费用：800 经验 + 800 金币）

| 兵种 | 造价 | 生命 | 攻击 | 攻速 | 移速 | 射程 | 特性 |
|------|------|------|------|------|------|------|------|
| 骑士 | 200g | 450 | 45 | 1.0/s | 110 px/s | 近战 | 冲锋：首击伤害×2 + 击退 |
| 弓箭手 | 60g | 100 | 25 | 1.5/s | 80 px/s | 220 px | 远程攻击 |

### 3.3 未来时代（进化费用：3000 经验 + 3000 金币）

| 兵种 | 造价 | 生命 | 攻击 | 攻速 | 移速 | 射程 | 特性 |
|------|------|------|------|------|------|------|------|
| 机甲战士 | 800g | 1500 | 100 | 0.8/s | 90 px/s | 近战 | 能量护盾（50% 额外血量） |
| 激光兵 | 350g | 200 | 50 | 1.2/s | 95 px/s | 280 px | 远程，持续攻击同一目标伤害递增 |

### 3.4 兵种设计原则

- 每个时代两个兵种形成互补：近战肉盾 + 远程/特殊输出
- 造价递增对应战斗力递增
- 远程单位脆弱但可在后排输出
- 进化后旧时代兵种仍可生产（方便补经济）

---

## 4. 界面设计

### 4.1 战斗界面布局

```
┌──────────────────────────────────────────┐
│  [返回]   我方HP ████  VS  ████ 敌方HP   │  ← 顶部栏 (TopBar)
│       金币: 1280   原始时代 [进化→800/800] │     
├──────────────────────────────────────────┤
│                                          │
│   ⚔ 穴居人 →→→→→→  ←←←←←← 敌方兵 ⚔    │  ← 战场区
│        🦣              🏰敌方城堡        │
│   🏰我方城堡                            │
│                                          │
├──────────────────────────────────────────┤
│  [穴居人 15g]  [猛犸骑手 80g]   [进化]   │  ← 底部栏 (BottomBar)
└──────────────────────────────────────────┘
```

### 4.2 游戏结束面板

```
┌─────────────────────────┐
│      胜利！/ 失败！      │
│                         │
│    对方城堡已被摧毁      │
│                         │
│  时代: 中世纪            │
│  击杀数: 42             │
│                         │
│  [再来一局]  [返回大厅]  │
└─────────────────────────┘
```

---

## 5. 数据结构

### 5.1 兵种配置

```typescript
export interface UnitConfig {
    id: string;              // 标识
    name: string;            // 显示名称
    cost: number;            // 生产费用（金币）
    hp: number;              // 生命值
    attack: number;          // 攻击力
    attackSpeed: number;     // 每秒攻击次数
    moveSpeed: number;       // 移动速度（像素/秒）
    attackRange: number;     // 攻击范围（0 = 近战）
    age: Age;                // 所属时代
    skillName?: string;      // 特殊技能名称
    skillDesc?: string;      // 特殊技能描述
}
```

### 5.2 时代配置

```typescript
export enum Age {
    PRIMITIVE = 0,
    MEDIEVAL = 1,
    FUTURE = 2,
}

export interface AgeConfig {
    age: Age;
    name: string;
    expRequired: number;     // 进化所需经验
    goldRequired: number;    // 进化所需金币
    units: UnitConfig[];     // 解锁的兵种
}
```

### 5.3 运行时单位状态

```typescript
export interface UnitState {
    id: number;              // 唯一标识
    configId: string;        // 对应 UnitConfig.id
    side: 'player' | 'enemy';
    hp: number;              // 当前生命值
    maxHp: number;
    x: number;               // 当前 x 坐标
    state: 'moving' | 'fighting' | 'queuing' | 'dead';
    attackCooldown: number;  // 剩余攻击冷却（秒）
    shieldHp?: number;       // 护盾值（机甲战士）
    chargeBonus?: boolean;   // 冲锋加成（骑士）
    focusTime?: number;      // 连续攻击同一目标时间（激光兵）
}
```

---

## 6. 架构设计

### 6.1 文件结构

```
assets/games/game_war_evolution/
├── scenes/
│   └── WarEvo.scene              # 游戏场景
├── scripts/
│   ├── WarEvo.ts                 # 游戏主控制器
│   ├── GameConfig.ts             # 常量、兵种/时代配置
│   ├── Unit.ts                   # 单位组件
│   ├── Castle.ts                 # 城堡组件
│   ├── AI.ts                     # AI 控制器
│   └── UIController.ts           # 顶部栏 + 底部栏 + 结算面板
└── resources/
    └── prefabs/
        └── Unit.prefab           # 单位预制体（Sprite + Unit 组件）
```

### 6.2 类职责

| 类 | 职责 |
|----|------|
| `WarEvo` | 主循环（update），协调各单位/城堡/AI，状态管理，胜负判定 |
| `GameConfig` | 纯数据：兵种配置表、时代配置表、全局常量 |
| `Unit` | 单位实例：移动、战斗、技能、死亡、排队逻辑 |
| `Castle` | 城堡 HP、自动防御攻击、被攻击时反馈 |
| `AI` | 定时波次出兵、金币管理、进化决策 |
| `UIController` | 顶部信息栏（HP/金币/时代）、底部产兵/进化按钮、结算面板 |

### 6.3 游戏循环

```
update(dt) 每帧:
  1. 更新金币（自动增长）
  2. AI.update(dt) — 决定是否产兵/进化
  3. 遍历所有 Unit:
     a. 移动（moving 状态）
     b. 搜索目标
     c. 执行攻击/更新冷却
     d. 检查死亡
  4. 清理死亡单位
  5. 检查胜负条件
  6. 城堡自动防御
```

---

## 7. 核心算法

### 7.1 单位移动

```typescript
// 玩家单位向右，AI 单位向左
updateMovement(dt: number): void {
    if (this._state !== 'moving') return;
    
    const direction = this._side === 'player' ? 1 : -1;
    this._x += this._config.moveSpeed * direction * dt;
    
    // 边界限制
    const minX = this._side === 'player' ? PLAYER_CASTLE_X : ENEMY_CASTLE_X;
    const maxX = this._side === 'player' ? ENEMY_CASTLE_X : PLAYER_CASTLE_X;
    this._x = clamp(this._x, minX, maxX);
}
```

### 7.2 目标搜索与排队

```typescript
findTarget(allUnits: Unit[]): Unit | null {
    // 获取攻击范围内的所有敌方单位
    const enemies = allUnits.filter(u => 
        u.side !== this._side && 
        u.state !== 'dead' &&
        Math.abs(u.x - this._x) <= this._config.attackRange
    );
    
    if (enemies.length === 0) return null;
    
    // 检查是否应该排队（前方有己方单位在战斗中）
    const frontAlly = this.findFrontFightingAlly(allUnits);
    if (frontAlly) {
        this._state = 'queuing';
        this.queueBehind(frontAlly);
        return null;
    }
    
    // 选择最近的目标
    return enemies.sort((a, b) => 
        Math.abs(a.x - this._x) - Math.abs(b.x - this._x)
    )[0];
}
```

### 7.3 AI 决策（简单难度）

```typescript
// 每 2-4 秒随机选择一个可负担的兵种生产
// 当经验值达到阈值且有足够金币时进化
update(dt: number): void {
    this._timer += dt;
    
    // 产兵逻辑
    if (this._timer >= this._spawnInterval) {
        this._timer = 0;
        this._spawnInterval = 2 + Math.random() * 3;
        
        const affordable = this.getAffordableUnits();
        if (affordable.length > 0 && this._gold > 0) {
            const unit = affordable[Math.floor(Math.random() * affordable.length)];
            this.spawnUnit(unit);
        }
    }
    
    // 进化逻辑
    if (this.canEvolve() && this._gold >= this._ageConfig.goldRequired + 500) {
        this.evolve();
    }
}
```

---

## 8. 不包含功能（后续可扩展）

- [ ] 塔防建造系统
- [ ] 玩家对战（PVP）
- [ ] 地形/多路径
- [ ] 特殊技能（陨石雨等）
- [ ] 科技树/局外成长
- [ ] 赛季/排行榜
- [ ] 微信社交功能
- [ ] 音效

---

## 9. 与大厅的集成

在 `GameConfig.ts` 中注册：

```typescript
{ id: 'war_evo', name: '战争进化', icon: 'default', sceneName: 'WarEvo', description: '时代进化对推' }
```

与 2048 相同的方式接入大厅系统（SceneManager.gotoGame）。

---

## 10. 开发检查点

- [ ] 场景能在 Cocos Creator 中打开
- [ ] 双方城堡显示，HP 条正常
- [ ] 金币自动增长，UI 更新
- [ ] 点击产兵按钮能正确生成单位
- [ ] 单位自动行走，正确方向
- [ ] 双方单位相遇时自动战斗
- [ ] 排队接战逻辑正确
- [ ] 单位死亡后后续单位顶上
- [ ] 击杀获得金币
- [ ] 进化系统：经验积累 + 金币消耗
- [ ] 进化后解锁新兵种，建筑外观变化
- [ ] AI 能自动产兵和进化
- [ ] 城堡 HP 归零判定胜负
- [ ] 结算面板显示结果
- [ ] 返回大厅功能正常
- [ ] 所有代码已提交

---

*文档结束*
