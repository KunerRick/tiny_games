import {
    _decorator, Component, Node, Label, Button, ProgressBar, UITransform, tween, Vec3, Color, Graphics,
    UIOpacity,
} from 'cc';
import {
    Age, AIDifficulty, AI_DIFFICULTY_NAMES, AGE_NAMES, UnitConfig, getUnitsByAge,
} from './GameConfig';
import {
    UI, createButton, createLabel, createNode, createRoundRect, drawRoundRect, toColor, toast, UiButton,
} from '../../../common/ui/GameUIKit';
import { drawUnitSilhouette, colorFromHex } from './UnitArt';

const { ccclass, property } = _decorator;

export interface HudState {
    gold: number;
    kills: number;
    age: Age;
    playerHP: number;
    playerMaxHP: number;
    enemyHP: number;
    enemyMaxHP: number;
    exp: number;
    expRequired: number;
    goldRequired: number;
    canEvolve: boolean;
    canBuyExp: boolean;
    buyExpCost: number;
    buyExpLeft: number;
    evolveTitle: string;
    evolveSub: string;
    chargeState: 'ready' | 'active' | 'cooldown';
    chargeRemain: number;
    difficulty: AIDifficulty;
}

/** 一条运行时绘制的进度条（避免每帧重画整块 HUD） */
class HudBar {
    public readonly node: Node;
    private _g: Graphics;
    private _w: number;
    private _h: number;
    private _radius: number;
    private _ratio = -1;
    private _color = '';

    constructor(parent: Node, name: string, w: number, h: number, x: number, y: number, radius: number) {
        const node = createNode(name, parent, w, h);
        node.setPosition(x, y, 0);
        this.node = node;
        this._w = w;
        this._h = h;
        this._radius = radius;
        this._g = node.addComponent(Graphics);
        this.redraw(0, UI.textMuted);
    }

    public redraw(ratio: number, colorHex: string): void {
        const r = Math.max(0, Math.min(1, ratio));
        if (Math.abs(r - this._ratio) < 0.001 && colorHex === this._color) return;
        this._ratio = r;
        this._color = colorHex;
        drawRoundRect(this._g, this._w, this._h, this._radius, toColor('#0B1220', 220), toColor('#27364F'), 2);
        if (r > 0) {
            const fw = Math.max(2, (this._w - 4) * r);
            const g = this._g;
            g.fillColor = toColor(colorHex);
            g.roundRect(-this._w / 2 + 2, -this._h / 2 + 2, fw, this._h - 4,
                Math.min(this._radius, (this._h - 4) / 2));
            g.fill();
        }
    }
}

/**
 * UI 控制器
 * 顶部信息栏、底部产兵/进化/冲锋按钮、结算面板、进化仪式
 *
 * 场景里原有的 topBar / bottomBar 是旧版小字排版，运行时隐藏，
 * 由本组件用 GameUIKit 重新搭建（计划 V4）。
 */
@ccclass('UIController')
export class UIController extends Component {
    // ======== 场景绑定（保留用于兼容旧场景；运行时隐藏旧节点） ========
    @property(ProgressBar)
    playerHP: ProgressBar | null = null;

    @property(ProgressBar)
    enemyHP: ProgressBar | null = null;

    @property(Label)
    hpPlayerLabel: Label | null = null;

    @property(Label)
    hpEnemyLabel: Label | null = null;

    @property(Label)
    goldLabel: Label | null = null;

    @property(Label)
    ageLabel: Label | null = null;

    @property(Label)
    killLabel: Label | null = null;

    @property(Button)
    unitButton0: Button | null = null;

    @property(Button)
    unitButton1: Button | null = null;

    @property(Button)
    evolveButton: Button | null = null;

    @property(Label)
    unitName0: Label | null = null;

    @property(Label)
    unitCost0: Label | null = null;

    @property(Label)
    unitName1: Label | null = null;

    @property(Label)
    unitCost1: Label | null = null;

    @property(Label)
    evolveNameLabel: Label | null = null;

    @property(Label)
    evolveCostLabel: Label | null = null;

    // ======== 结算面板 ========
    @property(Node)
    gameOverPanel: Node | null = null;

    @property(Label)
    resultLabel: Label | null = null;

    @property(Label)
    statsLabel: Label | null = null;

    @property(Button)
    restartButton: Button | null = null;

    @property(Button)
    lobbyButton: Button | null = null;

    // ======== AI 进化提示 ========
    @property(Node)
    enemyEvolveNotice: Node | null = null;

    @property(Label)
    enemyEvolveLabel: Label | null = null;

    // ======== 运行时 ========
    private _onUnitSpawn: ((configId: string) => void) | null = null;
    private _onEvolve: (() => void) | null = null;
    private _onRestart: (() => void) | null = null;
    private _onLobby: (() => void) | null = null;
    private _onCharge: (() => void) | null = null;
    private _onToggleDifficulty: (() => void) | null = null;

    // HUD 节点
    private _hud: Node | null = null;
    private _playerHpBar: HudBar | null = null;
    private _enemyHpBar: HudBar | null = null;
    private _expBar: HudBar | null = null;
    private _hpPlayerText: Label | null = null;
    private _hpEnemyText: Label | null = null;
    private _goldText: Label | null = null;
    private _ageText: Label | null = null;
    private _killText: Label | null = null;
    private _expText: Label | null = null;
    private _difficultyBtn: UiButton | null = null;
    private _chargeBtn: UiButton | null = null;
    private _unitBtns: UiButton[] = [];
    private _unitIcons: Graphics[] = [];
    private _unitBars: HudBar[] = [];
    private _unitNameLabels: Label[] = [];
    private _unitCostLabels: Label[] = [];
    private _evolveBtn: UiButton | null = null;
    private _evolveSubLabel: Label | null = null;

    private _unitConfigs: UnitConfig[] = [];
    private _currentAge: Age = Age.PRIMITIVE;
    private _chargeState: HudState['chargeState'] = 'ready';
    private _evolveNoticeTimer: number = 0;

    onLoad() {
        // 旧版 HUD 隐藏（新 HUD 由本组件运行时搭建）
        const topBar = this.node.getChildByName('topBar');
        if (topBar) topBar.active = false;
        const bottomBar = this.node.getChildByName('bottomBar');
        if (bottomBar) bottomBar.active = false;

        this.buildHud();
        this.restyleResultPanel();

        // 结算面板按钮：场景里只有 Button 组件、没有配置 clickEvents，
        // 必须自己绑定具名方法（红线 3 / 5）
        if (this.restartButton) {
            this.restartButton.node.on(Node.EventType.TOUCH_END, this.onRestartTap, this);
        }
        if (this.lobbyButton) {
            this.lobbyButton.node.on(Node.EventType.TOUCH_END, this.onLobbyTap, this);
        }

        if (this.gameOverPanel) this.gameOverPanel.active = false;
        if (this.enemyEvolveNotice) this.enemyEvolveNotice.active = false;
    }

    // ======== 运行时按钮事件（具名，红线 5） ========
    private onUnitBtn0(): void { this._onUnitSpawn?.('__btn0__'); }
    private onUnitBtn1(): void { this._onUnitSpawn?.('__btn1__'); }
    private onEvolveTap(): void { this._onEvolve?.(); }
    private onChargeTap(): void { this._onCharge?.(); }
    private onDifficultyTap(): void { this._onToggleDifficulty?.(); }
    private onRestartTap(): void { this._onRestart?.(); }
    private onLobbyTap(): void { this._onLobby?.(); }

    public setCallbacks(
        onUnitSpawn: (configId: string) => void,
        onEvolve: () => void,
        onRestart: () => void,
        onLobby: () => void,
        onCharge?: () => void,
        onToggleDifficulty?: () => void,
    ): void {
        this._onUnitSpawn = onUnitSpawn;
        this._onEvolve = onEvolve;
        this._onRestart = onRestart;
        this._onLobby = onLobby;
        this._onCharge = onCharge ?? null;
        this._onToggleDifficulty = onToggleDifficulty ?? null;
    }

    public getUnitConfigByIndex(idx: number): UnitConfig | undefined {
        return this._unitConfigs[idx];
    }

    // ==================== HUD 搭建 ====================

    private buildHud(): void {
        const hud = createNode('Hud', this.node, 720, 1200);
        hud.setSiblingIndex(0);
        this._hud = hud;

        // ---------- 顶部面板 ----------
        const panel = createRoundRect(hud, 'TopPanel', 700, 180, 20, UI.panel, UI.panelStroke, 2);
        panel.node.setPosition(0, 600, 0);

        // 城堡血条（左右各 300×22）
        this._playerHpBar = new HudBar(hud, 'PlayerHp', 300, 22, -175, 648, 11);
        this._enemyHpBar = new HudBar(hud, 'EnemyHp', 300, 22, 175, 648, 11);
        createLabel(hud, 'VS', 20, { width: 60, height: 30, color: UI.textMuted, bold: true, x: 0, y: 648 });
        this._hpPlayerText = createLabel(hud, '', 18, { width: 300, height: 26, x: -175, y: 648, bold: true });
        this._hpEnemyText = createLabel(hud, '', 18, { width: 300, height: 26, x: 175, y: 648, bold: true });

        // 金币
        const coin = createNode('Coin', hud, 24, 24);
        coin.setPosition(-306, 600, 0);
        const cg = coin.addComponent(Graphics);
        cg.fillColor = colorFromHex('#F59E0B');
        cg.circle(0, 0, 10);
        cg.fill();
        cg.fillColor = colorFromHex('#FDE68A');
        cg.circle(-2, 2, 4);
        cg.fill();
        this._goldText = createLabel(hud, '0', 24, {
            width: 160, height: 34, x: -215, y: 600, bold: true, align: 'left',
        });

        // 时代 / 击杀 / 难度
        this._ageText = createLabel(hud, '', 24, { width: 200, height: 34, x: -50, y: 600, bold: true, color: UI.accent });
        this._killText = createLabel(hud, '', 20, { width: 150, height: 32, x: 105, y: 600, color: UI.textDim });
        this._difficultyBtn = createButton(hud, {
            w: 130, h: 48, text: '难度 普通', fontSize: 20, fill: '#1E293B', textColor: UI.textDim,
            onTap: () => this.onDifficultyTap(),
        });
        this._difficultyBtn.node.setPosition(280, 600, 0);

        // 进化/经验进度条
        this._expBar = new HudBar(hud, 'ExpBar', 620, 16, 0, 556, 8);
        this._expText = createLabel(hud, '', 16, { width: 620, height: 22, x: 0, y: 556, color: UI.text, bold: true });

        // ---------- 底部：冲锋 ----------
        this._chargeBtn = createButton(hud, {
            w: 300, h: 64, text: '全军冲锋', fontSize: 24, fill: UI.primary, textColor: UI.white,
            onTap: () => this.onChargeTap(),
        });
        this._chargeBtn.node.setPosition(0, -350, 0);

        // ---------- 底部：兵种 + 进化 ----------
        const xs = [-240, 0, 240];
        for (let i = 0; i < 2; i++) {
            const btn = createButton(hud, {
                w: 210, h: 120, text: '', fontSize: 22, fill: '#1B2740', stroke: '#2B3B55',
                onTap: i === 0 ? () => this.onUnitBtn0() : () => this.onUnitBtn1(),
            });
            btn.node.setPosition(xs[i], -470, 0);
            // 图标层
            const iconNode = createNode('icon', btn.node, 56, 56);
            iconNode.setPosition(0, 32, 0);
            const icon = iconNode.addComponent(Graphics);
            const nameLbl = createLabel(btn.node, '', 22, { width: 190, height: 28, x: 0, y: 2, bold: true });
            const costLbl = createLabel(btn.node, '', 20, { width: 190, height: 26, x: 0, y: -28, color: UI.textDim });
            const bar = new HudBar(btn.node, 'afford', 170, 8, 0, -50, 4);
            this._unitBtns.push(btn);
            this._unitIcons.push(icon);
            this._unitBars.push(bar);
            this._unitNameLabels.push(nameLbl);
            this._unitCostLabels.push(costLbl);
        }

        this._evolveBtn = createButton(hud, {
            w: 210, h: 120, text: '', fontSize: 22, fill: '#1B2740', stroke: '#2B3B55',
            onTap: () => this.onEvolveTap(),
        });
        this._evolveBtn.node.setPosition(xs[2], -470, 0);
        // 按钮自带 label 就是标题，居中会压住下面的副标题 → 上移到 y=26
        this._evolveBtn.label.node.setPosition(0, 26, 0);
        this._evolveSubLabel = createLabel(this._evolveBtn.node, '', 17, {
            width: 190, height: 52, x: 0, y: -20, color: UI.textDim, overflow: 'shrink',
        });

        // WarEvo.onLoad 可能早于本组件 onLoad，提前调用的 setupUnitButtons 落在空数组上，
        // 这里用已经记录的 _currentAge 重新填一次（否则初始时代按钮是空白的）
        this.setupUnitButtons(this._currentAge);
    }

    /** 重排结算面板（V1：放大、加失败原因建议） */
    private restyleResultPanel(): void {
        if (!this.gameOverPanel) return;
        const panelBg = this.gameOverPanel.getChildByName('panelBg');
        if (panelBg) {
            const ut = panelBg.getComponent(UITransform);
            if (ut) ut.setContentSize(580, 560);
        }
        if (this.resultLabel) {
            this.resultLabel.fontSize = 44;
            this.resultLabel.node.setPosition(0, 200, 0);
            const ut = this.resultLabel.node.getComponent(UITransform);
            if (ut) ut.setContentSize(540, 70);
        }
        if (this.statsLabel) {
            this.statsLabel.fontSize = 22;
            this.statsLabel.lineHeight = 34;
            this.statsLabel.node.setPosition(0, 10, 0);
            const ut = this.statsLabel.node.getComponent(UITransform);
            if (ut) ut.setContentSize(500, 300);
        }
        if (this.restartButton) {
            const ut = this.restartButton.node.getComponent(UITransform);
            if (ut) ut.setContentSize(200, 64);
            this.restartButton.node.setPosition(-120, -210, 0);
        }
        if (this.lobbyButton) {
            const ut = this.lobbyButton.node.getComponent(UITransform);
            if (ut) ut.setContentSize(200, 64);
            this.lobbyButton.node.setPosition(120, -210, 0);
        }
    }

    // ==================== 按钮绑定（场景旧按钮；如已隐藏则不触发） ====================

    // ==================== 状态更新 ====================

    /** 更新产兵按钮 — 显示当前时代的兵种（图标 + 名称 + 费用 + 攒钱进度） */
    public setupUnitButtons(age: Age): void {
        this._currentAge = age;
        this._unitConfigs = getUnitsByAge(age);

        for (let i = 0; i < this._unitBtns.length; i++) {
            const btn = this._unitBtns[i];
            const icon = this._unitIcons[i];
            const cfg = this._unitConfigs[i];
            if (!cfg) {
                btn.node.active = false;
                continue;
            }
            btn.node.active = true;
            // 兵种图标（中性色，便于与战场上的阵营色区分）
            drawUnitSilhouette(icon, cfg.icon ?? 'default', colorFromHex('#E2E8F0'));
            if (this._unitNameLabels[i]) this._unitNameLabels[i].string = cfg.name;
            if (this._unitCostLabels[i]) this._unitCostLabels[i].string = `${cfg.cost}g · ${cfg.desc}`;
        }
        if (this._evolveBtn) this._evolveBtn.node.active = true;
    }

    public updateHud(state: HudState): void {
        if (!this._hud) return;

        this._playerHpBar?.redraw(state.playerHP / Math.max(1, state.playerMaxHP), '#38BDF8');
        this._enemyHpBar?.redraw(state.enemyHP / Math.max(1, state.enemyMaxHP), '#EF4444');
        if (this._hpPlayerText) this._hpPlayerText.string = `${Math.max(0, Math.ceil(state.playerHP))} / ${Math.round(state.playerMaxHP)}`;
        if (this._hpEnemyText) this._hpEnemyText.string = `${Math.max(0, Math.ceil(state.enemyHP))} / ${Math.round(state.enemyMaxHP)}`;

        if (this._goldText) this._goldText.string = `${Math.floor(state.gold)}`;
        if (this._ageText) this._ageText.string = AGE_NAMES[state.age];
        if (this._killText) this._killText.string = `击杀 ${state.kills}`;

        if (this._difficultyBtn) {
            this._difficultyBtn.setText(`难度 ${AI_DIFFICULTY_NAMES[state.difficulty]}`);
        }

        // 经验 / 金币进度
        const expRatio = state.expRequired > 0 ? Math.min(1, state.exp / state.expRequired) : 1;
        this._expBar?.redraw(expRatio, state.canEvolve ? '#22C55E' : '#38BDF8');
        if (this._expText) {
            if (state.expRequired > 0) {
                this._expText.string = state.canEvolve
                    ? '可进化！点击右下角「进化」'
                    : `经验 ${Math.floor(state.exp)}/${state.expRequired}　金币 ${Math.floor(state.gold)}/${state.goldRequired}`;
            } else {
                this._expText.string = '已到最高时代';
            }
        }

        // 兵种按钮：买得起高亮 + 攒钱进度
        for (let i = 0; i < this._unitBtns.length; i++) {
            const cfg = this._unitConfigs[i];
            if (!cfg) continue;
            const afford = state.gold >= cfg.cost;
            this._unitBtns[i].setColor(afford ? '#1E3A5F' : '#18202F', afford ? UI.white : UI.textMuted);
            if (this._unitCostLabels[i]) {
                this._unitCostLabels[i].color = toColor(afford ? UI.accent : UI.textMuted);
            }
            this._unitBars[i].redraw(Math.min(1, state.gold / cfg.cost), afford ? '#38BDF8' : '#475569');
        }

        // 进化 / 购买经验按钮
        if (this._evolveBtn) {
            this._evolveBtn.setText(state.evolveTitle);
            if (this._evolveSubLabel) this._evolveSubLabel.string = state.evolveSub;
            const enabled = state.canEvolve || state.canBuyExp;
            this._evolveBtn.setColor(
                state.canEvolve ? '#166534' : (state.canBuyExp ? '#1E3A5F' : '#18202F'),
                enabled ? UI.white : UI.textMuted,
            );
        }

        // 冲锋按钮
        if (this._chargeBtn) {
            if (state.chargeState === 'ready') {
                this._chargeBtn.setText('全军冲锋');
                this._chargeBtn.setColor('#2563EB', UI.white);
            } else if (state.chargeState === 'active') {
                this._chargeBtn.setText(`冲锋中 ${Math.ceil(state.chargeRemain)}s`);
                this._chargeBtn.setColor('#B45309', UI.white);
            } else {
                this._chargeBtn.setText(`冲锋冷却 ${Math.ceil(state.chargeRemain)}s`);
                this._chargeBtn.setColor('#18202F', UI.textMuted);
            }
            this._chargeState = state.chargeState;
        }
    }

    public getChargeState(): HudState['chargeState'] { return this._chargeState; }

    // ==================== 结算面板 ====================

    public showGameOver(
        result: 'win' | 'lose' | 'draw',
        age: Age,
        kills: number,
        totalGold: number,
        gameTime: number,
        maxKills: number,
        bestTime: number,
        isNewKillRecord: boolean,
        isNewTimeRecord: boolean,
        reason: string,
        advice: string,
        difficulty: string,
    ): void {
        if (!this.gameOverPanel) return;
        if (this.resultLabel) {
            if (result === 'win') {
                this.resultLabel.string = '胜利！';
                this.resultLabel.color = toColor(UI.success);
            } else if (result === 'lose') {
                this.resultLabel.string = '失败...';
                this.resultLabel.color = toColor(UI.danger);
            } else {
                this.resultLabel.string = '平局';
                this.resultLabel.color = toColor(UI.warning);
            }
        }
        if (this.statsLabel) {
            const formatTime = (seconds: number): string => {
                if (!isFinite(seconds)) return '--:--';
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins}:${secs < 10 ? '0' + secs : secs}`;
            };

            let text = '';
            if (result === 'lose') {
                text += `失败原因：${reason}\n`;
                text += `下次试试：${advice}\n\n`;
            } else if (result === 'win') {
                text += `你摧毁了敌方城堡，用时 ${formatTime(gameTime)}\n`;
                if (isNewTimeRecord) text += '最快通关纪录已刷新！\n';
                text += '\n';
            }

            text += `难度：${difficulty}　时代：${AGE_NAMES[age]}\n`;
            text += `击杀：${kills}（最高 ${maxKills}${isNewKillRecord ? '，新纪录！' : ''}）\n`;
            text += `剩余金币：${Math.floor(totalGold)}\n`;
            if (result === 'win') {
                text += `最快通关：${formatTime(bestTime)}`;
            }
            this.statsLabel.string = text;
        }
        this.gameOverPanel.active = true;
    }

    /** 重置所有提示状态（重新开始时调用） */
    public resetAll(): void {
        this.resetEnemyEvolveNotice();
        if (this.gameOverPanel) this.gameOverPanel.active = false;
    }

    public hideGameOver(): void {
        if (this.gameOverPanel) this.gameOverPanel.active = false;
    }

    // ==================== 进化表现（V5） ====================

    /** 全屏扫光 + 光柱 + 扩散环 + 时代横幅 */
    public showEvolveBanner(age: Age, isPlayer: boolean): void {
        const parent = this._hud ?? this.node;
        const accent = isPlayer ? '#38BDF8' : '#EF4444';

        const flash = createNode('Flash', parent, 720, 1280);
        flash.setSiblingIndex(parent.children.length - 1);
        const g = flash.addComponent(Graphics);
        g.fillColor = isPlayer ? new Color(56, 189, 248, 70) : new Color(239, 68, 68, 60);
        g.rect(-360, -640, 720, 1280);
        g.fill();
        const op = flash.addComponent(UIOpacity);
        op.opacity = 255;
        tween(op).to(0.45, { opacity: 0 })
            .call(() => { if (flash.isValid) flash.destroy(); })
            .start();

        // 光柱：从一条细线横向绽开再淡出（「时代跃迁」的主视觉）
        const beam = createNode('EraBeam', parent, 200, 1280);
        beam.setSiblingIndex(parent.children.length - 1);
        const bg = beam.addComponent(Graphics);
        bg.fillColor = colorFromHex(accent, 38);
        bg.rect(-100, -640, 200, 1280);
        bg.fill();
        bg.fillColor = colorFromHex(accent, 72);
        bg.rect(-44, -640, 88, 1280);
        bg.fill();
        bg.fillColor = colorFromHex('#F8FAFC', 96);
        bg.rect(-9, -640, 18, 1280);
        bg.fill();
        beam.setScale(0.12, 1, 1);
        const beamOp = beam.addComponent(UIOpacity);
        tween(beam).to(0.28, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
        tween(beamOp)
            .delay(0.42)
            .to(0.5, { opacity: 0 })
            .call(() => { if (beam.isValid) beam.destroy(); })
            .start();

        // 扩散环 ×3：错开时间，做出「冲击波一层层荡开」
        for (let i = 0; i < 3; i++) {
            const ring = createNode('EraRing', parent, 320, 320);
            ring.setSiblingIndex(parent.children.length - 1);
            ring.setPosition(0, 40, 0);
            const rg = ring.addComponent(Graphics);
            rg.lineWidth = 5 - i;
            rg.strokeColor = colorFromHex(accent, 190 - i * 40);
            rg.circle(0, 0, 40);
            rg.stroke();
            ring.setScale(0.25, 0.25, 1);
            const rop = ring.addComponent(UIOpacity);
            tween(ring)
                .delay(i * 0.12)
                .to(0.62, { scale: new Vec3(4.2, 4.2, 1) }, { easing: 'quadOut' })
                .call(() => { if (ring.isValid) ring.destroy(); })
                .start();
            tween(rop)
                .delay(i * 0.12)
                .to(0.62, { opacity: 0 })
                .start();
        }

        const banner = createNode('EraBanner', parent, 560, 96);
        banner.setSiblingIndex(parent.children.length - 1);
        banner.setPosition(0, 60, 0);
        const bb = banner.addComponent(Graphics);
        drawRoundRect(bb, 560, 96, 20,
            toColor(isPlayer ? '#0E7490' : '#7F1D1D', 235),
            toColor(isPlayer ? UI.accent : UI.danger), 3);
        createLabel(banner, `${isPlayer ? '进化' : '敌方进化'} → ${AGE_NAMES[age]}`, 32, {
            width: 520, height: 70, bold: true,
        });
        banner.setScale(0.7, 0.7, 1);
        const bop = banner.addComponent(UIOpacity);
        tween(banner).to(0.24, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        tween(bop)
            .delay(1.1)
            .to(0.35, { opacity: 0 })
            .call(() => { if (banner.isValid) banner.destroy(); })
            .start();
    }

    // ==================== 轻提示 / 冲锋表现 ====================

    /** 底部浮层提示 */
    public showToast(text: string): void {
        toast(this._hud ?? this.node, text, 1.6);
    }

    /** 冲锋启动：全屏金色扫光 + 横向速度线 + 横幅（G2 全屏可感知反馈） */
    public showChargeBanner(): void {
        const parent = this._hud ?? this.node;

        const flash = createNode('ChargeFlash', parent, 720, 1280);
        flash.setSiblingIndex(parent.children.length - 1);
        const g = flash.addComponent(Graphics);
        g.fillColor = new Color(245, 158, 11, 62);
        g.rect(-360, -640, 720, 1280);
        g.fill();
        const op = flash.addComponent(UIOpacity);
        tween(op).to(0.4, { opacity: 0 })
            .call(() => { if (flash.isValid) flash.destroy(); })
            .start();

        // 速度线：一片横向金线，向两侧掠出
        const lines = createNode('ChargeSpeedLines', parent, 720, 1280);
        lines.setSiblingIndex(parent.children.length - 1);
        const lg = lines.addComponent(Graphics);
        lg.lineCap = Graphics.LineCap.ROUND;
        lg.lineWidth = 3;
        lg.strokeColor = colorFromHex('#FDE68A', 130);
        for (let i = 0; i < 16; i++) {
            const y = -560 + Math.random() * 1120;
            const x = (Math.random() * 2 - 1) * 280;
            const len = 70 + Math.random() * 130;
            lg.moveTo(x, y);
            lg.lineTo(x + len * (x >= 0 ? 1 : -1), y);
        }
        lg.stroke();
        lines.setScale(1.35, 1, 1);
        const lop = lines.addComponent(UIOpacity);
        tween(lines).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
        tween(lop).to(0.34, { opacity: 0 })
            .call(() => { if (lines.isValid) lines.destroy(); })
            .start();

        const banner = createNode('ChargeBanner', parent, 420, 84);
        banner.setSiblingIndex(parent.children.length - 1);
        banner.setPosition(0, 60, 0);
        const bg = banner.addComponent(Graphics);
        drawRoundRect(bg, 420, 84, 18, toColor('#7C2D12', 240), toColor(UI.warning), 3);
        createLabel(banner, '全军冲锋！', 34, { width: 400, height: 64, bold: true, color: '#FDE68A' });
        banner.setScale(0.6, 0.6, 1);
        const bop = banner.addComponent(UIOpacity);
        tween(banner).to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        tween(bop)
            .delay(0.9)
            .to(0.3, { opacity: 0 })
            .call(() => { if (banner.isValid) banner.destroy(); })
            .start();
    }

    // ==================== 旧进化提示节点（保留兼容） ====================

    /** 重置进化提示状态（重新开始时调用） */
    public resetEnemyEvolveNotice(): void {
        if (this.enemyEvolveNotice) {
            this.enemyEvolveNotice.active = false;
        }
        this._evolveNoticeTimer = 0;
    }

    public showEnemyEvolveNotice(age: Age): void {
        // 统一走横幅表现
        this.showEvolveBanner(age, false);
    }

    public showPlayerEvolveNotice(age: Age): void {
        this.showEvolveBanner(age, true);
    }

    update(dt: number): void {
        if (this._evolveNoticeTimer > 0) {
            this._evolveNoticeTimer -= dt;
            if (this._evolveNoticeTimer <= 0 && this.enemyEvolveNotice) {
                this.enemyEvolveNotice.active = false;
            }
        }
    }
}
