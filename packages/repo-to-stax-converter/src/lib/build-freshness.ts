import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { computeTreeDigest } from './tree-digest.js';

const BUILD_MANIFEST_NAME = '.source-digest.json';
const BUILD_MANIFEST_SCHEMA = 'repo-to-stax.source-digest.v1';

interface BuildManifest {
  schemaVersion: typeof BUILD_MANIFEST_SCHEMA;
  sourceDigest: string;
}

export async function writeConverterBuildManifest(projectRoot: string): Promise<void> {
  const sourceDigest = await computeTreeDigest(join(projectRoot, 'src'));
  const distRoot = join(projectRoot, 'dist');
  await mkdir(distRoot, { recursive: true });
  await writeFile(
    join(distRoot, BUILD_MANIFEST_NAME),
    `${JSON.stringify({ schemaVersion: BUILD_MANIFEST_SCHEMA, sourceDigest }, null, 2)}\n`
  );
}

export async function assertFreshConverterBuild(projectRoot: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await readFile(join(projectRoot, 'dist', BUILD_MANIFEST_NAME), 'utf8')
    );
  } catch {
    throw new Error('Converter build manifest is missing or malformed; run pnpm build.');
  }

  if (!isBuildManifest(parsed)) {
    throw new Error('Converter build manifest is missing or malformed; run pnpm build.');
  }

  let sourceDigest: string;
  try {
    sourceDigest = await computeTreeDigest(join(projectRoot, 'src'));
  } catch {
    throw new Error(
      'Converter source tree is unavailable; reinstall the package including src or run pnpm build.'
    );
  }
  if (sourceDigest !== parsed.sourceDigest) {
    throw new Error('Converter dist is stale relative to src; run pnpm build.');
  }
}

export async function converterProjectRootForCompiledRuntime(
  runtimeEntryFile: string
): Promise<string | null> {
  const canonicalEntry = await realpath(runtimeEntryFile);
  if (extname(canonicalEntry) !== '.js') return null;
  return resolve(dirname(canonicalEntry), '..');
}

function isBuildManifest(value: unknown): value is BuildManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record.schemaVersion === BUILD_MANIFEST_SCHEMA &&
    typeof record.sourceDigest === 'string' &&
    /^sha256:[0-9a-f]{64}$/.test(record.sourceDigest)
  );
}
