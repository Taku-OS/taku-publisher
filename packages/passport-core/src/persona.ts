import { cleanText } from './privacy.js';
import { personaDescriptionFor } from './persona-catalog.js';

type PersonaRecord = Record<string, any>;

const HIDDEN_PERSONA_PRIORITY = [
  'sovereign',
  'demiurge',
  'architect',
  'oracle',
  'phantom',
  'insomniac-daywalker',
  'schrodingers-coder',
  'polymath',
];

function asPersonaRecord(value: unknown): PersonaRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as PersonaRecord)
    : {};
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeChoiceToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function uniqueStrings(items: unknown[]): string[] {
  return Array.from(
    new Set(
      items
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function personaSignatureFor(
  code: unknown,
  tone: unknown,
  archetype: PersonaRecord = {},
): string {
  const explicit = cleanText(archetype.signature, 220);
  if (explicit) return explicit;
  const normalizedCode = String(code || '');
  if (normalizeChoiceToken(tone) === 'brainrot') {
    const catalogDescription = personaDescriptionFor(
      normalizedCode,
      'zh-CN',
    );
    if (catalogDescription) return catalogDescription;
  }
  const subtitle = cleanText(archetype.subtitle, 180);
  if (subtitle) return subtitle;
  const title = cleanText(archetype.title, 80) || 'AI Builder';
  return `${title}，把 AI 用成自己的工作方式。`;
}

export function normalizePersonaOverrides(
  overridesValue: unknown = {},
  personaValue: unknown = {},
) {
  const overrides = asPersonaRecord(overridesValue);
  const persona = asPersonaRecord(personaValue);
  const availableToneIds = new Set(
    (Array.isArray(persona.availableTones) ? persona.availableTones : [])
      .map((tone) => asPersonaRecord(tone).id),
  );
  const manualTraitIds = new Set(
    (
      Array.isArray(persona.manualTraitCatalog)
        ? persona.manualTraitCatalog
        : []
    ).map((trait) => asPersonaRecord(trait).id),
  );
  const autoTraitIds = new Set(
    (
      Array.isArray(persona.autoTraits)
        ? persona.autoTraits
        : Array.isArray(persona.traits)
          ? persona.traits
          : []
    ).map((trait) => asPersonaRecord(trait).id),
  );
  const hiddenIds = new Set(
    (
      Array.isArray(persona.hiddenCandidates)
        ? persona.hiddenCandidates
        : []
    ).map((item) => asPersonaRecord(item).id),
  );
  const tone =
    typeof overrides.tone === 'string' &&
    availableToneIds.has(overrides.tone)
      ? overrides.tone
      : undefined;
  const lockedCode =
    typeof overrides.lockedCode === 'string' &&
    /^[AE][MI][OL][HW]$/.test(overrides.lockedCode)
      ? overrides.lockedCode
      : undefined;
  const hiddenTraitIds = Array.isArray(overrides.hiddenTraitIds)
    ? uniqueStrings(
        overrides.hiddenTraitIds.filter((id) => autoTraitIds.has(id)),
      )
    : [];
  const addedTraitIds = Array.isArray(overrides.addedTraitIds)
    ? uniqueStrings(
        overrides.addedTraitIds.filter((id) => manualTraitIds.has(id)),
      )
    : [];
  const selectedHiddenId =
    typeof overrides.selectedHiddenId === 'string' &&
    hiddenIds.has(overrides.selectedHiddenId)
      ? overrides.selectedHiddenId
      : '';
  return {
    ...(tone ? { tone } : {}),
    ...(lockedCode ? { lockedCode } : {}),
    hiddenTraitIds,
    addedTraitIds,
    selectedHiddenId,
  };
}

function selectHiddenArchetype(
  persona: PersonaRecord,
  selectedHiddenId: string,
) {
  if (!selectedHiddenId) return undefined;
  return (
    Array.isArray(persona.hiddenCandidates) ? persona.hiddenCandidates : []
  ).find((item) => asPersonaRecord(item).id === selectedHiddenId);
}

function hiddenPriorityIndex(id: unknown): number {
  const index = HIDDEN_PERSONA_PRIORITY.indexOf(String(id || ''));
  return index >= 0 ? index : HIDDEN_PERSONA_PRIORITY.length;
}

function selectFeaturedHiddenArchetype(candidatesValue: unknown = []) {
  const candidates = Array.isArray(candidatesValue) ? candidatesValue : [];
  const normalized = candidates.filter((item) => asPersonaRecord(item).id);
  if (!normalized.length) return undefined;
  return [...normalized].sort((left, right) => {
    const leftRecord = asPersonaRecord(left);
    const rightRecord = asPersonaRecord(right);
    const priorityDelta =
      hiddenPriorityIndex(leftRecord.id) -
      hiddenPriorityIndex(rightRecord.id);
    if (priorityDelta !== 0) return priorityDelta;
    return (
      (Number(rightRecord.confidence) || 0) -
      (Number(leftRecord.confidence) || 0)
    );
  })[0];
}

export function publicHiddenPersona(itemValue: unknown) {
  if (!itemValue) return undefined;
  const item = asPersonaRecord(itemValue);
  return {
    id: cleanText(item.id, 80) || '',
    title: cleanText(item.title, 120) || '',
    subtitle: cleanText(item.subtitle, 120) || '',
    description: cleanText(item.description, 240) || '',
    trigger: cleanText(item.trigger, 180) || '',
    confidence: round(Number(item.confidence) || 0, 2),
  };
}

export function publicTraitBadge(traitValue: unknown) {
  if (!traitValue) return undefined;
  const trait = asPersonaRecord(traitValue);
  return {
    id: cleanText(trait.id, 80) || '',
    label: cleanText(trait.label, 100) || '',
    category: cleanText(trait.category, 80) || 'Trait',
    evidence: cleanText(trait.evidence, 180) || '',
    confidence: round(Number(trait.confidence) || 0, 2),
    manual: Boolean(trait.manual),
  };
}

export function buildPersonaIdentity(personaValue: unknown = {}) {
  const persona = asPersonaRecord(personaValue);
  const unlockedHidden = (
    Array.isArray(persona.hiddenCandidates) ? persona.hiddenCandidates : []
  )
    .map(publicHiddenPersona)
    .filter(Boolean);
  const hidden = asPersonaRecord(persona.hidden);
  const featuredHidden = publicHiddenPersona(
    hidden.featured ||
      persona.selectedHidden ||
      selectFeaturedHiddenArchetype(persona.hiddenCandidates),
  );
  const badges = (
    Array.isArray(persona.traits) ? persona.traits : []
  )
    .map(publicTraitBadge)
    .filter(Boolean)
    .slice(0, 16);
  const archetype = asPersonaRecord(persona.archetype);
  return {
    basePersona: {
      code: cleanText(persona.code, 12) || '',
      title: cleanText(archetype.title, 120) || 'AI Builder',
      subtitle: cleanText(archetype.subtitle, 220) || '',
      signature:
        cleanText(archetype.signature, 220) ||
        personaSignatureFor(persona.code, persona.tone, archetype),
      tone: cleanText(persona.tone, 80) || '',
    },
    hidden: {
      ...(featuredHidden ? { featured: featuredHidden } : {}),
      unlocked: unlockedHidden,
      featuredSource: persona.selectedHidden
        ? 'selected'
        : featuredHidden
          ? 'auto'
          : 'none',
    },
    badges,
  };
}

export function refreshPersonaIdentity(personaValue: unknown = {}) {
  const next = structuredClone(asPersonaRecord(personaValue));
  const unlocked = (
    Array.isArray(next.hiddenCandidates) ? next.hiddenCandidates : []
  ).filter((item) => asPersonaRecord(item).id);
  const featured =
    next.selectedHidden || selectFeaturedHiddenArchetype(unlocked);
  next.hidden = {
    unlocked,
    ...(featured ? { featured } : {}),
    featuredSource: next.selectedHidden
      ? 'selected'
      : featured
        ? 'auto'
        : 'none',
  };
  next.identity = buildPersonaIdentity(next);
  return next;
}

export function applyPersonaOverrides(
  personaValue: unknown,
  overridesValue: unknown = {},
) {
  if (!personaValue) return personaValue;
  const persona = asPersonaRecord(personaValue);
  const normalized = normalizePersonaOverrides(overridesValue, persona);
  const next: PersonaRecord = structuredClone({
    ...persona,
    overrides: normalized,
  }) as PersonaRecord;
  const selectedTone = normalized.tone || next.tone;
  const alternate = selectedTone
    ? asPersonaRecord(next.archetypeAlternates)[selectedTone]
    : undefined;
  if (alternate) {
    const alternateRecord = asPersonaRecord(alternate);
    next.tone = alternateRecord.tone;
    next.toneLabel = alternateRecord.toneLabel;
    next.archetype = {
      title: alternateRecord.title,
      subtitle: alternateRecord.subtitle,
      signature: alternateRecord.signature,
    };
  }
  if (normalized.lockedCode) {
    next.lockedCode = normalized.lockedCode;
    next.locked = normalized.lockedCode === next.code;
  } else {
    delete next.lockedCode;
    next.locked = false;
  }

  const hiddenTraitIds = new Set(normalized.hiddenTraitIds);
  const baseTraits = (
    Array.isArray(next.autoTraits)
      ? next.autoTraits
      : Array.isArray(next.traits)
        ? next.traits
        : []
  ).filter((trait: unknown) => !hiddenTraitIds.has(asPersonaRecord(trait).id));
  const manualCatalog = new Map<unknown, PersonaRecord>(
    (
      Array.isArray(next.manualTraitCatalog)
        ? next.manualTraitCatalog
        : []
    ).map((trait: unknown) => [
      asPersonaRecord(trait).id,
      asPersonaRecord(trait),
    ]),
  );
  const manualTraits = normalized.addedTraitIds
    .map((id) => manualCatalog.get(id))
    .filter((trait): trait is PersonaRecord => Boolean(trait))
    .map((trait) => ({
      id: trait.id,
      label: trait.label,
      category: trait.category,
      evidence: trait.description || 'Added manually',
      confidence: 1,
      manual: true,
    }));
  const byId = new Map();
  for (const trait of [...baseTraits, ...manualTraits]) {
    byId.set(asPersonaRecord(trait).id, trait);
  }
  next.traits = Array.from(byId.values()).slice(0, 16);
  next.selectedHidden = selectHiddenArchetype(
    next,
    normalized.selectedHiddenId,
  );
  return refreshPersonaIdentity(next);
}
