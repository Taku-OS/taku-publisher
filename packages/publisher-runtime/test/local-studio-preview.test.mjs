import assert from 'node:assert/strict';
import test from 'node:test';
import { creatorCommandMode, creatorLocalStudioPreviewEditorUrl } from '../dist/cli.js';

test('local Studio preview bypasses cloud saving and interactive authorization', () => {
  for (const [command, args] of [
    ['draft', ['--editor', '--local-studio-preview', 'http://127.0.0.1:3003']],
    ['editor', ['--local-studio-preview=http://127.0.0.1:3003']],
  ]) {
    assert.deepEqual(creatorCommandMode(command, args), { localEditor: false, cloudStudio: false, requiresAuth: false });
  }
});

test('runtime only opens a local Studio session at the requested origin', () => {
  const url = 'http://127.0.0.1:3003/studio-preview?mode=publisher&session=test';
  assert.equal(creatorLocalStudioPreviewEditorUrl({ editorUrl: url }, ['--local-studio-preview', '--json']), url);
  assert.equal(creatorLocalStudioPreviewEditorUrl({ editorUrl: url }, ['--local-studio-preview=http://localhost:3003']), '');
  assert.equal(creatorLocalStudioPreviewEditorUrl({ editorUrl: 'https://taku.ai/studio-preview?mode=publisher&session=test' }, []), '');
  assert.equal(creatorLocalStudioPreviewEditorUrl({ editorUrl: 'http://127.0.0.1:3003/studio-preview?mode=demo' }, []), '');
});
