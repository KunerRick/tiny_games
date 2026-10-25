/**
 * 方块坠落 — 平台能力封装：震动、常亮（设计文档 §5.4、§8）。
 *
 * 浏览器预览里没有 `wx`，微信基础库过低时也可能缺这两个接口 ——
 * 一律用 `try/catch` 包住并静默跳过，**不能让平台差异变成启动崩溃**。
 */

declare const wx: any;

/** 落地/消行震动；`enabled` 来自设置（暂停面板可关） */
export function vibrateShort(enabled: boolean): void {
    if (!enabled) return;
    try {
        if (typeof wx !== 'undefined' && wx && typeof wx.vibrateShort === 'function') {
            wx.vibrateShort({ type: 'light' });
        }
    } catch (err) {
        // 部分机型/基础库不支持，忽略
    }
}

/** 小游戏常亮：长时间盯着方块，熄屏体验很差 */
export function keepScreenOn(): void {
    try {
        if (typeof wx !== 'undefined' && wx && typeof wx.setKeepScreenOn === 'function') {
            wx.setKeepScreenOn({ keepScreenOn: true });
        }
    } catch (err) {
        // 同上，忽略
    }
}
