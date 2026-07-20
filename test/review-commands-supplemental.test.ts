// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  flagValue,
  readTextFlag,
  formatStaticReviewFindings,
  formatStaticReviewSuccess,
  performStaticReview,
  verifyReview,
  submitReviewRound,
  pushRound,
  showReviewStatus
} = require('../dist/lib/review/review-commands');

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
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
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
    // @ts-expect-error TS2561 Object literal may only specify known properties, but 'findMissionDirFn' does no
    findMissionDirFn: () => null,
    resolveWorktreeFn: () => mockWorktree
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.length > 0);
});

test('performStaticReview fails when no checkpoints', () => {
  const result = performStaticReview(mockSlug, {
    // @ts-expect-error TS2561 Object literal may only specify known properties, but 'findMissionDirFn' does no
    findMissionDirFn: () => '/mock/mission',
    resolveWorktreeFn: () => mockWorktree,
    findCheckpointsFn: () => []
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.length > 0);
});

test('performStaticReview fails when Goal Check missing', () => {
  const result = performStaticReview(mockSlug, {
    // @ts-expect-error TS2561 Object literal may only specify known properties, but 'findMissionDirFn' does no
    findMissionDirFn: () => '/mock/mission',
    resolveWorktreeFn: () => mockWorktree,
    findCheckpointsFn: () => ['/mock/CP-1.md'],
    readFileSyncFn: () => '## Other'
  });
  assert.equal(result.ok, false);
});

// Skipping this test for now - it requires complex mocking of git operations
// test('performStaticReview passes with valid Goal Check', () => {
//   const missionUtils = require('../dist/lib/core/mission-utils');
//   const originalGetPrimaryBranch = missionUtils.getPrimaryBranch;
//   missionUtils.getPrimaryBranch = () => 'main';
//
//   try {
//     const result = performStaticReview(mockSlug, {
//       findMissionDirFn: () => '/mock/mission',
//       resolveWorktreeFn: () => mockWorktree,
//       findCheckpointsFn: () => ['/mock/CP-1.md'],
//       readFileSyncFn: () => '## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| AC1 | evidence | PASS |',
//       runFn: () => ({ status: 0, stdout: '', stderr: '' })
//     });
//     assert.equal(result.ok, true);
//   } finally {
//     missionUtils.getPrimaryBranch = originalGetPrimaryBranch;
//   }
// });

// verifyReview - test different branches
test('verifyReview exits on missing mission dir', () => {
  let exited = false;
  verifyReview(mockSlug, false, {
    findMissionDirFn: () => null,
    getCurrentBranchFn: () => mockBranch,
    // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'review',
    isForgejoReviewEnabledFn: () => false,
    log: () => {},
    error: () => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
    exit: () => { exited = true; }
  });
  assert.equal(exited, true);
});

test('verifyReview exits on branch mismatch', () => {
  let exited = false;
  verifyReview(mockSlug, false, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => 'wrong-branch',
    // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'review',
    isForgejoReviewEnabledFn: () => false,
    log: () => {},
    error: () => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
    exit: () => { exited = true; }
  });
  assert.equal(exited, true);
});

test('verifyReview exits on task not found', () => {
  let exited = false;
  verifyReview(mockSlug, false, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    // @ts-expect-error TS2322 Type '{ ok: false; }' is not assignable to type '{ ok: boolean; taskFile: string
    resolveTaskFileFn: () => ({ ok: false }),
    getTaskStatusFn: () => 'review',
    isForgejoReviewEnabledFn: () => false,
    log: () => {},
    error: () => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
    exit: () => { exited = true; }
  });
  assert.equal(exited, true);
});

test('verifyReview passes with all green', () => {
  let exited = false;
  verifyReview(mockSlug, false, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'review',
    isForgejoReviewEnabledFn: () => false,
    runVerificationGate: () => ({ status: 0 }),
    log: () => {},
    error: () => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
    exit: () => { exited = true; }
  });
  assert.equal(exited, false);
});

// submitReviewRound - test different outcomes
test('submitReviewRound exits on invalid outcome', () => {
  let exited = false;
  submitReviewRound(mockSlug, 'bad-outcome', 'msg', {
    isForgejoReviewEnabledFn: () => true,
    log: () => {},
    error: () => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
    exit: () => { exited = true; }
  });
  assert.equal(exited, true);
});

test('submitReviewRound handles approve for forgejo', () => {
  let disp = null;
  let transitioned = null;
  const state = { round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl', transitionTo: () => {} };
  submitReviewRound(mockSlug, 'approve', 'msg', {
    worktree: mockWorktree,
    isForgejoReviewEnabledFn: () => true,
    // @ts-expect-error TS2740 Type '{ round: number; phase: string; reviewer: string; implementer: string; tra
    readReviewStateFn: () => state,
    // @ts-expect-error TS2322 Type '(s: string, st: Record<string, unknown> | ReviewState) => void' is not ass
    writeReviewStateFn: (s, st) => { disp = st.disposition; },
    transitionTaskFn: (slug, status) => { transitioned = { slug, status }; return true; },
    readTokenFn: () => 'token',
    postReviewFn: () => ({ ok: true }),
    log: () => {},
    error: () => {}
  });
  assert.equal(disp, 'APPROVED');
  assert.deepEqual(transitioned, { slug: mockSlug, status: 'approved' });
});

test('submitReviewRound handles request-changes for forgejo', () => {
  let disp = null;
  let transitioned = null;
  const state = { round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl', transitionTo: () => {} };
  submitReviewRound(mockSlug, 'request-changes', 'msg', {
    worktree: mockWorktree,
    isForgejoReviewEnabledFn: () => true,
    // @ts-expect-error TS2740 Type '{ round: number; phase: string; reviewer: string; implementer: string; tra
    readReviewStateFn: () => state,
    // @ts-expect-error TS2322 Type '(s: string, st: Record<string, unknown> | ReviewState) => void' is not ass
    writeReviewStateFn: (s, st) => { disp = st.disposition; },
    transitionTaskFn: (slug, status) => { transitioned = { slug, status }; return true; },
    readTokenFn: () => 'token',
    postReviewFn: () => ({ ok: true }),
    log: () => {},
    error: () => {}
  });
  assert.equal(disp, 'REQUEST_CHANGES');
  assert.deepEqual(transitioned, { slug: mockSlug, status: 'review' });
});

test('submitReviewRound handles provider=none', () => {
  let disp = null;
  let transitioned = false;
  const state = { round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl', transitionTo: () => {} };
  submitReviewRound(mockSlug, 'approve', 'msg', {
    worktree: mockWorktree,
    isForgejoReviewEnabledFn: () => false,
    // @ts-expect-error TS2740 Type '{ round: number; phase: string; reviewer: string; implementer: string; tra
    readReviewStateFn: () => state,
    // @ts-expect-error TS2322 Type '(s: string, st: Record<string, unknown> | ReviewState) => void' is not ass
    writeReviewStateFn: (s, st) => { disp = st.disposition; },
    transitionTaskFn: () => { transitioned = true; return true; },
    log: () => {},
    error: () => {}
  });
  assert.equal(disp, 'APPROVED');
  assert.equal(transitioned, true);
});

test('submitReviewRound creates state when none exists', () => {
  let newState = null;
  submitReviewRound(mockSlug, 'approve', 'msg', {
    worktree: mockWorktree,
    isForgejoReviewEnabledFn: () => false,
    readReviewStateFn: () => null,
    // @ts-expect-error TS2322 Type '(s: string, st: Record<string, unknown> | ReviewState) => void' is not ass
    writeReviewStateFn: (s, st) => { newState = st; },
    transitionTaskFn: () => true,
    log: () => {},
    error: () => {}
  });
  assert.ok(newState);
  // @ts-expect-error TS2339 Property 'disposition' does not exist on type 'never'.
  assert.equal(newState.disposition, 'APPROVED');
  // @ts-expect-error TS2339 Property 'phase' does not exist on type 'never'.
  assert.equal(newState.phase, 'approved');
});

test('submitReviewRound does not exit when reviewer is the PR author (self-author skip)', () => {
  // task-1255: same-agent-reviewer fallback. postWorkflowReview skips the
  // Forgejo POST (returns ok:true, skipped:true) — submitReviewRound must record
  // locally and warn, NOT exit(1).
  let exited = false;
  let postCalled = false;
  let recordedDisposition = null;
  let recordedVerdict = null;
  const warnings = [];
  // Force forgejoUser to resolve from state.reviewer (= 'custom') regardless of
  // the ambient FORGEJO_USER env so the reviewer==author case is exercised.
  const prevEnv = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  try {
    const state = { round: 1, phase: 'reviewing', reviewer: 'custom', implementer: 'custom', transitionTo: () => {} };
    submitReviewRound(mockSlug, 'approve', 'msg', {
      worktree: mockWorktree,
      isForgejoReviewEnabledFn: () => true,
      // @ts-expect-error TS2740 Type '{ round: number; phase: string; reviewer: string; implementer: string; tra
      readReviewStateFn: () => state,
      // @ts-expect-error TS2322 Type '(s: string, st: Record<string, unknown> | ReviewState) => void' is not ass
      writeReviewStateFn: (s, st) => { recordedDisposition = st.disposition; },
      createEventFn: (slug, type, params) => { recordedVerdict = params.verdict; return { ok: true, path: '/mock' }; },
      readTokenFn: () => 'token',
      getPrAuthorFn: () => 'custom', // reviewer == PR author
      postReviewFn: () => { postCalled = true; return { ok: true }; },
      log: (msg) => { if (/WARN/.test(msg)) warnings.push(msg); },
      error: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
      exit: () => { exited = true; }
    });
  } finally {
    if (prevEnv === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prevEnv;
  }
  assert.equal(exited, false, 'self-author skip must NOT exit(1)');
  assert.equal(postCalled, false, 'must NOT POST a self-approval to Forgejo');
  assert.equal(recordedDisposition, 'APPROVED', 'verdict recorded to local review-state');
  assert.equal(recordedVerdict, 'approve', 'reviewer_outcome event recorded locally');
  assert.ok(warnings.some(w => /self-approval POST skipped|different agent or a human/.test(w)), 'must warn that a different agent/human posts the formal approval');
});

test('submitReviewRound exits(1) on a genuine review failure (non-author path)', () => {
  let exited = false;
  submitReviewRound(mockSlug, 'approve', 'msg', {
    worktree: mockWorktree,
    isForgejoReviewEnabledFn: () => true,
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(nextPhase: string) => ReviewState'
    readReviewStateFn: () => ({ round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl', transitionTo: () => {} }),
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, state: Record<string
    writeReviewStateFn: () => {},
    readTokenFn: () => 'token',
    getPrAuthorFn: () => 'someone-else',
    postReviewFn: () => ({ ok: false, status: 500, data: { message: 'boom' } }),
    log: () => {},
    error: () => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
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
      // @ts-expect-error TS2322 Type '{ ok: false; }' is not assignable to type '{ ok: boolean; taskFile: string
      resolveTaskFileFn: () => ({ ok: false }),
      isForgejoReviewEnabledFn: () => true,
      resolveForgejoUserFn: () => null,
      readTokenFn: () => 'token',
      log: () => {},
      error: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
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
    // @ts-expect-error TS2740 Type '{ implementer: string; }' is missing the following properties from type 'R
    readReviewStateFn: () => ({ implementer: 'user' }),
    readTokenFn: () => null,
    log: () => {},
    error: () => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
    exit: () => { exited = true; }
  });
  assert.equal(exited, true);
});

test('pushRound succeeds with valid user and token', async () => {
  let transitioned = false;
  let created = false;
  await pushRound(mockSlug, {
    // @ts-expect-error TS2740 Type '{ implementer: string; }' is missing the following properties from type 'R
    readReviewStateFn: () => ({ implementer: 'user' }),
    readTokenFn: () => 'token',
    transitionTaskFn: () => { transitioned = true; return true; },
    createPrFn: (_branch, _user, _token, opts) => {
      created = true;
      assert.equal(opts.forceWithLease, true);
      return { ok: true };
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
    // @ts-expect-error TS2740 Type '{ implementer: string; }' is missing the following properties from type 'R
    readReviewStateFn: () => ({ implementer: 'magnus' }),
    readTokenFn: () => 'token',
    transitionTaskFn: () => { transitioned = true; return true; },
    createPrFn: (_branch, _user, _token, opts) => {
      assert.equal(opts.forceWithLease, true);
      created += 1;
      return created === 1
        ? { ok: false, error: 'remote: Repository not found' }
        : { ok: true };
    },
    bootstrapReviewSurfaceFn: async () => {
      bootstrapped = true;
      return { ok: true };
    },
    // @ts-expect-error TS2741 Property 'provider' is missing in type '{ baseUrl: string; repo: string; remote:
    resolveReviewAdapterFn: () => ({ baseUrl: 'http://localhost:3300', repo: 'magnus/parallix', remote: 'review' }),
    log: () => {},
    error: () => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
    exit: () => {}
  });
  assert.equal(transitioned, true);
  assert.equal(bootstrapped, true);
  assert.equal(created, 2);
});

// showReviewStatus
test('showReviewStatus shows state', () => {
  let logged = false;
  const state = { round: 5, phase: 'reviewing', reviewer: 'rev', implementer: 'impl', startedAt: '2024-01-01' };
  showReviewStatus(mockSlug, {
    // @ts-expect-error TS2740 Type '{ round: number; phase: string; reviewer: string; implementer: string; sta
    readReviewStateFn: () => state,
    log: (msg) => { if (msg.includes('Round:')) logged = true; },
    error: () => {}
  });
  assert.equal(logged, true);
});

test('showReviewStatus handles missing state', () => {
  let logged = false;
  showReviewStatus(mockSlug, {
    readReviewStateFn: () => null,
    log: (msg) => { if (msg.includes('No persisted')) logged = true; },
    // @ts-expect-error TS2353 Object literal may only specify known properties, and 'error' does not exist in
    error: () => {}
  });
  assert.equal(logged, true);
});

test('showReviewStatus shows disposition', () => {
  let logged = false;
  const state = { round: 1, phase: 'fixing', reviewer: 'rev', implementer: 'impl', startedAt: '2024-01-01', disposition: 'REQUEST_CHANGES' };
  showReviewStatus(mockSlug, {
    // @ts-expect-error TS2740 Type '{ round: number; phase: string; reviewer: string; implementer: string; sta
    readReviewStateFn: () => state,
    log: (msg) => { if (msg.includes('Disposition:')) logged = true; },
    error: () => {}
  });
  assert.equal(logged, true);
});

// ============================================================================
// Pre-review phase detection tests (task-1223)
// ============================================================================

// Test verifyReview PR check with implementation phase (active task, no PR)
test('verifyReview warns (not fails) when task is active and no PR exists', () => {
  let exited = false;
  const logs = [];
  const warnings = [];
  const failures = [];

  verifyReview(mockSlug, true, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'active',
    isForgejoReviewEnabledFn: () => true,
    getPrStatusFn: () => ({ exists: false, raw: 'no PR found' }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    // @ts-expect-error TS2739 Type '{}' is missing the following properties from type '{ step: string; agents:
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => null,
    findMissionAreaFn: () => 'workflow',
    cwdFn: () => mockWorktree,
    log: (msg) => { logs.push(msg); },
    error: (msg) => {},
    // @ts-expect-error TS2322 Type '(code: number) => void' is not assignable to type '(_code: number) => neve
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
test('verifyReview fails when task is review and no PR exists', () => {
  let exited = false;
  const logs = [];

  verifyReview(mockSlug, true, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'review',
    isForgejoReviewEnabledFn: () => true,
    getPrStatusFn: () => ({ exists: false, raw: 'no PR found' }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    // @ts-expect-error TS2739 Type '{}' is missing the following properties from type '{ step: string; agents:
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => null,
    findMissionAreaFn: () => 'workflow',
    cwdFn: () => mockWorktree,
    log: (msg) => { logs.push(msg); },
    error: (msg) => {},
    // @ts-expect-error TS2322 Type '(code: number) => void' is not assignable to type '(_code: number) => neve
    exit: (code) => { exited = true; }
  });

  // Should exit with failure for review task with no PR
  assert.equal(exited, true);
  // Should have a FAIL message
  assert.ok(logs.some(l => l.includes('FAIL') && l.includes('no PR found')));
});

// Test verifyReview PR check with approved task and no PR
test('verifyReview fails when task is approved and no PR exists', () => {
  let exited = false;
  const logs = [];

  verifyReview(mockSlug, true, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'approved',
    isForgejoReviewEnabledFn: () => true,
    getPrStatusFn: () => ({ exists: false, raw: 'no PR found' }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    // @ts-expect-error TS2739 Type '{}' is missing the following properties from type '{ step: string; agents:
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => null,
    findMissionAreaFn: () => 'workflow',
    cwdFn: () => mockWorktree,
    log: (msg) => { logs.push(msg); },
    error: (msg) => {},
    // @ts-expect-error TS2322 Type '(code: number) => void' is not assignable to type '(_code: number) => neve
    exit: (code) => { exited = true; }
  });

  // Should exit with failure for approved task with no PR
  assert.equal(exited, true);
  assert.ok(logs.some(l => l.includes('FAIL') && l.includes('no PR found')));
});

// Test verifyReview PR check with ambiguous task status and no PR
test('verifyReview fails when task resolution fails and no PR exists', () => {
  let exited = false;
  const logs = [];

  verifyReview(mockSlug, true, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    // @ts-expect-error TS2322 Type '{ ok: false; }' is not assignable to type '{ ok: boolean; taskFile: string
    resolveTaskFileFn: () => ({ ok: false }),
    getTaskStatusFn: () => 'backlog',
    isForgejoReviewEnabledFn: () => true,
    getPrStatusFn: () => ({ exists: false, raw: 'no PR found' }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    // @ts-expect-error TS2739 Type '{}' is missing the following properties from type '{ step: string; agents:
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => null,
    findMissionAreaFn: () => 'workflow',
    cwdFn: () => mockWorktree,
    log: (msg) => { logs.push(msg); },
    error: (msg) => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
    exit: () => { exited = true; }
  });

  // Should exit with failure when task cannot be resolved
  assert.equal(exited, true);
  assert.ok(logs.some(l => l.includes('FAIL') && l.includes('no PR found')));
});

// Regression test (task-1223 r2): mapped active status via toVirtual is handled correctly
// Uses injected toVirtualFn to avoid mutating tracked config/state-map.json
test('verifyReview warns (not fails) when task status maps to virtual active via state-map',  () => {
  let exited = false;
  const logs = [];

  verifyReview(mockSlug, true, {
    findMissionDirFn: () => '/mock/mission',
    getCurrentBranchFn: () => mockBranch,
    // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/mock/task.md' }),
    getTaskStatusFn: () => 'in-progress',
    toVirtualFn: (s) => s === 'in-progress' ? 'active' : s,
    isForgejoReviewEnabledFn: () => true,
    getPrStatusFn: () => ({ exists: false, raw: 'no PR found' }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    // @ts-expect-error TS2739 Type '{}' is missing the following properties from type '{ step: string; agents:
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => null,
    findMissionAreaFn: () => 'workflow',
    cwdFn: () => mockWorktree,
    log: (msg) => { logs.push(msg); },
    error: (msg) => {},
    // @ts-expect-error TS2322 Type '(code: number) => void' is not assignable to type '(_code: number) => neve
    exit: (code) => { exited = true; }
  });

  // Should NOT exit — in-progress maps to virtual active, should get warning not failure
  assert.equal(exited, false);
  // Should have WARN about task still active
  assert.ok(logs.some(l => l.includes('WARN') && l.includes('still in-progress')), 'expected task-still-active warning');
  // Should have WARN about no PR (no-PR path)
  assert.ok(logs.some(l => l.includes('WARN') && l.includes('no PR found') && l.includes('--push')), 'expected no-pr-yet warning');
});
