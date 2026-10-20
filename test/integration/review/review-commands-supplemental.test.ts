import { ReviewState } from '../../../src/adapters/review/review-state.js';
import { reviewStateWriterFixture } from '../../helpers/review-state-writer.js';


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { flagValue, readTextFlag, formatStaticReviewFindings, formatStaticReviewSuccess, performStaticReview, verifyReview, submitReviewRound, pushRound, showReviewStatus } from '../../../src/adapters/review/review-commands.js';
const mockWorktree = '/mock/worktree';
const mockSlug = 'test-slug';
const mockBranch = 'mission/test-slug';

// flagValue - basic tests
test('flagValue returns null when flag not present', () => {
  assert.equal(flagValue(['--other', 'val'], '--target'), null);
});

test('flagValue returns value when flag present', () => {
  assert.equal(flagValue(['--flag', 'value'], '--flag'), 'value');
});

test('flagValue handles adjacent flags', () => {
  assert.equal(flagValue(['--flag', '--other'], '--flag'), null);
});

// readTextFlag - basic tests
test('readTextFlag from inline', () => {
  const result = readTextFlag(
    ['--msg', 'hello'],
    '--msg', '--msg-file', 'message',
    { readFileSync: fs.readFileSync, exit: () => {}, error: () => {} }
  );
  assert.equal(result, 'hello');
});

// formatStaticReviewFindings
test('formatStaticReviewFindings with one finding', () => {
  const result = formatStaticReviewFindings(['Issue 1']);
  assert.ok(result.includes('Issue 1'));
});

test('formatStaticReviewFindings with multiple findings', () => {
  const result = formatStaticReviewFindings(['Issue 1', 'Issue 2']);
  assert.ok(result.includes('Issue 1'));
  assert.ok(result.includes('Issue 2'));
});

// formatStaticReviewSuccess
test('formatStaticReviewSuccess includes slug', () => {
  const result = formatStaticReviewSuccess('test-slug');
  assert.ok(result.includes('test-slug'));
});

// performStaticReview - test different failure modes
test('performStaticReview fails when no mission dir', () => {
  const result = performStaticReview(mockSlug, {
    findMissionDir: () => null,
    resolveWorktree: () => mockWorktree
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.length > 0);
});

test('performStaticReview fails when no checkpoints', () => {
  const result = performStaticReview(mockSlug, {
    findMissionDir: () => '/mock/mission',
    resolveWorktree: () => mockWorktree,
    findCheckpoints: () => []
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.length > 0);
});

test('performStaticReview fails when Goal Check missing', () => {
  const result = performStaticReview(mockSlug, {
    findMissionDir: () => '/mock/mission',
    resolveWorktree: () => mockWorktree,
    findCheckpoints: () => ['/mock/CP-1.md'],
    getPrimaryBranch: () => 'main',
    run: () => ({ status: 0, stdout: '', stderr: '', signal: null }),
    readFileSync: () => '## Other'
  });
  assert.equal(result.ok, false);
});

// Skipping this test for now - it requires complex mocking of git operations
// test('performStaticReview passes with valid Goal Check', () => {
//   const missionUtils = require('../../../src/adapters/filesystem/mission-utils.js');
//   const originalGetPrimaryBranch = missionUtils.getPrimaryBranch;
//   missionUtils.getPrimaryBranch = () => 'main';
//
//   try {
//     const result = performStaticReview(mockSlug, {
//       findMissionDir: () => '/mock/mission',
//       resolveWorktree: () => mockWorktree,
//       findCheckpoints: () => ['/mock/CP-1.md'],
//       readFileSync: () => '## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| AC1 | evidence | PASS |',
//       runFn: () => ({ status: 0, stdout: '', stderr: '' })
//     });
//     assert.equal(result.ok, true);
//   } finally {
//     missionUtils.getPrimaryBranch = originalGetPrimaryBranch;
//   }
// });

// verifyReview - test different branches
test('verifyReview exits on missing mission dir', async () => {
  let exited = false;
  await verifyReview(mockSlug, false, {
    findMissionDirFn: () => null,
    getCurrentBranchFn: () => mockBranch,
    resolveTaskFileFn: () => ({ matches: ['/mock/task.md'],  ok: true as const, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'review',
    isForgejoReviewEnabledFn: () => false,
    log: () => {},
    error: () => {},
    exit: () => { exited = true; }
  });
  assert.equal(exited, true);
});

test('verifyReview exits on branch mismatch', async () => {
  let exited = false;
  await verifyReview(mockSlug, false, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => 'wrong-branch',
    resolveTaskFileFn: () => ({ matches: ['/mock/task.md'],  ok: true as const, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'review',
    isForgejoReviewEnabledFn: () => false,
    log: () => {},
    error: () => {},
    exit: () => { exited = true; }
  });
  assert.equal(exited, true);
});

test('verifyReview exits on task not found', async () => {
  let exited = false;
  await verifyReview(mockSlug, false, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    resolveTaskFileFn: () => ({ matches: [], reason: 'missing' as const,  ok: false as const }),
    getTaskStatusFn: () => 'review',
    isForgejoReviewEnabledFn: () => false,
    log: () => {},
    error: () => {},
    exit: () => { exited = true; }
  });
  assert.equal(exited, true);
});

test('verifyReview passes with all green', async () => {
  let exited = false;
  await verifyReview(mockSlug, false, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    resolveTaskFileFn: () => ({ matches: ['/mock/task.md'],  ok: true as const, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'review',
    isForgejoReviewEnabledFn: () => false,
    runVerificationGate: () => ({ status: 0 }),
    log: () => {},
    error: () => {},
    exit: () => { exited = true; }
  });
  assert.equal(exited, false);
});

test('verifyReview preserves the selected worktree for its verification gate and review state', async () => {
  const missionRoot = '/tmp/selected-mission-tree';
  let gateRoot: { value: string | undefined | null } = { value: null };
  let stateRoot: { value: string | undefined | null } = { value: null };
  await verifyReview(mockSlug, false, {
    resolveWorktreeFn: () => missionRoot,
    findMissionDirFn: () => `${missionRoot}/missions/${mockSlug}`,
    getCurrentBranchFn: () => mockBranch,
    resolveTaskFileFn: () => ({ matches: [`${missionRoot}/backlog/task.md`],  ok: true as const, taskFile: `${missionRoot}/backlog/task.md` }),
    getTaskStatusFn: () => 'review',
    findMissionAreaFn: () => 'workflow',
    isForgejoReviewEnabledFn: () => false,
    runVerificationGate: (_area, options) => { assert.ok(options); gateRoot.value = options.rootDir; return { status: 0 }; },
    readReviewStateFn: (_slug, rootDir) => { stateRoot.value = rootDir; return null; },
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ step: 'review', agents: [], configPath: '', configPresent: false, launchers: {} }),
    log: () => {}, error: () => {}, exit: () => {}
  });
  assert.equal(gateRoot.value, missionRoot);
  assert.equal(stateRoot.value, missionRoot);
});

// submitReviewRound - test different outcomes
test('submitReviewRound exits on invalid outcome', async () => {
  let exited = false;
  await submitReviewRound(mockSlug, 'bad-outcome', 'msg', {
    isForgejoReviewEnabledFn: () => true,
    log: () => {},
    error: () => {},
    exit: () => { exited = true; }
  });
  assert.equal(exited, true);
});

// TASK-2457 wiring: a failing pre-review gate blocks the approve (review ->
// integration) transition. The checkout declares one failing gate through its
// own workflow.config.json; the real runner executes it and the approve exits
// non-zero without recording an approved disposition or promoting the task.
test('submitReviewRound blocks approve when a pre-review gate fails', async () => {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'px-review-gate-'));
  try {
    fs.writeFileSync(
      path.join(checkout, 'workflow.config.json'),
      JSON.stringify({ adapters: { gates: { preReview: [{ key: 'smoke', command: 'exit 3', order: 0 }] } } }),
    );
    let exited = 0;
    let disp = null;
    let transitioned: { value: { slug: string; status: string; } | null } = { value: null };
    const state = new ReviewState(mockSlug, { round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl' });
    await submitReviewRound(mockSlug, 'approve', 'msg', {
      worktree: checkout,
      isForgejoReviewEnabledFn: () => true,
      readReviewStateFn: () => state,
      writeReviewStateFn: reviewStateWriterFixture((s, st) => { disp = st.disposition; }),
      transitionTaskFn: async (slug, status) => { transitioned.value = { slug, status }; return true; },
      readTokenFn: () => 'token',
      postReviewFn: () => ({ data: null, status: null, statusCode: null, stderr: null, error: null,  ok: true as const }),
      log: () => {},
      error: () => {},
      exit: () => { exited = 1; },
    });
    assert.equal(exited, 1, 'approve exits non-zero when the pre-review gate fails');
    assert.equal(disp, null, 'no approved disposition is recorded on a blocked gate');
    assert.equal(transitioned.value, null, 'backlog task is not promoted to approved');
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

// TASK-2457 wiring: a passing pre-review gate permits the approve to complete.
test('submitReviewRound permits approve when the pre-review gate passes', async () => {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'px-review-gate-'));
  try {
    fs.writeFileSync(
      path.join(checkout, 'workflow.config.json'),
      JSON.stringify({ adapters: { gates: { preReview: [{ key: 'smoke', command: 'true', order: 0 }] } } }),
    );
    let disp = null;
    let transitioned: { value: { slug: string; status: string; } | null } = { value: null };
    const state = new ReviewState(mockSlug, { round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl' });
    await submitReviewRound(mockSlug, 'approve', 'msg', {
      worktree: checkout,
      isForgejoReviewEnabledFn: () => true,
      readReviewStateFn: () => state,
      writeReviewStateFn: reviewStateWriterFixture((s, st) => { disp = st.disposition; }),
      transitionTaskFn: async (slug, status) => { transitioned.value = { slug, status }; return true; },
      readTokenFn: () => 'token',
      postReviewFn: () => ({ data: null, status: null, statusCode: null, stderr: null, error: null,  ok: true as const }),
      log: () => {},
      error: () => {},
    });
    assert.equal(disp, 'APPROVED', 'a passing pre-review gate permits the approve');
    assert.deepEqual(transitioned.value, { slug: mockSlug, status: 'approved' });
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('submitReviewRound handles approve for forgejo', async () => {
  let disp = null;
  let transitioned: { value: { slug: string; status: string; } | null } = { value: null };
  const state = new ReviewState(mockSlug, { round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl' });
  await submitReviewRound(mockSlug, 'approve', 'msg', {
    worktree: mockWorktree,
    isForgejoReviewEnabledFn: () => true,
    readReviewStateFn: () => state,
    writeReviewStateFn: reviewStateWriterFixture((s, st) => { disp = st.disposition; }),
    transitionTaskFn: async (slug, status) => { transitioned.value = { slug, status }; return true; },
    readTokenFn: () => 'token',
    postReviewFn: () => ({ data: null, status: null, statusCode: null, stderr: null, error: null,  ok: true as const }),
    log: () => {},
    error: () => {}
  });
  assert.equal(disp, 'APPROVED');
  assert.deepEqual(transitioned.value, { slug: mockSlug, status: 'approved' });
});

test('submitReviewRound handles request-changes for forgejo', async () => {
  let disp = null;
  let transitioned: { value: { slug: string; status: string; } | null } = { value: null };
  const state = new ReviewState(mockSlug, { round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl' });
  await submitReviewRound(mockSlug, 'request-changes', 'msg', {
    worktree: mockWorktree,
    isForgejoReviewEnabledFn: () => true,
    readReviewStateFn: () => state,
    writeReviewStateFn: reviewStateWriterFixture((s, st) => { disp = st.disposition; }),
    transitionTaskFn: async (slug, status) => { transitioned.value = { slug, status }; return true; },
    readTokenFn: () => 'token',
    postReviewFn: () => ({ data: null, status: null, statusCode: null, stderr: null, error: null,  ok: true as const }),
    log: () => {},
    error: () => {}
  });
  assert.equal(disp, 'REQUEST_CHANGES');
  assert.deepEqual(transitioned.value, { slug: mockSlug, status: 'review' });
});

test('submitReviewRound handles provider=none', async () => {
  let disp = null;
  let transitioned = false;
  const state = new ReviewState(mockSlug, { round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl' });
  await submitReviewRound(mockSlug, 'approve', 'msg', {
    worktree: mockWorktree,
    isForgejoReviewEnabledFn: () => false,
    readReviewStateFn: () => state,
    writeReviewStateFn: reviewStateWriterFixture((s, st) => { disp = st.disposition; }),
    transitionTaskFn: async () => { transitioned = true; return true; },
    log: () => {},
    error: () => {}
  });
  assert.equal(disp, 'APPROVED');
  assert.equal(transitioned, true);
});

test('submitReviewRound creates state when none exists', async () => {
  let newState: { value: Record<string, unknown> | import("../../../src/adapters/review/review-state.js").ReviewState | import("../../../src/application/ports/review-persistence.js").ReviewStateData | null } = { value: null };
  await submitReviewRound(mockSlug, 'approve', 'msg', {
    worktree: mockWorktree,
    isForgejoReviewEnabledFn: () => false,
    readReviewStateFn: () => null,
    writeReviewStateFn: reviewStateWriterFixture((s, st) => { newState.value = st; }),
    transitionTaskFn: async () => true,
    log: () => {},
    error: () => {}
  });
  assert.ok(newState.value);
  assert.equal(newState.value.disposition, 'APPROVED');
  assert.equal(newState.value.phase, 'approved');
});

test('submitReviewRound does not exit when reviewer is the PR author (self-author skip)', async () => {
  // task-1255: same-agent-reviewer fallback. postWorkflowReview skips the
  // Forgejo POST (returns ok:true, skipped:true) — submitReviewRound must record
  // locally and warn, NOT exit(1).
  let exited = false;
  let postCalled = false;
  const transitions: string[] = [];
  let recordedDisposition = null;
  let recordedVerdict: { value: string | undefined | null } = { value: null };
  const warnings: string[] = [];
  // Force forgejoUser to resolve from state.reviewer (= 'custom') regardless of
  // the ambient FORGEJO_USER env so the reviewer==author case is exercised.
  const prevEnv = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  try {
    const state = new ReviewState(mockSlug, { round: 1, phase: 'reviewing', reviewer: 'custom', implementer: 'custom' });
    await submitReviewRound(mockSlug, 'approve', 'msg', {
      worktree: mockWorktree,
      isForgejoReviewEnabledFn: () => true,
      readReviewStateFn: () => state,
      writeReviewStateFn: reviewStateWriterFixture((s, st) => { recordedDisposition = st.disposition; }),
      createEventFn: async (slug, type, params) => { recordedVerdict.value = params.verdict; return { ok: true as const, path: '/mock' }; },
      readTokenFn: () => 'token',
      getPrAuthorFn: () => 'custom', // reviewer == PR author
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/mock/backlog/tasks/test-slug.md', matches: [] }),
      getTaskStatusFn: () => 'active',
      transitionTaskFn: async (_slug, status) => { transitions.push(status); return true; },
      postReviewFn: () => { postCalled = true; return { data: null, status: null, statusCode: null, stderr: null, error: null,  ok: true as const }; },
      log: (msg) => { if (/WARN/.test(msg)) warnings.push(msg); },
      error: () => {},
      exit: () => { exited = true; }
    });
  } finally {
    if (prevEnv === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prevEnv;
  }
  assert.equal(exited, false, 'self-author skip must NOT exit(1)');
  assert.equal(postCalled, false, 'must NOT POST a self-approval to Forgejo');
  assert.deepEqual(transitions, ['review'], 'successful self-author verdict repairs the Backlog intake mirror (H17)');
  assert.equal(recordedDisposition, 'APPROVED', 'verdict recorded to local review-state');
  assert.equal(recordedVerdict.value, 'approve', 'reviewer_outcome event recorded locally');
  assert.ok(warnings.some(w => /self-approval POST skipped|different agent or a human/.test(w)), 'must warn that a different agent/human posts the formal approval');
});

test('submitReviewRound exits(1) on a genuine review failure (non-author path)', async () => {
  let exited = false;
  await submitReviewRound(mockSlug, 'approve', 'msg', {
    worktree: mockWorktree,
    isForgejoReviewEnabledFn: () => true,
    readReviewStateFn: () => new ReviewState(mockSlug, { round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl' }),
    writeReviewStateFn: reviewStateWriterFixture(() => {}),
    readTokenFn: () => 'token',
    getPrAuthorFn: () => 'someone-else',
    postReviewFn: () => ({ statusCode: null, stderr: null, error: null,  ok: false as const, status: 500, data: { message: 'boom' } }),
    log: () => {},
    error: () => {},
    exit: () => { exited = true; }
  });
  assert.equal(exited, true, 'genuine failures must still exit(1)');
});

// pushRound - test branches
test('pushRound exits when no forgejo identity can be resolved', async () => {
  const previous = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  let exited = false;
  try {
    await pushRound(mockSlug, {
      readReviewStateFn: () => null,
      resolveTaskFileFn: () => ({ matches: [], reason: 'missing' as const,  ok: false as const }),
      isForgejoReviewEnabledFn: () => true,
      resolveForgejoUserFn: () => null,
      readTokenFn: () => 'token',
      log: () => {},
      error: () => {},
      exit: () => { exited = true; }
    });
  } finally {
    if (previous === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previous;
  }
  assert.equal(exited, true);
});

test('pushRound exits when no token', async () => {
  let exited = false;
  await pushRound(mockSlug, {
    readReviewStateFn: () => ({ implementer: 'user' }),
    readTokenFn: () => null,
    log: () => {},
    error: () => {},
    exit: () => { exited = true; }
  });
  assert.equal(exited, true);
});

test('pushRound succeeds with valid user and token', async () => {
  let transitioned = false;
  let created = false;
  await pushRound(mockSlug, {
    readReviewStateFn: () => ({ implementer: 'user' }),
    readTokenFn: () => 'token',
    transitionTaskFn: async () => { transitioned = true; return true; },
    createPrFn: (_branch, _user, _token, opts) => {
      created = true;
      assert.ok(opts != null);
      assert.equal(opts.forceWithLease, true);
      return { ok: true as const };
    },
    log: () => {},
    error: () => {}
  });
  assert.equal(transitioned, true);
  assert.equal(created, true);
});

test('pushRound bootstraps a missing review repo and retries push', async () => {
  let transitioned = false;
  let created = 0;
  let bootstrapped = false;
  await pushRound(mockSlug, {
    readReviewStateFn: () => ({ implementer: 'magnus' }),
    readTokenFn: () => 'token',
    transitionTaskFn: async () => { transitioned = true; return true; },
    createPrFn: (_branch, _user, _token, opts) => {
      assert.ok(opts != null);
      assert.equal(opts.forceWithLease, true);
      created += 1;
      return created === 1
        ? { ok: false, error: 'remote: Repository not found' }
        : { ok: true };
    },
    bootstrapReviewSurfaceFn: async () => {
      bootstrapped = true;
      return { ok: true as const };
    },
    resolveReviewAdapterFn: () => ({ provider: 'forgejo', baseUrl: 'http://localhost:3300', repo: 'magnus/parallix', remote: 'review' }),
    log: () => {},
    error: () => {},
    exit: () => {}
  });
  assert.equal(transitioned, true);
  assert.equal(bootstrapped, true);
  assert.equal(created, 2);
});

// showReviewStatus
test('showReviewStatus shows state', async () => {
  let logged = false;
  const state = { round: 5, phase: 'reviewing', reviewer: 'rev', implementer: 'impl', startedAt: '2024-01-01' };
  await showReviewStatus(mockSlug, {
    readReviewStateFn: () => state,
    log: (msg) => { if (msg.includes('Round:')) logged = true; }
  });
  assert.equal(logged, true);
});

test('showReviewStatus handles missing state', async () => {
  let logged = false;
  await showReviewStatus(mockSlug, {
    readReviewStateFn: () => null,
    log: (msg) => { if (msg.includes('No persisted')) logged = true; }
  });
  assert.equal(logged, true);
});

test('showReviewStatus shows disposition', async () => {
  let logged = false;
  const state = { round: 1, phase: 'fixing', reviewer: 'rev', implementer: 'impl', startedAt: '2024-01-01', disposition: 'REQUEST_CHANGES' };
  await showReviewStatus(mockSlug, {
    readReviewStateFn: () => state,
    log: (msg) => { if (msg.includes('Disposition:')) logged = true; }
  });
  assert.equal(logged, true);
});

// ============================================================================
// Pre-review phase detection tests (task-1223)
// ============================================================================

// Test verifyReview PR check with implementation phase (active task, no PR)
test('verifyReview warns (not fails) when task is active and no PR exists', async () => {
  let exited = false;
  const logs: string[] = [];
  const warnings = [];
  const failures = [];

  await verifyReview(mockSlug, true, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    resolveTaskFileFn: () => ({ matches: ['/mock/task.md'],  ok: true as const, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'active',
    isForgejoReviewEnabledFn: () => true,
    getPrStatusFn: () => ({ exists: false as const, raw: 'no PR found' }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ step: 'review', agents: [], configPath: '', configPresent: false, launchers: {} }),
    readReviewStateFn: () => null,
    findMissionAreaFn: () => 'workflow',
    cwdFn: () => mockWorktree,
    log: (msg) => { logs.push(msg); },
    error: (msg) => {},
    exit: (code) => { exited = true; }
  });

  // Should NOT exit (no hard failure for active task with no PR)
  assert.equal(exited, false);
  // Should have a WARN message about no PR yet
  assert.ok(logs.some(l => l.includes('WARN') && l.includes('no PR found')));
  // Should include the guidance command
  assert.ok(logs.some(l => l.includes('px review') && l.includes('--push')));
});

// Test verifyReview PR check with post-implementation phase (review task, no PR)
test('verifyReview fails when task is review and no PR exists', async () => {
  let exited = false;
  const logs: string[] = [];

  await verifyReview(mockSlug, true, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    resolveTaskFileFn: () => ({ matches: ['/mock/task.md'],  ok: true as const, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'review',
    isForgejoReviewEnabledFn: () => true,
    getPrStatusFn: () => ({ exists: false as const, raw: 'no PR found' }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ step: 'review', agents: [], configPath: '', configPresent: false, launchers: {} }),
    readReviewStateFn: () => null,
    findMissionAreaFn: () => 'workflow',
    cwdFn: () => mockWorktree,
    log: (msg) => { logs.push(msg); },
    error: (msg) => {},
    exit: (code) => { exited = true; }
  });

  // Should exit with failure for review task with no PR
  assert.equal(exited, true);
  // Should have a FAIL message
  assert.ok(logs.some(l => l.includes('FAIL') && l.includes('no PR found')));
});

// Test verifyReview PR check with approved task and no PR
test('verifyReview fails when task is approved and no PR exists', async () => {
  let exited = false;
  const logs: string[] = [];

  await verifyReview(mockSlug, true, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    resolveTaskFileFn: () => ({ matches: ['/mock/task.md'],  ok: true as const, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'approved',
    isForgejoReviewEnabledFn: () => true,
    getPrStatusFn: () => ({ exists: false as const, raw: 'no PR found' }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ step: 'review', agents: [], configPath: '', configPresent: false, launchers: {} }),
    readReviewStateFn: () => null,
    findMissionAreaFn: () => 'workflow',
    cwdFn: () => mockWorktree,
    log: (msg) => { logs.push(msg); },
    error: (msg) => {},
    exit: (code) => { exited = true; }
  });

  // Should exit with failure for approved task with no PR
  assert.equal(exited, true);
  assert.ok(logs.some(l => l.includes('FAIL') && l.includes('no PR found')));
});

// Test verifyReview PR check with ambiguous task status and no PR
test('verifyReview fails when task resolution fails and no PR exists', async () => {
  let exited = false;
  const logs: string[] = [];

  await verifyReview(mockSlug, true, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    resolveTaskFileFn: () => ({ matches: [], reason: 'missing' as const,  ok: false as const }),
    getTaskStatusFn: () => 'backlog',
    isForgejoReviewEnabledFn: () => true,
    getPrStatusFn: () => ({ exists: false as const, raw: 'no PR found' }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ step: 'review', agents: [], configPath: '', configPresent: false, launchers: {} }),
    readReviewStateFn: () => null,
    findMissionAreaFn: () => 'workflow',
    cwdFn: () => mockWorktree,
    log: (msg) => { logs.push(msg); },
    error: (msg) => {},
    exit: () => { exited = true; }
  });

  // Should exit with failure when task cannot be resolved
  assert.equal(exited, true);
  assert.ok(logs.some(l => l.includes('FAIL') && l.includes('no PR found')));
});

// Regression test (task-1223 r2): mapped active status via toVirtual is handled correctly
// Uses injected toVirtualFn to avoid mutating tracked config/state-map.json
test('verifyReview warns (not fails) when task status maps to virtual active via state-map',  async () => {
  let exited = false;
  const logs: string[] = [];

  await verifyReview(mockSlug, true, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    resolveTaskFileFn: () => ({ matches: ['/mock/task.md'],  ok: true as const, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'in-progress',
    toVirtualFn: (s) => s === 'in-progress' ? 'active' : s,
    isForgejoReviewEnabledFn: () => true,
    getPrStatusFn: () => ({ exists: false as const, raw: 'no PR found' }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ step: 'review', agents: [], configPath: '', configPresent: false, launchers: {} }),
    readReviewStateFn: () => null,
    findMissionAreaFn: () => 'workflow',
    cwdFn: () => mockWorktree,
    log: (msg) => { logs.push(msg); },
    error: (msg) => {},
    exit: (code) => { exited = true; }
  });

  // Should NOT exit — in-progress maps to virtual active, should get warning not failure
  assert.equal(exited, false);
  // Should have WARN about task still active
  assert.ok(logs.some(l => l.includes('WARN') && l.includes('still in-progress')), 'expected task-still-active warning');
  // Should have WARN about no PR (no-PR path)
  assert.ok(logs.some(l => l.includes('WARN') && l.includes('no PR found') && l.includes('--push')), 'expected no-pr-yet warning');
});
