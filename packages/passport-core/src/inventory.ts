export const PRIVATE_INVENTORY_SCHEMA_VERSION =
  'taku.creator.private-state.v1' as const;

export interface CapabilityInventoryItem {
  id?: unknown;
  role?: unknown;
  type?: unknown;
  source?: unknown;
  name?: unknown;
  description?: unknown;
  detectedFrom?: unknown;
  availability?: unknown;
  scanPreview?: unknown;
  publishable?: unknown;
  ownership?: unknown;
  ownershipConfidence?: unknown;
  ownershipReasons?: unknown;
  localPath?: unknown;
  [key: string]: unknown;
}

export function dedupeItems<T extends CapabilityInventoryItem>(
  items: readonly T[],
): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = `${String(item.type)}:${String(item.name)}`.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

export function publicItem(
  item: CapabilityInventoryItem,
  role: unknown,
): CapabilityInventoryItem {
  return {
    id: item.id,
    role,
    type: item.type,
    source: item.source,
    name: item.name,
    description: item.description,
    detectedFrom: item.detectedFrom,
    ...(item.availability ? { availability: item.availability } : {}),
    ...(item.scanPreview ? { scanPreview: item.scanPreview } : {}),
    publishable: item.publishable !== false,
    ...(item.ownership ? { ownership: item.ownership } : {}),
    ...(typeof item.ownershipConfidence === 'number' &&
    Number.isFinite(item.ownershipConfidence)
      ? { ownershipConfidence: item.ownershipConfidence }
      : {}),
    ...(Array.isArray(item.ownershipReasons) && item.ownershipReasons.length
      ? { ownershipReasons: item.ownershipReasons }
      : {}),
  };
}

export interface CreatePrivateInventoryOptions {
  generatedAt?: string;
}

export function createPrivateInventory(
  items: readonly CapabilityInventoryItem[],
  options: CreatePrivateInventoryOptions = {},
) {
  return {
    schemaVersion: PRIVATE_INVENTORY_SCHEMA_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    items: items
      .filter((item) => item?.id && item?.localPath)
      .map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        source: item.source,
        detectedFrom: item.detectedFrom,
        ...(item.availability ? { availability: item.availability } : {}),
        localPath: item.localPath,
        ...(item.ownership ? { ownership: item.ownership } : {}),
        ...(typeof item.ownershipConfidence === 'number' &&
        Number.isFinite(item.ownershipConfidence)
          ? { ownershipConfidence: item.ownershipConfidence }
          : {}),
      })),
  };
}
