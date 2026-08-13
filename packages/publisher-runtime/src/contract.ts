export const TAKU_PUBLISHER_CONTRACT_VERSION = 'taku.publisher-contract.v1';
export const PUBLISHER_DRAFTS_PATH = '/stax/publisher/drafts';

export function publisherDraftFromItemPath(): string {
  return `${PUBLISHER_DRAFTS_PATH}/from-item`;
}

export function publisherDraftPath(draftId: string): string {
  return `${PUBLISHER_DRAFTS_PATH}/${requiredSegment(draftId, 'draft ID')}`;
}

export function publisherDraftScanReportPath(draftId: string): string {
  return `${publisherDraftPath(draftId)}/scan-report`;
}

export function publisherDraftArtifactPresignPath(draftId: string): string {
  return `${publisherDraftPath(draftId)}/artifacts/presign`;
}

export function publisherDraftArtifactCompletePath(
  draftId: string,
  artifactId: string,
): string {
  return `${publisherDraftPath(draftId)}/artifacts/${requiredSegment(artifactId, 'artifact ID')}/complete`;
}

export function publisherDraftSubmitPath(draftId: string): string {
  return `${publisherDraftPath(draftId)}/submit`;
}

export function publisherDraftStatusPath(draftId: string): string {
  return `${publisherDraftPath(draftId)}/status`;
}

function requiredSegment(value: string, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`Publisher ${label} is required.`);
  return encodeURIComponent(normalized);
}
