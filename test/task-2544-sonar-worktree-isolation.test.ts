// TASK-2544 — focused coverage that two distinct branch/worktree SonarQube
// analyses remain independently queryable after per-branch identity isolation.
// Hermetic: seeds temporary Git repositories and injects fetch; no Docker, no
// real SonarQube server, no committed token. Crosses the git boundary, so it
// runs in the integration layer (INTEGRATION_CI_TESTS).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNewIssuesFail, resolveSonarProjectKey } from '../scripts/sonar-local.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function escaped(source: string): RegExp {
  return new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function seedBaseRepo(dir: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README'), 'test\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir });
}

// Capture the project key each assertNewIssuesFail call resolves against. The
// mock returns a valid gate that passes on new_violations > 0 (the gate rule is
// out of scope for this isolation test).
function requestRecorder(captured: string[]): typeof fetch {
  return async (url) => {
    const u = String(url);
    if (u.includes('/api/qualitygates/get_by_project')) {
      captured.push(u);
      return new Response(JSON.stringify({ qualityGate: { name: 'gate' } }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ conditions: [{ metric: 'new_violations', op: 'GT', error: '0' }] }),
      { status: 200 },
    );
  };
}

test('task-2544: two distinct branch analyses resolve to distinct identities', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2544-sonar-'));
  const previousCwd = process.cwd();
  // Hermetic: strip runner-supplied branch env (GITHUB_REF_NAME / PARALLIX_SONAR_BRANCH)
  // so resolveSonarBranch falls back to the seeded repo's real branch instead of
  // a leaked CI branch. See TASK-2545.
  const previousRefName = process.env.GITHUB_REF_NAME;
  const previousSonarBranch = process.env.PARALLIX_SONAR_BRANCH;
  delete process.env.GITHUB_REF_NAME;
  delete process.env.PARALLIX_SONAR_BRANCH;
  try {
    seedBaseRepo(base);
    // `base` itself has `main` checked out, so it is the main-branch worktree.
    const featureA = path.join(base, 'wt-feature-a');
    const featureB = path.join(base, 'wt-feature-b');
    execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'feature/a', featureA], { cwd: base });
    execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'feature/b', featureB], { cwd: base });

    const keyMain = resolveSonarProjectKey(base);
    const keyA = resolveSonarProjectKey(featureA);
    const keyB = resolveSonarProjectKey(featureB);

    // SC3: main keeps its dedicated identity, distinct from every feature branch.
    assert.equal(keyMain, 'parallix');
    // SC1: two distinct worktree/branch analyses never resolve to the same key.
    assert.notEqual(keyA, keyB);
    assert.notEqual(keyA, keyMain);
    assert.notEqual(keyB, keyMain);
    // Feature keys carry the readable sanitized branch name plus a lossless hex
    // encoding of the raw branch name (slash -> dash in the prefix; hex suffix
    // is injective, so distinct branches never collide). SC1.
    assert.match(keyA, /^parallix-feature-[a-z0-9_-]+-[0-9a-f]+$/);
    assert.match(keyB, /^parallix-feature-[a-z0-9_-]+-[0-9a-f]+$/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(base, { recursive: true, force: true });
    // Restore runner-supplied branch env stripped in the test body (TASK-2545).
    if (previousRefName === undefined) { delete process.env.GITHUB_REF_NAME; }
    else { process.env.GITHUB_REF_NAME = previousRefName; }
    if (previousSonarBranch === undefined) { delete process.env.PARALLIX_SONAR_BRANCH; }
    else { process.env.PARALLIX_SONAR_BRANCH = previousSonarBranch; }
  }
});

// F1 regression: branch-name normalization must be injective. feature/a and
// feature-a sanitize to the same readable prefix but must not share a key.
test('task-2544: branch normalization is collision-free', () => {
  const previous = process.env.PARALLIX_SONAR_BRANCH;
  try {
    process.env.PARALLIX_SONAR_BRANCH = 'feature/a';
    const keySlash = resolveSonarProjectKey(repoRoot);
    process.env.PARALLIX_SONAR_BRANCH = 'feature-a';
    const keyDash = resolveSonarProjectKey(repoRoot);
    assert.notEqual(keySlash, keyDash);
    assert.match(keySlash, /^parallix-feature-[a-z0-9_-]+-[0-9a-f]+$/);
    assert.match(keyDash, /^parallix-feature-[a-z0-9_-]+-[0-9a-f]+$/);
  } finally {
    if (previous === undefined) { delete process.env.PARALLIX_SONAR_BRANCH; }
    else { process.env.PARALLIX_SONAR_BRANCH = previous; }
  }
});

// F1 regression (reviewer reproduction): two `git check-ref-format --branch`
// valid names that sanitize to the same readable prefix must still resolve to
// distinct keys, since the hash suffix covers the full raw identity.
test('task-2544: heavily-punctuated branch names do not collide', () => {
  const previous = process.env.PARALLIX_SONAR_BRANCH;
  try {
    process.env.PARALLIX_SONAR_BRANCH = 'feature---------/-----/----/-/-/----/x';
    const keyA = resolveSonarProjectKey(repoRoot);
    process.env.PARALLIX_SONAR_BRANCH = 'feature---------/-----/---/--/-/-/--/x';
    const keyB = resolveSonarProjectKey(repoRoot);
    assert.notEqual(keyA, keyB);
    assert.match(keyA, /^parallix-[a-z0-9_-]+-[0-9a-f]{64}$/);
    assert.match(keyB, /^parallix-[a-z0-9_-]+-[0-9a-f]{64}$/);
  } finally {
    if (previous === undefined) { delete process.env.PARALLIX_SONAR_BRANCH; }
    else { process.env.PARALLIX_SONAR_BRANCH = previous; }
  }
});

// F1 boundary (reviewer reproduction): a valid `git check-ref-format --branch`
// branch far longer than SonarQube's 400-character projectKey limit must still
// resolve to a key within that limit while staying distinct from a sibling that
// sanitizes to the same prefix.
test('task-2544: over-long branch key stays within SonarQube 400-char limit', () => {
  const previous = process.env.PARALLIX_SONAR_BRANCH;
  try {
    process.env.PARALLIX_SONAR_BRANCH = 'feature/' + 'a'.repeat(1500);
    const keyA = resolveSonarProjectKey(repoRoot);
    process.env.PARALLIX_SONAR_BRANCH = 'feature/' + 'b'.repeat(1500);
    const keyB = resolveSonarProjectKey(repoRoot);
    assert.ok(keyA.length <= 400, `key length ${keyA.length} exceeds SonarQube 400 limit`);
    assert.ok(keyB.length <= 400, `key length ${keyB.length} exceeds SonarQube 400 limit`);
    assert.notEqual(keyA, keyB);
    assert.match(keyA, /^parallix-[a-z0-9_-]+-[0-9a-f]{64}$/);
    assert.match(keyB, /^parallix-[a-z0-9_-]+-[0-9a-f]{64}$/);
  } finally {
    if (previous === undefined) { delete process.env.PARALLIX_SONAR_BRANCH; }
    else { process.env.PARALLIX_SONAR_BRANCH = previous; }
  }
});

test('task-2544: querying one branch analysis targets only that branch identity', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2544-sonar-query-'));
  const previousCwd = process.cwd();
  // Hermetic: strip runner-supplied branch env so resolveSonarBranch falls back
  // to the seeded worktrees' real branches. See TASK-2545.
  const previousRefName = process.env.GITHUB_REF_NAME;
  const previousSonarBranch = process.env.PARALLIX_SONAR_BRANCH;
  delete process.env.GITHUB_REF_NAME;
  delete process.env.PARALLIX_SONAR_BRANCH;
  try {
    seedBaseRepo(base);
    const featureA = path.join(base, 'wt-feature-a');
    const featureB = path.join(base, 'wt-feature-b');
    // `base` has `main` checked out; both feature worktrees are created here so
    // resolveSonarProjectKey resolves branch feature/a (not a basename fallback)
    // for both queried sides. SC6 requires two real branch analyses.
    execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'feature/a', featureA], { cwd: base });
    execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'feature/b', featureB], { cwd: base });

    const keyA = resolveSonarProjectKey(featureA);
    const keyB = resolveSonarProjectKey(featureB);

    // SC1: both sides carry the lossless hex suffix of their raw branch name.
    assert.match(keyA, /^parallix-feature-[a-z0-9_-]+-[0-9a-f]+$/);
    assert.match(keyB, /^parallix-feature-[a-z0-9_-]+-[0-9a-f]+$/);

    const callsA: string[] = [];
    const callsB: string[] = [];
    // SC6: each branch's quality-gate lookup resolves against its own key, not
    // the other branch's and not the shared constant.
    await assertNewIssuesFail({ token: 'test-token', request: requestRecorder(callsA), rootDir: featureA });
    await assertNewIssuesFail({ token: 'test-token', request: requestRecorder(callsB), rootDir: featureB });

    assert.equal(callsA.length, 1);
    assert.equal(callsB.length, 1);
    assert.match(callsA[0], escaped(`project=${keyA}`));
    assert.match(callsB[0], escaped(`project=${keyB}`));
    assert.doesNotMatch(callsA[0], escaped(`project=${keyB}`));
    assert.doesNotMatch(callsB[0], escaped(`project=${keyA}`));
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(base, { recursive: true, force: true });
    // Restore runner-supplied branch env stripped in the test body (TASK-2545).
    if (previousRefName === undefined) { delete process.env.GITHUB_REF_NAME; }
    else { process.env.GITHUB_REF_NAME = previousRefName; }
    if (previousSonarBranch === undefined) { delete process.env.PARALLIX_SONAR_BRANCH; }
    else { process.env.PARALLIX_SONAR_BRANCH = previousSonarBranch; }
  }
});
