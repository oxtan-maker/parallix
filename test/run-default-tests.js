'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function nodeMajor(command) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  const match = probe.status === 0 && /v(\d+)\./.exec(probe.stdout || '');
  return match ? Number(match[1]) : 0;
}

// `npm` can be launched through an older nvm shim even when a supported Node
// is also on PATH. Node's built-in test runner requires Node 18+, while this
// package declares Node 20+; select the first compatible executable rather
// than recursively spawning the Node 14 process that invoked npm.
function resolveTestNode() {
  if (nodeMajor(process.execPath) >= 20) {return process.execPath;}
  const candidates = (process.env.PATH || '').split(path.delimiter)
    .filter(Boolean)
    .map(dir => path.join(dir, 'node'));
  for (const candidate of candidates) {
    if (candidate !== process.execPath && nodeMajor(candidate) >= 20) {
      return candidate;
    }
  }
  throw new Error('Parallix requires Node.js >=20 to run its test suite. Install a supported Node runtime or put it on PATH.');
}

const defaultTestFiles = fs.readdirSync(__dirname)
  .sort()
  .filter(file => file.endsWith('.test.js'))
  // Lifecycle E2E is an integration gate. Keeping it out of the fast default
  // suite prevents review/checkpoint verification from repeatedly running it.
  .filter(file => file !== 'e2e-mission-lifecycle.test.js')
  // This suite exercises a real agent runner and is likewise integration-only.
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
const runsLifecycleE2E = requestedTestFiles.some(
  file => path.basename(file) === 'e2e-mission-lifecycle.test.js'
);
const runsIntegrationE2E = runsRealAgentSmoke || runsLifecycleE2E;
const bootstrapArgs = runsIntegrationE2E
  ? []
  : ['--require', path.join(__dirname, 'bootstrap-parallix-home.js')];

const result = spawnSync(
  resolveTestNode(),
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
