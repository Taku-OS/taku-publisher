import { readFileSync } from 'node:fs';

import {
  PERSONA_CATALOG,
  isPersonaCode,
  personaFamilyForCode,
} from '#taku-passport-core';

import { publicHttpUrl } from './privacy.mjs';
import {
  buildPersonaIdentity,
  formatNumber,
  publicHiddenPersona,
  publicTraitBadge,
} from './persona.mjs';
import {
  basePersonaImageDataUrl,
  hiddenPersonaImageDataUrl,
  traitPersonaImageDataUrl,
} from './persona-assets.mjs';
import { getBuilderProfileSnapshotForDisplay as getPublishBuilderProfileSnapshotForDisplay } from './publish-flow.mjs';
import { round } from './usage.mjs';
import { formatEstimatedUsd } from './usage-pricing.mjs';
import {
  BUILDER_PROFILE_SNAPSHOT_SCHEMA,
  buildBuilderProfileSnapshot,
  cardSettingsForDraft,
} from './draft.mjs';
import { STAX_BLOCK_KEYS } from './stax-blocks.mjs';
import { buildStaxCardPageUrl, buildStaxProfilePageUrl } from './stax-url.mjs';
import { createQrMatrix } from './qr-code.mjs';

const MARKETPLACE_CATEGORIES = [
  { value: 'development', label: 'Development' },
  { value: 'design', label: 'Design' },
  { value: 'writing-content', label: 'Writing & Content' },
  { value: 'data-analytics', label: 'Data & Analytics' },
  { value: 'finance', label: 'Finance' },
  { value: 'marketing-growth', label: 'Marketing & Growth' },
  { value: 'research', label: 'Research' },
  { value: 'productivity', label: 'Productivity' },
  { value: 'automation-workflows', label: 'Automation & Workflows' },
  { value: 'business-ops', label: 'Business & Ops' },
  { value: 'education', label: 'Education' },
  { value: 'media-audio', label: 'Media & Audio' },
  { value: 'personal-life', label: 'Personal & Life' },
  { value: 'fun-experimental', label: 'Fun & Experimental' },
];

const STAX_BLOCK_SIZES = {
  hero: [4, 2],
  team: [2, 1],
  type: [2, 2],
  tier1: [1, 1],
  aura: [1, 1],
  basic: [1, 1],
  seal: [2, 2],
  qr: [2, 2],
  bars90: [2, 1],
  pie: [2, 2],
  modelcost: [2, 2],
  cgauge: [2, 2],
  rings: [2, 2],
  ctxring: [1, 1],
  clock: [2, 2],
  heat: [2, 2],
  dots: [2, 1],
  water: [1, 2],
  vsavg: [2, 1],
  trend: [1, 1],
  tally: [2, 1],
  dial: [2, 1],
  wave: [2, 1],
  peaks: [2, 1],
  ratio: [2, 1],
  badges: [2, 1],
  tools: [2, 2],
  stadium: [2, 1],
  knock: [1, 1],
  bracket: [1, 1],
  tier4: [1, 1],
  node: [2, 2],
  splitring: [2, 1],
};

const STAX_BLOCK_LABELS = {
  hero: 'Identity',
  team: 'Primary AI',
  type: 'Persona Type',
  tier1: 'Rank Tier',
  aura: 'Aura',
  basic: 'Basic Stats',
  seal: 'Serial Seal',
  qr: 'QR Code',
  bars90: '90-Day Bars',
  pie: 'Model Mix',
  modelcost: 'Model Cost',
  cgauge: 'Quota Gauge',
  rings: 'Activity Rings',
  ctxring: 'Context Load',
  clock: 'Active Hours',
  heat: 'Activity Heatmap',
  dots: 'Tool Calls',
  water: 'Community Level',
  vsavg: 'Community Compare',
  trend: 'Trend',
  tally: 'Published Count',
  dial: 'Builder Score',
  wave: 'Build Rhythm',
  peaks: 'Peak Day',
  ratio: 'Input Output Ratio',
  badges: 'Badges',
  tools: 'Tool Shelf',
  stadium: 'Token Stadium',
  knock: 'Local Events',
  bracket: 'API Equivalent',
  tier4: 'Top Tier',
  node: 'Tool Nodes',
  splitring: 'Session Mix',
};

const STAX_DEFAULT_BLOCKS = ['hero', 'team', 'type', 'basic', 'seal', 'bars90', 'pie', 'modelcost', 'cgauge', 'ctxring', 'clock', 'heat', 'trend', 'tools'];
const STAX_INLINE_BLOCK_KEYS = new Set(['badges', 'qr']);
const STAX_APP_TEMPLATE_URL = new URL('../templates/stax-app.html', import.meta.url);
const COMMUNITY_RANK_LOCK_LABEL = 'GROW ON TAKU';
const COMMUNITY_RANK_LOCK_REASON = 'Publish a tool or gain subscribers on Taku to unlock community rank.';
const QUOTA_LOCK_LABEL = 'CONNECT TAKU';
const QUOTA_LOCK_REASON = 'Connect Taku to show monthly quota usage and reset date.';
const TRUSTED_TAKU_BLOCK_KEYS = new Set(['tier1', 'aura', 'water', 'cgauge', 'dial', 'tier4']);
const TAKU_AUTH_BLOCK_KEYS = new Set(['tier1', 'aura', 'basic', 'seal', 'cgauge', 'water', 'tally', 'dial', 'tier4']);
const STAX_FONT_ASSETS = Object.freeze([
  { family: 'Space Grotesk', style: 'normal', weight: '500 700', file: 'space-grotesk-latin.woff2' },
  { family: 'Instrument Serif', style: 'normal', weight: 400, file: 'instrument-serif-latin.woff2' },
  { family: 'Instrument Serif', style: 'italic', weight: 400, file: 'instrument-serif-italic-latin.woff2' },
  { family: 'Space Mono', style: 'normal', weight: 400, file: 'space-mono-regular-latin.woff2' },
  { family: 'Space Mono', style: 'normal', weight: 700, file: 'space-mono-bold-latin.woff2' },
  { family: 'DM Sans', style: 'normal', weight: '400 700', file: 'dm-sans-latin.woff2' },
  { family: 'Pixelify Sans', style: 'normal', weight: 700, file: 'pixelify-sans-bold-latin.ttf', mime: 'font/ttf', format: 'truetype' },
]);
const STAX_ART_ASSETS = Object.freeze([
  { key: 'logo_mark', file: 'taku-mark.svg', mime: 'image/svg+xml' },
  { key: 'ic_codex', file: 'codex-color.svg', mime: 'image/svg+xml' },
  { key: 'ic_claude', file: 'claude-color.svg', mime: 'image/svg+xml' },
  { key: 'ic_cursor', file: 'cursor-color.svg', mime: 'image/svg+xml' },
  { key: 'ic_gemini', file: 'gemini-color.svg', mime: 'image/svg+xml' },
  { key: 'ic_deepseek', file: 'deepseek-color.svg', mime: 'image/svg+xml' },
  { key: 'ic_grok', file: 'grok-color.svg', mime: 'image/svg+xml' },
  { key: 'ic_llama', file: 'llama-color.svg', mime: 'image/svg+xml' },
]);
const STAX_FAMILY_META = Object.freeze({
  architect: { label: 'ARCHITECTS', color: '#8A5CFF' },
  craftsman: { label: 'CRAFTSMEN', color: '#2E9BFF' },
  hacker: { label: 'HACKERS', color: '#FF7A1F' },
  'vibe-maker': { label: 'VIBE MAKERS', color: '#9EDD16' },
});

let staxLocalFontCssCache = '';
let staxArtAssetsCache = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function staxLocalFontCss() {
  if (staxLocalFontCssCache) return staxLocalFontCssCache;
  staxLocalFontCssCache = STAX_FONT_ASSETS.map((font) => {
    const data = readFileSync(new URL(`../assets/fonts/${font.file}`, import.meta.url)).toString('base64');
    const mime = font.mime || 'font/woff2';
    const format = font.format || 'woff2';
    return `@font-face{font-family:'${font.family}';font-style:${font.style};font-weight:${font.weight};font-display:swap;src:url(data:${mime};base64,${data}) format('${format}');}`;
  }).join('\n');
  return staxLocalFontCssCache;
}

function staxArtAssets() {
  if (staxArtAssetsCache) return staxArtAssetsCache;
  staxArtAssetsCache = Object.fromEntries(STAX_ART_ASSETS.map((asset) => {
    const data = readFileSync(new URL(`../assets/logos/${asset.file}`, import.meta.url)).toString('base64');
    return [asset.key, `data:${asset.mime};base64,${data}`];
  }));
  return staxArtAssetsCache;
}

function cleanDisplayText(value, fallback = '', maxLength = 120) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, maxLength);
}

function englishDisplayText(value, fallback = '', maxLength = 120) {
  const text = cleanDisplayText(value, '', maxLength);
  if (!text) return cleanDisplayText(fallback, '', maxLength);
  const normalized = text.toLowerCase();
  const translations = new Map([
    ['待用户选择', 'Needs Selection'],
    ['本地日志', 'Local Logs'],
    ['本地扫描', 'Local Scan'],
    ['估算', 'Estimated'],
    ['部分样本', 'Partial Sample'],
    ['本地推导 + taku', 'Local + Taku'],
  ]);
  const translated = translations.get(normalized) || translations.get(text);
  if (translated) return translated.slice(0, maxLength);
  return /[\u3400-\u9fff]/.test(text) ? cleanDisplayText(fallback, '', maxLength) : text;
}

function teamDisplayName(value) {
  const raw = cleanDisplayText(value, '', 80);
  const normalized = raw.toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('claude')) return 'CLAUDE';
  if (normalized.includes('cursor')) return 'CURSOR';
  if (normalized.includes('gemini')) return 'GEMINI';
  if (normalized.includes('codex') || normalized.includes('openai')) return 'CODEX';
  return raw.toUpperCase();
}

function teamIconName(value) {
  const normalized = cleanDisplayText(value, '', 80).toLowerCase();
  if (normalized.includes('claude')) return 'claude';
  if (normalized.includes('cursor')) return 'cursor';
  if (normalized.includes('gemini')) return 'gemini';
  return 'codex';
}

function splitTeamLabels(value) {
  return cleanDisplayText(value, '', 160)
    .split(/[,\u00b7/|]+/g)
    .map((part) => teamDisplayName(part))
    .filter(Boolean);
}

function uniqueTeamLabels(labels) {
  const seen = new Set();
  const result = [];
  for (const label of labels) {
    const key = label.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

function teamIdentityForStax(teamBlock) {
  const value = recordValue(teamBlock?.value);
  const team = value.team;
  const sources = arrayValue(value.sources);
  const labels = [];
  let iconCandidate = '';

  if (Array.isArray(team)) {
    labels.push(...splitTeamLabels(team[0]));
    iconCandidate = cleanDisplayText(team[1] || team[0], '', 80);
  } else {
    labels.push(...splitTeamLabels(team));
    iconCandidate = cleanDisplayText(team, '', 80);
  }

  if (labels.length === 0) {
    for (const source of sources) {
      labels.push(...splitTeamLabels(source?.label || source?.source));
      if (!iconCandidate) iconCandidate = cleanDisplayText(source?.source || source?.label, '', 80);
    }
  }

  const uniqueLabels = uniqueTeamLabels(labels);
  const label = uniqueLabels.slice(0, 2).join(' / ') || 'CODEX';
  return {
    label,
    icon: teamIconName(iconCandidate || label),
  };
}

function teamOptionsForStax(teamBlock, activeIdentity) {
  const value = recordValue(teamBlock?.value);
  const options = arrayValue(value.options);
  const result = [];
  const seen = new Set();
  for (const option of options) {
    const label = teamDisplayName(option?.label || option?.id);
    const icon = teamIconName(option?.icon || option?.id || label);
    const id = cleanDisplayText(option?.id, '', 40).toLowerCase()
      || (icon === 'claude' ? 'claude-code' : icon);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, label, icon });
  }
  const activeId = activeIdentity.icon === 'claude' ? 'claude-code' : activeIdentity.icon;
  if (!result.length) result.push({ id: activeId, label: activeIdentity.label, icon: activeIdentity.icon });
  return result.map((option) => ({
    ...option,
    selected: option.id === activeId || option.label === activeIdentity.label,
  }));
}

function canonicalPersonaCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return isPersonaCode(code) ? code : '';
}

function personaTitleForStax(code, fallback = '') {
  if (code && PERSONA_CATALOG[code]) return PERSONA_CATALOG[code].localizations['en-US'].title;
  return cleanDisplayText(fallback, 'AI Builder', 80);
}

function personaDefinitionForStax(code, fallback = '') {
  const catalogDefinition = code && PERSONA_CATALOG[code]?.localizations?.['en-US']?.description;
  return cleanDisplayText(catalogDefinition || fallback, '', 150);
}

function splitPersonaTitleForStax(title) {
  const parts = cleanDisplayText(title, 'AI Builder', 80).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { n1: (parts[0] || 'AI').toUpperCase(), n2: 'Builder' };
  return {
    n1: parts.slice(0, -1).join(' ').toUpperCase(),
    n2: parts.at(-1),
  };
}

function personaFamilyMetaForStax(code) {
  if (!code) return null;
  return STAX_FAMILY_META[personaFamilyForCode(code)] || null;
}

function staxHeroBadgeColor(label = '') {
  const colors = ['#7C6CF6', '#2BD4C0', '#C9F24C', '#FFC93D'];
  const text = String(label || '');
  const hash = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return colors[hash % colors.length] || colors[2];
}

const STAX_AXIS_DISPLAY = Object.freeze([
  { id: 'howYouBuild', left: 'EXPLORER', right: 'ARCHITECT', leftLetter: 'E', sourceFirstLetter: 'A' },
  { id: 'whatYouUse', left: 'MAKER', right: 'INFRA', leftLetter: 'M', sourceFirstLetter: 'M' },
  { id: 'whenYouBuild', left: 'LARK', right: 'OWL', leftLetter: 'L', sourceFirstLetter: 'O' },
  { id: 'howYouEcosystem', left: 'WOLF', right: 'HOARDER', leftLetter: 'W', sourceFirstLetter: 'H' },
]);

function staxAxisForDisplay(axis, index) {
  const meta = STAX_AXIS_DISPLAY.find((item) => item.id === axis?.id) || STAX_AXIS_DISPLAY[index] || {
    left: 'AXIS',
    right: 'SIGNAL',
    leftLetter: axis?.first || '',
  };
  const score = Number(axis?.score);
  const clampedScore = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0.5;
  const firstLetter = cleanDisplayText(axis?.first, '', 4).toUpperCase();
  const secondLetter = cleanDisplayText(axis?.second, '', 4).toUpperCase();
  const leftLetter = cleanDisplayText(meta.leftLetter, '', 4).toUpperCase();
  const sourceFirstLetter = cleanDisplayText(meta.sourceFirstLetter, firstLetter, 4).toUpperCase();
  const leftScore = leftLetter && sourceFirstLetter && leftLetter !== sourceFirstLetter
    ? 1 - clampedScore
    : leftLetter && secondLetter && leftLetter === secondLetter
    ? 1 - clampedScore
    : firstLetter && leftLetter && leftLetter !== firstLetter
      ? 1 - clampedScore
      : clampedScore;
  return [
    meta.left,
    meta.right,
    ['#7C6CF6', '#2BD4C0', '#C9F24C', '#FFC93D'][index] || '#F0641E',
    Math.max(1, Math.min(10, Math.round(leftScore * 10))),
  ];
}

function inferMarketplaceCategory(item) {
  const text = `${item?.name || item?.title || ''} ${item?.description || ''} ${item?.type || ''}`.toLowerCase();
  if (/image|photo|background|design|icon|visual/.test(text)) return 'design';
  if (/youtube|ebook|write|content|article|blog|transcript/.test(text)) return 'writing-content';
  if (/code|developer|program|github|plugin|mcp/.test(text)) return 'development';
  if (/automat|workflow|agent|action/.test(text)) return 'automation-workflows';
  if (/data|analytic|csv|database|sql/.test(text)) return 'data-analytics';
  if (/audio|video|media|music/.test(text)) return 'media-audio';
  if (/research|paper|study/.test(text)) return 'research';
  return 'productivity';
}

function formatCompactMetric(value) {
  const number = Math.max(0, Number(value) || 0);
  if (number >= 1_000_000_000) return `${round(number / 1_000_000_000, 1)}B`;
  if (number >= 1_000_000) return `${round(number / 1_000_000, 1)}M`;
  if (number >= 1_000) return `${round(number / 1_000, 1)}K`;
  return formatNumber(Math.round(number));
}

function formatShare(value) {
  const percentage = Math.max(0, Math.min(100, (Number(value) || 0) * 100));
  if (percentage > 0 && percentage < 0.1) return '<0.1%';
  const rounded = round(percentage, 1);
  return `${Number.isInteger(rounded) ? Math.round(rounded) : rounded}%`;
}

function aiToolName(source) {
  const normalized = `${source?.source || ''} ${source?.label || ''}`.toLowerCase();
  if (normalized.includes('codex') || normalized.includes('openai')) return 'Codex';
  if (normalized.includes('claude') || normalized.includes('anthropic')) return 'Claude';
  if (normalized.includes('gemini') || normalized.includes('google')) return 'Gemini';
  return cleanDisplayText(source?.label || source?.source, 'Other', 40);
}

function modelToolName(model) {
  const normalized = `${model?.modelId || ''} ${model?.name || ''}`.toLowerCase();
  if (normalized.includes('claude')) return 'Claude';
  if (normalized.includes('gemini')) return 'Gemini';
  if (normalized.includes('gpt') || normalized.includes('o1') || normalized.includes('o3') || normalized.includes('o4')) return 'Codex';
  return 'Other';
}

function buildAiToolShares(usage = {}) {
  const grouped = new Map();
  const sourceRows = Array.isArray(usage.sources) ? usage.sources : [];
  for (const source of sourceRows) {
    const name = aiToolName(source);
    const tokenValue = Math.max(0, Number(source?.totalTokens) || 0);
    const sessionValue = Math.max(0, Number(source?.sessionCount) || 0);
    const current = grouped.get(name) || { name, tokens: 0, sessions: 0 };
    current.tokens += tokenValue;
    current.sessions += sessionValue;
    grouped.set(name, current);
  }

  if (!grouped.size) {
    const modelRows = usage.modelUsage?.topModels || usage.modelUsage?.models || [];
    for (const model of modelRows) {
      const name = modelToolName(model);
      const current = grouped.get(name) || { name, tokens: 0, sessions: 0 };
      current.tokens += Math.max(0, Number(model?.totalTokens) || 0);
      current.sessions += Math.max(0, Number(model?.eventCount) || 0);
      grouped.set(name, current);
    }
  }

  const canonical = ['Codex', 'Claude', 'Gemini'];
  const rows = canonical.map((name) => grouped.get(name) || { name, tokens: 0, sessions: 0 });
  const other = Array.from(grouped.values()).filter((row) => !canonical.includes(row.name));
  const combined = [...rows, ...other].slice(0, 3);
  const tokenTotal = combined.reduce((sum, row) => sum + row.tokens, 0);
  const sessionTotal = combined.reduce((sum, row) => sum + row.sessions, 0);
  return combined.map((row) => ({
    name: row.name,
    share: tokenTotal > 0
      ? row.tokens / tokenTotal
      : sessionTotal > 0
        ? row.sessions / sessionTotal
        : 0,
  }));
}

function buildLocalActivityModel(usage = {}) {
  const localActivity = usage?.localActivity || {};
  const sessionSplit = localActivity.sessionSplit || {};
  const streak = localActivity.buildStreak || {};
  const delta30d = localActivity.delta30d || {};
  const workPattern = localActivity.workPattern || {};
  const heatmapRows = Array.isArray(localActivity.dailyHeatmap)
    ? localActivity.dailyHeatmap.slice(-30).map((row) => ({
        date: cleanDate(row?.date),
        intensity: Math.max(0, Math.min(4, Math.floor(Number(row?.buildIntensity) || 0))),
        sessionCount: Math.max(0, Math.floor(Number(row?.sessionCount) || 0)),
        buildSessionCount: Math.max(0, Math.floor(Number(row?.buildSessionCount) || 0)),
        toolCallCount: Math.max(0, Math.floor(Number(row?.toolCallCount) || 0)),
      })).filter((row) => row.date)
    : [];
  const trendBuckets = Array.isArray(localActivity.trend30d?.buckets)
    ? localActivity.trend30d.buckets.slice(0, 5).map((bucket) => ({
        label: cleanDisplayText(bucket?.label, '', 40),
        buildSessionCount: Math.max(0, Math.floor(Number(bucket?.buildSessionCount) || 0)),
      }))
    : [];
  const maxTrendValue = Math.max(1, ...trendBuckets.map((bucket) => bucket.buildSessionCount));
  const toolCallCount = heatmapRows.reduce((sum, row) => sum + row.toolCallCount, 0);
  const buildSessionCount = Math.max(0, Math.floor(Number(localActivity.buildSessionCount) || Number(sessionSplit.buildSessionCount) || 0));
  const activeDayCount = Math.max(0, Math.floor(Number(localActivity.activeDayCount) || 0));
  const buildDayCount = Math.max(0, Math.floor(Number(localActivity.buildDayCount) || 0));
  const hasActivity = buildSessionCount > 0 || activeDayCount > 0 || heatmapRows.length > 0 || trendBuckets.some((bucket) => bucket.buildSessionCount > 0);

  return {
    hasActivity,
    builds: formatCompactMetric(buildSessionCount),
    buildDays: formatCompactMetric(buildDayCount),
    activeDays: formatCompactMetric(activeDayCount),
    toolCalls: formatCompactMetric(toolCallCount),
    streak: formatCompactMetric(streak.currentDays),
    bestStreak: formatCompactMetric(streak.bestDays),
    delta: formatDeltaMetric(delta30d),
    activeHours: formatActiveHours(workPattern),
    split: formatSessionSplit(sessionSplit),
    heatmapRows,
    trendBuckets: trendBuckets.map((bucket) => ({
      ...bucket,
      height: Math.max(8, Math.round((bucket.buildSessionCount / maxTrendValue) * 100)),
      value: formatCompactMetric(bucket.buildSessionCount),
    })),
  };
}

function cleanDate(value) {
  const text = cleanDisplayText(value, '', 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function formatDeltaMetric(delta30d = {}) {
  const display = cleanDisplayText(delta30d.display, '', 40);
  if (display) return display;
  const delta = Number(delta30d.delta);
  if (!Number.isFinite(delta)) return 'NEW';
  if (delta === 0) return '0%';
  const percent = Math.round(delta * 100);
  return percent > 0 ? `+${percent}%` : `${percent}%`;
}

function formatActiveHours(workPattern = {}) {
  const peakHour = Number(workPattern.peakHour);
  const activeHourCount = Math.max(0, Math.floor(Number(workPattern.activeHourCount) || 0));
  if (!Number.isInteger(peakHour) || peakHour < 0 || peakHour > 23) {
    return activeHourCount > 0 ? `${activeHourCount}h active` : 'n/a';
  }
  return `${String(peakHour).padStart(2, '0')}:00 peak`;
}

function formatSessionSplit(sessionSplit = {}) {
  const buildShare = Number(sessionSplit.buildShare);
  if (!Number.isFinite(buildShare) || buildShare <= 0) return '0% build';
  return `${formatShare(buildShare)} build`;
}

function collectPersonaTags(persona = {}) {
  const tags = [];
  const hidden = publicHiddenPersona(
    persona.hidden?.featured ||
    persona.featuredHidden ||
    persona.selectedHidden ||
    persona.identity?.hidden?.featured
  );
  if (hidden?.title || hidden?.subtitle) {
    tags.push({
      id: hidden.id || 'hidden-persona',
      label: [hidden.title, hidden.subtitle].filter(Boolean).join(' / '),
      detail: hidden.trigger || hidden.description || 'Hidden persona',
      imageUrl: hiddenPersonaImageDataUrl(hidden.id),
    });
  }

  const traitSource = Array.isArray(persona.badges)
    ? persona.badges
    : Array.isArray(persona.traits)
      ? persona.traits
      : Array.isArray(persona.identity?.badges)
        ? persona.identity.badges
        : [];
  for (const item of traitSource) {
    const trait = publicTraitBadge(item);
    if (!trait?.label && !trait?.id) continue;
    tags.push({
      id: trait.id || trait.label,
      label: trait.label || trait.id,
      detail: trait.evidence || trait.category || 'Persona trait',
      imageUrl: traitPersonaImageDataUrl(trait.id),
    });
  }

  const unique = [];
  const seen = new Set();
  for (const tag of tags) {
    const key = cleanDisplayText(tag.id || tag.label).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(tag);
  }
  return unique;
}

function firstHiddenPersona(persona = {}) {
  return publicHiddenPersona(
    persona.hidden?.featured ||
    persona.featuredHidden ||
    persona.selectedHidden ||
    persona.identity?.hidden?.featured
  );
}

function buildToolBreadthMetric(draft = {}, snapshot = {}) {
  const signals = draft.personaSignals || {};
  const toolUsage = signals.toolUsage || {};
  const ecosystem = signals.ecosystem || {};
  const inventory = snapshot.inventory || {};
  return Math.max(
    0,
    Number(toolUsage.usedToolCount) || 0,
    Number(toolUsage.usedInstalledToolCount) || 0,
    Number(ecosystem.activeToolCount) || 0,
    Number(inventory.usingToolCount) || 0,
    Number(draft.stats?.creatorToolCount) || 0
  );
}

function buildCodeActivityMetric(draft = {}, snapshot = {}) {
  const snapshotActivity = snapshot.codeActivity || {};
  const git = draft.personaSignals?.git || {
    aiSessionSourceLinesAdded: snapshotActivity.aiSessionSourceLinesAdded,
    aiSessionLinesAdded: snapshotActivity.aiSessionLinesAdded,
    aiSessionSourceFilesChanged: snapshotActivity.aiSessionSourceFilesChanged,
    aiSessionFilesChanged: snapshotActivity.aiSessionFilesChanged,
    aiSessionCommitCount: snapshotActivity.aiSessionCommitCount,
    aiSessionCommitCount30d: snapshotActivity.aiSessionCommitCount30d,
    sourceLinesAdded: snapshotActivity.sourceLinesAdded,
    linesAdded: snapshotActivity.linesAdded,
    sourceFilesChanged: snapshotActivity.sourceFilesChanged,
    filesChanged: snapshotActivity.filesChanged,
    commitCount: snapshotActivity.commitCount,
    commitCount30d: snapshotActivity.commitCount30d,
  };
  const sourceLinesAdded = Math.max(0, Math.floor(Number(git.aiSessionSourceLinesAdded) || Number(git.sourceLinesAdded) || 0));
  const linesAdded = Math.max(0, Math.floor(Number(git.aiSessionLinesAdded) || Number(git.linesAdded) || 0));
  const sourceFilesChanged = Math.max(0, Math.floor(Number(git.aiSessionSourceFilesChanged) || Number(git.sourceFilesChanged) || 0));
  const filesChanged = Math.max(0, Math.floor(Number(git.aiSessionFilesChanged) || Number(git.filesChanged) || 0));
  const commitCount = Math.max(0, Math.floor(
    Number(git.aiSessionCommitCount30d) ||
    Number(git.aiSessionCommitCount) ||
    Number(git.commitCount30d) ||
    Number(git.commitCount) ||
    0
  ));
  return {
    linesAdded: sourceLinesAdded || linesAdded,
    filesChanged: sourceFilesChanged || filesChanged,
    commitCount,
    period: cleanDisplayText(git.recentCommitWindow?.label || snapshot.usage?.label, 'selected period', 40),
  };
}

function collectFeaturedTools(draft = {}) {
  const candidates = [
    ...(draft.__toolChoices?.displayedTools || []),
    ...collectSectionItems(draft, 'creator-tools'),
    ...collectSectionItems(draft, 'using-tools'),
  ];
  const featured = [];
  const seen = new Set();
  for (const item of candidates) {
    const name = cleanDisplayText(item?.name || item?.title, '', 48);
    const publicId = cleanDisplayText(item?.id, '', 160);
    const key = cleanDisplayText(publicId || `${item?.source || ''}:${name}`).toLowerCase();
    if (!name || !key || seen.has(key)) continue;
    const isAddedTool = item?.source === 'local-upload' ||
      item?.metadata?.addedFrom === 'creator-editor' ||
      item?.metadata?.added_from === 'creator-editor' ||
      item?.ownership === 'owned';
    if (!isAddedTool) continue;
    seen.add(key);
    const listingDraft = draft?.listingDrafts?.[publicId];
    const listing = listingDraft?.listing || {};
    const coverImageUrl = publicHttpUrl(listing.coverImageUrl || listing.cover_image_url);
    const listingReady = listingDraft?.status === 'ready' && Boolean(coverImageUrl);
    featured.push({
      id: publicId || key,
      name,
      type: cleanDisplayText(item?.type, 'tool', 24),
      status: listingReady ? 'ready' : 'draft',
      listing: {
        title: cleanDisplayText(listing.title, name, 120),
        shortDescription: cleanDisplayText(
          listing.shortDescription || listing.short_description || item?.description,
          '',
          220
        ),
        description: cleanDisplayText(listing.description || item?.description, '', 1200),
        coverImageUrl,
        category: cleanDisplayText(listing.category, inferMarketplaceCategory(item), 80),
        additionalCategories: Array.isArray(listing.additionalCategories)
          ? listing.additionalCategories.map((value) => cleanDisplayText(value, '', 80)).filter(Boolean).slice(0, 3)
          : [],
        type: cleanDisplayText(listing.type || item?.type, 'skill', 80),
        tags: Array.isArray(listing.tags)
          ? listing.tags.map((value) => cleanDisplayText(value, '', 40)).filter(Boolean).slice(0, 5)
          : [],
        visibility: listing.visibility === 'unlisted' ? 'unlisted' : 'public',
      },
    });
    if (featured.length >= 3) break;
  }
  return featured;
}

function collectCommunityToolCandidates(draft = {}) {
  const candidates = [
    ...(draft.__toolChoices?.displayedTools || []),
    ...(draft.__toolChoices?.hiddenTools || []),
  ];
  const selectedIds = new Set(
    Array.isArray(draft.stats?.creatorToolIds) ? draft.stats.creatorToolIds : []
  );
  const tools = [];
  const seen = new Set();
  for (const item of candidates) {
    const id = cleanDisplayText(item?.id, '', 160);
    const name = cleanDisplayText(item?.name || item?.title, '', 80);
    if (!id || !name || seen.has(id)) continue;
    const type = cleanDisplayText(item?.type || item?.kind, 'tool', 40).toLowerCase();
    if (type !== 'skill' || item?.publishable === false) continue;
    seen.add(id);
    tools.push({
      id,
      name,
      type,
      source: cleanDisplayText(item?.source, '', 80),
      selected: selectedIds.has(id),
      supported: true,
      reason: '可发布',
    });
    if (tools.length >= 24) break;
  }
  return tools;
}

function collectSectionItems(draft = {}, sectionId) {
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  const section = sections.find((item) => item?.id === sectionId);
  return Array.isArray(section?.items) ? section.items : [];
}

function fallbackPersonaTags(persona = {}) {
  const axes = Array.isArray(persona.axes) ? persona.axes : [];
  return axes.slice(0, 3).map((axis, index) => ({
    id: axis.id || `axis-${index}`,
    label: axis.meaning || axis.label || `${axis.letter || ''} Persona`,
    detail: axis.impact || (Array.isArray(axis.evidence) ? axis.evidence[0] : '') || 'Persona dimension',
  }));
}

export function createPublishContext() {
  return {
    builderProfileSnapshotSchema: BUILDER_PROFILE_SNAPSHOT_SCHEMA,
    buildBuilderProfileSnapshot,
    getCardSettings: cardSettingsForDraft,
  };
}

function getBuilderProfileSnapshotForDisplay(draft) {
  return getPublishBuilderProfileSnapshotForDisplay(draft, createPublishContext());
}

function buildPersonaEditorModel(draft, options = {}) {
  const snapshot = getBuilderProfileSnapshotForDisplay(draft);
  const personaV2 = draft?.personaV2 || {};
  const identity = personaV2.identity || buildPersonaIdentity(personaV2);
  const persona = snapshot.persona || {};
  const card = cardSettingsForDraft(draft);
  const usage = draft?.stats?.usage || snapshot.usage || {};
  const title = cleanDisplayText(persona.title || personaV2.archetype?.title, 'AI Builder', 80);
  const subtitle = cleanDisplayText(persona.subtitle || personaV2.archetype?.subtitle, '', 120);
  const signature = cleanDisplayText(persona.signature || personaV2.archetype?.signature, '', 180);
  const code = cleanDisplayText(persona.code || personaV2.code, 'STAX', 12).toUpperCase();
  const displayName = cleanDisplayText(
    card.name || snapshot.card?.displayName || draft?.creator?.displayName || draft?.creator?.name,
    'Taku Creator',
    80
  );
  const avatarUrl = publicHttpUrl(card.avatarUrl || snapshot.card?.avatarUrl);
  const personaWithIdentity = {
    ...personaV2,
    ...persona,
    hidden: persona.hidden || identity.hidden,
    badges: persona.badges || identity.badges,
  };
  const hiddenPersona = firstHiddenPersona(personaWithIdentity);
  const rookieVariant = cleanDisplayText(
    persona.rookieVariant || personaV2.rookieVariant || personaV2.overrides?.rookieVariant,
    '',
    20,
  ).toLowerCase();
  const tags = collectPersonaTags(personaWithIdentity);
  const axisFallbacks = fallbackPersonaTags({
    axes: Array.isArray(persona.influences) && persona.influences.length
      ? persona.influences
      : personaV2.influences,
  });
  const visibleTags = [...tags];
  for (const fallback of axisFallbacks) {
    if (!visibleTags.some((tag) => tag.id === fallback.id)) visibleTags.push(fallback);
  }
  while (visibleTags.length < 3) {
    visibleTags.push({
      id: `locked-${visibleTags.length}`,
      label: visibleTags.length ? '等待解锁' : `${code} · ${title}`,
      detail: 'More activity will unlock this persona label.',
    });
  }
  const toolBreadth = buildToolBreadthMetric(draft, snapshot);
  const codeActivity = buildCodeActivityMetric(draft, snapshot);
  const localActivity = buildLocalActivityModel(usage);

  return {
    canSave: Boolean(options.editor?.enabled),
    readonlyPreview: Boolean(options.readonlyPreview) && !options.editor?.enabled,
    persona: {
      code,
      title,
      subtitle,
      signature,
      imageUrl: basePersonaImageDataUrl(code, {
        rookieVariant: rookieVariant === 'alt' ? 'alt' : 'default',
      }),
      hiddenLabel: hiddenPersona ? [hiddenPersona.title, hiddenPersona.subtitle].filter(Boolean).join(' / ') : '',
      hiddenDetail: hiddenPersona?.trigger || hiddenPersona?.description || '',
    },
    creator: { displayName, avatarUrl },
    usage: {
      tokens: formatCompactMetric(usage.totalTokens),
      tools: formatCompactMetric(toolBreadth),
      code: formatCompactMetric(codeActivity.linesAdded),
      codeDetail: codeActivity.filesChanged > 0
        ? `${formatCompactMetric(codeActivity.filesChanged)} files`
        : codeActivity.commitCount > 0
          ? `${formatCompactMetric(codeActivity.commitCount)} commits`
          : 'git activity',
      apiListEquivalent: formatUsableApiListEquivalent(usage),
      calls: formatCompactMetric(usage.eventCount || usage.modelUsage?.observedEventCount || 0),
      period: cleanDisplayText(usage.label || usage.periodLabel, 'This Month', 40),
      aiTools: buildAiToolShares(usage),
      localActivity,
    },
    tags: visibleTags.slice(0, 3),
    profileTags: visibleTags
      .filter((tag) => tag.label && !String(tag.id || '').startsWith('locked-'))
      .slice(0, 24),
    featuredTools: collectFeaturedTools(draft),
    card: {
      showPersonaCode: card.showPersonaCode !== false,
      showUsage: card.showUsage !== false,
      showCreatorPageLink: card.showCreatorPageLink !== false,
      visibility: card.visibility || 'public',
    },
  };
}

function renderPersonaFigure(model) {
  if (model.persona.imageUrl) {
    return `<img class="persona-figure-image" src="${escapeHtml(model.persona.imageUrl)}" alt="${escapeHtml(`${model.persona.code} · ${model.persona.title}`)}">`;
  }
  if (model.creator.avatarUrl) {
    return `<img class="persona-figure-image" src="${escapeHtml(model.creator.avatarUrl)}" alt="${escapeHtml(model.persona.title)}" referrerpolicy="no-referrer">`;
  }
  const initial = Array.from(model.creator.displayName || model.persona.title || model.persona.code || 'T')[0] || 'T';
  return `<div class="persona-figure-fallback" aria-label="${escapeHtml(model.creator.displayName)}">${escapeHtml(initial.toUpperCase())}</div>`;
}

function renderCreatorName(model) {
  if (!model.canSave) {
    return `<div class="creator-name-static">${escapeHtml(model.creator.displayName)}</div>`;
  }
  return `<label class="creator-name-editor">
    <span class="sr-only">Taku 账号名字</span>
    <input id="creatorNameInput" type="text" maxlength="80" value="${escapeHtml(model.creator.displayName)}" autocomplete="off" aria-describedby="saveStatus">
    <i id="saveStatus" aria-live="polite" title="已保存"></i>
  </label>`;
}

function renderProfileTags(model) {
  if (!model.profileTags.length) return '';
  return `<div class="profile-tags" aria-label="人格标签">
    ${model.profileTags.map((tag) => `<span class="profile-tag" title="${escapeHtml(tag.detail)}">${tag.imageUrl ? `<img src="${escapeHtml(tag.imageUrl)}" alt="">` : ''}${escapeHtml(tag.label)}</span>`).join('\n')}
  </div>`;
}

function renderFeaturedTools(model) {
  if (!model.featuredTools.length) return '';
  return `<div class="featured-tools" aria-label="添加的本地工具包">
    ${model.featuredTools.map((tool) => `<span class="tool-pill" title="${escapeHtml(tool.type)}" data-tool-id="${escapeHtml(tool.id)}">
      <span>${escapeHtml(tool.name)}</span>
      ${model.canSave ? `<button class="tool-remove-button" type="button" data-remove-local-tool="${escapeHtml(tool.id)}" aria-label="删除 ${escapeHtml(tool.name)}">×</button>` : ''}
    </span>`).join('\n')}
  </div>`;
}

function renderLocalActivityPanel(model) {
  const activity = model.usage.localActivity;
  if (!activity?.hasActivity) return '';
  return `<section class="local-activity-panel" aria-label="本地 AI 活动">
    <header class="local-activity-header">
      <div>
        <p class="local-activity-eyebrow">LOCAL ACTIVITY</p>
        <h2>本地 AI 活动</h2>
      </div>
      <span>${escapeHtml(model.usage.period)}</span>
    </header>
    <div class="local-activity-stats">
      <div><strong>${escapeHtml(activity.builds)}</strong><span>build sessions</span></div>
      <div><strong>${escapeHtml(activity.streak)}</strong><span>streak days</span></div>
      <div><strong>${escapeHtml(activity.delta)}</strong><span>30-day delta</span></div>
      <div><strong>${escapeHtml(activity.toolCalls)}</strong><span>tool calls</span></div>
      <div><strong>${escapeHtml(activity.activeHours)}</strong><span>active hours</span></div>
      <div><strong>${escapeHtml(activity.split)}</strong><span>chat/build split</span></div>
    </div>
    <div class="local-activity-grid">
      <div class="heatmap-block">
        <div class="activity-block-title"><span>Daily heatmap</span><strong>${escapeHtml(activity.activeDays)} active days</strong></div>
        <div class="heatmap-cells" aria-label="最近 30 天构建热力图">
          ${activity.heatmapRows.map((row) => `<span class="heatmap-cell heat-${row.intensity}" title="${escapeHtml(`${row.date}: ${row.buildSessionCount} builds, ${row.toolCallCount} tool calls`)}"></span>`).join('\n')}
        </div>
      </div>
      <div class="trend-block">
        <div class="activity-block-title"><span>Trend chart</span><strong>${escapeHtml(activity.buildDays)} build days</strong></div>
        <div class="trend-bars" aria-label="最近 30 天构建趋势">
          ${activity.trendBuckets.map((bucket) => `<span title="${escapeHtml(`${bucket.label}: ${bucket.buildSessionCount} builds`)}"><i style="height: ${bucket.height}%"></i><b>${escapeHtml(bucket.value)}</b></span>`).join('\n')}
        </div>
      </div>
    </div>
  </section>`;
}

function renderToolReviewPanel(model) {
  if (!model.canSave || !model.featuredTools.length) return '';
  const readyCount = model.featuredTools.filter((tool) => tool.status === 'ready').length;
  return `<section id="toolReviewPanel" class="tool-review-panel" aria-labelledby="toolReviewTitle">
    <header class="tool-review-header">
      <div>
        <p class="tool-review-eyebrow">PROFILE TOOLKIT</p>
        <h2 id="toolReviewTitle">发布前审核工具</h2>
        <p>人格负责讲述你是谁；每个工具仍拥有独立、可安装的 Marketplace 信息。</p>
      </div>
      <span id="toolReviewProgress" class="tool-review-progress">${readyCount}/${model.featuredTools.length} 已就绪</span>
    </header>
    <div class="tool-review-layout">
      <nav id="toolReviewQueue" class="tool-review-queue" aria-label="待审核工具">
        ${model.featuredTools.map((tool, index) => `<button type="button" class="tool-review-queue-item${index === 0 ? ' is-active' : ''}" data-review-tool-id="${escapeHtml(tool.id)}">
          <span class="tool-review-queue-icon">${escapeHtml(Array.from(tool.listing.title || tool.name || 'T')[0]?.toUpperCase() || 'T')}</span>
          <span class="tool-review-queue-copy"><strong>${escapeHtml(tool.listing.title || tool.name)}</strong><small>${tool.status === 'ready' ? '已就绪' : '待审核'}</small></span>
          <i class="${tool.status === 'ready' ? 'is-ready' : ''}" aria-hidden="true"></i>
        </button>`).join('\n')}
      </nav>
      <form id="toolReviewForm" class="tool-review-form">
        <div class="tool-listing-heading">
          <div id="toolIconPreview" class="tool-icon-preview" aria-label="工具图标预览"><span>T</span></div>
          <div>
            <span id="toolTypeBadge" class="tool-type-badge">Skill</span>
            <h3>Marketplace 信息</h3>
            <p>这些信息会同时用于 Creator 页面、Try it 和客户端安装。</p>
          </div>
          <button id="generateToolIconButton" class="generate-icon-button" type="button">✨ 生成图标</button>
        </div>
        <div class="tool-listing-fields">
          <label class="tool-field tool-field-title">
            <span>标题 <b>*</b></span>
            <input id="toolListingTitle" type="text" maxlength="120" autocomplete="off" required>
          </label>
          <label class="tool-field tool-field-description">
            <span>简短描述 <b>*</b><small id="toolDescriptionCount">0/220</small></span>
            <textarea id="toolListingDescription" maxlength="220" rows="3" required></textarea>
          </label>
          <label class="tool-field">
            <span>主分类 <b>*</b></span>
            <select id="toolListingCategory" required>
              <option value="">选择分类</option>
              ${MARKETPLACE_CATEGORIES.map((category) => `<option value="${category.value}">${escapeHtml(category.label)}</option>`).join('\n')}
            </select>
          </label>
          <label class="tool-field">
            <span>标签 <small>最多 5 个，用逗号分隔</small></span>
            <input id="toolListingTags" type="text" maxlength="220" autocomplete="off" placeholder="youtube, ebook, transcript">
          </label>
          <fieldset class="tool-field tool-field-categories">
            <legend>附加分类 <small>最多 3 个</small></legend>
            <div id="toolAdditionalCategories" class="additional-category-grid">
              ${MARKETPLACE_CATEGORIES.map((category) => `<label><input type="checkbox" value="${category.value}" data-additional-category><span>${escapeHtml(category.label)}</span></label>`).join('\n')}
            </div>
          </fieldset>
        </div>
        <footer class="tool-review-footer">
          <p id="toolReviewStatus" aria-live="polite">补齐必填信息并生成图标后，工具即可发布。</p>
          <button id="saveToolListingButton" type="submit">保存并完成审核</button>
        </footer>
      </form>
    </div>
  </section>`;
}

function renderTagTile(tag, index, className, model) {
  const extra = index === 0
    ? `<div class="tag-metrics" aria-label="工具和代码数量">
        <span><strong>${escapeHtml(model.usage.tools)}</strong><small>tools</small></span>
        <span><strong>${escapeHtml(model.usage.code)}</strong><small>code</small></span>
      </div>`
    : index === 1
      ? renderFeaturedTools(model)
      : '';
  return `<section class="tag-tile ${className}" title="${escapeHtml(tag.detail)}">${extra}</section>`;
}

export function renderLabStylePreview(draft, options = {}) {
  return renderStaxAppPreview(draft, options);
  const model = buildPersonaEditorModel(draft, options);
  const tagClasses = ['tag-lime', 'tag-dark', 'tag-yellow'];
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(model.persona.title)} · Taku Persona</title>
  <style>
    :root {
      color-scheme: light;
      --page: #777775;
      --paper: #f6f3ed;
      --ink: #15121c;
      --orange: #f38d57;
      --purple: #6758e8;
      --lime: #cff45b;
      --yellow: #ffd34f;
      --pink: #f2478b;
      --muted: #9b9a96;
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-synthesis: none;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      min-width: 320px;
      background: var(--page);
      color: var(--ink);
      letter-spacing: 0;
    }
    button, input, textarea, select { font: inherit; letter-spacing: 0; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .persona-page {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .persona-card {
      width: min(1120px, 100%);
      min-height: min(820px, calc(100vh - 48px));
      display: grid;
      grid-template-columns: minmax(220px, 0.96fr) minmax(230px, 1fr) minmax(220px, 1fr);
      grid-template-rows: minmax(280px, 1.28fr) minmax(150px, 0.68fr) minmax(190px, 0.9fr);
      gap: 14px;
      padding: 32px;
      overflow: hidden;
      border-radius: 44px;
      background: var(--paper);
    }
    .persona-identity {
      grid-column: 1;
      grid-row: 1 / 3;
      min-width: 0;
      display: flex;
      flex-direction: column;
      padding: 14px 18px 4px 14px;
    }
    .persona-name {
      margin: 0;
      color: var(--orange);
      font-size: 40px;
      line-height: 1.03;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .persona-subtitle {
      margin: 12px 0 0;
      color: #6f6d69;
      font-size: 17px;
      line-height: 1.35;
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    .hidden-persona {
      width: fit-content;
      max-width: 100%;
      margin: 18px 0 0;
      padding: 8px 10px;
      border: 2px solid rgba(242, 71, 139, 0.5);
      color: var(--pink);
      font-size: 13px;
      line-height: 1.25;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .hidden-persona span {
      display: block;
      margin-bottom: 4px;
      color: #6f6d69;
      font-size: 10px;
      line-height: 1;
      text-transform: uppercase;
    }
    .persona-figure {
      flex: 0 0 auto;
      min-height: 0;
      display: grid;
      place-items: center;
      padding: 14px 0 18px;
    }
    .persona-figure-image {
      display: block;
      width: min(100%, 180px);
      max-height: 180px;
      object-fit: contain;
    }
    .persona-figure-fallback {
      color: var(--muted);
      font-size: 96px;
      line-height: 1;
      font-weight: 800;
      text-transform: uppercase;
    }
    .persona-signature {
      max-width: 36ch;
      margin: 0 0 20px;
      color: #6d6b67;
      font-size: 14px;
      line-height: 1.5;
      font-weight: 600;
    }
    .creator-name-static,
    .creator-name-editor input {
      width: 100%;
      min-width: 0;
      border: 0;
      border-radius: 0;
      outline: 0;
      background: transparent;
      color: var(--ink);
      font-size: 24px;
      line-height: 1.2;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .creator-name-editor {
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 2px solid transparent;
    }
    .creator-name-editor:focus-within { border-bottom-color: var(--pink); }
    .creator-name-editor i {
      flex: 0 0 auto;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #48aa70;
      opacity: 0;
      transition: opacity 160ms ease;
    }
    .creator-name-editor i.saving { background: var(--yellow); opacity: 1; }
    .creator-name-editor i.saved { opacity: 1; }
    .profile-tags {
      display: flex;
      flex-wrap: wrap;
      align-content: flex-start;
      gap: 6px;
      margin-top: 14px;
      max-height: 118px;
      overflow: auto;
      padding-right: 2px;
    }
    .profile-tag {
      max-width: 100%;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 7px;
      border: 2px solid rgba(242, 71, 139, 0.18);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.42);
      color: var(--pink);
      font-size: 10px;
      line-height: 1;
      font-weight: 850;
      overflow-wrap: anywhere;
    }
    .profile-tag img {
      width: 24px;
      height: 24px;
      margin: -3px 0 -3px -3px;
      object-fit: contain;
    }
    .metric-tile,
    .tag-tile {
      min-width: 0;
      overflow: hidden;
      border-radius: 22px;
    }
    .code-tile {
      grid-column: 2;
      grid-row: 1;
      display: grid;
      align-content: center;
      justify-items: center;
      padding: 28px;
      background: var(--ink);
      color: var(--lime);
      text-align: center;
    }
    .tile-kicker {
      margin: 0 0 18px;
      font-size: 14px;
      line-height: 1;
      font-weight: 800;
      text-transform: uppercase;
    }
    .persona-code {
      margin: 0;
      max-width: 100%;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 48px;
      line-height: 1;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .code-title {
      margin: 18px 0 0;
      color: #fff;
      font-size: 18px;
      line-height: 1.3;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .ai-tile {
      grid-column: 3;
      grid-row: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 28px 30px;
      background: var(--purple);
      color: var(--lime);
    }
    .ai-tile h2 {
      margin: 0 0 28px;
      font-size: 22px;
      line-height: 1.05;
      font-weight: 800;
    }
    .ai-share-list { display: grid; gap: 16px; }
    .ai-share-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      padding-bottom: 10px;
      border-bottom: 2px solid rgba(207, 244, 91, 0.28);
    }
    .ai-share-row:last-child { padding-bottom: 0; border-bottom: 0; }
    .ai-share-row span {
      min-width: 0;
      font-size: 17px;
      line-height: 1.1;
      font-weight: 750;
      overflow-wrap: anywhere;
    }
    .ai-share-row strong {
      font-size: 20px;
      line-height: 1;
      font-weight: 850;
    }
    .usage-tile {
      grid-column: 2 / 4;
      grid-row: 2;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: center;
      gap: 18px;
      padding: 22px 32px;
      background: var(--orange);
      color: #090909;
    }
    .local-activity-panel {
      width: min(1120px, 100%);
      margin-top: 14px;
      padding: 22px;
      border-radius: 26px;
      background: #15121c;
      color: #f6f3ed;
      box-shadow: 0 18px 42px rgba(15, 14, 12, 0.14);
    }
    .local-activity-header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    .local-activity-eyebrow {
      margin: 0 0 6px;
      color: var(--lime);
      font-size: 12px;
      line-height: 1;
      font-weight: 850;
      letter-spacing: 0;
    }
    .local-activity-header h2 {
      margin: 0;
      font-size: 24px;
      line-height: 1.1;
      font-weight: 850;
    }
    .local-activity-header span {
      color: rgba(246, 243, 237, 0.66);
      font-size: 13px;
      line-height: 1;
      font-weight: 800;
    }
    .local-activity-stats {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }
    .local-activity-stats div {
      min-width: 0;
      padding: 14px 12px;
      border: 2px solid rgba(246, 243, 237, 0.12);
      border-radius: 16px;
      background: rgba(246, 243, 237, 0.06);
    }
    .local-activity-stats strong {
      display: block;
      color: var(--lime);
      font-size: 22px;
      line-height: 1;
      font-weight: 850;
      overflow-wrap: anywhere;
    }
    .local-activity-stats span {
      display: block;
      margin-top: 8px;
      color: rgba(246, 243, 237, 0.68);
      font-size: 10px;
      line-height: 1.1;
      font-weight: 800;
      text-transform: lowercase;
    }
    .local-activity-grid {
      display: grid;
      grid-template-columns: 1.25fr 0.75fr;
      gap: 14px;
    }
    .heatmap-block,
    .trend-block {
      min-width: 0;
      padding: 16px;
      border: 2px solid rgba(246, 243, 237, 0.12);
      border-radius: 18px;
      background: rgba(246, 243, 237, 0.045);
    }
    .activity-block-title {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      color: rgba(246, 243, 237, 0.72);
      font-size: 11px;
      line-height: 1;
      font-weight: 850;
      text-transform: uppercase;
    }
    .activity-block-title strong {
      color: var(--yellow);
      font-size: inherit;
      line-height: inherit;
      font-weight: inherit;
      text-transform: lowercase;
    }
    .heatmap-cells {
      display: grid;
      grid-template-columns: repeat(15, minmax(0, 1fr));
      gap: 6px;
    }
    .heatmap-cell {
      aspect-ratio: 1;
      border-radius: 5px;
      background: rgba(246, 243, 237, 0.1);
    }
    .heat-1 { background: rgba(207, 244, 91, 0.32); }
    .heat-2 { background: rgba(207, 244, 91, 0.54); }
    .heat-3 { background: rgba(255, 211, 79, 0.78); }
    .heat-4 { background: #f2478b; }
    .trend-bars {
      height: 118px;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      align-items: end;
      gap: 8px;
    }
    .trend-bars span {
      min-width: 0;
      height: 100%;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      align-items: end;
      gap: 7px;
      color: rgba(246, 243, 237, 0.68);
      font-size: 10px;
      line-height: 1;
      font-weight: 850;
      text-align: center;
    }
    .trend-bars i {
      display: block;
      min-height: 8px;
      border-radius: 6px 6px 2px 2px;
      background: var(--orange);
    }
    .trend-bars b {
      font-size: inherit;
      line-height: inherit;
      font-weight: inherit;
      overflow-wrap: anywhere;
    }
    .usage-stat { min-width: 0; text-align: center; }
    .usage-stat strong {
      display: block;
      font-size: 34px;
      line-height: 1;
      font-weight: 850;
      overflow-wrap: anywhere;
    }
    .usage-stat span {
      display: block;
      margin-top: 12px;
      font-size: 14px;
      line-height: 1;
      font-weight: 800;
      text-transform: lowercase;
    }
    .usage-stat small {
      display: block;
      margin-top: 7px;
      color: rgba(9, 9, 9, 0.62);
      font-size: 10px;
      line-height: 1;
      font-weight: 800;
      text-transform: lowercase;
    }
    .tag-tile {
      min-height: 0;
      display: grid;
      align-content: center;
      justify-items: center;
      padding: 22px;
      text-align: center;
    }
    .tag-tile h2 {
      margin: 0;
      max-width: 100%;
      font-size: 24px;
      line-height: 1.15;
      font-weight: 850;
      overflow-wrap: anywhere;
    }
    .tag-tile span {
      margin-top: 16px;
      font-size: 13px;
      line-height: 1;
      font-weight: 800;
      text-transform: uppercase;
      opacity: 0.58;
    }
    .tag-metrics {
      width: min(260px, 100%);
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 28px;
    }
    .tag-metrics span,
    .tool-pill {
      min-width: 0;
      border: 2px solid rgba(9, 9, 9, 0.18);
      border-radius: 12px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.2);
      overflow-wrap: anywhere;
    }
    .tag-metrics strong {
      display: block;
      font-size: 20px;
      line-height: 1;
      font-weight: 900;
    }
    .tag-metrics small {
      display: block;
      margin-top: 7px;
      font-size: 10px;
      line-height: 1;
      font-weight: 850;
      text-transform: lowercase;
      opacity: 0.62;
    }
    .featured-tools {
      width: min(300px, 100%);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-top: 28px;
    }
    .tool-pill {
      position: relative;
      border-color: rgba(207, 244, 91, 0.34);
      background: rgba(207, 244, 91, 0.08);
      color: #fff;
      font-size: 10px;
      line-height: 1.15;
      font-weight: 850;
      text-align: left;
      display: flex;
      align-items: center;
      min-width: 138px;
      max-width: 190px;
      min-height: 38px;
      padding: 10px 34px 10px 13px;
      overflow-wrap: normal;
      word-break: normal;
      hyphens: none;
    }
    .tool-pill span {
      min-width: 0;
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tool-remove-button {
      position: absolute;
      right: -11px;
      top: 0;
      transform: translateY(-50%);
      width: 22px;
      height: 22px;
      border: 1px solid rgba(207, 244, 91, 0.42);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      font-size: 0;
      line-height: 0;
      padding: 0;
      display: grid;
      place-items: center;
      cursor: pointer;
    }
    .tool-remove-button::before,
    .tool-remove-button::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      width: 10px;
      height: 2px;
      border-radius: 999px;
      background: currentColor;
      transform: translate(-50%, -50%) rotate(45deg);
    }
    .tool-remove-button::after {
      transform: translate(-50%, -50%) rotate(-45deg);
    }
    .tool-remove-button:hover,
    .tool-remove-button:focus-visible {
      background: var(--pink);
      border-color: var(--pink);
      color: #fff;
      outline: none;
    }
    .tag-lime { grid-column: 1; grid-row: 3; background: var(--lime); color: #090909; }
    .tag-dark { grid-column: 2; grid-row: 3; background: var(--ink); color: #fff; }
    .tag-yellow { grid-column: 3; grid-row: 3; background: var(--yellow); color: #fff; }
    .tool-review-panel {
      width: min(1120px, 100%);
      margin-top: 14px;
      overflow: hidden;
      border-radius: 26px;
      background: #f8f7f3;
      box-shadow: 0 18px 42px rgba(15, 14, 12, 0.14);
    }
    .tool-review-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      padding: 28px 30px 22px;
      border-bottom: 1px solid rgba(21, 18, 28, 0.1);
    }
    .tool-review-eyebrow {
      margin: 0 0 8px;
      color: var(--purple);
      font-size: 10px;
      line-height: 1;
      font-weight: 900;
      letter-spacing: 0.14em;
    }
    .tool-review-header h2 {
      margin: 0;
      font-size: 24px;
      line-height: 1.15;
      font-weight: 850;
    }
    .tool-review-header p:not(.tool-review-eyebrow) {
      margin: 8px 0 0;
      color: #6f6d69;
      font-size: 13px;
      line-height: 1.5;
      font-weight: 650;
    }
    .tool-review-progress {
      flex: 0 0 auto;
      padding: 9px 12px;
      border-radius: 999px;
      background: #ece9ff;
      color: #5543d9;
      font-size: 12px;
      line-height: 1;
      font-weight: 850;
    }
    .tool-review-layout {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      min-height: 520px;
    }
    .tool-review-queue {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 18px;
      border-right: 1px solid rgba(21, 18, 28, 0.1);
      background: #efeee9;
    }
    .tool-review-queue-item {
      width: 100%;
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) 8px;
      align-items: center;
      gap: 11px;
      border: 1px solid transparent;
      border-radius: 15px;
      padding: 10px;
      background: transparent;
      color: var(--ink);
      text-align: left;
      cursor: pointer;
    }
    .tool-review-queue-item:hover { background: rgba(255, 255, 255, 0.6); }
    .tool-review-queue-item.is-active {
      border-color: rgba(103, 88, 232, 0.18);
      background: #fff;
      box-shadow: 0 8px 24px rgba(21, 18, 28, 0.08);
    }
    .tool-review-queue-icon {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      overflow: hidden;
      border-radius: 12px;
      background: var(--purple);
      color: #fff;
      font-size: 17px;
      line-height: 1;
      font-weight: 900;
    }
    .tool-review-queue-icon img { width: 100%; height: 100%; object-fit: cover; }
    .tool-review-queue-copy { min-width: 0; }
    .tool-review-queue-copy strong,
    .tool-review-queue-copy small { display: block; }
    .tool-review-queue-copy strong {
      overflow: hidden;
      font-size: 13px;
      line-height: 1.25;
      font-weight: 850;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tool-review-queue-copy small {
      margin-top: 5px;
      color: #96938e;
      font-size: 10px;
      line-height: 1;
      font-weight: 750;
    }
    .tool-review-queue-item i {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--orange);
    }
    .tool-review-queue-item i.is-ready { background: #48aa70; }
    .tool-review-form { min-width: 0; padding: 26px 30px 24px; }
    .tool-listing-heading {
      display: grid;
      grid-template-columns: 74px minmax(0, 1fr) auto;
      align-items: center;
      gap: 16px;
      padding-bottom: 22px;
      border-bottom: 1px solid rgba(21, 18, 28, 0.1);
    }
    .tool-icon-preview {
      width: 74px;
      height: 74px;
      display: grid;
      place-items: center;
      overflow: hidden;
      border-radius: 18px;
      background: var(--ink);
      color: var(--lime);
      font-size: 28px;
      line-height: 1;
      font-weight: 900;
    }
    .tool-icon-preview img { width: 100%; height: 100%; object-fit: cover; }
    .tool-type-badge {
      display: inline-flex;
      margin-bottom: 7px;
      padding: 4px 7px;
      border-radius: 999px;
      background: #ece9ff;
      color: #5543d9;
      font-size: 9px;
      line-height: 1;
      font-weight: 900;
      text-transform: uppercase;
    }
    .tool-listing-heading h3 { margin: 0; font-size: 19px; line-height: 1.2; font-weight: 850; }
    .tool-listing-heading p { margin: 6px 0 0; color: #85827d; font-size: 11px; line-height: 1.4; font-weight: 650; }
    .generate-icon-button,
    .tool-review-footer button {
      border: 0;
      border-radius: 12px;
      padding: 0 16px;
      height: 42px;
      font-size: 12px;
      line-height: 1;
      font-weight: 850;
      cursor: pointer;
    }
    .generate-icon-button { background: var(--ink); color: #fff; }
    .tool-listing-fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      padding: 22px 0;
    }
    .tool-field { min-width: 0; display: grid; gap: 8px; margin: 0; padding: 0; border: 0; }
    .tool-field-title,
    .tool-field-description,
    .tool-field-categories { grid-column: 1 / -1; }
    .tool-field > span,
    .tool-field legend {
      width: 100%;
      color: #39363f;
      font-size: 11px;
      line-height: 1.2;
      font-weight: 850;
    }
    .tool-field b { color: var(--orange); }
    .tool-field small { float: right; color: #9b9892; font-size: 9px; font-weight: 700; }
    .tool-field input,
    .tool-field textarea,
    .tool-field select {
      width: 100%;
      min-width: 0;
      border: 1px solid rgba(21, 18, 28, 0.15);
      border-radius: 12px;
      padding: 11px 12px;
      background: #fff;
      color: var(--ink);
      font-size: 13px;
      line-height: 1.4;
      font-weight: 650;
      outline: 0;
    }
    .tool-field input,
    .tool-field select { height: 42px; }
    .tool-field textarea { resize: vertical; min-height: 82px; }
    .tool-field input:focus,
    .tool-field textarea:focus,
    .tool-field select:focus { border-color: var(--purple); box-shadow: 0 0 0 3px rgba(103, 88, 232, 0.1); }
    .additional-category-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
    }
    .additional-category-grid label { position: relative; min-width: 0; }
    .additional-category-grid input { position: absolute; opacity: 0; pointer-events: none; }
    .additional-category-grid span {
      min-height: 34px;
      display: flex;
      align-items: center;
      border: 1px solid rgba(21, 18, 28, 0.12);
      border-radius: 10px;
      padding: 7px 9px;
      background: #fff;
      color: #67645f;
      font-size: 9px;
      line-height: 1.25;
      font-weight: 750;
      cursor: pointer;
    }
    .additional-category-grid input:checked + span {
      border-color: var(--purple);
      background: #ece9ff;
      color: #5543d9;
    }
    .additional-category-grid input:disabled + span { opacity: 0.38; cursor: not-allowed; }
    .tool-review-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding-top: 18px;
      border-top: 1px solid rgba(21, 18, 28, 0.1);
    }
    .tool-review-footer p { margin: 0; color: #797670; font-size: 11px; line-height: 1.4; font-weight: 700; }
    .tool-review-footer p.is-ready { color: #27804d; }
    .tool-review-footer p.is-error { color: #c83232; }
    .tool-review-footer button { flex: 0 0 auto; background: var(--purple); color: #fff; }
    .generate-icon-button:disabled,
    .tool-review-footer button:disabled { cursor: wait; opacity: 0.58; }
    .editor-controls {
      width: min(1120px, 100%);
      margin-top: 14px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 10px;
      align-items: center;
      padding: 14px;
      border-radius: 18px;
      background: rgba(246, 243, 237, 0.94);
      box-shadow: 0 18px 42px rgba(15, 14, 12, 0.14);
    }
    .editor-controls input {
      min-width: 0;
      height: 44px;
      border: 2px solid rgba(21, 18, 28, 0.12);
      border-radius: 12px;
      padding: 0 14px;
      background: #fff;
      color: var(--ink);
      font-size: 14px;
      font-weight: 650;
      outline: 0;
    }
    .editor-controls input:focus { border-color: var(--pink); }
    .editor-controls button,
    .editor-controls a {
      height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 12px;
      padding: 0 16px;
      color: var(--ink);
      font-size: 13px;
      font-weight: 850;
      text-decoration: none;
      cursor: pointer;
      white-space: nowrap;
    }
    .editor-controls button:disabled {
      cursor: wait;
      opacity: 0.62;
    }
    .editor-controls .add-package { background: var(--lime); }
    .editor-controls .publish-profile { background: var(--pink); color: #fff; }
    .editor-controls .login-link { background: var(--ink); color: #fff; }
    .editor-controls .is-hidden { display: none; }
    .editor-status {
      grid-column: 1 / -1;
      min-height: 18px;
      margin: -2px 2px 0;
      color: #6f6d69;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.4;
    }
    .preview-notice {
      width: min(1120px, 100%);
      margin: 0 0 14px;
      padding: 14px 18px;
      border: 2px solid rgba(242, 71, 139, 0.32);
      border-radius: 18px;
      background: rgba(246, 243, 237, 0.96);
      color: var(--ink);
      box-shadow: 0 18px 42px rgba(15, 14, 12, 0.14);
    }
    .preview-notice strong {
      display: block;
      margin-bottom: 4px;
      color: var(--pink);
      font-size: 14px;
      line-height: 1.2;
      font-weight: 850;
    }
    .preview-notice span {
      display: block;
      color: #6f6d69;
      font-size: 13px;
      line-height: 1.45;
      font-weight: 700;
    }
    @media (max-width: 1040px) {
      .persona-page { padding: 16px; }
      .persona-card {
        min-height: calc(100vh - 32px);
        max-height: none;
        grid-template-columns: 0.9fr 1fr;
        grid-template-rows: minmax(330px, auto) minmax(250px, auto) minmax(170px, auto) repeat(2, minmax(190px, auto));
        padding: 28px;
        border-radius: 42px;
      }
      .persona-identity { grid-column: 1; grid-row: 1 / 3; }
      .code-tile { grid-column: 2; grid-row: 1; }
      .ai-tile { grid-column: 2; grid-row: 2; }
      .usage-tile { grid-column: 1 / 3; grid-row: 3; }
      .tag-lime { grid-column: 1; grid-row: 4; }
      .tag-dark { grid-column: 2; grid-row: 4; }
      .tag-yellow { grid-column: 1 / 3; grid-row: 5; }
      .local-activity-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .local-activity-grid { grid-template-columns: 1fr; }
      .persona-name { font-size: 42px; }
      .persona-code { font-size: 50px; }
      .tool-review-layout { grid-template-columns: 220px minmax(0, 1fr); }
      .additional-category-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 700px) {
      .persona-page { display: block; padding: 10px; }
      .persona-card {
        width: 100%;
        min-height: calc(100vh - 20px);
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        border-radius: 30px;
      }
      .persona-identity { min-height: auto; padding: 8px 8px 18px; }
      .persona-name { font-size: 36px; }
      .persona-subtitle { font-size: 17px; }
      .hidden-persona { font-size: 12px; }
      .persona-figure { min-height: 0; }
      .persona-figure-image { width: min(100%, 160px); max-height: 160px; }
      .persona-figure-fallback { font-size: 90px; }
      .persona-signature { margin-bottom: 24px; font-size: 15px; }
      .creator-name-static,
      .creator-name-editor input { font-size: 25px; }
      .metric-tile,
      .tag-tile { flex: 0 0 auto; min-height: 210px; border-radius: 22px; }
      .usage-tile {
        min-height: 174px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        padding: 24px 14px;
      }
      .usage-stat strong { font-size: 28px; }
      .usage-stat span { font-size: 13px; }
      .local-activity-panel {
        margin-top: 12px;
        padding: 18px;
        border-radius: 22px;
      }
      .local-activity-header {
        align-items: start;
        flex-direction: column;
      }
      .local-activity-stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .heatmap-cells { grid-template-columns: repeat(10, minmax(0, 1fr)); }
      .persona-code { font-size: 46px; }
      .ai-tile { padding: 30px; }
      .tag-tile h2 { font-size: 26px; }
      .editor-controls {
        grid-template-columns: 1fr;
        border-radius: 16px;
      }
      .editor-controls button,
      .editor-controls a {
        width: 100%;
      }
      .tool-review-header { padding: 22px; }
      .tool-review-header { display: block; }
      .tool-review-progress { display: inline-flex; margin-top: 14px; }
      .tool-review-layout { display: block; min-height: 0; }
      .tool-review-queue {
        flex-direction: row;
        overflow-x: auto;
        border-right: 0;
        border-bottom: 1px solid rgba(21, 18, 28, 0.1);
      }
      .tool-review-queue-item { flex: 0 0 220px; }
      .tool-review-form { padding: 22px; }
      .tool-listing-heading { grid-template-columns: 64px minmax(0, 1fr); }
      .tool-icon-preview { width: 64px; height: 64px; }
      .generate-icon-button { grid-column: 1 / -1; width: 100%; }
      .tool-listing-fields { grid-template-columns: 1fr; }
      .tool-field,
      .tool-field-title,
      .tool-field-description,
      .tool-field-categories { grid-column: 1; }
      .additional-category-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .tool-review-footer { align-items: stretch; flex-direction: column; }
      .tool-review-footer button { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <main class="persona-page">
    ${model.readonlyPreview ? `<section class="preview-notice" aria-label="只读预览说明">
      <strong>这是只读预览</strong>
      <span>添加本地工具包、修改名字和发布 Creator Profile，请让 Codex 打开可编辑预览页。</span>
    </section>` : ''}
    <article class="persona-card" aria-label="Taku 人格卡片">
      <section class="persona-identity">
        <h1 class="persona-name">${escapeHtml(model.persona.title)}</h1>
        ${model.persona.subtitle ? `<p class="persona-subtitle">${escapeHtml(model.persona.subtitle)}</p>` : ''}
        ${model.persona.hiddenLabel ? `<p class="hidden-persona" title="${escapeHtml(model.persona.hiddenDetail)}"><span>Hidden Trait</span>${escapeHtml(model.persona.hiddenLabel)}</p>` : ''}
        <div class="persona-figure">${renderPersonaFigure(model)}</div>
        ${model.persona.signature ? `<p class="persona-signature">“${escapeHtml(model.persona.signature)}”</p>` : ''}
        ${renderCreatorName(model)}
        ${renderProfileTags(model)}
      </section>

      <section class="metric-tile code-tile" aria-label="人格代码">
        <p class="tile-kicker">Persona Code</p>
        <p class="persona-code">${escapeHtml(model.persona.code)}</p>
        <p class="code-title">${escapeHtml(model.persona.title)}</p>
      </section>

      <section class="metric-tile ai-tile" aria-label="AI 工具占比">
        <h2>AI 工具占比</h2>
        <div class="ai-share-list">
          ${model.usage.aiTools.map((tool) => `<div class="ai-share-row"><span>${escapeHtml(tool.name)}</span><strong>${escapeHtml(formatShare(tool.share))}</strong></div>`).join('\n')}
        </div>
      </section>

      <section class="metric-tile usage-tile" aria-label="${escapeHtml(model.usage.period)} 使用数据">
        <div class="usage-stat"><strong>${escapeHtml(model.usage.tokens)}</strong><span>tokens</span></div>
        <div class="usage-stat"><strong>${escapeHtml(model.usage.apiListEquivalent)}</strong><span>API equivalent</span></div>
        <div class="usage-stat"><strong>${escapeHtml(model.usage.calls)}</strong><span>calls</span></div>
      </section>

      ${model.tags.map((tag, index) => renderTagTile(tag, index, tagClasses[index], model)).join('\n')}
    </article>
    ${renderLocalActivityPanel(model)}
    ${renderToolReviewPanel(model)}
    ${model.canSave ? `<section class="editor-controls" aria-label="Creator Profile 发布工具">
      <label class="sr-only" for="localPackagePathInput">本地工具包路径</label>
      <input id="localPackagePathInput" type="text" autocomplete="off" placeholder="粘贴本地工具包路径，例如你的 my-skill 文件夹">
      <button id="addLocalPackageButton" class="add-package" type="button">添加本地工具包</button>
      <button id="publishProfileButton" class="publish-profile" type="button">发布 Profile${model.featuredTools.length ? ` 与 ${model.featuredTools.length} 个工具` : ''}</button>
      <a id="takuLoginLink" class="login-link is-hidden" href="#" target="_blank" rel="noreferrer">登录 Taku</a>
      <p id="editorActionStatus" class="editor-status" aria-live="polite"></p>
    </section>` : ''}
  </main>
  ${model.canSave ? `<script>
    (() => {
      const initial = ${jsonForScript({
        displayName: model.creator.displayName,
        card: model.card,
        reviewTools: model.featuredTools,
        categories: MARKETPLACE_CATEGORIES,
      })};
      const input = document.getElementById('creatorNameInput');
      const status = document.getElementById('saveStatus');
      const packageInput = document.getElementById('localPackagePathInput');
      const addPackageButton = document.getElementById('addLocalPackageButton');
      const publishButton = document.getElementById('publishProfileButton');
      const actionStatus = document.getElementById('editorActionStatus');
      const loginLink = document.getElementById('takuLoginLink');
      const featuredTools = document.querySelector('.featured-tools');
      const reviewPanel = document.getElementById('toolReviewPanel');
      const reviewQueue = document.getElementById('toolReviewQueue');
      const reviewProgress = document.getElementById('toolReviewProgress');
      const reviewForm = document.getElementById('toolReviewForm');
      const reviewStatus = document.getElementById('toolReviewStatus');
      const toolIconPreview = document.getElementById('toolIconPreview');
      const toolTypeBadge = document.getElementById('toolTypeBadge');
      const toolTitleInput = document.getElementById('toolListingTitle');
      const toolDescriptionInput = document.getElementById('toolListingDescription');
      const toolDescriptionCount = document.getElementById('toolDescriptionCount');
      const toolCategorySelect = document.getElementById('toolListingCategory');
      const toolTagsInput = document.getElementById('toolListingTags');
      const additionalCategoryInputs = Array.from(document.querySelectorAll('[data-additional-category]'));
      const generateIconButton = document.getElementById('generateToolIconButton');
      const saveListingButton = document.getElementById('saveToolListingButton');
      const reviewTools = Array.isArray(initial.reviewTools) ? initial.reviewTools : [];
      let activeToolId = sessionStorage.getItem('takuReviewToolId') || reviewTools[0]?.id || '';
      let timer;
      let lastSaved = initial.displayName;

      const setStatus = (state, title) => {
        if (!status) return;
        status.className = state;
        status.title = title;
      };
      const setActionStatus = (message) => {
        if (!actionStatus) return;
        actionStatus.textContent = message || '';
      };
      const setBusy = (button, busy) => {
        if (!button) return;
        button.disabled = Boolean(busy);
      };
      const showLogin = (url) => {
        if (!loginLink || !url) return;
        loginLink.href = url;
        loginLink.classList.remove('is-hidden');
      };
      const activeTool = () => reviewTools.find((tool) => tool.id === activeToolId) || reviewTools[0] || null;
      const listingReady = (tool) => Boolean(
        tool?.listing?.title &&
        tool?.listing?.shortDescription &&
        tool?.listing?.category &&
        tool?.listing?.type &&
        tool?.listing?.coverImageUrl &&
        tool?.status === 'ready'
      );
      const iconMarkup = (tool, className) => {
        const iconUrl = String(tool?.listing?.coverImageUrl || '').trim();
        if (iconUrl) return '<img src="' + iconUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" alt="">';
        const initialValue = Array.from(tool?.listing?.title || tool?.name || 'T')[0] || 'T';
        return '<span class="' + (className || '') + '">' + initialValue.toUpperCase() + '</span>';
      };
      const setReviewStatus = (message, state) => {
        if (!reviewStatus) return;
        reviewStatus.textContent = message || '';
        reviewStatus.className = state ? 'is-' + state : '';
      };
      const updateDescriptionCount = () => {
        if (!toolDescriptionCount) return;
        toolDescriptionCount.textContent = String(toolDescriptionInput?.value.length || 0) + '/220';
      };
      const renderReviewQueue = () => {
        if (!reviewQueue) return;
        reviewQueue.innerHTML = reviewTools.map((tool) => {
          const ready = listingReady(tool);
          const title = String(tool.listing?.title || tool.name || 'Untitled');
          return '<button type="button" class="tool-review-queue-item' + (tool.id === activeToolId ? ' is-active' : '') + '" data-review-tool-id="' + tool.id + '">' +
            '<span class="tool-review-queue-icon">' + iconMarkup(tool) + '</span>' +
            '<span class="tool-review-queue-copy"><strong></strong><small>' + (ready ? '已就绪' : '待审核') + '</small></span>' +
            '<i class="' + (ready ? 'is-ready' : '') + '" aria-hidden="true"></i></button>';
        }).join('');
        reviewQueue.querySelectorAll('.tool-review-queue-copy strong').forEach((node, index) => {
          node.textContent = reviewTools[index]?.listing?.title || reviewTools[index]?.name || 'Untitled';
        });
        const readyCount = reviewTools.filter(listingReady).length;
        if (reviewProgress) reviewProgress.textContent = String(readyCount) + '/' + String(reviewTools.length) + ' 已就绪';
      };
      const syncAdditionalCategoryState = () => {
        const primary = String(toolCategorySelect?.value || '');
        additionalCategoryInputs.forEach((checkbox) => {
          if (checkbox.value === primary) checkbox.checked = false;
          checkbox.disabled = checkbox.value === primary;
        });
      };
      const openToolReview = (toolId, shouldScroll) => {
        const tool = reviewTools.find((entry) => entry.id === toolId) || reviewTools[0];
        if (!tool) return;
        activeToolId = tool.id;
        sessionStorage.setItem('takuReviewToolId', tool.id);
        const listing = tool.listing || {};
        if (toolIconPreview) toolIconPreview.innerHTML = iconMarkup(tool);
        if (toolTypeBadge) toolTypeBadge.textContent = listing.type || tool.type || 'Skill';
        if (toolTitleInput) toolTitleInput.value = listing.title || tool.name || '';
        if (toolDescriptionInput) toolDescriptionInput.value = listing.shortDescription || '';
        if (toolCategorySelect) toolCategorySelect.value = listing.category || '';
        if (toolTagsInput) toolTagsInput.value = Array.isArray(listing.tags) ? listing.tags.join(', ') : '';
        const additional = new Set(Array.isArray(listing.additionalCategories) ? listing.additionalCategories : []);
        additionalCategoryInputs.forEach((checkbox) => { checkbox.checked = additional.has(checkbox.value); });
        syncAdditionalCategoryState();
        updateDescriptionCount();
        setReviewStatus(
          listingReady(tool)
            ? '这个工具已经通过审核，可以随 Profile 一起发布。'
            : '补齐必填信息并生成图标后，工具即可发布。',
          listingReady(tool) ? 'ready' : ''
        );
        renderReviewQueue();
        if (shouldScroll) reviewPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      const readListingForm = () => {
        const tool = activeTool();
        const tags = String(toolTagsInput?.value || '').split(/[,，]/).map((value) => value.trim()).filter(Boolean).slice(0, 5);
        const additionalCategories = additionalCategoryInputs
          .filter((checkbox) => checkbox.checked && checkbox.value !== toolCategorySelect?.value)
          .map((checkbox) => checkbox.value)
          .slice(0, 3);
        return {
          ...(tool?.listing || {}),
          title: String(toolTitleInput?.value || '').trim().slice(0, 120),
          shortDescription: String(toolDescriptionInput?.value || '').trim().slice(0, 220),
          description: String(toolDescriptionInput?.value || '').trim().slice(0, 1200),
          category: String(toolCategorySelect?.value || '').trim(),
          additionalCategories,
          type: String(tool?.listing?.type || tool?.type || 'skill'),
          tags,
          visibility: 'public',
        };
      };
      const saveToolListing = async (options = {}) => {
        const tool = activeTool();
        if (!tool) return false;
        const listing = options.listing || readListingForm();
        if (!listing.title || !listing.shortDescription || !listing.category) {
          setReviewStatus('请先填写标题、简短描述和主分类。', 'error');
          return false;
        }
        if (!listing.coverImageUrl && !options.allowMissingIcon) {
          setReviewStatus('还差一个图标。点击“生成图标”后即可完成审核。', 'error');
          return false;
        }
        setBusy(saveListingButton, true);
        if (!options.quiet) setReviewStatus('正在保存 Marketplace 信息...');
        try {
          const response = await fetch('/api/listing-draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolId: tool.id, listing }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.ok === false) throw new Error(result.error || '保存失败');
          tool.listing = result.listingDraft?.listing || listing;
          tool.status = result.listingDraft?.status || 'draft';
          renderReviewQueue();
          openToolReview(tool.id, false);
          setReviewStatus(
            listingReady(tool) ? '审核完成：这个工具可以随 Profile 一起发布。' : '草稿已保存，还需要生成图标。',
            listingReady(tool) ? 'ready' : ''
          );
          return true;
        } catch (error) {
          setReviewStatus(error?.message || '保存失败', 'error');
          return false;
        } finally {
          setBusy(saveListingButton, false);
        }
      };
      const refreshLoginLink = async () => {
        const response = await fetch('/api/publish/status');
        const result = await response.json().catch(() => ({}));
        if (result.loginUrl) showLogin(result.loginUrl);
      };
      const completeTakuAuthorization = async () => {
        const hash = window.location.hash.startsWith('#')
          ? window.location.hash.slice(1)
          : window.location.hash;
        const params = new URLSearchParams(hash);
        const code = String(params.get('taku_auth_code') || '').trim();
        const authState = String(params.get('taku_auth_state') || '').trim();
        if (!code || !authState) return;

        setBusy(publishButton, true);
        setActionStatus('正在完成 Taku 授权...');
        try {
          const response = await fetch('/api/auth/local-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, state: authState }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.ok === false) {
            throw new Error(result.error || 'Taku 授权失败，请重新登录。');
          }
          loginLink?.classList.add('is-hidden');
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
          setActionStatus('Taku 授权成功，可以发布了。');
        } catch (error) {
          setActionStatus(error?.message || 'Taku 授权失败，请重新登录。');
          await refreshLoginLink().catch(() => {});
        } finally {
          setBusy(publishButton, false);
        }
      };

      const save = async () => {
        const displayName = String(input?.value || '').trim().slice(0, 80);
        if (!displayName || displayName === lastSaved) return;
        setStatus('saving', '正在保存');
        try {
          const response = await fetch('/api/card', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card: { ...initial.card, name: displayName } }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.ok === false) throw new Error(result.error || '保存失败');
          lastSaved = displayName;
          setStatus('saved', '已保存');
        } catch (error) {
          setStatus('saving', error?.message || '保存失败');
        }
      };

      input?.addEventListener('input', () => {
        window.clearTimeout(timer);
        setStatus('saving', '等待保存');
        timer = window.setTimeout(save, 500);
      });
      input?.addEventListener('blur', () => {
        window.clearTimeout(timer);
        void save();
      });
      input?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        input.blur();
      });

      reviewQueue?.addEventListener('click', (event) => {
        const button = event.target?.closest?.('[data-review-tool-id]');
        const toolId = String(button?.getAttribute('data-review-tool-id') || '').trim();
        if (toolId) openToolReview(toolId, false);
      });
      toolDescriptionInput?.addEventListener('input', updateDescriptionCount);
      toolCategorySelect?.addEventListener('change', syncAdditionalCategoryState);
      additionalCategoryInputs.forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          const selected = additionalCategoryInputs.filter((input) => input.checked);
          if (selected.length <= 3) return;
          checkbox.checked = false;
          setReviewStatus('附加分类最多选择 3 个。', 'error');
        });
      });
      reviewForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        void saveToolListing();
      });
      generateIconButton?.addEventListener('click', async () => {
        const tool = activeTool();
        if (!tool) return;
        const listing = readListingForm();
        if (!listing.title || !listing.shortDescription || !listing.category) {
          setReviewStatus('生成图标前，请先填写标题、简短描述和主分类。', 'error');
          return;
        }
        setBusy(generateIconButton, true);
        setReviewStatus('Taku 正在根据工具信息生成图标...');
        try {
          const response = await fetch('/api/listing-icon/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolId: tool.id, listing }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.ok === false) {
            if (result.loginUrl) showLogin(result.loginUrl);
            throw new Error(result.error || '图标生成失败');
          }
          tool.listing = result.listing || { ...listing, coverImageUrl: result.icon?.imageUrl || '' };
          if (toolIconPreview) toolIconPreview.innerHTML = iconMarkup(tool);
          const saved = await saveToolListing({ listing: tool.listing, quiet: true });
          if (saved) setReviewStatus('图标与 Marketplace 信息已保存，审核完成。', 'ready');
        } catch (error) {
          setReviewStatus(error?.message || '图标生成失败', 'error');
        } finally {
          setBusy(generateIconButton, false);
        }
      });

      addPackageButton?.addEventListener('click', async () => {
        const localPath = String(packageInput?.value || '').trim();
        if (!localPath) {
          setActionStatus('请先粘贴本地工具包路径。');
          packageInput?.focus();
          return;
        }
        setBusy(addPackageButton, true);
        setActionStatus('正在添加本地工具包...');
        try {
          const response = await fetch('/api/local-package', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ localPath }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.ok === false) throw new Error(result.error || '添加失败');
          const name = result.tool?.name || '本地工具包';
          if (result.tool?.id) sessionStorage.setItem('takuReviewToolId', result.tool.id);
          setActionStatus('已添加 ' + name + '。接下来请审核它的 Marketplace 信息。');
          window.setTimeout(() => window.location.reload(), 700);
        } catch (error) {
          setActionStatus(error?.message || '添加失败');
        } finally {
          setBusy(addPackageButton, false);
        }
      });

      featuredTools?.addEventListener('click', async (event) => {
        const button = event.target?.closest?.('[data-remove-local-tool]');
        if (!button) return;
        const toolId = String(button.getAttribute('data-remove-local-tool') || '').trim();
        if (!toolId) return;
        setBusy(button, true);
        setActionStatus('正在删除本地工具包...');
        try {
          const response = await fetch('/api/local-package/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolId }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.ok === false) throw new Error(result.error || '删除失败');
          setActionStatus('已删除本地工具包。');
          window.setTimeout(() => window.location.reload(), 450);
        } catch (error) {
          setActionStatus(error?.message || '删除失败');
          setBusy(button, false);
        }
      });

      publishButton?.addEventListener('click', async () => {
        const pendingTools = reviewTools.filter((tool) => !listingReady(tool));
        if (pendingTools.length) {
          openToolReview(pendingTools[0].id, true);
          setActionStatus('还有 ' + String(pendingTools.length) + ' 个工具未完成发布审核。');
          setReviewStatus('完成当前工具的标题、描述、分类和图标后才能发布。', 'error');
          return;
        }
        setBusy(publishButton, true);
        setActionStatus('正在发布 Creator Profile...');
        try {
          const response = await fetch('/api/publish', { method: 'POST' });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.ok === false) {
            if (result.code === 'listing_review_required' && Array.isArray(result.reviewToolIds)) {
              openToolReview(result.reviewToolIds[0], true);
            }
            if (result.loginUrl) {
              showLogin(result.loginUrl);
              throw new Error(result.message || result.error || '需要先登录 Taku。');
            }
            throw new Error(result.error || result.message || '发布失败');
          }
          const url = result.profilePageUrl || result.creatorPageUrl || result.publicUrl || result.links?.profilePageUrl || result.links?.creatorPageUrl || '';
          setActionStatus(url ? '已发布：' + url : '已发布 Creator Profile。');
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
        } catch (error) {
          setActionStatus(error?.message || '发布失败');
        } finally {
          setBusy(publishButton, false);
        }
      });
      if (reviewTools.length) openToolReview(activeToolId, false);
      void completeTakuAuthorization();
    })();
  </script>` : ''}
</body>
</html>`;
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function formatUsableApiListEquivalent(usage) {
  const cost = recordValue(usage?.estimatedCost || usage?.modelUsage?.estimatedCost);
  const amount = Number(cost.totalUsd);
  if (!Number.isFinite(amount) || amount <= 0) return 'n/a';
  const coverage = Number(cost.coverageRatio);
  if (Number.isFinite(coverage) && coverage < 0.95) return 'n/a';
  return formatEstimatedUsd(amount);
}

function firstNonEmptyRecord(...values) {
  for (const value of values) {
    const record = recordValue(value);
    if (Object.keys(record).length > 0) return record;
  }
  return {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function metricValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function displayMetric(value, fallback = '0') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return formatCompactMetric(value);
  return cleanDisplayText(value, fallback, 80);
}

function displayPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '0%';
  const percent = number <= 1 ? number * 100 : number;
  return `${round(percent, 1)}%`;
}

function displayTopPercent(topPercent, percentile) {
  const explicit = Number(topPercent);
  if (Number.isFinite(explicit) && explicit > 0) return `Top ${displayPercent(explicit)}`;
  const rank = Number(percentile);
  if (Number.isFinite(rank) && rank > 0) return `Top ${displayPercent(1 - rank)}`;
  return 'n/a';
}

function displayRankGrade(rankGrade = {}, percentiles = {}) {
  const label = cleanDisplayText(rankGrade.label, '', 80);
  if (label) return label;
  const grade = cleanDisplayText(rankGrade.grade, '', 20);
  if (grade && grade.toLowerCase() !== 'unranked') return grade;
  const bestRank = Math.max(
    Number(percentiles.installs) || 0,
    Number(percentiles.subscribers) || 0,
    Number(percentiles.tokens) || 0,
    Number(percentiles.stars) || 0,
  );
  if (bestRank >= 0.99) return 'S / Top 1%';
  if (bestRank >= 0.95) return 'A / Top 5%';
  if (bestRank >= 0.9) return 'B / Top 10%';
  if (bestRank > 0) return 'C';
  return 'n/a';
}

function displayNullableMetric(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    return displayMetric(value);
  }
  return 'n/a';
}

function staxBlockEntry(blocks, id) {
  if (Array.isArray(blocks)) {
    return recordValue(blocks.find((block) => block?.id === id || block?.key === id || block?.name === id));
  }
  return recordValue(recordValue(blocks)[id]);
}

function staxBlockSupported(block) {
  const record = recordValue(block);
  if (Object.keys(record).length === 0) return false;
  if (record.supported === false || record.available === false) return false;
  const status = cleanDisplayText(record.status, '', 40).toLowerCase();
  return status ? ['supported', 'partial', 'available', 'ready'].includes(status) : true;
}

function displayStaxBlock(blocks, id) {
  const block = staxBlockEntry(blocks, id);
  if (Object.keys(block).length === 0) return 'n/a';
  if (!staxBlockSupported(block)) {
    const reason = cleanDisplayText(block.reason || block.message, '', 120);
    return reason ? `unsupported: ${reason}` : 'unsupported';
  }
  const value = recordValue(block.value);
  const quality = recordValue(block.quality);
  const detail = cleanDisplayText(
    block.display ||
      block.label ||
      value.display ||
      value.label ||
      value.value ||
      value.tier ||
      value.serial ||
      value.basicVal ||
      block.tier ||
      block.grade,
    '',
    80,
  );
  const status = cleanDisplayText(block.status, '', 40).toLowerCase();
  const qualityLabel = cleanDisplayText(quality.label, '', 40);
  const prefix = status === 'partial'
    ? (qualityLabel ? `partial/${qualityLabel}` : 'partial')
    : 'supported';
  return detail ? `${prefix}: ${detail}` : prefix;
}

function listStaxBlocks(blocks, expectedSupported) {
  const source = Array.isArray(blocks)
    ? blocks
    : Object.entries(recordValue(blocks)).map(([id, block]) => ({ id, ...recordValue(block) }));
  return source
    .filter((block) => staxBlockSupported(block) === expectedSupported)
    .map((block) => cleanDisplayText(block.id || block.key || block.name, '', 40))
    .filter(Boolean)
    .join(', ') || 'n/a';
}

function collectDataOnlyRows(draft = {}) {
  const snapshot = getBuilderProfileSnapshotForDisplay(draft);
  const usage = recordValue(draft?.stats?.usage || snapshot.usage);
  const localActivity = recordValue(usage.localActivity);
  const sessionSplit = recordValue(localActivity.sessionSplit);
  const buildStreak = recordValue(localActivity.buildStreak);
  const workPattern = recordValue(localActivity.workPattern);
  const modelUsage = recordValue(usage.modelUsage);
  const card = cardSettingsForDraft(draft);
  const draftCard = recordValue(draft.card);
  const staxProfile = recordValue(draft.staxProfile || draft.serverStaxProfile);
  const staxSerial = recordValue(staxProfile.serial);
  const staxPlatform = recordValue(staxProfile.platform);
  const staxRank = recordValue(staxProfile.rank);
  const staxBlocks = recordValue(draft.staxBlocks).blocks || staxProfile.blocks || {};
  const external = firstNonEmptyRecord(
    draft.creatorStats,
    draft.externalMetrics,
    draft.personaSignals?.external,
    snapshot.external,
  );
  const taku = { ...recordValue(external.taku), ...staxPlatform };
  const github = recordValue(external.github);
  const percentiles = firstNonEmptyRecord(staxRank.percentiles, external.percentiles);
  const topPercentiles = firstNonEmptyRecord(staxRank.topPercentiles, external.topPercentiles);
  const rankGrade = recordValue(staxRank.rankGrade || external.rankGrade || taku.rankGrade);
  const dailyHeatmap = arrayValue(localActivity.dailyHeatmap);
  const trendBuckets = arrayValue(localActivity.trend30d?.buckets);
  const modelRows = arrayValue(modelUsage.topModels || modelUsage.models);

  return {
    summaryRows: [
      ['handle', staxProfile.handle || staxProfile.username || card.handle || draft.creator?.username || draft.creator?.handle || 'n/a'],
      ['card serial number', staxSerial.display || staxProfile.serialNumber || card.serialNumber || card.serial_number || draftCard.serialNumber || draftCard.serial_number || 'n/a'],
      ['days on Taku', displayNullableMetric(staxProfile.daysOnTaku)],
      ['supported Stax blocks', listStaxBlocks(staxBlocks, true)],
      ['unsupported Stax blocks', listStaxBlocks(staxBlocks, false)],
      ['seal', displayStaxBlock(staxBlocks, 'seal')],
      ['aura', displayStaxBlock(staxBlocks, 'aura')],
      ['water', displayStaxBlock(staxBlocks, 'water')],
      ['tier4', displayStaxBlock(staxBlocks, 'tier4')],
      ['cgauge', displayStaxBlock(staxBlocks, 'cgauge')],
      ['ctxring', displayStaxBlock(staxBlocks, 'ctxring')],
      ['vsavg', displayStaxBlock(staxBlocks, 'vsavg')],
      ['dial', displayStaxBlock(staxBlocks, 'dial')],
      ['daily heatmap', `${displayMetric(dailyHeatmap.filter((row) => row?.active !== false).length)} days with AI activity`],
      ['daily builds', displayMetric(localActivity.buildSessionCount || sessionSplit.buildSessionCount)],
      ['streak days', displayMetric(buildStreak.currentDays)],
      ['active hours', formatActiveHours(workPattern)],
      ['chat/build split', formatSessionSplit(sessionSplit)],
      ['tool calls', displayMetric(localActivity.toolCallCount || usage.eventCount || modelUsage.observedEventCount)],
      ['model mix', modelRows.length ? modelRows.map((row) => cleanDisplayText(row.modelId || row.name, 'model', 60)).join(', ') : 'n/a'],
      ['tokens', displayMetric(usage.totalTokens || modelUsage.totalTokens)],
      ['API-equivalent market estimate', formatUsableApiListEquivalent(usage)],
      ['trend chart', trendBuckets.length ? `${trendBuckets.length} buckets` : 'n/a'],
      ['30-day delta', formatDeltaMetric(localActivity.delta30d)],
      ['Marketplace installs', displayMetric(taku.skillInstallCount)],
      ['published works', displayMetric(taku.publishedItemCount ?? taku.skillCount)],
      ['subscribers', displayMetric(taku.subscriberCount)],
      ['shares', displayMetric(taku.shareCount)],
      ['public card view count', displayNullableMetric(card.viewCount, card.view_count, draftCard.viewCount, draftCard.view_count)],
      ['share count for Stax Card', displayNullableMetric(card.shareCount, card.share_count, draftCard.shareCount, draftCard.share_count)],
      ['registration rank', taku.registrationRank ? `#${displayMetric(taku.registrationRank)}` : 'n/a'],
      ['rank grade', displayRankGrade(rankGrade, percentiles)],
      ['community compare', percentiles.installs || percentiles.subscribers ? `installs ${displayTopPercent(topPercentiles.installs, percentiles.installs)}, subscribers ${displayTopPercent(topPercentiles.subscribers, percentiles.subscribers)}` : 'n/a'],
      ['Top % installs', displayTopPercent(topPercentiles.installs, percentiles.installs)],
      ['Top % subscribers', displayTopPercent(topPercentiles.subscribers, percentiles.subscribers)],
      ['Top % tokens', displayTopPercent(topPercentiles.tokens, percentiles.tokens)],
      ['Top % stars', displayTopPercent(topPercentiles.stars, percentiles.stars)],
      ['GitHub stars', displayMetric(github.totalStars)],
      ['public repos', displayMetric(github.publicRepoCount)],
    ],
    dailyHeatmap,
    trendBuckets,
    modelRows,
    raw: {
      localActivity,
      creatorStats: external,
      staxProfile,
    },
  };
}

function renderRows(rows) {
  return rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join('\n');
}

function renderDataOnlyPreview(draft, options = {}) {
  const data = collectDataOnlyRows(draft);
  const readonlyNote = options.readonlyPreview ? '<p>这是只读预览。</p>' : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Taku Creator Data</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; line-height: 1.5; color: #17171f; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0 28px; }
    th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; }
    pre { background: #f6f6f6; padding: 12px; overflow: auto; }
  </style>
</head>
<body>
  <h1>Taku Creator 数据维度</h1>
  ${readonlyNote}
  <h2>汇总</h2>
  <table>
    <thead><tr><th>数据</th><th>值</th></tr></thead>
    <tbody>${renderRows(data.summaryRows)}</tbody>
  </table>
  <h2>daily heatmap</h2>
  <table>
    <thead><tr><th>date</th><th>active</th><th>sessions</th><th>builds</th><th>tool calls</th><th>tokens</th></tr></thead>
    <tbody>${data.dailyHeatmap.map((row) => `<tr><td>${escapeHtml(row?.date || '')}</td><td>${escapeHtml(row?.active !== false ? 'yes' : 'no')}</td><td>${escapeHtml(displayMetric(row?.sessionCount))}</td><td>${escapeHtml(displayMetric(row?.buildSessionCount))}</td><td>${escapeHtml(displayMetric(row?.toolCallCount))}</td><td>${escapeHtml(displayMetric(row?.tokenCount))}</td></tr>`).join('\n') || '<tr><td colspan="6">n/a</td></tr>'}</tbody>
  </table>
  <h2>trend chart</h2>
  <table>
    <thead><tr><th>bucket</th><th>build sessions</th><th>sessions</th><th>tokens</th></tr></thead>
    <tbody>${data.trendBuckets.map((row) => `<tr><td>${escapeHtml(row?.label || row?.id || '')}</td><td>${escapeHtml(displayMetric(row?.buildSessionCount))}</td><td>${escapeHtml(displayMetric(row?.sessionCount))}</td><td>${escapeHtml(displayMetric(row?.tokenCount))}</td></tr>`).join('\n') || '<tr><td colspan="4">n/a</td></tr>'}</tbody>
  </table>
  <h2>model mix</h2>
  <table>
    <thead><tr><th>model</th><th>tokens</th><th>events</th></tr></thead>
    <tbody>${data.modelRows.map((row) => `<tr><td>${escapeHtml(row?.modelId || row?.name || '')}</td><td>${escapeHtml(displayMetric(row?.totalTokens))}</td><td>${escapeHtml(displayMetric(row?.eventCount))}</td></tr>`).join('\n') || '<tr><td colspan="3">n/a</td></tr>'}</tbody>
  </table>
  <h2>raw aggregates</h2>
  <pre>${escapeHtml(JSON.stringify(data.raw, null, 2))}</pre>
</body>
</html>`;
}

function staxBlockDisplayText(block, key) {
  const record = recordValue(block);
  const value = recordValue(record.value);
  const candidates = [
    record.display,
    record.label,
    value.display,
    value.label,
    value.value,
    value.tokensAllTime,
    value.tier,
    value.serial,
    value.basicVal,
    value.type,
    value.team,
    value.shipped,
    value.score,
    value.usedPercent !== undefined && value.usedPercent !== null ? `${value.usedPercent}%` : '',
    record.tier,
    record.grade,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const text = candidate.map((item) => cleanDisplayText(item, '', 40)).filter(Boolean).join(' / ');
      if (text) return text;
    }
    const text = cleanDisplayText(candidate, '', 80);
    if (text) return text;
  }
  return key.toUpperCase();
}

function normalizeStaxAppBlock(rawBlock, key) {
  const block = recordValue(rawBlock);
  const statusText = cleanDisplayText(block.status, '', 40).toLowerCase();
  const supported = staxBlockSupported(block);
  const status = supported
    ? (statusText === 'partial' ? 'partial' : 'supported')
    : 'unsupported';
  const quality = recordValue(block.quality);
  const value = recordValue(block.value);
  return {
    key,
    label: STAX_BLOCK_LABELS[key] || key,
    size: STAX_BLOCK_SIZES[key] || [1, 1],
    status,
    display: supported ? staxBlockDisplayText(block, key) : 'LOCKED',
    value,
    reason: englishDisplayText(block.reason || block.message, 'This block is not available from the local publisher scan yet.', 180),
    lockLabel: cleanDisplayText(block.lockLabel || block.lock_label, '', 40),
    lockReason: englishDisplayText(block.lockReason || block.lock_reason, '', 180),
    qualityLabel: englishDisplayText(quality.label, '', 40),
    estimated: block.estimated === true || quality.estimated === true,
    source: cleanDisplayText(block.source, '', 100),
  };
}

function qrOptionForStax(id, label, url) {
  const qr = createQrMatrix(url, { errorCorrectionLevel: 'M' });
  return {
    id,
    label,
    url,
    size: qr.size,
    matrix: qr.matrix,
    errorCorrectionLevel: qr.errorCorrectionLevel,
  };
}

function buildStaxAppModel(draft = {}, options = {}) {
  const snapshot = getBuilderProfileSnapshotForDisplay(draft);
  const card = cardSettingsForDraft(draft);
  const persona = recordValue(snapshot.persona || draft.personaV2);
  const usage = recordValue(snapshot.usage || draft.stats?.usage);
  const loginUrl = cleanDisplayText(options.editor?.publish?.loginUrl, '', 800);
  const isTakuAuthorized = Boolean(options.editor?.publish?.authenticated || options.editor?.publish?.canPublish);
  const staxProfile = recordValue(draft.staxProfile || draft.serverStaxProfile);
  const trustedStaxProfile = isTakuAuthorized ? staxProfile : {};
  const staxRank = recordValue(trustedStaxProfile.rank);
  const rawBlocks = recordValue(draft.staxBlocks).blocks || staxProfile.blocks || {};
  const blocks = STAX_BLOCK_KEYS.map((key) => {
    const block = normalizeStaxAppBlock(staxBlockEntry(rawBlocks, key), key);
    if (!isTakuAuthorized && TRUSTED_TAKU_BLOCK_KEYS.has(key) && block.status !== 'unsupported') {
      const lockLabel = key === 'cgauge' ? QUOTA_LOCK_LABEL : COMMUNITY_RANK_LOCK_LABEL;
      const lockReason = key === 'cgauge' ? QUOTA_LOCK_REASON : COMMUNITY_RANK_LOCK_REASON;
      return {
        ...block,
        status: 'unsupported',
        display: 'LOCKED',
        value: {},
        reason: lockReason,
        lockLabel,
        lockReason,
      };
    }
    return block;
  });
  const supportedKeys = new Set(blocks.filter((block) => block.status !== 'unsupported').map((block) => block.key));
  const selectedKeys = STAX_DEFAULT_BLOCKS.filter((key) => supportedKeys.has(key));
  if (!selectedKeys.includes('hero') && supportedKeys.has('hero')) selectedKeys.unshift('hero');
  const fallbackKeys = blocks
    .filter((block) => block.status !== 'unsupported' && !selectedKeys.includes(block.key) && !STAX_INLINE_BLOCK_KEYS.has(block.key))
    .map((block) => block.key)
    .slice(0, Math.max(0, 10 - selectedKeys.length));
  const publishedStaxSource = recordValue(draft.publishedStax || draft.stats?.publishedStax);
  const publishedStaxUsername = publishedStaxSource.published === true
    ? cleanDisplayText(publishedStaxSource.username || publishedStaxSource.handle, '', 120)
    : '';
  const displayName = cleanDisplayText(card.name || draft.creator?.name || draft.creator?.displayName, 'Taku Creator', 80);
  const trustedHandle = cleanDisplayText(
    trustedStaxProfile.handle || trustedStaxProfile.username || publishedStaxUsername,
    '',
    40,
  );
  const handle = cleanDisplayText(trustedHandle || draft.creator?.handle || draft.creator?.username, '@builder', 40);
  const connectedDisplayName = cleanDisplayText(draft.creator?.name || draft.creator?.displayName || card.name, '', 40);
  const canonicalCode = canonicalPersonaCode(persona.code || draft.personaV2?.code);
  const code = canonicalCode || cleanDisplayText(persona.code || draft.personaV2?.code, 'AI', 16).toUpperCase();
  const personaTitle = personaTitleForStax(canonicalCode, persona.title || draft.personaV2?.archetype?.title);
  const personaName = splitPersonaTitleForStax(personaTitle);
  const personaIdentity = recordValue(persona.identity || draft.personaV2?.identity);
  const personaHidden = publicHiddenPersona(
    persona.hidden?.featured ||
      persona.featuredHidden ||
      persona.selectedHidden ||
      personaIdentity.hidden?.featured ||
      draft.personaV2?.hidden?.featured ||
      draft.personaV2?.featuredHidden,
  );
  const personaTraitSource = Array.isArray(personaIdentity.badges)
    ? personaIdentity.badges
    : Array.isArray(persona.traits)
      ? persona.traits
      : Array.isArray(persona.badges)
        ? persona.badges
        : [];
  const personaTraits = personaTraitSource
    .map(publicTraitBadge)
    .filter((badge) => badge?.label)
    .slice(0, 3);
  const heroDefinition = personaDefinitionForStax(
    canonicalCode,
    persona.basePersona?.signature || persona.archetype?.signature || draft.personaV2?.archetype?.signature,
  );
  const heroTags = [
    personaHidden?.title,
    ...personaTraits.map((trait) => trait.label),
  ]
    .map((label) => cleanDisplayText(label, '', 60))
    .filter(Boolean)
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 3);
  const heroBadge = cleanDisplayText(heroTags[0], '', 60);
  const heroBadgeColor = staxHeroBadgeColor(heroBadge);
  const familyMeta = personaFamilyMetaForStax(canonicalCode);
  const artKey = canonicalCode ? `persona_${canonicalCode}` : cleanDisplayText(staxProfile.art || staxProfile.avatarKey || staxProfile.avatar_key, 'inv', 40);
  const artDataUrl = canonicalCode ? basePersonaImageDataUrl(canonicalCode) : '';
  const teamBlock = blocks.find((block) => block.key === 'team');
  const badgesBlock = blocks.find((block) => block.key === 'badges');
  const ctxringBlock = blocks.find((block) => block.key === 'ctxring');
  const cgaugeBlock = blocks.find((block) => block.key === 'cgauge');
  const workPattern = recordValue(snapshot.behavior?.workPattern || usage.localActivity?.workPattern);
  const estimatedCount = blocks.filter((block) => block.estimated).length;
  const unsupportedCount = blocks.filter((block) => block.status === 'unsupported').length;
  const partialCount = blocks.filter((block) => block.status === 'partial').length;
  const supportedCount = blocks.filter((block) => block.status === 'supported').length;
  const localReadyCount = blocks.filter((block) => block.status !== 'unsupported').length;
  const takuAuthCount = blocks.filter((block) => block.status === 'unsupported' && TAKU_AUTH_BLOCK_KEYS.has(block.key)).length;
  const unavailableCount = blocks.filter((block) => block.status === 'unsupported' && !TAKU_AUTH_BLOCK_KEYS.has(block.key)).length;
  const teamIdentity = teamIdentityForStax(teamBlock);
  const teamLabel = teamIdentity.label;
  const teamOptions = teamOptionsForStax(teamBlock, teamIdentity);
  const tokenLabel = formatCompactMetric(usage.totalTokens || usage.modelUsage?.totalTokens || 0);
  const rankTopPercent = isTakuAuthorized ? metricValue(
    staxRank.topPercent,
    staxRank.rankGrade?.topPercent,
    draft.personaSignals?.external?.rankGrade?.topPercent,
  ) : 0;
  const publicHandle = handle.startsWith('@') ? handle : `@${handle}`;
  const confirmedGitHubHandle = cleanDisplayText(card.confirmedSocial?.github, '', 40).replace(/^@+/, '');
  const confirmedSocialHandle = confirmedGitHubHandle ? `@${confirmedGitHubHandle}` : '';
  const serial = cleanDisplayText(trustedStaxProfile.serial?.display || trustedStaxProfile.serial || trustedStaxProfile.serialNumber, 'UNMINTED', 40);
  const hasTrustedTakuIdentity = Boolean(isTakuAuthorized && trustedHandle && serial !== 'UNMINTED');
  const hasDisplayableTakuIdentity = Boolean(hasTrustedTakuIdentity || (isTakuAuthorized && trustedHandle) || publishedStaxUsername);
  const cardDisplayHandle = hasDisplayableTakuIdentity
    ? publicHandle
    : (confirmedSocialHandle || (isTakuAuthorized ? (connectedDisplayName || 'SIGNED IN DRAFT') : 'LOCAL DRAFT'));
  const cardDisplaySerial = hasTrustedTakuIdentity ? serial : 'UNMINTED';
  const publishedProfilePageUrl = publishedStaxUsername
    ? buildStaxProfilePageUrl(options.editor?.publish?.siteUrl, publishedStaxUsername)
    : cleanDisplayText(publishedStaxSource.profilePageUrl || publishedStaxSource.creatorPageUrl || publishedStaxSource.publicUrl, '', 800);
  const publishedCardPageUrl = publishedStaxUsername
    ? buildStaxCardPageUrl(options.editor?.publish?.siteUrl, publishedStaxUsername)
    : cleanDisplayText(publishedStaxSource.staxCardPageUrl || publishedStaxSource.staxCardShareUrl, '', 800);
  const publishedStax = {
    published: publishedStaxSource.published === true && Boolean(publishedProfilePageUrl || publishedCardPageUrl),
    publicUrl: publishedProfilePageUrl,
    profilePageUrl: publishedProfilePageUrl,
    creatorPageUrl: publishedProfilePageUrl,
    staxCardPageUrl: publishedCardPageUrl,
    staxCardShareUrl: publishedCardPageUrl,
    staxCardImageUrl: cleanDisplayText(publishedStaxSource.staxCardImageUrl, '', 800),
    cardId: cleanDisplayText(publishedStaxSource.cardId, '', 120),
    username: cleanDisplayText(publishedStaxSource.username, '', 120),
  };
  const qrBlock = blocks.find((block) => block.key === 'qr');
  const qrUsername = cleanDisplayText(
    publishedStaxUsername || trustedHandle || qrBlock?.value?.username || draft.creator?.username || draft.creator?.handle,
    '',
    120,
  ).replace(/^@+/, '');
  const qrOptions = qrUsername
    ? [
        qrOptionForStax('profile', 'Profile', buildStaxProfilePageUrl(options.editor?.publish?.siteUrl, qrUsername)),
        qrOptionForStax('stax', 'Stax Card', buildStaxCardPageUrl(options.editor?.publish?.siteUrl, qrUsername)),
      ]
    : [];
  const qrTarget = card.qrTarget === 'profile' ? 'profile' : 'stax';
  const activeQrOption = qrOptions.find((option) => option.id === qrTarget) || qrOptions[0];
  if (qrBlock && qrBlock.status !== 'unsupported' && activeQrOption) {
    qrBlock.value = {
      ...recordValue(qrBlock.value),
      ...activeQrOption,
      target: activeQrOption.id,
      username: qrUsername,
    };
  }
  const socialBlock = blocks.find((block) => block.key === 'social');
  const currentSocial = recordValue(socialBlock?.value);
  const githubCandidate = recordValue(draft.socialCandidates).github;
  const socialCandidateUsername = options.editor?.enabled && !options.readonlyPreview && !currentSocial.github
    ? cleanDisplayText(githubCandidate?.username, '', 80).replace(/^@+/, '')
    : '';
  const socialCandidate = socialCandidateUsername
    ? {
        platform: 'github',
        username: socialCandidateUsername,
        profileUrl: cleanDisplayText(githubCandidate?.profileUrl, `https://github.com/${socialCandidateUsername}`, 800),
        source: cleanDisplayText(githubCandidate?.source, 'github-cli', 80),
        verified: githubCandidate?.verified === true,
        requiresConfirmation: true,
      }
    : null;
  const publicBlocks = blocks.map((block) => {
    const unlockKind = block.status === 'unsupported'
      ? (block.key === 'social' && socialCandidate
          ? 'social-confirm'
          : TAKU_AUTH_BLOCK_KEYS.has(block.key)
            ? 'taku-auth'
            : 'unavailable')
      : 'local';
    if (block.key === 'team') {
      return {
        ...block,
        unlockKind,
        display: teamLabel,
        value: {
          ...recordValue(block.value),
          team: teamLabel,
          teamIcon: teamIdentity.icon,
        },
      };
    }
    if (['tier1', 'aura', 'water', 'tier4'].includes(block.key) && block.status === 'unsupported') {
      return {
        ...block,
        unlockKind,
        lockLabel: block.lockLabel || COMMUNITY_RANK_LOCK_LABEL,
        lockReason: block.lockReason || block.reason || COMMUNITY_RANK_LOCK_REASON,
      };
    }
    if (block.key !== 'hero') return { ...block, unlockKind };
    return {
      ...block,
      unlockKind,
      display: code,
      value: {
        ...recordValue(block.value),
        n1: personaName.n1,
        n2: personaName.n2,
        title: personaTitle,
        subtitle: '',
        signature: heroDefinition,
        heroBadge,
        heroTags,
        heroBadgeColor,
        type: code,
        handle: cardDisplayHandle,
        family: familyMeta?.label || block.value?.family,
        familyColor: familyMeta?.color || block.value?.familyColor,
      },
    };
  });
  const needsTakuProfile = Boolean(isTakuAuthorized && !hasTrustedTakuIdentity && !options.readonlyPreview);
  const snapshotLayout = recordValue(
    recordValue(draft.staxCardSnapshot).schemaVersion
      ? draft.staxCardSnapshot
      : recordValue(snapshot.staxCardSnapshot),
  );
  const layoutBlocks = Array.isArray(snapshotLayout.blocks)
    ? snapshotLayout.blocks
        .map((entry) => {
          const block = recordValue(entry);
          const key = cleanDisplayText(block.key, '', 40).toLowerCase();
          if (!key) return null;
          return {
            key,
            cx: Math.max(0, Math.floor(Number(block.cx) || 0)),
            cy: Math.max(0, Math.floor(Number(block.cy) || 0)),
            cw: Math.max(1, Math.floor(Number(block.cw) || 1)),
            ch: Math.max(1, Math.floor(Number(block.ch) || 1)),
          };
        })
        .filter(Boolean)
    : [];
  return {
    displayName,
    handle: publicHandle,
    cardHandle: cardDisplayHandle,
    code,
    title: personaName.n1,
    subtitle: personaName.n2,
    personaTitle,
    heroDefinition,
    heroBadge,
    heroTags,
    heroBadgeColor,
    shareTitle: `${personaTitle}.`,
    family: familyMeta?.label || cleanDisplayText(staxProfile.family || persona.basePersona?.title || persona.basePersona?.label, 'BUILDERS', 40),
    familyColor: familyMeta?.color || cleanDisplayText(staxProfile.familyColor || staxProfile.family_color, '#F0641E', 16),
    art: artKey,
    artDataUrl,
    team: teamLabel,
    teamIcon: teamIdentity.icon,
    teamOptions,
    qrOptions,
    qrTarget: activeQrOption?.id || qrTarget,
    socialCandidate,
    axes: Array.isArray(persona.axes)
      ? persona.axes.slice(0, 4).map((axis, index) => staxAxisForDisplay(axis, index))
      : [],
    badges: Array.isArray(badgesBlock?.value?.badges) ? badgesBlock.value.badges.slice(0, 2) : [],
    serial,
    cardSerial: cardDisplaySerial,
    loginUrl,
    needsTakuAuth: Boolean(!isTakuAuthorized && (loginUrl || takuAuthCount > 0)),
    needsTakuProfile,
    auth: {
      hasTrustedTakuIdentity,
      isTakuAuthorized,
      needsTakuProfile,
      loginUrl,
      localReadyLabel: `${tokenLabel} TOKENS`,
      pendingFields: ['REAL HANDLE', 'STAX SERIAL', 'TAKU RANK'],
      quota: recordValue(cgaugeBlock?.value),
      unlockSummary: {
        localReady: localReadyCount,
        takuAuth: takuAuthCount,
        unavailable: unavailableCount,
        total: blocks.length,
      },
    },
    unlockSummary: {
      localReady: localReadyCount,
      takuAuth: takuAuthCount,
      unavailable: unavailableCount,
      total: blocks.length,
    },
    usageLabel: cleanDisplayText(usage.label || usage.periodId, 'This Month', 40),
    rankTopPercent,
    rankTopPercentLabel: rankTopPercent > 0 ? displayPercent(rankTopPercent) : '',
    tokenLabel,
    apiListEquivalentLabel: formatUsableApiListEquivalent(usage),
    basicValue: formatCompactMetric(usage.sessionCount || usage.eventCount || 0),
    rhythm: Number.isInteger(Number(workPattern.peakHour)) ? `PEAK ${String(workPattern.peakHour).padStart(2, '0')}:00` : '',
    scanLabel: cleanDisplayText(workPattern.timezone, 'LOCAL SCAN', 40),
    caption: `${personaTitle} · ${code}`,
    tag: cleanDisplayText(usage.label || usage.periodId, 'LOCAL', 40),
    scanLines: [
      ['FIRING UP THE KITCHEN ...', 'LIT'],
      [`TOSSING IN ${teamLabel.toUpperCase()} ...`, 'IN THE POT'],
      ['READING LOCAL USAGE ...', `${tokenLabel} TOKENS`],
      ['READING AVG INPUT ...', cleanDisplayText(ctxringBlock?.display, 'N/A', 24)],
      ['MAPPING PERSONA ...', code],
      ['MARKING ESTIMATED BLOCKS ...', `${estimatedCount}`],
      ['CHECKING PARTIAL BLOCKS ...', `${partialCount}`],
      ['LOCKING UNSUPPORTED BLOCKS ...', `${unsupportedCount}`],
      ['STAMPING DRAFT ...', `${supportedCount + partialCount} READY`],
    ],
    blocks: publicBlocks,
    selectedKeys: [...selectedKeys, ...fallbackKeys].slice(0, 14),
    canPublish: Boolean(options.editor?.enabled),
    communityTools: collectCommunityToolCandidates(draft),
    publishedStax,
    readonly: Boolean(options.readonlyPreview),
    studioLayout: {
      schemaVersion: 'taku.stax.studio-layout.v1',
      blocks: layoutBlocks,
    },
  };
}

function renderStaxAppPreview(draft, options = {}) {
  const model = buildStaxAppModel(draft, options);
  const bootstrap = renderStaxAppBootstrapScript(model);
  let template = readFileSync(STAX_APP_TEMPLATE_URL, 'utf8')
    .replace('<style>', `<style>\n${staxLocalFontCss()}`)
    .replace('const ART = window.__ART__ || {};', `const ART = window.__ART__ || {};\nObject.assign(ART, ${jsonForScript(staxArtAssets())});`)
    .replace('<title>Taku · Stax — build & ship</title>', '<title>' + escapeHtml(model.displayName) + ' · Stax</title>');
  template = template.includes('/* __TAKU_STAX_BOOTSTRAP_START__ */')
    ? template.replace(
        /\/\* __TAKU_STAX_BOOTSTRAP_START__ \*\/[\s\S]*?\/\* __TAKU_STAX_BOOTSTRAP_END__ \*\//,
        bootstrap + '\nwindow.__TAKU_STAX_BOOTSTRAP__();',
      )
    : template.replace('setPersona(\'mason\');\nplayIntro(\'mason\');', bootstrap + '\nwindow.__TAKU_STAX_BOOTSTRAP__();');
  if (options.readonlyPreview) {
    template = template.replace(
      /\/\* __TAKU_PUBLICATION_CODE_START__ \*\/[\s\S]*?\/\* __TAKU_PUBLICATION_CODE_END__ \*\//,
      [
        'let STAX_PUBLICATION={published:false,publicUrl:"",profilePageUrl:"",creatorPageUrl:"",staxCardPageUrl:""};',
        'function profilePublicUrl(){return STAX_PUBLICATION.profilePageUrl||STAX_PUBLICATION.creatorPageUrl||STAX_PUBLICATION.publicUrl||"";}',
        'function staxPublicUrl(){return STAX_PUBLICATION.staxCardPageUrl||"";}',
        'function setStaxPublication(){}',
        'function copyProfileLink(){toast("READ ONLY PREVIEW");}',
        'function copyStaxLink(){toast("READ ONLY PREVIEW");}',
        'function openShare(){toast("READ ONLY PREVIEW");}',
        'document.getElementById("mpost")?.addEventListener("click",()=>toast("READ ONLY PREVIEW"));',
        'document.getElementById("mpng")?.addEventListener("click",()=>toast("READ ONLY PREVIEW"));',
        'document.getElementById("mprofile")?.addEventListener("click",copyProfileLink);',
        'document.getElementById("mlink")?.addEventListener("click",copyStaxLink);',
      ].join('\n'),
    );
  }
  return template;
}

export function createStaxStudioRendererPayload(draft = {}, options = {}) {
  return {
    schemaVersion: 'taku.stax.studio-renderer.v1',
    renderer: 'publisher-stax-app',
    model: buildStaxAppModel(draft, {
      ...options,
      editor: {
        enabled: true,
        ...(options.editor || {}),
        publish: {
          authenticated: true,
          canPublish: true,
          ...(options.editor?.publish || {}),
        },
      },
    }),
  };
}

export function renderStaxStudioRuntime() {
  const html = renderStaxAppPreview({}, {
    editor: {
      enabled: true,
      publish: {
        authenticated: true,
        canPublish: true,
      },
    },
  });
  const cloudStyle = [
    '<style id="taku-cloud-studio-style">',
    'html,body{background:#09090d}',
    'body{visibility:hidden}',
    'body.taku-cloud-ready{visibility:visible}',
    '</style>',
  ].join('');
  const cloudBridge = `<script id="taku-cloud-studio-bridge">
(function(){
  const MESSAGE_PREFIX='taku:stax-studio:';
  let initialized=false;
  let publishing=false;
  function currentLayout(){
    return {
      schemaVersion:'taku.stax.studio-layout.v1',
      blocks:Array.isArray(placedP)?placedP.map((item)=>({key:item.key,cx:item.cx,cy:item.cy,cw:item.cw,ch:item.ch})):[],
    };
  }
  function post(type,payload){
    if(window.parent===window)return;
    window.parent.postMessage({type:MESSAGE_PREFIX+type,...(payload||{})},'*');
  }
  window.__TAKU_STAX_POST__=post;
  function clearBoard(){
    if(!Array.isArray(placedP))return;
    placedP.splice(0).forEach((item)=>item.el&&item.el.remove());
    if(typeof chipRefs==='object'&&chipRefs){Object.values(chipRefs).forEach((chip)=>chip&&chip.classList&&chip.classList.remove('on'));}
    if(typeof counts==='function')counts();
  }
  function applyLayout(layout){
    const blocks=layout&&Array.isArray(layout.blocks)?layout.blocks:[];
    if(!blocks.length)return;
    clearBoard();
    blocks.forEach((item)=>{
      if(!item||typeof item.key!=='string'||typeof place!=='function')return;
      const placed=place(item.key,Number(item.cx)||0,Number(item.cy)||0);
      if(placed&&typeof chipRefs==='object'&&chipRefs[placed.key])chipRefs[placed.key].classList.add('on');
    });
  }
  function initialize(message){
    const model=message&&message.model&&typeof message.model==='object'?message.model:null;
    if(!model||typeof window.__TAKU_STAX_BOOTSTRAP__!=='function')return;
    window.__TAKU_STAX_DATA__={...model,readonly:false,publishedStax:{...(model.publishedStax||{})}};
    window.__TAKU_STAX_BOOTSTRAP__();
    applyLayout(message.layout||model.studioLayout);
    document.body.classList.add('taku-cloud-ready');
    initialized=true;
    post('ready',{layout:currentLayout()});
  }
  function finishPublish(message){
    const publication=message&&message.publication&&typeof message.publication==='object'?message.publication:null;
    if(!publication||typeof setStaxPublication!=='function')return;
    setStaxPublication(publication);
    publishing=false;
    const button=document.getElementById('mpost');
    if(button){button.disabled=false;button.textContent='POSTED ✓';}
    document.getElementById('modal')?.classList.remove('on');
    if(typeof confetti==='function')confetti();
    if(typeof openShare==='function')openShare('owner');
    if(message.message&&typeof toast==='function')toast(String(message.message));
  }
  function failPublish(message){
    publishing=false;
    const button=document.getElementById('mpost');
    if(button){button.disabled=false;button.textContent='TRY AGAIN';}
    if(message&&message.message&&typeof toast==='function')toast(String(message.message));
  }
  window.addEventListener('message',(event)=>{
    const message=event.data;
    if(!message||typeof message.type!=='string'||!message.type.startsWith(MESSAGE_PREFIX))return;
    if(message.type===MESSAGE_PREFIX+'init')initialize(message);
    if(message.type===MESSAGE_PREFIX+'published')finishPublish(message);
    if(message.type===MESSAGE_PREFIX+'publish-error')failPublish(message);
    if(message.type===MESSAGE_PREFIX+'settings-saved'){
      if(typeof window.__TAKU_GITHUB_SAVE_SUCCESS__==='function')window.__TAKU_GITHUB_SAVE_SUCCESS__(message);
      setTimeout(()=>post('layout-change',{layout:currentLayout()}),0);
    }
    if(message.type===MESSAGE_PREFIX+'settings-error'){
      if(String(message.requestId||'').startsWith('github-')&&typeof window.__TAKU_GITHUB_SAVE_ERROR__==='function')window.__TAKU_GITHUB_SAVE_ERROR__(message);
      else if(message.message&&typeof toast==='function')toast(String(message.message));
    }
    if(message.type===MESSAGE_PREFIX+'status'&&message.message&&typeof toast==='function')toast(String(message.message));
  });
  document.addEventListener('click',async(event)=>{
    const target=event.target instanceof Element?event.target.closest('#mpost'):null;
    if(!target||!initialized)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(publishing)return;
    publishing=true;
    target.disabled=true;
    target.textContent='CAPTURING...';
    try{
      const staxCardSnapshot=await currentStaxCardSnapshot();
      target.textContent='PUBLISHING...';
      post('publish',{layout:currentLayout(),staxCardSnapshot});
    }catch(error){
      failPublish({message:error&&error.message?error.message:'Could not capture the Stax Card image.'});
    }
  },true);
  const reportLayout=()=>{if(initialized)post('layout-change',{layout:currentLayout()});};
  document.addEventListener('pointerup',(event)=>{
    if(event.target instanceof Element&&event.target.closest('#mpost'))return;
    setTimeout(reportLayout,0);
  },true);
  document.addEventListener('click',(event)=>{
    if(event.target instanceof Element&&event.target.closest('#ball,#bclear,.dock'))setTimeout(reportLayout,0);
  });
  post('booted');
})();
</script>`;
  return html
    .replace('</head>', cloudStyle + '</head>')
    .replace('</body>', cloudBridge + '</body>');
}


function renderStaxAppBootstrapScript(model) {
  return [
    'window.__TAKU_STAX_DATA__ = ' + jsonForScript(model) + ';',
    'window.__TAKU_STAX_BOOTSTRAP__ = function(){',
    '  const data = window.__TAKU_STAX_DATA__ || {};',
    '  const blocks = Array.isArray(data.blocks) ? data.blocks : [];',
    '  const fallbackLogo = ART.logo_mark || FALLBACK_LOGO;',
    '  ART.logo_mark = fallbackLogo;',
    '  if (data.art && data.artDataUrl) ART[data.art] = data.artDataUrl;',
    '  document.querySelectorAll(".scanlogo,.shlogo,[data-logo],#lockup").forEach((img) => {',
    '    if (!img) return;',
    '    if (typeof setLogo === "function") setLogo(img);',
    '    else img.src = fallbackLogo;',
    '  });',
    '  const byKey = new Map(blocks.map((block) => [block.key, block]));',
    '  const supportedKeys = blocks.filter((block) => block && block.status !== "unsupported").map((block) => block.key);',
    '  const selected = (Array.isArray(data.selectedKeys) && data.selectedKeys.length ? data.selectedKeys : supportedKeys).filter((key) => byKey.get(key)?.status !== "unsupported" && SIZES[key]);',
    '  const locks = {};',
    '  blocks.forEach((block) => {',
    '    if (!block || block.status !== "unsupported" || !SIZES[block.key]) return;',
    '    locks[block.key] = {',
    '      label: String(block.lockLabel || "LOCKED").toUpperCase(),',
    '      message: String(block.lockReason || block.reason || "Not available yet."),',
    '      kind: String(block.unlockKind || "unavailable"),',
    '    };',
    '  });',
    '  const value = (key) => byKey.get(key)?.value || {};',
    '  const text = (input, fallback) => String(input || fallback || "").trim();',
    '  const teamValue = value("team");',
    '  const qrValue = value("qr");',
    '  const socialValue = value("social");',
    '  const clockValue = value("clock");',
    '  const basicValue = value("basic");',
    '  const heroValue = value("hero");',
    '  const typeValue = value("type");',
    '  const badgesValue = value("badges");',
    '  const bars90Value = value("bars90");',
    '  const pieValue = value("pie");',
    '  const modelcostValue = value("modelcost");',
    '  const cgaugeValue = value("cgauge");',
    '  const ringsValue = value("rings");',
    '  const ctxringValue = value("ctxring");',
    '  const heatValue = value("heat");',
    '  const dotsValue = value("dots");',
    '  const waterValue = value("water");',
    '  const vsavgValue = value("vsavg");',
    '  const trendValue = value("trend");',
    '  const tallyValue = value("tally");',
    '  const dialValue = value("dial");',
    '  const waveValue = value("wave");',
    '  const peaksValue = value("peaks");',
    '  const ratioValue = value("ratio");',
    '  const toolsValue = value("tools");',
    '  const stadiumValue = value("stadium");',
    '  const knockValue = value("knock");',
    '  const bracketValue = value("bracket");',
    '  const nodeValue = value("node");',
    '  const splitringValue = value("splitring");',
    '  const tier1Value = value("tier1");',
    '  const sealValue = value("seal");',
    '  const persona = {',
    '    ...MASON,',
    '    n1: text(data.title, "AI"),',
    '    n2: text(data.subtitle, "Builder"),',
    '    handle: text(data.cardHandle, text(data.handle, "@builder")),',
    '    family: text(data.family, "BUILDERS").toUpperCase(),',
    '    fam: text(data.familyColor, "#F0641E"),',
    '    signature: text(heroValue.signature, data.heroDefinition || ""),',
    '    heroBadge: text(heroValue.heroBadge, data.heroBadge || ""),',
    '    heroTags: Array.isArray(heroValue.heroTags) && heroValue.heroTags.length ? heroValue.heroTags : (Array.isArray(data.heroTags) ? data.heroTags : []),',
    '    heroBadgeColor: text(heroValue.heroBadgeColor, data.heroBadgeColor || "#C9F24C"),',
    '    art: text(data.art, "inv"),',
    '    team: [text(data.team || teamValue.team, "CODEX").toUpperCase(), text(data.teamIcon || teamValue.teamIcon, "codex")],',
    '    type: text(typeValue.type || heroValue.type, data.code || "AI"),',
    '    seal: { serial: text(sealValue.serial, data.cardSerial || data.serial || "UNMINTED") },',
    '    qr: { target: text(qrValue.target, data.qrTarget || "stax"), url: text(qrValue.url, ""), username: text(qrValue.username, ""), size: Math.max(0, Math.floor(Number(qrValue.size) || 0)), matrix: text(qrValue.matrix, ""), errorCorrectionLevel: text(qrValue.errorCorrectionLevel, "M") },',
    '    social: { x: text(socialValue.x, ""), github: text(socialValue.github, "") },',
    '    axes: Array.isArray(typeValue.axes) && typeValue.axes.length ? typeValue.axes : (Array.isArray(data.axes) && data.axes.length ? data.axes : MASON.axes),',
    '    basicVal: text(basicValue.basicVal, data.basicValue || data.tokenLabel || "0"),',
    '    band: Array.isArray(clockValue.band) ? clockValue.band : MASON.band,',
    '    hourBuckets: Array.isArray(clockValue.hourBuckets) ? clockValue.hourBuckets.slice(0, 24) : [],',
    '    peakH: Number.isFinite(Number(clockValue.peakH)) ? Number(clockValue.peakH) : MASON.peakH,',
    '    bird: text(clockValue.bird, data.rhythm || MASON.bird),',
    '    peakLabel: text(clockValue.peakLabel, Number.isFinite(Number(clockValue.peakH)) ? "PEAK " + String(Number(clockValue.peakH)).padStart(2, "0") + ":00" : MASON.peakLabel),',
    '    badges: Array.isArray(badgesValue.badges) && badgesValue.badges.length ? badgesValue.badges : (Array.isArray(data.badges) ? data.badges : MASON.badges),',
    '    bars90: {',
    '      tokens90d: Array.isArray(bars90Value.tokens90d) ? bars90Value.tokens90d : [],',
    '      visualBuckets: Array.isArray(bars90Value.visualBuckets) ? bars90Value.visualBuckets : [],',
    '      tokens90dTotal: text(bars90Value.tokens90dTotal, data.tokenLabel || "0"),',
    '      dayCount: Number.isFinite(Number(bars90Value.dayCount)) ? Number(bars90Value.dayCount) : 0,',
    '      observedBucketCount: Number.isFinite(Number(bars90Value.observedBucketCount)) ? Number(bars90Value.observedBucketCount) : 0,',
    '      isPartialSample: Boolean(bars90Value.isPartialSample),',
    '      periodLabel: text(bars90Value.periodLabel, data.usageLabel || "This Month"),',
    '    },',
    '    pie: {',
    '      modelMix: Array.isArray(pieValue.modelMix) ? pieValue.modelMix : [],',
    '      periodLabel: text(bars90Value.dayCount ? bars90Value.dayCount + " DAYS" : "", data.usageLabel || bars90Value.periodLabel || "LOCAL"),',
    '    },',
    '    modelcost: {',
    '      models: Array.isArray(modelcostValue.models) ? modelcostValue.models.slice(0, 3).map((model) => ({ modelId: text(model?.modelId, ""), name: text(model?.name, model?.modelId || "MODEL"), provider: text(model?.provider, ""), pricingModel: text(model?.pricingModel, ""), priceSource: text(model?.priceSource, ""), totalUsd: Math.max(0, Number(model?.totalUsd) || 0) })) : [],',
    '      totalUsd: Math.max(0, Number(modelcostValue.totalUsd) || 0),',
    '      coverageRatio: Math.max(0, Math.min(1, Number(modelcostValue.coverageRatio) || 0)),',
    '      partial: Boolean(modelcostValue.partial),',
    '      unpricedModelCount: Math.max(0, Math.floor(Number(modelcostValue.unpricedModelCount) || 0)),',
    '      unpricedTokenCount: Math.max(0, Math.floor(Number(modelcostValue.unpricedTokenCount) || 0)),',
    '      periodId: text(modelcostValue.periodId, data.usagePeriodId || "thisMonth"),',
    '      periodLabel: text(modelcostValue.periodLabel, data.usageLabel || "This Month"),',
    '      priceTableUpdatedAt: text(modelcostValue.priceTableUpdatedAt, ""),',
    '    },',
    '    cgauge: {',
    '      usedPercent: Number.isFinite(Number(cgaugeValue.usedPercent)) ? Number(cgaugeValue.usedPercent) : null,',
    '      usedCredits: Number.isFinite(Number(cgaugeValue.usedCredits)) ? Number(cgaugeValue.usedCredits) : null,',
    '      totalCredits: Number.isFinite(Number(cgaugeValue.totalCredits)) ? Number(cgaugeValue.totalCredits) : null,',
    '      remainingCredits: Number.isFinite(Number(cgaugeValue.remainingCredits)) ? Number(cgaugeValue.remainingCredits) : null,',
    '      resetAt: text(cgaugeValue.resetAt, ""),',
    '      periodStart: text(cgaugeValue.periodStart, ""),',
    '      periodEnd: text(cgaugeValue.periodEnd, ""),',
    '      periodId: text(cgaugeValue.periodId, data.usagePeriodId || "thisMonth"),',
    '      planName: text(cgaugeValue.planName, ""),',
    '    },',
    '    rings: {',
    '      metrics: Array.isArray(ringsValue.metrics) ? ringsValue.metrics.slice(0, 3) : [],',
    '      streakToday: Number.isFinite(Number(ringsValue.streakToday)) ? Number(ringsValue.streakToday) : 0,',
    '      streakLabel: text(ringsValue.streakLabel, "LOCAL BUILD-DAY STREAK"),',
    '      periodLabel: text(ringsValue.periodLabel, data.usageLabel || "LOCAL PERIOD"),',
    '      sourceLabel: text(ringsValue.sourceLabel, "LOCAL LOGS"),',
    '      coverage: ringsValue.coverage && typeof ringsValue.coverage === "object" ? ringsValue.coverage : {},',
    '      estimated: Boolean(byKey.get("rings")?.estimated),',
    '    },',
    '    ctxring: {',
    '      avgInputTokens: Number(ctxringValue.avgInputTokens) || 0,',
    '      requestCount: Number(ctxringValue.requestCount) || 0,',
    '      display: text(ctxringValue.display, ""),',
    '    },',
    '    heat: {',
    '      days: Array.isArray(heatValue.days) ? heatValue.days.map((day) => ({ date: text(day?.date, ""), observed: day?.observed !== false, builds: Number(day?.builds) || 0 })) : [],',
    '      buildsDaily: Array.isArray(heatValue.buildsDaily) ? heatValue.buildsDaily : [],',
    '      observedDayCount: Number(heatValue.observedDayCount) || 0,',
    '      activeDayCount: Number(heatValue.activeDayCount) || 0,',
    '      currentStreak: Number(heatValue.currentStreak) || 0,',
    '      bestStreak: Number(heatValue.bestStreak) || 0,',
    '      coverage: heatValue.coverage && typeof heatValue.coverage === "object" ? heatValue.coverage : {},',
    '    },',
    '    dots: {',
    '      toolCallCount: Number(dotsValue.toolCallCount) || 0,',
    '      display: text(dotsValue.display, "0"),',
    '      periodLabel: text(dotsValue.periodLabel, data.usageLabel || "LOCAL SCAN"),',
    '      dailyToolCalls: Array.isArray(dotsValue.dailyToolCalls) ? dotsValue.dailyToolCalls.slice(-15).map((day) => ({ date: text(day?.date, ""), count: Number(day?.count) || 0 })) : [],',
    '    },',
    '    water: {',
    '      topPercent: Number(waterValue.topPercent) || 0,',
    '      metric: text(waterValue.metric, ""),',
    '      cohortSize: Number(waterValue.cohortSize) || 0,',
    '      minimumCohortSize: Number(waterValue.minimumCohortSize) || 0,',
    '      environment: text(waterValue.environment, "unknown").toLowerCase(),',
    '      publicRankReady: Boolean(waterValue.publicRankReady),',
    '      testOnly: Boolean(waterValue.testOnly),',
    '    },',
    '    vsavg: {',
    '      creatorTokens: Number(vsavgValue.creatorTokens) || 0,',
    '      communityMedian: Number(vsavgValue.communityMedian) || 0,',
    '      deltaPercent: Number(vsavgValue.deltaPercent) || 0,',
    '      display: text(vsavgValue.display, "—"),',
    '      baseline: text(vsavgValue.baseline, "median"),',
    '      periodLabel: text(vsavgValue.periodLabel, data.usageLabel || "This Month"),',
    '    },',
    '    trend: {',
    '      delta: Number(trendValue.delta) || 0,',
    '      display: text(trendValue.display, ""),',
    '      currentBuilds: Number(trendValue.currentBuilds) || 0,',
    '      previousBuilds: Number(trendValue.previousBuilds) || 0,',
    '      comparison: text(trendValue.comparison, ""),',
    '      currentPeriodLabel: text(trendValue.currentPeriodLabel, ""),',
    '      previousPeriodLabel: text(trendValue.previousPeriodLabel, ""),',
    '    },',
    '    tally: {',
    '      shipped: Math.max(0, Math.floor(Number(tallyValue.shipped) || 0)),',
    '    },',
    '    dial: {',
    '      score: dialValue.score !== undefined && dialValue.score !== null && dialValue.score !== "" && Number.isFinite(Number(dialValue.score)) ? Math.max(0, Math.min(100, Math.round(Number(dialValue.score)))) : null,',
    '      maxScore: Math.max(1, Math.round(Number(dialValue.maxScore) || 100)),',
    '      version: text(dialValue.version, ""),',
    '      breakdown: dialValue.breakdown && typeof dialValue.breakdown === "object" ? dialValue.breakdown : {},',
    '    },',
    '    wave: {',
    '      waves: Array.isArray(waveValue.waves) ? waveValue.waves.slice(-5).map((wave) => ({ id: text(wave?.id, ""), label: text(wave?.label, ""), buildSessionCount: Math.max(0, Math.floor(Number(wave?.buildSessionCount) || 0)), activeDayCount: Math.max(0, Math.floor(Number(wave?.activeDayCount) || 0)) })) : [],',
    '      totalBuildSessions: Math.max(0, Math.floor(Number(waveValue.totalBuildSessions) || 0)),',
    '      observedDayCount: Math.max(0, Math.floor(Number(waveValue.observedDayCount) || 0)),',
    '      periodId: text(waveValue.periodId, "last30Days"),',
    '    },',
    '    peaks: {',
    '      bestDay: text(peaksValue.bestDay, ""),',
    '      date: text(peaksValue.date, ""),',
    '      metric: text(peaksValue.metric, "tokens"),',
    '      observedDayCount: Math.max(0, Math.floor(Number(peaksValue.observedDayCount) || 0)),',
    '      peakShape: Array.isArray(peaksValue.peakShape) ? peaksValue.peakShape.slice(-30).map((value) => Math.max(0, Number(value) || 0)) : [],',
    '      peakDates: Array.isArray(peaksValue.peakDates) ? peaksValue.peakDates.slice(-30).map((date) => text(date, "")) : [],',
    '    },',
    '    ratio: {',
    '      tokensIn: text(ratioValue.tokensIn, "0"),',
    '      tokensOut: text(ratioValue.tokensOut, "0"),',
    '      tokensInValue: Math.max(0, Number(ratioValue.tokensInValue) || 0),',
    '      tokensOutValue: Math.max(0, Number(ratioValue.tokensOutValue) || 0),',
    '      inShare: Math.max(0, Math.min(1, Number(ratioValue.inShare) || 0)),',
    '      periodId: text(ratioValue.periodId, data.usagePeriodId || "thisMonth"),',
    '      periodLabel: text(ratioValue.periodLabel, data.usageLabel || "This Month"),',
    '    },',
    '    tools: {',
    '      tools: Array.isArray(toolsValue.tools) ? toolsValue.tools.slice(0, 3) : [],',
    '    },',
    '    stadium: {',
    '      tokensAllTime: text(stadiumValue.tokensAllTime, ""),',
    '      tokensTotal: text(stadiumValue.tokensTotal || stadiumValue.tokensAllTime, data.tokenLabel || "0"),',
    '      allTimeTokens: Math.max(0, Number(stadiumValue.allTimeTokens) || 0),',
    '      totalTokens: Math.max(0, Number(stadiumValue.totalTokens) || 0),',
    '      periodId: text(stadiumValue.periodId, data.usagePeriodId || "thisMonth"),',
    '      periodLabel: text(stadiumValue.periodLabel, data.usageLabel || "This Month"),',
    '    },',
    '    knock: {',
    '      label: text(knockValue.label, "EVENTS"),',
    '      value: text(knockValue.value, "0"),',
    '    },',
    '    bracket: {',
    '      label: text(bracketValue.label, bracketValue.estimated ? "API EQUIV." : "TOKENS"),',
    '      value: text(bracketValue.value, "0"),',
    '      estimated: Boolean(bracketValue.estimated || byKey.get("bracket")?.estimated),',
    '      periodId: text(bracketValue.periodId, data.usagePeriodId || "thisMonth"),',
    '      periodLabel: text(bracketValue.periodLabel, data.usageLabel || "This Month"),',
    '    },',
    '    node: {',
    '      totalCount: Math.max(0, Math.floor(Number(nodeValue.totalCount) || 0)),',
    '      categories: Array.isArray(nodeValue.categories) ? nodeValue.categories.slice(0, 4).map((category) => ({ id: text(category?.id, ""), label: text(category?.label, "OTHER").toUpperCase(), count: Math.max(0, Math.floor(Number(category?.count) || 0)) })) : [],',
    '      otherCount: Math.max(0, Math.floor(Number(nodeValue.otherCount) || 0)),',
    '    },',
    '    splitring: {',
    '      chatShare: Math.max(0, Math.min(1, Number(splitringValue.chatShare) || 0)),',
    '      buildShare: Math.max(0, Math.min(1, Number(splitringValue.buildShare) || 0)),',
    '      sessionCount: Math.max(0, Math.floor(Number(splitringValue.sessionCount) || 0)),',
    '      chatSessionCount: Math.max(0, Math.floor(Number(splitringValue.chatSessionCount) || 0)),',
    '      buildSessionCount: Math.max(0, Math.floor(Number(splitringValue.buildSessionCount) || 0)),',
    '      periodId: text(splitringValue.periodId, data.usagePeriodId || "thisMonth"),',
    '      periodLabel: text(splitringValue.periodLabel, data.usageLabel || "This Month"),',
    '      estimated: Boolean(byKey.get("splitring")?.estimated),',
    '    },',
    '    tier1: {',
    '      tier: text(tier1Value.tier, data.rankTier || "STANDARD"),',
    '      topPercentLabel: text(tier1Value.topPercentLabel, data.rankTopPercentLabel),',
    '    },',
    '  };',
    '  PERSONAS.publisher = {',
    '    pd: persona,',
    '    ser: text(data.cardSerial, text(data.serial, "UNMINTED")),',
    '    user: [persona.handle, persona.type, persona.family, text(data.tag, data.usageLabel)].filter(Boolean).join(" · "),',
    '    title: text(data.shareTitle, data.title || "Your Stax is ready."),',
    '    tag: text(data.tag, data.usageLabel || "LOCAL"),',
    '    scan: [text(data.tokenLabel, "0") + " TOKENS", text(data.scanLabel, data.rhythm || "LOCAL SCAN")],',
    '    scanLines: Array.isArray(data.scanLines) ? data.scanLines : [],',
    '    loginUrl: text(data.loginUrl || data.auth?.loginUrl, ""),',
    '    needsTakuAuth: Boolean(data.needsTakuAuth),',
    '    needsTakuProfile: Boolean(data.needsTakuProfile),',
    '    auth: data.auth || {},',
    '    unlockSummary: data.unlockSummary || (data.auth && data.auth.unlockSummary) || {},',
    '    cap: text(data.caption, "Built from local publisher scan. Estimated fields are marked in the dock."),',
    '    fullset: selected.length ? selected : ["hero", "team", "type"],',
    '    locks,',
    '    blocks,',
    '  };',
    '  const sw = document.getElementById("pswitch");',
    '  if (sw) {',
    '    sw.innerHTML = "";',
    '    const avatar = document.createElement("span");',
    '    avatar.className = "pav on";',
    '    avatar.dataset.p = "publisher";',
    '    avatar.style.background = persona.fam;',
    '    avatar.innerHTML = "<img src=\\\"" + (ART[persona.art] || ART.inv || "") + "\\\" alt=\\\"\\\">";',
    '    avatar.title = persona.handle;',
    '    avatar.addEventListener("click", () => setPersona("publisher"));',
    '    sw.appendChild(avatar);',
    '  }',
    '  setPersona("publisher");',
    '  const teamSelect = document.getElementById("teamselect");',
    '  const teamOptions = Array.isArray(data.teamOptions) ? data.teamOptions : [];',
    '  if (teamSelect && teamOptions.length) {',
    '    teamSelect.replaceChildren(...teamOptions.map((option) => new Option(text(option.label, option.id).toUpperCase(), text(option.id, option.icon))));',
    '    const activeTeam = teamOptions.find((option) => option.selected) || teamOptions[0];',
    '    teamSelect.value = text(activeTeam.id, activeTeam.icon);',
    '    teamSelect.disabled = Boolean(data.readonly) || teamOptions.length < 2;',
    '    teamSelect.closest(".teamswitch")?.classList.remove("is-hidden");',
    '    teamSelect.addEventListener("change", async () => {',
    '      const selectedTeam = teamOptions.find((option) => text(option.id, option.icon) === teamSelect.value);',
    '      if (!selectedTeam) return;',
    '      persona.team = [text(selectedTeam.label, "CODEX").toUpperCase(), text(selectedTeam.icon, "codex")];',
    '      const teamBlock = byKey.get("team");',
    '      if (teamBlock) teamBlock.value = { ...(teamBlock.value || {}), team: persona.team, teamIcon: persona.team[1], identityBasis: "user-selection" };',
    '      PERSONAS.publisher.pd = persona;',
    '      PD = persona;',
    '      for (const placed of placedP.filter((item) => item.key === "team")) {',
    '        placed.el.innerHTML = R.team(placed.cw * U - GAP, placed.ch * U - GAP);',
    '      }',
    '      for (const key in chipRefs) delete chipRefs[key];',
    '      document.getElementById("dockscroll").innerHTML = "";',
    '      buildDock();',
    '      for (const placed of placedP) chipRefs[placed.key]?.classList.add("on");',
    '      toast("PRIMARY AI · " + persona.team[0]);',
    '      if (!data.readonly) {',
    '        if (typeof window.__TAKU_STAX_POST__ === "function") {',
    '          window.__TAKU_STAX_POST__("settings-change", { requestId: "primary-ai-" + Date.now() + "-" + Math.random().toString(36).slice(2), settings: { primaryAi: selectedTeam.id } });',
    '          return;',
    '        }',
    '        try {',
    '          await fetch("/api/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: { primaryAi: selectedTeam.id } }) });',
    '        } catch {}',
    '      }',
    '    });',
    '  }',
    '  const qrSelect = document.getElementById("qrselect");',
    '  const qrOptions = Array.isArray(data.qrOptions) ? data.qrOptions : [];',
    '  if (qrSelect && qrOptions.length) {',
    '    qrSelect.replaceChildren(...qrOptions.map((option) => new Option(text(option.label, option.id).toUpperCase(), text(option.id, "stax"))));',
    '    const activeQr = qrOptions.find((option) => text(option.id, "stax") === text(data.qrTarget, persona.qr.target)) || qrOptions[0];',
    '    qrSelect.value = text(activeQr.id, "stax");',
    '    qrSelect.disabled = Boolean(data.readonly);',
    '    qrSelect.closest(".qrswitch")?.classList.remove("is-hidden");',
    '    qrSelect.addEventListener("change", async () => {',
    '      const selectedQr = qrOptions.find((option) => text(option.id, "stax") === qrSelect.value);',
    '      if (!selectedQr) return;',
    '      persona.qr = { target: text(selectedQr.id, "stax"), url: text(selectedQr.url, ""), username: text(selectedQr.username, qrValue.username), size: Math.max(0, Math.floor(Number(selectedQr.size) || 0)), matrix: text(selectedQr.matrix, ""), errorCorrectionLevel: text(selectedQr.errorCorrectionLevel, "M") };',
    '      const qrBlock = byKey.get("qr");',
    '      if (qrBlock) qrBlock.value = { ...(qrBlock.value || {}), ...persona.qr };',
    '      PERSONAS.publisher.pd = persona;',
    '      PD = persona;',
    '      for (const placed of placedP.filter((item) => item.key === "qr")) {',
    '        placed.el.innerHTML = R.qr(placed.cw * U - GAP, placed.ch * U - GAP);',
    '      }',
    '      for (const key in chipRefs) delete chipRefs[key];',
    '      document.getElementById("dockscroll").innerHTML = "";',
    '      buildDock();',
    '      for (const placed of placedP) chipRefs[placed.key]?.classList.add("on");',
    '      toast("QR LINK · " + text(selectedQr.label, selectedQr.id).toUpperCase());',
    '      if (!data.readonly) {',
    '        if (typeof window.__TAKU_STAX_POST__ === "function") {',
    '          window.__TAKU_STAX_POST__("settings-change", { requestId: "qr-target-" + Date.now() + "-" + Math.random().toString(36).slice(2), settings: { qrTarget: selectedQr.id } });',
    '          return;',
    '        }',
    '        try {',
    '          await fetch("/api/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: { qrTarget: selectedQr.id } }) });',
    '        } catch {}',
    '      }',
    '    });',
    '  }',
    '  const githubConnect = document.getElementById("githubconnect");',
    '  const githubConfirm = document.getElementById("githubconfirm");',
    '  const githubConfirmHandle = document.getElementById("githubconfirmhandle");',
    '  const githubConfirmCancel = document.getElementById("githubconfirmcancel");',
    '  const githubConfirmSubmit = document.getElementById("githubconfirmsubmit");',
    '  const socialCandidate = data.socialCandidate && typeof data.socialCandidate === "object" ? data.socialCandidate : null;',
    '  const githubCandidate = text(socialCandidate?.username, "").replace(/^@+/, "");',
    '  if (githubConnect && githubConfirm && githubConfirmSubmit && githubCandidate && !persona.social.github && !data.readonly) {',
    '    document.getElementById("githubcandidate").textContent = "@" + githubCandidate;',
    '    if (githubConfirmHandle) githubConfirmHandle.textContent = "@" + githubCandidate;',
    '    githubConnect.classList.remove("is-hidden");',
    '    const closeGithubConfirm = () => githubConfirm.classList.remove("on");',
    '    const openGithubConfirm = () => { githubConfirm.classList.add("on"); githubConfirmSubmit.focus(); };',
    '    window.__TAKU_OPEN_GITHUB_CONFIRM__ = openGithubConfirm;',
    '    githubConnect.addEventListener("click", openGithubConfirm);',
    '    githubConfirmCancel?.addEventListener("click", closeGithubConfirm);',
    '    githubConfirm.addEventListener("click", (event) => { if (event.target === githubConfirm) closeGithubConfirm(); });',
    '    let pendingGithubRequestId = "";',
    '    const setGithubSaving = (saving) => {',
    '      githubConfirmSubmit.disabled = saving;',
    '      githubConfirmSubmit.textContent = saving ? "CONNECTING..." : "ADD GITHUB";',
    '      githubConfirmSubmit.setAttribute("aria-busy", saving ? "true" : "false");',
    '      if (githubConfirmCancel) githubConfirmCancel.disabled = saving;',
    '    };',
    '    const applyConfirmedGithub = () => {',
    '      setGithubSaving(false);',
    '      persona.social.github = githubCandidate;',
    '      const socialBlock = byKey.get("social");',
    '      if (socialBlock) { socialBlock.status = "supported"; socialBlock.source = "publisher.confirmed_social"; socialBlock.value = { ...(socialBlock.value || {}), github: githubCandidate }; }',
    '      delete locks.social;',
    '      if (!selected.includes("social")) selected.splice(Math.min(1, selected.length), 0, "social");',
    '      PERSONAS.publisher.fullset = [...selected];',
    '      PERSONAS.publisher.pd = persona;',
    '      githubConnect.classList.add("is-hidden");',
    '      closeGithubConfirm();',
    '      setPersona("publisher");',
    '      toast("GITHUB @" + githubCandidate + " ADDED");',
    '    };',
    '    window.__TAKU_GITHUB_SAVE_SUCCESS__ = (message) => {',
    '      if (pendingGithubRequestId && message?.requestId !== pendingGithubRequestId) return;',
    '      pendingGithubRequestId = "";',
    '      applyConfirmedGithub();',
    '    };',
    '    window.__TAKU_GITHUB_SAVE_ERROR__ = (message) => {',
    '      if (pendingGithubRequestId && message?.requestId !== pendingGithubRequestId) return;',
    '      pendingGithubRequestId = "";',
    '      setGithubSaving(false);',
    '      toast(text(message?.message, "Could not add GitHub account."));',
    '    };',
    '    githubConfirmSubmit.addEventListener("click", async () => {',
    '      setGithubSaving(true);',
    '      if (typeof window.__TAKU_STAX_POST__ === "function") {',
    '        pendingGithubRequestId = "github-" + Date.now() + "-" + Math.random().toString(36).slice(2);',
    '        window.__TAKU_STAX_POST__("settings-change", { requestId: pendingGithubRequestId, settings: { confirmedSocial: { github: githubCandidate } } });',
    '        return;',
    '      }',
    '      try {',
    '        const response = await fetch("/api/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: { confirmedSocial: { github: githubCandidate } } }) });',
    '        const result = await response.json().catch(() => ({}));',
    '        if (!response.ok || result.ok === false) throw new Error(result.error || "Could not add GitHub account.");',
    '        applyConfirmedGithub();',
    '      } catch (error) {',
    '        setGithubSaving(false);',
    '        toast(error instanceof Error ? error.message : "COULD NOT ADD GITHUB");',
    '      }',
    '    });',
    '  }',
    '  const hasAuthReturn = window.location.hash.includes("taku_auth_code=") || window.location.hash.includes("taku_auth_error=");',
    '  const hasPublishedStax = Boolean(data.publishedStax && data.publishedStax.published);',
    '  if (data.readonly) {',
    '    document.getElementById("scanov")?.classList.add("off");',
    '    document.getElementById("revealov")?.classList.remove("on");',
    '  } else if (hasPublishedStax && !hasAuthReturn) {',
    '    document.getElementById("scanov")?.classList.add("off");',
    '    document.getElementById("revealov")?.classList.remove("on");',
    '    shuffleBuild(true);',
    '  } else {',
    '    playIntro("publisher");',
    '  }',
    '};',
  ].join('\n');
}

export function renderPreview(draft, options = {}) {
  if (options.editor?.enabled || options.readonlyPreview || options.staxAppPreview) return renderStaxAppPreview(draft, options);
  return renderDataOnlyPreview(draft, options);
}
