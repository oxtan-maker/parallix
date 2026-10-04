// Historical regression provenance: TASK-2509, TASK-2319.
// Behavior-owned suite (TASK-2622.17, integration-ci): release version allocation, the release workflow, and the
// published-package metadata guards. Crosses a real Git/process boundary through temporary repositories and
// `git ls-files`, using only what a clean GitHub-hosted runner provides. Legacy case names unchanged.
//
// Sections keep their historical provenance:
//   task-2509 local version allocation (was test/task-2509-local-version-allocation.test.ts)
//   task-2509 / task-2522 release workflow (was test/task-2509-release-workflow.test.ts)
//   task-2319 NOTICES git tracking (was test/task-2319-notices-git-tracking.test.ts)
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---- task-2509 local version allocation lands in the one mission commit ----
describe("local version allocation lands in the one mission commit", () => {
  const root = path.join(import.meta.dirname, '..', '..', '..');

  // Runs the real bump script against a throwaway repo: branch `main` models the
  // primary branch and a commit on `mission/task-2509` models the rebased mission.
  function allocateInTempRepo(baseVersion: string, missionVersion = baseVersion) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2509-allocation-'));
    const git = (...args: string[]) => {
      const result = childProcess.spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], { cwd: repo, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const writeVersion = (version: string) => {
      fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ version }, null, 2)}\n`);
      fs.writeFileSync(path.join(repo, 'package-lock.json'), `${JSON.stringify({ version, packages: { '': { version } } }, null, 2)}\n`);
    };
    try {
      git('init', '--initial-branch=main');
      writeVersion(baseVersion);
      git('add', '.');
      git('commit', '-m', 'base');
      git('checkout', '-b', 'mission/task-2509');
      fs.writeFileSync(path.join(repo, 'feature.txt'), 'implementation\n');
      writeVersion(missionVersion);
      git('add', '.');
      git('commit', '-m', 'mission implementation');
      // The script resolves the repository from its own location, as it does when
      // integrate runs ./scripts/bump-version.sh inside the mission worktree.
      fs.mkdirSync(path.join(repo, 'scripts'));
      fs.copyFileSync(path.join(root, 'scripts/bump-version.sh'), path.join(repo, 'scripts/bump-version.sh'));
      childProcess.execFileSync('bash', ['scripts/bump-version.sh'], { cwd: repo, env: { ...process.env, INTEGRATE_HOOK_BASE_BRANCH: 'main' } });
      // Model the integrate squash: the mission's changes land as one commit on main.
      git('add', 'package.json', 'package-lock.json');
      git('commit', '--allow-empty', '-m', 'hook');
      git('checkout', 'main');
      git('merge', '--squash', 'mission/task-2509');
      git('commit', '-m', 'mission/task-2509: task-2509');
      return {
        commits: git('rev-list', '--count', 'main'),
        landedFiles: git('show', '--format=', '--name-only', 'main').split('\n'),
        subjects: git('log', '--format=%s', 'main'),
        manifest: JSON.parse(git('show', 'main:package.json')).version,
        lockfile: JSON.parse(git('show', 'main:package-lock.json')),
      };
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }

  test('task-2509: local allocation lands matching package metadata in the one mission commit', () => {
    const landed = allocateInTempRepo('1.5.119');
    assert.equal(landed.commits, '2');
    assert.deepEqual(landed.landedFiles, ['feature.txt', 'package-lock.json', 'package.json']);
    assert.doesNotMatch(landed.subjects, /chore: bump version/);
    assert.equal(landed.manifest, '1.5.120');
    assert.equal(landed.lockfile.version, '1.5.120');
    assert.equal(landed.lockfile.packages[''].version, '1.5.120');
  });

  test('task-2509: local allocation never moves a stale mission version backwards', () => {
    const landed = allocateInTempRepo('1.5.121', '1.5.100');
    assert.equal(landed.manifest, '1.5.122');
    assert.equal(landed.lockfile.version, '1.5.122');
  });

  test('task-2509: local allocation keeps a newer version already allocated by a retried integration', () => {
    const landed = allocateInTempRepo('1.5.121', '1.5.122');
    assert.equal(landed.manifest, '1.5.122');
  });
});

// ---- task-2509 release workflow trusts only the main-push SHA ----
describe("release workflow trusts only the main-push SHA", () => {
  const workflow = fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'ci-required.yml'), 'utf8');

  test('task-2509: release trusts only the successful main-push SHA with release-only OIDC permissions', () => {
    assert.match(workflow, /permissions:\n\s+actions: read\n\s+contents: read/);
    assert.match(workflow, /release:\n\s+needs: \[publication-proof, ci-required\][\s\S]*?github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && needs\.publication-proof\.result == 'success'/);
    assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
    assert.match(workflow, /release:[\s\S]*?permissions:\n\s+contents: write\n\s+id-token: write/);
    assert.match(workflow, /node-version: '24'/);
    assert.match(workflow, /registry-url: 'https:\/\/registry\.npmjs\.org'/);
    assert.match(workflow, /npm install --global npm@11\.5\.1/);
    assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.doesNotMatch(workflow, /npm version/);
  });

  test('task-2522: ci-required runs and summarizes the existing coverage gate on PRs and main pushes', () => {
    assert.match(workflow, /pull_request:\n\s+branches:\n\s+- main/);
    assert.match(workflow, /push:\n\s+branches:\n\s+- main/);
    assert.match(workflow, /PARALLIX_TEST_COVERAGE/);
    assert.match(workflow, /npm run coverage:merge/);
    assert.match(workflow, /Publish SonarQube quality gate result[\s\S]*?GITHUB_STEP_SUMMARY/);
    assert.doesNotMatch(workflow, /npm run test:coverage/);
  });
});

// ---- task-2319 NOTICES is an untracked, ignored, published artifact ----
describe("NOTICES is an untracked, ignored, published artifact", () => {
  // task-2319 — regression test: root NOTICES must be untracked and ignored by
  // an exact root-level .gitignore entry, while nested NOTICES files are not hidden.
  //
  // Reads committed .gitignore and package.json, plus git tracking state.
  // Hermetic for fs-based checks; crosses the process boundary only for git
  // tracking verification (spawnSync). Red-to-green: fails when NOTICES is
  // tracked (pre-mission) and when the ignore pattern is unanchored (round-1
  // defect); passes only with the committed /NOTICES root-anchored rule.
  const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
  const GITIGNORE = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const GITIGNORE_LINES = GITIGNORE.split('\n').map(line => line.trim()).filter(Boolean);

  test('task-2319: NOTICES is not tracked in git', () => {
    // git ls-files --error-unmatch exits 1 when the path is not tracked.
    const result = spawnSync('git', ['ls-files', '--error-unmatch', 'NOTICES'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0,
      'NOTICES must not be tracked — it is a generated packaging artifact');
  });

  test('task-2319: .gitignore contains root-anchored /NOTICES entry', () => {
    const noticesLine = GITIGNORE_LINES.find(line => line.includes('NOTICES'));
    assert.ok(noticesLine, '.gitignore must contain a NOTICES rule');
    assert.equal(noticesLine, '/NOTICES',
      'the NOTICES rule must be root-anchored (/NOTICES), not bare NOTICES');
  });

  test('task-2319: .gitignore does NOT contain a bare (unanchored) NOTICES rule', () => {
    const bareNotices = GITIGNORE_LINES.find(line => line === 'NOTICES');
    assert.equal(bareNotices, undefined,
      'a bare NOTICES pattern matches at every directory level — the rule must be /NOTICES');
  });

  test('task-2319: /NOTICES pattern matches only the root artifact (not nested)', () => {
    const noticesLine = GITIGNORE_LINES.find(line => line.includes('NOTICES'));
    assert.ok(noticesLine.startsWith('/'),
      'the NOTICES rule must start with / so it is root-anchored');
  });

  test('task-2319: NOTICES is listed in package.json files[] (published artifact)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(Array.isArray(pkg.files), 'package.json must have a files array');
    assert.ok(pkg.files.includes('NOTICES'),
      'NOTICES must remain in the published package files[]');
  });
});
