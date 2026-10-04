// TASK-2591 (ADR 0062): coverage-gate.ts keeps only the coverage population
// and the LCOV union; the native Node coverage contract that replaced c8 is
// asserted through the runner's argv here.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { coverageTestFiles, discoverTestFiles, mergeLcov, normalizeLcov } from '../../../../src/adapters/verification/coverage-gate.js';
import { buildTestRunPlan, COVERAGE_EXCLUDES, COVERAGE_INCLUDES, withCoverageReporters } from '../../../lib/test-run-plan.js';

const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..', '..');

test('coverage-gate includes its own test file in authoritative discovery', () => {
  const testFiles = discoverTestFiles();
  const basenames = testFiles.map(file => path.basename(file));
  assert.ok(basenames.includes('coverage-gate.test.ts'));
  assert.ok(basenames.includes('real-agent-smoke.test.ts'));
  assert.ok(!coverageTestFiles().some(file => /\/e2e\/(?:agents\/real-agent-smoke|lifecycle\/mission-lifecycle)\.test\.ts$/.test(file)));
  assert.ok(coverageTestFiles().some(file => /review-loop-presentation-contract\.test\.ts$/.test(file)));
});

test('native coverage keeps the historical c8 contract: src denominator, unloaded files, exclusions, source maps', () => {
  const plan = buildTestRunPlan({ executionRoot: REPO_ROOT, requestedArgs: ['--integration-ci'], probeNodeVersion: () => 'v26.7.0', coverage: true });
  const args = withCoverageReporters(plan.nodeArgs, 'coverage/.lcov-integration-ci.info');
  const coverageArgs = args.slice(0, args.indexOf('--test'));
  assert.deepEqual(COVERAGE_INCLUDES, ['src/**/*.ts']);
  assert.deepEqual(COVERAGE_EXCLUDES, ['test/**', 'prompts/**', 'config/*.json', '.workflow/**', 'node_modules/**']);
  for (const flag of [
    '--enable-source-maps',
    '--experimental-test-coverage',
    '--test-coverage-include-all',
    '--test-coverage-include=src/**/*.ts',
    ...COVERAGE_EXCLUDES.map(pattern => `--test-coverage-exclude=${pattern}`),
    '--test-coverage-lines=0',
    '--test-reporter=lcov',
    '--test-reporter-destination=coverage/.lcov-integration-ci.info',
  ]) {
    assert.ok(coverageArgs.includes(flag), `coverage argv carries ${flag}`);
  }
});

test('coverage runs require Node 26.7+ for --test-coverage-include-all', () => {
  const options = { executionRoot: REPO_ROOT, requestedArgs: [], coverage: true };
  const previous = process.env.PARALLIX_TEST_NODE;
  delete process.env.PARALLIX_TEST_NODE;
  try {
    assert.throws(
      () => buildTestRunPlan({ ...options, probeNodeVersion: () => 'v26.6.0' }),
      /Node 26\.7\+ is required for coverage runs/,
    );
    assert.doesNotThrow(() => buildTestRunPlan({ ...options, probeNodeVersion: () => 'v26.7.0' }));
    assert.doesNotThrow(() => buildTestRunPlan({ ...options, coverage: false, probeNodeVersion: () => 'v24.15.0' }));
  } finally {
    if (previous !== undefined) { process.env.PARALLIX_TEST_NODE = previous; }
  }
});

test('coverage fragments can omit unloaded sources while retaining instrumentation and source maps', () => {
  const args = withCoverageReporters(['--test', 'test/example.test.ts'], 'isolated.lcov', { includeAll: false });
  assert.ok(!args.includes('--test-coverage-include-all'));
  for (const flag of ['--experimental-test-coverage', '--enable-source-maps',
    '--test-coverage-include=src/**/*.ts', '--test-reporter=lcov',
    '--test-reporter-destination=isolated.lcov']) {
    assert.ok(args.includes(flag));
  }
  assert.deepEqual(args.slice(args.indexOf('--test')), ['--test', 'test/example.test.ts']);
});

test('normalizeLcov unions duplicate worker records by source line', () => {
  const normalized = normalizeLcov('SF:src/example.ts\nDA:1,0\nDA:2,3\nend_of_record\nSF:src/example.ts\nDA:1,2\nDA:2,0\nend_of_record\n');
  assert.equal(normalized, 'SF:src/example.ts\nDA:1,2\nDA:2,3\nLF:2\nLH:2\nend_of_record\n');
  assert.equal(normalizeLcov(''), '');
});

// TASK-2547: this behavior-owned coverage suite absorbs the former
// task-2547-coverage-merge regression. The hosted ci-required job unions the
// per-tier LCOV fragments via scripts/coverage-merge.ts -> mergeLcov(). These
// cases pin the multi-fragment union correctness SC4 forbids raw concatenation
// for: overlapping source/line records keep the larger hit count with no
// duplicated DA: record, LF/LH are recomputed from the union, distinct SF:
// files stay separate, and empty input yields "".
test('mergeLcov unions duplicate records across fragments with no DA: duplication', () => {
  const fragmentA = 'SF:src/a.ts\nDA:1,0\nDA:2,3\nend_of_record\n';
  const fragmentB = 'SF:src/a.ts\nDA:1,2\nDA:2,0\nend_of_record\n';
  const merged = mergeLcov([fragmentA, fragmentB]);
  // DA:1 keeps the larger hit (2), DA:2 keeps the larger hit (3); one DA: per
  // line, no concatenated duplicate records.
  assert.equal(merged, 'SF:src/a.ts\nDA:1,2\nDA:2,3\nLF:2\nLH:2\nend_of_record\n');
});

test('mergeLcov recomputes LF/LH from the union and keeps distinct files separate', () => {
  const fragmentA = 'SF:src/a.ts\nDA:1,5\nend_of_record\n';
  const fragmentB = 'SF:src/b.ts\nDA:1,7\nend_of_record\n';
  const merged = mergeLcov([fragmentA, fragmentB]);
  assert.equal(
    merged,
    'SF:src/a.ts\nDA:1,5\nLF:1\nLH:1\nend_of_record\n' +
    'SF:src/b.ts\nDA:1,7\nLF:1\nLH:1\nend_of_record\n',
  );
});

test('mergeLcov handles a line zero-hit in both fragments and empty input', () => {
  const fragmentA = 'SF:src/a.ts\nDA:1,0\nDA:2,0\nend_of_record\n';
  const merged = mergeLcov([fragmentA]);
  // Both lines are zero-hit: LF counts them, LH counts only covered lines.
  assert.equal(merged, 'SF:src/a.ts\nDA:1,0\nDA:2,0\nLF:2\nLH:0\nend_of_record\n');
  assert.equal(mergeLcov([]), '');
});
