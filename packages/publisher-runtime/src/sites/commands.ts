import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_WORKER_URL } from '../constants.js';
import type { JsonObject } from '../types.js';
import { isRecord, jsonOutput, PublisherError } from '../util.js';
import { browserSdkBytes, loadSitesCore, type ImageModelQuery, type SitesCore } from './core.js';
import { resolveSitesAuth, SitesHttpClient } from './http.js';
import { materialSummary, publishSite } from './publish.js';
import { downloadOwnerMaterial } from './material-download.js';

export type SiteCommandArguments = {
  command: string;
  flags: Map<string, string | boolean>;
};

export async function runSiteCommand(args: SiteCommandArguments): Promise<JsonObject> {
  const { core, provenance } = await loadSitesCore();
  if (OWNER_COMMANDS.has(args.command)) return ownerMaterialCommand(args, core);
  if (args.command === 'sites-image-models') return imageModelCommand(args, core);
  if (args.command === 'sites-contract') {
    // Capability availability is server-owned; pass the live catalog through unchanged.
    const client = await sitesClient(args);
    const capabilities = await client.get('/v1/sites/capabilities') as JsonObject;
    const ownerAssets = core.parseOwnerAssetCapabilities(await client.get('/v1/sites/assets/capabilities'));
    if (!ownerAssets) throw new PublisherError('The authenticated owner material contract is invalid. Do not infer capacity or permission.', 'sites_owner_contract_invalid');
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
      owner_assets: ownerAssets as JsonObject,
      image_models: {
        schema: 'taku.image-model-catalog.v1',
        command: 'sites-image-models --operation <media.image.generate|media.image.edit> [--query <text>] [--cursor <cursor>] [--limit 1..100]',
        operations: ['media.image.generate', 'media.image.edit'],
        surface: 'site-published', discovery_scope: 'sites.read',
        default_limit: 50, maximum_limit: 100, maximum_response_bytes: 524288, deadline_ms: 10000,
        inference: false, runtime_permission_required: true,
      },
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
      ...materialSummary(artifact),
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
  if (args.command === 'sites-preview') {
    const { startSitePreview } = await import('./preview.js');
    const projectRoot = path.resolve(required(args, 'project'));
    const rawPort = optional(args, 'port');
    if (rawPort && (!/^[0-9]{4,5}$/.test(rawPort) || Number(rawPort) < 1024 || Number(rawPort) > 65535))
      throw new PublisherError('Preview port must be between 1024 and 65535.', 'sites_preview_invalid_port');
    const artifact = await core.buildArtifact(projectRoot, { projectId: 'prj_pending_cli', builtAt: new Date().toISOString() });
    await core.validateArtifact(projectRoot, artifact);
    const preview = await startSitePreview({ core, artifact, client: await sitesClient(args), sdkBytes: await browserSdkBytes(), port: rawPort ? Number(rawPort) : undefined });
    const stop = () => { void preview.stop().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return jsonOutput('sites_preview_ready', { url: preview.url, expires_at: new Date(preview.expiresAt).toISOString(),
      pid: preview.pid, build_id: artifact.buildId, manifest_digest: artifact.manifestDigest,
      private: true, loopback_only: true, published: false,
      storage: 'unavailable; browser-local drafts remain available',
      stop: 'Ctrl+C in this foreground process; no public URL is created.' });
  }
  if (args.command === 'sites-publish') return publishSite(args, core);
  throw new PublisherError(`Unknown Sites command: ${args.command}`, 'unknown_command');
}

const OWNER_COMMANDS = new Map([
  ['sites-assets-policy', 'assets.policy'],
  ['sites-assets-list', 'assets.list'],
  ['sites-assets-resolve', 'assets.resolve'],
  ['sites-assets-download', 'assets.resolve'],
  ['sites-assets-delete', 'assets.delete'],
]);
const ASSET_ID = /^ast_[a-f0-9]{32}$/;

async function imageModelCommand(args: SiteCommandArguments, core: SitesCore): Promise<JsonObject> {
  const allowed = new Set(['operation', 'query', 'cursor', 'limit', 'worker-url', 'allow-custom-worker-url', 'json']);
  let query: ImageModelQuery;
  try {
    if ([...args.flags.keys()].some(key => !allowed.has(key))) throw new Error('invalid_query');
    const rawLimit = args.flags.get('limit');
    if (rawLimit !== undefined && (typeof rawLimit !== 'string' || !/^[1-9]\d{0,2}$/.test(rawLimit))) throw new Error('invalid_limit');
    query = core.parseImageModelQuery({
      operation: args.flags.get('operation'),
      ...(args.flags.has('query') ? { query: args.flags.get('query') } : {}),
      ...(args.flags.has('cursor') ? { cursor: args.flags.get('cursor') } : {}),
      ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
    });
  } catch {
    throw new PublisherError('Use an exact image operation, bounded query/cursor and a limit from 1 to 100.', 'sites_image_model_query_invalid');
  }
  const catalog = await (await sitesClient(args)).getImageModelCatalog(query, core);
  return jsonOutput('sites_image_models', {
    operation: query.operation, surface: 'site-published', catalog: catalog as JsonObject,
    notice: 'Discovery does not authorize inference. Preserve catalog availability and declare the required runtime operation and scope.',
  });
}

async function ownerMaterialCommand(args: SiteCommandArguments, core: SitesCore): Promise<JsonObject> {
  const operationId = OWNER_COMMANDS.get(args.command);
  const assetId = optional(args, 'asset-id');
  const after = optional(args, 'after');
  const rawLimit = optional(args, 'limit') ?? '50';
  const limit = Number(rawLimit);
  if ((operationId === 'assets.list' && (!/^\d{1,3}$/.test(rawLimit) || limit < 1 || limit > 100 || (after !== undefined && !ASSET_ID.test(after)))) ||
    (['assets.resolve', 'assets.delete'].includes(operationId ?? '') && (!assetId || !ASSET_ID.test(assetId)))) {
    throw new PublisherError('Use an exact asset ID and a list limit from 1 to 100.', 'sites_asset_arguments_invalid');
  }
  if (operationId === 'assets.delete' && optional(args, 'confirm-asset-id') !== assetId) {
    throw new PublisherError('Confirm deletion of the exact asset ID with --confirm-asset-id.', 'sites_asset_delete_confirmation_required');
  }
  const output = args.command === 'sites-assets-download' ? required(args, 'output') : undefined;
  const client = await sitesClient(args);
  const catalog = core.parseOwnerAssetCapabilities(await client.get('/v1/sites/assets/capabilities'));
  if (!catalog) throw new PublisherError('The authenticated owner material contract is invalid.', 'sites_owner_contract_invalid');
  const operation = Array.isArray(catalog.operations)
    ? catalog.operations.find(candidate => isRecord(candidate) && candidate.id === operationId) : undefined;
  if (!isRecord(operation) || operation.authorized !== true || operation.available !== true) {
    throw new PublisherError('This owner material operation is unavailable for the current account.', 'sites_owner_operation_unavailable', {
      operation: operationId ?? null, reason: isRecord(operation) && typeof operation.reason === 'string' ? operation.reason : null,
    });
  }
  const invalid = () => new PublisherError('Taku returned invalid owner material metadata.', 'sites_owner_response_invalid');
  if (operationId === 'assets.policy') {
    const policy = core.parseOwnerAssetPolicy(await client.get('/v1/sites/assets/policy'));
    if (!policy) throw invalid();
    return jsonOutput('sites_asset_policy', { policy: policy as JsonObject });
  }
  if (operationId === 'assets.list') {
    const query = new URLSearchParams({ limit: String(limit) });
    if (after) query.set('after', after);
    const page = core.parseOwnerAssetPage(await client.get(`/v1/sites/assets?${query}`));
    if (!page) throw invalid();
    return jsonOutput('sites_assets_list', { assets: page.assets as JsonObject[], next: page.next });
  }
  const endpoint = `/v1/sites/assets/${assetId}`;
  const asset = core.parseOwnerAssetRecord(await (operationId === 'assets.delete' ? client.delete(endpoint) : client.get(endpoint)));
  if (!asset || asset.assetId !== assetId || (operationId === 'assets.delete' && !['deleting', 'deleted'].includes(String(asset.state)))) throw invalid();
  if (output) {
    const saved = await downloadOwnerMaterial(client, asset, output);
    return jsonOutput('sites_asset_downloaded', { asset_id: assetId!, output: saved.output, byte_length: saved.byteLength, sha256: saved.sha256 });
  }
  return jsonOutput(operationId === 'assets.delete' ? `sites_asset_${asset.state}` : 'sites_asset_resolved', {
    asset: asset as JsonObject, ...(operationId === 'assets.resolve' ? {
      content_fetched: false,
      download_command: `sites-assets-download --asset-id ${assetId} --output <new-local-file>`,
    } : {}),
  });
}

async function sitesClient(args: SiteCommandArguments): Promise<SitesHttpClient> {
  const workerUrl = optional(args, 'worker-url') ?? DEFAULT_WORKER_URL;
  const allowCustomWorkerUrl = flag(args, 'allow-custom-worker-url');
  const auth = await resolveSitesAuth(process.env, { workerUrl, allowCustomWorkerUrl });
  return new SitesHttpClient(
    workerUrl, auth.token, fetch, allowCustomWorkerUrl,
    async expectedAccessToken => (await resolveSitesAuth(process.env, { workerUrl, allowCustomWorkerUrl, force: true, expectedAccessToken })).token,
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
