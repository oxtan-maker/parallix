import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toWebBoardSnapshot,
  toWebCommandResult,
  toWebProgressEvent,
  validateWebBoardSnapshot,
  validateWebCommandResult,
  validateWebProgressEvent,
  WEB_TRANSPORT_VERSION,
  WebTransportError,
} from '../src/interfaces/web/transport.js';
import type { WebCommandAction } from '../src/interfaces/web/transport.js';
import {
  makeAttentionItem,
  makeCard,
  makeFullCard,
  makeProjection,
  emptyMetrics,
} from './fixtures/board-projection.js';
import type { BoardProjection } from '../src/application/projections/board.js';
import type { AgentAvailabilityMetric } from '../src/application/projections/board.js';
import type { LiveMissionWork, MissionCard } from '../src/application/projections/mission-board.js';
import { agentFamily } from '../src/domain/agents.js';
import type { MissionId } from '../src/domain/mission.js';
import { completed, failure } from '../src/application/contracts.js';

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
    phase: 'implement',
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
      { command: 'handoff', enabled: false, reason: 'Handoff requires an active mission with checkpoint evidence' },
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
        availabilityMetric({ family: agentFamily('custom'), runningSessions: null }),
        { family: agentFamily('claude'), available: true, blockedForMs: 0, reason: null },
      ],
      unattributedRunningSessions: null,
    },
    sourceFacts: [
      { source: 'task-markdown', status: 'fresh', value: 'CP-2 committed' },
      { source: 'git', status: 'stale' },
    ],
  });

  const snapshot = toWebBoardSnapshot(projection);
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
  const snapshot = toWebBoardSnapshot(projection);
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
        availabilityMetric({ family: agentFamily('b'), runningSessions: null }),
        availabilityMetric({ family: agentFamily('c'), runningSessions: 0 }),
        availabilityMetric({ family: agentFamily('d'), runningSessions: 2 }),
      ],
    },
  });
  const snapshot = toWebBoardSnapshot(projection);
  const [absent, unknown, observedNone, observedTwo] = snapshot.agentAvailability;

  assert.ok(!('runningSessions' in absent), 'absent probe result must omit the key');
  assert.strictEqual(unknown.runningSessions, null, 'unobserved liveness must be wire null');
  assert.strictEqual(observedNone.runningSessions, 0, 'observed-none must be wire 0');
  assert.strictEqual(observedTwo.runningSessions, 2);

  const parsed = roundTrip(snapshot);
  assert.ok(!('runningSessions' in parsed.agentAvailability[0]));
  assert.strictEqual(parsed.agentAvailability[1].runningSessions, null);
  assert.strictEqual(parsed.agentAvailability[2].runningSessions, 0);
  assert.strictEqual(parsed.agentAvailability[3].runningSessions, 2);
});

test('unattributed running sessions keep the same three-state encoding', () => {
  const omitted = toWebBoardSnapshot(projectionWith({ metrics: emptyMetrics }));
  assert.ok(!('unattributedRunningSessions' in omitted));

  const unknown = toWebBoardSnapshot(projectionWith({
    metrics: { ...emptyMetrics, unattributedRunningSessions: null },
  }));
  assert.strictEqual(unknown.unattributedRunningSessions, null);

  const observed = toWebBoardSnapshot(projectionWith({
    metrics: { ...emptyMetrics, unattributedRunningSessions: 3 },
  }));
  assert.strictEqual(observed.unattributedRunningSessions, 3);

  const parsed = roundTrip(unknown);
  assert.strictEqual(parsed.unattributedRunningSessions, null);
  assert.ok(!('unattributedRunningSessions' in roundTrip(omitted)));
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
  const snapshot = toWebBoardSnapshot(projection);
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
  const snapshot = toWebBoardSnapshot(projectionWith({ stages: makeProjection({ active: cards }).stages }));
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
  const snapshot = toWebBoardSnapshot(projectionWith({ stages: makeProjection({ [card.lane]: [card] }).stages }));
  const wire = snapshot.stages.flatMap((stage) => stage.cards).find((c) => c.id === card.id);
  return new Map((wire?.actions ?? []).map((action) => [action.kind, action]));
}

test('action DTO distinguishes an unavailable action from an ineligible action', () => {
  const card = reviewLaneCard();
  const actions = actionsFor(card);

  const review = actions.get('review:submit');
  assert.ok(review !== undefined);
  assert.equal(review.state, 'unavailable');
  assert.equal(typeof review.reason, 'string');
  assert.ok(review.reason.length > 0, 'unavailable carries the server-owned reason');
  assert.notEqual(review.reason, 'Review is available only while the mission is in review');

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
    commands: [{ command: 'handoff', enabled: true, reason: null }],
  });
  const actions = actionsFor(card);
  const handoff = actions.get('handoff:record');
  assert.ok(handoff !== undefined);
  assert.equal(handoff.state, 'enabled');
  assert.equal(handoff.reason, null);
  assert.equal(handoff.display, 'px handoff task-1010');
});

test('attention action keeps the server-owned display text and state', () => {
  const card = reviewLaneCard();
  const snapshot = toWebBoardSnapshot(projectionWith({
    stages: makeProjection({ review: [card] }).stages,
    attentionQueue: [makeAttentionItem(card, { kind: 'review-lane', detail: 'Awaiting review decision' }, 2)],
  }));
  const item = snapshot.attentionQueue[0];
  assert.equal(item.missionId, card.id);
  assert.equal(item.reason.kind, 'review-lane');
  assert.equal(item.reason.detail, 'Awaiting review decision');
  assert.equal(item.action.kind, 'review:submit');
  assert.equal(item.action.display, `px review ${card.id}`);
  assert.equal(item.action.state, 'unavailable');
  assert.ok(typeof item.action.reason === 'string' && item.action.reason.length > 0);
  assert.deepStrictEqual(item.dependsOnSources, ['task-markdown']);
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

test('unsupported transport version is rejected as an incompatible client', () => {
  const snapshot = toWebBoardSnapshot(projectionWith({}));
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
  const future = { ...makeProjection(), version: 99 } as unknown as BoardProjection;
  assert.throws(
    () => toWebBoardSnapshot(future),
    (error: unknown) => error instanceof WebTransportError && error.code === 'unsupported-projection-version',
  );
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
  const first = toWebBoardSnapshot(projection);
  const second = toWebBoardSnapshot(projection);
  assert.deepStrictEqual(first, second);
  assert.doesNotThrow(() => JSON.stringify(first));
});
