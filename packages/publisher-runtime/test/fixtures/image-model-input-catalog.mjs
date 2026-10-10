import { imageModelSizeCatalog } from './image-model-size-catalog.mjs';

// Literal unavailable metadata; not a provider registration or readiness receipt.
export function imageModelInputCatalog() {
  const grid = imageModelSizeCatalog('media.image.edit');
  return { ...grid, models: [
    ...['ideogram-v2-inpaint', 'ideogram-v2-turbo-inpaint', 'ideogram-v3-inpaint'].map(id => ({
      id, displayName: id, operations: ['media.image.edit'],
      parameterSchemaVersion: `${id}-edit-v2-2026-10-07`,
      priceVersion: 'fal-ideogram-mask-image-quote-v1-2026-10-07',
      maximumInputs: 2, maximumOutputs: id === 'ideogram-v3-inpaint' ? 4 : 1,
      availability: {
        subapp: { status: 'unavailable', reason: 'runtime_bridge_unverified' },
        'site-preview': { status: 'unavailable', reason: 'runtime_bridge_unverified' },
        'site-published': { status: 'unavailable', reason: 'runtime_bridge_unverified' },
      },
      parameters: { num_images: { type: 'integer', minimum: 1,
        maximum: id === 'ideogram-v3-inpaint' ? 4 : 1, default: 1 } },
      inputContract: { schema: 'taku.image-input-contract.v1', roles: ['source', 'mask'], sameDimensions: true },
    })),
    ...grid.models,
  ] };
}

// Literal policy for two unavailable reviewed variants; not production ready/pricing.
export function imageModelReferenceMaskCatalog() {
  return { schema: 'taku.image-model-catalog.v1', catalogVersion: 'a'.repeat(64),
    observedAt: '2026-10-08T00:00:00Z', nextCursor: null,
    models: ['gpt-image-2.5-flare-reference-mask', 'gpt-image-2.5-sunburst-reference-mask'].map(id => ({
      id, displayName: id, operations: ['media.image.edit'],
      parameterSchemaVersion: `${id}-edit-v2-2026-10-08`, priceVersion: '',
      maximumInputs: 17, maximumOutputs: 1,
      parameters: { num_images: { type: 'integer', minimum: 1, maximum: 1, default: 1 },
        mask_input: { type: 'integer', minimum: 2, maximum: 17 } },
      inputContract: { schema: 'taku.image-input-contract.v2', roles: ['source', 'mask'],
        sameDimensions: false, referenceMask: { minimumSources: 1, maximumSources: 16,
          maskParameter: 'mask_input', maskMatchesFirstSource: true } },
      availability: {
        subapp: { status: 'unavailable', reason: 'runtime_bridge_unverified' },
        'site-preview': { status: 'unavailable', reason: 'runtime_bridge_unverified' },
        'site-published': { status: 'unavailable', reason: 'runtime_bridge_unverified' },
      },
    })) };
}
