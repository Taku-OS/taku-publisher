#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { assertFreshConverterBuild } = await import('../dist/lib/build-freshness.js');
await assertFreshConverterBuild(projectRoot);
const { buildColdMigrationPrompt, buildColdReviewPrompt } = await import(
  '../dist/lib/cold-agent.js'
);
const REQUIRED_PROVIDER = 'kimi-code/k3';
const THINKING_EFFORT = 'high';
const REQUIRED_MIGRATION_SKILL_FILES = [
  '.agents/skills/complete-repo-migration/SKILL.md',
  '.agents/skills/taku-subapp-development/SKILL.md',
  '.agents/skills/taku-action-contract/SKILL.md',
  '.agents/skills/taku-subapp-verification/SKILL.md',
];

function usage() {
  return `Usage: run-kimi-cold-agent.mjs --mode <migrate|review> --workspace <absolute-path> --evidence <absolute-path> --agent-file <absolute-path> <--dry-run|--run> [--log <path>]`;
}

function parseArgs(args) {
  const parsed = { dryRun: false, run: false, modeCount: 0 };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--dry-run') {
      parsed.dryRun = true;
      parsed.modeCount += 1;
      continue;
    }
    if (flag === '--run') {
      parsed.run = true;
      parsed.modeCount += 1;
      continue;
    }

    const key = {
      '--mode': 'mode',
      '--workspace': 'workspace',
      '--evidence': 'evidence',
      '--agent-file': 'agentFile',
      '--log': 'logPath',
    }[flag];
    const value = args[index + 1];

    if (!key || !value || value.startsWith('--')) {
      throw new Error(usage());
    }

    parsed[key] = value;
    index += 1;
  }

  if (parsed.modeCount !== 1 || !['migrate', 'review'].includes(parsed.mode)) {
    throw new Error(usage());
  }

  for (const required of ['workspace', 'evidence', 'agentFile']) {
    if (!parsed[required]) {
      throw new Error(usage());
    }
  }

  return parsed;
}

function requireAbsolutePath(value, name) {
  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }

  return path.resolve(value);
}

function requireContainedPath(parent, candidate, description) {
  const relative = path.relative(parent, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${description} must be within ${parent}`);
  }
}

async function requireCanonicalDirectory(value, name) {
  const candidate = requireAbsolutePath(value, name);
  const details = await lstat(candidate);
  if (details.isSymbolicLink()) {
    throw new Error(`${name} must not be a symbolic link`);
  }
  if (!details.isDirectory()) {
    throw new Error(`${name} must be a directory`);
  }
  return realpath(candidate);
}

async function requireCanonicalFile(value, name) {
  const candidate = requireAbsolutePath(value, name);
  const details = await lstat(candidate);
  if (details.isSymbolicLink()) {
    throw new Error(`${name} must not be a symbolic link`);
  }
  if (!details.isFile()) {
    throw new Error(`${name} must be a file`);
  }
  return realpath(candidate);
}

async function requireManagedSkillsDirectory(workspace) {
  let candidate = workspace;
  for (const segment of ['.agents', 'skills']) {
    candidate = path.join(candidate, segment);
    const details = await lstat(candidate);
    if (details.isSymbolicLink()) {
      throw new Error('skills directory must not be a symbolic link');
    }
    if (!details.isDirectory()) {
      throw new Error('skills directory must be a directory');
    }
  }

  const skillsDirectory = await realpath(candidate);
  requireContainedPath(workspace, skillsDirectory, 'skills directory');

  for (const relativeSkillPath of REQUIRED_MIGRATION_SKILL_FILES) {
    const skillDirectory = path.dirname(path.join(workspace, relativeSkillPath));
    const skillFile = path.join(workspace, relativeSkillPath);

    let directoryDetails;
    let fileDetails;
    try {
      directoryDetails = await lstat(skillDirectory);
      fileDetails = await lstat(skillFile);
    } catch {
      throw new Error(`required migration skill ${relativeSkillPath} must exist`);
    }

    if (directoryDetails.isSymbolicLink() || !directoryDetails.isDirectory()) {
      throw new Error(
        `required migration skill ${relativeSkillPath} must have an unsymlinked directory`,
      );
    }
    if (fileDetails.isSymbolicLink() || !fileDetails.isFile() || fileDetails.size === 0) {
      throw new Error(
        `required migration skill ${relativeSkillPath} must be a non-empty unsymlinked regular file`,
      );
    }

    requireContainedPath(
      workspace,
      await realpath(skillFile),
      `required migration skill ${relativeSkillPath}`,
    );
  }

  return skillsDirectory;
}

async function requireUnsymlinkedDescendant(root, value, name) {
  const rootPath = requireAbsolutePath(root, name);
  const valuePath = requireAbsolutePath(value, name);
  requireContainedPath(rootPath, valuePath, name);
  const relativePath = path.relative(rootPath, valuePath);

  let candidate = rootPath;
  for (const segment of relativePath.split(path.sep)) {
    candidate = path.join(candidate, segment);
    try {
      if ((await lstat(candidate)).isSymbolicLink()) {
        throw new Error(`${name} must not contain a symbolic link`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}

async function requireCanonicalLogDestination(evidence, evidenceInput, value) {
  const requestedLogPath = requireAbsolutePath(value, 'log path');
  await requireUnsymlinkedDescendant(evidenceInput, requestedLogPath, 'log path');
  try {
    const details = await lstat(requestedLogPath);
    if (details.isSymbolicLink()) {
      throw new Error('log path must not contain a symbolic link');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const canonicalParent = await realpath(path.dirname(requestedLogPath));
  const logPath = path.join(canonicalParent, path.basename(requestedLogPath));
  requireContainedPath(evidence, logPath, 'log path');
  const relativeLogPath = path.relative(evidence, logPath);
  if (!relativeLogPath) {
    throw new Error('log path must name a file within evidence path');
  }

  const pathSegments = relativeLogPath.split(path.sep);
  let candidate = evidence;
  for (const [index, segment] of pathSegments.entries()) {
    candidate = path.join(candidate, segment);
    try {
      const details = await lstat(candidate);
      if (details.isSymbolicLink()) {
        throw new Error('log path must not contain a symbolic link');
      }
      if (index < pathSegments.length - 1 && !details.isDirectory()) {
        throw new Error('log path parent must be a directory');
      }
      if (index === pathSegments.length - 1 && !details.isFile()) {
        throw new Error('log path must be a file');
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return logPath;
      }
      throw error;
    }
  }

  return realpath(logPath);
}

function buildCommand({ mode, workspace, evidence, agentFile, skillsDirectory }) {
  return [
    'kimi',
    '--model',
    'kimi-code/k3',
    '--agent-file',
    agentFile,
    '--skills-dir',
    skillsDirectory,
    '--output-format',
    'stream-json',
    '--prompt',
    mode === 'migrate'
      ? buildColdMigrationPrompt(workspace)
      : buildColdReviewPrompt(workspace, evidence),
  ];
}

function redact(text) {
  return text
    .replace(
      /((?:"|')?authorization(?:"|')?\s*[:=]\s*)[^\r\n]*/gi,
      '$1[REDACTED]',
    )
    .replace(
      /((?:"|')?(?:[A-Za-z][A-Za-z0-9_-]*)?(?:token|secret|key|password|passwd|cookie|authorization)(?:"|')?\s*[:=]\s*)(?:"(?:Bearer\s+)?[^"]*"|'(?:Bearer\s+)?[^']*'|Bearer\s+[^\s,;}"']+|[^\s,;}"']+)/gi,
      '$1[REDACTED]',
    )
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    );
}

async function captureProbe(command) {
  try {
    const { stdout, stderr } = await execFileAsync('kimi', command, {
      env: buildKimiEnvironment(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
    });
    return { output: `${stdout}${stderr}`, exitCode: 0, source: 'cli' };
  } catch (error) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? error.message}`,
      exitCode: typeof error.code === 'number' ? error.code : 1,
      source: 'cli',
    };
  }
}

function buildKimiEnvironment() {
  const environment = {};
  for (const name of ['PATH', 'HOME', 'KIMI_CODE_HOME', 'LANG', 'LC_ALL', 'TERM']) {
    if (Object.hasOwn(process.env, name)) {
      environment[name] = process.env[name];
    }
  }
  return {
    ...environment,
    KIMI_MODEL_THINKING_EFFORT: THINKING_EFFORT,
    KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY: '1',
  };
}

async function invokeModel(command, workspace) {
  try {
    const { stdout, stderr } = await execFileAsync(command[0], command.slice(1), {
      cwd: workspace,
      env: buildKimiEnvironment(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return {
      stdout: `${error.stdout ?? ''}`,
      stderr: `${error.stderr ?? error.message}`,
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceInput = requireAbsolutePath(args.workspace, 'workspace');
  const evidenceInput = requireAbsolutePath(args.evidence, 'evidence');
  const workspace = await requireCanonicalDirectory(workspaceInput, 'workspace');
  const evidence = await requireCanonicalDirectory(evidenceInput, 'evidence');
  const agentFile = await requireCanonicalFile(args.agentFile, 'agent file');
  requireContainedPath(workspace, evidence, 'evidence path');
  const skillsDirectory = await requireManagedSkillsDirectory(workspace);
  const logPath = await requireCanonicalLogDestination(
    evidence,
    evidenceInput,
    args.logPath ?? path.join(evidenceInput, 'kimi-cold-agent.json'),
  );

  const [version, provider] = await Promise.all([captureProbe(['--version']), captureProbe(['provider', 'list'])]);
  const command = buildCommand({ mode: args.mode, workspace, evidence, agentFile, skillsDirectory });
  const evidenceRecord = {
    mode: args.run ? 'run' : 'dry-run',
    version: { ...version, output: redact(version.output) },
    provider: { ...provider, output: redact(provider.output) },
    model: 'k3',
    thinkingEffort: THINKING_EFFORT,
    invocation: {
      command: command.map((argument) => redact(argument)),
      env: {
        KIMI_MODEL_THINKING_EFFORT: THINKING_EFFORT,
        KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY: '1',
      },
      exitCode: null,
      stdout: '',
      stderr: '',
    },
  };

  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, `${JSON.stringify(evidenceRecord, null, 2)}\n`);

  if (version.exitCode !== 0 || provider.exitCode !== 0) {
    throw new Error('Kimi version or provider probe failed; see redacted evidence log');
  }
  if (!provider.output.includes(REQUIRED_PROVIDER)) {
    throw new Error(`Kimi provider list did not contain required ${REQUIRED_PROVIDER}`);
  }

  if (args.run) {
    const invocation = await invokeModel(command, workspace);
    evidenceRecord.invocation = {
      ...evidenceRecord.invocation,
      exitCode: invocation.exitCode,
      stdout: redact(invocation.stdout),
      stderr: redact(invocation.stderr),
    };
    await writeFile(logPath, `${JSON.stringify(evidenceRecord, null, 2)}\n`);
    if (invocation.exitCode !== 0) {
      throw new Error('Kimi model invocation failed; see redacted evidence log');
    }
    process.stdout.write(`Kimi cold-agent run complete; evidence: ${logPath}\n`);
    return;
  }

  process.stdout.write(`Kimi cold-agent dry-run complete; evidence: ${logPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${redact(error.message)}\n`);
  process.exitCode = 1;
});
