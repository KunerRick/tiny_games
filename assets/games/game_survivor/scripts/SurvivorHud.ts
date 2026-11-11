/**
 * 午夜幸存者 — 运行时 HUD（M3）。
 *
 * 顶栏只放「现在就能读」的信息：时间、等级、生命、经验、当前构筑、击杀。
 *  - 与升级面板一样由代码创建，不改 .scene
 *  - 每帧调用 refresh()，但文字只在变化时赋值（Label 重排很贵）
 *  - HP / XP 条用一个 Graphics 每帧重画（两条圆角矩形，成本可忽略）
 *
 * 构筑行是「升级不明显」的关键反馈：玩家选过的每一张卡都要在屏幕上留下名字。
 */

import { _decorator, Component, EventTouch, Graphics, Label, Node, tween, UIOpacity, UITransform } from 'cc';
import { COLOR, hex } from '../../../common/ui/UITheme';
import { COLORS, PASSIVE_NAMES, WEAPON_NAMES, SurvivorSnapshot } from './SurvivorConfig';
import type { PassiveTrack, WeaponTrack } from './SurvivorConfig';

const { ccclass } = _decorator;

const BAR_LEFT = -340;
const BAR_W = 680;
const HP_BAR_Y = 524;
const HP_BAR_H = 16;
const XP_BAR_Y = 502;
const XP_BAR_H = 10;
/** 生命条只占左半，右边留给等级与击杀 */
const HP_BAR_W = 320;

/** 顶栏小按钮（倍速 / 暂停）：手机上没有键盘，必须给触屏入口 */
const BTN_W = 92;
const BTN_H = 46;
const BTN_SPEED_X = 196;
const BTN_PAUSE_X = 300;
const BTN_Y = 548;

@ccclass('SurvivorHud')
export class SurvivorHud extends Component {
    private _gfx: Graphics | null = null;
    private _time: Label | null = null;
    private _hp: Label | null = null;
    private _level: Label | null = null;
    private _build: Label | null = null;
    private _kills: Label | null = null;
    private _speedLabel: Label | null = null;
    private _pauseLabel: Label | null = null;
    private _speedBtn: Node | null = null;
    private _pauseBtn: Node | null = null;

    /** 由 SurvivorGame 赋值；按钮点击时回调 */
    onSpeedTap: (() => void) | null = null;
    onPauseTap: (() => void) | null = null;

    private _cBarBack = hex(COLOR.BG_OVERLAY, 140);
    private _cHp = hex(COLORS.gem);
    private _cHpLow = hex(COLORS.chaser);
    private _cXp = hex(COLORS.player);

    private _lastTime = '';
    private _lastHp = '';
    private _lastLevel = '';
    private _lastBuild = '';
    private _lastKills = '';
    /** 上次画的条形状（生命/经验比例），没变就不重画 Graphics */
    private _lastBars = '';

    static create(parent: Node): SurvivorHud {
        const node = new Node('Hud');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        parent.addChild(node);
        const hud = node.addComponent(SurvivorHud);
        hud._createWidgets();
        return hud;
    }

    private _createWidgets(): void {
        const root = this.node;
        this._gfx = root.addComponent(Graphics);

        this._time = this._label(root, 0, 588, 240, 40, '', 28, COLOR.TEXT_PRIMARY, true);
        this._level = this._label(root, 250, 588, 160, 36, '', 24, COLOR.TEXT_PRIMARY, true);
        this._level.horizontalAlign = Label.HorizontalAlign.RIGHT;
        this._hp = this._label(root, -170, 548, 300, 22, '', 18, COLOR.TEXT_PRIMARY, true);
        // 左对齐会压到左上角的返回按钮，改成贴着生命条右端右对齐
        this._hp.horizontalAlign = Label.HorizontalAlign.RIGHT;
        this._kills = this._label(root, 250, 472, 180, 28, '', 20, COLOR.TEXT_SECONDARY, false);
        this._kills.horizontalAlign = Label.HorizontalAlign.RIGHT;
        this._build = this._label(root, -80, 472, 520, 28, '', 20, COLOR.TEXT_SECONDARY, false);
        this._build.horizontalAlign = Label.HorizontalAlign.LEFT;

        this._speedBtn = this._makeButton(root, BTN_SPEED_X, BTN_Y, '1x');
        this._pauseBtn = this._makeButton(root, BTN_PAUSE_X, BTN_Y, '暂停');
        this._speedLabel = this._speedBtn.getComponentInChildren(Label);
        this._pauseLabel = this._pauseBtn.getComponentInChildren(Label);
        this._speedBtn.on(Node.EventType.TOUCH_END, this.onSpeedTouched, this);
        this._pauseBtn.on(Node.EventType.TOUCH_END, this.onPauseTouched, this);
    }

    /** 顶栏小按钮：圆角底色 + 边框 + 居中文字 */
    private _makeButton(parent: Node, x: number, y: number, text: string): Node {
        const node = new Node('Btn');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(BTN_W, BTN_H);
        node.setPosition(x, y, 0);

        const g = node.addComponent(Graphics);
        g.fillColor = hex(COLOR.BG_OVERLAY, 120);
        g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, 12);
        g.fill();
        g.lineWidth = 1.5;
        g.strokeColor = hex(COLORS.player, 150);
        g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, 12);
        g.stroke();

        const label = this._label(node, 0, 0, BTN_W - 12, BTN_H - 8, text, 22, COLOR.TEXT_PRIMARY, true);
        label.overflow = Label.Overflow.SHRINK;

        parent.addChild(node);
        return node;
    }

    onDestroy(): void {
        // 只清引用（红线 4）
        this._speedBtn = null;
        this._pauseBtn = null;
        this._speedLabel = null;
        this._pauseLabel = null;
        this.onSpeedTap = null;
        this.onPauseTap = null;
    }

    private onSpeedTouched(ev: EventTouch): void {
        ev.propagationStopped = true;
        if (this.onSpeedTap) this.onSpeedTap();
    }

    private onPauseTouched(ev: EventTouch): void {
        ev.propagationStopped = true;
        if (this.onPauseTap) this.onPauseTap();
    }

    /** 由 SurvivorGame 同步按钮文字（键盘切换倍速时也要跟上） */
    setSpeed(mult: number): void {
        if (this._speedLabel) this._speedLabel.string = `${mult}x`;
    }

    setPaused(paused: boolean): void {
        if (this._pauseLabel) this._pauseLabel.string = paused ? '继续' : '暂停';
    }

    /**
     * 开场提示（试玩报告：直接进战斗、没有任何说明）。
     * 5 秒后淡出并销毁；每条命只显示一次，避免重复开局的干扰。
     */
    showOpeningTip(): void {
        const root = this.node;
        if (!root || !root.isValid || root.getChildByName('OpeningTip')) return;
        const node = new Node('OpeningTip');
        node.layer = root.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(620, 44);
        node.setPosition(0, 380, 0);
        root.addChild(node);

        const g = node.addComponent(Graphics);
        g.fillColor = hex(COLOR.BG_OVERLAY, 190);
        g.roundRect(-310, -22, 620, 44, 22);
        g.fill();
        g.lineWidth = 1.5;
        g.strokeColor = hex(COLORS.player, 150);
        g.roundRect(-310, -22, 620, 44, 22);
        g.stroke();

        const label = this._label(node, 0, 0, 600, 36, '自动攻击 · 升级三选一 · 撑到 8 分钟', 22, COLOR.TEXT_PRIMARY, true);
        label.overflow = Label.Overflow.SHRINK;

        const op = node.addComponent(UIOpacity);
        op.opacity = 255;
        tween(op)
            .delay(5)
            .to(0.6, { opacity: 0 })
            .call(() => {
                if (node.isValid) node.destroy();
            })
            .start();
    }

    private _label(
        parent: Node,
        x: number,
        y: number,
        w: number,
        h: number,
        text: string,
        size: number,
        color: string,
        bold: boolean,
    ): Label {
        const node = new Node('Text');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);
        node.setPosition(x, y, 0);

        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = Math.round(size * 1.3);
        label.color = hex(color);
        label.isBold = bold;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;

        parent.addChild(node);
        return label;
    }

    refresh(snap: SurvivorSnapshot): void {
        const p = snap.player;
        const t = Math.max(0, Math.floor(snap.time));
        const mm = Math.floor(t / 60);
        const ss = t % 60;
        const time = `${mm}:${ss < 10 ? '0' : ''}${ss}`;
        if (this._time && time !== this._lastTime) {
            this._time.string = time;
            this._lastTime = time;
        }

        const hpText = `生命 ${Math.ceil(Math.max(0, p.hp))}/${p.maxHp}`;
        if (this._hp && hpText !== this._lastHp) {
            this._hp.string = hpText;
            this._lastHp = hpText;
        }

        const lvText = `Lv.${p.level}`;
        if (this._level && lvText !== this._lastLevel) {
            this._level.string = lvText;
            this._lastLevel = lvText;
        }

        const kills = `击杀 ${snap.kills}`;
        if (this._kills && kills !== this._lastKills) {
            this._kills.string = kills;
            this._lastKills = kills;
        }

        const build = this._buildText(snap);
        if (this._build && build !== this._lastBuild) {
            this._build.string = build;
            this._lastBuild = build;
        }

        this._drawBars(snap);
    }

    private _buildText(snap: SurvivorSnapshot): string {
        const parts: string[] = [];
        const weapons = snap.weapons || {};
        const passives = snap.passives || {};

        for (const key of Object.keys(weapons)) {
            const lv = weapons[key as WeaponTrack] || 0;
            if (lv > 0) parts.push(`${WEAPON_NAMES[key as WeaponTrack] || key}${lv}`);
        }
        const passiveParts: string[] = [];
        for (const key of Object.keys(passives)) {
            const lv = passives[key as PassiveTrack] || 0;
            if (lv > 0) passiveParts.push(`${PASSIVE_NAMES[key as PassiveTrack] || key}${lv}`);
        }
        if (snap.temper > 0) passiveParts.push(`淬炼${snap.temper}`);

        const weaponText = parts.length > 0 ? parts.join(' · ') : '未获得武器';
        return passiveParts.length > 0 ? `${weaponText} ｜ ${passiveParts.join(' · ')}` : weaponText;
    }

    private _drawBars(snap: SurvivorSnapshot): void {
        const g = this._gfx;
        if (!g) return;
        const p = snap.player;

        const hpRatio = p.maxHp > 0 ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 0;
        const xpRatio = p.xpNeed > 0 ? Math.max(0, Math.min(1, p.xp / p.xpNeed)) : 0;
        // 比例量化到 1/1000：肉眼无差，但省掉每帧重建 Graphics 顶点
        const bars = `${Math.round(hpRatio * 1000)}|${Math.round(xpRatio * 1000)}`;
        if (bars === this._lastBars) return;
        this._lastBars = bars;

        g.clear();

        // 生命条
        g.fillColor = this._cBarBack;
        g.roundRect(BAR_LEFT, HP_BAR_Y - HP_BAR_H / 2, HP_BAR_W, HP_BAR_H, HP_BAR_H / 2);
        g.fill();
        if (hpRatio > 0) {
            g.fillColor = hpRatio <= 0.3 ? this._cHpLow : this._cHp;
            g.roundRect(BAR_LEFT, HP_BAR_Y - HP_BAR_H / 2, HP_BAR_W * hpRatio, HP_BAR_H, HP_BAR_H / 2);
            g.fill();
        }

        // 经验条
        g.fillColor = this._cBarBack;
        g.roundRect(BAR_LEFT, XP_BAR_Y - XP_BAR_H / 2, BAR_W, XP_BAR_H, XP_BAR_H / 2);
        g.fill();
        if (xpRatio > 0) {
            g.fillColor = this._cXp;
            g.roundRect(BAR_LEFT, XP_BAR_Y - XP_BAR_H / 2, BAR_W * xpRatio, XP_BAR_H, XP_BAR_H / 2);
            g.fill();
        }
    }
}
