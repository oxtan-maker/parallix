

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'child_process';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
const runDeclaredGatesModule = mockModule<typeof import('../../../src/adapters/cli/commands/handoff.js')>('../../../src/adapters/cli/commands/handoff.js', import.meta.url);
const reviewCommandsModule = mockModule<typeof import('../../../src/adapters/review/review-commands.js')>('../../../src/adapters/review/review-commands.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { runDeclaredGates } = runDeclaredGatesModule;
const { submitForReview } = reviewCommandsModule;
const { mock } = test;
import { createReviewLoopPorts } from '../../../src/adapters/review/review-loop.js';
import { runReviewLoop } from '../../../src/application/review-loop/review-loop.js';
import { fakeReviewLoopPorts } from '../../helpers/review-loop-ports.js';

// Reproduction tests for task-2234 (push-to-reviewer autobounce).
//
// When a reviewer-push attempt fails because a declared verification gate
// is invalid (explanatory dash suffix such as "true — some description"),
// the mission should auto-bounce back to the repairable workflow state
// rather than stranding as a terminal failure.
//
// The auto-bounce lives in the performHandoff failure path and its callers
// (submitForReview, review-loop self-heal), not in pushRound's createPr path.

// ============================================================================
// CP-1: Strict dash-suffix rejection (behavioral, unchanged from round 1)
// ============================================================================

test('task-2234 repro: runDeclaredGates rejects explanatory em-dash suffix before execution', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2234-gates-dash-'));
  const rootDir = missionDir;

  fs.writeFileSync(
    path.join(missionDir, 'MISSION.md'),
    '# Mission\n\n## Gates\n\n- [ ] true — some description\n'
  );

  try {
    const result = runDeclaredGates(missionDir, rootDir, {
      log: () => {},
      error: () => {}
    });

    assert.equal(result.ok, false, 'gate with em-dash suffix must be rejected');
    assert.equal(result.reason, 'validation-failed', 'rejection reason must be validation-failed');
    assert.ok(
      result.error && /exact.*runnable.*command/i.test(result.error),
      'error message must explain that gate declaration must be an exact runnable command'
    );
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('task-2234 repro: runDeclaredGates rejects explanatory en-dash and double-dash suffixes', () => {
  for (const gateText of ['true – brief note', 'true -– legacy note']) {
    const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2234-gates-dash-'));
    const rootDir = missionDir;

    fs.writeFileSync(
      path.join(missionDir, 'MISSION.md'),
      `# Mission\n\n## Gates\n\n- [ ] ${gateText}\n`
    );

    try {
      const result = runDeclaredGates(missionDir, rootDir, {
        log: () => {},
        error: () => {}
      });

      assert.equal(result.ok, false, `gate "${gateText}" must be rejected`);
      assert.equal(result.reason, 'validation-failed', `reason for "${gateText}"`);
    } finally {
      fs.rmSync(missionDir, { recursive: true, force: true });
    }
  }
});

// ============================================================================
// CP-2: Auto-bounce behavior (behavioral via the application review loop)
// ============================================================================

async function withTempGitRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2234-e2e-'));
  try {
    childProcess.spawnSync('git', ['init', '-b', 'master'], { cwd: root });
    childProcess.spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    childProcess.spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    fs.writeFileSync(path.join(root, 'README.md'), '# repo');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root });
    childProcess.spawnSync('git', ['commit', '-m', 'initial'], { cwd: root });
    const result = fn(root);
    if (result && typeof result.then === 'function') {
      await result;
    }
    return result;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// The self-heal handoff (and its auto-bounce) only runs when a review
// provider is enabled and reachable and no open PR exists for the mission
// branch, so the harness binds a reachable provider with no PR. Every test
// asserts on `logs`/`errors` that the self-heal path actually executed, so
// these tests cannot pass by skipping the code under test.
function baseLoopHarness(root, handoff, overrides: Record<string, unknown> = {}) {
  const transitions = [];
  const fake = fakeReviewLoopPorts({
    slug: 'task-2234',
    worktree: root,
    routing: { eligibleFamilies: () => ['codex', 'claude'] },
    provider: { openPullRequest: () => null },
    handoff: { handoff: async () => handoff },
    task: { mirror: async lane => { transitions.push({ slug: 'task-2234', status: lane }); } },
    ...overrides,
  });
  const run = () => runReviewLoop({ slug: 'task-2234', implementer: 'claude', reviewer: 'codex' }, fake.ports);
  return { fake, run, transitions, logs: fake.logs, errors: fake.errors, exitCodes: fake.exits };
}

function assertSelfHealAttempted(logs) {
  assert.ok(
    logs.some(m => /attempting automatic handoff/.test(m)),
    'test harness must reach the self-heal handoff path (guards against vacuous pass)'
  );
}

test('task-2234 repro: review-loop self-heal auto-bounces to active on validation-failed handoff', async () => {
  await withTempGitRepo(async (root) => {
    const { run, logs, exitCodes, transitions, fake } = baseLoopHarness(root, {
      ok: false,
      reason: 'validation-failed',
      error: 'Declared gate "true — some description" failed for task-2234: Gate declaration must contain an exact runnable command only. Blocking handoff — task remains in active.'
    });
    await run();
    const writtenStates = fake.writes.map(state => ({ slug: 'task-2234', state }));

    assertSelfHealAttempted(logs);
    assert.deepEqual(
      transitions,
      [{ slug: 'task-2234', status: 'active' }],
      'self-heal must transition exactly this task to active on validation-failed'
    );
    // `fake.writes` is `Record<string, unknown>[]`, so metadata is unknown until
    // cast; narrow on a literal comparison so the shape resolves without strict mode.
    const metadataOf = (entry: { state: Record<string, unknown> }) => entry.state.metadata as Record<string, unknown> | undefined;
    const bounced = writtenStates.find(
      s => s.slug === 'task-2234' && metadataOf(s)
        && metadataOf(s)?.gateFailureReason === 'validation-failed'
    );
    assert.ok(bounced, 'self-heal must persist gateFailureReason in review-state metadata');
    assert.match(
      String(metadataOf(bounced)!.gateFailureError),
      /true — some description/,
      'persisted gateFailureError must retain the invalid gate text for the follow-up action'
    );
    assert.ok(
      logs.some(m => /Auto-bounced task-2234 to active/.test(m)),
      'self-heal must surface the auto-bounce and repair guidance in output'
    );
    assert.deepEqual(exitCodes, [1], 'loop must stop after bouncing (no reviewer launch)');
  });
});

test('task-2234 repro: review-loop self-heal fails closed when validation-failure state cannot commit', async () => {
  await withTempGitRepo(async (root) => {
    // The real review-state mechanism reports the write that did not commit.
    const bound = createReviewLoopPorts('task-2234', { worktree: root }, {
      log: () => {}, error: () => {},
      readReviewState: () => null,
      writeReviewState: (() => ({ outcome: 'commit-failed-dirty', stage: 'commit', diagnostic: 'simulated commit failure' })) as never,
    });
    const { run, logs, exitCodes } = baseLoopHarness(root, { ok: false, reason: 'validation-failed', error: 'Declared gate is invalid' }, { stateport: bound.state });

    await assert.rejects(
      run,
      /Review-state persistence failed for mission task-2234, phase reviewing, round 1, stage commit: simulated commit failure/
    );
    assertSelfHealAttempted(logs);
    assert.deepEqual(exitCodes, [], 'fail-closed persistence must stop before the explicit error exit');
  });
});

test('task-2234 repro: review-loop self-heal does NOT bounce on gate-failed (execution failure)', async () => {
  await withTempGitRepo(async (root) => {
    const { run, logs, errors, exitCodes, transitions } = baseLoopHarness(root, {
      ok: false,
      reason: 'gate-failed',
      error: 'Declared gate "./scripts/verify-local.sh all" failed for task-2234: Gate exited with status 1. Blocking handoff — task remains in active.'
    });
    await run();

    assertSelfHealAttempted(logs);
    // The self-heal only bounces for validation-failed, not gate-failed:
    // the task stays in review and the loop exits with manual guidance.
    assert.deepEqual(
      transitions,
      [],
      'gate-failed (execution failure) must NOT trigger any task transition'
    );
    assert.ok(
      errors.some(m => /No open review PR found/.test(m)),
      'gate-failed must fall through to the manual-guidance failure path'
    );
    assert.deepEqual(exitCodes, [1], 'loop must exit non-zero without bouncing');
  });
});

test('task-2234 repro: infra/auth errors do NOT bounce (mission risk: narrow classification boundary)', async () => {
  await withTempGitRepo(async (root) => {
    const { run, logs, errors, exitCodes, transitions } = baseLoopHarness(root, {
      ok: false,
      error: 'Forgejo authentication failed: token expired'
    });
    await run();

    assertSelfHealAttempted(logs);
    assert.deepEqual(
      transitions,
      [],
      'infra/auth errors must NOT trigger auto-bounce (mission risk: broad failure matching)'
    );
    assert.ok(
      errors.some(m => /Forgejo authentication failed: token expired/.test(m)),
      'the original infra error must be surfaced in the failure guidance'
    );
    assert.deepEqual(exitCodes, [1], 'loop must exit non-zero without bouncing');
  });
});

// ============================================================================
// CP-2: Auto-bounce in submitForReview (px review --submit path)
// ============================================================================

function submitHarness(root, performHandoffResult) {
  const taskFile = path.join(root, 'task.md');
  fs.writeFileSync(taskFile, '# task');
  const transitions = [];
  const logs = [];
  const exitCodes = [];
  const options = {
    resolveWorktreeFn: () => root,
    readReviewStateFn: () => null,
    resolveTaskFileFn: () => ({ ok: true, taskFile }),
    getTaskImplementerFn: () => 'claude',
    isReviewProviderEnabledFn: () => false,
    performHandoffFn: async () => performHandoffResult,
    transitionTaskFn: (slug, status) => { transitions.push({ slug, status }); return true; },
    log: (m) => logs.push(m),
    exit: (c) => { exitCodes.push(c); },
  };
  return { options, transitions, logs, exitCodes };
}

test('task-2234 repro: submitForReview auto-bounces to active on validation-failed handoff', async () => {
  await withTempGitRepo(async (root) => {
    const { options, transitions, logs, exitCodes } = submitHarness(root, {
      ok: false,
      reason: 'validation-failed',
      error: 'Declared gate "true — some description" failed for task-2234: Gate declaration must contain an exact runnable command only.'
    });

    // @ts-expect-error -- test stub captures exit code instead of calling process.exit()
    await submitForReview('task-2234', false, options);

    assert.deepEqual(
      transitions,
      [{ slug: 'task-2234', status: 'active' }],
      'submitForReview must transition the task to active on validation-failed'
    );
    assert.ok(
      logs.some(m => /Auto-bounced task-2234 to active/.test(m)),
      'submitForReview must surface the auto-bounce and repair guidance'
    );
    assert.deepEqual(exitCodes, [1], 'submitForReview must still report the failed handoff');
  });
});

test('task-2234 repro: submitForReview does NOT bounce on gate-failed (execution failure)', async () => {
  await withTempGitRepo(async (root) => {
    const { options, transitions, exitCodes } = submitHarness(root, {
      ok: false,
      reason: 'gate-failed',
      error: 'Declared gate "./scripts/verify-local.sh all" failed for task-2234: Gate exited with status 1.'
    });

    // @ts-expect-error -- test stub captures exit code instead of calling process.exit()
    await submitForReview('task-2234', false, options);

    assert.deepEqual(
      transitions,
      [],
      'gate-failed (execution failure) must NOT trigger auto-bounce in submitForReview'
    );
    assert.deepEqual(exitCodes, [1], 'submitForReview must exit non-zero without bouncing');
  });
});
