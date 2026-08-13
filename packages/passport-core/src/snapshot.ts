import {
  createCapabilitySnapshot,
  type CapabilityItemInput,
  type CapabilitySnapshotV1,
} from '@taku/capability-contract';

export interface PassportScanResult {
  generatedAt?: unknown;
  usedTools?: CapabilityItemInput[];
  roots?: unknown[];
  personaV2?: unknown;
  basePersona?: unknown;
  badges?: unknown[];
  behaviorProfileV1?: unknown;
  usage?: unknown;
}

export interface PassportPrivateInventory {
  items?: Array<{
    id?: unknown;
    localPath?: unknown;
  }>;
}

export function buildPassportSnapshot(
  scanResult?: PassportScanResult | null,
  privateInventory?: PassportPrivateInventory | null,
): CapabilitySnapshotV1 {
  return createCapabilitySnapshot({
    generatedAt: scanResult?.generatedAt,
    items: scanResult?.usedTools || [],
    privateItems: privateInventory?.items || [],
    roots: scanResult?.roots || [],
    profile: {
      persona: scanResult?.personaV2 || null,
      basePersona: scanResult?.basePersona || null,
      badges: scanResult?.badges || [],
      behaviorProfile: scanResult?.behaviorProfileV1 || null,
      usage: scanResult?.usage || null,
    },
  });
}

export const buildAiSetupSnapshot = buildPassportSnapshot;
