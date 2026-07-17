const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\code\\github\\tiny_games\\assets\\games\\game_tiny_vanguard\\scripts';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`[PASS] ${name}`);
    return true;
  } else {
    console.log(`[FAIL] ${name} ${detail}`);
    return false;
  }
}

const bm = read('battle\\BattleManager.ts');
const uc = read('battle\\UnitController.ts');
const ai = read('battle\\AIController.ts');
const gc = read('battle\\GridController.ts');
const bui = read('ui\\BattleUI.ts');
const tvm = read('TinyVanguardMain.ts');

let ok = true;

// 1. AI action 索引对齐
ok &= check(
  'AI action 使用 _enemyUnits.indexOf 取值',
  /actions\[this\._enemyUnits\.indexOf\(enemy\)\]/.test(bm),
  'BattleManager.endPlayerTurn'
);

// 2. _executePendingSkill 不覆盖 victory/defeat
ok &= check(
  '_executePendingSkill 仅在 skill_target 时切回 player_turn',
  /if\s*\(\s*this\._phase\s*===\s*['"]skill_target['"]\s*\)\s*\{\s*this\._phase\s*=\s*['"]player_turn['"]\s*;\s*\}/s.test(bm),
  'BattleManager._executePendingSkill'
);

// 3. onBattleEnd 取消 schedule
ok &= check(
  'onBattleEnd 开头取消 schedule 并清空 _aiQueue',
  /private onBattleEnd\(victory:\s*boolean\):\s*void\s*\{\s*this\.unscheduleAllCallbacks\(\)\s*;\s*this\._aiQueue\s*=\s*\[\]\s*;/.test(bm),
  'BattleManager.onBattleEnd'
);

// 4. 棋盘边界硬编码 6 已替换
ok &= check(
  'BattleManager 无硬编码棋盘边界 < 6 / >= 6',
  !/(row\s*[<>]=?\s*6|col\s*[<>]=?\s*6|GRID_SIZE\s*[-+]\s*\d\s*[<>]=?\s*6)/.test(bm),
  'BattleManager'
);
ok &= check(
  'BattleManager 使用 GridController.GRID_SIZE',
  /GridController\.GRID_SIZE/.test(bm),
  'BattleManager'
);

// 5. GridController clearHighlights 顺序
ok &= check(
  'GridController.clearHighlights 先 clearPreview 再清空 _highlightedCells',
  /clearHighlights\(\):\s*void\s*\{[\s\S]*?this\.clearPreview\(\)\s*;\s*this\.clearAoePreview\(\)\s*;[\s\S]*?this\._highlightedCells\s*=\s*\[\]\s*;/.test(gc),
  'GridController.clearHighlights'
);

// 6. UnitController 被动应用/回退接收 SkillConfig
ok &= check(
  'applyPassiveEffect 接收 SkillConfig',
  /private applyPassiveEffect\(skill:\s*SkillConfig\):\s*void/.test(uc),
  'UnitController.applyPassiveEffect'
);
ok &= check(
  '_revertPassiveEffect 接收 SkillConfig',
  /private _revertPassiveEffect\(skill:\s*SkillConfig\):\s*void/.test(uc),
  'UnitController._revertPassiveEffect'
);

// 7. replaceSkill 调用新的 applyPassiveEffect/_revertPassiveEffect
ok &= check(
  'replaceSkill 使用 applyPassiveEffect(skill)',
  /this\.applyPassiveEffect\(\s*newSkill\s*\)/.test(uc),
  'UnitController.replaceSkill'
);
ok &= check(
  'replaceSkill 使用 _revertPassiveEffect(oldSkill)',
  /this\._revertPassiveEffect\(\s*oldSkill\s*\)/.test(uc),
  'UnitController.replaceSkill'
);

// 8. takeDamage 先反击再 _onDeath
ok &= check(
  'takeDamage 反击逻辑在 _onDeath 之前',
  /takeDamage\([\s\S]*?isDead\s*=\s*this\._data\.currentHp\s*<=\s*0[\s\S]*?attacker\.takeDamage[\s\S]*?if\s*\(\s*isDead\s*\)\s*\{\s*this\._onDeath\(\)\s*;\s*\}/s.test(uc),
  'UnitController.takeDamage'
);

// 9. baseStats 包含 maxEnergy
ok &= check(
  'UnitData.baseStats 包含 maxEnergy',
  /baseStats:\s*\{[^}]*maxEnergy:\s*number/.test(uc),
  'UnitController.UnitData'
);

// 10. applyUpgrade 同步 baseStats
ok &= check(
  'applyUpgrade attack 同步 baseStats.attack',
  /case\s*['"]attack['"]\s*:[\s\S]*?unit\.data\.baseStats\.attack\s*\+=\s*amount[\s\S]*?unit\.data\.stats\.attack\s*\+=\s*amount/.test(tvm),
  'TinyVanguardMain.applyUpgrade'
);
ok &= check(
  'applyUpgrade energy 同步 baseStats.maxEnergy',
  /case\s*['"]energy['"]\s*:[\s\S]*?unit\.data\.baseStats\.maxEnergy\s*\+=\s*amount[\s\S]*?unit\.data\.maxEnergy\s*\+=\s*amount/.test(tvm),
  'TinyVanguardMain.applyUpgrade'
);

// 11. BattleUI show/hide 有成对 _eventsBound 检查
ok &= check(
  'BattleUI.show 使用 _eventsBound 避免重复绑定',
  /if\s*\(\s*!this\._eventsBound\s*\)\s*\{\s*this\._eventsBound\s*=\s*true\s*;\s*this\.bindEvents\(\)\s*;\s*\}/.test(bui),
  'BattleUI.show'
);
ok &= check(
  'BattleUI.hide 使用 _eventsBound 避免重复解绑',
  /if\s*\(\s*this\._eventsBound\s*\)\s*\{\s*this\._eventsBound\s*=\s*false\s*;\s*this\.unbindEvents\(\)\s*;\s*\}/.test(bui),
  'BattleUI.hide'
);

// 12. 死代码清理
ok &= check(
  'BattleUI 中无 _skillClickCallbacks 字段',
  !/_skillClickCallbacks/.test(bui),
  'BattleUI'
);
ok &= check(
  'AIController 中无 attackIfInRangeOrMoveToward 死代码',
  !/attackIfInRangeOrMoveToward/.test(ai),
  'AIController'
);

if (ok) {
  console.log('\nAll checks passed.');
  process.exit(0);
} else {
  console.log('\nSome checks failed.');
  process.exit(1);
}
