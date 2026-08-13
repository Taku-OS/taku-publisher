#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { analyzeRepo } from './lib/analyzer.js';
import { routeRepoCapability } from './lib/capability-router.js';
import { prepareRepoSource } from './lib/repo-source.js';
import { computeTreeDigest } from './lib/tree-digest.js';

export const REPO_TO_STAX_ANALYZE_PROTOCOL = 'repo-to-stax.analyze.v1';
export const REPO_TO_STAX_CONVERTER_VERSION = '0.2.0';

interface AnalyzeArguments {
  input: string;
  workRoot: string;
  sourceRef?: string;
}

export async function analyzeForPublisher(args: AnalyzeArguments): Promise<unknown> {
  const prepared = await prepareRepoSource(args.input, resolve(args.workRoot), {
    ref: args.sourceRef,
  });
  const sourceDigest = await computeTreeDigest(prepared.repoRoot);
  const analysis = await analyzeRepo({
    repoRoot: prepared.repoRoot,
    source: {
      kind: prepared.sourceKind,
      path: prepared.repoRoot,
      url: prepared.sourceUrl,
      repo: prepared.repoSlug,
    },
    sourceUrl: prepared.sourceUrl,
  });
  const sourceDigestAfterAnalysis = await computeTreeDigest(prepared.repoRoot);
  if (sourceDigestAfterAnalysis !== sourceDigest) {
    throw new Error('Source changed during SubApp assessment. Run the assessment again.');
  }
  return {
    protocol: REPO_TO_STAX_ANALYZE_PROTOCOL,
    converterVersion: REPO_TO_STAX_CONVERTER_VERSION,
    sourceCommit: prepared.sourceCommit,
    sourceRef: prepared.sourceRef,
    sourceDirty: prepared.sourceDirty,
    sourceDigest,
    analysis,
    route: routeRepoCapability(analysis),
  };
}

function parseArguments(argv: string[]): AnalyzeArguments {
  if (argv[0] !== 'analyze' || !argv[1]) {
    throw new Error(
      'Usage: analyze-cli analyze <repo-or-path> --work-root <dir> [--source-ref <ref>]',
    );
  }
  const input = argv[1];
  let workRoot: string | undefined;
  let sourceRef: string | undefined;
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag === '--work-root' || flag === '--source-ref') && !value) {
      throw new Error(`${flag} requires a value`);
    }
    if (flag === '--work-root') {
      workRoot = value;
      index += 1;
      continue;
    }
    if (flag === '--source-ref') {
      sourceRef = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported analyze argument: ${flag}`);
  }
  if (!workRoot) throw new Error('--work-root is required');
  return { input, workRoot, ...(sourceRef ? { sourceRef } : {}) };
}

async function main(): Promise<void> {
  const result = await analyzeForPublisher(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
