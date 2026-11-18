# 试玩打磨台账索引

> 协议：[`../tech/playtest-cycle.md`](../tech/playtest-cycle.md) ｜ 五维方法：[`../tech/playtest-dimensions.md`](../tech/playtest-dimensions.md)
>
> 本文件是**问题编号的唯一分配源**。开工前读「全局下一编号」，本轮结束后写回。
> 每款游戏一份台账；本索引只放一行摘要与链接。

## 全局编号

| 项 | 值 |
|---|---|
| 全局下一编号 | **N159** |
| 最后更新 | 2026-11-18（round30 复核：N151 / N139 / N153 / N154 / N155 全部 **CONFIRMED 关闭**（N151/N139 按 P1 口径复核）；新开 N157（首领墙文案，已当拍修）/ N158（不可达边界，`open`）；E2 独立读数 3（可见性判断） |

## 台账一览

| 游戏 | 台账 | 当前阶段 | 未关闭 P0/P1 | 未关闭 P2/P3 | 最近全量轮 | 下一批焦点 |
|---|---|---|---|---|---|---|
| 秘银远征（mithril） | [`playtest-ledger-mithril.md`](./playtest-ledger-mithril.md) | 可玩（P0/P1 = 0；稳定性 `frozen`；round30 复核无 P0/P1） | 0 | **15**（round30 新开 4 中 N153 / N154 / N155 已复核关闭，N156 `open`；复核另开 N157 已修 / N158 `open`；存量 N143 / N146 / N148 `open`、N152 `open`（watch）、N141 `deferred`、N107 / N127 `accepted`、N128–N132 `deferred`） | round30 复核（玩法 / 交互） | UI 收尾（N156 + N128–N132 / N141 / N143 / N148）→ fresh 玩家补 E2 行为证据 |
| 冰箱底下（fridge） | 未建（下次跑该游戏时按模板建立） | 可玩 | 0 | 2（N34/N35，均 P3，round9 遗留） | round9 | UI / 交互 |

## 其他历史轮次（未单独立台账）

| 范围 | 说明 |
|---|---|
| N1–N18（全站 UX 大扫，round1–2） | 跨游戏共性问题；修复与未落地项见 [`2026-11-11-playtest-fix-review.md`](./2026-11-11-playtest-fix-review.md) 与各轮复验 |
| N19–N33（冰箱，round3–9） | 状态见 [`2026-11-13-playtest-round5-reverify.md`](./2026-11-13-playtest-round5-reverify.md)、[`2026-11-13-playtest-round6-reverify.md`](./2026-11-13-playtest-round6-reverify.md) 与 round7–9 报告；**N34/N35 仍未关闭** |
| N36–N158（秘银，round10–30） | 见 [`playtest-ledger-mithril.md`](./playtest-ledger-mithril.md) 的归档区间与未关闭项；round27 新开 N133–N143，经独立复核关闭 7 条、N135 判 `within`；round28 新开 N144–N147（N144/N145 经独立复核 CONFIRMED 关闭），复核另开 N148/N149；round29 修 N147（副本首领血 1800，033 下限 1.20）并落地 N142/N149/N150，新开 N150–N152；round29 复核四条全部 CONFIRMED 关闭；round30 修 N151（四表面回退文案 + 条件化警示，wild 闸 2973 项）与 N139（0 ms 短按），新开 N153–N156（N153/N154/N155 当拍修、N156 `open`）；**round30 复核五条全 CONFIRMED 关闭（N151/N139 按 P1 口径），另开 N157（首领墙文案，已修）/ N158（不可达边界，open）** |

## 编号规则

1. 新问题从「全局下一编号」起，**跨游戏、跨轮次连续**；
2. 一个编号只对应一条问题；子问题若独立修复，用 `Nxxa` / `Nxxb`（只在原报告内使用，不占新编号）；
3. 每批结束时把「下一编号」写回本文件；
4. 不允许回填、重排或复用已关闭编号。
