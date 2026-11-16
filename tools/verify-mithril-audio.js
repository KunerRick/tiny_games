#!/usr/bin/env node
/**
 * 《秘银远征》音效 / 震动 —— 自检（不启动 Cocos，不需要音频资源）。
 *
 * M10 覆盖：
 *  1. 事件映射表（纯模块 `MithrilAudioMap.ts`）：该响的 13 条 + 该静默的 7 类逐条断言
 *  2. 共享总线契约（`common/audio/GameAudio.ts`）：每个用到的音效名都在 `SPECS` 里有配方
 *     （`play()` 收到未知名字会静默 —— 拼错是本模块最容易漏的一类 bug）；
 *     震动分级（受伤 medium / 通关 heavy / 阵亡 long）真的挂在对应配方上
 *  3. 工程约束：零音频资源、没有变体选择符、偏好键前缀、开关是命名 handler 且能解绑
 *
 * 用法：node tools/verify-mithril-audio.js
 * 通过时打印 MITHRIL_AUDIO_OK；失败逐条打印并以退出码 1 结束。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, runTsc } = require('./lib/core-compile');

const SRC_DIR = path.join(ROOT, 'assets', 'games', 'game_mithril', 'scripts');
const MAP_SRC = path.join(SRC_DIR, 'MithrilAudioMap.ts');
const AUDIO_SRC = path.join(SRC_DIR, 'MithrilAudio.ts');
const GAME_SRC = path.join(SRC_DIR, 'MithrilGame.ts');
const BUS_SRC = path.join(ROOT, 'assets', 'common', 'audio', 'GameAudio.ts');
const OUT = path.join(ROOT, 'temp', 'mithril-audio-test');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
    if (cond) {
        passed++;
        return;
    }
    failures.push(detail ? `${name} —— ${detail}` : name);
}
function eq(name, actual, expected) {
    check(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ---------- 1. 纯映射表：零依赖 ----------
const mapRaw = fs.readFileSync(MAP_SRC, 'utf8');
const mapCode = stripComments(mapRaw);
check('001 MithrilAudioMap 不 import 任何模块（可在 Node 里编译）',
    !/\bimport\b/.test(mapCode) && !/\brequire\s*\(/.test(mapCode));
check('002 MithrilAudioMap 不依赖 cc / 随机 / 时间',
    !/\bcc\b/.test(mapCode) && !/Math\.random|Date\.now/.test(mapCode));

fs.rmSync(OUT, { recursive: true, force: true });
console.log(`编译纯映射表 → ${path.relative(ROOT, OUT)}`);
runTsc([
    MAP_SRC,
    '--outDir', OUT,
    '--rootDir', SRC_DIR,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
]);

const M = require(path.join(OUT, 'MithrilAudioMap.js'));
const sfxOf = (ev) => M.coreEventSfx(ev);

// 该响的
eq('010 damage(enemy) → hit', sfxOf({ type: 'damage', target: 'enemy' }), 'hit');
eq('011 damage(player) → playerHit', sfxOf({ type: 'damage', target: 'player' }), 'playerHit');
eq('012 kill → kill', sfxOf({ type: 'kill' }), 'kill');
eq('013 heal → pickup', sfxOf({ type: 'heal' }), 'pickup');
eq('014 boom → boom', sfxOf({ type: 'boom' }), 'boom');
eq('015 blast → boom', sfxOf({ type: 'blast' }), 'boom');
eq('016 lightning → secret', sfxOf({ type: 'lightning' }), 'secret');
eq('017 phase → core', sfxOf({ type: 'phase' }), 'core');
eq('018 enrage → active', sfxOf({ type: 'enrage' }), 'active');
eq('019 stage(boss) → active', sfxOf({ type: 'stage', stage: 'boss' }), 'active');
eq('020 stage(cleared) → clear', sfxOf({ type: 'stage', stage: 'cleared' }), 'clear');

// 该静默的
const SILENT = [
    ['damage 无 target', { type: 'damage' }],
    ['stage(encounter)', { type: 'stage', stage: 'encounter' }],
    ['swing', { type: 'swing' }],
    ['whirl', { type: 'whirl' }],
    ['charge', { type: 'charge' }],
    ['dodge', { type: 'dodge' }],
    ['castStart', { type: 'castStart' }],
    ['castEnd', { type: 'castEnd' }],
    ['regen', { type: 'regen' }],
    ['未知事件', { type: 'not-a-real-event' }],
];
for (let i = 0; i < SILENT.length; i++) {
    const [name, ev] = SILENT[i];
    eq(`03${i} ${name} → 静默`, sfxOf(ev), null);
}
eq('040 空事件 → 静默', sfxOf(null), null);
eq('041 无 type 字段 → 静默', sfxOf({ target: 'enemy' }), null);

const MAPPED_NAMES = Array.from(new Set([
    'hit', 'playerHit', 'kill', 'pickup', 'boom', 'secret', 'core', 'clear', 'active',
]));

// ---------- 2. 共享总线契约 ----------
const busRaw = fs.readFileSync(BUS_SRC, 'utf8');
const busCode = stripComments(busRaw);

// 2.1 SfxName 联合类型里的全部名字
const unionMatch = busCode.match(/export type SfxName\s*=([\s\S]*?);/);
check('050 能解析 GameAudio 的 SfxName 联合类型', !!unionMatch);
const sfxNames = unionMatch ? Array.from(unionMatch[1].matchAll(/'([^']+)'/g)).map((m) => m[1]) : [];

// 2.2 SPECS 表逐项切片（顶层 4 空格缩进的 key）
const specsAt = busCode.indexOf('const SPECS');
const braceAt = specsAt >= 0 ? busCode.indexOf('{', specsAt) : -1;
const endAt = braceAt >= 0 ? busCode.indexOf('\n};', braceAt) : -1;
check('051 能定位 SPECS 配方表', specsAt >= 0 && braceAt >= 0 && endAt > braceAt);
const specsBlock = braceAt >= 0 && endAt > braceAt ? busCode.slice(braceAt + 1, endAt) : '';
const entries = {};
const keyRe = /^\s{4}([A-Za-z]+)\s*:\s*\{/gm;
const hits = [];
let km;
while ((km = keyRe.exec(specsBlock)) !== null) hits.push({ name: km[1], at: km.index });
for (let i = 0; i < hits.length; i++) {
    entries[hits[i].name] = specsBlock.slice(hits[i].at, i + 1 < hits.length ? hits[i + 1].at : specsBlock.length);
}
check('052 SPECS 至少解析出 15 条配方', Object.keys(entries).length >= 15,
    `实际 ${Object.keys(entries).length}`);

// 2.3 秘银远征用到的每个名字都必须有配方 + 在类型联合里
const used = MAPPED_NAMES.concat(['won', 'dead', 'coin', 'click']);
for (let i = 0; i < used.length; i++) {
    const name = used[i];
    check(`06${i} SfxName 含 '${name}'`, sfxNames.indexOf(name) >= 0);
    check(`07${i} SPECS 有 '${name}' 配方`, !!entries[name], '拼错名字会静默失败');
}

// 2.4 震动分级
check('080 受伤(playerHit) 带 medium 震动', /playerHit[\s\S]*?vib:\s*'medium'/.test(specsBlock));
check('081 爆炸(boom) 带 medium 震动', /boom:\s*\{[\s\S]*?vib:\s*'medium'/.test(specsBlock));
check('082 通关(won) 带 heavy 震动', /won:\s*\{[\s\S]*?vib:\s*'heavy'/.test(specsBlock));
check('083 阵亡(dead) 带长震', /dead:\s*\{[\s\S]*?vibLong:\s*true/.test(specsBlock));

// 2.5 高频音效必须有节流（否则 60fps 下刷屏）
for (const [i, name] of ['hit', 'kill', 'playerHit', 'click'].entries()) {
    const entry = entries[name] || '';
    check(`09${i} '${name}' 有 gap 节流`, /gap:\s*[\d.]+/.test(entry));
}

// 2.6 微信优先：小游戏必须走 wx.createWebAudioContext（没有标准 AudioContext）
const ctxAt = busCode.indexOf('function createAudioContext');
const wxAt = busCode.indexOf('wx.createWebAudioContext');
const stdAt = busCode.indexOf('g.AudioContext || g.webkitAudioContext');
check('100 微信 WebAudio 分支存在', wxAt > ctxAt && ctxAt >= 0);
check('101 微信分支优先于标准 AudioContext', wxAt < stdAt && stdAt > 0);

// ---------- 3. 工程约束 ----------
// 3.1 零音频资源
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
let audioAssets = 0;
(function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else if (AUDIO_EXT.indexOf(path.extname(name).toLowerCase()) >= 0) audioAssets++;
    }
}(path.join(ROOT, 'assets')));
eq('110 assets/ 下没有音频资源（程序化合成）', audioAssets, 0);

// 3.2 变体选择符（红线 10：微信字体渲染成方框）
for (const [i, file] of [MAP_SRC, AUDIO_SRC].entries()) {
    const text = fs.readFileSync(file, 'utf8');
    check(`11${i} ${path.basename(file)} 无 U+FE0E/U+FE0F`, !/[\uFE0E\uFE0F]/.test(text));
}

// 3.3 全部 sfx.play('x') 字面量都在映射表里
const ALLOWED = new Set(sfxNames);
const playRe = /sfx\.play\(\s*'([^']+)'\s*\)/g;
let playCount = 0;
let pm;
while ((pm = playRe.exec(busCode)) !== null) {
    // 总线自身的 setEnabled 里有一声 'click'
    check(`12${playCount} 总线内部 sfx.play('${pm[1]}') 合法`, ALLOWED.has(pm[1]));
    playCount++;
}
for (const file of [GAME_SRC, AUDIO_SRC, path.join(SRC_DIR, 'MithrilCampPanel.ts')]) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /sfx\.play\(\s*'([^']+)'\s*\)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        check(`13${playCount} ${path.basename(file)} 的 sfx.play('${m[1]}') 有配方`, entries[m[1]] !== undefined);
        playCount++;
    }
}
check('140 至少接了 3 处直接音效（升级 / 结算 / 节点交互）', playCount >= 3, `实际 ${playCount}`);

// 3.4 战斗事件走统一入口
const gameCode = stripComments(fs.readFileSync(GAME_SRC, 'utf8'));
check('141 战斗事件走 playCoreEvents', /playCoreEvents\s*\(\s*events\s*\)/.test(gameCode));
check('142 升级有专属反馈音', /sfx\.play\('core'\)/.test(gameCode));
check('143 结算按胜负分声', /sfx\.play\(won \? 'won' : 'dead'\)/.test(gameCode));

// 3.5 偏好键：GameAudio 按 gameId 拼，秘银远征必须传 'mithril'
const audioCode = stripComments(fs.readFileSync(AUDIO_SRC, 'utf8'));
check('150 单例 gameId 是 mithril', /super\('mithril'\)/.test(audioCode));
check('151 偏好键格式 tiny_games_${gameId}_audio',
    /tiny_games_\$\{gameId\}_audio/.test(busCode.replace(/\s+/g, '')));

// 3.6 开关：命名 handler + onDestroy 解绑（红线 5 / 4）
check('160 开关处理器是命名方法', /private onToggleTapped\(\): void/.test(audioCode));
check('161 onDestroy 解绑同一 handler',
    /off\(Node\.EventType\.TOUCH_END,\s*this\.onToggleTapped,\s*this\)/.test(audioCode));
check('162 开关文案不用符号字符', /'音效 开'/.test(audioCode) && /'音效 关'/.test(audioCode));
check('163 点击时先 unlock（绕开浏览器自动播放限制）',
    /sfx\.unlock\(\);\s*\n\s*sfx\.toggle\(\)/.test(audioCode));
check('164 开关位置在顶栏右上（x>200, y>500）', (() => {
    const bx = audioCode.match(/const BTN_X = (\d+)/);
    const by = audioCode.match(/const BTN_Y = (\d+)/);
    return !!bx && !!by && Number(bx[1]) > 200 && Number(by[1]) > 500;
})());
check('165 有浏览器探针 __mithrilAudio',
    /__mithrilAudio/.test(audioCode) && /__mithrilAudio/.test(gameCode));

// ---------- 汇总 ----------
if (failures.length > 0) {
    console.error(`\nMITHRIL_AUDIO_FAIL —— ${failures.length} 项失败（通过 ${passed} 项）`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
}
console.log(`\nMITHRIL_AUDIO_OK —— ${passed} 项检查全部通过（M10：映射表 / 总线契约 / 工程约束）`);
