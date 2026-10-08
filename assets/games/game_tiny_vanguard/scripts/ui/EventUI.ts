import { _decorator, Component, Node, instantiate, Prefab, Button, Label, UITransform } from 'cc';
import { EventConfig } from '../config/GameData';
const { ccclass, property } = _decorator;

@ccclass('EventUI')
export class EventUI extends Component {
  @property({ type: Label, tooltip: '事件标题' })
  eventTitleLabel: Label = null;

  @property({ type: Label, tooltip: '事件描述' })
  eventDescLabel: Label = null;

  @property({ type: Prefab, tooltip: '选项按钮预制体' })
  choiceButtonPrefab: Prefab = null;

  @property({ type: Node, tooltip: '选项容器' })
  choiceContainer: Node = null;

  private _showCalled: boolean = false;
  private _onChoice: ((index: number) => void) | null = null;

  onLoad(): void {
    if (!this._showCalled) {
      this.node.active = false;
    }
  }

  showEvent(event: EventConfig, onChoice: (index: number) => void): void {
    this.node.active = true;
    this._onChoice = onChoice;

    if (this.eventTitleLabel) {
      this.eventTitleLabel.string = event.name;
    }
    if (this.eventDescLabel) {
      this.eventDescLabel.string = event.description;
    }

    if (this.choiceContainer) {
      this.choiceContainer.removeAllChildren();

      if (event.type === 'choice' && event.choices) {
        const btnHeight = 50;
        const gap = 10;
        const count = event.choices.length;
        const totalHeight = count * btnHeight + (count - 1) * gap;
        const startY = totalHeight / 2 - btnHeight / 2;

        for (let i = 0; i < event.choices.length; i++) {
          const btnNode = instantiate(this.choiceButtonPrefab);
          btnNode.setPosition(0, startY - i * (btnHeight + gap), 0);
          const label = btnNode.getComponentInChildren(Label);
          if (label) {
            label.string = event.choices[i].description;
          }
          const btn = btnNode.getComponent(Button);
          if (btn) {
            btn.transition = Button.Transition.SCALE;
            btnNode['_choiceIndex'] = i;
            btn.node.on(Button.EventType.CLICK, this.onChoiceClicked, this);
          }
          this.choiceContainer.addChild(btnNode);
        }
      } else if (event.type === 'random' && event.randomOutcomes) {
        const totalWeight = event.randomOutcomes.reduce((sum, o) => sum + o.weight, 0);
        let roll = Math.random() * totalWeight;
        let selectedIndex = 0;
        for (let i = 0; i < event.randomOutcomes.length; i++) {
          roll -= event.randomOutcomes[i].weight;
          if (roll <= 0) {
            selectedIndex = i;
            break;
          }
        }

        const outcome = event.randomOutcomes[selectedIndex];
        if (this.eventDescLabel) {
          this.eventDescLabel.string = outcome.description;
        }

        const confirmBtn = instantiate(this.choiceButtonPrefab);
        confirmBtn.setPosition(0, 0, 0);
        const label = confirmBtn.getComponentInChildren(Label);
        if (label) label.string = '\u786E\u5B9A';
        const btn = confirmBtn.getComponent(Button);
        if (btn) {
          btn.transition = Button.Transition.SCALE;
          confirmBtn['_choiceIndex'] = selectedIndex;
          btn.node.on(Button.EventType.CLICK, this.onChoiceClicked, this);
        }
        this.choiceContainer.addChild(confirmBtn);
      }
    }
  }

  // 命名事件方法（禁止匿名 lambda，便于解绑）
  private onChoiceClicked(btn: Button): void {
    if (!this._onChoice) return;
    const idx = btn?.node ? (btn.node['_choiceIndex'] as number) : undefined;
    if (idx === undefined || idx === null) return;
    const callback = this._onChoice;
    this.node.active = false;
    callback(idx);
  }

  hide(): void {
    this.node.active = false;
    this._onChoice = null;
  }

  onDestroy(): void {
    // 子节点随本节点销毁自动解绑事件；按规范不访问 @property(Node)
    this._onChoice = null;
  }
}
