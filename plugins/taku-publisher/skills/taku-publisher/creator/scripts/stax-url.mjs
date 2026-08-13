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

export function buildStaxCreatorPageUrl(siteUrl, username) {
  const slug = cleanText(username, 160);
  if (!slug) return '';
  return `${normalizeStaxPublicSiteOrigin(siteUrl)}/stax/${encodeURIComponent(slug)}`;
}

export function buildStaxOgImageUrl(siteUrl, username) {
  const slug = cleanText(username, 160);
  if (!slug) return '';
  return `${normalizeStaxPublicSiteOrigin(siteUrl)}/api/og/stax/${encodeURIComponent(slug)}`;
}

export function buildStaxPublishedLinks(siteUrl, resultData) {
  const slug = cleanText(resultData?.username || resultData?.card?.username, 160);
  const creatorPageUrl = slug
    ? buildStaxCreatorPageUrl(siteUrl, slug)
    : resultData?.creatorPageUrl || resultData?.publicUrl || resultData?.card?.creatorPageUrl || resultData?.card?.publicUrl;
  const staxCardImageUrl = slug
    ? buildStaxOgImageUrl(siteUrl, slug)
    : resultData?.staxCardImageUrl || resultData?.card?.staxCardImageUrl;
  return {
    ...(slug ? { slug } : {}),
    ...(creatorPageUrl ? { creatorPageUrl } : {}),
    ...(staxCardImageUrl ? { staxCardImageUrl } : {}),
  };
}
