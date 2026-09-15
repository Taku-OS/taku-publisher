import 'server-only';

import { proxyJson } from '@/lib/proxy';

const NANO_BANANA_PRO_GENERATE_PATH = '/service/nano_banana_pro/text_to_image/generate';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_CHARS = 512 * 1024;

export type NanoBananaProGenerateInput = {
  prompt: string;
  num_images?: number;
  aspect_ratio?: string;
  output_format?: string;
  sync_mode?: boolean;
  resolution?: string;
  limit_generations?: boolean;
  enable_web_search?: boolean;
};

export type NanoBananaProGenerateOutput = {
  imageUrls: string[];
  imageUrl: string | null;
  raw: unknown;
};

export type NanoBananaProInputNormalizeResult =
  | { ok: true; value: NanoBananaProGenerateInput }
  | { ok: false; error: string };

export class NanoBananaProServiceError extends Error {
  readonly code: 'INVALID_REQUEST' | 'INVALID_RESPONSE';

  constructor(code: 'INVALID_REQUEST' | 'INVALID_RESPONSE', message: string) {
    super(message);
    this.name = 'NanoBananaProServiceError';
    this.code = code;
  }
}

export function isNanoBananaProServiceError(error: unknown): error is NanoBananaProServiceError {
  return error instanceof NanoBananaProServiceError;
}

export const NANO_BANANA_PRO_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt'],
  properties: {
    prompt: {
      type: 'string',
      description: '图片生成提示词。',
    },
    num_images: {
      type: 'integer',
      minimum: 1,
      maximum: 4,
      description: '生成图片数量，默认 1。',
    },
    aspect_ratio: {
      type: 'string',
      description: '图片宽高比，例如 1:1、16:9。',
    },
    output_format: {
      type: 'string',
      description: '输出格式，例如 png / jpeg / webp。',
    },
    sync_mode: {
      type: 'boolean',
      description: '是否同步模式。',
    },
    resolution: {
      type: 'string',
      description: '分辨率，例如 1K / 2K / 4K。',
    },
    limit_generations: {
      type: 'boolean',
      description: '是否限制每轮生成数量。',
    },
    enable_web_search: {
      type: 'boolean',
      description: '是否启用联网检索增强。',
    },
  },
} as const;

export function normalizeNanoBananaProGenerateInput(
  raw: unknown
): NanoBananaProInputNormalizeResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: '请求体必须是 JSON object' };
  }

  const prompt = asRequiredPrompt(raw.prompt);
  if (!prompt) {
    return { ok: false, error: '缺少必填字段：prompt' };
  }

  const out: NanoBananaProGenerateInput = { prompt };

  const numImages = asOptionalFiniteInt(raw.num_images);
  if (numImages !== undefined) out.num_images = numImages;

  const aspectRatio = asOptionalTrimmedString(raw.aspect_ratio);
  if (aspectRatio) out.aspect_ratio = aspectRatio;

  const outputFormat = asOptionalTrimmedString(raw.output_format);
  if (outputFormat) out.output_format = outputFormat;

  const resolution = asOptionalTrimmedString(raw.resolution);
  if (resolution) out.resolution = resolution;

  if (typeof raw.sync_mode === 'boolean') out.sync_mode = raw.sync_mode;
  if (typeof raw.limit_generations === 'boolean') out.limit_generations = raw.limit_generations;
  if (typeof raw.enable_web_search === 'boolean') out.enable_web_search = raw.enable_web_search;

  return { ok: true, value: out };
}

export async function generateNanoBananaProImage(params: {
  input: NanoBananaProGenerateInput;
  timeoutMs?: number;
  maxResponseChars?: number;
}): Promise<NanoBananaProGenerateOutput> {
  const result = await proxyJson<unknown>(NANO_BANANA_PRO_GENERATE_PATH, {
    method: 'POST',
    json: params.input,
    timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxResponseChars: params.maxResponseChars ?? DEFAULT_MAX_RESPONSE_CHARS,
  });

  const imageUrls = extractImageUrlsFromServicePayload(result);
  if (imageUrls.length === 0) {
    throw new NanoBananaProServiceError(
      'INVALID_RESPONSE',
      '上游返回成功但未解析到 imageUrl（请检查 service artifacts 并更新适配器）'
    );
  }

  return {
    imageUrls,
    imageUrl: imageUrls[0] ?? null,
    raw: result,
  };
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function asOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const next = value.trim();
  return next || undefined;
}

function asRequiredPrompt(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function asOptionalFiniteInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.trunc(value);
}

function isHttpUrl(s: string): boolean {
  return s.startsWith('https://') || s.startsWith('http://');
}

function isImageDataUrl(s: string): boolean {
  return s.startsWith('data:image/');
}

function extractImageUrlsFromServicePayload(payload: unknown): string[] {
  const urls: string[] = [];

  function pushUrl(v: unknown): void {
    if (typeof v !== 'string') return;
    const s = v.trim();
    if (!s) return;
    if (!isHttpUrl(s) && !isImageDataUrl(s)) return;
    urls.push(s);
  }

  function fromImagesArray(arr: unknown): void {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (typeof item === 'string') {
        pushUrl(item);
        continue;
      }
      if (!isPlainObject(item)) continue;
      pushUrl(item.url);
      pushUrl(item.image_url);
      pushUrl(item.imageUrl);
      pushUrl(item.href);
    }
  }

  if (isPlainObject(payload)) {
    pushUrl(payload.url);
    pushUrl(payload.image_url);
    pushUrl(payload.imageUrl);
    fromImagesArray(payload.images);

    if (isPlainObject(payload.data)) {
      pushUrl(payload.data.url);
      pushUrl(payload.data.image_url);
      pushUrl(payload.data.imageUrl);
      fromImagesArray(payload.data.images);
    }

    if (isPlainObject(payload.result)) {
      fromImagesArray(payload.result.images);
    }

    if (isPlainObject(payload.output)) {
      fromImagesArray(payload.output.images);
    }
  } else if (Array.isArray(payload)) {
    fromImagesArray(payload);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }

  return unique;
}
