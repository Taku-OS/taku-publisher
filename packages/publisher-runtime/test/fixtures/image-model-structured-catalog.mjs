// Controlled protocol fixture, not a model registration, quote or ready receipt.
import { imageModelIntegerValuesCatalog } from './image-model-integer-values-catalog.mjs';

export function structuredImagePrompt() {
  return { scene: '  青色 boat 🚤  ', background: null,
    objects: [{ relationship: 'on the river', count: 2, visible: true }] };
}

export function imageModelStructuredCatalog() {
  const page = imageModelIntegerValuesCatalog();
  const model = page.models[0];
  Object.assign(model, { id: 'test-structured-image', displayName: 'Structured protocol fixture',
    parameterSchemaVersion: 'fixture-structured-v1' });
  model.parameters.structured_prompt = { type: 'object', default: structuredImagePrompt(),
    structuredSchema: { type: 'object', required: ['scene', 'objects'], properties: {
      scene: { type: 'string', maxBytes: 128 },
      background: { type: 'string', nullable: true, maxBytes: 128 },
      objects: { type: 'array', maxItems: 4, items: { type: 'object', required: ['relationship'], properties: {
        relationship: { type: 'string', maxBytes: 128 },
        count: { type: 'integer', minimum: 1, maximum: 8 },
        visible: { type: 'boolean' },
      } } },
    } } };
  return page;
}
