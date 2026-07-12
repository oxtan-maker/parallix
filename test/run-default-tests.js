'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const defaultTestFiles = fs.readdirSync(__dirname)
  .sort()
  .filter(file => file.endsWith('.test.js'))
  .filter(file => file !== 'e2e-real-agent-smoke.test.js')
  .map(file => path.join(__dirname, file));
const requestedTestFiles = process.argv.slice(2);
const testFiles = requestedTestFiles.length > 0 ? requestedTestFiles : defaultTestFiles;
// The real-agent smoke test deliberately reads the operator's configured Pi
// model/auth files and then copies them into its own disposable state root.
// Do not preload the unit-test HOME isolation shim for that explicit e2e run:
// the shim replaces HOME before the fixture can read the real Pi config.
const runsRealAgentSmoke = requestedTestFiles.some(
  file => path.basename(file) === 'e2e-real-agent-smoke.test.js'
);
const bootstrapArgs = runsRealAgentSmoke
  ? []
  : ['--require', path.join(__dirname, 'bootstrap-parallix-home.js')];

const result = spawnSync(
  process.execPath,
  [
    ...bootstrapArgs,
    '--test',
    ...testFiles
  ],
  {
    stdio: 'inherit',
    env: process.env
  }
);

if (result.error) {
  throw result.error;
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
