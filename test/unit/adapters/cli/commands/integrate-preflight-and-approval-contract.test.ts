import { resolveConfiguration } from '../../../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };
// Historical regression provenance: TASK-1039, TASK-1219, TASK-1431, TASK-2204.
// Behavior-owned suite (TASK-2622.09): `px integrate` preflight reporting and approval evidence —
// printIntegrationPreflight outcomes (task-1039), local review-state approval fallback (task-1219),
// base-worktree classification resolution (task-1431), and merged-PR rejection (task-2204).
// Legacy case names unchanged; every external boundary is an injected double.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import os from 'node:os';
import { mockModule, installModuleMocks } from '../../../../lib/module-mock.js';
import { mkdtemp as registeredMkdtemp } from '../../../../helpers/temp-dir.js';
import { printIntegrationPreflight, buildIntegrationContext } from '../../../../../src/adapters/cli/commands/integrate.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);
mockModule('../../../../../src/adapters/backlog/backlog.js', import.meta.url);
mockModule('../../../../../src/composition/application-services.js', import.meta.url);
mockModule('../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
mockModule('../../../../../src/adapters/cli/commands/stats.js', import.meta.url);
await installModuleMocks();
const { checkReviewProvider } = await import('../../../../../src/application/integrate/preflight-review.js');

// ---- task-1039 preflight reporting (consolidated from test/task-1039-integrate-v3.test.ts, TASK-2622.09) ----
describe("preflight reporting", () => {
  const printIntegrationPreflightModule = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate.js')>('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);
  const getUnresolvedIndexConflictsModule = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate.js')>('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);
  const promoteTaskForIntegrationIfNeededModule = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate.js')>('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);
  const backlog = mockModule<typeof import('../../../../../src/adapters/backlog/backlog.js')>('../../../../../src/adapters/backlog/backlog.js', import.meta.url);
  const __mm1 = mockModule<typeof import('../../../../../src/composition/application-services.js')>('../../../../../src/composition/application-services.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const { printIntegrationPreflight } = printIntegrationPreflightModule;
  const { getUnresolvedIndexConflicts } = getUnresolvedIndexConflictsModule;
  const { promoteTaskForIntegrationIfNeeded } = promoteTaskForIntegrationIfNeededModule;
  const { mock } = test;

  const TEST_SLUG = 'task-preflight-test';

  // Hermetic doubles: the un-overridden defaults spawn the shimmed git CLI
  // against the operator's real repository (a subprocess per call).
  const cleanRebaseState = () => ({ inProgress: false, rebaseHead: '', detached: false, unmergedFiles: [], rebaseDir: null });
  const noMissionDocBranches = () => [];

  test('printIntegrationPreflight branch failure', (t) => {
    const context = {
      slug: TEST_SLUG,
      branch: 'mission/' + TEST_SLUG,
      currentBranch: 'main', // Fails
      missionDir: '/tmp/dir',
      task: { ok: true, taskFile: '/tmp/task.md' },
      taskStatus: 'ready-for-integration',
      pr: { exists: true, state: 'open', merged: false, number: 41 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      baseWorktree: '/tmp',
      baseBranch: 'main',
      missionWorktree: '/tmp/mission',
      mainDirty: false,
      mainDirtyEntries: []
    };

    const result = printIntegrationPreflight(context, { ...({
      readTokenFn: () => 'token',
      resolveTokenFileFn: () => 'file',
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
      detectRebaseStateFn: cleanRebaseState,
      findMissionDocInBranchesFn: noMissionDocBranches,
      conventionalWorktreePathFn: () => '/tmp/mission'
    }), configuration: resolveConfiguration(environment) });

    assert.ok(result.failures.includes('branch'));
  });

  test('printIntegrationPreflight mission-doc failure', (t) => {
    const context = {
      slug: TEST_SLUG,
      branch: 'mission/' + TEST_SLUG,
      currentBranch: 'mission/' + TEST_SLUG,
      missionDir: null, // Fails
      task: { ok: true, taskFile: '/tmp/task.md' },
      taskStatus: 'ready-for-integration',
      pr: { exists: true, state: 'open', merged: false, number: 41 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      baseWorktree: '/tmp',
      baseBranch: 'main',
      missionWorktree: '/tmp/mission',
      mainDirty: false,
      mainDirtyEntries: []
    };

    const result = printIntegrationPreflight(context, { ...({
      readTokenFn: () => 'token',
      resolveTokenFileFn: () => 'file',
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
      detectRebaseStateFn: cleanRebaseState,
      findMissionDocInBranchesFn: noMissionDocBranches,
      conventionalWorktreePathFn: () => '/tmp/mission'
    }), configuration: resolveConfiguration(environment) });

    assert.ok(result.failures.includes('mission-doc'));
  });

  test('printIntegrationPreflight task failures', (t) => {
    // Case 1: Ambiguous task
    const context1 = {
      slug: TEST_SLUG,
      branch: 'mission/' + TEST_SLUG,
      currentBranch: 'mission/' + TEST_SLUG,
      missionDir: '/tmp/dir',
      task: { ok: false, reason: 'ambiguous', matches: ['a.md', 'b.md'] },
      pr: { exists: true, state: 'open', merged: false, number: 41 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      baseWorktree: '/tmp',
      baseBranch: 'main',
      missionWorktree: '/tmp/mission',
      mainDirty: false,
      mainDirtyEntries: []
    };

    const res1 = printIntegrationPreflight(context1, { ...({
      readTokenFn: () => 'token',
      resolveTokenFileFn: () => 'file',
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
      detectRebaseStateFn: cleanRebaseState,
      findMissionDocInBranchesFn: noMissionDocBranches,
      conventionalWorktreePathFn: () => '/tmp/mission'
    }), configuration: resolveConfiguration(environment) });
    assert.ok(res1.failures.includes('task-ambiguity'));

    // Case 2: Missing task warns and falls back to unknown classification
    const context2 = { ...context1, task: { ok: false, reason: 'missing' } };
    const res2 = printIntegrationPreflight(context2, { ...({
      readTokenFn: () => 'token',
      resolveTokenFileFn: () => 'file',
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
      detectRebaseStateFn: cleanRebaseState,
      findMissionDocInBranchesFn: noMissionDocBranches,
      conventionalWorktreePathFn: () => '/tmp/mission'
    }), configuration: resolveConfiguration(environment) });
    assert.ok(!res2.failures.includes('task-missing'));
  });

  test('printIntegrationPreflight PR approval failures', (t) => {
    // Case 1: could not verify approval
    const context1 = {
      slug: TEST_SLUG,
      branch: 'mission/' + TEST_SLUG,
      currentBranch: 'mission/' + TEST_SLUG,
      missionDir: '/tmp/dir',
      task: { ok: true, taskFile: '/tmp/task.md' },
      taskStatus: 'ready-for-integration',
      pr: { exists: true, state: 'open', merged: false, number: 41 },
      approval: { ok: false, error: 'api error' },
      mainBranch: 'main',
      baseWorktree: '/tmp',
      baseBranch: 'main',
      missionWorktree: '/tmp/mission',
      mainDirty: false,
      mainDirtyEntries: []
    };

    const res1 = printIntegrationPreflight(context1, { ...({
      isForgejoReviewEnabledFn: () => true,
      readTokenFn: () => 'token',
      resolveTokenFileFn: () => 'file',
  // @ts-expect-error -- Legacy fixture deliberately exercises a duplicate or partial object-literal runtime shape.
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
      detectRebaseStateFn: cleanRebaseState,
      findMissionDocInBranchesFn: noMissionDocBranches,
      conventionalWorktreePathFn: () => '/tmp/mission'
    }), configuration: resolveConfiguration(environment) });
    assert.ok(res1.failures.includes('pr-approval'));

    // Case 2: review state not APPROVED
    const context2 = { ...context1, approval: { ok: true, reviewState: 'COMMENT' } };
    const res2 = printIntegrationPreflight(context2, { ...({
      isForgejoReviewEnabledFn: () => true,
      readTokenFn: () => 'token',
      resolveTokenFileFn: () => 'file',
  // @ts-expect-error -- Legacy fixture deliberately exercises a duplicate or partial object-literal runtime shape.
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
      detectRebaseStateFn: cleanRebaseState,
      findMissionDocInBranchesFn: noMissionDocBranches,
      conventionalWorktreePathFn: () => '/tmp/mission'
    }), configuration: resolveConfiguration(environment) });
    assert.ok(res2.failures.includes('pr-approval'));
  });

  test('printIntegrationPreflight main-index-conflict-check failure', (t) => {
    const context = {
      slug: TEST_SLUG,
      branch: 'mission/' + TEST_SLUG,
      currentBranch: 'mission/' + TEST_SLUG,
      missionDir: '/tmp/dir',
      task: { ok: true, taskFile: '/tmp/task.md' },
      taskStatus: 'ready-for-integration',
      pr: { exists: true, state: 'open', merged: false, number: 41 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      baseWorktree: '/tmp',
      baseBranch: 'main',
      missionWorktree: '/tmp/mission',
      mainDirty: false,
      mainDirtyEntries: []
    };

    const result = printIntegrationPreflight(context, { ...({
      readTokenFn: () => 'token',
      resolveTokenFileFn: () => 'file',
      getUnresolvedIndexConflictsFn: () => ({ ok: false, files: [], error: 'git error' }),
      detectRebaseStateFn: cleanRebaseState,
      findMissionDocInBranchesFn: noMissionDocBranches,
      conventionalWorktreePathFn: () => '/tmp/mission'
    }), configuration: resolveConfiguration(environment) });

    assert.ok(result.failures.includes('main-index-conflict-check'));
  });

  test('printIntegrationPreflight main-dirty warning', (t) => {
    const context = {
      slug: TEST_SLUG,
      branch: 'mission/' + TEST_SLUG,
      currentBranch: 'mission/' + TEST_SLUG,
      missionDir: '/tmp/dir',
      task: { ok: true, taskFile: '/tmp/task.md' },
      taskStatus: 'ready-for-integration',
      pr: { exists: true, state: 'open', merged: false, number: 41 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      baseWorktree: '/tmp',
      baseBranch: 'main',
      missionWorktree: '/tmp/mission',
      mainDirty: true,
      mainDirtyEntries: ['modified.js']
    };

    const result = printIntegrationPreflight(context, { ...({
      readTokenFn: () => 'token',
      resolveTokenFileFn: () => 'file',
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
      detectRebaseStateFn: cleanRebaseState,
      findMissionDocInBranchesFn: noMissionDocBranches,
      conventionalWorktreePathFn: () => '/tmp/mission'
    }), configuration: resolveConfiguration(environment) });

    assert.ok(result.warnings.includes('main-dirty'));
  });

  test('getUnresolvedIndexConflicts failure path', (t) => {
    const result = getUnresolvedIndexConflicts('/tmp/dir', {
      gitRunner: () => ({ status: 1, stdout: 'git error' })
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'git error');
  });

  test('promoteTaskForIntegrationIfNeeded failure path', async (t) => {
    const context = {
      task: { ok: true, taskFile: '/tmp/task.md' },
      taskStatus: 'review',
      approval: { ok: true, reviewState: 'APPROVED' },
      baseWorktree: '/tmp',
      missionDir: '/tmp/mission',
      slug: 'test-task',
      forgejoUser: 'custom'
    };

    // Mock backlog.setTaskStatus to fail
    const originalSetTaskStatus = backlog.setTaskStatus;
    backlog.setTaskStatus = () => false;

    // Mock createMissionApplicationServices for SQLite-first transitions
    const composition = __mm1;
    const originalCreate = composition.createMissionApplicationServices;
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    composition.createMissionApplicationServices = async () => ({
      store: {
        _repoId: 'default',
        load: async () => ({ kind: 'found', mission: { status: 'review', review: null }, version: 1 }),
      },
      lifecycle: {
        transition: async () => ({ status: 'completed', value: { to: 'integration', version: 2 } }),
      },
    });

    const originalError = console.error;
    console.error = () => {};

    try {
      let threw = false;
      try {
        await promoteTaskForIntegrationIfNeeded(context, {
          missionServicesFn: composition.createMissionApplicationServices,
        });
      } catch (err) {
        threw = true;
        assert.equal(err.constructor.name, 'IntegrationAbort', 'should throw IntegrationAbort');
      }
      assert.ok(threw, 'should have thrown');
    } finally {
      backlog.setTaskStatus = originalSetTaskStatus;
      composition.createMissionApplicationServices = originalCreate;
      console.error = originalError;
    }
  });
});

// ---- task-1219 local review-state approval fallback (consolidated from test/task-1219-fallback.test.ts, TASK-2622.09) ----
describe("local review-state approval fallback", () => {
  const backlog = mockModule<typeof import('../../../../../src/adapters/backlog/backlog.js')>('../../../../../src/adapters/backlog/backlog.js', import.meta.url);
  const missionUtils = mockModule<typeof import('../../../../../src/adapters/filesystem/mission-utils.js')>('../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const evaluateTaskStatusForIntegrationModule = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate.js')>('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);
  const __mm1 = mockModule<typeof import('../../../../../src/adapters/cli/commands/stats.js')>('../../../../../src/adapters/cli/commands/stats.js', import.meta.url);

  const { evaluateTaskStatusForIntegration, printIntegrationPreflight, buildIntegrationContext } = evaluateTaskStatusForIntegrationModule;
  const { mock } = test;

  __mm1;
  const FAKE_ROOT = `/tmp/mission-${process.pid}`;
  // TASK-2479: the preflight success-path detail (approval/token/classification)
  // is demoted to DEBUG so the default happy path stays concise. The checks are
  // unchanged — failures still print and still block — so these regression locks
  // ask for the detail explicitly to keep coverage of the resolved value.
  function withDebug(fn) {
    const previous = environment.DEBUG;
    environment.DEBUG = '1';
    try {
      return fn();
    } finally {
      if (previous === undefined) { delete environment.DEBUG; } else { environment.DEBUG = previous; }
    }
  }
  function installCommonMocks() {
    mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  }

  const previousPrimaryWorktree = environment.PRIMARY_WORKTREE;
  test.beforeEach(() => {
    environment.PRIMARY_WORKTREE = FAKE_ROOT;
    installCommonMocks();
  });

  test.afterEach(() => {
    if (previousPrimaryWorktree === undefined) delete environment.PRIMARY_WORKTREE;
    else environment.PRIMARY_WORKTREE = previousPrimaryWorktree;
    mock.reset();
  });

  // SC 1a: evaluateTaskStatusForIntegration accepts locally-derived reviewState: 'APPROVED' for tasks in status 'review'
  test('evaluateTaskStatusForIntegration accepts local-review-state approval for review status', () => {
    const result = evaluateTaskStatusForIntegration({
      taskStatus: 'review',
      pr: { merged: false },
      approval: { ok: true, reviewState: 'APPROVED', source: 'local-review-state' }
    });

    assert.equal(result.ok, true);
    assert.equal(result.level, 'warn');
    assert.match(result.message, /review accepted for integration/i);
    assert.match(result.message, /local review-state: approved/i);
  });

  // SC 1b: evaluateTaskStatusForIntegration rejects when only Forgejo is unavailable and local state is missing
  test('evaluateTaskStatusForIntegration rejects when token and review-state both missing', () => {
    const result = evaluateTaskStatusForIntegration({
      taskStatus: 'review',
      pr: { merged: false },
      approval: { ok: false, error: 'forgejo-off', reviewState: null, source: undefined }
    });

    assert.equal(result.ok, false);
    assert.equal(result.level, 'fail');
    assert.match(result.message, /expected approved, or review with an approved Forgejo PR/i);
  });

  // SC 1c: evaluateTaskStatusForIntegration does not confuse local source with Forgejo APPROVED for default user override.
  // TASK-2379: the defaultUserApproved boolean is no longer an approval authority at all;
  // the override is persisted as a ReviewerDecision by recovery, and the preflight
  // accepts the Mission lifecycle instead of the boolean.
  test('evaluateTaskStatusForIntegration: defaultUserApproved boolean is not an approval authority without the lifecycle', () => {
    const context = {
      taskStatus: 'review',
      pr: { merged: false },
      approval: { ok: true, reviewState: 'REQUEST_CHANGES', defaultUserApproved: true }
    };

    const result = evaluateTaskStatusForIntegration(context);
    assert.equal(result.ok, false);
    assert.equal(result.level, 'fail');

    const recovered = evaluateTaskStatusForIntegration({ ...context, missionStatus: 'integration' });
    assert.equal(recovered.ok, true);
    assert.match(recovered.message, /Mission lifecycle/i);
  });

  // SC 3a: printIntegrationPreflight passes preflight when approval is local-only (token missing + review-state approved)
  test('printIntegrationPreflight logs INFO instead of FAIL for token + approval when local review-state is approved', () => {
    const lines = [];
    const logs = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = line => logs.push(line);
    console.error = line => logs.push(line);

    try {
      const result = printIntegrationPreflight({
        slug: 'task-1219',
        branch: 'mission/task-1219',
        currentBranch: 'mission/task-1219',
        missionDir: '/tmp/docs/missions/2026/task-1219',
        task: { ok: true, taskFile: '/tmp/task-1219.md' },
        taskStatus: 'review',
        taskAssignee: 'autonomous',
        forgejoUser: 'autonomous',
        taskAssigneeWarning: null,
        pr: { exists: true, state: 'open', merged: false, number: 1219 },
        approval: { ok: true, reviewState: 'APPROVED', source: 'local-review-state' },
        mainBranch: 'main',
        mainDirty: false,
        mainDirtyEntries: []
      }, { ...({
        readTokenFn: () => null,
        resolveTokenFileFn: () => null,
        isForgejoReviewEnabledFn: () => true,
        getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
      }), configuration: resolveConfiguration(environment) });

      // The approval should not be a failure — local review-state fallback applies
      assert.ok(!result.failures.includes('pr-approval'));
      // The token should not be a failure either
      assert.ok(!result.failures.includes('forgejo-token'));
      // Check the INFO-level logging text
      const output = logs.join('\n');
      assert.ok(output.includes('local review-state') || output.includes('approved'));
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  // SC 3b: printIntegrationPreflight fails preflight when token missing AND no local review-state
  test('printIntegrationPreflight still fails when no token AND no local review-state', () => {
    const lines = [];
    const logs = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = line => logs.push(line);
    console.error = line => logs.push(line);

    try {
      const result = printIntegrationPreflight({
        slug: 'task-1219',
        branch: 'mission/task-1219',
        currentBranch: 'mission/task-1219',
        missionDir: '/tmp/docs/missions/2026/task-1219',
        task: { ok: true, taskFile: '/tmp/task-1219.md' },
        taskStatus: 'review',
        taskAssignee: 'autonomous',
        forgejoUser: 'autonomous',
        taskAssigneeWarning: null,
        pr: { exists: true, state: 'open', merged: false, number: 1219 },
        approval: { ok: false, error: 'forgejo-off', reviewState: null, source: undefined },
        mainBranch: 'main',
        mainDirty: false,
        mainDirtyEntries: []
      }, { ...({
        readTokenFn: () => null,
        resolveTokenFileFn: () => null,
        isForgejoReviewEnabledFn: () => true,
        getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
      }), configuration: resolveConfiguration(environment) });

      // Without local fallback, this should have the failures as before
      assert.ok(result.failures.includes('forgejo-token'));
      assert.ok(result.failures.includes('pr-approval'));
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  // SC 3c: printIntegrationPreflight passes when local review-state + token available (happy case unchanged)
  test('printIntegrationPreflight PASS for approval when token and forgejo report approved', () => {
    const logs = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = line => logs.push(line);
    console.error = line => logs.push(line);

    try {
      const result = withDebug(() => printIntegrationPreflight({
        slug: 'task-1219',
        branch: 'mission/task-1219',
        currentBranch: 'mission/task-1219',
        missionDir: '/tmp/docs/missions/2026/task-1219',
        task: { ok: true, taskFile: '/tmp/task-1219.md' },
        taskStatus: 'review',
        taskAssignee: 'codex',
        forgejoUser: 'codex',
        taskAssigneeWarning: null,
        pr: { exists: true, state: 'open', merged: false, number: 1219 },
        approval: { ok: true, reviewState: 'APPROVED' },
        mainBranch: 'main',
        mainDirty: false,
        mainDirtyEntries: []
      }, { ...({
        readTokenFn: () => 'secret-token',
        resolveTokenFileFn: () => '/tmp/tokens/codex',
        isForgejoReviewEnabledFn: () => true,
        getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
      }), configuration: resolveConfiguration(environment) }));

      // Forgejo path should PASS
      assert.ok(!result.failures.includes('pr-approval'));
      assert.ok(!result.failures.includes('forgejo-token'));
      const output = logs.join('\n');
      assert.ok(output.includes('Forgejo approval: latest formal review state is APPROVED'));
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  // SC 5a: buildIntegrationContext returns local-approved approval when readToken returns null but review-state.json has phase=approved
  test('buildIntegrationContext returns local-review-state approval when token missing but review-state is approved', async () => {
    const tmpRoot = registeredMkdtemp('task-1219-bic-test-');
    const missionDir = path.join(tmpRoot, 'docs', 'missions', '2026', 'task-1219');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: task-1219\n');
    const taskFile = path.join(missionDir, 'tasks', 'task-1219.md');
    fs.mkdirSync(path.join(missionDir, 'tasks'), { recursive: true });
    fs.writeFileSync(taskFile, '# task-1219\n');
    const stateFile = path.join(missionDir, 'review-state.json');
    fs.writeFileSync(stateFile, JSON.stringify({
      reviewer: 'claude',
      implementer: 'custom',
      round: 1,
      startedAt: '2026-06-02T13:00:00.000Z',
      phase: 'approved',
      disposition: 'APPROVED'
    }), 'utf8');
    const previous = process.cwd();
    try {
      process.chdir(tmpRoot);
      const result = await buildIntegrationContext('task-1219', {
        baseBranch: 'main',
        baseWorktree: tmpRoot,
        isForgejoReviewEnabledFn: () => true,
        readTokenFn: () => null,
        getPrStatusFn: () => ({ exists: true, state: 'open', merged: false, number: 1219 }),
        readReviewStateFn: (slug, rootDir) => {
          const statePath = path.join(rootDir, 'docs', 'missions', '2026', slug, 'review-state.json');
          try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
          catch { return null; }
        },
        getLatestReviewDecisionFn: () => ({ ok: false, error: 'connection-refused', reviewState: null }),
        getCurrentBranchFn: () => 'mission/task-1219',
        gitFn: () => ({ status: 0, stdout: 'main', stderr: '' })
      });

      assert.ok(result.approval, 'approval should be present');
      assert.equal(result.approval.ok, true, 'approval.ok should be true');
      assert.equal(result.approval.reviewState, 'APPROVED', 'reviewState should be APPROVED');
      assert.equal(result.approval.source, 'local-review-state', 'approval should be sourced from local review-state');
    } finally {
      process.chdir(previous);
      if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
      mock.reset();
    }
  });

  // SC 5a negation: no local fallback when review-state.json is missing and Forgejo is down
  test('buildIntegrationContext does not fallback when review-state.json is absent', async () => {
    const tmpRoot = registeredMkdtemp('task-1219-bic-no-rs-');
    const missionDir = path.join(tmpRoot, 'docs', 'missions', '2026', 'task-1219');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: task-1219\n');
    const taskFile = path.join(missionDir, 'tasks', 'task-1219.md');
    fs.mkdirSync(path.join(missionDir, 'tasks'), { recursive: true });
    fs.writeFileSync(taskFile, '# task-1219\n');
    // Deliberately do NOT write review-state.json
    const previous = process.cwd();
    try {
      process.chdir(tmpRoot);
      const result = await buildIntegrationContext('task-1219', {
        baseBranch: 'main',
        baseWorktree: tmpRoot,
        isForgejoReviewEnabledFn: () => true,
        readTokenFn: () => null,
        getPrStatusFn: () => ({ exists: true, state: 'open', merged: false, number: 1219 }),
        readReviewStateFn: (slug, rootDir) => {
          const statePath = path.join(rootDir, 'docs', 'missions', '2026', slug, 'review-state.json');
          try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
          catch { return null; }
        },
        getLatestReviewDecisionFn: () => ({ ok: false, error: 'connection-refused', reviewState: null }),
        getCurrentBranchFn: () => 'mission/task-1219',
        gitFn: () => ({ status: 0, stdout: 'main', stderr: '' })
      });
      assert.equal(result.approval.source, undefined, 'without review-state.json, fallback source must be absent');
    } finally {
      process.chdir(previous);
      if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
      mock.reset();
    }
  });

  // SC 5a disposition guard: phase=approved but disposition=REQUEST_CHANGES should NOT produce local fallback
  test('buildIntegrationContext requires disposition=APPROVED not just phase=approved', async () => {
    const tmpRoot = registeredMkdtemp('task-1219-disposition-');
    const missionDir = path.join(tmpRoot, 'docs', 'missions', '2026', 'task-1219');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: task-1219\n');
    const stateFile = path.join(missionDir, 'review-state.json');
    fs.writeFileSync(stateFile, JSON.stringify({
      reviewer: 'claude', implementer: 'custom', round: 1,
      phase: 'approved', disposition: 'REQUEST_CHANGES'
    }), 'utf8');
    const taskFile = path.join(missionDir, 'tasks', 'task-1219.md');
    fs.mkdirSync(path.join(missionDir, 'tasks'), { recursive: true });
    fs.writeFileSync(taskFile, '# task-1219\n');
    const previous = process.cwd();
    try {
      process.chdir(tmpRoot);
      const result = await buildIntegrationContext('task-1219', {
        baseBranch: 'main',
        baseWorktree: tmpRoot,
        isForgejoReviewEnabledFn: () => true,
        readTokenFn: () => null,
        getPrStatusFn: () => ({ exists: true, state: 'open', merged: false, number: 1219 }),
        readReviewStateFn: (slug, rootDir) => {
          const statePath = path.join(rootDir, 'docs', 'missions', '2026', slug, 'review-state.json');
          try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
          catch { return null; }
        },
        getLatestReviewDecisionFn: () => ({ ok: false, error: 'connection-refused', reviewState: null }),
        getCurrentBranchFn: () => 'mission/task-1219',
        gitFn: () => ({ status: 0, stdout: 'main', stderr: '' })
      });
      assert.notEqual(result.approval.source, 'local-review-state', 'phase=approved with disposition=REQUEST_CHANGES should not fallback');
      assert.equal(result.approval.ok, false, 'fallback should not apply when disposition is not APPROVED');
    } finally {
      process.chdir(previous);
      if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
      mock.reset();
    }
  });

  // End-to-end: buildIntegrationContext output → printIntegrationPreflight validates local fallback path
  test('printIntegrationPreflight accepts buildIntegrationContext local-review-state output without forgejo-token FAIL', () => {
    const logs = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = line => logs.push(line);
    console.error = line => logs.push(line);

    try {
      const ctx = {
        slug: 'task-1219',
        branch: 'mission/task-1219',
        currentBranch: 'mission/task-1219',
        missionDir: '/tmp/docs/missions/2026/task-1219',
        task: { ok: true, taskFile: '/tmp/task-1219.md' },
        taskStatus: 'review',
        taskAssignee: 'custom',
        forgejoUser: 'custom',
        taskAssigneeWarning: null,
        pr: { exists: true, state: 'open', merged: false, number: 1219 },
        // This is exactly what buildIntegrationContext sets when local fallback succeeds
        approval: { ok: true, reviewState: 'APPROVED', source: 'local-review-state' },
        baseBranch: 'main',
        baseWorktree: '/tmp',
        mainBranch: 'main',
        mainDirty: false,
        mainDirtyEntries: []
      };

      const result = withDebug(() => printIntegrationPreflight(ctx, { ...({
        readTokenFn: () => null,
        resolveTokenFileFn: () => null,
        isForgejoReviewEnabledFn: () => true,
        getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
      }), configuration: resolveConfiguration(environment) }));

      // Prevalent success criteria: no pr-approval or forgejo-token failure when local fallback is active
      assert.ok(!result.failures.includes('pr-approval'), 'pr-approval must not be in failures with local-review-state');
      assert.ok(!result.failures.includes('forgejo-token'), 'forgejo-token must not be in failures with local-review-state');
      const output = logs.join('\n');
      // TASK-2479: the local-review-state fallback is demoted to DEBUG, so the
      // benign fallback still resolves without a FAIL and is reported behind DEBUG.
      assert.ok(output.includes('approval sourced from the local Review'), 'should report the local-review-state fallback behind DEBUG, not FAIL');
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
});

// ---- task-1431 preflight classification source (consolidated from test/task-1431-integration-preflight-repro.test.ts, TASK-2622.09) ----
describe("preflight classification source", () => {
  // Regression coverage for task-1431: integration preflight backlog-resolution
  // regressions.
  //
  // Locks three transcripted defects in `px integrate` preflight:
  //   1. A false "Could not resolve backlog task for <slug>." classification
  //      failure even though the backlog task exists and is otherwise
  //      integration-eligible, caused by classification resolution using a
  //      different root than the one that actually resolved the task file.
  //   2. Ambiguous-slug and missing-task scenarios must stay distinguishable:
  //      ambiguous slugs are a hard failure with listed candidates; missing
  //      tasks are a warning with an `unknown` classification fallback.
  //   3. A null mission slug must never leak into preflight output ("Integration
  //      preflight for null" / "expected mission/null") when the caller is
  //      integrating a real mission.


  // TASK-2479: the preflight classification detail is demoted to DEBUG so the
  // default happy path stays concise. The checks are unchanged, so these
  // regression locks ask for the detail explicitly to keep coverage of the
  // resolved classification value.
  function withDebug(fn) {
    const previous = environment.DEBUG;
    environment.DEBUG = '1';
    try {
      return fn();
    } finally {
      if (previous === undefined) { delete environment.DEBUG; } else { environment.DEBUG = previous; }
    }
  }

  function withTempBaseWorktree(fn) {
    const root = registeredMkdtemp('task-1431-base-');
    try {
      fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
      fn(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  function baseContext(overrides) {
    return Object.assign({
      slug: 'task-preflight-test',
      branch: 'mission/task-preflight-test',
      currentBranch: 'mission/task-preflight-test',
      missionDir: '/tmp/docs/missions/2026/task-preflight-test',
      taskAssignee: 'codex',
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: false, raw: 'no PR found' },
      approval: { ok: false, error: 'pr-missing', reviewState: null },
      mainBranch: 'main',
      baseWorktree: '/tmp',
      baseBranch: 'main',
      missionWorktree: '/tmp/mission',
      mainDirty: false,
      mainDirtyEntries: []
    }, overrides);
  }

  function captureLines() {
    const lines = [];
    return { lines, log: line => lines.push(line) };
  }

  const defaultPreflightOpts = {
    readTokenFn: () => 'secret-token',
    resolveTokenFileFn: () => '/tmp/tokens/codex',
    isForgejoReviewEnabledFn: () => false,
    conventionalWorktreePathFn: () => '/tmp/mission',
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
  };

  test('printIntegrationPreflight resolves classification from the mission base worktree, not process.cwd()', () => {
    withTempBaseWorktree(root => {
      const taskFile = path.join(root, 'backlog', 'tasks', 'task-preflight-test - repro.md');
      fs.writeFileSync(taskFile, '---\nid: TASK-PREFLIGHT-TEST\nlabels:\n  - ai_sdlc\n---\n');

      const { lines, log } = captureLines();
      const context = baseContext({
        task: { ok: true, taskFile },
        taskStatus: 'ready-for-integration',
        baseWorktree: root
      });

      // Sanity check: the repo's own cwd (where this test process runs) does
      // NOT contain this fixture task, so any resolution that ignores
      // context.baseWorktree and defaults to process.cwd() must fail.
      assert.notEqual(process.cwd(), root);

  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      const result = withDebug(() => printIntegrationPreflight(context, { ...(Object.assign({ log }, defaultPreflightOpts)), configuration: resolveConfiguration(environment) }));

      const output = lines.join('\n');
      assert.ok(!result.failures.includes('classification'), `unexpected classification failure in:\n${output}`);
      assert.match(output, /Backlog classification: ai_sdlc/);
      assert.doesNotMatch(output, /Could not resolve backlog task for task-preflight-test\./);
    });
  });

  test('printIntegrationPreflight still hard-fails on an ambiguous slug rather than degrading to missing-task', () => {
    const { lines, log } = captureLines();
    const context = baseContext({
      task: { ok: false, reason: 'ambiguous', matches: ['a.md', 'b.md'] },
      taskStatus: null
    });

  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    const result = printIntegrationPreflight(context, { ...(Object.assign({ log }, defaultPreflightOpts)), configuration: resolveConfiguration(environment) });

    const output = lines.join('\n');
    assert.ok(result.failures.includes('task-ambiguity'));
    assert.match(output, /Backlog task: ambiguous slug task-preflight-test/);
    assert.match(output, /a\.md/);
    assert.match(output, /b\.md/);
    assert.doesNotMatch(output, /no task file found/);
    assert.doesNotMatch(output, /Backlog classification: unknown/);
  });

  test('printIntegrationPreflight still warns and falls back to unknown classification for a genuinely missing task', () => {
    const { lines, log } = captureLines();
    const context = baseContext({
      task: { ok: false, reason: 'missing' },
      taskStatus: null
    });

  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    const result = withDebug(() => printIntegrationPreflight(context, { ...(Object.assign({ log }, defaultPreflightOpts)), configuration: resolveConfiguration(environment) }));

    const output = lines.join('\n');
    assert.ok(!result.failures.includes('task-missing'));
    assert.ok(!result.failures.includes('classification'));
    assert.match(output, /no task file found for task-preflight-test/);
    assert.match(output, /Backlog classification: unknown/);
  });

  test('printIntegrationPreflight refuses to run with a null mission slug instead of printing "for null"', () => {
    const { lines, log } = captureLines();
    const context = baseContext({
      slug: null,
      branch: 'mission/null',
      task: { ok: true, taskFile: '/tmp/task.md' },
      taskStatus: 'ready-for-integration'
    });

    assert.throws(
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      () => printIntegrationPreflight(context, { ...(Object.assign({ log }, defaultPreflightOpts)), configuration: resolveConfiguration(environment) }),
      /non-null mission slug/
    );

    const output = lines.join('\n');
    assert.doesNotMatch(output, /Integration preflight for null/);
    assert.doesNotMatch(output, /expected mission\/null/);
  });

  test('buildIntegrationContext refuses to build a context for a null mission slug', async () => {
    await assert.rejects(() => buildIntegrationContext(null), /non-null mission slug/);
    await assert.rejects(() => buildIntegrationContext(undefined), /non-null mission slug/);
  });
});

// ---- task-2204 merged Forgejo PR rejection (consolidated from test/task-2204-integrate-no-variant-a.test.ts, TASK-2622.09) ----
describe("merged Forgejo PR rejection", () => {
  test('integrate rejects merged Forgejo PRs during preflight with recovery guidance', () => {
    const output: string[] = [];
    const report = { failures: [], warnings: [], log: (line: string) => output.push(line), detail: () => {} };

    checkReviewProvider(report, {
      slug: 'task-2204',
      missionStatus: 'review',
      pr: { exists: true, state: 'merged', number: 2204 },
      approval: { ok: true, reviewState: 'APPROVED' },
      siblingPrs: [],
      forgejoUser: null,
    }, { baseWorktree: '/repo', baseBranch: 'main', readTokenFn: () => null, resolveTokenFileFn: () => null });

    assert.deepEqual(report.failures, ['pr-merged', 'forgejo-token']);
    assert.match(output.join('\n'), /Forgejo PR: PR #2204 is already marked merged/i);
    assert.match(output.join('\n'), /re-sync the local base branch/i);
    assert.match(output.join('\n'), /px integrate task-2204 --dry-run/i);
  });
});
