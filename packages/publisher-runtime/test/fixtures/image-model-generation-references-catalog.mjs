// Controlled protocol metadata, not a registered provider or readiness receipt.
export function generationReferenceCatalog({ ready = false, maximum = 9 } = {}) {
  return { schema: 'taku.image-model-catalog.v1', catalogVersion: 'c'.repeat(64),
    observedAt: '2026-10-09T00:00:00Z', nextCursor: null,
    models: [{ id: 'reference-generation-fixture', displayName: 'Reference generation fixture',
      operations: ['media.image.generate'], parameterSchemaVersion: 'fixture-references-v1',
      priceVersion: ready ? 'fixture-only-price.v1' : '', maximumInputs: maximum, maximumOutputs: 1,
      parameters: { num_images: { type: 'integer', minimum: 1, maximum: 1, default: 1 } },
      inputContract: { schema: 'taku.image-input-contract.v3', roles: ['reference'], sameDimensions: false,
        generationReferences: { minimumReferences: 0, maximumReferences: maximum } },
      availability: Object.fromEntries(['subapp', 'site-preview', 'site-published'].map(surface =>
        [surface, ready ? { status: 'ready' } : { status: 'unavailable', reason: 'runtime_bridge_unverified' }])),
    }] };
}
