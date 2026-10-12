// Hand-specified metadata fixture; expectations do not call the production parser.
export function imageModelSizeCatalog(operation = 'media.image.generate') {
  return {
    schema: 'taku.image-model-catalog.v1', catalogVersion: 'a'.repeat(64),
    observedAt: '2026-10-07T00:00:00Z', nextCursor: null,
    models: [{ id: 'fixture-sized-model', displayName: 'Sized model', operations: [operation],
      parameterSchemaVersion: 'image-parameters.v1', priceVersion: 'fixture-price.v1',
      maximumInputs: operation === 'media.image.edit' ? 10 : 0, maximumOutputs: 4,
      availability: Object.fromEntries(['subapp', 'site-preview', 'site-published'].map(surface =>
        [surface, { status: 'unavailable', reason: 'runtime_bridge_unverified' }])),
      parameters: { image_size: { type: 'size', default: { width: 2048, height: 2048 },
        sizeConstraints: { minWidth: 256, maxWidth: 2560, minHeight: 256, maxHeight: 2560,
          widthStep: operation === 'media.image.generate' ? 16 : 1,
          heightStep: operation === 'media.image.generate' ? 16 : 1,
          minPixels: 1048576, maxPixels: 4194304, minAspectRatio: 1 / 16, maxAspectRatio: 16 } } },
    }],
  };
}
