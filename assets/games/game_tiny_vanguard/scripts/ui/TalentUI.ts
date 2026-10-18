import {
  BlockInputEvents, Button, Label, Node, Sprite, SpriteFrame, UITransform,
} from 'cc';
import {
  ALPHA, COLOR, CONTROL, FONT_BODY, FONT_CAPTION, FONT_TITLE,
  applyButtonTheme, applyFontAndColor, hex,
} from '../config/Theme';
import { TALENTS, TalentConfig } from '../config/GameData';

/**
 * 荣誉天赋面板（设计 §6.2「⭐ 荣誉天赋树」）。
 *
 * 为什么整套节点在运行时创建：面板内容完全由 `TALENTS` 数据驱动（9 行），
 * 场景里手摆 9×5 个节点既冗长又容易与数据脱节 —— 与 `UpgradeUI` 的卡片同思路，
 * 只在场景里放一个入口按钮，其余按数据生成。
 */
export interface TalentUiHost {
  /** 可用荣誉（累计荣誉 − 已消费） */
  getHonorBalance(): number;
  /** 已购买某天赋的次数 */
  getPurchases(talentId: string): number;
  /** 尝试购买；成功返回 true（宿主负责扣荣誉与持久化） */
  purchaseTalent(talentId: string): boolean;
}

const PANEL_W = 620;
const PANEL_H = 900;
const ROW_W = 560;
/** 行高 62 + 间距 6：9 行共 612，与底部"关闭"按钮留出足够间隙 */
const ROW_H = 62;
const ROW_GAP = 6;

export class TalentUI {
  private _host: TalentUiHost;
  private _root: Node | null = null;
  private _solidFrame: SpriteFrame | null = null;
  private _balanceLabel: Label | null = null;
  private _rows: { cfg: TalentConfig; node: Node; nameLabel: Label; costLabel: Label; ownedLabel: Label; bg: Sprite; btn: Button | null }[] = [];

  constructor(host: TalentUiHost) {
    this._host = host;
  }

  /** 首次调用时在 parent 下构建整棵面板树；之后只刷新数据 */
  show(parent: Node, frame: SpriteFrame | null): void {
    if (!parent?.isValid) return;
    if (!this._root?.isValid) {
      this._solidFrame = frame;
      this.build(parent);
    }
    this._root!.active = true;
    this.refresh();
  }

  hide(): void {
    if (this._root?.isValid) this._root.active = false;
  }

  get isVisible(): boolean {
    return !!this._root?.isValid && !!this._root.activeInHierarchy;
  }

  // -------------------------------------------------------------------------
  // 构建
  // -------------------------------------------------------------------------

  private build(parent: Node): void {
    const root = new Node('TalentPanel');
    const rootUi = root.addComponent(UITransform);
    rootUi.setContentSize(720, 1280);
    // 全屏拦截：避免点击穿透到背后的职业选择按钮
    root.addComponent(BlockInputEvents);
    parent.addChild(root);

    // 遮罩
    const overlay = this.makeSolid('Overlay', root, 720, 1280, COLOR.BG_OVERLAY, ALPHA.BG_OVERLAY);

    // 面板
    const panel = new Node('Panel');
    const panelUi = panel.addComponent(UITransform);
    panelUi.setContentSize(PANEL_W, PANEL_H);
    const panelBg = panel.addComponent(Sprite);
    this.applyFrame(panelBg);
    panelBg.color = hex(COLOR.PANEL_BG, ALPHA.PANEL_BG);
    root.addChild(panel);

    // 标题
    const title = this.makeLabel('Title', panel, '荣誉天赋', FONT_TITLE, COLOR.TEXT_PRIMARY, ROW_W);
    title.setPosition(0, PANEL_H / 2 - 52, 0);

    // 可用荣誉
    const balance = this.makeLabel('Balance', panel, '', FONT_BODY, COLOR.WARNING, ROW_W);
    balance.setPosition(0, PANEL_H / 2 - 96, 0);
    this._balanceLabel = balance.getComponent(Label);

    // 说明
    const hint = this.makeLabel('Hint', panel, '消耗 50 荣誉购买一次，跨局永久生效', FONT_CAPTION, COLOR.TEXT_SECONDARY, ROW_W);
    hint.setPosition(0, PANEL_H / 2 - 128, 0);

    // 天赋行
    const listTop = PANEL_H / 2 - 160;
    for (let i = 0; i < TALENTS.length; i++) {
      const cfg = TALENTS[i];
      const row = new Node(`Talent_${cfg.id}`);
      const ui = row.addComponent(UITransform);
      ui.setContentSize(ROW_W, ROW_H);
      const bg = row.addComponent(Sprite);
      this.applyFrame(bg);
      bg.color = hex(COLOR.SURFACE, ALPHA.SOLID);
      row.setPosition(0, listTop - ROW_H / 2 - i * (ROW_H + ROW_GAP), 0);
      panel.addChild(row);

      // 左半区：名称（上）+ 描述（下）。宽度收到 240，右半区留给"已购/价格"
      const nameNode = this.makeLabel('Name', row, cfg.name, FONT_BODY, COLOR.TEXT_PRIMARY, 240, 'left');
      nameNode.setPosition(-ROW_W / 2 + 16, ROW_H / 2 - 18, 0);
      const nameLabel = nameNode.getComponent(Label)!;

      const descNode = this.makeLabel('Desc', row, cfg.description, FONT_CAPTION, COLOR.TEXT_SECONDARY, 240, 'left');
      descNode.setPosition(-ROW_W / 2 + 16, -ROW_H / 2 + 16, 0);

      // 右半区：已购 x/max（左）+ 价格（右）
      const ownedNode = this.makeLabel('Owned', row, '', FONT_CAPTION, COLOR.TEXT_SECONDARY, 90, 'right');
      ownedNode.setPosition(60, 0, 0);
      const ownedLabel = ownedNode.getComponent(Label)!;

      const costNode = this.makeLabel('Cost', row, '', FONT_BODY, COLOR.WARNING, 190, 'right');
      costNode.setPosition(ROW_W / 2 - 16, 0, 0);
      const costLabel = costNode.getComponent(Label)!;

      // 点击购买：整行都是热区（命名方法，便于解绑）
      const btn = row.addComponent(Button);
      applyButtonTheme(btn, 'secondary');
      row.on(Node.EventType.TOUCH_END, this.onRowClicked, this);

      this._rows.push({ cfg, node: row, nameLabel, costLabel, ownedLabel, bg, btn });
    }

    // 关闭
    const close = new Node('CloseBtn');
    const closeUi = close.addComponent(UITransform);
    closeUi.setContentSize(200, CONTROL.BTN_HEIGHT);
    const closeBg = close.addComponent(Sprite);
    this.applyFrame(closeBg);
    closeBg.color = hex(COLOR.PRIMARY, ALPHA.SOLID);
    close.setPosition(0, -PANEL_H / 2 + 56, 0);
    const closeBtn = close.addComponent(Button);
    applyButtonTheme(closeBtn, 'primary');
    close.on(Node.EventType.TOUCH_END, this.onCloseClicked, this);
    const closeLabel = this.makeLabel('Label', close, '关闭', FONT_BODY, COLOR.TEXT_PRIMARY, 200);
    closeLabel.setPosition(0, 0, 0);
    panel.addChild(close);

    this._root = root;
    void overlay;
  }

  /** 纯色块（必须有 spriteFrame，否则什么都不画） */
  private makeSolid(name: string, parent: Node, w: number, h: number, colorHex: string, alpha: number): Node {
    const n = new Node(name);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(w, h);
    const sp = n.addComponent(Sprite);
    this.applyFrame(sp);
    sp.color = hex(colorHex, alpha);
    parent.addChild(n);
    return n;
  }

  /**
   * 统一设置纯色块的 Sprite。
   * ⚠ **先 `sizeMode = CUSTOM` 再赋贴图**：赋贴图时若仍是默认 TRIMMED，引擎会立刻把
   * 节点尺寸改成贴图原始尺寸（AGENTS 教训 C）—— 实测把 620×900 的面板与 560×62 的行
   * 全部撑成了贴图尺寸，点击热区跟着错位、行点不动。
   */
  private applyFrame(sp: Sprite): void {
    if (!sp) return;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    if (!sp.spriteFrame && this._solidFrame) sp.spriteFrame = this._solidFrame;
  }

  /**
   * 建一个 Label 节点。
   * **必须显式给宽度与对齐**：Label 的框若沿用整行宽度，左对齐文本会从行外起笔
   * （实测 528 宽的左对齐标签把文字画到了行外 150px）。
   */
  private makeLabel(
    name: string, parent: Node, text: string,
    font: { fontSize: number; lineHeight: number }, colorHex: string,
    width: number, align: 'left' | 'center' | 'right' = 'center'
  ): Node {
    const n = new Node(name);
    const ui = n.addComponent(UITransform);
    ui.setContentSize(width, font.lineHeight);
    ui.setAnchorPoint(align === 'left' ? 0 : (align === 'right' ? 1 : 0.5), 0.5);
    const lb = n.addComponent(Label);
    lb.string = text;
    applyFontAndColor(lb, font, colorHex);
    lb.horizontalAlign = align === 'left'
      ? Label.HorizontalAlign.LEFT
      : (align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER);
    lb.verticalAlign = Label.VerticalAlign.CENTER;
    lb.overflow = Label.Overflow.SHRINK;
    parent.addChild(n);
    return n;
  }

  // -------------------------------------------------------------------------
  // 刷新与交互
  // -------------------------------------------------------------------------

  private refresh(): void {
    const balance = this._host.getHonorBalance();
    if (this._balanceLabel) {
      this._balanceLabel.string = `可用荣誉 ${balance}`;
    }
    for (const row of this._rows) {
      const owned = this._host.getPurchases(row.cfg.id);
      const maxed = owned >= row.cfg.maxPurchases;
      const affordable = balance >= row.cfg.cost;
      const usable = !maxed && affordable;

      row.ownedLabel.string = `已购 ${owned}/${row.cfg.maxPurchases}`;
      row.costLabel.string = maxed ? '已满' : `${row.cfg.cost} 荣誉`;
      row.costLabel.color = hex(maxed ? COLOR.TEXT_DISABLED : (affordable ? COLOR.WARNING : COLOR.TEXT_DISABLED));
      row.nameLabel.color = hex(usable ? COLOR.TEXT_PRIMARY : COLOR.TEXT_SECONDARY);
      const bgColor = usable ? COLOR.SURFACE : COLOR.PANEL_BG;
      row.bg.color = hex(bgColor, ALPHA.SOLID);
      if (row.btn) row.btn.interactable = usable;
    }
  }

  /** 点击整行 = 购买（不可购时静默忽略，行本身已置灰） */
  private onRowClicked(evt: { currentTarget: Node | null }): void {
    const target = evt?.currentTarget;
    if (!target?.isValid) return;
    const row = this._rows.find(r => r.node === target);
    if (!row) return;
    const owned = this._host.getPurchases(row.cfg.id);
    if (owned >= row.cfg.maxPurchases) return;
    if (this._host.getHonorBalance() < row.cfg.cost) return;
    if (this._host.purchaseTalent(row.cfg.id)) {
      this.refresh();
    }
  }

  private onCloseClicked(): void {
    this.hide();
  }
}
