import * as os from 'node:os';
import * as path from 'node:path';

export const SCHEMA_VERSION = 'taku.publisher.v1';
export const PUBLISHER_USER_AGENT = 'Taku-Publisher/1.0 (+https://taku.ai)';
export const SUPPORTED_TYPES = ['skill'] as const;
export const UNAVAILABLE_PUBLISH_TYPES = ['action', 'agent', 'plugin'] as const;
export const SUPPORTED_MODES = ['create', 'update'] as const;
export const SUPPORTED_RUNTIME_PLATFORMS = ['taku', 'codex', 'claude-code'] as const;
export const DEFAULT_WORKER_URL = 'https://worker.taku.ai';
export const MAX_APP_STORE_PACKAGE_BYTES = 20 * 1024 * 1024;

export const MAX_FILES = 1_000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT_SCAN_BYTES = MAX_FILE_BYTES;
export const MAX_DISCOVERY_DEPTH = 6;

export const EXCLUDED_DIR_NAMES = new Set([
  '.aws', '.azure', '.cache', '.git', '.gnupg', '.idea', '.next', '.nuxt',
  '.parcel-cache', '.pytest_cache', '.ssh', '.svelte-kit', '.terraform',
  '.turbo', '.venv', '.vscode', '__pycache__', 'build', 'coverage', 'dist',
  'logs', 'node_modules', 'out', 'target', 'temp', 'tmp', 'venv',
]);

export const SECRET_DIR_NAMES = new Set([
  '.aws', '.azure', '.credentials', '.gnupg', '.oauth', '.sessions', '.ssh',
]);

export const EXCLUDED_FILE_NAMES = new Set([
  '.dockercfg', '.ds_store', '.git', '.netrc', '.npmrc', '.pypirc', 'credentials.json',
  'id_rsa', 'id_ed25519', 'secrets.json',
]);

export const SECRET_FILE_SUFFIXES = new Set([
  '.db', '.key', '.p12', '.pfx', '.pem', '.sqlite', '.sqlite3',
]);

export const TEXT_FILE_SUFFIXES = new Set([
  '', '.bash', '.c', '.cfg', '.conf', '.cpp', '.css', '.csv', '.go', '.h',
  '.html', '.ini', '.java', '.js', '.json', '.jsx', '.kt', '.md',
  '.markdown', '.mjs', '.php', '.properties', '.py', '.rb', '.rs', '.sh',
  '.sql', '.svg', '.swift', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml',
  '.yml', '.zsh',
]);

export function publisherHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = String(env.TAKU_PUBLISHER_HOME ?? '').trim();
  return path.resolve(override || path.join(os.homedir(), '.taku', 'publisher'));
}
