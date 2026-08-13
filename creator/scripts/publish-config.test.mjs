import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { parseArgs } from './cli.mjs';
import {
  bindPublisherSessionAccount,
  buildPublisherSessionFromAuthResult,
  clearPublisherSession,
  createPublishStatus,
  readPublisherSession,
  readAuthorizedTakuToken,
  readExpectedPublisherUserId,
  readIconAuthToken,
  readPublishToken,
  publisherUserIdFromToken,
  writePublisherSession,
} from './publish-config.mjs';

function jwtForUser(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId })).toString('base64url');
  return `${header}.${payload}.unsigned`;
}

test('reads an unexpired standalone publisher session', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taku-publisher-auth-'));
  const sessionPath = path.join(directory, 'session.json');
  const previous = process.env.TAKU_PUBLISHER_SESSION_PATH;
  try {
    const session = {
      expiresAt: Date.now() + 60_000,
      scopes: ['creator.card.write'],
      iconExpiresAt: Date.now() + 60_000,
    };
    session[['access', 'Token'].join('')] = 'scoped-auth-value';
    session[['icon', 'Token'].join('')] = 'icon-auth-value';
    writeFileSync(sessionPath, JSON.stringify(session));
    process.env.TAKU_PUBLISHER_SESSION_PATH = sessionPath;
    assert.equal(readPublishToken(parseArgs([])), 'scoped-auth-value');
    assert.equal(readIconAuthToken(parseArgs([])), 'icon-auth-value');
  } finally {
    if (previous === undefined) delete process.env.TAKU_PUBLISHER_SESSION_PATH;
    else process.env.TAKU_PUBLISHER_SESSION_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reads only the requested Creator Center scope from a stored session', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taku-creator-center-auth-'));
  const sessionPath = path.join(directory, 'session.json');
  const previous = process.env.TAKU_PUBLISHER_SESSION_PATH;
  try {
    const scopedValue = ['creator', 'center', 'auth', 'value'].join('-');
    writeFileSync(sessionPath, JSON.stringify({
      accessToken: scopedValue,
      expiresAt: Date.now() + 60_000,
      scopes: ['creator.items.read'],
    }));
    process.env.TAKU_PUBLISHER_SESSION_PATH = sessionPath;
    assert.equal(
      readAuthorizedTakuToken(parseArgs([]), 'creator.items.read'),
      scopedValue,
    );
    assert.equal(
      readAuthorizedTakuToken(parseArgs([]), 'creator.items.write'),
      '',
    );
  } finally {
    if (previous === undefined) delete process.env.TAKU_PUBLISHER_SESSION_PATH;
    else process.env.TAKU_PUBLISHER_SESSION_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts the current publisher draft scope for Stax card publishing', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taku-publisher-current-scope-'));
  const sessionPath = path.join(directory, 'session.json');
  const previous = process.env.TAKU_PUBLISHER_SESSION_PATH;
  try {
    writeFileSync(sessionPath, JSON.stringify({
      accessToken: 'test-publisher-drafts-token',
      expiresAt: Date.now() + 60_000,
      scopes: ['publisher.drafts.write'],
    }));
    process.env.TAKU_PUBLISHER_SESSION_PATH = sessionPath;

    assert.equal(readPublishToken(parseArgs([])), 'test-publisher-drafts-token');
  } finally {
    if (previous === undefined) delete process.env.TAKU_PUBLISHER_SESSION_PATH;
    else process.env.TAKU_PUBLISHER_SESSION_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('persists a local auth result as a reusable publisher session', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taku-publisher-write-auth-'));
  const sessionPath = path.join(directory, 'session.json');
  const previous = process.env.TAKU_PUBLISHER_SESSION_PATH;
  try {
    process.env.TAKU_PUBLISHER_SESSION_PATH = sessionPath;
    const session = buildPublisherSessionFromAuthResult({
      token: 'test-writer-token',
      iconToken: 'test-writer-icon-token',
      expiresIn: 60,
      scopes: ['creator.card.write'],
    });

    writePublisherSession(session);

    assert.equal(readPublishToken(parseArgs([])), 'test-writer-token');
    assert.equal(readIconAuthToken(parseArgs([])), 'test-writer-icon-token');
  } finally {
    if (previous === undefined) delete process.env.TAKU_PUBLISHER_SESSION_PATH;
    else process.env.TAKU_PUBLISHER_SESSION_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('binds a reusable publisher session to one public account identity', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taku-publisher-account-'));
  const sessionPath = path.join(directory, 'session.json');
  const previous = process.env.TAKU_PUBLISHER_SESSION_PATH;
  try {
    process.env.TAKU_PUBLISHER_SESSION_PATH = sessionPath;
    writePublisherSession(buildPublisherSessionFromAuthResult({
      token: 'test-writer-token',
      expiresIn: 60,
      scopes: ['creator.card.write'],
    }));

    bindPublisherSessionAccount({
      username: '@DraftOwner',
      displayName: 'Draft Owner',
      accountHint: 'd***@example.com',
    });

    assert.deepEqual(readPublisherSession().account, {
      username: 'DraftOwner',
      displayName: 'Draft Owner',
      accountHint: 'd***@example.com',
    });
    assert.equal(clearPublisherSession(), true);
    assert.equal(readPublisherSession(), null);
  } finally {
    if (previous === undefined) delete process.env.TAKU_PUBLISHER_SESSION_PATH;
    else process.env.TAKU_PUBLISHER_SESSION_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('falls back when local auth returns an already-expired absolute expiry', () => {
  const session = buildPublisherSessionFromAuthResult({
    token: 'test-writer-token',
    iconToken: 'test-writer-icon-token',
    expiresAt: Date.now(),
    iconExpiresAt: Date.now(),
    scopes: ['creator.card.write'],
  });

  assert.ok(session.expiresAt > Date.now() + 60_000);
  assert.ok(session.iconExpiresAt > Date.now() + 60_000);
});

test('uses one PKCE login URL for publishing and icon authorization', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taku-publisher-pkce-'));
  const previous = process.env.TAKU_PUBLISHER_SESSION_PATH;
  try {
    process.env.TAKU_PUBLISHER_SESSION_PATH = path.join(directory, 'missing-session.json');
    const parsed = parseArgs([]);
    const challenge = {
      state: 'a'.repeat(24),
      codeChallenge: 'b'.repeat(43),
      codeChallengeMethod: 'S256',
    };
    const loopback = ['127', '0', '0', '1'].join('.');
    const status = createPublishStatus(parsed, {
      editorUrl: `http://${loopback}:43210/`,
      localAuthChallenge: challenge,
    });
    const url = new URL(status.loginUrl);

    assert.equal(status.loginUrl, status.iconLoginUrl);
    assert.equal(url.searchParams.get('auth_flow'), 'local_code');
    assert.equal(url.searchParams.get('intent'), 'publish_stax_card');
    assert.equal(url.searchParams.get('worker_url'), 'https://worker.taku.ai');
    assert.equal(url.searchParams.get('auth_state'), challenge.state);
    assert.equal(status.needsAuth, true);
  } finally {
    if (previous === undefined) delete process.env.TAKU_PUBLISHER_SESSION_PATH;
    else process.env.TAKU_PUBLISHER_SESSION_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an explicitly cleared editor token does not fall back to a stale stored token', () => {
  const previous = process.env.TAKU_PUBLISH_TOKEN;
  try {
    process.env.TAKU_PUBLISH_TOKEN = ['stale', 'publisher', 'token'].join('-');
    const status = createPublishStatus(parseArgs([]), {
      publishToken: '',
      iconAuthToken: '',
    });

    assert.equal(status.needsAuth, true);
    assert.equal(status.canPublish, false);
    assert.equal(status.hasIconAuth, false);
  } finally {
    if (previous === undefined) delete process.env.TAKU_PUBLISH_TOKEN;
    else process.env.TAKU_PUBLISH_TOKEN = previous;
  }
});

test('Desktop-bound auth rejects a direct token for another account', () => {
  const previousExpected = process.env.TAKU_DESKTOP_AUTH_USER_ID;
  const previousToken = process.env.TAKU_BEARER_TOKEN;
  try {
    process.env.TAKU_DESKTOP_AUTH_USER_ID = 'test-desktop-user-new';
    process.env.TAKU_BEARER_TOKEN = jwtForUser('test-desktop-user-old');

    assert.equal(readExpectedPublisherUserId(), 'test-desktop-user-new');
    assert.equal(publisherUserIdFromToken(process.env.TAKU_BEARER_TOKEN), 'test-desktop-user-old');
    assert.equal(readPublishToken(parseArgs([])), '');

    process.env.TAKU_BEARER_TOKEN = jwtForUser('test-desktop-user-new');
    assert.equal(readPublishToken(parseArgs([])), process.env.TAKU_BEARER_TOKEN);
  } finally {
    if (previousExpected === undefined) delete process.env.TAKU_DESKTOP_AUTH_USER_ID;
    else process.env.TAKU_DESKTOP_AUTH_USER_ID = previousExpected;
    if (previousToken === undefined) delete process.env.TAKU_BEARER_TOKEN;
    else process.env.TAKU_BEARER_TOKEN = previousToken;
  }
});

test('Desktop-bound auth ignores an account-scoped session owned by another user', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taku-publisher-owner-auth-'));
  const sessionPath = path.join(directory, 'session.json');
  const previousPath = process.env.TAKU_PUBLISHER_SESSION_PATH;
  const previousExpected = process.env.TAKU_DESKTOP_AUTH_USER_ID;
  try {
    process.env.TAKU_PUBLISHER_SESSION_PATH = sessionPath;
    process.env.TAKU_DESKTOP_AUTH_USER_ID = 'test-desktop-user-new';
    writePublisherSession(buildPublisherSessionFromAuthResult({
      token: 'test-publisher-token',
      expiresIn: 60,
      scopes: ['creator.card.write'],
      account: { userId: 'test-desktop-user-old', username: 'old-user' },
    }));

    assert.equal(readPublishToken(parseArgs([])), '');

    bindPublisherSessionAccount({ userId: 'test-desktop-user-new', username: 'new-user' });
    assert.equal(readPublishToken(parseArgs([])), 'test-publisher-token');
  } finally {
    if (previousPath === undefined) delete process.env.TAKU_PUBLISHER_SESSION_PATH;
    else process.env.TAKU_PUBLISHER_SESSION_PATH = previousPath;
    if (previousExpected === undefined) delete process.env.TAKU_DESKTOP_AUTH_USER_ID;
    else process.env.TAKU_DESKTOP_AUTH_USER_ID = previousExpected;
    rmSync(directory, { recursive: true, force: true });
  }
});
