'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MINIMUM_TEST_NODE_MAJOR = 20;

function nodeMajorVersion(executable) {
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  const match = result.status === 0 && String(result.stdout || '').match(/^v(\d+)/);
  return match ? Number(match[1]) : 0;
}

function compatibleTestNode() {
  const candidates = [process.env.PARALLIX_TEST_NODE, process.execPath];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) { candidates.push(path.join(dir, 'node')); }
  }
  const nvmNodeRoot = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    for (const version of fs.readdirSync(nvmNodeRoot)) {
      candidates.push(path.join(nvmNodeRoot, version, 'bin', 'node'));
    }
  } catch (_) {
    // nvm is optional; PATH and the current executable remain valid sources.
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) { continue; }
    seen.add(candidate);
    if (nodeMajorVersion(candidate) >= MINIMUM_TEST_NODE_MAJOR) {
      return candidate;
    }
  }
  throw new Error(`Node ${MINIMUM_TEST_NODE_MAJOR}+ is required for node:test; set PARALLIX_TEST_NODE to a compatible executable.`);
}

function supportsTestForceExit(command) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  const match = probe.status === 0 && /v(\d+)\.(\d+)\./.exec(probe.stdout || '');
  if (!match) {return false;}
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major >= 22 || (major === 20 && minor >= 14);
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
const testNode = compatibleTestNode();
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
