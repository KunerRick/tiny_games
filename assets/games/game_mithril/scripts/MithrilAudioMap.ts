/**
 * 《秘银远征》战斗事件 → 音效名 的纯映射表。
 *
 * 为什么单独一个文件：`MithrilAudio.ts` 依赖 `cc`（`GameAudio` 用 `sys.localStorage`），
 * 无法在 Node 里编译；但「哪个事件该响哪一声」是最容易拼错、拼错又**不会报错**的一层
 * （`GameAudio.play()` 收到未知名字直接静默）。把这张表剥成零 import 的纯模块后，
 * `tools/verify-mithril-audio.js` 可以单独编译它并逐条断言。
 *
 * 约定：
 *  - 一个事件最多一声；密集节流（gap）由 `GameAudio` 的配方表负责，这里不重复处理。
 *  - 「必须静默」的事件也显式写在注释里，改表时不要顺手加回去。
 *  - 音效名是 `common/audio/GameAudio.ts` 的 `SfxName` 子集；新增名字要同步那边配方。
 */

/** 秘银远征用到的音效名（`SfxName` 的子集，拼错 = 静默，脚本会拦） */
export type MithrilSfx =
    | 'hit' | 'playerHit' | 'kill' | 'pickup' | 'boom' | 'secret'
    | 'core' | 'clear' | 'active' | 'won' | 'dead' | 'coin' | 'click';

/**
 * `CoreEvent` 的最小形状：只声明映射要用到的三个字段（type / target / stage）。
 * 不直接 import `MithrilCore` 的类型 —— 那会把整条纯逻辑依赖拖进本文件，
 * 也会让本文件在 `tools/verify-mithril-audio.js` 里被一起编译（不需要）。
 */
export interface MithrilEventLike {
    type: string;
    target?: string;
    stage?: string;
}

/**
 * 事件 → 音效（`null` = 静默）。
 *
 * 静默清单（刻意不出声）：
 *  - `swing` / `whirl` / `charge` / `dodge`：玩家自己的动作，频率高（普攻 0.4 s 一刀），出声会糊成噪声。
 *  - `castStart` / `castEnd`：BOSS 读条已有横幅 + 进度条，再加声音会跟横幅抢注意力。
 *  - `regen`：BOSS 的持续回血，周期性触发，只在数值上可见即可。
 *  - `stage === 'encounter'`：普通波次开场，不是「值得强调」的节点。
 */
export function coreEventSfx(ev: MithrilEventLike): MithrilSfx | null {
    if (!ev || typeof ev.type !== 'string') return null;
    switch (ev.type) {
        case 'damage':
            // 打敌人 / 挨打要分开：挨打自带 medium 震动，是玩家最需要感知的一类
            if (ev.target === 'player') return 'playerHit';
            if (ev.target === 'enemy') return 'hit';
            return null;
        case 'kill': return 'kill';
        case 'heal': return 'pickup';
        case 'boom':
        case 'blast': return 'boom';
        case 'lightning': return 'secret';
        case 'phase': return 'core';
        case 'enrage': return 'active';
        case 'stage':
            if (ev.stage === 'boss') return 'active';
            if (ev.stage === 'cleared') return 'clear';
            return null;
        default: return null;
    }
}
