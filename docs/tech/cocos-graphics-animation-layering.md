# Graphics 动态部件：分层、镜像与程序化动作

> 2026-11-07 战争进化做兵种攻击动作时总结。适用于任何「Graphics 现画 + 需要动起来」的场合
> （本项目全部美术都是零贴图的 Graphics + Label，所以这类需求会反复出现）。

## 1. 铁律：`Graphics` 在 3.8 没有变换栈

`cc.d.ts` 里只有 `Node.translate`，没有 `pushMatrix` / `popMatrix` / `save` / `restore`。
一张 `Graphics` 画完之后，**整张图只能作为一个整体随节点变换**，没有任何办法单独转图里的某一部分。

推论：

| 需求 | 做法 |
|---|---|
| 某个部件要单独旋转 / 缩放 / 位移 | 把它拆成**独立子节点**，各自挂一个 `Graphics` |
| 只是要合成一张静态图（图标、剪影预览） | 用 `ox` / `oy` 坐标偏移参数传进绘制函数，**不要找矩阵** |
| 想「先 translate 再画」 | 没有这种 API。把偏移算进绘制坐标里 |

判据：如果正在琢磨「怎么给 Graphics 做局部变换」，那就是走错路了，直接拆节点。

## 2. 镜像：挂在父节点上，子节点自动继承

朝向不要靠「画两套坐标」，用 `setScale(±1, 1, 1)` 镜像。关键是**挂在哪一层**：

```
Unit
└─ silhouette        ← setScale(-1,1,1) 挂这里
   ├─ Graphics（身体）
   └─ weapon         ← 子节点，自动跟着镜像
      └─ Graphics（武器）
```

- 子节点里的**旋转**会跟着镜像：同一个局部角度，在左右两侧天然对称。
  所以武器的挥击角度只写一套数值，**不需要按阵营取反**。
- 但**直接写在被镜像节点自身**的旋转，视觉上会被翻向 —— 这一层才需要手动取反：

```ts
// 身体前倾写在 silhouette 上（它自己就是被镜像的节点）
const leanSign = this._side === 'player' ? -1 : 1;
shape.angle = lean * leanSign;

// 武器角度写在 weapon 上（父节点被镜像），不取反
weaponNode.angle = swingAngle;
```

## 3. 用 tick 求值代替补间

程序化动作**不要**用 tween，理由三条：

1. **补间预算**：美术原则 A5 是「单屏 ≤ 20 个补间」。同屏 20 个单位各挂一条攻击补间就直接顶满，
   再加受击闪白 / 伤害数字必然超。
2. **两级节点抢属性**：身体和武器是父子节点，两条补间在同一帧写属性会互相打架。
3. **可重入**：连击 / 换目标时，求值式只要重置计时器即可；补间得 `stop()` + 重建，容易漏。

标准写法：

```ts
private applyAttackPose(dt: number): void {
    if (this._atkTimer <= 0) { /* 复位 */ return; }
    this._atkTimer = Math.max(0, this._atkTimer - dt);
    const p = 1 - this._atkTimer / this._atkDur;   // 0 → 1
    // 按 p 分段取曲线，写进节点
}
```

**三段时间轴**是通用的「有力量感」配方（战争进化实测）：

| 段 | 进度 | 曲线 | 作用 |
|---|---|---|---|
| 蓄力 | 0 → 0.34 | `easeOutQuad` | 反向拉开，制造 anticipation |
| 挥出 | 0.34 → 0.52 | `easeInQuad` | 过冲，**这段的加速感决定有没有力气** |
| 收势 | 0.52 → 1 | `easeOutQuad` | 回弹、follow-through |

时长跟攻击冷却挂钩：`clamp(cooldown × 0.7, 0.18, 0.40)`。太短看不清，太长会盖住下一次攻击。

## 4. 特效必须跟着动作相位走

最常见的错误：攻击函数一进来就播挥砍弧 / 弹道，结果**蓄力还没做完，箭已经飞出去了**。

做法是把 VFX 的出生延后到「挥出」那一刻（`_atkDur × 0.34`），用 `tween().delay(delay)` 控制。

延迟路径有一个坑：如果初始 `opacity = 0` 而唯一的补间是「淡到 0」，它会**永远不显示**。
必须显式点亮：

```ts
const op = node.addComponent(UIOpacity);
op.opacity = 0;
tween(op)
    .delay(delay)
    .to(0.001, { opacity: 255 })   // ← 这一行不能省
    .to(0.16, { opacity: 0 })
    .call(() => { if (node.isValid) node.destroy(); })
    .start();
```

## 5. 受击闪白：别连描边一起刷白

「闪白」的直觉做法是把整个单位重绘成 `Color.WHITE` + 白色描边。在 20 来个像素的尺寸下，
这会把单位糊成一个**白团**，而且往往正好盖住「挥击命中」那一帧 —— 玩家反而看不出谁挨了打。

正确做法：**只提亮填充色，保留深色描边**。

```ts
const flashFill = new Color(255, 246, 232, 255);   // 暖白而不是纯白
drawUnitBody(this._silhouette, icon, flashFill);    // 描边走默认的深色 OUTLINE
```

配色的三色分层（`shade = mix(fill, 黑, 0.4)` / `light = mix(fill, 白, 0.5)`）会从近白填充里推导出
灰阶明暗，所以闪白期间单位仍然有结构、仍然认得出是谁。

## 6. 判别「小尺寸下立不立得住」

战场单位实际只有 20 来个 CSS 像素。**放大之后好看不算好看**。

复核顺序（缺一不可）：

1. 把容器 `setScale(2–4)` 定格截图，逐部件确认形状与动作对得上；
2. **再回看 1× 实战截图**，确认同一个特征还认得出；
3. 两者都成立才算通过。

实战教训：骑士的盾牌在 3.6× 下清清楚楚，但它只从躯干后露出 7.5 单位宽（盾 `x: -17→-5`，
躯干盖到 `-9.5`），1× 下完全读成身体的一部分 —— 「身后方盾」这条剪影抓手等于不存在。
把盾面外推到 16 单位宽、十字加粗之后才成立。

## 7. 相关

- 运行时建 UI 的通用写法与防崩溃守则：[`../cocos-best-practices.md`](../cocos-best-practices.md)
- `stroke()` 整片不显示：[`cocos-graphics-lines-pitfall.md`](./cocos-graphics-lines-pitfall.md)
- 预览里做可视化验证（本节结论的取证手段）：[`browser-verify-cocos-preview.md`](./browser-verify-cocos-preview.md)
- 自排期 / 补间陷阱：[`cocos-scheduler-and-tween-pitfalls.md`](./cocos-scheduler-and-tween-pitfalls.md)
