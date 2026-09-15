import Module, { register } from 'node:module';

const CJS_PATCH_MARKER = Symbol.for('taku.test-server-only-cjs-hook');
const CJS_SERVER_ONLY_NOOP = Object.freeze({});

if (!Module._load[CJS_PATCH_MARKER]) {
  const originalLoad = Module._load;
  function testServerOnlyLoad(...args) {
    if (args[0] === 'server-only') return CJS_SERVER_ONLY_NOOP;
    return Reflect.apply(originalLoad, this, args);
  }
  Object.defineProperty(testServerOnlyLoad, CJS_PATCH_MARKER, { value: true });
  Module._load = testServerOnlyLoad;
}

register('./test-server-only-loader.mjs', import.meta.url);
