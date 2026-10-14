import { homedir } from 'node:os';
import path from 'node:path';

export const PREVIEW_WORKER = 'https://taku-workers-studio-preview.takuos.workers.dev';
export const PREVIEW_SITE = 'https://codex-stax-page-taku-landing-page.takuos.workers.dev';
export const PREVIEW_PLUGIN = 'taku-publisher-studio-preview';
export const PREVIEW_SITES_SKILL = 'taku-sites-studio-preview';

// Applied to the generated test package only, including its direct Creator CLI.
export function configureStudioPreview(args, env, home = homedir()) {
  const endpoints = { 'worker-url': PREVIEW_WORKER, 'site-url': PREVIEW_SITE, 'auth-site-url': PREVIEW_SITE };
  for (let index = 0; index < args.length; index++) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(args[index]);
    if (!match) continue;
    if (['bearer-token', 'token-env', 'session-path', 'session-file'].includes(match[1])) {
      throw new Error('Use browser login in the studio-preview plugin; external credentials are refused.');
    }
    if (Object.hasOwn(endpoints, match[1])) {
      const value = match[2] ?? args[++index];
      if (value !== endpoints[match[1]]) throw new Error('The studio-preview plugin cannot select another environment.');
    }
  }
  const root = path.join(home, '.taku', 'studio-preview');
  for (const key of ['TAKU_BEARER_TOKEN', 'TAKU_PUBLISH_TOKEN', 'SUPABASE_ACCESS_TOKEN', 'TAKU_DESKTOP_AUTH_USER_ID']) delete env[key];
  Object.assign(env, {
    TAKU_WORKER_URL: PREVIEW_WORKER, NEXT_PUBLIC_WORKER_URL: PREVIEW_WORKER,
    VITE_WORKER_URL: PREVIEW_WORKER, NEXT_PUBLIC_TAKU_WORKER_URL: PREVIEW_WORKER,
    TAKU_SITE_URL: PREVIEW_SITE, TAKU_WEB_URL: PREVIEW_SITE, NEXT_PUBLIC_SITE_URL: PREVIEW_SITE,
    TAKU_AUTH_SITE_URL: PREVIEW_SITE, TAKU_ALLOW_CUSTOM_WORKER_URL: '1',
    TAKU_PUBLISHER_HOME: path.join(root, 'publisher'),
    TAKU_PUBLISHER_SESSION_PATH: path.join(root, 'publisher', 'session.json'),
    TAKU_HOME: path.join(root, 'desktop-disabled'),
    TAKU_SESSION_PATH: path.join(root, 'desktop-disabled', 'session.json'),
  });
  return env;
}

export function replaceExactly(source, expected, replacement) {
  if (source.split(expected).length !== 2) throw new Error('Test-package source changed; rebuild review is required.');
  return source.replace(expected, replacement);
}
