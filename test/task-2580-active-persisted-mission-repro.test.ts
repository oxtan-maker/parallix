import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import { projectMissionCard } from '../src/application/projections/mission-board.js';
import { makeProjection } from './fixtures/board-projection.js';
import { validateWebBoardSnapshot } from '../src/interfaces/web/transport.js';
import { createWebHost, WEB_SNAPSHOT_PATH } from '../src/interfaces/web/host.js';
import type { ExecuteMissionPorts } from '../src/application/ports/execute-mission.js';
import type { Mission } from '../src/domain/mission.js';
import { recoverMissionLifecycle } from '../src/application/mission-lifecycle-recovery.js';
import { MissionCardView } from '../web/src/mission-card.js';
import active from '../src/adapters/cli/commands/active.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('px active delivers an active web card before its held agent completes', async () => {
  let mission: Mission = {
    id: 'task-2580', repositoryId: 'repo', title: 'Fixture', labels: [], assignee: null,
    checkpoints: [{ missionId: 'task-2580', name: 'CP-1', firstLine: 'test', goalCheck: [], nextActionText: '' }],
    review: null, netEngineeringLines: null,
    brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] }, declaredGates: ['npm test'],
    successCriteria: ['done'], predictedNelBucket: 'Small', status: 'refined', closedAt: null,
  } as unknown as Mission;
  const started = deferred();
  const finish = deferred();
  const ports = {
    workspace: {
      async preflight() { return true; }, async resolveWorktree() { return '/worktree'; },
      async resolveTaskFile() { return { ok: false }; },
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
      async load() { return { kind: 'found' as const, version: 1, mission }; },
      async save(next: Mission) { mission = next; return 2; },
      async saveWithTransition(next: Mission) { mission = next; return 2; },
    },
    telemetry: { async recordLaunchTelemetry() {} },
    handoffReview: { async runHandoffAndReview() { return true; } },
  } as unknown as ExecuteMissionPorts;

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
  const checkpoint = { missionId: 'task-2580', name: 'CP-1', firstLine: 'done', goalCheck: [{ criterion: 'c', evidence: 'e' }], nextActionText: 'next' };
  let mission = {
    id: 'task-2580', repositoryId: 'repo', title: 'Fixture', labels: [], assignee: 'codex', checkpoints: [checkpoint],
    review: null, netEngineeringLines: null, brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
    declaredGates: ['npm test'], successCriteria: ['done'], predictedNelBucket: 'Small', status: 'refined' as const, closedAt: null,
  } as unknown as Mission;
  let writes = 0;
  const result = await recoverMissionLifecycle({
    missionId: mission.id, taskStatus: 'active', actor: 'operator', occurredAt: new Date().toISOString(),
    store: {
      async load() { return { kind: 'found' as const, mission, version: 1 as never }; },
      async save() { throw new Error('recovery requires a lane event'); },
      async saveWithTransition(next: Mission) { writes += 1; mission = next; return 2 as never; },
    },
  });
  assert.equal(result.value?.action, 'recover-to-active');
  assert.equal(writes, 1);
  assert.equal(mission.status, 'active');
  assert.deepEqual(mission.checkpoints, [checkpoint]);
});

test('an immediate activation blocker launches no agent, preserves lifecycle, and returns within 200 ms', async () => {
  let launches = 0;
  const mission = {
    id: 'task-2580', repositoryId: 'repo', title: 'Incomplete', labels: [], assignee: null, checkpoints: [],
    review: null, netEngineeringLines: null, brief: null, declaredGates: [], successCriteria: [],
    predictedNelBucket: null, status: 'refined' as const, closedAt: null,
  } as unknown as Mission;
  const startedAt = performance.now();
  const outcome = await new ExecuteMissionService({
    workspace: {
      async preflight() { return true; }, async resolveWorktree() { return '/worktree'; },
      async resolveTaskFile() { return { ok: false }; }, async readTaskStatus() { return null; }, async enforceCommitSafety() {},
    },
    agentExecution: {
      async prepare() { return { prompt: 'p', agent: 'codex', agentConfig: {} }; },
      async launch() { launches += 1; throw new Error('must not launch'); },
    },
    missionTransitions: {
      async load() { return { kind: 'found' as const, version: 1, mission }; },
      async save() { throw new Error('must not save'); }, async saveWithTransition() { throw new Error('must not save'); },
    },
    telemetry: { async recordLaunchTelemetry() {} }, handoffReview: { async runHandoffAndReview() { return true; } },
  } as unknown as ExecuteMissionPorts).execute({
    operationId: 'active:task-2580', slug: 'task-2580', agent: 'codex', capabilities: new Set(['active:execute']),
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(launches, 0);
  assert.equal(mission.status, 'refined');
  assert.ok(performance.now() - startedAt < 200, 'rejection does not wait for provider startup');
});

test('a launcher blocker before onLaunch restores the refined Mission', async () => {
  let mission = {
    id: 'task-2580', repositoryId: 'repo', title: 'Ready', labels: [], assignee: null,
    checkpoints: [{ missionId: 'task-2580', name: 'CP-1', firstLine: 'test', goalCheck: [], nextActionText: '' }],
    review: null, netEngineeringLines: null, brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
    declaredGates: ['npm test'], successCriteria: ['done'], predictedNelBucket: 'Small', status: 'refined' as const, closedAt: null,
  } as unknown as Mission;
  const outcome = await new ExecuteMissionService({
    workspace: {
      async preflight() { return true; }, async resolveWorktree() { return '/worktree'; },
      async resolveTaskFile() { return { ok: false }; }, async readTaskStatus() { return null; }, async enforceCommitSafety() {},
    },
    agentExecution: {
      async prepare() { return { prompt: 'p', agent: 'codex', agentConfig: {} }; },
      async launch() { return { agent: 'codex', rebaseDeferred: false, errored: true, errorMessage: 'launcher unavailable', exitStatus: null, detail: null }; },
    },
    missionTransitions: {
      async load() { return { kind: 'found' as const, mission, version: 1 }; },
      async save(next: Mission) { mission = next; return 2; }, async saveWithTransition(next: Mission) { mission = next; return 2; },
    },
    telemetry: { async recordLaunchTelemetry() {} }, handoffReview: { async runHandoffAndReview() { return true; } },
  } as unknown as ExecuteMissionPorts).execute({
    operationId: 'active:task-2580', slug: 'task-2580', agent: 'codex', capabilities: new Set(['active:execute']),
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(mission.status, 'refined');
  assert.equal(mission.assignee, null);
});
