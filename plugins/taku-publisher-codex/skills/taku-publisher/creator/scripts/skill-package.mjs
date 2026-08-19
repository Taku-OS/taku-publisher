import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MAX_DESCRIPTION_CHARS, cleanText, isRecord, publicText } from './privacy.mjs';
export { STAX_CREATOR_PUBLISH_CONTRACT_VERSION } from './publish-config.mjs';

const MAX_SKILL_PACKAGE_SOURCE_BYTES = 128 * 1024;
const MAX_SKILL_PACKAGE_FILE_BYTES = 1024 * 1024;
const MAX_SKILL_PACKAGE_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_SKILL_PACKAGE_FILES = 240;
const CREDENTIAL_PLACEHOLDER_PATTERN = /(?:paste[_-]?your|your(?:[_-][a-z0-9]+){0,3}[_-]?(?:token|key|secret|password)|placeholder|example|changeme|change[_-]?me|replace[_-]?me|xxx+|<[^>]+>)/i;
const EXCLUDED_DIR_NAMES = new Set([
  '.cache',
  '.git',
  '.github',
  '.next',
  '.turbo',
  '.venv',
  '.vscode',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'tmp',
  'temp',
  'venv',
]);
const EXCLUDED_SECRET_DIR_NAMES = new Set([
  '.aws',
  '.azure',
  '.gnupg',
  '.ssh',
]);
const EXCLUDED_FILE_NAMES = new Set([
  '.DS_Store',
  '.dockercfg',
  '.gitignore',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'taku-install.json',
]);
const TEXT_FILE_EXTENSIONS = new Set([
  '',
  '.bash',
  '.css',
  '.csv',
  '.html',
  '.j2',
  '.jinja',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.markdown',
  '.mjs',
  '.py',
  '.sh',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh',
]);
const BINARY_ASSET_EXTENSIONS = new Set([
  '.gif',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.webp',
]);
const ASSET_DIR_NAMES = new Set([
  'asset',
  'assets',
  'image',
  'images',
  'media',
  'preview',
  'previews',
  'reference-assets',
  'screenshot',
  'screenshots',
]);
const SECRET_FILE_EXTENSION_RE = /\.(?:crt|db|key|log|p12|pfx|pem|sqlite|sqlite3)$/i;
const SECRET_FILE_NAME_RE = /(?:^|[-_.])(api[-_]?key|credential|credentials|password|private[-_]?key|secret|session|token)(?:[-_.]|$)/i;
const ENV_FILE_RE = /^\.env(?:[._-].*)?$/i;

function privateInventoryItems(privateInventory) {
  return Array.isArray(privateInventory?.items) ? privateInventory.items : [];
}

function findPrivateInventoryItem(privateInventory, item) {
  const id = typeof item?.id === 'string' ? item.id : '';
  if (!id) return null;
  return privateInventoryItems(privateInventory).find((entry) => entry?.id === id) || null;
}

async function resolveSkillRoot(localPath) {
  if (typeof localPath !== 'string' || !localPath.trim()) return null;
  const resolved = path.resolve(localPath);
  try {
    const stat = await fs.stat(resolved);
    if (stat.isFile() && path.basename(resolved).toLowerCase() === 'skill.md') {
      return {
        root: path.dirname(resolved),
        skillFile: resolved,
      };
    }
    if (stat.isDirectory()) {
      const entries = await fs.readdir(resolved).catch(() => []);
      const skillName = entries.find((name) => name === 'SKILL.md') ||
        entries.find((name) => name.toLowerCase() === 'skill.md');
      if (!skillName) return null;
      const skillPath = path.join(resolved, skillName);
      const skillStat = await fs.stat(skillPath).catch(() => null);
      return skillStat?.isFile() ? {
        root: resolved,
        skillFile: skillPath,
      } : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function scanInlineSkillPackageSource(sourceText) {
  const patterns = [
    { label: 'local filesystem path', pattern: /(?:^|[\s"'`(])(?:\/Users|\/home|\/private|\/var\/folders|\/Volumes)\/[^\s"'`)]+/i },
    { label: 'Windows user path', pattern: /[A-Za-z]:\\(?:Users|Documents and Settings)\\/i },
    { label: 'file URL', pattern: /file:\/\/\//i },
    {
      label: 'private network URL',
      pattern: /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[^/\s"'`]+\.local\b|[^/\s"'`]+\.internal\b)/i,
    },
    { label: 'credential assignment', pattern: /\b(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key|secret|token|password|authorization|bearer|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']?[^\s"'`<>{}]{8,}/i },
    { label: 'known token format', pattern: /\b(?:sk|sk-proj|ghp|gho|ghu|ghs|github_pat|xoxb|xoxp|xoxa|glpat|npm)[:_-][A-Za-z0-9_-]{12,}\b/i },
    { label: 'bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}\b/i },
    { label: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { label: 'workspace hash', pattern: /\bworkspace[_-]?hash\b\s*[:=]\s*["']?[A-Fa-f0-9]{12,}/i },
  ];
  const findings = [];
  const lines = String(sourceText || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const { label, pattern } of patterns) {
      if (pattern.test(line) && !shouldIgnoreInlineSkillFinding(label, line)) {
        findings.push({ label, line: index + 1 });
        break;
      }
    }
    if (findings.length >= 8) break;
  }
  return findings;
}

function shouldIgnoreInlineSkillFinding(label, line) {
  const text = String(line || '');
  if (label === 'private network URL') {
    return /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:[/?#\s"'`)]|$)/i.test(text);
  }
  if (label === 'bearer token') {
    const value = text.match(/\bBearer\s+([A-Za-z0-9._~+/-]{12,})\b/i)?.[1] || '';
    return CREDENTIAL_PLACEHOLDER_PATTERN.test(value);
  }
  if (label === 'known token format') {
    const value = text.match(/\b(?:sk|sk-proj|ghp|gho|ghu|ghs|github_pat|xoxb|xoxp|xoxa|glpat|npm)[:_-][A-Za-z0-9_-]{12,}\b/i)?.[0] || '';
    return CREDENTIAL_PLACEHOLDER_PATTERN.test(value);
  }
  if (label !== 'credential assignment') return false;
  const value = text.match(
    /\b(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key|secret|token|password|authorization|bearer|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']?([^\s"'`<>{},)]+)/i
  )?.[1] || '';
  return (
    CREDENTIAL_PLACEHOLDER_PATTERN.test(value) ||
    /\b(?:os\.environ|process\.env|getenv|import\.meta\.env)\b/i.test(text) ||
    /^[A-Z][A-Z0-9_]{2,}$/.test(value) ||
    /[`'"]?\s*f?["']?[^"'`]*\{[^}]+\}/.test(value)
  );
}

export function assertInlineSkillPackageIsPublic(sourceText, title, filePath = 'SKILL.md') {
  const findings = scanInlineSkillPackageSource(sourceText);
  if (findings.length === 0) return;
  const summary = findings
    .map((finding) => `${finding.label} at line ${finding.line}`)
    .join('; ');
  throw new Error(
    `Refusing to publish inline skill package "${title || 'selected skill'}": ${filePath} may contain private data (${summary}). Remove the private data before publishing.`
  );
}

export async function createInlineSkillPackage(item, privateInventory) {
  if (!isRecord(item) || cleanText(item.type || item.kind, 80) !== 'skill') return undefined;
  const privateItem = findPrivateInventoryItem(privateInventory, item);
  const skillRoot = await resolveSkillRoot(privateItem?.localPath);
  if (!skillRoot) return undefined;
  const title = publicText(item.title || item.name || item.customTitle, 160) || 'Imported skill';
  const collectedFiles = await collectSkillPackageFiles(skillRoot.root, title);
  if (!collectedFiles.some((file) => file.name.toLowerCase() === 'skill.md')) return undefined;
  const packageFiles = collectedFiles.map((file) =>
    file.name.toLowerCase() === 'skill.md' ? { ...file, name: 'SKILL.md' } : file
  );
  const description = publicText(
    item.description || item.shortDescription || item.customDescription || item.detectedFrom,
    MAX_DESCRIPTION_CHARS
  );
  const manifest = Buffer.from(JSON.stringify({
    name: title,
    type: 'skill',
    version: '1.0.0',
    ...(description ? { description } : {}),
    install: { target: 'skills' },
    platforms: ['taku'],
    permissions: [],
  }, null, 2));
  assertInlineSkillPackageIsPublic(manifest.toString('utf8'), `${title} manifest`);
  const archive = createZipArchive([
    ...packageFiles,
    { name: 'taku.stax.json', data: manifest },
  ]);
  const hash = createHash('sha256').update(archive).digest('hex');
  return {
    kind: 'skill',
    format: 'zip',
    data: archive.toString('base64'),
    hash,
    size: archive.byteLength,
    files: [...packageFiles.map((file) => file.name), 'taku.stax.json'],
  };
}

async function collectSkillPackageFiles(root, title) {
  const files = [];
  let totalBytes = 0;

  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = normalizeZipPath(path.relative(root, fullPath));
      if (!relativePath || isUnsafePackagePath(relativePath)) continue;
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !shouldPackageSkillFile(relativePath)) continue;
      if (files.length >= MAX_SKILL_PACKAGE_FILES) {
        throw new Error(`Refusing to publish inline skill package "${title}": too many package files.`);
      }
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat?.isFile() || stat.size <= 0) continue;
      const perFileLimit = relativePath === 'SKILL.md'
        ? MAX_SKILL_PACKAGE_SOURCE_BYTES
        : MAX_SKILL_PACKAGE_FILE_BYTES;
      if (stat.size > perFileLimit) {
        throw new Error(`Refusing to publish inline skill package "${title}": ${relativePath} is too large.`);
      }
      if (totalBytes + stat.size > MAX_SKILL_PACKAGE_TOTAL_BYTES) {
        throw new Error(`Refusing to publish inline skill package "${title}": package is too large.`);
      }
      const data = await fs.readFile(fullPath);
      if (isTextPackageFile(relativePath)) {
        assertInlineSkillPackageIsPublic(data.toString('utf8'), title, relativePath);
      }
      files.push({ name: relativePath, data });
      totalBytes += stat.size;
    }
  }

  await visit(root);
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

function normalizeZipPath(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\/+/, '');
}

function isUnsafePackagePath(relativePath) {
  const segments = relativePath.split('/').filter(Boolean);
  return segments.some((segment) => {
    const lower = segment.toLowerCase();
    return EXCLUDED_DIR_NAMES.has(lower) || EXCLUDED_SECRET_DIR_NAMES.has(lower);
  });
}

function shouldPackageSkillFile(relativePath) {
  const basename = path.posix.basename(relativePath);
  const lowerBasename = basename.toLowerCase();
  if (EXCLUDED_FILE_NAMES.has(basename) || EXCLUDED_FILE_NAMES.has(lowerBasename)) return false;
  if (lowerBasename === 'taku.stax.json') return false;
  if (ENV_FILE_RE.test(basename)) return false;
  if (SECRET_FILE_EXTENSION_RE.test(basename)) return false;
  if (SECRET_FILE_NAME_RE.test(basename)) return false;
  if (isTextPackageFile(relativePath)) return true;
  return isBinaryAssetPackageFile(relativePath);
}

function isTextPackageFile(relativePath) {
  const basename = path.posix.basename(relativePath);
  if (basename === 'SKILL.md' || /^readme(?:[._-].*)?$/i.test(basename) || /^license(?:[._-].*)?$/i.test(basename)) {
    return true;
  }
  return TEXT_FILE_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

function isBinaryAssetPackageFile(relativePath) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (!BINARY_ASSET_EXTENSIONS.has(extension)) return false;
  const segments = relativePath.split('/').slice(0, -1).map((segment) => segment.toLowerCase());
  return segments.some((segment) => ASSET_DIR_NAMES.has(segment));
}

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function createZipArchive(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const fileName = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const checksum = crc32(data);
    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(checksum),
      writeUInt32(data.byteLength),
      writeUInt32(data.byteLength),
      writeUInt16(fileName.byteLength),
      writeUInt16(0),
      fileName,
    ]);
    localParts.push(localHeader, data);
    centralParts.push(Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(checksum),
      writeUInt32(data.byteLength),
      writeUInt32(data.byteLength),
      writeUInt16(fileName.byteLength),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      fileName,
    ]));
    offset += localHeader.byteLength + data.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(files.length),
    writeUInt16(files.length),
    writeUInt32(centralDirectory.byteLength),
    writeUInt32(offset),
    writeUInt16(0),
  ]);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
