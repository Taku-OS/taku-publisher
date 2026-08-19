import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { getFlag, readNumberFlag, stableId } from './cli.mjs';
import {
  PRIVATE_STATE_SCHEMA,
  editorStatePathFor,
  readPrivateState,
  readJsonFile,
  writeEditorState,
  writeJson,
  writePrivateState,
  writeText,
} from './draft-state.mjs';
import {
  applyCardSettingsToDraft,
  applyCreationChoicesToDraft,
  applyCreatorToolChoicesToDraft,
  applyPersonaOverridesToDraft,
  applyToolChoicesToDraft,
  cardSettingsForDraft,
  getDraftSectionItemsByCanonicalId,
  normalizeCreationRole,
  rebuildCreationChoices,
  rebuildToolChoices,
  refreshBuilderProfileSnapshot,
  upsertToolChoice,
} from './draft.mjs';
import { publicItem, readSkillFile } from './scan.mjs';
import {
  normalizeImportedGithubTool,
  parseImportedGithubRepo,
  readServerGithubTool,
} from './github-tools.mjs';
import { removeListingDraftFromStore, saveListingDraftToStore } from './listing-drafts.mjs';
import { createPublishContext, renderPreview } from './editor-renderer.mjs';
import { isRecord } from './privacy.mjs';
import {
  bindPublisherSessionAccount,
  buildTakuLoginUrl,
  clearPublisherSession,
  createPublishStatus,
  buildPublisherSessionFromAuthResult,
  readIconAuthToken,
  readExpectedPublisherUserId,
  readPublishToken,
  readPublisherSession,
  publisherUserIdFromToken,
  resolveSiteUrl,
  resolveWorkerUrl,
  writePublisherSession,
} from './publish-config.mjs';
import {
  createTakuStaxClient,
} from './publish-client.mjs';
import { fetchTakuCreatorProfile } from './creator-profile.mjs';
import { publishDraftToTaku } from './publish-flow.mjs';
import { createEditorCommandResult } from './host-output.mjs';
import { buildStaxCardPageUrl, buildStaxProfilePageUrl } from './stax-url.mjs';

const EDITOR_COOKIE_NAME = 'taku_creator_editor';
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const PUBLISH_REQUEST_BODY_BYTES = 6 * 1024 * 1024;
const EXPORT_PNG_MAX_REQUEST_BODY_BYTES = 24 * 1024 * 1024;
const EXPORT_PNG_TIMEOUT_MS = 90000;
const ICON_GENERATE_TIMEOUT_MS = 60000;
export const LISTING_ICON_GENERATE_PATH = '/marketplace/icons/generate';
export const LOCAL_AUTH_REDEEM_PATH = '/marketplace/local-auth/redeem';

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createLocalAuthChallenge() {
  const codeVerifier = base64Url(randomBytes(32));
  return {
    state: base64Url(randomBytes(24)),
    codeVerifier,
    codeChallenge: base64Url(createHash('sha256').update(codeVerifier).digest()),
    codeChallengeMethod: 'S256',
    createdAt: Date.now(),
  };
}

export function publisherAccountFromDraft(draft) {
  const boundAccount = isRecord(draft?.publisherAccount) ? draft.publisherAccount : {};
  const staxProfile = isRecord(draft?.staxProfile) ? draft.staxProfile : {};
  const creator = isRecord(draft?.creator) ? draft.creator : {};
  const card = isRecord(draft?.card) ? draft.card : {};
  const userId = cleanPublisherIdentityText(boundAccount.userId || boundAccount.user_id, 160);
  const username = normalizePublisherUsername(
    boundAccount.username
    || staxProfile.username
    || staxProfile.handle
    || creator.username
    || creator.handle
    || card.handle,
  );
  const displayName = cleanPublisherIdentityText(
    boundAccount.displayName
    || staxProfile.displayName
    || creator.name
    || card.name,
    120,
  );
  if (!userId && !username && !displayName) return null;
  return {
    ...(userId ? { userId } : {}),
    ...(username ? { username } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

export function publisherAccountFromProfileResult(result, accountHint = '', userId = '') {
  const staxProfile = isRecord(result?.staxProfile) ? result.staxProfile : {};
  const profile = isRecord(result?.profile) ? result.profile : {};
  const username = normalizePublisherUsername(staxProfile.username || staxProfile.handle);
  const displayName = cleanPublisherIdentityText(
    staxProfile.displayName || profile.displayName,
    120,
  );
  const normalizedHint = cleanPublisherIdentityText(accountHint, 160);
  const normalizedUserId = cleanPublisherIdentityText(userId, 160);
  if (!normalizedUserId && !username && !displayName && !normalizedHint) return null;
  return {
    ...(normalizedUserId ? { userId: normalizedUserId } : {}),
    ...(username ? { username } : {}),
    ...(displayName ? { displayName } : {}),
    ...(normalizedHint ? { accountHint: normalizedHint } : {}),
  };
}

export function publisherAccountsMismatch(expected, actual) {
  const expectedUserId = cleanPublisherIdentityText(expected?.userId, 160);
  const actualUserId = cleanPublisherIdentityText(actual?.userId, 160);
  if (expectedUserId && actualUserId) return expectedUserId !== actualUserId;
  const expectedUsername = normalizePublisherUsername(expected?.username);
  const actualUsername = normalizePublisherUsername(actual?.username);
  if (expectedUsername && actualUsername) return expectedUsername !== actualUsername;
  return Boolean(expectedUserId && !actualUserId);
}

export function bindDraftToDesktopAccount(draft, expectedUserId) {
  const normalizedExpectedUserId = cleanPublisherIdentityText(expectedUserId, 160);
  if (!normalizedExpectedUserId) return draft;
  const boundAccount = isRecord(draft?.publisherAccount) ? draft.publisherAccount : {};
  const boundUserId = cleanPublisherIdentityText(boundAccount.userId || boundAccount.user_id, 160);
  if (boundUserId && boundUserId !== normalizedExpectedUserId) {
    throw new Error('This Stax Card draft belongs to another Taku account.');
  }
  if (boundUserId === normalizedExpectedUserId) return draft;

  // Legacy Desktop drafts did not persist an immutable owner ID and may carry
  // profile fields written by a stale global publisher session. Keep the local
  // scan/persona, but discard every remote account-derived field before sync.
  const nextStats = isRecord(draft?.stats) ? { ...draft.stats } : {};
  delete nextStats.publishedStax;
  delete nextStats.creatorProfileSynced;
  const nextCreator = isRecord(draft?.creator) ? { ...draft.creator } : {};
  delete nextCreator.name;
  delete nextCreator.avatarUrl;
  const nextCard = isRecord(draft?.card) ? { ...draft.card } : {};
  delete nextCard.avatarUrl;
  const {
    staxProfile: _staleStaxProfile,
    publishedStax: _stalePublishedStax,
    ...localDraft
  } = draft || {};
  return {
    ...localDraft,
    publisherAccount: { userId: normalizedExpectedUserId },
    creator: nextCreator,
    card: nextCard,
    stats: nextStats,
  };
}

function normalizePublisherUsername(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase().slice(0, 80);
}

function cleanPublisherIdentityText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function publisherAccountMismatchMessage(expected, actual) {
  const expectedLabel = expected?.username ? `@${expected.username}` : expected?.displayName || 'this draft account';
  const actualLabel = actual?.username ? `@${actual.username}` : actual?.displayName || 'the current Taku account';
  return `This draft is bound to ${expectedLabel}, but Taku authorized ${actualLabel}. Switch to the draft account and try once more.`;
}

export async function startEditorServer(parsed, draftResult) {
  const host = getFlag(parsed, 'host') || '127.0.0.1';
  const port = readNumberFlag(parsed, 'port', 0);
  const token = randomBytes(18).toString('hex');
  const expectedPublisherUserId = readExpectedPublisherUserId();
  const accountBoundDraft = bindDraftToDesktopAccount(
    draftResult.draft,
    expectedPublisherUserId,
  );
  const draftPublisherAccount = publisherAccountFromDraft(accountBoundDraft);
  const state = {
    draftPath: path.resolve(draftResult.draftPath),
    previewPath: path.resolve(draftResult.previewPath),
    draft: accountBoundDraft,
    toolChoices: draftResult.toolChoices,
    creationChoices: draftResult.creationChoices,
    publishToken: readPublishToken(parsed),
    iconAuthToken: readIconAuthToken(parsed),
    localAuthChallenge: createLocalAuthChallenge(),
    profileSyncToken: '',
    publishAuthInvalid: false,
    publishAfterAuth: false,
    publisherAccount: expectedPublisherUserId
      ? { ...(draftPublisherAccount || {}), userId: expectedPublisherUserId }
      : draftPublisherAccount,
  };
  let editorUrl = '';
  let editorReturnUrl = '';
  const hydratePublishAuthFromSession = () => {
    let changed = false;
    if (!state.publishAuthInvalid && !state.publishToken) {
      const publishToken = readPublishToken(parsed);
      if (publishToken) {
        state.publishToken = publishToken;
        changed = true;
      }
    }
    if (!state.iconAuthToken) {
      const iconAuthToken = readIconAuthToken(parsed);
      if (iconAuthToken) {
        state.iconAuthToken = iconAuthToken;
        changed = true;
      }
    }
    return changed;
  };
  const createCurrentPublishStatus = () => createPublishStatus(parsed, {
    editorUrl: editorReturnUrl || editorUrl,
    draftPath: state.draftPath,
    publishToken: (hydratePublishAuthFromSession(), state.publishToken),
    iconAuthToken: state.iconAuthToken,
    localAuthChallenge: state.localAuthChallenge,
  });
  const buildEditorRenderOptions = () => ({
    editor: {
      enabled: true,
      token: '',
      publish: {
        authenticated: Boolean(state.publishToken),
        canPublish: Boolean(state.publishToken),
        needsAuth: !state.publishToken,
        loginUrl: buildTakuLoginUrl(parsed, {
          editorUrl: editorReturnUrl || editorUrl,
          draftPath: state.draftPath,
          localAuthChallenge: state.localAuthChallenge,
        }),
        iconLoginUrl: buildTakuLoginUrl(parsed, {
          editorUrl: editorReturnUrl || editorUrl,
          draftPath: state.draftPath,
          localAuthChallenge: state.localAuthChallenge,
        }),
        siteUrl: resolveSiteUrl(parsed),
        workerUrl: resolveWorkerUrl(parsed),
      },
    },
  });
  const renderReadonlyPreview = () => renderPreview(
    { ...state.draft, __toolChoices: state.toolChoices, __creationChoices: state.creationChoices },
    { readonlyPreview: true }
  );
  const ensureSignedInTakuProfileSynced = async () => {
    hydratePublishAuthFromSession();
    if (!state.publishToken || state.profileSyncToken === state.publishToken) return { ok: Boolean(state.publishToken) };
    const result = await syncSignedInTakuProfile({
      parsed,
      state,
      token: state.publishToken,
      renderReadonlyPreview,
    });
    if (result.accountMismatch) {
      state.publishToken = '';
      state.iconAuthToken = '';
      state.publishAuthInvalid = true;
      state.profileSyncToken = '';
      state.localAuthChallenge = createLocalAuthChallenge();
      clearPublisherSession();
      return result;
    }
    if (result.ok) {
      state.profileSyncToken = state.publishToken;
      state.publisherAccount = mergePublisherAccounts(
        state.publisherAccount,
        result.publisherAccount,
      );
      bindPublisherSessionAccount(state.publisherAccount);
    }
    return result;
  };
  const rememberPublishedStaxFromResult = async (result) => {
    const publishedStax = normalizePublishedStaxResult(result, resolveSiteUrl(parsed));
    if (!publishedStax.published) return publishedStax;
    state.draft = {
      ...state.draft,
      publishedStax,
      stats: {
        ...(isRecord(state.draft.stats) ? state.draft.stats : {}),
        publishedStax,
      },
    };
    await writeJson(state.draftPath, state.draft);
    await writeEditorState(state.draftPath, {
      previewPath: state.previewPath,
      toolChoices: state.toolChoices,
      creationChoices: state.creationChoices,
    });
    await writeText(state.previewPath, renderReadonlyPreview());
    return publishedStax;
  };
  const publishCurrentDraft = async () => {
    const profileSync = await ensureSignedInTakuProfileSynced();
    if (!profileSync.ok) {
      return {
        ok: false,
        status: profileSync.accountMismatch ? 409 : 401,
        error: profileSync.warning || 'Could not verify the Taku account for this draft.',
      };
    }
    const publishStatus = createCurrentPublishStatus();
    const privateState = await readPrivateState(state.draftPath);
    const result = await publishDraftToTaku({
      draft: state.draft,
      privateInventory: privateState?.privateInventory,
      workerUrl: publishStatus.workerUrl,
      token: state.publishToken,
      avatarUploadToken: state.iconAuthToken,
      siteUrl: publishStatus.siteUrl,
      context: createPublishContext(),
    });
    if (!result.ok) return result;
    return {
      ...result,
      publishedStax: await rememberPublishedStaxFromResult(result),
    };
  };
  const getCurrentStaxPublication = async ({ refresh = false } = {}) => {
    const cached = normalizePublishedStaxResult(state.draft.publishedStax || state.draft.stats?.publishedStax, resolveSiteUrl(parsed));
    const publishStatus = createCurrentPublishStatus();
    const base = {
      ok: true,
      published: cached.published,
      publicUrl: cached.publicUrl,
      profilePageUrl: cached.profilePageUrl,
      creatorPageUrl: cached.creatorPageUrl,
      staxCardPageUrl: cached.staxCardPageUrl,
      staxCardShareUrl: cached.staxCardShareUrl,
      staxCardImageUrl: cached.staxCardImageUrl,
      cardId: cached.cardId,
      username: cached.username,
      needsAuth: publishStatus.needsAuth,
      loginUrl: publishStatus.loginUrl,
      workerUrl: publishStatus.workerUrl,
    };
    if (!refresh || publishStatus.needsAuth || !state.publishToken) return base;
    try {
      const client = createTakuStaxClient({
        workerUrl: publishStatus.workerUrl,
        token: state.publishToken,
      });
      const remote = await client.getMyCard();
      const publishedStax = normalizePublishedStaxResult(remote, resolveSiteUrl(parsed));
      if (!publishedStax.published) {
        return {
          ...base,
          published: false,
          publicUrl: '',
          profilePageUrl: '',
          creatorPageUrl: '',
          staxCardPageUrl: '',
          staxCardShareUrl: '',
          staxCardImageUrl: '',
          cardId: '',
          username: '',
          needsAuth: false,
        };
      }
      return {
        ...base,
        ...(await rememberPublishedStaxFromResult(publishedStax)),
        needsAuth: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isStaxAuthErrorMessage(message)) {
        state.publishToken = '';
        state.publishAuthInvalid = true;
        const reauthStatus = createCurrentPublishStatus();
        return {
          ...base,
          needsAuth: true,
          canPublish: false,
          loginUrl: reauthStatus.loginUrl,
          warning: message,
        };
      }
      return {
        ...base,
        warning: message,
      };
    }
  };
  if (accountBoundDraft !== draftResult.draft) {
    await writeJson(state.draftPath, state.draft);
    await writeText(state.previewPath, renderReadonlyPreview());
  }
  await ensureSignedInTakuProfileSynced();

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
      if (request.method === 'GET' && requestUrl.pathname === '/favicon.ico') {
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (!hasValidEditorAuth(request, requestUrl, token)) {
        sendTextResponse(response, 403, 'Forbidden');
        return;
      }
      if (isUnsafeEditorMutation(request)) {
        sendTextResponse(response, 403, 'Forbidden cross-origin request');
        return;
      }

      if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/preview.html')) {
        await ensureSignedInTakuProfileSynced();
        const html = renderPreview({ ...state.draft, __toolChoices: state.toolChoices, __creationChoices: state.creationChoices }, buildEditorRenderOptions());
        sendHtmlResponse(response, html, token);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/state') {
        await ensureSignedInTakuProfileSynced();
        sendJsonResponse(response, {
          ok: true,
          draftPath: state.draftPath,
          previewPath: state.previewPath,
          summary: state.draft.stats,
          card: cardSettingsForDraft(state.draft),
          listingDrafts: state.draft.listingDrafts || {},
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
          publish: createCurrentPublishStatus(),
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/listing-drafts') {
        sendJsonResponse(response, {
          ok: true,
          listingDrafts: state.draft.listingDrafts || {},
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/publish/status') {
        sendJsonResponse(response, createCurrentPublishStatus());
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/stax/publication') {
        sendJsonResponse(response, await getCurrentStaxPublication({ refresh: true }));
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/stax/share') {
        const body = await readRequestJson(request, PUBLISH_REQUEST_BODY_BYTES);
        const publication = await getCurrentStaxPublication({ refresh: false });
        if (!publication.cardId) {
          sendJsonResponse(response, { ok: false, error: 'Publish Stax before sharing.' }, 409);
          return;
        }
        const client = createTakuStaxClient({ workerUrl: publication.workerUrl || resolveWorkerUrl(parsed) });
        const channel = cleanShareChannel(body.channel) || 'copy-link';
        const result = await client.fetchJson(`/stax/cards/${encodeURIComponent(publication.cardId)}/share`, {
          method: 'POST',
          body: JSON.stringify({ channel }),
        }, { token: null });
        sendJsonResponse(response, {
          ok: result.response.ok,
          ...(isRecord(result.data) ? result.data : {}),
        }, result.response.ok ? 200 : result.response.status || 500);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/export/png') {
        const body = await readRequestJson(request, EXPORT_PNG_MAX_REQUEST_BODY_BYTES);
        const cardHtml = typeof body.cardHtml === 'string' ? body.cardHtml : '';
        const styles = typeof body.styles === 'string' ? body.styles : '';
        if (!cardHtml || !styles) {
          sendJsonResponse(response, { ok: false, error: 'Missing export payload.' }, 400);
          return;
        }
        const width = clampInteger(body.width, 320, 2400, 940);
        const height = clampInteger(body.height, 240, 2400, 796);
        const scale = clampInteger(body.scale, 1, 4, 2);
        const filename = sanitizeDownloadFilename(body.filename || 'taku-stax.png');
        const png = await renderExportPngWithChrome({
          cardHtml,
          styles,
          width,
          height,
          scale,
        });
        sendPngResponse(response, png, filename);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/auth/token') {
        const body = await readRequestJson(request);
        const publishToken = typeof body.publishToken === 'string' ? body.publishToken.trim() : '';
        if (!publishToken) {
          sendJsonResponse(response, { ok: false, error: 'Missing publish token.' }, 400);
          return;
        }
        const profileSync = await syncSignedInTakuProfile({
          parsed,
          state,
          token: publishToken,
          renderReadonlyPreview,
        });
        if (!profileSync.ok) {
          if (profileSync.accountMismatch) {
            state.publishToken = '';
            state.iconAuthToken = '';
            state.publishAuthInvalid = true;
            state.profileSyncToken = '';
            state.localAuthChallenge = createLocalAuthChallenge();
            clearPublisherSession();
          }
          sendJsonResponse(response, {
            ok: false,
            code: profileSync.accountMismatch ? 'creator_account_mismatch' : 'creator_account_check_failed',
            error: profileSync.warning || 'Could not verify the Taku account for this draft.',
            needsAuth: false,
          }, profileSync.accountMismatch ? 409 : 502);
          return;
        }
        state.publishToken = publishToken;
        state.publishAuthInvalid = false;
        state.publisherAccount = profileSync.publisherAccount || state.publisherAccount;
        writePublisherSession(buildPublisherSessionFromAuthResult({
          token: publishToken,
          account: state.publisherAccount,
        }));
        sendJsonResponse(response, createCurrentPublishStatus());
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/auth/local-code') {
        const body = await readRequestJson(request);
        const code = typeof body.code === 'string' ? body.code.trim() : '';
        const authState = typeof body.state === 'string' ? body.state.trim() : '';
        if (!code || !authState) {
          sendJsonResponse(response, { ok: false, error: 'Missing local auth code.' }, 400);
          return;
        }
        if (authState !== state.localAuthChallenge.state) {
          sendJsonResponse(response, { ok: false, error: 'Local auth state mismatch.' }, 401);
          return;
        }

        let result;
        try {
          result = await redeemLocalAuthCode({
            workerUrl: resolveWorkerUrl(parsed),
            code,
            state: authState,
            codeVerifier: state.localAuthChallenge.codeVerifier,
          });
        } catch (error) {
          sendJsonResponse(response, {
            ok: false,
            error: iconNetworkErrorMessage(error),
          }, 502);
          return;
        }

        if (!result.response.ok) {
          sendJsonResponse(response, {
            ok: false,
            error: workerJsonError(result) || `Local auth failed with HTTP ${result.response.status}`,
            needsAuth: true,
          }, result.response.status || 401);
          return;
        }

        const publishToken = typeof result.data?.token === 'string' ? result.data.token.trim() : '';
        const iconAuthToken = typeof result.data?.iconToken === 'string' ? result.data.iconToken.trim() : '';
        if (!publishToken) {
          sendJsonResponse(response, { ok: false, error: 'Local auth did not return a publisher token.' }, 502);
          return;
        }
        const profileSync = await syncSignedInTakuProfile({
          parsed,
          state,
          token: publishToken,
          renderReadonlyPreview,
        });
        if (!profileSync.ok) {
          state.publishToken = '';
          state.iconAuthToken = '';
          state.publishAuthInvalid = true;
          state.profileSyncToken = '';
          state.localAuthChallenge = createLocalAuthChallenge();
          clearPublisherSession();
          sendJsonResponse(response, {
            ok: false,
            code: profileSync.accountMismatch ? 'creator_account_mismatch' : 'creator_account_check_failed',
            error: profileSync.warning || 'Could not verify the Taku account for this draft.',
            needsAuth: false,
            canPublish: false,
          }, profileSync.accountMismatch ? 409 : 502);
          return;
        }
        state.publishToken = publishToken;
        state.iconAuthToken = iconAuthToken;
        state.publishAuthInvalid = false;
        state.profileSyncToken = publishToken;
        state.publisherAccount = profileSync.publisherAccount || state.publisherAccount;
        writePublisherSession(buildPublisherSessionFromAuthResult({
          ...result.data,
          account: {
            ...state.publisherAccount,
            accountHint: result.data?.accountHint,
          },
        }));
        let resumedPublish = null;
        if (state.publishAfterAuth) {
          state.publishAfterAuth = false;
          const pendingReviews = pendingLocalToolListingReviews(state);
          resumedPublish = pendingReviews.length
            ? {
                ok: false,
                error: `还有 ${pendingReviews.length} 个本地工具未完成发布审核。`,
              }
            : await publishCurrentDraft();
          if (!resumedPublish.ok && isPublishAuthFailure(resumedPublish.status, resumedPublish.data)) {
            state.publishToken = '';
            state.iconAuthToken = '';
            state.publishAuthInvalid = true;
            clearPublisherSession();
          }
        }
        const autoPublishSucceeded = Boolean(
          resumedPublish?.ok && resumedPublish?.publishedStax?.published,
        );
        state.localAuthChallenge = createLocalAuthChallenge();
        sendJsonResponse(response, {
          ...createCurrentPublishStatus(),
          profileSynced: true,
          profileSyncWarning: profileSync.warning,
          staxProfile: profileSync.staxProfile || null,
          autoPublishAttempted: Boolean(resumedPublish),
          autoPublishSucceeded,
          ...(autoPublishSucceeded ? { publishedStax: resumedPublish.publishedStax } : {}),
          ...(resumedPublish && !autoPublishSucceeded
            ? {
                publishError: resumedPublish.error
                  || resumedPublish.data?.error
                  || resumedPublish.data?.message
                  || 'Taku did not confirm that the Stax page is public yet.',
              }
            : {}),
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/card') {
        const body = await readRequestJson(request);
        state.draft = applyCardSettingsToDraft(state.draft, body.card || body);
        await writeJson(state.draftPath, state.draft);
        await writeEditorState(state.draftPath, {
          previewPath: state.previewPath,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
        });
        await writeText(state.previewPath, renderReadonlyPreview());
        sendJsonResponse(response, {
          ok: true,
          draftPath: state.draftPath,
          previewPath: state.previewPath,
          summary: state.draft.stats,
          card: cardSettingsForDraft(state.draft),
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/tools') {
        const body = await readRequestJson(request);
        const displayedToolIds = Array.isArray(body.displayedToolIds)
          ? body.displayedToolIds.filter((id) => typeof id === 'string')
          : [];
        state.toolChoices = rebuildToolChoices(state.toolChoices, displayedToolIds);
        state.draft = applyToolChoicesToDraft(state.draft, state.toolChoices);
        await writeJson(state.draftPath, state.draft);
        await writeEditorState(state.draftPath, {
          previewPath: state.previewPath,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
        });
        await writeText(state.previewPath, renderReadonlyPreview());
        sendJsonResponse(response, {
          ok: true,
          draftPath: state.draftPath,
          previewPath: state.previewPath,
          summary: state.draft.stats,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/github-tool-preview') {
        sendJsonResponse(response, {
          ok: false,
          error: '公开 GitHub 仓库不再作为 Creator 能力导入。请在 Taku Desktop 连接自己的 GitHub 后导入已授权仓库，或使用本地包上传。',
          code: 'public_github_import_disabled',
        }, 410);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/github-tool') {
        sendJsonResponse(response, {
          ok: false,
          error: '公开 GitHub 仓库不再作为 Creator 能力导入。请在 Taku Desktop 连接自己的 GitHub 后导入已授权仓库，或使用本地包上传。',
          code: 'public_github_import_disabled',
        }, 410);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/creator-tools') {
        const body = await readRequestJson(request);
        const creatorToolIds = Array.isArray(body.creatorToolIds)
          ? body.creatorToolIds.filter((id) => typeof id === 'string')
          : [];
        state.draft = applyCreatorToolChoicesToDraft(state.draft, state.toolChoices, creatorToolIds);
        await writeJson(state.draftPath, state.draft);
        await writeEditorState(state.draftPath, {
          previewPath: state.previewPath,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
        });
        await writeText(state.previewPath, renderReadonlyPreview());
        sendJsonResponse(response, {
          ok: true,
          draftPath: state.draftPath,
          previewPath: state.previewPath,
          summary: state.draft.stats,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
          creatorToolIds: state.draft.stats?.creatorToolIds || [],
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/local-package') {
        const body = await readRequestJson(request);
        const localPath = typeof body.localPath === 'string' ? body.localPath.trim() : '';
        if (!localPath) {
          sendJsonResponse(response, { ok: false, error: 'Missing local package path.' }, 400);
          return;
        }
        const currentLocalToolCount = (state.toolChoices?.displayedTools || [])
          .filter(isEditorAddedLocalTool)
          .length;
        if (currentLocalToolCount >= 3) {
          sendJsonResponse(response, {
            ok: false,
            error: '一个 Creator Profile 最多添加 3 个本地工具。请先删除一个再添加。',
          }, 400);
          return;
        }

        let localPackage;
        try {
          localPackage = await createLocalPackageTool(localPath);
        } catch (error) {
          sendJsonResponse(response, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }, 400);
          return;
        }

        state.toolChoices = upsertToolChoice(state.toolChoices, localPackage.publicTool, {
          displayed: true,
          position: 'start',
        });
        state.draft = applyToolChoicesToDraft(state.draft, state.toolChoices);
        const listingDraft = createInitialLocalListingDraft(localPackage.publicTool);
        state.draft = {
          ...state.draft,
          listingDrafts: {
            ...(isRecord(state.draft.listingDrafts) ? state.draft.listingDrafts : {}),
            [localPackage.publicTool.id]: listingDraft,
          },
        };
        state.draft.stats = {
          ...(state.draft.stats || {}),
          listingDraftCount: Object.keys(state.draft.listingDrafts || {}).length,
          listingReadyCount: Object.values(state.draft.listingDrafts || {}).filter((entry) => entry?.status === 'ready').length,
        };

        const privateState = await readPrivateState(state.draftPath);
        const privateInventory = upsertPrivateInventoryItem(
          privateState?.privateInventory,
          localPackage.privateItem
        );
        await writeJson(state.draftPath, state.draft);
        await writePrivateState(state.draftPath, privateInventory);
        await saveListingDraftToStore(parsed, localPackage.publicTool.id, listingDraft);
        await writeEditorState(state.draftPath, {
          previewPath: state.previewPath,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
        });
        await writeText(state.previewPath, renderReadonlyPreview());
        sendJsonResponse(response, {
          ok: true,
          tool: localPackage.publicTool,
          listingDraft,
          draftPath: state.draftPath,
          previewPath: state.previewPath,
          summary: state.draft.stats,
          toolChoices: state.toolChoices,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/local-package/remove') {
        const body = await readRequestJson(request);
        const toolId = typeof body.toolId === 'string' ? body.toolId.trim() : '';
        if (!toolId) {
          sendJsonResponse(response, { ok: false, error: 'Missing toolId.' }, 400);
          return;
        }

        const sourceTool = findToolChoiceById(state.toolChoices, toolId) || findDraftLocalToolById(state.draft, toolId);
        if (!sourceTool) {
          sendJsonResponse(response, { ok: false, error: '没有找到这个本地工具包。' }, 404);
          return;
        }
        if (!isEditorAddedLocalTool(sourceTool)) {
          sendJsonResponse(response, { ok: false, error: '这个工具不是从本地添加的，不能在这里删除。' }, 400);
          return;
        }

        const resolvedToolId = sourceTool.id || toolId;
        state.toolChoices = removeToolChoiceById(state.toolChoices, resolvedToolId);
        state.draft = applyToolChoicesToDraft(state.draft, state.toolChoices);
        state.creationChoices = removeCreationChoiceById(state.creationChoices, resolvedToolId, sourceTool);
        state.draft = applyCreationChoicesToDraft(state.draft, state.creationChoices);
        state.draft = removeLocalToolFromDraft(state.draft, resolvedToolId, sourceTool);
        const nextListingDrafts = {
          ...(isRecord(state.draft.listingDrafts) ? state.draft.listingDrafts : {}),
        };
        delete nextListingDrafts[toolId];
        delete nextListingDrafts[resolvedToolId];
        state.draft = {
          ...state.draft,
          listingDrafts: nextListingDrafts,
          stats: {
            ...(state.draft.stats || {}),
            listingDraftCount: Object.keys(nextListingDrafts).length,
            listingReadyCount: Object.values(nextListingDrafts).filter((entry) => entry?.status === 'ready').length,
          },
        };

        const privateState = await readPrivateState(state.draftPath);
        const privateInventory = removePrivateInventoryItem(privateState?.privateInventory, resolvedToolId);
        await removeListingDraftFromStore(parsed, resolvedToolId);
        await writeJson(state.draftPath, state.draft);
        await writePrivateState(state.draftPath, privateInventory);
        await writeEditorState(state.draftPath, {
          previewPath: state.previewPath,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
        });
        await writeText(state.previewPath, renderReadonlyPreview());
        sendJsonResponse(response, {
          ok: true,
          toolId: resolvedToolId,
          removedTool: {
            id: sourceTool.id,
            name: sourceTool.name || sourceTool.title || '',
          },
          draftPath: state.draftPath,
          previewPath: state.previewPath,
          summary: state.draft.stats,
          toolChoices: state.toolChoices,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/listing-draft') {
        const body = await readRequestJson(request);
        const toolId = typeof body.toolId === 'string' ? body.toolId.trim() : '';
        if (!toolId) {
          sendJsonResponse(response, { ok: false, error: 'Missing toolId.' }, 400);
          return;
        }
        const listing = normalizeListingDraft(body.listing || {});
        const sourceTool = findToolChoiceById(state.toolChoices, toolId);
        const status = isListingReady(listing, { requireIcon: isEditorAddedLocalTool(sourceTool) }) ? 'ready' : 'draft';
        state.draft = {
          ...state.draft,
          listingDrafts: {
            ...(isRecord(state.draft.listingDrafts) ? state.draft.listingDrafts : {}),
            [toolId]: {
              schemaVersion: 'taku.creator.tool-listing-draft.v1',
              sourceItemId: toolId,
              updatedAt: new Date().toISOString(),
              status,
              listing,
              technical: {
                name: sourceTool?.name || sourceTool?.title || '',
                type: sourceTool?.type || sourceTool?.kind || '',
                source: sourceTool?.source || '',
                detectedFrom: sourceTool?.detectedFrom || sourceTool?.scanPreview?.detectedFrom || '',
              },
            },
          },
        };
        state.draft.stats = {
          ...(state.draft.stats || {}),
          listingDraftCount: Object.keys(state.draft.listingDrafts || {}).length,
          listingReadyCount: Object.values(state.draft.listingDrafts || {}).filter((entry) => entry?.status === 'ready').length,
        };
        await saveListingDraftToStore(parsed, toolId, state.draft.listingDrafts[toolId]);
        await writeJson(state.draftPath, state.draft);
        await writeEditorState(state.draftPath, {
          previewPath: state.previewPath,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
        });
        await writeText(state.previewPath, renderReadonlyPreview());
        sendJsonResponse(response, {
          ok: true,
          toolId,
          listingDraft: state.draft.listingDrafts[toolId],
          summary: state.draft.stats,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/listing-draft/reset') {
        const body = await readRequestJson(request);
        const toolId = typeof body.toolId === 'string' ? body.toolId.trim() : '';
        if (!toolId) {
          sendJsonResponse(response, { ok: false, error: 'Missing toolId.' }, 400);
          return;
        }
        const nextListingDrafts = {
          ...(isRecord(state.draft.listingDrafts) ? state.draft.listingDrafts : {}),
        };
        delete nextListingDrafts[toolId];
        state.draft = {
          ...state.draft,
          listingDrafts: nextListingDrafts,
          stats: {
            ...(state.draft.stats || {}),
            listingDraftCount: Object.keys(nextListingDrafts).length,
            listingReadyCount: Object.values(nextListingDrafts).filter((entry) => entry?.status === 'ready').length,
          },
        };
        await removeListingDraftFromStore(parsed, toolId);
        await writeJson(state.draftPath, state.draft);
        await writeEditorState(state.draftPath, {
          previewPath: state.previewPath,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
        });
        await writeText(state.previewPath, renderReadonlyPreview());
        sendJsonResponse(response, {
          ok: true,
          toolId,
          listingDraft: null,
          summary: state.draft.stats,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/listing-icon/generate') {
        const publishStatus = createCurrentPublishStatus();
        const publishToken = state.publishToken;
        const iconToken = state.iconAuthToken
          || (!publishToken.startsWith('taku_pub_') ? publishToken : '');
        if (publishStatus.needsConfig) {
          sendJsonResponse(response, publishStatus, 400);
          return;
        }
        if (!iconToken) {
          sendJsonResponse(response, {
            ...publishStatus,
            ok: false,
            error: 'Sign in to Taku before generating icons.',
            loginUrl: publishStatus.iconLoginUrl || publishStatus.loginUrl,
          }, 401);
          return;
        }

        const body = await readRequestJson(request);
        const toolId = typeof body.toolId === 'string' ? body.toolId.trim() : '';
        if (!toolId) {
          sendJsonResponse(response, { ok: false, error: 'Missing toolId.' }, 400);
          return;
        }
        const sourceTool = findToolChoiceById(state.toolChoices, toolId);
        if (!sourceTool) {
          sendJsonResponse(response, { ok: false, error: 'Tool not found in this draft.' }, 404);
          return;
        }

        const listing = normalizeListingDraft(body.listing || {});
        const generationPayload = buildListingIconGeneratePayload({
          draft: state.draft,
          tool: sourceTool,
          toolId,
          listing,
        });
        let result;
        try {
          result = await fetchListingIconGenerate({
            workerUrl: publishStatus.workerUrl,
            token: iconToken,
            payload: generationPayload,
          });
        } catch (error) {
          sendJsonResponse(response, {
            ok: false,
            error: iconNetworkErrorMessage(error),
          }, 502);
          return;
        }

        if (!result.response.ok) {
          if (isPublishAuthFailure(result.response.status, result.data)) {
            if (iconToken === state.iconAuthToken) state.iconAuthToken = '';
            if (iconToken === state.publishToken) state.publishToken = '';
            state.localAuthChallenge = createLocalAuthChallenge();
            const reauthStatus = createCurrentPublishStatus();
            sendJsonResponse(response, {
              ok: false,
              error: 'Taku auth expired. Sign in again before generating icons.',
              needsAuth: true,
              authExpired: true,
              canPublish: Boolean(state.publishToken),
              loginUrl: reauthStatus.iconLoginUrl || reauthStatus.loginUrl,
              iconLoginUrl: reauthStatus.iconLoginUrl,
            }, result.response.status || 401);
            return;
          }
          sendJsonResponse(response, {
            ok: false,
            error: workerJsonError(result) || `Icon generation failed with HTTP ${result.response.status}`,
          }, result.response.status || 500);
          return;
        }

        const icon = normalizeGeneratedIconPayload(result.data);
        sendJsonResponse(response, {
          ok: true,
          toolId,
          icon,
          listing: {
            ...listing,
            coverImageUrl: icon.imageUrl,
          },
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/creations') {
        const body = await readRequestJson(request);
        const nextCreationRoles = isRecord(body.creationRoles)
          ? Object.fromEntries(Object.entries(body.creationRoles)
              .filter(([id]) => typeof id === 'string')
              .map(([id, role]) => [id, normalizeCreationRole(role)]))
          : (Array.isArray(body.displayedCreationIds)
              ? body.displayedCreationIds.filter((id) => typeof id === 'string')
              : {});
        state.creationChoices = rebuildCreationChoices(state.creationChoices, nextCreationRoles);
        state.draft = applyCreationChoicesToDraft(state.draft, state.creationChoices);
        await writeJson(state.draftPath, state.draft);
        await writeEditorState(state.draftPath, {
          previewPath: state.previewPath,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
        });
        await writeText(state.previewPath, renderReadonlyPreview());
        sendJsonResponse(response, {
          ok: true,
          draftPath: state.draftPath,
          previewPath: state.previewPath,
          summary: state.draft.stats,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/persona') {
        const body = await readRequestJson(request);
        if (!state.draft.personaV2) {
          sendJsonResponse(response, { ok: false, error: 'No persona data in this draft.' }, 400);
          return;
        }
        state.draft = applyPersonaOverridesToDraft(state.draft, body.personaOverrides || body);
        await writeJson(state.draftPath, state.draft);
        await writeEditorState(state.draftPath, {
          previewPath: state.previewPath,
          toolChoices: state.toolChoices,
          creationChoices: state.creationChoices,
        });
        await writeText(state.previewPath, renderReadonlyPreview());
        sendJsonResponse(response, {
          ok: true,
          draftPath: state.draftPath,
          previewPath: state.previewPath,
          summary: state.draft.stats,
          persona: state.draft.personaV2,
          personaOverrides: state.draft.personaOverrides,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/publish') {
        const body = await readRequestJson(request);
        const staxCardSnapshot = sanitizeStaxCardSnapshot(body.staxCardSnapshot || body.stax_card_snapshot);
        if (staxCardSnapshot) {
          state.draft = applyStaxCardSnapshotToDraft(state.draft, staxCardSnapshot);
          await writeJson(state.draftPath, state.draft);
          await writeEditorState(state.draftPath, {
            previewPath: state.previewPath,
            toolChoices: state.toolChoices,
            creationChoices: state.creationChoices,
          });
        }
        const pendingReviews = pendingLocalToolListingReviews(state);
        if (pendingReviews.length) {
          state.publishAfterAuth = false;
          sendJsonResponse(response, {
            ok: false,
            code: 'listing_review_required',
            error: `还有 ${pendingReviews.length} 个本地工具未完成发布审核。`,
            message: '请先补齐工具的标题、简短描述、分类和图标，再发布 Creator Profile。',
            reviewToolIds: pendingReviews.map((review) => review.id),
            reviews: pendingReviews,
          }, 409);
          return;
        }
        const publishStatus = createCurrentPublishStatus();
        if (publishStatus.needsConfig) {
          state.publishAfterAuth = false;
          sendJsonResponse(response, publishStatus, 400);
          return;
        }
        if (publishStatus.needsAuth) {
          state.publishAfterAuth = true;
          sendJsonResponse(response, publishStatus, 401);
          return;
        }
        state.publishAfterAuth = false;
        const result = await publishCurrentDraft();
        if (!result.ok && isPublishAuthFailure(result.status, result.data)) {
          state.publishToken = '';
          state.iconAuthToken = '';
          state.publishAuthInvalid = true;
          state.publishAfterAuth = true;
          state.localAuthChallenge = createLocalAuthChallenge();
          const reauthStatus = createCurrentPublishStatus();
          sendJsonResponse(response, {
            ...result,
            ok: false,
            error: '发布授权已失效，请重新登录 Taku 后再发布。你的草稿不会丢失。',
            message: '发布授权已失效，请重新登录 Taku 后再发布。你的草稿不会丢失。',
            needsAuth: true,
            authExpired: true,
            canPublish: false,
            loginUrl: reauthStatus.loginUrl,
          }, result.status || 401);
          return;
        }
        sendJsonResponse(response, {
          ...result,
          error: result.ok ? undefined : result.error || result.data?.error || result.data?.message || `HTTP ${result.status}`,
          loginUrl: publishStatus.loginUrl,
          canPublish: publishStatus.canPublish,
        }, result.ok ? 200 : result.status || 500);
        return;
      }

      sendTextResponse(response, 404, 'Not found');
    } catch (error) {
      sendJsonResponse(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  editorUrl = `http://${host}:${actualPort}/?token=${encodeURIComponent(token)}`;
  editorReturnUrl = `http://${host}:${actualPort}/`;
  return createEditorCommandResult(state.draft, editorUrl);
}

async function syncSignedInTakuProfile({ parsed, state, token, renderReadonlyPreview }) {
  try {
    const result = await fetchTakuCreatorProfile({
      workerUrl: resolveWorkerUrl(parsed),
      token,
    });
    if (!result?.ok) {
      return {
        ok: false,
        warning: result?.error || 'Signed-in Taku profile is not available yet.',
      };
    }

    const profile = isRecord(result.profile) ? result.profile : {};
    const staxProfile = isRecord(result.staxProfile) ? result.staxProfile : {};
    const publisherAccount = publisherAccountFromProfileResult(
      result,
      '',
      authenticatedPublisherUserId(token),
    );
    if (publisherAccountsMismatch(state.publisherAccount, publisherAccount)) {
      return {
        ok: false,
        accountMismatch: true,
        publisherAccount,
        warning: publisherAccountMismatchMessage(state.publisherAccount, publisherAccount),
      };
    }
    const resolvedPublisherAccount = mergePublisherAccounts(
      state.publisherAccount,
      publisherAccount,
    );
    const nextDraft = {
      ...state.draft,
      ...(resolvedPublisherAccount ? { publisherAccount: resolvedPublisherAccount } : {}),
      creator: {
        ...(state.draft.creator || {}),
        ...(profile.displayName ? { name: profile.displayName } : {}),
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      },
      card: {
        ...(state.draft.card || {}),
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      },
      ...(Object.keys(staxProfile).length
        ? { staxProfile: { ...(state.draft.staxProfile || {}), ...staxProfile } }
        : {}),
      stats: {
        ...(state.draft.stats || {}),
        creatorProfileSynced: true,
      },
    };
    state.draft = refreshBuilderProfileSnapshot(nextDraft);
    await writeJson(state.draftPath, state.draft);
    await writeEditorState(state.draftPath, {
      previewPath: state.previewPath,
      toolChoices: state.toolChoices,
      creationChoices: state.creationChoices,
    });
    await writeText(state.previewPath, renderReadonlyPreview());
    return {
      ok: true,
      publisherAccount: resolvedPublisherAccount,
      staxProfile: Object.keys(staxProfile).length ? staxProfile : null,
    };
  } catch (error) {
    return {
      ok: false,
      warning: `Signed-in Taku profile sync failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function authenticatedPublisherUserId(token) {
  const tokenUserId = publisherUserIdFromToken(token);
  if (tokenUserId) return tokenUserId;
  const session = readPublisherSession();
  if (String(session?.accessToken || '').trim() !== String(token || '').trim()) return '';
  return cleanPublisherIdentityText(session?.account?.userId, 160);
}

function mergePublisherAccounts(current, next) {
  if (!current && !next) return null;
  return {
    ...(current || {}),
    ...(next || {}),
  };
}

async function createLocalPackageTool(localPath) {
  const resolved = path.resolve(localPath);
  const packageInfo = await inspectLocalPackagePath(resolved);
  if (!packageInfo) {
    throw new Error('没有找到可发布的本地工具包。请提供 skill 目录/SKILL.md、plugin manifest、action 文件或 agent 文件。');
  }

  if (packageInfo.type === 'skill') {
    const skill = await readSkillFile(packageInfo.localPath, 'local-upload');
    if (!skill) throw new Error('无法读取这个本地 skill。');
    return buildLocalPackageTool({
      ...skill,
      source: 'local-upload',
      type: 'skill',
      availability: 'local',
      publishable: true,
      ownership: 'owned',
      ownershipConfidence: 0.9,
      ownershipReasons: ['Added from the Creator Profile editor'],
    }, packageInfo.localPath);
  }

  const manifest = packageInfo.manifestPath
    ? await readJsonFile(packageInfo.manifestPath)
    : null;
  const name = cleanLocalText(
    manifest?.interface?.display_name ||
    manifest?.interface?.displayName ||
    manifest?.display_name ||
    manifest?.displayName ||
    manifest?.name ||
    path.basename(packageInfo.localPath, path.extname(packageInfo.localPath)),
    120
  ) || `Local ${packageInfo.type}`;
  const description = cleanLocalText(
    manifest?.interface?.short_description ||
    manifest?.interface?.shortDescription ||
    manifest?.description ||
    manifest?.summary,
    360
  );
  return buildLocalPackageTool({
    id: stableId('local-upload', packageInfo.type, name, packageInfo.localPath),
    type: packageInfo.type,
    source: 'local-upload',
    name,
    description,
    detectedFrom: path.basename(packageInfo.localPath),
    availability: 'local',
    publishable: true,
    ownership: 'owned',
    ownershipConfidence: 0.9,
    ownershipReasons: ['Added from the Creator Profile editor'],
  }, packageInfo.localPath);
}

export async function inspectLocalPackagePath(resolvedPath) {
  const stat = await fs.stat(resolvedPath).catch(() => null);
  if (!stat) return null;

  if (stat.isDirectory()) {
    const directoryEntries = await fs.readdir(resolvedPath).catch(() => []);
    const skillName = directoryEntries.find((name) => name === 'SKILL.md')
      || directoryEntries.find((name) => name.toLowerCase() === 'skill.md');
    const skillPath = skillName ? path.join(resolvedPath, skillName) : '';
    if (skillPath && await isFile(skillPath)) return { type: 'skill', localPath: skillPath };

    const pluginManifest = await firstExistingFile([
      path.join(resolvedPath, '.codex-plugin', 'plugin.json'),
      path.join(resolvedPath, '.claude-plugin', 'plugin.json'),
      path.join(resolvedPath, 'plugin.json'),
      path.join(resolvedPath, 'taku.stax.json'),
      path.join(resolvedPath, 'package.json'),
    ]);
    if (pluginManifest) {
      return {
        type: 'plugin',
        localPath: pluginManifest,
        manifestPath: pluginManifest,
      };
    }
    return null;
  }

  if (!stat.isFile()) return null;
  const basename = path.basename(resolvedPath);
  const lower = basename.toLowerCase();
  const parent = path.basename(path.dirname(resolvedPath));
  if (basename === 'SKILL.md') return { type: 'skill', localPath: resolvedPath };
  if (
    lower === 'taku.stax.json' ||
    lower === 'package.json' ||
    lower === 'plugin.json' ||
    (lower === 'plugin.json' && (parent === '.codex-plugin' || parent === '.claude-plugin'))
  ) {
    return { type: 'plugin', localPath: resolvedPath, manifestPath: resolvedPath };
  }
  if (/\.(md|markdown|json)$/i.test(lower)) {
    const dirname = path.basename(path.dirname(resolvedPath)).toLowerCase();
    if (dirname.includes('agent')) return { type: 'agent', localPath: resolvedPath, manifestPath: lower.endsWith('.json') ? resolvedPath : '' };
    if (dirname.includes('command') || dirname.includes('workflow') || dirname.includes('action')) {
      return { type: 'action', localPath: resolvedPath, manifestPath: lower.endsWith('.json') ? resolvedPath : '' };
    }
  }
  return null;
}

function buildLocalPackageTool(sourceItem, localPath) {
  const publicTool = {
    ...publicItem(sourceItem, 'using'),
    sourceKind: 'local_upload',
    source_kind: 'local_upload',
    runnable: true,
    installability: 'installable',
    installPolicy: 'installable',
    install_policy: 'installable',
    metadata: {
      sourceKind: 'local_upload',
      source_kind: 'local_upload',
      sourceType: sourceItem.type,
      source_type: sourceItem.type,
      installability: 'installable',
      installPolicy: 'installable',
      install_policy: 'installable',
      addedFrom: 'creator-editor',
      added_from: 'creator-editor',
    },
  };
  return {
    publicTool,
    privateItem: {
      id: sourceItem.id,
      name: sourceItem.name,
      type: sourceItem.type,
      source: sourceItem.source,
      detectedFrom: sourceItem.detectedFrom,
      availability: sourceItem.availability,
      ownership: sourceItem.ownership,
      localPath,
    },
  };
}

function upsertPrivateInventoryItem(privateInventory, item) {
  const currentItems = Array.isArray(privateInventory?.items) ? privateInventory.items : [];
  const nextItems = [
    item,
    ...currentItems.filter((entry) => entry?.id !== item.id),
  ];
  return {
    schemaVersion: privateInventory?.schemaVersion || PRIVATE_STATE_SCHEMA,
    generatedAt: privateInventory?.generatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: nextItems,
  };
}

function removePrivateInventoryItem(privateInventory, toolId) {
  const currentItems = Array.isArray(privateInventory?.items) ? privateInventory.items : [];
  return {
    schemaVersion: privateInventory?.schemaVersion || PRIVATE_STATE_SCHEMA,
    generatedAt: privateInventory?.generatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: currentItems.filter((entry) => entry?.id !== toolId && entry?.public?.id !== toolId),
  };
}

function removeToolChoiceById(toolChoices, toolId) {
  const withoutTool = (items) => Array.isArray(items)
    ? items.filter((item) => item?.id !== toolId)
    : [];
  const availableTools = withoutTool(toolChoices?.availableTools).map((choice, index) => ({
    ...choice,
    index: index + 1,
  }));
  const displayedIds = new Set(availableTools.filter((choice) => choice.displayed).map((choice) => choice.id));
  return {
    ...toolChoices,
    displayedTools: withoutTool(toolChoices?.displayedTools).filter((item) => displayedIds.has(item.id)),
    hiddenTools: withoutTool(toolChoices?.hiddenTools).filter((item) => !displayedIds.has(item.id)),
    availableTools,
  };
}

function removeCreationChoiceById(creationChoices, toolToken, sourceTool) {
  const tokens = new Set([
    toolToken,
    sourceTool?.id,
    sourceTool?.name,
    sourceTool?.title,
  ].filter(Boolean).map(normalizeToolToken));
  const withoutCreation = (items) => Array.isArray(items)
    ? items.filter((item) => !toolTokenMatchesAny(item, tokens))
    : [];
  const usedCreations = withoutCreation(creationChoices?.usedCreations);
  const madeCreations = withoutCreation(creationChoices?.madeCreations);
  const remixedCreations = withoutCreation(creationChoices?.remixedCreations);
  const confirmedCreations = [...usedCreations, ...madeCreations, ...remixedCreations];
  const hiddenCreations = withoutCreation(creationChoices?.hiddenCreations);
  const availableCreations = withoutCreation(creationChoices?.availableCreations).map((choice, index) => ({
    ...choice,
    index: index + 1,
  }));
  const creationRoles = { ...(creationChoices?.creationRoles || {}) };
  for (const key of Object.keys(creationRoles)) {
    if (tokens.has(normalizeToolToken(key))) delete creationRoles[key];
  }
  return {
    ...creationChoices,
    usedCreations,
    madeCreations,
    remixedCreations,
    confirmedCreations,
    displayedCreations: confirmedCreations,
    hiddenCreations,
    creationRoles,
    availableCreations,
  };
}

function findDraftLocalToolById(draft, toolToken) {
  const items = [
    ...getDraftSectionItemsByCanonicalId(draft, 'using-tools'),
    ...getDraftSectionItemsByCanonicalId(draft, 'creator-tools'),
  ];
  return items.find((item) => isEditorAddedLocalTool(item) && doesToolMatchToken(item, toolToken)) || null;
}

function removeLocalToolFromDraft(draft, toolToken, sourceTool) {
  const nextDraft = structuredClone(draft);
  const tokens = new Set([
    toolToken,
    sourceTool?.id,
    sourceTool?.name,
    sourceTool?.title,
  ].filter(Boolean).map(normalizeToolToken));
  nextDraft.sections = (nextDraft.sections || []).map((section) => {
    if (!Array.isArray(section?.items)) return section;
    const items = section.items.filter((item) => {
      if (!isEditorAddedLocalTool(item)) return true;
      return !toolTokenMatchesAny(item, tokens);
    });
    return { ...section, items };
  }).filter((section) => !Array.isArray(section?.items) || section.items.length > 0);
  nextDraft.stats = {
    ...(nextDraft.stats || {}),
    displayedToolIds: (nextDraft.stats?.displayedToolIds || []).filter((id) => !tokens.has(normalizeToolToken(id))),
  };
  return refreshBuilderProfileSnapshot(nextDraft);
}

function doesToolMatchToken(tool, toolToken) {
  const normalized = normalizeToolToken(toolToken);
  if (!normalized) return false;
  return toolTokenMatchesAny(tool, new Set([normalized]));
}

function toolTokenMatchesAny(tool, normalizedTokens) {
  const name = tool?.name || tool?.title || '';
  const candidates = [
    tool?.id,
    name,
    `${tool?.source || ''}:${name}`,
    `${tool?.type || tool?.kind || ''}:${name}`,
  ].map(normalizeToolToken).filter(Boolean);
  return candidates.some((candidate) => normalizedTokens.has(candidate));
}

function normalizeToolToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isEditorAddedLocalTool(tool) {
  return tool?.source === 'local-upload' ||
    tool?.sourceKind === 'local_upload' ||
    tool?.source_kind === 'local_upload' ||
    tool?.metadata?.addedFrom === 'creator-editor' ||
    tool?.metadata?.added_from === 'creator-editor' ||
    tool?.ownership === 'owned';
}

function inferMarketplaceCategory(tool) {
  const text = `${tool?.name || tool?.title || ''} ${tool?.description || ''} ${tool?.type || ''}`.toLowerCase();
  if (/image|photo|background|design|icon|visual/.test(text)) return 'design';
  if (/youtube|ebook|write|content|article|blog|transcript/.test(text)) return 'writing-content';
  if (/code|developer|program|github|plugin|mcp/.test(text)) return 'development';
  if (/automat|workflow|agent|action/.test(text)) return 'automation-workflows';
  if (/data|analytic|csv|database|sql/.test(text)) return 'data-analytics';
  if (/audio|video|media|music/.test(text)) return 'media-audio';
  if (/research|paper|study/.test(text)) return 'research';
  return 'productivity';
}

function createInitialLocalListingDraft(tool) {
  const title = cleanPublicDraftText(tool?.name || tool?.title, 120);
  const description = cleanPublicDraftText(tool?.description || tool?.detectedFrom, 220);
  return {
    schemaVersion: 'taku.creator.tool-listing-draft.v1',
    sourceItemId: tool?.id || '',
    updatedAt: new Date().toISOString(),
    status: 'draft',
    listing: normalizeListingDraft({
      title,
      shortDescription: description,
      description,
      category: inferMarketplaceCategory(tool),
      type: tool?.type || tool?.kind || 'skill',
      tags: Array.isArray(tool?.tags) ? tool.tags : [],
      visibility: 'public',
    }),
    technical: {
      name: tool?.name || tool?.title || '',
      type: tool?.type || tool?.kind || '',
      source: tool?.source || '',
      detectedFrom: tool?.detectedFrom || tool?.scanPreview?.detectedFrom || '',
    },
  };
}

function isListingReady(listing, options = {}) {
  return Boolean(
    listing?.title &&
    listing?.shortDescription &&
    listing?.category &&
    listing?.type &&
    (!options.requireIcon || listing?.coverImageUrl)
  );
}

export function pendingLocalToolListingReviews(state) {
  const candidates = [
    ...(state.toolChoices?.displayedTools || []),
    ...getDraftSectionItemsByCanonicalId(state.draft, 'creator-tools'),
    ...getDraftSectionItemsByCanonicalId(state.draft, 'using-tools'),
  ];
  const reviews = [];
  const seen = new Set();
  for (const tool of candidates) {
    if (!isEditorAddedLocalTool(tool)) continue;
    const id = typeof tool?.id === 'string' ? tool.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const listingDraft = state.draft?.listingDrafts?.[id];
    if (listingDraft?.status === 'ready' && isListingReady(listingDraft.listing, { requireIcon: true })) continue;
    reviews.push({
      id,
      name: tool?.name || tool?.title || id,
      status: listingDraft?.status || 'unedited',
      missing: [
        !listingDraft?.listing?.title && 'title',
        !listingDraft?.listing?.shortDescription && 'shortDescription',
        !listingDraft?.listing?.category && 'category',
        !listingDraft?.listing?.coverImageUrl && 'coverImageUrl',
      ].filter(Boolean),
    });
    if (reviews.length >= 3) break;
  }
  return reviews;
}

async function firstExistingFile(candidates) {
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  return '';
}

async function isFile(filePath) {
  const stat = await fs.stat(filePath).catch(() => null);
  return Boolean(stat?.isFile());
}

function cleanLocalText(value, maxLength = 120) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

export function securityHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob: http: https:",
      "font-src 'self' data:",
      "style-src 'unsafe-inline'",
      "script-src 'unsafe-inline'",
      "connect-src 'self' https://api.github.com https://raw.githubusercontent.com",
    ].join('; '),
    ...extra,
  };
}

function editorCookieHeader(token) {
  return `${EDITOR_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=14400`;
}

function sendHtmlResponse(response, html, token) {
  response.writeHead(200, {
    ...securityHeaders({
      ...(token ? { 'Set-Cookie': editorCookieHeader(token) } : {}),
    }),
    'Content-Type': 'text/html; charset=utf-8',
  });
  response.end(html);
}

function sendTextResponse(response, status, text) {
  response.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end(text);
}

function sendJsonResponse(response, value, status = 200) {
  response.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value, null, 2));
}

function sendPngResponse(response, png, filename) {
  response.writeHead(200, {
    ...securityHeaders(),
    'Content-Type': 'image/png',
    'Content-Length': png.byteLength,
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  response.end(png);
}

async function readRequestJson(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error('Request body too large.');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function sanitizeStaxCardSnapshot(value) {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 'taku.stax.card-snapshot.v1') return null;
  const rawCanvas = isRecord(value.canvas) ? value.canvas : {};
  const canvas = {
    width: clampInteger(rawCanvas.width, 320, 2000, 940),
    height: clampInteger(rawCanvas.height, 320, 2000, 796),
    columns: clampInteger(rawCanvas.columns, 1, 16, 8),
    rows: clampInteger(rawCanvas.rows, 1, 16, 6),
    cellSize: clampInteger(rawCanvas.cellSize, 24, 240, 104),
    gap: clampInteger(rawCanvas.gap, 0, 48, 8),
  };
  const blocks = (Array.isArray(value.blocks) ? value.blocks : [])
    .map((block) => {
      if (!isRecord(block)) return null;
      const key = String(block.key || '').trim().toLowerCase();
      if (!/^[a-z0-9_-]{1,40}$/.test(key)) return null;
      const cx = clampInteger(block.cx, 0, canvas.columns - 1, 0);
      const cy = clampInteger(block.cy, 0, canvas.rows - 1, 0);
      const cw = clampInteger(block.cw, 1, canvas.columns, 1);
      const ch = clampInteger(block.ch, 1, canvas.rows, 1);
      if (cx + cw > canvas.columns || cy + ch > canvas.rows) return null;
      return { key, cx, cy, cw, ch };
    })
    .filter(Boolean)
    .slice(0, 32);
  if (!blocks.length || !blocks.some((block) => block.key === 'hero')) return null;
  const imageDataUrl = sanitizePngDataUrl(value.imageDataUrl || value.image_data_url);
  return {
    schemaVersion: 'taku.stax.card-snapshot.v1',
    capturedAt: typeof value.capturedAt === 'string' ? value.capturedAt.slice(0, 80) : new Date().toISOString(),
    canvas,
    blocks,
    ...(imageDataUrl ? { imageDataUrl } : {}),
  };
}

function sanitizePngDataUrl(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (text.length > 4_000_000) return '';
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(text)) return '';
  return text.replace(/\s+/g, '');
}

function applyStaxCardSnapshotToDraft(draft, snapshot) {
  if (!snapshot) return draft;
  const builderProfileSnapshot = isRecord(draft.builderProfileSnapshot)
    ? {
        ...draft.builderProfileSnapshot,
        staxCardSnapshot: snapshot,
      }
    : draft.builderProfileSnapshot;
  return {
    ...draft,
    staxCardSnapshot: snapshot,
    ...(builderProfileSnapshot ? { builderProfileSnapshot } : {}),
  };
}

function sanitizeDownloadFilename(value) {
  const cleaned = String(value || '')
    .replace(/[\r\n"\\/:*?<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
  return cleaned.endsWith('.png') ? cleaned : `${cleaned || 'taku-stax'}.png`;
}

function exportHtmlDocument({ cardHtml, styles, width, height, scale }) {
  const safeStyles = styles.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${safeStyles}</style>
<style>
html,body{margin:0;width:${width * scale}px;height:${height * scale}px;overflow:hidden;background:transparent}
.export-wrap{width:${width}px;height:${height}px;transform:scale(${scale});transform-origin:0 0}
.export-wrap .cardpg{margin:0!important;max-width:none!important;width:${width}px!important;height:${height}px!important;border-radius:0!important;animation:none!important;transform:none!important}
.export-wrap .cardpg::before{border-radius:0!important}
</style>
</head>
<body><div class="export-wrap">${cardHtml}</div></body>
</html>`;
}

async function renderExportPngWithChrome({ cardHtml, styles, width, height, scale }) {
  const chromePath = await findChromeExecutable();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-stax-export-'));
  const htmlPath = path.join(tempDir, 'export.html');
  const pngPath = path.join(tempDir, 'export.png');
  try {
    await fs.writeFile(htmlPath, exportHtmlDocument({ cardHtml, styles, width, height, scale }), 'utf8');
    await runChromeScreenshot({
      chromePath,
      htmlPath,
      pngPath,
      width: width * scale,
      height: height * scale,
    });
    return await fs.readFile(pngPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'google-chrome',
    'chromium',
    'chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) return candidate;
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next known browser path.
    }
  }
  throw new Error('Chrome is required to export PNG from this local preview.');
}

async function runChromeScreenshot({ chromePath, htmlPath, pngPath, width, height }) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    `--window-size=${width},${height}`,
    `--screenshot=${pngPath}`,
    pathToFileURL(htmlPath).href,
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('PNG export timed out.'));
    }, EXPORT_PNG_TIMEOUT_MS);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `PNG export failed with Chrome exit ${code}.`));
    });
  });
}

function normalizePublishedStaxResult(value, siteUrl = '') {
  const root = isRecord(value) ? value : {};
  const data = isRecord(root.data?.data)
    ? root.data.data
    : isRecord(root.data)
      ? root.data
      : root;
  const card = isRecord(data.card) ? data.card : data;
  const links = isRecord(data.links) ? data.links : {};
  const username = cleanPublicDraftText(card.username || data.username || card.handle || data.handle, 120);
  const explicitStaxCardPageUrl = firstPublicStaxString(
    data.staxCardPageUrl,
    data.staxCardShareUrl,
    links.staxCardPageUrl,
    links.staxCardShareUrl,
    card.staxCardPageUrl,
    card.staxCardShareUrl,
    root.staxCardPageUrl,
    root.staxCardShareUrl,
    isRecord(root.links) ? root.links.staxCardPageUrl : '',
    isRecord(root.links) ? root.links.staxCardShareUrl : '',
  );
  const explicitProfilePageUrl = firstPublicStaxString(
    data.profilePageUrl,
    data.creatorPageUrl,
    data.publicUrl,
    links.profilePageUrl,
    links.creatorPageUrl,
    card.profilePageUrl,
    card.creatorPageUrl,
    card.publicUrl,
    root.profilePageUrl,
    root.creatorPageUrl,
    root.publicUrl,
    isRecord(root.links) ? root.links.profilePageUrl : '',
    isRecord(root.links) ? root.links.creatorPageUrl : '',
  );
  const profilePageUrl = username
    ? buildStaxProfilePageUrl(siteUrl, username)
    : explicitProfilePageUrl;
  const staxCardPageUrl = username
    ? buildStaxCardPageUrl(siteUrl, username)
    : explicitStaxCardPageUrl;
  const isPublished = Boolean(
    data.published === true ||
    data.isPublished === true ||
    data.is_published === true ||
    card.published === true ||
    card.isPublished === true ||
    card.is_published === true ||
    (root.ok === true && (profilePageUrl || staxCardPageUrl)),
  );
  const published = Boolean(isPublished && (staxCardPageUrl || profilePageUrl));
  return {
    published,
    publicUrl: published ? profilePageUrl : '',
    profilePageUrl: published ? profilePageUrl : '',
    creatorPageUrl: published ? profilePageUrl : '',
    staxCardPageUrl: published ? staxCardPageUrl : '',
    staxCardShareUrl: published ? staxCardPageUrl : '',
    staxCardImageUrl: published ? firstPublicStaxString(
      data.staxCardImageUrl,
      links.staxCardImageUrl,
      card.staxCardImageUrl,
      root.staxCardImageUrl,
    ) : '',
    cardId: published ? cleanPublicDraftText(card.id || data.cardId || data.card_id, 120) : '',
    username: published ? username : '',
  };
}

function firstPublicStaxString(...values) {
  for (const value of values) {
    const text = cleanPublicDraftText(value, 800);
    if (text) return text;
  }
  return '';
}

function cleanShareChannel(value) {
  const text = cleanPublicDraftText(value, 80).toLowerCase();
  if (!text) return '';
  return text.replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

function hasValidEditorAuth(request, requestUrl, token) {
  if (requestUrl.searchParams.get('token') === token) return true;
  return readCookie(request, EDITOR_COOKIE_NAME) === token;
}

function readCookie(request, name) {
  const cookie = String(request.headers.cookie || '');
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rawValue.join('=') || '');
      } catch {
        return '';
      }
    }
  }
  return '';
}

function isUnsafeEditorMutation(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method || '')) return false;
  const origin = request.headers.origin;
  const hostHeader = request.headers.host;
  if (origin) {
    try {
      return new URL(origin).host !== hostHeader;
    } catch {
      return true;
    }
  }
  const fetchSite = String(request.headers['sec-fetch-site'] || '').toLowerCase();
  return Boolean(fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none');
}

function findToolChoiceById(toolChoices, toolId) {
  for (const group of ['displayedTools', 'hiddenTools', 'availableTools']) {
    const items = Array.isArray(toolChoices?.[group]) ? toolChoices[group] : [];
    const found = items.find((item) => item?.id === toolId);
    if (found) return found;
  }
  return null;
}

function normalizeListingDraft(value) {
  const input = isRecord(value) ? value : {};
  const tags = Array.isArray(input.tags)
    ? input.tags
    : String(input.tags || '').split(',');
  const examples = Array.isArray(input.examples)
    ? input.examples
    : String(input.examples || '').split(/\n+/);
  const additionalCategories = Array.isArray(input.additionalCategories)
    ? input.additionalCategories
    : Array.isArray(input.additional_categories)
      ? input.additional_categories
      : [];
  return {
    title: cleanPublicDraftText(input.title, 120),
    shortDescription: cleanPublicDraftText(input.shortDescription || input.short_description, 220),
    description: cleanPublicDraftText(input.description, 1200),
    coverImageUrl: cleanPublicDraftText(input.coverImageUrl || input.cover_image_url, 500),
    category: cleanPublicDraftText(input.category, 80),
    additionalCategories: additionalCategories
      .map((category) => cleanPublicDraftText(category, 80))
      .filter(Boolean)
      .slice(0, 3),
    type: cleanPublicDraftText(input.type, 80),
    tags: tags.map((tag) => cleanPublicDraftText(tag, 40)).filter(Boolean).slice(0, 8),
    examples: examples.map((example) => cleanPublicDraftText(example, 180)).filter(Boolean).slice(0, 5),
    visibility: ['draft', 'public', 'unlisted'].includes(input.visibility) ? input.visibility : 'draft',
  };
}

async function fetchListingIconGenerate({ workerUrl, token, payload }) {
  const request = {
    method: 'POST',
    body: JSON.stringify(payload),
  };
  const client = createTakuStaxClient({ workerUrl, token });
  try {
    const result = await client.fetchJson(LISTING_ICON_GENERATE_PATH, request, {
      timeoutMs: ICON_GENERATE_TIMEOUT_MS,
    });
    if (isTransientIconWorkerResult(result)) {
      await sleep(900);
      return await client.fetchJson(LISTING_ICON_GENERATE_PATH, request, {
        timeoutMs: ICON_GENERATE_TIMEOUT_MS,
      });
    }
    return result;
  } catch (error) {
    if (!looksLikeProxyTlsDisconnect(error)) throw error;
    const directClient = createTakuStaxClient({
      workerUrl,
      token,
      fetchImpl: fetch,
    });
    return await directClient.fetchJson(LISTING_ICON_GENERATE_PATH, request, {
      timeoutMs: ICON_GENERATE_TIMEOUT_MS,
    });
  }
}

async function redeemLocalAuthCode({ workerUrl, code, state, codeVerifier }) {
  const request = {
    method: 'POST',
    body: JSON.stringify({
      code,
      state,
      codeVerifier,
      intent: 'publish_stax_card',
    }),
  };
  const client = createTakuStaxClient({ workerUrl });
  try {
    return await client.fetchJson(LOCAL_AUTH_REDEEM_PATH, request, {
      timeoutMs: ICON_GENERATE_TIMEOUT_MS,
      token: null,
    });
  } catch (error) {
    if (!looksLikeProxyTlsDisconnect(error)) throw error;
    const directClient = createTakuStaxClient({
      workerUrl,
      fetchImpl: fetch,
    });
    return await directClient.fetchJson(LOCAL_AUTH_REDEEM_PATH, request, {
      timeoutMs: ICON_GENERATE_TIMEOUT_MS,
      token: null,
    });
  }
}

function buildListingIconGeneratePayload({ draft, tool, toolId, listing }) {
  const title = listing.title || cleanPublicDraftText(tool?.name || tool?.title, 120) || 'Untitled tool';
  const description = listing.shortDescription || listing.description || cleanPublicDraftText(tool?.description, 220);
  const type = listing.type || cleanPublicDraftText(tool?.type || tool?.kind, 80) || 'Tool';
  const category = listing.category || cleanPublicDraftText(tool?.category, 80);
  const tags = listing.tags.length ? listing.tags : cleanStringList(tool?.tags, 8, 40);
  const capability = {
    id: toolId,
    name: title,
    title,
    description,
    kind: type,
    type,
    source: cleanPublicDraftText(tool?.source, 80),
    detectedFrom: cleanPublicDraftText(tool?.detectedFrom || tool?.scanPreview?.detectedFrom, 120),
    category,
    tags,
    installability: tool?.installability || tool?.availability || 'reference-only',
    communityTitle: title,
    communityDescription: description,
    communityDisplayKind: type,
    communityCategory: category,
    communityTags: tags,
  };
  return {
    repoFullName: cleanPublicDraftText(tool?.repoFullName || tool?.metadata?.repoFullName || tool?.metadata?.repo_full_name, 160),
    repo: {
      fullName: cleanPublicDraftText(tool?.repoFullName || tool?.metadata?.repoFullName || tool?.metadata?.repo_full_name, 160),
      name: cleanPublicDraftText(tool?.name || tool?.title || title, 120),
      description,
      topics: tags,
    },
    capabilities: [capability],
    summary: {
      installableCount: type.toLowerCase() === 'skill' ? 1 : 0,
      referenceOnlyCount: type.toLowerCase() === 'skill' ? 0 : 1,
      metadataCount: 0,
      needsSetupCount: 0,
      deferredCount: 0,
      unsupportedCount: 0,
    },
    draft: {
      title,
      description,
      usageExample: listing.examples.join('\n'),
      sourceLabel: cleanPublicDraftText(tool?.source || tool?.platformLabel, 80),
      itemType: type,
      category,
      tags,
      creatorPersona: cleanPublicDraftText(draft?.personaV2?.archetype?.title || draft?.personaV2?.name, 120),
    },
  };
}

function normalizeGeneratedIconPayload(payload) {
  const root = isRecord(payload) ? payload : {};
  const icon = isRecord(root.icon)
    ? root.icon
    : isRecord(root.data)
      ? root.data
      : root;
  const imageUrl = cleanImageUrl(icon.imageUrl || icon.image_url);
  if (!imageUrl) {
    throw new Error('Icon generation response did not include an image URL.');
  }
  return {
    imageUrl,
    imageName: cleanPublicDraftText(icon.imageName || icon.image_name, 120) || 'icon.png',
    styleName: cleanPublicDraftText(icon.styleName || icon.style_name, 80),
    layoutName: cleanPublicDraftText(icon.layoutName || icon.layout_name, 80),
    aspectRatio: cleanPublicDraftText(icon.aspectRatio || icon.aspect_ratio, 40),
    seed: cleanPublicDraftText(icon.seed, 80),
    subject: cleanPublicDraftText(icon.subject, 120),
    model: cleanPublicDraftText(icon.model, 80),
  };
}

function cleanImageUrl(value) {
  const text = cleanPublicDraftText(value, 700);
  return /^https?:\/\//i.test(text) || /^data:image\//i.test(text) ? text : '';
}

function cleanStringList(value, limit, max) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,;\n]+/);
  const seen = new Set();
  const output = [];
  for (const item of raw) {
    const clean = cleanPublicDraftText(item, max);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= limit) break;
  }
  return output;
}

function workerJsonError(result) {
  const data = isRecord(result?.data) ? result.data : {};
  return cleanPublicDraftText(data.error || data.message, 500);
}

function isTransientIconWorkerResult(result) {
  const status = Number(result?.response?.status || 0);
  if (status !== 500 && status !== 502 && status !== 503 && status !== 504) return false;
  return looksLikeProxyTlsDisconnect(workerJsonError(result));
}

function looksLikeProxyTlsDisconnect(error) {
  const message = String(error?.message || error || '');
  return /ECONNRESET|connection reset|socket hang up|tls connection|socket disconnected|client network socket|proxy|tunnel/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function iconNetworkErrorMessage(error) {
  const message = String(error?.message || error || '').trim();
  if (looksLikeProxyTlsDisconnect(error)) {
    return (
      'Could not reach Taku Worker to generate the icon. The local proxy/TLS connection was interrupted. ' +
      'If you use a proxy on localhost:7890, restart it or temporarily clear http_proxy/https_proxy before starting this editor. ' +
      (message ? `Original error: ${message}` : '')
    ).trim();
  }
  return message || 'Could not reach Taku Worker to generate the icon.';
}

function isPublishAuthFailure(status, data = {}) {
  if (status === 401) return true;
  if (status !== 403) return false;
  const message = String(data?.error || data?.message || '').toLowerCase();
  if (!message) return true;
  if (/(credit|quota|balance|billing)/i.test(message)) return false;
  return /(auth|token|jwt|login|sign in|unauthori[sz]ed|forbidden|permission)/i.test(message);
}

function isStaxAuthErrorMessage(message) {
  return /(auth|token|jwt|login|sign in|unauthori[sz]ed|forbidden|permission|401|403)/i.test(String(message || ''));
}

function cleanPublicDraftText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) : text;
}
