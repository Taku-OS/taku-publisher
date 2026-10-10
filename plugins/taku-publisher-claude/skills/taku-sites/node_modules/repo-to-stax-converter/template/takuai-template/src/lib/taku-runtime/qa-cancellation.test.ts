import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRunCancellation } from '../../../docs/examples/subapp-agent-runtime-qa/run-cancellation';

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('QA cancel deduplicates clicks, uses the accepted run ID and waits for the terminal event', async () => {
  const rpc = deferred();
  const calls: string[] = [];
  const control = createRunCancellation({
    runId: 'accepted-run',
    state: 'running',
    onChange() {},
    cancel: (runId) => {
      calls.push(runId);
      return rpc.promise;
    },
  });
  const first = control.request();
  await control.request();
  assert.deepEqual(calls, ['accepted-run']);
  assert.equal(control.view.phase, 'requesting');
  rpc.resolve({ snapshot: { state: 'cancelling' } });
  await first;
  assert.equal(control.view.phase, 'awaiting-terminal');
  control.observe('running');
  await control.request();
  assert.equal(calls.length, 1);
  control.observe('cancelled');
  assert.equal(control.view.phase, 'terminal');
});

test('a failed cancel request allows explicit retry of the same run', async () => {
  const calls: string[] = [];
  const control = createRunCancellation({
    runId: 'original-run',
    state: 'running',
    onChange() {},
    cancel: async (runId) => {
      calls.push(runId);
      if (calls.length === 1) throw new Error('network unavailable');
    },
  });
  await control.request();
  assert.deepEqual(control.view, { phase: 'available', error: 'network unavailable' });
  await control.request();
  assert.deepEqual(calls, ['original-run', 'original-run']);
  assert.deepEqual(control.view, { phase: 'awaiting-terminal' });
});

for (const state of ['succeeded', 'failed', 'cancelled']) {
  test(`late cancel receipt/error cannot overwrite ${state}`, async () => {
    for (const fails of [false, true]) {
      const rpc = deferred();
      let updates = 0;
      const control = createRunCancellation({
        runId: 'old-run',
        state: 'running',
        cancel: () => rpc.promise,
        onChange() {
          updates++;
        },
      });
      const request = control.request();
      control.observe(state);
      const terminalUpdates = updates;
      if (fails) rpc.reject(new Error('late network error'));
      else rpc.resolve();
      await request;
      assert.equal(control.view.phase, 'terminal');
      assert.equal(updates, terminalUpdates);
      await control.request();
      assert.equal(updates, terminalUpdates);
    }
  });
}

test('a cancelling event is not final proof and a rejected RPC permits same-run retry', async () => {
  const rpc = deferred();
  const calls: string[] = [];
  const control = createRunCancellation({
    runId: 'still-original-run',
    state: 'running',
    onChange() {},
    cancel: async (id) => {
      calls.push(id);
      if (calls.length === 1) await rpc.promise;
    },
  });
  const first = control.request();
  control.observe('cancelling');
  rpc.reject(new Error('Cancellation could not be confirmed'));
  await first;
  assert.equal(control.view.phase, 'available');
  assert.equal(control.view.error, 'Cancellation could not be confirmed');
  await control.request();
  assert.deepEqual(calls, ['still-original-run', 'still-original-run']);
  assert.equal(control.view.phase, 'awaiting-terminal');
});

test('a recovered cancelling run permits explicit same-run confirmation without starting work', async () => {
  const calls: string[] = [];
  const control = createRunCancellation({
    runId: 'recovered-run',
    state: 'cancelling',
    onChange() {},
    cancel: async (id) => {
      calls.push(id);
    },
  });
  assert.equal(control.view.phase, 'available');
  assert.ok(control.view.error);
  await control.request();
  assert.deepEqual(calls, ['recovered-run']);
  assert.equal(control.view.phase, 'awaiting-terminal');
});

test('recovered terminal runs do not send another cancel RPC', async () => {
  for (const state of ['succeeded', 'failed', 'cancelled']) {
    const control = createRunCancellation({
      runId: 'recovered-run',
      state,
      onChange() {},
      cancel: async () => {
        assert.fail('must not re-cancel');
      },
    });
    await control.request();
    assert.equal(control.view.phase, 'terminal');
  }
});

test('disposing an old UI suppresses its late response without cancelling the Host run', async () => {
  const rpc = deferred();
  let updates = 0;
  const control = createRunCancellation({
    runId: 'old-run',
    state: 'running',
    cancel: () => rpc.promise,
    onChange() {
      updates++;
    },
  });
  const request = control.request();
  control.dispose();
  rpc.reject(new Error('late failure'));
  await request;
  control.observe('cancelled');
  await control.request();
  assert.equal(updates, 1);
});
