import 'server-only';

import { getProxyAccessToken, getProxyAppId, getProxyBaseUrl } from './env';
import { ProxyError, safeSnippet } from './errors';

const LOG_PREFIX = '[ProxyFetch]';

export type ProxyFetchInit = RequestInit & {
  /**
   * 请求级超时（毫秒）。
   * - 不设置：不额外加超时（由上游/平台决定）
   */
  timeoutMs?: number;
};

export type ProxyJsonRequestInit = Omit<ProxyFetchInit, 'body'> & {
  /**
   * 传入对象即可，内部会 JSON.stringify，并自动设置 Content-Type。
   */
  json?: unknown;

  /**
   * 限制读取的响应体字符数（仅用于错误/解析场景，避免把巨大响应体写入错误信息/日志）。
   *
   * 重要：成功路径（2xx）不会因为该参数而截断响应体，否则会造成 JSON 被截断 → 解析失败（INVALID_JSON）。
   */
  maxResponseChars?: number;
};

export type ProxyUploadInit = Omit<ProxyFetchInit, 'method' | 'body'> & {
  /**
   * 上传内容（Buffer/Blob/Stream/FormData 均可）。
   */
  body: BodyInit;

  /**
   * 可选：显式覆盖上传请求 Content-Type。
   */
  contentType?: string;

  /**
   * 限制读取上传响应体字符数（仅错误/解析场景）。
   */
  maxResponseChars?: number;
};

export type ProxyUploadResult = {
  /**
   * 上传后的可访问 URL（来自 ai-proxy `/upload/*` 响应中的 `url`）。
   */
  url: string;
  /**
   * 原始响应解析结果（JSON 对象或文本）。
   */
  raw: unknown;
};

function buildUrl(path: string): string {
  const baseUrl = getProxyBaseUrl();
  const rawPath = (path ?? '').trim();
  if (!rawPath) {
    throw new ProxyError({ code: 'INVALID_REQUEST', message: `${LOG_PREFIX} 缺少请求路径 path` });
  }
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
    throw new ProxyError({
      code: 'INVALID_REQUEST',
      message: `${LOG_PREFIX} path 必须是相对路径（禁止传入绝对 URL）`,
    });
  }
  if (rawPath.startsWith('//')) {
    throw new ProxyError({
      code: 'INVALID_REQUEST',
      message: `${LOG_PREFIX} path 不能以 "//" 开头`,
    });
  }
  return new URL(rawPath.startsWith('/') ? rawPath : `/${rawPath}`, baseUrl).toString();
}

function mergeHeaders(params: {
  initHeaders?: HeadersInit;
  accessToken: string;
  appId: string;
}): Headers {
  const headers = new Headers(params.initHeaders);

  // 禁止上游覆盖 Authorization / X-App-Id（避免误把别的 token 发出去、或破坏计费归因）
  headers.delete('authorization');
  headers.delete('x-app-id');

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json, text/plain, */*');
  }

  headers.set('Authorization', `Bearer ${params.accessToken}`);
  headers.set('X-App-Id', params.appId);

  return headers;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs?: number
): Promise<Response> {
  if (!timeoutMs) return await fetch(url, init);

  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  // 合并外部 signal
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const method = (init.method ?? 'GET').toUpperCase();
    if (didTimeout) {
      throw new ProxyError({
        code: 'TIMEOUT',
        message: `${LOG_PREFIX} 请求超时：${timeoutMs}ms`,
        url,
        method,
        cause: error,
      });
    }
    throw new ProxyError({
      code: 'NETWORK_ERROR',
      message: `${LOG_PREFIX} 网络错误`,
      url,
      method,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readTextWithLimit(res: Response, maxChars: number): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!maxChars || maxChars <= 0) return text;
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…(truncated)`;
}

async function throwProxyHttpError(params: {
  res: Response;
  url: string;
  method: string;
  maxResponseChars: number;
}): Promise<never> {
  const text = await readTextWithLimit(params.res, params.maxResponseChars);
  const snippet = safeSnippet(text, 800);

  const status = params.res.status;
  const code =
    status === 401 ? 'UNAUTHORIZED' : status === 402 ? 'PAYMENT_REQUIRED' : ('HTTP_ERROR' as const);
  const hint =
    status === 401
      ? '鉴权失败：token 过期或无效。请回到 Taku 重新登录后再重开/刷新 SubApp。'
      : status === 402
        ? '余额不足：credits 不足。请充值/升级套餐后再试。'
        : '上游服务返回错误状态码。';

  throw new ProxyError({
    code,
    status,
    url: params.url,
    method: params.method,
    message: `${LOG_PREFIX} 请求失败：HTTP ${status} ${params.res.statusText}。${hint}${snippet ? ` ${snippet}` : ''}`,
  });
}

function maybeParseJson(text: string, contentType?: string): unknown | undefined {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return undefined;

  const isJsonContentType = (contentType ?? '').toLowerCase().includes('application/json');
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!isJsonContentType && !looksLikeJson) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new ProxyError({
      code: 'INVALID_JSON',
      message: `${LOG_PREFIX} 响应不是合法 JSON`,
      cause: error,
    });
  }
}

function normalizeUploadPath(uploadPath: string): string {
  const raw = (uploadPath ?? '').trim();
  if (!raw) {
    throw new ProxyError({
      code: 'INVALID_REQUEST',
      message: `${LOG_PREFIX} uploadPath 不能为空`,
    });
  }

  let normalized = raw.replace(/^\/+/, '');
  if (normalized.toLowerCase().startsWith('upload/')) {
    normalized = normalized.slice('upload/'.length);
  }
  normalized = normalized.replace(/^\/+/, '');

  if (!normalized) {
    throw new ProxyError({
      code: 'INVALID_REQUEST',
      message: `${LOG_PREFIX} uploadPath 无效（缺少文件路径）`,
    });
  }
  if (normalized.includes('..')) {
    throw new ProxyError({
      code: 'INVALID_REQUEST',
      message: `${LOG_PREFIX} uploadPath 不允许包含 ".."`,
    });
  }

  return normalized;
}

function extractUploadUrl(payload: unknown): string | null {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.url === 'string' && record.url.trim()) return record.url.trim();
    if (record.data && typeof record.data === 'object') {
      const nested = record.data as Record<string, unknown>;
      if (typeof nested.url === 'string' && nested.url.trim()) return nested.url.trim();
    }
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
  }

  return null;
}

/**
 * 最底层 fetch（server-only）：
 * - 自动注入 `Authorization: Bearer <TAKU_SERVICE_API_KEY>`
 * - 自动注入 `X-App-Id: <TAKU_APPLICATION_ID>`
 * - 强制使用宿主注入的 baseUrl（不允许绝对 URL）
 */
export async function proxyFetch(path: string, init: ProxyFetchInit = {}): Promise<Response> {
  const { timeoutMs, headers, ...rest } = init;

  const accessToken = getProxyAccessToken();
  const appId = getProxyAppId();
  const url = buildUrl(path);

  const mergedHeaders = mergeHeaders({ initHeaders: headers, accessToken, appId });
  const method = (rest.method ?? 'GET').toUpperCase();

  return await fetchWithTimeout(url, { ...rest, method, headers: mergedHeaders }, timeoutMs);
}

/**
 * JSON 便捷方法（server-only）：
 * - 自动 JSON.stringify
 * - 自动处理非 2xx 报错（抛 ProxyError）
 */
export async function proxyJson<T = unknown>(
  path: string,
  init: ProxyJsonRequestInit = {}
): Promise<T> {
  const { json, headers, timeoutMs, maxResponseChars = 512 * 1024, ...rest } = init;

  const mergedHeaders = new Headers(headers);
  // 仅当提供 json 时才设置 Content-Type，避免破坏 FormData 等场景
  if (json !== undefined && !mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', 'application/json');
  }

  const res = await proxyFetch(path, {
    ...rest,
    timeoutMs,
    headers: mergedHeaders,
    body: json === undefined ? undefined : JSON.stringify(json),
  });

  const url = res.url || buildUrl(path);
  const method = (rest.method ?? 'GET').toUpperCase();
  if (!res.ok) {
    // 仅错误路径才限制响应体读取长度，避免巨大错误体导致内存/日志问题
    await throwProxyHttpError({ res, url, method, maxResponseChars });
  }

  // 成功路径：不截断读取（避免 JSON 被截断导致 INVALID_JSON）
  const text = await res.text().catch(() => '');

  // 空响应体：返回 undefined（由调用方自行约束 T）
  if (!text.trim()) return undefined as T;

  const contentType = res.headers.get('content-type') ?? undefined;
  const parsed = (() => {
    try {
      return maybeParseJson(text, contentType);
    } catch (error) {
      // 解析失败时，避免把巨大响应体塞进错误里（只保留有限 snippet）
      const snippet = safeSnippet(
        text.length <= maxResponseChars ? text : `${text.slice(0, maxResponseChars)}…(truncated)`,
        800
      );
      throw new ProxyError({
        code: 'INVALID_JSON',
        message: `${LOG_PREFIX} 响应不是合法 JSON${snippet ? ` ${snippet}` : ''}`,
        cause: error,
      });
    }
  })();
  if (parsed !== undefined) return parsed as T;

  // 不是 JSON：直接返回字符串（兼容 text/plain）
  return text as unknown as T;
}

/**
 * SSE 透传（server-only）：
 * - 适合在 Next Route Handler 中把上游 SSE 直接转给前端
 * - 只做“请求级”鉴权和错误处理，不做内容解析/重试（避免重复输出/重复计费）
 */
export async function proxySse(path: string, init: ProxyFetchInit = {}): Promise<Response> {
  const { headers, ...rest } = init;
  const mergedHeaders = new Headers(headers);
  if (!mergedHeaders.has('Accept')) {
    mergedHeaders.set('Accept', 'text/event-stream');
  }

  const res = await proxyFetch(path, { ...rest, headers: mergedHeaders });
  const url = res.url || buildUrl(path);
  const method = (rest.method ?? 'GET').toUpperCase();

  if (!res.ok) {
    await throwProxyHttpError({ res, url, method, maxResponseChars: 64 * 1024 });
  }

  const outHeaders = new Headers();
  outHeaders.set(
    'content-type',
    res.headers.get('content-type') ?? 'text/event-stream; charset=utf-8'
  );
  outHeaders.set('cache-control', 'no-cache, no-transform');
  outHeaders.set('x-accel-buffering', 'no');

  const requestId = res.headers.get('x-request-id');
  if (requestId) outHeaders.set('x-request-id', requestId);

  return new Response(res.body, { status: 200, headers: outHeaders });
}

/**
 * 文件上传（server-only）：
 * - 走 ai-proxy `/upload/*`，自动注入 Authorization + X-App-Id
 * - 仅提供 helper；模板内不主动调用
 */
export async function proxyUpload(
  uploadPath: string,
  init: ProxyUploadInit
): Promise<ProxyUploadResult> {
  const { body, headers, timeoutMs, contentType, maxResponseChars = 256 * 1024, ...rest } = init;

  const normalizedPath = normalizeUploadPath(uploadPath);
  const requestPath = `/upload/${normalizedPath}`;
  const mergedHeaders = new Headers(headers);
  if (contentType && !mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', contentType);
  }

  const res = await proxyFetch(requestPath, {
    ...rest,
    timeoutMs,
    method: 'PUT',
    headers: mergedHeaders,
    body,
  });

  const url = res.url || buildUrl(requestPath);
  const method = 'PUT';
  if (!res.ok) {
    await throwProxyHttpError({ res, url, method, maxResponseChars });
  }

  const text = await res.text().catch(() => '');
  const contentTypeHeader = res.headers.get('content-type') ?? undefined;
  const parsed = maybeParseJson(text, contentTypeHeader);
  const raw = parsed !== undefined ? parsed : text;
  const uploadedUrl = extractUploadUrl(raw);
  if (!uploadedUrl) {
    const snippet = safeSnippet(
      text.length <= maxResponseChars ? text : `${text.slice(0, maxResponseChars)}…(truncated)`,
      800
    );
    throw new ProxyError({
      code: 'INVALID_JSON',
      message: `${LOG_PREFIX} 上传响应缺少 url 字段${snippet ? ` ${snippet}` : ''}`,
      url,
      method,
    });
  }

  return { url: uploadedUrl, raw };
}
