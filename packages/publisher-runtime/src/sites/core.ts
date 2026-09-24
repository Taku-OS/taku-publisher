import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PublisherError } from '../util.js';

export type SiteManifest = {
  manifestVersion: 1;
  auth: { mode: 'none' | 'optional' | 'required'; scopes: string[] };
  integrations: Array<{ name: string; operations: string[]; scopes: string[] }>;
  storage: { type: 'turso'; migrations: boolean };
  egress: { mode: 'platform-proxy' };
};

export type SiteArtifactObject = {
  ordinal: number;
  kind: 'worker' | 'asset' | 'migration';
  logicalName: string;
  absolutePath: string;
  sha256: string;
  size: number;
  contentType: string | null;
};

export type BuiltSiteArtifact = {
  descriptor: Record<string, unknown> & { projectId: string; buildId: string; siteManifest: SiteManifest };
  objects: SiteArtifactObject[];
  buildId: string;
  gitSha: string;
  contentDigest: string;
  manifestDigest: string;
  artifactDigest: string;
  releaseId: string;
  totalBytes: number;
};

export type SitesCore = {
  SITE_CLI_CONTRACT_VERSION: string;
  ARTIFACT_LIMITS: Record<string, number>;
  inspectProject(root: string): Promise<{ projectRoot: string; siteManifest: SiteManifest; assetsDirectory: string; workerEntrypoint: string }>;
  buildArtifact(root: string, options: { projectId: string; builtAt: string }): Promise<BuiltSiteArtifact>;
  validateArtifact(root: string, artifact: BuiltSiteArtifact): Promise<void>;
  readArtifactObject(object: SiteArtifactObject): Promise<Buffer>;
};

export type SitesCoreProvenance = {
  sourceRepository: string;
  sourceCommit: string;
  sha256: string;
  browserSdkSha256: string;
  contractVersion: string;
};

const coreFile = new URL('../../sites-core/index.mjs', import.meta.url);
const sdkFile = new URL('../../sites-core/browser-sdk.mjs', import.meta.url);
const provenanceFile = new URL('../../sites-core/provenance.json', import.meta.url);
let loaded: Promise<{ core: SitesCore; provenance: SitesCoreProvenance }> | undefined;

export async function loadSitesCore(): Promise<{ core: SitesCore; provenance: SitesCoreProvenance }> {
  loaded ??= (async () => {
    const provenance = JSON.parse(await readFile(provenanceFile, 'utf8')) as SitesCoreProvenance;
    const [coreBytes, sdkBytes] = await Promise.all([readFile(coreFile), readFile(sdkFile)]);
    if (sha256(coreBytes) !== provenance.sha256 || sha256(sdkBytes) !== provenance.browserSdkSha256) {
      throw new PublisherError('Bundled Sites contract integrity check failed.', 'sites_contract_integrity_failed');
    }
    const core = await import(coreFile.href) as SitesCore;
    if (core.SITE_CLI_CONTRACT_VERSION !== provenance.contractVersion) {
      throw new PublisherError('Bundled Sites contract version mismatch.', 'sites_contract_version_mismatch');
    }
    return { core, provenance };
  })();
  return loaded;
}

export async function browserSdkBytes(): Promise<Buffer> {
  await loadSitesCore();
  return readFile(sdkFile);
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
