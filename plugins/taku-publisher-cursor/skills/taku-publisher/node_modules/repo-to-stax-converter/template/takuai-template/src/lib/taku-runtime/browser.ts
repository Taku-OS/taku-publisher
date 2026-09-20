'use client';

import {
  TakuAgentClient,
  type TakuAgentMessageTransport,
  type TakuAgentTransportEvent,
} from './client';
import type { TakuAgentSessionAuthenticator } from './crypto';
import { importTakuAgentSessionAuthenticator } from './crypto';
import type { TakuAgentClientMessage } from './types';
import {
  TAKU_AGENT_HOST_ATTESTATION_VERIFY_PATH,
  type TakuAgentHostAttestationVerification,
  type TakuAgentHostSessionMaterial,
} from './types';

const MAX_ATTESTATION_RESPONSE_BYTES = 1_024;

export async function verifyTakuAgentHostAttestation(
  input: TakuAgentHostAttestationVerification,
  signal: AbortSignal
): Promise<TakuAgentSessionAuthenticator | null> {
  try {
    const response = await fetch(TAKU_AGENT_HOST_ATTESTATION_VERIFY_PATH, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-taku-agent-session': input.sessionId,
      },
      body: JSON.stringify(input),
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal,
    });
    if (!response.ok) return null;
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTESTATION_RESPONSE_BYTES) {
      return null;
    }
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_ATTESTATION_RESPONSE_BYTES) return null;
    const result = JSON.parse(raw) as unknown;
    const material = parseSessionMaterial(result, input);
    return material ? await importTakuAgentSessionAuthenticator(material) : null;
  } catch {
    return null;
  }
}

function parseSessionMaterial(
  value: unknown,
  input: TakuAgentHostAttestationVerification
): TakuAgentHostSessionMaterial | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = ['verified', 'sessionId', 'sessionExpiresAt', 'c2hKey', 'h2cKey'];
  if (
    Object.keys(record).length !== keys.length ||
    !Object.keys(record).every((key) => keys.includes(key)) ||
    record.verified !== true ||
    record.sessionId !== input.sessionId ||
    record.sessionExpiresAt !== input.sessionExpiresAt ||
    typeof record.c2hKey !== 'string' ||
    typeof record.h2cKey !== 'string' ||
    input.sessionExpiresAt <= Date.now()
  ) {
    return null;
  }
  return {
    verified: true,
    sessionId: input.sessionId,
    sessionExpiresAt: input.sessionExpiresAt,
    c2hKey: record.c2hKey,
    h2cKey: record.h2cKey,
  };
}

function createBrowserTransport(): TakuAgentMessageTransport {
  const browserWindow = typeof window === 'undefined' ? null : window;
  const parentWindow = browserWindow?.parent ?? null;
  const available = Boolean(browserWindow && parentWindow && parentWindow !== browserWindow);
  let targetOrigin = '*';

  return {
    available,
    post(message: TakuAgentClientMessage) {
      if (!available || !parentWindow) throw new Error('Taku Agent Host is unavailable');
      parentWindow.postMessage(message, targetOrigin);
    },
    listen(listener: (event: TakuAgentTransportEvent) => void) {
      if (!available || !browserWindow || !parentWindow) return () => {};
      const onMessage = (event: MessageEvent) => {
        if (event.source !== parentWindow) return;
        listener({ data: event.data, origin: event.origin });
      };
      browserWindow.addEventListener('message', onMessage);
      return () => browserWindow.removeEventListener('message', onMessage);
    },
    verifyHostAttestation: verifyTakuAgentHostAttestation,
    bindHostOrigin(origin: string | null) {
      targetOrigin = getTakuAgentPostMessageTargetOrigin(origin);
    },
  };
}

export function getTakuAgentPostMessageTargetOrigin(origin: string | null): string {
  // Electron file/custom-scheme parents can have opaque or non-web origins that
  // are invalid as postMessage targetOrigin values. Inbound messages remain
  // bound to the exact parent Window plus the observed origin in the client.
  if (!origin) return '*';
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : '*';
  } catch {
    return '*';
  }
}

let browserClient: TakuAgentClient | null = null;

export function getTakuAgentClient(): TakuAgentClient {
  if (!browserClient) browserClient = new TakuAgentClient(createBrowserTransport());
  return browserClient;
}

export function closeTakuAgentClient(): void {
  browserClient?.close();
  browserClient = null;
}
