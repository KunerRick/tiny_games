import { _decorator, Component, Node, instantiate, Prefab, Button, Label, UITransform, Graphics, Sprite, SpriteFrame } from 'cc';
import {
  COLOR, CONTROL, FONT_BODY, FONT_CAPTION, FONT_DISPLAY, FONT_TITLE, SPACE,
  applyButtonTheme, applyFontAndColor, hex, stripVariationSelectors,
} from '../config/Theme';
import { drawFrame, ensureChild, makeChip, stylePanel } from './GameUIKit';
const { ccclass, property } = _decorator;

export interface UpgradeOption {
  name: string;
  description: string;
  type: 'skill' | 'buff';
  skillId?: string;
  buffType?: string;
  buffAmount?: number;
  /** 技能子类（active/passive），用于卡片徽章文案与分类色 */
  skillKind?: 'active' | 'passive';
  /** 卡片图标（emoji） */
  icon?: string;
  /** 该单位已学会 → 置灰不可选（与卡池过滤互为兜底） */
  owned?: boolean;
}

/** 卡片分类：决定徽章文案与顶条颜色 */
type OptionCategory = 'active' | 'passive' | 'attribute';

const CATEGORY_STYLE: Record<OptionCategory, { badge: string; color: string }> = {
  // 分类色沿用 §3.1 语义色板 + 方案 §4 问题 4 的映射：主色=主动技能、紫=被动、SUCCESS=属性增益。
  // 被动原先用 INFO 青，与主动的 PRIMARY 蓝色相相邻、一眼分不出类别，故改用 COLOR.PASSIVE。
  active: { badge: '\u6280\u80FD', color: COLOR.PRIMARY },
  passive: { badge: '\u88AB\u52A8', color: COLOR.PASSIVE },
  attribute: { badge: '\u5C5E\u6027', color: COLOR.SUCCESS },
};

@ccclass('UpgradeUI')
export class UpgradeUI extends Component {
  @property({ type: Node, tooltip: '卡片容器' })
  cardContainer: Node = null;

  @property({ type: Prefab, tooltip: '升级卡片预制体' })
  cardPrefab: Prefab = null;

  @property({ type: SpriteFrame, tooltip: '卡片底板贴图（纯色九宫格；CardPrefab 根节点无 Sprite）' })
  cardBgFrame: SpriteFrame = null;

  @property({ type: Label, tooltip: '标题' })
  titleLabel: Label = null;

  @property({ type: Label, tooltip: '进度文字（第 N/M 位）' })
  progressLabel: Label = null;

  @property({ type: Node, tooltip: '进度条填充节点（anchorX=0，按比例缩放）' })
  progressBarFill: Node = null;

  @property({ type: Node, tooltip: '跳过本次升级按钮' })
  skipBtn: Node = null;

  private _showCalled: boolean = false;
  private _eventsBound: boolean = false;
  private _currentUnitIndex: number = 0;
  private _allOptions: UpgradeOption[][] = [];
  private _unitNames: string[] = [];
  private _onSelect: ((unitIndex: number, optionIndex: number) => void) | null = null;
  private _onComplete: (() => void) | null = null;
  private _onSkip: ((unitIndex: number) => void) | null = null;

  onLoad(): void {
    if (!this._showCalled) {
      this.node.active = false;
    }
  }

  show(): void {
    this._showCalled = true;
    this.node.active = true;
    this.ensureEventsBound();
    this.layoutPanel();
    // 按钮过渡色统一走令牌（P5），否则 hover/disabled 会是引擎默认灰
    applyButtonTheme(this.skipBtn?.getComponent(Button) ?? null, 'secondary');
  }

  /** 进度条底槽在场景里只是普通节点（没有对应的 @property），按名字取 */
  private get progressBarBg(): Node | null {
    return this.node?.getChildByName('ProgressBarBg') ?? null;
  }

  /**
   * 面板纵向重排 + 按内容收紧高度。
   *
   * 场景里这七个节点的 Y 是手摆的：标题 336 / 卡片 40 / 跳过 -290，面板高 760。
   * 卡片高 260，于是卡片下沿 → 跳过按钮之间空出 156px（≈85 CSS px）的大白块，
   * 面板下半截几乎是空的。这里改成按「标题 → 进度 → 卡片 → 跳过」逐行下排，
   * 再把节点高度收成内容高度 + 上下留白；`stylePanel` 读的是当前尺寸，必须
   * 在改完尺寸**之后**再调一次，否则外框还停在 760。
   */
  private layoutPanel(): void {
    const panelUi = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);

    const PAD_TOP = 40;
    const PAD_BOTTOM = 30;
    const GAP_TITLE = 12;
    const GAP_BAR = 8;
    const GAP_CARDS = 26;
    const GAP_SKIP = 30;

    const titleH = FONT_TITLE.lineHeight;
    const progH = FONT_CAPTION.lineHeight;
    const barH = this.progressBarBg?.getComponent(UITransform)?.height ?? 8;
    const cardH = CONTROL.CARD_HEIGHT;
    const skipH = this.skipBtn?.getComponent(UITransform)?.height ?? CONTROL.BTN_HEIGHT;
    const total =
      titleH + GAP_TITLE + progH + GAP_BAR + barH + GAP_CARDS + cardH + GAP_SKIP + skipH;
    const height = Math.max(360, total + PAD_TOP + PAD_BOTTOM);
    const top = height / 2;

    // 以「距顶边距离」累加，最后换算成以面板中心为原点的 Y
    let cursor = PAD_TOP;
    const titleY = top - (cursor + titleH / 2);
    cursor += titleH + GAP_TITLE;
    const progY = top - (cursor + progH / 2);
    cursor += progH + GAP_BAR;
    const barY = top - (cursor + barH / 2);
    cursor += barH + GAP_CARDS;
    const cardsY = top - (cursor + cardH / 2);
    cursor += cardH + GAP_SKIP;
    const skipY = top - (cursor + skipH / 2);

    if (this.titleLabel) this.titleLabel.node.setPosition(0, titleY, 0);
    if (this.progressLabel) this.progressLabel.node.setPosition(0, progY, 0);
    if (this.progressBarBg) this.progressBarBg.setPosition(0, barY, 0);
    if (this.progressBarFill) this.progressBarFill.setPosition(-this.getProgressWidth() / 2, barY, 0);
    if (this.cardContainer) {
      this.cardContainer.setPosition(0, cardsY, 0);
      const cardsUi = this.cardContainer.getComponent(UITransform);
      if (cardsUi) cardsUi.setContentSize(cardsUi.width, cardH);
    }
    if (this.skipBtn) this.skipBtn.setPosition(0, skipY, 0);

    panelUi.setContentSize(Math.max(panelUi.width, 560), height);
    stylePanel(this.node, COLOR.PRIMARY);
  }

  private getProgressWidth(): number {
    return this.progressBarBg?.getComponent(UITransform)?.width ?? 592;
  }

  hide(): void {
    this.node.active = false;
    if (this._eventsBound) {
      this._eventsBound = false;
      this.unbindEvents();
    }
  }

  /** 面板类约定：事件在 show() 中绑定（未激活节点 onLoad 不执行） */
  private ensureEventsBound(): void {
    if (this._eventsBound) return;
    this._eventsBound = true;
    this.bindEvents();
  }

  private bindEvents(): void {
    if (this.skipBtn) {
      this.skipBtn.on(Node.EventType.TOUCH_END, this.onSkipClicked, this);
    }
  }

  private unbindEvents(): void {
    if (this.skipBtn) {
      this.skipBtn.off(Node.EventType.TOUCH_END, this.onSkipClicked, this);
    }
  }

  showUpgradeOptions(
    allOptions: UpgradeOption[][],
    unitNames: string[],
    onSelect: (unitIndex: number, optionIndex: number) => void,
    onComplete: () => void,
    onSkip?: (unitIndex: number) => void
  ): void {
    this._currentUnitIndex = 0;
    this._allOptions = allOptions;
    this._unitNames = unitNames;
    this._onSelect = onSelect;
    this._onComplete = onComplete;
    this._onSkip = onSkip ?? null;
    this._showCalled = true;
    this.node.active = true;
    this.ensureEventsBound();
    this.layoutPanel();
    this.showCurrentUnitOptions();
  }

  private showCurrentUnitOptions(): void {
    if (this._currentUnitIndex >= this._allOptions.length) {
      this.node.active = false;
      this._onComplete?.();
      return;
    }

    const unitName = this._unitNames[this._currentUnitIndex] || `Unit ${this._currentUnitIndex + 1}`;
    if (this.titleLabel) {
      this.titleLabel.string = `\u4E3A ${unitName} \u9009\u5F3A\u5316`;
      applyFontAndColor(this.titleLabel, FONT_TITLE, COLOR.PRIMARY);
    }
    this.updateProgress();
    this.rebuildCards();
  }

  /** 进度：标签显示当前位次，进度条按位次比例填充 */
  private updateProgress(): void {
    const total = this._allOptions.length;
    const index = this._currentUnitIndex;
    if (this.progressLabel) {
      this.progressLabel.string = `\u7B2C ${index + 1}/${total} \u4F4D`;
    }
    if (this.progressBarFill) {
      const ratio = total > 0 ? (index + 1) / total : 0;
      this.progressBarFill.setScale(ratio, 1, 1);
    }
  }

  private rebuildCards(): void {
    if (!this.cardContainer) return;
    this.cardContainer.destroyAllChildren();

    const options = this._allOptions[this._currentUnitIndex] ?? [];
    const count = options.length;
    if (count === 0) return;

    const cardWidth = CONTROL.CARD_WIDTH;
    const gap = CONTROL.CARD_GAP;
    const totalWidth = count * cardWidth + (count - 1) * gap;
    const startX = -totalWidth / 2 + cardWidth / 2;

    for (let i = 0; i < count; i++) {
      if (!this.cardPrefab) break;
      const card = instantiate(this.cardPrefab);
      if (!card?.isValid) continue;
      card.name = `Card_${this._currentUnitIndex}_${i}`;
      card.setScale(1, 1, 1);
      card.setPosition(startX + i * (cardWidth + gap), 0, 0);
      this.decorateCard(card, options[i]);
      this.cardContainer.addChild(card);
    }
  }

  private categoryOf(option: UpgradeOption): OptionCategory {
    if (option.type === 'buff') return 'attribute';
    return option.skillKind === 'passive' ? 'passive' : 'active';
  }

  /**
   * 运行时构建卡片视觉。
   * 不依赖 prefab 内的组件属性（MCP 的 prefab_update_prefab / create_prefab
   * 都无法可靠地写入属性值），只借 prefab 的节点结构（Button + 两个 Label），
   * 其余尺寸/颜色/图标/徽章一律在此设置，保证三张卡视觉一致。
   */
  private decorateCard(card: Node, option: UpgradeOption): void {
    const category = this.categoryOf(option);
    const style = CATEGORY_STYLE[category];
    const owned = option.owned === true;

    const w = CONTROL.CARD_WIDTH;
    const h = CONTROL.CARD_HEIGHT;

    const ui = card.getComponent(UITransform);
    if (ui) ui.setContentSize(w, h);

    // 预制体的纯色贴图让位给矢量底板（同节点渲染组件互斥，用子 Graphics 叠加）
    const oldBg = card.getComponent(Sprite);
    if (oldBg) oldBg.enabled = false;

    // 底板：圆角 + 分类色描边 + 顶条（与职业卡/商店卡同款）
    drawFrame(card, {
      width: w, height: h, radius: 16,
      fill: owned ? COLOR.SLOT_EMPTY_BG : COLOR.SURFACE,
      fillAlpha: 250,
      border: owned ? COLOR.PANEL_BORDER : style.color,
      borderAlpha: owned ? 120 : 190,
      borderWidth: 2,
      accent: style.color,
      accentAlpha: owned ? 110 : 255,
      sheen: !owned,
    });

    // 图标圆盘（画在本卡 frame 之上、图标 Label 之下）
    const disc = ensureChild(card, 'IconDiscGfx', 62, 62);
    disc.setPosition(0, 84, 0);
    disc.setSiblingIndex(0);
    const dg = disc.getComponent(Graphics) ?? disc.addComponent(Graphics);
    dg.clear();
    dg.fillColor = hex(style.color, owned ? 24 : 44);
    dg.circle(0, 0, 27);
    dg.fill();
    dg.strokeColor = hex(style.color, owned ? 80 : 205);
    dg.lineWidth = 2;
    dg.circle(0, 0, 27);
    dg.stroke();

    // 图标
    const iconNode = card.getChildByName('IconLabel') ?? ensureChild(card, 'IconLabel', w - SPACE.LG, 56);
    const iconUi = iconNode.getComponent(UITransform) ?? iconNode.addComponent(UITransform);
    iconUi.setContentSize(w - SPACE.LG, 56);
    iconNode.setPosition(0, 84, 0);
    const iconLabel = iconNode.getComponent(Label) ?? iconNode.addComponent(Label);
    iconLabel.string = stripVariationSelectors(option.icon ?? '\u2694');
    applyFontAndColor(iconLabel, FONT_DISPLAY, owned ? COLOR.TEXT_DISABLED : COLOR.TEXT_PRIMARY);
    iconLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    iconLabel.verticalAlign = Label.VerticalAlign.CENTER;
    iconLabel.overflow = Label.Overflow.CLAMP;

    // 名字
    const nameLabel = card.getChildByName('cardNameLabel')?.getComponent(Label);
    if (nameLabel) {
      nameLabel.string = option.name;
      applyFontAndColor(nameLabel, FONT_BODY, owned ? COLOR.TEXT_DISABLED : COLOR.TEXT_PRIMARY);
      nameLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      nameLabel.overflow = Label.Overflow.CLAMP;
      const nameUi = nameLabel.node.getComponent(UITransform);
      if (nameUi) nameUi.setContentSize(w - SPACE.LG, FONT_BODY.lineHeight);
      nameLabel.node.setPosition(0, 24, 0);
    }

    // 类型徽章（圆角胶囊）
    const badgeText = owned ? `${style.badge}\u00B7\u5DF2\u5B66` : style.badge;
    makeChip(card, 'TypeBadge', badgeText, style.color, 0, -16, 104, 26);

    // 描述（最多 3 行）
    // 之前只给 2 行（44px）：卡宽 180 减左右留白后一行只放得下 ~9 个汉字，
    // 「对 3×3 范围造成 12 点火焰伤害，并附加燃烧」需要 3 行，第 3 行被 CLAMP 裁掉
    // （实测描述末尾「附加燃烧」直接没了）。3 行 66px 仍能落在卡内（下沿 -130）。
    const descLabel = card.getChildByName('cardDescLabel')?.getComponent(Label);
    if (descLabel) {
      descLabel.string = option.description;
      applyFontAndColor(descLabel, FONT_CAPTION, owned ? COLOR.TEXT_DISABLED : COLOR.TEXT_SECONDARY);
      descLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      descLabel.verticalAlign = Label.VerticalAlign.CENTER;
      descLabel.overflow = Label.Overflow.CLAMP;
      descLabel.enableWrapText = true;
      const descUi = descLabel.node.getComponent(UITransform);
      if (descUi) descUi.setContentSize(w - SPACE.LG, FONT_CAPTION.lineHeight * 3);
      descLabel.node.setPosition(0, -70, 0);
    }

    // 交互：已学不可点
    const btn = card.getComponent(Button);
    if (btn) {
      btn.transition = Button.Transition.SCALE;
      btn.interactable = !owned;
      card['_upgradeOptionIndex'] = this.indexOfOption(card);
      btn.node.off(Button.EventType.CLICK, this.onUpgradeCardClicked, this);
      btn.node.on(Button.EventType.CLICK, this.onUpgradeCardClicked, this);
    }
  }

  /** 由卡片名 Card_<unit>_<index> 反解选项下标 */
  private indexOfOption(card: Node): number {
    const parts = card.name.split('_');
    const idx = Number(parts[parts.length - 1]);
    return Number.isFinite(idx) ? idx : 0;
  }

  private onUpgradeCardClicked(btn: Button): void {
    const card = btn.node;
    const optionIndex = card['_upgradeOptionIndex'] as number;
    const unitIndex = this._currentUnitIndex;

    this._onSelect?.(unitIndex, optionIndex);

    this._currentUnitIndex++;
    this.showCurrentUnitOptions();
  }

  /** 跳过当前单位的升级，继续下一位 */
  private onSkipClicked(): void {
    const unitIndex = this._currentUnitIndex;
    this._onSkip?.(unitIndex);
    this._currentUnitIndex++;
    this.showCurrentUnitOptions();
  }

  onDestroy(): void {
    // 子节点随本节点销毁自动解绑事件；按规范不访问 @property(Node)
    this._onSelect = null;
    this._onComplete = null;
    this._onSkip = null;
    this._allOptions = [];
    this._unitNames = [];
  }
}
