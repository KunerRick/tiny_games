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

  showUpgradeOptions(options: UpgradeOption[], onSelect: (index: number) => void): void {
    this.node.active = true;

    if (this.titleLabel) {
      this.titleLabel.string = '\u5347\u7EA7\u9009\u62E9';
    }

    if (this.cardContainer) {
      this.cardContainer.removeAllChildren();

      for (let i = 0; i < options.length; i++) {
        const card = instantiate(this.cardPrefab);
        card.name = `Card_${i}`;

        const labels = card.getComponentsInChildren(Label);
        if (labels.length >= 2) {
          labels[0].string = options[i].name;
          labels[1].string = options[i].description;
        }

        const btn = card.getComponent(Button);
        if (btn) {
          card['_upgradeIndex'] = i;
          card['_upgradeOnSelect'] = onSelect;
          btn.node.on(Button.EventType.CLICK, this.onUpgradeCardClicked, this);
        }

        this.cardContainer.addChild(card);
      }
    }
  }

  private onUpgradeCardClicked(btn: Button): void {
    const card = btn.node;
    const index = card['_upgradeIndex'] as number;
    const callback = card['_upgradeOnSelect'] as (index: number) => void;
    if (callback) {
      callback(index);
    }
    this.node.active = false;
  }

  onDestroy(): void {
    if (this.cardContainer) {
      for (const child of this.cardContainer.children) {
        const btn = child.getComponent(Button);
        if (btn) {
          btn.node.off(Button.EventType.CLICK, this.onUpgradeCardClicked, this);
        }
      }
    }
  }
}
