/**
 * test-categories.test.ts — TASK-2500.04.
 *
 * Guards the verification-tier contract: every integration-layer test file
 * carries an explicit category, the GitHub-safe lane is positively selected, and
 * a prohibited workstation dependency cannot enter that lane by default.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildTestRunPlan } from './lib/test-run-plan.js';
import {
  AGENT_E2E_TESTS,
  INTEGRATION_CI_TESTS,
  INTEGRATION_LOCAL_TESTS,
  INTEGRATION_LOCAL_REASONS,
  PROHIBITED_CI_DEPENDENCY_MARKERS,
  integrationCategoryOf,
} from './lib/test-categories.js';

const executionRoot = path.join(import.meta.dirname, '..');
const testRoot = path.join(executionRoot, 'test');

function selected(args: string[]): string[] {
  const plan = buildTestRunPlan({
    executionRoot,
    requestedArgs: args,
    probeNodeVersion: () => process.version,
  });
  return plan.nodeArgs
    .slice(plan.nodeArgs.indexOf('--test') + 1)
    .map(file => path.relative(testRoot, file))
    .sort();
}

test('every integration-layer test file carries an explicit verification category', () => {
  const unclassified = selected(['--integration']).filter(file => integrationCategoryOf(file) === null);
  assert.deepEqual(
    unclassified,
    [],
    'each file listed above crosses a real boundary but has no category. Add it to '
    + 'INTEGRATION_CI_TESTS (clean GitHub-hosted runner is enough) or to '
    + 'INTEGRATION_LOCAL_TESTS plus INTEGRATION_LOCAL_REASONS (needs workstation tooling) '
    + 'in test/lib/test-categories.ts.',
  );
});

test('an unclassified integration test cannot enter the GitHub-safe lane', () => {
  // Positive membership, stated as a property of the selection rather than of
  // today's inventory: the CI lane is a subset of the declared CI registry, so a
  // newly authored boundary test is absent from it until somebody lists it.
  const ciLane = selected(['--integration-ci']);
  const undeclared = ciLane.filter(file => !INTEGRATION_CI_TESTS.includes(file));
  assert.deepEqual(undeclared, [], 'the CI lane may only run files declared in INTEGRATION_CI_TESTS');
  assert.ok(ciLane.length > 0, 'the CI lane must not be empty');

  // The same property from the other direction: a hypothetical new boundary file
  // is classified by the runner as integration, and is not in the CI lane.
  const hypothetical = 'task-0000-unclassified.integration.test.ts';
  assert.equal(integrationCategoryOf(hypothetical), null);
  assert.ok(!ciLane.includes(hypothetical));
});

test('the CI and local integration lanes partition the integration layer', () => {
  const all = selected(['--integration']);
  const ci = selected(['--integration-ci']);
  const local = selected(['--integration-local']);
  assert.deepEqual([...ci, ...local].sort(), all, 'every integration file runs in exactly one tier');
  assert.deepEqual(ci.filter(file => local.includes(file)), [], 'the tiers must not overlap');
  for (const file of [...INTEGRATION_CI_TESTS, ...INTEGRATION_LOCAL_TESTS]) {
    assert.ok(fs.existsSync(path.join(testRoot, file)), `${file} is registered but does not exist`);
  }
});

test('every local-only integration test records why a clean runner cannot run it', () => {
  for (const file of INTEGRATION_LOCAL_TESTS) {
    const reason = INTEGRATION_LOCAL_REASONS[file];
    assert.ok(
      typeof reason === 'string' && reason.trim().length > 0,
      `${file} must record its environmental boundary in INTEGRATION_LOCAL_REASONS`,
    );
  }
  assert.deepEqual(
    Object.keys(INTEGRATION_LOCAL_REASONS).sort(),
    [...INTEGRATION_LOCAL_TESTS].sort(),
    'INTEGRATION_LOCAL_REASONS and INTEGRATION_LOCAL_TESTS must describe the same files',
  );
});

test('prohibited workstation dependencies cannot enter the GitHub-safe lane', () => {
  const violations: string[] = [];
  for (const file of selected(['--integration-ci'])) {
    const source = fs.readFileSync(path.join(testRoot, file), 'utf8');
    for (const { pattern, reason } of PROHIBITED_CI_DEPENDENCY_MARKERS) {
      if (pattern.test(source)) { violations.push(`${file}: ${reason}`); }
    }
  }
  assert.deepEqual(violations, [], 'move these files to INTEGRATION_LOCAL_TESTS');
});

test('the real-agent and lifecycle suites stay out of the unit and integration lanes', () => {
  const lanes = [selected([]), selected(['--integration'])];
  for (const file of AGENT_E2E_TESTS) {
    assert.ok(fs.existsSync(path.join(testRoot, file)), `${file} must remain runnable`);
    for (const lane of lanes) {
      assert.ok(!lane.includes(file), `${file} belongs to the agent-e2e lane only`);
    }
  }
});

test('the verification tiers have stable npm commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(executionRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:integration:ci'], 'FORCE_COLOR=0 tsx test/run-default-tests.ts --integration-ci');
  assert.equal(pkg.scripts['test:integration:local'], 'FORCE_COLOR=0 tsx test/run-default-tests.ts --integration-local');
  assert.equal(pkg.scripts['test:agent-e2e'], 'node --import tsx test/e2e-real-agent-smoke.test.ts');
  assert.equal(pkg.scripts['test:lifecycle-e2e'], 'node --import tsx test/e2e-mission-lifecycle.test.ts');
  // The GitHub-safe aggregate covers build, typecheck, hermetic unit tests, the
  // deterministic integration subset, and portable package/bundle validation.
  const ciAggregate = String(pkg.scripts['test:ci']);
  for (const step of ['npm run typecheck', 'npm run build', 'npm test', 'npm run test:integration:ci', 'npm run test:bundle', 'npm run test:package-content']) {
    assert.ok(ciAggregate.includes(step), `test:ci must run ${step}`);
  }
  // The local integration gate keeps running the whole integration layer.
  assert.equal(pkg.scripts['test:integration'], 'FORCE_COLOR=0 tsx test/run-default-tests.ts --integration');
});
