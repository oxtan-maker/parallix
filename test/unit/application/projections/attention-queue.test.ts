import { memoryExecutionActivity } from '../../../fixtures/execution-activity.js';
import { emptyBoardRepositories } from '../../../helpers/empty-board-repositories.js';
import { missionVersion as fixtureVersion } from '../../../../src/application/domain-ports.js';
// Historical regression provenance: TASK-2444.
// Attention queue contract: which missions the board asks a human (or the supervisor) to look at, how
// they rank, and what source facts back each reason.
//
// Behavior-owned suite (TASK-2622.12). Case names are unchanged; each section keeps its legacy file.
//   Orphaned active mission attention: no task ID in the legacy file
//   Attention queue ranking and sources: TASK-2444

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';
import type { MissionStore } from '../../../../src/application/domain-ports.js';
import type { BoardProjection } from '../../../../src/application/projections/board.js';
import { buildBoardMetrics, buildBoardProjection } from '../../../../src/application/projections/board.js';
import type { BoardLane, MissionCard } from '../../../../src/application/projections/mission-board.js';
import { EXECUTION_ACTIVITY_EVENT_TYPE, executionActivityToEntry, type ExecutionActivity } from '../../../../src/application/recording/execution-activity-recorder.js';
import { composeBoardProjection } from '../../../../src/composition/board-projection.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import type { Mission, MissionId, MissionStatus } from '../../../../src/domain/mission.js';
import { missionId, missionLabels } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

// ── Orphaned active mission attention (was attention-orphaned-active-observable.test.ts) ──


/**
 * Regression for the stranded-active observation boundary: a mission whose
 * aggregate is `active` but whose board carries no live work (no published
 * `current-work` fact and no live session) must surface an `orphaned-active`
 * attention item that dispatches to `px active`. Previously the attention
 * projection emitted `kind: 'none'` for such a card, so an abandoned `active`
 * mission dwelt in the queue forever with no human handoff.
 *
 * Hermetic doubles only — no shimmed git CLI, launcher probe, or OS process
 * scan. `historyRepo.findByType` returns no current-work events, so the
 * stranded mission has no standing work fact.
 */
const repository = repositoryId('orphaned-active-observation-repo');

interface BoardHarness {
  readonly root: string;
  readonly projection: BoardProjection;
}

function mission(id: string, status: MissionStatus): Mission {
  return {
    id: missionId(id), repositoryId: repository, title: id, labels: [], assignee: null,
    checkpoints: [], review: null, netEngineeringLines: null, status, closedAt: null,
  };
}

function storeFor(persisted: readonly Mission[]): MissionStore {
  return {
    async load(id: MissionId) {
      const found = persisted.find((candidate) => candidate.id === id);
      return found
        ? { kind: 'found' as const, mission: found, version: fixtureVersion(1) }
        : { kind: 'missing' as const };
    },
    async save() { return fixtureVersion(1); },
    async loadByRepository() { return persisted; },
  };
}

// Hermetic doubles: no shimmed git CLI, launcher probe, or OS process scan.
const gitDouble: NonNullable<NonNullable<Parameters<typeof composeBoardProjection>[0]>["gitFn"]> = () => ({ status: 0, stdout: '', stderr: '' });

async function board(store: MissionStore, currentWork: readonly ExecutionActivity[] = []): Promise<BoardHarness> {
  const root = registeredMkdtemp('orphaned-active-');
  const repositories = emptyBoardRepositories();
  const activity = memoryExecutionActivity();
  for (const event of currentWork) { await activity.publish(event, event.operationId); }
  const projection = await composeBoardProjection({
    rootDir: root,
    missionStore: store,
    repositoryId: repository,
    ...repositories,
    executionActivity: activity,
    knownAgentFamilies: [],
    launcherProbe: () => ({ available: true, detail: null }),
    readAgentConfig: () => null,
    detectRunningSessions: () => null,
    gitFn: gitDouble,
  }).builder.build();
  return { root, projection };
}

test('attention orphaned-active mission surfaces active resume item', async () => {
  const { root, projection } = await board(storeFor([mission('task-stranded', 'active')]));
  try {
    const card = projection.stages
      .flatMap((stage) => stage.cards)
      .find((c) => c.id === missionId('task-stranded'));

    // The stranded mission projects to the active lane.
    assert.ok(card, 'mission must be present on the board');
    assert.equal(card?.lane, 'active');

    // The active command is enabled on the card so the attention item is not
    // filtered out by the enabled-command gate.
    const activeCmd = card?.commands.find((c) => c.command === 'active');
    assert.ok(activeCmd?.enabled, 'active command must be enabled for a stranded active mission');

    // The attention queue carries the mission with the orphaned-active reason
    // and dispatches it to `px active <id>`.
    const item = projection.attentionQueue.find((i) => i.missionId === missionId('task-stranded'));
    assert.ok(item, 'attention queue must enqueue the stranded active mission');
    assert.deepEqual(item?.reason, { kind: 'orphaned-active', detail: 'Active mission has no live work' });
    assert.equal(item?.action?.kind, 'active:execute');
    assert.equal(item?.action?.display, `px active ${card!.id}`);
    // The stranded verdict rests on the DB-backed Mission lane, not the task
    // file (ADR 0053 / SC3): this item must declare the mission-store authority.
    assert.deepEqual(item?.dependsOnSources, ['mission-store']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Negative control: a stranded mission is only an attention item when no agent
// actually holds the turn. A fresh published current-work fact means the
// mission is being worked on and must NOT surface the stranded item.
test('attention active mission with live work stays quiet', async () => {
  const liveWork: ExecutionActivity = {
    missionId: missionId('task-live'),
    operationId: 'active:task-live:run',
    phase: 'execute',
    state: 'running',
    summary: 'execute run in progress',
    agent: agentFamily('codex'),
    // A null processId makes `runningFreshness` fall back to the age check,
    // which is fresh here, so the fact is `unverified` — counted as in
    // progress by `isWorkInProgress`. This keeps the negative control free of
    // any real OS process dependency.
    processId: null,
    blockedReason: null,
    occurredAt: new Date().toISOString(),
  };
  const { root, projection } = await board(storeFor([mission('task-live', 'active')]), [liveWork]);
  try {
    const card = projection.stages
      .flatMap((stage) => stage.cards)
      .find((c) => c.id === missionId('task-live'));

    assert.ok(card, 'mission must be present on the board');
    const item = projection.attentionQueue.find((i) => i.missionId === missionId('task-live'));
    assert.equal(item, undefined, 'an actively worked mission must not enqueue an orphaned-active item');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A mission genuinely closed in the store must never be mistaken for stranded.
test('attention a done mission is not stranded', async () => {
  const { projection } = await board(storeFor([mission('task-done', 'done')]));
  const item = projection.attentionQueue.find((i) => i.missionId === missionId('task-done'));
  assert.equal(item, undefined, 'a done mission must never surface an orphaned-active item');
});

test('planned active checkpoint awaiting operator decision is manual attention (TASK-2799)', async () => {
  const blocked: Mission = {
    ...mission('task-design-decision', 'active'),
    checkpoints: [{
      missionId: missionId('task-design-decision'), name: 'CP-1', goalCheck: [],
      nextActionText: 'Await operator design decision',
      repair: {
        incidentId: 'design-stop', command: 'npm test', authorizedGates: [],
        authorizedCriteria: [], attempt: 0, evidenceRecorded: false, verified: false,
        blocker: { command: 'npm test', diagnostic: 'Required design decision is unresolved',
          authorityReason: 'Operator owns the design decision', proposedCorrection: 'Operator must decide the contract' },
      },
    }],
  };
  const before = JSON.stringify(blocked);
  const { root, projection } = await board(storeFor([blocked]));
  try {
    const item = projection.attentionQueue.find(item => item.missionId === blocked.id);
    assert.ok(item);
    assert.equal(item.action?.kind, 'manual');
    assert.match(item.reason.kind === 'none' ? '' : item.reason.detail, /Required design decision is unresolved/);
    assert.equal(item.card.checkpointEvidence[0]?.goalCheck.length, 0);
    assert.equal(item.card.commands.find(command => command.command === 'active')?.enabled, false);
    const { workflowEligible } = await import('../../../../src/domain/workflow-command-policy.js');
    assert.equal(workflowEligible('active:execute', blocked, 'enter', true), true, 'explicit operator resume remains eligible');
    assert.equal(JSON.stringify(blocked), before, 'projection does not mutate durable Mission evidence');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing planned checkpoint evidence alone retains ordinary active recovery (TASK-2799)', async () => {
  const planned: Mission = { ...mission('task-planned-evidence', 'active'),
    checkpoints: [{ missionId: missionId('task-planned-evidence'), name: 'CP-7', goalCheck: [],
      firstLine: 'Finish the remaining implementation and record evidence', nextActionText: 'Record implementation evidence before handoff' }] };
  const { root, projection } = await board(storeFor([planned]));
  try {
    const item = projection.attentionQueue.find(item => item.missionId === planned.id);
    assert.equal(item?.action?.kind, 'active:execute');
    assert.equal(item?.card.blockerRequiresOperator, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── Attention queue ranking and sources — TASK-2444 (was task-2444-attention-queue-repro.test.ts) ──
describe("Attention queue ranking and sources —", () => {
  const repo = repositoryId('task-2444');

  function makeCard(
    id: string,
    lane: BoardLane,
    opts: Partial<Pick<MissionCard, 'blockingReason' | 'gate' | 'currentWork' | 'commands'>> = {},
  ): MissionCard {
    return {
      id: missionId(id), repositoryId: repo, title: id, labels: missionLabels(['user_value']),
      lane, status: lane, rawStatus: lane, closed: lane === 'done', agent: agentFamily('codex'),
      checkpoint: null, checkpointDescription: null, checkpointEvidence: [], nextActionText: null,
      gate: opts.gate ?? 'passed', pullRequest: null, reviewApproved: false,
      reviewRound: null, reviewPhase: null, reviewDisposition: null, reviewHistory: [],
      currentWork: opts.currentWork ?? null, blockingReason: opts.blockingReason ?? null,
      flags: [], commands: opts.commands ?? [{ command: lane === 'integration' ? 'integrate' : lane === 'review' ? 'review' : 'active', enabled: true, reason: null }],
    };
  }

  function project(cards: readonly MissionCard[], sourceFacts: Parameters<typeof buildBoardProjection>[5] = []) {
    return buildBoardProjection(
      repo, cards, [], [],
      buildBoardMetrics({ cumulativeFlow: { series: [], missingHistoryFallback: 'null' }, medianStateTimes: { series: [], missingHistoryFallback: 'null' }, throughput: { series: [], missingHistoryFallback: 'skip' }, reviewBounceRate: { series: [], missingHistoryFallback: 'estimate' } }),
      sourceFacts,
    );
  }

  test('idle approved integration retains manual durable blocker attention (TASK-2799)', () => {
    const card = { ...makeCard('task-human-integration', 'integration', {
      commands: [
        { command: 'active', enabled: false, reason: 'integration lane' },
        { command: 'integrate', enabled: true, reason: null },
      ],
    }), reviewApproved: true };
    assert.equal(card.currentWork, null);
    assert.equal(project([card]).attentionQueue[0]?.action?.kind, 'integrate:merge');
    const detail = 'Review authority is stale; operator must decide whether to stand down approval';
    const blocked = project([{ ...card, blockingReason: detail }]).attentionQueue;
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0]?.action?.kind, 'manual');
    assert.equal(blocked[0]?.reason.kind === 'none' ? null : blocked[0]?.reason.detail, detail);
    assert.equal(blocked[0]?.action.display, 'px lead task-human-integration --once');
  });

  test('task-2444: all-backlog cards produce no attention items', () => {
    assert.equal(project([makeCard('task-2444-a', 'backlog'), makeCard('task-2444-b', 'backlog')]).attentionQueue.length, 0);
  });

  test('task-2444: mixed-lane attention ranks are contiguous ordinals', () => {
    const mixed = project([
      makeCard('task-2444-blocking', 'active', { blockingReason: 'decision required' }),
      makeCard('task-2444-gate', 'active', { gate: 'failed' }),
      makeCard('task-2444-review', 'review'),
      makeCard('task-2444-integrate', 'integration'),
      makeCard('task-2444-stale', 'active', { currentWork: { operationId: 'op', phase: 'execute', summary: 'stale', agent: agentFamily('codex'), updatedAt: '2026-08-30T00:00:00.000Z', freshness: 'stale' } }),
      makeCard('task-2444-backlog', 'backlog'),
    ]);
    assert.deepEqual(mixed.attentionQueue.map((item) => item.rank), [1, 2, 3, 4, 5]);
    assert.deepEqual(mixed.attentionQueue.map((item) => [item.reason.kind, item.dependsOnSources]), [
      ['blocking', ['current-work', 'mission-store']],
      ['gate-failed', ['gate']],
      ['review-lane', ['task-markdown']],
      ['integrate-lane', ['task-markdown']],
      ['stale-work', ['current-work']],
    ]);
  });

  test('task-2444: queued executable action is enabled on its card', () => {
    const nonRunnable = project([makeCard('task-2337', 'active', {
      blockingReason: 'decision required',
      commands: [{ command: 'active', enabled: false, reason: 'ineligible' }],
    })]);
    assert.equal(nonRunnable.attentionQueue[0]?.action?.kind, 'manual');
    assert.ok(nonRunnable.attentionQueue.every(item => item.action?.kind === 'manual'));
    const failedGate = project([makeCard('task-disabled-gate', 'active', {
      gate: 'failed', commands: [{ command: 'active', enabled: false, reason: 'ineligible' }],
    })]);
    assert.equal(failedGate.attentionQueue.length, 0);
  });

  test('manual attention preserves disabled authority and ordinary integration handoff (TASK-2799)', () => {
    for (const reviewApproved of [false, true]) {
      const card = { ...makeCard('task-authority', 'integration', {
        commands: [
          { command: 'active', enabled: false, reason: 'integration lane' },
          { command: 'review', enabled: false, reason: 'integration lane' },
          { command: 'integrate', enabled: false, reason: reviewApproved ? 'stale approval' : 'missing approval' },
        ],
      }), reviewApproved };
      const before = JSON.stringify(card);
      assert.equal(project([card]).attentionQueue.length, 0);
      const blocked = { ...card, blockingReason: 'Operator review authority decision required' };
      const item = project([blocked]).attentionQueue[0];
      assert.equal(item?.action?.kind, 'manual');
      assert.deepEqual(item?.card.commands, card.commands);
      assert.equal(JSON.stringify(card), before);
      assert.deepEqual(item?.card.reviewHistory, []);
    }
    const ordinary = project([makeCard('task-ordinary', 'integration')]).attentionQueue[0];
    assert.equal(ordinary?.action?.kind, 'integrate:merge');
    assert.ok(ordinary?.card.commands.some(command => command.command === 'integrate' && command.enabled));
  });

  test('ordinary blocked active run keeps its executable retry (TASK-2799)', () => {
    const card = makeCard('task-agent-failed', 'active', { blockingReason: 'agent exited with status 1' });
    const item = project([card]).attentionQueue[0];
    assert.equal(item?.reason.kind, 'blocking');
    assert.deepEqual(item?.action, { kind: 'active:execute', display: 'px active task-agent-failed' });
    assert.ok(item?.card.commands.some(command => command.command === 'active' && command.enabled));
    const contractStop = project([{ ...card, blockerRequiresOperator: true }]).attentionQueue[0];
    assert.equal(contractStop?.action?.kind, 'manual');
  });

  test('admitted workflow ownership suppresses manual blocker attention (TASK-2799)', async () => {
    const { projectWorkflowBoard } = await import('../../../../src/application/projections/workflow-board.js');
    const card = { ...makeCard('task-owned', 'active', { blockingReason: 'Operator decision required' }), blockerRequiresOperator: true };
    const operation: import('../../../../src/domain/workflow-operation.js').WorkflowOperation = { id: 'owned-workflow', repositoryId: card.repositoryId, missionId: card.id,
      command: 'active:execute', requestKey: 'delivery', generation: 0, phase: 'executing', providerStarted: true,
      agent: 'codex', reviewer: null, originalStatus: 'active', previousAssignee: null,
      owner: { pid: 123, identity: 'verified-owner' }, createdAt: '2026-10-23T10:00:00Z',
      updatedAt: '2026-10-23T10:00:00Z', reason: null };
    assert.equal(project([card]).attentionQueue[0]?.action?.kind, 'manual');
    const owned = projectWorkflowBoard(project([card]), [operation]);
    assert.ok(owned.attentionQueue.every(item => item.action === null), 'owned work cannot advertise a lifecycle or investigation command');
    assert.ok(owned.stages.flatMap(stage => stage.cards).find(candidate => candidate.id === card.id)
      ?.commands.every(command => !command.enabled));
  });

  test('retains failed idle review recovery when active is disabled (TASK-2814)', () => {
    const projection = project([makeCard('task-review-failed', 'review', {
      blockingReason: 'Workflow exited with status 1',
      commands: [
        { command: 'active', enabled: false, reason: 'review lane' },
        { command: 'review', enabled: true, reason: null },
      ],
    })]);
    assert.equal(projection.attentionQueue.length, 1);
    assert.equal(projection.attentionQueue[0]?.action?.kind, 'review:submit');
  });

  const diagnostics = [
    { blockingReason: 'Workflow exited with status 1', reason: { kind: 'blocking', detail: 'Workflow exited with status 1' }, sources: ['current-work', 'mission-store'] },
    { gate: 'failed' as const, reason: { kind: 'gate-failed', detail: 'Gate failed' }, sources: ['gate'] },
    { currentWork: { operationId: 'review-old', phase: 'review' as const, summary: 'stopped', agent: agentFamily('codex'), updatedAt: '2026-08-30T00:00:00Z', freshness: 'stale' as const }, reason: { kind: 'stale-work', detail: 'review work is no longer verifiable' }, sources: ['current-work'] },
  ];

  test('review diagnostics retain reasons, ordering and sources (TASK-2814)', () => {
    const cards = diagnostics.map((diagnostic, index) => makeCard(`review-${index}`, 'review', diagnostic));
    const queue = project([...cards].reverse()).attentionQueue;
    assert.deepEqual(queue.map(item => item.missionId), cards.map(card => card.id));
    assert.deepEqual(queue.map(item => item.rank), [1, 2, 3]);
    queue.forEach((item, index) => {
      assert.deepEqual(item.reason, diagnostics[index]!.reason);
      assert.deepEqual(item.dependsOnSources, diagnostics[index]!.sources);
      assert.deepEqual(item.action, { kind: 'review:submit', display: `px review ${item.missionId}` });
    });
  });

  test('diagnostic recovery respects lane availability and live review work (TASK-2814)', () => {
    for (const diagnostic of diagnostics) {
      const active = project([makeCard('task-implementer', 'active', diagnostic)]).attentionQueue;
      assert.equal(active[0]?.action?.kind, 'active:execute');
      for (const commands of [
        [{ command: 'active' as const, enabled: false, reason: 'ineligible' }],
        [{ command: 'active' as const, enabled: true, reason: null }, { command: 'review' as const, enabled: false, reason: 'unavailable' }],
      ]) {
        assert.deepEqual(project([makeCard('task-unavailable', 'review', { ...diagnostic, commands })]).attentionQueue, []);
      }
      for (const freshness of ['live', 'unverified'] as const) {
        const currentWork = { operationId: 'live-review', phase: 'review' as const, summary: 'review running', agent: agentFamily('codex'), updatedAt: new Date().toISOString(), freshness };
        assert.deepEqual(project([makeCard('live-review', 'review', { ...diagnostic, currentWork })]).attentionQueue, []);
      }
      const liveSessionCard: MissionCard = { ...makeCard('live-session', 'review', diagnostic), currentWork: null, liveSession: { missionId: missionId('live-session'), family: agentFamily('codex') } };
      assert.deepEqual(project([liveSessionCard]).attentionQueue, []);
    }
    const operatorCard = { ...makeCard('review-operator-stop', 'review', {
      blockingReason: 'Operator review authority decision required',
    }), blockerRequiresOperator: true };
    assert.deepEqual(project([operatorCard]).attentionQueue[0]?.action,
      { kind: 'manual', display: 'px lead review-operator-stop --once' });
  });

  test('task-2444: every queued reason carries source dependencies', () => {
    const queue = project([makeCard('task-2444-blocking', 'active', { blockingReason: 'decision required' })]).attentionQueue;
    assert.equal(queue.length, 1);
    assert.ok(queue.every((item) => item.dependsOnSources.length >= 1));
  });

  test('task-2444: source facts are deduplicated by source status and value', () => {
    const duplicateFacts = project([], [
      { source: 'task-markdown', status: 'fresh', value: 'missions/task-2444/MISSION.md' },
      { source: 'task-markdown', status: 'fresh', value: 'missions/task-2444/MISSION.md' },
    ]);
    assert.equal(duplicateFacts.sourceFacts.length, 1);
  });
});

test('locked-contract attention retains existing operator paperwork and review continuation (TASK-2822)', async () => {
  const blocked = mission('task-operator-path', 'active');
  const checkpoint = { missionId: blocked.id, name: 'CP-2', firstLine: 'Repair', goalCheck: [], nextActionText: 'repair',
    repair: { incidentId: 'existing-incident', command: 'npm test', authorizedGates: ['npm test'], authorizedCriteria: ['actual requirement'],
      attempt: 1, evidenceRecorded: false, verified: false,
      blocker: { command: 'npm test', diagnostic: 'Locked criterion contradicts the required behavior', authorityReason: 'Operator owns the requirement', proposedCorrection: 'Clarify the criterion' } } };
  const result = await board(storeFor([{ ...blocked, checkpoints: [checkpoint] }]));
  try {
    const item = result.projection.attentionQueue[0]!;
    assert.equal(item.action?.kind, 'manual', 'investigation must not acknowledge the operator boundary');
    assert.equal(item.card.commands.find(command => command.command === 'active')?.enabled, false);
    assert.match(item.reason.kind === 'blocking' ? item.reason.detail : '', /Operator owns the requirement/);
    assert.match(item.card.nextActionText ?? '', /px checkpoint record --name CP-2/);
    assert.match(item.card.nextActionText ?? '', /px checkpoint correct-invalid-contract --name CP-2/);
    assert.match(item.card.nextActionText ?? '', /Then px review task-operator-path/);
  } finally { fs.rmSync(result.root, { recursive: true, force: true }); }
});
