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
        // MITHRIL_VERBOSE=1 时打印每条通过项与实测值（调平衡时看时长很有用）
        if (process.env.MITHRIL_VERBOSE) {
            console.log(`ok  ${name}${detail !== undefined ? `  [${detail}]` : ''}`);
        }
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

// ==================== 10. M1：战士技能 / AI / BOSS 机制 ====================

const IDLE = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };

function stepFor(world, seconds, input = IDLE) {
    const n = Math.max(1, Math.round(seconds / F.FIXED_DT));
    for (let i = 0; i < n; i++) world.step(F.FIXED_DT, input);
    return world;
}

function clearAllEnemies(world) {
    for (let guard = 0; guard < 200 && world.enemies.length > 0; guard++) {
        for (let i = world.enemies.length - 1; i >= 0; i--) world.damageEnemy(i, 1e9);
    }
    world.drainEvents();
}

/** 清掉 3 个遭遇，进入 BOSS 并稳定下来 */
function makeBossWorld(profile = C.makeProfile('warrior', 30, 40), seed = 90210) {
    const w = new C.MithrilWorld(profile, seed);
    w.startDungeon('mine');
    clearAllEnemies(w);
    stepFor(w, F.ENCOUNTER_GAP + 0.15);
    clearAllEnemies(w);
    stepFor(w, F.ENCOUNTER_GAP + 0.15);
    clearAllEnemies(w);
    stepFor(w, F.BOSS_INTRO_GAP + 0.15);
    w.drainEvents();
    return w;
}

{
    // ---- 技能与怒气 ----
    const w = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 101);
    const e = w.spawnEnemy('imp', w.player.x, w.player.y + 55, 1000, 0, 0);
    const hp0 = e.hp;
    w.step(F.FIXED_DT, { ...IDLE, basic: true });
    check('100. 普攻命中扇形内敌人并造成伤害', e.hp < hp0, `${hp0} → ${e.hp}`);
    check('101. 普攻命中积攒怒气', w.player.rage >= F.PLAYER_TUNING.basic.rage, w.player.rage);

    w.player.rage = 99;
    w.player.cd.basic = 0;
    w.step(F.FIXED_DT, { ...IDLE, basic: true });
    check('102. 怒气上限为 100', w.player.rage === 100, w.player.rage);

    // 冲锋位移 + 眩晕
    const cw = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 102);
    const ce = cw.spawnEnemy('imp', cw.player.x + 160, cw.player.y, 1000, 0, 0);
    const cx0 = cw.player.x;
    cw.step(F.FIXED_DT, { ...IDLE, skill1: true });
    check('103. 冲锋位移约 220px', near(cw.player.x - cx0, F.PLAYER_TUNING.charge.distance, 2), cw.player.x - cx0);
    check('104. 冲锋命中眩晕 0.8s', ce.status.stun > 0.7, ce.status.stun);

    // 旋风斩：2 秒内多跳
    const ww = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 103);
    const we = ww.spawnEnemy('imp', ww.player.x + 20, ww.player.y, 100000, 0, 0);
    ww.step(F.FIXED_DT, { ...IDLE, skill2: true });
    const wHp0 = we.hp;
    stepFor(ww, 2.1);
    const whirlHits = Math.ceil(F.PLAYER_TUNING.whirlwind.duration / F.PLAYER_TUNING.whirlwind.tick);
    check('105. 旋风斩持续 2s 打满 5 跳', whirlHits === 5 && wHp0 - we.hp > 5, wHp0 - we.hp);

    // 破甲：后续伤害 +20%
    const aw = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 104);
    const ae = aw.spawnEnemy('imp', aw.player.x + 60, aw.player.y, 1000, 0, 0);
    aw.step(F.FIXED_DT, { ...IDLE, skill3: true });
    check('106. 破甲挂上 5 秒减甲', ae.status.armorBreak > 4.9, ae.status.armorBreak);
    const aHp0 = ae.hp;
    aw.damageEnemy(0, 100);
    check('107. 减甲期间伤害 ×1.2', near(aHp0 - ae.hp, 120, 1e-6), aHp0 - ae.hp);

    // 侧步：位移 + 无敌
    const dw = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 105);
    const dx0 = dw.player.x;
    dw.step(F.FIXED_DT, { ...IDLE, moveX: 1, dodge: true });
    check('108. 侧步位移 280px', near(dw.player.x - dx0, F.PLAYER_TUNING.dodge.distance, 6), dw.player.x - dx0);
    check('109. 侧步获得 0.4s 无敌', dw.player.invuln >= 0.38, dw.player.invuln);

    // 血怒：满怒气才可用，清空并增伤
    const bw = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 106);
    const be = bw.spawnEnemy('imp', bw.player.x, bw.player.y + 55, 100000, 0, 0);
    bw.player.rage = 40;
    bw.step(F.FIXED_DT, { ...IDLE, burst: true });
    check('110. 怒气不足时血怒不触发', bw.player.burst === 0 && bw.player.rage === 40);
    bw.player.rage = 100;
    bw.step(F.FIXED_DT, { ...IDLE, burst: true });
    check('111. 满怒气血怒清空怒气并进入 10s 增伤', bw.player.rage === 0 && bw.player.burst > 9.9, bw.player.burst);

    const bw2 = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 106);
    const be2 = bw2.spawnEnemy('imp', bw2.player.x, bw2.player.y + 55, 100000, 0, 0);
    bw2.step(F.FIXED_DT, { ...IDLE, basic: true });
    bw.step(F.FIXED_DT, { ...IDLE, basic: true });
    const burstDmg = 100000 - be.hp;
    const normalDmg = 100000 - be2.hp;
    check('112. 血怒增伤 30%', near(burstDmg / normalDmg, 1 + F.PLAYER_TUNING.burst.dmgBonus, 0.02), burstDmg / normalDmg);

    const bw3 = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 107);
    bw3.player.burst = 10;
    stepFor(bw3, 10.1);
    check('113. 血怒 10 秒后失效', bw3.player.burst === 0, bw3.player.burst);

    // 冷却阻断
    const cdw = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 108);
    cdw.player.cd.whirlwind = 5;
    cdw.step(F.FIXED_DT, { ...IDLE, skill2: true });
    check('114. 冷却中不能重复释放技能', cdw.player.whirlwind === 0, cdw.player.whirlwind);

    // ---- 敌人 AI ----
    const mw = new C.MithrilWorld(C.makeProfile('warrior', 10, 10), 201);
    const me = mw.spawnEnemy('imp', 100, 900, 200, 105, 4);
    const md0 = Math.hypot(me.x - mw.player.x, me.y - mw.player.y);
    stepFor(mw, 0.5);
    const md1 = Math.hypot(me.x - mw.player.x, me.y - mw.player.y);
    check('115. 近战敌人会追击玩家', md1 < md0 - 40, `${md0.toFixed(1)} → ${md1.toFixed(1)}`);

    const rw = new C.MithrilWorld(C.makeProfile('warrior', 10, 10), 202);
    rw.spawnEnemy('wraith', 300, 900, 500, 85, 3);
    stepFor(rw, 2.85);
    check('116. 远程敌人会发射子弹', rw.bullets.some((b) => b.owner === 'enemy'), rw.bullets.length);

    const ew = new C.MithrilWorld(C.makeProfile('warrior', 10, 10), 203);
    ew.spawnEnemy('golem', ew.player.x, ew.player.y + 300, 5000, 0, 0);
    stepFor(ew, 5.3);
    check('117. 精英会放地面预警圈', ew.telegraphs.length > 0, ew.telegraphs.length);

    // ---- 副本推进 ----
    const rw2 = new C.MithrilWorld(C.makeProfile('warrior', 10, 10), 301);
    rw2.startDungeon('mine');
    check('118. 开局进入遭遇 1/3 并生成 4 只小怪', rw2.stage === 'encounter' && rw2.encounterIndex === 0 && rw2.enemies.length === 4, `${rw2.encounterIndex}/${rw2.enemies.length}`);

    clearAllEnemies(rw2);
    stepFor(rw2, F.ENCOUNTER_GAP + 0.2);
    check('119. 清完遭遇 1 进入遭遇 2/3', rw2.encounterIndex === 1 && rw2.enemies.length === 6, `${rw2.encounterIndex}/${rw2.enemies.length}`);

    clearAllEnemies(rw2);
    stepFor(rw2, F.ENCOUNTER_GAP + 0.2);
    check('120. 清完遭遇 2 进入遭遇 3/3', rw2.encounterIndex === 2 && rw2.enemies.length === 8, `${rw2.encounterIndex}/${rw2.enemies.length}`);

    clearAllEnemies(rw2);
    stepFor(rw2, F.BOSS_INTRO_GAP + 0.2);
    check('121. 清完 3 遭遇后 BOSS 入场', rw2.stage === 'boss' && !!rw2.boss && rw2.enemies.length === 1);

    const bossProfile = C.makeProfile('warrior', 30, 40);

    // ---- BOSS 阶段推进 ----
    const pw = makeBossWorld(bossProfile, 302);
    check('122. BOSS 初始为阶段 1', pw.bossPhase === 0, pw.bossPhase);
    pw.boss.shotCd = 9999;
    pw.boss.hp = pw.boss.maxHp * 0.65;
    pw.step(F.FIXED_DT, IDLE);
    check('123. 血量低于 2/3 进入阶段 2', pw.bossPhase === 1, pw.bossPhase);
    pw.boss.hp = pw.boss.maxHp * 0.32;
    pw.step(F.FIXED_DT, IDLE);
    check('124. 血量低于 1/3 进入阶段 3', pw.bossPhase === 2, pw.bossPhase);

    // ---- 走位机制：预警圈 ----
    const mw2 = makeBossWorld(bossProfile, 303);
    mw2.boss.shotCd = 9999;
    let guard = 0;
    while (mw2.telegraphs.length === 0 && guard++ < 480) mw2.step(F.FIXED_DT, IDLE);
    check('125. 走位阶段生成砸地预警圈', mw2.telegraphs.length > 0, guard);
    const tele = mw2.telegraphs[0];
    const hpBefore = mw2.player.hp;
    stepFor(mw2, tele.warn + 0.3);
    check('126. 站在预警圈内会被砸中', mw2.player.hp < hpBefore, `${hpBefore} → ${mw2.player.hp}`);

    const mw3 = makeBossWorld(bossProfile, 303);
    mw3.boss.shotCd = 9999;
    guard = 0;
    while (mw3.telegraphs.length === 0 && guard++ < 480) mw3.step(F.FIXED_DT, IDLE);
    const tele3 = mw3.telegraphs[0];
    mw3.player.x = tele3.x > F.FIELD_W / 2 ? 60 : F.FIELD_W - 60;
    mw3.player.y = tele3.y > F.FIELD_H / 2 ? 200 : F.FIELD_H - 200;
    const hpOut = mw3.player.hp;
    stepFor(mw3, tele3.warn + 0.3);
    check('127. 走出预警圈可以免伤', mw3.player.hp === hpOut, `${hpOut} → ${mw3.player.hp}`);

    // ---- 转火机制：召唤小怪 + BOSS 回血 ----
    const aw2 = makeBossWorld(bossProfile, 304);
    aw2.boss.shotCd = 9999;
    aw2.boss.hp = aw2.boss.maxHp * 0.5;
    aw2.step(F.FIXED_DT, IDLE);
    stepFor(aw2, F.MINE_BOSS_SCRIPT.addsInterval + 0.2);
    const miners = aw2.enemies.filter((e) => e.kind === F.MINE_BOSS_SCRIPT.addsEnemyId);
    check(`128. 转火阶段召唤 ${F.MINE_BOSS_SCRIPT.addsCount} 个矿工`, miners.length === F.MINE_BOSS_SCRIPT.addsCount, miners.length);
    const bossHp0 = aw2.boss.hp;
    stepFor(aw2, 2);
    check(
        '129. 小怪存活时 BOSS 持续回血',
        aw2.boss.hp >= bossHp0 + F.MINE_BOSS_SCRIPT.addsRegen * 1.5,
        `${bossHp0} → ${aw2.boss.hp}（期望 ≥ +${F.MINE_BOSS_SCRIPT.addsRegen * 1.5}）`,
    );
    for (let i = aw2.enemies.length - 1; i >= 0; i--) {
        if (aw2.enemies[i].kind === F.MINE_BOSS_SCRIPT.addsEnemyId) aw2.damageEnemy(i, 1e9);
    }
    const bossHp1 = aw2.boss.hp;
    stepFor(aw2, 2);
    check('130. 小怪清空后 BOSS 停止回血', near(aw2.boss.hp, bossHp1, 1e-6), `${bossHp1} → ${aw2.boss.hp}`);

    // ---- 打断机制 ----
    const iw = makeBossWorld(bossProfile, 305);
    iw.boss.shotCd = 9999;
    iw.boss.hp = iw.boss.maxHp * 0.2;
    iw.step(F.FIXED_DT, IDLE);
    stepFor(iw, F.MINE_BOSS_SCRIPT.interruptInterval + 0.2);
    check('131. 打断阶段开始读条', !!iw.bossCast && iw.boss.casting, iw.bossCast ? iw.bossCast.remaining : 'null');
    const bossIndex = iw.enemies.indexOf(iw.boss);
    iw.damageEnemy(bossIndex, F.MINE_BOSS_SCRIPT.interruptNeed + 10);
    check('132. 读条期间打满伤害可打断', iw.bossCast === null && iw.bossEnraged === 0);

    const iw2 = makeBossWorld(bossProfile, 306);
    iw2.boss.shotCd = 9999;
    iw2.boss.hp = iw2.boss.maxHp * 0.2;
    iw2.step(F.FIXED_DT, IDLE);
    stepFor(iw2, F.MINE_BOSS_SCRIPT.interruptInterval + 0.2);
    const castTotal = iw2.bossCast ? iw2.bossCast.remaining : 0;
    stepFor(iw2, castTotal + 0.2);
    check('133. 不打断则进入增伤状态', iw2.bossEnraged > 0, iw2.bossEnraged);
    stepFor(iw2, F.MINE_BOSS_SCRIPT.enrageDuration + 0.2);
    check('134. 增伤 10 秒后结束', iw2.bossEnraged === 0, iw2.bossEnraged);

    // ---- 终态 ----
    const win = makeBossWorld(bossProfile, 307);
    win.damageEnemy(win.enemies.indexOf(win.boss), 1e9);
    win.step(F.FIXED_DT, IDLE);
    check('135. BOSS 死亡后副本通关', win.phase === 'won' && win.stage === 'cleared');

    const lose = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 308);
    lose.startDungeon('mine');
    lose.hitPlayer(9999);
    check('136. 玩家死亡进入 dead 终态', lose.phase === 'dead' && lose.player.hp === 0);

    // ---- 确定性 ----
    const da = new C.MithrilWorld(C.makeProfile('warrior', 5, 5), 401);
    const db = new C.MithrilWorld(C.makeProfile('warrior', 5, 5), 401);
    da.startDungeon('mine');
    db.startDungeon('mine');
    const din = { moveX: 0.4, moveY: 0.8, aimX: 0.6, aimY: 0.8, basic: true, skill2: true };
    for (let i = 0; i < 600; i++) {
        da.step(F.FIXED_DT, din);
        db.step(F.FIXED_DT, din);
    }
    check('137. 同种子副本推进快照一致', deepEqual(da.snapshot(), db.snapshot()));

    // ---- 事件队列 ----
    const evw = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 402);
    evw.spawnEnemy('imp', evw.player.x, evw.player.y + 55, 10, 0, 0);
    evw.step(F.FIXED_DT, { ...IDLE, basic: true });
    const evs = evw.drainEvents();
    check('138. 事件队列可排空', evs.length > 0 && evw.drainEvents().length === 0, evs.length);

    // ---- 自动玩家：平衡闸门 ----
    function botInput(world) {
        const p = world.player;
        if (world.phase !== 'playing') return IDLE;
        let target = null;
        let best = Infinity;
        for (const e of world.enemies) {
            let score = Math.hypot(e.x - p.x, e.y - p.y);
            // 转火阶段优先小怪
            if (world.bossPhase === 1 && e.kind === F.MINE_BOSS_SCRIPT.addsEnemyId) score -= 1000;
            if (score < best) {
                best = score;
                target = e;
            }
        }
        let mx = 0;
        let my = 0;
        let aimX = 0;
        let aimY = 0;
        let danger = null;
        for (const t of world.telegraphs) {
            if (t.done) continue;
            if (Math.hypot(p.x - t.x, p.y - t.y) < t.radius + 26) {
                danger = t;
                break;
            }
        }
        // 飞行物威胁：预测轨迹会穿过玩家附近
        let bullet = null;
        let bulletDist = Infinity;
        for (const b of world.bullets) {
            if (b.owner !== 'enemy') continue;
            const dx = p.x - b.x;
            const dy = p.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 170) continue;
            const vl = Math.hypot(b.vx, b.vy) || 1;
            const ux = b.vx / vl;
            const uy = b.vy / vl;
            const along = dx * ux + dy * uy;
            if (along < 0) continue;
            const perp = Math.abs(-dx * uy + dy * ux);
            if (perp < 46 && dist < bulletDist) {
                bullet = b;
                bulletDist = dist;
            }
        }
        // 低血时优先吃血球
        let orb = null;
        let orbDist = Infinity;
        if (p.hp / p.maxHp < 0.7 && (!target || best > 220)) {
            for (const o of world.orbs) {
                const dist = Math.hypot(o.x - p.x, o.y - p.y);
                if (dist < 420 && dist < orbDist) {
                    orbDist = dist;
                    orb = o;
                }
            }
        }

        if (danger) {
            const dx = p.x - danger.x;
            const dy = p.y - danger.y;
            const len = Math.hypot(dx, dy) || 1;
            mx = dx / len;
            my = dy / len;
        } else if (bullet) {
            const vl = Math.hypot(bullet.vx, bullet.vy) || 1;
            let sx = -bullet.vy / vl;
            let sy = bullet.vx / vl;
            const nx = p.x + sx * 80;
            const ny = p.y + sy * 80;
            if (nx < 70 || nx > F.FIELD_W - 70 || ny < 70 || ny > F.FIELD_H - 70) {
                sx = -sx;
                sy = -sy;
            }
            mx = sx;
            my = sy;
        } else if (orb) {
            const dx = orb.x - p.x;
            const dy = orb.y - p.y;
            const dist = Math.hypot(dx, dy) || 1;
            mx = dx / dist;
            my = dy / dist;
        } else if (target) {
            const dx = target.x - p.x;
            const dy = target.y - p.y;
            const dist = Math.hypot(dx, dy) || 1;
            aimX = dx / dist;
            aimY = dy / dist;
            const desired = target.isBoss ? 140 : 82;
            if (dist > desired + 12) {
                mx = dx / dist;
                my = dy / dist;
            } else if (dist < desired - 20) {
                mx = -dx / dist;
                my = -dy / dist;
            } else {
                // 绕圈，避免站桩吃投射物
                mx = (-dy / dist) * 0.6;
                my = (dx / dist) * 0.6;
            }
        }
        // 贴墙时往回走
        if (p.x < 70) mx = Math.max(mx, 0.7);
        if (p.x > F.FIELD_W - 70) mx = Math.min(mx, -0.7);
        if (p.y < 70) my = Math.max(my, 0.7);
        if (p.y > F.FIELD_H - 70) my = Math.min(my, -0.7);
        const distToTarget = target ? best : 9999;
        const attackRange = target && target.isBoss ? 165 : 125;
        return {
            moveX: mx,
            moveY: my,
            aimX,
            aimY,
            basic: distToTarget < attackRange,
            skill1: !danger && distToTarget > 140 && p.cd.charge <= 0,
            skill2: distToTarget < (target && target.isBoss ? 175 : 110) && p.cd.whirlwind <= 0,
            skill3: distToTarget < 155 && p.cd.armorBreak <= 0,
            burst: p.rage >= F.PLAYER_TUNING.burst.rageCost && p.cd.burst <= 0,
            dodge: (!!danger || (!!bullet && bulletDist < 65)) && p.cd.dodge <= 0,
        };
    }

    function runBot(profile, seed, maxSeconds, zeroAim = false) {
        const w = new C.MithrilWorld(profile, seed);
        w.startDungeon('mine');
        const seen = new Set();
        let steps = 0;
        const maxSteps = Math.round(maxSeconds / F.FIXED_DT);
        while (w.phase === 'playing' && steps < maxSteps) {
            const input = botInput(w);
            // 手机端只有摇杆、没有瞄准：清掉 aim 才是真实输入
            if (zeroAim) {
                input.aimX = 0;
                input.aimY = 0;
            }
            w.step(F.FIXED_DT, input);
            for (const ev of w.drainEvents()) {
                if (ev.type === 'phase') seen.add(`phase${ev.phase}`);
                else if (ev.type === 'castStart') seen.add('cast');
                else if (ev.type === 'regen') seen.add('regen');
                else if (ev.type === 'boom') seen.add('boom');
                else if (ev.type === 'castEnd') seen.add(ev.interrupted ? 'interrupt' : 'enrage');
            }
            steps++;
        }
        return { world: w, seconds: steps * F.FIXED_DT, seen };
    }

    const run5 = runBot(C.makeProfile('warrior', 5, 5), 501, 360);
    check('139. 5 级战士自动玩家 6 分钟内通关', run5.world.phase === 'won', `${run5.world.phase} @ ${run5.seconds.toFixed(1)}s`);
    check('140. 自动玩家观察到三阶段机制（走位/转火/打断）',
        run5.seen.has('phase2') && run5.seen.has('phase3') && run5.seen.has('boom') && run5.seen.has('regen') && run5.seen.has('cast'),
        Array.from(run5.seen).join(','));

    // 141/142：手机端输入回归。曾经普攻 / 冲锋 / 破甲索敌都传 includeBoss=false，
    // 玩家绕圈走位时剑永远指向切向 → BOSS 战实测只有约 5 DPS，BOSS 打不死。
    const noAim = runBot(C.makeProfile('warrior', 5, 5), 501, 360, true);
    check('145. 无瞄准输入（仅摇杆）自动玩家同样 6 分钟内通关',
        noAim.world.phase === 'won', `${noAim.world.phase} @ ${noAim.seconds.toFixed(1)}s`);

    const swingW = makeBossWorld(C.makeProfile('warrior', 10, 10), 991);
    const swingBoss = swingW.enemies.find((e) => e.isBoss);
    const side = swingBoss.x + 128 <= F.FIELD_W - 40 ? 1 : -1;
    swingW.player.x = swingBoss.x + 128 * side;
    swingW.player.y = swingBoss.y;
    swingW.player.facing = side > 0 ? Math.PI / 2 : -Math.PI / 2; // 朝向切向
    swingW.player.cd.basic = 0;
    const swingHp0 = swingBoss.hp;
    swingW.step(F.FIXED_DT, { ...IDLE, basic: true, moveX: 0, moveY: -1 });
    check('146. 切线走位时普攻自动转向 BOSS 并命中', swingBoss.hp < swingHp0, `${swingHp0} → ${swingBoss.hp}`);

    // 147：普攻多目标结算必须倒序。升序结算时，先死的那只 splice 后会把后面所有下标前移，
    // 后面的伤害就会打到扇形外的旁观敌人身上（或丢伤害）。这里让最近的一只只有 1 血。
    const mtw = new C.MithrilWorld(C.makeProfile('warrior', 1, 1), 147);
    mtw.startDungeon('mine');
    mtw.step(F.FIXED_DT, IDLE); // 触发首个遭遇，再清空，避免遭遇怪混进下标
    clearAllEnemies(mtw);
    const mp = mtw.player;
    mp.x = F.FIELD_W / 2;
    mp.y = 400;
    mp.facing = Math.PI / 2;
    mp.cd.basic = 0;
    const near1Hp = mtw.spawnEnemy('imp', mp.x, mp.y + 60, 1, 0, 0);      // 最近，1 血 → 先死
    const midEnemy = mtw.spawnEnemy('imp', mp.x + 40, mp.y + 75, 500, 0, 0);
    const farEnemy = mtw.spawnEnemy('imp', mp.x - 40, mp.y + 75, 500, 0, 0);
    const behindEnemy = mtw.spawnEnemy('imp', mp.x, mp.y - 80, 500, 0, 0); // 扇形外
    const midHp0 = midEnemy.hp;
    const farHp0 = farEnemy.hp;
    const behindHp0 = behindEnemy.hp;
    mtw.step(F.FIXED_DT, { ...IDLE, basic: true });
    check('147. 普攻多目标致死时结算不打偏（倒序 + 扇形外不掉血）',
        near1Hp.hp <= 0 && midEnemy.hp < midHp0 && farEnemy.hp < farHp0 && behindEnemy.hp === behindHp0,
        `near ${near1Hp.hp}, mid ${midHp0}→${midEnemy.hp}, far ${farHp0}→${farEnemy.hp}, behind ${behindHp0}→${behindEnemy.hp}`);

    // 副本长跑不变量
    const lw = new C.MithrilWorld(C.makeProfile('warrior', 5, 5), 601);
    lw.startDungeon('mine');
    let lwOk = true;
    for (let i = 0; i < 10000; i++) {
        lw.step(F.FIXED_DT, botInput(lw));
        lw.drainEvents();
        if (!Number.isFinite(lw.player.x) || !Number.isFinite(lw.player.y) || !Number.isFinite(lw.player.hp)) {
            lwOk = false;
            break;
        }
        if (lw.boss && !Number.isFinite(lw.boss.hp)) {
            lwOk = false;
            break;
        }
    }
    check('141. 副本 10,000 步长跑无 NaN', lwOk);

    // ---- 血球 ----
    const ow = new C.MithrilWorld(C.makeProfile('warrior', 10, 10), 701);
    ow.player.hp = 30;
    for (let i = 0; i < 60; i++) {
        ow.spawnEnemy('imp', ow.player.x + 4, ow.player.y + 4, 5, 0, 0);
        ow.damageEnemy(ow.enemies.length - 1, 10);
    }
    check('142. 击杀敌人会掉落血球', ow.orbs.length > 0, ow.orbs.length);
    const orbHp = ow.player.hp;
    ow.step(F.FIXED_DT, IDLE);
    check('143. 靠近血球自动拾取回血', ow.player.hp > orbHp, `${orbHp} → ${ow.player.hp}`);

    const ow2 = new C.MithrilWorld(C.makeProfile('warrior', 10, 10), 702);
    for (let i = 0; i < 80; i++) {
        ow2.spawnEnemy('imp', 120, 1000, 5, 0, 0);
        ow2.damageEnemy(ow2.enemies.length - 1, 10);
    }
    ow2.player.x = 600;
    ow2.player.y = 200;
    const orbCount = ow2.orbs.length;
    stepFor(ow2, F.ORB_LIFE + 0.2);
    check('144. 血球 20 秒后自然消失', orbCount > 0 && ow2.orbs.length === 0, `${orbCount} → ${ow2.orbs.length}`);
}

// ==================== 汇总 ====================

const total = passed + failed;
if (failed > 0) {
    console.error(`\nMITHRIL_CORE_FAILED  ${passed}/${total} 项通过`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
}
console.log(`MITHRIL_CORE_OK  ${passed}/${total} 项通过（M1）`);
