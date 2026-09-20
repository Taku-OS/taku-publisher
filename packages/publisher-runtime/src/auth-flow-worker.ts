import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { authHasScope, publisherSessionPath, readSession, resolveAuth } from './auth.js';
import { authFlowPaths, type AuthFlowOptions } from './auth-flow.js';
import { loginWithBrowser } from './browser-auth.js';
import type { JsonObject } from './types.js';
import { atomicWriteJson, PublisherError } from './util.js';

process.once('message', async (message: { options: AuthFlowOptions; state: JsonObject }) => {
  const { options, state } = message;
  const paths = authFlowPaths();
  state.pid = process.pid;
  const cancelPath = path.join(paths.root, `${state.request_id}.cancel`);
  const controller = new AbortController();
  let writes = Promise.resolve();
  const persist = () => {
    const snapshot = { ...state, heartbeat_at: Date.now() };
    writes = writes.then(() => atomicWriteJson(paths.state, snapshot));
    return writes;
  };
  let notified = false;
  const notify = () => {
    if (!notified && process.connected) { notified = true; process.send?.({ ready: true }); }
  };
  const timer = setInterval(() => {
    void fs.access(cancelPath).then(() => controller.abort(), () => undefined);
    void persist().catch(() => controller.abort());
  }, 500);
  try {
    await persist();
    await loginWithBrowser({ ...options, signal: controller.signal, onEvent: async event => {
      if (event.status === 'authenticated') return; // Validate scopes before reporting completion.
      Object.assign(state, event);
      await persist();
      // Wait until the OS launch attempt finishes (bounded to five seconds).
      if (event.status === 'awaiting_authorization') notify();
    } });
    const auth = await resolveAuth({ env: { ...process.env, TAKU_BEARER_TOKEN: '', TAKU_PUBLISH_TOKEN: '' }, allowDesktopSession: false });
    if (
      auth.source !== 'publisher_session'
      || !auth.token
      || !options.requiredScopes.every(scope => authHasScope(auth, scope))
      || (options.requiredFlowchartToken === true && !auth.flowchartToken)
    ) {
      throw new PublisherError('Authorization did not grant the required permissions.', 'auth_scope_missing');
    }
    state.status = 'authenticated';
    const session = readSession(publisherSessionPath());
    state.session_created_at = session?.createdAt ?? null;
    state.account_hint = session?.accountHint ?? null;
  } catch (error) {
    state.status = controller.signal.aborted ? 'authorization_cancelled'
      : error instanceof PublisherError && error.code === 'auth_timeout' ? 'authorization_expired' : 'authorization_failed';
    state.error_code = error instanceof PublisherError ? error.code : 'auth_receiver_failed';
  } finally {
    clearInterval(timer);
    delete state.authorization_url;
    await persist().catch(() => undefined);
    await fs.rm(cancelPath, { force: true }).catch(() => undefined);
    notify();
    if (process.connected) process.disconnect();
  }
});
