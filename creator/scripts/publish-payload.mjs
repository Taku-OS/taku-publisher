import { createInlineActionDefinition, sanitizeActionDefinition } from './action-package.mjs';
import { createInlineAgentDefinition } from './agent-package.mjs';
import { createInlinePluginBundle } from './plugin-package.mjs';
import { createInlineSkillPackage } from './skill-package.mjs';
import { buildPersonaProfileV1 } from '#taku-passport-core';
export { STAX_CREATOR_PUBLISH_CONTRACT_VERSION } from './publish-config.mjs';
import { stableId } from './cli.mjs';
import { readJsonFile } from './draft-state.mjs';
import {
  isPluginWrapperDisplayType,
  normalizeStaxDisplayItemType,
  toPublicInventoryImportItem,
} from './public-inventory-item.mjs';
import {
  cleanText,
  containsPrivateOrSecretText,
  isRecord,
  publicHttpUrl,
  publicText,
  sanitizePublishJson,
} from './privacy.mjs';
import { STAX_BLOCK_KEYS, STAX_BLOCKS_SCHEMA } from './stax-blocks.mjs';

const DEFAULT_BUILDER_PROFILE_SNAPSHOT_SCHEMA = 'taku.creator.builder-profile-snapshot.v1';
const MAX_PUBLIC_DESCRIPTION_CHARS = 800;
const DRAFT_SECTION_ALIASES = new Map([
  ['using-tools', ['using-tools', 'used-tools']],
  ['made-items', ['made-items', 'owned-creations']],
  ['remixed-items', ['remixed-items']],
  ['hidden-items', ['hidden-items']],
  ['creator-tools', ['creator-tools']],
]);

export function getDraftSectionItems(draft, sectionId) {
  if (!isRecord(draft) || !Array.isArray(draft.sections)) return [];
  const section = draft.sections.find((entry) => isRecord(entry) && entry.id === sectionId);
  return Array.isArray(section?.items) ? section.items : [];
}

function toPublishDraftItem(item, role = 'using') {
  if (!isRecord(item)) return null;
  const name = publicText(item.customTitle || item.title || item.name, 160);
  if (!name) return null;
  const sourceId = publicText(item.id || item.sourceItemId || item.source_item_id, 240);
  const type = publicText(item.type || item.kind, 80) || 'tool';
  const description = publicText(
    item.customDescription || item.shortDescription || item.description || item.detectedFrom,
    MAX_PUBLIC_DESCRIPTION_CHARS
  );
  const category = publicText(item.category, 80);
  const categories = [...new Set([
    category,
    ...stringArray(item.categories, 4, 80),
  ].filter(Boolean))];
  const tags = stringArray(item.tags, 12, 40);
  const examples = stringArray(item.examples, 8, 220);
  const coverImageUrl = publicHttpUrl(item.coverImageUrl || item.cover_image_url);
  const iconUrl = publicHttpUrl(
    item.iconUrl || item.icon_url || item.customIconUrl || item.custom_icon_url || coverImageUrl
  );
  const externalUrl = publicHttpUrl(item.url || item.externalUrl || item.sourceUrl || item.githubUrl);
  const githubUrl = publicHttpUrl(item.githubUrl || item.url || item.externalUrl || item.sourceUrl);
  const source = publicText(item.source || item.detectedFrom, 120);
  const sourceLabel = publicText(item.sourceLabel || item.source_label || item.sourceName, 120);
  const githubMetadata = createGithubPublishMetadata(item, type, githubUrl || externalUrl || githubReferenceUrlFromItem(item));
  const itemMetadata = sanitizePublishJson(item.metadata);
  const metadata = {
    ...(isRecord(itemMetadata) ? itemMetadata : {}),
    ...(isRecord(githubMetadata) ? githubMetadata : {}),
  };
  const githubItemId = publicText(githubMetadata?.github_reference?.itemId, 240);
  const id = githubItemId || sourceId;
  return {
    ...(id ? { id } : {}),
    role,
    name,
    type,
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
    ...(categories.length ? { categories } : {}),
    ...(tags.length ? { tags } : {}),
    ...(examples.length ? { examples } : {}),
    ...(coverImageUrl ? { coverImageUrl } : {}),
    ...(iconUrl ? { iconUrl, icon_url: iconUrl, customIconUrl: iconUrl, custom_icon_url: iconUrl } : {}),
    ...(externalUrl ? { externalUrl } : {}),
    ...(githubUrl && githubMetadata ? { githubUrl } : {}),
    selected: item.selected === true && item.visible !== false,
    ...(source ? { source } : {}),
    ...(sourceLabel ? { sourceLabel } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function createGithubPublishMetadata(item, type, repoUrl) {
  if (!isRecord(item)) return null;
  const github = isRecord(item.github) ? item.github : {};
  const manifest = githubManifestFromItem(item);
  const parsed = parseGithubPublishReference({
    id: item.id,
    url: repoUrl || item.githubUrl || item.url || item.externalUrl || item.sourceUrl || manifest.storagePath || manifest.id,
    owner: github.owner || manifest.owner,
    repo: github.repo || manifest.repo,
  });
  if (!parsed) return null;
  const source = String(item.source || manifest.source || '').toLowerCase();
  if (source && !source.includes('github') && !String(item.id || '').startsWith('github:') && !repoUrl) {
    return null;
  }
  const repoFullName = `${parsed.owner}/${parsed.repo}`;
  const itemId = `github:${repoFullName}`;
  const url = publicHttpUrl(repoUrl) || `https://github.com/${repoFullName}`;
  const branch = cleanText(github.branch || parsed.branch, 120);
  const normalizedType = normalizeStaxDisplayItemType(type, 'tool');
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const listingDraft = isRecord(metadata.listingDraft) ? metadata.listingDraft : {};
  const pluginWrapper = [
    type,
    item.type,
    item.kind,
    metadata.sourceType,
    metadata.source_type,
    metadata.displayKind,
    metadata.display_kind,
    listingDraft.type,
  ].some(isPluginWrapperDisplayType);
  const detectedDisplayKind = normalizedType === 'app'
    ? 'app'
    : pluginWrapper
      ? 'plugin-wrapper'
      : 'tool';
  const displayKind = 'reference';
  const capabilityKind = normalizedType === 'action'
    ? 'action'
    : normalizedType === 'agent'
      ? 'agent'
      : normalizedType === 'app'
        ? 'app'
        : normalizedType === 'tool'
          ? 'tool'
          : 'skill';
  return {
    displayKind,
    display_kind: displayKind,
    detectedDisplayKind,
    detected_display_kind: detectedDisplayKind,
    ...(pluginWrapper ? { sourceType: 'plugin', source_type: 'plugin' } : {}),
    sourceKind: 'github-repo',
    source_kind: 'github_public_repo',
    authorship_kind: 'third_party',
    authorshipKind: 'third-party',
    placement: 'tools-i-use',
    visibility: 'unlisted',
    ownership_status: 'user-reference',
    ownershipStatus: 'user-reference',
    claim_status: 'none',
    claimStatus: 'none',
    monetization_status: 'disabled',
    monetizationStatus: 'disabled',
    monetization_reason: 'third_party_reference',
    monetizationReason: 'third-party-reference',
    installability: 'reference-only',
    github_reference: {
      itemId,
      fullName: repoFullName,
      owner: parsed.owner,
      repo: parsed.repo,
      ...(branch ? { branch } : {}),
      url,
    },
    source_attribution: {
      githubUrl: url,
      upstreamUrl: url,
      repoFullName,
    },
    taku_install_offer: {
      displayKind,
      sourceKind: 'github-repo',
      installability: 'reference-only',
      cta: 'open-reference',
      deepLink: `taku://stax/install?item=${encodeURIComponent(itemId)}`,
      externalUrl: url,
    },
    capabilitySummary: {
      skills: capabilityKind === 'skill' ? 1 : 0,
      actions: capabilityKind === 'action' ? 1 : 0,
      agents: capabilityKind === 'agent' ? 1 : 0,
      connectors: capabilityKind === 'tool' ? 1 : 0,
      apps: capabilityKind === 'app' ? 1 : 0,
    },
  };
}

function parseGithubPublishReference(input) {
  const owner = cleanText(input.owner, 80);
  const repo = cleanText(input.repo, 120)?.replace(/\.git$/i, '');
  if (owner && repo) return { owner, repo };
  const text = String(input.id || input.url || '').trim();
  if (!text) return null;
  const storagePath = parseGithubStoragePath(text);
  if (storagePath) return storagePath;
  try {
    const url = new URL(text.startsWith('github.com/') ? `https://${text}` : text);
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
    const [urlOwner, urlRepo] = url.pathname.split('/').filter(Boolean);
    if (!urlOwner || !urlRepo) return null;
    return { owner: urlOwner, repo: urlRepo.replace(/\.git$/i, '') };
  } catch {
    return null;
  }
}

function parseGithubStoragePath(value) {
  const text = String(value || '').trim();
  const match = text.match(/^github:([^/\s]+)\/([^@\s:#?]+?)(?:\.git)?(?:@([^:\s#?]+))?(?::.*)?(?:[#?].*)?$/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ''),
    ...(match[3] ? { branch: match[3] } : {}),
  };
}

function githubReferenceUrlFromItem(item) {
  const manifest = githubManifestFromItem(item);
  const direct = publicHttpUrl(manifest.id || manifest.url || manifest.githubUrl);
  if (direct) return direct;
  return githubStoragePathToUrl(manifest.storagePath);
}

function githubStoragePathToUrl(storagePath) {
  const parsed = parseGithubStoragePath(storagePath);
  return parsed ? `https://github.com/${parsed.owner}/${parsed.repo}` : '';
}

function githubManifestFromItem(item) {
  const preview = isRecord(item?.scanPreview) ? item.scanPreview : {};
  const snippet = typeof preview.snippet === 'string' ? preview.snippet.trim() : '';
  if (!snippet || snippet[0] !== '{') return {};
  try {
    const parsed = JSON.parse(snippet);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function createPublicInventoryItem(entry, privateInventory, options = {}) {
  const publishToCommunity = options.publishToCommunity === true;
  if (!publishToCommunity) {
    return toPublicInventoryImportItem(entry.item, entry.item?.role, {
      publishToCommunity: false,
    });
  }
  const referenceMetadata = await createReferenceInstallMetadata(entry.sourceItem, privateInventory, entry.item?.type);
  const publishItem = referenceMetadata
    ? {
        ...entry.item,
        metadata: {
          ...(isRecord(entry.item?.metadata) ? entry.item.metadata : {}),
          ...referenceMetadata,
        },
      }
    : entry.item;
  const item = toPublicInventoryImportItem(publishItem, publishItem?.role, {
    publishToCommunity,
  });
  // Public GitHub tools are references, not user-authored local packages. Once
  // reference metadata is available, do not inspect or inline their install
  // directories. Explicit local uploads still take the packaging path below.
  if (referenceMetadata && !isExplicitLocalInstallable(entry.sourceItem)) return item;
  const inlinePluginBundle = await createInlinePluginBundle(entry.sourceItem, privateInventory);
  if (inlinePluginBundle) return withInlinePluginBundleInstallability(item, inlinePluginBundle);
  const inlineAction = await createInlineActionDefinition(entry.sourceItem, privateInventory);
  if (inlineAction) return withInlineActionInstallability(item, inlineAction);
  const inlineAgent = await createInlineAgentDefinition(entry.sourceItem, privateInventory);
  if (inlineAgent) return withInlineAgentInstallability(item, inlineAgent);
  let inlinePackage;
  try {
    inlinePackage = await createInlineSkillPackage(entry.sourceItem, privateInventory);
  } catch (error) {
    if (!isInlineSkillPackageSafetyError(error)) throw error;
    // An explicitly selected Community Skill must either carry a verified
    // installable package or fail the publish. Silently downgrading it to a
    // reference creates a public card that cannot be installed or run.
    throw error;
  }
  if (inlinePackage) return withInlinePackageInstallability(item, inlinePackage);
  if (publishToCommunity && normalizeStaxDisplayItemType(entry.sourceItem?.type, '') === 'skill') {
    const name = publicText(
      entry.sourceItem?.customTitle || entry.sourceItem?.title || entry.sourceItem?.name,
      160
    ) || 'selected skill';
    throw new Error(
      `Refusing to publish Community Skill "${name}" without an install package.`
    );
  }
  if (isExplicitLocalInstallable(entry.sourceItem)) {
    const name = publicText(
      entry.sourceItem?.customTitle || entry.sourceItem?.title || entry.sourceItem?.name,
      160
    ) || 'selected local tool';
    throw new Error(
      `Refusing to publish local installable "${name}" without an install package. Re-add the local package and try again.`
    );
  }
  return item;
}

function isExplicitLocalInstallable(item) {
  if (!isRecord(item)) return false;
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const sourceKind = cleanText(
    item.sourceKind || item.source_kind || metadata.sourceKind || metadata.source_kind,
    120
  )?.toLowerCase().replace(/_/g, '-');
  const source = cleanText(item.source, 120)?.toLowerCase();
  const installPolicy = cleanText(
    item.installPolicy || item.install_policy || metadata.installPolicy || metadata.install_policy,
    120
  )?.toLowerCase().replace(/_/g, '-');
  return (
    (source === 'local-upload' || sourceKind === 'local-upload') &&
    installPolicy === 'installable'
  );
}

function withInlinePluginBundleInstallability(item, inlinePluginBundle) {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const decomposition = inlinePluginBundle.decomposition;
  const intent = inlinePluginBundle.intent;
  const selectedCapabilities = inlinePluginBundle.selectedCapabilities;
  const capabilitySummary = inlinePluginBundle.capabilitySummary;
  return {
    ...item,
    type: 'tool',
    source_type: 'plugin',
    sourceKind: 'local_upload',
    source_kind: 'local_upload',
    runnable: true,
    installability: 'installable',
    installPolicy: 'installable',
    install_policy: 'installable',
    metadata: {
      ...metadata,
      sourceType: 'plugin',
      source_type: 'plugin',
      sourceKind: 'local_upload',
      source_kind: 'local_upload',
      displayKind: 'plugin-wrapper',
      display_kind: 'plugin-wrapper',
      runnable: true,
      installability: 'installable',
      installPolicy: 'installable',
      install_policy: 'installable',
      bundleOrigin: 'local-plugin-wrapper',
      bundle_origin: 'local-plugin-wrapper',
      taku_decomposition: decomposition,
      takuDecomposition: decomposition,
      taku_bundle_intent: intent,
      takuBundleIntent: intent,
      selectedCapabilities,
      selected_capabilities: selectedCapabilities,
      taku_selected_capabilities: selectedCapabilities,
      capabilitySummary,
      capability_summary: capabilitySummary,
      pluginPackage: {
        kind: inlinePluginBundle.kind,
        selectedInstallableCount: inlinePluginBundle.installableCapabilities.length,
      },
      plugin_package: {
        kind: inlinePluginBundle.kind,
        selectedInstallableCount: inlinePluginBundle.installableCapabilities.length,
      },
    },
  };
}

async function createReferenceInstallMetadata(sourceItem, privateInventory, publishType) {
  if (!isRecord(sourceItem)) return null;
  const directMetadata = createGithubPublishMetadata(sourceItem, publishType || sourceItem.type);
  if (directMetadata) return directMetadata;
  const privateItem = findPrivateInventoryItem(privateInventory, sourceItem);
  const registryEntry = await readRegistrySourceEntry(privateItem, sourceItem);
  if (!registryEntry) return null;
  const definition = isRecord(registryEntry.definition) ? registryEntry.definition : {};
  const storagePath = cleanText(registryEntry.storagePath || definition.storagePath, 400);
  const idUrl = publicHttpUrl(registryEntry.id || definition.id);
  const githubUrl = idUrl || githubStoragePathToUrl(storagePath);
  if (!githubUrl && !storagePath) return null;
  return createGithubPublishMetadata({
    ...sourceItem,
    source: registryEntry.source || definition.source || sourceItem.source,
    sourceUrl: githubUrl,
    githubUrl,
    github: parseGithubStoragePath(storagePath) || undefined,
  }, publishType || registryEntry.type || definition.type || sourceItem.type, githubUrl);
}

function findPrivateInventoryItem(privateInventory, item) {
  const id = typeof item?.id === 'string' ? item.id : '';
  if (!id || !Array.isArray(privateInventory?.items)) return null;
  return privateInventory.items.find((entry) => entry?.id === id) || null;
}

async function readRegistrySourceEntry(privateItem, sourceItem) {
  const localPath = typeof privateItem?.localPath === 'string' ? privateItem.localPath : '';
  if (!localPath || !localPath.endsWith('.json')) return null;
  const manifest = await readJsonFile(localPath);
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  for (const entry of entries) {
    const definition = isRecord(entry?.definition) ? entry.definition : {};
    const type = cleanText(entry?.kind || definition.type || sourceItem.type, 80) || sourceItem.type || 'workflow';
    const name = cleanText(entry?.name || definition.name || definition.commandName || entry?.slug, 120) || 'Untitled';
    const id = stableId(sourceItem.source, type, entry?.id || name, localPath);
    if (id === sourceItem.id) return entry;
  }
  return null;
}

function withInlinePackageInstallability(item, inlinePackage) {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  return {
    ...item,
    type: 'skill',
    source_type: 'skill',
    sourceKind: 'local_upload',
    source_kind: 'local_upload',
    runnable: true,
    installability: 'installable',
    installPolicy: 'installable',
    install_policy: 'installable',
    metadata: {
      ...metadata,
      sourceType: 'skill',
      source_type: 'skill',
      sourceKind: 'local_upload',
      source_kind: 'local_upload',
      runnable: true,
      installability: 'installable',
      installPolicy: 'installable',
      install_policy: 'installable',
      skillPackage: {
        kind: inlinePackage.kind,
        format: inlinePackage.format,
        hash: inlinePackage.hash,
        size: inlinePackage.size,
        files: inlinePackage.files,
      },
      skill_package: {
        kind: inlinePackage.kind,
        format: inlinePackage.format,
        hash: inlinePackage.hash,
        size: inlinePackage.size,
        files: inlinePackage.files,
      },
      capabilitySummary: {
        skills: 1,
        actions: 0,
        agents: 0,
        connectors: 0,
        apps: 0,
      },
      capability_summary: {
        skills: 1,
        actions: 0,
        agents: 0,
        connectors: 0,
        apps: 0,
      },
    },
    package: inlinePackage,
  };
}

function withInlineActionInstallability(item, inlineAction) {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const definition = isRecord(inlineAction.definition) ? inlineAction.definition : {};
  return {
    ...item,
    type: 'action',
    sourceKind: 'local_upload',
    source_kind: 'local_upload',
    runnable: true,
    installPolicy: 'installable',
    install_policy: 'installable',
    metadata: {
      ...metadata,
      sourceKind: 'local_upload',
      source_kind: 'local_upload',
      runnable: true,
      installPolicy: 'installable',
      install_policy: 'installable',
      definition,
      actionDefinition: definition,
      action_definition: definition,
      workflowDefinition: definition,
      workflow_definition: definition,
      actionPackage: {
        kind: inlineAction.kind,
        format: inlineAction.format,
        hash: inlineAction.hash,
        size: inlineAction.size,
      },
      action_package: {
        kind: inlineAction.kind,
        format: inlineAction.format,
        hash: inlineAction.hash,
        size: inlineAction.size,
      },
      capabilitySummary: {
        skills: 0,
        actions: 1,
        agents: 0,
        connectors: 0,
        apps: 0,
      },
      capability_summary: {
        skills: 0,
        actions: 1,
        agents: 0,
        connectors: 0,
        apps: 0,
      },
    },
  };
}

function withInlineAgentInstallability(item, inlineAgent) {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const definition = isRecord(inlineAgent.definition) ? inlineAgent.definition : {};
  return {
    ...item,
    type: 'agent',
    source_type: 'agent',
    sourceKind: 'local_upload',
    source_kind: 'local_upload',
    runnable: true,
    installability: 'installable',
    installPolicy: 'installable',
    install_policy: 'installable',
    metadata: {
      ...metadata,
      sourceType: 'agent',
      source_type: 'agent',
      sourceKind: 'local_upload',
      source_kind: 'local_upload',
      runnable: true,
      installability: 'installable',
      installPolicy: 'installable',
      install_policy: 'installable',
      definition,
      agentDefinition: definition,
      agent_definition: definition,
      agent: definition,
      agentPackage: {
        kind: inlineAgent.kind,
        format: inlineAgent.format,
        hash: inlineAgent.hash,
        size: inlineAgent.size,
      },
      agent_package: {
        kind: inlineAgent.kind,
        format: inlineAgent.format,
        hash: inlineAgent.hash,
        size: inlineAgent.size,
      },
      capabilitySummary: {
        skills: 0,
        actions: 0,
        agents: 1,
        connectors: 0,
        apps: 0,
      },
      capability_summary: {
        skills: 0,
        actions: 0,
        agents: 1,
        connectors: 0,
        apps: 0,
      },
    },
  };
}

function isInlineSkillPackageSafetyError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.startsWith('Refusing to publish inline skill package');
}

function withSkippedInlinePackageMetadata(item, error) {
  const message = error instanceof Error ? error.message : String(error || '');
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  return {
    ...item,
    metadata: {
      ...metadata,
      packageSkipped: true,
      package_skipped: true,
      packageSkipReason: cleanText(message, 240) || 'SKILL.md package skipped by privacy guard.',
      package_skip_reason: cleanText(message, 240) || 'SKILL.md package skipped by privacy guard.',
      installPolicy: 'reference_only',
      install_policy: 'reference_only',
    },
  };
}

function publicInventorySourceKey(item) {
  if (!isRecord(item)) return '';
  const id = cleanText(item.id, 160);
  if (id) return `id:${id}`;
  const title = cleanText(item.title || item.name || item.customTitle, 160);
  const type = cleanText(item.type || item.kind, 80);
  if (!title) return '';
  return `${type || 'item'}:${title}`.toLowerCase();
}

function hasCreatorToolDockSelectionMarker(item) {
  if (!isRecord(item)) return false;
  const reasons = Array.isArray(item.ownershipReasons) ? item.ownershipReasons : [];
  return reasons.some((reason) => cleanText(reason, 120) === 'Selected in Creator Tool Dock');
}

function creatorToolPublishRole(item) {
  if (!isRecord(item)) return 'using';
  const role = String(item.role || item.relation || '').trim().toLowerCase();
  if (role === 'made' || role === 'built' || role === 'original') return 'made';
  if (role === 'remixed' || role === 'remix' || role === 'derived') return 'remixed';
  const ownership = String(item.ownership || '').trim().toLowerCase();
  if (ownership === 'owned' || ownership === 'mine') return 'made';
  return 'using';
}

function dedupePublicInventorySourceItems(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = publicInventorySourceKey(item);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

function getDraftSectionItemsByCanonicalId(draft, sectionId) {
  const aliases = DRAFT_SECTION_ALIASES.get(sectionId) || [sectionId];
  return dedupePublicInventorySourceItems(aliases.flatMap((id) => getDraftSectionItems(draft, id)));
}

function createPublicUsageSummary(usage) {
  if (!usage) return undefined;
  const amount = Number(usage.totalTokens);
  const sessions = Number(usage.sessionCount);
  if (!Number.isFinite(amount) || !Number.isFinite(sessions)) return undefined;
  return {
    label: publicText(usage.label, 80) || 'This Month',
    period: publicText(usage.periodId, 80) || 'thisMonth',
    unit: 'tokens',
    amount: Math.max(0, Math.floor(amount)),
    sessions: Math.max(0, Math.floor(sessions)),
    events: Math.max(0, Math.floor(Number(usage.eventCount) || 0)),
  };
}

function formatPublicModelPercentage(share) {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  const percent = share * 100;
  if (percent < 0.1) return '<0.1%';
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? Math.round(rounded) : rounded}%`;
}

function builderProfileSnapshotSchema(options = {}) {
  return options.builderProfileSnapshotSchema || DEFAULT_BUILDER_PROFILE_SNAPSHOT_SCHEMA;
}

function sanitizeBuilderProfileSnapshotForPublish(profileSnapshot, options = {}) {
  const schemaVersion = builderProfileSnapshotSchema(options);
  const sanitized = sanitizeBuilderProfileSnapshot(profileSnapshot, schemaVersion);
  if (!sanitized) {
    throw new Error('Invalid builderProfileSnapshot schema; refusing to publish.');
  }
  return canonicalizePublicPersonaLabel(sanitized);
}

function canonicalizePublicPersonaLabel(profileSnapshot) {
  const persona = asRecord(profileSnapshot.persona);
  const code = stringValue(persona.code, 12).toUpperCase();
  const profile = buildPersonaProfileV1({ code }, { locale: 'en-US' });
  const hasCanonicalProfile = profile.code === code;

  return {
    ...profileSnapshot,
    persona: {
      ...persona,
      title: hasCanonicalProfile ? profile.family.label : 'AI Builder',
      subtitle: hasCanonicalProfile ? profile.basePersona.title : 'AI Builder',
    },
  };
}

function sanitizeBuilderProfileSnapshot(value, schemaVersion) {
  const raw = asRecord(value);
  if (raw.schemaVersion !== schemaVersion) return null;

  const persona = asRecord(raw.persona);
  const behavior = asRecord(raw.behavior);
  const usage = asRecord(raw.usage);
  const codeActivity = asRecord(raw.codeActivity ?? raw.code_activity);
  const inventory = asRecord(raw.inventory);
  const dataReceipt = asRecord(raw.dataReceipt ?? raw.data_receipt);
  const staxBlocks = sanitizeStaxBlocks(raw.staxBlocks ?? raw.stax_blocks);
  const staxCardSnapshot = sanitizeStaxCardSnapshot(raw.staxCardSnapshot ?? raw.stax_card_snapshot);
  const card = sanitizeSnapshotCard(raw.card);
  const personaTraits = asArray(persona.traits)
    .slice(0, 16)
    .map(sanitizeTrait)
    .filter(isNonNull);
  const personaBadges = sanitizeBadgeList(
    raw.badges ?? raw.profileBadges ?? persona.badges ?? persona.traits,
    personaTraits
  );
  const hidden = sanitizeHiddenGroup(
    persona.hidden ?? raw.hidden,
    raw.featuredHidden ?? raw.featured_hidden ?? persona.featuredHidden ?? persona.featured_hidden
  );
  const selectedHidden = sanitizeHidden(persona.selectedHidden ?? persona.selected_hidden);
  const featuredHidden = hidden?.featured ?? sanitizeHidden(
    raw.featuredHidden ??
      raw.featured_hidden ??
      persona.featuredHidden ??
      persona.featured_hidden ??
      selectedHidden
  );

  return {
    schemaVersion,
    generatedAt: optionalString(raw.generatedAt ?? raw.generated_at, 80),
    privacy: {
      publicSummaryOnly: true,
      excludesPromptContent: true,
      excludesCommandArguments: true,
      excludesRawLogs: true,
      excludesSourceContent: true,
      excludesLocalPaths: true,
      excludesWorkspaceHashes: true,
      excludesRawSignals: true,
    },
    ...(card ? { card } : {}),
    persona: {
      code: stringValue(persona.code, 12),
      title: stringValue(persona.title, 120, 'AI Builder'),
      subtitle: optionalString(persona.subtitle, 220),
      description: optionalString(persona.description ?? asRecord(persona.basePersona).description ?? persona.signature, 220),
      signature: optionalString(persona.signature, 220),
      tone: optionalString(persona.tone, 80),
      ...(stringValue(persona.code, 12).toUpperCase() === 'ROOKIE'
        ? { rookieVariant: persona.rookieVariant === 'alt' ? 'alt' : 'default' }
        : {}),
      confidence: optionalNumber(persona.confidence),
      axes: stringValue(persona.code, 12).toUpperCase() === 'ROOKIE'
        ? []
        : asArray(persona.axes).slice(0, 8).map(sanitizeAxis).filter(isNonNull),
      influences: asArray(persona.influences).slice(0, 8).map(sanitizeInfluence).filter(isNonNull),
      traits: personaTraits,
      badges: personaBadges,
      hidden,
      selectedHidden,
      featuredHidden,
    },
    badges: personaBadges,
    featuredHidden,
    behavior: {
      period: sanitizePeriod(behavior.period, usage),
      planningRatio: optionalNumber(behavior.planningRatio ?? behavior.planning_ratio),
      steeringRatio: optionalNumber(behavior.steeringRatio ?? behavior.steering_ratio),
      autonomyScore: optionalNumber(behavior.autonomyScore ?? behavior.autonomy_score),
      autonomyLevel: optionalString(behavior.autonomyLevel ?? behavior.autonomy_level, 80),
      dominantToolCategory: optionalString(
        behavior.dominantToolCategory ?? behavior.dominant_tool_category,
        80
      ),
      topToolsMix: asArray(behavior.topToolsMix ?? behavior.top_tools_mix)
        .slice(0, 8)
        .map(sanitizeTopToolMix)
        .filter(isNonNull),
      display: sanitizeBehaviorDisplay(behavior.display),
      workPattern: sanitizeWorkPattern(behavior.workPattern ?? behavior.work_pattern),
      evidence: stringArray(behavior.evidence, 4, 220),
    },
    usage: {
      label: stringValue(usage.label, 80, 'This Month'),
      periodId: stringValue(usage.periodId ?? usage.period_id, 80, 'thisMonth'),
      totalTokens: integerValue(usage.totalTokens ?? usage.total_tokens),
      sessionCount: integerValue(usage.sessionCount ?? usage.session_count),
      eventCount: integerValue(usage.eventCount ?? usage.event_count),
      modelUsage: sanitizeModelUsage(usage.modelUsage ?? usage.model_usage),
      estimatedCost: sanitizeEstimatedCost(usage.estimatedCost ?? usage.estimated_cost),
      localActivity: sanitizeLocalActivity(usage.localActivity ?? usage.local_activity),
    },
    codeActivity: {
      periodId: stringValue(codeActivity.periodId ?? codeActivity.period_id ?? usage.periodId ?? usage.period_id, 80, 'thisMonth'),
      repoCount: integerValue(codeActivity.repoCount ?? codeActivity.repo_count),
      aiSessionRepoCount: integerValue(codeActivity.aiSessionRepoCount ?? codeActivity.ai_session_repo_count),
      commitCount: integerValue(codeActivity.commitCount ?? codeActivity.commit_count),
      commitCount30d: integerValue(codeActivity.commitCount30d ?? codeActivity.commit_count_30d),
      aiSessionCommitCount: integerValue(codeActivity.aiSessionCommitCount ?? codeActivity.ai_session_commit_count),
      aiSessionCommitCount30d: integerValue(codeActivity.aiSessionCommitCount30d ?? codeActivity.ai_session_commit_count_30d),
      filesChanged: integerValue(codeActivity.filesChanged ?? codeActivity.files_changed),
      linesAdded: integerValue(codeActivity.linesAdded ?? codeActivity.lines_added),
      linesDeleted: integerValue(codeActivity.linesDeleted ?? codeActivity.lines_deleted),
      aiSessionFilesChanged: integerValue(codeActivity.aiSessionFilesChanged ?? codeActivity.ai_session_files_changed),
      aiSessionLinesAdded: integerValue(codeActivity.aiSessionLinesAdded ?? codeActivity.ai_session_lines_added),
      aiSessionLinesDeleted: integerValue(codeActivity.aiSessionLinesDeleted ?? codeActivity.ai_session_lines_deleted),
      sourceFilesChanged: integerValue(codeActivity.sourceFilesChanged ?? codeActivity.source_files_changed),
      sourceLinesAdded: integerValue(codeActivity.sourceLinesAdded ?? codeActivity.source_lines_added),
      sourceLinesDeleted: integerValue(codeActivity.sourceLinesDeleted ?? codeActivity.source_lines_deleted),
      aiSessionSourceFilesChanged: integerValue(codeActivity.aiSessionSourceFilesChanged ?? codeActivity.ai_session_source_files_changed),
      aiSessionSourceLinesAdded: integerValue(codeActivity.aiSessionSourceLinesAdded ?? codeActivity.ai_session_source_lines_added),
      aiSessionSourceLinesDeleted: integerValue(codeActivity.aiSessionSourceLinesDeleted ?? codeActivity.ai_session_source_lines_deleted),
    },
    inventory: {
      usingToolCount: integerValue(inventory.usingToolCount ?? inventory.using_tool_count),
      madeItemCount: integerValue(inventory.madeItemCount ?? inventory.made_item_count),
      remixedItemCount: integerValue(inventory.remixedItemCount ?? inventory.remixed_item_count),
      usingToolsPreview: asArray(inventory.usingToolsPreview ?? inventory.using_tools_preview)
        .slice(0, 12)
        .map(sanitizeInventoryPreviewItem)
        .filter(isNonNull),
      madeItemsPreview: asArray(inventory.madeItemsPreview ?? inventory.made_items_preview)
        .slice(0, 12)
        .map(sanitizeInventoryPreviewItem)
        .filter(isNonNull),
      remixedItemsPreview: asArray(inventory.remixedItemsPreview ?? inventory.remixed_items_preview)
        .slice(0, 12)
        .map(sanitizeInventoryPreviewItem)
        .filter(isNonNull),
    },
    ...(staxBlocks ? { staxBlocks } : {}),
    ...(staxCardSnapshot ? { staxCardSnapshot } : {}),
    dataReceipt: {
      reads: stringArray(dataReceipt.reads, 12, 120),
      publicShareIncludes: stringArray(
        dataReceipt.publicShareIncludes ?? dataReceipt.public_share_includes,
        12,
        120
      ),
      neverIncludes: stringArray(dataReceipt.neverIncludes ?? dataReceipt.never_includes, 16, 120),
    },
  };
}

function sanitizeStaxCardSnapshot(value) {
  const raw = asRecord(value);
  if (raw.schemaVersion !== 'taku.stax.card-snapshot.v1') return undefined;
  const rawCanvas = asRecord(raw.canvas);
  const canvas = {
    width: boundedInteger(rawCanvas.width, 320, 2000, 980),
    height: boundedInteger(rawCanvas.height, 320, 2000, 660),
    columns: boundedInteger(rawCanvas.columns, 1, 16, 8),
    rows: boundedInteger(rawCanvas.rows, 1, 16, 5),
    cellSize: boundedInteger(rawCanvas.cellSize, 24, 240, 104),
    gap: boundedInteger(rawCanvas.gap, 0, 48, 8),
  };
  const blocks = asArray(raw.blocks)
    .map((block) => sanitizeStaxCardSnapshotBlock(block, canvas))
    .filter(isNonNull)
    .slice(0, 32);
  if (!blocks.length || !blocks.some((block) => block.key === 'hero')) return undefined;
  const imageDataUrl = sanitizePngDataUrl(raw.imageDataUrl ?? raw.image_data_url);
  return {
    schemaVersion: 'taku.stax.card-snapshot.v1',
    capturedAt: optionalString(raw.capturedAt ?? raw.captured_at, 80),
    canvas,
    blocks,
    ...(imageDataUrl ? { imageDataUrl } : {}),
  };
}

function sanitizeStaxCardSnapshotBlock(value, canvas) {
  const raw = asRecord(value);
  const key = stringValue(raw.key, 40).toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(key) || !STAX_BLOCK_KEYS.includes(key)) return null;
  const cx = boundedInteger(raw.cx, 0, canvas.columns - 1, 0);
  const cy = boundedInteger(raw.cy, 0, canvas.rows - 1, 0);
  const cw = boundedInteger(raw.cw, 1, canvas.columns, 1);
  const ch = boundedInteger(raw.ch, 1, canvas.rows, 1);
  if (cx + cw > canvas.columns || cy + ch > canvas.rows) return null;
  return { key, cx, cy, cw, ch };
}

function sanitizePngDataUrl(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (text.length > 4_000_000) return '';
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(text)) return '';
  return text.replace(/\s+/g, '');
}

function sanitizeSnapshotCard(value) {
  const raw = asRecord(value);
  const displayName = optionalString(raw.displayName ?? raw.display_name, 120);
  const avatarUrl = publicHttpUrl(raw.avatarUrl ?? raw.avatar_url);
  const visibility = optionalString(raw.visibility, 40);
  const qrTarget = optionalString(raw.qrTarget ?? raw.qr_target, 20) === 'profile' ? 'profile' : 'stax';
  if (!displayName && !avatarUrl && !visibility && !raw.qrTarget && !raw.qr_target) return null;
  return {
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(visibility ? { visibility } : {}),
    qrTarget,
  };
}

function sanitizeAxis(value) {
  const raw = asRecord(value);
  const id = stringValue(raw.id, 80);
  const label = stringValue(raw.label, 120);
  const letter = stringValue(raw.letter, 8);
  if (!id && !label && !letter) return null;
  return {
    id,
    label,
    letter,
    score: optionalNumber(raw.score),
    confidence: optionalNumber(raw.confidence),
    evidence: stringArray(raw.evidence, 3, 180),
  };
}

function sanitizeInfluence(value) {
  const raw = asRecord(value);
  const axisId = stringValue(raw.axisId ?? raw.axis_id, 80);
  const letter = stringValue(raw.letter, 8);
  const impact = stringValue(raw.impact, 240);
  if (!axisId && !letter && !impact) return null;
  return {
    axisId,
    letter,
    meaning: stringValue(raw.meaning, 80),
    impact,
  };
}

function sanitizeTrait(value) {
  const raw = asRecord(value);
  const label = stringValue(raw.label, 100);
  if (!label) return null;
  return {
    id: stringValue(raw.id, 80),
    label,
    category: stringValue(raw.category, 80, 'Trait'),
    evidence: optionalString(raw.evidence, 180),
    confidence: optionalNumber(raw.confidence),
    manual: raw.manual === true,
  };
}

function sanitizeBadgeList(value, fallback = []) {
  const badges = asArray(value)
    .slice(0, 16)
    .map(sanitizeTrait)
    .filter(isNonNull);
  return badges.length > 0 ? badges : fallback;
}

function sanitizeHiddenGroup(value, featuredFallback) {
  const raw = asRecord(value);
  const unlocked = asArray(raw.unlocked).slice(0, 12).map(sanitizeHidden).filter(isNonNull);
  const featured = sanitizeHidden(raw.featured ?? raw.selected ?? featuredFallback);
  const featuredSource = optionalString(raw.featuredSource ?? raw.featured_source, 40);
  if (!featured && unlocked.length === 0 && !featuredSource) return undefined;
  return {
    ...(featured ? { featured } : {}),
    unlocked,
    ...(featuredSource ? { featuredSource } : {}),
  };
}

function sanitizeHidden(value) {
  const raw = asRecord(value);
  const title = stringValue(raw.title, 120);
  if (!title) return undefined;
  return {
    id: stringValue(raw.id, 80),
    title,
    subtitle: optionalString(raw.subtitle, 120),
    description: optionalString(raw.description, 240),
    trigger: optionalString(raw.trigger, 180),
    confidence: optionalNumber(raw.confidence),
  };
}

function sanitizePeriod(value, usage) {
  const raw = asRecord(value);
  return {
    id: stringValue(raw.id ?? usage.periodId ?? usage.period_id, 80, 'thisMonth'),
    label: stringValue(raw.label ?? usage.label, 80, 'This Month'),
  };
}

function sanitizeTopToolMix(value) {
  const raw = asRecord(value);
  const label = stringValue(raw.label, 80);
  if (!label) return null;
  return {
    category: stringValue(raw.category, 80, 'other'),
    label,
    share: numberValue(raw.share),
  };
}

function sanitizeBehaviorDisplay(value) {
  const raw = asRecord(value);
  const display = {
    planning: optionalString(raw.planning, 40),
    steering: optionalString(raw.steering, 40),
    autonomy: optionalString(raw.autonomy, 60),
    iteration: optionalString(raw.iteration, 40),
    topMix: optionalString(raw.topMix ?? raw.top_mix, 80),
  };
  return Object.values(display).some(Boolean) ? display : undefined;
}

function sanitizeModelUsage(value) {
  const raw = asRecord(value);
  const sourceRows = asArray(raw.topModels ?? raw.top_models).length
    ? asArray(raw.topModels ?? raw.top_models)
    : asArray(raw.models);
  const rows = sourceRows
    .slice(0, 4)
    .map((item) => {
      const row = asRecord(item);
      const modelId = stringValue(row.modelId ?? row.model_id ?? row.name, 160);
      const share = normalizedRatio(row.share);
      if (!modelId || share <= 0) return null;
      return {
        modelId,
        name: modelId,
        share,
        percentage: optionalString(row.percentage, 16) || formatPublicModelPercentage(share),
      };
    })
    .filter(isNonNull);
  if (!rows.length) return undefined;
  return {
    totalTokens: integerValue(raw.totalTokens ?? raw.total_tokens),
    modelCount: Math.max(rows.length, integerValue(raw.modelCount ?? raw.model_count)),
    topModels: rows,
    models: rows,
  };
}

function sanitizeEstimatedCost(value) {
  const raw = asRecord(value);
  const totalUsd = optionalNumber(raw.totalUsd ?? raw.total_usd);
  if (!totalUsd || totalUsd <= 0) return undefined;
  return {
    currency: 'USD',
    estimated: true,
    actualSpend: false,
    pricingBasis: optionalString(raw.pricingBasis ?? raw.pricing_basis, 100) || 'monthly-market-api-price-equivalent',
    priceTableUpdatedAt: optionalString(raw.priceTableUpdatedAt ?? raw.price_table_updated_at, 40),
    totalUsd: roundMoney(totalUsd),
    totalObservedTokenCount: integerValue(raw.totalObservedTokenCount ?? raw.total_observed_token_count),
    pricedTokenCount: integerValue(raw.pricedTokenCount ?? raw.priced_token_count),
    unpricedTokenCount: integerValue(raw.unpricedTokenCount ?? raw.unpriced_token_count),
    coverageRatio: normalizedRatio(raw.coverageRatio ?? raw.coverage_ratio),
    partial: raw.partial === true,
    pricedModelCount: integerValue(raw.pricedModelCount ?? raw.priced_model_count),
    unpricedModelCount: integerValue(raw.unpricedModelCount ?? raw.unpriced_model_count),
    topModels: asArray(raw.topModels ?? raw.top_models).slice(0, 4).map(sanitizeCostModel).filter(isNonNull),
    warnings: stringArray(raw.warnings, 4, 180),
  };
}

function sanitizeCostModel(value) {
  const raw = asRecord(value);
  const modelId = stringValue(raw.modelId ?? raw.model_id, 160);
  const totalUsd = optionalNumber(raw.totalUsd ?? raw.total_usd);
  if (!modelId || !totalUsd || totalUsd <= 0) return null;
  return {
    modelId,
    provider: optionalString(raw.provider, 80),
    pricingModel: optionalString(raw.pricingModel ?? raw.pricing_model, 120),
    priceSource: optionalString(raw.priceSource ?? raw.price_source, 40),
    totalUsd: roundMoney(totalUsd),
  };
}

function sanitizeWorkPattern(value) {
  const raw = asRecord(value);
  const hourBuckets = asArray(raw.hourBuckets ?? raw.hour_buckets)
    .slice(0, 24)
    .map((item) => integerValue(item));
  while (hourBuckets.length < 24) hourBuckets.push(0);
  const hasPattern =
    hourBuckets.some((count) => count > 0) ||
    optionalNumber(raw.nightShare ?? raw.night_share) !== undefined ||
    optionalNumber(raw.avgSessionMinutes ?? raw.avg_session_minutes) !== undefined;
  if (!hasPattern) return undefined;

  return {
    timezone: stringValue(raw.timezone, 80, 'local'),
    hourBuckets,
    peakHour: nullableHour(raw.peakHour ?? raw.peak_hour),
    activeHourCount: integerValue(raw.activeHourCount ?? raw.active_hour_count),
    nightShare: normalizedRatio(raw.nightShare ?? raw.night_share),
    morningShare: normalizedRatio(raw.morningShare ?? raw.morning_share),
    businessHoursShare: normalizedRatio(raw.businessHoursShare ?? raw.business_hours_share),
    weekendShare: normalizedRatio(raw.weekendShare ?? raw.weekend_share),
    durationSessionCount: integerValue(raw.durationSessionCount ?? raw.duration_session_count),
    avgSessionMinutes: nonNegativeNumber(raw.avgSessionMinutes ?? raw.avg_session_minutes),
    longestSessionMinutes: nonNegativeNumber(raw.longestSessionMinutes ?? raw.longest_session_minutes),
    shortSessionShare: normalizedRatio(raw.shortSessionShare ?? raw.short_session_share),
    longSessionShare: normalizedRatio(raw.longSessionShare ?? raw.long_session_share),
    flowSessionShare: normalizedRatio(raw.flowSessionShare ?? raw.flow_session_share),
  };
}

function sanitizeLocalActivity(value) {
  const raw = asRecord(value);
  const dailyHeatmap = asArray(raw.dailyHeatmap ?? raw.daily_heatmap)
    .slice(-120)
    .map(sanitizeDailyActivityRow)
    .filter(isNonNull);
  const sessionSplit = sanitizeSessionSplit(raw.sessionSplit ?? raw.session_split);
  const trend30d = sanitizeTrend30d(raw.trend30d ?? raw.trend_30d);
  const delta30d = sanitizeDelta30d(raw.delta30d ?? raw.delta_30d);
  const buildStreak = sanitizeBuildStreak(raw.buildStreak ?? raw.build_streak);
  const hasActivity =
    dailyHeatmap.length > 0 ||
    sessionSplit.sessionCount > 0 ||
    trend30d.buckets.length > 0 ||
    integerValue(raw.buildSessionCount ?? raw.build_session_count) > 0;
  if (!hasActivity) return undefined;

  return {
    schemaVersion: stringValue(raw.schemaVersion ?? raw.schema_version, 80, 'taku.creator.local-activity.v1'),
    period: sanitizePeriod(raw.period, raw),
    dailyHeatmap,
    activeDayCount: integerValue(raw.activeDayCount ?? raw.active_day_count),
    buildDayCount: integerValue(raw.buildDayCount ?? raw.build_day_count),
    buildSessionCount: integerValue(raw.buildSessionCount ?? raw.build_session_count),
    chatSessionCount: integerValue(raw.chatSessionCount ?? raw.chat_session_count),
    sessionSplit,
    buildStreak,
    trend30d,
    delta30d,
  };
}

function sanitizeDailyActivityRow(value) {
  const raw = asRecord(value);
  const date = stringValue(raw.date, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    date,
    active: raw.active !== false,
    sessionCount: integerValue(raw.sessionCount ?? raw.session_count),
    buildSessionCount: integerValue(raw.buildSessionCount ?? raw.build_session_count),
    eventCount: integerValue(raw.eventCount ?? raw.event_count),
    toolCallCount: integerValue(raw.toolCallCount ?? raw.tool_call_count),
    tokenCount: integerValue(raw.tokenCount ?? raw.token_count),
    buildIntensity: Math.min(4, integerValue(raw.buildIntensity ?? raw.build_intensity)),
  };
}

function sanitizeSessionSplit(value) {
  const raw = asRecord(value);
  return {
    sessionCount: integerValue(raw.sessionCount ?? raw.session_count),
    buildSessionCount: integerValue(raw.buildSessionCount ?? raw.build_session_count),
    chatSessionCount: integerValue(raw.chatSessionCount ?? raw.chat_session_count),
    buildShare: normalizedRatio(raw.buildShare ?? raw.build_share),
    chatShare: normalizedRatio(raw.chatShare ?? raw.chat_share),
    buildMinutes: nonNegativeNumber(raw.buildMinutes ?? raw.build_minutes),
    chatMinutes: nonNegativeNumber(raw.chatMinutes ?? raw.chat_minutes),
    buildTimeShare: normalizedRatio(raw.buildTimeShare ?? raw.build_time_share),
    chatTimeShare: normalizedRatio(raw.chatTimeShare ?? raw.chat_time_share),
  };
}

function sanitizeBuildStreak(value) {
  const raw = asRecord(value);
  return {
    currentDays: integerValue(raw.currentDays ?? raw.current_days),
    bestDays: integerValue(raw.bestDays ?? raw.best_days),
  };
}

function sanitizeTrend30d(value) {
  const raw = asRecord(value);
  return {
    metric: stringValue(raw.metric, 80, 'buildSessions'),
    periodId: stringValue(raw.periodId ?? raw.period_id, 80, 'last30Days'),
    buckets: asArray(raw.buckets).slice(0, 8).map(sanitizeTrendBucket).filter(isNonNull),
  };
}

function sanitizeTrendBucket(value) {
  const raw = asRecord(value);
  const id = stringValue(raw.id, 40);
  if (!id) return null;
  return {
    id,
    label: stringValue(raw.label, 80, id),
    startsAt: optionalString(raw.startsAt ?? raw.starts_at, 80),
    endsAt: optionalString(raw.endsAt ?? raw.ends_at, 80),
    buildSessionCount: integerValue(raw.buildSessionCount ?? raw.build_session_count),
    activeDayCount: integerValue(raw.activeDayCount ?? raw.active_day_count),
    toolCallCount: integerValue(raw.toolCallCount ?? raw.tool_call_count),
    tokenCount: integerValue(raw.tokenCount ?? raw.token_count),
  };
}

function sanitizeDelta30d(value) {
  const raw = asRecord(value);
  const delta = optionalNumber(raw.delta);
  return {
    metric: stringValue(raw.metric, 80, 'buildSessions'),
    current: integerValue(raw.current),
    previous: integerValue(raw.previous),
    delta: delta === undefined ? null : delta,
    display: optionalString(raw.display, 40),
  };
}

function sanitizeInventoryPreviewItem(value) {
  const raw = asRecord(value);
  const name = stringValue(raw.name, 120);
  if (!name) return null;
  return {
    name,
    type: stringValue(raw.type, 80, 'item'),
    source: optionalString(raw.source, 80),
  };
}

function asRecord(value) {
  return isRecord(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value, maxLength, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().replace(/\s+/g, ' ');
  if (containsPrivateOrSecretText(text)) return fallback;
  return text ? text.slice(0, maxLength) : fallback;
}

function optionalString(value, maxLength) {
  const text = stringValue(value, maxLength);
  return text || undefined;
}

function numberValue(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function nonNegativeNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : 0;
}

function normalizedRatio(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.min(1, next));
}

function roundMoney(value) {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) return 0;
  return Math.round(next * 1_000_000) / 1_000_000;
}

function nullableHour(value) {
  const next = Math.floor(Number(value));
  return next >= 0 && next <= 23 ? next : null;
}

function integerValue(value) {
  const next = Math.floor(numberValue(value));
  return next > 0 ? next : 0;
}

function boundedInteger(value, min, max, fallback) {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function stringArray(value, maxItems, maxLength) {
  return asArray(value)
    .map((item) => stringValue(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function isNonNull(value) {
  return value !== null && value !== undefined;
}

function sanitizeStaxBlocks(value) {
  const raw = asRecord(value);
  const rawBlocks = Array.isArray(raw.blocks)
    ? raw.blocks
    : Object.entries(asRecord(raw.blocks)).map(([key, block]) => ({ key, ...asRecord(block) }));
  if (!rawBlocks.length) return undefined;

  const byKey = new Map();
  for (const item of rawBlocks) {
    const block = sanitizeStaxBlock(item);
    if (!block || byKey.has(block.key)) continue;
    byKey.set(block.key, block);
  }

  const blocks = [
    ...STAX_BLOCK_KEYS.map((key) => byKey.get(key)).filter(Boolean),
    ...Array.from(byKey.values()).filter((block) => !STAX_BLOCK_KEYS.includes(block.key)),
  ].slice(0, STAX_BLOCK_KEYS.length);
  if (!blocks.length) return undefined;

  return {
    schemaVersion: stringValue(raw.schemaVersion ?? raw.schema_version, 80, STAX_BLOCKS_SCHEMA),
    generatedAt: optionalString(raw.generatedAt ?? raw.generated_at, 80),
    blocks,
    summary: summarizeStaxBlocks(blocks),
  };
}

function sanitizeStaxBlock(value) {
  const raw = asRecord(value);
  const key = stringValue(raw.key ?? raw.id ?? raw.name, 40);
  if (!key) return null;
  const status = sanitizeStaxBlockStatus(raw.status, raw);
  const publishValue = sanitizePublishJson(raw.value);
  const quality = sanitizeStaxBlockQuality(raw.quality);
  return {
    key,
    status,
    source: stringValue(raw.source, 120, status === 'unsupported' ? 'unavailable' : 'publisher'),
    ...(raw.estimated === true ? { estimated: true } : {}),
    ...(quality ? { quality } : {}),
    ...(optionalNumber(raw.confidence) !== undefined ? { confidence: optionalNumber(raw.confidence) } : {}),
    ...(optionalString(raw.reason ?? raw.message, 240) ? { reason: optionalString(raw.reason ?? raw.message, 240) } : {}),
    ...(optionalString(raw.lockReason ?? raw.lock_reason, 160) ? { lockReason: optionalString(raw.lockReason ?? raw.lock_reason, 160) } : {}),
    ...(publishValue !== undefined ? { value: publishValue } : {}),
  };
}

function sanitizeStaxBlockQuality(value) {
  const raw = asRecord(value);
  const kind = stringValue(raw.kind, 40);
  const label = stringValue(raw.label, 40);
  const reason = stringValue(raw.reason, 240);
  if (!kind && !label && !reason) return undefined;
  return {
    ...(kind ? { kind } : {}),
    ...(label ? { label } : {}),
    ...(reason ? { reason } : {}),
  };
}

function sanitizeStaxBlockStatus(status, raw) {
  const value = stringValue(status, 40).toLowerCase();
  if (['supported', 'partial', 'unsupported', 'locked'].includes(value)) return value;
  if (raw?.supported === false || raw?.available === false) return 'unsupported';
  return 'supported';
}

function summarizeStaxBlocks(blocks) {
  return {
    total: blocks.length,
    supported: blocks.filter((block) => block.status === 'supported').length,
    partial: blocks.filter((block) => block.status === 'partial').length,
    unsupported: blocks.filter((block) => block.status === 'unsupported').length,
  };
}

function sanitizePublishInventoryItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => sanitizePublishInventoryItem(item))
    .filter((item) => isRecord(item) && (item.title || item.name || item.description || item.externalUrl || item.url));
}

function sanitizePublishInventoryItem(item) {
  const sanitized = sanitizePublishJson(item);
  if (!isRecord(sanitized) || !isRecord(item)) return sanitized;
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const actionDefinition = sanitizeActionDefinition(
    metadata.definition ||
      metadata.actionDefinition ||
      metadata.action_definition ||
      metadata.workflowDefinition ||
      metadata.workflow_definition
  );
  if (!isRecord(actionDefinition)) return sanitized;
  return {
    ...sanitized,
    metadata: {
      ...(isRecord(sanitized.metadata) ? sanitized.metadata : {}),
      definition: actionDefinition,
      actionDefinition: actionDefinition,
      action_definition: actionDefinition,
      workflowDefinition: actionDefinition,
      workflow_definition: actionDefinition,
    },
  };
}

function sanitizePublishPayload(payload, options = {}) {
  const profileSnapshot = sanitizeBuilderProfileSnapshotForPublish(payload?.profileSnapshot, options);
  const card = sanitizePublishJson(payload?.card || {});
  const usage = sanitizePublishJson(payload?.usage);
  const sections = isRecord(payload?.sections) ? payload.sections : {};
  return {
    ...(isRecord(card) && Object.keys(card).length > 0 ? { card } : {}),
    ...(isRecord(usage) && Object.keys(usage).length > 0 ? { usage } : {}),
    profileSnapshot,
    sections: {
      usingTools: sanitizePublishInventoryItems(sections.usingTools),
      madeItems: sanitizePublishInventoryItems(sections.madeItems),
      remixedItems: sanitizePublishInventoryItems(sections.remixedItems),
      builtItems: sanitizePublishInventoryItems(sections.builtItems),
    },
  };
}

export function getBuilderProfileSnapshotForDisplay(draft, options = {}) {
  const schemaVersion = builderProfileSnapshotSchema(options);
  if (isRecord(draft?.builderProfileSnapshot) && draft.builderProfileSnapshot.schemaVersion === schemaVersion) {
    return sanitizeBuilderProfileSnapshotForPublish(draft.builderProfileSnapshot, options);
  }
  if (typeof options.buildBuilderProfileSnapshot !== 'function') {
    throw new Error('Missing buildBuilderProfileSnapshot for publish payload.');
  }
  return sanitizeBuilderProfileSnapshotForPublish(options.buildBuilderProfileSnapshot(draft), options);
}

function updateSnapshotInventoryFromItems(snapshot, selectedItems) {
  if (!snapshot) return null;
  const usingItems = selectedItems.filter((item) => item.role === 'using');
  const madeItems = selectedItems.filter((item) => item.role === 'made');
  const remixedItems = selectedItems.filter((item) => item.role === 'remixed');
  return {
    ...snapshot,
    inventory: {
      usingToolCount: usingItems.length,
      madeItemCount: madeItems.length,
      remixedItemCount: remixedItems.length,
      usingToolsPreview: usingItems.slice(0, 12).map(toProfilePreviewItem),
      madeItemsPreview: madeItems.slice(0, 12).map(toProfilePreviewItem),
      remixedItemsPreview: remixedItems.slice(0, 12).map(toProfilePreviewItem),
    },
  };
}

function toProfilePreviewItem(item) {
  return {
    name: publicText(item.name, 160) || 'Untitled',
    type: normalizeStaxDisplayItemType(publicText(item.type, 80) || 'tool'),
    source: publicText(item.sourceLabel || item.source, 120) || 'Unknown',
  };
}

export async function createStaxCreatorPublishPayload(draft, privateInventory, options = {}) {
  if (typeof options.getCardSettings !== 'function') {
    throw new Error('Missing getCardSettings for publish payload.');
  }
  const cardSettings = options.getCardSettings(draft);
  const listingDrafts = isRecord(draft.listingDrafts) ? draft.listingDrafts : {};
  const displayName = publicText(cardSettings.name, 120);
  const rawMadeSourceItems = getDraftSectionItemsByCanonicalId(draft, 'made-items');
  const rawRemixedSourceItems = getDraftSectionItemsByCanonicalId(draft, 'remixed-items');
  const creatorToolIds = new Set(Array.isArray(draft.stats?.creatorToolIds) ? draft.stats.creatorToolIds : []);
  const creatorToolSelectionIsCustom = draft.stats?.creatorToolSelectionMode === 'custom';
  const creatorToolSourceItems = dedupePublicInventorySourceItems([
    ...getDraftSectionItemsByCanonicalId(draft, 'creator-tools'),
    ...rawMadeSourceItems.filter(hasCreatorToolDockSelectionMarker),
    ...rawRemixedSourceItems.filter(hasCreatorToolDockSelectionMarker),
  ]).filter((item) => creatorToolSelectionIsCustom && creatorToolIds.has(item.id));
  const madeSourceItems = dedupePublicInventorySourceItems([
    ...rawMadeSourceItems.filter((item) => !hasCreatorToolDockSelectionMarker(item)),
    ...creatorToolSourceItems.filter((item) => creatorToolPublishRole(item) === 'made'),
  ]);
  const remixedSourceItems = dedupePublicInventorySourceItems([
    ...rawRemixedSourceItems.filter((item) => !hasCreatorToolDockSelectionMarker(item)),
    ...creatorToolSourceItems.filter((item) => creatorToolPublishRole(item) === 'remixed'),
  ]);
  const builtSourceKeys = new Set(
    [...madeSourceItems, ...remixedSourceItems].map(publicInventorySourceKey).filter(Boolean)
  );
  const communitySourceKeys = new Set(
    creatorToolSourceItems.map(publicInventorySourceKey).filter(Boolean)
  );
  const baseUsingSourceItems = getDraftSectionItemsByCanonicalId(draft, 'using-tools');
  const usingSourceItems = dedupePublicInventorySourceItems([
    ...baseUsingSourceItems,
    ...creatorToolSourceItems.filter((item) => creatorToolPublishRole(item) === 'using'),
  ]).filter((item) => !builtSourceKeys.has(publicInventorySourceKey(item)));
  const usingEntries = usingSourceItems
    .map((item) => toPublishDraftEntry(item, 'using', listingDrafts))
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      publishToCommunity: communitySourceKeys.has(publicInventorySourceKey(entry.sourceItem)),
    }));
  const madeEntries = madeSourceItems
    .map((item) => toPublishDraftEntry(item, 'made', listingDrafts))
    .filter(Boolean);
  const remixedEntries = remixedSourceItems
    .map((item) => toPublishDraftEntry(item, 'remixed', listingDrafts))
    .filter(Boolean);
  const selectedItems = [...usingEntries, ...madeEntries, ...remixedEntries].map((entry) => entry.item);
  const usingTools = (await Promise.all(
    usingEntries.map((entry) => createPublicInventoryItem(entry, privateInventory, {
      publishToCommunity: entry.publishToCommunity,
    }))
  )).filter(Boolean);
  const madeItems = (await Promise.all(
    madeEntries.map((entry) => createPublicInventoryItem(entry, privateInventory, {
      publishToCommunity: true,
    }))
  )).filter(Boolean);
  const remixedItems = (await Promise.all(
    remixedEntries.map((entry) => createPublicInventoryItem(entry, privateInventory, {
      publishToCommunity: true,
    }))
  )).filter(Boolean);
  const builtItems = [...madeItems, ...remixedItems];
  const usage = createPublicUsageSummary(draft.stats?.usage);
  const profileSnapshot = updateSnapshotInventoryFromItems(
    getBuilderProfileSnapshotForDisplay(draft, options),
    selectedItems
  );
  const hasAvatarUrl = Object.hasOwn(cardSettings, 'avatarUrl');
  const avatarUrl = publicHttpUrl(cardSettings.avatarUrl);
  const publicProfileSnapshot = hasAvatarUrl
    ? {
        ...profileSnapshot,
        card: {
          ...(isRecord(profileSnapshot?.card) ? profileSnapshot.card : {}),
          avatarUrl: avatarUrl || null,
        },
      }
    : profileSnapshot;
  const card = {
    ...(displayName ? { displayName } : {}),
    ...(hasAvatarUrl ? { avatarUrl: avatarUrl || null } : {}),
    qrTarget: cardSettings.qrTarget === 'profile' ? 'profile' : 'stax',
    showPersonaCode: cardSettings.showPersonaCode,
    showUsage: cardSettings.showUsage,
    showCreatorPageLink: cardSettings.showCreatorPageLink,
    visibility: publicText(cardSettings.visibility, 40) || 'public',
  };
  return sanitizePublishPayload({
    card,
    ...(usage ? { usage } : {}),
    ...(publicProfileSnapshot ? { profileSnapshot: publicProfileSnapshot } : {}),
    sections: {
      usingTools,
      madeItems,
      remixedItems,
      builtItems,
    },
  }, options);
}

export function mergeStaxCreatorPublishPayloadWithExistingCard(payload, existingCardPayload, options = {}) {
  const existingSections = getExistingCardSections(existingCardPayload);
  if (existingSections.length === 0) return payload;

  const existingPayloadSections = createEmptyPublishSections();
  for (const section of existingSections) {
    const sectionRecord = asRecord(section);
    for (const item of asArray(sectionRecord.items)) {
      const importItem = toPublishItemFromExistingSectionItem(sectionRecord, item);
      if (importItem) addItemToPublishSections(existingPayloadSections, importItem);
    }
  }

  const sections = {
    usingTools: mergePublishInventoryItems(
      existingPayloadSections.usingTools,
      asArray(payload?.sections?.usingTools)
    ),
    madeItems: mergePublishInventoryItems(
      existingPayloadSections.madeItems,
      asArray(payload?.sections?.madeItems)
    ),
    remixedItems: mergePublishInventoryItems(
      existingPayloadSections.remixedItems,
      asArray(payload?.sections?.remixedItems)
    ),
    builtItems: [],
  };
  const builtItemKeys = new Set(
    [...sections.madeItems, ...sections.remixedItems]
      .flatMap(getPublishInventoryItemKeys)
      .filter(Boolean)
  );
  sections.usingTools = sections.usingTools.filter((item) => {
    const keys = getPublishInventoryItemKeys(item);
    return keys.length === 0 || keys.every((key) => !builtItemKeys.has(key));
  });
  sections.builtItems = [...sections.madeItems, ...sections.remixedItems];

  return sanitizePublishPayload({
    ...payload,
    profileSnapshot: updateSnapshotInventoryFromPublishedSections(payload.profileSnapshot, sections),
    sections,
  }, options);
}

function toPublishDraftEntry(sourceItem, role, listingDrafts = {}) {
  const item = toPublishDraftItem(applyListingDraftOverlay(sourceItem, listingDrafts[sourceItem?.id]), role);
  if (!item?.selected) return null;
  return { sourceItem, item };
}

function normalizeMarketplaceCategory(value) {
  const raw = publicText(value, 80);
  const key = raw.toLowerCase().replace(/&/g, 'and').replace(/[_\s]+/g, '-').replace(/-+/g, '-');
  if (!key) return '';
  const aliases = {
    development: 'development',
    design: 'design',
    'writing-content': 'writing-content',
    'data-analytics': 'data-analytics',
    finance: 'finance',
    'marketing-growth': 'marketing-growth',
    research: 'research',
    productivity: 'productivity',
    'automation-workflows': 'automation-workflows',
    'business-ops': 'business-ops',
    education: 'education',
    'media-audio': 'media-audio',
    'personal-life': 'personal-life',
    'fun-experimental': 'fun-experimental',
    work: 'productivity',
    办公效率: 'productivity',
    office: 'productivity',
    business: 'business-ops',
    automation: 'automation-workflows',
    communication: 'productivity',
    workflow: 'automation-workflows',
    create: 'design',
    内容创作: 'writing-content',
    creation: 'design',
    content: 'writing-content',
    'content-creation': 'writing-content',
    creator: 'writing-content',
    creative: 'design',
    writing: 'writing-content',
    开发: 'development',
    dev: 'development',
    developer: 'development',
    coding: 'development',
    code: 'development',
    programming: 'development',
    mcp: 'development',
    plugin: 'development',
    'data-research': 'research',
    学术研究: 'research',
    'data-and-research': 'research',
    data: 'data-analytics',
    academic: 'research',
    'academic-research': 'research',
    study: 'research',
    理财投资: 'finance',
    financial: 'finance',
    investment: 'finance',
    investing: 'finance',
    life: 'personal-life',
    生活服务: 'personal-life',
    lifestyle: 'personal-life',
    service: 'personal-life',
    services: 'personal-life',
    'fun-games': 'fun-experimental',
    休闲娱乐: 'fun-experimental',
    'fun-and-games': 'fun-experimental',
    fun: 'fun-experimental',
    game: 'fun-experimental',
    games: 'fun-experimental',
    entertainment: 'fun-experimental',
  };
  return aliases[key] || '';
}

function applyListingDraftOverlay(sourceItem, listingDraft) {
  if (!isRecord(sourceItem) || !isRecord(listingDraft)) return sourceItem;
  const listing = isRecord(listingDraft.listing) ? listingDraft.listing : {};
  const title = publicText(listing.title, 160);
  const shortDescription = publicText(listing.shortDescription, MAX_PUBLIC_DESCRIPTION_CHARS);
  const description = publicText(listing.description, MAX_PUBLIC_DESCRIPTION_CHARS);
  const category = normalizeMarketplaceCategory(listing.category);
  const additionalCategories = stringArray(listing.additionalCategories, 3, 80)
    .map(normalizeMarketplaceCategory)
    .filter((value) => value && value !== category);
  const categories = [...new Set([category, ...additionalCategories].filter(Boolean))];
  const listingType = publicText(listing.type, 80);
  const sourceType = normalizeStaxDisplayItemType(sourceItem.type || sourceItem.kind, '');
  const type = sourceType && sourceType !== 'tool'
    ? sourceType
    : normalizeStaxDisplayItemType(listingType, '') || listingType;
  const tags = stringArray(listing.tags, 12, 40);
  const examples = stringArray(listing.examples, 8, 220);
  const coverImageUrl = publicHttpUrl(listing.coverImageUrl || listing.cover_image_url);
  const iconUrl = publicHttpUrl(
    listing.iconUrl || listing.icon_url || listing.customIconUrl || listing.custom_icon_url || coverImageUrl
  );
  if (!title && !shortDescription && !description && !categories.length && !type && !tags.length && !examples.length && !coverImageUrl && !iconUrl) {
    return sourceItem;
  }
  const metadata = sanitizePublishJson({
    ...(isRecord(sourceItem.metadata) ? sourceItem.metadata : {}),
    technicalName: sourceItem.name || sourceItem.title,
    listingDraft: {
      sourceItemId: listingDraft.sourceItemId || sourceItem.id,
      status: listingDraft.status,
      visibility: listing.visibility,
      ...(category ? { category } : {}),
      ...(categories.length ? { categories, additionalCategories } : {}),
      ...(listingType ? { type: listingType } : {}),
      ...(tags.length ? { tags } : {}),
      ...(examples.length ? { examples } : {}),
      ...(coverImageUrl ? { coverImageUrl } : {}),
      ...(iconUrl ? { iconUrl, icon_url: iconUrl, customIconUrl: iconUrl, custom_icon_url: iconUrl } : {}),
    },
  });
  return {
    ...sourceItem,
    ...(title ? { name: title, title, customTitle: title } : {}),
    ...(shortDescription || description ? {
      description: shortDescription || description,
      shortDescription: shortDescription || description,
      customDescription: shortDescription || description,
    } : {}),
    ...(category ? { category } : {}),
    ...(categories.length ? { categories } : {}),
    ...(type ? { type } : {}),
    ...(tags.length ? { tags } : {}),
    ...(examples.length ? { examples } : {}),
    ...(coverImageUrl ? { coverImageUrl } : {}),
    ...(iconUrl ? { iconUrl, icon_url: iconUrl, customIconUrl: iconUrl, custom_icon_url: iconUrl } : {}),
    ...(isRecord(metadata) && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function createEmptyPublishSections() {
  return {
    usingTools: [],
    madeItems: [],
    remixedItems: [],
    builtItems: [],
  };
}

function getExistingCardSections(existingCardPayload) {
  const root = asRecord(existingCardPayload);
  const data = asRecord(root.data);
  const candidates = [
    root.sections,
    asRecord(root.card).sections,
    data.sections,
    asRecord(data.card).sections,
  ];
  for (const candidate of candidates) {
    const sections = asArray(candidate);
    if (sections.length > 0) return sections;
  }
  return [];
}

function toPublishItemFromExistingSectionItem(section, value) {
  const item = asRecord(value);
  if (item.visible === false) return null;
  const existingRelation = getExistingSectionItemRelation(section, item);
  if (!existingRelation) return null;
  const relation = 'using';
  const metadata = asRecord(item.metadata);
  const sourceType = publicText(item.sourceType || item.source_type || metadata.sourceType || metadata.source_type, 80);
  const description = publicText(
    item.customDescription || item.custom_description || item.description || metadata.description,
    MAX_PUBLIC_DESCRIPTION_CHARS
  );
  const url = publicHttpUrl(item.externalUrl || item.external_url || item.url);
  const name = publicText(
    item.customTitle ||
      item.custom_title ||
      item.name ||
      item.title ||
      item.externalUrl ||
      item.external_url ||
      item.id,
    160
  );
  if (!name) return null;
  const type = inferExistingPublicItemType({
    type: sourceType || item.type || metadata.type,
    name,
    description,
    url,
  });
  const staxItemId = publicText(item.staxItemId || item.stax_item_id, 160);
  const sectionItemId = publicText(item.id, 160);
  const itemMetadata = sanitizePublishJson({
    ...(staxItemId ? { staxItemId } : {}),
    ...(sectionItemId ? { sectionItemId } : {}),
    ...(sourceType ? { sourceType } : {}),
    preservedFromExistingCard: true,
  });

  return {
    name,
    ...(description ? { description } : {}),
    type,
    ...(url ? { url } : {}),
    visible: true,
    relation,
    ownership: 'others',
    authorshipKind: 'third_party',
    source_type: type,
    ...(isRecord(itemMetadata) && Object.keys(itemMetadata).length > 0 ? { metadata: itemMetadata } : {}),
  };
}

function getExistingSectionItemRelation(section, item) {
  const explicitRelation = normalizeExistingInventoryRelation(item.relation);
  if (explicitRelation) return explicitRelation;
  const metadataRelation = normalizeExistingInventoryRelation(asRecord(item.metadata).relation);
  if (metadataRelation) return metadataRelation;
  const sectionKey = normalizedSectionKey(section.id || section.type);
  if (sectionKey === 'remixeditems') return 'remixed';
  if (sectionKey === 'madeitems' || sectionKey === 'ownedcreations') return 'made';
  if (sectionKey === 'mycreations' || sectionKey === 'creations' || sectionKey === 'builtitems') {
    return 'made';
  }
  if (
    sectionKey === 'installedtools' ||
    sectionKey === 'mytools' ||
    sectionKey === 'externalreferences' ||
    sectionKey === 'derived' ||
    sectionKey === 'toolsiuse' ||
    sectionKey === 'usingtools' ||
    sectionKey === 'usedtools' ||
    sectionKey === 'usedcandidates'
  ) {
    return 'using';
  }
  return null;
}

function normalizeExistingInventoryRelation(input) {
  const value = normalizedSectionKey(input);
  if (value === 'using' || value === 'use' || value === 'thirdparty') return 'using';
  if (value === 'made' || value === 'built' || value === 'original') return 'made';
  if (value === 'remixed' || value === 'derived') return 'remixed';
  return null;
}

function inferExistingPublicItemType(input) {
  const explicitType = normalizedSectionKey(input.type);
  if (explicitType && explicitType !== 'githubrepo' && explicitType !== 'reference') {
    return normalizeStaxDisplayItemType(input.type);
  }
  const text = `${input.name} ${input.description || ''} ${input.url || ''}`.toLowerCase();
  if (/\bskill(?:s)?\b|skill\.md|claude\s+code\s+skill|codex\s+skill/.test(text)) return 'skill';
  if (/\b(action|workflow|slash[-\s]?command|command)\b/.test(text)) return 'action';
  if (/\b(nextjs|next\.js|electron|streamlit|web app|dashboard|application)\b/.test(text)) return 'app';
  if (/\bbundle\b|\bstack\b/.test(text)) return 'bundle';
  return normalizeStaxDisplayItemType(input.type);
}

function addItemToPublishSections(sections, item) {
  if (item.relation === 'made') sections.madeItems.push(item);
  else if (item.relation === 'remixed') sections.remixedItems.push(item);
  else sections.usingTools.push(item);
}

function mergePublishInventoryItems(existingItems, currentItems) {
  const items = [];
  const indexesByKey = new Map();
  for (const item of [...existingItems, ...currentItems]) {
    if (!isRecord(item) || item.visible === false) continue;
    const keys = getPublishInventoryItemKeys(item);
    const existingIndex = keys
      .map((key) => indexesByKey.get(key))
      .find((index) => typeof index === 'number');
    if (existingIndex !== undefined) {
      items[existingIndex] = item;
      for (const key of keys) indexesByKey.set(key, existingIndex);
      continue;
    }
    for (const key of keys) indexesByKey.set(key, items.length);
    items.push(item);
  }
  return items;
}

function getPublishInventoryItemKeys(item) {
  const keys = [];
  const url = normalizePublicUrlKey(item.url);
  if (url) keys.push(`url:${url}`);
  const metadata = asRecord(item.metadata);
  const staxItemId = publicText(metadata.staxItemId || metadata.stax_item_id, 160);
  if (staxItemId) keys.push(`stax:${staxItemId}`);
  const nameKey = slugKey(item.name);
  if (nameKey) keys.push(`name:${normalizeStaxDisplayItemType(item.type)}:${nameKey}`);
  return keys;
}

function updateSnapshotInventoryFromPublishedSections(snapshot, sections) {
  if (!snapshot) return null;
  return {
    ...snapshot,
    inventory: {
      usingToolCount: sections.usingTools.length,
      madeItemCount: sections.madeItems.length,
      remixedItemCount: sections.remixedItems.length,
      usingToolsPreview: sections.usingTools.slice(0, 12).map(toPublishedProfilePreviewItem),
      madeItemsPreview: sections.madeItems.slice(0, 12).map(toPublishedProfilePreviewItem),
      remixedItemsPreview: sections.remixedItems.slice(0, 12).map(toPublishedProfilePreviewItem),
    },
  };
}

function toPublishedProfilePreviewItem(item) {
  const metadata = asRecord(item.metadata);
  return {
    name: publicText(item.name, 160) || 'Untitled',
    type: normalizeStaxDisplayItemType(publicText(item.type, 80) || 'tool'),
    source: publicText(metadata.sourceLabel || metadata.source || 'Taku', 120) || 'Taku',
  };
}

function normalizePublicUrlKey(input) {
  const text = cleanText(input, 2048);
  if (!text) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return text.replace(/\/+$/, '').toLowerCase();
  }
}

function normalizedSectionKey(input) {
  return String(input || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function slugKey(input) {
  return String(input || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
