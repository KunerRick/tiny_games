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

import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from 'cc';
import { PASSIVE_NAMES, WEAPON_NAMES, SurvivorSnapshot } from './SurvivorConfig';
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

const TEXT_PRIMARY = '#F8FAFC';
const TEXT_SECONDARY = '#94A3B8';

function hex(hexStr: string, alpha = 255): Color {
    const c = new Color();
    c.fromHEX(hexStr);
    c.a = alpha;
    return c;
}

@ccclass('SurvivorHud')
export class SurvivorHud extends Component {
    private _gfx: Graphics | null = null;
    private _time: Label | null = null;
    private _hp: Label | null = null;
    private _level: Label | null = null;
    private _build: Label | null = null;
    private _kills: Label | null = null;

    private _cBarBack = hex('#000000', 140);
    private _cHp = hex('#5DE89A');
    private _cHpLow = hex('#E85D5D');
    private _cXp = hex('#7FE7FF');

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

        this._time = this._label(root, 0, 588, 240, 40, '', 28, TEXT_PRIMARY, true);
        this._level = this._label(root, 250, 588, 160, 36, '', 24, TEXT_PRIMARY, true);
        this._level.horizontalAlign = Label.HorizontalAlign.RIGHT;
        this._hp = this._label(root, -190, 548, 300, 22, '', 18, TEXT_PRIMARY, true);
        this._hp.horizontalAlign = Label.HorizontalAlign.LEFT;
        this._kills = this._label(root, 250, 472, 180, 28, '', 20, TEXT_SECONDARY, false);
        this._kills.horizontalAlign = Label.HorizontalAlign.RIGHT;
        this._build = this._label(root, -80, 472, 520, 28, '', 20, TEXT_SECONDARY, false);
        this._build.horizontalAlign = Label.HorizontalAlign.LEFT;
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
