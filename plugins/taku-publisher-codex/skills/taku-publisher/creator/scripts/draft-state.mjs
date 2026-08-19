import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const EDITOR_STATE_SCHEMA = 'taku.creator.editor-state.v1';
export const PRIVATE_STATE_SCHEMA = 'taku.creator.private-state.v1';

export async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return resolved;
}

export async function writeText(filePath, value) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, value, 'utf8');
  return resolved;
}

export function previewPathFor(outputPath) {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.html`);
}

export function editorStatePathFor(outputPath) {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.editor.json`);
}

export function privateStatePathFor(outputPath) {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.private.json`);
}

export async function writeEditorState(draftPath, value) {
  const resolvedDraftPath = path.resolve(draftPath);
  const statePath = editorStatePathFor(resolvedDraftPath);
  await writeJson(statePath, {
    schemaVersion: EDITOR_STATE_SCHEMA,
    updatedAt: new Date().toISOString(),
    previewPath: value.previewPath,
    toolChoices: value.toolChoices,
    creationChoices: value.creationChoices,
  });
  return statePath;
}

export async function readEditorState(draftPath) {
  const state = await readJsonFile(editorStatePathFor(path.resolve(draftPath)));
  if (!state || state.schemaVersion !== EDITOR_STATE_SCHEMA) return null;
  return state;
}

export async function writePrivateState(draftPath, value) {
  const resolvedDraftPath = path.resolve(draftPath);
  const statePath = privateStatePathFor(resolvedDraftPath);
  await writeJson(statePath, {
    schemaVersion: PRIVATE_STATE_SCHEMA,
    updatedAt: new Date().toISOString(),
    draftPath: resolvedDraftPath,
    privateInventory: value,
  });
  return statePath;
}

export async function readPrivateState(draftPath) {
  const state = await readJsonFile(privateStatePathFor(path.resolve(draftPath)));
  if (!state || state.schemaVersion !== PRIVATE_STATE_SCHEMA) return null;
  return state;
}
