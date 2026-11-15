/**
 * 《秘银远征》静态配置（纯数据，**不得 import cc**）。
 *
 * 这里只放「表」：职业 / 技能 / 天赋 / 装备基型 / 饰品 / 副本 / 区域 / 悬赏。
 * 所有推导（等级曲线、词条预算、DPS 估算、存档净化）都在 MithrilProgress.ts，
 * 战斗模拟在 MithrilCore.ts。
 *
 * 约束：本文件被 tools/verify-mithril-core.js 用 tsc 直接编译，
 * 一旦 import 'cc' 自检就失效（沿用 FridgeConfig / ThunderCore 的约定）。
 */

// ==================== 职业 ====================

export type ClassId = 'warrior' | 'mage' | 'ranger' | 'priest';
export const CLASS_IDS: ClassId[] = ['warrior', 'mage', 'ranger', 'priest'];

export type SkillKind = 'basic' | 'active' | 'dodge' | 'burst';
export type SkillIdSuffix = 'basic' | 'a1' | 'a2' | 'a3' | 'dodge' | 'burst';

export interface ClassDef {
    id: ClassId;
    name: string;
    archetype: string;
    /** 资源名（怒气 / 法力 / 能量 / 法力 + 圣能） */
    resource: string;
    resourceDesc: string;
}

export const CLASSES: ClassDef[] = [
    {
        id: 'warrior',
        name: '战士',
        archetype: '近战 · 重甲',
        resource: '怒气',
        resourceDesc: '造成或承受伤害积攒 0–100，爆发技清空怒气',
    },
    {
        id: 'mage',
        name: '法师',
        archetype: '远程 · 法术',
        resource: '法力',
        resourceDesc: '缓慢回复 0–100，靠节能与唤醒维持循环',
    },
    {
        id: 'ranger',
        name: '游侠',
        archetype: '远程 · 物理',
        resource: '能量',
        resourceDesc: '快速回复 0–100，移动时恢复更慢（站桩输出）',
    },
    {
        id: 'priest',
        name: '牧师',
        archetype: '远程 · 治疗',
        resource: '法力 + 圣能',
        resourceDesc: '治疗积攒圣能 0–100，用于爆发窗口',
    },
];

export const CLASS_BY_ID: Record<ClassId, ClassDef> = (() => {
    const out = {} as Record<ClassId, ClassDef>;
    for (const c of CLASSES) out[c.id] = c;
    return out;
})();

// ==================== 技能（4 职业 × 6 = 24） ====================

export interface SkillVariantDef {
    name: string;
    desc: string;
}

export interface SkillDef {
    id: string;
    classId: ClassId;
    suffix: SkillIdSuffix;
    kind: SkillKind;
    name: string;
    desc: string;
    /** 冷却秒数（0 = 无冷却，按攻速） */
    cooldown: number;
    /**
     * 2 级 / 4 级各解锁一次「变体二选一」。
     * M0 只为火球术填了完整变体作为范式，其余在 M3 内容阶段补齐；
     * 未填时升级只加数值，不弹变体面板。
     */
    variants?: [[SkillVariantDef, SkillVariantDef], [SkillVariantDef, SkillVariantDef]];
}

function s(
    classId: ClassId,
    suffix: SkillIdSuffix,
    kind: SkillKind,
    name: string,
    cooldown: number,
    desc: string,
    variants?: [[SkillVariantDef, SkillVariantDef], [SkillVariantDef, SkillVariantDef]],
): SkillDef {
    return { id: `${classId}_${suffix}`, classId, suffix, kind, name, desc, cooldown, variants };
}

const FIREBALL_VARIANTS: [[SkillVariantDef, SkillVariantDef], [SkillVariantDef, SkillVariantDef]] = [
    [
        { name: '炽热', desc: '命中后 3 秒内持续 30 伤害' },
        { name: '爆裂', desc: '命中后 60px 范围 40 伤害' },
    ],
    [
        { name: '连锁', desc: '命中后弹射到最近敌人（50% 伤害）' },
        { name: '聚焦', desc: '飞行变慢，伤害 ×1.6' },
    ],
];

const WARRIOR_VARIANTS: Record<SkillIdSuffix, [[SkillVariantDef, SkillVariantDef], [SkillVariantDef, SkillVariantDef]]> = {
    basic: [
        [{ name: '横扫', desc: '扇形扩大到 120°，伤害 −10%' }, { name: '迅斩', desc: '冷却 −10%，伤害 −10%' }],
        [{ name: '连斩', desc: '普攻伤害 −10%，每第 4 击 ×1.5' }, { name: '重斩', desc: '伤害 +15%，冷却 +15%' }],
    ],
    a1: [
        [{ name: '长驱', desc: '冲锋距离 +100px' }, { name: '铁肩', desc: '眩晕 +0.4s' }],
        [{ name: '破阵', desc: '冲锋后 3s 攻速 +25%' }, { name: '回身', desc: '冲锋后 1.5s 受伤 −40%' }],
    ],
    a2: [
        [{ name: '风暴', desc: '旋风半径 +30px' }, { name: '疾旋', desc: '旋转每 0.34s 一跳' }],
        [{ name: '血旋', desc: '旋风伤害 +10%' }, { name: '持久', desc: '旋转持续 +0.5s' }],
    ],
    a3: [
        [{ name: '粉碎', desc: '额外减甲 4%' }, { name: '裂甲', desc: '命中溅射 90px（60% 伤害）' }],
        [{ name: '久战', desc: '减甲持续 +1s' }, { name: '致命', desc: '破甲伤害 +10%' }],
    ],
    dodge: [
        [{ name: '疾影', desc: '位移距离 +80px' }, { name: '坚守', desc: '无敌 +0.2s' }],
        [{ name: '反击步', desc: '侧步后下一击必暴' }, { name: '轻身', desc: '冷却 −25%' }],
    ],
    burst: [
        [{ name: '狂血', desc: '血怒持续 +2s' }, { name: '苦战', desc: '爆发期受伤惩罚减半' }],
        [{ name: '血偿', desc: '爆发期伤害再 +8%' }, { name: '铁血', desc: '爆发期不再有受伤惩罚' }],
    ],
};

export const SKILLS: SkillDef[] = [
    // 战士（怒气）
    s('warrior', 'basic', 'basic', '劈砍', 0.6, '90° 扇形，110% 攻击，积 8 怒气', [
        WARRIOR_VARIANTS.basic[0], WARRIOR_VARIANTS.basic[1],
    ]),
    s('warrior', 'a1', 'active', '冲锋', 8, '突进 220px，命中眩晕 0.8s', [
        WARRIOR_VARIANTS.a1[0], WARRIOR_VARIANTS.a1[1],
    ]),
    s('warrior', 'a2', 'active', '旋风斩', 10, '旋转 2s，每 0.4s 40% 攻击', [
        WARRIOR_VARIANTS.a2[0], WARRIOR_VARIANTS.a2[1],
    ]),
    s('warrior', 'a3', 'active', '破甲', 12, '单体 150%，减甲 20% 持续 5s，并减速 25% 2s', [
        WARRIOR_VARIANTS.a3[0], WARRIOR_VARIANTS.a3[1],
    ]),
    s('warrior', 'dodge', 'dodge', '侧步', 6, '位移 280px，0.4s 无敌', [
        WARRIOR_VARIANTS.dodge[0], WARRIOR_VARIANTS.dodge[1],
    ]),
    s('warrior', 'burst', 'burst', '血怒', 40, '10s 伤害 +30%、受伤 +15%，清空怒气', [
        WARRIOR_VARIANTS.burst[0], WARRIOR_VARIANTS.burst[1],
    ]),
    // 法师（法力）
    s('mage', 'basic', 'basic', '奥术弹', 1.2, '远程单体 100%'),
    s('mage', 'a1', 'active', '火球术', 6, '120% + 燃烧 3s（每秒 30%）', FIREBALL_VARIANTS),
    s('mage', 'a2', 'active', '冰霜新星', 12, '周身 120px 冻结 1.5s'),
    s('mage', 'a3', 'active', '闪现', 8, '瞬移 250px'),
    s('mage', 'dodge', 'dodge', '奥术屏障', 10, '吸收 15% 最大生命，2s'),
    s('mage', 'burst', 'burst', '奥术强化', 45, '8s 法术伤害 +40%，耗蓝翻倍'),
    // 游侠（能量）
    s('ranger', 'basic', 'basic', '射击', 0.9, '远程单体 95%'),
    s('ranger', 'a1', 'active', '多重射击', 5, '锥形 5 箭，各 60%'),
    s('ranger', 'a2', 'active', '冰霜陷阱', 10, '放置，踩中减速 50% 持续 3s'),
    s('ranger', 'a3', 'active', '后跃', 7, '后跳 200px，下一箭必暴'),
    s('ranger', 'dodge', 'dodge', '翻滚', 5, '位移 300px，0.4s 无敌'),
    s('ranger', 'burst', 'burst', '鹰眼', 40, '6s 暴击 +30%、射程 +40%'),
    // 牧师（法力 + 圣能）
    s('priest', 'basic', 'basic', '圣光弹', 1.0, '远程单体 85%，积 5 圣能'),
    s('priest', 'a1', 'active', '治疗术', 8, '恢复 25% 最大生命'),
    s('priest', 'a2', 'active', '神圣新星', 10, '周身 150px 伤害 + 自愈 5%'),
    s('priest', 'a3', 'active', '守护之灵', 14, '护盾 20% 最大生命，持续 6s'),
    s('priest', 'dodge', 'dodge', '圣光步', 6, '位移 + 0.5s 无敌'),
    s('priest', 'burst', 'burst', '圣能爆发', 50, '耗 100 圣能，8s 伤害 +35%、治疗 ×2'),
];

export const SKILL_BY_ID: Record<string, SkillDef> = (() => {
    const out: Record<string, SkillDef> = {};
    for (const sk of SKILLS) out[sk.id] = sk;
    return out;
})();

export function skillsOf(classId: ClassId): SkillDef[] {
    return SKILLS.filter((sk) => sk.classId === classId);
}

/** ==================== 成长（M3） ==================== */

/**
 * 出战时的**装等地板**：空档平均装等是 1、副属性全 0，直接按 1 算对 BOSS 只有约 4 DPS
 * （M1 起的平衡基准就按 5 级 / 装等 5 量过）。注意它只夹「装等」，**不再夹角色等级** ——
 * M3 起新档从 1 级开始自己练上去。
 */
export const COMBAT_ILVL_FLOOR = 5;

/** 技能书：每次通关保底 1 本，首通再 +1（在成长面板里换技能升级） */
export const SKILL_BOOK_PER_CLEAR = 1;
export const SKILL_BOOK_FIRST_CLEAR = 1;
/** 副本首通额外经验（一次性的追赶奖励，与掉落同轮发放） */
export const FIRST_CLEAR_EXP = 800;
/** 洗点金币价（设计 §4.4 / §4.5；M5 营地训练场再打折） */
export const TALENT_RESPEC_GOLD = 200;
export const SKILL_RESPEC_GOLD = 500;

// ==================== 天赋（4 职业 × 3 线 × 5 层 × 2 选 1 = 120） ====================

export type TalentTree =
    | 'steel' | 'fury' | 'tactic'
    | 'fire' | 'frost' | 'arcane'
    | 'marks' | 'survival' | 'beast'
    | 'holy' | 'shadow' | 'discipline';

export type TalentTier = 1 | 2 | 3 | 4 | 5;

export interface TalentDef {
    id: string;
    classId: ClassId;
    tree: TalentTree;
    tier: TalentTier;
    /** 同层二选一：0 / 1 */
    col: 0 | 1;
    name: string;
    desc: string;
    maxRank: number;
}

export interface TalentSeed {
    name: string;
    desc: string;
}

/** 每职业的线顺序与显示名 */
export const TALENT_TREE_ORDER: Record<ClassId, [TalentTree, TalentTree, TalentTree]> = {
    warrior: ['steel', 'fury', 'tactic'],
    mage: ['fire', 'frost', 'arcane'],
    ranger: ['marks', 'survival', 'beast'],
    priest: ['holy', 'shadow', 'discipline'],
};

export const TALENT_TREE_NAMES: Record<TalentTree, string> = {
    steel: '钢铁',
    fury: '狂怒',
    tactic: '战术',
    fire: '火焰',
    frost: '冰霜',
    arcane: '奥术',
    marks: '射击',
    survival: '生存',
    beast: '猎兽',
    holy: '神圣',
    shadow: '暗影',
    discipline: '戒律',
};

/** [层 - 1][线][0/1] */
export type TalentSeedGrid = TalentSeed[][][];

const seed = (name: string, desc: string): TalentSeed => ({ name, desc });

const WARRIOR_SEEDS: TalentSeedGrid = [
    [
        [seed('坚韧', '受伤 -1%'), seed('铁壁', '护甲 +2%')],
        [seed('狂暴', '暴击 +1%'), seed('嗜血', '击杀回 1% 生命')],
        [seed('战术精通', '怒气 +2%'), seed('威慑', '减速时长 +8%')],
    ],
    [
        [seed('格挡反击', '格挡时反击 40%'), seed('不屈', '生命 <30% 减伤 4%')],
        [seed('双持', '攻速 +3%'), seed('重击', '技能伤害 +2%')],
        [seed('破胆怒吼', '眩晕 +0.08s'), seed('战备', '闪避 CD -0.2s')],
    ],
    [
        [seed('盾墙', '闪避 CD -0.4s'), seed('战地医师', '治疗 +6%')],
        [seed('暴怒', '暴击伤害 +3%'), seed('持续压制', '对残血目标 +2%')],
        [seed('精准', '攻击强度 +1%'), seed('压制', '减甲 +3%')],
    ],
    [
        [seed('钢铁意志', '控制时长 -8%'), seed('反弹', '反弹近战 8%')],
        [seed('血之狂潮', '连续命中 +0.5%（上限 10 层）'), seed('破釜沉舟', '低血伤害 +4%')],
        [seed('战地指挥', '每 5s 回 2 怒气'), seed('钢铁阵型', '护盾 +3%')],
    ],
    [
        [seed('不朽', '每副本免死 1 次（每 2 点）'), seed('荆棘堡垒', '受伤 10% 转 AoE')],
        [seed('斩杀', '目标 <20% 生命伤害 +10%'), seed('无尽怒焰', '爆发期攻速 +6%')],
        [seed('战术大师', '技能 CD -2%'), seed('最后壁垒', '爆发期减伤 +4%')],
    ],
];

const MAGE_SEEDS: TalentSeedGrid = [
    [
        [seed('点燃', '燃烧伤害 +3%'), seed('火舌', '火球范围 +4%')],
        [seed('寒冰箭', '冰霜伤害 +3%'), seed('冰封', '冻结 +0.08s')],
        [seed('奥术精通', '法力上限 +5%'), seed('节能施法', '耗蓝 -3%')],
    ],
    [
        [seed('灼烧', '暴击 +1%'), seed('炽热之速', '急速 +1%')],
        [seed('霜寒', '对冻结目标 +2%'), seed('冰冷血脉', '急速 +1%')],
        [seed('法力涌动', '击杀回蓝 +4%'), seed('奥术专注', '防打断 +5%')],
    ],
    [
        [seed('爆燃', '燃烧目标死亡时爆炸'), seed('烈焰专注', '单体 +2%')],
        [seed('冰环', '新星范围 +5%'), seed('冰甲', '护甲 +3%')],
        [seed('时间扭曲', '技能 CD -2%'), seed('法阵', '站桩伤害 +2%')],
    ],
    [
        [seed('火焰风暴', '火球溅射 30%'), seed('熔岩护体', '对燃烧目标减伤 3%')],
        [seed('碎冰', '冻结目标暴击 +4%'), seed('绝对零度', '冻结目标死亡时扩散')],
        [seed('奥术强化', '爆发期伤害 +3%'), seed('法力护盾', '受伤转耗蓝')],
    ],
    [
        [seed('燃尽', '燃烧层数 +1（每 3 点）'), seed('凤凰之心', '每副本复活 1 次')],
        [seed('冰川', '冻结 5 次后释放冰川'), seed('寒冬', '全场减速 +3%')],
        [seed('奥术洪流', '每 15s 自动奥术弹'), seed('大法师', '全法术伤害 +3%')],
    ],
];

const RANGER_SEEDS: TalentSeedGrid = [
    [
        [seed('精准射击', '单体 +2%'), seed('快速拔枪', '攻速 +3%')],
        [seed('轻功', '移速 +1%'), seed('闪避精通', '闪避 CD -0.3s')],
        [seed('野兽亲和', '召唤物伤害 +3%'), seed('陷阱专精', '陷阱伤害 +3%')],
    ],
    [
        [seed('致命', '暴击 +1%'), seed('穿透', '贯穿概率 +5%')],
        [seed('翻滚强化', '无敌 +0.1s'), seed('回血', '闪避后回 1%')],
        [seed('驯兽', '召唤物生命 +5%'), seed('诱捕', '陷阱减速 +3%')],
    ],
    [
        [seed('瞄准', '远距目标 +2%'), seed('弹幕', '多重射击 +1 箭（每 2 点）')],
        [seed('陷阱大师', '陷阱范围 +5%'), seed('毒箭', '命中中毒')],
        [seed('群兽', '召唤物 +1（每 3 点）'), seed('爆炸陷阱', '爆炸半径 +4%')],
    ],
    [
        [seed('鹰眼', '暴击伤害 +3%'), seed('弱点', '暴击时破甲 5%')],
        [seed('猎豹', '移动后攻速 +2%'), seed('生存本能', '低血减伤 3%')],
        [seed('兽群狂怒', '召唤物暴击 +2%'), seed('双重陷阱', '可放 2 个（每 3 点）')],
    ],
    [
        [seed('狙击', '每第 5 箭 +50%'), seed('猎杀', '对精英 +4%')],
        [seed('幽灵步', '闪避后隐身 1s'), seed('野性', '闪避重置技能 CD -20%')],
        [seed('兽王', '召唤物继承 30% 属性'), seed('陷阱大师', '陷阱连锁触发')],
    ],
];

const PRIEST_SEEDS: TalentSeedGrid = [
    [
        [seed('治疗精通', '治疗 +3%'), seed('信仰', '法力上限 +5%')],
        [seed('暗影精通', '暗影伤害 +3%'), seed('侵蚀', '持续伤害 +3%')],
        [seed('戒律', '护盾 +3%'), seed('增益延长', '增益时长 +0.2s')],
    ],
    [
        [seed('圣光普照', '治疗范围 +5%'), seed('快速治疗', '治疗术 CD -0.4s')],
        [seed('精神鞭笞', '攻速 +2%'), seed('暗影暴击', '暴击 +1%')],
        [seed('忏悔', '减伤 +1%'), seed('圣言术', '护盾反弹 5%')],
    ],
    [
        [seed('治愈之触', '治疗暴击 +2%'), seed('圣能', '圣能获取 +5%')],
        [seed('恐惧', '控制时长 +5%'), seed('湮灭', '对低血目标 +2%')],
        [seed('苦修', '护盾存在时伤害 +2%'), seed('净化', '驱散强化')],
    ],
    [
        [seed('神圣专注', '溢出转护盾'), seed('守护', '治疗目标减伤 3%')],
        [seed('虚空', '暗影技能 +1 圣能（每 2 点）'), seed('暗影形态', '伤害 +2%（治疗 -2%）')],
        [seed('神圣壁垒', '护盾破碎时 AoE'), seed('恩赐', '自身 + 召唤物增益（单机改写）')],
    ],
    [
        [seed('圣光灌注', '治疗 5 次后下一技能免费'), seed('天使', '每副本复活 1 次')],
        [seed('熵', '每层持续伤害 +1%'), seed('末日', '目标死亡时爆炸')],
        [seed('神谕', '护盾可叠 2 层（每 3 点）'), seed('神圣化身', '爆发期护盾 +10%')],
    ],
];

export const TALENT_SEEDS: Record<ClassId, TalentSeedGrid> = {
    warrior: WARRIOR_SEEDS,
    mage: MAGE_SEEDS,
    ranger: RANGER_SEEDS,
    priest: PRIEST_SEEDS,
};

export const TALENT_MAX_RANK = 5;
/** 每线最多投入 25 点（5 层 × 5） */
export const TALENT_LINE_CAP = 25;
/** 30 级共 30 点 */
export const TALENT_TOTAL = 30;
/** 层 N 解锁需该线已投入 5 × (N-1) 点 */
export const TALENT_TIER_STEP = 5;

export function talentTierGate(tier: number): number {
    return TALENT_TIER_STEP * (Math.max(1, Math.min(5, Math.floor(tier))) - 1);
}

function buildTalents(): TalentDef[] {
    const out: TalentDef[] = [];
    for (const classId of CLASS_IDS) {
        const trees = TALENT_TREE_ORDER[classId];
        const grid = TALENT_SEEDS[classId];
        for (let t = 0; t < 5; t++) {
            for (let tr = 0; tr < 3; tr++) {
                for (let col = 0; col < 2; col++) {
                    const sd = grid[t][tr][col];
                    out.push({
                        id: `${classId}_${trees[tr]}_t${t + 1}_${col}`,
                        classId,
                        tree: trees[tr],
                        tier: (t + 1) as TalentTier,
                        col: col as 0 | 1,
                        name: sd.name,
                        desc: sd.desc,
                        maxRank: TALENT_MAX_RANK,
                    });
                }
            }
        }
    }
    return out;
}

export const TALENTS: TalentDef[] = buildTalents();

export const TALENT_BY_ID: Record<string, TalentDef> = (() => {
    const out: Record<string, TalentDef> = {};
    for (const t of TALENTS) out[t.id] = t;
    return out;
})();

export function talentsOf(classId: ClassId): TalentDef[] {
    return TALENTS.filter((t) => t.classId === classId);
}

// ==================== 装备 ====================

export type GearSlot = 'mainHand' | 'offHand' | 'head' | 'chest' | 'hands' | 'legs' | 'feet' | 'ring';
export const GEAR_SLOTS: GearSlot[] = ['mainHand', 'offHand', 'head', 'chest', 'hands', 'legs', 'feet', 'ring'];
export const GEAR_SLOT_NAMES: Record<GearSlot, string> = {
    mainHand: '主手',
    offHand: '副手',
    head: '头',
    chest: '胸',
    hands: '手',
    legs: '腿',
    feet: '脚',
    ring: '戒指',
};

export type QualityId = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface QualityDef {
    id: QualityId;
    name: string;
    /** 词条数（耐力固定附带，不占位） */
    affixCount: number;
    /** 复用 UITheme.COLOR 的十六进制字符串，零新增色值 */
    color: string;
    /** 橙装唯一特效 / 红装负面 */
    special?: 'unique' | 'negative';
}

export const QUALITIES: QualityDef[] = [
    { id: 'common', name: '普通', affixCount: 1, color: '#9CA3AF' },
    { id: 'uncommon', name: '优秀', affixCount: 2, color: '#22C55E' },
    { id: 'rare', name: '稀有', affixCount: 3, color: '#3B82F6' },
    { id: 'epic', name: '史诗', affixCount: 4, color: '#A855F7' },
    { id: 'legendary', name: '传说', affixCount: 4, color: '#F59E0B', special: 'unique' },
    { id: 'mythic', name: '秘境', affixCount: 4, color: '#EF4444', special: 'negative' },
];

export const QUALITY_BY_ID: Record<QualityId, QualityDef> = (() => {
    const out = {} as Record<QualityId, QualityDef>;
    for (const q of QUALITIES) out[q.id] = q;
    return out;
})();

export type AffixId = 'crit' | 'haste' | 'mastery' | 'vers';

export interface AffixDef {
    id: AffixId;
    name: string;
    /** 每词条点提供的百分比 */
    perPoint: number;
    cap: number;
    desc: string;
}

export const AFFIXES: AffixDef[] = [
    { id: 'crit', name: '暴击', perPoint: 0.0375, cap: 0.30, desc: '暴击率，暴击伤害 1.6×' },
    { id: 'haste', name: '急速', perPoint: 0.025, cap: 0.20, desc: '缩短冷却 / 加快普攻' },
    { id: 'mastery', name: '精通', perPoint: 0.025, cap: 0.20, desc: '职业专属加成' },
    { id: 'vers', name: '全能', perPoint: 0.0125, cap: 0.10, desc: '伤害提高，减伤一半' },
];

export const AFFIX_BY_ID: Record<AffixId, AffixDef> = (() => {
    const out = {} as Record<AffixId, AffixDef>;
    for (const a of AFFIXES) out[a.id] = a;
    return out;
})();

/** 8 槽 × 4 词条 = 32 点预算，随 ilvl 线性解锁 */
export const AFFIX_BUDGET = 32;
export const ILVL_MAX = 40;
/** 耐力每件固定附带，不占词条位；1 点 = 10 生命 */
export const STAMINA_HP_PER_POINT = 10;

export interface GearBaseDef {
    id: string;
    slot: GearSlot;
    name: string;
}

const GEAR_BASE_TABLE: Array<[GearSlot, string[]]> = [
    ['mainHand', ['秘银巨剑', '灰烬战斧', '橡木法杖', '霜晶魔杖', '长弓', '连弩', '圣光槌', '祈祷杖']],
    ['offHand', ['塔盾', '圆盾', '魔典', '箭袋', '圣徽', '图腾']],
    ['head', ['铁盔', '法师兜帽', '游侠皮帽', '牧师头环', '巨魔骨盔', '秘银王冠']],
    ['chest', ['板甲胸', '法袍', '皮甲胸', '牧师祭袍', '鳞甲', '深渊长袍']],
    ['hands', ['铁手套', '法系手套', '皮手套', '牧师手套', '巨魔护手', '秘银指套']],
    ['legs', ['板甲腿', '法袍腿', '皮甲腿', '祭袍腿', '鳞腿', '深渊腿']],
    ['feet', ['战靴', '法靴', '皮靴', '圣靴', '巨魔战靴', '秘银踏靴']],
    ['ring', ['力量之戒', '智慧之戒', '敏捷之戒', '信仰之戒', '灰烬之戒', '深渊之戒']],
];

function buildGearBases(): GearBaseDef[] {
    const out: GearBaseDef[] = [];
    for (const [slot, names] of GEAR_BASE_TABLE) {
        for (let i = 0; i < names.length; i++) out.push({ id: `${slot}_${i}`, slot, name: names[i] });
    }
    return out;
}

export const GEAR_BASES: GearBaseDef[] = buildGearBases();

export const GEAR_BASE_BY_ID: Record<string, GearBaseDef> = (() => {
    const out: Record<string, GearBaseDef> = {};
    for (const g of GEAR_BASES) out[g.id] = g;
    return out;
})();

/** 背包上限（自检锁死：满了不能再捡，已装备的不占格） */
export const INVENTORY_CAP = 60;

/**
 * 耐力：每件装备固定附带、不占词条位。取 ilvl 的一半（ilvl40 → 20 点 = 200 生命）。
 * 全身满装约 1600 点生命加成，相对 30 级基础 582 血约 3.7×——生存成长略快于伤害成长，
 * 符合「装备拉开上限」的定位，同时不会让伤害公式失衡。
 */
export const STAMINA_PER_ILVL = 0.5;

/** 单个词条最多能分配的点数（8 点 = 暴击 30% / 急速 20% / 精通 20% / 全能 10%） */
export const AFFIX_POINT_CAP = 8;

/** 副本推荐装等 / 首通固定紫装（槽位 + 各职业基型） */
export interface DungeonLootDef {
    ilvl: number;
    firstClearSlot: GearSlot;
    firstClearBase: Record<ClassId, string>;
}

export const DUNGEON_LOOT: Record<string, DungeonLootDef> = {
    mine: {
        ilvl: 8,
        firstClearSlot: 'mainHand',
        firstClearBase: {
            warrior: 'mainHand_0',   // 秘银巨剑
            mage: 'mainHand_2',      // 橡木法杖
            ranger: 'mainHand_4',    // 长弓
            priest: 'mainHand_6',    // 圣光槌
        },
    },
};

export interface AffixRoll {
    id: AffixId;
    points: number;
}

export interface EquipItem {
    uid: string;
    baseId: string;
    slot: GearSlot;
    ilvl: number;
    quality: QualityId;
    affixes: AffixRoll[];
    /** 改造词条 id（仅约 30% 掉落携带） */
    modifier?: string;
}

/** 改造词条：不写数值，写行为（本方案「不缩水」的分界线） */
export interface ModifierDef {
    id: string;
    name: string;
    desc: string;
}

export const MODIFIERS: ModifierDef[] = [
    { id: 'ember_stack', name: '余烬', desc: '火球术变体 A 的持续伤害可以叠 3 层' },
    { id: 'echo_cd', name: '回响', desc: '每第 3 次施放同一技能，冷却减半' },
    { id: 'soul_split', name: '裂魂', desc: '暴击时有 20% 概率重置闪避冷却' },
    { id: 'thorn_armor', name: '荆棘', desc: '受到近战伤害时反弹 30%，但最大生命 -10%' },
    { id: 'gluttony', name: '贪食', desc: '拾取掉落时 5% 概率额外掉一件（品质不高于当前）' },
];

export const MODIFIER_BY_ID: Record<string, ModifierDef> = (() => {
    const out: Record<string, ModifierDef> = {};
    for (const m of MODIFIERS) out[m.id] = m;
    return out;
})();

// ==================== 饰品（20 件 · 10 tag × 2） ====================

export type TrinketTag =
    | 'blood' | 'shadow' | 'echo' | 'thorn' | 'greed'
    | 'ember' | 'frost' | 'storm' | 'oath' | 'hunger';

export interface TrinketDef {
    id: string;
    name: string;
    effect: string;
    tag: TrinketTag;
}

export const TRINKETS: TrinketDef[] = [
    { id: 'blood_amulet', name: '嗜血护符', effect: '生命低于 30% 时，技能冷却 -40%', tag: 'blood' },
    { id: 'blood_ring', name: '血契指环', effect: '每损失 10% 生命，伤害 +6%（最高 +30%）', tag: 'blood' },
    { id: 'silent_bell', name: '静默之铃', effect: '闪避后 1 秒内下一次技能必暴击', tag: 'shadow' },
    { id: 'shadow_cloak', name: '暗影披风', effect: '静止 2 秒后隐身，首次攻击 +80%', tag: 'shadow' },
    { id: 'echo_stone', name: '回响石', effect: '每第 3 次施放同一技能，不消耗资源', tag: 'echo' },
    { id: 'resonance_crystal', name: '共鸣水晶', effect: '技能暴击时 50% 概率重置该技能冷却', tag: 'echo' },
    { id: 'thorn_crown', name: '荆棘之冠', effect: '反弹 20% 近战伤害，但移速 -10%', tag: 'thorn' },
    { id: 'thorn_plate', name: '反伤甲片', effect: '受伤时对周围 80px 造成该伤害的 15%', tag: 'thorn' },
    { id: 'greed_eye', name: '贪婪之眼', effect: '掉落 +1，但降品质概率 +25%', tag: 'greed' },
    { id: 'scavenger_pack', name: '拾荒者背包', effect: '宝箱多 1 个选项，代价多扣 5% 生命', tag: 'greed' },
    { id: 'ember_ring', name: '余烬之环', effect: '燃烧效果可叠加 2 层', tag: 'ember' },
    { id: 'ember_stone', name: '烬火石', effect: '击杀燃烧中的敌人时 60px 爆炸', tag: 'ember' },
    { id: 'frost_pendant', name: '霜华坠饰', effect: '被冻结的敌人受到伤害 +25%', tag: 'frost' },
    { id: 'frost_heart', name: '寒冰之心', effect: '冰霜技能范围 +40%', tag: 'frost' },
    { id: 'storm_totem', name: '雷暴图腾', effect: '每 5 次命中降下 1 道雷（80 伤害）', tag: 'storm' },
    { id: 'charge_bracer', name: '电荷护腕', effect: '暴击后 1 秒内普攻攻速 +50%', tag: 'storm' },
    { id: 'oath_sigil', name: '守誓者徽记', effect: '每副本首次死亡免疫（回 30% 生命）', tag: 'oath' },
    { id: 'oath_chain', name: '誓约之链', effect: '治疗溢出转为护盾（上限 20% 生命）', tag: 'oath' },
    { id: 'hungry_stomach', name: '饥饿之胃', effect: '血球拾取范围 +30%，但治疗量 -15%', tag: 'hunger' },
    { id: 'scavenger_pendant', name: '食腐者吊坠', effect: '击杀精英恢复 10% 生命，普通怪不回', tag: 'hunger' },
];

export const TRINKET_BY_ID: Record<string, TrinketDef> = (() => {
    const out: Record<string, TrinketDef> = {};
    for (const t of TRINKETS) out[t.id] = t;
    return out;
})();

export const TRINKET_TAGS: TrinketTag[] = [
    'blood', 'shadow', 'echo', 'thorn', 'greed',
    'ember', 'frost', 'storm', 'oath', 'hunger',
];

// ==================== 协同（12 条 · 两件饰品同时装备点亮） ====================

export interface SynergyDef {
    id: string;
    name: string;
    a: TrinketTag;
    b: TrinketTag;
    effect: string;
}

export const SYNERGIES: SynergyDef[] = [
    { id: 'bloodfire', name: '血燃', a: 'blood', b: 'ember', effect: '低血时燃烧伤害翻倍' },
    { id: 'shadowecho', name: '影回', a: 'shadow', b: 'echo', effect: '闪避后技能不耗资源' },
    { id: 'thrift', name: '守财', a: 'thorn', b: 'greed', effect: '反弹伤害的 20% 转化为金币' },
    { id: 'icestorm', name: '冰雷', a: 'frost', b: 'storm', effect: '冻结目标被雷击时传导至周围' },
    { id: 'oathblood', name: '誓血', a: 'oath', b: 'blood', effect: '护盾存在时伤害 +15%' },
    { id: 'feast', name: '饕餮', a: 'hunger', b: 'greed', effect: '拾取额外掉落时回血' },
    { id: 'firestorm', name: '雷火', a: 'ember', b: 'storm', effect: '燃烧目标被雷击时点燃周围' },
    { id: 'shadowthorn', name: '影刺', a: 'shadow', b: 'thorn', effect: '背刺伤害 +40%' },
    { id: 'oathreturn', name: '誓回', a: 'echo', b: 'oath', effect: '重置冷却时获得小护盾' },
    { id: 'coldmeal', name: '寒食', a: 'frost', b: 'hunger', effect: '冻结目标死亡掉血球' },
    { id: 'thunderclap', name: '雷音', a: 'storm', b: 'echo', effect: '每 3 次雷击触发一次全屏小伤害' },
    { id: 'bloodfeast', name: '血食', a: 'blood', b: 'hunger', effect: '生命低于 50% 时拾取范围 +80%' },
];

export function synergyPairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export const SYNERGY_BY_KEY: Record<string, SynergyDef> = (() => {
    const out: Record<string, SynergyDef> = {};
    for (const s of SYNERGIES) out[synergyPairKey(s.a, s.b)] = s;
    return out;
})();

/** 传入已装备饰品的 tag 列表，返回点亮的协同（tag 顺序无关，重复 tag 不产生协同） */
export function findSynergies(tags: string[]): SynergyDef[] {
    const out: SynergyDef[] = [];
    for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < tags.length; j++) {
            if (tags[i] === tags[j]) continue;
            const s = SYNERGY_BY_KEY[synergyPairKey(tags[i], tags[j])];
            if (s) out.push(s);
        }
    }
    return out;
}

// ==================== 副本（6 个）与区域首领（3 只） ====================

/** 三套机制解算器：打断 / 转火 / 走位 */
export type MechanicKind = 'interrupt' | 'adds' | 'move';

export interface BossPhaseDef {
    mechanic: MechanicKind;
    name: string;
    desc: string;
}

export interface DungeonDef {
    id: string;
    index: number;
    name: string;
    ilvlMin: number;
    ilvlMax: number;
    bossName: string;
    phases: BossPhaseDef[];
}

export const DUNGEONS: DungeonDef[] = [
    {
        id: 'mine', index: 1, name: '废弃矿坑', ilvlMin: 1, ilvlMax: 10, bossName: '矿坑巨魔',
        phases: [
            { mechanic: 'move', name: '砸地 AoE', desc: '地面预警圈，走出范围' },
            { mechanic: 'adds', name: '召唤矿工', desc: '转火小怪，否则 BOSS 回血' },
            { mechanic: 'interrupt', name: '狂暴读条', desc: '3 秒内打断，否则伤害翻倍' },
        ],
    },
    {
        id: 'chapel', index: 2, name: '腐化教堂', ilvlMin: 10, ilvlMax: 16, bossName: '堕落主教',
        phases: [
            { mechanic: 'adds', name: '治疗图腾', desc: '转火图腾，否则 BOSS 持续回血' },
            { mechanic: 'move', name: '追踪圣光', desc: '追踪光柱，持续走位躲避' },
            { mechanic: 'interrupt', name: '群体忏悔', desc: '读条控制，必须打断' },
        ],
    },
    {
        id: 'tower', index: 3, name: '冰封哨塔', ilvlMin: 16, ilvlMax: 22, bossName: '霜巨人',
        phases: [
            { mechanic: 'move', name: '冰面减速', desc: '地面结冰，限制移动路线' },
            { mechanic: 'move', name: '冰柱落点', desc: '落点预警，连续躲避' },
            { mechanic: 'adds', name: '全屏冰冻', desc: '击碎冰柱解除冻结' },
        ],
    },
    {
        id: 'forge', index: 4, name: '熔火熔炉', ilvlMin: 22, ilvlMax: 28, bossName: '熔炉守卫',
        phases: [
            { mechanic: 'move', name: '火墙推进', desc: '火墙向前推进，找缺口穿过' },
            { mechanic: 'move', name: '熔岩涌泉', desc: '地面喷发点，持续走位' },
            { mechanic: 'interrupt', name: '过载读条', desc: '读条自爆，必须打断' },
        ],
    },
    {
        id: 'shadow', index: 5, name: '暗影回廊', ilvlMin: 28, ilvlMax: 34, bossName: '影刃刺客',
        phases: [
            { mechanic: 'adds', name: '分身', desc: '识别真身，转火错误目标会爆炸' },
            { mechanic: 'move', name: '背刺', desc: '绕背攻击，需要转向应对' },
            { mechanic: 'move', name: '影分身连击', desc: '闪避节奏，连续躲开' },
        ],
    },
    {
        id: 'throne', index: 6, name: '秘银王座', ilvlMin: 34, ilvlMax: 40, bossName: '秘银君王',
        phases: [
            { mechanic: 'interrupt', name: '三系法术轮换', desc: '按顺序打断三系读条' },
            { mechanic: 'move', name: '王座震击', desc: '全场震击，走位躲进安全区' },
            { mechanic: 'move', name: '最终狂暴', desc: 'DPS 检验，狂暴前击杀' },
        ],
    },
];

export const DUNGEON_BY_ID: Record<string, DungeonDef> = (() => {
    const out: Record<string, DungeonDef> = {};
    for (const d of DUNGEONS) out[d.id] = d;
    return out;
})();

export interface RegionBossDef {
    id: string;
    name: string;
    regionId: string;
    phases: BossPhaseDef[];
    /** 必掉品质 + 橙装概率 */
    guaranteed: QualityId;
    legendaryChance: number;
}

export const REGION_BOSSES: RegionBossDef[] = [
    {
        id: 'ash_lord', name: '灰烬领主', regionId: 'ash', guaranteed: 'rare', legendaryChance: 0.15,
        phases: [
            { mechanic: 'move', name: '火焰吐息', desc: '扇形吐息，绕到侧后方' },
            { mechanic: 'adds', name: '召唤火元素', desc: '转火，否则叠加燃烧' },
            { mechanic: 'interrupt', name: '裂隙读条', desc: '打断，否则召唤更多火元素' },
        ],
    },
    {
        id: 'frost_wolf', name: '霜牙狼王', regionId: 'frost', guaranteed: 'epic', legendaryChance: 0.20,
        phases: [
            { mechanic: 'move', name: '扑击', desc: '闪避节奏，连续扑击' },
            { mechanic: 'adds', name: '召唤狼群', desc: '转火狼群，否则被围' },
            { mechanic: 'interrupt', name: '嚎叫读条', desc: '打断，否则全场减速' },
        ],
    },
    {
        id: 'abyss_watcher', name: '深渊守望者', regionId: 'abyss', guaranteed: 'epic', legendaryChance: 0.30,
        phases: [
            { mechanic: 'move', name: '触手横扫', desc: '走位躲开扫击' },
            { mechanic: 'adds', name: '召唤暗影仆从', desc: '转火仆从' },
            { mechanic: 'interrupt', name: '深渊低语读条', desc: '打断，否则持续掉血' },
        ],
    },
];

export const REGION_BOSS_BY_ID: Record<string, RegionBossDef> = (() => {
    const out: Record<string, RegionBossDef> = {};
    for (const b of REGION_BOSSES) out[b.id] = b;
    return out;
})();

// ==================== 区域（3 个 × 12 节点） ====================

export type NodeKind = 'start' | 'battle' | 'elite' | 'chest' | 'event' | 'supply' | 'dungeon' | 'boss';

export interface RegionDef {
    id: string;
    name: string;
    levelMin: number;
    levelMax: number;
    ilvlMin: number;
    ilvlMax: number;
    dungeonIds: string[];
}

export const REGIONS: RegionDef[] = [
    { id: 'ash', name: '灰烬荒原', levelMin: 1, levelMax: 10, ilvlMin: 1, ilvlMax: 12, dungeonIds: ['mine', 'chapel'] },
    { id: 'frost', name: '霜牙峡谷', levelMin: 10, levelMax: 20, ilvlMin: 12, ilvlMax: 26, dungeonIds: ['tower', 'forge'] },
    { id: 'abyss', name: '秘银深渊', levelMin: 20, levelMax: 30, ilvlMin: 26, ilvlMax: 40, dungeonIds: ['shadow', 'throne'] },
];

export const REGION_BY_ID: Record<string, RegionDef> = (() => {
    const out: Record<string, RegionDef> = {};
    for (const r of REGIONS) out[r.id] = r;
    return out;
})();

export const NODE_KIND_NAMES: Record<NodeKind, string> = {
    start: '起点',
    battle: '战斗',
    elite: '精英',
    chest: '宝箱',
    event: '事件',
    supply: '篝火',
    dungeon: '副本入口',
    boss: '区域首领',
};

/** 每次远征 3 点补给；耗尽后每节点扣 8% 最大生命 */
export const SUPPLY_PER_RUN = 3;
export const SUPPLY_EXHAUST_HP_PCT = 0.08;

// ==================== 悬赏（24 条） ====================

export type BountyKind = 'hunt' | 'gather' | 'dungeon' | 'challenge';

export interface BountyDef {
    id: string;
    kind: BountyKind;
    name: string;
    reward: string;
}

export const BOUNTIES: BountyDef[] = [
    { id: 'hunt_mobs', kind: 'hunt', name: '击杀 30 只小怪', reward: '200 金' },
    { id: 'hunt_elites', kind: 'hunt', name: '击杀 6 只精英', reward: '350 金' },
    { id: 'hunt_region_boss', kind: 'hunt', name: '击杀 1 只区域首领', reward: '800 金 + 紫装' },
    { id: 'hunt_no_hit', kind: 'hunt', name: '无伤击杀 1 只精英', reward: '500 金' },
    { id: 'hunt_burst', kind: 'hunt', name: '10 秒内击杀 5 只怪', reward: '400 金' },
    { id: 'hunt_burst_kill', kind: 'hunt', name: '用爆发技能击杀 3 只精英', reward: '600 金' },
    { id: 'gather_ash', kind: 'gather', name: '交出 20 份灰烬', reward: '250 金' },
    { id: 'gather_frost', kind: 'gather', name: '交出 10 份霜晶', reward: '300 金' },
    { id: 'gather_mithril', kind: 'gather', name: '交出 8 份秘银', reward: '400 金' },
    { id: 'gather_blue', kind: 'gather', name: '上交 3 件蓝装', reward: '350 金' },
    { id: 'gather_purple', kind: 'gather', name: '上交 1 件紫装', reward: '700 金 + 材料' },
    { id: 'gather_disassemble', kind: 'gather', name: '分解 10 件装备', reward: '300 金' },
    { id: 'dungeon_1', kind: 'dungeon', name: '通关副本 1', reward: '400 金' },
    { id: 'dungeon_3', kind: 'dungeon', name: '通关副本 3', reward: '600 金' },
    { id: 'dungeon_6', kind: 'dungeon', name: '通关副本 6', reward: '1200 金' },
    { id: 'dungeon_nodeath', kind: 'dungeon', name: '不死亡通关任一副本', reward: '800 金' },
    { id: 'dungeon_speed', kind: 'dungeon', name: '5 分钟内通关副本 2', reward: '700 金' },
    { id: 'dungeon_last_hit', kind: 'dungeon', name: '用单个技能完成副本 BOSS 最后一击', reward: '500 金' },
    { id: 'challenge_white', kind: 'challenge', name: '仅用白装通关副本 1', reward: '600 金' },
    { id: 'challenge_no_trinket', kind: 'challenge', name: '不带饰品通关副本 3', reward: '800 金' },
    { id: 'challenge_low_hp', kind: 'challenge', name: '生命低于 20% 时击杀 10 只怪', reward: '500 金' },
    { id: 'challenge_crit_streak', kind: 'challenge', name: '连续 20 次暴击', reward: '600 金' },
    { id: 'challenge_loot', kind: 'challenge', name: '单次副本拾取 10 件装备', reward: '700 金' },
    { id: 'challenge_full_run', kind: 'challenge', name: '一次远征走完全部 12 节点', reward: '1000 金 + 橙装碎片' },
];

export const BOUNTY_BY_ID: Record<string, BountyDef> = (() => {
    const out: Record<string, BountyDef> = {};
    for (const b of BOUNTIES) out[b.id] = b;
    return out;
})();

// ==================== 玩法身份色（只放十六进制，不 import cc） ====================

export const PAL = {
    player: '#38BDF8',
    enemy: '#F87171',
    mithril: '#5EEAD4',
    ash: '#FB923C',
    abyss: '#C084FC',
    ink: '#2B3550',
    paper: '#FFF9F0',
};

// ==================== 战斗常量 ====================

export const FIXED_DT = 1 / 60;
export const MAX_ENEMIES = 40;
export const MAX_BULLETS = 300;
export const MAX_DROPS = 60;
export const FIELD_W = 720;
export const FIELD_H = 1280;

// ==================== 敌人（M1：废弃矿坑的 5 种） ====================

export type EnemyKind = 'melee' | 'ranged' | 'elite' | 'boss';

export interface EnemyDef {
    id: string;
    name: string;
    kind: EnemyKind;
    hp: number;
    speed: number;
    radius: number;
    contactDamage: number;
    exp: number;
    gold: number;
    /** 远程 / BOSS 投射物 */
    shotCd?: number;
    shotDamage?: number;
    shotSpeed?: number;
    /** 精英砸地 */
    slamCd?: number;
    slamRadius?: number;
    slamDamage?: number;
    slamWarn?: number;
}

/**
 * 数值锚点：1 级战士约 24 DPS。
 * 小怪 2–3 刀、精英约 15 秒、BOSS 约 2 分钟，三遭遇 + BOSS 合计 ≈ 4 分钟。
 */
export const ENEMIES: EnemyDef[] = [
    {
        id: 'imp', name: '矿坑小鬼', kind: 'melee',
        hp: 60, speed: 105, radius: 16, contactDamage: 4, exp: 12, gold: 2,
    },
    {
        id: 'miner', name: '被奴役矿工', kind: 'melee',
        hp: 80, speed: 80, radius: 18, contactDamage: 4, exp: 18, gold: 4,
    },
    {
        id: 'wraith', name: '矿道幽魂', kind: 'ranged',
        hp: 80, speed: 85, radius: 17, contactDamage: 3, exp: 20, gold: 5,
        shotCd: 2.8, shotDamage: 6, shotSpeed: 250,
    },
    {
        id: 'golem', name: '碎石石魔', kind: 'elite',
        hp: 350, speed: 55, radius: 26, contactDamage: 8, exp: 45, gold: 10,
        slamCd: 5, slamRadius: 120, slamDamage: 10, slamWarn: 1.0,
    },
    {
        id: 'troll', name: '矿坑巨魔', kind: 'boss',
        hp: 3000, speed: 52, radius: 44, contactDamage: 6, exp: 400, gold: 120,
        shotCd: 4.2, shotDamage: 6, shotSpeed: 250,
    },

    // ---- 灰烬荒原区域首领（野外 BOSS 节点） ----
    {
        id: 'ash_lord', name: '灰烬领主', kind: 'boss',
        hp: 2600, speed: 55, radius: 42, contactDamage: 8, exp: 450, gold: 140,
        shotCd: 4.0, shotDamage: 9, shotSpeed: 260,
    },

    // ---- 霜牙峡谷（Lv10–20 / ilvl12–26）：更硬、更快、远程伤害更高 ----
    {
        id: 'frost_whelp', name: '霜狼幼崽', kind: 'melee',
        hp: 210, speed: 115, radius: 16, contactDamage: 7, exp: 40, gold: 6,
    },
    {
        id: 'ice_wisp', name: '冰晶之灵', kind: 'ranged',
        hp: 190, speed: 82, radius: 17, contactDamage: 5, exp: 42, gold: 7,
        shotCd: 2.6, shotDamage: 11, shotSpeed: 270,
    },
    {
        id: 'snow_reaver', name: '雪原劫掠者', kind: 'melee',
        hp: 260, speed: 95, radius: 19, contactDamage: 8, exp: 48, gold: 8,
    },
    {
        id: 'ice_golem', name: '冰壳石魔', kind: 'elite',
        hp: 1100, speed: 55, radius: 27, contactDamage: 14, exp: 130, gold: 24,
        slamCd: 5, slamRadius: 125, slamDamage: 18, slamWarn: 1.0,
    },
    {
        id: 'frost_wolf', name: '霜牙狼王', kind: 'boss',
        hp: 7200, speed: 65, radius: 42, contactDamage: 10, exp: 900, gold: 260,
        shotCd: 3.6, shotDamage: 12, shotSpeed: 280,
    },

    // ---- 秘银深渊（Lv20–30 / ilvl26–40） ----
    {
        id: 'abyss_spawn', name: '深渊爬虫', kind: 'melee',
        hp: 520, speed: 110, radius: 17, contactDamage: 12, exp: 85, gold: 12,
    },
    {
        id: 'void_acolyte', name: '虚空侍僧', kind: 'ranged',
        hp: 460, speed: 75, radius: 18, contactDamage: 9, exp: 90, gold: 14,
        shotCd: 2.4, shotDamage: 18, shotSpeed: 300,
    },
    {
        id: 'shade_blade', name: '影刃游魂', kind: 'melee',
        hp: 600, speed: 130, radius: 18, contactDamage: 14, exp: 100, gold: 15,
    },
    {
        id: 'void_horror', name: '虚空恐魔', kind: 'elite',
        hp: 2600, speed: 60, radius: 30, contactDamage: 20, exp: 280, gold: 50,
        slamCd: 4.5, slamRadius: 140, slamDamage: 26, slamWarn: 0.9,
    },
    {
        id: 'abyss_watcher', name: '深渊守望者', kind: 'boss',
        hp: 16000, speed: 58, radius: 46, contactDamage: 18, exp: 1800, gold: 600,
        shotCd: 3.2, shotDamage: 22, shotSpeed: 300,
    },
];

export const ENEMY_BY_ID: Record<string, EnemyDef> = (() => {
    const out: Record<string, EnemyDef> = {};
    for (const e of ENEMIES) out[e.id] = e;
    return out;
})();

// ==================== 副本编排（M1：废弃矿坑） ====================

export interface EncounterSpawn {
    enemyId: string;
    count: number;
}

export interface EncounterDef {
    name: string;
    subtitle: string;
    spawns: EncounterSpawn[];
}

/** 3 个遭遇 + 1 个 BOSS；遭遇之间回 25% 生命，给玩家喘息窗口 */
export const MINE_ENCOUNTERS: EncounterDef[] = [
    {
        name: '矿坑入口', subtitle: '小鬼在矿车之间乱窜',
        spawns: [{ enemyId: 'imp', count: 4 }],
    },
    {
        name: '塌方矿道', subtitle: '碎石堆里有什么在动',
        spawns: [{ enemyId: 'imp', count: 5 }, { enemyId: 'golem', count: 1 }],
    },
    {
        name: '矿脉深处', subtitle: '幽魂的哭声从岩壁里渗出来',
        spawns: [
            { enemyId: 'imp', count: 4 },
            { enemyId: 'wraith', count: 2 },
            { enemyId: 'miner', count: 2 },
        ],
    },
];

export type BossMechanic = 'interrupt' | 'adds' | 'move';

export interface BossPhaseDef {
    mechanic: BossMechanic;
    name: string;
    desc: string;
}

export interface BossScriptDef {
    enemyId: string;
    /** 血线阈值（从高到低），低于即进入下一阶段 */
    thresholds: number[];
    phases: BossPhaseDef[];
    /** 走位：预警圈生成间隔 / 半径 / 伤害 / 预警时长 */
    moveInterval: number;
    moveRadius: number;
    moveDamage: number;
    moveWarn: number;
    /** 转火：召唤间隔 / 每波数量 / BOSS 回血速度 */
    addsInterval: number;
    addsCount: number;
    addsEnemyId: string;
    addsRegen: number;
    /** 打断：读条间隔 / 时长 / 所需伤害 / 失败后的增伤与持续时间 */
    interruptInterval: number;
    interruptCast: number;
    interruptNeed: number;
    enrageBonus: number;
    enrageDuration: number;
}

export const MINE_BOSS_SCRIPT: BossScriptDef = {
    enemyId: 'troll',
    thresholds: [2 / 3, 1 / 3],
    phases: [
        { mechanic: 'move', name: '砸地 AoE', desc: '地面预警圈，走出范围' },
        { mechanic: 'adds', name: '召唤矿工', desc: '转火小怪，否则 BOSS 回血' },
        { mechanic: 'interrupt', name: '狂暴读条', desc: '3 秒内打断，否则伤害翻倍' },
    ],
    moveInterval: 6,
    moveRadius: 130,
    moveDamage: 10,
    moveWarn: 1.1,
    addsInterval: 16,
    addsCount: 2,
    addsEnemyId: 'miner',
    addsRegen: 15,
    interruptInterval: 9,
    interruptCast: 3,
    interruptNeed: 100,
    enrageBonus: 0.5,
    enrageDuration: 10,
};

/** 遭遇之间 / BOSS 入场前的黑场时间（秒） */
export const ENCOUNTER_GAP = 2.2;
export const BOSS_INTRO_GAP = 2.4;
/** 每次遭遇结束恢复最大生命的比例 */
export const ENCOUNTER_HEAL_PCT = 0.25;
/** 每次 BOSS 阶段转换的回血（给三阶段战斗留呼吸窗口） */
export const BOSS_PHASE_HEAL_PCT = 0.2;

// ---- 血球（击杀掉落，补续航；设计 §7.2 的「血球拾取」以此为基） ----
export const ORB_HEAL_PCT = 0.12;
export const ORB_DROP_CHANCE = 0.38;
export const ORB_ADD_DROP_CHANCE = 0.65;
export const ORB_PICKUP_RADIUS = 30;
export const ORB_LIFE = 20;
export const MAX_ORBS = 40;

// ==================== 1 级战士调参（M1 手感基线） ====================

export const PLAYER_TUNING = {
    /** 普攻：90° 扇形 */
    basic: { mult: 1.1, radius: 105, halfAngle: Math.PI / 4, rage: 8, cd: 0.6 },
    /** 冲锋 */
    charge: { mult: 1.3, distance: 220, radius: 55, stun: 0.8, rage: 10, cd: 8 },
    /** 旋风斩：持续 2s，每 0.4s 一跳 */
    whirlwind: { mult: 0.4, radius: 85, cd: 10, duration: 2, tick: 0.4, moveScale: 0.6 },
    /** 破甲：单体 150%，5s 内受到伤害 +20% */
    armorBreak: { mult: 1.5, range: 150, bonus: 0.2, duration: 5, rage: 12, cd: 12 },
    /** 侧步 */
    dodge: { distance: 280, invuln: 0.4, cd: 6 },
    /** 血怒：满怒气清空，10s 增伤 30%，受伤 +15% */
    burst: { rageCost: 100, duration: 10, dmgBonus: 0.3, takenBonus: 0.15, cd: 40 },
    /** 怒气获取：受伤时 */
    rageOnHurt: 10,
    /** 技能每次命中积攒 */
    ragePerHit: 2,
    /** 同一敌人的接触伤害冷却（秒），避免贴脸时每 0.5s 连续掉血 */
    contactCooldown: 0.9,
} as const;

// ==================== 职业战斗套件（M6） ====================

export type ResourceKind = 'rage' | 'mana' | 'energy' | 'holy';

/**
 * 一个技能槽的数值与行为。`act` 决定 Core 里的分派，
 * 其余字段按行为取用；没填的字段表示该行为不关心它。
 */
export interface SkillActDef {
    act: string;
    /** 冷却（秒） */
    cd: number;
    /** 伤害倍率（相对攻击强度） */
    mult?: number;
    /** 资源消耗（主资源） */
    cost?: number;
    /** 圣能消耗（牧师爆发） */
    holyCost?: number;
    /** 命中 / 施放积攒的主资源 */
    gain?: number;
    /** 命中积攒的圣能 */
    holyGain?: number;
    /** 作用半径 */
    radius?: number;
    /** 近战扇形半角 */
    halfAngle?: number;
    /** 位移距离 */
    distance?: number;
    /** 持续时间（旋风斩 / 护盾 / 陷阱） */
    duration?: number;
    /** 旋风的跳伤间隔 */
    tick?: number;
    /** 旋风期间的移速倍率 */
    moveScale?: number;
    /** 投射物速度 */
    speed?: number;
    /** 投射物判定半径 */
    projRadius?: number;
    /** 目标搜索距离（单体技能 / 远程普攻） */
    range?: number;
    /** 治疗比例（最大生命） */
    healPct?: number;
    /** 护盾比例（最大生命） */
    shieldPct?: number;
    /** 冻结 / 眩晕时长 */
    freeze?: number;
    /** 燃烧：每秒伤害占攻击强度的比例 / 持续 */
    burnMult?: number;
    burnDur?: number;
    /** 多重射击的箭数 */
    arrows?: number;
    /** 减速比例 / 时长（陷阱） */
    slowPct?: number;
    slowDur?: number;
    /** 爆发：持续时间 / 增伤 / 受伤惩罚 / 暴击加成 / 射程加成 / 治疗倍率 / 消耗倍率 */
    dmgBonus?: number;
    takenBonus?: number;
    critBonus?: number;
    rangeBonus?: number;
    healMul?: number;
    costMul?: number;
    /** 后跃 / 闪现的方向：'back' 反向、'forward' 面向 */
    dir?: 'back' | 'forward';
    /** 施放后下一击必暴 */
    nextCrit?: boolean;
}

export interface ClassKitDef {
    classId: ClassId;
    resource: ResourceKind;
    resourceName: string;
    /** 主资源上限（统一 100） */
    resourceMax: number;
    /** 每秒回复（法力 / 能量） */
    regen: number;
    /** 移动时的每秒回复（能量站桩更快） */
    moveRegen?: number;
    /** 受击积攒主资源（战士） */
    rageOnHurt?: number;
    /** 圣能上限与来源（牧师） */
    holyMax?: number;
    holyPerHeal?: number;
    basic: SkillActDef;
    a1: SkillActDef;
    a2: SkillActDef;
    a3: SkillActDef;
    dodge: SkillActDef;
    burst: SkillActDef;
}

const WARRIOR_KIT: ClassKitDef = {
    classId: 'warrior',
    resource: 'rage',
    resourceName: '怒气',
    resourceMax: 100,
    regen: 0,
    rageOnHurt: PLAYER_TUNING.rageOnHurt,
    basic: {
        act: 'swing', cd: PLAYER_TUNING.basic.cd, mult: PLAYER_TUNING.basic.mult,
        radius: PLAYER_TUNING.basic.radius, halfAngle: PLAYER_TUNING.basic.halfAngle,
        gain: PLAYER_TUNING.basic.rage,
    },
    a1: {
        act: 'charge', cd: PLAYER_TUNING.charge.cd, mult: PLAYER_TUNING.charge.mult,
        distance: PLAYER_TUNING.charge.distance, radius: PLAYER_TUNING.charge.radius,
        freeze: PLAYER_TUNING.charge.stun, gain: PLAYER_TUNING.charge.rage,
    },
    a2: {
        act: 'whirl', cd: PLAYER_TUNING.whirlwind.cd, mult: PLAYER_TUNING.whirlwind.mult,
        radius: PLAYER_TUNING.whirlwind.radius, duration: PLAYER_TUNING.whirlwind.duration,
        tick: PLAYER_TUNING.whirlwind.tick, moveScale: PLAYER_TUNING.whirlwind.moveScale,
    },
    a3: {
        act: 'break', cd: PLAYER_TUNING.armorBreak.cd, mult: PLAYER_TUNING.armorBreak.mult,
        range: PLAYER_TUNING.armorBreak.range, duration: PLAYER_TUNING.armorBreak.duration,
        gain: PLAYER_TUNING.armorBreak.rage,
    },
    dodge: {
        act: 'dash', cd: PLAYER_TUNING.dodge.cd, distance: PLAYER_TUNING.dodge.distance,
    },
    burst: {
        act: 'rage', cd: PLAYER_TUNING.burst.cd, cost: PLAYER_TUNING.burst.rageCost,
        duration: PLAYER_TUNING.burst.duration, dmgBonus: PLAYER_TUNING.burst.dmgBonus,
        takenBonus: PLAYER_TUNING.burst.takenBonus,
    },
};

const MAGE_KIT: ClassKitDef = {
    classId: 'mage',
    resource: 'mana',
    resourceName: '法力',
    resourceMax: 100,
    regen: 7,
    basic: { act: 'bolt', cd: 1.2, mult: 1.0, speed: 520, projRadius: 7, range: 560 },
    a1: {
        act: 'fireball', cd: 6, mult: 1.2, cost: 25, speed: 430, projRadius: 9, range: 560,
        burnMult: 0.3, burnDur: 3,
    },
    a2: {
        act: 'novaFreeze', cd: 12, mult: 0.5, cost: 35, radius: 120, freeze: 1.5,
    },
    a3: { act: 'blink', cd: 8, cost: 20, distance: 250, dir: 'forward' },
    dodge: {
        act: 'barrier', cd: 10, cost: 15, shieldPct: 0.15, duration: 2, freeze: 0.3,
    },
    burst: {
        act: 'arcane', cd: 45, cost: 40, duration: 8, dmgBonus: 0.4, costMul: 2,
    },
};

const RANGER_KIT: ClassKitDef = {
    classId: 'ranger',
    resource: 'energy',
    resourceName: '能量',
    resourceMax: 100,
    regen: 14,
    moveRegen: 6,
    basic: { act: 'bolt', cd: 0.9, mult: 0.95, speed: 620, projRadius: 6, range: 620 },
    a1: {
        act: 'volley', cd: 5, mult: 0.6, cost: 30, arrows: 5, halfAngle: 0.34,
        speed: 560, projRadius: 6, range: 620,
    },
    a2: {
        act: 'trap', cd: 10, cost: 25, radius: 95, duration: 8, slowPct: 0.5, slowDur: 3,
    },
    a3: { act: 'backjump', cd: 7, cost: 20, distance: 200, dir: 'back', nextCrit: true },
    dodge: { act: 'dash', cd: 5, cost: 15, distance: 300, freeze: 0.4 },
    burst: {
        act: 'hawk', cd: 40, cost: 40, duration: 6, critBonus: 0.3, rangeBonus: 0.4,
    },
};

const PRIEST_KIT: ClassKitDef = {
    classId: 'priest',
    resource: 'holy',
    resourceName: '法力',
    resourceMax: 100,
    regen: 6,
    holyMax: 100,
    holyPerHeal: 20,
    basic: { act: 'bolt', cd: 1.0, mult: 0.85, speed: 520, projRadius: 7, range: 520, holyGain: 5 },
    a1: { act: 'heal', cd: 8, cost: 30, healPct: 0.25 },
    a2: { act: 'novaHeal', cd: 10, mult: 0.8, cost: 35, radius: 150, healPct: 0.05 },
    a3: { act: 'shield', cd: 14, cost: 30, shieldPct: 0.2, duration: 6 },
    dodge: { act: 'blink', cd: 6, cost: 15, distance: 200, freeze: 0.5, dir: 'back' },
    burst: {
        act: 'holy', cd: 50, holyCost: 100, duration: 8, dmgBonus: 0.35, healMul: 2,
    },
};

export const CLASS_KITS: Record<ClassId, ClassKitDef> = {
    warrior: WARRIOR_KIT,
    mage: MAGE_KIT,
    ranger: RANGER_KIT,
    priest: PRIEST_KIT,
};

/** 玩家投射物颜色（渲染层按职业上色，避免和敌方弹幕混淆） */
export const CLASS_PROJECTILE_COLOR: Record<ClassId, string> = {
    warrior: '#F59E0B',
    mage: '#60A5FA',
    ranger: '#34D399',
    priest: '#FBBF24',
};

// ==================== 野外材料（每区域一种；悬赏 / 营地消耗入口） ====================

export interface MaterialDef {
    id: string;
    name: string;
    regionId: string;
}

export const MATERIALS: MaterialDef[] = [
    { id: 'ash_dust', name: '灰烬', regionId: 'ash' },
    { id: 'frost_crystal', name: '霜晶', regionId: 'frost' },
    { id: 'mithril_ore', name: '秘银', regionId: 'abyss' },
];

export const MATERIAL_BY_ID: Record<string, MaterialDef> = (() => {
    const out: Record<string, MaterialDef> = {};
    for (const m of MATERIALS) out[m.id] = m;
    return out;
})();

/** 区域 → 材料 id（未知区域回落到第一种，调用方不必判空） */
export function regionMaterialId(regionId: string): string {
    for (const m of MATERIALS) if (m.regionId === regionId) return m.id;
    return MATERIALS[0].id;
}

export function materialName(id: string): string {
    const m = MATERIAL_BY_ID[id];
    return m ? m.name : id;
}

// ==================== 区域敌人池（野外节点按区域取怪） ====================

export interface RegionEnemyPool {
    /** 普通怪：第 1 个偏近战、第 2 个偏远程、第 3 个偏快速 */
    mobs: string[];
    elite: string;
    /** 区域 BOSS，与 REGION_BOSSES 的 id 一致 */
    boss: string;
}

export const REGION_ENEMY_POOLS: Record<string, RegionEnemyPool> = {
    ash: { mobs: ['imp', 'miner', 'wraith'], elite: 'golem', boss: 'ash_lord' },
    frost: { mobs: ['frost_whelp', 'ice_wisp', 'snow_reaver'], elite: 'ice_golem', boss: 'frost_wolf' },
    abyss: { mobs: ['abyss_spawn', 'void_acolyte', 'shade_blade'], elite: 'void_horror', boss: 'abyss_watcher' },
};

// ==================== 野外节点奖励 / 补给风险 ====================

export interface WildRewardDef {
    matsMin: number;
    matsMax: number;
    /** 掉装备概率（BOSS 走 RegionBossDef 的必掉 + 橙装概率，这里为 0） */
    gearChance: number;
    gearMinQuality: QualityId;
}

export const WILD_REWARDS: Record<'battle' | 'elite' | 'boss', WildRewardDef> = {
    battle: { matsMin: 1, matsMax: 2, gearChance: 0.25, gearMinQuality: 'uncommon' },
    elite: { matsMin: 2, matsMax: 3, gearChance: 1, gearMinQuality: 'uncommon' },
    boss: { matsMin: 3, matsMax: 5, gearChance: 0, gearMinQuality: 'rare' },
};

/** 每层节点数：起点 + 4 层（2/3/3/2）+ BOSS = 12 节点（设计 §4） */
export const WILD_LAYERS: number[] = [1, 2, 3, 3, 2, 1];
export const WILD_NODE_COUNT = 12;

/** 篝火（首次访问）：恢复最大生命 40%，不补充补给 */
export const WILD_SUPPLY_HEAL_PCT = 0.4;
/** 宝箱陷阱：25% 概率，扣最大生命 15% */
export const WILD_CHEST_TRAP_CHANCE = 0.25;
export const WILD_CHEST_TRAP_HP_PCT = 0.15;
/** 无陷阱宝箱额外给的金币（装备之外的小彩头） */
export const WILD_CHEST_GOLD = 30;
/** 事件三选一：包扎回血 / 搜刮材料 / 冒险深挖（材料更多但掉血） */
export const WILD_EVENT_HEAL_PCT = 0.25;
export const WILD_EVENT_MATERIALS = 2;
export const WILD_EVENT_RISK_MATERIALS = 3;
export const WILD_EVENT_RISK_HP_PCT = 0.1;

// ==================== 营地（M5）：5 设施 / 料理 / 重铸与附魔 ====================

/** 设施 id（存档 `facilities` 的键；顺序即页签顺序） */
export const FACILITY_IDS = ['smith', 'enchant', 'training', 'kitchen', 'quartermaster'] as const;
export type FacilityId = (typeof FACILITY_IDS)[number];

export const FACILITY_MAX_LEVEL = 5;

export interface FacilityCostDef {
    materialId: string;
    count: number;
}

export interface FacilityDef {
    id: FacilityId;
    name: string;
    /** 页签下方的一句话功能说明 */
    summary: string;
    /** effects[i] = 升到 (i+1) 级的效果；升到 1 级即「解锁」 */
    effects: string[];
    /** costs[i] = 从 i 级升到 i+1 级的材料（设施升级只用材料，设计 §4.6） */
    costs: FacilityCostDef[];
}

/**
 * 升级材料按区域递进：1–2 级吃灰烬、3–4 级吃霜晶、5 级吃秘银。
 * 这样营地的成长节奏自动绑在「野外推进到哪个区域」上，不需要额外的前置条件。
 */
export const FACILITIES: FacilityDef[] = [
    {
        id: 'smith',
        name: '铁匠铺',
        summary: '重铸词条 / 分解装备',
        effects: [
            '解锁重铸：花金币重掷未锁定的词条',
            '重铸可锁定 1 条词条',
            '重铸可锁定 2 条词条',
            '重铸费用 −25%',
            '重铸费用 −50%',
        ],
        costs: [
            { materialId: 'ash_dust', count: 4 },
            { materialId: 'ash_dust', count: 10 },
            { materialId: 'frost_crystal', count: 8 },
            { materialId: 'frost_crystal', count: 16 },
            { materialId: 'mithril_ore', count: 12 },
        ],
    },
    {
        id: 'enchant',
        name: '附魔台',
        summary: '把一条词条转移到另一件装备',
        effects: [
            '解锁附魔：转移 1 条词条（源装备被消耗）',
            '一次可转移 2 条词条',
            '保留源装备：只移除被转移的词条',
            '附魔材料减半',
            '目标词条不再受品质条数限制（最多 4 条）',
        ],
        costs: [
            { materialId: 'ash_dust', count: 4 },
            { materialId: 'ash_dust', count: 10 },
            { materialId: 'frost_crystal', count: 8 },
            { materialId: 'frost_crystal', count: 16 },
            { materialId: 'mithril_ore', count: 12 },
        ],
    },
    {
        id: 'training',
        name: '训练场',
        summary: '重置天赋 / 重置技能变体 / 保存天赋方案',
        effects: [
            '解锁洗点：天赋 200 金、变体 500 金',
            '洗点半价（100 / 250 金）',
            '洗点免费',
            '解锁天赋方案 A（保存 / 载入）',
            '解锁天赋方案 B',
        ],
        costs: [
            { materialId: 'ash_dust', count: 4 },
            { materialId: 'ash_dust', count: 10 },
            { materialId: 'frost_crystal', count: 8 },
            { materialId: 'frost_crystal', count: 16 },
            { materialId: 'mithril_ore', count: 12 },
        ],
    },
    {
        id: 'kitchen',
        name: '厨房',
        summary: '开战前吃料理，按场次生效',
        effects: [
            '解锁 3 种料理',
            '解锁全部 5 种料理',
            '可同时生效 2 种料理',
            '料理效果 +50%',
            '料理持续 3 场战斗（默认 1 场）',
        ],
        costs: [
            { materialId: 'ash_dust', count: 4 },
            { materialId: 'ash_dust', count: 10 },
            { materialId: 'frost_crystal', count: 8 },
            { materialId: 'frost_crystal', count: 16 },
            { materialId: 'mithril_ore', count: 12 },
        ],
    },
    {
        id: 'quartermaster',
        name: '军需官',
        summary: '装备仓库扩容 / 悬赏位',
        effects: [
            '装备仓库 +6 格',
            '仓库共 +12 格，悬赏位 3→6',
            '仓库共 +18 格',
            '仓库共 +24 格',
            '仓库共 +30 格',
        ],
        costs: [
            { materialId: 'ash_dust', count: 4 },
            { materialId: 'ash_dust', count: 10 },
            { materialId: 'frost_crystal', count: 8 },
            { materialId: 'frost_crystal', count: 16 },
            { materialId: 'mithril_ore', count: 12 },
        ],
    },
];

export const FACILITY_BY_ID: Record<FacilityId, FacilityDef> = (() => {
    const out = {} as Record<FacilityId, FacilityDef>;
    for (const def of FACILITIES) out[def.id] = def;
    return out;
})();

// ---- 铁匠铺：重铸 ----

export const REFORGE_GOLD_BASE = 40;
export const REFORGE_GOLD_PER_ILVL = 6;
/** 每锁一条词条，费用 +40% */
export const REFORGE_LOCK_MUL = 0.4;
/** 可锁条数按设施等级：Lv2 → 1、Lv3 → 2 */
export const REFORGE_LOCK_LEVELS: readonly number[] = [2, 3];
export const REFORGE_DISCOUNT: Record<number, number> = { 4: 0.75, 5: 0.5 };

// ---- 附魔台：词条转移 ----

export const ENCHANT_GOLD = 80;
/** 目标词条数上限（Lv5 之前受品质条数限制；硬上限 4 条） */
export const ENCHANT_HARD_AFFIX_CAP = 4;
/** Lv2 起一次可转移 2 条 */
export const ENCHANT_MAX_TRANSFER_LEVEL: readonly number[] = [2];
export const ENCHANT_MATERIAL_COUNT = 2;

// ---- 分解 ----

export const DISMANTLE_BASE = 1;
/** 每高一档品质多给 1 份材料 */
export const DISMANTLE_PER_QUALITY = 1;
/** 每 15 装等多给 1 份材料 */
export const DISMANTLE_ILVL_STEP = 15;

// ---- 训练场 ----

/** 洗点价格档位：Lv2 半价、Lv3 免费（与 FACILITIES.training.effects 一致） */
export const TRAINING_HALF_PRICE_LEVEL = 2;
export const TRAINING_FREE_LEVEL = 3;
/** 天赋方案槽：Lv4 解锁第 1 个、Lv5 解锁第 2 个 */
export const TALENT_PRESET_LEVEL = 4;
export const TALENT_PRESET_SECOND_LEVEL = 5;

// ---- 厨房 ----

export type MealStat = 'ap' | 'hp' | 'haste' | 'crit' | 'vers';

export interface MealDef {
    id: string;
    name: string;
    desc: string;
    gold: number;
    materialId: string;
    materialCount: number;
    /** 1 = 厨房 1 级可做；2 = 厨房 2 级起 */
    tier: 1 | 2;
    stat: MealStat;
    /** 效果百分比（0.10 = +10%） */
    pct: number;
}

export const MEALS: MealDef[] = [
    {
        id: 'pot_roast', name: '力量炖锅', desc: '攻击强度 +10%',
        gold: 40, materialId: 'ash_dust', materialCount: 1, tier: 1, stat: 'ap', pct: 0.10,
    },
    {
        id: 'swift_soup', name: '迅捷浓汤', desc: '急速 +8%',
        gold: 40, materialId: 'ash_dust', materialCount: 1, tier: 1, stat: 'haste', pct: 0.08,
    },
    {
        id: 'iron_bread', name: '铁皮面包', desc: '生命上限 +12%',
        gold: 50, materialId: 'ash_dust', materialCount: 2, tier: 1, stat: 'hp', pct: 0.12,
    },
    {
        id: 'honey_wings', name: '蜜酒烤翅', desc: '暴击 +5%',
        gold: 80, materialId: 'frost_crystal', materialCount: 1, tier: 2, stat: 'crit', pct: 0.05,
    },
    {
        id: 'mithril_broth', name: '秘银浓汤', desc: '全能 +5%',
        gold: 80, materialId: 'frost_crystal', materialCount: 1, tier: 2, stat: 'vers', pct: 0.05,
    },
];

export const MEAL_BY_ID: Record<string, MealDef> = (() => {
    const out: Record<string, MealDef> = {};
    for (const m of MEALS) out[m.id] = m;
    return out;
})();

/** 厨房 Lv3 起可同时生效 2 种料理 */
export const KITCHEN_SECOND_SLOT_LEVEL = 3;
/** 厨房 Lv4 起料理效果 ×1.5（原设计的「团队 buff」在单机改为自身强化） */
export const KITCHEN_BONUS_LEVEL = 4;
export const KITCHEN_BONUS_MUL = 1.5;
/** 厨房 Lv5 起料理持续 3 场战斗 */
export const KITCHEN_DURATION_LEVEL = 5;
export const KITCHEN_DURATION_RUNS = 3;

// ---- 军需官 ----

/** 每级仓库扩容格数 */
export const QUARTERMASTER_SLOTS_PER_LEVEL = 6;
/** 悬赏位：默认 3，军需官 Lv2 起 6（悬赏本体在 M8） */
export const BOUNTY_SLOTS_BASE = 3;
export const BOUNTY_SLOTS_UPGRADED = 6;
export const BOUNTY_SLOTS_LEVEL = 2;

// ==================== 一局战斗的计划（副本与野外共用） ====================

export type RunKind = 'dungeon' | 'wild';

/**
 * 战斗流程图：Core 只认这个结构，副本与野外节点都编译成 RunPlan。
 * `encounters` 为空表示直接进 BOSS（野外 BOSS 节点）；`boss` 为空表示打完遭遇即结束
 * （野外普通 / 精英节点）。
 */
export interface RunPlan {
    kind: RunKind;
    /** 副本 id / 野外节点标识（日志与结算分支用） */
    id: string;
    name: string;
    encounters: EncounterDef[];
    /** 每次遭遇清空后恢复最大生命的比例 */
    healPct: number;
    boss: BossScriptDef | null;
    bossTitle: string;
    bossHint: string;
    /** 遭遇敌人血量倍率（野外节点等级越高越硬） */
    scale: number;
    bossScale: number;
    /** 结算掉落装等 */
    ilvl: number;
}

/** 已实现战斗编排的副本；M4 只有废弃矿坑，M6 补齐其余 5 个 */
export function dungeonRunPlan(dungeonId: string): RunPlan | null {
    const def = DUNGEON_BY_ID[dungeonId];
    if (!def) return null;
    if (dungeonId === 'mine') {
        return {
            kind: 'dungeon',
            id: 'mine',
            name: def.name,
            encounters: MINE_ENCOUNTERS,
            healPct: ENCOUNTER_HEAL_PCT,
            boss: MINE_BOSS_SCRIPT,
            bossTitle: def.bossName,
            bossHint: '走位躲砸地 · 转火矿工 · 打断狂暴读条',
            scale: 1,
            bossScale: 1,
            ilvl: def.ilvlMax,
        };
    }
    return null;
}

export function implementedDungeonIds(): string[] {
    const out: string[] = [];
    for (const d of DUNGEONS) if (dungeonRunPlan(d.id)) out.push(d.id);
    return out;
}

// ==================== 区域 BOSS 脚本（按区域调参；机制取自 REGION_BOSSES） ====================

export interface RegionBossTuning {
    moveInterval: number;
    moveRadius: number;
    moveDamage: number;
    moveWarn: number;
    addsInterval: number;
    addsCount: number;
    addsEnemyId: string;
    addsRegen: number;
    interruptInterval: number;
    interruptCast: number;
    interruptNeed: number;
    enrageBonus: number;
    enrageDuration: number;
}

export const REGION_BOSS_TUNING: Record<string, RegionBossTuning> = {
    ash_lord: {
        moveInterval: 6, moveRadius: 130, moveDamage: 10, moveWarn: 1.1,
        addsInterval: 16, addsCount: 2, addsEnemyId: 'imp', addsRegen: 15,
        interruptInterval: 9, interruptCast: 3, interruptNeed: 100,
        enrageBonus: 0.5, enrageDuration: 10,
    },
    frost_wolf: {
        moveInterval: 5.2, moveRadius: 150, moveDamage: 18, moveWarn: 0.95,
        addsInterval: 14, addsCount: 3, addsEnemyId: 'frost_whelp', addsRegen: 40,
        interruptInterval: 8.5, interruptCast: 3, interruptNeed: 260,
        enrageBonus: 0.6, enrageDuration: 10,
    },
    abyss_watcher: {
        moveInterval: 4.6, moveRadius: 165, moveDamage: 24, moveWarn: 0.85,
        addsInterval: 12, addsCount: 4, addsEnemyId: 'abyss_spawn', addsRegen: 90,
        interruptInterval: 8, interruptCast: 2.8, interruptNeed: 600,
        enrageBonus: 0.7, enrageDuration: 12,
    },
};

export function regionBossScript(bossId: string): BossScriptDef | null {
    const def = REGION_BOSS_BY_ID[bossId];
    const tune = REGION_BOSS_TUNING[bossId];
    if (!def || !tune) return null;
    return {
        enemyId: def.id,
        thresholds: [2 / 3, 1 / 3],
        phases: def.phases.map((p) => ({ mechanic: p.mechanic, name: p.name, desc: p.desc })),
        moveInterval: tune.moveInterval,
        moveRadius: tune.moveRadius,
        moveDamage: tune.moveDamage,
        moveWarn: tune.moveWarn,
        addsInterval: tune.addsInterval,
        addsCount: tune.addsCount,
        addsEnemyId: tune.addsEnemyId,
        addsRegen: tune.addsRegen,
        interruptInterval: tune.interruptInterval,
        interruptCast: tune.interruptCast,
        interruptNeed: tune.interruptNeed,
        enrageBonus: tune.enrageBonus,
        enrageDuration: tune.enrageDuration,
    };
}
