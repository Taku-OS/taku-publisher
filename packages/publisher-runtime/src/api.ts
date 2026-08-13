import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { resolveAuth } from './auth.js';
import {
  DEFAULT_WORKER_URL,
  PUBLISHER_USER_AGENT,
  SCHEMA_VERSION,
  SUPPORTED_RUNTIME_PLATFORMS,
} from './constants.js';
import {
  PUBLISHER_DRAFTS_PATH,
  publisherDraftArtifactCompletePath,
  publisherDraftArtifactPresignPath,
  publisherDraftPath,
  publisherDraftScanReportPath,
  publisherDraftStatusPath,
  publisherDraftSubmitPath,
} from './contract.js';
import {
  bufferedFileUploadTransport,
  type FileUploadTransport,
  streamFileUploadTransport,
} from './file-upload.js';
import type { JsonObject, JsonValue, PublisherState } from './types.js';
import { isRecord, PublisherError } from './util.js';

const DEFAULT_MARKETPLACE_CATEGORY = 'writing-content';
const LISTING_KEY_ALIASES = new Map([
  ['short_description', 'shortDescription'],
  ['icon_url', 'iconUrl'],
  ['source_url', 'sourceUrl'],
  ['upstream_url', 'sourceUrl'],
  ['upstreamUrl', 'sourceUrl'],
  ['source_kind', 'sourceKind'],
  ['authorship_kind', 'authorshipKind'],
  ['publishing_rights', 'authorshipKind'],
  ['publishingRights', 'authorshipKind'],
  ['rights_basis', 'rightsBasis'],
  ['source_notes', 'sourceNotes'],
  ['source_author', 'sourceAuthor'],
  ['support_email', 'supportEmail'],
  ['privacy_policy_url', 'privacyPolicyUrl'],
  ['privacyPolicy', 'privacyPolicyUrl'],
  ['privacy_policy', 'privacyPolicyUrl'],
]);

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}
export type Transport = (
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Uint8Array | undefined,
  timeoutMs: number,
) => Promise<TransportResponse>;

export class TakuPublisherClient {
  readonly workerUrl: string;
  readonly token: string;
  readonly iconToken: string;
  readonly timeoutMs: number;
  readonly uploadTimeoutMs: number;
  readonly transport: Transport;
  readonly fileUploadTransport: FileUploadTransport;
  readonly usesStreamingFileUpload: boolean;

  constructor(options: {
    workerUrl?: string;
    token?: string;
    iconToken?: string;
    timeoutMs?: number;
    uploadTimeoutMs?: number;
    allowCustomWorkerUrl?: boolean;
    transport?: Transport;
    fileUploadTransport?: FileUploadTransport;
  } = {}) {
    this.workerUrl = validateWorkerUrl(options.workerUrl ?? DEFAULT_WORKER_URL, options.allowCustomWorkerUrl ?? false);
    this.token = String(options.token ?? '').trim();
    this.iconToken = String(options.iconToken ?? '').trim();
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? 300_000;
    this.transport = options.transport ?? defaultTransport;
    this.fileUploadTransport = options.fileUploadTransport
      ?? (options.transport
        ? bufferedFileUploadTransport(options.transport)
        : streamFileUploadTransport);
    this.usesStreamingFileUpload = options.fileUploadTransport === streamFileUploadTransport
      || (!options.fileUploadTransport && !options.transport);
  }

  static async fromEnvironment(options: {
    workerUrl?: string;
    tokenEnv?: string;
    timeoutMs?: number;
    uploadTimeoutMs?: number;
    allowCustomWorkerUrl?: boolean;
    transport?: Transport;
    fileUploadTransport?: FileUploadTransport;
    env?: NodeJS.ProcessEnv;
  } = {}): Promise<TakuPublisherClient> {
    const auth = await resolveAuth({ tokenEnv: options.tokenEnv, env: options.env });
    return new TakuPublisherClient({
      workerUrl: options.workerUrl,
      token: auth.token,
      iconToken: auth.iconToken,
      timeoutMs: options.timeoutMs,
      uploadTimeoutMs: options.uploadTimeoutMs,
      allowCustomWorkerUrl: options.allowCustomWorkerUrl,
      transport: options.transport,
      fileUploadTransport: options.fileUploadTransport,
    });
  }

  createDraft(payload: JsonObject): Promise<JsonObject> { return this.json('POST', PUBLISHER_DRAFTS_PATH, payload); }
  generateListingIcon(payload: JsonObject): Promise<JsonObject> { return this.json('POST', '/marketplace/icons/generate', payload, this.iconToken || this.token); }
  getDraft(id: string): Promise<JsonObject> { return this.json('GET', publisherDraftPath(id)); }
  updateDraft(id: string, payload: JsonObject): Promise<JsonObject> { return this.json('PATCH', publisherDraftPath(id), payload); }
  submitScanReport(id: string, payload: JsonObject): Promise<JsonObject> { return this.json('POST', publisherDraftScanReportPath(id), payload); }
  presignArtifact(id: string, size: number, sha256: string): Promise<JsonObject> {
    return this.json('POST', publisherDraftArtifactPresignPath(id), { size, sha256, contentType: 'application/zip' });
  }
  completeArtifact(id: string, artifactId: string, size: number, sha256: string): Promise<JsonObject> {
    return this.json('POST', publisherDraftArtifactCompletePath(id, artifactId), { size, sha256 });
  }
  submitDraft(id: string): Promise<JsonObject> { return this.json('POST', publisherDraftSubmitPath(id), {}); }
  getStatus(id: string): Promise<JsonObject> { return this.json('GET', publisherDraftStatusPath(id)); }
  searchMarketplace(search = '', itemKind = 'all', limit = 20, offset = 0): Promise<JsonObject> {
    const query = new URLSearchParams({ source: 'all', limit: String(limit) });
    if (search.trim()) query.set('q', search.trim());
    if (itemKind && itemKind !== 'all') query.set('kind', itemKind);
    if (offset > 0) query.set('cursor', String(offset));
    return this.json('GET', `/marketplace/items?${query}`, undefined, '', false);
  }
  getMarketplaceItem(id: string): Promise<JsonObject> { return this.json('GET', `/stax/items/${segment(id)}`, undefined, '', false); }
  getMarketplaceInstallPackage(id: string): Promise<JsonObject> { return this.json('GET', `/stax/installs/package/${segment(id)}`); }
  recordMarketplaceInstall(id: string, versionNumber: number): Promise<JsonObject> {
    return this.json('POST', '/stax/installs', { item_id: id, installed_version: versionNumber });
  }
  upsertAppCatalog(payload: JsonObject): Promise<JsonObject> {
    return this.json('POST', '/app-store/catalog/upsert', payload);
  }
  getNextAppVersionNumber(appId: string): Promise<JsonObject> {
    return this.json('GET', `/app-store/catalog/${segment(appId)}/next-version`);
  }
  createAppVersion(payload: JsonObject): Promise<JsonObject> {
    return this.json('POST', '/app-store/versions', payload);
  }
  createAppSignedUpload(payload: JsonObject): Promise<JsonObject> {
    return this.json('POST', '/app-store/storage/signed-upload', payload);
  }
  getAppDownload(appId: string, versionNumber?: number): Promise<JsonObject> {
    const query = versionNumber === undefined
      ? ''
      : `?${new URLSearchParams({ versionNumber: String(versionNumber) })}`;
    return this.json('GET', `/app-store/apps/${segment(appId)}/download${query}`, undefined, '', false);
  }

  async uploadSigned(uploadUrl: string, bundlePath: string, headers: Record<string, string> = {}): Promise<void> {
    const parsed = safeUrl(uploadUrl, 'Presigned upload URL is invalid.', 'invalid_upload_url');
    if (parsed.protocol !== 'https:' && !loopback(parsed.hostname)) throw new PublisherError('Presigned uploads must use HTTPS outside loopback.', 'unsafe_upload_url');
    const metadata = await fsp.lstat(bundlePath).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) {
      throw new PublisherError('Presigned upload file is missing or invalid.', 'invalid_upload_file');
    }
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/zip',
      'Content-Length': String(metadata.size),
      'User-Agent': PUBLISHER_USER_AGENT,
    };
    for (const [name, value] of Object.entries(headers)) {
      if (['authorization', 'cookie', 'proxy-authorization', 'x-taku-auth'].includes(name.toLowerCase())) {
        throw new PublisherError('Presigned upload headers contain a forbidden credential header.', 'unsafe_upload_headers');
      }
      requestHeaders[name] = value;
    }
    if (parsed.origin === new URL(this.workerUrl).origin) {
      if (!this.token) throw new PublisherError('Publisher upload authorization is missing.', 'missing_auth');
      requestHeaders.Authorization = `Bearer ${this.token}`;
    }
    let response: TransportResponse;
    try {
      response = await this.fileUploadTransport(
        'PUT',
        uploadUrl,
        requestHeaders,
        bundlePath,
        this.uploadTimeoutMs,
      );
    } catch (error) {
      const proxyNames = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy']
        .filter(name => process.env[name]);
      throw new PublisherError('Network request failed.', 'network_error', {
        host: parsed.hostname,
        reason_type: error instanceof Error ? error.name : typeof error,
        reason: String(error).slice(0, 300),
        proxy_env_present: proxyNames,
        streamed_upload: this.usesStreamingFileUpload,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new PublisherError(`Presigned upload failed with HTTP ${response.status}: ${bodyPreview(response.body)}`, 'artifact_upload_failed');
    }
  }

  async downloadPublicPackage(downloadUrl: string, maxBytes: number): Promise<Uint8Array> {
    const parsed = safeUrl(downloadUrl, 'Marketplace package URL is invalid.', 'invalid_download_url');
    if (parsed.protocol !== 'https:' && !loopback(parsed.hostname)) throw new PublisherError('Marketplace package URL is invalid.', 'invalid_download_url');
    const headers: Record<string, string> = {
      Accept: 'application/zip',
      'User-Agent': PUBLISHER_USER_AGENT,
    };
    if (parsed.origin === new URL(this.workerUrl).origin) {
      if (!this.token) throw new PublisherError('Marketplace package download authorization is missing.', 'missing_auth');
      headers.Authorization = `Bearer ${this.token}`;
    }
    const response = await this.transport('GET', downloadUrl, headers, undefined, this.timeoutMs);
    if (response.status < 200 || response.status >= 300) throw new PublisherError(`Marketplace package download failed with HTTP ${response.status}.`, 'package_download_failed', { status: response.status });
    const declared = Number(headerValue(response.headers, 'content-length'));
    if (Number.isFinite(declared) && (declared < 0 || declared > maxBytes)) throw new PublisherError('Marketplace package exceeds the download size limit.', 'package_too_large');
    if (response.body.length <= 0 || response.body.length > maxBytes) throw new PublisherError('Marketplace package is empty or exceeds the download size limit.', 'package_too_large');
    return response.body;
  }

  private async json(
    method: string,
    apiPath: string,
    payload?: JsonObject,
    token?: string,
    requireAuth = true,
  ): Promise<JsonObject> {
    const requestToken = token === undefined ? this.token : token.trim();
    if (requireAuth && !requestToken) {
      throw new PublisherError(
        'Taku login is required on this device. Sign in to Taku, then rerun the command; do not paste tokens into chat.',
        'missing_auth',
      );
    }
    const body = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload), 'utf8');
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': PUBLISHER_USER_AGENT,
      'X-Taku-Publisher-Schema': SCHEMA_VERSION,
    };
    if (requestToken) headers.Authorization = `Bearer ${requestToken}`;
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(body.length);
    }
    const response = await this.transport(method, `${this.workerUrl}${apiPath}`, headers, body, this.timeoutMs);
    const parsed = parseJsonResponse(response.body);
    if (response.status < 200 || response.status >= 300) {
      let message = String(parsed.error ?? parsed.message ?? `HTTP ${response.status}`);
      let preview = bodyPreview(response.body);
      if (requestToken) {
        message = message.split(requestToken).join('[REDACTED]');
        preview = preview.split(requestToken).join('[REDACTED]');
      }
      const details: JsonObject = {
        status: response.status,
        path: apiPath,
        server: headerValue(response.headers, 'server'),
        content_type: headerValue(response.headers, 'content-type'),
        cf_ray: headerValue(response.headers, 'cf-ray'),
      };
      if (preview) details.response_preview = preview;
      throw new PublisherError(message, 'api_error', details);
    }
    return parsed;
  }
}

export async function draftCreatePayload(state: PublisherState): Promise<JsonObject> {
  const unit = isRecord(state.unit) ? state.unit : {};
  const children = Array.isArray(unit.children) ? unit.children.filter(isRecord) : [];
  const toolType = unit.type;
  const toolName = String(unit.name ?? unit.id ?? '').trim();
  const description = String(unit.description ?? '').trim();
  const generatedListing: JsonObject = {
    title: toolName,
    sourceKind: 'local_upload',
    authorshipKind: 'original',
    rightsBasis: 'self_owned',
    categories: [DEFAULT_MARKETPLACE_CATEGORY],
    description: defaultListingDescription(toolName, description, String(toolType ?? '')),
    examples: defaultListingExamples(toolName, String(toolType ?? '')),
    platforms: [...SUPPORTED_RUNTIME_PLATFORMS],
    ...await inferredSourceAndSupportListing(state),
    ...await inferredLicenseListing(state),
  };
  if (description) generatedListing.shortDescription = description.slice(0, 500);
  const update = state.mode === 'update';
  const payload: JsonObject = {
    schemaVersion: SCHEMA_VERSION,
    mode: state.mode,
    toolType,
    tool: {
      id: unit.id,
      type: toolType,
      name: toolName,
      description: description.slice(0, 2000),
      capabilities: children.map((child) => ({
        id: child.id,
        type: child.type,
        name: child.name,
        path: child.relative_path,
      })),
    },
    listing: update ? {} : generatedListing,
  };
  if (state.stage_sha256) payload.localArtifact = { stageSha256: state.stage_sha256, fileCount: state.file_count, totalBytes: state.total_bytes };
  if (update) {
    const itemId = String(state.item_id ?? '').trim();
    if (!itemId) throw new PublisherError('Update mode requires itemId.', 'missing_item_id');
    payload.itemId = itemId;
    payload.inheritListing = true;
  }
  return payload;
}

export function normalizeListingMetadata(input: JsonObject): JsonObject {
  const output: JsonObject = {};
  for (const [rawKey, value] of Object.entries(input)) {
    const key = LISTING_KEY_ALIASES.get(rawKey) ?? rawKey;
    output[key] = value;
  }
  return output;
}

export function extractRemoteId(response: JsonObject, ...keys: string[]): string {
  for (const candidate of responseCandidates(response)) {
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  throw new PublisherError(`Platform response did not include any of: ${keys.join(', ')}`, 'invalid_api_response');
}

export function extractDraftListing(response: JsonObject): JsonObject | null {
  for (const candidate of responseCandidates(response)) {
    if (isRecord(candidate.listing)) return normalizeListingMetadata(candidate.listing);
  }
  return null;
}

export function responseCandidates(response: JsonObject): JsonObject[] {
  const candidates = [response];
  for (const key of ['data', 'artifact', 'upload', 'draft', 'submission', 'icon']) {
    const value = response[key];
    if (!isRecord(value)) continue;
    candidates.push(value);
    for (const nestedKey of ['artifact', 'upload', 'draft', 'submission', 'icon']) {
      const nested = value[nestedKey];
      if (isRecord(nested)) candidates.push(nested);
    }
  }
  return candidates;
}

export function validateWorkerUrl(value: string, allowCustom = false): string {
  const normalized = String(value || DEFAULT_WORKER_URL).trim();
  const parsed = safeUrl(normalized, 'Worker URL must be a plain HTTP(S) origin.', 'invalid_worker_url');
  if (parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol)) throw new PublisherError('Worker URL must be a plain HTTP(S) origin.', 'invalid_worker_url');
  const defaultHost = new URL(DEFAULT_WORKER_URL).hostname;
  if (parsed.protocol !== 'https:' && !loopback(parsed.hostname)) throw new PublisherError('Non-loopback Worker URLs must use HTTPS.', 'unsafe_worker_url');
  if (parsed.hostname !== defaultHost && !loopback(parsed.hostname) && !allowCustom) throw new PublisherError('Refusing to send Taku auth to a custom Worker host without explicit opt-in.', 'custom_worker_not_allowed');
  return normalized.replace(/\/+$/, '');
}

async function defaultTransport(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Uint8Array | undefined,
  timeoutMs: number,
): Promise<TransportResponse> {
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? Buffer.from(body) : undefined,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: new Uint8Array(await response.arrayBuffer()),
    };
  } catch (error) {
    const parsed = new URL(url);
    const proxyNames = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy']
      .filter((name) => process.env[name]);
    throw new PublisherError('Network request failed.', 'network_error', {
      host: parsed.hostname,
      reason_type: error instanceof Error ? error.name : typeof error,
      reason: String(error).slice(0, 300),
      proxy_env_present: proxyNames,
    });
  }
}

function defaultListingDescription(name: string, description: string, toolType: string): string {
  const title = name || 'This local Taku tool';
  const kind = toolType || 'tool';
  const lines = [`## ${title}`, ''];
  if (description) lines.push(description, '');
  lines.push(
    '### Capabilities',
    `- Packages this local ${kind} for installation through Taku.`,
    '- Includes the selected source files after local staging exclusions.',
    '- Declares configuration requirements so users can provide values securely after installation.',
    '',
    '### Setup',
    '- Install from Taku, then review any listed environment variables or secrets.',
    '- Follow the bundled README or SKILL.md for tool-specific usage instructions.',
    '',
    '### Safety',
    '- Secret files, local credential stores, caches, build output, and VCS metadata are excluded from the package.',
    '- The package is scanned locally before upload and verified by Taku before release.',
  );
  return lines.join('\n');
}

function defaultListingExamples(name: string, toolType: string): string[] {
  return [
    `Install ${name || 'this tool'} from Taku, configure any required secrets, then use the bundled ${toolType || 'tool'} instructions.`,
    'Review README.md or SKILL.md in the package for setup, inputs, outputs, and limitations.',
  ];
}

async function inferredLicenseListing(state: PublisherState): Promise<JsonObject> {
  const source = String(state.source_path ?? '').trim();
  if (!source) return {};
  const root = await fsp.stat(source).then((stat) => stat.isDirectory() ? source : path.dirname(source), () => '');
  if (!root) return {};
  for (const fileName of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md', 'COPYING.txt']) {
    const detected = await detectLicense(path.join(root, fileName), false);
    if (detected) return { license: detected };
  }
  for (const fileName of ['README.md', 'README.markdown', 'README.txt', 'README']) {
    const detected = await detectLicense(path.join(root, fileName), true);
    if (detected) return { license: detected };
  }
  return {};
}

async function inferredSourceAndSupportListing(state: PublisherState): Promise<JsonObject> {
  const root = await sourceRoot(state);
  if (!root) return {};
  const packageJson = await readJsonFile(path.join(root, 'package.json'));
  if (!packageJson) return {};
  const listing: JsonObject = {};
  const sourceUrl = publicSourceUrl(
    firstString(
      packageJson.repository,
      record(packageJson.repository).url,
      packageJson.homepage,
      record(packageJson.bugs).url,
    ),
  );
  if (sourceUrl) listing.sourceUrl = sourceUrl;
  const supportEmail = emailString(
    firstString(
      record(packageJson.bugs).email,
      record(packageJson.support).email,
    ),
  );
  if (supportEmail) listing.supportEmail = supportEmail;
  const privacyPolicyUrl = publicSourceUrl(
    firstString(
      packageJson.privacyPolicyUrl,
      packageJson.privacyPolicy,
      packageJson.privacy,
      record(packageJson.urls).privacy,
    ),
  );
  if (privacyPolicyUrl) listing.privacyPolicyUrl = privacyPolicyUrl;
  const license = firstString(packageJson.license);
  if (license) listing.license = license.slice(0, 100);
  return listing;
}

async function sourceRoot(state: PublisherState): Promise<string> {
  const source = String(state.source_path ?? '').trim();
  if (!source) return '';
  return fsp.stat(source).then((stat) => stat.isDirectory() ? source : path.dirname(source), () => '');
}

async function readJsonFile(file: string): Promise<JsonObject | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as JsonValue;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function record(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function emailString(value: string): string {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : '';
}

function publicSourceUrl(value: string): string {
  let raw = value.trim();
  if (!raw) return '';
  raw = raw.replace(/^git\+/, '').replace(/\.git$/i, '');
  const ssh = /^git@github\.com:([^/]+\/[^/]+)$/i.exec(raw);
  if (ssh?.[1]) raw = `https://github.com/${ssh[1]}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

async function detectLicense(file: string, readme: boolean): Promise<string | undefined> {
  let text = await fsp.readFile(file, 'utf8').then((value) => value.slice(0, 64_000), () => '');
  if (readme) {
    const match = /^#{1,4}\s+license\s*$/im.exec(text);
    if (!match) return undefined;
    text = text.slice((match.index ?? 0) + match[0].length);
    const next = /^#{1,4}\s+\S+/m.exec(text);
    if (next?.index !== undefined) text = text.slice(0, next.index);
  }
  const patterns: Array<[string, RegExp[]]> = [
    ['Apache-2.0', [/apache license/i, /apache-?2\.0/i]],
    ['MIT', [/\bmit license\b/i, /permission is hereby granted/i, /^mit\b/im]],
    ['BSD-3-Clause', [/bsd 3-clause/i, /redistribution and use in source and binary forms/i]],
    ['BSD-2-Clause', [/bsd 2-clause/i]],
    ['GPL-3.0', [/gnu general public license/i, /\bgpl-?3/i]],
    ['LGPL-3.0', [/gnu lesser general public license/i, /\blgpl-?3/i]],
    ['AGPL-3.0', [/gnu affero general public license/i, /\bagpl-?3/i]],
    ['MPL-2.0', [/mozilla public license/i, /\bmpl-?2\.0/i]],
    ['ISC', [/\bisc license\b/i]],
    ['Unlicense', [/\bthe unlicense\b/i]],
  ];
  return patterns.find(([, tests]) => tests.some((pattern) => pattern.test(text)))?.[0];
}

function parseJsonResponse(body: Uint8Array): JsonObject {
  if (!body.length) return {};
  try {
    const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as JsonValue;
    if (!isRecord(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw new PublisherError(`Expected JSON response, got: ${bodyPreview(body)}`, 'invalid_api_response');
  }
}

function segment(value: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || /[/\\?#]/.test(normalized)) throw new PublisherError('Invalid API resource ID.', 'invalid_resource_id');
  return encodeURIComponent(normalized);
}

function safeUrl(value: string, message: string, code: string): URL {
  try {
    const parsed = new URL(value);
    if (!parsed.hostname || !['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    return parsed;
  } catch {
    throw new PublisherError(message, code);
  }
}

function loopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

function bodyPreview(body: Uint8Array): string {
  return Buffer.from(body).subarray(0, 200).toString('utf8').replace(/\n/g, ' ').trim();
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
}
