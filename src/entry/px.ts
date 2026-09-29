#!/usr/bin/env node

import { run } from '../composition/create-cli.js';
import { pinChildCli } from '../composition/child-cli.js';

export * from '../composition/create-cli.js';

pinChildCli(process.argv[1]);

run().then(code => {
  // A failed command can have live agent SDK handles after its recovery budget
  // is spent. The command has already closed its owned services at this point;
  // terminate so an operator-facing manual stop returns control to the shell.
  if (code !== 0) { process.exit(code); }
  process.exitCode ||= code;
}, error => {
  console.error(error);
  process.exit(1);
});
