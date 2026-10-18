#!/usr/bin/env node
/**
 * 微信小游戏产物「包装器」复现器（Cocos Creator 3.8.8 产物专用）
 *
 * 用途：把构建产物里的某个模块（默认 web-adapter.js）按「微信开发者工具」
 *       真实的两种 define 包装方式各加载一次，证明：
 *         ① 用「小程序」包装（BOM 全是形参）+ 运行时只传 3 个实参 ⇒ 必崩
 *         ② 用「小游戏」包装（只有 process 形参）            ⇒ 正常
 *         ③ 仍是小程序包装，但注入真 window                  ⇒ 正常（对照）
 *       即：崩不崩只取决于「开发者工具把项目编译成小程序还是小游戏」，
 *       与构建产物本身无关。
 *
 * 用法：
 *   node tools/replay-wechat-bundle.js                    # 默认 build/wechatgame/web-adapter.js
 *   node tools/replay-wechat-bundle.js <模块路径>          # 换一个产物模块
 *
 * 退出码：小游戏包装下能正常加载 → 0；连小游戏包装都加载失败 → 1（真有问题）。
 *
 * 依据（全部取自本机真实字节，见 docs/tech/wechat-build-pitfalls.md §8）：
 *   1) 开发者工具 app.asar 里生成包装器的两个函数：
 *        wrapSourceCodeInDefine     → function(require, module, exports, ${NO_BOM_VAR.join(',')})
 *        wrapGameSourceCodeInDefine → function(require, module, exports, process)
 *      分派：const o = t.isGame ? wrapGameSourceCodeInDefine : wrapSourceCodeInDefine
 *   2) 小游戏运行时 WAGameSubContext.js 调用模块工厂只传 3 个实参
 *        p("", `require(${e})`, w, void 0, [T(e), b, b.exports], !0)   // p 内 = r.apply(n, o)
 *      ⇒ BOM 形参（window/top/document/navigator/...）全部收到 undefined
 *   3) 运行时里没有任何地方定义 __devtoolssubcontext（41MB 运行时全包 0 命中），
 *      小游戏只定义 __clientsubcontext，于是适配器里
 *        if ('undefined' == typeof __devtoolssubcontext && 'devtools' === platform) { ... }
 *      这一分支在模拟器里恒成立 ⇒ Object.defineProperty(undefined, ...) 抛原生 TypeError
 *
 * 本脚本不依赖任何第三方包。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || path.join(PROJECT_ROOT, 'build', 'wechatgame', 'web-adapter.js'));

if (!fs.existsSync(target)) {
  console.error(`❌ 找不到模块：${target}`);
  console.error('   先到 Cocos Creator 里执行「构建 → 微信小游戏」。');
  process.exit(1);
}

const src = fs.readFileSync(target, 'utf8');

/**
 * 开发者工具「小程序」包装器的形参表（取自 app.asar 里的 NO_BOM_VAR）。
 * 这些名字在源文件里本是自由变量（引用全局），被开发者工具提升成了形参。
 */
const NO_BOM_VAR = [
  'window', 'top', 'document', 'frames', 'self', 'location', 'navigator', 'localStorage', 'history',
  'Caches', 'screen', 'alert', 'confirm', 'prompt', 'fetch', 'XMLHttpRequest', 'WebSocket', 'webkit',
  'WeixinJSCore', 'Reporter', 'print', 'URL', 'DOMParser', 'requestAnimationFrame', 'getComputedStyle',
  'Node', 'upload', 'preview', 'build', 'showDecryptedInfo', 'cleanAppCache', 'syncMessage', 'checkProxy',
  'showSystemInfo', 'showMyOpenId', 'restoreLocalData', 'openVendor', 'openMiniapp', 'openMiniappBuilder',
  'openMiniappIpa', 'openCrashDir', 'openCache', 'openEngine', 'cleanEngineWASM', 'openEditorCache',
  'openToolsLog', 'showRequestInfo', 'help', 'showDebugInfoTable', 'closeDebug', 'showDebugInfo', '__global',
  'getMessageTunnelInfo', 'loadBabelMod', 'openInspect', 'openUserDataPath', 'WeixinJSBridge',
  '__WeixinJSBridge', '__passWAServiceGlobal__',
];

// ─────────────────────────── 桩环境（够加载模块即可） ───────────────────────────

function makeCanvas() {
  return {
    width: 375, height: 667,
    getContext: () => ctxStub(),
    addEventListener: () => {}, removeEventListener: () => {},
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 375, height: 667 }),
  };
}

function ctxStub() {
  const noop = () => {};
  return new Proxy({}, { get: (t, k) => (k === 'canvas' ? null : k in t ? t[k] : noop) });
}

/** wx 桩：只代理 wx 本身，未知 API 返回 no-op；不代理全局作用域，保证真实异常不被吞掉。 */
function makeWx() {
  const info = {
    platform: 'devtools', windowWidth: 375, windowHeight: 667, pixelRatio: 2,
    SDKVersion: '3.17.4', system: 'iOS 10.0.1', brand: 'devtools', model: 'iPhone 6',
    screenWidth: 375, screenHeight: 667, deviceOrientation: 'portrait', language: 'zh_CN',
  };
  const base = {
    getSystemInfoSync: () => info,
    getSystemInfo: (o) => o && o.success && o.success(info),
    env: { USER_DATA_PATH: '/tmp' },
    getLaunchOptionsSync: () => ({ scene: 1001, query: {} }),
    createCanvas: () => makeCanvas(),
    createImage: () => ({}),
    getFileSystemManager: () => ({}),
    getStorageSync: () => '',
    setStorageSync: () => {},
    onShow: () => {}, onHide: () => {}, onError: () => {},
    onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
    onWindowResize: () => {}, onMemoryWarning: () => {},
  };
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : function () {}),
    has: () => true,
  });
}

function makeDocument() {
  return {
    createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, setAttribute() {} }),
    createElementNS: () => makeCanvas(),
    getElementsByTagName: () => [makeCanvas()],
    addEventListener: () => {}, removeEventListener: () => {},
    body: { appendChild: () => {}, style: {} },
    documentElement: { style: {} },
    readyState: 'complete',
  };
}

function requireStub(name) {
  if (typeof name === 'string' && name.indexOf('@swc/runtime') === 0) {
    if (name.endsWith('_instanceof')) return (o, c) => o instanceof c;
    if (name.endsWith('_type_of')) return (o) => typeof o;
    return function () {};
  }
  throw new Error(`Cannot find module '${name}'`);
}

/** 模拟小游戏运行时进入模块前的全局（运行时 prologue 会置 window = this || {}）。 */
function resetGlobals() {
  delete globalThis.__devtoolssubcontext; // 运行时从不定义它 → 适配器会走 devtools 分支
  delete globalThis.__clientsubcontext;
  globalThis.GameGlobal = globalThis;
  globalThis.wx = makeWx();
  globalThis.window = { navigator: { userAgent: 'MicroMessenger/8.0.5 devtools' } };
}

/** 把「小程序包装」的所有形参都填上值（对照用）。 */
function fullBomArgs(win) {
  const filled = {
    window: win, top: win, self: win, frames: win,
    document: makeDocument(),
    navigator: { userAgent: 'MicroMessenger/8.0.5 devtools' },
    location: { href: 'https://x/', search: '', hash: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    history: {}, Caches: {}, screen: { width: 375, height: 667 },
    alert: () => {}, confirm: () => {}, prompt: () => {},
  };
  return NO_BOM_VAR.map((p) => (p in filled ? filled[p] : undefined));
}

// ─────────────────────────────── 跑三种加载方式 ───────────────────────────────

/** 失败时用栈里的列号回推 bundle 偏移，打印出事处的源码片段。 */
function describeError(err) {
  const lines = [`❌ ${err.constructor.name}: ${err.message}`];
  const frames = String(err.stack || '').split('\n').slice(1, 5)
    .map((l) => l.trim()).filter((l) => !/replay-wechat-bundle/.test(l));
  for (const f of frames) lines.push(`   ${f}`);
  const m = String(err.stack || '').match(/<anonymous>:(\d+):(\d+)/);
  if (m) {
    const off = Math.max(0, parseInt(m[2], 10) - 1);
    lines.push(`   出处在 bundle 偏移 ~${off} 处，源码片段：`);
    lines.push('   ' + src.slice(Math.max(0, off - 200), off + 120).replace(/\n/g, '\n   '));
  }
  return lines.join('\n');
}

/** wx 的 getter 里返回 no-op 函数，避免 dist 的严格模式告警；统一在最后恢复。 */
function runCase(label, params, makeArgs, expectFail) {
  resetGlobals();
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}`);
  console.log(`   define("<module>", (function(${params.join(', ')})){...})`);
  const args = makeArgs();
  console.log(`   运行时传入实参个数：${args.length}`);
  let err = null;
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function(...params, src);
    factory.apply(undefined, args);
    console.log('✅ 加载完成，无异常');
  } catch (e) {
    err = e;
    console.log(describeError(e));
  }
  const failed = !!err;
  return { failed, expected: !!expectFail, ok: failed === !!expectFail, err };
}

console.log('微信小游戏产物「包装器」复现器');
console.log(`模块：${target}（${(src.length / 1024).toFixed(0)} KB）`);
console.log('说明：只做「模块能否加载完」，不启动引擎，不改动任何构建产物。');

const caseA = runCase(
  'A) 小程序包装 + 运行时只传 3 个实参（用户遇到的加载方式）',
  ['require', 'module', 'exports', ...NO_BOM_VAR],
  () => [requireStub, { exports: {} }, {}],
  true,
);

const caseB = runCase(
  'B) 小游戏包装（只有 process 形参）（正确方式）',
  ['require', 'module', 'exports', 'process'],
  () => [requireStub, { exports: {} }, {}, { platform: 'devtools', env: {} }],
  false,
);

const caseC = runCase(
  'C) 对照：仍按小程序包装，但注入真 window',
  ['require', 'module', 'exports', ...NO_BOM_VAR],
  () => [requireStub, { exports: {} }, {}, ...fullBomArgs({ navigator: { userAgent: 'MicroMessenger/8.0.5 devtools' } })],
  false,
);

// ───────────────────────────────── 结论 ─────────────────────────────────

console.log('\n' + '─'.repeat(62));
if (!caseB.failed) {
  console.log('结论：本产物在「小游戏包装」下能正常加载 ⇒ 产物本身没问题。');
} else {
  console.log('结论：连「小游戏包装」都加载失败 ⇒ 这是产物/代码本身的缺陷，需要单独排查（见上面的源码片段）。');
}
if (caseA.failed) {
  console.log('      在「小程序包装」下必崩 ⇒ 崩溃由开发者工具的包装选择决定，不是构建内容问题。');
}
if (caseA.failed && !caseC.failed) {
  console.log('      对照 C 只把 window 换成真对象就恢复正常 ⇒ 差异确实只在传参/包装。');
}
console.log('');
console.log('若 A 崩而 B 正常：说明开发者工具把这个项目编译成了「小程序」而不是「小游戏」。');
console.log('原因与处置见 docs/tech/wechat-build-pitfalls.md §8（AppID 是否为小游戏 / 导入类型）。');

process.exit(caseB.failed ? 1 : 0);
