import { createServer } from 'node:http';
import { realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const rootInput = process.argv[2];
if (!rootInput) throw new Error('preview_assets_required');
const root = await realpath(rootInput);
const types: Record<string, string> = {
  '.css': 'text/css', '.html': 'text/html', '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript',
  '.json': 'application/json', '.mjs': 'text/javascript', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp',
};

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const requested = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!within(requested, root)) { response.writeHead(403).end(); return; }
    let target = requested;
    let info = await stat(target).catch(() => null);
    if (!info?.isFile()) {
      target = path.join(root, 'index.html');
      info = await stat(target).catch(() => null);
    }
    if (!info?.isFile() || !within(await realpath(target), root)) { response.writeHead(404).end(); return; }
    const bytes = await readFile(target);
    response.setHeader('Content-Type', `${types[path.extname(target).toLowerCase()] ?? 'application/octet-stream'}; charset=utf-8`);
    response.setHeader('Content-Length', bytes.byteLength);
    response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(400).end(); }
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('preview_listen_failed');
  process.send?.({ port: address.port });
  process.disconnect?.();
});
const ttlSeconds = Number(process.argv[3]);
setTimeout(() => server.close(),
  Number.isSafeInteger(ttlSeconds) && ttlSeconds >= 1 && ttlSeconds <= 1800
    ? ttlSeconds * 1000 : 30 * 60_000).unref();

function within(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
