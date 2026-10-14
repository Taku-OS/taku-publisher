import { DEFAULT_SITE_URL, isLocalSiteUrl, trimUrl } from './publish-config.mjs';
import { cleanText } from './privacy.mjs';
export { STAX_CREATOR_PUBLISH_CONTRACT_VERSION } from './publish-config.mjs';

export function normalizeStaxPublicSiteOrigin(siteUrl) {
  const trimmed = trimUrl(siteUrl || DEFAULT_SITE_URL) || DEFAULT_SITE_URL;
  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, '');
    if (pathname === '/stax') {
      url.pathname = '';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    return trimmed.replace(/\/stax$/i, '');
  }
  return trimmed.replace(/\/stax$/i, '');
}

export function buildStaxProfilePageUrl(siteUrl, username) {
  const slug = cleanText(username, 160);
  if (!slug) return '';
  return `${normalizeStaxPublicSiteOrigin(siteUrl)}/profile/${encodeURIComponent(slug)}`;
}

// Kept as a compatibility alias for older publisher responses.
export function buildStaxCreatorPageUrl(siteUrl, username) {
  return buildStaxProfilePageUrl(siteUrl, username);
}

export function buildStaxCardPageUrl(siteUrl, username) {
  const slug = cleanText(username, 160);
  if (!slug) return '';
  return `${normalizeStaxPublicSiteOrigin(siteUrl)}/stax/${encodeURIComponent(slug)}`;
}

export function buildStaxOgImageUrl(siteUrl, username) {
  const slug = cleanText(username, 160);
  if (!slug) return '';
  return `${normalizeStaxPublicSiteOrigin(siteUrl)}/api/og/stax/${encodeURIComponent(slug)}`;
}

export function buildStaxStudioUrl(siteUrl, options = {}) {
  const url = new URL('/studio/stax-card', `${normalizeStaxPublicSiteOrigin(siteUrl)}/`);
  const launchContextId = cleanText(
    options.launchContextId || options.launch_context_id,
    240,
  );
  if (launchContextId) url.searchParams.set('launch', launchContextId);
  if (options.challengeHandoff === true) url.searchParams.set('afterPublish', 'challenge');
  return url.toString();
}

export function resolveStaxStudioUrl(siteUrl, workerStudioUrl, options = {}) {
  const previewOrigin = String(siteUrl || '').replace(/\/+$/, '') === 'https://codex-stax-page-taku-landing-page.takuos.workers.dev';
  if (!isLocalSiteUrl(siteUrl) && !previewOrigin) {
    return workerStudioUrl || buildStaxStudioUrl(siteUrl, options);
  }
  // A local frontend must keep using the configured origin even when its
  // real-data Worker returns a production editor URL. Carry only the launch ID.
  let launchContextId = options.launchContextId || options.launch_context_id;
  if (!launchContextId && workerStudioUrl) {
    try {
      launchContextId = new URL(workerStudioUrl).searchParams.get('launch');
    } catch {}
  }
  return buildStaxStudioUrl(siteUrl, { launchContextId });
}

export function buildStaxChallengeReviewUrl(siteUrl, options = {}) {
  const url = new URL('/stax', `${normalizeStaxPublicSiteOrigin(siteUrl)}/`);
  url.searchParams.set('review', '1');
  const launchContextId = cleanText(
    options.launchContextId || options.launch_context_id,
    240,
  );
  if (launchContextId) url.searchParams.set('launch', launchContextId);
  return url.toString();
}

export function buildStaxPublishedLinks(siteUrl, resultData) {
  const slug = cleanText(resultData?.username || resultData?.card?.username, 160);
  const profilePageUrl = slug
    ? buildStaxProfilePageUrl(siteUrl, slug)
    : resultData?.profilePageUrl || resultData?.creatorPageUrl || resultData?.publicUrl || resultData?.card?.profilePageUrl || resultData?.card?.creatorPageUrl || resultData?.card?.publicUrl;
  const staxCardPageUrl = slug
    ? buildStaxCardPageUrl(siteUrl, slug)
    : resultData?.staxCardPageUrl || resultData?.staxCardShareUrl || resultData?.card?.staxCardPageUrl || resultData?.card?.staxCardShareUrl;
  const staxCardImageUrl = slug
    ? buildStaxOgImageUrl(siteUrl, slug)
    : resultData?.staxCardImageUrl || resultData?.card?.staxCardImageUrl;
  const studioUrl = resolveStaxStudioUrl(siteUrl, resultData?.studioUrl || resultData?.studio_url);
  return {
    ...(slug ? { slug } : {}),
    ...(profilePageUrl ? { profilePageUrl, creatorPageUrl: profilePageUrl } : {}),
    ...(staxCardPageUrl ? { staxCardPageUrl, staxCardShareUrl: staxCardPageUrl } : {}),
    ...(staxCardImageUrl ? { staxCardImageUrl } : {}),
    ...(studioUrl ? { studioUrl } : {}),
  };
}
