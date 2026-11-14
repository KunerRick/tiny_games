#!/usr/bin/env node
/**
 * 《秘银远征》纯逻辑自检（不启动 Cocos 编辑器）。
 *
 * M0 覆盖：数值曲线 / 副属性预算 / 天赋规则 / 技能变体 / 存档净化 /
 *          配置表完整性 / 战斗骨架（确定性、实体上限、伤害无 NaN、无敌帧）。
 *
 * 用法：node tools/verify-mithril-core.js
 * 通过时打印 MITHRIL_CORE_OK；失败时逐条打印并以退出码 1 结束。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'assets/games/game_mithril/scripts');
const CONFIG = path.join(SCRIPTS, 'MithrilConfig.ts');
const PROGRESS = path.join(SCRIPTS, 'MithrilProgress.ts');
const CORE = path.join(SCRIPTS, 'MithrilCore.ts');

function findTsc() {
    const candidates = [
        process.env.TSC,
        path.join(ROOT, 'node_modules/typescript/bin/tsc'),
        '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc',
    ].filter(Boolean);
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

function loadModules() {
    const tsc = findTsc();
    if (!tsc) {
        console.error('找不到 tsc：设置 $TSC 或安装 typescript');
        process.exit(2);
    }
    for (const f of [CONFIG, PROGRESS, CORE]) {
        if (!fs.existsSync(f)) {
            console.error(`缺少源文件：${f}`);
            process.exit(2);
        }
    }
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mithril-core-'));
    execFileSync(process.execPath, [
        tsc,
        CONFIG,
        PROGRESS,
        CORE,
        '--outDir', outDir,
        '--target', 'ES2019',
        '--module', 'commonjs',
        '--skipLibCheck',
        '--strict', 'false',
    ], { stdio: 'inherit' });
    return {
        cfg: require(path.join(outDir, 'MithrilConfig.js')),
        prog: require(path.join(outDir, 'MithrilProgress.js')),
        core: require(path.join(outDir, 'MithrilCore.js')),
    };
}

const { cfg: F, prog: P, core: C } = loadModules();

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
    if (cond) {
        passed++;
    } else {
        failed++;
        failures.push(`${name}${detail !== undefined ? ` —— ${detail}` : ''}`);
    }
}

function near(a, b, eps = 1e-6) {
    return Math.abs(a - b) <= eps;
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
        return true;
    }
    if (a && b && typeof a === 'object') {
        const ka = Object.keys(a).sort();
        const kb = Object.keys(b).sort();
        if (!deepEqual(ka, kb)) return false;
        for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
        return true;
    }
    return false;
}

function countBy(list, pick) {
    const out = {};
    for (const item of list) {
        const key = pick(item);
        out[key] = (out[key] || 0) + 1;
    }
    return out;
}

// ==================== 1. 随机数 ====================

{
    const a = C.mulberry32(20261114);
    const b = C.mulberry32(20261114);
    let same = true;
    let inRange = true;
    for (let i = 0; i < 2000; i++) {
        const x = a();
        if (x !== b()) same = false;
        if (!(x >= 0 && x < 1)) inRange = false;
    }
    check('1. mulberry32 同种子序列一致', same);
    check('2. mulberry32 输出在 [0,1)', inRange);
    const c = C.mulberry32(1);
    const d = C.mulberry32(2);
    let differs = false;
    for (let i = 0; i < 50; i++) if (c() !== d()) differs = true;
    check('3. 不同种子序列不同', differs);
}

// ==================== 2. 等级曲线 ====================

{
    check('4. 1 级攻击强度 = 10', near(P.attackPowerAt(1), 10));
    check('5. 30 级攻击强度 = 20（2.00×）', near(P.attackPowerAt(30), 20));
    check('6. 1 级生命 = 60', P.maxHpAt(1) === 60);
    check('7. 30 级生命 = 582', P.maxHpAt(30) === 582);

    let monotonic = true;
    for (let lv = 2; lv <= 30; lv++) if (P.attackPowerAt(lv) <= P.attackPowerAt(lv - 1)) monotonic = false;
    check('8. 攻击强度随等级严格递增', monotonic);

    let expMonotonic = true;
    for (let lv = 2; lv < 30; lv++) if (P.expToNext(lv) <= P.expToNext(lv - 1)) expMonotonic = false;
    check('9. 升级所需经验严格递增', expMonotonic);

    const total = P.totalExpTo(30);
    check('10. 1→30 累计经验 ∈ [55000, 66000]', total >= 55000 && total <= 66000, total);

    let inverse = true;
    for (let lv = 1; lv <= 30; lv++) {
        if (P.levelForTotalExp(P.totalExpTo(lv)) !== lv) inverse = false;
    }
    check('11. levelForTotalExp 与 totalExpTo 互逆', inverse);

    check('12. 每级天赋点：1 级 1 点 / 30 级 30 点', P.talentPointsForLevel(1) === 1 && P.talentPointsForLevel(30) === 30);
}

// ==================== 3. 副属性与 DPS ====================

{
    check('13. ilvl10 词条预算 = 8 点', P.affixBudget(10) === 8);
    check('14. ilvl40 词条预算 = 32 点', P.affixBudget(40) === 32);

    const s40 = P.secondaryStats(40, P.BALANCED_ALLOC);
    check('15. ilvl40 暴击恰好 30%', near(s40.crit, 0.30, 1e-9), s40.crit);
    check('16. ilvl40 急速恰好 20%', near(s40.haste, 0.20, 1e-9), s40.haste);
    check('17. ilvl40 精通恰好 20%', near(s40.mastery, 0.20, 1e-9), s40.mastery);
    check('18. ilvl40 全能恰好 10%', near(s40.vers, 0.10, 1e-9), s40.vers);
    check('19. ilvl40 均衡配点零浪费（4 项触顶、溢出 0）',
        s40.cappedCount === 4 && near(s40.overflow, 0, 1e-9), `${s40.cappedCount}/${s40.overflow}`);

    // 任意配点都不得破 cap
    let capOk = true;
    let overflowOk = true;
    for (let i = 0; i <= 32; i++) {
        for (let j = 0; i + j <= 32; j++) {
            for (let k = 0; i + j + k <= 32; k++) {
                const w = 32 - i - j - k;
                const st = P.secondaryStats(40, { crit: i, haste: j, mastery: k, vers: w });
                if (st.crit > 0.30 + 1e-9 || st.haste > 0.20 + 1e-9 || st.mastery > 0.20 + 1e-9 || st.vers > 0.10 + 1e-9) {
                    capOk = false;
                }
                if (st.overflow < -1e-9) overflowOk = false;
            }
        }
    }
    check('20. 任意配点均不破 cap', capOk);
    check('21. 溢出量计算非负', overflowOk);

    const ratio = P.dpsRatio();
    check('22. 毕业 / 起点 DPS 倍率 ∈ [8,11]', ratio >= 8 && ratio <= 11, ratio.toFixed(4));
    check('23. 实测倍率 = 9.53×（口径锁死）', near(ratio, 9.53, 0.02), ratio.toFixed(4));

    const levelMul = P.attackPowerAt(30) / P.attackPowerAt(1);
    check('24. 等级层贡献 2.00×', near(levelMul, 2.0));
    check('25. 副属性层贡献 ≈ 1.87×', near(P.secondaryStats(40).multiplier, 1.87, 0.01),
        P.secondaryStats(40).multiplier.toFixed(4));

    check('26. 急速 0%：CD 8s 在 60s 内 7 次', P.castsInWindow(8, 0, 60) === 7);
    check('27. 急速 20%：CD 8s 在 60s 内 9 次', P.castsInWindow(8, 0.20, 60) === 9);
    check('28. 急速断点处施放次数阶跃', P.castsInWindow(8, 0.20, 60) > P.castsInWindow(8, 0, 60));
}

// ==================== 4. 配置表完整性 ====================

{
    check('29. 职业 4 个', F.CLASSES.length === 4);
    check('30. 技能 24 个', F.SKILLS.length === 24, F.SKILLS.length);
    check('31. 技能 id 唯一', new Set(F.SKILLS.map((s) => s.id)).size === F.SKILLS.length);

    const perClass = countBy(F.SKILLS, (s) => s.classId);
    check('32. 每职业 6 技能', Object.values(perClass).every((n) => n === 6), JSON.stringify(perClass));
    const perKind = countBy(F.SKILLS, (s) => `${s.classId}:${s.kind}`);
    let kindOk = true;
    for (const cid of F.CLASS_IDS) {
        for (const kind of ['basic', 'active', 'dodge', 'burst']) {
            const n = perKind[`${cid}:${kind}`] || 0;
            if (kind === 'active' ? n !== 3 : n !== 1) kindOk = false;
        }
    }
    check('33. 每职业结构 = 1 基础 / 3 主动 / 1 闪避 / 1 爆发', kindOk);

    check('34. 天赋 120 个', F.TALENTS.length === 120, F.TALENTS.length);
    check('35. 天赋 id 唯一', new Set(F.TALENTS.map((t) => t.id)).size === F.TALENTS.length);
    const perTalClass = countBy(F.TALENTS, (t) => t.classId);
    check('36. 每职业 30 个天赋', Object.values(perTalClass).every((n) => n === 30), JSON.stringify(perTalClass));
    let talTierOk = true;
    for (const cid of F.CLASS_IDS) {
        const list = F.TALENTS.filter((t) => t.classId === cid);
        for (let tier = 1; tier <= 5; tier++) {
            for (const tree of F.TALENT_TREE_ORDER[cid]) {
                const n = list.filter((t) => t.tier === tier && t.tree === tree).length;
                if (n !== 2) talTierOk = false;
            }
        }
    }
    check('37. 每线每层恰好 2 选 1', talTierOk);

    check('38. 饰品 20 件', F.TRINKETS.length === 20, F.TRINKETS.length);
    check('39. 饰品 id 唯一', new Set(F.TRINKETS.map((t) => t.id)).size === F.TRINKETS.length);
    const perTag = countBy(F.TRINKETS, (t) => t.tag);
    check('40. 10 个 tag 各 2 件', Object.keys(perTag).length === 10 && Object.values(perTag).every((n) => n === 2),
        JSON.stringify(perTag));

    check('41. 协同 12 条', F.SYNERGIES.length === 12, F.SYNERGIES.length);
    check('42. 协同配对键唯一', Object.keys(F.SYNERGY_BY_KEY).length === 12);
    let synergyOk = true;
    for (const s of F.SYNERGIES) {
        const hits = F.findSynergies([s.a, s.b]);
        if (hits.length !== 1 || hits[0].id !== s.id) synergyOk = false;
        const reversed = F.findSynergies([s.b, s.a]);
        if (reversed.length !== 1 || reversed[0].id !== s.id) synergyOk = false;
    }
    check('43. 每条协同「能且只能」按配对点亮（含反序）', synergyOk);
    check('44. 同 tag 两件不产生协同', F.findSynergies(['blood', 'blood']).length === 0);

    check('45. 装备基型 50 件', F.GEAR_BASES.length === 50, F.GEAR_BASES.length);
    check('46. 装备基型 id 唯一', new Set(F.GEAR_BASES.map((g) => g.id)).size === F.GEAR_BASES.length);
    const slotCount = countBy(F.GEAR_BASES, (g) => g.slot);
    const expectSlots = { mainHand: 8, offHand: 6, head: 6, chest: 6, hands: 6, legs: 6, feet: 6, ring: 6 };
    check('47. 8 槽位基型数量正确', deepEqual(slotCount, expectSlots), JSON.stringify(slotCount));

    check('48. 品质 6 档', F.QUALITIES.length === 6);
    check('49. 词条 4 项', F.AFFIXES.length === 4);
    check('50. 改造词条 5 条', F.MODIFIERS.length === 5);

    check('51. 副本 6 个', F.DUNGEONS.length === 6, F.DUNGEONS.length);
    let dungeonOk = true;
    for (const d of F.DUNGEONS) {
        if (d.phases.length !== 3) dungeonOk = false;
        for (const ph of d.phases) if (['interrupt', 'adds', 'move'].indexOf(ph.mechanic) < 0) dungeonOk = false;
        if (!(d.ilvlMin >= 1 && d.ilvlMax <= 40 && d.ilvlMax > d.ilvlMin)) dungeonOk = false;
    }
    check('52. 每个副本 3 阶段且机制只用三类', dungeonOk);

    check('53. 区域首领 3 只', F.REGION_BOSSES.length === 3, F.REGION_BOSSES.length);
    check('54. 每只区域首领 3 阶段', F.REGION_BOSSES.every((b) => b.phases.length === 3));

    check('55. 区域 3 个', F.REGIONS.length === 3);
    check('56. 悬赏 24 条', F.BOUNTIES.length === 24, F.BOUNTIES.length);
    const perBounty = countBy(F.BOUNTIES, (b) => b.kind);
    check('57. 四类悬赏各 6 条', Object.keys(perBounty).length === 4 && Object.values(perBounty).every((n) => n === 6),
        JSON.stringify(perBounty));
}

// ==================== 5. 天赋规则 ====================

{
    const save = P.defaultSave('warrior');
    save.level = 30;
    const lineIds = (tree) => F.TALENTS
        .filter((t) => t.classId === 'warrior' && t.tree === tree)
        .sort((a, b) => (a.tier - b.tier) || (a.col - b.col));

    // 层门槛：0 点时不能点 tier 2
    const t2 = F.TALENTS.find((t) => t.classId === 'warrior' && t.tree === 'steel' && t.tier === 2 && t.col === 0);
    check('58. 层门槛：该线 0 点时不能点 T2', P.canSpendTalent(save, t2.id).reason === 'tier-gate');

    // 点满一条线到 25 点
    let spentOk = true;
    for (const t of lineIds('steel')) {
        while (P.canSpendTalent(save, t.id).ok) {
            if (!P.spendTalent(save, t.id)) { spentOk = false; break; }
        }
    }
    check('59. 已投入点数可点满一线', spentOk);
    check('60. 每线上限 25 点', P.talentPointsInTree(save.talents, 'warrior', 'steel') === 25,
        P.talentPointsInTree(save.talents, 'warrior', 'steel'));
    check('61. 满线后该线不能再投', P.canSpendTalent(save, t2.id).reason === 'max-rank' || P.canSpendTalent(save, t2.id).reason === 'line-cap');

    // 另一条线还能投 5 点（总计 30）
    const fury = F.TALENTS.find((t) => t.classId === 'warrior' && t.tree === 'fury' && t.tier === 1 && t.col === 0);
    for (let i = 0; i < 5; i++) P.spendTalent(save, fury.id);
    check('62. 总点数 30 点封顶', P.talentPointsSpent(save.talents) === 30, P.talentPointsSpent(save.talents));
    const unspent = F.TALENTS.find((t) => t.classId === 'warrior' && t.tree === 'tactic' && t.tier === 1 && t.col === 0);
    check('63. 点数用完后无法继续投（未满级天赋也拦住）', P.canSpendTalent(save, unspent.id).reason === 'no-points');

    const refunded = P.resetTalents(save);
    check('64. 重置天赋退还全部 30 点', refunded === 30 && P.talentPointsSpent(save.talents) === 0);

    // 职业不匹配
    const mageTalent = F.TALENTS.find((t) => t.classId === 'mage');
    check('65. 不能点别的职业的天赋', P.canSpendTalent(save, mageTalent.id).reason === 'class');
}

// ==================== 6. 技能变体 ====================

{
    const save = P.defaultSave('mage');
    const skillId = 'mage_a1'; // 火球术，M0 唯一填了变体的技能
    check('66. 1 级时不能选 2 级变体', !P.canChooseVariant(save, skillId, 2));
    save.skills[skillId] = 2;
    check('67. 2 级可以选 2 级变体', P.canChooseVariant(save, skillId, 2));
    check('68. 选中变体 0', P.chooseVariant(save, skillId, 2, 0));
    check('69. 变体永久：不能反悔', !P.canChooseVariant(save, skillId, 2) && !P.chooseVariant(save, skillId, 2, 1));
    const v = P.variantDef(save, skillId, 2);
    check('70. 读回变体 0 = 炽热', v && v.name === '炽热', v && v.name);
    check('71. 2 级还不能选 4 级变体', !P.canChooseVariant(save, skillId, 4));
    save.skills[skillId] = 4;
    check('72. 4 级可以选 4 级变体', P.chooseVariant(save, skillId, 4, 1));
    check('73. 两个变体槽互不覆盖', P.variantDef(save, skillId, 2).name === '炽热' && P.variantDef(save, skillId, 4).name === '聚焦');

    const none = F.SKILLS.find((s) => !s.variants);
    check('74. 未配置变体的技能不能选', !P.canChooseVariant(P.defaultSave(none.classId), none.id, 2));
}

// ==================== 7. 经验与升级 ====================

{
    const save = P.defaultSave('warrior');
    const gained = P.addExp(save, P.expToNext(1) + P.expToNext(2));
    check('75. 一次加够经验可连升 2 级', gained === 2 && save.level === 3, `${gained}/${save.level}`);
    check('76. 升级后 remainder 经验正确', save.exp === 0, save.exp);

    const maxSave = P.defaultSave('warrior');
    maxSave.level = 30;
    P.addExp(maxSave, 999999);
    check('77. 满级经验不再增长', maxSave.level === 30 && maxSave.exp === 0);
}

// ==================== 8. 存档净化 ====================

{
    const save = P.defaultSave('warrior');
    save.level = 10;
    save.gold = 1234;
    save.materials = { ash: 5 };
    save.talents = {};
    const t1 = F.TALENTS.find((t) => t.classId === 'warrior' && t.tree === 'steel' && t.tier === 1 && t.col === 0);
    for (let i = 0; i < 5; i++) P.spendTalent(save, t1.id);
    save.skills.warrior_basic = 3;
    save.trinkets = ['blood_amulet', 'ember_ring'];
    const round = P.sanitizeSave(JSON.parse(JSON.stringify(save)));
    check('78. 存档往返：等级 / 金币 / 材料', round.level === 10 && round.gold === 1234 && round.materials.ash === 5);
    check('79. 存档往返：天赋点数', P.talentPointsSpent(round.talents) === 5, P.talentPointsSpent(round.talents));
    check('80. 存档往返：技能等级', round.skills.warrior_basic === 3);
    check('81. 存档往返：饰品两格', deepEqual(round.trinkets, ['blood_amulet', 'ember_ring']));

    const junk = P.sanitizeSave({ classId: 'nope', level: 999, exp: -5, gold: -1, talents: 'x', trinkets: ['nope', 'blood_amulet'], skills: [], facilities: { smith: 99 } });
    check('82. 坏档回落：职业回战士', junk.classId === 'warrior');
    check('83. 坏档回落：等级夹到 30 / 经验非负', junk.level === 30 && junk.exp === 0);
    check('84. 坏档回落：金币非负', junk.gold === 0);
    check('85. 坏档回落：非法饰品被丢弃', junk.trinkets[0] === null && junk.trinkets[1] === 'blood_amulet');
    check('86. 坏档回落：设施等级夹到 5', junk.facilities.smith === 5);

    // 超点天赋被裁到等级允许的点数
    const over = P.sanitizeSave({
        classId: 'warrior',
        level: 5,
        talents: Object.fromEntries(F.TALENTS.filter((t) => t.classId === 'warrior').map((t) => [t.id, 5])),
    });
    check('87. 超点天赋被裁到 5 点（= 等级）', P.talentPointsSpent(over.talents) === 5, P.talentPointsSpent(over.talents));

    // 重复饰品去重
    const dup = P.sanitizeSave({ trinkets: ['blood_amulet', 'blood_amulet'] });
    check('88. 重复饰品只保留一件', dup.trinkets[0] === 'blood_amulet' && dup.trinkets[1] === null);
}

// ==================== 9. 战斗骨架 ====================

{
    const profile = C.makeProfile('warrior', 10, 10);
    const input = { moveX: 1, moveY: 0.5, aimX: 1, aimY: 0 };
    const a = new C.MithrilWorld(profile, 4242);
    const b = new C.MithrilWorld(profile, 4242);
    a.spawnEnemy('imp', 300, 400, 20);
    b.spawnEnemy('imp', 300, 400, 20);
    for (let i = 0; i < 600; i++) {
        a.step(F.FIXED_DT, input);
        b.step(F.FIXED_DT, input);
    }
    check('89. 固定步长确定性：同种子同输入快照一致', deepEqual(a.snapshot(), b.snapshot()));

    // 不同种子必须给出不同伤害序列（暴击判定由 RNG 驱动）
    let seqA = '';
    let seqB = '';
    const rngA = C.mulberry32(123);
    const rngB = C.mulberry32(456);
    for (let i = 0; i < 40; i++) {
        seqA += C.computeDamage(profile, rngA).crit ? '1' : '0';
        seqB += C.computeDamage(profile, rngB).crit ? '1' : '0';
    }
    check('90. 不同种子的暴击序列不同', seqA !== seqB);

    // 敌人上限
    const capWorld = new C.MithrilWorld(profile, 1);
    let spawned = 0;
    for (let i = 0; i < 100; i++) if (capWorld.spawnEnemy('imp', 100 + i, 100, 10)) spawned++;
    check('91. 敌人数量上限 40', spawned === 40 && capWorld.enemies.length === 40, capWorld.enemies.length);

    // 子弹上限
    let fired = 0;
    for (let i = 0; i < 400; i++) if (capWorld.fireBullet('player', 0, 0, 10, 0, 1, 999)) fired++;
    check('92. 子弹数量上限 300', fired === 300 && capWorld.bullets.length === 300, capWorld.bullets.length);

    // 无敌帧
    const inv = new C.MithrilWorld(profile, 7);
    const first = inv.hitPlayer(10);
    const second = inv.hitPlayer(10);
    check('93. 无敌帧内连续受击只扣一次', first === true && second === false);
    for (let i = 0; i < 40; i++) inv.step(F.FIXED_DT, { moveX: 0, moveY: 0, aimX: 0, aimY: 0 });
    const third = inv.hitPlayer(10);
    check('94. 无敌帧结束后可再次受击', third === true);

    // 伤害无 NaN
    const rng = C.mulberry32(31337);
    let finite = true;
    let zeroSafe = true;
    for (let i = 0; i < 5000; i++) {
        const p = C.makeProfile(['warrior', 'mage', 'ranger', 'priest'][i % 4], 1 + (i % 30), (i * 7) % 40 + 1);
        const res = C.computeDamage(p, rng, 1 + (i % 3) * 0.5, i % 11 === 0);
        if (!Number.isFinite(res.damage) || res.damage < 0) finite = false;
    }
    const zero = C.computeDamage({ classId: 'warrior', level: 1, attackPower: 0, maxHp: 1, critChance: 0, critMult: 1, haste: 0, mastery: 0, vers: 0 }, rng);
    if (!Number.isFinite(zero.damage) || zero.damage !== 0) zeroSafe = false;
    check('95. 5,000 次伤害计算无 NaN / 负值', finite);
    check('96. 全零属性伤害为 0', zeroSafe);

    // 长跑不变量
    const long = new C.MithrilWorld(C.makeProfile('ranger', 20, 20), 8888);
    for (let i = 0; i < 20; i++) long.spawnEnemy('imp', 100 + i * 20, 200, 30);
    let longOk = true;
    for (let i = 0; i < 10000; i++) {
        long.step(F.FIXED_DT, { moveX: Math.sin(i * 0.01), moveY: Math.cos(i * 0.013), aimX: 1, aimY: 0 });
        if (!Number.isFinite(long.player.x) || !Number.isFinite(long.player.y) || !Number.isFinite(long.player.hp)) {
            longOk = false;
            break;
        }
        if (i % 500 === 0 && long.bullets.length < 250) long.fireBullet('player', long.player.x, long.player.y, 100, 0, 5, 3);
    }
    check('97. 10,000 步长跑位置 / 生命始终有限', longOk);

    // 玩家死亡终态
    const die = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 5);
    die.spawnEnemy('boss', die.player.x + 1, die.player.y, 999, 0, 9999);
    for (let i = 0; i < 100 && die.phase === 'playing'; i++) die.step(F.FIXED_DT, { moveX: 0, moveY: 0, aimX: 0, aimY: 0 });
    check('98. 玩家生命归零后进入 dead 终态', die.phase === 'dead' && die.player.hp === 0);

    // 击杀计数
    const kill = new C.MithrilWorld(C.makeProfile('warrior', 10, 10), 3);
    kill.spawnEnemy('imp', 100, 100, 5);
    kill.damageEnemy(0, 5);
    check('99. 击杀后移除并计数', kill.enemies.length === 0 && kill.kills === 1);
}

// ==================== 汇总 ====================

const total = passed + failed;
if (failed > 0) {
    console.error(`\nMITHRIL_CORE_FAILED  ${passed}/${total} 项通过`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
}
console.log(`MITHRIL_CORE_OK  ${passed}/${total} 项通过（M0）`);
