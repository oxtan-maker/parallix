import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startReviewLoop } from '../src/platform/runtime/lib/review/review.js';

// Reproduction test for task-2240: when Forgejo is activated, the mission
// pull request is not updated between agent rounds. Each round's committed
// source changes should be pushed to the PR branch before the next round
// begins, so a human reviewer sees the current diff.
//
// SC1: This test fails at the mission parent commit because pushReviewRefFn
//       is not called at the round boundary (after CHANGES_MADE disposition).
//       After the fix, pushReviewRefFn is called and the assertion passes.
// SC2: With Forgejo activated, round-one committed changes are pushed to the
//       PR branch before round two starts.
// SC3: A second completed round updates the same PR rather than creating a
//       replacement.
// SC4: Forgejo-inactive and non-CHANGES_MADE dispositions do not trigger the
//       round-boundary push path.

const TEST_SLUG = `task-2240-test-${process.pid}`;

// ---------------------------------------------------------------------------
// Helper: build a standard set of injected dependencies for startReviewLoop
// ---------------------------------------------------------------------------
// The injected bag is a deliberately partial set of stubs, so it is typed as a
// loose record rather than startReviewLoop's full options type — the same shape
// test/task-2239-rereview-after-response.test.ts uses.
function baseLoopOpts(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'custom'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md', matches: ['/tmp/task.md'] }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'gemini',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    startAgentFn: async (step: string, options: { agent: string }) => {
      return { agent: null };
    },
    applyAgentFallbackFn: (args: { original: string }) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    log: () => {},
    error: () => {},
    exit: () => {},
    consumeReviewerArtifactsFn: async () => ({ consumed: false }),
    consumeImplementerArtifactsFn: async () => ({ consumed: false }),
    runPreReviewGateFn: async () => ({ ok: true, area: 'lib', command: 'echo ok', exitCode: 0, stdout: '', stderr: '' }),
    handleGateFailureAutoBounceFn: async () => ({ bounced: false, stranded: false }),
    recordStageStatsSafeFn: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SC1 + SC2: Push happens after CHANGES_MADE disposition (round boundary)
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: mission branch is pushed after implementer CHANGES_MADE before next round', async () => {
  const pushCalls: Array<{ sourceRef: string; destinationRef: string; rootDir: string; opts: Record<string, unknown> }> = [];
  const pushReviewRefFn = (sourceRef: string, destinationRef: string, rootDir: string, opts: Record<string, unknown>) => {
    pushCalls.push({ sourceRef, destinationRef, rootDir, opts });
    return { status: 0, stdout: '', stderr: '' };
  };

  const reviewOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
  const dispositions = ['CHANGES_MADE'];

  await startReviewLoop(TEST_SLUG, {
    ...baseLoopOpts({
      pollForReviewFn: async () => reviewOutcomes.shift()!,
      pollForDispositionFn: async () => dispositions.shift()!,
      pushReviewRefFn,
      // This mocked implementer does not advance real git HEAD, so use the
      // test seam to declare a new commit and isolate the push wiring. The
      // real branch-HEAD boundary comparison is covered by the real-Git tests.
      hasNewCommittedChangeFn: () => true,
    }),
  });

  // After round 1: implementer returned CHANGES_MADE, so pushReviewRef should
  // be called to push the mission branch to the PR before round 2 begins.
  // Round 2: reviewer returns APPROVED — loop exits without another push.
  assert.ok(
    pushCalls.length >= 1,
    `Expected at least 1 pushReviewRef call after CHANGES_MADE disposition; got ${pushCalls.length}. ` +
    `The mission branch must be pushed to the review remote between rounds so the PR diff is current.`
  );

  const firstPush = pushCalls[0];
  assert.equal(
    firstPush.sourceRef,
    `mission/${TEST_SLUG}`,
    'Source ref should be the mission branch'
  );
  assert.equal(
    firstPush.destinationRef,
    `mission/${TEST_SLUG}`,
    'Destination ref should be the same mission branch on the review remote'
  );
  assert.ok(
    firstPush.opts && firstPush.opts.forceWithLease,
    'Push should use --force-with-lease to avoid non-fast-forward rejections after rebase'
  );
  assert.ok(
    firstPush.opts && firstPush.opts.token,
    'Push should include an authenticated token'
  );
});

// ---------------------------------------------------------------------------
// SC3: Same PR updated across multiple rounds (not replaced)
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: second round updates the same PR, not a replacement', async () => {
  const pushCalls: Array<{ sourceRef: string; destinationRef: string; rootDir: string; opts: Record<string, unknown> }> = [];
  const pushReviewRefFn = (sourceRef: string, destinationRef: string, rootDir: string, opts: Record<string, unknown>) => {
    pushCalls.push({ sourceRef, destinationRef, rootDir, opts });
    return { status: 0, stdout: '', stderr: '' };
  };

  // Three rounds: round 1 CHANGES_MADE, round 2 CHANGES_MADE, round 3 APPROVED
  const reviewOutcomes = ['REQUEST_CHANGES', 'REQUEST_CHANGES', 'APPROVED'];
  const dispositions = ['CHANGES_MADE', 'CHANGES_MADE'];

  await startReviewLoop(TEST_SLUG, {
    ...baseLoopOpts({
      maxAttempts: 3,
      pollForReviewFn: async () => reviewOutcomes.shift()!,
      pollForDispositionFn: async () => dispositions.shift()!,
      pushReviewRefFn,
      // Mocked implementer; use the test seam to declare a new commit. The real
      // branch-HEAD boundary comparison is covered by the real-Git tests.
      hasNewCommittedChangeFn: () => true,
    }),
  });

  // Two CHANGES_MADE dispositions → two push calls
  assert.equal(
    pushCalls.length,
    2,
    `Expected 2 pushReviewRef calls for 2 CHANGES_MADE rounds; got ${pushCalls.length}. ` +
    `Each completed round should push to the same PR branch.`
  );

  // Both pushes target the same branch — proving the PR is updated, not replaced
  assert.equal(
    pushCalls[0].destinationRef,
    pushCalls[1].destinationRef,
    'Both rounds should push to the same destination ref (same PR branch)'
  );
});

// ---------------------------------------------------------------------------
// SC4a: Forgejo-inactive mission does not trigger the round-boundary push
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: no push when Forgejo is not activated', async () => {
  const pushCalls: number[] = [];
  const pushReviewRefFn = () => {
    pushCalls.push(1);
    return { status: 0, stdout: '', stderr: '' };
  };

  await startReviewLoop(TEST_SLUG, {
    ...baseLoopOpts({
      isForgejoReviewEnabledFn: () => false,
      pollForReviewFn: async () => 'APPROVED',
      pushReviewRefFn,
    }),
  });

  assert.equal(
    pushCalls.length,
    0,
    `Expected 0 pushReviewRef calls when Forgejo is inactive; got ${pushCalls.length}. ` +
    `The round-boundary push must be gated by activated Forgejo state.`
  );
});

// ---------------------------------------------------------------------------
// SC4b: Non-CHANGES_MADE dispositions (APPROVED) do not trigger the push
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: no push after APPROVED disposition (loop exits)', async () => {
  const pushCalls: number[] = [];
  const pushReviewRefFn = () => {
    pushCalls.push(1);
    return { status: 0, stdout: '', stderr: '' };
  };

  // Reviewer approves on the first round — no implementer round, no push
  await startReviewLoop(TEST_SLUG, {
    ...baseLoopOpts({
      pollForReviewFn: async () => 'APPROVED',
      pushReviewRefFn,
    }),
  });

  assert.equal(
    pushCalls.length,
    0,
    `Expected 0 pushReviewRef calls when reviewer approves immediately; got ${pushCalls.length}. ` +
    `APPROVED disposition exits the loop — no round-boundary push needed.`
  );
});

// ---------------------------------------------------------------------------
// SC4c: Non-CHANGES_MADE dispositions (BLOCKED) do not trigger the push
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: no push after BLOCKED disposition (loop exits)', async () => {
  const pushCalls: number[] = [];
  const pushReviewRefFn = () => {
    pushCalls.push(1);
    return { status: 0, stdout: '', stderr: '' };
  };

  await startReviewLoop(TEST_SLUG, {
    ...baseLoopOpts({
      pollForReviewFn: async () => 'REQUEST_CHANGES',
      pollForDispositionFn: async () => 'BLOCKED',
      pushReviewRefFn,
    }),
  });

  assert.equal(
    pushCalls.length,
    0,
    `Expected 0 pushReviewRef calls when implementer reports BLOCKED; got ${pushCalls.length}. ` +
    `BLOCKED disposition exits the loop — no round-boundary push needed.`
  );
});

// ---------------------------------------------------------------------------
// SC4d: Non-CHANGES_MADE dispositions (PARKED) do not trigger the push
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: no push after PARKED disposition (loop exits)', async () => {
  const pushCalls: number[] = [];
  const pushReviewRefFn = () => {
    pushCalls.push(1);
    return { status: 0, stdout: '', stderr: '' };
  };

  await startReviewLoop(TEST_SLUG, {
    ...baseLoopOpts({
      pollForReviewFn: async () => 'REQUEST_CHANGES',
      pollForDispositionFn: async () => 'PARKED',
      pushReviewRefFn,
    }),
  });

  assert.equal(
    pushCalls.length,
    0,
    `Expected 0 pushReviewRef calls when implementer reports PARKED; got ${pushCalls.length}. ` +
    `PARKED disposition exits the loop — no round-boundary push needed.`
  );
});

// ---------------------------------------------------------------------------
// SC4e: PUSHBACK_ALL disposition does not trigger the push
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: no push after PUSHBACK_ALL disposition (loop exits)', async () => {
  const pushCalls: number[] = [];
  const pushReviewRefFn = () => {
    pushCalls.push(1);
    return { status: 0, stdout: '', stderr: '' };
  };

  await startReviewLoop(TEST_SLUG, {
    ...baseLoopOpts({
      pollForReviewFn: async () => 'REQUEST_CHANGES',
      pollForDispositionFn: async () => 'PUSHBACK_ALL',
      pushReviewRefFn,
    }),
  });

  assert.equal(
    pushCalls.length,
    0,
    `Expected 0 pushReviewRef calls when implementer pushes back; got ${pushCalls.length}. ` +
    `PUSHBACK_ALL disposition exits the loop — no round-boundary push needed.`
  );
});

// ---------------------------------------------------------------------------
// F1: Stale-info retry — first push rejected, fetch-retry succeeds
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: stale-info rejection triggers fetch-retry then succeeds', async () => {
  const pushCalls: Array<{ sourceRef: string; destinationRef: string; rootDir: string; opts: Record<string, unknown> }> = [];
  let staleRoundSeen = false;
  const pushReviewRefFn = (sourceRef: string, destinationRef: string, rootDir: string, opts: Record<string, unknown>) => {
    pushCalls.push({ sourceRef, destinationRef, rootDir, opts });
    // First call overall: stale info rejection
    if (!staleRoundSeen) {
      staleRoundSeen = true;
      return { status: 1, stdout: '', stderr: ' ! [rejected]        main -> main (stale info)' };
    }
    // All subsequent calls: success
    return { status: 0, stdout: '', stderr: '' };
  };

  const fetchCalls: Array<{ branch: string; rootDir: string; opts: Record<string, unknown> }> = [];
  const fetchReviewBranchFn = (branch: string, rootDir: string, opts: Record<string, unknown>) => {
    fetchCalls.push({ branch, rootDir, opts });
    return { status: 0, stdout: '', stderr: '' };
  };

  const isStaleInfoPushRejectionFn = (result: { status: number; stderr: string; stdout: string }) => {
    return result && result.status !== 0 && /stale info/i.test(result.stderr || result.stdout || '');
  };

  // One round: REQUEST_CHANGES → CHANGES_MADE, then APPROVED exits loop
  const reviewOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
  const dispositions = ['CHANGES_MADE'];

  await startReviewLoop(TEST_SLUG, {
    ...baseLoopOpts({
      pollForReviewFn: async () => reviewOutcomes.shift()!,
      pollForDispositionFn: async () => dispositions.shift()!,
      pushReviewRefFn,
      isStaleInfoPushRejectionFn,
      fetchReviewBranchFn,
      // Mocked implementer; declare a new commit via the seam to isolate the
      // stale-info retry mechanics from the branch-HEAD boundary comparison.
      hasNewCommittedChangeFn: () => true,
    }),
  });

  // First push rejected as stale → fetch → retry succeeds → round 2 APPROVED exits
  assert.equal(
    pushCalls.length,
    2,
    `Expected 2 pushReviewRef calls (initial + retry after stale); got ${pushCalls.length}`
  );
  assert.equal(
    fetchCalls.length,
    1,
    `Expected 1 fetchReviewBranch call after stale rejection; got ${fetchCalls.length}`
  );
  assert.ok(
    pushCalls[0].opts && pushCalls[0].opts.forceWithLease,
    'Initial push should use forceWithLease'
  );
  assert.ok(
    pushCalls[1].opts && pushCalls[1].opts.forceWithLease,
    'Retry push should also use forceWithLease'
  );
});

// ---------------------------------------------------------------------------
// F2: Push result status check — non-zero status routes to WARN
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: push failure after all retries logs WARN and does not throw', async () => {
  const pushCalls: Array<{ sourceRef: string; destinationRef: string; rootDir: string; opts: Record<string, unknown> }> = [];
  const pushReviewRefFn = (sourceRef: string, destinationRef: string, rootDir: string, opts: Record<string, unknown>) => {
    pushCalls.push({ sourceRef, destinationRef, rootDir, opts });
    // All calls fail with non-zero status (not stale-info)
    return { status: 1, stdout: '', stderr: 'push failed: connection reset' };
  };

  const isStaleInfoPushRejectionFn = (result: { status: number; stderr: string; stdout: string }) => {
    return result && result.status !== 0 && /stale info/i.test(result.stderr || result.stdout || '');
  };

  const logMessages: Array<string | unknown> = [];
  const log = (msg: unknown) => logMessages.push(msg);

  // One round: REQUEST_CHANGES → CHANGES_MADE, then APPROVED exits loop
  const reviewOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
  const dispositions = ['CHANGES_MADE'];

  await startReviewLoop(TEST_SLUG, {
    ...baseLoopOpts({
      pollForReviewFn: async () => reviewOutcomes.shift()!,
      pollForDispositionFn: async () => dispositions.shift()!,
      pushReviewRefFn,
      isStaleInfoPushRejectionFn,
      log,
      // Mocked implementer; declare a new commit via the seam to isolate the
      // push-failure WARN path from the branch-HEAD boundary comparison.
      hasNewCommittedChangeFn: () => true,
    }),
  });

  // Only 1 push (no stale-info retry since stderr doesn't match)
  assert.equal(
    pushCalls.length,
    1,
    `Expected 1 pushReviewRef call; got ${pushCalls.length}`
  );
  // WARN message should be emitted for non-zero status
  const pushWarnMsg = logMessages.find((m) => typeof m === 'string' && m.includes('could not push'));
  assert.ok(
    pushWarnMsg,
    `Expected WARN about push failure in logs; got: ${logMessages.filter((m) => typeof m === 'string' && m.includes('WARN')).join('; ')}`
  );
});

// ---------------------------------------------------------------------------
// F1: No-new-commit guard — CHANGES_MADE with no committed change skips push
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: no push when CHANGES_MADE but hasNewCommittedChange is false', async () => {
  const pushCalls: number[] = [];
  const pushReviewRefFn = () => {
    pushCalls.push(1);
    return { status: 0, stdout: '', stderr: '' };
  };

  // hasNewCommittedChangeFn returns false → no eligible new commit
  const hasNewCommittedChangeFn = () => false;

  const reviewOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
  const dispositions = ['CHANGES_MADE'];

  await startReviewLoop(TEST_SLUG, {
    ...baseLoopOpts({
      pollForReviewFn: async () => reviewOutcomes.shift()!,
      pollForDispositionFn: async () => dispositions.shift()!,
      pushReviewRefFn,
      hasNewCommittedChangeFn,
    }),
  });

  assert.equal(
    pushCalls.length,
    0,
    `Expected 0 pushReviewRef calls when hasNewCommittedChange is false; got ${pushCalls.length}. ` +
    `CHANGES_MADE disposition with no new committed change must skip the push.`
  );
});

// ---------------------------------------------------------------------------
// F2 / SC1–SC3: Real-Git red-to-green reproduction.
//
// This is the primary reproduction for SC1 (publication before round two),
// SC2 (round-one commit on the PR ref), and SC3 (same PR ref accumulates both
// round commits — one PR identity, not a replacement). It runs the PRODUCTION
// default no-new-commit path (no hasNewCommittedChangeFn injection), so the
// push is driven by the real branch-HEAD boundary comparison in review-loop.ts.
//
// At the mission parent commit this test is red: without the round-boundary
// push, the review remote never advances past the initial commit, so the
// round-two boundary assertion and the "both commits on the ref" assertion both
// fail. After the fix it is green.
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: PR ref publishes round-one commit before round two and accumulates both round commits (real Git)', async () => {
  const slug = `${TEST_SLUG}-real-git`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-sync-'));
  const branch = `mission/${slug}`;

  const sh = (cmd: string, cwd: string) => childProcess.execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

  // Create a bare "review remote" repo
  const remoteDir = path.join(tmpDir, 'remote.git');
  fs.mkdirSync(remoteDir);
  sh('git init --bare', remoteDir);

  // Create the mission worktree repo with initial commit
  const worktree = path.join(tmpDir, 'worktree');
  fs.mkdirSync(worktree);
  sh('git init', worktree);
  sh("git config user.email 'test@test.com'", worktree);
  sh("git config user.name 'Test'", worktree);
  fs.writeFileSync(path.join(worktree, 'README.md'), 'initial');
  sh('git add README.md', worktree);
  sh("git commit -m 'initial'", worktree);
  sh(`git checkout -b ${branch}`, worktree);
  sh(`git remote add review ${remoteDir}`, worktree);
  // Push initial state to review remote (the PR's starting point)
  sh(`git push review ${branch}`, worktree);

  const initialHead = sh('git rev-parse HEAD', worktree);
  const round1Sha = () => {
    try { return sh(`git -C ${worktree} rev-parse -q --verify round1^{commit}`, worktree); }
    catch { return null; }
  };

  const pushedShas: Array<{ sourceRef: string; destinationRef: string; headSha: string; opts: Record<string, unknown> }> = [];
  const pushReviewRefFn = (sourceRef: string, destinationRef: string, rootDir: string, opts: Record<string, unknown>) => {
    const headSha = sh(`git -C ${rootDir} rev-parse ${sourceRef}`, rootDir);
    // Push to the real review remote so the ref reflects the PR branch state.
    sh(`git -C ${rootDir} push review ${sourceRef}:${destinationRef} --force-with-lease`, rootDir);
    pushedShas.push({ sourceRef, destinationRef, headSha, opts });
    return { status: 0, stdout: '', stderr: '' };
  };

  // Three rounds: REQUEST_CHANGES → REQUEST_CHANGES → APPROVED.
  const reviewOutcomes = ['REQUEST_CHANGES', 'REQUEST_CHANGES', 'APPROVED'];
  const dispositions = ['CHANGES_MADE', 'CHANGES_MADE'];

  // startAgentFn is invoked for the reviewer (step='review') at the start of
  // each round's reviewing phase, then for the implementer (step='act-on-review').
  // We use the reviewer launches to observe the remote ref at each round
  // boundary, and the implementer launches to create distinct per-round commits.
  let reviewLaunches = 0;
  let actOnReviewLaunches = 0;
  const remoteRefAtRoundStart: Record<number, string> = {}; // round number -> remote branch SHA when that round's reviewer began
  const remoteHead = () => sh(`git -C ${remoteDir} rev-parse ${branch}`, remoteDir);

  const startAgentFn = async (step: string) => {
    if (step === 'review') {
      reviewLaunches++;
      // Record the remote ref exactly when this round's reviewer begins.
      remoteRefAtRoundStart[reviewLaunches] = remoteHead();
    } else if (step === 'act-on-review') {
      actOnReviewLaunches++;
      // Each implementer round commits a distinct source change.
      const file = `round${actOnReviewLaunches}-change.txt`;
      fs.writeFileSync(path.join(worktree, file), `round ${actOnReviewLaunches} fix`);
      sh(`git -C ${worktree} add ${file}`, worktree);
      sh(`git -C ${worktree} commit -m 'round ${actOnReviewLaunches} fix'`, worktree);
      if (actOnReviewLaunches === 1) {
        // Tag round one's commit so we can assert it is an ancestor of the final ref.
        sh(`git -C ${worktree} tag round1 HEAD`, worktree);
      }
    }
    return { agent: null };
  };

  await startReviewLoop(slug, {
    ...baseLoopOpts({
      maxAttempts: 3,
      worktree,
      pollForReviewFn: async () => reviewOutcomes.shift()!,
      pollForDispositionFn: async () => dispositions.shift()!,
      pushReviewRefFn,
      startAgentFn,
    }),
  });

  // Two CHANGES_MADE rounds → two pushes, both to the same destination ref
  // (one PR identity — SC3, not a replacement).
  assert.equal(pushedShas.length, 2, `Expected 2 pushes (one per CHANGES_MADE round); got ${pushedShas.length}`);
  assert.equal(pushedShas[0].destinationRef, branch, 'Round-one push targets the PR branch');
  assert.equal(pushedShas[1].destinationRef, branch, 'Round-two push targets the same PR branch');
  assert.equal(
    pushedShas[0].destinationRef, pushedShas[1].destinationRef,
    'Both rounds push to the same PR ref (same PR identity, not a replacement)'
  );

  // SC1 boundary: when round two's reviewer began, the remote ref must already
  // contain round one's committed change (i.e. it advanced past the initial
  // commit). This is the assertion that is red at the mission parent commit.
  const round1Commit = round1Sha();
  assert.ok(round1Commit, 'Round-one implementer commit (tag round1) should exist');
  assert.notEqual(
    remoteRefAtRoundStart[2], initialHead,
    'At round-two start the remote PR ref must have advanced past the initial commit (round-one change published before round two)'
  );
  assert.equal(
    remoteRefAtRoundStart[2], round1Commit,
    'At round-two start the remote PR ref must equal round-one\'s committed SHA (SC1/SC2: published before round two begins)'
  );

  // SC3: after both rounds, the same PR ref contains BOTH round commits.
  const finalRemoteHead = remoteHead();
  const round2Head = sh(`git -C ${worktree} rev-parse HEAD`, worktree);
  assert.equal(finalRemoteHead, round2Head, 'Final PR ref matches the round-two branch HEAD');
  // round1 is an ancestor of the final ref, and round2 (the file) is present in its tree.
  childProcess.execSync(`git -C ${remoteDir} merge-base --is-ancestor ${round1Commit} ${finalRemoteHead}`, { cwd: remoteDir });
  const finalTree = sh(`git -C ${remoteDir} ls-tree -r --name-only ${finalRemoteHead}`, remoteDir).split('\n');
  assert.ok(finalTree.includes('round1-change.txt'), 'Final PR ref tree contains round-one change');
  assert.ok(finalTree.includes('round2-change.txt'), 'Final PR ref tree contains round-two change');
});

// ---------------------------------------------------------------------------
// F1 / SC4: PRODUCTION default no-new-commit guard (no injection).
//
// Exercises the real branch-HEAD boundary comparison in review-loop.ts: a
// CHANGES_MADE round in which the implementer commits NOTHING must not push,
// because the PR ref would not change. hasNewCommittedChangeFn is NOT injected,
// so this proves the default path — not a test-only seam — skips the push.
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: production default skips push when CHANGES_MADE advances no commit (real Git)', async () => {
  const slug = `${TEST_SLUG}-real-git-nochange`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-sync-nc-'));
  const branch = `mission/${slug}`;
  const sh = (cmd: string, cwd: string) => childProcess.execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

  const worktree = path.join(tmpDir, 'worktree');
  fs.mkdirSync(worktree, { recursive: true });
  sh('git init', worktree);
  sh("git config user.email 'test@test.com'", worktree);
  sh("git config user.name 'Test'", worktree);
  fs.writeFileSync(path.join(worktree, 'README.md'), 'initial');
  sh('git add README.md', worktree);
  sh("git commit -m 'initial'", worktree);
  sh(`git checkout -b ${branch}`, worktree);

  const pushCalls: number[] = [];
  const pushReviewRefFn = () => { pushCalls.push(1); return { status: 0, stdout: '', stderr: '' }; };

  const reviewOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
  const dispositions = ['CHANGES_MADE'];

  // Implementer runs but commits nothing — branch HEAD does not advance.
  const startAgentFn = async () => ({ agent: null });

  await startReviewLoop(slug, {
    ...baseLoopOpts({
      worktree,
      pollForReviewFn: async () => reviewOutcomes.shift()!,
      pollForDispositionFn: async () => dispositions.shift()!,
      pushReviewRefFn,
      startAgentFn,
      // NOTE: hasNewCommittedChangeFn intentionally NOT injected — this
      // exercises the production default boundary comparison.
    }),
  });

  assert.equal(
    pushCalls.length,
    0,
    `Expected 0 pushes when the CHANGES_MADE round advanced no commit; got ${pushCalls.length}. ` +
    `The production default guard must not push when the branch HEAD did not move.`
  );
});

// ---------------------------------------------------------------------------
// F1 (round 4): Resume with existing disposition — push must still fire.
//
// When the implementer is skipped on --continue because a CHANGES_MADE
// disposition already exists, the HEAD snapshot was captured at the
// already-advanced post-implementer HEAD. The no-new-commit guard must fall
// open so the push still fires.
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: resume with existing CHANGES_MADE still pushes (implementer skipped)', async () => {
  const pushCalls: Array<{ sourceRef: string; destinationRef: string; opts: Record<string, unknown> }> = [];
  const pushReviewRefFn = (sourceRef: string, destinationRef: string, _rootDir: string, opts: Record<string, unknown>) => {
    pushCalls.push({ sourceRef, destinationRef, opts });
    return { status: 0, stdout: '', stderr: '' };
  };

  // Simulate --continue: isContinue=true, disposition already exists.
  // The pollForDispositionFn immediately returns CHANGES_MADE, so the
  // implementer is never launched. The guard must fall open and push.
  await startReviewLoop(TEST_SLUG, {
    ...baseLoopOpts({
      maxAttempts: 1,
      isContinue: true,
      forgejoEnabled: true,
      token: 'test-token',
      prNumber: 42,
      // Returns existing disposition → implementer skipped
      pollForReviewFn: async () => 'REQUEST_CHANGES',
      pollForDispositionFn: async () => 'CHANGES_MADE',
      pushReviewRefFn,
      // NOTE: hasNewCommittedChangeFn intentionally NOT injected — this
      // exercises the production default path. The resume guard must fall
      // open even though the HEAD snapshot comparison would report no change.
    }),
  });

  assert.equal(
    pushCalls.length,
    1,
    `Expected 1 push when resuming with existing CHANGES_MADE disposition; got ${pushCalls.length}. ` +
    `The resume guard must fall open so the committed round change is published.`
  );
});
