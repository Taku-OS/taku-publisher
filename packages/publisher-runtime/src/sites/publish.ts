import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { publisherHome, DEFAULT_WORKER_URL } from '../constants.js';
import type { JsonObject } from '../types.js';
import { atomicWriteJson, jsonOutput, PublisherError } from '../util.js';
import type { BuiltSiteArtifact, SitesCore } from './core.js';
import { resolveSitesAuth, SitesHttpClient } from './http.js';
import type { SiteCommandArguments } from './commands.js';

type PublishTarget = { kind: 'new'; slug: string; hostname: string } | { kind: 'existing'; projectId: string; hostname: string };
type Checkpoint = {
  version: 1;
  projectRoot: string;
  userId: string;
  builtAt: string;
  draftId: string;
  target: PublishTarget;
  buildId: string;
  contentDigest: string;
  manifestDigest: string;
  confirmKey: string;
  createKey: string;
  uploadKey: string;
  publishRequestId?: string;
  projectId?: string;
  uploadId?: string;
  artifactDigest?: string;
  uploadedOrdinals?: number[];
};

const PLACEHOLDER_ID = 'prj_pending_cli';

export async function publishSite(args: SiteCommandArguments, core: SitesCore): Promise<JsonObject> {
  const root = path.resolve(required(args, 'project'));
  const workerUrl = optional(args, 'worker-url') ?? DEFAULT_WORKER_URL;
  const allowCustomWorkerUrl = bool(args, 'allow-custom-worker-url');
  const auth = await resolveSitesAuth(process.env, { workerUrl, allowCustomWorkerUrl });
  const client = new SitesHttpClient(
    workerUrl, auth.token, fetch, allowCustomWorkerUrl,
    async expectedAccessToken => (await resolveSitesAuth(process.env, { workerUrl, allowCustomWorkerUrl, force: true, expectedAccessToken })).token,
  );
  const identity = await client.get('/v1/sites/cli-session');
  const userId = typeof identity.userId === 'string' ? identity.userId : '';
  if (!userId || identity.productAccess !== 'allowed') {
    throw new PublisherError('Taku Sites is unavailable for this account.', 'sites_access_denied');
  }
  const project = await core.inspectProject(root);
  const checkpointPath = path.join(publisherHome(), 'sites', 'checkpoints',
    `${createHash('sha256').update(project.projectRoot).digest('hex')}.json`);
  if (bool(args, 'reset')) await rm(checkpointPath, { force: true });
  let checkpoint = await loadCheckpoint(checkpointPath);
  if (checkpoint && (checkpoint.projectRoot !== project.projectRoot || checkpoint.userId !== userId)) {
    throw new PublisherError('Saved Site publish belongs to another project or account.', 'sites_checkpoint_mismatch');
  }
  const requestedProjectId = optional(args, 'project-id');
  let requestedSlug = optional(args, 'slug');
  if (!requestedProjectId && !requestedSlug && !checkpoint && process.stdin.isTTY) {
    requestedSlug = await prompt('Enter the subdomain you want for your Site: ');
  }
  if (!requestedProjectId && !requestedSlug && !checkpoint) {
    const prebuild = await core.buildArtifact(project.projectRoot, {
      projectId: PLACEHOLDER_ID, builtAt: new Date().toISOString(),
    });
    return jsonOutput('needs_input', {
      required: 'slug_or_project_id',
      build_id: prebuild.buildId,
      content_digest: prebuild.contentDigest,
      object_count: prebuild.objects.length,
      instruction: 'Ask the user for one desired subdomain, or an already owned project ID.',
    }, { requiresAction: true, actionType: 'ask_user_for_site_target' });
  }
  if (requestedProjectId && requestedSlug) {
    throw new PublisherError('Choose --slug or --project-id, not both.', 'sites_target_conflict');
  }
  const target = checkpoint?.target ?? await resolveTarget(client, requestedSlug, requestedProjectId);
  if (checkpoint && ((requestedSlug && (target.kind !== 'new' || requestedSlug !== target.slug)) ||
    (requestedProjectId && (target.kind !== 'existing' || requestedProjectId !== target.projectId)))) {
    throw new PublisherError('Target differs from the saved publish. Inspect it before using --reset.', 'sites_target_changed');
  }
  const builtAt = checkpoint?.builtAt ?? new Date().toISOString();
  const prebuild = await core.buildArtifact(project.projectRoot, {
    projectId: target.kind === 'existing' ? target.projectId : PLACEHOLDER_ID, builtAt,
  });
  await core.validateArtifact(project.projectRoot, prebuild);
  if (checkpoint && (checkpoint.buildId !== prebuild.buildId ||
    checkpoint.contentDigest !== prebuild.contentDigest || checkpoint.manifestDigest !== prebuild.manifestDigest)) {
    throw new PublisherError('Site files changed after target confirmation. Review and rerun with --reset.', 'sites_build_changed');
  }
  if (!checkpoint) {
    const exactTarget = target.kind === 'new' ? target.hostname : target.projectId;
    const approved = optional(args, 'confirm-target') === exactTarget ||
      (process.stdin.isTTY && await confirmInteractively(target, prebuild));
    if (!approved) {
      return jsonOutput('needs_input', {
        required: 'confirm_target', confirm_target: exactTarget,
        target, build_id: prebuild.buildId, content_digest: prebuild.contentDigest,
        object_count: prebuild.objects.length, total_bytes: prebuild.totalBytes,
        instruction: 'Show this exact target and build summary to the user. Rerun with --confirm-target only after their explicit confirmation.',
      }, { requiresAction: true, actionType: 'ask_user_to_confirm_site_publish' });
    }
    checkpoint = {
      version: 1, projectRoot: project.projectRoot, userId, builtAt,
      draftId: randomUUID(), target, buildId: prebuild.buildId,
      contentDigest: prebuild.contentDigest, manifestDigest: prebuild.manifestDigest,
      confirmKey: `sites-confirm-${randomUUID()}`,
      createKey: `sites-create-${randomUUID()}`,
      uploadKey: `sites-upload-${randomUUID()}`,
    };
    await saveCheckpoint(checkpointPath, checkpoint);
  }
  if (!checkpoint.publishRequestId) {
    const selection = {
      draftId: checkpoint.draftId, buildId: checkpoint.buildId,
      contentDigest: checkpoint.contentDigest, manifestDigest: checkpoint.manifestDigest,
      target: checkpoint.target.kind === 'new'
        ? { kind: 'new', slug: checkpoint.target.slug }
        : { kind: 'existing', projectId: checkpoint.target.projectId },
    };
    const response = await client.post('/v1/sites/publish-requests', selection, checkpoint.confirmKey);
    checkpoint.publishRequestId = requiredString(response, 'publishRequestId');
    await saveCheckpoint(checkpointPath, checkpoint);
  } else {
    const confirmed = await client.get(`/v1/sites/publish-requests/${checkpoint.publishRequestId}`);
    if (confirmed.buildId !== checkpoint.buildId || confirmed.contentDigest !== checkpoint.contentDigest ||
      confirmed.manifestDigest !== checkpoint.manifestDigest) {
      throw new PublisherError('Server publish request no longer matches the local build.', 'sites_request_mismatch');
    }
  }
  if (!checkpoint.projectId) {
    if (target.kind === 'new') {
      const site = await client.post('/v1/sites', {
        publishRequestId: checkpoint.publishRequestId,
        slug: target.slug, displayName: optional(args, 'name') ?? target.slug,
        manifest: project.siteManifest,
      }, checkpoint.createKey);
      checkpoint.projectId = requiredString(site, 'projectId');
    } else checkpoint.projectId = target.projectId;
    await saveCheckpoint(checkpointPath, checkpoint);
  }
  const artifact = await core.buildArtifact(project.projectRoot, {
    projectId: checkpoint.projectId, builtAt: checkpoint.builtAt,
  });
  if (artifact.buildId !== checkpoint.buildId || artifact.contentDigest !== checkpoint.contentDigest ||
    artifact.manifestDigest !== checkpoint.manifestDigest) {
    throw new PublisherError('Site files changed during publishing.', 'sites_build_changed');
  }
  await core.validateArtifact(project.projectRoot, artifact);
  if (checkpoint.artifactDigest && checkpoint.artifactDigest !== artifact.artifactDigest) {
    throw new PublisherError('Saved artifact identity differs from current files.', 'sites_checkpoint_mismatch');
  }
  checkpoint.artifactDigest = artifact.artifactDigest;
  await saveCheckpoint(checkpointPath, checkpoint);
  const uploadPath = `/v1/sites/${checkpoint.projectId}/artifact-uploads`;
  let upload: Record<string, unknown>;
  if (checkpoint.uploadId) {
    upload = await client.get(`${uploadPath}/${checkpoint.uploadId}`);
  } else {
    upload = await client.post(uploadPath, {
      schema: 'taku.sites.confirmed-upload.v2',
      publishRequestId: checkpoint.publishRequestId,
      contentDigest: checkpoint.contentDigest,
      manifestDigest: checkpoint.manifestDigest,
      descriptor: artifact.descriptor,
    }, checkpoint.uploadKey);
    checkpoint.uploadId = requiredString(upload, 'uploadId');
    await saveCheckpoint(checkpointPath, checkpoint);
  }
  if (upload.artifactDigest !== artifact.artifactDigest) {
    throw new PublisherError('Server upload does not match the local artifact.', 'sites_upload_mismatch');
  }
  if (upload.status !== 'ready') {
    if (!Array.isArray(upload.missingOrdinals)) {
      throw new PublisherError('Server upload omitted object status.', 'sites_invalid_response');
    }
    const missing = upload.missingOrdinals;
    if (missing.some(value => !Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= artifact.objects.length)) {
      throw new PublisherError('Server upload returned invalid object status.', 'sites_invalid_response');
    }
    if (missing.length > 0) {
      let credential = await issueUploadCredential(client, uploadPath, checkpoint.uploadId);
      for (const ordinal of missing as number[]) {
        const object = artifact.objects[ordinal];
        if (!object) throw new PublisherError('Artifact object is missing.', 'sites_build_changed');
        const bytes = await core.readArtifactObject(object);
        const objectPath = `${uploadPath}/${checkpoint.uploadId}/objects/${ordinal}`;
        try {
          await client.putObject(objectPath, bytes, credential);
        } catch (error) {
          if (!(error instanceof PublisherError) || error.code !== 'sites_api_error' || error.details.http_status !== 401) throw error;
          credential = await issueUploadCredential(client, uploadPath, checkpoint.uploadId);
          await client.putObject(objectPath, bytes, credential);
        }
        checkpoint.uploadedOrdinals = [...new Set([...(checkpoint.uploadedOrdinals ?? []), ordinal])];
        await saveCheckpoint(checkpointPath, checkpoint);
      }
    }
    const current = await client.get(`${uploadPath}/${checkpoint.uploadId}`);
    if (!Array.isArray(current.missingOrdinals)) {
      throw new PublisherError('Server upload omitted object status.', 'sites_invalid_response');
    }
    if (current.missingOrdinals.length > 0) {
      throw new PublisherError('Some Site objects are still missing on the server.', 'sites_upload_incomplete');
    }
    await client.post(`${uploadPath}/${checkpoint.uploadId}/finalize`, {});
  }
  const waitSeconds = Number(optional(args, 'wait-seconds') ?? 60);
  if (!Number.isSafeInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 600) {
    throw new PublisherError('--wait-seconds must be between 0 and 600.', 'invalid_arguments');
  }
  const deadline = Date.now() + waitSeconds * 1000;
  let site: Record<string, unknown>;
  do {
    site = await client.get(`/v1/sites/${checkpoint.projectId}`);
    if (site.status === 'active' && site.currentReleaseId === artifact.releaseId) {
      await rm(checkpointPath, { force: true });
      return jsonOutput('sites_published', {
        project_id: checkpoint.projectId, publish_request_id: checkpoint.publishRequestId,
        upload_id: checkpoint.uploadId, release_id: artifact.releaseId,
        url: `https://${target.hostname}`, ready: true,
      });
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(2_000, deadline - Date.now())));
  } while (true);
  return jsonOutput('sites_publishing', {
    project_id: checkpoint.projectId, publish_request_id: checkpoint.publishRequestId,
    upload_id: checkpoint.uploadId, release_id: artifact.releaseId,
    url: `https://${target.hostname}`, ready: false, site_status: String(site.status ?? 'unknown'),
    next_command: `sites-status --project-id ${checkpoint.projectId}`,
  }, { requiresAction: true, actionType: 'check_site_status' });
}

async function resolveTarget(client: SitesHttpClient, slug?: string, projectId?: string): Promise<PublishTarget> {
  if (projectId) {
    const site = await client.get(`/v1/sites/${encodeURIComponent(projectId)}`);
    return { kind: 'existing', projectId: requiredString(site, 'projectId'), hostname: requiredString(site, 'hostname') };
  }
  if (!slug) throw new PublisherError('Site target is required.', 'sites_target_required');
  const eligibility = await client.get('/v1/sites/publish-eligibility');
  if (eligibility.eligible !== true) {
    throw new PublisherError('This account cannot create another Site now.', 'sites_not_eligible');
  }
  const availability = await client.get(`/v1/sites/slugs/${encodeURIComponent(slug)}/availability`);
  if (availability.available !== true) {
    throw new PublisherError('The requested subdomain is unavailable. Ask the user for another one.', 'sites_slug_unavailable', {
      slug: String(availability.slug ?? slug), reason: String(availability.reason ?? 'unavailable'),
    });
  }
  return { kind: 'new', slug: requiredString(availability, 'slug'), hostname: requiredString(availability, 'hostname') };
}

async function issueUploadCredential(client: SitesHttpClient, basePath: string, uploadId: string): Promise<string> {
  const response = await client.post(`${basePath}/${uploadId}/upload-credential`, {});
  const token = requiredString(response, 'token');
  if (!token.startsWith('taku_su_')) throw new PublisherError('Invalid upload credential response.', 'sites_invalid_response');
  return token;
}

async function loadCheckpoint(file: string): Promise<Checkpoint | null> {
  let value: unknown;
  try { value = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new PublisherError('Saved Site publish checkpoint is invalid.', 'sites_checkpoint_invalid');
  }
  if (!value || typeof value !== 'object' || (value as Checkpoint).version !== 1) {
    throw new PublisherError('Saved Site publish checkpoint is invalid.', 'sites_checkpoint_invalid');
  }
  return value as Checkpoint;
}

async function saveCheckpoint(file: string, value: Checkpoint): Promise<void> {
  await atomicWriteJson(file, value as unknown as JsonObject);
}

async function confirmInteractively(target: PublishTarget, artifact: BuiltSiteArtifact): Promise<boolean> {
  process.stderr.write(`Publish ${artifact.objects.length} objects (${artifact.totalBytes} bytes) to ${target.kind === 'new' ? target.hostname : target.projectId}?\n`);
  const expected = target.kind === 'new' ? target.hostname : target.projectId;
  return (await prompt(`Type ${expected} to confirm: `)) === expected;
}

async function prompt(question: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try { return (await reader.question(question)).trim(); } finally { reader.close(); }
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== 'string' || !result.trim()) {
    throw new PublisherError(`Taku Sites response lacked ${key}.`, 'sites_invalid_response');
  }
  return result;
}

function optional(args: SiteCommandArguments, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function required(args: SiteCommandArguments, name: string): string {
  const value = optional(args, name);
  if (!value) throw new PublisherError(`Missing required argument: --${name}`, 'missing_argument', { argument: name });
  return value;
}

function bool(args: SiteCommandArguments, name: string): boolean {
  return args.flags.get(name) === true || args.flags.get(name) === 'true';
}
