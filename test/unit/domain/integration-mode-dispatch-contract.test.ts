// Historical regression provenance: TASK-2500.
// Behavior-owned suite (TASK-2622.09): integration mode capability dispatch (local, github-publish,
// github-pr), mode reporting in config/status, the recorded-brief contract, the Mission integration
// service, and mode dispatch through `px integrate` (task-2500). Legacy case names unchanged.
import test, { mock, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IntegrationOperation } from '../../../src/application/ports/integration-strategy.js';
import type { IntegrationStrategyPort } from '../../../src/application/ports/integration-strategy.js';
import type { IntegrationMode } from '../../../src/domain/integration.js';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';
import type { IntegrateWorkflowPorts } from '../../../src/application/ports/integrate-workflow.js';
import type { MissionStore, MissionTransitionStore } from '../../../src/application/domain-ports.js';
import type { LaneTransitionEvent } from '../../../src/domain/board-event.js';
import type { Mission } from '../../../src/domain/mission.js';
import type { MissionStatus } from '../../../src/domain/mission.js';
import { approvedReview, inMemoryTransitionStore, integrateCommandMission } from '../../fixtures/mission-builders.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../../../src/adapters/cli/commands/config.js', import.meta.url);
mockModule('../../../src/adapters/cli/commands/status.js', import.meta.url);
mockModule('../../../src/adapters/git/git.js', import.meta.url);
mockModule('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
mockModule('../../../src/adapters/backlog/backlog.js', import.meta.url);
mockModule('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
mockModule('../../../src/adapters/github/github-pr.js', import.meta.url);
mockModule('../../../src/adapters/verification/verification.js', import.meta.url);
mockModule('../../../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();
const { INTEGRATION_OPERATIONS } = await import('../../../src/application/ports/integration-strategy.js');
const { createIntegrationStrategy } = await import('../../../src/application/services/integration-dispatch.js');
const { NO_INTEGRATION_EVIDENCE } = await import('../../../src/domain/integration.js');
const { createIntegrationPreflight } = await import('../../../src/application/integrate/preflight.js');
const { createIntegrationContextBuilder } = await import('../../../src/application/integrate/context.js');
const { MissionIntegrationService } = await import('../../../src/application/mission-integration-service.js');
const { missionVersion, MissionStaleVersion } = await import('../../../src/application/domain-ports.js');
const { agentFamily } = await import('../../../src/domain/agents.js');
const { missionId, missionLabels } = await import('../../../src/domain/mission.js');
const { repositoryId } = await import('../../../src/domain/repository.js');
const { MissionLifecycleService } = await import('../../../src/application/mission-lifecycle-service.js');

// ---- integration strategy dispatch (consolidated from test/integration-dispatch.test.ts, TASK-2622.09) ----
describe("integration strategy dispatch", () => {
  // task-2500.01 CP-2: the integration-mode dispatcher centralizes the per-mode
  // capability table so callers never branch on the mode themselves. Every mode
  // other than the one under test fails closed on an operation it does not own.

  function strategy(mode: IntegrationMode): IntegrationStrategyPort {
    return createIntegrationStrategy(mode);
  }

  test('local owns every operation it performs itself', () => {
    const s = strategy('local');
    const localOps = [
      'prepare-integration', 'run-required-local-gates', 'produce-integration-candidate',
      'publish', 'close-mission',
    ] as const;
    for (const op of localOps) {
      assert.equal(s.supportFor(op), 'local', `local should own ${op}`);
      assert.equal(s.refusalFor(op), null, `local should not refuse ${op}`);
    }
  });

  test('local refuses to submit for external verification (no external provider)', () => {
    const s = strategy('local');
    const refusal = s.refusalFor('submit-for-external-verification');
    assert.ok(refusal, 'local must refuse submit-for-external-verification');
    assert.equal(refusal!.support, 'unsupported');
    assert.equal(refusal!.mode, 'local');
  });

  test('local run executes the supplied local implementation', async () => {
    const s = strategy('local');
    let ran = false;
    const result = await s.run('produce-integration-candidate', () => { ran = true; return 'candidate-sha'; });
    assert.equal(result, 'candidate-sha');
    assert.ok(ran);
  });

  test('local run fails closed on an operation it does not own', async () => {
    const s = strategy('local');
    await assert.rejects(
      () => s.run('submit-for-external-verification', () => 'nope'),
      /the "local" integration mode .* does not submit for external verification\./,
    );
  });

  test('github-publish owns the local preparation steps and fails closed on the provider steps', async () => {
    const s = strategy('github-publish');
    for (const op of ['prepare-integration', 'run-required-local-gates', 'produce-integration-candidate', 'close-mission'] as const) {
      assert.equal(s.supportFor(op), 'local', `github-publish should own ${op}`);
    }
    for (const op of ['submit-for-external-verification', 'publish', 'observe-external-integration'] as const) {
      assert.equal(s.supportFor(op), 'external-pending', `github-publish declares ${op}`);
      const refusal = s.refusalFor(op);
      assert.ok(refusal, `github-publish must refuse to run ${op} without the provider adapter`);
      assert.equal(refusal!.support, 'external-pending');
      await assert.rejects(() => s.run(op as IntegrationOperation, () => 'nope'), /not shipped in this release/);
    }
  });

  test('github-pr owns the branch-push verification step and refuses the local primary merge', () => {
    const s = strategy('github-pr');
    assert.equal(s.supportFor('submit-for-external-verification'), 'local', 'github-pr pushes its own reviewable branch');
    assert.equal(s.supportFor('produce-integration-candidate'), 'local');
    const publish = s.refusalFor('publish');
    assert.ok(publish, 'github-pr must never merge into the protected primary branch itself');
    assert.equal(publish!.support, 'unsupported');
    assert.match(publish!.message, /GitHub\/PR/);
  });

  test('github-pr run fails closed on publish', async () => {
    const s = strategy('github-pr');
    await assert.rejects(() => s.run('publish', () => 'nope'), /does not publish/);
  });

  test('closure blocker enforces each mode\'s evidence requirement', () => {
    assert.equal(strategy('local').closureBlocker({ ...NO_INTEGRATION_EVIDENCE, candidateSha: 'abc123' }), null);
    assert.match(
      strategy('local').closureBlocker(NO_INTEGRATION_EVIDENCE),
      /no integration candidate commit was produced/,
    );
    assert.match(
      strategy('github-publish').closureBlocker({ ...NO_INTEGRATION_EVIDENCE, candidateSha: 'abc123' }),
      /no external verification/,
    );
    assert.match(
      strategy('github-publish').closureBlocker({ candidateSha: 'abc123', verifiedSha: 'def456', externalIntegrationObserved: false }),
      /external verification covers def456, not the integration candidate abc123/,
    );
    assert.equal(
      strategy('github-publish').closureBlocker({ candidateSha: 'abc123', verifiedSha: 'abc123', externalIntegrationObserved: false }),
      null,
    );
    assert.match(
      strategy('github-pr').closureBlocker(NO_INTEGRATION_EVIDENCE),
      /no external integration into the primary branch was observed/,
    );
    assert.equal(
      strategy('github-pr').closureBlocker({ ...NO_INTEGRATION_EVIDENCE, externalIntegrationObserved: true }),
      null,
    );
  });
});

// ---- integration mode CLI reporting (consolidated from test/integration-mode-cli.test.ts, TASK-2622.09) ----
describe("integration mode CLI reporting", () => {
  // task-2500.01 CP-3: `px config` and `px status` surface the active integration
  // mode. `local` (the default) and a configured mode both print a stable line.

  const config = mockModule<typeof import('../../../src/adapters/cli/commands/config.js')>('../../../src/adapters/cli/commands/config.js', import.meta.url);
  const status = mockModule<typeof import('../../../src/adapters/cli/commands/status.js')>('../../../src/adapters/cli/commands/status.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());

  function withTempConfig(config: unknown, run: (_root: string) => void): void {
    const root = registeredMkdtemp('task-2500.01-cli-');
    try {
      if (config !== null) {
        fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify(config));
      }
      run(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  function runConfig(root: string, args: string[] = []) {
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | null = null;
    return config.default(args, {
      rootDir: root,
      logFn: message => logs.push(message),
      errorFn: message => errors.push(message),
      exitFn: code => { exitCode = code; },
    }).then(() => ({ logs, errors, exitCode }));
  }

  function runStatus(root: string) {
    const logs: string[] = [];
    let exitCode = 0;
    return status.default([], {
      exit: code => { exitCode = code; },
      log: message => logs.push(message),
      inferSlugFn: () => null,
      getCurrentBranchFn: () => 'main',
      findTaskFileFn: () => undefined,
      getTaskStatusFn: () => null,
      findMissionDirFn: () => undefined,
      findCheckpointsFn: () => undefined,
      getFirstLineFn: () => '',
      getPrStatusFn: () => ({ exists: false }),
      findStaleMissionWorktreesFn: () => [],
      readAgentConfigOrExitFn: () => ({}),
      eligibleAgentsForStepFn: () => [],
      allWorkflowAgentNamesFn: () => ['codex'],
      workflowLauncherStatusFn: () => ({ supported: false, agent: '' }),
      getLastThreeCommitsFn: () => [],
      getUncommittedCountFn: () => 0,
      detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
      buildProjectionFn: async () => { throw new Error('no projection in CLI surface test'); },
    }).then(() => ({ logs, exitCode }));
  }

  test('config prints an explicit active integration mode line', async () => {
    await withTempConfig({ integration: { mode: 'github-publish' } }, async root => {
      const result = await runConfig(root);
      assert.equal(result.exitCode, null);
      assert.match(result.logs.join('\n'), /Integration mode: github-publish/);
    });
    await withTempConfig(null, async root => {
      const result = await runConfig(root);
      assert.match(result.logs.join('\n'), /Integration mode: local/);
    });
  });

  test('status prints the active integration mode for the configured mode', async () => {
    await withTempConfig({ integration: { mode: 'github-pr' } }, async root => {
      const cwd = process.cwd();
      try {
        process.chdir(root);
        const { logs, exitCode } = await runStatus(root);
        assert.equal(exitCode, 0);
        assert.match(logs.join('\n'), /Integration mode: github-pr/);
      } finally {
        process.chdir(cwd);
      }
    });
  });
});

// ---- integration recorded contract (consolidated from test/integration-recorded-contract.test.ts, TASK-2622.09) ----
describe("integration recorded contract", () => {
  function fixture() {
    let searches = 0;
    const ports = {
      missionPaths: {
        findMissionDir: () => null,
        resolveWorktree: () => '/mission',
        missionBranchName: () => 'mission/task-2543',
        missionDirForSlug: () => '/base/missions/task-2543',
        findMissionDocInBranches: () => { searches++; return []; },
        conventionalWorktreePath: () => process.cwd(),
      },
      backlog: {
        resolveTaskFile: () => ({ ok: true, taskFile: '/mission/backlog/tasks/task-2543.md' }),
        getTaskAssignee: () => 'codex',
        getTaskClassification: () => 'ai_sdlc',
      },
      productConfig: { isForgejoReviewEnabled: () => false },
      git: {
        getCurrentBranch: () => 'mission/task-2543',
        git: (args: string[]) => ({ status: 0, stdout: args.includes('branch') ? 'main' : '', stderr: '' }),
        detectRebaseState: () => ({ inProgress: false }),
      },
      checkout: { getUnresolvedIndexConflicts: () => ({ ok: true, files: [] }) },
      fileSystem: { existsSync: () => false },
      forgejo: {}, review: {}, landing: {},
      stateMap: { toVirtual: () => 'ready-for-integration' },
    } as unknown as IntegrateWorkflowPorts;
    return { ports, searches: () => searches };
  }

  for (const recorded of [true, false]) {
    test(`integration ${recorded ? 'accepts a recorded brief without files' : 'explains how to recover a missing historical contract'}`, async () => {
      const { ports, searches } = fixture();
      const context = await createIntegrationContextBuilder(ports).buildIntegrationContext('task-2543', {
        baseBranch: 'main', baseWorktree: '/base',
      });
      assert.equal(context.area, 'all', 'missing mission files must not narrow verification to docs');
      const lines: string[] = [];
      const result = createIntegrationPreflight(ports).printIntegrationPreflight({
        ...context, missionStatus: 'integration',
        missionBrief: recorded ? { goal: 'repair', why: 'unblock integration', scope: null, outOfScope: [] } : null,
      }, { log: line => lines.push(line) });
      assert.deepEqual(result.failures, recorded ? [] : ['mission-doc']);
      assert.equal(searches(), recorded ? 0 : 1);
      if (!recorded) {
        assert.match(lines.join('\n'), /Mission doc: missions\/task-2543\/MISSION.md not found/);
        assert.match(lines.join('\n'), /px status task-2543 --json/);
        assert.match(lines.join('\n'), /px import-legacy --existing-only/);
        assert.match(lines.join('\n'), /px goal set/);
      }
    });
  }
});

// ---- Mission integration service (consolidated from test/mission-integration-service.test.ts, TASK-2622.09) ----
describe("Mission integration service", () => {
  const ID = missionId('task-2322-06-fixture');
  const mission: Mission = {
    id: ID, repositoryId: repositoryId('parallix'), title: 'fixture', labels: missionLabels([]),
    assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null,
    status: 'integration', closedAt: null,
  };
  const capabilities = new Set(['integration:decide', 'closure:record'] as const);

  /**
   * Integration and closure both commit through `saveWithTransition`
   * (TASK-2347.02), so the fake routes it to whichever `save` a test supplied and
   * collects the lane events the service emitted.
   */
  function store(
    overrides: Partial<MissionTransitionStore> = {},
    events: LaneTransitionEvent[] = [],
  ): MissionTransitionStore {
    const base: MissionStore = {
      load: async () => ({ kind: 'found', mission, version: missionVersion(3) } as const),
      save: async () => missionVersion(4),
      ...overrides,
    };
    return {
      ...base,
      saveWithTransition: overrides.saveWithTransition
        ?? (async (next, expectedVersion, event) => {
          events.push(event);
          return base.save(next, expectedVersion);
        }),
    };
  }
  const fresh = <T>(value: T) => ({ source: 'git' as const, status: 'fresh' as const, value });

  describe('MissionIntegrationService', () => {
    it('accepts explicit fresh merge and verification facts before integration persistence', async () => {
      let saved: Mission | null = null;
      const events: LaneTransitionEvent[] = [];
      const outcome = await new MissionIntegrationService(store({ save: async (next) => { saved = next; return missionVersion(4); } }, events)).decideIntegration({
        operationId: 'integrate', missionId: ID, capabilities, expectedVersion: missionVersion(3),
        occurredAt: '2026-07-30T06:00:00Z',
        facts: { git: fresh({ merged: true }), verification: fresh({ passed: true }) },
      });
      assert.equal(outcome.status, 'completed');
      assert.equal(saved!.status, 'done');
      // The lane event commits with the aggregate: throughput is derived from it.
      assert.deepEqual(events.map((event) => ({ from: event.from, to: event.to, trigger: event.trigger, key: event.idempotencyKey })), [
        { from: 'integration', to: 'done', trigger: 'integrate', key: `${ID}:integrate:2026-07-30T06:00:00Z` },
      ]);
    });

    it('rejects an absent observed verification fact before loading the Mission', async () => {
      let loaded = false;
      const outcome = await new MissionIntegrationService(store({ load: async () => { loaded = true; return { kind: 'found', mission, version: missionVersion(3) }; } })).decideIntegration({
        operationId: 'integrate', missionId: ID, capabilities,
        facts: { git: fresh({ merged: true }), verification: { source: 'git', status: 'unavailable' } },
      });
      assert.equal(outcome.error!.kind, 'validation');
      assert.equal(loaded, false);
    });

    it('returns a conflict when persistence rejects the observed Mission version', async () => {
      const outcome = await new MissionIntegrationService(store({ save: async () => { throw new MissionStaleVersion(ID, missionVersion(3), missionVersion(4)); } })).decideIntegration({
        operationId: 'integrate', missionId: ID, capabilities,
        facts: { git: fresh({ merged: true }), verification: fresh({ passed: true }) },
      });
      assert.equal(outcome.error!.kind, 'conflict');
    });

    it('rejects integration from a Mission outside the integration lane', async () => {
      const outcome = await new MissionIntegrationService(store({
        load: async () => ({ kind: 'found', mission: { ...mission, status: 'active' }, version: missionVersion(3) }),
      })).decideIntegration({
        operationId: 'integrate', missionId: ID, capabilities,
        facts: { git: fresh({ merged: true }), verification: fresh({ passed: true }) },
      });
      assert.equal(outcome.error!.kind, 'validation');
      assert.match(outcome.error!.message, /Cannot integrate while/);
    });

    it('reports a non-stale persistence failure after a valid integration decision', async () => {
      const outcome = await new MissionIntegrationService(store({
        save: async () => { throw new Error('disk unavailable'); },
      })).decideIntegration({
        operationId: 'integrate', missionId: ID, capabilities,
        facts: { git: fresh({ merged: true }), verification: fresh({ passed: true }) },
      });
      assert.equal(outcome.error!.kind, 'execution');
      assert.match(outcome.error!.message, /disk unavailable/);
    });

    it('records closure only from a fresh completed integration observation', async () => {
      const done = { ...mission, status: 'done' as const, closedAt: null };
      const events: LaneTransitionEvent[] = [];
      const outcome = await new MissionIntegrationService(store({ load: async () => ({ kind: 'found', mission: done, version: missionVersion(3) }) }, events)).close({
        operationId: 'close', missionId: ID, capabilities, closedAt: '2026-07-30T07:00:00Z',
        integration: fresh({ completed: true }),
      });
      assert.equal(outcome.status, 'completed');
      assert.equal(outcome.value!.mission.closedAt, '2026-07-30T07:00:00Z');
      assert.deepEqual(events, [], 'closing a done Mission must not emit a done-to-done lane event');
    });
  });
});

// ---- task-2500 integrate mode dispatch (consolidated from test/task-2500-integrate-mode-dispatch.test.ts, TASK-2622.09) ----
describe("integrate mode dispatch", () => {
  // ---------------------------------------------------------------------------
  // task-2500.01 CP-4 / F1 — the `px integrate` entrypoint routes the real merge
  // operations through the integration capability boundary (integration-dispatch),
  // not a scattered `if (mode)` in integrate.ts.
  //
  // This entrypoint-level test drives the production `integrate.default`
  // orchestration end to end over a doubled Git boundary only; no agent, LLM, or
  // network is involved. The repository's `integration.mode` is the only thing
  // that changes between the two scenarios:
  //
  //   local     owns the local primary merge -> the squash/merge git call runs.
  //   github-pr never publishes to the primary -> `px integrate` fails closed on
  //             the `publish` operation before any merge is issued, so the local
  //             squash/merge path is unreachable in that mode.
  // ---------------------------------------------------------------------------

  const git = mockModule<typeof import('../../../src/adapters/git/git.js')>('../../../src/adapters/git/git.js', import.meta.url);
  const missionUtils = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const backlog = mockModule<typeof import('../../../src/adapters/backlog/backlog.js')>('../../../src/adapters/backlog/backlog.js', import.meta.url);
  const forgejo = mockModule<typeof import('../../../src/adapters/forgejo/forgejo.js')>('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
  const github = mockModule<typeof import('../../../src/adapters/github/github-pr.js')>('../../../src/adapters/github/github-pr.js', import.meta.url);
  const verification = mockModule<typeof import('../../../src/adapters/verification/verification.js')>('../../../src/adapters/verification/verification.js', import.meta.url);
  const integrate = mockModule<typeof import('../../../src/adapters/cli/commands/integrate.js')>('../../../src/adapters/cli/commands/integrate.js', import.meta.url);

  const SLUG = 'task-2500-mode';
  const LANDED_SHA = 'a11ced0000000000000000000000000000000001';

  function createFakeStore(status: MissionStatus) {
    return inMemoryTransitionStore(
      integrateCommandMission(SLUG, status, status === 'review' ? approvedReview(SLUG) : null),
      { persist: false, version: 7 },
    );
  }

  function servicesFor() {
    // The landing guard sees the lane AFTER the production flow restores an
    // approved `review` lane to `integration` (integrate-workflow SC1), so the
    // dispatcher dispatches on the restored `integration` lane. SC2 (task-2517)
    // rejects the rebounded `active` lane, not this restored one.
    const store = createFakeStore('integration');
    return {
      store,
      lifecycle: new MissionLifecycleService(store as never),
      integration: new MissionIntegrationService(store as never),
      handoff: { recordNel: async () => ({ }) },
    };
  }

  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });

  interface RunResult {
    error: Error | undefined;
    exitCode: number | undefined;
    logs: string;
    gitCalls: string[][];
  }

  async function runIntegrate(mode: 'local' | 'github-pr'): Promise<RunResult> {
    const root = registeredMkdtemp('parallix-2500-mode-');
    fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
    // The only thing the scenario changes: the repository's configured mode.
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { verification: { command: 'true' } },
      integration: { mode },
    }));
    const taskFile = path.join(root, 'backlog', 'tasks', 'task.md');
    fs.writeFileSync(taskFile, 'status: approved\n');
    const services = servicesFor();
    const logs: string[] = [];
    const gitCalls: string[][] = [];

    // fmt.log writes through the default logger (console.log/console.error).
    mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
    mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });
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
    mock.method(git, 'git', (args: string[]) => {
      gitCalls.push(args);
      const joined = args.join(' ');
      if (joined.includes('branch --show-current')) { return ok('main\n'); }
      if (joined.includes('log --format=%x00%H%x00%B')) { return ok('\0other0\0unrelated subject\n'); }
      if (args.includes('show')) { return ok(`${LANDED_SHA}\n`); }
      if (joined.includes('merge') && joined.includes('--no-commit')) { return ok(''); }
      if (joined.includes('merge') && joined.includes('--abort')) { return ok(''); }
      if (joined.includes('merge') && joined.includes('--squash')) { return ok(''); }
      if (args.includes('diff') && args.includes('--cached')) { return ok('fixture.ts\n'); }
      if (args.includes('commit')) { return ok(''); }
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
    mock.method(github, 'submitOrObserveGithubPr', () => ({ kind: 'pending' as const, number: 1, base: 'main' }));
    mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true, proof: { rootDir: root } }));
    mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true }));
    mock.method(process, 'cwd', () => root);
    let exitCode: number | undefined;
    mock.method(process, 'exit', (code?: number) => { exitCode = code; });

    try {
      await integrate.default([SLUG, '--no-integration-gates'], {
        missionServicesFn: async () => services,
      });
    } catch {
      // fall through; assertions below inspect exitCode/logs/gitCalls
    } finally {
      mock.reset();
      fs.rmSync(root, { recursive: true, force: true });
    }
    return { error: undefined, exitCode, logs: logs.join('\n'), gitCalls };
  }

  // Detect the merge subcommand as a standalone token, not the `merge-base`
  // probe or the `merge.autoedit` rebase config that the integration-time rebase
  // path (task-2506) issues on every run. The previous `includes('merge')`
  // substring heuristic mistook those for a local merge; github-pr mode correctly
  // still issues no local merge while awaiting GitHub evidence.
  const gitMerged = (calls: string[][]) => calls.some(c => c.includes('merge'));

  test('local mode dispatches through the capability boundary and reaches the local squash/merge', async () => {
    const result = await runIntegrate('local');
    // local owns the local primary merge, so it must NOT fail closed on publish
    // and must issue the local merge through the dispatcher.
    assert.doesNotMatch(result.logs, /"local" integration mode .*publish/, 'local mode does not refuse its own publish');
    assert.ok(gitMerged(result.gitCalls), 'local mode issues the local merge through the dispatcher');
  });

  test('github-pr mode waits for GitHub evidence and never reaches the local squash/merge path', async () => {
    const result = await runIntegrate('github-pr');
    assert.equal(result.exitCode, 1, 'github-pr remains incomplete while the external PR is pending');
    assert.match(result.logs, /GitHub PR integration is pending/, 'the pending external state is explicit');
    assert.ok(!gitMerged(result.gitCalls), 'github-pr must not issue a local merge while awaiting GitHub evidence');
  });
});
