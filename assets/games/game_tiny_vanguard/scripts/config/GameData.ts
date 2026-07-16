export interface Stats {
  hp: number;
  attack: number;
  defense: number;
  move: number;
  range: number;
}

export interface EnergyConfig {
  max: number;
  regen: number;
}

export type TargetType = 'self' | 'ally' | 'enemy' | 'tile' | 'aoe';
export type SkillType = 'active' | 'passive';
export type TriggerCondition = 'on_attack' | 'on_hit' | 'on_turn_start' | 'on_kill';
export type EventType = 'choice' | 'random';
export type AIType = 'aggressive' | 'ranged' | 'defensive' | 'flanking';

export interface SkillEffect {
  type: string;
  params: Record<string, number>;
}

export interface SkillConfig {
  id: string;
  name: string;
  type: SkillType;
  energyCost: number;
  targetType: TargetType;
  description: string;
  triggerCondition?: TriggerCondition;
  effects: SkillEffect[];
  preMove?: boolean;
  range?: number;
}

export interface ClassConfig {
  id: string;
  name: string;
  icon: string;
  stats: Stats;
  energy: EnergyConfig;
  startingSkillId: string;
  skillPool: string[];
}

export interface EnemyConfig {
  id: string;
  name: string;
  stats: Stats;
  abilityIds: string[];
  aiBehavior: AIType;
}

export interface ChoiceOption {
  description: string;
  effects: { type: string; params: Record<string, number> }[];
}

export interface EventConfig {
  id: string;
  type: EventType;
  name: string;
  description: string;
  choices?: ChoiceOption[];
  randomOutcomes?: { description: string; weight: number; effects: { type: string; params: Record<string, number> }[] }[];
}

export interface TalentConfig {
  id: string;
  name: string;
  category: 'attack' | 'defense' | 'economy';
  description: string;
  maxPurchases: number;
  cost: number;
  effect: { type: string; params: Record<string, number> };
}

export const SKILLS: Record<string, SkillConfig> = {
  heavy_strike: {
    id: 'heavy_strike', name: '猛击', type: 'active', energyCost: 2, targetType: 'enemy',
    description: '1.5倍伤害 + 击退1格',
    effects: [{ type: 'damage_multiplier', params: { multiplier: 1.5 } }, { type: 'knockback', params: { distance: 1 } }]
  },
  double_strike: {
    id: 'double_strike', name: '连击', type: 'active', energyCost: 2, targetType: 'enemy',
    description: '攻击两次（每次70%伤害）',
    effects: [{ type: 'multi_attack', params: { count: 2, multiplier: 0.7 } }]
  },
  cleave: {
    id: 'cleave', name: '横扫', type: 'active', energyCost: 2, targetType: 'enemy',
    description: '攻击所有相邻敌人',
    effects: [{ type: 'aoe_adjacent', params: { multiplier: 1.0 } }]
  },
  battle_cry: {
    id: 'battle_cry', name: '战吼', type: 'active', energyCost: 1, targetType: 'self',
    description: '本场永久+2攻击力',
    effects: [{ type: 'buff_attack', params: { amount: 2, duration: 99 } }]
  },
  execute: {
    id: 'execute', name: '斩杀', type: 'active', energyCost: 2, targetType: 'enemy',
    description: '目标血量<30%则3倍伤害',
    effects: [{ type: 'execute', params: { threshold: 0.3, multiplier: 3.0 } }]
  },
  charge: {
    id: 'charge', name: '冲锋', type: 'active', energyCost: 2, targetType: 'self',
    description: '本次移动+2格 + 攻击附带+2伤害',
    preMove: true,
    effects: [{ type: 'buff_move', params: { amount: 2, duration: 1 } }, { type: 'bonus_damage', params: { amount: 2 } }]
  },
  counter: {
    id: 'counter', name: '反击', type: 'passive', energyCost: 0, targetType: 'self',
    description: '被攻击时回击50%伤害',
    triggerCondition: 'on_hit', effects: [{ type: 'passive_counter', params: { multiplier: 0.5 } }]
  },
  toughness: {
    id: 'toughness', name: '铁壁', type: 'passive', energyCost: 0, targetType: 'self',
    description: '+1最大血量，+1防御',
    triggerCondition: 'on_turn_start', effects: [{ type: 'passive_toughness', params: { hp: 1, defense: 1 } }]
  },

  precise_shot: {
    id: 'precise_shot', name: '狙击', type: 'active', energyCost: 2, targetType: 'enemy', range: 2,
    description: '2倍伤害，无视防御',
    effects: [{ type: 'damage_multiplier', params: { multiplier: 2.0 } }, { type: 'ignore_defense', params: { value: 1 } }]
  },
  barrage: {
    id: 'barrage', name: '连射', type: 'active', energyCost: 2, targetType: 'enemy', range: 2,
    description: '对同一目标射出两箭（各80%）',
    effects: [{ type: 'multi_attack', params: { count: 2, multiplier: 0.8 } }]
  },
  rain_of_arrows: {
    id: 'rain_of_arrows', name: '箭雨', type: 'active', energyCost: 3, targetType: 'aoe', range: 2,
    description: '3×3 AOE，60%伤害',
    effects: [{ type: 'aoe_3x3', params: { multiplier: 0.6 } }]
  },
  mark_target: {
    id: 'mark_target', name: '标记', type: 'active', energyCost: 1, targetType: 'enemy', range: 2,
    description: '目标2回合内受伤+2',
    effects: [{ type: 'mark', params: { amount: 2, duration: 2 } }]
  },
  evade: {
    id: 'evade', name: '后撤步', type: 'active', energyCost: 1, targetType: 'enemy', range: 1,
    description: '攻击后向后移动1格',
    effects: [{ type: 'damage', params: { amount: 0 } }, { type: 'retreat', params: { distance: 1 } }]
  },
  eagle_eye: {
    id: 'eagle_eye', name: '鹰眼', type: 'passive', energyCost: 0, targetType: 'self',
    description: '射程+1',
    triggerCondition: 'on_turn_start', effects: [{ type: 'passive_eagle_eye', params: { range: 1 } }]
  },
  poison_arrows: {
    id: 'poison_arrows', name: '淬毒箭', type: 'passive', energyCost: 0, targetType: 'self',
    description: '攻击附带中毒2回合（每回合1伤害）',
    triggerCondition: 'on_attack', effects: [{ type: 'passive_poison', params: { damage: 1, duration: 2 } }]
  },

  fireball: {
    id: 'fireball', name: '火球', type: 'active', energyCost: 3, targetType: 'aoe', range: 2,
    description: '1.5倍伤害 + 目标周围1格AOE',
    effects: [{ type: 'aoe_1radius', params: { multiplier: 1.5 } }]
  },
  freeze: {
    id: 'freeze', name: '冰冻', type: 'active', energyCost: 2, targetType: 'enemy', range: 2,
    description: '伤害 + 定身1回合',
    effects: [{ type: 'damage_multiplier', params: { multiplier: 1.0 } }, { type: 'immobilize', params: { duration: 1 } }]
  },
  chain_lightning: {
    id: 'chain_lightning', name: '闪电链', type: 'active', energyCost: 3, targetType: 'enemy', range: 2,
    description: '主目标伤害 + 连锁2名最近敌人',
    effects: [{ type: 'chain', params: { chainCount: 2, multiplier: 0.8 } }]
  },
  teleport: {
    id: 'teleport', name: '传送', type: 'active', energyCost: 2, targetType: 'tile',
    description: '瞬移到3格内任意可见位置',
    effects: [{ type: 'teleport', params: { range: 3 } }]
  },
  amplify: {
    id: 'amplify', name: '增幅', type: 'active', energyCost: 1, targetType: 'self',
    description: '下次技能伤害×1.5',
    effects: [{ type: 'buff_next_skill', params: { multiplier: 1.5 } }]
  },
  arcane_shield: {
    id: 'arcane_shield', name: '奥术护盾', type: 'active', energyCost: 2, targetType: 'self',
    description: '自身免疫下一次攻击',
    effects: [{ type: 'shield', params: { amount: 999, duration: 99 } }]
  },
  arcane_flow: {
    id: 'arcane_flow', name: '魔力涌动', type: 'passive', energyCost: 0, targetType: 'self',
    description: '每回合能量回复+1',
    triggerCondition: 'on_turn_start', effects: [{ type: 'passive_energy_regen', params: { amount: 1 } }]
  },

  heal: {
    id: 'heal', name: '治愈', type: 'active', energyCost: 2, targetType: 'ally', range: 2,
    description: '恢复友方4点血量',
    effects: [{ type: 'heal', params: { amount: 4 } }]
  },
  group_heal: {
    id: 'group_heal', name: '群体治愈', type: 'active', energyCost: 3, targetType: 'ally', range: 2,
    description: '周围2格所有友方恢复3血量',
    effects: [{ type: 'aoe_heal', params: { radius: 2, amount: 3 } }]
  },
  shield: {
    id: 'shield', name: '护盾', type: 'active', energyCost: 2, targetType: 'ally', range: 2,
    description: '友方获得3点护盾（持续2回合）',
    effects: [{ type: 'shield', params: { amount: 3, duration: 2 } }]
  },
  bless: {
    id: 'bless', name: '祝福', type: 'active', energyCost: 1, targetType: 'ally', range: 2,
    description: '友方本场永久+2攻击',
    effects: [{ type: 'buff_attack', params: { amount: 2, duration: 99 } }]
  },
  smite: {
    id: 'smite', name: '惩戒', type: 'active', energyCost: 2, targetType: 'enemy', range: 1,
    description: '对敌方造成4点魔法伤害（无视防御）',
    effects: [{ type: 'damage', params: { amount: 4 } }, { type: 'ignore_defense', params: { value: 1 } }]
  },
  haste: {
    id: 'haste', name: '加速', type: 'active', energyCost: 1, targetType: 'ally', range: 2,
    description: '友方2回合内移速+1',
    effects: [{ type: 'buff_move', params: { amount: 1, duration: 2 } }]
  },
  aura_of_blessing: {
    id: 'aura_of_blessing', name: '祝福光环', type: 'passive', energyCost: 0, targetType: 'self',
    description: '回合开始时周围友方回血1点',
    triggerCondition: 'on_turn_start', effects: [{ type: 'passive_aura_heal', params: { amount: 1, radius: 1 } }]
  },
};

export const CLASSES: ClassConfig[] = [
  {
    id: 'warrior', name: '战士', icon: '\u2694\uFE0F',
    stats: { hp: 8, attack: 5, defense: 2, move: 3, range: 1 },
    energy: { max: 5, regen: 2 },
    startingSkillId: 'heavy_strike',
    skillPool: ['double_strike', 'cleave', 'battle_cry', 'execute', 'charge', 'counter', 'toughness']
  },
  {
    id: 'archer', name: '弓箭手', icon: '\uD83C\uDFF9',
    stats: { hp: 6, attack: 4, defense: 1, move: 3, range: 2 },
    energy: { max: 5, regen: 2 },
    startingSkillId: 'precise_shot',
    skillPool: ['barrage', 'rain_of_arrows', 'mark_target', 'evade', 'eagle_eye', 'poison_arrows']
  },
  {
    id: 'mage', name: '法师', icon: '\uD83D\uDD2E',
    stats: { hp: 5, attack: 5, defense: 0, move: 3, range: 2 },
    energy: { max: 5, regen: 2 },
    startingSkillId: 'fireball',
    skillPool: ['freeze', 'chain_lightning', 'teleport', 'amplify', 'arcane_shield', 'arcane_flow']
  },
  {
    id: 'cleric', name: '牧师', icon: '\uD83D\uDC9A',
    stats: { hp: 7, attack: 2, defense: 1, move: 3, range: 1 },
    energy: { max: 5, regen: 2 },
    startingSkillId: 'heal',
    skillPool: ['group_heal', 'shield', 'bless', 'smite', 'haste', 'aura_of_blessing']
  },
];

export const ENEMIES: EnemyConfig[] = [
  {
    id: 'swordsman', name: '剑兵',
    stats: { hp: 6, attack: 3, defense: 1, move: 3, range: 1 },
    abilityIds: [], aiBehavior: 'aggressive'
  },
  {
    id: 'crossbowman', name: '弩手',
    stats: { hp: 4, attack: 3, defense: 0, move: 3, range: 2 },
    abilityIds: [], aiBehavior: 'ranged'
  },
  {
    id: 'shieldbearer', name: '盾兵',
    stats: { hp: 10, attack: 2, defense: 3, move: 2, range: 1 },
    abilityIds: [], aiBehavior: 'defensive'
  },
  {
    id: 'shadowblade', name: '影刺',
    stats: { hp: 4, attack: 4, defense: 0, move: 4, range: 1 },
    abilityIds: [], aiBehavior: 'flanking'
  },
];

export const ELITE_ENEMIES: EnemyConfig[] = [
  {
    id: 'elite_swordsman', name: '精英剑兵',
    stats: { hp: 10, attack: 5, defense: 2, move: 3, range: 1 },
    abilityIds: [], aiBehavior: 'aggressive'
  },
  {
    id: 'elite_crossbowman', name: '精英弩手',
    stats: { hp: 7, attack: 5, defense: 1, move: 3, range: 2 },
    abilityIds: [], aiBehavior: 'ranged'
  },
  {
    id: 'elite_shieldbearer', name: '精英盾兵',
    stats: { hp: 16, attack: 3, defense: 4, move: 2, range: 1 },
    abilityIds: [], aiBehavior: 'defensive'
  },
  {
    id: 'elite_shadowblade', name: '精英影刺',
    stats: { hp: 7, attack: 6, defense: 0, move: 4, range: 1 },
    abilityIds: [], aiBehavior: 'flanking'
  },
];

export const BOSS_CONFIG = {
  id: 'war_lord', name: '战争领主',
  stats: { hp: 20, attack: 7, defense: 3, move: 3, range: 1 },
  abilityIds: ['boss_sweep', 'boss_summon'],
  aiBehavior: 'aggressive' as AIType,
};

export const EVENTS: EventConfig[] = [
  {
    id: 'abandoned_weapons', type: 'choice', name: '遗弃武器',
    description: '你在战场上发现了一批被遗弃的武器。',
    choices: [
      { description: '让一个单位学习新技能', effects: [{ type: 'learn_skill', params: { count: 1 } }] },
      { description: '全员+1攻击力', effects: [{ type: 'buff_all_attack', params: { amount: 1 } }] },
    ]
  },
  {
    id: 'wandering_merchant', type: 'choice', name: '流浪商人',
    description: '一个神秘的商人向你走来。',
    choices: [
      { description: '花10金币买随机技能', effects: [{ type: 'spend_gold', params: { amount: 10 } }, { type: 'learn_skill', params: { count: 1 } }] },
      { description: '免费但某单位-1攻击', effects: [{ type: 'debuff_random_attack', params: { amount: 1 } }] },
    ]
  },
  {
    id: 'magic_spring', type: 'choice', name: '魔法泉水',
    description: '你发现了一处散发着微光的魔法泉水。',
    choices: [
      { description: '全员回复3血量', effects: [{ type: 'heal_all', params: { amount: 3 } }] },
      { description: '牺牲1血量换永久+1能量上限', effects: [{ type: 'sacrifice_hp', params: { amount: 1 } }, { type: 'buff_energy_max', params: { amount: 1 } }] },
    ]
  },
  {
    id: 'mysterious_chest', type: 'random', name: '神秘宝箱',
    description: '一个古老的宝箱出现在你面前...',
    randomOutcomes: [
      { description: '获得一件稀有技能！', weight: 40, effects: [{ type: 'learn_rare_skill', params: { count: 1 } }] },
      { description: '宝箱是怪物！全员-1血量', weight: 60, effects: [{ type: 'damage_all', params: { amount: 1 } }] },
    ]
  },
  {
    id: 'abandoned_camp', type: 'random', name: '废弃营地',
    description: '你发现了一个被遗弃的营地。',
    randomOutcomes: [
      { description: '发现10金币', weight: 50, effects: [{ type: 'gain_gold', params: { amount: 10 } }] },
      { description: '什么也没有', weight: 50, effects: [] },
    ]
  },
];

export const TALENTS: TalentConfig[] = [
  { id: 'power_up', name: '力量强化', category: 'attack', description: '开局全员+1攻击力', maxPurchases: 1, cost: 50, effect: { type: 'bonus_attack', params: { amount: 1 } } },
  { id: 'energy_up', name: '能量充盈', category: 'attack', description: '开局全员+1能量上限', maxPurchases: 2, cost: 50, effect: { type: 'bonus_energy_max', params: { amount: 1 } } },
  { id: 'class_mastery', name: '职业精通', category: 'attack', description: '某职业+2初始攻击', maxPurchases: 1, cost: 50, effect: { type: 'bonus_class_attack', params: { amount: 2 } } },
  { id: 'hp_up', name: '生命强化', category: 'defense', description: '开局全员+1血量', maxPurchases: 3, cost: 50, effect: { type: 'bonus_hp', params: { amount: 1 } } },
  { id: 'armor_up', name: '铁甲', category: 'defense', description: '开局全员+1防御', maxPurchases: 1, cost: 50, effect: { type: 'bonus_defense', params: { amount: 1 } } },
  { id: 'energy_regen', name: '能量再生', category: 'defense', description: '每回合能量回复+1', maxPurchases: 1, cost: 50, effect: { type: 'bonus_energy_regen', params: { amount: 1 } } },
  { id: 'start_gold', name: '启动资金', category: 'economy', description: '开局+5金币', maxPurchases: 3, cost: 50, effect: { type: 'bonus_gold', params: { amount: 5 } } },
  { id: 'discount', name: '议价', category: 'economy', description: '商店折扣-10%', maxPurchases: 2, cost: 50, effect: { type: 'shop_discount', params: { percent: 10 } } },
  { id: 'lucky', name: '幸运儿', category: 'economy', description: '事件好结果概率+20%', maxPurchases: 1, cost: 50, effect: { type: 'event_luck', params: { percent: 20 } } },
];

export function getClassById(id: string): ClassConfig | undefined {
  return CLASSES.find(c => c.id === id);
}

export function getSkillById(id: string): SkillConfig | undefined {
  return SKILLS[id];
}

export function getEnemyById(id: string): EnemyConfig | undefined {
  return ENEMIES.find(e => e.id === id) || ELITE_ENEMIES.find(e => e.id === id);
}

export function getRandomSkillsFromPool(poolIds: string[], count: number): SkillConfig[] {
  const pool = poolIds.map(id => SKILLS[id]).filter(s => s !== undefined);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
