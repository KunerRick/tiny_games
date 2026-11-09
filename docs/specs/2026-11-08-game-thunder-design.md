# 雷霆战机（Thunder）设计

- 日期：2026-11-08
- 状态：**已实现并可玩**（编码 / 浏览器验收 / 修复均完成，2026-11-09 合入 `develop`）；自检 64/64（§11.1 的目标 35 项已扩到 64 项），浏览器实测记录见 §12.1
- 场景：`assets/games/game_thunder/scenes/Thunder.scene`（场景名 `Thunder`）
- 游戏 id：`thunder`；名称：雷霆战机
- 玩法定位：动作射击 · 竖版弹幕 · **关卡制 + 跨局养成**
- 前置文档：
  - [`2026-11-08-game-shmup-design.md`](./2026-11-08-game-shmup-design.md)（已完成的《星际弹幕》，本作复用其确定性弹幕内核范式）
  - [`../plans/2026-11-05-game-catalog-and-roadmap.md`](../plans/2026-11-05-game-catalog-and-roadmap.md)（§2 品类矩阵、§7 共享基建）

> **命名提示**：「雷霆战机」是腾讯旗下游戏的名称。作为内部项目练手无碍；**若计划正式上架微信小游戏，建议改名为「雷霆突击」/「雷鸣战机」**，本文其余部分不受影响（id / 场景名 / 代码标识均为中性的 `thunder`）。

---

## 1. 一句话玩法

拖动战机躲弹幕、自动开火；用关卡结算的金币永久升级火力 / 装甲 / 僚机 / 炸弹，逐关推进 10 个关卡，直到击破「雷霆核心」。

---

## 2. 为什么是这一款，而不是第二款《星际弹幕》

《星际弹幕》已经覆盖了「单局弹幕街机」：固定机体、固定 9 波、只比最高分。再做一个同类只会互相抢用户。
路线图 §1 还指出一个结构性事实：**现有全部游戏都是“一局定输赢”，没有跨局养成**。

所以《雷霆战机》的差异点不是“更多弹幕”，而是三件 `shmup` 完全没有的事：

| 维度 | 星际弹幕 `shmup` | 雷霆战机 `thunder` |
|------|------------------|---------------------|
| 结构 | 单局 9 波 + 母舰 | **10 个独立关卡**，每关 4–6 波 + Boss |
| 成长 | 只在局内捡火力（1–3） | **跨局永久养成**：武器 / 装甲 / 僚机 / 炸弹 四条升级线 |
| 主动操作 | 只有拖动 | 拖动 + **炸弹清屏** + 护盾 + 每关一次复活 |
| 失败处理 | 直接结算 | 每关一次免费复活；失败仍结算击杀金币 |
| 评价 | 最高分 | **关卡星级（1–3★）** + 最高分 |
| 目标感 | 活多久 | **解锁下一关 / 刷星 / 升级机库** |

两者共享的只有「720×1280 确定性弹幕模拟」这套已被验证的内核写法，**代码不抽公共层**（路线图 §7：同类需求出现第三款时再抽）。

---

## 3. 核心循环

```
主界面（关卡选择 + 金币 + 机库入口）
   │
   ├─ 机库：花金币升级 武器 / 装甲 / 僚机 / 炸弹
   │
   └─ 选关 → 战斗（4–6 波小怪 + Boss）
              │
              ├─ 失败 → 免费复活一次 → 仍失败 → 结算（击杀金币）
              │
              └─ 通关 → 星级评定 + 金币结算 → 解锁下一关
```

单关时长 **60–100 秒**；首次通关 10 关约 12–15 分钟；满星与机库满级是长线目标。

---

## 4. 战斗规则

坐标系与《星际弹幕》一致：`x ∈ [0, 720]` 从左到右，`y ∈ [0, 1280]` **从上到下**；玩家在下方。

| 系统 | 规则 |
|------|------|
| 移动 | 拖动屏幕，战机跟随手指（保留按下偏移，不瞬移） |
| 边界 | `x ∈ [20, 700]`、`y ∈ [260, 1220]` |
| 开火 | **自动**，每 `0.12s` 一轮；火力等级 1–5 决定弹数与散射角 |
| 判定 | 玩家碰撞半径 **9**（视觉半径 17）；敌弹半径 6–8；小判定大观感 |
| 生命 | 初始 `3 + 装甲等级`（3–7），上限同值；中弹掉 1 并无敌 `1.6s` |
| 撞机 | 与敌机机体相撞同样掉 1 命，**不摧毁敌机**，双方各自后退 24px 后进入无敌 |
| 护盾 | 最多 1 层；中弹时先消耗护盾，不掉命，给 `0.8s` 无敌 |
| 炸弹 | 主动按钮；清空全屏敌弹 + 对全场敌人造成 `80 + 20×武器等级` 伤害 + 玩家无敌 `2.0s` |
| 复活 | **每关免费一次**：生命归零时弹窗，确认后恢复 2 命、清屏、无敌 `3.0s`，Boss 血量保留 |
| 通关 | 本关 Boss 被击沉 → `phase = won`，结算星级与金币 |
| 失败 | 生命归零且复活已用 → `phase = lost`，仍结算击杀金币 |
| 逃兵 | 敌机飞出屏幕底部消失，不给分不给钱，波次照常推进 |

### 4.1 火力形态（局内 `power`，1–5）

| 火力 | 弹数 | 形态 |
|------|------|------|
| 1 | 1 | 正中直射 |
| 2 | 2 | 左右各 1，间距 22px |
| 3 | 3 | 中间 1 + 两翼 `±0.10 rad` |
| 4 | 4 | 两列直射 + 两翼 `±0.14 rad` |
| 5 | 5 | 中央重弹 + `±0.10` + `±0.22` 五向 |

- 单发伤害 = `2 + 武器等级`（2–11）。
- 局内火力**不跨关继承**，每关从 1 开始；永久成长体现在基础伤害、僚机与容错上。
- 僚机（见 §7）按固定间隔 `0.18s` 直射；单发伤害 = `max(1, floor(主机伤害 × 僚机比例))`，比例由僚机等级决定（40% / 70%）。

---

## 5. 敌人、弹幕与关卡

### 5.1 小怪

| kind | 名称 | HP | 半径 | 分数 | 金币 | 下落速度 | 开火间隔 | 弹速 | 图案 |
|------|------|----|------|------|------|----------|----------|------|------|
| `grunt` | 侦察机 | 3 | 18 | 10 | 3 | 140 | 1.8s | 230 | `aim` |
| `weaver` | 游隼 | 5 | 20 | 20 | 5 | 110 | 1.5s | 210 | `spread3` |
| `tank` | 铁壁 | 12 | 28 | 50 | 10 | 70 | 1.6s | 190 | `ring8` |

- `weaver` 横向 `sin(t × 2.1) × 96` 摆动，出生点即摆动基准。
- HP 随关卡按 `× (1 + 0.06 × (关卡-1))` 修正（第 10 关约 1.54 倍），让旧关卡的怪不会一碰就碎。

### 5.2 Boss

| kind | 名称 | 基础 HP | 半径 | 分数 | 出场关卡 | 弹幕 |
|------|------|---------|------|------|----------|------|
| `destroyer` | 驱逐舰 | 140 | 60 | 240 | 1–2 | 瞄准弹与 8 向环交替，横向摆幅 ±150 |
| `fortress` | 要塞 | 260 | 64 | 360 | 3–5 | 三发螺旋（每轮转 0.42 rad）+ 隔轮瞄准弹 |
| `carrier` | 母舰 | 560 | 68 | 500 | 6–9 | 双螺旋（两个发射点反向旋转）+ 每 3 轮一次 5 向瞄准扇形 |
| `core` | 雷霆核心 | 1300 | 72 | 800 | 10 | **两阶段**：HP > 50% 为 12 向环 + 瞄准扇形；≤ 50% 间隔 ×0.75，追加螺旋 |

- Boss 先下降到 `y = 240` 就位，再横向摆动；`speed = 0`，不会掉出屏幕。
- 每关 Boss 的实际 HP 写在关卡表里（见 §5.3），上表是基准值。

### 5.3 十个关卡

| 关 | 名称 | 背景主色 | 波次编排（小怪） | Boss | Boss HP | 推荐武器等级 |
|----|------|----------|------------------|------|---------|--------------|
| 1 | 边境巡航 | 深蓝 `#0B1220` | `line4 → vee5` | 驱逐舰 | 140 | 0 |
| 2 | 陨石带 | 紫 `#120B24` | `vee5 → sine4 → flank6` | 驱逐舰 | 190 | 1 |
| 3 | 敌方哨站 | 墨绿 `#07160F` | `line6 → wall2 → crossfire` | 要塞 | 260 | 2 |
| 4 | 电磁风暴 | 青灰 `#0A1418` | `sine6 → flank8 → wall2` | 要塞 | 340 | 3 |
| 5 | 残骸区 | 棕 `#1A1109` | `wall3 → guard → crossfire` | 要塞 | 440 | 4 |
| 6 | 深海峡谷 | 深蓝 `#061426` | `vee8 → sine6 → wall3 → flank8` | 母舰 | 560 | 5 |
| 7 | 轨道要塞 | 紫红 `#1B0A1F` | `line8 → guard → crossfire → wall3` | 母舰 | 700 | 6 |
| 8 | 熔岩星云 | 橙 `#1C0D06` | `flank10 → sine8 → guard → wall4` | 母舰 | 860 | 7 |
| 9 | 虚空回廊 | 纯黑 `#05060A` | `wall4 → crossfire → flank10 → guard` | 母舰 | 1040 | 8 |
| 10 | 雷霆核心 | 金红 `#1E0B0B` | `guard → crossfire → wall4 → flank12 → vee10` | 雷霆核心 | 1300 | 9 |

**波次模板库**（全部是常量表，改关卡不用改逻辑）：

| 模板 | 含义 |
|------|------|
| `lineN` | N 架 `grunt` 同排落下 |
| `veeN` | N 架 `grunt` 组成 V 字（两侧交错出场） |
| `sineN` | N 架 `weaver` 带不同相位摆动 |
| `flankN` | 左右两列交错向中间压 |
| `wallN` | N 架 `tank` 慢速推进 |
| `guard` | 2 架 `tank` 居中 + 4 架 `grunt` 两翼 |
| `crossfire` | `weaver` 与 `tank` 交替出场，形成交叉火力 |

- 波次推进沿用《星际弹幕》语义：**当前波全部生成完毕且场上清空** → 隔 `0.9s` 进入下一波。
- 最后一波固定是 Boss。关卡数据结构与 `SHMUP_WAVES` 同构，直接写成 `THUNDER_LEVELS` 常量表。
- 「推荐武器等级」只做 UI 提示（例如显示“推荐火力 Lv.5”），**不做硬门槛**，避免卡关劝退。

---

## 6. 道具与掉落

掉落完全确定（按击杀数触发，不使用随机数）：

| 触发 | 掉落 |
|------|------|
| 每 10 个击杀 | 火力 `P`：局内火力 +1，封顶 5 |
| 每 20 个击杀 | 炸弹 `B`：炸弹存量 +1，封顶 `1 + 炸弹等级` |
| 每 35 个击杀 | 护盾 `S`：护盾 +1，封顶 1 |
| Boss 击沉 | 必掉火力 + 炸弹各 1 |

- 道具以 `90 px/s` 下落，出屏回收；拾取半径 `15 + 玩家碰撞半径 + 12`（比视觉宽松）。
- 金币**不做实体掉落**：击杀即时入账，避免弹幕中抢金币的干扰与性能开销。

---

## 7. 跨局养成（机库）

金币是唯一货币，来源见 §8。四条升级线，费用指数增长、全部有上限：

| 升级线 | 上限 | 效果 | 费用（Lv0→1 起） |
|--------|------|------|------------------|
| 武器 `attack` | 9 | 单发伤害 `2 + 等级`（2→11） | `100 × 1.55^lv` → 100 / 155 / 240 / 372 / 577 / 894 / 1386 / 2148 / 3330 |
| 装甲 `armor` | 4 | 生命上限 `3 + 等级`（3→7） | `200 × 1.8^lv` → 200 / 360 / 648 / 1166 |
| 僚机 `wing` | 3 | Lv0 无；Lv1 左右各 1（伤害 40%）；Lv2 左右各 1（伤害 70%）；Lv3 左右各 2（4 架，伤害 70%） | 300 / 600 / 1200 |
| 炸弹 `bomb` | 2 | 炸弹容量 `1 + 等级`（1→3） | 250 / 500 |

- 费用最终取整到 10。
- 全满约需 **1.4 万金币**；设计目标：**首次通第 10 关不需要满级**，约 6–8 次重复关卡即可达到推荐强度。
- 机库升级即时生效，下一局 / 当前局（若在战斗外）都读取最新属性。
- 「战力」只做展示性汇总：`100 + 武器×30 + 装甲×50 + 僚机×80 + 炸弹×20`，不参与任何计算。

---

## 8. 星级、金币与存档

### 8.1 星级

| 星级 | 条件 |
|------|------|
| ★ | 通关 |
| ★★ | 通关且**未使用复活** |
| ★★★ | 通关、未使用复活、**未使用炸弹** |

失败为 0 星。

### 8.2 金币结算

| 来源 | 数量 |
|------|------|
| 小怪击杀 | `grunt 3 / weaver 5 / tank 10`（即时入账） |
| Boss 击沉 | `40 + 关卡 × 10` |
| 通关奖励 | `30 + 关卡 × 10` |
| 星级奖励 | `(星级 - 1) × 20`（2★ +20，3★ +40） |

- **失败也保留击杀与 Boss 金币**，但没有通关 / 星级奖励；防止“失败零收益”导致的挫败感。
- 结算页显示「本局金币 / 累计金币 / 本关最高分 / 星级」。

### 8.3 存档

单键 JSON，键 `tiny_games_thunder_save`（`StorageManager` 自动加前缀）：

```ts
interface ThunderSave {
    coins: number;                                   // 累计金币
    upgrades: { attack: number; armor: number; wing: number; bomb: number };
    stars: number[];                                 // 长度 10，0–3
    bestScore: number[];                             // 长度 10
}
```

- `sanitizeSave()` 必须容忍：缺字段、`NaN` / `Infinity`、负数、超过上限、数组长度不符 → 逐字段回落到合法值。
- 存档版本号 `v: 1`，为后续迁移留位。

---

## 9. 界面与交互

720×1280 设计基准，全部 `Graphics` + `Label`，零贴图零音频；UI 复用 `assets/common/ui/GameUIKit.ts`。

### 9.1 界面状态机

```ts
type UiScreen = 'levels' | 'hangar' | 'battle' | 'settle' | 'revive' | 'pause';
```

- 同一时刻**只允许一个全屏遮罩层**存在，切换时先销毁旧层再建新层（避免多层叠放、按钮穿透）。
- `battle` 下才驱动 `world.update(dt)`；其余状态暂停世界。

### 9.2 关卡选择（主界面）

| 区块 | 内容 |
|------|------|
| 顶部 | 标题「雷霆战机」、金币数（矢量圆形 + 数字，不用 emoji） |
| 中部 | 10 张关卡卡（2 列 × 5 行，可滚动）：关卡号 / 名称 / 星级 / 最高分 / 锁定态 |
| 底部 | 「机库」按钮 |
| 左上 | 返回大厅 |

- 关卡解锁：第 1 关常开；第 N 关在 N-1 关 ≥ 1★ 后解锁。
- 锁定卡片置灰并显示「通关第 N-1 关解锁」。

### 9.3 机库

- 4 行升级项：名称、当前等级圆点、`当前值 → 下一级值`、费用按钮。
- 金币不足时按钮置灰并显示「金币不足」。
- 满级显示「MAX」。

### 9.4 战斗 HUD

| 区块 | 内容 |
|------|------|
| 顶部 | 关卡名、分数、生命三角图标、本局金币 |
| 顶部下方 | Boss 血条（Boss 就位后显示） |
| 右上 | 暂停按钮 |
| 右下 | 炸弹按钮（存量 + 图标），存量为 0 时置灰 |

### 9.5 结算 / 复活 / 暂停

- **结算**：胜利显示「关卡完成」+ 星级逐颗点亮 + 本局金币 + 最高分；失败显示「任务失败」。
  按钮：`重试` / `下一关`（仅胜利且存在下一关）/ `返回关卡`。
- **复活**：生命归零时弹出「战机被击落 / 免费复活一次」+ 5 秒倒计时，按钮 `复活` / `放弃`；超时视为放弃。
- **暂停**：`继续` / `退出本关`（退出按失败结算，无通关与星级奖励）。

### 9.6 视觉

- 战机青 `#4FD1FF`，自弹黄 `#FFE27A`，敌弹红 `#FF5C7A`；Boss 按种类分红 / 紫 / 橙 / 金。
- 战机、僚机、生命图标全部用**矢量三角/菱形**绘制，禁止 emoji（红线 10）。
- 背景：关卡主色底 + 三层星点滚动，复用《星际弹幕》的「按 `FIELD_H` 周期画 4 份 + 移动节点」方案。
- 打击反馈：敌机受击闪白 0.06s；炸弹为 0.3s 扩散光环；护盾为青色圆环。
- 屏幕震动不做（v1 控制范围）。

---

## 10. 代码结构与核心 API

```text
assets/games/game_thunder/
├── scenes/Thunder.scene          # Canvas + Camera + GameRoot（挂 ThunderGame）
└── scripts/
    ├── ThunderCore.ts            # 纯逻辑，无 cc 依赖
    └── ThunderGame.ts            # 运行时 UI + 输入 + 存档读写
tools/verify-thunder-core.js      # 纯逻辑自检（目标 35+ 项）
```

### 10.1 核心常量与类型

```ts
export const FIELD_W = 720, FIELD_H = 1280;
export const PLAYER_R = 9, PLAYER_VISUAL_R = 17;
export const PLAYER_MIN_Y = 260, PLAYER_MAX_Y = 1220;
export const BASE_FIRE_INTERVAL = 0.12;
export const MAX_POWER = 5;
export const MAX_LIVES = 7;
export const MAX_BULLETS = 1000;
export const WAVE_GAP = 0.9;
export const INVULN_TIME = 1.6;
export const SHIELD_INVULN = 0.8;
export const BOMB_INVULN = 2.0;
export const REVIVE_INVULN = 3.0;
export const REVIVE_LIVES = 2;

export type ThunderPhase = 'playing' | 'won' | 'lost';
export type EnemyKind = 'grunt' | 'weaver' | 'tank' | 'destroyer' | 'fortress' | 'carrier' | 'core';
export type PowerupKind = 'power' | 'bomb' | 'shield';
export type UpgradeTrack = 'attack' | 'armor' | 'wing' | 'bomb';

export interface ThunderLevelDef {
    index: number;          // 0–9
    name: string;
    bg: string;             // 背景主色
    waves: ThunderWave[];   // 小怪波次常量表
    boss: EnemyKind;        // 'destroyer' | 'fortress' | 'carrier' | 'core'
    bossHp: number;
    recommendAttack: number;
}
```

### 10.2 存档与养成接口

```ts
export function defaultSave(): ThunderSave;
export function sanitizeSave(raw: unknown): ThunderSave;
export function upgradeCost(track: UpgradeTrack, level: number): number;
export function applyUpgrade(save: ThunderSave, track: UpgradeTrack): boolean; // 扣币 + 升级
export function playerStats(save: ThunderSave): PlayerStats;
export function starsFor(win: boolean, usedRevive: boolean, usedBomb: boolean): number;
export function clearReward(levelIndex: number, stars: number): { clearCoins: number; starCoins: number };
```

### 10.3 世界接口

```ts
export class ThunderWorld {
  constructor(levelIndex: number, stats: PlayerStats);

  player: ThunderPlayer;
  playerBullets: Bullet[];
  enemyBullets: Bullet[];
  enemies: Enemy[];
  powerups: Powerup[];

  phase: ThunderPhase;
  score: number;
  coinsEarned: number;
  kills: number;
  waveIndex: number;
  waveTime: number;

  power: number;          // 局内火力 1–5
  lives: number;
  bombs: number;
  shields: number;        // 0 或 1
  invulnT: number;
  usedBomb: boolean;
  usedRevive: boolean;
  reviveAvailable: boolean;

  get level(): ThunderLevelDef;
  get boss(): Enemy | null;

  reset(): void;
  update(dt: number): void;        // dt 内部夹到 ≤ 0.05
  useBomb(): boolean;              // 成功消耗返回 true
  revive(): boolean;               // 每关一次
  movePlayerTo(x: number, y: number): void;
  movePlayerBy(dx: number, dy: number): void;
  clampPlayer(): void;
  remainingInWave(): number;
}
```

### 10.4 与《星际弹幕》的代码关系

- **复制范式，不复制代码**：`ThunderCore` 独立实现，保留 `Bullet / Enemy / Powerup` 的数据形状与 `angleTo()` 约定，方便日后抽公共层。
- 战斗渲染沿用「单 `Graphics` 每帧 `clear()` 重画 + 对象数组复用」；本轮不引入节点池。
- 输入沿用「根节点全屏 `UITransform` + 命名方法 + 按下偏移」三件套。

---

## 11. 确定性与自检

核心世界**不使用任何随机数**：

- 关卡波次是常量表；弹幕角度由 `shotIndex` 递增驱动；
- 道具掉落按击杀计数触发；
- 因此同一输入序列两次运行结果逐位相同，自检可直接断言。

### 11.1 `tools/verify-thunder-core.js`（实装 64 项，覆盖下列目标）

1. `LEVELS` 共 10 关、id 连续、每关非空波次、Boss 类型合法、Boss HP 单调递增；
2. `defaultSave()` 形状正确、数组长度 10；
3. `sanitizeSave()`：缺字段 / `NaN` / `Infinity` / 负数 / 超上限 / 数组长度错误全部回落；
4. `upgradeCost()` 单调递增、满级封顶；
5. `applyUpgrade()`：金币不足失败、满级失败、成功扣款且等级 +1；
6. `playerStats()` 四条线的数值与上限；
7. `starsFor()` 八种组合真值表；
8. `clearReward()` 随星级与关卡单调递增；
9. 玩家出生位置与边界夹取；
10. 自动开火：火力 1–5 的弹数分别为 1/2/3/4/5；
11. 僚机等级 0–3 的僚机数与伤害；
12. 子弹伤害等于武器等级换算值；
13. 护盾吸收一次伤害、不掉命、护盾清零、进入短无敌；
14. 炸弹：清空敌弹、对全场敌人造成伤害、消耗存量、进入无敌；
15. 炸弹存量为 0 时 `useBomb()` 返回 false；
16. 复活：恢复 2 命、清屏、无敌、仅一次；第二次返回 false；
17. 中弹掉命与无敌期内不重复掉命；
18. Boss 在最后一波就位、击沉后 `phase = won`；
19. 生命归零且复活已用 → `phase = lost`；
20. 波次推进：全部生成 + 清场后隔 0.9s 进下一波；
21. 金币掉落确定、击杀计数触发道具；
22. 存档往返一致；
23. 确定性：同一输入脚本跑两次，分数/血量/敌人位置完全一致；
24. 自动驾驶（无敌 + 贴脸输出）在 120 秒内打通第 1 关；
25. `MAX_BULLETS` 上限与越界清理；
26. 火力 / 生命 / 护盾 / 炸弹全部封顶；
27. 分数单调不减；
28. 第 10 关 Boss 两阶段阈值正确（HP 50% 后间隔缩短）；
29. 1,000 次随机升级购买不产生负数 / `NaN` / 越界；
30. 10 分钟长跑无 `NaN` / `Infinity`。

> 数值平衡另做一次性离线模拟（不计入 35 项）：按“每关都拾取 2 次火力、平均火力 3”的标准玩家模型，验证 10 关的通关耗时随推荐等级平滑上升，不出现断崖。

---

## 12. 验收用例（浏览器实测）

1. 大厅进入 → 关卡选择：10 张卡、第 2 关锁定、金币显示正确；
2. 打赢第 1 关 → 星级点亮、金币入账、第 2 关解锁；
3. 机库：升级武器扣金币、圆点 +1、下一局伤害提升；
4. 金币不足时升级按钮置灰；
5. 拖动战机跟手，按下点与战机保持偏移；
6. 自动开火，火力 1–5 的弹数正确，僚机随等级出现并开火；
7. 中弹掉命并无敌；护盾优先吸收；
8. 炸弹按钮清屏 + 伤害 + 无敌，存量减 1，用完后置灰；
9. 生命归零 → 复活弹窗 → 复活成功恢复 2 命；再次归零 → 失败结算；
10. Boss 血条随扣血缩短，击沉后通关结算；
11. 未复活 / 未用炸弹分别拿到 2★ / 3★；
12. 暂停 → 继续 / 退出本关；
13. 结算「重试 / 下一关 / 返回关卡」三条路径都正确；
14. 返回大厅后再次进入，金币 / 星级 / 解锁进度保留；
15. `node tools/verify-thunder-core.js` 全绿、`tsc --noEmit` 通过、预览 console 0 error。

### 12.1 浏览器实测记录（2026-11-09）

环境：Cocos Creator 3.8.8 编辑器预览（`http://127.0.0.1:7456/?scene=<Thunder.scene uuid>`）+ Playwright，设备像素坐标按当轮标定（dpr = 1，画布 CSS 393×678.55，kx ≈ 0.5458 / ky ≈ 0.5301）。

**逐项结论**（全部走真实点击 / 拖拽，探针只用于读状态）：

| §12 用例 | 结果 |
|---|---|
| 1 关卡选择 | ✅ 10 张卡 + 锁定态 + 星星 + 金币正确 |
| 2 通关解锁 | ✅ 第 1 关 3★、金币 +128 入账、第 2 关解锁 |
| 3 机库升级 | ✅ 四条线各升一级，金币扣减与圆点同步；下一局 `damage 3 / maxLives 4 / wingCount 2 / bombCapacity 2` 生效，僚机实际渲染并开火 |
| 4 金币不足置灰 | ✅ 余额不足时按钮置灰（点击无效） |
| 5 拖动跟手 | ✅ 玩家 (360,1090) → (143,951)，与指针保持按下偏移 |
| 6 自动开火 / 火力 | ✅ 火力 3 三路齐射（截图核对），火力 1–5 弹数与 `verify-thunder-core.js` 一致 |
| 7 中弹 / 护盾 | ✅ 护盾优先吸收：`{lives:5, shields:0, invuln:0.65}`，生命不减；无护盾时掉命 + 短无敌 |
| 8 炸弹 | ✅ 清敌弹 + 全场伤害 + 无敌，炸弹 1→0、`usedBomb = true`，用完后按钮置灰 |
| 9 复活 | ✅ 生命归零弹复活窗 → 复活：`lives 2`、`usedRevive = true`、`reviveAvailable = false`；放弃 → 失败结算 |
| 10 Boss 血条 | ✅ 第 1 关 Boss 140 HP 就位 y = 240，血条随扣血缩短（截图核对 600/600 → 93%），击沉后通关 |
| 11 星级 | ✅ 未复活 / 未用炸弹 = 3★；用过复活 = 2★ |
| 12 暂停 | ✅ 暂停 → 继续 / 退出本关均正确；暂停期间世界不推进 |
| 13 结算三路径 | ✅ 重试（同关重开）/ 下一关（+1 关）/ 返回关卡（回选关） |
| 14 存档 | ✅ 刷新页面 + 往返大厅后金币 / 星级 / 解锁保留（键 `tiny_games_thunder_save`） |
| 15 静态检查 | ✅ `node tools/verify-thunder-core.js` → `THUNDER_CORE_OK`（64/64）；编辑器自带 `tsc --noEmit` 通过；预览 console **0 error**（仅 2 条既有引擎弃用警告 `systemEvent`） |

**本轮发现并修复的缺陷**（均已在预览里复测通过）：

1. **暂停会吃掉复活窗**：复活倒计时中按暂停 → `_clearOverlay()` 把 `_overlay` 置空，但 `_reviveShown` 仍为 `true`，恢复后 `update()` 不再拉起复活面板 → 玩家卡在 `phase = 'revive'` 无法操作。修法：`_resumeGame()` 在 `phase === 'revive'` 时重置 `_reviveShown = false`。
2. **非法关卡号导致 NaN 级联**：直接以 `undefined` 调 `_startBattle()` 时 `Math.min(...)` 产出 `NaN` → `_levelIndex = NaN` → 关卡名读取报错 200 条。修法：入口 `Number.isFinite` 兜底并夹取 `[0, LEVELS.length - 1]`。
3. **结算面板下边距过小**：600×640 面板里「返回关卡」按钮底边贴到边框（4px）。修法：面板放大到 600×680 并整体下移标签，三个按钮的上下边距恢复均匀。

---

## 13. 实现里程碑

| 阶段 | 内容 | 预估 |
|------|------|------|
| M1 | `ThunderCore.ts` + `verify-thunder-core.js`：关卡表、养成、战斗、结算全逻辑 | 1.5 人日 |
| M2 | `Thunder.scene`（MCP 创建）+ 战斗渲染 / 输入 / HUD | 1.5 人日 |
| M3 | 关卡选择 / 机库 / 结算 / 复活 / 暂停五套 UI + 存档 | 1.5 人日 |
| M4 | 平衡调参、浏览器验收、微信构建预检 | 1 人日 |
| 合计 | | **约 5.5 人日** |

实现顺序严格遵守项目约定：**先 core + verify，后场景；场景一律走 MCP，不直接改 `.scene`**。

---

## 14. 明确不做（v1）

- 多机型选择与机型专属弹道（只做一架基础战机 + 僚机）；
- 装备 / 芯片 / 随机词条等深度养成（四条升级线已够）；
- 无尽模式、每日挑战、排行榜、分享图；
- 联网、云存档、内购；
- 音效与 BGM（全项目仍无音频基建，等 `rhythm` 一起补）；
- 屏幕震动、慢动作、动态难度；
- 手柄 / 键盘操作（移动端优先）。

---

## 15. 风险与取舍

| 风险 | 处理 |
|------|------|
| 与《星际弹幕》同质化 | 核心差异写在 §2：关卡制 + 跨局养成 + 炸弹/护盾/复活；弹幕本身刻意少做新图案 |
| 数值失衡（升级太快 / 太肝） | 费用上限与 ¥1.4 万金币总盘先定死；用离线模拟校准，不靠手感拍脑袋 |
| 关卡表膨胀 | 7 种波次模板 + 4 种 Boss 复用；关卡只写“模板序列 + 血量”，不写逐条生成脚本 |
| UI 状态多、面板互相叠 | `UiScreen` 单状态机 + 全屏遮罩先销毁后创建；战斗内不常驻可点穿的元素 |
| 微信小游戏性能 | 子弹硬上限 1000、单 `Graphics` 每帧重画、无节点池；沿用 `shmup` 已验证的 60 FPS 方案 |
| 局内捡金币干扰操作 | 金币不做实体掉落，击杀即时入账 |
| 名称商标 | 见文档开头的改名提示 |

---

## 16. 单款接入清单（收尾时逐项确认）

1. `GameConfig.ts` 的 `GAME_LIST` 追加 `{ id: 'thunder', name: '雷霆战机', sceneName: 'Thunder', ... }`；
2. 场景位于 `assets/games/game_thunder/scenes/Thunder.scene`，场景名与 `sceneName` 一致；
3. `tools/verify-thunder-core.js` 全绿；
4. 编辑器自带 `tsc --noEmit` 通过；
5. 浏览器预览实测 §12 全部用例；
6. `node tools/sync-build-scenes.js` 同步构建场景（脚本按 `GAME_LIST` 自动生成）；
7. `node tools/check-wechat-build.js` 9 项全绿 + 微信真机（iOS / Android）；
8. 无匿名事件 handler、`onDestroy` 不访问任何 `@property(Node)`、无节点泄漏；
9. 图标文本经 `stripVariationSelectors()`，`assets/` 内无 `U+FE0E` / `U+FE0F`；
10. 同步更新：`AGENTS.md` 项目结构 / 游戏注册清单、`docs/README.md` 索引、路线图 §4 状态；
11. 提交信息 `feat(thunder): 新增《雷霆战机》关卡制养成弹幕射击`。
