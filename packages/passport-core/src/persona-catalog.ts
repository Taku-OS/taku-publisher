export const PERSONA_PROFILE_SCHEMA_VERSION = 'taku.persona-profile.v1' as const;

export const PERSONA_LOCALES = ['en-US', 'zh-CN'] as const;
export type PersonaLocale = (typeof PERSONA_LOCALES)[number];

export const PERSONA_CODES = [
  'AMLH',
  'AMLW',
  'AMOH',
  'AMOW',
  'AILH',
  'AILW',
  'AIOH',
  'AIOW',
  'EMLH',
  'EMLW',
  'EMOH',
  'EMOW',
  'EILH',
  'EILW',
  'EIOH',
  'EIOW',
] as const;

export type PersonaCode = (typeof PERSONA_CODES)[number];
export type PersonaFamilyId =
  | 'architect'
  | 'craftsman'
  | 'hacker'
  | 'vibe-maker';

export interface PersonaLocalizedCopy {
  title: string;
  subtitle: string;
  description: string;
}

export interface PersonaCatalogEntry {
  id: string;
  code: PersonaCode;
  family: PersonaFamilyId;
  avatarKey: string;
  localizations: Record<PersonaLocale, PersonaLocalizedCopy>;
}

type PersonaCopySource = {
  title: string;
  enSubtitle: string;
  enDescription: string;
  zhSubtitle: string;
  zhDescription: string;
};

const BASE_PERSONA_COPY: Record<PersonaCode, PersonaCopySource> = {
  AMLH: {
    title: 'UI Maxxer',
    enSubtitle: 'Interface Perfectionist',
    enDescription: 'Pixel-perfect polish. Aliasing is not tolerated.',
    zhSubtitle: '界面狂魔',
    zhDescription: '像素级抛光，绝不容忍 aliasing',
  },
  AMLW: {
    title: 'Indie Sigma',
    enSubtitle: 'Independent Builder',
    enDescription: 'My stack stays uncontaminated by anyone else’s choices.',
    zhSubtitle: '独立σ',
    zhDescription: '我的栈不带任何人的污染',
  },
  AMOH: {
    title: '3AM Aesthete',
    enSubtitle: 'After-hours Tastemaker',
    enDescription: 'The night is deep, but the taste stays sharp.',
    zhSubtitle: '凌晨三点品味家',
    zhDescription: '夜深，但品味在线',
  },
  AMOW: {
    title: 'Vampire Crafter',
    enSubtitle: 'Nocturnal Artisan',
    enDescription: 'Avoids daylight. Ships exquisitely crafted work.',
    zhSubtitle: '吸血鬼匠人',
    zhDescription: '见光死，但作品超精致',
  },
  AILH: {
    title: 'Automation Maxxer',
    enSubtitle: 'Systems Automator',
    enDescription: 'I make the world run by itself.',
    zhSubtitle: '自动化狂魔',
    zhDescription: '我让世界自己跑',
  },
  AILW: {
    title: 'Daemon Daddy',
    enSubtitle: 'Process Keeper',
    enDescription: 'My scripts are my children.',
    zhSubtitle: '守护进程老爹',
    zhDescription: '我的脚本，我的儿女',
  },
  AIOH: {
    title: 'Sleepless Sigma',
    enSubtitle: 'Midnight Orchestrator',
    enDescription: 'At 3 a.m., everything is still under orchestration.',
    zhSubtitle: '不眠σ',
    zhDescription: '凌晨三点调度万物',
  },
  AIOW: {
    title: 'Doomer Daemon',
    enSubtitle: 'Lone Automator',
    enDescription: 'One builder awake at midnight; everything else automated.',
    zhSubtitle: 'Doomer 守护神',
    zhDescription: '凌晨一人，万物自动',
  },
  EMLH: {
    title: 'Slop Master',
    enSubtitle: 'Rapid Prototyper',
    enDescription: 'Whether it works or not, build twelve versions first.',
    zhSubtitle: 'Slop 大师',
    zhDescription: '管它好不好用，先做 12 个',
  },
  EMLW: {
    title: 'Vibe Goblin',
    enSubtitle: 'Instinctive Shipper',
    enDescription: 'Think it, ship it, fix the bugs later.',
    zhSubtitle: 'Vibe 地精',
    zhDescription: '想到就上线，bug 以后再说',
  },
  EMOH: {
    title: 'Brainrotter',
    enSubtitle: 'Tool-fueled Night Owl',
    enDescription: 'It is 4 a.m. and seven more tools just appeared.',
    zhSubtitle: '脑腐患者',
    zhDescription: '凌晨四点又装了 7 个工具',
  },
  EMOW: {
    title: 'Vampire Vibecoder',
    enSubtitle: 'Nocturnal Vibe Builder',
    enDescription: 'The deeper the night, the stronger the inspiration.',
    zhSubtitle: '吸血鬼 vibe coder',
    zhDescription: '夜越深，灵感越涌',
  },
  EILH: {
    title: 'Mad Scientist',
    enSubtitle: 'Experimental Systems Hacker',
    enDescription: 'I built the pipeline, and even I do not fully understand it.',
    zhSubtitle: '疯狂科学家',
    zhDescription: '我搭的管道我自己都不懂',
  },
  EILW: {
    title: 'Mad Inventor',
    enSubtitle: 'Serial Toolmaker',
    enDescription: 'Finish one wheel, then immediately invent the next.',
    zhSubtitle: '疯狂发明家',
    zhDescription: '造完轮子继续造下一个',
  },
  EIOH: {
    title: 'Chaos Engineer',
    enSubtitle: 'Systems Improviser',
    enDescription: 'Build a working system out of pure chaos.',
    zhSubtitle: '混沌工程师',
    zhDescription: '在混乱里搭出能跑的系统',
  },
  EIOW: {
    title: 'Night Hacker',
    enSubtitle: 'After-dark Toolsmith',
    enDescription: 'The toolchain only truly wakes after midnight.',
    zhSubtitle: '暗夜黑客',
    zhDescription: '夜深之后，工具链才真正醒来',
  },
};

export const PERSONA_FAMILY_LOCALIZATIONS: Record<
  PersonaFamilyId,
  Record<PersonaLocale, string>
> = {
  architect: { 'en-US': 'Architect', 'zh-CN': '架构师' },
  craftsman: { 'en-US': 'Craftsman', 'zh-CN': '匠人' },
  hacker: { 'en-US': 'Hacker', 'zh-CN': '黑客' },
  'vibe-maker': { 'en-US': 'Vibe Maker', 'zh-CN': '氛围创造者' },
};

export const PERSONA_CATALOG: Record<PersonaCode, PersonaCatalogEntry> =
  Object.fromEntries(
    PERSONA_CODES.map((code) => {
      const copy = BASE_PERSONA_COPY[code];
      return [
        code,
        {
          id: code.toLowerCase(),
          code,
          family: personaFamilyForCode(code),
          avatarKey: `persona.base.${code}`,
          localizations: {
            'en-US': {
              title: copy.title,
              subtitle: copy.enSubtitle,
              description: copy.enDescription,
            },
            'zh-CN': {
              title: copy.title,
              subtitle: copy.zhSubtitle,
              description: copy.zhDescription,
            },
          },
        },
      ];
    }),
  ) as Record<PersonaCode, PersonaCatalogEntry>;

export const ROOKIE_PERSONA_LOCALIZATIONS: Record<
  PersonaLocale,
  PersonaLocalizedCopy
> = {
  'en-US': {
    title: 'The Rookie',
    subtitle: 'New AI Builder',
    description: 'Start creating first. Let your activity define you over time.',
  },
  'zh-CN': {
    title: 'The Rookie',
    subtitle: '新手创作者',
    description: '先开始创造，再让数据定义你',
  },
};

export interface PersonaAxisTag {
  axis: 'build' | 'make' | 'schedule' | 'tools';
  letter: string;
  id: string;
  localizations: Record<PersonaLocale, string>;
}

const AXIS_TAGS: Record<string, PersonaAxisTag> = {
  A: {
    axis: 'build',
    letter: 'A',
    id: 'plans-first',
    localizations: { 'en-US': 'Plans first', 'zh-CN': '规划优先' },
  },
  E: {
    axis: 'build',
    letter: 'E',
    id: 'ships-fast',
    localizations: { 'en-US': 'Ships fast', 'zh-CN': '快速发布' },
  },
  M: {
    axis: 'make',
    letter: 'M',
    id: 'maker',
    localizations: { 'en-US': 'Maker', 'zh-CN': '产品创造者' },
  },
  I: {
    axis: 'make',
    letter: 'I',
    id: 'infra',
    localizations: { 'en-US': 'Infra', 'zh-CN': '基础设施' },
  },
  L: {
    axis: 'schedule',
    letter: 'L',
    id: 'early-bird',
    localizations: { 'en-US': 'Early bird', 'zh-CN': '早起型' },
  },
  O: {
    axis: 'schedule',
    letter: 'O',
    id: 'night-owl',
    localizations: { 'en-US': 'Night owl', 'zh-CN': '夜猫子' },
  },
  H: {
    axis: 'tools',
    letter: 'H',
    id: 'tool-hoarder',
    localizations: { 'en-US': 'Tool hoarder', 'zh-CN': '工具收藏家' },
  },
  W: {
    axis: 'tools',
    letter: 'W',
    id: 'lone-wolf',
    localizations: { 'en-US': 'Lone wolf', 'zh-CN': '独行者' },
  },
};

export const PERSONA_TRAIT_AVATAR_KEYS: Record<string, string> = {
  'beta-tester': 'persona.trait.beta-tester',
  'grateful-coder': 'persona.trait.grateful-coder',
  polyglot: 'persona.trait.polyglot',
  'private-coder': 'persona.trait.private-coder',
  'prompt-wizard': 'persona.trait.prompt-wizard',
  'speed-demon': 'persona.trait.speed-demon',
  'token-tycoon': 'persona.trait.token-tycoon',
  'tool-hoarder': 'persona.trait.tool-hoarder',
};

export const PERSONA_HIDDEN_AVATAR_KEYS: Record<string, string> = {
  architect: 'persona.hidden.architect',
  oracle: 'persona.hidden.oracle',
  demiurge: 'persona.hidden.demiurge',
  sovereign: 'persona.hidden.sovereign',
  'insomniac-daywalker': 'persona.hidden.insomniac-daywalker',
  'schrodingers-coder': 'persona.hidden.schrodingers-coder',
  phantom: 'persona.hidden.phantom',
  polymath: 'persona.hidden.polymath',
};

export const PERSONA_BADGE_LOCALIZATIONS: Record<
  string,
  Record<PersonaLocale, string>
> = {
  'token-tycoon': { 'en-US': 'Token Tycoon', 'zh-CN': 'Token 大亨' },
  'flow-state': { 'en-US': 'Flow State', 'zh-CN': '心流状态' },
  'dice-roller': { 'en-US': 'Dice Roller', 'zh-CN': '骰子玩家' },
  'iteration-freak': { 'en-US': 'Iteration Freak', 'zh-CN': '迭代狂人' },
  're-architect': { 'en-US': 'Re-Architect', 'zh-CN': '重构架构师' },
  'self-reflector': { 'en-US': 'Self-Reflector', 'zh-CN': '自省者' },
  polyglot: { 'en-US': 'Polyglot', 'zh-CN': '多语言玩家' },
  'private-coder': { 'en-US': 'Private Coder', 'zh-CN': '隐秘开发者' },
  'prompt-wizard': { 'en-US': 'Prompt Wizard', 'zh-CN': '提示词巫师' },
  'speed-demon': { 'en-US': 'Speed Demon', 'zh-CN': '极速恶魔' },
  'tool-hoarder': { 'en-US': 'Tool Hoarder', 'zh-CN': '工具收藏家' },
  'beta-tester': { 'en-US': 'Beta Tester', 'zh-CN': '测试先锋' },
};

export function normalizePersonaLocale(value: unknown): PersonaLocale {
  return String(value || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function isPersonaCode(value: unknown): value is PersonaCode {
  return PERSONA_CODES.includes(String(value || '').toUpperCase() as PersonaCode);
}

export function personaFamilyForCode(codeValue: unknown): PersonaFamilyId {
  const prefix = String(codeValue || '').toUpperCase().slice(0, 2);
  if (prefix === 'AI') return 'architect';
  if (prefix === 'AM') return 'craftsman';
  if (prefix === 'EI') return 'hacker';
  return 'vibe-maker';
}

export function personaAxisTagsForCode(codeValue: unknown): PersonaAxisTag[] {
  const code = String(codeValue || '').toUpperCase();
  if (!isPersonaCode(code)) return [];
  return Array.from(code).flatMap((letter) => {
    const tag = AXIS_TAGS[letter];
    return tag ? [{ ...tag, localizations: { ...tag.localizations } }] : [];
  });
}

export function personaLegacyArchetypes(
  localeValue: unknown = 'zh-CN',
): Record<PersonaCode, { title: string; subtitle: string; signature: string }> {
  const locale = normalizePersonaLocale(localeValue);
  return Object.fromEntries(
    PERSONA_CODES.map((code) => {
      const copy = PERSONA_CATALOG[code].localizations[locale];
      return [
        code,
        {
          title: copy.title,
          subtitle: copy.subtitle,
          signature: copy.description,
        },
      ];
    }),
  ) as Record<
    PersonaCode,
    { title: string; subtitle: string; signature: string }
  >;
}

export function personaDescriptionFor(
  codeValue: unknown,
  localeValue: unknown = 'zh-CN',
): string {
  const code = String(codeValue || '').toUpperCase();
  if (!isPersonaCode(code)) {
    return code === 'ROOKIE'
      ? ROOKIE_PERSONA_LOCALIZATIONS[normalizePersonaLocale(localeValue)]
          .description
      : '';
  }
  return PERSONA_CATALOG[code].localizations[
    normalizePersonaLocale(localeValue)
  ].description;
}
