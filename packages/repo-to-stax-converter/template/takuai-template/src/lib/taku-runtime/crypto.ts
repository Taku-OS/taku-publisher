import {
  assertTakuAgentSecureEnvelopeSize,
  decodeTakuAgentBase64Url,
  encodeTakuAgentBase64Url,
  isTakuAgentSha256Base64Url,
  serializeTakuAgentCapabilitiesForDigest,
  serializeTakuAgentSecureMessagePayload,
} from './contract';
import {
  TAKU_AGENT_MESSAGE_TYPES,
  TAKU_AGENT_PROTOCOL,
  type TakuAgentCapabilities,
  type TakuAgentHostSessionMaterial,
  type TakuAgentSecureEnvelope,
  type TakuAgentSecureLane,
} from './types';

export type TakuAgentSessionAuthenticator = {
  readonly sessionId: string;
  readonly sessionExpiresAt: number;
  signClientMessage(lane: TakuAgentSecureLane, sequence: string, body: string): Promise<string>;
  verifyHostMessage(envelope: TakuAgentSecureEnvelope): Promise<boolean>;
};

export async function computeTakuAgentCapabilitiesDigest(
  capabilities: TakuAgentCapabilities
): Promise<string> {
  const digest = await requireSubtleCrypto().digest(
    'SHA-256',
    new TextEncoder().encode(serializeTakuAgentCapabilitiesForDigest(capabilities))
  );
  return encodeTakuAgentBase64Url(new Uint8Array(digest));
}

export async function importTakuAgentSessionAuthenticator(
  material: TakuAgentHostSessionMaterial
): Promise<TakuAgentSessionAuthenticator> {
  if (
    !isTakuAgentSha256Base64Url(material.c2hKey) ||
    !isTakuAgentSha256Base64Url(material.h2cKey)
  ) {
    throw new TypeError('Invalid Taku Agent session key material');
  }
  const sessionId = material.sessionId;
  const sessionExpiresAt = material.sessionExpiresAt;
  const subtle = requireSubtleCrypto();
  const c2hBytes = decodeTakuAgentBase64Url(material.c2hKey);
  const h2cBytes = decodeTakuAgentBase64Url(material.h2cKey);
  const c2hImportBytes = new Uint8Array(c2hBytes);
  const h2cImportBytes = new Uint8Array(h2cBytes);
  let c2hKey: CryptoKey;
  let h2cKey: CryptoKey;
  try {
    [c2hKey, h2cKey] = await Promise.all([
      subtle.importKey('raw', c2hImportBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
      subtle.importKey('raw', h2cImportBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']),
    ]);
  } finally {
    c2hBytes.fill(0);
    h2cBytes.fill(0);
    c2hImportBytes.fill(0);
    h2cImportBytes.fill(0);
  }

  return {
    sessionId,
    sessionExpiresAt,
    async signClientMessage(lane, sequence, body) {
      const canonical = serializeTakuAgentSecureMessagePayload({
        protocol: TAKU_AGENT_PROTOCOL,
        sessionId,
        direction: 'c2h',
        lane,
        sequence,
        body,
      });
      const signature = await subtle.sign('HMAC', c2hKey, new TextEncoder().encode(canonical));
      return encodeTakuAgentBase64Url(new Uint8Array(signature));
    },
    async verifyHostMessage(envelope) {
      if (
        envelope.__taku !== true ||
        envelope.protocol !== TAKU_AGENT_PROTOCOL ||
        envelope.type !== TAKU_AGENT_MESSAGE_TYPES.secure ||
        envelope.sessionId !== sessionId ||
        envelope.direction !== 'h2c' ||
        !isTakuAgentSha256Base64Url(envelope.mac)
      ) {
        return false;
      }
      const canonical = serializeTakuAgentSecureMessagePayload(envelope);
      return subtle.verify(
        'HMAC',
        h2cKey,
        copyArrayBuffer(decodeTakuAgentBase64Url(envelope.mac)),
        new TextEncoder().encode(canonical)
      );
    },
  };
}

export async function createTakuAgentSecureClientEnvelope(input: {
  authenticator: TakuAgentSessionAuthenticator;
  lane: TakuAgentSecureLane;
  sequence: string;
  body: string;
}): Promise<TakuAgentSecureEnvelope> {
  const mac = await input.authenticator.signClientMessage(input.lane, input.sequence, input.body);
  return assertTakuAgentSecureEnvelopeSize({
    __taku: true,
    protocol: TAKU_AGENT_PROTOCOL,
    type: TAKU_AGENT_MESSAGE_TYPES.secure,
    sessionId: input.authenticator.sessionId,
    direction: 'c2h',
    lane: input.lane,
    sequence: input.sequence,
    body: input.body,
    mac,
  });
}

function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto is unavailable');
  return subtle;
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
