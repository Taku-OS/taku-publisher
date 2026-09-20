import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import {
  decodeTakuAgentBase64Url,
  parseTakuAgentHostAttestationVerification,
  serializeTakuAgentHostAttestationPayload,
} from '@/lib/taku-runtime/contract';
import {
  TAKU_AGENT_HOST_ATTESTATION_MAX_TTL_MS,
  TAKU_AGENT_SESSION_MAX_TTL_MS,
  type TakuAgentHostAttestationVerification,
} from '@/lib/taku-runtime/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 4_096;
const MAX_CONSUMED_ATTESTATIONS = 1_024;
const consumedProofs = new Map<string, number>();
const consumedNonces = new Map<string, number>();

function verificationResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function rejected(status = 401): Response {
  return verificationResponse({ verified: false }, status);
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function pruneExpired(now: number): void {
  for (const [proof, expiresAt] of consumedProofs) {
    if (expiresAt <= now) consumedProofs.delete(proof);
  }
  for (const [nonce, expiresAt] of consumedNonces) {
    if (expiresAt <= now) consumedNonces.delete(nonce);
  }
}

function proofsMatch(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected, 'base64url');
  const receivedBytes = Buffer.from(received, 'base64url');
  return (
    expectedBytes.byteLength === receivedBytes.byteLength &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

function requestHasTrustedSameOriginMetadata(request: Request): boolean {
  let requestUrl: URL;
  let originUrl: URL;
  try {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    if (!origin || !host || host !== host.trim() || host.includes(',') || /\s/.test(host)) {
      return false;
    }
    requestUrl = new URL(request.url);
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  return (
    requestUrl.protocol === 'http:' &&
    originUrl.protocol === 'http:' &&
    originUrl.hostname === '127.0.0.1' &&
    originUrl.port.length > 0 &&
    requestUrl.port === originUrl.port &&
    request.headers.get('origin') === originUrl.origin &&
    request.headers.get('host') === originUrl.host &&
    request.headers.get('sec-fetch-site') === 'same-origin' &&
    request.headers.get('sec-fetch-mode') === 'cors' &&
    request.headers.get('sec-fetch-dest') === 'empty'
  );
}

function deriveSessionKey(
  controlToken: string,
  input: TakuAgentHostAttestationVerification,
  direction: 'c2h' | 'h2c'
): string {
  const info = JSON.stringify([
    'taku.agent.session/v1',
    input.protocol,
    input.requestId,
    input.clientNonce,
    input.frameEpoch,
    input.runtimeInstanceId,
    input.sessionId,
    input.capabilitiesDigest,
    input.sessionExpiresAt,
    direction,
  ]);
  const key = hkdfSync(
    'sha256',
    Buffer.from(controlToken, 'utf8'),
    Buffer.from(decodeTakuAgentBase64Url(input.clientNonce)),
    Buffer.from(info, 'utf8'),
    32
  );
  return Buffer.from(key).toString('base64url');
}

export async function POST(request: Request): Promise<Response> {
  const controlToken = process.env.TAKU_CONTROL_TOKEN;
  const applicationInstanceId = process.env.TAKU_APPLICATION_INSTANCE_ID;
  if (!controlToken || !applicationInstanceId) return rejected(503);
  if (
    !requestHasTrustedSameOriginMetadata(request) ||
    request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !==
      'application/json'
  ) {
    return rejected();
  }

  const rawBody = await readBoundedBody(request);
  if (rawBody === null) return rejected();

  let rawInput: unknown;
  try {
    rawInput = JSON.parse(rawBody);
  } catch {
    return rejected();
  }
  const input = parseTakuAgentHostAttestationVerification(rawInput);
  if (
    !input ||
    input.runtimeInstanceId !== applicationInstanceId ||
    request.headers.get('x-taku-agent-session') !== input.sessionId
  ) {
    return rejected();
  }

  const now = Date.now();
  pruneExpired(now);
  if (
    input.proofExpiresAt <= now ||
    input.proofExpiresAt - now > TAKU_AGENT_HOST_ATTESTATION_MAX_TTL_MS ||
    input.sessionExpiresAt <= input.proofExpiresAt ||
    input.sessionExpiresAt - now > TAKU_AGENT_SESSION_MAX_TTL_MS ||
    consumedProofs.has(input.proof) ||
    consumedNonces.has(input.clientNonce) ||
    consumedProofs.size >= MAX_CONSUMED_ATTESTATIONS ||
    consumedNonces.size >= MAX_CONSUMED_ATTESTATIONS
  ) {
    return rejected();
  }

  const expectedProof = createHmac('sha256', controlToken)
    .update(serializeTakuAgentHostAttestationPayload(input))
    .digest('base64url');
  if (!proofsMatch(expectedProof, input.proof)) return rejected();

  const c2hKey = deriveSessionKey(controlToken, input, 'c2h');
  const h2cKey = deriveSessionKey(controlToken, input, 'h2c');

  // This process consumes one bootstrap exactly once. There is deliberately no
  // await between the replay check and these writes.
  consumedProofs.set(input.proof, input.sessionExpiresAt);
  consumedNonces.set(input.clientNonce, input.sessionExpiresAt);
  return verificationResponse(
    {
      verified: true,
      sessionId: input.sessionId,
      sessionExpiresAt: input.sessionExpiresAt,
      c2hKey,
      h2cKey,
    },
    200
  );
}

export function OPTIONS(): Response {
  return rejected(405);
}
