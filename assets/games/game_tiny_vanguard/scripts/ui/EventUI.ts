import { _decorator, Component, Node, instantiate, Prefab, Button, Label, UITransform, Sprite } from 'cc';
import { COLOR, FONT_BODY, FONT_TITLE, applyFont, applyFontAndColor } from '../config/Theme';
import { drawFrame, ensureScaleButton, stylePanel } from './GameUIKit';
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

    // 与商店/圣泉统一的外框语言（事件用紫色系区分）
    // 面板尺寸 / 子节点位置都由内容推导：场景里的 EventUI 是固定 350×300，而标题与
    // 描述按 300/150 的偏移摆放 —— 内容直接跑到面板外（实测标题悬浮、描述压在边框上）。
    // 这里按内容重算面板高度、把标题/描述/选项按"上→下"顺排，再 stylePanel 描边。
    const W = 560;
    const PAD = 28;
    const TITLE_H = 46;
    const DESC_H = 56;
    const BTN_H = 50;
    const BTN_GAP = 10;
    const isChoice = event.type === 'choice' && !!event.choices;
    const count = isChoice ? event.choices!.length : (event.type === 'random' ? 1 : 0);
    const choicesH = count > 0 ? count * BTN_H + (count - 1) * BTN_GAP : 0;
    const H = PAD + TITLE_H + 8 + DESC_H + 24 + (choicesH > 0 ? choicesH + 24 : 0) + PAD;

    const panelUi = this.node.getComponent(UITransform);
    if (panelUi) panelUi.setContentSize(W, H);

    const titleY = H / 2 - PAD - TITLE_H / 2;
    if (this.eventTitleLabel) {
      this.eventTitleLabel.string = event.name;
      applyFontAndColor(this.eventTitleLabel, FONT_TITLE, COLOR.PASSIVE);
      this.eventTitleLabel.overflow = Label.Overflow.SHRINK;
      this.eventTitleLabel.node.setPosition(0, titleY, 0);
    }
    const descY = titleY - TITLE_H / 2 - 8 - DESC_H / 2;
    if (this.eventDescLabel) {
      this.eventDescLabel.string = event.description;
      applyFontAndColor(this.eventDescLabel, FONT_BODY, COLOR.TEXT_SECONDARY);
      this.eventDescLabel.overflow = Label.Overflow.CLAMP;
      this.eventDescLabel.enableWrapText = true;
      const descUi = this.eventDescLabel.node.getComponent(UITransform);
      if (descUi) descUi.setContentSize(W - PAD * 2, DESC_H);
      this.eventDescLabel.node.setPosition(0, descY, 0);
    }
    if (this.choiceContainer && choicesH > 0) {
      this.choiceContainer.setPosition(0, descY - DESC_H / 2 - 24 - choicesH / 2, 0);
    }
    stylePanel(this.node, COLOR.PASSIVE);

    if (this.choiceContainer) {
      this.choiceContainer.destroyAllChildren();

      if (event.type === 'choice' && event.choices) {
        const totalHeight = count * BTN_H + (count - 1) * BTN_GAP;
        const startY = totalHeight / 2 - BTN_H / 2;

        for (let i = 0; i < event.choices.length; i++) {
          const choice = event.choices[i];
          const btnNode = instantiate(this.choiceButtonPrefab);
          btnNode.setPosition(0, startY - i * (BTN_H + BTN_GAP), 0);
          this.applyChoiceSize(btnNode, W - PAD * 2, BTN_H);

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
          this.styleChoice(btnNode, enabled);
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
        this.applyChoiceSize(confirmBtn, W - PAD * 2, BTN_H);
        const label = confirmBtn.getComponentInChildren(Label);
        if (label) {
          label.string = '\u786E\u5B9A';
          applyFontAndColor(label, FONT_BODY, COLOR.TEXT_PRIMARY);
        }
        this.styleChoice(confirmBtn, true);
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

  /** 选项按钮统一尺寸（预制体是 250 宽，长文案会被裁）：按钮与内部 Label 一起加宽 */
  private applyChoiceSize(node: Node, w: number, h: number): void {
    if (!node?.isValid) return;
    const ui = node.getComponent(UITransform);
    if (ui) ui.setContentSize(w, h);
    const label = node.getComponentInChildren(Label);
    if (!label?.node?.isValid) return;
    const lui = label.node.getComponent(UITransform);
    if (lui) lui.setContentSize(w - 24, h);
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
  }

  /** 选项按钮统一外观：圆角底板 + 描边 + 顶部微光；保留预制体原有尺寸 */
  private styleChoice(node: Node, enabled: boolean): void {
    if (!node?.isValid) return;
    const sp = node.getComponent(Sprite);
    if (sp) sp.enabled = false;                       // 用矢量底板替代预制体的纯色贴图
    const ui = node.getComponent(UITransform);
    const w = ui?.width ?? 0;
    const h = ui?.height ?? 0;
    if (w > 2 && h > 2) {
      drawFrame(node, {
        width: w, height: h, radius: 12,
        fill: enabled ? COLOR.SURFACE : COLOR.SLOT_EMPTY_BG,
        fillAlpha: 250,
        border: enabled ? COLOR.PASSIVE : COLOR.PANEL_BORDER,
        borderAlpha: enabled ? 190 : 130,
        borderWidth: 2,
        // 与卡片同款顶条：可选项贴一条紫色，一眼区分"能点的那行"
        accent: enabled ? COLOR.PASSIVE : undefined,
        accentAlpha: 190,
        sheen: enabled,
      });
    }
    ensureScaleButton(node);
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
