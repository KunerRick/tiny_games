# 小店日记（`idle`）玩法设计

- 日期：2026-11-05
- 状态：设计定稿，骨架实现中
- 对应路线图：[`2026-11-05-game-catalog-and-roadmap.md`](../plans/2026-11-05-game-catalog-and-roadmap.md) §5.3（P1-1）
- 场景：`assets/games/game_idle/scenes/Idle.scene`
- id / sceneName：`idle` / `Idle`

---

## 1. 一句话玩法

经营一家小店：点击赚金币，升级货架 / 收银台 / 店员 / 仓库；离开后回来，离线收益按秒结算。

## 2. 目标体验

- 合集里**第一款有跨局养成**的游戏：关掉再回来，金币和等级还在，这是本作存在的理由。
- 单次在线 1–3 分钟即可完成一轮「攒钱 → 升级 → 看着每秒收入变高」，不占用大块时间。
- 收益必须**看得见地涨**：每次升级后「+X/秒」「每次点击 +Y」立刻变化，离线弹窗给出「离开 N 小时，赚了 M」。
- 不做剧情、不做顾客动画，用数字成长本身提供正反馈。

## 3. 数值与规则

### 3.1 资源

- 唯一资源：金币（`coins`）。上限 `1e15`（1000T），到达上限后不再增长，杜绝 `Infinity` / 精度失真。
- 点击收益、自动收益、离线收益都只增不减；**没有任何失败态**，不存在破产。

### 3.2 四类设施（各 5 级）

| id | 名称 | 每级效果 | 首级费用 | 费用倍率 | 满级效果 |
|----|------|----------|----------|----------|----------|
| `shelf` | 货架 | 每次点击 +2 金币 | 20 | ×3.4 | 点击 +10 |
| `counter` | 收银台 | 每秒收入 +0.6 | 50 | ×4.0 | 每秒 +3.0 |
| `clerk` | 店员 | 点击与自动收益 **+20%** | 120 | ×4.2 | +100% |
| `warehouse` | 仓库 | 离线收益效率 **+12%** | 80 | ×3.8 | 离线效率 100% |

- 升级费用：`round(baseCost × growth^当前等级)`，等级 0 → 5。
- 仓库不影响在线收益，只提高离线结算比例（基础 40%），是「隔天回来」玩家才需要投资的设施。

### 3.3 收益公式

```
clickPower = (1 + 2 × shelf) × (1 + 0.2 × clerk)
autoRate   = 0.6 × counter × (1 + 0.2 × clerk)      // 金币 / 秒
offlineRate = min(1, 0.4 + 0.12 × warehouse)        // 离线效率
offlineGain = autoRate × min(离线秒数, 8h) × offlineRate
```

- 点击：点一下加 `clickPower` 金币。
- 在线自动：每帧加 `autoRate × dt`，`dt` 单帧上限 5 s（防止切后台回来一帧灌入巨额收益）。
- 离线：以本地时间戳结算，见 §4。

### 3.4 大数格式化

`1.2K / 3.4M / 5.6B / 7.8T`，单位步进 10³，最多到 `T`；`1e15` 显示为 `1000T` 并封顶。

- `< 1000`：整数（金币、费用向下取整）。
- `≥ 1000`：一位小数，去掉无意义的 `.0`。
- 输入为 `NaN` / 负值 / `Infinity` 时一律按 0 处理。

## 4. 离线结算（核心边界）

- 每次进入场景读档，用 `now - lastTick` 计算离线时长，结算后把 `lastTick` 更新为 `now`。
- 离线时长 **上限 8 小时**；超过部分直接丢弃（弹窗标注「已按 8 小时上限结算」）。
- **时间倒退**（用户改系统时间、跨时区回拨）：`elapsed < 0` 按 0 处理，不产生负收益，也不清空进度；`lastTick` 仍更新为 `now`，避免持续报错。
- **大幅前进**（改到未来）：只按 8 小时结算，其余丢弃；`lastTick` 更新为 `now`。
- 离线收益 < 1 金币或离线 < 60 s 时不弹窗（避免频繁进出时反复打断）。
- 弹窗内容：离开时长、离线收益、离线效率、当前每秒收益。

## 5. 界面布局（设计分辨率 720×1280，左上原点）

| 区域 | 位置 / 尺寸 |
|------|-------------|
| 返回按钮 | 左上，复用 `createBackButton` |
| 标题「小店日记」 | (360, 64)，44px；副标题 `IDLE SHOP` (360, 104) |
| 金币总数 | (360, 188)，60px 粗体；下方「每秒 +X · 每次点击 +Y」22px |
| 设施卡片 ×4 | y = 340 / 508 / 676 / 844，560×150 圆角卡片 |
| 卡片内容 | 左：名称 + 当前效果 + 下一级效果；右：升级按钮（180×80，显示费用） |
| 点击赚钱按钮 | y=1080，600×140 大按钮，文案「点我赚钱 +X」 |
| 底部说明 | y=1190，19px 灰字 |
| 离线结算弹窗 | 560×480 居中，遮罩点击空白关闭 |

- 卡片：等级用 5 个小方块表示（已点亮金色、未点亮深灰），满级显示「已满级」。
- 金币不足时升级按钮置灰并显示差额提示（点击 toast「还差 X 金币」）。

## 6. 交互流程

```
进入场景
  └─ onLoad：读档 → settleOffline(now)
        ├─ 有离线收益：弹结算面板（点空白关闭）
        └─ 无：直接进入主界面
点击「点我赚钱」→ coins += clickPower → 刷新数字（按钮轻微缩放反馈）
点升级
  ├─ 已满级：toast「已满级」
  ├─ 金币不足：toast「还差 X 金币」
  └─ 成功：扣钱、升级、刷新卡片与收益
每秒自动收入：update 累加；每 5 s 存一次档
返回大厅 / 场景销毁：立即存一次档（记录 lastTick）
```

## 7. 可玩性评估

**核心循环**

- 前 2 分钟：点击攒钱 → 买第一个收银台（50）→ 看到「+0.6/秒」开始自己跳，形成第一次「挂机比手点强」的认知。
- 前 10 分钟：依次解锁店员（全局加成）与仓库（离线效率），把「在线」和「离线」两条收益线都打开。
- 之后：靠离线收益回归，每次回来至少能买 1–2 级，形成日回访。

**数值节奏**（按 0 级开局估算）

| 阶段 | 时间 | 主要收入 | 目标 |
|------|------|----------|------|
| 起步 | 0–2 min | 手点 1 金币 | 买收银台 |
| 自动化 | 2–10 min | 每秒 0.6–2 | 收银台 2 级 + 货架 2 级 |
| 加乘 | 10–30 min | 每秒 3–8 | 店员 1–2 级 |
| 离线 | 次日 | 离线 8h × 效率 | 仓库 1–3 级 |
| 满级 | 数天 | — | 四设施全 5 级（约 9 万金币总量） |

**风险与处理**

| 风险 | 影响 | 处理 |
|------|------|------|
| 改系统时间刷离线收益 | 数值膨胀 | 单次离线硬上限 8h；回拨按 0；金币封顶 1e15 |
| 切后台一帧灌入巨额收益 | 平衡破坏 | `tick` 单帧 `dt` 上限 5 s；离线走时间戳结算 |
| 浮点累积导致 `NaN` / `Infinity` | 存档报废 | 所有入口 clamp，格式化函数对非法值兜底，读档逐字段校验 |
| 存档损坏 / 旧版本 | 进不去游戏 | 读档失败回落全新存档；字段缺失按默认值补齐 |
| 后期只剩等待 | 无聊 | v1 边界；v1.1 再加「每日订单 / 里程碑奖励」制造短期目标 |

**结论**：作为「放置经营」品类的第一款，闭环最小但完整（点击 → 自动 → 离线 → 升级），纯逻辑可离线自检，不依赖美术与音频，适合作为合集的第一个「留存款」。

## 8. v1 不做

- 多店铺、分店、员工技能树。
- 订单系统、顾客动画、广告加速、内购、排行榜。
- 音效、皮肤、剧情文本。
- 云存档（仅本地 `localStorage`）。

## 9. 技术方案

### 9.1 文件

```
assets/games/game_idle/
├── scenes/Idle.scene            # Canvas + 一个挂 IdleGame 的空节点，UI 全部运行时构建
└── scripts/
    ├── IdleCore.ts              # 纯逻辑：费用、产出、离线结算、数值格式化、存档（无 cc 依赖）
    └── IdleGame.ts              # Cocos 组件：UI 构建、点击 / 升级、计时与存档
tools/verify-idle-core.js        # Node 自检
```

### 9.2 `IdleCore` 公开接口

```ts
export const IDLE_MAX_LEVEL = 5;
export const IDLE_MAX_COINS = 1e15;
export const IDLE_OFFLINE_CAP_SEC = 8 * 3600;
export const IDLE_FACILITIES: IdleFacilityDef[];
export type IdleFacilityId = 'shelf' | 'counter' | 'clerk' | 'warehouse';

export function formatIdleNumber(n: number): string;
export function idleUpgradeCost(id: IdleFacilityId, level: number): number; // 满级返回 -1

export class IdleCore {
    coins: number;
    levels: Record<IdleFacilityId, number>;
    lastTick: number;
    totalEarned: number;

    get clickPower(): number;
    get autoRate(): number;
    get offlineRate(): number;
    get isMaxed(): boolean;

    tap(): number;                                  // 返回本次点击收益
    buy(id: IdleFacilityId): boolean;               // 扣钱升级，失败返回 false
    tick(dt: number): number;                       // 在线自动收益，返回本次收益
    settleOffline(now: number): IdleOfflineResult;  // { elapsedSec, cappedSec, gain, rate }
    snapshot(now: number): IdleSnapshot;
    static fromSnapshot(raw: unknown): IdleCore;    // 坏档回落全新存档
}
```

### 9.3 自检（`tools/verify-idle-core.js`）

- 费用：四设施 × 5 级费用与配置表一致、单调递增；满级返回 -1。
- 收益：点击 / 自动 / 离线公式与等级关系正确；升级后收益严格变大。
- 离线：8 h 上限、负数时长按 0、跨时区回拨无负收益、`lastTick` 前移后正确。
- 数值安全：连续 30 天离线模拟、10 万次点击 / 升级，无 `NaN` / `Infinity` / 负值；金币封顶 1e15。
- 格式化：0 / 999 / 1000 / 1.5K / 1e15 / NaN / Infinity / 负数。
- 存档：往返一致（写入 → 读回 → 再写结果不变）；坏档（`null` / 缺字段 / 类型错 / 负等级 / 超大数值）回落默认。
- 时间倒退 / 跨时区（`Date` 时区无关，只依赖毫秒时间戳）：不产生负收益。

### 9.4 场景接入

1. `Idle.scene`：Canvas + 空节点 `GameRoot`，挂 `IdleGame` 组件。
2. `GameConfig.ts` 注册：`{ id: 'idle', name: '小店日记', icon: 'default', sceneName: 'Idle', description: '点击经营小店，升级设施，离线也赚钱' }`。
3. 跑 `node tools/sync-build-scenes.js` 同步微信构建场景清单。

## 10. 验收清单

- `node tools/verify-idle-core.js` 全绿。
- Cocos 自带 `tsc --noEmit` 通过。
- 浏览器预览实测：点击赚钱、四项升级、满级提示、金币不足提示、离线弹窗（构造 `lastTick` 为 2 小时前）、刷新页面进度保留、返回大厅再进入进度保留。
- 微信真机：按钮可点、数字不溢出卡片、主包体与构建预检通过。
