# 修复批 · 《秘银远征》 round37 · 焦点维度：玩法（N190 / N191 / N192 + 三条实机复核）

> 执行者：主会话（开发者），非 fresh 试玩者。本拍**不测 E 分**（无新玩家旅程），
> 只做「上拍 P2 修复 + 待复核项实机回证 + 闸门」。
> 日期：2026-11-19　环境：Cocos Creator 3.8.8 预览 `http://127.0.0.1:7456/`、MCP `http://localhost:3000/mcp`
> 截图：`docs/assets/2026-11-19-mithril-round37/`（gitignored）

---

## 1. 本拍改了什么

| 编号 | 改动 | 文件 | 性质 |
|---|---|---|---|
| **N190** | 出发复用玩家正看着的 `_mapSeed`；新增 `_rotateMapSeed()` 并在四条远征结束路径（放弃 / 阵亡 / 区域通关 / 副本通关）后轮换 | `MithrilGame.ts` | 行为修复（P2） |
| **N192** | 砸地 / 首领预警圈描边 3 → **5 design px**、填充 alpha `40+k·55` → **`90+k·85`**、描边 alpha `150+k·90` → **`210+k·45`**、内圈 2 → 3 | `MithrilRenderer.ts` | 可读性修复（P2，待复核者裁决是否关闭） |
| **N191** | **部分修复**：玩家脚下加「阴影 + 职业色脚环」（`_drawPlayerFootMark`，半径 = 碰撞半径 18，**不改判定**）；敌人脚下加地面阴影。彻底解法（镜头推近 / 实体放大 + HUD 分层）**未做**，N191 保持 open | `MithrilRenderer.ts` | 观感补强（P2 部分） |

代码片段（N190）：

```ts
// onWildPrimary()
const seed = this._mapSeed;                       // 预览图与远征图必须同一张
save.expedition = createExpedition(region.id, seed, profile.maxHp);
this._ensureMapFor(region.id);

// 新增
private _rotateMapSeed(): void {
    this._mapSeed = ((Math.imul(this._mapSeed, 1664525) + 1013904223) >>> 0) & 0x7fffffff;
    if (this._mapSeed <= 0) this._mapSeed = 1;
}
```

插入点：`_abandonExpedition` / `_expeditionDown` / 副本通关分支 / 阵亡分支，均在 `save.expedition = null` 之后。

---

## 2. 实机验证（逐条）

### 2.1 N190 出发前后是同一张图（**通过**）

| 观测点 | 读数 |
|---|---|
| 预览态 `_mapSeed` / `_wildMap.seed` | 2072654570 / 2072654570（一致） |
| 预览态节点种类 | `0:start,1:battle,2:battle,3:event,4:elite,5:battle,6:battle,7:chest,8:supply,9:dungeon,10:dungeon,11:boss` |
| 点「开始远征」后 `expedition.seed` | **2072654570**（与预览同） |
| 远征态在用图 `_wildMap.seed` | 2072654570 |
| 远征态节点种类 | 与预览**逐节点完全相同**（含 6:battle / 7:chest） |
| 按钮文案 | 开始前「开始远征」→ 开始后「放弃远征」 |

种子轮换（另两条路径同步验证）：

| 路径 | 轮换前 → 轮换后 | 结果 |
|---|---|---|
| 放弃远征（确认弹窗「放弃」） | 1903144439 → 2072654570 | 新图、与 `_mapSeed` 一致 ✅ |
| 阵亡 →「返回路线图」 | 2072654570 → 194430273 | 新图、`expedition` 清空 ✅ |

副本通关 / 区域通关两条路径**本拍不可达**（装等 2.6，与 round36 结论一致），仅代码级确认插入点。

### 2.2 N192 预警圈可辨认（**通过，渲染层**）

用**声明式注入**（见 §4）在真实战斗里塞一枚 `slam` 预警圈：
`{ x: 360, y: 530, radius: 120, warn: 2, kind: 'slam' }` → 设计半径 120 映射 **65.5 CSS px**。

- `r37-telegraph-f0/f1/f2.png`：三帧连续采样，红色圆面 + 粗描边在 393 CSS 宽画布上**一眼可见**，
  内圈收缩线也清楚；f1 的填充约在 45%–60% 透明度区间（k≈0.4–0.8）。
- 与修复前对比（round36 `r36-24`：fill ≤37%、描边 ≈1.6 CSS px）差异显著。

⚠️ 本项验证的是**渲染可见性**：注入的圈由真实 `render()` 走 `_drawTelegraphs` 绘制；
未验证「真实砸地读条在战斗中按时出现」，该段需副本 BOSS 战，本拍不可达。

### 2.3 N191 视野（**部分修复，仍 open**）

- 新增绘制在 `render()` 里紧跟 `_drawFloor`，先于预警圈与实体：`r37-telegraph-f1.png` 中玩家脚下可见
  深色阴影 + 职业色椭圆环，敌人脚下也有阴影。
- **不改碰撞 / 受击**：`_drawPlayerFootMark` 只用 `PLAYER_RADIUS` 画椭圆，无任何写入。
- 未解决：角色 / 敌人本体仍是 18 / 10 CSS px。镜头方案会让 HUD 一起放大
  （HUD 与 `Field` 同为 `this.node` 下 720×1280 的 `UITransform`），需拆第二个相机 / Layer，本拍不做。

### 2.4 N193 天赋 0 点点击反馈（**未复现 → 很可能是误读**）

| 步 | 读数 |
|---|---|
| 初始 | 天赋点：可用 2 · 已投 0/2 |
| 点「坚韧」×2 | `talents = {"warrior_steel_t1_0":2}`，提示行「本次加点生效：受伤 −1.0%」 |
| 第 3 次点（0 点） | 提示行 = **「没有可用天赋点」**，`activeInHierarchy = true`，颜色 **`e06060`**（danger），`talents` 不变 |

截图 `r37-n193-talent-no-points.png`：红字在面板最底部（y≈−450 区），**字号约 10 design px ≈ 5.5 CSS px**、离被点的卡片很远。

→ 反馈**存在**，失的是「可达性」：小、远、低对比。建议按 P3 处理（并入 N178 可读性余量批），不建议按 P2 缺陷修逻辑。

### 2.5 N194 升级回满血（**机制未复现 → 非数值缺陷**）

在真实战斗 core 上做半血 + 上限提升测试（声明式注入，见 §4）：

| 步 | hp / maxHp |
|---|---|
| 压到 50% | 129 / 258（50.0%） |
| `setProfile(maxHp + 20)`（等价一次升级） | **149 / 278（53.6%）** |

只补上限差额 20 点，**没有回满**。round36 观察到的 `134/134 → 152/152` 是「升级那一刻本来就满血」
（满血时 +18 上限正好等于 +18 当前生命，读起来就是"回满"）。
→ 结论：非缺陷；残余是**观感/文案**问题（升级横幅可写「生命上限 +18」以消除"回满"错觉），建议降 P3 由复核者裁决。

### 2.6 N198 职业页只有战士（**未复现**）

| 节点 | `activeInHierarchy` | 世界坐标 |
|---|---|---|
| ClassCard_warrior | true | (202, 846) |
| ClassCard_mage | true | (518, 846) |
| ClassCard_ranger | true | (202, 578) |
| ClassCard_priest | true | (518, 578) |

标签读回：战士 / 法师 / 游侠 / 牧师 四张卡 + 三张「点击选择」。截图 `r37-n198-classselect.png` 为 2×2 四卡齐全。
→ round36 的「只有一个选择」未复现。**但**：未选中的三张卡文字颜色很暗（深底上的灰字），
fresh 玩家可能读成"不可选"。建议留 P3 观感项（提高未选中卡对比度 / 加「可选」标识），不判缺陷。

---

## 3. 闸门

| 闸门 | 结果 |
|---|---|
| editor tsc 5.8.2 `--noEmit` | **TS_OK** |
| `node tools/verify-mithril-core.js` | **245/245** exit 0 |
| `node tools/verify-mithril-wild.js` | **2975** 项 exit 0 |
| `node tools/verify-mithril-dungeons.js` | **892** 项 exit 0 |
| `node tools/verify-mithril-newplayer.js` | **123** 项 exit 0（矿坑 6/6 胜，最慢 162.2 s，胜局最低血 0.192） |
| `node tools/verify-mithril-balance.js` | **139** 项 exit 0 |
| `node tools/verify-template-core.js` | **15** 项 exit 0 |

闸门无新增失败项；N190 的种子改动未触碰 `generateWildMap` 本身（`wild` 2975 项不变）。

---

## 4. 覆盖声明

### 4.1 到达（纯净 / 注入分列）

| # | 动作 | 类型 | 影响判定 |
|---|---|---|---|
| 1 | `cc.director.loadScene('Mithril')` 进场景（未点大厅图标） | **声明式捷径** | 否（只省一次点击，未改状态） |
| 2 | 放弃远征 → 开始远征 → 进战斗节点 1（imps）→ 阵亡 → 返回路线图 | 纯净 | — |
| 3 | 二次开始远征 → 进战斗节点 1 → 开成长页 → 点「坚韧」×3 | 纯净（消耗真实天赋点，末尾整档还原） | — |
| 4 | 打开职业选择页（`_classRef.open()`，未点「以战士开局」） | **声明式捷径** | 否（纯 UI，不改 classId） |
| 5 | 包裹 `core.snapshot()` 追加一枚 `slam` 预警圈（N192） | **声明式注入** | 否（只进渲染层，不写核心状态） |
| 6 | 把 `core.player.hp` 压到 50% 并调用 `setProfile(+20 maxHp)`（N194） | **声明式注入** | 否（测完立即还原 maxHp / hp） |

**未注入存档伪造进度**；2.1 / 2.3 / 2.4 的所有到达均来自真实 UI 操作。

### 4.2 未到达（不是不可达）

副本 / 区域 BOSS（装等 2.6）、宝箱 / 精英节点、暂停菜单、触摸输入路径、`_rotateMapSeed` 的副本通关分支。

---

## 5. 存档往返

| 项 | 值 |
|---|---|
| 开场快照 | `.playwright-mcp/r37-save-before.txt`，len **1813**，sha256 **`b381ab617d1bec0ca3fbc87ea91ed302a1ae480382c6a751f482d82fcebee769`**（与 round36 规范快照同一份） |
| 恢复方式 | `page.addInitScript` 内 `sessionStorage` 一次性守卫写回 → 带 `?t=` reload（脚本由 `python3 -I` 从快照程序化生成，未手抄） |
| 读回 | len 1813、`JSON.parse` 通过、`visited=[0,1,3]`、seed 1818887116 / pos 3 / supply 0 / hp 212 / gold 5010 / talents `{}`；reload 后 4.5 s 与 7 s 两次读回 djb2 一致 |

**过程事故（如实记录）**：第一次恢复手抄 base64 时把 `[0,1,3]` 抄成 `Z0,1,3]`（1 字节），
写入后 `JSON.parse` 抛 `Unexpected token 'Z'`。发现后按字节修回（长度仍 1813、sha256 与规范快照一致），
用新守卫键重新恢复并复验。**教训：存档快照一律从探针输出程序化生成，不手抄 base64。**

---

## 6. stop_reason

**`budget`**

- 三条修复 / 部分修复已落代码 + 实机回证；三条待复核项已给出判定依据。
- 剩余高价值项（N191 镜头方案、N195 篝火扣补给、N196 伪选择、N197 换装感知）都需要设计取舍或跨面板布局，
  不在单拍 5 条额度内。
- 副本 / 区域 BOSS 相关路径本轮仍不可达（装等 2.6），如实记录、未注入。

---

## 附：截图

| 文件 | 内容 |
|---|---|
| `r37-01-map-current.png` | 放弃远征确认弹窗（会话起点） |
| `r37-telegraph-f0/f1/f2.png` | N192 三帧：注入 `slam` 圈在实机尺寸下清晰可辨（f1 为最佳帧） |
| `r37-n193-talent-no-points.png` | N193：0 点时点卡，面板底部红字「没有可用天赋点」 |
| `r37-n198-classselect.png` | N198：2×2 四职业卡全在（未选中卡文字偏暗） |
