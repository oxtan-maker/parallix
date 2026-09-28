// TASK-2590 — opt-in per-file timing profile. Disabled runs must keep the
// runner argv byte-for-byte; enabled runs must add one balanced reporter pair
// and emit machine-readable per-file records plus a duration-sorted summary.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestEvent } from 'node:test/reporters';
import { buildTestRunPlan, withCoverageReporters, withFileTimingReporter } from './lib/test-run-plan.js';
import { resolveFileTimingProfile, printFileTimingSummary, profileTierOf } from './lib/file-timing-profile.js';
import fileTimingReporter, { isFileCompletion, summarizeFileTimings, PROFILE_TIER_ENV } from './lib/file-timing-reporter.js';

const root = path.join(import.meta.dirname, '..');

function reporterFlags(args: readonly string[]) {
  return {
    reporters: args.filter(arg => arg.startsWith('--test-reporter=')),
    destinations: args.filter(arg => arg.startsWith('--test-reporter-destination=')),
  };
}

function completion(file: string, name: string, durationMs: number, nesting = 0, error?: Error): TestEvent {
  return {
    type: 'test:complete',
    data: { file, name, nesting, details: { duration_ms: durationMs, passed: error === undefined, ...(error ? { error } : {}) } },
  } as unknown as TestEvent;
}

test('task-2590: profiling is disabled unless PARALLIX_TEST_PROFILE opts in', () => {
  const nodeArgs = ['--test', 'test/a.test.ts'];
  for (const value of [undefined, '', '0', 'false', 'FALSE', '  ']) {
    const env = value === undefined ? {} : { PARALLIX_TEST_PROFILE: value };
    assert.equal(resolveFileTimingProfile({ executionRoot: root, requestedArgs: ['--integration-ci'], nodeArgs, env }), null, `value ${JSON.stringify(value)}`);
  }
});

test('task-2590: enabled profiling appends one balanced reporter pair for every tier and coverage mode', () => {
  const previous = process.env.GITHUB_ACTIONS;
  try {
    for (const github of [false, true]) {
      if (github) process.env.GITHUB_ACTIONS = 'true'; else delete process.env.GITHUB_ACTIONS;
      for (const requestedArgs of [[], ['--integration-ci']]) {
        const plan = buildTestRunPlan({ executionRoot: root, requestedArgs, probeNodeVersion: () => 'v24.15.0' });
        for (const coverage of [false, true]) {
          const base = coverage ? withCoverageReporters(plan.nodeArgs, 'coverage/x.info') : plan.nodeArgs;
          const profiled = withFileTimingReporter(base, 'file:///reporter.ts', '/tmp/profile.jsonl');
          const { reporters, destinations } = reporterFlags(profiled);
          const label = `${requestedArgs.join(' ') || 'unit'} coverage=${coverage} github=${github}`;
          assert.equal(reporters.length, destinations.length, label);
          assert.equal(reporters.at(-1), '--test-reporter=file:///reporter.ts', label);
          assert.equal(destinations.at(-1), '--test-reporter-destination=/tmp/profile.jsonl', label);
          // Existing console/coverage output is preserved, in order.
          const before = reporterFlags(base);
          assert.deepEqual(reporters.slice(0, -1).filter(r => r !== '--test-reporter=spec'), before.reporters, label);
          // Every non-reporter flag and the file list are untouched.
          const strip = (args: readonly string[]) => args.filter(arg => !arg.startsWith('--test-reporter') && arg !== '--disable-warning=MaxListenersExceededWarning');
          assert.deepEqual(strip(profiled), strip(base), label);
        }
      }
    }
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = previous;
  }
});

test('task-2590: resolveFileTimingProfile names the tier and a destination under the execution root', () => {
  const executionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'px-2590-profile-'));
  try {
    const profile = resolveFileTimingProfile({
      executionRoot,
      requestedArgs: ['--integration-ci'],
      nodeArgs: ['--test', 'x.test.ts'],
      env: { PARALLIX_TEST_PROFILE: '1' },
      now: new Date('2026-09-27T10:00:00.000Z'),
    });
    assert.ok(profile);
    assert.equal(profile.tier, 'integration-ci');
    assert.equal(profile.destination, path.join(executionRoot, 'tmp', 'test-profile', 'integration-ci-2026-09-27T10-00-00-000Z.jsonl'));
    assert.deepEqual(profile.env, { [PROFILE_TIER_ENV]: 'integration-ci' });
    assert.ok(fs.existsSync(path.dirname(profile.destination)));
    const explicit = resolveFileTimingProfile({ executionRoot, requestedArgs: [], nodeArgs: ['--test'], env: { PARALLIX_TEST_PROFILE: 'out/p.jsonl' } });
    assert.equal(explicit?.destination, path.join(executionRoot, 'out', 'p.jsonl'));
    assert.deepEqual(['unit', 'integration-local', 'integration'], [[], ['--integration-local'], ['--integration']].map(profileTierOf));
  } finally {
    fs.rmSync(executionRoot, { recursive: true, force: true });
  }
});

test('task-2590: only top-level per-file completions are profiled', () => {
  const cwd = '/repo';
  assert.equal(isFileCompletion(completion('/repo/test/a.test.ts', 'test/a.test.ts', 10), cwd), true);
  assert.equal(isFileCompletion(completion('/repo/test/a.test.ts', 'a subtest', 10), cwd), false);
  assert.equal(isFileCompletion(completion('/repo/test/a.test.ts', 'test/a.test.ts', 10, 1), cwd), false);
  assert.equal(isFileCompletion({ type: 'test:pass', data: { file: '/repo/test/a.test.ts', name: 'test/a.test.ts', nesting: 0 } } as unknown as TestEvent, cwd), false);
});

test('task-2590: reporter emits JSON Lines records and a duration-sorted summary', async () => {
  const previousTier = process.env[PROFILE_TIER_ENV];
  process.env[PROFILE_TIER_ENV] = 'integration-ci';
  const cwd = process.cwd();
  const events = [
    completion(path.join(cwd, 'test/fast.test.ts'), 'test/fast.test.ts', 12.34),
    completion(path.join(cwd, 'test/slow.test.ts'), 'inner', 999),
    completion(path.join(cwd, 'test/slow.test.ts'), 'test/slow.test.ts', 4567.89, 0, new Error('boom')),
  ];
  async function* source() { yield* events; }
  const lines: string[] = [];
  try {
    for await (const chunk of fileTimingReporter(source())) { lines.push(String(chunk)); }
  } finally {
    if (previousTier === undefined) delete process.env[PROFILE_TIER_ENV]; else process.env[PROFILE_TIER_ENV] = previousTier;
  }
  const records = lines.join('').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(records.slice(0, 2), [
    { type: 'file', tier: 'integration-ci', file: path.join('test', 'fast.test.ts'), durationMs: 12.3, passed: true },
    { type: 'file', tier: 'integration-ci', file: path.join('test', 'slow.test.ts'), durationMs: 4567.9, passed: false },
  ]);
  assert.deepEqual(records[2], summarizeFileTimings(records.slice(0, 2), 'integration-ci'));
  assert.deepEqual(records[2].files.map((entry: { file: string }) => entry.file), [path.join('test', 'slow.test.ts'), path.join('test', 'fast.test.ts')]);
  assert.equal(records[2].sumDurationMs, 4580.2);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-2590-summary-'));
  try {
    const destination = path.join(dir, 'p.jsonl');
    fs.writeFileSync(destination, lines.join(''));
    const printed: string[] = [];
    printFileTimingSummary(destination, 1, line => printed.push(line));
    assert.equal(printed.length, 2);
    assert.match(printed[1], /4568ms FAIL test[/\\]slow\.test\.ts$/);
    printed.length = 0;
    printFileTimingSummary(path.join(dir, 'missing.jsonl'), 1, line => printed.push(line));
    assert.match(printed[0], /no summary written/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
