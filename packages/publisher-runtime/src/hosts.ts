import * as os from 'node:os';
import * as path from 'node:path';

import { PublisherError } from './util.js';

export const SKILL_HOST_IDS = [
  'codex',
  'claude-code',
  'cursor',
  'opencode',
  'gemini-cli',
  'agent-skills',
] as const;

export type SkillHostId = typeof SKILL_HOST_IDS[number];

export interface SkillHostDefinition {
  id: SkillHostId;
  label: string;
  aliases: readonly string[];
  homeEnvironment?: string;
  defaultHome: readonly string[];
  skillDirectory: readonly string[];
  supportsPluginPackage: boolean;
  supportsRecentProjectDiscovery: boolean;
  documentationUrl?: string;
}

export const SKILL_HOSTS: readonly SkillHostDefinition[] = [
  {
    id: 'codex',
    label: 'Codex',
    aliases: ['openai'],
    homeEnvironment: 'CODEX_HOME',
    defaultHome: ['.codex'],
    skillDirectory: ['skills'],
    supportsPluginPackage: true,
    supportsRecentProjectDiscovery: true,
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    aliases: ['claude', 'cc', 'anthropic'],
    homeEnvironment: 'CLAUDE_CONFIG_DIR',
    defaultHome: ['.claude'],
    skillDirectory: ['skills'],
    supportsPluginPackage: true,
    supportsRecentProjectDiscovery: true,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    aliases: ['composer'],
    homeEnvironment: 'CURSOR_HOME',
    defaultHome: ['.cursor'],
    skillDirectory: ['skills'],
    supportsPluginPackage: true,
    supportsRecentProjectDiscovery: true,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    aliases: ['open-code'],
    homeEnvironment: 'OPENCODE_CONFIG_DIR',
    defaultHome: ['.config', 'opencode'],
    skillDirectory: ['skills'],
    supportsPluginPackage: false,
    supportsRecentProjectDiscovery: false,
    documentationUrl: 'https://opencode.ai/docs/skills/',
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    aliases: ['gemini', 'google'],
    homeEnvironment: 'GEMINI_HOME',
    defaultHome: ['.gemini'],
    skillDirectory: ['skills'],
    supportsPluginPackage: false,
    supportsRecentProjectDiscovery: false,
  },
  {
    id: 'agent-skills',
    label: 'Agent Skills compatible host',
    aliases: ['agents', 'generic', 'portable'],
    homeEnvironment: 'AGENT_SKILLS_HOME',
    defaultHome: ['.agents'],
    skillDirectory: ['skills'],
    supportsPluginPackage: false,
    supportsRecentProjectDiscovery: false,
  },
] as const;

const HOST_BY_NAME = new Map<string, SkillHostDefinition>();
for (const host of SKILL_HOSTS) {
  HOST_BY_NAME.set(host.id, host);
  for (const alias of host.aliases) HOST_BY_NAME.set(alias, host);
}

export function normalizeSkillHost(value: string): SkillHostId {
  const normalized = String(value ?? '').trim().toLowerCase();
  const host = HOST_BY_NAME.get(normalized);
  if (!host) {
    throw new PublisherError(
      `Skill host must be one of: ${SKILL_HOST_IDS.join(', ')}.`,
      'unsupported_skill_host',
      { host: normalized || null },
    );
  }
  return host.id;
}

export function skillHostDefinition(value: string): SkillHostDefinition {
  const host = normalizeSkillHost(value);
  return SKILL_HOSTS.find((candidate) => candidate.id === host)!;
}

export function skillInstallRoot(
  value: string,
  options: {
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
  } = {},
): string {
  const host = skillHostDefinition(value);
  const env = options.env ?? process.env;
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const configuredHome = host.homeEnvironment
    ? String(env[host.homeEnvironment] ?? '').trim()
    : '';
  const defaultHome = host.id === 'opencode' && String(env.XDG_CONFIG_HOME ?? '').trim()
    ? path.join(String(env.XDG_CONFIG_HOME).trim(), 'opencode')
    : path.join(homeDir, ...host.defaultHome);
  const hostHome = path.resolve(configuredHome || defaultHome);
  const root = path.resolve(hostHome, ...host.skillDirectory);
  if (
    hostHome === path.parse(hostHome).root
    || hostHome === homeDir
    || root === path.parse(root).root
    || root === homeDir
    || !isWithin(hostHome, root)
  ) {
    throw new PublisherError(
      `${host.label} Skill install root is too broad.`,
      'unsafe_install_target',
      { host: host.id },
    );
  }
  return root;
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
