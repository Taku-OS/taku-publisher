import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { clearActions, hasAction } from '@/lib/actions';

const ORIGINAL_CONTROL_TOKEN = process.env.TAKU_CONTROL_TOKEN;
const REGISTRATION_SENTINEL_ACTION = '__taku_internal:set-service-api-auth';
const ROUTE_SOURCE = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const ROUTE_FILE = ts.createSourceFile(
  'route.ts',
  ROUTE_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

function collectNodes<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T
): T[] {
  const matches: T[] = [];

  function visit(node: ts.Node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }

  visit(root);
  return matches;
}

function isCallNamed(node: ts.Node, name: string): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name
  );
}

function rpcRequest(
  token?: string,
  action = 'not-registered',
  params: Record<string, unknown> = {}
): Request {
  return new Request('http://127.0.0.1/__taku/rpc', {
    method: 'POST',
    headers: token ? { 'x-taku-control-token': token } : undefined,
    body: JSON.stringify({ action, params }),
  });
}

test('RPC route loads the Action registration module only inside POST after control auth', () => {
  const staticActionImports = ROUTE_FILE.statements.filter(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '@/actions/index'
  );
  assert.equal(staticActionImports.length, 0, 'route module evaluation must not register Actions');

  const cryptoImport = ROUTE_FILE.statements.find(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'node:crypto'
  );
  assert.ok(cryptoImport, 'control auth must import timingSafeEqual from node:crypto');
  assert.ok(
    cryptoImport.importClause?.namedBindings &&
      ts.isNamedImports(cryptoImport.importClause.namedBindings) &&
      cryptoImport.importClause.namedBindings.elements.some(
        (element) => (element.propertyName ?? element.name).text === 'timingSafeEqual'
      ),
    'control auth must use the genuine node:crypto timingSafeEqual'
  );

  const tokenMatcher = ROUTE_FILE.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'controlTokensMatch'
  );
  assert.ok(tokenMatcher?.body, 'route must define the control token matcher');
  assert.equal(
    collectNodes(tokenMatcher.body, (node) => isCallNamed(node, 'timingSafeEqual')).length,
    1,
    'the control token matcher must call timingSafeEqual'
  );

  const post = ROUTE_FILE.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'POST'
  );
  assert.ok(post?.body, 'route must export a POST handler');

  const actionImports = collectNodes(
    post.body,
    (node): node is ts.CallExpression =>
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === '@/actions/index'
  );
  assert.equal(
    actionImports.length,
    1,
    'authenticated POST must load the Action registration module'
  );
  const actionImport = actionImports[0];
  assert.ok(
    actionImport.parent && ts.isAwaitExpression(actionImport.parent),
    'Action registration import must be awaited'
  );

  const requiredTokenReads = collectNodes(
    post.body,
    (node): node is ts.PropertyAccessExpression =>
      ts.isPropertyAccessExpression(node) &&
      node.getText(ROUTE_FILE) === 'process.env.TAKU_CONTROL_TOKEN'
  );
  const headerReads = collectNodes(
    post.body,
    (node): node is ts.CallExpression =>
      ts.isCallExpression(node) &&
      node.expression.getText(ROUTE_FILE) === 'request.headers.get' &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'x-taku-control-token'
  );
  const matcherCalls = collectNodes(post.body, (node) => isCallNamed(node, 'controlTokensMatch'));
  assert.equal(requiredTokenReads.length, 1, 'POST must require TAKU_CONTROL_TOKEN');
  assert.equal(headerReads.length, 1, 'POST must read the Host control header');
  assert.equal(matcherCalls.length, 1, 'POST must validate the Host control header');

  const importPosition = actionImport.getStart(ROUTE_FILE);
  for (const authNode of [...requiredTokenReads, ...headerReads, ...matcherCalls]) {
    assert.ok(
      authNode.getStart(ROUTE_FILE) < importPosition,
      'Action registration must load only after control authentication'
    );
  }

  const registryCalls = collectNodes(
    post.body,
    (node): node is ts.CallExpression =>
      isCallNamed(node, 'hasAction') || isCallNamed(node, 'executeAction')
  );
  assert.equal(registryCalls.length, 2, 'POST must check and execute through the Action registry');
  for (const registryCall of registryCalls) {
    assert.ok(
      importPosition < registryCall.getStart(ROUTE_FILE),
      'Action registration must load before the registry is read or executed'
    );
  }
});

test('RPC keeps the Action registration root unloaded until genuine control authentication succeeds', async (t) => {
  t.after(() => {
    clearActions();
    if (ORIGINAL_CONTROL_TOKEN === undefined) {
      delete process.env.TAKU_CONTROL_TOKEN;
    } else {
      process.env.TAKU_CONTROL_TOKEN = ORIGINAL_CONTROL_TOKEN;
    }
  });

  clearActions();
  const { POST } = await import('./route');
  assert.equal(
    hasAction(REGISTRATION_SENTINEL_ACTION),
    false,
    'importing the route must not load the Action registration root'
  );

  delete process.env.TAKU_CONTROL_TOKEN;
  const unavailable = await POST(rpcRequest());
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    ok: false,
    error: 'control authentication unavailable',
  });
  assert.equal(
    hasAction(REGISTRATION_SENTINEL_ACTION),
    false,
    'missing auth must not load the Action registration root'
  );

  process.env.TAKU_CONTROL_TOKEN = '';
  const empty = await POST(rpcRequest());
  assert.equal(empty.status, 503);
  assert.equal(
    hasAction(REGISTRATION_SENTINEL_ACTION),
    false,
    'empty auth must not load the Action registration root'
  );

  process.env.TAKU_CONTROL_TOKEN = 'host-control-token';
  const missing = await POST(rpcRequest());
  assert.equal(missing.status, 401);
  assert.equal(
    hasAction(REGISTRATION_SENTINEL_ACTION),
    false,
    'missing control header must not load the Action registration root'
  );

  const invalid = await POST(rpcRequest('x'.repeat('host-control-token'.length)));
  assert.equal(invalid.status, 401);
  assert.equal(
    hasAction(REGISTRATION_SENTINEL_ACTION),
    false,
    'invalid control header must not load the Action registration root'
  );

  const accepted = await POST(rpcRequest('host-control-token'));
  assert.equal(accepted.status, 404);
  assert.deepEqual(await accepted.json(), {
    ok: false,
    error: 'Action not found: not-registered',
  });
  assert.equal(
    hasAction(REGISTRATION_SENTINEL_ACTION),
    true,
    'authenticated POST must load the Action registration root'
  );
});
