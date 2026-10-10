import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ONLY_NOOP_URL = new URL('./test-server-only-noop.mjs', import.meta.url).href;
const SOURCE_ROOT_PATH = fileURLToPath(new URL('../src/', import.meta.url));
const TYPESCRIPT_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

function isWithinRoot(rootDir, filePath) {
  const relativePath = path.relative(rootDir, filePath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}

function isWorkspaceTypeScriptSource(url) {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'file:') return false;

  const filePath = fileURLToPath(parsedUrl);
  if (!TYPESCRIPT_SOURCE_EXTENSIONS.has(path.extname(filePath))) return false;

  try {
    const metadata = fs.lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
    const sourceRoot = fs.realpathSync(SOURCE_ROOT_PATH);
    const canonicalFile = fs.realpathSync(filePath);
    const relativePath = path.relative(sourceRoot, canonicalFile);
    return (
      isWithinRoot(sourceRoot, canonicalFile) &&
      !relativePath.split(path.sep).includes('node_modules')
    );
  } catch {
    return false;
  }
}

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return { shortCircuit: true, url: SERVER_ONLY_NOOP_URL };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  return nextLoad(url, isWorkspaceTypeScriptSource(url) ? { ...context, format: 'module' } : context);
}
