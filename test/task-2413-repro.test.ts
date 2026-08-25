/**
 * TASK-2413 reproduction: a successful handoff verifier is followed by a
 * publication verifier whose failure is surfaced only as an exit-code-only
 * Forgejo wrapper, discarding the captured verifier output.
 *
 * This test encodes the DESIRED (green) behaviour: the publication verifier
 * failure must carry the structured root failure — the exact command, the
 * working directory (cwd), the exit status, and the captured stdout/stderr —
 * end to end, so an outer Forgejo wrapper cannot collapse it to an
 * exit-code-only string and strand the next agent.
 *
 * At the mission parent commit (e31f21549) the assertions that inspect the
 * captured output fail, because `captureVerifiedTreeProof` returns only
 * `verification gate failed for <dir> with exit code 1`. That red state is the
 * reproduction; the fix makes these assertions green.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { captureVerifiedTreeProof, isTransientVerificationFailure } from '../src/adapters/verification/verification.js';
import { classifyReboundReason, rebound, type ReboundReason } from '../src/application/rebound-kernel.js';

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-2413-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function initCommittedGitRepo(root) {
  const runGit = (args) => {
    const result = childProcess.spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  };
  runGit(['init']);
  runGit(['checkout', '-b', 'main']);
  runGit(['config', 'user.name', 'Test User']);
  runGit(['config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(root, 'README.md'), '# temp repo\n', 'utf8');
  // A configured verification command so the gate actually runs the injected
  // runFn instead of no-op passing (mirrors workflow.config.json).
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    product: { name: 'Task 2413 Repro' },
    adapters: {
      verification: { command: 'npm run verify:{{area}}', defaultArea: 'docs' },
    },
  }), 'utf8');
  runGit(['add', 'README.md', 'workflow.config.json']);
  runGit(['commit', '-m', 'init']);
}

test('task-2413: publication verifier failure preserves the structured root failure', () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    const capturedStdout = 'FAIL  test/feature.test.ts\n  AssertionError: boom expected 1 == 2';
    const capturedStderr = 'npm error code ECONTENTION\nnpm error run under host contention';
    const result = captureVerifiedTreeProof('docs', root, {
      runFn() {
        return { status: 1, signal: null, stdout: capturedStdout, stderr: capturedStderr };
      },
      stdio: 'pipe',
    });

    // The failure is preserved (not a hidden success).
    assert.equal(result.ok, false);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);

    // The structured root failure is carried on the result object, not only in
    // the wrapper string — this is what the handoff caller and classifier read.
    assert.equal(result.exitCode, 1);
    assert.equal(result.command, 'npm run verify:docs');
    assert.ok(result.cwd.includes(path.basename(root)));
    assert.equal(result.stdout, capturedStdout);
    assert.equal(result.stderr, capturedStderr);

    // The exact command that failed is retained for the next agent.
    assert.match(result.error, /verification gate failed/);
    // The exit status is retained, not collapsed to a boolean.
    assert.match(result.error, /exit code 1/);
    // The captured stdout/stderr survive the wrapper — this is the information
    // loss the task-2373.01 incident exposed at the parent commit.
    assert.match(result.error, /AssertionError: boom expected 1 == 2/);
    assert.match(result.error, /ECONTENTION/);
    // The cwd the gate ran against is retained.
    assert.ok(result.error.includes(path.basename(root)), 'error retains the cwd');
  });
});

test('task-2413: raw spawn capture safely bounds verifier output above the Node default buffer', () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    const command = `node -e "process.stdout.write('x'.repeat(1200000)); process.stderr.write('tail-marker'); process.exit(4)"`;
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { verification: { command, defaultArea: 'docs' } },
    }), 'utf8');
    childProcess.spawnSync('git', ['-C', root, 'add', 'workflow.config.json']);
    childProcess.spawnSync('git', ['-C', root, 'commit', '-m', 'large verifier']);

    const result = captureVerifiedTreeProof('docs', root, { runFn: childProcess.spawnSync });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 4);
    assert.equal(result.stdout?.length, 8000);
    assert.equal(result.stderr, 'tail-marker');
  });
});

test('task-2413: a materially changed failure is reclassified from its own evidence, not the prior class', () => {
  // Attempt A: a genuine deterministic gate failure is a GateFailure (auto
  // send-back), never remapped to a Git/infra blocker by wrapper words.
  const gateReason: ReboundReason = {
    kind: 'gate-failure',
    area: 'docs',
    command: 'npm test',
    exitCode: 1,
    stdout: 'AssertionError: boom',
    stderr: '',
  };
  const classifiedA = classifyReboundReason(gateReason);
  assert.equal(classifiedA.failureClass, 'GateFailure');
  assert.equal(classifiedA.isRelaunchable, true);

  // Attempt B: the same gate now fails because the Forgejo provider is down. The
  // structured reason is still a gate-failure, but the diagnostic names an
  // infrastructure blocker, so it must be reclassified as InfraBlocker
  // (human-only) rather than continuing under the prior GateFailure policy.
  const infraReason: ReboundReason = {
    kind: 'gate-failure',
    area: 'docs',
    command: 'npm test',
    exitCode: 1,
    stdout: '',
    stderr: 'forgejo connection refused',
  };
  const classifiedB = classifyReboundReason(infraReason);
  assert.notEqual(classifiedA.failureClass, classifiedB.failureClass, 'B is freshly classified');
  assert.equal(classifiedB.failureClass, 'InfraBlocker');
  assert.equal(classifiedB.isRelaunchable, false);
});

test('task-2413: a deterministic gate failure is not masked as a transient/no-output pass', () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    const result = captureVerifiedTreeProof('docs', root, {
      runFn() { return { status: 3, signal: null, stdout: 'deterministic test failure', stderr: '' }; },
      stdio: 'pipe',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /exit code 3/);
    assert.match(result.error, /deterministic test failure/);
  });
});

test('task-2413: only adapter-declared verifier markers receive a transient rerun', () => {
  assert.equal(isTransientVerificationFailure({ stdout: '[unit-test-budget:exceeded] test/a.test.ts' }), true);
  assert.equal(isTransientVerificationFailure({ stderr: '[unit-test-budget] SUITE BUDGET EXCEEDED: 10ms > 5ms' }), true);
  assert.equal(isTransientVerificationFailure({ stdout: 'deterministic resource contention assertion failed' }), false);
});

test('task-2413: a slow unit-test gate retries before it can be mistaken for a Git hook failure', async () => {
  let launches = 0;
  let reruns = 0;
  const outcome = await rebound({
    kind: 'gate-failure',
    area: 'all',
    command: 'npm test',
    exitCode: 1,
    stdout: 'pre-push hook output appears in the full suite\nunit-test-budget timeout=1000ms per test\nbudget-exceeded',
    stderr: '',
    transient: true,
  }, {
    slug: 'task-2413', worktree: '/tmp/task-2413', implementer: 'codex',
    startAgent: async () => { launches++; return { result: { status: 0 } }; },
    verify: () => { reruns++; return { ok: true }; },
    log: () => {}, error: () => {},
  });

  assert.equal(outcome.outcome, 'fixed');
  assert.equal(outcome.classification.failureClass, 'GateFailure');
  assert.equal(reruns, 1);
  assert.equal(launches, 0, 'a transient rerun is not a code-repair launch');
});

test('task-2413: an exhausted slow-test retry launches a repair with the exact gate evidence, not an invented suite', async () => {
  let launches = 0;
  let reruns = 0;
  const prompts: string[] = [];
  const outcome = await rebound({
    kind: 'gate-failure', area: 'all', command: './scripts/verify-local.sh all', exitCode: 1,
    stdout: '[unit-test-budget:exceeded] review test exceeded 1000ms', stderr: '',
    transient: true,
  }, {
    slug: 'task-2413', worktree: '/tmp/task-2413', implementer: 'custom',
    startAgent: async (_step, options: any) => {
      launches++;
      prompts.push(options.prompt('custom'));
      return { result: { status: 1 } };
    },
    verify: () => { reruns++; return { ok: false, reason: {
      kind: 'gate-failure', area: 'all', command: './scripts/verify-local.sh all', exitCode: 1,
      stdout: '[unit-test-budget:exceeded] review test exceeded 1000ms', stderr: '',
      transient: true,
    } }; },
    log: () => {}, error: () => {},
  });

  assert.equal(outcome.outcome, 'exhausted');
  assert.equal(reruns, 1);
  assert.equal(launches, 2, 'the normal bounded repair budget remains available after the transient rerun');
  assert.match(prompts[0], /Gate command: \.\/scripts\/verify-local\.sh all/);
  assert.match(prompts[0], /unit-test-budget:exceeded/);
  assert.match(prompts[0], /Do not substitute a broader verification command or integration suite/);
  assert.match(prompts[1], /Original failure output[\s\S]*unit-test-budget:exceeded/);
});

test('task-2413: fresh structured evidence reclassifies recovery instead of retaining a stale gate policy', async () => {
  let launches = 0;
  const outcome = await rebound({
    kind: 'gate-failure', area: 'all', command: 'npm test', exitCode: 1,
    stdout: 'AssertionError: original code failure', stderr: '',
  }, {
    slug: 'task-2413', worktree: '/tmp/task-2413', implementer: 'codex',
    startAgent: async () => { launches++; return { result: { status: 0 } }; },
    verify: () => ({ ok: false, reason: {
      kind: 'gate-failure', area: 'all', command: 'npm test', exitCode: 1,
      stdout: '', stderr: 'forgejo connection refused',
    } }),
    log: () => {}, error: () => {},
  });

  assert.equal(outcome.outcome, 'exhausted');
  assert.equal(outcome.classification.failureClass, 'InfraBlocker');
  assert.equal(launches, 1, 'the changed failure is not sent to a second code repair');
});

test('task-2413: launcher failure uses its own budget and never pretends code repair was attempted', async () => {
  let verifies = 0;
  const outcome = await rebound({
    kind: 'gate-failure', area: 'all', command: 'npm test', exitCode: 1,
    stdout: 'AssertionError: code failure', stderr: '',
  }, {
    slug: 'task-2413', worktree: '/tmp/task-2413', implementer: 'codex',
    maxAttempts: 2, maxLaunchRetries: 0,
    startAgent: async () => ({ result: { status: null } }),
    verify: () => { verifies++; return { ok: false }; },
    log: () => {}, error: () => {},
  });

  assert.equal(outcome.outcome, 'exhausted');
  assert.equal(verifies, 0);
  assert.match(outcome.dossier || '', /launcher budget/);
});
