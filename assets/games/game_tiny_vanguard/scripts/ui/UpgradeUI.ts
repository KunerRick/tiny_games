import { _decorator, Component, Node, instantiate, Prefab, Button, Label, UITransform, Sprite, SpriteFrame } from 'cc';
import {
  COLOR, CONTROL, FONT_BODY, FONT_CAPTION, FONT_DISPLAY, SPACE,
  applyButtonTheme, applyFontAndColor, hex,
} from '../config/Theme';
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
  // 分类色沿用 §3.1 语义色板：主色=主动技能、INFO=被动、SUCCESS=属性增益
  active: { badge: '\u6280\u80FD', color: COLOR.PRIMARY },
  passive: { badge: '\u88AB\u52A8', color: COLOR.INFO },
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
    // 按钮过渡色统一走令牌（P5），否则 hover/disabled 会是引擎默认灰
    applyButtonTheme(this.skipBtn?.getComponent(Button) ?? null, 'secondary');
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
    this.cardContainer.removeAllChildren();

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
    const halfH = h / 2;

    // 底板（prefab 根只有 Button，Sprite 需补；补前先判空避免重复渲染组件）
    // 贴图来源：CardPrefab 根节点没有 Sprite，其 spriteFrame 为空 —— 必须用
    // cardBgFrame（场景绑定）或已存在的 frame 兜底，否则整张卡不绘制。
    let bg = card.getComponent(Sprite);
    if (!bg) bg = card.addComponent(Sprite);
    const fallbackFrame = this.cardBgFrame ?? bg?.spriteFrame ?? null;
    if (bg) {
      // 赋值顺序固定为 spriteFrame → sizeMode → color → contentSize：
      // 先设 contentSize 再设 spriteFrame 时，sizeMode 仍是默认 TRIMMED，
      // 会把节点尺寸覆盖成贴图原始尺寸（本项目默认贴图是 2×2）。
      if (fallbackFrame) bg.spriteFrame = fallbackFrame;
      bg.sizeMode = Sprite.SizeMode.CUSTOM;
      bg.color = owned ? hex(COLOR.PRIMARY_DISABLED, 240) : hex(COLOR.SURFACE, 240);
    }
    const ui = card.getComponent(UITransform);
    if (ui) ui.setContentSize(w, h);

    // 顶部分类色条
    const bar = this.ensureChild(card, 'CategoryBar', ['cc.UITransform', 'cc.Sprite']);
    if (bar) {
      const barSp = bar.getComponent(Sprite);
      if (barSp) {
        if (fallbackFrame) barSp.spriteFrame = fallbackFrame;
        barSp.sizeMode = Sprite.SizeMode.CUSTOM;
        barSp.color = hex(style.color, owned ? 120 : 255);
      }
      const barUi = bar.getComponent(UITransform);
      if (barUi) barUi.setContentSize(w - SPACE.SM, 4);
      bar.setPosition(0, halfH - SPACE.SM / 2 - 2, 0);
    }

    // 图标
    const iconNode = this.ensureChild(card, 'IconLabel', ['cc.UITransform', 'cc.Label']);
    if (iconNode) {
      const iconLabel = iconNode.getComponent(Label);
      const iconUi = iconNode.getComponent(UITransform);
      if (iconUi) iconUi.setContentSize(w - SPACE.LG, 56);
      if (iconLabel) {
        iconLabel.string = option.icon ?? '\u2694\uFE0F';
        applyFontAndColor(iconLabel, FONT_DISPLAY, owned ? COLOR.TEXT_DISABLED : COLOR.TEXT_PRIMARY);
        iconLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        iconLabel.verticalAlign = Label.VerticalAlign.CENTER;
        iconLabel.overflow = Label.Overflow.CLAMP;   // 固定高度，避免自适应后压到名字
      }
      iconNode.setPosition(0, 80, 0);
    }

    // 名字（按节点名查找，不依赖 getComponentsInChildren 的返回顺序）
    const nameLabel = card.getChildByName('cardNameLabel')?.getComponent(Label);
    if (nameLabel) {
      nameLabel.string = option.name;
      applyFontAndColor(nameLabel, FONT_BODY, owned ? COLOR.TEXT_DISABLED : COLOR.TEXT_PRIMARY);
      nameLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      nameLabel.overflow = Label.Overflow.CLAMP;
      const nameUi = nameLabel.node.getComponent(UITransform);
      if (nameUi) nameUi.setContentSize(w - SPACE.LG, FONT_BODY.lineHeight);
      nameLabel.node.setPosition(0, 18, 0);
    }

    // 类型徽章：底板 + 子节点文字（同节点不可挂两个渲染组件）
    const badge = this.ensureChild(card, 'TypeBadge', ['cc.UITransform', 'cc.Sprite']);
    if (badge) {
      const badgeSp = badge.getComponent(Sprite);
      if (badgeSp) {
        if (fallbackFrame) badgeSp.spriteFrame = fallbackFrame;
        badgeSp.sizeMode = Sprite.SizeMode.CUSTOM;
        badgeSp.color = hex(style.color, owned ? 90 : 230);
      }
      const badgeUi = badge.getComponent(UITransform);
      if (badgeUi) badgeUi.setContentSize(96, 26);
      badge.setPosition(0, -14, 0);

      const badgeText = this.ensureChild(badge, 'TypeBadgeText', ['cc.UITransform', 'cc.Label']);
      if (badgeText) {
        const bt = badgeText.getComponent(Label);
        const btUi = badgeText.getComponent(UITransform);
        if (btUi) btUi.setContentSize(96, 22);
        if (bt) {
          bt.string = owned ? `${style.badge}\u00B7\u5DF2\u5B66` : style.badge;
          applyFontAndColor(bt, FONT_CAPTION, COLOR.TEXT_PRIMARY);
          bt.horizontalAlign = Label.HorizontalAlign.CENTER;
          bt.verticalAlign = Label.VerticalAlign.CENTER;
          bt.overflow = Label.Overflow.CLAMP;   // 徽章是固定尺寸块，文字不得撑高
        }
        badgeText.setPosition(0, 0, 0);
      }
    }

    // 描述（限 2 行）
    const descLabel = card.getChildByName('cardDescLabel')?.getComponent(Label);
    if (descLabel) {
      descLabel.string = option.description;
      applyFontAndColor(descLabel, FONT_CAPTION, owned ? COLOR.TEXT_DISABLED : COLOR.TEXT_SECONDARY);
      descLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      descLabel.verticalAlign = Label.VerticalAlign.CENTER;
      descLabel.overflow = Label.Overflow.CLAMP;
      descLabel.enableWrapText = true;
      const descUi = descLabel.node.getComponent(UITransform);
      if (descUi) descUi.setContentSize(w - SPACE.LG, FONT_CAPTION.lineHeight * 2);
      descLabel.node.setPosition(0, -64, 0);
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

  /** 取子节点，不存在则创建（保持多次刷新幂等） */
  private ensureChild(parent: Node, name: string, components: string[]): Node | null {
    const existing = parent.getChildByName(name);
    if (existing?.isValid) return existing;
    const node = new Node(name);
    // 先按声明顺序补组件；Sprite/Label 会自带 UITransform，避免重复添加
    for (const type of components) {
      if (type === 'cc.UITransform') {
        if (!node.getComponent(UITransform)) node.addComponent(UITransform);
      } else if (type === 'cc.Label') {
        if (!node.getComponent(Label)) node.addComponent(Label);
      } else if (type === 'cc.Sprite') {
        if (!node.getComponent(Sprite)) node.addComponent(Sprite);
      }
    }
    if (!node.getComponent(UITransform)) node.addComponent(UITransform);
    parent.addChild(node);
    return node;
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
