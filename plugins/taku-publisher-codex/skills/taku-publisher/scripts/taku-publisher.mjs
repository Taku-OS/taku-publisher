#!/usr/bin/env node

import { main } from '@taku/publisher-runtime/cli';

process.exitCode = await main();
