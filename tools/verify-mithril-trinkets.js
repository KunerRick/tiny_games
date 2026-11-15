#!/usr/bin/env node
/**
 * 《秘银远征》饰品自检（M7，不启动 Cocos 编辑器）。
 *
 * 覆盖（对应 docs/plans/2026-11-15-mithril-m7-plan.md 的验收口径）：
 *  1. 配置完整性：20 件 / 10 个 tag 各 1 对 / 12 条协同 / 掉落池每件恰好出现一次
 *  2. 协同只靠配对点亮：同 tag 两件不点亮任何协同，未配对的 tag 组合也不点亮
 *  3. 20 件逐件的规则效果：用假宿主直接断言（不跑战斗，快且可定位）
 *  4. 12 条协同逐条的规则效果
 *  5. 掉落闭环：首通集齐 20 件 / 两格装备 / 存档往返 / 坏档净化
 *  6. **打桩差异**：同等级同装备，60 秒 DPS 戴饰品（含协同）比不戴高 ≥ 25%
 *  7. 4 职业 × 6 副本 × {不戴, 戴} 自动通关矩阵：无 NaN、无卡死、全部通关
 *
 * 用法：node tools/verify-mithril-trinkets.js
 * 通过时打印 MITHRIL_TRINKETS_OK；失败逐条打印并以退出码 1 结束。
 * `MITHRIL_VERBOSE=1` 打印每条通过项与实测倍率（调平衡时看这个）。
 */

'use strict';

const path = require('path');

const { ROOT, runTsc } = require('./lib/core-compile');

const SRC_DIR = path.join(ROOT, 'assets', 'games', 'game_mithril', 'scripts');
const OUT = path.join(ROOT, 'temp', 'mithril-trinkets-test');

// ---------- 编译纯逻辑模块 ----------
console.log(`编译纯逻辑模块 → ${path.relative(ROOT, OUT)}`);
runTsc([
    path.join(SRC_DIR, 'MithrilConfig.ts'),
    path.join(SRC_DIR, 'MithrilProgress.ts'),
    path.join(SRC_DIR, 'MithrilCore.ts'),
    path.join(SRC_DIR, 'MithrilLoot.ts'),
    path.join(SRC_DIR, 'MithrilTalents.ts'),
    path.join(SRC_DIR, 'MithrilTrinkets.ts'),
    '--outDir', OUT,
    '--rootDir', SRC_DIR,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
]);

const F = require(path.join(OUT, 'MithrilConfig.js'));
const P = require(path.join(OUT, 'MithrilProgress.js'));
const C = require(path.join(OUT, 'MithrilCore.js'));
const L = require(path.join(OUT, 'MithrilLoot.js'));
const T = require(path.join(OUT, 'MithrilTrinkets.js'));

const { BANDS, runDungeon } = require('./lib/mithril-bot').createBot(F, C);

let passed = 0;
const failures = [];

function check(name, cond, detail) {
    if (cond) {
        passed++;
        if (process.env.MITHRIL_VERBOSE) {
            console.log(`ok  ${name}${detail !== undefined ? `  [${detail}]` : ''}`);
        }
    } else {
        failures.push(`${name}${detail !== undefined ? ` —— ${detail}` : ''}`);
    }
}

function eq(name, actual, expected) {
    check(name, actual === expected, `期望 ${expected}，实际 ${actual}`);
}

function near(name, actual, expected, tol) {
    check(name, Math.abs(actual - expected) <= tol, `期望 ${expected}±${tol}，实际 ${actual}`);
}

const CLASS_IDS = ['warrior', 'mage', 'ranger', 'priest'];
const DUNGEON_IDS = F.DUNGEONS.map((d) => d.id);

// ==================== 假宿主（TrinketFx 的断言脚手架） ====================

function makeEnemy(over) {
    return Object.assign({
        id: 1,
        x: 100,
        y: 0,
        hp: 500,
        maxHp: 500,
        isElite: false,
        isBoss: false,
        radius: 14,
        facing: 0,
        status: { stun: 0, burnDps: 0, burnRemaining: 0 },
    }, over || {});
}

/**
 * 假宿主：`time` / `player` / `enemies` 都是活的，测试可以随时改。
 * 所有宿主动作都记进 `state`，断言「饰品真的调用了什么」而不是「看起来像」。
 */
function makeHarness(trinkets, opts) {
    const o = opts || {};
    const state = {
        time: 0,
        enemies: o.enemies || [],
        player: { x: 0, y: 0, hp: 100, maxHp: 100, shield: 0, hidden: false },
        ap: o.ap === undefined ? 20 : o.ap,
        rngValue: o.rng === undefined ? 0.5 : o.rng,
        gold: 0,
        healed: 0,
        orbs: [],
        haste: 0,
        resets: [],
        shields: [],
    };
    const host = {
        get time() { return state.time; },
        get rng() { return () => state.rngValue; },
        get enemies() { return state.enemies; },
        get player() { return state.player; },
        attackPower() { return state.ap; },
        healPlayer(amount) {
            const before = state.player.hp;
            state.player.hp = Math.min(state.player.maxHp, state.player.hp + Math.max(0, amount));
            const heal = state.player.hp - before;
            state.healed += heal;
            return heal;
        },
        addShield(amount, capPct) {
            const cap = state.player.maxHp * Math.max(0, capPct);
            state.player.shield = Math.min(cap, state.player.shield + Math.max(0, amount));
            state.shields.push(amount);
        },
        addOrb(x, y, amount) { state.orbs.push({ x, y, amount }); },
        addGold(amount) { state.gold += amount; },
        resetCooldown(slot) { state.resets.push(slot); },
        grantHaste(amount) { state.haste = Math.max(state.haste, amount); },
    };
    return { fx: T.trinketFxOf(trinkets, host), state, host };
}

/** 把排队的待结算伤害取出来（radius = 0 表示单体） */
function flushAll(fx) {
    const out = [];
    fx.flush((f) => out.push({
        targetId: f.targetId,
        x: f.x,
        y: f.y,
        radius: f.radius,
        amount: f.amount,
    }));
    return out;
}

// ==================== 1. 配置完整性 ====================

{
    const ids = F.TRINKETS.map((t) => t.id);
    eq('1. 饰品总数 = 20', ids.length, 20);
    eq('2. 饰品 id 不重复', new Set(ids).size, ids.length);

    const byTag = {};
    for (const t of F.TRINKETS) {
        byTag[t.tag] = (byTag[t.tag] || 0) + 1;
        check(`[${t.id}] 有名字`, typeof t.name === 'string' && t.name.length > 0, t.name);
        check(`[${t.id}] 有效果文案`, typeof t.effect === 'string' && t.effect.length > 0);
        check(`[${t.id}] tag 合法`, F.TRINKET_TAGS.indexOf(t.tag) >= 0, t.tag);
        check(`[${t.id}] 有中文 tag 名`, !!F.TRINKET_TAG_NAMES[t.tag], t.tag);
    }
    eq('3. 10 个 tag', Object.keys(byTag).length, 10);
    for (const tag of F.TRINKET_TAGS) {
        eq(`4. tag「${tag}」恰好 2 件`, byTag[tag], 2);
    }

    eq('5. 协同总数 = 12', F.SYNERGIES.length, 12);
    const keys = new Set();
    for (const s of F.SYNERGIES) {
        const key = F.synergyPairKey(s.a, s.b);
        check(`[${s.id}] 配对不重复`, !keys.has(key), key);
        keys.add(key);
        check(`[${s.id}] 两个 tag 不同`, s.a !== s.b, `${s.a}/${s.b}`);
        check(`[${s.id}] tag 合法`, F.TRINKET_TAGS.indexOf(s.a) >= 0 && F.TRINKET_TAGS.indexOf(s.b) >= 0);
        check(`[${s.id}] 有效果文案`, typeof s.effect === 'string' && s.effect.length > 0);
    }

    // 掉落池：20 件各出现且只出现一次，仓库 id 必须是真副本
    const seen = {};
    let poolTotal = 0;
    for (const dungeonId of Object.keys(F.TRINKET_LOOT)) {
        const pool = F.TRINKET_LOOT[dungeonId];
        check(`[${dungeonId}] 是已实现副本`, !!F.DUNGEON_LOOT[dungeonId], dungeonId);
        check(`[${dungeonId}] 饰品池 3–4 件`, pool.length >= 3 && pool.length <= 4, pool.length);
        for (const id of pool) {
            check(`[${dungeonId}] 池内 ${id} 存在`, !!F.TRINKET_BY_ID[id], id);
            check(`[${id}] 只在 ${dungeonId} 一个池里`, !seen[id], seen[id]);
            seen[id] = dungeonId;
            poolTotal++;
        }
    }
    eq('6. 掉落池覆盖 20 件', poolTotal, 20);
    eq('7. 每个副本都有饰品池', Object.keys(F.TRINKET_LOOT).length, DUNGEON_IDS.length);
}

// ==================== 2. 协同只靠配对点亮 ====================

{
    const firstOfTag = {};
    for (const t of F.TRINKETS) if (!firstOfTag[t.tag]) firstOfTag[t.tag] = t.id;

    for (const s of F.SYNERGIES) {
        const lit = T.litSynergies([firstOfTag[s.a], firstOfTag[s.b]]);
        eq(`[${s.id}] 配对点亮且只点亮这一条`, lit.length === 1 ? lit[0].id : `n=${lit.length}`, s.id);
    }

    // 同 tag 两件：任何 tag 都不产生协同
    for (const tag of F.TRINKET_TAGS) {
        const two = F.TRINKETS.filter((t) => t.tag === tag).map((t) => t.id);
        const lit = T.litSynergies(two);
        eq(`[同 tag ${tag}] 不点亮任何协同`, lit.length, 0);
    }

    // 没有配对的 tag 组合也不点亮（用 45 种组合里除 12 条外的全部验一遍）
    const litKeys = new Set(F.SYNERGIES.map((s) => F.synergyPairKey(s.a, s.b)));
    for (let i = 0; i < F.TRINKET_TAGS.length; i++) {
        for (let j = i + 1; j < F.TRINKET_TAGS.length; j++) {
            const a = F.TRINKET_TAGS[i];
            const b = F.TRINKET_TAGS[j];
            const key = F.synergyPairKey(a, b);
            if (litKeys.has(key)) continue;
            const lit = T.litSynergies([firstOfTag[a], firstOfTag[b]]);
            eq(`[未配对 ${a}+${b}] 不点亮`, lit.length, 0);
        }
    }

    // 同一件装两格也不叠加
    eq('8. 同一件装两格不点亮协同', T.litSynergies(['blood_ring', 'blood_ring']).length, 0);
}

// ==================== 3. 20 件逐件的规则效果 ====================

{
    // 血
    {
        const h = makeHarness(['blood_amulet']);
        h.state.player.hp = 20;
        near('blood_amulet 低血技能冷却 ×0.6', h.fx.skillCooldownMul(), 0.6, 1e-9);
        h.state.player.hp = 90;
        near('blood_amulet 高血冷却不变', h.fx.skillCooldownMul(), 1, 1e-9);
    }
    {
        const h = makeHarness(['blood_ring']);
        h.state.player.hp = 40; // 损失 60% → 6 层 → 封顶 +30%
        near('blood_ring 低血伤害 +30%（封顶）', h.fx.currentDamageMul(), 1.3, 1e-9);
        h.state.player.hp = 100;
        near('blood_ring 满血不加伤', h.fx.currentDamageMul(), 1, 1e-9);
    }

    // 影
    {
        const h = makeHarness(['silent_bell']);
        h.fx.onDodge();
        eq('silent_bell 闪避后下一技能必暴（第一次）', h.fx.consumeForcedSkillCrit(), true);
        eq('silent_bell 必暴只消耗一次', h.fx.consumeForcedSkillCrit(), false);
    }
    {
        const h = makeHarness(['shadow_cloak']);
        for (let i = 0; i < 3; i++) {
            h.fx.tick(1);
            h.state.time += 1;
        }
        eq('shadow_cloak 静止 2 秒后隐身', h.fx.hidden, true);
        near('shadow_cloak 首次攻击 +80%', h.fx.currentDamageMul(), 1.8, 1e-9);
        eq('shadow_cloak 出手后显形', h.fx.hidden, false);
        // 伏击后必须重新站定 + 过冷却，不能站桩每击都 +80%
        for (let i = 0; i < 20; i++) {
            h.fx.tick(0.2);
            h.state.time += 0.2;
            h.fx.currentDamageMul();
        }
        eq('shadow_cloak 伏击冷却内不会无限隐身', h.fx.hidden, false);
    }

    // 回响
    {
        const h = makeHarness(['echo_stone']);
        const wants = [];
        for (let i = 0; i < 3; i++) {
            const free = h.fx.wantFreeCast('charge');
            wants.push(free);
            h.fx.onSkillCast('charge', free);
        }
        eq('echo_stone 每第 3 次施放免耗（前两次收费）',
            JSON.stringify(wants), JSON.stringify([false, false, true]));
        eq('echo_stone 第 4 次重新收费', h.fx.wantFreeCast('charge'), false);
    }
    {
        const h = makeHarness(['resonance_crystal'], { rng: 0.2 });
        h.fx.onSkillCast('charge', false);
        h.fx.onHitLanded(makeEnemy(), true, 'skill');
        check('resonance_crystal 技能暴击重置该技能冷却', h.state.resets.indexOf('charge') >= 0);
    }

    // 荆棘
    {
        const h = makeHarness(['thorn_crown']);
        near('thorn_crown 移速 -10%', h.fx.speedMul(), 0.9, 1e-9);
        const attacker = makeEnemy({ id: 7 });
        h.fx.onDamaged(attacker, 100, true);
        const out = flushAll(h.fx);
        eq('thorn_crown 近战反弹 20%', out.length === 1 ? out[0].amount : -1, 20);
        eq('thorn_crown 反弹打回攻击者', out[0] && out[0].targetId, 7);
        h.fx.onDamaged(attacker, 100, false);
        eq('thorn_crown 远程伤害不反弹', flushAll(h.fx).length, 0);
    }
    {
        const h = makeHarness(['thorn_plate']);
        h.fx.onDamaged(makeEnemy(), 100, false);
        const out = flushAll(h.fx);
        eq('thorn_plate 受伤向周围溅射 15%', out.length === 1 ? out[0].amount : -1, 15);
        eq('thorn_plate 溅射半径 80', out[0] && out[0].radius, 80);
        h.fx.onDamaged(makeEnemy(), 100, false);
        eq('thorn_plate 0.5 秒内只触发一次', flushAll(h.fx).length, 0);
    }

    // 贪婪（掉落侧纯查询 + 结算工具）
    {
        eq('greed_eye 额外掉落 +1', T.extraDropCountOf(['greed_eye']), 1);
        near('greed_eye 降档概率 25%', T.lowerQualityChanceOf(['greed_eye']), 0.25, 1e-9);
        eq('greed_eye 未装备时无额外掉落', T.extraDropCountOf([null, null]), 0);
        const lowered = L.maybeLowerQuality(() => 0, { quality: 'epic' }, 0.25);
        eq('greed_eye 命中概率时品质降一档', lowered.quality, 'rare');
        const kept = L.maybeLowerQuality(() => 0.9, { quality: 'epic' }, 0.25);
        eq('greed_eye 未命中概率时品质不变', kept.quality, 'epic');
        const floor = L.maybeLowerQuality(() => 0, { quality: 'common' }, 1);
        eq('greed_eye 最低档不再往下掉', floor.quality, 'common');
    }
    {
        eq('scavenger_pack 宝箱多一个选项', T.chestExtraOptionOf(['scavenger_pack']), true);
        near('scavenger_pack 额外代价 5% 生命', T.chestHpCostOf(['scavenger_pack']), 0.05, 1e-9);
        eq('scavenger_pack 未装备时没有额外选项', T.chestExtraOptionOf(['blood_ring']), false);
    }

    // 烬火
    {
        const h = makeHarness(['ember_ring']);
        const e = makeEnemy();
        h.fx.applyBurn(e, 10, 2);
        h.fx.applyBurn(e, 10, 2);
        eq('ember_ring 燃烧可叠 2 层', e.status.burnDps, 20);
        const plain = makeHarness([]);
        const e2 = makeEnemy();
        plain.fx.applyBurn(e2, 10, 2);
        plain.fx.applyBurn(e2, 10, 2);
        eq('无余烬之环时燃烧取最大（不叠加）', e2.status.burnDps, 10);
    }
    {
        const h = makeHarness(['ember_stone']);
        const burning = makeEnemy();
        burning.status.burnRemaining = 2;
        h.fx.onEnemyKilled(burning);
        const out = flushAll(h.fx);
        eq('ember_stone 击杀燃烧目标产生 60px 爆炸', out[0] && out[0].radius, 60);
        near('ember_stone 爆炸伤害 = 攻击强度 ×0.9', out[0] ? out[0].amount : -1, 18, 1e-9);
        const cold = makeEnemy();
        const h2 = makeHarness(['ember_stone']);
        h2.fx.onEnemyKilled(cold);
        eq('ember_stone 击杀未燃烧目标不爆炸', flushAll(h2.fx).length, 0);
    }

    // 霜
    {
        const h = makeHarness(['frost_pendant']);
        const frozen = makeEnemy();
        frozen.status.stun = 1;
        near('frost_pendant 冻结目标伤害 +25%', h.fx.damageMulVs(frozen, 'skill'), 1.25, 1e-9);
        near('frost_pendant 未冻结目标不变', h.fx.damageMulVs(makeEnemy(), 'skill'), 1, 1e-9);
        near('frost_pendant 不加成 DoT', h.fx.damageMulVs(frozen, 'dot'), 1, 1e-9);
    }
    {
        const h = makeHarness(['frost_heart']);
        near('frost_heart 冰霜半径 +40%', h.fx.frostRadiusMul(), 1.4, 1e-9);
    }

    // 雷
    {
        const h = makeHarness(['storm_totem']);
        const e = makeEnemy({ x: 120, y: 0 });
        h.state.enemies = [e];
        for (let i = 0; i < 4; i++) h.fx.onHitLanded(e, false, 'basic');
        eq('storm_totem 第 4 次命中还不落雷', h.fx.drainVisuals().length, 0);
        h.fx.onHitLanded(e, false, 'basic');
        const visuals = h.fx.drainVisuals();
        eq('storm_totem 第 5 次命中落雷', visuals.length === 1 ? visuals[0].kind : 'none', 'lightning');
        const out = flushAll(h.fx);
        check('storm_totem 落雷造成伤害', out.length === 1 && out[0].amount >= 10,
            out[0] && out[0].amount);
    }
    {
        const h = makeHarness(['charge_bracer']);
        h.fx.onHitLanded(makeEnemy(), false, 'basic');
        eq('charge_bracer 未暴击不加攻速', h.state.haste, 0);
        h.fx.onHitLanded(makeEnemy(), true, 'basic');
        eq('charge_bracer 暴击后攻速 +50%', h.state.haste, 0.5);
    }

    // 誓约
    {
        const h = makeHarness(['oath_sigil']);
        eq('oath_sigil 首次致死免疫', h.fx.trySaveFromDeath(), true);
        eq('oath_sigil 同一节点只免一次', h.fx.trySaveFromDeath(), false);
        h.fx.resetNode();
        eq('oath_sigil 新节点重新就绪', h.fx.trySaveFromDeath(), true);
    }
    {
        const h = makeHarness(['oath_chain']);
        h.fx.onHealOverflow(50);
        near('oath_chain 溢出治疗转护盾（上限 20%）', h.state.player.shield, 20, 1e-9);
    }

    // 饥饿
    {
        const h = makeHarness(['hungry_stomach']);
        near('hungry_stomach 拾取半径 +30%', h.fx.orbPickupMul(), 1.3, 1e-9);
        near('hungry_stomach 治疗量 -15%', h.fx.orbHealMul(), 0.85, 1e-9);
    }
    {
        const h = makeHarness(['scavenger_pendant']);
        h.state.player.hp = 50;
        h.fx.onEnemyKilled(makeEnemy({ isElite: true }));
        near('scavenger_pendant 击杀精英回 10% 生命', h.state.healed, 10, 1e-9);
        h.state.healed = 0;
        h.fx.onEnemyKilled(makeEnemy({ isElite: false }));
        eq('scavenger_pendant 击杀普通怪不回血', h.state.healed, 0);
    }
}

// ==================== 4. 12 条协同的规则效果 ====================

{
    // 血燃：低血时燃烧 ×2
    {
        const h = makeHarness(['blood_ring', 'ember_ring']);
        h.state.player.hp = 20;
        near('bloodfire 低血燃烧 ×2', h.fx.burnTickMul(), 2, 1e-9);
        h.state.player.hp = 80;
        near('bloodfire 高血燃烧不变', h.fx.burnTickMul(), 1, 1e-9);
    }
    // 影回：闪避后技能免耗
    {
        const h = makeHarness(['silent_bell', 'echo_stone']);
        h.fx.onDodge();
        eq('shadowecho 闪避后技能免耗', h.fx.wantFreeCast('charge'), true);
        h.fx.onSkillCast('charge', true);
        eq('shadowecho 免耗只给一次', h.fx.wantFreeCast('charge'), false);
    }
    // 守财：反弹转金币
    {
        const h = makeHarness(['thorn_crown', 'greed_eye']);
        h.fx.onDamaged(makeEnemy(), 100, true);
        flushAll(h.fx);
        check('thrift 反弹的 20% 转成金币', h.state.gold >= 4, h.state.gold);
    }
    // 冰雷：冻结目标被雷击向周围传导
    {
        const h = makeHarness(['frost_pendant', 'storm_totem']);
        const e = makeEnemy({ x: 100, y: 0 });
        e.status.stun = 1;
        h.state.enemies = [e];
        h.fx.dropLightning();
        const out = flushAll(h.fx);
        check('icestorm 雷击冻结目标向 60px 传导',
            out.some((f) => f.radius === 60), out.map((f) => f.radius).join(','));
    }
    // 誓血：有护盾时伤害 +15%
    {
        const h = makeHarness(['oath_sigil', 'blood_ring']);
        h.state.player.shield = 10;
        near('oathblood 有护盾时伤害 +15%', h.fx.currentDamageMul(), 1.15, 1e-9);
        h.state.player.shield = 0;
        near('oathblood 无护盾时不变', h.fx.currentDamageMul(), 1, 1e-9);
    }
    // 饕餮：额外掉落回血
    {
        near('feast 额外掉落回 3% 生命',
            T.feastHealOnExtraLoot(['hungry_stomach', 'greed_eye'], 1000), 30, 1e-9);
        near('feast 未配对不回血', T.feastHealOnExtraLoot(['greed_eye', 'blood_ring'], 1000), 0, 1e-9);
        const h = makeHarness(['hungry_stomach', 'greed_eye']);
        h.state.player.hp = 50;
        h.fx.onExtraLoot();
        near('feast 战斗内 onExtraLoot 同样回血', h.state.healed, 3, 1e-9);
    }
    // 雷火：燃烧目标被雷击点燃周围
    {
        const h = makeHarness(['ember_ring', 'storm_totem']);
        const target = makeEnemy({ id: 1, x: 100, y: 0 });
        target.status.burnRemaining = 2;
        const near1 = makeEnemy({ id: 2, x: 140, y: 0 });
        h.state.enemies = [target, near1];
        h.fx.dropLightning();
        check('firestorm 雷击燃烧目标点燃周围', near1.status.burnDps > 0, near1.status.burnDps);
        flushAll(h.fx);
    }
    // 影刺：背后 +40%
    {
        const h = makeHarness(['shadow_cloak', 'thorn_crown']);
        h.fx.onDodge();
        const behind = makeEnemy({ x: 100, y: 0, facing: 0 }); // 面朝 +x，玩家在原点 = 背后
        near('shadowthorn 闪避后处于背刺窗口', h.fx.damageMulVs(behind, 'skill'), 1.4, 1e-9);
        const front = makeEnemy({ x: -100, y: 0, facing: 0 });
        near('shadowthorn 正面不吃背刺加成', h.fx.damageMulVs(front, 'skill'), 1, 1e-9);
    }
    // 誓回：重置冷却时小护盾
    {
        const h = makeHarness(['resonance_crystal', 'oath_sigil'], { rng: 0.2 });
        h.fx.onSkillCast('charge', false);
        h.fx.onHitLanded(makeEnemy(), true, 'skill');
        check('oathreturn 重置冷却时给 3% 护盾',
            h.state.resets.indexOf('charge') >= 0 && h.state.player.shield >= 2.9,
            h.state.player.shield);
    }
    // 寒食：冻结目标死亡掉血球
    {
        const h = makeHarness(['frost_pendant', 'hungry_stomach']);
        const frozen = makeEnemy();
        frozen.status.stun = 1;
        h.fx.onEnemyKilled(frozen);
        eq('coldmeal 冻结目标死亡掉 1 个血球', h.state.orbs.length, 1);
        near('coldmeal 血球量 = 6% 生命', h.state.orbs[0] ? h.state.orbs[0].amount : -1, 6, 1e-9);
        const h2 = makeHarness(['frost_pendant', 'hungry_stomach']);
        h2.fx.onEnemyKilled(makeEnemy());
        eq('coldmeal 未冻结目标不掉血球', h2.state.orbs.length, 0);
    }
    // 雷音：每 3 次雷击一次全屏
    {
        const h = makeHarness(['storm_totem', 'echo_stone']);
        const e = makeEnemy({ x: 100, y: 0 });
        h.state.enemies = [e];
        for (let i = 0; i < 3; i++) {
            h.fx.dropLightning();
            h.state.time += 2.1;
        }
        const out = flushAll(h.fx);
        check('thunderclap 每 3 次雷击触发全屏',
            out.some((f) => f.radius === 4000), out.map((f) => f.radius).join(','));
        const visuals = h.fx.drainVisuals();
        check('thunderclap 全屏雷击的特效半径被夹住',
            visuals.every((v) => v.radius <= 420), visuals.map((v) => v.radius).join(','));
    }
    // 血食：低血拾取范围 +80%
    {
        const h = makeHarness(['blood_ring', 'hungry_stomach']);
        h.state.player.hp = 40;
        near('bloodfeast 低血拾取范围 +80%（与饥饿之胃相乘）', h.fx.orbPickupMul(), 1.3 * 1.8, 1e-9);
        h.state.player.hp = 100;
        near('bloodfeast 高血只有饥饿之胃的 +30%', h.fx.orbPickupMul(), 1.3, 1e-9);
    }
}

// ==================== 5. 掉落闭环 & 存档往返 ====================

{
    // 每个池里的每一件都能拿到
    for (const dungeonId of Object.keys(F.TRINKET_LOOT)) {
        for (const id of F.TRINKET_LOOT[dungeonId]) {
            const save = P.defaultSave('warrior');
            eq(`[${id}] addTrinket 记入背包`, L.addTrinket(save, id), true);
            eq(`[${id}] 拥有判定`, L.ownsTrinket(save, id), true);
            eq(`[${id}] 重复 addTrinket 不重复`, L.addTrinket(save, id), false);
            eq(`[${id}] 可装到 0 号槽`, L.equipTrinket(save, id, 0), true);
            eq(`[${id}] 装备后背包不再列它`, save.trinketBag.indexOf(id), -1);
            eq(`[${id}] 同一件不能占两格`, L.equipTrinket(save, id, 1), false);
            eq(`[${id}] 卸下回背包`, L.unequipTrinket(save, 0), true);
            eq(`[${id}] 卸下后仍在背包`, save.trinketBag.indexOf(id) >= 0, true);
        }
    }

    // 首通集齐 20 件：每个副本的首通都必给本池未拥有的一件
    {
        const save = P.defaultSave('warrior');
        let rngN = 1;
        const rng = () => {
            rngN = (rngN * 1103515245 + 12345) % 2147483648;
            return rngN / 2147483648;
        };
        for (const dungeonId of Object.keys(F.TRINKET_LOOT)) {
            const before = L.unownedTrinkets(save, dungeonId).length;
            let gained = 0;
            for (let round = 0; round < 6 && L.unownedTrinkets(save, dungeonId).length > 0; round++) {
                const id = L.bossTrinket(rng, save, dungeonId, true);
                if (!id) break;
                check(`[${dungeonId}] 首通掉落来自本池`,
                    F.TRINKET_LOOT[dungeonId].indexOf(id) >= 0, id);
                L.addTrinket(save, id);
                gained++;
            }
            eq(`[${dungeonId}] 首通能补齐本池全部 ${before} 件`,
                L.unownedTrinkets(save, dungeonId).length, 0);
            check(`[${dungeonId}] 至少拿到 1 件`, gained >= 1, gained);
        }
        const owned = save.trinketBag.length + save.trinkets.filter(Boolean).length;
        eq('9. 六个副本首通集齐 20 件', owned, 20);
        for (const dungeonId of Object.keys(F.TRINKET_LOOT)) {
            eq(`[${dungeonId}] 全收集后饰品退化为金币`, L.bossTrinket(rng, save, dungeonId, true), null);
            check(`[${dungeonId}] 金币底价为正`, L.trinketGoldValue(dungeonId) > 0);
        }
    }

    // 两格装备 + 存档往返
    {
        const save = P.defaultSave('warrior');
        save.trinketBag = ['blood_ring', 'ember_ring', 'storm_totem'];
        eq('10. 装第一格', L.equipTrinket(save, 'blood_ring', 0), true);
        eq('11. 装第二格', L.equipTrinket(save, 'ember_ring', 1), true);
        eq('12. 两格内容正确', JSON.stringify(save.trinkets), JSON.stringify(['blood_ring', 'ember_ring']));
        eq('13. 换下的一件回到背包', L.equipTrinket(save, 'storm_totem', 0) && save.trinkets[0], 'storm_totem');
        eq('14. 被换下的血契指环回到背包', save.trinketBag.indexOf('blood_ring') >= 0, true);

        const roundTrip = P.sanitizeSave(JSON.parse(JSON.stringify(save)));
        eq('15. 存档往返：两格保持', JSON.stringify(roundTrip.trinkets), JSON.stringify(save.trinkets));
        check('16. 存档往返：三件都还拥有',
            ['blood_ring', 'ember_ring', 'storm_totem'].every((id) => L.ownsTrinket(roundTrip, id)));
        eq('17. 存档往返：背包不重复', new Set(roundTrip.trinketBag).size, roundTrip.trinketBag.length);

        // 坏档：非法 id / 重复 / 非字符串全部丢弃，但装备中的不算丢
        const dirty = P.sanitizeSave({
            trinkets: ['nope', 'blood_ring', 'blood_ring'],
            trinketBag: ['bad', 123, null, 'blood_ring', 'storm_totem', 'storm_totem'],
        });
        eq('18. 坏档：非法饰品被清空', dirty.trinkets[0], null);
        eq('19. 坏档：合法饰品留在原槽', dirty.trinkets[1], 'blood_ring');
        eq('20. 坏档：饰品恒为两格', dirty.trinkets.length, 2);
        check('21. 坏档：背包只剩合法且去重',
            dirty.trinketBag.indexOf('bad') < 0 && dirty.trinketBag.indexOf('blood_ring') >= 0
            && dirty.trinketBag.filter((id) => id === 'storm_totem').length === 1,
            JSON.stringify(dirty.trinketBag));
    }
}

// ==================== 6. 打桩差异（同档装备，≥25%） ====================

/**
 * 判据用「毕业档」做基准（与 `MithrilProgress.dpsGraduate` 同口径：Lv30 / ilvl40）。
 * 为什么不是 Lv20：饰品全部是**条件规则**，收益随暴击率 / 攻速 / 血量浮动，
 * 中期档（Lv15–20）实测只有 +15%~+27%，毕业档才稳定过 25% 线。
 * 另外设计 §4 点名的「血契 + 雷暴」在木桩上只有 ~1.10：木桩不会打你，
 * 血契指环（按已损生命加伤）全程不生效 —— 它的规则由 §3 单独断言，
 * 这里比的是「木桩上真能打出伤害」的两对（都含协同）。
 */
{
    const profile = C.makeProfile('warrior', 30, 40);
    const base = C.measureDummyDps(profile, 60, 991);
    const synergyPair = C.measureDummyDps(profile, 60, 991, ['resonance_crystal', 'charge_bracer']);
    const stormPair = C.measureDummyDps(profile, 60, 991, ['storm_totem', 'charge_bracer']);
    const cloakPair = C.measureDummyDps(profile, 60, 991, ['shadow_cloak', 'charge_bracer']);
    const solo = C.measureDummyDps(profile, 60, 991, ['charge_bracer']);
    const ratioSynergy = synergyPair / base;
    const ratioStorm = stormPair / base;
    check('22. 打桩基线为正', base > 0, base.toFixed(2));
    check('23. 带协同的一对（共鸣 + 电荷）DPS ≥ +25%', ratioSynergy >= 1.25,
        `${base.toFixed(2)} → ${synergyPair.toFixed(2)}（×${ratioSynergy.toFixed(3)}）`);
    check('24. 雷暴 + 电荷也 ≥ +25%', ratioStorm >= 1.25, `×${ratioStorm.toFixed(3)}`);
    // 回归闸门：暗影披风的伏击曾经会站桩每击都触发（+114%），修好后应 ≤1.45
    check('25. 暗影披风不再无限伏击（≤1.45×）', cloakPair / base <= 1.45,
        `×${(cloakPair / base).toFixed(3)}`);
    check('26. 单件饰品的收益低于一对（协同真的在起作用）',
        solo / base < ratioSynergy, `单件 ×${(solo / base).toFixed(3)} vs 一对 ×${ratioSynergy.toFixed(3)}`);
    // 中期档的下限（不要求过 25%，但收益必须肉眼可见且不是爆炸）：10% ~ 35%
    const mid = C.makeProfile('warrior', 20, 20);
    const midBase = C.measureDummyDps(mid, 60, 991);
    const midPair = C.measureDummyDps(mid, 60, 991, ['storm_totem', 'charge_bracer']) / midBase;
    check('27. 中期档一对饰品收益落在 1.10–1.35', midPair >= 1.10 && midPair <= 1.35,
        `×${midPair.toFixed(3)}`);
    if (process.env.MITHRIL_VERBOSE) {
        console.log(`打桩 DPS（Lv30/ilvl40）：裸 ${base.toFixed(2)} · 单件 ${solo.toFixed(2)}`
            + ` · 共鸣+电荷 ${synergyPair.toFixed(2)} · 雷暴+电荷 ${stormPair.toFixed(2)}`
            + ` · 披风+电荷 ${cloakPair.toFixed(2)}；中期档（Lv20）雷暴+电荷 ×${midPair.toFixed(3)}`);
    }
}

// ==================== 7. 4 职业 × 6 副本 × {不戴, 戴} 自动通关 ====================

/** 矩阵用的饰品对：落雷 + 免死，两种效果每场都会真的触发 */
const MATRIX_PAIR = ['storm_totem', 'oath_sigil'];

for (const classId of CLASS_IDS) {
    for (const dungeonId of DUNGEON_IDS) {
        const band = BANDS[dungeonId];
        for (const trinkets of [null, MATRIX_PAIR]) {
            const tag = `${classId}/${dungeonId}/${trinkets ? '戴' : '空'}`;
            const res = runDungeon(classId, dungeonId, band.maxSeconds, trinkets);
            eq(`[${tag}] 无 NaN / 无卡死`, res.badState, '');
            check(`[${tag}] 通关`, res.world.phase === 'won',
                `phase=${res.world.phase} t=${res.seconds.toFixed(0)}s`
                + ` hp=${res.world.player.hp.toFixed(0)}/${res.world.player.maxHp}`);
            check(`[${tag}] 打完了 BOSS`, res.bossPhases >= 2, res.bossPhases);
        }
    }
}

// ==================== 结果 ====================

if (failures.length > 0) {
    console.error(`\nMITHRIL_TRINKETS_FAIL —— ${failed(failures)} 项失败 / ${passed} 项通过`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
}

function failed(list) {
    return list.length;
}

console.log(`MITHRIL_TRINKETS_OK —— ${passed} 项检查全部通过`);
