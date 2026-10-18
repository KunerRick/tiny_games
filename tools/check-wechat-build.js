#!/usr/bin/env node
/**
 * 微信小游戏构建产物预检（Cocos Creator 3.8.8）
 *
 * 用途：在把 build/wechatgame 交给「微信开发者工具」之前先跑一遍，
 *       把会导致「编译报错 / 模拟器起不来」的问题挡在前面。
 *
 * 用法：
 *   node tools/check-wechat-build.js                 # 默认检查 build/wechatgame
 *   node tools/check-wechat-build.js <构建目录>       # 指定其它构建目录
 *
 * 退出码：有任一 ❌ 时返回 1，否则 0（可直接串进脚本）。
 *
 * 背景（本项目实际踩过的坑，见 docs/tech/wechat-build-pitfalls.md）：
 *   2026-10-18 微信开发者工具报 `game.json: 未找到 game.json 文件，或者文件读取失败`。
 *   根因不是构建内容有问题，而是 **时序**：Cocos 构建会先清空再重写输出目录，
 *   而开发者工具此时正开着该项目、文件监听一有变动就自动重新编译。
 *   实测时间线 —— 构建产物落盘 20:00:50，开发者工具最后一次尝试编译停在 20:00:49，
 *   于是它永远停在「目录里还没有 game.json」的那个过期状态。
 *   内容一字未改、只重新编译一次，日志即从 launch failed 变为 launch success。
 *
 * 本脚本不依赖任何第三方包；语法级检查用到 Cocos 自带的那份 TypeScript，
 * 找不到就跳过该项（不会因此判定失败）。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ───────────────────────────── 输出小工具 ─────────────────────────────

const PASS = '✅';
const WARN = '⚠ ';
const FAIL = '❌';

let failureCount = 0;
let warnCount = 0;

/** 记录一条检查结果。level 为 'pass' | 'warn' | 'fail'。 */
function report(level, title, detail) {
  const icon = level === 'pass' ? PASS : level === 'warn' ? WARN : FAIL;
  console.log(`${icon} ${title}`);
  if (detail) {
    for (const line of String(detail).split('\n')) console.log(`     ${line}`);
  }
  if (level === 'fail') failureCount++;
  if (level === 'warn') warnCount++;
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 46 - title.length))}`);
}

/** 人类可读的体积。 */
function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 本地时间 HH:MM:SS。 */
function hms(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 递归列出目录下所有文件（相对路径）。目录不存在时返回空数组。 */
function walkFiles(dir) {
  const out = [];
  (function walk(cur, rel) {
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile()) out.push({ abs, rel: r, size: fs.statSync(abs).size, mtimeMs: fs.statSync(abs).mtimeMs });
    }
  })(dir, '');
  return out;
}

// ────────────────────────── 微信小游戏硬性要求 ──────────────────────────

/** Cocos 3.8.8 微信小游戏构建产物的必需文件（缺失 = 一定起不来）。 */
const REQUIRED_FILES = [
  'game.js',                    // 小游戏入口，微信运行时从这里启动
  'game.json',                  // 小游戏配置，缺失即报「未找到 game.json 文件」
  'project.config.json',        // 开发者工具项目配置
  'application.js',             // Cocos 启动脚本
  'src/settings.json',          // 引擎设置
  'src/system.bundle.js',
  'src/polyfills.bundle.js',
  'src/import-map.js',
  'assets/main/config.json',    // 首个场景的资源清单
];

/** 微信小游戏主包体积上限（4 MB）。 */
const MAIN_PACKAGE_LIMIT = 4 * 1024 * 1024;

// ─────────────────────────────── 检查项 ───────────────────────────────

const buildDir = path.resolve(process.argv[2] || path.join(PROJECT_ROOT, 'build', 'wechatgame'));

console.log('微信小游戏构建产物预检');
console.log(`项目根目录：${PROJECT_ROOT}`);
console.log(`构建目录　：${buildDir}`);

if (!fs.existsSync(buildDir)) {
  report('fail', '构建目录不存在', `先到 Cocos Creator 里执行「构建 → 微信小游戏」，输出到 ${buildDir}`);
  process.exit(1);
}

const files = walkFiles(buildDir);
const byRel = new Map(files.map((f) => [f.rel, f]));
const newest = files.reduce((a, b) => (a && a.mtimeMs >= b.mtimeMs ? a : b), null);

// ── 1. 必需文件是否齐全、是否被写了一半 ──────────────────────────────

section('1. 构建完整性（缺文件 / 截断写入）');

const missing = REQUIRED_FILES.filter((f) => !byRel.has(f));
const empty = REQUIRED_FILES.filter((f) => byRel.has(f) && byRel.get(f).size === 0);

if (missing.length === 0 && empty.length === 0) {
  report('pass', `必需文件齐全（${REQUIRED_FILES.length} 项）`);
} else {
  if (missing.length) report('fail', `缺少必需文件 ${missing.length} 个`, missing.join('\n'));
  if (empty.length) report('fail', `必需文件为空（写了一半）`, empty.join('\n'));
  report('warn', '构建目录看起来不完整', '很可能是构建还在进行中，或上一次构建中途失败。重新构建一次再开开发者工具。');
}

// ── 2. 关键配置文件的 JSON 合法性与内容 ──────────────────────────────

section('2. 配置文件（game.json / project.config.json）');

function readJson(rel) {
  const f = byRel.get(rel);
  if (!f) return { error: '文件不存在' };
  const buf = fs.readFileSync(f.abs);
  // 带 BOM 的 JSON 会让开发者工具按「文件读取失败」处理
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { error: '文件带 UTF-8 BOM，微信会读取失败' };
  const text = buf.toString('utf8');
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { error: '顶层不是 JSON 对象' };
    }
    return { data, text };
  } catch (e) {
    return { error: `JSON 解析失败：${e.message}` };
  }
}

const gameJson = readJson('game.json');
if (gameJson.error) {
  report('fail', 'game.json 不可用', gameJson.error);
} else {
  report('pass', 'game.json 是可解析的 JSON 对象', JSON.stringify(gameJson.data));
}

const projJson = readJson('project.config.json');
if (projJson.error) {
  report('fail', 'project.config.json 不可用', projJson.error);
} else {
  const cfg = projJson.data;
  const problems = [];
  if (cfg.compileType !== 'game') problems.push(`compileType 应为 "game"，实际为 ${JSON.stringify(cfg.compileType)}`);
  if (!cfg.appid) problems.push('缺少 appid');
  if (problems.length) report('fail', 'project.config.json 关键字段不对', problems.join('\n'));
  else report('pass', `project.config.json 关键字段正确（compileType="game", appid=${cfg.appid}）`);
}

// ── 3. 构建是否已经「写完」（本项目那次编译报错的直接原因） ──────────

section('3. 构建是否已落盘稳定');

const settleSeconds = Math.round((Date.now() - (newest ? newest.mtimeMs : 0)) / 1000);
const newestLabel = newest ? `${newest.rel} @ ${hms(newest.mtimeMs)}，${settleSeconds} 秒前` : '无文件';
if (newest && settleSeconds < 60) {
  report(
    'warn',
    `构建产物 ${settleSeconds} 秒前还在被写入：${newest.rel}`,
    [
      'Cocos 构建会「先清空目录、再重写」。此时若开发者工具正开着该项目，',
      '它的文件监听会触发重新编译，而此刻 game.json 可能还不存在 →',
      '报 `game.json: 未找到 game.json 文件，或者文件读取失败`。',
      '请等 Cocos 构建面板显示完成，再操作开发者工具。',
    ].join('\n'),
  );
} else {
  report('pass', `构建产物已稳定（最新文件 ${newestLabel}）`);
}

// ── 4. 语法级别：开发者工具自带编译对 ES 版本有要求 ─────────────────

section('4. 产物 JS 的语法级别');

function findTypeScript() {
  const candidates = [
    process.env.COCOS_TSC_LIB,
    // 编辑器自带的那份（与 npx 解析到的全局版本无关）
    '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/lib/typescript.js',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    return require.resolve('typescript');
  } catch {
    return null;
  }
}

const tsLib = findTypeScript();
if (!tsLib) {
  report('warn', '找不到 TypeScript，跳过语法级检查', '可设环境变量 COCOS_TSC_LIB 指向 typescript.js 后重跑');
} else {
  const ts = require(tsLib);
  const jsFiles = files.filter((f) => f.rel.endsWith('.js'));
  // ES2015 = 开发者工具「未开启增强编译」时的下限；ES5 = 最苛刻的情况
  const levels = [
    ['ES2015', ts.ScriptTarget.ES2015],
    ['ES5', ts.ScriptTarget.ES5],
  ];
  for (const [label, target] of levels) {
    const bad = [];
    for (const f of jsFiles) {
      const src = fs.readFileSync(f.abs, 'utf8');
      const sf = ts.createSourceFile(f.abs, src, target, false, ts.ScriptKind.JS);
      const diags = sf.parseDiagnostics;
      if (diags && diags.length) {
        bad.push(`${f.rel}: ${ts.flattenDiagnosticMessageText(diags[0].messageText, ' ')}`);
      }
    }
    if (bad.length === 0) report('pass', `${jsFiles.length} 个 .js 均可按 ${label} 解析`);
    else report('fail', `${bad.length} 个 .js 无法按 ${label} 解析`, bad.slice(0, 10).join('\n'));
  }
  console.log(`     （使用 ${ts.version}：${tsLib}）`);
}

// ── 5. 主包体积 ──────────────────────────────────────────────────────

section('5. 主包体积');

const totalBytes = files.reduce((s, f) => s + f.size, 0);
if (totalBytes <= MAIN_PACKAGE_LIMIT) {
  report('pass', `主包 ${human(totalBytes)} / 上限 ${human(MAIN_PACKAGE_LIMIT)}（余量 ${human(MAIN_PACKAGE_LIMIT - totalBytes)}）`);
} else {
  report(
    'fail',
    `主包 ${human(totalBytes)} 超出上限 ${human(MAIN_PACKAGE_LIMIT)}`,
    '需要拆分包（game.json 的 subpackages）或压缩资源，否则真机下载会失败。',
  );
}
for (const d of ['cocos-js', 'assets', 'src']) {
  const sub = files.filter((f) => f.rel.startsWith(`${d}/`));
  if (sub.length) console.log(`     ${d}/ = ${human(sub.reduce((s, f) => s + f.size, 0))}`);
}

// ── 6. 项目不变量：不得残留变体选择符（AGENTS 红线 10） ─────────────

section('6. 变体选择符 VS16 / VS15（微信字体缺字形 → 图标方框）');

const RE_VS = /[\uFE0E\uFE0F]/;
const vsHits = [];
for (const f of files) {
  if (!/\.(js|json)$/i.test(f.rel)) continue; // 二进制资源不判
  let text;
  try {
    text = fs.readFileSync(f.abs, 'utf8');
  } catch {
    continue;
  }
  if (RE_VS.test(text)) vsHits.push(f.rel);
}
if (vsHits.length === 0) {
  report('pass', '构建产物的 .js/.json 里没有 U+FE0E / U+FE0F');
} else {
  report(
    'fail',
    `${vsHits.length} 个产物文件含变体选择符`,
    vsHits.slice(0, 10).join('\n') + '\n说明源码里有残留，见 docs/tech/wechat-text-rendering.md',
  );
}

// ── 7. 开发者工具是否停在「过期构建」（这就是用户看到的编译报错） ───

section('7. 开发者工具是否需要重新编译');

/**
 * 找到微信开发者工具的日志目录（找得到才检查，找不到不算失败）。
 * macOS: ~/Library/Application Support/微信开发者工具/<hash>/WeappLog/logs
 */
function findDevtoolsLogDirs() {
  const dirs = [];
  const macBase = path.join(os.homedir(), 'Library', 'Application Support', '微信开发者工具');
  try {
    for (const e of fs.readdirSync(macBase, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const logs = path.join(macBase, e.name, 'WeappLog', 'logs');
      if (fs.existsSync(logs)) dirs.push(logs);
    }
  } catch {
    /* 没有开发者工具就跳过 */
  }
  return dirs;
}

/** 从日志行 `[2026-10-18 20:17:22.902+08:00] ...` 里取出时间戳。 */
function parseLogTime(line) {
  const m = line.match(/\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})([+-]\d{2}:\d{2})\]/);
  if (!m) return NaN;
  return Date.parse(`${m[1]}T${m[2]}${m[3]}`);
}

/** 取「开发者工具最后一次处理本项目」的时间（编译并启动模拟器即算一次）。 */
function findLastDevtoolsCompile(logDirs) {
  let latest = 0;
  let where = '';
  for (const dir of logDirs) {
    let names;
    try {
      names = fs
        .readdirSync(dir)
        .filter((n) => n.endsWith('.log'))
        .map((n) => ({ n, m: fs.statSync(path.join(dir, n)).mtimeMs }))
        .sort((a, b) => b.m - a.m)
        .slice(0, 5); // 只扫最近 5 个日志
    } catch {
      continue;
    }
    for (const { n } of names) {
      let text;
      try {
        text = fs.readFileSync(path.join(dir, n), 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!/simulator launch (success|failed)/.test(line)) continue;
        const t = parseLogTime(line);
        if (t > latest) {
          latest = t;
          where = n;
        }
      }
    }
  }
  return { latest, where };
}

const logDirs = findDevtoolsLogDirs();
if (logDirs.length === 0) {
  report('warn', '没找到微信开发者工具的日志目录，跳过本项', '本机没装（或从未打开过）微信开发者工具时属正常');
} else {
  const { latest, where } = findLastDevtoolsCompile(logDirs);
  if (!latest) {
    report('warn', '开发者工具日志里没有编译记录', '说明它还没打开过本项目 —— 直接打开即可');
  } else if (!newest) {
    report('warn', '构建目录为空，无从比较');
  } else if (newest.mtimeMs > latest) {
    report(
      'fail',
      '开发者工具停在过期构建上，需要重新编译',
      [
        `构建产物最新：${newest.rel} @ ${hms(newest.mtimeMs)}`,
        `工具最后编译：${hms(latest)}（${where}）`,
        '这次构建比工具的最后一次编译更新，工具当前显示的很可能是旧状态或报错。',
        '动作：在开发者工具里点一下「编译」，或关掉项目重新打开。',
      ].join('\n'),
    );
  } else {
    report('pass', `开发者工具已跟上本次构建（最后编译 ${hms(latest)}）`);
  }
}

// ─────────────────────────────── 总结 ───────────────────────────────

console.log('\n' + '─'.repeat(52));
if (failureCount === 0) {
  console.log(`${PASS} 预检通过（${warnCount} 条提醒）。可以打开微信开发者工具了。`);
} else {
  console.log(`${FAIL} 预检不通过：${failureCount} 项失败、${warnCount} 条提醒。按上面的说明处理后重跑本脚本。`);
}
console.log('产物目录：' + buildDir);
console.log('排错手册：docs/tech/wechat-build-pitfalls.md');
process.exit(failureCount === 0 ? 0 : 1);
