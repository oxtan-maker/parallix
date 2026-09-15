import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { composeBoardProjection } from '../src/composition/board-projection.js';
import type { MissionStore } from '../src/application/domain-ports.js';
import type { Mission, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { BOARD_COMMAND_KINDS, toWebBoardSnapshot, validateWebBoardSnapshot } from '../src/interfaces/web/transport.js';
import { buildBoardMetrics, buildBoardProjection } from '../src/application/projections/board.js';
import {
  projectMissionCard,
  type LiveMissionWork,
  type MissionOperationalFacts,
} from '../src/application/projections/mission-board.js';
import { agentFamily } from '../src/domain/agents.js';
import { BoardCommandController } from '../src/application/controller/board-controller.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';

/**
 * TASK-2518: the board producer emitted `recover:mission` for a stranded
 * active mission, a kind the snapshot validator never accepted, so the whole
 * snapshot failed closed. A stranded mission resumes through `active:execute`.
 */
const repository = repositoryId('task-2518-repo');

function mission(id: string, status: MissionStatus): Mission {
  return {
    id: missionId(id), repositoryId: repository, title: id, labels: [], assignee: null,
    checkpoints: [], review: null, netEngineeringLines: null, status, closedAt: null,
  };
}

function storeFor(persisted: readonly Mission[]): MissionStore {
  return {
    async load(id) {
      const found = persisted.find((candidate) => candidate.id === id);
      return found ? { kind: 'found' as const, mission: found, version: 1 as never } : { kind: 'missing' as const };
    },
    async save() { return 1 as never; },
    async loadByRepository() { return persisted; },
  };
}

async function strandedProjection(root: string) {
  return composeBoardProjection({
    rootDir: root,
    missionStore: storeFor([mission('task-stranded', 'active')]),
    repositoryId: repository,
    blocklistRepo: { async findAll() { return []; } } as never,
    historyRepo: { async findAll() { return []; }, async findByType() { return []; } } as never,
    laneEventRepo: { async findAll() { return []; } } as never,
    usageRepo: { async findAll() { return []; } } as never,
    knownAgentFamilies: [],
    launcherProbe: () => ({ available: true, detail: null }),
    readAgentConfig: () => null,
    detectRunningSessions: () => null,
    gitFn: () => ({ status: 0, stdout: '', stderr: '' }),
  }).builder.build();
}

test('stranded active mission snapshot validates and advertises active:execute', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2518-'));
  try {
    const projection = await strandedProjection(root);
    const wire: unknown = JSON.parse(JSON.stringify(toWebBoardSnapshot(projection)));
    const validation = validateWebBoardSnapshot(wire);
    assert.deepEqual(validation.ok ? [] : [JSON.stringify(validation)], []);
    assert.ok(validation.ok);

    const item = projection.attentionQueue.find((i) => i.missionId === missionId('task-stranded'));
    assert.equal(item?.reason.kind, 'orphaned-active');
    assert.deepEqual(item?.action, { kind: 'active:execute', display: 'px active task-stranded' });

    const card = projection.stages.flatMap((stage) => stage.cards).find((c) => c.id === missionId('task-stranded'));
    const active = card?.commands.find((c) => c.command === 'active');
    assert.equal(active?.enabled, true);
    assert.equal(active?.targetLane, 'active');

    const snapshot = validation.value;
    assert.equal(snapshot.attentionQueue[0]?.action.state, 'enabled');
    const kinds = [
      ...snapshot.stages.flatMap((stage) => stage.cards.flatMap((c) => c.actions.map((a) => a.kind))),
      ...snapshot.attentionQueue.map((i) => i.action.kind),
    ];
    assert.ok(!kinds.includes('recover:mission' as never), 'no action may carry recover:mission');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Drift guard: producer kinds vs wire vocabulary (SC4)
// ---------------------------------------------------------------------------

/**
 * Every action kind the board producer can emit must be a kind the snapshot
 * validator accepts. The expected set is derived from the producer's own
 * `BOARD_COMMAND_KINDS` mapping, so adding a board command without teaching
 * the transport about it fails here rather than in a browser.
 */
test('every board lane produces only wire-accepted action kinds', () => {
  const liveWork: LiveMissionWork = {
    operationId: 'op', phase: 'execute', summary: 'go',
    agent: agentFamily('codex'), updatedAt: new Date().toISOString(), freshness: 'live',
  };
  const facts = (over: Partial<MissionOperationalFacts> = {}): MissionOperationalFacts => ({
    latestGate: 'passed', reviewApproval: null, currentWork: null,
    blockingReason: null, flags: [], ...over,
  });
  const lanes: ReadonlyArray<readonly [string, MissionStatus, MissionOperationalFacts]> = [
    ['task-backlog', 'backlog', facts()],
    ['task-refined', 'refined', facts()],
    ['task-stranded', 'active', facts()],
    ['task-gate-failed', 'active', facts({ latestGate: 'failed' })],
    ['task-live', 'active', facts({ currentWork: liveWork })],
    ['task-review', 'review', facts()],
    ['task-integration', 'integration', facts()],
    ['task-done', 'done', facts()],
  ];
  const cards = lanes.map(([id, status, operational]) =>
    projectMissionCard(mission(id, status), operational));
  const projection = buildBoardProjection(repository, cards, [], [], buildBoardMetrics({
    cumulativeFlow: { series: [], missingHistoryFallback: 'null' },
    medianStateTimes: { series: [], missingHistoryFallback: 'null' },
    throughput: { series: [], missingHistoryFallback: 'skip' },
    reviewBounceRate: { series: [], missingHistoryFallback: 'estimate' },
  }), []);

  // Every lane is represented, so no producer branch is left unexercised.
  assert.deepEqual(
    projection.stages.filter((stage) => stage.count > 0).map((stage) => stage.lane),
    ['backlog', 'refined', 'active', 'review', 'integration', 'done'],
  );

  const wire: unknown = JSON.parse(JSON.stringify(toWebBoardSnapshot(projection)));
  const validation = validateWebBoardSnapshot(wire);
  assert.deepEqual(validation.ok ? [] : [JSON.stringify(validation)], []);
  assert.ok(validation.ok);

  const emitted = new Set<string>([
    ...validation.value.stages.flatMap((stage) => stage.cards.flatMap((c) => c.actions.map((a) => a.kind))),
    ...validation.value.attentionQueue.map((item) => item.action.kind),
  ]);
  assert.deepEqual([...emitted].sort(), [...new Set(Object.values(BOARD_COMMAND_KINDS))].sort());

  // The attention queue exercises the three attention-borne kinds.
  const byMission = new Map(validation.value.attentionQueue.map((item) => [item.missionId, item.action.kind]));
  assert.equal(byMission.get('task-stranded'), 'active:execute');
  assert.equal(byMission.get('task-gate-failed'), 'active:execute');
  assert.equal(byMission.get('task-review'), 'review:submit');
  assert.equal(byMission.get('task-integration'), 'integrate:merge');
  // A mission an agent is working is not an attention item at all.
  assert.equal(byMission.has('task-live'), false);
});

// ---------------------------------------------------------------------------
// The advertised action is the one the controller actually runs (SC5)
// ---------------------------------------------------------------------------

test('stranded active mission dispatches active:execute through ExecuteMissionService', async () => {
  const { ports, calls } = makeExecutePorts({
    missionTransitions: {
      async load() { return { kind: 'found', mission: { status: 'active' }, version: 1 }; },
      async save() { calls.push('synchronize'); return 1; },
      async saveWithTransition() { calls.push('synchronize'); return 1; },
    },
  });
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch({
    operationId: 'op-2518',
    kind: 'active:execute',
    missionId: 'task-stranded',
    missionStatusAtRequest: 'active',
    agent: 'codex',
    capabilities: new Set(['active:execute']),
    cancellation: { requested: false },
  });

  assert.equal(result.status, 'completed');
  assert.ok(calls.includes('launch:task-stranded:codex'), 'ExecuteMissionService must launch the stranded mission');
});
