// Behavior-owned suite (TASK-2622.09, integration-ci): the landed squash commit and its detection —
// commit subject/body (task-2595), hook-failure bounce (task-2377.05), base-branch landed scan
// (task-2517 F1), and already-merged detection and recovery refusal (task-2492). Legacy case names unchanged.
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import type { MissionStatus } from '../src/domain/mission.js';
import { approvedReview, inMemoryTransitionStore, integrateCommandMission } from './fixtures/mission-builders.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../src/adapters/git/git.js', import.meta.url);
mockModule('../src/adapters/filesystem/mission-utils.js', import.meta.url);
mockModule('../src/adapters/backlog/backlog.js', import.meta.url);
mockModule('../src/adapters/forgejo/forgejo.js', import.meta.url);
mockModule('../src/adapters/verification/verification.js', import.meta.url);
mockModule('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();
const { createMissionLanding } = await import('../src/application/integrate/landing.js');
const { checkBacklogIntegrity } = await import('../src/adapters/backlog/task-file-io.js');
const { findMissionDir, missionBranchName, missionTitle } = await import('../src/adapters/filesystem/mission-paths.js');
const { findExistingSquashCommit, findLandedSquashOnBaseBranch } = await import('../src/adapters/cli/commands/integrate-conflict.js');
const fmt = await import('../src/application/presentation/cli-format.js');
const { MissionIntegrationService } = await import('../src/application/mission-integration-service.js');
const { MissionLifecycleService } = await import('../src/application/mission-lifecycle-service.js');
const { recoverMissionCommand } = await import('../src/interfaces/cli/recover.js');
const { recoverMissionLifecycle } = await import('../src/application/mission-lifecycle-recovery.js');
const { missionId } = await import('../src/domain/mission.js');

// ---- task-2595 squash landing commit message (consolidated from test/task-2595-squash-landing-commit-message.test.ts, TASK-2622.09) ----
describe("task-2595 squash landing commit message", () => {
  // TASK-2595: a landed squash commit must read like the mission, not the
  // machinery. The subject carries the recorded mission title; the body records
  // the mission task reference.
  //
  // The test drives the real `publishMission` (local Variant B landing) against
  // a throwaway repository whose recorded title is distinct from the slug, so
  // the title -> subject wiring and the task reference -> body wiring are both
  // covered at the real Git boundary. Only the non-git landing collaborators
  // (stash, persistence, stats, worktree cleanup, hooks, verification proofs)
  // are stubbed.
  //
  // This crosses a real Git boundary, so it runs in the integration layer.


  const SLUG = 'task-9101';
  const TITLE = 'Restore the lost changelog archive';
  const BRANCH = `mission/${SLUG}`;

  function gitRun(args: string[]) {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    return { status: result.status ?? 1, stdout: String(result.stdout), stderr: String(result.stderr) };
  }

  function git(root: string, args: string[]): string {
    const result = gitRun(['-C', root, ...args]);
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
  }

  /**
   * Throwaway repository: `main` with a base commit, a mission dir recording a
   * title distinct from the slug plus the base branch, and a mission branch one
   * payload commit ahead of `main`.
   */
  function buildFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2595-'));
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@parallix.test']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['config', 'core.hooksPath', '/dev/null']);
    fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
    fs.mkdirSync(path.join(root, 'missions', SLUG), { recursive: true });
    fs.writeFileSync(path.join(root, 'missions', SLUG, 'MISSION.md'), `# Mission: ${TITLE}\n\nBase-Branch: main\n`);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'base']);

    git(root, ['checkout', '-q', '-b', BRANCH]);
    fs.writeFileSync(path.join(root, 'changelog.txt'), 'archive restored\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'restore changelog archive']);
    git(root, ['checkout', '-q', 'main']);
    return root;
  }

  /**
   * Drive the production `publishMission` with real Git and real mission-path
   * resolution (so the recorded MISSION.md title is what the landing sees);
   * only the non-git landing collaborators are stubbed.
   */
  function landing(root: string) {
    const abort = new Error('IntegrationAbort');
    const { publishMission } = createMissionLanding({
      git: {
        git: gitRun,
        getCurrentBranch: () => BRANCH,
        detectRebaseState: () => ({ inProgress: false, rebaseHead: null, unmergedFiles: [] }),
      },
      fileSystem: { existsSync: (target: string) => fs.existsSync(target), isSymbolicLink: () => false },
      backlog: { checkBacklogIntegrity: (rootDir: string) => checkBacklogIntegrity(rootDir) },
      // Real mission-path resolution, rooted at the fixture repository. The
      // slug-scoped helpers default to `process.cwd()`, which the test points
      // at the fixture so the recorded title is the one the landing reads.
      missionPaths: {
        inferSlug: () => SLUG,
        findMissionDir: (slug: string) => findMissionDir(slug, root),
        findMissionArea: () => 'all',
        missionTitle: (slug: string) => missionTitle(slug),
        missionBranchName: (slug: string) => missionBranchName(slug, root),
        missionDirForSlug: (dir: string, slug: string) => path.join(dir, 'missions', slug),
        getPrimaryWorktree: () => root,
        getPrimaryBranch: () => 'main',
        conventionalWorktreePath: () => path.join(root, 'absent-worktree'),
        resolveMissionBaseBranch: () => 'main',
        resolveBaseWorktree: () => root,
        resolveWorktree: () => null,
        findMissionDocInBranches: () => null,
        // The probe merge is clean in the fixture, so conflict parsing is never
        // reached; keep the seam stubbed like the other non-git collaborators.
        parseConflictFilesFromMergeOutput: () => [],
        softResetTrailingBacklogNoise: () => false,
      },
      productConfig: { isForgejoReviewEnabled: () => false },
      checkout: {
        stashMainCheckoutIfNeeded: () => null,
        findLandedSquashOnBaseBranch: () => null,
        maybeUpdateGraphifyOnPrimary: () => {},
      },
      landing: {
        createAbort: () => abort,
        classifyHookFailure: () => ({ isHookFailure: false }),
        persistLandedIntegrationOrAbort: async () => {},
        closeLandedIntegrationOrAbort: async () => {},
        recordPostIntegrationStatsOrAbort: async () => {},
        cleanupMissionWorktree: () => true,
        runPostIntegrateHookOrAbort: () => {},
      },
      gates: { isIntendedPayloadAtHead: () => false },
      verification: {
        formatVerificationCommand: () => 'verify',
        captureVerifiedTreeProof: () => ({ ok: true, proof: {} }),
        assertVerifiedTreeProof: () => ({ ok: true }),
      },
    } as never, { promoteTaskForIntegrationIfNeeded: async () => {} });
    const run = {
      slug: SLUG,
      context: { area: 'all', mainDirtyEntries: [] },
      missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration', title: TITLE }, version: 1 }) } },
      baseWorktree: root,
      baseBranch: 'main',
      seams: {},
      state: { temporaryStash: null, nextActionMessage: null },
    };
    return { publishMission: () => publishMission(run as never), abort };
  }

  test('TASK-2595: landed squash subject is the recorded title and body records the task reference', async (t) => {
    const root = buildFixture();
    t.mock.method(process, 'cwd', () => root);
    for (const quiet of ['debug', 'pass', 'plain', 'fail', 'info', 'warn'] as const) { t.mock.method(fmt.log, quiet, () => {}); }
    try {
      const headBefore = git(root, ['rev-parse', 'main']).trim();
      await landing(root).publishMission();
      const headAfter = git(root, ['rev-parse', 'main']).trim();

      assert.notEqual(headAfter, headBefore, 'the landing must advance main');
      assert.equal(
        git(root, ['rev-list', '--count', `${headBefore}..main`]).trim(),
        '1',
        'the mission must land as exactly one squash commit',
      );

      const subject = git(root, ['log', '-1', '--format=%s']).trim();
      assert.equal(subject, TITLE, `the subject must be the recorded title, got ${JSON.stringify(subject)}`);
      assert.notEqual(subject, SLUG, 'the subject must not fall back to the slug');

      const body = git(root, ['log', '-1', '--format=%b']);
      assert.ok(
        body.split('\n').includes(`Task: ${SLUG}`),
        `the body must record the mission task reference; body was ${JSON.stringify(body)}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Detection fixture: `main` carries one legacy-shape squash
   * (`mission/task-9102: …` subject) and one TASK-2595-shape squash (title
   * subject + `Task: task-9103` body line), with mission dirs recording the
   * base branch so the base-branch-scoped detector can resolve it.
   */
  function buildDetectionFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2595-detect-'));
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@parallix.test']);
    git(root, ['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(root, 'missions', 'task-9102'), { recursive: true });
    fs.mkdirSync(path.join(root, 'missions', 'task-9103'), { recursive: true });
    fs.writeFileSync(path.join(root, 'missions', 'task-9102', 'MISSION.md'), '# Mission: Legacy shape\n\nBase-Branch: main\n');
    fs.writeFileSync(path.join(root, 'missions', 'task-9103', 'MISSION.md'), `# Mission: ${TITLE}\n\nBase-Branch: main\n`);
    fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'base']);
    git(root, ['commit', '-qm', 'mission/task-9102: old style', '--allow-empty']);
    git(root, ['commit', '-qm', TITLE, '-m', 'Task: task-9103', '--allow-empty']);
    return root;
  }

  test('TASK-2595: landed-squash detection recognises the title subject plus task reference body', () => {
    const root = buildDetectionFixture();
    try {
      const head = git(root, ['rev-parse', 'HEAD']).trim();
      assert.equal(findExistingSquashCommit(root, 'task-9103'), head, 'the HEAD-scoped scan finds the new-shape squash by its task reference body line');
      assert.equal(findLandedSquashOnBaseBranch(root, 'task-9103'), head, 'the base-branch scan finds the new-shape squash by its task reference body line');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('TASK-2595: landed-squash detection still recognises the legacy mission/<slug>: subject', () => {
    const root = buildDetectionFixture();
    try {
      assert.ok(findExistingSquashCommit(root, 'task-9102'), 'the HEAD-scoped scan still finds the legacy-shape squash by subject prefix');
      assert.ok(findLandedSquashOnBaseBranch(root, 'task-9102'), 'the base-branch scan still finds the legacy-shape squash by subject prefix');
      assert.equal(findLandedSquashOnBaseBranch(root, 'task-9104'), null, 'an unrelated slug is never reported as landed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---- task-2377.05 squash hook bounce (consolidated from test/task-2377.05-integrate-squash-bounce.test.ts, TASK-2622.09) ----
describe("task-2377.05 squash hook bounce", () => {
  // ---------------------------------------------------------------------------
  // TASK-2377.05 — the `px integrate` squash-commit hook bounce runs through the
  // rebound kernel (SC2).
  //
  // The production `integrate.default` orchestration runs over a real Mission
  // store; only the Git/Forgejo/worktree boundaries are doubled and the kernel's
  // launch/transition/fallback seams are injected as mocks. No agent, LLM, or
  // network is involved. Two scenarios are exercised at the commit site:
  //
  //  S1  a pre-commit hook failure bounces once, the re-run commit passes, and
  //      the integration lands.
  //  S2  two failed re-run commits exhaust the kernel budget and the CLI throws
  //      IntegrationAbort with the existing operator hint.
  //  S3  an already-landed payload short-circuits before any bounce.
  //  S4  a non-hook commit failure takes the abort branch without bouncing.
  // ---------------------------------------------------------------------------

  const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
  const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
  const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
  const verification = mockModule<typeof import('../src/adapters/verification/verification.js')>('../src/adapters/verification/verification.js', import.meta.url);
  const integrate = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);

  const SLUG = 'task-2377.05-squash';
  const LANDED_SHA = 'a11ced0000000000000000000000000000000001';
  const LANDED_AT = '2026-08-04T23:30:00+02:00';

  function createFakeStore(status: MissionStatus) {
    return inMemoryTransitionStore(
      integrateCommandMission(SLUG, status, status === 'review' ? approvedReview(SLUG) : null),
      { persist: false },
    );
  }

  function servicesFor() {
    const store = createFakeStore('done');
    return {
      store,
      lifecycle: new MissionLifecycleService(store as never),
      integration: new MissionIntegrationService(store as never),
      handoff: { recordNel: async () => ({}) },
    };
  }

  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });

  interface Scenario {
    /** commit --only results per attempt; each entry is { status, stderr }. */
    commitResults: Array<{ status: number; stderr: string }>;
    /** payload already at HEAD on the first probe (SC3 short-circuit). */
    alreadyAtHead?: boolean;
  }

  async function runIntegrate(scenario: Scenario) {
    const root = registeredMkdtemp('parallix-2377-');
    fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { verification: { command: 'true' } } }));
    const taskFile = path.join(root, 'backlog', 'tasks', 'task.md');
    fs.writeFileSync(taskFile, 'status: approved\n');
    const services = servicesFor();
    const launches: string[] = [];
    const logs: string[] = [];

    // Capture the CLI's operator-facing output so the stranded branch's hint can
    // be asserted (fmt.log writes through stdout).
    mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => {
      logs.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });

    mock.method(missionUtils, 'inferSlug', () => SLUG);
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
    mock.method(missionUtils, 'getPrimaryWorktree', () => root);
    mock.method(missionUtils, 'findMissionDir', () => path.join(root, 'missions', SLUG));
    mock.method(missionUtils, 'findMissionArea', () => 'all');
    mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(root, '..', SLUG));
    mock.method(missionUtils, 'resolveMainRepo', () => root);
    mock.method(missionUtils, 'missionTitle', () => 'fixture');
    mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
    mock.method(missionUtils, 'softResetTrailingBacklogNoise', () => false);
    mock.method(git, 'getCurrentBranch', () => `mission/${SLUG}`);
    let commitAttempt = 0;
    mock.method(git, 'git', (args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('branch --show-current')) { return ok('main\n'); }
      if (joined.includes('log --format=%x00%H%x00%B')) { return ok('\0other0\0unrelated subject\n'); }
      if (args.includes('show')) { return ok(`${LANDED_AT}\n`); }
      if (joined.includes('merge') && joined.includes('--no-commit')) { return ok(''); }
      if (joined.includes('merge') && joined.includes('--abort')) { return ok(''); }
      if (joined.includes('merge') && joined.includes('--squash')) { return ok(''); }
      if (args.includes('diff') && args.includes('--quiet')) { return { status: scenario.alreadyAtHead ? 0 : 1, stdout: '', stderr: '' }; }
      if (args.includes('diff') && args.includes('--cached')) { return ok('fixture.ts\n'); }
      if (args.includes('commit')) {
        const r = scenario.commitResults[Math.min(commitAttempt, scenario.commitResults.length - 1)];
        commitAttempt += 1;
        return { status: r.status, stdout: '', stderr: r.stderr };
      }
      if (args.includes('rev-parse')) { return ok(`${LANDED_SHA}\n`); }
      return ok('');
    });
    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
    mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
    mock.method(backlog, 'getTaskStatus', () => 'approved');
    mock.method(backlog, 'getTaskAssignee', () => 'codex');
    mock.method(backlog, 'completeTask', () => true);
    mock.method(backlog, 'setTaskStatus', () => true);
    mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 1 }));
    mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true, proof: { rootDir: root } }));
    mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true }));
    mock.method(process, 'cwd', () => root);
    let exitCode: number | undefined;
    mock.method(process, 'exit', (code?: number) => { exitCode = code; });

    let error: Error | undefined;
    try {
      await integrate.default([SLUG, '--no-integration-gates'], {
        missionServicesFn: async () => services,
        startAgentFn: async () => { launches.push('launched'); return { agent: 'codex', result: { status: 0 } } as never; },
        transitionTaskFn: async () => true,
        applyAgentFallbackFn: async ({ original }: { original: string }) => original,
      });
    } catch (e) {
      error = e as Error;
    } finally {
      mock.reset();
      fs.rmSync(root, { recursive: true, force: true });
    }
    // The stranded (exhausted) path maps IntegrationAbort to exit 1 internally;
    // callers assert on the operator hint the CLI emits on that branch.
    return { error, exitCode, launches, logs };
  }

  // S1 — a pre-commit hook failure bounces once, the re-run commit passes, lands.
  test('SC2 S1: hook failure bounces through the kernel and lands when the re-run commit passes', async () => {
    const result = await runIntegrate({
      commitResults: [
        { status: 1, stderr: 'pre-commit: lint errors found' },
        { status: 0, stderr: '' },
      ],
    });
    assert.equal(result.launches.length, 1, 'exactly one implementer launch');
    assert.notEqual(result.exitCode, 1, 'integration lands with a success exit');
  });

  // S2 — two failed re-run commits exhaust the kernel budget → IntegrationAbort.
  test('SC2 S2: two failed re-run commits exhaust the budget and throw IntegrationAbort', async () => {
    const result = await runIntegrate({
      commitResults: [
        { status: 1, stderr: 'pre-commit: lint errors found' },
        { status: 1, stderr: 'pre-commit: lint errors found' },
      ],
    });
    assert.equal(result.launches.length, 2, 'the kernel spends its per-occurrence budget of two');
    assert.equal(result.exitCode, 1, 'the CLI strands the mission (IntegrationAbort maps to exit 1)');
    assert.match(
      result.logs.join('\n'),
      /Fix the reported hook failure in .* and retry integrate/,
      'the existing operator hint survives the migration',
    );
  });

  // S3 — payload already at HEAD short-circuits before any bounce.
  test('SC2 S3: an already-landed payload short-circuits without bouncing', async () => {
    const result = await runIntegrate({ alreadyAtHead: true, commitResults: [{ status: 1, stderr: 'pre-commit: x' }] });
    assert.equal(result.launches.length, 0, 'no bounce when the payload is already at HEAD');
    assert.equal(result.exitCode, 0, 'integration lands without bouncing');
  });

  // S4 — a non-hook commit failure takes the abort branch without bouncing.
  test('SC2 S4: a non-hook commit failure aborts without bouncing', async () => {
    const result = await runIntegrate({ commitResults: [{ status: 1, stderr: 'fatal: could not write the index' }] });
    assert.equal(result.launches.length, 0, 'a non-hook failure never launches an implementer');
    assert.equal(result.exitCode, 1);
  });
});

// ---- task-2517 base-branch landed squash detection (consolidated from test/task-2517-landed-squash-base-branch-detection.test.ts, TASK-2622.09) ----
describe("task-2517 base-branch landed squash detection", async () => {
  // TASK-2517 F1 (round 2): the SC4 landed-payload predicate must detect a squash
  // that landed on the *base branch*, because a landed mission's squash is created
  // with `git merge --squash` onto the base branch and is never reachable from the
  // mission worktree's HEAD. The HEAD-scoped `findExistingSquashCommit` returns
  // null in exactly the incident scenario (the operator runs `px review`/`px
// active` from the retained mission worktree); the base-branch-scoped
  // `findLandedSquashOnBaseBranch` must find it.
  //
  // This crosses the Git process boundary with a real temporary repository and a
  // real retained worktree, so it runs in the integration layer.

  const { findExistingSquashCommit, findLandedSquashOnBaseBranch } = await import('../src/adapters/cli/commands/integrate-conflict.js');

  const slug = 'task-2517-f1';

  /**
   * A repo whose `mission/<slug>` payload is squash-landed onto `main`, with a
   * retained worktree checked out on `mission/<slug>`. The operator stands in that
   * worktree, so `process.cwd()` is the mission worktree, not the base branch.
   */
  function landedFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2517-f1-'));
    const git = (args: string[]) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
      return String(result.stdout).trim();
    };
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@parallix.test']);
    git(['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(root, 'missions', slug), { recursive: true });
    // The recorded base branch is `main`, exactly as a real mission carries it.
    fs.writeFileSync(path.join(root, 'missions', slug, 'MISSION.md'), `# Fixture\n\nBase-Branch: main\n`);
    git(['add', '.']);
    git(['commit', '-m', 'mission dir']);
    git(['checkout', '-b', `mission/${slug}`]);
    fs.writeFileSync(path.join(root, 'payload.txt'), 'landed payload\n');
    git(['add', '.']);
    git(['commit', '-m', 'payload']);
    git(['checkout', 'main']);
    // The landed squash: created on `main`, subject carries the mission-branch
    // prefix so the base-branch scan recognises it.
    git(['merge', '--squash', `mission/${slug}`]);
    git(['commit', '-m', `mission/${slug}: land stranded payload`]);
    const worktree = `${root}-${slug}`;
    git(['worktree', 'add', worktree, `mission/${slug}`]);
    return { root, worktree };
  }

  test('TASK-2517 F1: HEAD-scoped scan misses a base-branch squash; base-branch scan finds it from the mission worktree', () => {
    const { root, worktree } = landedFixture();
    try {
      // The operator stands in the retained mission worktree; that is the cwd the
      // SC4 predicate receives as `rootDir`.
      const cwd = worktree;
      assert.equal(spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim(), `mission/${slug}`);

      // The defect F1 diagnoses: the squash is unreachable from the mission
      // worktree HEAD, so the HEAD-scoped detector returns null.
      assert.equal(
        findExistingSquashCommit(cwd, slug),
        null,
        'the HEAD-scoped scan cannot see a squash that lives on the base branch',
      );

      // The fix: the base-branch-scoped scan finds the landed squash from the
      // mission worktree, regardless of the current HEAD.
      const landed = findLandedSquashOnBaseBranch(cwd, slug);
      assert.ok(landed, 'the base-branch scan locates the landed squash from the mission worktree');
      const subject = spawnSync('git', ['log', '-1', '--format=%s', landed], { cwd: root, encoding: 'utf8' }).stdout.trim();
      assert.ok(subject.startsWith(`mission/${slug}:`), `the landed commit carries the mission-branch subject, was ${subject}`);
    } finally {
      spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: root });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('TASK-2517 F1: base-branch scan misses a payload that never landed on the base branch', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2517-f1-unlanded-'));
    const git = (args: string[]) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
      return String(result.stdout).trim();
    };
    try {
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'test@parallix.test']);
      git(['config', 'user.name', 'Test']);
      fs.mkdirSync(path.join(root, 'missions', slug), { recursive: true });
      fs.writeFileSync(path.join(root, 'missions', slug, 'MISSION.md'), `# Fixture\n\nBase-Branch: main\n`);
      git(['add', '.']);
      git(['commit', '-m', 'mission dir']);
      git(['checkout', '-b', `mission/${slug}`]);
      fs.writeFileSync(path.join(root, 'payload.txt'), 'unlanded payload\n');
      git(['add', '.']);
      git(['commit', '-m', 'payload']);
      // No squash merge onto main: the payload never lands on the recorded base.

      assert.equal(findLandedSquashOnBaseBranch(root, slug), null, 'an unlanded payload is never reported as landed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---- task-2492 already-merged detection (consolidated from test/task-2492-already-merged-detection.test.ts, TASK-2622.09) ----
describe("task-2492 already-merged detection", () => {
  // Fixture-git coverage for the TASK-2492 detection wiring. Integration lands
  // mission work with `git merge --squash`, so a landed mission branch tip is not
  // reachable from `main`; detection must key on the squash commit subject, not
  // branch ancestry. This test exercises the real `findExistingSquashCommit` seam
  // against a live repo (SC1/SC5).
  function makeRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2492-detect-'));
    const run = (args: string[]) => {
      const { status, stdout, stderr } = git(args, dir);
      if (status !== 0) { throw new Error(`git ${args.join(' ')} failed: ${stderr}`); }
      return stdout.trim();
    };
    run(['init', '-b', 'main']);
    run(['config', 'user.email', 'test@parallix.test']);
    run(['config', 'user.name', 'Test']);
    run(['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(dir, 'README.md'), '# base\n');
    run(['add', '.']);
    run(['commit', '-m', 'base']);
    return dir;
  }

  // Lightweight git runner scoped to a repo dir to avoid importing the module
  // singleton and keep the fixture self-contained.
  function git(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
  }

  test('TASK-2492: squash-landed mission payload is detected as already merged', () => {
    const rootDir = makeRepo();
    try {
      // Branch carries its own committed work.
      git(['checkout', '-b', 'mission/task-2492'], rootDir);
      fs.writeFileSync(path.join(rootDir, 'feature.txt'), 'work\n');
      git(['add', '.'], rootDir);
      git(['commit', '-m', 'add feature'], rootDir);

      // Squash-land onto main, exactly as `px integrate` does.
      git(['checkout', 'main'], rootDir);
      git(['merge', '--squash', 'mission/task-2492'], rootDir);
      git(['commit', '-m', 'mission/task-2492: add feature'], rootDir);

      // Authoritative payload containment: the squash commit subject is on main.
      const sha = findExistingSquashCommit(rootDir, 'task-2492');
      assert.ok(sha, 'squash commit for task-2492 must be found in the primary log');
      assert.match(sha as string, /^[0-9a-f]{40}$/);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('TASK-2492: branch with no committed payload is not reported as merged', () => {
    const rootDir = makeRepo();
    try {
      // Empty branch, nothing committed ahead of main — must never read as landed.
      git(['checkout', '-b', 'mission/task-2481'], rootDir);

      const sha = findExistingSquashCommit(rootDir, 'task-2481');
      assert.equal(sha, null);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('TASK-2492: recover command refuses a squash-landed mission and cleans up exactly once', async () => {
    const rootDir = makeRepo();
    try {
      git(['checkout', '-b', 'mission/task-2492'], rootDir);
      fs.writeFileSync(path.join(rootDir, 'feature.txt'), 'work\n');
      git(['add', '.'], rootDir);
      git(['commit', '-m', 'add feature'], rootDir);
      git(['checkout', 'main'], rootDir);
      git(['merge', '--squash', 'mission/task-2492'], rootDir);
      git(['commit', '-m', 'mission/task-2492: add feature'], rootDir);

      const mission = {
        id: missionId('task-2492'), repositoryId: 'repo' as never, title: 'Fixture', labels: [], assignee: null,
        checkpoints: [], review: null, netEngineeringLines: null, status: 'active' as const, closedAt: null,
      };
      const errors: string[] = [];
      let cleanupCalls = 0;
      const resumed = await recoverMissionCommand(['task-2492'], {
        // Real detection seam, wired like src/composition/create-cli.ts.
        taskStatus: () => 'active',
        alreadyMerged: (async (slug: string) => findExistingSquashCommit(rootDir, slug) !== null) as () => Promise<boolean>,
        cleanup: () => { cleanupCalls += 1; return true; },
        error: (message) => errors.push(message),
        store: {
          async load() { return { kind: 'found' as const, mission, version: 18 as never }; },
          async save() { throw new Error('must not reopen'); },
          async saveWithTransition() { throw new Error('must not reopen'); },
          async findTransitions() { return []; },
        } as never,
      });

      assert.equal(resumed, false);
      assert.equal(cleanupCalls, 1, 'cleanup must run exactly once');
      assert.deepEqual(errors, ['Recovery refused: durable integration history keeps this mission closed.']);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('TASK-2492: recovery does not fire for a not-yet-committed mission', async () => {
    const rootDir = makeRepo();
    try {
      git(['checkout', '-b', 'mission/task-2481'], rootDir);
      const mission = {
        id: missionId('task-2481'), repositoryId: 'repo' as never, title: 'Fixture', labels: [], assignee: null,
        checkpoints: [], review: null, netEngineeringLines: null, status: 'active' as const, closedAt: null,
      };
      let saved = 0;
      const result = await recoverMissionLifecycle({
        missionId: mission.id, taskStatus: 'active', actor: 'codex', occurredAt: new Date().toISOString(),
        alreadyMerged: (async (slug: string) => findExistingSquashCommit(rootDir, slug) !== null) as () => Promise<boolean>,
        store: {
          async load() { return { kind: 'found' as const, mission, version: 1 as never }; },
          async save() { saved += 1; return 2 as never; },
          async saveWithTransition() { saved += 1; return 3 as never; },
          async findTransitions() { return []; },
        } as never,
      });

      assert.equal(result.value?.action, 'none', 'not-landed mission must not be refused as integrated');
      assert.equal(saved, 0, 'recovery must not reopen or persist a not-landed mission');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
