// TASK-2582 CP-5 — regression coverage for lifecycle transition ordering,
// with external boundaries (the agent run) mocked and made slow.
//
// The companion coverage this file relies on:
//   - multi-round review: test/task-2582-repro.test.ts
//   - approval replay without duplicate lane events:
//     test/task-2582-repro.test.ts 'approval replay emits no duplicate lane event',
//     test/task-2456-handoff-retry-duplicate-lane-event.test.ts
//   - stale versions never overwriting state:
//     test/task-2322-05-mission-use-cases.test.ts 'SC2: a stale expected
//     version is refused before the domain decides' and 'SC2: a stale write
//     raised by the store surfaces as a conflict'
//   - done only after all integration work succeeds:
//     test/integration-mode-dispatch-contract.test.ts (decideIntegration requires
//     fresh merged Git and passing verification facts)
//   - resume/recovery: test/integrate-lifecycle-recovery-and-closeout-contract.test.ts,
//     test/task-2420-integrate-recovery-assigned-reviewer.test.ts,
//     test/recover-command.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';

import { agentFamily } from '../src/domain/agents.js';
import { missionId, type Mission } from '../src/domain/mission.js';
import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import type { ExecuteMissionPorts } from '../src/application/ports/execute-mission.js';
import { fixtureMission } from './fixtures/mission-builders.js';
import { openMigratedMissionStore, type MigratedMissionStore } from './fixtures/mission-sqlite-store.js';

const SLUG = 'task-2582-ordering';
const AGENT = agentFamily('claude');
const FALLBACK_AGENT = agentFamily('codex');

/** A refined mission carrying the full drafted contract: activatable. */
function seedMission(): Mission {
  return fixtureMission(SLUG, {
    status: 'refined',
    brief: { goal: 'Goal', why: 'Why', scope: 'Scope', outOfScope: [] },
    declaredGates: ['npm test'],
    successCriteria: ['The mission is done'],
    predictedNelBucket: 'Small',
  });
}

interface Fixture extends MigratedMissionStore {
  /** Inert mechanism ports over the real mission store. */
  readonly ports: ExecuteMissionPorts;
}

async function openFixture(
  launch: (_request: { onAgentChanged?: (_agent: string) => Promise<void> }) => Promise<{
    agent: string; rebaseDeferred: boolean; errored: boolean; errorMessage: string | null; exitStatus: number | null; detail: unknown;
  }>,
  mission: Mission = seedMission(),
): Promise<Fixture> {
  const migrated = await openMigratedMissionStore([mission]);
  const { store } = migrated;
  const ports = {
    workspace: {
      async preflight() { return true; },
      async resolveWorktree() { return '/worktree'; },
      async resolveTaskFile() { return { ok: false }; },
      async readTaskStatus() { return null; },
      async enforceCommitSafety() {},
    },
    agentExecution: {
      async prepare() { return { prompt: 'execute', agentConfig: {} }; },
      launch,
    },
    // The real mission store: the authoritative boundary under test.
    missionTransitions: store as unknown as ExecuteMissionPorts['missionTransitions'],
    telemetry: { async recordLaunchTelemetry() {} },
    handoffReview: { async runHandoffAndReview() { return true; } },
  } as unknown as ExecuteMissionPorts;
  return { ...migrated, ports };
}

/** Bounded wait on an observable condition (explicit synchronization, no sleeps). */
async function until(condition: () => boolean, what: string, milliseconds = 5_000): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (!condition()) {
    if (Date.now() >= deadline) { throw new Error(`timed out waiting for ${what}`); }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('a slow downstream agent run does not delay the active transition', async () => {
  let releaseAgent: () => void = () => {};
  const agentGate = new Promise<void>((resolve) => { releaseAgent = resolve; });
  let launchEntered = false;
  const { store, ports, laneEvents, close } = await openFixture(async (request) => {
    launchEntered = true;
    // Activation is committed before the launcher enters provider work.
    assert.equal(request.onAgentChanged instanceof Function, true);
    await agentGate;
    return { agent: AGENT, rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
  });
  try {
    const service = new ExecuteMissionService(ports);
    const pending = service.execute({
      operationId: `active:${SLUG}:ordering`,
      slug: SLUG,
      agent: 'claude',
      capabilities: new Set(['active:execute']),
    } as never);

    await until(() => launchEntered, 'the launch to confirm');
    // Downstream work is still running: the committed boundary must already
    // be in the operator database with its lane event.
    const loaded = await store.load(missionId(SLUG));
    assert.equal(loaded.kind, 'found');
    assert.equal(loaded.kind === 'found' ? loaded.mission.status : null, 'active',
      'the destination state commits at the boundary, before the slow work finishes');
    const events = await laneEvents(SLUG);
    assert.deepEqual(events, [{ from_status: 'refined', to_status: 'active', trigger: 'activate' }]);
    releaseAgent();
    const outcome = await pending;
    assert.equal(outcome.status, 'completed');
  } finally {
    releaseAgent();
    await close();
  }
});

test('a fallback relaunch re-asserts the active boundary with no second lane event', async () => {
  const boundaryAgents: string[] = [];
  const { store, ports, laneEvents, close } = await openFixture(async (request) => {
    // The launch was pre-activated for the selected family. After a usage
    // block, the replacement family updates the authoritative assignee.
    if (request.onAgentChanged) {
      boundaryAgents.push(AGENT);
      await request.onAgentChanged(AGENT);
      boundaryAgents.push(FALLBACK_AGENT);
      await request.onAgentChanged(FALLBACK_AGENT);
    }
    return { agent: FALLBACK_AGENT, rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
  });
  try {
    const outcome = await new ExecuteMissionService(ports).execute({
      operationId: `active:${SLUG}:fallback`,
      slug: SLUG,
      agent: 'claude',
      capabilities: new Set(['active:execute']),
    } as never);
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(boundaryAgents, [AGENT, FALLBACK_AGENT]);

    const loaded = await store.load(missionId(SLUG));
    assert.equal(loaded.kind, 'found');
    assert.equal(loaded.kind === 'found' ? loaded.mission.status : null, 'active');
    assert.equal(loaded.kind === 'found' ? loaded.mission.assignee : null, FALLBACK_AGENT,
      'the assignee is the family that actually ran');
    // Activation is idempotent on an active lane: the failover re-assert must
    // not invent a second lane event.
    const events = await laneEvents(SLUG);
    assert.deepEqual(events, [{ from_status: 'refined', to_status: 'active', trigger: 'activate' }]);
  } finally {
    await close();
  }
});


test('an immediate activation blocker stops before launching the agent', async () => {
  let launched = false;
  const { store, ports, laneEvents, close } = await openFixture(async () => {
    launched = true;
    return { agent: AGENT, rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
  }, { ...seedMission(), status: 'backlog', rawStatus: 'backlog' } as Mission);
  try {
    const outcome = await new ExecuteMissionService(ports).execute({
      operationId: `active:${SLUG}:blocked`, slug: SLUG, agent: 'claude',
      capabilities: new Set(['active:execute']),
    } as never);
    assert.equal(outcome.status, 'failed');
    assert.equal(launched, false);
    const loaded = await store.load(missionId(SLUG));
    assert.equal(loaded.kind === 'found' ? loaded.mission.status : null, 'backlog');
    assert.deepEqual(await laneEvents(SLUG), []);
  } finally { await close(); }
});
