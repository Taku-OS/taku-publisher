import { DEFAULT_SITE_URL } from './browser-auth.js';
import type { JsonObject } from './types.js';
import { isRecord, jsonOutput, PublisherError } from './util.js';

const LEGAL_CODES = new Set([
  'REGISTRATION_REQUIRED',
  'LEGAL_ACCEPTANCE_REQUIRED',
  'PUBLISHER_LEGAL_REVIEW_REQUIRED',
]);
const DOCUMENTS = ['service', 'publisher', 'marketplace'];

/** Interpret only the legal gate contract. Never follow response-supplied URLs. */
export function legalReviewAction(
  status: number,
  data: unknown,
  apiPath = '',
  siteUrl = process.env.TAKU_SITE_URL || DEFAULT_SITE_URL,
): JsonObject | null {
  if (status !== 428 || !isRecord(data) || typeof data.error !== 'string' || !LEGAL_CODES.has(data.error)) return null;
  const site = new URL(siteUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname);
  if (site.username || site.password || (site.protocol !== 'https:' && !(site.protocol === 'http:' && local))) {
    throw new PublisherError('Configure a trusted HTTPS Taku site URL (or loopback for local testing).', 'invalid_site_url');
  }
  const documents = DOCUMENTS.filter(id => Array.isArray(data.documents) && data.documents.includes(id));
  const artifactReview = data.error === 'PUBLISHER_LEGAL_REVIEW_REQUIRED';
  const draft = /^\/stax\/publisher\/drafts\/([A-Za-z0-9_-]+)\/submit$/.exec(apiPath);
  const url = new URL(artifactReview && draft ? `/publish/${draft[1]}` : '/legal/accept', site.origin);
  if (!artifactReview && documents.length) url.searchParams.set('documents', documents.join(','));
  const message = artifactReview
    ? 'Open the saved draft in Taku Web with the same account. Review the current artifact, Publisher Terms, and distribution license there. Return here to check its status; do not resubmit it automatically.'
    : 'Open the review URL, sign in with the same Taku account, and complete registration or review the required terms yourself. Then return here to continue the interrupted command. Your local draft has been kept.';
  return {
    ok: false,
    status: 'legal_review_required',
    requires_action: true,
    action_type: 'review_legal_terms',
    needsAuth: false,
    legal_code: data.error,
    http_status: status,
    review_url: url.toString(),
    documents,
    message,
  };
}

export function publisherErrorOutput(error: PublisherError) {
  return jsonOutput(error.code === 'legal_review_required' ? 'legal_review_required' : 'error', {
    ...(error.code === 'legal_review_required' ? error.details : {}),
    error: { code: error.code, message: error.message, details: error.details },
  }, { ok: false });
}
