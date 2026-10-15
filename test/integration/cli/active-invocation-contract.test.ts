import { fixtureMission } from '../../fixtures/mission-builders.js';
import { agentFamily } from '../../../src/domain/agents.js';
import type { BoardCommandRequest, BoardCommandResult } from '../../../src/application/controller/board-command.js';
import { missionVersion as fixtureVersion } from '../../../src/application/domain-ports.js';
// Historical regression provenance: TASK-2375, TASK-2580.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BoardCommandController } from '../../../src/application/controller/board-controller.js';
import active from '../../../src/adapters/cli/commands/active.js';
import { type ExecuteMissionRequest, ExecuteMissionService } from '../../../src/application/execute-mission-service.js';
import { CurrentWorkRecorder } from '../../../src/application/recording/current-work-recorder.js';
import { ConcreteCurrentWorkReadAdapter } from '../../../src/adapters/backlog/concrete-current-work-read-adapter.js';
import { isWorkInProgress, reconcileCurrentWork } from '../../../src/application/projections/current-work.js';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteOperationalHistoryRepository } from '../../../src/adapters/sqlite/operational-history-repository.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { RepairCheckpointService } from '../../../src/application/repair-checkpoint-service.js';
import { type Mission, missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import { type AgentLaunchOutcome, type AgentLaunchRequest, type ExecuteMissionPorts } from '../../../src/application/ports/execute-mission.js';
import { performance } from 'node:perf_hooks';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { projectMissionCard } from '../../../src/application/projections/mission-board.js';
import { makeProjection } from '../../fixtures/board-projection.js';
import { validateWebBoardSnapshot } from '../../../src/interfaces/web/transport.js';
import { WEB_SNAPSHOT_PATH, createWebHost } from '../../../src/interfaces/web/host.js';
import { recoverMissionLifecycle } from '../../../src/application/mission-lifecycle-recovery.js';
import { MissionCardView } from '../../../web/src/mission-card.js';

describe("active invocation overlap", () => {
  /**
   * TASK-2375 F1 / SC2 — `px active` carries a per-invocation operationId, proved
   * through the real command wiring.
   *
   * The round-1 review (F1) found the execute path still used the slug alone
   * (`active:<slug>`), so two overlapping `px active` runs on the same mission
   * reconciled as one operation: a late `blocked`/`ended` from the older run
   * cleared the newer run's standing work — the exact defect class this mission
   * fixes. These tests drive the real `active()` command, the real
   * `ExecuteMissionService`, and the real current-work recorder/read/reconcile
   * path — no hand-written operationIds.
   */


  const SLUG = 'task-9101';
  const OPERATION_ID = /^active:task-9101:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  /** Bounded wait on an observable condition (explicit synchronization, no sleeps). */
  async function until(condition: () => boolean, what: string, milliseconds = 5_000): Promise<void> {
    const deadline = Date.now() + milliseconds;
    while (!condition()) {
      if (Date.now() >= deadline) { throw new Error(`timed out waiting for ${what}`); }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  interface RecorderFixture {
    readonly recorder: CurrentWorkRecorder;
    readonly readAdapter: ConcreteCurrentWorkReadAdapter;
    dispose(): Promise<void>;
  }

  /** The production current-work write/read pair over a real migrated operator database. */
  async function recorderFixture(): Promise<RecorderFixture> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-2375-active-overlap-'));
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: path.join(dir, 'operator.db') });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    const repo = new SqliteOperationalHistoryRepository(db);
    let tick = 0;
    const now: NonNullable<NonNullable<ConstructorParameters<typeof CurrentWorkRecorder>[1]>["now"]> = () => new Date(Date.parse('2026-08-15T09:00:00.000Z') + (tick += 1_000));
    return {
      recorder: new CurrentWorkRecorder(repo, { processId: process.pid, now }),
      readAdapter: new ConcreteCurrentWorkReadAdapter(repo),
      dispose: async () => {
        await db.close();
        fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  /** Read the mission's current work exactly as the board projection does. */
  async function readCurrentWork(fixture: RecorderFixture) {
    const events = await fixture.readAdapter.loadCurrentWork();
    return reconcileCurrentWork(events, {
      nowMs: Date.parse('2026-08-15T09:05:00.000Z'),
      ttlMs: 5 * 60 * 1000,
      isProcessAlive: () => true,
    }).get(missionId(SLUG)) ?? null;
  }

  function successOutcome(agent = 'claude'): AgentLaunchOutcome {
    return { agent, rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
  }

  function errorOutcome(message: string): AgentLaunchOutcome {
    return { agent: 'claude', rebaseDeferred: false, errored: true, errorMessage: message, exitStatus: null, detail: null };
  }

  /**
   * Mechanism ports for the execute workflow: everything external is inert,
   * except `launch`, which the test gates so two invocations overlap in the
   * window the defect requires.
   */
  function makePorts(launch: (request: AgentLaunchRequest) => Promise<AgentLaunchOutcome>): ExecuteMissionPorts {
    let mission: Mission = fixtureMission('task-2580', {
      id: missionId(SLUG), repositoryId: repositoryId('repo'), title: 'Fixture', labels: [], assignee: null,
      checkpoints: [{ missionId: missionId(SLUG), name: 'CP-1', firstLine: 'test', goalCheck: [], nextActionText: '' }],
      review: null, netEngineeringLines: null,
      brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] }, declaredGates: ['npm test'],
      successCriteria: ['done'], predictedNelBucket: 'Small', status: 'refined' as const, closedAt: null,
    });
    return {
      workspace: {
        preflight: async () => true,
        resolveWorktree: async () => `/tmp/wt-${SLUG}`,
        resolveTaskFile: async () => ({ ok: false as const }),
        readTaskStatus: async () => null,
        enforceCommitSafety: async () => {},
      },
      agentExecution: {
        prepare: async () => ({ prompt: 'execute', agent: 'claude', agentConfig: {} }),
        launch,
      },
      missionTransitions: {
        async load() { return { kind: 'found' as const, mission, version: missionVersion(1) }; },
        async save(next: Mission) { mission = next; return missionVersion(2); },
        async saveWithTransition(next: Mission) { mission = next; return missionVersion(2); },
      },
      telemetry: { recordLaunchTelemetry: async () => {} },
      checkpointValidation: { validateBeforeHandoff: async () => ({ ok: true as const }) },
      handoffExecution: { run: async () => ({ ok: true as const }), repairHygiene: async () => ({ repaired: false }), classifyFailure: () => null, isRelaunchableFailure: () => false },
      autonomousReview: { start: async () => {} },
      repairLaunch: { launch: async () => { throw new Error('Unexpected repair launch'); }, available: () => ({ supported: false }), readHead: () => null },
      output: { log: () => {}, error: () => {}, command: (value: string) => value, formatSlug: (value: string) => value, formatAgent: (value: string) => value },
    };
  }

  /**
   * The real `active()` command wired to a real `ExecuteMissionService`. The
   * wrapper records the exact request the command layer hands to the service —
   * that is where the per-invocation operationId comes from.
   */
  async function runActive(
    captured: string[],
    fixture: RecorderFixture,
    launch: (request: AgentLaunchRequest) => Promise<AgentLaunchOutcome>,
    exitCodes: number[],
  ): Promise<void> {
    const service = new ExecuteMissionService(makePorts(launch), undefined, fixture.recorder);
    await active([SLUG], {
      inferSlugFn: () => SLUG,
      service: {
        execute: (request: ExecuteMissionRequest) => {
          captured.push(request.operationId);
          return service.execute(request);
        },
      },
      rootDir: '/tmp/project-task-9101',
      exitFn: (code: number) => { exitCodes.push(code); },
      logFn: () => {},
      errorFn: () => {},
    });
  }

  test('TASK-2375 SC2: the real px active command assigns a unique per-invocation operationId', async () => {
    const fixture = await recorderFixture();
    try {
      const ids: string[] = [];
      const exitCodes: number[] = [];
      const launch = async () => successOutcome();
      await runActive(ids, fixture, launch, exitCodes);
      await runActive(ids, fixture, launch, exitCodes);

      assert.equal(ids.length, 2, 'two invocations must each reach the execute service');
      assert.notEqual(ids[0], ids[1], 'two overlapping-capable invocations must not share an operationId');
      assert.match(ids[0], OPERATION_ID, 'operationId keeps the type and slug for correlation');
      assert.match(ids[1], OPERATION_ID);
      assert.deepEqual(exitCodes, [], 'both invocations complete cleanly');
    } finally {
      await fixture.dispose();
    }
  });

  test('TASK-2375 SC2: two overlapping real px active runs cannot cross-terminate each other', async () => {
    const fixture = await recorderFixture();
    const ids: string[] = [];
    const launches: AgentLaunchRequest[] = [];
    let releaseA: () => void = () => {};
    let releaseB: () => void = () => {};
    const gateA = new Promise<void>((r) => { releaseA = r; });
    const gateB = new Promise<void>((r) => { releaseB = r; });

    const launch = (request: AgentLaunchRequest) => {
      launches.push(request);
      if (launches.length === 1) {
        // First invocation (A): holds the launch, then fails — its late
        // `blocked` event is exactly the cross-termination the old slug-only id
        // let through.
        return gateA.then(() => errorOutcome('stub launcher exploded'));
      }
      // Second invocation (B): stays running while A terminates.
      return gateB.then(() => successOutcome());
    };

    try {
      const exitCodes: number[] = [];
      const first = runActive(ids, fixture, launch, exitCodes);
      await until(() => launches.length === 1, 'first invocation to reach the launch gate');
      const second = runActive(ids, fixture, launch, exitCodes);
      await until(() => launches.length === 2, 'second invocation to overlap the first');

      releaseA();
      await first; // A terminates: its blocked event lands after B is running.
      assert.equal(exitCodes[0], 1, 'A exits 1 on its own failure');

      const facts = await readCurrentWork(fixture);
      assert.equal(facts?.currentWork?.operationId, ids[1], 'B must remain standing after A\'s late terminal event');
      assert.notEqual(ids[0], ids[1], 'the two real invocations carry distinct operationIds');
      assert.equal(isWorkInProgress(facts?.currentWork ?? null), true, 'the mission must still read as WORKING');

      releaseB();
      await second; // B completes its own operation on its own id.
      assert.deepEqual(exitCodes, [1], 'only A exits non-zero');
      const after = await readCurrentWork(fixture);
      assert.equal(after?.currentWork, null, 'B clears the mission only through its own terminal event');
    } finally {
      releaseA();
      releaseB();
      await fixture.dispose();
    }
  });

  /** Real `active()` + real `ExecuteMissionService`; the review port records what it is asked to start. */
  async function runActiveForReview(args: string[]) {
    const fixture = await recorderFixture();
    const reviews: Array<{ implementer: string; reviewer?: string }> = [];
    const errors: string[] = [];
    const exitCodes: number[] = [];
    let executes = 0;
    try {
      const ports = makePorts(async () => successOutcome());
      const service = new ExecuteMissionService({
        ...ports,
        autonomousReview: { start: async (request) => { reviews.push({ implementer: request.implementer, reviewer: request.reviewer }); } },
      }, undefined, fixture.recorder);
      await active(args, {
        inferSlugFn: () => SLUG,
        service: { execute: (request: ExecuteMissionRequest) => { executes += 1; return service.execute(request); } },
        rootDir: '/tmp/project-task-9101',
        exitFn: (code: number) => { exitCodes.push(code); },
        logFn: () => {},
        errorFn: (message: string) => { errors.push(message); },
      });
    } finally {
      await fixture.dispose();
    }
    return { reviews, errors, exitCodes, executes };
  }

  test('TASK-2723: px active --implementer --reviewer carries the explicit reviewer into automatic review', async () => {
    const run = await runActiveForReview([SLUG, '--implementer', 'claude', '--reviewer', 'codex']);
    assert.deepEqual(run.reviews, [{ implementer: 'claude', reviewer: 'codex' }]);
    assert.deepEqual(run.exitCodes, []);
  });

  test('TASK-2723: px active without --reviewer leaves automatic reviewer selection untouched', async () => {
    const run = await runActiveForReview([SLUG, '--implementer', 'claude']);
    assert.deepEqual(run.reviews, [{ implementer: 'claude', reviewer: undefined }]);
  });

  test('TASK-2723: px active refuses a --reviewer with no value before launching anything', async () => {
    for (const args of [[SLUG, '--reviewer'], [SLUG, '--reviewer', '--implementer', 'claude']]) {
      const run = await runActiveForReview(args);
      assert.equal(run.executes, 0, 'no execution starts without a reviewer value');
      assert.deepEqual(run.reviews, []);
      assert.deepEqual(run.exitCodes, [1]);
      assert.match(run.errors.join('\n'), /Missing value for --reviewer\. Usage: px active <slug> --reviewer <family>/);
    }
  });

  test('TASK-2723: controller dispatch carries --reviewer on the active:execute request', async () => {
    const dispatched: Array<{ agent?: string | null; reviewer?: string | null }> = [];
    await active([SLUG, '--implementer', 'claude', '--reviewer', 'codex'], {
      inferSlugFn: () => SLUG,
      controller: { canExecute: () => true, dispatch: async <T>(request: BoardCommandRequest): Promise<BoardCommandResult<T>> => { dispatched.push(request); return { status: 'completed', value: { agent: 'claude' } as T, durableEvidence: [] }; } },
      rootDir: '/tmp/project-task-9101',
      exitFn: () => {}, logFn: () => {}, errorFn: () => {},
    });
    assert.deepEqual(dispatched.map(({ agent, reviewer }) => ({ agent, reviewer })), [{ agent: 'claude', reviewer: 'codex' }]);
  });
});

describe("active persisted Mission", () => {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  }

  test('px active delivers an active web card before its held agent completes', async () => {
    let mission: Mission = fixtureMission('task-2580', {
      id: missionId('task-2580'), repositoryId: repositoryId('repo'), title: 'Fixture', labels: [], assignee: null,
      checkpoints: [{ missionId: missionId('task-2580'), name: 'CP-1', firstLine: 'test', goalCheck: [], nextActionText: '' }],
      review: null, netEngineeringLines: null,
      brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] }, declaredGates: ['npm test'],
      successCriteria: ['done'], predictedNelBucket: 'Small', status: 'refined', closedAt: null,
    });
    const started = deferred();
    const finish = deferred();
    const ports: ExecuteMissionPorts = {
      workspace: {
        async preflight() { return true; }, async resolveWorktree() { return '/worktree'; },
        async resolveTaskFile() { return { ok: false as const }; },
        async readTaskStatus() { return 'active'; }, async enforceCommitSafety() {},
      },
      agentExecution: {
        async prepare() { return { prompt: 'p', agent: 'codex', agentConfig: {} }; },
        async launch(request: { onAgentChanged?: (_agent: string) => Promise<void> }) {
          await request.onAgentChanged?.('claude');
          started.resolve();
          await finish.promise;
          return { agent: 'claude', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
        },
      },
      missionTransitions: {
        async load() { return { kind: 'found' as const, version: fixtureVersion(1), mission }; },
        async save(next: Mission) { mission = next; return fixtureVersion(2); },
        async saveWithTransition(next: Mission) { mission = next; return fixtureVersion(2); },
      },
      telemetry: { async recordLaunchTelemetry() {} },
      checkpointValidation: { async validateBeforeHandoff() { return { ok: true as const }; } },
      handoffExecution: { async run() { return { ok: true as const }; }, async repairHygiene() { return { repaired: false }; }, classifyFailure() { return null; }, isRelaunchableFailure() { return false; } },
      autonomousReview: { async start() {} },
      repairLaunch: { async launch() { throw new Error('Unexpected repair launch'); }, available() { return { supported: false }; }, readHead() { return null; } },
      output: { log() {}, error() {}, command(value: string) { return value; }, formatSlug(value: string) { return value; }, formatAgent(value: string) { return value; } },
    };

    const host = createWebHost({
      assets: { manifest: { 'index.html': { size: 0, contentType: 'text/html' } }, assets: new Map(), shellHtml: '<head></head>' },
      buildProjection: async () => makeProjection({ active: [projectMissionCard(mission, {
        latestGate: 'unknown', reviewApproval: null, currentWork: null, blockingReason: null, flags: [],
      })] }),
    });
    const web = await host.start();
    // The browser and its loopback connection already exist before a user presses
    // Active; keep one-time client/HTTP startup outside the command budget.
    await fetch(`${web.origin}${WEB_SNAPSHOT_PATH}`);
    const startedAt = performance.now();
    const execution = active(['task-2580'], {
      inferSlugFn: () => 'task-2580', missionTitleFn: () => 'Fixture', payloadLandedFn: () => false,
      service: new ExecuteMissionService(ports), rootDir: '/worktree', exitFn: () => {}, logFn: () => {}, errorFn: () => {},
    });
    try {
      await started.promise;
      const snapshot = await fetch(`${web.origin}${WEB_SNAPSHOT_PATH}`);
      const wire = validateWebBoardSnapshot(await snapshot.json());
      assert.ok(wire.ok, 'the delivered snapshot must validate');
      if (!wire.ok) { throw new Error('unreachable'); }
      const webCard = wire.value.stages.flatMap((stage) => stage.cards).find((card) => card.id === 'task-2580');
      assert.equal(webCard?.status, 'active');
      assert.equal(webCard?.agent, 'claude', 'the fallback implementer replaces the preselected family');
      assert.match(renderToString(createElement(MissionCardView, { card: webCard! })), /mission-card/);
      assert.ok(performance.now() - startedAt < 200, 'px active command, persistence, delivery, and rendering stay within 200 ms');
    } finally {
      finish.resolve();
      await execution;
      await host.close();
    }
  });

  test('recovery reconciles an already-running active task without relaunching or losing Mission evidence', async () => {
    const checkpoint = { missionId: missionId('task-2580'), name: 'CP-1', firstLine: 'done', goalCheck: [{ criterion: 'c', evidence: 'e' }], nextActionText: 'next' };
    let mission = fixtureMission('task-2580', {
      id: missionId('task-2580'), repositoryId: repositoryId('repo'), title: 'Fixture', labels: [], assignee: agentFamily('codex'), checkpoints: [checkpoint],
      review: null, netEngineeringLines: null, brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
      declaredGates: ['npm test'], successCriteria: ['done'], predictedNelBucket: 'Small', status: 'refined' as const, closedAt: null,
    });
    let writes = 0;
    const result = await recoverMissionLifecycle({
      missionId: mission.id, taskStatus: 'active', actor: 'operator', occurredAt: new Date().toISOString(),
      store: {
        async load() { return { kind: 'found' as const, mission, version: fixtureVersion(1) }; },
        async save() { throw new Error('recovery requires a lane event'); },
        async saveWithTransition(next: Mission) { writes += 1; mission = next; return fixtureVersion(2); },
      },
    });
    assert.equal(result.value?.action, 'recover-to-active');
    assert.equal(writes, 1);
    assert.equal(mission.status, 'active');
    assert.deepEqual(mission.checkpoints, [checkpoint]);
  });

  test('an immediate activation blocker launches no agent, preserves lifecycle, and returns within 200 ms', async () => {
    let launches = 0;
    const mission = fixtureMission('task-2580', {
      id: missionId('task-2580'), repositoryId: repositoryId('repo'), title: 'Incomplete', labels: [], assignee: null, checkpoints: [],
      review: null, netEngineeringLines: null, brief: null, declaredGates: [], successCriteria: [],
      predictedNelBucket: null, status: 'refined' as const, closedAt: null,
    });
    const startedAt = performance.now();
    const outcome = await new ExecuteMissionService({
      workspace: {
        async preflight() { return true; }, async resolveWorktree() { return '/worktree'; },
        async resolveTaskFile() { return { ok: false as const }; }, async readTaskStatus() { return null; }, async enforceCommitSafety() {},
      },
      agentExecution: {
        async prepare() { return { prompt: 'p', agent: 'codex', agentConfig: {} }; },
        async launch() { launches += 1; throw new Error('must not launch'); },
      },
      missionTransitions: {
        async load() { return { kind: 'found' as const, version: fixtureVersion(1), mission }; },
        async save() { throw new Error('must not save'); }, async saveWithTransition() { throw new Error('must not save'); },
      },
      telemetry: { async recordLaunchTelemetry() {} }, checkpointValidation: { async validateBeforeHandoff() { return { ok: true as const }; } }, handoffExecution: { async run() { return { ok: true as const }; }, async repairHygiene() { return { repaired: false }; }, classifyFailure() { return null; }, isRelaunchableFailure() { return false; } }, autonomousReview: { async start() {} }, repairLaunch: { async launch() { throw new Error('Unexpected repair launch'); }, available() { return { supported: false }; }, readHead() { return null; } }, output: { log() {}, error() {}, command(value: string) { return value; }, formatSlug(value: string) { return value; }, formatAgent(value: string) { return value; } },
    }).execute({
      operationId: 'active:task-2580', slug: 'task-2580', agent: 'codex', capabilities: new Set(['active:execute']),
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(launches, 0);
    assert.equal(mission.status, 'refined');
    assert.ok(performance.now() - startedAt < 200, 'rejection does not wait for provider startup');
  });

  test('a launcher blocker before onLaunch restores the refined Mission', async () => {
    let mission = fixtureMission('task-2580', {
      id: missionId('task-2580'), repositoryId: repositoryId('repo'), title: 'Ready', labels: [], assignee: null,
      checkpoints: [{ missionId: missionId('task-2580'), name: 'CP-1', firstLine: 'test', goalCheck: [], nextActionText: '' }],
      review: null, netEngineeringLines: null, brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
      declaredGates: ['npm test'], successCriteria: ['done'], predictedNelBucket: 'Small', status: 'refined' as const, closedAt: null,
    });
    const outcome = await new ExecuteMissionService({
      workspace: {
        async preflight() { return true; }, async resolveWorktree() { return '/worktree'; },
        async resolveTaskFile() { return { ok: false as const }; }, async readTaskStatus() { return null; }, async enforceCommitSafety() {},
      },
      agentExecution: {
        async prepare() { return { prompt: 'p', agent: 'codex', agentConfig: {} }; },
        async launch() { return { agent: 'codex', rebaseDeferred: false, errored: true, errorMessage: 'launcher unavailable', exitStatus: null, detail: null }; },
      },
      missionTransitions: {
        async load() { return { kind: 'found' as const, mission, version: fixtureVersion(1) }; },
        async save(next: Mission) { mission = next; return fixtureVersion(2); }, async saveWithTransition(next: Mission) { mission = next; return fixtureVersion(2); },
      },
      telemetry: { async recordLaunchTelemetry() {} }, checkpointValidation: { async validateBeforeHandoff() { return { ok: true as const }; } }, handoffExecution: { async run() { return { ok: true as const }; }, async repairHygiene() { return { repaired: false }; }, classifyFailure() { return null; }, isRelaunchableFailure() { return false; } }, autonomousReview: { async start() {} }, repairLaunch: { async launch() { throw new Error('Unexpected repair launch'); }, available() { return { supported: false }; }, readHead() { return null; } }, output: { log() {}, error() {}, command(value: string) { return value; }, formatSlug(value: string) { return value; }, formatAgent(value: string) { return value; } },
    }).execute({
      operationId: 'active:task-2580', slug: 'task-2580', agent: 'codex', capabilities: new Set(['active:execute']),
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(mission.status, 'refined');
    assert.equal(mission.assignee, null);
  });
});

/**
 * TASK-2756 — an explicit operator `px active` is the supported resume action.
 *
 * The scenario is TASK-2751's restart deadlock: a harness-created repair
 * checkpoint (CP-6) keeps a human-only contract blocker in its `repair_json`
 * while the operator has already amended the recorded success criteria. The
 * Mission store is real (migrated SQLite), so the assertions read back exactly
 * what an operator's database holds after the run.
 */
describe('active operator resume', () => {
  const RESUME_SLUG = 'task-9102';
  const RESUME_MISSION_ID = missionId(RESUME_SLUG);
  const GATE = './scripts/verify-local.sh all';
  const PRIOR_BLOCKER = {
    command: GATE,
    diagnostic: 'The recorded budget criterion contradicts the declared gate, so the gate can never pass.',
    authorityReason: 'Success criteria are operator-owned; an implementer cannot rewrite them.',
    proposedCorrection: 'Amend the budget criterion to the ceiling the operator intends.',
  };
  const NEW_BLOCKER = {
    command: GATE,
    diagnostic: 'The amended criterion still names a gate this repository does not declare.',
    authorityReason: 'Declared gates are operator-owned.',
    proposedCorrection: 'Replace the gate with the repository-owned integration pipeline.',
  };

  /** CP-5 carries readable evidence; CP-6 is unfinished under a retained stop whose authorization is stale. */
  function resumeMission(): Mission {
    return {
      id: RESUME_MISSION_ID, repositoryId: repositoryId('repo'), title: 'Retained stop fixture',
      labels: [], assignee: null, status: 'active', rawStatus: 'active', closedAt: null,
      brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
      declaredGates: [GATE],
      successCriteria: ['The ceiling is 500 lines', 'The resume path is supported'],
      completedSuccessCriteria: [], dependencies: [],
      predictedNelBucket: 'Large', reproductionTest: null, externalTaskRef: null, intakeTrace: null,
      checkpoints: [
        { missionId: RESUME_MISSION_ID, name: 'CP-5', firstLine: 'CP-5: prior work', nextActionText: 'continue CP-6',
          goalCheck: [{ criterion: 'The ceiling is 500 lines', evidence: 'test/unit/application/mission-execute-service-contract.test.ts' }] },
        { missionId: RESUME_MISSION_ID, name: 'CP-6', firstLine: `Repair incident incident-1: ${GATE}`, nextActionText: 'record authorized repair evidence',
          goalCheck: [],
          repair: { incidentId: 'incident-1', command: GATE, authorizedGates: ['./scripts/verify-local.sh docs'],
            authorizedCriteria: ['No line ceiling applies to this mission'], attempt: 1, evidenceRecorded: false, verified: false,
            blocker: PRIOR_BLOCKER } },
      ],
      review: null, netEngineeringLines: null,
    } as unknown as Mission;
  }

  /** Real migrated operator database holding the Mission aggregate. */
  async function resumeStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-2756-active-resume-'));
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: path.join(dir, 'operator.db') });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(db);
    await store.save(resumeMission(), null);
    return {
      store,
      async read() {
        const loaded = await store.load(RESUME_MISSION_ID);
        if (loaded.kind !== 'found') { throw new Error(`fixture mission is ${loaded.kind}`); }
        return loaded.mission;
      },
      dispose: async () => {
        await store.drain();
        await db.close();
        fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  /**
   * Mechanism ports over the real store. `launch` stands in for the implementer
   * and records a fresh contract stop, which is how a genuinely new blocker
   * reaches the same repair checkpoint after a resume.
   */
  function resumePorts(store: SqliteMissionStore, launches: number[], stop = true, handoff: string[] = []): ExecuteMissionPorts {
    return {
      workspace: {
        async preflight() { return true; }, async resolveWorktree() { return `/tmp/wt-${RESUME_SLUG}`; },
        async resolveTaskFile() { return { ok: false }; }, async readTaskStatus() { return 'active'; }, async enforceCommitSafety() {},
      },
      agentExecution: {
        async prepare() { return { prompt: 'execute', agent: 'claude', agentConfig: {} }; },
        async launch() {
          launches.push(1);
          const loaded = await store.load(RESUME_MISSION_ID);
          assert.equal(loaded.kind, 'found');
          if (loaded.kind !== 'found') { throw new Error('missing mission'); }
          const repair = loaded.mission.checkpoints.find(cp => cp.name === 'CP-6')!.repair!;
          assert.equal(repair.blocker, undefined, 'the retained stop is cleared before implementer launch');
          assert.deepEqual(repair.authorizedCriteria, loaded.mission.successCriteria);
          assert.deepEqual(repair.authorizedGates, loaded.mission.declaredGates);
          assert.equal(loaded.mission.checkpoints.find(cp => cp.goalCheck.length === 0)?.name, 'CP-6');
          assert.equal(loaded.mission.checkpoints[0].goalCheck[0].evidence, 'test/unit/application/mission-execute-service-contract.test.ts');
          if (stop) { await new RepairCheckpointService(store).report({
            operationId: 'active-resume-report', missionId: RESUME_MISSION_ID, capabilities: new Set(['checkpoint:record']),
            name: 'CP-6', blocker: NEW_BLOCKER,
          }); }
          return { agent: 'claude', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
        },
      },
      missionTransitions: store,
      telemetry: { async recordLaunchTelemetry() {} },
      checkpointValidation: {
        async validateBeforeHandoff() {
          const mission = await (async () => { const loaded = await store.load(RESUME_MISSION_ID); return loaded.kind === 'found' ? loaded.mission : null; })();
          const blocker = mission?.checkpoints.find(cp => cp.repair?.blocker)?.repair?.blocker;
          return blocker
            ? { ok: false, humanOnlyContractBlocker: blocker, error: `Invalid locked contract requires human review: ${blocker.diagnostic}` }
            : { ok: true };
        },
      },
      handoffExecution: { async run() { handoff.push('declared gates'); return { ok: true }; }, async repairHygiene() { return { repaired: false }; }, classifyFailure() { return null; }, isRelaunchableFailure() { return false; } },
      autonomousReview: { async start() { handoff.push('independent review'); } },
      repairLaunch: { async launch() {}, available() { return { supported: false }; }, readHead() { return null; } },
      output: { log() {}, error() {}, command(value: string) { return value; }, formatSlug(value: string) { return value; }, formatAgent(value: string) { return value; } },
    } as unknown as ExecuteMissionPorts;
  }

  /** The real `px active` command against the real execute service and Mission store. */
  async function runOperatorActive(stop = true) {
    const fixture = await resumeStore();
    const logs: string[] = [];
    const errors: string[] = [];
    const exitCodes: number[] = [];
    const launches: number[] = [];
    const handoff: string[] = [];
    try {
      const service = new ExecuteMissionService(resumePorts(fixture.store, launches, stop, handoff), event => active.renderActiveProgress(event, message => logs.push(message)));
      await active([RESUME_SLUG], {
        operatorInvocation: true,
        inferSlugFn: () => RESUME_SLUG,
        service: { execute: (request: ExecuteMissionRequest) => service.execute(request) },
        rootDir: '/tmp/project-task-9102',
        exitFn: (code: number) => { exitCodes.push(code); },
        logFn: (message: string) => { logs.push(message); },
        errorFn: (message: string) => { errors.push(message); },
      });
      return { logs, errors, exitCodes, launches, handoff, mission: await fixture.read() };
    } finally {
      await fixture.dispose();
    }
  }

  test('TASK-2756 CP-1: explicit px active resumes CP-6, refreshes its authorization, and reports the stop as blocked', async () => {
    const run = await runOperatorActive();
    assert.equal(run.launches.length, 1, 'the operator resume reaches the implementer instead of stopping on the retained blocker');

    const cp6 = run.mission.checkpoints.find(cp => cp.name === 'CP-6');
    assert.ok(cp6?.repair, 'CP-6 keeps its harness-owned repair record');
    assert.deepEqual(cp6!.repair!.acknowledgedBlocker, PRIOR_BLOCKER, 'the prior blocker and its proposal stay readable');
    assert.equal(typeof cp6!.repair!.acknowledgedBy, 'string', 'the operator acknowledgment names its actor');
    assert.ok(cp6!.repair!.acknowledgedAt, 'the operator acknowledgment is timestamped');
    assert.deepEqual(cp6!.repair!.blocker, NEW_BLOCKER, 'only a blocker recorded after the resume stands as a live stop');
    assert.deepEqual([...(cp6!.repair!.authorizedCriteria ?? [])], run.mission.successCriteria, 'repair authorization follows the amended recorded criteria');
    assert.deepEqual([...(cp6!.repair!.authorizedGates ?? [])], run.mission.declaredGates, 'repair authorization follows the current declared gates');

    const cp5 = run.mission.checkpoints.find(cp => cp.name === 'CP-5');
    assert.deepEqual(cp5?.goalCheck.map(row => row.evidence), ['test/unit/application/mission-execute-service-contract.test.ts'], 'prior checkpoint evidence stays readable');
    assert.equal(run.mission.checkpoints.length, 2, 'the resume adds no checkpoint');
    assert.equal(cp6?.goalCheck.length, 0, 'the resume records no evidence');

    assert.ok(!run.logs.some(line => /Implementation complete/.test(line)), `a blocked run claims no completion: ${run.logs.join(' | ')}`);
    const blocked = [...run.logs, ...run.errors].filter(line => /amended criterion still names a gate/.test(line));
    assert.equal(blocked.length, 1, `the blocked reason is stated once: ${[...run.logs, ...run.errors].join(' | ')}`);
    assert.match(blocked[0], /Blocked/);
    assert.deepEqual(run.exitCodes, [1], 'the blocked run exits non-zero');
  });
  test('explicit resume preserves prior evidence and declared handoff plus independent review (TASK-2756)', async () => {
    const run = await runOperatorActive(false);
    assert.deepEqual(run.handoff, ['declared gates', 'independent review']);
    assert.deepEqual(run.exitCodes, []);
    assert.equal(run.launches.length, 1);
    assert.equal(run.mission.checkpoints.length, 2);
    assert.equal(run.mission.checkpoints[1].goalCheck.length, 0);
    assert.equal(run.mission.checkpoints[1].repair?.verified, false);
    assert.equal(run.mission.completedSuccessCriteria?.length, 0);
    assert.deepEqual(run.mission.checkpoints[0].goalCheck.map(row => ({ criterion: row.criterion, evidence: row.evidence })), resumeMission().checkpoints[0].goalCheck);
    assert.deepEqual(run.mission.declaredGates, [GATE]);
  });

  test('supervisor borrowed active command preserves the retained stop on both dispatch paths (TASK-2756 F1)', async () => {
    for (const throughController of [false, true]) {
      const fixture = await resumeStore();
      const launches: number[] = [];
      const errors: string[] = [];
      const exits: number[] = [];
      try {
        const before = await fixture.read();
        const service = new ExecuteMissionService(resumePorts(fixture.store, launches));
        await active([RESUME_SLUG], {
          inferSlugFn: () => RESUME_SLUG,
          ...(throughController ? { controller: new BoardCommandController(resumePorts(fixture.store, launches)) } : { service }),
          logFn() {}, errorFn: message => errors.push(message), exitFn: code => exits.push(code ?? 0),
        });
        assert.deepEqual(launches, [], 'recovery borrows active without operator authority');
        assert.deepEqual(exits, [1]);
        assert.match(errors.join(' '), /Blocked at CP-6: The recorded budget criterion/);
        assert.deepEqual((await fixture.read()).checkpoints, before.checkpoints);
      } finally { await fixture.dispose(); }
    }
  });

  test('automatic execute refuses a retained stop without launch or authorization changes (TASK-2756)', async () => {
    const fixture = await resumeStore();
    const launches: number[] = [];
    try {
      const before = await fixture.read();
      const result = await new ExecuteMissionService(resumePorts(fixture.store, launches)).execute({
        operationId: 'automatic-recovery', slug: RESUME_SLUG, capabilities: new Set(['active:execute']),
      });
      assert.equal(result.status, 'failed');
      assert.match(result.error?.message ?? '', /Blocked at CP-6: The recorded budget criterion/);
      assert.deepEqual(launches, []);
      assert.deepEqual((await fixture.read()).checkpoints, before.checkpoints);
    } finally { await fixture.dispose(); }
  });

});
