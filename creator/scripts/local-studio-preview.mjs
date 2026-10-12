import { createStaxStudioRendererPayload } from './editor-renderer.mjs';

export const LOCAL_STUDIO_PREVIEW_SCHEMA = 'taku.stax.local-studio-preview.v1';
export const DEFAULT_LOCAL_STUDIO_PREVIEW_URL = 'http://127.0.0.1:3003';

export function localStudioPreviewOrigin(value = DEFAULT_LOCAL_STUDIO_PREVIEW_URL) {
  const url = new URL(value || DEFAULT_LOCAL_STUDIO_PREVIEW_URL);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !['/', '/studio-preview'].includes(url.pathname)) {
    throw new Error('Local Studio preview must use an HTTP localhost address.');
  }
  return url.origin;
}

export async function sendLocalStudioPreview(draftResult, previewUrl) {
  const origin = localStudioPreviewOrigin(previewUrl);
  const profile = draftResult.draft.staxProfile || draftResult.draft.serverStaxProfile;
  const renderer = createStaxStudioRendererPayload(draftResult.draft, {
    editor: { publish: { authenticated: Boolean(profile && Object.keys(profile).length), canPublish: false } },
  });
  // Send only the existing display model, never the raw scan/private inventory
  // or Publisher credentials. All editing in this preview stays in memory.
  renderer.model.canPublish = false;
  renderer.model.loginUrl = '';
  renderer.model.auth = { ...renderer.model.auth, loginUrl: '' };
  let response;
  try {
    response = await fetch(new URL('/api/studio-preview', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: LOCAL_STUDIO_PREVIEW_SCHEMA, renderer }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(`Start the local Studio preview server at ${origin}, then retry. Your local draft is kept.`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error || 'The local Studio preview could not accept the draft.');
  }
  const editor = new URL(payload.editorUrl, origin);
  if (editor.origin !== origin || editor.pathname !== '/studio-preview'
    || editor.username || editor.password || editor.hash
    || editor.searchParams.get('mode') !== 'publisher' || !editor.searchParams.get('session')) {
    throw new Error('The local Studio preview returned an invalid page address.');
  }
  return {
    ok: true,
    schemaVersion: 'taku.creator.editor-result.v1',
    editorUrl: editor.toString(),
    localStudioPreview: true,
    canPublish: false,
    draftPath: draftResult.draftPath,
    tokenLabel: renderer.model.tokenLabel,
    usageLabel: renderer.model.usageLabel,
    message: 'Your real scan is ready in the local Studio preview. Changes stay in this browser session.',
  };
}
