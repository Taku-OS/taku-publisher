import { join } from 'node:path';
import { readJsonIfExists, writeJson } from './fs.js';

interface RuntimeManifest {
  name?: string;
  description?: string;
  version?: string;
  actions?: Array<{ name?: string; [key: string]: unknown }>;
  llm?: Record<string, unknown>;
}
const TEMPLATE_DEMO_ACTIONS = new Set(['greet', 'getStatus']);

export async function patchTakuManifest(params: {
  workspaceRoot: string;
  name: string;
  description: string;
}): Promise<void> {
  const manifestPath = join(params.workspaceRoot, 'taku.manifest.json');
  const source = (await readJsonIfExists<RuntimeManifest>(manifestPath)) ?? {};
  const manifest: RuntimeManifest = {
    name: params.name,
    description: params.description,
    version: typeof source.version === 'string' ? source.version : '0.1.0',
    actions: (Array.isArray(source.actions) ? source.actions : []).filter(
      action => typeof action.name === 'string' && !TEMPLATE_DEMO_ACTIONS.has(action.name)
    ),
  };
  if (source.llm && typeof source.llm === 'object' && !Array.isArray(source.llm)) {
    manifest.llm = source.llm;
  }
  await writeJson(manifestPath, manifest);
}
