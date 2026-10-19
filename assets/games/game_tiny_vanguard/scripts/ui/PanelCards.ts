import { _decorator, Component, Node, Label, Sprite, SpriteFrame, UITransform, Button } from 'cc';
import {
  COLOR, FONT_BODY, FONT_CAPTION, FONT_TINY, FONT_TITLE, SPACE,
  applyButtonTheme, applyFontAndColor, hex, stripVariationSelectors,
} from '../config/Theme';
const { ccclass } = _decorator;

/**
 * 商店 / 圣泉这类"列表型面板"的运行时卡片渲染器。
 *
 * 为什么不给这两个面板各写一个 Component：卡片内容由数据驱动、每次打开都要重画，
 * 需要的只是"往容器里塞几张卡"，没必要为此新增场景组件与 @property 绑定
 * （绑定又要走 MCP，见 AGENTS 教训 B/C）。这里只导出纯函数 + 一个承载点击的小组件，
 * 面板本身仍由 `TinyVanguardMain` 持有。
 *
 * 所有卡片节点都是**运行时创建**的，因此必须自带 `spriteFrame`（借场景里已有的纯色贴图），
 * 否则不绘制；赋值顺序固定 spriteFrame → sizeMode → color → contentSize
 * （顺序反了会被贴图原始尺寸覆盖成 2×2，见 AGENTS 教训 C）。
 */

export interface CardSpec {
  /** 顶部图标（emoji；写入 Label 前会过 stripVariationSelectors） */
  icon: string;
  /** 卡片主标题 */
  title: string;
  /** 价格 / 归属等一行小字 */
  subtitle: string;
  /** 效果说明（最多 2 行） */
  desc: string;
  /** 顶条颜色（分类色） */
  accent: string;
  /** 是否可点（false 时整卡置灰，且不再触发点击） */
  enabled: boolean;
  onPick: () => void;
}

export interface UnitRowSpec {
  /** 英雄名（如「战士」） */
  name: string;
  /** 等级文本（如「Lv2」） */
  level: string;
  /** 第二行明细（技能列表 / 经验） */
  detail: string;
  /** 经验进度 0..1，用于画细进度条 */
  percent: number;
  /** 名字左侧色条颜色 */
  accent: string;
  /** 传了才可点（圣泉的"指定英雄"步骤用） */
  onPick?: () => void;
}

/** 承载卡片/行点击的小组件：命名方法才能解绑（不用匿名 lambda） */
@ccclass('PanelCardButton')
export class PanelCardButton extends Component {
  private _onPick: (() => void) | null = null;

  onEnable(): void {
    this.node.on(Button.EventType.CLICK, this.onClicked, this);
  }

  onDisable(): void {
    this.node.off(Button.EventType.CLICK, this.onClicked, this);
  }

  setPick(handler: (() => void) | null): void {
    this._onPick = handler;
  }

  private onClicked(): void {
    this._onPick?.();
  }

  onDestroy(): void {
    this._onPick = null;
  }
}

// ---------------------------------------------------------------------------
// 尺寸
// ---------------------------------------------------------------------------
/** 商品卡 */
export const CARD_W = 264;
export const CARD_H = 148;
/** 圣泉的选项卡（一行三张） */
export const OPTION_W = 176;
export const OPTION_H = 150;
/** 英雄行 */
export const ROW_W = 552;
export const ROW_H = 64;

const GAP = 16;

/** 借一张已存在的纯色贴图建节点（没有 spriteFrame 的 Sprite 不绘制） */
function ensureVisual(
  node: Node, frame: SpriteFrame | null, color: string, alpha: number
): Sprite | null {
  let sp = node.getComponent(Sprite);
  if (!sp) sp = node.addComponent(Sprite);
  if (!sp) return null;
  if (frame) sp.spriteFrame = frame;
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.color = hex(color, alpha);
  if (!node.getComponent(UITransform)) node.addComponent(UITransform);
  return sp;
}

function ensureLabel(
  node: Node, text: string, token: { fontSize: number; lineHeight: number },
  color: string, align: number
): Label | null {
  let lb = node.getComponent(Label);
  if (!lb) lb = node.addComponent(Label);
  if (!lb) return null;
  if (!node.getComponent(UITransform)) node.addComponent(UITransform);
  lb.string = stripVariationSelectors(text);
  applyFontAndColor(lb, token, color);
  lb.horizontalAlign = align;
  lb.verticalAlign = Label.VerticalAlign.CENTER;
  return lb;
}

/** 取/建同名子节点（多次刷新幂等） */
function child(parent: Node, name: string): Node {
  const existing = parent.getChildByName(name);
  if (existing?.isValid) return existing;
  const n = new Node(name);
  n.addComponent(UITransform);
  parent.addChild(n);
  return n;
}

/** 装卡片的容器：本身是面板的直接子节点，尺寸要跟着内容变（fitPanelBackground 只看直接子节点） */
function resetContainer(container: Node, width: number, height: number): void {
  container.removeAllChildren();
  const ui = container.getComponent(UITransform) ?? container.addComponent(UITransform);
  ui.setContentSize(Math.max(1, width), Math.max(1, height));
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

/**
 * 把卡片按网格铺进容器（整体在容器原点居中）。
 * @returns 实际占用的高度（调用方据此给容器留位）
 */
export function renderCardGrid(
  container: Node | null,
  frame: SpriteFrame | null,
  cards: CardSpec[],
  perRow: number = 2,
  cardW: number = CARD_W,
  cardH: number = CARD_H
): void {
  if (!container?.isValid) return;

  const rows = Math.max(1, Math.ceil(cards.length / perRow));
  const gridW = Math.min(cards.length, perRow) * cardW + (Math.min(cards.length, perRow) - 1) * GAP;
  const gridH = rows * cardH + (rows - 1) * GAP;
  resetContainer(container, gridW, gridH);

  for (let i = 0; i < cards.length; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    // 末行可能不满，按本行实际张数居中
    const inRow = Math.min(perRow, cards.length - row * perRow);
    const rowW = inRow * cardW + (inRow - 1) * GAP;
    const x = -rowW / 2 + cardW / 2 + col * (cardW + GAP);
    const y = gridH / 2 - cardH / 2 - row * (cardH + GAP);
    container.addChild(buildCard(cards[i], frame, cardW, cardH, new Node(`Card_${i}`), x, y));
  }
}

function buildCard(
  spec: CardSpec, frame: SpriteFrame | null,
  w: number, h: number, card: Node, x: number, y: number
): Node {
  const halfH = h / 2;
  card.addComponent(UITransform);
  ensureVisual(card, frame, spec.enabled ? COLOR.SURFACE : COLOR.SLOT_EMPTY_BG, 250);
  card.getComponent(UITransform)!.setContentSize(w, h);
  card.setPosition(x, y, 0);

  const main = spec.enabled ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED;
  const sub = spec.enabled ? COLOR.TEXT_SECONDARY : COLOR.TEXT_DISABLED;

  // 顶条
  const bar = child(card, 'AccentBar');
  ensureVisual(bar, frame, spec.accent, spec.enabled ? 255 : 90);
  bar.getComponent(UITransform)!.setContentSize(w - SPACE.SM, 4);
  bar.setPosition(0, halfH - 6, 0);

  // 图标
  const iconBg = child(card, 'Icon');
  const icon = ensureLabel(iconBg, spec.icon, FONT_TITLE, main, Label.HorizontalAlign.CENTER);
  iconBg.getComponent(UITransform)!.setContentSize(w - SPACE.LG, FONT_TITLE.lineHeight);
  if (icon) icon.overflow = Label.Overflow.CLAMP;
  iconBg.setPosition(0, halfH - 32, 0);

  // 标题
  const titleBg = child(card, 'Title');
  const title = ensureLabel(titleBg, spec.title, FONT_BODY, main, Label.HorizontalAlign.CENTER);
  titleBg.getComponent(UITransform)!.setContentSize(w - SPACE.SM, FONT_BODY.lineHeight);
  if (title) title.overflow = Label.Overflow.CLAMP;
  titleBg.setPosition(0, halfH - 62, 0);

  // 副标题（价格/归属）
  const subBg = child(card, 'Subtitle');
  const subLabel = ensureLabel(subBg, spec.subtitle, FONT_CAPTION, sub, Label.HorizontalAlign.CENTER);
  subBg.getComponent(UITransform)!.setContentSize(w - SPACE.SM, FONT_CAPTION.lineHeight);
  if (subLabel) subLabel.overflow = Label.Overflow.CLAMP;
  subBg.setPosition(0, halfH - 86, 0);

  // 说明（两行，CLAMP 不撑高）
  const descBg = child(card, 'Desc');
  const desc = ensureLabel(descBg, spec.desc, FONT_TINY, sub, Label.HorizontalAlign.CENTER);
  descBg.getComponent(UITransform)!.setContentSize(w - SPACE.SM, FONT_TINY.lineHeight * 2);
  if (desc) {
    desc.overflow = Label.Overflow.CLAMP;
    desc.enableWrapText = true;
  }
  descBg.setPosition(0, -halfH + 26, 0);

  // 交互
  const btn = card.getComponent(Button) ?? card.addComponent(Button);
  applyButtonTheme(btn, 'secondary');
  btn.transition = Button.Transition.SCALE;
  btn.interactable = spec.enabled;
  let picker = card.getComponent(PanelCardButton);
  if (!picker) picker = card.addComponent(PanelCardButton);
  picker.setPick(spec.onPick);

  return card;
}

/**
 * 英雄行：一行一个英雄（商店的队伍面板、圣泉的"指定英雄"都用它）。
 * 有 `onPick` 的行才挂按钮，否则纯展示。
 */
export function renderUnitRows(
  container: Node | null,
  frame: SpriteFrame | null,
  rows: UnitRowSpec[],
  rowW: number = ROW_W,
  rowH: number = ROW_H
): void {
  if (!container?.isValid) return;

  const total = rows.length * rowH + Math.max(0, rows.length - 1) * SPACE.SM;
  resetContainer(container, rowW, total);

  for (let i = 0; i < rows.length; i++) {
    const spec = rows[i];
    const row = new Node(`Row_${i}`);
    const clickable = !!spec.onPick;
    const main = clickable ? COLOR.TEXT_PRIMARY : COLOR.TEXT_PRIMARY;
    row.addComponent(UITransform);
    ensureVisual(row, frame, COLOR.SURFACE, clickable ? 250 : 210);
    row.getComponent(UITransform)!.setContentSize(rowW, rowH);
    row.setPosition(0, total / 2 - rowH / 2 - i * (rowH + SPACE.SM), 0);

    // 左色条
    const bar = child(row, 'AccentBar');
    ensureVisual(bar, frame, spec.accent, 255);
    bar.getComponent(UITransform)!.setContentSize(4, rowH - SPACE.SM);
    bar.setPosition(-rowW / 2 + 8, 0, 0);

    // 名字（左半）与等级（右半）。
    // 盒子宽 = 半行 - 内边距，中心取 ±rowW/4（不是行边缘）：写 `-rowW/2 + SPACE.MD`
    // 会得到一个以行左边缘为中心、宽 276 的盒子，有一半伸到行外，
    // 被父级/画布边界裁掉半个字（实测「战士」只剩「士」、「Lv1」只剩「v1」）。
    const halfW = rowW / 2 - SPACE.SM;
    const halfY = rowH / 2 - 18;

    const nameBg = child(row, 'Name');
    const name = ensureLabel(nameBg, spec.name, FONT_BODY, main, Label.HorizontalAlign.LEFT);
    nameBg.getComponent(UITransform)!.setContentSize(halfW, FONT_BODY.lineHeight);
    if (name) name.overflow = Label.Overflow.CLAMP;
    nameBg.setPosition(-rowW / 4 + SPACE.SM / 2, halfY, 0);

    const lvBg = child(row, 'Level');
    const lv = ensureLabel(lvBg, spec.level, FONT_BODY, COLOR.TEXT_PRIMARY, Label.HorizontalAlign.RIGHT);
    lvBg.getComponent(UITransform)!.setContentSize(halfW, FONT_BODY.lineHeight);
    if (lv) lv.overflow = Label.Overflow.CLAMP;
    lvBg.setPosition(rowW / 4 - SPACE.SM / 2, halfY, 0);

    // 经验条：底槽 + 按比例缩放的填充（anchorX=0）
    const track = child(row, 'ExpTrack');
    ensureVisual(track, frame, COLOR.SLOT_EMPTY_BG, 255);
    track.getComponent(UITransform)!.setContentSize(rowW - SPACE.XL, 4);
    track.setPosition(0, 0, 0);
    const fill = child(track, 'ExpFill');
    ensureVisual(fill, frame, COLOR.SUCCESS, 255);
    const fillUi = fill.getComponent(UITransform)!;
    fillUi.setAnchorPoint(0, 0.5);
    fillUi.setContentSize(rowW - SPACE.XL, 4);
    fill.setPosition(-(rowW - SPACE.XL) / 2, 0, 0);
    fill.setScale(Math.max(0.02, Math.min(1, spec.percent)), 1, 1);

    // 明细（第二行）
    const detailBg = child(row, 'Detail');
    const detail = ensureLabel(detailBg, spec.detail, FONT_TINY, COLOR.TEXT_SECONDARY, Label.HorizontalAlign.LEFT);
    detailBg.getComponent(UITransform)!.setContentSize(rowW - SPACE.XL, FONT_TINY.lineHeight);
    if (detail) detail.overflow = Label.Overflow.CLAMP;
    detailBg.setPosition(0, -rowH / 2 + 16, 0);

    if (clickable) {
      const btn = row.addComponent(Button);
      applyButtonTheme(btn, 'secondary');
      btn.transition = Button.Transition.SCALE;
      const picker = row.addComponent(PanelCardButton);
      picker.setPick(spec.onPick!);
    }

    container.addChild(row);
  }
}
