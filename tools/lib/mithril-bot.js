'use strict';
/**
 * 《秘银远征》自动玩家（无头试玩机器人）——给 `verify-mithril-*.js` 复用。
 *
 * 为什么放在 lib 而不是各脚本里抄一份：这套「16 方向采样转向 + 躲预警圈 + 躲弹道 +
 * 低血吃球」的规则是被几十场试玩调出来的（见 docs/tech/playtest-cycle.md），
 * 抄一份就多一处漂移点；AGENTS.md 的教训就是这么来的。
 *
 * 用法：
 *   const { BANDS, runDungeon, botInput } = require('./lib/mithril-bot').createBot(F, C);
 *   const res = runDungeon('warrior', 'mine', BANDS.mine.maxSeconds, ['greed_eye', 'ember_ring']);
 *
 * `F` = 编译后的 MithrilConfig，`C` = 编译后的 MithrilCore（两个脚本的输出目录不同，
 * 所以由调用方传进来）。`trinkets` 省略 = 不戴饰品。
 */

module.exports = { createBot };

function createBot(F, C) {
    const IDLE = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
/**
 * 每个副本的进场配置：等级 / 装等 / 时限（秒）。
 * 时限按**最慢的职业**（法师 / 牧师 ≈ 战士 DPS 的 6 成）留 1.5 倍余量，
 * 这样「通关」既是平衡闸门，也不会因为职业差异把正确实现判死。
 */
const BANDS = {
    mine: { level: 5, ilvl: 6, maxSeconds: 320 },
    chapel: { level: 12, ilvl: 14, maxSeconds: 400 },
    tower: { level: 18, ilvl: 20, maxSeconds: 440 },
    forge: { level: 24, ilvl: 26, maxSeconds: 440 },
    shadow: { level: 28, ilvl: 31, maxSeconds: 480 },
    throne: { level: 30, ilvl: 37, maxSeconds: 520 },
};

/**
 * 通用自动玩家：4 职业共用（技能槽在核心层已按职业映射，这里只按 CD/资源按键）。
 * 位移类技能（法师闪现 / 游侠后跳）不当 DPS 键按 —— 乱按会把玩家送出射程。
 */
/**
 * 16 方向采样转向器：走出界 / 贴敌人身体 / 踩预警圈 / 迎着弹道 都会扣分。
 * 手写"往哪走"的规则在墙角 + BOSS 大身位下很容易把自己顶进 BOSS 怀里，
 * 采样打分能让它自己绕到侧翼。
 */
function pickMove(world, goalX, goalY, desiredDist) {
    const p = world.player;
    const margin = 70;
    const N = 16;
    let bestScore = -Infinity;
    let bx = 0;
    let by = 0;
    for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const qx = p.x + dx * 110;
        const qy = p.y + dy * 110;
        let score = 0;
        const out = Math.max(0, margin - qx) + Math.max(0, qx - (F.FIELD_W - margin))
            + Math.max(0, margin - qy) + Math.max(0, qy - (F.FIELD_H - margin));
        score -= out * 12;
        score -= Math.abs(Math.hypot(goalX - qx, goalY - qy) - desiredDist) * 0.9;
        for (const e of world.enemies) {
            const ed = Math.hypot(e.x - qx, e.y - qy);
            if (ed < e.radius + 62) score -= (e.radius + 62 - ed) * 2.2;
        }
        for (const t of world.telegraphs) {
            if (t.done) continue;
            const td = Math.hypot(t.x - qx, t.y - qy);
            if (td < t.radius + 34) score -= (t.radius + 34 - td) * 2.5;
        }
        for (const b of world.bullets) {
            if (b.owner !== 'enemy') continue;
            const bd = Math.hypot(b.x - qx, b.y - qy);
            if (bd < 90) score -= (90 - bd) * 1.6;
        }
        score -= Math.hypot(qx - F.FIELD_W / 2, qy - F.FIELD_H / 2) * 0.05;
        if (score > bestScore) {
            bestScore = score;
            bx = dx;
            by = dy;
        }
    }
    return { x: bx, y: by };
}

function botInput(world) {
    const p = world.player;
    if (world.phase !== 'playing') return IDLE;
    const classId = world.profile.classId;
    const isMelee = classId === 'warrior';
    const addsId = world.plan && world.plan.boss ? world.plan.boss.addsEnemyId : '';
    const addsPhase = world.plan && world.plan.boss
        ? world.plan.boss.phases.findIndex((ph) => ph.mechanic === 'adds')
        : -1;

    let target = null;
    let best = Infinity;
    for (const e of world.enemies) {
        let score = Math.hypot(e.x - p.x, e.y - p.y);
        if (addsPhase >= 0 && world.bossPhase === addsPhase && e.kind === addsId) score -= 2000;
        if (score < best) {
            best = score;
            target = e;
        }
    }

    let mx = 0;
    let my = 0;
    let aimX = 0;
    let aimY = 0;

    // 预警圈：优先走出范围
    let danger = null;
    for (const t of world.telegraphs) {
        if (t.done) continue;
        if (Math.hypot(p.x - t.x, p.y - t.y) < t.radius + 26) {
            danger = t;
            break;
        }
    }

    // 迎着面飞来的弹道：侧向闪
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
    if (p.hp / p.maxHp < 0.72) {
        for (const o of world.orbs) {
            const dist = Math.hypot(o.x - p.x, o.y - p.y);
            if (dist < 420 && dist < orbDist) {
                orbDist = dist;
                orb = o;
            }
        }
    }

    // 决策：先躲预警圈，再躲弹道，再补血球，最后才是走位输出
    let goalX = 0;
    let goalY = 0;
    let desired = 0;
    let hasGoal = false;
    if (danger) {
        // 往"预警圈圆心的反方向"跑，具体方向交给转向器挑
        goalX = p.x - (danger.x - p.x);
        goalY = p.y - (danger.y - p.y);
        hasGoal = true;
    } else if (bullet) {
        const vl = Math.hypot(bullet.vx, bullet.vy) || 1;
        goalX = p.x - bullet.vy / vl * 150;
        goalY = p.y + bullet.vx / vl * 150;
        hasGoal = true;
    } else if (orb) {
        goalX = orb.x;
        goalY = orb.y;
        hasGoal = true;
    } else if (target) {
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const dist = Math.hypot(dx, dy) || 1;
        aimX = dx / dist;
        aimY = dy / dist;
        // 近战贴身，远程拉开：法师 / 游侠 / 牧师按弹道射程站桩输出
        goalX = target.x;
        goalY = target.y;
        desired = target.isBoss ? (isMelee ? 140 : 190) : (isMelee ? 82 : 150);
        hasGoal = true;
    }
    if (hasGoal) {
        const dir = pickMove(world, goalX, goalY, desired);
        mx = dir.x;
        my = dir.y;
    }

    const distToTarget = target ? best : 9999;
    const attackRange = target && target.isBoss ? (isMelee ? 170 : 420) : (isMelee ? 130 : 420);
    const lowHp = p.hp / p.maxHp < 0.75;
    return {
        moveX: mx,
        moveY: my,
        aimX,
        aimY,
        basic: distToTarget < attackRange,
        // 冲锋是位移技能，别在预警圈里往火里冲
        skill1: !danger && p.cd.charge <= 0 && (classId !== 'priest' || lowHp),
        // 旋涡 / 新星 / 陷阱都是近身范围技，离太远按了也白按
        skill2: !danger && p.cd.whirlwind <= 0 && distToTarget < 160,
        // 槽位 3：战士破甲 / 牧师护盾算输出循环；游侠后跳只在"血真的见底 + 有落点预警"时保命，
        // 平时按会把身位拉开、白掉大段输出（实测按得越勤 DPS 越低）；法师闪现是正面突进，不按
        skill3: classId === 'ranger'
            ? (!!danger && p.hp / p.maxHp < 0.45) && p.cd.armorBreak <= 0
            : (classId === 'warrior' || classId === 'priest') && p.cd.armorBreak <= 0,
        burst: p.cd.burst <= 0,
        dodge: (!!danger || (!!bullet && bulletDist < 65)) && p.cd.dodge <= 0,
    };
}

function runDungeon(classId, dungeonId, seconds, trinkets) {
    const band = BANDS[dungeonId];
    const world = new C.MithrilWorld(
        C.makeProfile(classId, band.level, band.ilvl),
        9000 + dungeonId.length * 31 + classId.length,
        trinkets || null,
    );
    world.startDungeon(dungeonId);
    const maxSteps = Math.round(seconds / F.FIXED_DT);
    const seen = new Set();
    const addsId = world.plan && world.plan.boss ? world.plan.boss.addsEnemyId : '';
    let steps = 0;
    let badState = '';
    let bossPhases = 0;
    let minHp = 1;
    let sawAdds = false;
    let sawTelegraph = false;
    while (world.phase === 'playing' && steps < maxSteps) {
        world.step(F.FIXED_DT, botInput(world));
        for (const ev of world.drainEvents()) {
            if (ev.type === 'phase') {
                seen.add(`phase${ev.phase}`);
                bossPhases = Math.max(bossPhases, ev.phase);
            } else if (ev.type === 'castStart') seen.add('cast');
            else if (ev.type === 'castEnd') seen.add(ev.interrupted ? 'interrupt' : 'enrage');
            else if (ev.type === 'regen') seen.add('regen');
            else if (ev.type === 'boom') seen.add('boom');
        }
        if (process.env.MITHRIL_TRACE && steps % 300 === 0) {
            const pl = world.player;
            const nearest = world.enemies.reduce(
                (m, e) => Math.min(m, Math.hypot(e.x - pl.x, e.y - pl.y)), 9999);
            const bossNow = world.boss
                ? `${(world.boss.hp / world.boss.maxHp * 100).toFixed(0)}%p${world.bossPhase}` : '-';
            console.log(
                `  ${classId}/${dungeonId} t=${(steps * F.FIXED_DT).toFixed(0)}s ${world.stage}#${world.encounterIndex}` +
                ` hp=${pl.hp.toFixed(0)}/${pl.maxHp} boss=${bossNow} enemies=${world.enemies.length}` +
                ` nearest=${nearest.toFixed(0)} orbs=${world.orbs.length} shielding=${pl.shield.toFixed(0)}`,
            );
        }
        if (world.telegraphs.length > 0) sawTelegraph = true;
        if (addsId) {
            for (const en of world.enemies) {
                if (en.kind === addsId) {
                    sawAdds = true;
                    break;
                }
            }
        }
        steps++;
        // 每 30 帧抽查一次数值健康度：NaN 会静默污染整局
        if (steps % 30 === 0) {
            const pl = world.player;
            if (!Number.isFinite(pl.hp) || !Number.isFinite(pl.x) || !Number.isFinite(pl.y)) {
                badState = `player ${pl.hp}/${pl.x},${pl.y}`;
                break;
            }
            if (pl.hp > pl.maxHp + 0.001 || pl.hp < 0) {
                badState = `player hp 越界 ${pl.hp}/${pl.maxHp}`;
                break;
            }
            for (const en of world.enemies) {
                if (!Number.isFinite(en.hp) || en.hp > en.maxHp + 0.001) {
                    badState = `enemy ${en.kind} ${en.hp}/${en.maxHp}`;
                    break;
                }
            }
            if (badState) break;
            minHp = Math.min(minHp, pl.hp / pl.maxHp);
        }
    }
    return {
        world,
        seconds: steps * F.FIXED_DT,
        seen,
        badState,
        bossPhases,
        minHp,
        sawAdds,
        sawTelegraph,
        plan: F.dungeonRunPlan(dungeonId),
    };
}
    return { BANDS, botInput, pickMove, runDungeon, IDLE };
}
