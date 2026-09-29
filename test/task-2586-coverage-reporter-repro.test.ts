// TASK-2586 — Node pairs test reporters and destinations by index. GitHub
// suppresses the local timing reporter, so coverage must add a console reporter.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildTestRunPlan, withCoverageReporters } from './lib/test-run-plan.js';

const root = path.join(import.meta.dirname, '..');

function withGitHubActions<T>(callback: () => T): T {
  const previous = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = 'true';
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
  }
}

test('task-2586: GitHub coverage balances reporter and destination flags for unit and integration-ci', () => {
  for (const requestedArgs of [[], ['--integration-ci']]) {
    const plan = withGitHubActions(() => buildTestRunPlan({
      executionRoot: root,
      requestedArgs,
      probeNodeVersion: () => 'v24.15.0',
    }));
    const args = withCoverageReporters(plan.nodeArgs, 'coverage/test.info');
    assert.equal(
      args.filter(arg => arg.startsWith('--test-reporter=')).length,
      args.filter(arg => arg.startsWith('--test-reporter-destination=')).length,
      `${requestedArgs.join(' ') || 'unit'} has one destination per reporter`,
    );
    assert.deepEqual(args.filter(arg => arg.startsWith('--test-reporter-destination=')), [
      '--test-reporter-destination=stdout',
      '--test-reporter-destination=coverage/test.info',
    ]);
    assert.ok(args.includes('--test-reporter=spec'));
  }
});
