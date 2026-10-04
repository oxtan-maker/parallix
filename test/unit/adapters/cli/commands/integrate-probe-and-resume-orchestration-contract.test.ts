// Historical regression provenance: TASK-1039, TASK-2243, TASK-2520, TASK-2506.
// Behavior-owned suite (TASK-2622.09): `px integrate` orchestration over injected Git, Backlog, Forgejo,
// verification and stats ports — argument/preflight/gate stops (task-1039), probe-merge abort without
// review-task promotion (task-2243), landing resume after a failed sync-merged (task-2520), and the
// behind-primary rebase prediction (task-2506). Legacy case names unchanged.
import test, { test as testS2, mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mockModule, installModuleMocks } from '../../../../lib/module-mock.js';
import { mkdtemp as registeredMkdtemp } from '../../../../helpers/temp-dir.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../../../../../src/adapters/git/git.js', import.meta.url);
mockModule('../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
mockModule('../../../../../src/adapters/backlog/backlog.js', import.meta.url);
mockModule('../../../../../src/adapters/forgejo/forgejo.js', import.meta.url);
mockModule('../../../../../src/adapters/cli/commands/stats.js', import.meta.url);
mockModule('../../../../../src/adapters/verification/verification.js', import.meta.url);
mockModule('../../../../../src/composition/application-services.js', import.meta.url);
mockModule('../../../../../src/adapters/cli/commands/integrate-conflict.js', import.meta.url);
mockModule('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);
mockModule('../../../../../src/adapters/config/repository-gates.js', import.meta.url);
mockModule('../../../../../src/adapters/cli/commands/integrate-gates.js', import.meta.url);
await installModuleMocks();

// ---- task-1039 integrate orchestration and gates (consolidated from test/task-1039-integrate.test.ts, TASK-2622.09) ----
describe("integrate orchestration and gates", () => {
  const _require = createRequire(import.meta.url);
  const gitModule = mockModule<typeof import('../../../../../src/adapters/git/git.js')>('../../../../../src/adapters/git/git.js', import.meta.url);
  const missionUtilsModule = mockModule<typeof import('../../../../../src/adapters/filesystem/mission-utils.js')>('../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const backlogModule = mockModule<typeof import('../../../../../src/adapters/backlog/backlog.js')>('../../../../../src/adapters/backlog/backlog.js', import.meta.url);
  const forgejoModule = mockModule<typeof import('../../../../../src/adapters/forgejo/forgejo.js')>('../../../../../src/adapters/forgejo/forgejo.js', import.meta.url);
  const statsModule = mockModule<typeof import('../../../../../src/adapters/cli/commands/stats.js')>('../../../../../src/adapters/cli/commands/stats.js', import.meta.url);
  const verificationModule = mockModule<typeof import('../../../../../src/adapters/verification/verification.js')>('../../../../../src/adapters/verification/verification.js', import.meta.url);
  const __mm1 = mockModule<typeof import('../../../../../src/composition/application-services.js')>('../../../../../src/composition/application-services.js', import.meta.url);
  const __mm2 = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate.js')>('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);
  // TASK-2457: observe the generic gate runner so the integration-phase gate can
  // be made to fail without a real merge. integrate.ts is itself a declared and
  // re-linked module, so it resolves its runner import through this facade.
  const repositoryGatesModule = mockModule<typeof import('../../../../../src/adapters/config/repository-gates.js')>(
    '../../../../../src/adapters/config/repository-gates.js', import.meta.url);
  // The integration gate resolves its verification worktree through this facade.
  // Pin it to each temporary checkout: isolated unit workers otherwise fall back
  // to the real primary worktree and make unrelated preflight tests non-hermetic.
  const integrateGatesModule = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate-gates.js')>(
    '../../../../../src/adapters/cli/commands/integrate-gates.js', import.meta.url);

  const { mock } = test;

  const git = gitModule;
  const missionUtils = missionUtilsModule;
  const backlog = backlogModule;
  const forgejo = forgejoModule;
  const stats = statsModule;
  const verification = verificationModule;
  const composition = __mm1;

  const TEST_SLUG = 'task-integrate-test';
  const FAKE_ROOT = '/tmp/integrate-test-root';
  const WORKTREE = path.join(FAKE_ROOT, '..', TEST_SLUG);

  // The integrate module's command entry point is its default export; its
  // helpers are named exports. Expose both through the ESM mock facade so the
  // existing call sites (`integrate([...])` and `integrate.resolveConflicts...`)
  // keep working without a writable CommonJS `exports` object.
  function loadIntegrate() {
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    return Object.assign((...args) => __mm2.default(...args), __mm2);
  }

  function setupMocks() {
    mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
    mock.method(missionUtils, 'inferSlug', (s) => s || TEST_SLUG);
    mock.method(missionUtils, 'findMissionDir', (_slug, rootDir = FAKE_ROOT) => path.join(rootDir, 'docs/missions/2026', TEST_SLUG));
    mock.method(missionUtils, 'findMissionArea', () => 'docs');
    mock.method(missionUtils, 'getPrimaryWorktree', () => FAKE_ROOT);
    mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(FAKE_ROOT, '..', TEST_SLUG));
    mock.method(git, 'getCurrentBranch', () => 'mission/' + TEST_SLUG);
    mock.method(git, 'git', () => ({ status: 0, stdout: 'main', stderr: '' }));
    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(FAKE_ROOT, 'backlog/tasks/task.md') }));
    mock.method(backlog, 'getTaskStatus', () => 'ready-for-integration');
    mock.method(backlog, 'getTaskAssignee', () => 'claude');
    mock.method(backlog, 'setTaskStatus', () => true);
    mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 41 }));
    mock.method(forgejo, 'listOpenPrsForSlug', () => []);
    mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
    mock.method(forgejo, 'readToken', () => 'token');
    mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
    mock.method(forgejo, 'syncMerged', () => ({ ok: true }));
    mock.method(verification, 'captureVerifiedTreeProof', (area, rootDir) => ({
      ok: true,
      proof: {
        rootDir: path.resolve(rootDir),
        area,
        command: 'mock-verification',
        commit: 'abc123',
        tree: 'tree123',
        verifiedAt: '2026-01-01T00:00:00.000Z'
      }
    }));
    mock.method(verification, 'assertVerifiedTreeProof', (proof, rootDir) => {
      const resolvedRoot = path.resolve(rootDir);
      if (!proof || proof.rootDir !== resolvedRoot) {
        return { ok: false, error: 'verification proof does not match the tree being published' };
      }
      return { ok: true, proof };
    });
    mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
    mock.method(process, 'cwd', () => FAKE_ROOT);
    mock.method(process, 'exit', () => {});

    // SC3: Mock createMissionApplicationServices for SQLite-first transitions.
    // The mission carries an authoritative approved Review so integrate's
    // lifecycle recovery reaches the scenario each test exercises.
    mock.method(composition, 'createMissionApplicationServices', async () => ({
      store: {
        _repoId: 'default',
        load: async () => ({ kind: 'found', mission: { status: 'review', review: { rounds: [{ decision: { kind: 'approved', decidedAt: '2026-01-01T10:30:00Z' } }] } }, version: 1 }),
      },
      lifecycle: {
        transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }),
      },
      handoff: {
        recordNel: async () => ({}),
      },
    }));
    
    if (!fs.existsSync(FAKE_ROOT)) fs.mkdirSync(FAKE_ROOT, { recursive: true });
    fs.writeFileSync(path.join(FAKE_ROOT, 'workflow.config.json'), JSON.stringify({
      adapters: { verification: { command: 'true' } },
    }), 'utf8');
  }

  function cleanup() {
    mock.reset();
    if (fs.existsSync(FAKE_ROOT)) fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
  }

  test('integrate fails when slug is missing', (t) => {
    setupMocks();
    mock.method(missionUtils, 'inferSlug', () => null);
    const integrate = loadIntegrate();
    const originalError = console.error;
    let errorLogged = false;
    console.error = () => { errorLogged = true; };

    integrate([]);
    assert.ok(errorLogged);

    console.error = originalError;
    cleanup();
  });

  test('integrate preflight failure stops execution', async (t) => {
    setupMocks();
    mock.method(git, 'getCurrentBranch', () => 'wrong-branch');
    const integrate = loadIntegrate();
    const originalError = console.error;
    let errorLogged = false;
    console.error = (msg) => { if (msg && msg.includes('Integration preflight failed')) errorLogged = true; };

    try {
      await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
    } catch {
      // Expected to throw
    }
    assert.ok(errorLogged);

    console.error = originalError;
    cleanup();
  });

  test('integrate dry-run mode', async (t) => {
    setupMocks();
    const integrate = loadIntegrate();
    const originalLog = console.log;
    let logLogged = false;
    console.log = (msg) => { if (msg && msg.includes('Dry run complete')) logLogged = true; };

    try {
      await integrate([TEST_SLUG, '--dry-run', '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
    } catch {
      // Expected to throw
    }
    assert.ok(logLogged);

    console.log = originalLog;
    cleanup();
  });

  test('resolveConflictsForMission - worktree missing', (t) => {
    setupMocks();
    const integrate = loadIntegrate();
    if (fs.existsSync(WORKTREE)) fs.rmSync(WORKTREE, { recursive: true, force: true });
    const originalError = console.error;
    let errorLogged = false;
    console.error = (msg) => { if (msg && msg.includes('Mission worktree not found')) errorLogged = true; };

    const result = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
      resolveWorktreeFn: () => null,
      rootDir: FAKE_ROOT
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'worktree-missing');
    assert.ok(errorLogged);

    console.error = originalError;
    cleanup();
  });

  test('resolveConflictsForMission - merge check failed', (t) => {
    setupMocks();
    const integrate = loadIntegrate();
    const wt = WORKTREE;
    if (!fs.existsSync(wt)) fs.mkdirSync(wt, { recursive: true });

    const result = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
      resolveWorktreeFn: () => wt,
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      getConflictFilesFn: () => { throw new Error('git error'); },
      rootDir: FAKE_ROOT
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'merge-failed');

    fs.rmSync(wt, { recursive: true, force: true });
    cleanup();
  });

  test('resolveConflictsForMission - shared vs mission-specific classification', (t) => {
    setupMocks();
    const integrate = loadIntegrate();
    const wt = WORKTREE;
    if (!fs.existsSync(wt)) fs.mkdirSync(wt, { recursive: true });

    // Case 1: Shared file conflict
    const res1 = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
      resolveWorktreeFn: () => wt,
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      getConflictFilesFn: () => ['workflow/lib/commands/integrate.js'],
      rootDir: FAKE_ROOT
    });
    assert.strictEqual(res1.ok, false);
    assert.strictEqual(res1.error, 'shared-file-conflicts');

    // Case 2: Mission-specific conflict
    const res2 = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
      resolveWorktreeFn: () => wt,
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      getConflictFilesFn: () => [`docs/missions/2026/${TEST_SLUG}/CP-1.md`],
      rootDir: FAKE_ROOT
    });
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.missionSpecificFiles.length, 1);

    fs.rmSync(wt, { recursive: true, force: true });
    cleanup();
  });

  // TASK-2457 F9: the fail-closed merge guard added in round 2 is the guard that
  // protects every future merge. Stub runPhaseGates to report an empty
  // (skipped) gate list — the exact shape an unconfigured or self-edited branch
  // produces — and assert integrate exits non-zero without merging. This is the
  // sibling of the gate-failure test above; it takes the result.skipped branch
  // that neither the failing-gate test nor the repro tests exercise.
  test('integrate fails closed when no pre-integration gates are configured', async (t) => {
    setupMocks();
    const checkout = registeredMkdtemp('px-integ-empty-');
    try {
      fs.writeFileSync(
        path.join(checkout, 'workflow.config.json'),
        JSON.stringify({ adapters: { gates: { requirePreIntegration: true } } }),
      );
      mock.method(missionUtils, 'resolveWorktree', () => checkout);
      mock.method(git, 'git', (args) => {
        const cmd = Array.isArray(args) ? args.join(' ') : String(args);
        if (cmd.includes('status')) return { status: 0, stdout: '', stderr: '' };
        if (cmd.includes('rev-parse')) return { status: 0, stdout: 'abc123', stderr: '' };
        // F1 confirms the rebase completed by reading `rebase --show-current` (empty
        // when no rebase is in progress) then rev-parse + `--is-ancestor`.
        if (cmd.includes('rebase')) return { status: 0, stdout: '', stderr: '' };
        return { status: 0, stdout: 'main', stderr: '' };
      });
      mock.method(repositoryGatesModule, 'runPhaseGates', async (phase, opts) => {
        assert.equal(phase, 'integration');
        assert.equal(opts.checkoutPath, checkout);
        return { ok: true, phase, executed: 0, skipped: true, failedGate: null, error: null };
      });

      const integrate = loadIntegrate();
      let errorLogged = false;
      const originalError = console.error;
      console.error = (msg) => { if (msg && msg.includes('Integration gates are mandatory')) errorLogged = true; };

      let result = null;
      try {
        result = await integrate([TEST_SLUG], { missionServicesFn: composition.createMissionApplicationServices, exitFn: () => {} });
      } catch {
        // gate abort surfaces as a non-zero exit code, not a throw
      } finally {
        console.error = originalError;
      }

      assert.ok(errorLogged, 'mandatory-gate failure must be logged');
      assert.ok(result && result.exitCode === 1, 'empty preIntegration list must fail closed before the merge');
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
      cleanup();
    }
  });

  // task-2457 F11 mirror: an unconfigured repository (no adapters.gates,
  // requirePreIntegration unset) completes the integration path with no
  // lifecycle gate and does NOT fail closed. This is the behaviour the mission's
  // first success criterion guarantees; the F9 test above is the opt-in opposite.
  test('integrate proceeds without a gate when the repository does not opt into requirePreIntegration', async (t) => {
    setupMocks();
    const checkout = registeredMkdtemp('px-integ-uncfg-');
    try {
      fs.writeFileSync(
        path.join(checkout, 'workflow.config.json'),
        JSON.stringify({ adapters: { gates: {} } }),
      );
      mock.method(integrateGatesModule, 'resolveIntegrationVerificationWorktree', () => checkout);
      mock.method(missionUtils, 'resolveWorktree', () => checkout);
      mock.method(git, 'git', (args) => {
        const cmd = Array.isArray(args) ? args.join(' ') : String(args);
        if (cmd.includes('status')) return { status: 0, stdout: '', stderr: '' };
        if (cmd.includes('rev-parse')) return { status: 0, stdout: 'abc123', stderr: '' };
        if (cmd.includes('rebase')) return { status: 0, stdout: '', stderr: '' };
        return { status: 0, stdout: 'main', stderr: '' };
      });
      mock.method(repositoryGatesModule, 'runPhaseGates', async (phase, opts) => {
        return { ok: true, phase, executed: 0, skipped: true, failedGate: null, error: null };
      });

      const integrate = loadIntegrate();
      let mandatoryLogged = false;
      let proceedingLogged = false;
      const originalError = console.error;
      const originalLog = console.log;
      console.error = (msg) => { if (msg && msg.includes('Integration gates are mandatory')) mandatoryLogged = true; };
      console.log = (msg) => { if (msg && msg.includes('proceeding without a lifecycle gate')) proceedingLogged = true; };

      try {
        await integrate([TEST_SLUG], { missionServicesFn: composition.createMissionApplicationServices, exitFn: () => {} });
      } catch {
        // The unconfigured consumer proceeds past the gate block; whatever the
        // downstream mock surface does, it must never be the mandatory abort.
      } finally {
        console.error = originalError;
        console.log = originalLog;
      }

      assert.ok(!mandatoryLogged, 'an unconfigured repository must not trigger the mandatory-gate abort');
      assert.ok(proceedingLogged, 'an unconfigured repository must proceed without a lifecycle gate');
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
      cleanup();
    }
  });

  // TASK-2457 wiring: a failing pre-integration gate aborts integrate before the
  // merge. The runner is observed through the facade so we assert the phase and
  // checkout it ran from; the real merge never happens.
  test('integrate aborts before merge when a pre-integration gate fails', async (t) => {
    setupMocks();
    const checkout = registeredMkdtemp('px-integ-gate-');
    try {
      fs.writeFileSync(
        path.join(checkout, 'workflow.config.json'),
        JSON.stringify({ adapters: { gates: { preIntegration: [{ key: 'smoke', command: 'exit 1', order: 0 }] } } }),
      );
      mock.method(integrateGatesModule, 'resolveIntegrationVerificationWorktree', () => checkout);
      mock.method(missionUtils, 'resolveWorktree', () => checkout);
      // captureFinalIntegrationTree needs a clean, finalized tree to proceed.
      mock.method(git, 'git', (args) => {
        const cmd = Array.isArray(args) ? args.join(' ') : String(args);
        if (cmd.includes('status')) return { status: 0, stdout: '', stderr: '' };
        if (cmd.includes('rev-parse')) return { status: 0, stdout: 'abc123', stderr: '' };
        if (cmd.includes('rebase')) return { status: 0, stdout: '', stderr: '' };
        return { status: 0, stdout: 'main', stderr: '' };
      });
      let seenPhase = null;
      let seenCheckout = null;
      mock.method(repositoryGatesModule, 'runPhaseGates', async (phase, opts) => {
        seenPhase = phase;
        seenCheckout = opts.checkoutPath;
        return { ok: false, phase, executed: 1, skipped: false, failedGate: { key: 'smoke', command: 'exit 1', exitCode: 1, stdout: '', stderr: 'fail' }, error: 'pre-integration gate failed' };
      });

      const integrate = loadIntegrate();
      let result = null;
      let routed = false;
      const mergeCalls: string[] = [];
      const gitRunner = git.git;
      mock.method(git, 'git', (args) => {
        if (args[0] === 'merge') mergeCalls.push(args.join(' '));
        return gitRunner(args);
      });
      try {
        result = await integrate([TEST_SLUG], {
          missionServicesFn: composition.createMissionApplicationServices,
          exitFn: () => {},
          // Rebound persistence and agent launch are external boundaries. Their
          // routing has its own tests; this test verifies the merge guard wiring.
          routeIntegrationGateFailureFn: async (options) => {
            routed = true;
            assert.equal(options.slug, TEST_SLUG);
            assert.equal(options.missionWorktree, checkout);
            assert.equal(options.failedGate?.key, 'smoke');
            return { route: 'exhausted', rebounds: 1, diagnostic: 'pre-integration gate failed' };
          },
        });
      } catch {
        // integrate() converts a gate abort into a non-zero exit code, not a throw.
      }
      assert.ok(result && result.exitCode === 1, 'integration aborts when the pre-integration gate fails');
      assert.equal(seenPhase, 'integration');
      assert.equal(seenCheckout, checkout);
      assert.ok(routed, 'the failed gate must reach the rebound handler');
      assert.deepEqual(mergeCalls, [], 'a failed rebound must stop before any merge');
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
      cleanup();
    }
  });

  test('buildConflictResolutionPrompt returns formatted array', (t) => {
    setupMocks();
    const integrate = loadIntegrate();
    const prompt = integrate.buildConflictResolutionPrompt(TEST_SLUG, 'docs', {
      rootDir: FAKE_ROOT,
      worktreePath: WORKTREE
    });
    assert.ok(Array.isArray(prompt));
    assert.ok(prompt.some(line => line.includes('Conflict resolution options')));
    cleanup();
  });
});

// ---- task-2243 probe abort without promotion (consolidated from test/task-2243-probe-abort-promotion.test.ts, TASK-2622.09) ----
describe("probe abort without promotion", () => {
  // Module dependencies are replaced with mock.method() through the ESM-native
  // seam in testS2/lib/module-mock.ts: an ESM namespace object is read-only, so the
  // helper registers a mutable delegating facade per module URL instead.
  const git = mockModule<typeof import('../../../../../src/adapters/git/git.js')>('../../../../../src/adapters/git/git.js', import.meta.url);
  const missionUtils = mockModule<typeof import('../../../../../src/adapters/filesystem/mission-utils.js')>('../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const backlog = mockModule<typeof import('../../../../../src/adapters/backlog/backlog.js')>('../../../../../src/adapters/backlog/backlog.js', import.meta.url);
  const forgejo = mockModule<typeof import('../../../../../src/adapters/forgejo/forgejo.js')>('../../../../../src/adapters/forgejo/forgejo.js', import.meta.url);
  const stats = mockModule<typeof import('../../../../../src/adapters/cli/commands/stats.js')>('../../../../../src/adapters/cli/commands/stats.js', import.meta.url);
  const composition = mockModule<typeof import('../../../../../src/composition/application-services.js')>('../../../../../src/composition/application-services.js', import.meta.url);
  const integrateModule = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate.js')>('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);

  const TEST_SLUG = 'task-2243-probe-abort';

  // The mock facade re-links integrate against the mocked dependencies once, so
  // there is no per-call reload; the command entry point is the default export.
  function loadIntegrate() {
    return integrateModule.default;
  }

  testS2('Variant B rejects a failed probe abort without promoting the review-approved task fixture (task-2243)', async () => {
    const root = registeredMkdtemp('task-2243-probe-abort-');
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2243 fixture.md');
    const fixture = [
      '---',
      'id: TASK-2243-FIXTURE',
      'status: review',
      'assignee: [codex]',
      'labels: [ai_sdlc]',
      '---',
      '',
      '# Probe abort fixture',
      '',
    ].join('\n');
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, fixture, 'utf8');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/parallix' } },
    }), 'utf8');

    const errors: string[] = [];
    const exitCodes: number[] = [];
    const originalError = console.error;
    console.error = (message: unknown) => errors.push(String(message));

    try {
      mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
      mock.method(missionUtils, 'inferSlug', (slug: string) => slug || TEST_SLUG);
      mock.method(missionUtils, 'findMissionDir', () => path.join(root, 'missions', TEST_SLUG));
      mock.method(missionUtils, 'findMissionArea', () => 'runtime');
      mock.method(missionUtils, 'getPrimaryWorktree', () => root);
      mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(root, '..', TEST_SLUG));
      mock.method(missionUtils, 'resolveMainRepo', () => root);
      mock.method(missionUtils, 'missionTitle', () => 'Task 2243 probe abort fixture');
      mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
      mock.method(git, 'getCurrentBranch', () => `mission/${TEST_SLUG}`);
      mock.method(git, 'git', (args: string[]) => {
        if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
        if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
        if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
        if (args.includes('merge') && args.includes('--no-commit')) return { status: 0, stdout: '', stderr: '' };
        if (args.includes('merge') && args.includes('--abort')) return { status: 1, stdout: '', stderr: 'fatal: abort failed' };
        if (args.includes('rev-parse')) return { status: 0, stdout: 'deadbeef', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      });
      mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
      mock.method(backlog, 'getTaskStatus', () => 'review');
      mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
      mock.method(backlog, 'getTaskAssignee', () => 'codex');
      mock.method(backlog, 'setTaskStatus', (_taskFile: string, status: string) => {
        fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace('status: review', `status: ${status}`), 'utf8');
        return true;
      });
      mock.method(backlog, 'completeTask', () => true);
      mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 2243 }));
      mock.method(forgejo, 'listOpenPrsForSlug', () => []);
      mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
      mock.method(forgejo, 'readToken', () => 'testS2-token');
      mock.method(forgejo, 'resolveTokenFile', () => 'testS2-token-file');
      mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, ref: 'refs/remotes/origin/main', sha: 'deadbeef' }));
      mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
      mock.method(stats, 'recordIntegrationStats', () => {
        throw new Error('stats must not run after probe-abort failure');
      });
      mock.method(process, 'cwd', () => root);
      mock.method(process, 'exit', (code: number) => exitCodes.push(code));
      // The mission carries an authoritative approved Review so integrate's
      // lifecycle recovery reaches the probe-merge abort this testS2 exercises.
      mock.method(composition, 'createMissionApplicationServices', async () => ({
        store: {
          _repoId: 'default',
          load: async () => ({ kind: 'found', mission: { status: 'review', review: { rounds: [{ decision: { kind: 'approved', decidedAt: '2026-01-01T10:30:00Z' } }] } }, version: 1 }),
        },
        lifecycle: {
          transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }),
        },
        handoff: {
          recordNel: async () => ({}),
        },
      }));

      const integrate = loadIntegrate();
      await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });

      assert.deepEqual(exitCodes, [1], 'integration must reject the unsafe checkout with a nonzero result');
      assert.ok(errors.some((message) => message.includes('Dry-run merge could not be aborted cleanly')));
      assert.equal(fs.readFileSync(taskFile, 'utf8'), fixture, 'probe-abort failure must not mutate the review task fixture');
    } finally {
      console.error = originalError;
      mock.reset();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---- task-2520 resume landing closeout (consolidated from test/task-2520-resume-landing.test.ts, TASK-2622.09) ----
describe("resume landing closeout", () => {
  // TASK-2520 SC5 / AC6: a retry after a failed sync-merged has the mission squash
  // already on the local base. `px integrate` must skip the integration rebase and
  // resume the landing closeout (finishLanding / sync-merged) instead of replaying
  // mission history. Hermetic: git, backlog, forgejo, stats, verification,
  // mission services and the integrate-conflict checkout seam are all injected
  // doubles, so no worktree, real Forgejo, or agent is touched.

  const git = mockModule<typeof import('../../../../../src/adapters/git/git.js')>('../../../../../src/adapters/git/git.js', import.meta.url);
  const missionUtils = mockModule<typeof import('../../../../../src/adapters/filesystem/mission-utils.js')>('../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const backlog = mockModule<typeof import('../../../../../src/adapters/backlog/backlog.js')>('../../../../../src/adapters/backlog/backlog.js', import.meta.url);
  const forgejo = mockModule<typeof import('../../../../../src/adapters/forgejo/forgejo.js')>('../../../../../src/adapters/forgejo/forgejo.js', import.meta.url);
  const stats = mockModule<typeof import('../../../../../src/adapters/cli/commands/stats.js')>('../../../../../src/adapters/cli/commands/stats.js', import.meta.url);
  const verification = mockModule<typeof import('../../../../../src/adapters/verification/verification.js')>('../../../../../src/adapters/verification/verification.js', import.meta.url);
  const composition = mockModule<typeof import('../../../../../src/composition/application-services.js')>('../../../../../src/composition/application-services.js', import.meta.url);
  const conflict = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate-conflict.js')>('../../../../../src/adapters/cli/commands/integrate-conflict.js', import.meta.url);
  const integrateModule = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate.js')>('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);

  const integrate = integrateModule.default;

  const SLUG = 'task-2520-resume';
  const BRANCH = `mission/${SLUG}`;
  const SQUASH_SHA = 'landedsquashsha000';
  const ROOT = registeredMkdtemp('parallix-task-2520-');

  test('retry after failed sync-merged skips rebase and resumes landing closeout', async () => {
    const logs: string[] = [];
    mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
    mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });

    let rebaseStarted = false;
    let syncMergedCalls: { branch: string, commit: string }[] = [];

    // The base already holds the mission squash from a prior partial integration.
    mock.method(conflict, 'findLandedSquashOnBaseBranch', () => SQUASH_SHA);
    mock.method(forgejo, 'syncMerged', (branch: string, commit: string) => {
      syncMergedCalls.push({ branch, commit });
      return { ok: true };
    });

    mock.method(git, 'getCurrentBranch', () => BRANCH);
    mock.method(git, 'git', (args: string[]) => {
      const joined = args.join(' ');
      // A real rebase subcommand must never run on the retry.
      if (args.includes('rebase') && !args.includes('--show-current') && !args.includes('--continue')) {
        rebaseStarted = true;
      }
      if (joined.includes('rev-parse') && joined.includes('main')) { return { status: 0, stdout: 'basesha', stderr: '' }; }
      if (joined.includes('rev-parse')) { return { status: 0, stdout: BRANCH, stderr: '' }; }
      if (joined.includes('merge-base') && joined.includes('--is-ancestor')) { return { status: 0, stdout: '', stderr: '' }; }
      // The resume closeout resolves the landed squash commit timestamp via `show`.
      if (joined.includes('show') && joined.includes('--format')) { return { status: 0, stdout: '2026-09-15T12:00:00+00:00', stderr: '' }; }
      if (joined.includes('branch')) { return { status: 0, stdout: 'main\n', stderr: '' }; }
      return { status: 0, stdout: '', stderr: '' };
    });

    let status = 'integration';
    mock.method(missionUtils, 'inferSlug', () => SLUG);
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
    mock.method(missionUtils, 'getPrimaryWorktree', () => ROOT);
    mock.method(missionUtils, 'findMissionDir', () => path.join(ROOT, 'missions', SLUG));
    mock.method(missionUtils, 'findMissionArea', () => 'all');
    mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(ROOT, '..', SLUG));
    mock.method(missionUtils, 'resolveMainRepo', () => ROOT);
    mock.method(missionUtils, 'missionTitle', () => 'fixture');
    mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
    mock.method(missionUtils, 'resolveMissionBaseBranch', () => 'main');
    mock.method(missionUtils, 'resolveWorktree', () => ROOT);
    mock.method(missionUtils, 'missionBranchName', (_slug: string) => BRANCH);

    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(ROOT, 'backlog', 'tasks', 'task.md') }));
    mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
    mock.method(backlog, 'getTaskStatus', () => 'integration');
    mock.method(backlog, 'getTaskAssignee', () => 'codex');
    mock.method(backlog, 'getTaskImplementer', () => 'codex');
    mock.method(backlog, 'completeTask', () => true);

    mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 1 }));
    mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
    mock.method(forgejo, 'listOpenPrsForSlug', () => []);
    mock.method(forgejo, 'readToken', () => 'token');
    mock.method(forgejo, 'resolveTokenFile', () => 'token-file');

    mock.method(stats, 'recordIntegrationStats', async () => ({ changed: false, row: { mission: SLUG }, data: { rows: [] }, report: 'none' }));
    mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
    mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true, proof: { rootDir: ROOT, area: 'all', command: 'verify', commit: SQUASH_SHA, tree: 'tree' } }));
    mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true }));
    mock.method(process, 'cwd', () => ROOT);
    mock.method(process, 'exit', () => {});

    mock.method(composition, 'createMissionApplicationServices', async () => ({
      store: { _repoId: 'default', load: async () => ({ kind: 'found', mission: { status, review: null }, version: 1 }) },
      integration: { decideIntegration: async () => { status = 'done'; return { status: 'completed', value: { mission: { status }, version: 2 } }; } },
      lifecycle: { transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }) },
      handoff: { recordNel: async () => ({ }) },
    }));

    fs.mkdirSync(path.join(ROOT, 'backlog', 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'workflow.config.json'), JSON.stringify({
      adapters: { review: { provider: 'forgejo' }, verification: { command: 'true' }, gates: { preIntegration: [] } },
    }));

    try {
      await integrate([SLUG], { missionServicesFn: composition.createMissionApplicationServices });

      // The integration rebase must be skipped: the squash is already on the base.
      assert.equal(rebaseStarted, false, 'px integrate must not rebase when the mission squash is already on the local base');
      // The landing closeout resumes against the existing squash commit.
      assert.ok(syncMergedCalls.length >= 1, 'sync-merged resume must run against the landed squash');
      assert.equal(syncMergedCalls[0].commit, SQUASH_SHA, 'resumes with the existing squash commit, not a fresh squash');
      assert.match(logs.join('\n'), /already on .*; skipping rebase/, 'reports skipping the rebase');
    } finally {
      mock.reset();
      fs.rmSync(ROOT, { recursive: true, force: true });
    }
  });
});

// ---- task-2506 behind-primary integrate (consolidated from test/task-2506-integrate-rebase.test.ts, TASK-2622.09) ----
describe("behind-primary integrate", () => {
  // TASK-2506 regression: `px integrate` must rebase the mission onto its
  // primary/parent branch before the probe merge and gates. Before the fix the
  // probe merge dead-ends with "Rebase the mission branch before integrating";
  // after the fix the shared rebase workflow runs first, the probe merge is
  // clean, and the mission lands. Hermetic: git, backlog, forgejo, stats,
  // verification and mission services are all injected doubles, so no worktree,
  // real Forgejo, or agent is touched.

  const git = mockModule<typeof import('../../../../../src/adapters/git/git.js')>('../../../../../src/adapters/git/git.js', import.meta.url);
  const missionUtils = mockModule<typeof import('../../../../../src/adapters/filesystem/mission-utils.js')>('../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const backlog = mockModule<typeof import('../../../../../src/adapters/backlog/backlog.js')>('../../../../../src/adapters/backlog/backlog.js', import.meta.url);
  const forgejo = mockModule<typeof import('../../../../../src/adapters/forgejo/forgejo.js')>('../../../../../src/adapters/forgejo/forgejo.js', import.meta.url);
  const stats = mockModule<typeof import('../../../../../src/adapters/cli/commands/stats.js')>('../../../../../src/adapters/cli/commands/stats.js', import.meta.url);
  const verification = mockModule<typeof import('../../../../../src/adapters/verification/verification.js')>('../../../../../src/adapters/verification/verification.js', import.meta.url);
  const composition = mockModule<typeof import('../../../../../src/composition/application-services.js')>('../../../../../src/composition/application-services.js', import.meta.url);
  const integrateModule = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate.js')>('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);
  const repositoryGates = mockModule<typeof import('../../../../../src/adapters/config/repository-gates.js')>('../../../../../src/adapters/config/repository-gates.js', import.meta.url);

  const integrate = integrateModule.default;

  const SLUG = 'task-2506-intreg';
  const BRANCH = `mission/${SLUG}`;
  const ROOT = registeredMkdtemp('parallix-task-2506-');

  /**
   * Stateful git double: the probe merge conflicts only until the integration
   * rebase has run, so the test is red before the fix (probe merge dead-ends)
   * and green after (rebase clears the conflict, probe merge is clean). The
   * rebase subcommand is matched as an exact arg element so the slug is never
   * confused with a rebase invocation.
   */
  function installGitDoubles(rebased: { value: boolean }, unreadableApproval = false) {
    mock.method(git, 'getCurrentBranch', () => `mission/${SLUG}`);
    mock.method(git, 'git', (args: string[]) => {
      if (unreadableApproval && args.includes('cat-file')) { return { status: 1, stdout: '', stderr: 'missing approved commit' }; }
      if (args.includes('rebase')) {
        if (args.includes('--show-current') || args.includes('--continue')) { return { status: 0, stdout: '', stderr: '' }; }
        rebased.value = true;
        return { status: 0, stdout: '', stderr: '' };
      }
      const joined = args.join(' ');
      if (joined.includes('merge-base') && joined.includes('--is-ancestor')) { return { status: 0, stdout: '', stderr: '' }; }
      // Plain merge-base: the primary is an ancestor of the mission after the
      // rebase, so it resolves to the same sha rev-parse returns.
      if (joined.includes('merge-base')) { return { status: 0, stdout: 'landed-sha', stderr: '' }; }
      if (args.includes('rev-parse')) { return { status: 0, stdout: 'landed-sha', stderr: '' }; }
      if (args.includes('show')) { return { status: 0, stdout: '2026-05-15T12:00:00+00:00', stderr: '' }; }
      if (joined.includes('merge') && joined.includes('--no-commit')) {
        return rebased.value
          ? { status: 0, stdout: '', stderr: '' }
          : { status: 1, stdout: 'CONFLICT (content): Merge conflict in src/app.ts\n', stderr: '' };
      }
      if (joined.includes('merge') && joined.includes('--abort')) {
        return rebased.value
          ? { status: 0, stdout: '', stderr: '' }
          : { status: 1, stdout: 'fatal: There is no merge to abort\n', stderr: '' };
      }
      if (joined.includes('merge') && joined.includes('--squash')) { return { status: 0, stdout: '', stderr: '' }; }
      if (joined.includes('commit')) { return { status: 0, stdout: '', stderr: '' }; }
      if (joined.includes('diff') && joined.includes('--cached')) { return { status: 0, stdout: 'src/app.ts\n', stderr: '' }; }
      if (joined.includes('...')) { return { status: 0, stdout: '', stderr: '' }; }
      if (joined.includes('symbolic-ref')) { return { status: 0, stdout: `mission/${SLUG}`, stderr: '' }; }
      if (joined.includes('ls-files')) { return { status: 0, stdout: '', stderr: '' }; }
      if (joined.includes('status')) { return { status: 0, stdout: '', stderr: '' }; }
      if (joined.includes('branch')) { return { status: 0, stdout: 'main\n', stderr: '' }; }
      return { status: 0, stdout: '', stderr: '' };
    });
  }

  /** Install every injected double shared by the task-2506 integrate tests. */
  function installHarness(review: any = null) {
    const logs: string[] = [];
    mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
    mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });

    let status = 'integration';
    mock.method(missionUtils, 'inferSlug', () => SLUG);
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
    mock.method(missionUtils, 'getPrimaryWorktree', () => ROOT);
    mock.method(missionUtils, 'findMissionDir', () => path.join(ROOT, 'missions', SLUG));
    mock.method(missionUtils, 'findMissionArea', () => 'all');
    mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(ROOT, '..', SLUG));
    mock.method(missionUtils, 'resolveMainRepo', () => ROOT);
    mock.method(missionUtils, 'missionTitle', () => 'fixture');
    mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
    // ADR 0043 target the integration rebase rebases onto.
    mock.method(missionUtils, 'resolveMissionBaseBranch', () => 'main');
    mock.method(missionUtils, 'resolveWorktree', () => ROOT);
    mock.method(missionUtils, 'missionBranchName', (_slug: string) => `mission/${SLUG}`);

    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(ROOT, 'backlog', 'tasks', 'task.md') }));
    mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
    mock.method(backlog, 'getTaskStatus', () => 'integration');
    mock.method(backlog, 'getTaskAssignee', () => 'codex');
    mock.method(backlog, 'getTaskImplementer', () => 'codex');
    mock.method(backlog, 'completeTask', () => true);

    mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 1 }));
    mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
    mock.method(forgejo, 'listOpenPrsForSlug', () => []);
    mock.method(forgejo, 'readToken', () => 'token');
    mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
    mock.method(forgejo, 'syncMerged', () => ({ ok: true }));

    mock.method(stats, 'recordIntegrationStats', async () => ({ changed: false, row: { mission: SLUG }, data: { rows: [] }, report: 'none' }));
    mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
    mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true, proof: { rootDir: ROOT, area: 'all', command: 'verify', commit: 'landed-sha', tree: 'tree' } }));
    mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true }));
    mock.method(process, 'cwd', () => ROOT);
    mock.method(process, 'exit', () => {});

    mock.method(composition, 'createMissionApplicationServices', async () => ({
      store: { _repoId: 'default', load: async () => ({ kind: 'found', mission: { status, review }, version: 1 }) },
      integration: { decideIntegration: async () => { status = 'done'; return { status: 'completed', value: { mission: { status }, version: 2 } }; } },
      lifecycle: { transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }) },
      handoff: { recordNel: async () => ({}) },
    }));

    return { logs, getStatus: () => status };
  }

  test('behind-primary conflict-free mission integrates without a manual rebase (task-2506)', async () => {
    const rebased = { value: false };
    installGitDoubles(rebased);

    fs.mkdirSync(path.join(ROOT, 'backlog', 'tasks'), { recursive: true });
    // A real preIntegration gate that writes a marker file when it runs. This is
    // the evidence F3 requires: the gate actually executes (not skipped via
    // --no-integration-gates) against the rebased branch, so the marker proves a
    // gate ran after the rebase and before the probe merge.
    const markerPath = path.join(ROOT, 'gate-ran.txt');
    fs.writeFileSync(path.join(ROOT, 'workflow.config.json'), JSON.stringify({
      adapters: {
        verification: { command: 'true' },
        gates: { preIntegration: [{ key: 'marker', order: 0, command: `echo ran > ${markerPath}` }] },
      },
    }));

    const { logs, getStatus } = installHarness();

    try {
      await integrate([SLUG], { missionServicesFn: composition.createMissionApplicationServices });

      // The integration rebase must have run before the probe merge.
      assert.ok(rebased.value, 'px integrate must rebase the mission onto the primary branch before the probe merge');
      // A configured preIntegration gate must have executed against the rebased
      // branch (F3): the marker only exists when the gate ran, which happens after
      // the rebase and before the probe merge in the integrate() flow.
      assert.ok(fs.existsSync(markerPath), 'a configured integration gate must run against the rebased branch');
      // The mission must land end to end: the conflict-free probe merge only
      // succeeds once the rebase has applied the primary's ahead commit.
      assert.equal(getStatus(), 'done');
    } finally {
      mock.reset();
      fs.rmSync(ROOT, { recursive: true, force: true });
    }
  });

  test('integration re-runs rebase and gates when main advances during the first gate run (TASK-2630)', async () => {
    const state = { baseAdvanced: false, rebaseRuns: 0, gateRuns: 0 };
    mock.method(git, 'getCurrentBranch', () => `mission/${SLUG}`);
    mock.method(git, 'git', (args: string[]) => {
      const joined = args.join(' ');
      if (args.includes('rebase') && !args.includes('--show-current')) { state.rebaseRuns++; return { status: 0, stdout: '', stderr: '' }; }
      if (args.includes('rebase')) { return { status: 0, stdout: '', stderr: '' }; }
      if (joined.includes('merge-base') && joined.includes('--is-ancestor')) { return { status: 0, stdout: '', stderr: '' }; }
      if (joined.includes('merge-base')) { return { status: 0, stdout: state.baseAdvanced ? 'base-before-gates' : 'base-current', stderr: '' }; }
      if (args.includes('rev-parse') && args.includes(BRANCH)) { return { status: 0, stdout: state.baseAdvanced ? 'mission-before-rerebase' : 'mission-current', stderr: '' }; }
      if (args.includes('rev-parse')) { return { status: 0, stdout: state.baseAdvanced ? 'base-after-gates' : 'base-current', stderr: '' }; }
      if (joined.includes('merge') || joined.includes('commit') || joined.includes('diff') || joined.includes('ls-files') || joined.includes('status')) { return { status: 0, stdout: '', stderr: '' }; }
      return { status: 0, stdout: 'main\n', stderr: '' };
    });
    fs.mkdirSync(path.join(ROOT, 'backlog', 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'workflow.config.json'), JSON.stringify({ adapters: { verification: { command: 'true' }, gates: { preIntegration: [{ key: 'gate', order: 0, command: 'true' }] } } }));
    const { getStatus } = installHarness();
    mock.method(repositoryGates, 'runPhaseGates', async () => {
      state.gateRuns++;
      if (state.gateRuns === 1) { state.baseAdvanced = true; }
      return { ok: true, executed: 1, skipped: false, failedGate: null, error: null } as any;
    });
    try {
      await integrate([SLUG], { missionServicesFn: composition.createMissionApplicationServices });
      assert.equal(state.rebaseRuns, 2, 'main movement after gates triggers a second rebase');
      assert.equal(state.gateRuns, 2, 'gates rerun against the rebased candidate');
      assert.equal(getStatus(), 'done');
    } finally {
      mock.reset();
      fs.rmSync(ROOT, { recursive: true, force: true });
    }
  });

  test('integration refuses an unreadable approved revision with recovery guidance (TASK-2630)', async () => {
    installGitDoubles({ value: false }, true);
    fs.mkdirSync(path.join(ROOT, 'backlog', 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'workflow.config.json'), JSON.stringify({ adapters: { verification: { command: 'true' } } }));
    const approvedReview = { rounds: [{ subject: { revision: 'missing-approved-commit' }, decision: { kind: 'approved' } }] };
    const { logs } = installHarness(approvedReview);
    try {
      const result = await integrate([SLUG], { missionServicesFn: composition.createMissionApplicationServices, exitFn: () => {} });
      assert.equal(result?.exitCode, 1, 'unreadable approval blocks before landing');
      assert.match(logs.join('\n'), /Approved revision missing-approved-commit cannot be read/);
      assert.match(logs.join('\n'), /px review task-2506-intreg --continue/);
    } finally {
      mock.reset();
      fs.rmSync(ROOT, { recursive: true, force: true });
    }
  });

  // A `git` double for the dry-run test: the primary advanced on an unrelated
  // change (merge-base != baseSha) so a rebase is required and clean (merge-tree
  // exits 0), with a benign result for every other command.
  function installDryRunGitDoubles(calls: string[][]) {
    mock.method(git, 'getCurrentBranch', () => `mission/${SLUG}`);
    mock.method(git, 'git', (args: string[]) => {
      calls.push(args.slice());
      const joined = args.join(' ');
      if (joined.includes('rev-parse') && joined.includes(BRANCH)) { return { status: 0, stdout: 'mission-sha', stderr: '' }; }
      if (joined.includes('rev-parse')) { return { status: 0, stdout: 'base-sha', stderr: '' }; }
      if (joined.includes('merge-base')) { return { status: 0, stdout: 'other-sha', stderr: '' }; }
      if (joined.includes('merge-tree')) { return { status: 0, stdout: '', stderr: '' }; }
      if (joined.includes('branch')) { return { status: 0, stdout: 'main\n', stderr: '' }; }
      return { status: 0, stdout: '', stderr: '' };
    });
  }

  test('px integrate --dry-run reports a needed rebase and mutates nothing (task-2506)', async () => {
    const calls: string[][] = [];
    installGitDoubles({ value: false });
    installDryRunGitDoubles(calls);

    fs.mkdirSync(path.join(ROOT, 'backlog', 'tasks'), { recursive: true });
    // No preIntegration gates configured: the dry run plans only and executes
    // nothing, so non-mutation is observable purely through the git calls.
    fs.writeFileSync(path.join(ROOT, 'workflow.config.json'), JSON.stringify({
      adapters: { verification: { command: 'true' } },
    }));

    const { logs } = installHarness();

    try {
      await integrate([SLUG, '--dry-run'], { missionServicesFn: composition.createMissionApplicationServices });

      // The dry-run branch must report that a rebase is required.
      assert.match(logs.join('\n'), /Rebase required/);
      // --dry-run must never start a rebase or attempt a probe merge: the shared
      // rebase workflow and the probe merge are only invoked on the live path.
      for (const args of calls) {
        assert.ok(
          !(args.includes('rebase') && !args.includes('--show-current') && !args.includes('--continue')),
          `dry-run must not start a rebase: ${args.join(' ')}`,
        );
        assert.ok(
          !(args.includes('merge') && (args.includes('--no-commit') || args.includes('--squash'))),
          `dry-run must not attempt a probe merge: ${args.join(' ')}`,
        );
      }
    } finally {
      mock.reset();
      fs.rmSync(ROOT, { recursive: true, force: true });
    }
  });
});
