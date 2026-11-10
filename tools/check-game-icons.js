#!/usr/bin/env node
/**
 * 大厅图标覆盖自检 —— 防止「新游戏忘了画专属图标，落回兜底问号」再次发生。
 *
 * 背景：2026-11-10 发现 wordle / bubble / sokoban / shmup / thunder / fridge 六款
 * 只在 GAME_LIST 里注册了，没在 GameIconArt.ts 补 ACCENTS 与 drawShape case，
 * 大厅里显示的是同一张「兜底问号」卡片。人工看图很难在 24 张卡片里发现，
 * 所以把「注册表对得上」变成一条命令。
 *
 * 检查项：
 *   1. GAME_LIST 里每个 id 都在 ACCENTS 里有强调色          （缺 → 错误）
 *   2. GAME_LIST 里每个 id 都在 drawShape 里有专属 case     （缺 → 错误）
 *   3. ACCENTS / case 里没有已从 GAME_LIST 删除的僵尸条目    （多 → 警告）
 *   4. 没有两款游戏用完全相同的 (main, soft) 强调色对        （撞 → 警告）
 *   5. GameIconArt.ts 里没有 U+FE0E / U+FE0F 变体选择符       （有 → 错误，红线 10）
 *   6. drawShape 保留 `default` 兜底分支                      （缺 → 警告）
 *
 * 用法：
 *   node tools/check-game-icons.js
 * 退出码 0 = 通过（警告不算失败）；1 = 有错误。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 可选 `--config <file>` / `--art <file>`，供自测用（传入改坏的副本验证脚本真能拦住） */
const argv = process.argv.slice(2);
function argOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const CONFIG = path.resolve(argOf('--config') || path.join(ROOT, 'assets/common/managers/GameConfig.ts'));
const ART = path.resolve(argOf('--art') || path.join(ROOT, 'assets/main/scripts/GameIconArt.ts'));

const errors = [];
const warnings = [];

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    errors.push(`读不到文件：${path.relative(ROOT, file)}（${e.message}）`);
    return '';
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// ==================== 解析 GAME_LIST ====================

function parseGameIds(text) {
  const start = text.indexOf('GAME_LIST');
  if (start < 0) {
    errors.push('GameConfig.ts 里找不到 GAME_LIST');
    return [];
  }
  const end = text.indexOf('];', start);
  const body = text.slice(start, end < 0 ? text.length : end);
  const ids = [];
  const re = /\bid:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(body))) ids.push({ id: m[1], line: lineOf(text, start + m.index) });
  return ids;
}

// ==================== 解析 GameIconArt ====================

function parseAccents(text) {
  const start = text.indexOf('const ACCENTS');
  const end = text.indexOf('};', start);
  const body = text.slice(start, end < 0 ? text.length : end);
  const out = [];
  // 形如： '2048': { main: new Color(...), soft: new Color(...) },
  const re = /^\s*'?([A-Za-z0-9_]+)'?\s*:\s*\{\s*main:\s*new Color\(([^)]*)\)\s*,\s*soft:\s*new Color\(([^)]*)\)/gm;
  let m;
  while ((m = re.exec(body))) {
    out.push({
      id: m[1],
      key: `${m[2].replace(/\s+/g, '')} / ${m[3].replace(/\s+/g, '')}`,
      line: lineOf(text, start + m.index),
    });
  }
  return out;
}

function parseCases(text) {
  const start = text.indexOf('function drawShape');
  const end = text.indexOf('\n/** 画整张卡片', start);
  const body = text.slice(start, end < 0 ? text.length : end);
  const out = [];
  const re = /\bcase\s+'([^']+)'\s*:/g;
  let m;
  while ((m = re.exec(body))) out.push({ id: m[1], line: lineOf(text, start + m.index) });
  const hasDefault = /\bdefault\s*:/.test(body);
  return { cases: out, hasDefault };
}

// ==================== 检查 ====================

function main() {
  const configText = read(CONFIG);
  const artText = read(ART);
  if (errors.length) return report();

  const games = parseGameIds(configText);
  const accents = parseAccents(artText);
  const { cases, hasDefault } = parseCases(artText);

  if (games.length === 0) errors.push('GAME_LIST 解析出 0 个游戏，解析规则可能过时了');
  if (accents.length === 0) errors.push('ACCENTS 解析出 0 条，解析规则可能过时了');
  if (cases.length === 0) errors.push('drawShape 解析出 0 个 case，解析规则可能过时了');

  const accentIds = new Set(accents.map((a) => a.id));
  const caseIds = new Set(cases.map((c) => c.id));
  const gameIds = new Set(games.map((g) => g.id));

  // 1. 每个游戏都要有强调色
  for (const g of games) {
    if (!accentIds.has(g.id)) {
      errors.push(`游戏「${g.id}」没有 ACCENTS 强调色（GameConfig.ts:${g.line} 注册了，GameIconArt.ts 漏了）`);
    }
  }
  // 2. 每个游戏都要有专属 case
  for (const g of games) {
    if (!caseIds.has(g.id)) {
      errors.push(
        `游戏「${g.id}」没有 drawShape 专属 case（会落回兜底问号，大厅里和别的游戏长一样）`,
      );
    }
  }
  // 3. 僵尸条目
  for (const a of accents) {
    if (!gameIds.has(a.id)) warnings.push(`ACCENTS 里有僵尸条目「${a.id}」（GameIconArt.ts:${a.line}，GAME_LIST 已无此 id）`);
  }
  for (const c of cases) {
    if (!gameIds.has(c.id)) warnings.push(`drawShape 里有僵尸 case「${c.id}」（GameIconArt.ts:${c.line}）`);
  }
  // 4. 强调色对撞
  const byKey = new Map();
  for (const a of accents) {
    if (!byKey.has(a.key)) byKey.set(a.key, []);
    byKey.get(a.key).push(a.id);
  }
  for (const [key, ids] of byKey) {
    if (ids.length > 1) warnings.push(`强调色对撞：${ids.join('、')} 都用 ${key}`);
  }
  // 5. 变体选择符
  const vs = /[\uFE0E\uFE0F]/g;
  let m;
  while ((m = vs.exec(artText))) {
    errors.push(`GameIconArt.ts:${lineOf(artText, m.index)} 含变体选择符 U+${m[0].charCodeAt(0).toString(16).toUpperCase()}（红线 10）`);
  }
  // 6. 兜底分支
  if (!hasDefault) warnings.push('drawShape 没有 default 分支：没登记的 id 会画不出任何图形（更隐蔽，建议保留）');

  report({ games: games.length, accents: accents.length, cases: cases.length });
}

function report(summary) {
  console.log('大厅图标覆盖自检');
  console.log(`  注册表：${path.relative(ROOT, CONFIG)}`);
  console.log(`  图标库：${path.relative(ROOT, ART)}`);
  if (summary) {
    console.log(
      `  规模：GAME_LIST ${summary.games} 款 · ACCENTS ${summary.accents} 条 · drawShape ${summary.cases} 个 case`,
    );
  }
  if (warnings.length) {
    console.log('\n提醒：');
    for (const w of warnings) console.log(`  ⚠  ${w}`);
  }
  if (errors.length) {
    console.log('\n错误：');
    for (const e of errors) console.log(`  ❌ ${e}`);
    console.log(`\n❌ 自检不通过：${errors.length} 个错误、${warnings.length} 条提醒。`);
    console.log('新增游戏时先补 GameIconArt.ts 的 ACCENTS + drawShape case，见 docs/design/2026-11-10-ui-art-style-guide.md');
    process.exit(1);
  }
  console.log(`\n✅ 自检通过：${summary ? summary.games : 0} 款游戏都有专属强调色与图形。`);
}

main();
