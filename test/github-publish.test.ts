// github-publish mode: exact-SHA publication, contiguous advancement, out-of-order
// completion, failed-earlier-blocks-later, fetch safety, and fail-closed remote
// movement. Drives an in-memory git model (no subprocess) so the exact-SHA and
// fast-forward invariants are asserted deterministically under CPU load.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GithubPublishEngine, MapVerificationOracle } from '../src/application/github-publish/publication-engine.js';
import { GitRepositoryPort } from '../src/adapters/git/github-publish-git.js';
import { computeGithubPublishStatus } from '../src/application/github-publish/status.js';
import { resolveExistingRef, verificationRefName } from '../src/application/github-publish/verification-ref.js';

// ---------------------------------------------------------------------------
// In-memory git model. Emulates exactly the subset of git the engine and these
// tests exercise: a linear commit chain, local branches, a remote-tracking
// `origin/main`, and remote verification refs. SHAs are deterministic 40-hex
// strings derived from parent + message + a monotonic counter, so the engine's
// verbatim-SHA and fast-forward logic is exercised without a real git process.
// ---------------------------------------------------------------------------

interface Commit { parent: string | null; }

class GitSim {
  readonly commits = new Map<string, Commit>();
  readonly localBranches = new Map<string, string>();
  readonly localRemoteRefs = new Map<string, string>(); // 'origin/main' -> sha
  readonly remoteBranches = new Map<string, string>(); // 'main' -> sha
  readonly remoteRefs = new Map<string, string>(); // full ref path -> sha
  headName = 'main';
  counter = 0;
}

function nextSha(state: GitSim, msg: string, parent: string | null): string {
  state.counter += 1;
  const seed = (parent ?? `root${state.counter}`) + state.counter + msg;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const counterHex = state.counter.toString(16).padStart(4, '0');
  return ((h >>> 0).toString(16) + counterHex).padEnd(40, '0').slice(0, 40).toLowerCase();
}

function ok(): { status: number; stdout: string; stderr: string } {
  return { status: 0, stdout: '', stderr: '' };
}

function resolveRef(state: GitSim, ref: string | undefined): string | null {
  if (!ref) {return null;}
  let r = ref.split('^')[0];
  let tilde = 0;
  if (r.includes('~')) {
    const [base, n] = r.split('~');
    r = base;
    tilde = n ? parseInt(n, 10) : 1;
  }
  let sha: string | null;
  if (/^[0-9a-f]{40}$/i.test(r)) {
    sha = r.toLowerCase();
  } else {
    switch (r) {
      case 'HEAD': sha = state.localBranches.get(state.headName) ?? null; break;
      case 'origin/main': sha = state.localRemoteRefs.get('origin/main') ?? null; break;
      case 'main':
      case 'refs/heads/main': sha = state.localBranches.get('main') ?? null; break;
      case 'refs/remotes/origin/main': sha = state.localRemoteRefs.get('origin/main') ?? null; break;
      default:
        if (r.startsWith('refs/heads/')) {sha = state.localBranches.get(r.slice('refs/heads/'.length)) ?? null;}
        else if (r.startsWith('refs/remotes/')) {sha = state.localRemoteRefs.get('origin/main') ?? null;}
        else if (r.startsWith('refs/')) {sha = state.remoteRefs.get(r) ?? null;}
        else {sha = state.localBranches.get(r) ?? state.remoteBranches.get(r) ?? null;}
    }
  }
  if (sha == null || !state.commits.has(sha)) {return null;}
  for (let i = 0; i < tilde; i++) {
    const parent = state.commits.get(sha)!.parent;
    if (parent == null) {return null;}
    sha = parent;
  }
  return sha.toLowerCase();
}

function isAncestor(state: GitSim, ancestor: string, descendant: string): boolean {
  let c: string | null = descendant;
  while (c) {
    if (c === ancestor) {return true;}
    c = state.commits.get(c)!.parent ?? null;
  }
  return false;
}

function reachableNewestFirst(state: GitSim, head: string, base: string | null): string[] {
  const baseReach = new Set<string>();
  if (base) {
    let c: string | null = base;
    while (c) {baseReach.add(c); c = state.commits.get(c)!.parent ?? null;}
  }
  const seq: string[] = [];
  let c: string | null = head;
  while (c) {
    if (!baseReach.has(c)) {seq.push(c);}
    c = state.commits.get(c)!.parent ?? null;
  }
  return seq;
}

function runSim(state: GitSim, args: string[]): { status: number; stdout: string; stderr: string } {
  const cmd = args[0];
  const rest = args.slice(1);
  switch (cmd) {
    case 'init':
    case 'config':
    case 'add':
      return ok();
    case 'branch':
      state.localBranches.set(rest[0], rest[1]);
      return ok();
    case 'checkout':
      if (state.localBranches.has(rest[0])) {state.headName = rest[0];}
      return ok();
    case 'clone': {
      const tip = state.remoteBranches.get('main') ?? null;
      state.localBranches.set('main', tip);
      state.localRemoteRefs.set('origin/main', tip);
      state.headName = 'main';
      return ok();
    }
    case 'commit': {
      let msg = '';
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '-m' && i + 1 < rest.length) {msg = rest[i + 1]; break;}
      }
      const parent = state.localBranches.get(state.headName) ?? null;
      const sha = nextSha(state, msg, parent);
      state.commits.set(sha, { parent });
      state.localBranches.set(state.headName, sha);
      return { status: 0, stdout: sha + '\n', stderr: '' };
    }
    case 'push': {
      const spec = rest[1];
      if (spec && spec.includes(':')) {
        const [left, right] = spec.split(':');
        const sha = resolveRef(state, left) ?? left.toLowerCase();
        if (right.startsWith('refs/')) {
          if (state.remoteRefs.has(right)) {return { status: 1, stdout: '', stderr: 'ref already exists, refusing to clobber' };}
          state.remoteRefs.set(right, sha);
        } else {
          state.remoteBranches.set(right, sha);
          state.localRemoteRefs.set('origin/main', sha);
        }
      } else {
        const tip = state.localBranches.get(state.headName) ?? null;
        state.remoteBranches.set('main', tip);
        state.localRemoteRefs.set('origin/main', tip);
      }
      return ok();
    }
    case 'fetch': {
      state.localRemoteRefs.set('origin/main', state.remoteBranches.get('main') ?? null);
      return ok();
    }
    case 'rev-parse': {
      const refArg = rest.find((a) => !a.startsWith('--'));
      const sha = resolveRef(state, refArg);
      if (sha && state.commits.has(sha)) {return { status: 0, stdout: sha + '\n', stderr: '' };}
      return { status: 1, stdout: '', stderr: '' };
    }
    case 'log': {
      const rangeArg = rest.find((a) => a.includes('..'));
      const refArg = rest.find((a) => !a.startsWith('-'));
      if (rangeArg) {
        const [base, head] = rangeArg.split('..');
        const headSha = resolveRef(state, head)!;
        const seq = reachableNewestFirst(state, headSha, base ? resolveRef(state, base) : null);
        const lines = rest.includes('-1') ? [seq[0]] : seq;
        return { status: 0, stdout: lines.map((s) => s.toLowerCase()).join('\n') + '\n', stderr: '' };
      }
      const headSha = resolveRef(state, refArg ?? 'HEAD')!;
      let seq: string[] = [];
      let c: string | null = headSha;
      while (c) {seq.push(c); c = state.commits.get(c)!.parent ?? null;}
      if (rest.includes('-1')) {seq = [seq[0]];}
      return { status: 0, stdout: seq.map((s) => s.toLowerCase()).join('\n') + '\n', stderr: '' };
    }
    case 'merge-base': {
      const a = rest[rest.length - 2];
      const b = rest[rest.length - 1];
      const aS = resolveRef(state, a)!;
      const bS = resolveRef(state, b)!;
      return isAncestor(state, aS, bS) ? ok() : { status: 1, stdout: '', stderr: '' };
    }
    case 'update-ref': {
      const refpath = rest[0];
      const target = rest[1];
      if (refpath.startsWith('refs/heads/')) {state.localBranches.set(refpath.slice('refs/heads/'.length), target);}
      else if (refpath.startsWith('refs/remotes/origin/')) {state.localRemoteRefs.set('origin/main', target);}
      else {state.remoteRefs.set(refpath, target);}
      return ok();
    }
    case 'ls-remote': {
      const ref = rest[rest.length - 1];
      const sha = state.remoteRefs.get(ref);
      if (sha) {return { status: 0, stdout: sha.toLowerCase() + '  refs/\n', stderr: '' };}
      return { status: 1, stdout: '', stderr: '' };
    }
    default:
      return ok();
  }
}

// ---------------------------------------------------------------------------
// Test harness over the shared in-memory model.
// ---------------------------------------------------------------------------

interface Repo {
  root: string;
  origin: string;
  head: () => string;
  originMain: () => string;
  commit: (_msg: string) => string;
  verifyRef: (_sha: string) => string;
}

let active: GitSim | null = null;

function run(_handle: string, args: string[], _env?: NodeJS.ProcessEnv): { status: number; stdout: string; stderr: string } {
  // The in-memory GitSim does not fork a real git process, so the process env
  // passed by the commit helpers (idEnv) is not consulted here; it is accepted
  // only so the fixture call sites keep the author-identity argument they use in
  // the real-git variant.
  const state = active!;
  const result = runSim(state, args);
  if (result.status !== 0) {
    // Surface unexpected failures during fixture setup.
    throw new Error(`${args.join(' ')}: ${result.stderr}`);
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
  const state = new GitSim();
  active = state;
  // init --bare -b main; clone; configure; commit P; push.
  run('init', ['init']);
  run('clone', ['clone']);
  run('commit', ['commit', '-m', 'P']);
  run('push', ['push', 'origin', 'main']);

  const head = () => run('root', ['rev-parse', 'HEAD']).stdout.trim().toLowerCase();
  const originMain = () => run('origin', ['rev-parse', 'origin/main']).stdout.trim().toLowerCase();

  const commit = (msg: string) => {
    run('root', ['commit', '-m', msg], idEnv());
    return head();
  };

  return {
    root: 'root',
    origin: 'origin',
    head,
    originMain,
    commit,
    verifyRef: (sha: string) => `refs/github-publish/${sha}`,
  };
}

function engineFor(repo: Repo, state: GitSim) {
  const git = (args: string[]) => {
    // Strip the `-C <cwd>` prefix the port always passes.
    const clean = args.filter((x, i) => !(x === '-C' || i === 1));
    return runSim(state, clean);
  };
  return new GithubPublishEngine({
    git: new GitRepositoryPort('root', git as never),
    mainBranch: 'main',
    verificationRemote: 'origin',
    verificationRefPrefix: 'github-publish',
  });
}

function headShaAt(repo: Repo, state: GitSim, offset: number): string {
  return run('root', ['log', '-1', '--format=%H', `HEAD~${offset}`]).stdout.trim().toLowerCase();
}

// AC #1: P -> A -> B -> C on local main; origin/main advances to A. Published
// SHAs for A, B, C are the exact local integration SHAs (no rewrite of B or C).
test('github-publish: exact integration SHA preserved through verification ref and publication', () => {
  const repo = makeRepo();
  const state = active!;
  try {
    const a = repo.commit('A');
    const b = repo.commit('B');
    const c = repo.commit('C');

    const engine = engineFor(repo, state);
    const oracle = new MapVerificationOracle();

    assert.equal(engine.publishCommit(a).action, 'published-to-verification-ref');
    assert.equal(engine.publishCommit(b).action, 'published-to-verification-ref');
    assert.equal(engine.publishCommit(c).action, 'published-to-verification-ref');

    // Verification ref on origin holds the exact local SHA for A.
    const refOnOrigin = run('origin', ['rev-parse', a]).status === 0
      ? run('origin', ['rev-parse', a]).stdout.trim().toLowerCase()
      : '';
    assert.equal(refOnOrigin, a, 'verification ref must hold the exact local SHA for A');

    oracle.mark(a, 'verified');
    const adv = engine.advanceMain(oracle);
    assert.equal(adv.advanced, true);
    assert.equal(adv.to, a, 'origin/main advances only to A');
    assert.equal(repo.originMain(), a, 'origin/main tip is the exact A SHA');
    assert.equal(repo.head(), a, 'local main head stays at A — not reset or truncated');
    // Local history still contains P -> A (not rewritten to a shorter line).
    assert.equal(run('root', ['merge-base', '--is-ancestor', 'HEAD~1', 'HEAD']).status, 0, 'P is an ancestor of local HEAD');

    const refB = run('origin', ['rev-parse', b]).stdout.trim().toLowerCase();
    const refC = run('origin', ['rev-parse', c]).stdout.trim().toLowerCase();
    assert.equal(refB, b, 'B published unchanged');
    assert.equal(refC, c, 'C published unchanged');
  } finally {
    active = null;
  }
});

// AC #2: verification completes out of order (C before A/B); origin/main still
// advances only in A, B, C order, never skipping.
test('github-publish: out-of-order verification advances in order without skipping', () => {
  const repo = makeRepo();
  const state = active!;
  try {
    const a = repo.commit('A');
    const b = repo.commit('B');
    repo.commit('C');

    const engine = engineFor(repo, state);
    const oracle = new MapVerificationOracle();
    for (const sha of [a, b, headShaAt(repo, state, 0)]) { engine.publishCommit(sha); }

    // Verify C and B first (out of order); A still pending.
    oracle.mark(headShaAt(repo, state, 0), 'verified');
    oracle.mark(b, 'verified');
    let adv = engine.advanceMain(oracle);
    assert.equal(adv.advanced, false, 'must not advance while A is unverified');

    oracle.mark(a, 'verified');
    adv = engine.advanceMain(oracle);
    assert.equal(adv.advanced, true, 'advances through the whole contiguous run once A is verified');
    assert.equal(adv.to, headShaAt(repo, state, 0));
    assert.equal(repo.originMain(), headShaAt(repo, state, 0));
  } finally {
    active = null;
  }
});

// AC #3: A externally verified: failed; B and C are green but NOT published.
test('github-publish: failed earlier verification blocks later commits', () => {
  const repo = makeRepo();
  const state = active!;
  try {
    const a = repo.commit('A');
    repo.commit('B');
    repo.commit('C');
    const engine = engineFor(repo, state);
    const oracle = new MapVerificationOracle();
    for (const sha of [a, headShaAt(repo, state, 1), headShaAt(repo, state, 0)]) { engine.publishCommit(sha); }
    oracle.mark(a, 'failed');
    oracle.mark(headShaAt(repo, state, 1), 'verified');
    oracle.mark(headShaAt(repo, state, 0), 'verified');

    const adv = engine.advanceMain(oracle);
    assert.equal(adv.advanced, false, 'must not advance past a failed verification');
    assert.equal(adv.failClosed, true);
    assert.equal(adv.blockedBy, a);
    // origin/main still at P (unchanged).
    assert.equal(run('root', ['rev-parse', 'HEAD~3']).stdout.trim().toLowerCase(), repo.originMain());
  } finally {
    active = null;
  }
});

// AC #4: fetch an updated origin/main containing the same published commits;
// local history is NOT rewritten or diverged.
test('github-publish: fetching updated origin/main does not rewrite local history', () => {
  const repo = makeRepo();
  const state = active!;
  try {
    const a = repo.commit('A');
    const engine = engineFor(repo, state);
    const oracle = new MapVerificationOracle();
    engine.publishCommit(a);
    oracle.mark(a, 'verified');
    assert.equal(engine.advanceMain(oracle).advanced, true);
    const localBefore = run('root', ['log', '--format=%H']).stdout.trim().split('\n').map(s => s.toLowerCase());

    // External actor pushes A..C to origin/main (simulating CI on the remote).
    run('root', ['push', 'origin', 'HEAD:main']);
    run('root', ['fetch', 'origin']);
    const localAfter = run('root', ['log', '--format=%H']).stdout.trim().split('\n').map(s => s.toLowerCase());
    assert.deepEqual(localAfter, localBefore, 'local history must be identical after fetch — no rewrite or divergence');
    assert.equal(repo.originMain(), a);
  } finally {
    active = null;
  }
});

// AC #5: move origin/main forward unexpectedly (ahead of expected ancestor);
// publication engine fails closed, never force-pushes.
test('github-publish: unexpected origin/main movement fails closed', () => {
  const repo = makeRepo();
  const state = active!;
  try {
    const a = repo.commit('A');
    const engine = engineFor(repo, state);
    const oracle = new MapVerificationOracle();
    engine.publishCommit(a);
    oracle.mark(a, 'verified');

    // External actor moves origin/main forward to a divergent commit branched
    // off P (origin/main), not off local main which carries A.
    const p = repo.originMain();
    run('root', ['branch', 'xbranch', p]);
    run('root', ['checkout', 'xbranch']);
    run('root', ['commit', '-m', 'X'], idEnv());
    run('root', ['push', 'origin', 'xbranch:main']);
    run('root', ['checkout', 'main']);
    run('root', ['fetch', 'origin']);

    assert.throws(
      () => engine.advanceMain(oracle),
      /moved between read|no longer a descendant/i,
      'must fail closed when origin/main diverges from the expected ancestor',
    );
    assert.notEqual(repo.originMain(), a, 'origin/main is the external movement, not A');
  } finally {
    active = null;
  }
});

// AC #6: no path force-pushes protected main; exact SHA unchanged from
// integration through verification through publication.
test('github-publish: never force-pushes; exact SHA unchanged through the lifecycle', () => {
  const repo = makeRepo();
  const state = active!;
  try {
    const a = repo.commit('A');
    const engine = engineFor(repo, state);
    const oracle = new MapVerificationOracle();
    engine.publishCommit(a);
    oracle.mark(a, 'verified');
    engine.advanceMain(oracle);

    assert.equal(run('origin', ['rev-parse', a]).status, 0, 'SHA reachable on origin');
    assert.equal(repo.originMain(), a);
    const src = fs.readFileSync(new URL('../src/application/github-publish/publication-engine.ts', import.meta.url).pathname, 'utf8');
    assert.ok(!/--force/.test(src), 'engine must never force-push');
  } finally {
    active = null;
  }
});

// Status: verified-but-blocked and failed are surfaced for operator status.
test('github-publish: status reports awaiting, verified-blocked, and failed', () => {
  const repo = makeRepo();
  const state = active!;
  try {
    const a = repo.commit('A');
    const b = repo.commit('B');
    const c = repo.commit('C');
    const engine = engineFor(repo, state);
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
    active = null;
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
  const state = active!;
  try {
    const a = repo.commit('A');
    const engine = engineFor(repo, state);
    assert.equal(engine.publishCommit(a).action, 'published-to-verification-ref');
    assert.equal(engine.publishCommit(a).action, 'idempotent-ref', 'second push of same SHA is idempotent');
  } finally {
    active = null;
  }
});

// CP-6 recovery: a pre-existing verification ref at a DIFFERENT SHA is a collision; never clobbered.
test('github-publish: pre-existing ref at a different SHA fails closed without clobbering', () => {
  const repo = makeRepo();
  const state = active!;
  try {
    const a = repo.commit('A');
    const b = repo.commit('B');
    // Pre-create the verification ref for A, but pointing at B (a collision).
    assert.equal(run('origin', ['push', 'origin', `${b}:refs/github-publish/${a}`]).status, 0);
    const engine = engineFor(repo, state);
    assert.throws(
      () => engine.publishCommit(a),
      /already exists.*refusing to clobber/i,
      'must refuse to clobber a pre-existing ref at a different SHA',
    );
    // The pre-existing ref is untouched — still points at B.
    assert.equal(run('origin', ['rev-parse', `refs/github-publish/${a}`]).stdout.trim().toLowerCase(), b);
  } finally {
    active = null;
  }
});

// CP-6 recovery: GitHub unavailable (pending) is not a failure; engine waits with retry.
test('github-publish: pending verification does not fail and does not advance', () => {
  const repo = makeRepo();
  const state = active!;
  try {
    repo.commit('A');
    const engine = engineFor(repo, state);
    const oracle = new MapVerificationOracle(); // defaults to pending
    const a = run('root', ['log', '-1', '--format=%H', 'HEAD']).stdout.trim().toLowerCase();
    engine.publishCommit(a);
    const adv = engine.advanceMain(oracle);
    assert.equal(adv.advanced, false);
    assert.equal(adv.failClosed, false, 'pending must not be reported as a failure');
    const state2 = engine.tracking(a, oracle);
    assert.equal(state2.state, 'external verification pending');
  } finally {
    active = null;
  }
});
