#!/usr/bin/env node
/**
 * 雷霆战机纯逻辑自检（不启动 Cocos 编辑器）。
 *
 * 用法：node tools/verify-thunder-core.js
 * 通过时打印 THUNDER_CORE_OK；失败时逐条打印并以退出码 1 结束。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CORE = path.join(ROOT, 'assets/games/game_thunder/scripts/ThunderCore.ts');

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

function loadCore() {
    const tsc = findTsc();
    if (!tsc) {
        console.error('找不到 tsc：设置 $TSC 或安装 typescript');
        process.exit(2);
    }
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-core-'));
    execFileSync(process.execPath, [
        tsc,
        CORE,
        '--outDir', outDir,
        '--target', 'ES2019',
        '--module', 'commonjs',
        '--skipLibCheck',
        '--strict', 'false',
    ], { stdio: 'inherit' });
    return require(path.join(outDir, 'ThunderCore.js'));
}

const T = loadCore();

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

function freshSave(coins = 0) {
    const s = T.defaultSave();
    s.coins = coins;
    return s;
}

function statsFor(upgrades = {}) {
    const s = T.defaultSave();
    Object.assign(s.upgrades, upgrades);
    return T.playerStats(s);
}

function runWorld(world, seconds, dt = 1 / 60) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) world.update(dt);
}

function aliveEnemies(world) {
    return world.enemies.length;
}

// ==================== 1. 关卡表 ====================

check('关卡数量为 10', T.THUNDER_LEVELS.length === 10);
check('关卡 index 连续', T.THUNDER_LEVELS.every((lv, i) => lv.index === i));
check('每关至少 2 个波次', T.THUNDER_LEVELS.every((lv) => lv.waves.length >= 2));
check('每关最后一波是 Boss', T.THUNDER_LEVELS.every((lv) => lv.waves[lv.waves.length - 1].boss === true));
check('Boss 类型与关卡字段一致', T.THUNDER_LEVELS.every((lv) => {
    const last = lv.waves[lv.waves.length - 1];
    return last.entries.length === 1 && last.entries[0].kind === lv.boss;
}));
check('Boss HP 随关卡单调不减', T.THUNDER_LEVELS.every((lv, i) => i === 0 || lv.bossHp >= T.THUNDER_LEVELS[i - 1].bossHp));
check('推荐武器等级单调不减', T.THUNDER_LEVELS.every((lv, i) => i === 0 || lv.recommendAttack >= T.THUNDER_LEVELS[i - 1].recommendAttack));
check('所有波次都有敌人', T.THUNDER_LEVELS.every((lv) => lv.waves.every((w) => w.entries.length > 0)));
check('所有生成点 x 在场地内', T.THUNDER_LEVELS.every((lv) =>
    lv.waves.every((w) => w.entries.every((e) => e.x >= 0 && e.x <= T.FIELD_W))));
check('BOSS 波只有一个 Boss', T.THUNDER_LEVELS.every((lv) =>
    lv.waves.filter((w) => w.boss).every((w) => w.entries.length === 1 && T.isBossKind(w.entries[0].kind))));

// ==================== 2. 存档 / 养成 ====================

const def = T.defaultSave();
check('默认存档字段齐全', def.v === 1 && def.coins === 0 && def.stars.length === 10 && def.bestScore.length === 10);
check('默认存档四条升级线为 0', Object.values(def.upgrades).every((v) => v === 0));

check('坏档 null 回落', JSON.stringify(T.sanitizeSave(null)) === JSON.stringify(def));
check('坏档非对象回落', JSON.stringify(T.sanitizeSave('oops')) === JSON.stringify(def));
check('坏档 NaN / 负数 / 超限全部回落', (() => {
    const s = T.sanitizeSave({
        coins: NaN,
        upgrades: { attack: -5, armor: 999, wing: Infinity, bomb: 1.7 },
        stars: [9, -1, NaN, 2],
        bestScore: [NaN, -3, 120],
    });
    return s.coins === 0 && s.upgrades.attack === 0 && s.upgrades.armor === 4
        && s.upgrades.wing === 0 && s.upgrades.bomb === 1
        && s.stars[0] === 3 && s.stars[1] === 0 && s.stars[2] === 0 && s.stars[3] === 2
        && s.stars.length === 10 && s.bestScore[0] === 0 && s.bestScore[1] === 0 && s.bestScore[2] === 120;
})());
check('数组长度错误补足 10', (() => {
    const s = T.sanitizeSave({ stars: [1], bestScore: [] });
    return s.stars.length === 10 && s.stars[0] === 1 && s.stars[9] === 0 && s.bestScore.length === 10;
})());

check('升级费用单调递增', (() => {
    for (const track of ['attack', 'armor', 'wing', 'bomb']) {
        let prev = -1;
        for (let lv = 0; lv < T.MAX_UPGRADE[track]; lv++) {
            const c = T.upgradeCost(track, lv);
            if (!(c > prev)) return false;
            prev = c;
        }
        if (T.upgradeCost(track, T.MAX_UPGRADE[track]) !== Infinity) return false;
    }
    return true;
})());

check('升级：金币不足失败', (() => {
    const s = freshSave(0);
    return T.applyUpgrade(s, 'attack') === false && s.coins === 0 && s.upgrades.attack === 0;
})());
check('升级：成功扣款并 +1', (() => {
    const s = freshSave(1000);
    const cost = T.upgradeCost('attack', 0);
    return T.applyUpgrade(s, 'attack') === true && s.upgrades.attack === 1 && s.coins === 1000 - cost;
})());
check('升级：满级后失败且不扣款', (() => {
    const s = freshSave(1e9);
    s.upgrades.attack = T.MAX_UPGRADE.attack;
    const before = s.coins;
    return T.applyUpgrade(s, 'attack') === false && s.coins === before && s.upgrades.attack === T.MAX_UPGRADE.attack;
})());

check('属性推导：初始 2 伤害 / 3 命 / 无僚机 / 1 炸弹', (() => {
    const st = T.playerStats(T.defaultSave());
    return st.damage === 2 && st.maxLives === 3 && st.wingCount === 0 && st.bombCapacity === 1;
})());
check('属性推导：满级四条线', (() => {
    const st = statsFor({ attack: 9, armor: 4, wing: 3, bomb: 2 });
    return st.damage === 11 && st.maxLives === 7 && st.wingCount === 4 && st.wingRatio === 0.7 && st.bombCapacity === 3;
})());
check('属性推导：僚机三档数量', (() => {
    return statsFor({ wing: 0 }).wingCount === 0
        && statsFor({ wing: 1 }).wingCount === 2
        && statsFor({ wing: 2 }).wingCount === 2
        && statsFor({ wing: 3 }).wingCount === 4;
})());

// ==================== 3. 星级 / 奖励 ====================

check('星级：失败 0 星', T.starsFor(false, false, false) === 0);
check('星级：通关 3 星', T.starsFor(true, false, false) === 3);
check('星级：用炸弹 2 星', T.starsFor(true, false, true) === 2);
check('星级：用复活 1 星（即使没用炸弹）', T.starsFor(true, true, false) === 1);
check('通关奖励随关卡递增', (() => {
    for (let i = 1; i < 10; i++) {
        if (T.clearReward(i, 1).clearCoins <= T.clearReward(i - 1, 1).clearCoins) return false;
    }
    return true;
})());
check('星级奖励：1★ 0 / 2★ 20 / 3★ 40', (() => {
    return T.clearReward(0, 1).starCoins === 0
        && T.clearReward(0, 2).starCoins === 20
        && T.clearReward(0, 3).starCoins === 40;
})());
check('失败无通关奖励', T.clearReward(0, 0).clearCoins === 0 && T.clearReward(0, 0).starCoins === 0);

// ==================== 4. 世界基础 ====================

const baseStats = T.playerStats(T.defaultSave());
let w = new T.ThunderWorld(0, baseStats);
check('开局位置正确', w.playerX === 360 && w.playerY === 1090);
check('开局生命 = 装甲上限', w.lives === 3);
check('开局炸弹 = 容量', w.bombs === 1);
check('开局火力 1', w.power === 1);
check('开局 phase = playing', w.phase === 'playing');

w.movePlayerTo(-500, -500);
check('边界夹取（左上）', w.playerX === T.PLAYER_MIN_X && w.playerY === T.PLAYER_MIN_Y);
w.movePlayerTo(9999, 9999);
check('边界夹取（右下）', w.playerX === T.PLAYER_MAX_X && w.playerY === T.PLAYER_MAX_Y);

// ==================== 5. 开火 / 僚机 ====================

check('火力 1–5 齐射弹数', (() => {
    const expected = [1, 2, 3, 4, 5];
    for (let p = 1; p <= 5; p++) {
        const ww = new T.ThunderWorld(0, baseStats);
        ww.power = p;
        ww.playerFireT = 0;
        ww.update(1 / 60);
        if (ww.playerBullets.length !== expected[p - 1]) return false;
    }
    return true;
})());

check('僚机等级决定僚机弹数', (() => {
    const counts = [0, 2, 2, 4];
    for (let lv = 0; lv < 4; lv++) {
        const st = statsFor({ wing: lv });
        const ww = new T.ThunderWorld(0, st);
        ww.wingFireT = 0;
        ww.playerFireT = 1e9; // 屏蔽主机开火
        ww.update(1 / 60);
        if (ww.playerBullets.length !== counts[lv]) return false;
    }
    return true;
})());

check('子弹伤害 = 武器伤害', (() => {
    const st = statsFor({ attack: 5 });
    const ww = new T.ThunderWorld(0, st);
    ww.playerFireT = 0;
    ww.update(1 / 60);
    return ww.playerBullets.every((b) => b.dmg === 7);
})());

check('僚机伤害 = floor(主机伤害 × 比例) 且至少 1', (() => {
    const st = statsFor({ attack: 0, wing: 1 });
    const ww = new T.ThunderWorld(0, st);
    ww.wingFireT = 0;
    ww.playerFireT = 1e9;
    ww.update(1 / 60);
    return ww.playerBullets.every((b) => b.dmg === 1);
})());

// ==================== 6. 护盾 / 炸弹 / 复活 ====================

check('护盾吸收一次伤害且不掉命', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.shields = 1;
    w.playerInvuln = 0;
    w._hitPlayer();
    return w.lives === 3 && w.shields === 0 && near(w.playerInvuln, T.SHIELD_INVULN);
})());
check('无敌期间不再掉命', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.playerInvuln = 1;
    w._hitPlayer();
    return w.lives === 3;
})());
check('无护盾中弹掉 1 命并进入无敌', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.playerInvuln = 0;
    w._hitPlayer();
    return w.lives === 2 && near(w.playerInvuln, T.INVULN_TIME);
})());

check('炸弹清屏 + 全场伤害 + 消耗存量 + 无敌', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.enemyBullets.push({ x: 100, y: 100, vx: 0, vy: 0, r: 7, side: 'e', dmg: 1 });
    w.enemies.push({
        id: 1, kind: 'grunt', x: 200, y: 300, baseX: 200, vx: 0,
        hp: 100, maxHp: 100, radius: 18, mode: 'straight', t: 0, fireT: 9, shotIndex: 0, arrived: true,
    });
    const ok = w.useBomb();
    const e = w.enemies[0];
    return ok && w.bombs === 0 && w.enemyBullets.length === 0 && w.usedBomb
        && near(w.playerInvuln, T.BOMB_INVULN)
        && (!e || e.hp === 100 - w.bombDamage);
})());
check('炸弹存量 0 时不可用', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.bombs = 0;
    return w.useBomb() === false && w.usedBomb === false;
})());

check('复活：恢复 2 命、清屏、无敌、仅一次', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.lives = 0;
    w.phase = 'revive';
    w.enemyBullets.push({ x: 1, y: 1, vx: 0, vy: 0, r: 7, side: 'e', dmg: 1 });
    const ok = w.revive();
    const first = w.lives === T.REVIVE_LIVES && w.enemyBullets.length === 0
        && w.phase === 'playing' && w.usedRevive && !w.reviveAvailable
        && near(w.playerInvuln, T.REVIVE_INVULN);
    w.lives = 0;
    w.phase = 'revive';
    const second = w.revive();
    return ok && first && second === false;
})());
check('放弃复活 → 失败', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.phase = 'revive';
    w.declineRevive();
    return w.phase === 'lost';
})());

// ==================== 7. 波次 / 战斗 / 胜负 ====================

check('第一波按时生成敌人', (() => {
    w = new T.ThunderWorld(0, baseStats);
    runWorld(w, 0.6);
    return aliveEnemies(w) > 0 && w.waveIndex === 0;
})());

check('清空一波后进入下一波', (() => {
    w = new T.ThunderWorld(0, baseStats);
    runWorld(w, 0.6);
    // 直接把当前波所有敌人清掉，并等待波间隔
    w.enemies.length = 0;
    w.entryIndex = w.level.waves[w.waveIndex].entries.length;
    runWorld(w, T.WAVE_GAP + 0.2);
    return w.waveIndex === 1;
})());

check('Boss 在最后一波就位', (() => {
    w = new T.ThunderWorld(0, baseStats);
    const last = w.level.waves.length - 1;
    w.waveIndex = last;
    w.waveTime = 0;
    w.entryIndex = 0;
    w.waveClearT = 0;
    runWorld(w, 3.5);
    const boss = w.boss;
    return !!boss && boss.arrived && near(boss.y, 240);
})());

check('击沉 Boss → phase = won', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.waveIndex = w.level.waves.length - 1;
    w.waveTime = 999;
    w.entryIndex = w.level.waves[w.waveIndex].entries.length;
    // 通过正规途径生成 Boss
    w.waveTime = 0;
    w.entryIndex = 0;
    runWorld(w, 2.2);
    const boss = w.boss;
    if (!boss) return false;
    boss.hp = 1;
    w.playerX = boss.x;
    w.playerY = boss.y + 80;
    w.playerFireT = 0;
    w.playerInvuln = 999;
    runWorld(w, 3);
    return w.phase === 'won';
})());

check('生命归零且复活已用 → lost', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.reviveAvailable = false;
    w.lives = 1;
    w.playerInvuln = 0;
    w._hitPlayer();
    return w.phase === 'lost' && w.lives === 0;
})());

check('分数单调不减', (() => {
    w = new T.ThunderWorld(0, baseStats);
    let prev = 0;
    for (let i = 0; i < 600; i++) {
        w.update(1 / 60);
        if (w.score < prev) return false;
        prev = w.score;
    }
    return true;
})());

// ==================== 8. 道具掉落 ====================

check('每 10 杀掉火力、20 杀掉炸弹、35 杀掉护盾', (() => {
    const drops = { power: 0, bomb: 0, shield: 0 };
    for (let kills = 1; kills <= 40; kills++) {
        w = new T.ThunderWorld(0, baseStats);
        w.kills = kills;
        w.powerups = [];
        w._maybeDrop(360, 300);
        for (const u of w.powerups) drops[u.kind]++;
    }
    return drops.power === 4 && drops.bomb === 2 && drops.shield === 1;
})());

check('拾取火力封顶 5', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.power = 5;
    w._pickup('power');
    return w.power === 5;
})());
check('拾取炸弹封顶容量', (() => {
    w = new T.ThunderWorld(0, statsFor({ bomb: 1 }));
    w.bombs = 2;
    w._pickup('bomb');
    return w.bombs === 2;
})());
check('拾取护盾封顶 1', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.shields = 1;
    w._pickup('shield');
    return w.shields === 1;
})());

// ==================== 9. 确定性与长跑 ====================

check('同一输入序列两次运行结果一致', (() => {
    function sim() {
        const ww = new T.ThunderWorld(2, statsFor({ attack: 2, wing: 1 }));
        ww.playerInvuln = 1e9; // 不因中弹改变轨迹
        const out = [];
        for (let i = 0; i < 1800; i++) {
            ww.movePlayerTo(200 + Math.sin(i / 40) * 120, 1000);
            ww.update(1 / 60);
            if (i % 60 === 0) out.push([ww.score, ww.kills, ww.enemies.length, ww.playerBullets.length]);
        }
        out.push([ww.phase, ww.waveIndex, ww.playerX, ww.playerY]);
        return JSON.stringify(out);
    }
    return sim() === sim();
})());

check('10 分钟长跑无 NaN / Infinity', (() => {
    w = new T.ThunderWorld(9, statsFor({ attack: 9, armor: 4, wing: 3, bomb: 2 }));
    w.playerInvuln = 1e9;
    let ok = true;
    for (let i = 0; i < 600 * 60; i++) {
        w.movePlayerTo(360 + Math.sin(i / 50) * 250, 1000 + Math.cos(i / 70) * 120);
        w.update(1 / 60);
        if (!Number.isFinite(w.score) || !Number.isFinite(w.coinsEarned)
            || !Number.isFinite(w.playerX) || !Number.isFinite(w.playerY)) {
            ok = false;
            break;
        }
        if (w.playerBullets.length > T.MAX_BULLETS + 20 || w.enemyBullets.length > T.MAX_BULLETS + 20) {
            ok = false;
            break;
        }
        if (w.phase !== 'playing') break;
    }
    return ok;
})());

check('自动驾驶 120 秒内打通第 1 关', (() => {
    w = new T.ThunderWorld(0, statsFor({ attack: 9, armor: 4, wing: 3 }));
    w.playerInvuln = 1e9;
    const steps = 120 * 60;
    for (let i = 0; i < steps; i++) {
        const boss = w.boss;
        if (boss) {
            w.movePlayerTo(boss.x, Math.min(T.PLAYER_MAX_Y, boss.y + 80));
        } else {
            const target = w.enemies[0];
            w.movePlayerTo(target ? target.x : 360, 1000);
        }
        w.update(1 / 60);
        if (w.phase !== 'playing') break;
    }
    return w.phase === 'won';
})());

check('1,000 次随机升级购买不产生坏值', (() => {
    const s = freshSave(1e6);
    let seed = 123456789;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const tracks = ['attack', 'armor', 'wing', 'bomb'];
    for (let i = 0; i < 1000; i++) {
        T.applyUpgrade(s, tracks[Math.floor(rand() * 4)]);
        if (!Number.isFinite(s.coins) || s.coins < 0) return false;
        for (const t of tracks) {
            const lv = s.upgrades[t];
            if (!Number.isInteger(lv) || lv < 0 || lv > T.MAX_UPGRADE[t]) return false;
        }
    }
    return true;
})());

check('存档 JSON 往返一致', (() => {
    const s = freshSave(4321);
    s.upgrades.attack = 3;
    s.stars[0] = 3;
    s.bestScore[4] = 8899;
    const round = T.sanitizeSave(JSON.parse(JSON.stringify(s)));
    return JSON.stringify(round) === JSON.stringify(s);
})());

check('敌人飞出屏幕底部后被回收', (() => {
    w = new T.ThunderWorld(0, baseStats);
    w.waveTime = -999; // 本帧不生成新怪，只验证回收
    w.enemies.push({
        id: 1, kind: 'grunt', x: 100, y: T.FIELD_H + 79, baseX: 100, vx: 0,
        hp: 1, maxHp: 1, radius: 18, mode: 'straight', t: 0, fireT: 0, shotIndex: 0, arrived: true,
    });
    w.update(1 / 60);
    return w.enemies.length === 0;
})());

// ==================== 汇总 ====================

console.log('');
console.log(`雷霆战机自检：${passed} 项通过 / ${failed} 项失败`);
if (failed > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
}
console.log('THUNDER_CORE_OK');
