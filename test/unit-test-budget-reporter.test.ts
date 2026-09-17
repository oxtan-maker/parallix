import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import unitTestBudgetReporter, { UNIT_TEST_BUDGET_MS, UNIT_TEST_HEADROOM_MS, onGitHubActions } from './lib/unit-test-budget-reporter.js';

test('unit-test budget reporter marks measured synchronous work over the bound', async () => {
  async function* events() {
    yield {
      type: 'test:pass' as const,
      data: {
        name: 'sync block', nesting: 0, testNumber: 1,
        details: { duration_ms: UNIT_TEST_BUDGET_MS + 1, type: 'test' as const },
        file: 'slow.test.ts', line: 1, column: 1,
      },
    };
  }

  let output = '';
  for await (const chunk of unitTestBudgetReporter(events())) { output += chunk; }
  assert.match(output, /\[unit-test-budget:exceeded\] sync block: 1001ms > 1000ms/);
});

test('unit-test budget reporter reports opted-in headroom without changing the hard cap', async () => {
  async function* events() {
    yield {
      type: 'test:pass' as const,
      data: {
        name: 'near-bound work', nesting: 0, testNumber: 1,
        details: { duration_ms: UNIT_TEST_HEADROOM_MS + 1, type: 'test' as const },
        file: 'headroom.test.ts', line: 1, column: 1,
      },
    };
  }

  const priorHeadroom = process.env.PARALLIX_UNIT_TEST_HEADROOM;
  process.env.PARALLIX_UNIT_TEST_HEADROOM = '1';
  try {
    let output = '';
    for await (const chunk of unitTestBudgetReporter(events())) { output += chunk; }
    assert.equal(UNIT_TEST_HEADROOM_MS, 500);
    assert.match(output, /\[unit-test-budget:headroom\] near-bound work: 501ms > 500ms/);
    assert.doesNotMatch(output, /\[unit-test-budget:exceeded\]/);
  } finally {
    if (priorHeadroom === undefined) { delete process.env.PARALLIX_UNIT_TEST_HEADROOM; }
    else { process.env.PARALLIX_UNIT_TEST_HEADROOM = priorHeadroom; }
  }
});

test('unit-test budget reporter stays silent on GitHub Actions runners', async () => {
  async function* events() {
    yield {
      type: 'test:pass' as const,
      data: {
        name: 'slow on a shared runner', nesting: 0, testNumber: 1,
        details: { duration_ms: UNIT_TEST_BUDGET_MS + 5_000, type: 'test' as const },
        file: 'slow.test.ts', line: 1, column: 1,
      },
    };
  }

  const priorGitHub = process.env.GITHUB_ACTIONS;
  const priorHeadroom = process.env.PARALLIX_UNIT_TEST_HEADROOM;
  process.env.GITHUB_ACTIONS = 'true';
  process.env.PARALLIX_UNIT_TEST_HEADROOM = '1';
  try {
    assert.equal(onGitHubActions(), true);
    // Feed several pass events: budget signals must be suppressed, but the
    // reporter must still FORWARD every event so node:test output is not
    // silenced on GitHub Actions (reviewer F1: a `return` in the generator
    // would have dropped all subsequent events).
    async function* multiEvents() {
      for (let i = 0; i < 5; i += 1) {
        yield {
          type: 'test:pass' as const,
          data: {
            name: `event ${i}`, nesting: 0, testNumber: i + 1,
            details: { duration_ms: UNIT_TEST_BUDGET_MS + 100, type: 'test' as const },
            file: 'slow.test.ts', line: 1, column: 1,
          },
        };
      }
    }
    let output = '';
    for await (const chunk of unitTestBudgetReporter(multiEvents())) { output += chunk; }
    assert.doesNotMatch(output, /\[unit-test-budget:exceeded\]/);
    assert.doesNotMatch(output, /\[unit-test-budget:headroom\]/);
    assert.ok(output.length > 0, 'reporter must forward node:test events on GitHub Actions');
    assert.match(output, /event 4/); // last event still forwarded
  } finally {
    if (priorGitHub === undefined) { delete process.env.GITHUB_ACTIONS; }
    else { process.env.GITHUB_ACTIONS = priorGitHub; }
    if (priorHeadroom === undefined) { delete process.env.PARALLIX_UNIT_TEST_HEADROOM; }
    else { process.env.PARALLIX_UNIT_TEST_HEADROOM = priorHeadroom; }
  }
});

test('GitHub Actions detection keys on the exact env value, not any GitHub-ish value', () => {
  const prior = process.env.GITHUB_ACTIONS;
  try {
    delete process.env.GITHUB_ACTIONS;
    assert.equal(onGitHubActions(), false);
    process.env.GITHUB_ACTIONS = 'false';
    assert.equal(onGitHubActions(), false);
    process.env.GITHUB_ACTIONS = '1';
    assert.equal(onGitHubActions(), false);
    process.env.GITHUB_ACTIONS = 'true';
    assert.equal(onGitHubActions(), true);
  } finally {
    if (prior === undefined) { delete process.env.GITHUB_ACTIONS; }
    else { process.env.GITHUB_ACTIONS = prior; }
  }
});

test('the suite-level budget check is gated on the shared GitHub Actions detection', () => {
  const runnerSource = fs.readFileSync(path.join(process.cwd(), 'test', 'run-default-tests.ts'), 'utf8');
  // Criterion 4: one detection, imported by both enforcement points.
  assert.match(runnerSource, /import \{[^}]*onGitHubActions[^}]*\} from '\.\/lib\/unit-test-budget-reporter\.js'/);
  // Criterion 2: the suite budget block does not run on GitHub Actions.
  assert.match(runnerSource, /if \(!runsIntegrationSuite && !onGitHubActions\(\)\)/);
  // Criterion 3: off GitHub the suite budget still fails the run.
  assert.match(runnerSource, /SUITE BUDGET EXCEEDED/);
  assert.match(runnerSource, /suiteExceeded = true/);
});
