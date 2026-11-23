import { webProjection } from '../../../fixtures/web-projection.js';
import { fixtureMission } from '../../../fixtures/mission-builders.js';
import { projectMissionCard } from '../../../../src/application/projections/mission-board.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toWebBoardSnapshot,
  toWebCommandResult,
  toWebProgressEvent,
  validateWebBoardAnalytics,
  validateWebBoardSnapshot,
  validateWebMissionDetail,
  validateWebCommandResult,
  validateWebProgressEvent,
  SUPPORTED_WEB_TRANSPORT_VERSIONS,
  WEB_TRANSPORT_VERSION,
  WebTransportError,
} from '../../../../src/interfaces/web/transport.js';
import type { WebCommandAction, WebMissionCard } from '../../../../src/interfaces/web/transport.js';
import {
  makeAttentionItem,
  makeCard,
  makeFullCard,
  makeProjection,
  emptyMetrics,
} from '../../../fixtures/board-projection.js';
import type { BoardProjection } from '../../../../src/application/projections/board.js';
import { verificationStatistics } from '../../../../src/application/projections/verification-statistics.js';
import { flowStatistics } from '../../../../src/application/projections/flow-statistics.js';
import { weeklyDecisionWindows } from '../../../../src/domain/decision-window.js';
import type { AgentAvailabilityMetric } from '../../../../src/application/projections/board.js';

test('web FLOW transport carries shared verification wording without recalculation (px-0025)', () => {
  const verification = verificationStatistics({ repositoryId: 'repo', history: [], operations: [], lifecycle: [] });
  const flow = flowStatistics([], weeklyDecisionWindows('2026-11-03', 'UTC'));
  const projection = { ...makeProjection({}), metrics: { ...emptyMetrics, verification, flow } };
  // Historical metrics ride the analytics envelope, not the workflow snapshot (TASK-2854.04).
  const output = webProjection.analytics(projection);
  assert.ok(!('metrics' in webProjection.snapshot(projection)), 'the workflow snapshot never carries the historical family');
  assert.ok(output.metrics.verification);
  assert.match(output.metrics.verification!.join('\n'), /historical work is unavailable, not zero/);
  assert.deepEqual(output.metrics.flow, flow);
  const parsed = validateWebBoardAnalytics(JSON.parse(JSON.stringify(output)));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, output);
  const stage = { repositoryId: 'repo', missionId: 'px-1', stage: 'direct-rebase', state: 'measured',
    operationId: 'operation', sourceId: 'source', reason: 'retained terminal rebase outcome', outcomes: ['conflict', 'resolved'] };
  const withStage = { ...output, metrics: { ...output.metrics, flow: { ...flow,
    current: { ...flow.current, rebaseStages: { visible: [stage], omitted: 0 } } } } };
  assert.equal(validateWebBoardAnalytics(withStage).ok, true, 'typed stage outcomes survive web transport');
  assert.equal(validateWebBoardAnalytics({ ...output, metrics: { ...output.metrics, flow: { ...flow,
    current: { ...flow.current, defects: [{ kind: 'coverage' }] },
  } } } as unknown).ok, false, 'internal diagnostic records are rejected at the web boundary');
  assert.equal(validateWebBoardAnalytics({ ...withStage, metrics: { ...withStage.metrics, flow: { ...withStage.metrics.flow!,
    current: { ...withStage.metrics.flow!.current,
      rebaseStages: { visible: [{ ...stage, outcomes: ['invented'] }], omitted: 0 } } } } }).ok, false);
  assert.equal(validateWebBoardAnalytics({ ...output, metrics: { ...output.metrics, verification: [4] } }).ok, false);
  assert.equal(validateWebBoardAnalytics({ ...output, metrics: { ...output.metrics, flow: [] } }).ok, false);
  assert.equal(validateWebBoardAnalytics({ ...output, metrics: { ...output.metrics, flow: {
    ...flow, current: { ...flow.current, firstPassYield: { ...flow.current.firstPassYield, value: '100%' } },
  } } } as unknown).ok, false);
  assert.equal(validateWebBoardAnalytics({ ...output, metrics: { ...output.metrics, flow: {
    ...flow, current: { ...flow.current, time: { ...flow.current.time, unobservedMs: 'unknown' } },
  } } } as unknown).ok, false);
  assert.equal(validateWebBoardAnalytics({ ...output, freshness: { ...output.freshness, state: 'expired' } } as unknown).ok, false,
    'the analytics family states only the freshness it observed');
});
import type { LiveMissionWork, MissionCard, ReviewRoundSummary } from '../../../../src/application/projections/mission-board.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import type { MissionId } from '../../../../src/domain/mission.js';
import { completed, failure } from '../../../../src/application/contracts.js';

const tid = (id: string): MissionId => id as MissionId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A projection with overrides on top of the empty fixture. */
function projectionWith(overrides: Partial<BoardProjection>): BoardProjection {
  return { ...makeProjection(), ...overrides };
}

function availabilityMetric(overrides: Partial<AgentAvailabilityMetric> = {}): AgentAvailabilityMetric {
  return { family: agentFamily('custom'), available: true, blockedForMs: 0, reason: null, ...overrides };
}

/** Authoritative work fact at the given freshness. */
function workFact(freshness: LiveMissionWork['freshness']): LiveMissionWork {
  return {
    operationId: 'op-1',
    phase: 'implement' as const,
    summary: 'writing tests',
    agent: agentFamily('custom'),
    updatedAt: '2026-08-28T00:00:00.000Z',
    freshness,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const element of Object.values(value as Record<string, unknown>)) { deepFreeze(element); }
    Object.freeze(value);
  }
  return value;
}

test('web transport carries shared review progress without deriving UI policy (PX-0046.06)', () => {
  const reviewProgress = {
    round: 2, revision: 'head-2', mode: 'two-independent', selected: ['claude', 'custom'], independentAvailable: 2, requiredApprovals: 2,
    unavailable: [], degradedReason: null,
    reviewers: [
      { reviewer: 'claude', reviewerLabel: '1/2 claude', runId: 'review-claude-a1-run', runLabel: 'review-claude-a1-run', state: 'running', outcome: null, status: null, blocker: null },
      { reviewer: 'custom', reviewerLabel: '2/2 custom', runId: null, runLabel: 'review-r2-2-custom', state: 'queued', outcome: null, status: null, blocker: null },
    ], blockers: [], nextAction: 'Wait for 2 reviewer outcomes.',
  };
  const card = makeCard({ lane: 'review', status: 'review', reviewRound: 2, reviewPhase: 'reviewing', reviewProgress } as never);
  const payload = webProjection.snapshot(makeProjection({ review: [card] }));
  const wire = payload.stages.find(stage => stage.lane === 'review')!.cards[0];
  assert.deepEqual((wire as unknown as { reviewProgress: unknown }).reviewProgress, reviewProgress);
  assert.equal(validateWebBoardSnapshot(JSON.parse(JSON.stringify(payload))).ok, true);
});

/** Walk a parsed payload: only JSON types, only finite numbers. */
function assertWireJson(value: unknown): void {
  if (value === null) { return; }
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      assert.ok(Number.isFinite(value), `non-finite number on the wire: ${value}`);
      return;
    case 'object':
      break;
    default:
      throw new Error(`non-JSON type on the wire: ${typeof value}`);
  }
  if (Array.isArray(value)) {
    value.forEach(assertWireJson);
    return;
  }
  for (const [key, element] of Object.entries(value as Record<string, unknown>)) {
    assert.notStrictEqual(element, undefined, `undefined-dependent field on the wire: ${key}`);
    assertWireJson(element);
  }
}

function roundTrip<T>(dto: T): T {
  const parsed = JSON.parse(JSON.stringify(dto));
  assertWireJson(parsed);
  return parsed;
}

/** A review-lane card whose commands report the usual availability mix. */
function reviewLaneCard(): MissionCard {
  return makeFullCard({
    commands: [
      { command: 'active', enabled: false, reason: 'Mission cannot be activated from its current state' },
      { command: 'review', enabled: false, reason: "ReviewPreparation requires an active mission with checkpoint evidence" },
      { command: 'review', enabled: true, reason: null },
      { command: 'integrate', enabled: false, reason: 'Integration requires the integration queue or an approved review' },
      { command: 'draft', enabled: false, reason: 'Draft is available only while the mission is in the pre-draft (backlog) state' },
    ],
  });
}

// ---------------------------------------------------------------------------
// SC1 — JSON-safe snapshot round trip
// ---------------------------------------------------------------------------

test('snapshot DTO round-trips through JSON.stringify and JSON.parse without losing shape', () => {
  const card = reviewLaneCard();
  const projection = projectionWith({
    stages: makeProjection({ review: [card] }).stages,
    attentionQueue: [makeAttentionItem(card, { kind: 'review-lane', detail: 'Awaiting review decision' }, 2)],
    availableActions: [
      { command: 'review', enabled: true, reason: null },
      { command: 'draft', enabled: false, reason: 'Draft is available only while the mission is in the pre-draft (backlog) state' },
    ],
    operationLog: [
      { operationId: 'op-1', phase: 'implement', message: 'working', timestamp: '2026-08-28T00:00:00.000Z', agent: agentFamily('custom') },
      { operationId: 'op-2', phase: 'gate', message: 'gate passed', timestamp: '2026-08-28T00:01:00.000Z' },
    ],
    metrics: {
      ...emptyMetrics,
      agentAvailability: [
        availabilityMetric({ family: agentFamily('codex'), available: false, blockedForMs: Infinity, reason: 'usage limit' }),
        availabilityMetric({ family: agentFamily('custom'), runningSessions: 1 }),
        { family: agentFamily('claude'), available: true, blockedForMs: 0, reason: null },
      ],
    },
    sourceFacts: [
      { source: 'task-markdown', status: 'fresh', value: 'CP-2 committed' },
      { source: 'git', status: 'stale' },
    ],
  });

  const snapshot = webProjection.snapshot(projection);
  assert.equal(snapshot.transportVersion, WEB_TRANSPORT_VERSION);
  assert.equal(snapshot.projectionVersion, projection.version);

  const parsed = roundTrip(snapshot);
  assert.deepStrictEqual(parsed, snapshot);
  assert.equal(JSON.stringify(parsed), JSON.stringify(snapshot));

  const wireLogWithoutAgent = snapshot.operationLog.find((entry) => entry.operationId === 'op-2');
  assert.ok(wireLogWithoutAgent !== undefined);
  assert.ok(!('agent' in wireLogWithoutAgent), 'optional agent must be omitted, not null');
  const sourceFactWithoutValue = snapshot.sourceFacts.find((fact) => fact.source === 'git');
  assert.ok(sourceFactWithoutValue !== undefined);
  assert.ok(!('value' in sourceFactWithoutValue), 'optional value must be omitted, not null');
});

test('snapshot carries inFlightWip and rejects missing or non-finite values', () => {
  const snapshot = webProjection.snapshot(projectionWith({ inFlightWip: 3 }));
  assert.equal(roundTrip(snapshot).inFlightWip, 3);

  const { inFlightWip: _omitted, ...missing } = snapshot;
  const missingValidation = validateWebBoardSnapshot(missing);
  assert.equal(missingValidation.ok, false);
  if (!missingValidation.ok) {
    assert.equal(missingValidation.code, 'invalid-payload');
    assert.ok(missingValidation.problems.some((problem) => problem.includes('snapshot.inFlightWip')));
  }

  const nonFiniteValidation = validateWebBoardSnapshot({ ...snapshot, inFlightWip: Number.POSITIVE_INFINITY });
  assert.equal(nonFiniteValidation.ok, false);
  if (!nonFiniteValidation.ok) {
    assert.equal(nonFiniteValidation.code, 'invalid-payload');
    assert.ok(nonFiniteValidation.problems.some((problem) => problem.includes('snapshot.inFlightWip')));
  }
});

// ---------------------------------------------------------------------------
// SC2 — indefinite block encoding
// ---------------------------------------------------------------------------

test('indefinite agent block projects to a dedicated indefinite wire representation, never null', () => {
  const projection = projectionWith({
    metrics: {
      ...emptyMetrics,
      agentAvailability: [
        availabilityMetric({ family: agentFamily('codex'), available: false, blockedForMs: Infinity, reason: 'usage limit' }),
        availabilityMetric({ family: agentFamily('custom'), blockedForMs: 0 }),
        availabilityMetric({ family: agentFamily('claude'), blockedForMs: 1500 }),
      ],
    },
  });
  const snapshot = webProjection.snapshot(projection);
  const [indefinite, zero, finite] = snapshot.agentAvailability;

  assert.deepStrictEqual(indefinite.blockedFor, { kind: 'indefinite' });
  assert.deepStrictEqual(zero.blockedFor, { kind: 'finite', ms: 0 });
  assert.deepStrictEqual(finite.blockedFor, { kind: 'finite', ms: 1500 });

  const parsed = roundTrip(snapshot);
  assert.deepStrictEqual(parsed.agentAvailability[0].blockedFor, { kind: 'indefinite' });
  assert.notStrictEqual(parsed.agentAvailability[0].blockedFor, null, 'indefinite must never become wire null');
});

// ---------------------------------------------------------------------------
// SC3 — session counts and mission-work liveness
// ---------------------------------------------------------------------------

test('running sessions distinguish unobserved, observed-none, and a positive count', () => {
  const projection = projectionWith({
    metrics: {
      ...emptyMetrics,
      agentAvailability: [
        { family: agentFamily('a'), available: true, blockedForMs: 0 },
        availabilityMetric({ family: agentFamily('b'), runningSessions: 1 }),
        availabilityMetric({ family: agentFamily('c'), runningSessions: 0 }),
        availabilityMetric({ family: agentFamily('d'), runningSessions: 2 }),
      ],
    },
  });
  const snapshot = webProjection.snapshot(projection);
  const [absent, observedOne, observedNone, observedTwo] = snapshot.agentAvailability;

  assert.ok(!('runningSessions' in absent), 'absent probe result must omit the key');
  assert.strictEqual(observedOne.runningSessions, 1);
  assert.strictEqual(observedNone.runningSessions, 0, 'observed-none must be wire 0');
  assert.strictEqual(observedTwo.runningSessions, 2);

  const parsed = roundTrip(snapshot);
  assert.ok(!('runningSessions' in parsed.agentAvailability[0]));
  assert.strictEqual(parsed.agentAvailability[1].runningSessions, 1);
  assert.strictEqual(parsed.agentAvailability[2].runningSessions, 0);
  assert.strictEqual(parsed.agentAvailability[3].runningSessions, 2);
});

test('mission work activity preserves live, unconfirmed, stale, blocked, and idle liveness', () => {
  const cards: readonly [string, MissionCard][] = [
    ['live', makeCard({ id: tid('task-1001'), currentWork: workFact('live') })],
    ['unconfirmed', makeCard({ id: tid('task-1002'), currentWork: workFact('unverified') })],
    ['stale', makeCard({ id: tid('task-1003'), currentWork: workFact('stale') })],
    ['blocked', makeCard({ id: tid('task-1004'), currentWork: null, blockingReason: 'waiting on upstream fix' })],
    ['idle', makeCard({ id: tid('task-1005'), currentWork: null, blockingReason: null })],
  ];
  const projection = projectionWith({ stages: makeProjection({ active: cards.map(([, card]) => card) }).stages });
  const snapshot = webProjection.snapshot(projection);
  const byId = new Map(snapshot.stages.flatMap((stage) => stage.cards).map((card) => [card.id, card]));

  assert.deepStrictEqual(byId.get('task-1001')?.activity.work, {
    kind: 'working', certainty: 'live', phase: 'implement', summary: 'writing tests',
    agent: 'custom', operationId: 'op-1',
  });
  const unconfirmed = byId.get('task-1002')?.activity.work;
  assert.equal(unconfirmed?.kind, 'working');
  if (unconfirmed?.kind === 'working') {
    assert.equal(unconfirmed.certainty, 'unknown');
  }
  const stale = byId.get('task-1003')?.activity.work;
  assert.equal(stale?.kind, 'working');
  if (stale?.kind === 'working') {
    assert.equal(stale.certainty, 'stale');
  }
  assert.deepStrictEqual(byId.get('task-1004')?.activity.work, { kind: 'blocked', reason: 'waiting on upstream fix' });
  assert.deepStrictEqual(byId.get('task-1005')?.activity.work, { kind: 'idle' });

  const parsed = roundTrip(snapshot);
  assert.deepStrictEqual(parsed, snapshot);
});

test('coordinator evidence distinguishes unknown, stopped, and live', () => {
  const cards: readonly MissionCard[] = [
    makeCard({ id: tid('task-1006') }), // liveSession absent
    makeCard({ id: tid('task-1007'), liveSession: null }),
    makeCard({ id: tid('task-1008'), liveSession: { missionId: tid('task-1008'), family: agentFamily('codex') } }),
    makeCard({ id: tid('task-1009'), liveSession: { missionId: tid('task-1009'), family: null } }),
  ];
  const snapshot = webProjection.snapshot(projectionWith({ stages: makeProjection({ active: cards }).stages }));
  const byId = new Map(snapshot.stages.flatMap((stage) => stage.cards).map((card) => [card.id, card]));

  assert.deepStrictEqual(byId.get('task-1006')?.activity.coordinator, { state: 'unknown' });
  assert.deepStrictEqual(byId.get('task-1007')?.activity.coordinator, { state: 'stopped' });
  assert.deepStrictEqual(byId.get('task-1008')?.activity.coordinator, { state: 'live', family: 'codex' });
  assert.deepStrictEqual(byId.get('task-1009')?.activity.coordinator, { state: 'live', family: null });
});

// ---------------------------------------------------------------------------
// SC4 — server-owned action states
// ---------------------------------------------------------------------------

function actionsFor(card: MissionCard): Map<string, WebCommandAction> {
  const snapshot = webProjection.snapshot(projectionWith({ stages: makeProjection({ [card.lane]: [card] }).stages }));
  const wire = snapshot.stages.flatMap((stage) => stage.cards).find((c) => c.id === card.id);
  return new Map((wire?.actions ?? []).map((action) => [action.kind, action]));
}

test('action DTO distinguishes an unavailable action from an ineligible action', () => {
  const card = reviewLaneCard();
  const actions = actionsFor(card);

  const review = actions.get('review:submit');
  assert.ok(review !== undefined);
  assert.equal(review.state, 'enabled');
  assert.equal(review.reason, null);

  const active = actions.get('active:execute');
  assert.ok(active !== undefined);
  assert.equal(active.state, 'ineligible');
  assert.equal(active.reason, 'Mission cannot be activated from its current state');
  assert.equal(active.display, `px active ${card.id}`);

  const draft = actions.get('draft:create');
  assert.ok(draft !== undefined);
  assert.equal(draft.state, 'ineligible');
  assert.equal(draft.reason, 'Draft is available only while the mission is in the pre-draft (backlog) state');
});

test('enabled action DTO carries null reason and exact display text', () => {
  const card = makeCard({
    id: tid('task-1010'),
    lane: 'active',
    status: 'active',
    commands: [{ command: 'review', enabled: true, reason: null }],
  });
  const actions = actionsFor(card);
  const reviewPreparation = actions.get('review:submit');
  assert.ok(reviewPreparation !== undefined);
  assert.equal(reviewPreparation.state, 'enabled');
  assert.equal(reviewPreparation.reason, null);
  assert.equal(reviewPreparation.display, "px review task-1010");
  assert.equal(reviewPreparation.targetLane, null, 'fixtures without a server target remain button-only');
});

test('attention action keeps the server-owned display text and state', () => {
  const base = reviewLaneCard();
  const card = { ...base, commands: base.commands.map(command => command.command === 'review' ? { ...command, enabled: true, reason: null } : command) };
  const snapshot = webProjection.snapshot(projectionWith({
    stages: makeProjection({ review: [card] }).stages,
    attentionQueue: [makeAttentionItem(card, { kind: 'review-lane', detail: 'Awaiting review decision' }, 2)],
  }));
  const item = snapshot.attentionQueue[0];
  assert.equal(item.missionId, card.id);
  assert.equal(item.reason.kind, 'review-lane');
  assert.equal(item.reason.detail, 'Awaiting review decision');
  assert.equal(item.action?.kind, 'review:submit');
  assert.equal(item.action?.display, 'px review task-1234');
  assert.equal(item.action?.state, 'enabled');
  assert.equal(item.action?.reason, null);
  assert.deepStrictEqual(item.dependsOnSources, ['task-markdown']);
});

test('settled human stop relabels the existing review action as resume (TASK-2839)', () => {
  const base = reviewLaneCard();
  const recovery = { action: 'acknowledge-and-resume' as const, humanStop: 'MAX_ATTEMPTS',
    evidence: ['no open workflow operation', 'no live workflow, coordinator, execution or reviewer'],
    guidance: 'Review stopped for human review (MAX_ATTEMPTS) and owned work has settled, so no further stop is required.' };
  const card = { ...base, reviewRecovery: recovery };
  const snapshot = webProjection.snapshot(projectionWith({
    stages: makeProjection({ review: [card] }).stages,
    attentionQueue: [makeAttentionItem(card, { kind: 'review-lane', detail: recovery.guidance }, 1)],
  }));
  const wire = snapshot.stages.flatMap(stage => stage.cards).find(each => each.id === card.id)!;
  assert.deepEqual(wire.reviewRecovery, recovery);
  const resume = wire.actions.find(action => action.kind === 'review:submit' && action.state === 'enabled');
  assert.equal(resume?.state, 'enabled');
  assert.equal(resume?.label, 'Resume review');
  assert.equal(snapshot.attentionQueue[0].action?.kind, 'review:submit');
  assert.doesNotMatch(JSON.stringify({ wire, attention: snapshot.attentionQueue[0] }), /px stop/);
  assert.equal(validateWebBoardSnapshot(JSON.parse(JSON.stringify(snapshot))).ok, true);
});

// ---------------------------------------------------------------------------
// SC5 — command results and progress: versioned, validated, safe
// ---------------------------------------------------------------------------

test('command result conversion rejects an arbitrary thrown object as value', () => {
  assert.throws(
    () => toWebCommandResult(completed(new Error('boom'))),
    (error: unknown) => error instanceof WebTransportError && error.code === 'unsafe-value',
  );
  assert.throws(
    () => toWebCommandResult(completed(new TypeError('bad'))),
    (error: unknown) => error instanceof WebTransportError && error.code === 'unsafe-value',
  );
  assert.throws(
    () => toWebCommandResult(completed(new Map([['a', 1]]))),
    (error: unknown) => error instanceof WebTransportError && error.code === 'unsafe-value',
  );
  assert.throws(
    () => toWebCommandResult(completed(BigInt(1))),
    (error: unknown) => error instanceof WebTransportError && error.code === 'unsafe-value',
  );
  assert.throws(
    () => toWebCommandResult(completed({ nested: { x: undefined } })),
    (error: unknown) => error instanceof WebTransportError && error.code === 'unsafe-value',
  );
});

test('command result conversion rejects non-finite values and keeps safe ones', () => {
  assert.throws(
    () => toWebCommandResult(completed(NaN)),
    (error: unknown) => error instanceof WebTransportError && error.code === 'non-finite-number',
  );
  assert.throws(
    () => toWebCommandResult(completed(Infinity)),
    (error: unknown) => error instanceof WebTransportError && error.code === 'non-finite-number',
  );
  assert.throws(
    () => toWebCommandResult(completed([1, Number.POSITIVE_INFINITY])),
    (error: unknown) => error instanceof WebTransportError && error.code === 'non-finite-number',
  );

  const safe = toWebCommandResult(completed({ ok: true, count: 2, note: null }));
  assert.deepStrictEqual(safe.value, { ok: true, count: 2, note: null });
  const absent = toWebCommandResult(completed(undefined));
  assert.ok(!('value' in absent), 'absent value must omit the key, not null');
  assert.deepStrictEqual(roundTrip(safe), safe);
});

test('command result wire error carries kind and message only, never a stack', () => {
  const result = toWebCommandResult(
    failure('execution', 'boom', [{ id: 'ev-1', source: 'git', detail: 'push failed' }]),
  );
  assert.equal(result.status, 'failed');
  assert.deepStrictEqual(result.error, { kind: 'execution', message: 'boom' });
  assert.ok(result.error !== null && !('stack' in result.error));
  assert.deepStrictEqual(result.durableEvidence, [{ id: 'ev-1', source: 'git', detail: 'push failed' }]);

  const withStack = {
    kind: 'command-result',
    transportVersion: WEB_TRANSPORT_VERSION,
    status: 'failed',
    error: { kind: 'execution', message: 'boom', stack: 'at boom (src/x.ts:1:1)' },
    durableEvidence: [],
  };
  const validation = validateWebCommandResult(withStack);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.code, 'invalid-payload');
    assert.ok(validation.problems.some((problem) => problem.includes('stack')));
  }
});

// Regression: a production snapshot whose card actions carry a `label` (and one
// that omits it) must validate. The optional `label` key is allowed-but-not- required in `checkCommandAction`; a regression here would reject every real
// command action in both shapes (F1).
test('snapshot validation accepts real command actions with and without a label', () => {
  const card = makeFullCard({
    lane: 'active',
    status: 'active',
    commands: [
      { command: 'active', enabled: true, reason: null, targetLane: 'active', label: 'resume' },
      { command: 'review', enabled: false, reason: "ReviewPreparation requires an active mission with checkpoint evidence", targetLane: 'review' },
    ],
  });
  const projection = makeProjection({ active: [card] });
  const snapshot = webProjection.snapshot(projection);
  const actions = snapshot.stages.flatMap((stage) => stage.cards.flatMap((missionCard) => missionCard.actions));
  assert.ok(actions.some((action) => 'label' in action), 'a real action carries its label');
  assert.ok(actions.some((action) => !('label' in action)), 'a real action omits the label');
  assert.equal(validateWebBoardSnapshot(snapshot).ok, true, 'production snapshot with real actions must validate');
});

// SC3 — the checkpoint evidence field validates, and an omission reads as
// "no evidence" rather than a malformed card.
test('common snapshot defers bulky checkpoint and review detail while typed on-demand detail preserves it (PX-0058.04)', () => {
  const card = makeFullCard({
    checkpoint: 'CP-2.md',
    checkpointDescription: 'CP-2: components extracted',
    checkpointEvidence: [
      { name: 'CP-1', description: 'CP-1: plan', goalCheck: [{ criterion: 'a', evidence: 'b' }] },
      { name: 'CP-2', description: 'CP-2: components extracted', goalCheck: [{ criterion: 'c', evidence: 'd' }, { criterion: 'e', evidence: 'f' }] },
    ],
    reviewHistory: task2447History,
  });
  const snapshot = webProjection.snapshot(makeProjection({ review: [card] }));
  const wireCard = snapshot.stages.flatMap((stage) => stage.cards)[0];
  assert.deepStrictEqual(wireCard.checkpointEvidence, [
    { name: 'CP-1', description: 'CP-1: plan', goalCheckCount: 1 },
    { name: 'CP-2', description: 'CP-2: components extracted', goalCheckCount: 2 },
  ]);
  assert.deepStrictEqual(wireCard.reviewHistory, task2447History.map(({ number, disposition }) => ({ number, disposition })));
  assert.doesNotMatch(JSON.stringify(snapshot), /Two findings on the gate wiring|transport\.ts: review fields unvalidated|"criterion":"a"/);
  assert.equal(validateWebBoardSnapshot(JSON.parse(JSON.stringify(snapshot))).ok, true);

  const detail = webProjection.detail(makeProjection({ review: [card] }), card.id);
  assert.deepStrictEqual(detail.checkpointEvidence, card.checkpointEvidence.map(checkpoint => ({
    ...checkpoint, goalCheckCount: checkpoint.goalCheck.length,
  })));
  assert.deepStrictEqual(detail.reviewHistory, task2447History);
  assert.equal(validateWebMissionDetail(JSON.parse(JSON.stringify(detail))).ok, true);
});

test('an omitted checkpoint evidence field reads as no evidence, never malformed', () => {
  const card = makeFullCard({ checkpointEvidence: [] });
  const snapshot = webProjection.snapshot(makeProjection({ review: [card] }));
  const parsed = JSON.parse(JSON.stringify(snapshot));
  for (const stage of parsed.stages) {
    for (const wireCard of stage.cards) { delete wireCard.checkpointEvidence; }
  }
  assert.equal(validateWebBoardSnapshot(parsed).ok, true, 'an omission is valid, not a malformed card');
});

test('a malformed checkpoint evidence field is rejected', () => {
  const snapshot = webProjection.snapshot(makeProjection({ review: [makeFullCard({ checkpointEvidence: [] })] }));
  const parsed = JSON.parse(JSON.stringify(snapshot));
  const card = stageCards(parsed).find(wireCard => 'checkpointEvidence' in wireCard);
  card!.checkpointEvidence = 'not-an-array';
  const validation = validateWebBoardSnapshot(parsed);
  assert.equal(validation.ok, false);
  if (!validation.ok && validation.code === 'invalid-payload') { assert.ok(validation.problems.some((problem) => problem.includes('.checkpointEvidence'))); }
});

test('unsupported transport version is rejected as an incompatible client', () => {
  const snapshot = webProjection.snapshot(projectionWith({}));
  const snapshotValidation = validateWebBoardSnapshot({ ...snapshot, transportVersion: 99 });
  assert.deepStrictEqual(snapshotValidation, {
    ok: false,
    code: 'incompatible-client',
    field: 'transportVersion',
    received: 99,
    supported: [WEB_TRANSPORT_VERSION],
  });

  const resultValidation = validateWebCommandResult({
    kind: 'command-result', transportVersion: 0, status: 'completed', error: null, durableEvidence: [],
  });
  assert.equal(resultValidation.ok, false);
  if (!resultValidation.ok) { assert.equal(resultValidation.code, 'incompatible-client'); }

  const progressValidation = validateWebProgressEvent({
    kind: 'progress', transportVersion: 'next', operationId: 'op-1', sequence: 1,
    phase: 'p', message: 'm', timestamp: 't',
  });
  assert.equal(progressValidation.ok, false);
  if (!progressValidation.ok) { assert.equal(progressValidation.code, 'incompatible-client'); }

  const current = validateWebBoardSnapshot(snapshot);
  assert.equal(current.ok, true);
});

test('progress event DTO is versioned and validated', () => {
  const withAgent = toWebProgressEvent({
    operationId: 'op-1', sequence: 3, phase: 'implement', message: 'working',
    timestamp: '2026-08-28T00:00:00.000Z', agent: agentFamily('custom'),
  });
  const withoutAgent = toWebProgressEvent({
    operationId: 'op-2', sequence: 1, phase: 'gate', message: 'gate passed',
    timestamp: '2026-08-28T00:01:00.000Z',
  });

  assert.equal(withAgent.transportVersion, WEB_TRANSPORT_VERSION);
  assert.equal(withAgent.agent, 'custom');
  assert.ok(!('agent' in withoutAgent), 'optional agent must be omitted, not null');
  assert.deepStrictEqual(roundTrip(withAgent), withAgent);
  assert.deepStrictEqual(roundTrip(withoutAgent), withoutAgent);
  assert.equal(validateWebProgressEvent(withAgent).ok, true);
  assert.equal(validateWebProgressEvent(withoutAgent).ok, true);

  const badSequence = validateWebProgressEvent({ ...withAgent, sequence: '3' });
  assert.equal(badSequence.ok, false);
  if (!badSequence.ok) { assert.equal(badSequence.code, 'invalid-payload'); }

  const agentNull = validateWebProgressEvent({ ...withoutAgent, agent: null });
  assert.equal(agentNull.ok, false);
});

// ---------------------------------------------------------------------------
// Version fail-closed at the source, and purity
// ---------------------------------------------------------------------------

test('unsupported projection version is rejected before conversion', () => {
  const future = { ...makeProjection(), version: 99 };
  assert.throws(
    // @ts-expect-error Intentional unsupported projection version must fail closed.
    () => webProjection.snapshot(future),
    (error: unknown) => error instanceof WebTransportError && error.code === 'unsupported-projection-version',
  );
});

// ---------------------------------------------------------------------------
// TASK-2447 — server-owned card facts: pullRequest, reviewApproved, reviewHistory
// ---------------------------------------------------------------------------

const task2447History: readonly ReviewRoundSummary[] = [
  {
    number: 1,
    reviewer: agentFamily('codex'),
    implementer: agentFamily('custom'),
    phase: 'fixing',
    disposition: 'REQUEST_CHANGES',
    comment: 'Two findings on the gate wiring.',
    findingSummaries: ['transport.ts: review fields unvalidated'],
    pushbacks: [],
    fixes: [],
  },
  {
    number: 2,
    reviewer: agentFamily('claude'),
    implementer: agentFamily('custom'),
    phase: 'reviewing',
    disposition: null,
    comment: null,
    findingSummaries: ['web card omits the PR link'],
    pushbacks: ['F-2: url is null for a local review surface'],
    fixes: ['F-1: projected pullRequest one-to-one'],
  },
];

function wireCardFor(card: MissionCard): WebMissionCard {
  const snapshot = webProjection.snapshot(makeProjection({ [card.lane]: [card] }));
  const wire = snapshot.stages.flatMap((stage) => stage.cards).find((c) => c.id === card.id);
  assert.ok(wire !== undefined, `wire card for ${card.id} must exist`);
  return wire;
}

function snapshotPayloadFor(card: MissionCard): Record<string, unknown> {
  const snapshot = webProjection.snapshot(makeProjection({ [card.lane]: [card] }));
  return JSON.parse(JSON.stringify(snapshot));
}

function stageCards(payload: Record<string, unknown>): Record<string, unknown>[] {
  const stages = (payload.stages ?? []) as Record<string, unknown>[];
  return stages.flatMap((stage) => (stage.cards ?? []) as Record<string, unknown>[]);
}

test('snapshot card DTO carries pullRequest, reviewApproved, and compact review outcomes through a JSON round trip', () => {
  const card = makeFullCard({
    reviewRound: 2,
    reviewPhase: 'fixing',
    reviewDisposition: null,
    reviewHistory: task2447History,
  });
  const wire = wireCardFor(card);
  assert.deepStrictEqual(wire.pullRequest, {
    kind: 'pull-request',
    provider: 'forgejo',
    id: '42',
    url: 'https://example.invalid/pr/42',
    sourceBranch: 'mission/task-1234',
    targetBranch: 'main',
  });
  assert.strictEqual(wire.reviewApproved, true);
  const summaries = task2447History.map(({ number, disposition }) => ({ number, disposition }));
  assert.deepStrictEqual(wire.reviewHistory, summaries);

  const snapshot = webProjection.snapshot(makeProjection({ [card.lane]: [card] }));
  const parsed = roundTrip(snapshot);
  assert.deepStrictEqual(parsed, snapshot);
  const parsedCard = parsed.stages.flatMap((stage) => stage.cards).find((c) => c.id === card.id);
  assert.ok(parsedCard !== undefined);
  assert.deepStrictEqual(parsedCard.pullRequest, card.pullRequest);
  assert.strictEqual(parsedCard.reviewApproved, card.reviewApproved);
  assert.deepStrictEqual(parsedCard.reviewHistory, summaries);

  // Existing checkpoint and current-round fields survive the round trip unchanged.
  assert.equal(parsedCard.checkpoint, 'CP-2.md');
  assert.equal(parsedCard.checkpointDescription, 'CP-2: components extracted');
  assert.equal(parsedCard.nextActionText, 'run the verification gate');
  assert.equal(parsedCard.gate, 'passed');
  assert.equal(parsedCard.reviewRound, 2);
  assert.equal(parsedCard.reviewPhase, 'fixing');
  assert.equal(parsedCard.reviewDisposition, null);
});

test('snapshot card DTO keeps pullRequest null when the card has no pull-request reference', () => {
  const card = makeFullCard({ pullRequest: null, reviewHistory: [] });
  const wire = wireCardFor(card);
  assert.strictEqual(wire.pullRequest, null, 'a local-branch review subject stays null, not an empty object');
  assert.strictEqual(wire.reviewApproved, true);
  assert.deepStrictEqual(wire.reviewHistory, []);

  const snapshot = webProjection.snapshot(makeProjection({ [card.lane]: [card] }));
  const parsed = roundTrip(snapshot);
  const parsedCard = parsed.stages.flatMap((stage) => stage.cards).find((c) => c.id === card.id);
  assert.ok(parsedCard !== undefined);
  assert.strictEqual(parsedCard.pullRequest, null);
});

test('snapshot card DTO round-trips reviewApproved and only per-round outcome summaries', () => {
  const card = makeFullCard({ reviewHistory: task2447History });
  const snapshot = webProjection.snapshot(makeProjection({ [card.lane]: [card] }));
  const parsed = roundTrip(snapshot);
  const parsedCard = parsed.stages.flatMap((stage) => stage.cards).find((c) => c.id === card.id);
  assert.ok(parsedCard !== undefined);

  assert.equal(typeof parsedCard.reviewApproved, 'boolean');
  assert.strictEqual(parsedCard.reviewApproved, card.reviewApproved);
  assert.equal(parsedCard.reviewHistory.length, task2447History.length);
  parsedCard.reviewHistory.forEach((round, index) => {
    const source = task2447History[index];
    assert.strictEqual(round.number, source.number);
    assert.strictEqual(round.disposition, source.disposition);
    assert.deepStrictEqual(Object.keys(round).sort(), ['disposition', 'number']);
  });

  // The second round has disposition null with non-empty finding/pushback/fix lists.
  const openRound = parsedCard.reviewHistory[1];
  assert.strictEqual(openRound.disposition, null);
  assert.deepStrictEqual(openRound, { number: 2, disposition: null });

  // Unapproved card without history: false and [] survive the round trip.
  const bare = makeCard();
  const bareWire = wireCardFor(bare);
  assert.strictEqual(bareWire.reviewApproved, false);
  assert.deepStrictEqual(bareWire.reviewHistory, []);
});

test('snapshot validation accepts the extended card and fails closed on malformed card facts', () => {
  const card = makeFullCard({ reviewHistory: task2447History });
  const payload = snapshotPayloadFor(card);

  assert.equal(validateWebBoardSnapshot(payload).ok, true, 'extended valid payload must be accepted');

  const unexpectedKey = JSON.parse(JSON.stringify(payload));
  (stageCards(unexpectedKey)[0].pullRequest as Record<string, unknown>).pushedAt = '2026-08-30T00:00:00.000Z';
  const unexpectedKeyValidation = validateWebBoardSnapshot(unexpectedKey);
  assert.equal(unexpectedKeyValidation.ok, false);
  if (!unexpectedKeyValidation.ok) {
    assert.equal(unexpectedKeyValidation.code, 'invalid-payload');
    assert.ok(
      unexpectedKeyValidation.problems.some((problem) => problem.includes('.pullRequest') && problem.includes('pushedAt')),
      `expected an unexpected-key problem for pullRequest.pushedAt, got ${JSON.stringify(unexpectedKeyValidation.problems)}`,
    );
  }

  const wrongKind = JSON.parse(JSON.stringify(payload));
  (stageCards(wrongKind)[0].pullRequest as Record<string, unknown>).kind = 'local-branch';
  const wrongKindValidation = validateWebBoardSnapshot(wrongKind);
  assert.equal(wrongKindValidation.ok, false);
  if (!wrongKindValidation.ok) {
    assert.equal(wrongKindValidation.code, 'invalid-payload');
    assert.ok(
      wrongKindValidation.problems.some((problem) => problem.includes('.pullRequest.kind')),
      `expected a kind problem, got ${JSON.stringify(wrongKindValidation.problems)}`,
    );
  }

  const nonFiniteRound = JSON.parse(JSON.stringify(payload));
  const history = stageCards(nonFiniteRound)[0].reviewHistory;
  assert.ok(Array.isArray(history));
  const round: unknown = history[0];
  assert.ok(round && typeof round === 'object' && 'number' in round);
  round.number = Number.NaN;
  const nonFiniteRoundValidation = validateWebBoardSnapshot(nonFiniteRound);
  assert.equal(nonFiniteRoundValidation.ok, false);
  if (!nonFiniteRoundValidation.ok) {
    assert.equal(nonFiniteRoundValidation.code, 'invalid-payload');
    assert.ok(
      nonFiniteRoundValidation.problems.some((problem) => problem.includes('.reviewHistory[0].number')),
      `expected a non-finite number problem, got ${JSON.stringify(nonFiniteRoundValidation.problems)}`,
    );
  }

  const badApproved = JSON.parse(JSON.stringify(payload));
  stageCards(badApproved)[0].reviewApproved = 'yes';
  const badApprovedValidation = validateWebBoardSnapshot(badApproved);
  assert.equal(badApprovedValidation.ok, false);
  if (!badApprovedValidation.ok) {
    assert.equal(badApprovedValidation.code, 'invalid-payload');
    assert.ok(
      badApprovedValidation.problems.some((problem) => problem.includes('.reviewApproved')),
      `expected a boolean problem, got ${JSON.stringify(badApprovedValidation.problems)}`,
    );
  }
});

test('transport version 5 rejects prior and future payloads as incompatible clients, not invalid payloads (TASK-2859.21)', () => {
  assert.equal(WEB_TRANSPORT_VERSION, 5);
  assert.deepStrictEqual([...SUPPORTED_WEB_TRANSPORT_VERSIONS], [5]);

  const snapshot = webProjection.snapshot(makeProjection({}));
  assert.equal(snapshot.transportVersion, 5);
  for (const unsupported of [4, 6]) {
    const result = validateWebBoardSnapshot({ ...snapshot, transportVersion: unsupported });
    assert.deepStrictEqual(result, { ok: false, code: 'incompatible-client', field: 'transportVersion', received: unsupported, supported: [5] });
  }
  // v3 carried historical metrics inside the snapshot; a v3 client must be
  // told its transport is incompatible rather than shown a partial payload.
  const v3Snapshot = validateWebBoardSnapshot({ ...snapshot, metrics: {}, transportVersion: 3 });
  assert.equal(v3Snapshot.ok, false);
  assert.ok(!v3Snapshot.ok && v3Snapshot.code === 'incompatible-client', 'a v3 snapshot is rejected as an incompatible transport');
  const v3Analytics = validateWebBoardAnalytics({ ...webProjection.analytics(makeProjection({})), transportVersion: 3 });
  assert.equal(v3Analytics.ok, false);
  assert.ok(!v3Analytics.ok && v3Analytics.code === 'incompatible-client', 'a v3 analytics payload is rejected as an incompatible transport');

  const v2Snapshot = validateWebBoardSnapshot({ ...snapshot, transportVersion: 2 });
  assert.deepStrictEqual(v2Snapshot, {
    ok: false,
    code: 'incompatible-client',
    field: 'transportVersion',
    received: 2,
    supported: [5],
  });

  const v2Result = validateWebCommandResult({
    kind: 'command-result', transportVersion: 2, status: 'completed', error: null, durableEvidence: [],
  });
  assert.equal(v2Result.ok, false);
  if (!v2Result.ok) {
    assert.equal(v2Result.code, 'incompatible-client');
    assert.equal(v2Result.received, 2);
  }

  const v2Progress = validateWebProgressEvent({
    kind: 'progress', transportVersion: 2, operationId: 'op-1', sequence: 1,
    phase: 'p', message: 'm', timestamp: 't',
  });
  assert.equal(v2Progress.ok, false);
  if (!v2Progress.ok) {
    assert.equal(v2Progress.code, 'incompatible-client');
    assert.equal(v2Progress.received, 2);
  }
});

test('stamped checkpoint repair evidence validates after web projection (TASK-2694)', () => {
  const mission = fixtureMission('task-2694', { checkpoints: [{
    missionId: tid('task-2694'), name: 'CP-3', firstLine: 'repair', nextActionText: 'verify', goalCheck: [{
      criterion: 'repair verified', evidence: 'src/domain/checkpoint.ts',
      recordedRound: 3, repairedGate: 'static-analysis', repairedGates: ['transport', 'static-analysis'],
    }],
  }] });
  const card = projectMissionCard(mission, { latestGate: 'not-run', reviewApproval: null, currentWork: null, blockingReason: null, flags: [] });
  const projection = makeProjection({ active: [card] });
  const snapshot = webProjection.snapshot(projection);
  assert.equal(validateWebBoardSnapshot(snapshot).ok, true);
  const wireCard = snapshot.stages.flatMap((stage) => stage.cards).find((item) => item.id === card.id)!;
  assert.deepStrictEqual(wireCard.checkpointEvidence, [{
    name: 'CP-3', description: 'repair', state: 'completed', goalCheckCount: 1,
  }]);
  const detail = webProjection.detail(projection, card.id);
  assert.deepStrictEqual(detail.checkpointEvidence, [{
    name: 'CP-3', description: 'repair', state: 'completed', goalCheckCount: 1, goalCheck: [{
      criterion: 'repair verified', evidence: 'src/domain/checkpoint.ts',
      recordedRound: 3, repairedGate: 'static-analysis', repairedGates: ['transport', 'static-analysis'],
    }],
  }]);
  assert.equal(card.checkpointEvidence[0].goalCheck[0].recordedRound, 3);
  assert.equal(card.checkpointEvidence[0].goalCheck[0].repairedGate, 'static-analysis');
  assert.deepStrictEqual(card.checkpointEvidence[0].goalCheck[0].repairedGates, ['transport', 'static-analysis']);
  const malformed = JSON.parse(JSON.stringify(detail));
  malformed.checkpointEvidence[0].goalCheck[0].unrelatedKey = true;
  assert.equal(validateWebMissionDetail(malformed).ok, false);
  for (const patch of [
    { recordedRound: -1 }, { recordedRound: 1.5 }, { recordedRound: Infinity },
    { repairedGate: 42 }, { repairedGates: 'transport' }, { repairedGates: [42] },
  ]) {
    const invalid = structuredClone(detail);
    const row = invalid.checkpointEvidence[0].goalCheck[0];
    Object.assign(row, patch);
    assert.equal(validateWebMissionDetail(invalid).ok, false, JSON.stringify(patch));
  }
  const legacy = webProjection.snapshot(makeProjection({ active: [makeFullCard({ checkpointEvidence: [{
    name: 'CP-1', description: 'original', goalCheck: [{ criterion: 'unchanged', evidence: 'test/unit/interfaces/web/web-transport.cases.ts' }],
  }] })] }));
  assert.equal(validateWebBoardSnapshot(legacy).ok, true);
  const empty = webProjection.snapshot(makeProjection({ active: [makeFullCard({ checkpointEvidence: [] })] }));
  assert.deepStrictEqual(empty.stages.flatMap((stage) => stage.cards)[0].checkpointEvidence, []);
  assert.equal(validateWebBoardSnapshot(empty).ok, true);
});

test('analytics metrics are projected and malformed metrics fail closed', () => {
  const analytics = webProjection.analytics(projectionWith({ metrics: { ...emptyMetrics, health: { state: 'healthy' }, provenance: { ...emptyMetrics.provenance, sampleSize: 3 } } }));
  assert.equal(analytics.metrics.health.state, 'healthy');
  assert.equal(analytics.metrics.provenance.sampleSize, 3);
  assert.equal(validateWebBoardAnalytics({ ...analytics, metrics: {} }).ok, false);
});

test('conversion is pure: the source projection is not mutated and the output is deterministic', () => {
  const card = reviewLaneCard();
  const projection = deepFreeze(projectionWith({
    stages: makeProjection({ review: [card] }).stages,
    attentionQueue: [makeAttentionItem(card, { kind: 'review-lane', detail: 'Awaiting review decision' }, 2)],
    metrics: {
      ...emptyMetrics,
      agentAvailability: [availabilityMetric({ blockedForMs: Infinity, reason: 'usage limit' })],
    },
    operationLog: [{ operationId: 'op-1', phase: 'implement', message: 'working', timestamp: 't' }],
    sourceFacts: [{ source: 'task-markdown', status: 'fresh', value: 'v' }],
  }));

  // Writing through the converter would throw on the frozen source (strict mode).
  const first = webProjection.snapshot(projection);
  const second = webProjection.snapshot(projection);
  assert.deepStrictEqual(first, second);
  assert.doesNotThrow(() => JSON.stringify(first));
});

test('weekly delivery count survives transport and rejects malformed values (TASK-2688)', () => {
  const analytics = webProjection.analytics(projectionWith({}));
  for (const value of [0, 3]) {
    const wire = { ...analytics, metrics: { ...analytics.metrics, weeklyCompletedMissions: value } };
    assert.equal(validateWebBoardAnalytics(JSON.parse(JSON.stringify(wire))).ok, true);
  }
  for (const value of ['3', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(validateWebBoardAnalytics({ ...analytics, metrics: { ...analytics.metrics, weeklyCompletedMissions: value } } as unknown).ok, false);
  }
});


test('other completed history round-trips separately from the weekly DONE count (TASK-2688)', () => {
  const projection = makeProjection({ done: [makeCard({ id: tid('task-weekly'), lane: 'done' })] });
  const withHistory = { ...projection, stages: projection.stages.map(stage => stage.lane === 'done'
    ? { ...stage, historyCards: [makeCard({ id: tid('task-unknown'), lane: 'done' })] } : stage) } satisfies NonNullable<Parameters<typeof toWebBoardSnapshot>[0]>;
  const snapshot = JSON.parse(JSON.stringify(webProjection.snapshot(withHistory)));
  const validated = validateWebBoardSnapshot(snapshot);
  assert.ok(validated.ok);
  const done = validated.value.stages.find(stage => stage.lane === 'done');
  assert.ok(done);
  assert.equal(done.count, 1);
  assert.deepEqual(done.cards.map(card => card.id), ['task-weekly']);
  assert.ok(done.historyCards);
  assert.deepEqual(done.historyCards.map(card => card.id), ['task-unknown']);
  for (const historyCards of [null, 'unknown', [{}]]) {
    const malformed = { ...snapshot, stages: snapshot.stages.map((stage: { lane: string; }) => stage.lane === 'done'
      ? { ...stage, historyCards } : stage) };
    assert.equal(validateWebBoardSnapshot(malformed).ok, false);
  }
});

test('stored progress sequence round-trips and malformed identity is rejected (TASK-2719)', () => {
  const projection = { ...makeProjection(), operationLog: [{ operationId: 'producer', sequence: 4, phase: 'run', message: 'same', timestamp: '2026-10-06T10:00:00Z' }] };
  const snapshot = webProjection.snapshot(projection);
  assert.equal(snapshot.operationLog[0].sequence, 4);
  assert.equal(validateWebBoardSnapshot(snapshot).ok, true);
  assert.equal(validateWebBoardSnapshot({ ...snapshot, operationLog: [{ ...snapshot.operationLog[0], sequence: '4' }] }).ok, false);
});


test('checkpoint progress state round-trips and invalid states fail closed (TASK-2745)', () => {
  const card = makeFullCard({ checkpointEvidence: [
    { name: 'CP-1', description: 'work', goalCheck: [], state: 'current' },
  ] });
  const wire = webProjection.snapshot(makeProjection({ active: [card] }));
  assert.equal(validateWebBoardSnapshot(wire).ok, true);
  assert.equal(wire.stages.flatMap(stage => stage.cards)[0].checkpointEvidence?.[0].state, 'current');
  const malformed = JSON.parse(JSON.stringify(wire));
  malformed.stages.flatMap((stage: { cards: unknown[] }) => stage.cards)[0].checkpointEvidence[0].state = 'guess';
  assert.equal(validateWebBoardSnapshot(malformed).ok, false);
});


test('execution checkpoint and absent current plan round-trip fail closed (TASK-2776)', () => {
  for (const state of ['completed', 'future', 'current'] as const) {
    const wire = webProjection.snapshot(makeProjection({ active: [makeFullCard({ currentCheckpoint: state === 'current' ? 'CP-2' : null,
      checkpointEvidence: [{ name: 'CP-2', description: 'Step', goalCheck: [], state }] })] }));
    assert.equal(validateWebBoardSnapshot(wire).ok, true);
    const card = wire.stages.flatMap(stage => stage.cards)[0];
    assert.equal(card.currentCheckpoint, state === 'current' ? 'CP-2' : null);
    const malformed = JSON.parse(JSON.stringify(wire));
    malformed.stages.flatMap((stage: { cards: unknown[] }) => stage.cards)[0].checkpointEvidence[0].state = 'running';
    assert.equal(validateWebBoardSnapshot(malformed).ok, false);
    malformed.stages.flatMap((stage: { cards: unknown[] }) => stage.cards)[0].checkpointEvidence[0].state = 'planned';
    assert.equal(validateWebBoardSnapshot(malformed).ok, false);
    const invalidAttribution = JSON.parse(JSON.stringify(wire));
    invalidAttribution.stages.flatMap((stage: { cards: unknown[] }) => stage.cards)[0].currentCheckpoint = 42;
    assert.equal(validateWebBoardSnapshot(invalidAttribution).ok, false);
  }
});

test('manual attention round-trips without becoming a command capability (TASK-2799)', () => {
  const card = makeCard({ blockingReason: 'Operator must decide review authority' });
  const item = makeAttentionItem(card, { kind: 'blocking', detail: card.blockingReason! }, 1);
  const snapshot = webProjection.snapshot({ ...makeProjection({ active: [card] }), attentionQueue: [item] });
  const action = snapshot.attentionQueue[0]!.action;
  assert.ok(action);
  assert.equal(action.kind, 'manual');
  assert.equal(action.state, 'ineligible');
  assert.equal(action.targetLane, null);
  assert.equal(action.reason, card.blockingReason);
  assert.ok(validateWebBoardSnapshot(JSON.parse(JSON.stringify(snapshot))).ok);
  const invalid = structuredClone(snapshot);
  (invalid.attentionQueue[0]!.action as { state: string }).state = 'enabled';
  assert.equal(validateWebBoardSnapshot(invalid).ok, false);
  assert.ok(snapshot.availableActions.every(action => action.kind !== ('manual' as string)));
});
