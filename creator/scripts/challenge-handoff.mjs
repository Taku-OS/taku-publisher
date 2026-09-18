import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadState } from '#taku-publisher-runtime';
import { readPrivateState } from './draft-state.mjs';

const SCHEMA = 'taku.creator.challenge-handoff.v2';
const MAX_STATE_BYTES = 1024 * 1024;
const text = (value, length = 160) => typeof value === 'string'
  ? value.replace(/\s+/g, ' ').trim().slice(0, length) : '';
export const challengeHandoffPathFor = (draft) => `${path.resolve(draft)}.challenge.json`;

export function challengeCandidatesFromCreationChoices(choices = {}) {
  const seen = new Map();
  for (const group of ['displayedCreations', 'confirmedCreations', 'madeCreations', 'remixedCreations', 'hiddenCreations']) {
    for (const item of Array.isArray(choices[group]) ? choices[group] : []) {
      if (!['skill', 'skills'].includes(String(item?.type || item?.kind || '').toLowerCase())
          || item.publishable === false || item.published === true || item.status === 'published') continue;
      const candidateId = text(item.id || item.localId, 80), name = text(item.name || item.title);
      if (candidateId && name && !seen.has(candidateId)) seen.set(candidateId, { candidateId, name, type: 'skill' });
    }
  }
  return [...seen.values()].slice(0, 80);
}

async function sourceRoot(localPath) {
  if (!path.isAbsolute(String(localPath || ''))) throw new Error('A selected Skill requires an absolute registered source.');
  const canonical = await fs.realpath(localPath);
  const info = await fs.stat(canonical);
  const root = info.isDirectory() ? canonical : path.basename(canonical) === 'SKILL.md' ? path.dirname(canonical) : '';
  if (!root) throw new Error('The selected source is not a Skill.');
  const skill = await fs.lstat(path.join(root, 'SKILL.md'));
  if (!skill.isFile() || skill.isSymbolicLink()) throw new Error('The Skill entry must be a regular local SKILL.md file.');
  return root;
}

export async function readChallengeHandoff(draft) {
  const file = challengeHandoffPathFor(draft);
  let info;
  try { info = await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES) throw new Error('Unsafe Challenge state.');
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  if (state.schemaVersion !== SCHEMA || state.draftPath !== path.resolve(draft)
      || !/^[a-f0-9]{32}$/.test(state.contextId) || !Array.isArray(state.candidates)
      || !state.sources || typeof state.sources !== 'object' || Array.isArray(state.sources)
      || state.candidates.length > 80 || state.candidates.some((item) =>
        !item || typeof item.candidateId !== 'string' || !item.candidateId
        || typeof item.name !== 'string' || item.type !== 'skill'
        || !Object.hasOwn(state.sources, item.candidateId))) throw new Error('Invalid Challenge state.');
  return state;
}

export async function writeChallengeHandoff(draft, state) {
  const file = challengeHandoffPathFor(draft);
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

export async function withChallengeLock(draft, operation) {
  const lock = `${challengeHandoffPathFor(draft)}.lock`;
  const handle = await fs.open(lock, 'wx', 0o600).catch((error) => {
    if (error.code === 'EEXIST') throw new Error('Another operation is using this Challenge; reuse its result.');
    throw error;
  });
  try { return await operation(); }
  finally { await handle.close(); await fs.unlink(lock); }
}

export async function createChallengeHandoff(draft, { candidates, workerUrl, siteUrl, allowCustomWorkerUrl = false }) {
  return withChallengeLock(draft, async () => {
    const previous = await readChallengeHandoff(draft);
    if (previous) return previous;
    const items = (await readPrivateState(draft))?.privateInventory?.items;
    const inventory = Array.isArray(items) ? items : [];
    const sources = Object.create(null), available = [];
    for (const candidate of candidates) {
      const registered = inventory.find((item) => item.id === candidate.candidateId
        && ['skill', 'skills'].includes(String(item.type || '').toLowerCase()) && item.publishable !== false);
      if (!registered?.localPath) continue;
      try {
        sources[candidate.candidateId] = { registeredPath: registered.localPath, canonicalPath: await sourceRoot(registered.localPath) };
        available.push(candidate);
      } catch { /* Missing or unsupported entries are not offered for selection. */ }
    }
    const state = { schemaVersion: SCHEMA, contextId: randomBytes(16).toString('hex'),
      draftPath: path.resolve(draft), candidates: available, sources, workerUrl, siteUrl,
      allowCustomWorkerUrl, status: available.length ? 'waiting_for_selection' : 'no_candidates',
      selectedToolId: null, publisherDraftId: null,
      updatedAt: new Date().toISOString() };
    await writeChallengeHandoff(draft, state);
    return state;
  });
}

export async function selectedChallengeSource(state) {
  const source = Object.hasOwn(state.sources, state.selectedToolId) ? state.sources[state.selectedToolId] : null;
  if (!source || !state.candidates.some((item) => item.candidateId === state.selectedToolId)) {
    throw new Error('Select one registered Skill in the current host first.');
  }
  const canonicalPath = await sourceRoot(source.registeredPath);
  if (canonicalPath !== source.canonicalPath) throw new Error('The registered Skill source changed; start a new Challenge.');
  return canonicalPath;
}

export async function challengePublisherState(state) {
  if (!state.selectedToolId || !state.publisherDraftId) return null;
  const expectedId = `challenge_${state.contextId}`;
  if (state.publisherDraftId !== expectedId) throw new Error('Challenge publisher identity mismatch.');
  let publisher;
  try { publisher = (await loadState(expectedId)).state; }
  catch (error) { if (error.code === 'missing_file') return null; throw error; }
  if (publisher.unit?.type !== 'skill' || publisher.mode !== 'create'
      || publisher.source_path !== state.sources[state.selectedToolId]?.canonicalPath) {
    throw new Error('The publishing draft does not belong to the selected Challenge Skill.');
  }
  return publisher;
}

export function publicChallengeHandoffState(state, publisher = null) {
  const status = state.status === 'skipped' ? 'skipped' : publisher?.status || state.status;
  const action = status === 'waiting_for_selection' ? 'select_local_skill_or_skip'
    : status === 'awaiting_deep_scan' ? 'perform_semantic_review'
    : ['blocked', 'deterministic_blocked'].includes(status) ? 'fix_source_and_start_new_draft'
    : status === 'awaiting_web_confirmation' ? 'review_and_submit_on_taku_web'
    : status === 'packaged' ? 'confirm_private_upload'
    : ['skipped', 'no_candidates'].includes(status) ? null : 'continue_selected_skill_preparation';
  return { ok: true, schemaVersion: SCHEMA, status, status_scope: 'local_only',
    challengeHandoff: true, challengeMode: 'host_first', challengeDraftPath: state.draftPath,
    candidates: state.candidates.map(({ candidateId, name }) => ({ candidateId, name, type: 'skill' })),
    selectedToolId: state.selectedToolId, publisherDraftId: state.publisherDraftId,
    remoteDraftId: publisher?.remote_draft_id || null, reviewUrl: state.reviewUrl || null,
    requires_action: Boolean(action), action_type: action,
    publicReleaseAttempted: false, publicationStatus: 'not_verified' };
}

export function challengeCloudStudioResult(cloudResult, state, publisher = null) {
  const view = publicChallengeHandoffState(state, publisher);
  const selectionPending = view.status === 'waiting_for_selection';
  return { ...cloudResult, ...view, challengeSkills: view.candidates,
    primaryAction: 'open_stax_challenge_review',
    message: selectionPending
      ? 'The private Card is ready on the Stax Challenge Review page. Choose one local Skill here in the current host, or skip; public release requires Taku Web confirmation.'
      : 'The private Card is ready on the Stax Challenge Review page. Continue the existing selected Skill only if requested; public release requires Taku Web confirmation.' };
}

export async function selectChallengeSkill(draft, candidateId) {
  return withChallengeLock(draft, async () => {
    const state = await readChallengeHandoff(draft);
    if (!state || state.status === 'skipped') throw new Error('No active Challenge context.');
    if (!state.candidates.some((item) => item.candidateId === candidateId)) throw new Error('Choose a Skill from this Challenge inventory.');
    if (state.selectedToolId && state.selectedToolId !== candidateId) throw new Error('This Challenge already has one selected Skill.');
    state.selectedToolId = candidateId;
    const canonicalPath = await selectedChallengeSource(state);
    state.publisherDraftId = `challenge_${state.contextId}`;
    state.status = 'selected'; state.updatedAt = new Date().toISOString();
    await writeChallengeHandoff(draft, state);
    return { ...publicChallengeHandoffState(state, await challengePublisherState(state)),
      selectedSkill: { id: candidateId, name: state.candidates.find((item) => item.candidateId === candidateId).name,
        type: 'skill', sourcePath: canonicalPath, workspace: canonicalPath } };
  });
}

export async function skipChallengeSkill(draft) {
  return withChallengeLock(draft, async () => {
    const state = await readChallengeHandoff(draft);
    if (!state) throw new Error('No active Challenge context.');
    if (await challengePublisherState(state)) throw new Error('Preparation already started; skipping must not silently abandon a publishing draft.');
    state.status = 'skipped'; state.updatedAt = new Date().toISOString();
    await writeChallengeHandoff(draft, state);
    return publicChallengeHandoffState(state);
  });
}
