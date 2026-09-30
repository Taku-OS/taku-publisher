import { isRecord } from './util.js';

const RESPONSE_LIMIT = 64 * 1024;

export async function readBoundedResponse(response: Response): Promise<{ value: unknown; summary: string }> {
  if (!response.body) return { value: undefined, summary: '' };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  const limit = response.ok ? 1024 * 1024 : RESPONSE_LIMIT;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - size;
      chunks.push(value.subarray(0, remaining));
      size += Math.min(value.byteLength, remaining);
      if (value.byteLength > remaining) { truncated = true; await reader.cancel(); break; }
    }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString('utf8');
  let value: unknown;
  try { if (!truncated) value = JSON.parse(text); } catch { /* Non-JSON error pages are diagnostic evidence. */ }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
  const summary = sanitizeDiagnostic(title ?? text);
  return { value, summary: truncated ? `${summary.slice(0, 498)} [truncated]` : summary };
}

export function sanitizeDiagnostic(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:Bearer\s+)?taku_(?:pub|refresh|su)_[A-Za-z0-9_-]+/gi, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|authorization)["']?\s*[:=]\s*)["']?[^\s,"'<}]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]+/gi, '$1?[redacted]')
    .replace(/\s+/g, ' ').trim().slice(0, 512);
}

export function responseErrorDetails(response: Response, value: unknown, summary: string) {
  const rawCode = isRecord(value) ? value.code ?? value.error ?? value.server_error : undefined;
  const code = typeof rawCode === 'string' ? sanitizeDiagnostic(rawCode).slice(0, 128) : 'SITES_REQUEST_FAILED';
  const requestId = response.headers.get('x-request-id') ??
    (isRecord(value) ? value.requestId ?? value.request_id : undefined);
  return {
    http_status: response.status,
    server_error: code || 'SITES_REQUEST_FAILED',
    request_id: typeof requestId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(requestId)
      ? sanitizeDiagnostic(requestId) : null,
    response_summary: summary,
  };
}
