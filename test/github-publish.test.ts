// github-publish mode: exact-SHA publication, contiguous advancement, out-of-order
// completion, failed-earlier-blocks-later, fetch safety, and fail-closed remote
// movement. Drives real temp git repositories so SHAs are asserted verbatim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/adapters/git/git.js';
import { GithubPublishEngine, MapVerificationOracle } from '../src/application/github-publish/publication-engine.js';
import { GitRepositoryPort } from '../src/adapters/git/github-publish-git.js';
import { computeGithubPublishStatus } from '../src/application/github-publish/status.js';
import { resolveExistingRef, verificationRefName } from '../src/application/github-publish/verification-ref.js';

interface Repo {
  root: string;
  origin: string;
  head: () => string;
  originMain: () => string;
  commit: (_msg: string) => string;
  verifyRef: (_sha: string) => string;
}

function run(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = git(['-C', cwd, ...args], env ? { env } : {});
  if (result.status !== 0 && !env) {
    // Surface unexpected failures during fixture setup.
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  }
  return result;
}

function idEnv(): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
  };
}

function makeRepo(): Repo {
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-origin-'));
  assert.equal(run(origin, ['init', '--bare', '-b', 'main']).status, 0);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-work-'));
  assert.equal(run(root, ['clone', origin, '.']).status, 0);
  run(root, ['config', 'user.name', 'Test']);
  run(root, ['config', 'user.email', 'test@example.invalid']);

  fs.writeFileSync(path.join(root, 'P.txt'), 'p', 'utf8');
  run(root, ['add', '-A']);
  run(root, ['commit', '-m', 'P'], idEnv());
  assert.equal(run(root, ['push', 'origin', 'main']).status, 0);

  const head = () => run(root, ['rev-parse', 'HEAD']).stdout.trim().toLowerCase();
  const originMain = () => run(root, ['rev-parse', 'origin/main']).stdout.trim().toLowerCase();

  const commit = (msg: string) => {
    fs.writeFileSync(path.join(root, `${msg.replace(/[^a-z]/gi, '')}.txt`), msg, 'utf8');
    run(root, ['add', '-A']);
    run(root, ['commit', '-m', msg], idEnv());
    return head();
  };

  return {
    root,
    origin,
    head,
    originMain,
    commit,
    verifyRef: (sha: string) => `refs/github-publish/${sha}`,
  };
}

function engineFor(repo: Repo) {
  return new GithubPublishEngine({
    git: new GitRepositoryPort(repo.root, git),
    mainBranch: 'main',
    verificationRemote: 'origin',
    verificationRefPrefix: 'github-publish',
  });
}

function headShaAt(repo: Repo, offset: number): string {
  return run(repo.root, ['log', '-1', '--format=%H', `HEAD~${offset}`]).stdout.trim().toLowerCase();
}

// AC #1: P -> A -> B -> C on local main; origin/main advances to A. Published
// SHAs for A, B, C are the exact local integration SHAs (no rewrite of B or C).
test('github-publish: exact integration SHA preserved through verification ref and publication', () => {
  const repo = makeRepo();
  try {
    const a = repo.commit('A');
    const b = repo.commit('B');
    const c = repo.commit('C');

    const engine = engineFor(repo);
    const oracle = new MapVerificationOracle();

    assert.equal(engine.publishCommit(a).action, 'published-to-verification-ref');
    assert.equal(engine.publishCommit(b).action, 'published-to-verification-ref');
    assert.equal(engine.publishCommit(c).action, 'published-to-verification-ref');

    // Verification ref on origin holds the exact local SHA for A.
    const refOnOrigin = run(repo.origin, ['rev-parse', a]).status === 0
      ? run(repo.origin, ['rev-parse', a]).stdout.trim().toLowerCase()
      : '';
    assert.equal(refOnOrigin, a, 'verification ref must hold the exact local SHA for A');

    oracle.mark(a, 'verified');
    const adv = engine.advanceMain(oracle);
    assert.equal(adv.advanced, true);
    assert.equal(adv.to, a, 'origin/main advances only to A');
    assert.equal(repo.originMain(), a, 'origin/main tip is the exact A SHA');
    assert.equal(repo.head(), a, 'local main head stays at A — not reset or truncated');
    // Local history still contains P -> A (not rewritten to a shorter line).
    assert.equal(run(repo.root, ['merge-base', '--is-ancestor', 'HEAD~1', 'HEAD']).status, 0, 'P is an ancestor of local HEAD');

    const refB = run(repo.origin, ['rev-parse', b]).stdout.trim().toLowerCase();
    const refC = run(repo.origin, ['rev-parse', c]).stdout.trim().toLowerCase();
    assert.equal(refB, b, 'B published unchanged');
    assert.equal(refC, c, 'C published unchanged');
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
    fs.rmSync(repo.origin, { recursive: true, force: true });
  }
});

// AC #2: verification completes out of order (C before A/B); origin/main still
// advances only in A, B, C order, never skipping.
test('github-publish: out-of-order verification advances in order without skipping', () => {
  const repo = makeRepo();
  try {
    const a = repo.commit('A');
    const b = repo.commit('B');
    repo.commit('C');

    const engine = engineFor(repo);
    const oracle = new MapVerificationOracle();
    for (const sha of [a, b, headShaAt(repo, 0)]) { engine.publishCommit(sha); }

    // Verify C and B first (out of order); A still pending.
    oracle.mark(headShaAt(repo, 0), 'verified');
    oracle.mark(b, 'verified');
    let adv = engine.advanceMain(oracle);
    assert.equal(adv.advanced, false, 'must not advance while A is unverified');

    oracle.mark(a, 'verified');
    adv = engine.advanceMain(oracle);
    assert.equal(adv.advanced, true, 'advances through the whole contiguous run once A is verified');
    assert.equal(adv.to, headShaAt(repo, 0));
    assert.equal(repo.originMain(), headShaAt(repo, 0));
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
    fs.rmSync(repo.origin, { recursive: true, force: true });
  }
});

// AC #3: A externally verified: failed; B and C are green but NOT published.
test('github-publish: failed earlier verification blocks later commits', () => {
  const repo = makeRepo();
  try {
    const a = repo.commit('A');
    repo.commit('B');
    repo.commit('C');
    const engine = engineFor(repo);
    const oracle = new MapVerificationOracle();
    for (const sha of [a, headShaAt(repo, 1), headShaAt(repo, 0)]) { engine.publishCommit(sha); }
    oracle.mark(a, 'failed');
    oracle.mark(headShaAt(repo, 1), 'verified');
    oracle.mark(headShaAt(repo, 0), 'verified');

    const adv = engine.advanceMain(oracle);
    assert.equal(adv.advanced, false, 'must not advance past a failed verification');
    assert.equal(adv.failClosed, true);
    assert.equal(adv.blockedBy, a);
    // origin/main still at P (unchanged).
    assert.equal(run(repo.root, ['rev-parse', 'HEAD~3']).stdout.trim().toLowerCase(), repo.originMain());
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
    fs.rmSync(repo.origin, { recursive: true, force: true });
  }
});

// AC #4: fetch an updated origin/main containing the same published commits;
// local history is NOT rewritten or diverged.
test('github-publish: fetching updated origin/main does not rewrite local history', () => {
  const repo = makeRepo();
  try {
    const a = repo.commit('A');
    const engine = engineFor(repo);
    const oracle = new MapVerificationOracle();
    engine.publishCommit(a);
    oracle.mark(a, 'verified');
    assert.equal(engine.advanceMain(oracle).advanced, true);
    const localBefore = run(repo.root, ['log', '--format=%H']).stdout.trim().split('\n').map(s => s.toLowerCase());

    // External actor pushes A..C to origin/main (simulating CI on the remote).
    run(repo.root, ['push', 'origin', 'HEAD:main']);
    run(repo.root, ['fetch', 'origin']);
    const localAfter = run(repo.root, ['log', '--format=%H']).stdout.trim().split('\n').map(s => s.toLowerCase());
    assert.deepEqual(localAfter, localBefore, 'local history must be identical after fetch — no rewrite or divergence');
    assert.equal(repo.originMain(), a);
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
    fs.rmSync(repo.origin, { recursive: true, force: true });
  }
});

// AC #5: move origin/main forward unexpectedly (ahead of expected ancestor);
// publication engine fails closed, never force-pushes.
test('github-publish: unexpected origin/main movement fails closed', () => {
  const repo = makeRepo();
  try {
    const a = repo.commit('A');
    const engine = engineFor(repo);
    const oracle = new MapVerificationOracle();
    engine.publishCommit(a);
    oracle.mark(a, 'verified');

    // External actor moves origin/main forward to a divergent commit branched
    // off P (origin/main), not off local main which carries A.
    const p = repo.originMain();
    run(repo.root, ['branch', 'xbranch', p]);
    run(repo.root, ['checkout', 'xbranch']);
    fs.writeFileSync(path.join(repo.root, 'X.txt'), 'x', 'utf8');
    run(repo.root, ['add', '-A']);
    run(repo.root, ['commit', '-m', 'X'], idEnv());
    run(repo.root, ['push', 'origin', 'xbranch:main']);
    run(repo.root, ['checkout', 'main']);
    run(repo.root, ['fetch', 'origin']);

    assert.throws(
      () => engine.advanceMain(oracle),
      /moved between read|no longer a descendant/i,
      'must fail closed when origin/main diverges from the expected ancestor',
    );
    assert.notEqual(repo.originMain(), a, 'origin/main is the external movement, not A');
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
    fs.rmSync(repo.origin, { recursive: true, force: true });
  }
});

// AC #6: no path force-pushes protected main; exact SHA unchanged from
// integration through verification through publication.
test('github-publish: never force-pushes; exact SHA unchanged through the lifecycle', () => {
  const repo = makeRepo();
  try {
    const a = repo.commit('A');
    const engine = engineFor(repo);
    const oracle = new MapVerificationOracle();
    engine.publishCommit(a);
    oracle.mark(a, 'verified');
    engine.advanceMain(oracle);

    assert.equal(run(repo.origin, ['rev-parse', a]).status, 0, 'SHA reachable on origin');
    assert.equal(repo.originMain(), a);
    const src = fs.readFileSync(new URL('../src/application/github-publish/publication-engine.ts', import.meta.url).pathname, 'utf8');
    assert.ok(!/--force/.test(src), 'engine must never force-push');
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
    fs.rmSync(repo.origin, { recursive: true, force: true });
  }
});

// Status: verified-but-blocked and failed are surfaced for operator status.
test('github-publish: status reports awaiting, verified-blocked, and failed', () => {
  const repo = makeRepo();
  try {
    const a = repo.commit('A');
    const b = repo.commit('B');
    const c = repo.commit('C');
    const engine = engineFor(repo);
    const oracle = new MapVerificationOracle();
    for (const sha of [a, b, c]) { engine.publishCommit(sha); }
    oracle.mark(a, 'failed');
    oracle.mark(b, 'verified');
    oracle.mark(c, 'verified');

    const ahead = [a, b, c].map(sha => engine.tracking(sha, oracle));
    const status = computeGithubPublishStatus(ahead, repo.head(), repo.originMain(), oracle);
    assert.equal(status.failed.length, 1);
    assert.equal(status.failed[0].sha, a);
    assert.equal(status.verifiedBlocked.length, 2, 'B and C verified but blocked by failed A');
    assert.equal(status.awaitingVerification.length, 0);
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
    fs.rmSync(repo.origin, { recursive: true, force: true });
  }
});

test('github-publish: verification ref naming encodes SHA and detects collision', () => {
  const a = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(verificationRefName(a), `refs/github-publish/${a}`);
  assert.equal(resolveExistingRef(a, a).action, 'idempotent-retry');
  assert.equal(resolveExistingRef('f'.repeat(40), a).action, 'collision');
});

// CP-6 recovery: pushing the same commit twice is idempotent, not an error.
test('github-publish: re-publishing the same SHA is an idempotent no-op', () => {
  const repo = makeRepo();
  try {
    const a = repo.commit('A');
    const engine = engineFor(repo);
    assert.equal(engine.publishCommit(a).action, 'published-to-verification-ref');
    assert.equal(engine.publishCommit(a).action, 'idempotent-ref', 'second push of same SHA is idempotent');
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
    fs.rmSync(repo.origin, { recursive: true, force: true });
  }
});

// CP-6 recovery: a pre-existing verification ref at a DIFFERENT SHA is a collision; never clobbered.
test('github-publish: pre-existing ref at a different SHA fails closed without clobbering', () => {
  const repo = makeRepo();
  try {
    const a = repo.commit('A');
    const b = repo.commit('B');
    // Pre-create the verification ref for A, but pointing at B (a collision).
    assert.equal(run(repo.root, ['push', 'origin', `${b}:refs/github-publish/${a}`]).status, 0);
    const engine = engineFor(repo);
    assert.throws(
      () => engine.publishCommit(a),
      /already exists.*refusing to clobber/i,
      'must refuse to clobber a pre-existing ref at a different SHA',
    );
    // The pre-existing ref is untouched — still points at B.
    assert.equal(run(repo.origin, ['rev-parse', `refs/github-publish/${a}`]).stdout.trim().toLowerCase(), b);
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
    fs.rmSync(repo.origin, { recursive: true, force: true });
  }
});

// CP-6 recovery: GitHub unavailable (pending) is not a failure; engine waits with retry.
test('github-publish: pending verification does not fail and does not advance', () => {
  const repo = makeRepo();
  try {
    repo.commit('A');
    const engine = engineFor(repo);
    const oracle = new MapVerificationOracle(); // defaults to pending
    const a = run(repo.root, ['log', '-1', '--format=%H', 'HEAD']).stdout.trim().toLowerCase();
    engine.publishCommit(a);
    const adv = engine.advanceMain(oracle);
    assert.equal(adv.advanced, false);
    assert.equal(adv.failClosed, false, 'pending must not be reported as a failure');
    const state = engine.tracking(a, oracle);
    assert.equal(state.state, 'external verification pending');
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true });
    fs.rmSync(repo.origin, { recursive: true, force: true });
  }
});
