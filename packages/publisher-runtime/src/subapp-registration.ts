import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  SUBAPP_BUILD_ARCHIVE_FILE,
  SUBAPP_BUILD_OUTPUT_DIRECTORY,
  SUBAPP_SOURCE_ARCHIVE_FILE,
} from '@taku/subapp-contract';
import { responseCandidates } from './api.js';
import { assertPublicPayload } from './scanner.js';
import type { JsonObject, JsonValue } from './types.js';
import {
  atomicWriteJson,
  isRecord,
  nowIso,
  PublisherError,
  readJson,
  sha256File,
  sortJson,
} from './util.js';

const PACKAGE_SCHEMA = 'taku.publisher.subapp-package.v1';
const REGISTRATION_SCHEMA = 'taku.publisher.subapp-registration.v1';
const REGISTRATION_STATE_SCHEMA = 'taku.publisher.subapp-registration-state.v1';
const REGISTRATION_STATE_FILE = 'registration-state.json';
const REGISTRATION_RECEIPT_FILE = 'registration-receipt.json';
const APP_PACKAGES_BUCKET = 'app-packages';
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;

type RegistrationMode = 'create' | 'update';
type AuthorshipKind = 'original' | 'derived' | 'third_party';
type RightsBasis = 'self_owned' | 'open_source_license' | 'explicit_permission';

export interface SubAppRegistrationClient {
  upsertAppCatalog(payload: JsonObject): Promise<JsonObject>;
  getNextAppVersionNumber(appId: string): Promise<JsonObject>;
  createAppSignedUpload(payload: JsonObject): Promise<JsonObject>;
  uploadSigned(
    uploadUrl: string,
    file: string,
    headers?: Record<string, string>,
  ): Promise<void>;
  createAppVersion(payload: JsonObject): Promise<JsonObject>;
}

export interface SubAppRegistrationPlan {
  packageRoot: string;
  mode: RegistrationMode;
  appId?: string;
  packageDigest: string;
  packageManifest: JsonObject;
  metadata: JsonObject;
  confirmationToken: string;
  remoteOperations: string[];
  resumeState?: JsonObject;
  uploadStarted: boolean;
  registrationStarted: boolean;
  publishStarted: false;
}

export interface SubAppRegistrationResult {
  packageRoot: string;
  appId: string;
  versionNumber: number;
  status: 'private_draft_registered';
  source: JsonObject;
  build: JsonObject;
  receipt: JsonObject;
  reviewPath?: string;
  reviewUrl?: string;
  uploadStarted: true;
  registrationStarted: true;
  publishStarted: false;
}

export async function planSubAppRegistration(request: {
  packageRoot: string;
  metadata: JsonObject;
  mode: string;
  appId?: string;
}): Promise<SubAppRegistrationPlan> {
  const packageRoot = await canonicalPackageRoot(request.packageRoot);
  const mode = registrationMode(request.mode);
  const appId = normalizeRequestedAppId(mode, request.appId);
  const packageManifest = await verifyPackage(packageRoot);
  const metadata = normalizeRegistrationMetadata(request.metadata);
  assertPublicPayload(metadata);
  const packageDigest = registrationPackageDigest(packageManifest);
  const confirmationToken = registrationConfirmationToken({
    mode,
    appId,
    packageDigest,
    metadata,
  });
  const resumeState = await loadRegistrationResumeState(packageRoot, {
    mode,
    appId,
    packageDigest,
    confirmationToken,
  });
  const remoteOperations = resumeState
    ? resumeRemoteOperations(String(resumeState.status))
    : [
        'create-or-update-private-catalog-draft',
        'allocate-next-version',
        'upload-source-archive',
        'upload-build-archive',
        'register-private-app-version',
      ];
  return {
    packageRoot,
    mode,
    ...(appId ? { appId } : {}),
    packageDigest,
    packageManifest,
    metadata,
    confirmationToken,
    remoteOperations,
    ...(resumeState ? { resumeState } : {}),
    uploadStarted: resumeState?.status === 'uploading',
    registrationStarted: Boolean(resumeState),
    publishStarted: false,
  };
}

export async function registerSubAppDraft(
  request: {
    packageRoot: string;
    metadata: JsonObject;
    mode: string;
    appId?: string;
    confirmationToken: string;
  },
  client: SubAppRegistrationClient,
): Promise<SubAppRegistrationResult> {
  const plan = await planSubAppRegistration(request);
  if (request.confirmationToken !== plan.confirmationToken) {
    throw new PublisherError(
      'The SubApp registration confirmation is missing, stale, or belongs to different package metadata.',
      'subapp_registration_confirmation_mismatch',
    );
  }

  const stateFile = path.join(plan.packageRoot, REGISTRATION_STATE_FILE);
  const source = requireArchiveRecord(plan.packageManifest.source, 'source');
  const build = requireArchiveRecord(plan.packageManifest.build, 'build');
  let appId: string;
  let versionNumber: number;
  let sourceStoragePath: string;
  let buildStoragePath: string;

  if (plan.resumeState) {
    appId = safeRemoteIdentifier(String(plan.resumeState.appId), 'App ID');
  } else {
    const catalog = isRecord(plan.metadata.catalog) ? plan.metadata.catalog : {};
    const catalogResponse = await client.upsertAppCatalog({
      ...(plan.mode === 'update' ? { appId: plan.appId } : {}),
      ...catalog,
      status: 'draft',
    });
    appId = safeRemoteIdentifier(
      responseString(catalogResponse, ['appId', 'app_id', 'id'], true) as string,
      'app ID',
    );
    if (plan.mode === 'update' && appId !== plan.appId) {
      throw new PublisherError(
        'Taku returned a different App ID for this update.',
        'subapp_registration_app_id_mismatch',
      );
    }
    await writeRegistrationState(stateFile, plan, {
      status: 'draft-created',
      appId,
    });
  }

  if (plan.resumeState?.status === 'uploading') {
    versionNumber = requireStateVersionNumber(plan.resumeState.versionNumber);
    sourceStoragePath = requireStateStoragePath(
      plan.resumeState.sourceStoragePath,
      storagePath(appId, versionNumber, SUBAPP_SOURCE_ARCHIVE_FILE),
    );
    buildStoragePath = requireStateStoragePath(
      plan.resumeState.buildStoragePath,
      storagePath(appId, versionNumber, SUBAPP_BUILD_ARCHIVE_FILE),
    );
  } else {
    const versionResponse = await client.getNextAppVersionNumber(appId);
    versionNumber = responsePositiveInteger(
      versionResponse,
      ['versionNumber', 'version_number'],
    );
    sourceStoragePath = storagePath(appId, versionNumber, SUBAPP_SOURCE_ARCHIVE_FILE);
    buildStoragePath = storagePath(appId, versionNumber, SUBAPP_BUILD_ARCHIVE_FILE);
    await writeRegistrationState(stateFile, plan, {
      status: 'uploading',
      appId,
      versionNumber,
      sourceStoragePath,
      buildStoragePath,
    });
  }

  await uploadArchive(
    client,
    path.join(plan.packageRoot, SUBAPP_SOURCE_ARCHIVE_FILE),
    sourceStoragePath,
  );
  await uploadArchive(
    client,
    path.join(plan.packageRoot, SUBAPP_BUILD_ARCHIVE_FILE),
    buildStoragePath,
  );
  await writeRegistrationState(stateFile, plan, {
    status: 'version-creating',
    appId,
    versionNumber,
    sourceStoragePath,
    buildStoragePath,
  });

  const runtimeManifest = requireObject(plan.packageManifest.runtimeManifest, 'runtime manifest');
  const serviceAuthorizations = requireServiceAuthorizations(
    plan.packageManifest.serviceAuthorizations ?? [],
  );
  const sourceRights = requireObject(plan.metadata.sourceRights, 'source rights');
  const publishManifest: JsonObject = {
    releaseNotes: String(plan.metadata.releaseNotes ?? ''),
    buildRequired: true,
    buildOutputDir: SUBAPP_BUILD_OUTPUT_DIRECTORY,
    startScriptPreview: 'start:preview',
    startScriptEdit: 'start:edit',
    sourceHash: source.sha256,
    buildHash: build.sha256,
    sourceSize: source.size,
    buildSize: build.size,
    sourceRights,
    serviceAuthorizations,
  };
  const versionResponsePayload = await client.createAppVersion({
    appId,
    versionNumber,
    sourceStoragePath,
    buildStoragePath,
    publishManifest,
    buildRequired: true,
    sourceHash: source.sha256,
    buildHash: build.sha256,
    sourceSize: source.size,
    buildSize: build.size,
    manifest: runtimeManifest,
  });
  assertVersionResponse(versionResponsePayload, appId, versionNumber);
  const reviewPath = responseString(
    versionResponsePayload,
    ['reviewPath', 'review_path'],
    false,
  );
  const reviewUrl = responseString(
    versionResponsePayload,
    ['reviewUrl', 'review_url'],
    false,
  );

  const receipt: JsonObject = {
    schemaVersion: REGISTRATION_SCHEMA,
    status: 'private_draft_registered',
    registeredAt: nowIso(),
    packageDigest: plan.packageDigest,
    mode: plan.mode,
    appId,
    versionNumber,
    source: {
      storagePath: sourceStoragePath,
      sha256: source.sha256,
      size: source.size,
    },
    build: {
      storagePath: buildStoragePath,
      sha256: build.sha256,
      size: build.size,
    },
    publicDownloadAvailable: false,
    publishStarted: false,
    ...(reviewPath ? { reviewPath } : {}),
    ...(reviewUrl ? { reviewUrl } : {}),
  };
  await atomicWriteJson(path.join(plan.packageRoot, REGISTRATION_RECEIPT_FILE), receipt);
  await writeRegistrationState(stateFile, plan, {
    status: 'completed',
    appId,
    versionNumber,
    sourceStoragePath,
    buildStoragePath,
  });
  return {
    packageRoot: plan.packageRoot,
    appId,
    versionNumber,
    status: 'private_draft_registered',
    source: receipt.source as JsonObject,
    build: receipt.build as JsonObject,
    receipt,
    ...(reviewPath ? { reviewPath } : {}),
    ...(reviewUrl ? { reviewUrl } : {}),
    uploadStarted: true,
    registrationStarted: true,
    publishStarted: false,
  };
}

async function verifyPackage(packageRoot: string): Promise<JsonObject> {
  const value = await readJson(path.join(packageRoot, 'package-manifest.json'));
  if (
    !isRecord(value) ||
    value.schemaVersion !== PACKAGE_SCHEMA ||
    value.uploadStarted !== false ||
    value.publishStarted !== false
  ) {
    throw new PublisherError(
      'SubApp package manifest is incompatible with registration.',
      'subapp_registration_package_manifest_invalid',
    );
  }
  const source = requireArchiveRecord(value.source, 'source');
  const build = requireArchiveRecord(value.build, 'build');
  if (
    source.fileName !== SUBAPP_SOURCE_ARCHIVE_FILE ||
    build.fileName !== SUBAPP_BUILD_ARCHIVE_FILE ||
    build.outputDirectory !== SUBAPP_BUILD_OUTPUT_DIRECTORY
  ) {
    throw new PublisherError(
      'SubApp package does not match the Taku Desktop dual-archive contract.',
      'subapp_registration_install_contract_invalid',
    );
  }
  const install = requireObject(value.installContract, 'install contract');
  requireServiceAuthorizations(value.serviceAuthorizations ?? []);
  if (
    install.buildRequired !== true ||
    install.buildOutputDir !== SUBAPP_BUILD_OUTPUT_DIRECTORY ||
    install.startScriptPreview !== 'start:preview' ||
    install.startScriptEdit !== 'start:edit'
  ) {
    throw new PublisherError(
      'SubApp package install contract is incompatible.',
      'subapp_registration_install_contract_invalid',
    );
  }
  await verifyArchive(
    path.join(packageRoot, SUBAPP_SOURCE_ARCHIVE_FILE),
    String(source.sha256),
    Number(source.size),
  );
  await verifyArchive(
    path.join(packageRoot, SUBAPP_BUILD_ARCHIVE_FILE),
    String(build.sha256),
    Number(build.size),
  );
  return value;
}

function requireServiceAuthorizations(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value)) {
    throw new PublisherError(
      'SubApp package service authorizations are missing.',
      'subapp_registration_package_manifest_invalid',
    );
  }
  const seenServices = new Set<string>();
  return value.map(raw => {
    const entry = requireObject(raw, 'service authorization');
    const serviceId = safeServiceIdentifier(String(entry.serviceId ?? ''), 'service ID');
    if (seenServices.has(serviceId)) {
      throw new PublisherError(
        'SubApp package contains duplicate service authorizations.',
        'subapp_registration_package_manifest_invalid',
      );
    }
    seenServices.add(serviceId);
    if (!Array.isArray(entry.endpointIds) || entry.endpointIds.length === 0) {
      throw new PublisherError(
        'SubApp service authorization requires endpoint IDs.',
        'subapp_registration_package_manifest_invalid',
      );
    }
    const endpointIds = entry.endpointIds.map(endpointId =>
      safeServiceIdentifier(String(endpointId ?? ''), 'endpoint ID'),
    );
    if (new Set(endpointIds).size !== endpointIds.length) {
      throw new PublisherError(
        'SubApp service authorization endpoint IDs must be unique.',
        'subapp_registration_package_manifest_invalid',
      );
    }
    return { serviceId, endpointIds };
  });
}

function normalizeRegistrationMetadata(value: JsonObject): JsonObject {
  const catalogValue = requireObject(value.catalog, 'catalog metadata');
  const sourceRightsValue = requireObject(value.sourceRights, 'source rights');
  const catalog: JsonObject = {
    name: requiredText(catalogValue.name, 'catalog.name', 120),
    author: requiredText(catalogValue.author, 'catalog.author', 120),
    shortDescription: requiredText(
      catalogValue.shortDescription,
      'catalog.shortDescription',
      500,
    ),
    description: requiredText(catalogValue.description, 'catalog.description', 20_000),
    categories: requiredStringList(catalogValue.categories, 'catalog.categories', 10),
    tags: optionalStringList(catalogValue.tags, 'catalog.tags', 20),
    iconUrl: publicHttpsUrl(catalogValue.iconUrl, 'catalog.iconUrl'),
  };
  for (const [key, limit] of [
    ['repoUrl', 2_000],
    ['demoUrl', 2_000],
    ['heroImageUrl', 2_000],
  ] as const) {
    if (catalogValue[key] !== undefined && String(catalogValue[key]).trim()) {
      catalog[key] = publicHttpsUrl(catalogValue[key], `catalog.${key}`, limit);
    }
  }
  const authorshipKind = String(sourceRightsValue.authorshipKind ?? '').trim() as AuthorshipKind;
  const rightsBasis = String(sourceRightsValue.rightsBasis ?? '').trim() as RightsBasis;
  if (!['original', 'derived', 'third_party'].includes(authorshipKind)) {
    throw new PublisherError(
      'sourceRights.authorshipKind must be original, derived, or third_party.',
      'subapp_registration_source_rights_invalid',
    );
  }
  if (!['self_owned', 'open_source_license', 'explicit_permission'].includes(rightsBasis)) {
    throw new PublisherError(
      'sourceRights.rightsBasis is invalid.',
      'subapp_registration_source_rights_invalid',
    );
  }
  const sourceRights: JsonObject = {
    authorshipKind,
    rightsBasis,
    sourceUrl: optionalText(sourceRightsValue.sourceUrl, 2_000),
    sourceAuthor: optionalText(sourceRightsValue.sourceAuthor, 200),
    license: optionalText(sourceRightsValue.license, 200),
    sourceNotes: optionalText(sourceRightsValue.sourceNotes, 2_000),
  };
  validateSourceRights(sourceRights);
  return {
    catalog,
    releaseNotes: optionalText(value.releaseNotes, 5_000),
    sourceRights,
  };
}

function validateSourceRights(rights: JsonObject): void {
  const kind = String(rights.authorshipKind);
  const basis = String(rights.rightsBasis);
  if (kind === 'original') {
    if (basis !== 'self_owned') sourceRightsError('Original work must use self_owned rights.');
    return;
  }
  publicHttpsUrl(rights.sourceUrl, 'sourceRights.sourceUrl');
  if (basis === 'self_owned') sourceRightsError('Derived or third-party work requires a license or explicit permission.');
  if (basis === 'open_source_license' && !String(rights.license).trim()) {
    sourceRightsError('Open-source work requires a license.');
  }
  if (kind === 'derived' && !String(rights.sourceNotes).trim()) {
    sourceRightsError('Derived work requires conversion/source notes.');
  }
  if (kind === 'third_party' && !String(rights.sourceAuthor).trim()) {
    sourceRightsError('Third-party work requires the source author.');
  }
  if (
    kind === 'third_party' &&
    basis === 'explicit_permission' &&
    !String(rights.sourceNotes).trim()
  ) {
    sourceRightsError('Third-party permission requires source notes.');
  }
}

async function uploadArchive(
  client: SubAppRegistrationClient,
  file: string,
  storagePathValue: string,
): Promise<void> {
  const signed = await client.createAppSignedUpload({
    bucket: APP_PACKAGES_BUCKET,
    path: storagePathValue,
    upsert: true,
  });
  const uploadUrl = responseString(signed, ['signedUrl', 'signed_url', 'uploadUrl', 'upload_url'], true) as string;
  const returnedPath = responseString(signed, ['path', 'storagePath', 'storage_path'], false);
  if (returnedPath && returnedPath !== storagePathValue) {
    throw new PublisherError(
      'Taku signed a different storage path than requested.',
      'subapp_registration_storage_path_mismatch',
    );
  }
  await client.uploadSigned(uploadUrl, file, { 'x-upsert': 'true' });
}

async function canonicalPackageRoot(value: string): Promise<string> {
  if (!path.isAbsolute(value)) {
    throw new PublisherError(
      'SubApp package root must be an absolute path.',
      'subapp_registration_package_path_invalid',
    );
  }
  try {
    const canonical = await fs.realpath(value);
    const metadata = await fs.lstat(canonical);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('not-directory');
    return canonical;
  } catch {
    throw new PublisherError(
      'SubApp package root must be an existing directory.',
      'subapp_registration_package_path_invalid',
    );
  }
}

async function loadRegistrationResumeState(
  packageRoot: string,
  expected: {
    mode: RegistrationMode;
    appId?: string;
    packageDigest: string;
    confirmationToken: string;
  },
): Promise<JsonObject | undefined> {
  const receipt = await fs.lstat(path.join(packageRoot, REGISTRATION_RECEIPT_FILE)).catch(() => null);
  if (receipt) registrationStateExists(REGISTRATION_RECEIPT_FILE);
  const stateFile = path.join(packageRoot, REGISTRATION_STATE_FILE);
  const metadata = await fs.lstat(stateFile).catch(() => null);
  if (!metadata) return undefined;
  const state = await readJson(stateFile);
  if (!isRecord(state) || state.schemaVersion !== REGISTRATION_STATE_SCHEMA) {
    registrationStateExists(REGISTRATION_STATE_FILE);
  }
  const status = String(state.status ?? '');
  if (status === 'completed') registrationStateExists(REGISTRATION_STATE_FILE);
  if (status === 'version-creating') {
    throw new PublisherError(
      'The previous registration reached version creation, so its remote result is uncertain. Review the private App before retrying.',
      'subapp_registration_remote_state_uncertain',
      { state_file: REGISTRATION_STATE_FILE },
    );
  }
  if (!['draft-created', 'uploading'].includes(status)) {
    registrationStateExists(REGISTRATION_STATE_FILE);
  }
  const appId = safeRemoteIdentifier(String(state.appId ?? ''), 'App ID');
  if (
    state.mode !== expected.mode
    || state.packageDigest !== expected.packageDigest
    || state.confirmationToken !== expected.confirmationToken
    || (expected.mode === 'update' && appId !== expected.appId)
  ) {
    throw new PublisherError(
      'The existing registration state belongs to different package metadata or a different App.',
      'subapp_registration_resume_mismatch',
      { state_file: REGISTRATION_STATE_FILE },
    );
  }
  if (status === 'uploading') {
    const versionNumber = requireStateVersionNumber(state.versionNumber);
    requireStateStoragePath(
      state.sourceStoragePath,
      storagePath(appId, versionNumber, SUBAPP_SOURCE_ARCHIVE_FILE),
    );
    requireStateStoragePath(
      state.buildStoragePath,
      storagePath(appId, versionNumber, SUBAPP_BUILD_ARCHIVE_FILE),
    );
  }
  return state;
}

function registrationStateExists(fileName: string): never {
  throw new PublisherError(
    'This SubApp package already has completed or incompatible registration state. Refusing to create a duplicate remote version.',
    'subapp_registration_state_exists',
    { state_file: fileName },
  );
}

function resumeRemoteOperations(status: string): string[] {
  return status === 'uploading'
    ? ['upload-source-archive', 'upload-build-archive', 'register-private-app-version']
    : ['allocate-next-version', 'upload-source-archive', 'upload-build-archive', 'register-private-app-version'];
}

function requireStateVersionNumber(value: JsonValue | undefined): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    registrationStateExists(REGISTRATION_STATE_FILE);
  }
  return Number(value);
}

function requireStateStoragePath(value: JsonValue | undefined, expected: string): string {
  if (value !== expected) registrationStateExists(REGISTRATION_STATE_FILE);
  return expected;
}

async function verifyArchive(file: string, expectedHash: string, expectedSize: number): Promise<void> {
  const metadata = await fs.lstat(file).catch(() => null);
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== expectedSize ||
    metadata.size <= 0 ||
    metadata.size > MAX_PACKAGE_BYTES ||
    await sha256File(file) !== expectedHash
  ) {
    throw new PublisherError(
      'SubApp archive is missing, changed, or exceeds the release limit.',
      'subapp_registration_archive_changed',
      { archive: path.basename(file) },
    );
  }
}

function requireArchiveRecord(value: JsonValue | undefined, label: string): JsonObject {
  const record = requireObject(value, `${label} archive`);
  if (
    !/^[a-f0-9]{64}$/.test(String(record.sha256 ?? '')) ||
    !Number.isSafeInteger(record.size) ||
    Number(record.size) <= 0 ||
    Number(record.size) > MAX_PACKAGE_BYTES
  ) {
    throw new PublisherError(
      `SubApp ${label} archive record is invalid.`,
      'subapp_registration_package_manifest_invalid',
    );
  }
  return record;
}

function requireObject(value: JsonValue | undefined, label: string): JsonObject {
  if (!isRecord(value)) {
    throw new PublisherError(
      `SubApp registration ${label} is missing or invalid.`,
      'subapp_registration_metadata_invalid',
    );
  }
  return value;
}

function registrationMode(value: string): RegistrationMode {
  const mode = String(value ?? '').trim();
  if (mode !== 'create' && mode !== 'update') {
    throw new PublisherError(
      'SubApp registration mode must be create or update.',
      'subapp_registration_mode_invalid',
    );
  }
  return mode;
}

function normalizeRequestedAppId(mode: RegistrationMode, value?: string): string | undefined {
  const appId = String(value ?? '').trim();
  if (mode === 'update' && !appId) {
    throw new PublisherError(
      'Updating a SubApp requires an explicit App ID.',
      'subapp_registration_app_id_required',
    );
  }
  if (mode === 'create' && appId) {
    throw new PublisherError(
      'Creating a SubApp must not infer or reuse an App ID.',
      'subapp_registration_app_id_forbidden',
    );
  }
  return appId ? safeRemoteIdentifier(appId, 'App ID') : undefined;
}

function registrationPackageDigest(manifest: JsonObject): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(sortJson(manifest)))
    .digest('hex')}`;
}

function registrationConfirmationToken(input: {
  mode: RegistrationMode;
  appId?: string;
  packageDigest: string;
  metadata: JsonObject;
}): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(sortJson(input as unknown as JsonValue)))
    .digest('hex');
  return `subapp_register_confirm_${digest}`;
}

function safeRemoteIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new PublisherError(
      `Taku ${label} is invalid.`,
      'subapp_registration_remote_identifier_invalid',
    );
  }
  return value;
}

function safeServiceIdentifier(value: string, label: string): string {
  if (!/^[a-z][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new PublisherError(
      `Taku ${label} is invalid.`,
      'subapp_registration_package_manifest_invalid',
    );
  }
  return value;
}

function storagePath(appId: string, versionNumber: number, fileName: string): string {
  return `apps/${safeRemoteIdentifier(appId, 'App ID')}/versions/${versionNumber}/${fileName}`;
}

function responseString(response: JsonObject, keys: string[], required: boolean): string | null {
  for (const candidate of responseCandidates(response)) {
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  if (required) {
    throw new PublisherError(
      `Taku response is missing ${keys[0]}.`,
      'subapp_registration_api_response_invalid',
    );
  }
  return null;
}

function responsePositiveInteger(response: JsonObject, keys: string[]): number {
  for (const candidate of responseCandidates(response)) {
    for (const key of keys) {
      const value = candidate[key];
      if (Number.isSafeInteger(value) && Number(value) > 0) return Number(value);
    }
  }
  throw new PublisherError(
    `Taku response is missing ${keys[0]}.`,
    'subapp_registration_api_response_invalid',
  );
}

function assertVersionResponse(response: JsonObject, appId: string, versionNumber: number): void {
  const candidates = [...responseCandidates(response)];
  if (isRecord(response.version)) candidates.push(response.version);
  for (const candidate of candidates) {
    const returnedAppId = String(candidate.appId ?? candidate.app_id ?? '').trim();
    const returnedVersion = Number(candidate.versionNumber ?? candidate.version_number ?? 0);
    if (!returnedAppId || !returnedVersion) continue;
    if (returnedAppId !== appId) {
      throw new PublisherError(
        'Taku registered the version under a different App ID.',
        'subapp_registration_version_mismatch',
      );
    }
    if (returnedVersion !== versionNumber) {
      throw new PublisherError(
        'Taku registered a different version number.',
        'subapp_registration_version_mismatch',
      );
    }
    return;
  }
  throw new PublisherError(
    'Taku did not confirm the registered App ID and version number.',
    'subapp_registration_api_response_invalid',
  );
}

async function writeRegistrationState(
  file: string,
  plan: SubAppRegistrationPlan,
  values: JsonObject,
): Promise<void> {
  await atomicWriteJson(file, {
    schemaVersion: REGISTRATION_STATE_SCHEMA,
    packageDigest: plan.packageDigest,
    confirmationToken: plan.confirmationToken,
    mode: plan.mode,
    updatedAt: nowIso(),
    publishStarted: false,
    ...values,
  });
}

function requiredText(value: unknown, field: string, max: number): string {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) {
    throw new PublisherError(
      `${field} is required and must be at most ${max} characters.`,
      'subapp_registration_metadata_invalid',
    );
  }
  return text;
}

function optionalText(value: unknown, max: number): string {
  const text = String(value ?? '').trim();
  if (text.length > max) {
    throw new PublisherError(
      `SubApp registration text exceeds ${max} characters.`,
      'subapp_registration_metadata_invalid',
    );
  }
  return text;
}

function requiredStringList(value: unknown, field: string, maxItems: number): string[] {
  const values = optionalStringList(value, field, maxItems);
  if (!values.length) {
    throw new PublisherError(
      `${field} requires at least one value.`,
      'subapp_registration_metadata_invalid',
    );
  }
  return values;
}

function optionalStringList(value: unknown, field: string, maxItems: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new PublisherError(
      `${field} must be a string list with at most ${maxItems} values.`,
      'subapp_registration_metadata_invalid',
    );
  }
  const normalized = [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
  if (normalized.some(item => item.length > 100)) {
    throw new PublisherError(
      `${field} contains an overlong value.`,
      'subapp_registration_metadata_invalid',
    );
  }
  return normalized;
}

function publicHttpsUrl(value: unknown, field: string, max = 2_000): string {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) {
    throw new PublisherError(
      `${field} must be a public HTTPS URL.`,
      'subapp_registration_metadata_invalid',
    );
  }
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) throw new Error('unsafe');
    return url.toString();
  } catch {
    throw new PublisherError(
      `${field} must be a public HTTPS URL.`,
      'subapp_registration_metadata_invalid',
    );
  }
}

function sourceRightsError(message: string): never {
  throw new PublisherError(message, 'subapp_registration_source_rights_invalid');
}
