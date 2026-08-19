import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { DEFAULT_WORKER_URL } from './publish-config.mjs';
export { STAX_CREATOR_PUBLISH_CONTRACT_VERSION } from './publish-config.mjs';

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_SAME_ORIGIN_REDIRECTS = 4;
const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
];

function hasProxyEnv() {
  return PROXY_ENV_KEYS.some((key) => String(process.env[key] || '').trim());
}

async function fetchWithEnvProxy(url, init = {}) {
  if (!hasProxyEnv() || init.dispatcher) {
    return await fetch(url, init);
  }
  const targetUrl = new URL(url);
  const proxyUrl = resolveProxyUrl(targetUrl);
  if (!proxyUrl) return await fetch(url, init);
  return await fetchViaHttpProxy(targetUrl, proxyUrl, init);
}

function resolveProxyUrl(targetUrl) {
  if (shouldBypassProxy(targetUrl)) return undefined;
  const keys = targetUrl.protocol === 'https:'
    ? ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
    : ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
  const raw = keys.map((key) => process.env[key]).find((value) => String(value || '').trim());
  if (!raw) return undefined;
  const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  const proxyUrl = new URL(normalized);
  if (!['http:', 'https:'].includes(proxyUrl.protocol)) {
    throw new Error(`Unsupported proxy protocol for Worker request: ${proxyUrl.protocol}`);
  }
  return proxyUrl;
}

function shouldBypassProxy(targetUrl) {
  const rawNoProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  if (!rawNoProxy.trim()) return false;
  const targetHost = targetUrl.hostname.toLowerCase();
  const targetPort = targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80');
  return rawNoProxy.split(',').some((entry) => {
    const rule = entry.trim().toLowerCase();
    if (!rule) return false;
    if (rule === '*') return true;
    const [ruleHost, rulePort] = rule.includes(':') ? rule.split(':') : [rule, ''];
    if (rulePort && rulePort !== targetPort) return false;
    if (ruleHost.startsWith('.')) return targetHost.endsWith(ruleHost);
    return targetHost === ruleHost || targetHost.endsWith(`.${ruleHost}`);
  });
}

async function fetchViaHttpProxy(targetUrl, proxyUrl, init = {}) {
  const bodyBuffer = bodyToBuffer(init.body);
  const headers = headersToObject(init.headers);
  if (bodyBuffer && !hasHeader(headers, 'content-length')) {
    headers['content-length'] = String(bodyBuffer.byteLength);
  }
  if (!hasHeader(headers, 'host')) {
    headers.host = targetUrl.host;
  }
  if (!hasHeader(headers, 'accept-encoding')) {
    headers['accept-encoding'] = 'identity';
  }
  if (!hasHeader(headers, 'connection')) {
    headers.connection = 'close';
  }

  if (targetUrl.protocol === 'http:') {
    return await requestThroughProxy(targetUrl, proxyUrl, {
      method: init.method || 'GET',
      path: targetUrl.href,
      headers,
      bodyBuffer,
      signal: init.signal,
    });
  }

  if (targetUrl.protocol === 'https:') {
    const socket = await connectTunnel(targetUrl, proxyUrl, init.signal);
    return await requestOverSocket(targetUrl, socket, {
      method: init.method || 'GET',
      path: `${targetUrl.pathname || '/'}${targetUrl.search}`,
      headers,
      bodyBuffer,
      signal: init.signal,
    });
  }

  throw new Error(`Unsupported Worker URL protocol: ${targetUrl.protocol}`);
}

function bodyToBuffer(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return Buffer.from(body);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  throw new Error('Unsupported request body type for proxied Worker request.');
}

function headersToObject(headersInit) {
  const headers = {};
  new Headers(headersInit).forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function hasHeader(headers, name) {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
}

function proxyRequestOptions(proxyUrl, extra = {}) {
  const headers = { ...(extra.headers || {}) };
  if (proxyUrl.username || proxyUrl.password) {
    const username = decodeURIComponent(proxyUrl.username);
    const password = decodeURIComponent(proxyUrl.password);
    headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }
  return {
    protocol: proxyUrl.protocol,
    hostname: proxyUrl.hostname,
    port: proxyUrl.port || (proxyUrl.protocol === 'https:' ? 443 : 80),
    ...extra,
    headers,
  };
}

function requestThroughProxy(targetUrl, proxyUrl, options) {
  const transport = proxyUrl.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(proxyRequestOptions(proxyUrl, {
      method: options.method,
      path: options.path,
      headers: options.headers,
    }), (response) => collectNodeResponse(response).then(resolve, reject));
    wireAbort(options.signal, request, reject);
    request.on('error', reject);
    if (options.bodyBuffer) request.write(options.bodyBuffer);
    request.end();
  });
}

function connectTunnel(targetUrl, proxyUrl, signal) {
  const transport = proxyUrl.protocol === 'https:' ? https : http;
  const targetPort = targetUrl.port || 443;
  return new Promise((resolve, reject) => {
    const request = transport.request(proxyRequestOptions(proxyUrl, {
      method: 'CONNECT',
      path: `${targetUrl.hostname}:${targetPort}`,
      headers: {
        Host: `${targetUrl.hostname}:${targetPort}`,
      },
    }));
    wireAbort(signal, request, reject);
    request.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed with HTTP ${response.statusCode || 0}.`));
        return;
      }
      const tlsSocket = tls.connect({
        socket,
        servername: targetUrl.hostname,
      }, () => resolve(tlsSocket));
      tlsSocket.once('error', reject);
    });
    request.once('error', reject);
    request.end();
  });
}

function requestOverSocket(targetUrl, socket, options) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      socket.destroy();
      reject(new Error('Request aborted.'));
    };
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('end', () => {
      try {
        resolve(parseRawHttpResponse(Buffer.concat(chunks)));
      } catch (error) {
        reject(error);
      }
    });
    const requestHead = [
      `${options.method} ${options.path} HTTP/1.1`,
      ...Object.entries(options.headers).map(([key, value]) => `${key}: ${value}`),
      '',
      '',
    ].join('\r\n');
    socket.write(Buffer.from(requestHead));
    if (options.bodyBuffer) socket.write(options.bodyBuffer);
  });
}

function wireAbort(signal, request, reject) {
  if (!signal) return;
  const abort = () => {
    request.destroy();
    reject(new Error('Request aborted.'));
  };
  if (signal.aborted) {
    abort();
    return;
  }
  signal.addEventListener('abort', abort, { once: true });
}

async function collectNodeResponse(response) {
  const chunks = [];
  for await (const chunk of response) {
    chunks.push(chunk);
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }
  return new Response(Buffer.concat(chunks), {
    status: response.statusCode || 0,
    statusText: response.statusMessage || '',
    headers,
  });
}

function parseRawHttpResponse(raw) {
  const separator = raw.indexOf('\r\n\r\n');
  if (separator < 0) {
    throw new Error('Proxy response was missing HTTP headers.');
  }
  const headerText = raw.subarray(0, separator).toString('latin1');
  const body = raw.subarray(separator + 4);
  const [statusLine, ...headerLines] = headerText.split('\r\n');
  const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/i.exec(statusLine || '');
  if (!statusMatch) {
    throw new Error('Proxy response had an invalid HTTP status line.');
  }
  const headers = new Headers();
  for (const line of headerLines) {
    const splitIndex = line.indexOf(':');
    if (splitIndex <= 0) continue;
    headers.append(line.slice(0, splitIndex).trim(), line.slice(splitIndex + 1).trim());
  }
  const decodedBody = /chunked/i.test(headers.get('transfer-encoding') || '')
    ? decodeChunkedBody(body)
    : body;
  return new Response(decodedBody, {
    status: Number(statusMatch[1]),
    statusText: statusMatch[2] || '',
    headers,
  });
}

function decodeChunkedBody(body) {
  const chunks = [];
  let offset = 0;
  while (offset < body.length) {
    const lineEnd = body.indexOf('\r\n', offset);
    if (lineEnd < 0) break;
    const sizeText = body.subarray(offset, lineEnd).toString('latin1').split(';')[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) break;
    offset = lineEnd + 2;
    if (size === 0) break;
    chunks.push(body.subarray(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.concat(chunks);
}

export class TakuStaxClient {
  constructor(options = {}) {
    this.baseUrl = String(options.workerUrl || DEFAULT_WORKER_URL).replace(/\/+$/, '');
    this.token = options.token || undefined;
    this.timeoutMs = Number(options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl || fetchWithEnvProxy;
  }

  requireToken() {
    if (!this.token) throw new Error('Missing Stax auth token.');
    return this.token;
  }

  resolveUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  buildHeaders(extra, token) {
    const headers = new Headers(extra);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return headers;
  }

  async fetchJson(path, init = {}, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const requestToken = options.token === undefined ? this.token : options.token;
    const controller = new AbortController();
    const timeoutId = timeoutMs > 0
      ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
    if (init.signal) {
      if (init.signal.aborted) controller.abort();
      else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      let requestUrl = this.resolveUrl(path);
      let response;
      for (let redirectCount = 0; redirectCount <= MAX_SAME_ORIGIN_REDIRECTS; redirectCount += 1) {
        response = await this.fetchImpl(requestUrl, {
          ...init,
          headers: this.buildHeaders(init.headers, requestToken),
          signal: controller.signal,
        });
        if (![307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location || redirectCount === MAX_SAME_ORIGIN_REDIRECTS) break;
        const nextUrl = new URL(location, requestUrl);
        if (nextUrl.origin !== new URL(requestUrl).origin) break;
        requestUrl = nextUrl.toString();
      }
      const rawText = await response.text();
      try {
        return {
          response,
          data: rawText ? JSON.parse(rawText) : {},
          parsedJson: true,
          rawText,
        };
      } catch {
        return {
          response,
          data: { responseText: rawText },
          parsedJson: false,
          rawText,
        };
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Stax API request timed out. Please try again.');
      }
      throw error;
    } finally {
      if (timeoutId) globalThis.clearTimeout(timeoutId);
    }
  }

  async requestJson(path, init = {}, options = {}) {
    const result = await this.fetchJson(path, init, options);
    if (!result.parsedJson) {
      const preview = result.rawText.slice(0, 160).replace(/\s+/g, ' ').trim();
      throw new Error(`Expected JSON from ${path}, got ${result.response.status} ${result.response.statusText}: ${preview}`);
    }
    if (!result.response.ok) {
      throw new Error(result.data?.error || result.data?.message || `HTTP ${result.response.status}`);
    }
    return result.data;
  }

  async getMyProfile() {
    return await this.requestJson('/stax/creators/me', { method: 'GET' }, { token: this.requireToken() });
  }

  async getMyCreatorStats() {
    return await this.requestJson('/stax/creators/me/stats', { method: 'GET' }, { token: this.requireToken() });
  }

  async getMyStaxProfile() {
    return await this.requestJson('/stax/profile', { method: 'GET' }, { token: this.requireToken() });
  }

  async getMyCreatorItems(filters = {}) {
    const query = new URLSearchParams();
    for (const key of ['type', 'status', 'search', 'limit', 'offset']) {
      const value = filters[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        query.set(key, String(value).trim());
      }
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return await this.requestJson(`/stax/items/me${suffix}`, { method: 'GET' }, { token: this.requireToken() });
  }

  async getCreatorItemManagement(itemId) {
    const id = String(itemId || '').trim();
    if (!id) throw new Error('Missing Creator Center item ID.');
    return await this.requestJson(
      `/stax/items/${encodeURIComponent(id)}/management`,
      { method: 'GET' },
      { token: this.requireToken() },
    );
  }

  async updateCreatorItemManagement(itemId, body) {
    const id = String(itemId || '').trim();
    if (!id) throw new Error('Missing Creator Center item ID.');
    return await this.fetchJson(
      `/stax/items/${encodeURIComponent(id)}/management`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
      { token: this.requireToken() },
    );
  }

  async unpublishCreatorItem(itemId) {
    const id = String(itemId || '').trim();
    if (!id) throw new Error('Missing Creator Center item ID.');
    return await this.fetchJson(
      `/stax/items/${encodeURIComponent(id)}/unpublish`,
      { method: 'POST' },
      { token: this.requireToken() },
    );
  }

  async getMyCard() {
    return await this.requestJson('/stax/cards/me', { method: 'GET' }, { token: this.requireToken() });
  }

  async getPublicCard(username) {
    const trimmed = String(username || '').trim();
    if (!trimmed) throw new Error('Missing Stax card username.');
    return await this.requestJson(`/stax/cards/${encodeURIComponent(trimmed)}`, { method: 'GET' }, { token: null });
  }

  async updateMyCard(body) {
    return await this.requestJson('/stax/cards/me', {
      method: 'PUT',
      body: JSON.stringify(body),
    }, { token: this.requireToken() });
  }

  async publishMyCard() {
    return await this.requestJson('/stax/cards/me/publish', { method: 'POST' }, { token: this.requireToken() });
  }

  async importInventoryCard(body) {
    return await this.requestJson('/stax/cards/import-inventory', {
      method: 'POST',
      body: JSON.stringify(body),
    }, { token: this.requireToken() });
  }
}

export function createTakuStaxClient(options = {}) {
  return new TakuStaxClient(options);
}

export function createWorkerPublishError({ response, data, parsedJson, endpoint }) {
  const message = data?.error || data?.message;
  if (message && !(response.status === 404 && /^not found$/i.test(message))) {
    return message;
  }
  if (response.status === 404) {
    const localWorkerUrl = ['http', '://', '127.0.0.1', ':', '7049'].join('');
    return `Publish endpoint not found at ${endpoint}. For local testing, restart the editor with --worker-url ${localWorkerUrl} or set TAKU_WORKER_URL. Otherwise deploy the Worker route.`;
  }
  if (!parsedJson) {
    return `Publish endpoint did not return JSON at ${endpoint}. Check that TAKU_WORKER_URL points to the Taku Worker, not the Taku Web site.`;
  }
  return `HTTP ${response.status}`;
}
