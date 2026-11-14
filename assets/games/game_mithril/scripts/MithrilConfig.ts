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

export const SKILLS: SkillDef[] = [
    // 战士（怒气）
    s('warrior', 'basic', 'basic', '劈砍', 0.6, '90° 扇形，110% 攻击，积 8 怒气'),
    s('warrior', 'a1', 'active', '冲锋', 8, '突进 220px，命中眩晕 0.8s'),
    s('warrior', 'a2', 'active', '旋风斩', 10, '旋转 2s，每 0.4s 40% 攻击'),
    s('warrior', 'a3', 'active', '破甲', 12, '单体 150%，减甲 20% 持续 5s'),
    s('warrior', 'dodge', 'dodge', '侧步', 6, '位移 280px，0.4s 无敌'),
    s('warrior', 'burst', 'burst', '血怒', 40, '10s 伤害 +30%、受伤 +15%，清空怒气'),
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
        [seed('精准', '命中 +2%'), seed('压制', '减甲 +3%')],
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
    supply: '补给站',
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
