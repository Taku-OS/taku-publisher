import { createHash } from 'node:crypto';
import type { CopyOmission } from './fs.js';

export const SOURCE_SNAPSHOT_POLICY = 'taku.upstream-source-snapshot.v1' as const;
export const SOURCE_MANIFEST_PATH = '.taku/upstream-source-manifest.json' as const;
export const SOURCE_EVIDENCE_POLICY_PATH = '.taku/source-evidence-policy.json' as const;

export interface SourceEvidencePolicy {
  schemaVersion: 'taku.source-evidence-policy.v2';
  migrationSchemaVersion: 'taku.subapp-migration.v2';
  sourceManifestPath: typeof SOURCE_MANIFEST_PATH;
  sourceManifestDigest: string;
}

export function createSourceEvidencePolicy(sourceManifestDigest: string): SourceEvidencePolicy {
  return {
    schemaVersion: 'taku.source-evidence-policy.v2',
    migrationSchemaVersion: 'taku.subapp-migration.v2',
    sourceManifestPath: SOURCE_MANIFEST_PATH,
    sourceManifestDigest,
  };
}

export function computeSourceEvidencePolicyDigest(
  policy: SourceEvidencePolicy
): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(policy)).digest('hex')}`;
}

export interface SourceProvenanceBinding {
  sourceKind: 'local' | 'github';
  sourceRepo: string;
  sourceUrl: string;
  sourceCommit: string | null;
  sourceRef: string | null;
  sourceDirty: boolean | null;
  sourceLicense: string;
  snapshotPath: 'upstream-source';
  snapshotDigest: string;
  snapshotPolicy: typeof SOURCE_SNAPSHOT_POLICY;
  snapshotCompleteness: 'complete' | 'partial';
  omissions: CopyOmission[];
  sourceManifestPath: typeof SOURCE_MANIFEST_PATH;
  sourceManifestDigest: string;
  sourceEvidencePolicyPath: typeof SOURCE_EVIDENCE_POLICY_PATH;
  sourceEvidencePolicyDigest: string;
  migrationImmutableDigest: string;
}

export interface MigrationImmutableBinding {
  schemaVersion: 'taku.subapp-migration.v2';
  createdAt: string;
  source: Record<string, unknown>;
  template: Record<string, unknown>;
  analysis: {
    appType: string;
    strategy: string;
    score: number;
    recommendation: string;
    risks: string[];
  };
}

export function computeMigrationImmutableDigest(
  binding: MigrationImmutableBinding
): `sha256:${string}` {
  const source = binding.source;
  const template = binding.template;
  const canonical = {
    schemaVersion: binding.schemaVersion,
    createdAt: binding.createdAt,
    source: {
      kind: source.kind,
      url: source.url,
      repo: source.repo,
      commit: source.commit,
      ref: source.ref,
      dirty: source.dirty,
      license: source.license,
      snapshotPath: source.snapshotPath,
      snapshotDigest: source.snapshotDigest,
      snapshotPolicy: source.snapshotPolicy,
      snapshotCompleteness: source.snapshotCompleteness,
      omissions: source.omissions,
      sourceManifestPath: source.sourceManifestPath,
      sourceManifestDigest: source.sourceManifestDigest,
      sourceEvidencePolicyPath: source.sourceEvidencePolicyPath,
      sourceEvidencePolicyDigest: source.sourceEvidencePolicyDigest,
    },
    template: {
      kind: template.kind,
      url: template.url,
      requestedRef: template.requestedRef,
      resolvedRef: template.resolvedRef,
      commit: template.commit,
      version: template.version,
      policyApplied: template.policyApplied,
      dirty: template.dirty,
      snapshotDigest: template.snapshotDigest,
    },
    analysis: {
      appType: binding.analysis.appType,
      strategy: binding.analysis.strategy,
      score: binding.analysis.score,
      recommendation: binding.analysis.recommendation,
      risks: binding.analysis.risks,
    },
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

export function computeSourceProvenanceDigest(
  binding: SourceProvenanceBinding
): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(binding)).digest('hex')}`;
}
