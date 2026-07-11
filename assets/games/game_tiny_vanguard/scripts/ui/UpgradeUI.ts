import { _decorator, Component, Node, instantiate, Prefab, Button, Label, UITransform, Sprite, Color } from 'cc';
const { ccclass, property } = _decorator;

export interface UpgradeOption {
  name: string;
  description: string;
  type: 'skill' | 'buff';
  skillId?: string;
  buffType?: string;
  buffAmount?: number;
}

@ccclass('UpgradeUI')
export class UpgradeUI extends Component {
  @property({ type: Node, tooltip: '卡片容器' })
  cardContainer: Node = null;

  @property({ type: Prefab, tooltip: '升级卡片预制体' })
  cardPrefab: Prefab = null;

  @property({ type: Label, tooltip: '标题' })
  titleLabel: Label = null;

  private _showCalled: boolean = false;
  private _currentUnitIndex: number = 0;
  private _allOptions: UpgradeOption[][] = [];
  private _unitNames: string[] = [];
  private _onSelect: ((unitIndex: number, optionIndex: number) => void) | null = null;
  private _onComplete: (() => void) | null = null;

  onLoad(): void {
    if (!this._showCalled) {
      this.node.active = false;
    }
  }

  show(): void {
    this._showCalled = true;
    this.node.active = true;
  }

  hide(): void {
    this.node.active = false;
  }

  showUpgradeOptions(
    allOptions: UpgradeOption[][],
    unitNames: string[],
    onSelect: (unitIndex: number, optionIndex: number) => void,
    onComplete: () => void
  ): void {
    this._currentUnitIndex = 0;
    this._allOptions = allOptions;
    this._unitNames = unitNames;
    this._onSelect = onSelect;
    this._onComplete = onComplete;
    this.node.active = true;
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
      this.titleLabel.string = `为${unitName}选技能`;
    }

    if (this.cardContainer) {
      this.cardContainer.removeAllChildren();

      const options = this._allOptions[this._currentUnitIndex];
      const count = options.length;
      const cardWidth = 210;
      const cardHeight = 130;
      const gap = 15;
      const totalWidth = count * cardWidth + (count - 1) * gap;
      const startX = -totalWidth / 2 + cardWidth / 2;

      for (let i = 0; i < count; i++) {
        const card = instantiate(this.cardPrefab);
        card.name = `Card_${this._currentUnitIndex}_${i}`;
        card.setPosition(startX + i * (cardWidth + gap), 0, 0);

        // 调整卡片尺寸
        const cardTransform = card.getComponent(UITransform);
        if (cardTransform) {
          cardTransform.setContentSize(cardWidth, cardHeight);
        }

        // 添加半透明背景
        let bg = card.getComponent(Sprite);
        if (!bg) {
          bg = card.addComponent(Sprite);
          bg.sizeMode = Sprite.SizeMode.CUSTOM;
        }
        // 奇数张用稍亮的颜色做视觉区分
        const brightness = 45 + (i % 2 === 0 ? 0 : 10);
        bg.color = new Color(brightness, brightness + 5, 70, 230);

        const labels = card.getComponentsInChildren(Label);
        if (labels.length >= 2) {
          // 名称（卡片上半部分）
          const nameLabel = labels[0].node;
          nameLabel.setPosition(0, 30, 0);
          const nameTransform = nameLabel.getComponent(UITransform);
          if (nameTransform) nameTransform.setContentSize(cardWidth - 20, 35);
          labels[0].fontSize = 20;
          labels[0].string = options[i].name;

          // 描述（卡片下半部分）
          const descLabel = labels[1].node;
          descLabel.setPosition(0, -25, 0);
          const descTransform = descLabel.getComponent(UITransform);
          if (descTransform) descTransform.setContentSize(cardWidth - 20, 35);
          labels[1].fontSize = 15;
          labels[1].color = new Color(180, 190, 210);
          labels[1].string = options[i].description;
        }

        const btn = card.getComponent(Button);
        if (btn) {
          // 将 Button 过渡从 SPRITE（无 sprite 会显示白色方块）改为 SCALE
          btn.transition = Button.Transition.SCALE;
          card['_upgradeOptionIndex'] = i;
          btn.node.on(Button.EventType.CLICK, this.onUpgradeCardClicked, this);
        }

        this.cardContainer.addChild(card);
      }
    }
  }

  private onUpgradeCardClicked(btn: Button): void {
    const card = btn.node;
    const optionIndex = card['_upgradeOptionIndex'] as number;
    const unitIndex = this._currentUnitIndex;

    this._onSelect?.(unitIndex, optionIndex);

    this._currentUnitIndex++;
    this.showCurrentUnitOptions();
  }

  onDestroy(): void {
    if (this.cardContainer) {
      const children = this.cardContainer.children.slice();
      for (const child of children) {
        if (child?.isValid) {
          const btn = child.getComponent(Button);
          if (btn?.node?.isValid) {
            btn.node.off(Button.EventType.CLICK, this.onUpgradeCardClicked, this);
          }
        }
      }
    }
  }
}
