


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
test('task-2236 repro: npm test forwards the requested pi e2e smoke file', () => {
  // TASK-2328 moved suite selection and argv assembly into
  // test/lib/test-run-plan.ts; the runner delegates to it.
  const runnerSource = fs.readFileSync(
    path.join(import.meta.dirname, 'run-default-tests.ts'),
    'utf8'
  ) + fs.readFileSync(
    path.join(import.meta.dirname, 'lib', 'test-run-plan.ts'),
    'utf8'
  );

  assert.match(
    runnerSource,
    /requestedArgs: process\.argv\.slice\(2\)/,
    'npm test positional arguments must be read by the default test runner'
  );
  assert.match(
    runnerSource,
    /requestedTestFiles = requestedArgs\.filter\(arg => arg !== '--integration'\);/,
    'the default test runner must normalize the integration flag out of positional arguments'
  );
  assert.match(
    runnerSource,
    /requestedTestFiles\.length > 0 \? requestedTestFiles : defaultTestFiles/,
    'an explicit e2e test path must replace the default suite rather than be ignored'
  );
  assert.match(
    runnerSource,
    /const runsRealAgentSmoke = requestedTestFiles\.some/,
    'the real-agent e2e must not inherit the unit-test HOME isolation shim'
  );

  const smokeSource = fs.readFileSync(
    path.join(import.meta.dirname, 'e2e-real-agent-smoke.test.ts'),
    'utf8'
  );
  assert.match(
    smokeSource,
    /LOCAL_PI_E2E_API_KEY/,
    'the isolated pi configuration must replace a placeholder local-provider key'
  );
  assert.match(
    smokeSource,
    /\.nvm', 'versions', 'node'/,
    'the real smoke must discover Pi installed under nvm even when its process lacks NVM_BIN'
  );
  assert.match(
    smokeSource,
    /env\.PI_BIN = path\.join\(repo\.binDir, 'pi'\)/,
    'the Pi smoke must pin the launcher to its exact fixture symlink'
  );
  assert.match(
    smokeSource,
    /env\.PI_CODING_AGENT_DIR = repo\.piAgentHome/,
    'the Pi smoke must pin mutable Pi state to its disposable copied configuration'
  );
});
