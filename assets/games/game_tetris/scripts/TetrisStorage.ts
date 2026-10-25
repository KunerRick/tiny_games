/**
 * 方块坠落 — 存档读写。
 *
 * 统一走公共 `StorageManager`（键前缀 `tiny_games_tetris_`），
 * 读出失败/脏数据一律回退默认值，**不让存档问题变成启动崩溃**。
 */

import { StorageManager } from '../../../common/managers/StorageManager';
import {
    STORAGE_BEST_LINES,
    STORAGE_BEST_SCORE,
    STORAGE_CONTROL_MODE,
    STORAGE_GAMES_PLAYED,
    STORAGE_HINT_USED,
    STORAGE_TUTORIAL_DONE,
    STORAGE_VIBRATE,
} from './TetrisConfig';
import { ControlMode } from './TetrisInput';

const GAME_ID = 'tetris';

function read(key: string): string | null {
    return StorageManager.instance.getItem(GAME_ID, key);
}

function write(key: string, value: string): void {
    StorageManager.instance.setItem(GAME_ID, key, value);
}

function readNumber(key: string, fallback: number): number {
    const raw = read(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export interface ScoreResult {
    bestScore: number;
    bestLines: number;
    /** 本局是否刷新最高分（0 分不算） */
    isNewBest: boolean;
}

export class TetrisStorage {
    // ==================== 最高分 / 最高行数 ====================

    static getBestScore(): number {
        return readNumber(STORAGE_BEST_SCORE, 0);
    }

    static getBestLines(): number {
        return readNumber(STORAGE_BEST_LINES, 0);
    }

    /** 一局结束：更新纪录并累加局数，返回结算用的数据 */
    static submitScore(score: number, lines: number): ScoreResult {
        const safeScore = Math.max(0, Math.floor(score));
        const safeLines = Math.max(0, Math.floor(lines));

        const prevScore = TetrisStorage.getBestScore();
        const prevLines = TetrisStorage.getBestLines();

        const bestScore = Math.max(prevScore, safeScore);
        const bestLines = Math.max(prevLines, safeLines);

        if (bestScore !== prevScore) write(STORAGE_BEST_SCORE, String(bestScore));
        if (bestLines !== prevLines) write(STORAGE_BEST_LINES, String(bestLines));

        TetrisStorage.setGamesPlayed(TetrisStorage.getGamesPlayed() + 1);

        return { bestScore, bestLines, isNewBest: safeScore > prevScore };
    }

    // ==================== 设置 ====================

    /** 默认全屏手势（推荐）；存档里是脏值时也回退到它 */
    static getControlMode(): ControlMode {
        return read(STORAGE_CONTROL_MODE) === 'button' ? 'button' : 'gesture';
    }

    static setControlMode(mode: ControlMode): void {
        write(STORAGE_CONTROL_MODE, mode);
    }

    /** 默认开震动 */
    static getVibrate(): boolean {
        return read(STORAGE_VIBRATE) !== '0';
    }

    static setVibrate(on: boolean): void {
        write(STORAGE_VIBRATE, on ? '1' : '0');
    }

    // ==================== 引导 ====================

    static isTutorialDone(): boolean {
        return read(STORAGE_TUTORIAL_DONE) === '1';
    }

    static setTutorialDone(): void {
        write(STORAGE_TUTORIAL_DONE, '1');
    }

    static getGamesPlayed(): number {
        return readNumber(STORAGE_GAMES_PLAYED, 0);
    }

    static setGamesPlayed(count: number): void {
        write(STORAGE_GAMES_PLAYED, String(Math.max(0, Math.floor(count))));
    }

    /** 已完成的提示条目（如 `'drag'` / `'tap'` / `'softdrop'`），逗号分隔 */
    static getHintUsed(): string[] {
        const raw = read(STORAGE_HINT_USED);
        if (!raw) return [];
        const out: string[] = [];
        for (const part of raw.split(',')) {
            const key = part.trim();
            if (key && out.indexOf(key) < 0) out.push(key);
        }
        return out;
    }

    static markHintUsed(key: string): string[] {
        const used = TetrisStorage.getHintUsed();
        if (used.indexOf(key) < 0) {
            used.push(key);
            write(STORAGE_HINT_USED, used.join(','));
        }
        return used;
    }
}
