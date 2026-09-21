/** Capability declarations are requests; only an authenticated Host grant authorizes execution. */
export interface RuntimeCapabilities {
  protocol: 'taku.agent.run/v2';
  operations: Array<{ id: string; revision: number }>;
}

export function assertRuntimeCapabilities(value: unknown): asserts value is RuntimeCapabilities {
  const record = (input: unknown): Record<string, unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Runtime capabilities must contain objects.');
    }
    return input as Record<string, unknown>;
  };
  const capabilities = record(value);
  if (Object.keys(capabilities).some(key => !['protocol', 'operations'].includes(key)) ||
      capabilities.protocol !== 'taku.agent.run/v2' || !Array.isArray(capabilities.operations) ||
      capabilities.operations.length > 64) {
    throw new TypeError('Invalid runtime capabilities protocol or operations.');
  }
  const seen = new Set<string>();
  for (const entry of capabilities.operations) {
    const operation = record(entry);
    if (Object.keys(operation).some(key => !['id', 'revision'].includes(key)) ||
        typeof operation.id !== 'string' || !/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/.test(operation.id) ||
        operation.id.length > 128 || !Number.isSafeInteger(operation.revision) ||
        (operation.revision as number) < 1 || seen.has(`${operation.id}@${operation.revision}`)) {
      throw new TypeError('Invalid or duplicate runtime operation declaration.');
    }
    seen.add(`${operation.id}@${operation.revision}`);
  }
}
