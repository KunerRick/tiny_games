#!/usr/bin/env node
/**
 * 构建场景清单同步（Cocos Creator 3.8.8）
 *
 * 用途：新增一个小游戏后，不用再打开编辑器「构建发布」面板手动勾选场景。
 *       本脚本扫描 assets/ 下的全部 .scene，按 GAME_LIST 顺序生成场景清单，
 *       直接写回构建配置（profiles/v2/packages/）。
 *
 * 用法：
 *   node tools/sync-build-scenes.js              # 同步微信小游戏的构建场景清单
 *   node tools/sync-build-scenes.js --dry-run    # 只看会改什么，不落盘
 *   node tools/sync-build-scenes.js --check      # 只检查，不同步；有差异退出码 1
 *   node tools/sync-build-scenes.js --all        # 同步所有平台的构建任务
 *   node tools/sync-build-scenes.js --platform web-mobile
 *
 * 退出码：--check 有差异时 1；其它情况 0（脚本自身出错另算）。
 *
 * 为什么需要它：Cocos 的构建配置是「快照」而不是「视图」——
 *   · profiles/v2/packages/builder.json 的 common.scenes 是构建面板里那份勾选列表；
 *   · 同一个文件的 BuildTaskManager.taskMap[<任务号>].options.scenes 是「重新构建上次任务」用的快照。
 *   新建的 .scene 不会自动出现在任何一份里，于是漏勾 = 运行时 director.loadScene 找不到场景。
 *   面板只能人点，所以这里做等价的文件级同步。
 *
 * 写入时机（实测，别踩）：编辑器会**周期性地把它内存里的构建配置整批刷回磁盘**。
 *   2026-10-29 实测：手工把 wechatgame.json 的 appid 改成新值，2 分半后编辑器把
 *   profiles/v2/packages 下 7 个文件整批重写，appid 退回旧值 —— 文件级改动被静默覆盖。
 *   所以顺序必须是：**退出编辑器 → 跑脚本 → 打开编辑器 → 构建**。
 *   编辑器在跑时本脚本默认拒绝写入（--check / --dry-run 不受影响，--force 可强行越过）。
 *
 * 本脚本不依赖任何第三方包。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PROFILES_DIR = path.join(PROJECT_ROOT, 'profiles', 'v2', 'packages');
const GAME_CONFIG = path.join(PROJECT_ROOT, 'assets', 'common', 'managers', 'GameConfig.ts');
const LOBBY_SCENE = 'Lobby';

/** 不进包的场景目录（新游戏模板，运行时用不到） */
const EXCLUDED_PREFIXES = ['assets/game_placeholder/'];

/** 各平台的构建配置文件名（与 profiles/v2/packages/ 下的文件名一致） */
const PLATFORM_PROFILE = {
    wechatgame: 'wechatgame.json',
    'web-mobile': 'web-mobile.json',
    'web-desktop': 'web-desktop.json',
};

// ==================== 参数 ====================

const argv = process.argv.slice(2);
const opt = {
    dryRun: argv.includes('--dry-run'),
    check: argv.includes('--check'),
    all: argv.includes('--all'),
    force: argv.includes('--force'),
    platform: 'wechatgame',
};

const pIdx = argv.indexOf('--platform');
if (pIdx >= 0) {
    const value = argv[pIdx + 1];
    if (!value) {
        fail('--platform 后面要跟平台名，例如 --platform wechatgame');
    }
    opt.platform = value;
}

// ==================== 场景收集 ====================

/** 递归列出 assets/ 下所有 .scene（跳过排除目录） */
function collectScenes() {
    const out = [];

    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            const rel = path.relative(PROJECT_ROOT, full).split(path.sep).join('/');
            if (EXCLUDED_PREFIXES.some((prefix) => rel + '/' === prefix || rel.startsWith(prefix))) {
                continue;
            }
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.name.endsWith('.scene')) {
                out.push({ abs: full, rel, name: entry.name.replace(/\.scene$/, '') });
            }
        }
    }

    walk(path.join(PROJECT_ROOT, 'assets'));
    return out;
}

/** 从 .scene.meta 读 uuid（不读也不改 .scene 本体，红线 2） */
function readUuid(scene) {
    const metaPath = scene.abs + '.meta';
    if (!fs.existsSync(metaPath)) return null;
    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        return typeof meta.uuid === 'string' && meta.uuid ? meta.uuid : null;
    } catch (e) {
        return null;
    }
}

/** GameConfig.ts 里注册的场景名，按注册顺序 */
function readRegisteredSceneNames() {
    if (!fs.existsSync(GAME_CONFIG)) return [];
    const src = fs.readFileSync(GAME_CONFIG, 'utf8');
    const names = [];
    const re = /sceneName\s*:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (!names.includes(m[1])) names.push(m[1]);
    }
    return names;
}

/**
 * 生成期望的场景清单。
 * 顺序：Lobby（启动场景）→ GAME_LIST 注册顺序 → 其余场景（按路径）。
 * 顺序本身不影响运行，只是让清单可读、diff 稳定。
 */
function buildDesiredScenes() {
    const scenes = collectScenes();
    const warnings = [];

    const withUuid = [];
    for (const scene of scenes) {
        const uuid = readUuid(scene);
        if (!uuid) {
            warnings.push(`${scene.rel} 没有可用的 .meta uuid，已跳过（先让编辑器导入一次）`);
            continue;
        }
        withUuid.push({ uuid, url: `db://${scene.rel}`, name: scene.name });
    }

    const registered = readRegisteredSceneNames();
    const byName = new Map(withUuid.map((s) => [s.name, s]));

    const ordered = [];
    const used = new Set();
    const push = (scene) => {
        if (!scene || used.has(scene.uuid)) return;
        used.add(scene.uuid);
        ordered.push(scene);
    };

    push(byName.get(LOBBY_SCENE));
    for (const name of registered) {
        const scene = byName.get(name);
        if (scene) {
            push(scene);
        } else {
            warnings.push(`GameConfig 注册了场景「${name}」，但 assets/ 下找不到 ${name}.scene`);
        }
    }
    const messageNames = new Set(ordered.map((s) => s.name));
    for (const scene of withUuid.slice().sort((a, b) => a.url.localeCompare(b.url))) {
        if (messageNames.has(scene.name)) continue;
        warnings.push(`场景 ${scene.url} 不在 GameConfig 的 GAME_LIST 里，仍会打进包（确认是故意的）`);
        push(scene);
    }

    if (!ordered.length) {
        fail('一个场景都没找到，assets/ 目录是否指向了正确的项目？');
    }

    return { scenes: ordered, warnings, total: withUuid.length };
}

// ==================== 配置读写 ====================

function readJson(absPath) {
    if (!fs.existsSync(absPath)) return null;
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function writeJson(absPath, data) {
    fs.writeFileSync(absPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** 两份清单的 uuid 集合是否一致（顺序不算差异：顺序不影响运行，改它只会制造 diff 噪音） */
function sameSceneSet(a, b) {
    const ids = (list) => new Set((Array.isArray(list) ? list : []).map((s) => (s && s.uuid) || ''));
    const left = ids(a);
    const right = ids(b);
    if (left.size !== right.size) return false;
    for (const uuid of left) if (!right.has(uuid)) return false;
    return true;
}

/**
 * 合并清单：保留现有的顺序，只把缺的补到末尾（按期望顺序）。
 * 这样新增游戏时 diff 只有 `+ 一行`，不会整块重排。
 */
function mergeScenes(current, desired) {
    const cur = Array.isArray(current) ? current : [];
    const keep = cur.filter((s) => desired.some((d) => d.uuid === (s && s.uuid)));
    const missing = desired.filter((d) => !cur.some((s) => (s && s.uuid) === d.uuid));
    return keep.concat(missing).map((s) => ({ uuid: s.uuid, url: s.url }));
}

function describeDiff(current, desired) {
    const cur = Array.isArray(current) ? current : [];
    const curIds = new Set(cur.map((s) => s.uuid));
    const wantIds = new Set(desired.map((s) => s.uuid));
    const added = desired.filter((s) => !curIds.has(s.uuid));
    const removed = cur.filter((s) => !wantIds.has(s.uuid));
    return { added, removed };
}

/** 目标平台对应的构建任务（builder.json 的 taskMap 里跨平台混存） */
function tasksFor(builderJson, platform) {
    const taskMap = (builderJson.BuildTaskManager && builderJson.BuildTaskManager.taskMap) || {};
    return Object.entries(taskMap).filter(
        ([, task]) => task && task.options && task.options.platform === platform,
    );
}

// ==================== 主流程 ====================

function main() {
    const { scenes: desired, warnings, total } = buildDesiredScenes();
    const desiredIds = new Set(desired.map((s) => s.uuid));
    const lobby = desired.find((s) => s.name === LOBBY_SCENE);
    const startScene = lobby ? lobby.uuid : desired[0].uuid;

    const platforms = opt.all ? Object.keys(PLATFORM_PROFILE) : [opt.platform];
    const builderPath = path.join(PROFILES_DIR, 'builder.json');
    const builderJson = readJson(builderPath);

    if (!builderJson) {
        fail(`找不到 ${rel(builderPath)} —— 先在编辑器里构建过一次，让配置落盘`);
    }

    /** 待写回的改动：{ file, label, before, after, apply } */
    const changes = [];
    const notes = [];

    // ① 全局公共设置：构建面板里那份勾选列表
    const common = builderJson.common || (builderJson.common = {});
    const commonScenesStale = !sameSceneSet(common.scenes, desired);
    const commonStartStale = !!common.startScene && !desiredIds.has(common.startScene);
    if (commonScenesStale || commonStartStale) {
        const merged = mergeScenes(common.scenes, desired);
        changes.push({
            file: builderPath,
            label: 'builder.json → common.scenes（构建面板勾选列表）',
            current: common.scenes,
            apply: (json) => {
                if (commonScenesStale) json.common.scenes = merged;
                if (commonStartStale) json.common.startScene = startScene;
            },
        });
        if (commonStartStale) {
            notes.push('common.startScene 指向一个不在清单里的场景，已改回启动场景');
        }
    }

    // ② 每个平台的构建任务快照（「重新构建上次任务」读的是这里）
    for (const platform of platforms) {
        const matched = tasksFor(builderJson, platform);
        if (!matched.length) {
            notes.push(`没有找到平台「${platform}」的构建任务，跳过任务快照（先在编辑器里构建一次该平台）`);
            continue;
        }
        for (const [taskId, task] of matched) {
            const opts = task.options;
            const needsScenes = !sameSceneSet(opts.scenes, desired);
            const needsStart = !!opts.startScene && !desiredIds.has(opts.startScene);
            if (!needsScenes && !needsStart) continue;

            const merged = mergeScenes(opts.scenes, desired);
            changes.push({
                file: builderPath,
                label: `builder.json → task ${taskId} (${platform}) 的场景快照`,
                current: opts.scenes,
                apply: (json) => {
                    const t = json.BuildTaskManager.taskMap[taskId];
                    if (needsScenes) t.options.scenes = merged;
                    if (needsStart) t.options.startScene = startScene;
                },
            });
            if (needsStart) {
                notes.push(`task ${taskId} 的 startScene 指向清单外的场景，已改回启动场景`);
            }
        }

        // ③ 平台自己的 profile 里也有一份 common.scenes（wechatgame 有，web-desktop 没有）
        const profileName = PLATFORM_PROFILE[platform];
        if (!profileName) continue;
        const profilePath = path.join(PROFILES_DIR, profileName);
        const profileJson = readJson(profilePath);
        if (!profileJson || !profileJson.builder || !profileJson.builder.common) continue;
        if (!('scenes' in profileJson.builder.common)) continue;
        if (sameSceneSet(profileJson.builder.common.scenes, desired)) continue;

        const merged = mergeScenes(profileJson.builder.common.scenes, desired);
        changes.push({
            file: profilePath,
            label: `${profileName} → builder.common.scenes`,
            current: profileJson.builder.common.scenes,
            apply: (json) => {
                json.builder.common.scenes = merged;
            },
        });
    }

    // ④ 报告
    console.log(`扫描到 ${total} 个场景（已排除 ${EXCLUDED_PREFIXES.join('、')}），目标平台：${platforms.join('、')}`);
    console.log(`期望清单 ${desired.length} 个：${desired.map((s) => s.name).join(' → ')}`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);

    if (!changes.length) {
        console.log('\n✅ 构建场景清单已是最新，不需要改动。');
        return 0;
    }

    console.log(`\n需要同步 ${changes.length} 处：`);
    for (const change of changes) {
        const { added, removed } = describeDiff(change.current, desired);
        console.log(`  · ${change.label}`);
        for (const s of added) console.log(`      + ${s.url}`);
        for (const s of removed) console.log(`      - ${s.url}`);
        if (!added.length && !removed.length) console.log('      （场景没变，只是启动场景需要修正）');
    }
    for (const n of notes) console.log(`  ⚠ ${n}`);

    if (opt.check) {
        console.log('\n❌ --check：清单与项目不一致（运行 node tools/sync-build-scenes.js 修复）');
        return 1;
    }
    if (opt.dryRun) {
        console.log('\n（--dry-run：未写入任何文件）');
        return 0;
    }

    // ④ 编辑器在上：它会把自己的内存副本整批刷回磁盘，覆盖掉这里的改动
    if (!opt.force && editorRunning()) {
        console.error('\n❌ 编辑器正在打开这个项目，它会把内存里的旧配置刷回磁盘，覆盖本次改动。');
        console.error('   请先退出 Cocos Creator，再重新运行本脚本（或加 --force 自行承担后果）。');
        return 1;
    }

    // ⑤ 落盘：同一文件只写一次，先备份（profiles/ 在 .gitignore 里，没有版本控制兜底）
    const byFile = new Map();
    for (const change of changes) {
        if (!byFile.has(change.file)) byFile.set(change.file, []);
        byFile.get(change.file).push(change);
    }

    for (const [file, list] of byFile) {
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const change of list) change.apply(json);
        const backup = file + '.bak';
        fs.copyFileSync(file, backup);
        writeJson(file, json);
        console.log(`  ✏ 已写入 ${rel(file)}（备份 ${rel(backup)}）`);
    }

    console.log('\n✅ 完成。现在打开编辑器，进「构建发布」确认勾选无误后点构建。');
    return 0;
}

// ==================== 工具 ====================

function rel(absPath) {
    return path.relative(PROJECT_ROOT, absPath);
}

/**
 * 编辑器是否正打开着这个项目。
 * 判据：进程命令里同时出现 CocosCreator 与项目路径，且不是 Helper / 渲染进程。
 * 取不到进程列表时按「没开」处理，不让这项检查挡住正常使用。
 */
function editorRunning() {
    try {
        const out = execSync('ps -A -o command', { encoding: 'utf8', timeout: 5000 });
        return out.split('\n').some((line) =>
            /CocosCreator\b/.test(line) && !/Helper/.test(line) && line.includes(PROJECT_ROOT),
        );
    } catch (e) {
        return false;
    }
}

function fail(message) {
    console.error(`❌ ${message}`);
    process.exit(2);
}

process.exitCode = main();
