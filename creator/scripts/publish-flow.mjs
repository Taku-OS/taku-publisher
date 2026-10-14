import {
  createTakuStaxClient,
  createWorkerPublishError,
} from './publish-client.mjs';
import { fetchTakuCreatorProfile } from './creator-profile.mjs';
import { personaCodeForAvatar } from './persona-avatar-upload.mjs';
import {
  createStaxCreatorPublishPayload,
  getBuilderProfileSnapshotForDisplay as getBuilderProfileSnapshotForDisplayCore,
  mergeStaxCreatorPublishPayloadWithExistingCard,
} from './publish-payload.mjs';
import { buildStaxPublishedLinks, buildStaxStudioUrl, resolveStaxStudioUrl } from './stax-url.mjs';
import { createStaxStudioRendererPayload, fillStaxStudioLayout } from './editor-renderer.mjs';

const PUBLISH_IMPORT_TIMEOUT_MS = 60000;

export function getBuilderProfileSnapshotForDisplay(draft, context = {}) {
  return getBuilderProfileSnapshotForDisplayCore(draft, {
    builderProfileSnapshotSchema: context.builderProfileSnapshotSchema,
    buildBuilderProfileSnapshot: context.buildBuilderProfileSnapshot,
  });
}

export async function createPublishPayloadFromDraft(draft, privateInventory, context = {}) {
  return createStaxCreatorPublishPayload(draft, privateInventory, {
    builderProfileSnapshotSchema: context.builderProfileSnapshotSchema,
    buildBuilderProfileSnapshot: context.buildBuilderProfileSnapshot,
    getCardSettings: context.getCardSettings,
  });
}

function mergeDraftWithTakuProfile(draft, profileResult = {}) {
  const profile = profileResult.profile && typeof profileResult.profile === 'object'
    ? profileResult.profile
    : {};
  const staxProfile = profileResult.staxProfile && typeof profileResult.staxProfile === 'object'
    ? profileResult.staxProfile
    : {};
  const hasDisplayName = Object.hasOwn(profile, 'displayName') && Boolean(profile.displayName);
  const hasAvatarUrl = Object.hasOwn(profile, 'avatarUrl');
  return {
    ...draft,
    creator: {
      ...(draft?.creator || {}),
      ...(hasDisplayName ? { name: profile.displayName } : {}),
      ...(hasAvatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    },
    card: {
      ...(draft?.card || {}),
      ...(hasAvatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    },
    ...(Object.keys(staxProfile).length
      ? { staxProfile: { ...(draft?.staxProfile || {}), ...staxProfile } }
      : {}),
    stats: {
      ...(draft?.stats || {}),
      creatorProfileSynced: Object.keys(staxProfile).length > 0,
    },
  };
}

export async function saveDraftToTakuStudio({
  draft,
  privateInventory,
  workerUrl,
  token,
  siteUrl,
  canReadCreatorProfile = true,
  context = {},
}) {
  // Try the profile endpoint for every token. Narrow grants may reject the
  // read, but token prefixes are not an authorization contract; the Worker
  // still binds the saved draft to the canonical account identity.
  const profile = canReadCreatorProfile
    ? await fetchTakuCreatorProfile({ workerUrl, token, siteUrl }).catch(error => {
        if (error?.legalAction) return error.legalAction;
        return null;
      })
    : null;
  if (profile?.requires_action) return profile;
  if (process.env.TAKU_STAX_REQUIRE_ACCOUNT_PROFILE === '1'
      && (!profile?.ok || !profile.staxProfile || !Object.keys(profile.staxProfile).length)) {
    const status = Number(profile?.status) || 503;
    return { ok: false, status, needsAuth: status === 401 || status === 403,
      action_type: 'retry_account_profile_sync',
      error: 'Your Taku account profile could not be loaded. Retry to generate a Card with your account information.',
      data: {} };
  }
  const cloudDraft = profile?.ok ? mergeDraftWithTakuProfile(draft, profile) : draft;
  const publishContext = profile?.ok
    ? withTakuCreatorProfileIdentity(context, profile.profile)
    : context;
  const payload = await createPublishPayloadFromDraft(
    cloudDraft,
    privateInventory,
    publishContext,
  );
  const client = createTakuStaxClient({ workerUrl, token, siteUrl });
  const studioPayload = createStudioDraftPayload(payload);
  studioPayload.studioRenderer = createStaxStudioRendererPayload(cloudDraft, {
    editor: {
      publish: {
        siteUrl,
        workerUrl,
      },
    },
  });

  try {
    const data = await saveStudioDraftWithRevision(client, studioPayload, {
      issueLaunchContext: true,
      fillLayout: true,
    });
    const responseData = data?.data && typeof data.data === 'object' && !Array.isArray(data.data)
      ? data.data
      : {};
    const launchContext = responseData.launchContext && typeof responseData.launchContext === 'object'
      ? responseData.launchContext
      : responseData.launch_context && typeof responseData.launch_context === 'object'
        ? responseData.launch_context
        : {};
    const account = responseData.account && typeof responseData.account === 'object'
      ? responseData.account
      : {};
    const launchContextId = String(launchContext.id || launchContext.contextId || launchContext.context_id || '').trim();
    const accountHint = String(account.hint || account.accountHint || account.account_hint || '').trim();
    const workerStudioUrl = String(responseData.studioUrl || responseData.studio_url || '').trim();
    return {
      ok: true,
      status: 200,
      workerUrl,
      endpoint: `${workerUrl}/stax/studio/cards/me`,
      data,
      studioUrl: resolveStaxStudioUrl(siteUrl, workerStudioUrl, { launchContextId }),
      ...(launchContextId ? { launchContextId } : {}),
      ...(accountHint ? { accountHint } : {}),
      draft: cloudDraft,
    };
  } catch (error) {
    const status = Number(error?.status) || 0;
    return {
      ok: false,
      status,
      needsAuth: status === 401 || status === 403,
      workerUrl,
      endpoint: `${workerUrl}/stax/studio/cards/me`,
      error: `The private Studio draft could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      data: {},
      ...(error?.legalAction || {}),
    };
  }
}

function withTakuCreatorProfileIdentity(context = {}, creatorProfile = {}) {
  const hasDisplayName = Object.hasOwn(creatorProfile, 'displayName')
    && Boolean(creatorProfile.displayName);
  const hasAvatarUrl = Object.hasOwn(creatorProfile, 'avatarUrl');
  if (!hasDisplayName && !hasAvatarUrl) return context;
  const originalGetCardSettings = context.getCardSettings;
  if (typeof originalGetCardSettings !== 'function') return context;
  return {
    ...context,
    getCardSettings(draft) {
      const settings = originalGetCardSettings(draft) || {};
      return {
        ...settings,
        ...(hasDisplayName ? { name: creatorProfile.displayName } : {}),
        ...(hasAvatarUrl ? { avatarUrl: creatorProfile.avatarUrl } : {}),
      };
    },
  };
}

export async function publishDraftToTaku({
  draft,
  privateInventory,
  workerUrl,
  token,
  avatarUploadToken,
  siteUrl,
  context = {},
}) {
  const profile = await fetchTakuCreatorProfile({ workerUrl, token, siteUrl });
  if (!profile.ok) {
    return {
      ok: false,
      status: profile.status,
      workerUrl,
      endpoint: profile.endpoint,
      error: profile.error,
      data: profile.data,
    };
  }

  const endpoint = `${workerUrl}/stax/cards/import-inventory`;
  const personaAvatarCode = personaCodeForAvatar(draft);
  // Persona artwork belongs to the Card presentation. It must never silently
  // replace the public account/Creator avatar during an ordinary publish.
  const publishContext = withTakuCreatorProfileIdentity(context, profile.profile);
  const payload = await createPublishPayloadFromDraft(
    draft,
    privateInventory,
    publishContext
  );
  const client = createTakuStaxClient({ workerUrl, token, siteUrl });
  const existingCardPayload = await client.getMyCard().catch(error => {
    if (error?.legalAction) throw error;
    return null;
  });
  const replaceInventory = draft?.stats?.creatorToolSelectionMode === 'custom';
  const publishPayload = replaceInventory
    ? payload
    : mergeStaxCreatorPublishPayloadWithExistingCard(
        payload,
        existingCardPayload,
        {
          builderProfileSnapshotSchema: context.builderProfileSnapshotSchema,
        }
      );
  const studioPayload = createStudioDraftPayload(publishPayload);
  studioPayload.studioRenderer = createStaxStudioRendererPayload(draft, {
    editor: {
      publish: {
        siteUrl,
        workerUrl,
      },
    },
  });
  try {
    await saveStudioDraftWithRevision(client, studioPayload);
  } catch (error) {
    return {
      ok: false,
      status: Number(error?.status) || 0,
      workerUrl,
      endpoint: `${workerUrl}/stax/studio/cards/me`,
      error: `The private Studio draft could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      data: {},
      ...(error?.legalAction || {}),
      links: {},
    };
  }
  const body = JSON.stringify(publishPayload);
  let response;
  let data;
  let parsedJson;
  try {
    ({ response, data, parsedJson } = await client.fetchJson('/stax/cards/import-inventory', {
      method: 'POST',
      body,
    }, { timeoutMs: PUBLISH_IMPORT_TIMEOUT_MS }));
  } catch (error) {
    return {
      ok: false,
      status: Number(error?.status) || 0,
      ...(error?.legalAction || {}),
      workerUrl,
      endpoint,
      error: `Publish request failed before Worker returned a response: ${error instanceof Error ? error.message : String(error)}`,
      data: { requestBytes: Buffer.byteLength(body) },
      links: {},
      publishedInventory: {
        usingToolCount: publishPayload.sections.usingTools.length,
        madeItemCount: publishPayload.sections.madeItems.length,
        remixedItemCount: publishPayload.sections.remixedItems.length,
        builtItemCount: publishPayload.sections.builtItems.length,
        profileSnapshotIncluded: Boolean(publishPayload.profileSnapshot),
        personaAvatarApplied: false,
        personaAvatarCode,
        personaAvatarSkippedReason: 'public_identity_preserved',
      },
    };
  }
  const ok = response.ok && parsedJson;
  const error = ok ? undefined : createWorkerPublishError({ response, data, parsedJson, endpoint });
  const links = ok ? buildStaxPublishedLinks(siteUrl, data?.data || data) : {};
  const studioUrl = links.studioUrl || buildStaxStudioUrl(siteUrl);
  const studioDraftSync = typeof data?.data?.studioDraftSync === 'string'
    ? data.data.studioDraftSync
    : undefined;
  return {
    ok,
    status: response.status,
    workerUrl,
    endpoint,
    error,
    data,
    links,
    profilePageUrl: links.profilePageUrl,
    creatorPageUrl: links.creatorPageUrl,
    staxCardPageUrl: links.staxCardPageUrl,
    staxCardShareUrl: links.staxCardShareUrl,
    staxCardImageUrl: links.staxCardImageUrl,
    studioUrl,
    studioDraftSync,
    warning: studioDraftSync === 'conflict'
      ? 'The public card was published, but the Studio draft changed in another session and was not overwritten.'
      : undefined,
    publishedInventory: {
      usingToolCount: publishPayload.sections.usingTools.length,
      madeItemCount: publishPayload.sections.madeItems.length,
      remixedItemCount: publishPayload.sections.remixedItems.length,
      builtItemCount: publishPayload.sections.builtItems.length,
      profileSnapshotIncluded: Boolean(publishPayload.profileSnapshot),
      personaAvatarApplied: false,
      personaAvatarCode,
      personaAvatarSkippedReason: 'public_identity_preserved',
      workerSections: Array.isArray(data?.data?.sections) ? data.data.sections : undefined,
      installableItemCount: typeof data?.data?.installableItemCount === 'number' ? data.data.installableItemCount : undefined,
      studioDraftSync,
    },
  };
}

async function saveStudioDraftWithRevision(
  client,
  content,
  { issueLaunchContext = false, fillLayout = false } = {},
) {
  let current;
  try {
    current = await client.getMyStudioDraft();
  } catch (error) {
    if (![404, 405].includes(Number(error?.status))) throw error;
    return await client.saveMyStudioDraft(content);
  }
  const currentDraft = current?.data?.draft;
  const mergedContent = mergeRegeneratedStudioDraftContent(content, currentDraft, { fillLayout });
  const supportsRevisionContract = current?.data?.saveContract === 'revision-v1';
  if (!supportsRevisionContract) {
    return await client.saveMyStudioDraft(mergedContent);
  }
  const revision = Number(current?.data?.draft?.revision);
  const expectedRevision = Number.isInteger(revision) && revision > 0
    ? revision
    : null;
  return await client.saveMyStudioDraft({
    content: mergedContent,
    expectedRevision,
    issueLaunchContext,
  });
}

export function mergeRegeneratedStudioDraftContent(incoming, currentDraft, { fillLayout = false } = {}) {
  const next = recordValue(incoming);
  const current = recordValue(recordValue(currentDraft).content);
  if (!Object.keys(current).length) return incoming;

  const currentCard = recordValue(current.card);
  const nextCard = recordValue(next.card);
  const preservedCardSettings = ['primaryAi', 'qrTarget', 'githubUrl', 'twitterUrl', 'websiteUrl']
    .reduce((settings, key) => {
      if (currentCard[key] !== undefined && currentCard[key] !== null && currentCard[key] !== '') {
        settings[key] = currentCard[key];
      }
      return settings;
    }, {});
  const currentLayout = validStudioLayout(current.studioLayout)
    || validStudioLayout(current.studioRenderer?.model?.studioLayout);
  const nextRenderer = recordValue(next.studioRenderer);
  const currentRenderer = recordValue(current.studioRenderer);
  const nextModel = recordValue(nextRenderer.model);
  const currentModel = recordValue(currentRenderer.model);
  const layoutKeys = currentLayout
    ? currentLayout.blocks.map((block) => String(block?.key || '').trim().toLowerCase()).filter(Boolean)
    : [];

  let mergedModel = Object.keys(nextModel).length
    ? mergeRegeneratedStudioModel(nextModel, currentModel, layoutKeys, currentDraft)
    : nextModel;
  const layout = fillLayout && Object.keys(mergedModel).length && currentLayout
    ? fillStaxStudioLayout({ ...mergedModel, selectedKeys: nextModel.selectedKeys }, currentLayout)
    : currentLayout;
  if (layout) {
    mergedModel = {
      ...mergedModel,
      selectedKeys: layout.blocks.map((block) => block.key),
      studioLayout: layout,
    };
  }

  return {
    ...next,
    card: {
      ...nextCard,
      ...preservedCardSettings,
    },
    ...(layout ? { studioLayout: layout } : {}),
    ...(Object.keys(nextRenderer).length
      ? {
          studioRenderer: {
            ...nextRenderer,
            model: mergedModel,
          },
        }
      : {}),
  };
}

function mergeRegeneratedStudioModel(nextModel, currentModel, layoutKeys, currentDraft) {
  if (!Object.keys(currentModel).length) {
    return layoutKeys.length ? { ...nextModel, selectedKeys: layoutKeys } : nextModel;
  }
  const currentCard = recordValue(recordValue(currentDraft).content).card;
  const preservedPrimaryAi = currentCard?.primaryAi;
  const preservedQrTarget = currentCard?.qrTarget;
  const preservedSocial = currentCard?.githubUrl || currentCard?.twitterUrl;
  const currentBlocks = blockMap(currentModel.blocks);
  const nextBlocks = Array.isArray(nextModel.blocks)
    ? nextModel.blocks.map((block) => {
        const nextBlock = recordValue(block);
        const key = String(nextBlock.key || '').trim().toLowerCase();
        const currentBlock = currentBlocks.get(key);
        if (
          currentBlock
          && ((key === 'team' && preservedPrimaryAi)
            || (key === 'qr' && preservedQrTarget)
            || (key === 'social' && preservedSocial))
        ) {
          return currentBlock;
        }
        return currentBlock && !studioBlockAvailable(nextBlock) && studioBlockAvailable(currentBlock)
          ? currentBlock
          : block;
      })
    : nextModel.blocks;
  if (Array.isArray(nextBlocks)) {
    const nextKeys = new Set(nextBlocks.map(block => block?.key));
    for (const key of layoutKeys) {
      const currentBlock = currentBlocks.get(key);
      if (!nextKeys.has(key) && studioBlockAvailable(currentBlock) && currentBlock) nextBlocks.push(currentBlock);
    }
  }
  const wasPublished = recordValue(currentDraft).status === 'published'
    || Number(recordValue(currentDraft).lastPublishedRevision) > 0
    || recordValue(currentModel.publishedStax).published === true;
  const durableIdentity = wasPublished
    ? preservePublishedIdentity(nextModel, currentModel)
    : {};

  return {
    ...nextModel,
    ...durableIdentity,
    ...(Array.isArray(nextBlocks) ? { blocks: nextBlocks } : {}),
    ...(layoutKeys.length
      ? { selectedKeys: layoutKeys }
      : Array.isArray(currentModel.selectedKeys)
        ? { selectedKeys: currentModel.selectedKeys }
        : {}),
    ...(preservedPrimaryAi
      ? {
          team: currentModel.team,
          teamIcon: currentModel.teamIcon,
          teamOptions: currentModel.teamOptions,
        }
      : {}),
    ...(preservedQrTarget
      ? {
          qrTarget: currentModel.qrTarget,
          qrOptions: currentModel.qrOptions,
        }
      : {}),
  };
}

function preservePublishedIdentity(nextModel, currentModel) {
  const result = {};
  const placeholder = new Set(['', '@BUILDER', 'PRIVATE DRAFT', 'LOCAL DRAFT', 'SIGNED IN DRAFT', 'SYNCING TAKU', 'STAX PREVIEW', 'UNMINTED', 'PENDING']);
  for (const key of ['handle', 'cardHandle', 'serial', 'cardSerial', 'staxCardPageUrl']) {
    const nextValue = String(nextModel[key] ?? '').trim().toUpperCase();
    const currentValue = currentModel[key];
    if (placeholder.has(nextValue) && currentValue !== undefined && currentValue !== null && currentValue !== '') {
      result[key] = currentValue;
    }
  }
  if (
    recordValue(currentModel.publishedStax).published === true
    && recordValue(nextModel.publishedStax).published !== true
  ) {
    result.publishedStax = currentModel.publishedStax;
  }
  return result;
}

function validStudioLayout(value) {
  const layout = recordValue(value);
  return layout.schemaVersion === 'taku.stax.studio-layout.v1' && Array.isArray(layout.blocks)
    ? layout
    : null;
}

function blockMap(value) {
  const map = new Map();
  if (!Array.isArray(value)) return map;
  for (const block of value) {
    const entry = recordValue(block);
    const key = String(entry.key || '').trim().toLowerCase();
    if (key) map.set(key, block);
  }
  return map;
}

function studioBlockAvailable(value) {
  const block = recordValue(value);
  const status = String(block.status || '').trim().toLowerCase();
  if (block.supported === false || block.available === false) return false;
  return !status || ['supported', 'partial', 'available', 'ready'].includes(status);
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function createStudioDraftPayload(publishPayload) {
  const payload = structuredClone(publishPayload || {});
  const sections = payload && typeof payload.sections === 'object' && !Array.isArray(payload.sections)
    ? payload.sections
    : {};
  for (const key of ['builtItems', 'madeItems', 'remixedItems', 'usingTools']) {
    if (!Array.isArray(sections[key])) continue;
    sections[key] = sections[key].map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const next = { ...item };
      delete next.package;
      delete next.marketplacePublicationIntent;
      delete next.marketplace_publication_intent;
      return next;
    });
  }
  return payload;
}
