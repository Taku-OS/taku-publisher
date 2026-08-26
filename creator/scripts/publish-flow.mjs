import {
  createTakuStaxClient,
  createWorkerPublishError,
} from './publish-client.mjs';
import { fetchTakuCreatorProfile } from './creator-profile.mjs';
import { uploadPersonaAvatarForDraft } from './persona-avatar-upload.mjs';
import {
  createStaxCreatorPublishPayload,
  getBuilderProfileSnapshotForDisplay as getBuilderProfileSnapshotForDisplayCore,
  mergeStaxCreatorPublishPayloadWithExistingCard,
} from './publish-payload.mjs';
import { buildStaxPublishedLinks } from './stax-url.mjs';

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

function withTakuCreatorProfileFallback(context = {}, creatorProfile = {}) {
  if (!creatorProfile.displayName && !creatorProfile.avatarUrl) return context;
  const originalGetCardSettings = context.getCardSettings;
  if (typeof originalGetCardSettings !== 'function') return context;
  return {
    ...context,
    getCardSettings(draft) {
      const settings = originalGetCardSettings(draft) || {};
      return {
        ...settings,
        ...(!settings.name && creatorProfile.displayName ? { name: creatorProfile.displayName } : {}),
        ...(!settings.avatarUrl && creatorProfile.avatarUrl ? { avatarUrl: creatorProfile.avatarUrl } : {}),
      };
    },
  };
}

function withAvatarOverride(context = {}, avatarUrl = '') {
  if (!avatarUrl) return context;
  const originalGetCardSettings = context.getCardSettings;
  if (typeof originalGetCardSettings !== 'function') return context;
  return {
    ...context,
    getCardSettings(draft) {
      const settings = originalGetCardSettings(draft) || {};
      return {
        ...settings,
        avatarUrl,
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
  const profile = await fetchTakuCreatorProfile({ workerUrl, token });
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

  const personaAvatar = await uploadPersonaAvatarForDraft({
    draft,
    workerUrl,
    token: avatarUploadToken || token,
  }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (!personaAvatar.ok) {
    return {
      ok: false,
      status: 0,
      workerUrl,
      endpoint: `${workerUrl}/profile/avatar/signed-upload`,
      error: personaAvatar.error || 'Could not upload the Persona avatar.',
      data: {
        code: personaAvatar.code,
        avatarUpload: 'failed',
      },
    };
  }

  const endpoint = `${workerUrl}/stax/cards/import-inventory`;
  const publishContext = withAvatarOverride(
    withTakuCreatorProfileFallback(context, profile.profile),
    personaAvatar.avatarUrl,
  );
  const payload = await createPublishPayloadFromDraft(
    draft,
    privateInventory,
    publishContext
  );
  const client = createTakuStaxClient({ workerUrl, token });
  const existingCardPayload = await client.getMyCard().catch(() => null);
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
      status: 0,
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
        personaAvatarApplied: Boolean(personaAvatar.avatarUrl),
        personaAvatarCode: personaAvatar.code,
      },
    };
  }
  const ok = response.ok && parsedJson;
  const error = ok ? undefined : createWorkerPublishError({ response, data, parsedJson, endpoint });
  const links = ok ? buildStaxPublishedLinks(siteUrl, data?.data || data) : {};
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
    publishedInventory: {
      usingToolCount: publishPayload.sections.usingTools.length,
      madeItemCount: publishPayload.sections.madeItems.length,
      remixedItemCount: publishPayload.sections.remixedItems.length,
      builtItemCount: publishPayload.sections.builtItems.length,
      profileSnapshotIncluded: Boolean(publishPayload.profileSnapshot),
      personaAvatarApplied: Boolean(personaAvatar.avatarUrl),
      personaAvatarCode: personaAvatar.code,
      personaAvatarSkippedReason: personaAvatar.skipped ? personaAvatar.reason : undefined,
      workerSections: Array.isArray(data?.data?.sections) ? data.data.sections : undefined,
      installableItemCount: typeof data?.data?.installableItemCount === 'number' ? data.data.installableItemCount : undefined,
    },
  };
}
