/**
 * 《秘银远征》HUD —— 顶栏（生命 / 怒气 / 进度）、BOSS 血条与读条、技能键、阶段横幅、结算面板。
 *
 * 全部节点运行时创建（与 FridgeHud 一致），场景里只挂 Canvas + GameRoot。
 * 技能键的按下状态通过 `held` 暴露给主组件；HUD 本身不碰核心状态。
 *
 * 约定：onDestroy 只清引用（红线 4）；handler 全部命名方法（红线 5）；
 *       文字直接 set Label.string，不放任何图标字符（红线 10）。
 */

import { _decorator, BlockInputEvents, Color, Component, EventTouch, Graphics, Label, Node, UIOpacity, UITransform } from 'cc';
import {
    createButton, createLabel, hex,
} from '../../../common/ui/GameUIKit';
import type { CoreEvent, MithrilSnapshot } from './MithrilCore';
import { sfx } from './MithrilAudio';
import { CLASS_KITS, PLAYER_TUNING, GEAR_BASE_BY_ID, GEAR_SLOT_NAMES, QUALITY_BY_ID } from './MithrilConfig';
import type { ClassId, EquipItem } from './MithrilConfig';
import { SKILL_GLYPH_KIND, addGlyphNode, drawMithrilGlyph } from './MithrilArt';
import { MITH_UI as T, addButtonSheen, drawDiamond, drawStoneTrim } from './MithrilTheme';

const { ccclass } = _decorator;

export type SkillKey = 'basic' | 'skill1' | 'skill2' | 'skill3' | 'burst' | 'dodge';

/** HUD 技能位 → 技能表后缀（六位同名，图形也共用一套） */
const SKILL_SLOT_OF: Record<SkillKey, string> = {
    basic: 'basic',
    skill1: 'a1',
    skill2: 'a2',
    skill3: 'a3',
    dodge: 'dodge',
    burst: 'burst',
};

interface SkillBtn {
    key: SkillKey;
    node: Node;
    g: Graphics;
    label: Label;
    cdLabel: Label;
    /** 技能图形（N85）：圆形色块上叠一个白色图标 */
    glyph: Node;
    glyphKind: string;
    glyphRadius: number;
    /** 上次画图标时的可用状态：只在状态翻转时重画，不在每帧重绘 */
    glyphReady: boolean | null;
    size: number;
    color: string;
    /** 冷却总时长（秒），来自 PLAYER_TUNING */
    total: number;
    pressed: boolean;
}

const SKILL_NAME: Record<SkillKey, string> = {
    basic: '劈砍',
    skill1: '冲锋',
    skill2: '旋风',
    skill3: '破甲',
    burst: '血怒',
    dodge: '侧步',
};

/**
 * 技能键两字文案（按职业，取自技能面板全名的前两字 / 可辨识缩写）。
 * 体验官 E1：单字「斩/冲/旋」和技能面板「劈砍/冲锋/旋风斩」对不上，新玩家不知道
 * 右下哪个键是「按住就持续攻击」的普攻，所以键面直接写两字，与面板同名。
 */
const CLASS_SKILL_NAME: Record<ClassId, Record<SkillKey, string>> = {
    warrior: SKILL_NAME,
    mage: { basic: '奥弹', skill1: '火球', skill2: '冰霜', skill3: '闪现', burst: '强化', dodge: '屏障' },
    ranger: { basic: '射击', skill1: '多重', skill2: '陷阱', skill3: '后跃', burst: '鹰眼', dodge: '翻滚' },
    priest: { basic: '圣光', skill1: '治疗', skill2: '神圣', skill3: '守护', burst: '圣能', dodge: '圣步' },
};

/**
 * 资源条配色：怒气 / 法力 / 能量 / 圣能（第 26 轮改成珠宝色，去掉 Tailwind 荧光）。
 * 三条资源条上都压着羊皮纸数值，所以底色必须压到 ≥4.9:1：
 * rage `#7A5612` 5.14、mana `#35608F` 5.14、energy `#306845` 4.91（holy 只做 6px 细条，无文字）。
 */
const RESOURCE_COLOR: Record<string, string> = {
    rage: '#7A5612',
    mana: '#35608F',
    energy: '#306845',
    holy: '#C9A227',
};

/** 资源条「够放爆发」的亮边档：只做描边，不换填充（换亮色会把数值压回 1.5:1） */
const RESOURCE_BRIGHT: Record<string, string> = {
    rage: '#E8B04B',
    mana: '#6FB6D9',
    energy: '#7FC08F',
    holy: '#F0D77B',
};

/**
 * 技能键宝石色（第 26 轮）：Tailwind 荧光 → 珠宝色。
 * 普攻是主操作，用黄铜并配墨色图形；其余键只做身份色，不与金色抢层级。
 * 六枚都压到「面上的字 ≥4.5:1」：冷色三枚（skill1/skill2/dodge）原来只有 3.4–4.3，第 26 轮复核后压深一档。
 */
const SKILL_FILL: Record<SkillKey, string> = {
    basic: '#B08C1E',
    skill1: '#2E5C90',
    skill2: '#614A9E',
    skill3: '#B4761F',
    dodge: '#3A6E48',
    burst: '#A33B3B',
};

/**
 * 宝石面上的文字/图形用哪个色。两枚暖金宝石（普攻、破甲）上的羊皮纸字只有
 * 2.5–3.0:1，远看就糊成一团，改用墨色（5.4 / 4.5:1）；冷色与红绿宝石压深后
 * 浅字 4.7–5.5:1，仍用 `parchment`。墨色图形需要更高不透明度才立得住，故按色给两档 alpha。
 */
const SKILL_TONE: Record<SkillKey, { text: string; glyph: number; glyphDim: number }> = {
    basic: { text: T.ink, glyph: 210, glyphDim: 70 },
    skill1: { text: T.parchment, glyph: 125, glyphDim: 42 },
    skill2: { text: T.parchment, glyph: 125, glyphDim: 42 },
    skill3: { text: T.ink, glyph: 210, glyphDim: 70 },
    dodge: { text: T.parchment, glyph: 125, glyphDim: 42 },
    burst: { text: T.parchment, glyph: 125, glyphDim: 42 },
};

/** 成长信息（MithrilGame 每次刷新顶栏前喂进来） */
export interface GrowthInfo {
    level: number;
    exp: number;
    /** 升到下一级所需经验；满级传 Infinity */
    expNeed: number;
    books: number;
    /** 够级但还没选的变体数量 */
    pending: number;
    /** 可分配天赋点 */
    points: number;
}

const DEFAULT_GROWTH: GrowthInfo = {
    level: 1, exp: 0, expNeed: Infinity, books: 0, pending: 0, points: 0,
};

@ccclass('MithrilHud')
export class MithrilHud extends Component {
    /** 左上角返回（由 MithrilGame 接到 SceneManager.gotoLobby） */
    onExit: (() => void) | null = null;
    /** 结算面板「再来一次」 */
    onRestart: (() => void) | null = null;
    /** 结算面板「装备」 */
    onOpenBag: (() => void) | null = null;
    /** 结算面板「成长」 */
    onOpenGrowth: (() => void) | null = null;
    /** 战斗中返回 → 暂停层选「返回路线图」 */
    onBackToMap: (() => void) | null = null;
    /** 首战操作引导已学会（累计 3 击杀 / 按住普攻满 1 秒，**且**走位累计 ≥120 像素） */
    onCombatHintDone: (() => void) | null = null;

    /** 各技能键当前是否按住（主组件每帧读取） */
    readonly held: Record<SkillKey, boolean> = {
        basic: false, skill1: false, skill2: false, skill3: false, burst: false, dodge: false,
    };

    private _barGfx: Graphics | null = null;
    private _hpLabel: Label | null = null;
    private _rageLabel: Label | null = null;
    /** 饰品 / 协同 proc 一行小字（M7） */
    private _procLabel: Label | null = null;
    private _expLabel: Label | null = null;
    private _progressLabel: Label | null = null;
    private _timerLabel: Label | null = null;

    private _growth: GrowthInfo = { ...DEFAULT_GROWTH };
    /** 升级横幅：优先于副本阶段横幅显示，按 HUD 刷新节拍倒数 */
    private _growthTitle = '';
    private _growthSub = '';
    private _growthTimer = 0;

    private _bannerTitle: Label | null = null;
    private _bannerSub: Label | null = null;
    /** 横幅底板：文字浮在场景上读不清，给标题一个「石牌」底面（第 26 轮） */
    private _bannerPlate: Node | null = null;
    private _bannerOpacity: UIOpacity | null = null;
    private _bannerKey = '';

    private _bossRoot: Node | null = null;
    private _bossGfx: Graphics | null = null;
    private _bossName: Label | null = null;
    private _bossHpText: Label | null = null;
    private _bossHint: Label | null = null;
    private _castGfx: Graphics | null = null;
    private _castLabel: Label | null = null;

    private _skills: SkillBtn[] = [];

    private _resultRoot: Node | null = null;
    private _resultTitle: Label | null = null;
    /** 结算「上下文」行：地点 / 用时 / 推进（暗色小字，与收益分开） */
    private _resultSub: Label | null = null;
    /** 上下文与收益之间的细分隔线（无收益时连同正文一起隐藏） */
    private _resultMidRule: Node | null = null;
    private _resultBody: Label | null = null;
    private _resultShown = false;
    private _lootLines: string[] = [];
    private _rewardLines: string[] = [];
    private _lastWin = false;
    private _lastTimeText = '0:00';
    private _lastKills = 0;
    private _lastDungeonName = '';
    private _lastProgress = '';

    /** 结算文案可被主组件按模式覆盖（副本 / 野外节点） */
    private _resultWinTitle = '副本通关';
    private _resultWinLine = '矿坑巨魔已被击败';
    private _resultLoseTitle = '你倒下了';
    private _restartLabel = '再来一次';
    private _againBtn: ReturnType<typeof createButton> | null = null;

    private _lastHp = -1;
    private _lastRage = -1;
    /** 当前职业（技能键文案与资源条按它切换；首次快照时同步） */
    private _classId: ClassId = 'warrior';

    // ---- 首战操作引导（体验官 E1）：不是 once-only toast，学会才关 ----
    private _hintRoot: Node | null = null;
    private _hintLabel: Label | null = null;
    private _hintActive = false;
    /** 提示出现时的击杀数基线；第一次 updateHud 时按真实快照校准 */
    private _hintBaseKills = -1;
    /** 按住普攻累计秒数（HUD 刷新节拍 0.1s） */
    private _hintHold = 0;
    /**
     * 首战提示期间累计走位距离（世界像素）。
     * 试玩 N133：原判定「按住普攻 1 秒」就算学会，导致站桩输出 1 秒后提示消失，
     * 玩家仍不知道要「边打边走」。现在必须真的移动过（≥120）才收起提示。
     */
    private _hintTravelled = 0;
    private _hintLastX: number | null = null;
    private _hintLastY: number | null = null;

    // ---- 暂停层（体验官 E4）：战斗中返回不再直接换场景 ----
    private _pauseRoot: Node | null = null;
    private _pauseAudioBtn: ReturnType<typeof createButton> | null = null;
    private _paused = false;

    /** 圆键里的字号：两字比单字再缩一点，保证 84–112px 的键面不折行 */
    private _skillFontSize(text: string, size: number): number {
        return Math.round(size * (text.length > 1 ? 0.26 : 0.34));
    }

    /** 职业切换时改技能键文案与冷却总时长（只改文案与数值，不动布局） */
    private _syncClass(snap: MithrilSnapshot): void {
        if (!snap.classId || snap.classId === this._classId) return;
        this._classId = snap.classId;
        const kit = CLASS_KITS[snap.classId] || CLASS_KITS.warrior;
        const names = CLASS_SKILL_NAME[snap.classId] || CLASS_SKILL_NAME.warrior;
        for (const b of this._skills) {
            const text = names[b.key];
            b.label.string = text;
            b.label.fontSize = this._skillFontSize(text, b.size);
            b.label.lineHeight = Math.round(b.label.fontSize * 1.15);
            if (b.key === 'basic') b.total = kit.basic.cd;
            else if (b.key === 'skill1') b.total = kit.a1.cd;
            else if (b.key === 'skill2') b.total = kit.a2.cd;
            else if (b.key === 'skill3') b.total = kit.a3.cd;
            else if (b.key === 'dodge') b.total = kit.dodge.cd;
            else if (b.key === 'burst') b.total = kit.burst.cd;
        }
        if (this._hintActive) this._refreshHintText();
    }

    onLoad(): void {
        // 先铺上下两道暗角：HUD 的读数与技能键都压在场景上，需要一层「背景的背面」
        this._buildScrim();
        this._buildBars();
        this._buildBanner();
        this._buildBossBar();
        this._buildSkills();
        this._buildExit();
    }

    onDestroy(): void {
        // 只清引用，不访问任何父节点 / @property（红线 4）
        this._barGfx = null;
        this._hpLabel = null;
        this._rageLabel = null;
        this._expLabel = null;
        this._progressLabel = null;
        this._timerLabel = null;
        this._procLabel = null;
        this._bannerTitle = null;
        this._bannerSub = null;
        this._bannerPlate = null;
        this._bannerOpacity = null;
        this._bossRoot = null;
        this._bossGfx = null;
        this._bossName = null;
        this._bossHpText = null;
        this._bossHint = null;
        this._castGfx = null;
        this._castLabel = null;
        this._skills.length = 0;
        this._resultRoot = null;
        this._resultTitle = null;
        this._resultSub = null;
        this._resultMidRule = null;
        this._resultBody = null;
        this._hintRoot = null;
        this._hintLabel = null;
        this._pauseRoot = null;
        this._pauseAudioBtn = null;
    }

    // ==================== 对外 ====================

    updateHud(snap: MithrilSnapshot): void {
        this._syncClass(snap);
        this._drawTopBars(snap);
        this._updateBanner(snap);
        this._updateBoss(snap);
        this._updateSkills(snap);
        this._tickCombatHint(snap);
        if (snap.phase !== 'playing') this._showResult(snap);
    }

    onEvents(events: CoreEvent[]): void {
        for (const ev of events) {
            if (ev.type === 'castStart') {
                this._bannerKey = '';
            }
        }
    }

    /** 重开一局：收掉结算面板并重置按钮状态 */
    resetForNewRun(): void {
        this._resultShown = false;
        this._lootLines = [];
        this._rewardLines = [];
        this._growthTimer = 0;
        if (this._resultRoot) this._resultRoot.active = false;
        for (const key of Object.keys(this.held) as SkillKey[]) this.held[key] = false;
        for (const b of this._skills) b.pressed = false;
        this.closePause();
        this.hideCombatHint();
        this._lastHp = -1;
        this._lastRage = -1;
    }

    // ==================== 首战操作引导（E1） ====================

    /**
     * 首战内嵌提示：讲清「按住普攻持续攻击」和「移动自动朝向」。
     * 与 once-only 的 tutorial toast 不同，它由 `combatHintDone` 存档位控制 ——
     * 玩家没学会之前，每场战斗开头都会再出现，学会（3 击杀 / 按住 1 秒，且走位 ≥120 像素）才永久关闭。
     */
    showCombatHint(): void {
        this._buildHint();
        this._hintActive = true;
        this._hintBaseKills = -1;
        this._hintHold = 0;
        this._hintTravelled = 0;
        this._hintLastX = null;
        this._hintLastY = null;
        this._refreshHintText();
        if (this._hintRoot) {
            this._hintRoot.active = true;
            this._hintRoot.setSiblingIndex(this.node.children.length - 1);
        }
    }

    hideCombatHint(): void {
        this._hintActive = false;
        if (this._hintRoot) this._hintRoot.active = false;
    }

    private _basicName(): string {
        const names = CLASS_SKILL_NAME[this._classId] || CLASS_SKILL_NAME.warrior;
        return names.basic;
    }

    private _refreshHintText(): void {
        if (this._hintLabel) {
            // 试玩 N145：只教「边打边走」不够 —— 只走位不追的输入 30 分钟 0 胜 19 死。
            // 真正的解法是追远程（远程保持 keep=260 会后撤），第三行必须写出来。
            this._hintLabel.string = `按住「${this._basicName()}」持续攻击，边打边走\n移动会自动朝向最近的敌人\n远程敌人会后撤：追上去再打`;
        }
    }

    private _tickCombatHint(snap: MithrilSnapshot): void {
        if (!this._hintActive) return;
        // 结算 / 死亡时安静收掉：这不代表「学会」，下一场开局还会再提示
        if (snap.phase !== 'playing') {
            this.hideCombatHint();
            return;
        }
        if (this._hintBaseKills < 0) this._hintBaseKills = snap.kills;
        // 学会「边打边走」必须真的走过位：只站桩输出不收起提示。
        // 单次位移 >150 视为闪现 / 传送，不计入（HUD 节拍 0.1s，正常移速约 20–40）。
        if (this._hintLastX !== null && this._hintLastY !== null) {
            const dx = snap.player.x - this._hintLastX;
            const dy = snap.player.y - this._hintLastY;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > 0 && d < 150) this._hintTravelled += d;
        }
        this._hintLastX = snap.player.x;
        this._hintLastY = snap.player.y;
        // updateHud 的节拍是 HUD_REFRESH(0.1s)
        if (this.held.basic) this._hintHold += 0.1;
        else this._hintHold = 0;
        const attacked = snap.kills - this._hintBaseKills >= 3 || this._hintHold >= 0.999;
        if (attacked && this._hintTravelled >= 120) this._learnCombatHint();
    }

    private _learnCombatHint(): void {
        if (!this._hintActive) return;
        this.hideCombatHint();
        if (this.onCombatHintDone) this.onCombatHintDone();
    }

    private _buildHint(): void {
        if (this._hintRoot) return;
        // 位置约束：牌位上沿 255、BOSS 条下沿 454、技能键最高点 −306（触顶约 306），
        // 所以 300–450 是战斗中唯一的空带；提示放 386，不压任何常驻信息。
        const root = new Node('CombatHint');
        root.layer = this.node.layer;
        const ut = root.addComponent(UITransform);
        ut.setContentSize(600, 124);
        root.setPosition(0, 386, 0);
        this.node.addChild(root);
        this._hintRoot = root;

        // 提示是二级信息：不画第二张卡片，只画一条暗色飘带 + 上下收短的细金线。
        // 与标题牌位（一级：石底 + 双线 + 菱形）拉开层级 —— 两张同宽的框叠在一起
        // 会被读成「一张拼歪的卡」，这是本轮被点名的不协调之一。
        const g = root.addComponent(Graphics);
        g.fillColor = hex(T.night, 212);
        g.roundRect(-300, -62, 600, 124, 8);
        g.fill();
        g.fillColor = hex(T.goldLine, 205);
        g.rect(-256, 61, 512, 1.5);
        g.fill();
        g.rect(-256, -62.5, 512, 1.5);
        g.fill();
        // 左端一颗菱形题花，替代卡片外框承担「这是一条提示」的识别
        drawDiamond(g, -282, 0, 5, T.goldDim, 190);

        this._hintLabel = createLabel(root, '', 22, {
            width: 500, height: 104, color: T.parchment, bold: true, lineHeight: 34,
        });
        this._refreshHintText();
        root.active = false;
    }

    // ==================== 暂停层（E4） ====================

    /** 暂停期间主组件应跳过 update（核心状态冻结） */
    isPaused(): boolean {
        return this._paused;
    }

    closePause(): void {
        this._paused = false;
        this.releaseAllHeld();
        if (this._pauseRoot) this._pauseRoot.active = false;
    }

    private _openPause(): void {
        this._buildPause();
        if (!this._pauseRoot) return;
        this.releaseAllHeld();
        this._refreshPauseAudio();
        this._paused = true;
        this._pauseRoot.active = true;
        this._pauseRoot.setSiblingIndex(this.node.children.length - 1);
    }

    private _onBackTap = (): void => {
        // 结算面板已经在顶层时，返回键语义就是「离开」，不再叠一层暂停
        if (this._resultShown) {
            if (this.onExit) this.onExit();
            return;
        }
        this._openPause();
    };

    private _onPauseResume = (): void => {
        this.closePause();
    };

    private _onPauseMap = (): void => {
        this.closePause();
        if (this.onBackToMap) this.onBackToMap();
    };

    private _onPauseLobby = (): void => {
        this.closePause();
        if (this.onExit) this.onExit();
    };

    private _onPauseAudio = (): void => {
        sfx.toggle();
        this._refreshPauseAudio();
    };

    private _refreshPauseAudio(): void {
        if (this._pauseAudioBtn) {
            this._pauseAudioBtn.setText(sfx.sfxOn || sfx.vibOn ? '音效与震动：开' : '音效与震动：关');
        }
    }

    private _buildPause(): void {
        if (this._pauseRoot) return;
        const root = new Node('Pause');
        root.layer = this.node.layer;
        const ut = root.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        this.node.addChild(root);
        this._pauseRoot = root;

        const mask = new Node('Mask');
        mask.layer = this.node.layer;
        const mut = mask.addComponent(UITransform);
        mut.setContentSize(720, 1280);
        const mg = mask.addComponent(Graphics);
        mg.fillColor = hex(T.night, 235);
        mg.rect(-360, -640, 720, 1280);
        mg.fill();
        mask.addComponent(BlockInputEvents);
        root.addChild(mask);

        const panel = new Node('Panel');
        panel.layer = this.node.layer;
        const put = panel.addComponent(UITransform);
        put.setContentSize(520, 470);
        const pg = panel.addComponent(Graphics);
        pg.fillColor = hex(T.stone, 255);
        pg.roundRect(-260, -235, 520, 470, 20);
        pg.fill();
        pg.strokeColor = hex(T.gold, 210);
        pg.lineWidth = 2;
        pg.roundRect(-260, -235, 520, 470, 20);
        pg.stroke();
        drawStoneTrim(pg, 520, 470, 20);
        root.addChild(panel);

        // 面板内标题：上方一条金线 + 羊皮纸标题，和营地页头同一套读法
        const headG = new Node('PanelHead');
        headG.layer = this.node.layer;
        headG.addComponent(UITransform).setContentSize(520, 470);
        const hg = headG.addComponent(Graphics);
        hg.fillColor = hex(T.goldDim, 150);
        hg.rect(-140, 141.25, 280, 1.5);
        hg.fill();
        drawDiamond(hg, 0, 142, 5, T.goldBright, 235);
        panel.addChild(headG);
        headG.setSiblingIndex(0);

        createLabel(panel, '暂停', 40, {
            width: 460, height: 52, color: T.parchment, bold: true, y: 176,
        });
        createLabel(panel, '离开时当前生命保留\n再进本节点算重新挑战，会再扣一次入场消耗', 18, {
            width: 440, height: 64, color: T.parchmentDim, lineHeight: 28, y: 100,
        });

        const w = 156;
        const h = 58;
        const resume = createButton(panel, {
            w, h, text: '继续战斗', fontSize: 22,
            fill: T.gold, textColor: T.ink, activeFill: T.goldPressed,
            radius: 14, onTap: () => this._onPauseResume(),
        });
        resume.node.setPosition(0, 22, 0);

        const map = createButton(panel, {
            w, h, text: '返回路线图', fontSize: 20,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 14, onTap: () => this._onPauseMap(),
        });
        map.node.setPosition(-120, -54, 0);

        const lobby = createButton(panel, {
            w, h, text: '返回大厅', fontSize: 22,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 14, onTap: () => this._onPauseLobby(),
        });
        lobby.node.setPosition(120, -54, 0);

        // 音效开关（报告 §8：战斗中想静音不必退出场景）
        this._pauseAudioBtn = createButton(panel, {
            w: 250, h: 48, text: '音效与震动：开', fontSize: 19,
            fill: T.stoneDark, textColor: T.parchmentDim, activeFill: T.stonePressed,
            radius: 12, onTap: () => this._onPauseAudio(),
        });
        this._pauseAudioBtn.node.setPosition(0, -140, 0);

        root.active = false;
    }

    /** 等级 / 经验 / 技能书 / 待选变体（每次刷顶栏前调用，值没变也只是覆盖几个字段） */
    setGrowthInfo(info: GrowthInfo): void {
        this._growth = info;
    }

    /**
     * 结算文案按模式覆盖：副本节点显示「副本通关」，野外节点显示「战斗胜利 / 首领已击败」，
     * 主按钮也从「再来一次」变成「返回路线图」。不传的字段保持上一次的值。
     */
    setResultMode(cfg: {
        winTitle?: string;
        winLine?: string;
        loseTitle?: string;
        againLabel?: string;
    }): void {
        if (cfg.winTitle !== undefined) this._resultWinTitle = cfg.winTitle;
        if (cfg.winLine !== undefined) this._resultWinLine = cfg.winLine;
        if (cfg.loseTitle !== undefined) this._resultLoseTitle = cfg.loseTitle;
        if (cfg.againLabel !== undefined) {
            this._restartLabel = cfg.againLabel;
            if (this._againBtn) {
                this._againBtn.setText(cfg.againLabel);
                // 「返回路线图」比「再来一次」长一个字，22 号字在 112 宽的按钮里会被折成两行，
                // 长标签统一压到 17 号并关掉换行（SHRINK 会先换行再缩，救不回来）
                this._againBtn.label.fontSize = cfg.againLabel.length >= 5 ? 17 : 22;
            }
        }
        if (this._resultShown) this._refreshResultBody();
    }

    /**
     * 升级横幅。走 HUD 自己的计时器而不是 `toast`：
     * 升级发生在战斗中，底部 toast 会被技能键压住，而这里是屏幕中上方的固定视线区。
     */
    showGrowthBanner(title: string, sub: string, seconds = 2.2): void {
        this._growthTitle = title;
        this._growthSub = sub;
        this._growthTimer = seconds;
        this._bannerKey = '';
    }

    /**
     * 结算面板的收益行（金币 / 经验 / 技能书 / 首通奖励）。
     * 由 MithrilGame 在判定通关后、updateHud 之前调用。
     */
    setRewardLines(lines: string[]): void {
        // 早先只留 4 行，首通副本在「本局收益 + 材料 + 补给扣血 + 料理」之后
        // 会把「首通奖励：经验 +800」和技能书整行截掉，玩家只看到普通收益（试玩 N67）。
        // 结算正文实测能容纳 8–9 行（第 22 轮），放到 8 行；再多仍截断，避免压到按钮。
        this._rewardLines = lines.slice(0, 8);
        if (this._resultShown) this._refreshResultBody();
    }

    /**
     * 结算面板展示本局掉落。由 MithrilGame 在判定通关后、updateHud 之前调用，
     * 所以正常路径下 `_showResult` 首次构建正文时就能读到这些行。
     */
    setLootItems(items: EquipItem[]): void {
        this._lootLines = [];
        for (const item of items.slice(0, 3)) {
            const base = GEAR_BASE_BY_ID[item.baseId];
            const q = QUALITY_BY_ID[item.quality];
            this._lootLines.push(
                `获得 ${q ? q.name : ''}·${base ? base.name : item.baseId}（${GEAR_SLOT_NAMES[item.slot]} ${item.ilvl}）`,
            );
        }
        if (this._resultShown) this._refreshResultBody();
    }

    // ==================== 顶栏 ====================

    /**
     * 上下两道暗角（第 26 轮）：顶栏读数与右下技能键直接压在战场上，
     * 背景一亮（篝火光、技能特效）就开始和 HUD 抢对比。用「夜色 → 透明」的递减弱带
     * 给两块 HUD 各铺一层背衬，纯 Graphics，不用渐变贴图。
     */
    private _buildScrim(): void {
        const g = this._makeGfxNode('HudScrim', 720, 1280, 0, 0);
        const bands = 14;
        for (let i = 0; i < bands; i++) {
            const t = i / (bands - 1);
            const a = Math.round(150 * Math.pow(1 - t, 1.7));
            if (a <= 0) continue;
            g.fillColor = hex(T.night, a);
            g.rect(-360, 640 - (i + 1) * 20, 720, 21);
            g.fill();
        }
        for (let i = 0; i < bands; i++) {
            const t = i / (bands - 1);
            const a = Math.round(120 * Math.pow(t, 1.7));
            if (a <= 0) continue;
            g.fillColor = hex(T.night, a);
            g.rect(-360, -640 + i * 18, 720, 19);
            g.fill();
        }
        // 垫在所有 HUD 元素之下（返回键最后会再抬到最上层）
        g.node.setSiblingIndex(0);
    }

    private _buildBars(): void {
        this._barGfx = this._makeGfxNode('TopBars', 720, 160, 0, 0);
        this._hpLabel = createLabel(this.node, '', 15, {
            width: 300, height: 18, color: T.parchment, bold: true, x: -80, y: 604,
        });
        this._rageLabel = createLabel(this.node, '', 13, {
            width: 300, height: 16, color: T.parchment, x: -80, y: 569,
        });
        // 这两行数值直接压在会变色的条上：怒气满槽时底色是 #E8B04B，羊皮纸字只有 1.5:1。
        // 用 Label 自带描边（引擎 3.8.2+，不用挂 LabelOutline 组件）把字形从底色里抠出来，
        // 条的颜色语义（亮金 = 够爆发）因此不必为了可读性让步。
        for (const barText of [this._hpLabel, this._rageLabel]) {
            if (!barText) continue;
            barText.enableOutline = true;
            barText.outlineColor = hex(T.night, 255);
            barText.outlineWidth = 2;
        }
        // 经验条贴在怒气条下方（536 行），文字放右侧，避免和 BOSS 条打架。
        // 右栏三行必须 `overflow:'shrink'`：只写 align:'right' 时 Overflow.NONE 会把节点缩到
        // 内容宽度、继续以 x 为中心 → 三条右边缘各走各的（实测 590/612/597）。锁定 240 宽后
        // 三行共用 x=352 这条右边线（同 N89 的坑）。
        this._expLabel = createLabel(this.node, '', 13, {
            width: 240, height: 16, color: T.parchmentDim, align: 'right', overflow: 'shrink', x: 232, y: 541,
        });
        this._progressLabel = createLabel(this.node, '', 18, {
            width: 240, height: 24, color: T.parchment, bold: true, align: 'right', overflow: 'shrink', x: 232, y: 608,
        });
        this._timerLabel = createLabel(this.node, '', 15, {
            width: 240, height: 20, color: T.parchmentDim, align: 'right', overflow: 'shrink', x: 232, y: 574,
        });
        // 饰品 proc：资源条下方一行小字，不用图标字符（红线 10），也不改顶栏高度
        this._procLabel = createLabel(this.node, '', 14, {
            width: 400, height: 20, color: T.warning, x: -20, y: 516,
        });
    }

    private _drawTopBars(snap: MithrilSnapshot): void {
        const g = this._barGfx;
        if (!g) return;
        const hp = snap.player.hp;
        const hpMax = Math.max(1, snap.player.maxHp);
        const rage = snap.player.rage;
        const kit = CLASS_KITS[snap.classId] || CLASS_KITS.warrior;
        const resMax = snap.resourceMax || 100;
        const kind = snap.resourceName === '怒气' ? 'rage' : (snap.resourceName === '能量' ? 'energy' : 'mana');
        // 只有主资源驱动爆发的职业才需要「资源够了 → 高亮」
        const burstNeed = kit.burst.holyCost ? 0 : (kit.burst.cost || 0);

        if (hp !== this._lastHp || rage !== this._lastRage) {
            this._lastHp = hp;
            this._lastRage = rage;
        }
        g.clear();

        // ---- 单位框底板：三条读数收进同一个「框」，不再直接浮在场景上 ----
        // 172α 的石底在浅色战场上几乎看不见，框等于没画；提到 228α 并用黄铜框边。
        g.fillColor = hex(T.stone, 228);
        g.roundRect(-250, 524, 340, 96, 10);
        g.fill();
        g.strokeColor = hex(T.goldDim, 200);
        g.lineWidth = 1.5;
        g.roundRect(-250, 524, 340, 96, 10);
        g.stroke();

        // 生命条
        const bx = -240;
        const by = 592;
        const bw = 320;
        const bh = 24;
        g.fillColor = hex(T.stoneDark, 245);
        g.roundRect(bx, by, bw, bh, 7);
        g.fill();
        const hpRatio = Math.max(0, Math.min(1, hp / hpMax));
        if (hpRatio > 0) {
            g.fillColor = hex(hpRatio < 0.3 ? '#D14B3A' : '#A33B32', 255);
            g.roundRect(bx + 2, by + 2, Math.max(4, (bw - 4) * hpRatio), bh - 4, 6);
            g.fill();
            // 上沿一道弱受光：血条不是一块纯色
            g.fillColor = hex('#FFFFFF', 26);
            g.roundRect(bx + 5, by + bh - 8, Math.max(4, (bw - 10) * hpRatio), 3, 2);
            g.fill();
        }
        g.strokeColor = hex(T.goldLine, 225);
        g.lineWidth = 1.5;
        g.roundRect(bx, by, bw, bh, 7);
        g.stroke();
        // 两端金扣
        g.fillColor = hex(T.goldDim, 170);
        g.rect(bx - 2, by + 3, 2, bh - 6);
        g.fill();
        g.rect(bx + bw, by + 3, 2, bh - 6);
        g.fill();

        // 资源条（怒气 / 法力 / 能量）
        const ry = 560;
        const rw = 320;
        const rh = 18;
        g.fillColor = hex(T.stoneDark, 245);
        g.roundRect(bx, ry, rw, rh, 6);
        g.fill();
        if (rage > 0) {
            g.fillColor = hex(RESOURCE_COLOR[kind], 255);
            g.roundRect(bx + 1, ry + 1, Math.max(3, (rw - 2) * Math.min(1, rage / resMax)), rh - 2, 5);
            g.fill();
        }
        // 够放爆发：不换填充色，改用亮边 + 一道顶部光带（换亮填充会把压在条上的数值压到 1.5:1）
        const burstReady = burstNeed > 0 && rage >= burstNeed;
        g.strokeColor = hex(burstReady ? (RESOURCE_BRIGHT[kind] || T.goldBright) : T.goldLine, burstReady ? 240 : 185);
        g.lineWidth = burstReady ? 2 : 1;
        g.roundRect(bx, ry, rw, rh, 6);
        g.stroke();
        if (burstReady) {
            g.fillColor = hex(T.goldBright, 70);
            g.roundRect(bx + 3, ry + rh - 5, Math.max(3, (rw - 6) * Math.min(1, rage / resMax)), 3, 1.5);
            g.fill();
        }

        // 圣能（牧师）：贴在主资源条下方的一条细金条
        if (snap.holyMax > 0) {
            const hy = ry - 10;
            const holy = snap.player.holy;
            g.fillColor = hex(T.stoneDark, 235);
            g.roundRect(bx, hy, rw, 6, 3);
            g.fill();
            if (holy > 0) {
                g.fillColor = hex(T.goldBright, 255);
                g.roundRect(bx + 1, hy + 1, Math.max(2, (rw - 2) * Math.min(1, holy / snap.holyMax)), 4, 2);
                g.fill();
            }
        }

        // 经验条：满级（expNeed 非有限）时按满槽画，避免出现「满级却空条」
        const need = this._growth.expNeed;
        const capped = !Number.isFinite(need) || need <= 0;
        const expRatio = capped ? 1 : Math.max(0, Math.min(1, this._growth.exp / need));
        const ey = 536;
        const eh = 6;
        g.fillColor = hex(T.stoneDark, 235);
        g.roundRect(bx, ey, rw, eh, 3);
        g.fill();
        if (expRatio > 0) {
            g.fillColor = hex(T.goldDim, 235);
            g.roundRect(bx + 1, ey + 1, Math.max(2, (rw - 2) * expRatio), eh - 2, 2);
            g.fill();
        }

        this._hpLabel!.string = `Lv ${this._growth.level}　生命  ${Math.ceil(hp)} / ${Math.round(hpMax)}`;
        this._rageLabel!.string = snap.holyMax > 0
            ? `${snap.resourceName}  ${Math.floor(rage)} / ${resMax}　圣能 ${Math.floor(snap.player.holy)} / ${snap.holyMax}`
            : `${snap.resourceName}  ${Math.floor(rage)} / ${resMax}`;
        if (this._expLabel) {
            const expText = capped
                ? '经验 满级'
                : `经验 ${Math.floor(this._growth.exp)} / ${need}`;
            this._expLabel.string = this._growth.points > 0
                ? `${expText}　天赋点 ${this._growth.points}`
                : expText;
        }
        this._progressLabel!.string = snap.dungeonProgress || snap.dungeonName;
        const t = Math.max(0, Math.floor(snap.time));
        const mm = Math.floor(t / 60);
        const ss = t % 60;
        this._timerLabel!.string = `${snap.dungeonName}  ${mm}:${ss < 10 ? '0' : ''}${ss}  击杀 ${snap.kills}`;
        // 饰品 proc 行（M7）：只显示最近一条，内核在 1.5s 后自动清空 → 自然淡出
        if (this._procLabel) {
            const procs = snap.trinketProcs || [];
            this._procLabel.string = procs.length > 0 ? procs[procs.length - 1] : '';
        }
    }

    private _buildExit(): void {
        // 顶栏返回键不复用 GameUIKit 的深蓝圆盘（那是全站通用皮），
        // 战斗 HUD 其余元素都已是石底金边，留一个蓝盘会像贴错素材。
        // 几何与 createBackButton 一致（D=72，锚点距左上 58/62），只换皮。
        const D = 72;
        const btn = createButton(this.node, {
            w: D, h: D, text: '', fontSize: 46,
            fill: T.stone, textColor: T.parchment,
            stroke: T.goldDim, radius: D / 2,
            onTap: this._onBackTap,
        });
        btn.label.node.active = false;
        const skin = new Node('__backSkin');
        skin.layer = this.node.layer;
        skin.addComponent(UITransform).setContentSize(D, D);
        const g = skin.addComponent(Graphics);
        const r = D / 2 - 1;
        g.strokeColor = hex(T.goldDim, 230);
        g.lineWidth = 2;
        g.circle(0, 0, r - 1);
        g.stroke();
        // ‹ 用矢量画：屏幕字体的字形在三端宽高比不一致
        const ax = r * 0.20;
        const ay = r * 0.42;
        g.strokeColor = hex(T.parchment, 255);
        g.lineWidth = Math.max(3, r * 0.14);
        g.lineCap = Graphics.LineCap.ROUND;
        g.lineJoin = Graphics.LineJoin.ROUND;
        g.moveTo(ax, ay);
        g.lineTo(-r * 0.22, 0);
        g.lineTo(ax, -ay);
        g.stroke();
        btn.node.addChild(skin);
        btn.node.setPosition(-302, 578, 0);
        btn.node.setSiblingIndex(this.node.children.length - 1);
    }

    private _onExitTap = (): void => {
        if (this.onExit) this.onExit();
    };

    // ==================== 横幅 ====================

    private _buildBanner(): void {
        // 牌位：大标题 + 副标题原本直接浮在战场上方，特效一亮就被吃掉；
        // 加一块石底金牌位，标题才有「层级」可言。
        // 纵向位置由「上方 = 单位框 / BOSS 条，下方 = 战斗提示条」夹出来：
        // 牌位占 137–255，与提示条（324–448）留 69 设计像素的呼吸，不再像两块拼歪的卡。
        const plate = new Node('BannerPlate');
        plate.layer = this.node.layer;
        plate.addComponent(UITransform).setContentSize(640, 118);
        plate.setPosition(0, 196, 0);
        const pg = plate.addComponent(Graphics);
        pg.fillColor = hex(T.stone, 214);
        pg.roundRect(-320, -59, 640, 118, 12);
        pg.fill();
        pg.strokeColor = hex(T.goldDim, 190);
        pg.lineWidth = 1.5;
        pg.roundRect(-320, -59, 640, 118, 12);
        pg.stroke();
        // 内圈暗线：给牌位一点厚度，避免平涂
        pg.strokeColor = hex('#000000', 90);
        pg.lineWidth = 1;
        pg.roundRect(-315, -54, 630, 108, 10);
        pg.stroke();
        // 顶部一颗菱形 + 副标题下一条收短金线，把两块文字框成一组
        drawDiamond(pg, 0, 50, 5, T.goldBright, 220);
        pg.fillColor = hex(T.goldLine, 200);
        pg.rect(-200, -49.5, 400, 1);
        pg.fill();
        this.node.addChild(plate);
        this._bannerPlate = plate;
        this._bannerOpacity = plate.addComponent(UIOpacity);

        this._bannerTitle = createLabel(this.node, '', 40, {
            width: 600, height: 54, color: T.parchment, bold: true, x: 0, y: 212,
        });
        this._bannerSub = createLabel(this.node, '', 21, {
            width: 600, height: 30, color: T.parchmentDim, x: 0, y: 168,
        });
        plate.active = false;
        this._bannerTitle.node.active = false;
        this._bannerSub.node.active = false;
    }

    /** 牌位与文字一起显隐，避免「有底无字」或「有字无底」的中间帧 */
    private _setBannerVisible(visible: boolean): void {
        if (this._bannerPlate) this._bannerPlate.active = visible;
        if (this._bannerTitle) this._bannerTitle.node.active = visible;
        if (this._bannerSub) this._bannerSub.node.active = visible;
    }

    private _updateBanner(snap: MithrilSnapshot): void {
        const title = this._bannerTitle;
        const sub = this._bannerSub;
        if (!title || !sub) return;
        // 升级横幅优先：它出现在战斗中，被副本阶段横幅盖掉就等于没提示
        if (this._growthTimer > 0) {
            // updateHud 的调用节拍是 HUD_REFRESH(0.1s)，按同一节拍倒数
            this._growthTimer -= 0.1;
            const growKey = `grow|${this._growthTitle}|${this._growthSub}`;
            if (growKey !== this._bannerKey) {
                this._bannerKey = growKey;
                title.string = this._growthTitle;
                sub.string = this._growthSub;
                title.color = hex(T.goldBright);
                sub.color = hex(T.parchment);
            }
            // 升级横幅走的是「停留 + 突然消失」，不淡出，所以要显式复位透明度
            if (this._bannerOpacity) this._bannerOpacity.opacity = 255;
            this._setBannerVisible(true);
            title.node.setScale(1, 1, 1);
            return;
        }
        if (this._bannerKey.indexOf('grow|') === 0) this._bannerKey = '';
        const b = snap.banner;
        if (!b) {
            this._setBannerVisible(false);
            this._bannerKey = '';
            return;
        }
        const key = `${b.title}|${b.subtitle}`;
        if (key !== this._bannerKey) {
            this._bannerKey = key;
            title.string = b.title;
            sub.string = b.subtitle;
            // 升级横幅把标题染成金色了，回到副本横幅时要把基色复位（下面按 alpha 复制）
            title.color = hex(T.parchment);
            sub.color = hex(T.parchmentDim);
        }
        this._setBannerVisible(true);
        const alpha = Math.round(255 * Math.max(0, Math.min(1, b.t / 0.45)));
        if (this._bannerOpacity) this._bannerOpacity.opacity = alpha;
        const tc = new Color(title.color);
        tc.a = alpha;
        title.color = tc;
        const sc = new Color(sub.color);
        sc.a = alpha;
        sub.color = sc;
        // 出现时轻微放大
        const k = Math.max(0, Math.min(1, (2.2 - b.t) / 0.25));
        title.node.setScale(1 + (1 - k) * 0.12, 1 + (1 - k) * 0.12, 1);
    }

    // ==================== BOSS 条 ====================

    private _buildBossBar(): void {
        const root = new Node('BossBar');
        root.layer = this.node.layer;
        const ut = root.addComponent(UITransform);
        ut.setContentSize(640, 92);
        root.setPosition(0, 500, 0);
        root.active = false;
        this.node.addChild(root);
        this._bossRoot = root;

        this._bossGfx = root.addComponent(Graphics);
        this._bossName = createLabel(root, '', 22, {
            width: 560, height: 28, color: T.parchment, bold: true, y: 30,
        });
        this._bossHpText = createLabel(root, '', 15, {
            width: 560, height: 18, color: T.parchmentDim, y: -12,
        });
        this._bossHint = createLabel(root, '', 15, {
            width: 560, height: 18, color: T.warning, y: -36,
        });
        this._castGfx = this._makeGfxNode('CastBar', 640, 72, 0, 0, root);
        this._castGfx.node.setSiblingIndex(root.children.length - 1);
        this._castLabel = createLabel(root, '', 15, {
            width: 560, height: 18, color: T.parchment, bold: true, y: -30,
        });
    }

    /** _castGfx 的节点，方便显隐 */
    private _castNode: Node | null = null;

    private _updateBoss(snap: MithrilSnapshot): void {
        const root = this._bossRoot;
        const g = this._bossGfx;
        if (!root || !g) return;
        const boss = snap.boss;
        if (!boss) {
            root.active = false;
            return;
        }
        root.active = true;
        g.clear();

        const bw = 560;
        const bh = 18;
        const bx = -bw / 2;
        const by = 6;
        g.fillColor = hex(T.stoneDark, 242);
        g.roundRect(bx, by, bw, bh, 6);
        g.fill();
        const ratio = Math.max(0, Math.min(1, boss.hp / Math.max(1, boss.maxHp)));
        if (ratio > 0) {
            g.fillColor = hex(boss.enraged > 0 ? '#C2453B' : '#8C3B6E', 255);
            g.roundRect(bx + 2, by + 2, Math.max(4, (bw - 4) * ratio), bh - 4, 5);
            g.fill();
        }
        g.strokeColor = hex(T.goldLine, 225);
        g.lineWidth = 1.5;
        g.roundRect(bx, by, bw, bh, 6);
        g.stroke();

        // 阶段刻度
        g.strokeColor = hex('#FFFFFF', 140);
        g.lineWidth = 2;
        for (const th of [2 / 3, 1 / 3]) {
            const x = bx + bw * th;
            g.moveTo(x, by);
            g.lineTo(x, by + bh);
        }
        g.stroke();

        this._bossName!.string = `${boss.name}  ·  阶段 ${boss.phase + 1}/${snap.bossPhaseCount}`;
        // BOSS 血量是浮点倍率连乘出来的，直接显示会出现 3535.9999999999995（试玩 N40）
        this._bossHpText!.string = `${Math.ceil(boss.hp)} / ${Math.round(boss.maxHp)}`;
        this._bossHpText!.node.active = true;
        this._bossHint!.string = boss.enraged > 0
            ? `狂暴中：伤害 +50%（剩余 ${boss.enraged.toFixed(1)}s）`
            : (snap.bossHint || '观察机制提示，按阶段处理');
        this._bossHint!.color = hex(boss.enraged > 0 ? T.danger : T.warning);

        // 读条
        const cast = snap.bossCast;
        const cg = this._castGfx;
        const castNode = this._castNode;
        if (!cg || !castNode) return;
        if (!cast) {
            castNode.active = false;
            this._castLabel!.node.active = false;
            return;
        }
        castNode.active = true;
        this._castLabel!.node.active = true;
        cg.clear();
        const cw = 440;
        const ch = 16;
        const cx = -cw / 2;
        const cy = -10;
        cg.fillColor = hex(T.stoneDark, 245);
        cg.roundRect(cx, cy, cw, ch, 5);
        cg.fill();
        const turn = Math.max(0, Math.min(1, cast.taken / Math.max(1, cast.need)));
        cg.fillColor = hex(T.warning, 255);
        cg.roundRect(cx + 1, cy + 1, Math.max(3, (cw - 2) * turn), ch - 2, 4);
        cg.fill();
        const left = Math.max(0, cast.remaining);
        const fillRatio = Math.max(0, Math.min(1, cast.remaining / Math.max(0.001, cast.total)));
        cg.strokeColor = hex('#FFFFFF', 130);
        cg.lineWidth = 2;
        cg.roundRect(cx, cy, cw * fillRatio, ch, 5);
        cg.stroke();
        this._castLabel!.string = `打断！${cast.name}  ${left.toFixed(1)}s  （伤害 ${Math.floor(cast.taken)}/${cast.need}）`;
    }

    // ==================== 技能键 ====================

    private _buildSkills(): void {
        const mk = (
            key: SkillKey, x: number, y: number, size: number, color: string, total: number,
        ): void => {
            const node = new Node(`Skill_${key}`);
            node.layer = this.node.layer;
            const ut = node.addComponent(UITransform);
            ut.setContentSize(size, size);
            node.setPosition(x, y, 0);
            this.node.addChild(node);
            const g = node.addComponent(Graphics);
            const text = (CLASS_SKILL_NAME[this._classId] || CLASS_SKILL_NAME.warrior)[key];
            // 技能图标（N85）：白线图标压在色块上半，文字压到下半
            const glyphRadius = Math.max(10, Math.round(size * 0.15));
            const glyphKind = SKILL_GLYPH_KIND[SKILL_SLOT_OF[key]] || 'skill';
            const tone = SKILL_TONE[key];
            const glyph = addGlyphNode(node, `SkillIcon_${key}`, glyphKind, glyphRadius, T.parchmentMuted,
                0, Math.round(size * 0.18), tone.glyphDim);
            const label = createLabel(node, text, this._skillFontSize(text, size), {
                width: size - 8, height: Math.round(size * 0.36), color: tone.text, bold: true,
                y: -Math.round(size * 0.2),
            });
            // 两字文案在 84px 圆键里不能再折行
            label.enableWrapText = false;
            const cdLabel = createLabel(node, '', Math.round(size * 0.26), {
                width: size - 8, height: Math.round(size * 0.3), color: '#FFFFFF', bold: true, y: 0,
            });
            cdLabel.node.active = false;
            this._skills.push({
                key, node, g, label, cdLabel, glyph, glyphKind, glyphRadius, glyphReady: null,
                size, color, total, pressed: false,
            });
            node.on(Node.EventType.TOUCH_START, this.onSkillDown, this);
            node.on(Node.EventType.TOUCH_END, this.onSkillUp, this);
            node.on(Node.EventType.TOUCH_CANCEL, this.onSkillUp, this);
        };

        // 右下扇形。约束：x + size/2 ≤ 352（右边界 360）、y - size/2 ≥ -588、两两圆心距 > 半径和。
        // 下边界取 -588 而不是 -640：预览窗口是 393×679 的短窗口，引擎按宽度缩放后
        // 底部约 36 设计像素会被裁掉，贴底的「破」被切了一半（真机 720×1280 不裁）。
        // 叠压教训：斩/怒曾重叠，改位置后必须重新算圆心距。
        mk('basic', 222, -532, 112, SKILL_FILL.basic, PLAYER_TUNING.basic.cd);   // 斩 r56 → 底 -588
        mk('skill1', 132, -360, 88, SKILL_FILL.skill1, PLAYER_TUNING.charge.cd); // 冲 r44
        mk('skill2', 110, -452, 88, SKILL_FILL.skill2, PLAYER_TUNING.whirlwind.cd); // 旋 r44 → 距斩 137.6 > 100
        mk('skill3', 100, -544, 88, SKILL_FILL.skill3, PLAYER_TUNING.armorBreak.cd); // 破 r44 → 底 -588
        mk('dodge', 310, -348, 84, SKILL_FILL.dodge, PLAYER_TUNING.dodge.cd);     // 闪 r42 → 右 352
        mk('burst', 300, -452, 96, SKILL_FILL.burst, PLAYER_TUNING.burst.cd);    // 怒 r48 → 距闪 104.7 > 90
    }

    private onSkillDown(ev: EventTouch): void {
        const node = ev.currentTarget as Node;
        const key = this._keyOf(node);
        if (!key) return;
        this.held[key] = true;
        const btn = this._skills.find((b) => b.key === key);
        if (btn) btn.pressed = true;
    }

    private onSkillUp(ev: EventTouch): void {
        const node = ev.currentTarget as Node;
        const key = this._keyOf(node);
        if (!key) return;
        this.held[key] = false;
        const btn = this._skills.find((b) => b.key === key);
        if (btn) btn.pressed = false;
    }

    /** 切后台时调用：手机端切走不会派发 TOUCH_END，按住状态的键会一直「粘住」持续施法 */
    releaseAllHeld(): void {
        for (const key of Object.keys(this.held) as SkillKey[]) this.held[key] = false;
        for (const b of this._skills) b.pressed = false;
    }

    private _keyOf(node: Node): SkillKey | null {
        const name = node.name || '';
        const key = name.replace('Skill_', '') as SkillKey;
        return key in this.held ? key : null;
    }

    private _updateSkills(snap: MithrilSnapshot): void {
        const p = snap.player;
        for (const b of this._skills) {
            let cd = 0;
            if (b.key === 'basic') cd = p.cd.basic;
            else if (b.key === 'skill1') cd = p.cd.charge;
            else if (b.key === 'skill2') cd = p.cd.whirlwind;
            else if (b.key === 'skill3') cd = p.cd.armorBreak;
            else if (b.key === 'dodge') cd = p.cd.dodge;
            else if (b.key === 'burst') cd = p.cd.burst;

            const kit = CLASS_KITS[snap.classId] || CLASS_KITS.warrior;
            const burstSolo = kit.burst.holyCost ? 0 : (kit.burst.cost || 0);
            const needRage = b.key === 'burst' ? (kit.burst.holyCost || burstSolo) : 0;
            const poolNow = b.key === 'burst' && kit.burst.holyCost ? p.holy : p.rage;
            const poolMax = b.key === 'burst' && kit.burst.holyCost ? (kit.holyMax || 100) : (snap.resourceMax || 100);
            const rageOk = poolNow >= needRage;
            const ready = cd <= 0.001 && rageOk;
            const r = b.size / 2;

            // 图标只在可用状态翻转时重画（每帧重绘 6 个图标没必要）
            if (b.glyphReady !== ready) {
                b.glyphReady = ready;
                const gg = b.glyph.getComponent(Graphics);
                const tone = SKILL_TONE[b.key];
                if (gg) {
                    gg.clear();
                    drawMithrilGlyph(gg, b.glyphKind, b.glyphRadius,
                        ready ? tone.text : T.parchmentMuted, ready ? tone.glyph : tone.glyphDim);
                }
            }

            b.g.clear();
            // 石色外框：技能键是一枚「镶在石头里」的徽章，而不是一枚彩色贴纸
            b.g.fillColor = hex(T.stoneDark, 238);
            b.g.circle(0, 0, r);
            b.g.fill();
            // 宝石面
            b.g.fillColor = hex(ready ? b.color : T.stonePressed, ready ? 245 : 238);
            b.g.circle(0, 0, r - 5);
            b.g.fill();
            // 顶部受光：宝石有弧面，不是平涂圆
            if (ready) {
                b.g.fillColor = hex('#FFFFFF', 26);
                b.g.circle(0, r * 0.34, r * 0.55);
                b.g.fill();
            }
            // 亮金环（可用）/ 铁环（冷却中或资源不足）：金底宝石上用 gold 环会「环消失」，
            // 提到 goldBright 才在一圈暖色里立得住。
            b.g.strokeColor = hex(ready ? T.goldBright : '#3A3F49', 255);
            b.g.lineWidth = b.pressed ? 5 : 3;
            b.g.circle(0, 0, r - 3);
            b.g.stroke();

            // 冷却扇形
            if (cd > 0.001 && b.total > 0) {
                b.g.fillColor = hex('#000000', 150);
                b.g.moveTo(0, 0);
                b.g.arc(0, 0, r - 6, Math.PI / 2, Math.PI / 2 - Math.PI * 2 * Math.max(0, Math.min(1, cd / b.total)), true);
                b.g.close();
                b.g.fill();
                b.cdLabel.node.active = true;
                b.cdLabel.string = cd >= 1 ? `${Math.ceil(cd)}` : cd.toFixed(1);
                b.cdLabel.color = hex(T.parchment, 255);
                b.label.color = hex(T.parchmentDim, 200);
            } else {
                b.cdLabel.node.active = false;
                b.label.color = hex(SKILL_TONE[b.key].text, 255);
            }

            // 资源不足：灰色 + 需求
            if (b.key === 'burst' && !rageOk) {
                b.g.fillColor = hex('#000000', 120);
                b.g.circle(0, 0, r - 6);
                b.g.fill();
                b.cdLabel.node.active = true;
                b.cdLabel.string = `${Math.floor(poolNow)}/${needRage}`;
                b.cdLabel.color = hex(T.danger, 255);
            }

            // 资源环 / 持续时间提示
            if (b.key === 'burst' && rageOk && cd <= 0.001) {
                b.g.strokeColor = hex(T.goldBright, 255);
                b.g.lineWidth = 4;
                b.g.arc(0, 0, r - 1, Math.PI / 2, Math.PI / 2 - Math.PI * 2 * Math.max(0, Math.min(1, poolNow / Math.max(1, poolMax))), true);
                b.g.stroke();
            }
            if (b.key === 'basic' && p.whirlwind > 0) {
                b.g.strokeColor = hex('#8F6FC4', 210);
                b.g.lineWidth = 3;
                b.g.circle(0, 0, r - 8);
                b.g.stroke();
            }
        }
    }

    // ==================== 结算 ====================

    private _showResult(snap: MithrilSnapshot): void {
        if (this._resultShown) return;
        this._resultShown = true;
        this._ensureResult();
        const root = this._resultRoot;
        if (!root) return;
        root.active = true;
        const won = snap.phase === 'won';
        this._lastWin = won;
        const t = Math.max(0, Math.floor(snap.time));
        this._lastTimeText = `${Math.floor(t / 60)}:${t % 60 < 10 ? '0' : ''}${t % 60}`;
        this._lastKills = snap.kills;
        this._lastDungeonName = snap.dungeonName;
        this._lastProgress = snap.dungeonProgress;
        this._resultTitle!.string = won ? this._resultWinTitle : this._resultLoseTitle;
        this._resultTitle!.color = hex(won ? T.goldBright : T.danger);
        this._refreshResultBody();
    }

    private _refreshResultBody(): void {
        if (!this._resultBody || !this._resultSub) return;
        // 上下文：地点 / 用时·击杀 / 推进或胜利评语。15px 暗色，只当「这是什么局」
        this._resultSub.string = [
            this._lastDungeonName,
            `用时 ${this._lastTimeText} · 击杀 ${this._lastKills}`,
            this._lastWin ? this._resultWinLine : `推进到 ${this._lastProgress}`,
        ].join('\n');
        // 收益：金币 / 经验 / 首通 / 材料 / 掉落 / 成长提示。羊皮纸正文字号，只当「拿到了什么」
        const lines: string[] = [];
        if (this._rewardLines.length > 0) lines.push(...this._rewardLines);
        if (this._lootLines.length > 0) lines.push(...this._lootLines.slice(0, 2));
        const hint = this._growthHintText();
        if (hint) lines.push(hint);
        // 收益区高 198（顶边 62 → 底边 −136）：9 行 × 20 = 180 仍留 18px 余量
        const shown = lines.length > 9 ? lines.slice(0, 9) : lines;
        const n = shown.length;
        const hasGain = n > 0;
        if (this._resultMidRule) this._resultMidRule.active = hasGain;
        this._resultBody.node.active = hasGain;
        // 没有收益（例如空手失败）时把上下文居中，别让面板下半截空着
        this._resultSub.node.setPosition(0, hasGain ? 124 : 10, 0);
        if (!hasGain) return;
        const lh = n <= 5 ? 26 : n <= 7 ? 23 : 20;
        this._resultBody.lineHeight = lh;
        this._resultBody.fontSize = n <= 5 ? 17 : n <= 7 ? 16 : 15;
        this._resultBody.string = shown.join('\n');
        // 顶对齐：正文从 62 往下排（Label 竖直居中，所以按实际文字高度反算节点中心）
        this._resultBody.node.setPosition(0, 62 - (n * lh) / 2, 0);
    }

    /** 结算面板最后一行：还有多少东西可以花 */
    private _growthHintText(): string {
        const bits: string[] = [];
        if (this._growth.points > 0) bits.push(`天赋点 ${this._growth.points}`);
        if (this._growth.books > 0) bits.push(`技能书 ${this._growth.books}`);
        if (this._growth.pending > 0) bits.push(`待选变体 ${this._growth.pending}`);
        return bits.length > 0 ? `可成长：${bits.join(' · ')}` : '';
    }

    private _ensureResult(): void {
        if (this._resultRoot) return;
        const root = new Node('Result');
        root.layer = this.node.layer;
        const ut = root.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        this.node.addChild(root);
        this._resultRoot = root;

        const mask = new Node('Mask');
        mask.layer = this.node.layer;
        const mut = mask.addComponent(UITransform);
        mut.setContentSize(720, 1280);
        const g = mask.addComponent(Graphics);
        g.fillColor = hex(T.night, 235);
        g.rect(-360, -640, 720, 1280);
        g.fill();
        // 遮罩必须吞掉触摸：否则结算时点「再来一次」附近的空白会把点击漏给下层摇杆 / 技能键，
        // 摇杆在结算期间还能拖动（全屏遮罩 + 不拦事件 = 幽灵输入）
        mask.addComponent(BlockInputEvents);
        root.addChild(mask);

        const panel = new Node('Panel');
        panel.layer = this.node.layer;
        // 面板 500→560：正文拆成「上下文 / 收益」两块后需要多 60px，否则 11 行收益
        // 只能压到 13px（第 26 轮复核 P2）
        const put = panel.addComponent(UITransform);
        put.setContentSize(520, 560);
        const pg = panel.addComponent(Graphics);
        pg.fillColor = hex(T.stone, 255);
        pg.roundRect(-260, -280, 520, 560, 20);
        pg.fill();
        pg.strokeColor = hex(T.gold, 210);
        pg.lineWidth = 2;
        pg.roundRect(-260, -280, 520, 560, 20);
        pg.stroke();
        drawStoneTrim(pg, 520, 560, 20);
        root.addChild(panel);

        // 数值区与操作区之间一条金线：结算正文长短不定，没有这条线按钮会「贴」在文字上
        const rule = new Node('ResultRule');
        rule.layer = this.node.layer;
        rule.addComponent(UITransform).setContentSize(520, 560);
        const rg = rule.addComponent(Graphics);
        rg.fillColor = hex(T.goldDim, 150);
        rg.rect(-150, -170.75, 300, 1.5);
        rg.fill();
        drawDiamond(rg, 0, -170, 5, T.goldBright, 235);
        panel.addChild(rule);

        this._resultTitle = createLabel(panel, '', 44, {
            width: 460, height: 60, color: T.goldBright, bold: true, y: 198,
        });
        // ---- 上下文行：地点 / 用时 / 击杀 / 推进。原来和收益行同号同色，11 行糊成一坨 ----
        this._resultSub = createLabel(panel, '', 15, {
            // 标题实际行高 69（配置 60），底边约 163；上下文顶边必须低于它 → 3×21 行从 155 起
            width: 470, height: 66, color: T.parchmentMuted, y: 124,
            lineHeight: 21, overflow: 'clamp',
        });

        // 上下文 / 收益之间的细金线：两块各自成组，收益不再需要「获得」以外的解释
        const mid = new Node('ResultMidRule');
        mid.layer = this.node.layer;
        mid.addComponent(UITransform).setContentSize(520, 560);
        const mg = mid.addComponent(Graphics);
        mg.fillColor = hex(T.goldLine, 170);
        mg.rect(-110, 75.25, 220, 1.5);
        mg.fill();
        drawDiamond(mg, 0, 76, 4, T.goldDim, 220);
        panel.addChild(mid);
        this._resultMidRule = mid;

        this._resultBody = createLabel(panel, '', 17, {
            // 收益区：顶边固定 62，向下排；高度 198 ⇒ 底边 -136，离金线（-170）还有 34
            width: 470, height: 198, color: T.parchment, y: -37,
            lineHeight: 24,
            // N86：默认 Overflow.NONE 不换行，超宽的一行会横向越出面板；clamp 兜底（文案也已缩短）
            overflow: 'clamp',
        });

        // 四个按钮：主操作金底墨字，其余三个石底羊皮纸字（不再一条彩虹）
        this._againBtn = createButton(panel, {
            w: 112, h: 58, text: this._restartLabel, fontSize: 22,
            fill: T.gold, textColor: T.ink, activeFill: T.goldPressed,
            radius: 14, onTap: () => this._onRestartTap(),
        });
        this._againBtn.node.setPosition(-177, -222, 0);
        this._againBtn.label.enableWrapText = false;

        const grow = createButton(panel, {
            w: 112, h: 58, text: '成长', fontSize: 22,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 14, onTap: () => this._onGrowthTap(),
        });
        grow.node.setPosition(-59, -222, 0);

        const bag = createButton(panel, {
            w: 112, h: 58, text: '装备', fontSize: 22,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 14, onTap: () => this._onBagTap(),
        });
        bag.node.setPosition(59, -222, 0);

        const exit = createButton(panel, {
            w: 112, h: 58, text: '返回大厅', fontSize: 22,
            fill: T.stoneLight, textColor: T.parchment, activeFill: T.stonePressed,
            radius: 14, onTap: () => this._onExitTap(),
        });
        exit.node.setPosition(177, -222, 0);

        root.active = false;
    }

    private _onRestartTap = (): void => {
        if (this.onRestart) this.onRestart();
    };

    private _onGrowthTap = (): void => {
        if (this.onOpenGrowth) this.onOpenGrowth();
    };

    private _onBagTap = (): void => {
        if (this.onOpenBag) this.onOpenBag();
    };

    // ==================== 小工具 ====================

    private _makeGfxNode(
        name: string, w: number, h: number, x: number, y: number, parent?: Node,
    ): Graphics {
        const node = new Node(name);
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);
        node.setPosition(x, y, 0);
        (parent || this.node).addChild(node);
        const g = node.addComponent(Graphics);
        if (name === 'CastBar') this._castNode = node;
        return g;
    }
}
