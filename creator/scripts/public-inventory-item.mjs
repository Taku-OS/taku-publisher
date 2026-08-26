import {
  publicHttpUrl,
  publicText,
} from './privacy.mjs';
export { STAX_CREATOR_PUBLISH_CONTRACT_VERSION } from './publish-config.mjs';

const ACTION_ALIASES = new Set([
  'action',
  'actions',
  'workflow',
  'workflows',
  'slash-command',
  'slash_command',
  'command',
  'commands',
  'agent-workflow',
  'agent_workflow',
]);

const TOOL_ALIASES = new Set([
  'tool',
  'tools',
  'plugin',
  'plugins',
  'mcp',
  'mcp-server',
  'mcp_server',
  'rule',
  'rules',
  'asset',
  'assets',
  'asset-library',
  'asset_library',
  'template',
  'templates',
  'template-library',
  'template_library',
]);

const PLUGIN_WRAPPER_ALIASES = new Set([
  'plugin',
  'plugins',
  'plugin-wrapper',
  'plugin-wrappers',
  'codex-plugin',
  'claude-plugin',
  'cursor-plugin',
  'taku-plugin',
]);

export function isPluginWrapperDisplayType(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return PLUGIN_WRAPPER_ALIASES.has(normalized);
}

export function normalizeStaxDisplayItemType(value, fallback = 'tool') {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'skill' || normalized === 'skills') return 'skill';
  if (normalized === 'agent' || normalized === 'agents' || normalized === 'subagent' || normalized === 'subagents') {
    return 'agent';
  }
  if (normalized === 'app' || normalized === 'apps' || normalized === 'application') return 'app';
  if (
    normalized === 'bundle' ||
    normalized === 'bundles' ||
    normalized === 'stack' ||
    normalized === 'stacks'
  ) {
    return 'bundle';
  }
  if (ACTION_ALIASES.has(normalized)) return 'action';
  if (TOOL_ALIASES.has(normalized)) return 'tool';
  return fallback;
}

export function toPublicInventoryImportItem(item, role = item?.role, options = {}) {
  const publicRole = normalizePublicInventoryRole(role);
  const rawType = publicText(item?.type, 80) || 'tool';
  const type = normalizeStaxDisplayItemType(rawType);
  const id = publicText(item?.id || item?.sourceItemId || item?.source_item_id, 240);
  const description = publicText(item?.description, 800);
  const category = publicText(item?.category, 80);
  const categories = [...new Set([
    category,
    ...publicTextList(item?.categories, 4, 80),
  ].filter(Boolean))];
  const tags = publicTextList(item?.tags, 12, 40);
  const examples = publicTextList(item?.examples, 8, 220);
  const coverImageUrl = publicHttpUrl(item?.coverImageUrl || item?.cover_image_url);
  const iconUrl = publicHttpUrl(
    item?.iconUrl || item?.icon_url || item?.customIconUrl || item?.custom_icon_url || coverImageUrl
  );
  const url = publicHttpUrl(item?.externalUrl || item?.url || item?.sourceUrl || item?.githubUrl);
  const githubUrl = publicHttpUrl(item?.githubUrl || item?.url || item?.externalUrl || item?.sourceUrl);
  const itemMetadata = isPlainRecord(item?.metadata) ? item.metadata : {};
  const listingDraft = isPlainRecord(itemMetadata.listingDraft) ? itemMetadata.listingDraft : {};
  const pluginWrapper = [
    rawType,
    item?.kind,
    item?.source_type,
    itemMetadata.sourceType,
    itemMetadata.source_type,
    itemMetadata.displayKind,
    itemMetadata.display_kind,
    listingDraft.type,
  ].some(isPluginWrapperDisplayType);
  const sourceType = pluginWrapper ? 'plugin' : type;
  const sourceKindFallback = pluginWrapper ? 'plugin' : undefined;
  const metadata = {
    ...itemMetadata,
    ...(pluginWrapper
      ? {
          sourceType,
          source_type: sourceType,
          displayKind: 'plugin-wrapper',
          display_kind: 'plugin-wrapper',
          referenceKind: 'plugin',
          reference_kind: 'plugin',
          sourceKind: itemMetadata.sourceKind || itemMetadata.source_kind || sourceKindFallback,
          source_kind: itemMetadata.source_kind || itemMetadata.sourceKind || sourceKindFallback,
        }
      : {}),
    ...(type === 'app'
      ? {
          displayOnly: true,
          display_only: true,
          runnable: false,
          installPolicy: 'unsupported',
          install_policy: 'unsupported',
          referenceKind: 'app',
          reference_kind: 'app',
        }
      : {}),
  };
  const installability = publicText(item?.installability || metadata.installability, 80);
  const sourceKind = publicText(item?.sourceKind || metadata.sourceKind || item?.source_kind || metadata.source_kind, 120);
  const sourceKindSnake = publicText(item?.source_kind || metadata.source_kind || sourceKind, 120);
  const installPolicy = publicText(item?.installPolicy || item?.install_policy || metadata.installPolicy || metadata.install_policy, 120);
  const takuInstallOffer = isPlainRecord(item?.taku_install_offer)
    ? item.taku_install_offer
    : isPlainRecord(metadata.taku_install_offer)
      ? metadata.taku_install_offer
      : null;
  const githubReference = isPlainRecord(item?.github_reference)
    ? item.github_reference
    : isPlainRecord(metadata.github_reference)
      ? metadata.github_reference
      : null;
  const sourceAttribution = isPlainRecord(item?.source_attribution)
    ? item.source_attribution
    : isPlainRecord(metadata.source_attribution)
      ? metadata.source_attribution
      : null;

  return {
    ...(id ? { id } : {}),
    name: publicText(item?.name, 160) || 'Untitled',
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
    ...(categories.length ? { categories } : {}),
    ...(tags.length ? { tags } : {}),
    ...(examples.length ? { examples } : {}),
    ...(coverImageUrl ? { coverImageUrl } : {}),
    ...(iconUrl ? { iconUrl, icon_url: iconUrl, customIconUrl: iconUrl, custom_icon_url: iconUrl } : {}),
    type,
    ...(url ? { url } : {}),
    ...(url ? { externalUrl: url } : {}),
    ...(githubUrl ? { githubUrl } : {}),
    visible: Boolean(item?.selected),
    relation: publicRole,
    ownership: publicRole === 'using' ? 'others' : 'mine',
    authorshipKind: publicInventoryAuthorshipKind(publicRole),
    ...(options.publishToCommunity === true
      ? { marketplacePublicationIntent: 'publish' }
      : {}),
    source_type: sourceType,
    ...(installability ? { installability } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(sourceKindSnake ? { source_kind: sourceKindSnake } : {}),
    ...(installPolicy ? { installPolicy, install_policy: installPolicy } : {}),
    ...(takuInstallOffer ? { taku_install_offer: takuInstallOffer } : {}),
    ...(githubReference ? { github_reference: githubReference } : {}),
    ...(sourceAttribution ? { source_attribution: sourceAttribution } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function publicTextList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => publicText(entry, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePublicInventoryRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'made' || normalized === 'built' || normalized === 'original') return 'made';
  if (normalized === 'remixed' || normalized === 'remix' || normalized === 'derived') return 'remixed';
  return 'using';
}

function publicInventoryAuthorshipKind(role) {
  if (role === 'made') return 'original';
  if (role === 'remixed') return 'derived';
  return 'third_party';
}
