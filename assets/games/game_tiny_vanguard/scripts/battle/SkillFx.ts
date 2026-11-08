/**
 * 小小先锋 · 技能演出（Skill FX）
 *
 * 目标：技能不再只是「闪一下 + 抖一下」的原型反馈，而是每种技能一眼能认出类型：
 * 火球 = 橙色飞弹 + 爆炸；冰霜 = 蓝色结晶；闪电 = 折线电弧；治疗 = 升腾光点；
 * 增益 = 脚下光环；AOE = 冲击环；斩击 = 弧刃。
 *
 * 全部为运行时 Graphics + tween，不新增场景资源；节点在动画结束后自毁。
 * 坐标为 **BattleManager 节点本地坐标**（单位正放在该节点下，positionForGrid 即此坐标系）。
 */
import { Graphics, Node, UITransform, UIOpacity, Vec3, tween } from 'cc';
import { hex } from '../config/Theme';

export type FxKind =
  | 'slash' | 'fire' | 'frost' | 'lightning' | 'arrow'
  | 'holy' | 'arcane' | 'heal' | 'buff' | 'shield' | 'impact' | 'aoe';

const FX_COLOR: Record<FxKind, string> = {
  slash: '#F3F4F6',
  fire: '#F97316',
  frost: '#38BDF8',
  lightning: '#FACC15',
  arrow: '#A3E635',
  holy: '#FDE047',
  arcane: '#A855F7',
  heal: '#22C55E',
  buff: '#F59E0B',
  shield: '#60A5FA',
  impact: '#EF4444',
  aoe: '#FB7185',
};

/** 技能 id → 演出类型（未收录的走效果类型推断） */
const SKILL_FX: Record<string, FxKind> = {
  heavy_strike: 'slash', double_strike: 'slash', cleave: 'slash', execute: 'slash',
  charge: 'buff', counter: 'shield', battle_cry: 'buff', toughness: 'shield',
  precise_shot: 'arrow', barrage: 'arrow', rain_of_arrows: 'arrow', poison_arrows: 'arrow',
  mark_target: 'buff', evade: 'buff', eagle_eye: 'buff',
  fireball: 'fire', freeze: 'frost', chain_lightning: 'lightning', amplify: 'arcane',
  teleport: 'arcane', arcane_shield: 'shield', arcane_flow: 'buff',
  heal: 'heal', group_heal: 'heal', shield: 'shield', bless: 'holy', smite: 'holy',
  haste: 'buff', aura_of_blessing: 'buff',
  enemy_armor_break: 'slash', enemy_rapid_fire: 'arrow', enemy_shield_wall: 'shield',
  enemy_shadow_step: 'arcane',
  elite_sword_wave: 'slash', elite_snipe: 'arrow', elite_taunt: 'buff', elite_double_stab: 'slash',
  boss_sweep: 'aoe', boss_summon: 'arcane',
};

export interface SkillFxRequest {
  /** 施法者本地坐标 */
  from: Vec3;
  /** 目标本地坐标（无目标时传 null） */
  to: Vec3 | null;
  /** 技能 id（决定演出类型） */
  skillId?: string;
  /** 效果类型列表（skillId 未收录时按此推断） */
  effectTypes: string[];
  /** 是否敌人施放（色调更偏红） */
  hostile?: boolean;
}

/** 技能 id/效果 → 演出大类 */
export function resolveFxKind(skillId: string | undefined, effectTypes: string[]): FxKind {
  if (skillId && SKILL_FX[skillId]) return SKILL_FX[skillId];
  if (skillId && skillId.startsWith('boss_')) return 'aoe';
  if (effectTypes.includes('aoe_1radius') || effectTypes.includes('aoe_3x3')) return 'aoe';
  if (effectTypes.includes('heal') || effectTypes.includes('aoe_heal')) return 'heal';
  if (effectTypes.includes('chain')) return 'lightning';
  if (effectTypes.includes('damage') || effectTypes.includes('damage_multiplier')
    || effectTypes.includes('multi_attack') || effectTypes.includes('execute')) return 'slash';
  return 'buff';
}

/** 网格坐标 → BattleManager 本地坐标（与 UnitController.positionForGrid 同式） */
export function gridToLocal(row: number, col: number): Vec3 {
  return new Vec3((col - 2.5) * 80, (row - 2.5) * 80, 0);
}

// ---------------------------------------------------------------------------
// 节点搭建原语
// ---------------------------------------------------------------------------

interface FxNode {
  node: Node;
  g: Graphics;
  opacity: UIOpacity;
}

function makeFx(parent: Node, name: string, pos: Vec3, size = 120): FxNode {
  const node = new Node(name);
  node.addComponent(UITransform).setContentSize(size, size);
  node.setPosition(pos.x, pos.y, 0);
  const g = node.addComponent(Graphics);
  const opacity = node.addComponent(UIOpacity);
  opacity.opacity = 255;
  parent.addChild(node);
  return { node, g, opacity };
}

/** 动画结束自毁（UIOpacity 淡出；即使被中途打断也不会残留） */
function fadeAndDestroy(fx: FxNode, delay: number, fade = 0.22): void {
  if (!fx.node?.isValid) return;
  tween(fx.opacity)
    .delay(delay)
    .to(fade, { opacity: 0 })
    .call(() => { if (fx.node?.isValid) fx.node.destroy(); })
    .start();
}

// ---------------------------------------------------------------------------
// 各类演出
// ---------------------------------------------------------------------------

/** 施法光环：脚下扩散圆环 + 上浮粒子 */
function playCastAura(parent: Node, pos: Vec3, kind: FxKind): void {
  const color = FX_COLOR[kind];
  const fx = makeFx(parent, 'Fx_CastAura', pos, 160);

  fx.g.strokeColor = hex(color, 235);
  fx.g.lineWidth = 3;
  fx.g.circle(0, -12, 16);
  fx.g.stroke();

  fx.g.strokeColor = hex(color, 120);
  fx.g.lineWidth = 2;
  fx.g.circle(0, -12, 24);
  fx.g.stroke();

  fx.node.setScale(0.55, 0.55, 1);
  tween(fx.node)
    .to(0.28, { scale: new Vec3(1.5, 1.5, 1) }, { easing: 'quadOut' })
    .start();
  fadeAndDestroy(fx, 0.16, 0.3);
}

/** 飞弹：向目标飞行，命中后触发 burst */
function playProjectile(parent: Node, from: Vec3, to: Vec3, kind: FxKind, onHit?: () => void): void {
  const color = FX_COLOR[kind];
  const fx = makeFx(parent, 'Fx_Projectile', from, 90);

  const draw = (): void => {
    fx.g.clear();
    // 外发光
    fx.g.fillColor = hex(color, 60);
    fx.g.circle(0, 0, 15);
    fx.g.fill();
    // 核心
    fx.g.fillColor = hex(color, 255);
    fx.g.circle(0, 0, 8);
    fx.g.fill();
    fx.g.fillColor = hex('#FFFFFF', 230);
    fx.g.circle(0, 0, 3.2);
    fx.g.fill();
  };
  draw();

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const dur = Math.min(0.42, 0.16 + dist / 1600);

  tween(fx.node)
    .to(dur, { position: new Vec3(to.x, to.y, 0) }, { easing: 'quadIn' })
    .call(() => {
      if (fx.node?.isValid) fx.node.destroy();
      onHit?.();
    })
    .start();
}

/** 命中爆发：按类型画不同的破碎/弧刃/结晶/电弧 */
function playBurst(parent: Node, pos: Vec3, kind: FxKind): void {
  const color = FX_COLOR[kind];
  const fx = makeFx(parent, 'Fx_Burst', pos, 180);
  const g = fx.g;
  g.clear();

  switch (kind) {
    case 'slash': {
      g.strokeColor = hex(color, 240);
      g.lineWidth = 5;
      g.arc(0, 0, 26, -Math.PI * 0.15, Math.PI * 0.85, false);
      g.stroke();
      g.strokeColor = hex(color, 150);
      g.lineWidth = 3;
      g.arc(0, 0, 34, Math.PI * 0.35, Math.PI * 1.35, false);
      g.stroke();
      fx.node.setScale(0.7, 0.7, 1);
      tween(fx.node)
        .to(0.18, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'quadOut' })
        .start();
      break;
    }
    case 'fire': {
      g.fillColor = hex('#FDE68A', 220);
      g.circle(0, 0, 12);
      g.fill();
      g.fillColor = hex(color, 200);
      g.circle(0, 0, 30);
      g.fill();
      // 火星
      g.fillColor = hex('#FCD34D', 240);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.circle(Math.cos(a) * 26, Math.sin(a) * 26, 3);
        g.fill();
      }
      tween(fx.node)
        .to(0.35, { scale: new Vec3(1.5, 1.5, 1) }, { easing: 'quadOut' })
        .start();
      break;
    }
    case 'frost': {
      g.strokeColor = hex(color, 240);
      g.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x0 = Math.cos(a) * 8;
        const y0 = Math.sin(a) * 8;
        const x1 = Math.cos(a) * 28;
        const y1 = Math.sin(a) * 28;
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        // 冰晶分叉
        g.moveTo(x1 * 0.75, y1 * 0.75);
        g.lineTo(x1 * 0.75 + Math.cos(a + 0.7) * 7, y1 * 0.75 + Math.sin(a + 0.7) * 7);
      }
      g.stroke();
      g.fillColor = hex(color, 90);
      g.circle(0, 0, 16);
      g.fill();
      tween(fx.node)
        .to(0.3, { scale: new Vec3(1.35, 1.35, 1) }, { easing: 'quadOut' })
        .start();
      break;
    }
    case 'lightning': {
      g.strokeColor = hex(color, 255);
      g.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * 12;
        g.moveTo(ox, 22);
        g.lineTo(ox + 8, 8);
        g.lineTo(ox - 6, 2);
        g.lineTo(ox + 6, -14);
        g.lineTo(ox - 2, -24);
      }
      g.stroke();
      break;
    }
    case 'holy':
    case 'heal': {
      g.fillColor = hex('#FFFFFF', 210);
      g.circle(0, 0, 10);
      g.fill();
      g.fillColor = hex(color, 170);
      g.circle(0, 0, 22);
      g.fill();
      tween(fx.node)
        .to(0.36, { scale: new Vec3(1.4, 1.4, 1) }, { easing: 'quadOut' })
        .start();
      break;
    }
    case 'shield': {
      g.strokeColor = hex(color, 240);
      g.lineWidth = 3.5;
      // 六边形护盾
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / 3;
        pts.push({ x: Math.cos(a) * 24, y: Math.sin(a) * 24 });
      }
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.close();
      g.stroke();
      tween(fx.node)
        .to(0.4, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'quadOut' })
        .start();
      break;
    }
    case 'aoe': {
      g.strokeColor = hex(color, 245);
      g.lineWidth = 5;
      g.circle(0, 0, 26);
      g.stroke();
      g.strokeColor = hex(color, 130);
      g.lineWidth = 3;
      g.circle(0, 0, 40);
      g.stroke();
      g.fillColor = hex(color, 60);
      g.circle(0, 0, 26);
      g.fill();
      tween(fx.node)
        .to(0.4, { scale: new Vec3(1.8, 1.8, 1) }, { easing: 'quadOut' })
        .start();
      break;
    }
    case 'arcane': {
      g.strokeColor = hex(color, 230);
      g.lineWidth = 3;
      g.circle(0, 0, 14);
      g.stroke();
      g.strokeColor = hex(color, 130);
      g.circle(0, 0, 28);
      g.stroke();
      fx.node.angle = 0;
      tween(fx.node)
        .to(0.5, { angle: 140, scale: new Vec3(1.3, 1.3, 1) }, { easing: 'quadOut' })
        .start();
      break;
    }
    case 'buff':
    case 'impact':
    default: {
      g.strokeColor = hex(color, 240);
      g.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
        g.lineTo(Math.cos(a) * 26, Math.sin(a) * 26);
      }
      g.stroke();
      tween(fx.node)
        .to(0.32, { scale: new Vec3(1.35, 1.35, 1) }, { easing: 'quadOut' })
        .start();
      break;
    }
  }

  fadeAndDestroy(fx, 0.1, 0.28);
}

/** 上浮光点（治疗 / 增益）：多个小圆点向上飘散 */
function playRisingSparkles(parent: Node, pos: Vec3, kind: FxKind, count = 8): void {
  const color = FX_COLOR[kind];
  for (let i = 0; i < count; i++) {
    const fx = makeFx(parent, `Fx_Sparkle_${i}`, new Vec3(
      pos.x + (Math.random() - 0.5) * 40,
      pos.y + (Math.random() - 0.5) * 26,
      0
    ), 40);
    const r = 2 + Math.random() * 2.5;
    fx.g.fillColor = hex(color, 240);
    fx.g.circle(0, 0, r);
    fx.g.fill();
    fx.g.fillColor = hex('#FFFFFF', 220);
    fx.g.circle(0, 0, r * 0.45);
    fx.g.fill();

    const rise = 26 + Math.random() * 22;
    tween(fx.node)
      .delay(i * 0.03)
      .to(0.5, { position: new Vec3(fx.node.position.x, fx.node.position.y + rise, 0) }, { easing: 'quadOut' })
      .start();
    fadeAndDestroy(fx, i * 0.03 + 0.12, 0.4);
  }
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

export class SkillFx {
  /**
   * 播放一次技能演出（施法光环 → 飞弹/直击 → 命中爆发）。
   * 只做表现，不参与结算：调用方在结算前后随意调用都不会影响战斗规则。
   */
  static play(parent: Node, req: SkillFxRequest): void {
    if (!parent?.isValid) return;
    const kind = resolveFxKind(req.skillId, req.effectTypes);

    playCastAura(parent, req.from, kind);

    const needsTarget = req.effectTypes.some(t =>
      t === 'damage' || t === 'damage_multiplier' || t === 'multi_attack' || t === 'execute'
      || t === 'chain' || t === 'aoe_1radius' || t === 'aoe_3x3' || t === 'knockback'
    );

    if (req.to && (kind === 'fire' || kind === 'frost' || kind === 'arrow' || kind === 'holy' || kind === 'lightning')) {
      if (kind === 'lightning') {
        // 电弧不飞行：从施法者到目标直接画折线，随后目标处爆闪
        playLightningArc(parent, req.from, req.to);
        playBurst(parent, req.to, 'lightning');
      } else {
        playProjectile(parent, req.from, req.to, kind, () => {
          playBurst(parent, req.to, kind);
          if (kind === 'holy') playRisingSparkles(parent, req.to, 'holy', 5);
        });
      }
      return;
    }

    if (needsTarget && req.to) {
      // 近战斩击 / 范围冲击：直接落在目标点
      playBurst(parent, req.to, kind === 'aoe' ? 'aoe' : kind === 'impact' ? 'impact' : kind);
      return;
    }

    if (kind === 'heal' || kind === 'holy' || kind === 'buff' || kind === 'shield') {
      const at = req.to ?? req.from;
      playRisingSparkles(parent, at, kind, kind === 'heal' ? 10 : 7);
      if (kind === 'shield') playBurst(parent, at, 'shield');
      return;
    }

    if (req.to) playBurst(parent, req.to, kind);
  }

  /** 独立的治疗光点（群体治疗时对每个队友播放） */
  static healAt(parent: Node, pos: Vec3): void {
    if (!parent?.isValid) return;
    playRisingSparkles(parent, pos, 'heal', 8);
  }

  /** 独立的命中反馈（多段攻击 / 连击） */
  static impactAt(parent: Node, pos: Vec3, kind: FxKind = 'impact'): void {
    if (!parent?.isValid) return;
    playBurst(parent, pos, kind);
  }
}

/** 折线电弧（施法者 → 目标） */
function playLightningArc(parent: Node, from: Vec3, to: Vec3): void {
  const fx = makeFx(parent, 'Fx_LightningArc', from, 400);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const nx = -dy / len;
  const ny = dx / len;

  const g = fx.g;
  g.clear();
  g.strokeColor = hex('#FFFFFF', 230);
  g.lineWidth = 5;
  const segs = 7;
  g.moveTo(0, 0);
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const jitter = i === segs ? 0 : (Math.random() - 0.5) * 22;
    g.lineTo(dx * t + nx * jitter, dy * t + ny * jitter);
  }
  g.stroke();

  g.strokeColor = hex(FX_COLOR.lightning, 180);
  g.lineWidth = 10;
  g.moveTo(0, 0);
  g.lineTo(dx, dy);
  g.stroke();

  // 电弧保留得久一点，否则一帧就消失、看不清「谁打谁」
  fadeAndDestroy(fx, 0.18, 0.26);
}
