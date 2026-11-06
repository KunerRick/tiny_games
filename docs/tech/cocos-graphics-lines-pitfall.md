# Graphics 画线：`stroke()` 的整片消失与 `fill()` 兜底

> 2026-11-06 五子棋评审时遇到。现象很吓人（棋盘只剩一半网格），但根因边界很窄，
> 结论先给：**网格线一律用 `rect() + fill()` 画，不要用 `moveTo/lineTo + stroke()`。**

## 1. 现象

五子棋棋盘 15×15 网格，在同一个 `Graphics` 上按顺序画：

```ts
for (let i = 0; i < 15; i++) { const p = ...; g.moveTo(-H, p); g.lineTo(H, p); }   // 横线
for (let i = 0; i < 15; i++) { const p = ...; g.moveTo(p, -H); g.lineTo(p, H); }   // 竖线
g.stroke();
```

渲染结果是**只有竖线**，横线整片不见。没有报错、没有警告。

## 2. 排查记录（都已排除）

| 猜测 | 验证方式 | 结果 |
|------|---------|------|
| 横竖混排子路径互相覆盖 | 拆成两个 `Graphics` 节点（`GridH` / `Grid`） | ❌ 仍然只剩竖线；横线那个节点整体不渲染 |
| 两个节点被后画的填充盖住 | 把 `GridH` 移到 `setSiblingIndex(last)` | ❌ 无变化 |
| 路径数据没生成 | 读 `g.impl.paths.length` | ❌ 15 条路径、坐标完全正确 |
| 顶点数据没生成 | 读 `_renderDataList[0]` | ❌ 与竖线节点同为 `vue=570 / idx=1710` |
| 颜色/线宽问题 | 读回 `strokeColor` / `lineWidth` | ❌ 与竖线节点一致 |
| 节点未激活 / 层级不同 | 读 `active` / `layer` / 世界坐标 | ❌ 全部一致 |

在**运行时**新建一个节点，用同样的代码画横线：**能正常渲染**。
对**已存在**的那个节点 `clear()` 后重画（换成黄色、`lineWidth` 也不改）：**依然不渲染**。

即：几何是好的，但那个节点上的 stroke 就是不出图。

## 3. 可行的画法

同一个节点、同样的位置与颜色，改成**填充矩形**：

```ts
g.fillColor = toColor(COLOR_GRID);
for (let i = 0; i < 15; i++) {
    const p = -HALF + i * CELL;
    g.rect(-HALF, p - 1, HALF * 2, 2);   // 横线 = 高 2 的矩形
    g.fill();
    g.rect(p - 1, -HALF, 2, HALF * 2);   // 竖线 = 宽 2 的矩形
    g.fill();
}
```

15 横 + 15 竖一次全部正确显示，且**同一个节点**即可，不必拆节点。

要点：
- 二分之一的线宽要在矩形的厚度里体现（2px 线 → 厚度 2，坐标取 `p - 厚度/2`）。
- 每画一个 `rect` 紧跟一次 `fill()`，与「多个 `circle()` 各自 `fill()`」的星位点写法一致。
- 颜色仍走 `toColor(...)`，透明用第二个参数。

## 4. 适用范围与注意

- 本项目的棋盘/表格类细线（五子棋网格、将来的围棋/棋盘格）**优先用 `fill` 矩形**。
- `stroke()` 并非完全不可用：圆环（塔防的塔位圈、终点红圈）、棋子描边、圆角按钮描边都正常。
  目前只在「**同一个 `Graphics` 上追加大量两点一线子路径**」时复现过，且**不报错**。
- 判据：如果某组线整片不显示，先读 `impl.paths` —— 路径在、顶点在、颜色对，
  那就别继续猜了，直接换 `fill` 矩形，5 分钟内能证伪。

## 5. 相关

- 运行时建 UI 的通用写法：[`../cocos-best-practices.md`](../cocos-best-practices.md)
- 预览验证方法（本结论就是靠它取证的）：[`browser-verify-cocos-preview.md`](./browser-verify-cocos-preview.md)
