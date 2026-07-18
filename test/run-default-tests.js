'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function nodeMajor(command) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  const match = probe.status === 0 && /v(\d+)\./.exec(probe.stdout || '');
  return match ? Number(match[1]) : 0;
}

function supportsTestForceExit(command) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  const match = probe.status === 0 && /v(\d+)\.(\d+)\./.exec(probe.stdout || '');
  if (!match) {return false;}
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major >= 22 || (major === 20 && minor >= 14);
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

const allRootTestFiles = fs.readdirSync(__dirname)
  .sort()
  .filter(file => file.endsWith('.test.js'))
  // Lifecycle E2E is an integration gate. Keeping it out of the fast default
  // suite prevents review/checkpoint verification from repeatedly running it.
  .filter(file => file !== 'e2e-mission-lifecycle.test.js')
  // This suite exercises a real agent runner and is likewise integration-only.
  .filter(file => file !== 'e2e-real-agent-smoke.test.js');

// These markers identify tests that cross a real process, Git/worktree,
// package, or network boundary. Keep that coverage intact, but run it only
// through the explicit integration command rather than the hermetic default.
const boundaryDependencyPattern = /\b(?:\w+\.)?(?:spawnSync|spawn|execSync|execFileSync|fork)\s*\(|git\s+(?:init|worktree|clone|commit|checkout|rebase|merge)|npm\s+(?:pack|install)|createServer|\bfetch\s*\(/;
const knownIntegrationTestFiles = new Set([
  // Measured at 55.7s in the CP-1 uncontended run; it drives draft workflow
  // fixtures across the command boundary even though its process launcher is
  // dependency-injected in the source.
  'draft.test.js',
  'draft-command.test.js',
  'draft_preflight_modern.test.js',
  'durable-state-policy.test.js',
  'mission-start.test.js',
  // The final CP-3 timing capture found these groups still crossing the
  // Forgejo/worktree, agent-launcher, rebase, or review-artifact boundary.
  // Their fakes protect assertions but do not make the groups hermetic.
  'forgejo.test.js',
  'forgejo-independence.test.js',
  'mission-utils-worktree.test.js',
  'mistral.test.js',
  // This suite injects its launcher but deliberately invokes a real Node
  // child process to verify stdout and pipe-buffer behavior.
  'opencode-export.test.js',
  'runtime-matrix.test.js',
  'rebase_hardening.test.js',
  'review-artifacts.test.js',
  'review-commands-additional.test.js',
  'review-commands-supplemental.test.js',
  'review-identity.test.js',
  'review-identity-placeholder.test.js',
  'review.test.js',
  'review-prompts.test.js',
  'task-1416-repro.test.js'
]);
const integrationTestFiles = allRootTestFiles
  .filter(file => knownIntegrationTestFiles.has(file)
    || boundaryDependencyPattern.test(fs.readFileSync(path.join(__dirname, file), 'utf8')))
  .map(file => path.join(__dirname, file));
const defaultTestFiles = allRootTestFiles
  .filter(file => !integrationTestFiles.includes(path.join(__dirname, file)))
  .map(file => path.join(__dirname, file));
const requestedArgs = process.argv.slice(2);
const runsIntegrationSuite = requestedArgs.includes('--integration');
const requestedTestFiles = requestedArgs.filter(arg => arg !== '--integration');
const testFiles = runsIntegrationSuite
  ? integrationTestFiles
  : (requestedTestFiles.length > 0 ? requestedTestFiles : defaultTestFiles);
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
const testNode = resolveTestNode();
const testForceExitArgs = supportsTestForceExit(testNode)
  // This flag was added in Node 20.14 and Node 22.0. Keep the declared Node
  // >=20 range runnable while still ensuring supported newer runtimes return
  // control once the test runner has printed its final result.
  ? ['--test-force-exit']
  : [];

const result = spawnSync(
  testNode,
  [
    ...bootstrapArgs,
    ...testForceExitArgs,
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
