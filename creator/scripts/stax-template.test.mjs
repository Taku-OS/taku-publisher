import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { buildStaxAppModel, fillStaxStudioLayout, renderStaxStudioRuntime } from './editor-renderer.mjs';
import { resolveStudioAssets } from './studio-assets.mjs';
import { splitStudioRuntime } from './sync-stax-studio-template.mjs';

const external = renderStaxStudioRuntime({ externalStudioAssets: true });
const standalone = renderStaxStudioRuntime();

test('website and standalone runtimes use equivalent component code and assets', () => {
  assert.equal(resolveStudioAssets(external), standalone);
  assert.doesNotMatch(standalone, /(?:href|src)="\/studio\/|url\(["']?\/studio\//);
  assert.doesNotMatch(standalone, /href="https:\/\/fonts\./);
  for (const file of readdirSync(new URL('../assets/studio/', import.meta.url))) {
    if (/\.(?:css|js)$/.test(file)) assert.ok(standalone.includes(`data-studio-asset="${file}"`), file);
  }
  for (const script of standalone.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test('handoff splitting never keeps a generated display model or duplicate injections', () => {
  const parts = splitStudioRuntime(external);
  assert.doesNotMatch(parts.template, /window\.__TAKU_STAX_DATA__ =|^Object\.assign\(ART,/m);
  assert.doesNotMatch(parts.template, /taku-cloud-studio-bridge|taku-cloud-studio-style/);
  assert.ok(parts.template.includes('/* __TAKU_STAX_BOOTSTRAP_START__ */'));
  assert.ok(parts.bootstrap.includes('window.__TAKU_STAX_BOOTSTRAP__'));
  new vm.Script(parts.bootstrap);
  new vm.Script(parts.bridge);
});

test('new real-data layouts agree with the v9.2 catalog and cannot invent blocks', () => {
  const available = ['hero', 'type', 'social', 'modelcost', 'clock', 'tools', 'heat', 'pie', 'team', 'basic', 'seal', 'ctxring', 'trend'];
  const blocks = available.map(key => ({ key, status: 'partial', value: { models: [], tools: [{ name: 'Local skill' }] } }));
  const model = buildStaxAppModel({ staxBlocks: { blocks } });
  const cells = new Set();
  for (const block of model.studioLayout.blocks) {
    assert.ok(available.includes(block.key));
    assert.ok(block.cx >= 0 && block.cy >= 0 && block.cx + block.cw <= 8 && block.cy + block.ch <= 5);
    for (let x = block.cx; x < block.cx + block.cw; x++) for (let y = block.cy; y < block.cy + block.ch; y++) {
      assert.ok(!cells.has(`${x},${y}`)); cells.add(`${x},${y}`);
    }
  }
  assert.deepEqual(model.selectedKeys, model.studioLayout.blocks.map(block => block.key));
  assert.equal(cells.size, 40);
  const social = model.blocks.find(block => block.key === 'social');
  const cost = model.blocks.find(block => block.key === 'modelcost');
  assert.deepEqual(social.size, [2, 1]);
  assert.deepEqual(cost.size, [1, 1]);
});

test('layout filling retains usable hero/type anchors and ignores invalid saved anchors', () => {
  const model = { blocks: ['hero', 'type', 'social', 'modelcost'].map(key => ({ key, status: 'supported' })) };
  const layout = fillStaxStudioLayout(model, { blocks: [{ key: 'hero', cx: 0, cy: 0 }, { key: 'type', cx: 6, cy: 3 }] });
  assert.deepEqual(layout.blocks.find(block => block.key === 'hero'), { key: 'hero', cx: 0, cy: 0, cw: 4, ch: 2 });
  assert.deepEqual(layout.blocks.find(block => block.key === 'type'), { key: 'type', cx: 6, cy: 3, cw: 2, ch: 2 });
  const repaired = fillStaxStudioLayout(model, { blocks: [{ key: 'hero', cx: -4, cy: 20 }] });
  assert.ok(repaired.blocks.every(block => block.cx >= 0 && block.cy >= 0 && block.cy + block.ch <= 5));
});

test('v9.2 components render supplied data and escape connected social identities', () => {
  const source = readFileSync(new URL('../templates/stax-app.html', import.meta.url), 'utf8');
  const renderers = source.slice(source.indexOf('const ART ='), source.indexOf('/* ============ TOY BOX STUDIO'));
  const context = vm.createContext({ window: { location: { search: '' } }, CURP: 'publisher', URLSearchParams, Intl });
  new vm.Script(renderers + '\n' + source.match(/^function safeText[^\n]+/m)[0]).runInContext(context);
  const render = (key, value) => {
    context.pd = value;
    return vm.runInContext(`PD=pd;R.${key}(200,96)`, context);
  };
  const cost = render('modelcost', { modelcost: { totalUsd: 12.34, coverageRatio: 0.72, partial: true } });
  assert.match(cost, /12\.34/);
  assert.match(cost, /PARTIAL · 72% PRICED/);
  const social = render('social', { social: { github: '<real-gh>', x: '@real-x' } });
  assert.ok(social.includes('&lt;real-gh&gt;'));
  assert.ok(social.includes('@real-x'));
  assert.ok(!social.includes('mason'));
});
