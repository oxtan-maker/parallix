#!/usr/bin/env node

import { run } from '../composition/create-cli.js';
import { pinChildCli } from '../composition/child-cli.js';

export * from '../composition/create-cli.js';

pinChildCli(process.argv[1]);

run().then(code => {
  process.exitCode ||= code;
});
