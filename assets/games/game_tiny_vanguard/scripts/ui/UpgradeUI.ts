import { _decorator, Component, Node, instantiate, Prefab, Button, Label } from 'cc';
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
      for (let i = 0; i < options.length; i++) {
        const card = instantiate(this.cardPrefab);
        card.name = `Card_${this._currentUnitIndex}_${i}`;

        const labels = card.getComponentsInChildren(Label);
        if (labels.length >= 2) {
          labels[0].string = options[i].name;
          labels[1].string = options[i].description;
        }

        const btn = card.getComponent(Button);
        if (btn) {
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
