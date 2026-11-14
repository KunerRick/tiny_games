/**
 * 《秘银远征》HUD —— 顶栏（生命 / 怒气 / 进度）、BOSS 血条与读条、技能键、阶段横幅、结算面板。
 *
 * 全部节点运行时创建（与 FridgeHud 一致），场景里只挂 Canvas + GameRoot。
 * 技能键的按下状态通过 `held` 暴露给主组件；HUD 本身不碰核心状态。
 *
 * 约定：onDestroy 只清引用（红线 4）；handler 全部命名方法（红线 5）；
 *       文字直接 set Label.string，不放任何图标字符（红线 10）。
 */

import { _decorator, BlockInputEvents, Color, Component, EventTouch, Graphics, Label, Node, UITransform } from 'cc';
import {
    COLOR, createBackButton, createButton, createLabel, hex,
} from '../../../common/ui/GameUIKit';
import type { CoreEvent, MithrilSnapshot } from './MithrilCore';
import { PLAYER_TUNING, GEAR_BASE_BY_ID, GEAR_SLOT_NAMES, QUALITY_BY_ID } from './MithrilConfig';
import type { EquipItem } from './MithrilConfig';

const { ccclass } = _decorator;

export type SkillKey = 'basic' | 'skill1' | 'skill2' | 'skill3' | 'burst' | 'dodge';

interface SkillBtn {
    key: SkillKey;
    node: Node;
    g: Graphics;
    label: Label;
    cdLabel: Label;
    size: number;
    color: string;
    /** 冷却总时长（秒），来自 PLAYER_TUNING */
    total: number;
    pressed: boolean;
}

const SKILL_NAME: Record<SkillKey, string> = {
    basic: '斩',
    skill1: '冲',
    skill2: '旋',
    skill3: '破',
    burst: '怒',
    dodge: '闪',
};

@ccclass('MithrilHud')
export class MithrilHud extends Component {
    /** 左上角返回（由 MithrilGame 接到 SceneManager.gotoLobby） */
    onExit: (() => void) | null = null;
    /** 结算面板「再来一次」 */
    onRestart: (() => void) | null = null;
    /** 结算面板「装备」 */
    onOpenBag: (() => void) | null = null;

    /** 各技能键当前是否按住（主组件每帧读取） */
    readonly held: Record<SkillKey, boolean> = {
        basic: false, skill1: false, skill2: false, skill3: false, burst: false, dodge: false,
    };

    private _barGfx: Graphics | null = null;
    private _hpLabel: Label | null = null;
    private _rageLabel: Label | null = null;
    private _progressLabel: Label | null = null;
    private _timerLabel: Label | null = null;

    private _bannerTitle: Label | null = null;
    private _bannerSub: Label | null = null;
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
    private _resultBody: Label | null = null;
    private _resultShown = false;
    private _lootLines: string[] = [];
    private _lastWin = false;
    private _lastTimeText = '0:00';
    private _lastKills = 0;
    private _lastDungeonName = '';
    private _lastProgress = '';

    private _lastHp = -1;
    private _lastRage = -1;

    onLoad(): void {
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
        this._progressLabel = null;
        this._timerLabel = null;
        this._bannerTitle = null;
        this._bannerSub = null;
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
        this._resultBody = null;
    }

    // ==================== 对外 ====================

    updateHud(snap: MithrilSnapshot): void {
        this._drawTopBars(snap);
        this._updateBanner(snap);
        this._updateBoss(snap);
        this._updateSkills(snap);
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
        if (this._resultRoot) this._resultRoot.active = false;
        for (const key of Object.keys(this.held) as SkillKey[]) this.held[key] = false;
        for (const b of this._skills) b.pressed = false;
        this._lastHp = -1;
        this._lastRage = -1;
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

    private _buildBars(): void {
        this._barGfx = this._makeGfxNode('TopBars', 720, 160, 0, 0);
        this._hpLabel = createLabel(this.node, '', 15, {
            width: 300, height: 18, color: COLOR.TEXT_PRIMARY, bold: true, x: -80, y: 604,
        });
        this._rageLabel = createLabel(this.node, '', 13, {
            width: 300, height: 16, color: COLOR.TEXT_PRIMARY, x: -80, y: 569,
        });
        this._progressLabel = createLabel(this.node, '', 18, {
            width: 240, height: 24, color: COLOR.TEXT_PRIMARY, bold: true, align: 'right', x: 232, y: 608,
        });
        this._timerLabel = createLabel(this.node, '', 15, {
            width: 240, height: 20, color: COLOR.TEXT_SECONDARY, align: 'right', x: 232, y: 574,
        });
    }

    private _drawTopBars(snap: MithrilSnapshot): void {
        const g = this._barGfx;
        if (!g) return;
        const hp = snap.player.hp;
        const hpMax = Math.max(1, snap.player.maxHp);
        const rage = snap.player.rage;

        if (hp !== this._lastHp || rage !== this._lastRage) {
            this._lastHp = hp;
            this._lastRage = rage;
        }
        g.clear();

        // 生命条
        const bx = -240;
        const by = 592;
        const bw = 320;
        const bh = 24;
        g.fillColor = hex(COLOR.SLOT_EMPTY_BG, 235);
        g.roundRect(bx, by, bw, bh, 7);
        g.fill();
        const hpRatio = Math.max(0, Math.min(1, hp / hpMax));
        if (hpRatio > 0) {
            g.fillColor = hex(hpRatio < 0.3 ? '#DC2626' : '#D94B4B', 255);
            g.roundRect(bx + 2, by + 2, Math.max(4, (bw - 4) * hpRatio), bh - 4, 6);
            g.fill();
        }
        g.strokeColor = hex(COLOR.PANEL_BORDER, 200);
        g.lineWidth = 1.5;
        g.roundRect(bx, by, bw, bh, 7);
        g.stroke();

        // 怒气条
        const ry = 560;
        const rw = 320;
        const rh = 18;
        g.fillColor = hex(COLOR.SLOT_EMPTY_BG, 235);
        g.roundRect(bx, ry, rw, rh, 6);
        g.fill();
        if (rage > 0) {
            g.fillColor = hex(rage >= PLAYER_TUNING.burst.rageCost ? '#F59E0B' : '#B45309', 255);
            g.roundRect(bx + 1, ry + 1, Math.max(3, (rw - 2) * (rage / 100)), rh - 2, 5);
            g.fill();
        }
        g.strokeColor = hex(COLOR.PANEL_BORDER, 160);
        g.lineWidth = 1;
        g.roundRect(bx, ry, rw, rh, 6);
        g.stroke();

        this._hpLabel!.string = `生命  ${Math.ceil(hp)} / ${hpMax}`;
        this._rageLabel!.string = `怒气  ${Math.floor(rage)} / 100`;
        this._progressLabel!.string = snap.dungeonProgress || snap.dungeonName;
        const t = Math.max(0, Math.floor(snap.time));
        const mm = Math.floor(t / 60);
        const ss = t % 60;
        this._timerLabel!.string = `${snap.dungeonName}  ${mm}:${ss < 10 ? '0' : ''}${ss}  击杀 ${snap.kills}`;
    }

    private _buildExit(): void {
        const btn = createBackButton(this.node, this._onExitTap);
        btn.node.setSiblingIndex(this.node.children.length - 1);
    }

    private _onExitTap = (): void => {
        if (this.onExit) this.onExit();
    };

    // ==================== 横幅 ====================

    private _buildBanner(): void {
        this._bannerTitle = createLabel(this.node, '', 40, {
            width: 640, height: 54, color: COLOR.TEXT_PRIMARY, bold: true, x: 0, y: 260,
        });
        this._bannerSub = createLabel(this.node, '', 21, {
            width: 640, height: 30, color: COLOR.TEXT_SECONDARY, x: 0, y: 216,
        });
        this._bannerTitle.node.active = false;
        this._bannerSub.node.active = false;
    }

    private _updateBanner(snap: MithrilSnapshot): void {
        const title = this._bannerTitle;
        const sub = this._bannerSub;
        if (!title || !sub) return;
        const b = snap.banner;
        if (!b) {
            title.node.active = false;
            sub.node.active = false;
            this._bannerKey = '';
            return;
        }
        const key = `${b.title}|${b.subtitle}`;
        if (key !== this._bannerKey) {
            this._bannerKey = key;
            title.string = b.title;
            sub.string = b.subtitle;
        }
        title.node.active = true;
        sub.node.active = true;
        const alpha = Math.round(255 * Math.max(0, Math.min(1, b.t / 0.45)));
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
            width: 560, height: 28, color: COLOR.TEXT_PRIMARY, bold: true, y: 30,
        });
        this._bossHpText = createLabel(root, '', 15, {
            width: 560, height: 18, color: COLOR.TEXT_PRIMARY, y: -12,
        });
        this._bossHint = createLabel(root, '', 15, {
            width: 560, height: 18, color: COLOR.WARNING, y: -36,
        });
        this._castGfx = this._makeGfxNode('CastBar', 640, 72, 0, 0, root);
        this._castGfx.node.setSiblingIndex(root.children.length - 1);
        this._castLabel = createLabel(root, '', 15, {
            width: 560, height: 18, color: COLOR.TEXT_PRIMARY, bold: true, y: -30,
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
        g.fillColor = hex(COLOR.SLOT_EMPTY_BG, 240);
        g.roundRect(bx, by, bw, bh, 6);
        g.fill();
        const ratio = Math.max(0, Math.min(1, boss.hp / Math.max(1, boss.maxHp)));
        if (ratio > 0) {
            g.fillColor = hex(boss.enraged > 0 ? '#EF4444' : '#B44BE0', 255);
            g.roundRect(bx + 2, by + 2, Math.max(4, (bw - 4) * ratio), bh - 4, 5);
            g.fill();
        }
        g.strokeColor = hex(COLOR.PANEL_BORDER, 220);
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

        this._bossName!.string = `${boss.name}  ·  阶段 ${boss.phase + 1}/3`;
        this._bossHpText!.string = `${Math.ceil(boss.hp)} / ${boss.maxHp}`;
        this._bossHpText!.node.active = true;
        this._bossHint!.string = boss.enraged > 0
            ? `狂暴中：伤害 +50%（剩余 ${boss.enraged.toFixed(1)}s）`
            : '走位躲砸地 · 转火矿工 · 打断狂暴读条';
        this._bossHint!.color = hex(boss.enraged > 0 ? '#EF4444' : COLOR.WARNING);

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
        cg.fillColor = hex(COLOR.SLOT_EMPTY_BG, 245);
        cg.roundRect(cx, cy, cw, ch, 5);
        cg.fill();
        const turn = Math.max(0, Math.min(1, cast.taken / Math.max(1, cast.need)));
        cg.fillColor = hex('#F59E0B', 255);
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
            const label = createLabel(node, SKILL_NAME[key], Math.round(size * 0.34), {
                width: size - 8, height: size - 8, color: '#FFFFFF', bold: true,
            });
            const cdLabel = createLabel(node, '', 17, {
                width: size - 8, height: 22, color: '#FFFFFF', bold: true, y: -size * 0.3,
            });
            cdLabel.node.active = false;
            this._skills.push({ key, node, g, label, cdLabel, size, color, total, pressed: false });
            node.on(Node.EventType.TOUCH_START, this.onSkillDown, this);
            node.on(Node.EventType.TOUCH_END, this.onSkillUp, this);
            node.on(Node.EventType.TOUCH_CANCEL, this.onSkillUp, this);
        };

        // 右下扇形。约束：x + size/2 ≤ 352（右边界 360）、y - size/2 ≥ -588、两两圆心距 > 半径和。
        // 下边界取 -588 而不是 -640：预览窗口是 393×679 的短窗口，引擎按宽度缩放后
        // 底部约 36 设计像素会被裁掉，贴底的「破」被切了一半（真机 720×1280 不裁）。
        // 叠压教训：斩/怒曾重叠，改位置后必须重新算圆心距。
        mk('basic', 222, -532, 112, COLOR.PRIMARY, PLAYER_TUNING.basic.cd);   // 斩 r56 → 底 -588
        mk('skill1', 132, -360, 88, '#0EA5E9', PLAYER_TUNING.charge.cd);       // 冲 r44
        mk('skill2', 110, -452, 88, '#8B5CF6', PLAYER_TUNING.whirlwind.cd);    // 旋 r44 → 距斩 137.6 > 100
        mk('skill3', 100, -544, 88, '#F59E0B', PLAYER_TUNING.armorBreak.cd);   // 破 r44 → 底 -588
        mk('dodge', 310, -348, 84, '#22C55E', PLAYER_TUNING.dodge.cd);         // 闪 r42 → 右 352
        mk('burst', 300, -452, 96, '#EF4444', PLAYER_TUNING.burst.cd);         // 怒 r48 → 距闪 104.7 > 90
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

            const needRage = b.key === 'burst' ? PLAYER_TUNING.burst.rageCost : 0;
            const rageOk = p.rage >= needRage;
            const ready = cd <= 0.001 && rageOk;
            const r = b.size / 2;

            b.g.clear();
            // 底
            b.g.fillColor = hex(ready ? b.color : '#1F2937', ready ? 235 : 210);
            b.g.circle(0, 0, r - 2);
            b.g.fill();
            // 外圈
            b.g.strokeColor = hex(ready ? '#E5E7EB' : '#475569', 220);
            b.g.lineWidth = b.pressed ? 5 : 3;
            b.g.circle(0, 0, r - 3);
            b.g.stroke();

            // 冷却扇形
            if (cd > 0.001 && b.total > 0) {
                b.g.fillColor = hex('#000000', 150);
                b.g.moveTo(0, 0);
                b.g.arc(0, 0, r - 4, Math.PI / 2, Math.PI / 2 - Math.PI * 2 * Math.max(0, Math.min(1, cd / b.total)), true);
                b.g.close();
                b.g.fill();
                b.cdLabel.node.active = true;
                b.cdLabel.string = cd >= 1 ? `${Math.ceil(cd)}` : cd.toFixed(1);
                b.cdLabel.color = hex('#FFFFFF', 235);
                b.label.color = hex('#CBD5E1', 180);
            } else {
                b.cdLabel.node.active = false;
                b.label.color = hex('#FFFFFF', 255);
            }

            // 怒气不足：灰色 + 需求
            if (b.key === 'burst' && !rageOk) {
                b.g.fillColor = hex('#000000', 120);
                b.g.circle(0, 0, r - 4);
                b.g.fill();
                b.cdLabel.node.active = true;
                b.cdLabel.string = `${Math.floor(p.rage)}/100`;
                b.cdLabel.color = hex('#FCA5A5', 255);
            }

            // 怒气环 / 持续时间提示
            if (b.key === 'burst' && rageOk && cd <= 0.001) {
                b.g.strokeColor = hex('#F59E0B', 255);
                b.g.lineWidth = 4;
                b.g.arc(0, 0, r - 1, Math.PI / 2, Math.PI / 2 - Math.PI * 2 * Math.max(0, Math.min(1, p.rage / 100)), true);
                b.g.stroke();
            }
            if (b.key === 'basic' && p.whirlwind > 0) {
                b.g.strokeColor = hex('#8B5CF6', 200);
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
        this._resultTitle!.string = won ? '副本通关' : '你倒下了';
        this._resultTitle!.color = hex(won ? COLOR.SUCCESS : COLOR.DANGER);
        this._refreshResultBody();
    }

    private _refreshResultBody(): void {
        if (!this._resultBody) return;
        const lines = [
            `${this._lastDungeonName}`,
            `用时 ${this._lastTimeText}    击杀 ${this._lastKills}`,
            this._lastWin ? '矿坑巨魔已被击败' : `推进到 ${this._lastProgress}`,
        ];
        if (this._lootLines.length > 0) lines.push(...this._lootLines);
        this._resultBody.string = lines.join('\n');
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
        g.fillColor = hex(COLOR.BG_OVERLAY, 235);
        g.rect(-360, -640, 720, 1280);
        g.fill();
        // 遮罩必须吞掉触摸：否则结算时点「再来一次」附近的空白会把点击漏给下层摇杆 / 技能键，
        // 摇杆在结算期间还能拖动（全屏遮罩 + 不拦事件 = 幽灵输入）
        mask.addComponent(BlockInputEvents);
        root.addChild(mask);

        const panel = new Node('Panel');
        panel.layer = this.node.layer;
        const put = panel.addComponent(UITransform);
        put.setContentSize(520, 500);
        const pg = panel.addComponent(Graphics);
        pg.fillColor = hex(COLOR.PANEL_BG, 255);
        pg.roundRect(-260, -250, 520, 500, 24);
        pg.fill();
        pg.strokeColor = hex(COLOR.PANEL_BORDER, 255);
        pg.lineWidth = 3;
        pg.roundRect(-260, -250, 520, 500, 24);
        pg.stroke();
        root.addChild(panel);

        this._resultTitle = createLabel(panel, '', 44, {
            width: 460, height: 60, color: COLOR.TEXT_PRIMARY, bold: true, y: 190,
        });
        this._resultBody = createLabel(panel, '', 18, {
            width: 470, height: 180, color: COLOR.TEXT_SECONDARY, y: 60,
            lineHeight: 28,
        });

        const again = createButton(panel, {
            w: 150, h: 58, text: '再来一次', fontSize: 24,
            fill: COLOR.PRIMARY, textColor: '#FFFFFF', activeFill: COLOR.PRIMARY_DARK,
            radius: 14, onTap: () => this._onRestartTap(),
        });
        again.node.setPosition(-172, -190, 0);

        const bag = createButton(panel, {
            w: 150, h: 58, text: '装备', fontSize: 24,
            fill: '#A855F7', textColor: '#FFFFFF', activeFill: '#7E3AF2',
            radius: 14, onTap: () => this._onBagTap(),
        });
        bag.node.setPosition(0, -190, 0);

        const exit = createButton(panel, {
            w: 150, h: 58, text: '返回大厅', fontSize: 24,
            fill: '#334155', textColor: COLOR.TEXT_PRIMARY, activeFill: '#475569',
            radius: 14, onTap: () => this._onExitTap(),
        });
        exit.node.setPosition(172, -190, 0);

        root.active = false;
    }

    private _onRestartTap = (): void => {
        if (this.onRestart) this.onRestart();
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
