import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GITHUB_IDENTITY_TIMEOUT_MS = 4000;

export async function detectGitHubIdentity(options = {}) {
  const run = options.execFile || execFileAsync;
  try {
    const { stdout } = await run('gh', ['api', 'user', '--jq', '.login'], {
      timeout: options.timeoutMs || GITHUB_IDENTITY_TIMEOUT_MS,
      maxBuffer: 16 * 1024,
      env: {
        ...(options.env || process.env),
        GH_PROMPT_DISABLED: '1',
      },
    });
    const username = normalizeGitHubUsername(stdout);
    if (!username) return null;
    return {
      platform: 'github',
      username,
      profileUrl: `https://github.com/${username}`,
      source: 'github-cli',
      verified: true,
      requiresConfirmation: true,
    };
  } catch {
    return null;
  }
}

export function normalizeGitHubUsername(value) {
  const username = String(value || '').trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(username)) return '';
  if (username.endsWith('-') || username.includes('--')) return '';
  return username;
}

export function withGitHubSocialCandidate(value, identity) {
  if (!identity?.username) return value;
  const current = value && typeof value === 'object' ? value : {};
  const candidates = current.socialCandidates && typeof current.socialCandidates === 'object'
    ? current.socialCandidates
    : {};
  if (candidates.github?.username) return current;
  return {
    ...current,
    socialCandidates: {
      ...candidates,
      github: identity,
    },
  };
}
