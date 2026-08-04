#!/usr/bin/env node

import { run } from '../composition/create-cli.js';

export * from '../composition/create-cli.js';

run().then(code => {
  process.exitCode = code;
});
