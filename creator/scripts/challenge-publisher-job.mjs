import { dispatch, jsonOutput, PublisherError } from '#taku-publisher-runtime';
import {
  challengePublisherState, publicChallengeHandoffState, readChallengeHandoff,
  selectedChallengeSource, withChallengeLock, writeChallengeHandoff,
} from './challenge-handoff.mjs';

// The current host performs semantic review. This coordinator calls the same
// production runtime; it neither runs an AI agent nor submits a public release.
export async function prepareChallengeSkill(draft, { upload = false, execute = dispatch } = {}) {
  return withChallengeLock(draft, async () => {
    const context = await readChallengeHandoff(draft);
    if (!context || context.status === 'skipped') throw new Error('No selected active Challenge.');
    const source = await selectedChallengeSource(context);
    const id = context.publisherDraftId;
    if (!id) throw new Error('Select a Skill before preparing it.');
    const invoke = async (command, flags = {}) => {
      let result;
      try {
        result = await execute({ command,
          flags: new Map(Object.entries({ 'draft-id': id, ...flags })), rest: [] });
      } catch (error) {
        if (!(error instanceof PublisherError)) throw error;
        return jsonOutput('error', {
          error: { code: error.code, message: error.message, details: error.details },
        }, { ok: false });
      }
      if (!result || typeof result.ok !== 'boolean' || (result.ok && typeof result.status !== 'string')) {
        throw new Error('Invalid Publisher runtime result.');
      }
      return result;
    };
    const remoteFlags = { 'worker-url': context.workerUrl, 'site-url': context.siteUrl,
      ...(context.allowCustomWorkerUrl === true ? { 'allow-custom-worker-url': true } : {}) };
    let state = await challengePublisherState(context);
    let result;
    if (!state) {
      result = await invoke('init', { workspace: source, source, type: 'skill', mode: 'create' });
      if (result.ok === false) return result;
      state = { status: result.status };
    }
    // Bound transitions even if an unexpected Worker/runtime result occurs.
    for (let step = 0; step < 8; step += 1) {
      const status = String(state.status);
      if (status === 'selected') result = await invoke('stage');
      else if (status === 'staged') result = await invoke('scan');
      else if (status === 'ready_to_package') result = await invoke('package');
      else if (status === 'packaged' && upload) {
        result = await invoke('remote-create', remoteFlags);
      } else if (status === 'remote_draft_created' && upload) {
        result = await invoke('remote-scan', remoteFlags);
        if (result.ok === false) return result;
        result = await invoke('remote-upload', remoteFlags);
      } else {
        return { ...publicChallengeHandoffState(context, state),
          ...(result ? { publisherResult: result } : {}) };
      }
      if (result.ok === false) return result;
      if (typeof result.review_url === 'string' && result.review_url) {
        context.reviewUrl = result.review_url;
        await writeChallengeHandoff(draft, context);
      }
      state = { ...state, status: result.status, remote_draft_id: result.remote_draft_id || state.remote_draft_id };
      if (result.status === 'remote_draft_created' && result.requires_action === true) {
        // Preserve production's missing-icon/listing gate; do not upload blindly.
        return { ...publicChallengeHandoffState(context, state),
          requires_action: true, action_type: result.action_type, publisherResult: result };
      }
    }
    throw new Error('Challenge preparation did not reach a safe stopping point.');
  });
}
