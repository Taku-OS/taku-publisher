import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listRepositoryFiles, repositoryRoot } from './repository-files.mjs';

const FORBIDDEN_PATH_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)(?:node_modules|dist|out|coverage|__pycache__|\.pytest_cache)(\/|$)/,
  /\.(?:key|log|p12|pem|pfx|pyc|pyo|tar\.gz|zip)$/i,
  /(^|\/)(?:session|credentials?)(?:\.|\/|$)/i,
];

const TEXT_EXTENSIONS = new Set([
  '',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.py',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const PLACEHOLDER_PATTERN =
  /(?:change[-_ ]?me|example|fake|fixture|placeholder|replace[-_ ]?me|sample|test|xxx+|your[-_ ]?(?:api[-_ ]?)?(?:key|token|secret|password)|<[^>]+>|\$\{[A-Z][A-Z0-9_]+\})/i;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;
const KNOWN_TOKEN_PATTERN =
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{20,})\b/;
const DATABASE_URL_PATTERN =
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|mssql):\/\/[^\s:/@]+:[^\s/@]+@/i;
const CREDENTIAL_LITERAL_PATTERN =
  /\b([A-Za-z][A-Za-z0-9_.-]*(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|private[_-]?key|secret|session|token)[A-Za-z0-9_.-]*)\b\s*[:=]\s*["'`]([^"'`\n]{12,})["'`]/i;

const DETECTOR_SOURCE_FILES = new Set([
  'scripts/audit-repository.mjs',
  'scripts/taku_publisher/scanner.py',
]);

const ALLOWED_PUBLIC_LITERALS = [
  {
    path: 'creator/scripts/creator-profile.mjs',
    name: 'DEFAULT_TAKU_SUPABASE_ANON_KEY',
    reason: 'Supabase anon key is explicitly public client configuration.',
  },
  {
    path: 'packages/publisher-runtime/src/auth.ts',
    name: 'SUPABASE_PUBLIC_CLIENT_VALUE',
    reason: 'Supabase publishable value is explicitly public client configuration.',
  },
  {
    path: 'packages/repo-to-stax-converter/template/takuai-template/src/app/api/taku/rpc/route.test.ts',
    name: 'process.env.TAKU_CONTROL_TOKEN',
    reason: 'Pinned upstream template test fixture; the value is not a real credential.',
  },
];

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function allowedPublicLiteral(relativePath, name) {
  return ALLOWED_PUBLIC_LITERALS.some(
    (entry) => entry.path === relativePath && entry.name === name,
  );
}

function auditText(relativePath, text) {
  if (DETECTOR_SOURCE_FILES.has(relativePath)) return [];
  const findings = [];

  for (const [category, pattern] of [
    ['private_key', PRIVATE_KEY_PATTERN],
    ['known_token', KNOWN_TOKEN_PATTERN],
    ['credential_url', DATABASE_URL_PATTERN],
  ]) {
    const match = pattern.exec(text);
    if (match && !PLACEHOLDER_PATTERN.test(match[0])) {
      findings.push({
        path: relativePath,
        line: lineNumber(text, match.index),
        category,
      });
    }
  }

  for (const [index, line] of text.split('\n').entries()) {
    const match = CREDENTIAL_LITERAL_PATTERN.exec(line);
    if (!match) continue;
    const [, name, value] = match;
    if (
      allowedPublicLiteral(relativePath, name) ||
      PLACEHOLDER_PATTERN.test(value) ||
      /process\.env|os\.(?:environ|getenv)|\$\{[A-Z]/.test(value)
    ) {
      continue;
    }
    findings.push({
      path: relativePath,
      line: index + 1,
      category: 'credential_literal',
    });
  }

  return findings;
}

const files = await listRepositoryFiles();
const forbidden = files.filter((file) =>
  FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(file)),
);
const findings = [];

for (const relativePath of files) {
  if (!TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
  const absolutePath = path.join(repositoryRoot, relativePath);
  const bytes = await readFile(absolutePath);
  if (bytes.includes(0) || bytes.length > 2_000_000) continue;
  findings.push(...auditText(relativePath, bytes.toString('utf8')));
}

if (forbidden.length > 0 || findings.length > 0) {
  for (const file of forbidden) {
    console.error(`${file}: forbidden_repository_path`);
  }
  for (const finding of findings) {
    console.error(
      `${finding.path}:${finding.line}: ${finding.category}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      ok: true,
      filesReviewed: files.length,
      publicLiteralAllowlist: ALLOWED_PUBLIC_LITERALS.map(
        ({ path: file, name, reason }) => ({ file, name, reason }),
      ),
    }),
  );
}
