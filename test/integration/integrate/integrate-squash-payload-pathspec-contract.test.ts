// Historical regression provenance: TASK-2533, TASK-2534, TASK-2537, TASK-2349.
// Behavior-owned suite (TASK-2622.09, integration-ci): squash landing payload and backlog noise over
// disposable Git topologies — quoted/special-character pathspecs (task-2533), stale Backlog copies
// (task-2534), task files absent from the base branch (task-2537), the stage/commit race (task-2349),
// and soft-reset backlog noise. Legacy case names unchanged; every case builds its own mutable repository.
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../../../src/adapters/git/git.js', import.meta.url);
mockModule('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
mockModule('../../../src/adapters/backlog/backlog.js', import.meta.url);
mockModule('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
mockModule('../../../src/adapters/cli/commands/stats.js', import.meta.url);
mockModule('../../../src/composition/application-services.js', import.meta.url);
mockModule('../../../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();
const { createSquashLanding } = await import('../../../src/application/integrate/squash.js');
const fmt = await import('../../../src/application/presentation/cli-format.js');
const { checkBacklogIntegrity } = await import('../../../src/adapters/backlog/task-file-io.js');

// ---- task-2533 squash payload pathspec quoting (consolidated from test/task-2533-squash-payload-pathspec-quotes.test.ts, TASK-2622.09) ----
describe("squash payload pathspec quoting", () => {
  // TASK-2533: the landed squash captures its payload with
  // `git diff --cached --name-only -z --`, which emits git's RAW NUL-delimited,
  // unquoted paths (NUL-delimited so special filenames — backslash, non-ASCII —
  // stay literal). This is the protocol that must stay: plain `--name-only`
  // output instead emits a QUOTED/ESCAPED form (e.g. `"...\342\200\224..."`)
  // whose leading `"` never matches the real file, so `git commit --only`
  // aborts with "pathspec did not match any git-known files". This test guards
  // the shared capture against a regression back to quoted output.
  //
  // This crosses a real Git boundary (throwaway repo in a temp dir), so it runs
  // in the integration layer.


  // A filename carrying literal backslashes, exactly like the real landed task
  // files (`backlog/tasks/task-2521.01 - Mission-1-\342\200\224-...md`).
  const SPECIAL = 'task-\\342\\200\\224-Lock.md';

  function git(root: string, args: string[]): string {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
    return String(result.stdout);
  }

  /** Stage a payload file whose name needs git quoting, then leave it staged. */
  function stageSpecialPayload(root: string): void {
    fs.writeFileSync(path.join(root, SPECIAL), 'payload\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'payload']);
    fs.writeFileSync(path.join(root, SPECIAL), 'payload\nlanded\n');
    git(root, ['add', '.']);
  }

  test('TASK-2533: the quoted `--name-only` form is NOT a valid commit pathspec', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2533-quoted-'));
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@parallix.test']);
    git(root, ['config', 'user.name', 'Test']);
    stageSpecialPayload(root);

    // The buggy capture: plain `--name-only` output, split on newlines.
    const quoted = git(root, ['diff', '--cached', '--name-only', '--']).trim();
    assert.match(quoted, /^"/, 'git quotes special filenames in plain --name-only output');

    // Feeding that quoted form to `git commit --only` must fail: the leading `"`
    // is not part of the real path, so git rejects the pathspec. This is exactly
    // the abort the landed squash hit before the `-z` fix.
    const result = spawnSync('git', ['commit', '--only', '-m', 'x', '--', quoted], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'the quoted pathspec must not commit');
    assert.match(
      (result.stderr || result.stdout || ''),
      /did not match|motsvarade/i,
      'the failure is the pathspec mismatch, not an unrelated error',
    );
  });

  test('TASK-2533: the `-z` raw-path form commits the special file as a pathspec', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2533-z-'));
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@parallix.test']);
    git(root, ['config', 'user.name', 'Test']);
    stageSpecialPayload(root);

    // The fixed capture: NUL-delimited, unquoted, raw paths.
    const raw = git(root, ['diff', '--cached', '--name-only', '-z', '--']);
    const paths = raw.split('\0').filter(Boolean);
    assert.equal(paths.length, 1, 'one raw path captured');
    assert.equal(paths[0], SPECIAL, 'raw path is literal, unquoted');

    const commit = git(root, ['commit', '--only', '-m', 'x', '--', ...paths]);
    assert.match(commit, /1 file changed/, 'the special file lands via the raw pathspec');
  });

  test('TASK-2533: `-z` capture preserves leading/trailing whitespace in filenames (no trim)', () => {
    // Regression for the codex-review trim() finding: a filename that starts or
    // ends with whitespace is legal on disk, so the raw pathspec must keep those
    // bytes. Trimming would drop them and break the pathspec.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2533-ws-'));
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@parallix.test']);
    git(root, ['config', 'user.name', 'Test']);
    const wsName = ' f .md'; // leading + trailing space
    fs.writeFileSync(path.join(root, wsName), 'payload\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'payload']);
    fs.writeFileSync(path.join(root, wsName), 'payload\nlanded\n');
    git(root, ['add', '.']);

    const raw = git(root, ['diff', '--cached', '--name-only', '-z', '--']);
    const paths = raw.split('\0').filter(Boolean);
    assert.equal(paths[0], wsName, 'raw path keeps leading/trailing whitespace');

    const commit = git(root, ['commit', '--only', '-m', 'x', '--', ...paths]);
    assert.match(commit, /1 file changed/, 'the whitespace-padded file lands via the raw pathspec');
  });

  // Drive the real `squashAndLand` so the regression fails if the production
  // payload capture regresses to quoted `--name-only` output. Only the non-git
  // landing collaborators are stubbed (same shape as the task-2534 repro).
  const NON_ASCII = 'backlog/tasks/task-9001 - Mission-1-—-x.md';
  const BACKSLASH = 'docs/back\\slash.md';
  const ASCII = 'src/plain.txt';

  function gitRun(args: string[]) {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    return { status: result.status ?? 1, stdout: String(result.stdout), stderr: String(result.stderr) };
  }

  function writeFile(root: string, rel: string, body: string): void {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }

  test('TASK-2533: squash landing commits backslash and non-ASCII payload paths with ordinary ones', async (t) => {
    for (const quiet of ['debug', 'pass', 'plain', 'fail', 'info'] as const) { t.mock.method(fmt.log, quiet, () => {}); }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2533-land-'));
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@parallix.test']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['config', 'core.hooksPath', '/dev/null']);
    writeFile(root, 'README.md', 'base\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'base']);
    git(root, ['checkout', '-q', '-b', 'mission/task-9001']);
    for (const rel of [NON_ASCII, BACKSLASH, ASCII]) { writeFile(root, rel, `${rel}\n`); }
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'mission payload']);
    git(root, ['checkout', '-q', 'main']);
    // Unrelated working-tree entry must stay outside the named payload.
    writeFile(root, 'ambient.txt', 'not payload\n');

    const abort = new Error('IntegrationAbort');
    const { squashAndLand } = createSquashLanding({
      git: { git: gitRun },
      fileSystem: { existsSync: (target: string) => fs.existsSync(target) },
      backlog: { checkBacklogIntegrity: () => [] },
      missionPaths: { softResetTrailingBacklogNoise: () => false },
      productConfig: { isForgejoReviewEnabled: () => false },
      checkout: { maybeUpdateGraphifyOnPrimary: () => {} },
      gates: { isIntendedPayloadAtHead: () => false },
      landing: {
        createAbort: () => abort,
        classifyHookFailure: () => ({ isHookFailure: false }),
        persistLandedIntegrationOrAbort: async () => {},
        closeLandedIntegrationOrAbort: async () => {},
        recordPostIntegrationStatsOrAbort: async () => {},
        cleanupMissionWorktree: () => true,
        runPostIntegrateHookOrAbort: () => {},
      },
      verification: {
        formatVerificationCommand: () => 'verify',
        captureVerifiedTreeProof: () => ({ ok: true, proof: {} }),
        assertVerifiedTreeProof: () => ({ ok: true }),
      },
    } as never, { promoteTaskForIntegrationIfNeeded: async () => {} });
    const run = {
      slug: 'task-9001',
      context: { area: 'all' },
      missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration' }, version: 1 }) } },
      baseWorktree: root,
      baseBranch: 'main',
      seams: {},
      state: { temporaryStash: null, nextActionMessage: null },
    };
    await squashAndLand(run as never, {
      branch: 'mission/task-9001',
      summary: 'land',
      landedFromSha: 'base',
      mainTaskFile: path.join(root, 'backlog/tasks/task-9001-absent.md'),
    });

    const landed = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD']).split('\0').filter(Boolean).sort();
    assert.deepEqual(landed, [ASCII, BACKSLASH, NON_ASCII].sort(), 'landed commit holds exactly the raw payload paths');
    assert.equal(git(root, ['status', '--porcelain']).trim(), '?? ambient.txt', 'unrelated working-tree entry stays outside the commit');
  });
});

// ---- task-2534 stale Backlog copy at landing (consolidated from test/task-2534-stale-backlog-copy-landing-repro.test.ts, TASK-2622.09) ----
describe("stale Backlog copy at landing", () => {
  // TASK-2534: a landed squash must not resurrect stale `backlog/tasks/` copies.
  //
  // Shape mirrors `mission/task-2489` / `mission/task-2478`: the mission branch's
  // unsquashed history adds `backlog/tasks/task-9001 - x.md` (a pre-squash commit
  // of another mission), while main only received that mission's squash commit,
  // which put the canonical file in `backlog/completed/`. `git merge --squash`
  // sees "added on branch, absent at merge-base and on main" and stages the stale
  // copy. The real `squashAndLand` runs against a throwaway repo; only the
  // non-git landing collaborators are stubbed.
  //
  // This crosses a real Git boundary, so it runs in the integration layer.


  const STALE = 'backlog/tasks/task-9001 - x.md';
  const CANONICAL = 'backlog/completed/task-9001 - x.md';
  const NEW_TASK = 'backlog/tasks/task-9002 - new.md';

  function gitRun(args: string[]) {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    return { status: result.status ?? 1, stdout: String(result.stdout), stderr: String(result.stderr) };
  }

  function git(root: string, args: string[]): string {
    const result = gitRun(['-C', root, ...args]);
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
  }

  function write(root: string, rel: string, id: string): void {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), `---\nid: ${id}\ntitle: x\n---\n`);
  }

  /** main has the canonical completed file; the mission branch history adds the stale copy and a new task. */
  function buildFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2534-'));
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@parallix.test']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['config', 'core.hooksPath', '/dev/null']);
    fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'base']);

    git(root, ['checkout', '-q', '-b', 'mission/task-9002']);
    write(root, STALE, 'TASK-9001');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'mission/task-9001 pre-squash history']);
    write(root, NEW_TASK, 'TASK-9002');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'file task-9002']);

    git(root, ['checkout', '-q', 'main']);
    write(root, CANONICAL, 'TASK-9001');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'mission/task-9001: squash']);
    return root;
  }

  function landing(root: string, extraBacklog: Record<string, unknown> = {}) {
    const abort = new Error('IntegrationAbort');
    const { squashAndLand } = createSquashLanding({
      git: { git: gitRun },
      fileSystem: { existsSync: (target: string) => fs.existsSync(target) },
      backlog: { checkBacklogIntegrity: (rootDir: string) => checkBacklogIntegrity(rootDir), ...extraBacklog },
      missionPaths: { softResetTrailingBacklogNoise: () => false },
      productConfig: { isForgejoReviewEnabled: () => false },
      checkout: { maybeUpdateGraphifyOnPrimary: () => {} },
      gates: { isIntendedPayloadAtHead: () => false },
      landing: {
        createAbort: () => abort,
        classifyHookFailure: () => ({ isHookFailure: false }),
        persistLandedIntegrationOrAbort: async () => {},
        closeLandedIntegrationOrAbort: async () => {},
        recordPostIntegrationStatsOrAbort: async () => {},
        cleanupMissionWorktree: () => true,
        runPostIntegrateHookOrAbort: () => {},
      },
      verification: {
        formatVerificationCommand: () => 'verify',
        captureVerifiedTreeProof: () => ({ ok: true, proof: {} }),
        assertVerifiedTreeProof: () => ({ ok: true }),
      },
    } as never, { promoteTaskForIntegrationIfNeeded: async () => {} });
    const run = {
      slug: 'task-9002',
      context: { area: 'all' },
      missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration' }, version: 1 }) } },
      baseWorktree: root,
      baseBranch: 'main',
      seams: {},
      state: { temporaryStash: null, nextActionMessage: null },
    };
    const land = () => squashAndLand(run as never, {
      branch: 'mission/task-9002',
      summary: 'land',
      landedFromSha: 'base',
      mainTaskFile: path.join(root, 'backlog/tasks/task-9002-absent.md'),
    });
    return { land, abort };
  }

  test('TASK-2534: squash landing drops the stale task-9001 copy and keeps new task-9002', async (t) => {
    const root = buildFixture();
    const infos: string[] = [];
    t.mock.method(fmt.log, 'info', (message: string) => { infos.push(String(message)); });
    for (const quiet of ['debug', 'pass', 'plain', 'fail'] as const) { t.mock.method(fmt.log, quiet, () => {}); }

    await landing(root).land();

    const landed = git(root, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n');
    assert.ok(!landed.includes(STALE), `landed commit must not contain ${STALE}`);
    assert.ok(landed.includes(NEW_TASK), `landed commit must contain ${NEW_TASK}`);
    assert.ok(!fs.existsSync(path.join(root, STALE)), 'stale copy is removed from the working tree');
    assert.ok(
      infos.some(line => line.includes('task-9001') && line.includes(CANONICAL)),
      `an info line names task-9001 and ${CANONICAL}; got ${JSON.stringify(infos)}`,
    );
  });

  test('TASK-2534: landing aborts before the squash commit when a duplicate survives closeout', async (t) => {
    const root = buildFixture();
    // A duplicate the step-1 filter cannot see: it is already committed on main,
    // so the squash never stages it.
    write(root, 'backlog/tasks/task-9003 - old.md', 'TASK-9003');
    write(root, 'backlog/completed/task-9003 - old.md', 'TASK-9003');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'pre-existing duplicate on main']);
    const headBefore = git(root, ['rev-parse', 'HEAD']).trim();
    const fails: string[] = [];
    t.mock.method(fmt.log, 'fail', (message: string) => { fails.push(String(message)); });
    for (const quiet of ['debug', 'pass', 'plain', 'info'] as const) { t.mock.method(fmt.log, quiet, () => {}); }

    const { land, abort } = landing(root);
    await assert.rejects(land(), error => error === abort, 'the integrity backstop aborts the landing');

    assert.ok(
      fails.some(line => line.includes('backlog/tasks/task-9003 - old.md')),
      `the abort message lists the offending path; got ${JSON.stringify(fails)}`,
    );

    assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), headBefore, 'no squash commit is created');
    assert.equal(git(root, ['status', '--porcelain']), '', 'the staged squash is rolled back so a retry starts clean');
  });
});

// ---- task-2537 unstaged task path at closeout (consolidated from test/task-2537-squash-closeout-unstaged-task-path.test.ts, TASK-2622.09) ----
describe("unstaged task path at closeout", () => {
  // TASK-2537: the landed squash names its payload explicitly
  // (`git commit --only -- <paths>`), and git fails-closed when a named pathspec
  // matches nothing it knows. Closeout moves `backlog/tasks/<slug>` to
  // `backlog/completed/<slug>`; when the task file was authored on the mission
  // branch, the base branch never carried it, so after the move that source path
  // exists in neither the index nor HEAD and the whole landing aborts with
  // "pathspec did not match any git-known files".
  //
  // This is distinct from TASK-2533 (git *quoting* special filenames in the
  // capture). Here the path is plain ASCII — it simply is not a live pathspec.
  //
  // The tests drive the real `squashAndLand` across a real Git boundary
  // (throwaway repos in a temp dir), so they run in the integration layer.


  const SLUG = 'task-9002';
  const TASK_FILE = `${SLUG} - Land-a-draft-authored-task.md`;
  const TASKS_PATH = `backlog/tasks/${TASK_FILE}`;
  const COMPLETED_PATH = `backlog/completed/${TASK_FILE}`;
  const MISSION_PAYLOAD = 'src/landed-feature.txt';
  const AMBIENT_PATH = 'ambient.txt';

  function git(root: string, args: string[]): string {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
    return String(result.stdout);
  }

  function gitRun(args: string[]) {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    return { status: result.status ?? 1, stdout: String(result.stdout), stderr: String(result.stderr) };
  }

  function writeFile(root: string, rel: string, body: string): void {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }

  /**
   * A repository at the exact shape the landing sees: `main` checked out with the
   * squashable mission branch beside it. `baseTracksTask` selects whether the
   * base branch already carries `backlog/tasks/<slug>` (the pre-existing case) or
   * whether the mission branch authored it (the TASK-2537 defect case).
   */
  function seedRepository({ baseTracksTask }: { baseTracksTask: boolean }): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2537-'));
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@parallix.test']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['config', 'core.hooksPath', '/dev/null']);
    writeFile(root, 'README.md', 'base\n');
    if (baseTracksTask) { writeFile(root, TASKS_PATH, 'status: active\n'); }
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'base']);

    git(root, ['checkout', '-q', '-b', `mission/${SLUG}`]);
    writeFile(root, TASKS_PATH, 'status: active\nbody: mission work\n');
    writeFile(root, MISSION_PAYLOAD, 'landed\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'mission payload']);
    git(root, ['checkout', '-q', 'main']);
    return root;
  }

  /** Drive the production `squashAndLand` with only the non-git seams stubbed. */
  async function landMission(root: string): Promise<void> {
    const abort = new Error('IntegrationAbort');
    const { squashAndLand } = createSquashLanding({
      git: { git: gitRun },
      fileSystem: { existsSync: (target: string) => fs.existsSync(target) },
      backlog: {
        checkBacklogIntegrity: () => [],
        // The real `completeTask` moves the file on disk; that move is what
        // leaves the source path outside the index. Staging an unrelated file
        // here stands in for a concurrent bare-board commit dirtying the index
        // after the payload was captured: `--only` must not inherit it.
        completeTask: () => {
          fs.mkdirSync(path.join(root, 'backlog/completed'), { recursive: true });
          fs.renameSync(path.join(root, TASKS_PATH), path.join(root, COMPLETED_PATH));
          writeFile(root, AMBIENT_PATH, 'not payload\n');
          git(root, ['add', '--', AMBIENT_PATH]);
        },
        resolveTaskFile: () => ({ ok: true, taskFile: path.join(root, COMPLETED_PATH) }),
      },
      missionPaths: { softResetTrailingBacklogNoise: () => false },
      productConfig: { isForgejoReviewEnabled: () => false },
      checkout: { maybeUpdateGraphifyOnPrimary: () => {}, rewriteWorktreePaths: () => {} },
      gates: { isIntendedPayloadAtHead: () => false },
      landing: {
        createAbort: () => abort,
        classifyHookFailure: () => ({ isHookFailure: false }),
        persistLandedIntegrationOrAbort: async () => {},
        closeLandedIntegrationOrAbort: async () => {},
        recordPostIntegrationStatsOrAbort: async () => {},
        cleanupMissionWorktree: () => true,
        runPostIntegrateHookOrAbort: () => {},
      },
      verification: {
        formatVerificationCommand: () => 'verify',
        captureVerifiedTreeProof: () => ({ ok: true, proof: {} }),
        assertVerifiedTreeProof: () => ({ ok: true }),
      },
    } as never, { promoteTaskForIntegrationIfNeeded: async () => {} });

    await squashAndLand({
      slug: SLUG,
      context: { area: 'all' },
      missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration' }, version: 1 }) } },
      baseWorktree: root,
      baseBranch: 'main',
      seams: {},
      state: { temporaryStash: null, nextActionMessage: null },
    } as never, {
      branch: `mission/${SLUG}`,
      summary: 'land',
      landedFromSha: 'base',
      mainTaskFile: path.join(root, TASKS_PATH),
    });
  }

  /** `A`/`D`/`M` status per path in the landed commit, renames expanded. */
  function landedStatus(root: string): Record<string, string> {
    const raw = git(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', '--no-renames', 'HEAD'])
      .split('\0')
      .filter(Boolean);
    const status: Record<string, string> = {};
    for (let index = 0; index + 1 < raw.length; index += 2) { status[raw[index + 1]] = raw[index]; }
    return status;
  }

  function quietLogs(t: { mock: { method: Function } }): void {
    for (const quiet of ['debug', 'pass', 'plain', 'fail', 'info'] as const) { t.mock.method(fmt.log, quiet, () => {}); }
  }

  test('TASK-2537: a task file absent from the base branch lands without a pathspec abort', async (t) => {
    quietLogs(t as never);
    const root = seedRepository({ baseTracksTask: false });

    await landMission(root);

    const status = landedStatus(root);
    assert.equal(status[COMPLETED_PATH], 'A', 'the completed task file is added by the landed commit');
    assert.equal(status[MISSION_PAYLOAD], 'A', 'the mission payload lands alongside the closeout');
    assert.equal(status[TASKS_PATH], undefined, 'the never-tracked source path carries no change to land');
    assert.equal(status[AMBIENT_PATH], undefined, 'the ambient staged entry stays outside the landed commit');
    // The landed tree must not resurrect the tasks copy of a completed task.
    assert.notEqual(
      spawnSync('git', ['cat-file', '-e', `HEAD:${TASKS_PATH}`], { cwd: root }).status,
      0,
      'the landed tree holds no backlog/tasks copy of the completed task',
    );
    assert.equal(git(root, ['status', '--porcelain']).trim(), `A  ${AMBIENT_PATH}`, 'only the ambient entry remains staged');
  });

  test('TASK-2537: a base-tracked task file still lands its removal and completed addition', async (t) => {
    quietLogs(t as never);
    const root = seedRepository({ baseTracksTask: true });

    await landMission(root);

    const status = landedStatus(root);
    assert.equal(status[TASKS_PATH], 'D', 'the base-tracked source path is removed by the landed commit');
    assert.equal(status[COMPLETED_PATH], 'A', 'the completed task file is added by the landed commit');
    assert.equal(status[MISSION_PAYLOAD], 'A', 'the mission payload lands alongside the closeout');
    assert.equal(status[AMBIENT_PATH], undefined, 'the ambient staged entry stays outside the landed commit');
    assert.equal(git(root, ['status', '--porcelain']).trim(), `A  ${AMBIENT_PATH}`, 'only the ambient entry remains staged');
  });
});

// ---- task-2349 stage/commit race (consolidated from test/task-2349-integrate-stage-commit-race.test.ts, TASK-2622.09) ----
describe("stage/commit race", () => {
  const gitModule = mockModule<typeof import('../../../src/adapters/git/git.js')>('../../../src/adapters/git/git.js', import.meta.url);
  const missionUtils = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const backlog = mockModule<typeof import('../../../src/adapters/backlog/backlog.js')>('../../../src/adapters/backlog/backlog.js', import.meta.url);
  const forgejo = mockModule<typeof import('../../../src/adapters/forgejo/forgejo.js')>('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
  const stats = mockModule<typeof import('../../../src/adapters/cli/commands/stats.js')>('../../../src/adapters/cli/commands/stats.js', import.meta.url);
  const composition = mockModule<typeof import('../../../src/composition/application-services.js')>('../../../src/composition/application-services.js', import.meta.url);
  const integrateModule = mockModule<typeof import('../../../src/adapters/cli/commands/integrate.js')>('../../../src/adapters/cli/commands/integrate.js', import.meta.url);

  const TEST_SLUG = 'task-2349-race';
  const FAKE_ROOT = path.join(os.tmpdir(), `task-2349-race-${process.pid}`);
  const MISSION_PAYLOAD = 'src/mission-payload.ts';
  const UNRELATED_DIRTY_FILE = 'notes/unrelated-dirty.md';

  function setup() {
    process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS = '1';
    fs.mkdirSync(FAKE_ROOT, { recursive: true });
    fs.writeFileSync(path.join(FAKE_ROOT, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'forgejo' }, verification: { command: 'true' } } }));
    mock.method(missionUtils, 'inferSlug', () => TEST_SLUG);
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
    mock.method(missionUtils, 'getPrimaryWorktree', () => FAKE_ROOT);
    mock.method(missionUtils, 'findMissionDir', () => path.join(FAKE_ROOT, 'missions', TEST_SLUG));
    mock.method(missionUtils, 'findMissionArea', () => 'all');
    mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(FAKE_ROOT, '..', TEST_SLUG));
    mock.method(missionUtils, 'resolveMainRepo', () => FAKE_ROOT);
    mock.method(missionUtils, 'missionTitle', () => 'Race test');
    mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
    mock.method(gitModule, 'getCurrentBranch', () => `mission/${TEST_SLUG}`);
    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(FAKE_ROOT, 'backlog/tasks/task.md') }));
    mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
    mock.method(backlog, 'getTaskStatus', () => 'approved');
    mock.method(backlog, 'getTaskAssignee', () => 'codex');
    mock.method(backlog, 'completeTask', () => true);
    mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 1 }));
    mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
    mock.method(forgejo, 'listOpenPrsForSlug', () => []);
    mock.method(forgejo, 'readToken', () => 'token');
    mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
    mock.method(forgejo, 'syncMerged', () => ({ ok: true }));
    mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, sha: 'deadbeef' }));
    mock.method(stats, 'recordIntegrationStats', async () => ({ changed: false, row: { mission: TEST_SLUG }, data: { rows: [] }, report: 'none' }));
    mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
    mock.method(composition, 'createMissionApplicationServices', async () => ({
      // TASK-2376: the domain integrate command requires status=integration;
      // a review-status mission with no Review aggregate must stop, not integrate.
      store: { _repoId: 'default', load: async () => ({ kind: 'found', mission: { status: 'integration', review: null }, version: 1 }) },
      lifecycle: { transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }) },
      handoff: { recordNel: async () => ({}) },
    }));
    mock.method(process, 'cwd', () => FAKE_ROOT);
    mock.method(process, 'exit', () => {});
  }

  test('intervening bare board commit cannot contain the prepared mission payload', async () => {
    setup();
    let stagedPaths: string[] = [];
    let boardCommitPaths: string[] = [];
    let squashCommitArgs: string[] = [];
    fs.mkdirSync(path.join(FAKE_ROOT, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(FAKE_ROOT, UNRELATED_DIRTY_FILE), 'leave me out');
    mock.method(gitModule, 'git', (args) => {
      if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
      if (args.includes('branch') || args.includes('status') || args.includes('merge')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('diff') && args.includes('--cached') && args.includes('--name-only')) {
        boardCommitPaths = [...stagedPaths]; // `git commit -m "Reorder tasks in review"` interleaves after payload preparation.
        // TASK-2533: the payload capture uses `git diff --cached --name-only -z`,
        // so the mock emits NUL-delimited output; splitting on NUL yields the
        // bare payload path with no trailing newline.
        return { status: 0, stdout: `${MISSION_PAYLOAD}\0`, stderr: '' };
      }
      if (args.includes('add') && args.includes('-A')) {
        stagedPaths = [MISSION_PAYLOAD];
        boardCommitPaths = [...stagedPaths]; // `git commit -m "Reorder tasks in review"` interleaves here.
        stagedPaths = [];
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args.includes('commit')) {
        squashCommitArgs = args;
        return { status: boardCommitPaths.length ? 1 : 0, stdout: '', stderr: boardCommitPaths.length ? 'nothing to commit' : '' };
      }
      if (args.includes('rev-parse')) return { status: 0, stdout: 'deadbeef', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });

    try {
      await integrateModule.default([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
      assert.deepEqual(boardCommitPaths, [], 'Reorder tasks in review must not carry mission payload files');
      assert.ok(squashCommitArgs.includes('--only'));
      assert.ok(squashCommitArgs.includes(MISSION_PAYLOAD));
      assert.ok(!squashCommitArgs.includes(UNRELATED_DIRTY_FILE));
    } finally {
      mock.reset();
      fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
    }
  });

  async function runFailedCommit(payloadAtHead: boolean) {
    setup();
    const logs: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = message => logs.push(String(message));
    console.error = message => errors.push(String(message));
    mock.method(gitModule, 'git', (args) => {
      if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
      if (args.includes('branch') || args.includes('status') || args.includes('merge')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('diff') && args.includes('--cached')) return { status: 0, stdout: `${MISSION_PAYLOAD}\n`, stderr: '' };
      if (args.includes('diff') && args.includes('--quiet')) return { status: payloadAtHead ? 0 : 1, stdout: '', stderr: '' };
      if (args.includes('commit')) return { status: 1, stdout: '', stderr: 'hook rejected the commit' };
      if (args.includes('rev-parse')) return { status: 0, stdout: 'carrying-commit', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });
    try {
      await integrateModule.default([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
      return [...logs, ...errors].join('\n');
    } finally {
      console.log = originalLog;
      console.error = originalError;
      mock.reset();
      fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
    }
  }

  test('non-zero squash commit reports the carrying commit when HEAD has the complete payload', async () => {
    const output = await runFailedCommit(true);
    assert.match(output, /Integration payload already landed in commit carrying-commit/);
    assert.doesNotMatch(output, /Could not create the squash commit in the local integration checkout/);
  });

  test('non-zero squash commit with an absent payload retains hook recovery guidance', async () => {
    const output = await runFailedCommit(false);
    assert.match(output, /Could not create the squash commit in the local integration checkout/);
    assert.match(output, /The squash commit runs the repo git hooks\. Fix the reported hook failure/);
  });
});

// ---- backlog noise reduction (consolidated from test/noise-reduction.test.ts, TASK-2622.09) ----
describe("backlog noise reduction", () => {
  const findLastNonNoiseCommitModule = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const squashTrailingBacklogNoiseIntoPreviousMissionModule = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const { findLastNonNoiseCommit } = findLastNonNoiseCommitModule;
  const { squashTrailingBacklogNoiseIntoPreviousMission, softResetTrailingBacklogNoise } = squashTrailingBacklogNoiseIntoPreviousMissionModule;
  function git(args, cwd) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    if (result.error && !(result.error.code === 'EPERM' && result.status === 0)) {
      throw result.error;
    }
    assert.equal(result.status, 0, `git ${args.join(' ')}\n${result.stderr}${result.stdout}`);
    return result.stdout || '';
  }

  function withTempRepo(fn) {
    const previous = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noise-reduction-test-'));

    // Initialize git repo
    git(['init'], root);
    git(['config', 'user.email', 'test@example.com'], root);
    git(['config', 'user.name', 'Test User'], root);

    process.chdir(root);

    try {
      fn(root);
    } finally {
      process.chdir(previous);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  test('findLastNonNoiseCommit identifies non-noise commits correctly', () => {
    withTempRepo(root => {
      // 1. Initial commit (non-noise)
      fs.writeFileSync('README.md', '# Project\n');
      git(['add', 'README.md'], root);
      git(['commit', '-m', 'initial commit'], root);
      const initialSha = git(['rev-parse', 'HEAD'], root).trim();

      // 2. Real work (non-noise)
      fs.writeFileSync('app.js', 'console.log("hello");\n');
      git(['add', 'app.js'], root);
      git(['commit', '-m', 'mission: implement app'], root);
      const workSha = git(['rev-parse', 'HEAD'], root).trim();

      // 3. Backlog noise (noise)
      fs.mkdirSync('backlog/tasks', { recursive: true });
      fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
      git(['add', 'backlog/'], root);
      git(['commit', '-m', 'backlog: add task 1'], root);

      // 4. More backlog noise (noise)
      fs.writeFileSync('backlog/tasks/task-1.md', 'status: active\n');
      git(['add', 'backlog/'], root);
      git(['commit', '-m', 'fixes'], root);

      // HEAD should point to trailing noise, findLastNonNoiseCommit should return workSha
      const result = findLastNonNoiseCommit(root);
      assert.equal(git(['rev-parse', result], root).trim(), workSha);
    });
  });

  test('findLastNonNoiseCommit identifies generic noise messages as noise when only touching backlog', () => {
    withTempRepo(root => {
      fs.writeFileSync('README.md', '# Project\n');
      git(['add', 'README.md'], root);
      git(['commit', '-m', 'initial commit'], root);

      fs.writeFileSync('app.js', 'console.log("hello");\n');
      git(['add', 'app.js'], root);
      git(['commit', '-m', 'mission: work'], root);
      const workSha = git(['rev-parse', 'HEAD'], root).trim();

      const noiseMessages = ['mission changes', 'random changes', 'new/updated mission', 'housekeeping', 'fixes'];
      for (const msg of noiseMessages) {
        fs.mkdirSync('backlog/tasks', { recursive: true });
        fs.writeFileSync(`backlog/tasks/task-${msg.replace(/\//g, '-')}.md`, 'status: backlog\n');
        git(['add', 'backlog/'], root);
        git(['commit', '-m', msg], root);
      }

      const result = findLastNonNoiseCommit(root);
      assert.equal(git(['rev-parse', result], root).trim(), workSha);
    });
  });

  test('findLastNonNoiseCommit identifies "fixes" with mission files as non-noise', () => {
    withTempRepo(root => {
      fs.writeFileSync('README.md', '# Project\n');
      git(['add', 'README.md'], root);
      git(['commit', '-m', 'initial commit'], root);

      // Mixed commit (mission + backlog) with generic message "fixes"
      fs.writeFileSync('app.js', 'console.log("hello");\n');
      fs.mkdirSync('backlog/tasks', { recursive: true });
      fs.writeFileSync('backlog/tasks/task-1.md', 'status: active\n');
      git(['add', '.'], root);
      git(['commit', '-m', 'fixes'], root);
      const mixedSha = git(['rev-parse', 'HEAD'], root).trim();

      const result = findLastNonNoiseCommit(root);
      assert.equal(git(['rev-parse', result], root).trim(), mixedSha);
    });
  });

  test('findLastNonNoiseCommit stops at branch-off points even if they are noise', () => {
    withTempRepo(root => {
      const currentBranch = git(['symbolic-ref', '--short', 'HEAD'], root).trim();

      // 1. Initial commit
      fs.writeFileSync('README.md', '# Project\n');
      git(['add', 'README.md'], root);
      git(['commit', '-m', 'initial commit'], root);

      // 2. Backlog noise (this will be our branch-off point)
      fs.mkdirSync('backlog/tasks', { recursive: true });
      fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
      git(['add', 'backlog/'], root);
      git(['commit', '-m', 'backlog: add task 1'], root);
      const noiseBranchOffSha = git(['rev-parse', 'HEAD'], root).trim();

      // 3. Create a sibling branch at this noise commit
      git(['branch', 'sibling-branch', noiseBranchOffSha], root);

      // 4. Add more noise on current branch
      fs.writeFileSync('backlog/tasks/task-2.md', 'status: backlog\n');
      git(['add', 'backlog/'], root);
      git(['commit', '-m', 'backlog: task 2'], root);

      // 5. Advance sibling-branch so it is not just a tip at the branch-off point
      git(['checkout', 'sibling-branch'], root);
      fs.writeFileSync('other.js', 'console.log("other");\n');
      git(['add', 'other.js'], root);
      git(['commit', '-m', 'work on other branch'], root);
      git(['checkout', currentBranch], root);

      // findLastNonNoiseCommit must return null because noiseBranchOffSha is a branch-off
      // point that sibling-branch depends on — returning it would allow the squash path to
      // amend a commit another branch is based on, which is a shared-history violation.
      const result = findLastNonNoiseCommit(root);
      assert.equal(result, null);
    });
  });

  test('findLastNonNoiseCommit returns null if the non-noise commit is shared', () => {
    withTempRepo(root => {
      // 1. Initial commit (pushed/shared)
      fs.writeFileSync('README.md', '# Project\n');
      git(['add', 'README.md'], root);
      git(['commit', '-m', 'initial commit'], root);
      const sharedSha = git(['rev-parse', 'HEAD'], root).trim();
      // Simulate it being pushed
      git(['update-ref', 'refs/remotes/origin/main', sharedSha], root);

      // 2. Backlog noise (local)
      fs.mkdirSync('backlog/tasks', { recursive: true });
      fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
      git(['add', 'backlog/'], root);
      git(['commit', '-m', 'backlog: add task 1'], root);

      // findLastNonNoiseCommit would normally return sharedSha, but because it is shared, it should return null
      const result = findLastNonNoiseCommit(root);
      assert.equal(result, null);
    });
  });

  test('squashTrailingBacklogNoiseIntoPreviousMission skips when worktree is dirty', () => {
    withTempRepo(root => {
      // 1. Initial commit
      fs.writeFileSync('README.md', '# Project\n');
      git(['add', 'README.md'], root);
      git(['commit', '-m', 'initial commit'], root);
      const initialSha = git(['rev-parse', 'HEAD'], root).trim();

      // 2. Backlog noise
      fs.mkdirSync('backlog/tasks', { recursive: true });
      fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
      git(['add', 'backlog/'], root);
      git(['commit', '-m', 'backlog: add task 1'], root);

      // 3. Make worktree dirty
      fs.writeFileSync('README.md', '# Project updated\n');

      // Should skip squash
      const result = squashTrailingBacklogNoiseIntoPreviousMission(root);
      assert.equal(result, false);

      // HEAD should still be the noise commit
      const headSha = git(['rev-parse', 'HEAD'], root).trim();
      assert.notEqual(headSha, initialSha);
    });
  });

  test('squashTrailingBacklogNoiseIntoPreviousMission skips when index is dirty', () => {
    withTempRepo(root => {
      // 1. Initial commit
      fs.writeFileSync('README.md', '# Project\n');
      git(['add', 'README.md'], root);
      git(['commit', '-m', 'initial commit'], root);

      // 2. Backlog noise
      fs.mkdirSync('backlog/tasks', { recursive: true });
      fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
      git(['add', 'backlog/'], root);
      git(['commit', '-m', 'backlog: add task 1'], root);

      // 3. Stage an unrelated change
      fs.writeFileSync('unrelated.txt', 'dirty\n');
      git(['add', 'unrelated.txt'], root);

      // Should skip squash
      const result = squashTrailingBacklogNoiseIntoPreviousMission(root);
      assert.equal(result, false);
    });
  });

  test('softResetTrailingBacklogNoise skips when worktree is dirty', () => {
    withTempRepo(root => {
      // 1. Initial commit
      fs.writeFileSync('README.md', '# Project\n');
      git(['add', 'README.md'], root);
      git(['commit', '-m', 'initial commit'], root);

      // 2. Backlog noise
      fs.mkdirSync('backlog/tasks', { recursive: true });
      fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
      git(['add', 'backlog/'], root);
      git(['commit', '-m', 'backlog: add task 1'], root);

      // 3. Make worktree dirty
      fs.writeFileSync('README.md', '# Project updated\n');

      // Should skip reset
      const result = softResetTrailingBacklogNoise(root);
      assert.equal(result, false);
    });
  });

  test('squashTrailingBacklogNoiseIntoPreviousMission succeeds when clean', () => {
    withTempRepo(root => {
      // 1. Initial commit
      fs.writeFileSync('README.md', '# Project\n');
      git(['add', 'README.md'], root);
      git(['commit', '-m', 'initial commit'], root);
      const initialSha = git(['rev-parse', 'HEAD'], root).trim();

      // 2. Backlog noise
      fs.mkdirSync('backlog/tasks', { recursive: true });
      fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
      git(['add', 'backlog/'], root);
      git(['commit', '-m', 'backlog: add task 1'], root);

      // Should succeed
      const result = squashTrailingBacklogNoiseIntoPreviousMission(root);
      assert.equal(result, true);

      // HEAD should now be a NEW commit that is an amendment of initial commit (so not equal to initialSha but containing its work)
      const headSha = git(['rev-parse', 'HEAD'], root).trim();
      assert.notEqual(headSha, initialSha);
      // The amended commit should contain the backlog noise file in its index (staged)
      const filesInCommit = git(['ls-tree', '-r', 'HEAD', '--name-only'], root);
      assert.ok(filesInCommit.includes('backlog/tasks/task-1.md'));
    });
  });
});
