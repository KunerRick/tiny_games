import { _decorator, Component, Node, Label, SpriteFrame, UITransform, Button, Graphics } from 'cc';
import {
  COLOR, FONT_BODY, FONT_CAPTION, FONT_TITLE, SPACE,
  applyFontAndColor, hex, stripVariationSelectors,
} from '../config/Theme';
import {
  drawEmblem, drawFrame, ensureChild, ensureScaleButton, ensureTransform, makeLabel,
} from './GameUIKit';
const { ccclass } = _decorator;

/**
 * 商店 / 圣泉这类"列表型面板"的运行时卡片渲染器。
 *
 * 视觉与职业选择页、路线图共用 `GameUIKit` 的语言：圆角描边底板 + 顶部强调条 +
 * 分类色勋章 + 大字标题。旧版用 Sprite 平铺纯色块，视觉上和战斗界面不是一个游戏，
 * 这一版全部改成 Graphics 绘制（不再依赖 spriteFrame 参数，保留只为兼容调用方）。
 */
export interface CardSpec {
  /** 顶部图标（emoji；写入 Label 前会过 stripVariationSelectors） */
  icon: string;
  /**
   * 矢量纹章（可选，优先于 emoji）。
   * emoji 在不同平台的字体里形状、颜色都不受控（⚔ 在预览里读成了一枚红叉），
   * 需要"一眼看懂是什么"的卡片（圣泉三选一）改用 `drawEmblem` 画矢量图形。
   */
  emblemKind?: string;
  /** 卡片主标题 */
  title: string;
  /** 价格 / 归属等一行小字 */
  subtitle: string;
  /** 效果说明（最多 2 行） */
  desc: string;
  /** 顶条 / 勋章颜色（分类色） */
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
export const CARD_H = 180;
/** 圣泉的选项卡（一行三张） */
export const OPTION_W = 184;
export const OPTION_H = 184;
/** 英雄行 */
export const ROW_W = 552;
export const ROW_H = 78;

const GAP = 16;

/** 装卡片的容器：本身是面板的直接子节点，尺寸要跟着内容变（fitPanelBackground 只看直接子节点） */
function resetContainer(container: Node, width: number, height: number): void {
  container.destroyAllChildren();
  const ui = container.getComponent(UITransform) ?? container.addComponent(UITransform);
  ui.setContentSize(Math.max(1, width), Math.max(1, height));
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

/**
 * 把卡片按网格铺进容器（整体在容器原点居中）。
 * `frame` 参数已不参与绘制（保留签名兼容旧调用）。
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
  void frame;

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
    container.addChild(buildCard(cards[i], cardW, cardH, new Node(`Card_${i}`), x, y));
  }
}

function buildCard(
  spec: CardSpec,
  w: number, h: number, card: Node, x: number, y: number
): Node {
  const halfH = h / 2;
  ensureTransform(card, w, h);
  card.setPosition(x, y, 0);

  const on = spec.enabled;
  const main = on ? COLOR.TEXT_PRIMARY : COLOR.TEXT_DISABLED;
  const sub = on ? COLOR.TEXT_SECONDARY : COLOR.TEXT_DISABLED;
  const accent = on ? spec.accent : COLOR.TEXT_DISABLED;

  // 底板 + 顶条 + 描边（与职业卡同款）；可点卡片用分类色描边，形成"可选"感
  drawFrame(card, {
    width: w,
    height: h,
    radius: 16,
    fill: on ? COLOR.SURFACE : COLOR.SLOT_EMPTY_BG,
    fillAlpha: 252,
    border: on ? spec.accent : COLOR.PANEL_BORDER,
    borderAlpha: on ? 130 : 160,
    borderWidth: 2,
    accent: on ? spec.accent : undefined,
    accentAlpha: 255,
    sheen: on,
  });

  // 勋章：外圈光晕 + 深色圆盘 + 分类色描边 + 矢量纹章（或 emoji）
  const pad = 10;
  const emblemR = 22;
  // 纵向排布全部由卡高推导（顶部勋章 → 标题 → 副标题 → 底部说明）。
  // 旧版用"距顶固定像素"写法，卡高不足 160 时描述文字会压到副标题上（实测圣泉三张卡糊成一团）。
  const emblemY = halfH - pad - emblemR;
  const emblem = ensureChild(card, 'Emblem', emblemR * 2 + 12, emblemR * 2 + 12);
  emblem.setPosition(0, emblemY, 0);
  const eg = emblem.getComponent(Graphics) ?? emblem.addComponent(Graphics);
  eg.clear();
  // 光晕
  eg.fillColor = hex(accent, on ? 34 : 16);
  eg.circle(0, 0, emblemR + 4);
  eg.fill();
  // 深色内盘：用 SURFACE 系而不是半透明分类色 —— 分类色叠在深底上会糊成一块，
  // 纹章压在上面几乎看不出形状（实测像一块污渍）。
  eg.fillColor = hex(COLOR.SLOT_EMPTY_BG, 245);
  eg.circle(0, 0, emblemR);
  eg.fill();
  // 分类色外环
  eg.strokeColor = hex(accent, on ? 220 : 110);
  eg.lineWidth = 2;
  eg.circle(0, 0, emblemR - 1);
  eg.stroke();
  if (spec.emblemKind) {
    drawEmblem(eg, spec.emblemKind, emblemR * 0.64, accent, on ? 255 : 130, on ? 120 : 30);
  } else {
    makeLabel(emblem, 'icon', spec.icon, FONT_TITLE, main, 'center', emblemR * 2, FONT_TITLE.lineHeight);
  }

  // 标题
  const titleY = emblemY - emblemR - 18;
  makeLabel(card, 'Title', spec.title, FONT_BODY, main, 'center', w - SPACE.MD, FONT_BODY.lineHeight)
    .node.setPosition(0, titleY, 0);

  // 价格 / 归属
  const subtitleY = titleY - FONT_BODY.lineHeight / 2 - FONT_CAPTION.lineHeight / 2 - 2;
  makeLabel(card, 'Subtitle', spec.subtitle, FONT_CAPTION, on ? spec.accent : sub, 'center', w - SPACE.MD, FONT_CAPTION.lineHeight)
    .node.setPosition(0, subtitleY, 0);

  // 说明：占满副标题以下的剩余空间（最多两行，CLAMP 不撑高）
  // 字号用 FONT_CAPTION 而不是 FONT_TINY：13 号在 720 设计宽缩到手机上只有 ~7px，
  // 中文糊成一片（实测圣泉/商店的说明文字几乎读不出来）。
  const descTop = subtitleY - FONT_CAPTION.lineHeight / 2 - 10;
  const descBottom = -halfH + pad;
  const descH = Math.max(FONT_CAPTION.lineHeight, descTop - descBottom);
  const desc = makeLabel(card, 'Desc', spec.desc, FONT_CAPTION, sub, 'center', w - SPACE.MD, descH);
  desc.overflow = Label.Overflow.CLAMP;
  desc.enableWrapText = true;
  desc.node.setPosition(0, (descTop + descBottom) / 2, 0);

  // 交互
  const btn = ensureScaleButton(card);
  btn.interactable = on;
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
  void frame;

  const total = rows.length * rowH + Math.max(0, rows.length - 1) * SPACE.SM;
  resetContainer(container, rowW, total);

  for (let i = 0; i < rows.length; i++) {
    const spec = rows[i];
    const row = new Node(`Row_${i}`);
    const clickable = !!spec.onPick;
    ensureTransform(row, rowW, rowH);
    row.setPosition(0, total / 2 - rowH / 2 - i * (rowH + SPACE.SM), 0);

    drawFrame(row, {
      width: rowW, height: rowH, radius: 14,
      fill: COLOR.SURFACE, fillAlpha: clickable ? 252 : 216,
      border: clickable ? spec.accent : COLOR.PANEL_BORDER,
      borderAlpha: clickable ? 170 : 110, borderWidth: 2,
      sheen: clickable,
    });

    // 左色条（圆头胶囊）
    const bar = ensureChild(row, 'AccentBarGfx', 6, rowH - SPACE.SM);
    bar.setPosition(-rowW / 2 + 12, 0, 0);
    const bg = bar.getComponent(Graphics) ?? bar.addComponent(Graphics);
    bg.clear();
    bg.fillColor = hex(spec.accent, clickable ? 255 : 150);
    bg.roundRect(-3, -(rowH - SPACE.SM) / 2, 6, rowH - SPACE.SM, 3);
    bg.fill();

    // 名字（左）与等级（右）。左侧留出 accent 胶囊与边框的余量，
    // 否则行首 emoji 会压在色条上、被行边界裁掉（实测「⚔ 战士」的剑只剩一半）。
    const pad = 30;
    const nameW = rowW * 0.56 - pad;
    const levelW = 78;
    const nameY = rowH / 2 - 20;
    const nameX = -rowW / 2 + pad + nameW / 2;
    const levelX = rowW / 2 - pad - levelW / 2;

    const nameLabel = makeLabel(row, 'Name', spec.name, FONT_BODY, COLOR.TEXT_PRIMARY, 'left', nameW, FONT_BODY.lineHeight);
    nameLabel.node.setPosition(nameX, nameY, 0);
    const levelLabel = makeLabel(row, 'Level', spec.level, FONT_BODY, spec.accent, 'right', levelW, FONT_BODY.lineHeight);
    levelLabel.node.setPosition(levelX, nameY, 0);

    // 经验条：圆角底槽 + 按比例缩放的填充（anchorX=0），放在名字与明细之间
    const trackW = rowW - pad * 2;
    const track = ensureChild(row, 'ExpTrack', trackW, 6);
    track.setPosition(0, -4, 0);
    const tg = track.getComponent(Graphics) ?? track.addComponent(Graphics);
    tg.clear();
    tg.fillColor = hex(COLOR.SLOT_EMPTY_BG, 255);
    tg.roundRect(-trackW / 2, -3, trackW, 6, 3);
    tg.fill();

    const fillW = Math.max(4, trackW * Math.max(0, Math.min(1, spec.percent)));
    const fill = ensureChild(track, 'ExpFill', fillW, 6);
    fill.setPosition(-trackW / 2, 0, 0);
    const fg = fill.getComponent(Graphics) ?? fill.addComponent(Graphics);
    fg.clear();
    fg.fillColor = hex(spec.accent, 255);
    fg.roundRect(0, -3, fillW, 6, 3);
    fg.fill();

    // 明细（第三行，贴底但不越界）
    // 字号同样从 FONT_TINY 提到 FONT_CAPTION：13 号在手机上只有 ~7px，
    // "技能 0/3 · 携带 · 经验 0%" 这种信息量最大的行反而最看不清。
    const detail = makeLabel(row, 'Detail', spec.detail, FONT_CAPTION, COLOR.TEXT_SECONDARY, 'left', trackW, FONT_CAPTION.lineHeight);
    detail.node.setPosition(0, -rowH / 2 + 18, 0);

    if (clickable) {
      ensureScaleButton(row);
      let picker = row.getComponent(PanelCardButton);
      if (!picker) picker = row.addComponent(PanelCardButton);
      picker.setPick(spec.onPick!);
    }

    container.addChild(row);
  }
}
