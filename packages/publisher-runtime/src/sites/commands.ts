import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_WORKER_URL } from '../constants.js';
import type { JsonObject } from '../types.js';
import { jsonOutput, PublisherError } from '../util.js';
import { browserSdkBytes, loadSitesCore } from './core.js';
import { resolveSitesAuth, SitesHttpClient } from './http.js';
import { publishSite } from './publish.js';

export type SiteCommandArguments = {
  command: string;
  flags: Map<string, string | boolean>;
};

export async function runSiteCommand(args: SiteCommandArguments): Promise<JsonObject> {
  const { core, provenance } = await loadSitesCore();
  if (args.command === 'sites-contract') {
    // Capability availability is server-owned; pass the live catalog through unchanged.
    const capabilities = await (await sitesClient(args)).get('/v1/sites/capabilities') as JsonObject;
    return jsonOutput('sites_contract', {
      contract_version: core.SITE_CLI_CONTRACT_VERSION,
      source_commit: provenance.sourceCommit,
      artifact_limits: core.ARTIFACT_LIMITS,
      project_config: {
        file: 'taku.site.json',
        workerEntrypoint: 'dist/worker.mjs',
        assetsDirectory: 'dist/assets',
        migrationsDirectory: 'migrations (optional)',
        siteManifest: {
          manifestVersion: 1, auth: { mode: 'none', scopes: [] }, integrations: [],
          storage: { type: 'turso', migrations: false }, egress: { mode: 'platform-proxy' },
        },
      },
      sdk: {
        command: 'sites-sdk-export --output <project>/dist/assets/taku-sites-sdk.mjs',
        browser_import: '/taku-sites-sdk.mjs',
        rule: 'Browser-only. Declare every SDK scope and integration operation in siteManifest before building.',
      },
      capabilities,
      workflow: ['sites-login', 'sites-whoami', 'sites-contract', 'build_and_test_in_harness', 'sites-validate', 'sites-publish'],
      publish_rule: 'The user enters one exact subdomain or chooses an owned projectId and confirms the exact target.',
    });
  }
  if (args.command === 'sites-init') {
    const projectRoot = path.resolve(required(args, 'project'));
    await mkdir(path.join(projectRoot, 'dist/assets'), { recursive: true });
    const config = {
      workerEntrypoint: 'dist/worker.mjs', assetsDirectory: 'dist/assets',
      siteManifest: {
        manifestVersion: 1, auth: { mode: 'none', scopes: [] }, integrations: [],
        storage: { type: 'turso', migrations: false }, egress: { mode: 'platform-proxy' },
      },
    };
    const files = [
      ['taku.site.json', `${JSON.stringify(config, null, 2)}\n`],
      ['dist/worker.mjs', `export default {\n  async fetch(request, env) {\n    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });\n    return env.ASSETS.fetch(request);\n  },\n};\n`],
      ['dist/assets/index.html', '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New Taku Site</title><main><h1>New Taku Site</h1><p>Replace this page with your Site, then validate and publish it.</p></main></html>\n'],
    ] as const;
    for (const [relative] of files) {
      if (await stat(path.join(projectRoot, relative)).then(() => true, () => false)) {
        throw new PublisherError('Site template would overwrite an existing file.', 'sites_project_exists', { file: relative });
      }
    }
    for (const [relative, content] of files) {
      const handle = await open(path.join(projectRoot, relative), 'wx').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') throw new PublisherError('Site template would overwrite an existing file.', 'sites_project_exists', { file: relative });
        throw error;
      });
      try { await handle.writeFile(content); } finally { await handle.close(); }
    }
    return jsonOutput('sites_project_created', { project_root: projectRoot, files: files.map(([name]) => name) });
  }
  if (args.command === 'sites-sdk-export') {
    const output = path.resolve(required(args, 'output'));
    await mkdir(path.dirname(output), { recursive: true });
    const bytes = await browserSdkBytes();
    await writeFile(output, bytes, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') throw new PublisherError('SDK output already exists; remove it explicitly before updating.', 'sites_sdk_exists');
      throw error;
    });
    return jsonOutput('sites_sdk_exported', { output, source_commit: provenance.sourceCommit });
  }
  if (args.command === 'sites-validate' || args.command === 'sites-build') {
    const projectRoot = path.resolve(required(args, 'project'));
    const project = await core.inspectProject(projectRoot);
    const artifact = await core.buildArtifact(projectRoot, {
      projectId: optional(args, 'project-id') ?? 'prj_pending_cli',
      builtAt: new Date().toISOString(),
    });
    await core.validateArtifact(projectRoot, artifact);
    return jsonOutput(args.command === 'sites-build' ? 'sites_built' : 'sites_valid', {
      project_root: project.projectRoot,
      contract_version: core.SITE_CLI_CONTRACT_VERSION,
      build_id: artifact.buildId,
      content_digest: artifact.contentDigest,
      manifest_digest: artifact.manifestDigest,
      total_bytes: artifact.totalBytes,
      object_count: artifact.objects.length,
      project_id: optional(args, 'project-id') ?? null,
      artifact_digest: optional(args, 'project-id') ? artifact.artifactDigest : null,
      objects: artifact.objects.map(({ ordinal, kind, logicalName, size, sha256 }) => ({ ordinal, kind, name: logicalName, size, sha256 })),
      notice: 'Artifact bytes remain local until sites-publish confirms the target.',
    });
  }
  if (args.command === 'sites-whoami' || args.command === 'sites-list' || args.command === 'sites-status') {
    const client = await sitesClient(args);
    const session = await client.get('/v1/sites/cli-session');
    if (args.command === 'sites-whoami') return jsonOutput('sites_identity', { identity: session as JsonObject });
    if (args.command === 'sites-list') return jsonOutput('sites_list', { identity: session as JsonObject, ...await client.get('/v1/sites') as JsonObject });
    const projectId = required(args, 'project-id');
    return jsonOutput('sites_status', { identity: session as JsonObject, site: await client.get(`/v1/sites/${encodeURIComponent(projectId)}`) as JsonObject });
  }
  if (args.command === 'sites-publish') return publishSite(args, core);
  throw new PublisherError(`Unknown Sites command: ${args.command}`, 'unknown_command');
}

async function sitesClient(args: SiteCommandArguments): Promise<SitesHttpClient> {
  const auth = await resolveSitesAuth();
  return new SitesHttpClient(
    optional(args, 'worker-url') ?? DEFAULT_WORKER_URL,
    auth.token, fetch, flag(args, 'allow-custom-worker-url'),
  );
}

export function optional(args: SiteCommandArguments, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function required(args: SiteCommandArguments, name: string): string {
  const value = optional(args, name);
  if (!value) throw new PublisherError(`Missing required argument: --${name}`, 'missing_argument', { argument: name });
  return value;
}

export function flag(args: SiteCommandArguments, name: string): boolean {
  return args.flags.get(name) === true || args.flags.get(name) === 'true';
}
