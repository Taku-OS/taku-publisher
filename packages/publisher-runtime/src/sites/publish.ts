import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { publisherHome, DEFAULT_WORKER_URL } from '../constants.js';
import type { JsonObject } from '../types.js';
import { atomicWriteJson, jsonOutput, PublisherError } from '../util.js';
import type { BuiltSiteArtifact, SiteMaterialFile, SitesCore } from './core.js';
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
  uploadDescriptor?: BuiltSiteArtifact['descriptor'];
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
      ...materialSummary(prebuild),
      instruction: 'Ask the user for one desired subdomain, or an already owned project ID.',
    }, { requiresAction: true, actionType: 'ask_user_for_site_target' });
  }
  if (requestedProjectId && requestedSlug) {
    throw new PublisherError('Choose --slug or --project-id, not both.', 'sites_target_conflict');
  }
  const reset = bool(args, 'reset');
  const confirmed = checkpoint?.publishRequestId ? await readConfirmedRequest(client, checkpoint) : null;
  const boundProjectId = confirmed?.projectId as string | null | undefined;
  const needsConfirmation = reset || (confirmed !== null && (
    confirmed.status === 'expired' || confirmed.status === 'cancelled' ||
    (!boundProjectId && Date.parse(String(confirmed.expiresAt)) <= Date.now())
  ));
  let target = checkpoint?.target ?? await resolveTarget(client, requestedSlug, requestedProjectId);
  let preserveDraft = true;
  const retainedProjectId = boundProjectId ?? (target.kind === 'existing' ? target.projectId : undefined);
  const matchesSavedTarget = (!requestedSlug || requestedSlug === (target.kind === 'new' ? target.slug : target.hostname.replace(/\.taku\.site$/, '')))
    && (!requestedProjectId || requestedProjectId === retainedProjectId);
  if (checkpoint && !matchesSavedTarget && !reset) {
    throw new PublisherError('Target differs from the saved publish. Inspect it before using --reset.', 'sites_target_changed');
  }
  if (checkpoint && needsConfirmation) {
    if (!matchesSavedTarget) {
      target = await resolveTarget(client, requestedSlug, requestedProjectId);
      preserveDraft = false;
    } else if (retainedProjectId) {
      const ownedTarget = await resolveTarget(client, undefined, retainedProjectId);
      if (ownedTarget.hostname !== target.hostname) {
        throw new PublisherError('Owned Site no longer matches the saved target.', 'sites_request_mismatch');
      }
      target = ownedTarget;
    }
  }
  const builtAt = checkpoint?.builtAt ?? new Date().toISOString();
  const prebuild = await core.buildArtifact(project.projectRoot, {
    projectId: target.kind === 'existing' ? target.projectId : PLACEHOLDER_ID, builtAt,
  });
  await core.validateArtifact(project.projectRoot, prebuild);
  if (checkpoint && !reset && (checkpoint.buildId !== prebuild.buildId ||
    checkpoint.contentDigest !== prebuild.contentDigest || checkpoint.manifestDigest !== prebuild.manifestDigest)) {
    throw new PublisherError('Site files changed after target confirmation. Review and rerun with --reset.', 'sites_build_changed');
  }
  const previousCheckpoint = checkpoint;
  if (needsConfirmation) checkpoint = null;
  if (!checkpoint) {
    const exactTarget = target.kind === 'new' ? target.hostname : target.projectId;
    const approved = optional(args, 'confirm-target') === exactTarget ||
      (process.stdin.isTTY && await confirmInteractively(target, prebuild));
    if (!approved) {
      return jsonOutput('needs_input', {
        required: 'confirm_target', confirm_target: exactTarget,
        target, build_id: prebuild.buildId, content_digest: prebuild.contentDigest,
        object_count: prebuild.objects.length, total_bytes: prebuild.totalBytes,
        ...materialSummary(prebuild),
        instruction: 'Show this exact target and build summary to the user. Rerun with --confirm-target only after their explicit confirmation.',
      }, { requiresAction: true, actionType: 'ask_user_to_confirm_site_publish' });
    }
    if (previousCheckpoint && (previousCheckpoint.uploadId || (boundProjectId && previousCheckpoint.artifactDigest))) {
      await settlePreviousUpload(client, core, checkpointPath, previousCheckpoint, boundProjectId ?? previousCheckpoint.projectId!);
    }
    checkpoint = {
      version: 1, projectRoot: project.projectRoot, userId, builtAt,
      draftId: preserveDraft && previousCheckpoint ? previousCheckpoint.draftId : randomUUID(),
      target, buildId: prebuild.buildId,
      contentDigest: prebuild.contentDigest, manifestDigest: prebuild.manifestDigest,
      confirmKey: `sites-confirm-${randomUUID()}`,
      createKey: `sites-create-${randomUUID()}`,
      uploadKey: `sites-upload-${randomUUID()}`,
      ...(target.kind === 'existing' ? { projectId: target.projectId } : {}),
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
  }
  // Reconcile a committed Site whose create response never reached this CLI.
  if (!needsConfirmation && boundProjectId && !checkpoint.projectId) {
    checkpoint.projectId = boundProjectId;
    await saveCheckpoint(checkpointPath, checkpoint);
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
  checkpoint.uploadDescriptor = artifact.descriptor;
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
    await uploadMaterials(client, core, artifact, `${uploadPath}/${checkpoint.uploadId}`);
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

async function settlePreviousUpload(
  client: SitesHttpClient, core: SitesCore, file: string, checkpoint: Checkpoint, projectId: string,
): Promise<void> {
  const base = `/v1/sites/${projectId}/artifact-uploads`;
  if (!checkpoint.uploadId) {
    let descriptor = checkpoint.uploadDescriptor;
    if (!descriptor) {
      const oldBuild = await core.buildArtifact(checkpoint.projectRoot, { projectId, builtAt: checkpoint.builtAt });
      if (oldBuild.artifactDigest !== checkpoint.artifactDigest) {
        throw new PublisherError('The old upload response is unknown and its original descriptor is unavailable. Keep this checkpoint and reconcile the old upload before resetting.', 'sites_upload_recovery_required');
      }
      descriptor = oldBuild.descriptor;
    }
    const recovered = await client.post(base, {
      schema: 'taku.sites.confirmed-upload.v2', publishRequestId: checkpoint.publishRequestId,
      contentDigest: checkpoint.contentDigest, manifestDigest: checkpoint.manifestDigest, descriptor,
    }, checkpoint.uploadKey);
    if (recovered.projectId !== projectId || recovered.artifactDigest !== checkpoint.artifactDigest) {
      throw new PublisherError('Recovered upload differs from the saved artifact.', 'sites_upload_mismatch');
    }
    checkpoint.uploadId = requiredString(recovered, 'uploadId');
    await saveCheckpoint(file, checkpoint);
  }
  const uploadPath = `${base}/${checkpoint.uploadId}`;
  const read = async () => {
    const upload = await client.get(uploadPath);
    if (upload.uploadId !== checkpoint.uploadId || upload.projectId !== projectId || upload.artifactDigest !== checkpoint.artifactDigest) {
      throw new PublisherError('Old upload differs from the saved artifact.', 'sites_upload_mismatch');
    }
    if (!['initiated', 'uploading', 'finalizing', 'ready', 'cancelled', 'expired', 'failed'].includes(String(upload.status))) {
      throw new PublisherError('Old upload has an invalid recovery state.', 'sites_invalid_response');
    }
    return upload;
  };
  const upload = await read();
  if (!['initiated', 'uploading', 'finalizing'].includes(String(upload.status))) return;
  try {
    const cancelled = await client.delete(uploadPath);
    if (cancelled.status !== 'cancelled') {
      throw new PublisherError('Old upload cancellation is not confirmed. Retry without discarding its checkpoint.', 'sites_upload_recovery_required');
    }
  } catch (error) {
    if (!(error instanceof PublisherError) || error.details.http_status !== 409 || error.details.server_error !== 'ARTIFACT_ALREADY_READY') throw error;
  }
  if (['initiated', 'uploading', 'finalizing'].includes(String((await read()).status))) {
    throw new PublisherError('Old upload is still in progress. Keep its checkpoint and retry reconciliation.', 'sites_upload_recovery_required');
  }
}

async function readConfirmedRequest(client: SitesHttpClient, checkpoint: Checkpoint): Promise<Record<string, unknown>> {
  const confirmed = await client.get(`/v1/sites/publish-requests/${checkpoint.publishRequestId}`);
  const expectedTarget = checkpoint.target.kind === 'new'
    ? { kind: 'new', slug: checkpoint.target.slug }
    : { kind: 'existing', projectId: checkpoint.target.projectId };
  const actualTarget = confirmed.target as Record<string, unknown> | null;
  if (confirmed.publishRequestId !== checkpoint.publishRequestId || confirmed.draftId !== checkpoint.draftId ||
    confirmed.buildId !== checkpoint.buildId || confirmed.contentDigest !== checkpoint.contentDigest ||
    confirmed.manifestDigest !== checkpoint.manifestDigest || !actualTarget ||
    actualTarget.kind !== expectedTarget.kind || (expectedTarget.kind === 'new'
      ? actualTarget.slug !== expectedTarget.slug : actualTarget.projectId !== expectedTarget.projectId)) {
    throw new PublisherError('Server publish request no longer matches the saved confirmation.', 'sites_request_mismatch');
  }
  if ((confirmed.projectId !== null && (typeof confirmed.projectId !== 'string' || !confirmed.projectId.trim())) ||
    typeof confirmed.expiresAt !== 'string' || !Number.isFinite(Date.parse(confirmed.expiresAt)) ||
    !['confirmed', 'reserved', 'uploading', 'deploying', 'active', 'failed', 'cancelled', 'expired'].includes(String(confirmed.status))) {
    throw new PublisherError('Server publish request has invalid recovery state.', 'sites_invalid_response');
  }
  const expectedProjectId = checkpoint.projectId ?? (checkpoint.target.kind === 'existing' ? checkpoint.target.projectId : undefined);
  if ((expectedProjectId && confirmed.projectId !== null && confirmed.projectId !== expectedProjectId) ||
    (checkpoint.target.kind === 'new' && checkpoint.projectId && confirmed.projectId !== checkpoint.projectId)) {
    throw new PublisherError('Server publish request is bound to a different Site.', 'sites_request_mismatch');
  }
  return confirmed;
}

export function materialSummary(artifact: BuiltSiteArtifact) {
  const materials = artifact.materials;
  return {
    material_count: materials.length,
    material_bytes: materials.reduce((sum, file) => sum + file.size, 0),
    material_retention: {
      permanent: materials.filter(file => file.retention === 'permanent').length,
      temporary: materials.filter(file => file.retention === 'temporary').length,
      temporary_ttl_seconds: 2592000,
    },
  };
}

async function uploadMaterials(client: SitesHttpClient, core: SitesCore, artifact: BuiltSiteArtifact, uploadPath: string): Promise<void> {
  // Metadata/owner/retention comes only from the confirmed descriptor on the
  // server. Replays use the same upload+ordinal; no provider credentials persist.
  for (const [ordinal, file] of artifact.materials.entries()) {
    const base = `${uploadPath}/assets/${ordinal}`;
    const started = await client.postEmpty(base);
    verifyMaterialReceipt(started, file);
    if (started.state === 'ready') continue;
    for (let partNumber = 1; partNumber <= Number(started.partCount); partNumber++) {
      const bytes = await core.readMaterialPart(file, partNumber);
      const received = await client.putMaterialPart(`${base}/parts/${partNumber}`, bytes);
      if (received.assetId !== started.assetId || received.partNumber !== partNumber || received.status !== 'uploaded') {
        throw new PublisherError('Material part receipt does not match the upload.', 'sites_invalid_response');
      }
    }
    const completed = await client.postEmpty(`${base}/complete`);
    verifyMaterialReceipt(completed, file);
    if (completed.assetId !== started.assetId || completed.state !== 'ready') {
      throw new PublisherError('Material verification is not complete. Retry the same command.', 'sites_material_incomplete');
    }
  }
}

function verifyMaterialReceipt(value: Record<string, unknown>, file: SiteMaterialFile): void {
  if (typeof value.assetId !== 'string' || !/^ast_[a-f0-9]{32}$/.test(value.assetId)
    || !['ready', 'uploading'].includes(String(value.state))
    || value.sha256 !== file.sha256 || value.byteLength !== file.size
    || value.contentType !== file.contentType || value.retention !== file.retention
    || value.visibility !== file.visibility || value.partBytes !== 8 * 1024 * 1024
    || value.partCount !== Math.ceil(file.size / (8 * 1024 * 1024))
    || (file.retention === 'permanent' ? value.expiresAt !== null
      : typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)))) {
    throw new PublisherError('Material receipt differs from the confirmed file.', 'sites_invalid_response');
  }
}

async function resolveTarget(client: SitesHttpClient, slug?: string, projectId?: string): Promise<PublishTarget> {
  if (projectId) {
    const site = await client.get(`/v1/sites/${encodeURIComponent(projectId)}`);
    return { kind: 'existing', projectId: requiredString(site, 'projectId'), hostname: requiredString(site, 'hostname') };
  }
  if (!slug) throw new PublisherError('Site target is required.', 'sites_target_required');
  const eligibility = await client.get('/v1/sites/publish-eligibility');
  if (eligibility.eligible !== true) {
    const limitReached = eligibility.quotaConfigured === true && eligibility.available === 0 &&
      typeof eligibility.max === 'number' && Number.isSafeInteger(eligibility.max) && eligibility.max > 0 &&
      typeof eligibility.occupied === 'number' && Number.isSafeInteger(eligibility.occupied) && eligibility.occupied >= eligibility.max;
    throw new PublisherError(limitReached
      ? 'No new Site slots are available. The same local project and build are retained. Free a slot or review plans, then retry the same command for a fresh confirmation.'
      : 'This account cannot create another Site now. Check the current server policy; the local project is retained.',
    'sites_not_eligible', { project_preserved: true, ...(limitReached
      ? { eligibility_reason: 'SITE_LIMIT_REACHED', upgrade_url: 'https://taku.ai/pricing' } : {}) });
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
  const summary = materialSummary(artifact);
  if (summary.material_count) process.stderr.write(`Materials: ${summary.material_count} files, ${summary.material_bytes} bytes of account storage; ${summary.material_retention.permanent} permanent, ${summary.material_retention.temporary} temporary (30 days).\n`);
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
