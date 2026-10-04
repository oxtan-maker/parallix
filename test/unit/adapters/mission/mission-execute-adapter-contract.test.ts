// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
// Mission execute adapter contract: agent execution adapters and characterization of the execute
// launch path through the real adapters.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Execute Mission adapters: no task ID in the legacy file
//   Execute Mission characterization: no task ID in the legacy file

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { setCommandPathProbe, setLauncherHealthProbe } from '../../../../src/adapters/agents/agents.js';
import { createExecuteMissionPorts, MissionWorkspaceAdapter, AgentExecutionAdapter, ExecuteTelemetryAdapter } from '../../../../src/adapters/mission/execute-mission-adapters.js';
import { ExecuteMissionService } from '../../../../src/application/execute-mission-service.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

// no task ID in the legacy file (was test/execute-mission-adapters.test.ts)
describe('Execute Mission adapters', () => {
  // @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up

  // Adapter-level contract for the execute mechanism set. The workflow ordering
  // itself is covered by the Execute Mission characterization section of this suite, which
  // drives these same adapters end to end.
  function runtimeStub(overrides: Record<string, unknown> = {}) {
    return {
      preflight() { return { pass: true }; },
      resolveWorktree() { return '/worktree'; },
      resolveTaskFile() { return { ok: true, taskFile: '/worktree/task.md' }; },
      buildCheckpointContext() { return 'CP-5'; },
      async resolveExecutionContext() { return null; },
      readAgentConfig() { return { steps: ['active'] }; },
      buildExecutePrompt() { return 'execute prompt'; },
      async selectLaunchAndRecord() { return { agent: 'codex', result: { status: 0 }, rebaseDeferred: false }; },
      enforceExecuteCommitSafety() {},
      getTaskStatus() { return 'active'; },
      recordActiveStats() {},
      resolveAgentModel() { return 'gpt-5'; },
      resolveStageTelemetry() { return null; },
      async validateCheckpointsBeforeHandoff() { return { ok: true }; },
      async performHandoff() { return { ok: true }; },
      async repairHandoff() { return { repaired: false }; },
      // The review loop itself is not exercised here: a held controller fence
      // makes the application loop decline immediately.
      reviewLoopMechanisms: () => fakeReviewLoopPorts({ lock: { tryAcquire: () => false, release: () => {} } }).ports,
      ...overrides,
    };
  }

  const transitionStore = {
    async load() { return { kind: 'missing' }; },
    async save() { return 1; },
    async saveWithTransition() { return 1; },
  };

  test('execute mission ports use the injected mission transition store identity', () => {
    const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub());
    assert.strictEqual(ports.missionTransitions, transitionStore);
  });

  test('execute mission ports refuse construction without a mission transition store', () => {
    assert.throws(
      () => createExecuteMissionPorts('/repo', {} as never, runtimeStub()),
      { message: 'composition must supply a mission transition store' },
    );
  });

  test('each execute mechanism port is a distinct narrow adapter', () => {
    const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub());
    assert.ok(ports.workspace instanceof MissionWorkspaceAdapter);
    assert.ok(ports.agentExecution instanceof AgentExecutionAdapter);
    assert.ok(ports.telemetry instanceof ExecuteTelemetryAdapter);
    assert.ok(ports.checkpointValidation);
    assert.ok(ports.handoffExecution);
    assert.ok(ports.autonomousReview);
  });

  test('workspace adapter runs the execute preflight quiet (routine PASS diagnostics suppressed)', async () => {
    let capturedOpts;
    const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
      // missionStart([slug], { returnResult, quiet }) — options are the 2nd arg.
      preflight() { capturedOpts = arguments[1]; return { pass: true }; },
    }));
    assert.equal(await ports.workspace.preflight('task-1'), true);
    assert.equal(capturedOpts.returnResult, true);
    assert.equal(capturedOpts.quiet, true, 'active preflight must be quiet so the operator story leads with mission/implementer');
  });

  test('workspace preflight delegates worktree resolution to the preflight mechanism', async () => {
    let capturedOpts;
    const ports = createExecuteMissionPorts('/lead-worktree', { missionTransitionStore: transitionStore }, runtimeStub({
      preflight() { capturedOpts = arguments[1]; return { pass: true }; },
    }));
    await ports.workspace.preflight('task-1');
    assert.equal(capturedOpts.returnResult, true);
    assert.equal(capturedOpts.quiet, true, 'active preflight must be quiet so the operator story leads with mission/implementer');
    // The mission worktree the preflight validates against is resolved inside
    // the preflight mechanism (startupPreflight) from the slug, so the adapter
    // stays a single quiet port call with no worktree-scoped callbacks.
    assert.equal(typeof capturedOpts.cwdFn, 'undefined', 'worktree resolution lives in the preflight mechanism');
    assert.equal(typeof capturedOpts.getCurrentBranchFn, 'undefined');
    assert.equal(typeof capturedOpts.findMissionDirFn, 'undefined');
  });

  test('workspace adapter maps a failed preflight and an unresolved worktree to falsy verdicts', async () => {
    const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
      preflight() { return { pass: false }; },
      resolveWorktree() { return undefined; },
    }));
    assert.equal(await ports.workspace.preflight('task-1'), false);
    assert.equal(await ports.workspace.resolveWorktree('task-1'), null);
  });

  test('agent execution adapter overlays the operator blocklist onto the file agent config', async () => {
    const blocklist = { codex: { until: '2026-08-01T00:00:00Z' } };
    const ports = createExecuteMissionPorts(
      '/repo',
      { missionTransitionStore: transitionStore, operatorBlocklist: blocklist },
      runtimeStub({
        async selectLaunchAndRecord(opts: { agentConfig: Record<string, unknown> }) {
          return { agent: 'codex', result: { status: 0, agentConfig: opts.agentConfig }, rebaseDeferred: false };
        },
      }),
    );
    const plan = await ports.agentExecution.prepare({ slug: 'task-1', worktree: '/worktree' });
    assert.deepEqual(plan.agentConfig, { steps: ['active'], blocklist });
    assert.equal(plan.prompt, 'execute prompt');
  });

  test('agent execution adapter consumes the recorded brief and gates for launch', async () => {
    const brief = {
      goal: 'Persist the mission brief', why: 'Restart-safe launch needs it.',
      scope: 'Mission aggregate only.', outOfScope: ['A document blob'],
    };
    const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
      async resolveExecutionContext() {
        return { brief, declaredGates: ['./scripts/verify-local.sh all'], latestCheckpoint: null };
      },
      buildExecutePrompt(_slug: string, launchContext: string) { return `prompt:${launchContext}`; },
    }));
    const plan = await ports.agentExecution.prepare({ slug: 'task-1', worktree: '/worktree' });
    assert.match(plan.prompt, /Recorded mission state/);
    assert.match(plan.prompt, /Mission goal: Persist the mission brief/);
    assert.match(plan.prompt, /Out of scope: A document blob/);
    assert.match(plan.prompt, /Declared gates: \.\/scripts\/verify-local\.sh all/);
  });

  test('agent execution adapter falls back to the checkpoint context when no brief is recorded', async () => {
    const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
      async resolveExecutionContext() { return null; },
      buildExecutePrompt(_slug: string, launchContext: string) { return `prompt:${launchContext}`; },
    }));
    const plan = await ports.agentExecution.prepare({ slug: 'task-1', worktree: '/worktree' });
    assert.match(plan.prompt, /prompt:CP-5/);
  });

  test('agent execution adapter launches without MISSION.md or checkpoint files when a brief is recorded', async () => {
    // buildCheckpointContext would normally read checkpoint files; the recorded
    // path must make launch succeed with no file round trip. resolveExecutionContext
    // resolves from the store, so no mission dir is required.
    const brief = {
      goal: 'Resume without files', why: 'Recorded facts are authoritative.',
      scope: 'Aggregate only.', outOfScope: [],
    };
    const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
      async resolveExecutionContext() { return { brief, declaredGates: [], latestCheckpoint: null }; },
      buildCheckpointContext() { throw new Error('must not read checkpoint files when context is persisted'); },
      buildExecutePrompt(_slug: string, launchContext: string) { return `prompt:${launchContext}`; },
    }));
    const plan = await ports.agentExecution.prepare({ slug: 'task-1', worktree: '/worktree' });
    assert.match(plan.prompt, /Mission goal: Resume without files/);
  });

  test('agent execution adapter leaves the file agent config untouched without a blocklist overlay', async () => {
    const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub());
    const plan = await ports.agentExecution.prepare({ slug: 'task-1', worktree: '/worktree' });
    assert.deepEqual(plan.agentConfig, { steps: ['active'] });
  });

  test('agent execution adapter selects before launch without probing a launcher', async () => {
    setCommandPathProbe(() => '/bin/true');
    setLauncherHealthProbe(() => { throw new Error('prepare must not probe a launcher'); });
    try {
      const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
        readAgentConfig() { return { steps: { active: { eligible: ['codex'], selection: 'first' } } }; },
      }));
      assert.equal((await ports.agentExecution.prepare({ slug: 'task-1', worktree: '/worktree' })).agent, 'codex');
    } finally {
      setCommandPathProbe(null);
      setLauncherHealthProbe(null);
    }
  });

  test('agent execution adapter reports launcher errors and exit status as raw facts', async () => {
    const errored = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
      async selectLaunchAndRecord() { return { agent: 'codex', result: { error: new Error('launcher exploded') }, rebaseDeferred: false }; },
    }));
    const failedLaunch = await errored.agentExecution.launch({
      slug: 'task-1', worktree: '/worktree', plan: { prompt: 'p', agentConfig: {} },
      taskResolution: { ok: true, taskFile: '/worktree/task.md' }, preselectedAgent: 'codex',
    });
    assert.equal(failedLaunch.errored, true);
    assert.equal(failedLaunch.errorMessage, 'launcher exploded');
    assert.equal(failedLaunch.exitStatus, null);

    const nonZero = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
      async selectLaunchAndRecord() { return { agent: 'codex', result: { status: 7 }, rebaseDeferred: true }; },
    }));
    const statusLaunch = await nonZero.agentExecution.launch({
      slug: 'task-1', worktree: '/worktree', plan: { prompt: 'p', agentConfig: {} },
      taskResolution: { ok: true, taskFile: '/worktree/task.md' }, preselectedAgent: 'codex',
    });
    assert.equal(statusLaunch.errored, false);
    assert.equal(statusLaunch.errorMessage, null);
    assert.equal(statusLaunch.exitStatus, 7);
    assert.equal(statusLaunch.rebaseDeferred, true);
  });

  test('telemetry adapter derives the stage window and duration from the launch detail', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const windows: Array<Record<string, unknown>> = [];
    const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
      recordActiveStats(record: Record<string, unknown>) { recorded.push(record); },
      resolveStageTelemetry(options: Record<string, unknown>) { windows.push(options); return null; },
    }));
    await ports.telemetry.recordLaunchTelemetry({
      slug: 'task-1',
      worktree: '/worktree',
      agent: 'codex',
      launch: {
        agent: 'codex', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0,
        detail: { startedAt: '2026-07-20T10:00:00Z', endedAt: '2026-07-20T10:03:00Z' },
      },
    });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].implementer, 'codex');
    assert.equal(recorded[0].model, 'gpt-5');
    assert.equal(recorded[0].durationMinutes, 3);
    assert.equal(windows[0].sinceMs, Date.parse('2026-07-20T10:00:00Z'));
  });

  test('typed handoff adapter forwards the resolved task file and returns the pipeline verdict', async () => {
    const seen: Array<unknown[]> = [];
    const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
      async performHandoff(...args: unknown[]) { seen.push(args); return { ok: false }; },
    }));
    const onAgentLaunched = async () => {};
    const onAutonomousStop = async () => {};
    const verdict = await ports.handoffExecution.run({ slug: 'task-1', worktree: '/worktree', agent: 'codex' });
    assert.equal(verdict.ok, false);
    assert.deepEqual(seen[0], [
      'task-1', { forgejoUser: 'codex', worktree: '/worktree', force: undefined },
    ]);
  });
});

// no task ID in the legacy file (was test/execute-mission-characterization.test.ts)
describe('Execute Mission characterization', () => {
  // @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up

  // Characterization suite for the execute (`px active`) workflow.
  //
  // Every assertion below describes observable behavior of the workflow, not of
  // a particular class. `buildExecuteWorkflow` is the ONLY construction-aware
  // part of this file: TASK-2332.04 moves the sequencing from
  // `LegacyActiveAdapter` into an application-owned `ExecuteMission` use case,
  // and the contract of that move is that only this factory changes while every
  // expectation below stays byte-identical.
  function buildExecuteWorkflow(
    runtime: Record<string, unknown>,
    missionTransitionStore: unknown,
    progress?: (_event: unknown) => void,
  ) {
    return new ExecuteMissionService(
      createExecuteMissionPorts('/repo', { missionTransitionStore }, runtime),
      progress,
    );
  }

  // ---------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------

  function executeFixture(overrides: Record<string, unknown> = {}) {
    const calls: string[] = [];
    const transitionStore = {
      async load() {
        calls.push('load');
        return {
          kind: 'found',
          version: 3,
          mission: {
            id: 'task-1', repositoryId: 'repo', title: 'Fixture', labels: [],
            assignee: null, checkpoints: [{ missionId: 'task-1', name: 'CP-1', firstLine: 'Do the work', goalCheck: [], nextActionText: '' }], review: null, netEngineeringLines: null,
            // Activation refuses an incomplete contract, so a refined fixture
            // carries the goal, scope and gate draft settles.
            brief: { goal: 'Fixture goal', why: 'Fixture why', scope: 'Fixture scope', outOfScope: [] },
            declaredGates: ['npm test'],
            successCriteria: ['The mission is done'],
            predictedNelBucket: 'Small',
            status: 'refined', closedAt: null,
          },
        };
      },
      async save(_mission: unknown, expectedVersion: number) { calls.push('synchronize'); return expectedVersion + 1; },
      async saveWithTransition(_mission: unknown, expectedVersion: number) { calls.push('synchronize'); return expectedVersion + 1; },
    };
    const runtime = {
      preflight() { calls.push('preflight'); return { pass: true }; },
      resolveWorktree() { calls.push('worktree'); return '/worktree'; },
      resolveTaskFile() { calls.push('task'); return { ok: true, taskFile: '/worktree/backlog/tasks/task-1.md' }; },
      async resolveExecutionContext() { return null; },
      buildCheckpointContext() { calls.push('checkpoint'); return 'CP-5'; },
      readAgentConfig() { calls.push('config'); return {}; },
      buildExecutePrompt() { calls.push('prompt'); return 'execute prompt'; },
      async selectLaunchAndRecord(opts: { preselectedAgent?: string | null }) {
        calls.push(`launch-record:${opts.preselectedAgent ?? 'default'}`);
        return {
          agent: 'codex',
          result: { status: 0, startedAt: '2026-07-20T10:00:00Z', endedAt: '2026-07-20T10:01:00Z' },
          rebaseDeferred: true,
        };
      },
      enforceExecuteCommitSafety() { calls.push('safety'); },
      getTaskStatus() { calls.push('status'); return 'active'; },
      recordActiveStats(record: { implementer: string }) { calls.push(`stats:${record.implementer}`); },
      resolveAgentModel() { calls.push('model'); return 'gpt-5'; },
      resolveStageTelemetry() { calls.push('telemetry'); return null; },
      async validateCheckpointsBeforeHandoff() { return { ok: true }; },
      async performHandoff(slug: string, options: { worktree: string; forgejoUser: string }) {
        calls.push(`handoff:${slug}:${options.worktree}:${options.forgejoUser}`);
        return { ok: true };
      },
      async repairHandoff() { return { repaired: false }; },
      // The review loop itself is not exercised here: a held controller fence
      // makes the application loop decline immediately.
      reviewLoopMechanisms: () => fakeReviewLoopPorts({ lock: { tryAcquire: () => false, release: () => {} } }).ports,
      ...overrides,
    };
    return { runtime, calls, transitionStore };
  }

  function executeRequest(overrides: Record<string, unknown> = {}) {
    return {
      operationId: 'active:task-1',
      slug: 'task-1',
      agent: 'codex',
      capabilities: new Set(['active:execute']),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // Scenario 1 — `active` success
  // ---------------------------------------------------------------------------

  test('execute workflow: activation precedes launch, record, telemetry, and handoff', async () => {
    const { runtime, calls, transitionStore } = executeFixture();
    const events: Array<{ sequence: number; phase: string; agent?: string }> = [];
    const outcome = await buildExecuteWorkflow(runtime, transitionStore, (event) =>
      events.push(event as { sequence: number; phase: string })).execute(executeRequest());

    assert.equal(outcome.status, 'completed');
    assert.deepEqual(outcome.value, { agent: 'codex' });
    assert.deepEqual(calls, [
      'preflight', 'worktree', 'task', 'checkpoint', 'config', 'prompt', 'load', 'synchronize',
      'launch-record:codex', 'safety',
      'model', 'telemetry', 'stats:codex',
      'handoff:task-1:/worktree:codex',
    ]);
    assert.equal(outcome.durableEvidence.length, 2);
    assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
    assert.deepEqual(events.map((event) => event.phase), ['launch', 'record', 'handoff']);
    assert.equal(events[2].agent, 'codex');
  });

  test('execute workflow: real launch adapter retains the active mirror after a started-agent failure', async () => {
    const { runtime, transitionStore } = executeFixture({
      async selectLaunchAndRecord(opts: { authorityAlreadyActive?: boolean }) {
        assert.equal(opts.authorityAlreadyActive, true);
        return { agent: 'codex', result: { status: 19 }, rebaseDeferred: true };
      },
    });
    const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.error?.message ?? '', /exited with status 19/);
  });

  test('execute workflow: telemetry failure cannot fail a launch', async () => {
    const { runtime, calls, transitionStore } = executeFixture({
      recordActiveStats() { calls.push('stats'); throw new Error('stats writer unavailable'); },
    });
    const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
    assert.equal(outcome.status, 'completed');
    assert.ok(calls.includes('stats'));
    assert.ok(calls.includes('handoff:task-1:/worktree:codex'));
  });

  test('execute workflow: an already-active task still synchronizes the Mission authority', async () => {
    const { runtime, calls, transitionStore } = executeFixture({
      async selectLaunchAndRecord() {
        calls.push('launch-record:codex');
        return { agent: 'codex', result: { status: 0 }, rebaseDeferred: false };
      },
    });
    const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
    assert.equal(outcome.status, 'completed');
    assert.equal(calls.includes('load'), true);
    assert.equal(calls.includes('synchronize'), true);
  });

  test('execute workflow: lifecycle synchronization fails closed when the Mission authority refuses activation', async () => {
    const { runtime, calls } = executeFixture();
    const missingStore = {
      async load() { calls.push('load'); return { kind: 'missing' }; },
      async save() { calls.push('synchronize'); return 1; },
      async saveWithTransition() { calls.push('synchronize'); return 1; },
    };
    const outcome = await buildExecuteWorkflow(runtime, missingStore).execute(executeRequest());
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.error.kind, 'execution');
    assert.match(outcome.error.message ?? '', /^legacy task lifecycle synchronization failed: /);
    assert.equal(calls.includes('synchronize'), false);
    assert.equal(calls.some((call) => call.startsWith('handoff:')), false);
  });

  // ---------------------------------------------------------------------------
  // Scenario 2 — agent fallback / relaunch retry
  // ---------------------------------------------------------------------------

  test('execute workflow: an agent fallback is reported, recorded, and handed off as the agent that actually ran', async () => {
    const { runtime, calls, transitionStore } = executeFixture({
      async selectLaunchAndRecord(opts: { preselectedAgent?: string | null }) {
        calls.push(`launch-record:${opts.preselectedAgent ?? 'default'}`);
        return { agent: 'claude', result: { status: 0 }, rebaseDeferred: true };
      },
    });
    const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(outcome.value, { agent: 'claude' });
    assert.ok(calls.includes('stats:claude'));
    assert.ok(calls.includes('handoff:task-1:/worktree:claude'));
  });

  test('execute workflow: a handoff relaunch retry that recovers still completes the launch', async () => {
    let handoffAttempts = 0;
    const { runtime, calls, transitionStore } = executeFixture({
      async performHandoff(slug: string, options: { worktree: string; forgejoUser: string }) {
        handoffAttempts++;
        calls.push(`handoff:${slug}:${options.worktree}:${options.forgejoUser}`);
        // The relaunch/retry loop lives inside the handoff mechanism; the
        // workflow observes only its final boolean verdict.
        return { ok: handoffAttempts >= 1 };
      },
    });
    const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
    assert.equal(outcome.status, 'completed');
    assert.equal(handoffAttempts, 1);
  });

  // ---------------------------------------------------------------------------
  // Scenario 3 — handoff-and-review failure
  // ---------------------------------------------------------------------------

  test('execute workflow: handoff-and-review failure surfaces as an execution failure after durable evidence', async () => {
    const { runtime, calls, transitionStore } = executeFixture({
      async performHandoff() { calls.push('handoff'); return { ok: false, error: 'handoff rejected' }; },
    });
    const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.error.kind, 'execution');
    assert.equal(outcome.error.message, 'handoff and review failed');
    assert.ok(calls.includes('safety'));
    assert.ok(calls.includes('stats:codex'));
  });

  // ---------------------------------------------------------------------------
  // Scenario 4 — non-zero agent exit status / launcher error
  // ---------------------------------------------------------------------------

  test('execute workflow: a non-zero agent exit status stops after pre-launch activation and before safety, telemetry, and handoff', async () => {
    const { runtime, calls, transitionStore } = executeFixture({
      async selectLaunchAndRecord() {
        calls.push('launch-record:codex');
        return { agent: 'codex', result: { status: 23 }, rebaseDeferred: false };
      },
    });
    const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.error.kind, 'execution');
    assert.equal(outcome.error.message, 'Execute agent (codex) exited with status 23.');
    assert.deepEqual(calls, [
      'preflight', 'worktree', 'task', 'checkpoint', 'config', 'prompt', 'load', 'synchronize', 'launch-record:codex', 'load', 'synchronize',
    ]);
  });

  test('execute workflow: a launcher error reports the agent family and the launcher message', async () => {
    const { runtime, calls, transitionStore } = executeFixture({
      async selectLaunchAndRecord() {
        calls.push('launch-record:codex');
        return { agent: 'codex', result: { error: new Error('launcher exploded') }, rebaseDeferred: false };
      },
    });
    const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.error.message, 'Could not start execute agent (codex): launcher exploded');
    assert.equal(calls.includes('safety'), false);
  });

  // ---------------------------------------------------------------------------
  // Scenario 5 — cancellation before launch
  // ---------------------------------------------------------------------------

  test('execute workflow: cancellation before launch touches no mechanism port', async () => {
    const { runtime, calls, transitionStore } = executeFixture();
    const outcome = await buildExecuteWorkflow(runtime, transitionStore)
      .execute(executeRequest({ cancellation: { requested: true } }));
    assert.equal(outcome.status, 'cancelled');
    assert.equal(outcome.error.message, 'cancelled before launch');
    assert.deepEqual(calls, []);
  });

  // ---------------------------------------------------------------------------
  // Scenario 6 — cancellation after durable launch
  // ---------------------------------------------------------------------------

  test('execute workflow: cancellation after durable launch keeps both evidence records and skips handoff', async () => {
    const cancellation = { requested: false };
    const { runtime, calls, transitionStore } = executeFixture({
      recordActiveStats(record: { implementer: string }) {
        calls.push(`stats:${record.implementer}`);
        cancellation.requested = true;
      },
    });
    const outcome = await buildExecuteWorkflow(runtime, transitionStore)
      .execute(executeRequest({ cancellation }));
    assert.equal(outcome.status, 'cancelled');
    assert.equal(outcome.error.message, 'cancelled after durable launch; re-query task state');
    assert.equal(outcome.durableEvidence.length, 2);
    assert.equal(calls.some((call) => call.startsWith('handoff:')), false);
  });

  // ---------------------------------------------------------------------------
  // Scenario 7 — preflight failure
  // ---------------------------------------------------------------------------

  test('execute workflow: preflight failure rejects with "execute preflight failed" before worktree resolution', async () => {
    const { runtime, calls, transitionStore } = executeFixture({
      preflight() { calls.push('preflight'); return { pass: false }; },
    });
    const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.error.kind, 'validation');
    assert.equal(outcome.error.message, 'execute preflight failed');
    assert.deepEqual(calls, ['preflight']);
  });

  // ---------------------------------------------------------------------------
  // Scenario 8 — missing dedicated worktree
  // ---------------------------------------------------------------------------

  test('execute workflow: a missing dedicated worktree rejects with "dedicated execute worktree is required"', async () => {
    const { runtime, calls, transitionStore } = executeFixture({
      resolveWorktree() { calls.push('worktree'); return null; },
    });
    const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.error.kind, 'validation');
    assert.equal(outcome.error.message, 'dedicated execute worktree is required');
    assert.deepEqual(calls, ['preflight', 'worktree']);
  });

  // ---------------------------------------------------------------------------
  // Request guards
  // ---------------------------------------------------------------------------

  test('execute workflow: an unrecognized slug is rejected before preflight', async () => {
    const { runtime, calls, transitionStore } = executeFixture();
    const outcome = await buildExecuteWorkflow(runtime, transitionStore)
      .execute(executeRequest({ slug: 'mission-1' }));
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.error.message, 'slug is not a recognized mission identity');
    assert.deepEqual(calls, []);
  });

  test('execute workflow: a DB-owned adhoc identity is accepted, not refused by a task- prefix assumption', async () => {
    const { runtime, calls, transitionStore } = executeFixture();
    const outcome = await buildExecuteWorkflow(runtime, transitionStore)
      .execute(executeRequest({ slug: 'parallix-adhoc-0001' }));
    assert.equal(outcome.status, 'completed');
    assert.ok(calls.includes('preflight'), 'adhoc identity must reach preflight via the shared validator');
  });

  test('execute workflow: a request without active:execute is rejected before any mechanism port', async () => {
    const { runtime, calls, transitionStore } = executeFixture();
    const outcome = await buildExecuteWorkflow(runtime, transitionStore)
      .execute(executeRequest({ capabilities: new Set() }));
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.error.kind, 'capability');
    assert.deepEqual(calls, []);
  });

  test('execute workflow: a request without an operationId or slug is rejected as invalid', async () => {
    const { runtime, calls, transitionStore } = executeFixture();
    const outcome = await buildExecuteWorkflow(runtime, transitionStore)
      .execute(executeRequest({ operationId: '' }));
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.error.kind, 'validation');
    assert.deepEqual(calls, []);
  });

  // ---------------------------------------------------------------------------
  // Workflow state is carried explicitly, not held per slug inside a port
  // ---------------------------------------------------------------------------

  test('execute workflow: two concurrent slugs each resolve their own worktree and handoff', async () => {
    const first = executeFixture();
    const second = executeFixture({
      resolveWorktree() { second.calls.push('worktree'); return '/other-worktree'; },
    });
    const [outcomeA, outcomeB] = await Promise.all([
      buildExecuteWorkflow(first.runtime, first.transitionStore).execute(executeRequest()),
      buildExecuteWorkflow(second.runtime, second.transitionStore).execute(executeRequest({ slug: 'task-2' })),
    ]);
    assert.equal(outcomeA.status, 'completed');
    assert.equal(outcomeB.status, 'completed');
    assert.ok(first.calls.includes('handoff:task-1:/worktree:codex'));
    assert.ok(second.calls.includes('handoff:task-2:/other-worktree:codex'));
  });
});
