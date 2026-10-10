// Literal controlled metadata; no production readiness or pricing claim.
export function imageModelIntegerValuesCatalog() {
  return {
    schema: 'taku.image-model-catalog.v1', catalogVersion: 'b'.repeat(64),
    observedAt: '2026-10-08T00:00:00Z', nextCursor: null,
    models: [{ id: 'sdxl-lightning', displayName: 'SDXL Lightning',
      operations: ['media.image.generate'], maximumInputs: 0, maximumOutputs: 4,
      parameterSchemaVersion: 'sdxl-lightning-generate-v2-2026-10-08', priceVersion: '',
      parameters: {
        num_inference_steps: { type: 'integer', minimum: 1, maximum: 8,
          default: 4, integerValues: [1, 2, 4, 8] },
        image_size: { type: 'size', default: { width: 1024, height: 1024 },
          sizeConstraints: { minWidth: 32, maxWidth: 4096, minHeight: 32, maxHeight: 4096,
            minPixels: 1024, maxPixels: 8388608, widthStep: 32, heightStep: 32 } },
      },
      availability: Object.fromEntries(['subapp', 'site-preview', 'site-published'].map(surface =>
        [surface, { status: 'unavailable', reason: 'runtime_bridge_unverified' }])),
    }],
  };
}
