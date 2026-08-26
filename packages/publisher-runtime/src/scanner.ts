import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { MAX_TEXT_SCAN_BYTES, SCHEMA_VERSION } from './constants.js';
import type { JsonObject, JsonValue, PublisherState } from './types.js';
import {
  atomicWriteJson,
  isRecord,
  nowIso,
  PublisherError,
  readJson,
  saveState,
} from './util.js';
import { assertStageUnchanged } from './workspace.js';

const PLACEHOLDER_PATTERN = /(?:change[-_ ]?me|example|fake|fixture|placeholder|replace[-_ ]?me|sample|test|xxx+|your[-_ ]?(?:api[-_ ]?)?(?:key|token|secret|password)|<[^>]+>|\$\{[A-Z][A-Z0-9_]+\})/i;
const ENV_REFERENCE_PATTERN = /(?:process\.env|import\.meta\.env|os\.environ|os\.getenv|getenv\s*\(|ENV\s*\[|os\.Getenv)/i;
const SECRET_NAME_PATTERN = /(?:api[_-]?key|access[_-]?key|auth(?:orization)?|bearer|client[_-]?secret|credential|password|passwd|private[_-]?key|secret|session|token)/i;
const KNOWN_TOKEN_PATTERN = /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{20,})\b/g;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g;
const BEARER_PATTERN = /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})\b/gi;
const DATABASE_URL_PATTERN = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|mssql):\/\/[^\s:/@]+:([^\s/@]+)@/gi;
const ABSOLUTE_PATH_PATTERNS = [
  /(?:^|[\s"'`(])(?:\/Users|\/home|\/private\/var\/folders|\/var\/folders|\/Volumes)\/[^\s"'`)]+/g,
  /[A-Za-z]:\\(?:Users|Documents and Settings)\\/gi,
  /file:\/\/\//gi,
];
const PRIVATE_URL_PATTERN = /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[[fF][eE]80:[^\]]+\]|[^/\s"'`]+\.(?:local|internal))(?:[:/?#\s"'`)]|$)/gi;
const LOOPBACK_URL_PATTERN = /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?:[:/?#\s"'`)]|$)/gi;
const NON_LOOPBACK_PRIVATE_URL_PATTERN = /https?:\/\/(?:0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[[fF][eE]80:[^\]]+\]|[^/\s"'`]+\.(?:local|internal))(?:[:/?#\s"'`)]|$)/gi;
const CREDENTIAL_ASSIGNMENT_PATTERN = /\b([A-Za-z][A-Za-z0-9_.-]*)\b\s*[:=]\s*(.+)$/i;
const SECRET_ENV_NAME_PATTERN = /(?:API_KEY|ACCESS_KEY|AUTH|BEARER|CLIENT_SECRET|CREDENTIAL|PASSWORD|PASSWD|PRIVATE_KEY|SECRET|SESSION|TOKEN)(?:_|$)/i;
const MAX_SCAN_FINDINGS = 500;

const RISK_PATTERNS: Array<[string, string, RegExp]> = [
  ['dangerous_command', 'Potentially destructive or privilege-changing command requires semantic review.', /(?:\brm\s+-[rf]{1,2}\b|\bsudo\b|\bchmod\s+(?:777|a\+rwx)\b|\bchown\s+-R\b|\bmkfs\b|\bdd\s+if=)/i],
  ['shell_download_execution', 'Downloaded content or dynamic text may be executed by a shell.', /(?:curl|wget)[^\n|;]*(?:\||;|&&)\s*(?:ba)?sh\b/i],
  ['process_execution', 'The tool launches a process or shell command and needs argument-flow review.', /(?:child_process\.(?:exec|execSync|spawn)|subprocess\.(?:run|Popen|call)|os\.system\s*\(|Runtime\.getRuntime\(\)\.exec|Command::new\s*\()/],
  ['dynamic_code_execution', 'Dynamic code evaluation needs input provenance review.', /(?:\beval\s*\(|\bnew\s+Function\s*\(|\bexec\s*\()/],
  ['network_access', 'Outbound network access needs endpoint and data-flow review.', /(?:\bfetch\s*\(|axios\.|requests\.(?:get|post|put|patch|delete)|urllib\.request|httpx\.|https?\.request\s*\(|net\.Dial\s*\(|WebSocket\s*\()/],
  ['broad_filesystem_access', 'Broad filesystem access needs scope and purpose review.', /(?:readFile|writeFile|readdir|read_text|write_text|open\s*\(|os\.walk\s*\(|glob\s*\(|Path\.home\s*\()/],
  ['broad_permission', 'A broad permission declaration needs least-privilege review.', /(?:"permissions"\s*:\s*\[?\s*"?\*|--privileged\b|hostNetwork\s*:\s*true|allowDangerouslySkipPermissions)/i],
];

const REQUIREMENT_PATTERNS: Array<[RegExp, boolean]> = [
  [/\bos\.environ\s*\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g, true],
  [/\bENV\s*\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g, true],
  [/\b(?:requireEnv|getRequiredEnv|mustGetEnv)\s*\(\s*["']([A-Z][A-Z0-9_]*)["']/g, true],
  [/\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g, false],
  [/\bprocess\.env\s*\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g, false],
  [/\bimport\.meta\.env\.([A-Z][A-Z0-9_]*)\b/g, false],
  [/\bos\.environ\.get\s*\(\s*["']([A-Z][A-Z0-9_]*)["']/g, false],
  [/\bos\.getenv\s*\(\s*["']([A-Z][A-Z0-9_]*)["']/g, false],
  [/(?<![.\w])getenv\s*\(\s*["']([A-Z][A-Z0-9_]*)["']/g, false],
  [/\bos\.Getenv\s*\(\s*["']([A-Z][A-Z0-9_]*)["']/g, false],
];

export async function scanStaging(directory: string, state: PublisherState): Promise<JsonObject> {
  const manifest = await assertStageUnchanged(directory, state);
  const files = Array.isArray(manifest.files) ? manifest.files.filter(isRecord) : [];
  const staging = path.join(directory, 'staging');
  let findings: JsonObject[] = [];
  const requirements = new Map<string, JsonObject>();
  const reviewFiles: JsonObject[] = [];

  for (const entry of files) {
    const relative = String(entry.path ?? '');
    const size = Number(entry.size ?? 0);
    const file = path.join(staging, relative);
    const text = await readTextFile(file, size);
    if (text === undefined) continue;
    reviewFiles.push({ path: relative, sha256: entry.sha256, size });
    scanText(relative, text, findings);
    extractRequirements(relative, text, requirements);
    if (isEnvTemplate(path.basename(file))) extractEnvTemplateRequirements(relative, text, requirements);
  }
  findings = boundedFindings(findings);
  const requirementList = [...requirements.values()]
    .sort((left, right) => `${left.kind}\0${left.name}`.localeCompare(`${right.kind}\0${right.name}`));
  const blocking = findings.filter((item) => item.severity === 'block');
  const review = findings.filter((item) => item.severity === 'review');
  const report: JsonObject = {
    schema_version: SCHEMA_VERSION,
    stage_sha256: manifest.stage_sha256,
    generated_at: nowIso(),
    summary: {
      blocking: blocking.length,
      review_required: review.length,
      text_files_reviewed: reviewFiles.length,
    },
    findings,
    deep_scan: { required: true, completed: false, blocked: false },
  };
  const requirementsDocument: JsonObject = {
    schema_version: SCHEMA_VERSION,
    stage_sha256: manifest.stage_sha256,
    secrets: requirementList.filter((item) => item.kind === 'secret'),
    env: requirementList.filter((item) => item.kind === 'env'),
  };
  const deepRequest: JsonObject = {
    schema_version: SCHEMA_VERSION,
    stage_sha256: manifest.stage_sha256,
    instructions: [
      'Review every listed text file for semantic secret use, data exfiltration, unsafe execution, excessive permissions, and undeclared configuration.',
      'Resolve every generated finding and record any additional semantic finding.',
      'Never copy a real credential value into the dispositions file.',
    ],
    generated_findings: review,
    review_files: reviewFiles,
    requirements: requirementList,
  };
  const dispositionTemplate: JsonObject = {
    schema_version: SCHEMA_VERSION,
    stage_sha256: manifest.stage_sha256,
    full_review_completed: false,
    dispositions: review.map((item) => ({ finding_id: item.id, decision: 'pending', rationale: '' })),
    additional_findings: [],
    requirement_updates: [],
  };
  await Promise.all([
    atomicWriteJson(path.join(directory, 'scan-report.json'), report),
    atomicWriteJson(path.join(directory, 'requirements.json'), requirementsDocument),
    atomicWriteJson(path.join(directory, 'deep-scan-request.json'), deepRequest),
    atomicWriteJson(path.join(directory, 'deep-scan-dispositions.template.json'), dispositionTemplate),
  ]);
  state.status = blocking.length ? 'deterministic_blocked' : 'awaiting_deep_scan';
  state.scan_summary = report.summary;
  state.updated_at = nowIso();
  await saveState(directory, state);
  return {
    report,
    requirements: requirementsDocument,
    deep_scan_request: deepRequest,
    disposition_template: dispositionTemplate,
  };
}

export async function applyDeepScanDispositions(
  directory: string,
  state: PublisherState,
  sourceFile: string,
): Promise<JsonObject> {
  await assertStageUnchanged(directory, state);
  const report = requireRecord(await readJson(path.join(directory, 'scan-report.json')), 'invalid_scan_report');
  const request = requireRecord(await readJson(path.join(directory, 'deep-scan-request.json')), 'invalid_scan_report');
  const dispositions = requireRecord(await readJson(path.resolve(sourceFile)), 'invalid_dispositions');
  if (dispositions.stage_sha256 !== state.stage_sha256) {
    throw new PublisherError('Dispositions do not match the immutable staging snapshot.', 'stale_dispositions');
  }
  if (dispositions.full_review_completed !== true) {
    throw new PublisherError('Deep scan has not attested review of every listed text file.', 'deep_scan_incomplete');
  }
  const generated = Array.isArray(request.generated_findings)
    ? request.generated_findings.filter(isRecord)
    : [];
  const expectedIds = new Set(generated.map((item) => String(item.id ?? '')));
  if (!Array.isArray(dispositions.dispositions)) {
    throw new PublisherError('Dispositions must contain a dispositions array.', 'invalid_dispositions');
  }
  const seen = new Set<string>();
  const normalizedRows: JsonObject[] = [];
  for (const value of dispositions.dispositions) {
    if (!isRecord(value)) throw new PublisherError('Every disposition must be an object.', 'invalid_dispositions');
    const findingId = String(value.finding_id ?? '').trim();
    const decision = String(value.decision ?? '').trim();
    const rationale = cleanRationale(value.rationale);
    if (!expectedIds.has(findingId) || seen.has(findingId)) {
      throw new PublisherError('Disposition finding IDs must exactly match generated findings.', 'invalid_dispositions');
    }
    if (!['allow', 'block', 'not_applicable'].includes(decision)) {
      throw new PublisherError('A disposition decision must be allow, block, or not_applicable.', 'invalid_dispositions');
    }
    if (rationale.length < 10) {
      throw new PublisherError('Every disposition needs a meaningful rationale.', 'invalid_dispositions');
    }
    assertNoSecretValue(rationale);
    seen.add(findingId);
    normalizedRows.push({ finding_id: findingId, decision, rationale });
  }
  if (seen.size !== expectedIds.size || [...expectedIds].some((id) => !seen.has(id))) {
    throw new PublisherError('Every generated deep-scan finding must be resolved.', 'deep_scan_incomplete');
  }
  const staging = path.join(directory, 'staging');
  const additional = await normalizeAdditionalFindings(dispositions.additional_findings, staging);
  const requirementUpdates = await applyRequirementUpdates(directory, dispositions.requirement_updates, staging);
  const blocked = normalizedRows.some((row) => row.decision === 'block')
    || additional.some((item) => item.decision === 'block');
  const deterministicBlocked = Array.isArray(report.findings)
    && report.findings.filter(isRecord).some((item) => item.severity === 'block');
  const reviewed: JsonObject = {
    schema_version: SCHEMA_VERSION,
    stage_sha256: state.stage_sha256,
    full_review_completed: true,
    dispositions: normalizedRows,
    additional_findings: additional,
    requirement_updates: requirementUpdates,
    completed_at: nowIso(),
    blocked,
  };
  assertNoSecretValue(JSON.stringify(reviewed));
  await atomicWriteJson(path.join(directory, 'deep-scan-dispositions.json'), reviewed);
  report.deep_scan = {
    required: true,
    completed: true,
    blocked,
    resolved_findings: normalizedRows.length,
    additional_findings: additional.length,
  };
  await atomicWriteJson(path.join(directory, 'scan-report.json'), report);
  state.status = blocked || deterministicBlocked ? 'blocked' : 'ready_to_package';
  state.deep_scan_completed = true;
  state.deep_scan_blocked = blocked;
  state.updated_at = nowIso();
  await saveState(directory, state);
  return reviewed;
}

export async function assertScanReady(directory: string, state: PublisherState): Promise<void> {
  await assertStageUnchanged(directory, state);
  const report = requireRecord(await readJson(path.join(directory, 'scan-report.json')), 'invalid_scan_report');
  if (Array.isArray(report.findings) && report.findings.filter(isRecord).some((item) => item.severity === 'block')) {
    throw new PublisherError('Deterministic security findings block packaging.', 'deterministic_scan_blocked');
  }
  const deepPath = path.join(directory, 'deep-scan-dispositions.json');
  if (!fs.existsSync(deepPath)) {
    throw new PublisherError('Deep scan is incomplete; apply the reviewed dispositions first.', 'deep_scan_incomplete');
  }
  const deep = requireRecord(await readJson(deepPath), 'deep_scan_incomplete');
  if (deep.stage_sha256 !== state.stage_sha256 || deep.full_review_completed !== true) {
    throw new PublisherError('Deep scan is incomplete or stale.', 'deep_scan_incomplete');
  }
  if (deep.blocked === true) throw new PublisherError('Deep scan contains a blocking disposition.', 'deep_scan_blocked');
}

export async function buildPlatformScanPayload(directory: string, state: PublisherState): Promise<JsonObject> {
  await assertScanReady(directory, state);
  const packageSha256 = String(state.bundle_sha256 ?? '').trim();
  if (!/^[a-f0-9]{64}$/.test(packageSha256)) {
    throw new PublisherError('Build the verified bundle before uploading scan results.', 'missing_bundle');
  }
  const report = requireRecord(await readJson(path.join(directory, 'scan-report.json')), 'invalid_scan_report');
  const request = requireRecord(await readJson(path.join(directory, 'deep-scan-request.json')), 'invalid_scan_report');
  const deep = requireRecord(await readJson(path.join(directory, 'deep-scan-dispositions.json')), 'deep_scan_incomplete');
  const requirements = requireRecord(await readJson(path.join(directory, 'requirements.json')), 'invalid_requirements');
  const deterministicFindings = Array.isArray(report.findings)
    ? report.findings.filter(isRecord).filter((item) => item.severity !== 'block')
      .map((item) => platformFinding(item, 'review', 'warning'))
    : [];
  const generated = new Map<string, JsonObject>();
  if (Array.isArray(request.generated_findings)) {
    for (const item of request.generated_findings.filter(isRecord)) generated.set(String(item.id ?? ''), item);
  }
  const deepFindings: JsonObject[] = [];
  if (Array.isArray(deep.dispositions)) {
    for (const row of deep.dispositions.filter(isRecord)) {
      const source = generated.get(String(row.finding_id ?? ''));
      if (source) deepFindings.push(platformFinding(source, 'allow', 'warning', row.rationale));
    }
  }
  if (Array.isArray(deep.additional_findings)) {
    for (const item of deep.additional_findings.filter(isRecord)) {
      deepFindings.push(platformFinding(item, 'allow', 'warning', item.rationale));
    }
  }
  const summary = isRecord(report.summary) ? report.summary : {};
  const payload: JsonObject = {
    schemaVersion: SCHEMA_VERSION,
    packageSha256,
    report: {
      deterministic: {
        status: deterministicFindings.length ? 'review' : 'passed',
        scanner: 'taku-publisher-deterministic@1',
        filesScanned: Number(summary.text_files_reviewed ?? 0),
        findings: deterministicFindings,
      },
      deep: { status: 'passed', scanner: 'host-semantic-review@1', findings: deepFindings },
    },
    requirements: {
      secrets: platformRequirements(requirements.secrets, false),
      env: platformRequirements(requirements.env, true),
    },
  };
  assertPublicPayload(payload);
  return payload;
}

export function assertPublicPayload(value: JsonValue): void {
  const serialized = JSON.stringify(value);
  assertNoSecretValue(serialized);
  PRIVATE_URL_PATTERN.lastIndex = 0;
  if (PRIVATE_URL_PATTERN.test(serialized) || ABSOLUTE_PATH_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(serialized);
  })) {
    throw new PublisherError('Public metadata contains a local path or private-network URL.', 'private_metadata');
  }
}

function scanText(relative: string, text: string, findings: JsonObject[]): void {
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (!/\b(?:re\.compile|RegExp)\s*\(/.test(line)) {
      if (test(PRIVATE_KEY_PATTERN, line)) findings.push(finding('private_key', 'block', relative, lineNumber, 'Private key material is not publishable.', line));
      if (test(KNOWN_TOKEN_PATTERN, line)) findings.push(finding('known_token', 'block', relative, lineNumber, 'A value matches a known credential format.', line));
      const bearer = firstMatch(BEARER_PATTERN, line);
      if (bearer?.[1] && !PLACEHOLDER_PATTERN.test(bearer[1])) findings.push(finding('bearer_token', 'block', relative, lineNumber, 'A literal Bearer credential is not publishable.', line));
      const database = firstMatch(DATABASE_URL_PATTERN, line);
      if (database?.[1] && !PLACEHOLDER_PATTERN.test(database[1])) findings.push(finding('database_password_url', 'block', relative, lineNumber, 'A database URL contains embedded credentials.', line));
      if (test(NON_LOOPBACK_PRIVATE_URL_PATTERN, line)) findings.push(finding('private_network_url', 'block', relative, lineNumber, 'A local or private-network URL is not portable or public.', line));
      if (test(LOOPBACK_URL_PATTERN, line)) findings.push(finding('loopback_url', 'review', relative, lineNumber, 'A loopback URL requires portability review and must not appear in public metadata.', line));
      if (ABSOLUTE_PATH_PATTERNS.some((pattern) => test(pattern, line))) findings.push(finding('local_absolute_path', 'block', relative, lineNumber, 'A machine-specific absolute path is not publishable.', line));
      const assignment = CREDENTIAL_ASSIGNMENT_PATTERN.exec(line);
      if (assignment?.[1] && assignment[2] && isSensitiveCredentialName(assignment[1]) && looksLikeLiteralSecret(assignment[2])) {
        findings.push(finding('credential_literal', 'block', relative, lineNumber, 'A credential-like field contains a literal value.', line));
      }
    }
    for (const [category, message, pattern] of RISK_PATTERNS) {
      if (pattern.test(line)) findings.push(finding(category, 'review', relative, lineNumber, message, line));
    }
  }
}

function extractRequirements(relative: string, text: string, output: Map<string, JsonObject>): void {
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const [pattern, required] of REQUIREMENT_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        if (match[1]) recordRequirement(output, match[1], relative, index + 1, required);
      }
    }
  }
}

function boundedFindings(findings: JsonObject[]): JsonObject[] {
  if (findings.length <= MAX_SCAN_FINDINGS) return findings;
  const capacity = MAX_SCAN_FINDINGS - 1;
  const blocking = findings.filter((item) => item.severity === 'block');
  const reviews = findings.filter((item) => item.severity !== 'block');
  const blockersTruncated = blocking.length > capacity;
  const selected = blocking.slice(0, capacity);
  if (!blockersTruncated) selected.push(...reviews.slice(0, capacity - selected.length));
  const omitted = findings.length - selected.length;
  selected.push(finding(
    'finding_limit',
    blockersTruncated ? 'block' : 'review',
    '.',
    0,
    `The scan generated ${findings.length} findings; ${omitted} lower-priority findings were omitted from this bounded report.`,
    '',
  ));
  return selected;
}

function extractEnvTemplateRequirements(relative: string, text: string, output: Map<string, JsonObject>): void {
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match?.[1]) continue;
    const value = String(match[2] ?? '').trim().replace(/^["']|["']$/g, '');
    if (value && !PLACEHOLDER_PATTERN.test(value)) continue;
    recordRequirement(output, match[1], relative, index + 1, !value);
  }
}

function recordRequirement(
  output: Map<string, JsonObject>,
  name: string,
  relative: string,
  line: number,
  required: boolean,
): void {
  const existing = output.get(name) ?? {
    name,
    kind: SECRET_ENV_NAME_PATTERN.test(name) ? 'secret' : 'env',
    required,
    purpose: `Used by ${relative}`,
    sources: [],
  };
  existing.required = Boolean(existing.required || required);
  const sources = Array.isArray(existing.sources) ? existing.sources : [];
  if (!sources.some((source) => isRecord(source) && source.path === relative && source.line === line)) {
    sources.push({ path: relative, line });
  }
  existing.sources = sources;
  output.set(name, existing);
}

function finding(category: string, severity: string, filePath: string, line: number, message: string, excerpt: string): JsonObject {
  const id = createHash('sha256').update(`${category}\0${severity}\0${filePath}\0${line}\0${message}`).digest('hex').slice(0, 20);
  return { id: `finding_${id}`, category, severity, path: filePath, line, message, excerpt: redactExcerpt(excerpt) };
}

function redactExcerpt(value: string): string {
  let text = String(value ?? '').trim().slice(0, 500);
  text = replace(PRIVATE_KEY_PATTERN, text, '[REDACTED PRIVATE KEY]');
  text = replace(KNOWN_TOKEN_PATTERN, text, '[REDACTED TOKEN]');
  text = replace(BEARER_PATTERN, text, 'Bearer [REDACTED]');
  text = replace(DATABASE_URL_PATTERN, text, 'database://[REDACTED]@');
  text = replace(PRIVATE_URL_PATTERN, text, '[REDACTED PRIVATE URL]');
  for (const pattern of ABSOLUTE_PATH_PATTERNS) text = replace(pattern, text, ' [REDACTED LOCAL PATH]');
  const assignment = CREDENTIAL_ASSIGNMENT_PATTERN.exec(text);
  if (assignment?.[1] && assignment[2] && isSensitiveCredentialName(assignment[1]) && looksLikeLiteralSecret(assignment[2])) {
    const start = text.lastIndexOf(assignment[2]);
    if (start >= 0) text = `${text.slice(0, start)}[REDACTED]`;
  }
  return text;
}

function isSensitiveCredentialName(rawName: string): boolean {
  return SECRET_NAME_PATTERN.test(rawName.split('.').at(-1) ?? rawName);
}

function looksLikeLiteralSecret(raw: string): boolean {
  const value = raw.trim().replace(/[,;)]$/, '');
  if (PLACEHOLDER_PATTERN.test(value) || ENV_REFERENCE_PATTERN.test(value)) return false;
  if (['none', 'null', 'undefined', 'true', 'false', '""', "''"].includes(value.toLowerCase())) return false;
  if (/^(?:await\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*\(/.test(value)) return false;
  if (/^[{[(]|\.\.\./.test(value)) return false;
  if (/^(?:new\s+|String\s*\(|Number\s*\(|Boolean\s*\()/.test(value)) return false;
  const quoted = /^[furbFURB]*(["'])(.*?)\1/.exec(value);
  let candidate: string;
  if (quoted) {
    candidate = String(quoted[2] ?? '').trim();
    if (candidate.startsWith('/') && !/\s|:\/\//.test(candidate)) return false;
  }
  else {
    if (/[().,[\]{}+*/?:|&<>]/.test(value)) return false;
    candidate = (value.split(/\s+/)[0] ?? '').replace(/^["'`{[]|["'`}[\]]$/g, '');
    if (/^[A-Za-z_][A-Za-z0-9_.()[\]-]*$/.test(candidate)) return false;
  }
  if (candidate.length < 10 || PLACEHOLDER_PATTERN.test(candidate)) return false;
  if (test(KNOWN_TOKEN_PATTERN, candidate) || entropy(candidate) >= 3.2) return true;
  return /[A-Za-z]/.test(candidate) && /\d/.test(candidate) && candidate.length >= 16;
}

function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let result = 0;
  for (const count of counts.values()) {
    const frequency = count / value.length;
    result -= frequency * Math.log2(frequency);
  }
  return result;
}

async function normalizeAdditionalFindings(value: JsonValue | undefined, staging: string): Promise<JsonObject[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PublisherError('additional_findings must be an array.', 'invalid_dispositions');
  const output: JsonObject[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) throw new PublisherError('Every additional finding must be an object.', 'invalid_dispositions');
    const decision = String(raw.decision ?? '').trim();
    const category = String(raw.category ?? 'semantic_risk').trim().slice(0, 80);
    const filePath = String(raw.path ?? '').trim();
    const line = Number(raw.line ?? 0);
    const message = String(raw.message ?? '').trim().slice(0, 500);
    const rationale = cleanRationale(raw.rationale);
    if (!['allow', 'block', 'not_applicable'].includes(decision)) throw new PublisherError('Additional finding decisions must be allow, block, or not_applicable.', 'invalid_dispositions');
    if (!safeStagedFile(staging, filePath)) throw new PublisherError('Additional findings must reference a staged relative file.', 'invalid_dispositions');
    if (!Number.isInteger(line) || line < 0) throw new PublisherError('Additional finding line must be a non-negative integer.', 'invalid_dispositions');
    if (message.length < 5 || rationale.length < 10) throw new PublisherError('Additional findings need a message and rationale.', 'invalid_dispositions');
    assertNoSecretValue(message);
    assertNoSecretValue(rationale);
    const id = createHash('sha256').update(`additional\0${index}\0${category}\0${filePath}\0${line}\0${message}`).digest('hex').slice(0, 20);
    output.push({ id: `deep_${id}`, category, path: filePath, line, message, decision, rationale });
  }
  return output;
}

async function applyRequirementUpdates(directory: string, value: JsonValue | undefined, staging: string): Promise<JsonObject[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PublisherError('requirement_updates must be an array.', 'invalid_dispositions');
  const requirements = requireRecord(await readJson(path.join(directory, 'requirements.json')), 'invalid_requirements');
  const existing = new Map<string, JsonObject>();
  for (const bucket of ['secrets', 'env']) {
    const rows = requirements[bucket];
    if (Array.isArray(rows)) for (const item of rows.filter(isRecord)) if (typeof item.name === 'string') existing.set(item.name, item);
  }
  const normalized: JsonObject[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) throw new PublisherError('Every requirement update must be an object.', 'invalid_dispositions');
    if ('value' in raw || 'default' in raw) throw new PublisherError('Requirement updates cannot contain values or defaults.', 'secret_in_dispositions');
    const name = String(raw.name ?? '').trim();
    const kind = String(raw.kind ?? '').trim();
    const required = raw.required;
    const purpose = cleanRationale(raw.purpose);
    if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(name) || seen.has(name)) throw new PublisherError('Requirement names must be unique uppercase environment names.', 'invalid_dispositions');
    if (!['secret', 'env'].includes(kind) || typeof required !== 'boolean' || purpose.length < 8) throw new PublisherError('Requirement updates need kind, required, and a meaningful purpose.', 'invalid_dispositions');
    let sources = normalizeRequirementSources(raw.sources, staging);
    if (!sources.length) {
      const prior = existing.get(name);
      sources = prior && Array.isArray(prior.sources) ? prior.sources.filter(isRecord) : [];
    }
    if (!sources.length) throw new PublisherError('A new semantic requirement needs relative source evidence.', 'invalid_dispositions');
    assertNoSecretValue(purpose);
    const item: JsonObject = { name, kind, required, purpose, sources };
    existing.set(name, item);
    normalized.push(item);
    seen.add(name);
  }
  requirements.secrets = [...existing.values()].filter((item) => item.kind === 'secret').sort(byName);
  requirements.env = [...existing.values()].filter((item) => item.kind === 'env').sort(byName);
  await atomicWriteJson(path.join(directory, 'requirements.json'), requirements);
  return normalized;
}

function normalizeRequirementSources(value: JsonValue | undefined, staging: string): JsonObject[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PublisherError('Requirement sources must be an array.', 'invalid_dispositions');
  const output: JsonObject[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) throw new PublisherError('Requirement source evidence must be an object.', 'invalid_dispositions');
    const filePath = String(raw.path ?? '').trim();
    const line = Number(raw.line ?? 0);
    if (!safeStagedFile(staging, filePath)) throw new PublisherError('Requirement evidence must reference a staged relative file.', 'invalid_dispositions');
    if (!Number.isInteger(line) || line < 0) throw new PublisherError('Requirement source line must be a non-negative integer.', 'invalid_dispositions');
    if (!output.some((item) => item.path === filePath && item.line === line)) output.push({ path: filePath, line });
  }
  return output;
}

function platformRequirements(value: JsonValue | undefined, allowDefault: boolean): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => {
    const normalized: JsonObject = {
      name: String(item.name ?? '').trim(),
      purpose: String(item.purpose ?? '').trim(),
      required: Boolean(item.required),
    };
    if (allowDefault && typeof item.default === 'string' && item.default.trim()) normalized.default = item.default.trim();
    return normalized;
  });
}

function platformFinding(source: JsonObject, disposition: string, severity: string, rationale?: JsonValue): JsonObject {
  let message = String(source.message ?? 'Security review finding.').trim();
  const rationaleText = String(rationale ?? '').trim();
  if (rationaleText) message = `${message} Review: ${rationaleText}`;
  const result: JsonObject = {
    ruleId: String(source.category ?? source.id ?? 'security-review').slice(0, 120),
    severity,
    disposition,
    message: message.slice(0, 500),
  };
  const filePath = String(source.path ?? '').trim();
  if (filePath) result.path = filePath.slice(0, 1024);
  if (Number.isInteger(source.line) && Number(source.line) >= 1) result.line = Number(source.line);
  return result;
}

function assertNoSecretValue(text: string): void {
  if ([PRIVATE_KEY_PATTERN, KNOWN_TOKEN_PATTERN, BEARER_PATTERN, DATABASE_URL_PATTERN].some((pattern) => test(pattern, text))) {
    throw new PublisherError('Dispositions must not contain credential values.', 'secret_in_dispositions');
  }
}

function cleanRationale(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 1_000) : '';
}

async function readTextFile(file: string, size: number): Promise<string | undefined> {
  if (size > MAX_TEXT_SCAN_BYTES) return undefined;
  try {
    const data = await fsp.readFile(file);
    if (data.subarray(0, 8192).includes(0)) return undefined;
    const text = data.toString('utf8');
    if (Buffer.from(text, 'utf8').compare(data) !== 0) return undefined;
    return text;
  } catch {
    return undefined;
  }
}

function isEnvTemplate(name: string): boolean {
  return /^\.env(?:[._-](?:example|sample|template))$/i.test(name);
}

function safeStagedFile(staging: string, relative: string): boolean {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) return false;
  return fs.existsSync(path.join(staging, relative)) && fs.statSync(path.join(staging, relative)).isFile();
}

function requireRecord(value: JsonValue, code: string): JsonObject {
  if (!isRecord(value)) throw new PublisherError('Expected a JSON object.', code);
  return value;
}

function firstMatch(pattern: RegExp, text: string): RegExpExecArray | null {
  pattern.lastIndex = 0;
  return pattern.exec(text);
}

function test(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function replace(pattern: RegExp, text: string, replacement: string): string {
  pattern.lastIndex = 0;
  return text.replace(pattern, replacement);
}

function byName(left: JsonObject, right: JsonObject): number {
  return String(left.name ?? '').localeCompare(String(right.name ?? ''));
}
