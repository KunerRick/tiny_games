# T2: 淬毒箭技能攻击触发

## 文件
`assets/games/game_tiny_vanguard/scripts/battle/BattleManager.ts`

## 当前问题
上次优化在 `executeAttack()`（基本攻击）中加了这个：
```typescript
if (attacker.data && attacker.hasPassive('poison_arrows')) {
  target.addBuff('poison', 2, { damage: 1 });
}
```

但技能攻击走 `executeSkillEffects()`，不走 `executeAttack()`，所以淬毒箭被动在放技能时不会触发。

## 改动要求

在 `executeSkillEffects()` 中，处理完所有 effects 后，添加：

```typescript
// 攻击后触发淬毒箭被动（仅对敌人生效的 damage 类技能）
if (caster.data && caster.hasPassive('poison_arrows') && target?.data && !target.data.isPlayer) {
  target.addBuff('poison', 2, { damage: 1 });
}
```

放在方法末尾，effects 循环之后，`if (!caster.data) return;` 之前。

注意：
- `target` 可能为 null（比如 buff_attack 给自己加），需要判空
- 只对敌方目标生效（`!target.data.isPlayer`），不加给友方
- 使用 `UnitController.hasPassive()` 方法（上次 OpenCode 加的，已存在）

## 不动
- 其他任何文件
- `.scene` / `.prefab` / `.meta`
