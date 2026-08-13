import { createReadStream } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import type { Socket } from 'node:net';
import * as tls from 'node:tls';

import type { Transport, TransportResponse } from './api.js';

const MAX_UPLOAD_RESPONSE_BYTES = 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
const FORBIDDEN_REDIRECT_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-taku-auth',
]);

export type FileUploadTransport = (
  method: string,
  url: string,
  headers: Record<string, string>,
  file: string,
  timeoutMs: number,
) => Promise<TransportResponse>;

export function bufferedFileUploadTransport(transport: Transport): FileUploadTransport {
  return async (method, url, headers, file, timeoutMs) => {
    const { readFile } = await import('node:fs/promises');
    return transport(method, url, headers, await readFile(file), timeoutMs);
  };
}

export async function streamFileUploadTransport(
  method: string,
  url: string,
  headers: Record<string, string>,
  file: string,
  timeoutMs: number,
): Promise<TransportResponse> {
  const signal = AbortSignal.timeout(timeoutMs);
  let target = new URL(url);
  let requestHeaders = { ...headers };

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await sendFileRequest(method, target, requestHeaders, file, signal);
    const location = headerValue(response.headers, 'location');
    if (!REDIRECT_STATUSES.has(response.status) || !location || redirects === 3) {
      return response;
    }
    const redirected = new URL(location, target);
    if (redirected.protocol !== 'https:' && !loopback(redirected.hostname)) {
      return response;
    }
    if (redirected.origin !== target.origin) {
      requestHeaders = Object.fromEntries(
        Object.entries(requestHeaders).filter(
          ([name]) => !FORBIDDEN_REDIRECT_HEADERS.has(name.toLowerCase()),
        ),
      );
    }
    target = redirected;
  }

  throw new Error('Upload redirect limit exceeded.');
}

async function sendFileRequest(
  method: string,
  target: URL,
  headers: Record<string, string>,
  file: string,
  signal: AbortSignal,
): Promise<TransportResponse> {
  const proxy = proxyUrlFor(target, process.env);
  if (!proxy) return directFileRequest(method, target, headers, file, signal);
  if (target.protocol === 'https:') {
    return tunneledHttpsFileRequest(method, target, proxy, headers, file, signal);
  }
  return proxiedHttpFileRequest(method, target, proxy, headers, file, signal);
}

function directFileRequest(
  method: string,
  target: URL,
  headers: Record<string, string>,
  file: string,
  signal: AbortSignal,
): Promise<TransportResponse> {
  const request = target.protocol === 'https:' ? https.request : http.request;
  return issueFileRequest(
    callback => request(target, { method, headers, signal }, callback),
    file,
  );
}

function proxiedHttpFileRequest(
  method: string,
  target: URL,
  proxy: URL,
  headers: Record<string, string>,
  file: string,
  signal: AbortSignal,
): Promise<TransportResponse> {
  const request = proxy.protocol === 'https:' ? https.request : http.request;
  const proxyHeaders = {
    ...headers,
    Host: target.host,
    ...proxyAuthorization(proxy),
  };
  return issueFileRequest(
    callback => request({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port || defaultPort(proxy),
      method,
      path: target.href,
      headers: proxyHeaders,
      signal,
    }, callback),
    file,
  );
}

async function tunneledHttpsFileRequest(
  method: string,
  target: URL,
  proxy: URL,
  headers: Record<string, string>,
  file: string,
  signal: AbortSignal,
): Promise<TransportResponse> {
  const socket = await connectProxy(target, proxy, signal);
  const secureSocket = tls.connect({
    socket,
    servername: target.hostname,
    ALPNProtocols: ['http/1.1'],
  });
  await new Promise<void>((resolve, reject) => {
    const abort = () => secureSocket.destroy(signal.reason);
    const cleanup = () => signal.removeEventListener('abort', abort);
    secureSocket.once('secureConnect', () => {
      cleanup();
      resolve();
    });
    secureSocket.once('error', error => {
      cleanup();
      reject(error);
    });
    signal.addEventListener('abort', abort, { once: true });
  });
  return issueFileRequest(
    callback => https.request({
      protocol: 'https:',
      hostname: target.hostname,
      port: target.port || '443',
      path: `${target.pathname}${target.search}`,
      method,
      headers,
      agent: false,
      createConnection: () => secureSocket,
      signal,
    }, callback),
    file,
  );
}

function connectProxy(target: URL, proxy: URL, signal: AbortSignal): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const request = proxy.protocol === 'https:' ? https.request : http.request;
    const targetPort = target.port || '443';
    const connect = request({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port || defaultPort(proxy),
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
      headers: {
        Host: `${target.hostname}:${targetPort}`,
        ...proxyAuthorization(proxy),
      },
      signal,
    });
    connect.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Upload proxy CONNECT failed with HTTP ${response.statusCode ?? 0}.`));
        return;
      }
      if (head.length > 0) socket.unshift(head);
      resolve(socket);
    });
    connect.once('error', reject);
    connect.end();
  });
}

function issueFileRequest(
  createRequest: (callback: (response: http.IncomingMessage) => void) => http.ClientRequest,
  file: string,
): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const request = createRequest(response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', chunk => {
        const data = Buffer.from(chunk);
        size += data.length;
        if (size > MAX_UPLOAD_RESPONSE_BYTES) {
          response.destroy(new Error('Upload response exceeded the safe size limit.'));
          return;
        }
        chunks.push(data);
      });
      response.once('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: responseHeaders(response),
        body: new Uint8Array(Buffer.concat(chunks)),
      }));
      response.once('error', reject);
    });
    request.once('error', reject);
    const source = createReadStream(file);
    source.once('error', error => request.destroy(error));
    source.pipe(request);
  });
}

function responseHeaders(response: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

function proxyUrlFor(target: URL, env: NodeJS.ProcessEnv): URL | undefined {
  if (loopback(target.hostname) || bypassProxy(target, env.NO_PROXY ?? env.no_proxy)) {
    return undefined;
  }
  const value = target.protocol === 'https:'
    ? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy ?? env.ALL_PROXY ?? env.all_proxy
    : env.HTTP_PROXY ?? env.http_proxy ?? env.ALL_PROXY ?? env.all_proxy;
  if (!value) return undefined;
  try {
    const proxy = new URL(value);
    return proxy.protocol === 'http:' || proxy.protocol === 'https:' ? proxy : undefined;
  } catch {
    return undefined;
  }
}

function bypassProxy(target: URL, value?: string): boolean {
  const hostname = target.hostname.toLowerCase();
  const port = target.port || defaultPort(target);
  return String(value ?? '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
    .some(entry => {
      if (entry === '*') return true;
      const token = entry.startsWith('.') ? entry.slice(1) : entry;
      const separator = token.lastIndexOf(':');
      const hasPort = separator > 0 && /^\d+$/.test(token.slice(separator + 1));
      const tokenHost = hasPort ? token.slice(0, separator) : token;
      const tokenPort = hasPort ? token.slice(separator + 1) : '';
      return (!tokenPort || tokenPort === port)
        && (hostname === tokenHost || hostname.endsWith(`.${tokenHost}`));
    });
}

function proxyAuthorization(proxy: URL): Record<string, string> {
  if (!proxy.username && !proxy.password) return {};
  const username = decodeURIComponent(proxy.username);
  const password = decodeURIComponent(proxy.password);
  return {
    'Proxy-Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
  };
}

function defaultPort(url: URL): string {
  return url.protocol === 'https:' ? '443' : '80';
}

function loopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.');
}

function headerValue(headers: Record<string, string>, name: string): string {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1] ?? '';
}
