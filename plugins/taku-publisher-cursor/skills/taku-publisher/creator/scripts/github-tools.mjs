import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseGitHubRepoFromRemote } from './project-metadata.mjs';
import {
  MAX_DESCRIPTION_CHARS,
  cleanText,
  isRecord,
  publicHttpUrl,
} from './privacy.mjs';

const execFileAsync = promisify(execFile);

export function normalizeImportedGithubTool(input) {
  if (!isRecord(input)) return null;
  const github = isRecord(input.github) ? input.github : {};
  const owner = cleanText(github.owner, 80);
  const repo = cleanText(github.repo, 120);
  const id = cleanText(input.id, 240) || (owner && repo ? `github:${owner}/${repo}` : undefined);
  if (!id || !id.startsWith('github:')) return null;
  const repoUrl = publicHttpUrl(github.url || input.externalUrl || input.githubUrl || input.url)
    || (owner && repo ? `https://github.com/${owner}/${repo}` : undefined);
  const rawKind = String(input.kind || input.type || '').toLowerCase();
  const type = rawKind === 'app'
    ? 'app'
    : rawKind === 'action' || rawKind === 'workflow' || rawKind === 'command'
      ? 'action'
      : rawKind === 'tool' || rawKind === 'plugin' || rawKind === 'mcp' || rawKind === 'reference'
        ? 'tool'
        : 'skill';
  const displayOnly = type === 'app' && Boolean(input.displayOnly);
  const name = cleanText(input.name || input.title, 160) || repo || 'GitHub tool';
  const description = cleanText(
    input.description || input.shortDescription || input.customDescription,
    MAX_DESCRIPTION_CHARS
  ) || (owner && repo ? `Imported from GitHub repository ${owner}/${repo}.` : 'Imported from GitHub.');
  const githubPath = cleanText(github.path, 160) || 'repository';
  return {
    id,
    name,
    description,
    type,
    kind: type,
    source: 'github',
    availability: 'reference-only',
    publishable: false,
    externalUrl: repoUrl,
    githubUrl: repoUrl,
    icon: cleanText(input.icon, 16),
    meta: cleanText(input.meta, 180) || `GitHub · ${githubPath}`,
    runnable: false,
    displayOnly: true,
    detectedFrom: githubPath,
    github: {
      ...(owner ? { owner } : {}),
      ...(repo ? { repo } : {}),
      branch: cleanText(github.branch, 120),
      path: githubPath,
      ...(repoUrl ? { url: repoUrl } : {}),
      rawUrl: publicHttpUrl(github.rawUrl),
      homepage: publicHttpUrl(github.homepage),
      language: cleanText(github.language, 80),
      topics: Array.isArray(github.topics)
        ? github.topics.map((topic) => cleanText(topic, 80)).filter(Boolean).slice(0, 20)
        : [],
    },
  };
}

let githubAuthTokenCache;
let githubAuthTokenResolved = false;

async function readOptionalGitHubAuthToken() {
  const envToken = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (envToken) return envToken;
  if (githubAuthTokenResolved) return githubAuthTokenCache || '';
  githubAuthTokenResolved = true;
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
      timeout: 2000,
      maxBuffer: 20_000,
    });
    githubAuthTokenCache = String(stdout || '').trim();
  } catch {
    githubAuthTokenCache = '';
  }
  return githubAuthTokenCache || '';
}

export function parseImportedGithubRepo(input) {
  if (isRecord(input)) {
    const owner = cleanText(input.owner, 80);
    const repo = cleanText(input.repo, 120).replace(/\.git$/i, '');
    const url = publicHttpUrl(input.url || input.githubUrl || input.externalUrl)
      || (owner && repo ? `https://github.com/${owner}/${repo}` : undefined);
    if (owner && repo) return { owner, repo, url };
  }
  const raw = String(input || '').trim();
  if (!raw) return undefined;
  const parsed = parseGitHubRepoFromRemote(raw);
  if (parsed?.owner && parsed?.repo) {
    return {
      ...parsed,
      url: `https://github.com/${parsed.owner}/${parsed.repo}`,
    };
  }
  const shorthand = raw.match(/^([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/);
  if (!shorthand) return undefined;
  return {
    owner: shorthand[1],
    repo: shorthand[2].replace(/\.git$/i, ''),
    url: `https://github.com/${shorthand[1]}/${shorthand[2].replace(/\.git$/i, '')}`,
  };
}

function githubFetchHeaders(accept, token) {
  return {
    Accept: accept,
    'User-Agent': 'taku-creator-skill',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function compactGithubDescription(value) {
  const text = cleanText(String(value || '').replace(/\s+/g, ' '), 220);
  return text.length > 170 ? `${text.slice(0, 167).trim()}...` : text;
}

function titleizeGithubRepoName(value) {
  return cleanText(value, 120).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'GitHub Repository';
}

function firstMeaningfulMarkdownLine(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !line.startsWith('---') && !/^\s*[-*]\s*$/.test(line)) || '';
}

function frontmatterFieldFromMarkdown(text, key) {
  const match = String(text || '').match(/^---\s*([\s\S]*?)\s*---/);
  if (!match) return '';
  const line = match[1].split(/\r?\n/).find((item) => item.trim().toLowerCase().startsWith(`${key.toLowerCase()}:`));
  return line ? line.split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, '') : '';
}

function markdownTitleFromText(text) {
  const title = String(text || '').split(/\r?\n/).map((line) => line.trim()).find((line) => /^#\s+/.test(line));
  return title ? title.replace(/^#\s+/, '').trim() : '';
}

async function readServerGithubRepoMeta(repo) {
  const token = await readOptionalGitHubAuthToken();
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`, {
      headers: githubFetchHeaders('application/vnd.github+json', token),
    });
    if (response.ok) {
      const payload = await response.json();
      return {
        exists: true,
        unavailable: false,
        authenticated: Boolean(token),
        status: response.status,
        warning: '',
        defaultBranch: cleanText(payload?.default_branch, 120) || 'main',
        description: cleanText(payload?.description, 500),
        homepage: publicHttpUrl(payload?.homepage) || '',
        htmlUrl: publicHttpUrl(payload?.html_url) || repo.url,
        language: cleanText(payload?.language, 80),
        topics: Array.isArray(payload?.topics) ? payload.topics.map((topic) => cleanText(topic, 80)).filter(Boolean).slice(0, 20) : [],
      };
    }
    if (response.status === 404) {
      return {
        exists: false,
        unavailable: false,
        authenticated: Boolean(token),
        status: response.status,
        warning: '',
        defaultBranch: 'main',
        description: '',
        homepage: '',
        htmlUrl: repo.url,
        language: '',
        topics: [],
      };
    }
    let warning = `GitHub API request failed (${response.status}).`;
    try {
      const payload = await response.json();
      if (payload?.message) warning = cleanText(payload.message, 300);
    } catch {}
    return {
      exists: null,
      unavailable: true,
      authenticated: Boolean(token),
      status: response.status,
      warning,
      defaultBranch: 'main',
      description: '',
      homepage: '',
      htmlUrl: repo.url,
      language: '',
      topics: [],
    };
  } catch (error) {
    return {
      exists: null,
      unavailable: true,
      authenticated: Boolean(token),
      status: 0,
      warning: error instanceof Error ? error.message : String(error),
      defaultBranch: 'main',
      description: '',
      homepage: '',
      htmlUrl: repo.url,
      language: '',
      topics: [],
    };
  }
}

async function fetchServerGithubText(url, token) {
  try {
    const response = await fetch(url, {
      headers: githubFetchHeaders('text/plain, application/json;q=0.9, */*;q=0.8', token),
    });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

export async function readServerGithubTool(repo) {
  const repoMeta = await readServerGithubRepoMeta(repo);
  const defaultBranch = repoMeta.defaultBranch || 'main';
  const token = await readOptionalGitHubAuthToken();
  const branches = Array.from(new Set([defaultBranch, 'main', 'master'].filter(Boolean)));
  const paths = ['taku.stax.json', '.taku/taku.stax.json', 'SKILL.md', 'README.md', 'README.zh-CN.md'];
  const found = [];
  for (const branch of branches) {
    for (const filePath of paths) {
      const rawUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/${filePath}`;
      const text = await fetchServerGithubText(rawUrl, token);
      if (text) found.push({ branch, path: filePath, text, url: rawUrl });
    }
    if (found.length) break;
  }

  if (!found.length) {
    if (repoMeta.exists === false) {
      throw new Error('无法读取公开 GitHub 仓库，或仓库不存在。');
    }
      const fallbackName = titleizeGithubRepoName(repo.repo);
      const warning = repoMeta.unavailable
        ? repoMeta.authenticated
          ? 'GitHub API 暂不可用，已作为仓库导入；Taku 客户端会在安装时重新扫描。'
          : 'GitHub API 匿名限流，已作为仓库导入；Taku 客户端会在安装时重新扫描。设置 GITHUB_TOKEN 或登录 gh 可读取更多元数据。'
        : '';
      return {
      id: `github:${repo.owner}/${repo.repo}`,
      name: fallbackName,
      description: compactGithubDescription(
        repoMeta.description ||
        repoMeta.homepage ||
        `GitHub app/repository reference for ${repo.owner}/${repo.repo}.`
      ),
        meta: ['GitHub Repo', repoMeta.language, repoMeta.unavailable ? 'metadata pending' : 'client scan'].filter(Boolean).join(' · '),
        icon: titleizeGithubRepoName(repo.repo)[0] || 'G',
        source: 'github',
        availability: 'reference-only',
        publishable: false,
        kind: 'tool',
        runnable: false,
        displayOnly: true,
      github: {
        owner: repo.owner,
        repo: repo.repo,
        branch: defaultBranch,
        path: 'repository',
        url: repo.url,
        rawUrl: '',
        homepage: repoMeta.homepage,
        language: repoMeta.language,
        topics: repoMeta.topics,
        warning,
      },
    };
  }

  const manifestFile = found.find((file) => file.path.endsWith('.json'));
  const skillFile = found.find((file) => file.path.endsWith('SKILL.md'));
  const readmeFile = found.find((file) => /README/i.test(file.path));
  let manifest = {};
  if (manifestFile) {
    try { manifest = JSON.parse(manifestFile.text); } catch {}
  }
  const sourceFile = manifestFile || skillFile || readmeFile || found[0];
  const fallbackName = titleizeGithubRepoName(repo.repo);
  const name = compactGithubDescription(
    manifest.name ||
    manifest.title ||
    manifest.tool?.name ||
    frontmatterFieldFromMarkdown(skillFile?.text, 'name') ||
    markdownTitleFromText(skillFile?.text) ||
    markdownTitleFromText(readmeFile?.text) ||
    fallbackName
  );
  const description = compactGithubDescription(
    manifest.description ||
    manifest.summary ||
    manifest.tool?.description ||
    frontmatterFieldFromMarkdown(skillFile?.text, 'description') ||
    firstMeaningfulMarkdownLine(skillFile?.text) ||
    firstMeaningfulMarkdownLine(readmeFile?.text) ||
    `Imported from GitHub repository ${repo.owner}/${repo.repo}.`
  );
  const rawKind = String(
    manifest.kind ||
    manifest.type ||
    manifest.tool?.kind ||
    manifest.tool?.type ||
    (!manifestFile && !skillFile ? 'tool' : 'skill')
  ).toLowerCase();
  const kind = rawKind === 'app' ? 'app' : rawKind === 'reference' || rawKind === 'tool' ? 'tool' : 'skill';
  const displayOnly = kind === 'app';
  return {
    id: `github:${repo.owner}/${repo.repo}`,
    name,
    description,
    meta: `GitHub · ${sourceFile.path}`,
    icon: name[0] || 'G',
    source: 'github',
    availability: 'reference-only',
    publishable: false,
    kind,
    runnable: false,
    displayOnly: true,
    github: {
      owner: repo.owner,
      repo: repo.repo,
      branch: sourceFile.branch,
      path: sourceFile.path,
      url: repo.url,
      rawUrl: sourceFile.url,
      homepage: repoMeta.homepage,
      language: repoMeta.language,
      topics: repoMeta.topics,
      warning: repoMeta.unavailable ? 'GitHub API 暂不可用，已使用公开文件导入。' : '',
    },
  };
}
