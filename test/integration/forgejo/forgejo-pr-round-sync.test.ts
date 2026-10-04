import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { runReviewLoop } from '../../../src/application/review-loop/review-loop.js';
import type { ReviewAgentLaunch, ReviewLoopRequest } from '../../../src/application/ports/review-round.js';
import type { PullRequestReference } from '../../../src/domain/review.js';
import { fakeReviewLoopPorts } from '../../helpers/review-loop-ports.js';
const forgejo = mockModule<typeof import('../../../src/adapters/forgejo/forgejo.js')>('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
const reviewAdapter = mockModule<typeof import('../../../src/adapters/review/review-adapter.js')>('../../../src/adapters/review/review-adapter.js', import.meta.url);
const reviewLoopModule = mockModule<typeof import('../../../src/adapters/review/review-loop.js')>('../../../src/adapters/review/review-loop.js', import.meta.url);
await installModuleMocks();
const { createReviewLoopPorts } = reviewLoopModule;
const { mock } = test;
test.afterEach(() => mock.restoreAll());

// Reproduction test for task-2240: when Forgejo is activated, the mission
// pull request is not updated between agent rounds. Each round's committed
// source changes should be pushed to the PR branch before the next round
// begins, so a human reviewer sees the current diff.
//
// SC1: the mission branch is published at the round boundary (after a
//      CHANGES_MADE disposition).
// SC2: With Forgejo activated, round-one committed changes are pushed to the
//      PR branch before round two starts.
// SC3: A second completed round updates the same PR rather than creating a
//      replacement.
// SC4: Forgejo-inactive and non-CHANGES_MADE dispositions do not trigger the
//      round-boundary push path.
//
// The application loop decides when a revision is published; the Forgejo
// provider mechanism decides how (refs, lease, stale-info retry).

const TEST_SLUG = `task-2240-test-${process.pid}`;

/**
 * A provider-enabled loop over fake ports. `publishes` records every revision
 * the loop decided to publish; `head` reports a new revision per read unless
 * the scenario says the implementer committed nothing.
 */
function roundLoop(options: { reviews: string[]; dispositions?: string[]; providerEnabled?: boolean; newRevision?: boolean; publish?: () => { ok: boolean; status: number | null; detail: string } }) {
  const publishes: number[] = [];
  let head = 0;
  const fake = fakeReviewLoopPorts({
    slug: TEST_SLUG,
    routing: { eligibleFamilies: () => ['codex', 'claude', 'gemini', 'custom'] },
    provider: options.providerEnabled === false ? null : {
      pollReview: async () => options.reviews.shift()!,
      pollDisposition: async () => options.dispositions?.shift() ?? null,
      publishRevision: () => { publishes.push(1); return options.publish?.() ?? { ok: true, status: 0, detail: '' }; },
    },
    ...(options.providerEnabled === false ? {
      artifacts: {
        consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: options.reviews.shift()! }),
        consumeImplementer: async () => ({ consumed: true, ok: true, disposition: options.dispositions?.shift() ?? null }),
      },
    } : {}),
    handoff: { handoff: async () => ({ ok: true }) },
    agents: { launch: async () => ({ agent: null }) },
    preReview: { head: () => (options.newRevision === false ? 'head-unchanged' : `head-${++head}`) },
  });
  return { fake, publishes, run: (request: Partial<ReviewLoopRequest> = {}) => runReviewLoop({ slug: TEST_SLUG, implementer: 'claude', reviewer: 'codex', ...request }, fake.ports) };
}

// ---------------------------------------------------------------------------
// SC1 + SC2: Push happens after CHANGES_MADE disposition (round boundary)
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: mission branch is pushed after implementer CHANGES_MADE before next round', async () => {
  const { publishes, run, fake } = roundLoop({ reviews: ['REQUEST_CHANGES', 'APPROVED'], dispositions: ['CHANGES_MADE'] });
  await run();

  // Round 1: CHANGES_MADE publishes the revision before round 2; round 2's
  // approval exits without another publication.
  assert.equal(publishes.length, 1, `Expected 1 publication after the CHANGES_MADE disposition; got ${publishes.length}.`);
  assert.ok(fake.logs.some(line => line.includes(`Round 1: pushed mission branch mission/${TEST_SLUG} to review remote.`)), fake.logs.join(' | '));
});

// ---------------------------------------------------------------------------
// SC3: Same PR updated across multiple rounds (not replaced)
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: second round updates the same PR, not a replacement', async () => {
  const { publishes, run } = roundLoop({ reviews: ['REQUEST_CHANGES', 'REQUEST_CHANGES', 'APPROVED'], dispositions: ['CHANGES_MADE', 'CHANGES_MADE'] });
  await run({ maxAttempts: 3 });
  assert.equal(publishes.length, 2, `Expected 2 publications for 2 CHANGES_MADE rounds; got ${publishes.length}.`);
});

// ---------------------------------------------------------------------------
// SC4a: Forgejo-inactive mission does not trigger the round-boundary push
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: no push when Forgejo is not activated', async () => {
  const { fake, run } = roundLoop({ providerEnabled: false, reviews: ['REQUEST_CHANGES', 'APPROVED'], dispositions: ['CHANGES_MADE'] });
  await run();
  assert.equal(fake.ports.provider, null, 'a Forgejo-inactive loop has no provider to publish through');
  assert.ok(!fake.logs.some(line => /push/i.test(line)), `Expected no push line when Forgejo is inactive: ${fake.logs.join(' | ')}`);
});

// ---------------------------------------------------------------------------
// SC4b-e: Non-CHANGES_MADE outcomes do not trigger the push
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: no push after APPROVED disposition (loop exits)', async () => {
  const { publishes, run } = roundLoop({ reviews: ['APPROVED'] });
  await run();
  assert.equal(publishes.length, 0, 'an immediate approval exits the loop without publishing');
});

for (const disposition of ['BLOCKED', 'PARKED', 'PUSHBACK_ALL']) {
  test(`Forgejo PR round sync: no push after ${disposition} disposition (loop exits)`, async () => {
    const { publishes, run } = roundLoop({ reviews: ['REQUEST_CHANGES', 'APPROVED'], dispositions: [disposition] });
    await run({ maxAttempts: 1 });
    assert.equal(publishes.length, 0, `${disposition} never publishes a revision at the round boundary`);
  });
}

// ---------------------------------------------------------------------------
// F1/F2: The Forgejo provider publishes the mission branch with a lease and
// recovers a stale-info rejection once before forcing.
// ---------------------------------------------------------------------------
function boundProvider(worktree: string, providerSlug: string = TEST_SLUG, log: (_line: string) => void = () => {}) {
  mock.method(reviewAdapter, 'isProviderEnabled', () => true);
  mock.method(reviewAdapter, 'readToken', () => 'token');
  return createReviewLoopPorts(providerSlug, { worktree }, { log, error: () => {} }).provider!;
}

test('Forgejo PR round sync: the provider pushes the mission branch to the same review ref with a lease and token', () => {
  const pushCalls: Array<{ sourceRef: string; destinationRef: string; opts: Record<string, unknown> }> = [];
  mock.method(forgejo, 'pushReviewRef', (sourceRef: string, destinationRef: string, _rootDir: string, opts: Record<string, unknown>) => {
    pushCalls.push({ sourceRef, destinationRef, opts });
    return { status: 0, stdout: '', stderr: '' };
  });
  const provider = boundProvider(os.tmpdir());

  assert.deepEqual(provider.publishRevision(), { ok: true, status: 0, detail: '' });
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].sourceRef, pushCalls[0].destinationRef, 'the PR ref is the mission branch itself: one PR identity');
  assert.match(pushCalls[0].sourceRef, /^mission\//);
  assert.ok(pushCalls[0].opts.forceWithLease, 'Push should use --force-with-lease to avoid non-fast-forward rejections after rebase');
  assert.equal(pushCalls[0].opts.token, 'token', 'Push should include an authenticated token');
});

test('Forgejo PR round sync: stale-info rejection triggers fetch-retry then succeeds', () => {
  const pushCalls: Array<Record<string, unknown>> = [];
  const fetchCalls: string[] = [];
  mock.method(forgejo, 'pushReviewRef', (_source: string, _destination: string, _rootDir: string, opts: Record<string, unknown>) => {
    pushCalls.push(opts);
    return pushCalls.length === 1
      ? { status: 1, stdout: '', stderr: ' ! [rejected]        main -> main (stale info)' }
      : { status: 0, stdout: '', stderr: '' };
  });
  mock.method(forgejo, 'fetchReviewBranch', (branch: string) => { fetchCalls.push(branch); return { status: 0, stdout: '', stderr: '' }; });
  const provider = boundProvider(os.tmpdir());

  assert.equal(provider.publishRevision()?.ok, true);
  assert.equal(pushCalls.length, 2, `Expected 2 pushes (initial + retry after stale); got ${pushCalls.length}`);
  assert.equal(fetchCalls.length, 1, `Expected 1 fetchReviewBranch call after stale rejection; got ${fetchCalls.length}`);
  assert.ok(pushCalls[0].forceWithLease, 'Initial push should use forceWithLease');
  assert.ok(pushCalls[1].forceWithLease, 'Retry push should also use forceWithLease');
});

test('Forgejo PR round sync: push failure after all retries logs WARN and does not throw', async () => {
  let pushes = 0;
  mock.method(forgejo, 'pushReviewRef', () => { pushes += 1; return { status: 1, stdout: '', stderr: 'push failed: connection reset' }; });
  const provider = boundProvider(os.tmpdir());
  const failed = provider.publishRevision();
  assert.deepEqual(failed, { ok: false, status: 1, detail: 'push failed: connection reset' });
  assert.equal(pushes, 1, 'a non-stale failure is not retried');

  // The loop reports the failed publication and continues to the next round.
  const { run, fake } = roundLoop({ reviews: ['REQUEST_CHANGES', 'APPROVED'], dispositions: ['CHANGES_MADE'], publish: () => failed! });
  await run();
  assert.ok(fake.logs.some(line => line.includes('could not push') && line.includes('push failed: connection reset')), `Expected WARN about push failure: ${fake.logs.join(' | ')}`);
  assert.ok(fake.logs.some(line => line.includes('APPROVED')), 'the loop continues to the next round after a failed publication');
});

// ---------------------------------------------------------------------------
// F1: No-new-commit guard — CHANGES_MADE with no committed change skips push
// ---------------------------------------------------------------------------
test('Forgejo PR round sync: no push when CHANGES_MADE but hasNewCommittedChange is false', async () => {
  const { publishes, run, fake } = roundLoop({ reviews: ['REQUEST_CHANGES', 'APPROVED'], dispositions: ['CHANGES_MADE'], newRevision: false });
  await run();
  assert.equal(publishes.length, 0, 'CHANGES_MADE disposition with no new committed change must skip the push.');
  assert.deepEqual(fake.stops, ['implementer reported CHANGES_MADE with no new revision']);
});

// ---------------------------------------------------------------------------
// Real-Git reproduction (SC1–SC3): the bound Forgejo provider and the real
// branch HEAD drive the round-boundary publication into a bare review remote.
// ---------------------------------------------------------------------------
function realGitWorktree(slug: string, prefix: string, withRemote: boolean) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const branch = `mission/${slug}`;
  const sh = (cmd: string, cwd: string) => childProcess.execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const remoteDir = path.join(tmpDir, 'remote.git');
  const worktree = path.join(tmpDir, 'worktree');
  fs.mkdirSync(worktree, { recursive: true });
  sh('git init', worktree);
  sh("git config user.email 'test@test.com'", worktree);
  sh("git config user.name 'Test'", worktree);
  fs.writeFileSync(path.join(worktree, 'README.md'), 'initial');
  sh('git add README.md', worktree);
  sh("git commit -m 'initial'", worktree);
  sh(`git checkout -b ${branch}`, worktree);
  if (withRemote) {
    fs.mkdirSync(remoteDir);
    sh('git init --bare', remoteDir);
    sh(`git remote add review ${remoteDir}`, worktree);
    sh(`git push review ${branch}`, worktree);
  }
  return { tmpDir, branch, sh, remoteDir, worktree };
}

/** The real provider and branch HEAD over fake ports for everything else. */
function realGitLoop(slug: string, worktree: string, branch: string, reviews: string[], dispositions: string[], launch: (_launch: ReviewAgentLaunch) => void) {
  const bound = boundProvider(worktree, slug);
  const headPort = createReviewLoopPorts(slug, { worktree }, { log: () => {}, error: () => {} }).preReview;
  const fake = fakeReviewLoopPorts({
    slug,
    worktree,
    routing: { eligibleFamilies: () => ['codex', 'claude', 'gemini', 'custom'] },
    handoff: { handoff: async () => ({ ok: true }) },
    agents: { launch: async request => { launch(request); return { agent: null }; } },
    preReview: { head: () => headPort.head() },
    output: { log: line => { if (process.env.DEBUG_SYNC) { console.error(line); } }, error: line => { if (process.env.DEBUG_SYNC) { console.error(line); } } },
  });
  // An open PR keeps the start handoff off: this reproduction exercises the
  // round-boundary push, not the handoff/PR-create path.
  const provider = { ...bound, pollReview: async () => reviews.shift()!, pollDisposition: async () => dispositions.shift() ?? null, openPullRequest: (): PullRequestReference => ({ kind: 'pull-request', provider: 'forgejo', id: '7', url: null, sourceBranch: branch, targetBranch: 'main' }), ensureReachable: async () => true };
  return { ...fake.ports, provider };
}

test('Forgejo PR round sync: PR ref publishes round-one commit before round two and accumulates both round commits (real Git)', async () => {
  const slug = `${TEST_SLUG}-real-git`;
  const { tmpDir, branch, sh, remoteDir, worktree } = realGitWorktree(slug, 'forgejo-sync-', true);
  try {
    const initialHead = sh('git rev-parse HEAD', worktree);
    const pushed: string[] = [];
    mock.method(forgejo, 'pushReviewRef', (sourceRef: string, destinationRef: string, rootDir: string) => {
      // Push to the real review remote so the ref reflects the PR branch state.
      sh(`git -C ${rootDir} push review ${sourceRef}:${destinationRef} --force-with-lease`, rootDir);
      pushed.push(destinationRef);
      return { status: 0, stdout: '', stderr: '' };
    });
    // Reviewer launches observe the remote ref at each round boundary; the
    // implementer launches create distinct per-round commits.
    let reviewLaunches = 0;
    let actOnReviewLaunches = 0;
    const remoteRefAtRoundStart: Record<number, string> = {};
    const remoteHead = () => sh(`git -C ${remoteDir} rev-parse ${branch}`, remoteDir);
    const ports = realGitLoop(slug, worktree, branch, ['REQUEST_CHANGES', 'REQUEST_CHANGES', 'APPROVED'], ['CHANGES_MADE', 'CHANGES_MADE'], launch => {
      if (launch.role === 'reviewer') {
        remoteRefAtRoundStart[++reviewLaunches] = remoteHead();
        return;
      }
      const file = `round${++actOnReviewLaunches}-change.txt`;
      fs.writeFileSync(path.join(worktree, file), `round ${actOnReviewLaunches} fix`);
      sh(`git -C ${worktree} add ${file}`, worktree);
      sh(`git -C ${worktree} commit -m 'round ${actOnReviewLaunches} fix'`, worktree);
      if (actOnReviewLaunches === 1) { sh(`git -C ${worktree} tag round1 HEAD`, worktree); }
    });

    await runReviewLoop({ slug, implementer: 'claude', reviewer: 'codex', maxAttempts: 3 }, ports);

    assert.deepEqual(pushed, [branch, branch], 'two CHANGES_MADE rounds publish to the same PR ref (one PR identity)');
    const round1Commit = sh(`git -C ${worktree} rev-parse -q --verify round1^{commit}`, worktree);
    assert.notEqual(remoteRefAtRoundStart[2], initialHead, 'At round-two start the remote PR ref must have advanced past the initial commit');
    assert.equal(remoteRefAtRoundStart[2], round1Commit, 'At round-two start the remote PR ref must equal round-one\'s committed SHA (SC1/SC2)');
    const finalRemoteHead = remoteHead();
    assert.equal(finalRemoteHead, sh(`git -C ${worktree} rev-parse HEAD`, worktree), 'Final PR ref matches the round-two branch HEAD');
    childProcess.execSync(`git -C ${remoteDir} merge-base --is-ancestor ${round1Commit} ${finalRemoteHead}`, { cwd: remoteDir });
    const finalTree = sh(`git -C ${remoteDir} ls-tree -r --name-only ${finalRemoteHead}`, remoteDir).split('\n');
    assert.ok(finalTree.includes('round1-change.txt'), 'Final PR ref tree contains round-one change');
    assert.ok(finalTree.includes('round2-change.txt'), 'Final PR ref tree contains round-two change');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Forgejo PR round sync: production default skips push when CHANGES_MADE advances no commit (real Git)', async () => {
  const slug = `${TEST_SLUG}-real-git-nochange`;
  const { tmpDir, worktree, branch } = realGitWorktree(slug, 'forgejo-sync-nc-', false);
  try {
    let pushes = 0;
    mock.method(forgejo, 'pushReviewRef', () => { pushes += 1; return { status: 0, stdout: '', stderr: '' }; });
    // The implementer runs but commits nothing — branch HEAD does not advance.
    const ports = realGitLoop(slug, worktree, branch, ['REQUEST_CHANGES', 'APPROVED'], ['CHANGES_MADE'], () => {});
    await runReviewLoop({ slug, implementer: 'claude', reviewer: 'codex' }, ports);
    assert.equal(pushes, 0, 'The no-new-revision guard must not push when the branch HEAD did not move.');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
  const { publishes, run, fake } = roundLoop({ reviews: ['REQUEST_CHANGES'], dispositions: ['CHANGES_MADE'], newRevision: false });
  await run({ maxAttempts: 1, isContinue: true });
  assert.ok(fake.logs.some(line => line.includes('Skipping implementer launch')), fake.logs.join(' | '));
  assert.equal(publishes.length, 1, 'The resume guard must fall open so the committed round change is published.');
});
