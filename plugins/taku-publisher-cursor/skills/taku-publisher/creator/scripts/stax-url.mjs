import { DEFAULT_SITE_URL, trimUrl } from './publish-config.mjs';
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
  const studioUrl = resultData?.studioUrl || resultData?.studio_url || buildStaxStudioUrl(siteUrl);
  return {
    ...(slug ? { slug } : {}),
    ...(profilePageUrl ? { profilePageUrl, creatorPageUrl: profilePageUrl } : {}),
    ...(staxCardPageUrl ? { staxCardPageUrl, staxCardShareUrl: staxCardPageUrl } : {}),
    ...(staxCardImageUrl ? { staxCardImageUrl } : {}),
    ...(studioUrl ? { studioUrl } : {}),
  };
}
