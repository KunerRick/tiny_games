import { _decorator, Component, Node, instantiate, Prefab, Button, Label, UITransform } from 'cc';
import { COLOR, FONT_BODY, applyFont, applyFontAndColor } from '../config/Theme';
import { EventConfig, ChoiceOption } from '../config/GameData';
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

  /** 该选项需要的金币（effects 里的 spend_gold）；无则 0 */
  private static goldCostOf(option: ChoiceOption): number {
    const spend = option.effects?.find(e => e.type === 'spend_gold');
    return spend ? (spend.params?.amount ?? 0) : 0;
  }

  /** 该选项是否依赖"有单位能学新技能"（技能位全满时这个选项交付不了任何东西） */
  private static needsSkillSlot(option: ChoiceOption): boolean {
    return !!option.effects?.some(e => e.type === 'learn_skill' || e.type === 'learn_rare_skill');
  }

  onLoad(): void {
    if (!this._showCalled) {
      this.node.active = false;
    }
  }

  /**
   * @param anyFreeSkillSlot 队伍里是否还有单位能学新技能（技能位未满）。
   *        为 false 时，含 learn_skill 的选项置灰 —— 否则玩家花钱选了却什么都拿不到。
   * @param luckPercent 随机事件的好结果概率加成（天赋「幸运儿」，%）。
   *        约定 `randomOutcomes[0]` 为"好结果"。
   */
  showEvent(event: EventConfig, onChoice: (index: number) => void, gold: number = 0, anyFreeSkillSlot: boolean = true, luckPercent: number = 0): void {
    // 置位必须先于 node.active = true：节点首次激活会同步触发 onLoad，
    // 若此时 _showCalled 仍为 false，onLoad 会立即把面板关掉，事件永远无法交互
    this._showCalled = true;
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
          const choice = event.choices[i];
          const btnNode = instantiate(this.choiceButtonPrefab);
          btnNode.setPosition(0, startY - i * (btnHeight + gap), 0);

          // 金币校验：选项效果含 spend_gold 且钱不够 → 置灰不可点
          // 交付校验：选项含 learn_skill 但全队技能位已满 → 也置灰。
          // 否则玩家付了钱却什么都拿不到（实测"花10金币买随机技能"扣了 10 金、技能数不变）。
          const cost = EventUI.goldCostOf(choice);
          const affordable = cost <= gold;
          const learnable = !EventUI.needsSkillSlot(choice) || anyFreeSkillSlot;
          const enabled = affordable && learnable;

          const label = btnNode.getComponentInChildren(Label);
          if (label) {
            const reason = !affordable
              ? '（金币不足）'
              : (!learnable ? '（技能位已满）' : '');
            label.string = reason ? `${choice.description}${reason}` : choice.description;
            applyFontAndColor(label, FONT_BODY, enabled ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED);
          }
          const btn = btnNode.getComponent(Button);
          if (btn) {
            btn.transition = Button.Transition.SCALE;
            btn.interactable = enabled;
            btnNode['_choiceIndex'] = i;
            btn.node.off(Button.EventType.CLICK, this.onChoiceClicked, this);
            btn.node.on(Button.EventType.CLICK, this.onChoiceClicked, this);
          }
          this.choiceContainer.addChild(btnNode);
        }
      } else if (event.type === 'random' && event.randomOutcomes) {
        // 天赋「幸运儿」：把"好结果"（约定 randomOutcomes[0]）的权重抬高 luck%
        const luck = Math.max(0, luckPercent);
        const weights = event.randomOutcomes.map((o, i) => i === 0 ? o.weight * (1 + luck / 100) : o.weight);
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        let roll = Math.random() * totalWeight;
        let selectedIndex = 0;
        for (let i = 0; i < event.randomOutcomes.length; i++) {
          roll -= weights[i];
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
        if (label) {
          label.string = '\u786E\u5B9A';
          applyFontAndColor(label, FONT_BODY, COLOR.TEXT_PRIMARY);
        }
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
