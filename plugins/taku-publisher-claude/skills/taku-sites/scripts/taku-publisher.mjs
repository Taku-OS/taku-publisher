#!/usr/bin/env node

import { main } from '@taku/publisher-runtime/cli';
import { readFile } from 'node:fs/promises';

if (process.argv.length === 3 && process.argv[2] === '--version') {
  const release = JSON.parse(await readFile(new URL('../publisher-version.json', import.meta.url), 'utf8')
    .catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return readFile(new URL('../adapters/codex/taku-publisher/.codex-plugin/plugin.json', import.meta.url), 'utf8');
    }));
  console.log(`${release.name} ${release.version} (${release.channel || 'standard'})`);
} else {
  process.exitCode = await main();
}
