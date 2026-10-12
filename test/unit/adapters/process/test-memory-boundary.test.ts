// Policy, capability and report contracts of the test-runner memory boundary
// (TASK-2722). The real cgroup behavior is proven by
// test/integration/test-harness/runner-memory-containment.test.ts; these cases
// use injected doubles only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_LIMIT_MIB, MIN_LIMIT_MIB, MemoryBoundaryConfigError, classifyWorkload, formatBreachReport, resolveMemoryBoundaryPolicy,
  type PolicyInput,
} from '../../../../src/adapters/process/test-memory-policy.js';
import {
  MemoryBoundaryUnavailableError, assertCgroupEnforcement, defaultUserRuntimeDir, forgetScope, readScopeSample, scopeCgroupDir, scopeResult, watchScope, wrapInScope,
} from '../../../../src/adapters/process/test-memory-cgroup.js';

const HOST_MIB = 32768;
function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return { boundaryMode: undefined, limitMiB: undefined, workload: 'unit', hostedRunner: false, platform: 'linux', totalMemoryMiB: HOST_MIB, ...overrides };
}

test('every workload default is a finite limit above the minimum and within a typical host (TASK-2722)', () => {
  for (const [workload, limit] of Object.entries(DEFAULT_LIMIT_MIB)) {
    assert.ok(Number.isSafeInteger(limit) && limit >= MIN_LIMIT_MIB && limit <= HOST_MIB, `${workload}=${limit}`);
  }
});

test('the default policy is an enforced cgroup limit for the workload (TASK-2722)', () => {
  assert.deepEqual(resolveMemoryBoundaryPolicy(input({ workload: 'focused' })),
    { mode: 'cgroup', limitMiB: DEFAULT_LIMIT_MIB.focused, limitSource: 'default', workload: 'focused' });
});

test('a default larger than the host is clamped instead of becoming unbounded (TASK-2722)', () => {
  const policy = resolveMemoryBoundaryPolicy(input({ workload: 'unit-covered', totalMemoryMiB: 4096 }));
  assert.equal(policy.mode === 'cgroup' && policy.limitMiB, 4096);
});

test('an environment limit overrides the default (TASK-2722)', () => {
  const policy = resolveMemoryBoundaryPolicy(input({ limitMiB: ' 2048 ' }));
  assert.equal(policy.mode === 'cgroup' && policy.limitMiB, 2048);
  assert.equal(policy.mode === 'cgroup' && policy.limitSource, 'environment');
});

test('invalid or unsupported limits are rejected and never become unbounded (TASK-2722)', () => {
  for (const limitMiB of ['', 'abc', '-1', '0', '12.5', '1e3', String(MIN_LIMIT_MIB - 1), String(HOST_MIB + 1), '99999999999999999999']) {
    if (limitMiB === '') { continue; }
    assert.throws(() => resolveMemoryBoundaryPolicy(input({ limitMiB })), MemoryBoundaryConfigError, limitMiB);
  }
  assert.throws(() => resolveMemoryBoundaryPolicy(input({ boundaryMode: 'v8-heap' })), /use "cgroup" \(default\) or "off"/);
});

test('hosted runners and the explicit opt-out run unbounded with a stated reason, never silently (TASK-2722)', () => {
  const hosted = resolveMemoryBoundaryPolicy(input({ hostedRunner: true }));
  assert.equal(hosted.mode, 'off');
  assert.match(hosted.mode === 'off' ? hosted.reason : '', /GitHub-hosted runner/);
  const optOut = resolveMemoryBoundaryPolicy(input({ boundaryMode: 'off' }));
  assert.deepEqual(optOut, { mode: 'off', reason: 'PARALLIX_TEST_MEMORY_BOUNDARY=off' });
  assert.equal(resolveMemoryBoundaryPolicy(input({ boundaryMode: 'cgroup', hostedRunner: true })).mode, 'cgroup');
});

test('a platform without cgroups fails with the opt-out named instead of running unbounded (TASK-2722)', () => {
  assert.throws(() => resolveMemoryBoundaryPolicy(input({ platform: 'darwin' })), /needs Linux cgroup v2, found darwin.*PARALLIX_TEST_MEMORY_BOUNDARY=off/);
});

test('workloads are classified from the selection, tier and coverage (TASK-2722)', () => {
  assert.equal(classifyWorkload({ requestedArgs: ['test/unit/a.test.ts'], integration: false, local: false, coverage: true }), 'focused');
  assert.equal(classifyWorkload({ requestedArgs: ['--unit-test-headroom'], integration: false, local: false, coverage: false }), 'unit');
  assert.equal(classifyWorkload({ requestedArgs: [], integration: false, local: false, coverage: true }), 'unit-covered');
  assert.equal(classifyWorkload({ requestedArgs: ['--integration-ci'], integration: true, local: false, coverage: false }), 'integration');
  assert.equal(classifyWorkload({ requestedArgs: ['--integration'], integration: true, local: false, coverage: true }), 'integration-covered');
  assert.equal(classifyWorkload({ requestedArgs: ['--integration-local'], integration: true, local: true, coverage: false }), 'integration-local');
});

test('the scope launch carries the memory cap, no swap and whole-scope kill before the command (TASK-2722)', () => {
  const launch = wrapInScope(2048, 'node', ['--test'], 'u.scope');
  assert.equal(launch.command, 'systemd-run');
  assert.deepEqual(launch.args.slice(0, 6), ['--user', '--scope', '--quiet', '--collect', '--unit', 'u.scope']);
  for (const property of ['MemoryMax=2048M', 'MemorySwapMax=0', 'OOMPolicy=kill']) { assert.ok(launch.args.includes(property), property); }
  assert.deepEqual(launch.args.slice(launch.args.indexOf('--') + 1), ['node', '--test']);
});

test('unavailable enforcement fails with an actionable error (TASK-2722)', () => {
  const failures: Array<[string, Parameters<typeof assertCgroupEnforcement>[1], RegExp]> = [
    ['no systemd-run', () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn systemd-run ENOENT') }), /systemd-run is unavailable/],
    ['no delegation', () => ({ status: 1, stdout: '', stderr: 'Failed to connect to bus' }), /could not create a memory-limited scope \(exit 1: Failed to connect to bus\)/],
    ['limit not applied', () => ({ status: 0, stdout: 'max\n0\n', stderr: '' }), /memory controller is not enforcing/],
    ['swap not capped', () => ({ status: 0, stdout: `${512 * 1048576}\nmax\n`, stderr: '' }), /swap is not capped/],
  ];
  for (const [label, double, message] of failures) {
    assert.throws(() => assertCgroupEnforcement(512, double), (error: unknown) =>
      error instanceof MemoryBoundaryUnavailableError && message.test(error.message) && /PARALLIX_TEST_MEMORY_BOUNDARY=off/.test(error.message) && /loginctl enable-linger/.test(error.message), label);
  }
  assert.doesNotThrow(() => assertCgroupEnforcement(512, () => ({ status: 0, stdout: `${512 * 1048576}\n0\n`, stderr: '' })));
});

test('default per-user runtime dir is offered only when its bus exists (TASK-2722)', () => {
  const present = (path: string) => path === '/run/user/1000/bus';
  assert.equal(defaultUserRuntimeDir(1000, present), '/run/user/1000');
  assert.equal(defaultUserRuntimeDir(1001, present), undefined);
});

test('scope samples expose peak and OOM kills, or null when the scope is gone (TASK-2722)', () => {
  const files: Record<string, string> = { '/s/memory.peak': '1048576\n', '/s/memory.events': 'low 0\nhigh 0\nmax 3\noom 1\noom_kill 2\noom_group_kill 1\n' };
  const read = (file: string) => { if (!(file in files)) { throw new Error('ENOENT'); } return files[file]; };
  assert.deepEqual(readScopeSample('/s', read), { peakBytes: 1048576, oomKills: 3 });
  assert.deepEqual(readScopeSample('/gone', read), { peakBytes: null, oomKills: null });
});

test('the breach report names command, suite, limit, peak, kills and the memory cause (TASK-2722)', () => {
  const report = formatBreachReport({ command: 'npm test', suite: 'test/unit/a.test.ts', limitMiB: 4096, peakBytes: 4096 * 1048576, oomKills: 1, elapsedMs: 1234.4 });
  for (const part of ['MEMORY LIMIT EXCEEDED', 'command=npm test', 'suite=test/unit/a.test.ts', 'limit=4096 MiB', 'peak=4096.0 MiB', 'oom_kill=1', 'cause: aggregate test-process-tree memory limit', 'repair:']) {
    assert.ok(report.includes(part), part);
  }
  const unavailable = formatBreachReport({ command: 'c', suite: 's', limitMiB: 256, peakBytes: null, oomKills: null, elapsedMs: 1 });
  assert.match(unavailable, /peak=unavailable/);
  assert.match(unavailable, /oom_kill=unavailable/);
});

test('every supported npm and gate entrypoint reaches the contained runner with a finite limit (TASK-2722)', () => {
  const root = path.join(import.meta.dirname, '..', '..', '..', '..');
  const scripts = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
  const runnerScripts = Object.entries(scripts).filter(([, command]) => command.includes('test/run-default-tests.ts'));
  assert.deepEqual(runnerScripts.map(([name]) => name).sort(), [
    'test', 'test:integration:ci:all:prebuilt', 'test:integration:ci:prebuilt', 'test:integration:local', 'test:integration:local:prebuilt', 'test:integration:prebuilt',
  ]);
  for (const [name, command] of runnerScripts) {
    const args = command.split('test/run-default-tests.ts')[1].trim().split(/\s+/).filter(Boolean);
    const integration = args.some(arg => arg.startsWith('--integration'));
    const workload = classifyWorkload({ requestedArgs: args, integration, local: args.includes('--integration-local'), coverage: false });
    const policy = resolveMemoryBoundaryPolicy(input({ workload }));
    assert.ok(policy.mode === 'cgroup' && Number.isSafeInteger(policy.limitMiB), name);
  }
  // Verification gates and pipelines reach the runner only through `npm test`;
  // `verify-local.sh all` delegates its unit run to verify-active-units.ts.
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
  for (const file of ['scripts/verify-local.sh', 'scripts/verify-active-units.ts', 'config/integration-pipelines.json', 'workflow.config.json']) {
    assert.doesNotMatch(read(file), /node (?:--import \S+ )*(?:--test )?[^\n"]*run-default-tests/, `${file} must not bypass npm test`);
  }
  for (const file of ['scripts/verify-active-units.ts', 'config/integration-pipelines.json', 'workflow.config.json']) {
    assert.match(read(file), /npm test/, file);
  }
  assert.match(read('scripts/verify-local.sh'), /scripts\/verify-active-units\.ts/, 'verify-local.sh all must run units through verify-active-units.ts');
});

test('a retained scope drops --collect and its terminal result is read through systemctl (TASK-2722)', () => {
  assert.ok(wrapInScope(512, 'node', [], 'u.scope').args.includes('--collect'));
  assert.ok(!wrapInScope(512, 'node', [], 'u.scope', true).args.includes('--collect'));
  const calls: string[][] = [];
  const double = (_command: string, args: string[]) => { calls.push(args); return { status: 0, stdout: 'oom-kill\n', stderr: '' }; };
  assert.equal(scopeResult('u.scope', double), 'oom-kill');
  forgetScope('u.scope', double);
  assert.deepEqual(calls.map(args => args[1]), ['show', 'reset-failed']);
  assert.equal(scopeResult('u.scope', () => ({ status: 1, stdout: '', stderr: 'no' })), null);
});

test('the scope cgroup directory is found only when the process sits in the named unit (TASK-2722)', () => {
  const read = (cgroup: string) => () => cgroup;
  assert.equal(scopeCgroupDir(1, 'u.scope', read('0::/user.slice/u.scope\n')), '/sys/fs/cgroup/user.slice/u.scope');
  assert.equal(scopeCgroupDir(1, 'u.scope', read('0::/user.slice/other.scope\n')), null);
  assert.equal(scopeCgroupDir(1, 'u.scope', read('1:cpu:/x\n')), null);
  assert.equal(scopeCgroupDir(1, 'u.scope', () => { throw new Error('ENOENT'); }), null);
});

test('scope watching keeps the latest sample, signals a breach once and survives a vanished scope (TASK-2722)', () => {
  const samples = [{ peakBytes: 10, oomKills: 0 }, { peakBytes: null, oomKills: null }, { peakBytes: 30, oomKills: 1 }, { peakBytes: 40, oomKills: 2 }];
  let breaches = 0;
  let dirLookups = 0;
  const unresolved = watchScope(1, 'u.scope', () => { breaches++; }, 1_000_000, { dirOf: () => null, sample: () => { throw new Error('unused'); } });
  assert.deepEqual(unresolved.stop(), { peakBytes: null, oomKills: null, breached: false });
  const watch = watchScope(1, 'u.scope', () => { breaches++; }, 1_000_000, {
    dirOf: () => { dirLookups++; return '/s'; },
    sample: () => samples.shift()!,
  });
  assert.deepEqual(watch.stop(), { peakBytes: 10, oomKills: 0, breached: false });
  assert.deepEqual(watch.stop(), { peakBytes: 10, oomKills: 0, breached: false });
  assert.deepEqual(watch.stop(), { peakBytes: 30, oomKills: 1, breached: true });
  assert.deepEqual(watch.stop(), { peakBytes: 40, oomKills: 2, breached: true });
  assert.equal(breaches, 1);
  assert.equal(dirLookups, 1);
});
