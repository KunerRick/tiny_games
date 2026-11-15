#!/usr/bin/env node
/**
 * 从模板生成一款新游戏的骨架。
 *
 *   node tools/new-game.js --id gem_match --name 宝石消消乐 [--class GemMatch] [--dry-run]
 *
 * 生成：
 *   assets/games/game_<id>/scripts/<Class>Core.ts   （纯逻辑，零 cc 依赖）
 *   assets/games/game_<id>/scripts/<Class>Game.ts   （Cocos 组件，UI 全代码构建）
 *   assets/games/game_<id>/scripts/<Class>Hud.ts
 *   tools/verify-<id>-core.js                       （纯逻辑自检，含 Core 纯度断言）
 *
 * **不**替你做的（都会打印出来）：GameConfig 注册、大厅图标、场景、构建场景清单。
 * 这些必须人工确认 —— 尤其场景，`.scene` 只能通过编辑器 / MCP 改（红线 2）。
 *
 * 模板源：assets/games/game_template/ ；规矩：docs/design/2026-11-15-new-game-contract.md
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_SCRIPTS = path.join(ROOT, 'assets', 'games', 'game_template', 'scripts');
const TEMPLATE_VERIFY = path.join(ROOT, 'tools', 'verify-template-core.js');

function usage(msg) {
    if (msg) console.error(`错误：${msg}\n`);
    console.error('用法：node tools/new-game.js --id <game_id> --name <中文名> [--class <PascalName>] [--dry-run]');
    console.error('例：  node tools/new-game.js --id gem_match --name 宝石消消乐');
    process.exit(msg ? 1 : 0);
}

function parseArgs(argv) {
    const out = { id: '', name: '', className: '', dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--id') out.id = argv[++i] || '';
        else if (a === '--name') out.name = argv[++i] || '';
        else if (a === '--class') out.className = argv[++i] || '';
        else if (a === '--dry-run') out.dryRun = true;
        else if (a === '-h' || a === '--help') usage();
        else usage(`未知参数 ${a}`);
    }
    if (!out.id) usage('缺少 --id');
    if (!out.name) usage('缺少 --name');
    if (!/^[a-z][a-z0-9_]*$/.test(out.id)) usage('--id 只能是小写字母开头的小写字母/数字/下划线');
    return out;
}

function toPascal(id) {
    const p = id.split(/[_-]+/).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join('');
    return /^\d/.test(p) ? `G${p}` : p;
}

function toScreaming(id) {
    return id.toUpperCase();
}

/** 模板 → 具体游戏的文本替换。顺序要紧：先长后短，避免互相踩。 */
function transform(text, ctx) {
    return text
        .replace(/template-core-test/g, `${ctx.id}-core-test`)
        .replace(/game_template/g, `game_${ctx.id}`)
        .replace(/'template'/g, `'${ctx.id}'`)
        .replace(/TEMPLATE/g, ctx.screaming)
        .replace(/Template/g, ctx.pascal)
        .replace(/模板游戏/g, ctx.name);
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const ctx = {
        id: args.id,
        name: args.name,
        pascal: args.className || toPascal(args.id),
        screaming: toScreaming(args.id),
    };

    const targetDir = path.join(ROOT, 'assets', 'games', `game_${ctx.id}`, 'scripts');
    const verifyPath = path.join(ROOT, 'tools', `verify-${ctx.id}-core.js`);

    if (!fs.existsSync(TEMPLATE_SCRIPTS)) {
        console.error(`找不到模板目录：${path.relative(ROOT, TEMPLATE_SCRIPTS)}`);
        process.exit(1);
    }
    if (fs.existsSync(targetDir)) {
        console.error(`目标已存在：${path.relative(ROOT, targetDir)}（不会覆盖）`);
        process.exit(1);
    }
    if (fs.existsSync(verifyPath)) {
        console.error(`目标已存在：${path.relative(ROOT, verifyPath)}（不会覆盖）`);
        process.exit(1);
    }

    const scriptFiles = fs.readdirSync(TEMPLATE_SCRIPTS).filter((f) => f.endsWith('.ts'));
    if (!scriptFiles.length) {
        console.error('模板目录里没有 .ts 文件');
        process.exit(1);
    }

    const writes = [];
    for (const file of scriptFiles) {
        const from = path.join(TEMPLATE_SCRIPTS, file);
        const to = path.join(targetDir, file.replace(/^Template/, ctx.pascal));
        writes.push({ from, to, content: transform(fs.readFileSync(from, 'utf8'), ctx) });
    }
    writes.push({
        from: TEMPLATE_VERIFY,
        to: verifyPath,
        content: transform(fs.readFileSync(TEMPLATE_VERIFY, 'utf8'), ctx),
    });

    console.log(`模板：${ctx.pascal}  游戏 id：${ctx.id}  名称：${ctx.name}${args.dryRun ? '  [dry-run]' : ''}`);
    for (const w of writes) {
        console.log(`  ${args.dryRun ? '会写' : '写入'} ${path.relative(ROOT, w.to)}`);
    }

    if (!args.dryRun) {
        fs.mkdirSync(targetDir, { recursive: true });
        for (const w of writes) fs.writeFileSync(w.to, w.content, 'utf8');
    }

    const sceneName = ctx.pascal;
    const rel = (p) => path.relative(ROOT, p);
    console.log(`
接下来必须人工做（脚本不代劳）：
  1) 注册：${rel(path.join(ROOT, 'assets/common/managers/GameConfig.ts'))} 的 GAME_LIST 加一条
       { id: '${ctx.id}', name: '${ctx.name}', icon: '${ctx.id}', sceneName: '${sceneName}', description: '...' },
  2) 大厅图标：${rel(path.join(ROOT, 'assets/main/scripts/GameIconArt.ts'))} 补
       ACCENTS['${ctx.id}'] 与 drawShape 里的 case '${ctx.id}':
     然后跑  node tools/check-game-icons.js
  3) 场景：在编辑器里复制 assets/game_placeholder/scenes/GamePlaceholder.scene →
       assets/games/game_${ctx.id}/scenes/${sceneName}.scene
     把 Canvas 上的 GamePlaceholder 组件换成 ${ctx.pascal}Game（场景只要 Canvas + 相机，不用绑任何属性）
  4) 构建场景清单：node tools/sync-build-scenes.js --check
  5) 自检：node tools/verify-${ctx.id}-core.js && 全项目 tsc（改 .ts 后必跑）
`);
}

main();
