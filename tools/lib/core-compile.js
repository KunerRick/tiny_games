'use strict';
/**
 * verify-*-core.js 共用：定位 TypeScript 编译器 + 编译纯逻辑模块。
 *
 * 为什么需要它：每个 verify 脚本原先各抄一份 tsc 路径探测（含 Cocos 自带的绝对路径），
 * 升级 Cocos 版本时得改 20 处。现在只改这里。
 *
 * 用法（新脚本推荐写法）：
 *
 *   const { runTsc } = require('./lib/core-compile');
 *   const OUT = path.join(__dirname, '..', 'temp', 'xxx-core-test');
 *   fs.rmSync(OUT, { recursive: true, force: true });
 *   runTsc([SRC_FILE, '--outDir', OUT, '--rootDir', SRC_DIR, '--module', 'commonjs', '--target', 'es2019', '--skipLibCheck']);
 *   const C = require(path.join(OUT, 'game_xxx', 'scripts', 'XxxCore.js'));
 *
 * 查找顺序：$TSC → 项目内 node_modules/typescript → Cocos Creator 3.8.8 自带版本。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

const TSC_CANDIDATES = [
    process.env.TSC,
    path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc',
].filter(Boolean);

/** 返回 tsc 可执行文件路径；找不到返回 null（调用方自行决定是否退出）。 */
function findTsc() {
    return TSC_CANDIDATES.find((p) => p && fs.existsSync(p)) || null;
}

/** 同 findTsc()，但找不到时打印提示并以退出码 2 结束（多数 verify 脚本的用法）。 */
function requireTsc() {
    const tsc = findTsc();
    if (!tsc) {
        console.error('找不到 tsc。请设置 TSC 环境变量，或在项目内 npm install。');
        console.error('  已尝试：\n    ' + TSC_CANDIDATES.join('\n    '));
        process.exit(2);
    }
    return tsc;
}

/**
 * 用 tsc 编译给定文件，参数原样透传给 tsc（不传输出目录等默认值，保持各脚本自主）。
 * @param {string[]} args tsc 参数，例如 [srcFile, '--outDir', out, '--module', 'commonjs']
 * @param {{stdio?: 'inherit'|'pipe'}} [opts]
 */
function runTsc(args, opts = {}) {
    return execFileSync(process.execPath, [requireTsc(), ...args], { stdio: 'inherit', ...opts });
}

module.exports = { ROOT, TSC_CANDIDATES, findTsc, requireTsc, runTsc };
