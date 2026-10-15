import { agentFamily } from '../../../src/domain/agents.js';
import { changeRevision } from '../../../src/domain/review.js';
import { missionLabels, type Mission } from '../../../src/domain/mission.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { integrationServices } from '../../helpers/stub-integration-services.js';
import { integrationContext } from '../../fixtures/integration-context.js';
// Historical regression provenance: TASK-1109, TASK-2367.
// Behavior-owned suite (TASK-2622.09, integration-ci): `px integrate` Variant B landing — the full
// squash-merge path and its guards (task-1109) and the completion persistence order before statistics
// (task-2367). Legacy case names unchanged.
import { resolveConfiguration } from '../../../src/composition/config.js';
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../../../src/adapters/git/git.js', import.meta.url);
mockModule('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
mockModule('../../../src/adapters/backlog/backlog.js', import.meta.url);
mockModule('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
mockModule('../../../src/adapters/agents/runtime-matrix.js', import.meta.url);
mockModule('../../../src/adapters/cli/commands/stats.js', import.meta.url);
mockModule('../../../src/composition/application-services.js', import.meta.url);
mockModule('../../../src/adapters/verification/verification.js', import.meta.url);
mockModule('../../../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();
const { reportMergeConflicts } = await import('../../../src/application/integrate/landing.js');

// ---- task-1109 Variant B landing (consolidated from test/task-1109.test.ts, TASK-2622.09) ----
describe("Variant B landing", () => {
  const _require = createRequire(import.meta.url);
  const gitModule = mockModule<typeof import('../../../src/adapters/git/git.js')>('../../../src/adapters/git/git.js', import.meta.url);
  const missionUtilsModule = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const backlogModule = mockModule<typeof import('../../../src/adapters/backlog/backlog.js')>('../../../src/adapters/backlog/backlog.js', import.meta.url);
  const forgejoModule = mockModule<typeof import('../../../src/adapters/forgejo/forgejo.js')>('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
  const runtimeMatrixModule = mockModule<typeof import('../../../src/adapters/agents/runtime-matrix.js')>('../../../src/adapters/agents/runtime-matrix.js', import.meta.url);
  const statsModule = mockModule<typeof import('../../../src/adapters/cli/commands/stats.js')>('../../../src/adapters/cli/commands/stats.js', import.meta.url);
  const __mm1 = mockModule<typeof import('../../../src/composition/application-services.js')>('../../../src/composition/application-services.js', import.meta.url);
  const __mm2 = mockModule<typeof import('../../../src/adapters/cli/commands/integrate.js')>('../../../src/adapters/cli/commands/integrate.js', import.meta.url);

  const { mock } = test;

  const git = gitModule;
  const missionUtils = missionUtilsModule;
  const backlog = backlogModule;
  const forgejo = forgejoModule;
  const runtimeMatrix = runtimeMatrixModule;
  const stats = statsModule;
  const composition = __mm1;

  const TEST_SLUG = 'task-integrate-v2';
  const FAKE_ROOT = path.join(os.tmpdir(), `integrate-v2-root-${process.pid}`);
  let statsCalls: Parameters<typeof stats.recordIntegrationStats>[0][] = [];

  // The integrate module's command entry point is its default export; its
  // helpers are named exports. Expose both through the ESM mock facade so the
  // existing call sites (`integrate([...])` and `integrate.resolveConflicts...`)
  // keep working without a writable CommonJS `exports` object.
  function loadIntegrate() {
    return Object.assign((...args: Parameters<typeof __mm2.default>) => __mm2.default(...args), __mm2);
  }
  // TASK-2479: preflight success-path detail (approval/variant lines) is demoted
  // to DEBUG so the default happy path stays concise. The checks are unchanged —
  // failures still print and still block — so these regression locks ask for the
  // detail explicitly to keep coverage of the resolved value.
  async function withDebug<T>(fn: () => T | Promise<T>): Promise<T> {
    const previous = process.env.DEBUG;
    process.env.DEBUG = '1';
    try {
      return await fn();
    } finally {
      if (previous === undefined) { delete process.env.DEBUG; } else { process.env.DEBUG = previous; }
    }
  }

  function setupMocks() {
    statsCalls = [];
    // TASK-2322.12: Allow --no-integration-gates in tests
    process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS = '1';
    mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
    mock.method(missionUtils, 'inferSlug', (s: Parameters<(typeof missionUtils)["inferSlug"]>[0]) => s || TEST_SLUG);
    mock.method(missionUtils, 'findMissionDir', () => path.join(FAKE_ROOT, 'docs/missions/2026', TEST_SLUG));
    mock.method(missionUtils, 'findMissionArea', () => 'docs');
    mock.method(missionUtils, 'getPrimaryWorktree', () => FAKE_ROOT);
    mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(FAKE_ROOT, '..', TEST_SLUG));
    mock.method(missionUtils, 'resolveMainRepo', () => FAKE_ROOT);
    mock.method(missionUtils, 'missionTitle', () => 'Test Mission');
    mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
    mock.method(git, 'getCurrentBranch', () => 'mission/' + TEST_SLUG);
    mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('branch') && args.includes('--show-current')) return { signal: null,  status: 0, stdout: 'main', stderr: '' };
      if (args.includes('status')) return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('merge')) return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('rev-parse')) return { signal: null,  status: 0, stdout: 'deadbeef', stderr: '' };
      if (args.includes('show')) return { signal: null,  status: 0, stdout: '2026-05-15T12:00:00+02:00\n', stderr: '' };
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    });
    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: path.join(FAKE_ROOT, 'backlog/tasks/task.md') }));
    mock.method(backlog, 'getTaskStatus', () => 'approved');
    mock.method(backlog, 'getTaskAssignee', () => 'claude');
    mock.method(backlog, 'setTaskStatus', () => true);
    mock.method(backlog, 'completeTask', () => true);
    mock.method(forgejo, 'getPrStatus', () => ({ exists: true as const, state: 'open', merged: false, number: 41 }));
    mock.method(forgejo, 'listOpenPrsForSlug', () => []);
    mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true as const, reviewState: 'APPROVED' }));
    mock.method(forgejo, 'readToken', () => 'token');
    mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
    mock.method(forgejo, 'syncMerged', () => ({ ok: true as const }));
    mock.method(stats, 'recordIntegrationStats', (args: Parameters<(typeof stats)["recordIntegrationStats"]>[0]) => {
      statsCalls.push(args);
      return Promise.resolve({
        changed: false,
        row: { mission: TEST_SLUG },
        data: { rows: [] },
        report: 'Current week (2026-05-12 → 2026-05-18)\nnone',
      });
    });
    mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
    mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true as const, ref: 'refs/remotes/origin/main', sha: 'deadbeef' }));
    mock.method(process, 'cwd', () => FAKE_ROOT);
    mock.method(process, 'exit', () => {});

    // SC3: Mock createMissionApplicationServices for SQLite-first transitions.
    // The store is a shared mutable object; the lifecycle transition persists the
    // lane to `integration` (the real MissionLifecycleService.transition commits
    // the lane change to the store via save/saveWithTransition), so the landing-
    // boundary SC2 guard observes the post-restore `integration` lane, not the
    // pre-restore `review` lane. A mock that never persisted would leave the
    // store at `review` and contradict the production restore that precedes
    // finishLanding.
    let storedMission: Mission = fixtureMission(TEST_SLUG, {
      labels: missionLabels(['ai_sdlc']),
      status: 'review', closedAt: null, assignee: agentFamily('claude'), review: {
        rounds: [{
          number: 1,
          subject: { change: { kind: 'local-branch', sourceBranch: `mission/${TEST_SLUG}`, targetBranch: 'main' }, revision: changeRevision('fixture') },
          reviewer: agentFamily('codex'), implementer: agentFamily('claude'), startedAt: '2026-05-15T10:00:00Z',
          decision: { kind: 'approved', decidedAt: '2026-05-15T10:30:00Z', comment: null, source: { kind: 'local' } },
          response: null, phase: 'approved', disposition: 'APPROVED', reviewerRetryCount: 0, implementerRetryCount: 0,
        }], intervention: null, stageLaunches: [], reviewEvents: [],
      },
    });
    mock.method(composition, 'createMissionApplicationServices', async () => ({
      store: {
        _repoId: 'default',
        load: async () => ({ kind: 'found' as const, mission: storedMission, version: 1 }),
      },
     lifecycle: {
       transition: async () => {
         storedMission = { ...storedMission, status: 'integration', closedAt: null };
         return { durableEvidence: [],  status: 'completed' as const, value: { to: 'integration', version: 2 } };
       },
      },
      integration: {
        decideIntegration: async () => {
          storedMission = { ...storedMission, status: 'done' };
          return { durableEvidence: [],  status: 'completed' as const };
        },
        close: async () => {
          storedMission = { ...storedMission, status: 'done', closedAt: '2026-05-15T12:00:00.000Z' };
          return { durableEvidence: [],  status: 'completed' as const };
        },
      },
      handoff: {
        recordNel: async () => ({}),
      },
    }));

    if (!fs.existsSync(FAKE_ROOT)) fs.mkdirSync(FAKE_ROOT, { recursive: true });
    fs.writeFileSync(path.join(FAKE_ROOT, 'workflow.config.json'), JSON.stringify({
      adapters: { review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/visualboard' }, verification: { command: 'true' } },
    }), 'utf8');
  }

  function cleanup() {
    mock.reset();
    if (fs.existsSync(FAKE_ROOT)) fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
  }

  test('integrate full squash-merge (Variant B) success path', async (t) => {
    setupMocks();
    const integrate = loadIntegrate();
    const originalLog = console.log;
    const logs: unknown[] = [];
    console.log = (msg: unknown) => logs.push(msg);
    // TASK-2479: the variant-selection progress line is demoted to DEBUG so the
    // default happy path stays concise. Ask for it explicitly here so this
    // regression lock still verifies the Variant B squash-merge path runs and
    // still records stats exactly once.
    const previousDebug = process.env.DEBUG;
    process.env.DEBUG = '1';

    try {
      await integrate([TEST_SLUG, '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: composition.createMissionApplicationServices });
    } catch { /* expected */ }

    assert.ok(logs.every((message): message is string => typeof message === 'string'));
    assert.ok(logs.some(l => l.includes('Selecting integration variant: Variant B')));
    assert.ok(logs.every((message): message is string => typeof message === 'string'));
    assert.ok(logs.some(l => l.includes('integrated into')));
    assert.equal(statsCalls.length, 1);

    console.log = originalLog;
    if (previousDebug === undefined) delete process.env.DEBUG; else process.env.DEBUG = previousDebug;
    cleanup();
  });

  test('integrate Variant B promotes and completes a review-approved task in the landed closeout', async () => {
    setupMocks();
    const taskFile = path.join(FAKE_ROOT, 'backlog/tasks/task.md');
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, '---\nstatus: review\n---\n', 'utf8');
    const events: string[] = [];
    mock.method(backlog, 'getTaskStatus', () => 'review');
    mock.method(backlog, 'setTaskStatus', () => {
      events.push('promote');
      return true;
    });
    mock.method(backlog, 'completeTask', () => {
      events.push('complete');
      return true;
    });
    mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('branch') && args.includes('--show-current')) return { signal: null,  status: 0, stdout: 'main', stderr: '' };
      if (args.includes('status')) return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('merge') && args.includes('--abort')) {
        events.push('abort');
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      if (args.includes('merge') && args.includes('--squash')) {
        events.push('squash');
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      if (args.includes('commit')) {
        events.push('commit');
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      if (args.includes('merge')) return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('rev-parse')) return { signal: null,  status: 0, stdout: 'deadbeef', stderr: '' };
      if (args.includes('show')) return { signal: null,  status: 0, stdout: '2026-05-15T12:00:00+02:00\n', stderr: '' };
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    });
    const integrate = loadIntegrate();

    try {
      await integrate([TEST_SLUG, '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: composition.createMissionApplicationServices });
    } catch { /* expected */ }

    assert.deepEqual(events, ['abort', 'squash', 'promote', 'complete', 'commit']);
    cleanup();
  });

  test('integrate Variant B preserves soft-reset backlog noise across squash merge', async () => {
    setupMocks();
    const gitCalls: string[] = [];
    mock.method(missionUtils, 'softResetTrailingBacklogNoise', () => true);
    mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
      gitCalls.push(args.join(' '));
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('branch') && args.includes('--show-current')) return { signal: null,  status: 0, stdout: 'main', stderr: '' };
      if (args.includes('status')) return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('diff') && args.includes('--cached') && args.includes('--binary')) {
        return { signal: null,  status: 0, stdout: 'diff --git a/backlog/tasks/task.md b/backlog/tasks/task.md\n', stderr: '' };
      }
      if (args.includes('reset') && args.includes('--hard')) return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('merge')) return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('apply') && args.includes('--index')) return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('rev-parse')) return { signal: null,  status: 0, stdout: 'deadbeef', stderr: '' };
      if (args.includes('show')) return { signal: null,  status: 0, stdout: '2026-05-15T12:00:00+02:00\n', stderr: '' };
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    });
    const integrate = loadIntegrate();

    try {
      await integrate([TEST_SLUG, '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: composition.createMissionApplicationServices });
    } catch { /* expected */ }

    const diffIndex = gitCalls.findIndex(call => call.includes('diff --cached --binary'));
    const resetIndex = gitCalls.findIndex(call => call.includes('reset --hard HEAD'));
    const squashIndex = gitCalls.findIndex(call => call.includes('merge --squash'));
    const applyIndex = gitCalls.findIndex(call => call.includes('apply --index'));

    assert.ok(diffIndex !== -1, 'expected staged backlog-noise patch capture');
    assert.ok(resetIndex !== -1, 'expected clean reset after capturing backlog-noise patch');
    assert.ok(squashIndex !== -1, 'expected squash merge to run');
    assert.ok(applyIndex !== -1, 'expected backlog-noise patch restore');
    assert.ok(diffIndex < resetIndex && resetIndex < squashIndex && squashIndex < applyIndex);

    cleanup();
  });

  test('integrate resolves PR and approval using the task assignee Forgejo identity', async () => {
    setupMocks();
    const previousUser = process.env.FORGEJO_USER;
    const previousAgent = process.env.WORKFLOW_AGENT;
    process.env.FORGEJO_USER = 'claude'; // authorized
    delete process.env.WORKFLOW_AGENT;

    const captured: Record<'prForgejoUser' | 'approvalForgejoUser', string | null> = { prForgejoUser: null, approvalForgejoUser: null };
    mock.method(backlog, 'getTaskAssignee', () => 'gemini');
    mock.method(forgejo, 'getPrStatus', (_branch: Parameters<(typeof forgejo)["getPrStatus"]>[0], _rootDir: Parameters<(typeof forgejo)["getPrStatus"]>[1], options: Parameters<(typeof forgejo)["getPrStatus"]>[2] = {}) => {
      captured.prForgejoUser = options.forgejoUser || null;
      if (options.forgejoUser !== 'gemini') {
        return { exists: false as const, error: 'api-failed', raw: 'failed to resolve PR for mission/task-integrate-v2' };
      }
      return { exists: true as const, state: 'open', merged: false, number: 41 };
    });
    mock.method(forgejo, 'getLatestReviewDecision', (_branch: Parameters<(typeof forgejo)["getLatestReviewDecision"]>[0], options: Parameters<(typeof forgejo)["getLatestReviewDecision"]>[1] = {}) => {
      captured.approvalForgejoUser = options.forgejoUser || null;
      if (options.forgejoUser !== 'gemini') {
        return { ok: false as const, error: 'api-failed', reviewState: null };
      }
      return { ok: true as const, reviewState: 'APPROVED' };
    });

    const integrate = loadIntegrate();
    const logs: unknown[] = [];
    const errors: unknown[] = [];
    const exitCodes: (string | number | null | undefined)[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (msg: unknown) => logs.push(msg);
    console.error = (msg: unknown) => errors.push(msg);
    mock.method(process, 'exit', (code: Parameters<(typeof process)["exit"]>[0]) => exitCodes.push(code));

    try {
      await withDebug(() => integrate([TEST_SLUG, '--dry-run', '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: composition.createMissionApplicationServices }));

      assert.equal(captured.prForgejoUser, 'gemini');
      assert.equal(captured.approvalForgejoUser, 'gemini');
      assert.ok(logs.every((message): message is string => typeof message === 'string'));
      assert.ok(logs.some(l => l.includes('Forgejo PR: PR #41 open')));
      assert.ok(logs.every((message): message is string => typeof message === 'string'));
      assert.ok(logs.some(l => l.includes('Forgejo approval: latest formal review state is APPROVED')));
      assert.ok(!exitCodes.includes(1));
    } finally {
      console.log = originalLog;
      console.error = originalError;
      if (previousUser === undefined) delete process.env.FORGEJO_USER; else process.env.FORGEJO_USER = previousUser;
      if (previousAgent === undefined) delete process.env.WORKFLOW_AGENT; else process.env.WORKFLOW_AGENT = previousAgent;
      cleanup();
    }
  });

  test('integrate passes the pre-resolved Forgejo token into syncMerged', async () => {
    setupMocks();
    let readTokenCalls = 0;
    const captured: Record<'prToken' | 'approvalToken', string | null> = { prToken: null, approvalToken: null };

    mock.method(forgejo, 'readToken', () => {
      readTokenCalls += 1;
      return readTokenCalls <= 2 ? 'preflight-token' : null;
    });
    mock.method(forgejo, 'getPrStatus', (_branch: Parameters<(typeof forgejo)["getPrStatus"]>[0], _rootDir: Parameters<(typeof forgejo)["getPrStatus"]>[1], options: Parameters<(typeof forgejo)["getPrStatus"]>[2] = {}) => {
      captured.prToken = options.token || null;
      return { exists: true as const, state: 'open', merged: false, number: 41 };
    });
    mock.method(forgejo, 'getLatestReviewDecision', (_branch: Parameters<(typeof forgejo)["getLatestReviewDecision"]>[0], options: Parameters<(typeof forgejo)["getLatestReviewDecision"]>[1] = {}) => {
      captured.approvalToken = options.token || null;
      return { ok: true as const, reviewState: 'APPROVED' };
    });

    const integrate = loadIntegrate();
    const logs: unknown[] = [];
    const originalLog = console.log;
    console.log = (msg: unknown) => logs.push(msg);

    try {
      await integrate([TEST_SLUG, '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: composition.createMissionApplicationServices });

      assert.equal(captured.prToken, 'preflight-token');
      assert.equal(captured.approvalToken, 'preflight-token');
      assert.equal(readTokenCalls, 2);
      assert.ok(logs.every((message): message is string => typeof message === 'string'));
      assert.ok(logs.some(l => l.includes('integrated into')));
    } finally {
      console.log = originalLog;
      cleanup();
    }
  });

  test('integrate rejects a Forgejo PR that is already merged', async () => {
    setupMocks();
    mock.method(forgejo, 'getPrStatus', () => ({ exists: true as const, state: 'closed', merged: true, number: 41 }));
    const integrate = loadIntegrate();
    const logs: unknown[] = [];
    const errors: unknown[] = [];
    const exitCodes: (string | number | null | undefined)[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (msg: unknown) => logs.push(msg);
    console.error = (msg: unknown) => errors.push(msg);
    mock.method(process, 'exit', (code: Parameters<(typeof process)["exit"]>[0]) => exitCodes.push(code));

    try {
      await integrate([TEST_SLUG, '--dry-run', '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: composition.createMissionApplicationServices });
    } catch { /* expected */ }

    const output = [...logs, ...errors].join('\n');
    assert.match(output, /Forgejo PR: PR #41 is already marked merged/);
    assert.match(output, /re-sync the local base branch/);
    assert.match(output, new RegExp(`px integrate ${TEST_SLUG} --dry-run`));
    assert.equal(statsCalls.length, 0);
    assert.equal(exitCodes.at(-1), 1);

    console.log = originalLog;
    console.error = originalError;
    cleanup();
  });

  test('integrate warns that --no-gate is ignored', async () => {
    setupMocks();
    const integrate = loadIntegrate();
    const logs: unknown[] = [];
    const originalLog = console.log;
    console.log = (msg: unknown) => logs.push(msg);

    try {
      await integrate([TEST_SLUG, '--dry-run', '--no-gate', '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: composition.createMissionApplicationServices });
    } catch { /* expected */ }

    assert.ok(logs.every((message): message is string => typeof message === 'string'));
    assert.ok(logs.some(l => l.includes('integrate ignores --no-gate')));
    assert.equal(statsCalls.length, 0);

    console.log = originalLog;
    cleanup();
  });

  test('integrate exits non-zero when post-integration stats recording fails', async () => {
    setupMocks();
    mock.method(stats, 'recordIntegrationStats', (args: Parameters<typeof stats.recordIntegrationStats>[0]) => {
      statsCalls.push(args);
      throw new Error('stats write failed');
    });
    const integrate = loadIntegrate();
    const errors: unknown[] = [];
    const exitCodes: (string | number | null | undefined)[] = [];
    const originalError = console.error;
    console.error = (msg: unknown) => errors.push(msg);
    mock.method(process, 'exit', (code: Parameters<(typeof process)["exit"]>[0]) => exitCodes.push(code));

    try {
      await integrate([TEST_SLUG, '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: composition.createMissionApplicationServices });
    } catch { /* expected */ }

    assert.equal(statsCalls.length, 1);
    assert.ok(errors.every((message): message is string => typeof message === 'string'));
    assert.ok(errors.some(l => l.includes('Post-integration workflow stats failed')));
    assert.ok(errors.every((message): message is string => typeof message === 'string'));
    assert.ok(errors.some(l => l.includes('stats write failed')));
    assert.equal(exitCodes.at(-1), 1);

    console.error = originalError;
    cleanup();
  });

  test('integrate reports merged-PR recovery guidance before any closeout work', async () => {
    setupMocks();
    mock.method(forgejo, 'getPrStatus', () => ({ exists: true as const, state: 'closed', merged: true, number: 41 }));
    const integrate = loadIntegrate();
    const logs: unknown[] = [];
    const errors: unknown[] = [];
    const exitCodes: (string | number | null | undefined)[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (msg: unknown) => logs.push(msg);
    console.error = (msg: unknown) => errors.push(msg);
    mock.method(process, 'exit', (code: Parameters<(typeof process)["exit"]>[0]) => exitCodes.push(code));

    try {
      await integrate([TEST_SLUG, '--dry-run', '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: composition.createMissionApplicationServices });
    } catch { /* expected */ }

    const output = [...logs, ...errors].join('\n');
    assert.match(output, /Integration preflight failed\./);
    assert.match(output, /Forgejo PR: PR #41 is already marked merged/);
    assert.ok(output.includes(`git -C ${FAKE_ROOT} checkout main`));
    assert.equal(statsCalls.length, 0);
    assert.equal(exitCodes.at(-1), 1);

    console.log = originalLog;
    console.error = originalError;
    cleanup();
  });

  test('integrate Variant B stops when dry-run merge cannot be aborted cleanly', async () => {
    setupMocks();
    let taskStatusMutations = 0;
    mock.method(backlog, 'getTaskStatus', () => 'review');
    mock.method(backlog, 'setTaskStatus', () => {
      taskStatusMutations++;
      return true;
    });
    mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('branch') && args.includes('--show-current')) return { signal: null,  status: 0, stdout: 'main', stderr: '' };
      if (args.includes('status')) return { signal: null,  status: 0, stdout: '', stderr: '' };
      // F1 confirms the integration rebase by rev-parse-ing the primary and the
      // mission HEAD, then checking `--is-ancestor`; the rebase step needs these.
      if (args.includes('rev-parse')) return { signal: null,  status: 0, stdout: 'deadbeef', stderr: '' };
      if (args.includes('merge') && args.includes('--no-commit')) return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('merge') && args.includes('--abort')) return { signal: null,  status: 1, stdout: '', stderr: 'fatal: abort failed' };
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    });
    const integrate = loadIntegrate();
    const errors: unknown[] = [];
    const exitCodes: (string | number | null | undefined)[] = [];
    const originalError = console.error;
    console.error = (msg: unknown) => errors.push(msg);
    mock.method(process, 'exit', (code: Parameters<(typeof process)["exit"]>[0]) => exitCodes.push(code));

    try {
      await integrate([TEST_SLUG, '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: composition.createMissionApplicationServices });
    } catch { /* expected */ }

    assert.ok(errors.every((message): message is string => typeof message === 'string'));
    assert.ok(errors.some(l => l.includes('Dry-run merge could not be aborted cleanly')));
    assert.equal(taskStatusMutations, 0, 'must not promote the task before the probe merge abort succeeds');
    assert.equal(statsCalls.length, 0);
    assert.equal(exitCodes.at(-1), 1);

    console.error = originalError;
    cleanup();
  });

  test('integrate Variant B resumed partial state prints sync diagnostics on sync failure', async () => {
    setupMocks();
    mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('branch') && args.includes('--show-current')) return { signal: null,  status: 0, stdout: 'main', stderr: '' };
      if (args.includes('status')) return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('rev-parse')) return { signal: null,  status: 0, stdout: 'deadbeef', stderr: '' };
      if (args.includes('merge') && args.includes('--no-commit')) return { signal: null,  status: 1, stdout: 'conflict', stderr: 'conflict' };
      if (args.includes('merge') && args.includes('--abort')) return { signal: null,  status: 1, stdout: '', stderr: 'There is no merge to abort' };
      if (args.includes('log') && args.includes('--format=%x00%H%x00%B')) return { signal: null,  status: 0, stdout: `\0deadbeef\0mission/${TEST_SLUG}: Test Mission\n`, stderr: '' };
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    });
    mock.method(forgejo, 'syncMerged', () => ({ ok: false as const, error: 'api-failed', statusCode: 500 }));
    const integrate = loadIntegrate();
    const logs: unknown[] = [];
    const errors: unknown[] = [];
    const exitCodes: (string | number | null | undefined)[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (msg: unknown) => logs.push(msg);
    console.error = (msg: unknown) => errors.push(msg);
    mock.method(process, 'exit', (code: Parameters<(typeof process)["exit"]>[0]) => exitCodes.push(code));

    try {
      await integrate([TEST_SLUG, '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: composition.createMissionApplicationServices });
    } catch { /* expected */ }

    assert.ok(logs.every((message): message is string => typeof message === 'string'));
    assert.ok(logs.some(l => l.includes('Resuming from sync-merged step')));
    assert.ok(errors.every((message): message is string => typeof message === 'string'));
    assert.ok(errors.some(l => l.includes('Forgejo sync-merged failed (api-failed: 500).')));
    assert.ok(logs.every((message): message is string => typeof message === 'string'));
    assert.ok(logs.some(l => l.includes('Node sync-merged Diagnostic Table')));
    assert.equal(statsCalls.length, 0);
    assert.equal(exitCodes.at(-1), 1);

    console.log = originalLog;
    console.error = originalError;
    cleanup();
  });

  test('integrate Variant B conflict path prints conflicting files and helper guidance', () => {
    const logs: unknown[] = [];
    const errors: unknown[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (msg: unknown) => logs.push(msg);
    console.error = (msg: unknown) => errors.push(msg);

    try {
      reportMergeConflicts(
        { slug: TEST_SLUG, area: 'docs', baseBranch: 'main' },
        ['workflow/lib/commands/integrate.js', 'docs/index.md'],
        {
          describeReviewMatrix: () => ['matrix-line'],
          buildConflictResolutionPrompt: () => ['Conflict resolution options:'],
          createAbort: () => new Error('expected conflict abort'),
        },
      );
    } catch { /* expected */ }

    assert.ok(errors.every((message): message is string => typeof message === 'string'));
    assert.ok(errors.some(l => l.includes('Merge conflicts detected. Rebase the mission branch before integrating.')));
    assert.ok(logs.every((message): message is string => typeof message === 'string'));
    assert.ok(logs.some(l => l.includes('Conflicting files (2):')));
    assert.ok(logs.every((message): message is string => typeof message === 'string'));
    assert.ok(logs.some(l => l.includes('matrix-line')));
    assert.ok(logs.every((message): message is string => typeof message === 'string'));
    assert.ok(logs.some(l => l.includes('Conflict resolution options:')));

    console.log = originalLog;
    console.error = originalError;
  });

  test('evaluateTaskStatusForIntegration edge cases', (t) => {
    setupMocks();
    const integrate = loadIntegrate();
    const { evaluateTaskStatusForIntegration } = integrate;

    // Case 1: Status review, PR merged
    const res1 = evaluateTaskStatusForIntegration(integrationContext({
      taskStatus: 'review',
      pr: { exists: true, state: 'merged', merged: true },
      approval: { ok: false }
    }));
    assert.strictEqual(res1.ok, false);
    assert.match(res1.message, /approved Forgejo PR/);

    // Case 2: Status review, review approved
    const res2 = evaluateTaskStatusForIntegration(integrationContext({
      taskStatus: 'review',
      pr: { exists: false, merged: false },
      approval: { ok: true, reviewState: 'APPROVED' }
    }));
    assert.strictEqual(res2.ok, true);
    assert.match(res2.message, /latest formal review state is APPROVED/);

    // Case 3: Other status
    const res3 = evaluateTaskStatusForIntegration(integrationContext({
      taskStatus: 'active',
      pr: { exists: false, merged: false },
      approval: { ok: true, reviewState: 'APPROVED' }
    }));
    assert.strictEqual(res3.ok, false);
  });

  test('recordPostIntegrationStats keeps operator-owned stats outside git', async () => {
    setupMocks();
    const gitCalls: string[][] = [];

    mock.method(gitModule, 'git', (args: string[]) => {
          gitCalls.push(args);
          if (args.join(' ').includes('log -1 --format=%cs')) {
            return { signal: null, status: 0, stdout: '2026-05-18\n', stderr: '' };
          }
          if (args.includes('add') || args.includes('commit') || args.includes('push') || args.includes('reset')) {
            throw new Error(`unexpected git args: ${JSON.stringify(args)}`);
          }
          return { signal: null, status: 0, stdout: '', stderr: '' };
        });
    try {
      const { recordPostIntegrationStats } = loadIntegrate();
      const outcome = await recordPostIntegrationStats('task-1109', { configuration: resolveConfiguration(process.env),
        rootDir: FAKE_ROOT,
        recordIntegrationStatsFn() {
          return {
            changed: true,
            row: {
              mission: 'task-1109',
              implementer: 'gemini',
              pr_fix_rounds: '0',
              classification: 'ai_sdlc',
              date: '2026-05-18',
            },
            report: 'weekly report',
          };
        }
      });

      assert.ok('changed' in outcome);
      assert.equal(outcome.changed, true);
      assert.ok(!gitCalls.some(args => args.includes('add')));
      assert.ok(!gitCalls.some(args => args.includes('commit')));
      assert.ok(!gitCalls.some(args => args.includes('push')));
      assert.ok(!gitCalls.some(args => args.includes('reset')));
    } finally {
      cleanup();
    }
  });
});

// ---- task-2367 integration completion order (consolidated from test/task-2367-integration-completion-repro.test.ts, TASK-2622.09) ----
describe("integration completion order", () => {
  const git = mockModule<typeof import('../../../src/adapters/git/git.js')>('../../../src/adapters/git/git.js', import.meta.url);
  const missionUtils = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const backlog = mockModule<typeof import('../../../src/adapters/backlog/backlog.js')>('../../../src/adapters/backlog/backlog.js', import.meta.url);
  const forgejo = mockModule<typeof import('../../../src/adapters/forgejo/forgejo.js')>('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
  const stats = mockModule<typeof import('../../../src/adapters/cli/commands/stats.js')>('../../../src/adapters/cli/commands/stats.js', import.meta.url);
  const verification = mockModule<typeof import('../../../src/adapters/verification/verification.js')>('../../../src/adapters/verification/verification.js', import.meta.url);
  const integrate = mockModule<typeof import('../../../src/adapters/cli/commands/integrate.js')>('../../../src/adapters/cli/commands/integrate.js', import.meta.url);

  const SLUG = 'task-2367-fixture';
  const ROOT = registeredMkdtemp('parallix-task-2367-');

  test('TASK-2367: a landed approved integration persists done once before statistics', async () => {
    process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS = '1';
    fs.mkdirSync(path.join(ROOT, 'backlog', 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'workflow.config.json'), JSON.stringify({ adapters: { verification: { command: 'true' } } }));
    fs.writeFileSync(path.join(ROOT, 'backlog', 'tasks', 'task.md'), 'status: approved\n');
    const calls: string[] = [];
    let status: Mission['status'] = 'integration';
    let doneEvents = 0;
    mock.method(missionUtils, 'inferSlug', () => SLUG);
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
    mock.method(missionUtils, 'getPrimaryWorktree', () => ROOT);
    mock.method(missionUtils, 'findMissionDir', () => path.join(ROOT, 'missions', SLUG));
    mock.method(missionUtils, 'findMissionArea', () => 'all');
    mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(ROOT, '..', SLUG));
    mock.method(missionUtils, 'resolveMainRepo', () => ROOT);
    mock.method(missionUtils, 'missionTitle', () => 'fixture');
    mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
    mock.method(git, 'getCurrentBranch', () => `mission/${SLUG}`);
    mock.method(git, 'git', (args: string[]) => {
      if (args.includes('branch') && args.includes('--show-current')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('diff') && args.includes('--cached')) return { signal: null,  status: 0, stdout: 'fixture.ts\n', stderr: '' };
      if (args.includes('commit')) calls.push('landed');
      if (args.includes('rev-parse')) return { signal: null,  status: 0, stdout: 'landed-sha\n', stderr: '' };
      if (args.includes('show')) return { signal: null,  status: 0, stdout: '2026-05-15T12:00:00+02:00\n', stderr: '' };
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    });
    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: path.join(ROOT, 'backlog', 'tasks', 'task.md') }));
    mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
    mock.method(backlog, 'getTaskStatus', () => 'approved');
    mock.method(backlog, 'getTaskAssignee', () => 'codex');
    mock.method(backlog, 'completeTask', () => true);
    mock.method(forgejo, 'getPrStatus', () => ({ exists: true as const, state: 'open', merged: false, number: 1 }));
    mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true as const, reviewState: 'APPROVED' }));
    mock.method(forgejo, 'listOpenPrsForSlug', () => []);
    mock.method(forgejo, 'readToken', () => 'token');
    mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
    mock.method(forgejo, 'syncMerged', () => ({ ok: true as const }));
    mock.method(stats, 'recordIntegrationStats', async () => {
      calls.push('stats');
      return { changed: false, row: { mission: SLUG }, data: { rows: [] }, report: 'none' };
    });
    mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
    mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true as const, proof: { rootDir: ROOT } }));
    mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true as const }));
    mock.method(process, 'cwd', () => ROOT);
    mock.method(process, 'exit', () => {});
    const services = integrationServices({
      store: { load: async () => ({ kind: 'found', mission: fixtureMission(SLUG, { status, review: null, labels: missionLabels(['ai_sdlc']) }), version: missionVersion(1) }) },
      integration: { decideIntegration: async () => { calls.push('done'); status = 'done'; doneEvents += 1; return { durableEvidence: [], status: 'completed', value: { mission: fixtureMission(SLUG, { status, labels: missionLabels(['ai_sdlc']) }), version: missionVersion(2) } }; } },
      lifecycle: { transition: async request => ({ durableEvidence: [], status: 'completed', value: { mission: fixtureMission(request.missionId, { status: 'review' }), from: 'active', to: 'review', previousAssignee: null, laneChanged: true, version: missionVersion(2) } }) },
    });
    try {
      await integrate.default([SLUG, '--no-integration-gates'], { configuration: resolveConfiguration(process.env), missionServicesFn: async () => services });
      assert.equal(status, 'done');
      assert.equal(doneEvents, 1);
      assert.deepEqual(calls, ['landed', 'done', 'stats']);
    } finally {
      mock.reset();
      fs.rmSync(ROOT, { recursive: true, force: true });
    }
  });
});
