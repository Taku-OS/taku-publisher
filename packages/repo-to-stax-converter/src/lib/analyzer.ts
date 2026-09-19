import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, pathExists, readJsonIfExists, readTextIfExists } from './fs.js';

const BUNDLED_TEMPLATE_ROOT = fileURLToPath(
  new URL('../../template/takuai-template/', import.meta.url),
);
const CREDENTIAL_RISK =
  'Credential/API key handling must be server-side or explicit BYOK';

export type RepoAppType =
  | 'nextjs'
  | 'vite-react'
  | 'fastapi-next'
  | 'streamlit'
  | 'gradio'
  | 'workflow-skill'
  | 'browser-extension'
  | 'external-connector'
  | 'python-cli'
  | 'unknown';

export type ConversionRecommendation = 'convertible' | 'manual-review' | 'not-recommended';

export interface RepoSourceInfo {
  kind: 'local' | 'github';
  path?: string;
  url?: string;
  repo?: string;
}

export interface RepoAnalysis {
  repoRoot: string;
  source: RepoSourceInfo;
  sourceUrl: string;
  packageName: string;
  description: string;
  appType: RepoAppType;
  score: number;
  recommendation: ConversionRecommendation;
  strategy: string;
  license: string;
  hasReadme: boolean;
  hasUi: boolean;
  reasons: string[];
  risks: string[];
  serviceRequirements: RepoServiceRequirement[];
}

export interface RepoServiceRequirement {
  id: 'external-service-review';
  capability: 'source-defined external provider API';
  required: true;
  operations: ['source-defined-provider-call'];
  dataClasses: ['undetermined'];
  mutation: true;
  mapping: {
    status: 'review-required';
    reason: string;
  };
}

interface PackageJson {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
}

interface BrowserManifest {
  manifest_version?: number;
}

interface RepoContentSignals {
  hasFastApi: boolean;
  hasStreamlit: boolean;
  hasGradio: boolean;
  hasTradingDomain: boolean;
  hasPrivateDocumentDomain: boolean;
  hasExternalServiceEvidence: boolean;
  hasDangerousCommandText: boolean;
  hasExternalConnector: boolean;
}

export async function analyzeRepo(params: {
  repoRoot: string;
  source?: RepoSourceInfo;
  sourceUrl?: string;
  templateBaselineRoot?: string | null;
}): Promise<RepoAnalysis> {
  const repoRoot = params.repoRoot;
  const rootPackage = await readJsonIfExists<PackageJson>(join(repoRoot, 'package.json'));
  const frontendPackage = await readJsonIfExists<PackageJson>(join(repoRoot, 'frontend', 'package.json'));
  const browserManifest = await readJsonIfExists<BrowserManifest>(join(repoRoot, 'manifest.json'));
  const packageJson = rootPackage ?? frontendPackage ?? null;
  const files = await listFiles(repoRoot);
  const contentSignals = await detectRepoContentSignals(
    repoRoot,
    files,
    params.templateBaselineRoot === undefined
      ? BUNDLED_TEMPLATE_ROOT
      : params.templateBaselineRoot,
  );
  const license = await detectLicense(repoRoot);
  const hasReadme = await hasAny(repoRoot, ['README.md', 'readme.md', 'README.MD']);
  const appType = detectAppType({ rootPackage, frontendPackage, browserManifest, files, contentSignals });
  const hasUi = detectHasUi(appType, files);
  const source = params.source ?? { kind: 'local', path: repoRoot };
  const sourceUrl = params.sourceUrl ?? source.url ?? source.path ?? repoRoot;
  const reasons = buildReasons(appType, hasUi, hasReadme, license);
  const risks = buildRisks(appType, files, packageJson, contentSignals, license);
  const serviceRequirements = buildServiceRequirements(contentSignals);
  const score = scoreRepo(appType, hasUi, hasReadme, license, risks);

  return {
    repoRoot,
    source,
    sourceUrl,
    packageName: packageJson?.name ?? source.repo?.split('/').at(-1) ?? 'unknown-repo',
    description: packageJson?.description ?? '',
    appType,
    score,
    recommendation: score >= 75 ? 'convertible' : score >= 45 ? 'manual-review' : 'not-recommended',
    strategy: strategyFor(appType),
    license,
    hasReadme,
    hasUi,
    reasons,
    risks,
    serviceRequirements,
  };
}

function detectAppType(input: {
  rootPackage: PackageJson | null;
  frontendPackage: PackageJson | null;
  browserManifest: BrowserManifest | null;
  files: string[];
  contentSignals: RepoContentSignals;
}): RepoAppType {
  const rootDeps = dependenciesOf(input.rootPackage);
  const frontendDeps = dependenciesOf(input.frontendPackage);
  const allDeps = new Set([...rootDeps, ...frontendDeps]);
  const fileSet = new Set(input.files);
  const hasFastApi =
    input.contentSignals.hasFastApi || (input.files.some(file => file.endsWith('.py')) && filesContain(input.files, ['fastapi']));
  const hasNext = allDeps.has('next') || input.files.some(file => /^src\/app\/.*page\.tsx$/.test(file) || /^app\/.*page\.tsx$/.test(file));
  const hasViteReact = allDeps.has('vite') && allDeps.has('react');
  const hasStreamlit = input.contentSignals.hasStreamlit || fileSet.has('.streamlit/config.toml') || filesContain(input.files, ['streamlit']);
  const hasGradio = input.contentSignals.hasGradio || filesContain(input.files, ['gradio']);
  const hasSkill = fileSet.has('AGENTS.md') && (input.files.some(file => file.startsWith('skills/')) || input.files.some(file => file.startsWith('commands/')));
  const hasStandaloneSkill =
    fileSet.has('SKILL.md') || input.files.some(file => /(?:^|\/)skills\/[^/]+\/SKILL\.md$/.test(file));
  const hasBrowserExtension = [2, 3].includes(input.browserManifest?.manifest_version ?? 0);
  const scripts = Object.keys(input.rootPackage?.scripts ?? {}).join(' ').toLowerCase();
  const hasExternalConnector =
    input.contentSignals.hasExternalConnector &&
    (Boolean(input.rootPackage?.bin) || /(?:daemon|bridge|bot|service)/.test(scripts));

  if (hasBrowserExtension) return 'browser-extension';
  if (hasExternalConnector) return 'external-connector';
  if (hasFastApi && hasNext) return 'fastapi-next';
  if (hasNext) return 'nextjs';
  if (hasViteReact) return 'vite-react';
  if (hasStreamlit) return 'streamlit';
  if (hasGradio) return 'gradio';
  if (hasSkill || hasStandaloneSkill) return 'workflow-skill';
  if (input.files.some(file => file.endsWith('.py'))) return 'python-cli';
  return 'unknown';
}

async function detectRepoContentSignals(
  repoRoot: string,
  files: string[],
  templateBaselineRoot: string | null,
): Promise<RepoContentSignals> {
  const signalTextParts: string[] = [];
  const externalServiceTextParts: string[] = [];
  const signalFiles = files.filter(isSignalFile);

  for (const file of signalFiles) {
    const text = await readTextIfExists(join(repoRoot, file));
    if (text) {
      signalTextParts.push(text.slice(0, 80_000));
      if (
        isExternalServiceSignalFile(file) &&
        !(await matchesBundledTemplateFile(templateBaselineRoot, file, text))
      ) {
        externalServiceTextParts.push(text.slice(0, 80_000));
      }
    }
  }

  const signalText = signalTextParts.join('\n').toLowerCase();
  const externalServiceText = externalServiceTextParts.join('\n');

  return {
    hasFastApi: /\bfastapi\b|from\s+fastapi\s+import|import\s+fastapi/.test(signalText),
    hasStreamlit: /\bstreamlit\b|import\s+streamlit/.test(signalText),
    hasGradio: /\bgradio\b|import\s+gradio/.test(signalText),
    hasTradingDomain: /\b(backtest|trading|stock|ticker|portfolio|investment|pnl|drawdown|crypto)\b/.test(signalText),
    hasPrivateDocumentDomain:
      /\b(resume|pdf|upload|embedding|faiss|transcript|xlsx|csv)\b/.test(signalText) ||
      /\b(?:private|personal|confidential|uploaded?)\s+documents?\b/.test(signalText) ||
      /\bdocuments?\s+(?:upload|ingest|parser|processing|embedding|analysis)\b/.test(signalText),
    hasExternalServiceEvidence: detectExternalServiceEvidence(externalServiceText),
    hasDangerousCommandText: /\b(child_process|subprocess\.|os\.system|eval\(|new function|rm -rf|curl\s+.*\|\s*sh)\b/.test(signalText),
    hasExternalConnector:
      /\b(?:daemon|webhook|oauth|bot|bridge|qr code|long-lived service)\b/.test(signalText),
  };
}

async function matchesBundledTemplateFile(
  templateBaselineRoot: string | null,
  relativePath: string,
  sourceText: string,
): Promise<boolean> {
  if (!templateBaselineRoot) return false;
  const baselineText = await readTextIfExists(join(templateBaselineRoot, relativePath));
  return baselineText !== null && baselineText === sourceText;
}

function isExternalServiceSignalFile(file: string): boolean {
  const lower = file.toLowerCase();
  if (
    /(?:^|\/)(?:docs?|examples?|test|tests|__tests__)(?:\/|$)/.test(lower) ||
    /\.(?:test|spec)\.[^.]+$/.test(lower) ||
    /(?:^|\/)(?:readme|changelog|releasing)(?:\.[^/]*)?$/.test(lower)
  ) {
    return false;
  }
  return (
    /\.(?:cjs|go|java|js|jsx|json|kt|mjs|php|py|rb|rs|ts|tsx)$/.test(lower) ||
    /(?:^|\/)\.env(?:\.|$)/.test(lower) ||
    lower.includes('requirements') ||
    lower.includes('dockerfile')
  );
}

function detectExternalServiceEvidence(text: string): boolean {
  if (!text) return false;
  const credentialUsage =
    /process\.env(?:\.|\[['"])[A-Z0-9_]*(?:API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|SECRET|CLIENT_SECRET)\b/i.test(text) ||
    /(?:os\.getenv|os\.environ(?:\.get|\[))\s*\(?\s*['"][A-Z0-9_]*(?:API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|SECRET|CLIENT_SECRET)\b/i.test(text) ||
    /(?:authorization|x-api-key)\s*['"]?\s*[:=]\s*[`'"](?:bearer\s+)?\$?\{?/i.test(text);
  if (credentialUsage) return true;

  const externalSdkDependency =
    /["'](?:@anthropic-ai\/sdk|@google\/generative-ai|openai|stripe|replicate|twilio|@aws-sdk\/[^"']+)["']\s*:/i.test(text);
  if (externalSdkDependency) return true;

  const requestPattern =
    /(?:fetch|axios\.(?:get|post|put|patch|delete)|requests\.(?:get|post|put|patch|delete)|httpx\.(?:get|post|put|patch|delete))\s*\(\s*[`'"](https?:\/\/[^`'"\s]+)/gi;
  for (const match of text.matchAll(requestPattern)) {
    try {
      const hostname = new URL(match[1]).hostname.toLowerCase();
      if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

function isSignalFile(file: string): boolean {
  const lower = file.toLowerCase();
  return (
    lower.endsWith('.py') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.toml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.json') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.includes('requirements') ||
    lower.includes('dockerfile')
  );
}

function dependenciesOf(pkg: PackageJson | null): string[] {
  if (!pkg) return [];
  return Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
}

function filesContain(files: string[], token: string[]): boolean {
  const lowered = files.map(file => file.toLowerCase());
  return token.some(t => lowered.some(file => file.includes(t.toLowerCase())));
}

function detectHasUi(appType: RepoAppType, files: string[]): boolean {
  if (['nextjs', 'vite-react', 'fastapi-next', 'streamlit', 'gradio'].includes(appType)) return true;
  return files.some(file => /\.(tsx|jsx|vue|svelte)$/.test(file));
}

async function hasAny(root: string, names: string[]): Promise<boolean> {
  for (const name of names) {
    if (await pathExists(join(root, name))) return true;
  }
  return false;
}

async function detectLicense(root: string): Promise<string> {
  const text =
    (await readTextIfExists(join(root, 'LICENSE'))) ??
    (await readTextIfExists(join(root, 'LICENSE.md'))) ??
    (await readTextIfExists(join(root, 'COPYING'))) ??
    '';
  const normalized = text.toLowerCase();
  if (normalized.includes('apache license') && normalized.includes('version 2.0')) return 'Apache-2.0';
  if (normalized.includes('mit license')) return 'MIT';
  if (normalized.includes('gnu affero')) return 'AGPL-3.0';
  if (normalized.includes('gnu general public license')) return 'GPL';
  if (normalized.includes('bsd')) return 'BSD';
  return text.trim() ? 'Custom' : 'Unknown';
}

function buildReasons(
  appType: RepoAppType,
  hasUi: boolean,
  hasReadme: boolean,
  license: string
): string[] {
  const reasons: string[] = [];
  const labels: Record<RepoAppType, string> = {
    nextjs: 'Next.js app detected',
    'vite-react': 'Vite React app detected',
    'fastapi-next': 'FastAPI + frontend app detected',
    streamlit: 'Streamlit app detected',
    gradio: 'Gradio app detected',
    'workflow-skill': 'Workflow/skill repo detected',
    'browser-extension': 'Browser extension runtime detected',
    'external-connector': 'External connector or daemon runtime detected',
    'python-cli': 'Python repo detected',
    unknown: 'No known app framework detected',
  };
  reasons.push(labels[appType]);
  if (hasUi) reasons.push('Interactive UI surface detected');
  if (hasReadme) reasons.push('README present for product extraction');
  if (license !== 'Unknown') reasons.push(`License detected: ${license}`);
  return reasons;
}

function buildRisks(
  appType: RepoAppType,
  files: string[],
  pkg: PackageJson | null,
  signals: RepoContentSignals,
  license: string
): string[] {
  const risks: string[] = [];
  if (appType === 'unknown') risks.push('Unknown framework requires manual review');
  if (appType === 'workflow-skill') risks.push('Workflow repo needs a new UI wrapper');
  if (appType === 'browser-extension') risks.push('Browser extensions are reference-only in Taku Stax');
  if (appType === 'external-connector') risks.push('External connectors require an independently managed runtime');
  if (appType === 'streamlit' || appType === 'gradio') risks.push('Python UI must be ported to Next.js');
  if (license === 'Unknown') risks.push('Unknown license blocks publish until review');
  if (files.some(file => file.toLowerCase().includes('docker-compose'))) risks.push('Docker compose dependency may require manual extraction');
  const deps = dependenciesOf(pkg).join(' ').toLowerCase();
  if (deps.includes('cuda') || deps.includes('torch')) risks.push('Heavy ML dependencies may not fit a local SubApp');
  if (signals.hasTradingDomain) risks.push('Financial or trading workflow needs no-advice/no-live-orders safety review');
  if (signals.hasPrivateDocumentDomain) risks.push('Document or upload workflow may handle sensitive user data');
  if (signals.hasExternalServiceEvidence) risks.push(CREDENTIAL_RISK);
  if (signals.hasDangerousCommandText) risks.push('Potential command execution requires security review before conversion');
  return risks;
}

function buildServiceRequirements(
  signals: RepoContentSignals,
): RepoServiceRequirement[] {
  if (!signals.hasExternalServiceEvidence) return [];
  return [
    {
      id: 'external-service-review',
      capability: 'source-defined external provider API',
      required: true,
      operations: ['source-defined-provider-call'],
      dataClasses: ['undetermined'],
      mutation: true,
      mapping: {
        status: 'review-required',
        reason:
          'The Converter detected executable external-service usage. Map the exact operation to current Taku service catalog IDs before conversion.',
      },
    },
  ];
}

function scoreRepo(appType: RepoAppType, hasUi: boolean, hasReadme: boolean, license: string, risks: string[]): number {
  let score = 20;
  if (appType === 'nextjs') score += 55;
  else if (appType === 'fastapi-next') score += 50;
  else if (appType === 'vite-react') score += 45;
  else if (appType === 'streamlit' || appType === 'gradio') score += 35;
  else if (appType === 'workflow-skill') score += 30;
  else if (appType === 'browser-extension' || appType === 'external-connector') score += 5;
  else if (appType === 'python-cli') score += 15;
  if (hasUi) score += 15;
  if (hasReadme) score += 10;
  if (license !== 'Unknown') score += 10;
  score -= risks.length * 6;
  return Math.max(0, Math.min(100, score));
}

function strategyFor(appType: RepoAppType): string {
  switch (appType) {
    case 'nextjs':
      return 'direct-nextjs-subapp-adaptation';
    case 'fastapi-next':
      return 'fullstack-api-and-ui-port';
    case 'vite-react':
      return 'react-ui-port-to-next-app-router';
    case 'streamlit':
      return 'streamlit-flow-rewrite-to-nextjs';
    case 'gradio':
      return 'gradio-flow-rewrite-to-nextjs';
    case 'workflow-skill':
      return 'native-stax-skill-import';
    case 'browser-extension':
      return 'reference-only-browser-extension';
    case 'external-connector':
      return 'reference-only-external-connector';
    case 'python-cli':
      return 'cli-to-guided-ui-wrapper';
    default:
      return 'manual-product-extraction';
  }
}
