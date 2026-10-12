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

for (const selectionSyntax of ['legacy', 'hasSelectedKeys']) {
  test(`imported ${selectionSyntax} bootstrap restores saved layouts and distinguishes empty from missing`, () => {
    let handoff = external
      .replace('  const hasSelectedKeys = Array.isArray(data.selectedKeys);\n', '')
      .replace('hasSelectedKeys ? data.selectedKeys : supportedKeys', 'Array.isArray(data.selectedKeys) && data.selectedKeys.length ? data.selectedKeys : supportedKeys')
      .replace(/^    fullset:.*,$/m, '    fullset: selected.length ? selected : ["hero", "team", "type"],')
      .replace(/^    layout:.*,$/m, '    layout: selected.length ? null : {hero:[2,1],team:[3,0],type:[6,1]},');
    if (selectionSyntax === 'hasSelectedKeys') {
      handoff = handoff
        .replace('  const selected =', '  const hasSelectedKeys = Array.isArray(data.selectedKeys);\n  const selected =')
        .replace('Array.isArray(data.selectedKeys) && data.selectedKeys.length ? data.selectedKeys : supportedKeys', 'hasSelectedKeys ? data.selectedKeys : supportedKeys')
        .replace('selected.length ? selected', 'hasSelectedKeys || selected.length ? selected')
        .replace('selected.length ? null', 'hasSelectedKeys || selected.length ? null');
    }
    const { bootstrap } = splitStudioRuntime(handoff);
    const savedBlocks = [{ key: 'hero', cx: 4, cy: 3 }, { key: 'team', cx: 1, cy: 1 }];
    const cases = [
      { model: { selectedKeys: ['hero', 'team'], studioLayout: { blocks: savedBlocks } }, keys: ['hero', 'team'], layout: { hero: [4, 3], team: [1, 1] } },
      { model: { studioLayout: { blocks: savedBlocks } }, keys: ['hero', 'team'], layout: { hero: [4, 3], team: [1, 1] } },
      { model: { selectedKeys: [] }, keys: [], layout: null },
      { model: { studioLayout: { blocks: [] } }, keys: [], layout: {} },
      { model: { selectedKeys: [], studioLayout: { blocks: [] } }, keys: [], layout: {} },
      { model: {}, keys: ['hero', 'team'], layout: null },
      { model: { blocks: [] }, keys: [], layout: null },
    ];
    for (const { model, keys, layout } of cases) {
      const context = vm.createContext({
        window: { __TAKU_STAX_DATA__: { blocks: [{ key: 'hero', status: 'supported' }, { key: 'team', status: 'partial' }, { key: 'type', status: 'unsupported' }], ...model } },
        document: { querySelectorAll: () => [], getElementById: () => null },
        ART: {}, MASON: {}, FALLBACK_LOGO: '', SIZES: { hero: [4, 2], team: [2, 1], type: [2, 2] },
        PERSONAS: {}, setPersona() {}, playIntro() {},
      });
      new vm.Script(bootstrap + '\nwindow.__TAKU_STAX_BOOTSTRAP__();').runInContext(context);
      const persona = JSON.parse(JSON.stringify(context.PERSONAS.publisher));
      assert.deepEqual(persona.fullset, keys);
      assert.deepEqual(persona.layout, layout);
    }
  });
}

test('handoff import rejects layout declarations it cannot normalize', () => {
  for (const field of ['fullset', 'layout']) {
    assert.throws(() => splitStudioRuntime(external.replace(new RegExp(`^    ${field}: .*,$`, 'm'), '')), /must declare exactly one/);
  }
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
