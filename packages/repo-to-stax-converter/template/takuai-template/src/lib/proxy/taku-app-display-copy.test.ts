import assert from 'node:assert/strict';
import test from 'node:test';

import { getProxyAppId, setProxyAccessTokenOverride } from './env';
import { proxyJson } from './fetch';

function assertTakuAppCopy(error: unknown, expectedText: string): true {
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  assert.ok(message.includes(expectedText));
  assert.doesNotMatch(message, /\bSubApps?\b|子应用/iu);
  return true;
}

test('missing app id error uses the Taku App display name', () => {
  const previousAppId = process.env.TAKU_APPLICATION_ID;
  delete process.env.TAKU_APPLICATION_ID;
  try {
    assert.throws(
      () => getProxyAppId(),
      (error) => assertTakuAppCopy(error, '该 Taku App 必须运行在 Taku 宿主内')
    );
  } finally {
    if (previousAppId === undefined) delete process.env.TAKU_APPLICATION_ID;
    else process.env.TAKU_APPLICATION_ID = previousAppId;
  }
});

test('unauthorized proxy error tells users to refresh the Taku App', async () => {
  const previousAppId = process.env.TAKU_APPLICATION_ID;
  const previousFetch = globalThis.fetch;
  process.env.TAKU_APPLICATION_ID = 'copy-contract-app';
  setProxyAccessTokenOverride({ accessToken: 'copy-contract-access' });
  globalThis.fetch = async () => new Response('', { status: 401, statusText: 'Unauthorized' });

  try {
    await assert.rejects(
      () => proxyJson('/copy-contract'),
      (error) => assertTakuAppCopy(error, '重开/刷新 Taku App')
    );
  } finally {
    globalThis.fetch = previousFetch;
    setProxyAccessTokenOverride({ accessToken: null });
    if (previousAppId === undefined) delete process.env.TAKU_APPLICATION_ID;
    else process.env.TAKU_APPLICATION_ID = previousAppId;
  }
});
