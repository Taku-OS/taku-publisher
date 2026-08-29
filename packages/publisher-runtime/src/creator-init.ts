import {
  authStatus,
  resolveAuth,
  type ResolvedAuth,
} from './auth.js';
import { TakuPublisherClient } from './api.js';
import { DEFAULT_SITE_URL } from './browser-auth.js';
import { DEFAULT_WORKER_URL } from './constants.js';
import {
  discoverRecentProjects,
  type DiscoveredProject,
  type ProjectHostFilter,
} from './project-discovery.js';
import { creatorProjectChoice } from './creator-plan.js';
import type { JsonObject, JsonValue } from './types.js';
import { isRecord } from './util.js';

export const CREATOR_INIT_SCHEMA_VERSION = 'taku.creator-init.v1';

export interface CreatorInitOptions {
  siteUrl?: string;
  workerUrl?: string;
  tokenEnv?: string;
  host?: ProjectHostFilter;
  maxProjects?: number;
  maxSessionFiles?: number;
  allowCustomWorkerUrl?: boolean;
  env?: NodeJS.ProcessEnv;
}

interface CreatorInitDependencies {
  getAuthStatus?: typeof authStatus;
  getAuth?: typeof resolveAuth;
  discoverProjects?: typeof discoverRecentProjects;
  fetchProfile?: (auth: ResolvedAuth, options: CreatorInitOptions) => Promise<JsonObject>;
  createEditor?: () => Promise<JsonObject>;
}

export async function initializeCreator(
  options: CreatorInitOptions = {},
  dependencies: CreatorInitDependencies = {},
): Promise<JsonObject> {
  const siteUrl = trimUrl(options.siteUrl ?? DEFAULT_SITE_URL);
  const workerUrl = trimUrl(options.workerUrl ?? DEFAULT_WORKER_URL);
  const tokenEnv = options.tokenEnv ?? 'TAKU_BEARER_TOKEN';
  const [projects, editorResult] = await Promise.all([
    (dependencies.discoverProjects ?? discoverRecentProjects)({
      host: options.host ?? 'all',
      maxProjects: options.maxProjects,
      maxSessionFiles: options.maxSessionFiles,
    }),
    dependencies.createEditor
      ? dependencies.createEditor().then(
          (value) => ({ value, warning: null }),
          (error) => ({
            value: {},
            warning: error instanceof Error ? error.message : String(error),
          }),
        )
      : Promise.resolve({ value: {}, warning: null }),
  ]);
  // The editor may complete browser authorization. Read auth afterwards so the
  // response describes the account that actually owns the new cloud draft.
  const auth = await (dependencies.getAuthStatus ?? authStatus)({ tokenEnv, env: options.env });
  const authenticated = auth.authenticated === true;
  let profile: JsonObject = {};
  let profileWarning: string | null = null;

  if (authenticated) {
    try {
      const resolved = await (dependencies.getAuth ?? resolveAuth)({ tokenEnv, env: options.env });
      profile = await (dependencies.fetchProfile ?? fetchCreatorProfile)(resolved, {
        ...options,
        workerUrl,
      });
    } catch (error) {
      profileWarning = error instanceof Error ? error.message : String(error);
    }
  }

  const username = profileUsername(profile);
  const webEditorUrl = buildProfileEntryUrl(siteUrl, 'publish_stax_card');
  const editorUrl = firstString(editorResult.value, ['editorUrl', 'primaryUrl']) || webEditorUrl;
  const loginUrl = authenticated ? null : buildProfileEntryUrl(siteUrl, 'creator_init');
  return {
    schemaVersion: CREATOR_INIT_SCHEMA_VERSION,
    authenticated,
    auth: {
      authenticated,
      source: auth.source ?? 'missing',
      accountHint: auth.account_hint ?? null,
      refreshed: auth.refreshed === true,
      expiresInSeconds: auth.expires_in_seconds ?? null,
    },
    staxCard: {
      editorUrl,
      editorReady: Boolean(firstString(editorResult.value, ['editorUrl', 'primaryUrl'])),
      editorWarning: editorResult.warning,
      webEditorUrl,
      publicUrl: username ? `${siteUrl}/stax/${encodeURIComponent(username)}` : null,
    },
    creatorProfile: {
      url: username
        ? `${siteUrl}/profile/${encodeURIComponent(username)}`
        : authenticated ? `${siteUrl}/profile` : null,
      needsLogin: !authenticated,
      loginUrl,
      username: username || null,
      warning: profileWarning,
    },
    projects: projects as unknown as JsonValue,
    projectChoices: projects.map(creatorProjectChoice) as unknown as JsonValue,
    projectCount: projects.length,
    selectionRule: 'Select one or more local projects and choose skill or subapp for each. Eligibility is validated before conversion.',
    publishPlan: {
      multipleSelection: true,
      targetTypes: ['skill', 'subapp'],
      staxCardPolicy: 'publish_first',
      projectExecution: 'sequential_queue',
      subAppsDoNotBlockStaxCard: true,
      publicReleaseIsAutomatic: false,
    },
    privacy: {
      localOnlyProjectDiscovery: true,
      uploads: false,
      promptContentAnalyzed: false,
      projectRootMetadataInspected: true,
      sourceCodeScanned: false,
    },
  };
}

async function fetchCreatorProfile(
  auth: ResolvedAuth,
  options: CreatorInitOptions,
): Promise<JsonObject> {
  if (!auth.token) return {};
  const client = new TakuPublisherClient({
    workerUrl: options.workerUrl,
    token: auth.token,
    allowCustomWorkerUrl: options.allowCustomWorkerUrl,
  });
  try {
    return unwrap(await client.getStaxProfile());
  } catch {
    const created = unwrap(await client.getOrCreateCreatorProfile());
    try {
      return unwrap(await client.getStaxProfile());
    } catch {
      return created;
    }
  }
}

export function profileUsername(value: JsonValue | undefined): string {
  return findString(value, new Set([
    'username',
    'user_name',
    'handle',
    'slug',
    'creatorUsername',
    'creator_username',
  ]));
}

function findString(value: JsonValue | undefined, keys: Set<string>, depth = 0): string {
  if (!isRecord(value) || depth > 5) return '';
  for (const key of keys) {
    const child = value[key];
    if (typeof child === 'string' && child.trim()) return child.trim().replace(/^@+/, '').slice(0, 80);
  }
  for (const child of Object.values(value)) {
    if (!isRecord(child)) continue;
    const found = findString(child, keys, depth + 1);
    if (found) return found;
  }
  return '';
}

function unwrap(value: JsonObject): JsonObject {
  const data = value.data;
  return isRecord(data) ? data : value;
}

function firstString(value: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const child = value[key];
    if (typeof child === 'string' && child.trim()) return child.trim();
  }
  return '';
}

function buildProfileEntryUrl(siteUrl: string, intent: string): string {
  const url = new URL('/profile', `${siteUrl}/`);
  url.searchParams.set('source', 'taku_creator');
  url.searchParams.set('intent', intent);
  return url.toString();
}

function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function creatorInitProjects(value: JsonObject): DiscoveredProject[] {
  return Array.isArray(value.projects) ? value.projects as unknown as DiscoveredProject[] : [];
}
