import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import {
  isDirectory,
  normalizeChoiceToken,
} from './cli.mjs';
import { createEmptyCreatorMetrics } from './creator-metrics.mjs';
import {
  createWorkspaceHash,
  normalizeWorkspaceKey,
  round,
} from './usage.mjs';

export const DEFAULT_MAX_PROJECT_REPOS = 40;

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_STACK_FILES_PER_REPO = 800;
const RECENT_COMMIT_BUCKET_SPANS = [7, 7, 7, 7, 7];
const SKIPPED_STACK_DIRS = new Set(['.cache', '.git', '.next', '.turbo', 'build', 'coverage', 'dist', 'node_modules', 'out']);
const SOURCE_CODE_EXTENSIONS = new Set([
  '.astro', '.c', '.cc', '.clj', '.cljs', '.cpp', '.cs', '.css', '.dart', '.ex', '.exs',
  '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx', '.kt', '.kts', '.less', '.lua',
  '.m', '.mm', '.php', '.py', '.rb', '.rs', '.sass', '.scss', '.sh', '.svelte', '.swift',
  '.ts', '.tsx', '.vue', '.zig',
]);

export async function scanProjectMetadata({ workspaceRoot, usage, ownedCreations = [], maxRepos = DEFAULT_MAX_PROJECT_REPOS, includeGitHubMetrics = false }) {
  const recentCommitWindow = createRecentCommitWindow(new Date());
  const candidates = collectCandidateProjectPaths({ workspaceRoot, usage, ownedCreations })
    .slice(0, Math.max(0, maxRepos));
  const reposByRoot = new Map();
  const warnings = [];

  for (const candidate of candidates) {
    const gitRoot = await resolveGitRoot(candidate.path);
    if (!gitRoot) continue;
    const key = path.resolve(gitRoot);
    const previous = reposByRoot.get(key);
    if (!previous) {
      reposByRoot.set(key, {
        path: key,
        sources: new Set([candidate.source]),
        ownershipHints: new Set(candidate.ownership ? [candidate.ownership] : []),
      });
      continue;
    }
    previous.sources.add(candidate.source);
    if (candidate.ownership) previous.ownershipHints.add(candidate.ownership);
  }

  const repos = [];
  for (const repo of Array.from(reposByRoot.values()).slice(0, Math.max(0, maxRepos))) {
    try {
      repos.push(await scanProjectRepo(repo.path, {
        sources: Array.from(repo.sources),
        ownershipHints: Array.from(repo.ownershipHints),
        usage,
        recentCommitWindow,
      }));
    } catch (error) {
      warnings.push(`Failed to scan repo metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return summarizeProjectMetadata(repos, {
    candidateCount: candidates.length,
    warnings,
    includeGitHubMetrics,
    recentCommitWindow,
  });
}

function collectCandidateProjectPaths({ workspaceRoot, usage, ownedCreations = [] }) {
  const candidates = [];
  const add = (candidatePath, source, ownership) => {
    const normalized = normalizeWorkspaceKey(candidatePath);
    if (!normalized) return;
    candidates.push({ path: normalized, source, ownership });
  };

  add(workspaceRoot, 'current-workspace', 'likely-owned');
  for (const workspaceKey of usage?.__privateWorkspaceKeys || []) {
    add(workspaceKey, 'session-workspace', 'session-active');
  }
  for (const creation of ownedCreations) {
    if (!creation?.localPath) continue;
    add(creation.localPath, 'built-candidate', creation.ownership || 'candidate');
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = path.resolve(candidate.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolveGitRoot(candidatePath) {
  if (!candidatePath || !(await isDirectory(candidatePath))) return undefined;
  const result = await execGit(candidatePath, ['rev-parse', '--show-toplevel']);
  if (!result.ok) return undefined;
  const root = result.stdout.trim();
  return root && await isDirectory(root) ? root : undefined;
}

function createRecentCommitWindow(now) {
  const end = new Date(now);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  start.setDate(start.getDate() - 29);
  let cursor = new Date(start);
  const buckets = RECENT_COMMIT_BUCKET_SPANS.map((span, index) => {
    const bucketStart = new Date(cursor);
    const bucketEndExclusive = index === RECENT_COMMIT_BUCKET_SPANS.length - 1
      ? new Date(end.getTime() + 1)
      : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + span);
    const bucketEndInclusive = new Date(bucketEndExclusive.getTime() - 1);
    cursor = new Date(bucketEndExclusive);
    return {
      id: `d${index + 1}`,
      label: formatCommitBucketLabel(bucketStart, bucketEndInclusive),
      shortLabel: formatCommitBucketShortLabel(bucketStart, bucketEndInclusive),
      startsAt: bucketStart.toISOString(),
      endsAt: bucketEndInclusive.toISOString(),
      startMs: bucketStart.getTime(),
      endExclusiveMs: bucketEndExclusive.getTime(),
      count: 0,
    };
  });
  return {
    id: 'last30Days',
    label: 'Last 30 Days',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    buckets,
  };
}

function formatCommitBucketLabel(start, end) {
  return `${formatCommitBucketMonthDay(start)}-${formatCommitBucketMonthDay(end)}`;
}

function formatCommitBucketShortLabel(start) {
  return `${start.getMonth() + 1}/${start.getDate()}`;
}

function formatCommitBucketMonthDay(date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function publicCommitBucket(bucket, count = 0) {
  return {
    id: bucket.id,
    label: bucket.label,
    shortLabel: bucket.shortLabel || bucket.label,
    startsAt: bucket.startsAt,
    endsAt: bucket.endsAt,
    count: Math.max(0, Math.floor(Number(count) || 0)),
  };
}

async function scanRecentCommitBuckets(repoPath, recentCommitWindow = createRecentCommitWindow(new Date())) {
  const buckets = (recentCommitWindow.buckets || []).map((bucket) => ({
    ...bucket,
    count: 0,
  }));
  const result = await execGit(repoPath, [
    'log',
    '--format=%ct',
    `--since=${recentCommitWindow.startsAt}`,
    `--until=${recentCommitWindow.endsAt}`,
    'HEAD',
  ]);
  if (!result.ok) {
    return {
      total: 0,
      buckets: buckets.map((bucket) => publicCommitBucket(bucket, 0)),
    };
  }
  for (const line of result.stdout.split(/\r?\n/)) {
    const seconds = Number(line.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    const timeMs = seconds * 1000;
    const bucket = buckets.find((item) => timeMs >= item.startMs && timeMs < item.endExclusiveMs);
    if (bucket) bucket.count += 1;
  }
  return {
    total: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    buckets: buckets.map((bucket) => publicCommitBucket(bucket, bucket.count)),
  };
}

async function scanProjectRepo(repoPath, options = {}) {
  const period = options.usage || {};
  const since = period.startsAt ? `--since=${period.startsAt}` : undefined;
  const until = period.endsAt ? `--until=${period.endsAt}` : undefined;
  const [commitResult, codeChurn, recentCommitResult, branchResult, statusResult, remoteResult] = await Promise.all([
    execGit(repoPath, ['rev-list', '--count', 'HEAD', ...(since ? [since] : [])]),
    scanCodeChurn(repoPath, { since, until }),
    scanRecentCommitBuckets(repoPath, options.recentCommitWindow),
    execGit(repoPath, ['branch', '--list', '--format=%(refname:short)']),
    execGit(repoPath, ['status', '--porcelain=v1', '--untracked-files=normal']),
    execGit(repoPath, ['remote', 'get-url', 'origin']),
  ]);
  const dirtyFiles = parseGitStatusFiles(statusResult.ok ? statusResult.stdout : '');
  const remoteUrl = remoteResult.ok ? remoteResult.stdout.trim() : '';
  const stack = await scanStackSummary(repoPath);
  const dirtyAges = await summarizeDirtyFileAges(repoPath, dirtyFiles);
  return {
    repoHash: createWorkspaceHash(repoPath),
    sources: options.sources || [],
    ownership: classifyRepoOwnership(options.ownershipHints || [], {
      dirtyFileCount: dirtyFiles.length,
      commitCount: readInteger(commitResult.stdout),
      sources: options.sources || [],
    }),
    git: {
      isRepo: true,
      commitCount: commitResult.ok ? readInteger(commitResult.stdout) : 0,
      recentCommitCount: recentCommitResult.total,
      commitCount30d: recentCommitResult.total,
      linesAdded: codeChurn.linesAdded,
      linesDeleted: codeChurn.linesDeleted,
      netLinesChanged: codeChurn.netLinesChanged,
      filesChanged: codeChurn.filesChanged,
      sourceLinesAdded: codeChurn.sourceLinesAdded,
      sourceLinesDeleted: codeChurn.sourceLinesDeleted,
      sourceNetLinesChanged: codeChurn.sourceNetLinesChanged,
      sourceFilesChanged: codeChurn.sourceFilesChanged,
      recentCommitBuckets: recentCommitResult.buckets,
      commitBuckets30d: recentCommitResult.buckets,
      branchCount: branchResult.ok ? branchResult.stdout.split(/\r?\n/).filter(Boolean).length : 0,
      dirtyFileCount: dirtyFiles.length,
      changedFileExts: summarizeExtensions(dirtyFiles).slice(0, 12),
      remoteHost: remoteUrl ? parseRemoteHost(remoteUrl) : undefined,
      remoteRepo: parseGitHubRepoFromRemote(remoteUrl),
      uncommittedDays: dirtyAges.uncommittedDays,
    },
    stack,
  };
}

async function scanCodeChurn(repoPath, options = {}) {
  const args = [
    'log',
    '--numstat',
    '--pretty=format:',
    ...(options.since ? [options.since] : []),
    ...(options.until ? [options.until] : []),
    'HEAD',
  ];
  const result = await execGit(repoPath, args);
  const files = new Set();
  const sourceFiles = new Set();
  const totals = {
    linesAdded: 0,
    linesDeleted: 0,
    sourceLinesAdded: 0,
    sourceLinesDeleted: 0,
  };
  if (!result.ok) {
    return {
      ...totals,
      netLinesChanged: 0,
      filesChanged: 0,
      sourceNetLinesChanged: 0,
      sourceFilesChanged: 0,
    };
  }
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
    if (!match) continue;
    const [, addedRaw, deletedRaw, fileRaw] = match;
    if (addedRaw === '-' || deletedRaw === '-') continue;
    const filePath = normalizeNumstatPath(fileRaw);
    if (!filePath || shouldSkipCodeChurnPath(filePath)) continue;
    const added = Math.max(0, Math.floor(Number(addedRaw) || 0));
    const deleted = Math.max(0, Math.floor(Number(deletedRaw) || 0));
    files.add(filePath);
    totals.linesAdded += added;
    totals.linesDeleted += deleted;
    if (isSourceCodePath(filePath)) {
      sourceFiles.add(filePath);
      totals.sourceLinesAdded += added;
      totals.sourceLinesDeleted += deleted;
    }
  }
  return {
    ...totals,
    netLinesChanged: totals.linesAdded - totals.linesDeleted,
    filesChanged: files.size,
    sourceNetLinesChanged: totals.sourceLinesAdded - totals.sourceLinesDeleted,
    sourceFilesChanged: sourceFiles.size,
  };
}

function normalizeNumstatPath(value) {
  const text = unquoteGitPath(String(value || '').trim());
  if (!text) return '';
  const renamed = text.match(/^\{(.+?) => (.+?)\}(.*)$/);
  if (renamed) return `${renamed[2]}${renamed[3]}`;
  return text.includes(' => ') ? text.split(' => ').pop() : text;
}

function shouldSkipCodeChurnPath(filePath) {
  const parts = String(filePath || '').split(/[\\/]+/).filter(Boolean);
  return parts.some((part) => SKIPPED_STACK_DIRS.has(part));
}

function isSourceCodePath(filePath) {
  return SOURCE_CODE_EXTENSIONS.has(path.extname(String(filePath || '').toLowerCase()));
}

async function execGit(cwd, args) {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', cwd, ...args], {
      timeout: 4000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout || ''),
      stderr: String(error?.stderr || error?.message || ''),
    };
  }
}

function parseGitStatusFiles(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const raw = line.slice(3).trim();
      const renamed = raw.includes(' -> ') ? raw.split(' -> ').pop() : raw;
      return unquoteGitPath(renamed);
    })
    .filter(Boolean)
    .slice(0, 500);
}

function unquoteGitPath(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  return text;
}

async function summarizeDirtyFileAges(repoPath, dirtyFiles) {
  let oldestMs;
  const now = Date.now();
  for (const filePath of dirtyFiles.slice(0, 200)) {
    try {
      const stat = await fs.stat(path.join(repoPath, filePath));
      oldestMs = oldestMs === undefined ? stat.mtimeMs : Math.min(oldestMs, stat.mtimeMs);
    } catch {
      // Deleted files or paths outside the worktree do not contribute to age.
    }
  }
  return {
    uncommittedDays: oldestMs ? round(Math.max(0, now - oldestMs) / 86400000, 1) : 0,
  };
}

async function scanStackSummary(repoPath) {
  const files = [];
  async function walk(dir, depth) {
    if (depth > 5 || files.length >= DEFAULT_MAX_STACK_FILES_PER_REPO) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= DEFAULT_MAX_STACK_FILES_PER_REPO) return;
      if (entry.isDirectory()) {
        if (SKIPPED_STACK_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name), depth + 1);
        continue;
      }
      if (entry.isFile()) files.push(path.relative(repoPath, path.join(dir, entry.name)));
    }
  }
  await walk(repoPath, 0);

  const extCounts = {};
  for (const file of files) {
    const ext = normalizedExtension(file);
    if (!ext) continue;
    extCounts[ext] = (extCounts[ext] || 0) + 1;
  }
  const totalCodeFiles = Object.values(extCounts).reduce((sum, value) => sum + value, 0);
  const languageCounts = Object.fromEntries(
    Object.entries(extCounts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 18)
  );
  const uiFileCount = countMatchingFiles(files, isUiFile);
  const infraFileCount = countMatchingFiles(files, isInfraFile);
  const docFileCount = countMatchingFiles(files, isDocFile);
  return {
    scannedFileCount: files.length,
    languageCounts,
    languageCount: Object.keys(languageCounts).length,
    topLanguageShare: totalCodeFiles > 0 ? round(Math.max(0, ...Object.values(extCounts)) / totalCodeFiles, 3) : 0,
    packageManagers: detectPackageManagers(files),
    uiFileCount,
    infraFileCount,
    docFileCount,
    uiFileRatio: files.length > 0 ? round(uiFileCount / files.length, 3) : 0,
    infraFileRatio: files.length > 0 ? round(infraFileCount / files.length, 3) : 0,
    docFileRatio: files.length > 0 ? round(docFileCount / files.length, 3) : 0,
  };
}

function normalizedExtension(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  const ext = path.extname(basename).replace(/^\./, '').toLowerCase();
  if (!ext || ['lock', 'log', 'map', 'local', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'mp4', 'mov', 'webm', 'ttf', 'otf', 'woff', 'woff2', 'blockmap', 'complete', 'db', 'sqlite', 'sqlite3', 'p12', 'p8', 'pem', 'cer', 'crt', 'key', 'certsigningrequest', 'jsonl'].includes(ext)) return '';
  return ext;
}

function isUiFile(filePath) {
  const text = filePath.toLowerCase();
  return /\.(tsx|jsx|css|scss|sass|vue|svelte)$/.test(text) || /(^|\/)(components|ui|styles|pages|views)\//.test(text);
}

function isInfraFile(filePath) {
  const text = filePath.toLowerCase();
  return /(^|\/)(scripts|workflows|actions|mcp|server|api|infra|deploy|docker)\//.test(text) || /\.(sh|yml|yaml|toml|dockerfile)$/.test(text) || /(^|\/)(dockerfile|makefile|package\.json)$/.test(text);
}

function isDocFile(filePath) {
  const text = filePath.toLowerCase();
  return /\.(md|mdx|rst|txt)$/.test(text) ||
    /(^|\/)(docs?|documentation|references?|guides?|manuals?|examples?)\//.test(text) ||
    /(^|\/)(readme|changelog|contributing|license|adr|architecture)\./.test(text);
}

function countMatchingFiles(files, predicate) {
  return files.reduce((count, file) => count + (predicate(file) ? 1 : 0), 0);
}

function detectPackageManagers(files) {
  const names = new Set(files.map((file) => path.basename(file).toLowerCase()));
  return [
    names.has('pnpm-lock.yaml') ? 'pnpm' : '',
    names.has('package-lock.json') ? 'npm' : '',
    names.has('yarn.lock') ? 'yarn' : '',
    names.has('bun.lockb') || names.has('bun.lock') ? 'bun' : '',
    names.has('uv.lock') ? 'uv' : '',
    names.has('poetry.lock') ? 'poetry' : '',
    names.has('cargo.lock') ? 'cargo' : '',
    names.has('go.mod') ? 'go' : '',
  ].filter(Boolean);
}

function summarizeExtensions(files) {
  const counts = {};
  for (const file of files) {
    const ext = normalizedExtension(file);
    if (!ext) continue;
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([ext]) => ext);
}

function parseRemoteHost(value) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const sshMatch = text.match(/^[^@]+@([^:]+):/);
  if (sshMatch) return sshMatch[1].toLowerCase();
  try {
    return new URL(text).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function parseGitHubRepoFromRemote(value) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const sshMatch = text.match(/^[^@]+@github\.com:([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2].replace(/\.git$/i, '') };
  try {
    const url = new URL(text);
    if (url.hostname.toLowerCase() !== 'github.com') return undefined;
    const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length < 2) return undefined;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
  } catch {
    const shorthand = text.match(/^github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i);
    if (!shorthand) return undefined;
    return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/i, '') };
  }
}

function classifyRepoOwnership(hints, facts) {
  if (hints.includes('likely-owned')) return { label: 'likely-owned', confidence: 0.75, reasons: ['Current workspace or explicit candidate'] };
  if (hints.includes('owned')) return { label: 'owned', confidence: 0.9, reasons: ['Explicit owned hint'] };
  if ((facts.sources || []).includes('session-workspace') && (facts.commitCount > 0 || facts.dirtyFileCount > 0)) {
    return { label: 'candidate', confidence: 0.45, reasons: ['Seen in local sessions with repo activity'] };
  }
  return { label: 'reference', confidence: 0.25, reasons: ['No strong ownership signal'] };
}

async function summarizeProjectMetadata(repos, options = {}) {
  const recentCommitWindow = options.recentCommitWindow || createRecentCommitWindow(new Date());
  const recentCommitBuckets = (recentCommitWindow.buckets || []).map((bucket) => publicCommitBucket(bucket, 0));
  const recentCommitBucketMap = new Map(recentCommitBuckets.map((bucket) => [bucket.id, bucket]));
  const gitTotals = {
    repoCount: repos.length,
    commitCount: 0,
    recentCommitCount: 0,
    commitCount30d: 0,
    branchCount: 0,
    dirtyRepoCount: 0,
    dirtyFileCount: 0,
    linesAdded: 0,
    linesDeleted: 0,
    netLinesChanged: 0,
    filesChanged: 0,
    sourceLinesAdded: 0,
    sourceLinesDeleted: 0,
    sourceNetLinesChanged: 0,
    sourceFilesChanged: 0,
    maxUncommittedDays: 0,
    changedFileExts: [],
    remoteHosts: [],
  };
  const aiSessionGitTotals = {
    aiSessionRepoCount: 0,
    aiSessionCommitCount: 0,
    aiSessionCommitCount30d: 0,
    aiSessionFilesChanged: 0,
    aiSessionLinesAdded: 0,
    aiSessionLinesDeleted: 0,
    aiSessionSourceFilesChanged: 0,
    aiSessionSourceLinesAdded: 0,
    aiSessionSourceLinesDeleted: 0,
  };
  const stackCounts = {};
  const packageManagers = new Set();
  let scannedFileCount = 0;
  let uiFileCount = 0;
  let infraFileCount = 0;
  let docFileCount = 0;
  let uiWeighted = 0;
  let infraWeighted = 0;
  let docWeighted = 0;

  for (const repo of repos) {
    gitTotals.commitCount += repo.git.commitCount || 0;
    gitTotals.recentCommitCount += repo.git.recentCommitCount || repo.git.commitCount30d || 0;
    gitTotals.commitCount30d += repo.git.commitCount30d || repo.git.recentCommitCount || 0;
    gitTotals.branchCount += repo.git.branchCount || 0;
    gitTotals.dirtyFileCount += repo.git.dirtyFileCount || 0;
    gitTotals.linesAdded += repo.git.linesAdded || 0;
    gitTotals.linesDeleted += repo.git.linesDeleted || 0;
    gitTotals.netLinesChanged += repo.git.netLinesChanged || 0;
    gitTotals.filesChanged += repo.git.filesChanged || 0;
    gitTotals.sourceLinesAdded += repo.git.sourceLinesAdded || 0;
    gitTotals.sourceLinesDeleted += repo.git.sourceLinesDeleted || 0;
    gitTotals.sourceNetLinesChanged += repo.git.sourceNetLinesChanged || 0;
    gitTotals.sourceFilesChanged += repo.git.sourceFilesChanged || 0;
    if ((repo.git.dirtyFileCount || 0) > 0) gitTotals.dirtyRepoCount += 1;
    gitTotals.maxUncommittedDays = Math.max(gitTotals.maxUncommittedDays, repo.git.uncommittedDays || 0);
    for (const ext of repo.git.changedFileExts || []) {
      if (!gitTotals.changedFileExts.includes(ext)) gitTotals.changedFileExts.push(ext);
    }
    if (repo.git.remoteHost && !gitTotals.remoteHosts.includes(repo.git.remoteHost)) gitTotals.remoteHosts.push(repo.git.remoteHost);
    for (const bucket of repo.git.commitBuckets30d || repo.git.recentCommitBuckets || []) {
      const target = recentCommitBucketMap.get(bucket.id);
      if (target) target.count += Math.max(0, Math.floor(Number(bucket.count) || 0));
    }
    if ((repo.sources || []).includes('session-workspace')) {
      aiSessionGitTotals.aiSessionRepoCount += 1;
      aiSessionGitTotals.aiSessionCommitCount += repo.git.commitCount || 0;
      aiSessionGitTotals.aiSessionCommitCount30d += repo.git.commitCount30d || repo.git.recentCommitCount || 0;
      aiSessionGitTotals.aiSessionFilesChanged += repo.git.filesChanged || 0;
      aiSessionGitTotals.aiSessionLinesAdded += repo.git.linesAdded || 0;
      aiSessionGitTotals.aiSessionLinesDeleted += repo.git.linesDeleted || 0;
      aiSessionGitTotals.aiSessionSourceFilesChanged += repo.git.sourceFilesChanged || 0;
      aiSessionGitTotals.aiSessionSourceLinesAdded += repo.git.sourceLinesAdded || 0;
      aiSessionGitTotals.aiSessionSourceLinesDeleted += repo.git.sourceLinesDeleted || 0;
    }

    const stack = repo.stack || {};
    const repoFileCount = stack.scannedFileCount || 0;
    scannedFileCount += repoFileCount;
    uiFileCount += stack.uiFileCount || Math.round((stack.uiFileRatio || 0) * repoFileCount);
    infraFileCount += stack.infraFileCount || Math.round((stack.infraFileRatio || 0) * repoFileCount);
    docFileCount += stack.docFileCount || Math.round((stack.docFileRatio || 0) * repoFileCount);
    uiWeighted += (stack.uiFileRatio || 0) * repoFileCount;
    infraWeighted += (stack.infraFileRatio || 0) * repoFileCount;
    docWeighted += (stack.docFileRatio || 0) * repoFileCount;
    for (const manager of stack.packageManagers || []) packageManagers.add(manager);
    for (const [language, count] of Object.entries(stack.languageCounts || {})) {
      stackCounts[language] = (stackCounts[language] || 0) + count;
    }
  }

  const githubMetrics = options.includeGitHubMetrics
    ? await fetchPublicGitHubRepoMetrics(repos.map((repo) => repo.git?.remoteRepo).filter(Boolean))
    : createEmptyCreatorMetrics({ source: 'github-metrics-disabled' }).github;
  const languageEntries = Object.entries(stackCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const totalLanguageFiles = languageEntries.reduce((sum, [, count]) => sum + count, 0);
  const topLanguageShare = totalLanguageFiles > 0 ? round((languageEntries[0]?.[1] || 0) / totalLanguageFiles, 3) : 0;

  return {
    projects: {
      candidatePathCount: options.candidateCount || 0,
      scannedRepoCount: repos.length,
      ownershipCounts: countBy(repos, (repo) => repo.ownership?.label || 'unknown'),
      repoHashes: repos.slice(0, 20).map((repo) => repo.repoHash),
      warnings: options.warnings || [],
    },
    git: {
      ...gitTotals,
      ...aiSessionGitTotals,
      recentCommitWindow: {
        id: recentCommitWindow.id,
        label: recentCommitWindow.label,
        startsAt: recentCommitWindow.startsAt,
        endsAt: recentCommitWindow.endsAt,
      },
      recentCommitBuckets,
      commitBuckets30d: recentCommitBuckets,
      changedFileExts: gitTotals.changedFileExts.slice(0, 18),
      remoteHosts: gitTotals.remoteHosts.slice(0, 8),
      maxUncommittedDays: round(gitTotals.maxUncommittedDays, 1),
    },
    stack: {
      scannedFileCount,
      languageCounts: Object.fromEntries(languageEntries.slice(0, 18)),
      languageCount: languageEntries.length,
      topLanguageShare,
      packageManagers: Array.from(packageManagers).sort(),
      uiFileCount,
      infraFileCount,
      docFileCount,
      uiFileRatio: scannedFileCount > 0 ? round(uiWeighted / scannedFileCount, 3) : 0,
      infraFileRatio: scannedFileCount > 0 ? round(infraWeighted / scannedFileCount, 3) : 0,
      docFileRatio: scannedFileCount > 0 ? round(docWeighted / scannedFileCount, 3) : 0,
    },
    github: githubMetrics,
  };
}

async function fetchPublicGitHubRepoMetrics(repos) {
  const unique = [];
  const seen = new Set();
  for (const repo of repos || []) {
    if (!repo?.owner || !repo?.repo) continue;
    const key = `${repo.owner}/${repo.repo}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(repo);
  }
  const metrics = {
    repoCount: unique.length,
    publicRepoCount: 0,
    privateRepoCount: 0,
    totalStars: 0,
    maxRepoStars: 0,
    fetchedRepoCount: 0,
    warnings: [],
  };
  for (const repo of unique.slice(0, 20)) {
    try {
      const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) {
        metrics.warnings.push(`GitHub repo metrics unavailable for one repo (${response.status}).`);
        continue;
      }
      const payload = await response.json();
      const stars = Math.max(0, Math.floor(Number(payload?.stargazers_count) || 0));
      metrics.fetchedRepoCount += 1;
      metrics.publicRepoCount += payload?.private ? 0 : 1;
      metrics.privateRepoCount += payload?.private ? 1 : 0;
      metrics.totalStars += stars;
      metrics.maxRepoStars = Math.max(metrics.maxRepoStars, stars);
    } catch (error) {
      metrics.warnings.push(`GitHub repo metrics failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  metrics.warnings = metrics.warnings.slice(0, 6);
  return metrics;
}

function readInteger(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function countBy(items, getKey) {
  const counts = {};
  for (const item of items || []) {
    const key = getKey(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function uniqueStrings(items) {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

export function summarizeBuiltItemTypes(items) {
  return summarizeItemTypes(items);
}

export function summarizeItemTypes(items) {
  const counts = { maker: 0, infra: 0, hybrid: 0, unknown: 0 };
  const examples = { maker: [], infra: [], hybrid: [], unknown: [] };
  for (const item of items) {
    const classification = classifyBuiltItem(item);
    counts[classification.kind] += 1;
    if (examples[classification.kind].length < 6) {
      examples[classification.kind].push({
        name: item.name,
        type: item.type,
        reason: classification.reason,
      });
    }
  }
  const classifiedCount = counts.maker + counts.infra + counts.hybrid;
  return {
    ...counts,
    classifiedCount,
    makerShare: classifiedCount > 0 ? round((counts.maker + counts.hybrid * 0.5) / classifiedCount, 3) : 0,
    infraShare: classifiedCount > 0 ? round((counts.infra + counts.hybrid * 0.5) / classifiedCount, 3) : 0,
    examples,
  };
}

function classifyBuiltItem(item) {
  const type = normalizeChoiceToken(item?.type);
  const text = [
    item?.type,
    item?.name,
    item?.description,
    item?.detectedFrom,
  ].filter(Boolean).join(' ').toLowerCase();

  const makerTypes = new Set(['app', 'website', 'webapp', 'ui', 'component', 'assetlibrary', 'asset', 'template', 'theme', 'content', 'document', 'presentation', 'spreadsheet']);
  const infraTypes = new Set(['mcp', 'mcpserver', 'workflow', 'agent', 'automation', 'cli', 'command', 'connector', 'plugin', 'server', 'daemon']);
  if (makerTypes.has(type)) return { kind: 'maker', reason: `${item.type || 'item'} is user-facing` };
  if (infraTypes.has(type)) return { kind: 'infra', reason: `${item.type || 'item'} is infrastructure/tooling` };

  const makerKeywords = ['react', 'vite', 'next', 'electron', 'ui', 'frontend', 'component', 'image', 'design', 'theme', 'template', 'canvas', 'viewer', 'dashboard', 'site', 'app'];
  const infraKeywords = ['mcp', 'agent', 'workflow', 'automation', 'cli', 'daemon', 'server', 'api', 'connector', 'toolchain', 'pipeline', 'deploy', 'script'];
  const makerScore = makerKeywords.filter((keyword) => text.includes(keyword)).length;
  const infraScore = infraKeywords.filter((keyword) => text.includes(keyword)).length;
  if (makerScore > infraScore) return { kind: 'maker', reason: `matched maker keywords (${makerScore})` };
  if (infraScore > makerScore) return { kind: 'infra', reason: `matched infra keywords (${infraScore})` };
  if (makerScore > 0 && infraScore > 0) return { kind: 'hybrid', reason: 'matched maker and infra keywords' };
  if (type === 'skill' || type === 'tool') return { kind: 'hybrid', reason: `${item.type || 'item'} can be user-facing or infra` };
  return { kind: 'unknown', reason: 'not enough metadata to classify' };
}

export function summarizeInstalledToolUsage(usedTools, rawToolUsage) {
  const installed = usedTools.map((item) => ({
    name: item.name,
    keys: toolMatchKeys(item),
  }));
  let usedInstalledToolCount = 0;
  for (const item of installed) {
    const matched = (rawToolUsage.topTools || []).some((tool) => {
      const toolKey = normalizeToolMatchKey(tool.name);
      return item.keys.some((key) => key && (toolKey.includes(key) || key.includes(toolKey)));
    });
    if (matched) usedInstalledToolCount += 1;
  }
  return { usedInstalledToolCount };
}

function toolMatchKeys(item) {
  return [
    item?.name,
    item?.type,
    item?.detectedFrom,
  ].map(normalizeToolMatchKey).filter((value) => value && value.length >= 3);
}

function normalizeToolMatchKey(value) {
  return normalizeChoiceToken(value)
    .replace(/^mcp/, '')
    .replace(/^tool/, '')
    .replace(/^skill/, '');
}
