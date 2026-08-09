#!/usr/bin/env node
// Curl guard for the unit-test PATH (see bootstrap-parallix-home.js).
// `curl --version` stays available for command diagnostics; every other
// invocation is recorded at PARALLIX_TEST_CURL_MARKER and fails loudly so an
// unmocked Forgejo request cannot pass silently.
import fs from 'node:fs';
import cp from 'node:child_process';

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === '--version') {
  const result = cp.spawnSync(process.env.PARALLIX_TEST_REAL_CURL, args, { stdio: 'inherit' });
  process.exit(result.status || 0);
}

fs.writeFileSync(process.env.PARALLIX_TEST_CURL_MARKER, `${args.join(' ')}\n`, { flag: 'a' });
process.stderr.write('Unit test attempted an unmocked Forgejo curl request\n');
process.exit(97);
