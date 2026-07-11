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

  onLoad(): void {
    if (!this._showCalled) {
      this.node.active = false;
    }
  }

  showEvent(event: EventConfig, onChoice: (index: number) => void): void {
    this.node.active = true;

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
            const index = i;
            btn.node.on(Button.EventType.CLICK, () => {
              onChoice(index);
              this.node.active = false;
            }, this);
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
          btn.node.on(Button.EventType.CLICK, () => {
            onChoice(selectedIndex);
            this.node.active = false;
          }, this);
        }
        this.choiceContainer.addChild(confirmBtn);
      }
    }
  }

  hide(): void {
    this.node.active = false;
  }

  onDestroy(): void {
    if (this.choiceContainer) {
      this.choiceContainer.removeAllChildren();
    }
  }
}
