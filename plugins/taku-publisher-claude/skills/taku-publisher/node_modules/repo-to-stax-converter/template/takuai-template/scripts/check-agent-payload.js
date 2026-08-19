const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const EXPECTED_TAKU_SKILLS = [
  'taku-action-contract',
  'taku-subapp-development',
  'taku-subapp-verification',
  'using-superpowers',
];
const SUPERPOWERS_VERSION = '6.2.0';
const SUPERPOWERS_CONTAINER_ENTRIES = [SUPERPOWERS_VERSION, 'manifest.json'].sort();
const BUNDLE_HASH_HEADER = Buffer.from('TAKU_SUPERPOWERS_BUNDLE\0v3\0');
const MAX_PORTABLE_CASE_FOLD_STEPS = 4;
const WINDOWS_FORBIDDEN_PATH_CHARACTERS = /[<>:"/\\|?*]/u;
const UNICODE_CONTROL_CHARACTER = /\p{Cc}/u;
const WINDOWS_RESERVED_BASENAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;
const EXPECTED_SUPERPOWERS_MANIFEST = Object.freeze({
  name: 'superpowers',
  version: SUPERPOWERS_VERSION,
  source: 'openai-curated-remote/superpowers',
  license: 'MIT',
  bundleSha256: 'sha256:bd4810288fa17c0f697f638a5041b55a370b9e76b16d61adc56f59f869c72fe9',
  bundlePath: '.agent-tools/superpowers/6.2.0',
  entrySkill: 'skills/using-superpowers/SKILL.md',
});
const FORBIDDEN_PATTERNS = [
  {
    label: 'Linear workflow',
    pattern: /\bLinear\s+(?:issue|project|workflow|team|record|status|comment|rules?)\b/i,
  },
  { label: 'internal completion approver', pattern: /\b(?:haipro|Jacky)\b/i },
  { label: 'internal issue identifier', pattern: /\bTAKU-\d+\b/i },
  { label: 'internal Linear skill', pattern: /taku-linear-coding/i },
];

function listDirectories(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function listFilesRecursively(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(root, entry.name);
    return entry.isDirectory() ? listFilesRecursively(absolutePath) : [absolutePath];
  });
}

function encodeUint64(value) {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(BigInt(value));
  return encoded;
}

function encodeUint32(value) {
  const encoded = Buffer.alloc(4);
  encoded.writeUInt32BE(value);
  return encoded;
}

// Bundle paths use raw directory-entry bytes so invalid UTF-8 cannot be replaced
// silently by U+FFFD. Valid names must be NFC, POSIX segments that are also safe
// on Windows. Collision keys iterate ECMAScript's locale-independent Unicode
// upper/lower conversion to a fixed point after NFC normalization. Repeating the
// fold handles multi-step expansions such as `ẞ` -> `ß` -> `ss`; a small fixed
// bound and cycle detection keep unexpected Unicode behavior fail closed.
function portableUnicodeCaseFold(value) {
  let current = value.normalize('NFC');
  const seen = new Set([current]);
  for (let step = 0; step < MAX_PORTABLE_CASE_FOLD_STEPS; step += 1) {
    const next = current.toUpperCase().toLowerCase().normalize('NFC');
    if (next === current) return current;
    if (seen.has(next)) {
      throw new Error('vendored Superpowers Unicode case fold entered a cycle');
    }
    seen.add(next);
    current = next;
  }
  throw new Error(
    `vendored Superpowers Unicode case fold did not converge within ${MAX_PORTABLE_CASE_FOLD_STEPS} steps`
  );
}

function validateBundleDirectoryNames(rawNames, relativeDirectory) {
  const seenCollisionKeys = new Map();
  return rawNames.map(rawName => {
    if (!Buffer.isBuffer(rawName)) {
      throw new Error('vendored Superpowers bundle path must be provided as raw bytes');
    }
    const name = rawName.toString('utf8');
    if (!Buffer.from(name, 'utf8').equals(rawName)) {
      throw new Error(
        `vendored Superpowers bundle path must be valid UTF-8 in ${relativeDirectory}`
      );
    }
    if (name !== name.normalize('NFC')) {
      throw new Error(
        `vendored Superpowers bundle path must be NFC normalized in ${relativeDirectory}: ${name}`
      );
    }
    if (name === '.' || name === '..') {
      throw new Error(`vendored Superpowers contains non-portable bundle path: ${name}`);
    }
    if (UNICODE_CONTROL_CHARACTER.test(name)) {
      throw new Error(
        `vendored Superpowers contains non-portable bundle path with a control character in ${relativeDirectory}`
      );
    }
    if (WINDOWS_FORBIDDEN_PATH_CHARACTERS.test(name)) {
      throw new Error(
        `vendored Superpowers bundle path contains a Windows-forbidden character: ${name}`
      );
    }
    if (/[. ]$/u.test(name)) {
      throw new Error(`vendored Superpowers bundle path has a trailing dot or space: ${name}`);
    }
    const windowsBasename = name.split('.')[0].replace(/[. ]+$/u, '');
    if (WINDOWS_RESERVED_BASENAME.test(windowsBasename)) {
      throw new Error(`vendored Superpowers bundle path uses a reserved Windows basename: ${name}`);
    }

    const collisionKey = portableUnicodeCaseFold(name);
    const collidingName = seenCollisionKeys.get(collisionKey);
    if (collidingName !== undefined) {
      throw new Error(
        `vendored Superpowers Unicode canonical collision in ${relativeDirectory}: ${collidingName}, ${name}`
      );
    }
    seenCollisionKeys.set(collisionKey, name);
    return { rawName, name };
  });
}

function joinRawPath(directory, rawName) {
  return Buffer.concat([directory, Buffer.from(path.sep), rawName]);
}

function collectBundleEntries(root) {
  if (!fs.existsSync(root)) throw new Error(`vendored Superpowers bundle is missing: ${root}`);
  const rootMetadata = fs.lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error(`vendored Superpowers bundle root must be a directory: ${root}`);
  }

  const entries = [];
  const visit = (directory, relativeDirectory = '') => {
    const children = fs.readdirSync(directory, { withFileTypes: true, encoding: 'buffer' });
    if (children.length === 0) {
      throw new Error(
        `vendored Superpowers empty directory is not allowed: ${relativeDirectory || '.'}`
      );
    }

    const validatedNames = validateBundleDirectoryNames(
      children.map(child => child.name),
      relativeDirectory || '.'
    );
    for (const [index, child] of children.entries()) {
      const { rawName, name } = validatedNames[index];
      const absolutePath = joinRawPath(directory, rawName);
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${name}`
        : name;
      const pathBytes = Buffer.from(relativePath, 'utf8');
      const metadata = fs.lstatSync(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`vendored Superpowers bundle contains a symbolic link: ${relativePath}`);
      }
      if (metadata.isDirectory()) {
        entries.push({ type: 0x44, mode: 0o040000, pathBytes, content: Buffer.alloc(0) });
        visit(absolutePath, relativePath);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error(`vendored Superpowers bundle contains unsupported entry: ${relativePath}`);
      }
      const mode = (metadata.mode & 0o111) !== 0 ? 0o100755 : 0o100644;
      entries.push({ type: 0x46, mode, pathBytes, content: fs.readFileSync(absolutePath) });
    }
  };
  visit(Buffer.isBuffer(root) ? root : Buffer.from(root));
  return entries.sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes));
}

function computeBundleSha256(root) {
  const hash = crypto.createHash('sha256');
  hash.update(BUNDLE_HASH_HEADER);
  for (const entry of collectBundleEntries(root)) {
    hash.update(Buffer.from([entry.type]));
    hash.update(encodeUint32(entry.mode));
    hash.update(encodeUint64(entry.pathBytes.length));
    hash.update(entry.pathBytes);
    hash.update(encodeUint64(entry.content.length));
    hash.update(entry.content);
  }
  return `sha256:${hash.digest('hex')}`;
}

function assertSkillPackage(skillRoot, expectedName) {
  const skillFile = path.join(skillRoot, 'SKILL.md');
  if (!fs.existsSync(skillFile)) throw new Error(`missing skill package: ${skillFile}`);
  const content = fs.readFileSync(skillFile, 'utf8');
  if (!content.startsWith('---\n')) throw new Error(`missing YAML frontmatter: ${skillFile}`);
  if (!new RegExp(`^name:\\s*${expectedName}$`, 'm').test(content)) {
    throw new Error(`skill name does not match directory ${expectedName}: ${skillFile}`);
  }
  if (!/^description:\s*\S.+$/m.test(content)) {
    throw new Error(`skill description is required: ${skillFile}`);
  }
  return content;
}

function checkAgentPayload(rootDir = path.resolve(__dirname, '..')) {
  const payloadRoot = path.join(rootDir, '.taku-template', 'payload');
  const agentsSkillsRoot = path.join(payloadRoot, '.agents', 'skills');
  const claudeSkillsRoot = path.join(payloadRoot, '.claude', 'skills');
  const takuSkills = listDirectories(agentsSkillsRoot);

  if (JSON.stringify(takuSkills) !== JSON.stringify(EXPECTED_TAKU_SKILLS)) {
    throw new Error(
      `generated-app Taku skills must be ${EXPECTED_TAKU_SKILLS.join(', ')}; found ${takuSkills.join(', ')}`
    );
  }
  if (JSON.stringify(listDirectories(claudeSkillsRoot)) !== JSON.stringify(takuSkills)) {
    throw new Error('Codex and Claude generated-app skill directories differ');
  }

  for (const skill of takuSkills) {
    const agentsContent = assertSkillPackage(path.join(agentsSkillsRoot, skill), skill);
    const claudeContent = assertSkillPackage(path.join(claudeSkillsRoot, skill), skill);
    if (agentsContent !== claudeContent) throw new Error(`Codex and Claude skill drift: ${skill}`);
  }

  const superpowersContainerRoot = path.join(payloadRoot, '.agent-tools', 'superpowers');
  if (!fs.existsSync(superpowersContainerRoot)) {
    throw new Error(`missing pinned Superpowers directory: ${superpowersContainerRoot}`);
  }
  const superpowersContainerMetadata = fs.lstatSync(superpowersContainerRoot);
  if (superpowersContainerMetadata.isSymbolicLink() || !superpowersContainerMetadata.isDirectory()) {
    throw new Error(`pinned Superpowers path must be a directory: ${superpowersContainerRoot}`);
  }
  const superpowersContainerEntries = fs.readdirSync(superpowersContainerRoot).sort();
  if (
    JSON.stringify(superpowersContainerEntries) !==
    JSON.stringify(SUPERPOWERS_CONTAINER_ENTRIES)
  ) {
    throw new Error(
      `Superpowers directory entries must be exactly ${SUPERPOWERS_CONTAINER_ENTRIES.join(', ')}; found ${superpowersContainerEntries.join(', ')}`
    );
  }

  const superpowersRoot = path.join(superpowersContainerRoot, SUPERPOWERS_VERSION);
  const superpowersRootMetadata = fs.lstatSync(superpowersRoot);
  if (superpowersRootMetadata.isSymbolicLink() || !superpowersRootMetadata.isDirectory()) {
    throw new Error(`pinned Superpowers bundle must be a directory: ${superpowersRoot}`);
  }
  const superpowersManifestFile = path.join(superpowersContainerRoot, 'manifest.json');
  const superpowersManifestMetadata = fs.lstatSync(superpowersManifestFile);
  if (superpowersManifestMetadata.isSymbolicLink() || !superpowersManifestMetadata.isFile()) {
    throw new Error(`pinned Superpowers manifest must be a regular file: ${superpowersManifestFile}`);
  }
  const superpowersManifest = JSON.parse(fs.readFileSync(superpowersManifestFile, 'utf8'));
  const expectedManifestFields = Object.keys(EXPECTED_SUPERPOWERS_MANIFEST).sort();
  const actualManifestFields = Object.keys(superpowersManifest).sort();
  if (!isDeepStrictEqual(actualManifestFields, expectedManifestFields)) {
    throw new Error(
      `Superpowers manifest fields must be exactly ${expectedManifestFields.join(', ')}; found ${actualManifestFields.join(', ')}`
    );
  }
  for (const [field, expectedValue] of Object.entries(EXPECTED_SUPERPOWERS_MANIFEST)) {
    if (field === 'bundleSha256') continue;
    if (superpowersManifest[field] !== expectedValue) {
      throw new Error(
        `Superpowers manifest ${field} must be ${expectedValue}; found ${superpowersManifest[field] ?? 'missing'}`
      );
    }
  }
  const superpowersBundleSha256 = computeBundleSha256(superpowersRoot);
  if (superpowersBundleSha256 !== EXPECTED_SUPERPOWERS_MANIFEST.bundleSha256) {
    throw new Error(
      `trusted Superpowers ${SUPERPOWERS_VERSION} bundle checksum mismatch: expected ${EXPECTED_SUPERPOWERS_MANIFEST.bundleSha256}, actual ${superpowersBundleSha256}`
    );
  }
  if (superpowersManifest.bundleSha256 !== EXPECTED_SUPERPOWERS_MANIFEST.bundleSha256) {
    throw new Error(
      `Superpowers manifest bundleSha256 must be ${EXPECTED_SUPERPOWERS_MANIFEST.bundleSha256}; found ${superpowersManifest.bundleSha256 ?? 'missing'}`
    );
  }
  if (!isDeepStrictEqual(superpowersManifest, EXPECTED_SUPERPOWERS_MANIFEST)) {
    throw new Error('Superpowers manifest must exactly match the audited provenance contract');
  }
  if (!fs.existsSync(path.join(superpowersRoot, 'LICENSE'))) {
    throw new Error('vendored Superpowers license is required');
  }
  const superpowersSkillsRoot = path.join(superpowersRoot, 'skills');
  const superpowersSkills = listDirectories(superpowersSkillsRoot);
  if (superpowersSkills.length === 0) throw new Error('vendored Superpowers skills are missing');
  for (const skill of superpowersSkills) {
    assertSkillPackage(path.join(superpowersSkillsRoot, skill), skill);
  }

  const internalGuidanceLeaks = [];
  for (const file of listFilesRecursively(payloadRoot)) {
    if (!/\.(?:md|json|txt)$/i.test(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const forbidden of FORBIDDEN_PATTERNS) {
      if (forbidden.pattern.test(content)) {
        internalGuidanceLeaks.push(`${path.relative(rootDir, file)}: ${forbidden.label}`);
      }
    }
  }
  if (internalGuidanceLeaks.length > 0) {
    throw new Error(`generated-app payload contains internal guidance: ${internalGuidanceLeaks.join(', ')}`);
  }

  return {
    takuSkills,
    superpowersVersion: SUPERPOWERS_VERSION,
    superpowersBundleSha256,
    superpowersSkills,
    internalGuidanceLeaks,
  };
}

if (require.main === module) {
  try {
    const report = checkAgentPayload();
    console.log(
      `[agent-payload] taku-skills=${report.takuSkills.length} superpowers=${report.superpowersVersion} superpowers-skills=${report.superpowersSkills.length}`
    );
  } catch (error) {
    console.error(`[agent-payload] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = {
  checkAgentPayload,
  computeBundleSha256,
  portableUnicodeCaseFold,
  validateBundleDirectoryNames,
};
