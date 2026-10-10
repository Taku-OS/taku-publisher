// packages/contracts/src/image-model-structured-parameters.ts
var bytes = (value) => new TextEncoder().encode(value).byteLength;
var record = (value) => !!value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
var safe = (value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
var integer = (value, maximum) => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
function isImageModelParameterName(name) {
  return /^[a-z][a-z0-9_]{0,63}$/.test(name) && !/(_urls?$|api_key|authorization|token)/.test(name) && ![
    "provider",
    "model",
    "endpoint",
    "payer",
    "owner",
    "prompt",
    "input_ids",
    "disable_safety_checker",
    "disable_safety",
    "schema_version"
  ].includes(name);
}
function validImageModelStructuredSchema(value) {
  const budget = { nodes: 0 };
  const visit = (node, depth) => {
    if (depth > 6 || ++budget.nodes > 256 || !record(node) || !Object.hasOwn(node, "type") || Object.hasOwn(node, "nullable") && typeof node.nullable !== "boolean")
      return false;
    const typeKeys = {
      object: ["properties", "required"],
      array: ["items", "maxItems"],
      string: ["maxBytes"],
      integer: ["minimum", "maximum"],
      number: ["minimum", "maximum"],
      boolean: []
    };
    if (typeof node.type !== "string" || !Object.hasOwn(typeKeys, node.type) || Object.keys(node).some((key) => ![
      "type",
      "nullable",
      ...typeKeys[node.type] ?? []
    ].includes(key)))
      return false;
    switch (node.type) {
      case "object": {
        if (!record(node.properties))
          return false;
        const entries = Object.entries(node.properties);
        if (entries.length < 1 || entries.length > 64)
          return false;
        if (Object.hasOwn(node, "required")) {
          if (!Array.isArray(node.required) || node.required.length > entries.length)
            return false;
          const required = new Set;
          for (const name of node.required) {
            if (typeof name !== "string" || !Object.hasOwn(node.properties, name) || required.has(name))
              return false;
            required.add(name);
          }
        }
        return entries.every(([name, child]) => isImageModelParameterName(name) && visit(child, depth + 1));
      }
      case "array":
        return integer(node.maxItems, 64) && visit(node.items, depth + 1);
      case "string":
        return integer(node.maxBytes, 4096);
      case "integer":
      case "number":
        return safe(node.minimum) && safe(node.maximum) && node.minimum <= node.maximum && (node.type !== "integer" || Number.isSafeInteger(node.minimum) && Number.isSafeInteger(node.maximum));
      case "boolean":
        return true;
      default:
        return false;
    }
  };
  return record(value) && value.type === "object" && value.nullable !== true && visit(value, 1);
}
function validImageModelStructuredValue(value) {
  const budget = { nodes: 0 };
  const visit = (node, depth) => {
    if (depth > 6 || ++budget.nodes > 256)
      return false;
    if (node === null || typeof node === "boolean")
      return true;
    if (typeof node === "string")
      return bytes(node) <= 4096;
    if (typeof node === "number")
      return safe(node);
    if (Array.isArray(node)) {
      if (node.length > 64)
        return false;
      for (let index = 0;index < node.length; index++)
        if (!Object.hasOwn(node, index) || !visit(node[index], depth + 1))
          return false;
      return true;
    }
    if (!record(node))
      return false;
    const entries = Object.entries(node);
    return entries.length <= 64 && entries.every(([name, child]) => isImageModelParameterName(name) && visit(child, depth + 1));
  };
  return record(value) && visit(value, 1) && bytes(JSON.stringify(value)) <= 16384;
}
function structuredValueMatchesSchema(schema, value) {
  if (!validImageModelStructuredSchema(schema) || !validImageModelStructuredValue(value))
    return false;
  const visit = (s, node) => {
    if (!s)
      return false;
    if (node === null)
      return s.nullable === true;
    switch (s.type) {
      case "object":
        return record(node) && (s.required ?? []).every((name) => Object.hasOwn(node, name)) && Object.entries(node).every(([name, child]) => Object.hasOwn(s.properties ?? {}, name) && visit(s.properties?.[name], child));
      case "array":
        return Array.isArray(node) && typeof s.maxItems === "number" && node.length <= s.maxItems && node.every((child) => visit(s.items, child));
      case "string":
        return typeof node === "string" && typeof s.maxBytes === "number" && bytes(node) <= s.maxBytes;
      case "integer":
      case "number":
        return safe(node) && safe(s.minimum) && safe(s.maximum) && node >= s.minimum && node <= s.maximum && (s.type !== "integer" || Number.isSafeInteger(node));
      case "boolean":
        return typeof node === "boolean";
    }
  };
  return visit(schema, value);
}
function imageModelParameterValuesEqual(left, right) {
  if (!record(left) || !record(right))
    return left === right;
  if (!validImageModelStructuredValue(left) || !validImageModelStructuredValue(right))
    return false;
  const equal = (a, b) => {
    if (a === b)
      return true;
    if (Array.isArray(a) || Array.isArray(b))
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((entry, index) => equal(entry, b[index]));
    if (!record(a) || !record(b))
      return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
  };
  return equal(left, right);
}

// packages/contracts/src/image-models.ts
var IMAGE_MODEL_SIZE_FEATURE_HEADER = "X-Taku-Image-Model-Features";
var IMAGE_MODEL_SIZE_FEATURE_V1 = "size-constraints-v1";
var IMAGE_MODEL_SIZE_FEATURE_V2 = "size-constraints-v2";
var IMAGE_MODEL_INPUT_FEATURE_V1 = "input-contract-v1";
var IMAGE_MODEL_INPUT_FEATURE_V2 = "input-contract-v2";
var IMAGE_MODEL_INTEGER_VALUES_FEATURE_V1 = "parameter-enum-v1";
var IMAGE_MODEL_STRUCTURED_FEATURE_V1 = "structured-parameters-v1";
var IMAGE_MODEL_ASPECT_RATIO_FEATURE_V1 = "aspect-ratio-v1";
var IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1 = "generation-references-v1";

class ImageModelCatalogError extends Error {
  status;
  code;
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
var IMAGE_MODEL_CATALOG_MAX_BYTES = 512 * 1024;
var SURFACES = [
  "subapp",
  "site-preview",
  "site-published"
];
var REASONS = [
  "runtime_bridge_unverified",
  "provider_deprecated",
  "provider_contract_unavailable",
  "model_parameters_unverified",
  "model_quote_unavailable"
];
var bytes2 = (value) => new TextEncoder().encode(value).byteLength;
var bounded = (value, max) => typeof value === "string" && bytes2(value) <= max;
var record2 = (value) => !!value && typeof value === "object" && !Array.isArray(value);
var keys = (value, required, optional = []) => required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
var integer2 = (value, min, max) => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
var finite = (value) => typeof value === "number" && Number.isFinite(value);
var isImageOperation = (value) => value === "media.image.generate" || value === "media.image.edit";
var cursor = (value) => bounded(value, 1024) && /^[A-Za-z0-9_-]+$/.test(value);
var unavailable = () => {
  throw new ImageModelCatalogError(503, "image_model_catalog_unavailable");
};
function parseImageModelQuery(value) {
  if (!record2(value) || !keys(value, ["operation"], ["query", "cursor", "limit"]) || !isImageOperation(value.operation) || value.query !== undefined && !bounded(value.query, 128) || value.cursor !== undefined && !cursor(value.cursor) || value.limit !== undefined && !integer2(value.limit, 1, 100)) {
    throw new ImageModelCatalogError(400, "invalid_image_model_catalog_query");
  }
  return {
    operation: value.operation,
    limit: value.limit ?? 50,
    ...value.query === undefined ? {} : { query: value.query.trim().toLowerCase() },
    ...value.cursor === undefined ? {} : { cursor: value.cursor }
  };
}
function validSizeConstraints(value, parameter, feature) {
  const grid = feature === IMAGE_MODEL_SIZE_FEATURE_V2 || feature === IMAGE_MODEL_INPUT_FEATURE_V1 || feature === IMAGE_MODEL_INPUT_FEATURE_V2 || feature === IMAGE_MODEL_INTEGER_VALUES_FEATURE_V1 || feature === IMAGE_MODEL_STRUCTURED_FEATURE_V1 || (feature === IMAGE_MODEL_ASPECT_RATIO_FEATURE_V1 || feature === IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1);
  if (!record2(value) || !keys(value, [
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "minPixels",
    "maxPixels",
    ...grid ? ["widthStep", "heightStep"] : []
  ], ["minAspectRatio", "maxAspectRatio"]))
    return false;
  if (!integer2(value.minWidth, 1, 4096) || !integer2(value.maxWidth, value.minWidth, 4096) || !integer2(value.minHeight, 1, 4096) || !integer2(value.maxHeight, value.minHeight, 4096) || !integer2(value.minPixels, 1, 8388608) || !integer2(value.maxPixels, value.minPixels, 8388608) || value.minWidth * value.minHeight > value.maxPixels || value.maxWidth * value.maxHeight < value.minPixels)
    return false;
  if (grid && (!integer2(value.widthStep, 1, 4096) || !integer2(value.heightStep, 1, 4096)))
    return false;
  const widthStep = grid ? value.widthStep : 1;
  const heightStep = grid ? value.heightStep : 1;
  const minimumWidth = Math.ceil(value.minWidth / widthStep) * widthStep;
  const minimumHeight = Math.ceil(value.minHeight / heightStep) * heightStep;
  const maximumWidth = Math.floor(value.maxWidth / widthStep) * widthStep;
  const maximumHeight = Math.floor(value.maxHeight / heightStep) * heightStep;
  if (minimumWidth > maximumWidth || minimumHeight > maximumHeight || minimumWidth * minimumHeight > value.maxPixels || maximumWidth * maximumHeight < value.minPixels)
    return false;
  if (finite(parameter.minimum) && (value.minWidth < parameter.minimum || value.minHeight < parameter.minimum) || finite(parameter.maximum) && (value.maxWidth > parameter.maximum || value.maxHeight > parameter.maximum))
    return false;
  for (const key of ["minAspectRatio", "maxAspectRatio"]) {
    if (Object.hasOwn(value, key) && (!finite(value[key]) || value[key] < 1 / 4096 || value[key] > 4096))
      return false;
  }
  if (finite(value.minAspectRatio) && (finite(value.maxAspectRatio) && value.minAspectRatio > value.maxAspectRatio || value.minAspectRatio > maximumWidth / minimumHeight))
    return false;
  if (finite(value.maxAspectRatio) && value.maxAspectRatio < minimumWidth / maximumHeight)
    return false;
  return true;
}
function sizeWithinConstraints(size, constraints) {
  const pixels = size.width * size.height;
  return size.width >= constraints.minWidth && size.width <= constraints.maxWidth && size.height >= constraints.minHeight && size.height <= constraints.maxHeight && size.width % (constraints.widthStep ?? 1) === 0 && size.height % (constraints.heightStep ?? 1) === 0 && pixels >= constraints.minPixels && pixels <= constraints.maxPixels && (constraints.minAspectRatio === undefined || size.width >= constraints.minAspectRatio * size.height) && (constraints.maxAspectRatio === undefined || size.width <= constraints.maxAspectRatio * size.height);
}
function validAspectRatioValue(value, minimum, maximum) {
  if (!bounded(value, 11))
    return false;
  const match = /^([1-9][0-9]{0,4}):([1-9][0-9]{0,4})$/.exec(value);
  if (!match || match[0] !== value)
    return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width >= minimum * height && width <= maximum * height;
}
function validParameter(value, name, outputs, feature) {
  if (record2(value) && value.type === "aspect-ratio") {
    return (feature === IMAGE_MODEL_ASPECT_RATIO_FEATURE_V1 || feature === IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1) && keys(value, ["type", "minimum", "maximum"], ["required", "default"]) && (value.required === undefined || typeof value.required === "boolean") && !["sync_mode", "enable_safety_checker", "limit_generations", "num_images"].includes(name) && finite(value.minimum) && finite(value.maximum) && value.minimum >= 1 / 99999 && value.maximum <= 99999 && value.minimum <= value.maximum && (!Object.hasOwn(value, "default") || validAspectRatioValue(value.default, value.minimum, value.maximum));
  }
  if (record2(value) && (value.type === "object" || Object.hasOwn(value, "structuredSchema"))) {
    return (feature === IMAGE_MODEL_STRUCTURED_FEATURE_V1 || (feature === IMAGE_MODEL_ASPECT_RATIO_FEATURE_V1 || feature === IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1)) && value.type === "object" && keys(value, ["type", "structuredSchema"], ["required", "default"]) && (value.required === undefined || typeof value.required === "boolean") && !["sync_mode", "enable_safety_checker", "limit_generations", "num_images"].includes(name) && validImageModelStructuredSchema(value.structuredSchema) && (!Object.hasOwn(value, "default") || structuredValueMatchesSchema(value.structuredSchema, value.default));
  }
  if (!record2(value) || !keys(value, ["type"], [
    "values",
    "minimum",
    "maximum",
    "required",
    "default",
    "sizeConstraints",
    ...feature === IMAGE_MODEL_INTEGER_VALUES_FEATURE_V1 || feature === IMAGE_MODEL_STRUCTURED_FEATURE_V1 || (feature === IMAGE_MODEL_ASPECT_RATIO_FEATURE_V1 || feature === IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1) ? ["integerValues"] : []
  ]) || value.required !== undefined && typeof value.required !== "boolean" || value.minimum !== undefined && !finite(value.minimum) || value.maximum !== undefined && !finite(value.maximum) || finite(value.minimum) && finite(value.maximum) && value.minimum > value.maximum)
    return false;
  const enumeration = value.values;
  if (value.type === "enum") {
    if (!Array.isArray(enumeration) || enumeration.length < 1 || enumeration.length > 64 || !enumeration.every((item) => bounded(item, 256)))
      return false;
  } else if (enumeration !== undefined)
    return false;
  const numericChoices = value.integerValues;
  if (Object.hasOwn(value, "integerValues")) {
    if (feature !== IMAGE_MODEL_INTEGER_VALUES_FEATURE_V1 && feature !== IMAGE_MODEL_STRUCTURED_FEATURE_V1 && feature !== IMAGE_MODEL_ASPECT_RATIO_FEATURE_V1 && feature !== IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1 || value.type !== "integer" || !Array.isArray(numericChoices) || numericChoices.length < 1 || numericChoices.length > 64)
      return false;
    for (let index = 0;index < numericChoices.length; index++) {
      const choice = numericChoices[index];
      if (!integer2(choice, -9007199254740991, 9007199254740991) || index > 0 && choice <= numericChoices[index - 1] || finite(value.minimum) && choice < value.minimum || finite(value.maximum) && choice > value.maximum)
        return false;
    }
  }
  if (!["enum", "string", "integer", "number", "boolean", "size"].includes(String(value.type)))
    return false;
  if (Object.hasOwn(value, "sizeConstraints") && (value.type !== "size" || !validSizeConstraints(value.sizeConstraints, value, feature)))
    return false;
  if (["sync_mode", "enable_safety_checker", "limit_generations"].includes(name) && value.type !== "boolean")
    return false;
  if (name === "num_images" && (value.type !== "integer" || finite(value.maximum) && value.maximum > outputs))
    return false;
  if (!Object.hasOwn(value, "default"))
    return true;
  const fallback = value.default;
  if (name === "sync_mode" && fallback !== false || ["enable_safety_checker", "limit_generations"].includes(name) && fallback !== true || name === "num_images" && !integer2(fallback, 1, outputs))
    return false;
  switch (value.type) {
    case "enum":
      return enumeration.includes(fallback);
    case "string":
      return bounded(fallback, 4096);
    case "boolean":
      return typeof fallback === "boolean";
    case "number":
    case "integer":
      return finite(fallback) && (value.type !== "integer" || Number.isSafeInteger(fallback)) && (!Array.isArray(numericChoices) || numericChoices.includes(fallback)) && (!finite(value.minimum) || fallback >= value.minimum) && (!finite(value.maximum) || fallback <= value.maximum);
    case "size":
      return record2(fallback) && keys(fallback, ["width", "height"]) && integer2(fallback.width, 1, 4096) && integer2(fallback.height, 1, 4096) && fallback.width * fallback.height <= 8 * 1024 * 1024 && (!finite(value.minimum) || fallback.width >= value.minimum && fallback.height >= value.minimum) && (!finite(value.maximum) || fallback.width <= value.maximum && fallback.height <= value.maximum) && (!Object.hasOwn(value, "sizeConstraints") || sizeWithinConstraints({ width: fallback.width, height: fallback.height }, value.sizeConstraints));
    default:
      return false;
  }
}
function validModel(value, operation, feature) {
  const generationFeature = feature === IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1;
  const inputFeature = feature === IMAGE_MODEL_INPUT_FEATURE_V1 || feature === IMAGE_MODEL_INPUT_FEATURE_V2 || feature === IMAGE_MODEL_INTEGER_VALUES_FEATURE_V1 || feature === IMAGE_MODEL_STRUCTURED_FEATURE_V1 || (feature === IMAGE_MODEL_ASPECT_RATIO_FEATURE_V1 || feature === IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1);
  const referenceFeature = feature === IMAGE_MODEL_INPUT_FEATURE_V2 || feature === IMAGE_MODEL_INTEGER_VALUES_FEATURE_V1 || feature === IMAGE_MODEL_STRUCTURED_FEATURE_V1 || (feature === IMAGE_MODEL_ASPECT_RATIO_FEATURE_V1 || feature === IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1);
  if (!record2(value) || !keys(value, [
    "id",
    "displayName",
    "operations",
    "availability",
    "parameterSchemaVersion",
    "priceVersion",
    "parameters",
    "maximumInputs",
    "maximumOutputs"
  ], inputFeature ? ["inputContract"] : []) || !bounded(value.id, 96) || !/^[a-z][a-z0-9.-]{0,95}$/.test(value.id) || !bounded(value.displayName, 256) || !value.displayName.trim() || !Array.isArray(value.operations) || value.operations.length !== 1 || value.operations[0] !== operation || !bounded(value.parameterSchemaVersion, 128) || !bounded(value.priceVersion, 128) || !integer2(value.maximumInputs, operation === "media.image.edit" ? 1 : 0, operation === "media.image.edit" ? referenceFeature ? 17 : 16 : generationFeature ? 16 : 0) || !integer2(value.maximumOutputs, 1, (feature === IMAGE_MODEL_ASPECT_RATIO_FEATURE_V1 || feature === IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1) && value.id === "muse-image" && value.parameterSchemaVersion === `muse-image-${operation === "media.image.edit" ? "edit" : "generate"}-v2-2026-10-09` ? 10 : 4) || !record2(value.availability) || !keys(value.availability, SURFACES))
    return false;
  let referenceMask = false;
  let generationReferences = false;
  if (Object.hasOwn(value, "inputContract")) {
    const contract = value.inputContract;
    if (!record2(contract) || !Array.isArray(contract.roles))
      return false;
    if (contract.schema === "taku.image-input-contract.v3") {
      const policy = contract.generationReferences;
      if (!generationFeature || operation !== "media.image.generate" || contract.sameDimensions !== false || contract.roles.length !== 1 || contract.roles[0] !== "reference" || !keys(contract, ["schema", "roles", "sameDimensions", "generationReferences"]) || !record2(policy) || !keys(policy, ["minimumReferences", "maximumReferences"]) || policy.minimumReferences !== 0 || !integer2(policy.maximumReferences, 1, 16) || value.maximumInputs !== policy.maximumReferences)
        return false;
      generationReferences = true;
    } else {
      if (operation !== "media.image.edit" || !Array.isArray(contract.roles) || contract.roles.length !== 2 || contract.roles[0] !== "source" || contract.roles[1] !== "mask")
        return false;
      if (contract.schema === "taku.image-input-contract.v1") {
        if (value.maximumInputs !== 2 || contract.sameDimensions !== true || !keys(contract, ["schema", "roles", "sameDimensions"]))
          return false;
      } else {
        const policy = contract.referenceMask;
        if (!referenceFeature || contract.schema !== "taku.image-input-contract.v2" || contract.sameDimensions !== false || value.maximumInputs !== 17 || !keys(contract, ["schema", "roles", "sameDimensions", "referenceMask"]) || !record2(policy) || !keys(policy, ["minimumSources", "maximumSources", "maskParameter", "maskMatchesFirstSource"]) || policy.minimumSources !== 1 || policy.maximumSources !== 16 || policy.maskParameter !== "mask_input" || policy.maskMatchesFirstSource !== true)
          return false;
        referenceMask = true;
      }
    }
  }
  if (operation === "media.image.generate" && value.maximumInputs !== 0 && !generationReferences)
    return false;
  if (value.maximumInputs === 17 && !referenceMask)
    return false;
  let ready = false;
  for (const surface of SURFACES) {
    const state = value.availability[surface];
    if (!record2(state) || !keys(state, ["status"], ["reason"]))
      return false;
    if (state.status === "ready") {
      if (state.reason !== undefined)
        return false;
      ready = true;
    } else if (!["unavailable", "deprecated"].includes(String(state.status)) || !REASONS.includes(String(state.reason)))
      return false;
  }
  if (ready && (!value.parameterSchemaVersion || !value.priceVersion || !record2(value.parameters)))
    return false;
  if (value.parameters === null) {
    if (referenceMask) {
      const availability = value.availability;
      return !value.parameterSchemaVersion && !value.priceVersion && SURFACES.every((surface) => {
        const state = availability[surface];
        return record2(state) && state.status === "unavailable" && state.reason === "provider_contract_unavailable";
      });
    }
    return !ready;
  }
  if (!record2(value.parameters) || Object.keys(value.parameters).length > 64)
    return false;
  if (referenceMask) {
    const selector = value.parameters.mask_input;
    if (!record2(selector) || !keys(selector, ["type", "minimum", "maximum"], ["required"]) || selector.type !== "integer" || selector.minimum !== 2 || selector.maximum !== 17 || selector.required === true)
      return false;
  }
  for (const [name, parameter] of Object.entries(value.parameters)) {
    if (!isImageModelParameterName(name) || !validParameter(parameter, name, value.maximumOutputs, feature))
      return false;
  }
  return true;
}
function parseImageModelCatalog(value, operation, limit, feature = IMAGE_MODEL_SIZE_FEATURE_V1) {
  if (![IMAGE_MODEL_SIZE_FEATURE_V1, IMAGE_MODEL_SIZE_FEATURE_V2, IMAGE_MODEL_INPUT_FEATURE_V1, IMAGE_MODEL_INPUT_FEATURE_V2, IMAGE_MODEL_INTEGER_VALUES_FEATURE_V1, IMAGE_MODEL_STRUCTURED_FEATURE_V1, IMAGE_MODEL_ASPECT_RATIO_FEATURE_V1, IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1].includes(feature) || !record2(value) || !keys(value, [
    "schema",
    "catalogVersion",
    "observedAt",
    "models",
    "nextCursor"
  ]) || value.schema !== "taku.image-model-catalog.v1" || !bounded(value.catalogVersion, 64) || !/^[a-f0-9]{64}$/.test(value.catalogVersion) || !bounded(value.observedAt, 64) || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value.observedAt) || !Number.isFinite(Date.parse(value.observedAt)) || !integer2(limit, 1, 100) || !Array.isArray(value.models) || value.models.length > limit || value.nextCursor !== null && !cursor(value.nextCursor))
    return unavailable();
  const ids = new Set;
  for (const model of value.models) {
    if (!validModel(model, operation, feature) || ids.has(model.id))
      return unavailable();
    ids.add(model.id);
  }
  if (value.models.length === 0 && value.nextCursor !== null)
    return unavailable();
  return structuredClone(value);
}

// packages/contracts/src/image-model-reader.ts
async function withImageModelDeadline(read, parent) {
  const controller = new AbortController;
  const cancel = () => controller.abort();
  parent?.addEventListener("abort", cancel, { once: true });
  if (parent?.aborted)
    cancel();
  const timer = setTimeout(cancel, 1e4);
  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = () => reject(new ImageModelCatalogError(503, "image_model_catalog_unavailable"));
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    if (controller.signal.aborted)
      rejectAbort();
  });
  try {
    return await (controller.signal.aborted ? aborted : Promise.race([read(controller.signal), aborted]));
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
    if (rejectAbort)
      controller.signal.removeEventListener("abort", rejectAbort);
  }
}
async function readImageModelJson(response, signal) {
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    response.body?.cancel().catch(() => {});
    throw new ImageModelCatalogError(503, "image_model_catalog_unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new ImageModelCatalogError(503, "image_model_catalog_unavailable");
  const cancel = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    if (signal.aborted) {
      cancel();
      throw new ImageModelCatalogError(503, "image_model_catalog_unavailable");
    }
    while (true) {
      const next = await reader.read();
      if (signal.aborted)
        throw new ImageModelCatalogError(503, "image_model_catalog_unavailable");
      if (next.done)
        break;
      size += next.value.byteLength;
      if (size > IMAGE_MODEL_CATALOG_MAX_BYTES) {
        cancel();
        throw new ImageModelCatalogError(503, "image_model_catalog_unavailable");
      }
      chunks.push(next.value);
    }
    const bytes3 = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes3.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes3));
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

// packages/contracts/src/image-executions.ts
var IMAGE_EXECUTION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
var IMAGE_EXECUTION_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
var IMAGE_EXECUTION_MAX_BYTES = 128 * 1024;
var IMAGE_EXECUTION_ERRORS = new Set([
  "image_model_unavailable",
  "image_model_receipt_unavailable",
  "image_execution_not_found",
  "image_results_pending",
  "image_model_authorization_unavailable",
  "image_model_quote_not_found",
  "image_execution_submission_uncertain",
  "image_execution_submission_already_attempted",
  "image_execution_cancelled",
  "media_asset_conflict",
  "media_job_conflict",
  "media_job_not_found",
  "image_model_quote_expired",
  "image_model_quote_conflict",
  "image_model_request_conflict",
  "invalid_image_model_request",
  "image_model_access_denied",
  "media_asset_not_found",
  "media_asset_expired",
  "media_asset_not_ready",
  "media_asset_failed",
  "media_asset_unavailable",
  "invalid_request_id",
  "invalid_idempotency_key",
  "media_input_invalid",
  "insufficient_credits",
  "authentication_required",
  "preview_session_required",
  "capability_unavailable",
  "site_frozen",
  "site_unavailable",
  "site_media_rate_limited",
  "site_quota_unavailable",
  "forbidden",
  "insufficient_scope",
  "scope_not_declared",
  "integration_not_declared",
  "operation_not_declared",
  "SITE_CAPABILITY_INTERNAL_ONLY",
  "request_too_large"
]);
var object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var exact = (v, required, optional = []) => required.every((key) => Object.hasOwn(v, key)) && Object.keys(v).every((key) => required.includes(key) || optional.includes(key));
var bytes3 = (v) => new TextEncoder().encode(v).byteLength;
var integer3 = (v, min, max) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
var bounded2 = (v, pattern) => typeof v === "string" && pattern.test(v);
var model = (v) => bounded2(v, /^[a-z][a-z0-9.-]{0,95}$/);
var version = (v) => bounded2(v, /^[A-Za-z0-9._:-]{1,160}$/);
var amount = (v) => bounded2(v, /^(?:0|[1-9][0-9]{0,17})\.[0-9]{6}$/);
var code = (v) => bounded2(v, /^[a-z][a-z0-9_]{1,80}$/);
var isImageQuoteId = (v) => typeof v === "string" && v.startsWith("imq_") && IMAGE_EXECUTION_UUID.test(v.slice(4));
var invalid = () => {
  throw new Error("invalid_platform_response");
};
function imageExecutionKind(operation) {
  if (!isImageOperation(operation))
    throw new Error("invalid_image_model_request");
  return operation === "media.image.generate" ? "generate" : "edit";
}
function time(v) {
  return typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(Date.parse(v)).toISOString().slice(0, 19) === v.slice(0, 19);
}
function maximumOutputCount(modelId, schema, operation) {
  const mode = operation === "media.image.edit" ? "edit" : "generate";
  return modelId === "muse-image" && schema === `muse-image-${mode}-v2-2026-10-09` ? 10 : 4;
}
function parameters(v, klingNegativePrompt = false, maximumOutputs = 4) {
  if (!object(v) || Object.keys(v).length > 64)
    return false;
  return Object.entries(v).every(([key, item]) => {
    if (!isImageModelParameterName(key) || key === "sync_mode" && item !== false || ["enable_safety_checker", "limit_generations"].includes(key) && item !== true || key === "num_images" && !integer3(item, 1, maximumOutputs))
      return false;
    return typeof item === "string" ? key === "negative_prompt" && klingNegativePrompt ? Array.from(item).length <= 2500 && bytes3(item) <= 1e4 : bytes3(item) <= 4096 : typeof item === "number" ? Number.isFinite(item) && Math.abs(item) <= Number.MAX_SAFE_INTEGER : typeof item === "boolean" || (key !== "image_size" ? validImageModelStructuredValue(item) : object(item) && exact(item, ["width", "height"]) && integer3(item.width, 1, 4096) && integer3(item.height, 1, 4096) && item.width * item.height <= 8 * 1024 * 1024);
  });
}
function parseImageExecutionRequest(v, operation) {
  imageExecutionKind(operation);
  if (!object(v) || !exact(v, ["schema_version", "model", "parameter_schema_version", "prompt"], ["input_ids", "parameters"]) || v.schema_version !== "taku.managed-media-request.v2" || !model(v.model) || !version(v.parameter_schema_version) || typeof v.prompt !== "string" || !v.prompt.trim() || bytes3(v.prompt.trim()) > 16384)
    throw new Error("invalid_image_model_request");
  const ids = v.input_ids ?? [], params = v.parameters === undefined ? {} : v.parameters;
  const referenceMask = v.model === "gpt-image-2.5-flare-reference-mask" || v.model === "gpt-image-2.5-sunburst-reference-mask";
  if (v.input_ids === null || !Array.isArray(ids) || ids.length > (referenceMask ? 17 : 16) || !Array.from({ length: ids.length }, (_, index) => ids[index]).every((id) => bounded2(id, /^min_[0-9a-f]{32}$/)) || new Set(ids).size !== ids.length || operation === "media.image.edit" && ids.length === 0 || !parameters(params, v.model === "kling-image-v3" && v.parameter_schema_version === "kling-image-v3-generate-v2-2026-10-08" && operation === "media.image.generate", maximumOutputCount(v.model, v.parameter_schema_version, operation)))
    throw new Error("invalid_image_model_request");
  if (referenceMask) {
    const selector = params.mask_input;
    const hasMask = Object.hasOwn(params, "mask_input");
    if (operation !== "media.image.edit" || v.parameter_schema_version !== `${v.model}-edit-v2-2026-10-08` || hasMask && !integer3(selector, 2, ids.length) || ids.length - (hasMask ? 1 : 0) > 16)
      throw new Error("invalid_image_model_request");
  }
  const result = { ...v, prompt: v.prompt.trim(), parameters: structuredClone(params) };
  if (bytes3(JSON.stringify(result)) > 32768)
    throw new Error("invalid_image_model_request");
  return structuredClone(result);
}
function validQuote(v, operation, selected) {
  if (!object(v))
    return false;
  const rule = "gpt25-standard-direct-edit-budget-v1-2026-10-10";
  const parameterSchema = "gpt-image-2.5-flare-edit-budget-v1-2026-10-10";
  if (v.schema !== "taku.image-model-quote.v2") {
    return v.priceVersion !== rule && v.parameterSchemaVersion !== parameterSchema && validFixedQuoteShape(v, operation, selected);
  }
  const expected = { quality: "low", image_size: { width: 1024, height: 1024 }, num_images: 1, output_format: "png", background: "auto", enable_safety_checker: true, sync_mode: false };
  if (!exact(v, ["schema", "billingMode", "maximumCredits", "quoteId", "model", "operation", "parameterSchemaVersion", "normalizedParameters", "priceVersion", "expiresAt"]) || v.billingMode !== "metered_budget" || !amount(v.maximumCredits) || BigInt(v.maximumCredits.replace(".", "")) <= BigInt(0) || v.model !== "gpt-image-2.5-flare" || operation !== "media.image.edit" || v.operation !== operation || v.parameterSchemaVersion !== parameterSchema || v.priceVersion !== rule || !object(v.normalizedParameters) || !exact(v.normalizedParameters, Object.keys(expected)) || !Object.entries(expected).every(([key, value]) => imageModelParameterValuesEqual(value, v.normalizedParameters[key])))
    return false;
  const { billingMode: _mode, maximumCredits: _maximum, ...common } = v;
  return validFixedQuoteShape({ ...common, schema: "taku.image-model-quote.v1", credits: v.maximumCredits }, operation, selected);
}
function validFixedQuoteShape(v, operation, selected) {
  return object(v) && exact(v, [
    "schema",
    "quoteId",
    "model",
    "operation",
    "parameterSchemaVersion",
    "normalizedParameters",
    "priceVersion",
    "credits",
    "expiresAt"
  ]) && v.schema === "taku.image-model-quote.v1" && isImageQuoteId(v.quoteId) && v.model === selected && v.operation === operation && version(v.parameterSchemaVersion) && version(v.priceVersion) && parameters(v.normalizedParameters, v.model === "kling-image-v3" && v.parameterSchemaVersion === "kling-image-v3-generate-v2-2026-10-08" && operation === "media.image.generate", maximumOutputCount(v.model, v.parameterSchemaVersion, operation)) && amount(v.credits) && time(v.expiresAt);
}
function parseImageExecution(v, operation, binding = {}) {
  if (!object(v) || !exact(v, [
    "schema_version",
    "execution_id",
    "request_id",
    "model",
    "operation",
    "status",
    "terminal",
    "cancellable",
    "next_action",
    "quote",
    "model_receipt"
  ], ["error_code"]) || v.schema_version !== "taku.image-model-execution.v1" || !bounded2(v.execution_id, IMAGE_EXECUTION_UUID) || !bounded2(v.request_id, IMAGE_EXECUTION_REQUEST_ID) || !model(v.model) || v.operation !== operation || !isImageOperation(operation) || binding.executionId !== undefined && v.execution_id !== binding.executionId || binding.requestId !== undefined && v.request_id !== binding.requestId || typeof v.status !== "string" || ![
    "pending_quote",
    "quoted",
    "submission_requested",
    "submission_unknown",
    "active",
    "cancel_requested",
    "accepted",
    "submitting",
    "queued",
    "running",
    "cancelling",
    "finalizing_success",
    "finalizing_failed",
    "finalizing_cancelled",
    "billing_review",
    "cancelled",
    "completed",
    "failed",
    "unknown",
    "rejected"
  ].includes(v.status) || typeof v.terminal !== "boolean" || typeof v.cancellable !== "boolean" || v.terminal && v.cancellable || v.terminal !== ["completed", "cancelled", "failed", "rejected"].includes(v.status) || v.next_action !== (v.terminal ? "none" : v.status === "cancel_requested" ? "poll" : v.status === "pending_quote" ? "quote" : v.status === "quoted" ? "submit" : "poll") || v.error_code !== undefined && !code(v.error_code) || v.quote !== null && !validQuote(v.quote, operation, String(v.model)))
    return invalid();
  const quote = v.quote;
  if (v.status === "pending_quote" && quote !== null || quote === null && !["pending_quote", "cancelled", "rejected"].includes(v.status))
    return invalid();
  if (binding.quoteId !== undefined && quote?.quoteId !== binding.quoteId || binding.request && (v.model !== binding.request.model || quote && (quote.parameterSchemaVersion !== binding.request.parameter_schema_version || Object.entries(binding.request.parameters).some(([key, input]) => {
    const actual = quote.normalizedParameters[key];
    return !Object.hasOwn(quote.normalizedParameters, key) || !imageModelParameterValuesEqual(input, actual);
  }))))
    return invalid();
  if (v.model_receipt !== null) {
    const receipt = v.model_receipt;
    const budget = quote?.schema === "taku.image-model-quote.v2";
    if (!quote || !object(receipt) || !exact(receipt, [
      "schema",
      "quoteId",
      "selectedModel",
      "operation",
      "parameterSchemaVersion",
      "priceVersion",
      ...budget ? ["maximumCredits", "billingMode"] : ["quotedCredits"],
      "chargedCredits",
      "billingStatus"
    ]) || receipt.schema !== (budget ? "taku.image-model-receipt.v2" : "taku.image-model-receipt.v1") || receipt.quoteId !== quote.quoteId || receipt.selectedModel !== quote.model || receipt.operation !== operation || receipt.parameterSchemaVersion !== quote.parameterSchemaVersion || receipt.priceVersion !== quote.priceVersion || (budget ? receipt.billingMode !== "metered_budget" || receipt.maximumCredits !== quote.maximumCredits : receipt.quotedCredits !== quote.credits) || (v.terminal ? receipt.billingStatus !== "settled" || !amount(receipt.chargedCredits) : receipt.chargedCredits !== null || !["pending", "review"].includes(String(receipt.billingStatus))))
      return invalid();
    if (budget && v.terminal && BigInt(String(receipt.chargedCredits).replace(".", "")) > BigInt(quote.maximumCredits.replace(".", "")))
      return invalid();
  } else if (v.status === "completed" || v.status === "failed")
    return invalid();
  return structuredClone(v);
}
function readyOutput(v, operation, now) {
  return typeof v.content_type === "string" && ["image/png", "image/jpeg", "image/webp"].includes(v.content_type) && integer3(v.byte_length, 1, (operation === "media.image.edit" ? 64 : 25) * 1024 * 1024) && time(v.asset_expires_at) && Date.parse(v.asset_expires_at) > now && Date.parse(v.asset_expires_at) <= now + 30 * 86400000;
}
function parseImageOutputs(v, operation, executionId, now = Date.now()) {
  if (!object(v) || !exact(v, ["schema_version", "execution_id", "request_id", "output_count", "outputs"]) || v.schema_version !== "taku.image-model-outputs.v1" || v.execution_id !== executionId || !bounded2(v.request_id, IMAGE_EXECUTION_REQUEST_ID) || !integer3(v.output_count, 1, 16) || !Array.isArray(v.outputs) || v.outputs.length !== v.output_count)
    return invalid();
  for (const [index, item] of v.outputs.entries()) {
    if (!object(item) || item.output_index !== index || !integer3(item.output_index, 0, 15))
      return invalid();
    const base = ["output_index", "state"];
    if (["pending", "copying", "expired"].includes(String(item.state))) {
      if (!exact(item, base) || typeof item.state !== "string")
        return invalid();
    } else if (item.state === "failed") {
      if (!exact(item, [...base, "error_code", "retryable"]) || !code(item.error_code) || typeof item.retryable !== "boolean")
        return invalid();
    } else if (item.state !== "ready" || !exact(item, [...base, "content_type", "byte_length", "asset_expires_at"]) || !readyOutput(item, operation, now))
      return invalid();
  }
  return structuredClone(v);
}
function parseImageDownload(v, operation, executionId, index, now = Date.now(), trustedOrigin) {
  const base = ["schema_version", "execution_id", "request_id", "output_index", "state"];
  if (!object(v) || v.schema_version !== "taku.image-model-download.v1" || v.execution_id !== executionId || !bounded2(v.request_id, IMAGE_EXECUTION_REQUEST_ID) || v.output_index !== index || !integer3(index, 0, 15))
    return invalid();
  if (v.state === "pending" || v.state === "copying") {
    if (!exact(v, base))
      return invalid();
  } else if (v.state === "failed") {
    if (!exact(v, [...base, "error_code", "retryable"]) || !code(v.error_code) || typeof v.retryable !== "boolean")
      return invalid();
  } else {
    if (v.state !== "ready" || !exact(v, [
      ...base,
      "url",
      "content_type",
      "byte_length",
      "expires_at",
      "asset_expires_at"
    ]) || !readyOutput(v, operation, now) || !time(v.expires_at) || Date.parse(v.expires_at) <= now || Date.parse(v.expires_at) > now + 330000 || Date.parse(String(v.asset_expires_at)) < Date.parse(v.expires_at) || typeof v.url !== "string" || v.url.length > 2800)
      return invalid();
    let url;
    try {
      url = new URL(v.url);
    } catch {
      return invalid();
    }
    const path = /^\/media\/assets\/images\/([0-9a-f-]+)\/(0|[1-9]|1[0-5])\/content$/.exec(url.pathname);
    const ticket = url.searchParams.get("ticket") ?? "";
    if (url.protocol !== "https:" || url.username || url.password || url.hash || trustedOrigin && url.origin !== trustedOrigin || !path || !IMAGE_EXECUTION_UUID.test(path[1]) || path[2] !== String(index) || [...url.searchParams.keys()].length !== 1 || ticket.length > 2300 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(ticket) || v.url !== url.href)
      return invalid();
  }
  return structuredClone(v);
}
function decodeImageExecutionJson(text) {
  const parsed = JSON.parse(text);
  let at = 0, tokens = 0;
  const space = () => {
    while (at < text.length && /\s/.test(text[at]))
      at++;
  };
  const string = () => {
    const start = at++;
    while (at < text.length) {
      const char = text[at++];
      if (char === "\\")
        at++;
      else if (char === '"')
        return JSON.parse(text.slice(start, at));
    }
    return invalid();
  };
  const visit = (depth) => {
    if (depth > 16 || ++tokens > 4096)
      invalid();
    space();
    const opening = text[at];
    if (opening === "{") {
      at++;
      space();
      const seen = new Set;
      while (text[at] !== "}") {
        const key = string();
        if (seen.has(key))
          invalid();
        seen.add(key);
        space();
        at++;
        visit(depth + 1);
        space();
        if (text[at] !== ",")
          break;
        at++;
        space();
      }
      at++;
    } else if (opening === "[") {
      at++;
      space();
      while (text[at] !== "]") {
        visit(depth + 1);
        space();
        if (text[at] !== ",")
          break;
        at++;
      }
      at++;
    } else if (opening === '"')
      string();
    else {
      while (at < text.length && !/[,\]}\s]/.test(text[at]))
        at++;
    }
  };
  visit(0);
  return parsed;
}
async function readImageExecutionJson(response, signal, maxBytes = IMAGE_EXECUTION_MAX_BYTES) {
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    response.body?.cancel().catch(() => {});
    return invalid();
  }
  const reader = response.body?.getReader();
  if (!reader)
    return invalid();
  const cancel = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    if (signal.aborted) {
      cancel();
      return invalid();
    }
    while (true) {
      const next = await reader.read();
      if (signal.aborted)
        return invalid();
      if (next.done)
        break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        cancel();
        throw new Error("image_json_too_large");
      }
      chunks.push(next.value);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return decodeImageExecutionJson(new TextDecoder("utf-8", { fatal: true }).decode(joined));
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

// packages/sdk/src/image-executions.ts
function createImageExecutionSdk(invoke) {
  const base = (op) => `/__taku/media/images/v2/${imageExecutionKind(op)}`;
  const execution = (op, id) => {
    if (typeof id !== "string" || !IMAGE_EXECUTION_UUID.test(id))
      throw new Error("invalid_image_execution_id");
    return `${base(op)}/executions/${id}`;
  };
  const requestId = (id) => {
    if (typeof id !== "string" || !IMAGE_EXECUTION_REQUEST_ID.test(id))
      throw new Error("invalid_request_id");
  };
  return {
    async quoteImageRequest(op, input, options) {
      requestId(options?.requestId);
      const request = parseImageExecutionRequest(input, op);
      return parseImageExecution(await invoke(`${base(op)}/quotes`, "POST", { request }, options), op, { requestId: options.requestId, request });
    },
    async submitImageRequest(op, id, quoteId, options = {}) {
      const path = execution(op, id);
      if (!isImageQuoteId(quoteId))
        throw new Error("invalid_image_quote_id");
      return parseImageExecution(await invoke(`${path}/submit`, "POST", { quoteId }, options), op, {
        executionId: id,
        quoteId
      });
    },
    async getImageExecution(op, id, options = {}) {
      return parseImageExecution(await invoke(execution(op, id), "GET", undefined, options), op, {
        executionId: id
      });
    },
    async findImageExecution(op, id, options = {}) {
      requestId(id);
      return parseImageExecution(await invoke(`${base(op)}/by-request/${id}`, "GET", undefined, options), op, { requestId: id });
    },
    async cancelImageExecution(op, id, options = {}) {
      return parseImageExecution(await invoke(`${execution(op, id)}/cancel`, "POST", {}, options), op, { executionId: id });
    },
    async getImageOutputs(op, id, options = {}) {
      return parseImageOutputs(await invoke(`${execution(op, id)}/assets`, "GET", undefined, options), op, id);
    },
    async getImageOutputLink(op, id, index, options = {}) {
      const path = execution(op, id);
      if (!Number.isSafeInteger(index) || index < 0 || index > 15)
        throw new Error("invalid_image_output_index");
      return parseImageDownload(await invoke(`${path}/assets/${index}/link`, "GET", undefined, options), op, id, index);
    }
  };
}

// packages/sdk/src/index.ts
var SITE_CAPABILITY_INTERNAL_ONLY = "SITE_CAPABILITY_INTERNAL_ONLY";

class TakuSitesRequestError extends Error {
  status;
  code;
  retryAfter;
  requestId;
  constructor(status, code2, retryAfter, requestId) {
    super(code2);
    this.status = status;
    this.code = code2;
    this.retryAfter = retryAfter;
    this.requestId = requestId;
    this.name = "TakuSitesRequestError";
  }
  get internalOnly() {
    return this.code === SITE_CAPABILITY_INTERNAL_ONLY;
  }
}
var CAPABILITY_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
var RECORD_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
var SCOPE_NAME = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
var MEDIA_JOB_ID = /^(?:med|mgn)_[0-9a-f]{32}$/;
var MEDIA_GENERATION_JOB_ID = /^mgn_[0-9a-f]{32}$/;
var MEDIA_VIDEO_MAX_BYTES = 40 * 1024 * 1024;
var MEDIA_VIDEO_CONTENT_TYPES = ["video/mp4", "video/webm"];
var IMAGE_ASPECT_RATIOS = ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"];
var VIDEO_ASPECT_RATIOS = ["16:9", "9:16"];
var MEDIA_INPUT_ID = /^min_[0-9a-f]{32}$/;
var MEDIA_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
var MEDIA_MAX_BYTES = 20 * 1024 * 1024;
var MEDIA_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"];
var MEDIA_PERMIT_TOKEN = /^[A-Za-z0-9_-]{1,900}\.[0-9a-f]{64}$/;
var IMAGE_MODEL_ERRORS = new Set([
  "invalid_image_model_catalog_query",
  "image_model_catalog_unavailable",
  "authentication_required",
  "preview_session_required",
  "capability_unavailable",
  "site_frozen",
  "site_unavailable",
  "site_media_rate_limited",
  "site_quota_unavailable",
  "forbidden",
  "insufficient_scope",
  "scope_not_declared",
  "integration_not_declared",
  "operation_not_declared",
  "SITE_CAPABILITY_INTERNAL_ONLY"
]);
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeBaseUrl(value) {
  try {
    const fallback = typeof globalThis.location === "object" ? globalThis.location.origin : "";
    const url = new URL(value ?? fallback);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (url.protocol === "https:" || url.protocol === "http:" && loopback) && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}
function retryAfter(value) {
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
}
async function boundedResponseJson(response, limit) {
  const reader = response.body?.getReader();
  if (!reader)
    throw new Error("invalid_platform_response");
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done)
        break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("invalid_platform_response");
      }
      chunks.push(next.value);
    }
    const bytes4 = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes4.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes4));
  } finally {
    reader.releaseLock();
  }
}
function createTakuSitesClient(options = {}) {
  const fetcher = options.fetcher ?? ((request2) => fetch(request2));
  const baseUrl = safeBaseUrl(options.baseUrl);
  const navigate = options.navigate ?? ((url) => {
    if (typeof globalThis.location !== "object")
      throw new Error("auth_unavailable");
    globalThis.location.assign(url);
  });
  async function request(path, init = {}, maxBytes, jsonReader) {
    if (!baseUrl)
      throw new Error("site_origin_unavailable");
    const url = new URL(path, baseUrl);
    if (url.origin !== baseUrl || !url.pathname.startsWith("/__taku/")) {
      throw new Error("invalid_platform_path");
    }
    const headers = new Headers(init.headers);
    if (url.pathname.startsWith("/__taku/storage/")) {
      const requestId = headers.get("X-Taku-SQL-Request-Id") ?? crypto.randomUUID();
      if (!/^[A-Za-z0-9._:~-]{16,128}$/.test(requestId))
        throw new Error("invalid_database_request_id");
      headers.set("X-Taku-SQL-Request-Id", requestId);
    }
    if (init.method && init.method !== "GET")
      headers.set("X-Taku-CSRF", "1");
    if (init.body)
      headers.set("Content-Type", "application/json");
    const response = await fetcher(new Request(url, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error"
    })).catch(() => {
      throw new TakuSitesRequestError(503, "platform_unavailable");
    });
    if (!response.ok) {
      let code2 = "request_failed";
      try {
        const body = jsonReader ? await jsonReader(response) : maxBytes ? await boundedResponseJson(response, maxBytes) : await response.clone().json();
        if (isRecord(body) && typeof body.error === "string")
          code2 = body.error;
      } catch {}
      throw new TakuSitesRequestError(response.status, code2, retryAfter(response.headers.get("Retry-After")), /^[A-Za-z0-9_.:-]{1,128}$/.test(response.headers.get("X-Request-Id") ?? "") ? response.headers.get("X-Request-Id") : undefined);
    }
    if (response.status === 204)
      return null;
    return jsonReader ? jsonReader(response) : maxBytes ? boundedResponseJson(response, maxBytes) : response.json();
  }
  function startedJob(value, jobId) {
    if (!isRecord(value) || value.schema_version !== "taku.site-media-job.v1" || typeof value.job_id !== "string" || !jobId.test(value.job_id) || typeof value.status !== "string" || typeof value.terminal !== "boolean" || value.asset_content !== undefined || value.expires_at !== undefined || Object.keys(value).some((key) => ![
      "schema_version",
      "job_id",
      "status",
      "terminal",
      "poll_after_ms"
    ].includes(key)) || value.poll_after_ms !== undefined && (!Number.isSafeInteger(value.poll_after_ms) || value.poll_after_ms < 1000 || value.poll_after_ms > 30000))
      throw new Error("invalid_platform_response");
    return value;
  }
  async function generate(kind, prompt, options2) {
    if (typeof prompt !== "string" || !prompt.trim() || [...prompt.trim()].length > 4000)
      throw new Error("invalid_media_prompt");
    const requestId = options2.requestId ?? crypto.randomUUID();
    if (!MEDIA_REQUEST_ID.test(requestId))
      throw new Error("invalid_request_id");
    if (options2.aspectRatio !== undefined && !(kind === "videos" ? VIDEO_ASPECT_RATIOS : IMAGE_ASPECT_RATIOS).includes(options2.aspectRatio))
      throw new Error("invalid_media_aspect_ratio");
    if (options2.durationSeconds !== undefined && (kind !== "videos" || ![4, 6, 8].includes(options2.durationSeconds)))
      throw new Error("invalid_media_duration");
    const value = await request(`/__taku/media/generations/${kind}`, {
      method: "POST",
      headers: { "Idempotency-Key": requestId },
      body: JSON.stringify({
        prompt: prompt.trim(),
        ...options2.aspectRatio === undefined ? {} : { aspect_ratio: options2.aspectRatio },
        ...options2.durationSeconds === undefined ? {} : { duration_seconds: options2.durationSeconds }
      })
    });
    return startedJob(value, MEDIA_GENERATION_JOB_ID);
  }
  function capabilityName(value) {
    if (!CAPABILITY_NAME.test(value))
      throw new Error("invalid_capability_name");
    return value;
  }
  return {
    auth: {
      async getSession() {
        const value = await request("/__taku/session");
        if (isRecord(value) && value.authenticated === false) {
          return {
            authenticated: false,
            ...value.mode === "preview" ? { mode: "preview" } : {}
          };
        }
        if (isRecord(value) && value.authenticated === true && typeof value.siteUserId === "string" && Array.isArray(value.scopes) && value.scopes.every((scope) => typeof scope === "string")) {
          return {
            authenticated: true,
            siteUserId: value.siteUserId,
            scopes: value.scopes,
            ...value.mode === "preview" ? { mode: "preview" } : {}
          };
        }
        throw new Error("invalid_platform_response");
      },
      async signIn(input) {
        if (!Array.isArray(input.scopes) || input.scopes.length > 32 || new Set(input.scopes).size !== input.scopes.length || !input.scopes.every((scope) => SCOPE_NAME.test(scope))) {
          throw new Error("invalid_scope");
        }
        const returnTo = input.returnTo ?? "/";
        if (!returnTo.startsWith("/") || returnTo.startsWith("//")) {
          throw new Error("invalid_return_path");
        }
        const value = await request("/__taku/auth/start", {
          method: "POST",
          body: JSON.stringify({ scopes: input.scopes, returnPath: returnTo })
        });
        if (isRecord(value) && value.mode === "preview" && value.opened === true) {
          const deadline = Date.now() + 30 * 60 * 1000;
          while (Date.now() < deadline) {
            const session = await request("/__taku/session");
            const granted = isRecord(session) && Array.isArray(session.scopes) ? session.scopes : [];
            if (isRecord(session) && session.mode === "preview" && session.authenticated === true && typeof session.siteUserId === "string" && input.scopes.every((scope) => granted.includes(scope)))
              return;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          throw new TakuSitesRequestError(408, "preview_auth_timeout");
        }
        if (!isRecord(value) || typeof value.authorizeUrl !== "string") {
          throw new Error("auth_unavailable");
        }
        const destination = new URL(value.authorizeUrl);
        if (destination.origin !== "https://taku.ai" || destination.pathname !== "/auth/sites") {
          throw new Error("auth_unavailable");
        }
        navigate(destination.toString());
      },
      async signOut() {
        await request("/__taku/auth/logout", { method: "POST" });
      }
    },
    integration: {
      async call(name, operation, input, options2 = {}) {
        const integration = capabilityName(name);
        const action = capabilityName(operation);
        const requestId = options2.requestId ?? crypto.randomUUID();
        if (!/^[A-Za-z0-9._:~-]{16,128}$/.test(requestId))
          throw new Error("invalid_request_id");
        return request(`/__taku/integrations/${integration}/${action}`, {
          method: "POST",
          headers: { "Idempotency-Key": requestId },
          body: JSON.stringify(input)
        });
      }
    },
    media: {
      ...createImageExecutionSdk((path, method, body, options2 = {}) => withImageModelDeadline(async (signal) => {
        try {
          return await request(path, {
            method,
            signal,
            headers: {
              "X-Taku-CSRF": "1",
              ...options2.requestId ? { "Idempotency-Key": options2.requestId } : {}
            },
            ...body === undefined ? {} : { body: JSON.stringify(body) }
          }, undefined, (response) => readImageExecutionJson(response, signal));
        } catch (error) {
          if (error instanceof TakuSitesRequestError)
            throw IMAGE_EXECUTION_ERRORS.has(error.code) ? error : new TakuSitesRequestError(503, "image_model_unavailable", error.retryAfter, error.requestId);
          throw new Error("invalid_platform_response");
        }
      }, options2.signal).catch((error) => {
        if (error instanceof ImageModelCatalogError)
          throw new TakuSitesRequestError(503, "image_model_unavailable");
        throw error;
      })),
      async listImageModels(input, options2 = {}) {
        const query = parseImageModelQuery(input);
        const search = new URLSearchParams({ operation: query.operation, limit: String(query.limit) });
        if (query.query !== undefined)
          search.set("query", query.query);
        if (query.cursor !== undefined)
          search.set("cursor", query.cursor);
        return withImageModelDeadline(async (signal) => {
          try {
            const value = await request(`/__taku/media/models?${search}`, {
              method: "GET",
              headers: { "X-Taku-CSRF": "1", [IMAGE_MODEL_SIZE_FEATURE_HEADER]: IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1 },
              signal
            }, undefined, (response) => readImageModelJson(response, signal));
            return parseImageModelCatalog(value, query.operation, query.limit, IMAGE_MODEL_GENERATION_REFERENCES_FEATURE_V1);
          } catch (error) {
            if (error instanceof TakuSitesRequestError) {
              if (IMAGE_MODEL_ERRORS.has(error.code))
                throw error;
              throw new TakuSitesRequestError(503, "image_model_catalog_unavailable", undefined, error.requestId);
            }
            if (signal.aborted)
              throw new TakuSitesRequestError(503, "image_model_catalog_unavailable");
            throw new Error("invalid_platform_response");
          }
        }, options2.signal).catch((error) => {
          if (error instanceof ImageModelCatalogError)
            throw new TakuSitesRequestError(error.status, error.code);
          throw error;
        });
      },
      async createInput(contentType, options2 = {}) {
        if (!MEDIA_CONTENT_TYPES.includes(contentType) || options2.operation !== undefined && options2.operation !== "media.image.edit" && options2.operation !== "media.image.generate")
          throw new Error("invalid_media_input");
        const requestId = options2.requestId ?? crypto.randomUUID();
        if (!MEDIA_REQUEST_ID.test(requestId))
          throw new Error("invalid_request_id");
        const value = await request("/__taku/media/inputs/permit", {
          method: "POST",
          headers: { "Idempotency-Key": requestId },
          body: JSON.stringify({
            content_type: contentType,
            ...options2.operation === undefined ? {} : { operation: options2.operation }
          })
        });
        if (!isRecord(value) || Object.keys(value).length !== 5 || typeof value.input_id !== "string" || !MEDIA_INPUT_ID.test(value.input_id) || value.content_type !== contentType || value.upload_path !== `/__taku/media/inputs/${value.input_id}/content` || typeof value.upload_token !== "string" || !MEDIA_PERMIT_TOKEN.test(value.upload_token) || typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at)))
          throw new Error("invalid_platform_response");
        return value;
      },
      async uploadInput(permit, image) {
        if (!baseUrl)
          throw new Error("site_origin_unavailable");
        if (!permit || !MEDIA_INPUT_ID.test(permit.input_id) || !MEDIA_CONTENT_TYPES.includes(permit.content_type) || permit.upload_path !== `/__taku/media/inputs/${permit.input_id}/content` || !MEDIA_PERMIT_TOKEN.test(permit.upload_token) || !Number.isFinite(Date.parse(permit.expires_at)))
          throw new Error("invalid_media_permit");
        if (Date.parse(permit.expires_at) <= Date.now())
          throw new Error("media_upload_permit_expired");
        if (!(image instanceof Blob) || image.type !== permit.content_type || image.size < 1 || image.size > MEDIA_MAX_BYTES)
          throw new Error("invalid_media_input");
        const response = await fetcher(new Request(new URL(permit.upload_path, baseUrl), {
          method: "PUT",
          headers: {
            "Content-Type": image.type,
            "X-Taku-CSRF": "1",
            "X-Taku-Media-Upload-Permit": permit.upload_token
          },
          body: image,
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error"
        })).catch(() => {
          throw new TakuSitesRequestError(503, "platform_unavailable");
        });
        if (!response.ok) {
          let code2 = "request_failed";
          try {
            const body = await response.clone().json();
            if (isRecord(body) && typeof body.error === "string")
              code2 = body.error;
          } catch {}
          throw new TakuSitesRequestError(response.status, code2, retryAfter(response.headers.get("Retry-After")));
        }
        const value = await response.json();
        if (!isRecord(value) || Object.keys(value).length !== 2 || value.input_id !== permit.input_id || typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at)))
          throw new Error("invalid_platform_response");
        return value;
      },
      async editImage(inputId, prompt, options2 = {}) {
        if (!MEDIA_INPUT_ID.test(inputId))
          throw new Error("invalid_media_input_id");
        if (typeof prompt !== "string" || !prompt.trim() || [...prompt.trim()].length > 4000)
          throw new Error("invalid_media_prompt");
        const requestId = options2.requestId ?? crypto.randomUUID();
        if (!MEDIA_REQUEST_ID.test(requestId))
          throw new Error("invalid_request_id");
        if (options2.aspectRatio !== undefined && !["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"].includes(options2.aspectRatio))
          throw new Error("invalid_media_aspect_ratio");
        const value = await request("/__taku/media/edits", {
          method: "POST",
          headers: { "Idempotency-Key": requestId },
          body: JSON.stringify({
            prompt: prompt.trim(),
            input_ids: [inputId],
            ...options2.aspectRatio === undefined ? {} : { aspect_ratio: options2.aspectRatio },
            ...options2.resolution === undefined ? {} : { resolution: options2.resolution },
            ...options2.outputFormat === undefined ? {} : { output_format: options2.outputFormat }
          })
        });
        return startedJob(value, /^med_[0-9a-f]{32}$/);
      },
      async generateImage(prompt, options2 = {}) {
        return generate("images", prompt, options2);
      },
      async generateVideo(prompt, options2 = {}) {
        return generate("videos", prompt, options2);
      },
      async getJob(jobId) {
        if (!MEDIA_JOB_ID.test(jobId))
          throw new Error("invalid_media_job_id");
        const value = await request(`/__taku/media/jobs/${jobId}`, {
          method: "GET",
          headers: { "X-Taku-CSRF": "1" }
        });
        if (!isRecord(value) || value.schema_version !== "taku.site-media-job.v1" || value.job_id !== jobId || typeof value.status !== "string" || typeof value.terminal !== "boolean" || Object.keys(value).some((key) => ![
          "schema_version",
          "job_id",
          "status",
          "terminal",
          "poll_after_ms",
          "asset_content",
          "expires_at"
        ].includes(key)) || value.poll_after_ms !== undefined && (!Number.isSafeInteger(value.poll_after_ms) || value.poll_after_ms < 1000 || value.poll_after_ms > 30000) || value.asset_content !== undefined && (value.status !== "completed" || value.terminal !== true || value.asset_content !== `/__taku/media/jobs/${jobId}/assets/0/content` || typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at))) || value.expires_at !== undefined && (typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at)))) {
          throw new Error("invalid_platform_response");
        }
        return value;
      },
      async getAssetLink(jobId) {
        if (!MEDIA_JOB_ID.test(jobId))
          throw new Error("invalid_media_job_id");
        const value = await request(`/__taku/media/jobs/${jobId}/asset-link`, {
          method: "GET",
          headers: { "X-Taku-CSRF": "1" }
        }, 16 * 1024);
        if (!isRecord(value) || value.schema_version !== "taku.media-asset-link.v1")
          throw new Error("invalid_platform_response");
        if ((value.state === "pending" || value.state === "copying") && Object.keys(value).length === 2)
          throw new TakuSitesRequestError(409, "media_asset_not_ready", 5);
        if (value.state === "failed" && Object.keys(value).length === 4 && typeof value.error_code === "string" && /^[a-z][a-z0-9_]{1,80}$/.test(value.error_code) && typeof value.retryable === "boolean")
          throw new TakuSitesRequestError(value.retryable ? 503 : 422, value.error_code, value.retryable ? 5 : undefined);
        const fields = ["schema_version", "state", "url", "expires_at", "asset_expires_at", "content_type", "byte_length"];
        if (value.state !== "ready" || Object.keys(value).length !== fields.length || !fields.every((key) => Object.hasOwn(value, key)) || typeof value.url !== "string" || value.url.length > 2048 || typeof value.expires_at !== "string" || typeof value.asset_expires_at !== "string" || typeof value.content_type !== "string" || typeof value.byte_length !== "number" || !Number.isSafeInteger(value.byte_length) || value.byte_length < 1)
          throw new Error("invalid_platform_response");
        let url;
        try {
          url = new URL(value.url);
        } catch {
          throw new Error("invalid_platform_response");
        }
        const video = value.content_type.startsWith("video/"), generated = MEDIA_GENERATION_JOB_ID.test(jobId);
        const types = generated && video ? MEDIA_VIDEO_CONTENT_TYPES : MEDIA_CONTENT_TYPES;
        const maxBytes = generated ? (video ? 100 : 25) * 1024 * 1024 : 64 * 1024 * 1024;
        const expires = Date.parse(value.expires_at), assetExpires = Date.parse(value.asset_expires_at), now = Date.now();
        if (url.protocol !== "https:" || url.username || url.password || url.hash || !/^\/media\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/content$/i.test(url.pathname) || [...url.searchParams.keys()].length !== 1 || !url.searchParams.get("ticket") || !types.includes(value.content_type) || value.byte_length > maxBytes || !Number.isFinite(expires) || !Number.isFinite(assetExpires) || expires <= now || expires > now + 330000 || assetExpires < expires)
          throw new Error("invalid_platform_response");
        return { url: url.href, urlExpiresAt: value.expires_at, assetExpiresAt: value.asset_expires_at, contentType: value.content_type, byteLength: value.byte_length };
      },
      async getAsset(jobId) {
        if (!MEDIA_JOB_ID.test(jobId))
          throw new Error("invalid_media_job_id");
        if (!baseUrl)
          throw new Error("site_origin_unavailable");
        const url = new URL(`/__taku/media/jobs/${jobId}/assets/0/content`, baseUrl);
        const response = await fetcher(new Request(url, {
          method: "GET",
          headers: { "X-Taku-CSRF": "1" },
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error"
        })).catch(() => {
          throw new TakuSitesRequestError(503, "platform_unavailable");
        });
        if (!response.ok) {
          let code2 = "request_failed";
          try {
            const body = await response.clone().json();
            if (isRecord(body) && typeof body.error === "string")
              code2 = body.error;
          } catch {}
          throw new TakuSitesRequestError(response.status, code2, retryAfter(response.headers.get("Retry-After")));
        }
        const type = response.headers.get("Content-Type")?.trim() ?? "";
        const length = response.headers.get("Content-Length") ?? "";
        const declared = Number(length);
        const generated = MEDIA_GENERATION_JOB_ID.test(jobId);
        const types = generated ? [...MEDIA_CONTENT_TYPES, ...MEDIA_VIDEO_CONTENT_TYPES] : MEDIA_CONTENT_TYPES;
        if (!types.includes(type) || !/^[1-9][0-9]*$/.test(length) || !Number.isSafeInteger(declared) || declared > (generated ? MEDIA_VIDEO_MAX_BYTES : MEDIA_MAX_BYTES) || !response.body) {
          await response.body?.cancel();
          throw new Error("invalid_platform_response");
        }
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done)
              break;
            received += next.value.byteLength;
            if (received > declared) {
              await reader.cancel();
              throw new Error("invalid_platform_response");
            }
            const copy = new Uint8Array(next.value.byteLength);
            copy.set(next.value);
            chunks.push(copy.buffer);
          }
          if (received !== declared)
            throw new Error("invalid_platform_response");
          return new Blob(chunks, { type });
        } catch (error) {
          if (error instanceof Error && error.message === "invalid_platform_response")
            throw error;
          throw new TakuSitesRequestError(503, "platform_unavailable");
        } finally {
          reader.releaseLock();
        }
      }
    },
    storage: {
      submissions: {
        async create(input, options2 = {}) {
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 3 || typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 100 || typeof input.email !== "string" || input.email.trim().length < 3 || input.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || typeof input.message !== "string" || !input.message.trim() || input.message.trim().length > 4000) {
            throw new Error("invalid_submission");
          }
          const requestId = options2.requestId ?? crypto.randomUUID();
          if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId))
            throw new Error("invalid_request_id");
          const body = JSON.stringify({ name: input.name.trim(), email: input.email.trim(), message: input.message.trim() });
          if (new TextEncoder().encode(body).byteLength > 8 * 1024)
            throw new Error("submission_too_large");
          const value = await request("/__taku/storage/submissions", {
            method: "POST",
            headers: { "Idempotency-Key": requestId },
            body
          });
          if (!isRecord(value) || typeof value.receiptId !== "string" || typeof value.receivedAt !== "string")
            throw new Error("invalid_platform_response");
          return { receiptId: value.receiptId, receivedAt: value.receivedAt };
        }
      },
      personal: {
        async list(collection) {
          const name = capabilityName(collection);
          const value = await request(`/__taku/storage/personal/${name}`);
          if (!isRecord(value) || !Array.isArray(value.records) || !value.records.every((entry) => isRecord(entry) && typeof entry.key === "string" && Object.hasOwn(entry, "value"))) {
            throw new Error("invalid_platform_response");
          }
          return value.records;
        },
        async put(collection, key, value) {
          const name = capabilityName(collection);
          if (!RECORD_KEY.test(key))
            throw new Error("invalid_record_key");
          const body = JSON.stringify(value);
          if (body === undefined || new TextEncoder().encode(body).byteLength > 8 * 1024)
            throw new Error("record_too_large");
          await request(`/__taku/storage/personal/${name}/${key}`, { method: "PUT", body });
        },
        async delete(collection, key) {
          const name = capabilityName(collection);
          if (!RECORD_KEY.test(key))
            throw new Error("invalid_record_key");
          await request(`/__taku/storage/personal/${name}/${key}`, { method: "DELETE" });
        }
      },
      favorites: {
        async list() {
          const value = await request("/__taku/storage/favorites");
          if (!isRecord(value) || !Array.isArray(value.favorites))
            throw new Error("invalid_platform_response");
          return value.favorites;
        },
        async save(favorite) {
          await request("/__taku/storage/favorites", {
            method: "POST",
            body: JSON.stringify({
              listingId: favorite.listingId,
              title: favorite.title,
              imageUrl: favorite.imageUrl,
              priceText: favorite.priceText,
              location: favorite.location,
              deepLink: favorite.deepLink
            })
          });
        },
        async delete(listingId) {
          if (!/^[1-9][0-9]{2,31}$/.test(listingId))
            throw new Error("invalid_listing_id");
          await request("/__taku/storage/favorites/" + listingId, {
            method: "DELETE"
          });
        }
      },
      async query(statement, params = [], options2 = {}) {
        if (!statement.trim() || statement.length > 16384 || params.length > 128) {
          return Promise.reject(new Error("invalid_storage_query"));
        }
        return request("/__taku/storage/query", {
          method: "POST",
          headers: storageRequestHeaders(options2),
          body: JSON.stringify({ statement, params })
        });
      },
      async batch(statements, options2 = {}) {
        if (!Array.isArray(statements) || statements.length < 1 || statements.length > 20) {
          return Promise.reject(new Error("invalid_storage_batch"));
        }
        return request("/__taku/storage/batch", {
          method: "POST",
          headers: storageRequestHeaders(options2),
          body: JSON.stringify({ statements })
        });
      }
    },
    usage: {
      getSummary() {
        return request("/__taku/usage");
      }
    }
  };
}
var taku = createTakuSitesClient();
function storageRequestHeaders(options) {
  if (options.requestId === undefined)
    return {};
  if (typeof options.requestId !== "string" || !/^[A-Za-z0-9._:~-]{16,128}$/.test(options.requestId)) {
    throw new Error("invalid_database_request_id");
  }
  return { "X-Taku-SQL-Request-Id": options.requestId };
}
export {
  taku,
  createTakuSitesClient,
  TakuSitesRequestError,
  SITE_CAPABILITY_INTERNAL_ONLY
};
